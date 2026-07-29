import {
  createOnlineSessionFence,
  decideOnlineSignalEnvelope,
  isValidOnlineConnectionGeneration,
  isValidOnlineSessionId,
  shouldConsumeOnlineSignal,
} from "./online-session-guard.mjs";
import {
  createOnlineP2pGenerationToken,
  createOnlineP2pRecoveryState,
  getOnlineP2pRecoveryTimer,
  transitionOnlineP2pRecovery,
} from "./online-p2p-hardening.mjs";
import {
  TRAINING_PROTOCOL_VERSION,
  TRAINING_VARIANT,
  normalizeTrainingCommandDeck,
  normalizeTrainingImageBpms,
  normalizeTrainingIntensity,
  normalizeTrainingName,
} from "./training-core.mjs";

export const TRAINING_SESSION_PROTOCOL_VERSION = 2;
export const TRAINING_SESSION_GAME_PROTOCOL_VERSION = TRAINING_PROTOCOL_VERSION;
export const TRAINING_SESSION_GAME_VARIANT = TRAINING_VARIANT;
export const TRAINING_SIGNALING_VERSION = 2;
export const TRAINING_SESSION_STORAGE_KEY = "hariai:training:session-id:v2";

const SAFE_UID_PATTERN = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;
const SAFE_TOKEN_PATTERN = /^[-_0-9A-Za-z]{8,128}$/;
const SESSION_GENERATION_PATTERN = /^[-_0-9A-Za-z]{22}$/;
const ROOM_ID_PATTERN = /^[-0-9A-Z_a-z]{20}$/;
const SIGNAL_TYPES = Object.freeze(["offer", "answer", "candidate"]);
const ROOM_STATUSES = Object.freeze(["offered", "active", "expired"]);
const QUEUE_KEYS = Object.freeze([
  "commandDeck",
  "connectionGeneration",
  "expiresAt",
  "generation",
  "imageBpms",
  "intensity",
  "joinedAt",
  "lastSeen",
  "leaseToken",
  "name",
  "protocolVersion",
  "sessionId",
  "state",
  "trainingProtocolVersion",
  "uid",
  "variant",
]);
const COMMAND_KEYS = Object.freeze([
  "beatsPerRep",
  "command",
  "completion",
  "exercise",
]);
const SIGNAL_KEYS = Object.freeze([
  "attemptId",
  "connectionGeneration",
  "createdAt",
  "fromSessionId",
  "fromUid",
  "payload",
  "protocolVersion",
  "signalingVersion",
  "toSessionId",
  "toUid",
  "type",
]);

function isRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireTimestamp(value, label) {
  if (!isTimestamp(value)) {
    throw new TypeError(`${label} must be a non-negative safe-integer timestamp`);
  }
  return value;
}

function isSafeUid(value) {
  return typeof value === "string" && SAFE_UID_PATTERN.test(value);
}

function requireUid(value, label) {
  if (!isSafeUid(value)) {
    throw new TypeError(`${label} must be a Firebase-safe uid`);
  }
  return value;
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value);
}

function requireSafeToken(value, label) {
  if (!isSafeToken(value)) {
    throw new TypeError(`${label} must be an 8-128 character URL-safe token`);
  }
  return value;
}

function isSessionGeneration(value) {
  return typeof value === "string"
    && SESSION_GENERATION_PATTERN.test(value);
}

function requireSessionGeneration(value, label) {
  if (!isSessionGeneration(value)) {
    throw new TypeError(`${label} must be a 22-character URL-safe generation`);
  }
  return value;
}

function requireSessionId(value, label) {
  if (!isValidOnlineSessionId(value)) {
    throw new TypeError(`${label} must be a canonical online session id`);
  }
  return value;
}

function requireConnectionGeneration(value, label) {
  if (!isValidOnlineConnectionGeneration(value)) {
    throw new TypeError(`${label} must be a safe connection generation`);
  }
  return value;
}

