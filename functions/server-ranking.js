"use strict";

const SERVER_RANKING_VERSION = 1;
const SERVER_RANKING_PERIODS = Object.freeze(["daily", "weekly", "monthly"]);
const SERVER_RANKING_MODES = Object.freeze(["solo", "strategy", "team", "royale"]);
const SERVER_RANKING_CUTOVER_KEYS = Object.freeze({
  daily: "2026-07-24",
  weekly: "2026-07-27",
  monthly: "2026-08",
});
const SERVER_RANKING_MINIMUM_MATCHES = Object.freeze({
  daily: 1,
  weekly: 3,
  monthly: 5,
});
const SERVER_RANKING_AWARD_MINIMUM_MATCHES = Object.freeze({
  daily: 1,
  weekly: 3,
  monthly: 10,
});

function isServerRankingPeriod(period, key) {
  return SERVER_RANKING_PERIODS.includes(period)
    && typeof key === "string"
    && key >= SERVER_RANKING_CUTOVER_KEYS[period];
}

function serverRankingEntryDocumentId(period, key) {
  if (!isServerRankingPeriod(period, key)) throw new Error("Invalid server ranking period");
  return `${period}_${key}`;
}

function integer(value, minimum = 0, maximum = 100_000, fallback = minimum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizeModeRecord(value = {}) {
  return Object.fromEntries(SERVER_RANKING_MODES.map((mode) => [mode, integer(value?.[mode])]));
}

function emptyServerRankingEntry({
  period,
  key,
  entryId,
  profile = {},
  endsAt,
  now = Date.now(),
} = {}) {
  if (!isServerRankingPeriod(period, key)) throw new Error("Invalid server ranking period");
  return {
    version: SERVER_RANKING_VERSION,
    period,
    key,
    entryId: String(entryId || ""),
    name: String(profile.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(profile.rating, 100, 3000, 1000),
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    modePoints: normalizeModeRecord(),
    modeMatches: normalizeModeRecord(),
    commentsEnabled: profile.commentsEnabled !== false,
    endsAt: Number(endsAt || 0),
    createdAt: Number(now),
    updatedAt: Number(now),
    ...(profile.xHandle ? { xHandle: String(profile.xHandle).slice(0, 15) } : {}),
    ...(profile.achievementShowcase ? { achievementShowcase: String(profile.achievementShowcase) } : {}),
    ...(profile.rankingAwardTier ? {
      rankingAwardTier: String(profile.rankingAwardTier).slice(0, 40),
      rankingAwardLabel: String(profile.rankingAwardLabel || "").slice(0, 40),
      rankingAwardUntil: Number(profile.rankingAwardUntil || 0),
    } : {}),
  };
}

function normalizeServerRankingEntry(value, fallback = {}) {
  const period = String(value?.period || fallback.period || "");
  const key = String(value?.key || fallback.key || "");
  if (!isServerRankingPeriod(period, key)) return null;
  const wins = integer(value?.wins);
  const losses = integer(value?.losses);
  const draws = integer(value?.draws);
  const matches = wins + losses + draws;
  const modeMatches = normalizeModeRecord(value?.modeMatches);
  const normalizedModeMatches = Object.values(modeMatches).reduce((sum, count) => sum + count, 0) === matches
    ? modeMatches
    : { ...normalizeModeRecord(), solo: matches };
  const modePoints = normalizeModeRecord(value?.modePoints);
  const points = (wins * 3) + draws;
  const normalizedModePoints = Object.values(modePoints).reduce((sum, count) => sum + count, 0) === points
    ? modePoints
    : { ...normalizeModeRecord(), solo: points };
  return {
    version: SERVER_RANKING_VERSION,
    period,
    key,
    entryId: String(value?.entryId || fallback.entryId || ""),
    name: String(value?.name || fallback.name || "PLAYER").slice(0, 16) || "PLAYER",
    rating: integer(value?.rating ?? fallback.rating, 100, 3000, 1000),
    wins,
    losses,
    draws,
    points,
    modePoints: normalizedModePoints,
    modeMatches: normalizedModeMatches,
    commentsEnabled: value?.commentsEnabled !== false,
    endsAt: Number(value?.endsAt || fallback.endsAt || 0),
    createdAt: Number(value?.createdAt || fallback.createdAt || Date.now()),
    updatedAt: Number(value?.updatedAt || fallback.updatedAt || Date.now()),
    ...(value?.xHandle ? { xHandle: String(value.xHandle).slice(0, 15) } : {}),
    ...(value?.achievementShowcase ? { achievementShowcase: String(value.achievementShowcase) } : {}),
    ...(value?.rankingAwardTier ? {
      rankingAwardTier: String(value.rankingAwardTier).slice(0, 40),
      rankingAwardLabel: String(value.rankingAwardLabel || "").slice(0, 40),
      rankingAwardUntil: Number(value.rankingAwardUntil || 0),
    } : {}),
  };
}

function addServerRankingResult(value, {
  mode,
  outcome,
  profile = {},
  now = Date.now(),
} = {}) {
  if (!SERVER_RANKING_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) {
    throw new Error("Invalid server ranking result");
  }
  const record = normalizeServerRankingEntry(value, value);
  if (!record) throw new Error("Invalid server ranking entry");
  if (outcome === "win") record.wins += 1;
  else if (outcome === "loss") record.losses += 1;
  else record.draws += 1;
  record.modeMatches[mode] += 1;
  record.modePoints[mode] += outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
  record.points = (record.wins * 3) + record.draws;
  record.name = String(profile.name || record.name || "PLAYER").slice(0, 16) || "PLAYER";
  record.rating = integer(profile.rating, 100, 3000, record.rating);
  record.commentsEnabled = profile.commentsEnabled !== false;
  record.updatedAt = Number(now);
  if (profile.xHandle) record.xHandle = String(profile.xHandle).slice(0, 15);
  else delete record.xHandle;
  if (profile.achievementShowcase) record.achievementShowcase = String(profile.achievementShowcase);
  else delete record.achievementShowcase;
  if (profile.rankingAwardTier && Number(profile.rankingAwardUntil || 0) > Number(now)) {
    record.rankingAwardTier = String(profile.rankingAwardTier).slice(0, 40);
    record.rankingAwardLabel = String(profile.rankingAwardLabel || "").slice(0, 40);
    record.rankingAwardUntil = Number(profile.rankingAwardUntil);
  } else {
    delete record.rankingAwardTier;
    delete record.rankingAwardLabel;
    delete record.rankingAwardUntil;
  }
  return record;
}

function serverRankingMatches(entry) {
  return integer(entry?.wins) + integer(entry?.losses) + integer(entry?.draws);
}

function compareServerRankingEntries(first, second) {
  const firstMatches = Math.max(1, serverRankingMatches(first));
  const secondMatches = Math.max(1, serverRankingMatches(second));
  const firstRate = (integer(first?.wins) + (integer(first?.draws) * 0.5)) / firstMatches;
  const secondRate = (integer(second?.wins) + (integer(second?.draws) * 0.5)) / secondMatches;
  return integer(second?.points) - integer(first?.points)
    || secondRate - firstRate
    || integer(second?.wins) - integer(first?.wins)
    || integer(second?.rating, 100, 3000, 1000) - integer(first?.rating, 100, 3000, 1000)
    || Number(first?.updatedAt || 0) - Number(second?.updatedAt || 0)
    || String(first?.entryId || "").localeCompare(String(second?.entryId || ""));
}

function rankingAwardFor(period, rank, matches, { key = "", endsAt = 0, now = Date.now() } = {}) {
  const minimumMatches = SERVER_RANKING_AWARD_MINIMUM_MATCHES[period];
  const normalizedRank = integer(rank, 1, 100_000, 100_000);
  const normalizedMatches = integer(matches);
  if (!minimumMatches || normalizedMatches < minimumMatches) return null;
  let tier = `${period}_participant`;
  let label = period === "daily" ? `デイリー ${normalizedRank}位` : period === "weekly" ? "週間参加記録" : "月間参加メダル";
  if (normalizedRank === 1) {
    tier = `${period}_champion`;
    label = period === "daily" ? "デイリー1位" : period === "weekly" ? "週間チャンピオン" : "月間チャンピオン";
  } else if (normalizedRank <= 3) {
    tier = `${period}_top3`;
    label = period === "daily" ? `デイリーTOP${normalizedRank}` : period === "weekly" ? "週間TOP3" : "月間TOP3";
  } else if (period !== "daily" && normalizedRank <= 10) {
    tier = `${period}_top10`;
    label = period === "weekly" ? "週間TOP10" : "月間TOP10";
  }
  return {
    version: SERVER_RANKING_VERSION,
    period,
    key,
    rank: normalizedRank,
    matches: normalizedMatches,
    tier,
    label,
    endsAt: Number(endsAt || 0),
    awardedAt: Number(now),
  };
}

function resolveServerRankingAward(period, ownEntry, rankedEntries, {
  key = ownEntry?.key || "",
  endsAt = ownEntry?.endsAt || 0,
  now = Date.now(),
} = {}) {
  const minimumMatches = SERVER_RANKING_AWARD_MINIMUM_MATCHES[period];
  const matches = serverRankingMatches(ownEntry);
  if (!minimumMatches || matches < minimumMatches) {
    return { processed: true, rank: 0, award: null };
  }
  const rankIndex = (Array.isArray(rankedEntries) ? rankedEntries : [])
    .findIndex((entry) => entry?.entryId === ownEntry?.entryId);
  if (rankIndex < 0) {
    return { processed: false, rank: 0, award: null };
  }
  const rank = rankIndex + 1;
  return {
    processed: true,
    rank,
    award: rankingAwardFor(period, rank, matches, {
      key,
      endsAt,
      now,
    }),
  };
}

module.exports = {
  SERVER_RANKING_AWARD_MINIMUM_MATCHES,
  SERVER_RANKING_CUTOVER_KEYS,
  SERVER_RANKING_MINIMUM_MATCHES,
  SERVER_RANKING_MODES,
  SERVER_RANKING_PERIODS,
  SERVER_RANKING_VERSION,
  addServerRankingResult,
  compareServerRankingEntries,
  emptyServerRankingEntry,
  isServerRankingPeriod,
  normalizeServerRankingEntry,
  rankingAwardFor,
  resolveServerRankingAward,
  serverRankingEntryDocumentId,
  serverRankingMatches,
};
