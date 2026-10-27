"use strict";

// 管理人の「動き」は任意（ranch-activity-optin-v1）。2026-10-27 のユーザーの決定: 最後に動いた時は、管理人がカードで
// 選んだ時だけ出し、初期は出さない。出さないカードは相手に時刻も渡さない。掲示板は、これまでどおり動いた順に並ぶ。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
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

const CARD = { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0 };

test("showing the last activity is an opt-in card setting, off by default", () => {
  assert.equal(rules.normalizeManagerCard(CARD).card.showsActivity, false);
  assert.equal(rules.normalizeManagerCard({ ...CARD, showsActivity: true }).card.showsActivity, true);
  assert.equal(rules.normalizeManagerCard({ ...CARD, showsActivity: "yes" }).card.showsActivity, false);
});

test("the server hands the time to others only for cards that show it, and keeps it on the manager's own card", () => {
  const card = sourceBlock(service, "function publicCard", "function ownProfileView");
  assert.match(card, /showsActivity: card\.showsActivity === true,\s*lastActiveAt: card\.showsActivity === true \? profile\.lastActiveAt : 0,/);
  assert.match(sourceBlock(service, "function ownProfileView", "function cardSnapshot"), /card: profile\.card \? \{ \.\.\.publicCard\(profile, monthKey, now\), lastActiveAt: profile\.lastActiveAt[,}]/);
});

test("the board and the manager detail show 動き only when the card opted in", () => {
  const context = vm.createContext({});
  vm.runInContext(`${fn("activityLabel")}\n${fn("cardActivityLabel")}`, context);
  const recent = Date.now() - 5 * 3_600_000;
  assert.equal(context.cardActivityLabel({ lastActiveAt: recent }), "", "cards that never chose stay hidden");
  assert.equal(context.cardActivityLabel({ showsActivity: false, lastActiveAt: recent }), "");
  assert.equal(context.cardActivityLabel({ showsActivity: true, lastActiveAt: recent }), "5時間前");
  assert.equal(context.cardActivityLabel({ showsActivity: true, lastActiveAt: 0 }), "");
  assert.equal(context.cardActivityLabel(null), "");
  assert.doesNotMatch(client.replace(fn("cardActivityLabel"), ""), /activityLabel\(card\.lastActiveAt\)/, "every display goes through the card setting");
});

test("the card editor offers the setting unchecked unless saved, previews it and saves it", () => {
  const editor = sourceBlock(client, "function renderCardEditor", "function updateCardPreview");
  assert.match(editor, /<legend>最後に動いた時<\/legend>/);
  assert.match(editor, /name="showsActivity" \$\{card\.showsActivity === true \? "checked" : ""\}/);
  assert.match(editor, /出さなくても、掲示板は動いた順に並びます。/);
  const preview = sourceBlock(client, "function updateCardPreview", "// ───────────── スレッド");
  assert.match(preview, /showsActivity: data\.get\("showsActivity"\) === "on",\s*lastActiveAt: state\.profile\?\.card\?\.lastActiveAt \|\| Date\.now\(\),/);
  assert.match(client, /postsScreenshots: data\.get\("postsScreenshots"\) === "on",\s*showsActivity: data\.get\("showsActivity"\) === "on",\s*(?:rankingWord,\s*)?\},\s*accepting:/);
  assert.match(client, /"postsScreenshots", "showsActivity"\]\.includes\(event\.target\.name\)\) updateCardPreview\(cardForm\);/);
});

test("newcomer hints point at the board order instead of a time most cards do not show", () => {
  assert.doesNotMatch(client, /最近動いている管理人/);
  assert.match(sourceBlock(client, "function renderStartGuide", "// 管理人が最後に動いた時"), /掲示板は最近動いた管理人から並んでいます。/);
  assert.match(client, /<div class="tribute-retry"><p>この申し込みは\$\{retryReasonText\(view\.endReason\)\}。掲示板は最近動いた管理人から並んでいます。/);
});

test("cache key and the design note record the release", () => {
  assert.match(html, /tribute\.js\?v=[^"]*-ranch-activity-optin-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /`card\.showsActivity`、初期は出さない/);
});
