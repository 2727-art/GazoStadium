"use strict";

const TRAINING_V6_PROTOCOL_VERSION = 6;
const TRAINING_V6_VARIANT = "companion_v6";
const TRAINING_V6_WORKOUT_SECONDS = 60;
const TRAINING_V6_TERMINAL_PHASES = Object.freeze([
  "complete",
  "no_contest",
]);

const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const FORBIDDEN_KEY = /[\u0000-\u001f\u007f.#$\[\]\/]/;

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function isSafeUid(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !FORBIDDEN_KEY.test(value);
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requireValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function trainingV6SettlementParticipants(room) {
  const memberOrder = room?.memberOrder;
  requireValue(
    isRecord(memberOrder) || Array.isArray(memberOrder),
    "Training V6 memberOrder is invalid",
  );
  requireValue(
    Object.keys(memberOrder).length === 2
      && Object.hasOwn(memberOrder, "0")
      && Object.hasOwn(memberOrder, "1"),
    "Training V6 memberOrder must contain exactly two members",
  );
  const participants = [memberOrder[0], memberOrder[1]];
  requireValue(
    participants.every(isSafeUid) && participants[0] !== participants[1],
    "Training V6 participants are invalid",
  );
  requireValue(
    isRecord(room.members)
      && Object.keys(room.members).length === 2
      && participants.every((uid) => room.members[uid] === true),
    "Training V6 fixed membership is invalid",
  );
  if (Object.hasOwn(room, "participantUids")) {
    requireValue(
      Array.isArray(room.participantUids)
        && room.participantUids.length === 2
        && room.participantUids.every(
          (uid, index) => uid === participants[index],
        ),
      "Training V6 participant order does not match fixed membership",
    );
  }
  return participants;
}

function normalizeCompletedWorkout(workout, index, participants, terminalAt) {
  requireValue(isRecord(workout), "Training V6 workout is invalid");
  requireValue(
    workout.index === index
      && participants.includes(workout.victimUid)
      && participants.includes(workout.trainerUid)
      && workout.victimUid !== workout.trainerUid
      && workout.durationSeconds === TRAINING_V6_WORKOUT_SECONDS,
    "Training V6 workout identity is invalid",
  );
  if (!Object.hasOwn(workout, "completedAt")) return null;
  requireValue(
    isTimestamp(workout.startedAt)
      && isTimestamp(workout.endsAt)
      && workout.endsAt === workout.startedAt
        + (TRAINING_V6_WORKOUT_SECONDS * 1000)
      && isTimestamp(workout.completedAt)
      && workout.completedAt >= workout.endsAt
      && workout.completedAt <= terminalAt
      && workout.startedAt <= workout.completedAt,
    "Training V6 workout completion is invalid",
  );
  return {
    victimUid: workout.victimUid,
    completedAt: workout.completedAt,
  };
}

function emptyMetrics(participants) {
  return Object.fromEntries(participants.map((uid) => [uid, {
    sessionDelta: 0,
    completedSets: 0,
    completedSeconds: 0,
    completionTimestamps: [],
  }]));
}

function claimId(roomId, uid) {
  return `${roomId}:${uid}`;
}

function createClaim(decision, uid) {
  const metrics = decision.metricsByUid[uid];
  requireValue(
    decision.recordable === true && metrics,
    "Training V6 claim is not recordable",
  );
  return deepFreeze({
    schemaVersion: 1,
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    claimId: claimId(decision.roomId, uid),
    roomId: decision.roomId,
    uid,
    participants: [...decision.participants],
    terminalPhase: "complete",
    terminalAt: decision.terminalAt,
    sessionDelta: metrics.sessionDelta,
    completedSets: metrics.completedSets,
    completedSeconds: metrics.completedSeconds,
    completionTimestamps: [...metrics.completionTimestamps],
    finalizedBy: decision.callerUid,
    createdAt: decision.now,
  });
}

function deriveTrainingV6Settlement({
  room,
  callerUid,
  now = Date.now(),
} = {}) {
  requireValue(isRecord(room), "Training V6 room is required");
  requireValue(
    room.protocolVersion === TRAINING_V6_PROTOCOL_VERSION
      && room.variant === TRAINING_V6_VARIANT
      && isSafeToken(room.roomId)
      && TRAINING_V6_TERMINAL_PHASES.includes(room.phase),
    "Training V6 terminal room is invalid",
  );
  requireValue(isTimestamp(now), "Training V6 settlement time is invalid");
  const participants = trainingV6SettlementParticipants(room);
  requireValue(
    participants.includes(callerUid),
    "Training V6 settlement caller is not a room member",
  );
  requireValue(
    isRecord(room.result)
      && isTimestamp(room.result.completedAt)
      && room.result.completedAt <= now,
    "Training V6 terminal result is invalid",
  );

  const metricsByUid = emptyMetrics(participants);
  const base = {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    roomId: room.roomId,
    callerUid,
    now,
    terminalPhase: room.phase,
    terminalAt: room.result.completedAt,
    participants: [...participants],
  };

  if (room.phase === "no_contest") {
    requireValue(
      room.result.type === "no_contest",
      "Training V6 no-contest result is invalid",
    );
    return deepFreeze({
      ...base,
      status: "ignored",
      reason: "no_contest",
      recordable: false,
      dailyEligible: false,
      achievementEligible: false,
      metricsByUid,
      claimsByUid: {},
    });
  }

  requireValue(
    room.result.type === "completed" || room.result.type === "all_miss",
    "Training V6 complete result is invalid",
  );
  const workouts = Array.isArray(room.workoutQueue)
    ? room.workoutQueue
    : [];
  requireValue(
    workouts.length <= participants.length,
    "Training V6 workout queue is invalid",
  );
  requireValue(
    (workouts.length === 0 && room.result.type === "all_miss")
      || (workouts.length > 0 && room.result.type === "completed"),
    "Training V6 result does not match its workout queue",
  );
  requireValue(
    Number(room.result.workoutCount) === workouts.length
      && Number(room.result.drawCount) === Number(room.roundNumber),
    "Training V6 result counters do not match the room",
  );

  const seenVictims = new Set();
  const completions = workouts.map((workout, index) => {
    const completion = normalizeCompletedWorkout(
      workout,
      index,
      participants,
      room.result.completedAt,
    );
    const victimUid = workout.victimUid;
    requireValue(
      !seenVictims.has(victimUid),
      "Training V6 contains duplicate victim workouts",
    );
    seenVictims.add(victimUid);
    return completion;
  }).filter(Boolean);
  requireValue(
    completions.length === workouts.length,
    "Training V6 completed result contains an unfinished workout",
  );

  for (const uid of participants) metricsByUid[uid].sessionDelta = 1;
  for (const completion of completions) {
    const metrics = metricsByUid[completion.victimUid];
    metrics.completedSets = 1;
    metrics.completedSeconds = TRAINING_V6_WORKOUT_SECONDS;
    metrics.completionTimestamps = [completion.completedAt];
  }

  const decision = {
    ...base,
    status: "record",
    reason: "complete",
    recordable: true,
    dailyEligible: true,
    achievementEligible: true,
    metricsByUid,
  };
  decision.claimsByUid = Object.fromEntries(participants.map((uid) => [
    uid,
    createClaim(decision, uid),
  ]));
  return deepFreeze(decision);
}

function claimData(value) {
  if (value == null) return null;
  if (typeof value.exists === "function" && !value.exists()) return null;
  if (value.exists === false) return null;
  if (typeof value.data === "function") return value.data() || null;
  if (Object.hasOwn(value, "data") && isRecord(value.data)) return value.data;
  return isRecord(value) ? value : null;
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => Number(value) === Number(right[index]));
}

function trainingV6SettlementClaimMatches(value, expectedClaim) {
  const current = claimData(value);
  if (!current || !isRecord(expectedClaim)) return false;
  return Number(current.schemaVersion) === expectedClaim.schemaVersion
    && Number(current.protocolVersion) === expectedClaim.protocolVersion
    && current.variant === expectedClaim.variant
    && current.claimId === expectedClaim.claimId
    && current.roomId === expectedClaim.roomId
    && current.uid === expectedClaim.uid
    && current.terminalPhase === expectedClaim.terminalPhase
    && Number(current.terminalAt) === expectedClaim.terminalAt
    && Number(current.sessionDelta) === expectedClaim.sessionDelta
    && Number(current.completedSets) === expectedClaim.completedSets
    && Number(current.completedSeconds) === expectedClaim.completedSeconds
    && sameStrings(current.participants, expectedClaim.participants)
    && sameNumbers(
      current.completionTimestamps,
      expectedClaim.completionTimestamps,
    );
}

async function executeTrainingV6Settlement({
  room,
  callerUid,
  now = Date.now(),
  dependencies = {},
} = {}) {
  const decision = deriveTrainingV6Settlement({ room, callerUid, now });
  if (!decision.recordable) {
    return deepFreeze({
      status: "ignored",
      reason: decision.reason,
      decision,
      recordedUids: [],
      duplicateUids: [],
    });
  }

  const {
    runTransaction,
    getClaim,
    applyParticipants,
    createClaim: persistClaim,
  } = dependencies;
  requireValue(
    typeof runTransaction === "function"
      && typeof getClaim === "function"
      && typeof applyParticipants === "function"
      && typeof persistClaim === "function",
    "Training V6 settlement dependencies are invalid",
  );

  return runTransaction(async (transaction) => {
    const existingValues = await Promise.all(decision.participants.map(
      (uid) => getClaim({
        transaction,
        roomId: decision.roomId,
        uid,
        claimId: claimId(decision.roomId, uid),
      }),
    ));
    const duplicateUids = [];
    const recordedUids = [];
    decision.participants.forEach((uid, index) => {
      const existing = claimData(existingValues[index]);
      if (!existing) {
        recordedUids.push(uid);
        return;
      }
      requireValue(
        trainingV6SettlementClaimMatches(
          existing,
          decision.claimsByUid[uid],
        ),
        "Training V6 saved settlement claim does not match",
      );
      duplicateUids.push(uid);
    });

    if (recordedUids.length) {
      const participantSettlements = recordedUids.map((uid) => deepFreeze({
        uid,
        roomId: decision.roomId,
        terminalAt: decision.terminalAt,
        dailyEligible: decision.dailyEligible,
        achievementEligible: decision.achievementEligible,
        metrics: decision.metricsByUid[uid],
        claim: decision.claimsByUid[uid],
      }));
      await applyParticipants({
        transaction,
        roomId: decision.roomId,
        callerUid,
        now,
        participantSettlements,
        decision,
      });
      for (const uid of recordedUids) {
        await persistClaim({
          transaction,
          roomId: decision.roomId,
          uid,
          claimId: claimId(decision.roomId, uid),
          claim: decision.claimsByUid[uid],
        });
      }
    }

    return deepFreeze({
      status: recordedUids.length
        ? duplicateUids.length
          ? "partial"
          : "recorded"
        : "duplicate",
      reason: "complete",
      decision,
      recordedUids,
      duplicateUids,
    });
  });
}

module.exports = {
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_TERMINAL_PHASES,
  TRAINING_V6_VARIANT,
  TRAINING_V6_WORKOUT_SECONDS,
  deriveTrainingV6Settlement,
  executeTrainingV6Settlement,
  trainingV6SettlementClaimMatches,
  trainingV6SettlementParticipants,
};
