"use strict";

const MARKET_CLOSING_MODE_OSHIJO = "oshijo";
const MARKET_OSHIJO_MAX_CLAIM_AMOUNT = 999_999;
const MARKET_OSHIJO_MAX_CLOSING_TURNS = 3;
const MARKET_OSHIJO_MEDIA_KINDS = Object.freeze(["text", "image", "audio"]);
const MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS = 120_000;
const MARKET_OSHIJO_DELIVERY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{15,63}$/;

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

function marketOshijoDeliveryId(value) {
  if (typeof value !== "string") return "";
  const deliveryId = value.trim();
  return MARKET_OSHIJO_DELIVERY_ID_PATTERN.test(deliveryId) ? deliveryId : "";
}

function marketOshijoMediaCounts(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze(Object.fromEntries(MARKET_OSHIJO_MEDIA_KINDS.map((mediaKind) => {
    const count = Number(source[mediaKind]);
    return [
      mediaKind,
      Number.isSafeInteger(count)
        ? Math.min(MARKET_OSHIJO_MAX_CLOSING_TURNS, Math.max(0, count))
        : 0,
    ];
  })));
}

function marketOshijoActiveReservations(value, now = Date.now()) {
  const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const reservations = {};
  for (const [rawDeliveryId, rawReservation] of Object.entries(source)) {
    const deliveryId = marketOshijoDeliveryId(rawDeliveryId);
    const mediaKind = typeof rawReservation?.mediaKind === "string"
      ? rawReservation.mediaKind.trim().toLowerCase()
      : "";
    const reservedAt = Number(rawReservation?.reservedAt || 0);
    const expiresAt = Number(rawReservation?.expiresAt || 0);
    if (!deliveryId
        || !MARKET_OSHIJO_MEDIA_KINDS.includes(mediaKind)
        || !Number.isFinite(reservedAt)
        || !Number.isFinite(expiresAt)
        || expiresAt <= currentTime) continue;
    reservations[deliveryId] = Object.freeze({
      mediaKind,
      reservedAt: Math.max(0, Math.floor(reservedAt)),
      expiresAt: Math.max(0, Math.floor(expiresAt)),
    });
    if (Object.keys(reservations).length >= MARKET_OSHIJO_MAX_CLOSING_TURNS) break;
  }
  return Object.freeze(reservations);
}

function marketOshijoDeliveries(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const deliveries = {};
  for (const [rawDeliveryId, rawDelivery] of Object.entries(source)) {
    const deliveryId = marketOshijoDeliveryId(rawDeliveryId);
    const mediaKind = typeof rawDelivery?.mediaKind === "string"
      ? rawDelivery.mediaKind.trim().toLowerCase()
      : "";
    const turnCount = Number(rawDelivery?.turnCount);
    const deliveredAt = Number(rawDelivery?.deliveredAt || 0);
    if (!deliveryId
        || !MARKET_OSHIJO_MEDIA_KINDS.includes(mediaKind)
        || !Number.isSafeInteger(turnCount)
        || turnCount < 1
        || turnCount > MARKET_OSHIJO_MAX_CLOSING_TURNS
        || !Number.isFinite(deliveredAt)) continue;
    deliveries[deliveryId] = Object.freeze({
      mediaKind,
      turnCount,
      deliveredAt: Math.max(0, Math.floor(deliveredAt)),
    });
    if (Object.keys(deliveries).length >= MARKET_OSHIJO_MAX_CLOSING_TURNS) break;
  }
  return Object.freeze(deliveries);
}

