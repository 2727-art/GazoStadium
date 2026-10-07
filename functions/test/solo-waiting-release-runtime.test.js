"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const sessions = require("../solo-session-v2");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const NOW = 2_000_000_000_000;
const UID = "waiting-owner";
const SESSION = "session_waiting_1234567890";
const TOKEN = "lease_waiting_123456789012";
const GENERATION = "generation_waiting_123456";
const CLAIM = `online/soloSessionClaims/${UID}`;
const QUEUE = `online/queueV2/${UID}/${SESSION}`;
const ACTIVE = `online/activeV2/${UID}/${SESSION}`;
const LOCK = `online/soloMatchLocksV2/${UID}`;
const DATA = { action: "release", sessionId: SESSION, leaseToken: TOKEN, generation: GENERATION, onlyWaiting: true };
const plain = (value) => JSON.parse(JSON.stringify(value));
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} source bounds`);
  return source.slice(start, end);
}
function snapshot(value) {
  return { val: () => structuredClone(value), exists: () => value != null,
    child: (key) => snapshot(key.split("/").reduce((item, part) => item?.[part], value) ?? null) };
}
function claim(overrides = {}) {
  return { protocolVersion: 2, sessionId: SESSION, leaseToken: TOKEN, generation: GENERATION,
    claimedAt: NOW - 10_000, heartbeatAt: NOW - 1_000, expiresAt: NOW + 50_000, ...overrides };
}
function queue(overrides = {}) {
  return { ...claim(), uid: UID, state: "waiting", lastSeen: NOW - 1_000, joinedAt: NOW - 10_000, ...overrides };
}

function fixture() {
  const store = createPlayerSafetyMemory();
  const operations = [];
  const errors = [];
  const indexRemovals = [];
  const hooks = { afterGet: null, beforeTransaction: null, indexFailure: false, coldClaim: false };
  let now = NOW;
  let operation = 0;
  const reference = (key) => {
    const ref = store.realtime.ref(key);
    return { ...ref,
      async get() {
        operations.push({ kind: "get", key });
        const result = snapshot((await ref.get()).val());
        if (hooks.afterGet) await hooks.afterGet(key);
        return result;
      },
      async transaction(callback) {
        operations.push({ kind: "transaction", key });
        if (hooks.beforeTransaction) await hooks.beforeTransaction(key);
        if (hooks.coldClaim && key === CLAIM && callback(null) === undefined) {
          return { committed: false, snapshot: snapshot(null) };
        }
        const result = await ref.transaction(callback);
        return { ...result, snapshot: snapshot(result.snapshot.val()) };
      },
    };
  };
  const context = vm.createContext({ ...sessions, HttpsError,
    Date: { now: () => now }, console: { error: (...args) => errors.push(args) },
    objectValue: (value) => value && typeof value === "object" ? value : {},
    isPlainCallableObject: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
    cleanText: (value) => String(value || "").trim(),
    SOLO_PROFILE_PROJECTION_VERSION: 2, SOLO_SESSION_CLAIM_GUARD_TTL_MS: 60_000,
    soloSessionGeneration: () => `operation_${++operation}_12345678901234567890`,
    realtime: { ref: reference },
    soloSessionClaimRef: (uid) => reference(`online/soloSessionClaims/${uid}`),
    soloSessionQueueRef: (uid, sessionId) => reference(`online/queueV2/${uid}/${sessionId}`),
    soloSessionActiveRef: (uid, sessionId) => reference(`online/activeV2/${uid}/${sessionId}`),
    soloSessionV2QueueIndex: { async remove(uid, fence) {
      indexRemovals.push({ uid, fence: plain(fence) });
      if (hooks.indexFailure) throw new Error("index cleanup failed");
      return true;
    } },
  });
  vm.runInContext(section("function soloSessionPathSegment(", "function soloSessionActionRatePath("), context);
  vm.runInContext(section("function soloSessionClaimGuardMatches(", "function legacySoloActiveValueMatches("), context);
  vm.runInContext(section("async function removeSoloSessionResourceIfFenced(", "function boundedSoloSessionV2Queue("), context);
  vm.runInContext(section("function soloSessionV2LockMatches(", "async function releaseSoloSessionV2Locks("), context);
  store.rtWrite(CLAIM, claim());
  store.rtWrite(QUEUE, queue());
  return { ...store, context, operations, errors, hooks, indexRemovals,
    advance: (ms) => { now += ms; },
    release: (data = DATA) => context.releaseSoloSessionV2(UID, data),
  };
}

test("onlyWaiting is a strict optional release-only boolean; ordinary payload remains compatible", () => {
  const f = fixture();
  assert.deepEqual(plain(f.context.requireSoloSessionActionData(DATA)), DATA);
  const ordinary = { ...DATA }; delete ordinary.onlyWaiting;
  assert.deepEqual(plain(f.context.requireSoloSessionActionData(ordinary)), ordinary);
  assert.equal(f.context.requireSoloSessionActionData({ ...DATA, onlyWaiting: false }).onlyWaiting, false);
  for (const value of [null, undefined, "true", 1, 0, [], {}]) {
    assert.throws(() => f.context.requireSoloSessionActionData({ ...DATA, onlyWaiting: value }),
      (error) => error.code === "invalid-argument");
  }
  assert.throws(() => f.context.requireSoloSessionActionData({ ...DATA, action: "heartbeat" }),
    (error) => error.code === "invalid-argument");
});

test("conditional release removes only its waiting queue and exact claim, never transacts an active path", async () => {
  const f = fixture();
  const result = await f.release();
  assert.equal(result.released, true);
  assert.equal(result.sessionGeneration, GENERATION);
  assert.equal(f.rtRead(CLAIM), null);
  assert.equal(f.rtRead(QUEUE), null);
  assert.equal(f.rtRead(LOCK), null);
  assert.equal(f.indexRemovals.length, 1);
  assert.equal(f.operations.some((op) => op.kind === "transaction" && op.key === ACTIVE), false);
  assert.deepEqual(plain(await f.release()), { released: false, reason: "lease-lost" });
});

test("missing queue with no active pointer can finish an exact conditional release", async () => {
  const f = fixture();
  f.rtWrite(QUEUE, null);
  assert.equal((await f.release()).released, true);
  assert.equal(f.rtRead(CLAIM), null);
});

test("a cold claim transaction retries its null cache against the actual exact server fence", async () => {
  const f = fixture();
  f.hooks.coldClaim = true;
  assert.equal((await f.release()).released, true);
  assert.equal(f.rtRead(CLAIM), null);
});

test("a cold claim retry still protects a newer fence or reports a genuinely absent claim", async () => {
  for (const newer of [null, claim({ generation: "generation_replaced_12345678" })]) {
    const f = fixture();
    f.hooks.coldClaim = true;
    f.hooks.beforeTransaction = async (key) => {
      if (key === CLAIM) f.rtWrite(CLAIM, newer);
    };
    assert.deepEqual(plain(await f.release()), { released: false, reason: "lease-lost" });
    assert.deepEqual(f.rtRead(CLAIM), newer);
  }
});

test("every existing active pointer is protected, including malformed or differently fenced values", async () => {
  for (const active of [false, "room-id", { ...queue(), roomId: "active-room" },
    { ...queue(), generation: "another_generation_123456789" }]) {
    const f = fixture();
    f.rtWrite(ACTIVE, active);
    assert.deepEqual(plain(await f.release()), { released: false, reason: "match-in-progress" });
    assert.deepEqual(f.rtRead(ACTIVE), active);
    assert.deepEqual(f.rtRead(QUEUE), queue());
    assert.deepEqual(f.rtRead(CLAIM), claim());
    assert.equal(f.indexRemovals.length, 0);
    assert.equal(f.operations.some((op) => op.kind === "transaction" && [QUEUE, ACTIVE, CLAIM].includes(op.key)), false);
  }
});

test("reserved, offering, malformed and room-bound queues are never removed by the conditional path", async () => {
  for (const patch of [{ state: "offering" }, { state: "reserved" }, { state: null },
    { roomId: "offered-room" }, { attemptId: "attempt_123456789012345" }, { roomId: "" }]) {
    const f = fixture();
    const value = queue(patch);
    f.rtWrite(QUEUE, value);
    assert.deepEqual(plain(await f.release()), { released: false, reason: "match-in-progress" });
    assert.deepEqual(f.rtRead(QUEUE), value);
    assert.deepEqual(f.rtRead(CLAIM), claim());
  }
});

test("stale release generations and replaced waiting queues preserve newer resources", async () => {
  const f = fixture();
  const newer = "generation_newer_123456789";
  assert.deepEqual(plain(await f.release({ ...DATA, generation: newer })), { released: false, reason: "lease-lost" });
  f.rtWrite(QUEUE, queue({ generation: newer }));
  assert.deepEqual(plain(await f.release()), { released: false, reason: "resource-changed" });
  assert.equal(f.rtRead(QUEUE).generation, newer);
  assert.equal(f.rtRead(CLAIM).generation, GENERATION);
});

function peerResources() {
  const common = { protocolVersion: 2, name: "peer", pursuitLine: "よろしく", rating: 1000, streak: 0,
    ratingPreference: "both", allowPreferenceMismatch: false, reunionPreference: false,
    joinedAt: NOW - 10_000, lastSeen: NOW - 1_000, state: "waiting" };
  return sessions.buildSoloSessionV2Resources({ roomId: "room_123456789012345", attemptId: "attempt_123456789012345",
    connectionGeneration: "connection_123456789012345", now: NOW, expiresAt: NOW + 60_000,
    host: { ...common, uid: "peer", sessionId: "session_peer_123456789012", leaseToken: "lease_peer_12345678901234",
      generation: "generation_peer_1234567890" },
    guest: { ...common, ...queue() } });
}

test("a peer's existing match reservation blocks conditional release without touching either participant", async () => {
  const f = fixture();
  const resources = peerResources();
  assert.equal(await f.context.acquireSoloSessionV2Locks(resources), true);
  const held = f.rtRead("online/soloMatchLocksV2");
  assert.deepEqual(plain(await f.release()), { released: false, reason: "occupied" });
  assert.deepEqual(f.rtRead("online/soloMatchLocksV2"), held);
  assert.deepEqual(f.rtRead(QUEUE), queue());
  assert.deepEqual(f.rtRead(CLAIM), claim());
});

test("a held release guard excludes a peer-initiated pair reservation until cleanup finishes", async () => {
  const f = fixture();
  let attempted = false;
  f.hooks.afterGet = async (key) => {
    if (key !== ACTIVE || attempted) return;
    attempted = true;
    assert.equal(f.rtRead(LOCK).kind, "claim");
    assert.equal(await f.context.acquireSoloSessionV2Locks(peerResources()), false);
    assert.equal(f.rtRead("online/soloMatchLocksV2/peer"), null);
  };
  assert.equal((await f.release()).released, true);
  assert.equal(attempted, true);
});

test("an expired or replaced guard prevents resource removal and cannot release a foreign lock", async () => {
  for (const replacement of [false, true]) {
    const f = fixture();
    let changed = false;
    f.hooks.afterGet = async (key) => {
      if (key !== ACTIVE || changed) return;
      changed = true;
      if (replacement) f.rtWrite(LOCK, { kind: "match", expiresAt: NOW + 120_000, roomId: "new-room" });
      else f.advance(60_001);
    };
    assert.deepEqual(plain(await f.release()), { released: false, reason: "occupied" });
    assert.deepEqual(f.rtRead(QUEUE), queue());
    assert.deepEqual(f.rtRead(CLAIM), claim());
    if (replacement) assert.equal(f.rtRead(LOCK).roomId, "new-room");
  }
  const ttl = Number(source.match(/SOLO_SESSION_CLAIM_GUARD_TTL_MS = ([\d_]+)/)[1].replaceAll("_", ""));
  const timeout = Number(source.match(/CALLABLE_BASE_OPTIONS = Object\.freeze\(\{\s*timeoutSeconds: (\d+)/)[1]) * 1000;
  assert.ok(ttl > timeout, "release guard outlives the callable maximum duration");
});

test("a late queue reservation is rejected by the deletion CAS even after a waiting snapshot", async () => {
  const f = fixture();
  let changed = false;
  f.hooks.beforeTransaction = async (key) => {
    if (key !== QUEUE || changed) return;
    changed = true;
    f.rtWrite(QUEUE, queue({ state: "offering", roomId: "late-room" }));
  };
  assert.deepEqual(plain(await f.release()), { released: false, reason: "resource-changed" });
  assert.equal(f.rtRead(QUEUE).roomId, "late-room");
  assert.deepEqual(f.rtRead(CLAIM), claim());
});

test("partial cleanup failure leaves the exact claim for a safe retry without reviving a queue", async () => {
  const f = fixture();
  let failed = false;
  f.hooks.beforeTransaction = async (key) => {
    if (key !== CLAIM || failed) return;
    failed = true;
    throw new Error("injected claim release failure");
  };
  await assert.rejects(f.release(), /injected claim release failure/);
  assert.equal(f.rtRead(QUEUE), null);
  assert.deepEqual(f.rtRead(CLAIM), claim());
  assert.equal(f.rtRead(LOCK), null);
  assert.equal((await f.release()).released, true);
  assert.equal(f.rtRead(QUEUE), null);
  assert.equal(f.rtRead(CLAIM), null);
});

test("an unexpected new claim during partial cleanup cannot be removed by the old generation", async () => {
  const f = fixture();
  let changed = false;
  const newer = claim({ generation: "generation_newer_123456789" });
  f.hooks.beforeTransaction = async (key) => {
    if (key !== CLAIM || changed) return;
    changed = true;
    f.rtWrite(CLAIM, newer);
  };
  assert.deepEqual(plain(await f.release()), { released: false, reason: "lease-lost" });
  assert.deepEqual(f.rtRead(CLAIM), newer);
});

test("without onlyWaiting the established manual release keeps its existing exact-fence cleanup", async () => {
  for (const withFalse of [false, true]) {
    const f = fixture();
    f.rtWrite(ACTIVE, queue({ roomId: "existing-room" }));
    f.rtWrite(QUEUE, queue({ state: "offering", roomId: "existing-room" }));
    const data = { ...DATA };
    if (withFalse) data.onlyWaiting = false;
    else delete data.onlyWaiting;
    assert.equal((await f.release(data)).released, true);
    assert.equal(f.rtRead(ACTIVE), null);
    assert.equal(f.rtRead(QUEUE), null);
    assert.equal(f.rtRead(CLAIM), null);
  }
});
