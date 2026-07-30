"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  TRAINING_ATTEMPT_TTL_MS,
} = require("../training-session-v5");
const {
  ACTIVE_ORPHAN_GRACE_MS,
} = require("../training-session-v5-cleanup");
const {
  PATHS,
  createTrainingSessionV5Service,
} = require("../training-session-v5-service");

const START = 1_900_000_000_000;
const HOST_UID = "service-v5-host";
const GUEST_UID = "service-v5-guest";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function segments(value) {
  return String(value || "").split("/").filter(Boolean);
}

function getAt(root, value) {
  let current = root;
  for (const key of segments(value)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function setAt(root, value, nextValue) {
  const keys = segments(value);
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  if (nextValue == null) delete current[keys.at(-1)];
  else current[keys.at(-1)] = clone(nextValue);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
  }

  val() {
    return clone(this.value);
  }
}

class FakeReference {
  constructor(database, value) {
    this.database = database;
    this.path = segments(value).join("/");
  }

  get key() {
    return segments(this.path).at(-1) || null;
  }

  async get() {
    if (this.database.getFailures.has(this.path)) {
      throw new Error(`forced get failure: ${this.path}`);
    }
    return new FakeSnapshot(getAt(this.database.data, this.path));
  }

  push() {
    this.database.pushCount += 1;
    const key = `-${String(this.database.pushCount).padStart(19, "0")}`;
    return new FakeReference(
      this.database,
      [this.path, key].filter(Boolean).join("/"),
    );
  }

  async transaction(update) {
    const count = (this.database.transactionCounts.get(this.path) || 0) + 1;
    this.database.transactionCounts.set(this.path, count);
    const transactionFailures = this.database.transactionFailures.get(this.path);
    if (transactionFailures?.delete(count)) {
      throw new Error(`forced transaction failure: ${this.path}`);
    }
    const blockerKey = `${this.path}#${count}`;
    const blocker = this.database.transactionBlockers.get(blockerKey);
    if (blocker) {
      blocker.enter();
      await blocker.wait;
      this.database.transactionBlockers.delete(blockerKey);
    }
    const current = clone(getAt(this.database.data, this.path));
    const next = update(current);
    if (next === undefined) {
      return { committed: false, snapshot: new FakeSnapshot(current) };
    }
    setAt(this.database.data, this.path, next);
    const failures = this.database.afterCommitFailures.get(this.path);
    if (failures?.delete(count)) {
      throw new Error(`forced response loss after commit: ${this.path}`);
    }
    return {
      committed: true,
      snapshot: new FakeSnapshot(getAt(this.database.data, this.path)),
    };
  }
}

class FakeRealtime {
  constructor() {
    this.data = {};
    this.pushCount = 0;
    this.transactionCounts = new Map();
    this.transactionFailures = new Map();
    this.transactionBlockers = new Map();
    this.afterCommitFailures = new Map();
    this.getFailures = new Set();
  }

  ref(value) {
    return new FakeReference(this, value);
  }

  read(value) {
    return clone(getAt(this.data, value));
  }

  write(value, entry) {
    setAt(this.data, value, entry);
  }

  failGet(value) {
    this.getFailures.add(segments(value).join("/"));
  }

  failAfterCommit(value, offset = 1) {
    const normalized = segments(value).join("/");
    const count = (this.transactionCounts.get(normalized) || 0) + offset;
    const failures = this.afterCommitFailures.get(normalized) || new Set();
    failures.add(count);
    this.afterCommitFailures.set(normalized, failures);
  }

  failTransaction(value, offset = 1) {
    const normalized = segments(value).join("/");
    const count = (this.transactionCounts.get(normalized) || 0) + offset;
    const failures = this.transactionFailures.get(normalized) || new Set();
    failures.add(count);
    this.transactionFailures.set(normalized, failures);
  }

  blockNextTransaction(value) {
    const normalized = segments(value).join("/");
    const count = (this.transactionCounts.get(normalized) || 0) + 1;
    let release;
    let enter;
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    const entered = new Promise((resolve) => {
      enter = resolve;
    });
    this.transactionBlockers.set(`${normalized}#${count}`, {
      wait,
      enter,
    });
    return { entered, release };
  }
}

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function preparation(name, chatFrameId = "") {
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
    chatFrameId,
  };
}

