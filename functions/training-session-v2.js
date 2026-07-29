"use strict";

const {
  SOLO_ROOM_TRANSITION_TTL_MS,
  SOLO_SESSION_MATCH_TTL_MS,
  SOLO_SESSION_PROTOCOL_VERSION,
  SOLO_SESSION_QUEUE_FRESH_MS,
  SOLO_SIGNALING_VERSION,
  claimDecision: soloClaimDecision,
  claimMatches,
  heartbeatDecision: soloHeartbeatDecision,
  isSafeToken,
  isSafeUid,
  materializationFenceMatches,
  normalizeClaim,
  publicClaimLease,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomTransitionOwned,
} = require("./solo-session-v2");
const PRODUCT_CATALOG = require("./product-catalog");

const TRAINING_SESSION_PATH_GENERATION = 4;
const TRAINING_SESSION_PROTOCOL_VERSION = SOLO_SESSION_PROTOCOL_VERSION;
const TRAINING_SIGNALING_VERSION = SOLO_SIGNALING_VERSION;
const TRAINING_GAME_PROTOCOL_VERSION = 3;
const TRAINING_GAME_VARIANT = "kitaeai_hp_v3";
const TRAINING_SESSION_LEASE_TTL_MS = 3 * 60_000;
const TRAINING_SESSION_RESOURCE_EXPIRY_MAX_MS =
  TRAINING_SESSION_LEASE_TTL_MS + 30_000;
const TRAINING_SESSION_QUEUE_FRESH_MS = SOLO_SESSION_QUEUE_FRESH_MS;
const TRAINING_SESSION_MATCH_TTL_MS = SOLO_SESSION_MATCH_TTL_MS;
const TRAINING_ROOM_TRANSITION_TTL_MS = SOLO_ROOM_TRANSITION_TTL_MS;
const TRAINING_COMMAND_COUNT = 3;
const TRAINING_IMAGE_COUNT = 5;
const TRAINING_INTENSITIES = Object.freeze(["light", "standard", "strong"]);
const TRAINING_COMMAND_BEATS_PER_REP = Object.freeze([2, 4, 8]);
const TRAINING_CHAT_FRAME_IDS = Object.freeze(
  Object.values(PRODUCT_CATALOG)
    .filter((product) => product?.type === "chatFrame")
    .map((product) => product.id),
);
const TRAINING_CHAT_FRAME_ID_SET = new Set(TRAINING_CHAT_FRAME_IDS);
const ROOM_ID_PATTERN = /^[-0-9A-Z_a-z]{20}$/;

function claimDecision(options = {}) {
  return soloClaimDecision({
    ...options,
    ttlMs: options.ttlMs ?? TRAINING_SESSION_LEASE_TTL_MS,
    maxTtlMs: TRAINING_SESSION_RESOURCE_EXPIRY_MAX_MS,
  });
}

function heartbeatDecision(options = {}) {
  return soloHeartbeatDecision({
    ...options,
    ttlMs: options.ttlMs ?? TRAINING_SESSION_LEASE_TTL_MS,
  });
}

const TRAINING_QUEUE_BASE_KEYS = Object.freeze([
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
const TRAINING_QUEUE_RESERVED_KEYS = Object.freeze([
  ...TRAINING_QUEUE_BASE_KEYS,
  "attemptId",
  "roomId",
]);
const TRAINING_QUEUE_CHAT_FRAME_KEY = "chatFrameId";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).sort().join("\n") === [...expected].sort().join("\n");
}

function exactIndexedKeys(value, count) {
  const expected = Array.from(
    { length: count },
    (_, index) => String(index + 1),
  );
  if (!Array.isArray(value)) return exactKeys(value, expected);
  return value.length === count + 1
    && Object.keys(value).sort().join("\n") === expected.join("\n");
}

