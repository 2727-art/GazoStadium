const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const threadModule = import(pathToFileURL(path.join(root, "strategy-dm-thread.mjs")).href);

const POST = { slot: 1, kind: "post", by: "a", receiver: "b" };
const SCORED = { ...POST, score: 91 };
const ANSWERED = { ...SCORED, right: { kind: "question", id: "spot" }, answer: { text: "うなじ" } };

test("a post splits into posted, scored, right and answer as each one happens", async () => {
  const { slotEventKeys } = await threadModule;
  assert.deepEqual(slotEventKeys(POST), ["post:1"]);
  assert.deepEqual(slotEventKeys(SCORED), ["post:1", "score:1"]);
  assert.deepEqual(slotEventKeys({ ...SCORED, score: 0 }), ["post:1", "score:1"], "a zero is still a score");
  assert.deepEqual(slotEventKeys({ ...SCORED, right: { kind: "none" } }), ["post:1", "score:1", "right:1"]);
  assert.deepEqual(slotEventKeys(ANSWERED), ["post:1", "score:1", "right:1", "answer:1"]);
});

test("a break shows the call, then the check, then the finish (even a finish of zero cards)", async () => {
  const { slotEventKeys } = await threadModule;
  const call = { slot: 7, kind: "break", by: "a", receiver: "b", guess: 0 };
  assert.deepEqual(slotEventKeys(call), ["break:7"]);
  assert.deepEqual(slotEventKeys({ ...call, breakResult: "miss" }), ["break:7", "breakResult:7"]);
  assert.deepEqual(slotEventKeys({ ...call, breakResult: "hit", finishCount: 0 }), ["break:7", "breakResult:7", "finish:7"]);
  assert.deepEqual(slotEventKeys({ slot: 3, kind: "pass" }), ["pass:3"]);
  assert.deepEqual(slotEventKeys({ slot: 4, kind: "surrender" }), ["surrender:4"]);
  assert.deepEqual(slotEventKeys({ slot: 0, kind: "post" }), []);
  assert.deepEqual(slotEventKeys({ slot: 2, kind: "unknown" }), []);
});

test("events found at once go scout chat, start, moves by slot, battle chat and video, outcome", async () => {
  const { collectStrategyThreadKeys } = await threadModule;
  const keys = collectStrategyThreadKeys({
    slots: [{ slot: 2, kind: "post", score: 64 }, ANSWERED],
    chats: [
      { id: "s1", phase: "scout" },
      { id: "c1", phase: "battle" },
      { id: "r1", phase: "review" },
      { id: "bad id", phase: "battle" },
      { id: "s2", phase: "scout" },
    ],
    videoIds: ["v1", ""],
    outcome: true,
  });
  assert.deepEqual(keys, [
    "chat:s1", "chat:s2", "start",
    "post:1", "score:1", "right:1", "answer:1", "post:2", "score:2",
    "chat:c1", "video:v1", "outcome",
  ]);
  assert.deepEqual(collectStrategyThreadKeys(), ["start"]);
});

test("the log keeps the order things were first seen, so chat lands between a post and its score", async () => {
  const { appendStrategyThreadEntries, collectStrategyThreadKeys, orderedStrategyThreadEntries } = await threadModule;
  let log = appendStrategyThreadEntries([], collectStrategyThreadKeys({ slots: [POST] }));
  log = appendStrategyThreadEntries(log, collectStrategyThreadKeys({ slots: [POST], chats: [{ id: "c1", phase: "battle" }] }));
  log = appendStrategyThreadEntries(log, collectStrategyThreadKeys({ slots: [SCORED], chats: [{ id: "c1", phase: "battle" }] }));
  assert.deepEqual(log.map((entry) => [entry.key, entry.seq]), [["start", 1], ["post:1", 2], ["chat:c1", 3], ["score:1", 4]]);
  const unchanged = appendStrategyThreadEntries(log, ["post:1", "bogus", "score:0", "chat:", "start"]);
  assert.equal(unchanged, log, "nothing new returns the same log");
  const ordered = orderedStrategyThreadEntries(log, { chatIds: ["c1"] });
  assert.deepEqual(ordered.map((entry) => entry.key), ["start", "post:1", "chat:c1", "score:1"]);
  assert.deepEqual(ordered[1], { kind: "post", slot: 1, key: "post:1", seq: 2 });
});

