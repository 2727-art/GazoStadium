"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { migrate, parseArguments, legacyDirections, contactDescriptor, favoriteOwnerPatch } = require("../scripts/migrate-player-safety");
const { fleaPublicSellerId } = require("../anju-pay-flea");
const { createMigrationRealtimeRest } = require("../scripts/player-safety-rtdb-rest");

function fixture(initial = {}, realtimeInitial = {}, initialPolicies = {}) {
  const records = new Map(Object.entries(structuredClone(initial)));
  const live = new Map(Object.entries(structuredClone(realtimeInitial)));
  const policies = new Map(Object.entries(structuredClone(initialPolicies)));
  const calls = { writes: 0, imports: 0, ensured: [], activated: [], revoked: [] };
  const pairKey = (a, b) => [a, b].sort().join(":");
  const snapshot = (path) => ({ ref: reference(path), id: path.split("/").at(-1), exists: records.has(path),
    data: () => structuredClone(records.get(path)), get: (key) => records.get(path)?.[key] });
  const reference = (path) => ({ path, id: path.split("/").at(-1), get: async () => snapshot(path) });
  function query(path, group = false, filters = [], limit = Infinity, cursor = "") {
    return {
      doc: (id) => reference(`${path}/${id}`),
      where: (key, op, value) => query(path, group, [...filters, [key, op, value]], limit, cursor),
      orderBy: () => query(path, group, filters, limit, cursor),
      limit: (value) => query(path, group, filters, value, cursor),
      startAfter: (value) => query(path, group, filters, limit, value.ref.path),
      get: async () => ({ docs: [...records.keys()].sort().filter((key) => {
        const parts = key.split("/");
        return (group ? parts.at(-2) === path : parts.slice(0, -1).join("/") === path)
          && key > cursor && filters.every(([field, op, value]) => op === "==" && records.get(key)?.[field] === value);
      }).slice(0, limit).map(snapshot) }),
    };
  }
  const firestore = { collection: (path) => query(path), collectionGroup: (group) => query(group, true),
    runTransaction: async (callback) => callback({
      get: async (ref) => snapshot(ref.path),
      update: (ref, value) => { records.set(ref.path, { ...records.get(ref.path), ...structuredClone(value) }); calls.writes += 1; },
    }) };
  const readLive = (path) => {
    if (live.has(path)) return structuredClone(live.get(path));
    const children = [...live].filter(([key]) => key.startsWith(`${path}/`));
    if (!children.length) return null;
    const result = {};
    for (const [key, value] of children) {
      const parts = key.slice(path.length + 1).split("/");
      let target = result;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = structuredClone(value);
    }
    return result;
  };
  const realtime = { ref: (path) => ({ get: async () => ({ val: () => readLive(path) }),
    transaction: async (callback) => {
      const result = callback(readLive(path));
      if (result !== undefined) { live.set(path, structuredClone(result)); calls.writes += 1; }
      return { committed: result !== undefined, snapshot: { val: () => readLive(path) } };
    } }) };
  const safety = {
    getPolicy: async (a, b) => structuredClone(policies.get(pairKey(a, b)) || { revision: 0, ownVersions: {}, blockedBy: {}, lastBlockedAt: 0 }),
    importLegacyDirection: async ({ uid, targetUid }) => {
      const key = pairKey(uid, targetUid);
      const policy = policies.get(key) || { revision: 0, ownVersions: {}, blockedBy: {} };
      if (Object.hasOwn(policy.ownVersions, uid)) return { imported: false };
      policies.set(key, { ...policy, ownVersions: { ...policy.ownVersions, [uid]: 1 },
        blockedBy: { ...policy.blockedBy, [uid]: true }, revision: policy.revision + 1, lastBlockedAt: 500 });
      calls.imports += 1; calls.writes += 1;
      return { imported: true };
    },
    ensureContact: async (contact) => { calls.ensured.push(contact); calls.writes += 1;
      return { safetyPairId: pairKey(contact.firstUid, contact.secondUid), safetyVersion: 0, safetyGrantId: contact.roomId }; },
    checkContact: async (contact) => contact.safetyGrantId !== "revoked",
    activateContact: async (contact) => { calls.activated.push(contact); calls.writes += 1; return true; },
    revokeContact: async (contact) => { calls.revoked.push(contact); calls.writes += 1; },
  };
  return { records, live, policies, calls, firestore, realtime, safety };
}

test("migration defaults read-only, requires an explicit project and rejects a mismatched database", () => {
  assert.equal(parseArguments(["--project", "gazostadium"]).apply, false);
  assert.equal(parseArguments(["--project", "gazostadium", "--apply"]).apply, true);
  assert.throws(() => parseArguments([]), /explicit/);
  assert.throws(() => parseArguments(["--project", "gazostadium", "--database-url", "https://other-default-rtdb.firebaseio.com"]), /selected project/);
});

