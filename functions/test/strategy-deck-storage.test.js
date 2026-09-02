"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const modulePath = path.join(root, "strategy-deck-storage.mjs");
const moduleUrl = pathToFileURL(modulePath).href;

function makeCard(index, { audio = false } = {}) {
  return {
    id: `runtime-card-${index}`,
    blob: new Blob([`webp-${index}`], { type: "image/webp" }),
    url: `blob:runtime-card-${index}`,
    position: index,
    used: index % 2 === 0,
    isSample: false,
    roomId: "must-not-be-persisted",
    room: { id: "must-not-be-persisted" },
    ...(audio ? {
      audioBlob: new Blob([`wav-${index}`], { type: "audio/wav" }),
      audioDuration: 4.5,
      audioCueStart: 1.5,
      audioName: "  opening hit.wav  ",
      audioUrl: `blob:runtime-audio-${index}`,
    } : {}),
  };
}

function makeDeck() {
  return {
    main: Array.from({ length: 5 }, (_, index) => makeCard(index, { audio: index === 0 })),
    reserve: Array.from({ length: 5 }, (_, index) => makeCard(index + 5, { audio: index === 4 })),
  };
}

function cloneForStorage(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nextEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function blobText(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString("utf8");
}

function createMemoryIndexedDB() {
  const stores = new Map();
  const operationGates = {
    put: [],
    get: [],
    delete: [],
  };
  const state = {
    failNextPut: false,
    putCalls: 0,
    getCalls: 0,
    deleteCalls: 0,
    operationLog: [],
  };

  function waitForOperationGate(kind) {
    return operationGates[kind].shift() || Promise.resolve();
  }

  function transactionFor(storeName) {
    if (!stores.has(storeName)) throw new Error(`Missing object store: ${storeName}`);
    const transaction = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore(requestedName) {
        if (requestedName !== storeName) throw new Error(`Unexpected object store: ${requestedName}`);
        const records = stores.get(storeName);
        return {
          put(value, key) {
            state.putCalls += 1;
            state.operationLog.push(`put:${key}`);
            const request = { error: null, result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(async () => {
              await waitForOperationGate("put");
              if (state.failNextPut) {
                state.failNextPut = false;
                const error = new Error("Simulated quota failure");
                request.error = error;
                transaction.error = error;
                request.onerror?.({ target: request });
                queueMicrotask(() => transaction.onabort?.({ target: transaction }));
                return;
              }
              const nextValue = cloneForStorage(value);
              request.result = key;
              request.onsuccess?.({ target: request });
              queueMicrotask(() => {
                records.set(key, nextValue);
                transaction.oncomplete?.({ target: transaction });
              });
            });
            return request;
          },
          get(key) {
            state.getCalls += 1;
            state.operationLog.push(`get:${key}`);
            const request = { error: null, result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(async () => {
              await waitForOperationGate("get");
              request.result = cloneForStorage(records.get(key));
              request.onsuccess?.({ target: request });
              queueMicrotask(() => transaction.oncomplete?.({ target: transaction }));
            });
            return request;
          },
          delete(key) {
            state.deleteCalls += 1;
            state.operationLog.push(`delete:${key}`);
            const request = { error: null, result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(async () => {
              await waitForOperationGate("delete");
              request.onsuccess?.({ target: request });
              queueMicrotask(() => {
                records.delete(key);
                transaction.oncomplete?.({ target: transaction });
              });
            });
            return request;
          },
        };
      },
    };
    return transaction;
  }

  const indexedDB = {
    open() {
      const request = {
        error: null,
        result: null,
        transaction: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        const needsUpgrade = stores.size === 0;
        request.result = {
          objectStoreNames: {
            contains: (name) => stores.has(name),
          },
          createObjectStore(name) {
            if (stores.has(name)) throw new Error(`Duplicate object store: ${name}`);
            stores.set(name, new Map());
            return {};
          },
          transaction: transactionFor,
          close() {},
        };
        if (needsUpgrade) request.onupgradeneeded?.({ target: request });
        queueMicrotask(() => request.onsuccess?.({ target: request }));
      });
      return request;
    },
  };

  return {
    indexedDB,
    state,
    blockNext(kind) {
      if (!(kind in operationGates)) throw new Error(`Unknown operation: ${kind}`);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      operationGates[kind].push(gate);
      return release;
    },
    rawSet(storeName, key, value) {
      if (!stores.has(storeName)) stores.set(storeName, new Map());
      stores.get(storeName).set(key, cloneForStorage(value));
    },
  };
}

test("a strategy deck is exactly five main and five reserve cards", async () => {
  const storage = await import(moduleUrl);
  const deck = makeDeck();

  assert.equal(storage.STRATEGY_DECK_MAIN_COUNT, 5);
  assert.equal(storage.STRATEGY_DECK_RESERVE_COUNT, 5);
  assert.equal(storage.hasCompleteStrategyDeck(deck.main, deck.reserve), true);
  assert.equal(storage.hasCompleteStrategyDeck(deck.main.slice(0, 4), deck.reserve), false);
  assert.equal(storage.hasCompleteStrategyDeck(deck.main, deck.reserve.slice(0, 4)), false);
  assert.equal(storage.hasCompleteStrategyDeck([...deck.main, makeCard(20)], deck.reserve), false);
});

test("serialization whitelists reusable media and drops match-local state", async () => {
  const storage = await import(moduleUrl);
  const deck = makeDeck();
  const record = storage.serializeStrategyDeck({
    uid: "player-one",
    ...deck,
    updatedAt: 1_777_777_777_777,
  });

  assert.deepEqual(Object.keys(record), ["schemaVersion", "uid", "main", "reserve", "updatedAt"]);
  assert.deepEqual(
    Object.keys(record.main[0]),
    ["blob", "audioBlob", "audioDuration", "audioCueStart", "audioName"],
  );
  assert.equal(record.main[0].blob, deck.main[0].blob);
  assert.equal(record.main[0].audioBlob, deck.main[0].audioBlob);
  assert.equal(record.main[0].audioDuration, 4.5);
  assert.equal(record.main[0].audioCueStart, 1.5);
  assert.equal(record.main[0].audioName, "opening hit.wav");
  assert.deepEqual(record.main[1], {
    blob: deck.main[1].blob,
    audioBlob: null,
    audioDuration: 0,
    audioCueStart: 0,
    audioName: "",
  });
  for (const card of [...record.main, ...record.reserve]) {
    assert.equal("id" in card, false);
    assert.equal("url" in card, false);
    assert.equal("audioUrl" in card, false);
    assert.equal("position" in card, false);
    assert.equal("used" in card, false);
    assert.equal("isSample" in card, false);
    assert.equal("roomId" in card, false);
    assert.equal("room" in card, false);
  }
});

test("sample cards and invalid image or audio payloads cannot be saved", async () => {
  const storage = await import(moduleUrl);

  const sampleDeck = makeDeck();
  sampleDeck.reserve[3].isSample = true;
  assert.equal(storage.hasCompleteStrategyDeck(sampleDeck.main, sampleDeck.reserve), false);
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...sampleDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /サンプル/u.test(error.message),
  );

  const pngDeck = makeDeck();
  pngDeck.main[2].blob = new Blob(["png"], { type: "image/png" });
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...pngDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /WebP/u.test(error.message),
  );

  const longAudioDeck = makeDeck();
  longAudioDeck.main[0].audioDuration = 10.01;
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...longAudioDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /10秒以内/u.test(error.message),
  );

  const badCueDeck = makeDeck();
  badCueDeck.main[0].audioCueStart = 1.6;
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...badCueDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /範囲外/u.test(error.message),
  );

  const staleAudioDeck = makeDeck();
  staleAudioDeck.main[1].audioDuration = 2;
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...staleAudioDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /一致/u.test(error.message),
  );
});

