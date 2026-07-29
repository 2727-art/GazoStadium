"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  TRAINING_GAME_PROTOCOL_VERSION,
  TRAINING_GAME_VARIANT,
  TRAINING_ROOM_TRANSITION_TTL_MS,
  TRAINING_SESSION_LEASE_TTL_MS,
  TRAINING_SESSION_PROTOCOL_VERSION,
} = require("../training-session-v2");
const {
  PATHS,
  createTrainingSessionService,
} = require("../training-session-service");

const START = 1_800_000_000_000;
const HOST_UID = "training-host";
const GUEST_UID = "training-guest";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function segments(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean);
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
  if (!keys.length) {
    throw new TypeError("the fake database root cannot be replaced");
  }
  let current = root;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  const leaf = keys.at(-1);
  if (nextValue == null) {
    delete current[leaf];
    return;
  }
  current[leaf] = clone(nextValue);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
  }

  val() {
    return clone(this.value);
  }

  exists() {
    return this.value != null;
  }

  numChildren() {
    return this.value && typeof this.value === "object"
      ? Object.keys(this.value).length
      : 0;
  }

  child(value) {
    return new FakeSnapshot(getAt(this.value, value));
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

  child(value) {
    return new FakeReference(this.database, [this.path, value].filter(Boolean).join("/"));
  }

  async get() {
    if (this.database.getFailurePaths.has(this.path)) {
      throw new Error(`forced get failure: ${this.path}`);
    }
    return new FakeSnapshot(getAt(this.database.data, this.path));
  }

  async set(value) {
    setAt(this.database.data, this.path, value);
  }

  async remove() {
    setAt(this.database.data, this.path, null);
  }

  async update(values) {
    for (const [relativePath, value] of Object.entries(values || {})) {
      setAt(
        this.database.data,
        [this.path, relativePath].filter(Boolean).join("/"),
        value,
      );
    }
  }

  push() {
    this.database.pushCount += 1;
    const key = `-${String(this.database.pushCount).padStart(19, "0")}`;
    return new FakeReference(this.database, [this.path, key].filter(Boolean).join("/"));
  }

  async transaction(update) {
    this.database.transactionCounts.set(
      this.path,
      (this.database.transactionCounts.get(this.path) || 0) + 1,
    );
    const transactionNumber = this.database.transactionCounts.get(this.path);
    const hooks = this.database.transactionHooks.get(this.path) || [];
    const hookIndex = hooks.findIndex(({ at }) => at === transactionNumber);
    if (hookIndex >= 0) {
      const [{ callback }] = hooks.splice(hookIndex, 1);
      callback(this.database);
    }
    const current = clone(getAt(this.database.data, this.path));
    if (current != null && this.database.coldCacheNullOncePaths.delete(this.path)) {
      const coldCacheNext = update(null);
      if (coldCacheNext === undefined) {
        return {
          committed: false,
          snapshot: new FakeSnapshot(null),
        };
      }
    }
    const next = update(current);
    if (next !== undefined
        && current != null
        && this.database.deleteBeforeCommitOncePaths.delete(this.path)) {
      setAt(this.database.data, this.path, null);
      const retryNext = update(null);
      if (retryNext === undefined) {
        return {
          committed: false,
          snapshot: new FakeSnapshot(null),
        };
      }
      setAt(this.database.data, this.path, retryNext);
      return {
        committed: true,
        snapshot: new FakeSnapshot(getAt(this.database.data, this.path)),
      };
    }
    if (next === undefined) {
      return {
        committed: false,
        snapshot: new FakeSnapshot(current),
      };
    }
    setAt(this.database.data, this.path, next);
    return {
      committed: true,
      snapshot: new FakeSnapshot(getAt(this.database.data, this.path)),
    };
  }
}

