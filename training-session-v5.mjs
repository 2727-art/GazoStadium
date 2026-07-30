export {
  TRAINING_SESSION_V5_OWNER_STATUSES,
  TRAINING_SESSION_V5_PHASES,
  TRAINING_SESSION_V5_RESULT_TERMINAL_KINDS,
  createTrainingSessionV5Fence,
  createTrainingSessionV5State,
  isTrainingSessionV5Phase,
  normalizeTrainingSessionV5State,
  trainingSessionV5FenceMatches,
  trainingSessionV5Screen,
  transitionTrainingSessionV5,
  validateTrainingSessionV5State,
} from "./training-session-v5-machine.mjs";

export const TRAINING_SESSION_V5_PROTOCOL_VERSION = 5;
export const TRAINING_SESSION_V5_SIGNALING_VERSION = 5;

const SAFE_SEGMENT = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;
const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const SIGNAL_TYPES = Object.freeze(["offer", "answer", "candidate"]);
const IDENTITY_KEYS = Object.freeze([
  "runId",
  "endpointId",
  "ownerEpoch",
  "roomAttemptId",
  "transportEpoch",
]);
const PRESENCE_KEYS = Object.freeze([
  "protocolVersion",
  ...IDENTITY_KEYS,
  "online",
  "updatedAt",
]);
const SIGNAL_KEYS = Object.freeze([
  "protocolVersion",
  "roomAttemptId",
  "transportEpoch",
  "fromUid",
  "toUid",
  "fromRunId",
  "toRunId",
  "fromEndpointId",
  "toEndpointId",
  "type",
  "payload",
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

function isSegment(value) {
  return typeof value === "string" && SAFE_SEGMENT.test(value);
}

function isToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value) {
  return isCounter(value);
}

function requireValue(valid, label) {
  if (!valid) throw new TypeError(`${label} is invalid`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function trainingSessionV5AttemptPath(uid) {
  requireValue(isSegment(uid), "uid");
  return `online/trainingAttemptsV5/${uid}`;
}

export function trainingSessionV5PresencePath(roomId, uid, runId) {
  requireValue(isSegment(roomId), "roomId");
  requireValue(isSegment(uid), "uid");
  requireValue(isToken(runId), "runId");
  return `online/trainingRooms/${roomId}/presenceV5/${uid}/${runId}`;
}

export function trainingSessionV5SignalPath(
  roomId,
  targetUid,
  targetRunId,
  signalId,
) {
  requireValue(isSegment(roomId), "roomId");
  requireValue(isSegment(targetUid), "targetUid");
  requireValue(isToken(targetRunId), "targetRunId");
  requireValue(isToken(signalId), "signalId");
  return `online/trainingRooms/${roomId}/signalsV5/${
    targetUid
  }/${targetRunId}/${signalId}`;
}

export function validateTrainingSessionV5Identity(value) {
  return hasExactKeys(value, IDENTITY_KEYS)
    && isToken(value.runId)
    && isToken(value.endpointId)
    && isToken(value.ownerEpoch)
    && isToken(value.roomAttemptId)
    && isToken(value.transportEpoch);
}

export function createTrainingSessionV5Identity(input = {}) {
  const identity = {
    runId: input.runId,
    endpointId: input.endpointId,
    ownerEpoch: input.ownerEpoch,
    roomAttemptId: input.roomAttemptId,
    transportEpoch: input.transportEpoch,
  };
  requireValue(validateTrainingSessionV5Identity(identity), "identity");
  return deepFreeze(identity);
}

export function trainingSessionV5IdentityMatches(left, right) {
  return validateTrainingSessionV5Identity(left)
    && validateTrainingSessionV5Identity(right)
    && IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

export function validateTrainingSessionV5PresencePayload(value) {
  return hasExactKeys(value, PRESENCE_KEYS)
    && value.protocolVersion === TRAINING_SESSION_V5_PROTOCOL_VERSION
    && validateTrainingSessionV5Identity(Object.fromEntries(
      IDENTITY_KEYS.map((key) => [key, value[key]]),
    ))
    && typeof value.online === "boolean"
    && isTimestamp(value.updatedAt);
}

export function createTrainingSessionV5PresencePayload(input = {}) {
  const identity = createTrainingSessionV5Identity(input);
  requireValue(typeof input.online === "boolean", "online");
  requireValue(isTimestamp(input.updatedAt), "updatedAt");
  return deepFreeze({
    protocolVersion: TRAINING_SESSION_V5_PROTOCOL_VERSION,
    ...identity,
    online: input.online,
    updatedAt: input.updatedAt,
  });
}

export function validateTrainingSessionV5SignalEnvelope(value) {
  if (!hasExactKeys(value, SIGNAL_KEYS)
      || value.protocolVersion !== TRAINING_SESSION_V5_PROTOCOL_VERSION
      || !isToken(value.roomAttemptId)
      || !isToken(value.transportEpoch)
      || !isSegment(value.fromUid)
      || !isSegment(value.toUid)
      || value.fromUid === value.toUid
      || !isToken(value.fromRunId)
      || !isToken(value.toRunId)
      || !isToken(value.fromEndpointId)
      || !isToken(value.toEndpointId)
      || !SIGNAL_TYPES.includes(value.type)
      || typeof value.payload !== "string"
      || value.payload.length < 1
      || value.payload.length > 30_000
      || !isTimestamp(value.createdAt)) {
    return false;
  }
  return true;
}

export function createTrainingSessionV5SignalEnvelope(input = {}) {
  const envelope = {
    protocolVersion: TRAINING_SESSION_V5_PROTOCOL_VERSION,
    roomAttemptId: input.roomAttemptId,
    transportEpoch: input.transportEpoch,
    fromUid: input.fromUid,
    toUid: input.toUid,
    fromRunId: input.fromRunId,
    toRunId: input.toRunId,
    fromEndpointId: input.fromEndpointId,
    toEndpointId: input.toEndpointId,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt,
  };
  requireValue(validateTrainingSessionV5SignalEnvelope(envelope), "signal");
  return deepFreeze(envelope);
}

function signalDecision(accepted, reason, envelope = null) {
  return deepFreeze({
    accepted,
    ignored: !accepted,
    consume: accepted ? "after-success" : "never",
    reason,
    envelope,
  });
}

export function decideTrainingSessionV5Signal({
  envelope,
  ownUid,
  ownRunId,
  ownEndpointId,
  remoteUid,
  remoteRunId,
  remoteEndpointId,
  roomAttemptId,
  transportEpoch,
  now = null,
} = {}) {
  if (!validateTrainingSessionV5SignalEnvelope(envelope)) {
    return signalDecision(false, "signal-invalid");
  }
  if (!isSegment(ownUid)
      || !isSegment(remoteUid)
      || ownUid === remoteUid
      || !isToken(ownRunId)
      || !isToken(ownEndpointId)
      || !isToken(remoteRunId)
      || !isToken(remoteEndpointId)
      || !isToken(roomAttemptId)
      || !isToken(transportEpoch)) {
    return signalDecision(false, "context-invalid");
  }
  if (envelope.toUid !== ownUid
      || envelope.toRunId !== ownRunId
      || envelope.toEndpointId !== ownEndpointId
      || envelope.fromUid !== remoteUid
      || envelope.fromRunId !== remoteRunId
      || envelope.fromEndpointId !== remoteEndpointId) {
    return signalDecision(false, "signal-member-mismatch");
  }
  if (envelope.roomAttemptId !== roomAttemptId
      || envelope.transportEpoch !== transportEpoch) {
    return signalDecision(false, "signal-fence-mismatch");
  }
  if (now !== null
      && (
        !isTimestamp(now)
        || envelope.createdAt < now - 60_000
        || envelope.createdAt > now + 15_000
      )) {
    return signalDecision(false, "signal-stale");
  }
  return signalDecision(true, "training-signal-v5-current", envelope);
}

export function shouldConsumeTrainingSessionV5Signal(
  decision,
  { handledSuccessfully, contextStillCurrent } = {},
) {
  return decision?.accepted === true
    && decision.consume === "after-success"
    && handledSuccessfully === true
    && contextStillCurrent === true;
}

export function trainingImageRoundsNeedingResend({
  outgoingRoundIndexes = [],
  rounds = {},
  opponentUid = "",
} = {}) {
  if (!Array.isArray(outgoingRoundIndexes)
      || !isRecord(rounds)
      || !isSegment(opponentUid)) return [];
  return [...new Set(outgoingRoundIndexes)]
    .filter((roundIndex) => (
      Number.isInteger(roundIndex)
        && roundIndex >= 1
        && roundIndex <= 5
        && rounds?.[roundIndex]?.imageReceived?.[opponentUid] !== true
    ))
    .sort((left, right) => left - right);
}
