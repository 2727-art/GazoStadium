"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source slice: ${startMarker}`);
  return source.slice(start, end);
}

function snapshotOf(value) {
  return {
    val: () => value,
    exists: () => value != null,
    child: (childPath) => {
      const childValue = String(childPath)
        .split("/")
        .filter(Boolean)
        .reduce((current, key) => current?.[key], value);
      return snapshotOf(childValue ?? null);
    },
  };
}

function coldTransactionRef(serverValue) {
  const inputs = [];
  let finalValue = serverValue;
  return {
    inputs,
    get finalValue() {
      return finalValue;
    },
    transaction: async (updateValue) => {
      inputs.push(null);
      const coldOutput = updateValue(null);
      assert.equal(coldOutput, null);
      if (serverValue == null) {
        finalValue = null;
        return { committed: true, snapshot: snapshotOf(null) };
      }
      inputs.push(serverValue);
      const serverOutput = updateValue(serverValue);
      const committed = serverOutput !== undefined;
      finalValue = committed ? serverOutput : serverValue;
      return { committed, snapshot: snapshotOf(finalValue) };
    },
  };
}

function cachedTransactionRef({ cachedValue, serverValue }) {
  const inputs = [];
  let finalValue = serverValue;
  const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  return {
    inputs,
    get finalValue() {
      return finalValue;
    },
    transaction: async (updateValue) => {
      inputs.push(cachedValue);
      const cachedOutput = updateValue(cachedValue);
      if (cachedOutput === undefined) {
        return { committed: false, snapshot: snapshotOf(cachedValue ?? null) };
      }
      if (sameValue(cachedValue, serverValue)) {
        finalValue = cachedOutput;
        return { committed: true, snapshot: snapshotOf(finalValue) };
      }
      inputs.push(serverValue);
      const serverOutput = updateValue(serverValue);
      const committed = serverOutput !== undefined;
      finalValue = committed ? serverOutput : serverValue;
      return { committed, snapshot: snapshotOf(finalValue ?? null) };
    },
  };
}

test("queue reservation retries a cold null without weakening its fence", async () => {
  const { resourceFenceMatches } = require("../solo-session-v2");
  const reserveSource = sourceBetween(
    "async function reserveSoloSessionV2Queue",
    "async function restoreSoloSessionV2Queue",
  );
  const now = 1_780_000_000_000;
  const entry = {
    protocolVersion: 2,
    uid: "host-user",
    sessionId: "host-session-1234567890",
    leaseToken: "host-lease-123456789012",
    generation: "host-generation-123456",
    state: "waiting",
    joinedAt: now - 5_000,
    lastSeen: now - 1_000,
    expiresAt: now + 30_000,
  };
  const resources = {
    hostLock: {
      roomId: "room-token-1234567890",
      attemptId: "attempt-token-1234567890",
    },
    permit: { expiresAt: now + 45_000 },
  };

  const runReservation = async (serverValue, role) => {
    const reference = coldTransactionRef(serverValue);
    const context = {
      Date: { now: () => now },
      resourceFenceMatches,
      soloSessionQueueRef: () => reference,
    };
    vm.createContext(context);
    vm.runInContext(
      `${reserveSource}
this.reserveSoloSessionV2Queue = reserveSoloSessionV2Queue;`,
      context,
    );
    return {
      reference,
      result: await context.reserveSoloSessionV2Queue(entry, resources, role),
    };
  };

  for (const [role, expectedState] of [
    ["host", "offering"],
    ["guest", "reserved"],
  ]) {
    const exact = await runReservation(entry, role);
    assert.equal(exact.reference.inputs.length, 2);
    assert.equal(exact.result.state, expectedState);
    assert.equal(exact.result.roomId, resources.hostLock.roomId);
    assert.equal(exact.result.attemptId, resources.hostLock.attemptId);
    assert.equal(exact.result.lastSeen, now);
    assert.equal(exact.result.expiresAt, resources.permit.expiresAt);
  }

  const different = {
    ...entry,
    leaseToken: "other-lease-12345678901",
  };
  const fenced = await runReservation(different, "host");
  assert.equal(fenced.reference.inputs.length, 2);
  assert.equal(fenced.result, null);
  assert.equal(fenced.reference.finalValue.leaseToken, different.leaseToken);
  assert.equal(fenced.reference.finalValue.state, "waiting");

  const missing = await runReservation(null, "host");
  assert.equal(missing.reference.inputs.length, 1);
  assert.equal(missing.result, null);
  assert.equal(missing.reference.finalValue, null);
});

