"use strict";

const TRAINING_V6_PROTOCOL_VERSION = 6;
const TRAINING_V6_VARIANT = "companion_v6";
const TRAINING_V6_MAX_DRAWS = 5;
const TRAINING_V6_HIT_SCORE = 8;
const TRAINING_V6_WORKOUT_SECONDS = 60;
const TRAINING_V6_QUEUE_TTL_MS = 3 * 60_000;
const TRAINING_V6_ROOM_RETENTION_MS = 24 * 60 * 60_000;

const TRAINING_V6_PHASES = Object.freeze([
  "media_exchange",
  "scoring",
  "instruction",
  "ready",
  "workout",
  "complete",
  "no_contest",
]);

const TRAINING_V6_EXERCISE_IDS = Object.freeze([
  "push_up",
  "squat",
  "sit_up",
  "custom",
]);

const TRAINING_V6_NO_CONTEST_REASONS = Object.freeze([
  "health",
  "pain",
  "dizziness",
  "connection",
  "member_left",
  "session_expired",
  "other",
]);

const TOKEN_PATTERN = /^[-_0-9A-Za-z]{8,128}$/;
const CONNECTION_ID_PATTERN = /^[-_0-9A-Za-z]{16,128}$/;
const ROOM_ID_PATTERN = /^[-_0-9A-Za-z]{8,128}$/;
const CLIENT_VERSION_PATTERN = /^[-_.0-9A-Za-z]{1,64}$/;
const TERMINAL_PHASES = new Set(["complete", "no_contest"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function objectValue(value) {
  if (isRecord(value)) return clone(value);
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .map((child, index) => [String(index), child])
        .filter(([, child]) => child != null),
    );
  }
  return {};
}

