"use strict";

const TRAINING_PROTOCOL_VERSION = 2;
const TRAINING_VARIANT = "kitaeai_60_v2";
const LEGACY_TRAINING_PROTOCOL_VERSION = 1;
const LEGACY_TRAINING_VARIANT = "kitaeai_60";
const TRAINING_BASE_DURATION_MS = 60_000;
const TRAINING_TURN_DURATION_MS = TRAINING_BASE_DURATION_MS;
const TRAINING_MAX_TURNS = 6;
const TRAINING_ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TRAINING_DESTROYED_CLOCK_SKEW_MS = 15_000;
const TRAINING_OUTCOMES = Object.freeze(["win", "loss", "draw"]);
const TRAINING_CONTINUE_VOTES = Object.freeze(["continue", "finish"]);
const TRAINING_CARROT_CHOICES = Object.freeze([
  "mine",
  "boost8",
  "boost9",
  "boost10",
]);
const TRAINING_TARGET_DURATION_MS = Object.freeze({
  mine: TRAINING_BASE_DURATION_MS,
  boost8: 70_000,
  boost9: 80_000,
  boost10: 90_000,
});

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
  const threeSetCompletions = Math.min(
    boundedCount(source.threeSetCompletions),
    sessions,
  );
  const threeSetDays = Math.min(
    boundedCount(source.threeSetDays),
    completeDays,
  );
  const currentThreeSetStreak = Math.min(
    boundedCount(source.currentThreeSetStreak),
    threeSetDays,
  );
  const bestThreeSetStreak = Math.min(
    Math.max(currentThreeSetStreak, boundedCount(source.bestThreeSetStreak)),
    threeSetDays,
  );
  return {
    sessions,
    completedSets,
    completedSeconds: boundedCount(source.completedSeconds),
    boostCompletedSets: Math.min(
      boundedCount(source.boostCompletedSets),
      completedSets,
    ),
    boostSeconds: boundedCount(source.boostSeconds),
    threeSetCompletions,
    threeSetDays,
    currentThreeSetStreak,
    bestThreeSetStreak,
    lastThreeSetDateKey: validDateKey(source.lastThreeSetDateKey),
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
  metricsValue = {},
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
  const metrics = objectValue(metricsValue);
  const completedSeconds = boundedCount(metrics.completedSeconds);
  const boostCompletedSets = Math.min(
    boundedCount(metrics.boostCompletedSets),
    completedSets,
  );
  const boostSeconds = Math.min(
    boundedCount(metrics.boostSeconds),
    completedSeconds,
  );
  profile.completedSeconds += completedSeconds;
  profile.boostCompletedSets += boostCompletedSets;
  profile.boostSeconds += boostSeconds;
  if (metrics.threeSetSessionComplete === true && completedSets >= 3) {
    profile.threeSetCompletions += 1;
  }
  if (metrics.threeSetDayComplete === true) {
    const threeSetDateKey = completionTimestamps.length
      ? jstDateKey(Math.max(...completionTimestamps))
      : jstDateKey(completionTimestamp);
    if (!profile.lastThreeSetDateKey
        || threeSetDateKey > profile.lastThreeSetDateKey) {
      profile.threeSetDays += 1;
      profile.currentThreeSetStreak =
        profile.lastThreeSetDateKey === previousJstDateKey(threeSetDateKey)
          ? profile.currentThreeSetStreak + 1
          : 1;
      profile.bestThreeSetStreak = Math.max(
        profile.bestThreeSetStreak,
        profile.currentThreeSetStreak,
      );
      profile.lastThreeSetDateKey = threeSetDateKey;
    }
  }
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

function trainingDailySettlement(
  progressValue,
  completionTimestamps,
  now = Date.now(),
  completionSeconds = [],
) {
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
      creditTrainingSets: 0,
      creditTrainingSeconds: 0,
    };
  }
  const completedSetSeconds = Array.isArray(completionSeconds)
    && completionSeconds.length > 0
    ? completionSeconds.map((value) => {
      const seconds = Number(value);
      if (!Number.isSafeInteger(seconds) || seconds < 0) {
        throw new TypeError("Invalid training completion seconds");
      }
      return seconds;
    })
    : timestamps.map(() => 0);
  if (completedSetSeconds.length !== timestamps.length) {
    throw new TypeError("Training completion timestamps and seconds do not match");
  }
  const sessionDateKey = jstDateKey(Math.max(...timestamps));
  const storedDateKey = validDateKey(objectValue(progressValue).daily?.dateKey);
  const canCredit = sessionDateKey === currentDateKey
    || storedDateKey === sessionDateKey;
  const creditedIndexes = canCredit
    ? timestamps
      .map((timestamp, index) => ({ timestamp, index }))
      .filter(({ timestamp }) => jstDateKey(timestamp) === sessionDateKey)
      .map(({ index }) => index)
    : [];
  return {
    dateKey: canCredit ? sessionDateKey : currentDateKey,
    sessionDateKey,
    creditTrainingSet: creditedIndexes.length > 0,
    creditTrainingSets: creditedIndexes.length,
    creditTrainingSeconds: creditedIndexes.reduce(
      (total, index) => total + completedSetSeconds[index],
      0,
    ),
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

function normalizeTrainingCarrotChoice(value) {
  if (!TRAINING_CARROT_CHOICES.includes(value)) {
    throw new TypeError("Training carrot choice is invalid");
  }
  return value;
}

function trainingTargetDurationMs(choice) {
  return TRAINING_TARGET_DURATION_MS[normalizeTrainingCarrotChoice(choice)];
}

function trainingImageOwnerUid(choice, traineeUid, trainerUid) {
  return normalizeTrainingCarrotChoice(choice) === "mine"
    ? traineeUid
    : trainerUid;
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
  const legacy = Number(room?.protocolVersion) === LEGACY_TRAINING_PROTOCOL_VERSION
    && room?.variant === LEGACY_TRAINING_VARIANT;
  const current = Number(room?.protocolVersion) === TRAINING_PROTOCOL_VERSION
    && room?.variant === TRAINING_VARIANT;
  if (!legacy && !current) {
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
  if (current) {
    const carrotChoices = objectValue(room?.carrotChoices);
    if (!sameIds(participants, Object.keys(carrotChoices).sort())) {
      throw new TypeError("Training carrot choices do not match members");
    }
    participants.forEach((uid) => normalizeTrainingCarrotChoice(carrotChoices[uid]));
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

function normalizedV2Turns(room, participants, now, createdAt) {
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
    const carrotChoice = normalizeTrainingCarrotChoice(sourceTurn.carrotChoice);
    if (carrotChoice !== room.carrotChoices?.[traineeUid]) {
      throw new TypeError("Training turn carrot choice does not match the trainee");
    }
    const targetDurationMs = trainingTargetDurationMs(carrotChoice);
    if (Number(sourceTurn.targetDurationMs) !== targetDurationMs) {
      throw new TypeError("Training target duration is invalid");
    }
    const imageOwnerUid = trainingImageOwnerUid(
      carrotChoice,
      traineeUid,
      trainerUid,
    );
    if (sourceTurn.imageOwnerUid !== imageOwnerUid) {
      throw new TypeError("Training image owner is invalid");
    }
    const turnCreatedAt = requireTimestamp(sourceTurn.createdAt, "Training turn creation", {
      minimum: previousCompletedAt,
      maximum: now,
    });
    if (Object.hasOwn(sourceTurn, "timedOutAt")) {
      throw new TypeError("Training protocol v2 does not support timed out turns");
    }
    const terminalKeys = ["completedAt", "surrenderedAt"]
      .filter((key) => Object.hasOwn(sourceTurn, key));
    if (!Object.hasOwn(sourceTurn, "startedAt")) {
      if (terminalKeys.length
          || Object.hasOwn(sourceTurn, "baseCompletedAt")
          || Object.hasOwn(sourceTurn, "boostCompletedAt")) {
        throw new TypeError("Training turn ended before it started");
      }
      turns.push({
        turnNumber,
        trainerUid,
        traineeUid,
        carrotChoice,
        targetDurationMs,
        imageOwnerUid,
        instruction: normalizeTrainingInstruction(sourceTurn.instruction),
        createdAt: turnCreatedAt,
        startedAt: 0,
        baseDeadlineAt: 0,
        deadlineAt: 0,
        terminal: "not_started",
        terminalAt: 0,
        baseCompletedAt: 0,
        boostCompletedAt: 0,
        completedSeconds: 0,
        boostSeconds: 0,
      });
      continue;
    }
    const startedAt = requireTimestamp(sourceTurn.startedAt, "Training start", {
      minimum: turnCreatedAt,
      maximum: now,
    });
    const baseDeadlineAt = startedAt + TRAINING_BASE_DURATION_MS;
    const deadlineAt = startedAt + targetDurationMs;
    const baseCompletedAt = Object.hasOwn(sourceTurn, "baseCompletedAt")
      ? requireTimestamp(sourceTurn.baseCompletedAt, "Training base completion", {
        minimum: baseDeadlineAt,
        maximum: Math.min(now, baseDeadlineAt),
      })
      : 0;
    if (terminalKeys.length > 1) {
      throw new TypeError("Training turn has multiple terminal states");
    }
    let terminal = "";
    let terminalAt = 0;
    if (terminalKeys.length) {
      const key = terminalKeys[0];
      terminalAt = requireTimestamp(sourceTurn[key], `Training ${key}`, {
        minimum: key === "completedAt" ? baseCompletedAt : startedAt,
        maximum: key === "completedAt"
          ? Math.min(now, deadlineAt + 15_000)
          : Math.min(now, baseDeadlineAt - 1),
      });
      if (key === "completedAt" && !baseCompletedAt) {
        throw new TypeError("Training completion requires base completion");
      }
      if (key === "completedAt"
          && terminalAt >= deadlineAt
          && terminalAt !== deadlineAt) {
        throw new TypeError("Training full completion timestamp is invalid");
      }
      if (key !== "completedAt" && baseCompletedAt) {
        throw new TypeError("Training loss cannot follow base completion");
      }
      terminal = key === "completedAt" ? "completed" : "surrendered";
    }
    const boostCompletedAt = Object.hasOwn(sourceTurn, "boostCompletedAt")
      ? requireTimestamp(sourceTurn.boostCompletedAt, "Training boost completion", {
        minimum: deadlineAt,
        maximum: Math.min(now, deadlineAt),
      })
      : 0;
    if (boostCompletedAt
        && (carrotChoice === "mine"
          || terminal !== "completed"
          || boostCompletedAt !== terminalAt)) {
      throw new TypeError("Training boost completion is invalid");
    }
    if (terminal === "completed"
        && carrotChoice !== "mine"
        && terminalAt >= deadlineAt
        && !boostCompletedAt) {
      throw new TypeError("Training full boost completion needs its marker");
    }
    const completedSeconds = terminal === "completed"
      ? Math.min(
        targetDurationMs / 1_000,
        Math.max(
          TRAINING_BASE_DURATION_MS / 1_000,
          Math.floor((terminalAt - startedAt) / 1_000),
        ),
      )
      : 0;
    const turn = {
      turnNumber,
      trainerUid,
      traineeUid,
      carrotChoice,
      targetDurationMs,
      imageOwnerUid,
      instruction: normalizeTrainingInstruction(sourceTurn.instruction),
      createdAt: turnCreatedAt,
      startedAt,
      baseDeadlineAt,
      deadlineAt,
      terminal,
      terminalAt,
      baseCompletedAt,
      boostCompletedAt,
      completedSeconds,
      boostSeconds: Math.max(
        0,
        completedSeconds - (TRAINING_BASE_DURATION_MS / 1_000),
      ),
    };
    turns.push(turn);
    if (terminal === "completed") {
      expectedTrainerUid = traineeUid;
      previousCompletedAt = terminalAt;
    }
  }
  return turns;
}

function normalizedLegacyTurns(room, participants, now, createdAt) {
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
        baseDeadlineAt: 0,
        deadlineAt: 0,
        terminal: "not_started",
        terminalAt: 0,
        baseCompletedAt: 0,
        boostCompletedAt: 0,
        completedSeconds: 0,
        boostSeconds: 0,
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
    turns.push({
      turnNumber,
      trainerUid,
      traineeUid,
      instruction: normalizeTrainingInstruction(sourceTurn.instruction),
      createdAt: turnCreatedAt,
      startedAt,
      baseDeadlineAt: deadlineAt,
      deadlineAt,
      terminal,
      terminalAt,
      baseCompletedAt: terminal === "completed" ? terminalAt : 0,
      boostCompletedAt: 0,
      completedSeconds: 0,
      boostSeconds: 0,
    });
    if (terminal === "completed") {
      expectedTrainerUid = traineeUid;
      previousCompletedAt = terminalAt;
    }
  }
  return turns;
}

function normalizedLegacyContinueVotes(room, participants) {
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
      if (!["continue", "finish"].includes(votes[uid])) {
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
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
  turnCount,
) {
  return {
    status: "final",
    reason: "mutual_complete",
    participants,
    outcomes: Object.fromEntries(participants.map((uid) => [uid, "draw"])),
    completedSetsByUid,
    completedAtByUid,
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
    turnCount,
  };
}

function mutualBaseCompleteResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
  turnCount,
) {
  return {
    ...mutualCompleteResult(
      participants,
      completedSetsByUid,
      completedAtByUid,
      completedSecondsByUid,
      completedSetSecondsByUid,
      boostCompletedSetsByUid,
      boostSecondsByUid,
      turnCount,
    ),
    reason: "mutual_base_complete",
  };
}

function interruptedAfterBaseResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
  turnCount,
) {
  return {
    status: "final",
    reason: "base_complete_interrupt",
    participants,
    outcomes: Object.fromEntries(participants.map((uid) => [uid, "draw"])),
    completedSetsByUid,
    completedAtByUid,
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
    turnCount,
  };
}

function interruptedAfterCompletedProgressResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
  turnCount,
) {
  return {
    status: "final",
    reason: "progress_complete_interrupt",
    participants,
    outcomes: Object.fromEntries(participants.map((uid) => [uid, "draw"])),
    completedSetsByUid,
    completedAtByUid,
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
    turnCount,
  };
}

function decisiveResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
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
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
    turnCount: turn.turnNumber,
  };
}

function pendingResult(
  participants,
  completedSetsByUid,
  completedAtByUid,
  completedSecondsByUid,
  completedSetSecondsByUid,
  boostCompletedSetsByUid,
  boostSecondsByUid,
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
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
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
  } else if (result.reason === "base_complete_interrupt"
      || result.reason === "mutual_base_complete") {
    terminalEvidenceAt = finalTurn?.baseCompletedAt;
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

function emptyTrainingMetrics(participants) {
  return {
    completedSetsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedAtByUid: Object.fromEntries(participants.map((uid) => [uid, []])),
    completedSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedSetSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, []])),
    boostCompletedSetsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    boostSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
  };
}

function resultMetricArguments(metrics) {
  return [
    metrics.completedSetsByUid,
    metrics.completedAtByUid,
    metrics.completedSecondsByUid,
    metrics.completedSetSecondsByUid,
    metrics.boostCompletedSetsByUid,
    metrics.boostSecondsByUid,
  ];
}

function deriveLegacyTrainingRoomResult(room, participants, turns, timestamp) {
  const continueVotes = normalizedLegacyContinueVotes(room, participants);
  const metrics = emptyTrainingMetrics(participants);
  const {
    completedSetsByUid,
    completedAtByUid,
    completedSetSecondsByUid,
  } = metrics;
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
      completedSetSecondsByUid[turn.traineeUid].push(0);
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
            ...resultMetricArguments(metrics),
            turn.turnNumber,
          ));
        }
        if (hasLaterTurn && !bothContinue) {
          throw new TypeError("Training continued without both continue votes");
        }
        if (!hasLaterTurn && !bothContinue) {
          return guardedResult(pendingResult(
            participants,
            ...resultMetricArguments(metrics),
            turn.turnNumber,
          ));
        }
      }
      if (!hasLaterTurn) {
        return guardedResult(pendingResult(
          participants,
          ...resultMetricArguments(metrics),
          turn.turnNumber,
        ));
      }
      continue;
    }

    if (hasLaterTurn) {
      throw new TypeError("Training has a turn after an unfinished terminal state");
    }
    if (turn.terminal === "surrendered") {
      return guardedResult(decisiveResult(
        participants,
        ...resultMetricArguments(metrics),
        turn,
        "surrender",
      ));
    }
    if (turn.terminal === "not_started") {
      return guardedResult(pendingResult(
        participants,
        ...resultMetricArguments(metrics),
        turn.turnNumber,
      ));
    }
    if (turn.terminal === "timed_out" || timestamp >= turn.deadlineAt) {
      return guardedResult(decisiveResult(
        participants,
        ...resultMetricArguments(metrics),
        turn,
        "timeout",
      ));
    }
    return guardedResult(pendingResult(
      participants,
      ...resultMetricArguments(metrics),
      turn.turnNumber,
      turn.deadlineAt - timestamp,
    ));
  }

  if (Object.keys(continueVotes).length) {
    throw new TypeError("Training has a continue vote before any completed pair");
  }
  return guardedResult(pendingResult(
    participants,
    ...resultMetricArguments(metrics),
    0,
  ));
}

