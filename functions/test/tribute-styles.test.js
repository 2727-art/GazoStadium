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
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-styles-v1"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-styles-v1"/);
  assert.match(design, /管理の型（`styles`/);
  assert.match(design, /見透かす・管理する・煽る・甘やかす・突き放す/);
});
