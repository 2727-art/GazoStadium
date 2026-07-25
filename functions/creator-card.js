"use strict";

const CREATOR_CARD_VERSION = 2;
const CREATOR_CARD_TEXT_MAX_LENGTH = 30;
const CREATOR_CARD_PREMIUM_PRODUCT_ID = "feature_top_message";
const CREATOR_CARD_TYPES = Object.freeze([
  "illustration",
  "photo",
  "both",
  "community",
]);
const CREATOR_CARD_FREE_THEMES = Object.freeze([
  "basic-rose",
  "basic-aqua",
  "basic-violet",
  "basic-sunset",
]);
const CREATOR_CARD_PREMIUM_THEMES = Object.freeze([
  "premium-hologram",
  "premium-stardust",
  "premium-royal",
]);
const CREATOR_CARD_GROWTH_THRESHOLDS = Object.freeze([0, 1, 10, 30, 100]);
const CREATOR_CARD_X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const CREATOR_CARD_URL_PATTERN = /(?:https?:\/\/|www\.|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?:[/?#]\S*)?)/i;
const CREATOR_CARD_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/i;

function nonNegativeInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function creatorCardActivityCount(battleStats, marketStats) {
  return nonNegativeInteger(battleStats?.totalMatches)
    + nonNegativeInteger(marketStats?.salesCount)
    + nonNegativeInteger(marketStats?.purchases);
}

function creatorCardGrowthLevel(activityCount) {
  const activity = nonNegativeInteger(activityCount);
  let level = 1;
  CREATOR_CARD_GROWTH_THRESHOLDS.forEach((threshold, index) => {
    if (activity >= threshold) level = index + 1;
  });
  return level;
}

function isCreatorCardType(value) {
  return typeof value === "string" && CREATOR_CARD_TYPES.includes(value);
}

function isCreatorCardTheme(value) {
  return typeof value === "string"
    && (CREATOR_CARD_FREE_THEMES.includes(value)
      || CREATOR_CARD_PREMIUM_THEMES.includes(value));
}

function isPremiumCreatorCardTheme(value) {
  return typeof value === "string" && CREATOR_CARD_PREMIUM_THEMES.includes(value);
}

function isValidCreatorCardText(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length > 0
    && text.length <= CREATOR_CARD_TEXT_MAX_LENGTH
    && !/[\r\n]/.test(text)
    && !CREATOR_CARD_URL_PATTERN.test(text)
    && !CREATOR_CARD_EMAIL_PATTERN.test(text);
}

function normalizeCreatorCardXHandle(value) {
  if (typeof value !== "string") return "";
  const handle = value.trim().replace(/^@+/, "");
  return CREATOR_CARD_X_HANDLE_PATTERN.test(handle) ? handle : "";
}

module.exports = Object.freeze({
  CREATOR_CARD_FREE_THEMES,
  CREATOR_CARD_GROWTH_THRESHOLDS,
  CREATOR_CARD_PREMIUM_PRODUCT_ID,
  CREATOR_CARD_PREMIUM_THEMES,
  CREATOR_CARD_TEXT_MAX_LENGTH,
  CREATOR_CARD_TYPES,
  CREATOR_CARD_VERSION,
  creatorCardActivityCount,
  creatorCardGrowthLevel,
  isCreatorCardTheme,
  isCreatorCardType,
  isPremiumCreatorCardTheme,
  isValidCreatorCardText,
  normalizeCreatorCardXHandle,
});
