"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const achievements = require("../achievements");
const preferences = require("../match-image-preferences");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const between = (start, end) => {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
};
const NOW = 1_800_000_000_000;
const ROOM = "p".repeat(20);
const plain = (value) => JSON.parse(JSON.stringify(value));

async function fixture({ mode = "strategy", own = "illustration", other = "live_action", snapshot = true } = {}) {
  const memory = createPlayerSafetyMemory();
  const doc = (collection, uid) => memory.firestore.collection(collection).doc(uid);
  const room = { status: "active", hostUid: "A", guestUid: "B", createdAt: NOW - 60_000,
    members: { A: true, B: true }, players: { A: {}, B: {} } };
  const config = { solo: { roomRoot: "rooms" }, strategy: { roomRoot: "strategyRooms" } };
  await memory.realtime.ref(`online/${config[mode].roomRoot}/${ROOM}`).set(room);
  const snapshotPath = preferences.matchImagePreferenceSnapshotPath(mode, ROOM);
  if (snapshot) await preferences.freezeMatchImagePreferences(memory.realtime,
    { mode, roomId: ROOM, room, preferences: { A: own, B: other } }, NOW - 60_000);
  const context = {
    ...achievements, ...preferences, ...memory,
    Date: class extends Date { static now() { return NOW; } },
    VERIFIED_MATCH_MODES: config, ACTIVE_SERVER_RANKING_MODES: [],
    SOLO_PROFILE_PROJECTION_VERSION: 2,
    HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
    cleanText: (value, max) => String(value || "").slice(0, max),
    requestedSoloFinalizationVersion: () => 2,
    finalizeSoloRoomResult: async () => ({ room }),
    matchParticipants: () => ["A", "B"],
    validatedOutcomes: () => ({ outcomes: { A: "win", B: "loss" } }),
    dailyActivityForRoom: () => ({ scores: 1, criticals: 0 }),
    economyProgressRef: (uid) => doc("progress", uid),
    achievementProfileRef: (uid) => doc("profiles", uid),
    verifiedMatchClaimRef: (uid, matchMode, roomId) => doc("claims", `${uid}-${matchMode}-${roomId}`),
    marketStatsRef: (uid) => doc("market", uid),
    serverRankingProfileRef: (uid) => doc("ranking", uid),
    normalizeServerRankingProfile: () => ({ rating: 1000, enabled: false }),
    soloProfileProjectionEligible: () => false,
    isCrownCircuitPeriod: () => false,
    periodKey: () => "2027-01-15",
    periodEndsAt: () => NOW + 86_400_000,
    jstDateKey: () => "2027-01-15",
    integer: (value, min, max, fallback) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback,
    normalizeEconomyProgress: (value) => ({ ...plain(value || {}),
      achievementStats: achievements.normalizeBattleStats(value?.achievementStats),
      daily: { matches: 0, scores: 0, criticals: 0, ...value?.daily },
      periodRewards: plain(value?.periodRewards || { daily: {}, weekly: {}, monthly: {} }) }),
    ensureAchievementState: async (uid) => ({ progress: (await doc("progress", uid).get()).data() }),
    mirrorEconomyProgress: async () => {}, syncCreatorCardGrowth: async () => {},
    syncAchievementPublicSurfaces: async () => {}, bestEffort: async (_label, operations) => Promise.all(operations),
    dailyPlayRewardSummary: () => ({}), eventId: (value) => value,
    duplicateVerifiedMatchResult: async () => ({ outcome: "duplicate" }),
  };
  vm.createContext(context);
  vm.runInContext(`${between("function addVerifiedMatch(", "function soloProfileProjectionEligible(")}
    ${between("async function recordVerifiedMatch(", "function validatePostMatchTipRequest(")}
    this.record = recordVerifiedMatch;`, context);
  const submit = (uid = "A", overrides = {}) => context.record(uid,
    { mode, roomId: ROOM, outcome: uid === "A" ? "win" : "loss", ...overrides });
  const stats = async (uid) => (await doc("progress", uid).get()).data()?.achievementStats;
  return { ...memory, context, submit, stats, room, snapshotPath, doc };
}

for (const mode of ["solo", "strategy"]) {
  test(`${mode}: real settlement uses each participant's private selection and ignores caller preference`, async () => {
    const f = await fixture({ mode });
    const result = await f.submit("A", { ratingPreference: "live_action",
      preferences: { A: "live_action", B: "illustration" } });
    assert.equal(result.outcome, "recorded");
    assert.deepEqual(plain((await f.stats("A")).preferenceMatches), { illustration: 1, live_action: 0 });
    assert.deepEqual(plain((await f.stats("B")).preferenceMatches), { illustration: 0, live_action: 1 });
    assert.ok(result.newlyUnlocked.includes("battle_preference_illustration_1"));
    assert.ok(!result.newlyUnlocked.includes("battle_preference_live_action_1"));
    assert.ok(!JSON.stringify(result).includes('"preferences"'));
  });
}

test("both, unknown and legacy missing snapshots retain total matches without adding a preference", async () => {
  for (const options of [{ own: "both", other: "both" }, { own: "invalid", other: "" }, { snapshot: false }]) {
    const f = await fixture(options);
    await f.submit();
    for (const uid of ["A", "B"]) {
      const stats = await f.stats(uid);
      assert.equal(stats.totalMatches, 1);
      assert.deepEqual(plain(stats.preferenceMatches), { illustration: 0, live_action: 0 });
    }
  }
});

test("two concurrent result callers and Firestore transaction retries count exactly once", async () => {
  const f = await fixture();
  const results = await Promise.all([f.submit("A"), f.submit("B"), f.submit("A")]);
  assert.ok(results.some((result) => result.outcome === "recorded"));
  assert.ok(results.some((result) => result.outcome === "duplicate"));
  assert.equal((await f.stats("A")).preferenceMatches.illustration, 1);
  assert.equal((await f.stats("B")).preferenceMatches.live_action, 1);
  await f.realtime.ref(f.snapshotPath).set(null);
  assert.equal((await f.submit()).outcome, "duplicate");
  assert.equal((await f.stats("A")).totalMatches, 1);
});

test("a failed private read cannot create a claim that permanently loses preference credit", async () => {
  const f = await fixture();
  const ref = f.realtime.ref.bind(f.realtime);
  f.realtime.ref = (key) => key === f.snapshotPath ? { get: async () => { throw new Error("read unavailable"); } } : ref(key);
  await assert.rejects(f.submit(), /read unavailable/);
  assert.equal((await f.doc("claims", `A-strategy-${ROOM}`).get()).exists, false);
  assert.equal(await f.stats("A"), undefined);
  f.realtime.ref = ref;
  await f.submit();
  assert.equal((await f.stats("A")).preferenceMatches.illustration, 1);
});

test("a snapshot for a reused room id or different participants cannot grant preference credit", async () => {
  const f = await fixture();
  await f.realtime.ref(`${f.snapshotPath}/roomCreatedAt`).set(NOW - 120_000);
  await f.submit();
  assert.equal((await f.stats("A")).totalMatches, 1);
  assert.equal((await f.stats("A")).preferenceMatches.illustration, 0);
});
