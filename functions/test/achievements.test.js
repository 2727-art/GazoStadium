"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  ACHIEVEMENT_DEFINITIONS,
  CROWN_MONTHLY_ACHIEVEMENT_START_KEY,
  addBattleMatch,
  addCrownMonthlyParticipation,
  addMarketTransaction,
  deriveBattleStatsFromPeriods,
  effectiveShowcase,
  eligibleAchievementIds,
  normalizeAchievementProfile,
  normalizeAiTextTrainingStats,
  normalizeBattleStats,
  normalizeCrownMonthlyStats,
  normalizeDanwakuStats,
  normalizeFleaStats,
  normalizeMarketStats,
  normalizeRouletteTrainingStats,
  normalizeTrainingStats,
  publicAchievementProfile,
  finalizeCrownMonthlyAchievement,
  unlockAchievements,
} = require("../achievements");
const { CROWN_CIRCUIT_CUTOVER_KEYS } = require("../crown-circuit");

const root = path.resolve(__dirname, "..", "..");
const SECRET_LOSS_STREAK_IDS = Object.freeze([
  "battle_loss_streak_secret_100",
  "battle_loss_streak_secret_200",
]);

test("battle thresholds keep early levels stable while opening a level-ten ceiling", () => {
  const totalThresholds = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.family === "battle_total")
    .map((definition) => definition.target);
  assert.deepEqual(
    totalThresholds,
    [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
  );
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === "battle_total_100").level, 4);
  assert.equal(ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === "battle_solo_100").level, 5);
});

test("generic progression avoids wins, rating, raw rank, and AnjuPay totals while Crown uses finalized counters", () => {
  const conditionKeys = new Set(
    ACHIEVEMENT_DEFINITIONS.map((definition) => definition.condition?.key).filter(Boolean),
  );
  for (const forbidden of ["wins", "rating", "rank", "grossSales", "spent", "bestSale", "highestPurchase"]) {
    assert.equal(conditionKeys.has(forbidden), false, `${forbidden} must not be an achievement condition`);
  }
});

test("DOLLM＠STER is a manual-only special collection achievement", () => {
  const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === "special_dollmaster");
  assert.deepEqual({
    scope: definition.scope,
    category: definition.category,
    family: definition.family,
    name: definition.name,
    autoPublic: definition.autoPublic,
    conditionType: definition.condition.type,
  }, {
    scope: "special",
    category: "special_collection",
    family: "special_dollmaster",
    name: "DOLLM＠STER",
    autoPublic: false,
    conditionType: "manual_code",
  });
  assert.equal(eligibleAchievementIds({}).includes(definition.id), false);
  assert.equal(eligibleAchievementIds({ scope: "special" }).includes(definition.id), false);

  const first = unlockAchievements(null, [definition.id], 1234);
  assert.deepEqual(first.newlyUnlocked, [definition.id]);
  assert.equal(first.profile.unlocked[definition.id], 1234);
  assert.equal(first.profile.pendingUnlocks[definition.id], 1234);
  assert.deepEqual(effectiveShowcase(first.profile), []);
  const replay = unlockAchievements(first.profile, [definition.id], 5678);
  assert.deepEqual(replay.newlyUnlocked, []);
  assert.equal(replay.profile.unlocked[definition.id], 1234);
});

test("monthly Crown achievements start in August and participation receipts are idempotent", () => {
  assert.equal(CROWN_MONTHLY_ACHIEVEMENT_START_KEY, "2026-08");
  assert.equal(CROWN_MONTHLY_ACHIEVEMENT_START_KEY, CROWN_CIRCUIT_CUTOVER_KEYS.monthly);
  const july = addCrownMonthlyParticipation(null, "2026-07", 100);
  assert.equal(july.participations, 0);
  let stats = addCrownMonthlyParticipation(july, "2026-08", 200);
  stats = addCrownMonthlyParticipation(stats, "2026-08", 300);
  assert.equal(stats.participations, 1);
  assert.deepEqual(
    eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
      .filter((id) => id.startsWith("crown_monthly_")),
    ["crown_monthly_participated_1"],
  );
});

