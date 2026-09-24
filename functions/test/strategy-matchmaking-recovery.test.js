"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createStrategyMatchmakingRuntime, clone, snapshot, turn, deferred } = require("./helpers/strategy-matchmaking-runtime");
const queuePath = "online/strategyQueue/A";
const activePath = "online/strategyActive/A";
const queue = (overrides = {}) => ({ uid: "A", protocolVersion: 2, state: "waiting-v2", ratingPreference: "both",
  joinedAt: 1234, lastSeen: 1234, allowPreferenceMismatch: false, ...overrides });
const denied = () => Object.assign(new Error("permission_denied at /online/strategyRooms/room/status: Client doesn't have permission to access the desired data."), { code: "PERMISSION_DENIED" });
function offer(f, roomId = "room") {
  f.state.pendingOffer = { roomId };
  f.state.safetyProposal = { generation: 1, roomId };
  f.context.watchStrategyOffer(roomId, f.state, f.state.matchmakingGeneration);
  return f.listeners.at(-1);
}

test("reconnected strategy waiting restores a complete owned queue and its disconnect registration", async () => {
  const f = createStrategyMatchmakingRuntime();
  f.state.matchScopeExpanded = true;
  assert.equal(await f.context.refreshStrategyMatchmakingQueue(f.state, 1), true);
  const saved = f.rows.get(queuePath);
  assert.deepEqual({ ...saved, lastSeen: 1234 }, queue({ allowPreferenceMismatch: true }));
  assert.ok(saved.lastSeen > 1234);
  assert.equal(f.events.filter(([kind]) => kind === "arm").length, 1);
  await f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  assert.equal(f.events.filter(([kind]) => kind === "arm").length, 1, "heartbeat keeps the registration for this connection");
});

test("heartbeat preserves an offering queue and never overwrites a different attempt", async () => {
  const f = createStrategyMatchmakingRuntime();
  f.rows.set(queuePath, queue({ state: "offering-v2", roomId: "reserved" }));
  await f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  assert.equal(f.rows.get(queuePath).state, "offering-v2");
  assert.equal(f.rows.get(queuePath).roomId, "reserved");
  f.rows.set(queuePath, queue({ joinedAt: 9999, state: "offering-v2", roomId: "newer" }));
  assert.equal(await f.context.refreshStrategyMatchmakingQueue(f.state, 1), false);
  assert.deepEqual(f.rows.get(queuePath), queue({ joinedAt: 9999, state: "offering-v2", roomId: "newer" }));
});

test("a reservation appearing before the queue CAS retains the server's offering fields", async () => {
  const f = createStrategyMatchmakingRuntime();
  f.rows.set(queuePath, queue());
  f.hooks.beforeTransaction = async () => {
    f.rows.set(queuePath, queue({ state: "offering-v2", roomId: "new-room" }));
    f.rows.set(activePath, "new-room");
  };
  await f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  assert.equal(f.rows.get(queuePath).roomId, "new-room");
  assert.equal(f.rows.get(queuePath).state, "offering-v2");
  assert.equal(f.rows.get(activePath), "new-room");
});

test("an already accepted room is resumed after reconnect without recreating its queue", async () => {
  const f = createStrategyMatchmakingRuntime();
  f.state.matchmakingConnected = false;
  f.rows.set(activePath, "accepted-room");
  f.hooks.safety = async (action) => {
    assert.equal(action, "strategy_match");
    return { status: "active", roomId: "accepted-room" };
  };
  f.context.watchStrategyMatchmakingConnection(f.state, 1);
  f.listeners.at(-1).value(snapshot(true));
  await turn(); await turn();
  assert.deepEqual(f.entered, ["accepted-room"]);
  assert.equal(f.rows.has(queuePath), false);
  assert.equal(f.rows.get(activePath), "accepted-room");
});

