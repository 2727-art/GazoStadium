"use strict";

// 貢ぎオセロ（ranch-othello-v1、設計書15.2）。2026-10-28 のユーザーの決定:
// 財布は契約で受けるかを選び、その中で始めるか・1枚あたりの額・ハンデ・先手は管理人だけが決める。
// 財布は降参でき、設定を外すと罰金なしで終わる。罰金は自動で引き落とさず、財布が差し出すか、管理人が請求にする。
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
const share = read("tribute-share.mjs");
const styles = read("tribute.css");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

// 決まった順の乱数（対局を何局も打って、両側の判定が同じかを見る）。
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 2 ** 32;
  };
}

test("the board engine is the same on the server and in the browser over many random games", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.OTHELLO_RATES], [...rules.OTHELLO_RATES]);
  assert.deepEqual([...core.OTHELLO_HANDICAPS], [...rules.OTHELLO_HANDICAPS]);
  for (const handicap of rules.OTHELLO_HANDICAPS) {
    assert.equal(core.othelloInitialBoard(handicap), rules.othelloInitialBoard(handicap));
  }
  let finished = 0;
  let passes = 0;
  for (let game = 0; game < 40; game += 1) {
    const random = seeded(game + 1);
    let board = rules.othelloInitialBoard(rules.OTHELLO_HANDICAPS[game % 3]);
    let turn = game % 2 ? "manager" : "payer";
    for (let move = 0; move < 80 && turn; move += 1) {
      const side = rules.othelloSide(turn);
      const moves = rules.othelloMoves(board, side);
      assert.deepEqual(core.othelloMoves(board, side), moves);
      assert.ok(moves.length, "the side to move always has a move");
      const index = moves[Math.floor(random() * moves.length)];
      const played = rules.othelloPlay(board, side, index);
      assert.deepEqual(core.othelloPlay(board, side, index), played);
      assert.equal(played.flipped, rules.othelloFlips(board, side, index).length);
      const next = rules.othelloNextTurn(played.board, turn);
      assert.deepEqual(core.othelloNextTurn(played.board, turn), next);
      if (next.passed) passes += 1;
      assert.deepEqual(core.othelloCount(played.board), rules.othelloCount(played.board));
      board = played.board;
      turn = next.turn;
    }
    assert.equal(turn, "", "every game reaches the end");
    finished += 1;
    for (const rate of rules.OTHELLO_RATES) {
      for (const resigned of [false, true]) {
        assert.deepEqual(core.othelloOutcome(board, rate, { resigned }), rules.othelloOutcome(board, rate, { resigned }));
      }
    }
  }
  assert.equal(finished, 40);
  assert.ok(passes > 0, "the random games include passes");
});

test("rules: flips, corners, illegal moves, outcomes and the start options", () => {
  const start = rules.othelloInitialBoard();
  assert.deepEqual(rules.othelloCount(start), { manager: 2, payer: 2, empty: 60 });
  assert.equal(rules.othelloCount(rules.othelloInitialBoard("manager_corner")).manager, 3);
  assert.equal(rules.othelloCount(rules.othelloInitialBoard("payer_corner")).payer, 3);
  assert.deepEqual(rules.othelloMoves(start, "P"), [19, 26, 37, 44]);
  assert.deepEqual(rules.othelloPlay(start, "P", 19), { board: rules.othelloPlay(start, "P", 19).board, flipped: 1, corner: false });
  assert.deepEqual(rules.othelloPlay(start, "P", 0), { error: "そこには打てません。" });
  assert.deepEqual(rules.othelloPlay(start, "P", 27), { error: "そこには打てません。" }, "an occupied cell");
  assert.deepEqual(rules.othelloPlay(start, "P", 64), { error: "そこには打てません。" });
  assert.equal(rules.othelloBoardValid("x".repeat(64)), false);

  const managerBoard = `${"M".repeat(40)}${"P".repeat(24)}`;
  assert.deepEqual(rules.othelloOutcome(managerBoard, 5), { result: "lost", manager: 40, payer: 24, stones: 16, penalty: 80 });
  assert.deepEqual(rules.othelloOutcome(`${"M".repeat(32)}${"P".repeat(32)}`, 10), { result: "draw", manager: 32, payer: 32, stones: 0, penalty: 0 });
  assert.deepEqual(rules.othelloOutcome(`${"M".repeat(20)}${"P".repeat(44)}`, 10), { result: "won", manager: 20, payer: 44, stones: 0, penalty: 0 });
  assert.deepEqual(rules.othelloOutcome(`${"M".repeat(20)}${"P".repeat(44)}`, 10, { resigned: true }).penalty, 10, "a resign while ahead still costs one stone");
  assert.equal(rules.othelloOutcome(managerBoard, 7).penalty, 0, "an unknown rate never makes a penalty");

  assert.deepEqual(rules.normalizeOthelloStart({ rate: 5, handicap: "payer_corner", managerFirst: true }), { rate: 5, handicap: "payer_corner", managerFirst: true });
  assert.deepEqual(rules.normalizeOthelloStart({ rate: "10", handicap: "bogus" }), { rate: 10, handicap: "none", managerFirst: false });
  assert.match(rules.normalizeOthelloStart({ rate: 3 }).error, /1枚あたりの額/);
  const application = { caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true };
  assert.equal(rules.normalizeApplication(application).application.allowOthello, false, "old screens never opt in");
  assert.equal(rules.normalizeApplication({ ...application, allowOthello: true }).application.allowOthello, true);
});

