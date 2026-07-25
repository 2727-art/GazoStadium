"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SoloProfileProjectionConflictError,
  calculateSoloProfileRating,
  projectNormalSoloProfile,
  projectOverallSoloProfile,
} = require("../solo-profile-projection");

const token = "a".repeat(40);
const olderToken = "b".repeat(40);
const roomId = "-ProjectionRoom00001";
const receipt = (resultToken, outcome) => `${resultToken}:${outcome}`;

function event(overrides = {}) {
  return {
    name: "PLAYER",
    pursuitLine: "まだ終わらない。次の一枚をどうぞ！",
    outcome: "win",
    opponentRating: 1000,
    roomId,
    resultToken: token,
    updatedAt: 123456789,
    projectionSequence: 1,
    ...overrides,
  };
}

function normalProfile(overrides = {}) {
  return {
    name: "OLD",
    pursuitLine: "以前の追撃",
    wins: 4,
    losses: 3,
    draws: 2,
    streak: 2,
    bestStreak: 5,
    rating: 1000,
    updatedAt: 100,
    appliedResults: {
      [olderToken]: "loss",
    },
    serverProjectionReceipts: receipt(olderToken, "loss"),
    ...overrides,
  };
}

function mode(wins = 0, losses = 0, draws = 0) {
  return {
    wins,
    losses,
    draws,
    matches: wins + losses + draws,
    points: (wins * 3) + draws,
  };
}

function overallProfile(overrides = {}) {
  return {
    name: "OLD",
    wins: 7,
    losses: 4,
    draws: 3,
    streak: 2,
    bestStreak: 5,
    rating: 1000,
    modes: {
      solo: mode(4, 3, 2),
      strategy: mode(3, 1, 1),
      team: mode(),
      royale: mode(),
    },
    updatedAt: 100,
    appliedResults: {
      [olderToken]: "loss",
    },
    serverProjectionReceipts: receipt(olderToken, "loss"),
    ...overrides,
  };
}

test("Elo projection uses K=32, the existing rounding, and rating bounds", () => {
  assert.equal(calculateSoloProfileRating(1000, 1000, "win"), 1016);
  assert.equal(calculateSoloProfileRating(1000, 1000, "loss"), 984);
  assert.equal(calculateSoloProfileRating(1000, 1000, "draw"), 1000);
  assert.equal(calculateSoloProfileRating(2999, 100, "win"), 2999);
  assert.equal(calculateSoloProfileRating(101, 3000, "loss"), 101);
});

test("normal profile projection applies a win once and preserves prior result tokens", () => {
  const current = normalProfile();
  const result = projectNormalSoloProfile(current, event({
    name: "  NEW PLAYER  ",
    pursuitLine: "  追撃する\r\n 次だ  ",
  }));

  assert.equal(result.status, "applied");
  assert.deepEqual(result.profile, {
    name: "NEW PLAYER",
    pursuitLine: "追撃する 次だ",
    wins: 5,
    losses: 3,
    draws: 2,
    streak: 3,
    bestStreak: 5,
    rating: 1016,
    updatedAt: 123456789,
    lastResultRoomId: roomId,
    lastResultOutcome: "win",
    appliedResults: {
      [olderToken]: "loss",
      [token]: "win",
    },
    serverProjectionReceipts: [
      receipt(olderToken, "loss"),
      receipt(token, "win"),
    ].join(","),
    serverProjectionSequence: 1,
  });
  assert.equal(current.wins, 4);
  assert.equal(current.appliedResults[token], undefined);
});

test("normal loss resets streak while draw preserves it and both update Elo", () => {
  const loss = projectNormalSoloProfile(
    normalProfile({ rating: 1200, streak: 4 }),
    event({ outcome: "loss", opponentRating: 800 }),
  ).profile;
  assert.equal(loss.losses, 4);
  assert.equal(loss.streak, 0);
  assert.equal(loss.bestStreak, 5);
  assert.equal(loss.rating, 1171);

  const draw = projectNormalSoloProfile(
    normalProfile({ rating: 1200, streak: 4 }),
    event({ outcome: "draw", opponentRating: 800 }),
  ).profile;
  assert.equal(draw.draws, 3);
  assert.equal(draw.streak, 4);
  assert.equal(draw.bestStreak, 5);
  assert.equal(draw.rating, 1187);
});

