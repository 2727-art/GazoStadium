"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");

const requested = process.env.RUN_SOLO_IDLE_RELEASE_EMULATOR_TESTS === "1";
const PROJECT = "demo-solo-idle-release";
if (!requested) {
  test("idle release transactions require an isolated RTDB emulator", {
    skip: "set RUN_SOLO_IDLE_RELEASE_EMULATOR_TESTS=1 with a loopback RTDB emulator",
  }, () => {});
} else {
  const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Refusing a non-loopback database");
  if (process.env.SOLO_IDLE_TEST_PROJECT_ID !== PROJECT) throw new Error("A dedicated demo project is required");
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { normalizeClaim, resourceFenceMatches } = require("../solo-session-v2");
  const { createSoloSessionV2QueueIndex } = require("../solo-session-v2-queue-index");
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const names = ["soloSessionClaimGuardMatches", "acquireSoloSessionClaimGuard",
    "renewSoloSessionClaimGuard", "releaseSoloSessionClaimGuard", "removeSoloSessionResourceIfFenced",
    "releaseSoloSessionV2", "soloSessionV2LockMatches", "acquireSoloSessionV2Locks"];
  const functions = names.map((name) => {
    const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
    assert.ok(match, name);
    const body = source.slice(match.index);
    const end = /\n\}\r?\n/.exec(body);
    assert.ok(end, name);
    return body.slice(0, end.index + 2);
  }).join("\n");
  const UID = "idle-owner";
  const SESSION = "idle_session_123456789012345";
  const TOKEN = "idle_token_12345678901234567";
  const GENERATION = "idle_generation_123456789012";
  const FENCE = { sessionId: SESSION, leaseToken: TOKEN, generation: GENERATION };
  const CLAIM = `online/soloSessionClaims/${UID}`;
  const QUEUE = `online/queueV2/${UID}/${SESSION}`;
  const ACTIVE = `online/activeV2/${UID}/${SESSION}`;
  const LOCK = `online/soloMatchLocksV2/${UID}`;
  let app, peerApp, realtime, peerRealtime;

  function server(database) {
    const context = vm.createContext({ realtime: database, normalizeClaim, resourceFenceMatches,
      SOLO_SESSION_PROTOCOL_VERSION: 2, SOLO_SESSION_CLAIM_GUARD_TTL_MS: 60_000,
      Date, console, objectValue: (value) => value && typeof value === "object" ? value : {},
      soloSessionGeneration: () => crypto.randomBytes(16).toString("base64url"),
      soloSessionClaimRef: (uid) => database.ref(`online/soloSessionClaims/${uid}`),
      soloSessionQueueRef: (uid, session) => database.ref(`online/queueV2/${uid}/${session}`),
      soloSessionActiveRef: (uid, session) => database.ref(`online/activeV2/${uid}/${session}`),
      soloSessionV2QueueIndex: createSoloSessionV2QueueIndex({ realtime: database }),
    });
    vm.runInContext(functions, context);
    return context;
  }
  const stop = (database = realtime) => server(database).releaseSoloSessionV2(UID, { ...FENCE, onlyWaiting: true });
  const value = async (key) => (await realtime.ref(key).get()).val();

  before(() => {
    const options = { projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` };
    app = initializeApp(options, "solo-idle-owner");
    peerApp = initializeApp(options, "solo-idle-peer");
    realtime = getDatabase(app);
    peerRealtime = getDatabase(peerApp);
  });
  beforeEach(async () => {
    // These writes are restricted above to one dedicated demo namespace on loopback.
    await realtime.ref("online").remove();
    const now = Date.now();
    const claim = { protocolVersion: 2, ...FENCE, claimedAt: now - 1000, heartbeatAt: now, expiresAt: now + 60_000 };
    const queue = { protocolVersion: 2, ...FENCE, uid: UID, state: "waiting", joinedAt: now - 1000,
      lastSeen: now, expiresAt: now + 60_000, ratingPreference: "both" };
    await realtime.ref().update({ [CLAIM]: claim, [QUEUE]: queue,
      [`online/queueV2Index/${UID}`]: { ...queue, claimClaimedAt: claim.claimedAt, indexedAt: now } });
  });
  after(async () => {
    realtime?.goOffline(); peerRealtime?.goOffline();
    if (app) await deleteApp(app);
    if (peerApp) await deleteApp(peerApp);
  });

  test("waiting-only release removes the exact queue, index and claim", async () => {
    const result = await stop();
    assert.equal(result.released, true, JSON.stringify(result));
    for (const key of [QUEUE, CLAIM, ACTIVE, LOCK, `online/queueV2Index/${UID}`]) assert.equal(await value(key), null, key);
  });

  test("a room established before the idle deadline is never released", async () => {
    await realtime.ref(ACTIVE).set({ protocolVersion: 2, ...FENCE, roomId: "-AbCdEfGhIjKlMnOpQrS" });
    const before = await value("online");
    const result = await stop();
    assert.equal(result.released, false);
    assert.equal(result.reason, "match-in-progress");
    assert.deepEqual(await value("online"), before);
  });

  test("reserved and offering queues remain unchanged even before active publication", async () => {
    for (const state of ["reserved", "offering"]) {
      await realtime.ref(QUEUE).update({ state, roomId: "-AbCdEfGhIjKlMnOpQrS", attemptId: "attempt_123456789012345678" });
      const before = await value("online");
      assert.equal((await stop()).reason, "match-in-progress");
      assert.deepEqual(await value("online"), before);
    }
  });

  test("a match lock that won first prevents the idle release", async () => {
    await peerRealtime.ref(LOCK).set({ kind: "match", expiresAt: Date.now() + 60_000 });
    const before = await value("online");
    assert.equal((await stop()).reason, "occupied");
    assert.deepEqual(await value("online"), before);
  });

  test("an idle release holding the guard excludes a simultaneous peer match lock", async () => {
    let allowRead, reached;
    const paused = new Promise((resolve) => { allowRead = resolve; });
    const observed = new Promise((resolve) => { reached = resolve; });
    const instrumented = { ref(key) {
      const reference = realtime.ref(key);
      if (key !== ACTIVE) return reference;
      return new Proxy(reference, { get(target, prop) {
        if (prop === "get") return async () => { reached(); await paused; return target.get(); };
        const item = target[prop];
        return typeof item === "function" ? item.bind(target) : item;
      } });
    } };
    const release = stop(instrumented);
    await observed;
    try {
      const lock = { protocolVersion: 2, roomId: "-AbCdEfGhIjKlMnOpQrS", attemptId: "attempt_123456789012345678",
        hostUid: UID, guestUid: "idle-guest", expiresAt: Date.now() + 60_000 };
      const acquired = await server(peerRealtime).acquireSoloSessionV2Locks({
        hostLock: { ...lock, ...FENCE, role: "host" },
        guestLock: { ...lock, sessionId: "guest_session_123456789012", generation: "guest_generation_12345678", role: "guest" },
      });
      assert.equal(acquired, false);
    } finally { allowRead(); }
    const result = await release;
    assert.equal(result.released, true, JSON.stringify(result));
    assert.equal(await value(CLAIM), null);
  });

  test("a stale client never releases a newer session generation", async () => {
    await realtime.ref(CLAIM).update({ generation: "new_generation_1234567890123" });
    const before = await value("online");
    assert.equal((await stop()).reason, "lease-lost");
    assert.deepEqual(await value("online"), before);
  });
}
