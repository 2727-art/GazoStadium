"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const MODULE_URL = pathToFileURL(
  path.join(ROOT, "training-session-v2.mjs"),
).href;

const HOST_UID = "training-host";
const GUEST_UID = "training-guest";
const HOST_SESSION = "11111111-1111-4111-8111-111111111111";
const GUEST_SESSION = "22222222-2222-4222-8222-222222222222";
const HOST_LEASE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUEST_LEASE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_GENERATION = "aaaaaaaaaaaaaaaaaaaaaa";
const GUEST_GENERATION = "bbbbbbbbbbbbbbbbbbbbbb";
const ROOM_ID = "-TrainingRoomV4abcde";
const ATTEMPT_ID = "attempt-token-v4-123456";
const CONNECTION_GENERATION = "connection-token-v4-1234";
const NOW = 2_000_000_000_000;

let client;

before(async () => {
  client = await import(MODULE_URL);
});

function commandDeck(prefix = "腕立て") {
  return {
    1: {
      exercise: `${prefix}1`,
      completion: "10回",
      command: "リズムに合わせて",
      beatsPerRep: 2,
    },
    2: {
      exercise: `${prefix}2`,
      completion: "20回",
      command: "フォームを保って",
      beatsPerRep: 4,
    },
    3: {
      exercise: `${prefix}3`,
      completion: "30回",
      command: "最後まで続けて",
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

function rtdbSparseArray(value) {
  const restored = [];
  for (const [key, child] of Object.entries(value)) {
    restored[Number(key)] = structuredClone(child);
  }
  return restored;
}

function queueInput(overrides = {}) {
  return {
    uid: HOST_UID,
    sessionId: HOST_SESSION,
    leaseToken: HOST_LEASE,
    generation: HOST_GENERATION,
    connectionGeneration: CONNECTION_GENERATION,
    name: "HOST",
    intensity: "strong",
    commandDeck: commandDeck(),
    imageBpms: imageBpms(),
    joinedAt: NOW,
    lastSeen: NOW + 1_000,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

function player(uid, name, deckPrefix, bpmOffset = 0, conditions = "") {
  return {
    uid,
    name,
    intensity: uid === HOST_UID ? "strong" : "standard",
    conditions,
    commandDeck: commandDeck(deckPrefix),
    imageBpms: imageBpms(bpmOffset),
  };
}

function room(overrides = {}) {
  const value = {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 2,
    signalingVersion: 2,
    hostUid: HOST_UID,
    guestUid: GUEST_UID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: CONNECTION_GENERATION,
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    status: "offered",
    sessions: {
      [HOST_UID]: {
        sessionId: HOST_SESSION,
        generation: HOST_GENERATION,
      },
      [GUEST_UID]: {
        sessionId: GUEST_SESSION,
        generation: GUEST_GENERATION,
      },
    },
    members: {
      [HOST_UID]: true,
      [GUEST_UID]: true,
    },
    players: {
      [HOST_UID]: player(HOST_UID, "HOST", "腕立て"),
      [GUEST_UID]: player(GUEST_UID, "GUEST", "スクワット", 1),
    },
    accepted: {
      [HOST_UID]: true,
    },
  };
  return { ...value, ...overrides };
}

function offer(overrides = {}) {
  return {
    protocolVersion: 2,
    signalingVersion: 2,
    trainingProtocolVersion: 3,
    variant: "kitaeai_hp_v3",
    hostUid: HOST_UID,
    guestUid: GUEST_UID,
    attemptId: ATTEMPT_ID,
    connectionGeneration: CONNECTION_GENERATION,
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    sessions: room().sessions,
    roomId: ROOM_ID,
    fromUid: HOST_UID,
    toUid: GUEST_UID,
    fromSessionId: HOST_SESSION,
    toSessionId: GUEST_SESSION,
    fromName: "HOST",
    ...overrides,
  };
}

function signalEnvelope(overrides = {}) {
  return client.createTrainingSessionSignalEnvelope({
    fromUid: HOST_UID,
    fromSessionId: HOST_SESSION,
    toUid: GUEST_UID,
    toSessionId: GUEST_SESSION,
    connectionGeneration: CONNECTION_GENERATION,
    attemptId: ATTEMPT_ID,
    type: "offer",
    payload: JSON.stringify({ type: "offer", sdp: "example" }),
    createdAt: NOW,
    ...overrides,
  });
}

function signalDecision(envelope, overrides = {}) {
  return client.decideTrainingSessionSignal({
    envelope,
    ownUid: GUEST_UID,
    remoteUid: HOST_UID,
    ownSessionId: GUEST_SESSION,
    remoteSessionId: HOST_SESSION,
    connectionGeneration: CONNECTION_GENERATION,
    attemptId: ATTEMPT_ID,
    isCurrentLeaseOwner: true,
    now: NOW,
    ...overrides,
  });
}

test("training V4 paths and protocol constants are exact", () => {
  assert.equal(client.TRAINING_SESSION_PROTOCOL_VERSION, 2);
  assert.equal(client.TRAINING_SESSION_GAME_PROTOCOL_VERSION, 3);
  assert.equal(client.TRAINING_SESSION_GAME_VARIANT, "kitaeai_hp_v3");
  assert.equal(client.TRAINING_SIGNALING_VERSION, 2);
  assert.equal(
    client.TRAINING_SESSION_STORAGE_KEY,
    "hariai:training:session-id:v2",
  );
  assert.equal(
    client.trainingSessionClaimPath(HOST_UID),
    `online/trainingSessionClaims/${HOST_UID}`,
  );
  assert.equal(
    client.trainingSessionQueuePath(HOST_UID, HOST_SESSION),
    `online/trainingQueueV4/${HOST_UID}/${HOST_SESSION}`,
  );
  assert.equal(
    client.trainingSessionOfferPath(GUEST_UID, GUEST_SESSION),
    `online/trainingOffersV4/${GUEST_UID}/${GUEST_SESSION}`,
  );
  assert.equal(
    client.trainingSessionOfferPath(GUEST_UID, GUEST_SESSION, ROOM_ID),
    `online/trainingOffersV4/${GUEST_UID}/${GUEST_SESSION}/${ROOM_ID}`,
  );
  assert.equal(
    client.trainingSessionActivePath(HOST_UID, HOST_SESSION),
    `online/trainingActiveV4/${HOST_UID}/${HOST_SESSION}`,
  );
  assert.equal(
    client.trainingSessionMatchLockPath(HOST_UID),
    `online/trainingMatchLocksV4/${HOST_UID}`,
  );
  assert.equal(
    client.trainingSessionPermitPath(ROOM_ID),
    `online/trainingMatchPermitsV4/${ROOM_ID}`,
  );
  assert.equal(
    client.trainingSessionRoomPath(ROOM_ID),
    `online/trainingRooms/${ROOM_ID}`,
  );
  assert.equal(
    client.trainingSessionSignalPath(ROOM_ID, GUEST_UID, GUEST_SESSION),
    `online/trainingRooms/${ROOM_ID}/signalsV2/${GUEST_UID}/${GUEST_SESSION}`,
  );
  assert.equal(
    client.trainingSessionPresencePath(ROOM_ID, HOST_UID, HOST_SESSION),
    `online/trainingRooms/${ROOM_ID}/presenceV2/${HOST_UID}/${HOST_SESSION}`,
  );
  assert.throws(
    () => client.trainingSessionClaimPath("bad/uid"),
    /Firebase-safe uid/,
  );
  assert.throws(
    () => client.trainingSessionRoomPath("short"),
    /Firebase room id/,
  );
  assert.throws(
    () => client.trainingSessionQueuePath(HOST_UID, "not-a-session"),
    /canonical online session id/,
  );
});

test("queue payload is canonical, immutable, and never carries conditions", () => {
  const payload = client.createTrainingSessionQueuePayload(queueInput());
  assert.deepEqual(Object.keys(payload).sort(), [
    "commandDeck",
    "connectionGeneration",
    "expiresAt",
    "generation",
    "imageBpms",
    "intensity",
    "joinedAt",
    "lastSeen",
    "leaseToken",
    "name",
    "protocolVersion",
    "sessionId",
    "state",
    "trainingProtocolVersion",
    "uid",
    "variant",
  ]);
  assert.equal(payload.protocolVersion, 2);
  assert.equal(payload.trainingProtocolVersion, 3);
  assert.equal(payload.variant, "kitaeai_hp_v3");
  assert.equal(payload.state, "waiting");
  assert.equal(Object.hasOwn(payload, "conditions"), false);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.commandDeck), true);
  assert.equal(Object.isFrozen(payload.commandDeck[1]), true);
  assert.equal(Object.isFrozen(payload.imageBpms), true);
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ conditions: undefined }),
    ),
    /must not be stored/,
  );
});

