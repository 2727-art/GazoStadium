"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const familiar = require("../solo-familiar");
const sessions = require("../solo-session-v2");
const { createPlayerSafetyService, pairIdFor } = require("../player-safety");
const { createPlayerSafetyMemory } = require("./helpers/player-safety-memory");

const NOW = 2_000_000_000_000;
const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
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

function queueEntry(uid, overrides = {}) {
  return {
    protocolVersion: 2, uid, sessionId: `session_${uid}_12345678901234567890`,
    leaseToken: `lease_${uid}_12345678901234567890`, generation: `generation_${uid}_12345678901234567890`,
    connectionGeneration: 1, name: uid, pursuitLine: "よろしくお願いします", streak: 0, rating: 1000,
    ratingPreference: "illustration", allowPreferenceMismatch: false, reunionPreference: false,
    sampleCount: 0, startingHp: 30, state: "waiting", joinedAt: NOW - 10_000,
    lastSeen: NOW - 1_000, expiresAt: NOW + 50_000, ...overrides,
  };
}

function policy(first, second, blockedBy = {}, overrides = {}) {
  return { participants: [first, second].sort(), revision: 1, ownVersions: {},
    blockedBy, lastBlockedAt: 0, ...overrides };
}

function fixture() {
  const store = createPlayerSafetyMemory();
  const reads = [];
  const failures = new Set();
  const document = (collection, id) => {
    const ref = store.firestore.collection(collection).doc(id);
    return { ...ref, async get() {
      reads.push(ref.path);
      if (failures.has(ref.path)) throw new Error("injected policy read failure");
      return ref.get();
    } };
  };
  const firestore = { ...store.firestore, collection: (collection) => ({
    ...store.firestore.collection(collection), doc: (id) => document(collection, id),
  }) };
  const service = createPlayerSafetyService({ firestore, realtime: store.realtime, HttpsError, now: () => NOW });
  const context = vm.createContext({ ...familiar, ...sessions, HttpsError,
    Date: { now: () => NOW }, playerSafetyService: service,
    soloFamiliarBlockPairRef: (first, second) => document("soloFamiliarBlockPairs", familiar.soloFamiliarPairId(first, second)),
  });
  vm.runInContext(section("function boundedSoloServerQueue(", "function soloSafetyContact("), context);
  return { ...store, context, service, reads, failures,
    policyPath: (first, second) => `playerContactPolicies/${pairIdFor(first, second)}`,
    legacyPath: (first, second) => `soloFamiliarBlockPairs/${familiar.soloFamiliarPairId(first, second)}`,
    setPolicy(first, second, value) { store.fsWrite(`playerContactPolicies/${pairIdFor(first, second)}`, value); },
  };
}

test("incompatible fresh candidates perform zero Firestore reads; compatible missing blocks retain both lookups", async () => {
  const f = fixture();
  const queue = { A: queueEntry("A"), B: queueEntry("B", { ratingPreference: "live_action" }),
    C: queueEntry("C", { ratingPreference: "both" }) };
  assert.deepEqual(plain(await f.context.blockedSoloPairIdsForQueue("A", queue, NOW)), []);
  assert.deepEqual(f.reads, [f.policyPath("A", "C"), f.legacyPath("A", "C")]);
});

test("precheck exactly preserves the existing preference predicate including both, legacy and mismatch consent", async () => {
  for (const first of ["illustration", "live_action", "both", "legacy", undefined]) {
    for (const second of ["illustration", "live_action", "both", "legacy", undefined]) {
      for (const firstAllows of [false, true]) {
        for (const secondAllows of [false, true]) {
          const f = fixture();
          const queue = {
            A: queueEntry("A", { ratingPreference: first, allowPreferenceMismatch: firstAllows }),
            B: queueEntry("B", { ratingPreference: second, allowPreferenceMismatch: secondAllows }),
          };
          // Invalid legacy-shaped queue rows remain excluded by the pre-existing validator.
          const expected = familiar.isValidSoloServerQueueEntry("B", queue.B, NOW)
            && Number.isFinite(familiar.soloQueuePreferenceTier(queue.A, queue.B));
          await f.context.blockedSoloPairIdsForQueue("A", queue, NOW);
          assert.equal(f.reads.length, expected ? 2 : 0,
            JSON.stringify({ first, second, firstAllows, secondAllows }));
        }
      }
    }
  }
});

test("stale, malformed, non-waiting and own entries do not gain block reads", async () => {
  const f = fixture();
  const queue = { A: queueEntry("A"), stale: queueEntry("stale", { lastSeen: NOW - 60_000 }),
    malformed: queueEntry("malformed", { uid: "someone-else" }),
    offered: queueEntry("offered", { state: "offering" }) };
  await f.context.blockedSoloPairIdsForQueue("A", queue, NOW);
  assert.deepEqual(f.reads, []);
});

