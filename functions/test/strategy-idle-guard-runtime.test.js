"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");
const { createStrategyMatchmakingRuntime, deferred, turn } = require("./helpers/strategy-matchmaking-runtime");
const source = fs.readFileSync(path.resolve(__dirname, "../../strategy.js"), "utf8");
let api;
before(async () => { api = await import(pathToFileURL(path.resolve(__dirname, "../../strategy-idle-guard.mjs"))); });
function named(name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const index = markers.findIndex((match) => match[1] === name);
  assert.ok(index >= 0, name);
  return source.slice(markers[index].index, markers[index + 1]?.index ?? source.length);
}
function load(context, names) { vm.runInContext(names.map(named).join("\n"), context); }
function clock(kind, extra = {}) {
  let time = 1000, id = 0;
  const timers = new Map();
  const context = { current: true, visible: true, busy: false, deadline: 2000 };
  const calls = [];
  const guard = api[kind]({ getContext: () => context, now: () => time,
    setTimer: (fn, delay) => { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; },
    clearTimer: (key) => timers.delete(key), stop: async () => { calls.push(time); context.current = false; }, ...extra });
  const advance = async (amount) => {
    time += amount;
    for (const [key, item] of [...timers]) if (item.at <= time) { timers.delete(key); item.fn(); }
    await turn();
  };
  return { context, guard, timers, calls, advance, setTime: (value) => { time = value; } };
}

test("search idle requires five continuous hidden minutes and visible waiting has no timer", async () => {
  const f = clock("createStrategyHiddenSearchGuard");
  f.guard.sync();
  assert.equal(f.timers.size, 0);
  f.context.visible = false; f.guard.sync();
  await f.advance(299999); assert.equal(f.calls.length, 0);
  await f.advance(1); assert.equal(f.calls.length, 1);
  assert.equal(f.guard.disposed, true);
});

test("short hidden visits reset but frozen five-minute return expires before becoming visible", async () => {
  const f = clock("createStrategyHiddenSearchGuard");
  f.context.visible = false; f.guard.sync();
  await f.advance(200000);
  f.context.visible = true; f.guard.sync();
  f.context.visible = false; f.guard.sync();
  f.setTime(501000); f.context.visible = true;
  assert.equal(f.guard.blocksProgress(), true);
  await turn(); assert.equal(f.calls.length, 1);
});

