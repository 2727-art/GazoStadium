"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  ACHIEVEMENT_DEFINITIONS,
  addBattleMatch,
  addMarketTransaction,
  deriveBattleStatsFromPeriods,
  effectiveShowcase,
  eligibleAchievementIds,
  normalizeAchievementProfile,
  normalizeBattleStats,
  normalizeMarketStats,
  publicAchievementProfile,
  unlockAchievements,
} = require("../achievements");

const root = path.resolve(__dirname, "..", "..");

test("battle thresholds keep 100 matches below the long-term ceiling", () => {
  const totalThresholds = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.family === "battle_total")
    .map((definition) => definition.target);
  assert.deepEqual(totalThresholds, [1, 10, 30, 100, 300, 1000, 3000]);
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === "battle_total_100").level, 4);
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === "battle_solo_100").level, 5);
});

test("achievement conditions never depend on wins, rating, rank, or market point totals", () => {
  const serializedConditions = JSON.stringify(ACHIEVEMENT_DEFINITIONS.map((definition) => definition.condition));
  for (const forbidden of ["wins", "rating", "rank", "grossSales", "spent", "bestSale", "highestPurchase"]) {
    assert.equal(serializedConditions.includes(forbidden), false, `${forbidden} must not be an achievement condition`);
  }
});

test("legacy verified monthly records backfill totals without inventing a loss streak", () => {
  const stats = deriveBattleStatsFromPeriods({
    daily: {
      "2026-07-22": { matches: 60 },
      "2026-07-23": { matches: 40 },
    },
    monthly: {
      "2026-07": {
        matches: 100,
        losses: 42,
        modeMatches: { solo: 88, strategy: 5, team: 4, royale: 3 },
      },
    },
  });
  assert.deepEqual(stats, {
    totalMatches: 100,
    losses: 42,
    currentLossStreak: 0,
    bestLossStreak: 0,
    modeMatches: { solo: 88, strategy: 5, team: 4, royale: 3 },
    playDays: 2,
    lastPlayDateKey: "2026-07-23",
  });
});

test("verified matches advance play days and reset loss streak on a draw", () => {
  let stats = normalizeBattleStats(null);
  stats = addBattleMatch(stats, "solo", "loss", "2026-07-23");
  stats = addBattleMatch(stats, "strategy", "loss", "2026-07-23");
  stats = addBattleMatch(stats, "team", "loss", "2026-07-24");
  assert.equal(stats.currentLossStreak, 3);
  assert.equal(stats.bestLossStreak, 3);
  assert.equal(stats.playDays, 2);
  stats = addBattleMatch(stats, "royale", "draw", "2026-07-24");
  assert.equal(stats.currentLossStreak, 0);
  assert.equal(stats.bestLossStreak, 3);
  assert.equal(stats.losses, 3);
});

test("mode variety and loss achievements unlock from neutral verified stats", () => {
  const battleStats = {
    totalMatches: 120,
    losses: 30,
    currentLossStreak: 0,
    bestLossStreak: 5,
    modeMatches: { solo: 90, strategy: 10, team: 10, royale: 10 },
    playDays: 7,
    lastPlayDateKey: "2026-07-23",
  };
  const ids = eligibleAchievementIds({ battleStats, scope: "battle" });
  for (const expected of [
    "battle_total_100",
    "battle_variety_2",
    "battle_variety_all_5",
    "battle_losses_30",
    "battle_loss_streak_5",
    "battle_days_7",
  ]) assert.equal(ids.includes(expected), true, expected);
  assert.equal(ids.includes("battle_variety_all_20"), false);
});

test("unlocking is idempotent and loss badges are not automatically public", () => {
  const timestamp = 1_800_000_000_000;
  const first = unlockAchievements(null, ["battle_total_1", "battle_losses_1"], timestamp);
  assert.deepEqual(first.newlyUnlocked, ["battle_total_1", "battle_losses_1"]);
  assert.deepEqual(effectiveShowcase(first.profile), ["battle_total_1"]);
  const second = unlockAchievements(first.profile, ["battle_total_1", "battle_losses_1"], timestamp + 1);
  assert.deepEqual(second.newlyUnlocked, []);
  assert.deepEqual(Object.keys(normalizeAchievementProfile(second.profile).pendingUnlocks).sort(), [
    "battle_losses_1",
    "battle_total_1",
  ]);
});

test("custom showcases accept three unlocked achievements and keep negative badges opt-in", () => {
  const profile = unlockAchievements(null, [
    "battle_total_1",
    "battle_losses_1",
    "market_seller_1",
    "market_buyer_1",
  ], 100).profile;
  profile.customShowcase = ["battle_losses_1", "market_seller_1", "market_buyer_1"];
  assert.deepEqual(effectiveShowcase(profile), profile.customShowcase);
  const payload = publicAchievementProfile(profile, null, null);
  assert.deepEqual(payload.showcase, profile.customShowcase);
  assert.equal(payload.unlockedCount, 4);
});

test("custom showcases advance to the highest unlocked level in the same family", () => {
  const profile = unlockAchievements(null, ["battle_total_1", "battle_total_10"], 100).profile;
  profile.customShowcase = ["battle_total_1"];
  assert.deepEqual(effectiveShowcase(profile), ["battle_total_10"]);
});

test("market stats count days and unique counterparties independently of point totals", () => {
  let stats = normalizeMarketStats({ salesCount: 3, purchases: 1 });
  stats = addMarketTransaction(stats, "seller", "2026-07-23", { newCounterparty: true });
  stats = addMarketTransaction(stats, "buyer", "2026-07-23", { newCounterparty: false });
  assert.equal(stats.marketDays, 1);
  assert.equal(stats.uniqueCounterparties, 1);
  assert.deepEqual(stats.marketRoleDay, {
    dateKey: "2026-07-23",
    seller: true,
    buyer: true,
  });
  const ids = eligibleAchievementIds({
    marketStats: stats,
    signals: { bothRolesDay: true, roleSwitch: true },
    scope: "market",
  });
  assert.equal(ids.includes("market_seller_3"), true);
  assert.equal(ids.includes("market_buyer_1"), true);
  assert.equal(ids.includes("market_both_1"), true);
  assert.equal(ids.includes("market_both_roles_day"), true);
  assert.equal(ids.includes("market_role_switch"), true);
});

test("browser and Functions catalogs expose the same achievement IDs", () => {
  const source = fs.readFileSync(path.join(root, "achievements.js"), "utf8");
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { window, document: {}, console });
  const browserIds = [...window.HariaiAchievements.catalog].map((definition) => definition.id).sort();
  const serverIds = ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id).sort();
  assert.deepEqual(browserIds, serverIds);
});