function isRoomId(value) {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

function requireRoomId(value, label) {
  if (!isRoomId(value)) {
    throw new TypeError(`${label} must be a 20-character Firebase room id`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function normalizeWireText(value, maximum, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string"
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be control-character-free text`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    throw new TypeError(`${label} must be ${allowEmpty ? "at most" : "1-"}${maximum} characters`);
  }
  return normalized;
}

function exactIndexedKeys(value, count) {
  const expected = Array.from(
    { length: count },
    (_, index) => String(index + 1),
  );
  if (!Array.isArray(value)) return hasExactKeys(value, expected);
  const actual = Object.keys(value).sort();
  return value.length === count + 1
    && actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function normalizeQueueCommandDeck(value) {
  if (!exactIndexedKeys(value, 3)) {
    throw new TypeError("commandDeck must contain exactly cards 1-3");
  }
  for (let index = 1; index <= 3; index += 1) {
    const card = value[index] ?? value[String(index)];
    if (!hasExactKeys(card, COMMAND_KEYS)) {
      throw new TypeError(`commandDeck.${index} has an invalid shape`);
    }
    normalizeWireText(card.exercise, 40, `commandDeck.${index}.exercise`);
    normalizeWireText(card.completion, 60, `commandDeck.${index}.completion`);
    normalizeWireText(card.command, 120, `commandDeck.${index}.command`);
  }
  const normalized = normalizeTrainingCommandDeck(value);
  if (!exactIndexedKeys(normalized, 3)) {
    throw new TypeError("commandDeck contains an invalid command");
  }
  return normalized;
}

function normalizeQueueImageBpms(value) {
  if (!exactIndexedKeys(value, 5)) {
    throw new TypeError("imageBpms must contain exactly images 1-5");
  }
  const normalized = normalizeTrainingImageBpms(value);
  if (!exactIndexedKeys(normalized, 5)) {
    throw new TypeError("imageBpms contains an invalid BPM");
  }
  return normalized;
}

function sameConnectionGeneration(left, right) {
  return typeof left === typeof right && left === right;
}

function pathSegment(value, label, validator) {
  validator(value, label);
  return value;
}

export function trainingSessionClaimPath(uid) {
  return `online/trainingSessionClaims/${
    pathSegment(uid, "uid", requireUid)
  }`;
}

export function trainingSessionQueuePath(uid, sessionId) {
  return `online/trainingQueueV4/${
    pathSegment(uid, "uid", requireUid)
  }/${
    pathSegment(sessionId, "sessionId", requireSessionId)
  }`;
}

export function trainingSessionOfferPath(
  targetUid,
  targetSessionId,
  roomId = "",
) {
  const base = `online/trainingOffersV4/${
    pathSegment(targetUid, "targetUid", requireUid)
  }/${
    pathSegment(targetSessionId, "targetSessionId", requireSessionId)
  }`;
  if (roomId === "" || roomId === null || roomId === undefined) return base;
  return `${base}/${pathSegment(roomId, "roomId", requireRoomId)}`;
}

export function trainingSessionActivePath(uid, sessionId) {
  return `online/trainingActiveV4/${
    pathSegment(uid, "uid", requireUid)
  }/${
    pathSegment(sessionId, "sessionId", requireSessionId)
  }`;
}

export function trainingSessionMatchLockPath(uid) {
  return `online/trainingMatchLocksV4/${
    pathSegment(uid, "uid", requireUid)
  }`;
}

export function trainingSessionPermitPath(roomId) {
  return `online/trainingMatchPermitsV4/${
    pathSegment(roomId, "roomId", requireRoomId)
  }`;
}

export function trainingSessionRoomPath(roomId) {
  return `online/trainingRooms/${
    pathSegment(roomId, "roomId", requireRoomId)
  }`;
}

export function trainingSessionSignalPath(
  roomId,
  targetUid,
  targetSessionId,
) {
  return `${trainingSessionRoomPath(roomId)}/signalsV2/${
    pathSegment(targetUid, "targetUid", requireUid)
  }/${
    pathSegment(targetSessionId, "targetSessionId", requireSessionId)
  }`;
}

export function trainingSessionPresencePath(roomId, uid, sessionId) {
  return `${trainingSessionRoomPath(roomId)}/presenceV2/${
    pathSegment(uid, "uid", requireUid)
  }/${
    pathSegment(sessionId, "sessionId", requireSessionId)
  }`;
}

export function createTrainingSessionFence({
  sessionId,
  leaseToken,
  generation,
  connectionGeneration,
} = {}) {
  const base = createOnlineSessionFence({
    sessionId,
    leaseToken,
    connectionGeneration,
  });
  requireSessionGeneration(generation, "generation");
  return deepFreeze({
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    sessionId: base.sessionId,
    leaseToken: base.leaseToken,
    generation,
    connectionGeneration: base.connectionGeneration,
  });
}

function parseTrainingSessionFence(value) {
  if (!isRecord(value)
      || value.protocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
      || !isValidOnlineSessionId(value.sessionId)
      || !isValidOnlineSessionId(value.leaseToken)
      || !isSessionGeneration(value.generation)
      || !isValidOnlineConnectionGeneration(value.connectionGeneration)) {
    return null;
  }
  return value;
}

export function trainingSessionFenceMatches(record, fence) {
  const actual = parseTrainingSessionFence(record);
  const expected = parseTrainingSessionFence(fence);
  return Boolean(
    actual
      && expected
      && actual.sessionId === expected.sessionId
      && actual.leaseToken === expected.leaseToken
      && actual.generation === expected.generation
      && sameConnectionGeneration(
        actual.connectionGeneration,
        expected.connectionGeneration,
      ),
  );
}

export function createTrainingSessionQueuePayload(input = {}) {
  if (hasOwn(input, "conditions")) {
    throw new TypeError("conditions must not be stored in trainingQueueV4");
  }
  const {
    uid,
    sessionId,
    leaseToken,
    generation,
    connectionGeneration,
    name,
    intensity,
    commandDeck,
    imageBpms,
    joinedAt,
    lastSeen,
    expiresAt,
  } = input;
  requireUid(uid, "uid");
  const fence = createTrainingSessionFence({
    sessionId,
    leaseToken,
    generation,
    connectionGeneration,
  });
  const normalizedName = normalizeWireText(name, 16, "name");
  if (normalizeTrainingName(normalizedName) !== normalizedName) {
    throw new TypeError("name is not canonical training text");
  }
  if (normalizeTrainingIntensity(intensity) !== intensity) {
    throw new TypeError("intensity is invalid");
  }
  const normalizedCommandDeck = normalizeQueueCommandDeck(commandDeck);
  const normalizedImageBpms = normalizeQueueImageBpms(imageBpms);
  requireTimestamp(joinedAt, "joinedAt");
  requireTimestamp(lastSeen, "lastSeen");
  requireTimestamp(expiresAt, "expiresAt");
  if (joinedAt > lastSeen || lastSeen >= expiresAt) {
    throw new TypeError("queue timestamps must satisfy joinedAt <= lastSeen < expiresAt");
  }
  const payload = {
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    trainingProtocolVersion: TRAINING_SESSION_GAME_PROTOCOL_VERSION,
    variant: TRAINING_SESSION_GAME_VARIANT,
    uid,
    sessionId: fence.sessionId,
    leaseToken: fence.leaseToken,
    generation: fence.generation,
    connectionGeneration: fence.connectionGeneration,
    name: normalizedName,
    intensity,
    commandDeck: normalizedCommandDeck,
    imageBpms: normalizedImageBpms,
    joinedAt,
    lastSeen,
    expiresAt,
    state: "waiting",
  };
  if (!hasExactKeys(payload, QUEUE_KEYS)) {
    throw new TypeError("training queue payload shape is invalid");
  }
  return deepFreeze(payload);
}

function validMemberMap(room) {
  return hasExactKeys(room.members, [room.hostUid, room.guestUid])
    && room.members[room.hostUid] === true
    && room.members[room.guestUid] === true;
}

function validRoomSession(value) {
  return hasExactKeys(value, ["generation", "sessionId"])
    && isValidOnlineSessionId(value.sessionId)
    && isSessionGeneration(value.generation);
}

function validSessionMap(room) {
  return hasExactKeys(room.sessions, [room.hostUid, room.guestUid])
    && validRoomSession(room.sessions[room.hostUid])
    && validRoomSession(room.sessions[room.guestUid])
    && room.sessions[room.hostUid].sessionId
      !== room.sessions[room.guestUid].sessionId;
}

function validPlayer(value, uid) {
  if (!hasExactKeys(value, [
    "commandDeck",
    "conditions",
    "imageBpms",
    "intensity",
    "name",
    "uid",
  ])
      || value.uid !== uid
      || normalizeTrainingIntensity(value.intensity) !== value.intensity) {
    return false;
  }
  try {
    const name = normalizeWireText(value.name, 16, "player.name");
    const conditions = normalizeWireText(
      value.conditions,
      80,
      "player.conditions",
      { allowEmpty: true },
    );
    if (name !== value.name || conditions !== value.conditions) return false;
    normalizeQueueCommandDeck(value.commandDeck);
    normalizeQueueImageBpms(value.imageBpms);
    return true;
  } catch {
    return false;
  }
}

function validPlayerMap(room) {
  return hasExactKeys(room.players, [room.hostUid, room.guestUid])
    && validPlayer(room.players[room.hostUid], room.hostUid)
    && validPlayer(room.players[room.guestUid], room.guestUid);
}

function validAcceptedMap(room) {
  if (!isRecord(room.accepted)
      || room.accepted[room.hostUid] !== true) {
    return false;
  }
  if (room.status === "offered") {
    return hasExactKeys(room.accepted, [room.hostUid]);
  }
  if (room.status === "active") {
    return hasExactKeys(room.accepted, [room.hostUid, room.guestUid])
      && room.accepted[room.guestUid] === true;
  }
  return hasExactKeys(room.accepted, [room.hostUid])
    || (
      hasExactKeys(room.accepted, [room.hostUid, room.guestUid])
      && room.accepted[room.guestUid] === true
    );
}

export function validateTrainingSessionRoom(room) {
  return Boolean(
    isRecord(room)
      && room.protocolVersion === TRAINING_SESSION_GAME_PROTOCOL_VERSION
      && room.variant === TRAINING_SESSION_GAME_VARIANT
      && room.sessionProtocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && room.signalingVersion === TRAINING_SIGNALING_VERSION
      && isSafeUid(room.hostUid)
      && isSafeUid(room.guestUid)
      && room.hostUid !== room.guestUid
      && isSafeToken(room.attemptId)
      && isValidOnlineConnectionGeneration(room.connectionGeneration)
      && isTimestamp(room.createdAt)
      && isTimestamp(room.expiresAt)
      && room.createdAt < room.expiresAt
      && ROOM_STATUSES.includes(room.status)
      && validMemberMap(room)
      && validSessionMap(room)
      && validPlayerMap(room)
      && validAcceptedMap(room)
  );
}

export function trainingSessionRoomMemberMatches(room, {
  uid,
  sessionId,
  generation,
  attemptId = null,
  connectionGeneration = null,
  requireActive = false,
} = {}) {
  requireBoolean(requireActive, "requireActive");
  if (!validateTrainingSessionRoom(room)
      || !isSafeUid(uid)
      || !isValidOnlineSessionId(sessionId)
      || !isSessionGeneration(generation)
      || (attemptId !== null && !isSafeToken(attemptId))
      || (
        connectionGeneration !== null
        && !isValidOnlineConnectionGeneration(connectionGeneration)
      )) {
    return false;
  }
  return room.members[uid] === true
    && room.sessions[uid]?.sessionId === sessionId
    && room.sessions[uid]?.generation === generation
    && (attemptId === null || room.attemptId === attemptId)
    && (
      connectionGeneration === null
      || sameConnectionGeneration(
        room.connectionGeneration,
        connectionGeneration,
      )
    )
    && (!requireActive || room.status === "active");
}

function makeAcceptDecision(accepted, reason, details = {}) {
  return deepFreeze({
    action: accepted ? "accept" : "ignore",
    accepted,
    ignored: !accepted,
    reason,
    ...details,
  });
}

function validOfferSessionMap(offer) {
  return hasExactKeys(offer.sessions, [offer.hostUid, offer.guestUid])
    && validRoomSession(offer.sessions[offer.hostUid])
    && validRoomSession(offer.sessions[offer.guestUid])
    && offer.sessions[offer.hostUid].sessionId
      !== offer.sessions[offer.guestUid].sessionId;
}

export function decideTrainingSessionOffer({
  offer,
  roomId,
  ownUid,
  ownSessionId,
  ownGeneration,
  now,
  isCurrentLeaseOwner,
} = {}) {
  requireRoomId(roomId, "roomId");
  requireUid(ownUid, "ownUid");
  requireSessionId(ownSessionId, "ownSessionId");
  requireSessionGeneration(ownGeneration, "ownGeneration");
  requireTimestamp(now, "now");
  requireBoolean(isCurrentLeaseOwner, "isCurrentLeaseOwner");

  if (!isRecord(offer)) {
    return makeAcceptDecision(false, "offer-invalid");
  }
  if (!isCurrentLeaseOwner) {
    return makeAcceptDecision(false, "session-lease-not-owned");
  }
  if (offer.protocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
      || offer.signalingVersion !== TRAINING_SIGNALING_VERSION
      || offer.trainingProtocolVersion !== TRAINING_SESSION_GAME_PROTOCOL_VERSION
      || offer.variant !== TRAINING_SESSION_GAME_VARIANT) {
    return makeAcceptDecision(false, "offer-protocol-unsupported");
  }
  if (offer.roomId !== roomId) {
    return makeAcceptDecision(false, "offer-room-mismatch");
  }
  if (!isSafeUid(offer.hostUid)
      || !isSafeUid(offer.guestUid)
      || offer.hostUid === offer.guestUid
      || offer.fromUid !== offer.hostUid
      || offer.toUid !== offer.guestUid
      || offer.toUid !== ownUid) {
    return makeAcceptDecision(false, "offer-member-mismatch");
  }
  if (!isValidOnlineSessionId(offer.fromSessionId)
      || offer.toSessionId !== ownSessionId
      || !validOfferSessionMap(offer)
      || offer.sessions[offer.hostUid].sessionId !== offer.fromSessionId
      || offer.sessions[ownUid].sessionId !== ownSessionId
      || offer.sessions[ownUid].generation !== ownGeneration) {
    return makeAcceptDecision(false, "offer-session-fence-mismatch");
  }
  if (!isSafeToken(offer.attemptId)
      || !isValidOnlineConnectionGeneration(offer.connectionGeneration)) {
    return makeAcceptDecision(false, "offer-attempt-invalid");
  }
  if (!isTimestamp(offer.createdAt)
      || !isTimestamp(offer.expiresAt)
      || offer.createdAt >= offer.expiresAt
      || offer.createdAt > now + 15_000
      || offer.expiresAt <= now) {
    return makeAcceptDecision(false, "offer-expired");
  }
  try {
    if (normalizeWireText(offer.fromName, 16, "offer.fromName")
        !== offer.fromName) {
      return makeAcceptDecision(false, "offer-host-name-invalid");
    }
  } catch {
    return makeAcceptDecision(false, "offer-host-name-invalid");
  }
  return makeAcceptDecision(true, "offer-v4-current", {
    protocol: "v2",
    roomId,
    hostUid: offer.hostUid,
    hostSessionId: offer.fromSessionId,
    hostGeneration: offer.sessions[offer.hostUid].generation,
    attemptId: offer.attemptId,
    connectionGeneration: offer.connectionGeneration,
  });
}

export function createTrainingSessionSignalEnvelope({
  fromUid,
  fromSessionId,
  toUid,
  toSessionId,
  connectionGeneration,
  attemptId,
  type,
  payload,
  createdAt,
} = {}) {
  requireUid(fromUid, "fromUid");
  requireUid(toUid, "toUid");
  if (fromUid === toUid) {
    throw new TypeError("signal source and target must be different players");
  }
  requireSessionId(fromSessionId, "fromSessionId");
  requireSessionId(toSessionId, "toSessionId");
  requireConnectionGeneration(connectionGeneration, "connectionGeneration");
  requireSafeToken(attemptId, "attemptId");
  if (!SIGNAL_TYPES.includes(type)) {
    throw new TypeError("type must be offer, answer, or candidate");
  }
  if (typeof payload !== "string"
      || payload.length < 1
      || payload.length > 30_000) {
    throw new TypeError("payload must be a non-empty string of at most 30000 characters");
  }
  requireTimestamp(createdAt, "createdAt");
  return deepFreeze({
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    fromUid,
    fromSessionId,
    toUid,
    toSessionId,
    connectionGeneration,
    attemptId,
    type,
    payload,
    createdAt,
  });
}

function makeSignalDecision(base, accepted, reason, details = {}) {
  return deepFreeze({
    action: accepted ? "accept" : "ignore",
    accepted,
    ignored: !accepted,
    consume: accepted ? "after-success" : "never",
    reason,
    protocol: base?.protocol ?? null,
    remoteSessionId: base?.remoteSessionId ?? null,
    ...details,
  });
}

export function decideTrainingSessionSignal({
  envelope,
  ownUid,
  remoteUid,
  ownSessionId,
  remoteSessionId,
  connectionGeneration,
  attemptId,
  isCurrentLeaseOwner,
  now = null,
} = {}) {
  requireUid(ownUid, "ownUid");
  requireUid(remoteUid, "remoteUid");
  if (ownUid === remoteUid) {
    throw new TypeError("ownUid and remoteUid must be different");
  }
  requireSafeToken(attemptId, "attemptId");
  if (now !== null) requireTimestamp(now, "now");
  const base = decideOnlineSignalEnvelope({
    envelope,
    ownSessionId,
    remoteSessionId,
    connectionGeneration,
    isCurrentLeaseOwner,
  });
  if (!base.accepted) return base;
  if (!hasExactKeys(envelope, SIGNAL_KEYS)) {
    return makeSignalDecision(base, false, "signal-shape-invalid");
  }
  if (envelope.signalingVersion !== TRAINING_SIGNALING_VERSION) {
    return makeSignalDecision(base, false, "signal-signaling-version-unsupported");
  }
  if (envelope.fromUid !== remoteUid || envelope.toUid !== ownUid) {
    return makeSignalDecision(base, false, "signal-member-mismatch");
  }
  if (envelope.attemptId !== attemptId) {
    return makeSignalDecision(base, false, "signal-attempt-mismatch");
  }
  if (!SIGNAL_TYPES.includes(envelope.type)
      || typeof envelope.payload !== "string"
      || envelope.payload.length < 1
      || envelope.payload.length > 30_000
      || !isTimestamp(envelope.createdAt)) {
    return makeSignalDecision(base, false, "signal-payload-invalid");
  }
  if (now !== null
      && (
        envelope.createdAt < now - 60_000
        || envelope.createdAt > now + 15_000
      )) {
    return makeSignalDecision(base, false, "signal-stale");
  }
  return makeSignalDecision(base, true, "training-signal-v2-current", {
    signalingVersion: TRAINING_SIGNALING_VERSION,
    remoteUid,
    attemptId,
  });
}

export function shouldConsumeTrainingSessionSignal(
  decision,
  { handledSuccessfully, contextStillCurrent } = {},
) {
  return shouldConsumeOnlineSignal(decision, {
    handledSuccessfully,
    contextStillCurrent,
  });
}

export function createTrainingSessionPresencePayload({
  sessionId,
  leaseToken,
  generation,
  online,
  updatedAt,
} = {}) {
  requireSessionId(sessionId, "sessionId");
  requireSessionId(leaseToken, "leaseToken");
  requireSessionGeneration(generation, "generation");
  requireBoolean(online, "online");
  requireTimestamp(updatedAt, "updatedAt");
  return deepFreeze({
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    sessionId,
    leaseToken,
    generation,
    online,
    updatedAt,
  });
}

export function trainingImageRoundsNeedingResend({
  outgoingRoundIndexes = [],
  rounds = {},
  opponentUid = "",
} = {}) {
  if (!Array.isArray(outgoingRoundIndexes)
      || !isRecord(rounds)
      || !SAFE_UID_PATTERN.test(String(opponentUid || ""))) return [];
  return [...new Set(outgoingRoundIndexes)]
    .filter((roundIndex) => (
      Number.isInteger(roundIndex)
        && roundIndex >= 1
        && roundIndex <= 5
        && rounds?.[roundIndex]?.imageReceived?.[opponentUid] !== true
    ))
    .sort((left, right) => left - right);
}

export function createTrainingSessionRecovery({
  matchmakingGeneration,
  roomId,
  sessionId,
  isHost,
  opponentUid,
  startedAt,
  autoRequeueCount = 0,
  visible = true,
  online = true,
  config,
} = {}) {
  requireConnectionGeneration(matchmakingGeneration, "matchmakingGeneration");
  requireRoomId(roomId, "roomId");
  requireSessionId(sessionId, "sessionId");
  requireBoolean(isHost, "isHost");
  requireUid(opponentUid, "opponentUid");
  const generationToken = createOnlineP2pGenerationToken({
    matchmakingGeneration,
    roomId,
    sessionId,
  });
  return createOnlineP2pRecoveryState({
    generationToken,
    isHost,
    opponentUid,
    startedAt,
    autoRequeueCount,
    visible,
    online,
    config,
  });
}

export function trainingSessionRecoveryTimer(recovery) {
  return getOnlineP2pRecoveryTimer(recovery);
}

function recoveryDecision(transition, preserveResult = false) {
  const effects = transition.effects || [];
  const restart = effects.find((effect) => effect.type === "restart-ice");
  const cleanup = effects.find((effect) => effect.type === "cleanup-failed-room");
  const requeue = effects.find((effect) => effect.type === "auto-requeue");
  const failure = effects.find((effect) => effect.type === "show-connection-failure");
  return deepFreeze({
    preserveResult,
    restartIce: Boolean(restart),
    abortRoom: Boolean(cleanup),
    autoRequeue: Boolean(requeue),
    showConnectionFailure: Boolean(failure),
    reason: preserveResult
      ? "final-result-preserved"
      : restart?.reason
        ?? cleanup?.reason
        ?? failure?.reason
        ?? transition.state?.resolution
        ?? transition.state?.failureReason
        ?? (transition.ignored ? "event-ignored" : null),
    autoRequeueCount: requeue?.autoRequeueCount
      ?? transition.state?.autoRequeueCount
      ?? 0,
    opponentCooldown: requeue?.opponentCooldown
      ?? transition.state?.opponentCooldown
      ?? null,
  });
}

export function decideTrainingSessionRecovery(
  recovery,
  event,
  { hasFinalResult = false } = {},
) {
  requireBoolean(hasFinalResult, "hasFinalResult");
  if (!recovery) throw new TypeError("recovery is required");
  if (hasFinalResult) {
    const transition = deepFreeze({
      state: recovery,
      effects: [],
      ignored: true,
    });
    return deepFreeze({
      ...transition,
      decision: recoveryDecision(transition, true),
    });
  }
  const transition = transitionOnlineP2pRecovery(recovery, event);
  return deepFreeze({
    ...transition,
    decision: recoveryDecision(transition),
  });
}
