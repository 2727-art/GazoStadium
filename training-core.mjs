export const TRAINING_PROTOCOL_VERSION = 1;
export const TRAINING_VARIANT = "kitaeai_60";
export const TRAINING_PLAYER_COUNT = 2;
export const TRAINING_MAX_TURNS = 6;
export const TRAINING_TURN_DURATION_MS = 60_000;
export const TRAINING_QUEUE_FRESH_MS = 45_000;
export const TRAINING_ACTIVE_PRESENCE_GRACE_MS = 90_000;
export const TRAINING_FORMING_PRESENCE_GRACE_MS = 45_000;
export const TRAINING_INTENSITIES = Object.freeze(["light", "standard", "strong"]);
export const TRAINING_BEATS_PER_REP = Object.freeze([1, 2, 4]);

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

export function selectTrainingPair(entries) {
  const source = Array.isArray(entries) ? entries : [];
  return source.length >= TRAINING_PLAYER_COUNT
    ? source.slice(0, TRAINING_PLAYER_COUNT)
    : [];
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
  if (Number(serverFinalized?.version) !== 1) return null;
  const ownOutcome = serverFinalized.outcomes?.[uid];
  if (!["win", "loss", "draw"].includes(ownOutcome)) return null;
  const outcomes = serverFinalized.outcomes || {};
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
  return finiteTimestamp(now) >= startedAt + TRAINING_TURN_DURATION_MS
    ? "expired"
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
    .filter((turn) => trainingTurnStatus(turn, Number.POSITIVE_INFINITY) === "completed");
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
  const index = Number(turnIndex);
  return Number.isSafeInteger(index) && index > 0 && index % 2 === 0
    ? index / 2
    : 0;
}

export function deriveTrainingRoomState(room, uid, now = Date.now()) {
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
  if (status === "active" || status === "expired") return { ...current, phase: status };
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
  const pair = continueVotePairForTurn(last.index);
  if (pair) {
    const votes = room?.continueVotes?.[pair] || room?.continueVotes?.[String(pair)] || {};
    const values = members.map((memberUid) => votes?.[memberUid]).filter(Boolean);
    if (values.includes("finish")) {
      return {
        ...current,
        pair,
        phase: "result",
        result: {
          type: "mutual_complete",
          winnerUid: "",
          loserUid: "",
          reason: "mutual_complete",
        },
      };
    }
    if (!members.every((memberUid) => votes?.[memberUid] === "continue")) {
      return { ...current, pair, phase: "continue_vote" };
    }
  }

  return {
    ...current,
    phase: uid === nextTrainerUid ? "compose" : "waiting_instruction",
    turnIndex: last.index + 1,
    turn: null,
    trainerUid: nextTrainerUid,
    traineeUid: nextTraineeUid,
    pair,
  };
}

export function trainingBeatState({
  startedAt,
  now = Date.now(),
  bpm,
  beatsPerRep = 1,
} = {}) {
  const normalizedBpm = normalizeTrainingBpm(bpm);
  const normalizedBeats = normalizeTrainingBeatsPerRep(beatsPerRep);
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