test("room transition, activation, and clear retry cold nulls safely", async () => {
  const {
    decideSoloRoomTransition,
    isSafeToken,
    roomAttemptMatches,
    roomTransitionOwned,
  } = require("../solo-session-v2");
  const transitionSource = sourceBetween(
    "function soloSessionV2TransitionExpected",
    "async function cleanupSoloSessionV2Match",
  );
  const activateSource = sourceBetween(
    "async function activateSoloSessionV2Room",
    "async function refreshSoloSessionV2ActivePair",
  );
  const now = 1_780_000_000_000;
  const token = "transition-token-1234567890";
  const expected = {
    attemptId: "attempt-token-1234567890",
    connectionGeneration: "connection-generation-1234",
  };
  const offeredRoom = {
    protocolVersion: 2,
    signalingVersion: 2,
    ...expected,
    status: "offered",
    createdAt: now - 1_000,
  };
  let reference = null;
  const context = {
    Date: { now: () => now },
    decideSoloRoomTransition,
    isSafeToken,
    realtime: { ref: () => reference },
    roomAttemptMatches,
    roomTransitionOwned,
    soloSessionGeneration: () => token,
  };
  vm.createContext(context);
  vm.runInContext(
    `${transitionSource}
${activateSource}
this.acquireSoloSessionV2RoomTransition = acquireSoloSessionV2RoomTransition;
this.activateSoloSessionV2Room = activateSoloSessionV2Room;
this.clearSoloSessionV2RoomTransition = clearSoloSessionV2RoomTransition;`,
    context,
  );

  reference = coldTransactionRef(offeredRoom);
  const acquired = await context.acquireSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
  );
  assert.equal(reference.inputs.length, 2);
  assert.equal(acquired.acquired, true);
  assert.equal(acquired.room.matchTransition.action, "accept");
  assert.equal(acquired.room.matchTransition.token, token);
  assert.equal(acquired.room.matchTransition.startedAt, now);

  const resources = {
    hostLock: { attemptId: expected.attemptId },
    permit: { connectionGeneration: expected.connectionGeneration },
    room: acquired.room,
  };
  reference = coldTransactionRef(acquired.room);
  const activated = await context.activateSoloSessionV2Room(
    "room-token-1234567890",
    resources,
    token,
  );
  assert.equal(reference.inputs.length, 2);
  assert.equal(activated, true);
  assert.equal(resources.room.status, "active");
  assert.equal(resources.room.activatedAt, now);

  context.soloSessionGeneration = () => "other-transition-token-12345";
  reference = coldTransactionRef(resources.room);
  const reused = await context.acquireSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
    {
      allowActiveAccept: true,
      reuseExistingAction: true,
    },
  );
  assert.equal(reused.acquired, true);
  assert.equal(reused.reason, "reused-existing");
  assert.equal(reused.token, token);
  assert.equal(reused.room.matchTransition.token, token);

  reference = coldTransactionRef(resources.room);
  const cleared = await context.clearSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
    token,
    { requireUndestroyed: true },
  );
  assert.equal(reference.inputs.length, 2);
  assert.equal(cleared, true);
  assert.equal(reference.finalValue.matchTransition, undefined);

  reference = coldTransactionRef(null);
  const missingAcquire = await context.acquireSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
  );
  assert.equal(missingAcquire.acquired, false);
  assert.equal(reference.inputs.length, 1);

  reference = coldTransactionRef(null);
  assert.equal(await context.activateSoloSessionV2Room(
    "room-token-1234567890",
    resources,
    token,
  ), false);
  assert.equal(reference.inputs.length, 1);

  reference = coldTransactionRef(null);
  assert.equal(await context.clearSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
    token,
  ), false);
  assert.equal(reference.inputs.length, 1);

  const otherTransition = {
    ...acquired.room,
    matchTransition: {
      ...acquired.room.matchTransition,
      token: "other-transition-123456789",
    },
  };
  reference = coldTransactionRef(otherTransition);
  assert.equal(await context.activateSoloSessionV2Room(
    "room-token-1234567890",
    resources,
    token,
  ), false);
  assert.equal(reference.finalValue.matchTransition.token, otherTransition.matchTransition.token);

  reference = coldTransactionRef(otherTransition);
  assert.equal(await context.clearSoloSessionV2RoomTransition(
    "room-token-1234567890",
    expected,
    "accept",
    token,
  ), false);
  assert.equal(reference.finalValue.matchTransition.token, otherTransition.matchTransition.token);
});

