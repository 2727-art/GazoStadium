"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_VARIANT,
  TRAINING_V6_WORKOUT_SECONDS,
  applyTrainingV6RoomAction,
  applyTrainingV6TransportClaim,
  createTrainingV6Room,
  normalizeTrainingV6Action,
  normalizeTrainingV6Profile,
  trainingV6RoomView,
} = require("../training-session-v6");

const START = 1_900_000_000_000;
const HOST_UID = "training-v6-host";
const GUEST_UID = "training-v6-guest";
const ROOM_ID = "room1234567890123456";
const CONNECTION_ID = "connection-shared-v6-0001";

function profile(displayName, {
  maxBpm = 140,
  allowedExercises = ["push_up", "squat", "sit_up"],
  conditionText = "",
} = {}) {
  return {
    displayName,
    maxBpm,
    allowedExercises,
    conditionText,
  };
}

function room() {
  const created = createTrainingV6Room({
    roomId: ROOM_ID,
    firstUid: HOST_UID,
    secondUid: GUEST_UID,
    players: {
      [HOST_UID]: profile("HOST", {
        maxBpm: 120,
        allowedExercises: ["squat", "custom"],
        conditionText: "膝に配慮",
      }),
      [GUEST_UID]: profile("GUEST", {
        maxBpm: 150,
        allowedExercises: ["push_up", "sit_up"],
      }),
    },
    now: START,
  });
  created.connections = {
    [HOST_UID]: {
      connectionId: CONNECTION_ID,
      generation: 1,
      claimedAt: START,
    },
    [GUEST_UID]: {
      connectionId: CONNECTION_ID,
      generation: 1,
      claimedAt: START,
    },
  };
  return created;
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function apply(current, uid, action, offset = 1, options = {}) {
  return applyTrainingV6RoomAction({
    room: current,
    uid,
    action,
    actionDigest: digest(action),
    priorReceipt: options.priorReceipt || null,
    privateScores: options.privateScores || {},
    now: START + offset,
  });
}

function committed(current, uid, action, offset = 1) {
  const decision = apply(current, uid, action, offset);
  assert.equal(decision.ok, true, decision.reason);
  assert.equal(decision.changed, true);
  return decision.room;
}

function action(current, name, actionId, extra = {}) {
  return {
    action: name,
    actionId,
    roomId: ROOM_ID,
    expectedRevision: current.revision,
    connectionId: CONNECTION_ID,
    ...extra,
  };
}

function envelope(name, actionId, {
  roomId = null,
  expectedRevision = 0,
  payload,
} = {}) {
  return {
    protocolVersion: 6,
    variant: "companion_v6",
    clientVersion: "training-v6-test",
    action: name,
    actionId,
    expectedRevision,
    roomId,
    payload: payload ?? (name === "handshake"
      ? {
        supportedProtocolVersions: [6],
        requestedVariant: "companion_v6",
      }
      : {}),
  };
}

function exchangeImages(current, offset = 10) {
  let next = committed(
    current,
    HOST_UID,
    action(current, "image_ready", `host-image-${offset}`, {
      roundNumber: current.roundNumber,
      imageNumber: current.roundNumber,
    }),
    offset,
  );
  next = committed(
    next,
    GUEST_UID,
    action(next, "image_ready", `guest-image-${offset}`, {
      roundNumber: next.roundNumber,
      imageNumber: next.roundNumber,
    }),
    offset + 1,
  );
  assert.equal(next.phase, "scoring");
  return next;
}

function scoreRound(current, hostScore, guestScore, offset = 20) {
  const hostAction = action(current, "score", `host-score-${offset}`, {
    roundNumber: current.roundNumber,
    score: hostScore,
  });
  const hostDecision = apply(
    current,
    HOST_UID,
    hostAction,
    offset,
  );
  assert.equal(hostDecision.ok, true, hostDecision.reason);
  const privateScores = {
    [HOST_UID]: hostDecision.privateScore,
  };
  const next = hostDecision.room;
  const guestAction = action(next, "score", `guest-score-${offset}`, {
    roundNumber: next.roundNumber,
    score: guestScore,
  });
  const guestDecision = apply(
    next,
    GUEST_UID,
    guestAction,
    offset + 1,
    { privateScores },
  );
  assert.equal(guestDecision.ok, true, guestDecision.reason);
  return guestDecision.room;
}

function completeWorkout(current, {
  trainerUid,
  victimUid,
  workoutIndex,
  exerciseId,
  bpm,
  offset,
}) {
  let next = committed(
    current,
    trainerUid,
    action(current, "instruction", `instruction-${workoutIndex}-${offset}`, {
      workoutIndex,
      exerciseId,
      exercise: exerciseId === "squat" ? "スクワット" : "腕立て伏せ",
      completion: "60秒",
      command: "無理のない範囲でリズムに合わせる",
      bpm,
      beatsPerRep: 4,
    }),
    offset,
  );
  assert.equal(next.phase, "ready");
  next = committed(
    next,
    victimUid,
    action(next, "ready", `ready-${workoutIndex}-${offset}`, {
      workoutIndex,
    }),
    offset + 1,
  );
  assert.equal(next.phase, "workout");
  next = committed(
    next,
    victimUid,
    action(next, "workout_started", `started-${workoutIndex}-${offset}`, {
      workoutIndex,
    }),
    offset + 2,
  );
  assert.equal(next.phase, "workout");
  const earlyCompletion = apply(
    next,
    victimUid,
    action(next, "workout_completed", `early-complete-${workoutIndex}-${offset}`, {
      workoutIndex,
    }),
    offset + 3,
  );
  assert.equal(earlyCompletion.ok, false);
  assert.equal(earlyCompletion.reason, "workout-not-finished");
  next = committed(
    next,
    victimUid,
    action(next, "workout_completed", `completed-${workoutIndex}-${offset}`, {
      workoutIndex,
    }),
    offset + 60_003,
  );
  return next;
}

test("profile and action validation fix the V6 safety contract", () => {
  assert.deepEqual(
    normalizeTrainingV6Profile(profile("  PLAYER  ", {
      maxBpm: 120,
      allowedExercises: ["squat", "custom"],
      conditionText: "  膝に 配慮  ",
    })),
    {
      displayName: "PLAYER",
      maxBpm: 120,
      allowedExercises: ["squat", "custom"],
      conditionText: "膝に 配慮",
    },
  );
  assert.equal(normalizeTrainingV6Profile(profile("P", { maxBpm: 161 })), null);
  assert.equal(normalizeTrainingV6Profile(profile("P", {
    allowedExercises: ["burpee"],
  })), null);
  assert.equal(normalizeTrainingV6Action(envelope(
    "disconnect",
    "disconnect-0001",
  )), null);
  assert.deepEqual(normalizeTrainingV6Action(envelope(
    "handshake",
    "handshake-0001",
  )), {
    protocolVersion: 6,
    variant: "companion_v6",
    clientVersion: "training-v6-test",
    action: "handshake",
    actionId: "handshake-0001",
  });
  assert.equal(normalizeTrainingV6Action({
    ...envelope("handshake", "handshake-0002"),
    protocolVersion: 5,
  }), null);
  assert.equal(normalizeTrainingV6Action({
    action: "join",
    actionId: "legacy-flat-0001",
    profile: profile("OLD"),
  }), null);
});

test("room starts with fixed members and one authoritative phase/revision", () => {
  const created = room();
  assert.equal(created.protocolVersion, TRAINING_V6_PROTOCOL_VERSION);
  assert.equal(created.variant, TRAINING_V6_VARIANT);
  assert.equal(created.phase, "media_exchange");
  assert.equal(created.revision, 1);
  assert.equal(created.transportRevision, 0);
  assert.equal(created.expiresAt, START + (24 * 60 * 60_000));
  assert.deepEqual(created.memberOrder, {
    0: HOST_UID,
    1: GUEST_UID,
  });
  assert.deepEqual(created.participantUids, [HOST_UID, GUEST_UID]);
  assert.deepEqual(created.members, {
    [HOST_UID]: true,
    [GUEST_UID]: true,
  });
});

test("the first HIT stops DRAW and completes one 60-second accompaniment", () => {
  let current = exchangeImages(room());
  current = scoreRound(current, 8, 7);
  assert.equal(current.phase, "instruction");
  assert.equal(current.roundNumber, 1);
  assert.equal(current.workoutQueue.length, 1);
  assert.deepEqual(
    {
      workoutId: current.workoutQueue[0].workoutId,
      sequence: current.workoutQueue[0].sequence,
      trainerUid: current.workoutQueue[0].trainerUid,
      victimUid: current.workoutQueue[0].victimUid,
      durationSeconds: current.workoutQueue[0].durationSeconds,
      durationMs: current.workoutQueue[0].durationMs,
    },
    {
      workoutId: "workout-1-1",
      sequence: 0,
      trainerUid: GUEST_UID,
      victimUid: HOST_UID,
      durationSeconds: TRAINING_V6_WORKOUT_SECONDS,
      durationMs: TRAINING_V6_WORKOUT_SECONDS * 1000,
    },
  );

  current = completeWorkout(current, {
    trainerUid: GUEST_UID,
    victimUid: HOST_UID,
    workoutIndex: 0,
    exerciseId: "squat",
    bpm: 120,
    offset: 30,
  });
  assert.equal(current.phase, "complete");
  assert.equal(current.result.type, "completed");
  assert.equal(current.result.workoutCount, 1);
  assert.equal(current.workoutQueue[0].workout.durationSeconds, 60);
});

test("DOUBLE HIT runs two workouts sequentially in memberOrder", () => {
  let current = scoreRound(exchangeImages(room()), 8, 10);
  assert.equal(current.phase, "instruction");
  assert.deepEqual(
    current.workoutQueue.map(({ victimUid }) => victimUid),
    [HOST_UID, GUEST_UID],
  );

  current = completeWorkout(current, {
    trainerUid: GUEST_UID,
    victimUid: HOST_UID,
    workoutIndex: 0,
    exerciseId: "squat",
    bpm: 110,
    offset: 40,
  });
  assert.equal(current.phase, "instruction");
  assert.equal(current.activeWorkoutIndex, 1);
  assert.equal(current.instruction, undefined);
  assert.equal(current.workout, undefined);

  current = completeWorkout(current, {
    trainerUid: HOST_UID,
    victimUid: GUEST_UID,
    workoutIndex: 1,
    exerciseId: "push_up",
    bpm: 140,
    offset: 50,
  });
  assert.equal(current.phase, "complete");
  assert.equal(current.result.workoutCount, 2);
  assert.equal(current.workoutQueue[0].completedAt < current.workoutQueue[1].completedAt, true);
});

test("five MISS rounds end complete without a workout", () => {
  let current = room();
  for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
    current = exchangeImages(current, roundNumber * 100);
    current = scoreRound(current, 7, 6, roundNumber * 100 + 10);
    if (roundNumber < 5) {
      assert.equal(current.phase, "media_exchange");
      assert.equal(current.roundNumber, roundNumber + 1);
    }
  }
  assert.equal(current.phase, "complete");
  assert.deepEqual(current.workoutQueue, []);
  assert.equal(current.result.type, "all_miss");
  assert.equal(current.result.drawCount, 5);
});

