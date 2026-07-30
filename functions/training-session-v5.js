"use strict";

const PRODUCT_CATALOG = require("./product-catalog");

const TRAINING_SESSION_PROTOCOL_VERSION = 5;
const TRAINING_SIGNALING_VERSION = 5;
const TRAINING_GAME_PROTOCOL_VERSION = 3;
const TRAINING_GAME_VARIANT = "kitaeai_hp_v3";
const TRAINING_ATTEMPT_TTL_MS = 3 * 60_000;
const TRAINING_COMMAND_COUNT = 3;
const TRAINING_IMAGE_COUNT = 5;
const TRAINING_INTENSITIES = Object.freeze(["light", "standard", "strong"]);
const TRAINING_COMMAND_BEATS_PER_REP = Object.freeze([2, 4, 8]);
const TRAINING_ATTEMPT_STATES = Object.freeze([
  "waiting",
  "reserved",
  "active",
  "terminal",
]);
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const ROOM_ID_PATTERN = /^[-0-9A-Z_a-z]{20}$/;
const CHAT_FRAME_IDS = new Set(
  Object.values(PRODUCT_CATALOG)
    .filter((product) => product?.type === "chatFrame")
    .map((product) => product.id),
);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeUid(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !/[\u0000-\u001f\u007f.#$\[\]\/]/.test(value);
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value);
}

function finiteTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function exactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

function exactIndexedKeys(value, count) {
  const expected = Array.from({ length: count }, (_, index) => String(index + 1));
  if (Array.isArray(value)) {
    return value.length === count + 1
      && !Object.hasOwn(value, "0")
      && Object.keys(value).sort().join("\n") === expected.join("\n");
  }
  return exactKeys(value, expected);
}

function normalizedText(value, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return ((!allowEmpty && !normalized) || normalized.length > maximum)
    ? null
    : normalized;
}

function normalizeTrainingCommandDeck(value) {
  if (!exactIndexedKeys(value, TRAINING_COMMAND_COUNT)) return null;
  const result = {};
  for (let index = 1; index <= TRAINING_COMMAND_COUNT; index += 1) {
    const key = String(index);
    const card = value[key];
    if (!exactKeys(card, ["exercise", "completion", "command", "beatsPerRep"])) {
      return null;
    }
    const exercise = normalizedText(card.exercise, 40);
    const completion = normalizedText(card.completion, 60);
    const command = normalizedText(card.command, 120);
    if (exercise == null
        || completion == null
        || command == null
        || !TRAINING_COMMAND_BEATS_PER_REP.includes(card.beatsPerRep)) {
      return null;
    }
    result[key] = {
      exercise,
      completion,
      command,
      beatsPerRep: card.beatsPerRep,
    };
  }
  return result;
}

function normalizeTrainingImageBpms(value) {
  if (!exactIndexedKeys(value, TRAINING_IMAGE_COUNT)) return null;
  const result = {};
  for (let index = 1; index <= TRAINING_IMAGE_COUNT; index += 1) {
    const key = String(index);
    const bpm = value[key];
    if (!Number.isInteger(bpm) || (bpm !== 0 && (bpm < 40 || bpm > 160))) {
      return null;
    }
    result[key] = bpm;
  }
  return result;
}

function normalizeTrainingPreparation(value) {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "name",
    "intensity",
    "conditions",
    "commandDeck",
    "imageBpms",
    "chatFrameId",
  ]);
  if (Reflect.ownKeys(value).some(
    (key) => typeof key !== "string" || !allowed.has(key),
  )) return null;
  if (!["name", "intensity", "commandDeck", "imageBpms"].every(
    (key) => Object.hasOwn(value, key),
  )) return null;
  const name = normalizedText(value.name, 16);
  const conditions = normalizedText(value.conditions || "", 80, { allowEmpty: true });
  const commandDeck = normalizeTrainingCommandDeck(value.commandDeck);
  const imageBpms = normalizeTrainingImageBpms(value.imageBpms);
  const chatFrameId = value.chatFrameId == null || value.chatFrameId === ""
    ? ""
    : typeof value.chatFrameId === "string" && CHAT_FRAME_IDS.has(value.chatFrameId)
      ? value.chatFrameId
      : null;
  if (name == null
      || conditions == null
      || !TRAINING_INTENSITIES.includes(value.intensity)
      || commandDeck == null
      || imageBpms == null
      || chatFrameId == null) return null;
  return {
    name,
    intensity: value.intensity,
    conditions,
    commandDeck,
    imageBpms,
    chatFrameId,
  };
}

