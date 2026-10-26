"use strict";

// スレッドの使い勝手（ranch-thread-ux-v1）: 入力欄は会話のすぐ下、未払いの請求のタイムラインの印、
// 管理人だけの呼び名、財布名の説明、会話だけを出す「スクショ表示」。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the composer sits right under the conversation and the action buttons go below it", () => {
  const thread = sourceBlock(client, "function renderThread()", "function updateThreadParts");
  const events = thread.indexOf('id="tributeThreadEvents"');
  const composer = thread.indexOf('class="tribute-composer" data-form="message"');
  const actions = thread.indexOf('id="tributeThreadActions"');
  assert.ok(events > 0 && events < composer && composer < actions, "events → composer → actions");
});

test("an unpaid request leaves a marked line in the timeline at the time it was sent", () => {
  const events = sourceBlock(client, "function renderThreadEvents", "// スクショ表示。");
  assert.match(events, /event\.type === "request" && pending\.has\(event\.requestId\) \? renderRequestMark\(event, view\) : renderEvent\(event, view, statuses\)/);
  assert.doesNotMatch(events, /\.filter\(\(event\) => event\.type !== "request"/, "pending requests are no longer dropped from the timeline");
  const mark = sourceBlock(client, "function renderRequestMark", "// スクショ表示。");
  assert.match(mark, /<i aria-hidden="true">請<\/i><span>請求 <b>\$\{escapeHtml\(formatPay\(event\.amount\)\)\}<\/b><\/span>\$\{purposeTag\(purpose, view\)\}<span class="tribute-chip is-pending">未払い<\/span>/);
  assert.match(mark, /<time>\$\{escapeHtml\(formatDateTime\(event\.createdAt\)\)\}<\/time>/);
  assert.ok(styles.includes(".tribute-request-mark {"));
});

test("nicknames are manager-only labels that replace the wallet name in the manager's views", () => {
  assert.equal(rules.normalizeNickname("  ポチ  "), "ポチ");
  assert.equal(rules.normalizeNickname("x".repeat(30)).length, rules.LIMITS.nickname);
  assert.equal(rules.normalizeNickname(""), "");
  const counterpart = sourceBlock(client, "function contractCounterpart", "function statusChip");
  assert.match(counterpart, /if \(contract\.role === "payer"\) return \{ name: contract\.manager\.personaName, card: contract\.manager \};/);
  assert.match(counterpart, /const name = managerNickname\(contract\) \|\| contract\.payer\.walletName;/);
  assert.match(counterpart, /if \(contract\?\.role !== "manager"\) return "";/);
  const sheet = sourceBlock(client, 'case "nickname": {\n      if (view.role !== "manager") return "";', 'case "screenshots": {');
  assert.match(sheet, /財布には見えません/);
  assert.match(sheet, /maxlength="\$\{LIMITS\.nickname\}"/);
  assert.match(sourceBlock(client, 'case "nickname": {\n      const nickname', 'case "caps": {'), /mutate\("set_nickname", contractPayload\(\{ nickname \}\)/);
  assert.match(sourceBlock(client, "function renderThreadHead", "// 宣言の札と既読無視"), /view\.role === "manager" && !state\.thread\.demo/);
  assert.match(client, /const payerName = view\.role === "manager" \? contractCounterpart\(view\)\.name : view\.payer\.walletName;/);
  assert.match(client, /\{ title: contractCounterpart\(view\)\.name, screenClass:/);
});

test("the wallet name field says managers see it", () => {
  assert.match(client, /財布名（管理人のスレッドと番付に出ます）/);
  assert.doesNotMatch(client, /番付に載る時だけ使います/);
  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /財布名（管理人のスレッドに出ます）/);
  assert.match(apply, /空のままだと「名無しの財布」になり、管理人があなたを見分けにくくなります。/);
});

test("the screenshot view shows only the conversation; managers get it only where the wallet allows screenshots", () => {
  const shot = sourceBlock(client, "function canShowShot", "function renderShotButton");
  const context = vm.createContext({ state: { thread: { demo: false } } });
  vm.runInContext(`${shot}\nthis.canShowShot = canShowShot;`, context);
  assert.equal(context.canShowShot({ role: "payer", allowScreenshots: false }), true);
  assert.equal(context.canShowShot({ role: "manager", allowScreenshots: true }), true);
  assert.equal(context.canShowShot({ role: "manager", allowScreenshots: false }), false);
  context.state.thread.demo = true;
  assert.equal(context.canShowShot({ role: "payer" }), false, "not in the demo contract");
  assert.match(client, /function renderThreadActions\(view\) \{\s*return `\$\{renderThreadActionButtons\(view\)\}\$\{renderShotButton\(view\)\}`;/);
  assert.match(sourceBlock(client, 'case "shot-on":', 'case "set-screenshots": {'), /!canShowShot\(state\.thread\.view\)\) return;\s*state\.thread\.shot = true;/);
  assert.match(client, /document\.body\?\.classList\.toggle\("tribute-shot-mode", state\.screen === "thread" && state\.thread\?\.shot === true\);/);
  assert.match(sourceBlock(client, "function requestHome", "window.addEventListener(\"visibilitychange\""), /document\.body\?\.classList\.remove\("tribute-shot-mode"\);/);
  for (const selector of [".tribute-thread-screen.is-shot .tribute-header", ".tribute-thread-screen.is-shot .tribute-thread-head", ".tribute-thread-screen.is-shot .tribute-composer", ".tribute-thread-screen.is-shot .tribute-events button", "body.tribute-shot-mode .site-header", ".tribute-shot-exit {"]) {
    assert.ok(styles.includes(selector), selector);
  }
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-thread-ux-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-thread-ux-v1"/);
  assert.match(design, /### スレッドの使い勝手/);
  assert.match(design, /`payerNicknames`/);
});
