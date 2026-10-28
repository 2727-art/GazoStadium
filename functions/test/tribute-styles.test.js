"use strict";

// 管理の型（ranch-styles-v1）。2026-10-27 のユーザーの決定:
// 型は5つ（見透かす・管理する・煽る・甘やかす・突き放す）。管理人は1つか2つ選び、主と副（ギャップ）はカードで伝えない。
// それまでの3つ（罵倒・事務的・甘やかし）は解除して選び直してもらう。請求の一言は型ごとの一言を足して見直す。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
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

test("five types, one or two per card, in list order on both sides; the old three are not read", async () => {
  const core = await loadCore();
  assert.deepEqual(core.MANAGER_STYLES.map((style) => style.id), [...rules.MANAGER_STYLES]);
  assert.deepEqual(core.MANAGER_STYLES.map((style) => style.label), ["見透かす", "管理する", "煽る", "甘やかす", "突き放す"]);
  assert.equal(core.MAX_MANAGER_STYLES, rules.MAX_MANAGER_STYLES);
  for (const value of [["tease", "insight"], ["aloof", "aloof"], ["harsh"], ["insight", "manage", "tease"], "insight", null]) {
    assert.deepEqual(core.normalizeStyles(value), rules.normalizeStyles(value), JSON.stringify(value));
  }
  assert.deepEqual(rules.normalizeStyles(["tease", "insight"]), ["insight", "tease"], "the order never tells which one is main");
  assert.equal(core.stylesLabel({ styles: ["pamper", "manage"] }), "管理する・甘やかす");
  assert.equal(core.stylesLabel({ style: "harsh" }), "", "a card that still has only the old type shows no type");
  const base = { personaName: "ミオ様", disclosure: "nekama", entryFee: 0 };
  assert.deepEqual(rules.normalizeManagerCard({ ...base, styles: ["tease", "insight"] }).card.styles, ["insight", "tease"]);
  assert.match(rules.normalizeManagerCard({ ...base, style: "harsh" }).error, /管理の型を1つか2つ/, "the old field alone is not a choice");
  assert.match(rules.normalizeManagerCard({ ...base, styles: ["insight", "manage", "tease"] }).error, /1つか2つ/);
  assert.equal("style" in rules.normalizeManagerCard({ ...base, styles: ["aloof"], style: "harsh" }).card, false);
});

test("the card editor, the hub notice, the board tag and filter, and the image labels", () => {
  const editor = sourceBlock(client, "function renderCardEditor", "function renderSealSettings");
  assert.match(editor, /type="checkbox" name="styles" value="\$\{style\.id\}"/);
  assert.match(editor, /\$\{styleReselectNotice\(profile\)\}|needsStyles\(profile\)/);
  assert.doesNotMatch(editor, /name="style"/);
  assert.match(client, /event\.target\.name === "styles" && cardForm\.querySelectorAll\('input\[name="styles"\]:checked'\)\.length > MAX_MANAGER_STYLES/);
  assert.match(client, /if \(!styles\.length \|\| data\.getAll\("styles"\)\.length > MAX_MANAGER_STYLES\) return setFormError/);
  assert.match(sourceBlock(client, "function renderMyPanel", "function ranchOpenUrlHere"), /\$\{styleReselectNotice\(profile\)\}/);
  const board = sourceBlock(client, "function renderBoard()", "function renderRankingRows");
  assert.match(board, /\.filter\(\(card\) => !board\.style \|\| normalizeStyles\(card\.styles\)\.includes\(board\.style\)\)/);
  assert.match(board, /<select data-t="board-style">/);
  assert.match(client, /select\[data-t="board-style"\]/, "the change listener routes the filter");
  assert.match(sourceBlock(client, "function renderManagerCard", "function renderBoard()"), /\$\{styleTag\(card\)\}/);
  assert.equal((client.match(/styleLabel: stylesLabel\((manager|card)\)/g) || []).length, 2, "report and recruit images");
  assert.match(sourceBlock(client, "function renderNoteChips", "\n}\n"), /requestNotesFor\(\{ purpose, tone: view\.tone, styles: state\.profile\?\.card\?\.styles, ngWords: view\.ngWords \}\)/);
  for (const selector of [".tribute-note-chips button.is-style {", ".tribute-style-picker .tribute-radio-col span small {", ".tribute-form-hint.is-alert {", ".tribute-board-style select {"]) {
    assert.ok(styles.includes(selector), selector);
  }
});

test("the server keeps only the new list on cards, the board, contract snapshots and report info", () => {
  assert.equal((service.match(/styles: normalizeStyles\((card|source)\.styles\)/g) || []).length, 3);
  assert.doesNotMatch(service, /style: String\((card|source)\.style/);
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-styles-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-styles-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /管理の型（`styles`/);
  assert.match(design, /見透かす・管理する・煽る・甘やかす・突き放す/);
});

