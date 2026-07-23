const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DAILY_PLAY_REWARD_BASIC_TARGET,
  DAILY_PLAY_REWARD_GRACE_MS,
  DAILY_PLAY_REWARD_MAX_MATCHES,
  DAILY_PLAY_REWARD_START_DATE_KEY,
  DAILY_PLAY_REWARD_TIERS,
  claimableDailyPlayRewards,
  dailyPlayRewardClaimKey,
  dailyPlayClaimWindowIsOpen,
  dailyPlayRewardSummary,
  normalizeDailyPlayClaims,
  settleDailyPlayRewardClaims,
  verifiedDailyPlayMatches,
} = require("../daily-play-rewards");

const dayEndsAt = (dateKey) => Date.parse(`${dateKey}T00:00:00+09:00`) + (24 * 60 * 60 * 1000);
const record = (dateKey, matches, verifiedMatches = matches) => ({
  matches,
  verifiedMatches,
  endsAt: dayEndsAt(dateKey),
});

test("daily play ladder is front-loaded, optional after 10 matches, and capped at 300 PT", () => {
  assert.equal(DAILY_PLAY_REWARD_START_DATE_KEY, "2026-07-23");
  assert.equal(DAILY_PLAY_REWARD_BASIC_TARGET, 10);
  assert.equal(DAILY_PLAY_REWARD_MAX_MATCHES, 200);
  assert.deepEqual(DAILY_PLAY_REWARD_TIERS.map((tier) => tier.target), [
    1, 3, 5, 10, 20, 30, 50, 75, 100, 150, 200,
  ]);
  assert.deepEqual(DAILY_PLAY_REWARD_TIERS.map((tier) => tier.reward), [
    20, 20, 30, 40, 40, 35, 35, 25, 25, 15, 15,
  ]);
  assert.equal(DAILY_PLAY_REWARD_TIERS.filter((tier) => tier.target <= 10).reduce((total, tier) => total + tier.reward, 0), 110);
  assert.equal(DAILY_PLAY_REWARD_TIERS.reduce((total, tier) => total + tier.reward, 0), 300);
  assert.equal(new Set(DAILY_PLAY_REWARD_TIERS.map((tier) => tier.id)).size, DAILY_PLAY_REWARD_TIERS.length);
  assert.equal(Object.isFrozen(DAILY_PLAY_REWARD_TIERS), true);
  assert.ok(DAILY_PLAY_REWARD_TIERS.every((tier) => Object.isFrozen(tier)));
  assert.ok(DAILY_PLAY_REWARD_TIERS.filter((tier) => tier.phase === "basic").every((tier) => tier.target <= 10));
  assert.ok(DAILY_PLAY_REWARD_TIERS.filter((tier) => tier.phase !== "basic").every((tier) => tier.target > 10));
});

test("only a fully verified daily record counts and display progress stops at 200", () => {
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", 10)), 10);
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", 10, 9)), 0);
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", 10, 11)), 0);
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", 500)), 200);
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", -1, -1)), 0);
  assert.equal(verifiedDailyPlayMatches(record("2026-07-23", Number.NaN, Number.NaN)), 0);
  assert.equal(verifiedDailyPlayMatches(null), 0);
});

test("claim window starts with the configured launch day and remains open for seven days", () => {
  const dateKey = "2026-07-23";
  const value = record(dateKey, 1);
  assert.equal(dailyPlayClaimWindowIsOpen(dateKey, value, value.endsAt - 1), true);
  assert.equal(dailyPlayClaimWindowIsOpen(dateKey, value, value.endsAt + DAILY_PLAY_REWARD_GRACE_MS - 1), true);
  assert.equal(dailyPlayClaimWindowIsOpen(dateKey, value, value.endsAt + DAILY_PLAY_REWARD_GRACE_MS), false);
  assert.equal(dailyPlayClaimWindowIsOpen("2026-07-22", record("2026-07-22", 1), value.endsAt), false);
});

