"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS,
  SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH,
  createSoloSessionV2ResourceCleanup,
} = require("../solo-session-v2-resource-cleanup");

const NOW = 1_800_000_000_000;
const CUTOFF = NOW - (10 * 60_000);
const SESSION_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_A = "11111111111111111111111111111111";
const TOKEN_B = "22222222222222222222222222222222";
const GENERATION_A = "generation_A_123456789";
const GENERATION_B = "generation_B_123456789";
const ATTEMPT_A = "attempt_A_1234567890123";
const CONNECTION_A = "connection_A_1234567890";
const CONNECTION_B = "connection_B_1234567890";
const CLEANUP_TOKEN = "cleanup_token_123456789012345";
const ROOM_IDS = [
  "-AbCdEfGhIjKlMnOpQrS",
  "-BcDeFgHiJkLmNoPqRsT",
  "-CdEfGhIjKlMnOpQrStU",
  "-DeFgHiJkLmNoPqRsTuV",
  "-EfGhIjKlMnOpQrStUvW",
  "-FgHiJkLmNoPqRsTuVwX",
  "-GhIjKlMnOpQrStUvWxY",
  "-HiJkLmNoPqRsTuVwXyZ",
];

function expiredClaim(overrides = {}) {
  const expiresAt = overrides.expiresAt ?? CUTOFF - 1;
  return {
    protocolVersion: 2,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
    claimedAt: expiresAt - 50_000,
    heartbeatAt: expiresAt - 10_000,
    expiresAt,
    ...overrides,
  };
}

function active(uid, roomId, overrides = {}) {
  return {
    protocolVersion: 2,
    uid,
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
    roomId,
    attemptId: ATTEMPT_A,
    connectionGeneration: CONNECTION_A,
    role: "host",
    lastSeen: CUTOFF - 10_000,
    expiresAt: CUTOFF - 1,
    ...overrides,
  };
}

function room(uid, roomId, overrides = {}) {
  return {
    protocolVersion: 2,
    signalingVersion: 2,
    hostUid: uid,
    guestUid: `guest-${uid}`,
    attemptId: ATTEMPT_A,
    connectionGeneration: CONNECTION_A,
    createdAt: CUTOFF - 120_000,
    expiresAt: CUTOFF - 60_000,
    status: "active",
    members: {
      [uid]: true,
      [`guest-${uid}`]: true,
    },
    sessions: {
      [uid]: {
        sessionId: SESSION_A,
        generation: GENERATION_A,
      },
      [`guest-${uid}`]: {
        sessionId: SESSION_B,
        generation: GENERATION_B,
      },
    },
    ...overrides,
  };
}

function childValue(value, childPath) {
  return String(childPath || "")
    .split("/")
    .filter(Boolean)
    .reduce((current, key) => current?.[key], value);
}

function snapshot(value, key = null) {
  return {
    key,
    val: () => value,
    exists: () => value !== null && value !== undefined,
    get: (childPath) => childValue(value, childPath),
    child: (childPath) => snapshot(childValue(value, childPath), String(childPath).split("/").pop()),
    numChildren: () => (
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).length
        : 0
    ),
    forEach(callback) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      for (const [childKey, child] of Object.entries(value)) {
        if (callback(snapshot(child, childKey)) === true) return true;
      }
      return false;
    },
  };
}