test("NO CONTEST is available from an active phase and preserves fixed members", () => {
  const initial = room();
  const finished = committed(
    initial,
    HOST_UID,
    action(initial, "no_contest", "no-contest-health-0001", {
      reason: "health",
      note: "体調に変化",
    }),
  );
  assert.equal(finished.phase, "no_contest");
  assert.equal(finished.result.type, "no_contest");
  assert.equal(finished.result.reason, "health");
  assert.deepEqual(finished.memberOrder, initial.memberOrder);
  assert.deepEqual(finished.members, initial.members);
});

test("finish acknowledges a terminal room without changing its terminal phase", () => {
  const initial = room();
  const terminal = committed(
    initial,
    HOST_UID,
    action(initial, "no_contest", "terminal-first-0001", {
      reason: "health",
      note: "",
    }),
  );
  const acknowledged = committed(
    terminal,
    HOST_UID,
    action(terminal, "finish", "terminal-ack-0001"),
  );
  assert.equal(acknowledged.phase, "no_contest");
  assert.equal(acknowledged.result.reason, "health");
  assert.equal(Number.isSafeInteger(acknowledged.finishedBy[HOST_UID]), true);
});

test("actionId replay is idempotent before revision CAS and cannot change payload", () => {
  const initial = room();
  const firstAction = action(initial, "image_ready", "replay-image-0001", {
    roundNumber: 1,
    imageNumber: 1,
  });
  const first = apply(initial, HOST_UID, firstAction);
  assert.equal(first.ok, true);
  assert.equal(first.room.revision, 2);

  const replay = applyTrainingV6RoomAction({
    room: first.room,
    uid: HOST_UID,
    action: firstAction,
    actionDigest: digest(firstAction),
    priorReceipt: first.receipt,
    now: START + 99,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.room.revision, 2);

  const reused = {
    ...firstAction,
    imageNumber: 2,
  };
  const rejectedReuse = applyTrainingV6RoomAction({
    room: first.room,
    uid: HOST_UID,
    action: reused,
    actionDigest: digest(reused),
    priorReceipt: first.receipt,
    now: START + 100,
  });
  assert.equal(rejectedReuse.ok, false);
  assert.equal(rejectedReuse.reason, "action-id-reused");

  const stale = apply(first.room, GUEST_UID, {
    ...action(first.room, "image_ready", "stale-image-0001", {
      roundNumber: 1,
      imageNumber: 1,
    }),
    expectedRevision: 1,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, "revision-conflict");
  assert.equal(stale.currentRevision, 2);
});

test("instruction is fenced by victim exercise consent and max BPM", () => {
  const current = scoreRound(exchangeImages(room()), 8, 7);
  const unsafeExercise = apply(
    current,
    GUEST_UID,
    action(current, "instruction", "unsafe-exercise-0001", {
      workoutIndex: 0,
      exerciseId: "push_up",
      exercise: "腕立て伏せ",
      completion: "60秒",
      command: "続ける",
      bpm: 100,
      beatsPerRep: 4,
    }),
  );
  assert.equal(unsafeExercise.ok, false);
  assert.equal(unsafeExercise.reason, "unsafe-instruction");

  const unsafeBpm = apply(
    current,
    GUEST_UID,
    action(current, "instruction", "unsafe-bpm-0001", {
      workoutIndex: 0,
      exerciseId: "squat",
      exercise: "スクワット",
      completion: "60秒",
      command: "続ける",
      bpm: 121,
      beatsPerRep: 4,
    }),
  );
  assert.equal(unsafeBpm.ok, false);
  assert.equal(unsafeBpm.reason, "unsafe-instruction");
});

test("claim_transport rotates only transportRevision and never ends the room", () => {
  const initial = room();
  const claim = {
    action: "claim_transport",
    actionId: "transport-claim-0001",
    roomId: ROOM_ID,
    connectionId: "connection-uuid-0001",
  };
  const first = applyTrainingV6TransportClaim({
    room: initial,
    uid: HOST_UID,
    action: claim,
    actionDigest: digest(claim),
    now: START + 1,
  });
  assert.equal(first.ok, true);
  assert.equal(first.room.phase, "media_exchange");
  assert.equal(first.room.revision, 1);
  assert.equal(first.room.transportRevision, 1);
  assert.deepEqual(first.room.connections[HOST_UID], {
    connectionId: "connection-uuid-0001",
    generation: 2,
    claimedAt: START + 1,
  });

  const replay = applyTrainingV6TransportClaim({
    room: first.room,
    uid: HOST_UID,
    action: claim,
    actionDigest: digest(claim),
    priorReceipt: first.receipt,
    now: START + 2,
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.room.transportRevision, 1);
  assert.equal(replay.room.revision, 1);
});

test("a replaced transport owner cannot mutate the canonical room", () => {
  const initial = room();
  const rotated = applyTrainingV6TransportClaim({
    room: initial,
    uid: HOST_UID,
    action: {
      action: "claim_transport",
      actionId: "transport-owner-rotate-0001",
      roomId: ROOM_ID,
      connectionId: "connection-current-v6-0001",
    },
    actionDigest: digest("transport-owner-rotate-0001"),
    now: START + 1,
  });
  assert.equal(rotated.ok, true);

  const staleOwner = apply(
    rotated.room,
    HOST_UID,
    action(rotated.room, "image_ready", "stale-owner-image-0001", {
      roundNumber: 1,
      imageNumber: 1,
    }),
    2,
  );
  assert.equal(staleOwner.ok, false);
  assert.equal(staleOwner.reason, "owner-replaced");

  const currentOwner = apply(
    rotated.room,
    HOST_UID,
    action(rotated.room, "image_ready", "current-owner-image-0001", {
      connectionId: "connection-current-v6-0001",
      roundNumber: 1,
      imageNumber: 1,
    }),
    3,
  );
  assert.equal(currentOwner.ok, true);
});

test("room view hides the opponent secret score until both scores exist", () => {
  const current = exchangeImages(room());
  const scoreAction = action(current, "score", "secret-score-0001", {
    roundNumber: 1,
    score: 8,
  });
  const decision = apply(
    current,
    HOST_UID,
    scoreAction,
  );
  assert.equal(decision.privateScore.value, 8);
  const hostView = trainingV6RoomView(decision.room, HOST_UID);
  const guestView = trainingV6RoomView(decision.room, GUEST_UID);
  assert.deepEqual(hostView.rounds[1].scores, {});
  assert.deepEqual(guestView.rounds[1].scores, {});
  assert.equal(JSON.stringify(hostView).includes("secret-score-0001"), false);
});