test("an old queue repair that completes after cancellation cannot erase a newly started attempt", async () => {
  const f = createStrategyMatchmakingRuntime();
  const committed = deferred(), reply = deferred();
  f.hooks.afterTransaction = async (_key, result) => {
    if (result.snapshot.val()?.joinedAt !== 1234) return;
    committed.resolve();
    await reply.promise;
  };
  const recovering = f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  await committed.promise;
  f.state.matchmakingGeneration = 2;
  f.state.queueJoinedAt = 9999;
  f.rows.set(queuePath, queue({ joinedAt: 9999 }));
  reply.resolve();
  assert.equal(await recovering, false);
  assert.equal(f.rows.get(queuePath).joinedAt, 9999);
});

test("cancellation fences a repair before its transaction and preserves newer active ownership", async () => {
  const f = createStrategyMatchmakingRuntime();
  const entered = deferred(), release = deferred();
  f.hooks.beforeTransaction = async () => { entered.resolve(); await release.promise; };
  const recovering = f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  await entered.promise;
  f.state.pendingOffer = { roomId: "old-room" };
  f.rows.set(activePath, "new-room");
  const cleanup = f.context.cleanupMatchmaking(false);
  release.resolve();
  await Promise.all([cleanup, recovering]);
  assert.equal(f.rows.has(queuePath), false);
  assert.equal(f.rows.get(activePath), "new-room");
});

test("canceling an in-flight guest acceptance releases only that guest's owned reservation", async () => {
  for (const activeRoom of ["accepting-room", "newer-room"]) {
    const f = createStrategyMatchmakingRuntime();
    f.state.acceptingOffer = true;
    f.state.acceptingOfferRoomId = "accepting-room";
    f.rows.set(activePath, activeRoom);
    await f.context.cleanupMatchmaking(false);
    assert.equal(f.rows.get(activePath), activeRoom === "accepting-room" ? undefined : "newer-room");
    assert.deepEqual(f.events.filter(([kind]) => kind === "strategy_expire"), [["strategy_expire", "accepting-room"]]);
  }
});

test("cleanup reconciles a cold SDK cache and removes only the owned server queue and active reservation", async () => {
  for (const newerAttempt of [false, true]) {
    const f = createStrategyMatchmakingRuntime();
    f.hooks.coldTransaction = true;
    f.state.pendingOffer = { roomId: "owned-room" };
    f.rows.set(queuePath, queue({ joinedAt: newerAttempt ? 9999 : 1234 }));
    f.rows.set(activePath, newerAttempt ? "newer-room" : "owned-room");
    await f.context.cleanupMatchmaking(false);
    assert.equal(f.rows.has(queuePath), newerAttempt);
    assert.equal(f.rows.has(activePath), newerAttempt);
    if (newerAttempt) {
      assert.equal(f.rows.get(queuePath).joinedAt, 9999);
      assert.equal(f.rows.get(activePath), "newer-room");
    }
  }
});

test("an old delayed onDisconnect cancellation finishes before a new attempt registers", async () => {
  const f = createStrategyMatchmakingRuntime();
  const started = deferred(), finish = deferred();
  f.hooks.arm = async (id) => { if (id === 1) { started.resolve(); await finish.promise; } };
  const oldArm = f.context.armStrategyQueueDisconnect(queuePath, f.state, 1);
  await started.promise;
  const cleanup = f.context.cleanupMatchmaking(false);
  f.state.matchmakingGeneration = 3;
  f.state.queueJoinedAt = 9999;
  const newArm = f.context.armStrategyQueueDisconnect(queuePath, f.state, 3);
  finish.resolve();
  assert.equal(await oldArm, false);
  await cleanup;
  assert.equal(await newArm, true);
  assert.deepEqual(f.events.filter(([kind]) => ["arm", "cancel"].includes(kind)).map(([kind, id]) => [kind, id]),
    [["arm", 1], ["cancel", 1], ["arm", 2]]);
});

test("a second reconnect waits for the stale registration and then restores its queue", async () => {
  const f = createStrategyMatchmakingRuntime();
  const started = deferred(), finish = deferred();
  f.hooks.arm = async (id) => { if (id === 1) { started.resolve(); await finish.promise; } };
  const oldRecovery = f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  await started.promise;
  f.state.queueConnectionEpoch = 3;
  f.state.queueDisconnect = null;
  const newRecovery = f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  finish.resolve();
  assert.equal(await oldRecovery, false);
  assert.equal(await newRecovery, true);
  assert.equal(f.rows.get(queuePath).uid, "A");
  assert.deepEqual(f.events.filter(([kind]) => ["arm", "cancel"].includes(kind)).map(([kind, id]) => [kind, id]),
    [["arm", 1], ["cancel", 1], ["arm", 2]]);
});

