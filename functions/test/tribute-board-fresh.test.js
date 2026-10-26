"use strict";

// お貢ぎ牧場：掲示板には直近7日に動いた管理人だけを並べる（放置されたカードは読まない・出さない）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the 7-day board window and the 2-day notice are the same in the browser and on the server", async () => {
  const core = await loadCore();
  assert.equal(rules.LIMITS.boardActiveWindowMs, 7 * 24 * 60 * 60 * 1_000);
  assert.equal(rules.LIMITS.boardNoticeMs, 2 * 24 * 60 * 60 * 1_000);
  assert.equal(core.LIMITS.boardActiveWindowMs, rules.LIMITS.boardActiveWindowMs);
  assert.equal(core.LIMITS.boardNoticeMs, rules.LIMITS.boardNoticeMs);
});

test("the board query skips stale cards in Firestore itself, so they are never read", () => {
  const board = sourceBlock(service, "async function boardAction", "async function managerRanking");
  // 同じインデックス（accepting ＋ lastActiveAt 降順）の範囲指定。条件で外れたカードは読み込みに数えない。
  assert.match(board, /\.where\("accepting", "==", true\)\s*\.where\("lastActiveAt", ">=", activeSince\)\s*\.orderBy\("lastActiveAt", "desc"\)/);
  assert.match(board, /const activeSince = now - LIMITS\.boardActiveWindowMs;/);
  const indexes = JSON.parse(read("firestore.indexes.json")).indexes
    .filter((index) => index.collectionGroup === "tributeProfiles")
    .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`).join(","));
  assert.ok(indexes.includes("accepting:ASCENDING,lastActiveAt:DESCENDING"), "no new index is needed");
  // カードの保存も活動に数える。管理人には掲示板に出ていられる期限を返す。
  assert.match(sourceBlock(service, "async function saveProfileAction", "async function"), /patch\.cardUpdatedAt = now;\s*\/\/[^\n]*\n\s*patch\.lastActiveAt = now;/);
  assert.match(sourceBlock(service, "function ownProfileView", "function cardSnapshot"), /boardUntil: profile\.accepting && profile\.card \? profile\.lastActiveAt \+ LIMITS\.boardActiveWindowMs : 0,/);
});

test("the manager's hub says when the card leaves the board and how to come back", () => {
  const helpers = sourceBlock(client, "function boardStanding", "// 今日のひとこと（管理人だけ）");
  const sandbox = { LIMITS: { boardNoticeMs: 2 * 86_400_000 }, escapeHtml: (value) => String(value), result: null };
  vm.createContext(sandbox);
  vm.runInContext(`${helpers}\nresult = { boardStanding, boardStatusLabel, renderBoardNotice, boardLeftLabel };`, sandbox);
  const { boardStatusLabel, renderBoardNotice, boardLeftLabel } = sandbox.result;
  const now = Date.now();
  const profile = (left, extra = {}) => ({ card: { personaName: "ミオ様" }, accepting: true, hidden: false, boardUntil: now + left, ...extra });

  assert.equal(boardStatusLabel(profile(6 * 86_400_000)), "受付中（掲示板に出ています）");
  assert.equal(renderBoardNotice(profile(6 * 86_400_000)), "", "no notice while more than 2 days are left");
  assert.match(boardStatusLabel(profile(36 * 3_600_000)), /受付中（掲示板に出ています・あと2日で外れます）/);
  assert.match(renderBoardNotice(profile(36 * 3_600_000)), /<b>あと2日で掲示板から外れます<\/b>[^<]*今日のひとことを出すか、カードを保存すると延びます/);
  assert.equal(boardLeftLabel(5 * 3_600_000 - 1), "5時間");
  const stale = renderBoardNotice(profile(-1));
  assert.match(stale, /is-stale/);
  assert.match(stale, /<b>掲示板に出ていません<\/b>7日間動きがなかったため、掲示板から外れています。/);
  assert.match(stale, /招待リンクからは、これまでどおり開けます。/);
  assert.equal(boardStatusLabel(profile(-1)), "受付中（7日間動きがないため、掲示板に出ていません）");
  // 受付停止中・通報で外れている時・古いサーバー（期限なし）では、7日の案内を出さない。
  assert.equal(boardStatusLabel(profile(-1, { accepting: false })), "受付停止中");
  assert.equal(renderBoardNotice(profile(-1, { accepting: false })), "");
  assert.equal(renderBoardNotice(profile(-1, { hidden: true })), "");
  assert.equal(renderBoardNotice({ card: {}, accepting: true, boardUntil: 0 }), "");

  const hub = sourceBlock(client, "function renderHub", "// まだ財布として契約したことがない人");
  assert.match(hub, /<small>\$\{escapeHtml\(boardStatusLabel\(profile\)\)\}<\/small>/);
  assert.match(hub, /\$\{boardNotice \? renderBoardNotice\(profile\) : ""\}\s*\$\{renderWordForm\(profile\)\}/);
  // 契約のある人は、自分の設定が一覧の下にあるので、知らせは先頭の「やること」に出す（ranch-nav-v1）。
  assert.match(sourceBlock(client, "function renderTodo", "// 契約の一覧。"), /const notice = renderBoardNotice\(profile\);/);
  assert.match(hub, /const me = renderMyPanel\(profile, \{ boardNotice: !hasContracts \}\);/);
  assert.ok(styles.includes(".tribute-board-notice {") && styles.includes(".tribute-board-notice.is-stale {"));
  // 見本で、外れる前と外れた後の案内を確かめられる。
  assert.match(client, /"hub-board-ending": \(\) => navigate\("hub"\),\s*"hub-board-off": \(\) => navigate\("hub"\),/);
});

test("the design note records the 7-day board window", () => {
  assert.match(design, /直近7日/);
  assert.match(design, /boardUntil/);
});
