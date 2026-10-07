"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlayerSafetyStrategy } = require("../player-safety-strategy");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const ID = "R".repeat(20);
const OTHER = "N".repeat(20);
const player = (uid) => ({ uid, name: uid, clues: ["A", "B", "C"],
  weaknessCommits: ["a".repeat(63) + "0", "a".repeat(63) + "1", "a".repeat(63) + "2"],
  persona: { type: "koakuma", firstPerson: "atashi", callStyle: "chan" } });

function fixture() {
  const store = createPlayerSafetyMemory();
  let at = 2_000_000_000_000;
  const revoked = [];
  const reference = (path, query = {}) => {
    const base = store.realtime.ref(path);
    return { ...base, remove: () => base.set(null),
      orderByChild: (field) => reference(path, { ...query, field }),
      startAt: (minimum) => reference(path, { ...query, minimum }),
      endAt: (maximum) => reference(path, { ...query, maximum }),
      limitToFirst: (first) => reference(path, { ...query, first }),
      limitToLast: (last) => reference(path, { ...query, last }),
      async get() {
        const value = store.rtRead(path);
        if (!query.field) return { val: () => value };
        let entries = Object.entries(value || {}).filter(([, row]) =>
          (query.minimum == null || row[query.field] >= query.minimum) && (query.maximum == null || row[query.field] <= query.maximum));
        entries.sort((a, b) => a[1][query.field] - b[1][query.field]);
        if (query.first != null) entries = entries.slice(0, query.first);
        if (query.last != null) entries = entries.slice(-query.last);
        return { val: () => Object.fromEntries(entries) };
      } };
  };
  const safety = { filterVisible: async (_uid, rows) => rows,
    checkContact: async () => true, activateContact: async () => true,
    ensureContact: async () => ({ safetyGrantId: "grant", safetyPairId: "pair", safetyVersion: 1 }),
    revokeContact: async (args) => { revoked.push(args); } };
  const service = createPlayerSafetyStrategy({ realtime: { ref: reference }, HttpsError, playerSafety: safety, now: () => at });
  const queue = (uid, overrides = {}) => store.rtWrite(`online/strategyQueue/${uid}`, {
    uid, protocolVersion: 3, state: "waiting-v3", joinedAt: at - 1000, lastSeen: at, ratingPreference: "both", ...overrides,
  });
  return { ...store, service, safety, revoked, queue, now: () => at, tick: (ms) => { at += ms; },
    seedRoom(overrides = {}) {
      const room = { hostUid: "A", guestUid: "B", protocolVersion: 3, status: "active", createdAt: at - 1000,
        queueJoinedAt: { A: at - 2000, B: at - 2000 }, prestartDeadlineAt: at + 300000,
        safetyGrantId: "grant", safetyPairId: "pair", safetyVersion: 1, ...overrides };
      store.rtWrite(`online/strategyRooms/${ID}`, room);
      store.rtWrite(`online/strategyPrestartExpirations/${ID}`, {
        hostUid: "A", guestUid: "B", safetyGrantId: "grant", expiresAt: room.prestartDeadlineAt || at + 300000,
      });
      store.rtWrite("online/strategyActive/A", ID);
      store.rtWrite("online/strategyActive/B", ID);
      return room;
    } };
}

const stop = (f, uid = "A", joinedAt = f.now() - 1000) => f.service.stopWaiting(uid, { protocolVersion: 3, joinedAt });
const expire = (f, uid = "A") => f.service.expirePrestart(uid, { protocolVersion: 3, roomId: ID });

test("idle search stop removes only the exact waiting queue and releases its guard", async () => {
  const f = fixture(); f.queue("A");
  assert.deepEqual(await stop(f), { stopped: true, status: "stopped" });
  assert.equal(f.rtRead("online/strategyQueue/A"), null);
  assert.equal(f.rtRead("online/strategyActive/A"), null);
  assert.equal((await stop(f)).stopped, true, "retry after successful removal is idempotent");
});