class FakeRealtime {
  constructor(initial = {}) {
    this.data = {};
    this.pushCount = 0;
    this.transactionCounts = new Map();
    this.transactionHooks = new Map();
    this.coldCacheNullOncePaths = new Set();
    this.deleteBeforeCommitOncePaths = new Set();
    this.getFailurePaths = new Set();
    for (const [value, entry] of Object.entries(initial)) {
      setAt(this.data, value, entry);
    }
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

  beforeFutureTransaction(value, offset, callback) {
    const normalizedPath = segments(value).join("/");
    const at = (this.transactionCounts.get(normalizedPath) || 0) + offset;
    const hooks = this.transactionHooks.get(normalizedPath) || [];
    hooks.push({ at, callback });
    this.transactionHooks.set(normalizedPath, hooks);
  }

  coldCacheNullOnce(value) {
    this.coldCacheNullOncePaths.add(segments(value).join("/"));
  }

  deleteBeforeCommitOnce(value) {
    this.deleteBeforeCommitOncePaths.add(segments(value).join("/"));
  }

  failGet(value) {
    this.getFailurePaths.add(segments(value).join("/"));
  }
}

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

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

function harness() {
  const realtime = new FakeRealtime();
  let timestamp = START;
  const service = createTrainingSessionService({
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

function credentials(uid) {
  return {
    sessionId: `${uid}-session-token-123456`,
    leaseToken: `${uid}-lease-token-12345678`,
  };
}

async function claim(h, uid) {
  const value = credentials(uid);
  const response = await h.service.claim(uid, value);
  assert.equal(response.claimed, true);
  return {
    ...value,
    generation: response.sessionGeneration,
    expiresAt: response.lease.expiresAt,
  };
}

function queueEntry(uid, lease, timestamp, {
  joinedAt = timestamp - 1_000,
  connectionGeneration = `${uid}-connection-generation`,
} = {}) {
  return {
    protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
    trainingProtocolVersion: TRAINING_GAME_PROTOCOL_VERSION,
    variant: TRAINING_GAME_VARIANT,
    uid,
    sessionId: lease.sessionId,
    leaseToken: lease.leaseToken,
    generation: lease.generation,
    connectionGeneration,
    name: uid === HOST_UID ? "HOST" : "GUEST",
    intensity: uid === HOST_UID ? "strong" : "standard",
    commandDeck: commandDeck(uid),
    imageBpms: imageBpms(uid === HOST_UID ? 0 : 1),
    joinedAt,
    lastSeen: timestamp,
    expiresAt: lease.expiresAt,
    state: "waiting",
  };
}

function enqueueInput(uid, lease, overrides = {}) {
  return {
    sessionId: lease.sessionId,
    leaseToken: lease.leaseToken,
    name: uid === HOST_UID ? "HOST" : "GUEST",
    intensity: uid === HOST_UID ? "strong" : "standard",
    commandDeck: commandDeck(uid),
    imageBpms: imageBpms(uid === HOST_UID ? 0 : 1),
    ...overrides,
  };
}

function queuePath(uid, lease) {
  return `${PATHS.queue}/${uid}/${lease.sessionId}`;
}

async function queue(h, uid, lease, options = {}) {
  h.realtime.write(
    queuePath(uid, lease),
    queueEntry(uid, lease, h.now(), options),
  );
}

async function offeredPair(h) {
  const host = await claim(h, HOST_UID);
  const guest = await claim(h, GUEST_UID);
  assert.equal(
    (await h.service.enqueue(
      HOST_UID,
      enqueueInput(HOST_UID, host),
    )).queued,
    true,
  );
  assert.equal(
    (await h.service.enqueue(
      GUEST_UID,
      enqueueInput(GUEST_UID, guest),
    )).queued,
    true,
  );
  const offer = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "膝に違和感あり",
  });
  assert.equal(offer.outcome, "offered");
  return { host, guest, offer };
}

test("claim, heartbeat, and inactive release keep the V2 lease fence", async () => {
  const h = harness();
  const lease = await claim(h, HOST_UID);
  const firstExpiry = lease.expiresAt;
  await queue(h, HOST_UID, lease);

  h.advance(10_000);
  const heartbeat = await h.service.heartbeat(HOST_UID, {
    sessionId: lease.sessionId,
    leaseToken: lease.leaseToken,
    generation: lease.generation,
  });

  assert.equal(heartbeat.claimed, true);
  assert.equal(heartbeat.sessionGeneration, lease.generation);
  assert.ok(heartbeat.lease.expiresAt > firstExpiry);
  assert.equal(
    h.realtime.read(queuePath(HOST_UID, lease)).expiresAt,
    heartbeat.lease.expiresAt,
  );

  const released = await h.service.release(HOST_UID, {
    sessionId: lease.sessionId,
    leaseToken: lease.leaseToken,
    generation: lease.generation,
  });
  assert.deepEqual(released, { released: true });
  assert.equal(h.realtime.read(queuePath(HOST_UID, lease)), undefined);
  assert.equal(h.realtime.read(`${PATHS.claims}/${HOST_UID}`), undefined);
});

test("enqueue creates one server-owned waiting row and preserves its generation", async () => {
  const h = harness();
  const lease = await claim(h, HOST_UID);
  const created = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, lease),
  );
  assert.equal(created.queued, true);
  assert.match(created.connectionGeneration, /^[A-Za-z0-9_-]{20,80}$/);
  const first = h.realtime.read(queuePath(HOST_UID, lease));
  assert.equal(first.connectionGeneration, created.connectionGeneration);
  assert.equal(first.state, "waiting");
  assert.equal(first.generation, lease.generation);
  assert.equal(first.name, "HOST");

  h.advance(10_000);
  const refreshed = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, lease, {
      name: "CHANGED",
    }),
  );
  const second = h.realtime.read(queuePath(HOST_UID, lease));
  assert.deepEqual(refreshed, {
    queued: true,
    connectionGeneration: created.connectionGeneration,
  });
  assert.equal(second.connectionGeneration, first.connectionGeneration);
  assert.equal(second.name, "HOST");
  assert.equal(second.joinedAt, first.joinedAt);
  assert.equal(second.lastSeen, h.now());
});

