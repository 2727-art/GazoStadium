"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const test = require("node:test");
const { createFreeTableService, normalizeCard } = require("../free-table");

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function memoryStorage() {
  const tree = {};
  const read = (key) => structuredClone(key.split("/").filter(Boolean)
    .reduce((value, part) => value?.[part], tree) ?? null);
  const write = (key, value) => {
    const parts = key.split("/").filter(Boolean);
    let parent = tree;
    for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
    if (value == null) delete parent[parts.at(-1)];
    else parent[parts.at(-1)] = structuredClone(value);
  };
  const snapshot = (key) => {
    const value = read(key);
    return { exists: value !== null, data: () => structuredClone(value),
      docs: Object.entries(value || {}).map(([id, item]) => ({ id, data: () => structuredClone(item) })),
      get: (field) => value?.[field], val: () => structuredClone(value) };
  };
  const reference = (key) => ({
    path: key, id: key.split("/").at(-1),
    doc: (id) => reference(`${key}/${id}`), collection: (name) => reference(`${key}/${name}`),
    limit: () => reference(key), where: () => reference(key), orderBy: () => reference(key),
    get: async () => snapshot(key), remove: async () => write(key, null),
    transaction: async (callback) => {
      const result = callback(read(key));
      if (result !== undefined) write(key, result);
      const currentSnapshot = snapshot(key);
      return { committed: result !== undefined, snapshot: { ...currentSnapshot, exists: () => currentSnapshot.exists } };
    },
  });
  const transaction = {
    get: async (ref) => snapshot(ref.path),
    set: (ref, value, options) => write(ref.path, options?.merge ? { ...read(ref.path), ...value } : value),
    update: (ref, value) => write(ref.path, { ...read(ref.path), ...value }),
    delete: (ref) => write(ref.path, null),
  };
  return { read, write, reference,
    firestore: { collection: reference, getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
      runTransaction: async (callback) => callback(transaction) },
    realtime: { ref: reference },
  };
}

function freeFixture() {
  const store = memoryStorage();
  const service = createFreeTableService({ firestore: store.firestore, realtime: store.realtime,
    HttpsError: FakeHttpsError, Timestamp: { fromMillis: (value) => value },
    playerSafety: {}, now: () => 2_000_000_000_000 });
  return { ...store, service };
}

test("free-table inbox response omits blocked and unmappable pending visitors using canonical ownership", async () => {
  const fixture = memoryStorage();
  const roomId = "r".repeat(24);
  const roomPublicId = "s".repeat(24);
  const expiresAt = 2_000_000_050_000;
  fixture.write("freeTableProfiles/A", { publicMemberId: "a".repeat(24), publicRoomId: roomPublicId });
  fixture.write("freeTables/hostActive/A", { state: "open", roomId, publicRoomId: roomPublicId, expiresAt });
  const requests = {};
  const privateRequests = {};
  for (const [letter, visitorUid] of [["b", "B"], ["c", "C"], ["d", ""]]) {
    const requestId = letter.repeat(24);
    requests[requestId] = { requestId, publicMemberId: letter.toUpperCase().repeat(24),
      visitorCard: normalizeCard({ name: letter, message: "hello" }), requestedAt: 1, expiresAt };
    if (visitorUid) privateRequests[requestId] = { ...requests[requestId], visitorUid };
  }
  fixture.write(`freeTables/requests/${roomId}`, requests);
  fixture.write(`freeTables/roomStates/${roomId}`, { hostUid: "A", requests: privateRequests });
  const playerSafety = { async filterVisible(uid, entries, ownerSelector) {
    assert.equal(uid, "A");
    return entries.filter((entry) => ownerSelector(entry) && ownerSelector(entry) !== "B");
  } };
  const service = createFreeTableService({ firestore: fixture.firestore, realtime: fixture.realtime,
    HttpsError: FakeHttpsError, Timestamp: {}, playerSafety, now: () => 2_000_000_000_000 });
  const result = await service.performAction("A", { action: "get_my_state" });
  assert.deepEqual(result.requests.map((request) => request.requestId), ["c".repeat(24)]);
  assert.equal(JSON.stringify(result).includes("visitorUid"), false);
});