function normalizedText(value, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string"
      || !Number.isSafeInteger(maximum)
      || maximum < 0
      || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function normalizeTrainingSessionConditions(value) {
  return normalizedText(value, 80, { allowEmpty: true });
}

function normalizeTrainingChatFrameId(value) {
  if (value === "") return "";
  return typeof value === "string" && TRAINING_CHAT_FRAME_ID_SET.has(value)
    ? value
    : null;
}

function normalizeTrainingSessionPreparation(value) {
  const baseKeys = [
    "name",
    "intensity",
    "commandDeck",
    "imageBpms",
  ];
  const hasChatFrameId = isRecord(value)
    && Object.hasOwn(value, TRAINING_QUEUE_CHAT_FRAME_KEY);
  if (!exactKeys(
    value,
    hasChatFrameId
      ? [...baseKeys, TRAINING_QUEUE_CHAT_FRAME_KEY]
      : baseKeys,
  )) return null;
  const name = normalizedText(value.name, 16);
  const commandDeck = normalizeTrainingCommandDeck(value.commandDeck);
  const imageBpms = normalizeTrainingImageBpms(value.imageBpms);
  const chatFrameId = hasChatFrameId
    ? normalizeTrainingChatFrameId(value.chatFrameId)
    : "";
  if (name == null
      || !TRAINING_INTENSITIES.includes(value.intensity)
      || commandDeck == null
      || imageBpms == null
      || chatFrameId == null) return null;
  return {
    name,
    intensity: value.intensity,
    commandDeck,
    imageBpms,
    ...(hasChatFrameId ? { chatFrameId } : {}),
  };
}

function normalizeTrainingCommandDeck(value) {
  const expectedKeys = Array.from(
    { length: TRAINING_COMMAND_COUNT },
    (_, index) => String(index + 1),
  );
  if (!exactIndexedKeys(value, TRAINING_COMMAND_COUNT)) return null;
  const result = {};
  for (const cardIndex of expectedKeys) {
    const card = value[cardIndex];
    if (!exactKeys(card, ["exercise", "completion", "command", "beatsPerRep"])) {
      return null;
    }
    const exercise = normalizedText(card.exercise, 40);
    const completion = normalizedText(card.completion, 60);
    const command = normalizedText(card.command, 120);
    const beatsPerRep = Number(card.beatsPerRep);
    if (exercise == null
        || completion == null
        || command == null
        || !TRAINING_COMMAND_BEATS_PER_REP.includes(beatsPerRep)) {
      return null;
    }
    result[cardIndex] = {
      exercise,
      completion,
      command,
      beatsPerRep,
    };
  }
  return result;
}

function normalizeTrainingImageBpms(value) {
  const expectedKeys = Array.from(
    { length: TRAINING_IMAGE_COUNT },
    (_, index) => String(index + 1),
  );
  if (!exactIndexedKeys(value, TRAINING_IMAGE_COUNT)) return null;
  const result = {};
  for (const imageIndex of expectedKeys) {
    const bpm = value[imageIndex];
    if (!Number.isInteger(bpm) || (bpm !== 0 && (bpm < 40 || bpm > 160))) {
      return null;
    }
    result[imageIndex] = bpm;
  }
  return result;
}

function safeConnectionGeneration(value) {
  return isSafeToken(value)
    || (Number.isSafeInteger(value) && value > 0);
}

function trainingQueueEntryShape(
  uid,
  sessionId,
  value,
  now,
  {
    allowedStates = ["waiting"],
    freshMs = TRAINING_SESSION_QUEUE_FRESH_MS,
  } = {},
) {
  const state = typeof value?.state === "string" ? value.state : "";
  const reserved = state === "offering" || state === "reserved";
  const baseExpectedKeys = reserved
    ? TRAINING_QUEUE_RESERVED_KEYS
    : TRAINING_QUEUE_BASE_KEYS;
  const hasChatFrameId = isRecord(value)
    && Object.hasOwn(value, TRAINING_QUEUE_CHAT_FRAME_KEY);
  const expectedKeys = hasChatFrameId
    ? [...baseExpectedKeys, TRAINING_QUEUE_CHAT_FRAME_KEY]
    : baseExpectedKeys;
  if (!isSafeUid(uid)
      || !isSafeToken(sessionId)
      || !isRecord(value)
      || !exactKeys(value, expectedKeys)
      || value.protocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
      || value.trainingProtocolVersion !== TRAINING_GAME_PROTOCOL_VERSION
      || value.variant !== TRAINING_GAME_VARIANT
      || value.uid !== uid
      || value.sessionId !== sessionId
      || !isSafeToken(value.leaseToken)
      || !isSafeToken(value.generation)
      || !safeConnectionGeneration(value.connectionGeneration)
      || !TRAINING_INTENSITIES.includes(value.intensity)
      || !allowedStates.includes(state)
      || !finiteTimestamp(now)
      || !Number.isSafeInteger(freshMs)
      || freshMs < 1
      || !finiteTimestamp(value.joinedAt)
      || value.joinedAt < now - (24 * 60 * 60 * 1000)
      || value.joinedAt > now + 15_000
      || !finiteTimestamp(value.lastSeen)
      || value.lastSeen < now - freshMs
      || value.lastSeen > now + 15_000
      || !finiteTimestamp(value.expiresAt)
      || value.expiresAt <= now
      || value.expiresAt > now + TRAINING_SESSION_RESOURCE_EXPIRY_MAX_MS) {
    return null;
  }
  const name = normalizedText(value.name, 16);
  const commandDeck = normalizeTrainingCommandDeck(value.commandDeck);
  const imageBpms = normalizeTrainingImageBpms(value.imageBpms);
  const chatFrameId = hasChatFrameId
    ? normalizeTrainingChatFrameId(value.chatFrameId)
    : "";
  if (name == null
      || commandDeck == null
      || imageBpms == null
      || chatFrameId == null) return null;
  if (reserved
      && (!ROOM_ID_PATTERN.test(String(value.roomId || ""))
        || !isSafeToken(value.attemptId))) return null;
  return {
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    trainingProtocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    uid,
    sessionId,
    leaseToken: value.leaseToken,
    generation: value.generation,
    connectionGeneration: value.connectionGeneration,
    name,
    intensity: value.intensity,
    commandDeck,
    imageBpms,
    ...(hasChatFrameId ? { chatFrameId } : {}),
    joinedAt: value.joinedAt,
    lastSeen: value.lastSeen,
    expiresAt: value.expiresAt,
    state,
    ...(reserved ? {
      roomId: value.roomId,
      attemptId: value.attemptId,
    } : {}),
  };
}

function normalizeTrainingSessionQueueEntry(
  uid,
  sessionId,
  value,
  claim,
  now,
  options = {},
) {
  const entry = trainingQueueEntryShape(uid, sessionId, value, now, options);
  if (!entry
      || !claimMatches(claim, {
        sessionId,
        leaseToken: entry.leaseToken,
        generation: entry.generation,
        now,
      })
      || entry.expiresAt !== normalizeClaim(claim)?.expiresAt) {
    return null;
  }
  return entry;
}

function trainingSessionQueueEntryMatchesClaim(
  uid,
  sessionId,
  value,
  claim,
  now,
  options = {},
) {
  return normalizeTrainingSessionQueueEntry(
    uid,
    sessionId,
    value,
    claim,
    now,
    options,
  ) != null;
}

function flattenFreshTrainingQueueV4(queueV4, claims, now, options = {}) {
  const result = {};
  for (const [uid, sessions] of Object.entries(isRecord(queueV4) ? queueV4 : {})) {
    const claim = claims?.[uid];
    const sessionId = normalizeClaim(claim)?.sessionId;
    const entry = sessionId && sessions?.[sessionId];
    const normalized = normalizeTrainingSessionQueueEntry(
      uid,
      sessionId,
      entry,
      claim,
      now,
      options,
    );
    if (normalized) result[uid] = normalized;
  }
  return result;
}

function trainingSessionRecordAttemptMatches(value, expected) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.signalingVersion === TRAINING_SIGNALING_VERSION
    && value.attemptId === expected?.attemptId
    && value.connectionGeneration === expected?.connectionGeneration;
}