test("idle search stop never removes a newer generation, offering queue, or active room", async () => {
  for (const overrides of [{ joinedAt: 2_000_000_000_000 }, { state: "offering-v3", roomId: ID }]) {
    const f = fixture(); f.queue("A", overrides); const before = f.rtRead("online/strategyQueue/A");
    assert.equal((await stop(f)).status, "resource-changed");
    assert.deepEqual(f.rtRead("online/strategyQueue/A"), before);
  }
  const f = fixture(); f.queue("A"); f.seedRoom();
  assert.equal((await stop(f, "A", f.now() - 2000)).status, "match-in-progress");
  assert.equal(f.rtRead("online/strategyActive/A"), ID);
  assert.ok(f.rtRead("online/strategyQueue/A"));
  assert.equal((await stop(f)).status, "resource-changed", "old search must not follow another generation's active room");
});

test("match cannot reclaim a live stop guard or reserve its waiting player", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  let injected = false;
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (injected || path !== "online/strategyQueue/A" || value !== null) return;
    injected = true;
    const guard = f.rtRead("online/strategyActive/A");
    assert.match(guard, /^idle:/);
    assert.equal((await f.service.match("A", { protocolVersion: 3, roomId: ID, player: player("A") })).status, "waiting");
    assert.equal((await f.service.match("B", { protocolVersion: 3, roomId: OTHER, player: player("B") })).status, "waiting");
    assert.equal(f.rtRead("online/strategyActive/A"), guard);
  };
  assert.equal((await stop(f)).stopped, true); assert.equal(injected, true);
});

test("abandoned guards expire while live guards remain occupied", async () => {
  const f = fixture(); f.queue("A");
  f.rtWrite("online/strategyActive/A", `idle:${f.now() + 1000}:abcdefabcdef`);
  assert.equal((await stop(f)).status, "occupied");
  f.tick(1001);
  assert.equal((await stop(f, "A", f.now() - 2001)).stopped, true);
});

test("a delayed stop cannot delete its queue after the captured guard deadline", async () => {
  const f = fixture(); f.queue("A"); const before = f.rtRead("online/strategyQueue/A");
  let guardWrites = 0;
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (path === "online/strategyActive/A" && typeof value === "string" && value.startsWith("idle:")) {
      guardWrites += 1;
      if (guardWrites === 2) f.tick(120001);
    }
  };
  assert.deepEqual(await stop(f), { stopped: false, status: "occupied" });
  assert.deepEqual(f.rtRead("online/strategyQueue/A"), before);
});

test("acceptance publishes a fixed server deadline only after durable index creation", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  await f.service.match("A", { protocolVersion: 3, roomId: ID, player: player("A") });
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (path === `online/strategyRooms/${ID}` && value.status === "active") {
      assert.equal(f.rtRead(`online/strategyPrestartExpirations/${ID}/expiresAt`), f.now() + 300000);
    }
  };
  await f.service.accept("B", { protocolVersion: 3, roomId: ID, player: player("B") });
  const deadline = f.rtRead(`online/strategyRooms/${ID}/prestartDeadlineAt`);
  assert.equal(deadline, f.now() + 300000);
  f.tick(60000);
  await f.service.accept("B", { protocolVersion: 3, roomId: ID, player: player("B") });
  assert.equal(f.rtRead(`online/strategyRooms/${ID}/prestartDeadlineAt`), deadline);
});

test("failed durable index write cannot activate a room", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  await f.service.match("A", { protocolVersion: 3, roomId: ID, player: player("A") });
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path === `online/strategyPrestartExpirations/${ID}`) throw new Error("index unavailable");
  };
  await assert.rejects(f.service.accept("B", { protocolVersion: 3, roomId: ID, player: player("B") }), /index unavailable/);
  assert.equal(f.rtRead(`online/strategyRooms/${ID}/status`), "offered");
});

test("prestart expiry requires five minutes and never adopts legacy rooms", async () => {
  const f = fixture(); f.seedRoom();
  assert.equal((await expire(f)).status, "pending");
  f.tick(299999); assert.equal((await expire(f)).status, "pending");
  f.tick(1); assert.equal((await expire(f)).expired, true);
  assert.equal(f.rtRead(`online/strategyRooms/${ID}/destroyed/reason`), "prestart-timeout");
  assert.equal(f.rtRead("online/strategyActive/A"), null);
  assert.equal(f.rtRead(`online/strategyPrestartExpirations/${ID}`), null);
  const legacy = fixture(); legacy.seedRoom({ prestartDeadlineAt: null }); legacy.tick(3600000);
  assert.equal((await expire(legacy)).status, "legacy");
  assert.equal(legacy.rtRead(`online/strategyRooms/${ID}/status`), "active");
});

