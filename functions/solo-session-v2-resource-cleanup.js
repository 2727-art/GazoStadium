"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const {
  SOLO_SESSION_PROTOCOL_VERSION,
  isSafeToken,
  isSafeUid,
  normalizeClaim,
  resourceFenceMatches,
  roomMatchesSessionV2,
} = require("./solo-session-v2");

const SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH = "online/soloSessionClaims";
const SOLO_SESSION_V2_ACTIVE_PATH = "online/activeV2";
const SOLO_SESSION_V2_QUEUE_PATH = "online/queueV2";
const SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER = "staleCleanupV1";
const SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS = 10 * 60 * 1000;
const SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE = 25;
const SOLO_SESSION_V2_RESOURCE_CLEANUP_DEADLINE_MS = 45 * 1000;
const SOLO_SESSION_V2_ROOM_TRANSITION_GRACE_MS = 15 * 60 * 1000;

function finiteTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function cleanupMarker(value) {
  const marker = value?.[SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER];
  return marker?.version === 1
    && isSafeToken(marker.token)
    && finiteTimestamp(marker.startedAt)
    ? marker
    : null;
}

function cleanupCandidate(uid, value, cutoff) {
  const claim = normalizeClaim(value);
  if (!isSafeUid(uid)
      || !claim
      || !finiteTimestamp(claim.expiresAt)
      || claim.expiresAt > cutoff) return null;
  return Object.freeze({ uid, value, claim });
}

function exactClaimFence(value, expected) {
  const current = normalizeClaim(value);
  const prior = normalizeClaim(expected);
  return Boolean(
    current
      && prior
      && current.protocolVersion === prior.protocolVersion
      && current.sessionId === prior.sessionId
      && current.leaseToken === prior.leaseToken
      && current.generation === prior.generation
      && current.claimedAt === prior.claimedAt
      && current.heartbeatAt === prior.heartbeatAt
      && current.expiresAt === prior.expiresAt
      && current.profileProjectionVersion === prior.profileProjectionVersion,
  );
}

function exactActiveFence(uid, sessionId, value, claim) {
  return Boolean(
    value
      && value.protocolVersion === SOLO_SESSION_PROTOCOL_VERSION
      && value.uid === uid
      && value.sessionId === sessionId
      && value.sessionId === claim?.sessionId
      && value.leaseToken === claim?.leaseToken
      && value.generation === claim?.generation
      && isSafeToken(value.sessionId)
      && isSafeToken(value.leaseToken)
      && isSafeToken(value.generation)
      && isSafeToken(value.attemptId)
      && isSafeToken(value.connectionGeneration)
      && typeof value.roomId === "string"
      && /^[-0-9A-Z_a-z]{20}$/.test(value.roomId)
      && finiteTimestamp(Number(value.expiresAt)),
  );
}

function roomMatchesActive(uid, active, room) {
  return roomMatchesSessionV2(room, {
    uid,
    sessionId: active.sessionId,
    generation: active.generation,
    roomId: active.roomId,
    attemptId: active.attemptId,
  }) && room.connectionGeneration === active.connectionGeneration;
}

function staleOfferedRoomCanReleaseActive(room, cutoff, now) {
  if (room?.status !== "offered"
      || !finiteTimestamp(Number(room.expiresAt))
      || Number(room.expiresAt) > cutoff) return false;
  if (!room.matchTransition) return true;
  const transitionStartedAt = Number(room.matchTransition?.startedAt);
  return finiteTimestamp(transitionStartedAt)
    && transitionStartedAt <= now - SOLO_SESSION_V2_ROOM_TRANSITION_GRACE_MS;
}

function activeCleanupDecision(uid, active, room, cutoff, now) {
  if (room == null) return "missing-room";
  if (!roomMatchesActive(uid, active, room)) return "changed-room";
  if (room.destroyed) return "destroyed-room";
  if (room.serverFinalized) return "finalized-room";
  if (staleOfferedRoomCanReleaseActive(room, cutoff, now)) {
    return "stale-offered-room";
  }
  return "defer-room";
}