test("enqueue rejects malformed preparation before rate or queue mutation", async () => {
  const h = harness();
  const lease = await claim(h, HOST_UID);
  const ratesBefore = clone(h.realtime.read(PATHS.rates));
  const malformed = enqueueInput(HOST_UID, lease);
  malformed.commandDeck[1].beatsPerRep = 3;
  await assert.rejects(
    h.service.enqueue(HOST_UID, malformed),
    (error) => error instanceof FakeHttpsError
      && error.code === "invalid-argument",
  );
  assert.deepEqual(h.realtime.read(PATHS.rates), ratesBefore);
  assert.equal(h.realtime.read(queuePath(HOST_UID, lease)), undefined);
});

test("matchmaking snapshots only purchased and equipped training chat frames", async () => {
  const h = harness();
  const host = await claim(h, HOST_UID);
  const guest = await claim(h, GUEST_UID);
  const hostFrameId = "chat_frame_neon";
  const guestFrameId = "chat_frame_lace";

  h.realtime.write(`${PATHS.economy}/${HOST_UID}`, {
    inventory: { [hostFrameId]: true },
    equipped: { chatFrame: hostFrameId },
  });
  h.realtime.write(`${PATHS.economy}/${GUEST_UID}`, {
    inventory: { [guestFrameId]: true },
    equipped: { chatFrame: guestFrameId },
  });

  assert.equal((await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host, { chatFrameId: hostFrameId }),
  )).queued, true);
  assert.equal((await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest, { chatFrameId: guestFrameId }),
  )).queued, true);

  const offer = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });
  assert.equal(offer.outcome, "offered");

  const room = h.realtime.read(`${PATHS.rooms}/${offer.roomId}`);
  const permit = h.realtime.read(`${PATHS.permits}/${offer.roomId}`);
  assert.deepEqual(room.chatFrames, {
    [HOST_UID]: hostFrameId,
    [GUEST_UID]: guestFrameId,
  });
  assert.equal(Object.hasOwn(permit, "chatFrames"), false);
  assert.equal(Object.hasOwn(room.players[HOST_UID], "chatFrameId"), false);
  assert.equal(Object.hasOwn(room.players[GUEST_UID], "chatFrameId"), false);
});

test("legacy, stale, and unowned training frame selections fall back to standard", async () => {
  const h = harness();
  const host = await claim(h, HOST_UID);
  const guest = await claim(h, GUEST_UID);
  const requested = "chat_frame_neon";

  h.realtime.write(`${PATHS.economy}/${HOST_UID}`, {
    inventory: { [requested]: true },
    equipped: { chatFrame: "chat_frame_lace" },
  });
  h.realtime.write(`${PATHS.economy}/${GUEST_UID}`, {
    inventory: {},
    equipped: { chatFrame: "" },
  });

  assert.equal((await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host, { chatFrameId: requested }),
  )).queued, true);
  assert.equal((await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest),
  )).queued, true);

  const hostQueue = h.realtime.read(queuePath(HOST_UID, host));
  const guestQueue = h.realtime.read(queuePath(GUEST_UID, guest));
  assert.equal(hostQueue.chatFrameId, requested);
  assert.equal(Object.hasOwn(guestQueue, "chatFrameId"), false);

  const offer = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });
  assert.equal(offer.outcome, "offered");
  assert.deepEqual(
    h.realtime.read(`${PATHS.rooms}/${offer.roomId}`).chatFrames,
    {
      [HOST_UID]: "",
      [GUEST_UID]: "",
    },
  );
});

