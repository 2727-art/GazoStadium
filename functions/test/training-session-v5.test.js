"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const training = require("../training-session-v5");

const NOW = 1_900_000_000_000;
const HOST_UID = "v5-host";
const GUEST_UID = "v5-guest";
const HOST_RUN = "host-run-token-1234567890";
const HOST_ENDPOINT = "host-endpoint-token-12345";
const HOST_EPOCH = "host-owner-epoch-1234567";
const GUEST_RUN = "guest-run-token-123456789";
const GUEST_ENDPOINT = "guest-endpoint-token-1234";
const GUEST_EPOCH = "guest-owner-epoch-123456";
const ROOM_ID = "-0000000000000000001";
const ROOM_ATTEMPT = "room-attempt-token-123456";
const TRANSPORT = "transport-epoch-token-1234";

function preparation(name) {
  return {
    name,
    intensity: "standard",
    conditions: "",
    commandDeck: {
      1: {
        exercise: "スクワット",
        completion: "20回",
        command: "一定のテンポで続ける",
        beatsPerRep: 2,
      },
      2: {
        exercise: "腹筋",
        completion: "15回",
        command: "呼吸を止めずに続ける",
        beatsPerRep: 4,
      },
      3: {
        exercise: "腕立て伏せ",
        completion: "10回",
        command: "無理のないフォームで続ける",
        beatsPerRep: 8,
      },
    },
    imageBpms: { 1: 0, 2: 80, 3: 100, 4: 120, 5: 140 },
    chatFrameId: "",
  };
}

function start(attempts, uid, identity, timestamp = NOW) {
  return training.startAttemptDecision({
    attempts,
    uid,
    ...identity,
    preparation: preparation(uid),
    now: timestamp,
  });
}

const hostIdentity = {
  runId: HOST_RUN,
  endpointId: HOST_ENDPOINT,
  ownerEpoch: HOST_EPOCH,
};
const guestIdentity = {
  runId: GUEST_RUN,
  endpointId: GUEST_ENDPOINT,
  ownerEpoch: GUEST_EPOCH,
};

test("preparation and attempt records use the exact V5 schema", () => {
  const normalized = training.normalizeTrainingPreparation({
    ...preparation("  HOST  NAME "),
    conditions: "  膝は無理しない  ",
  });
  assert.equal(normalized.name, "HOST NAME");
  assert.equal(normalized.conditions, "膝は無理しない");

  const decision = start({}, HOST_UID, hostIdentity);
  assert.equal(decision.allowed, true);
  assert.equal(decision.attempt.protocolVersion, 5);
  assert.equal(decision.attempt.signalingVersion, 5);
  assert.equal(
    training.normalizeTrainingAttempt(HOST_UID, decision.attempt).state,
    "waiting",
  );
  assert.equal(Object.hasOwn(decision.attempt, "roomId"), false);
});

test("the same run and endpoint reclaims an expired 180-second queue lease", () => {
  const first = start({}, HOST_UID, hostIdentity);
  const reclaimed = start(
    first.attempts,
    HOST_UID,
    { ...hostIdentity, ownerEpoch: "unused-new-owner-token-1234" },
    NOW + 181_000,
  );
  assert.equal(reclaimed.allowed, true);
  assert.equal(reclaimed.reason, "reclaimed");
  assert.equal(reclaimed.attempt.ownerEpoch, HOST_EPOCH);
  assert.equal(reclaimed.attempt.state, "waiting");
  assert.equal(reclaimed.attempt.queueExpiresAt, NOW + 361_000);
});

test("a fresh different endpoint is fenced as owner-replaced", () => {
  const first = start({}, HOST_UID, hostIdentity);
  const blocked = start(first.attempts, HOST_UID, {
    runId: "different-run-token-123456",
    endpointId: "different-endpoint-token-12",
    ownerEpoch: "different-owner-epoch-token1",
  }, NOW + 1_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "owner-replaced");
  assert.deepEqual(blocked.attempts, first.attempts);
});

function reservedPair() {
  const host = start({}, HOST_UID, hostIdentity);
  const guest = start(host.attempts, GUEST_UID, guestIdentity, NOW + 1);
  return training.reserveMatchDecision({
    attempts: guest.attempts,
    uid: HOST_UID,
    ...hostIdentity,
    roomId: ROOM_ID,
    roomAttemptId: ROOM_ATTEMPT,
    transportEpoch: TRANSPORT,
    now: NOW + 2,
  });
}

