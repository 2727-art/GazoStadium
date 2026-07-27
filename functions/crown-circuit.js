"use strict";

const CROWN_CIRCUIT_RULESET_VERSION = 2;
const CROWN_CIRCUIT_MODES = Object.freeze(["solo", "strategy"]);
const CROWN_DAILY_MATCH_LIMIT = 3;
const CROWN_DAILY_OPPONENT_LIMIT = 2;
const CROWN_DAILY_DELTA_FACTOR = 160;
const CROWN_DAILY_DELTA_LIMIT = 120;
const CROWN_WEEKLY_BEST_DAYS = 3;
const CROWN_MONTHLY_BEST_WEEKS = 3;
const CROWN_WEEKLY_MIN_DAYS = 2;
const CROWN_MONTHLY_MIN_WEEKS = 2;
const CROWN_PROMOTION_MIN_PARTICIPANTS = 4;
const CROWN_CIRCUIT_CUTOVER_KEYS = Object.freeze({
  daily: "2026-07-28",
  weekly: "2026-08-03",
  monthly: "2026-08",
});
const CROWN_THEMES = Object.freeze(["rose", "aqua", "violet", "gold"]);
const CROWN_SIGNATURE_IDS = Object.freeze([
  "upset",
  "triple_unbeaten",
  "dual_mode",
  "daily_champion",
  "weekly_champion",
  "monthly_champion",
]);

function integer(value, minimum = 0, maximum = 100_000, fallback = minimum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function decimal(value, minimum = 0, maximum = 100_000, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function isCrownCircuitPeriod(period, key) {
  return Object.hasOwn(CROWN_CIRCUIT_CUTOVER_KEYS, period)
    && typeof key === "string"
    && key >= CROWN_CIRCUIT_CUTOVER_KEYS[period];
}

function crownActualScore(outcome) {
  if (outcome === "win") return 1;
  if (outcome === "draw") return 0.5;
  if (outcome === "loss") return 0;
  return null;
}

function crownExpectedScore(playerRating, opponentRating) {
  const player = integer(playerRating, 100, 3000, 1000);
  const opponent = integer(opponentRating, 100, 3000, 1000);
  return 1 / (1 + (10 ** ((opponent - player) / 400)));
}

function normalizeOpponentCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => /^[a-f0-9]{40}$/.test(key))
    .map(([key, count]) => [
      key,
      integer(count, 1, CROWN_DAILY_OPPONENT_LIMIT, 1),
    ]));
}

function normalizeSignatureIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source
    .map((id) => String(id || ""))
    .filter((id) => CROWN_SIGNATURE_IDS.includes(id)))];
}

