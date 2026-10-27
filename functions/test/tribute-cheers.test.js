"use strict";

// 貢がれ総額の番付・ハートの札・応援欄（ranch-cheers-v1）。2026-10-27 のユーザーの決定:
// 貢がれ総額は当月で財布3人以上の水増し対策付き、10位以内は X と番付のひとこと。1〜5位はカードにハートの札（上ほど豪華）。
// 応援欄は管理人の詳細に置き、今月貢いだ財布だけが書ける。管理人は隠す・「見たよ」・やることに出る。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");
const indexes = JSON.parse(read("firestore.indexes.json"));
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

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

test("the client mirrors the server limits and text checks for the ranking word and cheers", async () => {
  const core = await loadCore();
  assert.deepEqual({ ...core.GROSS_RANKING }, { limit: rules.LIMITS.grossRankingLimit, minPayers: rules.LIMITS.grossRankingMinPayers, badgeTop: rules.LIMITS.rankBadgeTop });
  assert.deepEqual([rules.LIMITS.grossRankingLimit, rules.LIMITS.grossRankingMinPayers, rules.LIMITS.rankBadgeTop], [10, 3, 5]);
  assert.equal(core.RANKING_WORD.length, rules.LIMITS.rankingWord);
  assert.deepEqual({ ...core.CHEER }, { length: rules.LIMITS.cheer, perDay: rules.LIMITS.cheersPerDay });
  const corpus = ["今月も一番に貢ぎます", "エロい財布", "LINE交換しよ", "@mio_sama", "500円", "090-1234-5678", "あ".repeat(40), "会おうよ", "寸止めして"];
  for (const text of corpus) {
    assert.equal(core.rankingWordProblem(text), rules.normalizeRankingWord(text).error || "", `ranking ${text}`);
    assert.equal(core.cheerProblem(text), rules.normalizeCheer(text).error || "", `cheer ${text}`);
  }
  assert.match(core.cheerProblem("あ".repeat(41)), /40文字まで/);
  assert.equal(core.rankingWordProblem(""), "", "an empty ranking word removes it");
  assert.equal(rules.normalizeCheer("").text, "", "an empty cheer deletes it");
  assert.equal(rules.normalizeManagerCard({ personaName: "ミオ", disclosure: "nekama", styles: ["insight"], entryFee: 0 }).card.rankingWord, "");
});

test("hearts get richer toward first place and appear only for ranks 1 to 5", () => {
  const constant = /const RANK_HEART_PATH = "[^"]+";/.exec(client)[0];
  const context = vm.createContext({ GROSS_RANKING: { badgeTop: 5 } });
  vm.runInContext(`${constant}\n${fn("rankHeartSvg")}\n${fn("rankHeart")}\nthis.rankHeart = rankHeart;`, context);
  for (const rank of [0, 6, -1, "x"]) assert.equal(context.rankHeart(rank), "", String(rank));
  const parts = (rank) => (context.rankHeart(rank).match(/<(?:path|ellipse|circle) /g) || []).length;
  assert.deepEqual([5, 4, 3, 2, 1].map(parts), [1, 1, 3, 5, 8]);
  assert.match(context.rankHeart(5), /class="rim"/);
  assert.doesNotMatch(context.rankHeart(5), /class="fill"/);
  assert.match(context.rankHeart(1), /class="crown"/);
  for (const rank of [2, 3, 4, 5]) assert.doesNotMatch(context.rankHeart(rank), /class="crown"/);
  assert.match(context.rankHeart(3), /class="tribute-rank-heart is-rank-3" title="貢がれ総額 今月3位"/);
  assert.match(context.rankHeart(1, " is-large"), /is-rank-1 is-large/);
  // 掲示板のカードと管理人の詳細に出す。
  assert.match(sourceBlock(client, "function renderManagerCard", "function renderBoard"), /<span class="tribute-card-tags">\$\{rankHeart\(card\.grossRank\)\}/);
  assert.match(sourceBlock(client, "function renderManagerDetail", "function renderCheers"), /\$\{rankHeart\(card\.grossRank, " is-large"\)\}/);
  for (const rank of [1, 2, 3, 4, 5]) assert.ok(styles.includes(rank === 5 ? ".tribute-rank-heart .rim {" : `.tribute-rank-heart.is-rank-${rank} {`), `style ${rank}`);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tribute-rank-heart\.is-rank-1 \{ animation: none; \}/);
});