test("matching reserves both fresh waiters in one root decision and activates both", () => {
  const reserved = reservedPair();
  assert.equal(reserved.outcome, "reserved");
  assert.equal(reserved.attempts[HOST_UID].state, "reserved");
  assert.equal(reserved.attempts[GUEST_UID].state, "reserved");
  assert.equal(reserved.attempts[HOST_UID].opponentUid, GUEST_UID);
  assert.equal(reserved.attempts[GUEST_UID].opponentUid, HOST_UID);
  assert.equal(reserved.attempts[GUEST_UID].lastSeen, NOW + 1);
  assert.equal(
    reserved.attempts[GUEST_UID].queueExpiresAt,
    NOW + 1 + training.TRAINING_ATTEMPT_TTL_MS,
  );

  const activated = training.activateMatchDecision({
    attempts: reserved.attempts,
    uid: HOST_UID,
    roomAttemptId: ROOM_ATTEMPT,
    now: NOW + 3,
  });
  assert.equal(activated.activated, true);
  assert.equal(activated.attempts[HOST_UID].state, "active");
  assert.equal(activated.attempts[GUEST_UID].state, "active");

  const room = training.buildActiveTrainingRoom({
    host: activated.attempts[HOST_UID],
    guest: activated.attempts[GUEST_UID],
    chatFrames: { [HOST_UID]: "", [GUEST_UID]: "" },
    now: NOW + 3,
  });
  assert.equal(room.protocolVersion, 3);
  assert.equal(room.sessionProtocolVersion, 5);
  assert.equal(room.signalingVersion, 5);
  assert.equal(room.roomAttemptId, ROOM_ATTEMPT);
  assert.equal(room.transportEpoch, TRANSPORT);
  assert.deepEqual(room.accepted, { [HOST_UID]: true, [GUEST_UID]: true });
  assert.ok(room.rounds[1].createdAt);
  assert.equal(Object.hasOwn(room, "attemptId"), false);
  assert.equal(Object.hasOwn(room, "connectionGeneration"), false);
});

test("activation releases both reservations when the untouched peer lease expired", () => {
  const reserved = reservedPair();
  const attempts = structuredClone(reserved.attempts);
  const peerBefore = attempts[GUEST_UID];
  attempts[HOST_UID].queueExpiresAt =
    NOW + training.TRAINING_ATTEMPT_TTL_MS + 10_000;

  const activation = training.activateMatchDecision({
    attempts,
    uid: HOST_UID,
    roomAttemptId: ROOM_ATTEMPT,
    now: NOW + training.TRAINING_ATTEMPT_TTL_MS + 2,
  });

  assert.equal(activation.activated, false);
  assert.equal(activation.changed, true);
  assert.equal(activation.stale, true);
  assert.equal(activation.attempts[HOST_UID].state, "waiting");
  assert.equal(activation.attempts[GUEST_UID].state, "waiting");
  assert.equal(
    activation.attempts[GUEST_UID].lastSeen,
    peerBefore.lastSeen,
  );
  assert.equal(
    activation.attempts[GUEST_UID].queueExpiresAt,
    peerBefore.queueExpiresAt,
  );
  assert.equal(
    activation.attempts[HOST_UID].pendingRoomCleanup.roomAttemptId,
    ROOM_ATTEMPT,
  );
});

