"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const strategy = read("strategy.js");
const app = read("app.js");
const storage = read("strategy-deck-storage.mjs");
const indexHtml = read("index.html");
const storageModuleUrl = pathToFileURL(path.join(root, "strategy-deck-storage.mjs")).href;

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

function appNamedFunction(source, name) {
  const markers = [...source.matchAll(/^  (?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gmu)];
  const markerIndex = markers.findIndex((match) => match[1] === name);
  assert.ok(markerIndex >= 0, `app function is available: ${name}`);
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

function nextEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("Strategy imports the UID-scoped local deck API and owns a pre-match deck screen", () => {
  const storageImport = strategy.match(
    /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/strategy-deck-storage\.mjs(?:\?[^"']+)?["'];/u,
  )?.[0] || "";
  for (const api of [
    "STRATEGY_DECK_IMAGE_MAX_BYTES",
    "STRATEGY_DECK_IMAGE_MIME_TYPES",
    "deleteStrategyDeck",
    "hasPersistableStrategyDeck",
    "hasPlayableStrategyDeck",
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

test("matching and sealing use playable readiness instead of the persistence serializer", () => {
  const predicate = namedFunction(strategy, "strategyDeckIsComplete");
  assert.match(
    predicate,
    /return\s+hasPlayableStrategyDeck\(targetState\.main,\s*targetState\.reserve\);/u,
  );
  const persistable = namedFunction(strategy, "strategyDeckIsPersistable");
  assert.match(persistable, /hasPersistableStrategyDeck\(targetState\.main,\s*targetState\.reserve\)/u);

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

  assert.match(strategy, /loadStrategyDeck\(targetUid,\s*\{/u);
  assert.match(strategy, /saveStrategyDeck\(\{[\s\S]*?uid:\s*targetState\.uid[\s\S]*?main:\s*targetState\.main[\s\S]*?reserve:\s*targetState\.reserve/u);
  assert.match(strategy, /deleteStrategyDeck\((?:targetState\.uid|targetUid),\s*\{/u);
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
      deckSaveMutationVersion: -1,
      deckMutationVersion: 0,
      deckRestoreStatus: "idle",
      deckRestoreMessage: "",
    },
    strategyDeckIsComplete: () => true,
    strategyDeckIsPersistable: () => true,
    withStrategyDeckStorageTimeout: (promise) => promise,
    DECK_SAVE_TIMEOUT_MS: 10,
    DECK_STORAGE_WATCHDOG_GRACE_MS: 1,
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

test("the shared canvas path preserves a real PNG fallback instead of claiming WebP", async () => {
  const processImage = appNamedFunction(app, "processImageFile");
  const canvasToBlob = appNamedFunction(app, "canvasToBlob");
  const makeDeckItem = appNamedFunction(app, "makeDeckItem");
  const calls = { requestedType: "", closed: 0 };
  const pngBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "ios-fallback",
  ], { type: "image/png" });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toBlob(callback, type) {
      calls.requestedType = type;
      callback(pngBlob);
    },
  };
  const context = vm.createContext({
    Blob,
    MAX_FILE_BYTES: 15 * 1024 * 1024,
    MAX_IMAGE_SIDE: 1920,
    document: { createElement: () => canvas },
    decodeImage: async () => ({
      source: {},
      width: 1672,
      height: 941,
      close() { calls.closed += 1; },
    }),
    URL: { createObjectURL: () => "blob:ios-png" },
    Date,
    Math,
  });
  vm.runInContext(`
    ${canvasToBlob}
    ${makeDeckItem}
    ${processImage}
    globalThis.processImageFileForTest = processImageFile;
  `, context);

  const item = await context.processImageFileForTest({ type: "image/jpeg", size: 256_498 }, 0, { maxSide: 1280 });
  assert.equal(calls.requestedType, "image/webp");
  assert.equal(calls.closed, 1);
  assert.equal(item.blob.type, "image/png");
  assert.equal(item.url, "blob:ios-png");

  const storageApi = await import(storageModuleUrl);
  const main = Array.from({ length: 5 }, (_, position) => ({ ...item, position, isSample: false }));
  const reserve = Array.from({ length: 5 }, (_, index) => ({ ...item, position: 5 + index, isSample: false }));
  assert.equal(storageApi.hasPlayableStrategyDeck(main, reserve), true);
  assert.equal(storageApi.hasCompleteStrategyDeck(main, reserve), true, "older cached Strategy code also accepts PNG");

  const prepared = namedFunction(strategy, "renderPreparedDeck");
  const renderContext = vm.createContext({
    state: {
      main,
      reserve,
      deckRestoreStatus: "idle",
      normalRouteBusy: false,
      matchmakingLaunchBusy: false,
    },
    MAIN_COUNT: 5,
    RESERVE_COUNT: 5,
    strategyDeckIsComplete: () => storageApi.hasPlayableStrategyDeck(main, reserve),
    renderDeckZone: () => "",
    renderStrategyDeckPersistencePanel: () => "",
  });
  vm.runInContext(`${prepared}\nglobalThis.renderPreparedDeckForTest = renderPreparedDeck;`, renderContext);
  const doneButton = renderContext.renderPreparedDeckForTest()
    .match(/<button[^>]*id="strategyPreparedDeckDone"[^>]*>/u)?.[0] || "";
  assert.doesNotMatch(doneButton, /disabled/u, "ten real iOS PNG fallbacks enable completion");
});

test("prepared completion ignores optional save/delete latency but waits for restore", () => {
  const prepared = namedFunction(strategy, "renderPreparedDeck");
  const complete = namedFunction(strategy, "completePreparedDeck");
  const state = {
    main: Array(5).fill({}),
    reserve: Array(5).fill({}),
    deckRestoreStatus: "saved",
    deckSaveBusy: true,
    deckDeleteBusy: false,
    normalRouteBusy: false,
    matchmakingLaunchBusy: false,
  };
  const context = vm.createContext({
    state,
    MAIN_COUNT: 5,
    RESERVE_COUNT: 5,
    strategyDeckIsComplete: () => true,
    renderDeckZone: () => "",
    renderStrategyDeckPersistencePanel: () => "",
  });
  vm.runInContext(`${prepared}\nglobalThis.renderPreparedDeckForTest = renderPreparedDeck;`, context);
  const doneButton = () => context.renderPreparedDeckForTest().match(/<button[^>]*id="strategyPreparedDeckDone"[^>]*>/u)?.[0] || "";

  assert.doesNotMatch(doneButton(), /disabled/u, "a background save does not block play");
  state.deckSaveBusy = false;
  state.deckDeleteBusy = true;
  assert.doesNotMatch(doneButton(), /disabled/u, "a background delete does not block play");
  state.deckDeleteBusy = false;
  state.deckRestoreStatus = "loading";
  assert.match(doneButton(), /disabled/u, "a restore can replace the deck and must block completion");

  assert.doesNotMatch(complete, /strategyDeckStorageBusy\(\)/u);
  assert.match(complete, /state\.deckRestoreStatus\s*===\s*"loading"/u);
});

test("an aggregate overflow is rejected with a reason before the tenth image is kept", () => {
  const validate = namedFunction(strategy, "validateStrategyDeckImageForAddition");
  const addFiles = namedFunction(strategy, "addDeckFiles");
  const sevenMiB = new Blob([new Uint8Array(7 * 1024 * 1024)], { type: "image/png" });
  const twoMiB = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/png" });
  const state = {
    main: Array(5).fill({ blob: sevenMiB }),
    reserve: Array(4).fill({ blob: sevenMiB }),
  };
  const context = vm.createContext({
    state,
    Blob,
    STRATEGY_DECK_IMAGE_MAX_BYTES: 15 * 1024 * 1024,
    STRATEGY_DECK_IMAGE_TOTAL_MAX_BYTES: 64 * 1024 * 1024,
    STRATEGY_DECK_IMAGE_MIME_TYPES: ["image/webp", "image/png", "image/jpeg"],
    normalizeOnlineImageMime: (value) => String(value || "").trim().toLowerCase(),
    Number,
    Error,
  });
  vm.runInContext(`${validate}\nglobalThis.validateImageForTest = validateStrategyDeckImageForAddition;`, context);

  assert.throws(() => context.validateImageForTest(twoMiB, state), /合計は64MB以下/u);
  assert.match(addFiles, /validateStrategyDeckImageForAddition\(item\.blob, targetState\)/u);
  assert.match(addFiles, /releaseLocalStrategyCard\(item\)/u);
});

test("turning persistence on replaces stale OFF copy before ten images are ready", async () => {
  const toggle = namedFunction(strategy, "updateStrategyDeckPersistence");
  const persistedFlags = new Map();
  const state = {
    uid: "player-one",
    persistDeck: false,
    storedDeckAvailable: false,
    deckRestoreStatus: "missing",
    deckRestoreMessage: "自動保存・自動復元をOFFにしました。",
  };
  const context = vm.createContext({
    state,
    strategyDeckStorageBusy: () => false,
    strategyDeckPersistenceKey: (uid) => `deck:${uid}`,
    strategyDeckIsComplete: () => false,
    persistCompleteStrategyDeck: async () => false,
    localStorage: { setItem: (key, value) => persistedFlags.set(key, value) },
    showToast() {},
    renderStrategyDeckIfVisible() {},
  });
  vm.runInContext(`${toggle}\nglobalThis.updateStrategyDeckPersistenceForTest = updateStrategyDeckPersistence;`, context);

  await context.updateStrategyDeckPersistenceForTest(true);
  assert.equal(state.persistDeck, true);
  assert.equal(persistedFlags.get("deck:player-one"), "true");
  assert.match(state.deckRestoreMessage, /ONにしました/u);
  assert.doesNotMatch(state.deckRestoreMessage, /OFFにしました/u);
});

test("only a load failure enables the no-record storage recheck action", () => {
  const panel = namedFunction(strategy, "renderStrategyDeckPersistencePanel");
  const state = {
    authReady: true,
    persistDeck: true,
    storedDeckAvailable: false,
    deckRestoreStatus: "unpersistable",
    deckRestoreMessage: "保存できませんでした。",
    deckSavedAt: 0,
  };
  const context = vm.createContext({
    state,
    strategyDeckStorageBusy: () => false,
    strategyDeckStatusCopy: () => state.deckRestoreMessage,
    escapeHtml: (value) => String(value),
    Intl,
    Date,
  });
  vm.runInContext(`${panel}\nglobalThis.renderPanelForTest = renderStrategyDeckPersistencePanel;`, context);
  const loadButton = () => context.renderPanelForTest()
    .match(/<button[^>]*id="strategyLoadStoredDeck"[^>]*>[\s\S]*?<\/button>/u)?.[0] || "";

  assert.match(loadButton(), /disabled/u);
  assert.match(loadButton(), /保存デッキを読み込む/u);
  state.deckRestoreStatus = "load-error";
  assert.doesNotMatch(loadButton(), /disabled/u);
  assert.match(loadButton(), /端末保存を再確認/u);
  state.deckRestoreStatus = "unpersistable";
  state.storedDeckAvailable = true;
  assert.doesNotMatch(loadButton(), /disabled/u);
  assert.match(loadButton(), /保存デッキを読み込む/u);
});

test("a save watchdog clears UI busy state without blocking the playable deck", async () => {
  const timeout = namedFunction(strategy, "withStrategyDeckStorageTimeout");
  const persist = namedFunction(strategy, "persistCompleteStrategyDeck");
  const state = {
    persistDeck: true,
    uid: "player-one",
    main: Array(5).fill({}),
    reserve: Array(5).fill({}),
    deckDeleteBusy: false,
    deckRestoreStatus: "idle",
    deckRestoreMessage: "",
    deckSaveBusy: false,
    deckSavePromise: null,
    deckSaveMutationVersion: -1,
    deckMutationVersion: 1,
  };
  const context = vm.createContext({
    state,
    DECK_STORAGE_TIMEOUT_MS: 5,
    DECK_SAVE_TIMEOUT_MS: 5,
    DECK_STORAGE_WATCHDOG_GRACE_MS: 1,
    strategyDeckIsComplete: () => true,
    strategyDeckIsPersistable: () => true,
    saveStrategyDeck: () => new Promise(() => {}),
    window: { setTimeout, clearTimeout },
    renderStrategyDeckIfVisible() {},
    showToast() {},
    console: { error() {} },
  });
  vm.runInContext(`
    ${timeout}
    ${persist}
    globalThis.persistCompleteStrategyDeckForTest = persistCompleteStrategyDeck;
  `, context);

  assert.equal(await context.persistCompleteStrategyDeckForTest(), false);
  assert.equal(state.deckSaveBusy, false);
  assert.equal(state.deckSavePromise, null);
  assert.equal(context.strategyDeckIsComplete(), true);
  assert.match(state.deckRestoreMessage, /完了を確認できません/u);
});

test("concurrent save requests share one write and coalesce one edited follow-up", async () => {
  const persist = namedFunction(strategy, "persistCompleteStrategyDeck");
  const state = {
    persistDeck: true,
    uid: "player-one",
    main: Array(5).fill({}),
    reserve: Array(5).fill({}),
    deckDeleteBusy: false,
    deckRestoreStatus: "idle",
    deckRestoreMessage: "",
    deckSaveBusy: false,
    deckSavePromise: null,
    deckSaveMutationVersion: -1,
    deckMutationVersion: 1,
  };
  const writes = [];
  const context = vm.createContext({
    state,
    DECK_SAVE_TIMEOUT_MS: 50,
    DECK_STORAGE_WATCHDOG_GRACE_MS: 1,
    strategyDeckIsComplete: () => true,
    strategyDeckIsPersistable: () => true,
    withStrategyDeckStorageTimeout: (promise) => promise,
    saveStrategyDeck() {
      const deferred = createDeferred();
      writes.push(deferred);
      return deferred.promise;
    },
    renderStrategyDeckIfVisible() {},
    showToast() {},
    console: { error() {} },
    Date,
  });
  vm.runInContext(`${persist}\nglobalThis.persistCompleteStrategyDeckForTest = persistCompleteStrategyDeck;`, context);

  const first = context.persistCompleteStrategyDeckForTest();
  const sameVersionA = context.persistCompleteStrategyDeckForTest();
  const sameVersionB = context.persistCompleteStrategyDeckForTest();
  await nextEventLoopTurn();
  assert.equal(writes.length, 1);
  writes[0].resolve({ updatedAt: 100 });
  assert.deepEqual(await Promise.all([first, sameVersionA, sameVersionB]), [true, true, true]);
  assert.equal(writes.length, 1, "the same mutation version is written once");

  const oldVersion = context.persistCompleteStrategyDeckForTest();
  await nextEventLoopTurn();
  assert.equal(writes.length, 2);
  state.deckMutationVersion = 2;
  const latestA = context.persistCompleteStrategyDeckForTest();
  const latestB = context.persistCompleteStrategyDeckForTest();
  writes[1].resolve({ updatedAt: 200 });
  await nextEventLoopTurn();
  assert.equal(writes.length, 3, "one follow-up captures the edited version");
  writes[2].resolve({ updatedAt: 300 });
  assert.deepEqual(await Promise.all([oldVersion, latestA, latestB]), [true, true, true]);
  assert.equal(writes.length, 3, "followers coalesce onto the same edited write");
  assert.equal(state.deckSavePromise, null);
  assert.equal(state.deckSaveMutationVersion, -1);
});

test("cache keys publish the iOS image fallback as one frontend release", () => {
  assert.match(indexHtml, /app\.js\?v=[^"']*strategy-ios-image-fallback-v1/u);
  assert.match(indexHtml, /strategy\.js\?v=[^"']*strategy-ios-image-fallback-v1/u);
  assert.match(strategy, /strategy-deck-storage\.mjs\?v=[^"']*strategy-ios-image-fallback-v1/u);
});

test("Strategy P2P sends and receives only size-bounded, byte-verified safe image formats", () => {
  const channel = namedFunction(strategy, "handleChannelMessage");
  const start = namedFunction(strategy, "normalizeIncomingStrategyImageStart");
  const finish = namedFunction(strategy, "finishIncomingImage");
  const send = namedFunction(strategy, "sendImage");

  assert.match(start, /STRATEGY_DECK_IMAGE_MIME_TYPES\.includes\(mime\)/u);
  assert.match(start, /size\s*>\s*STRATEGY_DECK_IMAGE_MAX_BYTES/u);
  assert.match(channel, /received\s*\+\s*chunk\.byteLength\s*>\s*state\.incomingTransfer\.size/u);
  assert.match(finish, /verifiedOnlineImageMimeFromChunks\(transfer\.chunks\)/u);
  assert.match(finish, /mime\s*!==\s*transfer\.mime/u);
  assert.match(send, /verifiedOnlineImageMime\(buffer\)/u);
  assert.match(send, /mime\s*!==\s*normalizeOnlineImageMime\(item\.blob\.type\)/u);
});

test("incoming Strategy image starts are bounded to the opponent and valid match keys", () => {
  const normalizeStart = namedFunction(strategy, "normalizeIncomingStrategyImageStart");
  const state = {
    opponentUid: "opponent-one",
    round: 2,
    incomingTransfer: null,
    roomData: {
      rounds: { 2: { actionPicks: { "opponent-one": { type: "request", skipped: false } } } },
      weaknessChains: { "opponent-one": { count: 2 } },
    },
  };
  const context = vm.createContext({
    state,
    STRATEGY_DECK_IMAGE_MAX_BYTES: 15 * 1024 * 1024,
    STRATEGY_DECK_IMAGE_MIME_TYPES: ["image/webp", "image/png", "image/jpeg"],
    MAX_ROUNDS: 5,
    MAX_WEAKNESS_CHAIN: 3,
    normalizeOnlineImageMime: (value) => String(value || "").trim().toLowerCase(),
    Number,
    String,
    Error,
    Array,
  });
  vm.runInContext(`${normalizeStart}\nglobalThis.normalizeStartForTest = normalizeIncomingStrategyImageStart;`, context);
  const start = (overrides = {}) => context.normalizeStartForTest({
    kind: "base",
    round: 2,
    ownerUid: "opponent-one",
    size: 100,
    mime: "image/webp",
    ...overrides,
  }, state);

  assert.equal(start().mime, "image/webp", "the previous WebP sender shape remains valid");
  assert.equal(start({ mime: "image/png" }).mime, "image/png", "an iPhone PNG fallback is valid");
  assert.equal(start({ mime: "image/jpeg" }).mime, "image/jpeg");
  assert.throws(() => start({ ownerUid: "player-one" }), /対戦相手/u);
  assert.throws(() => start({ kind: "unknown" }), /用途/u);
  assert.throws(() => start({ round: 1 }), /ラウンド/u);
  assert.throws(() => start({ round: 6 }), /ラウンド/u);
  assert.throws(() => start({ mime: "image/gif" }), /形式/u);
  assert.throws(() => start({ size: (15 * 1024 * 1024) + 1 }), /サイズ/u);
  assert.equal(start({ kind: "action", actionType: "request" }).actionType, "request");
  assert.throws(() => start({ kind: "action", actionType: "pursuit" }), /確定内容/u);
  assert.throws(() => start({ kind: "action", actionType: "normal" }), /追加行動/u);
  assert.equal(start({ kind: "weaknessChain", round: 1, actionType: "pursuit" }).round, 1);
  assert.throws(() => start({ kind: "weaknessChain", round: 2, actionType: "pursuit" }), /宣言枚数/u);
  assert.throws(() => start({ kind: "weaknessChain", round: 3, actionType: "pursuit" }), /位置/u);

  state.incomingTransfer = start({ mime: "image/png" });
  state.incomingTransfer.received = 50;
  state.incomingTransfer.chunks.push(new ArrayBuffer(1));
  const restarted = start({ mime: "image/jpeg" });
  assert.equal(restarted.received, 0);
  assert.equal(restarted.chunks.length, 0);
  assert.throws(() => start({ kind: "action", actionType: "request" }), /別の画像/u);
});

test("invalid optional audio is omitted while the Strategy image still completes", async () => {
  const imageKey = namedFunction(strategy, "imageKey");
  const audio = namedFunction(strategy, "getTransferableStrategyAudio");
  const send = namedFunction(strategy, "sendImage");
  const wait = namedFunction(strategy, "waitForDataBuffer");
  const webp = new Blob([
    Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    "image",
  ], { type: "image/webp" });

  function makeHarness(audioBlob, audioDuration, audioCueStart = 0) {
    const sent = [];
    const channel = {
      readyState: "open",
      bufferedAmount: 0,
      send(value) { sent.push(value); },
      addEventListener() {},
      removeEventListener() {},
    };
    const state = {
      uid: "player-one",
      channel,
      sentImageKeys: new Set(),
      transferProgress: 0,
      screen: "baseSelect",
    };
    const context = vm.createContext({
      state,
      Blob,
      STRATEGY_DECK_IMAGE_MAX_BYTES: 15 * 1024 * 1024,
      MAX_AUDIO_TRANSFER_BYTES: 480 * 1024,
      MAX_AUDIO_SECONDS: 10,
      AUDIO_HIGHLIGHT_SECONDS: 3,
      DATA_CHUNK_BYTES: 16 * 1024,
      DATA_BUFFER_LIMIT: 512 * 1024,
      DATA_BUFFER_WAIT_MS: 10,
      normalizeOnlineImageMime: (value) => String(value || "").trim().toLowerCase(),
      verifiedOnlineImageMime: () => "image/webp",
      render() {},
      window: { setTimeout, clearTimeout },
      Error,
      Number,
      Math,
    });
    vm.runInContext(`
      ${imageKey}
      ${audio}
      ${wait}
      ${send}
      globalThis.sendImageForTest = sendImage;
    `, context);
    return {
      context,
      item: { blob: webp, audioBlob, audioDuration, audioCueStart },
      jsonMessages: () => sent.filter((value) => typeof value === "string").map((value) => JSON.parse(value)),
    };
  }

  const invalidCases = [
    [new Blob(["wav"], { type: "audio/wav" }), 99],
    [new Blob([new Uint8Array((480 * 1024) + 1)], { type: "audio/wav" }), 3],
    [new Blob(["not-wav"], { type: "audio/mpeg" }), 3],
    [new Blob(["wav"], { type: "audio/wav" }), Number.NaN],
  ];
  for (const [audioBlob, duration] of invalidCases) {
    const harness = makeHarness(audioBlob, duration);
    await harness.context.sendImageForTest(harness.item, "base", "", 1);
    const messages = harness.jsonMessages();
    assert.equal(messages.find((message) => message.type === "strategy-image-start")?.hasAudio, false);
    assert.ok(messages.some((message) => message.type === "strategy-image-end"));
    assert.equal(messages.some((message) => message.type.startsWith("strategy-audio-")), false);
  }

  const valid = makeHarness(new Blob(["wav"], { type: "audio/wav" }), 4, 9);
  await valid.context.sendImageForTest(valid.item, "base", "", 1);
  const validMessages = valid.jsonMessages();
  assert.equal(validMessages.find((message) => message.type === "strategy-image-start")?.hasAudio, true);
  const audioStart = validMessages.find((message) => message.type === "strategy-audio-start");
  assert.equal(audioStart?.duration, 4);
  assert.equal(audioStart?.cueStart, 1, "cue is clamped to the playable three-second window");
  assert.ok(validMessages.some((message) => message.type === "strategy-audio-end"));
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
  assert.match(persist, /if \(targetState\.deckSavePromise\)[\s\S]*?await pendingSave/u);

  const persistOff = remove.indexOf("targetState.persistDeck = false");
  const deleteAwait = remove.indexOf("await deleteStrategyDeck(targetUid");
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
    DECK_STORAGE_TIMEOUT_MS: 10,
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
