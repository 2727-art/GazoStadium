const assert = require("node:assert/strict");
const test = require("node:test");

let core;

test.before(async () => {
  core = await import("../../training-core.mjs");
});

function instruction(overrides = {}) {
  return {
    exercise: "スクワット",
    completion: "60秒続ける",
    command: "拍に合わせてスクワット",
    bpm: 100,
    beatsPerRep: 2,
    ...overrides,
  };
}

function trainingRoom(overrides = {}) {
  return {
    protocolVersion: 2,
    variant: "kitaeai_60_v2",
    status: "active",
    firstTrainerUid: "a",
    members: { a: true, b: true },
    imageReceived: { a: true, b: true },
    carrotChoices: { a: "mine", b: "mine" },
    turns: {},
    ...overrides,
  };
}

function queuePreparation() {
  return {
    commandDeck: {
      1: {
        exercise: "スクワット",
        completion: "最後まで続ける",
        command: "拍に合わせて続けろ",
        beatsPerRep: 2,
      },
      2: {
        exercise: "腕立て伏せ",
        completion: "最後まで続ける",
        command: "自分のペースで続けろ",
        beatsPerRep: 4,
      },
      3: {
        exercise: "腹筋",
        completion: "最後まで続ける",
        command: "呼吸を止めずに続けろ",
        beatsPerRep: 8,
      },
    },
    imageBpms: { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 },
  };
}

function completedMineTurn(turnNumber, trainerUid, traineeUid) {
  const startedAt = 100_000 + (turnNumber * 100_000);
  const completedAt = startedAt + 60_000;
  return {
    trainerUid,
    traineeUid,
    carrotChoice: "mine",
    targetDurationMs: 60_000,
    imageOwnerUid: traineeUid,
    instruction: instruction(),
    startedAt,
    baseCompletedAt: completedAt,
    completedAt,
  };
}

test("normalizes free instructions without replacing the player's words", () => {
  const instruction = core.normalizeTrainingInstruction({
    exercise: `腕立て伏せ${"あ".repeat(50)}`,
    completion: `60秒間、拍に合わせる${"い".repeat(70)}`,
    command: `自分のペースで最後まで続けてください${"う".repeat(150)}`,
    bpm: 120,
    beatsPerRep: 2,
  });

  assert.equal(instruction.exercise.length, 40);
  assert.equal(instruction.completion.length, 60);
  assert.equal(instruction.command.length, 120);
  assert.equal(instruction.bpm, 120);
  assert.equal(instruction.beatsPerRep, 2);
  assert.equal(core.normalizeTrainingBpm(39), 0);
  assert.equal(core.normalizeTrainingBpm(161), 0);
});

test("folds line breaks and repeated whitespace before applying text limits", () => {
  const instruction = core.normalizeTrainingInstruction({
    exercise: "  腕立て\n  伏せ ",
    completion: "10回\r\n  やり切る",
    command: "拍に合わせて\n\n  自分のペースで",
    bpm: 80,
    beatsPerRep: 2,
  });

  assert.equal(instruction.exercise, "腕立て 伏せ");
  assert.equal(instruction.completion, "10回 やり切る");
  assert.equal(instruction.command, "拍に合わせて 自分のペースで");
  assert.equal(core.normalizeTrainingConditions("  ジャンプなし\n 手首軽め "), "ジャンプなし 手首軽め");
  assert.equal(core.normalizeTrainingName("  PLAYER\n ONE "), "PLAYER ONE");
});

