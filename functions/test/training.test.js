"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  LEGACY_TRAINING_VARIANT,
  V2_TRAINING_PROTOCOL_VERSION,
  V2_TRAINING_VARIANT,
  TRAINING_BASE_DURATION_MS,
  TRAINING_COMMAND_COUNT,
  TRAINING_DAMAGE_BY_SCORE,
  TRAINING_DURATION_MS_BY_SCORE,
  TRAINING_MAX_ROUNDS,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_DESTROYED_CLOCK_SKEW_MS,
  TRAINING_ROOM_MAX_AGE_MS,
  TRAINING_TURN_DURATION_MS,
  TRAINING_VARIANT,
  applyTrainingHpSession,
  applyTrainingSession,
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
  jstDateKey,
  normalizeTrainingInstruction,
  normalizeTrainingProfile,
  trainingDailySettlement,
} = require("../training");

const firstUid = "first-player";
const secondUid = "second-player";
const createdAt = Date.parse("2026-07-28T10:00:00+09:00");

function emptyHpProfile() {
  return {
    hpSessions: 0,
    hpWins: 0,
    hpLosses: 0,
    hpDraws: 0,
    hpNoContests: 0,
    hpRounds: 0,
    hpDamageTaken: 0,
    hpScoreReceived: 0,
    hpHitsTaken: 0,
    hpPerfect10sReceived: 0,
    hpCritical9sReceived: 0,
    hpCompletedWorkouts: 0,
    hpCompletedSeconds: 0,
    hpOverkillDealt: 0,
    hpUpdatedAt: 0,
  };
}

function instruction(overrides = {}) {
  return {
    exercise: "スクワット",
    completion: "拍に合わせて20回",
    command: "背筋を伸ばして、無理のない深さで続けろ",
    bpm: 80,
    beatsPerRep: 2,
    ...overrides,
  };
}

function completedTurn(turnNumber, trainerUid, traineeUid, startedAt) {
  return {
    trainerUid,
    traineeUid,
    instruction: instruction(),
    createdAt: startedAt - 100,
    startedAt,
    completedAt: startedAt + 50_000,
  };
}

function room(overrides = {}) {
  return {
    protocolVersion: 1,
    variant: LEGACY_TRAINING_VARIANT,
    createdAt,
    status: "active",
    firstTrainerUid: firstUid,
    members: {
      [firstUid]: true,
      [secondUid]: true,
    },
    players: {
      [firstUid]: { uid: firstUid, name: "FIRST" },
      [secondUid]: { uid: secondUid, name: "SECOND" },
    },
    accepted: {
      [firstUid]: true,
      [secondUid]: true,
    },
    turns: {},
    ...overrides,
  };
}

test("training instructions keep free roleplay text inside the protocol bounds", () => {
  assert.deepEqual(normalizeTrainingInstruction(instruction({
    exercise: "  腕立て伏せ  ",
    completion: " 10回  できたらコンプリート ",
    command: "  俺の画像を見ながら  やり切れ ",
    bpm: 0,
    beatsPerRep: 4,
  })), {
    exercise: "腕立て伏せ",
    completion: "10回 できたらコンプリート",
    command: "俺の画像を見ながら やり切れ",
    bpm: 0,
    beatsPerRep: 4,
  });
  assert.throws(
    () => normalizeTrainingInstruction(instruction({ exercise: "あ".repeat(41) })),
    /exercise length/,
  );
  assert.throws(
    () => normalizeTrainingInstruction(instruction({ completion: "あ".repeat(61) })),
    /completion length/,
  );
  assert.throws(
    () => normalizeTrainingInstruction(instruction({ command: "あ".repeat(121) })),
    /command length/,
  );
  assert.throws(
    () => normalizeTrainingInstruction(instruction({ command: "1行目\n2行目" })),
    /command length/,
  );
  for (const bpm of [39, 40.5, 161]) {
    assert.throws(() => normalizeTrainingInstruction(instruction({ bpm })), /BPM/);
  }
  assert.throws(
    () => normalizeTrainingInstruction(instruction({ beatsPerRep: 3 })),
    /beats per rep/,
  );
});

test("an active turn is pending until the server derives a timeout at exactly 60 seconds", () => {
  const startedAt = createdAt + 1_000;
  const activeRoom = room({
    turns: {
      1: {
        trainerUid: firstUid,
        traineeUid: secondUid,
        instruction: instruction(),
        createdAt: startedAt - 100,
        startedAt,
      },
    },
  });
  const pending = deriveTrainingRoomResult(
    activeRoom,
    startedAt + TRAINING_TURN_DURATION_MS - 1,
  );
  assert.equal(pending.status, "pending");
  assert.equal(pending.retryAfterMs, 1);

  const timedOut = deriveTrainingRoomResult(
    activeRoom,
    startedAt + TRAINING_TURN_DURATION_MS,
  );
  assert.equal(timedOut.status, "final");
  assert.equal(timedOut.reason, "timeout");
  assert.deepEqual(timedOut.outcomes, {
    [firstUid]: "win",
    [secondUid]: "loss",
  });
});

test("a composed turn that the trainee has not started remains pending", () => {
  const waiting = room({
    turns: {
      1: {
        trainerUid: firstUid,
        traineeUid: secondUid,
        instruction: instruction(),
        createdAt: createdAt + 1_000,
      },
    },
  });
  const result = deriveTrainingRoomResult(waiting, createdAt + 2_000);
  assert.equal(result.status, "pending");
  assert.equal(result.turnCount, 1);
  assert.equal(result.retryAfterMs, 0);
});

test("surrender immediately gives the trainee a loss and stops later turns", () => {
  const startedAt = createdAt + 1_000;
  const surrendered = room({
    turns: {
      1: {
        trainerUid: firstUid,
        traineeUid: secondUid,
        instruction: instruction(),
        createdAt: startedAt - 100,
        startedAt,
        surrenderedAt: startedAt + 15_000,
      },
    },
  });
  const result = deriveTrainingRoomResult(surrendered, startedAt + 20_000);
  assert.equal(result.status, "final");
  assert.equal(result.reason, "surrender");
  assert.equal(result.outcomes[firstUid], "win");
  assert.equal(result.outcomes[secondUid], "loss");
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 0,
    [secondUid]: 0,
  });

  surrendered.turns[2] = completedTurn(
    2,
    secondUid,
    firstUid,
    startedAt + 16_000,
  );
  assert.throws(
    () => deriveTrainingRoomResult(surrendered, startedAt + 70_000),
    /unfinished terminal state|roles do not alternate/,
  );
});

