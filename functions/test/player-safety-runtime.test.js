"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createPlayerSafetyService, pairIdFor, GRANT_TTL_MS, RETIRED_GRANT_TTL_MS } = require("../player-safety");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const hash = (...values) => crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");

function fixture(options = {}) {
  const store = createPlayerSafetyMemory();
  let at = 2_000_000_000_000;
  let closeFailures = 0;
  const closures = [];
  const targets = new Map();
  store.rtWrite("online/config/playerSafetyEnabled", true);
  const service = createPlayerSafetyService({
    firestore: store.firestore, realtime: store.realtime, HttpsError, now: () => at,
    resolveContext: async (_uid, data) => targets.get(data.roomId || data.publicEntryId) || null,
    resolvePublicOwner: async (_kind, id) => targets.get(id) || null,
    validateLiveContact: options.validateLiveContact,
    resolveLegacyBlocked: options.resolveLegacyBlocked,
    closeContacts: async (args) => {
      closures.push(structuredClone(args));
      if (closeFailures > 0) { closeFailures -= 1; throw new Error("injected settlement failure"); }
    },
  });
  const result = { ...store, service, targets, closures,
    now: () => at,
    tick: (ms = 1000) => { at += ms; },
    failClose: (count = 1) => { closeFailures = count; },
    gate: (first = "A", second = "B") => store.rtRead(`online/contactGates/${pairIdFor(first, second)}`),
    policy: (first = "A", second = "B") => store.documents.get(`playerContactPolicies/${pairIdFor(first, second)}`),
  };
  result.context = async (uid, otherUid) => {
    const id = `public-${otherUid}`;
    targets.set(id, { uid: otherUid, name: `NAME-${otherUid}`, source: "card" });
    return service.performAction(uid, { action: "get_context", publicEntryId: id });
  };
  result.block = async (uid, otherUid, requestId) => {
    const context = await result.context(uid, otherUid);
    return service.performAction(uid, { action: "block", contextId: context.contextId,
      expectedVersion: context.version, requestId });
  };
  result.contact = (overrides = {}) => ({ firstUid: "A", secondUid: "B", mode: "solo",
    roomId: "room-1", attemptId: "attempt-1", startedAt: at, ...overrides });
  return result;
}

test("directional block ownership, pair CAS and single-owner unblock remain independent", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.block("A", "B", "block-A-0001"), f.block("B", "A", "block-B-0001")]);
  assert.equal(pairIdFor("A", "B"), pairIdFor("B", "A"));
  assert.equal(f.policy().revision, 2);
  assert.deepEqual(f.policy().blockedBy, { A: true, B: true });
  assert.equal(await f.service.isBlocked("A", "B"), true);
  f.tick();
  const ownUnblock = await f.service.performAction("A", {
    action: "unblock", blockId: a.blockId, requestId: "unblock-A-0001", expectedVersion: a.version,
  });
  assert.equal(ownUnblock.blocked, false);
  assert.equal(await f.service.isBlocked("A", "B"), true);
  assert.equal(f.gate().blocked, true);
  const aList = await f.service.performAction("A", { action: "list" });
  const bList = await f.service.performAction("B", { action: "list" });
  assert.equal(aList.entries.length, 0);
  assert.equal(bList.entries[0].id, b.blockId);
  assert.doesNotMatch(JSON.stringify(bList), /targetUid|blockedBy|ownVersions/);
  assert.deepEqual(new Set(f.closures.map((row) => row.actorUid)), new Set(["A", "B"]));
});

test("operation replay preserves identity and returns current own state after a newer unblock", async () => {
  const f = fixture();
  const context = await f.context("A", "B");
  const request = { action: "block", contextId: context.contextId, expectedVersion: 0, requestId: "replay-block-0001" };
  const first = await f.service.performAction("A", request);
  const replay = await f.service.performAction("A", request);
  assert.equal(replay.version, first.version);
  assert.equal(f.policy().revision, 1);
  assert.equal(f.closures.length, 1);
  await assert.rejects(f.service.performAction("A", { ...request, expectedVersion: 1 }), { code: "invalid-argument" });
  f.tick();
  await f.service.performAction("A", { action: "unblock", blockId: first.blockId, expectedVersion: 1, requestId: "replay-unblock-0001" });
  const delayed = await f.service.performAction("A", request);
  assert.equal(delayed.blocked, false);
  assert.equal(delayed.version, 2);
  assert.equal(delayed.superseded, true);
  const polled = await f.service.performAction("A", { action: "get_operation", requestId: request.requestId });
  assert.deepEqual(polled, delayed);
  f.tick();
  await assert.rejects(f.service.performAction("A", { ...request, requestId: "stale-block-0002" }), { code: "aborted" });
  await assert.rejects(f.service.performAction("C", { ...request, requestId: "other-context-0001" }), { code: "not-found" });
});

