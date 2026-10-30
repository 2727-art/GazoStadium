"use strict";

// 牧場の実績（設計書17）。2026-10-30 のユーザーの決定: 実績名は提案どおり、系統ごとの枠、「数える仕組み・実績一覧への登録に進んでください」。
// 遊び方の型（管理人・財布）とシークレット。額では解除しない。同じ相手とは日本時間の1日1回まで数える。連続日数は作らない。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const achievements = require("../achievements");
const { server } = require("./helpers/tribute-edge-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const index = read("functions/index.js");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const DAY = 86_400_000;

const stats = (h, uid) => h.firestore.read(`tributeAchievementStats/${uid}`) || {};
const unlocked = (h, uid) => Object.keys(h.firestore.read(`achievementProfiles/${uid}`)?.unlocked || {});

async function setup(application = {}, balances = { manager: 500, payer: 20_000 }) {
  const h = server.createHarness({ balances });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowHolds: true, allowOthello: true, allowWorkOrders: true, allowGrazing: true, ...application }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  const request = async (amount = 10) => {
    await act("manager", "request", { amount });
    return Object.keys(h.contract(contractId).pendingRequests).at(-1);
  };
  return { h, contractId, act, request };
}

test("the catalog: the user's names and thresholds, the same on the server, in the browser and in the frames", async () => {
  const core = await loadCore();
  assert.deepEqual(
    core.RANCH_ACHIEVEMENT_FAMILIES.map(({ family, side, icon, label, stat, thresholds, names }) => ({ family, side, icon, label, stat, thresholds: [...thresholds], names: [...names] })),
    achievements.TRIBUTE_STYLE_FAMILIES.map(({ family, side, icon, familyLabel, key, thresholds, names }) => ({ family, side, icon, label: familyLabel, stat: key, thresholds: [...thresholds], names: [...names] })),
  );
  assert.deepEqual(
    core.RANCH_ACHIEVEMENT_SECRETS.map(({ id, side, icon, name, condition }) => ({ id, side, icon, name, description: condition })),
    achievements.TRIBUTE_SECRETS.map(({ id, side, icon, name, description }) => ({ id, side, icon, name, description })),
  );
  const window = { addEventListener() {} };
  vm.runInNewContext(read("achievements.js"), { window, document: {}, console });
  const meta = ({ id, scope, category, family, familyLabel, icon, level, target, name, description, hint, autoPublic, legacy, secret }) => ({ id, scope, category, family, familyLabel, icon, level, target, name, description, hint, autoPublic, legacy, secret: secret === true });
  assert.deepEqual(
    JSON.parse(JSON.stringify([...window.HariaiAchievements.catalog].filter((definition) => definition.scope === "tribute").map(meta))),
    achievements.ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.scope === "tribute").map(meta),
  );
  const definitions = achievements.ACHIEVEMENT_DEFINITIONS.filter((definition) => /^tribute_(mgr|wal|secret)_/.test(definition.family));
  assert.equal(definitions.length, 108 + 7);
  assert.ok(definitions.every((definition) => definition.autoPublic === false), "never shown without the player's choice");
  assert.ok(definitions.filter((definition) => /^tribute_secret_/.test(definition.id)).every((definition) => definition.secret === true && definition.category === "tribute_secret"));
  for (const entry of achievements.TRIBUTE_STYLE_FAMILIES) {
    assert.ok(achievements.TRIBUTE_STAT_KEYS.includes(entry.key), entry.key);
    const top = entry.thresholds.at(-1);
    assert.ok(achievements.eligibleAchievementIds({ tributeStats: { [entry.key]: top }, scope: "tribute" }).includes(`${entry.family}_${top}`), entry.family);
  }
  assert.ok(!achievements.TRIBUTE_STAT_KEYS.some((key) => /streak|amount|pay|total/i.test(key) && key !== "walServedTop"), "no streaks and no amounts");
});