test("normalization refuses corrupt, stale-schema, partial, and wrong-user records", async () => {
  const storage = await import(moduleUrl);
  const record = storage.serializeStrategyDeck({
    uid: "player-one",
    ...makeDeck(),
    updatedAt: 500,
  });

  const normalized = storage.normalizeStrategyDeckRecord(record, { expectedUid: "player-one" });
  assert.ok(normalized);
  assert.notEqual(normalized.main, record.main);
  assert.equal(normalized.main[0].blob, record.main[0].blob);
  assert.equal(storage.normalizeStrategyDeckRecord(record, { expectedUid: "player-two" }), null);
  assert.equal(storage.normalizeStrategyDeckRecord({ ...record, schemaVersion: 2 }), null);
  assert.equal(storage.normalizeStrategyDeckRecord({ ...record, main: record.main.slice(0, 4) }), null);
  assert.equal(storage.normalizeStrategyDeckRecord({ ...record, updatedAt: 0 }), null);

  const corruptAudio = structuredClone(record);
  corruptAudio.reserve[4].audioCueStart = 99;
  assert.equal(storage.normalizeStrategyDeckRecord(corruptAudio, { expectedUid: "player-one" }), null);

  const corruptBlob = structuredClone(record);
  corruptBlob.main[1].blob = { type: "image/webp", size: 100 };
  assert.equal(storage.normalizeStrategyDeckRecord(corruptBlob, { expectedUid: "player-one" }), null);
});

