"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const strategy = read("strategy.js");
const app = read("app.js");
const storage = read("strategy-deck-storage.mjs");

function functionContaining(source, token) {
  const tokenIndex = source.indexOf(token);
  assert.ok(tokenIndex >= 0, `function token is available: ${token}`);
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gmu)];
  const startMarker = markers.filter((match) => match.index < tokenIndex).at(-1);
  const endMarker = markers.find((match) => match.index > tokenIndex);
  assert.ok(startMarker, `a function contains: ${token}`);
  return source.slice(startMarker.index, endMarker?.index ?? source.length);
}

function namedFunction(source, name) {
  const markers = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const markerIndex = markers.findIndex((match) => match[1] === name);
  assert.ok(markerIndex >= 0, `function is available: ${name}`);
  return source.slice(markers[markerIndex].index, markers[markerIndex + 1]?.index ?? source.length);
}

function assertCompleteDeckGuard(block, label) {
  assert.match(
    block,
    /strategyDeckIsComplete\(\)/u,
    `${label} must use the shared exact 5 + 5 readiness check`,
  );
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("Strategy imports the UID-scoped local deck API and owns a pre-match deck screen", () => {
  const storageImport = strategy.match(
    /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/strategy-deck-storage\.mjs(?:\?[^"']+)?["'];/u,
  )?.[0] || "";
  for (const api of [
    "deleteStrategyDeck",
    "hasCompleteStrategyDeck",
    "loadStrategyDeck",
    "saveStrategyDeck",
  ]) {
    assert.match(storageImport, new RegExp(`\\b${api}\\b`, "u"));
  }

  assert.match(strategy, /preDeck:\s*renderPreparedDeck/u);
  const prepared = namedFunction(strategy, "renderPreparedDeck");
  assertCompleteDeckGuard(prepared, "the prepared-deck screen");
  assert.match(prepared, /renderDeckZone\("main"\)/u);
  assert.match(prepared, /renderDeckZone\("reserve"\)/u);
  assert.match(prepared, /実画像10枚|メイン5枚[^\n]*リザーブ5枚/u);

  const summary = namedFunction(strategy, "renderPreparedDeckSummary");
  const open = namedFunction(strategy, "openPreparedDeck");
  const bindings = namedFunction(strategy, "bindScreenEvents");
  assert.match(summary, /id="strategyOpenPreDeck"/u);
  assert.match(open, /state\.screen\s*=\s*"preDeck"/u);
  assert.match(bindings, /#strategyOpenPreDeck[\s\S]*?openPreparedDeck/u);
});

test("matching and sealing are guarded by one exact main-five plus reserve-five predicate", () => {
  const predicate = namedFunction(strategy, "strategyDeckIsComplete");
  assert.match(
    predicate,
    /return\s+hasCompleteStrategyDeck\(state\.main,\s*state\.reserve\);/u,
  );

  const readiness = namedFunction(strategy, "renderStrategyCrownMatchmakingActions");
  const saveProfile = namedFunction(strategy, "saveProfile");
  const begin = namedFunction(strategy, "beginMatchmaking");
  const lock = namedFunction(strategy, "lockDeck");
  for (const [label, block] of [
    ["profile matchmaking readiness", readiness],
    ["profile submission", saveProfile],
    ["matchmaking entry", begin],
    ["post-match deck sealing", lock],
  ]) {
    assertCompleteDeckGuard(block, label);
  }

  assert.match(begin, /10枚|メイン5枚とリザーブ5枚/u);
  assert.match(lock, /10枚|メイン5枚とリザーブ5枚/u);
  assert.match(lock, /mainCount:\s*(?:state\.main\.length|MAIN_COUNT)/u);
  assert.match(lock, /reserveCount:\s*(?:state\.reserve\.length|RESERVE_COUNT)/u);
});

test("Strategy has no sample-fill escape hatch while both deck builders remain editable", () => {
  assert.doesNotMatch(strategy, /data-strategy-sample|fillDeckSamples|createSampleItems/u);

  const postMatchBuilder = namedFunction(strategy, "renderDeckBuilder");
  const zone = namedFunction(strategy, "renderDeckZone");
  const bindings = namedFunction(strategy, "bindScreenEvents");
  assert.match(postMatchBuilder, /renderDeckZone\("main"\)/u);
  assert.match(postMatchBuilder, /renderDeckZone\("reserve"\)/u);
  assert.match(postMatchBuilder, /id="strategyLockDeck"/u);
  assert.match(zone, /data-strategy-upload/u);
  assert.match(zone, /data-strategy-remove/u);
  assert.match(bindings, /addDeckFiles/u);
  assert.match(bindings, /removeDeckItem/u);
  assert.match(strategy, /state\.screen\s*=\s*"deck"/u);
});

test("local reuse is explicit, UID-scoped, and supports load, overwrite, and deletion", () => {
  assert.match(strategy, /DECK_PERSISTENCE_KEY/u);
  assert.match(strategy, /type="checkbox"[^>]*(?:strategy[^>]*deck|deck[^>]*strategy)/iu);
  assert.match(strategy, /この端末[^\n]*(?:保存|復元)/u);
  assert.match(strategy, /保存デッキ[^\n]*削除/u);

  assert.match(strategy, /loadStrategyDeck\(targetUid\)/u);
  assert.match(strategy, /saveStrategyDeck\(\{[\s\S]*?uid:\s*targetState\.uid[\s\S]*?main:\s*targetState\.main[\s\S]*?reserve:\s*targetState\.reserve/u);
  assert.match(strategy, /deleteStrategyDeck\((?:targetState\.uid|targetUid)\)/u);
  assert.match(storage, /indexedDB/u);
  assert.doesNotMatch(storage, /firebase|localStorage|sessionStorage/iu);
});

test("restored cards receive fresh runtime-only identity, URLs, order, and unused state", () => {
  const runtimeCard = namedFunction(strategy, "createRuntimeStrategyCard");
  assert.match(runtimeCard, /id:\s*strategyDeckCardId\(\)/u);
  assert.match(runtimeCard, /url:\s*URL\.createObjectURL\(card\.blob\)/u);
  assert.match(runtimeCard, /position,/u);
  assert.match(runtimeCard, /used:\s*false/u);
  assert.match(runtimeCard, /isSample:\s*false/u);
  assert.match(runtimeCard, /audioUrl:\s*audioBlob\s*\?\s*URL\.createObjectURL\(audioBlob\)/u);

  const restore = namedFunction(strategy, "restoreStoredStrategyDeck");
  assert.match(restore, /record\.main\.forEach\(\(card, index\)\s*=>\s*nextMain\.push\(createRuntimeStrategyCard\(card, index\)\)\)/u);
  assert.match(restore, /record\.reserve\.forEach\(\(card, index\)\s*=>\s*nextReserve\.push\(createRuntimeStrategyCard\(card, MAIN_COUNT \+ index\)\)\)/u);
  assert.match(restore, /releaseRuntimeStrategyDeck\(targetState\.main, targetState\.reserve\)/u);
});

test("a local storage failure is recoverable and cannot become a matchmaking or deckReady prerequisite", async () => {
  const persist = namedFunction(strategy, "persistCompleteStrategyDeck");
  const context = vm.createContext({
    state: {
      persistDeck: true,
      uid: "player-one",
      main: Array(5).fill({}),
      reserve: Array(5).fill({}),
      deckSaveBusy: false,
      deckSavePromise: null,
      deckRestoreStatus: "idle",
      deckRestoreMessage: "",
    },
    strategyDeckIsComplete: () => true,
    saveStrategyDeck: async () => { throw new Error("quota"); },
    renderStrategyDeckIfVisible() {},
    showToast() {},
    console: { error() {} },
  });
  vm.runInContext(`${persist}\nglobalThis.persistCompleteStrategyDeckForTest = persistCompleteStrategyDeck;`, context);
  assert.equal(await context.persistCompleteStrategyDeckForTest(), false);
  assert.equal(context.state.deckSaveBusy, false);
  assert.match(context.state.deckRestoreMessage, /対戦はそのまま続けられます/u);

  const begin = namedFunction(strategy, "beginMatchmaking");
  const lock = namedFunction(strategy, "lockDeck");
  assert.doesNotMatch(begin, /storedDeckAvailable|deckSavedAt/u);
  assert.match(lock, /persistCompleteStrategyDeck/u);
  assert.match(lock, /set\(ref\(database, `online\/strategyRooms\/\$\{[^}]+\}\/deckReady\/\$\{[^}]+\}`\)/u);
});

test("the prepared screen offers a real route to Normal 1on1 after releasing Strategy state", () => {
  assert.match(app, /openNormal1on1:\s*startOnlineBattle/u);
  assert.match(strategy, /通常(?:型)?1on1/u);
  const route = functionContaining(strategy, "window.HariaiApp?.openNormal1on1");
  const releaseIndex = route.indexOf("releaseAllImages()");
  const inactiveIndex = route.indexOf("active = false");
  const openIndex = route.indexOf("window.HariaiApp?.openNormal1on1");
  assert.ok(releaseIndex >= 0 && releaseIndex < openIndex, "Strategy media is released before switching modes");
  assert.ok(inactiveIndex >= 0 && inactiveIndex < openIndex, "Strategy ownership ends before Normal 1on1 starts");
});

test("save, restore, and delete share one storage mutex and deletion disables persistence before awaiting", async () => {
  const busy = namedFunction(strategy, "strategyDeckStorageBusy");
  const restore = namedFunction(strategy, "restoreStoredStrategyDeck");
  const persist = namedFunction(strategy, "persistCompleteStrategyDeck");
  const remove = namedFunction(strategy, "deleteStoredStrategyDeck");
  const toggle = namedFunction(strategy, "updateStrategyDeckPersistence");

  assert.match(busy, /state\.deckRestoreStatus\s*===\s*"loading"/u);
  assert.match(busy, /state\.deckSaveBusy/u);
  assert.match(busy, /state\.deckDeleteBusy/u);
  assert.match(restore, /strategyDeckStorageBusy\(\)/u);
  assert.match(remove, /strategyDeckStorageBusy\(\)/u);
  assert.match(toggle, /strategyDeckStorageBusy\(\)/u);
  assert.match(persist, /targetState\.deckDeleteBusy/u);
  assert.match(persist, /targetState\.deckRestoreStatus\s*===\s*"loading"/u);
  assert.match(persist, /if \(targetState\.deckSavePromise\)[\s\S]*?await targetState\.deckSavePromise/u);

  const persistOff = remove.indexOf("targetState.persistDeck = false");
  const deleteAwait = remove.indexOf("await deleteStrategyDeck(targetUid)");
  assert.ok(persistOff >= 0 && persistOff < deleteAwait, "delete intent disables persistence before IndexedDB work starts");

  const pendingDelete = createDeferred();
  const persistedFlags = new Map();
  let deleteCalls = 0;
  const context = vm.createContext({
    state: {
      uid: "player-one",
      persistDeck: true,
      deckRestoreStatus: "idle",
      deckRestoreMessage: "",
      deckSaveBusy: false,
      deckSavePromise: null,
      deckDeleteBusy: false,
      storedDeckAvailable: true,
      deckSavedAt: 123,
    },
    active: true,
    localStorage: {
      setItem(key, value) { persistedFlags.set(key, value); },
    },
    strategyDeckPersistenceKey: (uid) => `deck:${uid}`,
    async deleteStrategyDeck() {
      deleteCalls += 1;
      return pendingDelete.promise;
    },
    renderStrategyDeckIfVisible() {},
    showToast() {},
    console: { error() {} },
  });
  vm.runInContext(`
    ${busy}
    ${remove}
    globalThis.storageRaceApi = { strategyDeckStorageBusy, deleteStoredStrategyDeck };
  `, context);

  const deleting = context.storageRaceApi.deleteStoredStrategyDeck();
  assert.equal(context.state.persistDeck, false);
  assert.equal(context.state.deckDeleteBusy, true);
  assert.equal(context.storageRaceApi.strategyDeckStorageBusy(), true);
  assert.equal(persistedFlags.get("deck:player-one"), "false");
  assert.equal(deleteCalls, 1);
  assert.equal(await context.storageRaceApi.deleteStoredStrategyDeck(), false);
  assert.equal(deleteCalls, 1, "a second delete cannot overlap the first one");

  pendingDelete.resolve();
  assert.equal(await deleting, true);
  assert.equal(context.state.deckDeleteBusy, false);
  assert.equal(context.state.storedDeckAvailable, false);
});

test("deckReady is locally committed only after the server ACK and identity requires that ACK", async () => {
  const lock = namedFunction(strategy, "lockDeck");
  const react = namedFunction(strategy, "reactToRoomData");
  const resetFalse = lock.indexOf("targetState.localDeckReadyCommitted = false");
  const serverWrite = lock.indexOf("await set(ref(database");
  const ackTrue = lock.indexOf("targetState.localDeckReadyCommitted = true");
  assert.ok(resetFalse >= 0 && resetFalse < serverWrite, "the local readiness latch is cleared before the write");
  assert.ok(serverWrite >= 0 && serverWrite < ackTrue, "the local readiness latch is set only after the awaited write");
  assert.match(lock, /catch \(error\)[\s\S]*?localDeckReadyCommitted\s*=\s*false/u);
  assert.match(
    react,
    /const bothDecksComplete\s*=\s*both\(deckReady\)[\s\S]*?mainCount\s*===\s*MAIN_COUNT[\s\S]*?reserveCount\s*===\s*RESERVE_COUNT/u,
  );
  assert.match(
    react,
    /if \(state\.localDeckReadyCommitted\s*&&\s*bothDecksComplete[\s\S]*?state\.screen\s*=\s*"identity"/u,
  );

  function createLockHarness(serverResult) {
    const effects = { materialize: 0, react: 0, renders: 0, toasts: 0 };
    const state = {
      uid: "player-one",
      roomId: "room-one",
      screen: "deck",
      localDeckReadyCommitted: true,
      roomData: {},
    };
    const context = vm.createContext({
      state,
      active: true,
      MAIN_COUNT: 5,
      RESERVE_COUNT: 5,
      database: {},
      strategyDeckIsComplete: () => true,
      persistCompleteStrategyDeck: async () => false,
      handleRecoverableError() {},
      ref: (_database, location) => location,
      set: () => serverResult.promise,
      serverTimestamp: () => ({ ".sv": "timestamp" }),
      render() { effects.renders += 1; },
      materializeMatchAchievementShowcases() { effects.materialize += 1; },
      async reactToRoomData() { effects.react += 1; },
      showToast() { effects.toasts += 1; },
    });
    vm.runInContext(`${lock}\nglobalThis.lockDeckForTest = lockDeck;`, context);
    return { context, effects, state };
  }

  const successfulWrite = createDeferred();
  const success = createLockHarness(successfulWrite);
  const successfulLock = success.context.lockDeckForTest();
  assert.equal(success.state.screen, "waitingDeck");
  assert.equal(success.state.localDeckReadyCommitted, false, "the server write is still pending");
  assert.equal(success.effects.react, 0);
  successfulWrite.resolve();
  await successfulLock;
  assert.equal(success.state.localDeckReadyCommitted, true);
  assert.equal(success.effects.materialize, 1);
  assert.equal(success.effects.react, 1);

  const rejectedWrite = createDeferred();
  const failure = createLockHarness(rejectedWrite);
  const rejectedLock = failure.context.lockDeckForTest();
  assert.equal(failure.state.localDeckReadyCommitted, false);
  rejectedWrite.reject(new Error("permission denied"));
  await rejectedLock;
  assert.equal(failure.state.localDeckReadyCommitted, false);
  assert.equal(failure.state.screen, "deck");
  assert.equal(failure.effects.react, 0);
  assert.equal(failure.effects.toasts, 1);
});

test("switching to Normal 1on1 invalidates the matchmaking generation before cleanup can yield", async () => {
  const route = namedFunction(strategy, "leaveToNormal1on1");
  const invalidate = route.indexOf("targetState.matchmakingLaunchGeneration += 1");
  const firstAwait = route.indexOf("await cleanupOnlineResources(false)");
  assert.ok(invalidate >= 0 && invalidate < firstAwait, "the old launch generation is invalidated before async cleanup");
  assert.match(route, /targetState\.matchmakingLaunchBusy\s*=\s*false/u);

  const cleanup = createDeferred();
  const effects = { cleanup: 0, released: 0, normalOpened: 0 };
  const state = {
    normalRouteBusy: false,
    matchmakingLaunchGeneration: 12,
    matchmakingLaunchBusy: true,
  };
  const context = vm.createContext({
    state,
    active: true,
    async cleanupOnlineResources() {
      effects.cleanup += 1;
      return cleanup.promise;
    },
    releaseAllImages() { effects.released += 1; },
    renderStrategyDeckIfVisible() {},
    handleRecoverableError() {},
    window: {
      HariaiApp: {
        openNormal1on1() { effects.normalOpened += 1; },
        returnHome() {},
      },
    },
  });
  vm.runInContext(`${route}\nglobalThis.leaveToNormal1on1ForTest = leaveToNormal1on1;`, context);

  const switching = context.leaveToNormal1on1ForTest();
  assert.equal(state.normalRouteBusy, true);
  assert.equal(state.matchmakingLaunchGeneration, 13);
  assert.equal(state.matchmakingLaunchBusy, false);
  assert.equal(effects.cleanup, 1);
  assert.equal(effects.released, 0);
  assert.equal(effects.normalOpened, 0);
  assert.equal(context.active, true);

  cleanup.resolve();
  await switching;
  assert.equal(effects.released, 1);
  assert.equal(effects.normalOpened, 1);
  assert.equal(context.active, false);
});
