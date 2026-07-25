"use strict";

const MARKET_CLOSING_MODE_OSHIJO = "oshijo";

function requestedMarketClosingMode(value) {
  if (value === undefined || value === null) {
    return { valid: true, closingMode: "" };
  }
  if (typeof value !== "string") {
    return { valid: false, closingMode: "" };
  }
  return { valid: true, closingMode: value.trim() };
}

function marketClosingDecision({ closingMode, serviceStyles } = {}) {
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
  const equipped = Array.isArray(serviceStyles)
    && serviceStyles.includes(MARKET_CLOSING_MODE_OSHIJO);
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
  marketClosingAllowsExtension,
  marketClosingAuditMode,
  marketClosingDecision,
  marketClosingLeaveReason,
});