test("legacy extraction retains directions and rejects mismatched owners", () => {
  assert.deepEqual(legacyDirections("soloFamiliarBlockPairs/p", { participants: ["A", "B"], blockedBy: { A: true, B: false } })
    .map(({ uid, targetUid }) => [uid, targetUid]), [["A", "B"]]);
  assert.equal(legacyDirections("valueMarketShopBlocks/A/users/B", { ownerUid: "C", blockedUid: "B" }).length, 0);
  assert.equal(legacyDirections("freeTableBlocks/A/users/public", { ownerUid: "A", targetUid: "A" }).length, 0);
});

test("dry run predicts the union without reviving tombstones or creating grants", async () => {
  const state = fixture({
    "freeTableBlocks/A/users/public": { ownerUid: "A", targetUid: "B" },
    "soloFamiliarBlockPairs/pair": { participants: ["A", "B"], blockedBy: { A: true, B: true } },
    "valueMarketShopBlocks/C/users/D": { ownerUid: "C", blockedUid: "D" },
  }, { "online/rooms/old": { hostUid: "A", guestUid: "B", members: { A: true, B: true }, status: "active", createdAt: 100 },
    "online/active/A": "old", "online/active/B": "old" },
  { "C:D": { revision: 2, ownVersions: { C: 2 }, blockedBy: { C: false }, lastBlockedAt: 50 } });
  const report = await migrate(state);
  assert.equal(report.legacy.directions, 3);
  assert.equal(report.legacy.planned, 2);
  assert.equal(report.legacy.preserved, 1);
  assert.equal(report.live.denied, 1);
  assert.equal(state.calls.writes, 0);
  await migrate({ ...state, apply: true, phase: "legacy" });
  assert.equal(state.calls.imports, 2);
  assert.deepEqual(state.policies.get("C:D").blockedBy, { C: false });
  await migrate({ ...state, apply: true, phase: "legacy" });
  assert.equal(state.calls.imports, 2, "repeated imports are idempotent");
});

test("live migration binds four authoritative modes and preserves gameplay fields", async () => {
  const normal = { hostUid: "A", guestUid: "B", members: { A: true, B: true }, status: "active", createdAt: 100, currentRound: 4 };
  const free = { hostUid: "A", visitorUid: "B", participants: { A: true, B: true }, status: "active", createdAt: 100, roomId: "open", sessionId: "free" };
  const market = { sellerUid: "A", buyerUid: "B", participants: { A: true, B: true }, status: "pitch", createdAt: 100, entryFeePaid: true, escrow: 50 };
  const state = fixture({ "valueMarketRooms/market": market,
    "valueMarketActive/A": { roomId: "market" }, "valueMarketActive/B": { roomId: "market" } }, {
    "online/rooms/solo": normal,
    "online/rooms/unindexed-history": normal,
    "online/active/A": "solo", "online/active/B": "solo",
    "online/strategyRooms/strategy": { ...normal, attemptId: "original-attempt" },
    "online/strategyActive/A": "strategy", "online/strategyActive/B": "strategy",
    "freeTables/sessions/free": free,
    "freeTables/active/A": { sessionId: "free" }, "freeTables/active/B": { sessionId: "free" },
    "freeTables/roomStates/open": { session: free, state: "active" },
    "online/valueMarketRooms/market": { members: { A: true, B: true }, safetyPairId: "A:B", turn: 2 },
  });
  const report = await migrate({ ...state, apply: true, phase: "live" });
  assert.equal(report.live.bound, 4);
  assert.equal(state.calls.ensured.length, 4);
  assert.equal(state.calls.ensured.find((entry) => entry.mode === "strategy").attemptId, "original-attempt");
  assert.equal(state.calls.ensured.every((entry) => entry.startedAt === 100), true);
  assert.equal(state.live.get("online/rooms/solo").currentRound, 4);
  assert.equal(state.records.get("valueMarketRooms/market").escrow, 50);
  assert.equal(state.live.get("online/valueMarketRooms/market").turn, 2);
  assert.equal(state.live.get("online/valueMarketRooms/market").sellerUid, "A");
  assert.equal(state.live.get("freeTables/roomStates/open").session.safetyGrantId, "free");
  assert.equal(state.live.get("online/rooms/unindexed-history").safetyGrantId, undefined);
  await migrate({ ...state, apply: true, phase: "live" });
  assert.equal(state.calls.ensured.length, 4, "retry never issues replacement metadata");
});