function trainingSessionRoomAttemptMatches(value, expected) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_GAME_PROTOCOL_VERSION
    && value.variant === TRAINING_GAME_VARIANT
    && value.sessionProtocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.signalingVersion === TRAINING_SIGNALING_VERSION
    && value.attemptId === expected?.attemptId
    && value.connectionGeneration === expected?.connectionGeneration;
}

function trainingSessionRoomMatches(room, {
  uid,
  sessionId,
  generation,
  roomId,
  attemptId = "",
} = {}) {
  return ROOM_ID_PATTERN.test(String(roomId || ""))
    && trainingSessionRoomAttemptMatches(room, {
      attemptId: attemptId || room?.attemptId,
      connectionGeneration: room?.connectionGeneration,
    })
    && (!attemptId || room.attemptId === attemptId)
    && room.members?.[uid] === true
    && room.sessions?.[uid]?.sessionId === sessionId
    && room.sessions?.[uid]?.generation === generation;
}

function trainingSessionActiveEntryIsFresh(uid, value, claim, now) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.uid === uid
    && isSafeToken(value.sessionId)
    && isSafeToken(value.leaseToken)
    && isSafeToken(value.generation)
    && isSafeToken(value.attemptId)
    && isSafeToken(value.connectionGeneration)
    && ROOM_ID_PATTERN.test(String(value.roomId || ""))
    && finiteTimestamp(value.expiresAt)
    && value.expiresAt > now
    && claimMatches(claim, {
      sessionId: value.sessionId,
      leaseToken: value.leaseToken,
      generation: value.generation,
      now,
    });
}