test("a lone monthly opening qualifies without granting placement or champion achievements", () => {
  let stats = finalizeCrownMonthlyAchievement(null, {
    key: "2026-08",
    rank: 1,
    participantCount: 1,
    finalizedAt: 1000,
  });
  stats = addCrownMonthlyParticipation(stats, "2026-09", 2000);
  stats = addCrownMonthlyParticipation(stats, "2026-08", 3000);
  assert.deepEqual({
    participations: stats.participations,
    qualifiedMonths: stats.qualifiedMonths,
    top10Months: stats.top10Months,
    top3Months: stats.top3Months,
    championMonths: stats.championMonths,
  }, {
    participations: 2,
    qualifiedMonths: 1,
    top10Months: 0,
    top3Months: 0,
    championMonths: 0,
  });
  assert.deepEqual(
    eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
      .filter((id) => id.startsWith("crown_monthly_")),
    ["crown_monthly_participated_1", "crown_monthly_qualified_1"],
  );
  assert.equal(stats.periods["2026-08"].finalized, true);
  assert.equal(stats.periods["2026-08"].rank, 1);
});

test("three monthly Crown results unlock repeat milestones without requiring a championship", () => {
  let stats = null;
  for (const key of ["2026-08", "2026-09", "2026-10"]) {
    stats = finalizeCrownMonthlyAchievement(stats, {
      key,
      rank: 10,
      participantCount: 20,
      finalizedAt: Date.parse(`${key}-28T00:00:00+09:00`),
    });
  }
  const ids = eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
    .filter((id) => id.startsWith("crown_monthly_"));
  assert.equal(ids.includes("crown_monthly_qualified_3"), true);
  assert.equal(ids.includes("crown_monthly_top10_3"), true);
  assert.equal(ids.includes("crown_monthly_top3_3"), false);
  assert.equal(ids.includes("crown_monthly_champion_1"), false);
});

