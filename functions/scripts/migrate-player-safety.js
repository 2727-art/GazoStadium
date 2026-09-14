"use strict";

// Run after the safety-aware backend is deployed, before enabling its public UI.
// Default is read-only. No user names, UIDs, tokens or room contents are logged.
// node scripts/migrate-player-safety.js --project gazostadium [--apply]
const { createPlayerSafetyService } = require("../player-safety");
const { fleaPublicSellerId } = require("../anju-pay-flea");
const { activeV2EntryIsFresh } = require("../solo-session-v2");

const MIGRATION_ID = "global-player-block-v1";
const UID = /^[A-Za-z0-9_-]{1,128}$/;
const META_KEYS = ["safetyPairId", "safetyVersion", "safetyGrantId"];
const MARKET_TERMINAL = new Set(["sold", "ended", "canceled"]);

async function withDeadline(promise, stage, timeoutMs = 30_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Migration read timed out at ${stage}.`);
        error.code = "deadline-exceeded";
        error.stage = stage;
        reject(error);
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function validPair(uid, targetUid) {
  return UID.test(String(uid || "")) && UID.test(String(targetUid || "")) && uid !== targetUid;
}

function legacyDirections(path, data) {
  const parts = String(path).split("/");
  const directions = [];
  const add = (uid, targetUid, source) => {
    if (validPair(uid, targetUid)) directions.push({ uid, targetUid, source,
      name: String(data.displayName || data.name || "").slice(0, 40) });
  };
  if (parts.length === 4 && parts[0] === "freeTableBlocks" && parts[2] === "users") {
    if (!data.ownerUid || data.ownerUid === parts[1]) add(parts[1], data.targetUid, "free_table");
  } else if (parts.length === 4 && parts[0] === "valueMarketShopBlocks" && parts[2] === "users") {
    if ((!data.ownerUid || data.ownerUid === parts[1]) && (!data.blockedUid || data.blockedUid === parts[3])) {
      add(parts[1], data.blockedUid || parts[3], "market");
    }
  } else if (parts.length === 4 && parts[0] === "soloFamiliarBlocks" && parts[2] === "blockEntries") {
    if (!data.ownerUid || data.ownerUid === parts[1]) add(parts[1], data.targetUid, "solo");
  } else if (parts.length === 2 && ["freeTableBlockPairs", "soloFamiliarBlockPairs"].includes(parts[0])) {
    const participants = data.participants;
    if (Array.isArray(participants) && participants.length === 2 && validPair(...participants)) {
      for (const uid of participants) {
        if (data.blockedBy?.[uid] === true) add(uid, participants.find((other) => other !== uid),
          parts[0] === "freeTableBlockPairs" ? "free_table" : "solo");
      }
    }
  }
  return directions;
}

function hasSafetyMetadata(room) {
  return META_KEYS.some((key) => Object.hasOwn(room || {}, key));
}

function contactDescriptor(mode, roomId, room) {
  if (!room || hasSafetyMetadata(room)) return null;
  let firstUid; let secondUid; let active;
  if (mode === "market") {
    firstUid = room.sellerUid; secondUid = room.buyerUid;
    active = Boolean(room.status) && !MARKET_TERMINAL.has(room.status)
      && room.participants?.[firstUid] === true && room.participants?.[secondUid] === true;
  } else if (mode === "free_table") {
    firstUid = room.hostUid; secondUid = room.visitorUid;
    active = ["connecting", "active"].includes(room.status)
      && room.participants?.[firstUid] === true && room.participants?.[secondUid] === true;
  } else {
    firstUid = room.hostUid; secondUid = room.guestUid;
    active = ["offered", "active"].includes(room.status) && !room.destroyed
      && room.members?.[firstUid] === true && room.members?.[secondUid] === true;
  }
  const startedAt = Number(room.createdAt || 0);
  if (!active || !validPair(firstUid, secondUid) || !Number.isSafeInteger(startedAt) || startedAt <= 0) return null;
  return { firstUid, secondUid, mode, roomId,
    attemptId: ["solo", "strategy"].includes(mode) ? String(room.attemptId || roomId) : roomId,
    startedAt, active: false };
}

function sameContact(first, second) {
  return first && second && ["firstUid", "secondUid", "mode", "roomId", "attemptId", "startedAt"]
    .every((key) => first[key] === second[key]);
}

function favoriteOwnerPatch(favorite, listingId, listing) {
  if (!listing || !UID.test(String(listing.sellerUid || ""))
      || listing.publicSellerId !== favorite.publicSellerId
      || fleaPublicSellerId(listing.sellerUid) !== favorite.publicSellerId
      || (favorite.sellerUid && favorite.sellerUid !== listing.sellerUid)) return null;
  return { sellerUid: listing.sellerUid, sourceListingId: listingId };
}

async function* documents(query, documentIdField, pageSize = 250) {
  let cursor;
  while (true) {
    let page = query.orderBy(documentIdField).limit(pageSize);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await withDeadline(page.get(), "firestore-page");
    for (const document of snapshot.docs) yield document;
    if (snapshot.docs.length < pageSize) return;
    cursor = snapshot.docs.at(-1);
  }
}

async function migrate({ firestore, realtime, safety, documentIdField = "__name__", apply = false, phase = "all", onProgress = () => {}, now = Date.now }) {
  const report = { migrationId: MIGRATION_ID, apply, phase,
    legacy: { scanned: 0, directions: 0, planned: 0, imported: 0, preserved: 0, namesResolved: 0, namesUnavailable: 0 },
    favorites: { scanned: 0, planned: 0, backfilled: 0, unresolved: 0 },
    live: { scanned: 0, planned: 0, bound: 0, existing: 0, repaired: 0, denied: 0, invalid: 0, raced: 0 } };
  const run = (name) => phase === "all" || phase === name;
  const plannedBlockedPairs = new Set();
  if (run("legacy")) {
    onProgress({ stage: "legacy-begin" });
    const unique = new Map();
    const queries = [firestore.collectionGroup("users"), firestore.collectionGroup("blockEntries"),
      firestore.collection("freeTableBlockPairs"), firestore.collection("soloFamiliarBlockPairs")];
    for (const query of queries) {
      for await (const document of documents(query, documentIdField)) {
        report.legacy.scanned += 1;
        for (const direction of legacyDirections(document.ref.path, document.data())) {
          const key = JSON.stringify([direction.uid, direction.targetUid]);
          if (!unique.has(key) || (!unique.get(key).name && direction.name)) unique.set(key, direction);
        }
      }
      onProgress({ stage: "legacy-source-read", scanned: report.legacy.scanned });
    }
    report.legacy.directions = unique.size;
    const nameCache = new Map();
    for (const direction of unique.values()) {
      const policy = await withDeadline(safety.getPolicy(direction.uid, direction.targetUid), "legacy-policy");
      if (Object.hasOwn(policy.ownVersions || {}, direction.uid) || Object.hasOwn(policy.blockedBy || {}, direction.uid)) {
        report.legacy.preserved += 1;
        continue;
      }
      report.legacy.planned += 1;
      plannedBlockedPairs.add(JSON.stringify([direction.uid, direction.targetUid].sort()));
      if (!direction.name) {
        if (!nameCache.has(direction.targetUid)) {
          const stats = await withDeadline(firestore.collection("valueMarketStats").doc(direction.targetUid).get(), "legacy-display-name");
          let displayName = typeof stats.get("name") === "string" ? stats.get("name") : "";
          for (const source of ["profiles", "strategyProfiles"]) {
            if (displayName.trim()) break;
            const snapshot = await withDeadline(realtime.ref(`online/${source}/${direction.targetUid}/name`).get(), "legacy-display-name");
            displayName = typeof snapshot.val() === "string" ? snapshot.val() : "";
          }
          nameCache.set(direction.targetUid, displayName.replace(/[\r\n\u0000-\u001f]/g, " ").trim().slice(0, 40));
        }
        direction.name = nameCache.get(direction.targetUid);
        if (direction.name) report.legacy.namesResolved += 1;
        else report.legacy.namesUnavailable += 1;
      }
      if (apply) {
        const result = await safety.importLegacyDirection({ ...direction, migrationId: MIGRATION_ID });
        if (result.imported) report.legacy.imported += 1;
        else report.legacy.preserved += 1;
      }
    }
    onProgress({ stage: "legacy-end", ...report.legacy });
  }
  if (run("owners")) {
    onProgress({ stage: "owners-begin" });
    const ownerCache = new Map();
    for await (const document of documents(firestore.collectionGroup("sellers"), documentIdField)) {
      if (!/^anjuPayFleaFavorites\/[^/]+\/sellers\/[^/]+$/.test(document.ref.path)) continue;
      report.favorites.scanned += 1;
      const favorite = { ...document.data(), publicSellerId: document.id };
      if (favorite.sellerUid && favorite.sourceListingId) continue;
      if (!ownerCache.has(document.id)) {
        const listing = await withDeadline(firestore.collection("anjuPayFleaListings")
          .where("publicSellerId", "==", document.id).limit(1).get(), "favorite-owner");
        ownerCache.set(document.id, listing.docs[0] || null);
      }
      const listing = ownerCache.get(document.id);
      const patch = listing ? favoriteOwnerPatch(favorite, listing.id, listing.data()) : null;
      if (!patch) { report.favorites.unresolved += 1; continue; }
      report.favorites.planned += 1;
      if (apply) {
        const changed = await firestore.runTransaction(async (transaction) => {
          const [current, source] = await Promise.all([transaction.get(document.ref), transaction.get(listing.ref)]);
          if (!current.exists) return false;
          const next = favoriteOwnerPatch({ ...current.data(), publicSellerId: current.id }, source.id, source.data());
          if (!next || (current.get("sellerUid") && current.get("sourceListingId"))) return false;
          transaction.update(document.ref, next);
          return true;
        });
        if (changed) report.favorites.backfilled += 1;
      }
    }
    onProgress({ stage: "owners-end", ...report.favorites });
  }
  if (run("live")) {
    onProgress({ stage: "live-begin" });
    async function repairMirror(mode, roomId, room, contact, metadata) {
      const compatibleMetadata = (value) => !hasSafetyMetadata(value)
        || META_KEYS.every((key) => !Object.hasOwn(value, key) || value[key] === metadata[key]);
      if (mode === "market") {
        await realtime.ref(`online/valueMarketRooms/${roomId}`).transaction((current) => {
          if (current === null) return null;
          if (!current || current.members?.[contact.firstUid] !== true || current.members?.[contact.secondUid] !== true
              || !compatibleMetadata(current)) return undefined;
          return { ...current, sellerUid: contact.firstUid, buyerUid: contact.secondUid, ...metadata };
        });
      } else if (mode === "free_table" && room.roomId) {
        await realtime.ref(`freeTables/roomStates/${room.roomId}`).transaction((current) => {
          if (current === null) return null;
          if (current?.session?.sessionId !== roomId || !compatibleMetadata(current.session)) return undefined;
          return { ...current, session: { ...current.session, ...metadata } };
        });
      }
    }
    async function bind(mode, roomId, room, reference, isFirestore = false, validatePointers = async () => true) {
      report.live.scanned += 1;
      if (hasSafetyMetadata(room)) {
        report.live.existing += 1;
        const original = { ...room };
        for (const key of META_KEYS) delete original[key];
        const contact = contactDescriptor(mode, roomId, original);
        if (!contact || !META_KEYS.every((key) => Object.hasOwn(room, key))) { report.live.invalid += 1; return; }
        if (!await validatePointers(contact)) { report.live.raced += 1; return; }
        const metadata = Object.fromEntries(META_KEYS.map((key) => [key, room[key]]));
        // A retry may finish an issued grant and its mirror. A revoked or
        // expired grant is never replaced with a freshly issued one.
        if (!await withDeadline(safety.checkContact({ ...contact, ...metadata }), "existing-contact")) { report.live.denied += 1; return; }
        if (apply && await safety.activateContact({ ...contact, ...metadata })) {
          await repairMirror(mode, roomId, room, contact, metadata);
          report.live.repaired += 1;
        }
        return;
      }
      const contact = contactDescriptor(mode, roomId, room);
      if (!contact) { report.live.invalid += 1; return; }
      if (!await validatePointers(contact)) { report.live.raced += 1; return; }
      const policy = await withDeadline(safety.getPolicy(contact.firstUid, contact.secondUid), "live-policy");
      if (plannedBlockedPairs.has(JSON.stringify([contact.firstUid, contact.secondUid].sort()))
          || Object.values(policy.blockedBy || {}).some((value) => value === true)
          || Number(policy.lastBlockedAt || 0) >= contact.startedAt) {
        report.live.denied += 1; return;
      }
      report.live.planned += 1;
      if (!apply) return;
      const metadata = await safety.ensureContact(contact);
      let bound = false;
      try {
        if (!await validatePointers(contact)) { report.live.raced += 1; return; }
        if (isFirestore) {
          bound = await firestore.runTransaction(async (transaction) => {
            const current = (await transaction.get(reference)).data();
            if (!sameContact(contact, contactDescriptor(mode, roomId, current))
                || !await safety.checkContact({ ...contact, ...metadata }, transaction)) return false;
            transaction.update(reference, metadata);
            return true;
          });
        } else {
          const result = await reference.transaction((current) => {
            if (current === null) return null;
            return sameContact(contact, contactDescriptor(mode, roomId, current)) ? { ...current, ...metadata } : undefined;
          });
          bound = result.committed === true && result.snapshot.val()?.safetyGrantId === metadata.safetyGrantId;
        }
        if (!bound) { report.live.raced += 1; return; }
        if (!await validatePointers(contact)) {
          await safety.revokeContact({ roomId, ...metadata });
          report.live.raced += 1; return;
        }
        if (!await safety.activateContact({ ...contact, ...metadata })) { report.live.denied += 1; return; }
        await repairMirror(mode, roomId, room, contact, metadata);
        report.live.bound += 1;
      } finally {
        // A persisted room may have committed despite a lost response. Keep its
        // grant; otherwise do not accumulate speculative active reservations.
        if (!bound) {
          const current = await reference.get();
          const value = isFirestore ? current.data() : current.val();
          if (value?.safetyGrantId !== metadata.safetyGrantId) await safety.revokeContact({ roomId, ...metadata });
        }
      }
    }
    const discovered = new Map();
    const addPointer = (mode, roomId, uid, path, field, isFirestore = false, v2 = false) => {
      if (!UID.test(String(roomId || "")) || !UID.test(String(uid || ""))) return;
      const key = `${mode}:${roomId}`;
      if (!discovered.has(key)) discovered.set(key, { mode, roomId, pointers: [] });
      discovered.get(key).pointers.push({ uid, path, field, isFirestore, v2 });
    };
    // Historical rooms often retain status=active after completion. Discover
    // candidates only through their current participant indexes, never roots.
    for (const [mode, path, shape] of [
      ["solo", "online/activeV2", "sessions"], ["solo", "online/active", "string"],
      ["strategy", "online/strategyActive", "string"], ["free_table", "freeTables/active", "sessionId"],
    ]) {
      onProgress({ stage: "live-index-reading", mode, index: path });
      const snapshot = await withDeadline(realtime.ref(path).get(), `live-index-${mode}`);
      onProgress({ stage: "live-index-read", mode, records: Object.keys(snapshot.val() || {}).length });
      for (const [uid, entry] of Object.entries(snapshot.val() || {})) {
        if (shape === "sessions") {
          const freshEntries = Object.entries(entry || {}).filter(([sessionId, value]) => UID.test(sessionId)
            && Number(value?.expiresAt || 0) > now());
          if (!freshEntries.length) continue;
          const claim = (await withDeadline(realtime.ref(`online/soloSessionClaims/${uid}`).get(), "live-session-claim")).val();
          for (const [sessionId, value] of freshEntries) {
            if (activeV2EntryIsFresh(uid, value, claim, now())) {
              addPointer(mode, value.roomId, uid, `${path}/${uid}/${sessionId}`, "roomId", false, true);
            }
          }
        } else addPointer(mode, shape === "string" ? entry : entry?.sessionId, uid, `${path}/${uid}`,
          shape === "string" ? "" : "sessionId");
      }
    }
    for await (const document of documents(firestore.collection("valueMarketActive"), documentIdField)) {
      addPointer("market", document.get("roomId"), document.id, document.ref.path, "roomId", true);
    }
    onProgress({ stage: "live-current-rooms", records: discovered.size });
    for (const { mode, roomId, pointers } of discovered.values()) {
      const isFirestore = mode === "market";
      const roomPath = { solo: "online/rooms", strategy: "online/strategyRooms", free_table: "freeTables/sessions" }[mode];
      const reference = isFirestore ? firestore.collection("valueMarketRooms").doc(roomId) : realtime.ref(`${roomPath}/${roomId}`);
      const snapshot = await withDeadline(reference.get(), `live-room-${mode}`);
      const room = isFirestore ? snapshot.data() : snapshot.val();
      const validatePointers = async (contact) => {
        const current = await Promise.all(pointers.map(async (pointer) => {
          const reference = pointer.isFirestore
            ? firestore.collection("valueMarketActive").doc(pointer.uid) : realtime.ref(pointer.path);
          const snapshot = await withDeadline(reference.get(), `live-pointer-${mode}`);
          const value = pointer.isFirestore ? snapshot.data() : snapshot.val();
          if (pointer.v2) {
            const claim = (await withDeadline(realtime.ref(`online/soloSessionClaims/${pointer.uid}`).get(), "live-session-claim")).val();
            if (!activeV2EntryIsFresh(pointer.uid, value, claim, now())) return null;
          }
          const matches = (pointer.field ? value?.[pointer.field] : value) === roomId;
          return matches && (!value?.uid || value.uid === pointer.uid)
            && (!value?.attemptId || !room?.attemptId || value.attemptId === room.attemptId) ? pointer.uid : null;
        }));
        return [contact.firstUid, contact.secondUid].every((uid) => current.includes(uid));
      };
      await bind(mode, roomId, room, reference, isFirestore, validatePointers);
    }
    onProgress({ stage: "live-end", ...report.live });
  }
  return report;
}

function parseArguments(argv) {
  const result = { apply: false, phase: "all", project: "", databaseURL: "", rtdbRest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") result.apply = true;
    else if (option === "--rtdb-rest") result.rtdbRest = true;
    else if (["--project", "--database-url", "--phase"].includes(option)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing ${option} value.`);
      result[{ "--project": "project", "--database-url": "databaseURL", "--phase": "phase" }[option]] = value;
    } else throw new Error(`Unknown argument: ${option}`);
  }
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(result.project)) throw new Error("An explicit --project is required.");
  if (!["all", "legacy", "owners", "live"].includes(result.phase)) throw new Error("Invalid --phase.");
  if (!result.databaseURL) {
    if (result.project === "gazostadium") result.databaseURL = "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app";
    else if (result.project.startsWith("demo-") && process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      result.databaseURL = `https://${result.project}-default-rtdb.firebaseio.com`;
    } else throw new Error("Provide --database-url for this project.");
  }
  const url = new URL(result.databaseURL);
  if (url.protocol !== "https:" || !url.hostname.startsWith(`${result.project}-default-rtdb.`)) {
    throw new Error("Database URL must belong to the explicitly selected project.");
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore, FieldPath } = require("firebase-admin/firestore");
  const { getDatabase } = require("firebase-admin/database");
  const { HttpsError } = require("firebase-functions/v2/https");
  let credential;
  let cliFirestore;
  if (process.env.FIREBASE_TOOLS_AUTH_MODULE) {
    const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
    if (!require("node:path").isAbsolute(authModule)) throw new Error("Firebase CLI auth module must use an absolute path.");
    const auth = require(authModule);
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI has no authenticated default account.");
    const api = require(require("node:path").join(require("node:path").dirname(authModule), "api.js"));
    const { Firestore } = require("@google-cloud/firestore");
    cliFirestore = new Firestore({ projectId: options.project, credentials: {
      type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(),
      refresh_token: account.tokens.refresh_token,
    } });
    const { UserRefreshClient } = require("google-auth-library");
    const authClient = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
    // Fail before starting the RTDB reconnect loop if the saved login expired.
    await withDeadline(authClient.getAccessToken(), "cli-access-token");
    credential = { async getAccessToken() {
      const token = await authClient.getAccessToken();
      if (!token.token) throw new Error("Firebase CLI login could not provide an access token.");
      return { access_token: token.token, expires_in: 3600 };
    } };
  } else credential = applicationDefault();
  const app = initializeApp({ projectId: options.project, databaseURL: options.databaseURL, credential }, "player-safety-migration");
  try {
    const firestore = cliFirestore || getFirestore(app);
    const realtime = options.rtdbRest
      ? require("./player-safety-rtdb-rest").createMigrationRealtimeRest({ databaseURL: options.databaseURL,
        getAccessToken: () => credential.getAccessToken() })
      : getDatabase(app);
    const safety = createPlayerSafetyService({ firestore, realtime, HttpsError,
      resolveContext: async () => null, resolvePublicOwner: async () => null,
      closeContacts: async () => { throw new Error("Migration closure must be completed by the deployed runtime outbox."); } });
    const report = await migrate({ ...options, firestore, realtime, safety, documentIdField: FieldPath.documentId(),
      onProgress: (progress) => process.stderr.write(`${JSON.stringify(progress)}\n`) });
    process.stdout.write(`${JSON.stringify({ project: options.project, ...report }, null, 2)}\n`);
    return report;
  } finally {
    if (cliFirestore) await cliFirestore.terminate();
    await deleteApp(app);
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Player safety migration failed (${String(error.code || error.name || "error")}, stage=${String(error.stage || "setup")}). No public flag was changed.\n`);
  process.exitCode = 1;
});

module.exports = { migrate, parseArguments, legacyDirections, contactDescriptor, sameContact,
  favoriteOwnerPatch, hasSafetyMetadata, main, MIGRATION_ID };