test("a delayed projection preserves profile text written after the verified match", () => {
  const result = projectNormalSoloProfile(
    normalProfile({
      name: "LATEST",
      pursuitLine: "新しい追撃",
      updatedAt: 999_999_999,
    }),
    event({
      name: "MATCH NAME",
      pursuitLine: "対戦時の追撃",
    }),
  );

  assert.equal(result.profile.name, "LATEST");
  assert.equal(result.profile.pursuitLine, "新しい追撃");
  assert.equal(result.profile.updatedAt, 999_999_999);

  const nextDelayedResult = projectNormalSoloProfile(
    result.profile,
    event({
      name: "SECOND MATCH NAME",
      pursuitLine: "二戦目の追撃",
      resultToken: "c".repeat(40),
      updatedAt: 234_567_890,
      projectionSequence: 2,
    }),
  );
  assert.equal(nextDelayedResult.profile.name, "LATEST");
  assert.equal(nextDelayedResult.profile.pursuitLine, "新しい追撃");
  assert.equal(nextDelayedResult.profile.updatedAt, 999_999_999);
});

test("normal projection is idempotent for the same token and rejects a conflicting outcome", () => {
  const alreadyApplied = normalProfile({
    serverProjectionReceipts: receipt(token, "win"),
  });
  const result = projectNormalSoloProfile(alreadyApplied, event());
  assert.equal(result.status, "already-applied");
  assert.strictEqual(result.profile, alreadyApplied);

  assert.throws(
    () => projectNormalSoloProfile(
      normalProfile({
        serverProjectionReceipts: receipt(token, "loss"),
        serverProjectionSequence: 9,
      }),
      event(),
    ),
    (error) => error instanceof SoloProfileProjectionConflictError
      && error.code === "solo-profile-projection/outcome-conflict"
      && error.existingOutcome === "loss"
      && error.requestedOutcome === "win",
  );
});

test("existing overall profile increments aggregate and solo mode without changing other modes", () => {
  const current = overallProfile();
  const projectedNormal = projectNormalSoloProfile(normalProfile(), event()).profile;
  const result = projectOverallSoloProfile(current, projectedNormal, event());

  assert.equal(result.status, "applied");
  assert.deepEqual(result.profile.modes, {
    solo: mode(5, 3, 2),
    strategy: mode(3, 1, 1),
    team: mode(),
    royale: mode(),
  });
  assert.equal(result.profile.wins, 8);
  assert.equal(result.profile.losses, 4);
  assert.equal(result.profile.draws, 3);
  assert.equal(result.profile.streak, 3);
  assert.equal(result.profile.bestStreak, 5);
  assert.equal(result.profile.rating, 1016);
  assert.equal(result.profile.appliedResults[olderToken], "loss");
  assert.equal(result.profile.appliedResults[token], "win");
  assert.equal(
    result.profile.serverProjectionReceipts,
    [receipt(olderToken, "loss"), receipt(token, "win")].join(","),
  );
  assert.equal(result.profile.serverProjectionSequence, 1);
  assert.equal(result.profile.lastResultMode, "solo");
  assert.equal(current.modes.solo.wins, 4);
});

test("missing overall profile seeds from the already-projected normal profile without double counting", () => {
  const projectedNormal = projectNormalSoloProfile(normalProfile(), event()).profile;
  const result = projectOverallSoloProfile(null, projectedNormal, event());

  assert.equal(result.status, "seeded");
  assert.deepEqual(result.profile.modes, {
    solo: mode(5, 3, 2),
    strategy: mode(),
    team: mode(),
    royale: mode(),
  });
  assert.equal(result.profile.wins, 5);
  assert.equal(result.profile.losses, 3);
  assert.equal(result.profile.draws, 2);
  assert.equal(result.profile.streak, 3);
  assert.equal(result.profile.bestStreak, 5);
  assert.equal(result.profile.rating, 1016);
  assert.deepEqual(result.profile.appliedResults, { [token]: "win" });
  assert.equal(
    result.profile.serverProjectionReceipts,
    [receipt(olderToken, "loss"), receipt(token, "win")].join(","),
  );
  assert.equal(result.profile.serverProjectionSequence, 1);
});