test("chat-frame economy read failure keeps matchmaking available with standard frames", async () => {
  const h = harness();
  const host = await claim(h, HOST_UID);
  const guest = await claim(h, GUEST_UID);
  const frameId = "chat_frame_neon";

  for (const uid of [HOST_UID, GUEST_UID]) {
    h.realtime.write(`${PATHS.economy}/${uid}`, {
      inventory: { [frameId]: true },
      equipped: { chatFrame: frameId },
    });
  }
  assert.equal((await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host, { chatFrameId: frameId }),
  )).queued, true);
  assert.equal((await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest, { chatFrameId: frameId }),
  )).queued, true);
  h.realtime.failGet(`${PATHS.economy}/${HOST_UID}`);

  const originalWarn = console.warn;
  console.warn = () => {};
  let offer;
  try {
    offer = await h.service.tryMatch(HOST_UID, {
      sessionId: host.sessionId,
      leaseToken: host.leaseToken,
      conditions: "",
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(offer.outcome, "offered");
  assert.deepEqual(
    h.realtime.read(`${PATHS.rooms}/${offer.roomId}`).chatFrames,
    {
      [HOST_UID]: "",
      [GUEST_UID]: "",
    },
  );
});

test("try_match materializes a V4 offer and accept atomically opens round 1", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);

  assert.deepEqual(Object.keys(offer).sort(), [
    "attemptId",
    "connectionGeneration",
    "opponentSessionId",
    "opponentUid",
    "outcome",
    "role",
    "roomId",
  ]);
  assert.equal(offer.role, "host");
  assert.equal(offer.opponentUid, GUEST_UID);
  assert.equal(offer.opponentSessionId, guest.sessionId);

  const offeredRoom = h.realtime.read(`${PATHS.rooms}/${offer.roomId}`);
  assert.equal(offeredRoom.protocolVersion, 3);
  assert.equal(offeredRoom.sessionProtocolVersion, 2);
  assert.equal(offeredRoom.signalingVersion, 2);
  assert.equal(offeredRoom.status, "offered");
  assert.deepEqual(offeredRoom.accepted, { [HOST_UID]: true });
  assert.equal(offeredRoom.players[HOST_UID].conditions, "膝に違和感あり");
  assert.equal(offeredRoom.players[GUEST_UID].conditions, "");

  assert.equal(
    h.realtime.read(queuePath(HOST_UID, host)).state,
    "offering",
  );
  assert.equal(
    h.realtime.read(queuePath(GUEST_UID, guest)).state,
    "reserved",
  );
  assert.ok(h.realtime.read(`${PATHS.permits}/${offer.roomId}`));
  assert.ok(
    h.realtime.read(
      `${PATHS.offers}/${GUEST_UID}/${guest.sessionId}/${offer.roomId}`,
    ),
  );

  const accepted = await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "腰は無理をしない",
  });

  assert.deepEqual(Object.keys(accepted).sort(), [
    "accepted",
    "attemptId",
    "connectionGeneration",
    "opponentSessionId",
    "opponentUid",
    "role",
    "roomId",
  ]);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.role, "guest");
  assert.equal(accepted.opponentUid, HOST_UID);
  assert.equal(accepted.opponentSessionId, host.sessionId);

  const activeRoom = h.realtime.read(`${PATHS.rooms}/${offer.roomId}`);
  assert.equal(activeRoom.status, "active");
  assert.deepEqual(activeRoom.accepted, {
    [HOST_UID]: true,
    [GUEST_UID]: true,
  });
  assert.equal(activeRoom.players[GUEST_UID].conditions, "腰は無理をしない");
  assert.deepEqual(activeRoom.rounds, {
    1: {
      createdAt: h.now(),
    },
  });
  assert.equal(activeRoom.matchTransition, undefined);
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)), undefined);
  assert.equal(h.realtime.read(queuePath(GUEST_UID, guest)), undefined);
  assert.equal(h.realtime.read(`${PATHS.permits}/${offer.roomId}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);
});

test("accept survives an Admin RTDB cold-cache null during room activation", async () => {
  const h = harness();
  const { guest, offer } = await offeredPair(h);
  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.beforeFutureTransaction(roomPath, 2, (database) => {
    database.coldCacheNullOnce(roomPath);
  });

  const accepted = await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.role, "guest");
  assert.equal(h.realtime.read(roomPath).status, "active");
});

test("accept cleans exact reservations when the offered room is deleted during activation", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.beforeFutureTransaction(roomPath, 2, (database) => {
    database.deleteBeforeCommitOnce(roomPath);
  });

  const accepted = await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });

  assert.deepEqual(accepted, { accepted: false, reason: "offer-stale" });
  assert.equal(h.realtime.read(roomPath), undefined);
  assert.equal(
    h.realtime.read(`${PATHS.active}/${HOST_UID}/${host.sessionId}`),
    undefined,
  );
  assert.equal(
    h.realtime.read(`${PATHS.active}/${GUEST_UID}/${guest.sessionId}`),
    undefined,
  );
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "waiting");
  assert.equal(h.realtime.read(queuePath(GUEST_UID, guest)).state, "waiting");
  assert.equal(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.permits}/${offer.roomId}`), undefined);
});

test("try_match restores both roles after the successful accept response is lost", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });

  const guestRecovery = await h.service.tryMatch(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    conditions: "",
  });
  const hostRecovery = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });

  assert.deepEqual(guestRecovery, {
    outcome: "join",
    roomId: offer.roomId,
    role: "guest",
    opponentUid: HOST_UID,
    opponentSessionId: host.sessionId,
    attemptId: offer.attemptId,
    connectionGeneration: offer.connectionGeneration,
  });
  assert.deepEqual(hostRecovery, {
    outcome: "join",
    roomId: offer.roomId,
    role: "host",
    opponentUid: GUEST_UID,
    opponentSessionId: guest.sessionId,
    attemptId: offer.attemptId,
    connectionGeneration: offer.connectionGeneration,
  });
});

test("accept replay requires the exact guest active room and role", async () => {
  const h = harness();
  const { guest, offer } = await offeredPair(h);
  await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });
  const activePath = `${PATHS.active}/${GUEST_UID}/${guest.sessionId}`;
  const exactActive = h.realtime.read(activePath);

  for (const patch of [
    { roomId: "-foreign000000000000" },
    { attemptId: "foreign-attempt-token" },
    { connectionGeneration: "foreign-connection-generation" },
    { generation: "AAAAAAAAAAAAAAAAAAAAAA" },
    { role: "host" },
  ]) {
    h.realtime.write(activePath, {
      ...exactActive,
      ...patch,
    });
    const response = await h.service.accept(GUEST_UID, {
      sessionId: guest.sessionId,
      leaseToken: guest.leaseToken,
      roomId: offer.roomId,
      conditions: "",
    });
    assert.deepEqual(response, {
      accepted: false,
      reason: "offer-stale",
    });
  }
});