function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function normalizeText(value, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function isSafeUid(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !/[\u0000-\u001f\u007f.#$\[\]\/]/.test(value);
}

function isSafeToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

function isSafeConnectionId(value) {
  return typeof value === "string" && CONNECTION_ID_PATTERN.test(value);
}

function isRoomId(value) {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

function finiteTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function normalizeTrainingV6Profile(value) {
  if (!exactKeys(value, [
    "displayName",
    "maxBpm",
    "allowedExercises",
    "conditionText",
  ])) return null;
  const displayName = normalizeText(value.displayName, 24);
  const conditionText = normalizeText(
    value.conditionText,
    80,
    { allowEmpty: true },
  );
  if (displayName == null
      || conditionText == null
      || !Number.isInteger(value.maxBpm)
      || value.maxBpm < 40
      || value.maxBpm > 160
      || !Array.isArray(value.allowedExercises)
      || value.allowedExercises.length < 1
      || value.allowedExercises.length > TRAINING_V6_EXERCISE_IDS.length) {
    return null;
  }
  const allowedExercises = [...new Set(value.allowedExercises)];
  if (allowedExercises.length !== value.allowedExercises.length
      || allowedExercises.some(
        (exerciseId) => !TRAINING_V6_EXERCISE_IDS.includes(exerciseId),
      )) return null;
  return {
    displayName,
    maxBpm: value.maxBpm,
    allowedExercises,
    conditionText,
  };
}

function normalizeTrainingV6Action(value) {
  if (!exactKeys(value, [
    "protocolVersion",
    "variant",
    "clientVersion",
    "action",
    "actionId",
    "expectedRevision",
    "roomId",
    "payload",
  ])
      || value.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
      || value.variant !== TRAINING_V6_VARIANT
      || typeof value.clientVersion !== "string"
      || !CLIENT_VERSION_PATTERN.test(value.clientVersion)
      || typeof value.action !== "string"
      || !isSafeToken(value.actionId)
      || !isRecord(value.payload)) return null;
  const action = value.action;
  const base = {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    clientVersion: value.clientVersion,
    action,
    actionId: value.actionId,
  };
  const withoutRoom = () => (
    value.roomId === null && value.expectedRevision === 0
  );
  const withRoom = () => (
    isRoomId(value.roomId) && positiveRevision(value.expectedRevision)
  );
  if (action === "handshake") {
    return withoutRoom()
      && exactKeys(value.payload, [
        "supportedProtocolVersions",
        "requestedVariant",
      ])
      && Array.isArray(value.payload.supportedProtocolVersions)
      && value.payload.supportedProtocolVersions.length === 1
      && value.payload.supportedProtocolVersions[0]
        === TRAINING_V6_PROTOCOL_VERSION
      && value.payload.requestedVariant === TRAINING_V6_VARIANT
      ? base
      : null;
  }
  if (action === "join") {
    const profile = exactKeys(value.payload, ["profile"])
      ? normalizeTrainingV6Profile(value.payload.profile)
      : null;
    return withoutRoom() && profile ? { ...base, profile } : null;
  }
  if (action === "inspect") {
    if (!Number.isSafeInteger(value.expectedRevision)
        || value.expectedRevision < 0
        || (value.roomId !== null && !isRoomId(value.roomId))
        || !exactKeys(value.payload, [])) return null;
    return {
      ...base,
      ...(value.roomId === null ? {} : { roomId: value.roomId }),
    };
  }
  if (action === "leave") {
    if (withoutRoom() && exactKeys(value.payload, [])) return base;
    if (!withRoom()
        || !exactKeys(value.payload, ["connectionId"])
        || !isSafeConnectionId(value.payload.connectionId)) return null;
    return {
      ...base,
      roomId: value.roomId,
      expectedRevision: value.expectedRevision,
      connectionId: value.payload.connectionId,
    };
  }
  if (action === "claim_transport") {
    if (value.expectedRevision !== 0
        || !isRoomId(value.roomId)
        || !exactKeys(value.payload, ["connectionId"])
        || !isSafeConnectionId(value.payload.connectionId)) {
      return null;
    }
    return {
      ...base,
      roomId: value.roomId,
      connectionId: value.payload.connectionId,
    };
  }

  const roomBase = () => {
    if (!withRoom()) return null;
    return {
      ...base,
      roomId: value.roomId,
      expectedRevision: value.expectedRevision,
    };
  };

  if (action === "image_ready") {
    const room = roomBase();
    const payload = value.payload;
    if (!room
        || !exactKeys(payload, ["roundNumber", "imageNumber", "connectionId"])
        || !isSafeConnectionId(payload.connectionId)
        || !Number.isInteger(payload.roundNumber)
        || payload.roundNumber < 1
        || payload.roundNumber > TRAINING_V6_MAX_DRAWS
        || !Number.isInteger(payload.imageNumber)
        || payload.imageNumber < 1
        || payload.imageNumber > TRAINING_V6_MAX_DRAWS) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      roundNumber: payload.roundNumber,
      imageNumber: payload.imageNumber,
    };
  }
  if (action === "score") {
    const room = roomBase();
    const payload = value.payload;
    if (!room
        || !exactKeys(payload, ["roundNumber", "score", "connectionId"])
        || !isSafeConnectionId(payload.connectionId)
        || !Number.isInteger(payload.roundNumber)
        || payload.roundNumber < 1
        || payload.roundNumber > TRAINING_V6_MAX_DRAWS
        || !Number.isInteger(payload.score)
        || payload.score < 1
        || payload.score > 10) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      roundNumber: payload.roundNumber,
      score: payload.score,
    };
  }
  if (action === "instruction") {
    const room = roomBase();
    const payload = value.payload;
    if (!room || !exactKeys(payload, [
      "workoutIndex",
      "exerciseId",
      "exercise",
      "completion",
      "command",
      "bpm",
      "beatsPerRep",
      "connectionId",
    ])) return null;
    const exercise = normalizeText(payload.exercise, 40);
    const completion = normalizeText(payload.completion, 60);
    const command = normalizeText(payload.command, 120);
    if (!Number.isInteger(payload.workoutIndex)
        || payload.workoutIndex < 0
        || payload.workoutIndex > 1
        || !TRAINING_V6_EXERCISE_IDS.includes(payload.exerciseId)
        || exercise == null
        || completion == null
        || command == null
        || !isSafeConnectionId(payload.connectionId)
        || !Number.isInteger(payload.bpm)
        || payload.bpm < 40
        || payload.bpm > 160
        || ![2, 4, 8].includes(payload.beatsPerRep)) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      workoutIndex: payload.workoutIndex,
      exerciseId: payload.exerciseId,
      exercise,
      completion,
      command,
      bpm: payload.bpm,
      beatsPerRep: payload.beatsPerRep,
    };
  }
  if (action === "ready") {
    const room = roomBase();
    const payload = value.payload;
    if (!room
        || !exactKeys(payload, ["workoutIndex", "connectionId"])
        || !isSafeConnectionId(payload.connectionId)) return null;
    if (!Number.isInteger(payload.workoutIndex)
        || payload.workoutIndex < 0
        || payload.workoutIndex > 1) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      workoutIndex: payload.workoutIndex,
    };
  }
  if (action === "workout_started" || action === "workout_completed") {
    const room = roomBase();
    const payload = value.payload;
    if (!room
        || !exactKeys(payload, ["workoutIndex", "connectionId"])
        || !isSafeConnectionId(payload.connectionId)
        || !Number.isInteger(payload.workoutIndex)
        || payload.workoutIndex < 0
        || payload.workoutIndex > 1) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      workoutIndex: payload.workoutIndex,
    };
  }
  if (action === "no_contest") {
    const room = roomBase();
    const payload = value.payload;
    if (!room
        || !exactKeys(payload, ["reason", "connectionId"], ["note"])
        || !isSafeConnectionId(payload.connectionId)) return null;
    const note = normalizeText(
      payload.note || "",
      120,
      { allowEmpty: true },
    );
    if (!TRAINING_V6_NO_CONTEST_REASONS.includes(payload.reason)
        || payload.reason === "member_left"
        || payload.reason === "session_expired"
        || note == null) return null;
    return {
      ...room,
      connectionId: payload.connectionId,
      reason: payload.reason,
      note,
    };
  }
  if (action === "finish") {
    const room = roomBase();
    return room && exactKeys(value.payload, []) ? room : null;
  }
  return null;
}

