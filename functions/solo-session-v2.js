"use strict";

const {
  SOLO_FAMILIAR_REUNION_COOLDOWN_MS,
  isValidSoloServerQueueEntry,
  soloFamiliarPairId,
  soloQueuePreferenceTier,
} = require("./solo-familiar");

const SOLO_SESSION_PROTOCOL_VERSION = 2;
const SOLO_SIGNALING_VERSION = 2;
const SOLO_SESSION_LEASE_TTL_MS = 60_000;
const SOLO_SESSION_QUEUE_FRESH_MS = 45_000;
const SOLO_SESSION_MATCH_TTL_MS = 60_000;
const SOLO_ROOM_TRANSITION_TTL_MS = 30_000;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN_PATTERN.test(value);
}

function isSafeUid(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !/[\u0000-\u001f\u007f.#$\[\]\/]/.test(value);
}

function finiteTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function freshExpiry(value, now) {
  return finiteTimestamp(value) && value > now;
}

function normalizeClaim(value) {
  if (!isRecord(value)
      || value.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
      || !isSafeToken(value.sessionId)
      || !isSafeToken(value.leaseToken)
      || !isSafeToken(value.generation)
      || !finiteTimestamp(value.claimedAt)
      || !finiteTimestamp(value.heartbeatAt)
      || !finiteTimestamp(value.expiresAt)
      || value.claimedAt > value.heartbeatAt
      || value.heartbeatAt >= value.expiresAt
      || (Object.hasOwn(value, "profileProjectionVersion")
        && value.profileProjectionVersion !== 2)) return null;
  return {
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    sessionId: value.sessionId,
    leaseToken: value.leaseToken,
    generation: value.generation,
    claimedAt: value.claimedAt,
    heartbeatAt: value.heartbeatAt,
    expiresAt: value.expiresAt,
    ...(value.profileProjectionVersion === 2 ? { profileProjectionVersion: 2 } : {}),
  };
}

function publicClaimLease(value) {
  const claim = normalizeClaim(value);
  if (!claim) return null;
  return {
    protocolVersion: claim.protocolVersion,
    sessionId: claim.sessionId,
    leaseToken: claim.leaseToken,
    claimedAt: claim.claimedAt,
    heartbeatAt: claim.heartbeatAt,
    expiresAt: claim.expiresAt,
  };
}

function claimDecision({
  currentClaim,
  sessionId,
  leaseToken,
  generation,
  now,
  sameSessionOwnerConfirmedGone = false,
  ttlMs = SOLO_SESSION_LEASE_TTL_MS,
} = {}) {
  if (!isSafeToken(sessionId)
      || !isSafeToken(leaseToken)
      || !isSafeToken(generation)
      || !finiteTimestamp(now)
      || !Number.isSafeInteger(ttlMs)
      || ttlMs < 10_000
      || ttlMs > 120_000
      || typeof sameSessionOwnerConfirmedGone !== "boolean") {
    throw new TypeError("invalid solo session claim input");
  }
  const current = normalizeClaim(currentClaim);
  if (current) {
    const exactOwner = current.sessionId === sessionId
      && current.leaseToken === leaseToken;
    if (exactOwner) {
      const freshExactOwner = current.expiresAt > now;
      return {
        allowed: true,
        reason: freshExactOwner ? "refreshed" : "reclaimed",
        claim: freshExactOwner
          ? {
            ...current,
            heartbeatAt: now,
            expiresAt: now + ttlMs,
          }
          : {
            protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
            sessionId,
            leaseToken,
            generation,
            claimedAt: now,
            heartbeatAt: now,
            expiresAt: now + ttlMs,
          },
      };
    }
    if (current.expiresAt > now
        && current.sessionId === sessionId
        && sameSessionOwnerConfirmedGone) {
      return {
        allowed: true,
        reason: "same-session-takeover",
        claim: {
          protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
          sessionId,
          leaseToken,
          generation,
          claimedAt: now,
          heartbeatAt: now,
          expiresAt: now + ttlMs,
        },
      };
    }
    if (current.expiresAt > now) {
      return {
        allowed: false,
        reason: current.sessionId === sessionId ? "same-session-owned" : "occupied",
        claim: null,
      };
    }
  } else if (currentClaim != null) {
    const knownExpiry = Number(currentClaim?.expiresAt);
    if (!finiteTimestamp(knownExpiry) || knownExpiry > now) {
      return { allowed: false, reason: "occupied", claim: null };
    }
  }
  return {
    allowed: true,
    reason: currentClaim == null ? "claimed" : "expired-replaced",
    claim: {
      protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
      sessionId,
      leaseToken,
      generation,
      claimedAt: now,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    },
  };
}

function heartbeatDecision({
  currentClaim,
  sessionId,
  leaseToken,
  generation,
  now,
  ttlMs = SOLO_SESSION_LEASE_TTL_MS,
} = {}) {
  if (!isSafeToken(sessionId)
      || !isSafeToken(leaseToken)
      || !isSafeToken(generation)
      || !finiteTimestamp(now)
      || !Number.isSafeInteger(ttlMs)) {
    throw new TypeError("invalid solo session heartbeat input");
  }
  const current = normalizeClaim(currentClaim);
  if (!current
      || current.sessionId !== sessionId
      || current.leaseToken !== leaseToken
      || current.generation !== generation) {
    return { allowed: false, reason: "lease-lost", claim: null };
  }
  if (current.expiresAt <= now) {
    return { allowed: false, reason: "lease-expired", claim: null };
  }
  return {
    allowed: true,
    reason: "refreshed",
    claim: {
      ...current,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    },
  };
}

function claimMatches(value, {
  sessionId,
  leaseToken,
  generation,
  now,
  requireFresh = true,
} = {}) {
  const claim = normalizeClaim(value);
  return Boolean(
    claim
      && claim.sessionId === sessionId
      && claim.leaseToken === leaseToken
      && claim.generation === generation
      && (!requireFresh || claim.expiresAt > Number(now)),
  );
}

function resourceFenceMatches(value, expected) {
  return isRecord(value)
    && value.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value.sessionId === expected?.sessionId
    && value.leaseToken === expected?.leaseToken
    && value.generation === expected?.generation;
}

function replacedClaimResourceFence(previousValue, nextValue) {
  const previous = normalizeClaim(previousValue);
  const next = normalizeClaim(nextValue);
  if (!previous || !next || (
    previous.sessionId === next.sessionId
    && previous.leaseToken === next.leaseToken
    && previous.generation === next.generation
  )) return null;
  return Object.freeze({
    sessionId: previous.sessionId,
    leaseToken: previous.leaseToken,
    generation: previous.generation,
  });
}

function roomAttemptMatches(value, expected) {
  return isRecord(value)
    && value.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && value.signalingVersion === SOLO_SIGNALING_VERSION
    && value.attemptId === expected?.attemptId
    && value.connectionGeneration === expected?.connectionGeneration;
}

function roomTransitionOwned(value, action, token) {
  return isRecord(value?.matchTransition)
    && value.matchTransition.action === action
    && value.matchTransition.token === token;
}

function decideSoloRoomTransition({
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
    throw new TypeError("invalid V2 room transition input");
  }
  if (!roomAttemptMatches(room, expected)) {
    return { allowed: false, reason: "room-changed", room: null };
  }
  let replacedStaleTransition = false;
  const currentTransition = room.matchTransition;
  if (currentTransition) {
    if (roomTransitionOwned(room, action, token)) {
      return { allowed: true, reason: "already-owned", room };
    }
    const startedAt = Number(currentTransition.startedAt);
    if (!finiteTimestamp(startedAt)
        || startedAt > now
        || startedAt > now - SOLO_ROOM_TRANSITION_TTL_MS) {
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

function queueEntryMatchesClaim(uid, sessionId, value, claim, now, {
  allowedStates = ["waiting"],
  freshMs = SOLO_SESSION_QUEUE_FRESH_MS,
} = {}) {
  const normalizedClaim = normalizeClaim(claim);
  if (!isSafeUid(uid)
      || !isSafeToken(sessionId)
      || !isRecord(value)
      || value.protocolVersion !== SOLO_SESSION_PROTOCOL_VERSION
      || value.uid !== uid
      || value.sessionId !== sessionId
      || !isSafeToken(value.leaseToken)
      || !isSafeToken(value.generation)
      || (Object.hasOwn(value, "profileProjectionVersion")
        && value.profileProjectionVersion !== 2)
      || (value.profileProjectionVersion === 2)
        !== (normalizedClaim?.profileProjectionVersion === 2)
      || !allowedStates.includes(value.state)
      || !freshExpiry(Number(value.expiresAt), now)
      || Number(value.expiresAt) > now + 120_000
      || !claimMatches(normalizedClaim, {
        sessionId,
        leaseToken: value.leaseToken,
        generation: value.generation,
        now,
      })) return false;
  return isValidSoloServerQueueEntry(
    uid,
    value.state === "waiting" ? value : { ...value, state: "waiting" },
    now,
    freshMs,
  );
}

function flattenFreshQueueV2(queueV2, claims, now, options = {}) {
  const result = {};
  for (const [uid, sessions] of Object.entries(isRecord(queueV2) ? queueV2 : {})) {
    const claim = claims?.[uid];
    const sessionId = normalizeClaim(claim)?.sessionId;
    const entry = sessionId && sessions?.[sessionId];
    if (queueEntryMatchesClaim(uid, sessionId, entry, claim, now, options)) {
      result[uid] = entry;
    }
  }
  return result;
}

function activeV2EntryIsFresh(uid, value, claim, now) {
  return isRecord(value)
    && value.uid === uid
    && isSafeToken(value.sessionId)
    && isSafeToken(value.leaseToken)
    && isSafeToken(value.generation)
    && isSafeToken(value.attemptId)
    && isSafeToken(value.connectionGeneration)
    && typeof value.roomId === "string"
    && /^[-0-9A-Z_a-z]{20}$/.test(value.roomId)
    && freshExpiry(Number(value.expiresAt), now)
    && claimMatches(claim, {
      sessionId: value.sessionId,
      leaseToken: value.leaseToken,
      generation: value.generation,
      now,
    });
}

function activeV2UidSet(activeV2, claims, now) {
  const active = new Set();
  for (const [uid, sessions] of Object.entries(isRecord(activeV2) ? activeV2 : {})) {
    if (Object.values(isRecord(sessions) ? sessions : {}).some(
      (entry) => activeV2EntryIsFresh(uid, entry, claims?.[uid], now),
    )) active.add(uid);
  }
  return active;
}

function normalizedPairParticipants(value) {
  if (!Array.isArray(value) || value.length !== 2) return [];
  const participants = value.map(String).filter(Boolean).sort();
  return participants.length === 2 && participants[0] !== participants[1]
    ? participants
    : [];
}

function selectSoloSessionV2Match({
  requesterUid,
  queue,
  activeUids = [],
  lockedUids = [],
  familiarPairs = [],
  blockedPairIds = [],
  avoidUid = "",
  now,
} = {}) {
  const requester = queue?.[requesterUid];
  if (!requester || requester.uid !== requesterUid) return null;
  const active = new Set(activeUids);
  const locked = new Set(lockedUids);
  if (active.has(requesterUid) || locked.has(requesterUid)) return null;
  const blocked = new Set(blockedPairIds.map(String));
  const familiarByPairId = new Map();
  for (const record of familiarPairs) {
    const data = isRecord(record?.data) ? record.data : record;
    const participants = normalizedPairParticipants(data?.participants);
    if (!participants.length || data?.active !== true) continue;
    const pairId = String(record?.id || soloFamiliarPairId(...participants));
    familiarByPairId.set(pairId, data);
  }
  let candidates = Object.values(queue)
    .filter((candidate) => (
      candidate.uid !== requesterUid
      && !active.has(candidate.uid)
      && !locked.has(candidate.uid)
    ))
    .map((candidate) => {
      const preferenceTier = soloQueuePreferenceTier(requester, candidate);
      if (!Number.isFinite(preferenceTier)) return null;
      const pairId = soloFamiliarPairId(requesterUid, candidate.uid);
      if (blocked.has(pairId)) return null;
      const familiar = familiarByPairId.get(pairId);
      const reunion = Boolean(
        familiar
          && requester.reunionPreference === true
          && candidate.reunionPreference === true
          && Number(familiar.lastReunionPriorityAt || 0)
            <= now - SOLO_FAMILIAR_REUNION_COOLDOWN_MS
      );
      return {
        host: requester,
        candidate,
        preferenceTier,
        reunion,
        pairId: reunion ? pairId : "",
      };
    })
    .filter(Boolean);
  const alternatives = candidates.filter(({ candidate }) => candidate.uid !== avoidUid);
  if (avoidUid && alternatives.length) candidates = alternatives;
  candidates.sort((first, second) => (
    Number(second.reunion) - Number(first.reunion)
    || first.preferenceTier - second.preferenceTier
    || Number(first.candidate.joinedAt) - Number(second.candidate.joinedAt)
    || first.candidate.uid.localeCompare(second.candidate.uid)
  ));
  return candidates[0] || null;
}

function playerFromQueue(entry) {
  return {
    uid: entry.uid,
    name: entry.name,
    pursuitLine: entry.pursuitLine,
    streak: entry.streak,
    rating: entry.rating,
    sampleCount: entry.sampleCount,
    startingHp: entry.startingHp,
    ...(entry.profileProjectionVersion === 2 ? { profileProjectionVersion: 2 } : {}),
  };
}

function sessionFromQueue(entry) {
  return {
    sessionId: entry.sessionId,
    generation: entry.generation,
  };
}

function buildSoloSessionV2Resources({
  roomId,
  attemptId,
  connectionGeneration,
  host,
  guest,
  now,
  expiresAt = now + SOLO_SESSION_MATCH_TTL_MS,
  reunion = false,
  pairId = "",
} = {}) {
  if (!/^[-0-9A-Z_a-z]{20}$/.test(String(roomId || ""))
      || !isSafeToken(attemptId)
      || !isSafeToken(connectionGeneration)
      || !resourceFenceMatches(host, host)
      || !resourceFenceMatches(guest, guest)
      || host.uid === guest.uid
      || !finiteTimestamp(now)
      || !freshExpiry(expiresAt, now)) {
    throw new TypeError("invalid V2 match resource input");
  }
  const sessions = {
    [host.uid]: sessionFromQueue(host),
    [guest.uid]: sessionFromQueue(guest),
  };
  const players = {
    [host.uid]: playerFromQueue(host),
    [guest.uid]: playerFromQueue(guest),
  };
  const common = {
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    signalingVersion: SOLO_SIGNALING_VERSION,
    hostUid: host.uid,
    guestUid: guest.uid,
    attemptId,
    connectionGeneration,
    createdAt: now,
    expiresAt,
    sessions,
  };
  const permit = {
    ...common,
    reunion: reunion === true,
    ...(reunion === true ? { pairId } : {}),
    players,
  };
  const room = {
    ...common,
    status: "offered",
    ...(reunion === true ? { reunion: true, pairId } : {}),
    members: {
      [host.uid]: true,
      [guest.uid]: true,
    },
    players,
  };
  const active = (entry, role) => ({
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
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
  const hostActive = active(host, "host");
  const guestActive = active(guest, "guest");
  const lock = (entry, role) => ({
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
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
    protocolVersion: SOLO_SESSION_PROTOCOL_VERSION,
    signalingVersion: SOLO_SIGNALING_VERSION,
    roomId,
    attemptId,
    connectionGeneration,
    fromUid: host.uid,
    toUid: guest.uid,
    fromSessionId: host.sessionId,
    toSessionId: guest.sessionId,
    fromName: host.name,
    createdAt: now,
    expiresAt,
    sessions,
  };
  return {
    permit,
    room,
    hostActive,
    guestActive,
    hostLock: lock(host, "host"),
    guestLock: lock(guest, "guest"),
    offer,
  };
}

function roomMatchesSessionV2(room, {
  uid,
  sessionId,
  generation,
  roomId,
  attemptId = "",
} = {}) {
  return isRecord(room)
    && room.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
    && room.signalingVersion === SOLO_SIGNALING_VERSION
    && (!attemptId || room.attemptId === attemptId)
    && room.members?.[uid] === true
    && room.sessions?.[uid]?.sessionId === sessionId
    && room.sessions?.[uid]?.generation === generation;
}

function materializationFenceMatches({
  hostClaim,
  guestClaim,
  hostQueue,
  guestQueue,
  hostLock,
  guestLock,
  attemptId,
  now,
} = {}) {
  const entries = [hostQueue, guestQueue];
  const claims = [hostClaim, guestClaim];
  const locks = [hostLock, guestLock];
  return entries.every((entry, index) => (
    resourceFenceMatches(entry, {
      sessionId: entry?.sessionId,
      leaseToken: entry?.leaseToken,
      generation: entry?.generation,
    })
    && claimMatches(claims[index], {
      sessionId: entry.sessionId,
      leaseToken: entry.leaseToken,
      generation: entry.generation,
      now,
    })
    && locks[index]?.attemptId === attemptId
    && entry?.attemptId === attemptId
    && entry?.roomId === locks[index]?.roomId
    && (entry?.state === "offering" || entry?.state === "reserved")
    && locks[index]?.sessionId === entry.sessionId
    && locks[index]?.generation === entry.generation
    && Number(locks[index]?.expiresAt) > now
  ));
}

module.exports = Object.freeze({
  SOLO_ROOM_TRANSITION_TTL_MS,
  SOLO_SESSION_LEASE_TTL_MS,
  SOLO_SESSION_MATCH_TTL_MS,
  SOLO_SESSION_PROTOCOL_VERSION,
  SOLO_SESSION_QUEUE_FRESH_MS,
  SOLO_SIGNALING_VERSION,
  activeV2EntryIsFresh,
  activeV2UidSet,
  buildSoloSessionV2Resources,
  claimDecision,
  claimMatches,
  decideSoloRoomTransition,
  flattenFreshQueueV2,
  heartbeatDecision,
  isSafeToken,
  isSafeUid,
  materializationFenceMatches,
  normalizeClaim,
  publicClaimLease,
  queueEntryMatchesClaim,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomAttemptMatches,
  roomMatchesSessionV2,
  roomTransitionOwned,
  selectSoloSessionV2Match,
});