function normalizeCrownRun(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const key = String(source.key || fallback.key || "");
  const entryId = String(source.entryId || fallback.entryId || "");
  const ratingAtStart = integer(
    source.ratingAtStart ?? fallback.ratingAtStart ?? fallback.rating,
    100,
    3000,
    1000,
  );
  const matchCount = integer(source.matchCount, 0, CROWN_DAILY_MATCH_LIMIT, 0);
  const wins = integer(source.wins, 0, matchCount, 0);
  const draws = integer(source.draws, 0, matchCount - wins, 0);
  const losses = Math.max(0, matchCount - wins - draws);
  const modeMatches = {
    solo: integer(source.modeMatches?.solo, 0, matchCount, 0),
    strategy: integer(source.modeMatches?.strategy, 0, matchCount, 0),
  };
  if (modeMatches.solo + modeMatches.strategy !== matchCount) {
    modeMatches.solo = matchCount;
    modeMatches.strategy = 0;
  }
  const opponentCounts = normalizeOpponentCounts(source.opponentCounts);
  const uniqueOpponents = Object.keys(opponentCounts).length;
  const expectedTotal = decimal(source.expectedTotal, 0, CROWN_DAILY_MATCH_LIMIT, 0);
  const actualTotal = decimal(source.actualTotal, 0, CROWN_DAILY_MATCH_LIMIT, 0);
  const rawStatus = String(source.status || fallback.status || "active");
  const status = ["active", "complete", "finalized"].includes(rawStatus)
    ? rawStatus
    : "active";
  const complete = matchCount >= CROWN_DAILY_MATCH_LIMIT;
  const crownPower = integer(source.crownPower, 100, 3000, ratingAtStart);
  const signatureIds = normalizeSignatureIds(source.signatureIds);
  return {
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    period: "daily",
    key,
    entryId,
    name: String(source.name || fallback.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(source.rating ?? fallback.rating, 100, 3000, ratingAtStart),
    ratingAtStart,
    status: complete && status === "active" ? "complete" : status,
    matchCount,
    wins,
    losses,
    draws,
    modeMatches,
    expectedTotal,
    actualTotal,
    opponentCounts,
    uniqueOpponents,
    crownPower,
    rankScore: complete ? crownPower : 0,
    signatureIds,
    startedAt: Number(source.startedAt || fallback.startedAt || 0),
    endsAt: Number(source.endsAt || fallback.endsAt || 0),
    updatedAt: Number(source.updatedAt || fallback.updatedAt || Date.now()),
    commentsEnabled: source.commentsEnabled !== false,
    ...(source.xHandle ? { xHandle: String(source.xHandle).slice(0, 15) } : {}),
    ...(source.achievementShowcase
      ? { achievementShowcase: String(source.achievementShowcase).slice(0, 160) }
      : {}),
    ...(CROWN_THEMES.includes(source.crownTheme)
      ? { crownTheme: source.crownTheme }
      : {}),
    ...(CROWN_SIGNATURE_IDS.includes(source.crownSignatureId)
      ? { crownSignatureId: source.crownSignatureId }
      : {}),
    ...(Number(source.rank || 0) > 0
      ? {
        rank: integer(source.rank, 1, 100_000, 100_000),
        participantCount: integer(source.participantCount, 1, 100_000, 1),
        starScore: integer(source.starScore, 0, 100, 0),
        finalizedAt: Number(source.finalizedAt || 0),
      }
      : {}),
  };
}

function startCrownRun(value, {
  key,
  entryId,
  profile = {},
  endsAt = 0,
  now = Date.now(),
} = {}) {
  if (!isCrownCircuitPeriod("daily", key)) throw new Error("Invalid crown circuit day");
  const current = value && typeof value === "object"
    ? normalizeCrownRun(value, { key, entryId, ...profile, endsAt, startedAt: now })
    : null;
  // A run is a once-per-day declaration. Even a zero-match run keeps the
  // original RATE and declaration time so it cannot be rerolled after scouting.
  if (current) return { run: current, started: false };
  const rating = integer(profile.rating, 100, 3000, 1000);
  const run = normalizeCrownRun({
    ...current,
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    period: "daily",
    key,
    entryId,
    name: profile.name,
    rating,
    ratingAtStart: rating,
    status: "active",
    matchCount: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    modeMatches: { solo: 0, strategy: 0 },
    expectedTotal: 0,
    actualTotal: 0,
    opponentCounts: {},
    uniqueOpponents: 0,
    crownPower: rating,
    rankScore: 0,
    signatureIds: [],
    startedAt: Number(now),
    endsAt: Number(endsAt),
    updatedAt: Number(now),
    commentsEnabled: profile.commentsEnabled !== false,
    ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
    ...(profile.achievementShowcase
      ? { achievementShowcase: profile.achievementShowcase }
      : {}),
    ...(profile.crownTheme ? { crownTheme: profile.crownTheme } : {}),
    ...(profile.crownSignatureId
      ? { crownSignatureId: profile.crownSignatureId }
      : {}),
  });
  return { run, started: true };
}

function addCrownRunResult(value, {
  mode,
  outcome,
  playerRating,
  opponentRating,
  opponentKey,
  profile = {},
  now = Date.now(),
} = {}) {
  const run = normalizeCrownRun(value, value);
  if (run.status !== "active" || run.matchCount >= CROWN_DAILY_MATCH_LIMIT) {
    return { run, accepted: false, reason: "complete" };
  }
  if (!CROWN_CIRCUIT_MODES.includes(mode)) {
    return { run, accepted: false, reason: "mode" };
  }
  const actual = crownActualScore(outcome);
  if (actual === null) return { run, accepted: false, reason: "outcome" };
  if (!/^[a-f0-9]{40}$/.test(String(opponentKey || ""))) {
    return { run, accepted: false, reason: "opponent" };
  }
  const previousOpponentCount = integer(
    run.opponentCounts[opponentKey],
    0,
    CROWN_DAILY_OPPONENT_LIMIT,
    0,
  );
  if (previousOpponentCount >= CROWN_DAILY_OPPONENT_LIMIT) {
    return { run, accepted: false, reason: "opponent-limit" };
  }
  const expected = crownExpectedScore(playerRating, opponentRating);
  const next = {
    ...run,
    name: String(profile.name || run.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(profile.rating, 100, 3000, run.rating),
    matchCount: run.matchCount + 1,
    wins: run.wins + (outcome === "win" ? 1 : 0),
    losses: run.losses + (outcome === "loss" ? 1 : 0),
    draws: run.draws + (outcome === "draw" ? 1 : 0),
    modeMatches: {
      ...run.modeMatches,
      [mode]: run.modeMatches[mode] + 1,
    },
    expectedTotal: run.expectedTotal + expected,
    actualTotal: run.actualTotal + actual,
    opponentCounts: {
      ...run.opponentCounts,
      [opponentKey]: previousOpponentCount + 1,
    },
    updatedAt: Number(now),
    commentsEnabled: profile.commentsEnabled !== false,
    ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
    ...(profile.achievementShowcase
      ? { achievementShowcase: profile.achievementShowcase }
      : {}),
    ...(profile.crownTheme ? { crownTheme: profile.crownTheme } : {}),
    ...(profile.crownSignatureId
      ? { crownSignatureId: profile.crownSignatureId }
      : {}),
  };
  const performanceDelta = Math.round(
    CROWN_DAILY_DELTA_FACTOR
      * ((next.actualTotal - next.expectedTotal) / CROWN_DAILY_MATCH_LIMIT),
  );
  next.crownPower = integer(
    next.ratingAtStart + Math.max(
      -CROWN_DAILY_DELTA_LIMIT,
      Math.min(CROWN_DAILY_DELTA_LIMIT, performanceDelta),
    ),
    100,
    3000,
    next.ratingAtStart,
  );
  const signatures = new Set(run.signatureIds);
  if (outcome === "win" && expected <= 0.25) signatures.add("upset");
  if (next.matchCount >= CROWN_DAILY_MATCH_LIMIT && next.losses === 0) {
    signatures.add("triple_unbeaten");
  }
  if (next.modeMatches.solo > 0 && next.modeMatches.strategy > 0) {
    signatures.add("dual_mode");
  }
  next.signatureIds = [...signatures];
  if (next.matchCount >= CROWN_DAILY_MATCH_LIMIT) {
    next.status = "complete";
    next.rankScore = next.crownPower;
  }
  return {
    run: normalizeCrownRun(next, next),
    accepted: true,
    reason: "accepted",
    expected,
    actual,
  };
}

function compareCrownRunEntries(first, second) {
  const firstRun = normalizeCrownRun(first, first);
  const secondRun = normalizeCrownRun(second, second);
  return secondRun.rankScore - firstRun.rankScore
    || secondRun.crownPower - firstRun.crownPower
    || secondRun.rating - firstRun.rating
    || secondRun.uniqueOpponents - firstRun.uniqueOpponents
    || secondRun.wins - firstRun.wins
    || String(firstRun.entryId || "").localeCompare(String(secondRun.entryId || ""));
}

function crownStarScore(rank, participantCount) {
  const participants = integer(participantCount, 1, 100_000, 1);
  const normalizedRank = integer(rank, 1, participants, participants);
  if (participants === 1) return 20;
  return 20 + Math.round((80 * (participants - normalizedRank)) / (participants - 1));
}

function normalizedScoreMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, score]) => (
      /^[0-9]{4}-[0-9]{2}(?:-[0-9]{2})?$/.test(key)
      && Number.isFinite(Number(score))
    ))
    .map(([key, score]) => [key, integer(score, 0, 100, 0)]));
}

