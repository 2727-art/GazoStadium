"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const solo = require("../solo-session-v2");
const training = require("../training-session-v2");

const NOW = 1_800_000_000_000;
const ROOM_ID = "-0123456789ABCDEFGH_";
const ATTEMPT_ID = "attempt-token-1234567890";
const ROOM_CONNECTION_GENERATION = "connection-token-1234567890";
const HOST_UID = "training-host";
const GUEST_UID = "training-guest";

function commandDeck(prefix) {
  return {
    1: {
      exercise: `${prefix} スクワット`,
      completion: "20回",
      command: "一定のテンポで続ける",
      beatsPerRep: 2,
    },
    2: {
      exercise: `${prefix} 腹筋`,
      completion: "15回",
      command: "呼吸を止めずに続ける",
      beatsPerRep: 4,
    },
    3: {
      exercise: `${prefix} 腕立て伏せ`,
      completion: "10回",
      command: "無理のないフォームで続ける",
      beatsPerRep: 8,
    },
  };
}

function imageBpms(offset = 0) {
  return {
    1: 0,
    2: 80 + offset,
    3: 100 + offset,
    4: 120 + offset,
    5: 140 + offset,
  };
}

function claim(uid, {
  sessionId = `${uid}-session-token-123456`,
  leaseToken = `${uid}-lease-token-12345678`,
  generation = `${uid}-generation-token-1234`,
  expiresAt = NOW + training.TRAINING_SESSION_LEASE_TTL_MS,
} = {}) {
  return {
    protocolVersion: training.TRAINING_SESSION_PROTOCOL_VERSION,
    sessionId,
    leaseToken,
    generation,
    claimedAt: NOW - 2_000,
    heartbeatAt: NOW - 1_000,
    expiresAt,
  };
}

function queueEntry(uid, claimValue, {
  joinedAt = NOW - 10_000,
  lastSeen = NOW - 1_000,
  state = "waiting",
  connectionGeneration = 1,
  roomId = ROOM_ID,
  attemptId = ATTEMPT_ID,
} = {}) {
  return {
    protocolVersion: training.TRAINING_SESSION_PROTOCOL_VERSION,
    trainingProtocolVersion: training.TRAINING_GAME_PROTOCOL_VERSION,
    variant: training.TRAINING_GAME_VARIANT,
    uid,
    sessionId: claimValue.sessionId,
    leaseToken: claimValue.leaseToken,
    generation: claimValue.generation,
    connectionGeneration,
    name: uid === HOST_UID ? "HOST" : "GUEST",
    intensity: uid === HOST_UID ? "strong" : "standard",
    commandDeck: commandDeck(uid),
    imageBpms: imageBpms(uid === HOST_UID ? 0 : 1),
    joinedAt,
    lastSeen,
    expiresAt: claimValue.expiresAt,
    state,
    ...(["offering", "reserved"].includes(state) ? { roomId, attemptId } : {}),
  };
}

function pair() {
  const hostClaim = claim(HOST_UID);
  const guestClaim = claim(GUEST_UID);
  return {
    hostClaim,
    guestClaim,
    host: training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      hostClaim.sessionId,
      queueEntry(HOST_UID, hostClaim),
      hostClaim,
      NOW,
    ),
    guest: training.normalizeTrainingSessionQueueEntry(
      GUEST_UID,
      guestClaim.sessionId,
      queueEntry(GUEST_UID, guestClaim),
      guestClaim,
      NOW,
    ),
  };
}

