export const TRAINING_PROTOCOL_VERSION = 3;
export const TRAINING_VARIANT = "kitaeai_hp_v3";
export const V2_TRAINING_PROTOCOL_VERSION = 2;
export const V2_TRAINING_VARIANT = "kitaeai_60_v2";
export const TRAINING_PLAYER_COUNT = 2;
export const TRAINING_MAX_TURNS = 6;
export const TRAINING_START_HP = 30;
export const TRAINING_MAX_ROUNDS = 5;
export const TRAINING_IMAGE_COUNT = 5;
export const TRAINING_COMMAND_COUNT = 3;
export const TRAINING_BASE_DURATION_MS = 60_000;
export const TRAINING_TURN_DURATION_MS = TRAINING_BASE_DURATION_MS;
export const TRAINING_CARROT_CHOICES = Object.freeze([
  "mine",
  "boost8",
  "boost9",
  "boost10",
]);
export const TRAINING_TARGET_DURATION_MS = Object.freeze({
  mine: TRAINING_BASE_DURATION_MS,
  boost8: 70_000,
  boost9: 80_000,
  boost10: 90_000,
});
export const TRAINING_DAMAGE_BY_SCORE = Object.freeze({
  8: 10,
  9: 15,
  10: 20,
});
export const TRAINING_DURATION_MS_BY_SCORE = Object.freeze({
  8: 60_000,
  9: 75_000,
  10: 90_000,
});
export const TRAINING_QUEUE_FRESH_MS = 45_000;
export const TRAINING_ACTIVE_PRESENCE_GRACE_MS = 90_000;
export const TRAINING_FORMING_PRESENCE_GRACE_MS = 45_000;
export const TRAINING_INTENSITIES = Object.freeze(["light", "standard", "strong"]);
export const TRAINING_BEATS_PER_REP = Object.freeze([1, 2, 4]);
export const TRAINING_COMMAND_BEATS_PER_REP = Object.freeze([2, 4, 8]);

export const TRAINING_LIMITS = Object.freeze({
  name: 16,
  conditions: 80,
  sessionId: 64,
  exercise: 40,
  completion: 60,
  command: 120,
});

function truncateText(value, maximum) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function finiteTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function trainingActiveRoomsForUid(activeUsers, uid) {
  const rooms = activeUsers?.[uid]?.rooms;
  return rooms && typeof rooms === "object" ? rooms : {};
}

export function normalizeTrainingName(value) {
  return truncateText(value, TRAINING_LIMITS.name);
}

export function normalizeTrainingConditions(value) {
  return truncateText(value, TRAINING_LIMITS.conditions);
}

export function normalizeTrainingIntensity(value) {
  return TRAINING_INTENSITIES.includes(value) ? value : "standard";
}

export function normalizeTrainingCarrotChoice(value) {
  return TRAINING_CARROT_CHOICES.includes(value) ? value : "";
}

export function trainingTargetDurationMs(value) {
  return TRAINING_TARGET_DURATION_MS[normalizeTrainingCarrotChoice(value)] || 0;
}

export function trainingImageOwnerUid(choice, traineeUid, trainerUid) {
  const normalized = normalizeTrainingCarrotChoice(choice);
  if (!normalized) return "";
  return normalized === "mine" ? String(traineeUid || "") : String(trainerUid || "");
}

