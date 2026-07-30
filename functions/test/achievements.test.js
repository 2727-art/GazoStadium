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
  normalizeAiTextTrainingStats,
  normalizeBattleStats,
  normalizeFleaStats,
  normalizeMarketStats,
  normalizeTrainingStats,
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

test("achievement conditions never depend on wins, rating, rank, or AnjuPay market totals", () => {
  const conditionKeys = new Set(
    ACHIEVEMENT_DEFINITIONS.map((definition) => definition.condition?.key).filter(Boolean),
  );
  for (const forbidden of ["wins", "rating", "rank", "grossSales", "spent", "bestSale", "highestPurchase"]) {
    assert.equal(conditionKeys.has(forbidden), false, `${forbidden} must not be an achievement condition`);
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
    modeMatches: { solo: 88, strategy: 5, team: 4, team_duo: 0, royale: 3 },
    playDays: 2,
    lastPlayDateKey: "2026-07-23",
  });
});

test("only active 1on1 matches advance play days and loss streaks", () => {
  let stats = normalizeBattleStats(null);
  stats = addBattleMatch(stats, "solo", "loss", "2026-07-23");
  stats = addBattleMatch(stats, "strategy", "loss", "2026-07-23");
  stats = addBattleMatch(stats, "team", "loss", "2026-07-24");
  assert.equal(stats.currentLossStreak, 2);
  assert.equal(stats.bestLossStreak, 2);
  assert.equal(stats.playDays, 1);
  stats = addBattleMatch(stats, "solo", "draw", "2026-07-24");
  assert.equal(stats.currentLossStreak, 0);
  assert.equal(stats.bestLossStreak, 2);
  assert.equal(stats.losses, 2);
});

test("training achievements combine legacy sets with current HP workouts without rewarding wins", () => {
  const trainingStats = normalizeTrainingStats({
    sessions: 4,
    completedSets: 9,
    completedSeconds: 540,
    hpSessions: 1,
    hpWins: 99,
    hpCompletedWorkouts: 1,
    hpCompletedSeconds: 60,
  });
  assert.deepEqual(trainingStats, {
    sessions: 5,
    workouts: 10,
    seconds: 600,
  });
  const ids = eligibleAchievementIds({ trainingStats, scope: "training" });
  for (const expected of [
    "training_sessions_5",
    "training_workouts_10",
    "training_minutes_10",
  ]) assert.equal(ids.includes(expected), true, expected);
  assert.equal(
    ACHIEVEMENT_DEFINITIONS.some((definition) => (
      definition.scope === "training"
      && JSON.stringify(definition.condition).includes("Wins")
    )),
    false,
  );
});

test("AI text training achievements reward safe completion and script reach, not intensity or price", () => {
  const thresholdsByFamily = Object.fromEntries([
    "ai_training_sessions",
    "ai_training_days",
    "ai_training_script_uses",
    "ai_training_unique_buyers",
  ].map((family) => [
    family,
    ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === family)
      .map((definition) => definition.target),
  ]));
  assert.deepEqual(thresholdsByFamily, {
    ai_training_sessions: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    ai_training_days: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    ai_training_script_uses: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    ai_training_unique_buyers: [3, 10, 30, 100],
  });

  const definitions = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.scope === "ai_training");
  assert.equal(definitions.length, 34);
  assert.deepEqual(
    [...new Set(definitions.map((definition) => definition.condition.type))],
    ["ai_training_stat"],
  );
  const conditionKeys = new Set(
    definitions.map((definition) => definition.condition?.key).filter(Boolean),
  );
  for (const forbidden of [
    "bpm",
    "seconds",
    "roundSeconds",
    "streak",
    "price",
    "actualGross",
    "netSales",
    "rank",
  ]) {
    assert.equal(conditionKeys.has(forbidden), false, forbidden);
  }
});