test("the note lines: four situations by type and tone, the same rules as request notes, no sexual words", async () => {
  const core = await loadCore();
  assert.deepEqual(core.OTHELLO_SITUATIONS.map((entry) => entry.id), ["corner", "flip", "pass", "finish"]);
  assert.deepEqual(Object.keys(core.OTHELLO_LINES), ["", ...rules.MANAGER_STYLES]);
  const banned = /死|殺|自殺|消えろ|首吊|殴|刺す|晒|特定|ばら|上限を上げ|上げろ|逃げ|逃が|解約したら|やめたら|許さない|裏切|♥|今だけ|あなただけ|お願い|ください/u;
  const all = [];
  for (const [id, set] of Object.entries(core.OTHELLO_LINES)) {
    assert.deepEqual(Object.keys(set), ["corner", "flip", "pass", "finish"], id);
    for (const lines of Object.values(set)) {
      assert.equal(lines.length, 3, `${id}: sweet, normal, harsh`);
      for (const line of lines) {
        all.push(line);
        assert.doesNotMatch(line, banned, line);
        assert.doesNotMatch(line, /♡(?!$)/u, `${line}: ♡ only at the end`);
        assert.equal(rules.forbiddenReason(line), "", line);
        assert.equal(rules.boardSexualWord(line), false, line);
        assert.ok(line.length <= rules.LIMITS.requestNote, line);
      }
    }
  }
  assert.equal(new Set(all).size, all.length, "no line repeats");

  assert.deepEqual(core.othelloLinesFor({ styles: [], tone: "sweet", situation: "corner" }), [core.OTHELLO_LINES[""].corner[0]]);
  assert.deepEqual(core.othelloLinesFor({ styles: ["tease"], tone: "harsh", situation: "pass" }), [...core.OTHELLO_LINES.tease.pass].reverse(), "strongest first");
  assert.deepEqual(core.othelloLinesFor({ styles: ["aloof", "insight"], tone: "normal", situation: "finish" }), [
    core.OTHELLO_LINES.insight.finish[1], core.OTHELLO_LINES.insight.finish[0], core.OTHELLO_LINES.aloof.finish[1], core.OTHELLO_LINES.aloof.finish[0],
  ]);
  assert.deepEqual(core.othelloLinesFor({ styles: ["harsh"], tone: "normal", situation: "flip" }), core.othelloLinesFor({ tone: "normal", situation: "flip" }), "an old type reads as no type");
  assert.equal(core.othelloLinesFor({ styles: ["aloof"], tone: "harsh", situation: "finish", ngWords: ["罰金"] }).some((line) => line.includes("罰金")), false);
});

