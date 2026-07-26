"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, describe, test } = require("node:test");

const RUN_FLAG = "RUN_ANJU_PAY_FLEA_E2E_TESTS";
const PROJECT_ID_ENV = "ANJU_PAY_FLEA_E2E_PROJECT_ID";
const DEDICATED_PROJECT_ID = "demo-anju-pay-flea-e2e";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const PROJECT_ID = process.env[PROJECT_ID_ENV] || "";
const MIDNIGHT_GUARD_MS = 6 * 60 * 1_000;
const FLEA_COLLECTIONS = Object.freeze([
  "anjuPayFleaListings",
  "anjuPayFleaSellerCards",
  "anjuPayFleaSales",
  "anjuPayFleaReceipts",
  "anjuPayFleaFavorites",
  "anjuPayFleaReports",
]);

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
  if (value !== DEDICATED_PROJECT_ID) {
    throw new Error(
      `${PROJECT_ID_ENV} must be the dedicated ${DEDICATED_PROJECT_ID} project ID.`,
    );
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
  test("AnjuPay flea E2E tests are opt-in and never use production", {
    skip: `set ${RUN_FLAG}=1 and ${PROJECT_ID_ENV}=${DEDICATED_PROJECT_ID} inside Firebase Emulator`,
  }, () => {});
} else {
  const target = integrationTarget();
  const {
    deleteApp: deleteAdminApp,
    initializeApp: initializeAdminApp,
  } = require("firebase-admin/app");
  const { getAuth: getAdminAuth } = require("firebase-admin/auth");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const {
    deleteApp: deleteClientApp,
    initializeApp: initializeClientApp,
  } = require("firebase/app");
  const {
    CustomProvider,
    initializeAppCheck,
  } = require("firebase/app-check");
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
  const { fleaExpiresAt } = require("../anju-pay-flea");
  const { anjuPayEntryId } = require("../anju-pay-ledger");

  const ORIGINAL_X_POST_URL = "https://x.com/flea_e2e/status/1234567890123456789";
  const ORIGINAL_X_HANDLE = "flea_e2e";

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const clientApps = [];
  const createdUids = new Set();
  const privateUidValues = new Set();
  const createdCreatorCards = [];
  let adminApp;
  let adminAuth;
  let firestore;
  let realtime;
  let previousLedgerConfig;

  function unsignedEmulatorAppCheckToken(appId) {
    // Functions Emulatorだけがdebug modeでunsafe-decodeする、意図的に署名不能なtokenです。
    // productionでは検証に失敗し、上のdemo-*・loopback guardなしでは生成されません。
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const encode = (value) => Buffer
      .from(JSON.stringify(value), "utf8")
      .toString("base64url");
    return [
      encode({ alg: "none", typ: "JWT" }),
      encode({
        aud: [`projects/${target.projectId}`],
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        iss: `https://firebaseappcheck.googleapis.com/${target.projectId}`,
        sub: appId,
      }),
      "emulator",
    ].join(".");
  }

  function activeLedgerConfig() {
    return {
      enabled: true,
      activatedAt: Timestamp.fromMillis(Date.now() - 60_000),
    };
  }

  async function clearFleaCollections() {
    for (const collectionName of FLEA_COLLECTIONS) {
      await firestore.recursiveDelete(firestore.collection(collectionName));
    }
  }

  async function createCaller(label, { appCheck = true } = {}) {
    const appId = `1:1234567890:web:${crypto
      .createHash("sha256")
      .update(`${suiteId}:${label}`)
      .digest("hex")
      .slice(0, 32)}`;
    const app = initializeClientApp({
      apiKey: "demo-anju-pay-flea-emulator-key",
      appId,
      authDomain: `${target.projectId}.firebaseapp.com`,
      projectId: target.projectId,
    }, `anju-pay-flea-client-${suiteId}-${label}`);
    clientApps.push(app);
    if (appCheck) {
      const token = unsignedEmulatorAppCheckToken(appId);
      initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: async () => ({
            token,
            expireTimeMillis: Date.now() + 3_600_000,
          }),
        }),
        isTokenAutoRefreshEnabled: false,
      });
    }
    const auth = getAuth(app);
    connectAuthEmulator(
      auth,
      `http://${target.auth.host}:${target.auth.port}`,
      { disableWarnings: true },
    );
    const credential = await signInAnonymously(auth);
    createdUids.add(credential.user.uid);
    privateUidValues.add(credential.user.uid);
    const functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(functions, target.functions.host, target.functions.port);
    return {
      uid: credential.user.uid,
      fleaAction: httpsCallable(functions, "anjuPayFleaAction"),
    };
  }

  async function invoke(callable, data) {
    const response = (await callable(data)).data;
    assertNoPrivateResponseFields(response);
    return response;
  }

  function assertNoPrivateResponseFields(value, seen = new Set()) {
    if (typeof value === "string") {
      for (const uid of privateUidValues) {
        assert.ok(!value.includes(uid), "Callable response exposed a private UID value.");
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(
        !["sellerUid", "buyerUid", "reporterUid", "soldAt"].includes(key),
        `Callable response exposed private field: ${key}`,
      );
      assertNoPrivateResponseFields(nested, seen);
    }
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

  async function seedCreatorCard(uid, {
    name,
    xHandle,
  }) {
    const entryId = `fleaCard${crypto
      .createHash("sha256")
      .update(`${suiteId}:${uid}`)
      .digest("hex")
      .slice(0, 24)}`;
    createdCreatorCards.push({ entryId, uid });
    await realtime.ref("online").update({
      [`topMessageEntriesByUser/${uid}`]: entryId,
      [`topMessageOwners/${entryId}`]: uid,
      [`topMessages/${entryId}`]: {
        schemaVersion: 2,
        name,
        titleId: "flea-e2e-title",
        text: "ことばから想像してね",
        creatorType: "illustrator",
        cardTheme: "sunset",
        growthLevel: 3,
        achievementShowcase: "",
        xHandle,
      },
    });
    return entryId;
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

  function stableLedgerShape(ledger) {
    return {
      balance: ledger.wallet.balance,
      reservedIncoming: ledger.wallet.reservedIncoming,
      ledgerSequence: ledger.wallet.ledgerSequence,
      entries: ledger.entries.map((entry) => ({
        id: entry.id,
        sequence: entry.sequence,
        kind: entry.kind,
        status: entry.status,
        delta: entry.delta,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
      })),
    };
  }

  function assertNoMarketStatistics(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const forbidden = new Set([
      "salesCount",
      "grossSales",
      "marketFeesPaid",
      "netSales",
      "bestSale",
      "marketDays",
      "uniqueCounterparties",
      "repeatBuyerCount",
      "favoriteCount",
      "ranking",
      "rank",
    ]);
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `Callable response exposed market statistic: ${key}`);
      assertNoMarketStatistics(nested, seen);
    }
  }

  function assertStableJstWindow() {
    const now = Date.now();
    assert.ok(
      fleaExpiresAt(now) - now >= MIDNIGHT_GUARD_MS,
      "JST 0:00まで6分未満です。日付境界後にE2Eを再実行してください。",
    );
  }

  function listingInput(overrides = {}) {
    return {
      action: "create_listing",
      name: "SELLER",
      category: "illustration",
      title: "今日の色を描いた一枚",
      description: "やわらかな色合いで、今日の穏やかな気分を表したイラストです。",
      price: 25,
      xPostUrl: "",
      xConsent: false,
      ...overrides,
    };
  }

  function assertStoredXQuarantined(snapshot, label) {
    assert.equal(snapshot.exists, true, `${label} should exist`);
    const value = snapshot.data() || {};
    assert.equal(
      String(value.xPostUrl || ""),
      "",
      `${label} must not retain a public X post URL`,
    );
    assert.ok(
      !Object.hasOwn(value.sellerCard || {}, "xHandle"),
      `${label} must not retain sellerCard.xHandle`,
    );
  }

  function assertPublicListingXQuarantined(listing, label) {
    assert.ok(listing, `${label} should be returned`);
    assert.ok(
      !Object.hasOwn(listing, "xPostUrl"),
      `${label} must not expose an X post URL`,
    );
    assert.ok(
      !Object.hasOwn(listing.seller?.creatorCard || {}, "xHandle"),
      `${label} must not expose sellerCard.xHandle`,
    );
  }

  function assertPublicReceiptXQuarantined(receipt, label) {
    assert.ok(receipt, `${label} should be returned`);
    assert.ok(
      !Object.hasOwn(receipt.listing || {}, "xPostUrl"),
      `${label} must not expose an X post URL`,
    );
  }

  describe("AnjuPay flea real Callable E2E on Firebase Emulator", {
    concurrency: false,
    timeout: 240_000,
  }, () => {
    before(async () => {
      assertStableJstWindow();
      adminApp = initializeAdminApp({
        projectId: target.projectId,
        databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app",
      }, `anju-pay-flea-admin-${suiteId}`);
      adminAuth = getAdminAuth(adminApp);
      firestore = getFirestore(adminApp);
      realtime = getDatabase(adminApp);
      const ledgerSnapshot = await firestore.doc("systemConfig/anjuPayLedger").get();
      previousLedgerConfig = ledgerSnapshot.exists
        ? { exists: true, data: ledgerSnapshot.data() }
        : { exists: false, data: null };
      await clearFleaCollections();
      await firestore.doc("systemConfig/anjuPayLedger").set(activeLedgerConfig());
    });

    after(async () => {
      for (const app of clientApps) {
        await deleteClientApp(app);
      }
      if (firestore) {
        await clearFleaCollections();
        for (const uid of createdUids) {
          await firestore.recursiveDelete(firestore.doc(`wallets/${uid}`));
          await firestore.recursiveDelete(firestore.doc(`achievementProfiles/${uid}`));
          await firestore.recursiveDelete(firestore.doc(`valueMarketStats/${uid}`));
        }
        if (previousLedgerConfig?.exists) {
          await firestore
            .doc("systemConfig/anjuPayLedger")
            .set(previousLedgerConfig.data);
        } else {
          await firestore.doc("systemConfig/anjuPayLedger").delete();
        }
      }
      if (realtime) {
        const updates = {};
        for (const uid of createdUids) {
          updates[`economy/${uid}`] = null;
        }
        for (const { entryId, uid } of createdCreatorCards) {
          updates[`topMessageEntriesByUser/${uid}`] = null;
          updates[`topMessageOwners/${entryId}`] = null;
          updates[`topMessages/${entryId}`] = null;
        }
        if (Object.keys(updates).length) {
          await realtime.ref("online").update(updates);
        }
      }
      if (adminAuth && createdUids.size) {
        await adminAuth.deleteUsers([...createdUids]);
      }
      if (adminApp) {
        await deleteAdminApp(adminApp);
      }
    });

    test("App Checkなしを拒否し、Emulator専用token付き匿名callerだけを通す", async () => {
      const withoutAppCheck = await createCaller("without-app-check", {
        appCheck: false,
      });
      await seedLegacyWallet(withoutAppCheck.uid, 10);
      await assert.rejects(
        () => invoke(withoutAppCheck.fleaAction, { action: "state" }),
        (error) => {
          assert.equal(error.code, "functions/unauthenticated");
          return true;
        },
      );

      const withAppCheck = await createCaller("with-app-check");
      await seedLegacyWallet(withAppCheck.uid, 10);
      const state = await invoke(withAppCheck.fleaAction, { action: "state" });
      assert.equal(state.balance, 10);
      assert.deepEqual(state.listings, []);
    });

    test("X付き出品を発見し、売却後も当日公開・第三者推し帳導線・一度だけの精算を保つ", async () => {
      const seller = await createCaller("sale-seller");
      const buyer = await createCaller("sale-buyer");
      const visitor = await createCaller("sold-listing-visitor");
      await Promise.all([
        seedLegacyWallet(seller.uid, 100),
        seedLegacyWallet(buyer.uid, 100),
        seedLegacyWallet(visitor.uid, 10),
        seedCreatorCard(seller.uid, {
          name: "SELLER X",
          xHandle: "flea_e2e",
        }),
      ]);

      const input = listingInput({
        name: "IGNORED",
        xPostUrl: "https://x.com/flea_e2e/status/1234567890123456789?s=20#ref",
        xConsent: true,
      });
      const created = await invoke(seller.fleaAction, input);
      const replayedCreate = await invoke(seller.fleaAction, input);
      const listingId = created.createdListing.id;
      const publicSellerId = created.createdListing.seller.publicSellerId;
      assert.match(listingId, /^[a-f0-9]{40}$/);
      assert.equal(replayedCreate.createdListing.id, listingId);
      assert.equal(created.balance, 99);
      assert.equal(replayedCreate.balance, 99);
      assert.equal(created.createdListing.seller.name, "SELLER X");
      assert.equal(
        created.createdListing.xPostUrl,
        "https://x.com/flea_e2e/status/1234567890123456789",
      );

      const browseState = await invoke(buyer.fleaAction, { action: "state" });
      const discovered = browseState.listings.find((listing) => listing.id === listingId);
      assert.ok(discovered, "buyer state should discover the active listing");
      assert.equal(discovered.isOwn, false);
      assert.equal(discovered.price, 25);
      assert.equal(discovered.seller.creatorCard.xHandle, "flea_e2e");

      const [purchaseA, purchaseB] = await Promise.all([
        invoke(buyer.fleaAction, {
          action: "buy",
          listingId,
          buyerName: "BUYER",
        }),
        invoke(buyer.fleaAction, {
          action: "buy",
          listingId,
          buyerName: "BUYER",
        }),
      ]);
      for (const result of [purchaseA, purchaseB]) {
        assert.equal(result.purchase.id, listingId);
        assert.equal(result.purchase.role, "buyer");
        assert.equal(result.purchase.price, 25);
        assert.equal(result.purchase.feeAmount, 2);
        assert.equal(result.purchase.sellerProceeds, 23);
        assert.equal(result.balance, 75);
      }

      const soldBrowseState = await invoke(visitor.fleaAction, { action: "state" });
      const soldDiscovery = soldBrowseState.listings.find((listing) => listing.id === listingId);
      assert.ok(soldDiscovery, "today's sold listing should remain discoverable");
      assert.equal(soldDiscovery.status, "sold");
      assert.equal(soldDiscovery.isOwn, false);
      assert.equal(Object.hasOwn(soldDiscovery, "buyerUid"), false);
      assert.equal(Object.hasOwn(soldDiscovery, "soldAt"), false);
      assert.equal(Object.hasOwn(soldDiscovery, "sellerProceeds"), false);
      assert.equal(Object.hasOwn(soldDiscovery, "feeAmount"), false);
      assert.equal(Object.hasOwn(soldDiscovery, "saleFee"), false);
      const visitorFavorite = await invoke(visitor.fleaAction, {
        action: "set_favorite",
        listingId,
        favorite: true,
      });
      assert.equal(visitorFavorite.favorite.favorite, true);
      assert.equal(visitorFavorite.favorite.publicSellerId, publicSellerId);

      const favorited = await invoke(buyer.fleaAction, {
        action: "set_favorite",
        listingId,
        favorite: true,
      });
      assert.equal(favorited.favorite.favorite, true);
      assert.equal(favorited.favorite.publicSellerId, publicSellerId);
      assert.ok(
        !Object.hasOwn(favorited.favorite.seller.creatorCard, "xHandle"),
        "private favorite snapshot must not retain the X handle",
      );
      const rawFavorite = await firestore
        .doc(`anjuPayFleaFavorites/${buyer.uid}/sellers/${publicSellerId}`)
        .get();
      const rawVisitorFavorite = await firestore
        .doc(`anjuPayFleaFavorites/${visitor.uid}/sellers/${publicSellerId}`)
        .get();
      assert.equal(rawFavorite.exists, true);
      assert.equal(rawVisitorFavorite.exists, true);
      assert.ok(!Object.hasOwn(rawFavorite.get("creatorCard") || {}, "xHandle"));
      assert.ok(!Object.hasOwn(rawVisitorFavorite.get("creatorCard") || {}, "xHandle"));

      const [
        rawListing,
        rawSale,
        rawBuyerReceipt,
        rawSellerReceipt,
        sellerState,
        buyerState,
        sellerLedger,
        buyerLedger,
        sellerMirror,
        buyerMirror,
      ] = await Promise.all([
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        firestore.doc(`anjuPayFleaSales/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${buyer.uid}/items/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${seller.uid}/items/${listingId}`).get(),
        invoke(seller.fleaAction, { action: "state" }),
        invoke(buyer.fleaAction, { action: "state" }),
        readLedger(seller.uid),
        readLedger(buyer.uid),
        realtime.ref(`online/economy/${seller.uid}/points`).get(),
        realtime.ref(`online/economy/${buyer.uid}/points`).get(),
      ]);
      assert.equal(rawListing.get("status"), "sold");
      assert.equal(rawListing.get("sellerUid"), seller.uid);
      assert.equal(rawListing.get("buyerUid"), buyer.uid);
      assert.equal(rawSale.exists, true);
      assert.equal(rawSale.get("sellerUid"), seller.uid);
      assert.equal(rawSale.get("buyerUid"), buyer.uid);
      assert.equal(rawBuyerReceipt.get("role"), "buyer");
      assert.equal(rawSellerReceipt.get("role"), "seller");
      for (const [snapshot, label] of [
        [rawListing, "listing before report"],
        [rawSale, "sale before report"],
        [rawBuyerReceipt, "buyer receipt before report"],
        [rawSellerReceipt, "seller receipt before report"],
      ]) {
        const value = snapshot.data() || {};
        assert.equal(value.xPostUrl, ORIGINAL_X_POST_URL);
        assert.equal(value.sellerCard?.xHandle, ORIGINAL_X_HANDLE, label);
      }
      assert.equal(sellerState.balance, 122);
      assert.equal(buyerState.balance, 75);
      assert.equal(
        sellerState.receipts.find((receipt) => receipt.id === listingId)?.role,
        "seller",
      );
      assert.equal(
        buyerState.receipts.find((receipt) => receipt.id === listingId)?.role,
        "buyer",
      );
      assert.equal(
        buyerState.favorites.find(
          (favorite) => favorite.publicSellerId === publicSellerId,
        )?.name,
        "SELLER X",
      );
      assertContinuousLedger(sellerLedger, 122);
      assertContinuousLedger(buyerLedger, 75);
      assert.deepEqual(
        sellerLedger.entries.slice(-2).map((entry) => entry.kind),
        ["flea_listing_fee", "flea_sale"],
      );
      assert.equal(buyerLedger.entries.at(-1).kind, "flea_purchase");
      assert.equal(sellerMirror.val(), 122);
      assert.equal(buyerMirror.val(), 75);

      const reported = await invoke(buyer.fleaAction, {
        action: "report",
        listingId,
        reason: "privacy",
      });
      assert.equal(reported.reported.reported, true);
      assert.equal(reported.reported.reason, "privacy");
      assert.equal(reported.reported.xQuarantined, true);

      const [
        quarantinedListing,
        quarantinedSale,
        quarantinedBuyerReceipt,
        quarantinedSellerReceipt,
        quarantinedSellerState,
        quarantinedBuyerState,
        reports,
      ] = await Promise.all([
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        firestore.doc(`anjuPayFleaSales/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${buyer.uid}/items/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${seller.uid}/items/${listingId}`).get(),
        invoke(seller.fleaAction, { action: "state" }),
        invoke(buyer.fleaAction, { action: "state" }),
        firestore
          .collection("anjuPayFleaReports")
          .where("listingId", "==", listingId)
          .get(),
      ]);
      assert.equal(quarantinedListing.get("status"), "sold");
      for (const [snapshot, label] of [
        [quarantinedListing, "listing after privacy report"],
        [quarantinedSale, "sale after privacy report"],
        [quarantinedBuyerReceipt, "buyer receipt after privacy report"],
        [quarantinedSellerReceipt, "seller receipt after privacy report"],
      ]) {
        assertStoredXQuarantined(snapshot, label);
      }
      assertPublicListingXQuarantined(
        quarantinedSellerState.ownListing,
        "seller own listing after privacy report",
      );
      assertPublicReceiptXQuarantined(
        quarantinedSellerState.receipts.find((receipt) => receipt.id === listingId),
        "seller receipt after privacy report",
      );
      assertPublicReceiptXQuarantined(
        quarantinedBuyerState.receipts.find((receipt) => receipt.id === listingId),
        "buyer receipt after privacy report",
      );
      assert.equal(reports.size, 1);
      assert.equal(reports.docs[0].get("reason"), "privacy");
      assert.equal(reports.docs[0].get("xPostUrl"), ORIGINAL_X_POST_URL);
      assert.equal(reports.docs[0].get("xHandle"), ORIGINAL_X_HANDLE);
    });

    test("通報で自動非表示にせず、出品者だけが取り下げても出品料を返さない", async () => {
      const seller = await createCaller("cancel-seller");
      const reporter = await createCaller("cancel-reporter");
      await Promise.all([
        seedLegacyWallet(seller.uid, 100),
        seedLegacyWallet(reporter.uid, 100),
      ]);

      const created = await invoke(seller.fleaAction, listingInput({
        name: "CANCEL SELLER",
        category: "outfit",
        title: "今日は青を選んだコーデ",
        description: "青い服を中心にして、ゆっくり歩きたくなる休日の組み合わせを考えました。",
        price: 10,
      }));
      const listingId = created.createdListing.id;
      assert.equal(created.balance, 99);

      const reported = await invoke(reporter.fleaAction, {
        action: "report",
        listingId,
        reason: "privacy",
      });
      const replayedReport = await invoke(reporter.fleaAction, {
        action: "report",
        listingId,
        reason: "other",
      });
      assert.equal(reported.reported.reported, true);
      assert.equal(reported.reported.reason, "privacy");
      assert.equal(replayedReport.reported.reason, "privacy");
      assert.equal(
        (await firestore.doc(`anjuPayFleaListings/${listingId}`).get()).get("status"),
        "active",
      );
      const reports = await firestore
        .collection("anjuPayFleaReports")
        .where("listingId", "==", listingId)
        .get();
      assert.equal(reports.size, 1);
      assert.equal(reports.docs[0].get("reporterUid"), reporter.uid);
      assert.equal(reports.docs[0].get("reason"), "privacy");

      const canceled = await invoke(seller.fleaAction, {
        action: "cancel_listing",
        listingId,
      });
      const replayedCancel = await invoke(seller.fleaAction, {
        action: "cancel_listing",
        listingId,
      });
      assert.equal(canceled.canceled.status, "canceled");
      assert.equal(replayedCancel.canceled.status, "canceled");
      assert.equal(canceled.balance, 99);
      assert.equal(replayedCancel.balance, 99);
      const rawCanceledListing = await firestore
        .doc(`anjuPayFleaListings/${listingId}`)
        .get();
      assert.equal(rawCanceledListing.get("status"), "canceled");
      assert.equal(rawCanceledListing.get("sellerUid"), seller.uid);
      assert.equal(
        (await firestore.doc(`anjuPayFleaSales/${listingId}`).get()).exists,
        false,
      );
      const ledger = await readLedger(seller.uid);
      assertContinuousLedger(ledger, 99);
      assert.equal(ledger.entries.at(-1).kind, "flea_listing_fee");
      assert.equal(
        ledger.entries.filter((entry) => entry.kind === "flea_listing_fee").length,
        1,
      );
    });

    test("privacy通報と購入が競合してもX情報を公開記録に残さない", async () => {
      const seller = await createCaller("report-buy-race-seller");
      const buyer = await createCaller("report-buy-race-buyer");
      const reporter = await createCaller("report-buy-race-reporter");
      await Promise.all([
        seedLegacyWallet(seller.uid, 100),
        seedLegacyWallet(buyer.uid, 100),
        seedLegacyWallet(reporter.uid, 100),
        seedCreatorCard(seller.uid, {
          name: "RACE SELLER",
          xHandle: ORIGINAL_X_HANDLE,
        }),
      ]);

      const created = await invoke(seller.fleaAction, listingInput({
        xPostUrl: `${ORIGINAL_X_POST_URL}?s=20`,
        xConsent: true,
        price: 10,
      }));
      const listingId = created.createdListing.id;
      const [purchaseOutcome, reportOutcome] = await Promise.allSettled([
        invoke(buyer.fleaAction, {
          action: "buy",
          listingId,
          buyerName: "RACE BUYER",
        }),
        invoke(reporter.fleaAction, {
          action: "report",
          listingId,
          reason: "privacy",
        }),
      ]);

      assert.equal(reportOutcome.status, "fulfilled");
      assert.equal(reportOutcome.value.reported.reason, "privacy");
      assert.equal(reportOutcome.value.reported.xQuarantined, true);
      assert.equal(purchaseOutcome.status, "fulfilled");
      assert.equal(purchaseOutcome.value.purchase.id, listingId);

      const [
        rawListing,
        rawSale,
        rawBuyerReceipt,
        rawSellerReceipt,
        sellerState,
        buyerState,
        reports,
      ] = await Promise.all([
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        firestore.doc(`anjuPayFleaSales/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${buyer.uid}/items/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReceipts/${seller.uid}/items/${listingId}`).get(),
        invoke(seller.fleaAction, { action: "state" }),
        invoke(buyer.fleaAction, { action: "state" }),
        firestore
          .collection("anjuPayFleaReports")
          .where("listingId", "==", listingId)
          .get(),
      ]);

      assert.equal(rawListing.get("status"), "sold");
      for (const [snapshot, label] of [
        [rawListing, "listing after report/buy race"],
        [rawSale, "sale after report/buy race"],
        [rawBuyerReceipt, "buyer receipt after report/buy race"],
        [rawSellerReceipt, "seller receipt after report/buy race"],
      ]) {
        assertStoredXQuarantined(snapshot, label);
      }
      assertPublicListingXQuarantined(
        sellerState.ownListing,
        "seller own listing after report/buy race",
      );
      assertPublicReceiptXQuarantined(
        buyerState.receipts.find((receipt) => receipt.id === listingId),
        "public buyer receipt after report/buy race",
      );
      assertPublicReceiptXQuarantined(
        sellerState.receipts.find((receipt) => receipt.id === listingId),
        "public seller receipt after report/buy race",
      );
      assert.equal(reports.size, 1);
      assert.equal(reports.docs[0].get("reason"), "privacy");
      assert.equal(reports.docs[0].get("xPostUrl"), ORIGINAL_X_POST_URL);
      assert.equal(reports.docs[0].get("xHandle"), ORIGINAL_X_HANDLE);
    });

    test("legacy privacy通報の再送でも元X情報を私有保存し公開記録を冪等に消す", async () => {
      const seller = await createCaller("legacy-report-seller");
      const reporter = await createCaller("legacy-report-reporter");
      await Promise.all([
        seedLegacyWallet(seller.uid, 100),
        seedLegacyWallet(reporter.uid, 100),
        seedCreatorCard(seller.uid, {
          name: "LEGACY SELLER",
          xHandle: ORIGINAL_X_HANDLE,
        }),
      ]);

      const created = await invoke(seller.fleaAction, listingInput({
        xPostUrl: `${ORIGINAL_X_POST_URL}?s=20#legacy`,
        xConsent: true,
        price: 10,
      }));
      const listingId = created.createdListing.id;
      const reportId = anjuPayEntryId(
        ["flea-report", listingId, reporter.uid].join(":"),
      );
      const legacyCreatedAt = Date.now() - 60_000;
      await firestore.doc(`anjuPayFleaReports/${reportId}`).set({
        schemaVersion: 1,
        listingId,
        sellerUid: seller.uid,
        reporterUid: reporter.uid,
        reason: "privacy",
        createdAt: legacyCreatedAt,
      });

      const replayed = await invoke(reporter.fleaAction, {
        action: "report",
        listingId,
        reason: "other",
      });
      assert.equal(replayed.reported.reported, true);
      assert.equal(replayed.reported.reason, "privacy");
      assert.equal(replayed.reported.xQuarantined, true);

      const [rawListing, rawReport, sellerState, reporterState, reports] = await Promise.all([
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReports/${reportId}`).get(),
        invoke(seller.fleaAction, { action: "state" }),
        invoke(reporter.fleaAction, { action: "state" }),
        firestore
          .collection("anjuPayFleaReports")
          .where("listingId", "==", listingId)
          .get(),
      ]);
      assert.equal(rawListing.get("status"), "active");
      assertStoredXQuarantined(rawListing, "listing after legacy report replay");
      assert.equal(rawReport.get("reason"), "privacy");
      assert.equal(rawReport.get("createdAt"), legacyCreatedAt);
      assert.equal(rawReport.get("xPostUrl"), ORIGINAL_X_POST_URL);
      assert.equal(rawReport.get("xHandle"), ORIGINAL_X_HANDLE);
      assert.equal(reports.size, 1);
      assertPublicListingXQuarantined(
        sellerState.ownListing,
        "seller own listing after legacy report replay",
      );
      assertPublicListingXQuarantined(
        reporterState.listings.find((listing) => listing.id === listingId),
        "public listing after legacy report replay",
      );

      const replayedAgain = await invoke(reporter.fleaAction, {
        action: "report",
        listingId,
        reason: "rights",
      });
      assert.equal(replayedAgain.reported.reason, "privacy");
      assert.equal(replayedAgain.reported.xQuarantined, true);
      const [finalListing, finalReport, finalReports] = await Promise.all([
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        firestore.doc(`anjuPayFleaReports/${reportId}`).get(),
        firestore
          .collection("anjuPayFleaReports")
          .where("listingId", "==", listingId)
          .get(),
      ]);
      assert.equal(finalListing.get("status"), "active");
      assertStoredXQuarantined(finalListing, "listing after repeated report replay");
      assert.equal(finalReport.get("reason"), "privacy");
      assert.equal(finalReport.get("createdAt"), legacyCreatedAt);
      assert.equal(finalReport.get("xPostUrl"), ORIGINAL_X_POST_URL);
      assert.equal(finalReport.get("xHandle"), ORIGINAL_X_HANDLE);
      assert.equal(finalReports.size, 1);

      const cleanedUp = await invoke(seller.fleaAction, {
        action: "cancel_listing",
        listingId,
      });
      assert.equal(cleanedUp.canceled.status, "canceled");
    });

    test("activeからsoldへ変わるcursorでも当日52件を公平順で重複なく送る", async () => {
      // Earlier E2E cases intentionally leave sold listings behind. Isolate this
      // pagination fixture so the expected 52-item order is exact.
      await firestore.recursiveDelete(firestore.collection("anjuPayFleaListings"));
      const viewer = await createCaller("browse-viewer");
      await seedLegacyWallet(viewer.uid, 10);
      const initialState = await invoke(viewer.fleaAction, { action: "state" });
      const browseOrder = crypto
        .createHash("sha256")
        .update(`${suiteId}:shared-browse-order`)
        .digest("hex")
        .slice(0, 40);
      const seededIds = [];
      const batch = firestore.batch();
      for (let index = 0; index < 52; index += 1) {
        const listingId = crypto
          .createHash("sha256")
          .update(`${suiteId}:paged-listing:${index}`)
          .digest("hex")
          .slice(0, 40);
        const sellerUid = `flea-page-seller-${suiteId}-${index}`;
        const publicSellerId = crypto
          .createHash("sha256")
          .update(`${suiteId}:paged-public-seller:${index}`)
          .digest("hex")
          .slice(0, 40);
        privateUidValues.add(sellerUid);
        seededIds.push(listingId);
        batch.set(firestore.doc(`anjuPayFleaListings/${listingId}`), {
          schemaVersion: 1,
          sellerUid,
          publicSellerId,
          sellerName: `店主${String(index + 1).padStart(2, "0")}`,
          creatorCardEntryId: "",
          sellerCard: null,
          dateKey: initialState.dateKey,
          status: "active",
          category: "photo",
          title: `同じ並び順の写真作品${String(index + 1).padStart(2, "0")}`,
          description: "同じ並び値でも、一品ずつ重複なく続きを読めることを確かめる説明文です。",
          price: 10,
          xPostUrl: "",
          xConsent: false,
          listingFee: 1,
          payloadHash: listingId,
          browseOrder,
          createdAt: initialState.serverNow + index,
          expiresAt: initialState.expiresAt,
          updatedAt: initialState.serverNow + index,
        });
      }
      await batch.commit();

      const firstPage = await invoke(viewer.fleaAction, { action: "state" });
      const sortedIds = [...seededIds].sort();
      assert.equal(firstPage.listings.length, 50);
      assert.equal(firstPage.hasMore, true);
      assert.equal(firstPage.nextBrowseCursor, sortedIds[49]);
      assert.deepEqual(
        firstPage.listings.map((listing) => listing.id),
        sortedIds.slice(0, 50),
      );

      await firestore.doc(`anjuPayFleaListings/${firstPage.nextBrowseCursor}`).update({
        status: "sold",
        buyerUid: viewer.uid,
        soldAt: Date.now(),
        updatedAt: Date.now(),
      });
      const secondPage = await invoke(viewer.fleaAction, {
        action: "browse_more",
        cursor: firstPage.nextBrowseCursor,
      });
      assert.equal(secondPage.appendListings, true);
      assert.equal(secondPage.hasMore, false);
      assert.equal(secondPage.nextBrowseCursor, null);
      assert.deepEqual(
        secondPage.listings.map((listing) => listing.id),
        sortedIds.slice(50),
      );
      const allIds = [
        ...firstPage.listings.map((listing) => listing.id),
        ...secondPage.listings.map((listing) => listing.id),
      ];
      assert.equal(new Set(allIds).size, 52);
      assert.deepEqual(allIds, sortedIds);

      await firestore.doc(`anjuPayFleaListings/${firstPage.nextBrowseCursor}`).update({
        status: "active",
        updatedAt: Date.now(),
      });
      const firstSellerPage = await invoke(viewer.fleaAction, {
        action: "browse_sellers",
        category: "photo",
      });
      assert.equal(firstSellerPage.category, "photo");
      assert.equal(firstSellerPage.appendSellerListings, false);
      assert.equal(firstSellerPage.sellerListings.length, 50);
      assert.equal(firstSellerPage.hasMoreSellers, true);
      assert.equal(firstSellerPage.nextSellerCursor, sortedIds[49]);
      assert.deepEqual(
        firstSellerPage.sellerListings.map((listing) => listing.id),
        sortedIds.slice(0, 50),
      );
      assertNoMarketStatistics(firstSellerPage);

      await firestore.doc(`anjuPayFleaListings/${firstSellerPage.nextSellerCursor}`).update({
        status: "sold",
        buyerUid: viewer.uid,
        soldAt: Date.now(),
        updatedAt: Date.now(),
      });
      const secondSellerPage = await invoke(viewer.fleaAction, {
        action: "browse_sellers",
        category: "photo",
        cursor: firstSellerPage.nextSellerCursor,
      });
      assert.equal(secondSellerPage.category, "photo");
      assert.equal(secondSellerPage.appendSellerListings, true);
      assert.equal(secondSellerPage.hasMoreSellers, false);
      assert.equal(secondSellerPage.nextSellerCursor, null);
      assert.deepEqual(
        secondSellerPage.sellerListings.map((listing) => listing.id),
        sortedIds.slice(50),
      );
      assert.deepEqual(
        [
          ...firstSellerPage.sellerListings,
          ...secondSellerPage.sellerListings,
        ].map((listing) => listing.id),
        sortedIds,
      );
      assertNoMarketStatistics(secondSellerPage);
      const soldSellerPage = await invoke(viewer.fleaAction, {
        action: "browse_sellers",
        category: "photo",
      });
      const soldCategoryListing = soldSellerPage.sellerListings.find(
        (listing) => listing.id === firstSellerPage.nextSellerCursor,
      );
      assert.equal(soldCategoryListing?.status, "sold");
      assert.equal(Object.hasOwn(soldCategoryListing, "buyerUid"), false);
      assert.equal(Object.hasOwn(soldCategoryListing, "soldAt"), false);

      await assert.rejects(
        () => invoke(viewer.fleaAction, {
          action: "browse_sellers",
          category: "illustration",
          cursor: firstSellerPage.nextSellerCursor,
        }),
        (error) => {
          assert.equal(error.code, "functions/invalid-argument");
          return true;
        },
      );
    });

    test("売りっ子カードは解除済み市場実績だけを反映し、出品・Pay・市場統計を分離する", async () => {
      const seller = await createCaller("urikko-card-seller");
      const viewer = await createCaller("urikko-card-viewer");
      const now = Date.now();
      const marketStatsReference = firestore.doc(`valueMarketStats/${seller.uid}`);
      const achievementReference = firestore.doc(`achievementProfiles/${seller.uid}`);
      await Promise.all([
        seedLegacyWallet(seller.uid, 100),
        seedLegacyWallet(viewer.uid, 25),
        achievementReference.set({
          schemaVersion: 1,
          unlocked: {
            market_seller_1: now - 2_000,
            battle_total_1: now - 1_000,
          },
          pendingUnlocks: {},
          customShowcase: [],
          initializedAt: now - 2_000,
          updatedAt: now - 1_000,
        }),
        marketStatsReference.set({
          uid: seller.uid,
          name: "URIKKO SELLER",
          salesCount: 1,
          grossSales: 500,
          marketFeesPaid: 25,
          netSales: 475,
          bestSale: 500,
          marketDays: 1,
          uniqueCounterparties: 1,
          publicAchievements: ["market_seller_1"],
          testMarker: `${suiteId}:market-stats-must-not-change`,
          updatedAt: now,
        }),
      ]);

      const created = await invoke(seller.fleaAction, listingInput({
        name: "URIKKO SELLER",
        category: "outfit",
        title: "夜色を重ねた衣装コーデ",
        description: "落ち着いた夜色を中心に、ことばから雰囲気を想像できる組み合わせを考えました。",
        price: 10,
      }));
      const listingId = created.createdListing.id;
      assert.deepEqual(created.createdListing.seller.urikkoCard, {
        schemaVersion: 1,
        tagline: "",
        themeId: "standard",
        sealId: "heart",
        achievementIds: [],
      });
      assert.ok(created.unlockedMarketAchievementIds.includes("market_seller_1"));
      assert.ok(!created.unlockedMarketAchievementIds.includes("battle_total_1"));

      const [ledgerBefore, marketStatsBeforeSnapshot, mirrorBeforeSnapshot] = await Promise.all([
        readLedger(seller.uid),
        marketStatsReference.get(),
        realtime.ref(`online/economy/${seller.uid}/balance`).get(),
      ]);
      const marketStatsBefore = marketStatsBeforeSnapshot.data();
      const mirrorBefore = mirrorBeforeSnapshot.val();
      assertContinuousLedger(ledgerBefore, 99);

      const cardInput = {
        action: "save_urikko_card",
        tagline: "ことばで、今日の好きに出会いたい。",
        themeId: "sakura",
        sealId: "ribbon",
      };
      for (const achievementId of ["market_seller_3", "battle_total_1"]) {
        await assert.rejects(
          () => invoke(seller.fleaAction, {
            ...cardInput,
            achievementIds: [achievementId],
          }),
          (error) => {
            assert.equal(error.code, "functions/failed-precondition");
            return true;
          },
        );
      }

      const saved = await invoke(seller.fleaAction, {
        ...cardInput,
        achievementIds: ["market_seller_1"],
      });
      const expectedCard = {
        schemaVersion: 1,
        tagline: cardInput.tagline,
        themeId: "sakura",
        sealId: "ribbon",
        achievementIds: ["market_seller_1"],
      };
      assert.deepEqual(saved.savedUrikkoCard, expectedCard);
      assert.deepEqual(saved.urikkoCard, expectedCard);
      assert.ok(saved.unlockedMarketAchievementIds.includes("market_seller_1"));
      assert.ok(!saved.unlockedMarketAchievementIds.includes("battle_total_1"));
      assertNoMarketStatistics(saved);

      const [
        rawCard,
        rawListing,
        ledgerAfter,
        marketStatsAfterSnapshot,
        mirrorAfterSnapshot,
      ] = await Promise.all([
        firestore.doc(`anjuPayFleaSellerCards/${seller.uid}`).get(),
        firestore.doc(`anjuPayFleaListings/${listingId}`).get(),
        readLedger(seller.uid),
        marketStatsReference.get(),
        realtime.ref(`online/economy/${seller.uid}/balance`).get(),
      ]);
      assert.equal(rawCard.exists, true);
      assert.match(rawCard.get("publicSellerId"), /^[a-f0-9]{40}$/);
      assert.notEqual(rawCard.get("publicSellerId"), seller.uid);
      assert.deepEqual(rawCard.get("achievementIds"), ["market_seller_1"]);
      assert.deepEqual(rawListing.get("urikkoCard"), expectedCard);
      assert.equal(rawListing.get("status"), "active");
      assert.equal(rawListing.get("sellerUid"), seller.uid);
      assert.deepEqual(stableLedgerShape(ledgerAfter), stableLedgerShape(ledgerBefore));
      assert.deepEqual(marketStatsAfterSnapshot.data(), marketStatsBefore);
      assert.equal(mirrorAfterSnapshot.val(), mirrorBefore);

      const sellerPage = await invoke(viewer.fleaAction, {
        action: "browse_sellers",
        category: "outfit",
      });
      const publicListing = sellerPage.sellerListings.find((listing) => listing.id === listingId);
      assert.ok(publicListing, "category seller browse should include the active seller");
      assert.equal(publicListing.isOwn, false);
      assert.deepEqual(publicListing.seller.urikkoCard, expectedCard);
      assert.deepEqual(
        Object.keys(publicListing.seller.urikkoCard).sort(),
        ["achievementIds", "schemaVersion", "sealId", "tagline", "themeId"].sort(),
      );
      assertNoMarketStatistics(sellerPage);
    });
  });
}
