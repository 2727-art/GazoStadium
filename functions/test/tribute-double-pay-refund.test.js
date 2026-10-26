"use strict";

// 請求の二重払いの返金（ranch-double-pay-refund-v1）。ユーザー決定: 運営から財布へ返す（管理人の残高はそのまま）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { applyFirestoreSet } = require("./helpers/firestore-merge.cjs");
const { grantDoublePaymentRefunds, grantIdFor } = require("../scripts/grant-tribute-double-payment-refunds.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const account = read("account.js");
const html = read("index.html");

function fakeFirestore(docs, events) {
  return {
    collection: (name) => ({
      async get() {
        const list = [...docs.keys()].filter((key) => key.startsWith(`${name}/`)).map((key) => ({
          id: key.split("/")[1],
          data: () => structuredClone(docs.get(key)),
          ref: {
            path: key,
            collection: () => ({
              where: (field, operator, value) => ({
                async get() {
                  return { docs: (events[key] || []).filter((event) => event[field] === value).map((event) => ({ data: () => event })) };
                },
              }),
            }),
          },
        }));
        return { size: list.length, docs: list };
      },
      doc: (id) => ({ path: `${name}/${id}` }),
    }),
    async runTransaction(callback) {
      return callback({
        get: async (ref) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
        set: (ref, value, options) => docs.set(ref.path, applyFirestoreSet(docs.get(ref.path), structuredClone(value), options)),
      });
    },
  };
}

test("the grant counts double payments per contract and adds them to the payer's pending operator refund once", async () => {
  const docs = new Map([
    ["tributeContracts/c1", { payerUid: "p1", status: "ended" }],
    ["tributeContracts/c2", { payerUid: "p2", status: "ended" }],
    ["tributeContracts/c3", { payerUid: "p1", status: "active" }],
    ["tributeProfiles/p1", { walletName: "ポチ", operatorRefundPending: 0 }],
    ["tributeProfiles/p2", { walletName: "タマ" }],
  ]);
  const request = (requestId, amount) => ({ type: "tribute", kind: "request", requestId, amount });
  const events = {
    "tributeContracts/c1": [request("a", 30), request("a", 30), request("b", 30), request("b", 30), request("b", 30)],
    "tributeContracts/c2": [request("c", 10), request("c", 10), request("d", 10), request("d", 10), request("d", 10), request("d", 10)],
    "tributeContracts/c3": [request("e", 5), { type: "tribute", kind: "silent", amount: 5 }],
  };
  const firestore = fakeFirestore(docs, events);
  const dry = await grantDoublePaymentRefunds({ firestore, apply: false });
  assert.deepEqual({ grants: dry.grants, wallets: dry.wallets, extra: dry.extraPayments, total: dry.totalPay }, { grants: 2, wallets: 2, extra: 7, total: 130 });
  assert.equal(docs.get("tributeProfiles/p1").operatorRefundPending, 0, "the dry run writes nothing");
  assert.doesNotMatch(JSON.stringify(dry), /p1|p2/, "no UIDs in the report");

  const applied = await grantDoublePaymentRefunds({ firestore, apply: true, now: 5 });
  assert.deepEqual({ granted: applied.granted, pay: applied.grantedPay }, { granted: 2, pay: 130 });
  assert.equal(docs.get("tributeProfiles/p1").operatorRefundPending, 90);
  assert.equal(docs.get("tributeProfiles/p2").operatorRefundPending, 40);
  assert.deepEqual(docs.get("tributeProfiles/p1").operatorRefundGrants[grantIdFor("c1")], { amount: 90, reason: "double_payment", contractId: "c1", grantedAt: 5 });
  assert.equal(docs.get("tributeProfiles/p1").walletName, "ポチ", "other profile fields stay");

  const again = await grantDoublePaymentRefunds({ firestore, apply: true });
  assert.deepEqual({ granted: again.granted, already: again.alreadyGranted }, { granted: 0, already: 2 });
  assert.equal(docs.get("tributeProfiles/p1").operatorRefundPending, 90, "never granted twice");
});

test("the hub explains the operator refund and the wallet history labels it", () => {
  assert.match(client, /運営からの返金 \$\{escapeHtml\(formatPay\(operatorRefund\)\)\}<\/b>：請求を二重に払えてしまう不具合があり、同じ請求に重ねて払われた分をお返しします。/);
  assert.match(client, /const refund = escrowRefund \+ operatorRefund > 0 \?/);
  assert.match(account, /tribute_operator_refund: "お貢ぎ牧場：運営からの返金（請求の二重払い）"/);
  assert.match(account, /if \(key\.includes\("tribute_operator_refund"\)\) return ANJU_PAY_LABELS\.tribute_operator_refund;/);
  for (const name of ["tribute.js", "account.js"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-double-pay-refund-v1(?:-[a-z0-9-]+)?"`), name);
});