test("monthly Crown milestones reach the tenth championship", () => {
  let stats = null;
  const finalize = (key, rank) => {
    stats = finalizeCrownMonthlyAchievement(stats, {
      key,
      rank,
      participantCount: 20,
      finalizedAt: Date.parse(`${key}-28T00:00:00+09:00`),
    });
  };
  finalize("2026-08", 10);
  finalize("2026-09", 3);
  finalize("2026-10", 1);
  let ids = eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
    .filter((id) => id.startsWith("crown_monthly_"));
  assert.deepEqual(ids, [
    "crown_monthly_participated_1",
    "crown_monthly_qualified_1",
    "crown_monthly_top10_1",
    "crown_monthly_top3_1",
    "crown_monthly_champion_1",
    "crown_monthly_qualified_3",
    "crown_monthly_top10_3",
  ]);
  finalize("2026-11", 2);
  finalize("2026-12", 1);
  finalize("2027-01", 1);
  ids = eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
    .filter((id) => id.startsWith("crown_monthly_"));
  assert.equal(ids.includes("crown_monthly_top3_3"), true);
  assert.equal(ids.includes("crown_monthly_champion_3"), true);
  assert.equal(ids.includes("crown_monthly_champion_10"), false);
  for (const key of ["2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08"]) {
    finalize(key, 1);
  }
  assert.equal(stats.championMonths, 10);
  ids = eligibleAchievementIds({ crownMonthlyStats: stats, scope: "battle" })
    .filter((id) => id.startsWith("crown_monthly_"));
  assert.equal(ids.at(-1), "crown_monthly_champion_10");
  const replayed = finalizeCrownMonthlyAchievement(stats, {
    key: "2027-08",
    rank: 1,
    participantCount: 20,
    finalizedAt: Date.parse("2027-08-28T00:00:00+09:00"),
  });
  assert.equal(replayed.championMonths, 10);
  assert.deepEqual(normalizeCrownMonthlyStats(replayed), replayed);
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

test("secret loss streak achievements use exact best-streak boundaries without inferring from total losses", () => {
  const secretIdsAt = (bestLossStreak) => eligibleAchievementIds({
    battleStats: {
      totalMatches: 1_000,
      losses: 500,
      currentLossStreak: 0,
      bestLossStreak,
    },
    scope: "battle",
  }).filter((id) => SECRET_LOSS_STREAK_IDS.includes(id));

  assert.deepEqual(secretIdsAt(99), []);
  assert.deepEqual(secretIdsAt(100), ["battle_loss_streak_secret_100"]);
  assert.deepEqual(secretIdsAt(199), ["battle_loss_streak_secret_100"]);
  assert.deepEqual(secretIdsAt(200), SECRET_LOSS_STREAK_IDS);
  assert.deepEqual(
    eligibleAchievementIds({
      battleStats: {
        totalMatches: 500,
        losses: 500,
        currentLossStreak: 0,
        bestLossStreak: 0,
      },
      scope: "battle",
    }).filter((id) => SECRET_LOSS_STREAK_IDS.includes(id)),
    [],
  );

  const existingLossStreak = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.family === "battle_loss_streak")
    .sort((first, second) => first.level - second.level);
  assert.deepEqual(
    existingLossStreak.map((definition) => definition.target),
    [3, 5, 8, 12, 16, 20, 25, 30, 40, 50],
  );
  assert.equal(existingLossStreak.at(-1).id, "battle_loss_streak_50");
  assert.equal(existingLossStreak.at(-1).level, 10);

  const historicalStats = normalizeBattleStats({
    totalMatches: 500,
    losses: 300,
    currentLossStreak: 0,
    bestLossStreak: 200,
  });
  const retroactive = unlockAchievements(
    { unlocked: { battle_loss_streak_50: 1 } },
    eligibleAchievementIds({ battleStats: historicalStats, scope: "battle" }),
    2_000,
  );
  assert.deepEqual(
    retroactive.newlyUnlocked.filter((id) => SECRET_LOSS_STREAK_IDS.includes(id)),
    SECRET_LOSS_STREAK_IDS,
  );
  assert.equal(retroactive.profile.unlocked.battle_loss_streak_50, 1);
  assert.equal(retroactive.profile.unlocked.battle_loss_streak_secret_100, 2_000);
  assert.equal(retroactive.profile.unlocked.battle_loss_streak_secret_200, 2_000);
});

test("retired Training 60 aggregates remain readable but cannot unlock new achievements", () => {
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
  assert.deepEqual(ids, []);
  assert.equal(
    ACHIEVEMENT_DEFINITIONS.every((definition) => (
      definition.scope !== "training"
      || (definition.legacy === true && definition.hint === "終了したモードの記録")
    )),
    true,
  );
  assert.equal(
    ACHIEVEMENT_DEFINITIONS.some((definition) => (
      definition.scope === "training"
      && JSON.stringify(definition.condition).includes("Wins")
    )),
    false,
  );
});

test("Danwaku NOTE achievements use the canonical highest-ever boundary and stay opt-in", () => {
  const definitions = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.family === "danwaku_streak")
    .sort((first, second) => first.level - second.level);
  assert.deepEqual(
    definitions.map((definition) => definition.target),
    [1, 3, 7, 14, 30, 60, 100, 180, 270, 365],
  );
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ["発心の一歩", "一念の灯", "精進の芽", "日々の歩み", "不放逸のしるし", "心調う", "蓮のつぼみ", "蓮華ひらく", "光の道標", "無尽の歩み"],
  );
  assert.deepEqual(definitions.map((definition) => definition.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(definitions.every((definition) => definition.scope === "danwaku"), true);
  assert.equal(definitions.every((definition) => definition.category === "danwaku_note"), true);
  assert.equal(definitions.every((definition) => definition.icon === "蓮"), true);
  assert.equal(definitions.every((definition) => definition.autoPublic === false), true);
  assert.equal(definitions.every((definition) => definition.legacy === false), true);
  assert.deepEqual(
    definitions.map((definition) => definition.condition),
    definitions.map((definition) => ({
      type: "danwaku_stat",
      key: "highestEverDays",
      target: definition.target,
    })),
  );

  assert.deepEqual(normalizeDanwakuStats(null), { highestEverDays: 0 });
  assert.deepEqual(
    normalizeDanwakuStats({ highestEverDays: 7.9, bestDays: 30, bestStreakDays: 60 }),
    { highestEverDays: 7 },
  );
  assert.deepEqual(normalizeDanwakuStats({ bestDays: 14.9 }), { highestEverDays: 14 });
  assert.deepEqual(normalizeDanwakuStats({ bestStreakDays: 30.9 }), { highestEverDays: 30 });

  const idsAt = (highestEverDays) => eligibleAchievementIds({
    danwakuStats: { highestEverDays },
    scope: "danwaku",
  });
  assert.deepEqual(idsAt(0), []);
  assert.deepEqual(idsAt(6), ["danwaku_streak_1", "danwaku_streak_3"]);
  assert.deepEqual(idsAt(7), ["danwaku_streak_1", "danwaku_streak_3", "danwaku_streak_7"]);
  assert.equal(idsAt(13).includes("danwaku_streak_14"), false);
  assert.equal(idsAt(14).includes("danwaku_streak_14"), true);
  assert.equal(idsAt(364).includes("danwaku_streak_365"), false);
  assert.equal(idsAt(365).includes("danwaku_streak_365"), true);
  assert.equal(
    eligibleAchievementIds({ danwakuStats: { highestEverDays: 365 }, scope: "battle" })
      .some((id) => id.startsWith("danwaku_streak_")),
    false,
  );

  const profile = unlockAchievements(null, ["danwaku_streak_1"], 100).profile;
  assert.deepEqual(effectiveShowcase(profile), []);
  profile.customShowcase = ["danwaku_streak_1"];
  assert.deepEqual(effectiveShowcase(profile), ["danwaku_streak_1"]);
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
    ai_training_unique_buyers: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
  });

  const definitions = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.scope === "ai_training");
  assert.equal(definitions.length, 40);
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