test("todos, the penalty label and the view: a turn is a todo for whoever moves, an unpaid penalty for the payer", async () => {
  const core = await loadCore();
  const board = core.othelloInitialBoard();
  const raw = {
    contractId: "c".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: 1, expiresAt: Date.now() + 86_400_000,
    eventSeq: 1, readSeq: { manager: 1, payer: 1 }, caps: { perTribute: 100, perDay: 300, total: 1_000 }, tone: "harsh",
    allowOthello: true, othello: { gameSeq: 2, board, turn: "payer", rate: 5, handicap: "none", startedAt: 1, lastMoveAt: 1, lastMove: null },
  };
  const payer = core.viewContract(raw, "payer");
  const manager = core.viewContract(raw, "manager");
  assert.equal(payer.allowOthello, true);
  assert.deepEqual(payer.othello.counts, { manager: 2, payer: 2, empty: 60 });
  assert.deepEqual(core.contractTodos([payer]).map((todo) => todo.kind), ["othello_turn"]);
  assert.deepEqual(core.contractTodos([manager]), []);
  const ended = core.viewContract({ ...raw, status: "ended" }, "payer");
  assert.equal(ended.othello, null, "an ended contract shows no game");

  const owed = { ...raw, othello: null, othelloResult: { gameSeq: 2, penalty: 40, stones: 8, rate: 5, resigned: false, finishedAt: 2 }, othelloRecord: { played: 3, lost: 3, streak: 3 } };
  assert.deepEqual(core.contractTodos([core.viewContract(owed, "payer")]).map((todo) => todo.kind), ["othello_penalty"]);
  assert.deepEqual(core.contractTodos([core.viewContract(owed, "manager")]), []);
  assert.deepEqual(core.viewContract(owed, "manager").othelloRecord, { played: 3, lost: 3, won: 0, drawn: 0, streak: 3 });
  assert.equal(core.viewContract({ ...owed, othelloResult: { penalty: 0 } }, "payer").othelloResult, null);
  assert.equal(core.viewContract({ ...raw, othello: { ...raw.othello, board: "bad" } }, "payer").othello, null);

  assert.equal(core.tributeKindLabel({ kind: "silent", othello: 2 }), "貢ぎオセロの罰金");
  assert.equal(core.tributeKindLabel({ kind: "request", othello: 2 }), "貢ぎオセロの罰金");
  assert.equal(core.tributeKindLabel({ kind: "silent", granted: true, othello: 2 }), core.GRANTED_LABEL);
});

