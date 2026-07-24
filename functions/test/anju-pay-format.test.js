const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const formatterUrl = pathToFileURL(
  path.resolve(__dirname, "..", "..", "anju-pay-format.mjs"),
).href;

test("AnjuPay formatter uses Pay with stable spacing and Japanese grouping", async () => {
  const {
    ANJU_PAY_UNIT,
    formatAnjuPay,
    formatAnjuPayNumber,
  } = await import(formatterUrl);

  assert.equal(ANJU_PAY_UNIT, "Pay");
  assert.equal(formatAnjuPay(6_400), "6,400 Pay");
  assert.equal(formatAnjuPay(40, { sign: true }), "+40 Pay");
  assert.equal(formatAnjuPay(-5, { sign: true }), "-5 Pay");
  assert.equal(formatAnjuPay(null), "-- Pay");
  assert.equal(formatAnjuPayNumber(2_500), "2,500");
});