test("roulette training pack sales achievements reward use and reach, not Pay, rank, or exercise results", () => {
  const thresholdsByFamily = Object.fromEntries([
    "roulette_training_pack_uses",
    "roulette_training_unique_buyers",
  ].map((family) => [
    family,
    ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === family)
      .map((definition) => definition.target),
  ]));
  assert.deepEqual(thresholdsByFamily, {
    roulette_training_pack_uses: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    roulette_training_unique_buyers: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
  });

  const definitions = ACHIEVEMENT_DEFINITIONS
    .filter((definition) => definition.scope === "roulette_training");
  assert.equal(definitions.length, 20);
  assert.equal(
    definitions.every((definition) => definition.category === "roulette_training_pack_sales"),
    true,
  );
  assert.equal(definitions.every((definition) => definition.autoPublic === true), true);
  assert.equal(definitions.every((definition) => definition.legacy === false), true);
  assert.deepEqual(
    [...new Set(definitions.map((definition) => definition.condition.type))],
    ["roulette_training_stat"],
  );
  assert.deepEqual(
    [...new Set(definitions.map((definition) => definition.condition.key))],
    ["rankingUseCount", "uniqueBuyers"],
  );
  for (const forbidden of [
    "price",
    "actualGross",
    "rankingGross",
    "netSales",
    "feesPaid",
    "rank",
    "completedCount",
    "targetCount",
    "bpm",
    "maximumReachedBpm",
  ]) {
    assert.equal(
      definitions.some((definition) => definition.condition.key === forbidden),
      false,
      forbidden,
    );
  }
});