test("liveRoom protects exact active presence after claim expiry and fresh offered host", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });
  h.advance(TRAINING_SESSION_LEASE_TTL_MS - 1_000);
  const activePath = `${PATHS.active}/${HOST_UID}/${host.sessionId}`;
  const hostActive = h.realtime.read(activePath);
  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.write(roomPath, {
    ...h.realtime.read(roomPath),
    presenceV2: {
      [HOST_UID]: {
        [host.sessionId]: {
          protocolVersion: TRAINING_SESSION_PROTOCOL_VERSION,
          sessionId: host.sessionId,
          leaseToken: host.leaseToken,
          generation: host.generation,
          online: true,
          updatedAt: h.now(),
        },
      },
    },
  });
  h.advance(2_000);

  const live = await h.service.liveRoom(HOST_UID, h.now());
  assert.equal(live.roomId, offer.roomId);
  assert.equal(live.status, "active");
  assert.equal(live.room.status, "active");
  assert.equal(live.sessionId, host.sessionId);
  assert.equal(live.role, "host");

  h.realtime.write(activePath, {
    ...hostActive,
    connectionGeneration: "foreign-connection-generation",
  });
  assert.equal(await h.service.liveRoom(HOST_UID, h.now()), null);
  h.realtime.write(activePath, hostActive);
  const currentRoom = h.realtime.read(roomPath);
  currentRoom.presenceV2[HOST_UID][host.sessionId].leaseToken =
    "foreign-presence-lease-token";
  h.realtime.write(roomPath, currentRoom);
  assert.equal(await h.service.liveRoom(HOST_UID, h.now()), null);

  const offered = harness();
  const offeredValue = await offeredPair(offered);
  const offeredLive = await offered.service.liveRoom(HOST_UID, offered.now());
  assert.equal(offeredLive.roomId, offeredValue.offer.roomId);
  assert.equal(offeredLive.room.status, "offered");
  assert.equal(offeredLive.role, "host");
  assert.equal(
    await offered.service.liveRoom(GUEST_UID, offered.now()),
    null,
  );
});

test("active leases remain protected after the offer TTL and terminal rooms release", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });

  h.advance(50_000);
  const refreshed = await h.service.heartbeat(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    generation: host.generation,
  });
  assert.equal(refreshed.claimed, true);
  h.advance(20_000);

  const protectedRelease = await h.service.release(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    generation: host.generation,
  });
  assert.deepEqual(protectedRelease, { released: false, reason: "active" });

  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.write(roomPath, {
    ...h.realtime.read(roomPath),
    serverFinalized: {
      at: h.now(),
    },
  });
  const terminalRelease = await h.service.release(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    generation: host.generation,
  });
  assert.deepEqual(terminalRelease, { released: true });
  assert.equal(
    h.realtime.read(`${PATHS.active}/${HOST_UID}/${host.sessionId}`),
    undefined,
  );
});

test("release reports an unfinished offer as active for both participants", async () => {
  const h = harness();
  const { host, guest } = await offeredPair(h);

  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const response = await h.service.release(uid, {
      sessionId: lease.sessionId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    assert.deepEqual(response, { released: false, reason: "active" });
    assert.ok(h.realtime.read(`${PATHS.claims}/${uid}`));
  }
});

test("enqueue never overwrites an offered or active attempt", async () => {
  const offered = harness();
  const offeredPairValue = await offeredPair(offered);
  const offeredResponse = await offered.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, offeredPairValue.guest),
  );
  assert.deepEqual(offeredResponse, { queued: false, reason: "active" });
  assert.equal(
    offered.realtime.read(queuePath(GUEST_UID, offeredPairValue.guest)).state,
    "reserved",
  );

  const active = harness();
  const activePairValue = await offeredPair(active);
  await active.service.accept(GUEST_UID, {
    sessionId: activePairValue.guest.sessionId,
    leaseToken: activePairValue.guest.leaseToken,
    roomId: activePairValue.offer.roomId,
    conditions: "",
  });
  const activeResponse = await active.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, activePairValue.host),
  );
  assert.deepEqual(activeResponse, { queued: false, reason: "active" });
  assert.equal(
    active.realtime.read(queuePath(HOST_UID, activePairValue.host)),
    undefined,
  );
});

