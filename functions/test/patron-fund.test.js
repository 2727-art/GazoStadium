const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
} = require("../patron-fund");

test("patron payments put exactly 20 percent into the circulation fund", () => {
  assert.equal(PATRON_FUND_CONTRIBUTION_BASIS_POINTS, 2_000);
  assert.deepEqual(splitPatronPayment(300), {
    paidAmount: 300,
    burnAmount: 240,
    contributionAmount: 60,
  });
  assert.deepEqual(splitPatronPayment(1_500), {
    paidAmount: 1_500,
    burnAmount: 1_200,
    contributionAmount: 300,
  });
  assert.deepEqual(splitPatronPayment(5_000), {
    paidAmount: 5_000,
    burnAmount: 4_000,
    contributionAmount: 1_000,
  });
  assert.deepEqual(splitPatronPayment(1), {
    paidAmount: 1,
    burnAmount: 1,
    contributionAmount: 0,
  });
  assert.deepEqual(splitPatronPayment(9.9), {
    paidAmount: 9,
    burnAmount: 8,
    contributionAmount: 1,
  });
});

test("payment splitting rejects negative, non-finite, and object-injected amounts", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, {}, undefined]) {
    assert.deepEqual(splitPatronPayment(value), {
      paidAmount: 0,
      burnAmount: 0,
      contributionAmount: 0,
    });
  }
  const split = splitPatronPayment(Number.MAX_SAFE_INTEGER);
  assert.equal(split.contributionAmount, Math.floor(Number.MAX_SAFE_INTEGER / 5));
  assert.equal(split.burnAmount + split.contributionAmount, split.paidAmount);
});

test("sale subsidy is half the actual fee, bounded by 10 Pay, fund, and seller cap", () => {
  assert.equal(PATRON_FUND_MAX_SUBSIDY_PER_SALE, 10);
  assert.equal(PATRON_FUND_MONTHLY_SELLER_CAP, 50);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 15,
    fundRemaining: 100,
    sellerRemainingCap: 50,
  }), 7);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 25,
    fundRemaining: 100,
    sellerRemainingCap: 50,
  }), 10);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 25,
    fundRemaining: 6,
    sellerRemainingCap: 50,
  }), 6);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 25,
    fundRemaining: 100,
    sellerRemainingCap: 4,
  }), 4);
});

test("subsidy never erases the actual fee and malformed balances cannot mint Pay", () => {
  assert.equal(patronFundSubsidyAmount({
    actualFee: 1,
    fundRemaining: 100,
    sellerRemainingCap: 50,
  }), 0);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 2,
    fundRemaining: 100,
    sellerRemainingCap: 50,
  }), 1);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 999,
    fundRemaining: -1,
    sellerRemainingCap: 50,
  }), 0);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 999,
    fundRemaining: 100,
    sellerRemainingCap: Number.POSITIVE_INFINITY,
  }), 0);
  assert.equal(patronFundSubsidyAmount({
    actualFee: 3.9,
    fundRemaining: 100,
    sellerRemainingCap: 50,
  }), 1);
});

test("relationship kinds distinguish first encounters from different-day repeat trust", () => {
  assert.equal(relationshipSubsidyKind({
    previousSaleCount: 0,
    currentDateKey: "2026-07-24",
  }), "discovery");
  assert.equal(relationshipSubsidyKind({
    previousSaleCount: 2,
    lastSaleDateKey: "2026-07-23",
    currentDateKey: "2026-07-24",
  }), "trust");
  assert.equal(relationshipSubsidyKind({
    previousSaleCount: 2,
    lastSaleDateKey: "2026-07-24",
    currentDateKey: "2026-07-24",
  }), null);
  assert.equal(relationshipSubsidyKind({
    previousSaleCount: 2,
    lastSaleDateKey: "",
    currentDateKey: "2026-07-24",
  }), null);
});