test("requests: paid, resisted, three resists and paid while ignored, once per pair per Japan day on both sides", async () => {
  const { h, contractId, act, request } = await setup();
  const first = await request(10);
  for (const text of ["えー", "やだ", "ほんとに？"]) await act("payer", "resist", { requestId: first, text });
  await act("payer", "message", { text: "払います…" });
  await act("manager", "mark_read", { seq: h.contract(contractId).eventSeq });
  assert.ok(h.contract(contractId).ignoredSince > 0);
  assert.equal(stats(h, "manager").mgrIgnore, 1, "reading a wallet's message without answering counts as 既読無視");
  const paid = await act("payer", "tribute", { kind: "request", requestId: first, amount: 10, clientRequestId: server.nextRequestId() });
  assert.deepEqual(
    { walRequestPaid: stats(h, "payer").walRequestPaid, walResist: stats(h, "payer").walResist, secretResist3: stats(h, "payer").secretResist3 },
    { walRequestPaid: 1, walResist: 1, secretResist3: 1 },
  );
  assert.deepEqual(
    { mgrRequestPaid: stats(h, "manager").mgrRequestPaid, mgrBreak: stats(h, "manager").mgrBreak, secretIgnoredPaid: stats(h, "manager").secretIgnoredPaid },
    { mgrRequestPaid: 1, mgrBreak: 1, secretIgnoredPaid: 1 },
  );
  for (const id of ["tribute_wal_request_1", "tribute_wal_resist_1", "tribute_secret_resist3"]) assert.ok(paid.newlyUnlocked.includes(id), id);
  for (const id of ["tribute_mgr_request_1", "tribute_mgr_break_1", "tribute_mgr_ignore_1", "tribute_secret_ignored_paid"]) assert.ok(unlocked(h, "manager").includes(id), id);

  // 同じ日のもう1件（額が違っても）は数えない。次の日はまた数える。
  const second = await request(100);
  await act("payer", "tribute", { kind: "request", requestId: second, amount: 100, clientRequestId: server.nextRequestId() });
  assert.equal(stats(h, "payer").walRequestPaid, 1);
  assert.equal(stats(h, "manager").mgrRequestPaid, 1);
  h.advance(DAY);
  const third = await request(1);
  await act("payer", "tribute", { kind: "request", requestId: third, amount: 1, clientRequestId: server.nextRequestId() });
  assert.equal(stats(h, "payer").walRequestPaid, 2);
  assert.equal(stats(h, "manager").mgrRequestPaid, 2);
  assert.equal(stats(h, "payer").walResist, 1, "no resist this time");
  const pairKey = h.firestore.keys("tributePairs/")[0];
  assert.equal(h.firestore.read(pairKey).achievementDays["payer:walRequestPaid"], h.contract(contractId).todayKey);
});

test("holds and pleas: granted and denied on both sides, 二度目の願い出 within the same hold, 気分次第 on one day", async () => {
  const { h, act } = await setup();
  await act("manager", "hold", { note: "待て" });
  await act("payer", "plea", { amount: 30 });
  const denied = await act("manager", "plea_deny", { note: "まだ早い" });
  assert.ok(denied.newlyUnlocked.includes("tribute_mgr_deny_1"));
  assert.equal(stats(h, "payer").walDenied, 1);
  await act("payer", "plea", { amount: 40 });
  const granted = await act("manager", "plea_grant", { note: "いいよ" });
  assert.ok(granted.newlyUnlocked.includes("tribute_mgr_grant_1"));
  assert.ok(granted.newlyUnlocked.includes("tribute_secret_mood"), "granted and denied on the same Japan day");
  assert.deepEqual({ walGranted: stats(h, "payer").walGranted, secretSecondPlea: stats(h, "payer").secretSecondPlea }, { walGranted: 1, secretSecondPlea: 1 });
  assert.ok(unlocked(h, "payer").includes("tribute_secret_second_plea"));
  assert.ok(unlocked(h, "payer").includes("tribute_wal_granted_1") && unlocked(h, "payer").includes("tribute_wal_denied_1"));
});

test("a grant on another day is not 気分次第, and a new hold starts 二度目の願い出 over", async () => {
  const { h, act } = await setup();
  await act("manager", "hold");
  await act("payer", "plea", { amount: 30 });
  await act("manager", "plea_deny");
  await act("manager", "unhold");
  h.advance(DAY);
  await act("manager", "hold");
  await act("payer", "plea", { amount: 30 });
  await act("manager", "plea_grant");
  assert.equal(stats(h, "manager").secretMood || 0, 0);
  assert.equal(stats(h, "payer").secretSecondPlea || 0, 0);
});

