"use strict";

// 仕えた日数の番付と応援欄の並び（ranch-served-days-v1、設計書15.1）。2026-10-28 のユーザーの決定:
// 財布どうしを献上額で比べない。管理人ごとの番付は仕えた日数の順、額の順位は管理人だけが見る、応援欄は新しい順。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");
const indexes = JSON.parse(read("firestore.indexes.json")).indexes;

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("days served are counted on tributes and word offerings, in their own month field", () => {
  const helper = sourceBlock(service, "function servedDayPatch(ctx)", "\n  }\n");
  assert.ok(helper.includes("const sameMonth = pair.servedMonthKey === ctx.monthKey;"));
  assert.ok(helper.includes("return { servedMonthKey: ctx.monthKey, servedDays: countedToday ? days : days + 1, servedDayKey: ctx.dateKey };"));
  assert.ok(sourceBlock(service, "// 貢ぎ帳と番付", "const month = extra.month.value;").includes("...servedDayPatch(ctx),"));
  const offering = sourceBlock(service, "    offer_words: {", "    recite_order: {");
  assert.ok(offering.includes("patchPair(ctx, { ...servedDayPatch(ctx), rankOptIn: ctx.contract.rankOptIn === true, walletName: payerName(ctx) });"));
  assert.doesNotMatch(offering, /monthKey: ctx\.monthKey|monthTotal/, "word offerings never move the monthly total");
});

test("the ranking shows days and collar numbers to everyone and amounts only to the manager; cheers are newest first", () => {
  const ranking = sourceBlock(service, "async function managerRanking", "async function managerAction");
  assert.ok(ranking.includes('where("servedMonthKey", "==", monthKey).orderBy("servedDays", "desc").orderBy("collarNo", "asc")'));
  assert.ok(ranking.includes('pairs().orderBy("collarNo", "asc")'));
  assert.ok(ranking.includes('isManager ? read("amount-month"'));
  assert.match(ranking, /\.\.\.\(isManager \? \{\s*amounts:/);
  assert.match(ranking, /console\.error\(`tribute ranking \$\{label\} failed`, error\);\s*return \[\];/, "a missing index empties one column, not the page");
  const cheers = sourceBlock(service, "async function cheerList", "function myCheerView");
  assert.ok(cheers.includes('orderBy("cheerAt", "desc")'));
  assert.ok(cheers.includes(".sort((left, right) => right.cheer.at - left.cheer.at)"));
  const groups = indexes.map((entry) => `${entry.collectionGroup}:${entry.fields.map((field) => `${field.fieldPath}:${field.order}`).join(",")}`);
  for (const expected of [
    "tributePairs:managerUid:ASCENDING,rankOptIn:ASCENDING,servedMonthKey:ASCENDING,servedDays:DESCENDING,collarNo:ASCENDING",
    "tributePairs:managerUid:ASCENDING,rankOptIn:ASCENDING,collarNo:ASCENDING",
    "tributePairs:managerUid:ASCENDING,cheerMonthKey:ASCENDING,cheerAt:DESCENDING",
    // 管理人だけが見る額の順位と、応援欄の読み直しに、前のインデックスも使う。
    "tributePairs:managerUid:ASCENDING,rankOptIn:ASCENDING,monthKey:ASCENDING,monthTotal:DESCENDING",
    "tributePairs:managerUid:ASCENDING,cheerMonthKey:ASCENDING,monthTotal:DESCENDING",
  ]) assert.ok(groups.includes(expected), expected);
});

test("the manager detail shows the days ranking, and the amount ranking only on the manager's own detail", () => {
  assert.ok(sourceBlock(client, "function rankingValue", "function renderRankingRows").includes("if (Number(row.days) > 0) return `${Number(row.days)}日`;"));
  const detail = sourceBlock(client, "function renderManagerDetail", "function renderCheers");
  assert.ok(detail.includes("額ではなく仕えた日数の順"));
  assert.ok(detail.includes('${ranking?.amounts ? `<section class="tribute-panel tribute-amount-ranking">'));
  assert.ok(detail.includes("献上額の順位 <small>あなただけに見えます</small>"));
  assert.ok(client.includes("// 応援欄。今月この管理人に貢いだ財布だけが書け、新しい順に並ぶ"));
  const preview = sourceBlock(client, '    case "manager": {', '    case "set_cheer": {');
  assert.match(preview, /\.\.\.\(mine \? \{\s*amounts:/, "the preview shows amounts only on the own detail");
  for (const selector of [".tribute-two-col h3 small {", ".tribute-amount-ranking {"]) assert.ok(styles.includes(selector), selector);
});

test("cache keys and the design note record the change", () => {
  for (const name of ["tribute.js", "tribute.css"]) {
    assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-served-days-v1(?:-[a-z0-9-]+)?"`), name);
  }
  assert.ok(design.includes("Status: 第1段を実装した（仕えた日数の番付と応援欄の並び、15.1）"));
  assert.ok(design.includes("`servedDays`（当月仕えた日数）"));
});