test("orphan recovery does not tear down a fresh exact pair-lock materialization", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  const hostQueue = h.realtime.read(queuePath(HOST_UID, host));
  const guestQueue = h.realtime.read(queuePath(GUEST_UID, guest));
  const hostLock = h.realtime.read(`${PATHS.locks}/${HOST_UID}`);
  const guestLock = h.realtime.read(`${PATHS.locks}/${GUEST_UID}`);
  h.realtime.write(`${PATHS.rooms}/${offer.roomId}`, null);
  h.realtime.write(`${PATHS.permits}/${offer.roomId}`, null);
  h.realtime.write(`${PATHS.active}/${HOST_UID}/${host.sessionId}`, null);
  h.realtime.write(
    `${PATHS.offers}/${GUEST_UID}/${guest.sessionId}/${offer.roomId}`,
    null,
  );

  const response = await h.service.tryMatch(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    conditions: "",
  });

  assert.deepEqual(response, { outcome: "waiting" });
  assert.deepEqual(h.realtime.read(queuePath(HOST_UID, host)), hostQueue);
  assert.deepEqual(h.realtime.read(queuePath(GUEST_UID, guest)), guestQueue);
  assert.deepEqual(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), hostLock);
  assert.deepEqual(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), guestLock);
});

test("orphan recovery does not tear down a fresh exact permit materialization", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  const guestQueue = h.realtime.read(queuePath(GUEST_UID, guest));
  const permit = h.realtime.read(`${PATHS.permits}/${offer.roomId}`);
  h.realtime.write(`${PATHS.rooms}/${offer.roomId}`, null);
  h.realtime.write(`${PATHS.locks}/${HOST_UID}`, null);
  h.realtime.write(`${PATHS.locks}/${GUEST_UID}`, null);
  h.realtime.write(`${PATHS.active}/${HOST_UID}/${host.sessionId}`, null);
  h.realtime.write(
    `${PATHS.offers}/${GUEST_UID}/${guest.sessionId}/${offer.roomId}`,
    null,
  );

  const response = await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest),
  );

  assert.deepEqual(response, { queued: false, reason: "active" });
  assert.deepEqual(h.realtime.read(queuePath(GUEST_UID, guest)), guestQueue);
  assert.deepEqual(
    h.realtime.read(`${PATHS.permits}/${offer.roomId}`),
    permit,
  );
});

