"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_PLAY_REWARD_START_DATE_KEY = "2026-07-23";
const DAILY_PLAY_REWARD_GRACE_DAYS = 7;
const DAILY_PLAY_REWARD_GRACE_MS = DAILY_PLAY_REWARD_GRACE_DAYS * DAY_MS;
const DAILY_PLAY_REWARD_BASIC_TARGET = 10;
const DAILY_PLAY_REWARD_MAX_MATCHES = 200;

const DAILY_PLAY_REWARD_TIERS = Object.freeze([
  Object.freeze({ id: "daily_play_1", target: 1, reward: 20, phase: "basic" }),
  Object.freeze({ id: "daily_play_3", target: 3, reward: 20, phase: "basic" }),
  Object.freeze({ id: "daily_play_5", target: 5, reward: 30, phase: "basic" }),
  Object.freeze({ id: "daily_play_10", target: 10, reward: 40, phase: "basic" }),
  Object.freeze({ id: "daily_play_20", target: 20, reward: 40, phase: "bonus" }),
  Object.freeze({ id: "daily_play_30", target: 30, reward: 35, phase: "bonus" }),
  Object.freeze({ id: "daily_play_50", target: 50, reward: 35, phase: "bonus" }),
  Object.freeze({ id: "daily_play_75", target: 75, reward: 25, phase: "bonus" }),
  Object.freeze({ id: "daily_play_100", target: 100, reward: 25, phase: "record" }),
  Object.freeze({ id: "daily_play_150", target: 150, reward: 15, phase: "record" }),
  Object.freeze({ id: "daily_play_200", target: 200, reward: 15, phase: "record" }),
]);

const DAILY_PLAY_REWARD_TIER_BY_ID = new Map(
  DAILY_PLAY_REWARD_TIERS.map((tier) => [tier.id, tier]),
);

function nonNegativeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function isDailyDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function jstDateKey(timestamp = Date.now()) {
  const shifted = new Date(Number(timestamp) + (9 * 60 * 60 * 1000));
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : "";
}

function verifiedDailyPlayMatches(record) {
  if (!record || typeof record !== "object") return 0;
  const matches = nonNegativeInteger(record.matches, 100_000);
  const verifiedMatches = nonNegativeInteger(record.verifiedMatches, 100_000);
  if (!matches || verifiedMatches !== matches) return 0;
  return Math.min(DAILY_PLAY_REWARD_MAX_MATCHES, verifiedMatches);
}

function dailyPlayClaimWindowIsOpen(dateKey, record, timestamp = Date.now()) {
  if (!isDailyDateKey(dateKey) || dateKey < DAILY_PLAY_REWARD_START_DATE_KEY) return false;
  if (!record || typeof record !== "object") return false;
  const startsAt = Date.parse(`${dateKey}T00:00:00+09:00`);
  const endsAt = startsAt + DAY_MS;
  const now = Number(timestamp);
  if (!Number.isFinite(startsAt) || !Number.isFinite(now)) return false;
  return now >= startsAt && now < endsAt + DAILY_PLAY_REWARD_GRACE_MS;
}

function normalizeClaimedTierIds(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const tier of DAILY_PLAY_REWARD_TIERS) {
    if (source[tier.id] === true) normalized[tier.id] = true;
  }
  return normalized;
}

function normalizeDailyPlayClaims(value, periodRewards, timestamp = Date.now()) {
  const source = value && typeof value === "object" ? value : {};
  const dailyPeriods = periodRewards?.daily && typeof periodRewards.daily === "object"
    ? periodRewards.daily
    : {};
  const normalized = {};
  for (const [dateKey, claimRecord] of Object.entries(source)) {
    const periodRecord = dailyPeriods[dateKey];
    if (!dailyPlayClaimWindowIsOpen(dateKey, periodRecord, timestamp)) continue;
    const claimed = normalizeClaimedTierIds(claimRecord?.claimed);
    if (!Object.keys(claimed).length) continue;
    normalized[dateKey] = {
      claimed,
      updatedAt: nonNegativeInteger(claimRecord?.updatedAt || timestamp),
    };
  }
  return normalized;
}

