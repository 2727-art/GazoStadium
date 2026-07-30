"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  TRAINING_SESSION_CLEANUP_BATCH_SIZE,
  TRAINING_SESSION_CLEANUP_CURSORS_PATH,
  cleanupRelatedTrainingPointers,
  createTrainingSessionResourceCleanup,
} = require("../training-room-cleanup");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function parts(targetPath) {
  return String(targetPath || "").split("/").filter(Boolean);
}

function nodeAt(root, targetPath) {
  let current = root;
  for (const part of parts(targetPath)) {
    if (!current || typeof current !== "object"
        || !Object.hasOwn(current, part)) return null;
    current = current[part];
  }
  return current;
}

function writeNode(root, targetPath, value) {
  const targetParts = parts(targetPath);
  let parent = root;
  const parents = [];
  for (const part of targetParts.slice(0, -1)) {
    if (!parent[part] || typeof parent[part] !== "object") parent[part] = {};
    parents.push([parent, part]);
    parent = parent[part];
  }
  const key = targetParts.at(-1);
  if (value != null) {
    parent[key] = clone(value);
    return;
  }
  delete parent[key];
  for (const [ancestor, childKey] of parents.reverse()) {
    const child = ancestor[childKey];
    if (child && typeof child === "object" && !Object.keys(child).length) {
      delete ancestor[childKey];
    } else {
      break;
    }
  }
}

function fakeSnapshot(value, key = "") {
  return {
    key,
    exists: () => value != null,
    val: () => clone(value),
    forEach(callback) {
      if (!value || typeof value !== "object") return false;
      for (const [childKey, childValue] of Object.entries(value)) {
        callback(fakeSnapshot(childValue, childKey));
      }
      return false;
    },
  };
}

function createRealtime(initial, { beforeTransaction = null } = {}) {
  const state = clone(initial);
  const queryCalls = [];

  function reference(targetPath, queryState = {}) {
    const nextReference = (next) => reference(targetPath, {
      ...queryState,
      ...next,
    });
    return {
      orderByChild(child) {
        queryCalls.push([targetPath, "orderByChild", child]);
        return nextReference({ order: "child", child });
      },
      orderByKey() {
        queryCalls.push([targetPath, "orderByKey"]);
        return nextReference({ order: "key" });
      },
      startAfter(value, key) {
        queryCalls.push([targetPath, "startAfter", value, key]);
        return nextReference({ startAfter: [value, key] });
      },
      startAt(value, key) {
        queryCalls.push([targetPath, "startAt", value, key]);
        return nextReference({ startAt: [value, key] });
      },
      endAt(value) {
        queryCalls.push([targetPath, "endAt", value]);
        return nextReference({ endAt: value });
      },
      limitToFirst(value) {
        queryCalls.push([targetPath, "limitToFirst", value]);
        return nextReference({ limit: value });
      },
      async get() {
        const value = clone(nodeAt(state, targetPath));
        if (!queryState.order) return fakeSnapshot(value);
        let entries = Object.entries(
          value && typeof value === "object" ? value : {},
        );
        if (queryState.order === "key") {
          entries.sort((first, second) => first[0].localeCompare(second[0]));
          if (queryState.startAfter) {
            entries = entries.filter(([key]) => key > queryState.startAfter[0]);
          }
          if (queryState.startAt) {
            entries = entries.filter(([key]) => key >= queryState.startAt[0]);
          }
        } else {
          const childValue = (entry) => Number(entry?.[queryState.child] || 0);
          entries.sort((first, second) => (
            childValue(first[1]) - childValue(second[1])
            || first[0].localeCompare(second[0])
          ));
          if (queryState.startAfter) {
            const [startValue, startKey] = queryState.startAfter;
            entries = entries.filter(([key, entry]) => (
              childValue(entry) > Number(startValue)
              || (
                childValue(entry) === Number(startValue)
                && key > String(startKey)
              )
            ));
          }
          if (queryState.endAt != null) {
            entries = entries.filter(([, entry]) => (
              childValue(entry) <= Number(queryState.endAt)
            ));
          }
        }
        if (queryState.limit != null) {
          entries = entries.slice(0, queryState.limit);
        }
        return fakeSnapshot(Object.fromEntries(entries));
      },
      async transaction(update) {
        if (beforeTransaction) beforeTransaction(state, targetPath);
        const current = clone(nodeAt(state, targetPath));
        const next = update(current);
        if (next === undefined) {
          return {
            committed: false,
            snapshot: fakeSnapshot(nodeAt(state, targetPath)),
          };
        }
        writeNode(state, targetPath, next);
        return {
          committed: true,
          snapshot: fakeSnapshot(nodeAt(state, targetPath)),
        };
      },
      async set(value) {
        writeNode(state, targetPath, value);
      },
      async remove() {
        writeNode(state, targetPath, null);
      },
    };
  }

  return {
    realtime: { ref: (targetPath) => reference(targetPath) },
    state,
    queryCalls,
  };
}