const BASE_ATTEMPT_KEYS = Object.freeze([
  "protocolVersion",
  "signalingVersion",
  "uid",
  "runId",
  "endpointId",
  "ownerEpoch",
  "revision",
  "state",
  "preparation",
  "createdAt",
  "updatedAt",
  "lastSeen",
  "queueExpiresAt",
]);
const RESERVATION_KEYS = Object.freeze([
  "roomId",
  "roomAttemptId",
  "transportEpoch",
  "reservedAt",
  "role",
  "opponentUid",
]);
const PENDING_ROOM_CLEANUP_KEYS = Object.freeze([
  "roomId",
  "roomAttemptId",
  "transportEpoch",
  "uid",
  "runId",
  "endpointId",
  "ownerEpoch",
  "role",
  "opponentUid",
  "reason",
  "requestedAt",
]);

function normalizePendingRoomCleanup(value) {
  if (!exactKeys(value, PENDING_ROOM_CLEANUP_KEYS)
      || !ROOM_ID_PATTERN.test(value.roomId)
      || !isSafeToken(value.roomAttemptId)
      || !isSafeToken(value.transportEpoch)
      || !isSafeUid(value.uid)
      || !isSafeToken(value.runId)
      || !isSafeToken(value.endpointId)
      || !isSafeToken(value.ownerEpoch)
      || !["host", "guest"].includes(value.role)
      || !isSafeUid(value.opponentUid)
      || value.opponentUid === value.uid
      || normalizedText(value.reason, 48) == null
      || !finiteTimestamp(value.requestedAt)) return null;
  return structuredClone(value);
}

function normalizeTrainingAttempt(uid, value) {
  if (!isSafeUid(uid) || !isRecord(value)) return null;
  const state = value.state;
  const expected = [
    ...BASE_ATTEMPT_KEYS,
    ...(["reserved", "active"].includes(state) ? RESERVATION_KEYS : []),
    ...(state === "terminal" ? ["terminalReason"] : []),
    ...(Object.hasOwn(value, "pendingRoomCleanup") ? ["pendingRoomCleanup"] : []),
  ];
  if (!exactKeys(value, expected)
      || value.protocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
      || value.signalingVersion !== TRAINING_SIGNALING_VERSION
      || value.uid !== uid
      || !isSafeToken(value.runId)
      || !isSafeToken(value.endpointId)
      || !isSafeToken(value.ownerEpoch)
      || !Number.isSafeInteger(value.revision)
      || value.revision < 1
      || !TRAINING_ATTEMPT_STATES.includes(state)
      || normalizeTrainingPreparation(value.preparation) == null
      || !finiteTimestamp(value.createdAt)
      || !finiteTimestamp(value.updatedAt)
      || !finiteTimestamp(value.lastSeen)
      || !finiteTimestamp(value.queueExpiresAt)
      || value.createdAt > value.updatedAt
      || value.lastSeen > value.updatedAt) return null;
  if (Object.hasOwn(value, "pendingRoomCleanup")
      && normalizePendingRoomCleanup(value.pendingRoomCleanup) == null) return null;
  if (["reserved", "active"].includes(state)
      && (!ROOM_ID_PATTERN.test(value.roomId)
        || !isSafeToken(value.roomAttemptId)
        || !isSafeToken(value.transportEpoch)
        || !finiteTimestamp(value.reservedAt)
        || value.reservedAt < value.createdAt
        || value.reservedAt > value.updatedAt
        || !["host", "guest"].includes(value.role)
        || !isSafeUid(value.opponentUid)
        || value.opponentUid === uid)) return null;
  if (state === "terminal"
      && normalizedText(value.terminalReason, 48) == null) return null;
  return structuredClone(value);
}

function attemptIsQueueFresh(attempt, now) {
  return ["waiting", "reserved"].includes(attempt?.state)
    && finiteTimestamp(now)
    && attempt.queueExpiresAt > now;
}

function attemptIdentityMatches(attempt, {
  runId,
  endpointId,
  ownerEpoch,
} = {}) {
  return Boolean(attempt)
    && attempt.runId === runId
    && attempt.endpointId === endpointId
    && (ownerEpoch == null || attempt.ownerEpoch === ownerEpoch);
}