test("the server ranks gross receipts monthly with the 3-wallet floor and caches the top 5 without breaking the board", () => {
  const ranking = sourceBlock(service, "async function grossRanking", "const rankCacheRef");
  assert.match(ranking, /\.where\("monthKey", "==", monthKey\)\s*\.orderBy\("receivedGross", "desc"\)/);
  assert.match(ranking, />= LIMITS\.grossRankingMinPayers/);
  assert.match(ranking, /!profileIsHidden\(row\.profile, monthKey\)/);
  const badges = sourceBlock(service, "async function rankBadges", "async function grossRankingsAction");
  assert.match(badges, /now - integer\(cached\.computedAt, 0, Number\.MAX_SAFE_INTEGER, 0\) < LIMITS\.rankBadgeCacheMs/);
  assert.match(badges, /catch \(error\) \{\s*console\.error\("tribute rank badges failed", error\);\s*return new Map\(\);/);
  assert.match(service, /if \(data\?\.kind === "gross"\) return grossRankingsAction\(uid, monthKey, now\);/);
  assert.match(service, /grossRank: badges\.get\(row\.uid\) \|\| 0, mine: row\.uid === uid/);
  // 応援欄: 隠した応援は管理人と書いた財布にだけ。UID は返さない。
  const cheers = sourceBlock(service, "async function cheerList", "function myCheerView");
  assert.match(cheers, /\.filter\(\(row\) => !row\.cheer\.hidden \|\| managerUid === uid \|\| row\.uid === uid\)/);
  assert.doesNotMatch(sourceBlock(cheers, "visibleRows(uid, rows)).map", "} catch"), /payerUid|uid:/);
  const groups = indexes.indexes.map((entry) => `${entry.collectionGroup}:${entry.fields.map((field) => `${field.fieldPath}:${field.order}`).join(",")}`);
  for (const expected of [
    "tributeManagerMonths:monthKey:ASCENDING,receivedGross:DESCENDING",
    "tributePairs:managerUid:ASCENDING,cheerMonthKey:ASCENDING,monthTotal:DESCENDING",
    "tributePairs:managerUid:ASCENDING,cheerId:ASCENDING",
  ]) assert.ok(groups.includes(expected), expected);
});

test("the ranking screen switches between 番付加算 and 貢がれ総額, and the top 10 shows X and the ranking word", () => {
  const ranking = sourceBlock(client, "function renderRanking()", "function renderGrossRanking");
  assert.match(ranking, /data-t="ranking-kind" data-kind="\$\{kind\}"/);
  assert.match(ranking, /\[\["score", "番付加算"\], \["gross", "貢がれ総額"\]\]/);
  const gross = sourceBlock(client, "function renderGrossRanking", "// ───────────── 金庫");
  assert.match(gross, /財布\$\{GROSS_RANKING\.minPayers\}人以上から貢がれた管理人だけ/);
  assert.match(gross, /\$\{row\.rankingWord \? `<span class="tribute-gross-word">\$\{escapeHtml\(row\.rankingWord\)\}<\/span>` : ""\}/);
  assert.match(gross, /\$\{xProfileButton\(row\)\}/);
  assert.match(client, /ranking: \{ status: "idle", managers: \[\], monthKey: "", kind: "score" \},/);
  assert.match(sourceBlock(client, "function loadRanking", "function navigate"), /kind === "gross" \? \{ kind \} : \{\}/);
  assert.match(sourceBlock(client, 'case "ranking-kind": {', 'case "clear-cheer":'), /if \(kind !== state\.ranking\.kind\) loadRanking\(kind\);/);
  // 番付のひとことはカードの編集で書き、送る前に画面でも確かめる。
  const editor = sourceBlock(client, "function renderCardEditor", "function updateCardPreview");
  assert.match(editor, /name="rankingWord" maxlength="\$\{RANKING_WORD\.length\}"/);
  assert.match(client, /const rankingWordError = rankingWordProblem\(rankingWord\);\s*if \(rankingWordError\) return setFormError\(form, rankingWordError\);/);
});

test("the cheer column: wallets write only after tributing this month, managers mark seen, hide and get a todo", () => {
  const column = sourceBlock(client, "function renderCheers", "function renderCheerForm");
  assert.match(column, /\$\{manager \? "" : renderCheerForm\(card, myCheer\)\}/);
  assert.match(column, /data-t="cheer-seen"/);
  assert.match(column, /data-t="\$\{cheer\.hidden \? "cheer-show" : "cheer-hide"\}"/);
  assert.match(column, /管理人が隠しています（あなたにだけ見えます）/);
  const form = sourceBlock(client, "function renderCheerForm", "function renderApply");
  assert.match(form, /if \(!myCheer\?\.canWrite\) return `<p class="tribute-note">今月\$\{escapeHtml\(card\.personaName\)\}に貢ぐと、応援欄に書けます。/);
  assert.match(form, /name="cheer" maxlength="\$\{CHEER\.length\}"/);
  assert.match(sourceBlock(client, 'case "cheer": {', 'case "word": {'), /const problem = cheerProblem\(text\);[\s\S]*?mutate\("set_cheer", \{ publicManagerId: state\.manager\.publicManagerId, text \}/);
  assert.match(sourceBlock(client, "function renderTodo", "// 契約の一覧。"), /class="tribute-todo-chip is-cheer" data-t="open-manager" data-id="\$\{escapeHtml\(profile\.publicManagerId\)\}">応援 <b>/);
  for (const action of ["set_cheer", "cheer_seen", "cheer_hide", "cheer_show"]) assert.ok(service.includes(`"${action}",`), action);
  for (const selector of [".tribute-cheer-list li {", ".tribute-cheer-seen {", ".tribute-todo-chip.is-cheer {", ".tribute-gross-word {"]) assert.ok(styles.includes(selector), selector);
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-cheers-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-cheers-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /### 貢がれ総額・ハートの札・応援欄（2026年10月、ユーザー決定）/);
  assert.match(design, /`tributeRankCache\/gross-\{monthKey\}`/);
});