function trainingSessionActiveUidSet(activeV4, claims, now) {
  const result = new Set();
  for (const [uid, sessions] of Object.entries(isRecord(activeV4) ? activeV4 : {})) {
    if (Object.values(isRecord(sessions) ? sessions : {}).some(
      (entry) => trainingSessionActiveEntryIsFresh(uid, entry, claims?.[uid], now),
    )) result.add(uid);
  }
  return result;
}

function selectTrainingSessionMatch({
  requesterUid,
  queue,
  activeUids = [],
  lockedUids = [],
  avoidUid = "",
} = {}) {
  const requester = queue?.[requesterUid];
  if (!requester || requester.uid !== requesterUid) return null;
  const unavailable = new Set([...activeUids, ...lockedUids]);
  if (unavailable.has(requesterUid)) return null;
  let candidates = Object.values(isRecord(queue) ? queue : {})
    .filter((candidate) => (
      candidate?.uid
      && candidate.uid !== requesterUid
      && !unavailable.has(candidate.uid)
    ));
  const alternatives = candidates.filter((candidate) => candidate.uid !== avoidUid);
  if (avoidUid && alternatives.length) candidates = alternatives;
  candidates.sort((first, second) => (
    Number(first.joinedAt) - Number(second.joinedAt)
    || first.uid.localeCompare(second.uid)
  ));
  return candidates[0] ? {
    host: requester,
    candidate: candidates[0],
  } : null;
}

function trainingSessionPlayerFromQueue(entry, conditions = "") {
  const normalizedConditions = normalizeTrainingSessionConditions(conditions);
  if (!entry
      || !isSafeUid(entry.uid)
      || normalizedConditions == null
      || normalizedText(entry.name, 16) == null
      || !TRAINING_INTENSITIES.includes(entry.intensity)
      || normalizeTrainingCommandDeck(entry.commandDeck) == null
      || normalizeTrainingImageBpms(entry.imageBpms) == null) {
    throw new TypeError("invalid training session player");
  }
  return {
    uid: entry.uid,
    name: normalizedText(entry.name, 16),
    intensity: entry.intensity,
    conditions: normalizedConditions,
    commandDeck: normalizeTrainingCommandDeck(entry.commandDeck),
    imageBpms: normalizeTrainingImageBpms(entry.imageBpms),
  };
}

