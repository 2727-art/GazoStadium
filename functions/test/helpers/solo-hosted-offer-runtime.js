"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../../online.js"), "utf8");
const names = ["soloHostedOfferWatchIsCurrent", "stopSoloHostedOfferWatch", "scheduleHostedOfferRecovery",
  "enterSoloHostedOfferRoom", "restoreHostedOfferToWaiting", "finishHostedOfferAsTerminal",
  "registerHostedOfferMonitor", "expireOffer", "cleanupMatchmaking", "notifySoloMatchRecovery"];

function namedFunction(name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const i = markers.findIndex(m => m[1] === name);
  assert.ok(i >= 0, `missing function ${name}`);
  return source.slice(markers[i].index, markers[i + 1]?.index ?? source.length);
}

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const denied = () => Object.assign(new Error("permission_denied at /online/rooms/room/status"), { code: "PERMISSION_DENIED" });

function createSoloHostedOfferRuntime(overrides = {}) {
  const state = { uid: "host", screen: "matching", roomId: "", matchmakingGeneration: 1,
    clientSessionId: "session", clientLeaseToken: "lease", pendingOffer: null, hostOfferWatch: null,
    matchUnsubscribers: [], disconnectHandles: [], soloServerMatchErrorNotified: false };
  const listeners = [], calls = [], entries = [], searches = [], toasts = [], logs = [];
  const timers = new Map(), intervals = new Map(), hooks = {};
  let nextId = 0;
  const context = {
    state, active: true, database: {}, MATCH_TIMEOUT_MS: 20000, matchmakingGenerationCounter: 1,
    isCurrentMatchmakingGeneration: generation => context.state === state && state.screen === "matching"
      && state.matchmakingGeneration === generation && !state.roomId,
    ref: (_db, key) => key,
    get: async () => { if (hooks.get) return hooks.get(); throw denied(); },
    onValue: (key, value, error) => {
      const listener = { key, value, error, stopped: false };
      listeners.push(listener);
      hooks.subscribe?.(listener);
      return () => { listener.stopped = true; };
    },
    window: {
      setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
      clearTimeout: id => timers.delete(id),
      setInterval: (fn, delay) => { const id = ++nextId; intervals.set(id, { fn, delay }); return id; },
      clearInterval: id => intervals.delete(id),
    },
    soloSessionActionCallable: async data => {
      calls.push(data);
      return { data: hooks.server ? await hooks.server(data) : { cancelled: true, status: "expired" } };
    },
    enterRoom: async roomId => {
      entries.push(roomId);
      await hooks.enter?.(roomId);
      state.roomId = roomId;
      state.screen = "connecting";
    },
    attemptCurrentSoloMatchmaking: async (generation, options) => { searches.push({ generation, options }); },
    console: { error: error => logs.push(error) },
    showToast: text => toasts.push(text),
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(names.map(namedFunction).join("\n"), context);
  const offer = (roomId = "room") => {
    context.registerHostedOfferMonitor({ roomId, candidate: { uid: "guest", sessionId: "peer" },
      reunion: false, expectedState: state, generation: state.matchmakingGeneration });
    return state.hostOfferWatch;
  };
  const fireTimer = () => {
    assert.equal(timers.size, 1, "exactly one recovery timer");
    const [id, timer] = [...timers][0];
    timers.delete(id);
    timer.fn();
    return timer.delay;
  };
  return { context, state, listeners, calls, entries, searches, toasts, logs, timers, intervals, hooks, offer, fireTimer };
}

module.exports = { createSoloHostedOfferRuntime, namedFunction, turn, deferred, denied };