function createSoloSessionV2ResourceCleanup({
  realtime,
  queueIndex,
  batchSize = SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE,
  graceMs = SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS,
  deadlineMs = SOLO_SESSION_V2_RESOURCE_CLEANUP_DEADLINE_MS,
  clock = Date.now,
  tokenFactory = () => crypto.randomBytes(18).toString("base64url"),
} = {}) {
  if (!realtime) throw new Error("realtime is required");
  if (!queueIndex || typeof queueIndex.remove !== "function") {
    throw new Error("queueIndex.remove is required");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("batchSize must be between 1 and 100");
  }
  if (!Number.isSafeInteger(graceMs) || graceMs < 60_000) {
    throw new TypeError("graceMs must be at least 60 seconds");
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1_000) {
    throw new TypeError("deadlineMs must be at least one second");
  }
  if (typeof clock !== "function" || typeof tokenFactory !== "function") {
    throw new TypeError("clock and tokenFactory must be functions");
  }

  const claimRef = (uid) => realtime.ref(
    `${SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH}/${uid}`,
  );
  const activeRef = (uid, sessionId) => realtime.ref(
    `${SOLO_SESSION_V2_ACTIVE_PATH}/${uid}/${sessionId}`,
  );
  const queueRef = (uid, sessionId) => realtime.ref(
    `${SOLO_SESSION_V2_QUEUE_PATH}/${uid}/${sessionId}`,
  );

  async function freezeClaim(candidate, now, cutoff) {
    const existingMarker = cleanupMarker(candidate.value);
    const token = existingMarker?.token || tokenFactory();
    if (!isSafeToken(token)) throw new Error("cleanup token is invalid");
    let nextMarker = null;
    const result = await claimRef(candidate.uid).transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!isDeepStrictEqual(currentValue, candidate.value)
          || !exactClaimFence(currentValue, candidate.value)
          || Number(currentValue.expiresAt) > cutoff) return;
      if (existingMarker) {
        nextMarker = currentValue;
        return currentValue;
      }
      nextMarker = {
        ...currentValue,
        [SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER]: {
          version: 1,
          token,
          startedAt: now,
        },
      };
      return nextMarker;
    });
    const stored = result.snapshot.val();
    if (!nextMarker
        || !cleanupMarker(stored)
        || !isDeepStrictEqual(stored, nextMarker)) return null;
    return {
      marker: stored,
      resumed: Boolean(existingMarker),
    };
  }

  async function removeExactActive(uid, sessionId, expected, cutoff) {
    let removed = false;
    const result = await activeRef(uid, sessionId).transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!isDeepStrictEqual(currentValue, expected)
          || Number(currentValue.expiresAt) > cutoff) return;
      removed = true;
      return null;
    });
    return {
      removed: removed && result.snapshot.val() == null,
      safe: result.snapshot.val() == null
        || !isDeepStrictEqual(result.snapshot.val(), expected),
    };
  }

  async function removeFencedQueue(uid, sessionId, fence) {
    let safe = false;
    let removed = false;
    const result = await queueRef(uid, sessionId).transaction((currentValue) => {
      if (currentValue == null) {
        safe = true;
        return null;
      }
      if (!resourceFenceMatches(currentValue, fence)) {
        safe = true;
        return;
      }
      safe = true;
      removed = true;
      return null;
    });
    return {
      removed: removed && result.snapshot.val() == null,
      safe: safe && !resourceFenceMatches(result.snapshot.val(), fence),
    };
  }

  async function finalizeClaim(uid, marker) {
    let removed = false;
    const result = await claimRef(uid).transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!isDeepStrictEqual(currentValue, marker)) return;
      removed = true;
      return null;
    });
    return {
      removed: removed && result.snapshot.val() == null,
      safe: result.snapshot.val() == null
        || !isDeepStrictEqual(result.snapshot.val(), marker),
    };
  }

  async function deferClaim(uid, marker, now, cutoff) {
    let deferred = null;
    const result = await claimRef(uid).transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!isDeepStrictEqual(currentValue, marker)) return;
      const currentMarker = cleanupMarker(currentValue);
      if (!currentMarker) return;
      deferred = {
        ...currentValue,
        expiresAt: cutoff + 1,
        [SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER]: {
          ...currentMarker,
          originalExpiresAt: finiteTimestamp(currentMarker.originalExpiresAt)
            ? currentMarker.originalExpiresAt
            : Number(currentValue.expiresAt),
          deferredAt: now,
        },
      };
      return deferred;
    });
    return Boolean(
      deferred
        && result.snapshot.val()?.expiresAt < now
        && isDeepStrictEqual(result.snapshot.val(), deferred),
    );
  }

  async function inspectActive(uid, claim, cutoff, now) {
    const snapshot = await activeRef(uid, claim.sessionId).get();
    const value = snapshot.val();
    if (!exactActiveFence(uid, claim.sessionId, value, claim)) {
      return { kind: value == null ? "missing" : "changed", value };
    }
    if (Number(value.expiresAt) > cutoff) return { kind: "fresh", value };
    const roomSnapshot = await realtime.ref(`online/rooms/${value.roomId}`).get();
    return {
      kind: "candidate",
      value,
      decision: activeCleanupDecision(uid, value, roomSnapshot.val(), cutoff, now),
    };
  }

  return async function cleanupSoloSessionV2Resources(
    now = Date.now(),
    { dryRun = false } = {},
  ) {
    if (!finiteTimestamp(Number(now))) throw new TypeError("now must be a timestamp");
    if (typeof dryRun !== "boolean") throw new TypeError("dryRun must be boolean");
    const cutoff = Number(now) - graceMs;
    const startedAt = clock();
    const snapshot = await realtime.ref(SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH)
      .orderByChild("expiresAt")
      .startAt(1)
      .endAt(cutoff)
      .limitToFirst(batchSize)
      .get();
    const candidates = [];
    snapshot.forEach((entry) => {
      candidates.push({ uid: entry.key, value: entry.val() });
    });
    const result = {
      dryRun,
      examined: candidates.length,
      eligible: 0,
      marked: 0,
      resumed: 0,
      claimsRemoved: 0,
      activeExamined: 0,
      activeRemoved: 0,
      activeDeferred: 0,
      queueRemoved: 0,
      indexReleased: 0,
      conflicts: 0,
      markerRetained: 0,
      skipped: 0,
      errors: 0,
      stoppedEarly: false,
      hasMore: candidates.length >= batchSize,
      oldestAgeMs: 0,
    };

    for (const rawCandidate of candidates) {
      if (clock() - startedAt >= deadlineMs) {
        result.stoppedEarly = true;
        result.hasMore = true;
        break;
      }
      const candidate = cleanupCandidate(
        rawCandidate.uid,
        rawCandidate.value,
        cutoff,
      );
      if (!candidate) {
        result.skipped += 1;
        continue;
      }
      result.eligible += 1;
      const originalExpiresAt = Number(
        cleanupMarker(candidate.value)?.originalExpiresAt,
      );
      const ageExpiresAt = finiteTimestamp(originalExpiresAt)
          && originalExpiresAt <= candidate.claim.expiresAt
        ? originalExpiresAt
        : candidate.claim.expiresAt;
      result.oldestAgeMs = Math.max(
        result.oldestAgeMs,
        Number(now) - ageExpiresAt,
      );

      if (dryRun) {
        try {
          const active = await inspectActive(
            candidate.uid,
            candidate.claim,
            cutoff,
            Number(now),
          );
          if (active.kind === "candidate") {
            result.activeExamined += 1;
            if (active.decision === "defer-room") result.activeDeferred += 1;
            else result.activeRemoved += 1;
          } else if (active.kind === "fresh") {
            result.activeExamined += 1;
            result.activeDeferred += 1;
          }
        } catch {
          result.errors += 1;
        }
        continue;
      }

      let frozen;
      try {
        frozen = await freezeClaim(candidate, Number(now), cutoff);
      } catch {
        result.errors += 1;
        continue;
      }
      if (!frozen) {
        result.conflicts += 1;
        continue;
      }
      result.marked += 1;
      if (frozen.resumed) result.resumed += 1;

      let canFinalize = true;
      try {
        const active = await inspectActive(
          candidate.uid,
          candidate.claim,
          cutoff,
          Number(now),
        );
        if (active.kind === "candidate") {
          result.activeExamined += 1;
          if (active.decision === "defer-room") {
            result.activeDeferred += 1;
            canFinalize = false;
          } else {
            const activeRemoval = await removeExactActive(
              candidate.uid,
              candidate.claim.sessionId,
              active.value,
              cutoff,
            );
            if (activeRemoval.removed) result.activeRemoved += 1;
            if (!activeRemoval.safe) canFinalize = false;
          }
        } else if (active.kind === "fresh") {
          result.activeExamined += 1;
          result.activeDeferred += 1;
          canFinalize = false;
        }

        if (canFinalize) {
          const fence = {
            sessionId: candidate.claim.sessionId,
            leaseToken: candidate.claim.leaseToken,
            generation: candidate.claim.generation,
          };
          const queueRemoval = await removeFencedQueue(
            candidate.uid,
            candidate.claim.sessionId,
            fence,
          );
          if (queueRemoval.removed) result.queueRemoved += 1;
          if (!queueRemoval.safe) canFinalize = false;
          const indexSafe = canFinalize
            ? await queueIndex.remove(candidate.uid, fence)
            : false;
          if (indexSafe) result.indexReleased += 1;
          else canFinalize = false;
        }
      } catch {
        result.errors += 1;
        canFinalize = false;
      }

      if (!canFinalize) {
        result.markerRetained += 1;
        try {
          if (!await deferClaim(
            candidate.uid,
            frozen.marker,
            Number(now),
            cutoff,
          )) {
            result.conflicts += 1;
          }
        } catch {
          result.errors += 1;
        }
        continue;
      }
      try {
        const finalization = await finalizeClaim(candidate.uid, frozen.marker);
        if (finalization.removed) result.claimsRemoved += 1;
        if (!finalization.safe) {
          result.markerRetained += 1;
          result.conflicts += 1;
        }
      } catch {
        result.errors += 1;
        result.markerRetained += 1;
      }
    }

    return result;
  };
}

module.exports = Object.freeze({
  SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_DEADLINE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH,
  activeCleanupDecision,
  cleanupCandidate,
  createSoloSessionV2ResourceCleanup,
  exactActiveFence,
  exactClaimFence,
});