export function normalizeTrainingSessionId(value) {
  const sessionId = String(value || "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(sessionId) ? sessionId : "";
}

export function createTrainingAcceptanceUpdates(uid, conditions) {
  const playerUid = String(uid || "");
  if (!playerUid) return {};
  const acceptedPath = `accepted/${playerUid}`;
  const ownConditions = normalizeTrainingConditions(conditions);
  if (!ownConditions) return { [acceptedPath]: true };
  return {
    [`players/${playerUid}/conditions`]: ownConditions,
    [acceptedPath]: true,
  };
}

export function normalizeTrainingBpm(value) {
  const bpm = Number(value);
  return Number.isInteger(bpm) && bpm >= 40 && bpm <= 160 ? bpm : 0;
}

export function normalizeTrainingBeatsPerRep(value) {
  const beats = Number(value);
  return TRAINING_BEATS_PER_REP.includes(beats) ? beats : 1;
}

export function normalizeTrainingCommandBeatsPerRep(value) {
  const beats = Number(value);
  return TRAINING_COMMAND_BEATS_PER_REP.includes(beats) ? beats : 2;
}

export function normalizeTrainingInstruction(value = {}) {
  return {
    exercise: truncateText(value.exercise, TRAINING_LIMITS.exercise),
    completion: truncateText(value.completion, TRAINING_LIMITS.completion),
    command: truncateText(value.command, TRAINING_LIMITS.command),
    bpm: normalizeTrainingBpm(value.bpm),
    beatsPerRep: normalizeTrainingBeatsPerRep(value.beatsPerRep),
  };
}

export function trainingInstructionIsReady(value) {
  const instruction = normalizeTrainingInstruction(value);
  return Boolean(
    instruction.exercise
    && instruction.completion
    && instruction.command
  );
}

export function normalizeTrainingCommandCard(value = {}) {
  return {
    exercise: truncateText(value.exercise, TRAINING_LIMITS.exercise),
    completion: truncateText(value.completion, TRAINING_LIMITS.completion),
    command: truncateText(value.command, TRAINING_LIMITS.command),
    beatsPerRep: normalizeTrainingCommandBeatsPerRep(value.beatsPerRep),
  };
}

export function trainingCommandCardIsReady(value) {
  const command = normalizeTrainingCommandCard(value);
  return Boolean(command.exercise && command.completion && command.command);
}

export function normalizeTrainingScore(value) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 10 ? score : 0;
}

export function trainingDamageForScore(value) {
  return TRAINING_DAMAGE_BY_SCORE[normalizeTrainingScore(value)] || 0;
}

export function trainingDurationForScore(value) {
  return TRAINING_DURATION_MS_BY_SCORE[normalizeTrainingScore(value)] || 0;
}

export function normalizeTrainingCommandDeck(value) {
  const source = value && typeof value === "object" ? value : {};
  const expectedKeys = Array.from(
    { length: TRAINING_COMMAND_COUNT },
    (_, index) => String(index + 1),
  );
  if (Object.keys(source).sort().join(",") !== expectedKeys.join(",")) return {};
  const normalized = {};
  for (let index = 1; index <= TRAINING_COMMAND_COUNT; index += 1) {
    const raw = source[index] ?? source[String(index)];
    if (!raw
        || typeof raw !== "object"
        || !TRAINING_COMMAND_BEATS_PER_REP.includes(Number(raw.beatsPerRep))) {
      return {};
    }
    const card = normalizeTrainingCommandCard(raw);
    if (!trainingCommandCardIsReady(card)) return {};
    normalized[index] = card;
  }
  return normalized;
}

export function normalizeTrainingImageBpms(value) {
  const source = value && typeof value === "object" ? value : {};
  const expectedKeys = Array.from(
    { length: TRAINING_IMAGE_COUNT },
    (_, index) => String(index + 1),
  );
  if (Object.keys(source).sort().join(",") !== expectedKeys.join(",")) return {};
  const normalized = {};
  for (let index = 1; index <= TRAINING_IMAGE_COUNT; index += 1) {
    const raw = source[index] ?? source[String(index)];
    if (typeof raw !== "number" || !Number.isInteger(raw)) return {};
    const bpm = normalizeTrainingBpm(raw);
    if (raw !== bpm) return {};
    normalized[index] = bpm;
  }
  return normalized;
}

