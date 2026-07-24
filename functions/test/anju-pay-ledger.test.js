const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ANJU_PAY_LEDGER_SCHEMA_VERSION,
  ANJU_PAY_OPENING_ENTRY_ID,
  activateAnjuPayWallet,
  anjuPayEntryId,
  anjuPayLedgerModeDecision,
  isAnjuPayWalletActive,
  nextAnjuPayEntry,
  sanitizeAnjuPayEntry,
} = require("../anju-pay-ledger");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const server = read("functions/index.js");

function between(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return server.slice(start, end);
}

test("wallet activation creates one zero-delta opening balance and is idempotent", () => {
  const occurredAt = 1_722_222_222_222;
  const activation = activateAnjuPayWallet({
    balance: 432,
    reservedIncoming: 90,
  }, occurredAt);

  assert.equal(activation.activated, true);
  assert.deepEqual(activation.walletPatch, {
    ledgerVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    historyStartedAt: occurredAt,
    ledgerSequence: 0,
  });
  assert.deepEqual(activation.openingEntry, {
    schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    sequence: 0,
    groupId: ANJU_PAY_OPENING_ENTRY_ID,
    type: "opening",
    kind: "opening",
    category: "opening",
    labelKey: "anju_pay_opening",
    status: "posted",
    delta: 0,
    nominalAmount: 0,
    balanceBefore: 432,
    balanceAfter: 432,
    openingBalance: 432,
    components: [],
    details: {},
    occurredAt,
  });

  const activeWallet = { balance: 999, ...activation.walletPatch };
  assert.equal(isAnjuPayWalletActive(activeWallet), true);
  assert.deepEqual(activateAnjuPayWallet(activeWallet, occurredAt + 1), {
    activated: false,
    walletPatch: {},
    openingEntry: null,
  });
});

test("ledger mode fails closed for missing, reverted, and incomplete activation state", () => {
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: false,
    ledgerRequired: true,
  }), { allowed: false, enabled: false, reason: "missing-config" });
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: true,
    enabledFlag: true,
    markerActive: false,
    ledgerRequired: false,
    walletActive: false,
  }), { allowed: false, enabled: false, reason: "incomplete-marker" });
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: true,
    enabledFlag: false,
    markerActive: false,
    ledgerRequired: true,
    walletActive: false,
  }), { allowed: false, enabled: false, reason: "ledger-required" });
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: true,
    enabledFlag: false,
    markerActive: false,
    ledgerRequired: false,
    walletActive: true,
  }), { allowed: false, enabled: false, reason: "wallet-mismatch" });
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: true,
    enabledFlag: false,
    markerActive: true,
    ledgerRequired: true,
    walletActive: false,
  }), { allowed: true, enabled: true, reason: "" });
  assert.deepEqual(anjuPayLedgerModeDecision({
    configExists: true,
    enabledFlag: false,
    markerActive: false,
    ledgerRequired: false,
    walletActive: false,
  }), { allowed: true, enabled: false, reason: "" });
});

