"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOLO_SESSION_LEASE_TTL_MS,
  buildSoloSessionV2Resources,
  claimDecision,
  decideSoloRoomTransition,
  flattenFreshQueueV2,
  heartbeatDecision,
  materializationFenceMatches,
  publicClaimLease,
  replacedClaimResourceFence,
  resourceFenceMatches,
  roomMatchesSessionV2,
  selectSoloSessionV2Match,
} = require("../solo-session-v2");

const NOW = 1_800_000_000_000;
const SESSION_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SESSION_C = "cccccccccccccccccccccccccccccccc";
const TOKEN_A = "11111111111111111111111111111111";
const TOKEN_B = "22222222222222222222222222222222";
const TOKEN_C = "33333333333333333333333333333333";
const GENERATION_A = "generation_A_123456789";
const GENERATION_B = "generation_B_123456789";
const GENERATION_C = "generation_C_123456789";
const ATTEMPT = "attempt_1234567890123";
const CONNECTION = "connection_1234567890";
const ROOM_ID = "-AbCdEfGhIjKlMnOpQrS";

function claim(sessionId, leaseToken, generation, overrides = {}) {
  return {
    protocolVersion: 2,
    sessionId,
    leaseToken,
    generation,
    claimedAt: NOW - 10_000,
    heartbeatAt: NOW - 5_000,
    expiresAt: NOW + 50_000,
    ...overrides,
  };
}

function queue(uid, sessionId, leaseToken, generation, overrides = {}) {
  return {
    protocolVersion: 2,
    uid,
    sessionId,
    leaseToken,
    generation,
    connectionGeneration: 1,
    name: uid.toUpperCase(),
    pursuitLine: "よろしくお願いします",
    streak: 0,
    rating: 1000,
    ratingPreference: "both",
    allowPreferenceMismatch: false,
    reunionPreference: false,
    sampleCount: 0,
    startingHp: 30,
    joinedAt: NOW - 10_000,
    lastSeen: NOW - 1_000,
    expiresAt: NOW + 50_000,
    state: "waiting",
    ...overrides,
  };
}

test("claim is fenced by page token and returns generation outside the public lease", () => {
  const first = claimDecision({
    currentClaim: null,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
    now: NOW,
  });
  assert.equal(first.allowed, true);
  assert.equal(first.claim.expiresAt, NOW + SOLO_SESSION_LEASE_TTL_MS);
  assert.equal(first.claim.generation, GENERATION_A);
  const lease = publicClaimLease(first.claim);
  assert.equal(lease.sessionId, SESSION_A);
  assert.equal(Object.hasOwn(lease, "generation"), false);

  const blocked = claimDecision({
    currentClaim: first.claim,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    generation: GENERATION_B,
    now: NOW + 1,
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reason: "same-session-owned",
    claim: null,
  });

  const takeover = claimDecision({
    currentClaim: first.claim,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    generation: GENERATION_B,
    now: NOW + 1,
    sameSessionOwnerConfirmedGone: true,
  });
  assert.equal(takeover.allowed, true);
  assert.equal(takeover.reason, "same-session-takeover");
  assert.equal(takeover.claim.generation, GENERATION_B);
});

test("claim replacement rotates generation and exposes only the exact prior resource fence", () => {
  const fresh = claim(SESSION_A, TOKEN_A, GENERATION_A);
  const refreshed = claimDecision({
    currentClaim: fresh,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_B,
    now: NOW,
  });
  assert.equal(refreshed.reason, "refreshed");
  assert.equal(refreshed.claim.generation, GENERATION_A);
  assert.equal(replacedClaimResourceFence(fresh, refreshed.claim), null);

  const expired = claim(SESSION_A, TOKEN_A, GENERATION_A, {
    heartbeatAt: NOW - 1_000,
    expiresAt: NOW,
  });
  const reclaimed = claimDecision({
    currentClaim: expired,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_B,
    now: NOW,
  });
  assert.equal(reclaimed.reason, "reclaimed");
  assert.equal(reclaimed.claim.generation, GENERATION_B);
  assert.equal(reclaimed.claim.claimedAt, NOW);
  const reclaimedFence = replacedClaimResourceFence(expired, reclaimed.claim);
  assert.deepEqual(reclaimedFence, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
  });
  assert.equal(
    resourceFenceMatches(
      queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
      reclaimedFence,
    ),
    true,
  );
  assert.equal(
    resourceFenceMatches(
      queue("alice", SESSION_A, TOKEN_A, GENERATION_B),
      reclaimedFence,
    ),
    false,
  );

  const takeover = claimDecision({
    currentClaim: fresh,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    generation: GENERATION_B,
    now: NOW,
    sameSessionOwnerConfirmedGone: true,
  });
  assert.deepEqual(replacedClaimResourceFence(fresh, takeover.claim), {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
  });

  const replacement = claimDecision({
    currentClaim: expired,
    sessionId: SESSION_B,
    leaseToken: TOKEN_B,
    generation: GENERATION_B,
    now: NOW,
  });
  assert.equal(replacement.reason, "expired-replaced");
  assert.deepEqual(replacedClaimResourceFence(expired, replacement.claim), {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
  });
});

