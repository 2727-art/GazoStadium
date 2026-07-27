"use strict";

const TRAINING_PROTOCOL_VERSION = 1;
const TRAINING_VARIANT = "kitaeai_60";
const TRAINING_TURN_DURATION_MS = 60_000;
const TRAINING_MAX_TURNS = 6;
const TRAINING_ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TRAINING_DESTROYED_CLOCK_SKEW_MS = 15_000;
const TRAINING_OUTCOMES = Object.freeze(["win", "loss", "draw"]);
const TRAINING_CONTINUE_VOTES = Object.freeze(["continue", "finish"]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sameIds(first, second) {
  return first.length === second.length
    && first.every((value, index) => value === second[index]);
}

function boundedCount(value) {
  const number = Math.floor(Number(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function validDateKey(value) {
  const dateKey = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const timestamp = Date.parse(`${dateKey}T00:00:00+09:00`);
  if (!Number.isFinite(timestamp)) return "";
  return jstDateKey(timestamp) === dateKey ? dateKey : "";
}

function jstDateKey(timestamp = Date.now()) {
  if (!Number.isFinite(Number(timestamp))) throw new TypeError("Invalid training timestamp");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(timestamp)));
}

function previousJstDateKey(dateKey) {
  const normalized = validDateKey(dateKey);
  if (!normalized) throw new TypeError("Invalid JST date key");
  return jstDateKey(Date.parse(`${normalized}T00:00:00+09:00`) - (24 * 60 * 60 * 1000));
}

function normalizeTrainingProfile(value) {
  const source = objectValue(value);
  const sessions = boundedCount(source.sessions);
  const completedSets = boundedCount(source.completedSets);
  const completeDays = Math.min(boundedCount(source.completeDays), completedSets);
  const currentStreak = Math.min(boundedCount(source.currentStreak), completeDays);
  const bestStreak = Math.min(
    Math.max(currentStreak, boundedCount(source.bestStreak)),
    completeDays,
  );
  return {
    sessions,
    completedSets,
    completeDays,
    currentStreak,
    bestStreak,
    lastCompletedDateKey: validDateKey(source.lastCompletedDateKey),
    updatedAt: boundedCount(source.updatedAt),
  };
}

function applyTrainingSession(
  profileValue,
  completedSetsValue,
  completionTimestamp = Date.now(),
  updatedAt = completionTimestamp,
) {
  const profile = normalizeTrainingProfile(profileValue);
  const completionTimestamps = Array.isArray(completedSetsValue)
    ? completedSetsValue.map((value) => {
      const timestamp = Number(value);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        throw new TypeError("Invalid training completion timestamp");
      }
      return timestamp;
    })
    : boundedCount(completedSetsValue) > 0
      ? [completionTimestamp]
      : [];
  const completedSets = Array.isArray(completedSetsValue)
    ? completionTimestamps.length
    : boundedCount(completedSetsValue);
  profile.sessions += 1;
  profile.completedSets += completedSets;
  const completionDateKeys = [...new Set(completionTimestamps.map((timestamp) => (
    jstDateKey(timestamp)
  )))].sort();
  for (const dateKey of completionDateKeys) {
    if (profile.lastCompletedDateKey && dateKey <= profile.lastCompletedDateKey) continue;
    profile.completeDays += 1;
    profile.currentStreak = profile.lastCompletedDateKey === previousJstDateKey(dateKey)
      ? profile.currentStreak + 1
      : 1;
    profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
    profile.lastCompletedDateKey = dateKey;
  }
  profile.updatedAt = Math.floor(Number(updatedAt));
  return normalizeTrainingProfile(profile);
}

function trainingDailySettlement(progressValue, completionTimestamps, now = Date.now()) {
  const currentDateKey = jstDateKey(now);
  const timestamps = Array.isArray(completionTimestamps)
    ? completionTimestamps.map((value) => {
      const timestamp = Number(value);
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
        throw new TypeError("Invalid training completion timestamp");
      }
      return timestamp;
    })
    : [];
  if (timestamps.length === 0) {
    return {
      dateKey: currentDateKey,
      sessionDateKey: "",
      creditTrainingSet: false,
    };
  }
  const sessionDateKey = jstDateKey(Math.max(...timestamps));
  const storedDateKey = validDateKey(objectValue(progressValue).daily?.dateKey);
  const canCredit = sessionDateKey === currentDateKey
    || storedDateKey === sessionDateKey;
  return {
    dateKey: canCredit ? sessionDateKey : currentDateKey,
    sessionDateKey,
    creditTrainingSet: canCredit,
  };
}