test("queue and room validation accept only exact RTDB sparse indexed maps", () => {
  const sparseDeck = rtdbSparseArray(commandDeck());
  const sparseBpms = rtdbSparseArray(imageBpms());
  const payload = client.createTrainingSessionQueuePayload(queueInput({
    commandDeck: sparseDeck,
    imageBpms: sparseBpms,
  }));
  assert.deepEqual(payload.commandDeck, commandDeck());
  assert.deepEqual(payload.imageBpms, imageBpms());
  assert.equal(Array.isArray(payload.commandDeck), false);
  assert.equal(Array.isArray(payload.imageBpms), false);

  const restoredRoom = room();
  for (const value of Object.values(restoredRoom.players)) {
    value.commandDeck = rtdbSparseArray(value.commandDeck);
    value.imageBpms = rtdbSparseArray(value.imageBpms);
  }
  assert.equal(client.validateTrainingSessionRoom(restoredRoom), true);

  const invalidInputs = [
    { commandDeck: Object.assign(rtdbSparseArray(commandDeck()), { 0: commandDeck()[1] }) },
    { commandDeck: Object.assign(rtdbSparseArray(commandDeck()), { 4: commandDeck()[1] }) },
    { commandDeck: Object.assign(rtdbSparseArray(commandDeck()), { extra: commandDeck()[1] }) },
    { commandDeck: Object.assign(rtdbSparseArray(commandDeck()), { length: 5 }) },
    { imageBpms: Object.assign(rtdbSparseArray(imageBpms()), { 0: 60 }) },
    { imageBpms: Object.assign(rtdbSparseArray(imageBpms()), { 6: 60 }) },
    { imageBpms: Object.assign(rtdbSparseArray(imageBpms()), { extra: 60 }) },
    { imageBpms: Object.assign(rtdbSparseArray(imageBpms()), { length: 7 }) },
  ];
  const missingDeck = rtdbSparseArray(commandDeck());
  delete missingDeck[2];
  invalidInputs.push({ commandDeck: missingDeck });
  const missingBpm = rtdbSparseArray(imageBpms());
  delete missingBpm[4];
  invalidInputs.push({ imageBpms: missingBpm });

  for (const invalid of invalidInputs) {
    assert.throws(
      () => client.createTrainingSessionQueuePayload(queueInput(invalid)),
      /must contain exactly/,
    );
  }
});