test("training sessions reuse the normal V2 fence with a workout-safe lease", () => {
  assert.equal(
    training.TRAINING_SESSION_PROTOCOL_VERSION,
    solo.SOLO_SESSION_PROTOCOL_VERSION,
  );
  assert.equal(training.TRAINING_SIGNALING_VERSION, solo.SOLO_SIGNALING_VERSION);
  assert.equal(training.TRAINING_GAME_PROTOCOL_VERSION, 3);
  assert.equal(training.TRAINING_GAME_VARIANT, "kitaeai_hp_v3");
  assert.equal(training.TRAINING_SESSION_PATH_GENERATION, 4);
  assert.equal(training.TRAINING_SESSION_LEASE_TTL_MS, 180_000);
  assert.ok(training.TRAINING_SESSION_LEASE_TTL_MS > 90_000);
  assert.equal(training.TRAINING_SESSION_RESOURCE_EXPIRY_MAX_MS, 210_000);

  const decision = training.claimDecision({
    currentClaim: null,
    sessionId: "training-session-token-123456",
    leaseToken: "training-lease-token-12345678",
    generation: "training-generation-token-1234",
    now: NOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(training.normalizeClaim(decision.claim)?.protocolVersion, 2);
  assert.deepEqual(
    training.publicClaimLease(decision.claim),
    solo.publicClaimLease(decision.claim),
  );
  const heartbeat = training.heartbeatDecision({
    currentClaim: decision.claim,
    sessionId: decision.claim.sessionId,
    leaseToken: decision.claim.leaseToken,
    generation: decision.claim.generation,
    now: NOW + 1_000,
  });
  assert.equal(heartbeat.allowed, true);
  assert.equal(
    training.resourceFenceMatches(decision.claim, decision.claim),
    true,
  );
});

test("a valid private training queue row is normalized against its exact claim", () => {
  const ownClaim = claim(HOST_UID);
  const source = queueEntry(HOST_UID, ownClaim, {
    connectionGeneration: "queue-connection-token-1234",
  });
  const normalized = training.normalizeTrainingSessionQueueEntry(
    HOST_UID,
    ownClaim.sessionId,
    source,
    ownClaim,
    NOW,
  );
  assert.ok(normalized);
  assert.equal(normalized.uid, HOST_UID);
  assert.equal(normalized.state, "waiting");
  assert.equal(normalized.commandDeck[3].beatsPerRep, 8);
  assert.equal(normalized.imageBpms[1], 0);
  assert.equal(Object.hasOwn(normalized, "conditions"), false);
  assert.equal(
    training.trainingSessionQueueEntryMatchesClaim(
      HOST_UID,
      ownClaim.sessionId,
      source,
      ownClaim,
      NOW,
    ),
    true,
  );
});

test("conditions and unknown fields are rejected from the private queue", () => {
  const ownClaim = claim(HOST_UID);
  const withConditions = {
    ...queueEntry(HOST_UID, ownClaim),
    conditions: "ジャンプなし",
  };
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      withConditions,
      ownClaim,
      NOW,
    ),
    null,
  );
  const withUnknown = {
    ...queueEntry(HOST_UID, ownClaim),
    rating: 1500,
  };
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      withUnknown,
      ownClaim,
      NOW,
    ),
    null,
  );
});

test("server enqueue preparation is canonical and rejects unknown or malformed fields", () => {
  assert.deepEqual(training.normalizeTrainingSessionPreparation({
    name: "  TRAINING   HOST  ",
    intensity: "strong",
    commandDeck: commandDeck("HOST"),
    imageBpms: imageBpms(),
  }), {
    name: "TRAINING HOST",
    intensity: "strong",
    commandDeck: commandDeck("HOST"),
    imageBpms: imageBpms(),
  });
  assert.equal(training.normalizeTrainingSessionPreparation({
    name: "HOST",
    intensity: "strong",
    commandDeck: commandDeck("HOST"),
    imageBpms: imageBpms(),
    conditions: "queue に入れてはいけない",
  }), null);
  const malformedDeck = commandDeck("HOST");
  malformedDeck[1].beatsPerRep = 3;
  assert.equal(training.normalizeTrainingSessionPreparation({
    name: "HOST",
    intensity: "strong",
    commandDeck: malformedDeck,
    imageBpms: imageBpms(),
  }), null);
});

test("queue validation rejects malformed COMMAND, BPM, timestamps, and claims", () => {
  const ownClaim = claim(HOST_UID);
  const valid = queueEntry(HOST_UID, ownClaim);
  const malformedDeck = structuredClone(valid);
  malformedDeck.commandDeck[2].beatsPerRep = 3;
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      malformedDeck,
      ownClaim,
      NOW,
    ),
    null,
  );
  const extraCardField = structuredClone(valid);
  extraCardField.commandDeck[1].difficulty = "hard";
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      extraCardField,
      ownClaim,
      NOW,
    ),
    null,
  );
  const malformedBpm = structuredClone(valid);
  malformedBpm.imageBpms[5] = 161;
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      malformedBpm,
      ownClaim,
      NOW,
    ),
    null,
  );
  const stale = {
    ...valid,
    lastSeen: NOW - training.TRAINING_SESSION_QUEUE_FRESH_MS - 1,
  };
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      stale,
      ownClaim,
      NOW,
    ),
    null,
  );
  const otherClaim = claim(HOST_UID, {
    generation: "replacement-generation-token-12",
  });
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      valid,
      otherClaim,
      NOW,
    ),
    null,
  );
  assert.equal(
    training.normalizeTrainingSessionQueueEntry(
      HOST_UID,
      ownClaim.sessionId,
      { ...valid, expiresAt: ownClaim.expiresAt - 1 },
      ownClaim,
      NOW,
    ),
    null,
  );
});