export function validTrainingQueueEntries(queue, {
  now = Date.now(),
  freshnessMs = TRAINING_QUEUE_FRESH_MS,
  activeUsers = {},
} = {}) {
  const currentTime = finiteTimestamp(now);
  const freshness = Math.max(1, Number(freshnessMs) || TRAINING_QUEUE_FRESH_MS);
  return Object.values(queue || {})
    .filter((entry) => (
      entry
      && typeof entry.uid === "string"
      && entry.uid.length > 0
      && normalizeTrainingSessionId(entry.sessionId)
      && normalizeTrainingName(entry.name)
      && entry.protocolVersion === TRAINING_PROTOCOL_VERSION
      && entry.variant === TRAINING_VARIANT
      && entry.state === "waiting"
      && Object.keys(normalizeTrainingCommandDeck(entry.commandDeck)).length
        === TRAINING_COMMAND_COUNT
      && Object.keys(normalizeTrainingImageBpms(entry.imageBpms)).length
        === TRAINING_IMAGE_COUNT
      && finiteTimestamp(entry.joinedAt) > 0
      && finiteTimestamp(entry.lastSeen) >= currentTime - freshness
      && !Object.values(trainingActiveRoomsForUid(activeUsers, entry.uid))
        .some((claimed) => claimed === true)
    ))
    .map((entry) => ({
      uid: entry.uid,
      sessionId: normalizeTrainingSessionId(entry.sessionId),
      name: normalizeTrainingName(entry.name),
      intensity: normalizeTrainingIntensity(entry.intensity),
      commandDeck: normalizeTrainingCommandDeck(entry.commandDeck),
      imageBpms: normalizeTrainingImageBpms(entry.imageBpms),
      protocolVersion: TRAINING_PROTOCOL_VERSION,
      variant: TRAINING_VARIANT,
      joinedAt: finiteTimestamp(entry.joinedAt),
      lastSeen: finiteTimestamp(entry.lastSeen),
      state: "waiting",
    }))
    .sort((first, second) => (
      first.joinedAt - second.joinedAt
      || first.uid.localeCompare(second.uid)
    ));
}

export function trainingQueueEntryKey(entry) {
  const uid = typeof entry?.uid === "string" ? entry.uid : "";
  const sessionId = normalizeTrainingSessionId(entry?.sessionId);
  return uid && sessionId ? `${uid}/${sessionId}` : "";
}

export function selectTrainingPair(entries, {
  requesterUid = "",
  excludedEntryKeys = [],
  allowHostTakeover = false,
} = {}) {
  const source = Array.isArray(entries) ? entries : [];
  const requester = typeof requesterUid === "string" ? requesterUid : "";
  const excluded = new Set(
    Array.from(excludedEntryKeys || []).filter((key) => typeof key === "string" && key),
  );
  const available = source.filter((entry) => (
    entry?.uid === requester || !excluded.has(trainingQueueEntryKey(entry))
  ));
  if (!requester) {
    return available.length >= TRAINING_PLAYER_COUNT
      ? available.slice(0, TRAINING_PLAYER_COUNT)
      : [];
  }
  for (let index = 0; index < available.length; index += TRAINING_PLAYER_COUNT) {
    const pair = available.slice(index, index + TRAINING_PLAYER_COUNT);
    if (pair.some((entry) => entry?.uid === requester)) {
      if (pair.length !== TRAINING_PLAYER_COUNT) return [];
      if (pair[0]?.uid === requester) return pair;
      return allowHostTakeover && pair[1]?.uid === requester
        ? [pair[1], pair[0]]
        : [];
    }
  }
  return [];
}

export function trainingActiveRoomAppearsLive(room, uid, now = Date.now()) {
  if (!room
    || room.members?.[uid] !== true
    || room.destroyed
    || room.serverFinalized
    || !["forming", "active"].includes(room.status)) return false;
  const ownPresence = room.presence?.[uid];
  if (ownPresence && typeof ownPresence === "object") {
    return ownPresence.online === true;
  }
  const createdAt = finiteTimestamp(room.createdAt);
  const currentTime = finiteTimestamp(now);
  const graceMs = room.status === "active"
    ? TRAINING_ACTIVE_PRESENCE_GRACE_MS
    : TRAINING_FORMING_PRESENCE_GRACE_MS;
  return createdAt > 0
    && createdAt <= currentTime + 15_000
    && createdAt >= currentTime - graceMs;
}

