"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ACTIVE_ORPHAN_GRACE_MS,
  ACTIVE_PRESENCE_FRESH_MS,
  activeParticipantIsAbandoned,
  attemptIdentityMatches,
  createTrainingSessionV5Cleanup,
  roomMatchesAttempt,
  terminalAttempt,
  TERMINAL_RETENTION_MS,
  trainingPresenceV5IsFreshOnline,
} = require("../training-session-v5-cleanup");
const training = require("../training-session-v5");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function parts(value) {
  return String(value || "").split("/").filter(Boolean);
}

function getAt(root, value) {
  let current = root;
  for (const key of parts(value)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function setAt(root, value, next) {
  const keys = parts(value);
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  if (next == null) delete current[keys.at(-1)];
  else current[keys.at(-1)] = clone(next);
}

class Snapshot {
  constructor(value, key = null) {
    this.value = clone(value);
    this.key = key;
  }

  exists() {
    return this.value !== undefined && this.value !== null;
  }

  val() {
    return clone(this.value);
  }

  forEach(visitor) {
    for (const [key, value] of Object.entries(this.value || {})) {
      visitor(new Snapshot(value, key));
    }
  }
}

class Reference {
  constructor(database, value) {
    this.database = database;
    this.path = parts(value).join("/");
  }

  async get() {
    return new Snapshot(getAt(this.database.data, this.path));
  }

  async transaction(update) {
    const count = (this.database.counts.get(this.path) || 0) + 1;
    this.database.counts.set(this.path, count);
    if (this.database.failures.get(this.path)?.delete(count)) {
      throw new Error(`forced cleanup transaction failure: ${this.path}`);
    }
    const current = clone(getAt(this.database.data, this.path));
    const next = update(current);
    if (next === undefined) {
      return { committed: false, snapshot: new Snapshot(current) };
    }
    setAt(this.database.data, this.path, next);
    return {
      committed: true,
      snapshot: new Snapshot(getAt(this.database.data, this.path)),
    };
  }
}

class Realtime {
  constructor(data) {
    this.data = clone(data);
    this.counts = new Map();
    this.failures = new Map();
  }

  ref(value) {
    return new Reference(this, value);
  }

  failNext(value) {
    const path = parts(value).join("/");
    const count = (this.counts.get(path) || 0) + 1;
    const failures = this.failures.get(path) || new Set();
    failures.add(count);
    this.failures.set(path, failures);
  }
}

function attempt(overrides = {}) {
  return {
    protocolVersion: 5,
    uid: "player-a",
    runId: "run-player-a",
    endpointId: "endpoint-player-a",
    ownerEpoch: "owner-player-a",
    revision: 4,
    state: "active",
    roomId: "room12345678",
    roomAttemptId: "attempt12345678",
    transportEpoch: "transport12345678",
    reservedAt: 10_000,
    role: "host",
    opponentUid: "player-b",
    ...overrides,
  };
}

function exactPresence(candidate, updatedAt, online = true) {
  return {
    protocolVersion: 5,
    runId: candidate.runId,
    endpointId: candidate.endpointId,
    ownerEpoch: candidate.ownerEpoch,
    roomAttemptId: candidate.roomAttemptId,
    transportEpoch: candidate.transportEpoch,
    online,
    updatedAt,
  };
}

test("V5 cleanup identity uses the canonical owner revision fence", () => {
  const candidate = attempt();
  assert.equal(attemptIdentityMatches({ ...candidate }, candidate), true);
  assert.equal(
    attemptIdentityMatches({ ...candidate, ownerEpoch: "owner-replaced" }, candidate),
    false,
  );
  assert.equal(
    attemptIdentityMatches({ ...candidate, revision: candidate.revision + 1 }, candidate),
    false,
  );
});

test("V5 room cleanup matches every room and owner identity field", () => {
  const candidate = attempt();
  const room = {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 5,
    signalingVersion: 5,
    hostUid: candidate.uid,
    guestUid: candidate.opponentUid,
    roomAttemptId: candidate.roomAttemptId,
    transportEpoch: candidate.transportEpoch,
    members: { [candidate.uid]: true },
    sessions: {
      [candidate.uid]: {
        runId: candidate.runId,
        endpointId: candidate.endpointId,
        ownerEpoch: candidate.ownerEpoch,
      },
    },
  };
  assert.equal(roomMatchesAttempt(room, candidate), true);
  assert.equal(
    roomMatchesAttempt({ ...room, transportEpoch: "transport-replaced" }, candidate),
    false,
  );
});

test("active orphan detection requires a stale heartbeat and no fresh exact online presence", () => {
  const now = 1_900_000_000_000;
  const candidate = attempt({
    lastSeen: now - ACTIVE_ORPHAN_GRACE_MS - 1,
  });
  const room = {
    presenceV5: {
      [candidate.uid]: {
        [candidate.runId]: exactPresence(candidate, now - 1),
      },
    },
  };

  assert.equal(
    trainingPresenceV5IsFreshOnline(room, candidate, now),
    true,
  );
  assert.equal(activeParticipantIsAbandoned(room, candidate, now), false);

  room.presenceV5[candidate.uid][candidate.runId].online = false;
  assert.equal(activeParticipantIsAbandoned(room, candidate, now), true);

  room.presenceV5[candidate.uid][candidate.runId] =
    exactPresence(candidate, now - ACTIVE_PRESENCE_FRESH_MS - 1);
  assert.equal(activeParticipantIsAbandoned(room, candidate, now), true);

  const shortBackground = {
    ...candidate,
    lastSeen: now - ACTIVE_ORPHAN_GRACE_MS + 1,
  };
  delete room.presenceV5[candidate.uid][candidate.runId];
  assert.equal(
    activeParticipantIsAbandoned(room, shortBackground, now),
    false,
  );
  const justReconnected = {
    ...candidate,
    updatedAt: now,
  };
  assert.equal(
    activeParticipantIsAbandoned(room, justReconnected, now),
    false,
  );
});

test("terminalizing an attempt advances revision and drops its reservation fields", () => {
  const candidate = attempt();
  const terminal = terminalAttempt(candidate, 50_000, "room_ended");
  assert.equal(terminal.state, "terminal");
  assert.equal(terminal.revision, 5);
  assert.equal(terminal.terminalReason, "room_ended");
  for (const key of [
    "roomId",
    "roomAttemptId",
    "transportEpoch",
    "reservedAt",
    "role",
    "opponentUid",
  ]) {
    assert.equal(Object.hasOwn(terminal, key), false, key);
  }
  assert.equal(terminal.queueExpiresAt, 0);
});

function pendingTerminal(now) {
  const cleanup = {
    roomId: "-0000000000000000001",
    roomAttemptId: "cleanup-room-attempt-token1",
    transportEpoch: "cleanup-transport-token-123",
    uid: "player-a",
    runId: "cleanup-run-token-player-a",
    endpointId: "cleanup-endpoint-token-a",
    ownerEpoch: "cleanup-owner-token-player-a",
    role: "host",
    opponentUid: "player-b",
    reason: "cancelled",
    requestedAt: now - 10_000,
  };
  return {
    cleanup,
    attempt: {
      protocolVersion: 5,
      signalingVersion: 5,
      uid: cleanup.uid,
      runId: cleanup.runId,
      endpointId: cleanup.endpointId,
      ownerEpoch: cleanup.ownerEpoch,
      revision: 8,
      state: "terminal",
      preparation: {},
      createdAt: now - 100_000,
      updatedAt: now - TERMINAL_RETENTION_MS - 1,
      lastSeen: now - 100_000,
      queueExpiresAt: 0,
      terminalReason: "cancelled",
      pendingRoomCleanup: cleanup,
    },
    room: {
      protocolVersion: 3,
      variant: "kitaeai_hp_v3",
      sessionProtocolVersion: 5,
      signalingVersion: 5,
      hostUid: cleanup.uid,
      guestUid: cleanup.opponentUid,
      roomAttemptId: cleanup.roomAttemptId,
      transportEpoch: cleanup.transportEpoch,
      status: "active",
      members: { [cleanup.uid]: true, [cleanup.opponentUid]: true },
      sessions: {
        [cleanup.uid]: {
          runId: cleanup.runId,
          endpointId: cleanup.endpointId,
          ownerEpoch: cleanup.ownerEpoch,
        },
      },
    },
  };
}

test("cleanup drains a terminal room fence before retention can delete it", async () => {
  const now = 1_900_000_000_000;
  const fixture = pendingTerminal(now);
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: { "player-a": fixture.attempt },
      trainingRooms: { [fixture.cleanup.roomId]: fixture.room },
    },
  });
  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);
  assert.equal(result.drained, 1);
  assert.equal(result.removed, 0);
  assert.equal(
    realtime.data.online.trainingRooms[fixture.cleanup.roomId].destroyed.reason,
    "cancelled",
  );
  const retained = realtime.data.online.trainingAttemptsV5["player-a"];
  assert.equal(retained.pendingRoomCleanup, undefined);
  assert.equal(retained.updatedAt, now);
  assert.equal(retained.revision, fixture.attempt.revision + 1);
});