function participantUids(room) {
  const ordered = room?.memberOrder;
  if (!isRecord(ordered) && !Array.isArray(ordered)) return [];
  if (Object.keys(ordered).length !== 2
      || !Object.hasOwn(ordered, "0")
      || !Object.hasOwn(ordered, "1")) return [];
  const result = [ordered["0"], ordered["1"]];
  if (result.some((uid) => !isSafeUid(uid))
      || result[0] === result[1]
      || room?.members?.[result[0]] !== true
      || room?.members?.[result[1]] !== true) return [];
  return result;
}

function createTrainingV6Room({
  roomId,
  firstUid,
  secondUid,
  players,
  now,
}) {
  if (!isRoomId(roomId)
      || !isSafeUid(firstUid)
      || !isSafeUid(secondUid)
      || firstUid === secondUid
      || !finiteTimestamp(now)) return null;
  const firstProfile = normalizeTrainingV6Profile(players?.[firstUid]);
  const secondProfile = normalizeTrainingV6Profile(players?.[secondUid]);
  if (!firstProfile || !secondProfile) return null;
  return {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    roomId,
    phase: "media_exchange",
    revision: 1,
    transportRevision: 0,
    createdAt: now,
    updatedAt: now,
    // Cleanup horizon only. It is never used as a participation lease and
    // therefore cannot turn a P2P disconnect into a room termination.
    expiresAt: now + TRAINING_V6_ROOM_RETENTION_MS,
    members: {
      [firstUid]: true,
      [secondUid]: true,
    },
    memberOrder: {
      0: firstUid,
      1: secondUid,
    },
    participantUids: [firstUid, secondUid],
    players: {
      [firstUid]: {
        uid: firstUid,
        joinedAt: now,
        profile: firstProfile,
      },
      [secondUid]: {
        uid: secondUid,
        joinedAt: now,
        profile: secondProfile,
      },
    },
    roundNumber: 1,
    rounds: {
      1: {
        roundNumber: 1,
        images: {},
        scores: {},
      },
    },
    workoutQueue: [],
    // RTDB treats null as deletion, while the canonical Rules require this
    // field to exist from room creation. The client contract accepts -1 as
    // the explicit "no active workout" sentinel.
    activeWorkoutIndex: -1,
    connections: {},
    finishedBy: {},
  };
}

