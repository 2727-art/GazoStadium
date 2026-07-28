"use strict";

const TRAINING_PROTOCOL_VERSION = 3;
const TRAINING_VARIANT = "kitaeai_hp_v3";
const V2_TRAINING_PROTOCOL_VERSION = 2;
const V2_TRAINING_VARIANT = "kitaeai_60_v2";
const LEGACY_TRAINING_PROTOCOL_VERSION = 1;
const LEGACY_TRAINING_VARIANT = "kitaeai_60";
const TRAINING_BASE_DURATION_MS = 60_000;
const TRAINING_TURN_DURATION_MS = TRAINING_BASE_DURATION_MS;
const TRAINING_MAX_TURNS = 6;
const TRAINING_START_HP = 30;
const TRAINING_MAX_ROUNDS = 5;
const TRAINING_IMAGE_COUNT = 5;
const TRAINING_COMMAND_COUNT = 3;
const TRAINING_COMMAND_BEATS_PER_REP = Object.freeze([2, 4, 8]);
const TRAINING_DAMAGE_BY_SCORE = Object.freeze({
  8: 10,
  9: 15,
  10: 20,
});
const TRAINING_DURATION_MS_BY_SCORE = Object.freeze({
  8: 60_000,
  9: 75_000,
  10: 90_000,
});
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
    hpSessions: boundedCount(source.hpSessions),
    hpWins: boundedCount(source.hpWins),
    hpLosses: boundedCount(source.hpLosses),
    hpDraws: boundedCount(source.hpDraws),
    hpNoContests: boundedCount(source.hpNoContests),
    hpRounds: boundedCount(source.hpRounds),
    hpDamageTaken: boundedCount(source.hpDamageTaken),
    hpScoreReceived: boundedCount(source.hpScoreReceived),
    hpHitsTaken: boundedCount(source.hpHitsTaken),
    hpPerfect10sReceived: boundedCount(source.hpPerfect10sReceived),
    hpCritical9sReceived: boundedCount(source.hpCritical9sReceived),
    hpCompletedWorkouts: boundedCount(source.hpCompletedWorkouts),
    hpCompletedSeconds: boundedCount(source.hpCompletedSeconds),
    hpOverkillDealt: boundedCount(source.hpOverkillDealt),
    hpUpdatedAt: boundedCount(source.hpUpdatedAt),
    updatedAt: boundedCount(source.updatedAt),
  };
}

function applyTrainingHpSession(
  profileValue,
  outcome,
  metricsValue = {},
  updatedAt = Date.now(),
) {
  if (!TRAINING_OUTCOMES.includes(outcome)) {
    throw new TypeError("Training HP outcome is invalid");
  }
  const profile = normalizeTrainingProfile(profileValue);
  const metrics = objectValue(metricsValue);
  const noContest = metrics.noContest === true;
  profile.hpSessions += 1;
  if (noContest) profile.hpNoContests += 1;
  else if (outcome === "win") profile.hpWins += 1;
  else if (outcome === "loss") profile.hpLosses += 1;
  else profile.hpDraws += 1;
  profile.hpRounds += boundedCount(metrics.rounds);
  profile.hpDamageTaken += boundedCount(metrics.damageTaken);
  profile.hpScoreReceived += boundedCount(metrics.scoreReceived);
  profile.hpHitsTaken += boundedCount(metrics.hitsTaken);
  profile.hpPerfect10sReceived += boundedCount(metrics.perfect10sReceived);
  profile.hpCritical9sReceived += boundedCount(metrics.critical9sReceived);
  profile.hpCompletedWorkouts += boundedCount(metrics.completedWorkouts);
  profile.hpCompletedSeconds += boundedCount(metrics.completedSeconds);
  profile.hpOverkillDealt += boundedCount(metrics.overkillDealt);
  profile.hpUpdatedAt = Math.floor(Number(updatedAt));
  profile.updatedAt = Math.floor(Number(updatedAt));
  return normalizeTrainingProfile(profile);
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

function normalizeTrainingCommandCard(value) {
  const source = objectValue(value);
  const beatsPerRep = source.beatsPerRep;
  if (!TRAINING_COMMAND_BEATS_PER_REP.includes(beatsPerRep)) {
    throw new TypeError("Training command beats per rep must be 2, 4, or 8");
  }
  return {
    exercise: normalizeBoundedText(source.exercise, 40, "Training exercise"),
    completion: normalizeBoundedText(source.completion, 60, "Training completion"),
    command: normalizeBoundedText(source.command, 120, "Training command"),
    beatsPerRep,
  };
}

function normalizeTrainingBpm(value) {
  const bpm = value;
  if (!Number.isInteger(bpm) || (bpm !== 0 && (bpm < 40 || bpm > 160))) {
    throw new TypeError("Training BPM must be 0 or an integer from 40 to 160");
  }
  return bpm;
}

function normalizeTrainingScore(value) {
  const score = value;
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new TypeError("Training score must be an integer from 1 to 10");
  }
  return score;
}