test("chat trimmed out of the window and released video drop out of the drawn thread", async () => {
  const { appendStrategyThreadEntries, orderedStrategyThreadEntries } = await threadModule;
  const log = appendStrategyThreadEntries([], ["chat:a", "start", "video:v1", "chat:b", "outcome"]);
  assert.deepEqual(
    orderedStrategyThreadEntries(log, { chatIds: ["b"], videoIds: [] }).map((entry) => entry.key),
    ["start", "chat:b", "outcome"],
  );
});

test("keys round-trip and reject anything that is not a thread event", async () => {
  const { parseStrategyThreadKey, strategyThreadKey } = await threadModule;
  assert.equal(strategyThreadKey("start", 9), "start");
  assert.equal(strategyThreadKey("breakResult", 4), "breakResult:4");
  assert.deepEqual(parseStrategyThreadKey("video:abc_DEF-12"), { kind: "video", id: "abc_DEF-12" });
  assert.deepEqual(parseStrategyThreadKey("finish:12"), { kind: "finish", slot: 12 });
  ["", "start:1", "post:0", "post:1.5", "post:x", "chat:a b", "reveal", "t:1:caption"].forEach((key) => {
    assert.equal(parseStrategyThreadKey(key), null, key);
  });
});

const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, end);
  return source.slice(from, to);
};

test("the battle runs as one DM: header, thread, band, sheet and composer, with no separate chat panel", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /from "\.\/strategy-dm-thread\.mjs\?v=strategy-dm-thread-v1";/);
  const battle = between(strategy, "function renderBattle()", "function strategyThreadChats()");
  for (const part of ["renderStrategyDmHead()", "renderStrategyThreadItems()", "renderStrategyBand()", "renderStrategySheet()", "renderStrategyComposer()"]) {
    assert.ok(battle.includes(part), part);
  }
  assert.doesNotMatch(battle, /renderStrategyChat\(\)|renderBattleHud\(\)|renderStrategyVideoPanel\(\)/);
  assert.match(strategy, /if \(isStrategyChatVisible\(\) && state\.screen !== "battle"\) app\.querySelector\("\.screen"\)\?\.insertAdjacentHTML\("afterend", renderStrategyChatDock\(\)\);/);
  // 描き直しでは画像・映像の要素を使い回し、スレッドを読み返している位置を保つ。
  const render = between(strategy, "function render() {", "function renderProfile()");
  assert.match(render, /const threadNodes = screenChanged \? new Map\(\) : collectStrategyThreadNodes\(\);/);
  assert.match(render, /reuseStrategyThreadNodes\(threadNodes\);/);
  assert.match(render, /if \(state\.screen === "battle"\) settleStrategyThreadLayout\(\{ follow: screenChanged \}\);/);
  // 操作シートは、スマホではスレッドの下、PC（901px以上）では右の列の一番上。幅をまたいだら描き直す。
  assert.match(battle, /\$\{sheetInThread \? "" : renderStrategyBand\(\)\}\$\{sheetInSide \? "" : sheet\}\$\{renderStrategyComposer\(\)\}/);
  assert.match(battle, /aria-label="あなたの番の操作・読みメモ・あなたの秘密">\n      \$\{sheetInSide \? sheet : ""\}/);
  assert.match(strategy, /return Boolean\(window\.matchMedia\?\.\("\(min-width: 901px\)"\)\.matches\);/);
  assert.match(strategy, /if \(crossed\) render\(\);\n  else settleStrategyThreadLayout\(\);/);
  // チャット・映像が届いた時は、スレッドの中身だけを差し替える。
  assert.match(between(strategy, "function refreshStrategyChat(", "function setStrategyChatEffect("), /if \(refreshStrategyThread\(\)\) return;/);
  assert.match(between(strategy, "function refreshStrategyVideoPanel()", "function ensureStrategyVideoDialog()"), /refreshStrategyThread\(\);\n    refreshStrategyCameraButton\(\);/);
});