function waitingAttempt({
  uid,
  runId,
  endpointId,
  ownerEpoch,
  preparation,
  revision,
  now,
  ttlMs,
  pendingRoomCleanup = null,
}) {
  return {
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    uid,
    runId,
    endpointId,
    ownerEpoch,
    revision,
    state: "waiting",
    preparation,
    createdAt: now,
    updatedAt: now,
    lastSeen: now,
    queueExpiresAt: now + ttlMs,
    ...(pendingRoomCleanup ? { pendingRoomCleanup } : {}),
  };
}

function withoutReservation(attempt) {
  const result = { ...attempt };
  for (const key of RESERVATION_KEYS) delete result[key];
  delete result.terminalReason;
  return result;
}

function renewedAttempt(attempt, now, ttlMs, preparation = null) {
  return {
    ...attempt,
    ...(preparation ? { preparation } : {}),
    revision: attempt.revision + 1,
    updatedAt: now,
    lastSeen: now,
    queueExpiresAt: now + ttlMs,
  };
}

function pendingRoomCleanupFromAttempt(attempt, reason, now) {
  if (!attempt
      || !["reserved", "active"].includes(attempt.state)
      || !ROOM_ID_PATTERN.test(String(attempt.roomId || ""))
      || !isSafeToken(attempt.roomAttemptId)
      || !isSafeToken(attempt.transportEpoch)
      || !isSafeUid(attempt.uid)
      || !isSafeToken(attempt.runId)
      || !isSafeToken(attempt.endpointId)
      || !isSafeToken(attempt.ownerEpoch)
      || !["host", "guest"].includes(attempt.role)
      || !isSafeUid(attempt.opponentUid)
      || attempt.opponentUid === attempt.uid
      || normalizedText(reason, 48) == null
      || !finiteTimestamp(now)) return null;
  return {
    roomId: attempt.roomId,
    roomAttemptId: attempt.roomAttemptId,
    transportEpoch: attempt.transportEpoch,
    uid: attempt.uid,
    runId: attempt.runId,
    endpointId: attempt.endpointId,
    ownerEpoch: attempt.ownerEpoch,
    role: attempt.role,
    opponentUid: attempt.opponentUid,
    reason: normalizedText(reason, 48),
    requestedAt: now,
  };
}

function waitingFromReservation(attempt, now, cleanupReason = "") {
  const pendingRoomCleanup = cleanupReason
    ? pendingRoomCleanupFromAttempt(attempt, cleanupReason, now)
    : null;
  return {
    ...withoutReservation(attempt),
    revision: attempt.revision + 1,
    state: "waiting",
    updatedAt: now,
    ...(pendingRoomCleanup ? { pendingRoomCleanup } : {}),
  };
}

function terminalAttempt(
  attempt,
  terminalReason,
  now,
  { seen = false, cleanupReason = "" } = {},
) {
  const pendingRoomCleanup = cleanupReason
    ? pendingRoomCleanupFromAttempt(attempt, cleanupReason, now)
    : null;
  return {
    ...withoutReservation(attempt),
    revision: attempt.revision + 1,
    state: "terminal",
    updatedAt: now,
    ...(seen ? { lastSeen: now } : {}),
    terminalReason,
    ...(pendingRoomCleanup ? { pendingRoomCleanup } : {}),
  };
}

function reciprocalReservation(first, second) {
  return Boolean(first && second)
    && ["reserved", "active"].includes(first.state)
    && ["reserved", "active"].includes(second.state)
    && first.opponentUid === second.uid
    && second.opponentUid === first.uid
    && first.roomId === second.roomId
    && first.roomAttemptId === second.roomAttemptId
    && first.transportEpoch === second.transportEpoch
    && first.role !== second.role;
}

function reservationFenceMatches(current, expected) {
  if (!current || !expected) return false;
  return [
    "protocolVersion",
    "signalingVersion",
    "uid",
    "runId",
    "endpointId",
    "ownerEpoch",
    "revision",
    "state",
    "roomId",
    "roomAttemptId",
    "transportEpoch",
    "reservedAt",
    "role",
    "opponentUid",
  ].every((key) => current[key] === expected[key]);
}

function pendingRoomCleanupMatches(first, second) {
  const normalizedFirst = normalizePendingRoomCleanup(first);
  const normalizedSecond = normalizePendingRoomCleanup(second);
  return Boolean(normalizedFirst && normalizedSecond)
    && PENDING_ROOM_CLEANUP_KEYS.every(
      (key) => normalizedFirst[key] === normalizedSecond[key],
    );
}