test("completion reverses the roles, and an even pair waits for both continue votes", () => {
  const turn1StartedAt = createdAt + 1_000;
  const turn2StartedAt = turn1StartedAt + 51_000;
  const paired = room({
    turns: {
      1: completedTurn(1, firstUid, secondUid, turn1StartedAt),
      2: completedTurn(2, secondUid, firstUid, turn2StartedAt),
    },
  });
  const waiting = deriveTrainingRoomResult(paired, turn2StartedAt + 55_000);
  assert.equal(waiting.status, "pending");
  assert.deepEqual(waiting.completedSetsByUid, {
    [firstUid]: 1,
    [secondUid]: 1,
  });

  paired.continueVotes = {
    1: {
      [firstUid]: "continue",
      [secondUid]: "continue",
    },
  };
  const continuing = deriveTrainingRoomResult(paired, turn2StartedAt + 55_000);
  assert.equal(continuing.status, "pending");
  paired.turns[3] = {
    trainerUid: firstUid,
    traineeUid: secondUid,
    instruction: instruction({ exercise: "腹筋" }),
    createdAt: turn2StartedAt + 50_500,
    startedAt: turn2StartedAt + 51_000,
  };
  assert.equal(
    deriveTrainingRoomResult(paired, turn2StartedAt + 52_000).turnCount,
    3,
  );
});

test("either finish vote closes an even pair as a mutual completion draw", () => {
  const turn1StartedAt = createdAt + 1_000;
  const turn2StartedAt = turn1StartedAt + 51_000;
  const finished = room({
    turns: {
      1: completedTurn(1, firstUid, secondUid, turn1StartedAt),
      2: completedTurn(2, secondUid, firstUid, turn2StartedAt),
    },
    continueVotes: {
      1: {
        [firstUid]: "finish",
      },
    },
  });
  const result = deriveTrainingRoomResult(finished, turn2StartedAt + 55_000);
  assert.equal(result.status, "final");
  assert.equal(result.reason, "mutual_complete");
  assert.deepEqual(result.outcomes, {
    [firstUid]: "draw",
    [secondUid]: "draw",
  });
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 1,
    [secondUid]: 1,
  });
});

test("turn six always closes as mutual completion without another vote", () => {
  const turns = {};
  const continueVotes = {};
  let startedAt = createdAt + 1_000;
  for (let turnNumber = 1; turnNumber <= 6; turnNumber += 1) {
    const trainerUid = turnNumber % 2 === 1 ? firstUid : secondUid;
    const traineeUid = trainerUid === firstUid ? secondUid : firstUid;
    turns[turnNumber] = completedTurn(
      turnNumber,
      trainerUid,
      traineeUid,
      startedAt,
    );
    if (turnNumber === 2 || turnNumber === 4) {
      continueVotes[turnNumber / 2] = {
        [firstUid]: "continue",
        [secondUid]: "continue",
      };
    }
    startedAt += 51_000;
  }
  const result = deriveTrainingRoomResult(
    room({ turns, continueVotes }),
    startedAt,
  );
  assert.equal(result.status, "final");
  assert.equal(result.reason, "mutual_complete");
  assert.equal(result.turnCount, 6);
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 3,
    [secondUid]: 3,
  });
});

test("the server rejects forged rosters, turn jumps, role order, timing, and votes", () => {
  const now = createdAt + 500_000;
  assert.throws(
    () => deriveTrainingRoomResult(room({
      destroyed: { by: firstUid, at: now - 1 },
    }), now),
    /destroyed before its result became final/,
  );
  const outsider = room();
  outsider.accepted.outsider = true;
  assert.throws(() => deriveTrainingRoomResult(outsider, now), /acceptance/);

  const jumped = room({
    turns: {
      2: completedTurn(2, firstUid, secondUid, createdAt + 1_000),
    },
  });
  assert.throws(() => deriveTrainingRoomResult(jumped, now), /contiguous/);

  const wrongRoles = room({
    turns: {
      1: completedTurn(1, secondUid, firstUid, createdAt + 1_000),
    },
  });
  assert.throws(() => deriveTrainingRoomResult(wrongRoles, now), /roles do not alternate/);

  const multipleTerminal = room({
    turns: {
      1: {
        ...completedTurn(1, firstUid, secondUid, createdAt + 1_000),
        surrenderedAt: createdAt + 10_000,
      },
    },
  });
  assert.throws(() => deriveTrainingRoomResult(multipleTerminal, now), /multiple terminal/);

  const lateCompletion = room({
    turns: {
      1: {
        ...completedTurn(1, firstUid, secondUid, createdAt + 1_000),
        completedAt: createdAt + 61_001,
      },
    },
  });
  assert.throws(() => deriveTrainingRoomResult(lateCompletion, now), /timestamp is invalid/);

  const prematureVote = room({
    continueVotes: {
      1: {
        [firstUid]: "continue",
      },
    },
  });
  assert.throws(() => deriveTrainingRoomResult(prematureVote, now), /before any completed pair/);
});