test("queue payload rejects malformed preparation and resource fences", () => {
  const invalidDeck = commandDeck();
  invalidDeck[2].beatsPerRep = 3;
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ commandDeck: invalidDeck }),
    ),
    /invalid command/,
  );
  const extraFieldDeck = commandDeck();
  extraFieldDeck[1].difficulty = "hard";
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ commandDeck: extraFieldDeck }),
    ),
    /invalid shape/,
  );
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ imageBpms: { ...imageBpms(), 5: 161 } }),
    ),
    /invalid BPM/,
  );
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ generation: "too-short" }),
    ),
    /22-character/,
  );
  assert.throws(
    () => client.createTrainingSessionQueuePayload(
      queueInput({ lastSeen: NOW + 70_000 }),
    ),
    /joinedAt <= lastSeen < expiresAt/,
  );
});

test("session fences require the exact tab, lease, and generation", () => {
  const fence = client.createTrainingSessionFence({
    sessionId: HOST_SESSION,
    leaseToken: HOST_LEASE,
    generation: HOST_GENERATION,
    connectionGeneration: CONNECTION_GENERATION,
  });
  assert.equal(Object.isFrozen(fence), true);
  assert.equal(client.trainingSessionFenceMatches(fence, fence), true);
  assert.equal(client.trainingSessionFenceMatches({
    ...fence,
    generation: GUEST_GENERATION,
  }, fence), false);
  assert.equal(client.trainingSessionFenceMatches({
    ...fence,
    connectionGeneration: 1,
  }, fence), false);
});