test("cancelling a reservation terminates the caller and restores the peer", () => {
  const reserved = reservedPair();
  const cancelled = training.cancelAttemptDecision({
    attempts: reserved.attempts,
    uid: GUEST_UID,
    ...guestIdentity,
    now: NOW + 4,
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.attempts[GUEST_UID].state, "terminal");
  assert.equal(cancelled.attempts[GUEST_UID].terminalReason, "cancelled");
  assert.equal(cancelled.attempts[HOST_UID].state, "waiting");
  assert.equal(Object.hasOwn(cancelled.attempts[HOST_UID], "roomId"), false);
  assert.equal(
    cancelled.attempts[HOST_UID].lastSeen,
    reserved.attempts[HOST_UID].lastSeen,
  );
  assert.equal(
    cancelled.attempts[HOST_UID].queueExpiresAt,
    reserved.attempts[HOST_UID].queueExpiresAt,
  );
  assert.ok(cancelled.attempts[GUEST_UID].pendingRoomCleanup);
});

test("replacing a stale reservation never refreshes the abandoned peer lease", () => {
  const reserved = reservedPair();
  const peerBefore = reserved.attempts[GUEST_UID];
  const replaced = start(
    reserved.attempts,
    HOST_UID,
    {
      runId: "replacement-run-token-12345",
      endpointId: "replacement-endpoint-token1",
      ownerEpoch: "replacement-owner-token-1234",
    },
    NOW + training.TRAINING_ATTEMPT_TTL_MS + 10,
  );
  assert.equal(replaced.allowed, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(replaced.attempts[GUEST_UID].state, "waiting");
  assert.equal(replaced.attempts[GUEST_UID].lastSeen, peerBefore.lastSeen);
  assert.equal(
    replaced.attempts[GUEST_UID].queueExpiresAt,
    peerBefore.queueExpiresAt,
  );
  assert.equal(
    replaced.attempt.pendingRoomCleanup.roomAttemptId,
    ROOM_ATTEMPT,
  );
});

test("broken reservations converge by exact root fence without reviving the peer", () => {
  const reserved = reservedPair();
  const peerBefore = reserved.attempts[GUEST_UID];
  const converged = training.convergeReservationDecision({
    attempts: reserved.attempts,
    uid: HOST_UID,
    expected: reserved.attempts[HOST_UID],
    now: NOW + 5,
    terminalReason: "room-mismatch",
    cleanupReason: "room-mismatch",
  });
  assert.equal(converged.changed, true);
  assert.equal(converged.attempt.state, "waiting");
  assert.equal(converged.attempts[GUEST_UID].state, "waiting");
  assert.equal(converged.attempts[GUEST_UID].lastSeen, peerBefore.lastSeen);
  assert.equal(
    converged.attempts[GUEST_UID].queueExpiresAt,
    peerBefore.queueExpiresAt,
  );
  assert.equal(
    converged.attempt.pendingRoomCleanup.transportEpoch,
    TRANSPORT,
  );
});

test("reconnect rotates both active attempts once and folds an old-epoch retry", () => {
  const reserved = reservedPair();
  const active = training.activateMatchDecision({
    attempts: reserved.attempts,
    uid: HOST_UID,
    roomAttemptId: ROOM_ATTEMPT,
    now: NOW + 3,
  }).attempts;
  const nextTransportEpoch = "next-transport-epoch-token1";
  const first = training.reconnectAttemptDecision({
    attempts: active,
    uid: HOST_UID,
    ...hostIdentity,
    roomAttemptId: ROOM_ATTEMPT,
    transportEpoch: TRANSPORT,
    nextTransportEpoch,
    now: NOW + 4,
  });
  assert.equal(first.rotated, true);
  assert.equal(first.attempts[HOST_UID].transportEpoch, nextTransportEpoch);
  assert.equal(first.attempts[GUEST_UID].transportEpoch, nextTransportEpoch);
  assert.equal(
    first.attempts[GUEST_UID].lastSeen,
    active[GUEST_UID].lastSeen,
  );
  assert.equal(
    first.attempts[GUEST_UID].queueExpiresAt,
    active[GUEST_UID].queueExpiresAt,
  );

  const retry = training.reconnectAttemptDecision({
    attempts: first.attempts,
    uid: HOST_UID,
    ...hostIdentity,
    roomAttemptId: ROOM_ATTEMPT,
    transportEpoch: TRANSPORT,
    nextTransportEpoch: "unused-transport-epoch-token",
    now: NOW + 5,
  });
  assert.equal(retry.rotated, false);
  assert.equal(retry.attempt.transportEpoch, nextTransportEpoch);
  assert.equal(retry.attempt.revision, first.attempt.revision);
});

test("active attempts remain live independently of queueExpiresAt", () => {
  const reserved = reservedPair();
  const active = training.activateMatchDecision({
    attempts: reserved.attempts,
    uid: HOST_UID,
    roomAttemptId: ROOM_ATTEMPT,
    now: NOW + 3,
  }).attempts[HOST_UID];
  assert.equal(training.attemptIsQueueFresh(active, NOW + 999_999), false);
  assert.equal(training.normalizeTrainingAttempt(HOST_UID, active).state, "active");
});
