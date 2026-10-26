"use strict";

// 2026-10-26 の先回り検証で見つかった不具合の修正（ranch-request-fix-v1）。
// - 払った・取り消した請求が pendingRequests に残り、同じ請求を二度払えた（契約の書き込みを mergeFields に）。
// - 申し込み画面に、管理人の宣言（未払いは既読無視・スクショを載せる）と「高額請求」が出ていなかった。
// - 財布が許可を外しても、管理人のスクショ表示が続いた。描き直すと打ちかけのメッセージが消えた。
// - やりとりの切り抜き画像に、判定を通らない請求の一言（連絡先など）が入り得た。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { applyFirestoreSet } = require("./helpers/firestore-merge.cjs");
const { closedRequests, parseArguments, repairPendingRequests } = require("../scripts/repair-tribute-pending-requests.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the test double merges like real Firestore: merge deep-merges maps, mergeFields replaces whole fields", () => {
  const stored = { pendingRequests: { a: { amount: 1 }, b: { amount: 2 } }, eventSeq: 3 };
  assert.deepEqual(applyFirestoreSet(stored, { pendingRequests: { b: { amount: 2 } } }, { merge: true }).pendingRequests, { a: { amount: 1 }, b: { amount: 2 } }, "a removed key survives merge: true");
  assert.deepEqual(applyFirestoreSet(stored, { pendingRequests: { b: { amount: 2 } }, eventSeq: 4 }, { mergeFields: ["pendingRequests", "eventSeq"] }), { pendingRequests: { b: { amount: 2 } }, eventSeq: 4 });
  assert.deepEqual(applyFirestoreSet(stored, { eventSeq: 5 }), { eventSeq: 5 });
});

test("the contract write replaces each written field so removed request keys really go away", () => {
  const flush = sourceBlock(service, "function flush(ctx)", "function touchedWallets");
  assert.match(flush, /transaction\.set\(ctx\.contractRef, contractWrite, \{ mergeFields: Object\.keys\(contractWrite\) \}\);/);
  assert.doesNotMatch(flush, /transaction\.set\(ctx\.contractRef, \{[\s\S]*?\}, \{ merge: true \}\);/);
});

test("the apply screen keeps the manager's declarations and the high-request tag", () => {
  const open = sourceBlock(client, 'case "open-apply": {', 'state.screen = "apply";');
  for (const field of ["ignoreUnpaid", "postsScreenshots", "highRequest"]) assert.match(open, new RegExp(`${field}: card\\.${field} === true,`), field);
});

test("the screenshot view ends when consent goes away, and redraws keep the typed draft", () => {
  const update = sourceBlock(client, "function updateThreadParts", "const head = document.querySelector(\"#tributeThreadHead\");");
  assert.match(update, /if \(state\.thread\.shot && view && !canShowShot\(view\)\) \{\s*state\.thread\.shot = false;\s*renderKeepingDraft\(\);/);
  const keep = sourceBlock(client, "function renderKeepingDraft", "// スクショ表示。");
  assert.match(keep, /const draft = document\.querySelector\('\[data-form="message"\] textarea'\)\?\.value \|\| "";\s*render\(\);/);
  assert.match(sourceBlock(client, 'case "shot-on":', 'case "set-screenshots": {'), /state\.thread\.shot = true;\s*renderKeepingDraft\(\);[\s\S]*?state\.thread\.shot = false;\s*renderKeepingDraft\(\);/);
  assert.match(sourceBlock(client, 'case "nickname": {\n      const nickname', 'case "caps": {'), /closeSheet\(\);\s*renderKeepingDraft\(\);/);
});

test("request notes reach the excerpt image only when the manager allows it and the note passes the card filter", () => {
  assert.match(client, /note: info\.consent && !forbiddenReason\(String\(request\.note \|\| ""\)\) \? String\(request\.note \|\| ""\) : "",/);
});

test("the repair script finds paid, cancelled and declined requests and double payments", () => {
  const events = [
    { type: "tribute", kind: "request", requestId: "a", amount: 20 },
    { type: "tribute", kind: "request", requestId: "b", amount: 5 },
    { type: "tribute", kind: "request", requestId: "b", amount: 5 },
    { type: "tribute", kind: "silent", amount: 30 },
    { type: "request_cancelled", requestId: "c" },
    { type: "request_declined", requestId: "d" },
    { type: "message", requestId: "e" },
  ];
  const { closed, duplicates } = closedRequests(events);
  assert.deepEqual([...closed].sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(duplicates, [{ requestId: "b", payments: 2, extraPay: 5 }]);
  assert.deepEqual(parseArguments(["--project", "gazostadium", "--apply"]), { project: "gazostadium", apply: true });
  assert.throws(() => parseArguments(["--project", "demo"]), /gazostadium/);
});

test("the repair dry run only counts; --apply removes stale keys without touching updatedAt", async () => {
  const docs = new Map([
    ["tributeContracts/one", { status: "active", updatedAt: 7, pendingRequests: { a: { amount: 20 }, keep: { amount: 50 } } }],
    ["tributeContracts/two", { status: "ended", pendingRequests: { z: { amount: 9 } } }],
  ]);
  const events = {
    "tributeContracts/one": [{ type: "tribute", kind: "request", requestId: "a", amount: 20 }],
    "tributeContracts/two": [{ type: "tribute", kind: "request", requestId: "z", amount: 9 }, { type: "tribute", kind: "request", requestId: "z", amount: 9 }],
  };
  const snapshot = (refPath) => ({ data: () => structuredClone(docs.get(refPath)) });
  const firestore = {
    collection: () => ({
      async get() {
        const list = [...docs.keys()].map((refPath) => ({
          id: refPath.split("/")[1],
          data: () => structuredClone(docs.get(refPath)),
          ref: {
            path: refPath,
            collection: () => ({
              where: (field, operator, value) => ({
                async get() {
                  const match = (event) => (operator === "in" ? value.includes(event[field]) : event[field] === value);
                  return { docs: (events[refPath] || []).filter(match).map((event) => ({ data: () => event })) };
                },
              }),
            }),
          },
        }));
        return { size: list.length, docs: list };
      },
    }),
    async runTransaction(callback) {
      return callback({
        get: async (ref) => snapshot(ref.path),
        update: (ref, value) => docs.set(ref.path, applyFirestoreSet(docs.get(ref.path), value, { mergeFields: Object.keys(value) })),
      });
    },
  };
  const dry = await repairPendingRequests({ firestore, apply: false });
  assert.equal(dry.staleRequests, 1);
  assert.equal(dry.duplicatePayments, 1);
  assert.equal(dry.duplicateExtraPay, 9);
  assert.deepEqual(Object.keys(docs.get("tributeContracts/one").pendingRequests).sort(), ["a", "keep"], "the dry run writes nothing");
  const applied = await repairPendingRequests({ firestore, apply: true });
  assert.equal(applied.removedRequests, 1);
  assert.deepEqual(Object.keys(docs.get("tributeContracts/one").pendingRequests), ["keep"]);
  assert.equal(docs.get("tributeContracts/one").updatedAt, 7);
  assert.deepEqual(Object.keys(docs.get("tributeContracts/two").pendingRequests), ["z"], "ended contracts are left alone");
});