test("overall projection preserves newer profile identity across delayed jobs and first-time seeding", () => {
  const firstEvent = event({
    name: "OLD MATCH",
    resultToken: "c".repeat(40),
    updatedAt: 200,
  });
  const currentOverall = overallProfile({
    name: "LATEST",
    updatedAt: 500,
  });
  const projectedNormal = projectNormalSoloProfile(
    normalProfile({ name: "LATEST", updatedAt: 500 }),
    firstEvent,
  ).profile;
  const projectedOverall = projectOverallSoloProfile(
    currentOverall,
    projectedNormal,
    firstEvent,
  ).profile;
  assert.equal(projectedOverall.name, "LATEST");
  assert.equal(projectedOverall.updatedAt, 500);

  const seededOverall = projectOverallSoloProfile(null, projectedNormal, firstEvent).profile;
  assert.equal(seededOverall.name, "LATEST");
  assert.equal(seededOverall.updatedAt, 500);
});

test("overall seed requires the normal projection token and rejects a mismatched outcome", () => {
  assert.throws(
    () => projectOverallSoloProfile(null, normalProfile(), event()),
    /does not contain the verified result token/,
  );
  assert.throws(
    () => projectOverallSoloProfile(
      null,
      normalProfile({
        serverProjectionReceipts: receipt(token, "loss"),
      }),
      event(),
    ),
    SoloProfileProjectionConflictError,
  );
});

test("overall projection is idempotent for the same token and rejects a conflicting outcome", () => {
  const projectedNormal = projectNormalSoloProfile(normalProfile(), event()).profile;
  const alreadyApplied = overallProfile({
    serverProjectionReceipts: receipt(token, "win"),
  });
  const result = projectOverallSoloProfile(alreadyApplied, projectedNormal, event());
  assert.equal(result.status, "already-applied");
  assert.strictEqual(result.profile, alreadyApplied);

  assert.throws(
    () => projectOverallSoloProfile(
      overallProfile({
        serverProjectionReceipts: receipt(token, "draw"),
        serverProjectionSequence: 9,
      }),
      projectedNormal,
      event(),
    ),
    SoloProfileProjectionConflictError,
  );
});

test("a client-writable receipt cannot preempt or poison a server projection", () => {
  const result = projectNormalSoloProfile(
    normalProfile({
      appliedResults: {
        [token]: "loss",
      },
    }),
    event(),
  );
  assert.equal(result.status, "applied");
  assert.equal(result.profile.wins, 5);
  assert.equal(result.profile.appliedResults[token], "win");
  assert.equal(
    result.profile.serverProjectionReceipts,
    [receipt(olderToken, "loss"), receipt(token, "win")].join(","),
  );
});

test("overall projection absorbs a concurrent seed copied from projected normal", () => {
  const projectedNormal = projectNormalSoloProfile(normalProfile(), event()).profile;
  const concurrentSeed = {
    name: projectedNormal.name,
    wins: projectedNormal.wins,
    losses: projectedNormal.losses,
    draws: projectedNormal.draws,
    streak: projectedNormal.streak,
    bestStreak: projectedNormal.bestStreak,
    rating: projectedNormal.rating,
    modes: {
      solo: mode(projectedNormal.wins, projectedNormal.losses, projectedNormal.draws),
      strategy: mode(),
      team: mode(),
      royale: mode(),
    },
    updatedAt: event().updatedAt + 1,
    appliedResults: {
      [token]: "win",
    },
  };
  const result = projectOverallSoloProfile(concurrentSeed, projectedNormal, event());
  assert.equal(result.status, "absorbed-concurrent-seed");
  assert.equal(result.profile.wins, projectedNormal.wins);
  assert.equal(result.profile.modes.solo.wins, projectedNormal.wins);
  assert.equal(result.profile.serverProjectionReceipts, receipt(token, "win"));
  assert.equal(result.profile.serverProjectionSequence, 1);
});

test("projection sequence is required to be a positive safe integer", () => {
  for (const projectionSequence of [
    undefined,
    0,
    -1,
    1.5,
    "1",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => projectNormalSoloProfile(
        normalProfile(),
        event({ projectionSequence }),
      ),
      /Invalid solo profile projection sequence/,
    );
  }
});