export function trainingServerFinalizedResult(serverFinalized, uid) {
  const version = Number(serverFinalized?.version);
  if (![V2_TRAINING_PROTOCOL_VERSION, TRAINING_PROTOCOL_VERSION].includes(version)) {
    return null;
  }
  const ownOutcome = serverFinalized.outcomes?.[uid];
  if (!["win", "loss", "draw"].includes(ownOutcome)) return null;
  const outcomes = serverFinalized.outcomes || {};
  if (version === TRAINING_PROTOCOL_VERSION) {
    const roundIndex = Number(serverFinalized.roundCount);
    if (!Number.isSafeInteger(roundIndex)
        || roundIndex < 0
        || roundIndex > TRAINING_MAX_ROUNDS) {
      return null;
    }
    return {
      roundIndex,
      hpByUid: serverFinalized.hpByUid || {},
      ownHp: Math.max(0, Number(serverFinalized.hpByUid?.[uid]) || 0),
      damageReceivedByUid: serverFinalized.damageReceivedByUid || {},
      scoreTotalByUid: serverFinalized.scoreTotalByUid || {},
      score10CountByUid: serverFinalized.score10CountByUid || {},
      score9CountByUid: serverFinalized.score9CountByUid || {},
      completedWorkoutsByUid: serverFinalized.completedWorkoutsByUid || {},
      workoutSecondsByUid: serverFinalized.workoutSecondsByUid || {},
      overkillByUid: serverFinalized.overkillByUid || {},
      result: {
        type: ownOutcome === "draw" ? "draw" : ownOutcome,
        winnerUid: Object.keys(outcomes)
          .find((memberUid) => outcomes[memberUid] === "win") || "",
        loserUid: Object.keys(outcomes)
          .find((memberUid) => outcomes[memberUid] === "loss") || "",
        reason: String(serverFinalized.reason || "round_limit"),
        noContest: serverFinalized.noContest === true,
        finisher: serverFinalized.finisher || {
          eligible: false,
          winnerUid: "",
          loserUid: "",
          overkill: 0,
        },
      },
    };
  }
  const completedSetsByUid = serverFinalized.completedSetsByUid || {};
  const turnIndex = Number(serverFinalized.turnCount);
  if (!Number.isSafeInteger(turnIndex) || turnIndex < 1 || turnIndex > TRAINING_MAX_TURNS) {
    return null;
  }
  return {
    turnIndex,
    completedSets: Object.values(completedSetsByUid)
      .reduce((total, value) => total + Math.max(0, Number(value) || 0), 0),
    ownCompletedSets: Math.max(0, Number(completedSetsByUid[uid]) || 0),
    completedSeconds: Object.values(serverFinalized.completedSecondsByUid || {})
      .reduce((total, value) => total + Math.max(0, Number(value) || 0), 0),
    ownCompletedSeconds: Math.max(
      0,
      Number(serverFinalized.completedSecondsByUid?.[uid]) || 0,
    ),
    ownBoostCompletedSets: Math.max(
      0,
      Number(serverFinalized.boostCompletedSetsByUid?.[uid]) || 0,
    ),
    result: {
      type: ownOutcome === "draw" ? "mutual_complete" : ownOutcome,
      winnerUid: Object.keys(outcomes).find((memberUid) => outcomes[memberUid] === "win") || "",
      loserUid: Object.keys(outcomes).find((memberUid) => outcomes[memberUid] === "loss") || "",
      reason: String(serverFinalized.reason || "mutual_complete"),
    },
  };
}