function record(overrides = {}) {
  return {
    protocolVersion: 2,
    sessionId: "s".repeat(32),
    leaseToken: "l".repeat(32),
    generation: "g".repeat(22),
    attemptId: "a".repeat(22),
    connectionGeneration: "c".repeat(22),
    expiresAt: 1,
    ...overrides,
  };
}

test("V4 cleanup removes only expired exact resources and protects a live room", async () => {
  const now = Date.UTC(2026, 6, 28, 12, 0, 0);
  const liveSessionId = "v".repeat(32);
  const liveGeneration = "w".repeat(22);
  const liveLease = "x".repeat(32);
  const liveAttempt = "y".repeat(22);
  const liveConnection = "z".repeat(22);
  const liveActive = record({
    uid: "live-user",
    sessionId: liveSessionId,
    leaseToken: liveLease,
    generation: liveGeneration,
    roomId: "live-room",
    attemptId: liveAttempt,
    connectionGeneration: liveConnection,
    role: "host",
    lastSeen: now - 100_000,
    expiresAt: now - 1,
  });
  const livePermit = record({
    roomId: "live-room",
    attemptId: liveAttempt,
    connectionGeneration: liveConnection,
    expiresAt: now - 1,
  });
  const replacementPath =
    "online/trainingActiveV4/raced-user/rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr";
  const replacement = record({
    uid: "raced-user",
    sessionId: "r".repeat(32),
    generation: "n".repeat(22),
    roomId: "new-room",
    attemptId: "n".repeat(22),
    expiresAt: now + 60_000,
  });
  let replaced = false;
  const { realtime, state, queryCalls } = createRealtime({
    online: {
      trainingSessionClaims: {
        expired: record({ expiresAt: now - 1 }),
        fresh: record({ expiresAt: now + 1 }),
      },
      trainingQueueV4: {
        expired: {
          ["s".repeat(32)]: record({
            uid: "expired",
            trainingProtocolVersion: 3,
            variant: "kitaeai_hp_v3",
            state: "waiting",
            expiresAt: now - 1,
          }),
          ["t".repeat(32)]: record({
            uid: "expired",
            sessionId: "t".repeat(32),
            trainingProtocolVersion: 3,
            variant: "kitaeai_hp_v3",
            state: "reserved",
            roomId: "missing-room",
            expiresAt: now - 1,
          }),
        },
        "live-user": {
          [liveSessionId]: record({
            uid: "live-user",
            sessionId: liveSessionId,
            leaseToken: liveLease,
            generation: liveGeneration,
            trainingProtocolVersion: 3,
            variant: "kitaeai_hp_v3",
            connectionGeneration: "queue-generation-is-independent",
            roomId: "live-room",
            attemptId: liveAttempt,
            state: "offering",
            expiresAt: now - 1,
          }),
        },
      },
      trainingActiveV4: {
        "live-user": { [liveSessionId]: liveActive },
        "orphan-user": {
          ["o".repeat(32)]: record({
            uid: "orphan-user",
            sessionId: "o".repeat(32),
            roomId: "missing-room",
            expiresAt: now - 1,
          }),
        },
        "raced-user": {
          ["r".repeat(32)]: record({
            uid: "raced-user",
            sessionId: "r".repeat(32),
            roomId: "old-room",
            expiresAt: now - 1,
          }),
        },
      },
      trainingMatchLocksV4: {
        expired: record({ expiresAt: now - 1 }),
        fresh: record({ expiresAt: now + 1 }),
      },
      trainingMatchPermitsV4: {
        "live-room": livePermit,
        "dead-room": record({ roomId: "dead-room", expiresAt: now - 1 }),
      },
      trainingOffersV4: {
        guest: {
          ["q".repeat(32)]: {
            "expired-offer": record({ expiresAt: now - 1 }),
            "fresh-offer": record({ expiresAt: now + 1 }),
          },
        },
      },
      trainingSessionActionRates: {
        ["a".repeat(64)]: {
          heartbeat: {
            windowStartedAt: now - 200_000,
            count: 1,
            lastAt: now - 100_000,
            expiresAt: now - 1,
          },
          claim: {
            windowStartedAt: now,
            count: 1,
            lastAt: now,
            expiresAt: now + 120_000,
          },
        },
      },
      trainingRooms: {
        "live-room": {
          protocolVersion: 3,
          variant: "kitaeai_hp_v3",
          sessionProtocolVersion: 2,
          signalingVersion: 2,
          hostUid: "live-user",
          guestUid: "guest",
          attemptId: liveAttempt,
          connectionGeneration: liveConnection,
          createdAt: now - 300_000,
          activatedAt: now - 250_000,
          status: "active",
          members: { "live-user": true, guest: true },
          accepted: { "live-user": true, guest: true },
          sessions: {
            "live-user": {
              sessionId: liveSessionId,
              generation: liveGeneration,
            },
            guest: {
              sessionId: "u".repeat(32),
              generation: "h".repeat(22),
            },
          },
          presenceV2: {
            "live-user": {
              [liveSessionId]: {
                protocolVersion: 2,
                sessionId: liveSessionId,
                leaseToken: liveLease,
                generation: liveGeneration,
                online: true,
                updatedAt: now - 1_000,
              },
            },
          },
        },
      },
    },
  }, {
    beforeTransaction(currentState, targetPath) {
      if (!replaced && targetPath === replacementPath) {
        replaced = true;
        writeNode(currentState, targetPath, replacement);
      }
    },
  });
  const cleanup = createTrainingSessionResourceCleanup({ realtime });

  const result = await cleanup(now);

  assert.equal(result.claims.removed, 1);
  assert.equal(result.queue.removed, 2);
  assert.equal(result.queue.protected, 1);
  assert.equal(result.active.removed, 1);
  assert.equal(result.active.protected, 1);
  assert.equal(result.locks.removed, 1);
  assert.equal(result.permits.removed, 1);
  assert.equal(result.permits.protected, 1);
  assert.equal(result.offers.removed, 1);
  assert.equal(result.rates.removed, 1);
  assert.equal(
    nodeAt(state, "online/trainingSessionClaims/expired"),
    null,
  );
  assert.equal(
    nodeAt(state, `online/trainingActiveV4/live-user/${liveSessionId}`)
      .roomId,
    "live-room",
  );
  assert.equal(
    nodeAt(
      state,
      `online/trainingQueueV4/expired/${"t".repeat(32)}`,
    ),
    null,
  );
  assert.equal(
    nodeAt(
      state,
      `online/trainingQueueV4/live-user/${liveSessionId}`,
    ).connectionGeneration,
    "queue-generation-is-independent",
  );
  assert.deepEqual(nodeAt(state, replacementPath), replacement);
  assert.equal(
    nodeAt(
      state,
      `online/trainingOffersV4/guest/${"q".repeat(32)}/expired-offer`,
    ),
    null,
  );
  assert.ok(queryCalls.filter((call) => (
    call[1] === "orderByChild" && call[2] === "expiresAt"
  )).length >= 7);
  assert.equal(
    nodeAt(state, TRAINING_SESSION_CLEANUP_CURSORS_PATH),
    null,
  );
});

