const assert = require("node:assert/strict");
const test = require("node:test");

let core;

test.before(async () => {
  core = await import("../../training-core.mjs");
});

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

test("selects the oldest two fresh waiting players", () => {
  const entries = core.validTrainingQueueEntries({
    late: {
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 200, lastSeen: 990, state: "waiting",
    },
    old: {
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    stale: {
      uid: "stale", sessionId: "session-stale", name: "STALE", intensity: "standard",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 1, lastSeen: 800, state: "waiting",
    },
    missingSession: {
      uid: "missingSession", name: "MISSING", intensity: "standard",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 50, lastSeen: 999, state: "waiting",
    },
  }, { now: 1000, freshnessMs: 100 });

  assert.deepEqual(core.selectTrainingPair(entries).map(({ uid }) => uid), ["old", "late"]);
  assert.deepEqual(entries.map(({ sessionId }) => sessionId), ["session-old", "session-late"]);
  assert.ok(entries.every((entry) => !Object.hasOwn(entry, "conditions")));
  const activeFiltered = core.validTrainingQueueEntries({
    old: {
      uid: "old", sessionId: "session-old", name: "OLD", intensity: "light",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 100, lastSeen: 995, state: "waiting",
    },
    late: {
      uid: "late", sessionId: "session-late", name: "LATE", intensity: "strong",
      protocolVersion: 1, variant: "kitaeai_60", joinedAt: 200, lastSeen: 990, state: "waiting",
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
    version: 1,
    reason: "timeout",
    turnCount: 3,
    outcomes: { self: "win", other: "loss" },
    completedSetsByUid: { self: 1, other: 1 },
  }, "self");
  assert.deepEqual(result, {
    turnIndex: 3,
    completedSets: 2,
    ownCompletedSets: 1,
    result: {
      type: "win",
      winnerUid: "self",
      loserUid: "other",
      reason: "timeout",
    },
  });
});

test("derives alternating turns, continue votes, and mutual completion", () => {
  const room = {
    status: "active",
    firstTrainerUid: "a",
    members: { a: true, b: true },
    imageReceived: { a: true, b: true },
    turns: {},
  };
  assert.equal(core.deriveTrainingRoomState(room, "a", 1000).phase, "compose");
  assert.equal(core.deriveTrainingRoomState(room, "b", 1000).phase, "waiting_instruction");

  room.turns[1] = {
    trainerUid: "a",
    traineeUid: "b",
    instruction: {
      exercise: "スクワット", completion: "60秒続ける", command: "拍に合わせてスクワット",
      bpm: 100, beatsPerRep: 2,
    },
    startedAt: 200,
    completedAt: 1000,
  };
  assert.equal(core.deriveTrainingRoomState(room, "b", 1100).phase, "compose");

  room.turns[2] = {
    trainerUid: "b",
    traineeUid: "a",
    instruction: {
      exercise: "腹筋", completion: "60秒続ける", command: "自分のリズムで腹筋",
      bpm: 0, beatsPerRep: 1,
    },
    startedAt: 1300,
    completedAt: 2000,
  };
  assert.equal(core.deriveTrainingRoomState(room, "a", 2100).phase, "continue_vote");
  room.continueVotes = { 1: { a: "continue", b: "finish" } };
  assert.equal(core.deriveTrainingRoomState(room, "a", 2200).result.type, "mutual_complete");
});

test("derives a trainee loss on give up and an expired live timer", () => {
  const room = {
    status: "active",
    firstTrainerUid: "a",
    members: { a: true, b: true },
    imageReceived: { a: true, b: true },
    turns: {
      1: {
        trainerUid: "a",
        traineeUid: "b",
        instruction: {
          exercise: "腕立て伏せ", completion: "できる範囲", command: "60秒チャレンジ",
          bpm: 80, beatsPerRep: 2,
        },
        startedAt: 200,
      },
    },
  };
  assert.equal(core.deriveTrainingRoomState(room, "b", 60_201).phase, "expired");
  room.turns[1].surrenderedAt = 30_000;
  const result = core.deriveTrainingRoomState(room, "b", 30_001);
  assert.equal(result.phase, "result");
  assert.equal(result.result.type, "loss");
  assert.equal(result.result.reason, "surrender");
});