export function trainingTurnStatus(turn, now = Date.now()) {
  if (!turn || !trainingInstructionIsReady(turn.instruction)) return "missing";
  if (finiteTimestamp(turn.surrenderedAt) > 0) return "surrendered";
  if (finiteTimestamp(turn.timedOutAt) > 0) return "timed_out";
  if (finiteTimestamp(turn.completedAt) > 0) return "completed";
  const startedAt = finiteTimestamp(turn.startedAt);
  if (!startedAt) return "ready";
  const targetDurationMs = trainingTargetDurationMs(turn.carrotChoice);
  if (!targetDurationMs) return "missing";
  const currentTime = finiteTimestamp(now);
  if (finiteTimestamp(turn.baseCompletedAt) > 0) {
    return currentTime >= startedAt + targetDurationMs
      ? "boost_expired"
      : "boost_active";
  }
  return currentTime >= startedAt + TRAINING_BASE_DURATION_MS
    ? "base_expired"
    : "active";
}

export function orderedTrainingTurns(turns) {
  const source = turns || {};
  const ordered = [];
  for (let index = 1; index <= TRAINING_MAX_TURNS; index += 1) {
    const turn = source[index] ?? source[String(index)];
    if (!turn) break;
    ordered.push({ ...turn, index });
  }
  return ordered;
}

export function completedTrainingSets(turns, uid = "") {
  const completed = orderedTrainingTurns(turns)
    .filter((turn) => finiteTimestamp(turn.baseCompletedAt) > 0);
  if (!uid) return completed.length;
  return completed.filter((turn) => turn.traineeUid === uid).length;
}

function memberUids(room) {
  return Object.entries(room?.members || {})
    .filter(([, included]) => included === true)
    .map(([uid]) => uid)
    .sort();
}

export function continueVotePairForTurn(turnIndex) {
  return 0;
}

function deriveV2TrainingRoomState(room, uid, now = Date.now()) {
  const members = memberUids(room);
  const opponentUid = members.find((memberUid) => memberUid !== uid) || "";
  const base = {
    phase: "waiting_images",
    turnIndex: 0,
    turn: null,
    trainerUid: "",
    traineeUid: "",
    opponentUid,
    pair: 0,
    result: null,
    completedSets: completedTrainingSets(room?.turns),
    ownCompletedSets: completedTrainingSets(room?.turns, uid),
  };

  if (!uid || members.length !== TRAINING_PLAYER_COUNT || !members.includes(uid)) {
    return { ...base, phase: "invalid" };
  }
  if (room?.destroyed) return { ...base, phase: "destroyed" };
  if (room?.status !== "active") return { ...base, phase: "forming" };
  if (!members.every((memberUid) => room?.imageReceived?.[memberUid] === true)) return base;
  if (!members.every((memberUid) => (
    normalizeTrainingCarrotChoice(room?.carrotChoices?.[memberUid])
  ))) {
    return { ...base, phase: "waiting_carrot_choices" };
  }

  const turns = orderedTrainingTurns(room?.turns);
  const last = turns.at(-1);
  if (!last) {
    return {
      ...base,
      phase: uid === room.firstTrainerUid ? "compose" : "waiting_instruction",
      turnIndex: 1,
      trainerUid: room.firstTrainerUid,
      traineeUid: opponentUid === room.firstTrainerUid ? uid : opponentUid,
    };
  }

  const status = trainingTurnStatus(last, now);
  const current = {
    ...base,
    turnIndex: last.index,
    turn: last,
    trainerUid: String(last.trainerUid || ""),
    traineeUid: String(last.traineeUid || ""),
  };
  if (status === "surrendered" || status === "timed_out") {
    const reason = status === "surrendered" ? "surrender" : "timeout";
    return {
      ...current,
      phase: "result",
      result: {
        type: last.trainerUid === uid ? "win" : "loss",
        winnerUid: last.trainerUid,
        loserUid: last.traineeUid,
        reason,
      },
    };
  }
  if (status === "ready") return { ...current, phase: "ready" };
  if (["active", "base_expired", "boost_active", "boost_expired"].includes(status)) {
    return { ...current, phase: status };
  }
  if (status !== "completed") return { ...current, phase: "waiting_instruction" };

  if (last.index >= TRAINING_MAX_TURNS) {
    return {
      ...current,
      phase: "result",
      result: {
        type: "mutual_complete",
        winnerUid: "",
        loserUid: "",
        reason: "mutual_complete",
      },
    };
  }

  const nextTrainerUid = last.traineeUid;
  const nextTraineeUid = last.trainerUid;
  return {
    ...current,
    phase: uid === nextTrainerUid ? "compose" : "waiting_instruction",
    turnIndex: last.index + 1,
    turn: null,
    trainerUid: nextTrainerUid,
    traineeUid: nextTraineeUid,
    pair: Math.ceil((last.index + 1) / 2),
  };
}