test("server-finalized active rooms cannot be destroyed by an Admin cleanup race", async () => {
  const cleanupSource = sourceBetween(
    "async function cleanupSoloSessionV2Match",
    "async function readSoloSessionV2MaterializationFence",
  );
  const roomId = "room-finalized-123456";
  const attemptId = "attempt-finalized-1234";
  const connectionGeneration = "connection-finalized-1";
  const transitionToken = "cancel-finalized-token";
  const room = {
    status: "active",
    attemptId,
    connectionGeneration,
    serverFinalized: {
      version: 1,
      round: 1,
      finalizedAt: 1_780_000_000_000,
    },
    matchTransition: {
      action: "cancel",
      token: transitionToken,
    },
  };
  const reference = coldTransactionRef(room);
  const context = {
    Date: { now: () => 1_780_000_000_000 },
    objectValue: (value) => (value && typeof value === "object" ? value : {}),
    realtime: { ref: () => reference },
    recordAttemptMatches: () => true,
    roomAttemptMatches: () => true,
    roomTransitionOwned: (value, action, token) => (
      value?.matchTransition?.action === action
        && value?.matchTransition?.token === token
    ),
    soloSessionV2TransitionExpected: () => ({
      attemptId,
      connectionGeneration,
    }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${cleanupSource}
this.cleanupSoloSessionV2Match = cleanupSoloSessionV2Match;`,
    context,
  );
  const resources = {
    hostLock: { roomId, attemptId },
    permit: {
      hostUid: "host-user",
      guestUid: "guest-user",
      connectionGeneration,
      players: {
        "host-user": { uid: "host-user" },
        "guest-user": { uid: "guest-user" },
      },
      sessions: {
        "host-user": { sessionId: "host-session" },
        "guest-user": { sessionId: "guest-session" },
      },
    },
  };

  assert.equal(await context.cleanupSoloSessionV2Match(resources, {
    restoreQueue: false,
    transitionAction: "cancel",
    transitionToken,
    destroyActive: true,
    destroyedByUid: "host-user",
  }), false);
  assert.equal(reference.finalValue.destroyed, undefined);
  assert.equal(reference.finalValue.matchTransition, undefined);
});

test("active pair refresh retries a cold root and preserves both identities", async () => {
  const { claimMatches, normalizeClaim } = require("../solo-session-v2");
  const identitySource = sourceBetween(
    "function exactSoloSessionV2ActiveIdentity",
    "async function removeExpiredSoloSessionV2Active",
  );
  const refreshSource = sourceBetween(
    "async function refreshSoloSessionV2ActivePair",
    "async function finalizeAcceptedSoloSessionV2Match",
  );
  const now = 1_780_000_000_000;
  const hostUid = "host-user";
  const guestUid = "guest-user";
  const hostSessionId = "host-session-1234567890";
  const guestSessionId = "guest-session-123456789";
  const common = {
    protocolVersion: 2,
    roomId: "room-token-1234567890",
    attemptId: "attempt-token-1234567890",
    connectionGeneration: "connection-generation-1234",
  };
  const hostActive = {
    ...common,
    uid: hostUid,
    sessionId: hostSessionId,
    leaseToken: "host-lease-123456789012",
    generation: "host-generation-123456",
    lastSeen: now - 1_000,
    expiresAt: now + 30_000,
  };
  const guestActive = {
    ...common,
    uid: guestUid,
    sessionId: guestSessionId,
    leaseToken: "guest-lease-12345678901",
    generation: "guest-generation-12345",
    lastSeen: now - 1_000,
    expiresAt: now + 30_000,
  };
  const claims = {
    [hostUid]: {
      protocolVersion: 2,
      sessionId: hostSessionId,
      leaseToken: hostActive.leaseToken,
      generation: hostActive.generation,
      claimedAt: now - 10_000,
      heartbeatAt: now - 1_000,
      expiresAt: now + 50_000,
    },
    [guestUid]: {
      protocolVersion: 2,
      sessionId: guestSessionId,
      leaseToken: guestActive.leaseToken,
      generation: guestActive.generation,
      claimedAt: now - 10_000,
      heartbeatAt: now - 1_000,
      expiresAt: now + 45_000,
    },
  };
  const activeRoot = {
    [hostUid]: { [hostSessionId]: hostActive },
    [guestUid]: { [guestSessionId]: guestActive },
    unrelated: { keep: { value: true } },
  };

  const runRefresh = async (serverRoot, cachedRoot = null) => {
    const references = {
      [hostUid]: cachedTransactionRef({
        cachedValue: cachedRoot?.[hostUid]?.[hostSessionId] ?? null,
        serverValue: serverRoot?.[hostUid]?.[hostSessionId] ?? null,
      }),
      [guestUid]: cachedTransactionRef({
        cachedValue: cachedRoot?.[guestUid]?.[guestSessionId] ?? null,
        serverValue: serverRoot?.[guestUid]?.[guestSessionId] ?? null,
      }),
    };
    const resources = {
      permit: {
        hostUid,
        guestUid,
        sessions: {
          [hostUid]: {
            sessionId: hostSessionId,
            generation: hostActive.generation,
          },
          [guestUid]: {
            sessionId: guestSessionId,
            generation: guestActive.generation,
          },
        },
      },
      hostActive: { ...hostActive },
      guestActive: { ...guestActive },
    };
    const context = {
      Date: { now: () => now },
      SOLO_SESSION_PROTOCOL_VERSION: 2,
      claimMatches,
      normalizeClaim,
      realtime: {
        ref: () => {
          throw new Error("active pair refresh must not transact at the activeV2 root");
        },
      },
      soloSessionActiveRef: (uid) => references[uid],
      soloSessionClaimRef: (uid) => ({
        get: async () => snapshotOf(claims[uid] ?? null),
      }),
    };
    vm.createContext(context);
    vm.runInContext(
      `${identitySource}
${refreshSource}
this.refreshSoloSessionV2ActivePair = refreshSoloSessionV2ActivePair;`,
      context,
    );
    return {
      references,
      resources,
      refreshed: await context.refreshSoloSessionV2ActivePair(resources),
    };
  };

  const exact = await runRefresh(activeRoot);
  assert.equal(exact.references[hostUid].inputs.length, 2);
  assert.equal(exact.references[guestUid].inputs.length, 2);
  assert.equal(exact.refreshed, true);
  assert.equal(exact.resources.hostActive.lastSeen, now);
  assert.equal(exact.resources.hostActive.expiresAt, claims[hostUid].expiresAt);
  assert.equal(exact.resources.guestActive.lastSeen, now);
  assert.equal(exact.resources.guestActive.expiresAt, claims[guestUid].expiresAt);

  const hostOnlyCache = await runRefresh(activeRoot, {
    [hostUid]: { [hostSessionId]: hostActive },
  });
  assert.equal(hostOnlyCache.refreshed, true);
  assert.equal(hostOnlyCache.references[hostUid].inputs.length, 1);
  assert.equal(hostOnlyCache.references[guestUid].inputs.length, 2);

  const guestOnlyCache = await runRefresh(activeRoot, {
    [guestUid]: { [guestSessionId]: guestActive },
  });
  assert.equal(guestOnlyCache.refreshed, true);
  assert.equal(guestOnlyCache.references[hostUid].inputs.length, 2);
  assert.equal(guestOnlyCache.references[guestUid].inputs.length, 1);

  const heartbeatRoot = {
    ...activeRoot,
    [hostUid]: {
      [hostSessionId]: {
        ...hostActive,
        lastSeen: now + 5_000,
        expiresAt: now + 60_000,
      },
    },
  };
  const heartbeat = await runRefresh(heartbeatRoot, activeRoot);
  assert.equal(heartbeat.refreshed, true);
  assert.equal(heartbeat.resources.hostActive.lastSeen, now + 5_000);
  assert.equal(heartbeat.resources.hostActive.expiresAt, now + 60_000);

  const differentRoot = {
    ...activeRoot,
    [guestUid]: {
      [guestSessionId]: {
        ...guestActive,
        connectionGeneration: "other-connection-generation",
      },
    },
  };
  const fenced = await runRefresh(differentRoot);
  assert.equal(fenced.references[guestUid].inputs.length, 2);
  assert.equal(fenced.refreshed, false);
  assert.equal(
    fenced.references[guestUid].finalValue.connectionGeneration,
    "other-connection-generation",
  );
  assert.equal(fenced.resources.hostActive.lastSeen, hostActive.lastSeen);
  assert.equal(fenced.resources.guestActive.connectionGeneration, common.connectionGeneration);

  const missing = await runRefresh(null);
  assert.equal(missing.references[hostUid].inputs.length, 1);
  assert.equal(missing.references[guestUid].inputs.length, 1);
  assert.equal(missing.refreshed, false);
  assert.equal(missing.references[hostUid].finalValue, null);
  assert.equal(missing.references[guestUid].finalValue, null);
  assert.doesNotMatch(refreshSource, /realtime\.ref\("online\/activeV2"\)/);
});

test("pair lock transactions retry partial non-null caches without stealing foreign locks", async () => {
  const lockSource = sourceBetween(
    "function soloSessionV2LockMatches",
    "async function reserveSoloSessionV2Queue",
  );
  const now = 1_780_000_000_000;
  const resources = {
    hostLock: {
      protocolVersion: 2,
      roomId: "room-token-1234567890",
      attemptId: "attempt-token-1234567890",
      role: "host",
      sessionId: "host-session-1234567890",
      generation: "host-generation-123456",
      hostUid: "host-user",
      guestUid: "guest-user",
      acquiredAt: now,
      expiresAt: now + 45_000,
    },
    guestLock: {
      protocolVersion: 2,
      roomId: "room-token-1234567890",
      attemptId: "attempt-token-1234567890",
      role: "guest",
      sessionId: "guest-session-123456789",
      generation: "guest-generation-12345",
      hostUid: "host-user",
      guestUid: "guest-user",
      acquiredAt: now,
      expiresAt: now + 45_000,
    },
  };
  const exactRoot = {
    [resources.hostLock.hostUid]: resources.hostLock,
    [resources.guestLock.guestUid]: resources.guestLock,
  };
  const foreignHost = {
    ...resources.hostLock,
    roomId: "foreign-room-1234567",
    attemptId: "foreign-attempt-12345",
  };
  const run = async (reference, operation) => {
    const context = {
      Date: { now: () => now },
      SOLO_SESSION_PROTOCOL_VERSION: 2,
      objectValue: (value) => (
        value && typeof value === "object" && !Array.isArray(value) ? value : {}
      ),
      realtime: { ref: () => reference },
    };
    vm.createContext(context);
    vm.runInContext(
      `${lockSource}
this.acquireSoloSessionV2Locks = acquireSoloSessionV2Locks;
this.releaseSoloSessionV2Locks = releaseSoloSessionV2Locks;`,
      context,
    );
    return operation(context);
  };

  const acquireReference = cachedTransactionRef({
    cachedValue: { [resources.hostLock.hostUid]: foreignHost },
    serverValue: {},
  });
  assert.equal(await run(
    acquireReference,
    (context) => context.acquireSoloSessionV2Locks(resources),
  ), true);
  assert.equal(acquireReference.inputs.length, 2);
  assert.equal(acquireReference.finalValue[resources.hostLock.hostUid].roomId, resources.hostLock.roomId);
  assert.equal(acquireReference.finalValue[resources.guestLock.guestUid].roomId, resources.guestLock.roomId);

  const occupiedReference = cachedTransactionRef({
    cachedValue: { [resources.hostLock.hostUid]: foreignHost },
    serverValue: { [resources.hostLock.hostUid]: foreignHost },
  });
  assert.equal(await run(
    occupiedReference,
    (context) => context.acquireSoloSessionV2Locks(resources),
  ), false);
  assert.equal(occupiedReference.finalValue[resources.hostLock.hostUid].roomId, foreignHost.roomId);

  const releaseReference = cachedTransactionRef({
    cachedValue: { [resources.hostLock.hostUid]: foreignHost },
    serverValue: exactRoot,
  });
  assert.equal(await run(
    releaseReference,
    (context) => context.releaseSoloSessionV2Locks(resources),
  ), true);
  assert.equal(releaseReference.inputs.length, 2);
  assert.equal(releaseReference.finalValue[resources.hostLock.hostUid], undefined);
  assert.equal(releaseReference.finalValue[resources.guestLock.guestUid], undefined);

  const foreignReleaseReference = cachedTransactionRef({
    cachedValue: { [resources.hostLock.hostUid]: foreignHost },
    serverValue: { [resources.hostLock.hostUid]: foreignHost },
  });
  assert.equal(await run(
    foreignReleaseReference,
    (context) => context.releaseSoloSessionV2Locks(resources),
  ), false);
  assert.equal(
    foreignReleaseReference.finalValue[resources.hostLock.hostUid].attemptId,
    foreignHost.attemptId,
  );
});

test("pre-active refresh recovery requeues exact resources and logs no identifiers on failure", async () => {
  const recoverySource = sourceBetween(
    "async function recoverSoloSessionV2PreActiveMatch",
    "async function finalizeAcceptedSoloSessionV2Match",
  );
  const logs = [];
  const cleanupCalls = [];
  let cleanupMode = "success";
  const context = {
    console: {
      error: (message, details) => logs.push({ message, details }),
    },
    cleanupSoloSessionV2Match: async (resources, options) => {
      cleanupCalls.push({ resources, options });
      if (cleanupMode === "throw") throw new Error("backend unavailable");
      return cleanupMode === "success";
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${recoverySource}
this.recoverPreActive = recoverSoloSessionV2PreActiveMatch;`,
    context,
  );
  const resources = {
    marker: "resource-sensitive-value",
  };
  const transitionToken = "transition-sensitive-value";

  assert.equal(await context.recoverPreActive(resources, transitionToken), true);
  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0].resources, resources);
  assert.equal(JSON.stringify(cleanupCalls[0].options), JSON.stringify({
    restoreQueue: true,
    transitionAction: "accept",
    transitionToken,
  }));
  assert.equal(logs.length, 0);

  cleanupMode = "failure";
  assert.equal(await context.recoverPreActive(resources, transitionToken), false);
  assert.equal(JSON.stringify(logs.at(-1).details), JSON.stringify({
    stage: "refresh-active-pair",
  }));

  cleanupMode = "throw";
  assert.equal(await context.recoverPreActive(resources, transitionToken), false);
  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /resource-sensitive-value/);
  assert.doesNotMatch(serializedLogs, /transition-sensitive-value/);
  assert.doesNotMatch(serializedLogs, /backend unavailable/);
});

