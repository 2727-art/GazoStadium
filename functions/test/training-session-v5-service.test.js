"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  TRAINING_ATTEMPT_TTL_MS,
} = require("../training-session-v5");
const {
  ACTIVE_START_PRESENCE_GRACE_MS,
  ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS,
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

  async transaction(update, _onComplete, applyLocally = true) {
    const count = (this.database.transactionCounts.get(this.path) || 0) + 1;
    this.database.transactionCounts.set(this.path, count);
    const applyLocallyValues = this.database.transactionApplyLocally
      .get(this.path) || [];
    applyLocallyValues.push(applyLocally);
    this.database.transactionApplyLocally.set(this.path, applyLocallyValues);
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
    if (current != null && this.database.coldCacheNullOncePaths.delete(this.path)) {
      const coldCacheNext = update(null);
      if (coldCacheNext === undefined) {
        return { committed: false, snapshot: new FakeSnapshot(null) };
      }
    }
    const next = update(current);
    if (next !== undefined
        && current != null
        && this.database.deleteBeforeCommitOncePaths.delete(this.path)) {
      setAt(this.database.data, this.path, null);
      const retryNext = update(null);
      if (retryNext === undefined) {
        return { committed: false, snapshot: new FakeSnapshot(null) };
      }
      setAt(this.database.data, this.path, retryNext);
      return {
        committed: true,
        snapshot: new FakeSnapshot(getAt(this.database.data, this.path)),
      };
    }
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
    this.transactionApplyLocally = new Map();
    this.transactionFailures = new Map();
    this.transactionBlockers = new Map();
    this.afterCommitFailures = new Map();
    this.getFailures = new Set();
    this.coldCacheNullOncePaths = new Set();
    this.deleteBeforeCommitOncePaths = new Set();
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

  coldCacheNullOnce(value) {
    this.coldCacheNullOncePaths.add(segments(value).join("/"));
  }

  deleteBeforeCommitOnce(value) {
    this.deleteBeforeCommitOncePaths.add(segments(value).join("/"));
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

function rotateAttemptPairOnly(h, transportEpoch) {
  for (const uid of [HOST_UID, GUEST_UID]) {
    const attempt = h.realtime.read(`${PATHS.attempts}/${uid}`);
    h.realtime.write(`${PATHS.attempts}/${uid}`, {
      ...attempt,
      revision: attempt.revision + 1,
      updatedAt: h.now(),
      lastSeen: h.now(),
      transportEpoch,
    });
  }
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

test("a new endpoint can replace an unattended active pair after the connection grace", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  for (const uid of [HOST_UID, GUEST_UID]) {
    const attempt = h.realtime.read(`${PATHS.attempts}/${uid}`);
    h.realtime.write(`${PATHS.attempts}/${uid}`, {
      ...attempt,
      revision: attempt.revision + 1,
      updatedAt: h.now(),
      lastSeen: h.now(),
    });
  }
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
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
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

test("either participant's fresh exact presence protects the whole active pair", async () => {
  for (const protectedUid of [HOST_UID, GUEST_UID]) {
    const h = harness();
    const { matched } = await pair(h);
    h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
    const roomPath = `${PATHS.rooms}/${matched.roomId}`;
    const room = h.realtime.read(roomPath);
    const protectedAttempt = h.realtime.read(
      `${PATHS.attempts}/${protectedUid}`,
    );
    room.presenceV5 = {
      [protectedUid]: {
        [protectedAttempt.runId]: exactPresence(protectedAttempt, h.now()),
      },
    };
    h.realtime.write(roomPath, room);

    const blocked = await h.service.start(HOST_UID, {
      ...identity(HOST_UID, `replacement-${protectedUid}-`),
      preparation: preparation("REPLACEMENT"),
    });

    assert.deepEqual(blocked, {
      started: false,
      reason: "owner-replaced",
    });
    assert.equal(h.realtime.read(roomPath).destroyed, undefined);
  }
});

test("a recent old-transport presence protects a long active match during handoff", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  const hostAttempt = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  room.presenceV5 = {
    [HOST_UID]: {
      [hostAttempt.runId]: exactPresence({
        ...hostAttempt,
        transportEpoch: "old-transport-1234567890",
      }, h.now(), false),
    },
  };
  h.realtime.write(roomPath, room);

  const blocked = await h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-recent-handoff-"),
    preparation: preparation("REPLACEMENT"),
  });

  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("the initial room grace protects an attempts-first transport rotation", async () => {
  const h = harness();
  const { matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  rotateAttemptPairOnly(h, "next-transport-initial-1234567890");

  const blocked = await h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-initial-gap-"),
    preparation: preparation("REPLACEMENT"),
  });

  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state,
    "active",
  );
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("recent same-identity presence protects an attempts-first transport rotation", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  const oldGuestAttempt = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  room.presenceV5 = {
    [GUEST_UID]: {
      [oldGuestAttempt.runId]: exactPresence(oldGuestAttempt, h.now(), false),
    },
  };
  h.realtime.write(roomPath, room);
  rotateAttemptPairOnly(h, "next-transport-handoff-1234567890");

  const blocked = await h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-transport-gap-"),
    preparation: preparation("REPLACEMENT"),
  });

  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state,
    "active",
  );
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("an expired attempts-first transport gap converges as room-mismatch", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  const oldGuestAttempt = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  room.presenceV5 = {
    [GUEST_UID]: {
      [oldGuestAttempt.runId]: exactPresence(
        oldGuestAttempt,
        h.now() - ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS - 1,
        false,
      ),
    },
  };
  h.realtime.write(roomPath, room);
  rotateAttemptPairOnly(h, "next-transport-expired-1234567890");
  const replacement = identity(HOST_UID, "replacement-expired-gap-");

  const replaced = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("REPLACEMENT"),
  });

  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason,
    "room-mismatch",
  );
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("stale presence from an old transport does not protect an unattended active pair", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  const hostAttempt = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  room.presenceV5 = {
    [HOST_UID]: {
      [hostAttempt.runId]: exactPresence({
        ...hostAttempt,
        transportEpoch: "old-transport-1234567890",
      }, h.now() - ACTIVE_START_TRANSPORT_HANDOFF_GRACE_MS - 1, false),
    },
  };
  h.realtime.write(roomPath, room);

  const replaced = await h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-old-transport-"),
    preparation: preparation("REPLACEMENT"),
  });

  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(
    h.realtime.read(roomPath).destroyed.reason,
    "active_abandoned",
  );
});

