const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const gazeModule = import(pathToFileURL(path.join(root, "strategy-dm-gaze.mjs")).href);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, end);
  return source.slice(from, to);
};

const ME = "me";
const RIVAL = "rival";
const scoreFor = (slot, actor = ME) => ({ slot, stage: "score", actor });
const has = () => true;

test("gaze stays open while the scene does not move, even on my own turn", async () => {
  const { nextStrategyGazeSlot } = await gazeModule;
  const myAct = { slot: 6, stage: "act", actor: ME };
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: myAct, pending: myAct, uid: ME, hasImage: has }), 3, "opened by hand on my turn");
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 5, previousPending: scoreFor(5), pending: scoreFor(5), uid: ME, hasImage: has }), 5);
  // 相手が次の1枚を選んでいる・送っている間は開いたまま
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: { slot: 6, stage: "act", actor: RIVAL }, pending: { slot: 6, stage: "receive", actor: ME }, uid: ME, hasImage: has }), 3);
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: { slot: 6, stage: "receive", actor: ME }, pending: scoreFor(6), uid: ME, hasImage: has }), 3, "a new image waits behind a button, it does not jump");
});

test("gaze closes once my score for that image is in, on entering my turn, at the end, or without the image", async () => {
  const { nextStrategyGazeSlot } = await gazeModule;
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 5, previousPending: scoreFor(5), pending: { slot: 5, stage: "right", actor: RIVAL }, uid: ME, hasImage: has }), null);
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 5, previousPending: scoreFor(5), pending: { slot: 6, stage: "act", actor: ME }, uid: ME, hasImage: has }), null);
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: { slot: 5, stage: "answer", actor: ME }, pending: { slot: 6, stage: "act", actor: ME }, uid: ME, hasImage: has }), null, "entering my turn to post");
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: scoreFor(5), pending: scoreFor(5), uid: ME, outcome: { winner: ME }, hasImage: has }), null);
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: scoreFor(5), pending: scoreFor(5), uid: ME, hasImage: () => false }), null);
  assert.equal(nextStrategyGazeSlot({ gazeSlot: null, previousPending: null, pending: scoreFor(5), uid: ME, hasImage: has }), null, "it never opens by itself");
  // 相手の採点が終わっても、自分が見ている1枚は閉じない
  assert.equal(nextStrategyGazeSlot({ gazeSlot: 3, previousPending: scoreFor(4, RIVAL), pending: { slot: 4, stage: "right", actor: ME }, uid: ME, hasImage: has }), 3);
});

test("only my own pending score on the image being watched counts as scoring", async () => {
  const { strategyGazeScoring } = await gazeModule;
  assert.equal(strategyGazeScoring(5, scoreFor(5), ME), true);
  assert.equal(strategyGazeScoring(3, scoreFor(5), ME), false);
  assert.equal(strategyGazeScoring(5, scoreFor(5, RIVAL), ME), false);
  assert.equal(strategyGazeScoring(5, { slot: 5, stage: "right", actor: ME }, ME), false);
  assert.equal(strategyGazeScoring(null, scoreFor(5), ME), false);
  assert.equal(strategyGazeScoring(5, null, ME), false);
});

test("the overlay takes the newest chats in thread order", async () => {
  const { recentStrategyGazeChatIds, STRATEGY_GAZE_RECENT_LIMIT } = await gazeModule;
  const entries = [
    { kind: "chat", id: "a" },
    { kind: "post", slot: 1 },
    { kind: "chat", id: "b" },
    { kind: "video", id: "v" },
    { kind: "chat", id: "c" },
    { kind: "chat", id: "d" },
  ];
  assert.equal(STRATEGY_GAZE_RECENT_LIMIT, 3);
  assert.deepEqual(recentStrategyGazeChatIds(entries), ["b", "c", "d"]);
  assert.deepEqual(recentStrategyGazeChatIds(entries, 1), ["d"]);
  assert.deepEqual(recentStrategyGazeChatIds(null), []);
});

