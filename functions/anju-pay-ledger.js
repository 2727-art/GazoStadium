"use strict";

const crypto = require("node:crypto");

const ANJU_PAY_LEDGER_SCHEMA_VERSION = 1;
const ANJU_PAY_OPENING_ENTRY_ID = "opening-v1";
const ANJU_PAY_HISTORY_DEFAULT_LIMIT = 20;
const ANJU_PAY_HISTORY_MAX_LIMIT = 50;
const MAX_BALANCE = 999_999;
const MAX_COMPONENTS = 100;

function boundedInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function cleanText(value, maximumLength, fallback = "") {
  return String(value ?? fallback).trim().replace(/\s+/g, " ").slice(0, maximumLength);
}

function anjuPayEntryId(seed) {
  return crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 40);
}

function isAnjuPayWalletActive(value) {
  return Number(value?.ledgerVersion) === ANJU_PAY_LEDGER_SCHEMA_VERSION
    && Number.isSafeInteger(Number(value?.ledgerSequence))
    && Number(value.ledgerSequence) >= 0
    && Number.isFinite(Number(value?.historyStartedAt))
    && Number(value.historyStartedAt) > 0;
}

function anjuPayLedgerModeDecision({
  configExists,
  enabledFlag,
  markerActive,
  ledgerRequired,
  walletActive,
} = {}) {
  if (!configExists) return { allowed: false, enabled: false, reason: "missing-config" };
  if (enabledFlag && !markerActive) {
    return { allowed: false, enabled: false, reason: "incomplete-marker" };
  }
  if (ledgerRequired && !markerActive) {
    return { allowed: false, enabled: false, reason: "ledger-required" };
  }
  if (!markerActive && walletActive) {
    return { allowed: false, enabled: false, reason: "wallet-mismatch" };
  }
  return { allowed: true, enabled: markerActive === true, reason: "" };
}

function normalizeStatus(value, fallback = "posted") {
  const status = cleanText(value, 24, fallback);
  return new Set(["posted", "held", "settled", "refunded", "partial", "capped"]).has(status)
    ? status
    : fallback;
}

function sanitizeComponent(value) {
  const source = value && typeof value === "object" ? value : {};
  const delta = boundedInteger(source.delta, -MAX_BALANCE, MAX_BALANCE, 0);
  return {
    kind: cleanText(source.kind, 48, "adjustment") || "adjustment",
    labelKey: cleanText(source.labelKey, 64, "anju_pay_adjustment") || "anju_pay_adjustment",
    delta,
    nominalAmount: boundedInteger(
      source.nominalAmount,
      0,
      MAX_BALANCE,
      Math.abs(delta),
    ),
    status: normalizeStatus(source.status),
  };
}