function trainingDamageForScore(value) {
  const score = normalizeTrainingScore(value);
  return TRAINING_DAMAGE_BY_SCORE[score] || 0;
}

function trainingDurationForScore(value) {
  const score = normalizeTrainingScore(value);
  return TRAINING_DURATION_MS_BY_SCORE[score] || 0;
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

function indexedObjectOrRtdbArray(value, label) {
  if (!Array.isArray(value)) {
    const source = objectValue(value);
    if (source !== value) {
      throw new TypeError(`${label} must be an object or RTDB sparse array`);
    }
    return source;
  }

  const keys = Object.keys(value);
  const expectedKeys = Array.from({ length: keys.length }, (_, index) => String(index + 1));
  const allowedOwnKeys = new Set(["length", ...expectedKeys]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    keys.length === 0
    || Object.hasOwn(value, "0")
    || value.length !== expectedKeys.length + 1
    || !sameIds([...keys].sort(), expectedKeys)
    || ownKeys.length !== allowedOwnKeys.size
    || ownKeys.some((key) => typeof key !== "string" || !allowedOwnKeys.has(key))
  ) {
    throw new TypeError(`${label} must be a contiguous RTDB sparse array starting at 1`);
  }
  return value;
}

function exactIndexedObject(value, count, label) {
  const source = indexedObjectOrRtdbArray(value, label);
  const expectedKeys = Array.from({ length: count }, (_, index) => String(index + 1));
  if (!sameIds(Object.keys(source).sort(), expectedKeys)) {
    throw new TypeError(`${label} must have exactly ${count} entries`);
  }
  return source;
}

function trainingRoomParticipants(room) {
  const legacy = room?.protocolVersion === LEGACY_TRAINING_PROTOCOL_VERSION
    && room?.variant === LEGACY_TRAINING_VARIANT;
  const v2 = room?.protocolVersion === V2_TRAINING_PROTOCOL_VERSION
    && room?.variant === V2_TRAINING_VARIANT;
  const current = room?.protocolVersion === TRAINING_PROTOCOL_VERSION
    && room?.variant === TRAINING_VARIANT;
  if (!legacy && !v2 && !current) {
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
  if ((legacy || v2) && !participants.includes(room?.firstTrainerUid)) {
    throw new TypeError("Training room first trainer is not a member");
  }
  if (v2) {
    const carrotChoices = objectValue(room?.carrotChoices);
    if (!sameIds(participants, Object.keys(carrotChoices).sort())) {
      throw new TypeError("Training carrot choices do not match members");
    }
    participants.forEach((uid) => normalizeTrainingCarrotChoice(carrotChoices[uid]));
  }
  if (current) {
    if (!sameIds(
      participants,
      [String(room?.hostUid || ""), String(room?.guestUid || "")].sort(),
    )) {
      throw new TypeError("Training room host and guest do not match members");
    }
    if (room?.firstTrainerUid != null
        || room?.carrotChoices != null
        || room?.turns != null
        || room?.continueVotes != null
        || room?.imageReceived != null) {
      throw new TypeError("Training protocol v3 contains legacy state");
    }
    for (const uid of participants) {
      const commandDeck = exactIndexedObject(
        players[uid]?.commandDeck,
        TRAINING_COMMAND_COUNT,
        "Training command deck",
      );
      Object.values(commandDeck).forEach((card) => normalizeTrainingCommandCard(
        exactObjectKeys(
          card,
          ["exercise", "completion", "command", "beatsPerRep"],
          "Training command card",
        ),
      ));
      const imageBpms = exactIndexedObject(
        players[uid]?.imageBpms,
        TRAINING_IMAGE_COUNT,
        "Training image BPM deck",
      );
      Object.values(imageBpms).forEach(normalizeTrainingBpm);
    }
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

function requireV3Timestamp(
  value,
  label,
  { minimum = 1, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (typeof value !== "number") {
    throw new TypeError(`${label} timestamp is invalid`);
  }
  return requireTimestamp(value, label, { minimum, maximum });
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

function memberSubset(value, participants, label) {
  if (value == null) return {};
  const source = objectValue(value);
  if (source !== value) throw new TypeError(`${label} must be an object`);
  if (Object.keys(source).some((uid) => !participants.includes(uid))) {
    throw new TypeError(`${label} has an outsider`);
  }
  return source;
}

function exactObjectKeys(value, expectedKeys, label) {
  const source = objectValue(value);
  if (source !== value || !sameIds(Object.keys(source).sort(), [...expectedKeys].sort())) {
    throw new TypeError(`${label} fields are invalid`);
  }
  return source;
}

function normalizedV3Rounds(room, participants, now, createdAt) {
  const source = room?.rounds == null
    ? {}
    : indexedObjectOrRtdbArray(room.rounds, "Training rounds");
  const keys = Object.keys(source);
  if (keys.some((key) => !/^[1-5]$/.test(key))) {
    throw new TypeError("Training round number is invalid");
  }
  const numbers = keys.map(Number).sort((first, second) => first - second);
  if (numbers.some((roundNumber, index) => roundNumber !== index + 1)) {
    throw new TypeError("Training rounds must be contiguous");
  }

  const usedImagesByUid = Object.fromEntries(participants.map((uid) => [uid, new Set()]));
  const usedCommandsByUid = Object.fromEntries(participants.map((uid) => [uid, new Set()]));
  const rounds = [];
  let previousCompletedAt = createdAt;
  for (const roundNumber of numbers) {
    const rawRound = objectValue(source[roundNumber]);
    if (rawRound !== source[roundNumber]) {
      throw new TypeError("Training round must be an object");
    }
    const sourceRound = exactObjectKeys(
      rawRound,
      [
        "createdAt",
        ...(Object.hasOwn(rawRound, "draws") ? ["draws"] : []),
        ...(Object.hasOwn(rawRound, "imageReceived") ? ["imageReceived"] : []),
        ...(Object.hasOwn(rawRound, "scores") ? ["scores"] : []),
        ...(Object.hasOwn(rawRound, "commandChoices") ? ["commandChoices"] : []),
        ...(Object.hasOwn(rawRound, "workouts") ? ["workouts"] : []),
        ...(Object.hasOwn(rawRound, "completedAt") ? ["completedAt"] : []),
      ],
      "Training round",
    );
    if (roundNumber > 1 && !rounds.at(-1)?.completedAt) {
      throw new TypeError("Training continued after an incomplete round");
    }
    const roundCreatedAt = requireV3Timestamp(
      sourceRound.createdAt,
      "Training round creation",
      { minimum: previousCompletedAt, maximum: now },
    );
    const drawsSource = memberSubset(sourceRound.draws, participants, "Training draws");
    const draws = {};
    for (const [ownerUid, drawValue] of Object.entries(drawsSource)) {
      const draw = exactObjectKeys(
        drawValue,
        ["imageIndex", "bpm", "drawnAt"],
        "Training draw",
      );
      const imageIndex = draw.imageIndex;
      if (!Number.isInteger(imageIndex)
          || imageIndex < 1
          || imageIndex > TRAINING_IMAGE_COUNT
          || usedImagesByUid[ownerUid].has(imageIndex)) {
        throw new TypeError("Training draw image is invalid or reused");
      }
      const bpm = normalizeTrainingBpm(draw.bpm);
      if (bpm !== room.players?.[ownerUid]?.imageBpms?.[imageIndex]) {
        throw new TypeError("Training draw BPM does not match its image");
      }
      const drawnAt = requireV3Timestamp(draw.drawnAt, "Training draw", {
        minimum: roundCreatedAt,
        maximum: now,
      });
      usedImagesByUid[ownerUid].add(imageIndex);
      draws[ownerUid] = { imageIndex, bpm, drawnAt };
    }

    const imageReceivedSource = memberSubset(
      sourceRound.imageReceived,
      participants,
      "Training image receipts",
    );
    const imageReceived = {};
    for (const [recipientUid, received] of Object.entries(imageReceivedSource)) {
      const opponentUid = participants.find((uid) => uid !== recipientUid);
      if (received !== true || !draws[opponentUid]) {
        throw new TypeError("Training image receipt is invalid");
      }
      imageReceived[recipientUid] = true;
    }

    const scoresSource = memberSubset(sourceRound.scores, participants, "Training scores");
    const scores = {};
    for (const [scorerUid, scoreValue] of Object.entries(scoresSource)) {
      if (Object.keys(draws).length !== participants.length
          || imageReceived[scorerUid] !== true) {
        throw new TypeError("Training score was submitted before its image");
      }
      scores[scorerUid] = normalizeTrainingScore(scoreValue);
    }

    const commandChoicesSource = memberSubset(
      sourceRound.commandChoices,
      participants,
      "Training command choices",
    );
    const commandChoices = {};
    for (const [traineeUid, choiceValue] of Object.entries(commandChoicesSource)) {
      const choice = exactObjectKeys(
        choiceValue,
        ["trainerUid", "cardIndex", "selectedAt"],
        "Training command choice",
      );
      const trainerUid = participants.find((uid) => uid !== traineeUid);
      const cardIndex = choice.cardIndex;
      if (Object.keys(scores).length !== participants.length
          || trainingDamageForScore(scores[traineeUid]) === 0
          || choice.trainerUid !== trainerUid
          || !Number.isInteger(cardIndex)
          || cardIndex < 1
          || cardIndex > TRAINING_COMMAND_COUNT
          || usedCommandsByUid[trainerUid].has(cardIndex)) {
        throw new TypeError("Training command choice is invalid or reused");
      }
      const minimumSelectedAt = Math.max(
        roundCreatedAt,
        ...Object.values(draws).map((draw) => draw.drawnAt),
      );
      const selectedAt = requireV3Timestamp(
        choice.selectedAt,
        "Training command selection",
        { minimum: minimumSelectedAt, maximum: now },
      );
      usedCommandsByUid[trainerUid].add(cardIndex);
      commandChoices[traineeUid] = { trainerUid, cardIndex, selectedAt };
    }

    const workoutsSource = memberSubset(
      sourceRound.workouts,
      participants,
      "Training workouts",
    );
    const workouts = {};
    for (const [traineeUid, workoutValue] of Object.entries(workoutsSource)) {
      const rawWorkout = objectValue(workoutValue);
      if (rawWorkout !== workoutValue) {
        throw new TypeError("Training workout must be an object");
      }
      const keysForWorkout = Object.hasOwn(rawWorkout, "completedAt")
        ? ["startedAt", "completedAt"]
        : ["startedAt"];
      const workout = exactObjectKeys(
        rawWorkout,
        keysForWorkout,
        "Training workout",
      );
      const choice = commandChoices[traineeUid];
      if (!choice) throw new TypeError("Training workout has no command choice");
      const startedAt = requireV3Timestamp(workout.startedAt, "Training workout start", {
        minimum: choice.selectedAt,
        maximum: now,
      });
      const durationMs = trainingDurationForScore(scores[traineeUid]);
      const completedAt = Object.hasOwn(workout, "completedAt")
        ? requireV3Timestamp(workout.completedAt, "Training workout completion", {
          minimum: startedAt + durationMs,
          maximum: Math.min(now, startedAt + durationMs),
        })
        : 0;
      workouts[traineeUid] = {
        startedAt,
        completedAt,
        durationMs,
        trainerUid: choice.trainerUid,
        cardIndex: choice.cardIndex,
        bpm: draws[choice.trainerUid].bpm,
      };
    }

    const allScoresSubmitted = participants.every((uid) => Number.isInteger(scores[uid]));
    const hitUids = allScoresSubmitted
      ? participants.filter((uid) => trainingDamageForScore(scores[uid]) > 0)
      : [];
    if (Object.keys(commandChoices).some((uid) => !hitUids.includes(uid))
        || Object.keys(workouts).some((uid) => !hitUids.includes(uid))) {
      throw new TypeError("Training round has an unexpected hit action");
    }
    const readyToComplete = allScoresSubmitted && hitUids.every((uid) => (
      commandChoices[uid] && workouts[uid]?.completedAt > 0
    ));
    const evidenceAt = Math.max(
      roundCreatedAt,
      ...Object.values(draws).map((draw) => draw.drawnAt),
      ...Object.values(commandChoices).map((choice) => choice.selectedAt),
      ...Object.values(workouts).map((workout) => workout.completedAt || workout.startedAt),
    );
    const completedAt = Object.hasOwn(sourceRound, "completedAt")
      ? requireV3Timestamp(sourceRound.completedAt, "Training round completion", {
        minimum: evidenceAt,
        maximum: now,
      })
      : 0;
    if (completedAt && !readyToComplete) {
      throw new TypeError("Training round completed before all hit workouts");
    }
    rounds.push({
      roundNumber,
      createdAt: roundCreatedAt,
      draws,
      imageReceived,
      scores,
      commandChoices,
      workouts,
      hitUids,
      readyToComplete,
      completedAt,
    });
    if (completedAt) previousCompletedAt = completedAt;
  }
  return rounds;
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

function emptyV3Metrics(participants) {
  return {
    hpByUid: Object.fromEntries(participants.map((uid) => [uid, TRAINING_START_HP])),
    damageReceivedByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    scoreTotalByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    score10CountByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    score9CountByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    hitsReceivedByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedWorkoutsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    workoutSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    overkillByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedSetsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedAtByUid: Object.fromEntries(participants.map((uid) => [uid, []])),
    completedSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    completedSetSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, []])),
    boostCompletedSetsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
    boostSecondsByUid: Object.fromEntries(participants.map((uid) => [uid, 0])),
  };
}

function normalizeV3Surrender(room, participants, now, createdAt) {
  if (room?.surrendered == null) return null;
  const surrendered = exactObjectKeys(
    room.surrendered,
    ["uid", "at"],
    "Training surrender",
  );
  const uid = String(surrendered.uid || "");
  if (!participants.includes(uid)) {
    throw new TypeError("Training surrender has an outsider");
  }
  return {
    uid,
    at: requireV3Timestamp(surrendered.at, "Training surrender", {
      minimum: createdAt,
      maximum: now,
    }),
  };
}

function v3MetricWinner(participants, metrics) {
  const [firstUid, secondUid] = participants;
  const comparisons = [
    metrics.hpByUid[firstUid] - metrics.hpByUid[secondUid],
    metrics.scoreTotalByUid[firstUid] - metrics.scoreTotalByUid[secondUid],
    metrics.score10CountByUid[firstUid] - metrics.score10CountByUid[secondUid],
    metrics.score9CountByUid[firstUid] - metrics.score9CountByUid[secondUid],
  ];
  const decision = comparisons.find((comparison) => comparison !== 0) || 0;
  if (decision === 0) return "";
  return decision > 0 ? firstUid : secondUid;
}

function v3Result({
  participants,
  metrics,
  status,
  reason,
  roundCount,
  winnerUid = "",
  noContest = false,
  retryAfterMs = 0,
}) {
  const loserUid = winnerUid
    ? participants.find((uid) => uid !== winnerUid)
    : "";
  const outcomes = status === "final"
    ? Object.fromEntries(participants.map((uid) => [
      uid,
      winnerUid ? (uid === winnerUid ? "win" : "loss") : "draw",
    ]))
    : {};
  const finisherOverkill = winnerUid && loserUid
    ? metrics.overkillByUid[loserUid]
    : 0;
  return {
    status,
    reason,
    participants,
    outcomes,
    ...metrics,
    roundCount,
    // Kept as a compatibility alias while Functions/index transitions from V2 turns.
    turnCount: roundCount,
    noContest,
    finisher: {
      eligible: status === "final"
        && !noContest
        && reason !== "surrender"
        && finisherOverkill > 0,
      winnerUid: winnerUid || "",
      loserUid: loserUid || "",
      overkill: finisherOverkill,
    },
    retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)),
  };
}

function deriveV3TrainingRoomResult(room, participants, rounds, timestamp, createdAt) {
  if (room?.continueVotes != null
      || room?.turns != null
      || room?.carrotChoices != null
      || room?.imageReceived != null) {
    throw new TypeError("Training protocol v3 contains legacy match state");
  }
  const surrender = normalizeV3Surrender(room, participants, timestamp, createdAt);
  const healthStop = room?.destroyed?.reason === "health_stop";
  const healthStoppedAt = healthStop
    ? requireV3Timestamp(room.destroyed?.at, "Training health stop", {
      minimum: createdAt,
      maximum: timestamp,
    })
    : 0;
  if (healthStop && !participants.includes(room.destroyed?.by)) {
    throw new TypeError("Training health stop has an outsider");
  }
  const metrics = emptyV3Metrics(participants);
  let roundCount = 0;
  let naturalReason = "";
  let naturalWinnerUid = "";
  let terminalEvidenceAt = 0;
  let latestEvidenceAt = createdAt;

  for (const round of rounds) {
    if (naturalReason) {
      throw new TypeError("Training continued after its HP result");
    }
    for (const [scorerUid, score] of Object.entries(round.scores)) {
      const imageOwnerUid = participants.find((uid) => uid !== scorerUid);
      const damage = trainingDamageForScore(score);
      const hpBefore = metrics.hpByUid[scorerUid];
      metrics.scoreTotalByUid[imageOwnerUid] += score;
      if (score === 10) metrics.score10CountByUid[imageOwnerUid] += 1;
      if (score === 9) metrics.score9CountByUid[imageOwnerUid] += 1;
      metrics.damageReceivedByUid[scorerUid] += damage;
      if (damage > 0) metrics.hitsReceivedByUid[scorerUid] += 1;
      metrics.overkillByUid[scorerUid] += Math.max(0, damage - hpBefore);
      metrics.hpByUid[scorerUid] = Math.max(0, hpBefore - damage);
    }
    for (const [traineeUid, workout] of Object.entries(round.workouts)) {
      if (!workout.completedAt) continue;
      metrics.completedWorkoutsByUid[traineeUid] += 1;
      metrics.workoutSecondsByUid[traineeUid] += workout.durationMs / 1_000;
    }
    latestEvidenceAt = Math.max(
      latestEvidenceAt,
      round.createdAt,
      ...Object.values(round.draws).map((draw) => draw.drawnAt),
      ...Object.values(round.commandChoices).map((choice) => choice.selectedAt),
      ...Object.values(round.workouts).map((workout) => (
        workout.completedAt || workout.startedAt
      )),
      round.completedAt || 0,
    );
    if (!round.completedAt) continue;
    roundCount += 1;
    terminalEvidenceAt = round.completedAt;
    const hpExhausted = participants.some((uid) => metrics.hpByUid[uid] === 0);
    if (hpExhausted || roundCount === TRAINING_MAX_ROUNDS) {
      naturalReason = hpExhausted ? "hp_zero" : "round_limit";
      naturalWinnerUid = v3MetricWinner(participants, metrics);
    }
  }

  if (naturalReason) {
    if (surrender && surrender.at < terminalEvidenceAt) {
      throw new TypeError("Training result evidence occurred after surrender");
    }
    if (healthStop && healthStoppedAt < terminalEvidenceAt) {
      throw new TypeError("Training result evidence occurred after health stop");
    }
    if (room?.destroyed != null && !healthStop) {
      const destroyedAt = requireV3Timestamp(room.destroyed?.at, "Training destruction", {
        maximum: timestamp,
      });
      if (terminalEvidenceAt > destroyedAt + TRAINING_DESTROYED_CLOCK_SKEW_MS) {
        throw new TypeError("Training result evidence occurred after room destruction");
      }
    }
    return v3Result({
      participants,
      metrics,
      status: "final",
      reason: naturalReason,
      roundCount,
      winnerUid: naturalWinnerUid,
    });
  }

  if (surrender && healthStop) {
    throw new TypeError("Training room has multiple terminal states");
  }

  if (surrender) {
    if (latestEvidenceAt > surrender.at + TRAINING_DESTROYED_CLOCK_SKEW_MS) {
      throw new TypeError("Training evidence occurred after surrender");
    }
    const winnerUid = participants.find((uid) => uid !== surrender.uid);
    return v3Result({
      participants,
      metrics,
      status: "final",
      reason: "surrender",
      roundCount,
      winnerUid,
    });
  }

  if (healthStop) {
    if (latestEvidenceAt > healthStoppedAt + TRAINING_DESTROYED_CLOCK_SKEW_MS) {
      throw new TypeError("Training evidence occurred after health stop");
    }
    return v3Result({
      participants,
      metrics,
      status: "final",
      reason: "health_stop",
      roundCount,
      noContest: true,
    });
  }

  const currentWorkoutDeadline = rounds.at(-1)
    ? Math.max(
      0,
      ...Object.values(rounds.at(-1).workouts)
        .filter((workout) => !workout.completedAt)
        .map((workout) => workout.startedAt + workout.durationMs),
    )
    : 0;
  return v3Result({
    participants,
    metrics,
    status: "pending",
    reason: "pending",
    roundCount,
    retryAfterMs: Math.max(0, currentWorkoutDeadline - timestamp),
  });
}

function deriveTrainingRoomResult(room, now = Date.now()) {
  const timestamp = requireTimestamp(now, "Training current");
  const participants = trainingRoomParticipants(room);
  const createdAt = requireTimestamp(room?.createdAt, "Training room creation", {
    maximum: timestamp,
  });
  const legacy = room?.protocolVersion === LEGACY_TRAINING_PROTOCOL_VERSION;
  const v2 = room?.protocolVersion === V2_TRAINING_PROTOCOL_VERSION;
  let result;
  if (legacy) {
    const turns = normalizedLegacyTurns(room, participants, timestamp, createdAt);
    result = deriveLegacyTrainingRoomResult(room, participants, turns, timestamp);
  } else if (v2) {
    const turns = normalizedV2Turns(room, participants, timestamp, createdAt);
    result = deriveV2TrainingRoomResult(room, participants, turns, timestamp);
  } else {
    const rounds = normalizedV3Rounds(room, participants, timestamp, createdAt);
    result = deriveV3TrainingRoomResult(
      room,
      participants,
      rounds,
      timestamp,
      createdAt,
    );
  }
  return {
    ...result,
    protocolVersion: legacy
      ? LEGACY_TRAINING_PROTOCOL_VERSION
      : v2
        ? V2_TRAINING_PROTOCOL_VERSION
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
  V2_TRAINING_PROTOCOL_VERSION,
  V2_TRAINING_VARIANT,
  TRAINING_BASE_DURATION_MS,
  TRAINING_CARROT_CHOICES,
  TRAINING_COMMAND_BEATS_PER_REP,
  TRAINING_COMMAND_COUNT,
  TRAINING_CONTINUE_VOTES,
  TRAINING_DAMAGE_BY_SCORE,
  TRAINING_DESTROYED_CLOCK_SKEW_MS,
  TRAINING_DURATION_MS_BY_SCORE,
  TRAINING_IMAGE_COUNT,
  TRAINING_MAX_ROUNDS,
  TRAINING_MAX_TURNS,
  TRAINING_OUTCOMES,
  TRAINING_PROTOCOL_VERSION,
  TRAINING_ROOM_MAX_AGE_MS,
  TRAINING_START_HP,
  TRAINING_TURN_DURATION_MS,
  TRAINING_TARGET_DURATION_MS,
  TRAINING_VARIANT,
  applyTrainingHpSession,
  applyTrainingSession,
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
  jstDateKey,
  normalizeTrainingBpm,
  normalizeTrainingCommandCard,
  normalizeTrainingInstruction,
  normalizeTrainingCarrotChoice,
  normalizeTrainingProfile,
  normalizeTrainingScore,
  previousJstDateKey,
  trainingDailySettlement,
  trainingDamageForScore,
  trainingDurationForScore,
  trainingImageOwnerUid,
  trainingRoomParticipants,
  trainingTargetDurationMs,
});