test("recite, work, words, silent days, othello and both on one day count on the right side", async () => {
  const { h, contractId, act } = await setup();
  h.setRecord("payer", 10, 2);
  await act("manager", "recite_order", { text: "私は財布です。", target: 1 });
  await act("payer", "recite", { text: "私は財布です。" });
  await act("manager", "recite_confirm");
  assert.deepEqual([stats(h, "manager").mgrRecite, stats(h, "payer").walRecite], [1, 1]);
  await act("manager", "work_order", { target: 1 });
  h.setRecord("payer", 11, 2);
  await act("payer", "work_report");
  await act("manager", "work_confirm");
  assert.deepEqual([stats(h, "manager").mgrWork, stats(h, "payer").walWork], [1, 1]);

  const words = await act("payer", "offer_words", { text: "今日も見ていてください。" });
  assert.ok(words.newlyUnlocked.includes("tribute_wal_words_1"));
  assert.equal(stats(h, "payer").secretBoth || 0, 0, "no tribute yet today");
  const silent = await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  assert.ok(silent.newlyUnlocked.includes("tribute_wal_silent_1"));
  assert.ok(silent.newlyUnlocked.includes("tribute_secret_both"), "a tribute on a day with words");
  await act("payer", "tribute", { kind: "silent", amount: 20, clientRequestId: server.nextRequestId() });
  assert.equal(stats(h, "payer").walSilentDays, 1, "one silent day however many tributes");

  await act("manager", "othello_start", { rate: 1 });
  await act("payer", "othello_resign");
  assert.equal(stats(h, "manager").mgrOthello, 1, "the manager won");
  const penalty = h.contract(contractId).othelloResult.penalty;
  await act("payer", "tribute", { kind: "othello", amount: penalty, clientRequestId: server.nextRequestId() });
  assert.equal(stats(h, "payer").walOthelloLost, 1);
  assert.equal(stats(h, "payer").walSilentDays, 1, "a penalty is not a silent tribute");
});

test("pats, moo lines, ranch names, collars, the ranch level and the longest service", async () => {
  const { h, contractId, act } = await setup();
  assert.equal(stats(h, "manager").mgrCollar, 1, "the first collar at acceptance");
  assert.ok(unlocked(h, "manager").includes("tribute_mgr_collar_1"));
  const patted = await act("manager", "ranch_pat");
  assert.ok(patted.newlyUnlocked.includes("tribute_mgr_pat_1"));
  assert.ok(unlocked(h, "payer").includes("tribute_wal_patted_1"));
  const moo = await act("payer", "set_moo", { lines: ["もー"] });
  assert.ok(moo.newlyUnlocked.includes("tribute_secret_moo"));
  const named = await h.act("manager", "set_ranch_name", { name: "ひだまり" });
  assert.deepEqual(named.newlyUnlocked, ["tribute_secret_named"]);
  assert.equal((await h.act("manager", "set_ranch_name", { name: "そよかぜ" })).newlyUnlocked, undefined, "only once");

  // 牧場レベルが5に上がった時と、仕えた日が7日になった時。
  const profileKey = h.firestore.keys("tributeProfiles/").find((key) => key.endsWith("/manager"));
  h.firestore.write(profileKey, { ...h.firestore.read(profileKey), ranchXp: 198 });
  const pairKey = h.firestore.keys("tributePairs/")[0];
  h.firestore.write(pairKey, { ...h.firestore.read(pairKey), servedTotal: 6 });
  h.advance(DAY);
  await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  assert.equal(stats(h, "manager").mgrRanchLevel, 5);
  assert.ok(unlocked(h, "manager").includes("tribute_mgr_ranch_5"));
  assert.equal(stats(h, "payer").walServedTop, 7);
  assert.ok(unlocked(h, "payer").includes("tribute_wal_fondness_7"));
  assert.equal(h.contract(contractId).servedTotal, 7);
});