test("room validation preserves gameplay V3 and enforces session V2 identity", () => {
  const offered = room();
  assert.equal(client.validateTrainingSessionRoom(offered), true);
  assert.equal(client.trainingSessionRoomMemberMatches(offered, {
    uid: GUEST_UID,
    sessionId: GUEST_SESSION,
    generation: GUEST_GENERATION,
    attemptId: ATTEMPT_ID,
    connectionGeneration: CONNECTION_GENERATION,
  }), true);
  assert.equal(client.trainingSessionRoomMemberMatches(offered, {
    uid: GUEST_UID,
    sessionId: GUEST_SESSION,
    generation: GUEST_GENERATION,
    requireActive: true,
  }), false);

  const active = room({
    status: "active",
    accepted: {
      [HOST_UID]: true,
      [GUEST_UID]: true,
    },
  });
  assert.equal(client.validateTrainingSessionRoom(active), true);
  assert.equal(client.trainingSessionRoomMemberMatches(active, {
    uid: GUEST_UID,
    sessionId: GUEST_SESSION,
    generation: GUEST_GENERATION,
    requireActive: true,
  }), true);

  for (const invalid of [
    room({ protocolVersion: 2 }),
    room({ sessionProtocolVersion: 3 }),
    room({ signalingVersion: 1 }),
    room({ attemptId: "short" }),
    room({
      sessions: {
        ...offered.sessions,
        [GUEST_UID]: {
          sessionId: GUEST_SESSION,
          generation: "wrong",
        },
      },
    }),
    room({
      members: {
        ...offered.members,
        outsider: true,
      },
    }),
    room({
      accepted: {
        [HOST_UID]: true,
        [GUEST_UID]: true,
      },
    }),
  ]) {
    assert.equal(client.validateTrainingSessionRoom(invalid), false);
  }
});

test("only a fresh offer for the current guest session is accepted", () => {
  const current = client.decideTrainingSessionOffer({
    offer: offer(),
    roomId: ROOM_ID,
    ownUid: GUEST_UID,
    ownSessionId: GUEST_SESSION,
    ownGeneration: GUEST_GENERATION,
    now: NOW + 1_000,
    isCurrentLeaseOwner: true,
  });
  assert.equal(current.accepted, true);
  assert.equal(current.roomId, ROOM_ID);
  assert.equal(current.hostSessionId, HOST_SESSION);
  assert.equal(current.attemptId, ATTEMPT_ID);

  const decide = (candidate, overrides = {}) => (
    client.decideTrainingSessionOffer({
      offer: candidate,
      roomId: ROOM_ID,
      ownUid: GUEST_UID,
      ownSessionId: GUEST_SESSION,
      ownGeneration: GUEST_GENERATION,
      now: NOW + 1_000,
      isCurrentLeaseOwner: true,
      ...overrides,
    })
  );
  assert.equal(decide(offer({ expiresAt: NOW })).reason, "offer-expired");
  assert.equal(decide(offer({ toUid: HOST_UID })).reason, "offer-member-mismatch");
  assert.equal(decide(offer({
    sessions: {
      ...room().sessions,
      [GUEST_UID]: {
        sessionId: GUEST_SESSION,
        generation: HOST_GENERATION,
      },
    },
  })).reason, "offer-session-fence-mismatch");
  assert.equal(decide(offer(), {
    isCurrentLeaseOwner: false,
  }).reason, "session-lease-not-owned");
});