test("balanced allows discovery and trust while focused policies allow only their relation", () => {
  const discovery = {
    previousSaleCount: 0,
    currentDateKey: "2026-07-24",
  };
  const trust = {
    previousSaleCount: 1,
    lastSaleDateKey: "2026-07-23",
    currentDateKey: "2026-07-24",
  };
  assert.equal(policyAllowsSubsidy({ ...discovery, policyId: "balanced" }), true);
  assert.equal(policyAllowsSubsidy({ ...trust, policyId: "balanced" }), true);
  assert.equal(policyAllowsSubsidy({ ...discovery, policyId: "discovery" }), true);
  assert.equal(policyAllowsSubsidy({ ...trust, policyId: "discovery" }), false);
  assert.equal(policyAllowsSubsidy({ ...trust, policyId: "trust" }), true);
  assert.equal(policyAllowsSubsidy({ ...discovery, policyId: "trust" }), false);
  assert.equal(policyAllowsSubsidy({
    ...trust,
    lastSaleDateKey: "2026-07-24",
    policyId: "balanced",
  }), false);
});

test("same-pair monthly flag and seller monthly cap stop subsidy before settlement", () => {
  const base = {
    actualFee: 25,
    fundRemaining: 100,
    previousSaleCount: 0,
    currentDateKey: "2026-07-24",
  };
  assert.deepEqual(
    patronFundSubsidyDecision({ ...base, pairAlreadySubsidized: true }),
    {
      eligible: false,
      reason: "pair_monthly_limit",
      policyId: "balanced",
      kind: "discovery",
      subsidyAmount: 0,
      feeBurnAmount: 25,
      sellerRemainingCap: 50,
      sellerRemainingCapAfter: 50,
    },
  );
  assert.equal(patronFundSubsidyDecision({
    ...base,
    sellerSubsidized: 49,
  }).subsidyAmount, 1);
  assert.equal(patronFundSubsidyDecision({
    ...base,
    sellerSubsidized: 50,
  }).reason, "seller_monthly_cap");
  assert.equal(patronFundSubsidyDecision({
    ...base,
    sellerRemainingCap: 500,
  }).sellerRemainingCap, 50);
});

test("decision reasons fail closed for wrong policy, same-day repeats, empty funds, and tiny fees", () => {
  const discovery = {
    actualFee: 25,
    fundRemaining: 100,
    previousSaleCount: 0,
    currentDateKey: "2026-07-24",
  };
  assert.equal(patronFundSubsidyDecision({
    ...discovery,
    policyId: "trust",
  }).reason, "policy_ineligible");
  assert.equal(patronFundSubsidyDecision({
    ...discovery,
    previousSaleCount: 1,
    lastSaleDateKey: "2026-07-24",
  }).reason, "relationship_ineligible");
  assert.equal(patronFundSubsidyDecision({
    ...discovery,
    fundRemaining: 0,
  }).reason, "fund_empty");
  const tiny = patronFundSubsidyDecision({
    ...discovery,
    actualFee: 1,
  });
  assert.equal(tiny.reason, "fee_too_small");
  assert.equal(tiny.subsidyAmount, 0);
  assert.equal(tiny.feeBurnAmount, 1);
});

test("fund normalization derives remaining Pay and discards tampered or stale fields", () => {
  assert.deepEqual(normalizePatronFund({
    seasonKey: "2026-07",
    totalContributed: 300,
    totalBurned: 0,
    totalSubsidized: 80,
    fundRemaining: 999_999,
    supportedSaleCount: 7,
    supportedSellerCount: 4,
    activePolicy: "trust",
    updatedAt: 123,
  }, "2026-07"), {
    seasonKey: "2026-07",
    totalContributed: 300,
    totalBurned: 0,
    totalSubsidized: 80,
    fundRemaining: 220,
    supportedSaleCount: 7,
    supportedSellerCount: 4,
    activePolicy: "trust",
    updatedAt: 123,
  });
  assert.equal(normalizePatronFund({
    seasonKey: "2026-07",
    totalContributed: 10,
    totalSubsidized: 1_000,
  }, "2026-07").fundRemaining, 0);
  assert.deepEqual(normalizePatronFund({
    seasonKey: "2026-06",
    totalContributed: 5_000,
    totalSubsidized: 500,
    activePolicy: "trust",
  }, "2026-07"), {
    seasonKey: "2026-07",
    totalContributed: 0,
    totalBurned: 0,
    totalSubsidized: 0,
    fundRemaining: 0,
    supportedSaleCount: 0,
    supportedSellerCount: 0,
    activePolicy: "balanced",
    updatedAt: 0,
  });
});