test("the room CAS preserves presence that arrives during a replacement start", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const guestAttempt = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  const blocker = h.realtime.blockNextTransaction(roomPath);
  const replacement = h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-race-"),
    preparation: preparation("REPLACEMENT"),
  });
  await blocker.entered;
  const room = h.realtime.read(roomPath);
  room.presenceV5 = {
    [GUEST_UID]: {
      [guestAttempt.runId]: exactPresence(guestAttempt, h.now()),
    },
  };
  h.realtime.write(roomPath, room);
  blocker.release();

  const blocked = await replacement;

  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });
  assert.equal(h.realtime.read(roomPath).destroyed, undefined);
});

test("a transport rotation after the room destroy CAS still converges the same pair", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const blocker = h.realtime.blockNextTransaction(PATHS.attempts);
  const replacementIdentity = identity(
    HOST_UID,
    "replacement-after-destroy-",
  );
  const replacement = h.service.start(HOST_UID, {
    ...replacementIdentity,
    preparation: preparation("REPLACEMENT"),
  });
  await blocker.entered;
  assert.equal(
    h.realtime.read(roomPath).destroyed.reason,
    "active_abandoned",
  );
  rotateAttemptPairOnly(h, "next-transport-after-destroy-1234567890");
  blocker.release();

  const replaced = await replacement;

  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).runId,
    replacementIdentity.runId,
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason,
    "active_abandoned",
  );
  assert.equal(
    h.realtime.read(roomPath).destroyed.reason,
    "active_abandoned",
  );
});

test("an active pair without presence is protected during the connection grace", async () => {
  const h = harness();
  const { matched } = await pair(h);

  const blocked = await h.service.start(HOST_UID, {
    ...identity(HOST_UID, "replacement-grace-"),
    preparation: preparation("REPLACEMENT"),
  });

  assert.deepEqual(blocked, { started: false, reason: "owner-replaced" });
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed,
    undefined,
  );
});

test("the same endpoint resumes its active room even after the presence grace", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  h.advance(ACTIVE_START_PRESENCE_GRACE_MS + 1);

  const resumed = await h.service.start(HOST_UID, {
    runId: host.runId,
    endpointId: host.endpointId,
    preparation: preparation(HOST_UID),
  });

  assert.equal(resumed.started, true);
  assert.equal(resumed.reason, "active");
  assert.equal(resumed.outcome, "active");
  assert.equal(resumed.ownerEpoch, host.ownerEpoch);
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed,
    undefined,
  );
});

test("a new endpoint immediately replaces a one-sided active attempt", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.realtime.write(`${PATHS.attempts}/${GUEST_UID}`, null);
  const replacement = identity(HOST_UID, "replacement-one-sided-");

  const replaced = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("REPLACEMENT"),
  });

  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).runId,
    replacement.runId,
  );
  assert.equal(
    h.realtime.read(`${PATHS.rooms}/${matched.roomId}`).destroyed.reason,
    "pair-broken",
  );
});

