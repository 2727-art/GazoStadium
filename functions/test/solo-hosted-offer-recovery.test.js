"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createSoloHostedOfferRuntime, namedFunction, turn, deferred, denied } = require("./helpers/solo-hosted-offer-runtime");

test("permission denial stops the listener and polling before one authoritative expiry request", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.server = async () => {
    assert.equal(f.listeners[0].stopped, true);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.timers.size, 0);
    return { status: "expired" };
  };
  f.listeners[0].error(denied());
  f.listeners[0].error(denied());
  await turn();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, "expire");
  assert.equal(f.state.pendingOffer, null);
  assert.equal(f.state.hostOfferWatch, null);
  assert.equal(f.searches.length, 1);
  assert.deepEqual(f.toasts, []);
});

for (const mode of ["timeout", "denied-poll", "denied-listener"]) {
  test(`${mode} survives a transient failure, retries once and resumes matching`, async () => {
    const f = createSoloHostedOfferRuntime();
    f.offer();
    f.hooks.server = async () => {
      if (f.calls.length === 1) throw new Error("network unavailable");
      return { status: "expired" };
    };
    if (mode === "timeout") f.fireTimer();
    else if (mode === "denied-poll") [...f.intervals.values()][0].fn();
    else f.listeners[0].error(denied());
    await turn();
    assert.equal(f.state.pendingOffer.roomId, "room");
    assert.equal(f.intervals.size, 0);
    assert.equal(f.listeners[0].stopped, true);
    assert.equal(f.toasts.length, 1);
    assert.equal(f.fireTimer(), 20000);
    await turn();
    assert.equal(f.calls.length, 2);
    assert.equal(f.state.pendingOffer, null);
    assert.equal(f.searches.length, 1);
    assert.equal(f.timers.size, 0);
  });
}

test("busy responses keep one delayed retry without re-subscribing or clearing the candidate", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.server = async () => f.calls.length < 3
    ? { status: "offered", reason: "transition-busy" } : { status: "", reason: "not-owner" };
  for (let i = 0; i < 3; i++) {
    f.fireTimer();
    await turn();
    assert.equal(f.intervals.size, 0);
    assert.equal(f.listeners.length, 1);
    if (i < 2) assert.equal(f.state.pendingOffer.roomId, "room");
  }
  assert.equal(f.state.pendingOffer, null);
  assert.equal(f.searches.length, 1);
  assert.deepEqual(f.toasts, []);
});

test("repeated transport failures show one recovery notice and keep one retry", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.server = async () => { throw denied(); };
  for (let i = 0; i < 4; i++) { f.fireTimer(); await turn(); }
  assert.equal(f.toasts.length, 1);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timers.size, 1);
  assert.equal(f.searches.length, 0);
});

test("a room accepted during expiry enters once and is never treated as expired", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  const reply = deferred();
  f.hooks.server = () => reply.promise;
  const expiring = f.context.expireOffer("room", "guest");
  await turn();
  f.listeners[0].value({ val: () => "active" });
  reply.resolve({ status: "active", reason: "active" });
  await expiring;
  assert.deepEqual(f.entries, ["room"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.searches.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
});

test("active snapshots and a queued timeout cannot enter twice or cancel acceptance", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  const timeout = [...f.timers.values()][0].fn;
  const entry = deferred();
  f.hooks.enter = () => entry.promise;
  f.listeners[0].value({ val: () => "active" });
  f.listeners[0].value({ val: () => "active" });
  timeout();
  await turn();
  assert.deepEqual(f.entries, ["room"]);
  assert.equal(f.calls.length, 0);
  entry.resolve();
  await turn();
  assert.equal(f.timers.size, 0);
});

test("failed active entry retries via the server without polling a forbidden room", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.enter = async () => { throw denied(); };
  f.hooks.server = async () => ({ status: "active" });
  f.listeners[0].value({ val: () => "active" });
  await turn();
  assert.equal(f.calls.length, 0);
  f.fireTimer();
  await turn();
  assert.equal(f.calls.length, 1);
  assert.equal(f.entries.length, 2);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timers.size, 1);
  assert.equal(f.searches.length, 0);
  assert.equal(f.toasts.length, 1);
});

