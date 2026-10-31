"use strict";

// 番付の冠と月替わり（ranch-crowns-v1、設計書18）。2026-10-31 のユーザーの決定「１，２，３を一緒に入れます」:
// 歴代の冠（各番付の1〜5位、消えない）・先月の首位の特権（掲示板のいちばん上と受付カードの帯）・月替わりの結果発表と収穫の棚。
// Pay の報酬・確率・毎日の受け取り・通知は入れない。冠は財布3人以上から貢がれた管理人だけ。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const { server } = require("./helpers/tribute-edge-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const OCTOBER = "2026-10";
const NOVEMBER_START = Date.parse("2026-11-01T00:00:00+09:00");
const MINUTE = 60_000;

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

test("month keys, the month start in Japan time, the stored ranks and the crowns they make", () => {
  assert.equal(rules.previousMonthKey("2026-11"), "2026-10");
  assert.equal(rules.previousMonthKey("2027-01"), "2026-12");
  assert.equal(rules.jstMonthStart("2026-11"), NOVEMBER_START);
  assert.equal(rules.jstMonthKey(rules.jstMonthStart("2026-11") - 1), "2026-10");
  assert.deepEqual(
    { monthCloseGraceMs: rules.LIMITS.monthCloseGraceMs, monthRankTop: rules.LIMITS.monthRankTop, crownTop: rules.LIMITS.crownTop, hallMonths: rules.LIMITS.hallMonths, hallTop: rules.LIMITS.hallTop },
    { monthCloseGraceMs: 10 * MINUTE, monthRankTop: 10, crownTop: 5, hallMonths: 12, hallTop: 3 },
  );
  assert.deepEqual(rules.normalizeMonthRanks({ "2026-10": { gross: 1, score: 12 }, "2026-09": { gross: 0, score: 0 }, bad: { gross: 1 }, "2026-13": { gross: 1 } }), { "2026-10": { gross: 1, score: 0 } });
  assert.equal(rules.crownsOf({}, "2026-11"), null);
  assert.equal(rules.crownsOf({ "2026-10": { gross: 6, score: 9 } }, "2026-11"), null, "6th and below are ranks, not crowns");
  const crowns = rules.crownsOf({ "2026-08": { gross: 1, score: 0 }, "2026-09": { gross: 3, score: 1 }, "2026-10": { gross: 2, score: 2 } }, "2026-11");
  assert.equal(crowns.best, 1);
  assert.equal(crowns.count, 2);
  assert.deepEqual(crowns.last, { monthKey: "2026-10", board: "gross", rank: 2 }, "the same rank on both boards shows the gross one");
  assert.deepEqual(crowns.list.map((crown) => `${crown.monthKey}:${crown.board}:${crown.rank}`), ["2026-10:gross:2", "2026-10:score:2", "2026-09:score:1", "2026-09:gross:3", "2026-08:gross:1"]);
  assert.equal(rules.crownsOf({ "2026-09": { gross: 1, score: 0 } }, "2026-11").last, null, "only last month's crown is a privilege");
});

async function octoberFixture() {
  const h = server.createHarness();
  const ids = {};
  // [uid, カード, 10月の財布の人数, 貢がれ総額, 番付加算]
  const managers = [
    ["m1", { personaName: "ミオ様", rankingWord: "今月も首位。覚悟して貢ぎな。" }, 6, 9_000, 6_000],
    ["m2", { personaName: "サキ", disclosure: "as_is" }, 3, 7_000, 8_000],
    ["m3", { personaName: "カイ" }, 2, 20_000, 15_000],
    ["m4", { personaName: "ユナ" }, 4, 3_000, 2_000],
  ];
  for (const [uid, card, payers, receivedGross, rankScore] of managers) {
    ids[uid] = await server.openManager(h, uid, { entryFee: 0, ...card });
    h.firestore.write(`tributeManagerMonths/${OCTOBER}__${uid}`, { monthKey: OCTOBER, managerUid: uid, payers, receivedGross, rankScore, personaName: card.personaName });
  }
  await server.confirmAge(h, "viewer");
  // 11月1日へ。掲示板は直近7日に動いた管理人だけなので、動いた時刻もそろえる。
  h.advance(NOVEMBER_START - h.now());
  const touch = () => {
    for (const [uid] of managers) h.firestore.write(`tributeProfiles/${uid}`, { ...h.firestore.read(`tributeProfiles/${uid}`), lastActiveAt: h.now() });
  };
  touch();
  return { h, ids, touch };
}