test("AI text training stats normalize independently and unlock only their own scope", () => {
  assert.deepEqual(normalizeAiTextTrainingStats({
    completedSessions: 20.9,
    completionDays: 7.8,
    rankingUseCount: 30.2,
    uniqueBuyers: 10.7,
  }), {
    completedSessions: 20,
    completionDays: 7,
    rankingUseCount: 30,
    uniqueBuyers: 10,
  });
  assert.deepEqual(normalizeAiTextTrainingStats({
    completedSessions: -1,
    completionDays: Number.NaN,
    rankingUseCount: Number.POSITIVE_INFINITY,
    uniqueBuyers: "3",
  }), {
    completedSessions: 0,
    completionDays: 0,
    rankingUseCount: 0,
    uniqueBuyers: 3,
  });

  const ids = eligibleAchievementIds({
    aiTextTrainingStats: {
      completedSessions: 20,
      completionDays: 7,
      rankingUseCount: 30,
      uniqueBuyers: 10,
    },
    scope: "ai_training",
  });
  for (const expected of [
    "ai_training_sessions_20",
    "ai_training_days_7",
    "ai_training_script_uses_30",
    "ai_training_unique_buyers_10",
  ]) {
    assert.equal(ids.includes(expected), true, expected);
  }
  assert.equal(ids.includes("ai_training_sessions_50"), false);
  assert.equal(ids.some((id) => id.startsWith("market_")), false);
  assert.equal(
    eligibleAchievementIds({
      aiTextTrainingStats: { rankingUseCount: 300, uniqueBuyers: 100 },
      scope: "market",
    }).some((id) => id.startsWith("ai_training_")),
    false,
  );
});

test("retired team variants cannot advance any current battle stats", () => {
  let stats = normalizeBattleStats({
    totalMatches: 4,
    modeMatches: { team: 4 },
  });
  stats = addBattleMatch(stats, "team_duo", "win", "2026-07-26");
  assert.equal(stats.totalMatches, 4);
  assert.equal(stats.modeMatches.team, 4);
  assert.equal(stats.modeMatches.team_duo, 0);
  const ids = eligibleAchievementIds({ battleStats: stats, scope: "battle" });
  assert.equal(ids.includes("battle_team_5"), false);
  assert.equal(ids.includes("battle_total_1"), true);
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
    "battle_losses_30",
    "battle_loss_streak_5",
    "battle_days_7",
  ]) assert.equal(ids.includes(expected), true, expected);
  assert.equal(ids.includes("battle_variety_three_20"), false);
  assert.equal(ids.includes("battle_variety_three_5"), false);
  assert.equal(ids.includes("battle_royale_5"), false);
  assert.equal(ids.includes("battle_variety_all_5"), false);
});

test("retired team honor signals no longer unlock new achievements", () => {
  const noSignals = eligibleAchievementIds({ battleStats: null, scope: "battle" });
  assert.equal(noSignals.includes("team_oshi_jouzu_defense"), false);
  const defense = eligibleAchievementIds({
    battleStats: null,
    signals: {
      teamOshiJozuDefense: true,
      teamOshiJozuCleanDefense: true,
    },
    scope: "battle",
  });
  assert.equal(defense.includes("team_oshi_jouzu_defense"), false);
  assert.equal(defense.includes("team_oshi_jouzu_clean_defense"), false);
  const breakthrough = eligibleAchievementIds({
    battleStats: null,
    signals: {
      teamDuoBreakthrough: true,
      teamDuoCleanBreakthrough: true,
    },
    scope: "battle",
  });
  assert.equal(breakthrough.includes("team_duo_breakthrough"), false);
  assert.equal(breakthrough.includes("team_duo_clean_breakthrough"), false);
  for (const id of [
    "battle_team_1",
    "battle_variety_three_1",
    "team_oshi_jouzu_defense",
    "team_duo_breakthrough",
  ]) {
    const definition = ACHIEVEMENT_DEFINITIONS.find((candidate) => candidate.id === id);
    assert.equal(definition.legacy, true, id);
  }
});

