"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createPlayerSafetyService, pairIdFor } = require("../player-safety");

const requested = process.env.RUN_PLAYER_SAFETY_EMULATOR_TESTS === "1";
function loopback(value) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value || "")) throw new Error("Safety tests require a loopback emulator host");
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
}
const projectId = process.env.PLAYER_SAFETY_TEST_PROJECT_ID || "demo-player-safety";
if (requested && !/^demo-[a-z0-9-]+$/.test(projectId)) throw new Error("Safety tests require an explicit demo project");

test("shared safety Rules and services on isolated Firestore/RTDB emulators", {
  skip: requested ? false : "set RUN_PLAYER_SAFETY_EMULATOR_TESTS=1 and both loopback emulator hosts",
}, async (t) => {
  const databaseTarget = loopback(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
  const firestoreTarget = loopback(process.env.FIRESTORE_EMULATOR_HOST);
  const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
  const { ref, get, set, update } = require("firebase/database");
  const { doc, getDoc, setDoc } = require("firebase/firestore");
  const root = path.resolve(__dirname, "../..");
  const env = await initializeTestEnvironment({ projectId,
    database: { ...databaseTarget, rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8") },
    firestore: { ...firestoreTarget, rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8") },
  });
  t.after(() => env.cleanup());
  const user = env.authenticatedContext("A");
  const other = env.authenticatedContext("B");
  const stranger = env.authenticatedContext("C");
  const pairId = pairIdFor("A", "B");
  const roomId = "r".repeat(24);
  let at;
  async function seed(mode, version = 1) {
    await env.clearDatabase();
    at = Date.now();
    const kind = { solo: "rooms", strategy: "strategyRooms", market: "valueMarketRooms" }[mode];
    const roomPath = mode === "free_table" ? `freeTables/sessions/${roomId}` : `online/${kind}/${roomId}`;
    const metadata = { safetyPairId: pairId, safetyVersion: version, safetyGrantId: `grant-${mode}` };
    const room = { hostUid: "A", guestUid: "B", sellerUid: "A", buyerUid: "B", visitorUid: "B",
      members: { A: true, B: true }, participants: { A: true, B: true },
      roles: { A: "seller", B: "buyer" }, names: { A: "A", B: "B" },
      status: mode === "market" ? "pitch" : "active", turn: 1, protocolVersion: 1, createdAt: at, expiresAt: at + 3600000, ...metadata };
    await env.withSecurityRulesDisabled(async (admin) => {
      await update(ref(admin.database()), {
        "online/config/playerSafetyEnabled": true,
        [roomPath]: room,
        [`online/contactGates/${pairId}`]: { initialized: true, blocked: false, version,
          participants: { A: true, B: true }, grants: { [metadata.safetyGrantId]: {
            firstUid: "A", secondUid: "B", mode, roomId, attemptId: "attempt", active: true,
            createdAt: at, startedAt: at, expiresAt: at + 120000,
          } } },
        "freeTables/active/A": { sessionId: roomId, expiresAt: at + 3600000 },
        "freeTables/active/B": { sessionId: roomId, expiresAt: at + 3600000 },
      });
    });
    return { roomPath, metadata };
  }
  const gateUpdate = (patch) => env.withSecurityRulesDisabled((admin) => update(ref(admin.database(), `online/contactGates/${pairId}`), patch));

  await t.test("all four room surfaces enforce membership, current grant, block and revision", async () => {
    for (const mode of ["solo", "strategy", "market", "free_table"]) {
      const { roomPath, metadata } = await seed(mode);
      await assertSucceeds(get(ref(user.database(), roomPath)));
      await assertSucceeds(get(ref(other.database(), roomPath)));
      await assertFails(get(ref(stranger.database(), roomPath)));
      await assertFails(get(ref(user.database(), "online/contactGates")));
      await assertFails(set(ref(user.database(), `${roomPath}/safetyVersion`), 999));
      await gateUpdate({ blocked: true });
      await assertFails(get(ref(user.database(), roomPath)));
      await gateUpdate({ blocked: false, version: 2 });
      await assertFails(get(ref(user.database(), roomPath)));
      await gateUpdate({ version: 1, grants: {} });
      await assertFails(get(ref(user.database(), roomPath)));
      await gateUpdate({ grants: { [metadata.safetyGrantId]: {
        firstUid: "A", secondUid: "C", roomId, mode, active: true,
      } } });
      await assertFails(get(ref(user.database(), roomPath)), "a different opponent cannot borrow the grant");
    }
  });

  await t.test("chat and signaling reject post-block writes through every transport", async () => {
    for (const mode of ["solo", "strategy", "market", "free_table"]) {
      const { roomPath } = await seed(mode);
      let chatPath; let message;
      if (mode === "free_table") {
        chatPath = `freeTables/chat/${roomId}/${"C".repeat(20)}0000`;
        message = { authorUid: "A", authorRole: "host", type: "text", text: "hello", createdAt: at, expiresAt: at + 60000 };
      } else if (mode === "strategy") {
        chatPath = `online/strategyChats/${roomId}/chat-one`;
        message = { authorUid: "A", text: "hello", phase: "scout", round: 1, createdAt: at };
      } else if (mode === "market") {
        chatPath = `${roomPath}/chat/chat-one`;
        message = { uid: "A", name: "A", text: "hello", turn: 1, createdAt: at };
      } else {
        chatPath = `${roomPath}/chat/chat-one`;
        message = { authorUid: "A", name: "A", text: "hello", round: 1, createdAt: at };
      }
      await assertSucceeds(set(ref(user.database(), chatPath), message));
      const signalPath = mode === "free_table" ? `freeTables/signals/${roomId}/B/${"S".repeat(22)}00`
        : `${roomPath}/signals/B/signal-one`;
      const signal = { fromUid: "A", type: "offer", payload: "test", createdAt: at,
        ...(mode === "free_table" ? { toUid: "B", expiresAt: at + 60000 } : {}) };
      await assertSucceeds(set(ref(user.database(), signalPath), signal));
      await gateUpdate({ blocked: true });
      const secondPath = mode === "free_table" ? chatPath.slice(0, -1) + "1" : chatPath + "-two";
      await assertFails(set(ref(user.database(), secondPath), message));
      const nextSignalPath = mode === "free_table" ? signalPath.slice(0, -1) + "1" : signalPath + "-two";
      await assertFails(set(ref(user.database(), nextSignalPath), signal));
    }
  });

  await t.test("pending expiry denies reads while active long contacts survive their initial expiry", async () => {
    const { roomPath, metadata } = await seed("solo");
    await gateUpdate({ [`grants/${metadata.safetyGrantId}/active`]: false,
      [`grants/${metadata.safetyGrantId}/expiresAt`]: at - 1 });
    await assertFails(get(ref(user.database(), roomPath)));
    await gateUpdate({ [`grants/${metadata.safetyGrantId}/active`]: true });
    await assertSucceeds(get(ref(user.database(), roomPath)));
  });

  await t.test("legacy room reads and strategy creates remain compatible only before activation", async () => {
    const { roomPath } = await seed("solo");
    await env.withSecurityRulesDisabled((admin) => update(ref(admin.database()), {
      "online/config/playerSafetyEnabled": false, [`${roomPath}/safetyGrantId`]: null,
    }));
    await assertSucceeds(get(ref(user.database(), roomPath)));
    await assertSucceeds(set(ref(user.database(), "online/strategyRooms/legacy-create/hostUid"), "A"));
    await env.withSecurityRulesDisabled((admin) => set(ref(admin.database(), "online/config/playerSafetyEnabled"), true));
    await assertFails(get(ref(user.database(), roomPath)));
    await assertFails(set(ref(user.database(), "online/strategyRooms/another-create/hostUid"), "A"));
    await assertFails(get(ref(user.database(), "online/strategyQueue")));
    await assertSucceeds(get(ref(user.database(), "online/strategyQueue/A")));
    await assertFails(get(ref(user.database(), "online/strategyQueue/B")));
  });

  await t.test("post-block finalized claims still submit once and remain immutable", async () => {
    for (const mode of ["solo", "strategy"]) {
      const { roomPath } = await seed(mode);
      await gateUpdate({ blocked: true });
      const result = { [`${roomPath}/resultClaims/A`]: { outcome: "draw", createdAt: at }, [`${roomPath}/finished/A`]: true };
      await assertSucceeds(update(ref(user.database()), result));
      await assertFails(update(ref(user.database()), result));
      await assertFails(set(ref(user.database(), `${roomPath}/finished/B`), true));
    }
  });

  await t.test("legacy comments and all canonical private data are inaccessible directly", async () => {
    await seed("solo");
    await env.withSecurityRulesDisabled(async (admin) => {
      await update(ref(admin.database()), {
        "online/leaderboard/target": { name: "B", commentsEnabled: true },
        "online/leaderboardComments/target/author": { text: "private comment" },
      });
    });
    await assertFails(get(ref(user.database(), "online/leaderboardComments/target")));
    for (const location of ["playerContactPolicies/pair", "playerSafetyUsers/A", "playerSafetyUsers/A/blocks/block",
      "playerSafetyUsers/A/contexts/context", "playerSafetyOutbox/job", "playerSafetyComments/target/entries/author",
      "danwakuPublicEntryOwners/entry"]) {
      await env.withSecurityRulesDisabled((admin) => setDoc(doc(admin.firestore(), location), { secret: "B" }));
      await assertFails(getDoc(doc(user.firestore(), location)));
      await assertFails(setDoc(doc(user.firestore(), location), { secret: "C" }));
    }
    await assertSucceeds(get(ref(user.database(), "online/playerSafetyEvents/A")));
    await assertFails(get(ref(other.database(), "online/playerSafetyEvents/A")));
  });

  await t.test("real service transactions preserve directional intent and gate epochs", async () => {
    const { initializeApp, deleteApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const { getDatabase } = require("firebase-admin/database");
    const app = initializeApp({ projectId, databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}-core` }, `safety-core-${Date.now()}`);
    t.after(() => deleteApp(app));
    const firestore = getFirestore(app); const realtime = getDatabase(app);
    const a = "core-A"; const b = "core-B";
    await firestore.recursiveDelete(firestore.collection("playerContactPolicies"));
    await firestore.recursiveDelete(firestore.collection("playerSafetyUsers"));
    await firestore.recursiveDelete(firestore.collection("playerSafetyOutbox"));
    await realtime.ref().set(null);
    await realtime.ref("online/config/playerSafetyEnabled").set(true);
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const service = createPlayerSafetyService({ firestore, realtime, HttpsError,
      resolveContext: async (uid) => ({ uid: uid === a ? b : a, name: "peer", source: "solo" }),
      resolvePublicOwner: async () => null });
    const contexts = await Promise.all([a, b].map((uid) => service.performAction(uid, { action: "get_context" })));
    const args = { firstUid: a, secondUid: b, mode: "market", roomId: "real-room", attemptId: "real-attempt", startedAt: Date.now() };
    const metadata = await service.ensureContact(args);
    await Promise.all([a, b].map((uid, index) => service.performAction(uid, {
      action: "block", contextId: contexts[index].contextId, expectedVersion: 0, requestId: `real-block-${uid}`,
    })));
    assert.equal((await service.getPolicy(a, b)).revision, 2);
    assert.equal(await service.checkContact({ ...args, ...metadata }), false);
    await assert.rejects(service.assertAllowed(a, b), { code: "failed-precondition" });
    const replay = await service.performAction(a, { action: "block", contextId: contexts[0].contextId, expectedVersion: 0, requestId: `real-block-${a}` });
    assert.equal(replay.blocked, true);
    assert.equal((await service.getPolicy(a, b)).revision, 2);
  });
});