function identity(uid, suffix = "") {
  return {
    runId: `${uid}-run-token-${suffix}1234567890`,
    endpointId: `${uid}-endpoint-${suffix}1234567890`,
  };
}

function exactPresence(attempt, updatedAt, online = true) {
  return {
    protocolVersion: 5,
    runId: attempt.runId,
    endpointId: attempt.endpointId,
    ownerEpoch: attempt.ownerEpoch,
    roomAttemptId: attempt.roomAttemptId,
    transportEpoch: attempt.transportEpoch,
    online,
    updatedAt,
  };
}

function harness() {
  const realtime = new FakeRealtime();
  let timestamp = START;
  const service = createTrainingSessionV5Service({
    realtime,
    HttpsError: FakeHttpsError,
    crypto,
    now: () => timestamp,
  });
  return {
    realtime,
    service,
    now: () => timestamp,
    advance(milliseconds) {
      timestamp += milliseconds;
    },
  };
}

async function start(h, uid, suffix = "", frame = "") {
  const owner = identity(uid, suffix);
  const result = await h.service.start(uid, {
    ...owner,
    preparation: preparation(uid, frame),
  });
  assert.equal(result.started, true);
  return { ...owner, ownerEpoch: result.ownerEpoch };
}

async function pair(h) {
  const host = await start(h, HOST_UID);
  const guest = await start(h, GUEST_UID);
  const matched = await h.service.match(HOST_UID, host);
  assert.equal(matched.outcome, "active");
  return { host, guest, matched };
}

test("heartbeat reclaims the same attempt after 181 seconds", async () => {
  const h = harness();
  const owner = await start(h, HOST_UID);
  const first = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  h.advance(TRAINING_ATTEMPT_TTL_MS + 1_000);

  const heartbeat = await h.service.heartbeat(HOST_UID, owner);
  const reclaimed = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.reason, "reclaimed");
  assert.equal(heartbeat.ownerEpoch, owner.ownerEpoch);
  assert.ok(reclaimed.queueExpiresAt > h.now());
  assert.equal(reclaimed.revision, first.revision + 1);
});

test("attempt responses include the exact client identity fence", async () => {
  const h = harness();
  const owner = identity(HOST_UID, "view-");
  const response = await h.service.start(HOST_UID, {
    ...owner,
    preparation: preparation(HOST_UID),
  });
  assert.equal(response.uid, HOST_UID);
  assert.equal(response.runId, owner.runId);
  assert.equal(response.endpointId, owner.endpointId);
  assert.ok(response.ownerEpoch);
});

test("a fresh owner is not replaced, while a stale waiter can be taken over", async () => {
  const h = harness();
  const firstOwner = await start(h, HOST_UID, "first-");
  const blockedIdentity = identity(HOST_UID, "second-");
  const blocked = await h.service.start(HOST_UID, {
    ...blockedIdentity,
    preparation: preparation("SECOND"),
  });
  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });

  h.advance(TRAINING_ATTEMPT_TTL_MS + 1_000);
  const replaced = await h.service.start(HOST_UID, {
    ...blockedIdentity,
    preparation: preparation("SECOND"),
  });
  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.notEqual(replaced.ownerEpoch, firstOwner.ownerEpoch);

  const oldHeartbeat = await h.service.heartbeat(HOST_UID, firstOwner);
  assert.deepEqual(oldHeartbeat, { owned: false, reason: "owner-replaced" });
});