function marketOshijoReserveDeliveryDecision({
  deliveryId,
  mediaKind,
  currentTurnCount,
  mediaCounts,
  reservations,
  deliveries,
  now = Date.now(),
  ttlMs = MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS,
} = {}) {
  const id = marketOshijoDeliveryId(deliveryId);
  const kind = typeof mediaKind === "string" ? mediaKind.trim().toLowerCase() : "";
  const current = Number.isSafeInteger(currentTurnCount)
    ? Math.min(MARKET_OSHIJO_MAX_CLOSING_TURNS, Math.max(0, currentTurnCount))
    : 0;
  const currentTime = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now();
  const duration = Number.isSafeInteger(ttlMs) && ttlMs >= 10_000 && ttlMs <= 5 * 60_000
    ? ttlMs
    : MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS;
  const counts = marketOshijoMediaCounts(mediaCounts);
  const active = marketOshijoActiveReservations(reservations, currentTime);
  const completed = marketOshijoDeliveries(deliveries);
  const existingDelivery = completed[id];
  if (!id || !MARKET_OSHIJO_MEDIA_KINDS.includes(kind)) {
    return Object.freeze({ allowed: false, errorCode: "invalid-argument" });
  }
  if (existingDelivery) {
    return Object.freeze(existingDelivery.mediaKind === kind
      ? {
        allowed: true,
        state: "finalized",
        alreadyFinalized: true,
        deliveryId: id,
        mediaKind: kind,
        turnCount: existingDelivery.turnCount,
        expiresAt: 0,
        reservations: active,
      }
      : { allowed: false, errorCode: "delivery-mismatch" });
  }
  const existingReservation = active[id];
  if (existingReservation) {
    return Object.freeze(existingReservation.mediaKind === kind
      ? {
        allowed: true,
        state: "reserved",
        deliveryId: id,
        mediaKind: kind,
        turnCount: current,
        expiresAt: existingReservation.expiresAt,
        reservations: active,
      }
      : { allowed: false, errorCode: "delivery-mismatch" });
  }
  const activeValues = Object.values(active);
  if (current + activeValues.length >= MARKET_OSHIJO_MAX_CLOSING_TURNS) {
    return Object.freeze({ allowed: false, errorCode: "turn-limit" });
  }
  if (["image", "audio"].includes(kind)
      && counts[kind] + activeValues.filter((entry) => entry.mediaKind === kind).length >= 1) {
    return Object.freeze({ allowed: false, errorCode: "media-limit" });
  }
  const expiresAt = currentTime + duration;
  return Object.freeze({
    allowed: true,
    state: "reserved",
    deliveryId: id,
    mediaKind: kind,
    turnCount: current,
    expiresAt,
    reservations: Object.freeze({
      ...active,
      [id]: Object.freeze({ mediaKind: kind, reservedAt: currentTime, expiresAt }),
    }),
  });
}

function marketOshijoFinalizeDeliveryDecision({
  deliveryId,
  mediaKind,
  currentTurnCount,
  mediaCounts,
  reservations,
  deliveries,
  now = Date.now(),
} = {}) {
  const id = marketOshijoDeliveryId(deliveryId);
  const kind = typeof mediaKind === "string" ? mediaKind.trim().toLowerCase() : "";
  const current = Number.isSafeInteger(currentTurnCount)
    ? Math.min(MARKET_OSHIJO_MAX_CLOSING_TURNS, Math.max(0, currentTurnCount))
    : 0;
  const currentTime = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now();
  const counts = marketOshijoMediaCounts(mediaCounts);
  const active = marketOshijoActiveReservations(reservations, currentTime);
  const completed = marketOshijoDeliveries(deliveries);
  const existingDelivery = completed[id];
  if (!id || !MARKET_OSHIJO_MEDIA_KINDS.includes(kind)) {
    return Object.freeze({ allowed: false, errorCode: "invalid-argument" });
  }
  if (existingDelivery) {
    return Object.freeze(existingDelivery.mediaKind === kind
      ? {
        allowed: true,
        state: "finalized",
        alreadyFinalized: true,
        deliveryId: id,
        mediaKind: kind,
        turnCount: current,
        deliveredAt: existingDelivery.deliveredAt,
        mediaCounts: counts,
        reservations: active,
        deliveries: completed,
      }
      : { allowed: false, errorCode: "delivery-mismatch" });
  }
  const reservation = active[id];
  if (!reservation) return Object.freeze({ allowed: false, errorCode: "reservation-missing" });
  if (reservation.mediaKind !== kind) {
    return Object.freeze({ allowed: false, errorCode: "delivery-mismatch" });
  }
  if (current >= MARKET_OSHIJO_MAX_CLOSING_TURNS) {
    return Object.freeze({ allowed: false, errorCode: "turn-limit" });
  }
  if (["image", "audio"].includes(kind) && counts[kind] >= 1) {
    return Object.freeze({ allowed: false, errorCode: "media-limit" });
  }
  const turnCount = current + 1;
  const nextReservations = { ...active };
  delete nextReservations[id];
  return Object.freeze({
    allowed: true,
    state: "finalized",
    alreadyFinalized: false,
    deliveryId: id,
    mediaKind: kind,
    turnCount,
    deliveredAt: currentTime,
    mediaCounts: Object.freeze({ ...counts, [kind]: counts[kind] + 1 }),
    reservations: Object.freeze(nextReservations),
    deliveries: Object.freeze({
      ...completed,
      [id]: Object.freeze({ mediaKind: kind, turnCount, deliveredAt: currentTime }),
    }),
  });
}