test("entries retain all 88 daily-play claims and enforce ledger math", () => {
  const wallet = {
    balance: 1_000,
    ledgerVersion: 1,
    historyStartedAt: 1_700_000_000_000,
    ledgerSequence: 7,
  };
  const groupId = anjuPayEntryId("daily-play:eight-days");
  const claims = Array.from({ length: 88 }, (_, index) => {
    const dayOffset = Math.floor(index / 11);
    return {
      dateKey: `2026-07-${String(10 + dayOffset).padStart(2, "0")}`,
      tierId: `daily_play_${(index % 11) + 1}`,
      credited: index < 44 ? 1 : 0,
      nominalAmount: 1,
      status: index < 44 ? "posted" : "capped",
    };
  });
  const components = claims.map((claim) => ({
    kind: "daily_play_reward",
    labelKey: "anju_pay_daily_play_reward",
    delta: claim.credited,
    nominalAmount: 1,
    status: claim.status,
  }));
  const next = nextAnjuPayEntry(wallet, {
    entryId: groupId,
    groupId,
    kind: "daily_play_reward",
    category: "earn",
    delta: 44,
    nominalAmount: 88,
    balanceBefore: 1_000,
    balanceAfter: 1_044,
    components,
    details: {
      tierIds: claims.map((claim) => claim.tierId),
      dailyPlayClaims: claims,
    },
    occurredAt: 1_700_000_000_001,
  });

  assert.deepEqual(next.walletPatch, { ledgerSequence: 8 });
  assert.equal(next.entry.sequence, 8);
  assert.equal(next.entry.components.length, 88);
  assert.equal(next.entry.components.reduce((sum, item) => sum + item.delta, 0), 44);
  assert.equal(next.entry.details.dailyPlayClaims.length, 88);
  assert.equal(new Set(next.entry.details.dailyPlayClaims.map((claim) => claim.dateKey)).size, 8);
  assert.throws(() => nextAnjuPayEntry(wallet, {
    entryId: groupId,
    groupId,
    balanceBefore: 10,
    balanceAfter: 12,
    delta: 1,
  }), /delta must match/);
  assert.throws(() => nextAnjuPayEntry(wallet, {
    entryId: groupId,
    groupId,
    balanceBefore: 10,
    balanceAfter: 12,
    delta: 2,
    components: [{ delta: 1 }],
  }), /components must sum/);
});

test("period reward details retain validated keys and nominal amounts", () => {
  const groupId = anjuPayEntryId("period-reward-details");
  const entry = nextAnjuPayEntry({
    balance: 500,
    ledgerVersion: 1,
    historyStartedAt: 1_700_000_000_000,
    ledgerSequence: 1,
  }, {
    entryId: groupId,
    groupId,
    kind: "period_reward",
    category: "earn",
    delta: 75,
    balanceBefore: 500,
    balanceAfter: 575,
    components: [{ delta: 75, nominalAmount: 75 }],
    details: {
      periods: [
        { period: "daily", key: "2026-07-20", nominalAmount: 25 },
        { period: "weekly", key: "2026-07-14", nominalAmount: 50 },
        { period: "monthly", key: "not-a-month", nominalAmount: 100 },
      ],
    },
  }).entry;

  assert.deepEqual(entry.details.periods, [
    { period: "daily", key: "2026-07-20", nominalAmount: 25 },
    { period: "weekly", key: "2026-07-14", nominalAmount: 50 },
    { period: "monthly", nominalAmount: 100 },
  ]);
});