test("reserved queue states require exact server room and attempt fences", () => {
  const ownClaim = claim(HOST_UID);
  const reserved = queueEntry(HOST_UID, ownClaim, { state: "reserved" });
  assert.ok(training.normalizeTrainingSessionQueueEntry(
    HOST_UID,
    ownClaim.sessionId,
    reserved,
    ownClaim,
    NOW,
    { allowedStates: ["reserved"] },
  ));
  assert.equal(training.normalizeTrainingSessionQueueEntry(
    HOST_UID,
    ownClaim.sessionId,
    { ...reserved, roomId: "bad-room" },
    ownClaim,
    NOW,
    { allowedStates: ["reserved"] },
  ), null);
  assert.equal(training.normalizeTrainingSessionQueueEntry(
    HOST_UID,
    ownClaim.sessionId,
    { ...reserved, attemptId: "short" },
    ownClaim,
    NOW,
    { allowedStates: ["reserved"] },
  ), null);
  assert.equal(training.normalizeTrainingSessionQueueEntry(
    HOST_UID,
    ownClaim.sessionId,
    reserved,
    ownClaim,
    NOW,
  ), null);
});

test("flattening keeps only the current fresh claimed training session", () => {
  const hostClaim = claim(HOST_UID);
  const guestClaim = claim(GUEST_UID);
  const staleGuestSession = "stale-guest-session-token-123";
  const fresh = training.flattenFreshTrainingQueueV4({
    [HOST_UID]: {
      [hostClaim.sessionId]: queueEntry(HOST_UID, hostClaim),
      "unclaimed-session-token-12345": queueEntry(HOST_UID, {
        ...hostClaim,
        sessionId: "unclaimed-session-token-12345",
      }),
    },
    [GUEST_UID]: {
      [guestClaim.sessionId]: queueEntry(GUEST_UID, guestClaim),
      [staleGuestSession]: queueEntry(GUEST_UID, {
        ...guestClaim,
        sessionId: staleGuestSession,
      }),
    },
  }, {
    [HOST_UID]: hostClaim,
    [GUEST_UID]: guestClaim,
  }, NOW);
  assert.deepEqual(Object.keys(fresh).sort(), [GUEST_UID, HOST_UID].sort());
  assert.equal(fresh[HOST_UID].sessionId, hostClaim.sessionId);
  assert.equal(fresh[GUEST_UID].sessionId, guestClaim.sessionId);
});

test("FIFO selection chooses the oldest available opponent with soft avoid fallback", () => {
  const requester = { uid: HOST_UID, joinedAt: NOW - 1_000 };
  const oldest = { uid: "candidate-oldest", joinedAt: NOW - 4_000 };
  const tiedFirst = { uid: "candidate-a", joinedAt: NOW - 3_000 };
  const tiedSecond = { uid: "candidate-b", joinedAt: NOW - 3_000 };
  const queue = {
    [HOST_UID]: requester,
    [oldest.uid]: oldest,
    [tiedFirst.uid]: tiedFirst,
    [tiedSecond.uid]: tiedSecond,
  };
  assert.equal(
    training.selectTrainingSessionMatch({
      requesterUid: HOST_UID,
      queue,
    }).candidate.uid,
    oldest.uid,
  );
  assert.equal(
    training.selectTrainingSessionMatch({
      requesterUid: HOST_UID,
      queue,
      avoidUid: oldest.uid,
    }).candidate.uid,
    tiedFirst.uid,
  );
  assert.equal(
    training.selectTrainingSessionMatch({
      requesterUid: HOST_UID,
      queue: {
        [HOST_UID]: requester,
        [oldest.uid]: oldest,
      },
      avoidUid: oldest.uid,
    }).candidate.uid,
    oldest.uid,
  );
  assert.equal(training.selectTrainingSessionMatch({
    requesterUid: HOST_UID,
    queue,
    activeUids: [HOST_UID],
  }), null);
  assert.equal(training.selectTrainingSessionMatch({
    requesterUid: HOST_UID,
    queue,
    lockedUids: [oldest.uid, tiedFirst.uid, tiedSecond.uid],
  }), null);
});

