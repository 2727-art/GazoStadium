"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, describe, test } = require("node:test");

// Keep the established command/flag/project, now verifying both retired modes.
const RUN_FLAG = "RUN_ANJU_PAY_FLEA_E2E_TESTS";
const PROJECT_ID_ENV = "ANJU_PAY_FLEA_E2E_PROJECT_ID";
const DEDICATED_PROJECT_ID = "demo-anju-pay-flea-e2e";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const PROJECT_ID = process.env[PROJECT_ID_ENV] || "";

function parseLoopbackTarget(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!value || value.includes("://") || value.includes("/") || value.includes("@")) {
    throw new Error(`${label} must be a bare loopback host and port.`);
  }
  let parsed;
  try { parsed = new URL(`http://${value}`); }
  catch { throw new Error(`${label} must be a valid loopback host and port.`); }
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

function integrationTarget() {
  if (PROJECT_ID !== DEDICATED_PROJECT_ID) {
    throw new Error(`${PROJECT_ID_ENV} must be the dedicated ${DEDICATED_PROJECT_ID} project ID.`);
  }
  return {
    projectId: PROJECT_ID,
    auth: parseLoopbackTarget(process.env.FIREBASE_AUTH_EMULATOR_HOST, "FIREBASE_AUTH_EMULATOR_HOST"),
    database: parseLoopbackTarget(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "FIREBASE_DATABASE_EMULATOR_HOST"),
    firestore: parseLoopbackTarget(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST"),
    functions: parseLoopbackTarget(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001", "FUNCTIONS_EMULATOR_HOST"),
  };
}

if (!RUN_REQUESTED) {
  test("retired flea and NOTE Callable E2E is opt-in and never uses production", {
    skip: `set ${RUN_FLAG}=1 and ${PROJECT_ID_ENV}=${DEDICATED_PROJECT_ID} inside Firebase Emulator`,
  }, () => {});
} else {
  // Validate every target before importing SDKs, creating tokens, or writing fixtures.
  const target = integrationTarget();
  const { deleteApp: deleteAdminApp, initializeApp: initializeAdminApp } = require("firebase-admin/app");
  const { getAuth: getAdminAuth } = require("firebase-admin/auth");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore } = require("firebase-admin/firestore");
  const { deleteApp: deleteClientApp, initializeApp: initializeClientApp } = require("firebase/app");
  const { CustomProvider, initializeAppCheck } = require("firebase/app-check");
  const { connectAuthEmulator, getAuth, signInAnonymously } = require("firebase/auth");
  const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");
  const { DANWAKU_ACTIONS } = require("../danwaku-note");
  const modes = [
    { callable: "anjuPayFleaAction", mode: "anju_pay_flea", name: "AnjuPayフリマ", actions: [
      "state", "browse_more", "browse_sellers", "create_listing", "buy", "cancel_listing",
      "save_urikko_card", "set_favorite", "report",
    ] },
    { callable: "danwakuNoteAction", mode: "danwaku_note", name: "断惑NOTE", actions: DANWAKU_ACTIONS },
  ];
  const collections = [
    "wallets", "achievementProfiles", "valueMarketStats", "economyProgress", "systemConfig",
    "anjuPayFleaListings", "anjuPayFleaSellerCards", "anjuPayFleaAchievementStats",
    "anjuPayFleaSales", "anjuPayFleaReceipts", "anjuPayFleaFavorites", "anjuPayFleaReports",
    "danwakuProfiles", "danwakuPublicEntries", "danwakuPublicEntryOwners", "danwakuMatchBadges",
    "danwakuDeletionJobs",
  ];
  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const listingId = crypto.createHash("sha256").update(suiteId).digest("hex").slice(0, 40);
  const noteId = crypto.createHash("sha256").update(`note:${suiteId}`).digest("base64url").slice(0, 24);
  const clientApps = [];
  const createdUids = new Set();
  const ownedDocumentPaths = new Set();
  const ownedRealtimePaths = new Set();
  let adminApp;
  let adminAuth;
  let firestore;
  let realtime;
  let owner;
  let buyer;
  let baseline;

  function unsignedEmulatorAppCheckToken(appId) {
    // Only the demo-project Functions Emulator unsafe-decodes this unsigned token.
    // Production verification cannot accept it; all targets were guarded above.
    const now = Math.floor(Date.now() / 1_000);
    const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    return [encode({ alg: "none", typ: "JWT" }), encode({
      aud: [`projects/${target.projectId}`], exp: now + 3_600, iat: now,
      iss: `https://firebaseappcheck.googleapis.com/${target.projectId}`, sub: appId,
    }), "emulator"].join(".");
  }

  async function createCaller(label, { appCheck = true, authenticated = true } = {}) {
    const appId = `1:1234567890:web:${crypto.createHash("sha256").update(`${suiteId}:${label}`).digest("hex").slice(0, 32)}`;
    const app = initializeClientApp({ apiKey: "demo-anju-pay-flea-emulator-key", appId,
      authDomain: `${target.projectId}.firebaseapp.com`, projectId: target.projectId,
    }, `retired-community-${suiteId}-${label}`);
    clientApps.push(app);
    if (appCheck) {
      const token = unsignedEmulatorAppCheckToken(appId);
      initializeAppCheck(app, { provider: new CustomProvider({
        getToken: async () => ({ token, expireTimeMillis: Date.now() + 3_600_000 }),
      }), isTokenAutoRefreshEnabled: false });
    }
    const auth = getAuth(app);
    const authHost = target.auth.host.includes(":") ? `[${target.auth.host}]` : target.auth.host;
    connectAuthEmulator(auth, `http://${authHost}:${target.auth.port}`, { disableWarnings: true });
    let uid = null;
    if (authenticated) {
      uid = (await signInAnonymously(auth)).user.uid;
      createdUids.add(uid);
    }
    const functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(functions, target.functions.host, target.functions.port);
    return { uid, callables: Object.fromEntries(modes.map(({ callable }) => [
      callable, httpsCallable(functions, callable, { timeout: 30_000 }),
    ])) };
  }

  async function seedDocument(documentPath, value) {
    ownedDocumentPaths.add(documentPath);
    await firestore.doc(documentPath).set(value);
  }

  async function seedRealtime(realtimePath, value) {
    ownedRealtimePaths.add(realtimePath);
    await realtime.ref(realtimePath).set(value);
  }

  async function snapshotPersistence() {
    const documents = {};
    async function visit(collection) {
      // listDocuments also finds parentless subcollections, so a stray new ledger
      // or note event cannot hide behind a missing parent document.
      for (const reference of await collection.listDocuments()) {
        const snapshot = await reference.get();
        if (snapshot.exists) documents[reference.path] = {
          data: snapshot.data(), updateTime: {
            seconds: snapshot.updateTime.seconds, nanoseconds: snapshot.updateTime.nanoseconds,
          },
        };
        for (const child of await reference.listCollections()) await visit(child);
      }
    }
    for (const name of collections) await visit(firestore.collection(name));
    return { documents, online: (await realtime.ref("online").get()).val() };
  }

  async function expectRetired(caller, mode, data) {
    await assert.rejects(caller.callables[mode.callable](data), (error) => {
      assert.equal(error.code, "functions/failed-precondition");
      assert.equal(error.message, `${mode.name}は提供を終了しました。`);
      assert.deepEqual(error.details, { reason: "mode-retired", mode: mode.mode });
      return true;
    });
  }

  function oldPayload(action) {
    return { action, listingId, noteId, operationId: `${suiteId}_operation`,
      name: "Emulator seller", category: "illustration", title: "保存済みfixture",
      description: "ローカル専用の保存済み説明文で、実在する個人の情報は含みません。", price: 25,
      commitment: "ローカルの検証", themeId: "sakura", sealId: "heart", achievementIds: [],
      allowRetired: true, retired: false, confirmed: true };
  }

  describe("retired Flea and NOTE real Callable closure on Firebase Emulator", {
    concurrency: false, timeout: 120_000,
  }, () => {
    before(async () => {
      adminApp = initializeAdminApp({ projectId: target.projectId,
        databaseURL: `https://${target.projectId}-default-rtdb.firebaseio.com`,
      }, `retired-community-admin-${suiteId}`);
      adminAuth = getAdminAuth(adminApp);
      firestore = getFirestore(adminApp);
      realtime = getDatabase(adminApp);
      owner = await createCaller("owner");
      buyer = await createCaller("buyer");
      const now = Date.now();
      for (const caller of [owner, buyer]) {
        await seedDocument(`wallets/${caller.uid}`, { balance: 100, reservedIncoming: 0,
          ledgerSequence: 0, initializedAt: now, updatedAt: now });
        await seedDocument(`wallets/${caller.uid}/anjuPayEntries/opening-v1`, {
          sequence: 0, kind: "opening", balanceBefore: 0, balanceAfter: 100, delta: 100,
        });
        await seedDocument(`achievementProfiles/${caller.uid}`, { schemaVersion: 1,
          unlocked: { flea_listings_1: now - 2, danwaku_streak_7: now - 1 },
          pendingUnlocks: { danwaku_streak_7: now - 1 },
          customShowcase: ["flea_listings_1", "danwaku_streak_7"], initializedAt: now - 2, updatedAt: now - 1 });
        await seedDocument(`valueMarketStats/${caller.uid}`, { salesCount: 2, purchases: 1, marker: suiteId });
        await seedRealtime(`online/economy/${caller.uid}`, { balance: 100, achievementShowcase: "flea_listings_1,danwaku_streak_7" });
      }
      await seedDocument(`anjuPayFleaListings/${listingId}`, { schemaVersion: 1, sellerUid: owner.uid,
        status: "active", price: 25, title: "既存出品fixture", expiresAt: now + 86_400_000, updatedAt: now });
      await seedDocument(`anjuPayFleaSales/${listingId}`, { listingId, sellerUid: owner.uid,
        buyerUid: buyer.uid, price: 25, createdAt: now - 86_400_000 });
      await seedDocument(`anjuPayFleaReceipts/${buyer.uid}/items/${listingId}`, {
        listingId, price: 25, purchasedAt: now - 86_400_000 });
      await seedDocument(`anjuPayFleaAchievementStats/${owner.uid}`, {
        schemaVersion: 1, listings: 1, sales: 1, purchases: 0, historyBackfilled: true });
      await seedDocument(`danwakuProfiles/${owner.uid}`, {
        highestEverDays: 7, currentDays: 7, updatedAt: now, privateMarker: suiteId });
      await seedDocument(`danwakuProfiles/${owner.uid}/notes/${noteId}`, {
        title: "ローカル専用ノート", commitment: "消えてはいけない検証データ", status: "active", updatedAt: now });
      await seedDocument(`danwakuProfiles/${owner.uid}/notes/${noteId}/events/previous`, {
        kind: "continued", day: "2026-10-01", marker: suiteId });
      baseline = await snapshotPersistence();
    });

    after(async () => {
      for (const app of clientApps) await deleteClientApp(app);
      // Delete only exact paths created by this test run, never an entire shared
      // collection or unknown emulator data. Production targets are impossible.
      if (firestore) for (const documentPath of [...ownedDocumentPaths].reverse()) {
        await firestore.doc(documentPath).delete();
      }
      if (realtime) for (const realtimePath of ownedRealtimePaths) await realtime.ref(realtimePath).remove();
      if (adminAuth && createdUids.size) await adminAuth.deleteUsers([...createdUids]);
      if (adminApp) await deleteAdminApp(adminApp);
    });

    test("valid App Check does not bypass authentication for either retired callable", async () => {
      const caller = await createCaller("no-auth", { authenticated: false });
      for (const mode of modes) await assert.rejects(caller.callables[mode.callable]({ action: "state" }),
        (error) => error.code === "functions/unauthenticated");
    });

    test("authenticated old callers without App Check are still rejected by enforcement", async () => {
      const caller = await createCaller("no-app-check", { appCheck: false });
      for (const mode of modes) await assert.rejects(caller.callables[mode.callable]({ action: "state" }),
        (error) => error.code === "functions/unauthenticated");
    });

    test("all old Flea actions including state, listing, purchase and report return retirement", async () => {
      for (const action of modes[0].actions) {
        await expectRetired(action === "buy" ? buyer : owner, modes[0], oldPayload(action));
      }
    });

    test("all old NOTE actions including create, continue and delete return retirement", async () => {
      for (const action of modes[1].actions) await expectRetired(owner, modes[1], oldPayload(action));
    });

    test("malformed actions and client opt-out flags cannot bypass closure", async () => {
      for (const mode of modes) for (const payload of [null, {}, { action: "" },
        { action: "future-action", allowRetired: true, retired: false, admin: true }]) {
        await expectRetired(owner, mode, payload);
      }
    });

    test("concurrent old purchase, create, continue and delete replays remain closed", async () => {
      const operations = [
        [buyer, modes[0], "buy"], [owner, modes[0], "create_listing"],
        [owner, modes[1], "continue"], [owner, modes[1], "delete"],
      ];
      await Promise.all([...operations, ...operations].map(([caller, mode, action]) => (
        expectRetired(caller, mode, oldPayload(action))
      )));
    });

    test("new anonymous visitors do not initialize mode data or wallets", async () => {
      const caller = await createCaller("never-used-modes");
      for (const mode of modes) await expectRetired(caller, mode, { action: "state" });
      for (const collection of ["wallets", "achievementProfiles", "anjuPayFleaAchievementStats", "danwakuProfiles"]) {
        assert.equal((await firestore.doc(`${collection}/${caller.uid}`).get()).exists, false);
      }
    });

    test("wallet, ledger, listings, receipts, private notes, legacy achievements and RTDB stay byte-for-byte unchanged", async () => {
      assert.deepEqual(await snapshotPersistence(), baseline);
    });
  });
}