test("roulette training seller stats normalize independently and unlock only their own scope", () => {
  const stats = normalizeRouletteTrainingStats({
    rankingUseCount: 30.9,
    uniqueBuyers: "10",
    actualGross: 999_999,
    rankingGross: 999_999,
    netSales: 999_999,
    rank: 1,
    completedCount: 10_000,
    bpm: 300,
  });
  assert.deepEqual(stats, {
    rankingUseCount: 30,
    uniqueBuyers: 10,
  });
  assert.deepEqual(normalizeRouletteTrainingStats({
    rankingUseCount: Number.POSITIVE_INFINITY,
    uniqueBuyers: -1,
  }), {
    rankingUseCount: 0,
    uniqueBuyers: 0,
  });

  const ids = eligibleAchievementIds({
    rouletteTrainingStats: stats,
    scope: "roulette_training",
  });
  for (const expected of [
    "roulette_training_pack_uses_1",
    "roulette_training_pack_uses_3",
    "roulette_training_pack_uses_10",
    "roulette_training_pack_uses_30",
    "roulette_training_unique_buyers_3",
    "roulette_training_unique_buyers_10",
  ]) assert.equal(ids.includes(expected), true, expected);
  assert.equal(ids.includes("roulette_training_pack_uses_100"), false);
  assert.equal(ids.includes("roulette_training_unique_buyers_30"), false);
  assert.equal(ids.some((id) => id.startsWith("ai_training_")), false);
  assert.equal(
    eligibleAchievementIds({
      rouletteTrainingStats: { rankingUseCount: 10_000, uniqueBuyers: 3_000 },
      scope: "market",
    }).some((id) => id.startsWith("roulette_training_")),
    false,
  );

  const profile = unlockAchievements(null, ids, 100).profile;
  assert.deepEqual(effectiveShowcase(profile), [
    "roulette_training_pack_uses_30",
    "roulette_training_unique_buyers_10",
  ]);
  const payload = publicAchievementProfile(
    profile,
    null,
    null,
    null,
    null,
    null,
    stats,
  );
  assert.deepEqual(payload.stats.rouletteTraining, stats);
});

test("achievement state lazily backfills roulette training sales from server-authoritative seller stats", () => {
  const source = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
  assert.match(source, /function rouletteTrainingSellerStatsRef\(uid\)/);
  assert.match(source, /transaction\.get\(rouletteSellerStatsRef\)/);
  assert.match(source, /normalizeRouletteTrainingStats\(\s*rouletteSellerStatsSnapshot\.data\(\)/);
  assert.match(source, /eligibleAchievementIds\(\{[\s\S]*?rouletteTrainingStats,[\s\S]*?\}\)/);
  assert.match(source, /state\.rouletteTrainingStats/);
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
      training_sessions_1: 30,
    },
    customShowcase: ["team_duo_breakthrough", "training_sessions_1"],
  });
  assert.deepEqual(Object.keys(profile.unlocked).sort(), [
    "battle_team_1",
    "team_duo_breakthrough",
    "training_sessions_1",
  ]);
  assert.deepEqual(effectiveShowcase(profile), [
    "team_duo_breakthrough",
    "training_sessions_1",
  ]);
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

