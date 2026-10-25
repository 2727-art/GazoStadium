"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const { assertExpectedAccount, assertWalletIntegrity, assertLegacyBalance, integrityError, accountKey, createAccountDiagnostics } = require("../account-diagnostics");
const maximum = 999999999;
const request = (data = {}) => ({ auth: { uid: "private-player-uid", token: { email: "private@example.test", firebase: { sign_in_provider: "google.com" } } }, app: { appId: "app" }, rawRequest: { headers: { origin: "https://gazostadium.anjugames.workers.dev" } }, data });
const diagnosticId = "01234567-89ab-4cde-8fab-0123456789ab";

test("old clients and matching clients retain their original successful result", async () => {
  const records = [], diagnose = createAccountDiagnostics({ write: r => records.push(r), randomId: () => diagnosticId });
  const result = { balance: 750, token: "secret-custom-token" };
  for (const data of [{}, { expectedUid: "private-player-uid" }]) {
    assert.equal(await diagnose(request(data), "wallet_initialize", async () => result), result);
  }
  assert.equal(records[0].expectedAccount, "legacy_client");
  assert.equal(records[1].expectedAccount, "provided");
  assert.equal(records[0].accountKey, accountKey("private-player-uid"));
  assert.equal(records[0].provider, "google.com");
  assert.equal(records[0].origin, "legacy_worker");
  assert.doesNotMatch(JSON.stringify(records), /private-player-uid|private@example|secret-custom-token|750/);
});

for (const expectedUid of ["different", "", null, 7, {}, "x".repeat(129)]) {
  test(`account mismatch or invalid hint stops all work before the handler (${JSON.stringify(expectedUid).slice(0, 30)})`, async () => {
    let calls = 0;
    const records = [], diagnose = createAccountDiagnostics({ write: r => records.push(r), randomId: () => diagnosticId });
    await assert.rejects(diagnose(request({ expectedUid, code: "SECRET-CODE", token: "SECRET-TOKEN" }), "transfer_redeem", async () => { calls++; }), e => e.code === "failed-precondition" && e.details.diagnosticId === diagnosticId);
    assert.equal(calls, 0);
    assert.equal(records[0].outcome, "failure");
    assert.doesNotMatch(JSON.stringify(records), /SECRET-CODE|SECRET-TOKEN|different/);
  });
}

test("no authentication cannot proceed", () => {
  assert.throws(() => assertExpectedAccount({ data: {} }), { code: "unauthenticated" });
});

test("diagnostic logging failures do not change successful or expected error outcomes", async () => {
  const diagnose = createAccountDiagnostics({ write() { throw new Error("logging offline"); }, randomId: () => diagnosticId });
  assert.equal(await diagnose(request(), "wallet_initialize", async () => 123), 123);
  await assert.rejects(diagnose(request(), "transfer_create", async () => { throw new HttpsError("resource-exhausted", "少し待ってください。"); }), e => e.code === "resource-exhausted" && e.message === "少し待ってください。" && e.details.diagnosticId === diagnosticId);
});

test("unexpected errors and arbitrary origins are sanitized in diagnostics and responses", async () => {
  const records = [], diagnose = createAccountDiagnostics({ write: r => records.push(r), randomId: () => diagnosticId });
  const input = request(); input.rawRequest.headers.origin = "https://secret-user.example/path";
  await assert.rejects(diagnose(input, "arbitrary-action", async () => { throw new Error("secret bearer token or database document path"); }), e => e.code === "internal" && !e.message.includes("secret"));
  assert.equal(records[0].origin, "other");
  assert.equal(records[0].operation, "transfer_other");
  assert.doesNotMatch(JSON.stringify(records), /secret|bearer|document path/);
});

test("existing numeric wallets, legacy integer strings, and absent optional fields remain compatible", () => {
  for (const balance of [0, 375, maximum, "0", "375"]) {
    assertWalletIntegrity({ balance }, maximum);
    assertWalletIntegrity({ balance, reservedIncoming: 0 }, maximum);
    assertLegacyBalance({ points: balance }, maximum);
  }
  assertLegacyBalance({}, maximum);
});

for (const balance of [undefined, null, "", "garbage", -1, 1.2, NaN, Infinity, maximum + 1, true, {}]) {
  test(`malformed stored balance is stopped instead of normalized to zero (${String(balance)})`, () => {
    assert.throws(() => assertWalletIntegrity({ balance }, maximum), e => e.details.reason === "wallet-invalid");
    if (balance !== undefined) assert.throws(() => assertLegacyBalance({ points: balance }, maximum), e => e.details.reason === "legacy-balance-invalid");
  });
}

test("malformed reservation is also preserved for investigation", () => {
  assert.throws(() => assertWalletIntegrity({ balance: 5, reservedIncoming: "broken" }, maximum));
});

test("a wallet disappearing during initialization cannot be recreated from a zero fallback", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");
  const body = source.slice(source.indexOf("async function ensureWallet("), source.indexOf("async function mirrorWallet("));
  let writes = 0;
  const context = vm.createContext({
    MAX_POINTS: maximum, assertWalletIntegrity, assertLegacyBalance, integrityError,
    walletRef: () => ({ get: async () => ({ exists: true }) }),
    anjuPayLedgerConfigRef: () => "config",
    firestore: { runTransaction: async fn => fn({ get: async () => ({ exists: false }), create() { writes++; } }) },
    safeBalance: Number, stageAnjuPayOpening() { writes++; }, mirrorWallet() { writes++; },
  });
  vm.runInContext(body, context);
  await assert.rejects(context.ensureWallet("player"), e => e.details.reason === "wallet-disappeared");
  assert.equal(writes, 0);
});
