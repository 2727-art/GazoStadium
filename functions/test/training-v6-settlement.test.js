"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { applyTrainingSession } = require("../training");
const {
  TRAINING_V6_WORKOUT_SECONDS,
  deriveTrainingV6Settlement,
  executeTrainingV6Settlement,
  trainingV6SettlementClaimMatches,
} = require("../training-v6-settlement");

const NOW = 1_900_000_100_000;
const TERMINAL_AT = NOW - 1_000;
const HOST_UID = "training-v6-host";
const GUEST_UID = "training-v6-guest";
const ROOM_ID = "room1234567890123456";

function workout({
  index,
  trainerUid,
  victimUid,
  completedAt,
}) {
  return {
    index,
    drawIndex: 1,
    trainerUid,
    victimUid,
    score: 8,
    sourceImageNumber: 1,
    durationSeconds: TRAINING_V6_WORKOUT_SECONDS,
    startedAt: completedAt - (TRAINING_V6_WORKOUT_SECONDS * 1000),
    endsAt: completedAt,
    completedAt,
  };
}

function terminalRoom({
  phase = "complete",
  type = "completed",
  workoutQueue = [],
} = {}) {
  const roundNumber = type === "all_miss"
    ? 5
    : Math.max(1, workoutQueue.length);
  return {
    protocolVersion: 6,
    variant: "companion_v6",
    roomId: ROOM_ID,
    phase,
    revision: 12,
    roundNumber,
    members: {
      [HOST_UID]: true,
      [GUEST_UID]: true,
    },
    memberOrder: {
      0: HOST_UID,
      1: GUEST_UID,
    },
    participantUids: [HOST_UID, GUEST_UID],
    workoutQueue,
    result: {
      type,
      reason: phase === "no_contest"
        ? "health"
        : type === "all_miss"
          ? "five_draws_without_hit"
          : "accompaniment_completed",
      completedAt: TERMINAL_AT,
      workoutCount: workoutQueue.length,
      drawCount: roundNumber,
    },
  };
}

function singleHitRoom() {
  return terminalRoom({
    workoutQueue: [
      workout({
        index: 0,
        trainerUid: GUEST_UID,
        victimUid: HOST_UID,
        completedAt: TERMINAL_AT - 100,
      }),
    ],
  });
}

function doubleHitRoom() {
  return terminalRoom({
    workoutQueue: [
      workout({
        index: 0,
        trainerUid: GUEST_UID,
        victimUid: HOST_UID,
        completedAt: TERMINAL_AT - 200,
      }),
      workout({
        index: 1,
        trainerUid: HOST_UID,
        victimUid: GUEST_UID,
        completedAt: TERMINAL_AT - 100,
      }),
    ],
  });
}

test("complete all-miss records one session for both without workout credit", () => {
  const decision = deriveTrainingV6Settlement({
    room: terminalRoom({ type: "all_miss" }),
    callerUid: HOST_UID,
    now: NOW,
  });

  assert.equal(decision.recordable, true);
  assert.equal(decision.dailyEligible, true);
  assert.equal(decision.achievementEligible, true);
  for (const uid of [HOST_UID, GUEST_UID]) {
    assert.deepEqual(decision.metricsByUid[uid], {
      sessionDelta: 1,
      completedSets: 0,
      completedSeconds: 0,
      completionTimestamps: [],
    });
    assert.equal(decision.claimsByUid[uid].sessionDelta, 1);
    assert.equal(decision.claimsByUid[uid].claimId, `${ROOM_ID}:${uid}`);
  }
});

test("single HIT credits only the victim who has an explicit completedAt", () => {
  const decision = deriveTrainingV6Settlement({
    room: singleHitRoom(),
    callerUid: GUEST_UID,
    now: NOW,
  });

  assert.deepEqual(decision.metricsByUid[HOST_UID], {
    sessionDelta: 1,
    completedSets: 1,
    completedSeconds: 60,
    completionTimestamps: [TERMINAL_AT - 100],
  });
  assert.deepEqual(decision.metricsByUid[GUEST_UID], {
    sessionDelta: 1,
    completedSets: 0,
    completedSeconds: 0,
    completionTimestamps: [],
  });

  const incomplete = singleHitRoom();
  delete incomplete.workoutQueue[0].completedAt;
  assert.throws(
    () => deriveTrainingV6Settlement({
      room: incomplete,
      callerUid: HOST_UID,
      now: NOW,
    }),
    /unfinished workout/,
  );
});

