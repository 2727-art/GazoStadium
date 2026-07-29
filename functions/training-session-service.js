"use strict";

const { deriveTrainingRoomResult } = require("./training");

const {
  TRAINING_GAME_PROTOCOL_VERSION,
  TRAINING_GAME_VARIANT,
  TRAINING_ROOM_TRANSITION_TTL_MS,
  TRAINING_SESSION_LEASE_TTL_MS,
  TRAINING_SESSION_MATCH_TTL_MS,
  TRAINING_SESSION_PROTOCOL_VERSION,
  TRAINING_SIGNALING_VERSION,
  activateTrainingSessionRoom,
  buildTrainingSessionResources,
  claimDecision,
  claimMatches,
  decideTrainingSessionRoomTransition,
  flattenFreshTrainingQueueV4,
  heartbeatDecision,
  isSafeUid,
  isSafeToken,
  normalizeClaim,
  normalizeTrainingSessionConditions,
  normalizeTrainingSessionPreparation,
  publicClaimLease,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomTransitionOwned,
  selectTrainingSessionMatch,
  trainingSessionActiveEntryIsFresh,
  trainingSessionActiveMatchesRoom,
  trainingSessionLockMatches,
  trainingSessionMaterializationFenceMatches,
  trainingSessionQueueEntryMatchesClaim,
  trainingSessionQueueMatchesRoom,
  trainingSessionRecordSessionsMatch,
  trainingSessionRoomAttemptMatches,
  trainingSessionRoomMatches,
  trainingSessionTransitionExpected,
} = (() => {
  const training = require("./training-session-v2");
  const solo = require("./solo-session-v2");
  return {
    ...training,
    isSafeUid: solo.isSafeUid,
    isSafeToken: solo.isSafeToken,
  };
})();

const PATHS = Object.freeze({
  claims: "online/trainingSessionClaims",
  rates: "online/trainingSessionActionRates",
  queue: "online/trainingQueueV4",
  active: "online/trainingActiveV4",
  offers: "online/trainingOffersV4",
  locks: "online/trainingMatchLocksV4",
  permits: "online/trainingMatchPermitsV4",
  rooms: "online/trainingRooms",
  legacyQueue: "online/trainingQueue",
  legacyActive: "online/trainingActive",
  legacyInvites: "online/trainingInvites",
});

const ACTION_RATE_POLICIES = Object.freeze({
  claim: Object.freeze({ windowMs: 60_000, limit: 12 }),
  enqueue: Object.freeze({ windowMs: 60_000, limit: 30 }),
  heartbeat: Object.freeze({ windowMs: 60_000, limit: 12 }),
  release: Object.freeze({ windowMs: 60_000, limit: 30 }),
  try_match: Object.freeze({ windowMs: 60_000, limit: 90 }),
  accept: Object.freeze({ windowMs: 60_000, limit: 30 }),
  cancel: Object.freeze({ windowMs: 60_000, limit: 30 }),
  expire: Object.freeze({ windowMs: 60_000, limit: 30 }),
});

