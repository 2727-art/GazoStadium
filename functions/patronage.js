"use strict";

const PATRON_TIERS = Object.freeze([
  Object.freeze({ level: 0, id: "guest", label: "MARKET GUEST", threshold: 0 }),
  Object.freeze({ level: 1, id: "supporter", label: "SUPPORTER", threshold: 300 }),
  Object.freeze({ level: 2, id: "patron", label: "PATRON", threshold: 1_500 }),
  Object.freeze({ level: 3, id: "grand_patron", label: "GRAND PATRON", threshold: 5_000 }),
]);
const OSHIJO_PATRON_MINIMUM_SALES = 5;
const OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS = 3;

function count(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function tierForSpent(value) {
  const spent = count(value);
  return [...PATRON_TIERS].reverse().find((tier) => spent >= tier.threshold) || PATRON_TIERS[0];
}

function tierForLevel(value) {
  const level = count(value, PATRON_TIERS.at(-1).level);
  return PATRON_TIERS.find((tier) => tier.level === level) || PATRON_TIERS[0];
}

function normalizePatronage(value, seasonKey) {
  const sameSeason = value?.seasonKey === seasonKey;
  const spent = sameSeason ? count(value?.seasonSpent, PATRON_TIERS.at(-1).threshold) : 0;
  const oshijoSeasonSpent = sameSeason
    ? Math.min(spent, count(value?.oshijoSeasonSpent, PATRON_TIERS.at(-1).threshold))
    : 0;
  const tier = tierForSpent(spent);
  return {
    seasonKey,
    seasonSpent: spent,
    oshijoSeasonSpent,
    tier: tier.level,
    tierId: tier.id,
    tierLabel: tier.label,
    lifetimeSpent: count(value?.lifetimeSpent),
    oshijoLifetimeSpent: count(value?.oshijoLifetimeSpent),
    updatedAt: count(value?.updatedAt),
  };
}

function publicPatronage(value, seasonKey) {
  const patronage = normalizePatronage(value, seasonKey);
  return {
    seasonKey: patronage.seasonKey,
    seasonSpent: patronage.seasonSpent,
    tier: patronage.tier,
    tierId: patronage.tierId,
    tierLabel: patronage.tierLabel,
    oshijoQualified: patronage.oshijoSeasonSpent > 0,
  };
}

function patronUpgrade(value, targetLevel, seasonKey) {
  const current = normalizePatronage(value, seasonKey);
  const target = tierForLevel(targetLevel);
  if (target.level < 1) return { outcome: "invalid", current, target, cost: 0 };
  if (current.tier >= target.level) return { outcome: "owned", current, target, cost: 0 };
  return {
    outcome: "upgrade",
    current,
    target,
    cost: Math.max(0, target.threshold - current.seasonSpent),
  };
}

function oshijoPatronEligibility(marketValue, patronageValue, seasonKey) {
  const sameSeason = marketValue?.seasonKey === seasonKey;
  const salesCount = sameSeason ? count(marketValue?.oshijoSalesCount) : 0;
  const uniqueBuyers = sameSeason ? count(marketValue?.oshijoUniqueBuyers) : 0;
  const netProceeds = sameSeason ? count(marketValue?.oshijoNetProceeds) : 0;
  const patronage = normalizePatronage(patronageValue, seasonKey);
  const proceedsUsed = Math.min(netProceeds, patronage.oshijoSeasonSpent);
  const availableProceeds = netProceeds - proceedsUsed;
  const popular = salesCount >= OSHIJO_PATRON_MINIMUM_SALES
    && uniqueBuyers >= OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS;
  const nextTier = PATRON_TIERS.find((tier) => tier.level > patronage.tier) || null;
  const nextCost = nextTier ? Math.max(0, nextTier.threshold - patronage.seasonSpent) : 0;
  return {
    seasonKey,
    popular,
    salesCount,
    uniqueBuyers,
    netProceeds,
    proceedsUsed,
    availableProceeds,
    minimumSales: OSHIJO_PATRON_MINIMUM_SALES,
    minimumUniqueBuyers: OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS,
    nextTier: nextTier
      ? {
        level: nextTier.level,
        id: nextTier.id,
        label: nextTier.label,
        threshold: nextTier.threshold,
        cost: nextCost,
      }
      : null,
    canUpgrade: Boolean(nextTier) && popular && availableProceeds >= nextCost,
  };
}

module.exports = Object.freeze({
  OSHIJO_PATRON_MINIMUM_SALES,
  OSHIJO_PATRON_MINIMUM_UNIQUE_BUYERS,
  PATRON_TIERS,
  normalizePatronage,
  oshijoPatronEligibility,
  patronUpgrade,
  publicPatronage,
  tierForLevel,
  tierForSpent,
});
