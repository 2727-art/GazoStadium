"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createEconomyInitializeRateLimiter, INITIALIZE_LIMIT, INITIALIZE_WINDOW_MS } = require("../economy-rate-limit");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fixture() {
  const values = new Map();
  let at = 1_000_000;
  const realtime = { ref: (path) => ({ transaction: async (update) => {
    const next = update(values.get(path));
    if (next === undefined) return { committed: false };
    values.set(path, next);
    return { committed: true };
  } }) };
  const create = () => createEconomyInitializeRateLimiter({ realtime, HttpsError, now: () => at });
  return { values, create, advance: (ms) => { at += ms; } };
}

test("initialization budget is shared by instances, isolated by UID, and recovers at the window boundary", async () => {
  const f = fixture();
  const a = f.create(), b = f.create();
  const attempts = await Promise.allSettled(Array.from({ length: INITIALIZE_LIMIT + 8 }, (_, i) => (i % 2 ? a : b)("player-a")));
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, INITIALIZE_LIMIT);
  for (const r of attempts.filter((r) => r.status === "rejected")) assert.equal(r.reason.code, "resource-exhausted");
  await b("player-b");
  assert.equal(f.values.size, 2);
  assert.ok([...f.values.keys()].every((key) => /^online\/economyActionRates\/[a-f0-9]{64}$/.test(key)));
  f.advance(INITIALIZE_WINDOW_MS - 1);
  await assert.rejects(a("player-a"), { code: "resource-exhausted" });
  f.advance(1);
  await a("player-a");
});

test("transaction retry's final decision controls admission", async () => {
  const limiter = createEconomyInitializeRateLimiter({ now: () => 1_000_000, HttpsError,
    realtime: { ref: () => ({ transaction: async (update) => {
      assert.ok(update(null)); // Initial local optimistic callback.
      assert.equal(update({ windowStartedAt: 1_000_000, count: INITIALIZE_LIMIT }), undefined);
      return { committed: false }; // A competing instance exhausted the budget.
    } }) },
  });
  await assert.rejects(limiter("player-a"), { code: "resource-exhausted" });
});

test("a database failure fails closed instead of running expensive initialization", async () => {
  const failure = new Error("database unavailable");
  const limiter = createEconomyInitializeRateLimiter({ HttpsError, realtime: {
    ref: () => ({ transaction: async () => { throw failure; } }),
  } });
  await assert.rejects(limiter("player-a"), failure);
});