function roomIsTrainingV6(room) {
  const members = participantUids(room);
  return isRecord(room)
    && room.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
    && room.variant === TRAINING_V6_VARIANT
    && isRoomId(room.roomId)
    && TRAINING_V6_PHASES.includes(room.phase)
    && positiveRevision(room.revision)
    && Number.isSafeInteger(room.transportRevision)
    && room.transportRevision >= 0
    && finiteTimestamp(room.createdAt)
    && finiteTimestamp(room.updatedAt)
    && finiteTimestamp(room.expiresAt)
    && room.expiresAt > room.createdAt
    && members.length === 2
    && Array.isArray(room.participantUids)
    && room.participantUids.length === 2
    && room.participantUids.every((uid, index) => uid === members[index]);
}

function actionReceiptMatches(receipt, action, digest) {
  return receipt?.action === action && receipt?.digest === digest;
}

function transitionFailure(room, reason, details = {}) {
  return {
    ok: false,
    changed: false,
    idempotent: false,
    reason,
    room,
    ...details,
  };
}

function commitRoomAction(room, {
  uid,
  action,
  digest,
  now,
  mutate,
}) {
  const next = clone(room);
  mutate(next);
  if (!TERMINAL_PHASES.has(room.phase) && TERMINAL_PHASES.has(next.phase)) {
    next.expiresAt = now + TRAINING_V6_ROOM_RETENTION_MS;
  }
  next.revision = room.revision + 1;
  next.updatedAt = now;
  const receipt = {
    action: action.action,
    digest,
    appliedRevision: next.revision,
    at: now,
  };
  return {
    ok: true,
    changed: true,
    idempotent: false,
    reason: "applied",
    room: next,
    receipt,
    appliedRevision: next.revision,
  };
}

function currentWorkout(room) {
  if (!Array.isArray(room?.workoutQueue)
      || !Number.isInteger(room.activeWorkoutIndex)
      || room.activeWorkoutIndex < 0
      || room.activeWorkoutIndex >= room.workoutQueue.length) return null;
  return room.workoutQueue[room.activeWorkoutIndex] || null;
}

function otherParticipant(room, uid) {
  return participantUids(room).find((memberUid) => memberUid !== uid) || "";
}

function noContestMutation(next, uid, reason, note, now) {
  next.phase = "no_contest";
  next.result = {
    type: "no_contest",
    reason,
    note,
    requestedBy: uid,
    completedAt: now,
  };
}

