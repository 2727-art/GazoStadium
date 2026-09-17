"use strict";

// Private, room-bound proof of the matchmaking choice. Never place this record
// in a room, player, offer, or callable response visible to the other player.
const MATCH_IMAGE_PREFERENCE_TTL_MS = 24 * 60 * 60 * 1000;
const MATCH_IMAGE_PREFERENCE_CLEANUP_LIMIT = 200;
const ROOT = "online/matchImagePreferenceSnapshots";
const ROOM_ID = /^[-0-9A-Z_a-z]{20}$/;
const validPreference = (value) => ["illustration", "live_action", "both"].includes(value);

function normalizeMatchImagePreferences(value, participantUids) {
  return Object.fromEntries(participantUids
    .filter((uid) => validPreference(value?.[uid]))
    .map((uid) => [uid, value[uid]]));
}

function matchImagePreferenceSnapshotPath(mode, roomId) {
  if (!["solo", "strategy"].includes(mode) || !ROOM_ID.test(String(roomId || ""))) {
    throw new TypeError("invalid match image preference context");
  }
  return `${ROOT}/${mode}/${roomId}`;
}

function buildMatchImagePreferenceSnapshot({ mode, roomId, room, preferences }, now = Date.now()) {
  matchImagePreferenceSnapshotPath(mode, roomId);
  if (!room?.hostUid || !room.guestUid || room.hostUid === room.guestUid
      || !Number.isSafeInteger(room.createdAt) || room.createdAt <= 0
      || !Number.isSafeInteger(now) || now < room.createdAt) {
    throw new TypeError("invalid match image preference snapshot");
  }
  return {
    schemaVersion: 1,
    mode,
    roomId,
    roomCreatedAt: room.createdAt,
    hostUid: room.hostUid,
    guestUid: room.guestUid,
    preferences: normalizeMatchImagePreferences(preferences, [room.hostUid, room.guestUid]),
    capturedAt: now,
    expiresAt: now + MATCH_IMAGE_PREFERENCE_TTL_MS,
  };
}

function snapshotMatches(value, { mode, roomId, room }, now) {
  return value?.schemaVersion === 1
    && value.mode === mode && value.roomId === roomId
    && value.hostUid === room?.hostUid && value.guestUid === room?.guestUid
    && value.hostUid !== value.guestUid
    && value.roomCreatedAt === room?.createdAt
    && Number.isSafeInteger(value.capturedAt) && value.capturedAt >= value.roomCreatedAt
    && value.capturedAt <= now
    && value.expiresAt === value.capturedAt + MATCH_IMAGE_PREFERENCE_TTL_MS
    && value.expiresAt > now;
}

function normalizeMatchImagePreferenceSnapshot(value, context, now = Date.now()) {
  if (!snapshotMatches(value, context, now)) return {};
  return normalizeMatchImagePreferences(value.preferences, [context.room.hostUid, context.room.guestUid]);
}

async function freezeMatchImagePreferences(realtime, context, now = Date.now()) {
  const proposed = buildMatchImagePreferenceSnapshot(context, now);
  const result = await realtime.ref(matchImagePreferenceSnapshotPath(context.mode, context.roomId))
    .transaction((value) => value == null ? proposed : undefined);
  const stored = result.snapshot.val();
  if (!snapshotMatches(stored, context, now)) {
    throw new Error("match image preference snapshot context changed");
  }
  return stored;
}

async function cleanupExpiredMatchImagePreferenceSnapshots(realtime, now = Date.now()) {
  let deleted = 0;
  let hasMore = false;
  for (const mode of ["solo", "strategy"]) {
    const snapshot = await realtime.ref(`${ROOT}/${mode}`).orderByChild("expiresAt")
      .endAt(now).limitToFirst(MATCH_IMAGE_PREFERENCE_CLEANUP_LIMIT).get();
    const entries = Object.entries(snapshot.val() || {});
    hasMore ||= entries.length === MATCH_IMAGE_PREFERENCE_CLEANUP_LIMIT;
    await Promise.all(entries.map(async ([roomId]) => {
      const result = await realtime.ref(matchImagePreferenceSnapshotPath(mode, roomId))
        .transaction((value) => {
          // A cold Admin SDK cache may first present null. Probe with a null
          // write so the server retries against its value before deciding.
          if (value == null) return null;
          return Number.isSafeInteger(value.expiresAt) && value.expiresAt <= now ? null : undefined;
        });
      if (result.committed) deleted += 1;
    }));
  }
  return { deleted, hasMore };
}

module.exports = {
  MATCH_IMAGE_PREFERENCE_TTL_MS,
  buildMatchImagePreferenceSnapshot,
  cleanupExpiredMatchImagePreferenceSnapshots,
  freezeMatchImagePreferences,
  matchImagePreferenceSnapshotPath,
  normalizeMatchImagePreferenceSnapshot,
  normalizeMatchImagePreferences,
};