test("a disconnect after terminal evidence preserves the result but not later evidence", () => {
  const startedAt = createdAt + 1_000;
  const surrenderedAt = startedAt + 15_000;
  const finalizedThenDestroyed = room({
    turns: {
      1: {
        trainerUid: firstUid,
        traineeUid: secondUid,
        instruction: instruction(),
        createdAt: startedAt - 100,
        startedAt,
        surrenderedAt,
      },
    },
    destroyed: {
      by: secondUid,
      at: surrenderedAt + 1,
      reason: "disconnect",
    },
  });

  const result = deriveTrainingRoomResult(
    finalizedThenDestroyed,
    surrenderedAt + 2,
  );
  assert.equal(result.status, "final");
  assert.equal(result.reason, "surrender");
  assert.equal(
    assertTrainingRoomFinalizable(
      finalizedThenDestroyed,
      firstUid,
      surrenderedAt + 2,
    ).status,
    "final",
  );

  finalizedThenDestroyed.destroyed.at = surrenderedAt - 1;
  assert.equal(
    deriveTrainingRoomResult(finalizedThenDestroyed, surrenderedAt + 2).status,
    "final",
  );

  finalizedThenDestroyed.destroyed.at =
    surrenderedAt - TRAINING_DESTROYED_CLOCK_SKEW_MS - 1;
  assert.throws(
    () => deriveTrainingRoomResult(finalizedThenDestroyed, surrenderedAt + 2),
    /evidence occurred after room destruction/,
  );
});

function v2Room(overrides = {}) {
  return {
    ...room(),
    protocolVersion: V2_TRAINING_PROTOCOL_VERSION,
    variant: V2_TRAINING_VARIANT,
    carrotChoices: {
      [firstUid]: "boost10",
      [secondUid]: "boost8",
    },
    turns: {},
    ...overrides,
  };
}

function v2CompletedTurn(
  trainerUid,
  traineeUid,
  startedAt,
  { partialAt = 0 } = {},
) {
  const carrotChoice = traineeUid === firstUid ? "boost10" : "boost8";
  const targetDurationMs = carrotChoice === "boost10" ? 90_000 : 70_000;
  const completedAt = partialAt || startedAt + targetDurationMs;
  return {
    trainerUid,
    traineeUid,
    carrotChoice,
    targetDurationMs,
    imageOwnerUid: trainerUid,
    instruction: instruction(),
    createdAt: startedAt - 100,
    startedAt,
    baseCompletedAt: startedAt + TRAINING_BASE_DURATION_MS,
    completedAt,
    ...(partialAt ? {} : { boostCompletedAt: completedAt }),
  };
}

test("protocol v2 fixes three sets each and records full BOOST seconds separately", () => {
  const turns = {};
  let startedAt = createdAt + 1_000;
  for (let turnNumber = 1; turnNumber <= 6; turnNumber += 1) {
    const trainerUid = turnNumber % 2 === 1 ? firstUid : secondUid;
    const traineeUid = trainerUid === firstUid ? secondUid : firstUid;
    turns[turnNumber] = v2CompletedTurn(trainerUid, traineeUid, startedAt);
    startedAt = turns[turnNumber].completedAt + 1_000;
  }
  const result = deriveTrainingRoomResult(v2Room({ turns }), startedAt);
  assert.equal(result.protocolVersion, 2);
  assert.equal(result.status, "final");
  assert.equal(result.reason, "mutual_complete");
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 3,
    [secondUid]: 3,
  });
  assert.deepEqual(result.completedSecondsByUid, {
    [firstUid]: 270,
    [secondUid]: 210,
  });
  assert.deepEqual(result.completedSetSecondsByUid, {
    [firstUid]: [90, 90, 90],
    [secondUid]: [70, 70, 70],
  });
  assert.deepEqual(result.boostCompletedSetsByUid, {
    [firstUid]: 3,
    [secondUid]: 3,
  });
  assert.deepEqual(result.boostSecondsByUid, {
    [firstUid]: 90,
    [secondUid]: 30,
  });
});

test("ending BOOST after BASE preserves the set while a pre-BASE surrender loses", () => {
  const firstStartedAt = createdAt + 1_000;
  const firstTurn = v2CompletedTurn(firstUid, secondUid, firstStartedAt, {
    partialAt: firstStartedAt + 65_000,
  });
  const secondStartedAt = firstTurn.completedAt + 1_000;
  const partialThenLoss = v2Room({
    turns: {
      1: firstTurn,
      2: {
        trainerUid: secondUid,
        traineeUid: firstUid,
        carrotChoice: "boost10",
        targetDurationMs: 90_000,
        imageOwnerUid: secondUid,
        instruction: instruction(),
        createdAt: secondStartedAt - 100,
        startedAt: secondStartedAt,
        surrenderedAt: secondStartedAt + 59_999,
      },
    },
  });
  const result = deriveTrainingRoomResult(
    partialThenLoss,
    secondStartedAt + 60_000,
  );
  assert.equal(result.status, "final");
  assert.equal(result.reason, "surrender");
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 0,
    [secondUid]: 1,
  });
  assert.equal(result.completedSecondsByUid[secondUid], 65);
  assert.equal(result.boostSecondsByUid[secondUid], 5);
  assert.equal(result.boostCompletedSetsByUid[secondUid], 0);
});

test("v2 rejects continue votes, timedOutAt, forged choice metadata, and later turns before terminal", () => {
  const startedAt = createdAt + 1_000;
  const baseTurn = v2CompletedTurn(firstUid, secondUid, startedAt);

  assert.throws(
    () => deriveTrainingRoomResult(v2Room({
      turns: { 1: baseTurn },
      continueVotes: { 1: { [firstUid]: "continue" } },
    }), baseTurn.completedAt + 1),
    /does not support continue votes/,
  );

  const timedOut = structuredClone(baseTurn);
  delete timedOut.baseCompletedAt;
  delete timedOut.completedAt;
  delete timedOut.boostCompletedAt;
  timedOut.timedOutAt = startedAt + 59_999;
  assert.throws(
    () => deriveTrainingRoomResult(v2Room({ turns: { 1: timedOut } }), startedAt + 60_000),
    /does not support timed out/,
  );

  const forged = structuredClone(baseTurn);
  forged.targetDurationMs = 80_000;
  assert.throws(
    () => deriveTrainingRoomResult(v2Room({ turns: { 1: forged } }), baseTurn.completedAt + 1),
    /target duration/,
  );

  const shiftedBase = structuredClone(baseTurn);
  shiftedBase.baseCompletedAt += 1;
  assert.throws(
    () => deriveTrainingRoomResult(
      v2Room({ turns: { 1: shiftedBase } }),
      shiftedBase.completedAt + 1,
    ),
    /base completion timestamp/,
  );

  const shiftedFullBoost = structuredClone(baseTurn);
  shiftedFullBoost.completedAt += 1;
  shiftedFullBoost.boostCompletedAt += 1;
  assert.throws(
    () => deriveTrainingRoomResult(
      v2Room({ turns: { 1: shiftedFullBoost } }),
      shiftedFullBoost.completedAt + 1,
    ),
    /full completion timestamp|boost completion timestamp/,
  );

  const unfinished = structuredClone(baseTurn);
  delete unfinished.completedAt;
  delete unfinished.boostCompletedAt;
  assert.throws(
    () => deriveTrainingRoomResult(v2Room({
      turns: {
        1: unfinished,
        2: v2CompletedTurn(secondUid, firstUid, startedAt + 61_000),
      },
    }), startedAt + 200_000),
    /roles do not alternate|unfinished terminal state/,
  );
});