function bestScores(value, limit) {
  const scores = normalizedScoreMap(value);
  const best = Object.entries(scores)
    .sort((first, second) => second[1] - first[1] || second[0].localeCompare(first[0]))
    .slice(0, limit);
  return {
    scores,
    bestKeys: best.map(([key]) => key),
    total: best.reduce((sum, [, score]) => sum + score, 0),
    count: Object.keys(scores).length,
  };
}

function applyDailyStarToWeekly(value, {
  key,
  dailyKey,
  starScore,
  crownPower,
  profile = {},
  endsAt = 0,
  now = Date.now(),
} = {}) {
  if (!isCrownCircuitPeriod("weekly", key)) throw new Error("Invalid crown circuit week");
  const current = value && typeof value === "object" ? value : {};
  const dailyStars = {
    ...normalizedScoreMap(current.dailyStars),
    [dailyKey]: integer(starScore, 0, 100, 0),
  };
  const aggregate = bestScores(dailyStars, CROWN_WEEKLY_BEST_DAYS);
  const qualifyingDays = aggregate.count;
  return {
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    period: "weekly",
    key,
    entryId: String(current.entryId || profile.entryId || ""),
    name: String(profile.name || current.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(profile.rating ?? current.rating, 100, 3000, 1000),
    dailyStars: aggregate.scores,
    bestDailyKeys: aggregate.bestKeys,
    qualifyingDays,
    circuitScore: aggregate.total,
    rankScore: qualifyingDays >= CROWN_WEEKLY_MIN_DAYS ? aggregate.total : 0,
    bestCrownPower: Math.max(
      integer(current.bestCrownPower, 100, 3000, 100),
      integer(crownPower, 100, 3000, 100),
    ),
    endsAt: Number(endsAt || current.endsAt || 0),
    updatedAt: Number(now),
    commentsEnabled: profile.commentsEnabled !== false,
    ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
    ...(profile.achievementShowcase
      ? { achievementShowcase: profile.achievementShowcase }
      : {}),
    ...(profile.crownTheme ? { crownTheme: profile.crownTheme } : {}),
    ...(profile.crownSignatureId
      ? { crownSignatureId: profile.crownSignatureId }
      : {}),
  };
}

function applyWeeklyStarToMonthly(value, {
  key,
  weeklyKey,
  starScore,
  bestCrownPower,
  profile = {},
  endsAt = 0,
  now = Date.now(),
} = {}) {
  if (!isCrownCircuitPeriod("monthly", key)) throw new Error("Invalid crown circuit month");
  const current = value && typeof value === "object" ? value : {};
  const weeklyStars = {
    ...normalizedScoreMap(current.weeklyStars),
    [weeklyKey]: integer(starScore, 0, 100, 0),
  };
  const aggregate = bestScores(weeklyStars, CROWN_MONTHLY_BEST_WEEKS);
  const qualifyingWeeks = aggregate.count;
  return {
    rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    period: "monthly",
    key,
    entryId: String(current.entryId || profile.entryId || ""),
    name: String(profile.name || current.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(profile.rating ?? current.rating, 100, 3000, 1000),
    weeklyStars: aggregate.scores,
    bestWeeklyKeys: aggregate.bestKeys,
    qualifyingWeeks,
    circuitScore: aggregate.total,
    rankScore: qualifyingWeeks >= CROWN_MONTHLY_MIN_WEEKS ? aggregate.total : 0,
    bestCrownPower: Math.max(
      integer(current.bestCrownPower, 100, 3000, 100),
      integer(bestCrownPower, 100, 3000, 100),
    ),
    endsAt: Number(endsAt || current.endsAt || 0),
    updatedAt: Number(now),
    commentsEnabled: profile.commentsEnabled !== false,
    ...(profile.xHandle ? { xHandle: profile.xHandle } : {}),
    ...(profile.achievementShowcase
      ? { achievementShowcase: profile.achievementShowcase }
      : {}),
    ...(profile.crownTheme ? { crownTheme: profile.crownTheme } : {}),
    ...(profile.crownSignatureId
      ? { crownSignatureId: profile.crownSignatureId }
      : {}),
  };
}

function compareCrownCircuitEntries(first, second) {
  return integer(second?.rankScore) - integer(first?.rankScore)
    || integer(second?.bestCrownPower, 100, 3000, 100)
      - integer(first?.bestCrownPower, 100, 3000, 100)
    || integer(second?.rating, 100, 3000, 1000)
      - integer(first?.rating, 100, 3000, 1000)
    || String(first?.entryId || "").localeCompare(String(second?.entryId || ""));
}

function crownAwardTier(period, rank, participantCount) {
  const normalizedRank = integer(rank, 1, 100_000, 100_000);
  const participants = integer(participantCount, 1, 100_000, 1);
  if (participants < 2) return `${period}_opening`;
  if (normalizedRank === 1) return `${period}_champion`;
  if (normalizedRank <= 3) return `${period}_top3`;
  if (participants >= 8 && normalizedRank <= Math.max(1, Math.ceil(participants * 0.25))) {
    return `${period}_honor`;
  }
  return `${period}_seat`;
}

module.exports = {
  CROWN_CIRCUIT_CUTOVER_KEYS,
  CROWN_CIRCUIT_MODES,
  CROWN_CIRCUIT_RULESET_VERSION,
  CROWN_DAILY_MATCH_LIMIT,
  CROWN_DAILY_OPPONENT_LIMIT,
  CROWN_MONTHLY_BEST_WEEKS,
  CROWN_MONTHLY_MIN_WEEKS,
  CROWN_PROMOTION_MIN_PARTICIPANTS,
  CROWN_SIGNATURE_IDS,
  CROWN_THEMES,
  CROWN_WEEKLY_BEST_DAYS,
  CROWN_WEEKLY_MIN_DAYS,
  addCrownRunResult,
  applyDailyStarToWeekly,
  applyWeeklyStarToMonthly,
  compareCrownCircuitEntries,
  compareCrownRunEntries,
  crownActualScore,
  crownAwardTier,
  crownExpectedScore,
  crownStarScore,
  isCrownCircuitPeriod,
  normalizeCrownRun,
  normalizeSignatureIds,
  startCrownRun,
};