test("policy normalization accepts only the three declared policy IDs", () => {
  assert.deepEqual(MARKET_POLICY_IDS, ["balanced", "discovery", "trust"]);
  assert.equal(normalizeMarketPolicyId(" TRUST "), "trust");
  assert.equal(normalizeMarketPolicyId({ activePolicy: "discovery" }), "discovery");
  assert.equal(normalizeMarketPolicyId("__proto__"), "balanced");
  assert.equal(normalizePolicyVote("balanced"), "balanced");
  assert.equal(normalizePolicyVote({ policyId: "trust" }), "trust");
  assert.equal(normalizePolicyVote({ vote: "discovery" }), "discovery");
  assert.equal(normalizePolicyVote({ policyId: "invalid" }), null);
});

test("vote tally ignores malformed votes and gives balanced priority in a first-place tie", () => {
  assert.deepEqual(tallyPolicyVotes([
    "balanced",
    { policyId: "discovery" },
    { vote: "trust" },
    "not-a-policy",
    null,
  ]), {
    activePolicy: "balanced",
    totalVotes: 3,
    votes: { balanced: 1, discovery: 1, trust: 1 },
  });
  assert.deepEqual(tallyPolicyVotes({
    voterA: "discovery",
    voterB: { policyId: "discovery" },
    voterC: "trust",
  }), {
    activePolicy: "discovery",
    totalVotes: 3,
    votes: { balanced: 0, discovery: 2, trust: 1 },
  });
  assert.equal(tallyPolicyVotes(["discovery", "trust"]).activePolicy, "discovery");
  assert.equal(tallyPolicyVotes(null).activePolicy, "balanced");
});

test("patron tiers bound recommendation slots to zero through three", () => {
  assert.deepEqual(PATRON_RECOMMENDATION_LIMITS, [0, 1, 2, 3]);
  assert.deepEqual(
    [-1, 0, 1, 2, 3, 99].map(patronRecommendationLimit),
    [0, 0, 1, 2, 3, 3],
  );
  assert.equal(patronRecommendationLimit({ tier: 2 }), 2);
  assert.equal(patronRecommendationLimit({ level: "3" }), 3);
  assert.equal(patronRecommendationLimit({ tier: "malformed" }), 0);
});

test("public fund summaries expose aggregate impact only", () => {
  const summary = publicPatronFundSummary({
    seasonKey: "2026-07",
    totalContributed: 300,
    totalBurned: 0,
    totalSubsidized: 7,
    supportedSaleCount: 1,
    supportedSellerCount: 1,
    activePolicy: "discovery",
    uid: "private-user",
    walletBalance: 9_999,
    votesByUid: { privateVoter: "discovery" },
    sellerUids: ["private-seller"],
  }, "2026-07");
  assert.deepEqual(summary, {
    seasonKey: "2026-07",
    totalContributed: 300,
    totalBurned: 0,
    totalSubsidized: 7,
    fundRemaining: 293,
    supportedSaleCount: 1,
    supportedSellerCount: 1,
    activePolicy: "discovery",
    contributionBasisPoints: 2_000,
    maxSubsidyPerSale: 10,
    monthlySellerCap: 50,
  });
  assert.equal("uid" in summary, false);
  assert.equal("votesByUid" in summary, false);
  assert.equal("sellerUids" in summary, false);
});