test("canonical BASE and full BOOST timestamps remain valid after a throttled client returns", () => {
  const startedAt = createdAt + 1_000;
  const completed = v2CompletedTurn(firstUid, secondUid, startedAt);
  const result = deriveTrainingRoomResult(
    v2Room({ turns: { 1: completed } }),
    completed.completedAt + 10 * 60_000,
  );
  assert.equal(result.status, "pending");
  assert.equal(result.completedSetsByUid[secondUid], 1);
  assert.equal(result.completedSecondsByUid[secondUid], 70);
});

test("disconnect during BOOST keeps the verified BASE set without inventing boost seconds", () => {
  const startedAt = createdAt + 1_000;
  const interrupted = v2Room({
    turns: {
      1: {
        ...v2CompletedTurn(firstUid, secondUid, startedAt),
        completedAt: undefined,
        boostCompletedAt: undefined,
      },
    },
    destroyed: {
      by: secondUid,
      at: startedAt + 65_000,
      reason: "disconnect",
    },
  });
  delete interrupted.turns[1].completedAt;
  delete interrupted.turns[1].boostCompletedAt;
  const result = deriveTrainingRoomResult(interrupted, startedAt + 66_000);
  assert.equal(result.status, "final");
  assert.equal(result.reason, "base_complete_interrupt");
  assert.equal(result.outcomes[firstUid], "draw");
  assert.equal(result.outcomes[secondUid], "draw");
  assert.equal(result.completedSetsByUid[secondUid], 1);
  assert.equal(result.completedSecondsByUid[secondUid], 60);
  assert.deepEqual(result.completedSetSecondsByUid[secondUid], [60]);
  assert.equal(result.boostSecondsByUid[secondUid], 0);
  assert.equal(result.boostCompletedSetsByUid[secondUid], 0);
});

test("both players completing their third BASE is mutual completion even if final BOOST disconnects", () => {
  const turns = {};
  let startedAt = createdAt + 1_000;
  for (let turnNumber = 1; turnNumber <= 6; turnNumber += 1) {
    const trainerUid = turnNumber % 2 === 1 ? firstUid : secondUid;
    const traineeUid = trainerUid === firstUid ? secondUid : firstUid;
    turns[turnNumber] = v2CompletedTurn(trainerUid, traineeUid, startedAt);
    startedAt = turns[turnNumber].completedAt + 1_000;
  }
  delete turns[6].completedAt;
  delete turns[6].boostCompletedAt;
  const interruptedAt = turns[6].baseCompletedAt + 1_000;
  const result = deriveTrainingRoomResult(v2Room({
    turns,
    destroyed: {
      by: turns[6].traineeUid,
      at: interruptedAt,
      reason: "disconnect",
    },
  }), interruptedAt + 1);

  assert.equal(result.status, "final");
  assert.equal(result.reason, "mutual_base_complete");
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 3,
    [secondUid]: 3,
  });
  assert.equal(result.completedSecondsByUid[turns[6].traineeUid] % 60, 0);
  assert.equal(result.boostCompletedSetsByUid[turns[6].traineeUid], 2);
});

test("disconnect after a completed set preserves earlier verified progress", () => {
  const firstStartedAt = createdAt + 1_000;
  const firstTurn = v2CompletedTurn(firstUid, secondUid, firstStartedAt);
  const secondStartedAt = firstTurn.completedAt + 1_000;
  const interrupted = v2Room({
    turns: {
      1: firstTurn,
      2: {
        trainerUid: secondUid,
        traineeUid: firstUid,
        carrotChoice: "boost10",
        targetDurationMs: 90_000,
        imageOwnerUid: secondUid,
        instruction: instruction(),
        createdAt: secondStartedAt - 100,
        startedAt: secondStartedAt,
      },
    },
    destroyed: {
      by: firstUid,
      at: secondStartedAt + 30_000,
      reason: "disconnect",
    },
  });

  const result = deriveTrainingRoomResult(interrupted, secondStartedAt + 31_000);
  assert.equal(result.status, "final");
  assert.equal(result.reason, "progress_complete_interrupt");
  assert.equal(result.turnCount, 1);
  assert.equal(result.completedSetsByUid[secondUid], 1);
  assert.equal(result.completedSecondsByUid[secondUid], 70);
  assert.equal(result.boostCompletedSetsByUid[secondUid], 1);
  assert.equal(result.boostSecondsByUid[secondUid], 10);
  assert.equal(result.completedSetsByUid[firstUid], 0);

  const destructionBeforeCompletion = v2Room({
    turns: { 1: firstTurn },
    destroyed: {
      by: firstUid,
      at: firstTurn.completedAt - TRAINING_DESTROYED_CLOCK_SKEW_MS - 1,
      reason: "disconnect",
    },
  });
  assert.throws(
    () => deriveTrainingRoomResult(destructionBeforeCompletion, firstTurn.completedAt + 1),
    /evidence occurred after room destruction/,
  );
});

function commandDeck() {
  return {
    1: {
      exercise: "スクワット",
      completion: "最後まで続ける",
      command: "拍に合わせて続けろ",
      beatsPerRep: 2,
    },
    2: {
      exercise: "腕立て伏せ",
      completion: "最後まで続ける",
      command: "無理のないフォームで続けろ",
      beatsPerRep: 4,
    },
    3: {
      exercise: "腹筋",
      completion: "最後まで続ける",
      command: "呼吸を止めずに続けろ",
      beatsPerRep: 8,
    },
  };
}

