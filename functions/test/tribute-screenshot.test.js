"use strict";

// スクショの掲載（ranch-screenshot-v1）: 財布の許可は契約の設定で、管理人には札で見せる。管理人はカードで宣言できる。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const share = read("tribute-share.mjs");
const styles = read("tribute.css");
const html = read("index.html");
const safety = read("safety/index.html");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

const CARD = { personaName: "ミオ様", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", style: "harsh", entryFee: 0 };
const APPLICATION = { caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true };

test("the card declaration and the payer's consent are opt-in booleans on the server", () => {
  assert.equal(rules.normalizeManagerCard(CARD).card.postsScreenshots, false);
  assert.equal(rules.normalizeManagerCard({ ...CARD, postsScreenshots: true }).card.postsScreenshots, true);
  assert.equal(rules.normalizeManagerCard({ ...CARD, postsScreenshots: "yes" }).card.postsScreenshots, false);
  assert.equal(rules.normalizeApplication(APPLICATION).application.allowScreenshots, false, "payers never consent by default");
  assert.equal(rules.normalizeApplication({ ...APPLICATION, allowScreenshots: true }).application.allowScreenshots, true);
});

test("the client contract view carries the consent like the server view", async () => {
  const core = await loadCore();
  const raw = { contractId: "c", managerUid: "m", payerUid: "p", status: "active", eventSeq: 1, readSeq: {} };
  assert.equal(core.viewContract(raw, "m").allowScreenshots, false);
  assert.equal(core.viewContract({ ...raw, allowScreenshots: true }, "m").allowScreenshots, true);
});

test("payers choose on applying and in the thread; managers see a tag instead of asking", () => {
  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /<input type="checkbox" name="allowScreenshots" \/><span>管理人のXに、スクショを載せられてもいい/);
  assert.match(apply, /会話で頼まれることはありません/);
  assert.match(apply, /すでに載ったものはアプリでは消せません/);
  assert.match(apply, /target\.postsScreenshots \? `\$\{escapeHtml\(target\.personaName\)\}は「スクショを載せる」管理人です。`/);
  assert.match(client, /allowSexualPurposes: data\.get\("allowSexualPurposes"\) === "on",\s*allowScreenshots: data\.get\("allowScreenshots"\) === "on",/);
  const tally = sourceBlock(client, "function renderTally", "function capsText");
  assert.match(tally, /if \(view\.allowScreenshots\) parts\.push\('<span class="is-shot">スクショ掲載 可<\/span>'\);\s*else if \(view\.role === "manager"\) parts\.push\('<span class="is-shot-off">スクショ掲載 不可<\/span>'\);/);
  const sheet = sourceBlock(client, 'case "screenshots": {', 'case "end":');
  assert.match(sheet, /if \(view\.role !== "payer"\) return "";/);
  assert.match(sheet, /data-t="set-screenshots"/);
  assert.match(sourceBlock(client, 'case "set-screenshots": {', 'case "set-purposes": {'), /mutate\("set_screenshots", contractPayload\(\{ allowScreenshots: allow \}\)/);
  assert.equal((client.match(/data-sheet="screenshots">スクショの設定<\/button>/g) || []).length, 2, "pending and active payer threads");
  assert.match(client, /case "screenshots_changed":/);
  assert.match(client, /\$\{event\.allowScreenshots \? " ・ スクショ掲載 可" : ""\}/);
});

test("managers can declare 「スクショを載せる」 on the card, board, apply screen and recruit image", () => {
  const editor = sourceBlock(client, "function renderCardEditor", "function renderSealSettings");
  assert.match(editor, /name="postsScreenshots" \$\{card\.postsScreenshots === true \? "checked" : ""\}/);
  assert.match(client, /postsScreenshots: data\.get\("postsScreenshots"\) === "on",/);
  assert.match(sourceBlock(client, "function declarationTags", "// 経った時間"), /card\?\.postsScreenshots \? '<span class="tribute-shot">スクショを載せる<\/span>'/);
  assert.match(client, /postsScreenshots: card\.postsScreenshots === true,/);
  assert.match(share, /const SHOT = "スクショを載せる";/);
  assert.match(share, /data\.postsScreenshots \? SHOT : ""/);
  for (const selector of [".tribute-shot {", ".tribute-tally .is-shot {", ".tribute-tally .is-shot-off {"]) assert.ok(styles.includes(selector), selector);
});

test("the safety page, design note and cache keys record the rule", () => {
  assert.match(safety, /財布が契約で「管理人のXに、スクショを載せられてもいい」を許している時だけ/);
  assert.match(design, /### スクショの掲載/);
  assert.match(design, /`allowScreenshots`/);
  assert.match(design, /`card\.postsScreenshots`/);
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-screenshot-v1"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-screenshot-v1"/);
  assert.match(client, /from "\.\/tribute-share\.mjs\?v=ranch-vault-v1-ranch-screenshot-v1"/);
});
