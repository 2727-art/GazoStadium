const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const sessionGuardModule = import(
  pathToFileURL(path.join(root, "online-session-guard.mjs")).href
);

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GENERATION_A = "generation_A_123";
const GENERATION_B = "generation_B_456";

async function makeFence(overrides = {}) {
  const { createOnlineSessionFence } = await sessionGuardModule;
  return createOnlineSessionFence({
    sessionId: overrides.sessionId ?? SESSION_A,
    leaseToken: overrides.leaseToken ?? TOKEN_A,
    connectionGeneration: overrides.connectionGeneration ?? GENERATION_A,
  });
}

async function claimLease(overrides = {}) {
  const { decideOnlineSessionLease } = await sessionGuardModule;
  return decideOnlineSessionLease({
    currentLease: overrides.currentLease ?? null,
    sessionId: overrides.sessionId ?? SESSION_A,
    leaseToken: overrides.leaseToken ?? TOKEN_A,
    now: overrides.now ?? 1_000,
    ttlMs: overrides.ttlMs ?? 90,
    sameSessionOwnerConfirmedGone:
      overrides.sameSessionOwnerConfirmedGone ?? false,
  });
}

function v2Signal(overrides = {}) {
  return {
    protocolVersion: 2,
    fromSessionId: overrides.fromSessionId ?? SESSION_B,
    toSessionId: overrides.toSessionId ?? SESSION_A,
    connectionGeneration:
      overrides.connectionGeneration ?? GENERATION_A,
    fromUid: "remote-uid",
    type: "offer",
    payload: "{}",
  };
}