test("already unlocked retired achievements remain normalized and visible", () => {
  const profile = normalizeAchievementProfile({
    unlocked: {
      battle_team_1: 10,
      team_duo_breakthrough: 20,
    },
    customShowcase: ["team_duo_breakthrough"],
  });
  assert.deepEqual(Object.keys(profile.unlocked).sort(), [
    "battle_team_1",
    "team_duo_breakthrough",
  ]);
  assert.deepEqual(effectiveShowcase(profile), ["team_duo_breakthrough"]);
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

test("AI text training achievements can be showcased and advance within their family", () => {
  const profile = unlockAchievements(null, [
    "ai_training_sessions_1",
    "ai_training_sessions_20",
    "ai_training_script_uses_10",
  ], 100).profile;
  profile.customShowcase = [
    "ai_training_sessions_1",
    "ai_training_script_uses_10",
  ];
  assert.deepEqual(effectiveShowcase(profile), [
    "ai_training_sessions_20",
    "ai_training_script_uses_10",
  ]);
  const payload = publicAchievementProfile(
    profile,
    null,
    null,
    null,
    {
      completedSessions: 20,
      completionDays: 7,
      rankingUseCount: 10,
      uniqueBuyers: 3,
    },
  );
  assert.deepEqual(payload.showcase, [
    "ai_training_sessions_20",
    "ai_training_script_uses_10",
  ]);
  assert.deepEqual(payload.stats.aiTraining, {
    completedSessions: 20,
    completionDays: 7,
    rankingUseCount: 10,
    uniqueBuyers: 3,
  });
});

test("market stats count days and unique counterparties independently of AnjuPay totals", () => {
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

test("active level-six families extend in place to level ten while retired records stay frozen", () => {
  const expectedThresholds = {
    battle_losses: [1, 10, 30, 100, 300, 1000, 2000, 3000, 5000, 10000],
    battle_days: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    training_sessions: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    training_workouts: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    training_minutes: [1, 10, 30, 60, 300, 1000, 3000, 10000, 30000, 60000],
    ai_training_sessions: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    ai_training_days: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    ai_training_script_uses: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    market_seller: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    market_buyer: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
  };
  for (const [family, thresholds] of Object.entries(expectedThresholds)) {
    const definitions = ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === family)
      .sort((first, second) => first.level - second.level);
    assert.deepEqual(definitions.map((definition) => definition.target), thresholds, family);
    assert.deepEqual(definitions.map((definition) => definition.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], family);
    assert.equal(definitions.at(-1).level, 10, family);
    assert.equal(definitions.slice(0, 6).every((definition) => definition.legacy !== true), true);
  }
  assert.equal(
    Math.max(...ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === "battle_variety")
      .map((definition) => definition.level)),
    6,
  );
  assert.equal(
    Math.max(...ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === "battle_variety_legacy")
      .map((definition) => definition.level)),
    6,
  );
});

test("AnjuPay flea achievements use only dedicated authoritative counts", () => {
  const stats = normalizeFleaStats({
    listings: 14.9,
    sales: 7.8,
    purchases: 30.2,
    grossSales: 999_999,
    spent: 999_999,
    favorites: 999_999,
  });
  assert.deepEqual(stats, {
    listings: 14,
    sales: 7,
    purchases: 30,
  });
  const ids = eligibleAchievementIds({ fleaStats: stats, scope: "flea" });
  for (const expected of [
    "flea_listings_14",
    "flea_sales_7",
    "flea_purchases_30",
  ]) assert.equal(ids.includes(expected), true, expected);
  assert.equal(ids.includes("flea_listings_30"), false);
  assert.equal(ids.some((id) => id.startsWith("market_")), false);
  assert.equal(
    eligibleAchievementIds({ fleaStats: stats, scope: "market" })
      .some((id) => id.startsWith("flea_")),
    false,
  );
  const definitions = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.scope === "flea");
  assert.equal(definitions.length, 30);
  assert.equal(definitions.every((definition) => definition.autoPublic === false), true);
  assert.deepEqual(
    [...new Set(definitions.map((definition) => definition.condition.type))],
    ["flea_stat"],
  );
  for (const forbidden of ["price", "grossSales", "spent", "favorites", "rank", "streak"]) {
    assert.equal(
      definitions.some((definition) => definition.condition.key === forbidden),
      false,
      forbidden,
    );
  }
  const profile = unlockAchievements(null, [
    "flea_listings_1",
    "flea_listings_14",
    "flea_sales_1",
  ], 100).profile;
  assert.deepEqual(effectiveShowcase(profile), []);
  profile.customShowcase = ["flea_listings_1", "flea_sales_1"];
  assert.deepEqual(effectiveShowcase(profile), [
    "flea_listings_14",
    "flea_sales_1",
  ]);
  const payload = publicAchievementProfile(
    profile,
    null,
    null,
    null,
    null,
    stats,
  );
  assert.deepEqual(payload.stats.flea, stats);
});