test("an existing canonical policy is normalized once with one read and no legacy fallback", async () => {
  for (const blockedBy of [{}, { A: true }, { B: true }]) {
    const f = fixture();
    f.setPolicy("A", "B", policy("A", "B", blockedBy));
    const result = await f.context.readSoloPlayerBlock("A", "B");
    assert.equal(result.exists, Object.values(blockedBy).includes(true));
    assert.deepEqual(result.policy, policy("A", "B", blockedBy));
    assert.deepEqual(f.reads, [f.policyPath("A", "B")]);
  }
});

test("canonical unblock tombstones still supersede stale legacy blocks", async () => {
  const f = fixture();
  f.setPolicy("A", "B", policy("A", "B", { A: false, B: false }, { revision: 2, lastBlockedAt: NOW - 1_000 }));
  f.fsWrite(f.legacyPath("A", "B"), { blockedBy: { A: true } });
  assert.equal((await f.context.readSoloPlayerBlock("A", "B")).exists, false);
  assert.deepEqual(f.reads, [f.policyPath("A", "B")]);
});

test("missing canonical documents preserve legacy fallback and never cache a negative result", async () => {
  const f = fixture();
  assert.equal((await f.context.readSoloPlayerBlock("A", "B")).exists, false);
  f.fsWrite(f.legacyPath("A", "B"), { blockedBy: { A: true } });
  assert.equal((await f.context.readSoloPlayerBlock("A", "B")).exists, true);
  assert.deepEqual(f.reads, [f.policyPath("A", "B"), f.legacyPath("A", "B"),
    f.policyPath("A", "B"), f.legacyPath("A", "B")]);
});

test("cached-snapshot normalization has the same fail-closed checks as getPolicy", async () => {
  for (const patch of [{ participants: ["A", "C"] }, { revision: -1 }, { revision: 1.5 },
    { blockedBy: { B: "true" } }, { ownVersions: { A: -1 } }, { lastBlockedAt: -1 }]) {
    const f = fixture();
    f.setPolicy("A", "B", policy("A", "B", {}, patch));
    await assert.rejects(f.context.readSoloPlayerBlock("A", "B"), (error) => error.code === "unavailable");
    assert.deepEqual(f.reads, [f.policyPath("A", "B")]);
    await assert.rejects(f.service.getPolicy("A", "B"), (error) => error.code === "unavailable");
  }
});

test("a policy read failure never falls back to an unblocked legacy result", async () => {
  const f = fixture();
  f.failures.add(f.policyPath("A", "B"));
  await assert.rejects(f.context.readSoloPlayerBlock("A", "B"), /injected policy read failure/);
  assert.deepEqual(f.reads, [f.policyPath("A", "B")]);
});

test("a new block after the candidate scan is observed by a fresh final check", async () => {
  const f = fixture();
  f.setPolicy("A", "B", policy("A", "B"));
  const queue = { A: queueEntry("A"), B: queueEntry("B") };
  assert.deepEqual(plain(await f.context.blockedSoloPairIdsForQueue("A", queue, NOW)), []);
  f.setPolicy("A", "B", policy("A", "B", { B: true }, { revision: 2 }));
  assert.equal((await f.context.readSoloPlayerBlock("A", "B")).exists, true);
  assert.deepEqual(f.reads, [f.policyPath("A", "B"), f.policyPath("A", "B")]);

  // These must remain independent authoritative reads in the real matcher paths.
  const legacy = section("async function trySoloServerMatch(", "async function confirmSoloFamiliarReunionFromRoom(");
  assert.equal((legacy.match(/readSoloPlayerBlock\(selection\.host\.uid, selection\.candidate\.uid\)/g) || []).length, 2);
  const current = section("async function trySoloSessionV2Match(", "function soloSessionV2ResourcesFromStored(");
  assert.match(current, /readSoloPlayerBlock\(selection\.host\.uid, selection\.candidate\.uid\)/);
});