test("a new endpoint can replace an abandoned active attempt without scheduler delay", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_ORPHAN_GRACE_MS + 1);
  const replacement = identity(HOST_UID, "replacement-");

  const replaced = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("REPLACEMENT"),
  });

  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(hostAfter.state, "waiting");
  assert.equal(hostAfter.runId, replacement.runId);
  assert.equal(guestAfter.state, "terminal");
  assert.equal(guestAfter.terminalReason, "active_abandoned");
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed.reason,
    "active_abandoned",
  );
});

test("a fresh exact online presence protects an active attempt from endpoint takeover", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_ORPHAN_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  const hostAttempt = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  room.presenceV5 = {
    [HOST_UID]: {
      [hostAttempt.runId]: exactPresence(hostAttempt, h.now()),
    },
  };
  h.realtime.write(roomPath, room);
  const replacement = identity(HOST_UID, "replacement-");

  const blocked = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("REPLACEMENT"),
  });

  assert.equal(blocked.started, false);
  assert.equal(blocked.reason, "owner-replaced");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state,
    "active",
  );
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("two concurrent match calls reserve one atomic pair and one room", async () => {
  const h = harness();
  const host = await start(h, HOST_UID);
  const guest = await start(h, GUEST_UID);
  const [first, second] = await Promise.all([
    h.service.match(HOST_UID, host),
    h.service.match(GUEST_UID, guest),
  ]);
  assert.equal(first.outcome, "active");
  assert.equal(second.outcome, "active");
  assert.equal(first.roomId, second.roomId);
  assert.equal(first.roomAttemptId, second.roomAttemptId);
  assert.equal(h.realtime.pushCount, 2);

  const attempts = h.realtime.read(PATHS.attempts);
  assert.equal(attempts[HOST_UID].state, "active");
  assert.equal(attempts[GUEST_UID].state, "active");
  assert.equal(attempts[HOST_UID].roomId, attempts[GUEST_UID].roomId);
  const rooms = h.realtime.read(PATHS.rooms);
  assert.equal(Object.keys(rooms).length, 1);
  const room = rooms[first.roomId];
  assert.equal(room.sessionProtocolVersion, 5);
  assert.equal(room.signalingVersion, 5);
  assert.deepEqual(room.accepted, { [HOST_UID]: true, [GUEST_UID]: true });
  assert.ok(room.rounds[1].createdAt);
});

test("inspect completes materialization after the room write response is lost", async () => {
  const h = harness();
  const host = await start(h, HOST_UID);
  await start(h, GUEST_UID);
  const roomId = "-0000000000000000001";
  h.realtime.failAfterCommit(`${PATHS.rooms}/${roomId}`);

  await assert.rejects(
    h.service.match(HOST_UID, host),
    /forced response loss after commit/,
  );
  assert.equal(h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state, "reserved");
  assert.equal(h.realtime.read(`${PATHS.rooms}/${roomId}`).status, "active");

  const recovered = await h.service.inspect(HOST_UID, host);
  assert.equal(recovered.outcome, "active");
  assert.equal(recovered.roomId, roomId);
  assert.equal(h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state, "active");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state, "active");
});

test("active liveRoom ignores an expired queue timestamp", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  h.advance(TRAINING_ATTEMPT_TTL_MS + 1_000);
  const live = await h.service.liveRoom(HOST_UID, h.now());
  assert.equal(live.roomId, matched.roomId);
  assert.equal(live.role, "host");
  assert.equal(live.attempt.ownerEpoch, host.ownerEpoch);
});

test("cancel restores a reserved peer and fences late room materialization", async () => {
  const h = harness();
  const host = await start(h, HOST_UID);
  const guest = await start(h, GUEST_UID);
  const roomId = "-0000000000000000001";
  h.realtime.failAfterCommit(`${PATHS.rooms}/${roomId}`);
  await assert.rejects(h.service.match(HOST_UID, host));

  const cancelled = await h.service.cancel(GUEST_UID, guest);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.state, "terminal");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state, "waiting");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state, "terminal");
  assert.equal(h.realtime.read(`${PATHS.rooms}/${roomId}`).destroyed.reason, "cancelled");
});