test("entry construction and API sanitization drop UIDs, raw room IDs, and unknown fields", () => {
  const wallet = {
    balance: 100,
    ledgerVersion: 1,
    historyStartedAt: 1_700_000_000_000,
    ledgerSequence: 0,
  };
  const groupId = anjuPayEntryId("tip:private-room");
  const stored = nextAnjuPayEntry(wallet, {
    entryId: groupId,
    groupId,
    kind: "post_match_tip_sent",
    category: "tip",
    delta: -10,
    nominalAmount: 10,
    balanceBefore: 100,
    balanceAfter: 90,
    uid: "secret-user",
    roomId: "secret-room",
    senderUid: "secret-sender",
    details: {
      uid: "secret-user",
      roomId: "secret-room",
      recipientUid: "secret-recipient",
      counterpartyName: "ANJU",
      mode: "solo",
    },
    components: [{
      kind: "post_match_tip",
      delta: -10,
      nominalAmount: 10,
      uid: "secret-user",
      roomId: "secret-room",
    }],
    occurredAt: 1_700_000_000_001,
  }).entry;
  const apiEntry = sanitizeAnjuPayEntry(groupId, {
    ...stored,
    uid: "corrupt-user",
    roomId: "corrupt-room",
    recipientUid: "corrupt-recipient",
    details: {
      ...stored.details,
      uid: "corrupt-user",
      roomId: "corrupt-room",
    },
  });
  const serialized = JSON.stringify({ stored, apiEntry });

  for (const privateValue of [
    "secret-user",
    "secret-room",
    "secret-sender",
    "secret-recipient",
    "corrupt-user",
    "corrupt-room",
    "corrupt-recipient",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
  assert.equal(apiEntry.details.counterpartyName, "ANJU");
  assert.equal(apiEntry.details.mode, "solo");
});

test("opening entries keep their fixed public marker through sanitization", () => {
  const opening = activateAnjuPayWallet({ balance: 77 }, 1_700_000_000_000).openingEntry;
  const apiEntry = sanitizeAnjuPayEntry(ANJU_PAY_OPENING_ENTRY_ID, opening);
  assert.equal(apiEntry.id, ANJU_PAY_OPENING_ENTRY_ID);
  assert.equal(apiEntry.groupId, ANJU_PAY_OPENING_ENTRY_ID);
  assert.equal(apiEntry.openingBalance, 77);
});

test("deterministic entry hashes are stable without exposing their source", () => {
  const first = anjuPayEntryId("room-raw-value:action-1");
  assert.equal(first, anjuPayEntryId("room-raw-value:action-1"));
  assert.notEqual(first, anjuPayEntryId("room-raw-value:action-2"));
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.doesNotMatch(first, /room|action/);
});

test("every wallet mutation transaction reads the rollout config and stages the opening", () => {
  const ranges = [
    between("async function ensureWallet", "async function mirrorWallet"),
    between("async function upgradePatronage", "async function initializeEconomy"),
    between("async function claimDaily(uid", "async function claimDailyPlayRewards"),
    between("async function claimDailyPlayRewards", "async function purchaseProduct"),
    between("async function purchaseProduct", "async function claimPeriods"),
    between("async function claimPeriods", "const VERIFIED_MATCH_MODES"),
    between("async function sendPostMatchTip", "function anjuPayHistoryRequest"),
    between("async function performMarketAction", "exports.valueMarketAction"),
  ];
  for (const source of ranges) {
    assert.match(source, /transaction\.get\(anjuPayLedgerConfigRef\(\)\)/);
    assert.match(source, /stageAnjuPayOpening\(/);
  }
});

test("secondary claim reads occur before the first staged ledger write", () => {
  const dailyPlay = between(
    "async function claimDailyPlayRewards",
    "async function purchaseProduct",
  );
  const periods = between("async function claimPeriods", "const VERIFIED_MATCH_MODES");
  assert.ok(
    dailyPlay.indexOf("transaction.get(claimRef)")
      < dailyPlay.indexOf("stageAnjuPayOpening("),
  );
  assert.ok(
    periods.indexOf("transaction.get(ref)")
      < periods.indexOf("stageAnjuPayOpening("),
  );
});

test("business entries cover rewards, spending, both tip wallets, and both market wallets", () => {
  const daily = between("async function claimDaily(uid", "async function claimDailyPlayRewards");
  const dailyPlay = between(
    "async function claimDailyPlayRewards",
    "async function purchaseProduct",
  );
  const purchase = between("async function purchaseProduct", "async function claimPeriods");
  const periods = between("async function claimPeriods", "const VERIFIED_MATCH_MODES");
  const tips = between("async function sendPostMatchTip", "function anjuPayHistoryRequest");
  const market = between("async function performMarketAction", "exports.valueMarketAction");

  assert.match(daily, /anjuPayRewardStatus\(credited, mission\.reward\)/);
  assert.match(dailyPlay, /settlement\.claimedCount > 0[\s\S]*appendAnjuPayEntry/);
  assert.match(periods, /if \(available\.length\)[\s\S]*appendAnjuPayEntry/);
  assert.match(purchase, /migrated: true[\s\S]*persistAnjuPayOpening[\s\S]*return;/);
  assert.ok(purchase.indexOf("migrated: true") < purchase.indexOf("appendAnjuPayEntry("));
  assert.equal((tips.match(/appendAnjuPayEntry\(/g) || []).length, 2);
  assert.match(tips, /post_match_tip_sent[\s\S]*post_match_tip_received/);
  assert.match(tips, /anjuPayEntryId\(`post-match-tip:\$\{tipRef\.id\}`\)/);
  assert.match(market, /captureMarketBalanceChanges/);
  assert.match(market, /appendMarketEntry\(\s*"seller"/);
  assert.match(market, /appendMarketEntry\(\s*"buyer"/);
  assert.match(market, /if \(!delta && !components\.length\) return;/);
  assert.match(market, /"sale_gross"[\s\S]*"success_fee"/);
  assert.match(market, /"entry_fee_settlement",\s*"settled",\s*0,/);
  assert.match(market, /"extension_incentive", "settled", 0, held/);
});

test("history API is bounded, sanitized, and pinned to the wallet sequence snapshot", () => {
  const history = between("function anjuPayHistoryRequest", "exports.economyAction");
  assert.match(server, /action === "get_anju_pay_wallet"\) return await getAnjuPayWallet/);
  assert.match(history, /ANJU_PAY_HISTORY_DEFAULT_LIMIT/);
  assert.match(history, /ANJU_PAY_HISTORY_MAX_LIMIT/);
  assert.match(history, /available: false/);
  assert.match(history, /available: true/);
  assert.match(history, /availableBalance/);
  assert.match(history, /balance: currentBalance/);
  assert.match(history, /sanitizeAnjuPayEntry\(document\.id, document\.data\(\)\)/);
  assert.match(history, /walletSnapshot\.get\("ledgerSequence"\)/);
  assert.match(history, /\.where\("sequence", "<=", sequenceUpperBound\)/);
  assert.match(history, /\.orderBy\("sequence", "desc"\)/);
  assert.match(history, /\.limit\(limit \+ 1\)/);
});

test("Firestore Rules block direct ledger and rollout-config access", () => {
  const rules = read("firestore.rules");
  assert.match(
    rules,
    /match \/wallets\/\{uid\}[\s\S]*?match \/anjuPayEntries\/\{entryId\} \{\s*allow read, write: if false;/,
  );
  assert.match(
    rules,
    /match \/systemConfig\/\{configId\} \{\s*allow read, write: if false;/,
  );
});

test("rollout instructions require a three-stage one-way production activation", () => {
  const rollout = read("functions/ANJU_PAY_LEDGER_ROLLOUT.md");
  assert.match(rollout, /3段階/);
  assert.match(rollout, /30秒/);
  assert.match(rollout, /one-way/);
  assert.match(rollout, /activatedAt: 0/);
  assert.match(rollout, /enabled: true.*activatedAt/);
  assert.match(rollout, /ANJU_PAY_LEDGER_REQUIRED=false/);
  assert.match(rollout, /ANJU_PAY_LEDGER_REQUIRED=true/);
  assert.match(rollout, /fail-closed/);
  assert.match(rollout, /互換revisionへロールバックしてはいけません/);
  assert.match(rollout, /available: false/);
});

test("activatedAt is the one-way ledger marker and transfer targets reject sequence activity", () => {
  const config = between("function anjuPayLedgerEnabled", "function anjuPayWalletMetadataPatch");
  assert.match(server, /defineBoolean\("ANJU_PAY_LEDGER_REQUIRED"[\s\S]*?default: true/);
  assert.match(config, /activatedAtMillis > 0/);
  assert.match(config, /anjuPayLedgerModeDecision\(\{/);
  assert.match(config, /ledgerRequired: ANJU_PAY_LEDGER_REQUIRED\.value\(\)/);
  assert.doesNotMatch(config, /get\("enabled"\) === true \|\| activatedAtMillis > 0/);

  const transferPreflight = between(
    "async function transferTargetIsPristine",
    "async function cancelAccountTransferCode",
  );
  const transferRedeem = between(
    "async function redeemAccountTransferCode",
    "exports.accountTransfer",
  );
  assert.match(transferPreflight, /get\("ledgerSequence"\)[\s\S]*?> 0/);
  assert.match(transferRedeem, /get\("ledgerSequence"\)[\s\S]*?> 0/);
});