test("room pointer cleanup fences queue by session generation, not connection generation", async () => {
  const now = Date.UTC(2026, 6, 28, 12, 2, 0);
  const roomId = "pointer-room";
  const attemptId = "a".repeat(22);
  const roomConnection = "c".repeat(22);
  const aliceSession = "s".repeat(32);
  const bobSession = "t".repeat(32);
  const aliceGeneration = "g".repeat(22);
  const bobGeneration = "h".repeat(22);
  const bobReplacement = record({
    uid: "bob",
    sessionId: bobSession,
    generation: "n".repeat(22),
    trainingProtocolVersion: 3,
    variant: "kitaeai_hp_v3",
    connectionGeneration: "replacement-queue-generation",
    roomId,
    attemptId,
    state: "reserved",
    expiresAt: now + 60_000,
  });
  const room = {
    protocolVersion: 3,
    variant: "kitaeai_hp_v3",
    sessionProtocolVersion: 2,
    signalingVersion: 2,
    hostUid: "alice",
    guestUid: "bob",
    attemptId,
    connectionGeneration: roomConnection,
    createdAt: now - 60_000,
    status: "expired",
    members: { alice: true, bob: true },
    sessions: {
      alice: {
        sessionId: aliceSession,
        generation: aliceGeneration,
      },
      bob: {
        sessionId: bobSession,
        generation: bobGeneration,
      },
    },
  };
  const { realtime, state } = createRealtime({
    online: {
      trainingRooms: { [roomId]: room },
      trainingQueueV4: {
        alice: {
          [aliceSession]: record({
            uid: "alice",
            sessionId: aliceSession,
            generation: aliceGeneration,
            trainingProtocolVersion: 3,
            variant: "kitaeai_hp_v3",
            connectionGeneration: "queue-connection-does-not-match-room",
            roomId,
            attemptId,
            state: "offering",
            expiresAt: now - 1,
          }),
        },
        bob: { [bobSession]: bobReplacement },
      },
      trainingActiveV4: {
        alice: {
          [aliceSession]: record({
            uid: "alice",
            sessionId: aliceSession,
            generation: aliceGeneration,
            roomId,
            attemptId,
            connectionGeneration: roomConnection,
            expiresAt: now - 1,
          }),
        },
      },
      trainingMatchLocksV4: {
        alice: {
          protocolVersion: 2,
          roomId,
          attemptId,
          role: "host",
          sessionId: aliceSession,
          generation: aliceGeneration,
          hostUid: "alice",
          guestUid: "bob",
          acquiredAt: now - 60_000,
          expiresAt: now - 1,
        },
      },
      trainingMatchPermitsV4: {
        [roomId]: record({
          roomId,
          attemptId,
          connectionGeneration: roomConnection,
          expiresAt: now - 1,
        }),
      },
      trainingOffersV4: {
        bob: {
          [bobSession]: {
            [roomId]: record({
              roomId,
              attemptId,
              connectionGeneration: roomConnection,
              expiresAt: now - 1,
            }),
          },
        },
      },
    },
  });

  const failures = await cleanupRelatedTrainingPointers(
    realtime,
    roomId,
    room,
  );

  assert.equal(failures, 0);
  assert.equal(
    nodeAt(state, `online/trainingQueueV4/alice/${aliceSession}`),
    null,
  );
  assert.deepEqual(
    nodeAt(state, `online/trainingQueueV4/bob/${bobSession}`),
    bobReplacement,
  );
  assert.equal(
    nodeAt(state, `online/trainingActiveV4/alice/${aliceSession}`),
    null,
  );
  assert.equal(
    nodeAt(state, "online/trainingMatchLocksV4/alice"),
    null,
  );
});

