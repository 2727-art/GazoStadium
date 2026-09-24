"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../../strategy.js"), "utf8");
const functionNames = [
  "isCurrentStrategyMatchmakingGeneration", "removeStrategyQueueEntryIfCurrent",
  "strategyQueueContextIsCurrent", "queueStrategyDisconnectOperation", "armStrategyQueueDisconnect",
  "refreshStrategyMatchmakingQueue", "watchStrategyMatchmakingConnection", "attemptToHost",
  "stopStrategyOfferWatch", "strategyOfferWatchIsCurrent", "finishStrategyOffer", "watchStrategyOffer",
  "createOffer", "expireOffer", "cleanupMatchmaking",
];
function namedFunction(name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const index = markers.findIndex((match) => match[1] === name);
  assert.ok(index >= 0, `missing runtime function ${name}`);
  return source.slice(markers[index].index, markers[index + 1]?.index ?? source.length);
}
const clone = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
const snapshot = (value) => ({ val: () => clone(value), exists: () => value != null });
const turn = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createStrategyMatchmakingRuntime(overrides = {}) {
  const state = {
    uid: "A", screen: "matching", roomId: "", matchmakingGeneration: 1,
    queueJoinedAt: 1234, matchmakingConnected: true, queueConnectionEpoch: 1,
    queueRecoveryPromise: null, queueRecoveryEpoch: 0, queueDisconnect: null,
    imagePreference: "both", matchScopeExpanded: false, pendingOffer: null,
    pendingIncomingOffer: null, matchingBusy: false, acceptingOffer: false,
    latestQueue: {}, hostOfferWatch: null, matchUnsubscribers: [], disconnectHandles: [],
  };
  const rows = new Map();
  const events = [], errors = [], entered = [], listeners = [], timeouts = new Map(), intervals = new Map();
  let timerId = 0, disconnectId = 0;
  const hooks = {};
  const context = {
    state, active: true, database: {}, strategyMatchmakingGenerationCounter: 1,
    strategyQueueDisconnectOperations: Promise.resolve(), STRATEGY_PROTOCOL_VERSION: 2,
    STRATEGY_QUEUE_WAITING_STATE: "waiting-v2", MATCH_TIMEOUT_MS: 20_000,
    Date, Promise, console,
    ref: (_db, key) => key,
    push: () => ({ key: "PROPOSED0000000000001" }),
    get: async (key) => { await hooks.beforeGet?.(key); return snapshot(rows.get(key)); },
    runTransaction: async (key, update) => {
      await hooks.beforeTransaction?.(key);
      // Firebase may first invoke the callback against an empty local cache.
      // Returning undefined there aborts without ever consulting the server.
      if (hooks.coldTransaction && update(null) === undefined) {
        return { committed: false, snapshot: snapshot(null) };
      }
      const result = update(clone(rows.get(key)));
      if (result !== undefined) {
        if (result == null) rows.delete(key); else rows.set(key, clone(result));
      }
      const response = { committed: result !== undefined, snapshot: snapshot(result === undefined ? rows.get(key) : result) };
      await hooks.afterTransaction?.(key, response);
      return response;
    },
    onDisconnect: (key) => {
      const id = ++disconnectId;
      return {
        remove: async () => { events.push(["arm", id, key]); await hooks.arm?.(id); },
        cancel: async () => { events.push(["cancel", id, key]); await hooks.cancel?.(id); },
      };
    },
    onValue: (key, value, error) => {
      const listener = { key, value, error, stopped: false };
      listeners.push(listener);
      return () => { listener.stopped = true; events.push(["unsubscribe", key]); };
    },
    window: {
      setInterval: (fn) => { const id = ++timerId; intervals.set(id, fn); return id; },
      clearInterval: (id) => intervals.delete(id),
      setTimeout: (fn) => { const id = ++timerId; timeouts.set(id, fn); return id; },
      clearTimeout: (id) => timeouts.delete(id),
    },
    handleRecoverableError: (error) => errors.push(error),
    requestSafety: async (action, data) => {
      events.push([action, data.roomId]);
      return hooks.safety ? hooks.safety(action, data) : { roomId: data.roomId, status: "expired" };
    },
    safetyPlayerRoomRecord: async () => ({ uid: "A" }),
    enterRoom: async (roomId) => {
      await hooks.enter?.(roomId);
      entered.push(roomId);
      state.roomId = roomId;
      state.screen = "connecting";
      context.stopStrategyOfferWatch(state.hostOfferWatch);
    },
    drainIncomingOffers: async () => {},
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(functionNames.map(namedFunction).join("\n"), context);
  return { context, state: context.state, rows, events, errors, entered, listeners, timeouts, intervals, hooks };
}

module.exports = { createStrategyMatchmakingRuntime, clone, snapshot, turn, deferred };
