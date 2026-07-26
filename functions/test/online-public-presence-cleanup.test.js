"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ONLINE_PUBLIC_PRESENCE_CLEANUP_BATCH_SIZE,
  ONLINE_PUBLIC_PRESENCE_STALE_MS,
  createOnlinePublicPresenceCleanup,
  staleOnlinePublicPresence,
} = require("../online-public-presence-cleanup");

test("staleOnlinePublicPresence uses the server cleanup cutoff", () => {
  assert.equal(staleOnlinePublicPresence({ lastSeen: 999 }, 1_000), true);
  assert.equal(staleOnlinePublicPresence({ lastSeen: 1_000 }, 1_000), false);
  assert.equal(staleOnlinePublicPresence(null, 1_000), true);
});

test("cleanup removes only entries that remain stale and their owners", async () => {
  const now = 2_000_000;
  const staleId = "stale";
  const revivedId = "revived";
  const removedOwners = [];
  const transactions = [];
  const queryCalls = [];
  const values = new Map([
    [staleId, { lastSeen: now - ONLINE_PUBLIC_PRESENCE_STALE_MS - 1 }],
    [revivedId, { lastSeen: now }],
  ]);
  const candidateSnapshot = {
    forEach(callback) {
      callback({ key: staleId });
      callback({ key: revivedId });
    },
  };
  const query = {
    orderByChild(child) {
      queryCalls.push(["orderByChild", child]);
      return this;
    },
    endAt(value) {
      queryCalls.push(["endAt", value]);
      return this;
    },
    limitToFirst(value) {
      queryCalls.push(["limitToFirst", value]);
      return this;
    },
    async get() {
      return candidateSnapshot;
    },
  };
  const realtime = {
    ref(path) {
      if (path === "online/publicPresence") return query;
      if (path.startsWith("online/publicPresenceOwners/")) {
        return {
          async remove() {
            removedOwners.push(path);
          },
        };
      }
      if (path.startsWith("online/publicPresence/")) {
        const id = path.split("/").pop();
        return {
          async transaction(update) {
            const next = update(values.get(id));
            transactions.push([id, next]);
            if (next === null) values.delete(id);
            return {
              committed: next !== undefined,
              snapshot: { exists: () => values.has(id) },
            };
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  const cleanup = createOnlinePublicPresenceCleanup({ realtime });
  const result = await cleanup(now);

  assert.deepEqual(queryCalls, [
    ["orderByChild", "lastSeen"],
    ["endAt", now - ONLINE_PUBLIC_PRESENCE_STALE_MS - 1],
    ["limitToFirst", ONLINE_PUBLIC_PRESENCE_CLEANUP_BATCH_SIZE],
  ]);
  assert.deepEqual(transactions, [
    [staleId, null],
    [revivedId, undefined],
  ]);
  assert.deepEqual(removedOwners, [
    "online/publicPresenceOwners/stale",
  ]);
  assert.deepEqual(result, {
    examined: 2,
    removed: 1,
    hasMore: false,
  });
});
