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

test("advertises protocol 2 and maps every carrot choice to its time and image owner", () => {
  assert.equal(core.TRAINING_PROTOCOL_VERSION, 2);
  assert.equal(core.TRAINING_VARIANT, "kitaeai_60_v2");
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
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 200, lastSeen: 990, state: "waiting",
    },
    old: {
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    stale: {
      uid: "stale", sessionId: "session-stale", name: "STALE", intensity: "standard",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 1, lastSeen: 800, state: "waiting",
    },
    missingSession: {
      uid: "missingSession", name: "MISSING", intensity: "standard",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 50, lastSeen: 999, state: "waiting",
    },
    legacy: {
      uid: "legacy", sessionId: "session-legacy", name: "LEGACY", intensity: "standard",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 25, lastSeen: 999, state: "waiting",
    },
    wrongVariant: {
      uid: "wrongVariant", sessionId: "session-wrong", name: "WRONG", intensity: "standard",
      protocolVersion: 2, variant: "kitaeai_60", joinedAt: 30, lastSeen: 999, state: "waiting",
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
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    late: {
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 2, variant: "kitaeai_60_v2", joinedAt: 200, lastSeen: 990, state: "waiting",
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
});