test("double HIT credits at most one 60-second set to each victim", () => {
  const decision = deriveTrainingV6Settlement({
    room: doubleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
  });

  for (const uid of [HOST_UID, GUEST_UID]) {
    assert.equal(decision.metricsByUid[uid].sessionDelta, 1);
    assert.equal(decision.metricsByUid[uid].completedSets, 1);
    assert.equal(decision.metricsByUid[uid].completedSeconds, 60);
    assert.equal(decision.metricsByUid[uid].completionTimestamps.length, 1);
  }

  const duplicateVictim = doubleHitRoom();
  duplicateVictim.workoutQueue[1].victimUid = HOST_UID;
  duplicateVictim.workoutQueue[1].trainerUid = GUEST_UID;
  assert.throws(
    () => deriveTrainingV6Settlement({
      room: duplicateVictim,
      callerUid: HOST_UID,
      now: NOW,
    }),
    /duplicate victim/,
  );
});

test("no contest is excluded from claims, daily, achievements, and sessions", async () => {
  const room = terminalRoom({
    phase: "no_contest",
    type: "no_contest",
    workoutQueue: [
      workout({
        index: 0,
        trainerUid: GUEST_UID,
        victimUid: HOST_UID,
        completedAt: TERMINAL_AT - 100,
      }),
    ],
  });
  const decision = deriveTrainingV6Settlement({
    room,
    callerUid: HOST_UID,
    now: NOW,
  });
  assert.equal(decision.recordable, false);
  assert.equal(decision.dailyEligible, false);
  assert.equal(decision.achievementEligible, false);
  assert.deepEqual(decision.claimsByUid, {});
  for (const uid of [HOST_UID, GUEST_UID]) {
    assert.equal(decision.metricsByUid[uid].sessionDelta, 0);
    assert.equal(decision.metricsByUid[uid].completedSets, 0);
    assert.equal(decision.metricsByUid[uid].completedSeconds, 0);
  }

  let transactionCalls = 0;
  const result = await executeTrainingV6Settlement({
    room,
    callerUid: HOST_UID,
    now: NOW,
    dependencies: {
      runTransaction: async () => {
        transactionCalls += 1;
      },
    },
  });
  assert.equal(result.status, "ignored");
  assert.equal(transactionCalls, 0);
});

test("claim matching fixes roomId plus uid metrics while allowing retry metadata", () => {
  const decision = deriveTrainingV6Settlement({
    room: singleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
  });
  const expected = decision.claimsByUid[HOST_UID];
  assert.equal(trainingV6SettlementClaimMatches(expected, expected), true);
  assert.equal(trainingV6SettlementClaimMatches({
    ...expected,
    finalizedBy: GUEST_UID,
    createdAt: NOW + 1,
  }, expected), true);
  assert.equal(trainingV6SettlementClaimMatches({
    ...expected,
    completedSeconds: 120,
  }, expected), false);
  assert.equal(trainingV6SettlementClaimMatches({
    ...expected,
    uid: GUEST_UID,
  }, expected), false);
});