const firstImageBpms = { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 };
const secondImageBpms = { 1: 60, 2: 90, 3: 110, 4: 130, 5: 150 };

function v3Room(overrides = {}) {
  return {
    protocolVersion: TRAINING_PROTOCOL_VERSION,
    variant: TRAINING_VARIANT,
    createdAt,
    status: "active",
    hostUid: firstUid,
    guestUid: secondUid,
    members: {
      [firstUid]: true,
      [secondUid]: true,
    },
    players: {
      [firstUid]: {
        uid: firstUid,
        name: "FIRST",
        commandDeck: commandDeck(),
        imageBpms: firstImageBpms,
      },
      [secondUid]: {
        uid: secondUid,
        name: "SECOND",
        commandDeck: commandDeck(),
        imageBpms: secondImageBpms,
      },
    },
    accepted: {
      [firstUid]: true,
      [secondUid]: true,
    },
    rounds: {},
    ...overrides,
  };
}

function v3Round(roundNumber, firstScore, secondScore, {
  completed = true,
  cardIndexes = {},
  imageIndexes = {},
  workoutCompletionOffsets = {},
} = {}) {
  const roundCreatedAt = createdAt + (roundNumber * 500_000);
  const firstImageIndex = imageIndexes[firstUid] || roundNumber;
  const secondImageIndex = imageIndexes[secondUid] || roundNumber;
  const round = {
    createdAt: roundCreatedAt,
    draws: {
      [firstUid]: {
        imageIndex: firstImageIndex,
        bpm: firstImageBpms[firstImageIndex],
        drawnAt: roundCreatedAt + 1_000,
      },
      [secondUid]: {
        imageIndex: secondImageIndex,
        bpm: secondImageBpms[secondImageIndex],
        drawnAt: roundCreatedAt + 1_000,
      },
    },
    imageReceived: {
      [firstUid]: true,
      [secondUid]: true,
    },
    scores: {
      [firstUid]: firstScore,
      [secondUid]: secondScore,
    },
  };
  let evidenceAt = roundCreatedAt + 2_000;
  for (const traineeUid of [firstUid, secondUid]) {
    const score = traineeUid === firstUid ? firstScore : secondScore;
    const durationMs = TRAINING_DURATION_MS_BY_SCORE[score] || 0;
    if (!durationMs) continue;
    const trainerUid = traineeUid === firstUid ? secondUid : firstUid;
    const selectedAt = roundCreatedAt + 3_000;
    const startedAt = roundCreatedAt + 4_000;
    const cardIndex = cardIndexes[traineeUid] || roundNumber;
    round.commandChoices ||= {};
    round.commandChoices[traineeUid] = {
      trainerUid,
      cardIndex,
      selectedAt,
    };
    round.workouts ||= {};
    const completedAt = startedAt + durationMs
      + (workoutCompletionOffsets[traineeUid] || 0);
    round.workouts[traineeUid] = { startedAt, completedAt };
    evidenceAt = Math.max(evidenceAt, completedAt);
  }
  if (completed) round.completedAt = evidenceAt;
  return round;
}

test("protocol v3 derives independent self-damage, image score, workout time, and overkill", () => {
  assert.equal(TRAINING_PROTOCOL_VERSION, 3);
  assert.equal(TRAINING_VARIANT, "kitaeai_hp_v3");
  assert.equal(TRAINING_MAX_ROUNDS, 5);
  assert.equal(TRAINING_COMMAND_COUNT, 3);
  assert.deepEqual(TRAINING_DAMAGE_BY_SCORE, { 8: 10, 9: 15, 10: 20 });
  assert.deepEqual(TRAINING_DURATION_MS_BY_SCORE, {
    8: 60_000,
    9: 75_000,
    10: 90_000,
  });

  const round1 = v3Round(1, 9, 7);
  const round2 = v3Round(2, 10, 8);
  const result = deriveTrainingRoomResult(v3Room({
    rounds: { 1: round1, 2: round2 },
  }), round2.completedAt + 1);

  assert.equal(result.status, "final");
  assert.equal(result.reason, "hp_zero");
  assert.equal(result.outcomes[firstUid], "loss");
  assert.equal(result.outcomes[secondUid], "win");
  assert.deepEqual(result.hpByUid, {
    [firstUid]: 0,
    [secondUid]: 20,
  });
  assert.deepEqual(result.damageReceivedByUid, {
    [firstUid]: 35,
    [secondUid]: 10,
  });
  assert.deepEqual(result.scoreTotalByUid, {
    [firstUid]: 15,
    [secondUid]: 19,
  });
  assert.deepEqual(result.completedWorkoutsByUid, {
    [firstUid]: 2,
    [secondUid]: 1,
  });
  assert.deepEqual(result.workoutSecondsByUid, {
    [firstUid]: 165,
    [secondUid]: 60,
  });
  assert.equal(result.overkillByUid[firstUid], 5);
  assert.deepEqual(result.finisher, {
    eligible: true,
    winnerUid: secondUid,
    loserUid: firstUid,
    overkill: 5,
  });
  assert.deepEqual(result.completedSetsByUid, {
    [firstUid]: 0,
    [secondUid]: 0,
  });
  assert.deepEqual(result.completedSecondsByUid, {
    [firstUid]: 0,
    [secondUid]: 0,
  });
});

