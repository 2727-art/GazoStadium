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
const commits = (letter) => [letter.repeat(63) + "0", letter.repeat(63) + "1", letter.repeat(63) + "2"];
const player = (uid, commit = "a") => ({ uid, name: uid, clues: ["A", "B", "C"], weaknessCommits: commits(commit),
  persona: { type: "koakuma", firstPerson: "atashi", callStyle: "chan" }, penalties: { call: true, tribute: false }, rating: 9999, streak: 9999 });

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
      store.rtWrite(`online/strategyQueue/${uid}`, { uid, protocolVersion: 3, state: "waiting-v3", ratingPreference: "both", joinedAt: at - 1000, lastSeen: at, ...overrides });
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
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("P"), player: player("A") });
  const privatePath = `online/matchImagePreferenceSnapshots/strategy/${offer.roomId}`;
  assert.equal(f.rtRead(privatePath), null, "offer alone must not freeze the host choice");
  const queueA = f.rtRead("online/strategyQueue/A");
  f.rtWrite("online/strategyQueue/A", { ...queueA, ratingPreference: "live_action" });
  await f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: { ...player("B"), ratingPreference: "illustration" } });
  const frozen = f.rtRead(privatePath);
  assert.deepEqual(frozen.preferences, { A: "live_action", B: "both" });
  assert.doesNotMatch(JSON.stringify(f.rtRead(`online/strategyRooms/${offer.roomId}`)), /ratingPreference|live_action|illustration|preferences/);
  f.queue("A", { ratingPreference: "illustration" });
  f.queue("B", { ratingPreference: "illustration" });
  await f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: player("B") });
  assert.deepEqual(f.rtRead(privatePath), frozen);
});

test("strategy does not activate a room if private choice persistence fails", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("F"), player: player("A") });
  f.hooks.beforeRealtimeCommit = async ({ path }) => {
    if (path.startsWith("online/matchImagePreferenceSnapshots/")) throw new Error("private proof unavailable");
  };
  await assert.rejects(f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: player("B") }), /private proof unavailable/);
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/status`), "offered");
  f.hooks.beforeRealtimeCommit = null;
  assert.equal((await f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: player("B") })).status, "active");
});

test("blocked and old-protocol candidates cannot monopolize strategy matching; accepted records are server-authoritative", async () => {
  const f = fixture();
  f.queue("A"); f.queue("B", { joinedAt: f.now() - 3000 }); f.queue("C"); f.queue("legacy", { protocolVersion: 1 });
  f.rtWrite("online/strategyProfiles/A", { rating: 1234, streak: 2 });
  await f.block("A", "B");
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("X"), player: player("A") });
  assert.equal(offer.status, "hosted");
  assert.equal(offer.opponentUid, "C");
  const before = f.rtRead(`online/strategyRooms/${offer.roomId}`);
  assert.equal(before.players.A.rating, 1234);
  assert.equal(before.players.A.streak, 2);
  const accepted = await f.service.accept("C", { protocolVersion: 3, roomId: offer.roomId, player: player("C", "c") });
  assert.equal(accepted.status, "active");
  assert.equal(f.rtRead("online/strategyActive/A"), offer.roomId);
  assert.equal(f.rtRead("online/strategyActive/C"), offer.roomId);
  assert.equal(f.rtRead("online/strategyQueue/A"), null);
  assert.equal(f.rtRead("online/strategyQueue/C"), null);
  assert.deepEqual(f.rtRead(`online/strategyRooms/${offer.roomId}/players/C/weaknessCommits`), commits("c"));
  const retry = await f.service.match("A", { protocolVersion: 3, roomId: roomId("Y"), player: player("A", "b") });
  assert.equal(retry.roomId, offer.roomId);
  assert.deepEqual(f.rtRead(`online/strategyRooms/${offer.roomId}/players/A/weaknessCommits`), commits("a"));
});

test("block between offer and acceptance prevents entry in either direction", async () => {
  for (const blocker of ["A", "B"]) {
    const f = fixture(); f.queue("A"); f.queue("B");
    const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("X"), player: player("A") });
    await f.block(blocker, blocker === "A" ? "B" : "A");
    await assert.rejects(f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: player("B") }), { code: "failed-precondition" });
    assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/players/B`), null);
  }
});

test("a block racing the activation write cannot return a successful join", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("X"), player: player("A") });
  let injected = false;
  f.hooks.beforeRealtimeCommit = async ({ path, value }) => {
    if (injected || path !== `online/strategyRooms/${offer.roomId}` || value?.status !== "active") return;
    injected = true;
    await f.block("A", "B");
  };
  await assert.rejects(f.service.accept("B", { protocolVersion: 3, roomId: offer.roomId, player: player("B") }), { code: "failed-precondition" });
  assert.equal(injected, true);
  const room = f.rtRead(`online/strategyRooms/${offer.roomId}`);
  assert.equal(await f.safety.checkContact({ ...room, firstUid: "A", secondUid: "B", mode: "strategy", roomId: offer.roomId }), false);
});

