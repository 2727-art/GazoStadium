"use strict";

const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const {
  assertTrainingRoomFinalizable,
  deriveTrainingRoomResult,
} = require("./training");
const {
  TRAINING_SESSION_LEASE_TTL_MS,
} = require("./training-session-v2");

const TRAINING_ROOMS_PATH = "online/trainingRooms";
const TRAINING_QUEUE_PATH = "online/trainingQueue";
const TRAINING_ACTIVE_PATH = "online/trainingActive";
const TRAINING_INVITES_PATH = "online/trainingInvites";
const TRAINING_MATCH_LOCK_PATH = "online/trainingMatchLock";
const TRAINING_QUEUE_V4_PATH = "online/trainingQueueV4";
const TRAINING_ACTIVE_V4_PATH = "online/trainingActiveV4";
const TRAINING_OFFERS_V4_PATH = "online/trainingOffersV4";
const TRAINING_MATCH_LOCKS_V4_PATH = "online/trainingMatchLocksV4";
const TRAINING_MATCH_PERMITS_V4_PATH = "online/trainingMatchPermitsV4";
const TRAINING_SESSION_CLAIMS_PATH = "online/trainingSessionClaims";
const TRAINING_SESSION_ACTION_RATES_PATH =
  "online/trainingSessionActionRates";
const TRAINING_SESSION_CLEANUP_CURSORS_PATH =
  "online/trainingSessionCleanupCursors";
const TRAINING_ROOM_CLEANUP_CURSOR_PATH = "online/trainingRoomCleanupCursor";
const TRAINING_ACTIVE_CLEANUP_CURSOR_PATH = "online/trainingActiveCleanupCursor";
const TRAINING_ACTIVE_CLEANUP_GUARDS_PATH = "online/trainingActiveCleanupGuards";
const TRAINING_ROOM_CLEANUP_BATCH_SIZE = 100;
const TRAINING_QUEUE_CLEANUP_BATCH_SIZE = 100;
const TRAINING_ACTIVE_CLEANUP_BATCH_SIZE = 10;
const TRAINING_SESSION_CLEANUP_BATCH_SIZE = 25;
const TRAINING_SESSION_CLEANUP_OWNER_SCAN_SIZE = 10;
const TRAINING_SESSION_CLEANUP_OFFER_SESSION_SCAN_SIZE = 20;
const TRAINING_SESSION_LIVE_PRESENCE_MS =
  TRAINING_SESSION_LEASE_TTL_MS + 15_000;
const TRAINING_QUEUE_STALE_MS = 10 * 60 * 1000;
const TRAINING_ORPHAN_ACTIVE_GRACE_MS = 5 * 60 * 1000;
const TRAINING_ACTIVE_CLEANUP_GUARD_MS = 5 * 60 * 1000;
const TRAINING_ACTIVE_CLEANUP_COMMIT_MARGIN_MS = 2 * 60 * 1000;
const TRAINING_ROOM_FINALIZED_RETENTION_MS = 24 * 60 * 60 * 1000;
const TRAINING_ROOM_TERMINAL_RETENTION_MS = 60 * 60 * 1000;
const TRAINING_ROOM_FORMING_STALE_MS = 6 * 60 * 60 * 1000;
const TRAINING_ROOM_ACTIVE_STALE_MS = 24 * 60 * 60 * 1000;
const TRAINING_ROOM_PRESENCE_FRESH_MS = 30 * 60 * 1000;
const TRAINING_FORMING_RESERVATION_MAX_AGE_MS = 45 * 1000;
const TRAINING_ACTIVE_PRESENCE_GRACE_MS = 90 * 1000;
const FIREBASE_PUSH_ID_ALPHABET =
  "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

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

function validRoomId(value) {
  const roomId = typeof value === "string" ? value : "";
  return /^[A-Za-z0-9_-]{1,40}$/.test(roomId) ? roomId : "";
}

function firebasePushIdTimestamp(value) {
  const roomId = typeof value === "string" ? value : "";
  if (roomId.length !== 20) return 0;
  let timestamp = 0;
  for (const character of roomId.slice(0, 8)) {
    const index = FIREBASE_PUSH_ID_ALPHABET.indexOf(character);
    if (index < 0) return 0;
    timestamp = timestamp * 64 + index;
  }
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0;
}