const CLAIM_GUARD_TTL_MS = 60_000;
const LEGACY_QUEUE_FRESH_MS = 60_000;
const LEGACY_INVITE_FRESH_MS = 60_000;
const MATERIALIZATION_GRACE_MS = TRAINING_ROOM_TRANSITION_TTL_MS;
const ROOM_ID_PATTERN = /^[-0-9A-Z_a-z]{20}$/;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createTrainingSessionService({
  realtime,
  HttpsError,
  crypto,
  now = Date.now,
} = {}) {
  if (!realtime || typeof realtime.ref !== "function") {
    throw new TypeError("realtime is required");
  }
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }
  if (!crypto
      || typeof crypto.randomBytes !== "function"
      || typeof crypto.createHash !== "function") {
    throw new TypeError("crypto is required");
  }
  if (typeof now !== "function") throw new TypeError("now is required");

  const currentTime = () => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("training session clock is invalid");
    }
    return value;
  };
  const path = (base, ...parts) => (
    [base, ...parts].map(String).join("/")
  );
  const claimRef = (uid) => realtime.ref(path(PATHS.claims, uid));
  const queueRef = (uid, sessionId) => realtime.ref(path(PATHS.queue, uid, sessionId));
  const activeRef = (uid, sessionId) => realtime.ref(path(PATHS.active, uid, sessionId));
  const offerRef = (uid, sessionId, roomId) => (
    realtime.ref(path(PATHS.offers, uid, sessionId, roomId))
  );
  const lockRef = (uid) => realtime.ref(path(PATHS.locks, uid));
  const permitRef = (roomId) => realtime.ref(path(PATHS.permits, roomId));
  const roomRef = (roomId) => realtime.ref(path(PATHS.rooms, roomId));

  function token() {
    const value = crypto.randomBytes(16);
    if (!Buffer.isBuffer(value) || value.length !== 16) {
      throw new TypeError("training session token source is invalid");
    }
    return value.toString("base64url");
  }

  function roomId(value) {
    const normalized = String(value || "");
    if (!ROOM_ID_PATTERN.test(normalized)) {
      throw new HttpsError("invalid-argument", "鍛え合いルームを確認してください。");
    }
    return normalized;
  }

  function pathToken(value, label) {
    if (!isSafeToken(value)) {
      throw new HttpsError("invalid-argument", `${label}を確認してください。`);
    }
    return value;
  }

  function normalizeUid(value) {
    const uid = String(value || "");
    if (!uid
        || uid.length > 128
        || /[\u0000-\u001f\u007f.#$\[\]\/]/.test(uid)) {
      throw new HttpsError("unauthenticated", "ログインを確認してください。");
    }
    return uid;
  }

  function requireActionData(value) {
    if (!isPlainObject(value)) {
      throw new HttpsError("invalid-argument", "鍛え合いセッションの形式が正しくありません。");
    }
    const action = String(value.action || "").trim();
    const keysByAction = {
      claim: new Set([
        "action",
        "sessionId",
        "leaseToken",
        "sameSessionOwnerConfirmedGone",
      ]),
      heartbeat: new Set(["action", "sessionId", "leaseToken", "generation"]),
      enqueue: new Set([
        "action",
        "sessionId",
        "leaseToken",
        "name",
        "intensity",
        "commandDeck",
        "imageBpms",
      ]),
      release: new Set(["action", "sessionId", "leaseToken", "generation"]),
      try_match: new Set([
        "action",
        "sessionId",
        "leaseToken",
        "avoidUid",
        "conditions",
      ]),
      accept: new Set([
        "action",
        "sessionId",
        "leaseToken",
        "roomId",
        "conditions",
      ]),
      cancel: new Set([
        "action",
        "sessionId",
        "leaseToken",
        "roomId",
        "abort",
      ]),
      expire: new Set(["action", "sessionId", "leaseToken", "roomId"]),
    };
    const allowedKeys = keysByAction[action];
    if (!allowedKeys
        || Reflect.ownKeys(value).some((key) => (
          typeof key !== "string" || !allowedKeys.has(key)
        ))) {
      throw new HttpsError("invalid-argument", "未対応の鍛え合いセッション操作です。");
    }
    if (!["action", "sessionId", "leaseToken"].every((key) => Object.hasOwn(value, key))) {
      throw new HttpsError("invalid-argument", "鍛え合いセッション情報が不足しています。");
    }
    const result = {
      action,
      sessionId: pathToken(value.sessionId, "セッション"),
      leaseToken: pathToken(value.leaseToken, "セッション所有権"),
    };
    if (["heartbeat", "release"].includes(action)) {
      result.generation = pathToken(value.generation, "セッション世代");
    }
    if (action === "claim") {
      if (Object.hasOwn(value, "sameSessionOwnerConfirmedGone")
          && typeof value.sameSessionOwnerConfirmedGone !== "boolean") {
        throw new HttpsError("invalid-argument", "セッション引き継ぎ情報を確認してください。");
      }
      result.sameSessionOwnerConfirmedGone =
        value.sameSessionOwnerConfirmedGone === true;
    }
    if (action === "enqueue") {
      const preparation = normalizeTrainingSessionPreparation({
        name: value.name,
        intensity: value.intensity,
        commandDeck: value.commandDeck,
        imageBpms: value.imageBpms,
      });
      if (!preparation) {
        throw new HttpsError(
          "invalid-argument",
          "鍛え合いの事前準備を確認してください。",
        );
      }
      Object.assign(result, preparation);
    }
    if (action === "try_match" && Object.hasOwn(value, "avoidUid")) {
      const avoidUid = String(value.avoidUid || "");
      if (avoidUid
          && (avoidUid.length > 128
            || /[\u0000-\u001f\u007f.#$\[\]\/]/.test(avoidUid))) {
        throw new HttpsError("invalid-argument", "再マッチ対象を確認してください。");
      }
      result.avoidUid = avoidUid;
    }
    if (["try_match", "accept"].includes(action)) {
      const conditions = normalizeTrainingSessionConditions(value.conditions || "");
      if (conditions == null) {
        throw new HttpsError("invalid-argument", "今日の条件を確認してください。");
      }
      result.conditions = conditions;
    }
    if (["accept", "cancel", "expire"].includes(action)) {
      result.roomId = roomId(value.roomId);
    }
    if (action === "cancel") {
      if (Object.hasOwn(value, "abort") && typeof value.abort !== "boolean") {
        throw new HttpsError("invalid-argument", "鍛え合いの中断情報を確認してください。");
      }
      result.abort = value.abort === true;
    }
    return result;
  }

  function ratePath(uid, action) {
    const ownerHash = crypto
      .createHash("sha256")
      .update("training-session-action-rate:v4:")
      .update(uid)
      .digest("hex");
    return path(PATHS.rates, ownerHash, action);
  }

  async function consumeRate(uid, action) {
    const policy = ACTION_RATE_POLICIES[action];
    if (!policy) {
      throw new HttpsError("invalid-argument", "未対応の鍛え合い操作です。");
    }
    const timestamp = currentTime();
    let allowed = false;
    const result = await realtime.ref(ratePath(uid, action))
      .transaction((current) => {
        const startedAt = Number(current?.windowStartedAt || 0);
        const inWindow = startedAt > timestamp - policy.windowMs
          && startedAt <= timestamp + 15_000;
        const count = inWindow ? Number(current?.count || 0) : 0;
        allowed = Number.isInteger(count) && count >= 0 && count < policy.limit;
        if (!allowed) return undefined;
        return {
          windowStartedAt: inWindow ? startedAt : timestamp,
          count: count + 1,
          lastAt: timestamp,
          expiresAt: timestamp + (2 * policy.windowMs),
        };
      });
    if (!result.committed || !allowed) {
      throw new HttpsError(
        "resource-exhausted",
        "鍛え合いの操作が短時間に集中しています。少し待ってからお試しください。",
      );
    }
  }

  function claimGuardMatches(value, operationId) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.kind === "claim"
      && value?.operationId === operationId;
  }

  async function acquireClaimGuard(uid, data) {
    const operationId = token();
    const timestamp = currentTime();
    const guard = {
      protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
      kind: "claim",
      operationId,
      sessionId: data.sessionId,
      leaseToken: data.leaseToken,
      acquiredAt: timestamp,
      expiresAt: timestamp + CLAIM_GUARD_TTL_MS,
    };
    const result = await lockRef(uid).transaction((current) => {
      if (Number(current?.expiresAt || 0) > timestamp
          && !claimGuardMatches(current, operationId)) return undefined;
      return guard;
    });
    return result.committed
      && claimGuardMatches(result.snapshot.val(), operationId)
      ? guard
      : null;
  }

  async function renewClaimGuard(uid, guard) {
    const timestamp = currentTime();
    const result = await lockRef(uid).transaction((current) => {
      if (current == null) return null;
      if (!claimGuardMatches(current, guard?.operationId)
          || Number(current.expiresAt || 0) <= timestamp) return undefined;
      return {
        ...current,
        expiresAt: timestamp + CLAIM_GUARD_TTL_MS,
      };
    });
    const value = result.snapshot.val();
    return result.committed
      && claimGuardMatches(value, guard?.operationId)
      && Number(value.expiresAt || 0) > timestamp
      ? value
      : null;
  }

  async function releaseClaimGuard(uid, guard) {
    if (!guard) return true;
    let safe = false;
    const result = await lockRef(uid).transaction((current) => {
      if (current == null) {
        safe = true;
        return null;
      }
      if (!claimGuardMatches(current, guard.operationId)) {
        safe = false;
        return undefined;
      }
      safe = true;
      return null;
    });
    return safe && (result.committed || result.snapshot.val() == null);
  }

  function legacyQueueIsFresh(value, timestamp) {
    return isPlainObject(value)
      && ["waiting", "forming"].includes(value.state)
      && Number(value.lastSeen || 0) >= timestamp - LEGACY_QUEUE_FRESH_MS
      && Number(value.lastSeen || 0) <= timestamp + 15_000;
  }

  function legacyInviteIsFresh(value, timestamp) {
    return isPlainObject(value)
      && ROOM_ID_PATTERN.test(String(value.roomId || ""))
      && Number(value.createdAt || 0) >= timestamp - LEGACY_INVITE_FRESH_MS
      && Number(value.createdAt || 0) <= timestamp + 15_000;
  }

  async function legacyActiveIsLive(uid, value, timestamp) {
    const source = objectValue(value);
    const candidates = new Set();
    if (ROOM_ID_PATTERN.test(String(source.roomId || ""))) {
      candidates.add(source.roomId);
    }
    for (const [candidateRoomId, reserved] of Object.entries(objectValue(source.rooms))) {
      if (reserved === true && ROOM_ID_PATTERN.test(candidateRoomId)) {
        candidates.add(candidateRoomId);
      }
    }
    for (const candidateRoomId of [...candidates].slice(0, 10)) {
      const room = (await roomRef(candidateRoomId).get()).val();
      if (!room
          || room.members?.[uid] !== true
          || room.destroyed
          || room.serverFinalized
          || !["forming", "offered", "active"].includes(room.status)) continue;
      const presence = room.presence?.[uid];
      if (presence?.online === true) return true;
      const createdAt = Number(room.createdAt || 0);
      const grace = room.status === "active" ? 90_000 : 45_000;
      if (createdAt >= timestamp - grace && createdAt <= timestamp + 15_000) {
        return true;
      }
    }
    return false;
  }

  async function legacyOccupancy(uid, timestamp = currentTime()) {
    const [queueSnapshot, activeSnapshot, invitesSnapshot] = await Promise.all([
      realtime.ref(path(PATHS.legacyQueue, uid)).get(),
      realtime.ref(path(PATHS.legacyActive, uid)).get(),
      realtime.ref(path(PATHS.legacyInvites, uid)).get(),
    ]);
    if (legacyQueueIsFresh(queueSnapshot.val(), timestamp)) return "legacy-waiting";
    if (Object.values(objectValue(invitesSnapshot.val()))
      .some((invite) => legacyInviteIsFresh(invite, timestamp))) {
      return "legacy-invite";
    }
    if (await legacyActiveIsLive(uid, activeSnapshot.val(), timestamp)) {
      return "legacy-active";
    }
    return "";
  }

  function exactActiveIdentity(value, expected, uid, sessionId) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.uid === uid
      && value?.sessionId === sessionId
      && value?.sessionId === expected?.sessionId
      && value?.leaseToken === expected?.leaseToken
      && value?.generation === expected?.generation
      && value?.roomId === expected?.roomId
      && value?.attemptId === expected?.attemptId
      && value?.connectionGeneration === expected?.connectionGeneration;
  }

  function sessionRecordMatchesRoom(value, room) {
    const hostUid = room?.hostUid;
    const guestUid = room?.guestUid;
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.signalingVersion === TRAINING_SIGNALING_VERSION
      && value?.trainingProtocolVersion === TRAINING_GAME_PROTOCOL_VERSION
      && value?.variant === TRAINING_GAME_VARIANT
      && value?.hostUid === hostUid
      && value?.guestUid === guestUid
      && value?.attemptId === room?.attemptId
      && value?.connectionGeneration === room?.connectionGeneration
      && value?.sessions?.[hostUid]?.sessionId
        === room?.sessions?.[hostUid]?.sessionId
      && value?.sessions?.[hostUid]?.generation
        === room?.sessions?.[hostUid]?.generation
      && value?.sessions?.[guestUid]?.sessionId
        === room?.sessions?.[guestUid]?.sessionId
      && value?.sessions?.[guestUid]?.generation
        === room?.sessions?.[guestUid]?.generation;
  }

  function roomIsLive(room, timestamp, active = null) {
    return trainingSessionRoomAttemptMatches(room, room)
      && !room.destroyed
      && !room.serverFinalized
      && trainingResultStatus(room, timestamp) !== "final"
      && ["offered", "active"].includes(room.status)
      && (
        (room.status === "offered" && Number(room.expiresAt || 0) > timestamp)
        || (
          room.status === "active"
          && Number(active?.expiresAt || 0) > timestamp
          && active?.attemptId === room.attemptId
          && active?.connectionGeneration === room.connectionGeneration
        )
      );
  }

  function trainingResultStatus(room, timestamp) {
    try {
      return deriveTrainingRoomResult(room, timestamp)?.status || "invalid";
    } catch {
      return "invalid";
    }
  }

  function currentSessionQueueResource(value, uid, data, claim) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.trainingProtocolVersion === TRAINING_GAME_PROTOCOL_VERSION
      && value?.variant === TRAINING_GAME_VARIANT
      && value?.uid === uid
      && value?.sessionId === data.sessionId
      && value?.leaseToken === data.leaseToken
      && value?.generation === claim?.generation;
  }

  function orphanedQueueResource(value, uid, data, claim) {
    return currentSessionQueueResource(value, uid, data, claim)
      && ["offering", "reserved"].includes(value.state)
      && ROOM_ID_PATTERN.test(String(value.roomId || ""))
      && isSafeToken(value.attemptId);
  }

  function currentSessionActiveResource(value, uid, data, claim) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.uid === uid
      && value?.sessionId === data.sessionId
      && value?.leaseToken === data.leaseToken
      && value?.generation === claim?.generation
      && ROOM_ID_PATTERN.test(String(value.roomId || ""))
      && isSafeToken(value.attemptId)
      && isSafeToken(value.connectionGeneration);
  }

  function freshRoomTransition(room, timestamp) {
    const startedAt = Number(room?.matchTransition?.startedAt);
    return isSafeToken(room?.matchTransition?.token)
      && ["accept", "cancel", "expire"].includes(room?.matchTransition?.action)
      && Number.isSafeInteger(startedAt)
      && startedAt <= timestamp + 15_000
      && startedAt > timestamp - TRAINING_ROOM_TRANSITION_TTL_MS;
  }

  function freshMaterializationWindow(value, startedAtField, timestamp) {
    const startedAt = Number(value?.[startedAtField]);
    const expiresAt = Number(value?.expiresAt);
    return Number.isSafeInteger(startedAt)
      && Number.isSafeInteger(expiresAt)
      && startedAt <= timestamp + 15_000
      && startedAt > timestamp - MATERIALIZATION_GRACE_MS
      && expiresAt > timestamp
      && expiresAt >= startedAt;
  }

  function roomBlocksOrphanRecovery(room, timestamp) {
    if (!trainingSessionRoomAttemptMatches(room, room)
        || room.destroyed
        || room.serverFinalized
        || trainingResultStatus(room, timestamp) === "final") {
      return false;
    }
    if (room.status === "active") return true;
    return room.status === "offered"
      && (
        Number(room.expiresAt || 0) > timestamp
        || freshRoomTransition(room, timestamp)
      );
  }

  function sessionRecordReferencesAttempt(value, {
    uid,
    data,
    claim,
    roomId: candidateRoomId,
    attemptId,
    connectionGeneration = "",
  }) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.signalingVersion === TRAINING_SIGNALING_VERSION
      && value?.trainingProtocolVersion === TRAINING_GAME_PROTOCOL_VERSION
      && value?.variant === TRAINING_GAME_VARIANT
      && value?.attemptId === attemptId
      && (!connectionGeneration
        || value?.connectionGeneration === connectionGeneration)
      && value?.sessions?.[uid]?.sessionId === data.sessionId
      && value?.sessions?.[uid]?.generation === claim?.generation
      && (!Object.hasOwn(value, "roomId") || value.roomId === candidateRoomId);
  }

  function lockReferencesAttempt(value, {
    roomId: candidateRoomId,
    attemptId,
    uid,
    sessionId,
    generation,
    role = "",
    hostUid = "",
    guestUid = "",
  }) {
    return value?.protocolVersion === TRAINING_SESSION_PROTOCOL_VERSION
      && value?.roomId === candidateRoomId
      && value?.attemptId === attemptId
      && value?.sessionId === sessionId
      && value?.generation === generation
      && (!role || value?.role === role)
      && (!hostUid || value?.hostUid === hostUid)
      && (!guestUid || value?.guestUid === guestUid)
      && (
        !uid
        || value?.hostUid === uid
        || value?.guestUid === uid
      );
  }

  function freshPermitReferencesMaterialization(
    value,
    candidate,
    uid,
    data,
    claim,
    timestamp,
  ) {
    const hostUid = value?.hostUid;
    const guestUid = value?.guestUid;
    return sessionRecordReferencesAttempt(value, {
      uid,
      data,
      claim,
      roomId: candidate.roomId,
      attemptId: candidate.attemptId,
      connectionGeneration: candidate.roomConnectionGeneration,
    })
      && isSafeUid(hostUid)
      && isSafeUid(guestUid)
      && hostUid !== guestUid
      && [hostUid, guestUid].includes(uid)
      && isSafeToken(value?.sessions?.[hostUid]?.sessionId)
      && isSafeToken(value?.sessions?.[hostUid]?.generation)
      && isSafeToken(value?.sessions?.[guestUid]?.sessionId)
      && isSafeToken(value?.sessions?.[guestUid]?.generation)
      && freshMaterializationWindow(value, "createdAt", timestamp);
  }

  function freshOwnMaterializationLock(
    value,
    candidate,
    uid,
    data,
    claim,
    timestamp,
  ) {
    if (!lockReferencesAttempt(value, {
      roomId: candidate.roomId,
      attemptId: candidate.attemptId,
      uid,
      sessionId: data.sessionId,
      generation: claim.generation,
    })
        || !freshMaterializationWindow(value, "acquiredAt", timestamp)
        || !["host", "guest"].includes(value.role)
        || !isSafeUid(value.hostUid)
        || !isSafeUid(value.guestUid)
        || value.hostUid === value.guestUid
        || (value.role === "host" && value.hostUid !== uid)
        || (value.role === "guest" && value.guestUid !== uid)) {
      return null;
    }
    return {
      hostUid: value.hostUid,
      guestUid: value.guestUid,
      peerUid: value.role === "host" ? value.guestUid : value.hostUid,
      peerRole: value.role === "host" ? "guest" : "host",
    };
  }

  function freshPeerMaterializationLock(
    value,
    ownLock,
    lockContext,
    candidate,
    timestamp,
  ) {
    return lockReferencesAttempt(value, {
      roomId: candidate.roomId,
      attemptId: candidate.attemptId,
      uid: lockContext.peerUid,
      sessionId: value?.sessionId,
      generation: value?.generation,
      role: lockContext.peerRole,
      hostUid: lockContext.hostUid,
      guestUid: lockContext.guestUid,
    })
      && isSafeToken(value?.sessionId)
      && isSafeToken(value?.generation)
      && Number(value?.acquiredAt) === Number(ownLock?.acquiredAt)
      && Number(value?.expiresAt) === Number(ownLock?.expiresAt)
      && freshMaterializationWindow(value, "acquiredAt", timestamp);
  }

  function roomReferencesSessionAttempt(room, candidate, uid, data, claim) {
    return trainingSessionRoomMatches(room, {
      uid,
      sessionId: data.sessionId,
      generation: claim.generation,
      roomId: candidate.roomId,
      attemptId: candidate.attemptId,
    }) && (
      !candidate.roomConnectionGeneration
      || room.connectionGeneration === candidate.roomConnectionGeneration
    );
  }

  async function removeOrphanAttemptArtifacts(
    uid,
    data,
    claim,
    candidate,
    room,
    permit,
  ) {
    const exactRoom = roomReferencesSessionAttempt(
      room,
      candidate,
      uid,
      data,
      claim,
    ) ? room : null;
    const roomConnectionGeneration = exactRoom?.connectionGeneration || "";
    const exactPermit = sessionRecordReferencesAttempt(permit, {
      uid,
      data,
      claim,
      roomId: candidate.roomId,
      attemptId: candidate.attemptId,
      connectionGeneration: roomConnectionGeneration,
    }) ? permit : null;
    const record = exactRoom || exactPermit;
    const removals = [];

    if (record) {
      const hostUid = record.hostUid;
      const guestUid = record.guestUid;
      const hostSession = record.sessions?.[hostUid];
      const guestSession = record.sessions?.[guestUid];
      if (hostSession && guestSession) {
        removals.push(
          removeRecord(lockRef(hostUid), (current) => lockReferencesAttempt(
            current,
            {
              roomId: candidate.roomId,
              attemptId: candidate.attemptId,
              uid: hostUid,
              sessionId: hostSession.sessionId,
              generation: hostSession.generation,
              role: "host",
              hostUid,
              guestUid,
            },
          )),
          removeRecord(lockRef(guestUid), (current) => lockReferencesAttempt(
            current,
            {
              roomId: candidate.roomId,
              attemptId: candidate.attemptId,
              uid: guestUid,
              sessionId: guestSession.sessionId,
              generation: guestSession.generation,
              role: "guest",
              hostUid,
              guestUid,
            },
          )),
          removeRecord(
            offerRef(guestUid, guestSession.sessionId, candidate.roomId),
            (current) => sessionRecordReferencesAttempt(current, {
              uid,
              data,
              claim,
              roomId: candidate.roomId,
              attemptId: candidate.attemptId,
              connectionGeneration: record.connectionGeneration,
            }),
          ),
        );
      }
    } else {
      removals.push(removeRecord(
        lockRef(uid),
        (current) => lockReferencesAttempt(current, {
          roomId: candidate.roomId,
          attemptId: candidate.attemptId,
          uid,
          sessionId: data.sessionId,
          generation: claim.generation,
        }),
      ));
    }

    const results = await Promise.all(removals);
    if (!results.every(Boolean)) return false;
    if (!exactPermit) return true;
    return removeRecord(
      permitRef(candidate.roomId),
      (current) => sessionRecordReferencesAttempt(current, {
        uid,
        data,
        claim,
        roomId: candidate.roomId,
        attemptId: candidate.attemptId,
        connectionGeneration: exactPermit.connectionGeneration,
      }),
    );
  }

  async function recoverOrphanedSessionResources(uid, data, claim) {
    const timestamp = currentTime();
    if (!claimMatches(claim, {
      sessionId: data.sessionId,
      leaseToken: data.leaseToken,
      generation: claim?.generation,
      now: timestamp,
    })) {
      return { recovered: false, reason: "lease-lost" };
    }
    const [queueSnapshot, activeSnapshot] = await Promise.all([
      queueRef(uid, data.sessionId).get(),
      activeRef(uid, data.sessionId).get(),
    ]);
    const queue = queueSnapshot.val();
    const active = activeSnapshot.val();
    const orphanQueue = orphanedQueueResource(queue, uid, data, claim)
      ? queue
      : null;
    const staleActive = currentSessionActiveResource(active, uid, data, claim)
      ? active
      : null;
    if (!orphanQueue && !staleActive) {
      return { recovered: false, reason: "" };
    }

    const candidates = new Map();
    for (const [resource, activeResource] of [
      [orphanQueue, false],
      [staleActive, true],
    ]) {
      if (!resource) continue;
      const key = `${resource.roomId}:${resource.attemptId}`;
      const current = candidates.get(key);
      candidates.set(key, {
        roomId: resource.roomId,
        attemptId: resource.attemptId,
        roomConnectionGeneration: activeResource
          ? resource.connectionGeneration
          : current?.roomConnectionGeneration
          || "",
      });
    }
    const inspected = [];
    for (const candidate of candidates.values()) {
      const [roomSnapshot, permitSnapshot, ownLockSnapshot] = await Promise.all([
        roomRef(candidate.roomId).get(),
        permitRef(candidate.roomId).get(),
        lockRef(uid).get(),
      ]);
      const room = roomSnapshot.val();
      const permit = permitSnapshot.val();
      const ownLock = ownLockSnapshot.val();
      const exactRoom = roomReferencesSessionAttempt(
        room,
        candidate,
        uid,
        data,
        claim,
      );
      if (exactRoom && roomBlocksOrphanRecovery(room, timestamp)) {
        return { recovered: false, reason: "active" };
      }
      const terminalRoom = exactRoom && (
        room.destroyed
        || room.serverFinalized
        || trainingResultStatus(room, timestamp) === "final"
      );
      if (!terminalRoom && freshPermitReferencesMaterialization(
        permit,
        candidate,
        uid,
        data,
        claim,
        timestamp,
      )) {
        return { recovered: false, reason: "active" };
      }
      if (!terminalRoom) {
        const lockContext = freshOwnMaterializationLock(
          ownLock,
          candidate,
          uid,
          data,
          claim,
          timestamp,
        );
        if (lockContext) {
          const peerLock = (await lockRef(lockContext.peerUid).get()).val();
          if (freshPeerMaterializationLock(
            peerLock,
            ownLock,
            lockContext,
            candidate,
            timestamp,
          )) {
            return { recovered: false, reason: "active" };
          }
        }
      }
      inspected.push({ candidate, room, permit });
    }

    const latestClaim = normalizeClaim((await claimRef(uid).get()).val());
    if (!claimMatches(latestClaim, {
      sessionId: data.sessionId,
      leaseToken: data.leaseToken,
      generation: claim.generation,
      now: currentTime(),
    })) {
      return { recovered: false, reason: "lease-lost" };
    }

    for (const { candidate, room, permit } of inspected) {
      if (!await removeOrphanAttemptArtifacts(
        uid,
        data,
        latestClaim,
        candidate,
        room,
        permit,
      )) {
        return { recovered: false, reason: "busy" };
      }
    }

    if (staleActive) {
      const activeRemoved = await removeRecord(
        activeRef(uid, data.sessionId),
        (current) => currentSessionActiveResource(
          current,
          uid,
          data,
          latestClaim,
        ) && candidates.has(`${current.roomId}:${current.attemptId}`),
      );
      if (!activeRemoved) return { recovered: false, reason: "busy" };
    }

    if (orphanQueue) {
      const restoredAt = currentTime();
      let restored = false;
      const result = await queueRef(uid, data.sessionId)
        .transaction((current) => {
          if (!orphanedQueueResource(current, uid, data, latestClaim)
              || current.roomId !== orphanQueue.roomId
              || current.attemptId !== orphanQueue.attemptId) {
            restored = false;
            return undefined;
          }
          restored = true;
          const next = {
            ...current,
            state: "waiting",
            lastSeen: restoredAt,
            expiresAt: latestClaim.expiresAt,
          };
          delete next.roomId;
          delete next.attemptId;
          return next;
        });
      if (!restored || !result.committed) {
        return { recovered: false, reason: "busy" };
      }
    }
    return { recovered: true, reason: "orphan-recovered" };
  }

  async function liveSessionRoom(uid, timestamp = currentTime()) {
    const snapshot = await realtime.ref(path(PATHS.active, uid)).get();
    const entries = Object.entries(objectValue(snapshot.val()))
      .sort((first, second) => (
        Number(second[1]?.expiresAt || 0) - Number(first[1]?.expiresAt || 0)
      ))
      .slice(0, 50);
    for (const [sessionId, active] of entries) {
      if (active?.protocolVersion !== TRAINING_SESSION_PROTOCOL_VERSION
          || active?.uid !== uid
          || active?.sessionId !== sessionId
          || !isSafeToken(active?.sessionId)
          || !isSafeToken(active?.leaseToken)
          || !isSafeToken(active?.generation)
          || !ROOM_ID_PATTERN.test(String(active?.roomId || ""))
          || !isSafeToken(active?.attemptId)
          || !isSafeToken(active?.connectionGeneration)) continue;
      const room = (await roomRef(active.roomId).get()).val();
      if (!trainingSessionRoomMatches(room, {
        uid,
        sessionId,
        generation: active.generation,
        roomId: active.roomId,
        attemptId: active.attemptId,
      })) {
        continue;
      }
      const role = room.hostUid === uid
        ? "host"
        : room.guestUid === uid
          ? "guest"
          : "";
      if (!role
          || active.role !== role
          || active.connectionGeneration !== room.connectionGeneration) {
        continue;
      }
      const presence = room.presenceV2?.[uid]?.[sessionId];
      const presenceFresh = presence?.protocolVersion
          === TRAINING_SESSION_PROTOCOL_VERSION
        && presence?.sessionId === sessionId
        && presence?.leaseToken === active.leaseToken
        && presence?.generation === active.generation
        && presence?.online === true
        && Number(presence.updatedAt || 0) >= timestamp - TRAINING_SESSION_LEASE_TTL_MS - 15_000;
      const presenceCurrent = presenceFresh
        && Number(presence.updatedAt || 0) <= timestamp + 15_000;
      const activeAccepted = room.accepted?.[room.hostUid] === true
        && room.accepted?.[room.guestUid] === true;
      if (!room.destroyed
          && trainingResultStatus(room, timestamp) !== "final"
          && ((room.status === "active"
              && activeAccepted
              && (Number(active.expiresAt || 0) > timestamp || presenceCurrent))
            || (room.status === "offered"
              && role === "host"
              && room.accepted?.[room.hostUid] === true
              && room.accepted?.[room.guestUid] !== true
              && Number(active.expiresAt || 0) > timestamp
              && Number(room.expiresAt || 0) > timestamp
              && Number(room.createdAt || 0) >= timestamp - TRAINING_SESSION_MATCH_TTL_MS
              && Number(room.createdAt || 0) <= timestamp + 15_000))) {
        return {
          roomId: active.roomId,
          status: room.status,
          room,
          active,
          sessionId,
          role,
          generation: active.generation,
          attemptId: active.attemptId,
          connectionGeneration: active.connectionGeneration,
        };
      }
    }
    return null;
  }

  async function removeRecord(reference, matches) {
    let safe = false;
    const result = await reference.transaction((current) => {
      if (current == null) {
        safe = true;
        return null;
      }
      if (!matches(current)) {
        safe = false;
        return undefined;
      }
      safe = true;
      return null;
    });
    return safe && (result.committed || result.snapshot.val() == null);
  }

  async function removeFencedResource(reference, fence) {
    return removeRecord(reference, (current) => resourceFenceMatches(current, fence));
  }

  async function cleanupReplacedResources(uid, previousClaim, committedClaim) {
    const fence = replacedClaimResourceFence(previousClaim, committedClaim);
    if (!fence) return true;
    const results = await Promise.all([
      removeFencedResource(queueRef(uid, fence.sessionId), fence),
      removeFencedResource(activeRef(uid, fence.sessionId), fence),
    ]);
    return results.every(Boolean);
  }

  function claimResponse(claim, reason) {
    const lease = publicClaimLease(claim);
    if (!lease) throw new Error("training session claim response is invalid");
    return {
      claimed: true,
      reason,
      lease,
      sessionGeneration: claim.generation,
    };
  }

  async function claimSession(uid, data) {
    const timestamp = currentTime();
    const reference = claimRef(uid);
    const existingSnapshot = await reference.get();
    const existing = normalizeClaim(existingSnapshot.val());
    const exactOwner = existing?.sessionId === data.sessionId
      && existing?.leaseToken === data.leaseToken
      && existing?.expiresAt > timestamp;
    if (!exactOwner) {
      const legacy = await legacyOccupancy(uid, timestamp);
      if (legacy) return { claimed: false, reason: legacy };
      if (await liveSessionRoom(uid, timestamp)) {
        return { claimed: false, reason: "occupied" };
      }
    }
    const guard = exactOwner ? null : await acquireClaimGuard(uid, data);
    if (!exactOwner && !guard) return { claimed: false, reason: "occupied" };
    try {
      if (guard) {
        const legacy = await legacyOccupancy(uid, currentTime());
        if (legacy || await liveSessionRoom(uid, currentTime())) {
          return { claimed: false, reason: legacy || "occupied" };
        }
        if (!await renewClaimGuard(uid, guard)) {
          return { claimed: false, reason: "occupied" };
        }
      }
      let decision = null;
      let rollbackValue = null;
      const replacementGeneration = token();
      const result = await reference.transaction((current) => {
        decision = claimDecision({
          currentClaim: current,
          sessionId: data.sessionId,
          leaseToken: data.leaseToken,
          generation: replacementGeneration,
          now: currentTime(),
          ttlMs: TRAINING_SESSION_LEASE_TTL_MS,
          sameSessionOwnerConfirmedGone: data.sameSessionOwnerConfirmedGone,
        });
        if (!decision.allowed) return undefined;
        rollbackValue = current == null ? null : current;
        return decision.claim;
      });
      if (!result.committed || !decision?.allowed) {
        return {
          claimed: false,
          reason: decision?.reason === "same-session-owned"
            ? "same-session-owned"
            : "occupied",
        };
      }
      const committed = normalizeClaim(result.snapshot.val());
      if (!committed) throw new Error("training session claim was not committed");
      const legacyAfter = await legacyOccupancy(uid, currentTime());
      const liveAfter = await liveSessionRoom(uid, currentTime());
      const liveOwned = liveAfter
        && liveAfter.sessionId === committed.sessionId
        && liveAfter.active?.generation === committed.generation;
      if (legacyAfter || (liveAfter && !liveOwned)) {
        await reference.transaction((current) => (
          claimMatches(current, {
            sessionId: committed.sessionId,
            leaseToken: committed.leaseToken,
            generation: committed.generation,
            now: currentTime(),
            requireFresh: false,
          }) ? rollbackValue : undefined
        ));
        return { claimed: false, reason: legacyAfter || "occupied" };
      }
      if (!await cleanupReplacedResources(uid, rollbackValue, committed)) {
        await reference.transaction((current) => (
          claimMatches(current, {
            sessionId: committed.sessionId,
            leaseToken: committed.leaseToken,
            generation: committed.generation,
            now: currentTime(),
            requireFresh: false,
          }) ? rollbackValue : undefined
        ));
        throw new Error("training session replacement cleanup failed");
      }
      return claimResponse(committed, decision.reason);
    } finally {
      if (guard) await releaseClaimGuard(uid, guard);
    }
  }

  async function enqueueSession(uid, data) {
    const timestamp = currentTime();
    let claim = normalizeClaim((await claimRef(uid).get()).val());
    if (!claim
        || claim.sessionId !== data.sessionId
        || claim.leaseToken !== data.leaseToken
        || claim.expiresAt <= timestamp) {
      return { queued: false, reason: "lease-lost" };
    }
    const initialRecovery = await recoverOrphanedSessionResources(
      uid,
      data,
      claim,
    );
    if (initialRecovery.reason === "lease-lost") {
      return { queued: false, reason: "lease-lost" };
    }
    if (initialRecovery.reason === "active") {
      return { queued: false, reason: "active" };
    }
    if (initialRecovery.reason === "busy") {
      return { queued: false, reason: "busy" };
    }
    const guard = await acquireClaimGuard(uid, data);
    if (!guard) {
      const [queueSnapshot, activeSnapshot] = await Promise.all([
        queueRef(uid, data.sessionId).get(),
        activeRef(uid, data.sessionId).get(),
      ]);
      if (await referencedLiveRoom(
        uid,
        data.sessionId,
        queueSnapshot.val(),
        activeSnapshot.val(),
        currentTime(),
      )) {
        return { queued: false, reason: "active" };
      }
      return { queued: false, reason: "busy" };
    }
    try {
      const guardedAt = currentTime();
      claim = normalizeClaim((await claimRef(uid).get()).val());
      if (!claim
          || claim.sessionId !== data.sessionId
          || claim.leaseToken !== data.leaseToken
          || claim.expiresAt <= guardedAt) {
        return { queued: false, reason: "lease-lost" };
      }
      if (await legacyOccupancy(uid, guardedAt)
          || await liveSessionRoom(uid, guardedAt)) {
        return { queued: false, reason: "active" };
      }
      const [queueSnapshot, activeSnapshot] = await Promise.all([
        queueRef(uid, data.sessionId).get(),
        activeRef(uid, data.sessionId).get(),
      ]);
      if (await referencedLiveRoom(
        uid,
        data.sessionId,
        queueSnapshot.val(),
        activeSnapshot.val(),
        currentTime(),
      )) {
        return { queued: false, reason: "active" };
      }
      if (activeSnapshot.exists()) {
        return { queued: false, reason: "busy" };
      }
      if (!await renewClaimGuard(uid, guard)) {
        return { queued: false, reason: "busy" };
      }

      const connectionGeneration = token();
      const queuedAt = currentTime();
      let queued = null;
      let reason = "busy";
      const result = await queueRef(uid, data.sessionId)
        .transaction((current) => {
          if (current == null) {
            queued = {
              protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
              trainingProtocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
              variant: TRAINING_GAME_VARIANT,
              uid,
              sessionId: data.sessionId,
              leaseToken: data.leaseToken,
              generation: claim.generation,
              connectionGeneration,
              name: data.name,
              intensity: data.intensity,
              commandDeck: data.commandDeck,
              imageBpms: data.imageBpms,
              joinedAt: queuedAt,
              lastSeen: queuedAt,
              expiresAt: claim.expiresAt,
              state: "waiting",
            };
            reason = "created";
            return queued;
          }
          if (!trainingSessionQueueEntryMatchesClaim(
            uid,
            data.sessionId,
            current,
            claim,
            queuedAt,
            {
              allowedStates: ["waiting"],
              freshMs: TRAINING_SESSION_LEASE_TTL_MS,
            },
          )) {
            reason = current?.state === "offering"
              || current?.state === "reserved"
              ? "active"
              : "busy";
            return undefined;
          }
          queued = {
            ...current,
            lastSeen: queuedAt,
            expiresAt: claim.expiresAt,
          };
          reason = "refreshed";
          return queued;
        });
      if (!result.committed || !queued) {
        return { queued: false, reason };
      }

      const finalAt = currentTime();
      const finalClaim = normalizeClaim((await claimRef(uid).get()).val());
      if (!finalClaim
          || finalClaim.sessionId !== data.sessionId
          || finalClaim.leaseToken !== data.leaseToken
          || finalClaim.generation !== claim.generation
          || finalClaim.expiresAt <= finalAt
          || !await renewClaimGuard(uid, guard)) {
        await removeRecord(
          queueRef(uid, data.sessionId),
          (current) => (
            resourceFenceMatches(current, queued)
            && current.state === "waiting"
            && current.connectionGeneration === queued.connectionGeneration
          ),
        );
        return { queued: false, reason: "lease-lost" };
      }
      if (finalClaim.expiresAt !== queued.expiresAt) {
        const refreshed = await queueRef(uid, data.sessionId)
          .transaction((current) => {
            if (!resourceFenceMatches(current, queued)
                || current.state !== "waiting"
                || current.connectionGeneration !== queued.connectionGeneration) {
              return undefined;
            }
            return {
              ...current,
              lastSeen: finalAt,
              expiresAt: finalClaim.expiresAt,
            };
          });
        if (!refreshed.committed) {
          return { queued: false, reason: "busy" };
        }
        queued = refreshed.snapshot.val();
      }
      return {
        queued: true,
        connectionGeneration: queued.connectionGeneration,
      };
    } finally {
      await releaseClaimGuard(uid, guard);
    }
  }

  async function heartbeatSession(uid, data) {
    let decision = null;
    const result = await claimRef(uid).transaction((current) => {
      if (current == null) return null;
      decision = heartbeatDecision({
        currentClaim: current,
        sessionId: data.sessionId,
        leaseToken: data.leaseToken,
        generation: data.generation,
        now: currentTime(),
        ttlMs: TRAINING_SESSION_LEASE_TTL_MS,
      });
      return decision.allowed ? decision.claim : undefined;
    });
    if (!result.committed || !decision?.allowed) {
      return { claimed: false, reason: "lease-lost" };
    }
    const claim = normalizeClaim(result.snapshot.val());
    if (!claim) throw new Error("training session heartbeat was not committed");
    const fence = {
      sessionId: claim.sessionId,
      leaseToken: claim.leaseToken,
      generation: claim.generation,
    };
    const timestamp = currentTime();
    await Promise.allSettled([
      queueRef(uid, data.sessionId).transaction((current) => {
        if (current == null) return null;
        return resourceFenceMatches(current, fence)
          ? { ...current, lastSeen: timestamp, expiresAt: claim.expiresAt }
          : undefined;
      }),
      activeRef(uid, data.sessionId).transaction((current) => {
        if (current == null) return null;
        return resourceFenceMatches(current, fence)
          ? { ...current, lastSeen: timestamp, expiresAt: claim.expiresAt }
          : undefined;
      }),
    ]);
    return claimResponse(claim, "refreshed");
  }

  async function referencedLiveRoom(uid, sessionId, queue, active, timestamp) {
    const candidateRoomIds = new Set();
    if (ROOM_ID_PATTERN.test(String(queue?.roomId || ""))) {
      candidateRoomIds.add(queue.roomId);
    }
    if (ROOM_ID_PATTERN.test(String(active?.roomId || ""))) {
      candidateRoomIds.add(active.roomId);
    }
    for (const candidateRoomId of candidateRoomIds) {
      const room = (await roomRef(candidateRoomId).get()).val();
      if (trainingSessionRoomMatches(room, {
        uid,
        sessionId,
        generation: active?.generation || queue?.generation,
        roomId: candidateRoomId,
        attemptId: active?.attemptId || queue?.attemptId,
      }) && roomIsLive(room, timestamp, active)) {
        return room;
      }
    }
    return null;
  }

  async function releaseSession(uid, data) {
    const guard = await acquireClaimGuard(uid, data);
    if (!guard) {
      const [queueSnapshot, activeSnapshot] = await Promise.all([
        queueRef(uid, data.sessionId).get(),
        activeRef(uid, data.sessionId).get(),
      ]);
      if (await referencedLiveRoom(
        uid,
        data.sessionId,
        queueSnapshot.val(),
        activeSnapshot.val(),
        currentTime(),
      )) {
        return { released: false, reason: "active" };
      }
      return { released: false, reason: "occupied" };
    }
    try {
      const [claimSnapshot, queueSnapshot, activeSnapshot] = await Promise.all([
        claimRef(uid).get(),
        queueRef(uid, data.sessionId).get(),
        activeRef(uid, data.sessionId).get(),
      ]);
      const claim = normalizeClaim(claimSnapshot.val());
      if (!claim
          || claim.sessionId !== data.sessionId
          || claim.leaseToken !== data.leaseToken
          || claim.generation !== data.generation) {
        return { released: false, reason: "lease-lost" };
      }
      const fence = {
        sessionId: claim.sessionId,
        leaseToken: claim.leaseToken,
        generation: claim.generation,
      };
      const queue = queueSnapshot.val();
      const active = activeSnapshot.val();
      if (await referencedLiveRoom(
        uid,
        data.sessionId,
        queue,
        active,
        currentTime(),
      )) {
        return { released: false, reason: "active" };
      }
      const [queueRemoved, activeRemoved] = await Promise.all([
        removeFencedResource(queueRef(uid, data.sessionId), fence),
        removeFencedResource(activeRef(uid, data.sessionId), fence),
      ]);
      if (!queueRemoved || !activeRemoved) {
        return { released: false, reason: "resource-changed" };
      }
      let released = false;
      const result = await claimRef(uid).transaction((current) => {
        if (!claimMatches(current, {
          sessionId: data.sessionId,
          leaseToken: data.leaseToken,
          generation: data.generation,
          now: currentTime(),
          requireFresh: false,
        })) {
          released = false;
          return undefined;
        }
        released = true;
        return null;
      });
      return result.committed && released
        ? { released: true }
        : { released: false, reason: "lease-lost" };
    } finally {
      await releaseClaimGuard(uid, guard);
    }
  }

  function activeResponse(roomIdValue, room, role) {
    const opponentUid = role === "host" ? room.guestUid : room.hostUid;
    return {
      ...(role === "host"
        ? { outcome: "offered" }
        : { accepted: true }),
      roomId: roomIdValue,
      role,
      opponentUid,
      opponentSessionId: room.sessions?.[opponentUid]?.sessionId || "",
      attemptId: room.attemptId,
      connectionGeneration: room.connectionGeneration,
    };
  }

  function joinResponse(roomIdValue, room, role) {
    const opponentUid = role === "host" ? room.guestUid : room.hostUid;
    return {
      outcome: "join",
      roomId: roomIdValue,
      role,
      opponentUid,
      opponentSessionId: room.sessions?.[opponentUid]?.sessionId || "",
      attemptId: room.attemptId,
      connectionGeneration: room.connectionGeneration,
    };
  }

  function lockMatches(value, expected) {
    return trainingSessionLockMatches(value, expected);
  }

  async function acquirePairLocks(resources) {
    const locks = {
      [resources.hostLock.hostUid]: resources.hostLock,
      [resources.guestLock.guestUid]: resources.guestLock,
    };
    const timestamp = currentTime();
    let acquired = false;
    const result = await realtime.ref(PATHS.locks).transaction((current) => {
      acquired = false;
      const existing = objectValue(current);
      const next = { ...existing };
      for (const [uid, expected] of Object.entries(locks)) {
        if (Number(existing[uid]?.expiresAt || 0) > timestamp
            && !lockMatches(existing[uid], expected)) {
          return current;
        }
        next[uid] = expected;
      }
      acquired = true;
      return next;
    });
    return acquired
      && result.committed
      && Object.entries(locks).every(
        ([uid, expected]) => lockMatches(result.snapshot.child(uid).val(), expected),
      );
  }

  async function releasePairLocks(resources) {
    const expected = {
      [resources.hostLock.hostUid]: resources.hostLock,
      [resources.guestLock.guestUid]: resources.guestLock,
    };
    let safe = false;
    const result = await realtime.ref(PATHS.locks).transaction((current) => {
      const existing = objectValue(current);
      if (Object.entries(expected).some(([uid, lock]) => (
        existing[uid] != null && !lockMatches(existing[uid], lock)
      ))) {
        safe = false;
        return current;
      }
      const next = { ...existing };
      Object.keys(expected).forEach((uid) => delete next[uid]);
      safe = true;
      return Object.keys(next).length ? next : null;
    });
    return safe && Object.keys(expected).every(
      (uid) => result.snapshot.child(uid).val() == null,
    );
  }

  async function reserveQueue(entry, resources, role) {
    const result = await queueRef(entry.uid, entry.sessionId)
      .transaction((current) => {
        if (current == null) return null;
        if (!resourceFenceMatches(current, entry)
            || current.state !== "waiting"
            || Number(current.joinedAt) !== Number(entry.joinedAt)) {
          return undefined;
        }
        return {
          ...current,
          state: role === "host" ? "offering" : "reserved",
          roomId: resources.hostLock.roomId,
          attemptId: resources.hostLock.attemptId,
          lastSeen: currentTime(),
          expiresAt: resources.permit.expiresAt,
        };
      });
    return result.committed ? result.snapshot.val() : null;
  }

  async function restoreQueue(entry, resources) {
    const claimSnapshot = await claimRef(entry.uid).get();
    const timestamp = currentTime();
    let safe = false;
    const result = await queueRef(entry.uid, entry.sessionId)
      .transaction((current) => {
        if (current == null) {
          safe = true;
          return null;
        }
        if (resourceFenceMatches(current, entry)
            && current.state === "waiting"
            && !current.roomId
            && !current.attemptId) {
          safe = true;
          return current;
        }
        if (!resourceFenceMatches(current, entry)
            || current.roomId !== resources.hostLock.roomId
            || current.attemptId !== resources.hostLock.attemptId
            || !["offering", "reserved"].includes(current.state)) {
          safe = false;
          return undefined;
        }
        safe = true;
        const claim = normalizeClaim(claimSnapshot.val());
        if (!claimMatches(claim, {
          sessionId: current.sessionId,
          leaseToken: current.leaseToken,
          generation: current.generation,
          now: timestamp,
        })) return null;
        const next = {
          ...current,
          state: "waiting",
          lastSeen: timestamp,
          expiresAt: claim.expiresAt,
        };
        delete next.roomId;
        delete next.attemptId;
        return next;
      });
    const value = result.snapshot.val();
    return safe && (
      value == null
      || (
        resourceFenceMatches(value, entry)
        && value.state === "waiting"
        && !value.roomId
        && !value.attemptId
      )
    );
  }

  async function materializationFence(resources, host, guest) {
    const [hostClaim, guestClaim, hostQueue, guestQueue, hostLock, guestLock] =
      await Promise.all([
        claimRef(host.uid).get(),
        claimRef(guest.uid).get(),
        queueRef(host.uid, host.sessionId).get(),
        queueRef(guest.uid, guest.sessionId).get(),
        lockRef(host.uid).get(),
        lockRef(guest.uid).get(),
      ]);
    return trainingSessionMaterializationFenceMatches({
      hostClaim: hostClaim.val(),
      guestClaim: guestClaim.val(),
      hostQueue: hostQueue.val(),
      guestQueue: guestQueue.val(),
      hostLock: hostLock.val(),
      guestLock: guestLock.val(),
      attemptId: resources.hostLock.attemptId,
      now: currentTime(),
    });
  }

  function entryFromResources(resources, uid, role) {
    const player = resources.permit.players[uid];
    const session = resources.permit.sessions[uid];
    const active = role === "host" ? resources.hostActive : resources.guestActive;
    return {
      ...player,
      ...session,
      uid,
      leaseToken: active.leaseToken,
      protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    };
  }

  async function cleanupOffered(resources, {
    transitionAction = "",
    transitionToken = "",
    restore = true,
  } = {}) {
    const id = resources.hostLock.roomId;
    let roomSafe = false;
    const roomResult = await roomRef(id).transaction((current) => {
      if (current == null) {
        roomSafe = true;
        return null;
      }
      if (!trainingSessionRoomAttemptMatches(
        current,
        trainingSessionTransitionExpected(resources),
      )
          || current.status !== "offered"
          || (transitionAction
            ? !roomTransitionOwned(current, transitionAction, transitionToken)
            : Boolean(current.matchTransition))) {
        roomSafe = false;
        return undefined;
      }
      roomSafe = true;
      return null;
    });
    if (!roomSafe || (!roomResult.committed && roomResult.snapshot.val() != null)) {
      return false;
    }
    const hostUid = resources.permit.hostUid;
    const guestUid = resources.permit.guestUid;
    const hostSession = resources.permit.sessions[hostUid];
    const guestSession = resources.permit.sessions[guestUid];
    const removed = await Promise.all([
      removeRecord(permitRef(id), (current) => (
        trainingSessionRecordSessionsMatch(current, resources)
      )),
      removeRecord(offerRef(guestUid, guestSession.sessionId, id), (current) => (
        trainingSessionRecordSessionsMatch(current, resources)
      )),
      removeRecord(activeRef(hostUid, hostSession.sessionId), (current) => (
        exactActiveIdentity(
          current,
          resources.hostActive,
          hostUid,
          hostSession.sessionId,
        )
      )),
      removeRecord(activeRef(guestUid, guestSession.sessionId), (current) => (
        current == null || exactActiveIdentity(
          current,
          resources.guestActive,
          guestUid,
          guestSession.sessionId,
        )
      )),
    ]);
    if (removed.some((safe) => !safe)) return false;
    if (restore) {
      const restored = await Promise.all([
        restoreQueue(entryFromResources(resources, hostUid, "host"), resources),
        restoreQueue(entryFromResources(resources, guestUid, "guest"), resources),
      ]);
      if (restored.some((safe) => !safe)) return false;
    }
    return releasePairLocks(resources);
  }

  async function existingSessionMatch(uid, claim, timestamp) {
    const active = (await activeRef(uid, claim.sessionId).get()).val();
    if (!trainingSessionActiveEntryIsFresh(uid, active, claim, timestamp)) return null;
    const room = (await roomRef(active.roomId).get()).val();
    if (!trainingSessionRoomMatches(room, {
      uid,
      sessionId: claim.sessionId,
      generation: claim.generation,
      roomId: active.roomId,
      attemptId: active.attemptId,
    })
        || room.destroyed
        || room.serverFinalized
        || !["offered", "active"].includes(room.status)
        || active.connectionGeneration !== room.connectionGeneration) return null;
    const role = room.hostUid === uid
      ? "host"
      : room.guestUid === uid
        ? "guest"
        : "";
    if (!role || active.role !== role) return null;
    if (room.status === "active") {
      if (room.accepted?.[room.hostUid] !== true
          || room.accepted?.[room.guestUid] !== true) return null;
      return {
        expired: false,
        response: joinResponse(active.roomId, room, role),
      };
    }
    if (role !== "host") return null;
    if (Number(room.expiresAt || 0) <= timestamp) {
      return {
        expired: true,
        roomId: active.roomId,
      };
    }
    return {
      expired: false,
      response: activeResponse(active.roomId, room, "host"),
    };
  }

  async function tryMatch(uid, data) {
    const timestamp = currentTime();
    let claim = normalizeClaim((await claimRef(uid).get()).val());
    if (!claim
        || claim.sessionId !== data.sessionId
        || claim.leaseToken !== data.leaseToken
        || claim.expiresAt <= timestamp) {
      return { outcome: "lease-lost" };
    }
    if (await legacyOccupancy(uid, timestamp)) return { outcome: "occupied" };
    const existing = await existingSessionMatch(uid, claim, currentTime());
    if (existing?.response) return existing.response;
    if (existing?.expired) {
      const expired = await cancelMatch(uid, {
        sessionId: data.sessionId,
        leaseToken: data.leaseToken,
        roomId: existing.roomId,
      }, { expireOnly: true });
      if (expired.reason === "active") {
        return { outcome: "waiting" };
      }
    }
    const recovery = await recoverOrphanedSessionResources(uid, data, claim);
    if (recovery.reason === "lease-lost") return { outcome: "lease-lost" };
    if (["active", "busy"].includes(recovery.reason)) {
      return { outcome: "waiting" };
    }
    claim = normalizeClaim((await claimRef(uid).get()).val());
    if (!claim
        || claim.sessionId !== data.sessionId
        || claim.leaseToken !== data.leaseToken
        || claim.expiresAt <= currentTime()) {
      return { outcome: "lease-lost" };
    }
    const selectionTime = currentTime();
    const [queueSnapshot, claimsSnapshot, activeSnapshot, locksSnapshot] =
      await Promise.all([
        realtime.ref(PATHS.queue).get(),
        realtime.ref(PATHS.claims).get(),
        realtime.ref(PATHS.active).get(),
        realtime.ref(PATHS.locks).get(),
      ]);
    if (queueSnapshot.numChildren() > 2_000
        || activeSnapshot.numChildren() > 2_000) {
      throw new HttpsError("resource-exhausted", "鍛え合いの待機情報が混み合っています。");
    }
    const claims = {
      ...objectValue(claimsSnapshot.val()),
      [uid]: claim,
    };
    const queue = flattenFreshTrainingQueueV4(
      queueSnapshot.val(),
      claims,
      selectionTime,
    );
    const activeUids = [];
    for (const [candidateUid, sessions] of Object.entries(
      objectValue(activeSnapshot.val()),
    )) {
      if (Object.values(objectValue(sessions)).some((entry) => (
        trainingSessionActiveEntryIsFresh(
          candidateUid,
          entry,
          claims[candidateUid],
          selectionTime,
        )
      ))) activeUids.push(candidateUid);
    }
    const lockedUids = Object.entries(objectValue(locksSnapshot.val()))
      .filter(([, lock]) => Number(lock?.expiresAt || 0) > selectionTime)
      .map(([candidateUid]) => candidateUid);
    const selection = selectTrainingSessionMatch({
      requesterUid: uid,
      queue,
      activeUids,
      lockedUids,
      avoidUid: data.avoidUid,
    });
    if (!selection) return { outcome: "waiting" };
    const pushed = realtime.ref(PATHS.rooms).push();
    const newRoomId = String(pushed?.key || "");
    if (!ROOM_ID_PATTERN.test(newRoomId)) {
      throw new HttpsError("unavailable", "鍛え合いルームを準備できませんでした。");
    }
    const createdAt = currentTime();
    const resources = buildTrainingSessionResources({
      roomId: newRoomId,
      attemptId: token(),
      connectionGeneration: token(),
      host: selection.host,
      guest: selection.candidate,
      hostConditions: data.conditions,
      now: createdAt,
      expiresAt: createdAt + TRAINING_SESSION_MATCH_TTL_MS,
    });
    if (!await acquirePairLocks(resources)) return { outcome: "waiting" };
    const [
      hostClaim,
      guestClaim,
      hostQueue,
      guestQueue,
      hostLock,
      guestLock,
      hostLegacy,
      guestLegacy,
    ] =
      await Promise.all([
        claimRef(selection.host.uid).get(),
        claimRef(selection.candidate.uid).get(),
        queueRef(selection.host.uid, selection.host.sessionId).get(),
        queueRef(selection.candidate.uid, selection.candidate.sessionId).get(),
        lockRef(selection.host.uid).get(),
        lockRef(selection.candidate.uid).get(),
        legacyOccupancy(selection.host.uid, currentTime()),
        legacyOccupancy(selection.candidate.uid, currentTime()),
      ]);
    const validationTime = currentTime();
    if (!trainingSessionQueueEntryMatchesClaim(
      selection.host.uid,
      selection.host.sessionId,
      hostQueue.val(),
      hostClaim.val(),
      validationTime,
    )
        || !trainingSessionQueueEntryMatchesClaim(
          selection.candidate.uid,
          selection.candidate.sessionId,
          guestQueue.val(),
          guestClaim.val(),
          validationTime,
        )
        || !trainingSessionLockMatches(hostLock.val(), resources.hostLock)
        || !trainingSessionLockMatches(guestLock.val(), resources.guestLock)
        || hostLegacy
        || guestLegacy) {
      await releasePairLocks(resources);
      return { outcome: "waiting" };
    }
    const [reservedHost, reservedGuest] = await Promise.all([
      reserveQueue(selection.host, resources, "host"),
      reserveQueue(selection.candidate, resources, "guest"),
    ]);
    if (!reservedHost || !reservedGuest
        || !await materializationFence(resources, selection.host, selection.candidate)) {
      resources.hostQueue = reservedHost;
      resources.guestQueue = reservedGuest;
      await cleanupOffered(resources).catch(() => {});
      return { outcome: "waiting" };
    }
    resources.hostQueue = reservedHost;
    resources.guestQueue = reservedGuest;
    await realtime.ref("online").update({
      [`trainingMatchPermitsV4/${newRoomId}`]: resources.permit,
      [`trainingRooms/${newRoomId}`]: resources.room,
      [`trainingActiveV4/${selection.host.uid}/${selection.host.sessionId}`]:
        resources.hostActive,
      [`trainingOffersV4/${selection.candidate.uid}/${selection.candidate.sessionId}/${newRoomId}`]:
        resources.offer,
    });
    if (!await materializationFence(resources, selection.host, selection.candidate)) {
      await cleanupOffered(resources).catch(() => {});
      return { outcome: "waiting" };
    }
    return activeResponse(newRoomId, resources.room, "host");
  }

  function resourcesFromStored(
    id,
    room,
    permit,
    {
      hostActive,
      guestActive = null,
      hostQueue,
      guestQueue,
      hostLock,
      guestLock,
      requireFreshLocks = true,
    },
  ) {
    if (!trainingSessionRoomAttemptMatches(room, room)
        || room.status !== "offered"
        || !sessionRecordMatchesRoom(permit, room)) return null;
    const hostUid = room.hostUid;
    const guestUid = room.guestUid;
    const hostSession = room.sessions?.[hostUid];
    const guestSession = room.sessions?.[guestUid];
    if (!hostSession || !guestSession
        || !trainingSessionActiveMatchesRoom(
          hostActive,
          hostUid,
          hostSession,
          id,
          room,
        )
        || !trainingSessionQueueMatchesRoom(
          hostQueue,
          hostUid,
          hostSession,
          id,
          room,
        )
        || !trainingSessionQueueMatchesRoom(
          guestQueue,
          guestUid,
          guestSession,
          id,
          room,
        )) return null;
    let resources;
    try {
      resources = buildTrainingSessionResources({
        roomId: id,
        attemptId: room.attemptId,
        connectionGeneration: room.connectionGeneration,
        host: {
          ...room.players[hostUid],
          ...hostSession,
          uid: hostUid,
          leaseToken: hostActive.leaseToken,
          protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
        },
        guest: {
          ...guestQueue,
          ...room.players[guestUid],
          ...guestSession,
          uid: guestUid,
          leaseToken: guestQueue.leaseToken,
          protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
        },
        hostConditions: room.players[hostUid].conditions,
        now: Number(room.createdAt),
        expiresAt: Math.max(
          Number(room.expiresAt || 0),
          Number(permit.expiresAt || 0),
        ),
      });
    } catch {
      return null;
    }
    if (!trainingSessionRecordSessionsMatch(permit, resources)
        || !trainingSessionLockMatches(hostLock, resources.hostLock)
        || !trainingSessionLockMatches(guestLock, resources.guestLock)
        || (requireFreshLocks
          && (
            Number(hostLock?.expiresAt || 0) <= currentTime()
            || Number(guestLock?.expiresAt || 0) <= currentTime()
          ))) return null;
    resources.room = room;
    resources.permit = permit;
    resources.hostActive = hostActive;
    if (guestActive) resources.guestActive = guestActive;
    resources.hostQueue = hostQueue;
    resources.guestQueue = guestQueue;
    resources.hostLock = hostLock;
    resources.guestLock = guestLock;
    return resources;
  }

  async function acquireRoomTransition(id, room, action, options = {}) {
    const transitionToken = token();
    let decision = null;
    const result = await roomRef(id).transaction((current) => {
      if (current == null) return null;
      decision = decideTrainingSessionRoomTransition({
        room: current,
        expected: {
          attemptId: room.attemptId,
          connectionGeneration: room.connectionGeneration,
        },
        action,
        token: transitionToken,
        now: currentTime(),
        ...options,
      });
      return decision.allowed ? decision.room : undefined;
    });
    const value = result.snapshot.val();
    return {
      acquired: result.committed
        && roomTransitionOwned(value, action, transitionToken),
      reason: decision?.reason || "room-changed",
      room: value,
      token: transitionToken,
    };
  }

  async function refreshActivePair(resources) {
    const hostUid = resources.permit.hostUid;
    const guestUid = resources.permit.guestUid;
    const hostSession = resources.permit.sessions[hostUid];
    const guestSession = resources.permit.sessions[guestUid];
    const [hostClaimSnapshot, guestClaimSnapshot] = await Promise.all([
      claimRef(hostUid).get(),
      claimRef(guestUid).get(),
    ]);
    const timestamp = currentTime();
    const hostClaim = normalizeClaim(hostClaimSnapshot.val());
    const guestClaim = normalizeClaim(guestClaimSnapshot.val());
    if (!claimMatches(hostClaim, {
      sessionId: hostSession.sessionId,
      leaseToken: resources.hostActive.leaseToken,
      generation: hostSession.generation,
      now: timestamp,
    }) || !claimMatches(guestClaim, {
      sessionId: guestSession.sessionId,
      leaseToken: resources.guestActive.leaseToken,
      generation: guestSession.generation,
      now: timestamp,
    })) return false;
    const refresh = async (uid, sessionId, expected, claim) => {
      let safe = false;
      const result = await activeRef(uid, sessionId).transaction((current) => {
        if (current == null) return null;
        if (!exactActiveIdentity(current, expected, uid, sessionId)) {
          safe = false;
          return undefined;
        }
        safe = true;
        return {
          ...current,
          lastSeen: timestamp,
          expiresAt: claim.expiresAt,
        };
      });
      return safe && result.committed ? result.snapshot.val() : null;
    };
    const [hostActive, guestActive] = await Promise.all([
      refresh(hostUid, hostSession.sessionId, resources.hostActive, hostClaim),
      refresh(guestUid, guestSession.sessionId, resources.guestActive, guestClaim),
    ]);
    if (!hostActive || !guestActive) return false;
    resources.hostActive = hostActive;
    resources.guestActive = guestActive;
    return true;
  }

  async function clearAcceptTransition(id, resources, transitionToken) {
    let safe = false;
    const result = await roomRef(id).transaction((current) => {
      if (current == null) return null;
      if (!trainingSessionRoomAttemptMatches(
        current,
        trainingSessionTransitionExpected(resources),
      )
          || !roomTransitionOwned(current, "accept", transitionToken)
          || current.destroyed) {
        safe = false;
        return undefined;
      }
      const next = { ...current };
      delete next.matchTransition;
      safe = true;
      return next;
    });
    return safe && result.committed;
  }

  async function finalizeAccepted(id, resources, transitionToken) {
    const hostUid = resources.permit.hostUid;
    const guestUid = resources.permit.guestUid;
    const hostSession = resources.permit.sessions[hostUid];
    const guestSession = resources.permit.sessions[guestUid];
    const checks = [
      await removeRecord(
        offerRef(guestUid, guestSession.sessionId, id),
        (current) => trainingSessionRecordSessionsMatch(current, resources),
      ),
      await removeRecord(
        queueRef(hostUid, hostSession.sessionId),
        (current) => (
          resourceFenceMatches(current, resources.hostActive)
          && current.roomId === id
          && current.attemptId === resources.hostLock.attemptId
        ),
      ),
      await removeRecord(
        queueRef(guestUid, guestSession.sessionId),
        (current) => (
          resourceFenceMatches(current, resources.guestActive)
          && current.roomId === id
          && current.attemptId === resources.guestLock.attemptId
        ),
      ),
      await removeRecord(
        permitRef(id),
        (current) => trainingSessionRecordSessionsMatch(current, resources),
      ),
      await releasePairLocks(resources),
    ];
    if (checks.some((safe) => !safe)) return false;
    return clearAcceptTransition(id, resources, transitionToken);
  }

  async function acceptMatch(uid, data) {
    const timestamp = currentTime();
    const claim = normalizeClaim((await claimRef(uid).get()).val());
    if (!claim
        || claim.sessionId !== data.sessionId
        || claim.leaseToken !== data.leaseToken
        || claim.expiresAt <= timestamp) {
      return { accepted: false, reason: "lease-lost" };
    }
    const [roomSnapshot, ownActiveSnapshot] = await Promise.all([
      roomRef(data.roomId).get(),
      activeRef(uid, data.sessionId).get(),
    ]);
    const initialRoom = roomSnapshot.val();
    if (initialRoom?.status === "active"
        && !initialRoom.destroyed
        && initialRoom.guestUid === uid
        && trainingSessionRoomMatches(initialRoom, {
          uid,
          sessionId: data.sessionId,
          generation: claim.generation,
          roomId: data.roomId,
        })
        && trainingSessionActiveMatchesRoom(
          ownActiveSnapshot.val(),
          uid,
          initialRoom.sessions?.[uid],
          data.roomId,
          initialRoom,
        )
        && ownActiveSnapshot.val()?.role === "guest"
        && trainingSessionActiveEntryIsFresh(
          uid,
          ownActiveSnapshot.val(),
          claim,
          timestamp,
        )) {
      return activeResponse(data.roomId, initialRoom, "guest");
    }
    const [offerSnapshot, permitSnapshot] = await Promise.all([
      offerRef(uid, data.sessionId, data.roomId).get(),
      permitRef(data.roomId).get(),
    ]);
    const offer = offerSnapshot.val();
    const permit = permitSnapshot.val();
    if (!offer
        || offer.toUid !== uid
        || offer.toSessionId !== data.sessionId
        || offer.fromUid !== initialRoom?.hostUid
        || offer.fromSessionId
          !== initialRoom?.sessions?.[initialRoom?.hostUid]?.sessionId
        || Number(offer.expiresAt || 0) <= timestamp
        || Number(initialRoom?.expiresAt || 0) <= timestamp
        || Number(permit?.expiresAt || 0) <= timestamp
        || initialRoom?.status !== "offered"
        || !trainingSessionRoomMatches(initialRoom, {
          uid,
          sessionId: data.sessionId,
          generation: claim.generation,
          roomId: data.roomId,
          attemptId: offer.attemptId,
        })
        || !sessionRecordMatchesRoom(offer, initialRoom)
        || !sessionRecordMatchesRoom(permit, initialRoom)) {
      return { accepted: false, reason: "offer-stale" };
    }
    const hostUid = initialRoom.hostUid;
    const hostSession = initialRoom.sessions[hostUid];
    const guestSession = initialRoom.sessions[uid];
    const [
      hostClaimSnapshot,
      hostActiveSnapshot,
      hostQueueSnapshot,
      guestQueueSnapshot,
      hostLockSnapshot,
      guestLockSnapshot,
    ] = await Promise.all([
      claimRef(hostUid).get(),
      activeRef(hostUid, hostSession.sessionId).get(),
      queueRef(hostUid, hostSession.sessionId).get(),
      queueRef(uid, data.sessionId).get(),
      lockRef(hostUid).get(),
      lockRef(uid).get(),
    ]);
    const resources = resourcesFromStored(
      data.roomId,
      initialRoom,
      permit,
      {
        hostActive: hostActiveSnapshot.val(),
        hostQueue: hostQueueSnapshot.val(),
        guestQueue: guestQueueSnapshot.val(),
        hostLock: hostLockSnapshot.val(),
        guestLock: guestLockSnapshot.val(),
      },
    );
    if (!resources
        || !claimMatches(hostClaimSnapshot.val(), {
          sessionId: hostSession.sessionId,
          leaseToken: resources.hostActive.leaseToken,
          generation: hostSession.generation,
          now: currentTime(),
        })) {
      return { accepted: false, reason: "offer-stale" };
    }
    const transition = await acquireRoomTransition(
      data.roomId,
      resources.room,
      "accept",
    );
    if (!transition.acquired) {
      return { accepted: false, reason: transition.reason };
    }
    resources.room = transition.room;
    resources.guestActive.lastSeen = currentTime();
    resources.guestActive.expiresAt = claim.expiresAt;
    resources.hostActive.expiresAt = normalizeClaim(hostClaimSnapshot.val()).expiresAt;
    const guestReservation = await activeRef(uid, data.sessionId)
      .transaction((current) => {
        if (current
            && Number(current.expiresAt || 0) > currentTime()
            && !exactActiveIdentity(
              current,
              resources.guestActive,
              uid,
              data.sessionId,
            )) return undefined;
        return resources.guestActive;
      });
    if (!guestReservation.committed) {
      return { accepted: false, reason: "occupied" };
    }
    resources.guestActive = guestReservation.snapshot.val();
    if (!await refreshActivePair(resources)) {
      await cleanupOffered(resources, {
        transitionAction: "accept",
        transitionToken: transition.token,
      }).catch(() => {});
      return { accepted: false, reason: "offer-stale" };
    }
    const [
      finalClaimSnapshot,
      finalRoomSnapshot,
      finalOfferSnapshot,
      finalHostActiveSnapshot,
      fenceStillValid,
    ] = await Promise.all([
      claimRef(uid).get(),
      roomRef(data.roomId).get(),
      offerRef(uid, data.sessionId, data.roomId).get(),
      activeRef(hostUid, hostSession.sessionId).get(),
      materializationFence(
        resources,
        entryFromResources(resources, hostUid, "host"),
        entryFromResources(resources, uid, "guest"),
      ),
    ]);
    const finalRoom = finalRoomSnapshot.val();
    if (!claimMatches(finalClaimSnapshot.val(), {
      sessionId: data.sessionId,
      leaseToken: data.leaseToken,
      generation: guestSession.generation,
      now: currentTime(),
    })
        || finalRoom?.status !== "offered"
        || !trainingSessionRoomAttemptMatches(
          finalRoom,
          trainingSessionTransitionExpected(resources),
        )
        || !roomTransitionOwned(finalRoom, "accept", transition.token)
        || !trainingSessionRecordSessionsMatch(
          finalOfferSnapshot.val(),
          resources,
        )
        || !exactActiveIdentity(
          finalHostActiveSnapshot.val(),
          resources.hostActive,
          hostUid,
          hostSession.sessionId,
        )
        || !fenceStillValid) {
      await removeRecord(
        activeRef(uid, data.sessionId),
        (current) => exactActiveIdentity(
          current,
          resources.guestActive,
          uid,
          data.sessionId,
        ),
      );
      await clearAcceptTransition(
        data.roomId,
        resources,
        transition.token,
      ).catch(() => false);
      return { accepted: false, reason: "offer-stale" };
    }
    const activationTime = currentTime();
    let activated = false;
    const activation = await roomRef(data.roomId).transaction((current) => {
      const next = activateTrainingSessionRoom(current, {
        expected: trainingSessionTransitionExpected(resources),
        transitionToken: transition.token,
        guestUid: uid,
        conditions: data.conditions,
        now: activationTime,
      });
      if (!next) {
        activated = false;
        return undefined;
      }
      if (next.rounds != null) {
        activated = false;
        return undefined;
      }
      activated = true;
      return {
        ...next,
        rounds: {
          1: {
            createdAt: activationTime,
          },
        },
      };
    });
    if (!activated || !activation.committed) {
      return { accepted: false, reason: "offer-stale" };
    }
    resources.room = activation.snapshot.val();
    await finalizeAccepted(data.roomId, resources, transition.token).catch(() => false);
    const completedRoom = (await roomRef(data.roomId).get()).val();
    return activeResponse(data.roomId, completedRoom || resources.room, "guest");
  }

  async function resourcesForOfferedRoom(id, room) {
    const hostUid = room.hostUid;
    const guestUid = room.guestUid;
    const hostSession = room.sessions?.[hostUid];
    const guestSession = room.sessions?.[guestUid];
    if (!hostSession || !guestSession) return null;
    const [permit, hostActive, guestActive, hostQueue, guestQueue, hostLock, guestLock] =
      await Promise.all([
        permitRef(id).get(),
        activeRef(hostUid, hostSession.sessionId).get(),
        activeRef(guestUid, guestSession.sessionId).get(),
        queueRef(hostUid, hostSession.sessionId).get(),
        queueRef(guestUid, guestSession.sessionId).get(),
        lockRef(hostUid).get(),
        lockRef(guestUid).get(),
      ]);
    return resourcesFromStored(id, room, permit.val(), {
      hostActive: hostActive.val(),
      guestActive: guestActive.val(),
      hostQueue: hostQueue.val(),
      guestQueue: guestQueue.val(),
      hostLock: hostLock.val(),
      guestLock: guestLock.val(),
      requireFreshLocks: false,
    });
  }

  async function cancelMatch(uid, data, { expireOnly = false } = {}) {
    const [claimSnapshot, roomSnapshot] = await Promise.all([
      claimRef(uid).get(),
      roomRef(data.roomId).get(),
    ]);
    const claim = normalizeClaim(claimSnapshot.val());
    const room = roomSnapshot.val();
    if (!claim
        || claim.sessionId !== data.sessionId
        || claim.leaseToken !== data.leaseToken
        || claim.expiresAt <= currentTime()
        || !trainingSessionRoomMatches(room, {
          uid,
          sessionId: data.sessionId,
          generation: claim.generation,
          roomId: data.roomId,
        })) {
      return { cancelled: false, reason: "not-owner", status: "" };
    }
    const activeAbort = !expireOnly
      && room.status === "active"
      && (data.abort === true || Boolean(room.destroyed));
    if (room.status === "active") {
      if (room.serverFinalized) {
        return { cancelled: false, reason: "finalized", status: "active" };
      }
      if (trainingResultStatus(room, currentTime()) === "final") {
        return { cancelled: false, reason: "resolved", status: "active" };
      }
      if (!activeAbort) {
        return { cancelled: false, reason: "active", status: "active" };
      }
    } else if (room.status !== "offered") {
      return {
        cancelled: false,
        reason: "terminal",
        status: String(room.status || ""),
      };
    }
    const action = expireOnly ? "expire" : "cancel";
    const transition = await acquireRoomTransition(data.roomId, room, action, {
      allowActiveCancel: activeAbort,
    });
    if (!transition.acquired) {
      return {
        cancelled: false,
        reason: transition.reason,
        status: String(room.status || ""),
      };
    }
    if (transition.room.status === "active") {
      let destroyed = false;
      let blockedReason = "";
      const result = await roomRef(data.roomId).transaction((current) => {
        if (!trainingSessionRoomAttemptMatches(current, transition.room)
            || !roomTransitionOwned(current, action, transition.token)
            || current.serverFinalized) {
          destroyed = false;
          blockedReason = current?.serverFinalized ? "finalized" : "room-changed";
          return undefined;
        }
        if (trainingResultStatus(current, currentTime()) === "final") {
          destroyed = false;
          blockedReason = "resolved";
          return undefined;
        }
        const next = {
          ...current,
          destroyed: current.destroyed || {
            by: uid,
            at: currentTime(),
            reason: "session-abort",
            attemptId: current.attemptId,
            connectionGeneration: current.connectionGeneration,
          },
        };
        delete next.matchTransition;
        destroyed = true;
        return next;
      });
      if (!destroyed || !result.committed) {
        return {
          cancelled: false,
          reason: blockedReason || "cleanup-incomplete",
          status: "active",
        };
      }
      const hostUid = room.hostUid;
      const guestUid = room.guestUid;
      const hostSession = room.sessions[hostUid];
      const guestSession = room.sessions[guestUid];
      const [hostActive, guestActive] = await Promise.all([
        activeRef(hostUid, hostSession.sessionId).get(),
        activeRef(guestUid, guestSession.sessionId).get(),
      ]);
      await Promise.all([
        removeRecord(
          activeRef(hostUid, hostSession.sessionId),
          (current) => exactActiveIdentity(
            current,
            hostActive.val(),
            hostUid,
            hostSession.sessionId,
          ),
        ),
        removeRecord(
          activeRef(guestUid, guestSession.sessionId),
          (current) => exactActiveIdentity(
            current,
            guestActive.val(),
            guestUid,
            guestSession.sessionId,
          ),
        ),
      ]);
      return { cancelled: true, status: "destroyed" };
    }
    const resources = await resourcesForOfferedRoom(data.roomId, transition.room);
    if (!resources) {
      return {
        cancelled: false,
        reason: "stale",
        status: "offered",
      };
    }
    resources.room = transition.room;
    const cleaned = await cleanupOffered(resources, {
      transitionAction: action,
      transitionToken: transition.token,
      restore: true,
    });
    return cleaned
      ? { cancelled: true, status: "expired" }
      : { cancelled: false, reason: "cleanup-incomplete", status: "offered" };
  }

  async function dispatch(uidValue, input) {
    const uid = normalizeUid(uidValue);
    const data = requireActionData(input);
    await consumeRate(uid, data.action);
    if (data.action === "claim") return claimSession(uid, data);
    if (data.action === "enqueue") return enqueueSession(uid, data);
    if (data.action === "heartbeat") return heartbeatSession(uid, data);
    if (data.action === "release") return releaseSession(uid, data);
    if (data.action === "try_match") return tryMatch(uid, data);
    if (data.action === "accept") return acceptMatch(uid, data);
    if (data.action === "cancel") return cancelMatch(uid, data);
    if (data.action === "expire") {
      return cancelMatch(uid, data, { expireOnly: true });
    }
    throw new HttpsError("invalid-argument", "未対応の鍛え合いセッション操作です。");
  }

  return Object.freeze({
    PATHS,
    accept: (uid, data) => dispatch(uid, { ...data, action: "accept" }),
    cancel: (uid, data) => dispatch(uid, { ...data, action: "cancel" }),
    claim: (uid, data) => dispatch(uid, { ...data, action: "claim" }),
    dispatch,
    enqueue: (uid, data) => dispatch(uid, { ...data, action: "enqueue" }),
    expire: (uid, data) => dispatch(uid, { ...data, action: "expire" }),
    heartbeat: (uid, data) => dispatch(uid, { ...data, action: "heartbeat" }),
    liveRoom: (uidValue, timestamp = currentTime()) => {
      const uid = normalizeUid(uidValue);
      const normalizedTime = Number(timestamp);
      if (!Number.isSafeInteger(normalizedTime) || normalizedTime <= 0) {
        throw new TypeError("training session live-room time is invalid");
      }
      return liveSessionRoom(uid, normalizedTime);
    },
    release: (uid, data) => dispatch(uid, { ...data, action: "release" }),
    tryMatch: (uid, data) => dispatch(uid, { ...data, action: "try_match" }),
  });
}

module.exports = Object.freeze({
  ACTION_RATE_POLICIES,
  PATHS,
  createTrainingSessionService,
});
