"use strict";

const {
  CHAT_FRAME_IDS,
  activateMatchDecision,
  attemptIsQueueFresh,
  buildActiveTrainingRoom,
  buildDestroyedTrainingRoomFence,
  cancelAttemptDecision,
  convergeReservationDecision,
  heartbeatAttemptDecision,
  isSafeToken,
  isSafeUid,
  normalizePendingRoomCleanup,
  normalizeTrainingAttempt,
  normalizeTrainingPreparation,
  pendingRoomCleanupMatches,
  reciprocalReservation,
  reconnectAttemptDecision,
  reservationFenceMatches,
  reserveMatchDecision,
  roomMatchesAttempt,
  roomMatchesAttemptIdentity,
  roomMatchesCleanupDescriptor,
  startAttemptDecision,
} = require("./training-session-v5");
const {
  ACTIVE_PRESENCE_FRESH_MS,
  trainingPresenceV5IsFreshOnline,
} = require("./training-session-v5-cleanup");

const ACTIVE_START_PRESENCE_GRACE_MS = 90 * 1000;
const ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS = 30 * 1000;

const PATHS = Object.freeze({
  attempts: "online/trainingAttemptsV5",
  rates: "online/trainingSessionActionRates",
  rooms: "online/trainingRooms",
  economy: "online/economy",
});

