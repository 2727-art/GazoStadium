"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SOLO_SESSION_V2_QUEUE_INDEX_CLEANUP_BATCH_SIZE,
  SOLO_SESSION_V2_QUEUE_INDEX_MATCH_LIMIT,
  SOLO_SESSION_V2_QUEUE_INDEX_PATH,
  createSoloSessionV2QueueIndex,
  indexedSoloSessionV2QueueEntry,
} = require("../solo-session-v2-queue-index");

const NOW = 1_800_000_000_000;
const UID = "owner";
const SESSION_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SESSION_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_A = "11111111111111111111111111111111";
const TOKEN_B = "22222222222222222222222222222222";
const GENERATION_A = "generation_A_123456789";
const GENERATION_B = "generation_B_123456789";

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
    name: "PLAYER",
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

function snapshot(value, key = null) {
  return {
    key,
    val: () => value,
    forEach(callback) {
      for (const [childKey, childValue] of Object.entries(value || {})) {
        callback(snapshot(childValue, childKey));
      }
    },
  };
}

function createRealtimeHarness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const queryCalls = [];
  const beforeTransaction = new Map();

  function queryRef(path) {
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
        const prefix = `${path}/`;
        const entries = [...values.entries()]
          .filter(([entryPath]) => entryPath.startsWith(prefix))
          .map(([entryPath, value]) => [entryPath.slice(prefix.length), value])
          .filter(([, value]) => (
            (filters.startAt == null || Number(value?.[filters.orderByChild]) >= filters.startAt)
            && (filters.endAt == null || Number(value?.[filters.orderByChild]) <= filters.endAt)
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
      if (path === SOLO_SESSION_V2_QUEUE_INDEX_PATH) return queryRef(path);
      return {
        async transaction(update) {
          const before = beforeTransaction.get(path);
          if (before) {
            beforeTransaction.delete(path);
            before(values);
          }
          const current = values.get(path) ?? null;
          const next = update(current);
          if (next === undefined) {
            return { committed: false, snapshot: snapshot(current) };
          }
          if (next === null) values.delete(path);
          else values.set(path, next);
          return { committed: true, snapshot: snapshot(next) };
        },
      };
    },
  };

  return { beforeTransaction, queryCalls, realtime, values };
}

test("index accepts only an exact fresh claim and carries a server ordering fence", () => {
  const currentClaim = claim(SESSION_A, TOKEN_A, GENERATION_A);
  const entry = queue(UID, SESSION_A, TOKEN_A, GENERATION_A);
  const indexed = indexedSoloSessionV2QueueEntry(
    UID,
    SESSION_A,
    entry,
    currentClaim,
    NOW,
  );
  assert.equal(indexed.claimClaimedAt, currentClaim.claimedAt);
  assert.equal(indexed.indexedAt, NOW);
  assert.equal(indexed.expiresAt, currentClaim.expiresAt);
  assert.equal(indexedSoloSessionV2QueueEntry(
    UID,
    SESSION_A,
    entry,
    claim(SESSION_A, TOKEN_B, GENERATION_A),
    NOW,
  ), null);
});