test("v3 HP profiles credit overkill only to an eligible finisher winner", () => {
  const overkillDealtFor = (result, participantUid) => (
    result.finisher.eligible
    && result.finisher.winnerUid === participantUid
      ? result.finisher.overkill
      : 0
  );
  const profileFor = (result, participantUid) => applyTrainingHpSession(
    null,
    result.outcomes[participantUid],
    {
      noContest: result.noContest,
      overkillDealt: overkillDealtFor(result, participantUid),
    },
    createdAt + 2_000_000,
  );

  const knockoutRounds = {
    1: v3Round(1, 9, 7),
    2: v3Round(2, 10, 8),
  };
  const knockout = deriveTrainingRoomResult(
    v3Room({ rounds: knockoutRounds }),
    knockoutRounds[2].completedAt + 1,
  );
  assert.equal(knockout.finisher.eligible, true);
  assert.equal(profileFor(knockout, secondUid).hpOverkillDealt, 5);
  assert.equal(profileFor(knockout, firstUid).hpOverkillDealt, 0);

  const doubleKnockoutRounds = {
    1: v3Round(1, 10, 10),
    2: v3Round(2, 10, 9),
  };
  const doubleKnockout = deriveTrainingRoomResult(
    v3Room({ rounds: doubleKnockoutRounds }),
    doubleKnockoutRounds[2].completedAt + 1,
  );
  assert.equal(doubleKnockout.hpByUid[firstUid], 0);
  assert.equal(doubleKnockout.hpByUid[secondUid], 0);
  assert.equal(doubleKnockout.finisher.winnerUid, secondUid);
  assert.equal(profileFor(doubleKnockout, secondUid).hpOverkillDealt, 10);
  assert.equal(profileFor(doubleKnockout, firstUid).hpOverkillDealt, 0);

  for (const interrupted of [
    deriveTrainingRoomResult(v3Room({
      surrendered: { uid: firstUid, at: createdAt + 1_000 },
    }), createdAt + 2_000),
    deriveTrainingRoomResult(v3Room({
      destroyed: {
        by: secondUid,
        at: createdAt + 1_000,
        reason: "health_stop",
      },
    }), createdAt + 2_000),
  ]) {
    assert.equal(interrupted.finisher.eligible, false);
    assert.equal(profileFor(interrupted, firstUid).hpOverkillDealt, 0);
    assert.equal(profileFor(interrupted, secondUid).hpOverkillDealt, 0);
  }
});

test("v3 resolves equal HP by image score, then received 10s and 9s, with draws after all ties", () => {
  const scoreTieRounds = {
    1: v3Round(1, 10, 9),
    2: v3Round(2, 8, 9),
  };
  const scoreTie = deriveTrainingRoomResult(
    v3Room({ rounds: scoreTieRounds }),
    scoreTieRounds[2].completedAt + 1,
  );
  assert.equal(scoreTie.hpByUid[firstUid], 0);
  assert.equal(scoreTie.hpByUid[secondUid], 0);
  assert.equal(scoreTie.scoreTotalByUid[firstUid], 18);
  assert.equal(scoreTie.scoreTotalByUid[secondUid], 18);
  assert.equal(scoreTie.score10CountByUid[secondUid], 1);
  assert.equal(scoreTie.outcomes[secondUid], "win");

  const limitRounds = {};
  for (let round = 1; round <= 5; round += 1) {
    limitRounds[round] = v3Round(round, 7, 6);
  }
  const limit = deriveTrainingRoomResult(
    v3Room({ rounds: limitRounds }),
    limitRounds[5].completedAt + 1,
  );
  assert.equal(limit.reason, "round_limit");
  assert.equal(limit.hpByUid[firstUid], 30);
  assert.equal(limit.hpByUid[secondUid], 30);
  assert.equal(limit.scoreTotalByUid[secondUid], 35);
  assert.equal(limit.outcomes[secondUid], "win");

  const drawRounds = {};
  for (let round = 1; round <= 5; round += 1) {
    drawRounds[round] = v3Round(round, 5, 5);
  }
  const draw = deriveTrainingRoomResult(
    v3Room({ rounds: drawRounds }),
    drawRounds[5].completedAt + 1,
  );
  assert.equal(draw.outcomes[firstUid], "draw");
  assert.equal(draw.outcomes[secondUid], "draw");
});

test("v3 rejects reused images and commands, mismatched BPM, and forged workout timing", () => {
  const round1 = v3Round(1, 8, 1);
  const reusedImage = v3Round(2, 1, 1, {
    imageIndexes: { [firstUid]: 1 },
  });
  assert.throws(
    () => deriveTrainingRoomResult(
      v3Room({ rounds: { 1: round1, 2: reusedImage } }),
      reusedImage.completedAt + 1,
    ),
    /image is invalid or reused/,
  );

  const reusedCommand = v3Round(2, 8, 1, {
    cardIndexes: { [firstUid]: 1 },
  });
  assert.throws(
    () => deriveTrainingRoomResult(
      v3Room({ rounds: { 1: round1, 2: reusedCommand } }),
      reusedCommand.completedAt + 1,
    ),
    /command choice is invalid or reused/,
  );

  const badBpm = v3Round(1, 1, 1);
  badBpm.draws[firstUid].bpm = 160;
  assert.throws(
    () => deriveTrainingRoomResult(v3Room({ rounds: { 1: badBpm } }), badBpm.completedAt + 1),
    /BPM does not match/,
  );

  const badDuration = v3Round(1, 9, 1, {
    workoutCompletionOffsets: { [firstUid]: 1 },
  });
  assert.throws(
    () => deriveTrainingRoomResult(
      v3Room({ rounds: { 1: badDuration } }),
      badDuration.completedAt + 1,
    ),
    /workout completion timestamp/,
  );

  const textScore = v3Round(1, 1, 1);
  textScore.scores[firstUid] = "8";
  assert.throws(
    () => deriveTrainingRoomResult(
      v3Room({ rounds: { 1: textScore } }),
      textScore.completedAt + 1,
    ),
    /score must be an integer/,
  );

  const extraCardField = v3Room();
  extraCardField.players[firstUid].commandDeck[1].bpm = 100;
  assert.throws(
    () => deriveTrainingRoomResult(extraCardField, createdAt + 1),
    /command card fields/,
  );
});

test("v3 requires every triggered workout before round settlement", () => {
  const incomplete = v3Round(1, 9, 1);
  delete incomplete.workouts[firstUid].completedAt;
  assert.throws(
    () => deriveTrainingRoomResult(
      v3Room({ rounds: { 1: incomplete } }),
      incomplete.completedAt + 1,
    ),
    /completed before all hit workouts/,
  );
  delete incomplete.completedAt;
  const pending = deriveTrainingRoomResult(
    v3Room({ rounds: { 1: incomplete } }),
    incomplete.workouts[firstUid].startedAt + 1,
  );
  assert.equal(pending.status, "pending");
  assert.equal(pending.hpByUid[firstUid], 15);
});