test("free-table safety closure ends only the blocked active pair and does not erase another room", async () => {
  const fixture = freeFixture();
  const sessionId = "a".repeat(24);
  fixture.write(`freeTables/sessions/${sessionId}`, {
    sessionId, hostUid: "A", visitorUid: "B", participants: { A: true, B: true },
    status: "active", safetyVersion: 0,
  });
  for (const uid of ["A", "B"]) fixture.write(`freeTables/active/${uid}`, { sessionId });
  fixture.write("freeTables/active/C", { sessionId: "unrelated" });
  const result = await fixture.service.closeBlockedPair({ firstUid: "A", secondUid: "B", actorUid: "B", revision: 1 });
  assert.equal(result.closed, 1);
  assert.equal(fixture.read(`freeTables/sessions/${sessionId}`).status, "ended");
  assert.equal(fixture.read(`freeTables/sessions/${sessionId}`).endedByRole, "visitor");
  assert.equal(fixture.read("freeTables/active/A"), null);
  assert.equal(fixture.read("freeTables/active/C").sessionId, "unrelated");
  assert.equal((await fixture.service.closeBlockedPair({ firstUid: "A", secondUid: "B", actorUid: "A", revision: 1 })).closed, 0);
});

test("delayed free-table cleanup preserves a new post-unblock session and request", async () => {
  const fixture = freeFixture();
  const sessionId = "b".repeat(24);
  const requestId = "c".repeat(24);
  const roomId = "d".repeat(24);
  fixture.write(`freeTables/sessions/${sessionId}`, {
    sessionId, hostUid: "A", visitorUid: "B", participants: { A: true, B: true },
    status: "active", safetyVersion: 2,
  });
  fixture.write("freeTables/active/A", { sessionId });
  fixture.write("freeTables/visitorPending/B", { roomId, requestId });
  fixture.write(`freeTables/roomStates/${roomId}`, { hostUid: "A", requests: {
    [requestId]: { visitorUid: "B", safetyVersion: 2 },
  } });
  const result = await fixture.service.closeBlockedPair({ firstUid: "A", secondUid: "B", actorUid: "A", revision: 1 });
  assert.deepEqual(result, { closed: 0, requestsRemoved: 0, relationshipsRemoved: 0 });
  assert.equal(fixture.read(`freeTables/sessions/${sessionId}`).status, "active");
  assert.equal(fixture.read("freeTables/visitorPending/B").requestId, requestId);
});

test("legacy free-table block routes require updated common controls before writing", async () => {
  const fixture = freeFixture();
  for (const action of ["block", "unblock"]) {
    await assert.rejects(fixture.service.performAction("A", { action, publicMemberId: "b".repeat(24) }),
      (error) => error.code === "failed-precondition");
  }
  assert.equal(fixture.read("freeTableBlocks"), null);
});

test("free-table delayed relationship cleanup clears only pre-block bookmarks and consent", async () => {
  const fixture = freeFixture();
  fixture.write("freeTableBookmarks/A/rooms/old", { hostUid: "B", updatedAt: 100 });
  fixture.write("freeTableBookmarks/A/rooms/new", { hostUid: "B", updatedAt: 200 });
  fixture.write("freeTableBookmarks/A/rooms/other", { hostUid: "C", updatedAt: 100 });
  const pairId = crypto.createHash("sha256").update("free-table-pair:A:B").digest("hex").slice(0, 40);
  fixture.write(`freeTableRelationships/${pairId}`, { participants: ["A", "B"], wants: { A: true, B: true },
    wantsUpdatedAt: { A: 100, B: 200 }, active: true, mutualAt: 200, updatedAt: 200 });
  await fixture.service.closeBlockedPair({ firstUid: "A", secondUid: "B", actorUid: "A", revision: 1, blockedAt: 150 });
  assert.equal(fixture.read("freeTableBookmarks/A/rooms/old"), null);
  assert.equal(fixture.read("freeTableBookmarks/A/rooms/new").updatedAt, 200);
  assert.equal(fixture.read("freeTableBookmarks/A/rooms/other").hostUid, "C");
  assert.deepEqual(fixture.read(`freeTableRelationships/${pairId}`).wants, { A: false, B: true });
  assert.equal(fixture.read(`freeTableRelationships/${pairId}`).active, false);
});