function createRealtimeHarness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const queryCalls = [];
  const writeCalls = [];
  const beforeTransaction = new Map();
  const failTransactionOnce = new Map();
  const coldCacheOnce = new Set();
  const callbackInputs = new Map();

  function readValue(path) {
    if (values.has(path)) return values.get(path);
    const prefix = `${path}/`;
    const children = {};
    for (const [storedPath, storedValue] of values.entries()) {
      if (!storedPath.startsWith(prefix)) continue;
      const suffix = storedPath.slice(prefix.length);
      if (!suffix || suffix.includes("/")) continue;
      children[suffix] = storedValue;
    }
    return Object.keys(children).length ? children : null;
  }

  function writeValue(path, value) {
    if (value !== null && value !== undefined) {
      values.set(path, value);
      return;
    }
    values.delete(path);
    const prefix = `${path}/`;
    for (const storedPath of [...values.keys()]) {
      if (storedPath.startsWith(prefix)) values.delete(storedPath);
    }
  }

  function recordCallback(path, value, output) {
    const calls = callbackInputs.get(path) || [];
    calls.push({ input: value, output });
    callbackInputs.set(path, calls);
  }

  function claimsQuery() {
    const filters = {};
    const query = {
      orderByChild(child) {
        filters.orderByChild = child;
        queryCalls.push(["orderByChild", child]);
        return query;
      },
      startAt(value) {
        filters.startAt = value;
        queryCalls.push(["startAt", value]);
        return query;
      },
      endAt(value) {
        filters.endAt = value;
        queryCalls.push(["endAt", value]);
        return query;
      },
      limitToFirst(value) {
        filters.limitToFirst = value;
        queryCalls.push(["limitToFirst", value]);
        return query;
      },
      async get() {
        const prefix = `${SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH}/`;
        const entries = [...values.entries()]
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, value]) => [path.slice(prefix.length), value])
          .filter(([uid, value]) => (
            !uid.includes("/")
            && (filters.startAt == null
              || Number(value?.[filters.orderByChild]) >= filters.startAt)
            && (filters.endAt == null
              || Number(value?.[filters.orderByChild]) <= filters.endAt)
          ))
          .sort((first, second) => (
            Number(first[1]?.[filters.orderByChild] || 0)
              - Number(second[1]?.[filters.orderByChild] || 0)
            || first[0].localeCompare(second[0])
          ))
          .slice(0, filters.limitToFirst);
        return snapshot(Object.fromEntries(entries));
      },
    };
    return query;
  }

  const realtime = {
    ref(path) {
      if (path === SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH) return claimsQuery();
      return {
        async get() {
          return snapshot(readValue(path), path.split("/").pop());
        },
        async transaction(update) {
          writeCalls.push(["transaction", path]);
          const failureCount = failTransactionOnce.get(path) || 0;
          if (failureCount > 0) {
            failTransactionOnce.set(path, failureCount - 1);
            throw new Error(`Injected transaction failure: ${path}`);
          }
          const before = beforeTransaction.get(path);
          if (before) {
            beforeTransaction.delete(path);
            before(values);
          }
          if (coldCacheOnce.delete(path)) {
            const coldOutput = update(null);
            recordCallback(path, null, coldOutput);
            if (coldOutput === undefined) {
              return { committed: false, snapshot: snapshot(null) };
            }
          }
          const current = readValue(path);
          const next = update(current);
          recordCallback(path, current, next);
          if (next === undefined) {
            return { committed: false, snapshot: snapshot(current) };
          }
          writeValue(path, next);
          return { committed: true, snapshot: snapshot(next) };
        },
        async remove() {
          writeCalls.push(["remove", path]);
          writeValue(path, null);
        },
        async set(value) {
          writeCalls.push(["set", path]);
          writeValue(path, value);
        },
        async update(updates) {
          writeCalls.push(["update", path]);
          for (const [relativePath, value] of Object.entries(updates || {})) {
            writeValue(`${path}/${relativePath}`, value);
          }
        },
      };
    },
  };

  return {
    beforeTransaction,
    callbackInputs,
    coldCacheOnce,
    failTransactionOnce,
    queryCalls,
    realtime,
    values,
    writeCalls,
  };
}

function createQueueIndexHarness() {
  const calls = [];
  return {
    calls,
    queueIndex: {
      async remove(uid, expected) {
        calls.push({ uid, expected });
        return true;
      },
    },
  };
}

function claimPath(uid) {
  return `${SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH}/${uid}`;
}

function queuePath(uid, sessionId = SESSION_A) {
  return `online/queueV2/${uid}/${sessionId}`;
}

function activePath(uid, sessionId = SESSION_A) {
  return `online/activeV2/${uid}/${sessionId}`;
}

function roomPath(roomId) {
  return `online/rooms/${roomId}`;
}

function roomWrites(harness) {
  return harness.writeCalls.filter(([, path]) => path.startsWith("online/rooms/"));
}