test("heartbeat refreshes only the exact current owner", () => {
  const current = claim(SESSION_A, TOKEN_A, GENERATION_A);
  const refreshed = heartbeatDecision({
    currentClaim: current,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
    now: NOW,
  });
  assert.equal(refreshed.allowed, true);
  assert.equal(refreshed.claim.generation, GENERATION_A);
  assert.equal(refreshed.claim.expiresAt, NOW + SOLO_SESSION_LEASE_TTL_MS);
  assert.equal(heartbeatDecision({
    currentClaim: current,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    generation: GENERATION_A,
    now: NOW,
  }).allowed, false);
  assert.equal(heartbeatDecision({
    currentClaim: current,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_B,
    now: NOW,
  }).allowed, false);
  assert.deepEqual(heartbeatDecision({
    currentClaim: claim(SESSION_A, TOKEN_A, GENERATION_A, {
      heartbeatAt: NOW - 1_000,
      expiresAt: NOW,
    }),
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
    now: NOW,
  }), {
    allowed: false,
    reason: "lease-expired",
    claim: null,
  });
});

test("room transition serializes accept against cancel and expire", () => {
  const resources = buildSoloSessionV2Resources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
    connectionGeneration: CONNECTION,
    host: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    guest: queue("bob", SESSION_B, TOKEN_B, GENERATION_B),
    now: NOW,
  });
  const acceptToken = "accept_transition_123456789";
  const cancelToken = "cancel_transition_123456789";
  const accepted = decideSoloRoomTransition({
    room: resources.room,
    expected: resources.room,
    action: "accept",
    token: acceptToken,
    now: NOW,
  });
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.room.matchTransition.token, acceptToken);
  assert.equal(decideSoloRoomTransition({
    room: accepted.room,
    expected: resources.room,
    action: "cancel",
    token: cancelToken,
    now: NOW + 1,
  }).reason, "transition-busy");
  assert.equal(decideSoloRoomTransition({
    room: accepted.room,
    expected: resources.room,
    action: "expire",
    token: cancelToken,
    now: NOW + 1,
  }).reason, "transition-busy");
});

test("expire never destroys active rooms and active cancel requires explicit permission", () => {
  const resources = buildSoloSessionV2Resources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
    connectionGeneration: CONNECTION,
    host: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    guest: queue("bob", SESSION_B, TOKEN_B, GENERATION_B),
    now: NOW,
  });
  const activeRoom = { ...resources.room, status: "active" };
  const token = "cancel_transition_123456789";
  assert.equal(decideSoloRoomTransition({
    room: activeRoom,
    expected: resources.room,
    action: "expire",
    token,
    now: NOW,
  }).reason, "active");
  assert.equal(decideSoloRoomTransition({
    room: activeRoom,
    expected: resources.room,
    action: "cancel",
    token,
    now: NOW,
  }).reason, "active");
  assert.equal(decideSoloRoomTransition({
    room: activeRoom,
    expected: resources.room,
    action: "cancel",
    token,
    now: NOW,
    allowActiveCancel: true,
  }).allowed, true);
  assert.equal(decideSoloRoomTransition({
    room: {
      ...activeRoom,
      destroyed: { by: "alice", at: NOW },
    },
    expected: resources.room,
    action: "cancel",
    token,
    now: NOW,
    allowActiveCancel: true,
  }).allowed, true);
});

test("a stale transition can be safely replaced while a fresh one remains exclusive", () => {
  const resources = buildSoloSessionV2Resources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
    connectionGeneration: CONNECTION,
    host: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    guest: queue("bob", SESSION_B, TOKEN_B, GENERATION_B),
    now: NOW,
  });
  const staleRoom = {
    ...resources.room,
    matchTransition: {
      action: "accept",
      token: "old_transition_token_1234",
      startedAt: NOW - 31_000,
    },
  };
  const result = decideSoloRoomTransition({
    room: staleRoom,
    expected: resources.room,
    action: "cancel",
    token: "new_transition_token_1234",
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "acquired-after-stale");
  assert.equal(result.room.matchTransition.action, "cancel");
});

test("queue selection accepts only a fresh row matching the fresh server claim", () => {
  const queueV2 = {
    alice: {
      [SESSION_A]: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    },
    bob: {
      [SESSION_B]: queue("bob", SESSION_B, TOKEN_B, GENERATION_B),
    },
    stale: {
      [SESSION_C]: queue("stale", SESSION_C, TOKEN_C, GENERATION_C),
    },
  };
  const claims = {
    alice: claim(SESSION_A, TOKEN_A, GENERATION_A),
    bob: claim(SESSION_B, TOKEN_B, GENERATION_B),
    stale: claim(SESSION_C, TOKEN_C, "replaced_generation_12"),
  };
  assert.deepEqual(
    Object.keys(flattenFreshQueueV2(queueV2, claims, NOW)).sort(),
    ["alice", "bob"],
  );
});