const ACTION_RATE_POLICIES = Object.freeze({
  start: Object.freeze({ windowMs: 60_000, limit: 12 }),
  heartbeat: Object.freeze({ windowMs: 60_000, limit: 30 }),
  match: Object.freeze({ windowMs: 60_000, limit: 90 }),
  inspect: Object.freeze({ windowMs: 60_000, limit: 90 }),
  reconnect: Object.freeze({ windowMs: 60_000, limit: 30 }),
  cancel: Object.freeze({ windowMs: 60_000, limit: 30 }),
});

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function createTrainingSessionV5Service({
  realtime,
  HttpsError,
  crypto,
  now = Date.now,
} = {}) {
  if (!realtime || typeof realtime.ref !== "function") {
    throw new TypeError("realtime is required");
  }
  if (typeof HttpsError !== "function") throw new TypeError("HttpsError is required");
  if (!crypto
      || typeof crypto.randomBytes !== "function"
      || typeof crypto.createHash !== "function") {
    throw new TypeError("crypto is required");
  }
  if (typeof now !== "function") throw new TypeError("now is required");

  const currentTime = () => {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError("training V5 clock is invalid");
    }
    return value;
  };
  const path = (base, ...parts) => [base, ...parts].map(String).join("/");
  const attemptsRef = () => realtime.ref(PATHS.attempts);
  const attemptRef = (uid) => realtime.ref(path(PATHS.attempts, uid));
  const roomRef = (roomId) => realtime.ref(path(PATHS.rooms, roomId));
  const economyRef = (uid) => realtime.ref(path(PATHS.economy, uid));

  function token() {
    const bytes = crypto.randomBytes(16);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 16) {
      throw new TypeError("training V5 token source is invalid");
    }
    return bytes.toString("base64url");
  }

  function normalizeUid(value) {
    const uid = String(value || "");
    if (!isSafeUid(uid)) {
      throw new HttpsError("unauthenticated", "ログインを確認してください。");
    }
    return uid;
  }

  function inputToken(value, label) {
    if (!isSafeToken(value)) {
      throw new HttpsError("invalid-argument", `${label}を確認してください。`);
    }
    return value;
  }

  function requireActionData(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new HttpsError("invalid-argument", "鍛え合いセッションの形式が正しくありません。");
    }
    const action = String(input.action || "");
    const allowedByAction = {
      start: new Set(["action", "runId", "endpointId", "preparation"]),
      heartbeat: new Set(["action", "runId", "endpointId", "ownerEpoch"]),
      match: new Set(["action", "runId", "endpointId", "ownerEpoch", "avoidUid"]),
      inspect: new Set(["action", "runId", "endpointId", "ownerEpoch"]),
      reconnect: new Set([
        "action",
        "runId",
        "endpointId",
        "ownerEpoch",
        "roomAttemptId",
        "transportEpoch",
      ]),
      cancel: new Set(["action", "runId", "endpointId", "ownerEpoch"]),
    };
    const allowed = allowedByAction[action];
    if (!allowed || Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !allowed.has(key),
    )) {
      throw new HttpsError("invalid-argument", "未対応の鍛え合いセッション操作です。");
    }
    const data = {
      action,
      runId: inputToken(input.runId, "参加試行"),
      endpointId: inputToken(input.endpointId, "この画面"),
    };
    if (action === "start") {
      const preparation = normalizeTrainingPreparation(input.preparation);
      if (!preparation) {
        throw new HttpsError("invalid-argument", "鍛え合いの事前準備を確認してください。");
      }
      data.preparation = preparation;
    } else {
      data.ownerEpoch = inputToken(input.ownerEpoch, "参加試行の所有権");
    }
    if (action === "match" && Object.hasOwn(input, "avoidUid")) {
      const avoidUid = String(input.avoidUid || "");
      if (avoidUid && !isSafeUid(avoidUid)) {
        throw new HttpsError("invalid-argument", "再マッチ対象を確認してください。");
      }
      data.avoidUid = avoidUid;
    }
    if (action === "reconnect") {
      data.roomAttemptId = inputToken(input.roomAttemptId, "対戦ルーム試行");
      data.transportEpoch = inputToken(input.transportEpoch, "通信世代");
    }
    return data;
  }

  function ratePath(uid, action) {
    const ownerHash = crypto
      .createHash("sha256")
      .update("training-session-action-rate:v5:")
      .update(uid)
      .digest("hex");
    return path(PATHS.rates, ownerHash, action);
  }

  async function consumeRate(uid, action) {
    const policy = ACTION_RATE_POLICIES[action];
    const timestamp = currentTime();
    let allowed = false;
    const result = await realtime.ref(ratePath(uid, action)).transaction((current) => {
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
    }, undefined, false);
    if (!result.committed || !allowed) {
      throw new HttpsError(
        "resource-exhausted",
        "鍛え合いの操作が短時間に集中しています。少し待ってからお試しください。",
      );
    }
  }

  function attemptView(attempt) {
    if (!attempt) return {};
    return {
      uid: attempt.uid,
      runId: attempt.runId,
      endpointId: attempt.endpointId,
      ownerEpoch: attempt.ownerEpoch,
      revision: attempt.revision,
      state: attempt.state,
      queueExpiresAt: attempt.queueExpiresAt,
      ...(["reserved", "active"].includes(attempt.state) ? {
        roomId: attempt.roomId,
        roomAttemptId: attempt.roomAttemptId,
        transportEpoch: attempt.transportEpoch,
        role: attempt.role,
        opponentUid: attempt.opponentUid,
      } : {}),
      ...(attempt.state === "terminal"
        ? { terminalReason: attempt.terminalReason }
        : {}),
    };
  }

  function ownedAttempt(root, uid, data) {
    const attempt = normalizeTrainingAttempt(uid, objectValue(root)[uid]);
    if (!attempt) return { outcome: "not-started", attempt: null };
    if (attempt.runId !== data.runId
        || attempt.endpointId !== data.endpointId
        || attempt.ownerEpoch !== data.ownerEpoch) {
      return { outcome: "owner-replaced", attempt };
    }
    return { outcome: attempt.state, attempt };
  }

  function pairFromRoot(root, attempt) {
    const peer = attempt
      ? normalizeTrainingAttempt(attempt.opponentUid, objectValue(root)[attempt.opponentUid])
      : null;
    if (!reciprocalReservation(attempt, peer)) return null;
    return attempt.role === "host"
      ? { host: attempt, guest: peer }
      : { host: peer, guest: attempt };
  }

  function verifiedFrameId(attempt, economy) {
    const requested = attempt?.preparation?.chatFrameId || "";
    return requested
      && CHAT_FRAME_IDS.has(requested)
      && economy?.inventory?.[requested] === true
      && economy?.equipped?.chatFrame === requested
      ? requested
      : "";
  }

  async function verifiedChatFrames(host, guest) {
    try {
      const [hostEconomy, guestEconomy] = await Promise.all([
        economyRef(host.uid).get(),
        economyRef(guest.uid).get(),
      ]);
      return {
        [host.uid]: verifiedFrameId(host, hostEconomy.val()),
        [guest.uid]: verifiedFrameId(guest, guestEconomy.val()),
      };
    } catch (error) {
      console.warn("training V5 chat frame verification failed; using standard frames", {
        error: String(error?.message || error),
      });
      return { [host.uid]: "", [guest.uid]: "" };
    }
  }

  async function drainPendingRoomCleanup(uid) {
    const before = normalizeTrainingAttempt(
      uid,
      (await attemptRef(uid).get()).val(),
    );
    const cleanup = normalizePendingRoomCleanup(before?.pendingRoomCleanup);
    if (!cleanup) return { drained: true, attempt: before };
    const timestamp = currentTime();
    const result = await roomRef(cleanup.roomId).transaction((current) => {
      if (current == null) {
        if (cleanup.reason === "room-ended") {
          // The room was already authoritatively absent. Keep it absent;
          // recreating a destroyed fence would turn cleanup metadata back into
          // a room and could confuse later lifecycle checks.
          return null;
        }
        // applyLocally=false prevents this synthetic fence from leaking into
        // concurrent calls before the server accepts it. If the server room
        // exists, Firebase retries with that canonical value.
        return buildDestroyedTrainingRoomFence(cleanup, timestamp);
      }
      if (!roomMatchesCleanupDescriptor(current, cleanup)) {
        // Commit the unchanged value. Returning undefined would abort against
        // the local cache and would not confirm that this is the server value.
        return current;
      }
      if (current.destroyed || current.serverFinalized) return current;
      return {
        ...current,
        destroyed: {
          at: timestamp,
          byUid: cleanup.uid,
          reason: cleanup.reason,
        },
      };
    }, undefined, false);
    const settledRoom = result.snapshot.val();
    const roomSettled = settledRoom == null
      || !roomMatchesCleanupDescriptor(settledRoom, cleanup)
      || Boolean(settledRoom.destroyed || settledRoom.serverFinalized);
    if (!result.committed || !roomSettled) {
      throw new Error("training V5 room cleanup did not settle");
    }
    await attemptRef(uid).transaction((current) => {
      const attempt = normalizeTrainingAttempt(uid, current);
      if (!attempt?.pendingRoomCleanup
          || !pendingRoomCleanupMatches(attempt.pendingRoomCleanup, cleanup)) {
        return undefined;
      }
      const next = { ...attempt };
      delete next.pendingRoomCleanup;
      next.revision += 1;
      next.updatedAt = currentTime();
      return next;
    }, undefined, false);
    const after = normalizeTrainingAttempt(
      uid,
      (await attemptRef(uid).get()).val(),
    );
    return {
      drained: !after?.pendingRoomCleanup,
      attempt: after,
    };
  }

  function activeResponse(attempt, outcome = "active") {
    return { outcome, ...attemptView(attempt) };
  }

  function ownedResponse(owned, reason = "") {
    if (owned.outcome === "terminal") {
      return { outcome: "terminal", ...attemptView(owned.attempt) };
    }
    if (owned.outcome === "waiting") {
      return {
        outcome: "waiting",
        ...(reason ? { reason } : {}),
        stale: owned.attempt.queueExpiresAt <= currentTime(),
        ...attemptView(owned.attempt),
      };
    }
    if (["reserved", "active"].includes(owned.outcome)) {
      return {
        outcome: "waiting",
        reason: reason || "recovering",
        ...attemptView(owned.attempt),
      };
    }
    return { outcome: owned.outcome };
  }

  async function latestOwned(uid, data) {
    const root = objectValue((await attemptsRef().get()).val());
    return ownedAttempt(root, uid, data);
  }

  async function confirmCanonicalPair(uid, data, expectedOwned, expectedPair) {
    const root = objectValue((await attemptsRef().get()).val());
    const owned = ownedAttempt(root, uid, data);
    const pair = ["reserved", "active"].includes(owned.outcome)
      ? pairFromRoot(root, owned.attempt)
      : null;
    const matches = Boolean(
      pair
      && reservationFenceMatches(owned.attempt, expectedOwned)
      && reservationFenceMatches(pair.host, expectedPair.host)
      && reservationFenceMatches(pair.guest, expectedPair.guest),
    );
    return { matches, owned, pair };
  }

  async function convergeOwned(
    uid,
    data,
    expected,
    {
      terminalReason = "room-ended",
      cleanupReason = terminalReason,
      forceTerminal = false,
    } = {},
  ) {
    let decision = null;
    await attemptsRef().transaction((current) => {
      if (current == null) return null;
      decision = convergeReservationDecision({
        attempts: objectValue(current),
        uid,
        expected,
        now: currentTime(),
        terminalReason,
        cleanupReason,
        forceTerminal,
      });
      return decision.changed ? decision.attempts : undefined;
    }, undefined, false);
    if (decision?.changed) await drainPendingRoomCleanup(uid);
    return latestOwned(uid, data);
  }

  function activeRoomMatchesPair(room, first, second) {
    return Boolean(
      reciprocalReservation(first, second)
      && first.state === "active"
      && second.state === "active"
      && !first.pendingRoomCleanup
      && !second.pendingRoomCleanup
      && roomMatchesAttempt(room, first)
      && roomMatchesAttempt(room, second)
      && !room?.destroyed
      && !room?.serverFinalized
      && room?.status === "active"
      && room.accepted?.[room.hostUid] === true
      && room.accepted?.[room.guestUid] === true,
    );
  }

  function activeRoomIsWithinStartPresenceGrace(room, timestamp) {
    const activatedAt = Number(room?.activatedAt || room?.createdAt || 0);
    return Number.isSafeInteger(activatedAt)
      && activatedAt > timestamp - ACTIVE_START_PRESENCE_GRACE_MS
      && activatedAt <= timestamp + 15_000;
  }

  function activePairHasFreshPresence(room, first, second, timestamp) {
    return [first, second].some((attempt) => (
      trainingPresenceV5IsFreshOnline(
        room,
        attempt,
        timestamp,
        ACTIVE_PRESENCE_FRESH_MS,
      )
    ));
  }

  function activePairHasRecentTransportHandoff(room, first, second, timestamp) {
    return [first, second].some((attempt) => {
      const presence = room?.presenceV5?.[attempt?.uid]?.[attempt?.runId];
      return presence?.protocolVersion === 5
        && presence.runId === attempt?.runId
        && presence.endpointId === attempt?.endpointId
        && presence.ownerEpoch === attempt?.ownerEpoch
        && presence.roomAttemptId === attempt?.roomAttemptId
        && Number.isSafeInteger(presence.updatedAt)
        && presence.updatedAt
          > timestamp - ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS
        && presence.updatedAt <= timestamp + 15_000;
    });
  }

  function activeReservationIdentityMatches(current, observed) {
    // transportEpoch is deliberately excluded: reconnect rotates it inside
    // the same immutable run/owner/room attempt. Once the room CAS has
    // authoritatively destroyed that attempt, a concurrent epoch rotation
    // must converge with the destroyed room instead of leaving active
    // attempts behind.
    if (!current || !observed) return current == null && observed == null;
    return [
        "protocolVersion",
        "signalingVersion",
        "uid",
        "runId",
        "endpointId",
        "ownerEpoch",
        "state",
        "roomId",
        "roomAttemptId",
        "role",
        "opponentUid",
    ].every((key) => current[key] === observed[key]);
  }

  function activeRoomHasRecoverableTransportGap(room, first, second) {
    return Boolean(
      reciprocalReservation(first, second)
      && first.state === "active"
      && second.state === "active"
      && !first.pendingRoomCleanup
      && !second.pendingRoomCleanup
      && roomMatchesAttemptIdentity(room, first)
      && roomMatchesAttemptIdentity(room, second)
      && room?.transportEpoch !== first.transportEpoch
      && !room.destroyed
      && !room.serverFinalized
      && room.status === "active"
      && room.accepted?.[room.hostUid] === true
      && room.accepted?.[room.guestUid] === true,
    );
  }

  function activeStartConvergenceReason(room, attempt, peer, timestamp) {
    if (!reciprocalReservation(attempt, peer)
        || attempt?.state !== "active"
        || peer?.state !== "active"
        || attempt.pendingRoomCleanup
        || peer.pendingRoomCleanup) {
      return "pair-broken";
    }
    if (room?.destroyed?.reason === "active_abandoned") {
      return "active_abandoned";
    }
    if (room == null || room.destroyed || room.serverFinalized) {
      return "room-ended";
    }
    if (activeRoomHasRecoverableTransportGap(room, attempt, peer)
        && (activeRoomIsWithinStartPresenceGrace(room, timestamp)
          || activePairHasRecentTransportHandoff(
            room,
            attempt,
            peer,
            timestamp,
          ))) {
      return "";
    }
    if (!roomMatchesAttempt(room, attempt)
        || !roomMatchesAttempt(room, peer)) {
      return "room-mismatch";
    }
    if (room.status !== "active"
        || room.accepted?.[room.hostUid] !== true
        || room.accepted?.[room.guestUid] !== true) {
      return "room-ended";
    }
    return "";
  }

  async function releaseAbandonedActiveForStart(uid, data) {
    const timestamp = currentTime();
    const observedRoot = objectValue((await attemptsRef().get()).val());
    const observed = normalizeTrainingAttempt(uid, observedRoot[uid]);
    if (observed?.state !== "active"
        || (observed.runId === data.runId
          && observed.endpointId === data.endpointId)) {
      return false;
    }
    const observedPeer = normalizeTrainingAttempt(
      observed.opponentUid,
      observedRoot[observed.opponentUid],
    );
    const observedPairIsActive = reciprocalReservation(observed, observedPeer)
      && observedPeer.state === "active"
      && !observed.pendingRoomCleanup
      && !observedPeer.pendingRoomCleanup;
    const roomResult = await roomRef(observed.roomId).transaction((current) => {
      if (current == null) {
        // Confirm canonical absence instead of aborting against an Admin SDK
        // cold-cache null. A server room makes Firebase retry this callback.
        return null;
      }
      if (!observedPairIsActive
          || !activeRoomMatchesPair(current, observed, observedPeer)
          || activeRoomIsWithinStartPresenceGrace(current, timestamp)
          || activePairHasFreshPresence(
            current,
            observed,
            observedPeer,
            timestamp,
          )
          || activePairHasRecentTransportHandoff(
            current,
            observed,
            observedPeer,
            timestamp,
          )) {
        // Commit unchanged so the returned snapshot reflects the server CAS.
        return current;
      }
      return {
        ...current,
        destroyed: {
          at: timestamp,
          byUid: uid,
          reason: "active_abandoned",
        },
      };
    }, undefined, false);
    if (!roomResult.committed) return false;
    const settledRoom = roomResult.snapshot.val();
    let convergence = null;
    const result = await attemptsRef().transaction((current) => {
      convergence = null;
      if (current == null) return undefined;
      const currentRoot = objectValue(current);
      const currentAttempt = normalizeTrainingAttempt(uid, currentRoot[uid]);
      const currentPeer = currentAttempt
        ? normalizeTrainingAttempt(
          currentAttempt.opponentUid,
          currentRoot[currentAttempt.opponentUid],
        )
        : null;
      if (currentAttempt?.state !== "active"
          || (currentAttempt.runId === data.runId
            && currentAttempt.endpointId === data.endpointId)
          || !activeReservationIdentityMatches(currentAttempt, observed)
          || !activeReservationIdentityMatches(currentPeer, observedPeer)) {
        return undefined;
      }
      const terminalReason = activeStartConvergenceReason(
        settledRoom,
        currentAttempt,
        currentPeer,
        timestamp,
      );
      if (!terminalReason) return undefined;
      convergence = convergeReservationDecision({
        attempts: currentRoot,
        uid,
        expected: currentAttempt,
        now: timestamp,
        terminalReason,
        cleanupReason: terminalReason,
        forceTerminal: true,
      });
      return convergence.changed ? convergence.attempts : undefined;
    }, undefined, false);
    if (!result.committed || !convergence?.changed) return false;
    await drainPendingRoomCleanup(uid);
    return true;
  }

  async function materializeOwned(uid, data) {
    await drainPendingRoomCleanup(uid);
    let root = objectValue((await attemptsRef().get()).val());
    let owned = ownedAttempt(root, uid, data);
    if (!["reserved", "active"].includes(owned.outcome)) {
      return ownedResponse(owned);
    }
    let pair = pairFromRoot(root, owned.attempt);
    if (!pair || pair.host.pendingRoomCleanup || pair.guest.pendingRoomCleanup) {
      const converged = await convergeOwned(uid, data, owned.attempt, {
        terminalReason: "pair-broken",
        cleanupReason: "pair-broken",
        forceTerminal: owned.attempt.state === "active",
      });
      return ownedResponse(converged, "recovering");
    }
    if (pair.host.state === "reserved" || pair.guest.state === "reserved") {
      let staleReservation = false;
      let staleConvergence = null;
      const confirmation = await attemptsRef().transaction((current) => {
        staleReservation = false;
        staleConvergence = null;
        if (current == null) return undefined;
        const currentRoot = objectValue(current);
        const currentOwned = ownedAttempt(currentRoot, uid, data);
        if (!["reserved", "active"].includes(currentOwned.outcome)) return undefined;
        const currentPair = pairFromRoot(currentRoot, currentOwned.attempt);
        if (!currentPair
            || currentPair.host.pendingRoomCleanup
            || currentPair.guest.pendingRoomCleanup) {
          return undefined;
        }
        staleReservation = [currentPair.host, currentPair.guest].some(
          (attempt) => attempt.state === "reserved"
            && !attemptIsQueueFresh(attempt, currentTime()),
        );
        if (!staleReservation) {
          // Committing the unchanged root makes Firebase retry this confirmation
          // if either reservation changes before the transaction is accepted.
          return currentRoot;
        }
        staleConvergence = convergeReservationDecision({
          attempts: currentRoot,
          uid,
          expected: currentOwned.attempt,
          now: currentTime(),
          terminalReason: "reservation-stale",
          cleanupReason: "reservation-stale",
        });
        return staleConvergence.changed ? staleConvergence.attempts : undefined;
      }, undefined, false);
      if (confirmation.committed && staleReservation && staleConvergence?.changed) {
        await drainPendingRoomCleanup(uid);
        return ownedResponse(await latestOwned(uid, data), "recovering");
      }
      root = confirmation.committed
        ? objectValue(confirmation.snapshot.val())
        : objectValue((await attemptsRef().get()).val());
      owned = ownedAttempt(root, uid, data);
      if (!["reserved", "active"].includes(owned.outcome)) {
        return ownedResponse(owned);
      }
      pair = pairFromRoot(root, owned.attempt);
      if (!pair || pair.host.pendingRoomCleanup || pair.guest.pendingRoomCleanup) {
        const converged = await convergeOwned(uid, data, owned.attempt, {
          terminalReason: "pair-broken",
          cleanupReason: "pair-broken",
          forceTerminal: owned.attempt.state === "active",
        });
        return ownedResponse(converged, "recovering");
      }
    }
    const chatFrames = await verifiedChatFrames(pair.host, pair.guest);
    const room = buildActiveTrainingRoom({
      host: pair.host,
      guest: pair.guest,
      chatFrames,
      now: currentTime(),
    });
    const roomResult = await roomRef(owned.attempt.roomId).transaction((current) => {
      if (current == null) {
        if (pair.host.state !== "reserved" || pair.guest.state !== "reserved") {
          // Admin RTDB can invoke a transaction once with a cold-cache null
          // even when the server room exists. Returning null lets Firebase
          // compare with the server and retry; undefined would abort locally.
          return null;
        }
        return room;
      }
      // Commit the unchanged room so the returned snapshot reflects the
      // server comparison. An undefined return would classify only the
      // speculative shared Repo cache, which can temporarily contain null or
      // a value from another in-flight transaction.
      return current;
    }, undefined, false);
    const settledRoom = roomResult.snapshot.val();
    if (settledRoom == null) {
      if (!roomResult.committed) {
        return ownedResponse(await latestOwned(uid, data), "recovering");
      }
      const confirmed = await confirmCanonicalPair(uid, data, owned.attempt, pair);
      if (!confirmed.matches
          || confirmed.pair.host.state !== "active"
          || confirmed.pair.guest.state !== "active") {
        return ownedResponse(confirmed.owned, "recovering");
      }
      const converged = await convergeOwned(uid, data, confirmed.owned.attempt, {
        terminalReason: "room-ended",
        cleanupReason: "room-ended",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    const roomIdentityMatches = roomMatchesAttemptIdentity(settledRoom, pair.host)
      && roomMatchesAttemptIdentity(settledRoom, pair.guest);
    if (!roomIdentityMatches) {
      const converged = await convergeOwned(uid, data, owned.attempt, {
        terminalReason: "room-mismatch",
        cleanupReason: "room-mismatch",
        forceTerminal: pair.host.state === "active" || pair.guest.state === "active",
      });
      return ownedResponse(converged, "recovering");
    }
    if (settledRoom.destroyed || settledRoom.serverFinalized) {
      const converged = await convergeOwned(uid, data, owned.attempt, {
        terminalReason: "room-ended",
        cleanupReason: "room-ended",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    const roomReady = settledRoom.status === "active"
      && settledRoom.accepted?.[settledRoom.hostUid] === true
      && settledRoom.accepted?.[settledRoom.guestUid] === true
      && settledRoom.rounds?.[1]?.createdAt != null;
    if (!roomReady) {
      return ownedResponse(await latestOwned(uid, data), "recovering");
    }
    if (settledRoom.transportEpoch !== pair.host.transportEpoch
        && pair.host.state === "active"
        && pair.guest.state === "active") {
      return settleReconnectRoom(uid, data);
    }
    if (settledRoom.transportEpoch !== pair.host.transportEpoch) {
      return ownedResponse(await latestOwned(uid, data), "recovering");
    }
    let activation = null;
    const activated = await attemptsRef().transaction((current) => {
      if (current == null) return null;
      activation = activateMatchDecision({
        attempts: objectValue(current),
        uid,
        roomAttemptId: owned.attempt.roomAttemptId,
        now: currentTime(),
      });
      return activation.activated || activation.changed
        ? activation.attempts
        : undefined;
    }, undefined, false);
    if (activation?.changed && !activation.activated) {
      await drainPendingRoomCleanup(uid);
      return ownedResponse(await latestOwned(uid, data), "recovering");
    }
    if (!activation?.activated) {
      const latest = await latestOwned(uid, data);
      const converged = ["reserved", "active"].includes(latest.outcome)
        ? await convergeOwned(uid, data, latest.attempt, {
          terminalReason: "reservation-lost",
          cleanupReason: "reservation-lost",
          forceTerminal: latest.attempt.state === "active",
        })
        : latest;
      return ownedResponse(converged, "recovering");
    }
    const latest = normalizeTrainingAttempt(uid, objectValue(activated.snapshot.val())[uid]);
    return activeResponse(latest);
  }

  async function start(uid, data) {
    await drainPendingRoomCleanup(uid);
    await releaseAbandonedActiveForStart(uid, data);
    const generatedOwnerEpoch = token();
    let decision = null;
    const result = await attemptsRef().transaction((current) => {
      decision = startAttemptDecision({
        attempts: objectValue(current),
        uid,
        runId: data.runId,
        endpointId: data.endpointId,
        ownerEpoch: generatedOwnerEpoch,
        preparation: data.preparation,
        now: currentTime(),
      });
      return decision.allowed ? decision.attempts : undefined;
    }, undefined, false);
    if (!result.committed || !decision?.allowed) {
      return { started: false, reason: decision?.reason || "owner-replaced" };
    }
    await drainPendingRoomCleanup(uid);
    const latest = await latestOwned(uid, {
      runId: data.runId,
      endpointId: data.endpointId,
      ownerEpoch: decision.attempt.ownerEpoch,
    });
    const response = ["reserved", "active"].includes(latest.outcome)
      ? await materializeOwned(uid, {
        runId: data.runId,
        endpointId: data.endpointId,
        ownerEpoch: decision.attempt.ownerEpoch,
      })
      : ownedResponse(latest);
    return {
      started: true,
      reason: decision.reason,
      ...response,
    };
  }

  async function heartbeat(uid, data) {
    await drainPendingRoomCleanup(uid);
    let decision = null;
    const result = await attemptRef(uid).transaction((current) => {
      if (current == null) {
        decision = { allowed: false, reason: "not-started", attempt: null };
        return null;
      }
      decision = heartbeatAttemptDecision({
        current,
        uid,
        ...data,
        now: currentTime(),
      });
      return decision.allowed ? decision.attempt : undefined;
    }, undefined, false);
    if (!result.committed || !decision?.allowed) {
      return {
        owned: false,
        reason: decision?.reason || "owner-replaced",
        ...(decision?.reason === "terminal" ? attemptView(decision.attempt) : {}),
      };
    }
    if (["reserved", "active"].includes(decision.attempt.state)) {
      const canonical = await materializeOwned(uid, data);
      return {
        owned: true,
        reason: decision.reason,
        ...canonical,
      };
    }
    return {
      owned: true,
      reason: decision.reason,
      ...attemptView(decision.attempt),
    };
  }

  async function match(uid, data) {
    await drainPendingRoomCleanup(uid);
    const pushed = realtime.ref(PATHS.rooms).push();
    const roomId = String(pushed?.key || "");
    let decision = null;
    const result = await attemptsRef().transaction((current) => {
      if (current == null) {
        decision = { outcome: "not-started", attempts: {} };
        return null;
      }
      decision = reserveMatchDecision({
        attempts: objectValue(current),
        uid,
        ...data,
        roomId,
        roomAttemptId: token(),
        transportEpoch: token(),
        now: currentTime(),
      });
      return decision.outcome === "reserved" ? decision.attempts : undefined;
    }, undefined, false);
    const outcome = decision?.outcome || "not-started";
    if (result.committed && outcome === "reserved") return materializeOwned(uid, data);
    if (["reserved", "active"].includes(outcome)) return materializeOwned(uid, data);
    if (outcome === "waiting" || outcome === "stale") {
      return { outcome: "waiting", stale: outcome === "stale", ...attemptView(decision.attempt) };
    }
    if (outcome === "recovering") {
      return { outcome: "waiting", reason: "recovering", ...attemptView(decision.attempt) };
    }
    if (outcome === "terminal") {
      return { outcome: "terminal", ...attemptView(decision.attempt) };
    }
    return { outcome };
  }

  async function inspect(uid, data) {
    await drainPendingRoomCleanup(uid);
    const attempt = normalizeTrainingAttempt(uid, (await attemptRef(uid).get()).val());
    if (!attempt) return { outcome: "not-started" };
    if (attempt.runId !== data.runId
        || attempt.endpointId !== data.endpointId
        || attempt.ownerEpoch !== data.ownerEpoch) {
      return { outcome: "owner-replaced" };
    }
    if (["reserved", "active"].includes(attempt.state)) {
      return materializeOwned(uid, data);
    }
    return {
      outcome: attempt.state === "terminal" ? "terminal" : "waiting",
      stale: attempt.state === "waiting" && attempt.queueExpiresAt <= currentTime(),
      ...attemptView(attempt),
    };
  }

  async function settleReconnectRoom(uid, data, maximumAttempts = 4) {
    for (let index = 0; index < maximumAttempts; index += 1) {
      const root = objectValue((await attemptsRef().get()).val());
      const owned = ownedAttempt(root, uid, data);
      if (owned.outcome !== "active") return ownedResponse(owned, "recovering");
      const pair = pairFromRoot(root, owned.attempt);
      if (!pair
          || pair.host.state !== "active"
          || pair.guest.state !== "active") {
        const converged = await convergeOwned(uid, data, owned.attempt, {
          terminalReason: "pair-broken",
          cleanupReason: "pair-broken",
          forceTerminal: true,
        });
        return ownedResponse(converged, "recovering");
      }
      const observedRoom = (await roomRef(owned.attempt.roomId).get()).val();
      const confirmationRoot = objectValue((await attemptsRef().get()).val());
      const confirmedOwned = ownedAttempt(confirmationRoot, uid, data);
      const confirmedPair = confirmedOwned.outcome === "active"
        ? pairFromRoot(confirmationRoot, confirmedOwned.attempt)
        : null;
      const sameCanonicalPair = confirmedPair
        && reservationFenceMatches(confirmedOwned.attempt, owned.attempt)
        && reservationFenceMatches(confirmedPair.host, pair.host)
        && reservationFenceMatches(confirmedPair.guest, pair.guest);
      if (!sameCanonicalPair) continue;
      const observedTransportEpoch = observedRoom?.transportEpoch;
      const roomResult = await roomRef(owned.attempt.roomId).transaction((current) => {
        if (current == null) {
          // Do not abort locally. Returning null makes Firebase compare this
          // speculative cache value with the server and retry the callback
          // when the active room still exists.
          return null;
        }
        if (current.destroyed
            || current.serverFinalized
            || !roomMatchesAttemptIdentity(current, pair.host)
            || !roomMatchesAttemptIdentity(current, pair.guest)
            || current.transportEpoch === owned.attempt.transportEpoch) {
          // Commit unchanged so result.snapshot is based on the server CAS,
          // not only on the shared Admin SDK Repo cache.
          return current;
        }
        if (observedRoom == null
            || current.transportEpoch !== observedTransportEpoch) {
          // A null observation has no epoch fence, or a newer reconnect won
          // the room CAS. Confirm unchanged and follow the canonical winner.
          return current;
        }
        return {
          ...current,
          transportEpoch: owned.attempt.transportEpoch,
        };
      }, undefined, false);
      const settledRoom = roomResult.snapshot.val();
      if (!roomResult.committed) continue;
      if (settledRoom == null) {
        const confirmed = await confirmCanonicalPair(
          uid,
          data,
          confirmedOwned.attempt,
          confirmedPair,
        );
        if (!confirmed.matches
            || confirmed.pair.host.state !== "active"
            || confirmed.pair.guest.state !== "active") {
          continue;
        }
        const converged = await convergeOwned(uid, data, confirmed.owned.attempt, {
          terminalReason: "room-ended",
          cleanupReason: "room-ended",
          forceTerminal: true,
        });
        return ownedResponse(converged, "recovering");
      }
      if (settledRoom.destroyed || settledRoom.serverFinalized) {
        const converged = await convergeOwned(
          uid,
          data,
          confirmedOwned.attempt,
          {
            terminalReason: "room-ended",
            cleanupReason: "room-ended",
            forceTerminal: true,
          },
        );
        return ownedResponse(converged, "recovering");
      }
      if (!roomMatchesAttemptIdentity(settledRoom, confirmedPair.host)
          || !roomMatchesAttemptIdentity(settledRoom, confirmedPair.guest)) {
        const converged = await convergeOwned(
          uid,
          data,
          confirmedOwned.attempt,
          {
            terminalReason: "room-mismatch",
            cleanupReason: "room-mismatch",
            forceTerminal: true,
          },
        );
        return ownedResponse(converged, "recovering");
      }
      if (settledRoom.transportEpoch === confirmedOwned.attempt.transportEpoch) {
        return activeResponse(confirmedOwned.attempt);
      }
    }
    return ownedResponse(await latestOwned(uid, data), "recovering");
  }

  async function reconnect(uid, data) {
    await drainPendingRoomCleanup(uid);
    const initialRoot = objectValue((await attemptsRef().get()).val());
    const initialOwned = ownedAttempt(initialRoot, uid, data);
    if (initialOwned.outcome === "terminal") {
      return { outcome: "terminal", ...attemptView(initialOwned.attempt) };
    }
    if (initialOwned.outcome !== "active") return { outcome: initialOwned.outcome };
    if (initialOwned.attempt.roomAttemptId !== data.roomAttemptId) {
      return { outcome: "room-replaced", ...attemptView(initialOwned.attempt) };
    }
    const initialPair = pairFromRoot(initialRoot, initialOwned.attempt);
    if (!initialPair
        || initialPair.host.state !== "active"
        || initialPair.guest.state !== "active") {
      const converged = await convergeOwned(uid, data, initialOwned.attempt, {
        terminalReason: "pair-broken",
        cleanupReason: "pair-broken",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    const initialRoomResult = await roomRef(initialOwned.attempt.roomId)
      .transaction(
        (current) => (current == null ? null : current),
        undefined,
        false,
      );
    const initialRoom = initialRoomResult.snapshot.val();
    if (!initialRoomResult.committed) {
      return ownedResponse(initialOwned, "recovering");
    }
    if (initialRoom == null) {
      // The transaction snapshot is authoritative only after its server CAS.
      // Re-check the exact attempt pair before ending a genuinely missing room;
      // a concurrent reconnect may have advanced the canonical fence meanwhile.
      const confirmed = await confirmCanonicalPair(
        uid,
        data,
        initialOwned.attempt,
        initialPair,
      );
      if (!confirmed.matches
          || confirmed.pair.host.state !== "active"
          || confirmed.pair.guest.state !== "active") {
        return ownedResponse(confirmed.owned, "recovering");
      }
      const converged = await convergeOwned(uid, data, confirmed.owned.attempt, {
        terminalReason: "room-ended",
        cleanupReason: "room-ended",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    const roomHasPairIdentity = roomMatchesAttemptIdentity(
      initialRoom,
      initialPair.host,
    ) && roomMatchesAttemptIdentity(initialRoom, initialPair.guest);
    if (initialRoom.destroyed || initialRoom.serverFinalized) {
      const converged = await convergeOwned(uid, data, initialOwned.attempt, {
        terminalReason: "room-ended",
        cleanupReason: "room-ended",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    if (!roomHasPairIdentity) {
      const converged = await convergeOwned(uid, data, initialOwned.attempt, {
        terminalReason: "room-mismatch",
        cleanupReason: "room-mismatch",
        forceTerminal: true,
      });
      return ownedResponse(converged, "recovering");
    }
    const rotate = initialRoom.transportEpoch === initialOwned.attempt.transportEpoch;
    const nextTransportEpoch = token();
    let decision = null;
    await attemptsRef().transaction((current) => {
      if (current == null) return null;
      decision = reconnectAttemptDecision({
        attempts: objectValue(current),
        uid,
        ...data,
        nextTransportEpoch,
        rotate,
        now: currentTime(),
      });
      return decision.rotated ? decision.attempts : undefined;
    }, undefined, false);
    if (decision?.outcome !== "active") {
      if (decision?.outcome === "recovering" && decision.attempt) {
        const converged = await convergeOwned(uid, data, decision.attempt, {
          terminalReason: "pair-broken",
          cleanupReason: "pair-broken",
          forceTerminal: true,
        });
        return ownedResponse(converged, "recovering");
      }
      return {
        outcome: decision?.outcome || "owner-replaced",
        ...attemptView(decision?.attempt),
      };
    }
    return settleReconnectRoom(uid, data);
  }

  async function cancel(uid, data) {
    let decision = null;
    const result = await attemptsRef().transaction((current) => {
      if (current == null) {
        decision = { cancelled: false, reason: "not-started", attempts: {} };
        return null;
      }
      decision = cancelAttemptDecision({
        attempts: objectValue(current),
        uid,
        ...data,
        now: currentTime(),
      });
      return decision.cancelled ? decision.attempts : undefined;
    }, undefined, false);
    if (!decision?.cancelled || (!result.committed && decision.attempt?.state !== "terminal")) {
      return { cancelled: false, reason: decision?.reason || "owner-replaced" };
    }
    await drainPendingRoomCleanup(uid);
    const latest = await latestOwned(uid, data);
    return {
      cancelled: true,
      reason: decision.reason,
      ...attemptView(latest.attempt || decision.attempt),
    };
  }

  async function liveRoom(uidValue, timestamp = currentTime()) {
    const uid = normalizeUid(uidValue);
    if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) <= 0) {
      throw new TypeError("training V5 live-room time is invalid");
    }
    const root = objectValue((await attemptsRef().get()).val());
    const attempt = normalizeTrainingAttempt(uid, root[uid]);
    if (!attempt || attempt.state !== "active") return null;
    const pair = pairFromRoot(root, attempt);
    if (!pair
        || pair.host.state !== "active"
        || pair.guest.state !== "active") return null;
    const room = (await roomRef(attempt.roomId).get()).val();
    if (!roomMatchesAttempt(room, pair.host)
        || !roomMatchesAttempt(room, pair.guest)
        || room.destroyed
        || room.serverFinalized
        || room.status !== "active"
        || room.accepted?.[room.hostUid] !== true
        || room.accepted?.[room.guestUid] !== true) return null;
    return {
      roomId: attempt.roomId,
      room,
      attempt,
      role: attempt.role,
      roomAttemptId: attempt.roomAttemptId,
      transportEpoch: attempt.transportEpoch,
    };
  }

  async function dispatch(uidValue, input) {
    const uid = normalizeUid(uidValue);
    const data = requireActionData(input);
    await consumeRate(uid, data.action);
    if (data.action === "start") return start(uid, data);
    if (data.action === "heartbeat") return heartbeat(uid, data);
    if (data.action === "match") return match(uid, data);
    if (data.action === "inspect") return inspect(uid, data);
    if (data.action === "reconnect") return reconnect(uid, data);
    if (data.action === "cancel") return cancel(uid, data);
    throw new HttpsError("invalid-argument", "未対応の鍛え合いセッション操作です。");
  }

  return Object.freeze({
    PATHS,
    cancel: (uid, data) => dispatch(uid, { ...data, action: "cancel" }),
    dispatch,
    heartbeat: (uid, data) => dispatch(uid, { ...data, action: "heartbeat" }),
    inspect: (uid, data) => dispatch(uid, { ...data, action: "inspect" }),
    liveRoom,
    match: (uid, data) => dispatch(uid, { ...data, action: "match" }),
    reconnect: (uid, data) => dispatch(uid, { ...data, action: "reconnect" }),
    start: (uid, data) => dispatch(uid, { ...data, action: "start" }),
  });
}

module.exports = Object.freeze({
  ACTIVE_START_PRESENCE_GRACE_MS,
  ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS,
  ACTION_RATE_POLICIES,
  PATHS,
  createTrainingSessionV5Service,
});