test("cancel destroys an active room and terminalizes both attempts", async () => {
  const h = harness();
  const { guest, matched } = await pair(h);
  const cancelled = await h.service.cancel(GUEST_UID, guest);
  assert.equal(cancelled.cancelled, true);
  assert.equal(h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason, "cancelled");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).terminalReason,
    "opponent-cancelled",
  );
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed.reason,
    "cancelled",
  );
  assert.equal(await h.service.liveRoom(HOST_UID), null);
});

test("cancel retry drains its durable room fence after a transient destroy failure", async () => {
  const h = harness();
  const { guest, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  h.realtime.failTransaction(roomPath);

  await assert.rejects(
    h.service.cancel(GUEST_UID, guest),
    /forced transaction failure/,
  );
  const pending = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  assert.equal(pending.state, "terminal");
  assert.equal(pending.pendingRoomCleanup.roomId, matched.roomId);
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);

  const retried = await h.service.cancel(GUEST_UID, guest);
  assert.equal(retried.cancelled, true);
  assert.equal(
    h.realtime.read(roomPath).destroyed.reason,
    "cancelled",
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).pendingRoomCleanup,
    undefined,
  );
});

test("stale reservation replacement fences a late room without refreshing its peer", async () => {
  const h = harness();
  const host = await start(h, HOST_UID, "old-");
  await start(h, GUEST_UID, "old-");
  const guestBefore = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  const roomId = "-0000000000000000001";
  h.realtime.failTransaction(`${PATHS.rooms}/${roomId}`);
  await assert.rejects(h.service.match(HOST_UID, host));

  h.advance(TRAINING_ATTEMPT_TTL_MS + 1_000);
  const replacement = identity(HOST_UID, "new-");
  const replaced = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("NEW"),
  });
  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  assert.equal(guestAfter.state, "waiting");
  assert.equal(guestAfter.lastSeen, guestBefore.lastSeen);
  assert.equal(guestAfter.queueExpiresAt, guestBefore.queueExpiresAt);
  assert.equal(h.realtime.read(`${PATHS.rooms}/${roomId}`).status, "destroyed");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).pendingRoomCleanup,
    undefined,
  );
});

