const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS,
  MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
  MARKET_OSHIJO_MAX_CLOSING_TURNS,
  marketOshijoClaimDecision,
  marketOshijoFinalizeDeliveryDecision,
  marketOshijoMediaCounts,
  marketOshijoReleaseDeliveryDecision,
  marketOshijoReserveDeliveryDecision,
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

test("P2P media reservations protect capacity without consuming a closing turn", () => {
  const now = 1_800_000_000_000;
  const deliveryId = "delivery-0000000001";
  const first = marketOshijoReserveDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 1,
    mediaCounts: { text: 1 },
    now,
  });
  assert.equal(MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS, 120_000);
  assert.equal(first.allowed, true);
  assert.equal(first.state, "reserved");
  assert.equal(first.turnCount, 1);
  assert.equal(first.expiresAt, now + MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS);
  assert.equal(first.reservations[deliveryId].mediaKind, "image");

  const replay = marketOshijoReserveDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 1,
    mediaCounts: { text: 1 },
    reservations: first.reservations,
    now: now + 1,
  });
  assert.equal(replay.allowed, true);
  assert.equal(replay.expiresAt, first.expiresAt);
  assert.equal(Object.keys(replay.reservations).length, 1);

  const duplicateImage = marketOshijoReserveDeliveryDecision({
    deliveryId: "delivery-0000000002",
    mediaKind: "image",
    currentTurnCount: 1,
    mediaCounts: { text: 1 },
    reservations: first.reservations,
    now: now + 1,
  });
  assert.equal(duplicateImage.errorCode, "media-limit");

  const finalSlot = marketOshijoReserveDeliveryDecision({
    deliveryId: "delivery-0000000003",
    mediaKind: "audio",
    currentTurnCount: 2,
    mediaCounts: { text: 2 },
    reservations: first.reservations,
    now: now + 1,
  });
  assert.equal(finalSlot.errorCode, "turn-limit");
});

test("only finalization after an active reservation consumes exactly one P2P media turn", () => {
  const now = 1_800_000_000_000;
  const deliveryId = "delivery-0000000010";
  const reservation = marketOshijoReserveDeliveryDecision({
    deliveryId,
    mediaKind: "audio",
    currentTurnCount: 1,
    mediaCounts: { text: 1 },
    now,
  });
  const finalized = marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "audio",
    currentTurnCount: 1,
    mediaCounts: { text: 1 },
    reservations: reservation.reservations,
    now: now + 500,
  });
  assert.equal(finalized.allowed, true);
  assert.equal(finalized.state, "finalized");
  assert.equal(finalized.turnCount, 2);
  assert.deepEqual(finalized.mediaCounts, { text: 1, image: 0, audio: 1 });
  assert.equal(finalized.reservations[deliveryId], undefined);
  assert.equal(finalized.deliveries[deliveryId].turnCount, 2);

  const replayAfterAnotherTurn = marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "audio",
    currentTurnCount: 3,
    mediaCounts: { text: 2, audio: 1 },
    deliveries: finalized.deliveries,
    now: now + 1_000,
  });
  assert.equal(replayAfterAnotherTurn.allowed, true);
  assert.equal(replayAfterAnotherTurn.turnCount, 3);
  assert.deepEqual(replayAfterAnotherTurn.mediaCounts, { text: 2, image: 0, audio: 1 });

  assert.equal(marketOshijoFinalizeDeliveryDecision({
    deliveryId: "delivery-0000000011",
    mediaKind: "image",
    currentTurnCount: 1,
    now: now + 500,
  }).errorCode, "reservation-missing");
});

test("release and expiry never consume a turn, while a finalize winner cannot be rolled back", () => {
  const now = 1_800_000_000_000;
  const deliveryId = "delivery-0000000020";
  const reservation = marketOshijoReserveDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    now,
  });
  const released = marketOshijoReleaseDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    reservations: reservation.reservations,
    now: now + 1,
  });
  assert.equal(released.state, "released");
  assert.equal(released.turnCount, 0);
  assert.deepEqual(released.reservations, {});
  assert.equal(marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    reservations: released.reservations,
    now: now + 2,
  }).errorCode, "reservation-missing");

  const expired = marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    reservations: reservation.reservations,
    now: reservation.expiresAt,
  });
  assert.equal(expired.errorCode, "reservation-missing");

  const finalized = marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    reservations: reservation.reservations,
    now: now + 1,
  });
  const lateRelease = marketOshijoReleaseDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 1,
    reservations: finalized.reservations,
    deliveries: finalized.deliveries,
    now: now + 2,
  });
  assert.equal(lateRelease.state, "finalized");
  assert.equal(lateRelease.turnCount, 1);

  assert.equal(marketOshijoReleaseDeliveryDecision({
    deliveryId: "delivery-0000000021",
    mediaKind: "audio",
    currentTurnCount: 1,
    now: now + 2,
  }).errorCode, "reservation-missing");
});