test("secret loss streak achievements stay private, normalize safely, and can be showcased independently", () => {
  const definitions = SECRET_LOSS_STREAK_IDS.map((id) => (
    ACHIEVEMENT_DEFINITIONS.find((definition) => definition.id === id)
  ));
  assert.deepEqual(definitions.map((definition) => definition.target), [100, 200]);
  assert.deepEqual(definitions.map((definition) => definition.condition), [
    { type: "battle_stat", key: "bestLossStreak", target: 100 },
    { type: "battle_stat", key: "bestLossStreak", target: 200 },
  ]);
  assert.equal(definitions.every((definition) => definition.secret === true), true);
  assert.equal(definitions.every((definition) => definition.autoPublic === false), true);
  assert.equal(new Set(definitions.map((definition) => definition.family)).size, 2);

  const profile = unlockAchievements(null, SECRET_LOSS_STREAK_IDS, 100).profile;
  assert.deepEqual(effectiveShowcase(profile), []);
  profile.customShowcase = ["battle_loss_streak_secret_100"];
  assert.deepEqual(effectiveShowcase(profile), ["battle_loss_streak_secret_100"]);
  profile.customShowcase = ["battle_loss_streak_secret_200"];
  assert.deepEqual(effectiveShowcase(profile), ["battle_loss_streak_secret_200"]);
  profile.customShowcase = [...SECRET_LOSS_STREAK_IDS];
  assert.deepEqual(effectiveShowcase(profile), SECRET_LOSS_STREAK_IDS);

  const normalized = normalizeAchievementProfile({
    unlocked: {
      battle_loss_streak_secret_100: 100,
      battle_loss_streak_secret_200: 200,
      unknown_secret_loss_streak: 300,
    },
    pendingUnlocks: {
      battle_loss_streak_secret_100: 100,
      battle_loss_streak_secret_200: 200,
      unknown_secret_loss_streak: 300,
    },
    customShowcase: [...SECRET_LOSS_STREAK_IDS, "unknown_secret_loss_streak"],
  });
  assert.deepEqual(Object.keys(normalized.unlocked), SECRET_LOSS_STREAK_IDS);
  assert.deepEqual(Object.keys(normalized.pendingUnlocks), SECRET_LOSS_STREAK_IDS);
  assert.deepEqual(normalized.customShowcase, SECRET_LOSS_STREAK_IDS);
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

test("all active progression families extend in place to level ten while retired and discovery records stay frozen", () => {
  const expectedThresholds = {
    battle_total: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    battle_solo: [1, 5, 20, 50, 100, 300, 1000, 3000, 5000, 10000],
    battle_strategy: [1, 5, 20, 50, 100, 300, 1000, 3000, 5000, 10000],
    battle_losses: [1, 10, 30, 100, 300, 1000, 2000, 3000, 5000, 10000],
    battle_loss_streak: [3, 5, 8, 12, 16, 20, 25, 30, 40, 50],
    battle_days: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    crown_monthly: [1, 1, 1, 1, 1, 3, 3, 3, 3, 10],
    training_sessions: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    training_workouts: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    training_minutes: [1, 10, 30, 60, 300, 1000, 3000, 10000, 30000, 60000],
    danwaku_streak: [1, 3, 7, 14, 30, 60, 100, 180, 270, 365],
    ai_training_sessions: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    ai_training_days: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    ai_training_script_uses: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    ai_training_unique_buyers: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    roulette_training_pack_uses: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    roulette_training_unique_buyers: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    market_seller: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    market_buyer: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    market_both: [1, 3, 10, 30, 100, 200, 300, 500, 1000, 3000],
    market_days: [2, 7, 30, 100, 180, 300, 365, 500, 730, 1000],
    market_partners: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
  };
  const retiredTrainingFamilies = new Set([
    "training_sessions",
    "training_workouts",
    "training_minutes",
  ]);
  for (const [family, thresholds] of Object.entries(expectedThresholds)) {
    const definitions = ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === family)
      .sort((first, second) => first.level - second.level);
    assert.deepEqual(definitions.map((definition) => definition.target), thresholds, family);
    assert.deepEqual(definitions.map((definition) => definition.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], family);
    assert.equal(definitions.at(-1).level, 10, family);
    assert.equal(
      definitions.every((definition) => definition.legacy === true),
      retiredTrainingFamilies.has(family),
      family,
    );
  }
  assert.equal(
    ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === "battle_loss_streak")
      .every((definition) => definition.autoPublic === false),
    true,
  );
  for (const family of ["battle_team", "battle_royale"]) {
    const definitions = ACHIEVEMENT_DEFINITIONS
      .filter((definition) => definition.family === family);
    assert.equal(Math.max(...definitions.map((definition) => definition.level)), 7, family);
    assert.equal(definitions.every((definition) => definition.legacy === true), true, family);
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
  for (const family of [
    "market_first_turn",
    "market_extended",
    "market_third_turn",
    "market_both_roles_day",
    "market_role_switch",
  ]) {
    assert.equal(
      Math.max(...ACHIEVEMENT_DEFINITIONS
        .filter((definition) => definition.family === family)
        .map((definition) => definition.level)),
      1,
      family,
    );
  }
});

test("new level-ten progression achievements unlock from their existing neutral stats only", () => {
  const battleIds = eligibleAchievementIds({
    battleStats: {
      totalMatches: 30_000,
      losses: 10_000,
      bestLossStreak: 50,
      modeMatches: {
        solo: 10_000,
        strategy: 10_000,
      },
      playDays: 1000,
    },
    scope: "battle",
  });
  for (const id of [
    "battle_total_30000",
    "battle_solo_10000",
    "battle_strategy_10000",
    "battle_loss_streak_50",
  ]) assert.equal(battleIds.includes(id), true, id);

  const aiIds = eligibleAchievementIds({
    aiTextTrainingStats: { uniqueBuyers: 3000 },
    scope: "ai_training",
  });
  assert.equal(aiIds.includes("ai_training_unique_buyers_3000"), true);

  const rouletteIds = eligibleAchievementIds({
    rouletteTrainingStats: { rankingUseCount: 10_000, uniqueBuyers: 3000 },
    scope: "roulette_training",
  });
  assert.equal(rouletteIds.includes("roulette_training_pack_uses_10000"), true);
  assert.equal(rouletteIds.includes("roulette_training_unique_buyers_3000"), true);

  const marketIds = eligibleAchievementIds({
    marketStats: {
      salesCount: 3000,
      purchases: 3000,
      marketDays: 1000,
      uniqueCounterparties: 3000,
    },
    scope: "market",
  });
  for (const id of [
    "market_both_3000",
    "market_days_1000",
    "market_partners_3000",
  ]) assert.equal(marketIds.includes(id), true, id);
});

test("the final achievement preview and cache marker cover the newly opened families", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const online = fs.readFileSync(path.join(root, "online.js"), "utf8");
  const marker = "all-active-achievements-lv10-v1";
  const crownMarker = "crown-monthly-achievements-v1";
  const secretLossMarker = "loss-streak-secrets-v1";
  assert.equal((html.match(new RegExp(marker, "g")) || []).length, 2);
  assert.equal((html.match(new RegExp(crownMarker, "g")) || []).length, 4);
  assert.equal((html.match(new RegExp(secretLossMarker, "g")) || []).length, 3);
  assert.match(html, new RegExp(`achievements\\.js\\?v=[^"]*${marker}`));
  assert.match(html, new RegExp(`online\\.js\\?v=[^"]*${marker}`));
  for (const asset of ["styles.css", "achievements.js", "online.js"]) {
    assert.match(html, new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]*${secretLossMarker}`), asset);
  }
  for (const asset of ["styles.css", "app.js", "flea-market.js"]) {
    const reference = html.match(new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]+`))?.[0] || "";
    assert.equal(reference.includes(marker), false, asset);
  }
  for (const id of [
    "battle_total_30000",
    "battle_solo_10000",
    "battle_strategy_10000",
    "battle_loss_streak_50",
    "ai_training_unique_buyers_3000",
    "market_both_3000",
    "market_days_1000",
    "market_partners_3000",
    "crown_monthly_champion_10",
  ]) assert.match(online, new RegExp(id), id);
  assert.match(online, /achievementPreview === "loss-secret"/);
  for (const id of SECRET_LOSS_STREAK_IDS) assert.match(online, new RegExp(id), id);
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
    secret: definition.secret === true,
  });
  const synchronizedFamilies = new Set([
    "special_dollmaster",
    "battle_total",
    "battle_solo",
    "battle_strategy",
    "battle_losses",
    "battle_loss_streak",
    "battle_loss_streak_secret_100",
    "battle_loss_streak_secret_200",
    "battle_days",
    "crown_monthly",
    "training_sessions",
    "training_workouts",
    "training_minutes",
    "danwaku_streak",
    "ai_training_sessions",
    "ai_training_days",
    "ai_training_script_uses",
    "ai_training_unique_buyers",
    "roulette_training_pack_uses",
    "roulette_training_unique_buyers",
    "market_seller",
    "market_buyer",
    "market_both",
    "market_days",
    "market_partners",
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
    "ルーレットトレーニング・パック販売",
    "価格や売上額、ランキング順位ではなく、トレーニングパックが利用された回数と広がりの記録",
    "同じ利用者からはJSTの1日1回だけ数える",
    "いろいろな人へトレーニングメニューが届くと解除",
    "AnjuPayフリマ・一日棚",
    "AnjuPayフリマ・ご縁",
    "断惑NOTE",
    "断ちたい習慣と向き合い、自分で継続を記した日々の歩み",
    "断惑継続を自分のペースで記録すると解除",
    "月間王座",
    "2026年8月以降の検証済み月間王座で刻む、参加・入賞・戴冠の記録",
    "連続日数ではなく、自分のペースで一品を言葉にした日々の記録",
    "売上額や順位ではなく、一品が届いた回数と出会いの記録",
    "SPECIAL COLLECTION",
    "別のゲームで獲得した実績コードを入力すると解除",
  ]) {
    assert.match(collectionHtml, new RegExp(copy));
  }
  assert.equal((collectionHtml.match(/SECRET RECORD/g) || []).length, 2);
  assert.match(collectionHtml, /achievement-level-1 is-secret/);
  assert.match(collectionHtml, /条件は解除まで非公開です/);
  assert.doesNotMatch(collectionHtml, /百敗の主演|敗北劇の名優|100連敗|200連敗/);

  const firstSecretCollectionHtml = window.HariaiAchievements.renderCollection({
    unlocked: { battle_loss_streak_secret_100: 102 },
    showcase: ["battle_loss_streak_secret_100"],
  });
  assert.match(firstSecretCollectionHtml, /百敗の主演/);
  assert.match(firstSecretCollectionHtml, /SECRET ACHIEVEMENT/);
  assert.match(firstSecretCollectionHtml, /シークレット実績・取得済み/);
  assert.doesNotMatch(firstSecretCollectionHtml, /敗北劇の名優|200連敗/);

  const allSecretCollectionHtml = window.HariaiAchievements.renderCollection({
    unlocked: {
      battle_loss_streak_secret_100: 102,
      battle_loss_streak_secret_200: 103,
    },
    showcase: ["battle_loss_streak_secret_100"],
  });
  assert.match(allSecretCollectionHtml, /百敗の主演/);
  assert.match(allSecretCollectionHtml, /敗北劇の名優/);
  assert.equal((allSecretCollectionHtml.match(/achievement-secret-mark/g) || []).length, 2);
  assert.equal((allSecretCollectionHtml.match(/is-showcased/g) || []).length, 1);
  const secretBadgeHtml = window.HariaiAchievements.renderBadges(SECRET_LOSS_STREAK_IDS);
  assert.equal((secretBadgeHtml.match(/is-secret/g) || []).length, 2);
  assert.equal((secretBadgeHtml.match(/SECRET/g) || []).length, 2);
  assert.doesNotMatch(secretBadgeHtml, /Lv\.1/);
  assert.deepEqual(
    [...window.HariaiAchievements.orderUnlockIds([
      "battle_loss_streak_secret_100",
      "battle_total_30000",
      "battle_loss_streak_secret_200",
    ])],
    [
      "battle_total_30000",
      "battle_loss_streak_secret_200",
      "battle_loss_streak_secret_100",
    ],
  );
  const finalCollectionHtml = window.HariaiAchievements.renderCollection({
    unlocked: {
      battle_total_30000: 100,
      market_seller_10000: 99,
      crown_monthly_champion_10: 98,
    },
  });
  assert.match(finalCollectionHtml, /achievement-level-10 is-final/);
  assert.match(finalCollectionHtml, /FINAL ACHIEVEMENT/);
  assert.match(finalCollectionHtml, /Lv\.10 \/ 10・最終実績/);
  assert.match(finalCollectionHtml, /スタジアムの歴史/);
  const finalBadgeHtml = window.HariaiAchievements.renderBadges(["market_seller_10000"]);
  assert.match(finalBadgeHtml, /achievement-level-10 is-final/);
  assert.match(finalBadgeHtml, /FINAL Lv\.10/);
  const dollmasterCollectionHtml = window.HariaiAchievements.renderCollection({
    unlocked: { special_dollmaster: 101 },
    showcase: ["special_dollmaster"],
  });
  assert.match(dollmasterCollectionHtml, /DOLLM＠STER/);
  assert.match(dollmasterCollectionHtml, /achievement-level-1 is-dollmaster/);
  assert.match(dollmasterCollectionHtml, /特典コード実績・取得済み/);
  assert.match(dollmasterCollectionHtml, /LIMITED LEGENDARY/);
  const dollmasterBadgeHtml = window.HariaiAchievements.renderBadges(["special_dollmaster"]);
  assert.match(dollmasterBadgeHtml, /is-dollmaster/);
  assert.match(dollmasterBadgeHtml, /SPECIAL/);
  assert.doesNotMatch(dollmasterBadgeHtml, /Lv\.1/);
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
