"use strict";

const {
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
} = require("./training");

const TRAINING_ROOMS_PATH = "online/trainingRooms";
const TRAINING_QUEUE_PATH = "online/trainingQueue";
const TRAINING_ACTIVE_PATH = "online/trainingActive";
const TRAINING_INVITES_PATH = "online/trainingInvites";
const TRAINING_MATCH_LOCK_PATH = "online/trainingMatchLock";
const TRAINING_ROOM_CLEANUP_CURSOR_PATH = "online/trainingRoomCleanupCursor";
const TRAINING_ROOM_CLEANUP_BATCH_SIZE = 100;
const TRAINING_QUEUE_CLEANUP_BATCH_SIZE = 100;
const TRAINING_QUEUE_STALE_MS = 10 * 60 * 1000;
const TRAINING_ROOM_FINALIZED_RETENTION_MS = 24 * 60 * 60 * 1000;
const TRAINING_ROOM_TERMINAL_RETENTION_MS = 60 * 60 * 1000;
const TRAINING_ROOM_FORMING_STALE_MS = 6 * 60 * 60 * 1000;
const TRAINING_ROOM_ACTIVE_STALE_MS = 24 * 60 * 60 * 1000;
const TRAINING_ROOM_PRESENCE_FRESH_MS = 30 * 60 * 1000;
const TRAINING_FORMING_RESERVATION_MAX_AGE_MS = 45 * 1000;
const TRAINING_ACTIVE_PRESENCE_GRACE_MS = 90 * 1000;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0;
}