function applyTrainingV6RoomAction({
  room: inputRoom,
  uid,
  action,
  actionDigest,
  priorReceipt = null,
  privateScores = {},
  now,
}) {
  const room = clone(inputRoom);
  if (!roomIsTrainingV6(room)) {
    return transitionFailure(room, room == null ? "room-not-found" : "invalid-room");
  }
  if (!isSafeUid(uid) || room.members?.[uid] !== true) {
    return transitionFailure(room, "not-member");
  }
  if (!action
      || !isSafeToken(action.actionId)
      || typeof actionDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(actionDigest)
      || !finiteTimestamp(now)) {
    return transitionFailure(room, "invalid-action");
  }
  const prior = isRecord(priorReceipt) ? priorReceipt : null;
  if (prior) {
    if (!actionReceiptMatches(prior, action.action, actionDigest)) {
      return transitionFailure(room, "action-id-reused");
    }
    return {
      ok: true,
      changed: false,
      idempotent: true,
      reason: "idempotent",
      room,
      appliedRevision: prior.appliedRevision,
    };
  }
  if (action.action === "finish") {
    if (!TERMINAL_PHASES.has(room.phase)) {
      return transitionFailure(room, "room-not-finished");
    }
    if (finiteTimestamp(room.finishedBy?.[uid])) {
      return {
        ok: true,
        changed: false,
        idempotent: true,
        reason: "idempotent",
        room,
        appliedRevision: room.revision,
      };
    }
    return commitRoomAction(room, {
      uid,
      action,
      digest: actionDigest,
      now,
      mutate: (next) => {
        next.finishedBy = isRecord(next.finishedBy) ? next.finishedBy : {};
        next.finishedBy[uid] = now;
      },
    });
  }
  if (!isSafeConnectionId(action.connectionId)
      || room.connections?.[uid]?.connectionId !== action.connectionId) {
    return transitionFailure(room, "owner-replaced");
  }
  if (!positiveRevision(action.expectedRevision)
      || action.expectedRevision !== room.revision) {
    return transitionFailure(room, "revision-conflict", {
      currentRevision: room.revision,
    });
  }
  const commit = (mutate) => commitRoomAction(room, {
    uid,
    action,
    digest: actionDigest,
    now,
    mutate,
  });

  if (TERMINAL_PHASES.has(room.phase)) {
    return transitionFailure(room, "room-finished");
  }
  if (action.action === "no_contest") {
    return commit((next) => {
      noContestMutation(next, uid, action.reason, action.note, now);
    });
  }
  if (action.action === "leave") {
    return commit((next) => {
      next.players[uid].leftAt = now;
      noContestMutation(next, uid, "member_left", "", now);
    });
  }
  if (action.action === "image_ready") {
    if (room.phase !== "media_exchange") {
      return transitionFailure(room, "wrong-phase");
    }
    if (action.roundNumber !== room.roundNumber) {
      return transitionFailure(room, "wrong-draw");
    }
    const round = room.rounds?.[room.roundNumber];
    if (!isRecord(round) || isRecord(round.images?.[uid])) {
      return transitionFailure(room, "already-applied");
    }
    const reusedImage = Object.values(room.rounds || {}).some(
      (candidate) => candidate?.images?.[uid]?.imageNumber === action.imageNumber,
    );
    if (reusedImage) return transitionFailure(room, "image-already-used");
    return commit((next) => {
      const target = next.rounds[next.roundNumber];
      target.images = isRecord(target.images) ? target.images : {};
      target.images[uid] = {
        imageNumber: action.imageNumber,
        readyAt: now,
      };
      const members = participantUids(next);
      if (members.every((memberUid) => isRecord(target.images[memberUid]))) {
        next.phase = "scoring";
        target.mediaReadyAt = now;
      }
    });
  }
  if (action.action === "score") {
    if (room.phase !== "scoring") {
      return transitionFailure(room, "wrong-phase");
    }
    if (action.roundNumber !== room.roundNumber) {
      return transitionFailure(room, "wrong-draw");
    }
    const round = room.rounds?.[room.roundNumber];
    if (!isRecord(round)
        || participantUids(room).some(
          (memberUid) => !isRecord(round.images?.[memberUid]),
        )
        || isRecord(privateScores?.[uid])
        || isRecord(round.scores?.[uid])) {
      return transitionFailure(room, "already-applied");
    }
    const combinedPrivateScores = {
      ...objectValue(privateScores),
      [uid]: {
        value: action.score,
        submittedAt: now,
      },
    };
    const members = participantUids(room);
    const bothSubmitted = members.every(
      (memberUid) => isRecord(combinedPrivateScores[memberUid]),
    );
    const decision = commit((next) => {
      const target = next.rounds[next.roundNumber];
      // A one-sided score remains only in the server-internal privateScores
      // namespace. The directly readable room publishes scores atomically only
      // after both players have submitted.
      if (!bothSubmitted) return;
      target.scores = Object.fromEntries(members.map((memberUid) => [
        memberUid,
        combinedPrivateScores[memberUid].value,
      ]));
      const resolvedMembers = participantUids(next);
      target.resolvedAt = now;
      const victims = resolvedMembers.filter(
        (memberUid) => target.scores[memberUid] >= TRAINING_V6_HIT_SCORE,
      );
      if (!victims.length) {
        target.outcome = "miss";
        if (next.roundNumber >= TRAINING_V6_MAX_DRAWS) {
          next.phase = "complete";
          next.result = {
            type: "all_miss",
            reason: "five_draws_without_hit",
            drawCount: TRAINING_V6_MAX_DRAWS,
            workoutCount: 0,
            completedAt: now,
          };
          return;
        }
        next.roundNumber += 1;
        next.rounds[next.roundNumber] = {
          roundNumber: next.roundNumber,
          images: {},
          scores: {},
        };
        next.phase = "media_exchange";
        return;
      }
      target.outcome = victims.length === 2 ? "double_hit" : "hit";
      next.workoutQueue = victims.map((victimUid, index) => {
        const trainerUid = otherParticipant(next, victimUid);
        return {
          index,
          sequence: index,
          workoutId: `workout-${next.roundNumber}-${index + 1}`,
          roundNumber: next.roundNumber,
          trainerUid,
          victimUid,
          score: target.scores[victimUid],
          sourceImageNumber: target.images[trainerUid].imageNumber,
          durationSeconds: TRAINING_V6_WORKOUT_SECONDS,
          durationMs: TRAINING_V6_WORKOUT_SECONDS * 1000,
        };
      });
      next.activeWorkoutIndex = 0;
      next.phase = "instruction";
    });
    decision.privateScore = clone(combinedPrivateScores[uid]);
    decision.privateScoresResolved = bothSubmitted;
    return decision;
  }
  if (action.action === "instruction") {
    if (room.phase !== "instruction") {
      return transitionFailure(room, "wrong-phase");
    }
    const queued = currentWorkout(room);
    if (!queued || action.workoutIndex !== room.activeWorkoutIndex) {
      return transitionFailure(room, "wrong-workout");
    }
    if (queued.trainerUid !== uid) {
      return transitionFailure(room, "not-trainer");
    }
    const victimProfile = room.players?.[queued.victimUid]?.profile;
    if (!victimProfile?.allowedExercises?.includes(action.exerciseId)
        || action.bpm > victimProfile.maxBpm) {
      return transitionFailure(room, "unsafe-instruction");
    }
    return commit((next) => {
      const instruction = {
        workoutIndex: next.activeWorkoutIndex,
        trainerUid: queued.trainerUid,
        victimUid: queued.victimUid,
        exerciseId: action.exerciseId,
        exercise: action.exercise,
        completion: action.completion,
        command: action.command,
        bpm: action.bpm,
        beatsPerRep: action.beatsPerRep,
        issuedAt: now,
      };
      next.instruction = instruction;
      next.workoutQueue[next.activeWorkoutIndex].instruction = clone(instruction);
      next.phase = "ready";
    });
  }
  if (action.action === "ready") {
    if (room.phase !== "ready") return transitionFailure(room, "wrong-phase");
    const queued = currentWorkout(room);
    if (!queued || action.workoutIndex !== room.activeWorkoutIndex) {
      return transitionFailure(room, "wrong-workout");
    }
    if (queued.victimUid !== uid) return transitionFailure(room, "not-victim");
    return commit((next) => {
      next.workout = {
        workoutIndex: next.activeWorkoutIndex,
        trainerUid: queued.trainerUid,
        victimUid: queued.victimUid,
        durationSeconds: TRAINING_V6_WORKOUT_SECONDS,
        readyAt: now,
      };
      next.workoutQueue[next.activeWorkoutIndex].readyAt = now;
      next.phase = "workout";
    });
  }
  if (action.action === "workout_started") {
    if (room.phase !== "workout") return transitionFailure(room, "wrong-phase");
    const queued = currentWorkout(room);
    if (!queued || action.workoutIndex !== room.activeWorkoutIndex) {
      return transitionFailure(room, "wrong-workout");
    }
    if (queued.victimUid !== uid) return transitionFailure(room, "not-victim");
    if (finiteTimestamp(room.workout?.startedAt)) {
      return transitionFailure(room, "already-applied");
    }
    return commit((next) => {
      next.workout.startedAt = now;
      next.workout.endsAt = now + (TRAINING_V6_WORKOUT_SECONDS * 1000);
      next.workoutQueue[next.activeWorkoutIndex].startedAt = now;
      next.workoutQueue[next.activeWorkoutIndex].endsAt = next.workout.endsAt;
    });
  }
  if (action.action === "workout_completed") {
    if (room.phase !== "workout") return transitionFailure(room, "wrong-phase");
    const queued = currentWorkout(room);
    if (!queued || action.workoutIndex !== room.activeWorkoutIndex) {
      return transitionFailure(room, "wrong-workout");
    }
    if (queued.victimUid !== uid) return transitionFailure(room, "not-victim");
    if (!finiteTimestamp(room.workout?.startedAt)) {
      return transitionFailure(room, "workout-not-started");
    }
    if (!finiteTimestamp(room.workout?.endsAt) || now < room.workout.endsAt) {
      return transitionFailure(room, "workout-not-finished", {
        endsAt: room.workout?.endsAt,
      });
    }
    return commit((next) => {
      next.workout.completedAt = now;
      next.workoutQueue[next.activeWorkoutIndex].completedAt = now;
      next.workoutQueue[next.activeWorkoutIndex].workout = clone(next.workout);
      if (next.activeWorkoutIndex + 1 < next.workoutQueue.length) {
        next.activeWorkoutIndex += 1;
        delete next.instruction;
        delete next.workout;
        next.phase = "instruction";
        return;
      }
      next.phase = "complete";
      next.result = {
        type: "completed",
        reason: "accompaniment_completed",
        drawCount: next.roundNumber,
        workoutCount: next.workoutQueue.length,
        completedAt: now,
      };
    });
  }
  return transitionFailure(room, "unsupported-action");
}