test("a delayed old publisher cannot replace a newer claim index", async () => {
  const h = createRealtimeHarness();
  const index = createSoloSessionV2QueueIndex({ realtime: h.realtime });
  const newerClaim = claim(SESSION_B, TOKEN_B, GENERATION_B, {
    claimedAt: NOW,
    heartbeatAt: NOW + 1,
    expiresAt: NOW + 50_001,
  });
  const newerQueue = queue(UID, SESSION_B, TOKEN_B, GENERATION_B, {
    joinedAt: NOW,
    lastSeen: NOW + 1,
    expiresAt: newerClaim.expiresAt,
  });
  assert.ok(await index.publish(UID, SESSION_B, newerQueue, newerClaim, NOW + 1));

  const olderClaim = claim(SESSION_A, TOKEN_A, GENERATION_A);
  const olderQueue = queue(UID, SESSION_A, TOKEN_A, GENERATION_A);
  assert.equal(await index.publish(UID, SESSION_A, olderQueue, olderClaim, NOW + 2), null);
  assert.equal(
    h.values.get(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${UID}`).generation,
    GENERATION_B,
  );
});

test("publish reuses a fresher stored value after a same-fence heartbeat race", async () => {
  const currentClaim = claim(SESSION_A, TOKEN_A, GENERATION_A, {
    expiresAt: NOW + 55_000,
  });
  const currentQueue = queue(UID, SESSION_A, TOKEN_A, GENERATION_A, {
    lastSeen: NOW,
    expiresAt: currentClaim.expiresAt,
  });
  const h = createRealtimeHarness();
  const index = createSoloSessionV2QueueIndex({ realtime: h.realtime });
  const stored = await index.publish(UID, SESSION_A, currentQueue, currentClaim, NOW);
  assert.ok(stored);

  const olderQueue = { ...currentQueue, lastSeen: NOW - 1_000, expiresAt: NOW + 50_000 };
  const reused = await index.publish(UID, SESSION_A, olderQueue, currentClaim, NOW + 1);
  assert.equal(reused.expiresAt, currentClaim.expiresAt);
  assert.equal(reused.lastSeen, NOW);
});

test("remove accepts a protocol-less fence and never removes a newer generation", async () => {
  const currentClaim = claim(SESSION_A, TOKEN_A, GENERATION_A);
  const currentQueue = queue(UID, SESSION_A, TOKEN_A, GENERATION_A);
  const h = createRealtimeHarness();
  const index = createSoloSessionV2QueueIndex({ realtime: h.realtime });
  assert.ok(await index.publish(UID, SESSION_A, currentQueue, currentClaim, NOW));

  assert.equal(await index.remove(UID, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_B,
  }), true);
  assert.ok(h.values.has(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${UID}`));
  assert.equal(await index.remove(UID, {
    sessionId: SESSION_A,
    leaseToken: TOKEN_A,
    generation: GENERATION_A,
  }), true);
  assert.equal(h.values.has(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${UID}`), false);
});

test("fresh loading is indexed and bounded", async () => {
  const fresh = queue(UID, SESSION_A, TOKEN_A, GENERATION_A);
  const expired = queue("expired", SESSION_B, TOKEN_B, GENERATION_B, {
    expiresAt: NOW,
  });
  const h = createRealtimeHarness({
    [`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${UID}`]: fresh,
    [`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/expired`]: expired,
  });
  const index = createSoloSessionV2QueueIndex({ realtime: h.realtime });
  assert.deepEqual(await index.loadFresh(NOW), { [UID]: fresh });
  assert.deepEqual(h.queryCalls, [
    ["orderByChild", "expiresAt"],
    ["startAt", NOW + 1],
    ["limitToFirst", SOLO_SESSION_V2_QUEUE_INDEX_MATCH_LIMIT],
  ]);
});

test("cleanup removes only the same expired fence and preserves heartbeat and generation races", async () => {
  const expiredA = queue("expired-a", SESSION_A, TOKEN_A, GENERATION_A, {
    expiresAt: NOW,
  });
  const revived = queue("revived", SESSION_A, TOKEN_A, GENERATION_A, {
    expiresAt: NOW,
  });
  const replaced = queue("replaced", SESSION_A, TOKEN_A, GENERATION_A, {
    expiresAt: NOW,
  });
  const h = createRealtimeHarness({
    [`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/expired-a`]: expiredA,
    [`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/revived`]: revived,
    [`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/replaced`]: replaced,
  });
  h.beforeTransaction.set(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/revived`, (values) => {
    values.set(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/revived`, {
      ...revived,
      expiresAt: NOW + 50_000,
    });
  });
  h.beforeTransaction.set(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/replaced`, (values) => {
    values.set(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/replaced`, {
      ...replaced,
      generation: GENERATION_B,
    });
  });
  const index = createSoloSessionV2QueueIndex({ realtime: h.realtime });
  assert.deepEqual(await index.cleanupExpired(NOW), {
    examined: 3,
    removed: 1,
    hasMore: false,
  });
  assert.equal(h.values.has(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/expired-a`), false);
  assert.equal(
    h.values.get(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/revived`).expiresAt,
    NOW + 50_000,
  );
  assert.equal(
    h.values.get(`${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/replaced`).generation,
    GENERATION_B,
  );
  assert.deepEqual(h.queryCalls, [
    ["orderByChild", "expiresAt"],
    ["endAt", NOW],
    ["limitToFirst", SOLO_SESSION_V2_QUEUE_INDEX_CLEANUP_BATCH_SIZE],
  ]);
});

test("cleanup retries an Admin transaction cold-cache null before removing the server row", async () => {
  const expired = queue(UID, SESSION_A, TOKEN_A, GENERATION_A, {
    expiresAt: NOW,
  });
  const query = {
    orderByChild: () => query,
    endAt: () => query,
    limitToFirst: () => query,
    get: async () => snapshot({ [UID]: expired }),
  };
  const callbackInputs = [];
  const realtime = {
    ref(path) {
      if (path === SOLO_SESSION_V2_QUEUE_INDEX_PATH) return query;
      assert.equal(path, `${SOLO_SESSION_V2_QUEUE_INDEX_PATH}/${UID}`);
      return {
        async transaction(update) {
          callbackInputs.push(null);
          assert.equal(update(null), null);
          callbackInputs.push(expired);
          assert.equal(update(expired), null);
          return { committed: true, snapshot: snapshot(null) };
        },
      };
    },
  };
  const index = createSoloSessionV2QueueIndex({ realtime });
  assert.deepEqual(await index.cleanupExpired(NOW), {
    examined: 1,
    removed: 1,
    hasMore: false,
  });
  assert.deepEqual(callbackInputs, [null, expired]);
});