test("browser and Functions catalogs expose the same achievement IDs", () => {
  const source = fs.readFileSync(path.join(root, "achievements.js"), "utf8");
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { window, document: {}, console });
  const browserIds = [...window.HariaiAchievements.catalog].map((definition) => definition.id).sort();
  const serverIds = ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id).sort();
  assert.deepEqual(browserIds, serverIds);
  const metadata = (definition) => ({
    id: definition.id,
    scope: definition.scope,
    category: definition.category,
    family: definition.family,
    familyLabel: definition.familyLabel,
    icon: definition.icon,
    level: definition.level,
    target: definition.target,
    name: definition.name,
    description: definition.description,
    hint: definition.hint,
    autoPublic: definition.autoPublic,
    legacy: definition.legacy === true,
  });
  const synchronizedFamilies = new Set([
    "battle_losses",
    "battle_days",
    "training_sessions",
    "training_workouts",
    "training_minutes",
    "ai_training_sessions",
    "ai_training_days",
    "ai_training_script_uses",
    "market_seller",
    "market_buyer",
    "flea_listings",
    "flea_sales",
    "flea_purchases",
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify([...window.HariaiAchievements.catalog]
      .filter((definition) => synchronizedFamilies.has(definition.family))
      .map(metadata))),
    ACHIEVEMENT_DEFINITIONS
      .filter((definition) => synchronizedFamilies.has(definition.family))
      .map(metadata),
  );
  const browserAiTraining = [...window.HariaiAchievements.catalog]
    .filter((definition) => definition.scope === "ai_training")
    .map(({
      id, scope, category, family, familyLabel, icon, level, target, name, description, hint,
    }) => ({
      id, scope, category, family, familyLabel, icon, level, target, name, description, hint,
    }));
  const serverAiTraining = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.scope === "ai_training")
    .map(({
      id, scope, category, family, familyLabel, icon, level, target, name, description, hint,
    }) => ({
      id, scope, category, family, familyLabel, icon, level, target, name, description, hint,
    }));
  assert.deepEqual(
    JSON.parse(JSON.stringify(browserAiTraining)),
    serverAiTraining,
  );
  const collectionHtml = window.HariaiAchievements.renderCollection({ unlocked: {} });
  for (const copy of [
    "文字コラトレーニング",
    "BPMや運動強度ではなく、自分のペースで5ラウンドを終えた歩み",
    "応援台本の販売",
    "価格や売上額ではなく、応援が利用された回数と広がりの記録",
    "自分のペースで5ラウンドを終えると解除",
    "日にちを分けて文字コラを続けると解除",
    "同じ利用者からはJSTの1日1回だけ数える",
    "いろいろな人へ応援が届くと解除",
    "AnjuPayフリマ・一日棚",
    "AnjuPayフリマ・ご縁",
    "連続日数ではなく、自分のペースで一品を言葉にした日々の記録",
    "売上額や順位ではなく、一品が届いた回数と出会いの記録",
  ]) {
    assert.match(collectionHtml, new RegExp(copy));
  }
  const finalCollectionHtml = window.HariaiAchievements.renderCollection({
    unlocked: { market_seller_10000: 100 },
  });
  assert.match(finalCollectionHtml, /achievement-level-10 is-final/);
  assert.match(finalCollectionHtml, /FINAL ACHIEVEMENT/);
  assert.match(finalCollectionHtml, /Lv\.10 \/ 10・最終実績/);
  const finalBadgeHtml = window.HariaiAchievements.renderBadges(["market_seller_10000"]);
  assert.match(finalBadgeHtml, /achievement-level-10 is-final/);
  assert.match(finalBadgeHtml, /FINAL Lv\.10/);
  assert.deepEqual(
    [...window.HariaiAchievements.orderUnlockIds([
      "market_seller_500",
      "market_seller_1000",
      "market_seller_3000",
      "market_seller_10000",
    ])],
    ["market_seller_10000", "market_seller_3000", "market_seller_1000", "market_seller_500"],
  );
});
