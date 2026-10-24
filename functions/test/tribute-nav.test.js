"use strict";

// お貢ぎ牧場の導線（ranch-nav-v1）: トップの近道・牧場を直接開くURL・契約の画面の並び・やること・スレッドの「次へ」。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const app = read("app.js");
const client = read("tribute.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

function appFn(name) {
  const start = new RegExp(`^  function ${name}\\(`, "m").exec(app);
  assert.ok(start, name);
  const body = app.slice(start.index);
  const end = /\n  \}\n/.exec(body);
  return body.slice(0, end.index + 4);
}

function renderLanding(storage) {
  const context = vm.createContext({
    window: { HariaiOnline: { getLobbyStats: () => ({}) }, ...(storage ? { localStorage: storage } : {}) },
    escapeHtml: String,
    renderLandingTopMessagePanel: () => "",
  });
  vm.runInContext(appFn("renderLanding"), context);
  return context.renderLanding();
}

const row = (id, extra) => ({ contractId: id, role: "manager", status: "active", unread: 0, awaitingReceipt: 0, pendingRequests: [], escrowWithdrawRequest: null, reportRequested: false, ...extra });

test("やること counts each kind across open contracts and points at the first contract of that kind", async () => {
  const core = await loadCore();
  const contracts = [
    row("a", { unread: 2, awaitingReceipt: 1 }),
    row("b", { status: "pending" }),
    row("c", { role: "payer", pendingRequests: [{ requestId: "r1" }, { requestId: "r2" }], reportRequested: true }),
    row("d", { unread: 3 }),
    row("e", { status: "ended", unread: 9, awaitingReceipt: 4 }),
    row("f", { escrowWithdrawRequest: { amount: 50, requestedAt: 1 } }),
    row("g", { role: "payer", status: "pending" }),
  ];
  assert.deepEqual(core.contractTodos(contracts), [
    { kind: "applied", label: "申し込み", total: 1, contractId: "b" },
    { kind: "unpaid", label: "未払いの請求", total: 2, contractId: "c" },
    { kind: "awaiting", label: "受け取り待ち", total: 1, contractId: "a" },
    { kind: "withdraw", label: "使用許可の申請", total: 1, contractId: "f" },
    { kind: "report", label: "残高報告の依頼", total: 1, contractId: "c" },
    { kind: "unread", label: "未読", total: 5, contractId: "a" },
  ]);
  assert.deepEqual(core.contractTodos([row("x"), row("y", { status: "ended", unread: 3 })]), [], "nothing to do; ended contracts never count");
  // 財布の申し込み（受理待ち）は、財布のやることではない。管理人の請求は、管理人のやることではない。
  assert.deepEqual(core.contractTodos([row("p", { role: "payer", status: "pending" }), row("m", { pendingRequests: [{ requestId: "r" }] })]), []);
});

test("「次へ」 walks the list order after the open contract, wraps around, and skips contracts with nothing to do", async () => {
  const core = await loadCore();
  const contracts = [row("a", { unread: 1 }), row("b"), row("c", { status: "pending" }), row("d", { status: "ended", unread: 5 }), row("e", { awaitingReceipt: 2 })];
  const next = (current) => core.nextTodoContract(contracts, current);
  assert.deepEqual([next("a").contract.contractId, next("a").kind], ["c", "applied"]);
  assert.deepEqual([next("c").contract.contractId, next("c").label, next("c").count], ["e", "受け取り待ち", 2]);
  assert.equal(next("e").contract.contractId, "a", "wraps to the top of the list");
  assert.equal(next("b").contract.contractId, "c");
  assert.equal(core.nextTodoContract([row("a", { unread: 1 })], "a"), null, "the open contract itself is never next");
  assert.equal(core.nextTodoContract(contracts, "missing").contract.contractId, "a", "an unknown thread starts from the top");
});

test("the direct-open URL keeps only ?open=ranch and is recognized on load", async () => {
  const core = await loadCore();
  assert.equal(core.ranchOpenUrl("https://gazostadium.web.app/?releaseCheck=1#x"), "https://gazostadium.web.app/?open=ranch");
  assert.equal(core.wantsRanchOpen("https://hariaistadium.com/?open=ranch"), true);
  assert.equal(core.wantsRanchOpen("https://hariaistadium.com/?open=battle"), false);
  assert.equal(core.wantsRanchOpen("not a url"), false);
  // 開いている場所のURLにする（正規のURLに寄せると、別の匿名アカウントになって契約が見えない）。
  assert.match(sourceBlock(client, "function ranchOpenUrlHere", "function renderOpenLink"), /ranchOpenUrl\(`\$\{window\.location\.origin\}\$\{window\.location\.pathname\}`\)/);
  assert.match(client, /else if \(wantsRanchOpen\(window\.location\.href\)\) start\(\{ initialScreen: "hub" \}\);/);
  // 牧場にいる間だけ URL に印を付け、トップへ戻る時に外す。見本では触らない。
  const mark = sourceBlock(client, "function markRanchUrl", "function applyState");
  assert.match(mark, /if \(previewScreen\) return;/);
  assert.match(mark, /window\.history\.replaceState/);
  assert.match(sourceBlock(client, "async function start(", "function isActive"), /active = true;\s*markRanchUrl\(true\);/);
  assert.match(sourceBlock(client, "function requestHome", "window.addEventListener(\"visibilitychange\""), /markRanchUrl\(false\);\s*window\.HariaiApp\?\.returnHome\?\.\(\);/);
  assert.match(sourceBlock(client, "function renderOpenLink", "// まだ財布として契約したことがない人"), /data-t="copy-open-url"/);
  assert.match(sourceBlock(client, 'case "copy-open-url": {', 'case "copy-invite": {'), /navigator\.clipboard\.writeText\(url\)/);
});

