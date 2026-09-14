"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlayerSafetyStrategy } = require("../player-safety-strategy");
const { createPlayerSafetyService } = require("../player-safety");

const requested = process.env.RUN_PLAYER_SAFETY_EMULATOR_TESTS === "1";
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const roomId = (value) => value.repeat(20);
const player = (uid, commit = "a") => ({ uid, name: uid, clues: ["A", "B", "C"], weaknessCommit: commit.repeat(64), pursuitLine: "追撃" });

test("strategy safety transitions on real isolated Firebase emulators", {
  skip: requested ? false : "set RUN_PLAYER_SAFETY_EMULATOR_TESTS=1 and both loopback emulator hosts",
  timeout: 90_000,
}, async (t) => {
  for (const name of ["FIREBASE_DATABASE_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) {
    assert.match(process.env[name] || "", /^(127\.0\.0\.1|localhost):\d+$/, `${name} must point to loopback`);
  }
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore } = require("firebase-admin/firestore");
  const projectId = "demo-player-safety-strategy";
  const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const fs = require("node:fs");
  const path = require("node:path");
  const [databaseHost, databasePort] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(":");
  const rulesEnv = await initializeTestEnvironment({ projectId, database: {
    host: databaseHost, port: Number(databasePort), rules: fs.readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8"),
  } });
  t.after(() => rulesEnv.cleanup());
  const app = initializeApp({ projectId, databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}` }, `strategy-safety-${Date.now()}`);
  const realtime = getDatabase(app);
  const firestore = getFirestore(app);
  t.after(() => deleteApp(app));
  await realtime.ref().set(null);
  await firestore.recursiveDelete(firestore.collection("playerContactPolicies"));
  await firestore.recursiveDelete(firestore.collection("playerSafetyUsers"));
  await firestore.recursiveDelete(firestore.collection("playerSafetyOutbox"));
  await realtime.ref("online/config/playerSafetyEnabled").set(true);
  let at = Date.now();
  const safety = createPlayerSafetyService({
    firestore, realtime, HttpsError, now: () => at,
    resolveContext: async (_uid, data) => ({ uid: data.publicEntryId, name: data.publicEntryId, source: "card" }),
    closeContacts: async () => {},
  });
  const service = createPlayerSafetyStrategy({ realtime, HttpsError, playerSafety: safety, now: () => at });
  const queue = (uid, overrides = {}) => realtime.ref(`online/strategyQueue/${uid}`).set({
    uid, protocolVersion: 2, state: "waiting-v2", ratingPreference: "live_action", joinedAt: at - 1000, lastSeen: at, ...overrides,
  });
  const value = async (path) => (await realtime.ref(path).get()).val();
  const block = async (uid, target) => {
    const context = await safety.performAction(uid, { action: "get_context", publicEntryId: target });
    return safety.performAction(uid, { action: "block", contextId: context.contextId,
      expectedVersion: context.version, requestId: `real-strategy-${uid}-${target}` });
  };

  await t.test("remote queue transition and guest activation succeed on a cold transaction cache", async () => {
    await Promise.all([queue("A"), queue("B")]);
    const offer = await service.match("A", { roomId: roomId("X"), player: player("A") });
    assert.equal(offer.status, "hosted");
    assert.equal(await value("online/strategyQueue/A/state"), "offering-v2");
    const accepted = await service.accept("B", { roomId: offer.roomId, player: player("B", "b") });
    assert.equal(accepted.status, "active");
    assert.equal(await value(`online/strategyRooms/${offer.roomId}/players/B/weaknessCommit`), "b".repeat(64));
    assert.equal(await value("online/strategyQueue/A"), null);
    assert.equal(await value("online/strategyQueue/B"), null);
    const retry = await service.match("A", { roomId: roomId("W"), player: player("A", "c") });
    assert.equal(retry.status, "active");
    assert.equal(await value(`online/strategyRooms/${offer.roomId}/players/A/weaknessCommit`), "a".repeat(64));
  });

  await t.test("real block between offered and active denies acceptance", async () => {
    await Promise.all([queue("C"), queue("D")]);
    const offer = await service.match("C", { roomId: roomId("Y"), player: player("C") });
    assert.equal(offer.status, "hosted");
    assert.equal(offer.opponentUid, "D");
    await block("D", "C");
    await assert.rejects(service.accept("D", { roomId: offer.roomId, player: player("D") }), { code: "failed-precondition" });
    assert.equal(await value(`online/strategyRooms/${offer.roomId}/players/D`), null);
  });

  await t.test("remote offered-room expiry preserves a newer active reservation", async () => {
    await Promise.all([queue("E"), queue("F")]);
    const offer = await service.match("E", { roomId: roomId("Z"), player: player("E") });
    assert.equal(offer.status, "hosted");
    at += 30_000;
    await queue("E", { joinedAt: at, state: "offering-v2", roomId: roomId("Q") });
    await realtime.ref("online/strategyActive/E").set(roomId("Q"));
    const expired = await service.expire("E", { roomId: offer.roomId });
    assert.equal(expired.expired, true);
    assert.equal(await value(`online/strategyRooms/${offer.roomId}/status`), "expired");
    assert.equal(await value("online/strategyActive/E"), roomId("Q"));
    assert.equal(await value("online/strategyQueue/E/roomId"), roomId("Q"));
    assert.equal(await value(`online/strategyOffers/F/${offer.roomId}`), null);
  });
});
