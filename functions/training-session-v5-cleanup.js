"use strict";

const { isDeepStrictEqual } = require("node:util");
const {
  buildDestroyedTrainingRoomFence,
  convergeReservationDecision,
  normalizePendingRoomCleanup,
  normalizeTrainingAttempt,
  pendingRoomCleanupFromAttempt,
  pendingRoomCleanupMatches,
  reciprocalReservation,
  reservationFenceMatches,
  roomMatchesAttemptIdentity,
  roomMatchesCleanupDescriptor,
} = require("./training-session-v5");

const TRAINING_ATTEMPTS_V5_PATH = "online/trainingAttemptsV5";
const TRAINING_ROOMS_PATH = "online/trainingRooms";
const TERMINAL_RETENTION_MS = 60 * 60 * 1000;
const ABANDONED_WAITING_GRACE_MS = 24 * 60 * 60 * 1000;
const ORPHANED_ROOM_GRACE_MS = 10 * 60 * 1000;
const ACTIVE_ORPHAN_GRACE_MS = 10 * 60 * 1000;
const ACTIVE_PRESENCE_FRESH_MS = 60 * 1000;
const PRESENCE_FUTURE_SKEW_MS = 15 * 1000;

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function attemptIdentityMatches(current, candidate) {
  return current?.protocolVersion === 5
    && current?.uid === candidate?.uid
    && current?.runId === candidate?.runId
    && current?.endpointId === candidate?.endpointId
    && current?.ownerEpoch === candidate?.ownerEpoch
    && current?.revision === candidate?.revision;
}

function roomMatchesAttempt(room, attempt) {
  return roomMatchesAttemptIdentity(room, attempt)
    && objectValue(room).transportEpoch === attempt?.transportEpoch;
}

function trainingPresenceV5IsFreshOnline(
  room,
  attempt,
  now,
  freshMs = ACTIVE_PRESENCE_FRESH_MS,
) {
  const presence = objectValue(room)
    .presenceV5?.[attempt?.uid]?.[attempt?.runId];
  return presence?.protocolVersion === 5
    && presence.runId === attempt?.runId
    && presence.endpointId === attempt?.endpointId
    && presence.ownerEpoch === attempt?.ownerEpoch
    && presence.roomAttemptId === attempt?.roomAttemptId
    && presence.transportEpoch === attempt?.transportEpoch
    && presence.online === true
    && Number.isSafeInteger(presence.updatedAt)
    && presence.updatedAt > now - freshMs
    && presence.updatedAt <= now + PRESENCE_FUTURE_SKEW_MS;
}

function activeParticipantIsAbandoned(
  room,
  attempt,
  now,
  {
    graceMs = ACTIVE_ORPHAN_GRACE_MS,
    presenceFreshMs = ACTIVE_PRESENCE_FRESH_MS,
  } = {},
) {
  const lastActivityAt = Math.max(
    Number(attempt?.lastSeen || 0),
    Number(attempt?.updatedAt || 0),
  );
  return attempt?.state === "active"
    && Number.isSafeInteger(lastActivityAt)
    && lastActivityAt <= now - graceMs
    && !trainingPresenceV5IsFreshOnline(
      room,
      attempt,
      now,
      presenceFreshMs,
    );
}

function terminalAttempt(attempt, now, reason) {
  const source = objectValue(attempt);
  const pendingRoomCleanup = pendingRoomCleanupFromAttempt(source, reason, now);
  const terminal = {
    ...source,
    revision: Number(source.revision || 0) + 1,
    state: "terminal",
    terminalReason: reason,
    updatedAt: now,
    lastSeen: now,
    queueExpiresAt: 0,
    ...(pendingRoomCleanup ? { pendingRoomCleanup } : {}),
  };
  for (const key of [
    "roomId",
    "roomAttemptId",
    "transportEpoch",
    "reservedAt",
    "role",
    "opponentUid",
  ]) {
    delete terminal[key];
  }
  return terminal;
}

async function drainPendingRoomCleanup({
  realtime,
  uid,
  attempt,
  now,
} = {}) {
  const cleanup = normalizePendingRoomCleanup(attempt?.pendingRoomCleanup);
  if (!cleanup) return { drained: true };
  let roomSettled = false;
  await realtime.ref(`${TRAINING_ROOMS_PATH}/${cleanup.roomId}`).transaction(
    (current) => {
      if (current == null) {
        roomSettled = true;
        return buildDestroyedTrainingRoomFence(cleanup, now);
      }
      if (!roomMatchesCleanupDescriptor(current, cleanup)) {
        roomSettled = true;
        return undefined;
      }
      roomSettled = true;
      if (current.destroyed || current.serverFinalized) return undefined;
      return {
        ...current,
        destroyed: {
          at: now,
          byUid: cleanup.uid,
          reason: cleanup.reason,
        },
      };
    },
  );
  if (!roomSettled) return { drained: false };
  let cleared = false;
  const result = await realtime.ref(
    `${TRAINING_ATTEMPTS_V5_PATH}/${uid}`,
  ).transaction((current) => {
    if (current == null) {
      cleared = true;
      return null;
    }
    if (!pendingRoomCleanupMatches(current.pendingRoomCleanup, cleanup)) {
      return undefined;
    }
    const next = { ...current };
    delete next.pendingRoomCleanup;
    next.revision = Number(next.revision || 0) + 1;
    next.updatedAt = now;
    cleared = true;
    return next;
  });
  return {
    drained: cleared && (result.committed || !result.snapshot.exists()),
  };
}