test("the month closes once, 10 minutes after it ends; crowns count only managers tributed by 3+ wallets", async () => {
  const { h, touch } = await octoberFixture();
  // 月が変わって10分の間は締めない（月をまたいだ献上を待つ）。
  h.advance(5 * MINUTE);
  touch();
  const early = await h.act("viewer", "board");
  assert.deepEqual(early.pinned, []);
  assert.equal(h.firestore.read(`tributeHallOfFame/${OCTOBER}`), undefined);
  h.advance(6 * MINUTE);
  touch();
  await h.act("viewer", "board");
  const hall = h.firestore.read(`tributeHallOfFame/${OCTOBER}`);
  assert.deepEqual(hall.gross.map((row) => [row.rank, row.managerUid, row.value, row.payers]), [[1, "m1", 9_000, 6], [2, "m2", 7_000, 3], [3, "m4", 3_000, 4]]);
  // カイは番付加算が一番でも、財布2人なので冠の順位に入らない。
  assert.deepEqual(hall.score.map((row) => [row.rank, row.managerUid, row.value]), [[1, "m2", 8_000], [2, "m1", 6_000], [3, "m4", 2_000]]);
  assert.deepEqual(hall.gross[0], { managerUid: "m1", publicManagerId: hall.gross[0].publicManagerId, personaName: "ミオ様", avatar: hall.gross[0].avatar, sigil: 2, disclosure: "nekama", rank: 1, value: 9_000, payers: 6 });
  assert.deepEqual(h.firestore.read("tributeProfiles/m1").monthRanks, { [OCTOBER]: { gross: 1, score: 2 } });
  assert.deepEqual(h.firestore.read("tributeProfiles/m2").monthRanks, { [OCTOBER]: { gross: 2, score: 1 } });
  assert.equal(h.firestore.read("tributeProfiles/m3").monthRanks, undefined);
  // 2回目以降は締め直さない（名前を変えても、殿堂はその月の名前のまま）。
  const closedAt = hall.closedAt;
  h.advance(2_100);
  await h.act("m1", "save_profile", { card: { personaName: "ミオ", intro: "雑魚財布は黙って差し出せ", disclosure: "nekama", styles: ["insight"], entryFee: 0, sigil: 2 }, accepting: true });
  h.advance(MINUTE);
  for (const action of ["board", "rankings", "ranch_standing"]) await h.act(action === "ranch_standing" ? "m1" : "viewer", action);
  assert.equal(h.firestore.read(`tributeHallOfFame/${OCTOBER}`).closedAt, closedAt);
  assert.equal(h.firestore.read(`tributeHallOfFame/${OCTOBER}`).gross[0].personaName, "ミオ様");
});

