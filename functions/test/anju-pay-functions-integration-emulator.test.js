"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, describe, test } = require("node:test");

const RUN_FLAG = "RUN_FIRESTORE_EMULATOR_TESTS";
const PROJECT_ID_ENV = "ANJU_PAY_FIRESTORE_TEST_PROJECT_ID";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const PROJECT_ID = process.env[PROJECT_ID_ENV] || "";

function parseLoopbackTarget(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!value || value.includes("://") || value.includes("/") || value.includes("@")) {
    throw new Error(`${label} must be a bare loopback host and port.`);
  }
  let parsed;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new Error(`${label} must be a valid loopback host and port.`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(parsed.port);
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`${label} must use a loopback host.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must include a valid port.`);
  }
  return { host, port };
}

function requireDemoProjectId(value) {
  if (!/^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(value)) {
    throw new Error(`${PROJECT_ID_ENV} must be an explicit demo-* project ID.`);
  }
  return value;
}

function integrationTarget() {
  return {
    projectId: requireDemoProjectId(PROJECT_ID),
    auth: parseLoopbackTarget(
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
      "FIREBASE_AUTH_EMULATOR_HOST",
    ),
    database: parseLoopbackTarget(
      process.env.FIREBASE_DATABASE_EMULATOR_HOST,
      "FIREBASE_DATABASE_EMULATOR_HOST",
    ),
    firestore: parseLoopbackTarget(
      process.env.FIRESTORE_EMULATOR_HOST,
      "FIRESTORE_EMULATOR_HOST",
    ),
    functions: parseLoopbackTarget(
      process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001",
      "FUNCTIONS_EMULATOR_HOST",
    ),
  };
}

