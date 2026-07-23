"use strict";

const crypto = require("node:crypto");

const TRANSFER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TRANSFER_CODE_LENGTH = 16;
const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;
const TRANSFER_CREATE_COOLDOWN_MS = 30 * 1000;
const TRANSFER_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const TRANSFER_MAX_FAILURES = 8;
const TRANSFER_BLOCK_MS = 15 * 60 * 1000;

function createTransferCode(randomInt = crypto.randomInt) {
  let compact = "";
  for (let index = 0; index < TRANSFER_CODE_LENGTH; index += 1) {
    compact += TRANSFER_CODE_ALPHABET[randomInt(TRANSFER_CODE_ALPHABET.length)];
  }
  return compact.match(/.{1,4}/g).join("-");
}

function normalizeTransferCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== TRANSFER_CODE_LENGTH) return "";
  if ([...compact].some((character) => !TRANSFER_CODE_ALPHABET.includes(character))) return "";
  return compact;
}

function formatTransferCode(value) {
  const compact = normalizeTransferCode(value);
  return compact ? compact.match(/.{1,4}/g).join("-") : "";
}

function hashTransferCode(value) {
  const compact = normalizeTransferCode(value);
  return compact ? crypto.createHash("sha256").update(compact).digest("hex") : "";
}

function transferCodeDecision(value, targetUid, now = Date.now()) {
  if (!value || typeof value !== "object") return { outcome: "invalid" };
  if (Number(value.expiresAt || 0) <= now) return { outcome: "expired" };
  const sourceUid = String(value.sourceUid || "");
  if (!sourceUid) return { outcome: "invalid" };
  if (Number(value.usedAt || 0) > 0) {
    const retryUntil = Math.min(
      Number(value.expiresAt || 0),
      Number(value.retryUntil || 0),
    );
    if (String(value.usedByUid || "") === String(targetUid || "") && retryUntil > now) {
      return { outcome: "retry", sourceUid };
    }
    return { outcome: "used" };
  }
  if (sourceUid === String(targetUid || "")) return { outcome: "same-account", sourceUid };
  return { outcome: "redeem", sourceUid };
}

function normalizeAttemptState(value, now = Date.now()) {
  const blockedUntil = Math.max(0, Math.floor(Number(value?.blockedUntil || 0)));
  if (blockedUntil > now) {
    return {
      windowStartedAt: Math.max(0, Math.floor(Number(value?.windowStartedAt || now))),
      failures: Math.max(0, Math.floor(Number(value?.failures || 0))),
      blockedUntil,
    };
  }
  const windowStartedAt = Math.max(0, Math.floor(Number(value?.windowStartedAt || 0)));
  if (!windowStartedAt || windowStartedAt <= now - TRANSFER_ATTEMPT_WINDOW_MS) {
    return { windowStartedAt: now, failures: 0, blockedUntil: 0 };
  }
  return {
    windowStartedAt,
    failures: Math.max(0, Math.floor(Number(value?.failures || 0))),
    blockedUntil: 0,
  };
}

function nextAttemptState(value, { now = Date.now(), success = false } = {}) {
  if (success) return { windowStartedAt: now, failures: 0, blockedUntil: 0, updatedAt: now };
  const current = normalizeAttemptState(value, now);
  const failures = current.failures + 1;
  return {
    windowStartedAt: current.windowStartedAt,
    failures,
    blockedUntil: failures >= TRANSFER_MAX_FAILURES ? now + TRANSFER_BLOCK_MS : 0,
    updatedAt: now,
  };
}

module.exports = Object.freeze({
  TRANSFER_ATTEMPT_WINDOW_MS,
  TRANSFER_BLOCK_MS,
  TRANSFER_CODE_ALPHABET,
  TRANSFER_CODE_LENGTH,
  TRANSFER_CODE_TTL_MS,
  TRANSFER_CREATE_COOLDOWN_MS,
  TRANSFER_MAX_FAILURES,
  createTransferCode,
  formatTransferCode,
  hashTransferCode,
  nextAttemptState,
  normalizeAttemptState,
  normalizeTransferCode,
  transferCodeDecision,
});