test("the top page shows the ranch shortcut first, only on a device that uses the ranch", () => {
  const storage = (value) => ({ getItem: (key) => (key === "hariai.ranch.regular.v1" ? value : null) });
  const regular = renderLanding(storage("1"));
  assert.ok(regular.indexOf('id="tributeResumeButton"') > 0);
  assert.ok(regular.indexOf('id="tributeResumeButton"') < regular.indexOf('class="vl-hero"'), "above the 1on1 hero");
  assert.match(regular, /<small>お貢ぎ牧場<\/small>契約を開く/);
  for (const landing of [renderLanding(storage(null)), renderLanding(null), renderLanding({ getItem() { throw new Error("blocked"); } })]) {
    assert.doesNotMatch(landing, /tributeResumeButton/, "newcomers and blocked storage keep the 1on1-first top page");
  }
  assert.match(appFn("renderLandingScreen"), /#tributeResumeButton"\)\?\.addEventListener\("click", \(\) => startTribute\(\{ initialScreen: "hub" \}\)\)/);
  // 印を残すのは tribute.js（管理人カードか契約がある時）。見本では残さない。同じキーを使う。
  const regularMark = sourceBlock(client, "function rememberRanchRegular", "// 牧場にいる間は");
  assert.match(client, /const RANCH_REGULAR_STORAGE_KEY = "hariai\.ranch\.regular\.v1";/);
  assert.match(regularMark, /if \(previewScreen\) return;/);
  assert.match(regularMark, /if \(state\.profile\?\.card \|\| state\.contracts\.length\) window\.localStorage\.setItem\(RANCH_REGULAR_STORAGE_KEY, "1"\);\s*else window\.localStorage\.removeItem\(RANCH_REGULAR_STORAGE_KEY\);/);
  assert.match(sourceBlock(client, "function applyState", "// 牧場で知らせる実績"), /if \(Array\.isArray\(payload\.contracts\)\) \{\s*state\.contracts = payload\.contracts;\s*rememberRanchRegular\(\);/);
  assert.match(styles, /\.vl-ranch-resume \{/);
  // 番付の説明は、番付加算の順（ranch-rank-score-v1）に合わせる。
  assert.match(app, /<small>今月の番付加算で並ぶ管理人<\/small>お貢ぎ牧場の番付/);
  assert.doesNotMatch(app, /財布の人数で並ぶ管理人/);
});

test("the contract screen puts やること and the list first once contracts exist, and settings below", () => {
  const hub = sourceBlock(client, "function renderHub", "// やること（");
  assert.match(hub, /\$\{hasContracts \? `\$\{renderTodo\(open, profile\)\}\$\{lists\}\$\{me\}` : `\$\{me\}\$\{lists\}`\}/);
  const lists = sourceBlock(client, "function renderContractLists", "// 自分の設定");
  assert.match(lists, /data-t="hub-role"/);
  assert.match(lists, /storedHubRole\(\) \|\| \(urgent\("payer"\) > urgent\("manager"\) \? "payer" : "manager"\)/);
  assert.match(client, /const HUB_ROLE_STORAGE_KEY = "hariai\.tribute\.hubRole\.v1";/);
  assert.match(sourceBlock(client, 'case "hub-role":', 'case "copy-open-url": {'), /rememberHubRole\(state\.hubRole\);\s*render\(\);/);
  const me = sourceBlock(client, "function renderMyPanel", "// 牧場を直接開くURL");
  assert.match(me, /<h2 class="tribute-me-title" id="tributeMeTitle">自分の設定<\/h2>/);
  // 財布の始め方は、管理人カードも契約もない人だけ。
  assert.match(me, /const newcomer = !card && !state\.contracts\.length;/);
  assert.match(me, /\$\{newcomer \? renderStartGuide\(\) : ""\}/);
  assert.match(me, /\$\{renderOpenLink\(\)\}/);
  for (const selector of [".tribute-todo-chip {", ".tribute-role-switch {", ".tribute-thread-next {", ".tribute-open-link {"]) assert.ok(styles.includes(selector), selector);
});

test("the thread offers 「次へ」 and keeps the list rows current while it is open", () => {
  assert.match(sourceBlock(client, "function renderThreadHead", "// 宣言の札と既読無視"), /\$\{renderThreadNext\(\)\}\s*\$\{renderTally\(view\)\}/);
  const next = sourceBlock(client, "function renderThreadNext", "// スレッドで変わった");
  assert.match(next, /if \(state\.thread\.demo\) return "";/);
  assert.match(next, /nextTodoContract\(state\.contracts, state\.thread\.contractId\)/);
  assert.match(next, /data-t="open-thread"/);
  assert.match(sourceBlock(client, "function openThread", "function subscribeThreadEvents"), /applyReadAcknowledgement\(contractId, [^;]*;\s*syncContractRow\(state\.thread\.view\);/);
});

test("a manager's active row no longer reads 終了 because the payer's limits are hidden", () => {
  const rowSource = sourceBlock(client, "function renderContractRow", "// 契約の画面。");
  assert.match(rowSource, /: contract\.status === "active"\s*\? `<small>今日 \$\{formatPay\(contract\.todayTributed\)\} ・ 合計 \$\{formatPay\(contract\.totalTributed\)\}<\/small>`/);
});

test("cache keys and the design note record the navigation release", () => {
  for (const name of ["app.js", "tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-nav-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-nav-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /やること/);
  assert.match(design, /\?open=ranch/);
});
