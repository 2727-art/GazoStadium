"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { refundRetiredCreatorCards } = require("../scripts/refund-retired-creator-cards.cjs");
const safeHost = (value) => /^(127\.0\.0\.1|localhost):\d+$/.test(value || "");
const enabled = safeHost(process.env.FIRESTORE_EMULATOR_HOST) && safeHost(process.env.FIREBASE_DATABASE_EMULATOR_HOST);

test("real transactions refund each buyer once under concurrent migrations and preserve histories", { skip: enabled ? false : "requires local Firestore and RTDB emulators" }, async (context) => {
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getDatabase } = require("firebase-admin/database");
  const projectId = "demo-creator-card-refund";
  const app = initializeApp({ projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` }, "creator-refund-test");
  context.after(() => deleteApp(app));
  const firestore = getFirestore(app); const realtime = getDatabase(app);
  await firestore.doc("systemConfig/anjuPayLedger").set({ enabled: true, activatedAt: 1 });
  const makeWallet = (balance, reservedIncoming = 0) => ({ balance, reservedIncoming, initializedAt: 1 });
  await Promise.all([
    firestore.doc("wallets/legacy-buyer").set(makeWallet(25)),
    firestore.doc("wallets/record-buyer").set(makeWallet(999_999_899, 50)),
    firestore.doc("wallets/nonbuyer").set(makeWallet(11)),
    firestore.doc("economyPurchases/record-buyer/items/feature_top_message").set({ productId: "feature_top_message", price: 500, createdAt: 1 }),
    realtime.ref("online/economy").set({ "legacy-buyer": { points: 25, inventory: { feature_top_message: true }, equipped: { title: "title_test" } },
      "missing-wallet-buyer": { points: 7, inventory: { feature_top_message: true } }, "record-buyer": { points: 999_999_899 }, nonbuyer: { points: 11 } }),
    realtime.ref("online/topMessages/archived").set({ name: "old-card", text: "archived" }),
  ]);
  const dry = await refundRetiredCreatorCards({ firestore, realtime, now: 1000 });
  assert.equal(dry.eligible, 3); assert.equal(dry.creditPay, 1050); assert.equal(dry.pendingPay, 450);
  assert.equal((await firestore.doc("wallets/legacy-buyer").get()).get("balance"), 25);
  await Promise.all([1, 2].map(() => refundRetiredCreatorCards({ firestore, realtime, apply: true, now: 2000 })));
  assert.equal((await firestore.doc("wallets/legacy-buyer").get()).get("balance"), 525);
  assert.equal((await firestore.doc("wallets/record-buyer").get()).get("balance"), 999_999_949);
  assert.equal((await firestore.doc("wallets/nonbuyer").get()).get("balance"), 11);
  assert.equal((await firestore.doc("wallets/missing-wallet-buyer").get()).get("balance"), 507);
  assert.equal((await firestore.collection("wallets/missing-wallet-buyer/anjuPayEntries").get()).size, 2);
  assert.equal((await firestore.collection("wallets/legacy-buyer/anjuPayEntries").get()).size, 2);
  await firestore.doc("wallets/record-buyer").update({ balance: 999_999_449 });
  const rest = await refundRetiredCreatorCards({ firestore, realtime, apply: true, now: 3000 });
  assert.equal(rest.creditPay, 450); assert.equal(rest.pendingPay, 0);
  const retry = await refundRetiredCreatorCards({ firestore, realtime, apply: true, now: 4000 });
  assert.equal(retry.creditPay, 0); assert.equal(retry.alreadyComplete, 3);
  assert.equal((await realtime.ref("online/economy/legacy-buyer/inventory/feature_top_message").get()).val(), true);
  assert.equal((await realtime.ref("online/economy/legacy-buyer/equipped/title").get()).val(), "title_test");
  assert.equal((await realtime.ref("online/topMessages/archived/text").get()).val(), "archived");
  assert.equal((await firestore.doc("economyPurchases/record-buyer/items/feature_top_message").get()).get("price"), 500);
});