function applyTrainingV6TransportClaim({
  room: inputRoom,
  uid,
  action,
  actionDigest,
  priorReceipt = null,
  now,
}) {
  const room = clone(inputRoom);
  if (!roomIsTrainingV6(room)) {
    return transitionFailure(room, room == null ? "room-not-found" : "invalid-room");
  }
  if (!isSafeUid(uid) || room.members?.[uid] !== true) {
    return transitionFailure(room, "not-member");
  }
  if (TERMINAL_PHASES.has(room.phase)) {
    return transitionFailure(room, "room-finished");
  }
  if (action?.action !== "claim_transport"
      || !isSafeToken(action.actionId)
      || !isSafeConnectionId(action.connectionId)
      || typeof actionDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(actionDigest)
      || !finiteTimestamp(now)) {
    return transitionFailure(room, "invalid-action");
  }
  const prior = isRecord(priorReceipt) ? priorReceipt : null;
  if (prior) {
    if (!actionReceiptMatches(prior, action.action, actionDigest)) {
      return transitionFailure(room, "action-id-reused");
    }
    return {
      ok: true,
      changed: false,
      idempotent: true,
      reason: "idempotent",
      room,
      transportRevision: prior.transportRevision,
      generation: prior.generation,
    };
  }
  const next = clone(room);
  const generation = Math.max(
    0,
    Number(next.connections?.[uid]?.generation) || 0,
  ) + 1;
  next.connections = isRecord(next.connections) ? next.connections : {};
  next.connections[uid] = {
    connectionId: action.connectionId,
    generation,
    claimedAt: now,
  };
  next.transportRevision = room.transportRevision + 1;
  next.transportUpdatedAt = now;
  const receipt = {
    action: action.action,
    digest: actionDigest,
    transportRevision: next.transportRevision,
    generation,
    at: now,
  };
  return {
    ok: true,
    changed: true,
    idempotent: false,
    reason: "applied",
    room: next,
    receipt,
    transportRevision: next.transportRevision,
    generation,
  };
}