test("terminal offer status detaches its listener, timer and poll before grant revocation", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f);
  listener.value(snapshot("expired"));
  listener.error(denied());
  await turn();
  assert.equal(listener.stopped, true);
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.state.pendingOffer, null);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.events.filter(([kind]) => kind === "strategy_expire"), []);
});

test("client timeout unsubscribes before asking the server to revoke the offer grant", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f);
  f.hooks.safety = async (_action, data) => {
    assert.equal(listener.stopped, true);
    listener.error(denied());
    return { roomId: data.roomId, status: "expired" };
  };
  await f.context.expireOffer("room");
  assert.equal(f.state.pendingOffer, null);
  assert.equal(f.timeouts.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.deepEqual(f.errors, []);
});

test("a missed expiry snapshot is confirmed through the server before suppressing permission_denied", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f);
  listener.error(denied());
  await turn();
  assert.deepEqual(f.events.filter(([kind]) => kind === "strategy_expire"), [["strategy_expire", "room"]]);
  assert.equal(f.state.pendingOffer, null);
  assert.deepEqual(f.errors, []);
});

test("a real active-room denial is surfaced and cannot trigger an immediate subscription retry loop", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f);
  f.hooks.safety = async (_action, data) => ({ roomId: data.roomId, status: "active" });
  f.hooks.enter = async () => { throw denied(); };
  listener.error(denied());
  await turn(); await turn();
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].code, "PERMISSION_DENIED");
  assert.equal(f.listeners.length, 1);
  assert.equal(f.timeouts.size, 1, "only a bounded delayed retry remains");
  assert.equal(f.intervals.size, 0);
});

test("cleanup removes a stopped watch's delayed denial retry and invalidates an already queued callback", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f);
  f.hooks.safety = async (_action, data) => ({ roomId: data.roomId, status: "active" });
  f.hooks.enter = async () => { throw denied(); };
  listener.error(denied());
  await turn();
  const retry = [...f.timeouts.values()][0];
  assert.equal(typeof retry, "function");
  const before = f.events.filter(([kind]) => kind === "strategy_expire").length;
  await f.context.cleanupMatchmaking(true);
  assert.equal(f.timeouts.size, 0);
  retry();
  await turn();
  assert.equal(f.events.filter(([kind]) => kind === "strategy_expire").length, before);
});

test("an offer activated while its expiration request is in flight still enters the accepted room", async () => {
  const f = createStrategyMatchmakingRuntime();
  offer(f);
  const response = deferred();
  f.hooks.safety = () => response.promise;
  const expiring = f.context.expireOffer("room");
  f.rows.set(activePath, "room");
  response.resolve({ roomId: "room", status: "active" });
  await expiring;
  assert.deepEqual(f.entered, ["room"]);
  assert.equal(f.rows.get(activePath), "room");
  assert.deepEqual(f.errors, []);
});

test("an old offer expiry reply and delayed listener cannot clear a newer offer", async () => {
  const f = createStrategyMatchmakingRuntime();
  const listener = offer(f, "old");
  const response = deferred();
  f.hooks.safety = () => response.promise;
  const expiring = f.context.expireOffer("old");
  offer(f, "new");
  response.resolve({ roomId: "old", status: "expired" });
  await expiring;
  listener.value(snapshot("expired"));
  listener.error(denied());
  assert.deepEqual(clone(f.state.pendingOffer), { roomId: "new" });
  assert.equal(f.state.hostOfferWatch.roomId, "new");
  assert.deepEqual(f.errors, []);
});

test("simultaneous active snapshots enter a hosted room once", async () => {
  const f = createStrategyMatchmakingRuntime();
  const response = deferred();
  f.hooks.enter = () => response.promise;
  const listener = offer(f);
  listener.value(snapshot("active"));
  listener.value(snapshot("active"));
  response.resolve();
  await turn();
  assert.deepEqual(f.entered, ["room"]);
});