function deriveV2TrainingRoomResult(room, participants, turns, timestamp) {
  if (room?.continueVotes != null) {
    throw new TypeError("Training protocol v2 does not support continue votes");
  }
  const metrics = emptyTrainingMetrics(participants);
  const {
    completedSetsByUid,
    completedAtByUid,
    completedSecondsByUid,
    completedSetSecondsByUid,
    boostCompletedSetsByUid,
    boostSecondsByUid,
  } = metrics;
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
      completedAtByUid[turn.traineeUid].push(turn.baseCompletedAt);
      completedSecondsByUid[turn.traineeUid] += turn.completedSeconds;
      completedSetSecondsByUid[turn.traineeUid].push(turn.completedSeconds);
      boostSecondsByUid[turn.traineeUid] += turn.boostSeconds;
      if (turn.boostCompletedAt > 0) {
        boostCompletedSetsByUid[turn.traineeUid] += 1;
      }
      if (turn.turnNumber === TRAINING_MAX_TURNS) {
        if (hasLaterTurn) {
          throw new TypeError("Training continued after three complete sets");
        }
        return guardedResult(mutualCompleteResult(
          participants,
          ...resultMetricArguments(metrics),
          turn.turnNumber,
        ));
      }
      if (!hasLaterTurn) {
        if (room?.destroyed != null) {
          return guardedResult(interruptedAfterCompletedProgressResult(
            participants,
            ...resultMetricArguments(metrics),
            turn.turnNumber,
          ));
        }
        return guardedResult(pendingResult(
          participants,
          ...resultMetricArguments(metrics),
          turn.turnNumber,
        ));
      }
      continue;
    }

    if (hasLaterTurn) {
      throw new TypeError("Training has a turn after an unfinished terminal state");
    }
    if (turn.terminal === "surrendered") {
      return guardedResult(decisiveResult(
        participants,
        ...resultMetricArguments(metrics),
        turn,
        "surrender",
      ));
    }
    if (turn.baseCompletedAt > 0 && room?.destroyed != null) {
      completedSetsByUid[turn.traineeUid] += 1;
      completedAtByUid[turn.traineeUid].push(turn.baseCompletedAt);
      completedSecondsByUid[turn.traineeUid] +=
        TRAINING_BASE_DURATION_MS / 1_000;
      completedSetSecondsByUid[turn.traineeUid].push(
        TRAINING_BASE_DURATION_MS / 1_000,
      );
      if (participants.every((uid) => completedSetsByUid[uid] === 3)) {
        return guardedResult(mutualBaseCompleteResult(
          participants,
          ...resultMetricArguments(metrics),
          turn.turnNumber,
        ));
      }
      return guardedResult(interruptedAfterBaseResult(
        participants,
        ...resultMetricArguments(metrics),
        turn.turnNumber,
      ));
    }
    if (room?.destroyed != null) {
      const previousCompletedTurn = turns
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.terminal === "completed");
      if (previousCompletedTurn) {
        return guardedResult(interruptedAfterCompletedProgressResult(
          participants,
          ...resultMetricArguments(metrics),
          previousCompletedTurn.turnNumber,
        ));
      }
    }
    const retryAt = turn.startedAt
      ? turn.baseCompletedAt
        ? turn.deadlineAt
        : turn.baseDeadlineAt
      : 0;
    return guardedResult(pendingResult(
      participants,
      ...resultMetricArguments(metrics),
      turn.turnNumber,
      Math.max(0, retryAt - timestamp),
    ));
  }

  return guardedResult(pendingResult(
    participants,
    ...resultMetricArguments(metrics),
    0,
  ));
}