function validUid(value) {
  const uid = typeof value === "string" ? value : "";
  return /^[^.#$/\[\]]{1,128}$/.test(uid) ? uid : "";
}

function trainingRoomParticipantUids(room) {
  const source = objectValue(room);
  const participants = new Set();
  for (const candidate of [
    source.hostUid,
    source.guestUid,
    ...Object.keys(objectValue(source.members)),
  ]) {
    const uid = validUid(candidate);
    if (uid) participants.add(uid);
  }
  return [...participants];
}

function trainingRoomHasFreshPresence(
  room,
  now,
  freshMs = TRAINING_ROOM_PRESENCE_FRESH_MS,
) {
  const freshAfter = Number(now) - freshMs;
  return Object.values(objectValue(room?.presence)).some((value) => {
    const presence = objectValue(value);
    const updatedAt = validTimestamp(presence.updatedAt);
    return presence.online === true
      && updatedAt >= freshAfter
      && updatedAt <= Number(now) + 5 * 60 * 1000;
  });
}

function trainingActiveRoomIsLive(
  room,
  uid,
  now,
  formingMaxAgeMs = TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
  activeMaxAgeMs = TRAINING_ACTIVE_PRESENCE_GRACE_MS,
) {
  const source = objectValue(room);
  if (source.destroyed != null
      || source.serverFinalized != null
      || !["forming", "active"].includes(source.status)
      || source.members?.[uid] !== true) {
    return false;
  }
  const ownPresence = source.presence?.[uid];
  if (ownPresence && typeof ownPresence === "object") {
    return ownPresence.online === true;
  }
  const createdAt = validTimestamp(source.createdAt);
  const maximumAge = source.status === "active"
    ? activeMaxAgeMs
    : formingMaxAgeMs;
  return createdAt > 0
    && createdAt <= Number(now) + 15_000
    && createdAt >= Number(now) - maximumAge;
}

function unfinalizedTrainingRoomState(room, now) {
  if (room?.serverFinalized != null) {
    return { kind: "server_finalized", participantUid: "" };
  }
  const participantUid = trainingRoomParticipantUids(room)
    .find((uid) => room?.members?.[uid] === true) || "";
  if (!participantUid) return { kind: "invalid", participantUid: "" };

  try {
    const result = assertTrainingRoomFinalizable(room, participantUid, now);
    return {
      kind: result.status === "final" ? "final" : "pending",
      participantUid,
    };
  } catch {
    try {
      const result = deriveTrainingRoomResult(room, now);
      return {
        kind: result.status === "final" ? "final" : "pending",
        participantUid,
      };
    } catch {
      return { kind: "invalid", participantUid };
    }
  }
}

function trainingRoomCleanupDisposition(room, now, {
  finalizedRetentionMs = TRAINING_ROOM_FINALIZED_RETENTION_MS,
  terminalRetentionMs = TRAINING_ROOM_TERMINAL_RETENTION_MS,
  formingStaleMs = TRAINING_ROOM_FORMING_STALE_MS,
  activeStaleMs = TRAINING_ROOM_ACTIVE_STALE_MS,
  presenceFreshMs = TRAINING_ROOM_PRESENCE_FRESH_MS,
} = {}) {
  const source = objectValue(room);
  const timestamp = Number(now);
  const createdAt = validTimestamp(source.createdAt);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError("Training cleanup time is invalid");
  }

  if (source.serverFinalized != null) {
    const finalizedAt = validTimestamp(source.serverFinalized?.finalizedAt);
    if (!finalizedAt || finalizedAt > timestamp) {
      return { action: "keep", reason: "invalid_finalization", participantUid: "" };
    }
    return finalizedAt <= timestamp - finalizedRetentionMs
      ? { action: "delete", reason: "server_finalized", participantUid: "" }
      : { action: "keep", reason: "finalized_grace", participantUid: "" };
  }

  const state = unfinalizedTrainingRoomState(source, timestamp);
  if (state.kind === "final") {
    return {
      action: "finalize",
      reason: "natural_final",
      participantUid: state.participantUid,
    };
  }

  if (source.destroyed != null) {
    const destroyedAt = validTimestamp(source.destroyed?.at) || createdAt;
    return destroyedAt > 0
      && destroyedAt <= timestamp - terminalRetentionMs
      ? { action: "delete", reason: "destroyed", participantUid: state.participantUid }
      : { action: "keep", reason: "destroyed_grace", participantUid: state.participantUid };
  }

  if (source.status === "expired") {
    return {
      action: "tombstone",
      reason: "expired",
      participantUid: state.participantUid,
    };
  }

  const hasFreshPresence = trainingRoomHasFreshPresence(
    source,
    timestamp,
    presenceFreshMs,
  );
  if (source.status === "forming") {
    return createdAt > 0
      && createdAt <= timestamp - formingStaleMs
      && !hasFreshPresence
      ? { action: "tombstone", reason: "stale_forming", participantUid: state.participantUid }
      : { action: "keep", reason: "forming", participantUid: state.participantUid };
  }
  if (source.status === "active") {
    return createdAt > 0
      && createdAt <= timestamp - activeStaleMs
      && !hasFreshPresence
      ? { action: "tombstone", reason: "stale_active", participantUid: state.participantUid }
      : { action: "keep", reason: "active", participantUid: state.participantUid };
  }
  return { action: "keep", reason: "unknown", participantUid: state.participantUid };
}

async function cleanupRelatedTrainingPointers(realtime, roomId, room) {
  const participants = trainingRoomParticipantUids(room);
  const cleanupActive = async (uid) => {
    // A cold Admin SDK cache can yield null before the server value is loaded.
    // Returning null keeps the CAS alive so a conflict reruns these ownership checks.
    await realtime.ref(`${TRAINING_ACTIVE_PATH}/${uid}/rooms/${roomId}`)
      .transaction((current) => (
        current == null || current === true ? null : undefined
      ));
    await realtime.ref(`${TRAINING_ACTIVE_PATH}/${uid}`)
      .transaction((current) => {
        if (current == null) return null;
        if (current?.roomId !== roomId) return undefined;
        const rooms = objectValue(current?.rooms);
        return Object.keys(rooms).length === 0 ? null : undefined;
      });
  };
  const operations = [
    ...participants.map((uid) => cleanupActive(uid)),
    ...participants.map((uid) => (
      realtime.ref(`${TRAINING_INVITES_PATH}/${uid}/${roomId}`)
        .transaction((current) => (
          current == null || current?.roomId === roomId ? null : undefined
        ))
    )),
    realtime.ref(TRAINING_MATCH_LOCK_PATH).transaction((current) => (
      current == null || current?.roomId === roomId ? null : undefined
    )),
  ];
  const results = await Promise.allSettled(operations);
  return results.filter((result) => result.status === "rejected").length;
}

