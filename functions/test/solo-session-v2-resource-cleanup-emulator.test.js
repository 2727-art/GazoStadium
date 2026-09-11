"use strict";

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, test } = require("node:test");

const RUN = process.env.RUN_FIREBASE_COST_EMULATOR_TESTS === "1";
const PROJECT_ID = process.env.FIREBASE_COST_TEST_PROJECT_ID || "";

function loopback(raw, label) {
  if (!raw || /[\/@]/.test(raw)) throw new Error(`${label} must be a loopback host:port`);
  const url = new URL(`http://${raw}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || !Number.isInteger(Number(url.port)) || Number(url.port) < 1) {
    throw new Error(`${label} must be a loopback host:port`);
  }
  return { host: url.hostname, port: Number(url.port) };
}

if (!RUN) {
  test("cost cleanup integration is opt-in and never targets production", {
    skip: "run test/run-firebase-cost-emulator.js with a dedicated demo project",
  }, () => {});
} else {
  if (PROJECT_ID !== "demo-gazostadium-cost") throw new Error("A dedicated cost demo project is required");
  const databaseTarget = loopback(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "database emulator");
  const authTarget = loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST, "auth emulator");
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require("firebase/app");
  const { getAuth, connectAuthEmulator, signInAnonymously } = require("firebase/auth");
  const {
    getDatabase: getClientDatabase, connectDatabaseEmulator, get, ref, set, goOffline,
  } = require("firebase/database");
  const {
    createSoloSessionV2ResourceCleanup,
    SOLO_SESSION_V2_RESOURCE_CLEANUP_CURSOR_PATH: CURSOR,
    SOLO_SESSION_V2_RESOURCE_CLEANUP_RETRY_BASE_MS: RETRY,
  } = require("../solo-session-v2-resource-cleanup");
  const { createSoloSessionV2QueueIndex } = require("../solo-session-v2-queue-index");

  const NOW = 1_800_000_000_000;
  const EXPIRY = NOW - 3_600_000;
  const SESSION = "cost_session_1234567890123456";
  const TOKEN = "cost_lease_123456789012345678";
  const GENERATION = "cost_generation_1234567890";
  const ATTEMPT = "cost_attempt_1234567890123";
  const CONNECTION = "cost_connection_1234567890";
  const ROOM = "-AbCdEfGhIjKlMnOpQrS";
  const CLAIMS = "online/soloSessionClaims";
  let app;
  let clientApp;
  let realtime;
  let clientDatabase;

  function claim(overrides = {}) {
    return {
      protocolVersion: 2, sessionId: SESSION, leaseToken: TOKEN, generation: GENERATION,
      claimedAt: EXPIRY - 60_000, heartbeatAt: EXPIRY - 10_000, expiresAt: EXPIRY,
      ...overrides,
    };
  }

  function deferredClaim() {
    return claim({ staleCleanupV1: {
      version: 1, token: "cost_cleanup_token_123456789", startedAt: NOW - 1000,
      originalExpiresAt: EXPIRY, deferredAt: NOW, deferCount: 1, nextAttemptAt: NOW + RETRY,
    } });
  }

  async function seedUnresolved(uid) {
    await realtime.ref().update({
      [`${CLAIMS}/${uid}`]: claim(),
      [`online/activeV2/${uid}/${SESSION}`]: {
        protocolVersion: 2, uid, sessionId: SESSION, leaseToken: TOKEN, generation: GENERATION,
        roomId: ROOM, attemptId: ATTEMPT, connectionGeneration: CONNECTION,
        role: "host", lastSeen: EXPIRY - 10_000, expiresAt: EXPIRY,
      },
      [`online/rooms/${ROOM}`]: {
        protocolVersion: 2, signalingVersion: 2, hostUid: uid, guestUid: "cost-guest",
        attemptId: ATTEMPT, connectionGeneration: CONNECTION, status: "active",
        createdAt: EXPIRY - 100_000, expiresAt: EXPIRY,
        members: { [uid]: true, "cost-guest": true },
        sessions: {
          [uid]: { sessionId: SESSION, generation: GENERATION },
          "cost-guest": { sessionId: "cost_guest_session_1234567", generation: "cost_guest_generation_1234" },
        },
      },
    });
  }

  function cleanup(options = {}) {
    return createSoloSessionV2ResourceCleanup({
      realtime, queueIndex: createSoloSessionV2QueueIndex({ realtime }), ...options,
    });
  }

  describe("cost cleanup uses real indexed RTDB queries and exact transactions", {
    concurrency: false, timeout: 60_000,
  }, () => {
    before(async () => {
      const databaseURL = `https://${PROJECT_ID}-default-rtdb.firebaseio.com`;
      app = initializeApp({ projectId: PROJECT_ID, databaseURL }, "cost-cleanup-admin");
      realtime = getDatabase(app);
      clientApp = initializeClientApp({ projectId: PROJECT_ID, databaseURL, apiKey: "demo-cost-key" }, "cost-cleanup-client");
      const auth = getAuth(clientApp);
      connectAuthEmulator(auth, `http://${authTarget.host}:${authTarget.port}`, { disableWarnings: true });
      await signInAnonymously(auth);
      clientDatabase = getClientDatabase(clientApp);
      connectDatabaseEmulator(clientDatabase, databaseTarget.host, databaseTarget.port);
    });

    beforeEach(async () => {
      // The project is hard-locked above to this dedicated local emulator namespace.
      await realtime.ref().update({
        [CLAIMS]: null, [CURSOR]: null, "online/activeV2": null,
        "online/queueV2": null, "online/queueV2Index": null, [`online/rooms/${ROOM}`]: null,
      });
    });

    after(async () => {
      if (clientDatabase) goOffline(clientDatabase);
      if (realtime) realtime.goOffline();
      if (clientApp) await deleteClientApp(clientApp);
      if (app) await deleteApp(app);
    });

    test("an unresolved claim stays expired, skips heavy work, and is removable once due and finalized", async () => {
      await seedUnresolved("cost-owner");
      const run = cleanup();
      const first = await run(NOW);
      assert.equal(first.activeDeferred, 1);
      const stored = (await realtime.ref(`${CLAIMS}/cost-owner`).get()).val();
      assert.equal(stored.expiresAt, EXPIRY);
      assert.equal(stored.staleCleanupV1.nextAttemptAt, NOW + RETRY);
      const skipped = await run(NOW + 5 * 60_000);
      assert.equal(skipped.deferredSkipped, 1);
      assert.equal(skipped.marked, 0);
      assert.equal(skipped.activeExamined, 0);
      assert.deepEqual((await realtime.ref(`${CLAIMS}/cost-owner`).get()).val(), stored);
      await realtime.ref(`online/rooms/${ROOM}/serverFinalized`).set(true);
      const final = await run(NOW + RETRY + 1);
      assert.equal(final.claimsRemoved, 1);
      assert.equal(final.activeRemoved, 1);
      assert.equal((await realtime.ref(`${CLAIMS}/cost-owner`).get()).exists(), false);
    });

    test("equal-expiry deferred pages cannot starve a due claim beyond the per-run scan limit", async () => {
      const claims = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`cost-${i}`, deferredClaim()]));
      claims["cost-z-due"] = claim();
      await realtime.ref(CLAIMS).set(claims);
      const run = cleanup({ batchSize: 2, maxPages: 2 });
      const first = await run(NOW);
      assert.equal(first.deferredSkipped, 4);
      assert.equal(first.scanLimited, true);
      assert.equal(first.claimsRemoved, 0);
      assert.equal((await realtime.ref(CURSOR).get()).val().uid, "cost-3");
      // A fresh factory emulates the next scheduler instance, without in-memory state.
      const second = await cleanup({ batchSize: 2, maxPages: 2 })(NOW + 5 * 60_000);
      assert.equal(second.deferredSkipped, 2);
      assert.equal(second.claimsRemoved, 1);
      assert.equal((await realtime.ref(CURSOR).get()).exists(), false);
      assert.equal((await realtime.ref(CLAIMS).get()).numChildren(), 6);
    });

    test("a claim renewed after query is not deleted by a stale cleanup transaction", async () => {
      await realtime.ref(`${CLAIMS}/cost-renewed`).set(claim());
      const newer = claim({ generation: "cost_new_generation_123456", heartbeatAt: NOW, expiresAt: NOW + 60_000 });
      let renewed = false;
      const racingRealtime = { ref(path) {
        const target = realtime.ref(path);
        if (path !== `${CLAIMS}/cost-renewed`) return target;
        return new Proxy(target, { get(object, key) {
          if (key === "transaction") return async (...args) => {
            if (!renewed) { renewed = true; await target.set(newer); }
            return target.transaction(...args);
          };
          const value = object[key];
          return typeof value === "function" ? value.bind(object) : value;
        } });
      } };
      const run = createSoloSessionV2ResourceCleanup({ realtime: racingRealtime, queueIndex: createSoloSessionV2QueueIndex({ realtime }) });
      const result = await run(NOW);
      assert.equal(result.conflicts, 1);
      assert.equal(result.claimsRemoved, 0);
      assert.deepEqual((await realtime.ref(`${CLAIMS}/cost-renewed`).get()).val(), newer);
    });

    test("the administrative cursor is neither readable nor writable by an authenticated player", async () => {
      await realtime.ref(CURSOR).set({ version: 1, uid: "cost-owner", expiresAt: EXPIRY, updatedAt: NOW });
      await assert.rejects(get(ref(clientDatabase, CURSOR)), /permission.denied/i);
      await assert.rejects(set(ref(clientDatabase, CURSOR), { version: 1 }), /permission.denied/i);
    });
  });
}