export function orderedTrainingRounds(rounds) {
  const source = rounds || {};
  const ordered = [];
  for (let index = 1; index <= TRAINING_MAX_ROUNDS; index += 1) {
    const round = source[index] ?? source[String(index)];
    if (!round) break;
    ordered.push({ ...round, index });
  }
  return ordered;
}

function hpMetricsForRounds(rounds, members) {
  const hpByUid = Object.fromEntries(members.map((memberUid) => [
    memberUid,
    TRAINING_START_HP,
  ]));
  const damageReceivedByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const scoreTotalByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const score10CountByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const score9CountByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const overkillByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const completedWorkoutsByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  const workoutSecondsByUid = Object.fromEntries(members.map((memberUid) => [memberUid, 0]));
  for (const round of rounds) {
    for (const scorerUid of members) {
      const score = normalizeTrainingScore(round?.scores?.[scorerUid]);
      if (!score) continue;
      const imageOwnerUid = members.find((memberUid) => memberUid !== scorerUid);
      const damage = trainingDamageForScore(score);
      const hpBefore = hpByUid[scorerUid];
      scoreTotalByUid[imageOwnerUid] += score;
      if (score === 10) score10CountByUid[imageOwnerUid] += 1;
      if (score === 9) score9CountByUid[imageOwnerUid] += 1;
      damageReceivedByUid[scorerUid] += damage;
      overkillByUid[scorerUid] += Math.max(0, damage - hpBefore);
      hpByUid[scorerUid] = Math.max(0, hpBefore - damage);
      const workout = round?.workouts?.[scorerUid];
      if (finiteTimestamp(workout?.completedAt) > 0) {
        completedWorkoutsByUid[scorerUid] += 1;
        workoutSecondsByUid[scorerUid] += trainingDurationForScore(score) / 1_000;
      }
    }
  }
  return {
    hpByUid,
    damageReceivedByUid,
    scoreTotalByUid,
    score10CountByUid,
    score9CountByUid,
    completedWorkoutsByUid,
    workoutSecondsByUid,
    overkillByUid,
  };
}

function hpMetricWinner(members, metrics) {
  const [firstUid, secondUid] = members;
  const comparisons = [
    metrics.hpByUid[firstUid] - metrics.hpByUid[secondUid],
    metrics.scoreTotalByUid[firstUid] - metrics.scoreTotalByUid[secondUid],
    metrics.score10CountByUid[firstUid] - metrics.score10CountByUid[secondUid],
    metrics.score9CountByUid[firstUid] - metrics.score9CountByUid[secondUid],
  ];
  const decision = comparisons.find((comparison) => comparison !== 0) || 0;
  return decision === 0 ? "" : decision > 0 ? firstUid : secondUid;
}