function trainingSessionFromQueue(entry) {
  return {
    sessionId: entry.sessionId,
    generation: entry.generation,
  };
}

function normalizeTrainingChatFrames(value, hostUid, guestUid) {
  if (!isSafeUid(hostUid)
      || !isSafeUid(guestUid)
      || hostUid === guestUid
      || !exactKeys(value, [hostUid, guestUid])) return null;
  const hostFrameId = normalizeTrainingChatFrameId(value[hostUid]);
  const guestFrameId = normalizeTrainingChatFrameId(value[guestUid]);
  if (hostFrameId == null || guestFrameId == null) return null;
  return {
    [hostUid]: hostFrameId,
    [guestUid]: guestFrameId,
  };
}

function buildTrainingSessionResources({
  roomId,
  attemptId,
  connectionGeneration,
  host,
  guest,
  hostConditions = "",
  chatFrames = null,
  now,
  expiresAt = now + TRAINING_SESSION_MATCH_TTL_MS,
} = {}) {
  if (!ROOM_ID_PATTERN.test(String(roomId || ""))
      || !isSafeToken(attemptId)
      || !isSafeToken(connectionGeneration)
      || !resourceFenceMatches(host, host)
      || !resourceFenceMatches(guest, guest)
      || !isSafeUid(host?.uid)
      || !isSafeUid(guest?.uid)
      || host.uid === guest.uid
      || !finiteTimestamp(now)
      || !finiteTimestamp(expiresAt)
      || expiresAt <= now) {
    throw new TypeError("invalid training session resource input");
  }
  const hostPlayer = trainingSessionPlayerFromQueue(host, hostConditions);
  const guestPlayer = trainingSessionPlayerFromQueue(guest, "");
  const normalizedChatFrames = normalizeTrainingChatFrames(
    chatFrames ?? {
      [host.uid]: "",
      [guest.uid]: "",
    },
    host.uid,
    guest.uid,
  );
  if (!normalizedChatFrames) {
    throw new TypeError("invalid training chat frames");
  }
  const sessions = {
    [host.uid]: trainingSessionFromQueue(host),
    [guest.uid]: trainingSessionFromQueue(guest),
  };
  const players = {
    [host.uid]: hostPlayer,
    [guest.uid]: guestPlayer,
  };
  const sessionCommon = {
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    trainingProtocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    hostUid: host.uid,
    guestUid: guest.uid,
    attemptId,
    connectionGeneration,
    createdAt: now,
    expiresAt,
    sessions,
  };
  const permit = {
    ...sessionCommon,
    players,
  };
  const room = {
    protocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    sessionProtocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    hostUid: host.uid,
    guestUid: guest.uid,
    attemptId,
    connectionGeneration,
    createdAt: now,
    expiresAt,
    status: "offered",
    sessions,
    members: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    players,
    chatFrames: normalizedChatFrames,
    accepted: {
      [host.uid]: true,
    },
  };
  const active = (entry, role) => ({
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    uid: entry.uid,
    sessionId: entry.sessionId,
    leaseToken: entry.leaseToken,
    generation: entry.generation,
    roomId,
    attemptId,
    connectionGeneration,
    role,
    lastSeen: now,
    expiresAt,
  });
  const lock = (entry, role) => ({
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    roomId,
    attemptId,
    role,
    sessionId: entry.sessionId,
    generation: entry.generation,
    hostUid: host.uid,
    guestUid: guest.uid,
    acquiredAt: now,
    expiresAt,
  });
  const offer = {
    ...sessionCommon,
    roomId,
    fromUid: host.uid,
    toUid: guest.uid,
    fromSessionId: host.sessionId,
    toSessionId: guest.sessionId,
    fromName: hostPlayer.name,
  };
  return {
    permit,
    room,
    hostActive: active(host, "host"),
    guestActive: active(guest, "guest"),
    hostLock: lock(host, "host"),
    guestLock: lock(guest, "guest"),
    offer,
  };
}