test("soft avoid skips the previous opponent only when another compatible player exists", () => {
  const entries = {
    alice: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    bob: queue("bob", SESSION_B, TOKEN_B, GENERATION_B, { joinedAt: NOW - 20_000 }),
    carol: queue("carol", SESSION_C, TOKEN_C, GENERATION_C, { joinedAt: NOW - 5_000 }),
  };
  const alternative = selectSoloSessionV2Match({
    requesterUid: "alice",
    queue: entries,
    avoidUid: "bob",
    now: NOW,
  });
  assert.equal(alternative.candidate.uid, "carol");

  const fallback = selectSoloSessionV2Match({
    requesterUid: "alice",
    queue: { alice: entries.alice, bob: entries.bob },
    avoidUid: "bob",
    now: NOW,
  });
  assert.equal(fallback.candidate.uid, "bob");
});

test("V2 room, permit, offer, lock and active records carry immutable session fences", () => {
  const host = queue("alice", SESSION_A, TOKEN_A, GENERATION_A);
  const guest = queue("bob", SESSION_B, TOKEN_B, GENERATION_B);
  const resources = buildSoloSessionV2Resources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
    connectionGeneration: CONNECTION,
    host,
    guest,
    now: NOW,
  });
  for (const record of [resources.room, resources.permit, resources.offer]) {
    assert.equal(record.protocolVersion, 2);
    assert.equal(record.signalingVersion, 2);
    assert.equal(record.attemptId, ATTEMPT);
    assert.equal(record.connectionGeneration, CONNECTION);
    assert.deepEqual(record.sessions, {
      alice: { sessionId: SESSION_A, generation: GENERATION_A },
      bob: { sessionId: SESSION_B, generation: GENERATION_B },
    });
  }
  assert.equal(resources.hostActive.role, "host");
  assert.equal(resources.guestActive.role, "guest");
  assert.equal(resources.hostLock.generation, GENERATION_A);
  assert.equal(resources.guestLock.generation, GENERATION_B);
});

test("session B cannot recover session A's room", () => {
  const resources = buildSoloSessionV2Resources({
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
    connectionGeneration: CONNECTION,
    host: queue("alice", SESSION_A, TOKEN_A, GENERATION_A),
    guest: queue("bob", SESSION_B, TOKEN_B, GENERATION_B),
    now: NOW,
  });
  assert.equal(roomMatchesSessionV2(resources.room, {
    uid: "alice",
    sessionId: SESSION_A,
    generation: GENERATION_A,
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
  }), true);
  assert.equal(roomMatchesSessionV2(resources.room, {
    uid: "alice",
    sessionId: SESSION_B,
    generation: GENERATION_B,
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
  }), false);
});

test("claim or queue switch fails the final materialization fence", () => {
  const hostQueue = queue("alice", SESSION_A, TOKEN_A, GENERATION_A, {
    state: "offering",
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
  });
  const guestQueue = queue("bob", SESSION_B, TOKEN_B, GENERATION_B, {
    state: "reserved",
    roomId: ROOM_ID,
    attemptId: ATTEMPT,
  });
  const base = {
    hostClaim: claim(SESSION_A, TOKEN_A, GENERATION_A),
    guestClaim: claim(SESSION_B, TOKEN_B, GENERATION_B),
    hostQueue,
    guestQueue,
    hostLock: {
      attemptId: ATTEMPT,
      roomId: ROOM_ID,
      sessionId: SESSION_A,
      generation: GENERATION_A,
      expiresAt: NOW + 50_000,
    },
    guestLock: {
      attemptId: ATTEMPT,
      roomId: ROOM_ID,
      sessionId: SESSION_B,
      generation: GENERATION_B,
      expiresAt: NOW + 50_000,
    },
    attemptId: ATTEMPT,
    now: NOW,
  };
  assert.equal(materializationFenceMatches(base), true);
  assert.equal(materializationFenceMatches({
    ...base,
    guestClaim: claim(SESSION_C, TOKEN_C, GENERATION_C),
  }), false);
  assert.equal(materializationFenceMatches({
    ...base,
    guestQueue: { ...guestQueue, generation: GENERATION_C },
  }), false);
  assert.equal(materializationFenceMatches({
    ...base,
    guestQueue: {
      ...guestQueue,
      state: "waiting",
      roomId: undefined,
      attemptId: undefined,
    },
  }), false);
});

test("resource cleanup fences require the exact session, token and generation", () => {
  const resource = queue("alice", SESSION_A, TOKEN_A, GENERATION_A);
  assert.equal(resourceFenceMatches(resource, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
  }), true);
  assert.equal(resourceFenceMatches(resource, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_B,
  }), false);
});