test("a new endpoint immediately replaces active attempts whose room is missing", async () => {
  const h = harness();
  const { matched } = await pair(h);
  h.realtime.write(`${PATHS.rooms}/${matched.roomId}`, null);
  const replacement = identity(HOST_UID, "replacement-missing-");

  const replaced = await h.service.start(HOST_UID, {
    ...replacement,
    preparation: preparation("REPLACEMENT"),
  });

  assert.equal(replaced.started, true);
  assert.equal(replaced.reason, "replaced-stale");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason,
    "room-ended",
  );
  assert.equal(h.realtime.read(`${PATHS.rooms}/${matched.roomId}`), undefined);
});

test("a new endpoint immediately replaces active attempts in an ended room", async () => {
  for (const ending of ["destroyed", "serverFinalized"]) {
    const h = harness();
    const { matched } = await pair(h);
    const roomPath = `${PATHS.rooms}/${matched.roomId}`;
    const room = h.realtime.read(roomPath);
    room[ending] = ending === "destroyed"
      ? { at: h.now(), byUid: GUEST_UID, reason: "cancelled" }
      : { version: 1, finalizedAt: h.now(), reason: "hp_zero" };
    h.realtime.write(roomPath, room);
    const replacement = identity(HOST_UID, `replacement-${ending}-`);

    const replaced = await h.service.start(HOST_UID, {
      ...replacement,
      preparation: preparation("REPLACEMENT"),
    });

    assert.equal(replaced.started, true);
    assert.equal(replaced.reason, "replaced-stale");
    assert.deepEqual(h.realtime.read(roomPath)[ending], room[ending]);
    assert.equal(
      h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason,
      "room-ended",
    );
  }
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

test("every server transaction disables speculative local application", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  await h.service.reconnect(HOST_UID, {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  });
  await h.service.cancel(HOST_UID, host);

  const applyLocallyValues = [
    ...h.realtime.transactionApplyLocally.values(),
  ].flat();
  assert.ok(applyLocallyValues.length > 0);
  assert.equal(applyLocallyValues.every((value) => value === false), true);
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

test("inspect creates a missing reserved room once and remains idempotent", async () => {
  const h = harness();
  const host = await start(h, HOST_UID);
  await start(h, GUEST_UID);
  const roomId = "-0000000000000000001";
  const roomPath = `${PATHS.rooms}/${roomId}`;
  h.realtime.failTransaction(roomPath);
  await assert.rejects(
    h.service.match(HOST_UID, host),
    /forced transaction failure/,
  );
  assert.equal(h.realtime.read(roomPath), undefined);

  const recovered = await h.service.inspect(HOST_UID, host);
  const roomAfterRecovery = h.realtime.read(roomPath);
  const attemptsAfterRecovery = h.realtime.read(PATHS.attempts);
  const inspectedAgain = await h.service.inspect(HOST_UID, host);

  assert.equal(recovered.outcome, "active");
  assert.equal(inspectedAgain.outcome, "active");
  assert.equal(inspectedAgain.roomId, roomId);
  assert.deepEqual(h.realtime.read(roomPath), roomAfterRecovery);
  assert.deepEqual(h.realtime.read(PATHS.attempts), attemptsAfterRecovery);
  assert.equal(Object.keys(h.realtime.read(PATHS.rooms)).length, 1);
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

test("heartbeat survives an Admin RTDB cold-cache null for an active room", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const roomWithProgress = h.realtime.read(roomPath);
  roomWithProgress.rounds[1].scores = {
    [HOST_UID]: 9,
    [GUEST_UID]: 8,
  };
  roomWithProgress.rounds[1].commandChoices = {
    [GUEST_UID]: {
      trainerUid: HOST_UID,
      cardIndex: 2,
      selectedAt: h.now(),
    },
  };
  h.realtime.write(roomPath, roomWithProgress);
  const roomBefore = h.realtime.read(roomPath);
  const hostBefore = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestBefore = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  h.realtime.coldCacheNullOnce(roomPath);

  const heartbeat = await h.service.heartbeat(HOST_UID, host);

  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  const roomAfter = h.realtime.read(roomPath);
  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.outcome, "active");
  assert.equal(heartbeat.roomId, matched.roomId);
  assert.equal(heartbeat.roomAttemptId, matched.roomAttemptId);
  assert.equal(heartbeat.transportEpoch, matched.transportEpoch);
  assert.equal(hostAfter.state, "active");
  assert.equal(hostAfter.revision, hostBefore.revision + 1);
  assert.equal(hostAfter.terminalReason, undefined);
  assert.equal(hostAfter.pendingRoomCleanup, undefined);
  assert.deepEqual(guestAfter, guestBefore);
  assert.deepEqual(roomAfter, roomBefore);
  assert.equal(roomAfter.destroyed, undefined);
});

test("heartbeat terminalizes a room confirmed missing after pair revalidation", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  h.realtime.deleteBeforeCommitOnce(roomPath);

  const heartbeat = await h.service.heartbeat(HOST_UID, host);

  assert.equal(heartbeat.owned, true);
  assert.equal(heartbeat.outcome, "terminal");
  assert.equal(heartbeat.terminalReason, "room-ended");
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).terminalReason,
    "room-ended",
  );
  assert.equal(
    h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).terminalReason,
    "room-ended",
  );
  assert.equal(h.realtime.read(roomPath), undefined);
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

test("reconnect survives a cold-cache null and preserves the active room", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const roomBefore = h.realtime.read(roomPath);
  h.realtime.coldCacheNullOnce(roomPath);

  const reconnected = await h.service.reconnect(HOST_UID, {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  });

  const roomAfter = h.realtime.read(roomPath);
  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  assert.equal(reconnected.outcome, "active");
  assert.equal(hostAfter.state, "active");
  assert.equal(guestAfter.state, "active");
  assert.equal(hostAfter.transportEpoch, guestAfter.transportEpoch);
  assert.equal(roomAfter.transportEpoch, hostAfter.transportEpoch);
  assert.equal(roomAfter.destroyed, undefined);
  assert.deepEqual(roomAfter.rounds, roomBefore.rounds);
});

