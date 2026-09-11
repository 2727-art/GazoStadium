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
const SOLO_SESSION_V2_RESOURCE_CLEANUP_MAX_PAGES = 8;
const SOLO_SESSION_V2_RESOURCE_CLEANUP_CURSOR_PATH = "online/soloSessionResourceCleanupCursor";
const SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_BASE_MS = 30 * 60 * 1000;
const SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
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

function retryDelayMs(deferCount) {
  return Math.min(
    SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_BASE_MS * (2 ** (deferCount - 1)),
    SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_MAX_MS,
  );
}

function deferredRetryMarker(value, now) {
  const marker = cleanupMarker(value);
  return marker
    && Number.isSafeInteger(marker.deferCount)
    && marker.deferCount >= 1 && marker.deferCount <= 5
    && finiteTimestamp(marker.deferredAt)
    && marker.deferredAt >= marker.startedAt && marker.deferredAt <= now
    && finiteTimestamp(marker.nextAttemptAt)
    && marker.nextAttemptAt === marker.deferredAt + retryDelayMs(marker.deferCount)
    ? marker
    : null;
}

function cleanupCursor(value, now, cutoff) {
  return value?.version === 1
    && isSafeUid(value.uid)
    && finiteTimestamp(value.expiresAt) && value.expiresAt >= 1
    && value.expiresAt <= cutoff
    && finiteTimestamp(value.updatedAt) && value.updatedAt <= now
    && now - value.updatedAt <= SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_MAX_MS
    ? { uid: value.uid, expiresAt: value.expiresAt }
    : null;
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
  maxPages = SOLO_SESSION_V2_RESOURCE_CLEANUP_MAX_PAGES,
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
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new TypeError("maxPages must be between 1 and 100");
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

  async function deferClaim(uid, marker, now, longDeferred) {
    let deferred = null;
    const result = await claimRef(uid).transaction((currentValue) => {
      if (currentValue == null) return null;
      if (!isDeepStrictEqual(currentValue, marker)) return;
      const currentMarker = cleanupMarker(currentValue);
      if (!currentMarker) return;
      const retry = deferredRetryMarker(currentValue, now);
      const deferCount = Math.min((retry?.deferCount || 0) + 1, 5);
      const nextCleanupMarker = {
        ...currentMarker,
        originalExpiresAt: finiteTimestamp(currentMarker.originalExpiresAt)
          ? currentMarker.originalExpiresAt
          : Number(currentValue.expiresAt),
        deferredAt: now,
      };
      // Retry timing is cleanup metadata, never a renewed player lease. Errors
      // retain the ordinary scheduler retry; only known live/unknown rooms back off.
      delete nextCleanupMarker.deferCount;
      delete nextCleanupMarker.nextAttemptAt;
      if (longDeferred) {
        nextCleanupMarker.deferCount = deferCount;
        nextCleanupMarker.nextAttemptAt = now + retryDelayMs(deferCount);
      }
      deferred = {
        ...currentValue,
        [SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER]: nextCleanupMarker,
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
    // This separate admin-only cursor prevents deferred claims at the head of
    // the expiresAt index from starving newly expired claims. It has no lease authority.
    const cursorRef = realtime.ref(SOLO_SESSION_V2_RESOURCE_CLEANUP_CURSOR_PATH);
    const storedCursor = (await cursorRef.get()).val();
    let cursor = cleanupCursor(storedCursor, Number(now), cutoff);
    let lastExamined = cursor;
    let finishedPass = false;
    const result = {
      dryRun,
      examined: 0,
      pages: 0,
      deferredSkipped: 0,
      scanLimited: false,
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
      hasMore: false,
      oldestAgeMs: 0,
    };

    scan: while (result.pages < maxPages) {
      if (clock() - startedAt >= deadlineMs) {
        result.stoppedEarly = true;
        result.hasMore = true;
        break;
      }
      let query = realtime.ref(SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH)
        .orderByChild("expiresAt");
      query = cursor
        ? query.startAfter(cursor.expiresAt, cursor.uid)
        : query.startAt(1);
      const snapshot = await query.endAt(cutoff).limitToFirst(batchSize).get();
      result.pages += 1;
      const candidates = [];
      snapshot.forEach((entry) => {
        candidates.push({ uid: entry.key, value: entry.val() });
      });

      for (const rawCandidate of candidates) {
        if (clock() - startedAt >= deadlineMs) {
          result.stoppedEarly = true;
          result.hasMore = true;
          break scan;
        }
        if (result.eligible >= batchSize) {
          result.hasMore = true;
          break scan;
        }
        result.examined += 1;
        lastExamined = {
          uid: rawCandidate.uid,
          expiresAt: rawCandidate.value.expiresAt,
        };
        const candidate = cleanupCandidate(
          rawCandidate.uid,
          rawCandidate.value,
          cutoff,
        );
        if (!candidate) {
          result.skipped += 1;
          continue;
        }
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
        if (Number(deferredRetryMarker(candidate.value, Number(now))?.nextAttemptAt) > now) {
          result.deferredSkipped += 1;
          continue;
        }
        result.eligible += 1;

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
        let longDeferred = false;
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
              longDeferred = true;
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
            longDeferred = true;
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
              longDeferred,
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

      if (candidates.length < batchSize) {
        finishedPass = true;
        result.hasMore = false;
        break;
      }
      result.hasMore = true;
      if (result.eligible >= batchSize) break;
      cursor = lastExamined;
    }
    result.scanLimited = !finishedPass && result.pages >= maxPages;
    const nextCursor = finishedPass || !lastExamined
      ? null
      : { version: 1, ...lastExamined, updatedAt: Number(now) };
    if (!dryRun && !isDeepStrictEqual(storedCursor, nextCursor)) {
      try {
        await cursorRef.transaction((current) => {
          // Cursor races can only repeat inspection, never authorize deletion.
          // Returning null for a cold cache requests a server retry, as for claims.
          if (current == null && storedCursor != null) return null;
          if (!isDeepStrictEqual(current, storedCursor)) return;
          return nextCursor;
        });
      } catch {
        result.errors += 1;
      }
    }

    return result;
  };
}

module.exports = Object.freeze({
  SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_DEADLINE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_CURSOR_PATH,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_MAX_PAGES,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_BASE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_MAX_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_MARKER,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH,
  activeCleanupDecision,
  cleanupCandidate,
  createSoloSessionV2ResourceCleanup,
  exactActiveFence,
  exactClaimFence,
});
