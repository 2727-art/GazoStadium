"use strict";

const MARKET_SUCCESS_FEE_BASIS_POINTS = 500;
const POST_MATCH_TIP_AMOUNTS = Object.freeze([5, 10, 20]);

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : 0;
}

function marketSaleSettlement(value) {
  const grossAmount = integer(value);
  if (grossAmount < 1) {
    throw new RangeError("Sale price must be a positive integer.");
  }
  const feeAmount = Math.max(
    1,
    Math.ceil((grossAmount * MARKET_SUCCESS_FEE_BASIS_POINTS) / 10_000),
  );
  return Object.freeze({
    grossAmount,
    feeAmount,
    sellerProceeds: grossAmount - feeAmount,
  });
}

function postMatchTipAmount(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return 0;
  const amount = numeric;
  return POST_MATCH_TIP_AMOUNTS.includes(amount) ? amount : 0;
}

module.exports = Object.freeze({
  MARKET_SUCCESS_FEE_BASIS_POINTS,
  POST_MATCH_TIP_AMOUNTS,
  marketSaleSettlement,
  postMatchTipAmount,
});