function sanitizeDetails(value) {
  const source = value && typeof value === "object" ? value : {};
  const details = {};
  const textFields = {
    productId: 80,
    missionId: 40,
    dateKey: 10,
    period: 16,
    periodKey: 10,
    mode: 16,
    role: 16,
    counterpartyName: 16,
    publicSellerId: 32,
    listingTitle: 30,
  };
  for (const [field, maximumLength] of Object.entries(textFields)) {
    const text = cleanText(source[field], maximumLength);
    if (text) details[field] = text;
  }
  if (Number.isSafeInteger(Number(source.targetTier))) {
    details.targetTier = boundedInteger(source.targetTier, 0, 100, 0);
  }
  if (Array.isArray(source.tierIds)) {
    const tierIds = [...new Set(source.tierIds
      .map((value) => cleanText(value, 40))
      .filter(Boolean))]
      .slice(0, MAX_COMPONENTS);
    if (tierIds.length) details.tierIds = tierIds;
  }
  if (Array.isArray(source.dailyPlayClaims)) {
    const dailyPlayClaims = source.dailyPlayClaims
      .map((entry) => {
        const dateKey = cleanText(entry?.dateKey, 10);
        const tierId = cleanText(entry?.tierId, 40);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !tierId) return null;
        return {
          dateKey,
          tierId,
          credited: boundedInteger(entry?.credited, 0, MAX_BALANCE, 0),
          nominalAmount: boundedInteger(entry?.nominalAmount, 0, MAX_BALANCE, 0),
          status: normalizeStatus(entry?.status),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_COMPONENTS);
    if (dailyPlayClaims.length) details.dailyPlayClaims = dailyPlayClaims;
  }
  if (Array.isArray(source.periods)) {
    const periods = source.periods
      .map((entry) => {
        const period = cleanText(typeof entry === "string" ? entry : entry?.period, 16);
        if (!["daily", "weekly", "monthly"].includes(period)) return null;
        const rawKey = cleanText(typeof entry === "string" ? "" : entry?.key, 10);
        const keyPattern = period === "monthly"
          ? /^\d{4}-\d{2}$/
          : /^\d{4}-\d{2}-\d{2}$/;
        const key = keyPattern.test(rawKey) ? rawKey : "";
        return {
          period,
          ...(key ? { key } : {}),
          nominalAmount: boundedInteger(
            typeof entry === "string" ? 0 : entry?.nominalAmount,
            0,
            MAX_BALANCE,
            0,
          ),
        };
      })
      .filter(Boolean)
      .slice(0, 50);
    if (periods.length) details.periods = periods;
  }
  return details;
}

function createOpeningEntry(balance, occurredAt) {
  const openingBalance = boundedInteger(balance, 0, MAX_BALANCE, 0);
  const timestamp = boundedInteger(occurredAt, 1, Number.MAX_SAFE_INTEGER, Date.now());
  return {
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
    balanceBefore: openingBalance,
    balanceAfter: openingBalance,
    openingBalance,
    components: [],
    details: {},
    occurredAt: timestamp,
  };
}

function activateAnjuPayWallet(value, occurredAt) {
  const wallet = value && typeof value === "object" ? value : {};
  if (isAnjuPayWalletActive(wallet)) {
    return { activated: false, walletPatch: {}, openingEntry: null };
  }
  const timestamp = boundedInteger(occurredAt, 1, Number.MAX_SAFE_INTEGER, Date.now());
  const balance = boundedInteger(wallet.balance, 0, MAX_BALANCE, 0);
  return {
    activated: true,
    walletPatch: {
      ledgerVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
      historyStartedAt: timestamp,
      ledgerSequence: 0,
    },
    openingEntry: createOpeningEntry(balance, timestamp),
  };
}

function nextAnjuPayEntry(wallet, value) {
  if (!isAnjuPayWalletActive(wallet)) {
    throw new Error("AnjuPay wallet must be active before appending an entry.");
  }
  const source = value && typeof value === "object" ? value : {};
  const sequence = boundedInteger(wallet.ledgerSequence, 0, Number.MAX_SAFE_INTEGER - 1, 0) + 1;
  const balanceBefore = boundedInteger(source.balanceBefore, 0, MAX_BALANCE, 0);
  const balanceAfter = boundedInteger(source.balanceAfter, 0, MAX_BALANCE, balanceBefore);
  const delta = boundedInteger(source.delta, -MAX_BALANCE, MAX_BALANCE, balanceAfter - balanceBefore);
  if (delta !== balanceAfter - balanceBefore) {
    throw new Error("AnjuPay entry delta must match its before/after balances.");
  }
  const kind = cleanText(source.kind, 48, "adjustment") || "adjustment";
  const category = cleanText(source.category, 24, "adjustment") || "adjustment";
  const groupId = cleanText(source.groupId, 64);
  if (!/^[a-f0-9]{40}$/.test(groupId)) {
    throw new Error("AnjuPay entry groupId must be a deterministic hash.");
  }
  const entryId = cleanText(source.entryId, 64, groupId);
  if (!/^[a-f0-9]{40}$/.test(entryId)) {
    throw new Error("AnjuPay entryId must be a deterministic hash.");
  }
  const occurredAt = boundedInteger(source.occurredAt, 1, Number.MAX_SAFE_INTEGER, Date.now());
  const components = Array.isArray(source.components)
    ? source.components.slice(0, MAX_COMPONENTS).map(sanitizeComponent)
    : [];
  if (
    components.length
    && components.reduce((sum, component) => sum + component.delta, 0) !== delta
  ) {
    throw new Error("AnjuPay entry components must sum to its delta.");
  }
  return {
    entryId,
    walletPatch: { ledgerSequence: sequence },
    entry: {
      schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
      sequence,
      groupId,
      type: kind,
      kind,
      category,
      labelKey: cleanText(source.labelKey, 64, `anju_pay_${kind}`) || `anju_pay_${kind}`,
      status: normalizeStatus(source.status),
      delta,
      nominalAmount: boundedInteger(
        source.nominalAmount,
        0,
        MAX_BALANCE,
        Math.abs(delta),
      ),
      balanceBefore,
      balanceAfter,
      components,
      details: sanitizeDetails(source.details),
      occurredAt,
    },
  };
}

function sanitizeAnjuPayEntry(entryId, value) {
  const source = value && typeof value === "object" ? value : {};
  const kind = cleanText(source.kind || source.type, 48, "adjustment") || "adjustment";
  const balanceBefore = boundedInteger(source.balanceBefore, 0, MAX_BALANCE, 0);
  const balanceAfter = boundedInteger(source.balanceAfter, 0, MAX_BALANCE, balanceBefore);
  const entry = {
    id: cleanText(entryId, 64),
    schemaVersion: ANJU_PAY_LEDGER_SCHEMA_VERSION,
    sequence: boundedInteger(source.sequence, 0, Number.MAX_SAFE_INTEGER, 0),
    groupId: (
      source.groupId === ANJU_PAY_OPENING_ENTRY_ID
      || /^[a-f0-9]{40}$/.test(cleanText(source.groupId, 64))
    )
      ? cleanText(source.groupId, 64)
      : "",
    type: kind,
    kind,
    category: cleanText(source.category, 24, "adjustment") || "adjustment",
    labelKey: cleanText(source.labelKey, 64, `anju_pay_${kind}`) || `anju_pay_${kind}`,
    status: normalizeStatus(source.status),
    delta: boundedInteger(source.delta, -MAX_BALANCE, MAX_BALANCE, balanceAfter - balanceBefore),
    nominalAmount: boundedInteger(source.nominalAmount, 0, MAX_BALANCE, 0),
    balanceBefore,
    balanceAfter,
    components: Array.isArray(source.components)
      ? source.components.slice(0, MAX_COMPONENTS).map(sanitizeComponent)
      : [],
    details: sanitizeDetails(source.details),
    occurredAt: boundedInteger(source.occurredAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
  if (kind === "opening") {
    entry.openingBalance = boundedInteger(
      source.openingBalance,
      0,
      MAX_BALANCE,
      balanceAfter,
    );
  }
  return entry;
}

module.exports = {
  ANJU_PAY_HISTORY_DEFAULT_LIMIT,
  ANJU_PAY_HISTORY_MAX_LIMIT,
  ANJU_PAY_LEDGER_SCHEMA_VERSION,
  ANJU_PAY_OPENING_ENTRY_ID,
  activateAnjuPayWallet,
  anjuPayEntryId,
  anjuPayLedgerModeDecision,
  isAnjuPayWalletActive,
  nextAnjuPayEntry,
  sanitizeAnjuPayEntry,
};