test("save and load use one atomic put per UID, and delete is UID-scoped", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const firstDeck = makeDeck();
  const secondDeck = makeDeck();

  await storage.saveStrategyDeck(
    { uid: "player-one", ...firstDeck },
    { indexedDB: memory.indexedDB, now: () => 1_000 },
  );
  await storage.saveStrategyDeck(
    { uid: "player-two", ...secondDeck },
    { indexedDB: memory.indexedDB, now: () => 2_000 },
  );

  assert.equal(memory.state.putCalls, 2);
  const first = await storage.loadStrategyDeck("player-one", { indexedDB: memory.indexedDB });
  const second = await storage.loadStrategyDeck("player-two", { indexedDB: memory.indexedDB });
  assert.equal(first.uid, "player-one");
  assert.equal(first.updatedAt, 1_000);
  assert.equal(first.main.length, 5);
  assert.equal(first.reserve.length, 5);
  assert.equal(second.uid, "player-two");
  assert.equal(second.updatedAt, 2_000);

  await storage.deleteStrategyDeck("player-one", { indexedDB: memory.indexedDB });
  assert.equal(await storage.loadStrategyDeck("player-one", { indexedDB: memory.indexedDB }), null);
  assert.equal((await storage.loadStrategyDeck("player-two", { indexedDB: memory.indexedDB })).uid, "player-two");
});

test("a failed replacement leaves the previously completed deck intact", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const originalDeck = makeDeck();
  const replacementDeck = makeDeck();
  replacementDeck.main[0].blob = new Blob(["replacement"], { type: "image/webp" });

  await storage.saveStrategyDeck(
    { uid: "player-one", ...originalDeck },
    { indexedDB: memory.indexedDB, now: 100 },
  );
  const original = await storage.loadStrategyDeck("player-one", { indexedDB: memory.indexedDB });
  memory.state.failNextPut = true;

  await assert.rejects(
    storage.saveStrategyDeck(
      { uid: "player-one", ...replacementDeck },
      { indexedDB: memory.indexedDB, now: 200 },
    ),
    (error) => error?.code === "storage-write-failed",
  );

  const afterFailure = await storage.loadStrategyDeck("player-one", { indexedDB: memory.indexedDB });
  assert.equal(afterFailure.updatedAt, 100);
  assert.deepEqual(
    Buffer.from(await afterFailure.main[0].blob.arrayBuffer()),
    Buffer.from(await original.main[0].blob.arrayBuffer()),
  );
});

test("a queued save snapshots the deck before waiting for an older mutation", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releaseFirstPut = memory.blockNext("put");
  const firstDeck = makeDeck();
  const queuedDeck = makeDeck();
  queuedDeck.main[0].blob = new Blob(["queued-snapshot"], { type: "image/webp" });

  const firstSave = storage.saveStrategyDeck(
    { uid: "snapshot-player", ...firstDeck },
    { indexedDB: memory.indexedDB, now: 100 },
  );
  const queuedSave = storage.saveStrategyDeck(
    { uid: "snapshot-player", ...queuedDeck },
    { indexedDB: memory.indexedDB, now: 200 },
  );

  queuedDeck.main[0].blob = new Blob(["edited-after-call"], { type: "image/webp" });
  queuedDeck.main.length = 0;
  releaseFirstPut();
  await Promise.all([firstSave, queuedSave]);

  const loaded = await storage.loadStrategyDeck("snapshot-player", { indexedDB: memory.indexedDB });
  assert.equal(loaded.updatedAt, 200);
  assert.equal(await blobText(loaded.main[0].blob), "queued-snapshot");
  assert.equal(loaded.main.length, 5);
});

test("save followed by delete is serialized so the newer deletion wins", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releaseSave = memory.blockNext("put");

  const saving = storage.saveStrategyDeck(
    { uid: "save-delete-player", ...makeDeck() },
    { indexedDB: memory.indexedDB, now: 100 },
  );
  const deleting = storage.deleteStrategyDeck("save-delete-player", { indexedDB: memory.indexedDB });

  await nextEventLoopTurn();
  assert.deepEqual(memory.state.operationLog, ["put:save-delete-player"]);
  releaseSave();
  await Promise.all([saving, deleting]);

  assert.deepEqual(
    memory.state.operationLog.slice(0, 2),
    ["put:save-delete-player", "delete:save-delete-player"],
  );
  assert.equal(
    await storage.loadStrategyDeck("save-delete-player", { indexedDB: memory.indexedDB }),
    null,
  );
});