test("battle-start and historical result evidence protect the room from expiry", async () => {
  for (const evidence of [{ battleReady: { A: true, B: true } }, { moves: { 1: { post: { by: "A" } } } },
    { resultClaims: { A: {} } }, { finished: { A: true } }, { serverFinalized: true }]) {
    const f = fixture(); f.seedRoom(evidence); f.tick(300000);
    assert.equal((await expire(f)).status, "protected");
    assert.equal(f.rtRead(`online/strategyRooms/${ID}/destroyed`), null);
    assert.equal(f.rtRead("online/strategyActive/A"), ID);
    assert.equal(f.revoked.length, 0);
  }
});

test("a child battleReady commit racing expiry forces a protective transaction retry", async () => {
  const f = fixture(); f.seedRoom({ battleReady: { A: true } }); f.tick(300000);
  let raced = false;
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (raced || path !== `online/strategyRooms/${ID}` || value.status !== "expired") return;
    raced = true; f.rtWrite(`online/strategyRooms/${ID}/battleReady/B`, true);
  };
  assert.equal((await expire(f)).status, "protected");
  assert.equal(f.rtRead(`online/strategyRooms/${ID}/status`), "active");
});

test("late prestart cleanup preserves newer queue and active pointers", async () => {
  const f = fixture(); f.seedRoom(); f.tick(300000);
  f.queue("A"); f.rtWrite("online/strategyActive/A", OTHER);
  const queue = f.rtRead("online/strategyQueue/A");
  assert.equal((await expire(f)).expired, true);
  assert.equal(f.rtRead("online/strategyActive/A"), OTHER);
  assert.deepEqual(f.rtRead("online/strategyQueue/A"), queue);
  assert.equal((await expire(f)).expired, true);
});

test("cleanup failure retains durable retry index and next scheduler pass completes", async () => {
  const f = fixture(); f.seedRoom(); f.tick(300000);
  f.safety.revokeContact = async () => { throw new Error("gate unavailable"); };
  await assert.rejects(expire(f), /gate unavailable/);
  assert.ok(f.rtRead(`online/strategyPrestartExpirations/${ID}`));
  f.safety.revokeContact = async () => {};
  assert.equal((await f.service.cleanup()).prestartExamined, 1);
  assert.equal(f.rtRead(`online/strategyPrestartExpirations/${ID}`), null);
});

test("interrupted acceptance keeps a retry index but never expires an unrelated room", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  await f.service.match("A", { protocolVersion: 3, roomId: ID, player: player("A") });
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (path === `online/strategyRooms/${ID}` && value.status === "active") throw new Error("activation interrupted");
  };
  await assert.rejects(f.service.accept("B", { protocolVersion: 3, roomId: ID, player: player("B") }), /activation interrupted/);
  assert.equal((await expire(f)).status, "legacy");
  assert.ok(f.rtRead(`online/strategyPrestartExpirations/${ID}`), "a pending activation index must survive an early expiry request");
  f.hooks.beforeRealtimeCommit = null; f.tick(300001);
  await f.service.cleanup();
  assert.equal(f.rtRead(`online/strategyRooms/${ID}/status`), "expired");
  assert.equal(f.rtRead(`online/strategyPrestartExpirations/${ID}`), null);
});

test("idle endpoints reject foreign callers, malformed queue fences and old protocol", async () => {
  const f = fixture(); f.seedRoom();
  await assert.rejects(expire(f, "stranger"), { code: "permission-denied" });
  await assert.rejects(f.service.stopWaiting("A", { protocolVersion: 3, joinedAt: NaN }), { code: "invalid-argument" });
  await assert.rejects(f.service.stopWaiting("A", { protocolVersion: 2, joinedAt: f.now() }), { code: "failed-precondition" });
});