function trainingSessionActiveMatchesRoom(value, uid, session, roomId, room) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.uid === uid
    && value.sessionId === session?.sessionId
    && value.generation === session?.generation
    && isSafeToken(value.leaseToken)
    && value.roomId === roomId
    && value.attemptId === room?.attemptId
    && value.connectionGeneration === room?.connectionGeneration;
}

function trainingSessionQueueMatchesRoom(value, uid, session, roomId, room) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.uid === uid
    && value.sessionId === session?.sessionId
    && value.generation === session?.generation
    && isSafeToken(value.leaseToken)
    && value.roomId === roomId
    && value.attemptId === room?.attemptId
    && ["offering", "reserved"].includes(value.state);
}

function trainingSessionLockMatches(value, expected) {
  return isRecord(value)
    && value.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
    && value.roomId === expected?.roomId
    && value.attemptId === expected?.attemptId
    && value.role === expected?.role
    && value.sessionId === expected?.sessionId
    && value.generation === expected?.generation
    && value.hostUid === expected?.hostUid
    && value.guestUid === expected?.guestUid;
}

function trainingSessionRecordSessionsMatch(value, resources) {
  const hostUid = resources?.permit?.hostUid;
  const guestUid = resources?.permit?.guestUid;
  return trainingSessionRecordAttemptMatches(value, resources?.permit)
    && value?.sessions?.[hostUid]?.sessionId
      === resources?.permit?.sessions?.[hostUid]?.sessionId
    && value?.sessions?.[hostUid]?.generation
      === resources?.permit?.sessions?.[hostUid]?.generation
    && value?.sessions?.[guestUid]?.sessionId
      === resources?.permit?.sessions?.[guestUid]?.sessionId
    && value?.sessions?.[guestUid]?.generation
      === resources?.permit?.sessions?.[guestUid]?.generation;
}

function trainingSessionMaterializationFenceMatches(value) {
  return materializationFenceMatches(value);
}

function trainingSessionTransitionExpected(resources) {
  return {
    attemptId: resources?.hostLock?.attemptId,
    connectionGeneration: resources?.permit?.connectionGeneration,
  };
}

function decideTrainingSessionRoomTransition({
  room,
  expected,
  action,
  token,
  now,
  allowActiveCancel = false,
  allowActiveAccept = false,
} = {}) {
  if (!["accept", "cancel", "expire"].includes(action)
      || !isSafeToken(token)
      || !finiteTimestamp(now)
      || typeof allowActiveCancel !== "boolean"
      || typeof allowActiveAccept !== "boolean") {
    throw new TypeError("invalid training room transition input");
  }
  if (!trainingSessionRoomAttemptMatches(room, expected)) {
    return { allowed: false, reason: "room-changed", room: null };
  }
  let replacedStaleTransition = false;
  if (room.matchTransition) {
    if (roomTransitionOwned(room, action, token)) {
      return { allowed: true, reason: "already-owned", room };
    }
    const startedAt = Number(room.matchTransition.startedAt);
    if (!finiteTimestamp(startedAt)
        || startedAt > now
        || startedAt > now - TRAINING_ROOM_TRANSITION_TTL_MS) {
      return { allowed: false, reason: "transition-busy", room: null };
    }
    replacedStaleTransition = true;
  }
  if (room.destroyed
      && !(action === "cancel" && allowActiveCancel && room.status === "active")) {
    return { allowed: false, reason: "room-destroyed", room: null };
  }
  if (action === "accept"
      && room.status !== "offered"
      && !(allowActiveAccept && room.status === "active")) {
    return { allowed: false, reason: "not-offered", room: null };
  }
  if (action === "expire" && room.status !== "offered") {
    return { allowed: false, reason: room.status === "active" ? "active" : "terminal", room: null };
  }
  if (action === "cancel"
      && room.status !== "offered"
      && !(allowActiveCancel && room.status === "active")) {
    return { allowed: false, reason: room.status === "active" ? "active" : "terminal", room: null };
  }
  return {
    allowed: true,
    reason: replacedStaleTransition ? "acquired-after-stale" : "acquired",
    room: {
      ...room,
      matchTransition: {
        action,
        token,
        startedAt: now,
      },
    },
  };
}

