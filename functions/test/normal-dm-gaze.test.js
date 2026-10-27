const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const gazeModule = import(pathToFileURL(path.join(root, "normal-dm-gaze.mjs")).href);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  let depth = 0;
  for (let cursor = source.indexOf(") {", start) + 2; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name} incomplete`);
}

const withImages = (...rounds) => (round) => rounds.includes(round);

test("gaze mode never opens while the next card is being picked", async () => {
  const { canGaze, nextGazeRound } = await gazeModule;
  assert.equal(canGaze("select"), false);
  assert.equal(canGaze("connecting"), false);
  assert.equal(canGaze("gameover"), false);
  for (const screen of ["waitingPick", "waitingImage", "reveal", "score", "waitingScore", "result", "waitingContinue"]) {
    assert.equal(canGaze(screen), true, screen);
  }
  assert.deepEqual(
    nextGazeRound({ previousScreen: "waitingContinue", screen: "select", gazeRound: 2, round: 3, hasImage: withImages(2) }),
    { gazeRound: null, autoOpened: false },
  );
});

test("a revealed image opens gaze mode once per round when the setting is on", async () => {
  const { nextGazeRound } = await gazeModule;
  const base = { previousScreen: "waitingImage", screen: "reveal", gazeRound: null, round: 3, hasImage: withImages(3) };
  assert.deepEqual(nextGazeRound(base), { gazeRound: 3, autoOpened: true });
  assert.deepEqual(nextGazeRound({ ...base, autoOpen: false }), { gazeRound: null, autoOpened: false });
  assert.deepEqual(nextGazeRound({ ...base, autoOpenedRounds: [3] }), { gazeRound: null, autoOpened: false }, "closing it keeps it closed");
  assert.deepEqual(nextGazeRound({ ...base, hasImage: withImages() }), { gazeRound: null, autoOpened: false });
  assert.deepEqual(
    nextGazeRound({ ...base, previousScreen: "reveal" }),
    { gazeRound: null, autoOpened: false },
    "a same-screen redraw does not reopen it",
  );
});

test("gaze mode closes when the scores arrive but stays open while waiting", async () => {
  const { nextGazeRound } = await gazeModule;
  assert.deepEqual(
    nextGazeRound({ previousScreen: "waitingScore", screen: "result", gazeRound: 3, round: 3, hasImage: withImages(3) }),
    { gazeRound: null, autoOpened: false },
  );
  assert.deepEqual(
    nextGazeRound({ previousScreen: "result", screen: "result", gazeRound: 3, round: 3, hasImage: withImages(3) }),
    { gazeRound: 3, autoOpened: false },
    "reopening by hand on the result screen is allowed",
  );
  assert.deepEqual(
    nextGazeRound({ previousScreen: "reveal", screen: "waitingScore", gazeRound: 3, round: 3, hasImage: withImages(3) }),
    { gazeRound: 3, autoOpened: false },
  );
  assert.deepEqual(
    nextGazeRound({ previousScreen: "waitingScore", screen: "waitingScore", gazeRound: 1, round: 3, hasImage: withImages(3) }),
    { gazeRound: null, autoOpened: false },
    "an image that is no longer on the device closes",
  );
});

test("only the latest chat lines are overlaid, fading with age", async () => {
  const { recentGazeChatIds, gazeLineOpacity } = await gazeModule;
  const entries = [
    { kind: "chat", chatId: "a" }, { kind: "local", round: 1 }, { kind: "chat", chatId: "b" },
    { kind: "remote", round: 1 }, { kind: "chat", chatId: "c" }, { kind: "scores", round: 1 },
    { kind: "chat", chatId: "d" }, { kind: "chat", chatId: "e" }, { kind: "chat", chatId: "" },
  ];
  assert.deepEqual(recentGazeChatIds(entries), ["c", "d", "e"]);
  assert.deepEqual(recentGazeChatIds(entries, 2), ["d", "e"]);
  assert.deepEqual(recentGazeChatIds(null), []);
  assert.deepEqual([0, 1, 2, 9].map(gazeLineOpacity), [1, 0.72, 0.46, 0.46]);
});

test("zoom stays between 1x and 4x and never pans past the image edge", async () => {
  const { clampGazeZoom, zoomGazeAt, toggleGazeZoom } = await gazeModule;
  const size = { width: 300, height: 400 };
  assert.deepEqual(clampGazeZoom({ scale: 0.5, x: 40, y: 40 }, size), { scale: 1, x: 0, y: 0 });
  assert.deepEqual(clampGazeZoom({ scale: 9, x: 999, y: -999 }, size), { scale: 4, x: 450, y: -600 });
  assert.deepEqual(clampGazeZoom({ scale: 2, x: 100, y: 50 }, size), { scale: 2, x: 100, y: 50 });
  // 指の下の点は動かない：中心から (60, -40) の所で2倍にすると、画像は (-60, 40) だけずれる
  assert.deepEqual(zoomGazeAt({ scale: 1, x: 0, y: 0 }, 2, { x: 60, y: -40 }, size), { scale: 2, x: -60, y: 40 });
  const zoomed = toggleGazeZoom({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, size);
  assert.equal(zoomed.scale, 2.5);
  assert.deepEqual(toggleGazeZoom(zoomed, { x: 10, y: 10 }, size), { scale: 1, x: 0, y: 0 });
});

test("the DM thread opens gaze mode from the opponent photo and follows screen changes", () => {
  const online = read("online.js");
  assert.match(online, /from "\.\/normal-dm-gaze\.mjs\?v=normal-dm-gaze-v1";/);
  // 画面を描く前に、前の画面との違いで開閉を決める
  assert.match(extractFunction(online, "render"), /syncGazeWithScreen\(lastRenderedScreen\);[\s\S]*appRoot\.innerHTML =/);
  assert.match(extractFunction(online, "renderDmScreen"), /if \(state\.gazeRound !== null && canGaze\(state\.screen\)\) return renderGazeScreen\(/);
  // 選ぶ画面だけは、これまで通りの拡大表示
  const remotePost = extractFunction(online, "renderThreadRemotePost");
  assert.match(remotePost, /const gaze = canGaze\(state\.screen\);/);
  assert.match(remotePost, /data-dm-gaze-open="\$\{round\}"/);
  assert.match(remotePost, /data-zoom-src=/);
  assert.match(remotePost, /variant: gaze \? "gaze" : "zoom"/);
});

test("gaze mode keeps the chat, scoring and composer on one screen", () => {
  const online = read("online.js");
  const screen = extractFunction(online, "renderGazeScreen");
  for (const part of ["data-gaze-close", "data-gaze-chrome", "data-gaze-stage", "data-gaze-image", 'id="onlineChatMessages" data-gaze-chat', 'id="onlineChatTyping"', "renderDmComposer(", "data-gaze-restore", "data-online-opponent-presence"]) {
    assert.ok(screen.includes(part), part);
  }
  // 前のラウンドの1枚を見ている間は、採点の代わりに今の1枚へ移る
  assert.match(screen, /scoring && !current[\s\S]*data-gaze-current/);
  assert.match(extractFunction(online, "renderScore"), /gazeTail: ""/);
  // チャットが届いた時は、重ねている吹き出しだけを入れ替える
  assert.match(extractFunction(online, "refreshDmThread"), /gazeChat\.innerHTML = renderGazeChatLines\(\);/);
  assert.match(online, /fx\.play\(root, key, \[[\s\S]*root\.matches\("\.vb-gaze\.is-arriving"\)/);
});

test("the auto-open setting lives on the device and in the battle menu", () => {
  const online = read("online.js");
  assert.match(online, /const GAZE_AUTO_OPEN_KEY = "hariai-stadium-online-gaze-auto-v1";/);
  assert.match(online, /gazeAutoOpen: localStorage\.getItem\(GAZE_AUTO_OPEN_KEY\) !== "0",/);
  const menu = extractFunction(online, "renderBattleMenu");
  assert.match(menu, /role="switch" aria-checked="\$\{state\.gazeAutoOpen\}" aria-labelledby="onlineGazeAutoLabel" data-gaze-auto/);
  assert.match(extractFunction(online, "toggleGazeAutoOpen"), /localStorage\.setItem\(GAZE_AUTO_OPEN_KEY, state\.gazeAutoOpen \? "1" : "0"\);/);
});

test("gaze mode adds no new peer messages or stored data", () => {
  const online = read("online.js");
  assert.doesNotMatch(online, /type: "gaze/);
  assert.doesNotMatch(online, /gaze[^\n]*ref\(database/);
  const gaze = read("normal-dm-gaze.mjs");
  assert.doesNotMatch(gaze, /firebase|localStorage|document\.|window\./);
});

test("gaze mode styles keep zoom to the image-only view and fall back without blur", () => {
  const css = read("velvet-battle.css");
  assert.match(css, /\.vb-gaze\.is-clean \.vb-gaze-stage \{[^}]*touch-action: none;/);
  assert.match(css, /\.vb-gaze-stage \{[^}]*touch-action: manipulation;/);
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /transform: translateY\(calc\(-1 \* var\(--vb-gaze-keyboard, 0px\)\)\);/);
  const index = read("index.html");
  for (const asset of ["online\\.js", "velvet-battle\\.css"]) {
    assert.match(index, new RegExp(`${asset}\\?v=[^"]*normal-dm-thread-v1-normal-dm-gaze-v1(?:-ranch-premium-icons-v1)?"`));
  }
});