function trainingActiveReservationTimestamp(active, roomId) {
  const source = objectValue(active);
  const reservedAt = validTimestamp(source.reservedAt);
  if (reservedAt && source.roomId === roomId) return reservedAt;
  return firebasePushIdTimestamp(roomId);
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
  const sessionPresence = Object.values(objectValue(room?.presenceV2))
    .flatMap((sessions) => Object.values(objectValue(sessions)));
  return [
    ...Object.values(objectValue(room?.presence)),
    ...sessionPresence,
  ].some((value) => {
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
  const ownSessionId = source.sessions?.[uid]?.sessionId;
  const ownPresence = source.presence?.[uid]
    || (ownSessionId ? source.presenceV2?.[uid]?.[ownSessionId] : null);
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

function validRealtimeKey(value) {
  const key = typeof value === "string" ? value : "";
  return key.length > 0
    && key.length <= 128
    && !/[\u0000-\u001f\u007f.#$/\[\]]/.test(key)
    ? key
    : "";
}

function trainingSessionCleanupCursor(value, now) {
  const source = objectValue(value);
  const updatedAt = validTimestamp(source.updatedAt);
  const ownerKey = validRealtimeKey(source.ownerKey);
  if (!updatedAt || updatedAt > Number(now) || !ownerKey) return null;
  if (source.mode === "after_owner") {
    return { mode: source.mode, ownerKey, updatedAt };
  }
  const recordKey = validRealtimeKey(source.recordKey);
  const expiresAt = Number(source.expiresAt);
  if (source.mode === "record"
      && recordKey
      && Number.isSafeInteger(expiresAt)
      && expiresAt <= Number(now)) {
    return {
      mode: source.mode,
      ownerKey,
      recordKey,
      expiresAt,
      updatedAt,
    };
  }
  const sessionKey = validRealtimeKey(source.sessionKey);
  if (source.mode === "offer_session" && sessionKey) {
    return {
      mode: source.mode,
      ownerKey,
      sessionKey,
      updatedAt,
    };
  }
  if (source.mode === "offer_record"
      && sessionKey
      && recordKey
      && Number.isSafeInteger(expiresAt)
      && expiresAt <= Number(now)) {
    return {
      mode: source.mode,
      ownerKey,
      sessionKey,
      recordKey,
      expiresAt,
      updatedAt,
    };
  }
  return null;
}

function trainingSessionFlatCleanupCursor(value, now) {
  const source = objectValue(value);
  const updatedAt = validTimestamp(source.updatedAt);
  const recordKey = validRealtimeKey(source.recordKey);
  const expiresAt = Number(source.expiresAt);
  return updatedAt
    && updatedAt <= Number(now)
    && recordKey
    && Number.isSafeInteger(expiresAt)
    && expiresAt <= Number(now)
    ? { recordKey, expiresAt, updatedAt }
    : null;
}

function snapshotEntries(snapshot) {
  const entries = [];
  snapshot.forEach((entry) => {
    const key = validRealtimeKey(entry.key);
    if (key) entries.push({ key, value: entry.val() });
  });
  return entries;
}

async function removeExactExpiredRecord(reference, candidate, now) {
  let exactExpiredObserved = false;
  const transaction = await reference.transaction((current) => {
    if (current == null) return null;
    exactExpiredObserved = isDeepStrictEqual(current, candidate)
      && Number(current?.expiresAt || 0) <= Number(now);
    return exactExpiredObserved ? null : undefined;
  });
  return transaction.committed
    && exactExpiredObserved
    && !transaction.snapshot.exists();
}

function trainingSessionRoomAttemptMatchesRecord(room, record, roomId) {
  const source = objectValue(room);
  const candidate = objectValue(record);
  return validRoomId(roomId)
    && source.protocolVersion === 3
    && source.variant === "kitaeai_hp_v3"
    && source.sessionProtocolVersion === 2
    && source.signalingVersion === 2
    && source.attemptId === candidate.attemptId
    && source.connectionGeneration === candidate.connectionGeneration;
}

function trainingSessionRoomHasFreshPresence(
  room,
  now,
  freshMs = TRAINING_SESSION_LIVE_PRESENCE_MS,
) {
  const source = objectValue(room);
  const freshAfter = Number(now) - freshMs;
  return Object.entries(objectValue(source.sessions)).some(([uid, session]) => {
    const sessionId = validRealtimeKey(session?.sessionId);
    const presence = objectValue(source.presenceV2?.[uid]?.[sessionId]);
    const updatedAt = validTimestamp(presence.updatedAt);
    return sessionId
      && presence.protocolVersion === 2
      && presence.sessionId === sessionId
      && presence.generation === session?.generation
      && presence.online === true
      && updatedAt >= freshAfter
      && updatedAt <= Number(now) + 15_000;
  });
}

function trainingSessionRecordHasLiveRoom(room, record, roomId, now) {
  const source = objectValue(room);
  if (!trainingSessionRoomAttemptMatchesRecord(source, record, roomId)
      || source.destroyed != null
      || source.serverFinalized != null) {
    return false;
  }
  if (source.status === "offered") {
    return validTimestamp(source.expiresAt) > Number(now);
  }
  if (source.status !== "active"
      || source.accepted?.[source.hostUid] !== true
      || source.accepted?.[source.guestUid] !== true) {
    return false;
  }
  if (trainingSessionRoomHasFreshPresence(source, now)) return true;
  const activatedAt = validTimestamp(source.activatedAt)
    || validTimestamp(source.createdAt);
  return activatedAt > Number(now) - TRAINING_SESSION_LIVE_PRESENCE_MS
    && activatedAt <= Number(now) + 15_000;
}

function trainingSessionActiveHasLiveRoom(room, active, roomId, now) {
  if (!trainingSessionRecordHasLiveRoom(room, active, roomId, now)) {
    return false;
  }
  const source = objectValue(room);
  const candidate = objectValue(active);
  const uid = validUid(candidate.uid);
  const sessionId = validRealtimeKey(candidate.sessionId);
  if (!uid
      || !sessionId
      || source.members?.[uid] !== true
      || source.sessions?.[uid]?.sessionId !== sessionId
      || source.sessions?.[uid]?.generation !== candidate.generation) {
    return false;
  }
  if (source.status === "offered") return true;
  const presence = objectValue(source.presenceV2?.[uid]?.[sessionId]);
  const updatedAt = validTimestamp(presence.updatedAt);
  if (presence.protocolVersion === 2
    && presence.sessionId === sessionId
    && presence.leaseToken === candidate.leaseToken
    && presence.generation === candidate.generation
    && presence.online === true
    && updatedAt >= Number(now) - TRAINING_SESSION_LIVE_PRESENCE_MS
    && updatedAt <= Number(now) + 15_000) {
    return true;
  }
  const activatedAt = validTimestamp(source.activatedAt)
    || validTimestamp(source.createdAt);
  return activatedAt > Number(now) - TRAINING_SESSION_LIVE_PRESENCE_MS
    && activatedAt <= Number(now) + 15_000;
}

function trainingSessionQueueHasLiveRoom(room, queue, roomId, now) {
  const source = objectValue(room);
  const candidate = objectValue(queue);
  const uid = validUid(candidate.uid);
  const sessionId = validRealtimeKey(candidate.sessionId);
  if (!uid
      || !sessionId
      || !validRoomId(roomId)
      || candidate.protocolVersion !== 2
      || candidate.trainingProtocolVersion !== 3
      || candidate.variant !== "kitaeai_hp_v3"
      || candidate.roomId !== roomId
      || candidate.attemptId !== source.attemptId
      || !["offering", "reserved"].includes(candidate.state)
      || source.protocolVersion !== 3
      || source.variant !== "kitaeai_hp_v3"
      || source.sessionProtocolVersion !== 2
      || source.signalingVersion !== 2
      || source.members?.[uid] !== true
      || source.sessions?.[uid]?.sessionId !== sessionId
      || source.sessions?.[uid]?.generation !== candidate.generation
      || source.destroyed != null
      || source.serverFinalized != null) {
    return false;
  }
  if (source.status === "offered") {
    return validTimestamp(source.expiresAt) > Number(now);
  }
  if (source.status !== "active"
      || source.accepted?.[source.hostUid] !== true
      || source.accepted?.[source.guestUid] !== true) {
    return false;
  }
  if (trainingSessionRoomHasFreshPresence(source, now)) return true;
  const activatedAt = validTimestamp(source.activatedAt)
    || validTimestamp(source.createdAt);
  return activatedAt > Number(now) - TRAINING_SESSION_LIVE_PRESENCE_MS
    && activatedAt <= Number(now) + 15_000;
}

function cleanupFamilyResult() {
  return {
    examined: 0,
    removed: 0,
    protected: 0,
    failures: 0,
    hasMore: false,
  };
}

async function writeTrainingSessionCleanupCursor(
  realtime,
  family,
  value,
) {
  const reference = realtime.ref(
    `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/${family}`,
  );
  if (value) await reference.set(value);
  else await reference.remove();
}

async function cleanupFlatTrainingSessionFamily({
  realtime,
  family,
  path,
  now,
  batchSize,
  protect = null,
}) {
  const result = cleanupFamilyResult();
  const cursorReference = realtime.ref(
    `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/${family}`,
  );
  const cursor = trainingSessionFlatCleanupCursor(
    (await cursorReference.get()).val(),
    now,
  );
  let query = realtime.ref(path).orderByChild("expiresAt");
  if (cursor) query = query.startAfter(cursor.expiresAt, cursor.recordKey);
  const snapshot = await query.endAt(now).limitToFirst(batchSize).get();
  const candidates = snapshotEntries(snapshot);
  result.examined = candidates.length;
  for (const candidate of candidates) {
    try {
      if (protect && await protect(candidate.key, candidate.value)) {
        result.protected += 1;
        continue;
      }
      if (await removeExactExpiredRecord(
        realtime.ref(`${path}/${candidate.key}`),
        candidate.value,
        now,
      )) result.removed += 1;
    } catch {
      result.failures += 1;
    }
  }
  result.hasMore = candidates.length >= batchSize;
  if (result.hasMore) {
    const last = candidates.at(-1);
    await writeTrainingSessionCleanupCursor(realtime, family, {
      recordKey: last.key,
      expiresAt: Number(last.value?.expiresAt || 0),
      updatedAt: now,
    });
  } else {
    await writeTrainingSessionCleanupCursor(realtime, family, null);
  }
  return result;
}

async function trainingSessionOwnerPage(
  realtime,
  path,
  cursor,
  ownerScanSize,
) {
  let query = realtime.ref(path).orderByKey();
  if (cursor?.mode === "after_owner") {
    query = query.startAfter(cursor.ownerKey);
  } else if (cursor?.ownerKey) {
    query = query.startAt(cursor.ownerKey);
  }
  return snapshotEntries(await query.limitToFirst(ownerScanSize).get());
}

async function cleanupNestedTrainingSessionFamily({
  realtime,
  family,
  path,
  now,
  batchSize,
  ownerScanSize,
  eligible,
  protect = null,
}) {
  const result = cleanupFamilyResult();
  const cursorReference = realtime.ref(
    `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/${family}`,
  );
  const cursor = trainingSessionCleanupCursor(
    (await cursorReference.get()).val(),
    now,
  );
  const owners = await trainingSessionOwnerPage(
    realtime,
    path,
    cursor,
    ownerScanSize,
  );
  for (const owner of owners) {
    let query = realtime.ref(`${path}/${owner.key}`)
      .orderByChild("expiresAt");
    const resumesOwner = cursor?.mode === "record"
      && cursor.ownerKey === owner.key;
    if (resumesOwner) {
      query = query.startAfter(cursor.expiresAt, cursor.recordKey);
    }
    const remaining = batchSize - result.examined;
    const candidates = snapshotEntries(
      await query.endAt(now).limitToFirst(remaining).get(),
    );
    for (const candidate of candidates) {
      result.examined += 1;
      try {
        if (!eligible(candidate.value)) {
          result.protected += 1;
          continue;
        }
        if (protect && await protect(
          owner.key,
          candidate.key,
          candidate.value,
        )) {
          result.protected += 1;
          continue;
        }
        if (await removeExactExpiredRecord(
          realtime.ref(`${path}/${owner.key}/${candidate.key}`),
          candidate.value,
          now,
        )) result.removed += 1;
      } catch {
        result.failures += 1;
      }
    }
    if (result.examined >= batchSize) {
      const last = candidates.at(-1);
      result.hasMore = true;
      await writeTrainingSessionCleanupCursor(realtime, family, {
        mode: "record",
        ownerKey: owner.key,
        recordKey: last.key,
        expiresAt: Number(last.value?.expiresAt || 0),
        updatedAt: now,
      });
      return result;
    }
  }
  result.hasMore = owners.length >= ownerScanSize;
  if (result.hasMore) {
    await writeTrainingSessionCleanupCursor(realtime, family, {
      mode: "after_owner",
      ownerKey: owners.at(-1).key,
      updatedAt: now,
    });
  } else {
    await writeTrainingSessionCleanupCursor(realtime, family, null);
  }
  return result;
}

async function cleanupTrainingSessionOffers({
  realtime,
  now,
  batchSize,
  ownerScanSize,
  sessionScanSize,
}) {
  const family = "offers";
  const result = cleanupFamilyResult();
  const cursorReference = realtime.ref(
    `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/${family}`,
  );
  const cursor = trainingSessionCleanupCursor(
    (await cursorReference.get()).val(),
    now,
  );
  const owners = await trainingSessionOwnerPage(
    realtime,
    TRAINING_OFFERS_V4_PATH,
    cursor,
    ownerScanSize,
  );
  let sessionsExamined = 0;
  for (const owner of owners) {
    let sessionsQuery = realtime.ref(
      `${TRAINING_OFFERS_V4_PATH}/${owner.key}`,
    ).orderByKey();
    const resumesOwner = cursor?.ownerKey === owner.key;
    if (resumesOwner && cursor.mode === "offer_session") {
      sessionsQuery = sessionsQuery.startAfter(cursor.sessionKey);
    } else if (resumesOwner && cursor.mode === "offer_record") {
      sessionsQuery = sessionsQuery.startAt(cursor.sessionKey);
    }
    const sessions = snapshotEntries(
      await sessionsQuery
        .limitToFirst(sessionScanSize - sessionsExamined)
        .get(),
    );
    for (const session of sessions) {
      sessionsExamined += 1;
      let offersQuery = realtime.ref(
        `${TRAINING_OFFERS_V4_PATH}/${owner.key}/${session.key}`,
      ).orderByChild("expiresAt");
      const resumesSession = cursor?.mode === "offer_record"
        && cursor.ownerKey === owner.key
        && cursor.sessionKey === session.key;
      if (resumesSession) {
        offersQuery = offersQuery.startAfter(
          cursor.expiresAt,
          cursor.recordKey,
        );
      }
      const remaining = batchSize - result.examined;
      const offers = snapshotEntries(
        await offersQuery.endAt(now).limitToFirst(remaining).get(),
      );
      for (const offer of offers) {
        result.examined += 1;
        try {
          if (await removeExactExpiredRecord(
            realtime.ref(
              `${TRAINING_OFFERS_V4_PATH}/${owner.key}/${session.key}/${offer.key}`,
            ),
            offer.value,
            now,
          )) result.removed += 1;
        } catch {
          result.failures += 1;
        }
      }
      if (result.examined >= batchSize) {
        const last = offers.at(-1);
        result.hasMore = true;
        await writeTrainingSessionCleanupCursor(realtime, family, {
          mode: "offer_record",
          ownerKey: owner.key,
          sessionKey: session.key,
          recordKey: last.key,
          expiresAt: Number(last.value?.expiresAt || 0),
          updatedAt: now,
        });
        return result;
      }
      if (sessionsExamined >= sessionScanSize) {
        result.hasMore = true;
        await writeTrainingSessionCleanupCursor(realtime, family, {
          mode: "offer_session",
          ownerKey: owner.key,
          sessionKey: session.key,
          updatedAt: now,
        });
        return result;
      }
    }
  }
  result.hasMore = owners.length >= ownerScanSize;
  if (result.hasMore) {
    await writeTrainingSessionCleanupCursor(realtime, family, {
      mode: "after_owner",
      ownerKey: owners.at(-1).key,
      updatedAt: now,
    });
  } else {
    await writeTrainingSessionCleanupCursor(realtime, family, null);
  }
  return result;
}

function createTrainingSessionResourceCleanup({
  realtime,
  batchSize = TRAINING_SESSION_CLEANUP_BATCH_SIZE,
  ownerScanSize = TRAINING_SESSION_CLEANUP_OWNER_SCAN_SIZE,
  offerSessionScanSize = TRAINING_SESSION_CLEANUP_OFFER_SESSION_SCAN_SIZE,
} = {}) {
  if (!realtime) throw new Error("realtime is required");
  const maximum = Math.min(
    TRAINING_SESSION_CLEANUP_BATCH_SIZE,
    Math.max(1, Math.floor(Number(batchSize) || 0)),
  );
  const ownersMaximum = Math.min(
    TRAINING_SESSION_CLEANUP_OWNER_SCAN_SIZE,
    Math.max(1, Math.floor(Number(ownerScanSize) || 0)),
  );
  const offerSessionsMaximum = Math.min(
    TRAINING_SESSION_CLEANUP_OFFER_SESSION_SCAN_SIZE,
    Math.max(1, Math.floor(Number(offerSessionScanSize) || 0)),
  );

  return async function cleanupTrainingSessionResources(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("Training session cleanup time is invalid");
    }
    const protectLiveRecord = async (_key, record) => {
      const roomId = validRoomId(record?.roomId);
      if (!roomId) return false;
      const room = (
        await realtime.ref(`${TRAINING_ROOMS_PATH}/${roomId}`).get()
      ).val();
      return trainingSessionRecordHasLiveRoom(
        room,
        record,
        roomId,
        timestamp,
      );
    };
    const protectLiveActive = async (_uid, _sessionId, active) => {
      const roomId = validRoomId(active?.roomId);
      if (!roomId) return false;
      const room = (
        await realtime.ref(`${TRAINING_ROOMS_PATH}/${roomId}`).get()
      ).val();
      return trainingSessionActiveHasLiveRoom(
        room,
        active,
        roomId,
        timestamp,
      );
    };
    const protectLiveQueue = async (_uid, _sessionId, queue) => {
      if (!["offering", "reserved"].includes(queue?.state)) return false;
      const roomId = validRoomId(queue?.roomId);
      if (!roomId) return false;
      const room = (
        await realtime.ref(`${TRAINING_ROOMS_PATH}/${roomId}`).get()
      ).val();
      return trainingSessionQueueHasLiveRoom(
        room,
        queue,
        roomId,
        timestamp,
      );
    };
    const [
      claims,
      queue,
      active,
      locks,
      permits,
      offers,
      rates,
    ] = await Promise.all([
      cleanupFlatTrainingSessionFamily({
        realtime,
        family: "claims",
        path: TRAINING_SESSION_CLAIMS_PATH,
        now: timestamp,
        batchSize: maximum,
      }),
      cleanupNestedTrainingSessionFamily({
        realtime,
        family: "queue",
        path: TRAINING_QUEUE_V4_PATH,
        now: timestamp,
        batchSize: maximum,
        ownerScanSize: ownersMaximum,
        eligible: (entry) => (
          ["waiting", "offering", "reserved"].includes(entry?.state)
        ),
        protect: protectLiveQueue,
      }),
      cleanupNestedTrainingSessionFamily({
        realtime,
        family: "active",
        path: TRAINING_ACTIVE_V4_PATH,
        now: timestamp,
        batchSize: maximum,
        ownerScanSize: ownersMaximum,
        eligible: () => true,
        protect: protectLiveActive,
      }),
      cleanupFlatTrainingSessionFamily({
        realtime,
        family: "locks",
        path: TRAINING_MATCH_LOCKS_V4_PATH,
        now: timestamp,
        batchSize: maximum,
      }),
      cleanupFlatTrainingSessionFamily({
        realtime,
        family: "permits",
        path: TRAINING_MATCH_PERMITS_V4_PATH,
        now: timestamp,
        batchSize: maximum,
        protect: protectLiveRecord,
      }),
      cleanupTrainingSessionOffers({
        realtime,
        now: timestamp,
        batchSize: maximum,
        ownerScanSize: ownersMaximum,
        sessionScanSize: offerSessionsMaximum,
      }),
      cleanupNestedTrainingSessionFamily({
        realtime,
        family: "rates",
        path: TRAINING_SESSION_ACTION_RATES_PATH,
        now: timestamp,
        batchSize: maximum,
        ownerScanSize: ownersMaximum,
        eligible: () => true,
      }),
    ]);
    return {
      claims,
      queue,
      active,
      locks,
      permits,
      offers,
      rates,
    };
  };
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
  if (source.status === "offered"
      && validTimestamp(source.expiresAt) <= timestamp) {
    return {
      action: "tombstone",
      reason: "offer_expired",
      participantUid: state.participantUid,
    };
  }

  const hasFreshPresence = trainingRoomHasFreshPresence(
    source,
    timestamp,
    presenceFreshMs,
  );
  if (source.status === "forming" || source.status === "offered") {
    return createdAt > 0
      && createdAt <= timestamp - formingStaleMs
      && !hasFreshPresence
      ? { action: "tombstone", reason: "stale_forming", participantUid: state.participantUid }
      : {
        action: "keep",
        reason: source.status === "offered" ? "offered" : "forming",
        participantUid: state.participantUid,
      };
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
  const cleanupSessionV4 = async (uid) => {
    const session = room?.sessions?.[uid];
    const sessionId = session?.sessionId;
    if (!sessionId || !session?.generation) return;
    const removeActiveIfConnectionMatches = (path) => (
      realtime.ref(path).transaction((current) => (
        current == null || (
          current?.protocolVersion === 2
          && current?.uid === uid
          && current?.sessionId === sessionId
          && current?.generation === session.generation
          && current?.roomId === roomId
          && current?.attemptId === room?.attemptId
          && current?.connectionGeneration === room?.connectionGeneration
        )
          ? null
          : undefined
      ))
    );
    const removeLockIfAttemptMatches = (path) => (
      realtime.ref(path).transaction((current) => (
        current == null || (
          current?.protocolVersion === 2
          && current?.sessionId === sessionId
          && current?.generation === session.generation
          && current?.roomId === roomId
          && current?.attemptId === room?.attemptId
          && current?.hostUid === room?.hostUid
          && current?.guestUid === room?.guestUid
          && current?.role === (uid === room?.hostUid ? "host" : "guest")
        )
          ? null
          : undefined
      ))
    );
    await Promise.all([
      removeActiveIfConnectionMatches(
        `${TRAINING_ACTIVE_V4_PATH}/${uid}/${sessionId}`,
      ),
      realtime.ref(`${TRAINING_QUEUE_V4_PATH}/${uid}/${sessionId}`)
        .transaction((current) => (
          current == null || (
            current?.protocolVersion === 2
            && current?.uid === uid
            && current?.sessionId === sessionId
            && current?.generation === session.generation
            && current?.roomId === roomId
            && current?.attemptId === room?.attemptId
            && ["offering", "reserved"].includes(current?.state)
          )
            ? null
            : undefined
        )),
      removeLockIfAttemptMatches(`${TRAINING_MATCH_LOCKS_V4_PATH}/${uid}`),
    ]);
  };
  const operations = [
    ...participants.map((uid) => cleanupActive(uid)),
    ...participants.map((uid) => cleanupSessionV4(uid)),
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
  if (room?.sessionProtocolVersion === 2) {
    operations.push(
      realtime.ref(`${TRAINING_MATCH_PERMITS_V4_PATH}/${roomId}`)
        .transaction((current) => (
          current == null || (
            current?.attemptId === room?.attemptId
            && current?.connectionGeneration === room?.connectionGeneration
          )
            ? null
            : undefined
        )),
    );
  }
  const guestSessionId = room?.sessions?.[room?.guestUid]?.sessionId;
  if (room?.guestUid && guestSessionId) {
    operations.push(
      realtime.ref(
        `${TRAINING_OFFERS_V4_PATH}/${room.guestUid}/${guestSessionId}/${roomId}`,
      ).transaction((current) => (
        current == null || (
          current?.attemptId === room?.attemptId
          && current?.connectionGeneration === room?.connectionGeneration
        )
          ? null
          : undefined
      )),
    );
  }
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

function trainingActiveCleanupCursor(value, now) {
  const cursor = objectValue(value);
  const uid = validUid(cursor.uid);
  const updatedAt = validTimestamp(cursor.updatedAt);
  if (!uid || !updatedAt || updatedAt > Number(now)) return null;
  return { uid, updatedAt };
}

function liveTrainingMatchLock(lock, roomId, now) {
  const source = objectValue(lock);
  return source.roomId === roomId
    && validTimestamp(source.expiresAt) > Number(now);
}

function exactTrainingActiveReservation(active, roomId, reservationTimestamp) {
  const source = objectValue(active);
  const claimedRooms = Object.entries(objectValue(source.rooms))
    .filter(([, claimed]) => claimed === true)
    .map(([claimedRoomId]) => claimedRoomId);
  return source.roomId === roomId
    && claimedRooms.length === 1
    && claimedRooms[0] === roomId
    && trainingActiveReservationTimestamp(source, roomId) === reservationTimestamp;
}

function createTrainingActiveCleanup({
  realtime,
  batchSize = TRAINING_ACTIVE_CLEANUP_BATCH_SIZE,
  graceMs = TRAINING_ORPHAN_ACTIVE_GRACE_MS,
  guardMs = TRAINING_ACTIVE_CLEANUP_GUARD_MS,
  clock = Date.now,
} = {}) {
  if (!realtime) throw new Error("realtime is required");
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const maximum = Math.min(
    TRAINING_ACTIVE_CLEANUP_BATCH_SIZE,
    Math.max(1, Math.floor(Number(batchSize) || 0)),
  );
  const grace = Math.max(
    TRAINING_ORPHAN_ACTIVE_GRACE_MS,
    Math.floor(Number(graceMs) || 0),
  );
  const guardDuration = Math.max(
    TRAINING_ACTIVE_CLEANUP_GUARD_MS,
    Math.floor(Number(guardMs) || 0),
  );
  const currentTime = () => {
    const value = Number(clock());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("Training active cleanup clock is invalid");
    }
    return value;
  };

  return async function cleanupTrainingActive(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("Training active cleanup time is invalid");
    }
    const cursorReference = realtime.ref(TRAINING_ACTIVE_CLEANUP_CURSOR_PATH);
    const cursor = trainingActiveCleanupCursor(
      (await cursorReference.get()).val(),
      timestamp,
    );
    let query = realtime.ref(TRAINING_ACTIVE_PATH).orderByKey();
    if (cursor) query = query.startAfter(cursor.uid);
    const snapshot = await query.limitToFirst(maximum).get();
    const candidates = [];
    snapshot.forEach((entry) => {
      const uid = validUid(entry.key);
      if (uid) candidates.push({ uid, active: entry.val() });
    });

    const result = {
      examined: candidates.length,
      claimsExamined: 0,
      removed: 0,
      protectedRecent: 0,
      protectedRoom: 0,
      protectedLock: 0,
      protectedRace: 0,
      invalid: 0,
      failures: 0,
      guardFailures: 0,
      hasMore: candidates.length >= maximum,
    };

    for (const candidate of candidates) {
      const active = objectValue(candidate.active);
      const claimedRooms = Object.entries(objectValue(active.rooms))
        .filter(([, claimed]) => claimed === true)
        .map(([roomId]) => roomId);
      const roomId = validRoomId(active.roomId);
      if (claimedRooms.length !== 1
          || !roomId
          || claimedRooms[0] !== roomId) {
        result.invalid += 1;
        continue;
      }
      result.claimsExamined += 1;
      const reservedAt = trainingActiveReservationTimestamp(active, roomId);
      if (!reservedAt
          || reservedAt > timestamp
          || reservedAt > timestamp - grace) {
        result.protectedRecent += 1;
        continue;
      }

      try {
        const checkedAt = currentTime();
        const [roomSnapshot, lockSnapshot] = await Promise.all([
          realtime.ref(`${TRAINING_ROOMS_PATH}/${roomId}`).get(),
          realtime.ref(TRAINING_MATCH_LOCK_PATH).get(),
        ]);
        if (roomSnapshot.exists()) {
          result.protectedRoom += 1;
          continue;
        }
        if (liveTrainingMatchLock(lockSnapshot.val(), roomId, checkedAt)) {
          result.protectedLock += 1;
          continue;
        }

        const cleanupId = randomUUID();
        const guardedAt = currentTime();
        const guardReference = realtime.ref(
          `${TRAINING_ACTIVE_CLEANUP_GUARDS_PATH}/${roomId}`,
        );
        const guard = {
          cleanupId,
          uid: candidate.uid,
          roomId,
          createdAt: guardedAt,
          expiresAt: guardedAt + guardDuration,
        };
        const guardTransaction = await guardReference.transaction((current) => {
          const expiresAt = validTimestamp(current?.expiresAt);
          return current == null || !expiresAt || expiresAt <= guardedAt
            ? guard
            : undefined;
        });
        if (!guardTransaction.committed
            || guardTransaction.snapshot.val()?.cleanupId !== cleanupId) {
          result.protectedRace += 1;
          continue;
        }

        try {
          const [
            guardedRoomSnapshot,
            guardedLockSnapshot,
            ownedGuardSnapshot,
          ] = await Promise.all([
            realtime.ref(`${TRAINING_ROOMS_PATH}/${roomId}`).get(),
            realtime.ref(TRAINING_MATCH_LOCK_PATH).get(),
            guardReference.get(),
          ]);
          const deleteAt = currentTime();
          if (guardedRoomSnapshot.exists()) {
            result.protectedRoom += 1;
            continue;
          }
          if (liveTrainingMatchLock(guardedLockSnapshot.val(), roomId, deleteAt)) {
            result.protectedLock += 1;
            continue;
          }
          const ownedGuard = objectValue(ownedGuardSnapshot.val());
          if (ownedGuard.cleanupId !== cleanupId
              || validTimestamp(ownedGuard.expiresAt)
                < deleteAt + TRAINING_ACTIVE_CLEANUP_COMMIT_MARGIN_MS) {
            result.protectedRace += 1;
            continue;
          }

          let exactReservationObserved = false;
          const activeTransaction = await realtime
            .ref(`${TRAINING_ACTIVE_PATH}/${candidate.uid}`)
            .transaction((current) => {
              if (current == null) return null;
              exactReservationObserved = exactTrainingActiveReservation(
                current,
                roomId,
                reservedAt,
              );
              return exactReservationObserved ? null : undefined;
            });
          if (activeTransaction.committed
              && exactReservationObserved
              && !activeTransaction.snapshot.exists()) {
            result.removed += 1;
          } else {
            result.protectedRace += 1;
          }
        } finally {
          try {
            const released = await guardReference.transaction((current) => {
              if (current == null) return null;
              return current.cleanupId === cleanupId ? null : undefined;
            });
            if (!released.committed
                && released.snapshot.val()?.cleanupId === cleanupId) {
              result.guardFailures += 1;
            }
          } catch {
            result.guardFailures += 1;
          }
        }
      } catch {
        result.failures += 1;
      }
    }

    if (candidates.length >= maximum) {
      await cursorReference.set({
        uid: candidates.at(-1).uid,
        updatedAt: timestamp,
      });
    } else {
      await cursorReference.remove();
    }
    return result;
  };
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
  TRAINING_ACTIVE_CLEANUP_BATCH_SIZE,
  TRAINING_ACTIVE_CLEANUP_COMMIT_MARGIN_MS,
  TRAINING_ACTIVE_CLEANUP_CURSOR_PATH,
  TRAINING_ACTIVE_CLEANUP_GUARD_MS,
  TRAINING_ACTIVE_CLEANUP_GUARDS_PATH,
  TRAINING_ACTIVE_PRESENCE_GRACE_MS,
  TRAINING_FORMING_RESERVATION_MAX_AGE_MS,
  TRAINING_ORPHAN_ACTIVE_GRACE_MS,
  TRAINING_QUEUE_CLEANUP_BATCH_SIZE,
  TRAINING_QUEUE_PATH,
  TRAINING_QUEUE_STALE_MS,
  TRAINING_SESSION_ACTION_RATES_PATH,
  TRAINING_SESSION_CLAIMS_PATH,
  TRAINING_SESSION_CLEANUP_BATCH_SIZE,
  TRAINING_SESSION_CLEANUP_CURSORS_PATH,
  TRAINING_SESSION_CLEANUP_OFFER_SESSION_SCAN_SIZE,
  TRAINING_SESSION_CLEANUP_OWNER_SCAN_SIZE,
  TRAINING_SESSION_LIVE_PRESENCE_MS,
  TRAINING_ROOM_ACTIVE_STALE_MS,
  TRAINING_ROOM_CLEANUP_BATCH_SIZE,
  TRAINING_ROOM_CLEANUP_CURSOR_PATH,
  TRAINING_ROOM_FINALIZED_RETENTION_MS,
  TRAINING_ROOM_FORMING_STALE_MS,
  TRAINING_ROOM_PRESENCE_FRESH_MS,
  TRAINING_ROOM_TERMINAL_RETENTION_MS,
  cleanupCursor,
  cleanupRelatedTrainingPointers,
  createTrainingActiveCleanup,
  createTrainingQueueCleanup,
  createTrainingRoomCleanup,
  createTrainingSessionResourceCleanup,
  exactTrainingActiveReservation,
  firebasePushIdTimestamp,
  liveTrainingMatchLock,
  trainingActiveCleanupCursor,
  trainingActiveRoomIsLive,
  trainingActiveReservationTimestamp,
  trainingSessionActiveHasLiveRoom,
  trainingSessionCleanupCursor,
  trainingSessionFlatCleanupCursor,
  trainingSessionQueueHasLiveRoom,
  trainingSessionRecordHasLiveRoom,
  trainingSessionRoomHasFreshPresence,
  trainingRoomCleanupDisposition,
  trainingRoomHasFreshPresence,
  trainingRoomParticipantUids,
  unfinalizedTrainingRoomState,
});