function roomMatchesAttemptIdentity(room, attempt) {
  if (!isRecord(room)
      || !attempt
      || room.protocolVersion !== TRAINING_GAME_PROTOCOL_VERSION
      || room.variant !== TRAINING_GAME_VARIANT
      || room.sessionProtocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
      || room.signalingVersion !== TRAINING_SIGNALING_VERSION
      || room.roomAttemptId !== attempt.roomAttemptId
      || room.members?.[attempt.uid] !== true
      || room.sessions?.[attempt.uid]?.runId !== attempt.runId
      || room.sessions?.[attempt.uid]?.endpointId !== attempt.endpointId
      || room.sessions?.[attempt.uid]?.ownerEpoch !== attempt.ownerEpoch) return false;
  return room.hostUid === attempt.uid
    ? attempt.role === "host"
    : room.guestUid === attempt.uid && attempt.role === "guest";
}

function roomMatchesCleanupDescriptor(room, cleanup) {
  const descriptor = normalizePendingRoomCleanup(cleanup);
  return Boolean(descriptor) && roomMatchesAttemptIdentity(room, descriptor)
    && room.transportEpoch === descriptor.transportEpoch;
}

function buildDestroyedTrainingRoomFence(cleanup, now = cleanup?.requestedAt) {
  const descriptor = normalizePendingRoomCleanup(cleanup);
  if (!descriptor || !finiteTimestamp(now)) {
    throw new TypeError("invalid training V5 room cleanup fence");
  }
  const hostUid = descriptor.role === "host"
    ? descriptor.uid
    : descriptor.opponentUid;
  const guestUid = descriptor.role === "guest"
    ? descriptor.uid
    : descriptor.opponentUid;
  return {
    protocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    sessionProtocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    hostUid,
    guestUid,
    roomAttemptId: descriptor.roomAttemptId,
    transportEpoch: descriptor.transportEpoch,
    createdAt: descriptor.requestedAt,
    activatedAt: descriptor.requestedAt,
    status: "destroyed",
    sessions: {
      [descriptor.uid]: {
        runId: descriptor.runId,
        endpointId: descriptor.endpointId,
        ownerEpoch: descriptor.ownerEpoch,
      },
    },
    members: {
      [hostUid]: true,
      [guestUid]: true,
    },
    destroyed: {
      at: now,
      byUid: descriptor.uid,
      reason: descriptor.reason,
    },
  };
}

function convergeReservationDecision({
  attempts,
  uid,
  expected,
  now,
  terminalReason = "room-ended",
  cleanupReason = terminalReason,
  forceTerminal = false,
} = {}) {
  if (!isRecord(attempts)
      || !isSafeUid(uid)
      || !finiteTimestamp(now)
      || normalizedText(terminalReason, 48) == null
      || normalizedText(cleanupReason, 48) == null) {
    throw new TypeError("invalid training V5 convergence input");
  }
  const normalizedExpected = normalizeTrainingAttempt(uid, expected);
  const current = normalizeTrainingAttempt(uid, attempts[uid]);
  if (!normalizedExpected
      || !current
      || !["reserved", "active"].includes(current.state)
      || !reservationFenceMatches(current, normalizedExpected)) {
    return { changed: false, attempts, attempt: current };
  }
  const peer = normalizeTrainingAttempt(
    current.opponentUid,
    attempts[current.opponentUid],
  );
  const reciprocal = reciprocalReservation(current, peer);
  const shouldTerminate = forceTerminal
    || current.state === "active"
    || (reciprocal && peer.state === "active");
  const next = { ...attempts };
  next[uid] = shouldTerminate
    ? terminalAttempt(current, terminalReason, now, {
      cleanupReason,
    })
    : waitingFromReservation(current, now, cleanupReason);
  if (reciprocal) {
    next[peer.uid] = shouldTerminate
      ? terminalAttempt(peer, terminalReason, now)
      : waitingFromReservation(peer, now);
  }
  return {
    changed: true,
    attempts: next,
    attempt: next[uid],
    peer: reciprocal ? next[peer.uid] : peer,
    terminal: shouldTerminate,
    changedCount: reciprocal ? 2 : 1,
  };
}