function hpResult(uid, members, metrics, reason, winnerUid = "", noContest = false) {
  const loserUid = winnerUid
    ? members.find((memberUid) => memberUid !== winnerUid)
    : "";
  const overkill = loserUid ? metrics.overkillByUid[loserUid] : 0;
  return {
    type: winnerUid ? (uid === winnerUid ? "win" : "loss") : "draw",
    winnerUid,
    loserUid,
    reason,
    noContest,
    finisher: {
      eligible: !noContest && reason !== "surrender" && overkill > 0,
      winnerUid,
      loserUid,
      overkill,
    },
  };
}

function emptyHpActions() {
  return {
    canCreateRound: false,
    canDraw: false,
    canAcknowledgeImage: false,
    canScore: false,
    canChooseCommand: false,
    canStartWorkout: false,
    canCompleteWorkout: false,
    canSettleRound: false,
  };
}

function deriveV3TrainingRoomState(room, uid, now = Date.now()) {
  const members = memberUids(room);
  const opponentUid = members.find((memberUid) => memberUid !== uid) || "";
  const rounds = orderedTrainingRounds(room?.rounds);
  const metrics = hpMetricsForRounds(rounds, members);
  const completedRounds = rounds.filter((round) => finiteTimestamp(round.completedAt) > 0);
  const currentTime = finiteTimestamp(now);
  const base = {
    phase: "waiting_round",
    roundIndex: Math.min(TRAINING_MAX_ROUNDS, (rounds.at(-1)?.index || 0) + 1),
    round: rounds.at(-1) || null,
    opponentUid,
    ...metrics,
    ownHp: metrics.hpByUid[uid] ?? TRAINING_START_HP,
    opponentHp: metrics.hpByUid[opponentUid] ?? TRAINING_START_HP,
    result: null,
    actions: emptyHpActions(),
  };
  if (!uid || members.length !== TRAINING_PLAYER_COUNT || !members.includes(uid)) {
    return { ...base, phase: "invalid" };
  }

  const finalized = trainingServerFinalizedResult(room?.serverFinalized, uid);
  if (finalized) {
    return {
      ...base,
      ...finalized,
      phase: "result",
      actions: emptyHpActions(),
    };
  }
  const last = rounds.at(-1);
  if (finiteTimestamp(last?.completedAt) > 0) {
    const exhausted = members.some((memberUid) => metrics.hpByUid[memberUid] === 0);
    if (exhausted || last.index >= TRAINING_MAX_ROUNDS) {
      const winnerUid = hpMetricWinner(members, metrics);
      return {
        ...base,
        phase: "result",
        roundIndex: last.index,
        result: hpResult(
          uid,
          members,
          metrics,
          exhausted ? "hp_zero" : "round_limit",
          winnerUid,
        ),
      };
    }
  }
  if (room?.destroyed?.reason === "health_stop") {
    return {
      ...base,
      phase: "result",
      result: hpResult(uid, members, metrics, "health_stop", "", true),
    };
  }
  if (room?.surrendered?.uid && members.includes(room.surrendered.uid)) {
    const winnerUid = members.find((memberUid) => memberUid !== room.surrendered.uid);
    return {
      ...base,
      phase: "result",
      result: hpResult(uid, members, metrics, "surrender", winnerUid),
    };
  }
  if (room?.destroyed) return { ...base, phase: "destroyed" };
  if (room?.status !== "active") return { ...base, phase: "forming" };

  if (!last) {
    return {
      ...base,
      roundIndex: 1,
      actions: {
        ...emptyHpActions(),
        canCreateRound: room?.hostUid === uid,
      },
    };
  }

  if (finiteTimestamp(last.completedAt) > 0) {
    return {
      ...base,
      roundIndex: last.index + 1,
      round: null,
      actions: {
        ...emptyHpActions(),
        canCreateRound: room?.hostUid === uid,
      },
    };
  }

  const current = {
    ...base,
    roundIndex: last.index,
    round: last,
  };
  if (!last.draws?.[uid]) {
    return {
      ...current,
      phase: "draw",
      actions: { ...emptyHpActions(), canDraw: true },
    };
  }
  if (!last.draws?.[opponentUid]) return { ...current, phase: "waiting_draw" };
  if (last.imageReceived?.[uid] !== true) {
    return {
      ...current,
      phase: "receive_image",
      actions: { ...emptyHpActions(), canAcknowledgeImage: true },
    };
  }
  if (last.imageReceived?.[opponentUid] !== true) {
    return { ...current, phase: "waiting_image" };
  }

  const ownScore = normalizeTrainingScore(last.scores?.[uid]);
  const opponentScore = normalizeTrainingScore(last.scores?.[opponentUid]);
  if (!ownScore) {
    return {
      ...current,
      phase: "score",
      actions: { ...emptyHpActions(), canScore: true },
    };
  }
  if (!opponentScore) return { ...current, phase: "waiting_scores" };

  const opponentNeedsCommand = trainingDamageForScore(opponentScore) > 0;
  const ownNeedsCommand = trainingDamageForScore(ownScore) > 0;
  if (opponentNeedsCommand && !last.commandChoices?.[opponentUid]) {
    return {
      ...current,
      phase: "choose_command",
      actions: { ...emptyHpActions(), canChooseCommand: true },
    };
  }
  if (ownNeedsCommand && !last.commandChoices?.[uid]) {
    return { ...current, phase: "waiting_command" };
  }

  const ownWorkout = last.workouts?.[uid];
  const opponentWorkout = last.workouts?.[opponentUid];
  if (ownNeedsCommand && !ownWorkout) {
    return {
      ...current,
      phase: "workout_ready",
      actions: { ...emptyHpActions(), canStartWorkout: true },
    };
  }
  if (ownNeedsCommand && !finiteTimestamp(ownWorkout?.completedAt)) {
    const deadlineAt = finiteTimestamp(ownWorkout?.startedAt)
      + trainingDurationForScore(ownScore);
    const complete = deadlineAt > 0 && currentTime >= deadlineAt;
    return {
      ...current,
      phase: complete ? "workout_complete" : "workout_active",
      workoutDeadlineAt: deadlineAt,
      actions: {
        ...emptyHpActions(),
        canCompleteWorkout: complete,
      },
    };
  }
  if (opponentNeedsCommand && !finiteTimestamp(opponentWorkout?.completedAt)) {
    return { ...current, phase: "coach" };
  }

  return {
    ...current,
    phase: room?.hostUid === uid ? "settle_round" : "waiting_settlement",
    actions: {
      ...emptyHpActions(),
      canSettleRound: room?.hostUid === uid,
    },
  };
}