test("claimable rewards span grace-period dates without returning already claimed tiers", () => {
  const timestamp = Date.parse("2026-07-24T12:00:00+09:00");
  const periodRewards = {
    daily: {
      "2026-07-23": record("2026-07-23", 5),
      "2026-07-24": record("2026-07-24", 3),
    },
  };
  const claims = {
    "2026-07-23": {
      claimed: { daily_play_1: true, unknown_tier: true },
      updatedAt: timestamp,
    },
  };
  const claimable = claimableDailyPlayRewards(periodRewards, claims, timestamp);
  assert.deepEqual(claimable.map((entry) => `${entry.dateKey}:${entry.tier.id}`), [
    "2026-07-23:daily_play_3",
    "2026-07-23:daily_play_5",
    "2026-07-24:daily_play_1",
    "2026-07-24:daily_play_3",
  ]);
  assert.deepEqual(normalizeDailyPlayClaims(claims, periodRewards, timestamp), {
    "2026-07-23": {
      claimed: { daily_play_1: true },
      updatedAt: timestamp,
    },
  });
});

test("summary exposes only the next interval as the primary progress target", () => {
  const timestamp = Date.parse("2026-07-23T12:00:00+09:00");
  const periodRewards = { daily: { "2026-07-23": record("2026-07-23", 7) } };
  const summary = dailyPlayRewardSummary(periodRewards, {}, timestamp);
  assert.equal(summary.matches, 7);
  assert.equal(summary.basicComplete, false);
  assert.equal(summary.previousTarget, 5);
  assert.equal(summary.nextTarget, 10);
  assert.equal(summary.nextReward, 40);
  assert.equal(summary.pendingCount, 3);
  assert.equal(summary.pendingPoints, 70);
});

test("summary moves from the first target through basic completion to the hard cap", () => {
  const timestamp = Date.parse("2026-07-23T12:00:00+09:00");
  const zero = dailyPlayRewardSummary({ daily: {} }, {}, timestamp);
  assert.equal(zero.nextTarget, 1);
  assert.equal(zero.nextReward, 20);

  const ten = dailyPlayRewardSummary(
    { daily: { "2026-07-23": record("2026-07-23", 10) } },
    {},
    timestamp,
  );
  assert.equal(ten.basicComplete, true);
  assert.equal(ten.nextTarget, 20);
  assert.equal(ten.pendingPoints, 110);

  const allClaimed = Object.fromEntries(DAILY_PLAY_REWARD_TIERS.map((tier) => [tier.id, true]));
  const twoHundred = dailyPlayRewardSummary(
    { daily: { "2026-07-23": { ...record("2026-07-23", 200), claimed: true } } },
    { "2026-07-23": { claimed: allClaimed, updatedAt: timestamp } },
    timestamp,
  );
  assert.equal(twoHundred.matches, 200);
  assert.equal(twoHundred.nextTarget, 0);
  assert.equal(twoHundred.pendingCount, 0);
  assert.equal(twoHundred.pendingPoints, 0);
});

test("settlement recovers existing ledgers and partially credits only new tiers within capacity", () => {
  const entries = [
    { dateKey: "2026-07-23", tier: DAILY_PLAY_REWARD_TIERS[0] },
    { dateKey: "2026-07-23", tier: DAILY_PLAY_REWARD_TIERS[1] },
    { dateKey: "2026-07-23", tier: DAILY_PLAY_REWARD_TIERS[2] },
  ];
  const existingKey = dailyPlayRewardClaimKey(entries[0].dateKey, entries[0].tier.id);
  const settlement = settleDailyPlayRewardClaims(entries, new Set([existingKey]), 25);
  assert.equal(settlement.recoveredCount, 1);
  assert.equal(settlement.claimedCount, 2);
  assert.equal(settlement.nominal, 50);
  assert.equal(settlement.credited, 25);
  assert.deepEqual(settlement.decisions.map((decision) => [decision.create, decision.credited]), [
    [false, 0],
    [true, 20],
    [true, 5],
  ]);

  const allExisting = new Set(entries.map((entry) => dailyPlayRewardClaimKey(entry.dateKey, entry.tier.id)));
  const repeated = settleDailyPlayRewardClaims(entries, allExisting, 999);
  assert.equal(repeated.claimedCount, 0);
  assert.equal(repeated.credited, 0);
  assert.equal(repeated.recoveredCount, 3);
});