function marketOshijoReleaseDeliveryDecision({
  deliveryId,
  mediaKind,
  currentTurnCount,
  reservations,
  deliveries,
  now = Date.now(),
} = {}) {
  const id = marketOshijoDeliveryId(deliveryId);
  const kind = typeof mediaKind === "string" ? mediaKind.trim().toLowerCase() : "";
  const currentTime = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now();
  const current = Number.isSafeInteger(currentTurnCount)
    ? Math.min(MARKET_OSHIJO_MAX_CLOSING_TURNS, Math.max(0, currentTurnCount))
    : 0;
  const active = marketOshijoActiveReservations(reservations, currentTime);
  const completed = marketOshijoDeliveries(deliveries);
  const existingDelivery = completed[id];
  if (!id || !MARKET_OSHIJO_MEDIA_KINDS.includes(kind)) {
    return Object.freeze({ allowed: false, errorCode: "invalid-argument" });
  }
  if (existingDelivery) {
    return Object.freeze(existingDelivery.mediaKind === kind
      ? {
        allowed: true,
        state: "finalized",
        deliveryId: id,
        mediaKind: kind,
        turnCount: current,
        expiresAt: 0,
        reservations: active,
      }
      : { allowed: false, errorCode: "delivery-mismatch" });
  }
  const reservation = active[id];
  if (!reservation) {
    return Object.freeze({ allowed: false, errorCode: "reservation-missing" });
  }
  if (reservation && reservation.mediaKind !== kind) {
    return Object.freeze({ allowed: false, errorCode: "delivery-mismatch" });
  }
  const nextReservations = { ...active };
  delete nextReservations[id];
  return Object.freeze({
    allowed: true,
    state: "released",
    deliveryId: id,
    mediaKind: kind,
    turnCount: current,
    expiresAt: 0,
    reservations: Object.freeze(nextReservations),
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
  MARKET_OSHIJO_DELIVERY_RESERVATION_TTL_MS,
  MARKET_OSHIJO_MAX_CLAIM_AMOUNT,
  MARKET_OSHIJO_MAX_CLOSING_TURNS,
  MARKET_OSHIJO_MEDIA_KINDS,
  marketClosingAllowsExtension,
  marketClosingAuditMode,
  marketClosingDecision,
  marketClosingLeaveReason,
  marketOshijoActiveReservations,
  marketOshijoClaimDecision,
  marketOshijoDeliveries,
  marketOshijoDeliveryId,
  marketOshijoFinalizeDeliveryDecision,
  marketOshijoMediaCounts,
  marketOshijoReleaseDeliveryDecision,
  marketOshijoReserveDeliveryDecision,
  marketOshijoSettlementDecision,
  marketOshijoTurnDecision,
});