test("last month's champions sit above the board with their ranking word; cards carry the crowns; the hall lists the top 3", async () => {
  const { h, ids, touch } = await octoberFixture();
  h.advance(11 * MINUTE);
  touch();
  const board = await h.act("viewer", "board");
  assert.deepEqual(board.pinned.map((card) => [card.personaName, card.pinnedBoards]), [["ミオ様", ["gross"]], ["サキ", ["score"]]]);
  assert.equal(board.pinned[0].rankingWord, "今月も首位。覚悟して貢ぎな。");
  assert.deepEqual(board.managers.map((card) => card.personaName).sort(), ["カイ", "ユナ"], "champions are not listed twice");
  assert.deepEqual(board.pinned[0].crowns.last, { monthKey: OCTOBER, board: "gross", rank: 1 });
  assert.deepEqual(board.managers.find((card) => card.personaName === "ユナ").crowns, { best: 3, count: 2, last: { monthKey: OCTOBER, board: "gross", rank: 3 }, list: [{ monthKey: OCTOBER, board: "gross", rank: 3 }, { monthKey: OCTOBER, board: "score", rank: 3 }] });
  assert.equal(board.managers.find((card) => card.personaName === "カイ").crowns, null);
  // 絞り込み（ネカマ開示のみ）でも、条件に合う首位だけが上に出る。
  assert.deepEqual((await h.act("viewer", "board", { nekamaOnly: true })).pinned.map((card) => card.personaName), ["ミオ様"]);
  // 受付を止めた首位は、上の欄にも出ない。
  h.firestore.write("tributeProfiles/m2", { ...h.firestore.read("tributeProfiles/m2"), accepting: false });
  assert.deepEqual((await h.act("viewer", "board")).pinned.map((card) => card.personaName), ["ミオ様"]);

  const detail = await h.act("viewer", "manager", { publicManagerId: ids.m1 });
  assert.deepEqual(detail.card.crowns.list, [{ monthKey: OCTOBER, board: "gross", rank: 1 }, { monthKey: OCTOBER, board: "score", rank: 2 }]);

  const hall = await h.act("viewer", "rankings", { kind: "hall" });
  assert.equal(hall.kind, "hall");
  assert.deepEqual(hall.months.map((month) => month.monthKey), [OCTOBER]);
  assert.deepEqual(hall.months[0].gross.map((row) => [row.rank, row.personaName, row.value, row.payers]), [[1, "ミオ様", 9_000, 6], [2, "サキ", 7_000, 3], [3, "ユナ", 3_000, 4]]);
  assert.deepEqual(hall.months[0].score.map((row) => [row.rank, row.personaName]), [[1, "サキ"], [2, "ミオ様"], [3, "ユナ"]]);
  assert.doesNotMatch(JSON.stringify([board, hall, detail]), /managerUid|"m[1-4]"/, "no UIDs leave the server");
});

test("the ranch standing: last month's result, the harvest shelf and this month's rank with who is above", async () => {
  const { h, ids } = await octoberFixture();
  await rejects(h.act("viewer", "ranch_standing"), /管理人カードを作ると/);
  // 月が変わって10分の間は、先月の結果をまだ出さない。
  const early = await h.act("m2", "ranch_standing");
  assert.equal(early.lastMonth, null);
  assert.deepEqual(early.shelf, []);
  h.advance(11 * MINUTE);
  const NOVEMBER = "2026-11";
  h.firestore.write(`tributeManagerMonths/${NOVEMBER}__m4`, { monthKey: NOVEMBER, managerUid: "m4", payers: 3, receivedGross: 5_000, rankScore: 1_500 });
  h.firestore.write(`tributeManagerMonths/${NOVEMBER}__m2`, { monthKey: NOVEMBER, managerUid: "m2", payers: 3, receivedGross: 4_000, rankScore: 1_000 });
  const standing = await h.act("m2", "ranch_standing");
  assert.equal(standing.monthKey, NOVEMBER);
  assert.deepEqual(standing.lastMonth, { monthKey: OCTOBER, gross: 2, score: 1, received: true });
  assert.deepEqual(standing.shelf, [{ monthKey: OCTOBER, gross: 2, score: 1 }]);
  assert.deepEqual(standing.live.gross, { rank: 2, above: [{ id: ids.m4, name: "ユナ" }] });
  assert.deepEqual(standing.live.score, { rank: 2, above: [{ id: ids.m4, name: "ユナ" }] });
  // 番付に載っていない管理人は 0。財布2人のカイも、10月に貢がれたので牛乳の棚が1つある。
  const outside = await h.act("m3", "ranch_standing");
  assert.deepEqual(outside.lastMonth, { monthKey: OCTOBER, gross: 0, score: 0, received: true });
  assert.deepEqual(outside.shelf, [{ monthKey: OCTOBER, gross: 0, score: 0 }]);
  assert.deepEqual(outside.live.gross, { rank: 0, above: [] });
  assert.doesNotMatch(JSON.stringify(standing), /managerUid|"m[1-4]"/);
  // 今月の順位は10分まで前の写しを使う。
  h.firestore.write(`tributeManagerMonths/${NOVEMBER}__m2`, { monthKey: NOVEMBER, managerUid: "m2", payers: 3, receivedGross: 9_000, rankScore: 3_000 });
  assert.equal((await h.act("m2", "ranch_standing")).live.gross.rank, 2, "cached");
  h.advance(10 * MINUTE + 1);
  assert.deepEqual((await h.act("m2", "ranch_standing")).live.gross, { rank: 1, above: [] }, "recounted");
});