test("records made before this release are counted once from the ledger; the rest start now", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  await server.openManager(h, "manager", { entryFee: 0 });
  const profileKey = h.firestore.keys("tributeProfiles/").find((key) => key.endsWith("/manager"));
  h.firestore.write(profileKey, { ...h.firestore.read(profileKey), collarCount: 4, ranchXp: 1_400 });
  h.firestore.write("tributePairs/manager__p1", { managerUid: "manager", payerUid: "p1", count: 3, firstAt: h.now() - 5 * DAY, lastAt: h.now() - DAY, patDays: 2, othelloRecord: { played: 3, lost: 2, won: 1, drawn: 0, streak: 0 } });
  h.firestore.write("tributePairs/manager__p2", { managerUid: "manager", payerUid: "p2", count: 1, firstAt: h.now() - DAY, lastAt: h.now() - DAY, patDays: 1 });
  // 版1で数え直し済み（献上の日だけ）の記録。
  h.firestore.write("tributeAchievementStats/manager", { historyBackfilled: true, managerPairDays: 9, walletPairDays: 0 });
  const first = await h.act("manager", "state");
  const counted = first.achievements.stats;
  assert.deepEqual(
    { managerPairDays: counted.managerPairDays, mgrCollar: counted.mgrCollar, mgrRanchLevel: counted.mgrRanchLevel, mgrPatDays: counted.mgrPatDays, mgrOthello: counted.mgrOthello, mgrRequestPaid: counted.mgrRequestPaid },
    { managerPairDays: 9, mgrCollar: 4, mgrRanchLevel: 10, mgrPatDays: 3, mgrOthello: 2, mgrRequestPaid: 0 },
    "the earlier tribute days are kept; collars, level, pats and othello wins come from the ledger; requests start now",
  );
  for (const id of ["tribute_mgr_collar_3", "tribute_mgr_ranch_10", "tribute_mgr_pat_1", "tribute_mgr_othello_1"]) assert.ok(first.achievements.newlyUnlocked.includes(id), id);
  assert.equal(h.firestore.read("tributeAchievementStats/manager").historyVersion, 2);
  h.firestore.write("tributePairs/manager__p3", { managerUid: "manager", payerUid: "p3", count: 1, firstAt: h.now(), lastAt: h.now(), patDays: 9 });
  const again = await h.act("manager", "state");
  assert.equal(again.achievements.stats.mgrPatDays, 3, "the ledger is read only once");
});

test("the server stages every count before writing, and the browser announces unlocks from any ranch action", () => {
  assert.match(service, /result = spec\.write\(ctx, extra\);\n        await stageAchievements\(transaction, ctx, extra\);\n      \}\n      flush\(ctx\);/);
  assert.match(service, /if \(ctx\.contract\.status !== "active"\) return;\n    const days = object\(ctx\.pair\.value\.achievementDays\);/, "counted only in active contracts, once per pair and day");
  assert.match(service, /if \(next > previous && ignoreStart\(contract, role, next, now\)\.ignoredSince\) return null;/, "the start of 既読無視 takes the full path so it can be counted");
  assert.match(index, /if \(deferTributeBackfill && !tributeService\.achievementStatsReady\(tributeStatsSnapshot\)\) return null;/);
  assert.match(client, /if \(Array\.isArray\(result\?\.newlyUnlocked\) && result\.newlyUnlocked\.length\) \{\n      notifyAchievementUnlocks\(result\.newlyUnlocked\);\n      result\.newlyUnlocked = \[\];\n    \}\n    if \(after\) after\(result\);/);
  assert.match(client, /notifyAchievementUnlocks\(result\?\.newlyUnlocked\);\n      \/\/ 旧サーバーの/, "the read marker announces 既読無視");
  const panel = client.slice(client.indexOf("function renderAchievementPanel() {"), client.indexOf("// 牧場のカードに出す実績（3つまで）。"));
  assert.match(panel, /\.\.\.RANCH_ACHIEVEMENT_FAMILIES,/);
  assert.match(panel, /<b>？？？<\/b>/, "undiscovered secrets keep their names and conditions hidden");
  assert.match(panel, /block\("manager", "管理人の型"/);
  assert.match(panel, /block\("wallet", "財布の型"/);
});

test("cache keys, the release script and the design record", () => {
  const html = read("index.html");
  for (const name of ["tribute.css", "tribute.js", "achievements.js"]) assert.ok(new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-achievements-v1(?:-[a-z0-9-]+)?"`).test(html), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-achievements-v1(?:-[a-z0-9-]+)?"/);
  const design = read("TRIBUTE_DESIGN.md");
  assert.match(design, /## 17\. 牧場の実績（遊び方の型とシークレット、2026年10月）/);
  assert.match(design, /\*\*Functions はすべて公開する\*\*/, "the shared catalog must reach every function");
  assert.ok(fs.existsSync(path.join(root, "functions/scripts/verify-tribute-ranch-achievements-release.cjs")));
});
