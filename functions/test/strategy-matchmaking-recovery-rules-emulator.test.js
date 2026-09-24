"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createStrategyMatchmakingRuntime } = require("./helpers/strategy-matchmaking-runtime");

const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const safeEmulator = /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("strategy reconnection and offer cleanup with deployed-equivalent RTDB rules", {
  skip: safeEmulator ? false : "requires a loopback Realtime Database Emulator",
  timeout: 45_000,
}, async (t) => {
  const projectId = "demo-strategy-recovery-regression";
  const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { ref, get, set, runTransaction, onDisconnect, onValue, goOffline, goOnline } = require("firebase/database");
  const { createPlayerSafetyService } = require("../player-safety");
  const { createPlayerSafetyStrategy } = require("../player-safety-strategy");
  const environment = await initializeTestEnvironment({
    projectId,
    database: { rules: fs.readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8") },
  });
  const adminApp = initializeApp({ projectId, databaseURL: `http://${emulatorHost}?ns=${projectId}` }, projectId);
  const realtime = getDatabase(adminApp);
  t.after(async () => { await environment.cleanup(); await deleteApp(adminApp); });
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const safety = createPlayerSafetyService({ realtime, HttpsError });
  const service = createPlayerSafetyStrategy({ realtime, HttpsError, playerSafety: safety });
  const database = environment.authenticatedContext("A").database();
  const waitUntil = async (predicate) => {
    const deadline = Date.now() + 6000;
    while (!await predicate()) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for a local Emulator transition");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const makeRuntime = () => createStrategyMatchmakingRuntime({ database, ref, get, runTransaction, onDisconnect, onValue });
  await realtime.ref().set({ online: { config: { playerSafetyEnabled: true } } });

  await t.test("two disconnections restore the complete queue and rearm onDisconnect each time", async () => {
    const f = makeRuntime();
    f.state.queueJoinedAt = Date.now();
    f.state.matchmakingConnected = false;
    f.state.matchScopeExpanded = true;
    f.context.requestSafety = async () => ({ status: "waiting" });
    const queueRef = realtime.ref("online/strategyQueue/A");
    f.context.watchStrategyMatchmakingConnection(f.state, 1);
    try {
      await waitUntil(async () => (await queueRef.get()).exists() && !f.state.queueRecoveryPromise);
      for (let iteration = 0; iteration < 2; iteration += 1) {
        goOffline(database);
        await waitUntil(async () => !(await queueRef.get()).exists() && !f.state.matchmakingConnected);
        goOnline(database);
        await waitUntil(async () => (await queueRef.get()).exists() && !f.state.queueRecoveryPromise);
        const queue = (await queueRef.get()).val();
        assert.equal(queue.uid, "A");
        assert.equal(queue.joinedAt, f.state.queueJoinedAt);
        assert.equal(queue.protocolVersion, 2);
        assert.equal(queue.state, "waiting-v2");
        assert.equal(queue.allowPreferenceMismatch, true);
        assert.ok(queue.lastSeen >= f.state.queueJoinedAt);
        assert.ok(f.state.queueDisconnect);
      }
      assert.deepEqual(f.errors, []);
    } finally {
      goOnline(database);
      await f.context.cleanupMatchmaking(false);
    }
    assert.equal((await queueRef.get()).exists(), false);
  });

  await t.test("an offering queue and a newer attempt retain their server-owned fields", async () => {
    const f = makeRuntime();
    f.state.queueJoinedAt = Date.now();
    const queue = { uid: "A", protocolVersion: 2, state: "offering-v2", ratingPreference: "both",
      joinedAt: f.state.queueJoinedAt, lastSeen: f.state.queueJoinedAt, roomId: "P".repeat(20) };
    await realtime.ref("online/strategyQueue/A").set(queue);
    try {
      assert.equal(await f.context.refreshStrategyMatchmakingQueue(f.state, 1), true);
      const retained = (await realtime.ref("online/strategyQueue/A").get()).val();
      assert.equal(retained.roomId, queue.roomId);
      assert.equal(retained.state, queue.state);
      const newer = { ...queue, joinedAt: queue.joinedAt + 1, roomId: "N".repeat(20) };
      await realtime.ref("online/strategyQueue/A").set(newer);
      assert.equal(await f.context.refreshStrategyMatchmakingQueue(f.state, 1), false);
      assert.deepEqual((await realtime.ref("online/strategyQueue/A").get()).val(), newer);
      await f.context.cleanupMatchmaking(false);
      assert.deepEqual((await realtime.ref("online/strategyQueue/A").get()).val(), newer);
    } finally {
      await f.context.cleanupMatchmaking(false);
      await realtime.ref("online/strategyQueue/A").remove();
    }
  });

  const seedOffer = async roomId => {
    const now = Date.now();
    await realtime.ref("online").update({
      [`strategyRooms/${roomId}`]: {
        hostUid: "A", guestUid: "B", createdAt: now, protocolVersion: 2, status: "offered",
        safetyPairId: "auditPair", safetyGrantId: roomId, safetyVersion: 0,
        members: { A: true, B: true }, players: { A: { uid: "A" } }, queueJoinedAt: { A: now, B: now },
      },
      "contactGates/auditPair": {
        initialized: true, blocked: false, version: 0, participants: { A: true, B: true },
        grants: { [roomId]: { roomId, mode: "strategy", firstUid: "A", secondUid: "B", active: false, createdAt: now, expiresAt: now + 120000 } },
      },
      "strategyActive/A": roomId,
      "strategyActive/B": roomId,
    });
  };

  for (const coalesced of [false, true]) {
    await t.test(coalesced ? "missing terminal snapshot reconciles once after grant removal" : "server expiry detaches status before its grant is revoked", async () => {
      const roomId = (coalesced ? "C" : "E").repeat(20);
      await seedOffer(roomId);
      let observed = false;
      let expireCalls = 0;
      const f = makeRuntime();
      f.context.onValue = (target, callback, onError) => onValue(target, snapshot => { observed = true; callback(snapshot); }, onError);
      f.context.requestSafety = async (action, data) => {
        assert.equal(action, "strategy_expire");
        expireCalls += 1;
        return service.expire("A", data);
      };
      f.state.pendingOffer = { roomId };
      f.context.watchStrategyOffer(roomId, f.state, 1);
      try {
        await waitUntil(() => observed);
        if (coalesced) {
          await realtime.ref("online").update({ [`strategyRooms/${roomId}/status`]: "expired", [`contactGates/auditPair/grants/${roomId}`]: null });
        } else {
          await service.expire("A", { roomId });
        }
        await waitUntil(() => f.state.pendingOffer === null);
        assert.equal(f.state.hostOfferWatch, null);
        assert.equal(f.intervals.size, 0);
        assert.equal(f.timeouts.size, 0);
        assert.deepEqual(f.errors, []);
        assert.ok(expireCalls <= 1, "one revoke must not create a callable retry loop");
        assert.equal((await realtime.ref(`online/contactGates/auditPair/grants/${roomId}`).get()).exists(), false);
        await assert.rejects(get(ref(database, `online/strategyRooms/${roomId}/status`)), /[Pp]ermission/);
      } finally { await f.context.cleanupMatchmaking(false); }
    });
  }
});