function activateTrainingSessionRoom(room, {
  expected,
  transitionToken,
  guestUid,
  conditions = "",
  now,
} = {}) {
  const normalizedConditions = normalizeTrainingSessionConditions(conditions);
  if (normalizedConditions == null
      || !finiteTimestamp(now)
      || !trainingSessionRoomAttemptMatches(room, expected)
      || !roomTransitionOwned(room, "accept", transitionToken)
      || room.destroyed
      || !["offered", "active"].includes(room.status)
      || guestUid !== room.guestUid
      || room.members?.[guestUid] !== true
      || room.players?.[guestUid]?.uid !== guestUid) {
    return null;
  }
  return {
    ...room,
    status: "active",
    activatedAt: Number(room.activatedAt || now),
    players: {
      ...room.players,
      [guestUid]: {
        ...room.players[guestUid],
        conditions: normalizedConditions,
      },
    },
    accepted: {
      ...room.accepted,
      [guestUid]: true,
    },
    matchTransition: {
      ...room.matchTransition,
      startedAt: now,
    },
  };
}

module.exports = Object.freeze({
  TRAINING_COMMAND_BEATS_PER_REP,
  TRAINING_COMMAND_COUNT,
  TRAINING_CHAT_FRAME_IDS,
  TRAINING_GAME_PROTOCOL_VERSION,
  TRAINING_GAME_VARIANT,
  TRAINING_IMAGE_COUNT,
  TRAINING_INTENSITIES,
  TRAINING_ROOM_TRANSITION_TTL_MS,
  TRAINING_SESSION_LEASE_TTL_MS,
  TRAINING_SESSION_MATCH_TTL_MS,
  TRAINING_SESSION_PATH_GENERATION,
  TRAINING_SESSION_PROTOCOL_VERSION,
  TRAINING_SESSION_QUEUE_FRESH_MS,
  TRAINING_SESSION_RESOURCE_EXPIRY_MAX_MS,
  TRAINING_SIGNALING_VERSION,
  activateTrainingSessionRoom,
  buildTrainingSessionResources,
  claimDecision,
  claimMatches,
  decideTrainingSessionRoomTransition,
  flattenFreshTrainingQueueV4,
  heartbeatDecision,
  materializationFenceMatches,
  normalizeClaim,
  normalizeTrainingCommandDeck,
  normalizeTrainingChatFrameId,
  normalizeTrainingChatFrames,
  normalizeTrainingImageBpms,
  normalizeTrainingSessionPreparation,
  normalizeTrainingSessionConditions,
  normalizeTrainingSessionQueueEntry,
  publicClaimLease,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomTransitionOwned,
  selectTrainingSessionMatch,
  trainingSessionActiveEntryIsFresh,
  trainingSessionActiveMatchesRoom,
  trainingSessionActiveUidSet,
  trainingSessionLockMatches,
  trainingSessionMaterializationFenceMatches,
  trainingSessionPlayerFromQueue,
  trainingSessionQueueEntryMatchesClaim,
  trainingSessionQueueMatchesRoom,
  trainingSessionRecordAttemptMatches,
  trainingSessionRecordSessionsMatch,
  trainingSessionRoomAttemptMatches,
  trainingSessionRoomMatches,
  trainingSessionTransitionExpected,
});
