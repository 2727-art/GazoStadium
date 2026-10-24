"use strict";

// 金庫の設計に使う分布の集計（読み取り専用のスクリプト）。UID を出さず、人数と金額だけを返す。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { summarize, parseArguments } = require("../scripts/report-tribute-vault-distribution.cjs");

test("the vault report counts balances and manager track records without exposing UIDs", () => {
  const balances = new Map([["m1", 30_000], ["m2", 1_200], ["m3", 0], ["p1", 50_000], ["p2", 10]]);
  const profiles = [
    { uid: "m1", hasCard: true, accepting: true },
    { uid: "m2", hasCard: true, accepting: false },
    { uid: "m3", hasCard: true, accepting: true },
    { uid: "p1", hasCard: false, accepting: false },
  ];
  const pairs = [
    ...["p1", "p2", "p3"].map((payer) => ({ managerUid: "m1", payerUid: payer, total: 500, count: 3 })),
    { managerUid: "m2", total: 40, count: 1 },
    { managerUid: "m3", total: 0, count: 0 },
  ];
  const summary = summarize({ balances, profiles, pairs });
  assert.equal(summary.allWallets.count, 5);
  assert.equal(summary.allWallets.max, 50_000);
  assert.deepEqual(summary.nonManagerWallets.top10, [50_000, 10]);
  assert.equal(summary.managers.cards, 3);
  assert.equal(summary.managers.accepting, 2);
  assert.deepEqual(summary.managers.balance.top10, [30_000, 1_200, 0]);
  assert.equal(summary.managers.balance.buckets["30,000-99,999"], 1);
  assert.deepEqual(summary.managers.lifetimePayers, { 0: 1, 1: 1, 2: 0, "3-4": 1, "5-9": 0, "10+": 0 });
  const rule = (id) => summary.qualification.find((entry) => entry.id === id);
  assert.equal(rule("any_tribute").managers, 2);
  assert.equal(rule("payers3").managers, 1);
  assert.equal(rule("payers3_received1000").managers, 1);
  assert.equal(rule("payers5_received3000").managers, 0);
  assert.doesNotMatch(JSON.stringify(summary), /"m1"|"m2"|"p1"/, "no UID leaves the report");
});

test("the vault report only reads, needs the production project and refuses emulators", () => {
  assert.throws(() => parseArguments([]), /--project gazostadium is required/);
  assert.throws(() => parseArguments(["--project", "gazostadium", "--apply"]), /Unsupported option/);
  const source = fs.readFileSync(path.join(__dirname, "../scripts/report-tribute-vault-distribution.cjs"), "utf8");
  // 集計用の Map の set だけは書き込みではない。
  assert.doesNotMatch(source.replace(/byManager\.set\(/g, ""), /\.(set|update|create|delete)\(|runTransaction|batch\(/, "the report never writes");
  assert.match(source, /FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /\.select\("balance"\)/);
});