function memoryDependencies({ initialClaims = {} } = {}) {
  const claims = new Map(Object.entries(initialClaims));
  const profiles = {
    [HOST_UID]: {},
    [GUEST_UID]: {},
  };
  const applyCalls = [];
  let transactionCalls = 0;
  return {
    claims,
    profiles,
    applyCalls,
    get transactionCalls() {
      return transactionCalls;
    },
    dependencies: {
      runTransaction: async (callback) => {
        transactionCalls += 1;
        return callback({ id: transactionCalls });
      },
      getClaim: async ({ claimId }) => claims.get(claimId) || null,
      applyParticipants: async ({ participantSettlements }) => {
        applyCalls.push(participantSettlements.map(({ uid }) => uid));
        for (const { uid, terminalAt, metrics } of participantSettlements) {
          profiles[uid] = applyTrainingSession(
            profiles[uid],
            metrics.completionTimestamps,
            terminalAt,
            NOW,
            { completedSeconds: metrics.completedSeconds },
          );
        }
      },
      createClaim: async ({ claimId, claim }) => {
        assert.equal(claims.has(claimId), false);
        claims.set(claimId, claim);
      },
    },
  };
}

test("injected transaction records both participants once and retries idempotently", async () => {
  const memory = memoryDependencies();
  const first = await executeTrainingV6Settlement({
    room: singleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
    dependencies: memory.dependencies,
  });
  assert.equal(first.status, "recorded");
  assert.deepEqual(first.recordedUids, [HOST_UID, GUEST_UID]);
  assert.equal(memory.profiles[HOST_UID].sessions, 1);
  assert.equal(memory.profiles[GUEST_UID].sessions, 1);
  assert.equal(memory.profiles[HOST_UID].completedSets, 1);
  assert.equal(memory.profiles[HOST_UID].completedSeconds, 60);
  assert.equal(memory.profiles[GUEST_UID].completedSets, 0);
  assert.equal(memory.profiles[GUEST_UID].completedSeconds, 0);

  const second = await executeTrainingV6Settlement({
    room: singleHitRoom(),
    callerUid: GUEST_UID,
    now: NOW + 1,
    dependencies: memory.dependencies,
  });
  assert.equal(second.status, "duplicate");
  assert.deepEqual(second.duplicateUids, [HOST_UID, GUEST_UID]);
  assert.equal(memory.applyCalls.length, 1);
  assert.equal(memory.profiles[HOST_UID].sessions, 1);
  assert.equal(memory.profiles[GUEST_UID].sessions, 1);
});

test("a partial retry applies only the participant whose roomId+uid claim is absent", async () => {
  const firstDecision = deriveTrainingV6Settlement({
    room: doubleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
  });
  const memory = memoryDependencies({
    initialClaims: {
      [`${ROOM_ID}:${HOST_UID}`]: firstDecision.claimsByUid[HOST_UID],
    },
  });
  const result = await executeTrainingV6Settlement({
    room: doubleHitRoom(),
    callerUid: GUEST_UID,
    now: NOW + 1,
    dependencies: memory.dependencies,
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.duplicateUids, [HOST_UID]);
  assert.deepEqual(result.recordedUids, [GUEST_UID]);
  assert.deepEqual(memory.applyCalls, [[GUEST_UID]]);
  assert.equal(memory.profiles[HOST_UID].sessions, undefined);
  assert.equal(memory.profiles[GUEST_UID].sessions, 1);
});

test("a mismatched saved claim fails closed before profiles are changed", async () => {
  const decision = deriveTrainingV6Settlement({
    room: singleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
  });
  const memory = memoryDependencies({
    initialClaims: {
      [`${ROOM_ID}:${HOST_UID}`]: {
        ...decision.claimsByUid[HOST_UID],
        completedSeconds: 120,
      },
    },
  });
  await assert.rejects(
    executeTrainingV6Settlement({
      room: singleHitRoom(),
      callerUid: HOST_UID,
      now: NOW,
      dependencies: memory.dependencies,
    }),
    /saved settlement claim does not match/,
  );
  assert.equal(memory.applyCalls.length, 0);
  assert.equal(memory.claims.size, 1);
});

test("settlement output has no win loss outcome RATE or ranking fields", () => {
  const decision = deriveTrainingV6Settlement({
    room: doubleHitRoom(),
    callerUid: HOST_UID,
    now: NOW,
  });
  const serialized = JSON.stringify(decision);
  for (const forbidden of [
    "\"win\"",
    "\"loss\"",
    "\"outcome\"",
    "\"rate\"",
    "\"rating\"",
    "\"ranking\"",
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
});
