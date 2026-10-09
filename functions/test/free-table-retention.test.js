"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { cleanupRetiredFreeTableHistory, RETENTION_COLLECTIONS } = require("../free-table-retention");

test("daily retention queries only existing expiry policies and bounded terminal sessions", async () => {
  const now = 1700000000000;
  const queried = [], removed = [], pages = new Map();
  const firestore = {
    collection(name) {
      assert.ok(RETENTION_COLLECTIONS.includes(name));
      queried.push(name);
      return { where(field, op, value) {
        assert.equal(field, "expireAt"); assert.equal(op, "<="); assert.equal(value, now);
        return { limit(size) { assert.equal(size, 100); return { async get() {
          const page = pages.get(name) || 0; pages.set(name, page + 1);
          const docs = page < 5 ? Array.from({ length: 100 }, (_, i) => ({ ref: `${name}/${page}-${i}` })) : [];
          return { docs, empty: docs.length === 0, size: docs.length };
        } }; } };
      } };
    },
    batch() { return { delete(ref) { removed.push(ref); }, async commit() {} }; },
  };
  const realtime = { ref(path) {
    assert.equal(path, "freeTables/sessions");
    return { orderByChild(field) { assert.equal(field, "expiresAt"); return { endAt(value) {
      assert.equal(value, now); return { limitToFirst(limit) { assert.equal(limit, 200); return { async get() { return { val: () => null }; } }; } };
    } }; } };
  } };
  const result = await cleanupRetiredFreeTableHistory({ firestore, realtime, Timestamp: { fromMillis: (v) => v }, now });
  assert.equal(queried.length, 20, "at most five pages per historical collection");
  assert.equal(removed.length, 2000);
  assert.deepEqual(Object.keys(result.removed), RETENTION_COLLECTIONS);
  assert.equal(result.runtime.removed, 0);
});

test("empty history performs four small expiry queries, no writes", async () => {
  let reads = 0;
  const firestore = { collection(name) {
    assert.ok(RETENTION_COLLECTIONS.includes(name));
    return { where() { return { limit() { return { async get() { reads += 1; return { empty: true }; } }; } }; } };
  }, batch() { assert.fail("empty data must not create writes"); } };
  const realtime = { ref() { return { orderByChild() { return { endAt() { return { limitToFirst() { return { async get() { return { val: () => null }; } }; } }; } }; } }; } };
  await cleanupRetiredFreeTableHistory({ firestore, realtime, Timestamp: { fromMillis: (v) => v } });
  assert.equal(reads, 4);
});
