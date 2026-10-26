"use strict";

// 新規の立ち去りを減らす（ranch-first-steps-v1）。2026-10-26 の集計で、年齢確認をした人の68%が何もせず帰り、
// 申し込みの多くが48時間で失効していた。はじめての方へ・入場料0の絞り込み・管理人の動き・入場料の知らせ・案内し直し。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");

function fn(name) {
  const start = client.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const body = client.slice(start);
  const end = /\n\}\n/.exec(body);
  return body.slice(0, end.index + 2);
}

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("first steps show until a wallet has been managed once, and come back after an expired or declined application", () => {
  const context = vm.createContext({ state: { contracts: [] } });
  vm.runInContext(`${fn("isFirstTimeWallet")}\n${fn("retryReasonText")}\n${fn("activityLabel")}`, context);
  const first = (profile, contracts) => { context.state.contracts = contracts; return context.isFirstTimeWallet(profile); };
  assert.equal(first({}, []), true, "a brand-new wallet");
  assert.equal(first({ card: { personaName: "ミオ" } }, []), false, "managers do not need it");
  assert.equal(first({}, [{ role: "payer", status: "pending", acceptedAt: 0 }]), false, "waiting for acceptance");
  assert.equal(first({}, [{ role: "payer", status: "ended", endReason: "application_expired", acceptedAt: 0 }]), true, "after an expired application");
  assert.equal(first({}, [{ role: "payer", status: "ended", endReason: "terminated", acceptedAt: 5 }]), false, "once managed");
  assert.equal(context.retryReasonText("application_expired"), "48時間のうちに受理されず、失効しました");
  assert.equal(context.retryReasonText("declined"), "受理されませんでした");
  assert.equal(context.retryReasonText("withdrawn"), "");
  const now = Date.parse("2026-10-27T00:00:00Z");
  assert.equal(context.activityLabel(0, now), "");
  assert.equal(context.activityLabel(now - 10 * 60_000, now), "1時間以内");
  assert.equal(context.activityLabel(now - 5 * 3_600_000, now), "5時間前");
  assert.equal(context.activityLabel(now - 50 * 3_600_000, now), "2日前");
});

test("the hub opens with the first steps for newcomers and offers the fee-0 board", () => {
  const hub = sourceBlock(client, "function renderHub", "// やること（");
  assert.match(hub, /const firstSteps = isFirstTimeWallet\(profile\) \? renderStartGuide\(\) : "";/);
  assert.match(hub, /\$\{refund\}\s*\$\{firstSteps\}/);
  const guide = sourceBlock(client, "function renderStartGuide", "// 管理人が最後に動いた時");
  assert.match(guide, /Payが0でも、今日から管理されます/);
  for (const action of ['data-t="open-demo"', 'data-t="board-free"', 'data-t="nav" data-screen="board"']) assert.ok(guide.includes(action), action);
  assert.match(guide, /data-start-guide-balance/);
  assert.match(sourceBlock(client, 'case "board-free":', 'case "toggle-declaration":'), /state\.board\.feeZeroOnly = true;\s*navigate\("board"\);/);
});

test("the board can show only fee-0 managers and how recently each manager acted", () => {
  const board = sourceBlock(client, "function renderBoard()", "function renderRankingRows");
  assert.match(board, /const managers = board\.feeZeroOnly \? board\.managers\.filter\(\(card\) => !Number\(card\.entryFee\)\) : board\.managers;/);
  assert.match(board, /data-t="toggle-fee-zero"/);
  assert.match(client, /input\[data-t="toggle-fee-zero"\]/, "the change listener routes the toggle");
  assert.match(client, /<span>動き <b>\$\{escapeHtml\(activityLabel\(card\.lastActiveAt\)\)\}<\/b><\/span>/);
  assert.match(client, /<dt>最後に動いた<\/dt><dd>\$\{escapeHtml\(activityLabel\(card\.lastActiveAt\)\)\}<\/dd>/);
});

test("applying warns when the entry fee is more than the wallet, and stalled applications are pointed elsewhere", () => {
  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /const feeShort = target\.entryFee > 0 && balance !== null && balance < target\.entryFee;/);
  assert.match(apply, /受理される時に入場料を払えないと、管理人は受理できず、申し込みは48時間で失効します/);
  const actions = sourceBlock(client, "function renderThreadActionButtons", "const withdraw = view.escrowWithdrawRequest;");
  assert.match(actions, /view\.role === "payer" && retryReasonText\(view\.endReason\)/);
  assert.match(actions, /data-t="board-free"/);
  for (const selector of [".tribute-first-steps {", ".tribute-first-steps-list .button {", ".tribute-fee-warning {", ".tribute-retry {"]) assert.ok(styles.includes(selector), selector);
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-first-steps-v1"`), name);
  assert.match(design, /財布の始め方（はじめての方へ）/);
  assert.match(design, /report-tribute-newcomer-funnel\.cjs/);
});