function reconnectAttemptDecision({
  attempts,
  uid,
  runId,
  endpointId,
  ownerEpoch,
  roomAttemptId,
  transportEpoch,
  nextTransportEpoch,
  rotate = true,
  now,
} = {}) {
  if (!isRecord(attempts)
      || !isSafeUid(uid)
      || !isSafeToken(runId)
      || !isSafeToken(endpointId)
      || !isSafeToken(ownerEpoch)
      || !isSafeToken(roomAttemptId)
      || !isSafeToken(transportEpoch)
      || !isSafeToken(nextTransportEpoch)
      || typeof rotate !== "boolean"
      || !finiteTimestamp(now)) {
    throw new TypeError("invalid training V5 reconnect input");
  }
  const current = normalizeTrainingAttempt(uid, attempts[uid]);
  if (!current) return { outcome: "not-started", attempts, attempt: null };
  if (!attemptIdentityMatches(current, { runId, endpointId, ownerEpoch })) {
    return { outcome: "owner-replaced", attempts, attempt: current };
  }
  if (current.state === "terminal") {
    return { outcome: "terminal", attempts, attempt: current };
  }
  if (current.state !== "active" || current.roomAttemptId !== roomAttemptId) {
    return { outcome: "room-replaced", attempts, attempt: current };
  }
  const peer = normalizeTrainingAttempt(
    current.opponentUid,
    attempts[current.opponentUid],
  );
  if (!reciprocalReservation(current, peer)
      || peer.state !== "active"
      || current.pendingRoomCleanup
      || peer.pendingRoomCleanup) {
    return { outcome: "recovering", attempts, attempt: current, peer };
  }
  if (current.transportEpoch !== transportEpoch || !rotate) {
    return {
      outcome: "active",
      rotated: false,
      attempts,
      attempt: current,
      peer,
    };
  }
  const next = { ...attempts };
  for (const attempt of [current, peer]) {
    next[attempt.uid] = {
      ...attempt,
      revision: attempt.revision + 1,
      updatedAt: now,
      transportEpoch: nextTransportEpoch,
    };
  }
  return {
    outcome: "active",
    rotated: true,
    attempts: next,
    attempt: next[uid],
    peer: next[peer.uid],
    previousTransportEpoch: transportEpoch,
  };
}

function startAttemptDecision({
  attempts,
  uid,
  runId,
  endpointId,
  ownerEpoch,
  preparation,
  now,
  ttlMs = TRAINING_ATTEMPT_TTL_MS,
} = {}) {
  const normalizedPreparation = normalizeTrainingPreparation(preparation);
  if (!isSafeUid(uid)
      || !isSafeToken(runId)
      || !isSafeToken(endpointId)
      || !isSafeToken(ownerEpoch)
      || !normalizedPreparation
      || !finiteTimestamp(now)
      || !Number.isSafeInteger(ttlMs)
      || ttlMs < 1) {
    throw new TypeError("invalid training V5 start input");
  }
  const root = isRecord(attempts) ? attempts : {};
  const current = normalizeTrainingAttempt(uid, root[uid]);
  const sameEndpoint = attemptIdentityMatches(current, { runId, endpointId });
  const peer = current?.state === "reserved"
    ? normalizeTrainingAttempt(current.opponentUid, root[current.opponentUid])
    : null;
  if (current?.pendingRoomCleanup) {
    return {
      allowed: false,
      reason: "cleanup-pending",
      attempts: root,
      attempt: current,
    };
  }
  if (current
      && !sameEndpoint
      && (current.state === "active" || attemptIsQueueFresh(current, now))) {
    return { allowed: false, reason: "owner-replaced", attempts: root };
  }
  if (current && sameEndpoint && current.state !== "terminal") {
    const stale = ["waiting", "reserved"].includes(current.state)
      && !attemptIsQueueFresh(current, now);
    if (current.state === "reserved"
        && (!reciprocalReservation(current, peer)
          || !attemptIsQueueFresh(peer, now))) {
      const next = { ...root };
      const recovered = {
        ...waitingFromReservation(current, now, "reservation-recovered"),
        lastSeen: now,
        queueExpiresAt: now + ttlMs,
        preparation: normalizedPreparation,
      };
      next[uid] = recovered;
      if (reciprocalReservation(current, peer)) {
        next[peer.uid] = waitingFromReservation(peer, now);
      }
      return {
        allowed: true,
        reason: stale ? "reclaimed" : "recovered",
        attempt: recovered,
        attempts: next,
      };
    }
    const renewed = renewedAttempt(
      current,
      now,
      ttlMs,
      current.state === "waiting" ? normalizedPreparation : null,
    );
    return {
      allowed: true,
      reason: stale ? "reclaimed" : current.state === "active" ? "active" : "resumed",
      attempt: renewed,
      attempts: {
        ...root,
        [uid]: renewed,
      },
    };
  }
  const next = { ...root };
  if (reciprocalReservation(current, peer)) {
    next[peer.uid] = waitingFromReservation(peer, now);
  }
  const pendingRoomCleanup = current?.state === "reserved"
    ? pendingRoomCleanupFromAttempt(current, "owner-replaced", now)
    : current?.pendingRoomCleanup || null;
  const nextAttempt = waitingAttempt({
    uid,
    runId,
    endpointId,
    ownerEpoch,
    preparation: normalizedPreparation,
    revision: current ? current.revision + 1 : 1,
    now,
    ttlMs,
    pendingRoomCleanup,
  });
  next[uid] = nextAttempt;
  return {
    allowed: true,
    reason: current && !sameEndpoint ? "replaced-stale" : "started",
    attempt: nextAttempt,
    attempts: next,
  };
}