test("heartbeat releases a reserved pair when the untouched peer lease expired", async () => {
  const h = harness();
  const host = await start(h, HOST_UID);
  await start(h, GUEST_UID);
  const roomId = "-0000000000000000001";
  h.realtime.failTransaction(`${PATHS.rooms}/${roomId}`);
  await assert.rejects(
    h.service.match(HOST_UID, host),
    /forced transaction failure/,
  );
  const guestBefore = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);

  h.advance(TRAINING_ATTEMPT_TTL_MS + 1_000);
  const heartbeat = await h.service.heartbeat(HOST_UID, host);
  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);

  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.outcome, "waiting");
  assert.equal(heartbeat.reason, "recovering");
  assert.equal(hostAfter.state, "waiting");
  assert.equal(guestAfter.state, "waiting");
  assert.equal(guestAfter.lastSeen, guestBefore.lastSeen);
  assert.equal(guestAfter.queueExpiresAt, guestBefore.queueExpiresAt);
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${roomId}`).destroyed.reason,
    "reservation-stale",
  );
});

test("inspect terminalizes an active orphan instead of leaving a stuck attempt", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  h.realtime.write(`${PATHS.attempts}/${GUEST_UID}`, null);

  const inspected = await h.service.inspect(HOST_UID, host);
  assert.equal(inspected.outcome, "terminal");
  assert.equal(inspected.terminalReason, "pair-broken");
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed.reason,
    "pair-broken",
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).pendingRoomCleanup,
    undefined,
  );
});

test("heartbeat also converges an active attempt whose peer disappeared", async () => {
  const h = harness();
  const { host } = await pair(h);
  h.realtime.write(`${PATHS.attempts}/${GUEST_UID}`, null);
  const heartbeat = await h.service.heartbeat(HOST_UID, host);
  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.outcome, "terminal");
  assert.equal(heartbeat.terminalReason, "pair-broken");
});

test("materialization rejects a room whose peer session identity is corrupted", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  room.sessions[GUEST_UID].endpointId = "corrupted-peer-endpoint-token";
  h.realtime.write(roomPath, room);

  const inspected = await h.service.inspect(HOST_UID, host);
  assert.equal(inspected.outcome, "terminal");
  assert.equal(inspected.terminalReason, "room-mismatch");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state,
    "terminal",
  );
  assert.equal(h.realtime.read(roomPath).destroyed.reason, "room-mismatch");
});

test("lost reconnect response is retried idempotently and materializes one epoch", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const request = {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  };
  h.realtime.failAfterCommit(PATHS.attempts);
  await assert.rejects(
    h.service.reconnect(HOST_UID, request),
    /forced response loss after commit/,
  );
  const rotated = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  assert.notEqual(rotated.transportEpoch, matched.transportEpoch);
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).transportEpoch,
    matched.transportEpoch,
  );

  const retried = await h.service.reconnect(HOST_UID, request);
  assert.equal(retried.outcome, "active");
  assert.equal(retried.transportEpoch, rotated.transportEpoch);
  assert.equal(retried.uid, HOST_UID);
  assert.equal(retried.runId, host.runId);
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).transportEpoch,
    rotated.transportEpoch,
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).revision,
    rotated.revision,
  );
});

test("heartbeat repairs the room after reconnect committed only the attempt epoch", async () => {
  const h = harness();
  const { host, guest, matched } = await pair(h);
  const request = {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  };
  h.realtime.failAfterCommit(PATHS.attempts);
  await assert.rejects(
    h.service.reconnect(HOST_UID, request),
    /forced response loss after commit/,
  );
  const rotated = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  assert.notEqual(rotated.transportEpoch, matched.transportEpoch);

  const heartbeat = await h.service.heartbeat(GUEST_UID, guest);
  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  const roomAfter = h.realtime.read(`${PATHS.rooms}/${matched.roomId}`);

  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.outcome, "active");
  assert.equal(hostAfter.state, "active");
  assert.equal(guestAfter.state, "active");
  assert.equal(hostAfter.transportEpoch, rotated.transportEpoch);
  assert.equal(guestAfter.transportEpoch, rotated.transportEpoch);
  assert.equal(roomAfter.transportEpoch, rotated.transportEpoch);
  assert.equal(roomAfter.destroyed, undefined);
});

test("simultaneous peer reconnects converge on one shared transport epoch", async () => {
  const h = harness();
  const { host, guest, matched } = await pair(h);
  const [hostResult, guestResult] = await Promise.all([
    h.service.reconnect(HOST_UID, {
      ...host,
      roomAttemptId: matched.roomAttemptId,
      transportEpoch: matched.transportEpoch,
    }),
    h.service.reconnect(GUEST_UID, {
      ...guest,
      roomAttemptId: matched.roomAttemptId,
      transportEpoch: matched.transportEpoch,
    }),
  ]);
  assert.equal(hostResult.outcome, "active");
  assert.equal(guestResult.outcome, "active");
  assert.notEqual(hostResult.transportEpoch, matched.transportEpoch);
  assert.equal(hostResult.transportEpoch, guestResult.transportEpoch);
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).transportEpoch,
    hostResult.transportEpoch,
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).transportEpoch,
    hostResult.transportEpoch,
  );
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).transportEpoch,
    hostResult.transportEpoch,
  );
});

test("a delayed old reconnect cannot roll a newer room epoch backward", async () => {
  const h = harness();
  const { host, guest, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const oldRequest = {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  };
  const blocker = h.realtime.blockNextTransaction(roomPath);
  const delayed = h.service.reconnect(HOST_UID, oldRequest);
  await blocker.entered;

  const synchronized = await h.service.reconnect(GUEST_UID, {
    ...guest,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  });
  const middleEpoch = synchronized.transportEpoch;
  assert.notEqual(middleEpoch, matched.transportEpoch);
  assert.equal(h.realtime.read(roomPath).transportEpoch, middleEpoch);

  const newest = await h.service.reconnect(GUEST_UID, {
    ...guest,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: middleEpoch,
  });
  assert.notEqual(newest.transportEpoch, middleEpoch);
  blocker.release();
  const delayedResult = await delayed;

  assert.equal(delayedResult.transportEpoch, newest.transportEpoch);
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).transportEpoch,
    newest.transportEpoch,
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).transportEpoch,
    newest.transportEpoch,
  );
  assert.equal(h.realtime.read(roomPath).transportEpoch, newest.transportEpoch);
});

test("server-finalized rooms are never reported live", async () => {
  const h = harness();
  const { matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  room.serverFinalized = { at: h.now(), reason: "complete" };
  h.realtime.write(roomPath, room);
  assert.equal(await h.service.liveRoom(HOST_UID), null);
});

test("liveRoom requires the reciprocal peer and both room session identities", async () => {
  const h = harness();
  const { matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  room.sessions[GUEST_UID].ownerEpoch = "corrupted-live-peer-owner-token";
  h.realtime.write(roomPath, room);
  assert.equal(await h.service.liveRoom(HOST_UID), null);
});

test("a replaced owner cannot cancel the current owner's room", async () => {
  const h = harness();
  const { guest: oldGuest, matched } = await pair(h);
  const currentGuest = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  const replacement = identity(GUEST_UID, "replacement-");
  currentGuest.runId = replacement.runId;
  currentGuest.endpointId = replacement.endpointId;
  currentGuest.ownerEpoch = `${GUEST_UID}-owner-replacement-1234567890`;
  currentGuest.revision += 1;
  h.realtime.write(`${PATHS.attempts}/${GUEST_UID}`, currentGuest);

  const room = h.realtime.read(`${PATHS.rooms}/${matched.roomId}`);
  room.sessions[GUEST_UID] = {
    runId: currentGuest.runId,
    endpointId: currentGuest.endpointId,
    ownerEpoch: currentGuest.ownerEpoch,
  };
  h.realtime.write(`${PATHS.rooms}/${matched.roomId}`, room);

  const cancelled = await h.service.cancel(GUEST_UID, oldGuest);
  assert.deepEqual(cancelled, { cancelled: false, reason: "owner-replaced" });
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed,
    undefined,
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).ownerEpoch,
    currentGuest.ownerEpoch,
  );
});

test("economy verification failure keeps matching available with standard frames", async () => {
  const h = harness();
  const frameId = "chat_frame_neon";
  const host = await start(h, HOST_UID, "", frameId);
  await start(h, GUEST_UID, "", frameId);
  h.realtime.write(`${PATHS.economy}/${HOST_UID}`, {
    inventory: { [frameId]: true },
    equipped: { chatFrame: frameId },
  });
  h.realtime.write(`${PATHS.economy}/${GUEST_UID}`, {
    inventory: { [frameId]: true },
    equipped: { chatFrame: frameId },
  });
  h.realtime.failGet(`${PATHS.economy}/${HOST_UID}`);
  const originalWarn = console.warn;
  console.warn = () => {};
  let matched;
  try {
    matched = await h.service.match(HOST_UID, host);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(matched.outcome, "active");
  assert.deepEqual(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).chatFrames,
    { [HOST_UID]: "", [GUEST_UID]: "" },
  );
});
