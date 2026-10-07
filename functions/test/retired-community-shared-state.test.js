"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const achievements = require("../achievements");
const { buildMatchAchievementShowcases, normalizeMatchAchievementShowcases } = require("../match-achievement-showcase");
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const block = (first, next) => {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return source.slice(start, end);
};
const ensureSource = block("async function ensureAchievementState(", "async function mirrorEconomyProgress(");
const showcaseSource = block("async function setAchievementShowcase(", "function periodReward(");
const matchSource = block("async function readMatchAchievementShowcases(", "async function readMatchAchievementShowcasesBestEffort(");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function harness({ profile, progress, tributeReady = true } = {}) {
  const reads = [];
  const writes = [];
  const backfills = [];
  const publicSyncs = [];
  const documents = new Map();
  const refNames = {
    economyProgressRef: "economyProgress",
    achievementProfileRef: "achievementProfiles",
    crownMonthlyAchievementStatsRef: "crownStats",
    marketStatsRef: "valueMarketStats",
    trainingProfileRef: "trainingProfiles",
    aiTextTrainingPlayerStatsRef: "aiPlayerStats",
    aiTextTrainingSellerStatsRef: "aiSellerStats",
    rouletteTrainingSellerStatsRef: "rouletteSellerStats",
  };
  const prohibited = /^(?:fleaStats|danwakuProfiles|danwakuMatchBadges)\//;
  function snapshot(documentPath) {
    assert.equal(prohibited.test(documentPath), false, `retired mode was queried: ${documentPath}`);
    reads.push(documentPath);
    const data = structuredClone(documents.get(documentPath));
    return { exists: data !== undefined, data: () => structuredClone(data), get: (key) => data?.[key] };
  }
  const reference = (documentPath) => ({ path: documentPath, get: async () => snapshot(documentPath) });
  const firestore = {
    async runTransaction(callback) {
      const pending = [];
      const result = await callback({
        get: async (ref) => { assert.equal(pending.length, 0); return snapshot(ref.path); },
        set: (ref, value) => pending.push({ path: ref.path, value: plain(value) }),
      });
      for (const write of pending) { writes.push(write); documents.set(write.path, write.value); }
      return result;
    },
  };
  documents.set("economyProgress/user", progress || { schemaVersion: 3, achievementStats: {}, dailyPlayClaims: {} });
  documents.set("achievementProfiles/user", profile || {
    schemaVersion: 1, unlocked: { flea_listings_1: 100, danwaku_streak_7: 200 },
    pendingUnlocks: {}, customShowcase: ["flea_listings_1", "danwaku_streak_7"], initializedAt: 50, updatedAt: 200,
  });
  documents.set("tributeStats/user", { historyBackfilled: tributeReady, managerPairDays: 0, walletPairDays: 0 });
  // High retired statistics must neither be read nor cause implicit unlocks.
  documents.set("fleaStats/user", { listings: 1000, sales: 1000, purchases: 10000, historyBackfilled: true });
  documents.set("danwakuProfiles/user", { highestEverDays: 365 });
  const context = {
    ...achievements, HttpsError, firestore, Date,
    normalizeRetiredTrainingHistory: (data) => achievements.normalizeTrainingStats(data),
    normalizeEconomyProgress: (data) => ({ ...data, achievementStats: achievements.normalizeBattleStats(data?.achievementStats) }),
    anjuPayFleaAchievementStatsStore: {
      ensure: async () => { assert.fail("retired Flea backfill must not run"); },
      statsRef: () => { assert.fail("retired Flea reference must not be requested"); },
    },
    danwakuProfileRef: () => { assert.fail("retired NOTE reference must not be requested"); },
    danwakuMatchBadgeRef: () => { assert.fail("retired NOTE badge reference must not be requested"); },
    tributeService: {
      achievementStatsRef: (uid) => reference(`tributeStats/${uid}`),
      ensureAchievementStats: async (uid) => { backfills.push(uid); documents.set(`tributeStats/${uid}`, { ...documents.get(`tributeStats/${uid}`), historyBackfilled: true }); },
    },
    syncAchievementPublicSurfaces: async (uid, value) => publicSyncs.push({ uid, profile: plain(value) }),
    buildMatchAchievementShowcases,
  };
  for (const [name, collection] of Object.entries(refNames)) context[name] = (uid) => reference(`${collection}/${uid}`);
  vm.createContext(context);
  vm.runInContext(`${ensureSource}\n${showcaseSource}\n${matchSource}\nthis.ensure = ensureAchievementState; this.showcase = setAchievementShowcase; this.match = readMatchAchievementShowcases;`, context);
  return { context, documents, reads, writes, backfills, publicSyncs, ensure: context.ensure, showcase: context.showcase, match: context.match };
}