test("reconnect terminalizes a server-confirmed missing room after pair revalidation", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  h.realtime.write(`${PATHS.rooms}/${matched.roomId}`, null);

  const reconnected = await h.service.reconnect(HOST_UID, {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  });

  assert.equal(reconnected.outcome, "terminal");
  assert.equal(reconnected.terminalReason, "room-ended");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state, "terminal");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state, "terminal");
  assert.equal(h.realtime.read(`${PATHS.rooms}/${matched.roomId}`), undefined);
});

test("reconnect terminalizes only a server-confirmed destroyed room", async () => {
  const h = harness();
  const { host, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const room = h.realtime.read(roomPath);
  room.destroyed = {
    at: h.now(),
    byUid: GUEST_UID,
    reason: "health_stop",
  };
  h.realtime.write(roomPath, room);

  const reconnected = await h.service.reconnect(HOST_UID, {
    ...host,
    roomAttemptId: matched.roomAttemptId,
    transportEpoch: matched.transportEpoch,
  });

  assert.equal(reconnected.outcome, "terminal");
  assert.equal(reconnected.terminalReason, "room-ended");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${HOST_UID}`).state, "terminal");
  assert.equal(h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`).state, "terminal");
  assert.equal(h.realtime.read(roomPath).destroyed.reason, "health_stop");
});

test("parallel reconnect inspect and heartbeat converge without terminal attempts", async () => {
  const h = harness();
  const { host, guest, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  h.realtime.coldCacheNullOnce(roomPath);

  await Promise.all([
    h.service.reconnect(HOST_UID, {
      ...host,
      roomAttemptId: matched.roomAttemptId,
      transportEpoch: matched.transportEpoch,
    }),
    h.service.inspect(GUEST_UID, guest),
    h.service.heartbeat(HOST_UID, host),
  ]);

  const roomAfter = h.realtime.read(roomPath);
  const hostAfter = h.realtime.read(`${PATHS.attempts}/${HOST_UID}`);
  const guestAfter = h.realtime.read(`${PATHS.attempts}/${GUEST_UID}`);
  assert.equal(hostAfter.state, "active");
  assert.equal(guestAfter.state, "active");
  assert.equal(hostAfter.transportEpoch, guestAfter.transportEpoch);
  assert.equal(roomAfter.transportEpoch, hostAfter.transportEpoch);
  assert.equal(roomAfter.destroyed, undefined);
});

test("heartbeat repairs the room after reconnect committed only the attempt epoch", async () => {
  const h = harness();
  const { host, guest, matched } = await pair(h);
  const roomPath = `${PATHS.rooms}/${matched.roomId}`;
  const roomWithProgress = h.realtime.read(roomPath);
  roomWithProgress.rounds[1].scores = {
    [HOST_UID]: 10,
    [GUEST_UID]: 9,
  };
  roomWithProgress.rounds[1].commandChoices = {
    [GUEST_UID]: {
      trainerUid: HOST_UID,
      cardIndex: 1,
      selectedAt: h.now(),
    },
  };
  h.realtime.write(roomPath, roomWithProgress);
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
  h.realtime.coldCacheNullOnce(roomPath);

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
  assert.deepEqual(
    roomAfter.rounds[1].scores,
    roomWithProgress.rounds[1].scores,
  );
  assert.deepEqual(
    roomAfter.rounds[1].commandChoices,
    roomWithProgress.rounds[1].commandChoices,
  );
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