test("training signal envelopes enforce both session and room-attempt fences", () => {
  const envelope = signalEnvelope();
  assert.equal(Object.isFrozen(envelope), true);
  const current = signalDecision(envelope);
  assert.equal(current.accepted, true);
  assert.equal(current.consume, "after-success");
  assert.equal(
    client.shouldConsumeTrainingSessionSignal(current, {
      handledSuccessfully: true,
      contextStillCurrent: true,
    }),
    true,
  );
  assert.equal(
    client.shouldConsumeTrainingSessionSignal(current, {
      handledSuccessfully: false,
      contextStillCurrent: true,
    }),
    false,
  );
  assert.equal(
    signalDecision({ ...envelope, signalingVersion: 1 }).reason,
    "signal-signaling-version-unsupported",
  );
  assert.equal(
    signalDecision({ ...envelope, attemptId: "other-attempt-token-123" }).reason,
    "signal-attempt-mismatch",
  );
  assert.equal(
    signalDecision({ ...envelope, fromUid: "another-player" }).reason,
    "signal-member-mismatch",
  );
  assert.equal(
    signalDecision({
      ...envelope,
      connectionGeneration: "other-connection-token-123",
    }).reason,
    "signal-connection-generation-mismatch",
  );
  assert.equal(
    signalDecision(envelope, { isCurrentLeaseOwner: false }).reason,
    "session-lease-not-owned",
  );
  assert.equal(
    signalDecision({ ...envelope, createdAt: NOW - 60_001 }).reason,
    "signal-stale",
  );
});

test("presence payload is scoped to the exact session claim", () => {
  const presence = client.createTrainingSessionPresencePayload({
    sessionId: HOST_SESSION,
    leaseToken: HOST_LEASE,
    generation: HOST_GENERATION,
    online: true,
    updatedAt: NOW,
  });
  assert.deepEqual(presence, {
    protocolVersion: 2,
    sessionId: HOST_SESSION,
    leaseToken: HOST_LEASE,
    generation: HOST_GENERATION,
    online: true,
    updatedAt: NOW,
  });
  assert.equal(Object.isFrozen(presence), true);
});

test("recovery adapter restarts once, aborts stale transport, then requeues once", () => {
  let recovery = client.createTrainingSessionRecovery({
    matchmakingGeneration: CONNECTION_GENERATION,
    roomId: ROOM_ID,
    sessionId: HOST_SESSION,
    isHost: true,
    opponentUid: GUEST_UID,
    startedAt: NOW,
    config: {
      connectionTimeoutMs: 100,
      disconnectedGraceMs: 50,
      restartTimeoutMs: 75,
      opponentCooldownMs: 1_000,
    },
  });
  const generationToken = recovery.generationToken;
  let timer = client.trainingSessionRecoveryTimer(recovery);
  let result = client.decideTrainingSessionRecovery(recovery, {
    type: "TIMER_EXPIRED",
    generationToken,
    timerToken: timer.timerToken,
    now: timer.deadlineAt,
  });
  assert.equal(result.decision.restartIce, true);
  assert.equal(result.decision.abortRoom, false);

  recovery = result.state;
  timer = client.trainingSessionRecoveryTimer(recovery);
  result = client.decideTrainingSessionRecovery(recovery, {
    type: "TIMER_EXPIRED",
    generationToken,
    timerToken: timer.timerToken,
    now: timer.deadlineAt,
  });
  assert.equal(result.decision.abortRoom, true);
  assert.equal(result.decision.opponentCooldown.opponentUid, GUEST_UID);

  recovery = result.state;
  result = client.decideTrainingSessionRecovery(recovery, {
    type: "CLEANUP_COMPLETED",
    generationToken,
    now: NOW + 500,
  });
  assert.equal(result.decision.autoRequeue, true);
  assert.equal(result.decision.autoRequeueCount, 1);
  assert.equal(result.decision.showConnectionFailure, false);
});