test("chat, video and reactions keep their existing wire format and limits", () => {
  const strategy = read("strategy.js");
  const composer = between(strategy, "function renderStrategyComposer()", "function renderHariaiThread()");
  assert.match(composer, /data-strategy-chat>/);
  assert.match(composer, /\$\{renderStrategyCameraButton\(\)\}/);
  assert.match(composer, /id="strategyChatInput" maxlength="80" value="\$\{escapeHtml\(state\.chatDraft\)\}"/);
  assert.match(between(strategy, "function renderStrategyCameraButton()", "function refreshStrategyCameraButton()"), /data-strategy-video-open \$\{video\.canRecord \? "" : "disabled"\}/);
  // 映像は自動再生しない。
  const video = between(strategy, "function renderStrategyThreadVideo(clip)", "function collectStrategyThreadNodes()");
  assert.match(video, /<video controls controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata"/);
  assert.doesNotMatch(video, /autoplay/);
  // リアクションの宛先キーは、吹き出しを分けても変えない。
  for (const key of ["caption", "reply", "right", "answer", "break"]) {
    assert.ok(strategy.includes(`hariaiReactable(\`t:\${slot.slot}:${key}\``), key);
  }
  assert.match(strategy, /if \(state\.chatMessages\.length > STRATEGY_THREAD_CHAT_LIMIT\) state\.chatMessages\.shift\(\);/);
  assert.match(strategy, /limitToLast\(60\)/, "the first read stays at the last 60 messages");
  const blocked = strategy.match(/const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "([^"]+)";/)[1];
  for (const control of ["[data-strategy-chat-reaction]", "[data-strategy-chat-stamp]", "[data-strategy-video-open]"]) {
    assert.ok(blocked.includes(control), `${control} is blocked in the preview`);
  }
});

test("the new module, styles and design note ship with fresh cache keys and the note stays private", () => {
  const html = read("index.html");
  assert.match(html, /data-src="strategy\.css\?v=[^"]*-strategy-dm-thread-v1"/);
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-dm-thread-v1[^"]*"/);
  // 画像が手の記録より先に着いた時の受信の書き込みを直した版（2026-11-03）。
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-media-ack-v1"/);
  const firebase = JSON.parse(read("firebase.json"));
  assert.ok(firebase.hosting.ignore.includes("STRATEGY_DM_THREAD_DESIGN.md"));
  assert.match(read(".assetsignore"), /^STRATEGY_DM_THREAD_DESIGN\.md$/m);
  const css = read("strategy.css");
  assert.match(css, /\.sd-dm\.has-sheet \.vb-dm-gauges \{\n    display: none;\n  \}/);
  // 右の列は中身の高さのまま積む（操作シートがメモに重ならない）。点数の吹き出しはメーターが読める幅。
  assert.match(css, /grid-auto-rows: max-content;/);
  assert.match(css, /\.hariai-thread \.ha-bubble\.hariai-score \{\n  display: grid;\n  min-width: 236px;/);
});

test("the signature changes with the content and stays the same for the same html", async () => {
  const { strategyThreadSignature } = await threadModule;
  const html = '<img src="blob:1" alt="">';
  assert.equal(strategyThreadSignature(html), strategyThreadSignature(html));
  assert.notEqual(strategyThreadSignature(html), strategyThreadSignature(`${html} `));
  assert.notEqual(strategyThreadSignature("ab"), strategyThreadSignature("ba"));
  assert.match(strategyThreadSignature(""), /^0\.[0-9a-z]+$/);
});