if (!RUN_REQUESTED) {
  test("AnjuPay Functions integration tests are opt-in and never use production", {
    skip: `set ${RUN_FLAG}=1 and ${PROJECT_ID_ENV}=demo-* inside Firebase Emulator`,
  }, () => {});
} else {
  const target = integrationTarget();
  const {
    deleteApp: deleteAdminApp,
    initializeApp: initializeAdminApp,
  } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const {
    deleteApp: deleteClientApp,
    initializeApp: initializeClientApp,
  } = require("firebase/app");
  const {
    connectAuthEmulator,
    getAuth,
    signInAnonymously,
  } = require("firebase/auth");
  const {
    connectFunctionsEmulator,
    getFunctions,
    httpsCallable,
  } = require("firebase/functions");
  const PRODUCT_CATALOG = require("../product-catalog");

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const clientApps = [];
  let adminApp;
  let firestore;
  let realtime;

  function eventId(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
  }

  function activeLedgerConfig() {
    return {
      enabled: true,
      activatedAt: Timestamp.fromMillis(Date.now() - 60_000),
    };
  }

  async function restoreActiveLedgerConfig() {
    await firestore.doc("systemConfig/anjuPayLedger").set(activeLedgerConfig());
  }

  async function createCaller(label) {
    const app = initializeClientApp({
      apiKey: "demo-anju-pay-emulator-key",
      authDomain: `${target.projectId}.firebaseapp.com`,
      projectId: target.projectId,
    }, `anju-pay-client-${suiteId}-${label}`);
    clientApps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(
      auth,
      `http://${target.auth.host}:${target.auth.port}`,
      { disableWarnings: true },
    );
    const credential = await signInAnonymously(auth);
    const functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(functions, target.functions.host, target.functions.port);
    return {
      uid: credential.user.uid,
      economyAction: httpsCallable(functions, "economyAction"),
      valueMarketAction: httpsCallable(functions, "valueMarketAction"),
    };
  }

  async function invoke(callable, data) {
    return (await callable(data)).data;
  }

  async function seedLegacyWallet(uid, balance) {
    const now = Date.now();
    await firestore.doc(`wallets/${uid}`).set({
      balance,
      reservedIncoming: 0,
      initializedAt: now,
      updatedAt: now,
    });
  }

  async function readLedger(uid) {
    const walletReference = firestore.doc(`wallets/${uid}`);
    const [walletSnapshot, entriesSnapshot] = await Promise.all([
      walletReference.get(),
      walletReference.collection("anjuPayEntries").orderBy("sequence", "asc").get(),
    ]);
    return {
      wallet: walletSnapshot.data(),
      entries: entriesSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
    };
  }

  function assertContinuousLedger(ledger, expectedBalance) {
    assert.equal(ledger.wallet.balance, expectedBalance);
    assert.equal(ledger.entries.length, ledger.wallet.ledgerSequence + 1);
    assert.deepEqual(
      ledger.entries.map((entry) => entry.sequence),
      Array.from({ length: ledger.entries.length }, (_, index) => index),
    );
    assert.equal(ledger.entries[0].id, "opening-v1");
    assert.equal(ledger.entries[0].delta, 0);
    assert.equal(ledger.entries[0].balanceBefore, ledger.entries[0].balanceAfter);
    ledger.entries.forEach((entry, index) => {
      assert.equal(entry.delta, entry.balanceAfter - entry.balanceBefore);
      assert.equal(
        (entry.components || []).reduce((sum, component) => sum + component.delta, 0),
        entry.delta,
      );
      if (index > 0) {
        assert.equal(entry.balanceBefore, ledger.entries[index - 1].balanceAfter);
      }
    });
    assert.equal(ledger.entries.at(-1).balanceAfter, expectedBalance);
  }

  describe("AnjuPay production transaction paths on Firebase Emulator", {
    concurrency: false,
    timeout: 120_000,
  }, () => {
    before(async () => {
      adminApp = initializeAdminApp({
        projectId: target.projectId,
        databaseURL: `https://${target.projectId}-default-rtdb.firebaseio.com`,
      }, `anju-pay-admin-${suiteId}`);
      firestore = getFirestore(adminApp);
      realtime = getDatabase(adminApp);
      await restoreActiveLedgerConfig();
    });

    after(async () => {
      await Promise.all(clientApps.map((app) => deleteClientApp(app)));
      await deleteAdminApp(adminApp);
    });

    test("one normal 1on1 caller records both outcomes without occupying the opponent acknowledgement", async () => {
      const host = await createCaller("solo-finalize-host");
      const guest = await createCaller("solo-finalize-guest");
      const roomId = eventId(`${suiteId}:solo-finalize`).slice(0, 20);
      const createdAt = Date.now() - 1_000;
      await realtime.ref(`online/rooms/${roomId}`).set({
        status: "active",
        createdAt,
        hostUid: host.uid,
        guestUid: guest.uid,
        members: {
          [host.uid]: true,
          [guest.uid]: true,
        },
        players: {
          [host.uid]: {
            uid: host.uid,
            name: "HOST",
            rating: 1_000,
            startingHp: 30,
          },
          [guest.uid]: {
            uid: guest.uid,
            name: "GUEST",
            rating: 1_000,
            startingHp: 5,
          },
        },
        rounds: {
          1: {
            scores: {
              [host.uid]: 1,
              [guest.uid]: 10,
            },
          },
        },
      });

      await assert.rejects(
        invoke(host.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "win",
          roomId,
          finalizationVersion: 3,
        }),
        /決着通信バージョンが不正/,
      );
      await assert.rejects(
        invoke(host.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "loss",
          roomId,
          finalizationVersion: 2,
        }),
        /確定スコアと一致しません/,
      );
      assert.equal(
        (await realtime.ref(`online/rooms/${roomId}/serverFinalized`).get()).exists(),
        false,
      );

      const tooFresh = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(tooFresh.outcome, "pending");
      assert.equal(Number(tooFresh.retryAfterMs) > 0, true);
      assert.equal(
        (await firestore.doc(`verifiedMatchClaims/${eventId(`${host.uid}:solo:${roomId}`)}`).get()).exists,
        false,
      );
      await realtime.ref(`online/rooms/${roomId}/createdAt`).set(Date.now() - 60_000);

      const first = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(first.outcome, "recorded");
      assert.equal(first.acceptedFinalizationVersion, 2);
      assert.equal(first.resultToken, eventId(`${host.uid}:solo:${roomId}`));
      assert.equal(first.profileProjectionMode, undefined);

      const finalizedRoom = (await realtime.ref(`online/rooms/${roomId}`).get()).val();
      assert.equal(finalizedRoom.resultClaims, undefined);
      assert.equal(finalizedRoom.finished, undefined);
      assert.equal(finalizedRoom.serverFinalized.version, 1);
      assert.equal(finalizedRoom.serverFinalized.round, 1);

      const [hostClaim, guestClaim] = await Promise.all([
        firestore.doc(`verifiedMatchClaims/${eventId(`${host.uid}:solo:${roomId}`)}`).get(),
        firestore.doc(`verifiedMatchClaims/${eventId(`${guest.uid}:solo:${roomId}`)}`).get(),
      ]);
      assert.equal(hostClaim.exists, true);
      assert.equal(guestClaim.exists, true);
      assert.equal(hostClaim.get("profileProjectionVersion"), undefined);
      assert.equal(guestClaim.get("profileProjectionVersion"), undefined);
      assert.equal(
        (await firestore.doc(`soloProfileProjectionQueues/${host.uid}`).get()).exists,
        false,
      );
      assert.equal(
        (await firestore.doc(`soloProfileProjectionQueues/${guest.uid}`).get()).exists,
        false,
      );

      const [hostRetry, guestRetry] = await Promise.all([
        invoke(host.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "win",
          roomId,
          finalizationVersion: 2,
        }),
        invoke(guest.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "loss",
          roomId,
          finalizationVersion: 2,
        }),
      ]);
      assert.equal(hostRetry.outcome, "duplicate");
      assert.equal(guestRetry.outcome, "duplicate");

      const [hostProgress, guestProgress] = await Promise.all([
        firestore.doc(`economyProgress/${host.uid}`).get(),
        firestore.doc(`economyProgress/${guest.uid}`).get(),
      ]);
      assert.equal(hostProgress.get("achievementStats.totalMatches"), 1);
      assert.equal(guestProgress.get("achievementStats.totalMatches"), 1);
    });

    test("normal 1on1 profile projection updates both marked V2 participants exactly once", async () => {
      const host = await createCaller("solo-projection-both-host");
      const guest = await createCaller("solo-projection-both-guest");
      const roomId = eventId(`${suiteId}:solo-projection-both`).slice(0, 20);
      const hostToken = eventId(`${host.uid}:solo:${roomId}`);
      const guestToken = eventId(`${guest.uid}:solo:${roomId}`);
      const profileUpdatedAt = Date.now() - 120_000;
      await Promise.all([
        realtime.ref(`online/profiles/${host.uid}`).set({
          name: "HOST OLD",
          pursuitLine: "HOST OLD LINE",
          wins: 2,
          losses: 1,
          draws: 0,
          streak: 1,
          bestStreak: 2,
          rating: 1_000,
          updatedAt: profileUpdatedAt,
          appliedResults: {
            [hostToken]: "loss",
          },
        }),
        realtime.ref(`online/profiles/${guest.uid}`).set({
          name: "GUEST OLD",
          pursuitLine: "GUEST OLD LINE",
          wins: 1,
          losses: 3,
          draws: 1,
          streak: 0,
          bestStreak: 1,
          rating: 1_000,
          updatedAt: profileUpdatedAt,
        }),
        realtime.ref(`online/overallProfiles/${host.uid}`).set({
          name: "HOST OLD",
          wins: 3,
          losses: 1,
          draws: 0,
          streak: 1,
          bestStreak: 2,
          rating: 1_000,
          modes: {
            solo: { wins: 2, losses: 1, draws: 0, matches: 3, points: 6 },
            strategy: { wins: 1, losses: 0, draws: 0, matches: 1, points: 3 },
            team: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
            royale: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          },
          updatedAt: profileUpdatedAt,
          appliedResults: {
            [hostToken]: "loss",
          },
        }),
        realtime.ref(`online/overallProfiles/${guest.uid}`).set({
          name: "GUEST OLD",
          wins: 1,
          losses: 4,
          draws: 1,
          streak: 0,
          bestStreak: 1,
          rating: 1_000,
          modes: {
            solo: { wins: 1, losses: 3, draws: 1, matches: 5, points: 4 },
            strategy: { wins: 0, losses: 1, draws: 0, matches: 1, points: 0 },
            team: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
            royale: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          },
          updatedAt: profileUpdatedAt,
        }),
      ]);
      await realtime.ref(`online/rooms/${roomId}`).set({
        status: "active",
        protocolVersion: 2,
        createdAt: Date.now() - 60_000,
        hostUid: host.uid,
        guestUid: guest.uid,
        members: {
          [host.uid]: true,
          [guest.uid]: true,
        },
        players: {
          [host.uid]: {
            uid: host.uid,
            name: "HOST NEW",
            pursuitLine: "HOST NEW LINE",
            rating: 1_000,
            startingHp: 30,
            profileProjectionVersion: 2,
          },
          [guest.uid]: {
            uid: guest.uid,
            name: "GUEST NEW",
            pursuitLine: "GUEST NEW LINE",
            rating: 1_000,
            startingHp: 5,
            profileProjectionVersion: 2,
          },
        },
        rounds: {
          1: {
            scores: {
              [host.uid]: 1,
              [guest.uid]: 10,
            },
          },
        },
      });

      const first = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(first.outcome, "recorded");
      assert.equal(first.profileProjectionMode, "server-v2");
      assert.equal(first.profileProjectionPending, false);
      assert.equal(first.soloProfile.name, "HOST NEW");
      assert.equal(first.soloProfile.wins, 3);
      assert.equal(first.soloProfile.losses, 1);
      assert.equal(first.soloProfile.streak, 2);
      assert.equal(first.soloProfile.bestStreak, 2);
      assert.equal(first.soloProfile.rating, 1_016);
      assert.equal(first.overallProfile.modes.solo.wins, 3);
      assert.equal(first.overallProfile.modes.strategy.wins, 1);

      const [
        hostProfileSnapshot,
        guestProfileSnapshot,
        hostOverallSnapshot,
        guestOverallSnapshot,
        hostClaim,
        guestClaim,
        hostQueue,
        guestQueue,
        hostJobs,
        guestJobs,
      ] = await Promise.all([
        realtime.ref(`online/profiles/${host.uid}`).get(),
        realtime.ref(`online/profiles/${guest.uid}`).get(),
        realtime.ref(`online/overallProfiles/${host.uid}`).get(),
        realtime.ref(`online/overallProfiles/${guest.uid}`).get(),
        firestore.doc(`verifiedMatchClaims/${hostToken}`).get(),
        firestore.doc(`verifiedMatchClaims/${guestToken}`).get(),
        firestore.doc(`soloProfileProjectionQueues/${host.uid}`).get(),
        firestore.doc(`soloProfileProjectionQueues/${guest.uid}`).get(),
        firestore.collection(`soloProfileProjectionQueues/${host.uid}/jobs`).get(),
        firestore.collection(`soloProfileProjectionQueues/${guest.uid}/jobs`).get(),
      ]);
      const hostProfile = hostProfileSnapshot.val();
      const guestProfile = guestProfileSnapshot.val();
      const hostOverall = hostOverallSnapshot.val();
      const guestOverall = guestOverallSnapshot.val();
      assert.equal(hostProfile.name, "HOST NEW");
      assert.equal(hostProfile.pursuitLine, "HOST NEW LINE");
      assert.equal(hostProfile.wins, 3);
      assert.equal(hostProfile.losses, 1);
      assert.equal(hostProfile.streak, 2);
      assert.equal(hostProfile.rating, 1_016);
      assert.equal(hostProfile.appliedResults[hostToken], "win");
      assert.equal(hostProfile.serverProjectionReceipts, `${hostToken}:win`);
      assert.equal(hostProfile.serverProjectionSequence, 1);
      assert.equal(guestProfile.name, "GUEST NEW");
      assert.equal(guestProfile.pursuitLine, "GUEST NEW LINE");
      assert.equal(guestProfile.wins, 1);
      assert.equal(guestProfile.losses, 4);
      assert.equal(guestProfile.draws, 1);
      assert.equal(guestProfile.streak, 0);
      assert.equal(guestProfile.rating, 984);
      assert.equal(guestProfile.appliedResults[guestToken], "loss");
      assert.equal(guestProfile.serverProjectionReceipts, `${guestToken}:loss`);
      assert.equal(guestProfile.serverProjectionSequence, 1);
      assert.equal(hostOverall.wins, 4);
      assert.equal(hostOverall.losses, 1);
      assert.equal(hostOverall.modes.solo.wins, 3);
      assert.equal(hostOverall.modes.strategy.wins, 1);
      assert.equal(hostOverall.rating, 1_016);
      assert.equal(hostOverall.appliedResults[hostToken], "win");
      assert.equal(hostOverall.serverProjectionReceipts, `${hostToken}:win`);
      assert.equal(hostOverall.serverProjectionSequence, 1);
      assert.equal(guestOverall.wins, 1);
      assert.equal(guestOverall.losses, 5);
      assert.equal(guestOverall.draws, 1);
      assert.equal(guestOverall.modes.solo.losses, 4);
      assert.equal(guestOverall.modes.strategy.losses, 1);
      assert.equal(guestOverall.rating, 984);
      assert.equal(guestOverall.appliedResults[guestToken], "loss");
      assert.equal(guestOverall.serverProjectionReceipts, `${guestToken}:loss`);
      assert.equal(guestOverall.serverProjectionSequence, 1);
      assert.equal(hostClaim.get("profileProjectionVersion"), 2);
      assert.equal(hostClaim.get("profileProjectionStatus"), "complete");
      assert.equal(hostClaim.get("projectionSequence"), 1);
      assert.equal(guestClaim.get("profileProjectionVersion"), 2);
      assert.equal(guestClaim.get("profileProjectionStatus"), "complete");
      assert.equal(guestClaim.get("projectionSequence"), 1);
      assert.equal(hostJobs.empty, true);
      assert.equal(guestJobs.empty, true);
      assert.equal(hostQueue.get("pending"), false);
      assert.equal(guestQueue.get("pending"), false);
      assert.equal(hostQueue.get("queueRevision"), 1);
      assert.equal(guestQueue.get("queueRevision"), 1);
      assert.equal(hostQueue.get("profileProjectionEnrolled"), true);
      assert.equal(guestQueue.get("profileProjectionEnrolled"), true);
      assert.equal(hostQueue.get("profileProjectionVersion"), 2);
      assert.equal(guestQueue.get("profileProjectionVersion"), 2);

      const [hostRetry, guestRetry] = await Promise.all([
        invoke(host.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "win",
          roomId,
          finalizationVersion: 2,
        }),
        invoke(guest.economyAction, {
          action: "record_match",
          mode: "solo",
          outcome: "loss",
          roomId,
          finalizationVersion: 2,
        }),
      ]);
      assert.equal(hostRetry.outcome, "duplicate");
      assert.equal(guestRetry.outcome, "duplicate");
      assert.equal(hostRetry.profileProjectionPending, false);
      assert.equal(guestRetry.profileProjectionPending, false);

      const [
        hostAfterRetry,
        guestAfterRetry,
        hostOverallAfterRetry,
        guestOverallAfterRetry,
        hostJobsAfterRetry,
        guestJobsAfterRetry,
      ] = await Promise.all([
        realtime.ref(`online/profiles/${host.uid}`).get(),
        realtime.ref(`online/profiles/${guest.uid}`).get(),
        realtime.ref(`online/overallProfiles/${host.uid}`).get(),
        realtime.ref(`online/overallProfiles/${guest.uid}`).get(),
        firestore.collection(`soloProfileProjectionQueues/${host.uid}/jobs`).get(),
        firestore.collection(`soloProfileProjectionQueues/${guest.uid}/jobs`).get(),
      ]);
      assert.equal(hostAfterRetry.val().wins, 3);
      assert.equal(guestAfterRetry.val().losses, 4);
      assert.equal(hostOverallAfterRetry.val().modes.solo.wins, 3);
      assert.equal(guestOverallAfterRetry.val().modes.solo.losses, 4);
      assert.equal(Object.keys(hostAfterRetry.val().appliedResults).length, 1);
      assert.equal(Object.keys(guestAfterRetry.val().appliedResults).length, 1);
      assert.equal(Object.keys(hostOverallAfterRetry.val().appliedResults).length, 1);
      assert.equal(Object.keys(guestOverallAfterRetry.val().appliedResults).length, 1);
      assert.equal(hostJobsAfterRetry.empty, true);
      assert.equal(guestJobsAfterRetry.empty, true);

      await firestore.doc(`verifiedMatchClaims/${hostToken}`).update({
        profileProjectionStatus: "failed",
      });
      const failedProjectionRetry = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(failedProjectionRetry.outcome, "duplicate");
      assert.equal(failedProjectionRetry.profileProjectionMode, undefined);
    });

    test("a projection quarantined during recording or duplicate retry never suppresses client recovery", async () => {
      const host = await createCaller("solo-projection-quarantine-host");
      const guest = await createCaller("solo-projection-quarantine-guest");
      const roomId = eventId(`${suiteId}:solo-projection-quarantine`).slice(0, 20);
      const hostToken = eventId(`${host.uid}:solo:${roomId}`);
      await realtime.ref(`online/profiles/${host.uid}`).set({
        name: "HOST",
        pursuitLine: "HOST LINE",
        wins: 0,
        losses: 0,
        draws: 0,
        streak: 0,
        bestStreak: 0,
        rating: 1_000,
        updatedAt: Date.now() - 120_000,
        serverProjectionReceipts: `${hostToken}:loss`,
        serverProjectionSequence: 1,
      });
      await realtime.ref(`online/rooms/${roomId}`).set({
        status: "active",
        protocolVersion: 2,
        createdAt: Date.now() - 60_000,
        hostUid: host.uid,
        guestUid: guest.uid,
        members: {
          [host.uid]: true,
          [guest.uid]: true,
        },
        players: {
          [host.uid]: {
            uid: host.uid,
            name: "HOST",
            pursuitLine: "HOST LINE",
            rating: 1_000,
            startingHp: 30,
            profileProjectionVersion: 2,
          },
          [guest.uid]: {
            uid: guest.uid,
            name: "GUEST",
            pursuitLine: "GUEST LINE",
            rating: 1_000,
            startingHp: 5,
          },
        },
        rounds: {
          1: {
            scores: {
              [host.uid]: 1,
              [guest.uid]: 10,
            },
          },
        },
      });

      const result = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      const [claim, queue, jobs] = await Promise.all([
        firestore.doc(`verifiedMatchClaims/${hostToken}`).get(),
        firestore.doc(`soloProfileProjectionQueues/${host.uid}`).get(),
        firestore.collection(`soloProfileProjectionQueues/${host.uid}/jobs`).get(),
      ]);
      assert.equal(result.outcome, "recorded");
      assert.equal(result.profileProjectionMode, undefined);
      assert.equal(claim.get("profileProjectionStatus"), "failed");
      assert.equal(queue.get("pending"), false);
      assert.equal(jobs.empty, true);

      await Promise.all([
        claim.ref.update({ profileProjectionStatus: "pending" }),
        queue.ref.set({ pending: true, updatedAt: Date.now() }, { merge: true }),
        queue.ref.collection("jobs").doc(hostToken).set({
          profileProjectionVersion: 2,
          uid: host.uid,
          roomId,
          resultToken: hostToken,
          outcome: "win",
          name: "HOST",
          pursuitLine: "HOST LINE",
          opponentRating: 1_000,
          projectionSequence: claim.get("projectionSequence"),
          createdAt: claim.get("createdAt"),
        }),
      ]);
      const duplicate = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      const [claimAfterRetry, queueAfterRetry, jobsAfterRetry] = await Promise.all([
        claim.ref.get(),
        queue.ref.get(),
        queue.ref.collection("jobs").get(),
      ]);
      assert.equal(duplicate.outcome, "duplicate");
      assert.equal(duplicate.profileProjectionMode, undefined);
      assert.equal(claimAfterRetry.get("profileProjectionStatus"), "failed");
      assert.equal(queueAfterRetry.get("pending"), false);
      assert.equal(jobsAfterRetry.empty, true);
    });

    test("normal 1on1 profile projection only updates the marked participant in a mixed V2 room", async () => {
      const host = await createCaller("solo-projection-mixed-host");
      const guest = await createCaller("solo-projection-mixed-guest");
      const roomId = eventId(`${suiteId}:solo-projection-mixed`).slice(0, 20);
      const profileUpdatedAt = Date.now() - 120_000;
      const hostInitialProfile = {
        name: "HOST OLD",
        pursuitLine: "HOST OLD LINE",
        wins: 4,
        losses: 2,
        draws: 0,
        streak: 2,
        bestStreak: 3,
        rating: 1_000,
        updatedAt: profileUpdatedAt,
      };
      const hostInitialOverall = {
        name: "HOST OLD",
        wins: 4,
        losses: 2,
        draws: 0,
        streak: 2,
        bestStreak: 3,
        rating: 1_000,
        modes: {
          solo: { wins: 4, losses: 2, draws: 0, matches: 6, points: 12 },
          strategy: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          team: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          royale: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
        },
        updatedAt: profileUpdatedAt,
      };
      const guestInitialProfile = {
        name: "GUEST LEGACY",
        pursuitLine: "UNCHANGED",
        wins: 7,
        losses: 8,
        draws: 9,
        streak: 1,
        bestStreak: 4,
        rating: 1_111,
        updatedAt: profileUpdatedAt,
        appliedResults: {
          [eventId(`${guest.uid}:legacy-sentinel`)]: "draw",
        },
      };
      const guestInitialOverall = {
        name: "GUEST LEGACY",
        wins: 7,
        losses: 8,
        draws: 9,
        streak: 1,
        bestStreak: 4,
        rating: 1_111,
        modes: {
          solo: { wins: 7, losses: 8, draws: 9, matches: 24, points: 30 },
          strategy: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          team: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
          royale: { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 },
        },
        updatedAt: profileUpdatedAt,
        appliedResults: {
          [eventId(`${guest.uid}:overall-legacy-sentinel`)]: "draw",
        },
      };
      await Promise.all([
        realtime.ref(`online/profiles/${host.uid}`).set(hostInitialProfile),
        realtime.ref(`online/overallProfiles/${host.uid}`).set(hostInitialOverall),
        realtime.ref(`online/profiles/${guest.uid}`).set(guestInitialProfile),
        realtime.ref(`online/overallProfiles/${guest.uid}`).set(guestInitialOverall),
      ]);
      await realtime.ref(`online/rooms/${roomId}`).set({
        status: "active",
        protocolVersion: 2,
        createdAt: Date.now() - 60_000,
        hostUid: host.uid,
        guestUid: guest.uid,
        members: {
          [host.uid]: true,
          [guest.uid]: true,
        },
        players: {
          [host.uid]: {
            uid: host.uid,
            name: "HOST PROJECTED",
            pursuitLine: "HOST PROJECTED LINE",
            rating: 1_000,
            startingHp: 30,
            profileProjectionVersion: 2,
          },
          [guest.uid]: {
            uid: guest.uid,
            name: "GUEST LEGACY",
            pursuitLine: "UNCHANGED",
            rating: 1_000,
            startingHp: 5,
          },
        },
        rounds: {
          1: {
            scores: {
              [host.uid]: 1,
              [guest.uid]: 10,
            },
          },
        },
      });

      const result = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(result.outcome, "recorded");
      assert.equal(result.profileProjectionMode, "server-v2");
      assert.equal(result.profileProjectionPending, false);
      assert.equal(result.soloProfile.name, "HOST PROJECTED");
      assert.equal(result.soloProfile.wins, 5);

      const hostToken = eventId(`${host.uid}:solo:${roomId}`);
      const guestToken = eventId(`${guest.uid}:solo:${roomId}`);
      const [
        hostProfile,
        hostOverall,
        guestProfile,
        guestOverall,
        hostClaim,
        guestClaim,
        hostQueue,
        guestQueue,
        hostJobs,
        guestJobs,
      ] = await Promise.all([
        realtime.ref(`online/profiles/${host.uid}`).get(),
        realtime.ref(`online/overallProfiles/${host.uid}`).get(),
        realtime.ref(`online/profiles/${guest.uid}`).get(),
        realtime.ref(`online/overallProfiles/${guest.uid}`).get(),
        firestore.doc(`verifiedMatchClaims/${hostToken}`).get(),
        firestore.doc(`verifiedMatchClaims/${guestToken}`).get(),
        firestore.doc(`soloProfileProjectionQueues/${host.uid}`).get(),
        firestore.doc(`soloProfileProjectionQueues/${guest.uid}`).get(),
        firestore.collection(`soloProfileProjectionQueues/${host.uid}/jobs`).get(),
        firestore.collection(`soloProfileProjectionQueues/${guest.uid}/jobs`).get(),
      ]);
      assert.equal(hostProfile.val().wins, 5);
      assert.equal(hostProfile.val().rating, 1_016);
      assert.equal(hostProfile.val().appliedResults[hostToken], "win");
      assert.equal(hostOverall.val().modes.solo.wins, 5);
      assert.equal(hostOverall.val().rating, 1_016);
      assert.equal(hostOverall.val().appliedResults[hostToken], "win");
      assert.deepEqual(guestProfile.val(), guestInitialProfile);
      assert.deepEqual(guestOverall.val(), guestInitialOverall);
      assert.equal(hostClaim.get("profileProjectionVersion"), 2);
      assert.equal(hostClaim.get("profileProjectionStatus"), "complete");
      assert.equal(hostClaim.get("projectionSequence"), 1);
      assert.equal(guestClaim.get("profileProjectionVersion"), undefined);
      assert.equal(guestClaim.get("profileProjectionStatus"), undefined);
      assert.equal(hostQueue.get("pending"), false);
      assert.equal(hostQueue.get("queueRevision"), 1);
      assert.equal(hostQueue.get("profileProjectionEnrolled"), true);
      assert.equal(hostQueue.get("profileProjectionVersion"), 2);
      assert.equal(guestQueue.exists, false);
      assert.equal(hostJobs.empty, true);
      assert.equal(guestJobs.empty, true);

      const legacyRetry = await invoke(guest.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "loss",
        roomId,
        finalizationVersion: 2,
      });
      assert.equal(legacyRetry.outcome, "duplicate");
      assert.equal(legacyRetry.profileProjectionMode, undefined);
      assert.deepEqual(
        (await realtime.ref(`online/profiles/${guest.uid}`).get()).val(),
        guestInitialProfile,
      );
      assert.deepEqual(
        (await realtime.ref(`online/overallProfiles/${guest.uid}`).get()).val(),
        guestInitialOverall,
      );
    });

    test("legacy normal 1on1 callers wait through the anti-farm window instead of timing out", async () => {
      const host = await createCaller("legacy-normal-host");
      const guest = await createCaller("legacy-normal-guest");
      const roomId = "-LegacyFinishWait001";
      await realtime.ref(`online/rooms/${roomId}`).set({
        status: "active",
        createdAt: Date.now() - 29_800,
        hostUid: host.uid,
        guestUid: guest.uid,
        members: {
          [host.uid]: true,
          [guest.uid]: true,
        },
        players: {
          [host.uid]: {
            uid: host.uid,
            name: "HOST",
            rating: 1_000,
            startingHp: 30,
          },
          [guest.uid]: {
            uid: guest.uid,
            name: "GUEST",
            rating: 1_000,
            startingHp: 5,
          },
        },
        rounds: {
          1: {
            scores: {
              [host.uid]: 1,
              [guest.uid]: 10,
            },
          },
        },
      });

      const result = await invoke(host.economyAction, {
        action: "record_match",
        mode: "solo",
        outcome: "win",
        roomId,
      });
      assert.equal(result.outcome, "recorded");
      assert.equal(result.acceptedFinalizationVersion, 1);
      assert.equal(
        (await firestore.doc(`verifiedMatchClaims/${eventId(`${guest.uid}:solo:${roomId}`)}`).get()).exists,
        true,
      );
    });

    test("concurrent distinct purchases use the real callable and keep paging pinned", async () => {
      const caller = await createCaller("purchases");
      const openingBalance = 5_000;
      const initialProducts = [
        "reaction_color",
        "reaction_best_shot",
        "reaction_composition",
        "reaction_atmosphere",
        "reaction_idea",
        "reaction_healing",
      ];
      const lateProduct = "reaction_keep_watching";
      await seedLegacyWallet(caller.uid, openingBalance);

      const purchaseResults = await Promise.all(initialProducts.map((productId) => invoke(
        caller.economyAction,
        { action: "purchase", productId },
      )));
      assert.equal(
        purchaseResults.filter((result) => result.outcome === "purchased").length,
        initialProducts.length,
      );

      const initialCost = initialProducts.reduce(
        (sum, productId) => sum + PRODUCT_CATALOG[productId].price,
        0,
      );
      assertContinuousLedger(await readLedger(caller.uid), openingBalance - initialCost);

      const firstPage = await invoke(caller.economyAction, {
        action: "get_anju_pay_wallet",
        limit: 3,
      });
      assert.deepEqual(firstPage.entries.map((entry) => entry.sequence), [6, 5, 4]);

      const latePurchase = await invoke(caller.economyAction, {
        action: "purchase",
        productId: lateProduct,
      });
      assert.equal(latePurchase.outcome, "purchased");

      const secondPage = await invoke(caller.economyAction, {
        action: "get_anju_pay_wallet",
        limit: 3,
        cursor: firstPage.nextCursor,
      });
      const thirdPage = await invoke(caller.economyAction, {
        action: "get_anju_pay_wallet",
        limit: 3,
        cursor: secondPage.nextCursor,
      });
      const pinnedSequences = [
        ...firstPage.entries,
        ...secondPage.entries,
        ...thirdPage.entries,
      ].map((entry) => entry.sequence);
      assert.deepEqual(pinnedSequences, [6, 5, 4, 3, 2, 1, 0]);
      assert.equal(new Set(pinnedSequences).size, 7);
      assert.equal(pinnedSequences.includes(7), false);

      const finalBalance = openingBalance - initialCost - PRODUCT_CATALOG[lateProduct].price;
      assertContinuousLedger(await readLedger(caller.uid), finalBalance);
    });

    test("concurrent retries of one purchase debit and append exactly once", async () => {
      const caller = await createCaller("purchase-retry");
      const productId = "stamp_god_photo";
      const openingBalance = 1_000;
      await seedLegacyWallet(caller.uid, openingBalance);
      const initialized = await invoke(caller.economyAction, {
        action: "get_anju_pay_wallet",
        limit: 1,
      });
      assert.equal(initialized.available, true);
      assert.equal(initialized.entries.length, 1);

      const results = await Promise.all(Array.from(
        { length: 6 },
        () => invoke(caller.economyAction, { action: "purchase", productId }),
      ));
      assert.equal(results.filter((result) => result.outcome === "purchased").length, 1);
      assert.equal(results.filter((result) => result.outcome === "owned").length, 5);
      const expectedBalance = openingBalance - PRODUCT_CATALOG[productId].price;
      const ledger = await readLedger(caller.uid);
      assert.equal(ledger.entries.length, 2);
      assertContinuousLedger(ledger, expectedBalance);
      assert.equal(
        (await firestore.doc(`economyPurchases/${caller.uid}/items/${productId}`).get()).exists,
        true,
      );
    });

    test("multiple senders tipping one recipient serialize the recipient wallet", async () => {
      const senders = await Promise.all(Array.from(
        { length: 4 },
        (_, index) => createCaller(`tip-sender-${index}`),
      ));
      const recipientUid = `recipient-${suiteId}`;
      const now = Date.now();
      const firestoreBatch = firestore.batch();
      const realtimeUpdates = {};

      firestoreBatch.set(firestore.doc(`wallets/${recipientUid}`), {
        balance: 0,
        reservedIncoming: 0,
        initializedAt: now,
        updatedAt: now,
      });
      senders.forEach((sender, index) => {
        const roomId = eventId(`${suiteId}:tip-room:${index}`).slice(0, 20);
        const participants = [sender.uid, recipientUid].sort();
        firestoreBatch.set(firestore.doc(`wallets/${sender.uid}`), {
          balance: 100,
          reservedIncoming: 0,
          initializedAt: now,
          updatedAt: now,
        });
        for (const uid of participants) {
          firestoreBatch.set(
            firestore.doc(`verifiedMatchClaims/${eventId(`${uid}:solo:${roomId}`)}`),
            {
              uid,
              mode: "solo",
              roomId,
              participants,
              createdAt: now,
            },
          );
        }
        realtimeUpdates[`online/rooms/${roomId}`] = {
          status: "active",
          createdAt: now - 60_000,
          hostUid: sender.uid,
          guestUid: recipientUid,
          members: {
            [sender.uid]: true,
            [recipientUid]: true,
          },
          players: {
            [sender.uid]: { uid: sender.uid, name: `SENDER${index}` },
            [recipientUid]: { uid: recipientUid, name: "RECIPIENT" },
          },
          resultClaims: {
            [sender.uid]: { outcome: "win" },
            [recipientUid]: { outcome: "loss" },
          },
          finished: {
            [sender.uid]: true,
            [recipientUid]: true,
          },
        };
        sender.tipRoomId = roomId;
      });
      await Promise.all([
        firestoreBatch.commit(),
        realtime.ref().update(realtimeUpdates),
      ]);

      const tipResults = await Promise.all(senders.map((sender, index) => invoke(
        sender.economyAction,
        {
          action: "send_match_tip",
          mode: "solo",
          roomId: sender.tipRoomId,
          targetUid: recipientUid,
          amount: 5,
          actionId: `emulator-tip-${suiteId}-${index}`,
        },
      )));
      assert.equal(tipResults.every((result) => result.outcome === "sent"), true);

      for (const sender of senders) {
        assertContinuousLedger(await readLedger(sender.uid), 95);
      }
      const recipientLedger = await readLedger(recipientUid);
      assert.equal(recipientLedger.entries.length, 5);
      assertContinuousLedger(recipientLedger, 20);
    });

    test("concurrent duplicate market sale settles escrow and fee once", async () => {
      const buyer = await createCaller("market-buyer");
      const sellerUid = `seller-${suiteId}`;
      const roomId = eventId(`${suiteId}:market-room`).slice(0, 20);
      const askingPrice = 100;
      const now = Date.now();
      await Promise.all([
        seedLegacyWallet(buyer.uid, 1_000),
        seedLegacyWallet(sellerUid, 0),
        firestore.doc(`valueMarketRooms/${roomId}`).set({
          status: "decision",
          sellerUid,
          buyerUid: buyer.uid,
          sellerName: "SELLER",
          buyerName: "BUYER",
          participants: {
            [sellerUid]: true,
            [buyer.uid]: true,
          },
          listing: {
            title: "Emulator Listing",
            askingPrice,
          },
          turn: 1,
          entryFee: 5,
          entryFeeHeld: 0,
          entryFeeReserved: false,
          extensionHeld: 0,
          extensionReserved: false,
          stateVersion: 1,
          publicPresenceId: eventId(`${suiteId}:presence`),
          createdAt: now,
          updatedAt: now,
        }),
      ]);

      const action = {
        action: "buy",
        actionId: `emulator-sale-${suiteId}`,
        roomId,
        turn: 1,
      };
      const results = await Promise.all(Array.from(
        { length: 6 },
        () => invoke(buyer.valueMarketAction, action),
      ));
      assert.equal(results.every((result) => result.status === "sold"), true);
      assert.equal(new Set(results.map((result) => result.balance)).size, 1);

      const buyerLedger = await readLedger(buyer.uid);
      const sellerLedger = await readLedger(sellerUid);
      assert.equal(buyerLedger.entries.length, 2);
      assert.equal(sellerLedger.entries.length, 2);
      assertContinuousLedger(buyerLedger, 900);
      assertContinuousLedger(sellerLedger, 95);
      assert.deepEqual(
        sellerLedger.entries[1].components.map((component) => component.delta),
        [100, -5],
      );
      const roomSnapshot = await firestore.doc(`valueMarketRooms/${roomId}`).get();
      assert.equal(roomSnapshot.get("marketFee"), 5);
      assert.equal(roomSnapshot.get("sellerProceeds"), 95);
      const certificates = await firestore
        .collection(`valueMarketCertificates/${buyer.uid}/items`)
        .get();
      assert.equal(certificates.size, 1);
    });

    test("valid reserved extension escrow settles once on accept, decline, and cancel", async () => {
      const scenarios = [
        {
          action: "accept_extension",
          actor: "buyer",
          status: "pitch",
          sellerBalance: 80,
          buyerBalance: 120,
          sellerEntries: 2,
          buyerEntries: 2,
        },
        {
          action: "decline_extension",
          actor: "buyer",
          status: "ended",
          sellerBalance: 100,
          buyerBalance: 100,
          sellerEntries: 2,
          buyerEntries: 1,
        },
        {
          action: "cancel",
          actor: "seller",
          status: "canceled",
          sellerBalance: 100,
          buyerBalance: 100,
          sellerEntries: 2,
          buyerEntries: 1,
        },
      ];

      for (const [index, scenario] of scenarios.entries()) {
        const [seller, buyer] = await Promise.all([
          createCaller(`valid-extension-seller-${index}`),
          createCaller(`valid-extension-buyer-${index}`),
        ]);
        const roomId = eventId(`${suiteId}:valid-extension-room:${index}`).slice(0, 20);
        const now = Date.now();
        const roomReference = firestore.doc(`valueMarketRooms/${roomId}`);
        await Promise.all([
          firestore.doc(`wallets/${seller.uid}`).set({
            balance: 80,
            reservedIncoming: 20,
            initializedAt: now,
            updatedAt: now,
          }),
          firestore.doc(`wallets/${buyer.uid}`).set({
            balance: 100,
            reservedIncoming: 20,
            initializedAt: now,
            updatedAt: now,
          }),
          roomReference.set({
            status: "extension_offer",
            sellerUid: seller.uid,
            buyerUid: buyer.uid,
            sellerName: "SELLER",
            buyerName: "BUYER",
            participants: {
              [seller.uid]: true,
              [buyer.uid]: true,
            },
            listing: {
              title: "Valid Extension",
              askingPrice: 100,
            },
            turn: 1,
            entryFee: 5,
            entryFeeHeld: 0,
            entryFeeReserved: false,
            extensionHeld: 20,
            extensionIncentive: 20,
            extensionReserved: true,
            stateVersion: 3,
            publicPresenceId: eventId(`${suiteId}:valid-extension-presence:${index}`),
            createdAt: now,
            updatedAt: now,
          }),
        ]);
        const caller = scenario.actor === "seller" ? seller : buyer;
        const result = await invoke(caller.valueMarketAction, {
          action: scenario.action,
          actionId: `valid-extension-${suiteId}-${index}`,
          roomId,
          turn: 1,
        });

        assert.equal(result.status, scenario.status);
        const room = (await roomReference.get()).data();
        assert.equal(room.extensionHeld, 0);
        assert.equal(room.extensionReserved, false);
        const sellerLedger = await readLedger(seller.uid);
        const buyerLedger = await readLedger(buyer.uid);
        assert.equal(sellerLedger.wallet.reservedIncoming, 0);
        assert.equal(buyerLedger.wallet.reservedIncoming, 0);
        assert.equal(sellerLedger.entries.length, scenario.sellerEntries);
        assert.equal(buyerLedger.entries.length, scenario.buyerEntries);
        assertContinuousLedger(sellerLedger, scenario.sellerBalance);
        assertContinuousLedger(buyerLedger, scenario.buyerBalance);
      }
    });

    test("ambiguous legacy extension escrow fails closed without changing money", async () => {
      const scenarios = [
        { action: "accept_extension", actor: "buyer" },
        { action: "decline_extension", actor: "buyer" },
        { action: "cancel", actor: "seller" },
        { action: "cancel", actor: "buyer" },
      ];

      for (const [index, scenario] of scenarios.entries()) {
        const [seller, buyer] = await Promise.all([
          createCaller(`extension-seller-${index}`),
          createCaller(`extension-buyer-${index}`),
        ]);
        const roomId = eventId(`${suiteId}:extension-room:${index}`).slice(0, 20);
        const actionId = `extension-guard-${suiteId}-${index}`;
        const now = Date.now();
        const roomReference = firestore.doc(`valueMarketRooms/${roomId}`);
        const sellerActiveReference = firestore.doc(`valueMarketActive/${seller.uid}`);
        const buyerActiveReference = firestore.doc(`valueMarketActive/${buyer.uid}`);
        await Promise.all([
          seedLegacyWallet(seller.uid, 80),
          seedLegacyWallet(buyer.uid, 100),
          roomReference.set({
            status: "extension_offer",
            sellerUid: seller.uid,
            buyerUid: buyer.uid,
            sellerName: "SELLER",
            buyerName: "BUYER",
            participants: {
              [seller.uid]: true,
              [buyer.uid]: true,
            },
            listing: {
              title: "Ambiguous Extension",
              askingPrice: 100,
            },
            turn: 1,
            entryFee: 5,
            entryFeeHeld: 0,
            entryFeeReserved: false,
            extensionHeld: 20,
            extensionIncentive: 20,
            extensionReserved: false,
            stateVersion: 7,
            publicPresenceId: eventId(`${suiteId}:extension-presence:${index}`),
            createdAt: now,
            updatedAt: now,
          }),
          sellerActiveReference.set({
            roomId,
            role: "seller",
            updatedAt: now,
          }),
          buyerActiveReference.set({
            roomId,
            role: "buyer",
            updatedAt: now,
          }),
        ]);
        const roomBefore = (await roomReference.get()).data();
        const caller = scenario.actor === "seller" ? seller : buyer;

        await assert.rejects(
          invoke(caller.valueMarketAction, {
            action: scenario.action,
            actionId,
            roomId,
            turn: 1,
          }),
          (error) => (
            error?.code === "functions/failed-precondition"
            && error?.message === "延長内金の保留状態を確認できないため、取引を停止しました。"
          ),
        );

        assert.deepEqual((await roomReference.get()).data(), roomBefore);
        const sellerLedger = await readLedger(seller.uid);
        const buyerLedger = await readLedger(buyer.uid);
        assert.equal(sellerLedger.entries.length, 1);
        assert.equal(buyerLedger.entries.length, 1);
        assertContinuousLedger(sellerLedger, 80);
        assertContinuousLedger(buyerLedger, 100);
        assert.equal((await sellerActiveReference.get()).exists, true);
        assert.equal((await buyerActiveReference.get()).exists, true);
        assert.equal(
          (await firestore.doc(
            `valueMarketLedger/${eventId(`${roomId}:${caller.uid}:${actionId}`)}`,
          ).get()).exists,
          false,
        );
        const marketEntryId = eventId(`market:${roomId}:${caller.uid}:${actionId}`);
        assert.equal(
          (await firestore.doc(
            `wallets/${seller.uid}/anjuPayEntries/${marketEntryId}`,
          ).get()).exists,
          false,
        );
        assert.equal(
          (await firestore.doc(
            `wallets/${buyer.uid}/anjuPayEntries/${marketEntryId}`,
          ).get()).exists,
          false,
        );
      }
    });

    test("missing and incomplete activation config fail closed without mutations", async () => {
      const caller = await createCaller("fail-closed");
      const openingBalance = 1_000;
      await seedLegacyWallet(caller.uid, openingBalance);
      const configReference = firestore.doc("systemConfig/anjuPayLedger");

      try {
        await configReference.delete();
        await assert.rejects(
          invoke(caller.economyAction, {
            action: "purchase",
            productId: "reaction_color",
          }),
          (error) => error?.code === "functions/unavailable",
        );
        await configReference.set({ enabled: true, activatedAt: 0 });
        await assert.rejects(
          invoke(caller.economyAction, {
            action: "purchase",
            productId: "reaction_best_shot",
          }),
          (error) => error?.code === "functions/unavailable",
        );
      } finally {
        await restoreActiveLedgerConfig();
      }

      const ledger = await readLedger(caller.uid);
      assert.equal(ledger.wallet.balance, openingBalance);
      assert.equal(ledger.wallet.ledgerSequence, undefined);
      assert.equal(ledger.entries.length, 0);
      assert.equal(
        (await firestore.collection(`economyPurchases/${caller.uid}/items`).get()).empty,
        true,
      );
    });
  });
}