test("v3 surrender and health stop finalize safely without overriding a prior natural result", () => {
  const surrendered = deriveTrainingRoomResult(v3Room({
    surrendered: { uid: firstUid, at: createdAt + 1_000 },
  }), createdAt + 2_000);
  assert.equal(surrendered.reason, "surrender");
  assert.equal(surrendered.outcomes[firstUid], "loss");

  const healthStopped = deriveTrainingRoomResult(v3Room({
    destroyed: { by: secondUid, at: createdAt + 1_000, reason: "health_stop" },
  }), createdAt + 2_000);
  assert.equal(healthStopped.reason, "health_stop");
  assert.equal(healthStopped.noContest, true);
  assert.equal(healthStopped.outcomes[firstUid], "draw");

  const finalRound = v3Round(1, 10, 10);
  const secondFinalRound = v3Round(2, 8, 8);
  const naturallyFinal = v3Room({
    rounds: { 1: finalRound, 2: secondFinalRound },
    surrendered: {
      uid: secondUid,
      at: secondFinalRound.completedAt + 1,
    },
  });
  const naturalResult = deriveTrainingRoomResult(
    naturallyFinal,
    secondFinalRound.completedAt + 2,
  );
  assert.equal(naturalResult.reason, "hp_zero");
  assert.equal(naturalResult.outcomes[firstUid], "draw");

  delete naturallyFinal.surrendered;
  naturallyFinal.destroyed = {
    by: secondUid,
    at: secondFinalRound.completedAt + 1,
    reason: "health_stop",
  };
  assert.equal(
    deriveTrainingRoomResult(
      naturallyFinal,
      secondFinalRound.completedAt + 2,
    ).reason,
    "hp_zero",
  );

  naturallyFinal.destroyed.at = secondFinalRound.completedAt - 1;
  assert.throws(
    () => deriveTrainingRoomResult(
      naturallyFinal,
      secondFinalRound.completedAt + 2,
    ),
    /evidence occurred after health stop/,
  );
  delete naturallyFinal.destroyed;
  naturallyFinal.surrendered = {
    uid: secondUid,
    at: secondFinalRound.completedAt - 1,
  };
  assert.throws(
    () => deriveTrainingRoomResult(
      naturallyFinal,
      secondFinalRound.completedAt + 2,
    ),
    /evidence occurred after surrender/,
  );
});

test("v3 HP profile metrics never increment legacy set or three-set history", () => {
  const legacy = applyTrainingSession(null, [createdAt], createdAt, createdAt, {
    completedSeconds: 60,
  });
  const hp = applyTrainingHpSession(legacy, "win", {
    rounds: 2,
    damageTaken: 10,
    scoreReceived: 19,
    hitsTaken: 1,
    perfect10sReceived: 1,
    critical9sReceived: 0,
    completedWorkouts: 1,
    completedSeconds: 60,
    overkillDealt: 5,
  }, createdAt + 1_000);
  assert.equal(hp.sessions, legacy.sessions);
  assert.equal(hp.completedSets, legacy.completedSets);
  assert.equal(hp.completedSeconds, legacy.completedSeconds);
  assert.equal(hp.threeSetCompletions, legacy.threeSetCompletions);
  assert.equal(hp.threeSetDays, legacy.threeSetDays);
  assert.equal(hp.hpSessions, 1);
  assert.equal(hp.hpWins, 1);
  assert.equal(hp.hpRounds, 2);
  assert.equal(hp.hpScoreReceived, 19);
  assert.equal(hp.hpOverkillDealt, 5);
});

test("three-set day streak is separate from legacy activity streak and crosses 1 to 3 once", () => {
  const dayOne = Date.parse("2026-07-28T12:00:00+09:00");
  const firstPartial = applyTrainingSession(
    null,
    [dayOne],
    dayOne,
    dayOne,
    {
      completedSeconds: 60,
      threeSetSessionComplete: false,
      threeSetDayComplete: false,
    },
  );
  const crossed = applyTrainingSession(
    firstPartial,
    [dayOne + 1_000, dayOne + 2_000],
    dayOne + 2_000,
    dayOne + 2_000,
    {
      completedSeconds: 120,
      threeSetSessionComplete: false,
      threeSetDayComplete: true,
    },
  );
  assert.equal(crossed.completeDays, 1);
  assert.equal(crossed.threeSetCompletions, 0);
  assert.equal(crossed.threeSetDays, 1);
  assert.equal(crossed.currentThreeSetStreak, 1);
  assert.equal(crossed.bestThreeSetStreak, 1);
  assert.equal(crossed.lastThreeSetDateKey, "2026-07-28");

  const sameDayReplay = applyTrainingSession(
    crossed,
    [dayOne + 3_000],
    dayOne + 3_000,
    dayOne + 3_000,
    {
      completedSeconds: 60,
      threeSetSessionComplete: false,
      threeSetDayComplete: true,
    },
  );
  assert.equal(sameDayReplay.threeSetDays, 1);
});