function cleanupCursor(value, now) {
  const cursor = objectValue(value);
  const createdAt = validTimestamp(cursor.createdAt);
  const roomId = typeof cursor.roomId === "string" ? cursor.roomId : "";
  if (!createdAt
      || createdAt > Number(now)
      || !/^[A-Za-z0-9_-]{1,80}$/.test(roomId)) {
    return null;
  }
  return { createdAt, roomId };
}

function createTrainingQueueCleanup({
  realtime,
  batchSize = TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
  staleMs = TRAINING_QUEUE_STALE_MS,
}) {
  if (!realtime) throw new Error("realtime is required");
  const maximum = Math.min(
    TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
    Math.max(1, Math.floor(Number(batchSize) || 0)),
  );
  return async function cleanupTrainingQueue(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("Training queue cleanup time is invalid");
    }
    const cutoff = timestamp - staleMs;
    const snapshot = await realtime.ref(TRAINING_QUEUE_PATH)
      .orderByChild("lastSeen")
      .endAt(cutoff)
      .limitToFirst(maximum)
      .get();
    const uids = [];
    snapshot.forEach((entry) => {
      const uid = validUid(entry.key);
      if (uid) uids.push(uid);
    });
    const settled = await Promise.allSettled(uids.map(async (uid) => {
      const transaction = await realtime.ref(`${TRAINING_QUEUE_PATH}/${uid}`)
        .transaction((current) => {
          if (current == null) return null;
          const lastSeen = validTimestamp(current?.lastSeen);
          return !lastSeen || lastSeen <= cutoff ? null : undefined;
        });
      return transaction.committed && !transaction.snapshot.exists();
    }));
    return {
      examined: uids.length,
      removed: settled.filter((entry) => (
        entry.status === "fulfilled" && entry.value === true
      )).length,
      failures: settled.filter((entry) => entry.status === "rejected").length,
      hasMore: uids.length >= maximum,
    };
  };
}