function heartbeatAttemptDecision({
  current,
  uid,
  runId,
  endpointId,
  ownerEpoch,
  now,
  ttlMs = TRAINING_ATTEMPT_TTL_MS,
} = {}) {
  const attempt = normalizeTrainingAttempt(uid, current);
  if (!isSafeUid(uid)
      || !isSafeToken(runId)
      || !isSafeToken(endpointId)
      || !isSafeToken(ownerEpoch)
      || !finiteTimestamp(now)
      || !Number.isSafeInteger(ttlMs)
      || ttlMs < 1) {
    throw new TypeError("invalid training V5 heartbeat input");
  }
  if (!attempt) return { allowed: false, reason: "not-started", attempt: null };
  if (!attemptIdentityMatches(attempt, { runId, endpointId, ownerEpoch })) {
    return { allowed: false, reason: "owner-replaced", attempt };
  }
  if (attempt.state === "terminal") {
    return { allowed: false, reason: "terminal", attempt };
  }
  const stale = ["waiting", "reserved"].includes(attempt.state)
    && !attemptIsQueueFresh(attempt, now);
  return {
    allowed: true,
    reason: stale ? "reclaimed" : attempt.state === "active" ? "active" : "renewed",
    attempt: renewedAttempt(attempt, now, ttlMs),
  };
}

function reserveMatchDecision({
  attempts,
  uid,
  runId,
  endpointId,
  ownerEpoch,
  roomId,
  roomAttemptId,
  transportEpoch,
  avoidUid = "",
  now,
  ttlMs = TRAINING_ATTEMPT_TTL_MS,
} = {}) {
  if (!isSafeUid(uid)
      || !isSafeToken(runId)
      || !isSafeToken(endpointId)
      || !isSafeToken(ownerEpoch)
      || !ROOM_ID_PATTERN.test(String(roomId || ""))
      || !isSafeToken(roomAttemptId)
      || !isSafeToken(transportEpoch)
      || (avoidUid && !isSafeUid(avoidUid))
      || !finiteTimestamp(now)) {
    throw new TypeError("invalid training V5 match input");
  }
  const root = isRecord(attempts) ? attempts : {};
  const requester = normalizeTrainingAttempt(uid, root[uid]);
  if (!requester) return { outcome: "not-started", attempts: root };
  if (!attemptIdentityMatches(requester, { runId, endpointId, ownerEpoch })) {
    return { outcome: "owner-replaced", attempts: root, attempt: requester };
  }
  if (requester.state === "terminal") {
    return { outcome: "terminal", attempts: root, attempt: requester };
  }
  if (requester.pendingRoomCleanup) {
    return { outcome: "recovering", attempts: root, attempt: requester };
  }
  if (["reserved", "active"].includes(requester.state)) {
    return { outcome: requester.state, attempts: root, attempt: requester };
  }
  if (!attemptIsQueueFresh(requester, now)) {
    return { outcome: "stale", attempts: root, attempt: requester };
  }
  let candidates = Object.entries(root)
    .filter(([candidateUid]) => candidateUid !== uid)
    .map(([candidateUid, value]) => normalizeTrainingAttempt(candidateUid, value))
    .filter((candidate) => candidate?.state === "waiting"
      && !candidate.pendingRoomCleanup
      && attemptIsQueueFresh(candidate, now));
  const alternatives = candidates.filter((candidate) => candidate.uid !== avoidUid);
  if (avoidUid && alternatives.length) candidates = alternatives;
  candidates.sort((first, second) => (
    first.createdAt - second.createdAt || first.uid.localeCompare(second.uid)
  ));
  const guest = candidates[0];
  if (!guest) return { outcome: "waiting", attempts: root, attempt: requester };
  const reserve = (attempt, role, opponentUid, refreshLease) => ({
    ...attempt,
    revision: attempt.revision + 1,
    state: "reserved",
    updatedAt: now,
    ...(refreshLease ? {
      lastSeen: now,
      queueExpiresAt: now + ttlMs,
    } : {}),
    roomId,
    roomAttemptId,
    transportEpoch,
    reservedAt: now,
    role,
    opponentUid,
  });
  const host = reserve(requester, "host", guest.uid, true);
  const reservedGuest = reserve(guest, "guest", uid, false);
  return {
    outcome: "reserved",
    attempt: host,
    host,
    guest: reservedGuest,
    attempts: {
      ...root,
      [uid]: host,
      [guest.uid]: reservedGuest,
    },
  };
}

