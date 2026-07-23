const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MARKET_SUCCESS_FEE_BASIS_POINTS,
  POST_MATCH_TIP_AMOUNTS,
  marketSaleSettlement,
  postMatchTipAmount,
} = require("../market-economy");

test("market fee is 5 percent rounded up with a 1 PT minimum", () => {
  assert.equal(MARKET_SUCCESS_FEE_BASIS_POINTS, 500);
  assert.deepEqual(marketSaleSettlement(10), {
    grossAmount: 10,
    feeAmount: 1,
    sellerProceeds: 9,
  });
  assert.deepEqual(marketSaleSettlement(25), {
    grossAmount: 25,
    feeAmount: 2,
    sellerProceeds: 23,
  });
  assert.deepEqual(marketSaleSettlement(50), {
    grossAmount: 50,
    feeAmount: 3,
    sellerProceeds: 47,
  });
  assert.deepEqual(marketSaleSettlement(100), {
    grossAmount: 100,
    feeAmount: 5,
    sellerProceeds: 95,
  });
  assert.deepEqual(marketSaleSettlement(200), {
    grossAmount: 200,
    feeAmount: 10,
    sellerProceeds: 190,
  });
  assert.deepEqual(marketSaleSettlement(300), {
    grossAmount: 300,
    feeAmount: 15,
    sellerProceeds: 285,
  });
  assert.deepEqual(marketSaleSettlement(500), {
    grossAmount: 500,
    feeAmount: 25,
    sellerProceeds: 475,
  });
});

test("market settlement rejects non-positive sale prices", () => {
  assert.throws(() => marketSaleSettlement(0), RangeError);
  assert.throws(() => marketSaleSettlement(-10), RangeError);
});

test("post-match tips accept only the fixed non-inflationary amounts", () => {
  assert.deepEqual(POST_MATCH_TIP_AMOUNTS, [5, 10, 20]);
  assert.equal(postMatchTipAmount(5), 5);
  assert.equal(postMatchTipAmount("10"), 10);
  assert.equal(postMatchTipAmount(20.9), 0);
  assert.equal(postMatchTipAmount(6), 0);
  assert.equal(postMatchTipAmount(100), 0);
});