test("expired reserved queues drop terminal or non-live rooms and preserve replacements", async () => {
  const now = Date.UTC(2026, 6, 28, 12, 4, 0);
  const terminalSession = "u".repeat(32);
  const staleSession = "v".repeat(32);
  const racedSession = "w".repeat(32);
  const replacement = record({
    uid: "raced-user",
    sessionId: racedSession,
    generation: "n".repeat(22),
    trainingProtocolVersion: 3,
    variant: "kitaeai_hp_v3",
    state: "waiting",
    expiresAt: now + 60_000,
  });
  const racedPath = `online/trainingQueueV4/raced-user/${racedSession}`;
  let replaced = false;
  const queued = (uid, sessionId, roomId, state, attemptId) => record({
    uid,
    sessionId,
    generation: `${uid[0]}`.repeat(22),
    trainingProtocolVersion: 3,
    variant: "kitaeai_hp_v3",
    connectionGeneration: `queue-${uid}`,
    roomId,
    attemptId,
    state,
    expiresAt: now - 1,
  });
  const terminalQueue = queued(
    "terminal-user",
    terminalSession,
    "terminal-room",
    "reserved",
    "t".repeat(22),
  );
  const staleQueue = queued(
    "stale-user",
    staleSession,
    "stale-room",
    "offering",
    "s".repeat(22),
  );
  const racedQueue = queued(
    "raced-user",
    racedSession,
    "missing-room",
    "reserved",
    "r".repeat(22),
  );
  const { realtime, state } = createRealtime({
    online: {
      trainingQueueV4: {
        "terminal-user": { [terminalSession]: terminalQueue },
        "stale-user": { [staleSession]: staleQueue },
        "raced-user": { [racedSession]: racedQueue },
      },
      trainingRooms: {
        "terminal-room": {
          protocolVersion: 3,
          variant: "kitaeai_hp_v3",
          sessionProtocolVersion: 2,
          signalingVersion: 2,
          hostUid: "terminal-user",
          guestUid: "guest-terminal",
          attemptId: terminalQueue.attemptId,
          connectionGeneration: "room-terminal",
          createdAt: now - 300_000,
          status: "expired",
          destroyed: { by: "server", at: now - 1 },
          members: { "terminal-user": true, "guest-terminal": true },
          sessions: {
            "terminal-user": {
              sessionId: terminalSession,
              generation: terminalQueue.generation,
            },
          },
        },
        "stale-room": {
          protocolVersion: 3,
          variant: "kitaeai_hp_v3",
          sessionProtocolVersion: 2,
          signalingVersion: 2,
          hostUid: "stale-user",
          guestUid: "guest-stale",
          attemptId: staleQueue.attemptId,
          connectionGeneration: "room-stale",
          createdAt: now - 300_000,
          activatedAt: now - 200_000,
          status: "active",
          members: { "stale-user": true, "guest-stale": true },
          accepted: { "stale-user": true, "guest-stale": true },
          sessions: {
            "stale-user": {
              sessionId: staleSession,
              generation: staleQueue.generation,
            },
          },
          presenceV2: {},
        },
      },
    },
  }, {
    beforeTransaction(currentState, targetPath) {
      if (!replaced && targetPath === racedPath) {
        replaced = true;
        writeNode(currentState, targetPath, replacement);
      }
    },
  });
  const cleanup = createTrainingSessionResourceCleanup({ realtime });

  const result = await cleanup(now);

  assert.equal(result.queue.examined, 3);
  assert.equal(result.queue.removed, 2);
  assert.equal(result.queue.protected, 0);
  assert.equal(
    nodeAt(
      state,
      `online/trainingQueueV4/terminal-user/${terminalSession}`,
    ),
    null,
  );
  assert.equal(
    nodeAt(state, `online/trainingQueueV4/stale-user/${staleSession}`),
    null,
  );
  assert.deepEqual(nodeAt(state, racedPath), replacement);
});