function claimableDailyPlayRewards(periodRewards, dailyPlayClaims, timestamp = Date.now()) {
  const dailyPeriods = periodRewards?.daily && typeof periodRewards.daily === "object"
    ? periodRewards.daily
    : {};
  const normalizedClaims = normalizeDailyPlayClaims(dailyPlayClaims, periodRewards, timestamp);
  const claimable = [];
  for (const [dateKey, record] of Object.entries(dailyPeriods).sort(([first], [second]) => (
    first.localeCompare(second)
  ))) {
    if (!dailyPlayClaimWindowIsOpen(dateKey, record, timestamp)) continue;
    const matches = verifiedDailyPlayMatches(record);
    if (!matches) continue;
    const claimed = normalizedClaims[dateKey]?.claimed || {};
    for (const tier of DAILY_PLAY_REWARD_TIERS) {
      if (tier.target <= matches && claimed[tier.id] !== true) {
        claimable.push({ dateKey, matches, tier });
      }
    }
  }
  return claimable;
}

function dailyPlayRewardClaimKey(dateKey, tierId) {
  return `${dateKey}:${tierId}`;
}

function settleDailyPlayRewardClaims(entries, existingClaimKeys, creditCapacity) {
  const existing = existingClaimKeys instanceof Set
    ? existingClaimKeys
    : new Set(Array.isArray(existingClaimKeys) ? existingClaimKeys : []);
  let remainingCredit = nonNegativeInteger(creditCapacity);
  let credited = 0;
  let nominal = 0;
  let claimedCount = 0;
  let recoveredCount = 0;
  const decisions = (Array.isArray(entries) ? entries : []).map((entry) => {
    const key = dailyPlayRewardClaimKey(entry?.dateKey, entry?.tier?.id);
    if (existing.has(key)) {
      recoveredCount += 1;
      return { ...entry, key, create: false, credited: 0 };
    }
    const reward = nonNegativeInteger(entry?.tier?.reward);
    const tierCredit = Math.min(reward, remainingCredit);
    remainingCredit -= tierCredit;
    credited += tierCredit;
    nominal += reward;
    claimedCount += 1;
    return { ...entry, key, create: true, credited: tierCredit };
  });
  return {
    decisions,
    credited,
    nominal,
    claimedCount,
    recoveredCount,
    remainingCredit,
  };
}

function dailyPlayRewardSummary(periodRewards, dailyPlayClaims, timestamp = Date.now()) {
  const dateKey = jstDateKey(timestamp);
  const currentRecord = periodRewards?.daily?.[dateKey];
  const matches = verifiedDailyPlayMatches(currentRecord);
  const normalizedClaims = normalizeDailyPlayClaims(dailyPlayClaims, periodRewards, timestamp);
  const claimed = normalizedClaims[dateKey]?.claimed || {};
  const claimable = claimableDailyPlayRewards(periodRewards, normalizedClaims, timestamp);
  const tiers = DAILY_PLAY_REWARD_TIERS.map((tier) => ({
    ...tier,
    complete: matches >= tier.target,
    claimed: claimed[tier.id] === true,
  }));
  const nextTier = tiers.find((tier) => !tier.complete) || null;
  const previousTarget = nextTier
    ? Math.max(0, ...tiers.filter((tier) => tier.target < nextTier.target).map((tier) => tier.target))
    : DAILY_PLAY_REWARD_MAX_MATCHES;
  return {
    dateKey,
    startsOn: DAILY_PLAY_REWARD_START_DATE_KEY,
    graceDays: DAILY_PLAY_REWARD_GRACE_DAYS,
    matches,
    basicTarget: DAILY_PLAY_REWARD_BASIC_TARGET,
    maxMatches: DAILY_PLAY_REWARD_MAX_MATCHES,
    basicComplete: matches >= DAILY_PLAY_REWARD_BASIC_TARGET,
    nextTarget: nextTier?.target || 0,
    nextReward: nextTier?.reward || 0,
    previousTarget,
    pendingCount: claimable.length,
    pendingPoints: claimable.reduce((total, entry) => total + entry.tier.reward, 0),
    claimedTierIds: Object.keys(claimed),
    tiers,
  };
}

module.exports = Object.freeze({
  DAILY_PLAY_REWARD_BASIC_TARGET,
  DAILY_PLAY_REWARD_GRACE_DAYS,
  DAILY_PLAY_REWARD_GRACE_MS,
  DAILY_PLAY_REWARD_MAX_MATCHES,
  DAILY_PLAY_REWARD_START_DATE_KEY,
  DAILY_PLAY_REWARD_TIERS,
  DAILY_PLAY_REWARD_TIER_BY_ID,
  claimableDailyPlayRewards,
  dailyPlayClaimWindowIsOpen,
  dailyPlayRewardClaimKey,
  dailyPlayRewardSummary,
  jstDateKey,
  normalizeDailyPlayClaims,
  settleDailyPlayRewardClaims,
  verifiedDailyPlayMatches,
});
