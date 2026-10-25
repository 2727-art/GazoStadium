"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { hashTransferCode } = require("../account-transfer");

if (process.env.RUN_ACCOUNT_INTEGRITY_EMULATOR !== "1") {
  test("account integrity integration requires isolated Auth, Firestore and Database emulators", { skip: "opt-in demo project only" }, () => {});
} else {
  if (process.env.GCLOUD_PROJECT !== "demo-account-integrity") throw Error("demo-account-integrity is required");
  for (const key of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_DATABASE_EMULATOR_HOST"]) {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env[key] || "")) throw Error(`Loopback emulator required: ${key}`);
  }
  // Run the actual callable handlers against emulator services. SDK App Check
  // admission is outside this test; its production options are unchanged.
  const handlers = require("../index");
  const { getAuth } = require("firebase-admin/auth");
  const { getFirestore } = require("firebase-admin/firestore");
  const { getDatabase } = require("firebase-admin/database");
  const { getApps, deleteApp } = require("firebase-admin/app");
  const auth = getAuth(), db = getFirestore(), rtdb = getDatabase();
  const request = (uid, data, provider = "anonymous") => ({
    auth: { uid, token: { firebase: { sign_in_provider: provider } } },
    app: { appId: "local-fixture" }, data,
    rawRequest: { headers: { origin: "https://gazostadium.anjugames.workers.dev" } },
  });
  const economy = (uid, data, provider) => handlers.economyAction.run(request(uid, data, provider));
  const transfer = (uid, data) => handlers.accountTransfer.run(request(uid, data));
  const wallet = uid => db.collection("wallets").doc(uid);
  const legacy = uid => rtdb.ref(`online/economy/${uid}`);
  const user = uid => auth.createUser({ uid });
  const errorReason = reason => e => e.code === "failed-precondition" && e.details.reason === reason && /^[0-9a-f-]{36}$/.test(e.details.diagnosticId);

  before(async () => {
    await db.doc("systemConfig/anjuPayLedger").set({ enabled: true, activatedAt: Date.now(), schemaVersion: 1 });
  });
  after(async () => {
    await db.terminate();
    await Promise.all(getApps().map(app => deleteApp(app)));
  });

  test("mismatched wallet requests cannot create or modify a wallet", async () => {
    await user("mismatch-a");
    await assert.rejects(economy("mismatch-a", { action: "initialize", expectedUid: "mismatch-b" }), errorReason("account-mismatch"));
    assert.equal((await wallet("mismatch-a").get()).exists, false);
    assert.equal((await wallet("mismatch-b").get()).exists, false);
    assert.equal((await legacy("mismatch-a").get()).exists(), false);
  });

  test("first-time and legacy clients initialize normally; old balance and inventory survive migration", async () => {
    await user("old-client");
    await legacy("old-client").set({ points: 450, inventory: { preserved: true } });
    const result = await economy("old-client", { action: "initialize" });
    assert.equal(result.balance, 450);
    assert.equal((await wallet("old-client").get()).get("balance"), 450);
    assert.equal((await legacy("old-client").get()).val().inventory.preserved, true);
    await user("first-time");
    assert.equal((await economy("first-time", { action: "initialize", expectedUid: "first-time" })).balance, 0);
  });

  test("Google-linked identity retains its UID, balance, inventory and ledger on repeat initialization", async () => {
    await user("google-player");
    await auth.updateUser("google-player", { providerToLink: { providerId: "google.com", uid: "google-subject" } });
    assert.ok((await auth.getUser("google-player")).providerData.some(provider => provider.providerId === "google.com"));
    await wallet("google-player").set({ balance: 720, reservedIncoming: 0 });
    await legacy("google-player").set({ points: 720, inventory: { preserved: true } });
    for (let i = 0; i < 2; i++) {
      const result = await economy("google-player", { action: "initialize", expectedUid: "google-player" }, "google.com");
      assert.equal(result.balance, 720);
    }
    assert.equal((await wallet("google-player").collection("anjuPayEntries").get()).size, 1);
    const history = await economy("google-player", { action: "get_anju_pay_wallet", expectedUid: "google-player", limit: 20 }, "google.com");
    assert.equal(history.balance, 720);
    assert.equal(history.entries.length, 1);
    await assert.rejects(economy("google-player", { action: "get_anju_pay_wallet", expectedUid: "different" }, "google.com"), errorReason("account-mismatch"));
    assert.equal((await legacy("google-player").get()).val().inventory.preserved, true);
    assert.equal((await auth.getUser("google-player")).uid, "google-player");
    await assert.rejects(transfer("google-player", { action: "create" }), { code: "failed-precondition" });
  });

  test("corrupt persisted and legacy amounts are not overwritten with zero", async () => {
    await user("corrupt-wallet");
    await wallet("corrupt-wallet").set({ balance: "broken", reservedIncoming: 0 });
    await legacy("corrupt-wallet").set({ points: 720 });
    await assert.rejects(economy("corrupt-wallet", { action: "initialize" }), errorReason("wallet-invalid"));
    assert.equal((await wallet("corrupt-wallet").get()).get("balance"), "broken");
    assert.equal((await legacy("corrupt-wallet").get()).val().points, 720);
    await user("corrupt-legacy");
    await legacy("corrupt-legacy").set({ points: "broken" });
    await assert.rejects(economy("corrupt-legacy", { action: "initialize" }), errorReason("legacy-balance-invalid"));
    assert.equal((await wallet("corrupt-legacy").get()).exists, false);
    assert.equal((await legacy("corrupt-legacy").get()).val().points, "broken");
  });

  test("a mismatched transfer request cannot issue a code or consume an attempt", async () => {
    await user("transfer-mismatch");
    for (const action of ["create", "cancel", "redeem"]) {
      await assert.rejects(transfer("transfer-mismatch", { action, expectedUid: "someone-else", code: "BAD" }), errorReason("account-mismatch"));
    }
    assert.equal((await db.doc("accountTransferSources/transfer-mismatch").get()).exists, false);
    assert.equal((await db.doc("accountTransferAttempts/transfer-mismatch").get()).exists, false);
  });

  test("valid handoff and same-target retry preserve source data and mint tokens for the original UID", async () => {
    await user("source"); await user("target"); await user("third");
    await wallet("source").set({ balance: 850, reservedIncoming: 0 });
    const created = await transfer("source", { action: "create", expectedUid: "source" });
    const first = await transfer("target", { action: "redeem", expectedUid: "target", code: created.code });
    const retry = await transfer("target", { action: "redeem", code: created.code });
    assert.equal(first.outcome, "redeemed"); assert.equal(retry.outcome, "redeemed");
    for (const result of [first, retry]) {
      const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: result.token, returnSecureToken: true }),
      });
      assert.equal(response.status, 200);
      const signedIn = await response.json();
      assert.equal((await auth.verifyIdToken(signedIn.idToken)).uid, "source");
    }
    await assert.rejects(transfer("third", { action: "redeem", code: created.code }), { code: "not-found" });
    assert.equal((await wallet("source").get()).get("balance"), 850);
    assert.equal((await wallet("target").get()).exists, false);
  });

  test("inconsistent source/code records cannot be redeemed or consume the code", async () => {
    await user("broken-source"); await user("broken-target");
    const created = await transfer("broken-source", { action: "create" });
    await db.doc("accountTransferSources/broken-source").update({ activeCodeHash: "different-code" });
    await assert.rejects(transfer("broken-target", { action: "redeem", code: created.code }), errorReason("transfer-source-mismatch"));
    assert.equal((await db.doc(`accountTransferCodes/${hashTransferCode(created.code)}`).get()).get("usedAt"), 0);
  });

  test("canceling an unused code preserves the source wallet and prevents redemption", async () => {
    await user("cancel-source"); await user("cancel-target");
    await wallet("cancel-source").set({ balance: 95 });
    const created = await transfer("cancel-source", { action: "create" });
    assert.equal((await transfer("cancel-source", { action: "cancel", expectedUid: "cancel-source" })).outcome, "canceled");
    await assert.rejects(transfer("cancel-target", { action: "redeem", code: created.code }), { code: "not-found" });
    assert.equal((await wallet("cancel-source").get()).get("balance"), 95);
  });
}