test("the resource builder keeps gameplay V3 and adds immutable session V2 identity", () => {
  const { host, guest } = pair();
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    hostConditions: "  ジャンプなし   手首は軽め  ",
    now: NOW,
  });
  assert.equal(resources.room.protocolVersion, 3);
  assert.equal(resources.room.variant, "kitaeai_hp_v3");
  assert.equal(resources.room.sessionProtocolVersion, 2);
  assert.equal(resources.room.signalingVersion, 2);
  assert.equal(resources.room.status, "offered");
  assert.equal(resources.room.attemptId, ATTEMPT_ID);
  assert.equal(
    resources.room.connectionGeneration,
    ROOM_CONNECTION_GENERATION,
  );
  assert.deepEqual(resources.room.sessions, {
    [HOST_UID]: {
      sessionId: host.sessionId,
      generation: host.generation,
    },
    [GUEST_UID]: {
      sessionId: guest.sessionId,
      generation: guest.generation,
    },
  });
  assert.equal(
    resources.room.players[HOST_UID].conditions,
    "ジャンプなし 手首は軽め",
  );
  assert.equal(resources.room.players[GUEST_UID].conditions, "");
  assert.deepEqual(resources.room.accepted, { [HOST_UID]: true });
  assert.equal(resources.permit.protocolVersion, 2);
  assert.equal(resources.offer.protocolVersion, 2);
  assert.equal(resources.offer.toSessionId, guest.sessionId);
  assert.equal(resources.hostActive.role, "host");
  assert.equal(resources.guestActive.role, "guest");
  assert.equal(resources.hostLock.attemptId, ATTEMPT_ID);
  assert.equal(resources.guestLock.connectionGeneration, undefined);
  for (const value of Object.values(resources.room.players)) {
    assert.equal(Object.hasOwn(value, "rating"), false);
    assert.equal(Object.hasOwn(value, "pursuitLine"), false);
    assert.equal(Object.hasOwn(value, "profileProjectionVersion"), false);
  }
  assert.equal(Object.hasOwn(resources.room, "reunion"), false);
});

test("the resource builder rejects invalid participants, room ids, and conditions", () => {
  const { host, guest } = pair();
  assert.throws(() => training.buildTrainingSessionResources({
    roomId: "invalid",
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    now: NOW,
  }), /invalid training session resource input/);
  assert.throws(() => training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest: { ...guest, uid: host.uid },
    now: NOW,
  }), /invalid training session resource input/);
  assert.throws(() => training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    hostConditions: "x".repeat(81),
    now: NOW,
  }), /invalid training session player/);
});

test("room, active, queue, lock, attempt, and session fences are exact", () => {
  const { hostClaim, guestClaim, host, guest } = pair();
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    now: NOW,
  });
  assert.equal(
    training.trainingSessionRoomAttemptMatches(
      resources.room,
      training.trainingSessionTransitionExpected(resources),
    ),
    true,
  );
  assert.equal(
    training.trainingSessionRecordAttemptMatches(
      resources.permit,
      resources.permit,
    ),
    true,
  );
  assert.equal(training.trainingSessionRoomMatches(resources.room, {
    uid: HOST_UID,
    sessionId: host.sessionId,
    generation: host.generation,
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
  }), true);
  assert.equal(training.trainingSessionRoomMatches(resources.room, {
    uid: HOST_UID,
    sessionId: host.sessionId,
    generation: "different-generation-token-123",
    roomId: ROOM_ID,
  }), false);
  assert.equal(training.trainingSessionActiveEntryIsFresh(
    HOST_UID,
    resources.hostActive,
    hostClaim,
    NOW,
  ), true);
  assert.deepEqual(
    [...training.trainingSessionActiveUidSet({
      [HOST_UID]: { [host.sessionId]: resources.hostActive },
      [GUEST_UID]: { [guest.sessionId]: resources.guestActive },
    }, {
      [HOST_UID]: hostClaim,
      [GUEST_UID]: guestClaim,
    }, NOW)].sort(),
    [GUEST_UID, HOST_UID].sort(),
  );
  assert.equal(training.trainingSessionActiveMatchesRoom(
    resources.hostActive,
    HOST_UID,
    resources.room.sessions[HOST_UID],
    ROOM_ID,
    resources.room,
  ), true);
  assert.equal(training.trainingSessionLockMatches(
    resources.hostLock,
    resources.hostLock,
  ), true);
  assert.equal(training.trainingSessionRecordSessionsMatch(
    resources.offer,
    resources,
  ), true);
  assert.equal(training.trainingSessionRecordSessionsMatch(
    {
      ...resources.offer,
      sessions: {
        ...resources.offer.sessions,
        [GUEST_UID]: {
          ...resources.offer.sessions[GUEST_UID],
          generation: "different-generation-token-123",
        },
      },
    },
    resources,
  ), false);

  const hostQueue = queueEntry(HOST_UID, hostClaim, { state: "offering" });
  const guestQueue = queueEntry(GUEST_UID, guestClaim, { state: "reserved" });
  assert.equal(training.trainingSessionQueueMatchesRoom(
    hostQueue,
    HOST_UID,
    resources.room.sessions[HOST_UID],
    ROOM_ID,
    resources.room,
  ), true);
  const fence = {
    hostClaim,
    guestClaim,
    hostQueue,
    guestQueue,
    hostLock: resources.hostLock,
    guestLock: resources.guestLock,
    attemptId: ATTEMPT_ID,
    now: NOW,
  };
  assert.equal(training.trainingSessionMaterializationFenceMatches(fence), true);
  assert.equal(training.materializationFenceMatches(fence), true);
  assert.equal(training.trainingSessionMaterializationFenceMatches({
    ...fence,
    guestLock: {
      ...resources.guestLock,
      generation: "different-generation-token-123",
    },
  }), false);
});