test("destroyed, mismatched, pre-block and revoked sessions never receive replacement grants", async () => {
  const room = { hostUid: "A", guestUid: "B", members: { A: true, B: true }, status: "active", createdAt: 100 };
  assert.equal(contactDescriptor("solo", "room", { ...room, destroyed: { by: "A", at: 110 } }), null);
  assert.ok(contactDescriptor("solo", "room", { ...room, finished: { A: true, B: true } }));
  assert.equal(contactDescriptor("solo", "room", { ...room, members: { A: true, C: true } }), null);
  for (const [value, expected] of [
    [room, "denied"],
    [{ ...room, createdAt: 600, safetyPairId: "A:B", safetyVersion: 2, safetyGrantId: "revoked" }, "denied"],
    [{ ...room, safetyVersion: 1 }, "invalid"],
  ]) {
    const state = fixture({}, { "online/rooms/room": value, "online/active/A": "room", "online/active/B": "room" },
      { "A:B": { revision: 2, blockedBy: { A: false }, ownVersions: { A: 2 }, lastBlockedAt: 500 } });
    const report = await migrate({ ...state, apply: true, phase: "live" });
    assert.equal(report.live[expected], 1);
    assert.equal(state.calls.ensured.length, 0);
    assert.equal(state.calls.writes, 0);
  }
});

test("activeV2 discovery ignores expired leases and requires the current canonical claim", async () => {
  const roomId = "r".repeat(20);
  const sessionId = "s".repeat(20);
  const claim = { protocolVersion: 2, sessionId, leaseToken: "l".repeat(20), generation: "g".repeat(20),
    claimedAt: 100, heartbeatAt: 150, expiresAt: 1000 };
  const active = { ...claim, roomId, attemptId: "a".repeat(20), connectionGeneration: "c".repeat(20) };
  const room = { hostUid: "A", guestUid: "B", members: { A: true, B: true }, status: "active", createdAt: 100 };
  for (const [expiresAt, generation, expected] of [[199, claim.generation, 0], [1000, "wrong".repeat(5), 0], [1000, claim.generation, 1]]) {
    const state = fixture({}, { [`online/rooms/${roomId}`]: room,
      ...Object.fromEntries(["A", "B"].flatMap((uid) => [
        [`online/activeV2/${uid}/${sessionId}`, { ...active, uid, expiresAt }],
        [`online/soloSessionClaims/${uid}`, { ...claim, generation }],
      ])) });
    const report = await migrate({ ...state, phase: "live", now: () => 200 });
    assert.equal(report.live.planned, expected);
    assert.equal(report.live.scanned, expected, "stale leases are discarded before fetching historical rooms");
    assert.equal(state.calls.writes, 0);
  }
});

test("favorite owner backfill uses exact deterministic listing ownership and preserves timestamps", async () => {
  const publicSellerId = fleaPublicSellerId("B");
  const path = `anjuPayFleaFavorites/A/sellers/${publicSellerId}`;
  const state = fixture({ [path]: { publicSellerId, updatedAt: 100, name: "saved" },
    "anjuPayFleaListings/listing": { publicSellerId, sellerUid: "B" },
    "anjuPayFleaFavorites/A/sellers/missing": { publicSellerId: "missing", updatedAt: 90 } });
  const report = await migrate({ ...state, apply: true, phase: "owners" });
  assert.equal(report.favorites.backfilled, 1);
  assert.equal(report.favorites.unresolved, 1);
  assert.deepEqual(state.records.get(path), { publicSellerId, updatedAt: 100, name: "saved", sellerUid: "B", sourceListingId: "listing" });
  assert.equal(favoriteOwnerPatch({ publicSellerId }, "bad", { publicSellerId, sellerUid: "C" }), null);
});

test("migration REST CAS retries a concurrent value and keeps credentials out of URLs", async () => {
  let current = { count: 1, revision: 0 };
  let version = 1;
  let injectConflict = true;
  const requests = [];
  const transport = createMigrationRealtimeRest({ databaseURL: "https://demo-example-default-rtdb.firebaseio.com/",
    getAccessToken: async () => ({ access_token: "test-secret" }),
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method });
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      if (options.method === "PUT") {
        if (injectConflict) { current = { count: 5, revision: 1 }; version += 1; injectConflict = false; return { status: 412 }; }
        assert.equal(options.headers["If-Match"], `"${version}"`);
        current = JSON.parse(options.body); version += 1;
      }
      return { ok: true, status: 200, headers: { get: () => `"${version}"` }, json: async () => structuredClone(current) };
    } });
  const result = await transport.ref("online/contactGates/pair").transaction((value) => ({ ...value, count: value.count + 1 }));
  assert.equal(result.committed, true);
  assert.deepEqual(result.snapshot.val(), { count: 6, revision: 1 });
  assert.equal(requests.length, 4);
  assert.equal(requests.every((request) => !request.url.includes("test-secret") && request.url.endsWith(".json")), true);
  const before = requests.length;
  const rejected = await transport.ref("online/contactGates/pair").transaction(() => undefined);
  assert.equal(rejected.committed, false);
  assert.equal(requests.length, before + 1);
});
