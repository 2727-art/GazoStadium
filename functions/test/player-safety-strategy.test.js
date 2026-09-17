"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlayerSafetyStrategy, preferenceTier } = require("../player-safety-strategy");
const { createPlayerSafetyService } = require("../player-safety");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const roomId = (letter) => letter.repeat(20);
const player = (uid, commit = "a") => ({ uid, name: uid, clues: ["A", "B", "C"], weaknessCommit: commit.repeat(64), pursuitLine: "追撃", rating: 9999, streak: 9999 });

function fixture() {
  const store = createPlayerSafetyMemory();
  let at = 2_000_000_000_000;
  // Query behavior is local to these tests; mutations retain the shared store's
  // optimistic transaction retries so injected block races are exercised.
  const makeRef = (path, query = {}) => {
    const base = store.realtime.ref(path);
    return {
      ...base,
      remove: () => base.set(null),
      orderByChild: (field) => makeRef(path, { ...query, field }),
      startAt: (minimum) => makeRef(path, { ...query, minimum }),
      endAt: (maximum) => makeRef(path, { ...query, maximum }),
      limitToFirst: (first) => makeRef(path, { ...query, first }),
      limitToLast: (last) => makeRef(path, { ...query, last }),
      async get() {
        const value = store.rtRead(path);
        if (!query.field) return { val: () => value };
        let entries = Object.entries(value || {}).filter(([, row]) =>
          (query.minimum == null || row[query.field] >= query.minimum)
          && (query.maximum == null || row[query.field] <= query.maximum));
        entries.sort((a, b) => a[1][query.field] - b[1][query.field] || a[0].localeCompare(b[0]));
        if (query.first != null) entries = entries.slice(0, query.first);
        if (query.last != null) entries = entries.slice(-query.last);
        return { val: () => Object.fromEntries(entries) };
      },
    };
  };
  const realtime = { ref: makeRef };
  store.rtWrite("online/config/playerSafetyEnabled", true);
  const safety = createPlayerSafetyService({
    firestore: store.firestore, realtime, HttpsError, now: () => at,
    resolveContext: async (_uid, data) => ({ uid: data.publicEntryId, name: data.publicEntryId, source: "card" }),
    closeContacts: async () => {},
  });
  const service = createPlayerSafetyStrategy({ realtime, HttpsError, playerSafety: safety, now: () => at });
  return {
    ...store, safety, service, now: () => at, tick: (ms) => { at += ms; },
    queue(uid, overrides = {}) {
      store.rtWrite(`online/strategyQueue/${uid}`, { uid, protocolVersion: 2, state: "waiting-v2", ratingPreference: "both", joinedAt: at - 1000, lastSeen: at, ...overrides });
    },
    async block(uid, other) {
      const context = await safety.performAction(uid, { action: "get_context", publicEntryId: other });
      return safety.performAction(uid, { action: "block", contextId: context.contextId, expectedVersion: context.version, requestId: `block-${uid}-${other}-0001` });
    },
  };
}

test("strategy preference tiers preserve illustration/live-action consent", () => {
  assert.equal(preferenceTier({ ratingPreference: "live_action" }, { ratingPreference: "live_action" }), 0);
  assert.equal(preferenceTier({ ratingPreference: "live_action" }, { ratingPreference: "illustration" }), Infinity);
  assert.equal(preferenceTier({ ratingPreference: "live_action", allowPreferenceMismatch: true }, { ratingPreference: "illustration", allowPreferenceMismatch: true }), 2);
  assert.equal(preferenceTier({ ratingPreference: "both" }, { ratingPreference: "live_action" }), 1);
});

test("strategy freezes private choices at acceptance and keeps them through queue changes and retries", async () => {
  const f = fixture();
  f.queue("A", { ratingPreference: "illustration" });
  f.queue("B", { ratingPreference: "both" });
  const offer = await f.service.match("A", { roomId: roomId("P"), player: player("A") });
  const privatePath = `online/matchImagePreferenceSnapshots/strategy/${offer.roomId}`;
  assert.equal(f.rtRead(privatePath), null, "offer alone must not freeze the host choice");
  const queueA = f.rtRead("online/strategyQueue/A");
  f.rtWrite("online/strategyQueue/A", { ...queueA, ratingPreference: "live_action" });
  await f.service.accept("B", { roomId: offer.roomId, player: { ...player("B"), ratingPreference: "illustration" } });
  const frozen = f.rtRead(privatePath);
  assert.deepEqual(frozen.preferences, { A: "live_action", B: "both" });
  assert.doesNotMatch(JSON.stringify(f.rtRead(`online/strategyRooms/${offer.roomId}`)), /ratingPreference|live_action|illustration|preferences/);
  f.queue("A", { ratingPreference: "illustration" });
  f.queue("B", { ratingPreference: "illustration" });
  await f.service.accept("B", { roomId: offer.roomId, player: player("B") });
  assert.deepEqual(f.rtRead(privatePath), frozen);
});

