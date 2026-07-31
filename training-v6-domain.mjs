export const TRAINING_V6_PROTOCOL_VERSION = 6;
export const TRAINING_V6_VARIANT = "companion_v6";
export const TRAINING_V6_MAX_DRAWS = 5;
export const TRAINING_V6_HIT_SCORE = 8;
export const TRAINING_V6_WORKOUT_DURATION_MS = 60_000;
export const TRAINING_V6_PHASES = Object.freeze([
  "media_exchange",
  "scoring",
  "instruction",
  "ready",
  "workout",
  "complete",
  "no_contest",
]);
export const TRAINING_V6_TERMINAL_PHASES = Object.freeze([
  "complete",
  "no_contest",
]);
export const TRAINING_V6_P2P_EVENT_KINDS = Object.freeze([
  "cheer",
  "reaction",
]);
export const TRAINING_V6_BEATS_PER_REP = Object.freeze([2, 4, 8]);
export const TRAINING_V6_EXERCISE_IDS = Object.freeze([
  "push_up",
  "squat",
  "sit_up",
  "custom",
]);
export const TRAINING_V6_LIMITS = Object.freeze({
  exerciseId: 40,
  exercise: 40,
  completion: 60,
  command: 120,
  p2pText: 40,
});

const SAFE_SEGMENT = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;
const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const P2P_EVENT_KEYS = Object.freeze([
  "protocolVersion",
  "variant",
  "kind",
  "eventId",
  "roomId",
  "roundNumber",
  "workoutId",
  "fromUid",
  "toUid",
  "text",
  "createdAt",
]);

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function isSafeSegment(value) {
  return typeof value === "string"
    && SAFE_SEGMENT.test(value)
    && !RESERVED_KEYS.has(value);
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireValue(valid, label) {
  if (!valid) throw new TypeError(`${label} is invalid`);
}

function normalizedText(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maximum);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function normalizeTrainingV6ParticipantUids(value) {
  if (!Array.isArray(value)
      || value.length !== 2
      || !value.every(isSafeSegment)
      || value[0] === value[1]) {
    return [];
  }
  return Object.freeze([...value]);
}

export function trainingV6ParticipantUidsFromMemberOrder(memberOrder) {
  const exactDenseArray = Array.isArray(memberOrder)
    && memberOrder.length === 2
    && Object.keys(memberOrder).length === 2;
  if (!exactDenseArray && !hasExactKeys(memberOrder, ["0", "1"])) return [];
  return normalizeTrainingV6ParticipantUids([
    memberOrder[0],
    memberOrder[1],
  ]);
}

export function normalizeTrainingV6Score(value) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 10 ? score : 0;
}

export function normalizeTrainingV6Bpm(value) {
  const bpm = Number(value);
  return Number.isInteger(bpm) && bpm >= 40 && bpm <= 160 ? bpm : null;
}

export function normalizeTrainingV6Instruction(value = {}) {
  if (!isRecord(value)) {
    return deepFreeze({
      exerciseId: "",
      exercise: "",
      completion: "",
      command: "",
      bpm: null,
      beatsPerRep: null,
    });
  }
  const exerciseId = String(value.exerciseId || "").toLowerCase();
  const beatsPerRep = Number(value.beatsPerRep);
  return deepFreeze({
    exerciseId: TRAINING_V6_EXERCISE_IDS.includes(exerciseId)
      ? exerciseId
      : "",
    exercise: normalizedText(value.exercise, TRAINING_V6_LIMITS.exercise),
    completion: normalizedText(
      value.completion,
      TRAINING_V6_LIMITS.completion,
    ),
    command: normalizedText(value.command, TRAINING_V6_LIMITS.command),
    bpm: normalizeTrainingV6Bpm(value.bpm),
    beatsPerRep: TRAINING_V6_BEATS_PER_REP.includes(beatsPerRep)
      ? beatsPerRep
      : null,
  });
}

export function validateTrainingV6Instruction(value) {
  if (!hasExactKeys(value, [
    "exerciseId",
    "exercise",
    "completion",
    "command",
    "bpm",
    "beatsPerRep",
  ])) return false;
  const normalized = normalizeTrainingV6Instruction(value);
  return normalized.exerciseId.length > 0
    && normalized.exercise.length > 0
    && normalized.completion.length > 0
    && normalized.command.length > 0
    && normalized.bpm !== null
    && normalized.beatsPerRep !== null
    && normalized.exerciseId === value.exerciseId
    && normalized.exercise === value.exercise
    && normalized.completion === value.completion
    && normalized.command === value.command
    && normalized.bpm === value.bpm
    && normalized.beatsPerRep === value.beatsPerRep;
}

export function createTrainingV6Instruction(value = {}) {
  const instruction = normalizeTrainingV6Instruction(value);
  requireValue(validateTrainingV6Instruction(instruction), "instruction");
  return instruction;
}

