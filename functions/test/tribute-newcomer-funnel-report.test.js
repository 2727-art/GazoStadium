"use strict";

// 新規の立ち去りを数えるスクリプト（読み取りのみ）の集計。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { summarize, parseArguments } = require("../scripts/report-tribute-newcomer-funnel.cjs");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-27T00:00:00+09:00");

test("the funnel counts how far age-checked newcomers got, without UIDs", () => {
  const profiles = [
    { uid: "u_idle_91", ageConfirmedAt: NOW - 2 * DAY, hasCard: false, accepting: false, entryFee: 0 },
    { uid: "u_mgr_92", ageConfirmedAt: NOW - 3 * DAY, hasCard: true, accepting: true, entryFee: 30 },
    { uid: "u_stall_93", ageConfirmedAt: NOW - 5 * DAY, hasCard: false, accepting: false, entryFee: 0 },
    { uid: "u_pay_94", ageConfirmedAt: NOW - 10 * DAY, hasCard: false, accepting: false, entryFee: 0 },
    { uid: "u_old_95", ageConfirmedAt: NOW - 60 * DAY, hasCard: false, accepting: false, entryFee: 0 },
    { uid: "u_never_96", ageConfirmedAt: 0, hasCard: false, accepting: false, entryFee: 0 },
  ];
  const contracts = [
    { payerUid: "u_stall_93", managerUid: "u_mgr_92", status: "ended", createdAt: NOW - 5 * DAY + 1000, acceptedAt: 0, tributeCount: 0, endReason: "application_expired", entryFee: 30 },
    { payerUid: "u_pay_94", managerUid: "u_mgr_92", status: "active", createdAt: NOW - 10 * DAY + 2 * 3_600_000, acceptedAt: NOW - 9 * DAY, tributeCount: 3, endReason: "", entryFee: 0 },
    { payerUid: "u_old_95", managerUid: "u_mgr_92", status: "ended", createdAt: NOW - 59 * DAY, acceptedAt: NOW - 59 * DAY, tributeCount: 0, endReason: "terminated", entryFee: 0 },
  ];
  const balances = new Map([["u_idle_91", 0], ["u_stall_93", 10], ["u_pay_94", 500], ["u_old_95", 0]]);
  const summary = summarize({ profiles, contracts, balances, now: NOW, days: 30 });
  assert.equal(summary.recent.ageConfirmed, 4, "only age checks within 30 days");
  assert.deepEqual(summary.recent.funnel.appliedAsWallet, { count: 2, percent: 50 });
  assert.deepEqual(summary.recent.funnel.acceptedAsWallet, { count: 1, percent: 25 });
  assert.deepEqual(summary.recent.funnel.tributedAtLeastOnce, { count: 1, percent: 25 });
  assert.deepEqual(summary.recent.idleAfterAgeCheck, { count: 1, percent: 25, walletNow: { "0": 1 } });
  assert.deepEqual(summary.recent.appliedNeverAccepted.applicationOutcomes, { application_expired: 1 });
  assert.deepEqual(summary.recent.appliedNeverAccepted.entryFeeOfManagers, { "fee 1-30": 1 });
  assert.deepEqual(summary.recent.firstApplyAfterAgeCheck, { within1Hour: 1, within1Day: 1, later: 0 });
  assert.equal(summary.allTime.ageConfirmed, 5);
  assert.deepEqual(summary.allTime.acceptedNeverTributed, { count: 1, walletNow: { "0": 1 } });
  assert.deepEqual(summary.applicationsByEntryFee["fee 0"], { applications: 2, accepted: 2, acceptedPercent: 100 });
  assert.deepEqual(summary.applicationsByEntryFee["fee 1-30"], { applications: 1, accepted: 0, acceptedPercent: 0 });
  assert.deepEqual(summary.acceptingManagersByEntryFee, { "fee 1-30": 1 });
  assert.doesNotMatch(JSON.stringify(summary), /u_[a-z]+_9\d/, "no UIDs in the report");
  assert.deepEqual(parseArguments(["--project", "gazostadium", "--days", "14"]), { project: "gazostadium", days: 14 });
  assert.throws(() => parseArguments(["--project", "gazostadium", "--days", "0"]), /1-365/);
});

test("the funnel script only reads", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/report-tribute-newcomer-funnel.cjs"), "utf8");
  // Firestore への書き込み（set/update/create/delete・transaction・batch）を持たない。Map の set だけは使う。
  assert.doesNotMatch(source, /\.(update|create|delete|add)\(|runTransaction|\.batch\(/);
  assert.deepEqual([...source.matchAll(/(\w+)\.set\(/g)].map((match) => match[1]).filter((name) => !["contractsByPayer", "balances"].includes(name)), []);
  assert.match(source, /This production command does not accept emulator overrides\./);
});