function deriveTrainingRoomResult(room, now = Date.now()) {
  const timestamp = requireTimestamp(now, "Training current");
  const participants = trainingRoomParticipants(room);
  const createdAt = requireTimestamp(room?.createdAt, "Training room creation", {
    maximum: timestamp,
  });
  const legacy = Number(room?.protocolVersion) === LEGACY_TRAINING_PROTOCOL_VERSION;
  const turns = legacy
    ? normalizedLegacyTurns(room, participants, timestamp, createdAt)
    : normalizedV2Turns(room, participants, timestamp, createdAt);
  const result = legacy
    ? deriveLegacyTrainingRoomResult(room, participants, turns, timestamp)
    : deriveV2TrainingRoomResult(room, participants, turns, timestamp);
  return {
    ...result,
    protocolVersion: legacy
      ? LEGACY_TRAINING_PROTOCOL_VERSION
      : TRAINING_PROTOCOL_VERSION,
  };
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
  LEGACY_TRAINING_PROTOCOL_VERSION,
  LEGACY_TRAINING_VARIANT,
  TRAINING_BASE_DURATION_MS,
  TRAINING_CARROT_CHOICES,
  TRAINING_CONTINUE_VOTES,
  TRAINING_DESTROYED_CLOCK_SKEW_MS,
  TRAINING_MAX_TURNS,
  TRAINING_OUTCOMES,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_ROOM_MAX_AGE_MS,
  TRAINING_TURN_DURATION_MS,
  TRAINING_TARGET_DURATION_MS,
  TRAINING_VARIANT,
  applyTrainingSession,
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
  jstDateKey,
  normalizeTrainingInstruction,
  normalizeTrainingCarrotChoice,
  normalizeTrainingProfile,
  previousJstDateKey,
  trainingDailySettlement,
  trainingImageOwnerUid,
  trainingRoomParticipants,
  trainingTargetDurationMs,
});