test("the browser names the crowns, the harvests and the rank news the same way as the server counts them", async () => {
  const core = await loadCore();
  assert.deepEqual({ ...core.CROWNS }, { recordTop: rules.LIMITS.monthRankTop, crownTop: rules.LIMITS.crownTop, hallTop: rules.LIMITS.hallTop });
  assert.deepEqual([core.rankText(1), core.rankText(3), core.rankText(0)], ["首位", "3位", "番付の外"]);
  assert.equal(core.monthLabel("2026-10"), "10月");
  assert.equal(core.monthLabel("2026-10", { year: true }), "2026年10月");
  assert.equal(core.crownLabel({ monthKey: "2026-10", board: "gross", rank: 1 }), "10月 貢がれ総額 首位");
  assert.equal(core.crownLabel({ monthKey: "2026-09", board: "score", rank: 4 }, { year: true }), "2026年9月 番付加算 4位");
  // 札は、先月の冠を先に。なければ、いちばん良い冠と回数。
  for (const [ranks, text] of [
    [{ "2026-10": { gross: 1, score: 0 } }, "先月 首位"],
    [{ "2026-09": { gross: 1, score: 1 }, "2026-08": { gross: 2, score: 0 } }, "冠 首位×2"],
    [{ "2026-08": { gross: 4, score: 0 } }, "冠 4位"],
    [{}, ""],
  ]) assert.equal(core.crownTagText(rules.crownsOf(ranks, "2026-11")), text, JSON.stringify(ranks));
  // 収穫は順位で決まり、確率はない。Pay の値は持たない。
  assert.deepEqual([[1, 0], [0, 1], [2, 5], [0, 3], [4, 0], [0, 10], [0, 0], [11, 0]].map(([gross, score]) => core.harvestFor({ gross, score }).id), ["gold", "gold", "silver", "silver", "egg", "egg", "milk", "milk"]);
  assert.deepEqual(core.HARVESTS.map((harvest) => harvest.label), ["金の卵", "銀の卵", "大きな卵", "牛乳"]);
  assert.doesNotMatch(JSON.stringify(core.HARVESTS), /Pay|price|amount/);
  // 順位の日報: 同じ月だけ比べる。抜いた管理人は、前に上にいなかった人。
  const standing = (gross, score, monthKey = "2026-11") => ({ monthKey, live: { gross, score } });
  const previous = core.standingSnapshot(standing({ rank: 3, above: [{ id: "a", name: "ミオ様" }, { id: "b", name: "サキ" }] }, { rank: 1, above: [] }));
  assert.deepEqual(previous, { monthKey: "2026-11", gross: { rank: 3, above: ["a", "b"] }, score: { rank: 1, above: [] } }, "only ranks and public IDs are kept on the device");
  assert.deepEqual(core.standingDiary(previous, standing({ rank: 2, above: [{ id: "a", name: "ミオ様" }] }, { rank: 2, above: [{ id: "c", name: "カイ" }] })), ["貢がれ総額で2位に上がった。", "番付加算でカイに抜かれて2位になった。"]);
  assert.deepEqual(core.standingDiary(previous, standing({ rank: 0, above: [] }, { rank: 4, above: [{ id: "c", name: "カイ" }, { id: "d", name: "ユナ" }, { id: "e", name: "ルカ" }] })), ["貢がれ総額の番付から外れた。", "番付加算でカイほか2人に抜かれて4位になった。"]);
  assert.deepEqual(core.standingDiary({ ...previous, gross: { rank: 0, above: [] } }, standing({ rank: 7, above: [] }, { rank: 1, above: [] })), ["貢がれ総額の番付に入った（7位）。"]);
  assert.deepEqual(core.standingDiary(previous, standing({ rank: 1, above: [] }, { rank: 1, above: [] }, "2026-12")), [], "the first diary of a month leaves it to the result");
  assert.deepEqual(core.standingDiary(null, standing({ rank: 1, above: [] }, null)), []);
});