test("training room transitions serialize accept, cancel, and expire", () => {
  const { host, guest } = pair();
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    now: NOW,
  });
  const transitionToken = "transition-token-123456789";
  const expected = training.trainingSessionTransitionExpected(resources);
  const acquired = training.decideTrainingSessionRoomTransition({
    room: resources.room,
    expected,
    action: "accept",
    token: transitionToken,
    now: NOW + 1_000,
  });
  assert.equal(acquired.allowed, true);
  assert.equal(acquired.reason, "acquired");
  assert.equal(
    training.roomTransitionOwned(acquired.room, "accept", transitionToken),
    true,
  );
  const competing = training.decideTrainingSessionRoomTransition({
    room: acquired.room,
    expected,
    action: "cancel",
    token: "competing-transition-token-12",
    now: NOW + 2_000,
  });
  assert.equal(competing.allowed, false);
  assert.equal(competing.reason, "transition-busy");

  const active = training.activateTrainingSessionRoom(acquired.room, {
    expected,
    transitionToken,
    guestUid: GUEST_UID,
    conditions: "ジャンプなし",
    now: NOW + 3_000,
  });
  assert.equal(active.status, "active");
  assert.equal(active.players[GUEST_UID].conditions, "ジャンプなし");
  assert.deepEqual(active.accepted, {
    [HOST_UID]: true,
    [GUEST_UID]: true,
  });
  const expire = training.decideTrainingSessionRoomTransition({
    room: { ...active, matchTransition: undefined },
    expected,
    action: "expire",
    token: "expire-transition-token-1234",
    now: NOW + 4_000,
  });
  assert.equal(expire.allowed, false);
  assert.equal(expire.reason, "active");
  const activeCancel = training.decideTrainingSessionRoomTransition({
    room: { ...active, matchTransition: undefined },
    expected,
    action: "cancel",
    token: "cancel-transition-token-1234",
    now: NOW + 4_000,
    allowActiveCancel: true,
  });
  assert.equal(activeCancel.allowed, true);
});

test("a changed gameplay or session identity cannot cross a room transition", () => {
  const { host, guest } = pair();
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    now: NOW,
  });
  const expected = training.trainingSessionTransitionExpected(resources);
  for (const changedRoom of [
    { ...resources.room, protocolVersion: 2 },
    { ...resources.room, sessionProtocolVersion: 3 },
    { ...resources.room, signalingVersion: 1 },
    { ...resources.room, attemptId: "changed-attempt-token-1234" },
    { ...resources.room, connectionGeneration: "changed-connection-token-123" },
  ]) {
    assert.equal(training.trainingSessionRoomAttemptMatches(
      changedRoom,
      expected,
    ), false);
    assert.deepEqual(training.decideTrainingSessionRoomTransition({
      room: changedRoom,
      expected,
      action: "accept",
      token: "transition-token-123456789",
      now: NOW + 1_000,
    }), {
      allowed: false,
      reason: "room-changed",
      room: null,
    });
  }
});

test("stale room transitions may be replaced without weakening a fresh lock", () => {
  const { host, guest } = pair();
  const resources = training.buildTrainingSessionResources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: ROOM_CONNECTION_GENERATION,
    host,
    guest,
    now: NOW,
  });
  const expected = training.trainingSessionTransitionExpected(resources);
  const staleRoom = {
    ...resources.room,
    matchTransition: {
      action: "cancel",
      token: "old-transition-token-123456",
      startedAt: NOW - training.TRAINING_ROOM_TRANSITION_TTL_MS - 1,
    },
  };
  const replaced = training.decideTrainingSessionRoomTransition({
    room: staleRoom,
    expected,
    action: "accept",
    token: "new-transition-token-123456",
    now: NOW,
  });
  assert.equal(replaced.allowed, true);
  assert.equal(replaced.reason, "acquired-after-stale");
  assert.equal(replaced.room.matchTransition.action, "accept");
});
