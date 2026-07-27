"use strict";

const MARKET_CLOSING_MODE_OSHIJO = "oshijo";
const MARKET_OSHIJO_MAX_CLAIM_AMOUNT = 999_999;
const MARKET_OSHIJO_MAX_CLOSING_TURNS = 3;
const MARKET_OSHIJO_MEDIA_KINDS = Object.freeze(["text", "image", "audio"]);

function requestedMarketClosingMode(value) {
  if (value === undefined || value === null) {
    return { valid: true, closingMode: "" };
  }
  if (typeof value !== "string") {
    return { valid: false, closingMode: "" };
  }
  return { valid: true, closingMode: value.trim() };
}

function marketClosingDecision({ closingMode, salesMode, serviceStyles } = {}) {
  const requested = requestedMarketClosingMode(closingMode);
  if (!requested.valid) {
    return Object.freeze({
      allowed: false,
      closingMode: "",
      errorCode: "invalid-argument",
    });
  }
  if (!requested.closingMode) {
    return Object.freeze({
      allowed: true,
      closingMode: "",
      errorCode: "",
    });
  }
  if (requested.closingMode !== MARKET_CLOSING_MODE_OSHIJO) {
    return Object.freeze({
      allowed: false,
      closingMode: "",
      errorCode: "invalid-argument",
    });
  }
  const configuredSalesMode = typeof salesMode === "string" ? salesMode.trim() : "";
  const equipped = configuredSalesMode
    ? configuredSalesMode === MARKET_CLOSING_MODE_OSHIJO
    : Array.isArray(serviceStyles) && serviceStyles.includes(MARKET_CLOSING_MODE_OSHIJO);
  if (!equipped) {
    return Object.freeze({
      allowed: false,
      closingMode: "",
      errorCode: "failed-precondition",
    });
  }
  return Object.freeze({
    allowed: true,
    closingMode: MARKET_CLOSING_MODE_OSHIJO,
    errorCode: "",
  });
}

function marketOshijoClaimDecision(value, maximum = MARKET_OSHIJO_MAX_CLAIM_AMOUNT) {
  const maxClaim = Number.isSafeInteger(maximum) && maximum > 0
    ? maximum
    : MARKET_OSHIJO_MAX_CLAIM_AMOUNT;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return Object.freeze({
      allowed: false,
      claimAmount: 0,
      errorCode: "invalid-argument",
    });
  }
  if (value < 1 || value > maxClaim) {
    return Object.freeze({
      allowed: false,
      claimAmount: 0,
      errorCode: "out-of-range",
    });
  }
  return Object.freeze({
    allowed: true,
    claimAmount: value,
    errorCode: "",
  });
}

function marketOshijoTurnDecision({
  mediaKind,
  currentTurnCount,
  requestedTurn,
} = {}) {
  const kind = typeof mediaKind === "string" ? mediaKind.trim().toLowerCase() : "";
  const current = Number.isSafeInteger(currentTurnCount)
    ? Math.max(0, currentTurnCount)
    : 0;
  if (!MARKET_OSHIJO_MEDIA_KINDS.includes(kind)) {
    return Object.freeze({
      allowed: false,
      mediaKind: "",
      turnCount: current,
      errorCode: "invalid-argument",
    });
  }
  if (current >= MARKET_OSHIJO_MAX_CLOSING_TURNS) {
    return Object.freeze({
      allowed: false,
      mediaKind: kind,
      turnCount: current,
      errorCode: "turn-limit",
    });
  }
  const next = current + 1;
  if (requestedTurn !== undefined
      && (typeof requestedTurn !== "number"
        || !Number.isSafeInteger(requestedTurn)
        || requestedTurn !== next)) {
    return Object.freeze({
      allowed: false,
      mediaKind: kind,
      turnCount: current,
      errorCode: "turn-mismatch",
    });
  }
  return Object.freeze({
    allowed: true,
    mediaKind: kind,
    turnCount: next,
    errorCode: "",
  });
}

function marketOshijoSettlementDecision({
  claimAmount,
  availableBalance,
  confirmedBalance,
  confirmedPaidAmount,
  allIn,
} = {}) {
  const claim = marketOshijoClaimDecision(claimAmount);
  if (!claim.allowed) {
    return Object.freeze({
      allowed: false,
      reason: "invalid-claim",
      claimAmount: 0,
      paidAmount: 0,
      allIn: false,
    });
  }
  if (typeof availableBalance !== "number"
      || !Number.isSafeInteger(availableBalance)
      || availableBalance < 0) {
    return Object.freeze({
      allowed: false,
      reason: "invalid-balance",
      claimAmount: claim.claimAmount,
      paidAmount: 0,
      allIn: false,
    });
  }
  const paidAmount = Math.min(claim.claimAmount, availableBalance);
  const expectedAllIn = claim.claimAmount > availableBalance && availableBalance > 0;
  if (paidAmount < 1) {
    return Object.freeze({
      allowed: false,
      reason: "empty-balance",
      claimAmount: claim.claimAmount,
      paidAmount,
      allIn: expectedAllIn,
    });
  }
  if (confirmedBalance !== availableBalance) {
    return Object.freeze({
      allowed: false,
      reason: "balance-changed",
      claimAmount: claim.claimAmount,
      paidAmount,
      allIn: expectedAllIn,
    });
  }
  if (confirmedPaidAmount !== paidAmount || allIn !== expectedAllIn) {
    return Object.freeze({
      allowed: false,
      reason: "confirmation-mismatch",
      claimAmount: claim.claimAmount,
      paidAmount,
      allIn: expectedAllIn,
    });
  }
  return Object.freeze({
    allowed: true,
    reason: "",
    claimAmount: claim.claimAmount,
    paidAmount,
    allIn: expectedAllIn,
  });
}

function marketClosingAuditMode(value) {
  return value === MARKET_CLOSING_MODE_OSHIJO
    ? MARKET_CLOSING_MODE_OSHIJO
    : "";
}

function marketClosingAllowsExtension(value) {
  return marketClosingAuditMode(value) !== MARKET_CLOSING_MODE_OSHIJO;
}

function marketClosingLeaveReason(value) {
  return marketClosingAuditMode(value) === MARKET_CLOSING_MODE_OSHIJO
    ? "oshijo_declined"
    : "buyer_left";
}

module.exports = Object.freeze({
  MARKET_CLOSING_MODE_OSHIJO,
  MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
  MARKET_OSHIJO_MAX_CLOSING_TURNS,
  MARKET_OSHIJO_MEDIA_KINDS,
  marketClosingAllowsExtension,
  marketClosingAuditMode,
  marketClosingDecision,
  marketClosingLeaveReason,
  marketOshijoClaimDecision,
  marketOshijoSettlementDecision,
  marketOshijoTurnDecision,
});