test("screens: the champions above the board, the crown tag and list, the hall tab, the ranch result, shelf and rank news, the reception card ribbon", () => {
  const client = read("tribute.js");
  const share = read("tribute-share.mjs");
  const styles = read("tribute.css");
  const service = read("functions/tribute-service.js");
  const block = (start, end) => {
    const from = client.indexOf(start);
    assert.ok(from >= 0, start);
    return client.slice(from, client.indexOf(end, from + start.length));
  };
  const board = block("function renderBoard()", "function renderRankingRows");
  assert.match(board, /const champions = shown\(board\.pinned \|\| \[\]\);/);
  assert.match(board, /<h2 class="tribute-section-title">先月の首位<\/h2>/);
  assert.match(board, /renderManagerCard\(card, \{ champion: true \}\)/);
  assert.match(client, /state\.board = \{ \.\.\.state\.board, status: "ready", managers: payload\.managers \|\| \[\], pinned: payload\.pinned \|\| \[\] \};/);
  const card = block("function renderManagerCard", "function styleTag");
  assert.match(card, /\$\{rankHeart\(card\.grossRank\)\}\$\{crownTag\(card\.crowns\)\}/);
  assert.match(card, /<small>勝ち名乗り<\/small>\$\{escapeHtml\(card\.rankingWord\)\}/);
  assert.match(block("function renderManagerDetail", "function renderCrownList"), /\$\{renderCrownList\(card\.crowns\)\}/);
  assert.match(client, /\[\["score", "番付加算"\], \["gross", "貢がれ総額"\], \["hall", "殿堂"\]\]/);
  assert.match(client, /const kind = \["gross", "hall"\]\.includes\(target\.dataset\.kind\) \? target\.dataset\.kind : "score";/);
  // 牧場: 順位は管理人カードのある人だけ、契約の画面を開いた後に読む。結果発表は月に1回（この端末に残す）。
  const ranch = block("async function loadStanding", "function renderRanchAnimal");
  assert.match(ranch, /if \(!state\.profile\?\.card \|\| state\.ranch\.standingLoading\) return;/);
  assert.match(ranch, /await readOnce\("ranch_standing"\)/);
  assert.match(ranch, /if \(!last\?\.received \|\| state\.sheet \|\| state\.screen !== "hub"\) return;/);
  assert.match(ranch, /window\.localStorage\.setItem\(key, last\.monthKey\);/);
  assert.match(ranch, /<button class="button button-primary" type="button" data-t="sheet-close">棚に置く<\/button>/);
  assert.match(ranch, /Pay は付きません。/);
  assert.match(block("function renderRanch(open, profile)", "function ranchPhotoData"), /const diary = \[\.\.\.\(state\.ranch\.standingDiary \|\| \[\]\), \.\.\.ranchDiaryLines\(herd\)\];/);
  assert.match(block("function renderRanch(open, profile)", "function ranchPhotoData"), /\$\{renderRanchShelf\(\)\}/);
  assert.match(client, /if \(sheet\.type === "ranch-result"\) return renderRanchResultSheet\(sheet, wrap\);/);
  assert.match(client, /else if \(screen === "hub"\) loadStanding\(\);/);
  assert.match(client, /case "ranch_standing":/);
  assert.match(client, /"ranch-result": \(\) => navigate\("hub"\),/);
  assert.match(client, /"ranking-hall": \(\) => \{/);
  // 受付カード: 先月の1〜5位だけ帯が入る。
  assert.match(client, /crownLabel: card\.crowns\?\.last \? crownLabel\(card\.crowns\.last\) : "",/);
  assert.match(share, /const crown = String\(data\.crownLabel \|\| ""\);/);
  assert.match(share, /if \(crown\) \{\n    ctx\.save\(\);/);
  for (const selector of [".tribute-tag.is-crown {", ".tribute-card-champion {", ".tribute-card-victory {", ".tribute-crown-list {", ".tribute-hall-list li > b {", ".tribute-ranch-shelf ul {", ".tribute-ranch-result-harvest {", "@keyframes tribute-harvest-pop"]) assert.ok(styles.includes(selector), selector);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\) \{\n  \.tribute-ranch-result-harvest img \{ animation: tribute-harvest-pop/);
  assert.match(service, /\n  "ranch_standing",/);
  assert.match(service, /case "ranch_standing": return ranchStandingAction\(uid\);/);
  assert.match(service, /if \(data\?\.kind === "hall"\) return hallAction\(uid\);/);
});

test("the harvest art, the cache keys and the design record", () => {
  const art = read("art/tribute-ranch/render_ranch.py");
  assert.match(art, /HARVESTS = \{"gold": harvest_gold, "silver": harvest_silver, "egg": harvest_egg, "milk": harvest_milk\}/);
  assert.match(art, /if TIME == "day":\n    harvest_cam = camera\("harvest"/);
  for (const name of ["gold", "silver", "egg", "milk"]) {
    const file = path.join(root, `assets/tribute-ranch/harvest-${name}.webp`);
    assert.ok(fs.existsSync(file), name);
    assert.ok(fs.statSync(file).size > 1_000 && fs.statSync(file).size < 20_000, name);
  }
  const html = read("index.html");
  assert.match(html, /data-src="tribute\.css\?v=[^"]*-ranch-crowns-v1"/);
  assert.match(html, /"module": "tribute\.js\?v=[^"]*-ranch-crowns-v1"/);
  const client = read("tribute.js");
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-crowns-v1";/);
  assert.match(client, /import\("\.\/tribute-share\.mjs\?v=[^"]*-ranch-crowns-v1"\)/);
  // tribute-deco.mjs は4つの読み込み元で同じ URL のまま（今回は触らない）。
  assert.doesNotMatch(client, /tribute-deco\.mjs\?v=[^"]*ranch-crowns/);
  assert.ok(fs.existsSync(path.join(root, "functions/scripts/verify-tribute-crowns-release.cjs")));
  const design = read("TRIBUTE_DESIGN.md");
  assert.match(design, /## 18\. 番付の冠と月替わり（2026年10月）/);
  assert.match(design, /ユーザーが決めた（2026-10-31「１，２，３を一緒に入れます」）/);
  assert.match(design, /冠は、その月に財布3人以上から貢がれた管理人だけ/);
  assert.match(design, /「飾りでは掲示板の並び順を変えない」決まりの例外になる/);
  assert.match(design, /財布とのスレッドへの画像（ユーザー決定。保存すると、貼り合いスタジアム自体の仕組みを疑われる恐れがある）/);
});