function normalizedScores(participantUids, value) {
  if (!isRecord(value)) return null;
  const result = Object.create(null);
  for (const uid of participantUids) {
    if (!Object.hasOwn(value, uid)) return null;
    const score = normalizeTrainingV6Score(value[uid]);
    if (!score) return null;
    result[uid] = score;
  }
  if (Object.keys(value).some((uid) => !participantUids.includes(uid))) {
    return null;
  }
  return result;
}

function workoutForVictim({
  roundNumber,
  participantUids,
  scores,
  victimUid,
  sequence,
}) {
  const trainerUid = participantUids.find((uid) => uid !== victimUid);
  return deepFreeze({
    workoutId: `workout-${roundNumber}-${sequence + 1}`,
    sequence,
    roundNumber,
    trainerUid,
    victimUid,
    score: scores[victimUid],
    durationMs: TRAINING_V6_WORKOUT_DURATION_MS,
  });
}

export function deriveTrainingV6DrawOutcome({
  roundNumber,
  participantUids,
  scores,
} = {}) {
  requireValue(
    Number.isInteger(roundNumber)
      && roundNumber >= 1
      && roundNumber <= TRAINING_V6_MAX_DRAWS,
    "roundNumber",
  );
  const participants = normalizeTrainingV6ParticipantUids(participantUids);
  requireValue(participants.length === 2, "participantUids");
  const normalized = normalizedScores(participants, scores);
  requireValue(Boolean(normalized), "scores");

  const victims = participants.filter(
    (uid) => normalized[uid] >= TRAINING_V6_HIT_SCORE,
  );
  const workoutQueue = victims.map((victimUid, sequence) => (
    workoutForVictim({
      roundNumber,
      participantUids: participants,
      scores: normalized,
      victimUid,
      sequence,
    })
  ));

  if (workoutQueue.length === 0) {
    return deepFreeze({
      kind: roundNumber === TRAINING_V6_MAX_DRAWS
        ? "draw_limit"
        : "next_draw",
      roundNumber,
      nextRoundNumber: roundNumber === TRAINING_V6_MAX_DRAWS
        ? null
        : roundNumber + 1,
      trainerUid: null,
      victimUid: null,
      workoutQueue,
    });
  }
  return deepFreeze({
    kind: workoutQueue.length === 1 ? "single_hit" : "double_hit",
    roundNumber,
    nextRoundNumber: null,
    trainerUid: workoutQueue[0].trainerUid,
    victimUid: workoutQueue[0].victimUid,
    workoutQueue,
  });
}

export function deriveTrainingV6FirstHit({
  participantUids,
  draws = [],
} = {}) {
  const participants = normalizeTrainingV6ParticipantUids(participantUids);
  requireValue(participants.length === 2, "participantUids");
  requireValue(
    Array.isArray(draws) && draws.length <= TRAINING_V6_MAX_DRAWS,
    "draws",
  );
  if (draws.length === 0) {
    return deepFreeze({
      kind: "awaiting_draw",
      roundNumber: 0,
      nextRoundNumber: 1,
      trainerUid: null,
      victimUid: null,
      workoutQueue: [],
    });
  }

  let latest = null;
  for (let index = 0; index < draws.length; index += 1) {
    const draw = draws[index];
    requireValue(
      isRecord(draw) && draw.roundNumber === index + 1,
      "draw sequence",
    );
    latest = deriveTrainingV6DrawOutcome({
      roundNumber: draw.roundNumber,
      participantUids: participants,
      scores: draw.scores,
    });
    if (latest.workoutQueue.length > 0) return latest;
  }
  return latest;
}

export function validateTrainingV6P2PEvent(value) {
  if (!hasExactKeys(value, P2P_EVENT_KEYS)
      || value.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
      || value.variant !== TRAINING_V6_VARIANT
      || !TRAINING_V6_P2P_EVENT_KINDS.includes(value.kind)
      || !isSafeToken(value.eventId)
      || !isSafeToken(value.roomId)
      || !Number.isInteger(value.roundNumber)
      || value.roundNumber < 1
      || value.roundNumber > TRAINING_V6_MAX_DRAWS
      || !isSafeToken(value.workoutId)
      || !isSafeSegment(value.fromUid)
      || !isSafeSegment(value.toUid)
      || value.fromUid === value.toUid
      || !isTimestamp(value.createdAt)) {
    return false;
  }
  const text = normalizedText(value.text, TRAINING_V6_LIMITS.p2pText);
  return text.length > 0 && text === value.text;
}

export function createTrainingV6P2PEvent(input = {}) {
  const event = {
    protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
    variant: TRAINING_V6_VARIANT,
    kind: input.kind,
    eventId: input.eventId,
    roomId: input.roomId,
    roundNumber: input.roundNumber,
    workoutId: input.workoutId,
    fromUid: input.fromUid,
    toUid: input.toUid,
    text: normalizedText(input.text, TRAINING_V6_LIMITS.p2pText),
    createdAt: input.createdAt,
  };
  requireValue(validateTrainingV6P2PEvent(event), "p2p event");
  return deepFreeze(event);
}

export function isTrainingV6TerminalPhase(phase) {
  return TRAINING_V6_TERMINAL_PHASES.includes(phase);
}
