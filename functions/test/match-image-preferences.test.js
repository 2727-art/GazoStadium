"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  MATCH_IMAGE_PREFERENCE_TTL_MS,
  buildMatchImagePreferenceSnapshot,
  cleanupExpiredMatchImagePreferenceSnapshots,
  freezeMatchImagePreferences,
  matchImagePreferenceSnapshotPath,
  normalizeMatchImagePreferenceSnapshot,
  normalizeMatchImagePreferences,
} = require("../match-image-preferences");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

const NOW = 1_900_000_000_000;
const ROOM_ID = "P".repeat(20);
const context = (overrides = {}) => ({
  mode: "solo", roomId: ROOM_ID,
  room: { hostUid: "host", guestUid: "guest", createdAt: NOW - 100 },
  preferences: { host: "illustration", guest: "live_action", outsider: "illustration" },
  ...overrides,
});

test("private preference proof only credits valid choices bound to the exact room and participants", () => {
  const input = context();
  const snapshot = buildMatchImagePreferenceSnapshot(input, NOW);
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, input, NOW), {
    host: "illustration", guest: "live_action",
  });
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, context({ mode: "strategy" }), NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, context({ roomId: "Y".repeat(20) }), NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, context({
    room: { ...input.room, guestUid: "other" },
  }), NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, context({
    room: { ...input.room, createdAt: NOW - 99 },
  }), NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(null, input, NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot({}, input, NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot({ ...snapshot, capturedAt: NOW + 1 }, input, NOW), {});
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(snapshot, input, NOW + MATCH_IMAGE_PREFERENCE_TTL_MS), {});
  const legacy = buildMatchImagePreferenceSnapshot(context({ preferences: { host: "bad", guest: "both" } }), NOW);
  assert.deepEqual(normalizeMatchImagePreferenceSnapshot(legacy, input, NOW), { guest: "both" });
});

test("duplicate and racing start calls preserve the first choices even after queue or client changes", async () => {
  const store = createPlayerSafetyMemory();
  const input = context();
  const first = await freezeMatchImagePreferences(store.realtime, input, NOW);
  input.preferences.host = "live_action";
  input.preferences.guest = "both";
  const retry = await freezeMatchImagePreferences(store.realtime, input, NOW + 1);
  assert.deepEqual(retry, first);
  assert.deepEqual(retry.preferences, { host: "illustration", guest: "live_action" });
  const secondRoom = context({ roomId: "R".repeat(20) });
  const results = await Promise.all([
    freezeMatchImagePreferences(store.realtime, secondRoom, NOW),
    freezeMatchImagePreferences(store.realtime, { ...secondRoom, preferences: { host: "both" } }, NOW),
  ]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(freezeMatchImagePreferences(store.realtime, context({
    room: { ...input.room, guestUid: "wrong" },
  }), NOW + 2), /context changed/);
});

test("failure to persist the private proof rejects the start operation and remains retryable", async () => {
  const store = createPlayerSafetyMemory();
  store.hooks.failRealtime = 1;
  await assert.rejects(freezeMatchImagePreferences(store.realtime, context(), NOW), /injected RTDB failure/);
  assert.equal(store.rtRead(matchImagePreferenceSnapshotPath("solo", ROOM_ID)), null);
  const retried = await freezeMatchImagePreferences(store.realtime, context(), NOW + 1);
  assert.equal(retried.preferences.host, "illustration");
});

test("legacy solo server permits preserve private choices without publishing them and missing choices stay unknown", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
  const between = (start, end) => {
    const first = source.indexOf(start); const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first);
    return source.slice(first, last);
  };
  for (const withPreference of [true, false]) {
    const store = createPlayerSafetyMemory();
    const now = Date.now();
    const player = (uid) => ({ uid, name: uid, pursuitLine: "hello", streak: 0, rating: 1000, sampleCount: 0, startingHp: 30 });
    const storedPermit = {
      hostUid: "host", guestUid: "guest", createdAt: now - 100, expiresAt: now + 10_000, reunion: true, pairId: "a".repeat(40),
      players: { host: player("host"), guest: player("guest") },
      ...(withPreference ? { imagePreferences: { host: "illustration", guest: "live_action" } } : {}),
    };
    const sandbox = {
      realtime: store.realtime, freezeMatchImagePreferences, normalizeMatchImagePreferences,
      cleanText: (value, max) => String(value || "").slice(0, max),
      soloProfileProjectionParticipantsUpgradeRequired: async () => false,
      soloPermitLocksStillOwned: async () => true,
      readMatchAchievementShowcasesBestEffort: async () => null,
      cleanupSoloMatchContext: async () => {},
    };
    vm.createContext(sandbox);
    vm.runInContext([
      between("function normalizeSoloPermitPlayer", "function soloPermitLockMatches"),
      between("function soloRoomPlayerMatchesPermit", "async function releaseSoloMatchPermitLocks"),
      between("async function materializeSoloHostedMatch", "async function trySoloServerMatch"),
    ].join("\n"), sandbox);
    const permit = sandbox.normalizeSoloMatchPermit(ROOM_ID, storedPermit);
    store.rtWrite("online/queue/host", { uid: "host", state: "waiting", ratingPreference: "both" });
    if (withPreference) {
      store.hooks.beforeRealtimeCommit = async ({ path: writePath }) => {
        if (writePath.startsWith("online/matchImagePreferenceSnapshots/")) throw new Error("private solo proof unavailable");
      };
      await assert.rejects(sandbox.materializeSoloHostedMatch(ROOM_ID, permit), /private solo proof unavailable/);
      assert.equal(store.rtRead(`online/rooms/${ROOM_ID}`), null);
      store.hooks.beforeRealtimeCommit = null;
    }
    assert.equal(await sandbox.materializeSoloHostedMatch(ROOM_ID, permit), true);
    const proof = store.rtRead(matchImagePreferenceSnapshotPath("solo", ROOM_ID));
    assert.deepEqual(proof.preferences, withPreference ? { host: "illustration", guest: "live_action" } : {});
    const publicRoom = store.rtRead(`online/rooms/${ROOM_ID}`);
    assert.doesNotMatch(JSON.stringify(publicRoom), /imagePreferences|ratingPreference|illustration|live_action/);
    assert.doesNotMatch(JSON.stringify(sandbox.soloHostedMatchResponse(ROOM_ID, permit)), /imagePreferences|ratingPreference|illustration|live_action/);
    assert.doesNotMatch(JSON.stringify(store.rtRead(`online/offers/guest/${ROOM_ID}`)), /imagePreferences|ratingPreference|illustration|live_action/);
  }
});

