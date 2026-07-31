"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  "..",
  "..",
  "training-v6-store.mjs",
)).href;

class FakeTransaction extends EventTarget {
  constructor(owner, mode) {
    super();
    this.owner = owner;
    this.mode = mode;
    this.error = null;
  }

  objectStore() {
    return {
      get: (uid) => this.#request({
        result: this.owner.records.get(uid),
      }),
      put: (record) => this.#request({
        result: record.uid,
        commit: () => this.owner.records.set(record.uid, record),
        write: true,
      }),
      delete: (uid) => this.#request({
        result: undefined,
        commit: () => this.owner.records.delete(uid),
        write: true,
      }),
    };
  }

  #request({
    result,
    commit = () => {},
    write = false,
  }) {
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      request.result = result;
      request.onsuccess?.({ target: request });
      setTimeout(() => {
        if (write && this.owner.abortNextWrite) {
          this.owner.abortNextWrite = false;
          this.error = new Error("forced transaction abort");
          this.dispatchEvent(new Event("abort"));
          return;
        }
        commit();
        this.dispatchEvent(new Event("complete"));
      }, 0);
    });
    return request;
  }
}

class FakeDatabase {
  constructor(owner) {
    this.owner = owner;
    this.objectStoreNames = {
      contains: () => owner.storeCreated,
    };
  }

  createObjectStore() {
    this.owner.storeCreated = true;
  }

  transaction(_storeName, mode) {
    return new FakeTransaction(this.owner, mode);
  }

  close() {
    this.owner.closeCount += 1;
  }
}

class FakeIndexedDb {
  constructor() {
    this.records = new Map();
    this.storeCreated = false;
    this.upgraded = false;
    this.abortNextWrite = false;
    this.closeCount = 0;
    this.database = new FakeDatabase(this);
  }

  open() {
    const request = {
      result: null,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      request.result = this.database;
      if (!this.upgraded) {
        this.upgraded = true;
        request.onupgradeneeded?.({ target: request });
      }
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

function imageDeck() {
  return Array.from({ length: 5 }, (_, index) => new Blob(
    [`image-${index + 1}`],
    { type: "image/webp" },
  ));
}

test("Training V6 local store waits for transaction commit", async () => {
  const { createTrainingV6LocalStore } = await import(moduleUrl);
  const indexedDb = new FakeIndexedDb();
  const store = createTrainingV6LocalStore({
    indexedDb,
    now: () => 10_000,
  });
  indexedDb.abortNextWrite = true;

  await assert.rejects(
    store.save({
      uid: "player-alpha",
      name: "ALPHA",
      safety: { maxBpm: 100 },
      images: imageDeck(),
    }),
    /forced transaction abort/,
  );
  assert.equal(indexedDb.records.has("player-alpha"), false);
});

test("Training V6 local store physically deletes expired image decks", async () => {
  const { createTrainingV6LocalStore } = await import(moduleUrl);
  const indexedDb = new FakeIndexedDb();
  let currentTime = 20_000;
  const store = createTrainingV6LocalStore({
    indexedDb,
    now: () => currentTime,
  });

  await store.save({
    uid: "player-bravo",
    name: "BRAVO",
    safety: { maxBpm: 80 },
    images: imageDeck(),
  });
  assert.equal((await store.load("player-bravo")).images.length, 5);

  currentTime += 25 * 60 * 60 * 1_000;
  assert.equal(await store.load("player-bravo"), null);
  assert.equal(indexedDb.records.has("player-bravo"), false);
});

test("Training V6 local store removes malformed Blob records", async () => {
  const { createTrainingV6LocalStore } = await import(moduleUrl);
  const indexedDb = new FakeIndexedDb();
  const store = createTrainingV6LocalStore({
    indexedDb,
    now: () => 30_000,
  });
  indexedDb.records.set("player-charlie", {
    uid: "player-charlie",
    updatedAt: 30_000,
    images: [new Blob(["only-one"], { type: "image/webp" })],
  });

  assert.equal(await store.load("player-charlie"), null);
  assert.equal(indexedDb.records.has("player-charlie"), false);
});
