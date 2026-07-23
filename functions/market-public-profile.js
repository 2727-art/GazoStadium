"use strict";

const { sanitizeAchievementIds } = require("./achievements");

const MARKET_X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const MARKET_TAGLINE_MAX_LENGTH = 40;

function normalizeMarketXHandle(value) {
  return typeof value === "string" ? value.trim().replace(/^@/, "") : "";
}

function isValidMarketXHandle(value) {
  return MARKET_X_HANDLE_PATTERN.test(normalizeMarketXHandle(value));
}

function normalizeMarketTagline(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidMarketTagline(value) {
  const tagline = normalizeMarketTagline(value);
  return tagline.length >= 1
    && tagline.length <= MARKET_TAGLINE_MAX_LENGTH
    && !/[\u0000-\u001f\u007f\r\n]/.test(tagline);
}

function sanitizeStoredMarketPublicProfile(value) {
  const xHandle = normalizeMarketXHandle(value?.xHandle);
  const tagline = normalizeMarketTagline(value?.tagline);
  return {
    xHandle: isValidMarketXHandle(xHandle) ? xHandle : "",
    tagline: isValidMarketTagline(tagline) ? tagline : "",
  };
}

function isMarketPublicProfilePrivacyReduction(currentValue, nextValue) {
  const current = sanitizeStoredMarketPublicProfile(currentValue);
  const next = sanitizeStoredMarketPublicProfile(nextValue);
  const removesPublishedField = (Boolean(current.xHandle) && !next.xHandle)
    || (Boolean(current.tagline) && !next.tagline);
  const addsNoNewExposure = (!next.xHandle || next.xHandle === current.xHandle)
    && (!next.tagline || next.tagline === current.tagline);
  return removesPublishedField && addsNoNewExposure;
}

function marketPublicProfileUpdateDecision(currentValue, nextValue, now, cooldownMs) {
  const current = sanitizeStoredMarketPublicProfile(currentValue);
  const next = sanitizeStoredMarketPublicProfile(nextValue);
  const currentIsCanonical = normalizeMarketXHandle(currentValue?.xHandle) === current.xHandle
    && normalizeMarketTagline(currentValue?.tagline) === current.tagline;
  const previousUpdatedAt = Math.max(0, Number(currentValue?.updatedAt || 0));
  if (currentIsCanonical && current.xHandle === next.xHandle && current.tagline === next.tagline) {
    return {
      action: "noop",
      profile: current,
      updatedAt: previousUpdatedAt,
      retryAfterMs: 0,
    };
  }
  if (isMarketPublicProfilePrivacyReduction(current, next)) {
    return {
      action: "write",
      profile: next,
      updatedAt: now,
      retryAfterMs: 0,
    };
  }
  const retryAfterMs = Math.max(0, previousUpdatedAt + cooldownMs - now);
  return {
    action: retryAfterMs > 0 ? "rate_limited" : "write",
    profile: next,
    updatedAt: now,
    retryAfterMs,
  };
}

function hasRankedMarketStats(value) {
  return Number(value?.grossSales || 0) > 0 || Number(value?.spent || 0) > 0;
}

function createMarketRankingRow(value, role, isViewer = false) {
  const name = String(value?.name || "PLAYER").trim().replace(/\s+/g, " ").slice(0, 16) || "PLAYER";
  return {
    name,
    primary: role === "seller" ? Number(value?.grossSales || 0) : Number(value?.spent || 0),
    count: role === "seller" ? Number(value?.salesCount || 0) : Number(value?.purchases || 0),
    best: role === "seller" ? Number(value?.bestSale || 0) : Number(value?.highestPurchase || 0),
    publicProfile: sanitizeStoredMarketPublicProfile(value?.publicProfile),
    achievementShowcase: sanitizeAchievementIds(value?.publicAchievements),
    isViewer: isViewer === true,
  };
}

module.exports = Object.freeze({
  MARKET_TAGLINE_MAX_LENGTH,
  MARKET_X_HANDLE_PATTERN,
  createMarketRankingRow,
  hasRankedMarketStats,
  isMarketPublicProfilePrivacyReduction,
  isValidMarketTagline,
  isValidMarketXHandle,
  marketPublicProfileUpdateDecision,
  normalizeMarketTagline,
  normalizeMarketXHandle,
  sanitizeStoredMarketPublicProfile,
});