function trainingV6RoomView(room, uid) {
  if (!roomIsTrainingV6(room) || room.members?.[uid] !== true) return null;
  const view = clone(room);
  view.participantUids = participantUids(view);
  view.rounds = objectValue(view.rounds);
  view.workoutQueue = Array.isArray(view.workoutQueue)
    ? view.workoutQueue
    : [];
  view.activeWorkoutIndex = Number.isInteger(view.activeWorkoutIndex)
    && view.activeWorkoutIndex >= 0
    ? view.activeWorkoutIndex
    : null;
  view.instruction = isRecord(view.instruction) ? view.instruction : null;
  view.workout = isRecord(view.workout) ? view.workout : null;
  view.result = isRecord(view.result) ? view.result : null;
  return view;
}

module.exports = Object.freeze({
  ROOM_ID_PATTERN,
  TERMINAL_PHASES,
  TRAINING_V6_EXERCISE_IDS,
  TRAINING_V6_HIT_SCORE,
  TRAINING_V6_MAX_DRAWS,
  TRAINING_V6_NO_CONTEST_REASONS,
  TRAINING_V6_PHASES,
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_QUEUE_TTL_MS,
  TRAINING_V6_ROOM_RETENTION_MS,
  TRAINING_V6_VARIANT,
  TRAINING_V6_WORKOUT_SECONDS,
  applyTrainingV6RoomAction,
  applyTrainingV6TransportClaim,
  createTrainingV6Room,
  isRoomId,
  isSafeToken,
  isSafeUid,
  normalizeTrainingV6Action,
  normalizeTrainingV6Profile,
  participantUids,
  roomIsTrainingV6,
  trainingV6RoomView,
});
