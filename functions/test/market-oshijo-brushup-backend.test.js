const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
  MARKET_OSHIJO_MAX_CLOSING_TURNS,
  marketOshijoClaimDecision,
  marketOshijoSettlementDecision,
  marketOshijoTurnDecision,
} = require("../market-closing");
const {
  MARKET_RANKING_CONTRIBUTION_CAP,
  applyMarketRankingHonor,
  applyMonthlyMarketSale,
  marketRankingContribution,
  normalizeMonthlyMarketStats,
} = require("../market-ranking");
const {
  OSHIJO_PATRON_MINIMUM_SALES,
  OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS,
  normalizePatronage,
  oshijoPatronEligibility,
} = require("../patronage");
const {
  ANJU_PAY_MAX_BALANCE,
  ANJU_PAY_LEDGER_SCHEMA_VERSION,
  activateAnjuPayWallet,
  anjuPayEntryId,
  nextAnjuPayEntry,
} = require("../anju-pay-ledger");

const functionsRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(functionsRoot, "..");
const indexSource = fs.readFileSync(path.join(functionsRoot, "index.js"), "utf8");
const marketSource = fs.readFileSync(path.join(projectRoot, "market.js"), "utf8");
const accountSource = fs.readFileSync(path.join(projectRoot, "account.js"), "utf8");
const onlineSource = fs.readFileSync(path.join(projectRoot, "online.js"), "utf8");
const teamSource = fs.readFileSync(path.join(projectRoot, "team.js"), "utf8");
const databaseRules = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "database.rules.json"), "utf8"),
);

test("Oshijo claims are strict positive integers under the wallet-sized technical cap", () => {
  assert.equal(MARKET_OSHIJO_MAX_CLAIM_AMOUNT, 999_999);
  assert.deepEqual(marketOshijoClaimDecision(1), {
    allowed: true,
    claimAmount: 1,
    errorCode: "",
  });
  assert.equal(marketOshijoClaimDecision(999_999).allowed, true);
  for (const invalid of [0, -1, 1.5, 1_000_000, "1000", null, undefined]) {
    assert.equal(marketOshijoClaimDecision(invalid).allowed, false);
  }
});

test("wallet and ledger support 999,999,999 while one Oshijo claim stays at 999,999", () => {
  assert.equal(ANJU_PAY_MAX_BALANCE, 999_999_999);
  assert.equal(MARKET_OSHIJO_MAX_CLAIM_AMOUNT, 999_999);
  const activated = activateAnjuPayWallet({
    balance: ANJU_PAY_MAX_BALANCE,
  }, 1);
  assert.equal(activated.openingEntry.openingBalance, ANJU_PAY_MAX_BALANCE);

  const groupId = anjuPayEntryId("wallet-cap-boundary");
  const next = nextAnjuPayEntry({
    ledgerVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    ledgerSequence: 0,
    historyStartedAt: 1,
  }, {
    entryId: groupId,
    groupId,
    kind: "market_transaction",
    category: "market",
    delta: 999_999,
    nominalAmount: 999_999,
    balanceBefore: 999_000_000,
    balanceAfter: ANJU_PAY_MAX_BALANCE,
    components: [{
      kind: "sale",
      labelKey: "anju_pay_market_sale",
      delta: 999_999,
      nominalAmount: 999_999,
      status: "settled",
    }],
    occurredAt: 2,
  });
  assert.equal(next.entry.balanceAfter, ANJU_PAY_MAX_BALANCE);
  assert.equal(next.entry.delta, 999_999);
  assert.match(indexSource, /const MAX_POINTS = ANJU_PAY_MAX_BALANCE;/);
});