test("enqueue CAS-recovers heartbeat-extended orphan reservations without reviving the room", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  const oldRoomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.write(oldRoomPath, null);
  h.advance(TRAINING_ROOM_TRANSITION_TTL_MS + 1);
  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const heartbeat = await h.service.heartbeat(uid, {
      sessionId: lease.sessionId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    lease.expiresAt = heartbeat.lease.expiresAt;
  }

  const hostQueued = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host),
  );
  const guestQueued = await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest),
  );
  assert.equal(hostQueued.queued, true);
  assert.equal(guestQueued.queued, true);
  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const restored = h.realtime.read(queuePath(uid, lease));
    assert.equal(restored.state, "waiting");
    assert.equal(restored.roomId, undefined);
    assert.equal(restored.attemptId, undefined);
  }
  assert.equal(h.realtime.read(oldRoomPath), undefined);
  assert.equal(h.realtime.read(`${PATHS.permits}/${offer.roomId}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);

  const replacement = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });
  assert.equal(replacement.outcome, "offered");
  assert.notEqual(replacement.roomId, offer.roomId);
});

test("try_match itself recovers an orphan reservation before selecting again", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  h.realtime.write(`${PATHS.rooms}/${offer.roomId}`, null);
  h.advance(TRAINING_ROOM_TRANSITION_TTL_MS + 1);
  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const heartbeat = await h.service.heartbeat(uid, {
      sessionId: lease.sessionId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    lease.expiresAt = heartbeat.lease.expiresAt;
  }

  const first = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });
  assert.deepEqual(first, { outcome: "waiting" });
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "waiting");

  const second = await h.service.tryMatch(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    conditions: "",
  });
  assert.equal(second.outcome, "offered");
  assert.notEqual(second.roomId, offer.roomId);
  assert.equal(h.realtime.read(`${PATHS.rooms}/${offer.roomId}`), undefined);
});

test("orphan recovery waits for a fresh accept transition before restoring", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  h.advance(50_000);
  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const heartbeat = await h.service.heartbeat(uid, {
      sessionId: lease.sessionId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    lease.expiresAt = heartbeat.lease.expiresAt;
  }
  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.write(roomPath, {
    ...h.realtime.read(roomPath),
    matchTransition: {
      action: "accept",
      token: "accept-transition-token",
      startedAt: h.now(),
    },
  });

  const protectedResponse = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host),
  );
  assert.deepEqual(protectedResponse, { queued: false, reason: "active" });
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "offering");
  assert.ok(h.realtime.read(roomPath));

  h.advance(TRAINING_ROOM_TRANSITION_TTL_MS + 1);
  const recoveredResponse = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host),
  );
  assert.equal(recoveredResponse.queued, true);
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "waiting");
  assert.ok(h.realtime.read(roomPath));
});

test("orphan recovery preserves a live room and only clears exact terminal remnants", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  const offeredArtifacts = {
    hostQueue: h.realtime.read(queuePath(HOST_UID, host)),
    guestQueue: h.realtime.read(queuePath(GUEST_UID, guest)),
    permit: h.realtime.read(`${PATHS.permits}/${offer.roomId}`),
    hostLock: h.realtime.read(`${PATHS.locks}/${HOST_UID}`),
    guestLock: h.realtime.read(`${PATHS.locks}/${GUEST_UID}`),
    guestOffer: h.realtime.read(
      `${PATHS.offers}/${GUEST_UID}/${guest.sessionId}/${offer.roomId}`,
    ),
  };
  await h.service.accept(GUEST_UID, {
    sessionId: guest.sessionId,
    leaseToken: guest.leaseToken,
    roomId: offer.roomId,
    conditions: "",
  });
  h.realtime.write(queuePath(HOST_UID, host), offeredArtifacts.hostQueue);
  h.realtime.write(queuePath(GUEST_UID, guest), offeredArtifacts.guestQueue);
  h.realtime.write(`${PATHS.permits}/${offer.roomId}`, offeredArtifacts.permit);
  h.realtime.write(`${PATHS.locks}/${HOST_UID}`, offeredArtifacts.hostLock);
  h.realtime.write(`${PATHS.locks}/${GUEST_UID}`, offeredArtifacts.guestLock);
  h.realtime.write(
    `${PATHS.offers}/${GUEST_UID}/${guest.sessionId}/${offer.roomId}`,
    offeredArtifacts.guestOffer,
  );

  const liveResponse = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host),
  );
  assert.deepEqual(liveResponse, { queued: false, reason: "active" });
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "offering");
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${offer.roomId}`).status,
    "active",
  );

  const roomPath = `${PATHS.rooms}/${offer.roomId}`;
  h.realtime.write(roomPath, {
    ...h.realtime.read(roomPath),
    surrendered: {
      uid: GUEST_UID,
      at: h.now(),
    },
  });
  const terminalHost = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, host),
  );
  const terminalGuest = await h.service.enqueue(
    GUEST_UID,
    enqueueInput(GUEST_UID, guest),
  );
  assert.equal(terminalHost.queued, true);
  assert.equal(terminalGuest.queued, true);
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "waiting");
  assert.equal(h.realtime.read(queuePath(GUEST_UID, guest)).state, "waiting");
  assert.equal(h.realtime.read(`${PATHS.permits}/${offer.roomId}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);
  const preservedRoom = h.realtime.read(roomPath);
  assert.equal(preservedRoom.destroyed, undefined);
  assert.equal(preservedRoom.surrendered.uid, GUEST_UID);
});

test("try_match expires and replaces its own stale offered attempt", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  h.advance(50_000);
  for (const [uid, lease] of [
    [HOST_UID, host],
    [GUEST_UID, guest],
  ]) {
    const heartbeat = await h.service.heartbeat(uid, {
      sessionId: lease.sessionId,
      leaseToken: lease.leaseToken,
      generation: lease.generation,
    });
    lease.expiresAt = heartbeat.lease.expiresAt;
  }
  h.advance(20_000);

  const replacement = await h.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });

  assert.equal(replacement.outcome, "offered");
  assert.notEqual(replacement.roomId, offer.roomId);
  assert.equal(h.realtime.read(`${PATHS.rooms}/${offer.roomId}`), undefined);
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${replacement.roomId}`).status,
    "offered",
  );
});

test("legacy occupancy blocks both claim and post-claim materialization", async () => {
  const first = harness();
  first.realtime.write(`${PATHS.legacyQueue}/${HOST_UID}`, {
    state: "waiting",
    lastSeen: first.now(),
  });
  const deniedClaim = await first.service.claim(HOST_UID, credentials(HOST_UID));
  assert.deepEqual(deniedClaim, {
    claimed: false,
    reason: "legacy-waiting",
  });

  const second = harness();
  const host = await claim(second, HOST_UID);
  const guest = await claim(second, GUEST_UID);
  await queue(second, HOST_UID, host);
  await queue(second, GUEST_UID, guest);
  second.realtime.write(`${PATHS.legacyQueue}/${GUEST_UID}`, {
    state: "waiting",
    lastSeen: second.now(),
  });
  const outcome = await second.service.tryMatch(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    conditions: "",
  });
  assert.deepEqual(outcome, { outcome: "waiting" });
  assert.equal(second.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(second.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);
});

test("enqueue refuses a legacy attempt that appeared after the V2 claim", async () => {
  const h = harness();
  const lease = await claim(h, HOST_UID);
  h.realtime.write(`${PATHS.legacyQueue}/${HOST_UID}`, {
    state: "waiting",
    lastSeen: h.now(),
  });

  const response = await h.service.enqueue(
    HOST_UID,
    enqueueInput(HOST_UID, lease),
  );

  assert.deepEqual(response, { queued: false, reason: "active" });
  assert.equal(h.realtime.read(queuePath(HOST_UID, lease)), undefined);
});