function createTrainingRoomCleanup({
  realtime,
  finalizeRoom,
  batchSize = TRAINING_ROOM_CLEANUP_BATCH_SIZE,
  finalizedRetentionMs = TRAINING_ROOM_FINALIZED_RETENTION_MS,
  terminalRetentionMs = TRAINING_ROOM_TERMINAL_RETENTION_MS,
  formingStaleMs = TRAINING_ROOM_FORMING_STALE_MS,
  activeStaleMs = TRAINING_ROOM_ACTIVE_STALE_MS,
  presenceFreshMs = TRAINING_ROOM_PRESENCE_FRESH_MS,
}) {
  if (!realtime) throw new Error("realtime is required");
  if (typeof finalizeRoom !== "function") throw new Error("finalizeRoom is required");

  const dispositionOptions = {
    finalizedRetentionMs,
    terminalRetentionMs,
    formingStaleMs,
    activeStaleMs,
    presenceFreshMs,
  };

  return async function cleanupTrainingRooms(now = Date.now()) {
    const timestamp = Number(now);
    const cursorReference = realtime.ref(TRAINING_ROOM_CLEANUP_CURSOR_PATH);
    const cursor = cleanupCursor((await cursorReference.get()).val(), timestamp);
    let query = realtime.ref(TRAINING_ROOMS_PATH).orderByChild("createdAt");
    if (cursor) query = query.startAfter(cursor.createdAt, cursor.roomId);
    const snapshot = await query.endAt(timestamp).limitToFirst(batchSize).get();
    const candidates = [];
    snapshot.forEach((entry) => {
      candidates.push({ roomId: entry.key, room: entry.val() });
    });

    const result = {
      examined: candidates.length,
      finalized: 0,
      finalizationPending: 0,
      finalizationFailed: 0,
      tombstoned: 0,
      removed: 0,
      pointerFailures: 0,
      hasMore: candidates.length >= batchSize,
    };

    for (const candidate of candidates) {
      const disposition = trainingRoomCleanupDisposition(
        candidate.room,
        timestamp,
        dispositionOptions,
      );
      if (disposition.action === "finalize") {
        try {
          const finalized = await finalizeRoom({
            roomId: candidate.roomId,
            participantUid: disposition.participantUid,
            now: timestamp,
          });
          if (finalized?.result?.status === "final") {
            result.finalized += 1;
            result.pointerFailures += await cleanupRelatedTrainingPointers(
              realtime,
              candidate.roomId,
              candidate.room,
            );
          } else result.finalizationPending += 1;
        } catch {
          result.finalizationFailed += 1;
        }
        continue;
      }
      if (disposition.action === "tombstone") {
        const roomReference = realtime.ref(
          `${TRAINING_ROOMS_PATH}/${candidate.roomId}`,
        );
        const transaction = await roomReference.transaction((current) => {
          if (current == null) return null;
          const latest = trainingRoomCleanupDisposition(
            current,
            timestamp,
            dispositionOptions,
          );
          if (latest.action !== "tombstone"
              || latest.reason !== disposition.reason) {
            return undefined;
          }
          return {
            ...current,
            status: "expired",
            destroyed: {
              by: "server-cleanup",
              at: timestamp,
              reason: disposition.reason,
            },
          };
        });
        if (transaction.committed && transaction.snapshot.exists()) {
          result.tombstoned += 1;
          result.pointerFailures += await cleanupRelatedTrainingPointers(
            realtime,
            candidate.roomId,
            transaction.snapshot.val(),
          );
        }
        continue;
      }
      if (disposition.reason === "destroyed_grace"
          || disposition.reason === "finalized_grace") {
        result.pointerFailures += await cleanupRelatedTrainingPointers(
          realtime,
          candidate.roomId,
          candidate.room,
        );
        continue;
      }
      if (disposition.action !== "delete") continue;

      const pointerFailures = await cleanupRelatedTrainingPointers(
        realtime,
        candidate.roomId,
        candidate.room,
      );
      result.pointerFailures += pointerFailures;
      if (pointerFailures > 0) continue;
      const roomReference = realtime.ref(
        `${TRAINING_ROOMS_PATH}/${candidate.roomId}`,
      );
      const transaction = await roomReference.transaction((current) => {
        if (current == null) return null;
        const latest = trainingRoomCleanupDisposition(
          current,
          timestamp,
          dispositionOptions,
        );
        return latest.action === "delete" && latest.reason === disposition.reason
          ? null
          : undefined;
      });
      if (!transaction.committed || transaction.snapshot.exists()) continue;
      result.removed += 1;
    }

    if (candidates.length >= batchSize) {
      const last = candidates.at(-1);
      await cursorReference.set({
        createdAt: validTimestamp(last.room?.createdAt),
        roomId: last.roomId,
        updatedAt: timestamp,
      });
    } else {
      await cursorReference.remove();
    }
    return result;
  };
}

module.exports = Object.freeze({
  TRAINING_ACTIVE_PRESENCE_GRACE_MS,
  TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
  TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
  TRAINING_QUEUE_PATH,
  TRAINING_QUEUE_STALE_MS,
  TRAINING_ROOM_ACTIVE_STALE_MS,
  TRAINING_ROOM_CLEANUP_BATCH_SIZE,
  TRAINING_ROOM_CLEANUP_CURSOR_PATH,
  TRAINING_ROOM_FINALIZED_RETENTION_MS,
  TRAINING_ROOM_FORMING_STALE_MS,
  TRAINING_ROOM_PRESENCE_FRESH_MS,
  TRAINING_ROOM_TERMINAL_RETENTION_MS,
  cleanupCursor,
  cleanupRelatedTrainingPointers,
  createTrainingQueueCleanup,
  createTrainingRoomCleanup,
  trainingActiveRoomIsLive,
  trainingRoomCleanupDisposition,
  trainingRoomHasFreshPresence,
  trainingRoomParticipantUids,
  unfinalizedTrainingRoomState,
});