test("cleanup uses the indexed grace cutoff and a strict batch bound", async () => {
  assert.equal(SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH, "online/soloSessionClaims");
  assert.equal(SOLO_SESSION_V2_RESOURCE_CLEANUP_BATCH_SIZE, 25);
  assert.equal(SOLO_SESSION_V2_RESOURCE_CLEANUP_GRACE_MS, 10 * 60_000);

  const initial = {};
  for (let index = 0; index < 26; index += 1) {
    const uid = `bounded-${String(index).padStart(2, "0")}`;
    initial[claimPath(uid)] = expiredClaim({ expiresAt: CUTOFF - 100 - index });
  }
  initial[claimPath("boundary-fresh")] = expiredClaim({ expiresAt: CUTOFF + 1 });
  const h = createRealtimeHarness(initial);
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const result = await cleanup(NOW);

  assert.deepEqual(h.queryCalls, [
    ["orderByChild", "expiresAt"],
    ["startAt", 1],
    ["endAt", CUTOFF],
    ["limitToFirst", 25],
  ]);
  assert.equal(result.dryRun, false);
  assert.equal(result.examined, 25);
  assert.equal(result.marked, 25);
  assert.equal(result.claimsRemoved, 25);
  assert.equal(result.hasMore, true);
  assert.equal(result.oldestAgeMs, NOW - (CUTOFF - 125));
  assert.equal(h.values.has(claimPath("boundary-fresh")), true);
  assert.equal(
    [...h.values.keys()].filter((path) => path.startsWith(`${SOLO_SESSION_V2_RESOURCE_CLEANUP_PATH}/`)).length,
    2,
  );
  assert.deepEqual(roomWrites(h), []);
});

test("dry-run observes candidates without transactions or index writes", async () => {
  const uid = "dry-run-owner";
  const roomId = ROOM_IDS[0];
  const originalClaim = expiredClaim();
  const originalActive = active(uid, roomId);
  const h = createRealtimeHarness({
    [claimPath(uid)]: originalClaim,
    [queuePath(uid)]: { ...originalActive, state: "waiting" },
    [activePath(uid)]: originalActive,
  });
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const result = await cleanup(NOW, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.examined, 1);
  assert.equal(result.claimsRemoved, 0);
  assert.equal(result.activeRemoved, 1);
  assert.equal(result.queueRemoved, 0);
  assert.equal(result.indexReleased, 0);
  assert.deepEqual(h.writeCalls, []);
  assert.deepEqual(q.calls, []);
  assert.deepEqual(h.values.get(claimPath(uid)), originalClaim);
  assert.deepEqual(h.values.get(activePath(uid)), originalActive);
  assert.deepEqual(roomWrites(h), []);
});

test("claim CAS preserves a heartbeat refresh and a newer generation", async (t) => {
  for (const race of ["heartbeat", "generation"]) {
    await t.test(race, async () => {
      const uid = `race-${race}`;
      const roomId = ROOM_IDS[race === "heartbeat" ? 1 : 2];
      const oldClaim = expiredClaim();
      const oldActive = active(uid, roomId);
      const h = createRealtimeHarness({
        [claimPath(uid)]: oldClaim,
        [activePath(uid)]: oldActive,
      });
      const replacement = race === "heartbeat"
        ? {
          ...oldClaim,
          heartbeatAt: NOW,
          expiresAt: NOW + 60_000,
        }
        : expiredClaim({
          sessionId: SESSION_B,
          leaseToken: TOKEN_B,
          generation: GENERATION_B,
          claimedAt: NOW,
          heartbeatAt: NOW,
          expiresAt: NOW + 60_000,
        });
      h.beforeTransaction.set(claimPath(uid), (values) => {
        values.set(claimPath(uid), replacement);
      });
      const q = createQueueIndexHarness();
      const cleanup = createSoloSessionV2ResourceCleanup({
        realtime: h.realtime,
        queueIndex: q.queueIndex,
      });

      const result = await cleanup(NOW);

      assert.deepEqual(h.values.get(claimPath(uid)), replacement);
      assert.deepEqual(h.values.get(activePath(uid)), oldActive);
      assert.equal(result.claimsRemoved, 0);
      assert.equal(result.activeRemoved, 0);
      assert.equal(result.conflicts, 1);
      assert.deepEqual(q.calls, []);
      assert.deepEqual(roomWrites(h), []);
    });
  }
});