test("all clients and the Realtime Database mirror retain the expanded wallet balance", () => {
  assert.match(accountSource, /const ANJU_PAY_MAX_BALANCE = 999_999_999;/);
  assert.match(marketSource, /const ANJU_PAY_MAX_BALANCE = 999_999_999;/);
  assert.match(onlineSource, /const MAX_POINTS = 999_999_999;/);
  assert.match(teamSource, /Math\.min\(999_999_999,/);
  assert.equal(
    databaseRules.rules.online.economy.$uid.points[".validate"].includes("<= 999999999"),
    true,
  );
});

test("Oshijo settlement transfers min(claim,balance), requires explicit all-in, and detects drift", () => {
  assert.deepEqual(marketOshijoSettlementDecision({
    claimAmount: 3_000,
    availableBalance: 742,
    confirmedBalance: 742,
    confirmedPaidAmount: 742,
    allIn: true,
  }), {
    allowed: true,
    reason: "",
    claimAmount: 3_000,
    paidAmount: 742,
    allIn: true,
  });
  assert.equal(marketOshijoSettlementDecision({
    claimAmount: 3_000,
    availableBalance: 742,
    confirmedBalance: 800,
    confirmedPaidAmount: 742,
    allIn: true,
  }).reason, "balance-changed");
  assert.equal(marketOshijoSettlementDecision({
    claimAmount: 3_000,
    availableBalance: 742,
    confirmedBalance: 742,
    confirmedPaidAmount: 742,
    allIn: false,
  }).reason, "confirmation-mismatch");
  assert.deepEqual(marketOshijoSettlementDecision({
    claimAmount: 500,
    availableBalance: 742,
    confirmedBalance: 742,
    confirmedPaidAmount: 500,
    allIn: false,
  }), {
    allowed: true,
    reason: "",
    claimAmount: 500,
    paidAmount: 500,
    allIn: false,
  });
  assert.deepEqual(marketOshijoSettlementDecision({
    claimAmount: 999_999,
    availableBalance: 1_500_000,
    confirmedBalance: 1_500_000,
    confirmedPaidAmount: 999_999,
    allIn: false,
  }), {
    allowed: true,
    reason: "",
    claimAmount: 999_999,
    paidAmount: 999_999,
    allIn: false,
  });
});

test("closing turns audit media kind and sequence without storing content", () => {
  assert.equal(MARKET_OSHIJO_MAX_CLOSING_TURNS, 3);
  assert.deepEqual(marketOshijoTurnDecision({
    mediaKind: "audio",
    currentTurnCount: 1,
    requestedTurn: 2,
  }), {
    allowed: true,
    mediaKind: "audio",
    turnCount: 2,
    errorCode: "",
  });
  assert.equal(marketOshijoTurnDecision({
    mediaKind: "video",
    currentTurnCount: 0,
    requestedTurn: 1,
  }).errorCode, "invalid-argument");
  assert.equal(marketOshijoTurnDecision({
    mediaKind: "text",
    currentTurnCount: 3,
    requestedTurn: 4,
  }).errorCode, "turn-limit");
});

test("actual monthly economy stays intact while each qualifying ranking deal caps at 500", () => {
  assert.equal(MARKET_RANKING_CONTRIBUTION_CAP, 500);
  assert.equal(marketRankingContribution(3_000), 500);
  const stats = applyMonthlyMarketSale(null, {
    uid: "seller",
    seasonKey: "2026-08",
    name: "SELLER",
    role: "seller",
    paidAmount: 3_000,
    sellerProceeds: 2_850,
    oshijoProceeds: 2_850,
    effectiveFee: 150,
    rankingCounted: true,
    newCounterparty: true,
    newOshijoCounterparty: true,
    oshijo: true,
    now: 1,
  });
  assert.equal(stats.actualGrossSales, 3_000);
  assert.equal(stats.netSales, 2_850);
  assert.equal(stats.grossSales, 500);
  assert.equal(stats.bestSale, 500);
  assert.equal(stats.oshijoNetProceeds, 2_850);
  assert.equal(stats.oshijoSalesCount, 1);
  assert.equal(stats.oshijoUniqueBuyers, 1);

  const repeat = applyMonthlyMarketSale(stats, {
    uid: "seller",
    seasonKey: "2026-08",
    name: "SELLER",
    role: "seller",
    paidAmount: 2_000,
    sellerProceeds: 1_900,
    oshijoProceeds: 1_900,
    effectiveFee: 100,
    rankingCounted: false,
    newCounterparty: false,
    newOshijoCounterparty: false,
    oshijo: true,
    now: 2,
  });
  assert.equal(repeat.actualGrossSales, 5_000);
  assert.equal(repeat.netSales, 4_750);
  assert.equal(repeat.grossSales, 500);
  assert.equal(repeat.salesCount, 1);
  assert.equal(repeat.oshijoNetProceeds, 4_750);
  assert.equal(repeat.oshijoSalesCount, 1);
});

test("popular Oshijo eligibility is server-derived and contribution is bounded by earned proceeds", () => {
  assert.equal(OSHIJO_PATRON_MINIMUM_SALES, 5);
  assert.equal(OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS, 3);
  const market = normalizeMonthlyMarketStats({
    uid: "seller",
    seasonKey: "2026-08",
    oshijoSalesCount: 5,
    oshijoUniqueBuyers: 3,
    oshijoNetProceeds: 2_000,
  }, "seller", "2026-08");
  const patron = normalizePatronage({
    seasonKey: "2026-08",
    seasonSpent: 300,
    lifetimeSpent: 300,
    oshijoSeasonSpent: 300,
    oshijoLifetimeSpent: 300,
  }, "2026-08");
  const eligibility = oshijoPatronEligibility(market, patron, "2026-08");
  assert.equal(eligibility.popular, true);
  assert.equal(eligibility.availableProceeds, 1_700);
  assert.equal(eligibility.nextTier.level, 2);
  assert.equal(eligibility.nextTier.cost, 1_200);
  assert.equal(eligibility.canUpgrade, true);
});

test("ranking honors accumulate permanently without Pay rewards", () => {
  const first = applyMarketRankingHonor(null, {
    uid: "seller",
    role: "seller",
    seasonKey: "2026-08",
    rank: 1,
    now: 1,
  });
  assert.equal(first.honors.seller.level, 1);
  assert.equal(first.honors.seller.championMonths, 1);
  const second = applyMarketRankingHonor(first.honors, {
    uid: "seller",
    role: "seller",
    seasonKey: "2026-09",
    rank: 3,
    now: 2,
  });
  const third = applyMarketRankingHonor(second.honors, {
    uid: "seller",
    role: "seller",
    seasonKey: "2026-10",
    rank: 10,
    now: 3,
  });
  assert.equal(third.honors.seller.months, 3);
  assert.equal(third.honors.seller.level, 2);
  assert.equal(third.honors.seller.top3Months, 2);
});

test("backend wires warning, opt-in closing, silent decision, privacy, and idempotent audit", () => {
  assert.match(indexSource, /room\.status = closingDecision\.closingMode === "oshijo"\s*\?\s*"oshijo_warning"/);
  assert.match(indexSource, /action === "hear_oshijo_closing"[\s\S]*?requireMarketState\(room, "oshijo_warning"\)[\s\S]*?room\.status = "oshijo_closing"/);
  assert.match(indexSource, /action === "oshijo_closing_turn"[\s\S]*?requireRoomActor\(room, uid, "seller"\)[\s\S]*?marketOshijoTurnDecision/);
  assert.match(indexSource, /action === "enter_silent_decision"[\s\S]*?room\.status = "decision"[\s\S]*?buyerDecisionResult/);
  assert.doesNotMatch(indexSource, /room\.buyerMaxBudget|room\.decisionBalance|room\.decisionPaidAmount/);
  assert.match(indexSource, /if \(action === "buy" && marketClosingAuditMode\(ledger\.closingMode\) === "oshijo"\)/);
  assert.match(indexSource, /reconfirmAction: "enter_silent_decision"/);
});

test("backend exposes monthly/lifetime rankings, honor finalization, and Oshijo Patron action", () => {
  assert.match(indexSource, /request\.data\?\.period[\s\S]*?\["monthly", "lifetime"\]/);
  assert.match(indexSource, /valueMarketMonthlyPeriods/);
  assert.match(indexSource, /finalizeClosedMarketRankingMonths/);
  assert.match(indexSource, /if \(awardSnapshot\.exists\) return;[\s\S]*?transaction\.create\(awardRef/);
  assert.match(indexSource, /rankingContributionCap: MARKET_RANKING_CONTRIBUTION_CAP/);
  assert.match(indexSource, /action === "oshijo_patron_upgrade"/);
  assert.match(indexSource, /seasonKey >= MARKET_MONTHLY_RANKING_START_KEY[\s\S]*?oshijo_patron_required/);
  assert.match(marketSource, /for \(const period of MARKET_RANKING_PERIODS\)[\s\S]*?state\.rankings\[period\]\[role\]/);
  assert.doesNotMatch(marketSource, /state\.rankings\[role\]/);
  assert.match(indexSource, /rewardLabel = "受取可能なデイリープレイ報酬"/);
  assert.match(indexSource, /rewardLabel = "次のデイリープレイ報酬"/);
});