// 型の定型文とご褒美（ranch-style-words-v1、2026-10-27 ユーザー決定: 会話の定型文とご褒美も型に合わせる）。
test("type rewards and type stock lines: per type and tone, only for the manager's chosen types, same rules as request notes", async () => {
  const core = await loadCore();
  assert.deepEqual(core.REWARDS.map((reward) => ({ ...reward, tones: [...reward.tones] })), rules.REWARDS.map((reward) => ({ ...reward, tones: [...reward.tones] })));
  const typed = core.REWARDS.filter((reward) => reward.style);
  assert.deepEqual([...new Set(typed.map((reward) => reward.style))], [...rules.MANAGER_STYLES]);
  for (const id of rules.MANAGER_STYLES) {
    assert.ok(typed.some((reward) => reward.style === id && reward.tones.includes("sweet")), `${id} has a sweet reward`);
  }
  const banned = /死|殺|自殺|消えろ|首吊|殴|刺す|晒|特定|ばら|上限を上げ|上げろ|逃げ|逃が|解約したら|やめたら|許さない|裏切|♥|今だけ|あなただけ|お願い|ください/u;
  for (const reward of typed) {
    assert.ok(reward.label.length <= rules.LIMITS.ownRewardLength, reward.label);
    assert.doesNotMatch(reward.label, banned, reward.label);
    assert.equal(rules.forbiddenReason(reward.label), "", reward.label);
    assert.equal(rules.boardSexualWord?.(reward.label) || false, false, reward.label);
  }
  for (const [tone, styles] of [["harsh", ["tease"]], ["sweet", ["tease", "insight"]], ["normal", []], ["harsh", ["bogus"]]]) {
    assert.deepEqual(core.rewardsFor(tone, [], styles).map((reward) => reward.id), rules.rewardsFor(tone, [], styles).map((reward) => reward.id), `${tone} ${styles}`);
  }
  assert.deepEqual(core.rewardsFor("harsh", [], ["tease"]).filter((reward) => reward.style).map((reward) => reward.id), ["eraierai", "choroi", "matamake"]);
  assert.equal(core.rewardsFor("harsh").some((reward) => reward.style), false, "no type, no type rewards");
  assert.equal(rules.normalizeReward("choroi", { tone: "harsh", styles: ["tease"] }).reward, "choroi");
  assert.match(rules.normalizeReward("choroi", { tone: "harsh", styles: ["insight"] }).error, /選べません/, "another type's reward");
  assert.match(rules.normalizeReward("matamake", { tone: "normal", styles: ["tease"] }).error, /選べません/, "above the ceiling");
  assert.equal(core.rewardLabel("mitooshi"), "お見通しです");

  assert.deepEqual(Object.keys(core.STYLE_TEMPLATES), [...rules.MANAGER_STYLES]);
  for (const [id, byTone] of Object.entries(core.STYLE_TEMPLATES)) {
    assert.deepEqual(Object.keys(byTone), ["sweet", "normal", "harsh"], id);
    for (const line of Object.values(byTone).flat()) {
      assert.doesNotMatch(line, banned, line);
      assert.doesNotMatch(line, /♡(?!$)/u, `${line}: ♡ only at the end`);
      assert.equal(rules.forbiddenReason(line.replaceAll("{no}", "3")), "", line);
      assert.ok(line.length <= 30, line);
    }
  }
  const groups = core.styleTemplatesFor(["tease", "insight"], "harsh", { collarNo: 3 });
  assert.deepEqual(groups.map((group) => group.label), ["見透かす", "煽る"]);
  assert.ok(groups[0].lines.includes("3号、あなたの考えることは全部お見通しです。"));
  assert.equal(core.styleTemplatesFor(["tease"], "harsh").flatMap((group) => group.lines).some((line) => line.includes("{no}") || /\d+号/.test(line)), false, "numbered lines need a collar number");
  assert.equal(core.styleTemplatesFor(["aloof"], "harsh", { ngWords: ["財布"] })[0].lines.includes("用があるのは、お財布だけ。"), false);
  assert.deepEqual(core.styleTemplatesFor([], "harsh"), []);
});

test("the thread shows the type stock lines and type rewards only to the manager", () => {
  const templates = sourceBlock(client, "function renderTemplates", "function rewardChips");
  assert.match(templates, /const typed = view\.role === "manager" \? styleTemplatesFor\(state\.profile\?\.card\?\.styles, tone, \{ ngWords: view\.ngWords, collarNo: view\.collarNo \}\) : \[\];/);
  assert.match(templates, /tribute-template-group is-style"><span>型：/);
  const chips = sourceBlock(client, "function rewardChips", "\n}\n");
  assert.match(chips, /rewardsFor\(view\.tone, view\.ngWords, view\.role === "manager" \? state\.profile\?\.card\?\.styles : \[\]\)/);
  assert.match(chips, /reward\.style \? ' class="is-style"' : ""/);
  assert.match(service, /styles: ctx\.profiles\.manager\.value\.card\?\.styles,/);
  for (const selector of [".tribute-template-group.is-style button {", ".tribute-reward-chips button.is-style {"]) assert.ok(styles.includes(selector), selector);
  assert.match(html, /tribute\.js\?v=[^"]*-ranch-style-words-v1(?:-[a-z0-9-]+)?"/);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-style-words-v1"/);
  assert.match(design, /型の定型文/);
});