test("advertises HP protocol 3 while keeping protocol 2 carrot helpers compatible", () => {
  assert.equal(core.TRAINING_PROTOCOL_VERSION, 3);
  assert.equal(core.TRAINING_VARIANT, "kitaeai_hp_v3");
  assert.equal(core.V2_TRAINING_PROTOCOL_VERSION, 2);
  assert.equal(core.V2_TRAINING_VARIANT, "kitaeai_60_v2");
  assert.equal(core.TRAINING_START_HP, 30);
  assert.equal(core.TRAINING_MAX_ROUNDS, 5);
  assert.equal(core.TRAINING_BASE_DURATION_MS, 60_000);
  assert.equal(core.TRAINING_MAX_TURNS, 6);
  assert.deepEqual(core.TRAINING_CARROT_CHOICES, [
    "mine",
    "boost8",
    "boost9",
    "boost10",
  ]);

  const expectedDurations = {
    mine: 60_000,
    boost8: 70_000,
    boost9: 80_000,
    boost10: 90_000,
  };
  for (const [choice, duration] of Object.entries(expectedDurations)) {
    assert.equal(core.normalizeTrainingCarrotChoice(choice), choice);
    assert.equal(core.trainingTargetDurationMs(choice), duration);
    assert.equal(
      core.trainingImageOwnerUid(choice, "trainee", "trainer"),
      choice === "mine" ? "trainee" : "trainer",
    );
  }
  assert.equal(core.normalizeTrainingCarrotChoice("boost7"), "");
  assert.equal(core.trainingTargetDurationMs("boost7"), 0);
  assert.equal(core.trainingImageOwnerUid("boost7", "trainee", "trainer"), "");
});