test("successful delivery decisions expose every field consumed by the transaction wiring", () => {
  const now = 1_800_000_000_000;
  const deliveryId = "delivery-0000000030";
  const reserved = marketOshijoReserveDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    now,
  });
  const finalized = marketOshijoFinalizeDeliveryDecision({
    deliveryId,
    mediaKind: "image",
    currentTurnCount: 0,
    reservations: reserved.reservations,
    now: now + 1,
  });
  const audioReservation = marketOshijoReserveDeliveryDecision({
    deliveryId: "delivery-0000000031",
    mediaKind: "audio",
    currentTurnCount: 1,
    now: now + 1,
  });
  const released = marketOshijoReleaseDeliveryDecision({
    deliveryId: "delivery-0000000031",
    mediaKind: "audio",
    currentTurnCount: 1,
    reservations: audioReservation.reservations,
    now: now + 2,
  });
  for (const [label, decision, keys] of [
    ["reserve", reserved, [
      "deliveryId", "mediaKind", "state", "expiresAt", "turnCount", "reservations",
    ]],
    ["finalize", finalized, [
      "deliveryId", "mediaKind", "state", "deliveredAt", "turnCount",
      "mediaCounts", "reservations", "deliveries",
    ]],
    ["release", released, [
      "deliveryId", "mediaKind", "state", "expiresAt", "turnCount", "reservations",
    ]],
  ]) {
    assert.equal(decision.allowed, true, `${label} must be allowed`);
    for (const key of keys) {
      assert.equal(
        Object.hasOwn(decision, key),
        true,
        `${label} decision is missing ${key}`,
      );
    }
  }
});

test("closing media counts normalize legacy or malformed room fields safely", () => {
  assert.deepEqual(marketOshijoMediaCounts(), { text: 0, image: 0, audio: 0 });
  assert.deepEqual(
    marketOshijoMediaCounts({ text: 2, image: 99, audio: -1, video: 3 }),
    { text: 2, image: 3, audio: 0 },
  );
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

test("backend keeps legacy turns while exposing seller reserve, buyer ACK, and release actions", () => {
  assert.match(
    indexSource,
    /const requestedActionId = cleanText\(data\?\.actionId, 80\);[\s\S]*?canonicalMarketOshijoDeliveryActionId[\s\S]*?requestedActionId !== expectedActionId/,
  );
  assert.match(
    indexSource,
    /return `\$\{id\}-\$\{action\.replace\("oshijo_closing_turn_", ""\)\}`;/,
    "each delivery phase must have one canonical ledger action ID",
  );
  assert.match(
    indexSource,
    /action === "oshijo_closing_turn_reserve"[\s\S]*?marketOshijoReserveDeliveryDecision/,
  );
  assert.match(
    indexSource,
    /action === "oshijo_closing_turn_ack"[\s\S]*?requireRoomActor\(room, uid, "buyer"\)[\s\S]*?marketOshijoFinalizeDeliveryDecision/,
  );
  assert.match(
    indexSource,
    /room\.oshijoClosingTurnCount = finalizeDecision\.turnCount;/,
    "the room counter must use the finalize helper's documented turnCount field",
  );
  assert.doesNotMatch(
    indexSource,
    /finalizeDecision\.closingTurnCount/,
    "the backend must not read a non-contract finalize field",
  );
  assert.match(
    indexSource,
    /action === "oshijo_closing_turn_release"[\s\S]*?marketOshijoReleaseDeliveryDecision/,
  );
  assert.match(
    indexSource,
    /if \(isMarketOshijoDeliveryAction\(action\)\)[\s\S]*?ledger\.oshijoDeliveryId[\s\S]*?ledger\.oshijoMediaKind/,
  );
  assert.match(
    indexSource,
    /action === "oshijo_closing_turn_reserve"[\s\S]*?currentDeliveries[\s\S]*?deliveryState = "finalized"[\s\S]*?currentReservation[\s\S]*?deliveryState = "released"/,
    "reserve ledger replay must report the current finalized, active, or released state",
  );
  assert.match(
    indexSource,
    /if \(!finalizeDecision\.alreadyFinalized\) \{[\s\S]*?room\.oshijoLastTurnAt = finalizeDecision\.deliveredAt;/,
    "a replayed buyer ACK must not rewind the latest media audit timestamp",
  );
  assert.match(
    indexSource,
    /oshijoDeliveryId: isMarketOshijoDeliveryAction\(action\)[\s\S]*?oshijoDeliveryState:[\s\S]*?oshijoReservationExpiresAt:/,
  );
  assert.match(
    indexSource,
    /closingMediaCounts: marketOshijoRoomMediaCounts\(result\.room\)[\s\S]*?oshijoClosingMediaCounts:/,
  );
  assert.match(
    indexSource,
    /action === "oshijo_closing_turn"[\s\S]*?activeReservations[\s\S]*?room\.oshijoClosingMediaCounts/,
  );
  assert.match(
    indexSource,
    /room\.oshijoClosingReservations = \{\};[\s\S]*?room\.status = "decision"/,
  );
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
