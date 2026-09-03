"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const modulePath = path.join(root, "strategy-deck-storage.mjs");
const moduleUrl = pathToFileURL(modulePath).href;

const IMAGE_SIGNATURES = Object.freeze({
  "image/webp": Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  "image/png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Uint8Array.from([0xff, 0xd8, 0xff]),
});

function makeImageBlob(payload, type = "image/webp", { signatureType = type } = {}) {
  const signature = IMAGE_SIGNATURES[signatureType] || Uint8Array.from([0x47, 0x49, 0x46]);
  return new Blob([signature, payload], { type });
}

function makeCard(index, { audio = false, mime = "image/webp" } = {}) {
  return {
    id: `runtime-card-${index}`,
    blob: makeImageBlob(`${mime}-${index}`, mime),
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
  const signatureLength = IMAGE_SIGNATURES[blob.type]?.byteLength || 0;
  return Buffer.from(await blob.arrayBuffer()).subarray(signatureLength).toString("utf8");
}

function createMemoryIndexedDB() {
  const stores = new Map();
  const operationGates = {
    open: [],
    put: [],
    get: [],
    delete: [],
  };
  const state = {
    failNextPut: false,
    putCalls: 0,
    getCalls: 0,
    deleteCalls: 0,
    abortCalls: 0,
    closeCalls: 0,
    createStoreCalls: 0,
    operationLog: [],
  };

  function waitForOperationGate(kind) {
    return operationGates[kind].shift() || Promise.resolve();
  }

  function transactionFor(storeName) {
    if (!stores.has(storeName)) throw new Error(`Missing object store: ${storeName}`);
    let aborted = false;
    const transaction = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort() {
        if (aborted) return;
        aborted = true;
        state.abortCalls += 1;
        queueMicrotask(() => transaction.onabort?.({ target: transaction }));
      },
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
              if (aborted) return;
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
              if (aborted) return;
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
              if (aborted) return;
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
        waitForOperationGate("open").then(() => {
          const needsUpgrade = stores.size === 0;
          request.result = {
            objectStoreNames: {
              contains: (name) => stores.has(name),
            },
            createObjectStore(name) {
              if (stores.has(name)) throw new Error(`Duplicate object store: ${name}`);
              state.createStoreCalls += 1;
              stores.set(name, new Map());
              return {};
            },
            transaction: transactionFor,
            close() { state.closeCalls += 1; },
          };
          if (needsUpgrade) request.onupgradeneeded?.({ target: request });
          queueMicrotask(() => request.onsuccess?.({ target: request }));
        });
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

test("a playable strategy deck is exactly five main and five reserve safe images", async () => {
  const storage = await import(moduleUrl);
  const deck = makeDeck();

  assert.equal(storage.STRATEGY_DECK_MAIN_COUNT, 5);
  assert.equal(storage.STRATEGY_DECK_RESERVE_COUNT, 5);
  assert.deepEqual(storage.STRATEGY_DECK_IMAGE_MIME_TYPES, ["image/webp", "image/png", "image/jpeg"]);
  assert.equal(storage.hasPlayableStrategyDeck(deck.main, deck.reserve), true);
  assert.equal(storage.hasPersistableStrategyDeck(deck.main, deck.reserve), true);
  assert.equal(storage.hasCompleteStrategyDeck(deck.main, deck.reserve), true);
  assert.equal(storage.hasPlayableStrategyDeck(deck.main.slice(0, 4), deck.reserve), false);
  assert.equal(storage.hasPlayableStrategyDeck(deck.main, deck.reserve.slice(0, 4)), false);
  assert.equal(storage.hasPlayableStrategyDeck([...deck.main, makeCard(20)], deck.reserve), false);
});

test("WebP, PNG, and JPEG decks are playable and persistable without a schema change", async () => {
  const storage = await import(moduleUrl);
  for (const mime of storage.STRATEGY_DECK_IMAGE_MIME_TYPES) {
    const deck = {
      main: Array.from({ length: 5 }, (_, index) => makeCard(index, { mime })),
      reserve: Array.from({ length: 5 }, (_, index) => makeCard(index + 5, { mime })),
    };
    assert.equal(storage.hasPlayableStrategyDeck(deck.main, deck.reserve), true, `${mime} is playable`);
    assert.equal(storage.hasPersistableStrategyDeck(deck.main, deck.reserve), true, `${mime} is persistable`);
    assert.equal(storage.serializeStrategyDeck({ uid: "player", ...deck, updatedAt: 100 }).schemaVersion, 1);
  }
});

test("play readiness stays independent from optional audio persistence metadata", async () => {
  const storage = await import(moduleUrl);
  const deck = makeDeck();
  deck.main[0].audioDuration = 99;

  assert.equal(storage.hasPlayableStrategyDeck(deck.main, deck.reserve), true);
  assert.equal(storage.hasPersistableStrategyDeck(deck.main, deck.reserve), false);
});

test("play readiness enforces the per-image and 64MB aggregate hard ceilings", async () => {
  const storage = await import(moduleUrl);
  const deck = makeDeck();
  const sevenMegabyteImage = makeImageBlob(
    new Uint8Array((7 * 1024 * 1024) - IMAGE_SIGNATURES["image/webp"].byteLength),
  );
  for (const card of [...deck.main, ...deck.reserve]) card.blob = sevenMegabyteImage;

  assert.ok(sevenMegabyteImage.size < storage.STRATEGY_DECK_IMAGE_MAX_BYTES);
  assert.equal(storage.hasPlayableStrategyDeck(deck.main, deck.reserve), false);
  assert.equal(storage.hasPersistableStrategyDeck(deck.main, deck.reserve), false);
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

test("sample cards and unsupported image or audio payloads cannot be saved", async () => {
  const storage = await import(moduleUrl);

  const sampleDeck = makeDeck();
  sampleDeck.reserve[3].isSample = true;
  assert.equal(storage.hasPlayableStrategyDeck(sampleDeck.main, sampleDeck.reserve), false);
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...sampleDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /サンプル/u.test(error.message),
  );

  const gifDeck = makeDeck();
  gifDeck.main[2].blob = makeImageBlob("gif", "image/gif");
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...gifDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /WebP・PNG・JPEG/u.test(error.message),
  );

  const emptyDeck = makeDeck();
  emptyDeck.reserve[1].blob = new Blob([], { type: "image/png" });
  assert.equal(storage.hasPlayableStrategyDeck(emptyDeck.main, emptyDeck.reserve), false);

  const fakeDeck = makeDeck();
  fakeDeck.reserve[1].blob = { type: "image/png", size: 100 };
  assert.equal(storage.hasPlayableStrategyDeck(fakeDeck.main, fakeDeck.reserve), false);

  const longAudioDeck = makeDeck();
  longAudioDeck.main[0].audioDuration = 10.01;
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...longAudioDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /10秒以内/u.test(error.message),
  );

  const largeAudioDeck = makeDeck();
  largeAudioDeck.main[0].audioBlob = new Blob(
    [new Uint8Array(storage.STRATEGY_DECK_AUDIO_MAX_BYTES + 1)],
    { type: "audio/wav" },
  );
  assert.throws(
    () => storage.serializeStrategyDeck({ uid: "player", ...largeAudioDeck, updatedAt: 100 }),
    (error) => error?.code === "invalid-deck" && /480KB以下/u.test(error.message),
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

test("PNG and JPEG canvas fallbacks round-trip through schema v1 storage", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const deck = {
    main: Array.from({ length: 5 }, (_, index) => makeCard(index, { mime: "image/png" })),
    reserve: Array.from({ length: 5 }, (_, index) => makeCard(index + 5, { mime: "image/jpeg" })),
  };

  await storage.saveStrategyDeck(
    { uid: "ios-player", ...deck },
    { indexedDB: memory.indexedDB, now: 1_000 },
  );
  const loaded = await storage.loadStrategyDeck("ios-player", { indexedDB: memory.indexedDB });

  assert.equal(loaded.schemaVersion, 1);
  assert.deepEqual(loaded.main.map((card) => card.blob.type), Array(5).fill("image/png"));
  assert.deepEqual(loaded.reserve.map((card) => card.blob.type), Array(5).fill("image/jpeg"));
});

test("a legacy raw schema-v1 WebP record still loads unchanged", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const legacyCard = (index) => ({
    blob: makeImageBlob(`legacy-${index}`, "image/webp"),
    audioBlob: null,
    audioDuration: 0,
    audioCueStart: 0,
    audioName: "",
  });
  memory.rawSet(storage.STRATEGY_DECK_STORE_NAME, "legacy-player", {
    schemaVersion: 1,
    uid: "legacy-player",
    main: Array.from({ length: 5 }, (_, index) => legacyCard(index)),
    reserve: Array.from({ length: 5 }, (_, index) => legacyCard(index + 5)),
    updatedAt: 777,
  });

  const loaded = await storage.loadStrategyDeck("legacy-player", { indexedDB: memory.indexedDB });
  assert.equal(loaded.schemaVersion, 1);
  assert.equal(loaded.updatedAt, 777);
  assert.deepEqual(loaded.main.map((card) => card.blob.type), Array(5).fill("image/webp"));
});

test("save and load reject a safe declared MIME whose bytes use another format", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const mismatchedDeck = makeDeck();
  mismatchedDeck.main[0].blob = makeImageBlob("mismatch", "image/png", { signatureType: "image/webp" });

  assert.equal(storage.hasPlayableStrategyDeck(mismatchedDeck.main, mismatchedDeck.reserve), true);
  await assert.rejects(
    storage.saveStrategyDeck(
      { uid: "mismatch-player", ...mismatchedDeck },
      { indexedDB: memory.indexedDB, now: 100 },
    ),
    (error) => error?.code === "invalid-deck" && /一致/u.test(error.message),
  );

  const corruptRecord = storage.serializeStrategyDeck({
    uid: "mismatch-player",
    ...makeDeck(),
    updatedAt: 200,
  });
  corruptRecord.reserve[0].blob = makeImageBlob("mismatch", "image/jpeg", { signatureType: "image/png" });
  memory.rawSet(storage.STRATEGY_DECK_STORE_NAME, "mismatch-player", corruptRecord);
  assert.equal(await storage.loadStrategyDeck("mismatch-player", { indexedDB: memory.indexedDB }), null);
});

test("a failed replacement leaves the previously completed deck intact", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const originalDeck = makeDeck();
  const replacementDeck = makeDeck();
  replacementDeck.main[0].blob = makeImageBlob("replacement");

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
  queuedDeck.main[0].blob = makeImageBlob("queued-snapshot");

  const firstSave = storage.saveStrategyDeck(
    { uid: "snapshot-player", ...firstDeck },
    { indexedDB: memory.indexedDB, now: 100 },
  );
  const queuedSave = storage.saveStrategyDeck(
    { uid: "snapshot-player", ...queuedDeck },
    { indexedDB: memory.indexedDB, now: 200 },
  );

  queuedDeck.main[0].blob = makeImageBlob("edited-after-call");
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
  replacement.reserve[0].blob = makeImageBlob("latest-deck");
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
  deck.main[2].blob = makeImageBlob("committed-before-load");

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
  latestDeck.main[4].blob = makeImageBlob("saved-after-failure");

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

test("a blocked database open times out and closes a late connection", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releaseOpen = memory.blockNext("open");

  await assert.rejects(
    storage.saveStrategyDeck(
      { uid: "open-timeout-player", ...makeDeck() },
      { indexedDB: memory.indexedDB, now: 100, timeoutMs: 20 },
    ),
    (error) => error?.code === "storage-timeout",
  );
  releaseOpen();
  await nextEventLoopTurn();
  await nextEventLoopTurn();
  assert.equal(memory.state.createStoreCalls, 0, "a timed-out open cannot perform a late schema upgrade");
  assert.equal(memory.state.closeCalls, 1);
});

test("a stalled Blob header read times out and releases the UID queue", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  class HangingHeaderBlob extends Blob {
    slice() {
      return { arrayBuffer: () => new Promise(() => {}) };
    }
  }
  const deck = makeDeck();
  deck.main[0].blob = new HangingHeaderBlob([IMAGE_SIGNATURES["image/webp"], "hang"], { type: "image/webp" });

  await assert.rejects(
    storage.saveStrategyDeck(
      { uid: "header-timeout-player", ...deck },
      { indexedDB: memory.indexedDB, now: 100, timeoutMs: 20 },
    ),
    (error) => error?.code === "storage-timeout",
  );
  await storage.deleteStrategyDeck(
    "header-timeout-player",
    { indexedDB: memory.indexedDB, timeoutMs: 100 },
  );
  assert.deepEqual(memory.state.operationLog, ["delete:header-timeout-player"]);
});

test("a queued operation whose single deadline expires never starts later", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releasePut = memory.blockNext("put");
  const first = storage.saveStrategyDeck(
    { uid: "queue-deadline-player", ...makeDeck() },
    { indexedDB: memory.indexedDB, now: 100, timeoutMs: 35 },
  );
  const expiredFollower = storage.saveStrategyDeck(
    { uid: "queue-deadline-player", ...makeDeck() },
    { indexedDB: memory.indexedDB, now: 200, timeoutMs: 10 },
  );

  await assert.rejects(first, (error) => error?.code === "storage-timeout");
  await assert.rejects(expiredFollower, (error) => error?.code === "storage-timeout");
  assert.equal(memory.state.putCalls, 1, "the expired queued save never opens a transaction");
  releasePut();
  await nextEventLoopTurn();
});

test("a blocked transaction aborts on timeout and does not poison the UID queue", async () => {
  const storage = await import(moduleUrl);
  const memory = createMemoryIndexedDB();
  const releasePut = memory.blockNext("put");

  await assert.rejects(
    storage.saveStrategyDeck(
      { uid: "transaction-timeout-player", ...makeDeck() },
      { indexedDB: memory.indexedDB, now: 100, timeoutMs: 20 },
    ),
    (error) => error?.code === "storage-timeout",
  );
  assert.equal(memory.state.abortCalls, 1);
  releasePut();
  await nextEventLoopTurn();

  const replacement = makeDeck();
  replacement.main[0].blob = makeImageBlob("saved-after-timeout");
  await storage.saveStrategyDeck(
    { uid: "transaction-timeout-player", ...replacement },
    { indexedDB: memory.indexedDB, now: 200, timeoutMs: 100 },
  );
  const loaded = await storage.loadStrategyDeck(
    "transaction-timeout-player",
    { indexedDB: memory.indexedDB, timeoutMs: 100 },
  );
  assert.equal(loaded.updatedAt, 200);
  assert.equal(await blobText(loaded.main[0].blob), "saved-after-timeout");
});