test("accept rejects a permit or pair lock from a different immutable attempt", async () => {
  for (const corrupt of ["permit", "lock"]) {
    const h = harness();
    const { guest, offer } = await offeredPair(h);
    if (corrupt === "permit") {
      const permitPath = `${PATHS.permits}/${offer.roomId}`;
      h.realtime.write(permitPath, {
        ...h.realtime.read(permitPath),
        connectionGeneration: "different-connection-generation",
      });
    } else {
      const lockPath = `${PATHS.locks}/${GUEST_UID}`;
      h.realtime.write(lockPath, {
        ...h.realtime.read(lockPath),
        role: "host",
      });
    }
    const response = await h.service.accept(GUEST_UID, {
      sessionId: guest.sessionId,
      leaseToken: guest.leaseToken,
      roomId: offer.roomId,
      conditions: "",
    });
    assert.deepEqual(response, { accepted: false, reason: "offer-stale" });
    assert.equal(
      h.realtime.read(`${PATHS.rooms}/${offer.roomId}`).status,
      "offered",
    );
  }
});

test("active cancel preserves an already resolved room and a result race", async () => {
  const activate = async () => {
    const h = harness();
    const { host, guest, offer } = await offeredPair(h);
    await h.service.accept(GUEST_UID, {
      sessionId: guest.sessionId,
      leaseToken: guest.leaseToken,
      roomId: offer.roomId,
      conditions: "",
    });
    return { h, host, guest, offer };
  };
  const markSurrendered = (h, roomId) => {
    const roomPath = `${PATHS.rooms}/${roomId}`;
    h.realtime.write(roomPath, {
      ...h.realtime.read(roomPath),
      surrendered: {
        uid: GUEST_UID,
        at: h.now(),
      },
    });
  };

  const resolved = await activate();
  markSurrendered(resolved.h, resolved.offer.roomId);
  const preResolved = await resolved.h.service.cancel(HOST_UID, {
    sessionId: resolved.host.sessionId,
    leaseToken: resolved.host.leaseToken,
    roomId: resolved.offer.roomId,
    abort: true,
  });
  assert.deepEqual(preResolved, {
    cancelled: false,
    reason: "resolved",
    status: "active",
  });
  assert.equal(
    resolved.h.realtime.read(`${PATHS.rooms}/${resolved.offer.roomId}`).destroyed,
    undefined,
  );
  const releasedResolved = await resolved.h.service.release(HOST_UID, {
    sessionId: resolved.host.sessionId,
    leaseToken: resolved.host.leaseToken,
    generation: resolved.host.generation,
  });
  assert.deepEqual(releasedResolved, { released: true });
  assert.equal(
    resolved.h.realtime.read(
      `${PATHS.active}/${HOST_UID}/${resolved.host.sessionId}`,
    ),
    undefined,
  );
  assert.equal(
    resolved.h.realtime.read(`${PATHS.claims}/${HOST_UID}`),
    undefined,
  );
  assert.equal(
    resolved.h.realtime.read(
      `${PATHS.rooms}/${resolved.offer.roomId}`,
    ).surrendered.uid,
    GUEST_UID,
  );

  const raced = await activate();
  const racedRoomPath = `${PATHS.rooms}/${raced.offer.roomId}`;
  raced.h.realtime.beforeFutureTransaction(
    racedRoomPath,
    2,
    () => markSurrendered(raced.h, raced.offer.roomId),
  );
  const raceResponse = await raced.h.service.cancel(HOST_UID, {
    sessionId: raced.host.sessionId,
    leaseToken: raced.host.leaseToken,
    roomId: raced.offer.roomId,
    abort: true,
  });
  assert.deepEqual(raceResponse, {
    cancelled: false,
    reason: "resolved",
    status: "active",
  });
  assert.equal(
    raced.h.realtime.read(racedRoomPath).destroyed,
    undefined,
  );
});

test("expire cleans an offered attempt and restores both valid queue rows", async () => {
  const h = harness();
  const { host, guest, offer } = await offeredPair(h);
  h.advance(1_000);

  const expired = await h.service.expire(HOST_UID, {
    sessionId: host.sessionId,
    leaseToken: host.leaseToken,
    roomId: offer.roomId,
  });

  assert.deepEqual(expired, { cancelled: true, status: "expired" });
  assert.equal(h.realtime.read(`${PATHS.rooms}/${offer.roomId}`), undefined);
  assert.equal(h.realtime.read(queuePath(HOST_UID, host)).state, "waiting");
  assert.equal(h.realtime.read(queuePath(GUEST_UID, guest)).state, "waiting");
  assert.equal(h.realtime.read(`${PATHS.permits}/${offer.roomId}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${HOST_UID}`), undefined);
  assert.equal(h.realtime.read(`${PATHS.locks}/${GUEST_UID}`), undefined);
});

test("unknown input fields are rejected before any matchmaking mutation", async () => {
  const h = harness();
  await assert.rejects(
    h.service.claim(HOST_UID, {
      ...credentials(HOST_UID),
      conditions: "claim には存在しない",
    }),
    (error) => error instanceof FakeHttpsError
      && error.code === "invalid-argument",
  );
  assert.equal(h.realtime.read(PATHS.claims), undefined);
  assert.equal(h.realtime.read(PATHS.rates), undefined);
});