function signalContext(overrides = {}) {
  return {
    ownSessionId: overrides.ownSessionId ?? SESSION_A,
    remoteSessionId: hasOwn(overrides, "remoteSessionId")
      ? overrides.remoteSessionId
      : SESSION_B,
    connectionGeneration:
      overrides.connectionGeneration ?? GENERATION_A,
    isCurrentLeaseOwner: overrides.isCurrentLeaseOwner ?? true,
    allowLegacy: overrides.allowLegacy ?? false,
    legacyRoomVerifiedCurrent:
      overrides.legacyRoomVerifiedCurrent ?? false,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

test("a valid per-tab session id is reused and an invalid stored value is replaced", async () => {
  const {
    isValidOnlineSessionId,
    resolveOnlineSessionId,
  } = await sessionGuardModule;

  assert.equal(isValidOnlineSessionId(SESSION_A), true);
  assert.equal(
    isValidOnlineSessionId("abcdefab-cdef-4abc-8def-abcdefabcdef"),
    true,
  );
  assert.equal(
    isValidOnlineSessionId("ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"),
    false,
  );
  assert.equal(
    isValidOnlineSessionId("0123456789abcdef0123456789abcdef"),
    true,
  );
  assert.equal(
    isValidOnlineSessionId("0123456789ABCDEF0123456789ABCDEF"),
    false,
  );
  assert.equal(isValidOnlineSessionId("not-a-session"), false);

  assert.deepEqual(resolveOnlineSessionId({
    storedSessionId: SESSION_A,
    generatedSessionId: SESSION_B,
  }), {
    sessionId: SESSION_A,
    source: "stored",
    shouldPersist: false,
  });
  assert.deepEqual(resolveOnlineSessionId({
    storedSessionId: "corrupt",
    generatedSessionId: SESSION_B,
  }), {
    sessionId: SESSION_B,
    source: "generated",
    shouldPersist: true,
  });
  assert.throws(
    () => resolveOnlineSessionId({
      storedSessionId: null,
      generatedSessionId: "predictable",
    }),
    /generatedSessionId/,
  );
});

test("session, lease, and probe tokens use getRandomValues without randomUUID", async () => {
  const {
    createOnlineSessionToken,
    isValidOnlineSessionId,
  } = await sessionGuardModule;
  let calls = 0;
  const cryptoProvider = {
    getRandomValues(bytes) {
      calls += 1;
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    },
    randomUUID() {
      throw new Error("randomUUID must not be used");
    },
  };

  const token = createOnlineSessionToken(cryptoProvider);
  assert.equal(token, "000102030405060708090a0b0c0d0e0f");
  assert.equal(isValidOnlineSessionId(token), true);
  assert.equal(calls, 1);
  assert.throws(
    () => createOnlineSessionToken({}),
    /getRandomValues/,
  );
});

test("resource fences validate session, page instance, and generation", async () => {
  const {
    createOnlineSessionFence,
    isValidOnlineConnectionGeneration,
  } = await sessionGuardModule;

  assert.equal(isValidOnlineConnectionGeneration(1), true);
  assert.equal(isValidOnlineConnectionGeneration("1"), false);
  assert.equal(isValidOnlineConnectionGeneration(GENERATION_A), true);
  assert.equal(isValidOnlineConnectionGeneration("short"), false);
  assert.deepEqual(await makeFence(), {
    protocolVersion: 2,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    connectionGeneration: GENERATION_A,
  });
  assert.throws(
    () => createOnlineSessionFence({
      sessionId: SESSION_A,
      leaseToken: "bad",
      connectionGeneration: GENERATION_A,
    }),
    /leaseToken/,
  );
});

test("a missing lease is claimed and its exact owner can refresh it", async () => {
  const claimed = await claimLease();
  assert.equal(claimed.action, "claim");
  assert.equal(claimed.allowed, true);
  assert.deepEqual(claimed.lease, {
    protocolVersion: 2,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    claimedAt: 1_000,
    heartbeatAt: 1_000,
    expiresAt: 1_090,
  });

  const refreshed = await claimLease({
    currentLease: claimed.lease,
    now: 1_020,
  });
  assert.equal(refreshed.action, "refresh");
  assert.equal(refreshed.lease.claimedAt, 1_000);
  assert.equal(refreshed.lease.heartbeatAt, 1_020);
  assert.equal(refreshed.lease.expiresAt, 1_110);
});

test("fresh leases from other sessions or page instances are not overwritten", async () => {
  const claimed = await claimLease();
  const otherSession = await claimLease({
    currentLease: claimed.lease,
    sessionId: SESSION_B,
    leaseToken: TOKEN_B,
    now: 1_010,
  });
  assert.deepEqual(otherSession, {
    action: "block",
    allowed: false,
    reason: "another-session-holds-lease",
    lease: null,
  });

  const duplicatedSession = await claimLease({
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    now: 1_010,
  });
  assert.equal(duplicatedSession.action, "block");
  assert.equal(
    duplicatedSession.reason,
    "same-session-owned-by-another-page",
  );
});

test("same-session takeover requires an explicit positive liveness result", async () => {
  const claimed = await claimLease();
  const takeover = await claimLease({
    currentLease: claimed.lease,
    leaseToken: TOKEN_B,
    now: 1_010,
    sameSessionOwnerConfirmedGone: true,
  });

  assert.equal(takeover.action, "takeover");
  assert.equal(takeover.lease.sessionId, SESSION_A);
  assert.equal(takeover.lease.leaseToken, TOKEN_B);
  assert.equal(takeover.lease.claimedAt, 1_010);
});

test("expired leases can be reclaimed but malformed fresh leases fail closed", async () => {
  const claimed = await claimLease();
  const expired = await claimLease({
    currentLease: claimed.lease,
    sessionId: SESSION_B,
    leaseToken: TOKEN_B,
    now: 1_090,
  });
  assert.equal(expired.action, "claim");
  assert.equal(expired.reason, "lease-expired");
  assert.equal(expired.lease.sessionId, SESSION_B);

  const malformedFresh = await claimLease({
    currentLease: { expiresAt: 2_000, unexpected: true },
    now: 1_100,
  });
  assert.equal(malformedFresh.action, "block");
  assert.equal(
    malformedFresh.reason,
    "malformed-lease-not-provably-expired",
  );

  const malformedExpired = await claimLease({
    currentLease: { expiresAt: 1_099, unexpected: true },
    now: 1_100,
  });
  assert.equal(malformedExpired.action, "claim");
  assert.equal(malformedExpired.reason, "malformed-lease-expired");
});

test("heartbeat decisions detect due, expired, and stolen leases", async () => {
  const { getOnlineSessionHeartbeatDecision } = await sessionGuardModule;
  const claimed = await claimLease({ ttlMs: 100 });

  assert.deepEqual(getOnlineSessionHeartbeatDecision({
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    now: 1_019,
    heartbeatIntervalMs: 20,
  }), {
    action: "wait",
    due: false,
    reason: "heartbeat-not-due",
  });
  assert.equal(getOnlineSessionHeartbeatDecision({
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    now: 1_020,
    heartbeatIntervalMs: 20,
  }).due, true);
  assert.equal(getOnlineSessionHeartbeatDecision({
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    now: 1_100,
    heartbeatIntervalMs: 20,
  }).action, "reacquire");
  assert.equal(getOnlineSessionHeartbeatDecision({
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_B,
    now: 1_020,
    heartbeatIntervalMs: 20,
  }).action, "lost");
});

test("heartbeat results retry transient failures only until the known lease expiry", async () => {
  const { decideOnlineSessionHeartbeatResult } = await sessionGuardModule;
  const claimed = await claimLease({ ttlMs: 100 });
  const refreshed = await claimLease({
    currentLease: claimed.lease,
    now: 1_050,
    ttlMs: 100,
  });
  const base = {
    currentLease: claimed.lease,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    sessionGeneration: GENERATION_A,
    retryIntervalMs: 25,
  };

  assert.deepEqual(decideOnlineSessionHeartbeatResult({
    ...base,
    responseData: {
      claimed: true,
      sessionGeneration: GENERATION_A,
      lease: refreshed.lease,
    },
    now: 1_050,
  }), {
    action: "refresh",
    reason: "refreshed",
    lease: refreshed.lease,
    retryDelayMs: 0,
  });
  assert.deepEqual(decideOnlineSessionHeartbeatResult({
    ...base,
    responseData: null,
    now: 1_030,
  }), {
    action: "retry",
    reason: "heartbeat-transient",
    lease: claimed.lease,
    retryDelayMs: 25,
  });
  assert.equal(decideOnlineSessionHeartbeatResult({
    ...base,
    responseData: { claimed: false, reason: "occupied" },
    now: 1_030,
  }).action, "retry");
  assert.deepEqual(decideOnlineSessionHeartbeatResult({
    ...base,
    responseData: { claimed: false, reason: "lease-lost" },
    now: 1_010,
  }), {
    action: "lost",
    reason: "lease-lost",
    lease: null,
    retryDelayMs: 0,
  });
  assert.deepEqual(decideOnlineSessionHeartbeatResult({
    ...base,
    responseData: null,
    now: 1_100,
  }), {
    action: "lost",
    reason: "lease-expired",
    lease: null,
    retryDelayMs: 0,
  });
});

test("a delayed release cannot remove a refreshed or replacement lease", async () => {
  const {
    decideOnlineSessionLeaseRelease,
    isOnlineSessionLeaseOwner,
  } = await sessionGuardModule;
  const claimed = await claimLease();
  const refreshed = await claimLease({
    currentLease: claimed.lease,
    now: 1_020,
  });
  const replacement = await claimLease({
    currentLease: claimed.lease,
    leaseToken: TOKEN_B,
    now: 1_010,
    sameSessionOwnerConfirmedGone: true,
  });

  assert.equal(isOnlineSessionLeaseOwner(claimed.lease, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
  }), true);
  assert.equal(decideOnlineSessionLeaseRelease({
    currentLease: claimed.lease,
    expectedLease: claimed.lease,
  }).remove, true);
  assert.equal(decideOnlineSessionLeaseRelease({
    currentLease: refreshed.lease,
    expectedLease: claimed.lease,
  }).remove, false);
  assert.equal(decideOnlineSessionLeaseRelease({
    currentLease: replacement.lease,
    expectedLease: claimed.lease,
  }).remove, false);
});

test("queue cleanup removes only the exact V2 page and generation owner", async () => {
  const { decideOnlineQueueCleanup } = await sessionGuardModule;
  const fence = await makeFence();
  const queueEntry = {
    ...fence,
    uid: "player-a",
    lastSeen: 1_000,
  };

  assert.equal(decideOnlineQueueCleanup({
    queueEntry,
    fence,
  }).remove, true);
  assert.equal(decideOnlineQueueCleanup({
    queueEntry: { ...queueEntry, sessionId: SESSION_B },
    fence,
  }).remove, false);
  assert.equal(decideOnlineQueueCleanup({
    queueEntry: { ...queueEntry, leaseToken: TOKEN_B },
    fence,
  }).remove, false);
  assert.equal(decideOnlineQueueCleanup({
    queueEntry: { ...queueEntry, connectionGeneration: GENERATION_B },
    fence,
  }).remove, false);
});

test("legacy queue cleanup requires explicit staleness verification", async () => {
  const { decideOnlineQueueCleanup } = await sessionGuardModule;
  const fence = await makeFence();
  const legacy = { uid: "player-a", lastSeen: 1_000 };

  assert.equal(decideOnlineQueueCleanup({
    queueEntry: legacy,
    fence,
  }).remove, false);
  assert.equal(decideOnlineQueueCleanup({
    queueEntry: legacy,
    fence,
    legacyEntryVerifiedStale: true,
  }).remove, true);
  assert.equal(decideOnlineQueueCleanup({
    queueEntry: { ...legacy, sessionId: SESSION_A },
    fence,
    legacyEntryVerifiedStale: true,
  }).remove, false);
});

test("active cleanup fences both the room and the page generation", async () => {
  const { decideOnlineActiveCleanup } = await sessionGuardModule;
  const fence = await makeFence();
  const active = { roomId: "room_123", ...fence };

  assert.equal(decideOnlineActiveCleanup({
    activeEntry: active,
    expectedRoomId: "room_123",
    fence,
  }).remove, true);
  assert.equal(decideOnlineActiveCleanup({
    activeEntry: { ...active, roomId: "room_456" },
    expectedRoomId: "room_123",
    fence,
  }).remove, false);
  assert.equal(decideOnlineActiveCleanup({
    activeEntry: { ...active, connectionGeneration: GENERATION_B },
    expectedRoomId: "room_123",
    fence,
  }).remove, false);
});

test("legacy active strings require exact room identity and terminal verification", async () => {
  const { decideOnlineActiveCleanup } = await sessionGuardModule;
  const fence = await makeFence();

  assert.equal(decideOnlineActiveCleanup({
    activeEntry: "room_123",
    expectedRoomId: "room_123",
    fence,
  }).remove, false);
  assert.equal(decideOnlineActiveCleanup({
    activeEntry: "room_456",
    expectedRoomId: "room_123",
    fence,
    legacyRoomVerifiedTerminal: true,
  }).remove, false);
  assert.equal(decideOnlineActiveCleanup({
    activeEntry: "room_123",
    expectedRoomId: "room_123",
    fence,
    legacyRoomVerifiedTerminal: true,
  }).remove, true);
});

test("a current V2 signal is accepted and consumed only after safe handling", async () => {
  const {
    decideOnlineSignalEnvelope,
    shouldConsumeOnlineSignal,
  } = await sessionGuardModule;
  const decision = decideOnlineSignalEnvelope({
    envelope: v2Signal(),
    ...signalContext(),
  });

  assert.deepEqual(decision, {
    action: "accept",
    accepted: true,
    ignored: false,
    consume: "after-success",
    reason: "signal-v2-current",
    protocol: "v2",
    remoteSessionId: SESSION_B,
  });
  assert.equal(shouldConsumeOnlineSignal(decision, {
    handledSuccessfully: false,
    contextStillCurrent: true,
  }), false);
  assert.equal(shouldConsumeOnlineSignal(decision, {
    handledSuccessfully: true,
    contextStillCurrent: false,
  }), false);
  assert.equal(shouldConsumeOnlineSignal(decision, {
    handledSuccessfully: true,
    contextStillCurrent: true,
  }), true);
});

test("mismatched V2 signals are ignored and never consumed", async (t) => {
  const {
    decideOnlineSignalEnvelope,
    shouldConsumeOnlineSignal,
  } = await sessionGuardModule;
  const cases = [
    {
      name: "target session",
      envelope: v2Signal({ toSessionId: SESSION_B }),
      context: signalContext(),
      reason: "signal-target-session-mismatch",
    },
    {
      name: "source session",
      envelope: v2Signal({ fromSessionId: TOKEN_B }),
      context: signalContext(),
      reason: "signal-source-session-mismatch",
    },
    {
      name: "connection generation",
      envelope: v2Signal({ connectionGeneration: GENERATION_B }),
      context: signalContext(),
      reason: "signal-connection-generation-mismatch",
    },
    {
      name: "lost lease",
      envelope: v2Signal(),
      context: signalContext({ isCurrentLeaseOwner: false }),
      reason: "session-lease-not-owned",
    },
  ];

  for (const current of cases) {
    await t.test(current.name, () => {
      const decision = decideOnlineSignalEnvelope({
        envelope: current.envelope,
        ...current.context,
      });
      assert.equal(decision.action, "ignore");
      assert.equal(decision.consume, "never");
      assert.equal(decision.reason, current.reason);
      assert.equal(shouldConsumeOnlineSignal(decision, {
        handledSuccessfully: true,
        contextStillCurrent: true,
      }), false);
    });
  }
});

test("the first valid V2 signal can safely pin a remote session", async () => {
  const { decideOnlineSignalEnvelope } = await sessionGuardModule;
  const decision = decideOnlineSignalEnvelope({
    envelope: v2Signal(),
    ...signalContext({ remoteSessionId: null }),
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.remoteSessionId, SESSION_B);
});

test("legacy signals require explicit compatibility and current-room checks", async () => {
  const {
    decideOnlineSignalEnvelope,
    shouldConsumeOnlineSignal,
  } = await sessionGuardModule;
  const legacy = {
    fromUid: "remote-uid",
    type: "offer",
    payload: "{}",
    createdAt: 1_000,
  };

  const denied = decideOnlineSignalEnvelope({
    envelope: legacy,
    ...signalContext(),
  });
  assert.equal(denied.accepted, false);
  assert.equal(denied.consume, "never");

  const allowed = decideOnlineSignalEnvelope({
    envelope: legacy,
    ...signalContext({
      allowLegacy: true,
      legacyRoomVerifiedCurrent: true,
    }),
  });
  assert.equal(allowed.accepted, true);
  assert.equal(allowed.protocol, "legacy");
  assert.equal(shouldConsumeOnlineSignal(allowed, {
    handledSuccessfully: true,
    contextStillCurrent: true,
  }), true);
});

test("partial or unsupported signal scoping fails closed without consumption", async () => {
  const { decideOnlineSignalEnvelope } = await sessionGuardModule;
  const partial = decideOnlineSignalEnvelope({
    envelope: {
      fromUid: "remote-uid",
      fromSessionId: SESSION_B,
      type: "candidate",
    },
    ...signalContext({
      allowLegacy: true,
      legacyRoomVerifiedCurrent: true,
    }),
  });
  assert.equal(partial.reason, "signal-unversioned-scope-fields");
  assert.equal(partial.consume, "never");

  const unsupported = decideOnlineSignalEnvelope({
    envelope: {
      ...v2Signal(),
      protocolVersion: 3,
    },
    ...signalContext(),
  });
  assert.equal(unsupported.reason, "signal-protocol-unsupported");
  assert.equal(unsupported.consume, "never");
});