async function othelloRenderer() {
  const core = await loadCore();
  const context = vm.createContext({ ...core, escapeHtml: String, state: { profile: { card: { styles: ["tease"] } }, thread: {} } });
  vm.runInContext([
    /const OTHELLO_HANDICAP_LABELS = [^\n]*\n/.exec(client)[0],
    /const OTHELLO_COLUMNS = [^\n]*\n/.exec(client)[0],
    ...["sigilColor", "othelloCellName", "othelloRecordText", "othelloPayable", "renderOthelloNoteChips", "renderOthello"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return (raw, uid, { demo = false } = {}) => {
    context.state.thread = { demo };
    return context.renderOthello(core.viewContract(raw, uid));
  };
}

test("the panel: the side to move gets the playable cells, the other side waits; results go to give or claim", async () => {
  const core = await loadCore();
  const render = await othelloRenderer();
  const board = core.othelloInitialBoard("manager_corner");
  const raw = {
    contractId: "d".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: 1, expiresAt: Date.now() + 86_400_000,
    eventSeq: 1, readSeq: { manager: 1, payer: 1 }, caps: { perTribute: 100, perDay: 300, total: 1_000 }, tone: "harsh",
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowOthello: true,
    othello: { gameSeq: 1, board, turn: "manager", rate: 10, handicap: "manager_corner", startedAt: 1, lastMoveAt: 1, lastMove: null },
  };
  const managerHtml = render(raw, "manager");
  assert.equal((managerHtml.match(/data-t="othello-move"/g) || []).length, core.othelloMoves(board, "M").length);
  assert.equal((managerHtml.match(/class="tribute-othello-cell/g) || []).length, 64);
  assert.match(managerHtml, /data-othello-note/);
  assert.match(managerHtml, /data-t="othello-note-pick"/, "the manager gets note chips by type");
  assert.match(managerHtml, /data-t="othello-end"/);
  assert.doesNotMatch(managerHtml, /othello-resign/);
  assert.match(managerHtml, /管理人が角を1つ持って始める/);

  const payerHtml = render(raw, "payer");
  assert.doesNotMatch(payerHtml, /data-t="othello-move"/);
  assert.doesNotMatch(payerHtml, /data-othello-note/);
  assert.match(payerHtml, /手番に期限はありません/);
  assert.match(payerHtml, /data-sheet="othello-resign"/);
  assert.equal(render({ ...raw, othello: { ...raw.othello, turn: "payer" } }, "payer").match(/data-t="othello-move"/g).length, core.othelloMoves(board, "P").length);
  assert.doesNotMatch(render({ ...raw, othello: { ...raw.othello, turn: "payer" } }, "payer"), /othello-note-pick/, "the payer writes their own words");

  const owed = { ...raw, othello: null, othelloResult: { gameSeq: 1, penalty: 150, stones: 15, rate: 10, resigned: false, finishedAt: 2 }, othelloRecord: { played: 2, lost: 2, streak: 2 } };
  const payerOwed = render(owed, "payer");
  assert.match(payerOwed, /data-t="give-othello">罰金 100 Pay を差し出す/, "capped at one tribute");
  assert.match(payerOwed, /1回の限度額まで/);
  assert.match(payerOwed, /通算2戦2敗（2連敗中）/);
  const managerOwed = render(owed, "manager");
  assert.match(managerOwed, /data-t="othello-claim"/);
  assert.match(managerOwed, /data-sheet="recite-order"/);
  assert.doesNotMatch(managerOwed, /give-othello/);

  assert.match(render({ ...raw, othello: null }, "manager"), /data-sheet="othello-start"/);
  assert.equal(render({ ...raw, othello: null }, "payer"), "", "no record yet, nothing to show the payer");
  assert.equal(render({ ...raw, othello: null, allowOthello: false }, "manager"), "");
  assert.equal(render(raw, "manager", { demo: true }), "", "never in the demo thread");
  assert.equal(render({ ...raw, status: "pending" }, "manager"), "");
});

test("client wiring: consent on the application, settings, start sheet, moves, events, the penalty give and the result image", () => {
  assert.match(client, /<input type="checkbox" name="allowOthello" \$\{checked\("allowOthello", true\)\} \/>/);
  assert.match(client, /allowOthello: data\.get\("allowOthello"\) === "on",/);
  assert.match(client, /<div id="tributeOthello">\$\{renderOthello\(view\)\}<\/div>/);
  assert.match(client, /const othelloPanel = document\.querySelector\("#tributeOthello"\);/);
  for (const sheet of ["othello-settings", "othello-start", "othello-resign"]) assert.match(client, new RegExp(`case "${sheet}": \\{`), sheet);
  for (const action of ["set_othello", "othello_start", "othello_move", "othello_resign", "othello_end", "othello_claim"]) {
    assert.match(client, new RegExp(`mutate\\("${action}"`), action);
    assert.match(client, new RegExp(`case "${action}": \\{`), `${action} preview`);
    assert.match(service, new RegExp(`\\n    ${action}: \\{`), `${action} on the server`);
  }
  for (const type of ["othello_setting", "othello_start", "othello_move", "othello_pass", "othello_finish", "othello_end", "othello_stopped"]) {
    assert.match(client, new RegExp(`case "${type}":`), type);
    assert.match(service, new RegExp(`type: "${type}"`), type);
  }
  assert.match(client, /kind: sheet\.othello \? "othello" : sheet\.contest \? "contest" : sheet\.granted \? "granted" : sheet\.requestId \? "request" : "silent",/);
  assert.match(client, /openSheet\("give", \{ othello: true, amount: othelloPayable\(view, result\), purpose: "penalty", step: "hold" \}\);/);
  assert.match(client, /if \(sheet\.mode === "othello"\) return `omitsugi-othello-\$\{stamp\}\.png`;/);
  assert.match(client, /\? await renderOthelloImage\(shareOthelloData\(sheet\), sheet\.options\)/);
  const data = extract(client, "shareOthelloData");
  assert.equal((data.match(/\n    manager:/g) || []).length, 1, "the stone count never overwrites the manager card");
  assert.match(data, /managerStones: Number\(finish\.manager\) \|\| 0,/);
  assert.match(client, /const options = sheet\.mode === "othello" \? SHARE_OPTIONS\.filter\(\(option\) => option\.key === "amount" \|\| option\.key === "wallet"\) : SHARE_OPTIONS;/, "the result image has no purpose, seals or rewards to choose");
  assert.match(share, /export async function renderOthelloImage\(data, options = \{\}\) \{/);
  assert.match(share, /Number\(data\.payerStones\)/);
  assert.match(share, /show\.amount \? `\$\{formatPayNumber\(data\.penalty\)\} Pay` : "＊＊＊ Pay"/);
  assert.match(service, /\} else if \(requested === "othello"\) \{/);
  assert.match(service, /const note = "貢ぎオセロの罰金";/);
  for (const selector of [".tribute-othello {", ".tribute-othello-board {", ".tribute-othello-cell.is-manager", ".tribute-othello-cell.is-payer", ".tribute-othello-cell.is-playable", ".tribute-othello-cell.is-last", ".tribute-othello-situations", ".tribute-othello-finish"]) {
    assert.ok(styles.includes(selector), selector);
  }
});

test("cache keys and the design record", () => {
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*ranch-othello-v1(?:-[a-z0-9-]+)?"/);
  assert.match(client, /from "\.\/tribute-share\.mjs\?v=[^"]*ranch-othello-v1(?:-[a-z0-9-]+)?"/);
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) {
    assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-othello-v1(?:-[a-z0-9-]+)?"`), name);
  }
  assert.match(design, /第2段（貢ぎオセロ）を実装した/);
  assert.match(design, /othello_finish/);
  assert.doesNotMatch(design, /othello_resign`? という出来事/);
});