test("24 hour cleanup retains recent proof for the 12 hour result window and rechecks concurrent records", async () => {
  const store = createPlayerSafetyMemory();
  let coldProbes = 0;
  const makeRef = (path, query = {}) => ({
    ...store.realtime.ref(path),
    async transaction(callback) {
      assert.equal(callback(null), null, "cold-cache cleanup must reach the remote compare-and-set");
      coldProbes += 1;
      return store.realtime.ref(path).transaction(callback);
    },
    orderByChild: (field) => makeRef(path, { ...query, field }),
    endAt: (maximum) => makeRef(path, { ...query, maximum }),
    limitToFirst: (limit) => makeRef(path, { ...query, limit }),
    async get() {
      const rows = Object.entries(store.rtRead(path) || {})
        .filter(([, value]) => value[query.field] <= query.maximum)
        .sort((a, b) => a[1][query.field] - b[1][query.field])
        .slice(0, query.limit);
      return { val: () => Object.fromEntries(rows) };
    },
  });
  const realtime = { ref: makeRef };
  for (const mode of ["solo", "strategy"]) {
    const expired = context({ mode, roomId: "E".repeat(20) });
    const live = context({ mode, roomId: "L".repeat(20), room: { ...context().room, createdAt: NOW + 1 } });
    store.rtWrite(matchImagePreferenceSnapshotPath(mode, expired.roomId), buildMatchImagePreferenceSnapshot(expired, NOW));
    store.rtWrite(matchImagePreferenceSnapshotPath(mode, live.roomId), buildMatchImagePreferenceSnapshot(live, NOW + 1));
  }
  const before = await cleanupExpiredMatchImagePreferenceSnapshots(realtime, NOW + 12 * 60 * 60 * 1000);
  assert.equal(before.deleted, 0);
  const after = await cleanupExpiredMatchImagePreferenceSnapshots(realtime, NOW + MATCH_IMAGE_PREFERENCE_TTL_MS);
  assert.equal(after.deleted, 2);
  for (const mode of ["solo", "strategy"]) {
    assert.equal(store.rtRead(matchImagePreferenceSnapshotPath(mode, "E".repeat(20))), null);
    assert.ok(store.rtRead(matchImagePreferenceSnapshotPath(mode, "L".repeat(20))));
  }
  const racing = context({ roomId: "R".repeat(20) });
  const racingPath = matchImagePreferenceSnapshotPath("solo", racing.roomId);
  store.rtWrite(racingPath, buildMatchImagePreferenceSnapshot(racing, NOW));
  let injected = false;
  store.hooks.beforeRealtimeCommit = async ({ path: attemptedPath }) => {
    if (attemptedPath !== racingPath || injected) return;
    injected = true;
    store.rtWrite(racingPath, buildMatchImagePreferenceSnapshot(racing, NOW + MATCH_IMAGE_PREFERENCE_TTL_MS));
  };
  const raced = await cleanupExpiredMatchImagePreferenceSnapshots(realtime, NOW + MATCH_IMAGE_PREFERENCE_TTL_MS);
  assert.equal(raced.deleted, 0);
  assert.equal(injected, true);
  assert.ok(store.rtRead(racingPath));
  assert.ok(coldProbes > 0);
});