test("a marked claim resumes after failure and cold-cache retries remain exact", async () => {
  const uid = "resume-owner";
  const roomId = ROOM_IDS[3];
  const baseClaim = expiredClaim();
  const markedClaim = {
    ...baseClaim,
    staleCleanupV1: {
      version: 1,
      token: CLEANUP_TOKEN,
      startedAt: NOW - 60_000,
    },
  };
  const oldActive = active(uid, roomId);
  const oldQueue = { ...oldActive, state: "waiting" };
  const h = createRealtimeHarness({
    [claimPath(uid)]: markedClaim,
    [queuePath(uid)]: oldQueue,
    [activePath(uid)]: oldActive,
  });
  h.failTransactionOnce.set(activePath(uid), 1);
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const failed = await cleanup(NOW);

  assert.equal(failed.errors, 1);
  assert.equal(failed.markerRetained, 1);
  const deferredMarker = h.values.get(claimPath(uid));
  assert.equal(deferredMarker.expiresAt, CUTOFF + 1);
  assert.equal(deferredMarker.staleCleanupV1.originalExpiresAt, markedClaim.expiresAt);
  assert.equal(deferredMarker.staleCleanupV1.deferredAt, NOW);

  h.coldCacheOnce.add(claimPath(uid));
  h.coldCacheOnce.add(activePath(uid));
  h.coldCacheOnce.add(queuePath(uid));
  const resumed = await cleanup(NOW + 5 * 60_000);

  assert.equal(resumed.resumed, 1);
  assert.equal(resumed.claimsRemoved, 1);
  assert.equal(resumed.activeRemoved, 1);
  assert.equal(resumed.queueRemoved, 1);
  assert.equal(resumed.indexReleased, 1);
  assert.equal(resumed.markerRetained, 0);
  assert.equal(h.values.has(claimPath(uid)), false);
  assert.equal(h.values.has(activePath(uid)), false);
  assert.equal(h.values.has(queuePath(uid)), false);
  for (const path of [claimPath(uid), activePath(uid), queuePath(uid)]) {
    const coldCall = h.callbackInputs.get(path)?.find(({ input }) => input === null);
    assert.ok(coldCall, `${path} must exercise the cold-cache callback`);
    assert.equal(coldCall.output, null, `${path} must request a server retry from null`);
  }
  assert.deepEqual(roomWrites(h), []);
});

test("active cleanup is exact and limited to terminal, missing, or stale-offered rooms", async () => {
  const cases = [
    { uid: "missing-room", roomId: ROOM_IDS[0], removable: true },
    {
      uid: "destroyed-room",
      roomId: ROOM_IDS[1],
      removable: true,
      room: { destroyed: { by: "peer", at: CUTOFF } },
    },
    {
      uid: "finalized-room",
      roomId: ROOM_IDS[2],
      removable: true,
      room: { serverFinalized: { at: CUTOFF, resultToken: "result_12345678901234" } },
    },
    {
      uid: "stale-offered-room",
      roomId: ROOM_IDS[3],
      removable: true,
      room: { status: "offered" },
    },
    {
      uid: "live-active-room",
      roomId: ROOM_IDS[4],
      removable: false,
      room: { status: "active" },
    },
    {
      uid: "unknown-room-state",
      roomId: ROOM_IDS[6],
      removable: false,
      room: { status: "future-state" },
    },
    {
      uid: "offered-room-transition",
      roomId: ROOM_IDS[7],
      removable: false,
      room: {
        status: "offered",
        matchTransition: {
          action: "accept",
          token: "transition_token_1234567890",
          startedAt: NOW - 60_000,
        },
      },
    },
  ];
  const initial = {};
  const originalRooms = new Map();
  for (const item of cases) {
    initial[claimPath(item.uid)] = expiredClaim();
    initial[queuePath(item.uid)] = { ...active(item.uid, item.roomId), state: "waiting" };
    initial[activePath(item.uid)] = active(item.uid, item.roomId);
    if (item.room) {
      const roomValue = room(item.uid, item.roomId, item.room);
      initial[roomPath(item.roomId)] = roomValue;
      originalRooms.set(item.roomId, roomValue);
    }
  }
  const h = createRealtimeHarness(initial);
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const result = await cleanup(NOW);

  assert.equal(result.examined, 7);
  assert.equal(result.claimsRemoved, 4);
  assert.equal(result.activeExamined, 7);
  assert.equal(result.activeRemoved, 4);
  assert.equal(result.activeDeferred, 3);
  assert.equal(result.queueRemoved, 4);
  assert.equal(result.indexReleased, 4);
  assert.equal(result.markerRetained, 3);
  for (const item of cases) {
    assert.equal(
      h.values.has(claimPath(item.uid)),
      !item.removable,
      `${item.uid} claim`,
    );
    assert.equal(
      h.values.has(queuePath(item.uid)),
      !item.removable,
      `${item.uid} queue`,
    );
    assert.equal(
      h.values.has(activePath(item.uid)),
      !item.removable,
      `${item.uid} active`,
    );
  }
  const deferredClaim = h.values.get(claimPath("live-active-room"));
  assert.equal(deferredClaim.expiresAt, CUTOFF + 1);
  assert.equal(deferredClaim.staleCleanupV1.originalExpiresAt, CUTOFF - 1);
  assert.equal(deferredClaim.staleCleanupV1.deferredAt, NOW);
  for (const [roomId, original] of originalRooms) {
    assert.deepEqual(h.values.get(roomPath(roomId)), original);
  }
  assert.deepEqual(roomWrites(h), []);
});

