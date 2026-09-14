"use strict";

const crypto = require("node:crypto");

const CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const GRANT_TTL_MS = 2 * 60 * 1000;
const RETIRED_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const GRANT_LIMIT = 64;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;
const UID = /^[^/.#$\[\]\u0000-\u001f\u007f]{1,128}$/;
const hash = (...values) => crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");
const pairIdFor = (firstUid, secondUid) => hash("player-contact-v1", ...[firstUid, secondUid].sort());
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const name = (value) => String(value || "プレイヤー").replace(/[\r\n]/g, " ").slice(0, 40);

function createPlayerSafetyService({ firestore, realtime, HttpsError, resolveContext,
  resolvePublicOwner, closeContacts = async () => {}, validateLiveContact, resolveLegacyBlocked, now = Date.now }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const validUid = (value) => {
    if (typeof value !== "string" || !UID.test(value)) fail("invalid-argument", "プレイヤー情報を確認できません。");
    return value;
  };
  const policyRef = (first, second) => firestore.collection("playerContactPolicies").doc(pairIdFor(first, second));
  const blocks = (uid) => firestore.collection("playerSafetyUsers").doc(uid).collection("blocks");
  const operations = (uid) => firestore.collection("playerSafetyUsers").doc(uid).collection("operations");
  const contexts = (uid) => firestore.collection("playerSafetyUsers").doc(uid).collection("contexts");
  const outboxRef = (uid, requestId) => firestore.collection("playerSafetyOutbox").doc(hash(uid, requestId));
  const read = (ref, transaction) => transaction ? transaction.get(ref) : ref.get();
  const missingPolicies = new WeakSet();
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value <= 0) fail("unavailable", "サーバー時刻を確認できません。");
    return value;
  };
  function compactGate(value, at, staleGrantIds = new Set()) {
    const gate = object(value);
    const grants = { ...object(gate.grants) };
    const retired = { ...object(gate.retired) };
    let minAttemptStartedAt = Number(gate.minAttemptStartedAt || 0);
    for (const [id, grant] of Object.entries(grants)) {
      if (staleGrantIds.has(id) || (grant.active !== true && Number(grant.expiresAt || 0) <= at)) {
        delete grants[id];
        retired[id] = { ...grant, revokedAt: at, revokedVersion: gate.version, cleanupCaptured: true };
      }
    }
    for (const [id, grant] of Object.entries(retired)) {
      // Block-triggered closures must reach a durable outbox before their room
      // metadata can be pruned. Ordinary terminal/expired grants are already done.
      if (grant.cleanupCaptured === true && Number(grant.revokedAt || 0) <= at - RETIRED_GRANT_TTL_MS) {
        minAttemptStartedAt = Math.max(minAttemptStartedAt, Number(grant.startedAt || grant.createdAt || at));
        delete retired[id];
      }
    }
    return { ...gate, grants, retired, minAttemptStartedAt };
  }
  function normalizePolicy(snapshot, first, second) {
    const participants = [first, second].sort();
    if (!snapshot.exists) {
      const policy = { participants, revision: 0, blockedBy: {}, ownVersions: {}, lastBlockedAt: 0 };
      missingPolicies.add(policy);
      return policy;
    }
    const data = snapshot.data();
    if (JSON.stringify(data.participants) !== JSON.stringify(participants)
        || !Number.isSafeInteger(data.revision) || data.revision < 0
        || participants.some((uid) => data.blockedBy?.[uid] !== undefined
          && typeof data.blockedBy[uid] !== "boolean")
        || participants.some((uid) => data.ownVersions?.[uid] !== undefined
          && (!Number.isSafeInteger(data.ownVersions[uid]) || data.ownVersions[uid] < 0))
        || (data.lastBlockedAt !== undefined
          && (!Number.isSafeInteger(data.lastBlockedAt) || data.lastBlockedAt < 0))) {
      fail("unavailable", "安心設定を確認できません。時間をおいて再試行してください。");
    }
    return data;
  }
  async function getPolicy(first, second, transaction) {
    validUid(first); validUid(second);
    return normalizePolicy(await read(policyRef(first, second), transaction), first, second);
  }
  function blocked(policy) {
    return policy.participants.some((uid) => policy.blockedBy?.[uid] === true);
  }
  async function blockedForContact(first, second, policy, transaction) {
    return blocked(policy) || (missingPolicies.has(policy)
      && typeof resolveLegacyBlocked === "function"
      && await resolveLegacyBlocked(first, second, transaction) === true);
  }
  async function isBlocked(first, second, transaction) {
    if (first === second) return false;
    return blockedForContact(first, second, await getPolicy(first, second, transaction), transaction);
  }
  async function assertAllowed(first, second, transaction) {
    if (first === second) return { revision: 0, blocked: false };
    const policy = await getPolicy(first, second, transaction);
    if (await blockedForContact(first, second, policy, transaction)) fail("failed-precondition", "この相手との操作は現在利用できません。");
    return { ...policy, blocked: false };
  }
  async function filterVisible(uid, entries, ownerSelector) {
    validUid(uid);
    const rows = Array.isArray(entries) ? entries : [];
    const owners = [...new Set(rows.map(ownerSelector).filter((owner) => UID.test(String(owner || "")) && owner !== uid))];
    const denied = new Set();
    for (let offset = 0; offset < owners.length; offset += 100) {
      const part = owners.slice(offset, offset + 100);
      const snapshots = await firestore.getAll(...part.map((owner) => policyRef(uid, owner)));
      await Promise.all(snapshots.map(async (snapshot, index) => {
        if (await blockedForContact(uid, part[index], normalizePolicy(snapshot, uid, part[index]))) denied.add(part[index]);
      }));
    }
    return rows.filter((row) => {
      const owner = ownerSelector(row);
      return UID.test(String(owner || "")) && !denied.has(owner);
    });
  }

  // A pair's gate is a server-only RTDB projection. Revision changes revoke every
  // earlier grant; metadata cannot authorize an old room after an unblock.
  async function syncPolicy(first, second) {
    const policy = await getPolicy(first, second);
    const at = timestamp();
    const pairId = pairIdFor(first, second);
    const gateRef = realtime.ref(`online/contactGates/${pairId}`);
    const result = await gateRef.transaction((value) => {
      const current = compactGate(value, at);
      if (Number(current.version) > policy.revision) return;
      if (current.initialized === true && Number(current.version) === policy.revision) return current;
      const retired = { ...object(current.retired) };
      for (const [id, grant] of Object.entries(object(current.grants))) {
        retired[id] = { ...grant, safetyVersion: Number(current.version || 0),
          revokedAt: at, revokedVersion: policy.revision, cleanupCaptured: false };
      }
      return { initialized: true, participants: Object.fromEntries(policy.participants.map((uid) => [uid, true])),
        version: policy.revision, blocked: blocked(policy), updatedAt: at,
        minAttemptStartedAt: current.minAttemptStartedAt, grants: {}, retired };
    });
    const gate = result.snapshot.val();
    if (!gate || gate.initialized !== true || gate.version < policy.revision) {
      fail("unavailable", "安心設定を反映しています。時間をおいて再試行してください。");
    }
    return { policy, gate, pairId };
  }
  async function ensureContact({ firstUid, secondUid, mode, roomId, attemptId,
    startedAt, active }) {
    const at = timestamp();
    validUid(firstUid); validUid(secondUid);
    if (!/^(solo|strategy|free_table|market)$/.test(mode)
        || firstUid === secondUid
        || !/^[A-Za-z0-9_-]{1,120}$/.test(String(roomId || ""))
        || !/^[A-Za-z0-9_-]{1,160}$/.test(String(attemptId || ""))
        || !Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > at
        || (active !== undefined && typeof active !== "boolean")) {
      fail("invalid-argument", "接続情報を確認できません。");
    }
    const { policy, pairId } = await syncPolicy(firstUid, secondUid);
    if (await blockedForContact(firstUid, secondUid, policy)
        || (policy.lastBlockedAt > 0 && !(Number(startedAt) > policy.lastBlockedAt))) {
      fail("failed-precondition", "この接続は終了しました。改めて相手を探してください。");
    }
    const grantId = hash(mode, roomId, attemptId);
    const result = await realtime.ref(`online/contactGates/${pairId}`).transaction((value) => {
      // A cold Admin SDK cache may call us with null although the server gate
      // exists. A null no-op forces CAS reconciliation; undefined would abort.
      if (value === null) return null;
      const gate = compactGate(value, at);
      if (!gate.initialized || gate.blocked || gate.version !== policy.revision
          || gate.retired?.[grantId]) return;
      const grants = { ...object(gate.grants) };
      const previous = grants[grantId];
      if (previous && (previous.roomId !== roomId || previous.attemptId !== attemptId
          || previous.startedAt !== startedAt || previous.mode !== mode
          || previous.firstUid !== firstUid || previous.secondUid !== secondUid)) return;
      if (!previous && (startedAt <= gate.minAttemptStartedAt || Object.keys(grants).length >= GRANT_LIMIT)) return gate;
      grants[grantId] = previous || { roomId, mode, attemptId, firstUid, secondUid, safetyVersion: policy.revision,
        active: active === undefined ? ["free_table", "market"].includes(mode) : active,
        startedAt, createdAt: at, expiresAt: at + GRANT_TTL_MS };
      return { ...gate, grants };
    });
    const gate = result.snapshot.val();
    if (!result.committed || gate?.blocked || gate?.version !== policy.revision || !gate?.grants?.[grantId]) {
      fail("failed-precondition", "この接続は現在利用できません。改めて相手を探してください。");
    }
    return { safetyPairId: pairId, safetyVersion: policy.revision, safetyGrantId: grantId };
  }
  async function checkContact(args, transaction) {
    const { firstUid, secondUid, mode, roomId, safetyPairId, safetyVersion, safetyGrantId } = args;
    const policy = await getPolicy(firstUid, secondUid, transaction);
    if (await blockedForContact(firstUid, secondUid, policy, transaction) || policy.revision !== safetyVersion
        || safetyPairId !== pairIdFor(firstUid, secondUid) || !safetyGrantId) return false;
    const gate = (await realtime.ref(`online/contactGates/${safetyPairId}`).get()).val();
    const grant = gate?.grants?.[safetyGrantId];
    return gate?.initialized === true && gate.blocked === false && gate.version === safetyVersion
      && grant?.roomId === roomId && grant.mode === mode
      && [firstUid, secondUid].every((uid) => uid === grant.firstUid || uid === grant.secondUid)
      && (grant.active === true || grant.expiresAt > now());
  }
  async function activateContact(args) {
    if (!await checkContact(args)) return false;
    const result = await realtime.ref(`online/contactGates/${args.safetyPairId}`).transaction((value) => {
      if (value === null) return null;
      const gate = object(value);
      const grant = gate.grants?.[args.safetyGrantId];
      if (gate.blocked || gate.version !== args.safetyVersion || !grant
          || (grant.active !== true && grant.expiresAt <= now())) return;
      return { ...gate, grants: { ...gate.grants, [args.safetyGrantId]: { ...grant, active: true } } };
    });
    return result.committed;
  }
  async function revokeContact(args) {
    if (!args.safetyPairId || !args.safetyGrantId) return;
    await realtime.ref(`online/contactGates/${args.safetyPairId}`).transaction((value) => {
      if (value === null) return null;
      const at = timestamp();
      const gate = compactGate(value, at); const grant = gate.grants?.[args.safetyGrantId];
      if (!grant || grant.roomId !== args.roomId || gate.version !== args.safetyVersion) return;
      const grants = { ...gate.grants }; delete grants[args.safetyGrantId];
      return { ...gate, grants, retired: { ...object(gate.retired),
        [args.safetyGrantId]: { ...grant, revokedAt: at, revokedVersion: gate.version, cleanupCaptured: true } } };
    });
  }
  async function pruneContacts({ firstUid, secondUid }) {
    const { pairId, gate: initial } = await syncPolicy(firstUid, secondUid);
    const stale = new Map();
    if (typeof validateLiveContact === "function") {
      await Promise.all(Object.entries(object(initial.grants)).map(async ([id, grant]) => {
        // Only a positive authoritative stale result can end an active grant.
        if (await validateLiveContact({ ...grant, safetyPairId: pairId,
          safetyVersion: initial.version, safetyGrantId: id }) === false) stale.set(id, grant);
      }));
    }
    const result = await realtime.ref(`online/contactGates/${pairId}`).transaction((value) => {
      const gate = object(value);
      const staleIds = new Set([...stale].filter(([id, grant]) => (
        gate.version === initial.version && gate.grants?.[id]?.attemptId === grant.attemptId
          && gate.grants?.[id]?.createdAt === grant.createdAt
          && gate.grants?.[id]?.active === grant.active
      )).map(([id]) => id));
      return compactGate(gate, timestamp(), staleIds);
    });
    return { remaining: Object.keys(object(result.snapshot.val()?.grants)).length };
  }

  async function getContext(uid, data) {
    const target = await resolveContext(uid, data);
    if (!target || !UID.test(String(target.uid || "")) || target.uid === uid) {
      fail("not-found", "このプレイヤーの操作情報を確認できません。");
    }
    const policy = await getPolicy(uid, target.uid);
    const contextId = crypto.randomBytes(20).toString("hex");
    const expiresAt = now() + CONTEXT_TTL_MS;
    await contexts(uid).doc(contextId).set({ targetUid: target.uid, name: name(target.name),
      source: String(target.source || data.mode || "public").slice(0, 30), createdAt: now(), expiresAt,
      version: Number(policy.ownVersions?.[uid] || 0) });
    return { contextId, name: name(target.name), version: Number(policy.ownVersions?.[uid] || 0), expiresAt };
  }
  async function operationResponse(requestId, operation) {
    const policy = await getPolicy(operation.uid, operation.targetUid);
    const ownVersion = Number(policy.ownVersions?.[operation.uid] || 0);
    const superseded = ownVersion !== operation.ownVersion;
    const gate = await realtime.ref(`online/contactGates/${pairIdFor(operation.uid, operation.targetUid)}`).get()
      .then((snapshot) => snapshot.val(), () => null);
    const reflected = gate?.initialized === true && gate.version === policy.revision
      && gate.blocked === blocked(policy);
    return { operationId: requestId, status: operation.status === "complete" && reflected ? "complete" : "pending",
      blocked: policy.blockedBy?.[operation.uid] === true,
      blockId: policy.entryIds?.[operation.uid] || operation.blockId,
      version: ownVersion, superseded };
  }
  async function mutate(uid, data, desired) {
    const requestId = String(data.requestId || "");
    if (!REQUEST_ID.test(requestId) || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0) {
      fail("invalid-argument", "操作情報を更新してから、もう一度お試しください。");
    }
    const operand = String(desired ? data.contextId : data.blockId);
    if (!/^[a-f0-9]{40}$/.test(operand)) fail("invalid-argument", "操作対象を確認できません。");
    const fingerprint = hash(desired, operand, data.expectedVersion);
    const operationRef = operations(uid).doc(requestId);
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(operationRef);
      if (existing.exists) {
        if (existing.get("fingerprint") !== fingerprint) fail("invalid-argument", "同じ操作番号を別の操作には使えません。");
        return;
      }
      const sourceRef = desired ? contexts(uid).doc(operand) : blocks(uid).doc(operand);
      const sourceSnapshot = await transaction.get(sourceRef);
      const source = sourceSnapshot.data();
      if (!source || (desired && source.expiresAt <= now())) fail("not-found", "対象の情報をもう一度開いてください。");
      const targetUid = validUid(source.targetUid);
      if (targetUid === uid) fail("invalid-argument", "自分自身はブロックできません。");
      const pairRef = policyRef(uid, targetUid);
      const policy = normalizePolicy(await transaction.get(pairRef), uid, targetUid);
      const ownVersion = Number(policy.ownVersions?.[uid] || 0);
      if (ownVersion !== data.expectedVersion) fail("aborted", "設定が更新されています。一覧を開き直してください。");
      const ownerRef = firestore.collection("playerSafetyUsers").doc(uid);
      const owner = (await transaction.get(ownerRef)).data() || {};
      const recent = Number(owner.lastMutationAt || 0);
      const count = now() - Number(owner.rateWindowAt || 0) < 60000 ? Number(owner.rateCount || 0) : 0;
      if (count >= 20 || now() - recent < 250) fail("resource-exhausted", "少し時間をおいて再試行してください。");
      const blockId = policy.entryIds?.[uid] || (desired ? crypto.randomBytes(20).toString("hex") : operand);
      const nextVersion = ownVersion + 1;
      const next = { ...policy, blockedBy: { ...object(policy.blockedBy), [uid]: desired },
        ownVersions: { ...object(policy.ownVersions), [uid]: nextVersion },
        entryIds: { ...object(policy.entryIds), [uid]: blockId }, revision: policy.revision + 1,
        updatedAt: now(), lastBlockedAt: desired
          ? Math.max(timestamp(), Number(policy.lastBlockedAt || 0)) : Number(policy.lastBlockedAt || 0) };
      transaction.set(pairRef, next);
      transaction.set(blocks(uid).doc(blockId), { targetUid, name: name(source.name),
        createdAt: source.createdAt || now(), source: source.source || "global",
        version: nextVersion, active: desired, updatedAt: now() });
      transaction.set(ownerRef, { version: Number(owner.version || 0) + 1, lastMutationAt: now(),
        rateWindowAt: count ? owner.rateWindowAt : now(), rateCount: count + 1 }, { merge: true });
      const operation = { uid, targetUid, blocked: desired, blockId, ownVersion: nextVersion,
        revision: next.revision, fingerprint, createdAt: now(), status: "pending" };
      transaction.create(operationRef, operation);
      transaction.set(outboxRef(uid, requestId), { ...operation, requestId,
        status: "pending", nextAttemptAt: now(), attempts: 0 });
    });
    try { await processOperation(uid, requestId); } catch { /* durable outbox retries */ }
    return operationResponse(requestId, (await operationRef.get()).data());
  }
  async function importLegacyDirection({ uid, targetUid, name: displayName, source, migrationId }) {
    validUid(uid); validUid(targetUid);
    if (uid === targetUid || typeof migrationId !== "string" || !migrationId || migrationId.length > 200) {
      fail("invalid-argument", "移行するブロック情報を確認できません。");
    }
    const requestId = `legacy_${hash(migrationId, uid, targetUid)}`;
    const blockId = crypto.randomBytes(20).toString("hex");
    const at = timestamp();
    let imported = false;
    await firestore.runTransaction(async (transaction) => {
      imported = false;
      const reference = policyRef(uid, targetUid);
      const [snapshot, ownerSnapshot] = await Promise.all([
        transaction.get(reference), transaction.get(firestore.collection("playerSafetyUsers").doc(uid)),
      ]);
      const policy = normalizePolicy(snapshot, uid, targetUid);
      // An explicit false is also an existing choice. Never reimport over an
      // unblock tombstone, even from a different legacy source or migration run.
      if (Object.hasOwn(object(policy.ownVersions), uid) || Object.hasOwn(object(policy.blockedBy), uid)) return;
      const next = { ...policy, blockedBy: { ...object(policy.blockedBy), [uid]: true },
        ownVersions: { ...object(policy.ownVersions), [uid]: 1 },
        entryIds: { ...object(policy.entryIds), [uid]: blockId }, revision: policy.revision + 1,
        updatedAt: at, lastBlockedAt: Math.max(at, Number(policy.lastBlockedAt || 0)) };
      transaction.set(reference, next);
      transaction.set(blocks(uid).doc(blockId), { targetUid, name: name(displayName), source: String(source || "legacy").slice(0, 30),
        createdAt: at, updatedAt: at, version: 1, active: true, migrationId });
      transaction.set(firestore.collection("playerSafetyUsers").doc(uid), {
        version: Number(ownerSnapshot.get("version") || 0) + 1, migrated: true,
      }, { merge: true });
      const operation = { uid, targetUid, requestId, blocked: true, blockId, ownVersion: 1,
        revision: next.revision, fingerprint: hash("legacy", migrationId, uid, targetUid),
        createdAt: at, status: "pending" };
      transaction.create(operations(uid).doc(requestId), operation);
      transaction.set(outboxRef(uid, requestId), { ...operation, nextAttemptAt: at, attempts: 0 });
      imported = true;
    });
    const operation = await operations(uid).doc(requestId).get();
    if (operation.exists) {
      try { await processOperation(uid, requestId); } catch { /* durable migration closure retries */ }
      return { imported, ...(await operationResponse(requestId, (await operations(uid).doc(requestId).get()).data())) };
    }
    return { imported, status: "unchanged" };
  }
  async function processOperation(uid, requestId) {
    const jobRef = outboxRef(uid, requestId);
    const snapshot = await jobRef.get();
    if (!snapshot.exists) return;
    const job = snapshot.data();
    if (job.uid !== uid || job.requestId !== requestId) fail("unavailable", "保存済み操作の一致を確認できません。");
    if (job.status === "complete") return;
    const { policy, gate, pairId } = await syncPolicy(uid, job.targetUid);
    const currentOwnVersion = Number(policy.ownVersions?.[uid] || 0);
    if (gate.version !== policy.revision) fail("unavailable", "安心設定の反映を確認しています。");
    const superseded = currentOwnVersion !== job.ownVersion;
    let contactGrants = object(job.contactGrants);
    if (job.blocked) {
      const uncaptured = Object.fromEntries(Object.entries(object(gate.retired))
        .filter(([_id, grant]) => grant.cleanupCaptured !== true
          && Number.isSafeInteger(grant.safetyVersion) && grant.safetyVersion < job.revision));
      // Save before marking captured in RTDB. A crash can duplicate the copy but
      // cannot discard the only room reference needed for late settlement.
      if (Object.keys(uncaptured).length) {
        contactGrants = { ...contactGrants, ...uncaptured };
        await jobRef.set({ contactGrants }, { merge: true });
        await realtime.ref(`online/contactGates/${pairId}`).transaction((value) => {
          const current = object(value); const retired = { ...object(current.retired) };
          for (const [id, saved] of Object.entries(uncaptured)) {
            if (retired[id]?.revokedVersion === saved.revokedVersion
                && retired[id]?.revokedAt === saved.revokedAt) {
              retired[id] = { ...retired[id], cleanupCaptured: true };
            }
          }
          return { ...current, retired };
        });
      }
      // Another worker for this operation may have captured these references
      // while this worker read the gate. Always close from the durable copy.
      contactGrants = object((await jobRef.get()).get("contactGrants"));
    }
    // This small notification contains no relationship or block direction.
    await Promise.all(policy.participants.map(async (participant) => {
      await realtime.ref(`online/playerSafetyEvents/${participant}`).transaction((value) => ({
        version: Number(value?.version || 0) + 1, updatedAt: now(),
      }));
    }));
    await operations(uid).doc(requestId).set({ status: "complete", superseded, reflectedAt: now() }, { merge: true });
    if (job.blocked) {
      await closeContacts({ firstUid: uid, secondUid: job.targetUid, actorUid: uid,
        operationId: requestId, revision: job.revision, pairId,
        blockedAt: job.createdAt, grants: contactGrants });
    }
    await jobRef.set({ status: "complete", completedAt: now() }, { merge: true });
  }
  async function cleanup() {
    const snapshot = await firestore.collection("playerSafetyOutbox")
      .where("status", "==", "pending").where("nextAttemptAt", "<=", timestamp())
      .orderBy("nextAttemptAt", "asc").limit(25).get();
    let complete = 0; let deferred = 0;
    for (const doc of snapshot.docs) {
      const job = doc.data();
      if (job.nextAttemptAt > now()) { deferred += 1; continue; }
      try { await processOperation(job.uid, job.requestId); complete += 1; }
      catch {
        const attempts = Number(job.attempts || 0) + 1;
        await doc.ref.set({ attempts, nextAttemptAt: now() + Math.min(3600000, 30000 * (2 ** Math.min(attempts, 7))) }, { merge: true });
      }
    }
    return { examined: snapshot.size, complete, deferred };
  }
  async function list(uid, data) {
    let query = blocks(uid).where("active", "==", true).orderBy("createdAt", "desc").limit(51);
    if (data.cursor) {
      if (!/^[a-f0-9]{40}$/.test(String(data.cursor))) fail("invalid-argument", "一覧の位置を確認できません。");
      const cursor = await blocks(uid).doc(data.cursor).get();
      if (!cursor.exists) fail("invalid-argument", "一覧を更新してください。");
      query = query.startAfter(cursor);
    }
    const [snapshot, enabledSnapshot, user] = await Promise.all([query.get(),
      realtime.ref("online/config/playerSafetyEnabled").get(), firestore.collection("playerSafetyUsers").doc(uid).get()]);
    const docs = snapshot.docs.slice(0, 50);
    return { enabled: enabledSnapshot.val() === true, entries: docs.map((doc) => {
      const row = doc.data(); return { id: doc.id, name: name(row.name), createdAt: row.createdAt,
        version: row.version, source: row.source || "global" };
    }), cursor: snapshot.size > 50 ? docs.at(-1).id : "", migrationNotice: user.get("migrated") === true };
  }
  async function filterPublic(uid, data) {
    const kind = String(data.kind || "");
    const ids = [...new Set(Array.isArray(data.ids) ? data.ids : [])];
    if (ids.length > 100 || ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(String(id)))) {
      fail("invalid-argument", "表示する情報を確認できません。");
    }
    const resolved = await Promise.all(ids.map(async (id) => ({ id, owner: await resolvePublicOwner(kind, id) })));
    const visible = await filterVisible(uid, resolved, (row) => row.owner?.uid);
    const visibleIds = new Set(visible.map((row) => row.id));
    return { hiddenIds: ids.filter((id) => !visibleIds.has(id)) };
  }
  async function performAction(uidValue, dataValue) {
    const uid = validUid(uidValue); const data = object(dataValue);
    if (data.action === "get_context") return getContext(uid, data);
    if (data.action === "list") return list(uid, data);
    if (data.action === "filter_public") return filterPublic(uid, data);
    if (data.action === "contact_status") {
      const target = await resolveContext(uid, data).catch(() => null);
      const room = object(target?.room);
      const firstUid = room.firstUid || room.hostUid || room.sellerUid || room.host;
      const secondUid = room.secondUid || room.guestUid || room.visitorUid || room.buyerUid || room.guest;
      if (!target || ![firstUid, secondUid].includes(uid) || ![firstUid, secondUid].includes(target.uid)) {
        return { available: false };
      }
      return { available: await checkContact({ firstUid, secondUid,
        mode: target.source || data.mode, roomId: target.roomId || data.roomId,
        safetyPairId: room.safetyPairId, safetyVersion: room.safetyVersion, safetyGrantId: room.safetyGrantId }) };
    }
    if (data.action === "get_operation") {
      const requestId = String(data.requestId || "");
      if (!REQUEST_ID.test(requestId)) fail("invalid-argument", "操作番号を確認できません。");
      const operation = await operations(uid).doc(requestId).get();
      if (!operation.exists) fail("not-found", "保存済みの操作を確認できません。");
      try { await processOperation(uid, requestId); } catch { /* scheduled recovery remains */ }
      return operationResponse(requestId, (await operations(uid).doc(requestId).get()).data());
    }
    if (data.action === "block" || data.action === "unblock") {
      if ((await realtime.ref("online/config/playerSafetyEnabled").get()).val() !== true) {
        fail("failed-precondition", "共通ブロックを準備しています。しばらくお待ちください。");
      }
      return mutate(uid, data, data.action === "block");
    }
    fail("invalid-argument", "未対応の安心設定操作です。");
  }
  return Object.freeze({ pairIdFor, policyRef, getPolicy, isBlocked, assertAllowed, filterVisible,
    syncPolicy, ensureContact, checkContact, activateContact, revokeContact, pruneContacts,
    processOperation, cleanup, performAction, importLegacyDirection });
}

module.exports = { createPlayerSafetyService, pairIdFor, CONTEXT_TTL_MS, GRANT_TTL_MS, RETIRED_GRANT_TTL_MS, GRANT_LIMIT };