test("common achievement initialization reads no retired data and preserves legacy unlocks and showcase", async () => {
  const h = harness();
  const before = plain(h.documents.get("achievementProfiles/user"));
  const result = await h.ensure("user");
  assert.deepEqual(plain(result.profile), before);
  assert.deepEqual(plain(result.newlyUnlocked), []);
  assert.deepEqual(h.backfills, ["user"], "active tribute initialization still runs");
  assert.equal(h.reads.length, 9);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(plain(result.fleaStats), { listings: 0, sales: 0, purchases: 0 });
  assert.deepEqual(plain(result.danwakuStats), { highestEverDays: 0 });
  assert.equal(h.documents.get("fleaStats/user").purchases, 10000, "historical stats remain stored");
  assert.equal(h.documents.get("danwakuProfiles/user").highestEverDays, 365);
});

test("common deferred tribute initialization remains bounded and independent of retired stats", async () => {
  const h = harness({ tributeReady: false });
  const result = await h.ensure("user", { deferTributeBackfill: true });
  assert.deepEqual(h.backfills, ["user"]);
  assert.equal(h.reads.length, 18);
  assert.deepEqual(plain(result.newlyUnlocked), []);
  assert.equal(h.writes.length, 0);
});

test("an unrelated active achievement can unlock without dropping historical mode achievements", async () => {
  const h = harness({ progress: { schemaVersion: 3, achievementStats: { totalMatches: 1 }, dailyPlayClaims: {} } });
  const before = plain(h.documents.get("achievementProfiles/user").unlocked);
  const result = await h.ensure("user", { deferTributeBackfill: true });
  assert.ok(result.newlyUnlocked.includes("battle_total_1"));
  for (const [id, timestamp] of Object.entries(before)) assert.equal(result.profile.unlocked[id], timestamp);
  assert.deepEqual(plain(result.profile.customShowcase), ["flea_listings_1", "danwaku_streak_7"]);
  assert.equal(h.writes.filter((write) => write.path === "achievementProfiles/user").length, 1);
});

test("legacy achievements remain equipable without retired reads and unearned IDs remain rejected", async () => {
  const h = harness();
  const result = await h.showcase("user", ["danwaku_streak_7", "flea_listings_1"]);
  assert.equal(result.saved, true);
  assert.deepEqual(plain(result.achievements.customShowcase), ["danwaku_streak_7", "flea_listings_1"]);
  assert.deepEqual(plain(result.achievements.showcase), ["danwaku_streak_7", "flea_listings_1"]);
  assert.equal(h.reads.length, 8);
  assert.equal(h.publicSyncs.length, 1);
  assert.equal(h.writes.length, 1);
  await assert.rejects(h.showcase("user", ["flea_sales_1000"]), { code: "failed-precondition" });
  assert.equal(h.writes.length, 1, "an unearned legacy ID cannot be equipped");
});

test("fresh match snapshots read achievement profiles only, retaining legacy-equipped IDs", async () => {
  const h = harness();
  h.documents.set("achievementProfiles/other", { unlocked: { danwaku_streak_1: 100 }, customShowcase: ["danwaku_streak_1"] });
  const result = await h.match(["user", "other"], 1000);
  assert.deepEqual(h.reads, ["achievementProfiles/user", "achievementProfiles/other"]);
  assert.equal(result.players.user.ids, "flea_listings_1,danwaku_streak_7");
  assert.equal(result.players.other.ids, "danwaku_streak_1");
  assert.equal(Object.hasOwn(result.players.user, "danwakuDays"), false);
  assert.equal(Object.hasOwn(result.players.other, "danwakuDays"), false);
  const previous = { ...result, players: { ...result.players, user: { ...result.players.user, danwakuDays: 7 } } };
  assert.equal(normalizeMatchAchievementShowcases(previous, ["user", "other"]).players.user.danwakuDays, 7,
    "already created snapshots remain compatible");
});

test("retired modes cannot auto-unlock even with maximum old statistics, while all 40 IDs remain valid", () => {
  const retired = achievements.ACHIEVEMENT_DEFINITIONS.filter((definition) => ["flea", "danwaku"].includes(definition.scope));
  assert.equal(retired.length, 40);
  assert.equal(retired.every((definition) => definition.legacy === true), true);
  const eligible = achievements.eligibleAchievementIds({
    fleaStats: { listings: 1000, sales: 1000, purchases: 10000 }, danwakuStats: { highestEverDays: 365 },
  });
  assert.equal(eligible.some((id) => retired.some((definition) => definition.id === id)), false);
  const unlocked = Object.fromEntries(retired.map((definition, index) => [definition.id, 1000 + index]));
  assert.deepEqual(achievements.normalizeAchievementProfile({ unlocked }).unlocked, unlocked);
});

test("account-transfer history guards retain retired data checks and any needed authoritative backfill", () => {
  const pristine = block("async function transferTargetIsPristine(", "async function registerTransferFailure(");
  assert.match(pristine, /await anjuPayFleaAchievementStatsStore\.ensure\(uid\)/);
  assert.match(pristine, /danwakuProfileRef\(uid\)\.get\(\)/);
  assert.match(pristine, /danwakuProfileSnapshot\.exists/);
  assert.match(pristine, /fleaAchievementStatsHaveActivity\(fleaAchievementStatsSnapshot\.data\(\)\)/);
  assert.match(source, /transaction\.get\(danwakuProfileRef\(targetUid\)\)/);
  assert.match(source, /targetDanwakuProfileSnapshot\.exists/);
});