function activateMatchDecision({ attempts, uid, roomAttemptId, now } = {}) {
  if (!isRecord(attempts)
      || !isSafeUid(uid)
      || !isSafeToken(roomAttemptId)
      || !finiteTimestamp(now)) {
    throw new TypeError("invalid training V5 activation input");
  }
  const first = normalizeTrainingAttempt(uid, attempts[uid]);
  const second = first
    ? normalizeTrainingAttempt(first.opponentUid, attempts[first.opponentUid])
    : null;
  if (!reciprocalReservation(first, second)
      || first.roomAttemptId !== roomAttemptId) {
    return { activated: false, attempts };
  }
  const staleReservation = [first, second].some((attempt) => (
    attempt.state === "reserved" && !attemptIsQueueFresh(attempt, now)
  ));
  if (staleReservation) {
    const convergence = convergeReservationDecision({
      attempts,
      uid,
      expected: first,
      now,
      terminalReason: "reservation-stale",
      cleanupReason: "reservation-stale",
    });
    return {
      activated: false,
      changed: convergence.changed,
      stale: true,
      attempts: convergence.attempts,
      first: convergence.attempt,
      second: convergence.peer,
    };
  }
  if (first.state === "active" && second.state === "active") {
    return { activated: true, alreadyActive: true, attempts, first, second };
  }
  const next = { ...attempts };
  for (const attempt of [first, second]) {
    next[attempt.uid] = attempt.state === "active"
      ? attempt
      : {
        ...attempt,
        revision: attempt.revision + 1,
        state: "active",
        updatedAt: now,
      };
  }
  return {
    activated: true,
    alreadyActive: false,
    attempts: next,
    first: next[first.uid],
    second: next[second.uid],
  };
}

function cancelAttemptDecision({
  attempts,
  uid,
  runId,
  endpointId,
  ownerEpoch,
  now,
  ttlMs = TRAINING_ATTEMPT_TTL_MS,
} = {}) {
  if (!isRecord(attempts)
      || !isSafeUid(uid)
      || !isSafeToken(runId)
      || !isSafeToken(endpointId)
      || !isSafeToken(ownerEpoch)
      || !finiteTimestamp(now)) {
    throw new TypeError("invalid training V5 cancel input");
  }
  const current = normalizeTrainingAttempt(uid, attempts[uid]);
  if (!current) return { cancelled: false, reason: "not-started", attempts };
  if (!attemptIdentityMatches(current, { runId, endpointId, ownerEpoch })) {
    return { cancelled: false, reason: "owner-replaced", attempts };
  }
  if (current.state === "terminal") {
    return { cancelled: true, reason: current.terminalReason, attempts, attempt: current };
  }
  const next = { ...attempts };
  const reservation = ["reserved", "active"].includes(current.state)
    ? current
    : null;
  const peer = reservation
    ? normalizeTrainingAttempt(current.opponentUid, attempts[current.opponentUid])
    : null;
  next[uid] = terminalAttempt(current, "cancelled", now, {
    seen: true,
    cleanupReason: reservation ? "cancelled" : "",
  });
  if (reciprocalReservation(current, peer)) {
    next[peer.uid] = current.state === "reserved" && peer.state === "reserved"
      ? waitingFromReservation(peer, now)
      : terminalAttempt(peer, "opponent-cancelled", now);
  }
  return {
    cancelled: true,
    reason: "cancelled",
    attempts: next,
    attempt: next[uid],
    reservation,
    peer,
  };
}

