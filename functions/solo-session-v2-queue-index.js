"use strict";

const {
  isSafeToken,
  isSafeUid,
  normalizeClaim,
  queueEntryMatchesClaim,
  resourceFenceMatches,
} = require("./solo-session-v2");

const SOLO_SESSION_V2_QUEUE_INDEX_PATH = "online/queueV2Index";
const SOLO_SESSION_V2_QUEUE_INDEX_MATCH_LIMIT = 500;
const SOLO_SESSION_V2_QUEUE_INDEX_CLEANUP_BATCH_SIZE = 100;

function queueIndexEntryMatchesFence(value, expected) {
  return Boolean(
    value
      && expected
      && value.uid === expected.uid
      && resourceFenceMatches(value, expected),
  );
}

function indexedSoloSessionV2QueueEntry(uid, sessionId, entry, claim, now) {
  const normalizedClaim = normalizeClaim(claim);
  if (!isSafeUid(uid)
      || !queueEntryMatchesClaim(uid, sessionId, entry, normalizedClaim, now)) {
    return null;
  }
  return {
    ...entry,
    uid,
    sessionId,
    claimClaimedAt: normalizedClaim.claimedAt,
    indexedAt: now,
  };
}

function createSoloSessionV2QueueIndex({
  realtime,
  matchLimit = SOLO_SESSION_V2_QUEUE_INDEX_MATCH_LIMIT,
  cleanupBatchSize = SOLO_SESSION_V2_QUEUE_INDEX_CLEANUP_BATCH_SIZE,
} = {}) {
  if (!realtime) throw new Error("realtime is required");
  if (!Number.isSafeInteger(matchLimit) || matchLimit < 2) {
    throw new TypeError("matchLimit must be at least 2");
  }
  if (!Number.isSafeInteger(cleanupBatchSize) || cleanupBatchSize < 1) {
    throw new TypeError("cleanupBatchSize must be positive");
  }

  const entryRef = (uid) => realtime.ref(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${uid}`);

  async function publish(uid, sessionId, entry, claim, now = Date.now()) {
    const next = indexedSoloSessionV2QueueEntry(uid, sessionId, entry, claim, now);
    if (!next) return null;
    let accepted = false;
    const result = await entryRef(uid).transaction((currentValue) => {
      accepted = false;
      if (currentValue != null) {
        const currentClaimedAt = Number(currentValue.claimClaimedAt || 0);
        const sameFence = queueIndexEntryMatchesFence(currentValue, next);
        const currentUsable = sameFence
          && queueEntryMatchesClaim(uid, sessionId, currentValue, claim, now);
        if (currentClaimedAt > next.claimClaimedAt
            || (currentUsable && Number(currentValue.expiresAt || 0) > next.expiresAt)
            || (currentUsable
              && Number(currentValue.expiresAt || 0) === next.expiresAt
              && Number(currentValue.indexedAt || 0) > now)) {
          return;
        }
      }
      accepted = true;
      return next;
    });
    const stored = result.snapshot.val();
    return queueIndexEntryMatchesFence(stored, next)
      && queueEntryMatchesClaim(uid, sessionId, stored, claim, now)
      && (result.committed ? accepted : true)
      ? stored
      : null;
  }

  async function remove(uid, expected) {
    if (!isSafeUid(uid)
        || !isSafeToken(expected?.sessionId)
        || !isSafeToken(expected?.leaseToken)
        || !isSafeToken(expected?.generation)) {
      return false;
    }
    const expectedEntry = { ...expected, uid };
    let safe = false;
    const result = await entryRef(uid).transaction((currentValue) => {
      if (currentValue == null) {
        safe = true;
        return null;
      }
      if (!queueIndexEntryMatchesFence(currentValue, expectedEntry)) {
        safe = true;
        return;
      }
      safe = true;
      return null;
    });
    return safe
      && !queueIndexEntryMatchesFence(result.snapshot.val(), expectedEntry);
  }

  async function loadFresh(now = Date.now()) {
    const snapshot = await realtime.ref(SOLO_SESSION_V2_QUEUE_INDEX_PATH)
      .orderByChild("expiresAt")
      .startAt(now + 1)
      .limitToFirst(matchLimit)
      .get();
    const entries = {};
    snapshot.forEach((entry) => {
      entries[entry.key] = entry.val();
    });
    return entries;
  }

  async function cleanupExpired(now = Date.now()) {
    const snapshot = await realtime.ref(SOLO_SESSION_V2_QUEUE_INDEX_PATH)
      .orderByChild("expiresAt")
      .endAt(now)
      .limitToFirst(cleanupBatchSize)
      .get();
    const candidates = [];
    snapshot.forEach((entry) => {
      candidates.push({ uid: entry.key, value: entry.val() });
    });
    let removed = 0;
    for (const candidate of candidates) {
      if (!isSafeUid(candidate.uid)) continue;
      const expected = { ...candidate.value, uid: candidate.uid };
      if (!queueIndexEntryMatchesFence(candidate.value, expected)) continue;
      let exactExpiredEntry = false;
      const result = await entryRef(candidate.uid).transaction((currentValue) => {
        if (currentValue == null) {
          exactExpiredEntry = false;
          return null;
        }
        exactExpiredEntry = queueIndexEntryMatchesFence(currentValue, expected)
          && Number(currentValue.expiresAt || 0) <= now;
        return exactExpiredEntry ? null : undefined;
      });
      if (exactExpiredEntry && result.committed && result.snapshot.val() == null) {
        removed += 1;
      }
    }
    return {
      examined: candidates.length,
      removed,
      hasMore: candidates.length >= cleanupBatchSize,
    };
  }

  return Object.freeze({
    cleanupExpired,
    loadFresh,
    publish,
    remove,
  });
}

module.exports = Object.freeze({
  SOLO_SESSION_V2_QUEUE_INDEX_CLEANUP_BATCH_SIZE,
  SOLO_SESSION_V2_QUEUE_INDEX_MATCH_LIMIT,
  SOLO_SESSION_V2_QUEUE_INDEX_PATH,
  createSoloSessionV2QueueIndex,
  indexedSoloSessionV2QueueEntry,
  queueIndexEntryMatchesFence,
});