test("unknown replies do not discard a potentially active candidate", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.server = async () => ({});
  await f.context.expireOffer("room", "guest");
  assert.equal(f.state.pendingOffer.roomId, "room");
  assert.equal(f.searches.length, 0);
  assert.equal(f.timers.size, 1);
});

test("cancellation clears a delayed retry and ignores an already queued callback", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  f.hooks.server = async () => { throw denied(); };
  await f.context.expireOffer("room", "guest");
  const callback = [...f.timers.values()][0].fn;
  await f.context.cleanupMatchmaking(false, f.state);
  callback();
  f.listeners[0].error(denied());
  await turn();
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.state.pendingOffer, null);
});

for (const result of ["active", "expired", "error"]) {
  test(`a late ${result} response from an old candidate cannot affect a new offer`, async () => {
    const f = createSoloHostedOfferRuntime();
    f.offer("old");
    const reply = deferred();
    f.hooks.server = () => reply.promise;
    const old = f.context.expireOffer("old", "guest");
    await turn();
    await f.context.cleanupMatchmaking(false, f.state);
    f.offer("new");
    if (result === "error") reply.reject(denied());
    else reply.resolve({ status: result });
    await old;
    f.listeners[0].error(denied());
    assert.equal(f.state.pendingOffer.roomId, "new");
    assert.equal(f.state.hostOfferWatch.roomId, "new");
    assert.equal(f.entries.length, 0);
    assert.equal(f.searches.length, 0);
    assert.equal(f.timers.size, 1);
    assert.deepEqual(f.toasts, []);
  });
}

test("synchronous listener cancellation detaches the returned subscription", async () => {
  const f = createSoloHostedOfferRuntime();
  f.hooks.subscribe = listener => listener.error(denied());
  f.offer();
  await turn();
  assert.equal(f.listeners[0].stopped, true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.state.pendingOffer, null);
});

test("concurrent error paths share the server reconciliation", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  const reply = deferred();
  f.hooks.server = () => reply.promise;
  const pending = [f.context.expireOffer("room", "guest"), f.context.expireOffer("room", "guest")];
  await turn();
  assert.equal(f.calls.length, 1);
  reply.resolve({ status: "expired" });
  await Promise.all(pending);
  assert.equal(f.searches.length, 1);
});

test("a hidden or offline automatic search keeps its recovery timer without making requests", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  const current = f.context.isCurrentMatchmakingGeneration;
  f.context.isCurrentMatchmakingGeneration = () => false;
  f.fireTimer();
  await turn();
  f.fireTimer();
  await turn();
  assert.equal(f.calls.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timers.size, 1);
  f.context.isCurrentMatchmakingGeneration = current;
  f.fireTimer();
  await turn();
  assert.equal(f.state.pendingOffer, null);
  assert.equal(f.searches.length, 1);
});

test("hiding an automatic search during confirmation defers recovery until it can resume", async () => {
  const f = createSoloHostedOfferRuntime();
  f.offer();
  const reply = deferred();
  f.hooks.server = () => reply.promise;
  const pending = f.context.expireOffer("room", "guest");
  await turn();
  const current = f.context.isCurrentMatchmakingGeneration;
  f.context.isCurrentMatchmakingGeneration = () => false;
  reply.resolve({ status: "expired" });
  await pending;
  assert.equal(f.timers.size, 1);
  assert.equal(f.searches.length, 0);
  f.context.isCurrentMatchmakingGeneration = current;
  f.fireTimer();
  await turn();
  assert.equal(f.state.pendingOffer, null);
  assert.equal(f.searches.length, 1);
});

test("entering a room stops hosted monitoring and the public module has a new cache key", () => {
  assert.match(namedFunction("enterRoom"), /stopSoloHostedOfferWatch\(state\.hostOfferWatch\)/);
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  assert.match(html, /online\.js\?v=[^"]*solo-offer-recovery-v1/);
});