test("recovery never auto-requeues an established match or destroys a final result", () => {
  let recovery = client.createTrainingSessionRecovery({
    matchmakingGeneration: CONNECTION_GENERATION,
    roomId: ROOM_ID,
    sessionId: HOST_SESSION,
    isHost: true,
    opponentUid: GUEST_UID,
    startedAt: NOW,
  });
  const generationToken = recovery.generationToken;
  recovery = client.decideTrainingSessionRecovery(recovery, {
    type: "CHANNEL_OPENED",
    generationToken,
    now: NOW + 1,
  }).state;
  recovery = client.decideTrainingSessionRecovery(recovery, {
    type: "ICE_FAILED",
    generationToken,
    now: NOW + 2,
  }).state;
  const timer = client.trainingSessionRecoveryTimer(recovery);
  recovery = client.decideTrainingSessionRecovery(recovery, {
    type: "TIMER_EXPIRED",
    generationToken,
    timerToken: timer.timerToken,
    now: timer.deadlineAt,
  }).state;
  const completed = client.decideTrainingSessionRecovery(recovery, {
    type: "CLEANUP_COMPLETED",
    generationToken,
    now: NOW + 30_000,
  });
  assert.equal(completed.decision.autoRequeue, false);
  assert.equal(completed.decision.showConnectionFailure, true);
  assert.equal(completed.decision.reason, "connection-was-established");

  const preserved = client.decideTrainingSessionRecovery(recovery, {
    type: "CLEANUP_COMPLETED",
    generationToken,
    now: NOW + 30_000,
  }, { hasFinalResult: true });
  assert.equal(preserved.decision.preserveResult, true);
  assert.equal(preserved.decision.abortRoom, false);
  assert.equal(preserved.effects.length, 0);
  assert.equal(preserved.state, recovery);
});

test("recovery ignores callbacks captured by a replaced generation", () => {
  const recovery = client.createTrainingSessionRecovery({
    matchmakingGeneration: CONNECTION_GENERATION,
    roomId: ROOM_ID,
    sessionId: HOST_SESSION,
    isHost: true,
    opponentUid: GUEST_UID,
    startedAt: NOW,
  });
  const stale = client.createTrainingSessionRecovery({
    matchmakingGeneration: "replacement-generation-token",
    roomId: ROOM_ID,
    sessionId: HOST_SESSION,
    isHost: true,
    opponentUid: GUEST_UID,
    startedAt: NOW,
  });
  const result = client.decideTrainingSessionRecovery(recovery, {
    type: "ICE_FAILED",
    generationToken: stale.generationToken,
    now: NOW + 1,
  });
  assert.equal(result.ignored, true);
  assert.equal(result.effects.length, 0);
  assert.equal(result.decision.reason, "event-ignored");
});

test("replacement channels resend only images without the opponent RTDB receipt", () => {
  assert.deepEqual(
    client.trainingImageRoundsNeedingResend({
      outgoingRoundIndexes: [3, 1, 2, 2, 0, 6],
      opponentUid: GUEST_UID,
      rounds: {
        1: { imageReceived: { [GUEST_UID]: true } },
        2: { imageReceived: { [HOST_UID]: true } },
        3: { imageReceived: {} },
      },
    }),
    [2, 3],
  );
  assert.deepEqual(
    client.trainingImageRoundsNeedingResend({
      outgoingRoundIndexes: [1],
      opponentUid: "",
      rounds: {},
    }),
    [],
  );
});