test("expiration does not erase a newer queue or active-room reservation", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("X"), player: player("A") });
  f.tick(30_000);
  f.queue("A", { joinedAt: f.now(), roomId: roomId("Z"), state: "offering-v3" });
  f.rtWrite("online/strategyActive/A", roomId("Z"));
  await f.service.expire("A", { roomId: offer.roomId });
  assert.equal(f.rtRead("online/strategyActive/A"), roomId("Z"));
  assert.equal(f.rtRead("online/strategyQueue/A/roomId"), roomId("Z"));
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/status`), "expired");
});

test("simultaneous hosts cannot reserve one strategy guest into two rooms", async () => {
  const f = fixture(); f.queue("A"); f.queue("B"); f.queue("C");
  const results = await Promise.all([
    f.service.match("A", { protocolVersion: 3, roomId: roomId("X"), player: player("A") }),
    f.service.match("C", { protocolVersion: 3, roomId: roomId("Y"), player: player("C") }),
  ]);
  const rooms = Object.entries(f.rtRead("online/strategyRooms") || {}).filter(([, room]) => room.status === "offered");
  const members = rooms.flatMap(([, room]) => [room.hostUid, room.guestUid]);
  assert.equal(new Set(members).size, members.length);
  assert.ok(results.some((result) => ["hosted", "joined"].includes(result.status)));
});

test("strategy matching rejects pre-hariai clients with a reload message", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  for (const protocolVersion of [undefined, 2]) {
    await assert.rejects(
      f.service.match("A", { protocolVersion, roomId: roomId("V"), player: player("A") }),
      { code: "failed-precondition", message: /再読み込み/ },
    );
  }
  f.queue("legacy-host", { protocolVersion: 2, state: "waiting-v2" });
  const offer = await f.service.match("A", { protocolVersion: 3, roomId: roomId("W"), player: player("A") });
  assert.equal(offer.opponentUid, "B", "v2 queue rows are never matched");
  await assert.rejects(
    f.service.accept("B", { protocolVersion: 2, roomId: offer.roomId, player: player("B") }),
    { code: "failed-precondition", message: /再読み込み/ },
  );
});

test("strategy player records require a girl persona and three distinct candidate commits", async () => {
  const f = fixture(); f.queue("A"); f.queue("B");
  const attempts = [
    { ...player("A"), persona: { type: "", firstPerson: "atashi", callStyle: "chan" } },
    { ...player("A"), persona: { type: "koakuma", firstPerson: "boku", callStyle: "chan" } },
    { ...player("A"), weaknessCommits: ["a".repeat(64), "a".repeat(64), "b".repeat(64)] },
    { ...player("A"), weaknessCommits: ["a".repeat(64), "b".repeat(64)] },
    { ...player("A"), clues: ["A", "B\nC", "D"] },
  ];
  for (const attempt of attempts) {
    await assert.rejects(f.service.match("A", { protocolVersion: 3, roomId: roomId("R"), player: attempt }), { code: "invalid-argument" });
  }
  const offer = await f.service.match("A", {
    protocolVersion: 3,
    roomId: roomId("S"),
    player: { ...player("A"), penalties: { call: "yes", tribute: true }, pursuitLine: "legacy", extra: "dropped" },
  });
  const stored = f.rtRead(`online/strategyRooms/${offer.roomId}/players/A`);
  assert.deepEqual(stored.persona, { type: "koakuma", firstPerson: "atashi", callStyle: "chan" });
  assert.deepEqual(stored.penalties, { call: false, tribute: true });
  assert.equal(f.rtRead(`online/strategyRooms/${offer.roomId}/protocolVersion`), 3);
  assert.equal("pursuitLine" in stored, false);
  assert.equal("extra" in stored, false);
});

test("server persona ids stay in parity with the client core", async () => {
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const { STRATEGY_HARIAI_IDS } = require("../player-safety-strategy");
  const core = await import(pathToFileURL(path.resolve(__dirname, "..", "..", "strategy-hariai-core.mjs")).href);
  assert.equal(STRATEGY_HARIAI_IDS.PROTOCOL_VERSION, core.HARIAI_PROTOCOL_VERSION);
  assert.deepEqual(STRATEGY_HARIAI_IDS.PERSONA_TYPES, core.HARIAI_PERSONA_TYPES.map((item) => item.id));
  assert.deepEqual(STRATEGY_HARIAI_IDS.FIRST_PERSONS, core.HARIAI_FIRST_PERSONS.map((item) => item.id));
  assert.deepEqual(STRATEGY_HARIAI_IDS.CALL_STYLES, core.HARIAI_CALL_STYLES.map((item) => item.id));
});
