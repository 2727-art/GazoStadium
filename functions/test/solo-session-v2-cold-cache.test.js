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

  const runRefresh = async (serverRoot) => {
    const reference = coldTransactionRef(serverRoot);
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
      objectValue: (value) => (
        value && typeof value === "object" && !Array.isArray(value) ? value : {}
      ),
      realtime: { ref: () => reference },
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
      reference,
      resources,
      refreshed: await context.refreshSoloSessionV2ActivePair(resources),
    };
  };

  const exact = await runRefresh(activeRoot);
  assert.equal(exact.reference.inputs.length, 2);
  assert.equal(exact.refreshed, true);
  assert.equal(exact.resources.hostActive.lastSeen, now);
  assert.equal(exact.resources.hostActive.expiresAt, claims[hostUid].expiresAt);
  assert.equal(exact.resources.guestActive.lastSeen, now);
  assert.equal(exact.resources.guestActive.expiresAt, claims[guestUid].expiresAt);
  assert.equal(exact.reference.finalValue.unrelated.keep.value, true);

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
  assert.equal(fenced.reference.inputs.length, 2);
  assert.equal(fenced.refreshed, false);
  assert.equal(
    fenced.reference.finalValue[guestUid][guestSessionId].connectionGeneration,
    "other-connection-generation",
  );

  const missing = await runRefresh(null);
  assert.equal(missing.reference.inputs.length, 1);
  assert.equal(missing.refreshed, false);
  assert.equal(missing.reference.finalValue, null);
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