function trainingPlayerFromAttempt(attempt) {
  const preparation = normalizeTrainingPreparation(attempt?.preparation);
  if (!preparation) throw new TypeError("invalid training V5 player");
  return {
    uid: attempt.uid,
    name: preparation.name,
    intensity: preparation.intensity,
    conditions: preparation.conditions,
    commandDeck: preparation.commandDeck,
    imageBpms: preparation.imageBpms,
  };
}

function buildActiveTrainingRoom({
  host,
  guest,
  chatFrames,
  now,
} = {}) {
  if (!reciprocalReservation(host, guest)
      || host.role !== "host"
      || guest.role !== "guest"
      || !finiteTimestamp(now)
      || !exactKeys(chatFrames, [host.uid, guest.uid])
      || ![host.uid, guest.uid].every((uid) => (
        chatFrames[uid] === "" || CHAT_FRAME_IDS.has(chatFrames[uid])
      ))) {
    throw new TypeError("invalid training V5 room input");
  }
  const createdAt = Math.min(host.reservedAt, guest.reservedAt);
  return {
    protocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    sessionProtocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    signalingVersion: TRAINING_SIGNALING_VERSION,
    hostUid: host.uid,
    guestUid: guest.uid,
    roomAttemptId: host.roomAttemptId,
    transportEpoch: host.transportEpoch,
    createdAt,
    activatedAt: createdAt,
    status: "active",
    sessions: {
      [host.uid]: {
        runId: host.runId,
        endpointId: host.endpointId,
        ownerEpoch: host.ownerEpoch,
      },
      [guest.uid]: {
        runId: guest.runId,
        endpointId: guest.endpointId,
        ownerEpoch: guest.ownerEpoch,
      },
    },
    members: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    players: {
      [host.uid]: trainingPlayerFromAttempt(host),
      [guest.uid]: trainingPlayerFromAttempt(guest),
    },
    chatFrames: structuredClone(chatFrames),
    accepted: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    rounds: {
      1: { createdAt },
    },
  };
}

function roomMatchesAttempt(room, attempt) {
  return roomMatchesAttemptIdentity(room, attempt)
    && room.transportEpoch === attempt.transportEpoch;
}

module.exports = Object.freeze({
  CHAT_FRAME_IDS,
  PENDING_ROOM_CLEANUP_KEYS,
  RESERVATION_KEYS,
  ROOM_ID_PATTERN,
  TRAINING_ATTEMPT_STATES,
  TRAINING_ATTEMPT_TTL_MS,
  TRAINING_COMMAND_BEATS_PER_REP,
  TRAINING_COMMAND_COUNT,
  TRAINING_GAME_PROTOCOL_VERSION,
  TRAINING_GAME_VARIANT,
  TRAINING_IMAGE_COUNT,
  TRAINING_INTENSITIES,
  TRAINING_SESSION_PROTOCOL_VERSION,
  TRAINING_SIGNALING_VERSION,
  activateMatchDecision,
  attemptIdentityMatches,
  attemptIsQueueFresh,
  buildActiveTrainingRoom,
  buildDestroyedTrainingRoomFence,
  cancelAttemptDecision,
  convergeReservationDecision,
  heartbeatAttemptDecision,
  isSafeToken,
  isSafeUid,
  normalizeTrainingAttempt,
  normalizePendingRoomCleanup,
  normalizeTrainingCommandDeck,
  normalizeTrainingImageBpms,
  normalizeTrainingPreparation,
  pendingRoomCleanupFromAttempt,
  pendingRoomCleanupMatches,
  reciprocalReservation,
  reconnectAttemptDecision,
  reservationFenceMatches,
  reserveMatchDecision,
  roomMatchesAttemptIdentity,
  roomMatchesAttempt,
  roomMatchesCleanupDescriptor,
  startAttemptDecision,
  terminalAttempt,
  waitingFromReservation,
});