function normalizeBoundedText(value, maximum, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  if (value.length > maximum || /[\r\n]/u.test(value)) {
    throw new TypeError(`${label} length is invalid`);
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${label} length is invalid`);
  }
  return normalized;
}

function normalizeTrainingInstruction(value) {
  const source = objectValue(value);
  const bpm = Number(source.bpm);
  const beatsPerRep = Number(source.beatsPerRep);
  if (!Number.isInteger(bpm) || (bpm !== 0 && (bpm < 40 || bpm > 160))) {
    throw new TypeError("Training BPM must be 0 or an integer from 40 to 160");
  }
  if (![1, 2, 4].includes(beatsPerRep)) {
    throw new TypeError("Training beats per rep must be 1, 2, or 4");
  }
  return {
    exercise: normalizeBoundedText(source.exercise, 40, "Training exercise"),
    completion: normalizeBoundedText(source.completion, 60, "Training completion"),
    command: normalizeBoundedText(source.command, 120, "Training command"),
    bpm,
    beatsPerRep,
  };
}

function memberIds(room) {
  const members = objectValue(room?.members);
  const ids = Object.keys(members).sort();
  if (ids.length !== 2 || ids.some((uid) => !uid || members[uid] !== true)) {
    throw new TypeError("Training room requires exactly two members");
  }
  return ids;
}

function trainingRoomParticipants(room) {
  if (Number(room?.protocolVersion) !== TRAINING_PROTOCOL_VERSION
      || room?.variant !== TRAINING_VARIANT) {
    throw new TypeError("Unsupported training room protocol");
  }
  if (room?.status !== "active") {
    throw new TypeError("Training room is not active");
  }
  const participants = memberIds(room);
  const players = objectValue(room?.players);
  const accepted = objectValue(room?.accepted);
  if (!sameIds(participants, Object.keys(players).sort())
      || participants.some((uid) => players[uid]?.uid !== uid)) {
    throw new TypeError("Training room players do not match members");
  }
  if (!sameIds(participants, Object.keys(accepted).sort())
      || participants.some((uid) => accepted[uid] !== true)) {
    throw new TypeError("Training room acceptance does not match members");
  }
  if (!participants.includes(room?.firstTrainerUid)) {
    throw new TypeError("Training room first trainer is not a member");
  }
  return participants;
}

function requireTimestamp(value, label, { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < minimum || timestamp > maximum) {
    throw new TypeError(`${label} timestamp is invalid`);
  }
  return timestamp;
}

function normalizedTurns(room, participants, now, createdAt) {
  const source = room?.turns == null ? {} : objectValue(room.turns);
  if (room?.turns != null && source !== room.turns) {
    throw new TypeError("Training turns must be an object");
  }
  const keys = Object.keys(source);
  if (keys.some((key) => !/^[1-6]$/.test(key))) {
    throw new TypeError("Training turn number is invalid");
  }
  const numbers = keys.map(Number).sort((first, second) => first - second);
  if (numbers.some((turnNumber, index) => turnNumber !== index + 1)) {
    throw new TypeError("Training turns must be contiguous");
  }

  const turns = [];
  let expectedTrainerUid = room.firstTrainerUid;
  let previousCompletedAt = createdAt;
  for (const turnNumber of numbers) {
    const sourceTurn = objectValue(source[turnNumber]);
    const trainerUid = String(sourceTurn.trainerUid || "");
    const traineeUid = String(sourceTurn.traineeUid || "");
    const expectedTraineeUid = participants.find((uid) => uid !== expectedTrainerUid);
    if (trainerUid !== expectedTrainerUid || traineeUid !== expectedTraineeUid) {
      throw new TypeError("Training turn roles do not alternate");
    }
    const turnCreatedAt = requireTimestamp(sourceTurn.createdAt, "Training turn creation", {
      minimum: previousCompletedAt,
      maximum: now,
    });
    const terminalKeys = ["completedAt", "surrenderedAt", "timedOutAt"]
      .filter((key) => Object.hasOwn(sourceTurn, key));
    if (!Object.hasOwn(sourceTurn, "startedAt")) {
      if (terminalKeys.length) {
        throw new TypeError("Training turn ended before it started");
      }
      turns.push({
        turnNumber,
        trainerUid,
        traineeUid,
        instruction: normalizeTrainingInstruction(sourceTurn.instruction),
        createdAt: turnCreatedAt,
        startedAt: 0,
        deadlineAt: 0,
        terminal: "not_started",
        terminalAt: 0,
      });
      continue;
    }
    const startedAt = requireTimestamp(sourceTurn.startedAt, "Training start", {
      minimum: turnCreatedAt,
      maximum: now,
    });
    const deadlineAt = startedAt + TRAINING_TURN_DURATION_MS;
    if (terminalKeys.length > 1) {
      throw new TypeError("Training turn has multiple terminal states");
    }
    let terminal = "";
    let terminalAt = 0;
    if (terminalKeys.length) {
      const key = terminalKeys[0];
      terminalAt = requireTimestamp(sourceTurn[key], `Training ${key}`, {
        minimum: key === "timedOutAt" ? deadlineAt : startedAt,
        maximum: key === "timedOutAt" ? now : Math.min(now, deadlineAt),
      });
      terminal = key === "completedAt"
        ? "completed"
        : key === "surrenderedAt"
          ? "surrendered"
          : "timed_out";
    }
    const turn = {
      turnNumber,
      trainerUid,
      traineeUid,
      instruction: normalizeTrainingInstruction(sourceTurn.instruction),
      createdAt: turnCreatedAt,
      startedAt,
      deadlineAt,
      terminal,
      terminalAt,
    };
    turns.push(turn);
    if (terminal === "completed") {
      expectedTrainerUid = traineeUid;
      previousCompletedAt = terminalAt;
    }
  }
  return turns;
}

function normalizedContinueVotes(room, participants) {
  if (room?.continueVotes == null) return {};
  const source = objectValue(room.continueVotes);
  if (source !== room.continueVotes) {
    throw new TypeError("Training continue votes must be an object");
  }
  const result = {};
  for (const [pairKey, pairValue] of Object.entries(source)) {
    if (!/^[1-3]$/.test(pairKey)) {
      throw new TypeError("Training continue vote pair is invalid");
    }
    const votes = objectValue(pairValue);
    const voterIds = Object.keys(votes).sort();
    if (voterIds.some((uid) => !participants.includes(uid))) {
      throw new TypeError("Training continue vote has an outsider");
    }
    result[pairKey] = {};
    for (const uid of voterIds) {
      if (!TRAINING_CONTINUE_VOTES.includes(votes[uid])) {
        throw new TypeError("Training continue vote is invalid");
      }
      result[pairKey][uid] = votes[uid];
    }
  }
  return result;
}

function mutualCompleteResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  turnCount,
) {
  return {
    status: "final",
    reason: "mutual_complete",
    participants,
    outcomes: Object.fromEntries(participants.map((uid) => [uid, "draw"])),
    completedSetsByUid,
    completedAtByUid,
    turnCount,
  };
}

function decisiveResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  turn,
  reason,
) {
  return {
    status: "final",
    reason,
    participants,
    outcomes: {
      [turn.trainerUid]: "win",
      [turn.traineeUid]: "loss",
    },
    completedSetsByUid,
    completedAtByUid,
    turnCount: turn.turnNumber,
  };
}

function pendingResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  turnCount,
  retryAfterMs = 0,
) {
  return {
    status: "pending",
    reason: "pending",
    participants,
    outcomes: {},
    completedSetsByUid,
    completedAtByUid,
    turnCount,
    retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)),
  };
}

function resultAfterDestroyedGuard(room, result, turns, now) {
  if (room?.destroyed == null) return result;
  if (result.status !== "final") {
    throw new TypeError("Training room was destroyed before its result became final");
  }
  const destroyedAt = requireTimestamp(room.destroyed?.at, "Training destruction", {
    maximum: now,
  });
  const finalTurn = turns.find((turn) => turn.turnNumber === result.turnCount);
  let terminalEvidenceAt = 0;
  if (result.reason === "timeout") {
    terminalEvidenceAt = finalTurn?.terminal === "timed_out"
      ? finalTurn.terminalAt
      : finalTurn?.deadlineAt;
  } else {
    terminalEvidenceAt = finalTurn?.terminalAt;
  }
  if (!Number.isSafeInteger(terminalEvidenceAt)
      || terminalEvidenceAt <= 0
      || terminalEvidenceAt > destroyedAt + TRAINING_DESTROYED_CLOCK_SKEW_MS) {
    throw new TypeError("Training result evidence occurred after room destruction");
  }
  return result;
}

function deriveTrainingRoomResult(room, now = Date.now()) {
  const timestamp = requireTimestamp(now, "Training current");
  const participants = trainingRoomParticipants(room);
  const createdAt = requireTimestamp(room?.createdAt, "Training room creation", {
    maximum: timestamp,
  });
  const turns = normalizedTurns(room, participants, timestamp, createdAt);
  const continueVotes = normalizedContinueVotes(room, participants);
  const completedSetsByUid = Object.fromEntries(participants.map((uid) => [uid, 0]));
  const completedAtByUid = Object.fromEntries(participants.map((uid) => [uid, []]));
  const allowedVotePairs = new Set();
  const guardedResult = (result) => resultAfterDestroyedGuard(
    room,
    result,
    turns,
    timestamp,
  );

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const hasLaterTurn = index < turns.length - 1;
    if (turn.terminal === "completed") {
      completedSetsByUid[turn.traineeUid] += 1;
      completedAtByUid[turn.traineeUid].push(turn.terminalAt);
      if (turn.turnNumber % 2 === 0) {
        const pairKey = String(turn.turnNumber / 2);
        allowedVotePairs.add(pairKey);
        const pairVotes = continueVotes[pairKey] || {};
        const hasFinishVote = participants.some((uid) => pairVotes[uid] === "finish");
        const bothContinue = participants.every((uid) => pairVotes[uid] === "continue");
        if (turn.turnNumber === TRAINING_MAX_TURNS || hasFinishVote) {
          if (hasLaterTurn) {
            throw new TypeError("Training continued after its mutual completion");
          }
          const unusedVotePair = Object.keys(continueVotes)
            .find((key) => !allowedVotePairs.has(key));
          if (unusedVotePair) throw new TypeError("Training has a premature continue vote");
          return guardedResult(mutualCompleteResult(
            participants,
            completedSetsByUid,
            completedAtByUid,
            turn.turnNumber,
          ));
        }
        if (hasLaterTurn && !bothContinue) {
          throw new TypeError("Training continued without both continue votes");
        }
        if (!hasLaterTurn && !bothContinue) {
          const unusedVotePair = Object.keys(continueVotes)
            .find((key) => !allowedVotePairs.has(key));
          if (unusedVotePair) throw new TypeError("Training has a premature continue vote");
          return guardedResult(pendingResult(
            participants,
            completedSetsByUid,
            completedAtByUid,
            turn.turnNumber,
          ));
        }
      }
      if (!hasLaterTurn) {
        const unusedVotePair = Object.keys(continueVotes)
          .find((key) => !allowedVotePairs.has(key));
        if (unusedVotePair) throw new TypeError("Training has a premature continue vote");
        return guardedResult(pendingResult(
          participants,
          completedSetsByUid,
          completedAtByUid,
          turn.turnNumber,
        ));
      }
      continue;
    }

    if (hasLaterTurn) {
      throw new TypeError("Training has a turn after an unfinished terminal state");
    }
    const unusedVotePair = Object.keys(continueVotes)
      .find((key) => !allowedVotePairs.has(key));
    if (unusedVotePair) throw new TypeError("Training has a premature continue vote");
    if (turn.terminal === "surrendered") {
      return guardedResult(decisiveResult(
        participants,
        completedSetsByUid,
        completedAtByUid,
        turn,
        "surrender",
      ));
    }
    if (turn.terminal === "not_started") {
      return guardedResult(pendingResult(
        participants,
        completedSetsByUid,
        completedAtByUid,
        turn.turnNumber,
      ));
    }
    if (turn.terminal === "timed_out" || timestamp >= turn.deadlineAt) {
      return guardedResult(decisiveResult(
        participants,
        completedSetsByUid,
        completedAtByUid,
        turn,
        "timeout",
      ));
    }
    return guardedResult(pendingResult(
      participants,
      completedSetsByUid,
      completedAtByUid,
      turn.turnNumber,
      turn.deadlineAt - timestamp,
    ));
  }

  if (Object.keys(continueVotes).length) {
    throw new TypeError("Training has a continue vote before any completed pair");
  }
  return guardedResult(
    pendingResult(participants, completedSetsByUid, completedAtByUid, 0),
  );
}

function assertTrainingRoomFinalizable(
  room,
  uid,
  now = Date.now(),
  { maxAgeMs = TRAINING_ROOM_MAX_AGE_MS } = {},
) {
  const result = deriveTrainingRoomResult(room, now);
  if (!result.participants.includes(uid)) {
    throw new TypeError("Training caller is not a room member");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError("Training room maximum age is invalid");
  }
  const createdAt = Number(room?.createdAt);
  if (createdAt < now - maxAgeMs) {
    throw new TypeError("Training room is too old");
  }
  if (result.status === "final"
      && Object.values(result.outcomes).some((outcome) => !TRAINING_OUTCOMES.includes(outcome))) {
    throw new TypeError("Training outcome is invalid");
  }
  return result;
}

module.exports = Object.freeze({
  TRAINING_CONTINUE_VOTES,
  TRAINING_DESTROYED_CLOCK_SKEW_MS,
  TRAINING_MAX_TURNS,
  TRAINING_OUTCOMES,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_ROOM_MAX_AGE_MS,
  TRAINING_TURN_DURATION_MS,
  TRAINING_VARIANT,
  applyTrainingSession,
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
  jstDateKey,
  normalizeTrainingInstruction,
  normalizeTrainingProfile,
  previousJstDateKey,
  trainingDailySettlement,
  trainingRoomParticipants,
});