test("gaze opens from opening an image or tapping one, reuses the normal look, and scores with the same inputs", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /from "\.\/strategy-dm-gaze\.mjs\?v=strategy-dm-gaze-v1";/);
  assert.match(strategy, /import \{ clampGazeZoom, gazeLineOpacity, toggleGazeZoom, zoomGazeAt \} from "\.\/normal-dm-gaze\.mjs\?v=normal-dm-gaze-v1";/);
  // 開く：相手の1枚を開いた時（設定がオンなら）と、スレッドの画像を押した時
  const open = between(strategy, "async function openHariaiMedia(key)", "async function playHariaiFinish(");
  assert.match(open, /if \(kind === "move" && strategyGazeAuto && state\.screen === "battle" && strategyGazeImage\(Number\(slot\)\)\) setStrategyGazeSlot\(Number\(slot\)\);\n  else if \(pending\?\.stage === "score"/);
  assert.match(strategy, /const gazeable = !concealed && slot\.by !== state\.uid && state\.screen === "battle";/);
  assert.match(strategy, /const gaze = event\.target\.closest\("\[data-sd-gaze-open\]"\);\n    if \(gaze\) openStrategyGaze\(Number\(gaze\.dataset\.sdGazeOpen\)\);/);
  // 見られるのは開いた相手の1枚だけ。閉じる判断は描くたびに
  assert.match(between(strategy, "function strategyGazeImage(slotNumber)", "function syncStrategyGaze()"), /return item\?\.url && state\.openedMediaKeys\.has\(key\) \? item : null;/);
  const battle = between(strategy, "function renderBattle()", "function strategyWideLayout()");
  assert.match(battle, /syncStrategyThreadLog\(\);\n  syncStrategyGaze\(\);/);
  assert.match(battle, /const sheet = gazing && strategyGazeScoring\(strategyGazeSlot, replay\.pending, state\.uid\) \? "" : renderStrategySheet\(\);/);
  assert.match(battle, /\$\{gazing \? renderStrategyGaze\(typing\) : `<div class="vb-dm sd-dm/);
  // 見た目は通常型の vb-gaze-*。画像だけ・閉じる・重ねるチャット・操作・入力欄
  const gaze = between(strategy, "function renderStrategyGaze(typing)", "function renderStrategyGazeChatLines()");
  for (const part of ['class="vb-dm sd-dm vb-gaze sd-gaze', "data-gaze-stage", "data-gaze-image", "data-sd-gaze-close", "data-sd-gaze-chrome", "data-sd-gaze-chat", 'class="vb-dm-dock vb-gaze-dock"', "${renderStrategyComposer()}", "data-gaze-restore"]) {
    assert.ok(gaze.includes(part), part);
  }
  // 見ながら採点：シートと同じ id・data 属性で、下書きと送信を共有する
  const score = between(strategy, "function renderStrategyGazeScore(pending)", "function strategyGazeScoreKo(");
  for (const part of ["data-hariai-score=", 'id="hariaiScoreNumber"', 'id="hariaiReply"', "data-hariai-score-submit", "data-sd-gaze-sheet"]) {
    assert.ok(score.includes(part), part);
  }
  // シートを開く時は閉じる。チャットが届いた時は重ねている吹き出しだけ差し替える。Escape で閉じる
  assert.match(between(strategy, "function setStrategySheetOpen(open)", "function setStrategySideOpen("), /if \(strategySheetFor\) setStrategyGazeSlot\(null\);/);
  assert.match(between(strategy, "function refreshStrategyThread()", "function stickStrategyThreadIfFollowing()"), /gazeChat\.innerHTML = renderStrategyGazeChatLines\(\);/);
  assert.match(strategy, /if \(event\.key !== "Escape" \|\| !active \|\| !document\.querySelector\("\[data-sd-gaze\]"\)\) return;/);
  // 設定は端末に保存し、最初はオン
  assert.match(strategy, /const STRATEGY_GAZE_AUTO_KEY = "hariai-stadium-strategy-gaze-auto-v1";/);
  assert.match(between(strategy, "function readStrategyGazeAutoSetting()", "function setStrategyGazeAuto("), /return localStorage\.getItem\(STRATEGY_GAZE_AUTO_KEY\) !== "0";/);
  assert.match(between(strategy, "function renderStrategyDmHead()", "function strategySheetKey("), /aria-checked="\$\{strategyGazeAuto\}" aria-labelledby="strategyGazeAutoLabel" data-sd-gaze-auto>/);
  // 見本画面に「見つめる・採点」
  assert.match(strategy, /\["gaze", "見つめる・採点"\],/);
});

test("the gaze styles, cache keys and the new module ship together", () => {
  const css = read("strategy.css");
  assert.match(css, /\.hariai-media \.hariai-gaze-open \{\n  position: absolute;\n  inset: 0;/);
  assert.match(css, /\.sd-gaze \.vb-gaze-bottom > \.vb-gaze-dock \{\n  flex-shrink: 0;\n\}/);
  assert.match(css, /@media \(max-height: 760px\) \{\n  \.sd-gaze \.vb-gaze-line:nth-last-child\(n \+ 3\) \{\n    display: none;/);
  const html = read("index.html");
  assert.match(html, /data-src="strategy\.css\?v=[^"]*-strategy-dm-gaze-v1"/);
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-dm-gaze-v1(?:-[^"]+)?"/);
  // 新しいモジュールは公開する（設計書・テストは公開しない）
  const ignore = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(!ignore.some((entry) => entry === "strategy-dm-gaze.mjs"));
  assert.doesNotMatch(read(".assetsignore"), /^strategy-dm-gaze\.mjs$/m);
});