export function deriveTrainingRoomState(room, uid, now = Date.now()) {
  return Number(room?.protocolVersion) === TRAINING_PROTOCOL_VERSION
    && room?.variant === TRAINING_VARIANT
    ? deriveV3TrainingRoomState(room, uid, now)
    : deriveV2TrainingRoomState(room, uid, now);
}

export function trainingBeatState({
  startedAt,
  now = Date.now(),
  bpm,
  beatsPerRep = 1,
} = {}) {
  const normalizedBpm = normalizeTrainingBpm(bpm);
  const numericBeats = Number(beatsPerRep);
  const normalizedBeats = TRAINING_COMMAND_BEATS_PER_REP.includes(numericBeats)
    ? numericBeats
    : normalizeTrainingBeatsPerRep(numericBeats);
  const start = finiteTimestamp(startedAt);
  const current = finiteTimestamp(now);
  if (!start || !normalizedBpm || current < start) {
    return { enabled: false, beat: 0, rep: 0, phase: 0 };
  }
  const intervalMs = 60_000 / normalizedBpm;
  const elapsed = current - start;
  const absoluteBeat = Math.floor(elapsed / intervalMs);
  return {
    enabled: true,
    beat: (absoluteBeat % normalizedBeats) + 1,
    rep: Math.floor(absoluteBeat / normalizedBeats) + 1,
    phase: (elapsed % intervalMs) / intervalMs,
  };
}