function installCaller(f, version, queue, familiarPairs = []) {
  const selectionCalls = [];
  const claims = Object.fromEntries(Object.entries(queue).map(([uid, row]) => [uid, {
    protocolVersion: 2, sessionId: row.sessionId, leaseToken: row.leaseToken, generation: row.generation,
    claimedAt: NOW - 10_000, heartbeatAt: NOW - 1_000, expiresAt: NOW + 50_000,
  }]));
  const snapshot = (value) => ({ val: () => value, exists: () => value != null });
  const ref = (key) => ({ get: async () => snapshot(key === "online/queue" ? queue
    : key === "online/soloSessionClaims" ? claims : null),
  orderByChild() { return this; }, startAt() { return this; }, limitToFirst() { return this; } });
  Object.assign(f.context, {
    realtime: { ref }, objectValue: (value) => value && typeof value === "object" ? value : {},
    readSoloFamiliarReunionEnabled: async () => true,
    soloSessionClaimRef: (uid) => ({ get: async () => snapshot(version === 2 ? claims[uid] : null) }),
    soloSessionQueueRef: (uid) => ({ get: async () => snapshot(queue[uid]) }),
    liveSoloSessionV2Room: async () => null, liveLegacySoloRoom: async () => null,
    maybeSweepExpiredSoloMatchPermits: async () => {},
    loadExistingSoloHostedMatch: async () => null, loadExistingSoloSessionV2Match: async () => null,
    acquireSoloMatchAttempt: async () => true, sanitizeSoloQueueCandidate: (row) => row || {},
    soloProfileProjectionParticipantsUpgradeRequired: async () => false,
    querySoloPairDocuments: async () => familiarPairs,
    soloSessionV2QueueIndex: { publish: async (uid) => queue[uid], loadFresh: async () => queue },
  });
  const name = version === 1 ? "selectSoloServerMatch" : "selectSoloSessionV2Match";
  const selector = version === 1 ? familiar[name] : sessions[name];
  f.context[name] = (args) => {
    const result = selector(args);
    selectionCalls.push({ args, result });
    // Exercise the real request and precheck path through selection, without
    // emulating unrelated reservation writes. Final block checks are asserted above.
    return null;
  };
  vm.runInContext(section("function boundedSoloSessionV2Queue(", "function soloSessionV2Candidate("), f.context);
  vm.runInContext(section("function nestedSoloSessionV2IndexedQueue(", "function canonicalSoloSessionV2FamiliarPairs("), f.context);
  vm.runInContext(version === 1
    ? section("async function trySoloServerMatch(", "async function confirmSoloFamiliarReunionFromRoom(")
    : section("async function trySoloSessionV2Match(", "function soloSessionV2ResourcesFromStored("), f.context);
  return { selectionCalls, run: () => version === 1 ? f.context.trySoloServerMatch("A")
    : f.context.trySoloSessionV2Match("A", { sessionId: queue.A.sessionId, leaseToken: queue.A.leaseToken }) };
}

for (const version of [1, 2]) {
  test(`legacy/current V${version} matcher skips all incompatible policy reads and remains waiting`, async () => {
    const f = fixture();
    const queue = { A: queueEntry("A"), B: queueEntry("B", { ratingPreference: "live_action" }) };
    const caller = installCaller(f, version, queue);
    assert.equal((await caller.run()).outcome, "waiting");
    assert.deepEqual(f.reads, []);
    assert.equal(caller.selectionCalls.length, 1);
    assert.equal(caller.selectionCalls[0].result, null);
  });

  test(`legacy/current V${version} matcher preserves blocks, preference order and reunion priority`, async () => {
    const f = fixture();
    const queue = { A: queueEntry("A", { reunionPreference: true }),
      B: queueEntry("B", { ratingPreference: "live_action", joinedAt: NOW - 30_000 }),
      C: queueEntry("C", { joinedAt: NOW - 20_000 }),
      D: queueEntry("D", { ratingPreference: "both", reunionPreference: true }),
      E: queueEntry("E", { joinedAt: NOW - 25_000 }) };
    for (const uid of ["C", "D", "E"]) f.setPolicy("A", uid, policy("A", uid, uid === "E" ? { E: true } : {}));
    const familiarPairs = [{ id: familiar.soloFamiliarPairId("A", "D"), data: {
      participants: ["A", "D"], active: true, lastReunionPriorityAt: 0,
    } }];
    const caller = installCaller(f, version, queue, familiarPairs);
    await caller.run();
    assert.deepEqual(f.reads, [f.policyPath("A", "E"), f.policyPath("A", "C"), f.policyPath("A", "D")]);
    const { args, result } = caller.selectionCalls[0];
    assert.equal(result.candidate.uid, "D");
    assert.equal(result.reunion, true);
    const selector = version === 1 ? familiar.selectSoloServerMatch : sessions.selectSoloSessionV2Match;
    assert.deepEqual(result, selector({ ...args, blockedPairIds: [familiar.soloFamiliarPairId("A", "E")] }));
    assert.equal(selector({ ...args, familiarPairs: [] }).candidate.uid, "C");
  });
}