test("expired search waits for an in-flight acceptance and a stale generation cannot stop a new search", async () => {
  const f = clock("createStrategyHiddenSearchGuard");
  f.context.visible = false; f.context.busy = true; f.guard.sync();
  await f.advance(300000); assert.equal(f.calls.length, 0);
  f.context.current = false; f.context.busy = false; f.guard.sync();
  await f.advance(1000); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test("prestart deadline applies while visible, but started rooms and legacy rooms are excluded", async () => {
  const f = clock("createStrategyPrestartGuard");
  f.guard.sync(); await f.advance(1000); assert.equal(f.calls.length, 1);
  for (const context of [{ protected: true }, { deadline: undefined }]) {
    const excluded = clock("createStrategyPrestartGuard");
    Object.assign(excluded.context, context); excluded.guard.sync();
    await excluded.advance(900000); assert.equal(excluded.calls.length, 0);
  }
});

test("server clock correction rearms a premature prestart expiry instead of latching progress blocked", async () => {
  const response = deferred();
  const f = clock("createStrategyPrestartGuard", { stop: () => response.promise });
  f.guard.sync(); await f.advance(1000); assert.equal(f.guard.expired, true);
  f.setTime(1200); f.guard.sync();
  assert.equal(f.guard.blocksProgress(), false);
  response.resolve(800); await turn();
  assert.equal(f.guard.expired, false); assert.equal(f.context.current, true);
  f.guard.dispose();
});

test("all server start and result evidence protects prestart timeout", () => {
  const room = { hostUid: "A", guestUid: "B" };
  assert.equal(api.strategyRoomHasStarted(room), false);
  assert.equal(api.strategyRoomHasStarted({ ...room, battleReady: { A: true } }), false);
  assert.equal(api.strategyRoomHasStarted({ ...room, battleReady: { B: true } }), false);
  for (const evidence of [{ battleReady: { A: true, B: true } }, { moves: { first: {} } },
    { resultClaims: { A: {} } }, { finished: { A: true } }, { serverFinalized: { at: 1 } }]) {
    assert.equal(api.strategyRoomHasStarted({ ...room, ...evidence }), true);
  }
});

function searchRuntime() {
  const f = createStrategyMatchmakingRuntime();
  Object.assign(f.context, { updateStrategyIdleNotice() {}, cleanupPublicPresence: async () => {},
    setStrategyChrome() {}, render() {} });
  load(f.context, ["stopStrategyIdleSearch"]);
  return f;
}

test("confirmed search stop performs local cleanup only and preserves another queue/active generation", async () => {
  const f = searchRuntime();
  f.rows.set("online/strategyQueue/A", { uid: "A", joinedAt: 9999 });
  f.rows.set("online/strategyActive/A", "new-room");
  f.hooks.safety = async () => ({ stopped: false, status: "resource-changed" });
  await f.context.stopStrategyIdleSearch(f.state, 1);
  assert.equal(f.state.screen, "profile");
  assert.equal(f.state.idleCleanupPending, false);
  assert.equal(f.rows.get("online/strategyQueue/A").joinedAt, 9999);
  assert.equal(f.rows.get("online/strategyActive/A"), "new-room");
  assert.deepEqual(f.events.filter(([kind]) => kind === "strategy_expire"), []);
});

test("search stop lost response keeps the search blocked and never falls back to expire", async () => {
  const f = searchRuntime();
  f.hooks.safety = async () => { throw new Error("offline"); };
  await assert.rejects(f.context.stopStrategyIdleSearch(f.state, 1), /offline/);
  assert.equal(f.state.idleCleanupPending, true);
  await f.context.attemptToHost();
  assert.equal(f.events.length, 1);
  assert.equal(f.state.screen, "matching");
});

test("a match which wins the search-stop race enters the existing room without cancellation", async () => {
  const f = searchRuntime();
  f.hooks.safety = async () => ({ stopped: false, status: "match-in-progress", roomStatus: "active", roomId: "room" });
  await f.context.stopStrategyIdleSearch(f.state, 1);
  assert.deepEqual(f.entered, ["room"]);
  assert.equal(f.state.idleCleanupPending, false);
  assert.deepEqual(f.events.filter(([kind]) => kind === "strategy_expire"), []);
});

test("a queue repair paused before CAS cannot recreate waiting after idle expiry", async () => {
  const f = searchRuntime(), began = deferred(), resume = deferred();
  f.hooks.beforeTransaction = async () => { began.resolve(); await resume.promise; };
  const pending = f.context.refreshStrategyMatchmakingQueue(f.state, 1);
  await began.promise;
  f.state.searchIdleGuard = { blocksProgress: () => true };
  resume.resolve();
  assert.equal(await pending, false);
  assert.equal(f.rows.has("online/strategyQueue/A"), false);
});

function roomRuntime(extra = {}) {
  const state = { uid: "A", opponentUid: "B", roomId: "room", screen: "identity", serverTimeOffset: 0,
    roomData: { hostUid: "A", guestUid: "B", prestartDeadlineAt: 5000 },
    roomUnsubscribers: [], disconnectHandles: [], seenChatIds: new Set(), chatMessages: [],
    idleCleanupPending: false, idleStopped: false, prestartConfirmPromise: null };
  const effects = { cleanup: [], calls: [], renders: 0, released: 0, toasts: [] };
  const listeners = [], intervals = new Map();
  let id = 0;
  const hooks = { response: { expired: true, status: "expired", reason: "prestart-timeout", roomId: "room" } };
  const context = vm.createContext({ state, active: true, Date, Promise, console, database: {},
    STRATEGY_PROTOCOL_VERSION: 3, DATA_BUFFER_LIMIT: 1000,
    strategyRoomHasStarted: api.strategyRoomHasStarted,
    window: { setInterval(fn) { const key = ++id; intervals.set(key, fn); return key; }, clearInterval(key) { intervals.delete(key); } },
    document: { getElementById: () => null },
    requestSafety: async (action, data) => { effects.calls.push({ action, data }); return hooks.safety ? hooks.safety(action, data) : hooks.response; },
    cleanupOnlineResources: async (keepActive, options) => { effects.cleanup.push({ keepActive, options }); await hooks.cleanup?.(); },
    releaseMatchMedia: () => { effects.released++; },
    render: () => { effects.renders++; }, setStrategyChrome() {},
    showToast: (message) => effects.toasts.push(message),
    handleRecoverableError() {},
    ref: (_db, location) => location, set: async () => { await hooks.set?.(); },
    serverTimestamp: () => 123,
    onDisconnect: () => ({ remove: async () => {}, set: async () => {}, cancel: async () => {} }),
    onValue: (location, value, error) => { listeners.push({ location, value, error }); return () => {}; },
    onChildAdded: (location, value, error) => { listeners.push({ location, value, error }); return () => {}; },
    query: (value) => value, limitToLast: (value) => value,
    cleanupPublicPresence: async () => {},
    captureMatchAchievementShowcases: () => false, materializeMatchAchievementShowcases() {},
    refreshMatchAchievementShowcaseIfVisible() {}, reactToRoomData: async () => {},
    handleOpponentDestroyed: async () => {}, renderBattleIfChanged() {}, refreshStrategyChat() {},
    sendProfileAvatar: async () => {}, handleChannelMessage: async () => {},
    ...extra,
  });
  load(context, ["strategyIdleRoomIsCurrent", "stopStrategyPrestartGuard", "confirmStrategyPrestartExpiry",
    "finishStrategyPrestartExpiry", "strategyPrestartProgressBlocked", "updateStrategyIdleNotice",
    "handleStrategyPrestartWriteFailure", "startBattle", "setupRoomListeners", "configureDataChannel"]);
  return { context, state, effects, hooks, listeners, intervals };
}

test("every prebattle phase ends only after a confirmed server response and retains local decks", async () => {
  for (const screen of ["connecting", "intro", "waitingDecision", "deck", "waitingDeck", "identity", "waitingBattle"]) {
    const f = roomRuntime(); f.state.screen = screen;
    const main = f.state.main = [{ id: "owned-image" }];
    await f.context.confirmStrategyPrestartExpiry(f.state, "room");
    assert.equal(f.state.screen, "noContest", screen);
    assert.equal(f.state.main, main);
    assert.equal(f.state.idleCleanupPending, false);
    assert.equal(f.effects.cleanup[0].keepActive, true);
    assert.equal(f.effects.cleanup[0].options.skipServerWrites, true);
    assert.match(f.state.idleStopReason, /5分/);
  }
});

test("server protected response clears pending and disposes deadline without ending the battle", async () => {
  const f = roomRuntime(); let disposed = 0;
  f.state.prestartGuard = { dispose() { disposed++; } };
  f.hooks.response = { expired: false, status: "protected", roomId: "room" };
  await f.context.confirmStrategyPrestartExpiry(f.state, "room");
  assert.equal(disposed, 1);
  assert.equal(f.state.idleCleanupPending, false);
  assert.equal(f.state.prestartGuard, null);
  assert.equal(f.effects.cleanup.length, 0);
  assert.equal(f.context.strategyPrestartProgressBlocked(), false);
});

test("unknown expiry result and transport failure never perform destructive cleanup", async () => {
  for (const fail of [false, true]) {
    const f = roomRuntime();
    f.hooks.safety = async () => { if (fail) throw new Error("offline"); return { roomId: "wrong", expired: true }; };
    await f.context.confirmStrategyPrestartExpiry(f.state, "room").catch(() => {});
    assert.equal(f.state.idleCleanupPending, true);
    assert.equal(f.effects.cleanup.length, 0);
    assert.equal(f.context.strategyPrestartProgressBlocked(), true);
  }
});

test("an old expiry reply cannot terminate a newer room or state", async () => {
  const f = roomRuntime(), response = deferred();
  f.hooks.safety = () => response.promise;
  const pending = f.context.confirmStrategyPrestartExpiry(f.state, "room");
  f.state.roomId = "new-room";
  response.resolve({ expired: true, status: "expired", roomId: "room" }); await pending;
  assert.equal(f.effects.cleanup.length, 0);
  assert.equal(f.state.roomId, "new-room");
});

test("cleanup remains pending until detachment completes and concurrent expiry acknowledgements share one cleanup", async () => {
  const f = roomRuntime(), cleanup = deferred();
  f.hooks.cleanup = () => cleanup.promise;
  const first = f.context.confirmStrategyPrestartExpiry(f.state, "room");
  await turn();
  await f.context.confirmStrategyPrestartExpiry(f.state, "room");
  assert.equal(f.state.idleCleanupPending, true);
  assert.equal(f.effects.cleanup.length, 1);
  cleanup.resolve(); await first;
  assert.equal(f.state.idleCleanupPending, false);
});

test("a revoked room read grant confirms timeout through callable instead of relying on destroyed delivery", async () => {
  const f = roomRuntime();
  await f.context.setupRoomListeners();
  const listener = f.listeners.find((item) => item.location === "online/strategyRooms/room");
  listener.error(Object.assign(new Error("permission_denied"), { code: "PERMISSION_DENIED" }));
  await turn();
  assert.equal(f.effects.calls[0].action, "strategy_expire_prestart");
  assert.equal(f.state.screen, "noContest");
});

test("late P2P data-channel open cannot resurrect a timed-out room or another session", async () => {
  for (const newer of [false, true]) {
    const f = roomRuntime(); f.state.screen = "connecting";
    let closed = 0;
    const channel = { close: () => { closed++; } };
    f.context.configureDataChannel(channel);
    if (newer) f.context.state = { roomId: "new", screen: "profile" };
    else f.state.idleStopped = true;
    channel.onopen();
    assert.equal(closed, 1);
    assert.notEqual(f.context.state.screen, "intro");
    assert.equal(f.effects.renders, 0);
  }
});

test("a start write rejected at the deadline shows the confirmed terminal screen instead of waitingBattle", async () => {
  const f = roomRuntime();
  f.hooks.set = async () => { throw new Error("permission denied"); };
  await f.context.startBattle();
  assert.equal(f.state.screen, "noContest");
  assert.equal(f.effects.cleanup.length, 1);
});

test("local countdown updates do not rerender or perform network reads", () => {
  const f = roomRuntime();
  const element = { textContent: "" };
  f.context.document.getElementById = () => element;
  f.context.firebaseNow = () => 3000;
  f.context.updateStrategyIdleNotice();
  assert.match(element.textContent, /0分02秒/);
  assert.equal(f.effects.renders, 0);
  assert.equal(f.effects.calls.length, 0);
});

test("room deadline is armed before listener setup awaits and an expired setup rejection confirms terminal state", async () => {
  const f = roomRuntime();
  const commits = ["first", "second", "third"];
  const room = { hostUid: "A", guestUid: "B", protocolVersion: 3, prestartDeadlineAt: 5000,
    queueJoinedAt: { A: 1234, B: 4321 }, players: { A: { uid: "A", weaknessCommits: commits }, B: { uid: "B" } } };
  Object.assign(f.state, { roomId: "", screen: "matching", matchmakingGeneration: 1, queueJoinedAt: 1234,
    safetyPlayerRecords: new Map([["room", { salts: ["a", "b", "c"], player: { weaknessCommits: commits } }]]) });
  let armed = false, peers = 0;
  Object.assign(f.context, {
    isCurrentStrategyMatchmakingGeneration: () => !f.state.roomId && f.state.screen === "matching",
    get: async () => ({ val: () => room }), runtimePlayer: (value) => value,
    playStrategyMatchReadySound() {}, cleanupMatchmaking: async () => {}, updatePublicPresence: async () => {},
    startStrategyPrestartGuard: () => { armed = true; },
    setupRoomListeners: async () => { assert.equal(armed, true); throw new Error("permission denied after deadline"); },
    setupPeerConnection: async () => { peers++; },
  });
  load(f.context, ["enterRoom"]);
  await f.context.enterRoom("room", 1);
  assert.equal(f.effects.calls[0].action, "strategy_expire_prestart");
  assert.equal(f.state.screen, "noContest");
  assert.equal(peers, 0);
});

test("pending ICE draining cannot enter a newer peer after its awaited candidate completes", async () => {
  const f = roomRuntime(), first = deferred();
  let oldCalls = 0, newCalls = 0;
  f.state.pendingIce = ["old-first", "old-second"];
  f.state.peer = { addIceCandidate: async () => { oldCalls++; await first.promise; } };
  load(f.context, ["flushPendingIce"]);
  const draining = f.context.flushPendingIce();
  f.context.state = { roomId: "new-room", pendingIce: ["new-first"], peer: { addIceCandidate: async () => { newCalls++; } } };
  first.resolve(); await draining;
  assert.equal(oldCalls, 1); assert.equal(newCalls, 0);
  assert.deepEqual(f.context.state.pendingIce, ["new-first"]);
});

test("a fast local clock cannot prevent offset registration or strand peer setup after server pending", async () => {
  const f = roomRuntime();
  const commits = ["first", "second", "third"];
  const room = { hostUid: "A", guestUid: "B", protocolVersion: 3, prestartDeadlineAt: 301000,
    queueJoinedAt: { A: 1234, B: 4321 }, players: { A: { uid: "A", weaknessCommits: commits }, B: { uid: "B" } } };
  Object.assign(f.state, { roomId: "", screen: "matching", matchmakingGeneration: 1, queueJoinedAt: 1234,
    safetyPlayerRecords: new Map([["room", { salts: ["a", "b", "c"], player: { weaknessCommits: commits } }]]) });
  let peers = 0, timers = 0;
  f.hooks.response = { expired: false, status: "pending", prestartDeadlineAt: 301000, roomId: "room" };
  Object.assign(f.context, {
    Date: { now: () => 361000 },
    createStrategyPrestartGuard: (options) => api.createStrategyPrestartGuard({ ...options, setTimer: () => ++timers, clearTimer() {} }),
    isCurrentStrategyMatchmakingGeneration: () => !f.state.roomId && f.state.screen === "matching",
    get: async () => ({ val: () => room }), runtimePlayer: (value) => value,
    playStrategyMatchReadySound() {}, cleanupMatchmaking: async () => {}, updatePublicPresence: async () => {},
    setupRoomListeners: async () => {
      assert.equal(f.state.prestartGuard.blocksProgress(), true, "local clock is initially six minutes fast");
      await f.context.confirmStrategyPrestartExpiry(f.state, "room");
      f.state.serverTimeOffset = -360000;
      f.state.prestartGuard.sync();
    },
    setupPeerConnection: async () => { peers++; },
  });
  load(f.context, ["startStrategyPrestartGuard", "enterRoom"]);
  await f.context.enterRoom("room", 1);
  assert.equal(peers, 1);
  assert.equal(f.state.idleStopped, false);
  assert.equal(f.context.strategyPrestartProgressBlocked(), false);
  f.context.stopStrategyPrestartGuard();
});

test("full room cleanup uses owned-room CAS and cannot erase a newer active room", async () => {
  const f = searchRuntime();
  Object.assign(f.state, { roomId: "old-room", roomUnsubscribers: [], disconnectHandles: [] });
  f.rows.set("online/strategyActive/A", "new-room");
  Object.assign(f.context, { clearActiveContact() {}, stopReviewClock() {}, stopStrategyVideoRecording() {},
    set: async () => {}, serverTimestamp: () => 123 });
  load(f.context, ["stopStrategyPrestartGuard", "cleanupOnlineResources"]);
  await f.context.cleanupOnlineResources(false);
  assert.equal(f.rows.get("online/strategyActive/A"), "new-room");
});
