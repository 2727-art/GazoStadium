"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlayerSafetyStrategy } = require("../player-safety-strategy");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const requested = process.env.RUN_STRATEGY_IDLE_SERVER_EMULATOR_TESTS === "1";
const ID = "S".repeat(20);
const OTHER = "T".repeat(20);
const player = (uid) => ({ uid, name: uid, clues: ["A", "B", "C"],
  weaknessCommits: ["a".repeat(63) + "0", "a".repeat(63) + "1", "a".repeat(63) + "2"],
  persona: { type: "koakuma", firstPerson: "atashi", callStyle: "chan" } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("strategy idle server transitions on isolated RTDB emulator", {
  skip: requested ? false : "set RUN_STRATEGY_IDLE_SERVER_EMULATOR_TESTS=1 with a loopback RTDB emulator",
  timeout: 120000,
}, async (t) => {
  assert.match(process.env.FIREBASE_DATABASE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):\d+$/);
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const projectId = "demo-strategy-idle-server";
  const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const fs = require("node:fs"); const path = require("node:path");
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(":");
  // Each demo namespace needs the real rules (including server query indices);
  // the CLI only initializes its configured default database namespace.
  const rulesEnvironment = await initializeTestEnvironment({ projectId, database: {
    host, port: Number(port), rules: fs.readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8"),
  } });
  t.after(() => rulesEnvironment.cleanup());
  const options = { projectId, databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}` };
  const firstApp = initializeApp(options, `strategy-idle-first-${Date.now()}`);
  const secondApp = initializeApp(options, `strategy-idle-second-${Date.now()}`);
  t.after(() => Promise.all([deleteApp(firstApp), deleteApp(secondApp)]));
  const realtime = getDatabase(firstApp); const peer = getDatabase(secondApp);
  let at = Date.now();
  const safety = { filterVisible: async (_uid, rows) => rows, checkContact: async () => true,
    activateContact: async () => true,
    ensureContact: async () => ({ safetyGrantId: "grant", safetyPairId: "pair", safetyVersion: 1 }),
    revokeContact: async () => {} };
  const create = (database = realtime) => createPlayerSafetyStrategy({ realtime: database, HttpsError, playerSafety: safety, now: () => at });
  const value = async (path) => (await realtime.ref(path).get()).val();
  const queue = (uid, overrides = {}) => realtime.ref(`online/strategyQueue/${uid}`).set({
    uid, protocolVersion: 3, state: "waiting-v3", joinedAt: at - 1000, lastSeen: at, ratingPreference: "both", ...overrides,
  });
  const reset = async () => { at = Date.now(); await realtime.ref("online").set(null); };
  const seed = async (overrides = {}) => {
    const room = { hostUid: "A", guestUid: "B", protocolVersion: 3, status: "active", createdAt: at - 1000,
      queueJoinedAt: { A: at - 2000, B: at - 2000 }, prestartDeadlineAt: at + 300000,
      safetyGrantId: "grant", safetyPairId: "pair", safetyVersion: 1, ...overrides };
    await realtime.ref("online").update({ [`strategyRooms/${ID}`]: room,
      [`strategyPrestartExpirations/${ID}`]: { hostUid: "A", guestUid: "B", safetyGrantId: "grant", expiresAt: room.prestartDeadlineAt },
      "strategyActive/A": ID, "strategyActive/B": ID });
    return room;
  };

  await t.test("cold-cache waiting cancellation releases only its original queue", async () => {
    await reset(); await queue("A");
    assert.equal((await create(peer).stopWaiting("A", { protocolVersion: 3, joinedAt: at - 1000 })).stopped, true);
    assert.equal(await value("online/strategyQueue/A"), null);
    assert.equal(await value("online/strategyActive/A"), null);
    await queue("A", { joinedAt: at });
    assert.equal((await create(peer).stopWaiting("A", { protocolVersion: 3, joinedAt: at - 1000 })).status, "resource-changed");
    assert.equal(await value("online/strategyQueue/A/joinedAt"), at);
  });

  await t.test("server stop guard excludes simultaneous matching by its owner and peer", async () => {
    await reset(); await Promise.all([queue("A"), queue("B")]);
    const paused = deferred(); const resume = deferred();
    const wrapped = { ref(path) {
      const reference = realtime.ref(path);
      if (path !== "online/strategyQueue/A") return reference;
      return { async transaction(callback) { paused.resolve(); await resume.promise; return reference.transaction(callback); } };
    } };
    const stopping = create(wrapped).stopWaiting("A", { protocolVersion: 3, joinedAt: at - 1000 });
    try {
      await Promise.race([paused.promise, stopping.then((result) => {
        throw new Error(`stop completed before guarded queue transaction: ${JSON.stringify(result)}`);
      })]);
      const guard = await value("online/strategyActive/A"); assert.match(guard, /^idle:/);
      assert.equal((await create(peer).match("A", { protocolVersion: 3, roomId: ID, player: player("A") })).status, "waiting");
      assert.equal((await create(peer).match("B", { protocolVersion: 3, roomId: OTHER, player: player("B") })).status, "waiting");
      assert.equal(await value("online/strategyActive/A"), guard);
    } finally { resume.resolve(); }
    assert.equal((await stopping).stopped, true);
  });

  await t.test("an offered or accepted peer reservation wins before search cancellation", async () => {
    await reset(); await Promise.all([queue("A"), queue("B")]);
    const service = create();
    await service.match("A", { protocolVersion: 3, roomId: ID, player: player("A") });
    assert.equal((await create(peer).stopWaiting("B", { protocolVersion: 3, joinedAt: at - 1000 })).status, "match-in-progress");
    await service.accept("B", { protocolVersion: 3, roomId: ID, player: player("B") });
    assert.equal(await value(`online/strategyRooms/${ID}/prestartDeadlineAt`), at + 300000);
    assert.equal(await value(`online/strategyPrestartExpirations/${ID}/expiresAt`), at + 300000);
    assert.equal((await create(peer).stopWaiting("A", { protocolVersion: 3, joinedAt: at - 1000 })).status, "match-in-progress");
  });

  await t.test("deadline expiry is idempotent and late cleanup preserves a newer match", async () => {
    await reset(); await seed(); at += 300000;
    await queue("A"); await realtime.ref("online/strategyActive/A").set(OTHER);
    const newerQueue = await value("online/strategyQueue/A");
    const service = create(peer);
    assert.equal((await service.expirePrestart("B", { protocolVersion: 3, roomId: ID })).expired, true);
    assert.equal(await value(`online/strategyRooms/${ID}/destroyed/reason`), "prestart-timeout");
    assert.equal(await value("online/strategyActive/A"), OTHER);
    assert.deepEqual(await value("online/strategyQueue/A"), newerQueue);
    assert.equal(await value("online/strategyActive/B"), null);
    assert.equal(await value(`online/strategyPrestartExpirations/${ID}`), null);
    assert.equal((await service.expirePrestart("A", { protocolVersion: 3, roomId: ID })).expired, true);
  });

  await t.test("scheduler drains only due indices and protects already started rooms", async () => {
    await reset(); await seed({ battleReady: { A: true, B: true } });
    assert.equal((await create().cleanup()).prestartExamined, 0);
    at += 300000;
    assert.equal((await create(peer).cleanup()).prestartExamined, 1);
    assert.equal(await value(`online/strategyRooms/${ID}/status`), "active");
    assert.equal(await value(`online/strategyRooms/${ID}/destroyed`), null);
    assert.equal(await value("online/strategyActive/A"), ID);
  });
});