test("projection sequence permanently fences an old result after its receipt is evicted", () => {
  let normal = normalProfile();
  let overall = overallProfile();
  let firstEvent;

  for (let projectionSequence = 1; projectionSequence <= 17; projectionSequence += 1) {
    const projectionEvent = event({
      resultToken: projectionSequence.toString(16).padStart(40, "0"),
      projectionSequence,
      updatedAt: 123_456_789 + projectionSequence,
    });
    if (projectionSequence === 1) firstEvent = projectionEvent;
    normal = projectNormalSoloProfile(normal, projectionEvent).profile;
    overall = projectOverallSoloProfile(overall, normal, projectionEvent).profile;
  }

  assert.equal(normal.serverProjectionSequence, 17);
  assert.equal(overall.serverProjectionSequence, 17);
  assert.equal(normal.serverProjectionReceipts.includes(firstEvent.resultToken), false);
  assert.equal(overall.serverProjectionReceipts.includes(firstEvent.resultToken), false);

  const normalWins = normal.wins;
  const overallWins = overall.wins;
  const overallSoloWins = overall.modes.solo.wins;
  const repeatedNormal = projectNormalSoloProfile(normal, firstEvent);
  const repeatedOverall = projectOverallSoloProfile(overall, normal, firstEvent);

  assert.equal(repeatedNormal.status, "obsolete");
  assert.strictEqual(repeatedNormal.profile, normal);
  assert.equal(repeatedNormal.profile.wins, normalWins);
  assert.equal(repeatedOverall.status, "obsolete");
  assert.strictEqual(repeatedOverall.profile, overall);
  assert.equal(repeatedOverall.profile.wins, overallWins);
  assert.equal(repeatedOverall.profile.modes.solo.wins, overallSoloWins);
});

test("a delayed result increments counters without rewinding newer competitive state", () => {
  const delayedEvent = event({
    resultToken: "d".repeat(40),
    updatedAt: 200,
  });
  const newerNormal = normalProfile({
    name: "LATEST",
    updatedAt: 500,
    streak: 0,
    bestStreak: 8,
    rating: 1200,
    lastResultRoomId: "-NewerResultRoom0001",
    lastResultOutcome: "loss",
  });
  const normal = projectNormalSoloProfile(newerNormal, delayedEvent).profile;
  assert.equal(normal.wins, newerNormal.wins + 1);
  assert.equal(normal.streak, 0);
  assert.equal(normal.bestStreak, 8);
  assert.equal(normal.rating, 1200);
  assert.equal(normal.lastResultRoomId, "-NewerResultRoom0001");
  assert.equal(normal.lastResultOutcome, "loss");
  assert.equal(normal.updatedAt, 500);

  const newerOverall = overallProfile({
    updatedAt: 500,
    streak: 0,
    bestStreak: 8,
    rating: 1200,
    lastResultRoomId: "-NewerResultRoom0001",
    lastResultMode: "strategy",
    lastResultOutcome: "loss",
  });
  const overall = projectOverallSoloProfile(newerOverall, normal, delayedEvent).profile;
  assert.equal(overall.wins, newerOverall.wins + 1);
  assert.equal(overall.modes.solo.wins, newerOverall.modes.solo.wins + 1);
  assert.equal(overall.streak, 0);
  assert.equal(overall.bestStreak, 8);
  assert.equal(overall.rating, 1200);
  assert.equal(overall.lastResultRoomId, "-NewerResultRoom0001");
  assert.equal(overall.lastResultMode, "strategy");
  assert.equal(overall.lastResultOutcome, "loss");
  assert.equal(overall.updatedAt, 500);
});

test("legacy overall totals without modes remain the solo baseline", () => {
  const legacy = {
    name: "LEGACY",
    wins: 2,
    losses: 1,
    draws: 1,
    streak: 1,
    bestStreak: 2,
    rating: 1100,
    appliedResults: {},
  };
  const projectedNormal = projectNormalSoloProfile(normalProfile(), event()).profile;
  const result = projectOverallSoloProfile(legacy, projectedNormal, event({ outcome: "draw" }));

  assert.deepEqual(result.profile.modes.solo, mode(2, 1, 2));
  assert.equal(result.profile.wins, 2);
  assert.equal(result.profile.losses, 1);
  assert.equal(result.profile.draws, 2);
  assert.equal(result.profile.streak, 1);
});