test("post-active finalization failures preserve safe or unreadable matches and log only stages", async () => {
  const preservationSource = sourceBetween(
    "const SOLO_SESSION_V2_FINALIZATION_STAGES",
    "async function completeAcceptedSoloSessionV2Match",
  );
  const logs = [];
  let abortCalls = 0;
  const room = {
    status: "active",
    marker: "room-sensitive-value",
  };
  const resources = {
    room,
    marker: "resource-sensitive-value",
  };
  const context = {
    Set,
    console: {
      error: (message, details) => logs.push({ message, details }),
    },
    acceptedSoloSessionV2Response: () => ({ accepted: true, outcome: "join" }),
    abortFailedSoloSessionV2Activation: async () => {
      abortCalls += 1;
      return true;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${preservationSource}
this.preserveAcceptance = preserveOrAbortIncompleteSoloSessionV2Acceptance;
this.setInspection = (inspection) => {
  inspectSoloSessionV2AcceptanceCore = inspection;
};`,
    context,
  );

  context.setInspection(async () => ({ state: "safe", room }));
  assert.deepEqual(
    await context.preserveAcceptance(
      "room-sensitive-value",
      resources,
      "transition-sensitive-value",
      "uid-sensitive-value",
      { stage: "remove-permit" },
    ),
    { accepted: true, outcome: "join" },
  );
  assert.equal(abortCalls, 0);
  assert.equal(JSON.stringify(logs.at(-1).details), JSON.stringify({
    stage: "remove-permit",
    coreState: "safe",
  }));

  context.setInspection(async () => {
    throw new Error("backend unavailable");
  });
  assert.deepEqual(
    await context.preserveAcceptance(
      "room-sensitive-value",
      resources,
      "transition-sensitive-value",
      "uid-sensitive-value",
      { stage: "uid-sensitive-value" },
    ),
    { accepted: true, outcome: "join" },
  );
  assert.equal(abortCalls, 0);
  assert.equal(JSON.stringify(logs.at(-1).details), JSON.stringify({
    stage: "unknown",
    coreState: "unknown",
  }));

  context.setInspection(async () => ({ state: "lost", room: null }));
  await assert.rejects(
    context.preserveAcceptance(
      "room-sensitive-value",
      resources,
      "transition-sensitive-value",
      "uid-sensitive-value",
      { stage: "release-locks" },
    ),
    /acceptance core lost/,
  );
  assert.equal(abortCalls, 1);
  const serializedLogs = JSON.stringify(logs);
  for (const sensitiveValue of [
    "room-sensitive-value",
    "resource-sensitive-value",
    "transition-sensitive-value",
    "uid-sensitive-value",
  ]) {
    assert.doesNotMatch(serializedLogs, new RegExp(sensitiveValue));
  }
});

test("acceptance core inspection requires both exact claims, active entries, and the active room", async () => {
  const { claimMatches, roomAttemptMatches } = require("../solo-session-v2");
  const identitySource = sourceBetween(
    "function exactSoloSessionV2ActiveIdentity",
    "async function removeExpiredSoloSessionV2Active",
  );
  const recordSource = sourceBetween(
    "function recordAttemptMatches",
    "async function removeSoloSessionV2Record",
  );
  const transitionExpectedSource = sourceBetween(
    "function soloSessionV2TransitionExpected",
    "async function acquireSoloSessionV2RoomTransition",
  );
  const inspectionSource = sourceBetween(
    "async function inspectSoloSessionV2AcceptanceCore",
    "async function preserveOrAbortIncompleteSoloSessionV2Acceptance",
  );
  const now = 1_780_000_000_000;
  const hostUid = "host-user";
  const guestUid = "guest-user";
  const hostSessionId = "host-session-1234567890";
  const guestSessionId = "guest-session-123456789";
  const attemptId = "attempt-token-1234567890";
  const connectionGeneration = "connection-generation-1234";
  const sessions = {
    [hostUid]: {
      sessionId: hostSessionId,
      generation: "host-generation-123456",
    },
    [guestUid]: {
      sessionId: guestSessionId,
      generation: "guest-generation-12345",
    },
  };
  const room = {
    protocolVersion: 2,
    signalingVersion: 2,
    status: "active",
    hostUid,
    guestUid,
    attemptId,
    connectionGeneration,
    sessions,
  };
  const active = {
    [hostUid]: {
      protocolVersion: 2,
      uid: hostUid,
      sessionId: hostSessionId,
      leaseToken: "host-lease-123456789012",
      generation: sessions[hostUid].generation,
      roomId: "room-token-1234567890",
      attemptId,
      connectionGeneration,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
    [guestUid]: {
      protocolVersion: 2,
      uid: guestUid,
      sessionId: guestSessionId,
      leaseToken: "guest-lease-12345678901",
      generation: sessions[guestUid].generation,
      roomId: "room-token-1234567890",
      attemptId,
      connectionGeneration,
      lastSeen: now,
      expiresAt: now + 45_000,
    },
  };
  const claims = {
    [hostUid]: {
      protocolVersion: 2,
      sessionId: hostSessionId,
      leaseToken: active[hostUid].leaseToken,
      generation: sessions[hostUid].generation,
      claimedAt: now - 10_000,
      heartbeatAt: now,
      expiresAt: now + 45_000,
    },
    [guestUid]: {
      protocolVersion: 2,
      sessionId: guestSessionId,
      leaseToken: active[guestUid].leaseToken,
      generation: sessions[guestUid].generation,
      claimedAt: now - 10_000,
      heartbeatAt: now,
      expiresAt: now + 45_000,
    },
  };
  const resources = {
    room,
    hostLock: { attemptId },
    hostActive: active[hostUid],
    guestActive: active[guestUid],
    permit: {
      protocolVersion: 2,
      hostUid,
      guestUid,
      connectionGeneration,
      sessions,
    },
  };
  const context = {
    Date: { now: () => now },
    SOLO_SESSION_PROTOCOL_VERSION: 2,
    claimMatches,
    roomAttemptMatches,
    realtime: {
      ref: () => ({
        get: async () => snapshotOf(room),
      }),
    },
    soloSessionClaimRef: (uid) => ({
      get: async () => snapshotOf(claims[uid] ?? null),
    }),
    soloSessionActiveRef: (uid) => ({
      get: async () => snapshotOf(active[uid] ?? null),
    }),
  };
  vm.createContext(context);
  vm.runInContext(
    `${identitySource}
${recordSource}
${transitionExpectedSource}
${inspectionSource}
this.inspectAcceptanceCore = inspectSoloSessionV2AcceptanceCore;`,
    context,
  );

  const safe = await context.inspectAcceptanceCore(
    "room-token-1234567890",
    resources,
  );
  assert.equal(safe.state, "safe");
  assert.equal(safe.room.status, "active");

  active[guestUid] = {
    ...active[guestUid],
    connectionGeneration: "foreign-connection-generation",
  };
  const lost = await context.inspectAcceptanceCore(
    "room-token-1234567890",
    resources,
  );
  assert.equal(lost.state, "lost");
});

test("reunion confirmation mark retries a cold room without crossing its transition", async () => {
  const { roomTransitionOwned } = require("../solo-session-v2");
  const confirmationSource = sourceBetween(
    "async function confirmSoloFamiliarReunionV2",
    "async function activateSoloSessionV2Room",
  );
  const now = 1_780_000_000_000;
  const token = "transition-token-1234567890";
  const room = {
    protocolVersion: 2,
    signalingVersion: 2,
    attemptId: "attempt-token-1234567890",
    connectionGeneration: "connection-generation-1234",
    status: "active",
    reunion: true,
    matchTransition: {
      action: "accept",
      token,
      startedAt: now - 1_000,
    },
  };
  const permit = { protocolVersion: 2 };

  const runConfirmation = async (serverRoom, transitionToken = token) => {
    const reference = coldTransactionRef(serverRoom);
    const resources = {
      room: { ...room },
      permit,
      permitWasStored: true,
    };
    const context = {
      Date: { now: () => now },
      confirmSoloFamiliarReunionFromRoom: async () => true,
      realtime: { ref: () => reference },
      roomTransitionOwned,
      soloSessionV2ReunionPermitMatchesRoom: () => true,
    };
    vm.createContext(context);
    vm.runInContext(
      `${confirmationSource}
this.confirmSoloFamiliarReunionV2 = confirmSoloFamiliarReunionV2;`,
      context,
    );
    return {
      reference,
      resources,
      confirmed: await context.confirmSoloFamiliarReunionV2(
        "room-token-1234567890",
        resources,
        transitionToken,
      ),
    };
  };

  const exact = await runConfirmation(room);
  assert.equal(exact.reference.inputs.length, 2);
  assert.equal(exact.confirmed, true);
  assert.equal(exact.resources.room.reunionConfirmedAt, now);

  const fenced = await runConfirmation(room, "other-transition-123456789");
  assert.equal(fenced.reference.inputs.length, 2);
  assert.equal(fenced.confirmed, false);
  assert.equal(fenced.reference.finalValue.reunionConfirmedAt, undefined);

  const missing = await runConfirmation(null);
  assert.equal(missing.reference.inputs.length, 1);
  assert.equal(missing.confirmed, false);
  assert.equal(missing.reference.finalValue, null);
});