test("delete followed by save is serialized so the newer completed deck wins", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  await storage.saveStrategyDeck(
    { uid: "delete-save-player", ...makeDeck() },
    { indexedDB: memory.indexedDB, now: 100 },
  );

  const releaseDelete = memory.blockNext("delete");
  const deleting = storage.deleteStrategyDeck("delete-save-player", { indexedDB: memory.indexedDB });
  const replacement = makeDeck();
  replacement.reserve[0].blob = new Blob(["latest-deck"], { type: "image/webp" });
  const saving = storage.saveStrategyDeck(
    { uid: "delete-save-player", ...replacement },
    { indexedDB: memory.indexedDB, now: 200 },
  );

  await nextEventLoopTurn();
  assert.equal(memory.state.operationLog.at(-1), "delete:delete-save-player");
  assert.equal(memory.state.putCalls, 1);
  releaseDelete();
  await Promise.all([deleting, saving]);

  assert.deepEqual(
    memory.state.operationLog.slice(1, 3),
    ["delete:delete-save-player", "put:delete-save-player"],
  );
  const loaded = await storage.loadStrategyDeck("delete-save-player", { indexedDB: memory.indexedDB });
  assert.equal(loaded.updatedAt, 200);
  assert.equal(await blobText(loaded.reserve[0].blob), "latest-deck");
});

test("load waits for an already invoked save and reads its completed value", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releaseSave = memory.blockNext("put");
  const deck = makeDeck();
  deck.main[2].blob = new Blob(["committed-before-load"], { type: "image/webp" });

  const saving = storage.saveStrategyDeck(
    { uid: "load-barrier-player", ...deck },
    { indexedDB: memory.indexedDB, now: 300 },
  );
  const loading = storage.loadStrategyDeck("load-barrier-player", { indexedDB: memory.indexedDB });
  let loadSettled = false;
  loading.then(
    () => { loadSettled = true; },
    () => { loadSettled = true; },
  );

  await nextEventLoopTurn();
  assert.equal(loadSettled, false);
  assert.equal(memory.state.getCalls, 0);
  releaseSave();
  await saving;
  const loaded = await loading;

  assert.equal(loaded.updatedAt, 300);
  assert.equal(await blobText(loaded.main[2].blob), "committed-before-load");
  assert.deepEqual(
    memory.state.operationLog,
    ["put:load-barrier-player", "get:load-barrier-player"],
  );
});

test("a failed mutation does not poison later operations for the same UID", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  memory.state.failNextPut = true;
  const failedDeck = makeDeck();
  const latestDeck = makeDeck();
  latestDeck.main[4].blob = new Blob(["saved-after-failure"], { type: "image/webp" });

  const failedSave = storage.saveStrategyDeck(
    { uid: "failure-queue-player", ...failedDeck },
    { indexedDB: memory.indexedDB, now: 100 },
  );
  const latestSave = storage.saveStrategyDeck(
    { uid: "failure-queue-player", ...latestDeck },
    { indexedDB: memory.indexedDB, now: 200 },
  );

  await assert.rejects(failedSave, (error) => error?.code === "storage-write-failed");
  await latestSave;
  const loaded = await storage.loadStrategyDeck("failure-queue-player", { indexedDB: memory.indexedDB });
  assert.equal(loaded.updatedAt, 200);
  assert.equal(await blobText(loaded.main[4].blob), "saved-after-failure");
  assert.deepEqual(
    memory.state.operationLog,
    [
      "put:failure-queue-player",
      "put:failure-queue-player",
      "get:failure-queue-player",
    ],
  );
});

test("load returns null for a corrupt raw record and never creates object URLs", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const record = storage.serializeStrategyDeck({
    uid: "player-one",
    ...makeDeck(),
    updatedAt: 500,
  });
  memory.rawSet(storage.STRATEGY_DECK_STORE_NAME, "player-one", {
    ...record,
    reserve: record.reserve.slice(0, 4),
  });

  assert.equal(await storage.loadStrategyDeck("player-one", { indexedDB: memory.indexedDB }), null);
  const source = fs.readFileSync(modulePath, "utf8");
  assert.doesNotMatch(source, /URL\.createObjectURL/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|firebase/iu);
});

test("storage availability and UID errors are explicit", async () => {
  const storage = await import(moduleUrl);
  await assert.rejects(
    storage.loadStrategyDeck("player-one", { indexedDB: null }),
    (error) => error?.code === "storage-unavailable",
  );
  await assert.rejects(
    storage.loadStrategyDeck("", { indexedDB: createMemoryIndexedDB().indexedDB }),
    (error) => error?.code === "invalid-uid",
  );
});
