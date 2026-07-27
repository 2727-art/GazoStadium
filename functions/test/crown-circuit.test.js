"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CROWN_CIRCUIT_MODES,
  CROWN_DAILY_MATCH_LIMIT,
  addCrownRunResult,
  applyDailyStarToWeekly,
  applyWeeklyStarToMonthly,
  compareCrownCircuitEntries,
  compareCrownRunEntries,
  crownAwardTier,
  crownExpectedScore,
  crownStarScore,
  isCrownCircuitPeriod,
  startCrownRun,
} = require("../crown-circuit");

const opponentA = "a".repeat(40);
const opponentB = "b".repeat(40);

function startedRun(rating = 1000) {
  return startCrownRun(null, {
    key: "2026-07-28",
    entryId: "entry-player",
    profile: { name: "PLAYER", rating },
    endsAt: Date.parse("2026-07-29T00:00:00+09:00"),
    now: 100,
  }).run;
}

test("crown circuit starts at natural boundaries and only accepts symmetric ranking modes", () => {
  assert.equal(isCrownCircuitPeriod("daily", "2026-07-27"), false);
  assert.equal(isCrownCircuitPeriod("daily", "2026-07-28"), true);
  assert.equal(isCrownCircuitPeriod("weekly", "2026-08-03"), true);
  assert.equal(isCrownCircuitPeriod("monthly", "2026-08"), true);
  assert.deepEqual(CROWN_CIRCUIT_MODES, ["solo", "strategy"]);
  assert.equal(CROWN_DAILY_MATCH_LIMIT, 3);
});

test("a proof run counts exactly three verified solo or strategy results", () => {
  let run = startedRun();
  const first = addCrownRunResult(run, {
    mode: "solo",
    outcome: "win",
    playerRating: 1000,
    opponentRating: 1000,
    opponentKey: opponentA,
    now: 200,
  });
  assert.equal(first.accepted, true);
  run = first.run;
  const second = addCrownRunResult(run, {
    mode: "strategy",
    outcome: "draw",
    playerRating: 1016,
    opponentRating: 1050,
    opponentKey: opponentB,
    now: 300,
  });
  run = second.run;
  const third = addCrownRunResult(run, {
    mode: "solo",
    outcome: "loss",
    playerRating: 1017,
    opponentRating: 1100,
    opponentKey: opponentA,
    now: 400,
  });
  assert.equal(third.accepted, true);
  assert.equal(third.run.status, "complete");
  assert.equal(third.run.matchCount, 3);
  assert.equal(third.run.modeMatches.solo, 2);
  assert.equal(third.run.modeMatches.strategy, 1);
  assert.equal(third.run.uniqueOpponents, 2);
  assert.equal(third.run.rankScore, third.run.crownPower);

  const extra = addCrownRunResult(third.run, {
    mode: "solo",
    outcome: "win",
    playerRating: 1000,
    opponentRating: 1000,
    opponentKey: opponentB,
    now: 500,
  });
  assert.equal(extra.accepted, false);
  assert.equal(extra.reason, "complete");
});

test("team results never enter a proof run and one opponent cannot fill all three slots", () => {
  let run = startedRun();
  const team = addCrownRunResult(run, {
    mode: "team",
    outcome: "win",
    playerRating: 1000,
    opponentRating: 1000,
    opponentKey: opponentA,
  });
  assert.equal(team.accepted, false);
  assert.equal(team.reason, "mode");

  for (let index = 0; index < 2; index += 1) {
    run = addCrownRunResult(run, {
      mode: "solo",
      outcome: "win",
      playerRating: 1000,
      opponentRating: 1000,
      opponentKey: opponentA,
    }).run;
  }
  const repeated = addCrownRunResult(run, {
    mode: "strategy",
    outcome: "win",
    playerRating: 1000,
    opponentRating: 1000,
    opponentKey: opponentA,
  });
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.reason, "opponent-limit");
  assert.equal(repeated.run.matchCount, 2);
});

test("opponent-adjusted crown power rewards an upset without replacing overall strength", () => {
  assert.ok(crownExpectedScore(900, 1300) < 0.1);
  let upsetRun = startedRun(900);
  let evenRun = startedRun(900);
  for (const opponentKey of [opponentA, opponentA, opponentB]) {
    upsetRun = addCrownRunResult(upsetRun, {
      mode: "solo",
      outcome: "win",
      playerRating: 900,
      opponentRating: 1300,
      opponentKey,
    }).run;
    evenRun = addCrownRunResult(evenRun, {
      mode: "solo",
      outcome: "win",
      playerRating: 900,
      opponentRating: 900,
      opponentKey,
    }).run;
  }
  assert.ok(upsetRun.crownPower > evenRun.crownPower);
  assert.ok(upsetRun.signatureIds.includes("upset"));
  assert.ok(upsetRun.signatureIds.includes("triple_unbeaten"));
  assert.ok(compareCrownRunEntries(upsetRun, evenRun) < 0);
});

test("weekly and monthly circuits use best three results without attendance penalties", () => {
  let weekly = null;
  for (const [dailyKey, score] of [
    ["2026-08-03", 60],
    ["2026-08-04", 100],
    ["2026-08-05", 80],
    ["2026-08-06", 40],
  ]) {
    weekly = applyDailyStarToWeekly(weekly, {
      key: "2026-08-03",
      dailyKey,
      starScore: score,
      crownPower: 1100 + score,
      profile: { entryId: "entry-player", name: "PLAYER", rating: 1200 },
      endsAt: Date.parse("2026-08-10T00:00:00+09:00"),
    });
  }
  assert.deepEqual(weekly.bestDailyKeys, ["2026-08-04", "2026-08-05", "2026-08-03"]);
  assert.equal(weekly.circuitScore, 240);
  assert.equal(weekly.rankScore, 240);

  let monthly = null;
  for (const [weeklyKey, score] of [
    ["2026-08-03", 55],
    ["2026-08-10", 95],
    ["2026-08-17", 75],
    ["2026-08-24", 35],
  ]) {
    monthly = applyWeeklyStarToMonthly(monthly, {
      key: "2026-08",
      weeklyKey,
      starScore: score,
      bestCrownPower: 1200,
      profile: { entryId: "entry-player", name: "PLAYER", rating: 1200 },
      endsAt: Date.parse("2026-09-01T00:00:00+09:00"),
    });
  }
  assert.deepEqual(monthly.bestWeeklyKeys, ["2026-08-10", "2026-08-17", "2026-08-03"]);
  assert.equal(monthly.circuitScore, 225);
  assert.equal(monthly.rankScore, 225);
  assert.equal(compareCrownCircuitEntries(
    { ...monthly, entryId: "higher" },
    { ...monthly, entryId: "lower", rankScore: 200 },
  ) < 0, true);
});

test("numbered seats produce transparent stars and population-aware award tiers", () => {
  assert.equal(crownStarScore(1, 10), 100);
  assert.equal(crownStarScore(10, 10), 20);
  assert.equal(crownStarScore(1, 1), 20);
  assert.equal(crownAwardTier("daily", 1, 1), "daily_opening");
  assert.equal(crownAwardTier("daily", 1, 8), "daily_champion");
  assert.equal(crownAwardTier("daily", 3, 8), "daily_top3");
  assert.equal(crownAwardTier("daily", 4, 8), "daily_seat");
});
