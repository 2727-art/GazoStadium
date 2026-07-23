const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  TRANSFER_BLOCK_MS,
  TRANSFER_CODE_LENGTH,
  TRANSFER_MAX_FAILURES,
  createTransferCode,
  formatTransferCode,
  hashTransferCode,
  nextAttemptState,
  normalizeAttemptState,
  normalizeTransferCode,
  transferCodeDecision,
} = require("../account-transfer");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("transfer codes are user-formatted high-entropy bearer secrets", () => {
  let next = 0;
  const code = createTransferCode((maximum) => (next++) % maximum);
  const compact = normalizeTransferCode(code);
  assert.equal(compact.length, TRANSFER_CODE_LENGTH);
  assert.equal(formatTransferCode(compact), code);
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}(?:-[A-HJ-KM-NP-Z2-9]{4}){3}$/);
  assert.equal(hashTransferCode(code), hashTransferCode(compact));
  assert.equal(normalizeTransferCode("OOOO-1111-IIII-LLLL"), "");
});

test("transfer codes are one-destination and retryable only by the claiming guest", () => {
  const now = 10_000;
  const active = { sourceUid: "source", expiresAt: now + 10_000, usedAt: 0 };
  assert.deepEqual(transferCodeDecision(active, "source", now), {
    outcome: "same-account",
    sourceUid: "source",
  });
  assert.deepEqual(transferCodeDecision(active, "target", now), {
    outcome: "redeem",
    sourceUid: "source",
  });

  const claimed = {
    ...active,
    usedAt: now,
    usedByUid: "target",
    retryUntil: now + 2_000,
  };
  assert.deepEqual(transferCodeDecision(claimed, "target", now + 1), {
    outcome: "retry",
    sourceUid: "source",
  });
  assert.equal(transferCodeDecision(claimed, "attacker", now + 1).outcome, "used");
  assert.equal(transferCodeDecision(claimed, "target", now + 2_001).outcome, "used");
  assert.equal(transferCodeDecision(active, "target", now + 10_001).outcome, "expired");
});

test("failed transfer attempts are windowed and eventually blocked", () => {
  const now = 100_000;
  let state = normalizeAttemptState(null, now);
  for (let index = 0; index < TRANSFER_MAX_FAILURES; index += 1) {
    state = nextAttemptState(state, { now: now + index });
  }
  assert.equal(state.failures, TRANSFER_MAX_FAILURES);
  assert.equal(state.blockedUntil, now + (TRANSFER_MAX_FAILURES - 1) + TRANSFER_BLOCK_MS);
  assert.equal(normalizeAttemptState(state, now + 1).blockedUntil, state.blockedUntil);
  assert.deepEqual(
    nextAttemptState(state, { now: state.blockedUntil + 1, success: true }),
    {
      windowStartedAt: state.blockedUntil + 1,
      failures: 0,
      blockedUntil: 0,
      updatedAt: state.blockedUntil + 1,
    },
  );
});

test("account protection wiring preserves UID and never copies wallet data", () => {
  const client = read("account.js");
  const server = read("functions/index.js");
  const rules = read("firestore.rules");
  assert.match(client, /linkWithPopup\(user, googleProvider\)/);
  assert.doesNotMatch(client, /signInWithPopup/);
  assert.match(client, /signInWithCredential\(auth, state\.pendingGoogleCredential\)/);
  assert.match(client, /signInWithCustomToken\(auth, token\)/);
  assert.match(client, /onIdTokenChanged\(auth/);
  assert.match(client, /current\.uid !== state\.user\.uid/);
  assert.match(client, /TRANSFER_SESSION_KEY/);
  assert.match(server, /adminAuth\.createCustomToken\(sourceUid/);
  assert.match(server, /sign_in_provider !== "anonymous"/);
  assert.match(server, /sourceUser\.providerData\.length > 0/);
  assert.match(server, /provider\.providerId === "google\.com"/);
  assert.match(server, /transferTargetIsPristine/);
  assert.match(server, /retryUntil: Number\(codeSnapshot\.get\("expiresAt"\)/);
  assert.doesNotMatch(server, /copyAccount|mergeAccount|transferWallet/);
  for (const collection of [
    "valueMarketPatrons",
    "valueMarketPatronLedger",
    "accountTransferCodes",
    "accountTransferSources",
    "accountTransferAttempts",
  ]) {
    assert.match(rules, new RegExp(`match /${collection}/`));
  }
});

test("high-value patron spending is Google-gated and server-priced", () => {
  const server = read("functions/index.js");
  const patronStart = server.indexOf("async function upgradePatronage");
  const patronEnd = server.indexOf("async function initializeEconomy", patronStart);
  const patronSource = server.slice(patronStart, patronEnd);
  assert.ok(patronStart >= 0 && patronEnd > patronStart);
  assert.match(server, /identities\?\.\["google\.com"\]/);
  assert.match(patronSource, /hasGoogleIdentity\(request\)/);
  assert.match(patronSource, /hasLiveGoogleIdentity\(uid\)/);
  assert.match(patronSource, /patronUpgrade\(current, targetTier, seasonKey\)/);
  assert.doesNotMatch(patronSource, /data\?\.amount/);
  assert.match(patronSource, /transaction\.update\(wallet, \{ balance: after/);
  assert.match(patronSource, /transaction\.create\(ledgerRef/);
  assert.match(server, /\.\.\.publicPatronage\(patron, periodKey\("monthly"\)\),\s*lifetimeSpent: patron\.lifetimeSpent/);
});