test("cleanup retains the descriptor after a transient room destroy failure", async () => {
  const now = 1_900_000_000_000;
  const fixture = pendingTerminal(now);
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: { "player-a": fixture.attempt },
      trainingRooms: { [fixture.cleanup.roomId]: fixture.room },
    },
  });
  const roomPath = `online/trainingRooms/${fixture.cleanup.roomId}`;
  realtime.failNext(roomPath);
  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const failed = await cleanup(now);
  assert.equal(failed.failures, 1);
  assert.ok(
    realtime.data.online.trainingAttemptsV5["player-a"].pendingRoomCleanup,
  );

  const retried = await cleanup(now + 1);
  assert.equal(retried.drained, 1);
  assert.equal(
    realtime.data.online.trainingRooms[fixture.cleanup.roomId].destroyed.reason,
    "cancelled",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["player-a"].pendingRoomCleanup,
    undefined,
  );
});

function validPreparation(name) {
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

function activePairFixture(
  now,
  {
    roomId = "-0000000000000000002",
    roomAttemptId = "cleanup-active-attempt-token1",
    transportEpoch = "cleanup-active-transport-token",
    hostLastSeen = now,
    guestLastSeen = now,
  } = {},
) {
  const reservedAt = now - (11 * 60 * 1000);
  const hostIdentity = {
    runId: "cleanup-active-host-run-token-1",
    endpointId: "cleanup-active-host-endpoint-1",
    ownerEpoch: "cleanup-active-host-owner-token",
  };
  const guestIdentity = {
    runId: "cleanup-active-guest-run-token-1",
    endpointId: "cleanup-active-guest-endpoint-1",
    ownerEpoch: "cleanup-active-guest-owner-token",
  };
  let attempts = training.startAttemptDecision({
    attempts: {},
    uid: "cleanup-host",
    ...hostIdentity,
    preparation: validPreparation("HOST"),
    now: reservedAt - 2,
  }).attempts;
  attempts = training.startAttemptDecision({
    attempts,
    uid: "cleanup-guest",
    ...guestIdentity,
    preparation: validPreparation("GUEST"),
    now: reservedAt - 1,
  }).attempts;
  attempts = training.reserveMatchDecision({
    attempts,
    uid: "cleanup-host",
    ...hostIdentity,
    roomId,
    roomAttemptId,
    transportEpoch,
    now: reservedAt,
  }).attempts;
  attempts = training.activateMatchDecision({
    attempts,
    uid: "cleanup-host",
    roomAttemptId,
    now: reservedAt + 1,
  }).attempts;
  const room = training.buildActiveTrainingRoom({
    host: attempts["cleanup-host"],
    guest: attempts["cleanup-guest"],
    chatFrames: { "cleanup-host": "", "cleanup-guest": "" },
    now: reservedAt + 1,
  });
  for (const [uid, lastSeen] of [
    ["cleanup-host", hostLastSeen],
    ["cleanup-guest", guestLastSeen],
  ]) {
    attempts[uid] = {
      ...attempts[uid],
      revision: attempts[uid].revision + 1,
      updatedAt: Math.max(attempts[uid].updatedAt, lastSeen),
      lastSeen,
    };
  }
  return { attempts, room, roomId };
}

test("orphan cleanup uses reservedAt and terminalizes a reciprocal pair atomically", async () => {
  const now = 1_900_000_000_000;
  const reservedAt = now - (11 * 60 * 1000);
  const hostIdentity = {
    runId: "cleanup-host-run-token-1234",
    endpointId: "cleanup-host-endpoint-token",
    ownerEpoch: "cleanup-host-owner-token-123",
  };
  const guestIdentity = {
    runId: "cleanup-guest-run-token-123",
    endpointId: "cleanup-guest-endpoint-token",
    ownerEpoch: "cleanup-guest-owner-token-12",
  };
  let attempts = training.startAttemptDecision({
    attempts: {},
    uid: "cleanup-host",
    ...hostIdentity,
    preparation: validPreparation("HOST"),
    now: reservedAt - 2,
  }).attempts;
  attempts = training.startAttemptDecision({
    attempts,
    uid: "cleanup-guest",
    ...guestIdentity,
    preparation: validPreparation("GUEST"),
    now: reservedAt - 1,
  }).attempts;
  attempts = training.reserveMatchDecision({
    attempts,
    uid: "cleanup-host",
    ...hostIdentity,
    roomId: "-0000000000000000001",
    roomAttemptId: "cleanup-pair-attempt-token1",
    transportEpoch: "cleanup-pair-transport-token",
    now: reservedAt,
  }).attempts;
  attempts = training.activateMatchDecision({
    attempts,
    uid: "cleanup-host",
    roomAttemptId: "cleanup-pair-attempt-token1",
    now: reservedAt + 1,
  }).attempts;
  const corruptedRoom = training.buildActiveTrainingRoom({
    host: attempts["cleanup-host"],
    guest: attempts["cleanup-guest"],
    chatFrames: { "cleanup-host": "", "cleanup-guest": "" },
    now: reservedAt + 1,
  });
  corruptedRoom.sessions["cleanup-guest"].endpointId =
    "corrupted-cleanup-peer-endpoint";
  for (const uid of ["cleanup-host", "cleanup-guest"]) {
    attempts[uid] = {
      ...attempts[uid],
      revision: attempts[uid].revision + 1,
      updatedAt: now,
      lastSeen: now,
      queueExpiresAt: now + 180_000,
    };
  }
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: attempts,
      trainingRooms: {
        "-0000000000000000001": corruptedRoom,
      },
    },
  });
  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);
  assert.equal(result.terminalized, 2);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].state,
    "terminal",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-guest"].state,
    "terminal",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].reservedAt,
    undefined,
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"]
      .pendingRoomCleanup.roomAttemptId,
    "cleanup-pair-attempt-token1",
  );
});