function createTrainingSessionV5Cleanup({
  realtime,
  terminalRetentionMs = TERMINAL_RETENTION_MS,
  abandonedWaitingGraceMs = ABANDONED_WAITING_GRACE_MS,
  orphanedRoomGraceMs = ORPHANED_ROOM_GRACE_MS,
  activeOrphanGraceMs = ACTIVE_ORPHAN_GRACE_MS,
  activePresenceFreshMs = ACTIVE_PRESENCE_FRESH_MS,
} = {}) {
  if (!realtime) throw new Error("realtime is required");
  return async function cleanupTrainingSessionV5(now = Date.now()) {
    const timestamp = Number(now);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new TypeError("Training V5 cleanup time is invalid");
    }
    const attemptsReference = realtime.ref(TRAINING_ATTEMPTS_V5_PATH);
    const attemptsSnapshot = await attemptsReference.get();
    const attemptsRoot = objectValue(attemptsSnapshot.val());
    const candidates = [];
    attemptsSnapshot.forEach((entry) => {
      candidates.push({ uid: entry.key, attempt: objectValue(entry.val()) });
    });
    const result = {
      examined: candidates.length,
      drained: 0,
      terminalized: 0,
      removed: 0,
      kept: 0,
      failures: 0,
    };
    const epochRecoveryRooms = new Set();
    for (const candidate of candidates) {
      try {
        const { uid, attempt } = candidate;
        const attemptReference = realtime.ref(`${TRAINING_ATTEMPTS_V5_PATH}/${uid}`);
        if (normalizePendingRoomCleanup(attempt.pendingRoomCleanup)) {
          const cleanup = await drainPendingRoomCleanup({
            realtime,
            uid,
            attempt,
            now: timestamp,
          });
          if (cleanup.drained) result.drained += 1;
          else result.failures += 1;
          result.kept += 1;
          continue;
        }
        if (attempt.state === "terminal") {
          if (Number(attempt.updatedAt || 0) > timestamp - terminalRetentionMs) {
            result.kept += 1;
            continue;
          }
          const transaction = await attemptReference.transaction((current) => (
            isDeepStrictEqual(current, attempt) ? null : undefined
          ));
          if (transaction.committed && !transaction.snapshot.exists()) result.removed += 1;
          else result.kept += 1;
          continue;
        }
        if (attempt.state === "waiting") {
          const abandonedAt = Number(attempt.queueExpiresAt || 0)
            + abandonedWaitingGraceMs;
          if (!abandonedAt || abandonedAt > timestamp) {
            result.kept += 1;
            continue;
          }
          const transaction = await attemptReference.transaction((current) => (
            attemptIdentityMatches(current, attempt)
              && current?.state === "waiting"
              && Number(current?.queueExpiresAt || 0) + abandonedWaitingGraceMs <= timestamp
              ? terminalAttempt(current, timestamp, "abandoned_waiting")
              : undefined
          ));
          if (transaction.committed && transaction.snapshot.exists()) result.terminalized += 1;
          else result.kept += 1;
          continue;
        }
        if (!["reserved", "active"].includes(attempt.state)
            || !attempt.roomId
            || !attempt.roomAttemptId
            || !attempt.transportEpoch) {
          result.kept += 1;
          continue;
        }
        if (epochRecoveryRooms.has(attempt.roomId)) {
          result.kept += 1;
          continue;
        }
        const normalizedAttempt = normalizeTrainingAttempt(uid, attempt);
        const peer = normalizedAttempt
          ? normalizeTrainingAttempt(
            normalizedAttempt.opponentUid,
            attemptsRoot[normalizedAttempt.opponentUid],
          )
          : null;
        const pairIsCanonical = reciprocalReservation(normalizedAttempt, peer);
        const roomSnapshot = await realtime.ref(
          `${TRAINING_ROOMS_PATH}/${attempt.roomId}`,
        ).get();
        const room = objectValue(roomSnapshot.val());
        const roomIdentityLive = roomSnapshot.exists()
          && pairIsCanonical
          && roomMatchesAttemptIdentity(room, normalizedAttempt)
          && roomMatchesAttemptIdentity(room, peer)
          && room.destroyed == null
          && room.serverFinalized == null;
        const recoverableEpochMismatch = roomIdentityLive
          && normalizedAttempt.state === "active"
          && peer.state === "active"
          && room.transportEpoch !== normalizedAttempt.transportEpoch;
        if (recoverableEpochMismatch) {
          // Both candidates came from the same initial attempts snapshot.
          // Once one side observes a reconnect gap, protect the whole room for
          // this cleanup pass so the peer entry cannot be orphaned immediately
          // after the room epoch is repaired.
          epochRecoveryRooms.add(attempt.roomId);
          let confirmedPair = null;
          const confirmation = await attemptsReference.transaction((current) => {
            confirmedPair = null;
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
                || currentPeer?.state !== "active"
                || !reciprocalReservation(currentAttempt, currentPeer)
                || !reservationFenceMatches(currentAttempt, normalizedAttempt)
                || !reservationFenceMatches(currentPeer, peer)) {
              return undefined;
            }
            confirmedPair = {
              attempt: currentAttempt,
              peer: currentPeer,
            };
            // Confirm both attempt fences in one server transaction before the
            // room CAS. A concurrent reconnect forces this callback to retry.
            return currentRoot;
          });
          if (confirmation.committed && confirmedPair) {
            const observedTransportEpoch = room.transportEpoch;
            const canonicalTransportEpoch = confirmedPair.attempt.transportEpoch;
            await realtime.ref(
              `${TRAINING_ROOMS_PATH}/${attempt.roomId}`,
            ).transaction((current) => {
              if (current == null
                  || current.destroyed
                  || current.serverFinalized
                  || !roomMatchesAttemptIdentity(current, confirmedPair.attempt)
                  || !roomMatchesAttemptIdentity(current, confirmedPair.peer)) {
                return undefined;
              }
              if (current.transportEpoch === canonicalTransportEpoch) {
                return undefined;
              }
              if (current.transportEpoch !== observedTransportEpoch) {
                // Another reconnect already won this room CAS.
                return undefined;
              }
              return {
                ...current,
                transportEpoch: canonicalTransportEpoch,
              };
            });
          }
          result.kept += 1;
          continue;
        }
        const roomLive = roomIdentityLive
          && room.transportEpoch === normalizedAttempt.transportEpoch;
        const activeParticipantAbandoned = roomLive
          && normalizedAttempt.state === "active"
          && peer.state === "active"
          && [normalizedAttempt, peer].some((participant) => (
            activeParticipantIsAbandoned(room, participant, timestamp, {
              graceMs: activeOrphanGraceMs,
              presenceFreshMs: activePresenceFreshMs,
            })
          ));
        if ((roomLive && !activeParticipantAbandoned)
            || Number(attempt.reservedAt || 0) > timestamp - orphanedRoomGraceMs) {
          result.kept += 1;
          continue;
        }
        let convergence = null;
        const transaction = await attemptsReference.transaction((current) => {
          if (current == null) return null;
          if (activeParticipantAbandoned) {
            const currentRoot = objectValue(current);
            const currentAttempt = normalizeTrainingAttempt(uid, currentRoot[uid]);
            const currentPeer = currentAttempt
              ? normalizeTrainingAttempt(
                currentAttempt.opponentUid,
                currentRoot[currentAttempt.opponentUid],
              )
              : null;
            const stillAbandoned = currentAttempt?.state === "active"
              && currentPeer?.state === "active"
              && reciprocalReservation(currentAttempt, currentPeer)
              && roomMatchesAttempt(room, currentAttempt)
              && roomMatchesAttempt(room, currentPeer)
              && [currentAttempt, currentPeer].some((participant) => (
                activeParticipantIsAbandoned(room, participant, timestamp, {
                  graceMs: activeOrphanGraceMs,
                  presenceFreshMs: activePresenceFreshMs,
                })
              ));
            if (!stillAbandoned) {
              convergence = null;
              return undefined;
            }
            convergence = convergeReservationDecision({
              attempts: currentRoot,
              uid,
              expected: currentAttempt,
              now: timestamp,
              terminalReason: "active_abandoned",
              cleanupReason: "active_abandoned",
              forceTerminal: true,
            });
            return convergence.changed ? convergence.attempts : undefined;
          }
          convergence = convergeReservationDecision({
            attempts: objectValue(current),
            uid,
            expected: attempt,
            now: timestamp,
            terminalReason: "room_ended",
            cleanupReason: "room_ended",
            forceTerminal: true,
          });
          return convergence.changed ? convergence.attempts : undefined;
        });
        if (transaction.committed && convergence?.changed) {
          result.terminalized += convergence.changedCount;
          if (activeParticipantAbandoned) {
            const cleanup = await drainPendingRoomCleanup({
              realtime,
              uid,
              attempt: convergence.attempt,
              now: timestamp,
            });
            if (cleanup.drained) result.drained += 1;
            else result.failures += 1;
          }
        }
        else result.kept += 1;
      } catch {
        result.failures += 1;
      }
    }
    return result;
  };
}

module.exports = Object.freeze({
  ACTIVE_ORPHAN_GRACE_MS,
  ACTIVE_PRESENCE_FRESH_MS,
  ABANDONED_WAITING_GRACE_MS,
  ORPHANED_ROOM_GRACE_MS,
  TERMINAL_RETENTION_MS,
  TRAINING_ATTEMPTS_V5_PATH,
  activeParticipantIsAbandoned,
  attemptIdentityMatches,
  createTrainingSessionV5Cleanup,
  drainPendingRoomCleanup,
  roomMatchesAttempt,
  terminalAttempt,
  trainingPresenceV5IsFreshOnline,
});
