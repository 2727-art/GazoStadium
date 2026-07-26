"use strict";

const ONLINE_PUBLIC_PRESENCE_PATH = "online/publicPresence";
const ONLINE_PUBLIC_PRESENCE_OWNERS_PATH = "online/publicPresenceOwners";
const ONLINE_PUBLIC_PRESENCE_STALE_MS = 10 * 60 * 1000;
const ONLINE_PUBLIC_PRESENCE_CLEANUP_BATCH_SIZE = 100;

function staleOnlinePublicPresence(value, freshAfter) {
  return Number(value?.lastSeen || 0) < freshAfter;
}

function createOnlinePublicPresenceCleanup({
  realtime,
  staleMs = ONLINE_PUBLIC_PRESENCE_STALE_MS,
  batchSize = ONLINE_PUBLIC_PRESENCE_CLEANUP_BATCH_SIZE,
}) {
  if (!realtime) throw new Error("realtime is required");

  return async function cleanupOnlinePublicPresence(now = Date.now()) {
    const freshAfter = Number(now) - staleMs;
    const snapshot = await realtime.ref(ONLINE_PUBLIC_PRESENCE_PATH)
      .orderByChild("lastSeen")
      .endAt(freshAfter - 1)
      .limitToFirst(batchSize)
      .get();
    const candidates = [];
    snapshot.forEach((entry) => {
      candidates.push(entry.key);
    });

    let removed = 0;
    for (const presenceId of candidates) {
      const presenceRef = realtime.ref(
        `${ONLINE_PUBLIC_PRESENCE_PATH}/${presenceId}`,
      );
      const result = await presenceRef.transaction((current) => (
        staleOnlinePublicPresence(current, freshAfter) ? null : undefined
      ));
      if (!result.committed || result.snapshot.exists()) continue;
      await realtime.ref(
        `${ONLINE_PUBLIC_PRESENCE_OWNERS_PATH}/${presenceId}`,
      ).remove();
      removed += 1;
    }

    return {
      examined: candidates.length,
      removed,
      hasMore: candidates.length >= batchSize,
    };
  };
}

module.exports = {
  ONLINE_PUBLIC_PRESENCE_CLEANUP_BATCH_SIZE,
  ONLINE_PUBLIC_PRESENCE_STALE_MS,
  createOnlinePublicPresenceCleanup,
  staleOnlinePublicPresence,
};