test("cleanup repairs a reconnect epoch gap without terminalizing the active pair", async () => {
  const now = 1_900_000_000_000;
  const reservedAt = now - (11 * 60 * 1000);
  const roomId = "-0000000000000000001";
  const roomAttemptId = "cleanup-reconnect-attempt-token";
  const oldTransportEpoch = "cleanup-old-transport-token-1";
  const nextTransportEpoch = "cleanup-next-transport-token1";
  const hostIdentity = {
    runId: "cleanup-reconnect-host-run-token",
    endpointId: "cleanup-reconnect-host-endpoint",
    ownerEpoch: "cleanup-reconnect-host-owner-token",
  };
  const guestIdentity = {
    runId: "cleanup-reconnect-guest-run-token",
    endpointId: "cleanup-reconnect-guest-endpoint",
    ownerEpoch: "cleanup-reconnect-guest-owner-token",
  };
  let attempts = training.startAttemptDecision({
    attempts: {},
    uid: "cleanup-host",
    ...hostIdentity,
    preparation: validPreparation("HOST"),
    now: reservedAt - 2,
  }).attempts;
  attempts = training.startAttemptDecision({
    attempts,
    uid: "cleanup-guest",
    ...guestIdentity,
    preparation: validPreparation("GUEST"),
    now: reservedAt - 1,
  }).attempts;
  attempts = training.reserveMatchDecision({
    attempts,
    uid: "cleanup-host",
    ...hostIdentity,
    roomId,
    roomAttemptId,
    transportEpoch: oldTransportEpoch,
    now: reservedAt,
  }).attempts;
  attempts = training.activateMatchDecision({
    attempts,
    uid: "cleanup-host",
    roomAttemptId,
    now: reservedAt + 1,
  }).attempts;
  const room = training.buildActiveTrainingRoom({
    host: attempts["cleanup-host"],
    guest: attempts["cleanup-guest"],
    chatFrames: { "cleanup-host": "", "cleanup-guest": "" },
    now: reservedAt + 1,
  });
  for (const uid of ["cleanup-host", "cleanup-guest"]) {
    attempts[uid] = {
      ...attempts[uid],
      revision: attempts[uid].revision + 1,
      updatedAt: now,
      transportEpoch: nextTransportEpoch,
    };
  }
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: attempts,
      trainingRooms: { [roomId]: room },
    },
  });

  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);

  assert.equal(result.terminalized, 0);
  assert.equal(result.kept, 2);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].state,
    "active",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-guest"].state,
    "active",
  );
  assert.equal(
    realtime.data.online.trainingRooms[roomId].transportEpoch,
    nextTransportEpoch,
  );
  assert.equal(realtime.data.online.trainingRooms[roomId].destroyed, undefined);

  const nextPass = await cleanup(now + 1);
  assert.equal(nextPass.terminalized, 0);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].state,
    "active",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-guest"].state,
    "active",
  );
});

