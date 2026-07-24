"use strict";

const PATRON_FUND_CONTRIBUTION_BASIS_POINTS = 2_000;
const PATRON_FUND_MAX_SUBSIDY_PER_SALE = 10;
const PATRON_FUND_MONTHLY_SELLER_CAP = 50;
const PATRON_RECOMMENDATION_LIMITS = Object.freeze([0, 1, 2, 3]);
const MARKET_POLICY_IDS = Object.freeze(["balanced", "discovery", "trust"]);
const MARKET_POLICY_ID_SET = new Set(MARKET_POLICY_IDS);

function nonNegativeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function monthlySeasonKey(value) {
  const normalized = String(value || "");
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function dateKey(value) {
  const normalized = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeMarketPolicyId(value) {
  const candidate = typeof value === "string"
    ? value
    : value?.activePolicy ?? value?.policyId;
  const normalized = String(candidate || "").trim().toLowerCase();
  return MARKET_POLICY_ID_SET.has(normalized) ? normalized : "balanced";
}

function normalizePolicyVote(value) {
  const candidate = typeof value === "string"
    ? value
    : value?.policyId ?? value?.vote;
  const normalized = String(candidate || "").trim().toLowerCase();
  return MARKET_POLICY_ID_SET.has(normalized) ? normalized : null;
}

function splitPatronPayment(value) {
  const paidAmount = nonNegativeInteger(value);
  // 20% is exactly one fifth. Dividing first avoids precision loss near MAX_SAFE_INTEGER.
  const contributionAmount = Math.floor(paidAmount / 5);
  return {
    paidAmount,
    burnAmount: paidAmount - contributionAmount,
    contributionAmount,
  };
}

function normalizePatronFund(value, seasonKey) {
  const normalizedSeasonKey = monthlySeasonKey(seasonKey);
  const sameSeason = Boolean(normalizedSeasonKey) && value?.seasonKey === normalizedSeasonKey;
  const totalContributed = sameSeason
    ? nonNegativeInteger(
      value?.totalContributed ?? value?.contributedAmount ?? value?.contributed,
    )
    : 0;
  const totalSubsidized = sameSeason
    ? Math.min(
      totalContributed,
      nonNegativeInteger(
        value?.totalSubsidized ?? value?.subsidizedAmount ?? value?.subsidized,
      ),
    )
    : 0;
  const totalBurned = sameSeason
    ? nonNegativeInteger(value?.totalBurned ?? value?.burnedAmount ?? value?.burned)
    : 0;
  return {
    seasonKey: normalizedSeasonKey,
    totalContributed,
    totalBurned,
    totalSubsidized,
    fundRemaining: totalContributed - totalSubsidized,
    supportedSaleCount: sameSeason
      ? nonNegativeInteger(value?.supportedSaleCount ?? value?.supportedSales)
      : 0,
    supportedSellerCount: sameSeason
      ? nonNegativeInteger(value?.supportedSellerCount ?? value?.supportedSellers)
      : 0,
    activePolicy: sameSeason ? normalizeMarketPolicyId(value) : "balanced",
    updatedAt: sameSeason ? nonNegativeInteger(value?.updatedAt) : 0,
  };
}

function relationshipSubsidyKind({
  previousSaleCount = 0,
  lastSaleDateKey = "",
  currentDateKey = "",
  dateKey: legacyDateKey = "",
} = {}) {
  const priorSales = nonNegativeInteger(previousSaleCount);
  if (priorSales === 0) return "discovery";
  const previousDate = dateKey(lastSaleDateKey);
  const today = dateKey(currentDateKey || legacyDateKey);
  return previousDate && today && previousDate !== today ? "trust" : null;
}

function policyAllowsSubsidy({
  policyId = "balanced",
  previousSaleCount = 0,
  lastSaleDateKey = "",
  currentDateKey = "",
  dateKey: legacyDateKey = "",
} = {}) {
  const kind = relationshipSubsidyKind({
    previousSaleCount,
    lastSaleDateKey,
    currentDateKey,
    dateKey: legacyDateKey,
  });
  const policy = normalizeMarketPolicyId(policyId);
  return Boolean(kind) && (policy === "balanced" || policy === kind);
}

function patronFundSubsidyAmount({
  actualFee = 0,
  fundRemaining = 0,
  sellerRemainingCap = PATRON_FUND_MONTHLY_SELLER_CAP,
} = {}) {
  const fee = nonNegativeInteger(actualFee);
  const availableFund = nonNegativeInteger(fundRemaining);
  const availableSellerCap = nonNegativeInteger(
    sellerRemainingCap,
    PATRON_FUND_MONTHLY_SELLER_CAP,
  );
  return Math.max(0, Math.min(
    Math.floor(fee / 2),
    PATRON_FUND_MAX_SUBSIDY_PER_SALE,
    availableFund,
    availableSellerCap,
    fee - 1,
  ));
}

function patronFundSubsidyDecision(options = {}) {
  const fee = nonNegativeInteger(options.actualFee);
  const policyId = normalizeMarketPolicyId(options.policyId);
  const kind = relationshipSubsidyKind(options);
  const hasExplicitSellerCap = Object.prototype.hasOwnProperty.call(
    options,
    "sellerRemainingCap",
  );
  const sellerRemainingCap = hasExplicitSellerCap
    ? nonNegativeInteger(
      options.sellerRemainingCap,
      PATRON_FUND_MONTHLY_SELLER_CAP,
    )
    : Math.max(
      0,
      PATRON_FUND_MONTHLY_SELLER_CAP
        - nonNegativeInteger(
          options.sellerSubsidized,
          PATRON_FUND_MONTHLY_SELLER_CAP,
        ),
    );

  let reason = "subsidized";
  if (options.pairAlreadySubsidized === true) {
    reason = "pair_monthly_limit";
  } else if (!kind) {
    reason = "relationship_ineligible";
  } else if (policyId !== "balanced" && policyId !== kind) {
    reason = "policy_ineligible";
  } else if (fee < 2) {
    reason = "fee_too_small";
  } else if (nonNegativeInteger(options.fundRemaining) < 1) {
    reason = "fund_empty";
  } else if (sellerRemainingCap < 1) {
    reason = "seller_monthly_cap";
  }

  const subsidyAmount = reason === "subsidized"
    ? patronFundSubsidyAmount({
      actualFee: fee,
      fundRemaining: options.fundRemaining,
      sellerRemainingCap,
    })
    : 0;
  if (reason === "subsidized" && subsidyAmount < 1) {
    reason = "ineligible";
  }

  return {
    eligible: subsidyAmount > 0,
    reason,
    policyId,
    kind,
    subsidyAmount,
    feeBurnAmount: fee - subsidyAmount,
    sellerRemainingCap,
    sellerRemainingCapAfter: sellerRemainingCap - subsidyAmount,
  };
}

function patronRecommendationLimit(value) {
  const candidate = value && typeof value === "object"
    ? value.tier ?? value.level
    : value;
  const tier = nonNegativeInteger(candidate, PATRON_RECOMMENDATION_LIMITS.length - 1);
  return PATRON_RECOMMENDATION_LIMITS[tier];
}

function tallyPolicyVotes(value) {
  const votes = { balanced: 0, discovery: 0, trust: 0 };
  const source = Array.isArray(value)
    ? value
    : value instanceof Map
      ? [...value.values()]
      : value && typeof value === "object"
        ? Object.values(value)
        : [];

  for (const entry of source) {
    const policyId = normalizePolicyVote(entry);
    if (policyId) votes[policyId] += 1;
  }

  const totalVotes = MARKET_POLICY_IDS.reduce((total, policyId) => (
    total + votes[policyId]
  ), 0);
  const highestVoteCount = Math.max(...MARKET_POLICY_IDS.map((policyId) => votes[policyId]));
  // The declared order makes balanced the deterministic winner whenever it shares first place.
  const activePolicy = MARKET_POLICY_IDS.find(
    (policyId) => votes[policyId] === highestVoteCount,
  ) || "balanced";
  return { activePolicy, totalVotes, votes };
}

function publicPatronFundSummary(value, seasonKey) {
  const fund = normalizePatronFund(value, seasonKey);
  return {
    seasonKey: fund.seasonKey,
    totalContributed: fund.totalContributed,
    totalBurned: fund.totalBurned,
    totalSubsidized: fund.totalSubsidized,
    fundRemaining: fund.fundRemaining,
    supportedSaleCount: fund.supportedSaleCount,
    supportedSellerCount: fund.supportedSellerCount,
    activePolicy: fund.activePolicy,
    contributionBasisPoints: PATRON_FUND_CONTRIBUTION_BASIS_POINTS,
    maxSubsidyPerSale: PATRON_FUND_MAX_SUBSIDY_PER_SALE,
    monthlySellerCap: PATRON_FUND_MONTHLY_SELLER_CAP,
  };
}

module.exports = Object.freeze({
  MARKET_POLICY_IDS,
  PATRON_FUND_CONTRIBUTION_BASIS_POINTS,
  PATRON_FUND_MAX_SUBSIDY_PER_SALE,
  PATRON_FUND_MONTHLY_SELLER_CAP,
  PATRON_RECOMMENDATION_LIMITS,
  normalizeMarketPolicyId,
  normalizePatronFund,
  normalizePolicyVote,
  patronFundSubsidyAmount,
  patronFundSubsidyDecision,
  patronRecommendationLimit,
  policyAllowsSubsidy,
  publicPatronFundSummary,
  relationshipSubsidyKind,
  splitPatronPayment,
  tallyPolicyVotes,
});