test("profile streaks use JST days and do not double count the same day", () => {
  const beforeMidnight = Date.parse("2026-07-27T23:59:59+09:00");
  const afterMidnight = Date.parse("2026-07-28T00:00:00+09:00");
  assert.equal(jstDateKey(beforeMidnight), "2026-07-27");
  assert.equal(jstDateKey(afterMidnight), "2026-07-28");

  const first = applyTrainingSession(null, 2, beforeMidnight);
  assert.deepEqual(first, {
    sessions: 1,
    completedSets: 2,
    completedSeconds: 0,
    boostCompletedSets: 0,
    boostSeconds: 0,
    threeSetCompletions: 0,
    threeSetDays: 0,
    currentThreeSetStreak: 0,
    bestThreeSetStreak: 0,
    lastThreeSetDateKey: "",
    completeDays: 1,
    currentStreak: 1,
    bestStreak: 1,
    lastCompletedDateKey: "2026-07-27",
    ...emptyHpProfile(),
    updatedAt: beforeMidnight,
  });
  const sameDay = applyTrainingSession(first, 1, beforeMidnight + 500);
  assert.equal(sameDay.sessions, 2);
  assert.equal(sameDay.completedSets, 3);
  assert.equal(sameDay.completeDays, 1);
  assert.equal(sameDay.currentStreak, 1);

  const nextDay = applyTrainingSession(sameDay, 1, afterMidnight);
  assert.equal(nextDay.completeDays, 2);
  assert.equal(nextDay.currentStreak, 2);
  assert.equal(nextDay.bestStreak, 2);

  const skippedDay = applyTrainingSession(
    nextDay,
    1,
    Date.parse("2026-07-30T12:00:00+09:00"),
  );
  assert.equal(skippedDay.completeDays, 3);
  assert.equal(skippedDay.currentStreak, 1);
  assert.equal(skippedDay.bestStreak, 2);

  const noCompletion = applyTrainingSession(skippedDay, 0, Date.parse("2026-07-31T12:00:00+09:00"));
  assert.equal(noCompletion.sessions, 5);
  assert.equal(noCompletion.completeDays, 3);
  assert.equal(noCompletion.lastCompletedDateKey, "2026-07-30");
});

test("one long session can count both sides of JST midnight without regressing newer history", () => {
  const beforeMidnight = Date.parse("2026-07-27T23:59:59+09:00");
  const afterMidnight = Date.parse("2026-07-28T00:00:01+09:00");
  const crossed = applyTrainingSession(
    null,
    [beforeMidnight, afterMidnight],
    afterMidnight + 1_000,
  );
  assert.equal(crossed.sessions, 1);
  assert.equal(crossed.completedSets, 2);
  assert.equal(crossed.completeDays, 2);
  assert.equal(crossed.currentStreak, 2);
  assert.equal(crossed.lastCompletedDateKey, "2026-07-28");
  assert.equal(crossed.updatedAt, afterMidnight + 1_000);

  const olderReplay = applyTrainingSession(
    crossed,
    [beforeMidnight],
    afterMidnight + 2_000,
  );
  assert.equal(olderReplay.sessions, 2);
  assert.equal(olderReplay.completedSets, 3);
  assert.equal(olderReplay.completeDays, 2);
  assert.equal(olderReplay.currentStreak, 2);
  assert.equal(olderReplay.lastCompletedDateKey, "2026-07-28");
});

test("delayed finalization credits only the completion day without overwriting a newer daily record", () => {
  const completedAt = Date.parse("2026-07-28T23:59:00+09:00");
  const nextDay = Date.parse("2026-07-29T12:00:00+09:00");
  assert.deepEqual(trainingDailySettlement(
    { daily: { dateKey: "2026-07-28", trainingSets: 0 } },
    [completedAt],
    nextDay,
  ), {
    dateKey: "2026-07-28",
    sessionDateKey: "2026-07-28",
    creditTrainingSet: true,
    creditTrainingSets: 1,
    creditTrainingSeconds: 0,
  });
  assert.deepEqual(trainingDailySettlement(
    { daily: { dateKey: "2026-07-29", trainingSets: 0 } },
    [completedAt],
    nextDay,
  ), {
    dateKey: "2026-07-29",
    sessionDateKey: "2026-07-28",
    creditTrainingSet: false,
    creditTrainingSets: 0,
    creditTrainingSeconds: 0,
  });
  assert.deepEqual(trainingDailySettlement(
    null,
    [Date.parse("2026-07-29T00:01:00+09:00")],
    nextDay,
  ), {
    dateKey: "2026-07-29",
    sessionDateKey: "2026-07-29",
    creditTrainingSet: true,
    creditTrainingSets: 1,
    creditTrainingSeconds: 0,
  });
  const beforeMidnight = Date.parse("2026-07-28T23:59:30+09:00");
  const afterMidnight = Date.parse("2026-07-29T00:01:00+09:00");
  assert.deepEqual(trainingDailySettlement(
    null,
    [beforeMidnight, afterMidnight, afterMidnight + 70_000],
    nextDay,
    [70, 80, 90],
  ), {
    dateKey: "2026-07-29",
    sessionDateKey: "2026-07-29",
    creditTrainingSet: true,
    creditTrainingSets: 2,
    creditTrainingSeconds: 170,
  });
  assert.equal(
    trainingDailySettlement(null, [], nextDay).creditTrainingSet,
    false,
  );
});

test("profile normalization is private-record compatible and old rooms cannot finalize", () => {
  assert.deepEqual(normalizeTrainingProfile({
    sessions: 4.9,
    completedSets: 7,
    completeDays: 3,
    currentStreak: 2,
    bestStreak: 4,
    lastCompletedDateKey: "not-a-date",
    updatedAt: -1,
    wins: 999,
  }), {
    sessions: 4,
    completedSets: 7,
    completedSeconds: 0,
    boostCompletedSets: 0,
    boostSeconds: 0,
    threeSetCompletions: 0,
    threeSetDays: 0,
    currentThreeSetStreak: 0,
    bestThreeSetStreak: 0,
    lastThreeSetDateKey: "",
    completeDays: 3,
    currentStreak: 2,
    bestStreak: 3,
    lastCompletedDateKey: "",
    ...emptyHpProfile(),
    updatedAt: 0,
  });
  assert.throws(
    () => assertTrainingRoomFinalizable(
      room(),
      firstUid,
      createdAt + (12 * 60 * 60 * 1000) + 1,
    ),
    /too old/,
  );
  assert.equal(
    assertTrainingRoomFinalizable(
      room(),
      firstUid,
      createdAt + TRAINING_ROOM_MAX_AGE_MS + 1,
      { maxAgeMs: Number.MAX_SAFE_INTEGER },
    ).status,
    "pending",
  );
  assert.throws(
    () => assertTrainingRoomFinalizable(room(), "outsider", createdAt + 1_000),
    /not a room member/,
  );
});