test("cleanup ends a stale offline participant even while the peer is fresh online", async () => {
  const now = 1_900_000_000_000;
  const fixture = activePairFixture(now, {
    hostLastSeen: now - ACTIVE_ORPHAN_GRACE_MS - 1,
    guestLastSeen: now - 1_000,
  });
  const host = fixture.attempts["cleanup-host"];
  const guest = fixture.attempts["cleanup-guest"];
  fixture.room.presenceV5 = {
    "cleanup-host": {
      [host.runId]: exactPresence(host, now - 1, false),
    },
    "cleanup-guest": {
      [guest.runId]: exactPresence(guest, now - 1, true),
    },
  };
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: fixture.attempts,
      trainingRooms: { [fixture.roomId]: fixture.room },
    },
  });

  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);

  assert.equal(result.terminalized, 2);
  assert.equal(result.drained, 1);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].terminalReason,
    "active_abandoned",
  );
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-guest"].terminalReason,
    "active_abandoned",
  );
  assert.equal(
    realtime.data.online.trainingRooms[fixture.roomId].destroyed.reason,
    "active_abandoned",
  );
});

test("cleanup preserves a stale heartbeat with fresh online presence", async () => {
  const now = 1_900_000_000_000;
  const fixture = activePairFixture(now, {
    hostLastSeen: now - ACTIVE_ORPHAN_GRACE_MS - 1,
    guestLastSeen: now - 1_000,
  });
  const host = fixture.attempts["cleanup-host"];
  fixture.room.presenceV5 = {
    "cleanup-host": {
      [host.runId]: exactPresence(host, now - 1, true),
    },
  };
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: fixture.attempts,
      trainingRooms: { [fixture.roomId]: fixture.room },
    },
  });

  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);

  assert.equal(result.terminalized, 0);
  assert.equal(result.kept, 2);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].state,
    "active",
  );
  assert.equal(realtime.data.online.trainingRooms[fixture.roomId].destroyed, undefined);
});

test("cleanup preserves a short background interval without presence", async () => {
  const now = 1_900_000_000_000;
  const fixture = activePairFixture(now, {
    hostLastSeen: now - ACTIVE_ORPHAN_GRACE_MS + 1,
    guestLastSeen: now - 1_000,
  });
  const realtime = new Realtime({
    online: {
      trainingAttemptsV5: fixture.attempts,
      trainingRooms: { [fixture.roomId]: fixture.room },
    },
  });

  const cleanup = createTrainingSessionV5Cleanup({ realtime });
  const result = await cleanup(now);

  assert.equal(result.terminalized, 0);
  assert.equal(result.kept, 2);
  assert.equal(
    realtime.data.online.trainingAttemptsV5["cleanup-host"].state,
    "active",
  );
  assert.equal(realtime.data.online.trainingRooms[fixture.roomId].destroyed, undefined);
});