test("active CAS preserves a changed attempt or connection even when its room is missing", async () => {
  const uid = "active-race-owner";
  const roomId = ROOM_IDS[5];
  const original = active(uid, roomId);
  const changed = {
    ...original,
    attemptId: "attempt_B_1234567890123",
    connectionGeneration: CONNECTION_B,
  };
  const h = createRealtimeHarness({
    [claimPath(uid)]: expiredClaim(),
    [activePath(uid)]: original,
  });
  h.beforeTransaction.set(activePath(uid), (values) => {
    values.set(activePath(uid), changed);
  });
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const result = await cleanup(NOW);

  assert.deepEqual(h.values.get(activePath(uid)), changed);
  assert.equal(result.claimsRemoved, 1);
  assert.equal(result.activeRemoved, 0);
  assert.deepEqual(roomWrites(h), []);
});

test("a new generation that replaces a cleanup marker survives final claim cleanup", async () => {
  const uid = "post-marker-generation";
  const roomId = ROOM_IDS[0];
  const oldActive = active(uid, roomId);
  const oldQueue = { ...oldActive, state: "waiting" };
  const nextClaim = expiredClaim({
    generation: GENERATION_B,
    claimedAt: NOW,
    heartbeatAt: NOW,
    expiresAt: NOW + 60_000,
  });
  const nextActive = active(uid, ROOM_IDS[1], {
    generation: GENERATION_B,
    attemptId: "attempt_B_1234567890123",
    connectionGeneration: CONNECTION_B,
    lastSeen: NOW,
    expiresAt: NOW + 60_000,
  });
  const nextQueue = { ...nextActive, state: "waiting" };
  const h = createRealtimeHarness({
    [claimPath(uid)]: expiredClaim(),
    [queuePath(uid)]: oldQueue,
    [activePath(uid)]: oldActive,
  });
  h.beforeTransaction.set(activePath(uid), (values) => {
    values.set(claimPath(uid), nextClaim);
    values.set(activePath(uid), nextActive);
    values.set(queuePath(uid), nextQueue);
  });
  const q = createQueueIndexHarness();
  const cleanup = createSoloSessionV2ResourceCleanup({
    realtime: h.realtime,
    queueIndex: q.queueIndex,
  });

  const result = await cleanup(NOW);

  assert.deepEqual(h.values.get(claimPath(uid)), nextClaim);
  assert.deepEqual(h.values.get(activePath(uid)), nextActive);
  assert.deepEqual(h.values.get(queuePath(uid)), nextQueue);
  assert.equal(result.marked, 1);
  assert.equal(result.claimsRemoved, 0);
  assert.equal(result.activeRemoved, 0);
  assert.equal(result.markerRetained, 0);
  assert.equal(q.calls.length, 1);
  assert.equal(q.calls[0].expected.generation, GENERATION_A);
  assert.deepEqual(roomWrites(h), []);
});
