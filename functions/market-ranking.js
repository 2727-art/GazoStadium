"use strict";

const MARKET_RANKING_CONTRIBUTION_CAP = 500;
const MARKET_RANKING_HONOR_LEVEL_MONTHS = Object.freeze([1, 3, 6, 12]);
const MARKET_RANKING_HONOR_ROLES = Object.freeze(["seller", "buyer"]);

function count(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function marketRankingContribution(value) {
  return count(value, MARKET_RANKING_CONTRIBUTION_CAP);
}

function normalizeMonthlyMarketStats(value, uid, seasonKey, name = "PLAYER") {
  const sameOwner = value?.uid === uid && value?.seasonKey === seasonKey;
  const source = sameOwner ? value : {};
  return {
    schemaVersion: 1,
    uid,
    seasonKey,
    name: String(source?.name || name || "PLAYER").trim().replace(/\s+/g, " ").slice(0, 16)
      || "PLAYER",
    salesCount: count(source?.salesCount),
    grossSales: count(source?.grossSales),
    actualGrossSales: count(source?.actualGrossSales),
    marketFeesPaid: count(source?.marketFeesPaid),
    netSales: count(source?.netSales),
    bestSale: count(source?.bestSale),
    purchases: count(source?.purchases),
    spent: count(source?.spent),
    actualSpent: count(source?.actualSpent),
    highestPurchase: count(source?.highestPurchase),
    uniqueCounterparties: count(source?.uniqueCounterparties),
    oshijoSalesCount: count(source?.oshijoSalesCount),
    oshijoUniqueBuyers: count(source?.oshijoUniqueBuyers),
    oshijoNetProceeds: count(source?.oshijoNetProceeds),
    publicProfile: source?.publicProfile && typeof source.publicProfile === "object"
      ? source.publicProfile
      : {},
    publicAchievements: Array.isArray(source?.publicAchievements)
      ? source.publicAchievements
      : [],
    updatedAt: sameOwner ? count(source?.updatedAt) : 0,
  };
}

function applyMonthlyMarketSale(value, {
  uid,
  seasonKey,
  name,
  role,
  paidAmount,
  sellerProceeds = 0,
  oshijoProceeds = sellerProceeds,
  effectiveFee = 0,
  rankingCounted = false,
  newCounterparty = false,
  newOshijoCounterparty = newCounterparty,
  oshijo = false,
  publicProfile,
  publicAchievements,
  now = Date.now(),
} = {}) {
  const stats = normalizeMonthlyMarketStats(value, uid, seasonKey, name);
  const paid = count(paidAmount);
  const proceeds = count(sellerProceeds);
  const eligibleOshijoProceeds = count(oshijoProceeds);
  const fee = count(effectiveFee);
  const contribution = rankingCounted ? marketRankingContribution(paid) : 0;
  stats.name = String(name || stats.name || "PLAYER").trim().replace(/\s+/g, " ").slice(0, 16)
    || "PLAYER";
  if (publicProfile && typeof publicProfile === "object") stats.publicProfile = publicProfile;
  if (Array.isArray(publicAchievements)) stats.publicAchievements = publicAchievements;
  if (role === "seller") {
    stats.actualGrossSales += paid;
    stats.marketFeesPaid += fee;
    stats.netSales += proceeds;
    if (oshijo) stats.oshijoNetProceeds += eligibleOshijoProceeds;
    if (rankingCounted) {
      stats.salesCount += 1;
      stats.grossSales += contribution;
      stats.bestSale = Math.max(stats.bestSale, contribution);
      if (newCounterparty) stats.uniqueCounterparties += 1;
      if (oshijo) {
        stats.oshijoSalesCount += 1;
        if (newOshijoCounterparty) stats.oshijoUniqueBuyers += 1;
      }
    }
  } else if (role === "buyer") {
    stats.actualSpent += paid;
    if (rankingCounted) {
      stats.purchases += 1;
      stats.spent += contribution;
      stats.highestPurchase = Math.max(stats.highestPurchase, contribution);
      if (newCounterparty) stats.uniqueCounterparties += 1;
    }
  }
  stats.updatedAt = count(now);
  return stats;
}

function marketRankingAwardForRank(value) {
  const rank = count(value);
  if (rank === 1) return Object.freeze({ id: "champion", label: "月間1位", rank });
  if (rank <= 3 && rank > 0) return Object.freeze({ id: "top3", label: "月間TOP3", rank });
  if (rank <= 10 && rank > 0) return Object.freeze({ id: "top10", label: "月間TOP10", rank });
  return null;
}

function honorLevel(months) {
  const countMonths = count(months);
  return MARKET_RANKING_HONOR_LEVEL_MONTHS.filter((target) => countMonths >= target).length;
}

function normalizeMarketRankingHonors(value, uid) {
  const sameOwner = value?.uid === uid;
  const normalizeRole = (role) => {
    const source = sameOwner && value?.[role] && typeof value[role] === "object"
      ? value[role]
      : {};
    const months = count(source.months);
    return {
      months,
      top3Months: Math.min(months, count(source.top3Months)),
      championMonths: Math.min(months, count(source.championMonths)),
      level: honorLevel(months),
      latestSeasonKey: /^\d{4}-\d{2}$/.test(String(source.latestSeasonKey || ""))
        ? source.latestSeasonKey
        : "",
      latestAwardId: ["champion", "top3", "top10"].includes(source.latestAwardId)
        ? source.latestAwardId
        : "",
      latestRank: count(source.latestRank, 10),
    };
  };
  return {
    schemaVersion: 1,
    uid,
    seller: normalizeRole("seller"),
    buyer: normalizeRole("buyer"),
    updatedAt: sameOwner ? count(value?.updatedAt) : 0,
  };
}

function applyMarketRankingHonor(value, {
  uid,
  role,
  seasonKey,
  rank,
  now = Date.now(),
} = {}) {
  if (!MARKET_RANKING_HONOR_ROLES.includes(role)) {
    throw new RangeError("Unknown market ranking honor role.");
  }
  const award = marketRankingAwardForRank(rank);
  if (!award || !/^\d{4}-\d{2}$/.test(String(seasonKey || ""))) {
    throw new RangeError("Invalid market ranking honor award.");
  }
  const honors = normalizeMarketRankingHonors(value, uid);
  const current = honors[role];
  const months = current.months + 1;
  honors[role] = {
    months,
    top3Months: current.top3Months + (award.rank <= 3 ? 1 : 0),
    championMonths: current.championMonths + (award.rank === 1 ? 1 : 0),
    level: honorLevel(months),
    latestSeasonKey: seasonKey,
    latestAwardId: award.id,
    latestRank: award.rank,
  };
  honors.updatedAt = count(now);
  return { honors, award };
}

function publicMarketRankingHonors(value, uid) {
  const honors = normalizeMarketRankingHonors(value, uid);
  return {
    seller: honors.seller,
    buyer: honors.buyer,
    levelMonths: [...MARKET_RANKING_HONOR_LEVEL_MONTHS],
  };
}

module.exports = Object.freeze({
  MARKET_RANKING_CONTRIBUTION_CAP,
  MARKET_RANKING_HONOR_LEVEL_MONTHS,
  MARKET_RANKING_HONOR_ROLES,
  applyMarketRankingHonor,
  applyMonthlyMarketSale,
  marketRankingAwardForRank,
  marketRankingContribution,
  normalizeMarketRankingHonors,
  normalizeMonthlyMarketStats,
  publicMarketRankingHonors,
});