test("V4 cleanup batch cursor advances past equal expirations", async () => {
  assert.equal(TRAINING_SESSION_CLEANUP_BATCH_SIZE, 25);
  const now = Date.UTC(2026, 6, 28, 12, 5, 0);
  const { realtime, state } = createRealtime({
    online: {
      trainingSessionClaims: {
        alice: record({ expiresAt: now - 1 }),
        bob: record({ expiresAt: now - 1 }),
      },
    },
  });
  const cleanup = createTrainingSessionResourceCleanup({
    realtime,
    batchSize: 1,
    ownerScanSize: 1,
    offerSessionScanSize: 1,
  });

  const first = await cleanup(now);
  assert.equal(first.claims.examined, 1);
  assert.equal(first.claims.removed, 1);
  assert.equal(first.claims.hasMore, true);
  assert.deepEqual(
    nodeAt(state, `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/claims`),
    {
      recordKey: "alice",
      expiresAt: now - 1,
      updatedAt: now,
    },
  );

  const second = await cleanup(now);
  assert.equal(second.claims.examined, 1);
  assert.equal(second.claims.removed, 1);
  assert.equal(nodeAt(state, "online/trainingSessionClaims/alice"), null);
  assert.equal(nodeAt(state, "online/trainingSessionClaims/bob"), null);

  const third = await cleanup(now);
  assert.equal(third.claims.examined, 0);
  assert.equal(
    nodeAt(state, `${TRAINING_SESSION_CLEANUP_CURSORS_PATH}/claims`),
    null,
  );
});

test("V4 cleanup indexes and scheduled wiring are explicit", () => {
  const functionsRoot = path.resolve(__dirname, "..");
  const rules = JSON.parse(fs.readFileSync(
    path.resolve(functionsRoot, "..", "database.rules.json"),
    "utf8",
  )).rules.online;
  assert.deepEqual(
    rules.trainingSessionClaims[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingSessionActionRates.$ownerHash[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingQueueV4.$uid[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingActiveV4.$uid[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingOffersV4.$targetUid.$targetSessionId[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingMatchLocksV4[".indexOn"],
    ["expiresAt"],
  );
  assert.deepEqual(
    rules.trainingMatchPermitsV4[".indexOn"],
    ["expiresAt"],
  );
  assert.equal(rules.trainingSessionCleanupCursors[".read"], false);
  assert.equal(rules.trainingSessionCleanupCursors[".write"], false);

  const source = fs.readFileSync(
    path.join(functionsRoot, "index.js"),
    "utf8",
  );
  assert.match(source, /createTrainingSessionResourceCleanup/);
  assert.match(
    source,
    /const cleanupTrainingSessionResources = createTrainingSessionResourceCleanup\(\{\s*realtime,\s*\}\)/,
  );
  assert.match(
    source,
    /const \[rooms, attempts, retiredResources\] = await Promise\.all\(\[[\s\S]*cleanupTrainingSessionV5\(now\),[\s\S]*cleanupTrainingSessionResources\(now\)/,
  );
  assert.match(source, /const result = \{ rooms, attempts, retiredResources \}/);
});