test("concurrent stale own intents cannot both commit and a policy transaction read protects payment", async () => {
  const f = fixture();
  const context = await f.context("A", "B");
  const results = await Promise.allSettled(["one", "two"].map((suffix) => f.service.performAction("A", {
    action: "block", contextId: context.contextId, expectedVersion: 0, requestId: `cas-block-${suffix}`,
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "aborted");
  const other = fixture();
  const wallet = other.firestore.collection("wallets").doc("A");
  other.fsWrite(wallet.path, { balance: 20 });
  let injected = false;
  other.hooks.beforeFirestoreCommit = ({ reads }) => {
    if (injected || !reads.has(other.service.policyRef("A", "B").path)) return;
    injected = true;
    other.fsWrite(other.service.policyRef("A", "B").path, {
      participants: ["A", "B"], revision: 1, blockedBy: { B: true }, ownVersions: { B: 1 }, lastBlockedAt: other.now(),
    });
  };
  await assert.rejects(other.firestore.runTransaction(async (transaction) => {
    const balance = (await transaction.get(wallet)).get("balance");
    await other.service.assertAllowed("A", "B", transaction);
    transaction.set(wallet, { balance: balance - 10 });
  }), { code: "failed-precondition" });
  assert.equal(other.documents.get(wallet.path).balance, 20);
});

test("contact timestamps are mandatory server values; start grants expire and activation is explicit", async () => {
  const f = fixture();
  for (const startedAt of [undefined, null, 0, -1, NaN, Infinity, "2000000000000", f.now() + 1]) {
    await assert.rejects(f.service.ensureContact(f.contact({ startedAt })), { code: "invalid-argument" });
  }
  assert.equal(f.gate(), null);
  const args = f.contact();
  const metadata = await f.service.ensureContact(args);
  assert.equal(f.gate().grants[metadata.safetyGrantId].active, false);
  f.tick(GRANT_TTL_MS + 1);
  assert.equal(await f.service.checkContact({ ...args, ...metadata }), false);
  assert.equal(await f.service.activateContact({ ...args, ...metadata }), false);
  f.tick();
  const fresh = f.contact({ roomId: "room-2", attemptId: "attempt-2" });
  const live = await f.service.ensureContact(fresh);
  assert.equal(await f.service.activateContact({ ...fresh, ...live }), true);
  f.tick(GRANT_TTL_MS * 100);
  assert.equal(await f.service.checkContact({ ...fresh, ...live }), true, "long active contact survives start-token expiry");
});

test("RTDB CAS rejects grants and activation when a newer block wins their commit race", async () => {
  const f = fixture();
  let injected = false;
  f.hooks.beforeRealtimeCommit = ({ path, value }) => {
    if (injected || !path.includes("contactGates") || !Object.keys(value.grants || {}).length) return;
    injected = true;
    f.fsWrite(f.service.policyRef("A", "B").path, {
      participants: ["A", "B"], revision: 1, blockedBy: { B: true }, ownVersions: { B: 1 }, lastBlockedAt: f.now(),
    });
    f.rtWrite(path, { initialized: true, version: 1, blocked: true, grants: {}, retired: {} });
  };
  await assert.rejects(f.service.ensureContact(f.contact()), { code: "failed-precondition" });
  assert.deepEqual(f.gate().grants, {});
  const g = fixture();
  const args = g.contact();
  const metadata = await g.service.ensureContact(args);
  g.hooks.beforeRealtimeCommit = ({ path, value }) => {
    if (!value.grants?.[metadata.safetyGrantId]?.active) return;
    g.hooks.beforeRealtimeCommit = null;
    g.rtWrite(path, { ...g.gate(), version: 1, blocked: true, grants: {}, retired: {} });
  };
  assert.equal(await g.service.activateContact({ ...args, ...metadata }), false);
  assert.equal(g.gate().blocked, true);
});

test("unblock never revives old room grants and contact_status uses trusted room metadata", async () => {
  const f = fixture();
  const args = f.contact({ mode: "market" });
  const metadata = await f.service.ensureContact(args);
  f.targets.set(args.roomId, { uid: "B", source: "market", roomId: args.roomId,
    room: { sellerUid: "A", buyerUid: "B", ...metadata } });
  assert.equal((await f.service.performAction("A", { action: "contact_status", mode: "market", roomId: args.roomId })).available, true);
  f.tick();
  const blocked = await f.block("A", "B", "grant-block-0001");
  f.tick();
  await f.service.performAction("A", { action: "unblock", blockId: blocked.blockId,
    expectedVersion: blocked.version, requestId: "grant-unblock-0001" });
  assert.equal(await f.service.isBlocked("A", "B"), false);
  assert.equal((await f.service.performAction("A", { action: "contact_status", mode: "market", roomId: args.roomId })).available, false);
  await assert.rejects(f.service.ensureContact(args), { code: "failed-precondition" });
  f.tick();
  const fresh = f.contact({ mode: "market", roomId: "new-room", attemptId: "new-attempt" });
  const freshMetadata = await f.service.ensureContact(fresh);
  assert.equal(await f.service.checkContact({ ...fresh, ...freshMetadata }), true);
  await f.service.revokeContact({ ...args, ...metadata });
  assert.equal(await f.service.checkContact({ ...fresh, ...freshMetadata }), true, "old cleanup cannot revoke a later revision");
});

test("expired grants do not exhaust a pair and compacted tombstones preserve a replay watermark", async () => {
  const f = fixture();
  const longArgs = f.contact({ mode: "free_table", roomId: "long-room", attemptId: "long-attempt" });
  const longMetadata = await f.service.ensureContact(longArgs);
  const first = f.contact();
  await f.service.ensureContact(first);
  for (let index = 0; index < 70; index += 1) {
    f.tick(GRANT_TTL_MS + 1);
    await f.service.ensureContact(f.contact({ roomId: `pending-${index}`, attemptId: `attempt-${index + 2}` }));
  }
  assert.ok(Object.keys(f.gate().grants).length <= 2);
  f.tick(RETIRED_GRANT_TTL_MS + 1);
  await f.service.pruneContacts({ firstUid: "A", secondUid: "B" });
  assert.ok(f.gate().minAttemptStartedAt >= first.startedAt);
  assert.equal(await f.service.checkContact({ ...longArgs, ...longMetadata }), true);
  await assert.rejects(f.service.ensureContact(first), { code: "failed-precondition" });
  f.tick();
  const current = f.contact({ roomId: "current-room", attemptId: "current-attempt" });
  const metadata = await f.service.ensureContact(current);
  await f.service.revokeContact({ ...current, ...metadata });
  await assert.rejects(f.service.ensureContact(current), { code: "failed-precondition" });
});

test("retired block metadata is captured durably before pruning and preserves its original closer on retry", async () => {
  const f = fixture();
  const args = f.contact({ mode: "market" });
  const metadata = await f.service.ensureContact(args);
  f.hooks.failDocumentSet = (path, value) => path.startsWith("playerSafetyOutbox/") && value.contactGrants;
  f.tick();
  const result = await f.block("B", "A", "durable-block-0001");
  assert.equal(result.status, "pending");
  assert.equal(f.gate().retired[metadata.safetyGrantId].cleanupCaptured, false);
  f.tick(RETIRED_GRANT_TTL_MS + 1);
  await f.service.pruneContacts({ firstUid: "A", secondUid: "B" });
  assert.ok(f.gate().retired[metadata.safetyGrantId], "uncaptured room references have no TTL");
  f.hooks.failDocumentSet = null;
  f.failClose();
  await assert.rejects(f.service.processOperation("B", "durable-block-0001"), /settlement failure/);
  f.tick(RETIRED_GRANT_TTL_MS + 1);
  await f.service.pruneContacts({ firstUid: "A", secondUid: "B" });
  assert.equal(f.gate().retired[metadata.safetyGrantId], undefined);
  await f.service.processOperation("B", "durable-block-0001");
  assert.equal(f.closures.length, 2);
  assert.deepEqual(f.closures[0], f.closures[1]);
  assert.equal(f.closures[1].actorUid, "B");
  assert.equal(f.closures[1].grants[metadata.safetyGrantId].roomId, args.roomId);
});

test("a delayed older block cannot consume the durable closure reference of a newer contact", async () => {
  const f = fixture();
  const initial = await f.service.ensureContact(f.contact({ mode: "market" }));
  f.hooks.failRealtime = 1;
  f.tick();
  const firstBlock = await f.block("A", "B", "older-block-0001");
  assert.equal(firstBlock.status, "pending");
  f.tick();
  await f.service.performAction("A", { action: "unblock", blockId: firstBlock.blockId,
    expectedVersion: firstBlock.version, requestId: "between-unblock-0001" });
  f.tick();
  const newer = await f.service.ensureContact(f.contact({ mode: "market", roomId: "newer-room", attemptId: "newer-attempt" }));
  assert.equal(newer.safetyVersion, 2);
  f.hooks.failRealtime = 1;
  f.tick();
  await f.block("B", "A", "newest-block-0001");
  await f.service.processOperation("A", "older-block-0001");
  const olderJob = f.documents.get(`playerSafetyOutbox/${hash("A", "older-block-0001")}`);
  assert.ok(olderJob.contactGrants[initial.safetyGrantId]);
  assert.equal(olderJob.contactGrants[newer.safetyGrantId], undefined);
  assert.equal(f.gate().retired[newer.safetyGrantId].cleanupCaptured, false);
  await f.service.processOperation("B", "newest-block-0001");
  const newerClosure = f.closures.find((entry) => entry.operationId === "newest-block-0001");
  assert.equal(newerClosure.grants[newer.safetyGrantId].roomId, "newer-room");
  assert.equal(newerClosure.actorUid, "B");
});

test("concurrent operation workers both use the durable captured closure payload", async () => {
  const f = fixture();
  const metadata = await f.service.ensureContact(f.contact({ mode: "market" }));
  f.tick(); f.hooks.failRealtime = 1;
  await f.block("A", "B", "parallel-block-0001");
  let resume; let observed;
  const paused = new Promise((resolve) => { observed = resolve; });
  const release = new Promise((resolve) => { resume = resolve; });
  const originalCollection = f.firestore.collection;
  let delayOnce = true;
  f.firestore.collection = (path) => {
    const collection = originalCollection(path);
    if (path !== "playerSafetyOutbox") return collection;
    return { ...collection, doc: (id) => {
      const ref = collection.doc(id);
      return { ...ref, get: async () => {
        const snapshot = await ref.get();
        if (delayOnce) { delayOnce = false; observed(); await release; }
        return snapshot;
      } };
    } };
  };
  const delayedWorker = f.service.processOperation("A", "parallel-block-0001");
  await paused;
  await f.service.processOperation("A", "parallel-block-0001");
  resume();
  await delayedWorker;
  assert.equal(f.closures.length, 2);
  for (const closure of f.closures) assert.equal(closure.grants[metadata.safetyGrantId].roomId, "room-1");
});

test("due outbox query bypasses an arbitrarily large page of backed-off work", async () => {
  const f = fixture();
  for (let index = 0; index < 40; index += 1) {
    const requestId = `future-job-${index}`;
    f.fsWrite(`playerSafetyOutbox/${hash("A", requestId)}`, { uid: "A", targetUid: "B", requestId,
      status: "pending", nextAttemptAt: f.now() + 1000000, attempts: 5 });
  }
  const requestId = "due-job-0001";
  const job = { uid: "A", targetUid: "B", requestId, blocked: false,
    ownVersion: 0, revision: 0, status: "pending", nextAttemptAt: f.now(), createdAt: f.now() };
  f.fsWrite(`playerSafetyOutbox/${hash("A", requestId)}`, job);
  f.fsWrite(`playerSafetyUsers/A/operations/${requestId}`, job);
  const result = await f.service.cleanup();
  assert.deepEqual(result, { examined: 1, complete: 1, deferred: 0 });
  assert.equal(f.documents.get(`playerSafetyOutbox/${hash("A", requestId)}`).status, "complete");
  assert.equal([...f.documents.values()].filter((row) => row.status === "pending").length, 40);
});

test("active grant pruning requires a positive authoritative stale result and does not run without that hook", async () => {
  const f = fixture({ validateLiveContact: async ({ roomId }) => roomId === "keep-room" });
  for (const roomId of ["keep-room", "ended-room"]) {
    await f.service.ensureContact(f.contact({ mode: "market", roomId, attemptId: roomId }));
  }
  const result = await f.service.pruneContacts({ firstUid: "A", secondUid: "B" });
  assert.equal(result.remaining, 1);
  assert.equal(Object.values(f.gate().grants)[0].roomId, "keep-room");
});

test("legacy directional migration is idempotent before activation and never overwrites an unblock tombstone", async () => {
  const f = fixture();
  f.rtWrite("online/config/playerSafetyEnabled", false);
  const context = await f.context("A", "B");
  await assert.rejects(f.service.performAction("A", { action: "block", contextId: context.contextId,
    expectedVersion: 0, requestId: "disabled-block-0001" }), { code: "failed-precondition" });
  const migration = { uid: "A", targetUid: "B", name: "旧相手", source: "free_table", migrationId: "release-safety-v1" };
  const first = await f.service.importLegacyDirection(migration);
  assert.equal(first.imported, true);
  assert.equal(first.status, "complete");
  const retry = await f.service.importLegacyDirection(migration);
  assert.equal(retry.imported, false);
  assert.equal(f.policy().revision, 1);
  assert.equal(f.closures[0].actorUid, "A");
  f.rtWrite("online/config/playerSafetyEnabled", true);
  f.tick();
  await f.service.performAction("A", { action: "unblock", blockId: first.blockId,
    expectedVersion: first.version, requestId: "migrated-unblock-0001" });
  const otherSource = await f.service.importLegacyDirection({ ...migration, source: "market", migrationId: "later-source" });
  assert.equal(otherSource.imported, false);
  assert.equal(await f.service.isBlocked("A", "B"), false);
  const opposite = await f.service.importLegacyDirection({ ...migration, uid: "B", targetUid: "A" });
  assert.equal(opposite.imported, true);
  assert.equal(await f.service.isBlocked("A", "B"), true);
});

test("pre-migration legacy fallback covers reads and paid transactions but never overrides canonical tombstones", async () => {
  let legacyBlocked = false;
  const calls = [];
  const f = fixture({ resolveLegacyBlocked: async (first, second, transaction) => {
    calls.push({ first, second, transaction });
    return legacyBlocked && [first, second].includes("B");
  } });
  const args = f.contact();
  const metadata = await f.service.ensureContact(args);
  legacyBlocked = true;
  assert.equal((await f.service.getPolicy("A", "B")).revision, 0, "policy read remains canonical for migration");
  assert.equal(await f.service.isBlocked("A", "B"), true);
  assert.equal(await f.service.checkContact({ ...args, ...metadata }), false);
  await assert.rejects(f.service.ensureContact(f.contact({ roomId: "new-legacy-room" })), { code: "failed-precondition" });
  assert.deepEqual(await f.service.filterVisible("A", [{ owner: "A" }, { owner: "B" }, { owner: "C" }], (row) => row.owner),
    [{ owner: "A" }, { owner: "C" }]);
  let paymentTransaction;
  await assert.rejects(f.firestore.runTransaction(async (transaction) => {
    paymentTransaction = transaction;
    await f.service.assertAllowed("A", "B", transaction);
  }), { code: "failed-precondition" });
  assert.equal(calls.at(-1).transaction, paymentTransaction);
  const imported = await f.service.importLegacyDirection({ uid: "A", targetUid: "B", source: "solo", migrationId: "legacy-fallback-0001" });
  f.tick();
  await f.service.performAction("A", { action: "unblock", blockId: imported.blockId,
    expectedVersion: imported.version, requestId: "fallback-unblock-0001" });
  const callsBeforeCanonical = calls.length;
  assert.equal(await f.service.isBlocked("A", "B"), false);
  await f.service.assertAllowed("A", "B");
  assert.deepEqual(await f.service.filterVisible("A", [{ owner: "B" }], (row) => row.owner), [{ owner: "B" }]);
  f.tick();
  const newArgs = f.contact({ roomId: "after-migration", attemptId: "after-migration" });
  const newMetadata = await f.service.ensureContact(newArgs);
  assert.equal(await f.service.checkContact({ ...newArgs, ...newMetadata }), true);
  assert.equal(calls.length, callsBeforeCanonical, "a canonical unblock never rereads legacy blocks");
});

test("failed gate reflection stays pending and a durable retry completes without duplicate policy mutation", async () => {
  const f = fixture();
  f.hooks.failRealtime = 1;
  const result = await f.block("A", "B", "offline-block-0001");
  assert.equal(result.status, "pending");
  assert.equal(f.policy().revision, 1);
  assert.equal(f.gate(), null);
  const resumed = await f.service.performAction("A", { action: "get_operation", requestId: "offline-block-0001" });
  assert.equal(resumed.status, "complete");
  assert.equal(f.policy().revision, 1);
  assert.equal(f.gate().blocked, true);
});