test("selects the oldest two fresh waiting players", () => {
  const entries = core.validTrainingQueueEntries({
    late: {
      ...queuePreparation(),
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 200, lastSeen: 990, state: "waiting",
    },
    old: {
      ...queuePreparation(),
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    stale: {
      ...queuePreparation(),
      uid: "stale", sessionId: "session-stale", name: "STALE", intensity: "standard",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 1, lastSeen: 800, state: "waiting",
    },
    missingSession: {
      ...queuePreparation(),
      uid: "missingSession", name: "MISSING", intensity: "standard",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 50, lastSeen: 999, state: "waiting",
    },
    legacy: {
      ...queuePreparation(),
      uid: "legacy", sessionId: "session-legacy", name: "LEGACY", intensity: "standard",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 25, lastSeen: 999, state: "waiting",
    },
    wrongVariant: {
      ...queuePreparation(),
      uid: "wrongVariant", sessionId: "session-wrong", name: "WRONG", intensity: "standard",
      protocolVersion: 3, variant: "kitaeai_60", joinedAt: 30, lastSeen: 999, state: "waiting",
    },
  }, { now: 1000, freshnessMs: 100 });

  assert.deepEqual(core.selectTrainingPair(entries).map(({ uid }) => uid), ["old", "late"]);
  assert.deepEqual(entries.map(({ sessionId }) => sessionId), ["session-old", "session-late"]);
  assert.ok(entries.every((entry) => !Object.hasOwn(entry, "conditions")));
  assert.ok(entries.every((entry) => (
    entry.protocolVersion === core.TRAINING_PROTOCOL_VERSION
    && entry.variant === core.TRAINING_VARIANT
  )));
  const activeFiltered = core.validTrainingQueueEntries({
    old: {
      ...queuePreparation(),
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    late: {
      ...queuePreparation(),
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 3, variant: "kitaeai_hp_v3", joinedAt: 200, lastSeen: 990, state: "waiting",
    },
  }, {
    now: 1000,
    freshnessMs: 100,
    activeUsers: {
      old: { roomId: "stale", rooms: {} },
      late: { roomId: "live", rooms: { live: true } },
    },
  });
  assert.deepEqual(activeFiltered.map(({ uid }) => uid), ["old"]);
});

test("accepts an empty guest condition without rewriting the protected condition path", () => {
  assert.deepEqual(
    core.createTrainingAcceptanceUpdates("guest", ""),
    { "accepted/guest": true },
  );
  assert.deepEqual(
    core.createTrainingAcceptanceUpdates("guest", "  ジャンプなし\n "),
    {
      "players/guest/conditions": "ジャンプなし",
      "accepted/guest": true,
    },
  );
});

test("only treats an unowned active pointer as live during a short presence grace", () => {
  const now = 200_000;
  const room = {
    createdAt: now - 10_000,
    status: "active",
    members: { self: true, other: true },
    presence: {},
  };
  assert.equal(core.trainingActiveRoomAppearsLive(room, "self", now), true);
  room.createdAt = now - core.TRAINING_ACTIVE_PRESENCE_GRACE_MS - 1;
  assert.equal(core.trainingActiveRoomAppearsLive(room, "self", now), false);
  room.presence.self = { online: true, updatedAt: now };
  assert.equal(core.trainingActiveRoomAppearsLive(room, "self", now), true);
  room.presence.self.online = false;
  assert.equal(core.trainingActiveRoomAppearsLive(room, "self", now), false);
  delete room.presence.self;
  room.status = "forming";
  room.createdAt = now - core.TRAINING_FORMING_PRESENCE_GRACE_MS - 1;
  assert.equal(core.trainingActiveRoomAppearsLive(room, "self", now), false);
});

test("restores a server-finalized result even when a destroyed listener wins the race", () => {
  const result = core.trainingServerFinalizedResult({
    version: 2,
    reason: "timeout",
    turnCount: 3,
    outcomes: { self: "win", other: "loss" },
    completedSetsByUid: { self: 1, other: 1 },
    completedSecondsByUid: { self: 60, other: 70 },
    boostCompletedSetsByUid: { self: 0, other: 1 },
  }, "self");
  assert.deepEqual(result, {
    turnIndex: 3,
    completedSets: 2,
    ownCompletedSets: 1,
    completedSeconds: 130,
    ownCompletedSeconds: 60,
    ownBoostCompletedSets: 0,
    result: {
      type: "win",
      winnerUid: "self",
      loserUid: "other",
      reason: "timeout",
    },
  });
  assert.equal(core.trainingServerFinalizedResult({
    version: 1,
    reason: "mutual_complete",
    turnCount: 6,
    outcomes: { self: "draw", other: "draw" },
    completedSetsByUid: { self: 3, other: 3 },
  }, "self"), null);
});

test("restores the complete V3 HP tiebreak evidence from a server-finalized result", () => {
  const result = core.trainingServerFinalizedResult({
    version: 3,
    reason: "round_limit",
    roundCount: 5,
    outcomes: { self: "win", other: "loss" },
    hpByUid: { self: 10, other: 10 },
    damageReceivedByUid: { self: 20, other: 20 },
    scoreTotalByUid: { self: 43, other: 42 },
    score10CountByUid: { self: 2, other: 1 },
    score9CountByUid: { self: 1, other: 3 },
    completedWorkoutsByUid: { self: 2, other: 2 },
    workoutSecondsByUid: { self: 150, other: 150 },
    overkillByUid: { self: 0, other: 0 },
  }, "self");

  assert.deepEqual(result.scoreTotalByUid, { self: 43, other: 42 });
  assert.deepEqual(result.score10CountByUid, { self: 2, other: 1 });
  assert.deepEqual(result.score9CountByUid, { self: 1, other: 3 });
  assert.equal(result.result.type, "win");
  assert.equal(result.result.reason, "round_limit");
});

test("waits for both secret carrot choices after the two images arrive", () => {
  const room = trainingRoom({ carrotChoices: {} });
  assert.equal(core.deriveTrainingRoomState(room, "a", 1000).phase, "waiting_carrot_choices");
  assert.equal(core.deriveTrainingRoomState(room, "b", 1000).phase, "waiting_carrot_choices");

  room.carrotChoices.a = "boost10";
  assert.equal(core.deriveTrainingRoomState(room, "a", 1000).phase, "waiting_carrot_choices");
  room.carrotChoices.b = "mine";
  assert.equal(core.deriveTrainingRoomState(room, "a", 1000).phase, "compose");
  assert.equal(core.deriveTrainingRoomState(room, "b", 1000).phase, "waiting_instruction");

  delete room.imageReceived.b;
  assert.equal(core.deriveTrainingRoomState(room, "a", 1000).phase, "waiting_images");
});

test("uses 60 seconds as the exact base boundary and each choice target as boost expiry", () => {
  const startedAt = 100_000;
  for (const choice of core.TRAINING_CARROT_CHOICES) {
    const targetDurationMs = core.trainingTargetDurationMs(choice);
    const turn = {
      trainerUid: "a",
      traineeUid: "b",
      carrotChoice: choice,
      targetDurationMs,
      imageOwnerUid: core.trainingImageOwnerUid(choice, "b", "a"),
      instruction: instruction(),
      startedAt,
    };
    assert.equal(
      core.trainingTurnStatus(turn, startedAt + 59_999),
      "active",
      `${choice} must remain active one millisecond before BASE`,
    );
    assert.equal(
      core.trainingTurnStatus(turn, startedAt + 60_000),
      "base_expired",
      `${choice} must reach BASE at exactly sixty seconds`,
    );

    turn.baseCompletedAt = startedAt + 60_000;
    if (targetDurationMs > 60_000) {
      assert.equal(core.trainingTurnStatus(turn, startedAt + 60_000), "boost_active");
      assert.equal(core.trainingTurnStatus(turn, startedAt + targetDurationMs - 1), "boost_active");
    }
    assert.equal(
      core.trainingTurnStatus(turn, startedAt + targetDurationMs),
      "boost_expired",
      `${choice} must expire at its exact target`,
    );
    turn.completedAt = startedAt + targetDurationMs;
    assert.equal(core.trainingTurnStatus(turn, startedAt + targetDurationMs), "completed");
  }
});

test("derives a trainee loss only from a pre-base give up", () => {
  const room = trainingRoom({
    turns: {
      1: {
        trainerUid: "a",
        traineeUid: "b",
        carrotChoice: "boost10",
        targetDurationMs: 90_000,
        imageOwnerUid: "a",
        instruction: instruction({
          exercise: "腕立て伏せ",
          completion: "できる範囲",
          command: "60秒チャレンジ",
          bpm: 80,
        }),
        startedAt: 100_000,
      },
    },
  });
  assert.equal(core.deriveTrainingRoomState(room, "b", 159_999).phase, "active");
  assert.equal(core.deriveTrainingRoomState(room, "b", 160_000).phase, "base_expired");
  room.turns[1].surrenderedAt = 159_999;
  const result = core.deriveTrainingRoomState(room, "b", 160_000);
  assert.equal(result.phase, "result");
  assert.equal(result.result.type, "loss");
  assert.equal(result.result.reason, "surrender");
});

test("runs six fixed alternating turns without continuation votes and gives each player three sets", () => {
  const room = trainingRoom({
    continueVotes: {
      1: { a: "finish", b: "finish" },
      2: { a: "finish", b: "finish" },
    },
  });
  assert.equal(core.continueVotePairForTurn(2), 0);
  assert.equal(core.continueVotePairForTurn(4), 0);
  assert.equal(core.continueVotePairForTurn(6), 0);

  const traineeCounts = { a: 0, b: 0 };
  for (let turnNumber = 1; turnNumber <= core.TRAINING_MAX_TURNS; turnNumber += 1) {
    const trainerUid = turnNumber % 2 === 1 ? "a" : "b";
    const traineeUid = trainerUid === "a" ? "b" : "a";
    traineeCounts[traineeUid] += 1;
    room.turns[turnNumber] = completedMineTurn(turnNumber, trainerUid, traineeUid);

    if (turnNumber < core.TRAINING_MAX_TURNS) {
      const next = core.deriveTrainingRoomState(
        room,
        traineeUid,
        room.turns[turnNumber].completedAt + 1,
      );
      assert.equal(next.phase, "compose");
      assert.equal(next.turnIndex, turnNumber + 1);
      assert.equal(next.trainerUid, traineeUid);
      assert.equal(next.traineeUid, trainerUid);
    }
  }

  assert.deepEqual(traineeCounts, { a: 3, b: 3 });
  for (const uid of ["a", "b"]) {
    const result = core.deriveTrainingRoomState(
      room,
      uid,
      room.turns[6].completedAt + 1,
    );
    assert.equal(result.phase, "result");
    assert.equal(result.result.type, "mutual_complete");
    assert.equal(result.completedSets, 6);
    assert.equal(result.ownCompletedSets, 3);
  }
});

function hpRoom(overrides = {}) {
  return {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    status: "active",
    hostUid: "a",
    guestUid: "b",
    members: { a: true, b: true },
    players: {
      a: { uid: "a", ...queuePreparation() },
      b: { uid: "b", ...queuePreparation() },
    },
    rounds: {},
    ...overrides,
  };
}

test("validates the V3 command and BPM preparation without silently repairing it", () => {
  assert.equal(Object.keys(core.normalizeTrainingCommandDeck(
    queuePreparation().commandDeck,
  )).length, 3);
  assert.deepEqual(
    core.normalizeTrainingImageBpms(queuePreparation().imageBpms),
    queuePreparation().imageBpms,
  );
  const badCommand = structuredClone(queuePreparation().commandDeck);
  badCommand[1].beatsPerRep = 3;
  assert.deepEqual(core.normalizeTrainingCommandDeck(badCommand), {});
  const nullBpm = structuredClone(queuePreparation().imageBpms);
  nullBpm[1] = null;
  assert.deepEqual(core.normalizeTrainingImageBpms(nullBpm), {});
  assert.equal(core.trainingDamageForScore(7), 0);
  assert.equal(core.trainingDamageForScore(8), 10);
  assert.equal(core.trainingDamageForScore(9), 15);
  assert.equal(core.trainingDamageForScore(10), 20);
  assert.equal(core.trainingDurationForScore(8), 60_000);
  assert.equal(core.trainingDurationForScore(9), 75_000);
  assert.equal(core.trainingDurationForScore(10), 90_000);
});

test("derives each V3 draw, score, command, workout, and host settlement action", () => {
  const room = hpRoom();
  let view = core.deriveTrainingRoomState(room, "a", 1_000);
  assert.equal(view.phase, "waiting_round");
  assert.equal(view.actions.canCreateRound, true);

  room.rounds[1] = { createdAt: 1_000 };
  view = core.deriveTrainingRoomState(room, "a", 1_000);
  assert.equal(view.phase, "draw");
  assert.equal(view.actions.canDraw, true);

  room.rounds[1].draws = {
    a: { imageIndex: 1, bpm: 0, drawnAt: 1_100 },
  };
  assert.equal(core.deriveTrainingRoomState(room, "a", 1_100).phase, "waiting_draw");
  room.rounds[1].draws.b = { imageIndex: 1, bpm: 0, drawnAt: 1_100 };
  view = core.deriveTrainingRoomState(room, "a", 1_100);
  assert.equal(view.phase, "receive_image");
  assert.equal(view.actions.canAcknowledgeImage, true);

  room.rounds[1].imageReceived = { a: true, b: true };
  view = core.deriveTrainingRoomState(room, "a", 1_200);
  assert.equal(view.phase, "score");
  assert.equal(view.actions.canScore, true);
  room.rounds[1].scores = { a: 9, b: 8 };
  view = core.deriveTrainingRoomState(room, "a", 1_300);
  assert.equal(view.phase, "choose_command");
  assert.equal(view.actions.canChooseCommand, true);
  assert.deepEqual(view.hpByUid, { a: 15, b: 20 });
  assert.deepEqual(view.scoreTotalByUid, { a: 8, b: 9 });

  room.rounds[1].commandChoices = {
    b: { trainerUid: "a", cardIndex: 1, selectedAt: 1_400 },
  };
  assert.equal(core.deriveTrainingRoomState(room, "a", 1_400).phase, "waiting_command");
  room.rounds[1].commandChoices.a = {
    trainerUid: "b",
    cardIndex: 1,
    selectedAt: 1_400,
  };
  view = core.deriveTrainingRoomState(room, "a", 1_400);
  assert.equal(view.phase, "workout_ready");
  assert.equal(view.actions.canStartWorkout, true);

  room.rounds[1].workouts = {
    a: { startedAt: 2_000 },
    b: { startedAt: 2_000 },
  };
  assert.equal(core.deriveTrainingRoomState(room, "a", 76_999).phase, "workout_active");
  view = core.deriveTrainingRoomState(room, "a", 77_000);
  assert.equal(view.phase, "workout_complete");
  assert.equal(view.actions.canCompleteWorkout, true);
  room.rounds[1].workouts.a.completedAt = 77_000;
  assert.equal(core.deriveTrainingRoomState(room, "a", 77_000).phase, "coach");
  room.rounds[1].workouts.b.completedAt = 62_000;
  view = core.deriveTrainingRoomState(room, "a", 77_000);
  assert.equal(view.phase, "settle_round");
  assert.equal(view.actions.canSettleRound, true);

  room.rounds[1].completedAt = 77_000;
  view = core.deriveTrainingRoomState(room, "a", 77_001);
  assert.equal(view.phase, "waiting_round");
  assert.equal(view.roundIndex, 2);
  assert.equal(view.actions.canCreateRound, true);
});

test("V3 natural HP result takes precedence over later surrender or health stop", () => {
  const room = hpRoom({
    rounds: {
      1: {
        createdAt: 1_000,
        scores: { a: 10, b: 10 },
        workouts: {
          a: { startedAt: 2_000, completedAt: 92_000 },
          b: { startedAt: 2_000, completedAt: 92_000 },
        },
        completedAt: 92_000,
      },
      2: {
        createdAt: 93_000,
        scores: { a: 8, b: 8 },
        workouts: {
          a: { startedAt: 94_000, completedAt: 154_000 },
          b: { startedAt: 94_000, completedAt: 154_000 },
        },
        completedAt: 154_000,
      },
    },
    surrendered: { uid: "a", at: 154_001 },
  });
  let view = core.deriveTrainingRoomState(room, "a", 154_002);
  assert.equal(view.phase, "result");
  assert.equal(view.result.reason, "hp_zero");
  assert.equal(view.result.type, "draw");
  delete room.surrendered;
  room.destroyed = { by: "a", at: 154_001, reason: "health_stop" };
  view = core.deriveTrainingRoomState(room, "a", 154_002);
  assert.equal(view.result.reason, "hp_zero");
});

test("keeps metronome beat and repetition boundaries deterministic", () => {
  assert.deepEqual(core.trainingBeatState({
    startedAt: 1_000,
    now: 1_000,
    bpm: 120,
    beatsPerRep: 2,
  }), {
    enabled: true,
    beat: 1,
    rep: 1,
    phase: 0,
  });
  assert.deepEqual(core.trainingBeatState({
    startedAt: 1_000,
    now: 1_500,
    bpm: 120,
    beatsPerRep: 2,
  }), {
    enabled: true,
    beat: 2,
    rep: 1,
    phase: 0,
  });
  assert.deepEqual(core.trainingBeatState({
    startedAt: 1_000,
    now: 2_000,
    bpm: 120,
    beatsPerRep: 2,
  }), {
    enabled: true,
    beat: 1,
    rep: 2,
    phase: 0,
  });
  assert.deepEqual(core.trainingBeatState({
    startedAt: 1_000,
    now: 2_000,
    bpm: 0,
    beatsPerRep: 2,
  }), {
    enabled: false,
    beat: 0,
    rep: 0,
    phase: 0,
  });
  assert.deepEqual(core.trainingBeatState({
    startedAt: 1_000,
    now: 4_500,
    bpm: 120,
    beatsPerRep: 8,
  }), {
    enabled: true,
    beat: 8,
    rep: 1,
    phase: 0,
  });
});