test("strategy does not activate a room if private choice persistence fails", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { roomId: roomId("F"), player: player("A") });
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path.startsWith("online/matchImagePreferenceSnapshots/")) throw new Error("private proof unavailable");
  };
  await assert.rejects(f.service.accept("B", { roomId: offer.roomId, player: player("B") }), /private proof unavailable/);
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/status`), "offered");
  f.hooks.beforeRealtimeCommit = null;
  assert.equal((await f.service.accept("B", { roomId: offer.roomId, player: player("B") })).status, "active");
});

test("blocked and old-protocol candidates cannot monopolize strategy matching; accepted records are server-authoritative", async () => {
  const f = fixture();
  f.queue("A"); f.queue("B", { joinedAt: f.now() - 3000 }); f.queue("C"); f.queue("legacy", { protocolVersion: 1 });
  f.rtWrite("online/strategyProfiles/A", { rating: 1234, streak: 2 });
  await f.block("A", "B");
  const offer = await f.service.match("A", { roomId: roomId("X"), player: player("A") });
  assert.equal(offer.status, "hosted");
  assert.equal(offer.opponentUid, "C");
  const before = f.rtRead(`online/strategyRooms/${offer.roomId}`);
  assert.equal(before.players.A.rating, 1234);
  assert.equal(before.players.A.streak, 2);
  const accepted = await f.service.accept("C", { roomId: offer.roomId, player: player("C", "c") });
  assert.equal(accepted.status, "active");
  assert.equal(f.rtRead("online/strategyActive/A"), offer.roomId);
  assert.equal(f.rtRead("online/strategyActive/C"), offer.roomId);
  assert.equal(f.rtRead("online/strategyQueue/A"), null);
  assert.equal(f.rtRead("online/strategyQueue/C"), null);
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/players/C/weaknessCommit`), "c".repeat(64));
  const retry = await f.service.match("A", { roomId: roomId("Y"), player: player("A", "b") });
  assert.equal(retry.roomId, offer.roomId);
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/players/A/weaknessCommit`), "a".repeat(64));
});

test("block between offer and acceptance prevents entry in either direction", async () => {
  for (const blocker of ["A", "B"]) {
    const f = fixture(); f.queue("A"); f.queue("B");
    const offer = await f.service.match("A", { roomId: roomId("X"), player: player("A") });
    await f.block(blocker, blocker === "A" ? "B" : "A");
    await assert.rejects(f.service.accept("B", { roomId: offer.roomId, player: player("B") }), { code: "failed-precondition" });
    assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/players/B`), null);
  }
});

test("a block racing the activation write cannot return a successful join", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { roomId: roomId("X"), player: player("A") });
  let injected = false;
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (injected || path !== `online/strategyRooms/${offer.roomId}` || value?.status !== "active") return;
    injected = true;
    await f.block("A", "B");
  };
  await assert.rejects(f.service.accept("B", { roomId: offer.roomId, player: player("B") }), { code: "failed-precondition" });
  assert.equal(injected, true);
  const room = f.rtRead(`online/strategyRooms/${offer.roomId}`);
  assert.equal(await f.safety.checkContact({ ...room, firstUid: "A", secondUid: "B", mode: "strategy", roomId: offer.roomId }), false);
});

test("expiration does not erase a newer queue or active-room reservation", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { roomId: roomId("X"), player: player("A") });
  f.tick(30_000);
  f.queue("A", { joinedAt: f.now(), roomId: roomId("Z"), state: "offering-v2" });
  f.rtWrite("online/strategyActive/A", roomId("Z"));
  await f.service.expire("A", { roomId: offer.roomId });
  assert.equal(f.rtRead("online/strategyActive/A"), roomId("Z"));
  assert.equal(f.rtRead("online/strategyQueue/A/roomId"), roomId("Z"));
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/status`), "expired");
});

test("simultaneous hosts cannot reserve one strategy guest into two rooms", async () => {
  const f = fixture(); f.queue("A"); f.queue("B"); f.queue("C");
  const results = await Promise.all([
    f.service.match("A", { roomId: roomId("X"), player: player("A") }),
    f.service.match("C", { roomId: roomId("Y"), player: player("C") }),
  ]);
  const rooms = Object.entries(f.rtRead("online/strategyRooms") || {}).filter(([, room]) => room.status === "offered");
  const members = rooms.flatMap(([, room]) => [room.hostUid, room.guestUid]);
  assert.equal(new Set(members).size, members.length);
  assert.ok(results.some((result) => ["hosted", "joined"].includes(result.status)));
});