function marketClosureFixture() {
  const store = memoryStorage();
  const calls = [];
  let failNext = false;
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const start = source.indexOf("async function closeBlockedMarketPair(");
  const end = source.indexOf("async function performMarketAction(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    firestore: store.firestore, HttpsError: FakeHttpsError,
    cleanText: (value) => String(value || ""),
    marketActiveRef: (uid) => store.reference(`active/${uid}`),
    marketRoomRef: (roomId) => store.reference(`rooms/${roomId}`),
    isTerminalMarketState: (state) => ["sold", "canceled", "ended"].includes(state),
    eventId: (value) => crypto.createHash("sha256").update(value).digest("hex"),
    performMarketAction: async (uid, data) => {
      calls.push({ uid, ...data });
      if (failNext) { failNext = false; throw new Error("transient settlement failure"); }
      store.write(`rooms/${data.roomId}`, { ...store.read(`rooms/${data.roomId}`), status: "canceled" });
    },
  });
  vm.runInContext(`${source.slice(start, end)}; this.closePair = closeBlockedMarketPair;`, context);
  return { ...store, calls, closePair: context.closePair, failOnce: () => { failNext = true; } };
}

test("market safety settlement keeps the first closer and operation after failure and opposite-side retry", async () => {
  const fixture = marketClosureFixture();
  fixture.write("rooms/room", { participants: { seller: true, buyer: true }, status: "pitch", safetyVersion: 0 });
  fixture.write("active/seller", { roomId: "room" });
  fixture.write("active/buyer", { roomId: "room" });
  fixture.failOnce();
  await assert.rejects(fixture.closePair({ firstUid: "seller", secondUid: "buyer", actorUid: "seller", operationId: "first", revision: 1 }), /transient/);
  await fixture.closePair({ firstUid: "seller", secondUid: "buyer", actorUid: "buyer", operationId: "second", revision: 2 });
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[0].uid, "seller");
  assert.equal(fixture.calls[1].uid, "seller");
  assert.equal(fixture.calls[1].actionId, fixture.calls[0].actionId);
  assert.equal(fixture.calls[1].action, "cancel");
  assert.equal(fixture.read("rooms/room").status, "canceled");
});

test("market cleanup skips settled value, unrelated active pairs and sessions created after unblock", async () => {
  for (const room of [
    { participants: { A: true, B: true }, status: "sold", safetyVersion: 0 },
    { participants: { A: true, C: true }, status: "pitch", safetyVersion: 0 },
    { participants: { A: true, B: true }, status: "pitch", safetyVersion: 2 },
  ]) {
    const fixture = marketClosureFixture();
    fixture.write("active/A", { roomId: "room" });
    fixture.write("rooms/room", room);
    await fixture.closePair({ firstUid: "A", secondUid: "B", actorUid: "A", operationId: "old", revision: 1 });
    assert.equal(fixture.calls.length, 0);
    assert.deepEqual(fixture.read("rooms/room"), room);
  }
});

test("market outbox captured grant retains settlement routing after active pointers disappear", async () => {
  const fixture = marketClosureFixture();
  fixture.write("rooms/room", { participants: { A: true, B: true }, status: "pitch", safetyVersion: 0 });
  fixture.write("active/A", { roomId: "new-other-room" });
  fixture.write("rooms/new-other-room", { participants: { A: true, C: true }, status: "pitch", safetyVersion: 0 });
  await fixture.closePair({ firstUid: "A", secondUid: "B", actorUid: "B", operationId: "block", revision: 1,
    grants: { captured: { mode: "market", roomId: "room" } } });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].roomId, "room");
  assert.equal(fixture.calls[0].uid, "B");
  assert.equal(fixture.read("rooms/new-other-room").status, "pitch");
});
