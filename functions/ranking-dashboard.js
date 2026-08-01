"use strict";

const SERVER_OVERALL_ENTRY_ID_PATTERN = /^[-0-9A-Z_a-z]{16,40}$/;

function serverOverallRankingKey(value) {
  if (!value || typeof value !== "object" || value.enabled !== true) return null;
  const entryId = typeof value.entryId === "string" ? value.entryId : "";
  const rating = value.rating;
  if (!SERVER_OVERALL_ENTRY_ID_PATTERN.test(entryId)
    || typeof rating !== "number"
    || !Number.isInteger(rating)
    || rating < 100
    || rating > 3000) {
    return null;
  }
  return { rating, entryId };
}

function sameServerOverallRankingKey(first, second) {
  if (!first || !second) return first === second;
  return first.rating === second.rating && first.entryId === second.entryId;
}

function compareServerOverallRankingKeys(first, second) {
  const ratingDifference = Number(second?.rating || 0) - Number(first?.rating || 0);
  if (ratingDifference) return ratingDifference;
  const firstEntryId = String(first?.entryId || "");
  const secondEntryId = String(second?.entryId || "");
  return firstEntryId < secondEntryId ? -1 : firstEntryId > secondEntryId ? 1 : 0;
}

function aggregateCount(snapshot) {
  const count = Number(snapshot?.data?.()?.count || 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function crownCustomizationOptions({
  completedRun = false,
  topThreeAward = false,
  signatureIds = [],
} = {}) {
  const availableThemes = ["rose"];
  if (completedRun) availableThemes.push("aqua");
  if (topThreeAward) availableThemes.push("violet");
  if (signatureIds.some((id) => [
    "daily_champion",
    "weekly_champion",
    "monthly_champion",
  ].includes(id))) {
    availableThemes.push("gold");
  }
  return {
    availableThemes,
    availableSignatureIds: [...new Set(signatureIds)],
  };
}

module.exports = {
  aggregateCount,
  compareServerOverallRankingKeys,
  crownCustomizationOptions,
  sameServerOverallRankingKey,
  serverOverallRankingKey,
};
