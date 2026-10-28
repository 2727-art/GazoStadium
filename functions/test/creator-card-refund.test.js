"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { planCreatorCardRefund, stageCreatorCardRefund, CREATOR_CARD_REFUND_FIELD: field } = require("../creator-card-refund");
const { activateAnjuPayWallet, nextAnjuPayEntry } = require("../anju-pay-ledger");

function harness(balance, reservedIncoming = 0) {
  const wallet = { balance, reservedIncoming };
  const entries = new Map();
  const transaction = { set(_ref, patch) { Object.assign(wallet, patch); } };
  const run = (grant = false) => stageCreatorCardRefund({ transaction, walletRef: "wallet", wallet, now: 1000,
    grant, configSnapshot: {}, stageOpening(_t, _r, value) {
      const opening = activateAnjuPayWallet(value, 1000); Object.assign(value, opening.walletPatch);
      if (opening.activated) entries.set("opening", opening.openingEntry);
    }, appendEntry(_t, _r, value, _c, entry) {
      const next = nextAnjuPayEntry(value, entry);
      assert.equal(entries.has(next.entryId), false, "ledger entry is never reused");
      entries.set(next.entryId, next.entry); Object.assign(value, next.walletPatch); return next.entry;
    }, metadataPatch: (value) => ({ ledgerVersion: value.ledgerVersion, ledgerSequence: value.ledgerSequence, historyStartedAt: value.historyStartedAt }) });
  return { wallet, entries, run };
}

test("wallet access never grants a refund to a nonbuyer", () => {
  const h = harness(50); assert.equal(h.run(), null); assert.equal(h.wallet.balance, 50); assert.equal(h.entries.size, 0);
});
test("500 Pay grant is idempotent and ledger delta equals credited amount", () => {
  const h = harness(120); assert.equal(h.run(true).credit, 500);
  assert.equal(h.wallet.balance, 620); assert.equal(h.wallet[field].credited, 500);
  for (let i = 0; i < 10; i++) assert.equal(h.run(true), null);
  const refunds = [...h.entries.values()].filter((e) => e.kind === "creator_card_refund");
  assert.equal(refunds.length, 1); assert.equal(refunds[0].delta, 500); assert.equal(refunds[0].balanceAfter - refunds[0].balanceBefore, 500);
});
test("balance cap and reserved incoming retain an exact pending entitlement", () => {
  const h = harness(999_999_899, 50);
  assert.deepEqual([h.run(true).credit, h.wallet[field].credited], [50, 50]);
  assert.equal(h.wallet.balance, 999_999_949); assert.equal(h.run(), null);
  h.wallet.balance -= 300;
  assert.equal(h.run().credit, 300); assert.equal(h.wallet[field].credited, 350);
  h.wallet.balance -= 200;
  assert.equal(h.run().credit, 150); assert.equal(h.wallet[field].credited, 500);
  assert.equal([...h.entries.values()].filter((e) => e.kind === "creator_card_refund").reduce((n, e) => n + e.delta, 0), 500);
});
test("full wallet records the grant once and settles when capacity opens", () => {
  const h = harness(999_999_999); assert.equal(h.run(true).pending, 500); assert.equal(h.entries.size, 0);
  assert.equal(h.run(true), null); h.wallet.balance -= 500; assert.equal(h.run().credit, 500);
});
test("corrupt records fail closed instead of granting another refund", () => {
  for (const credited of [-1, 501, "500", NaN]) assert.throws(() => planCreatorCardRefund({ balance: 0, [field]: { version: 1, amount: 500, credited, claimCount: 1 } }));
  assert.throws(() => planCreatorCardRefund({ balance: 999_999_999, reservedIncoming: 1 }, { grant: true }));
});
