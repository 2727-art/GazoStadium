const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const moduleUrl = pathToFileURL(path.join(root, "online-deck.mjs")).href;
const online = read("online.js");
const styles = read("styles.css");
const index = read("index.html");
const readme = read("README.md");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} block could not be extracted`);
  return source.slice(start, end);
}

test("normal 1on1 requires five images and accepts up to three optional reserves", async () => {
  const deck = await import(moduleUrl);

  assert.equal(deck.ONLINE_REQUIRED_IMAGE_COUNT, 5);
  assert.equal(deck.ONLINE_RESERVE_IMAGE_LIMIT, 3);
  assert.equal(deck.ONLINE_MAX_IMAGE_COUNT, 8);
  assert.equal(deck.isOnlineDeckReady(4), false);
  assert.equal(deck.isOnlineDeckReady(5), true);
  assert.equal(deck.isOnlineDeckReady(8), true);
  assert.equal(deck.isOnlineDeckReady(9), false);
});

test("setup counts required and reserve images without making reserves mandatory", async () => {
  const deck = await import(moduleUrl);

  assert.equal(deck.onlineRequiredImageCount(3), 3);
  assert.equal(deck.onlineRequiredImageCount(8), 5);
  assert.equal(deck.onlineReserveImageCount(5), 0);
  assert.equal(deck.onlineReserveImageCount(6), 1);
  assert.equal(deck.onlineReserveImageCount(8), 3);
  assert.equal(deck.onlineSampleFillCount(3), 2);
  assert.equal(deck.onlineSampleFillCount(5), 0);
  assert.equal(deck.onlineSampleFillCount(8), 0);
});

test("selection keeps a valid current choice and otherwise defaults to the first unused image", async () => {
  const deck = await import(moduleUrl);
  const cards = [
    { id: "used", used: true },
    { id: "first", used: false },
    { id: "reserve", used: false },
  ];

  assert.equal(deck.getDefaultAvailableCardId(cards, "reserve"), "reserve");
  assert.equal(deck.getDefaultAvailableCardId(cards, "used"), "first");
  assert.equal(deck.getDefaultAvailableCardId(cards), "first");
  assert.equal(deck.getDefaultAvailableCardId([{ id: "used", used: true }]), "");
});

test("normal 1on1 wires the 5-to-8 boundary into setup, upload, sample fill, and matchmaking", () => {
  assert.match(online, /const MAX_ROUNDS = 5;/);
  assert.match(online, /from "\.\/online-deck\.mjs\?v=online-deck-reserve-v1";/);
  assert.match(online, /\{ length: ONLINE_REQUIRED_IMAGE_COUNT \}/);
  assert.match(online, /\{ length: ONLINE_RESERVE_IMAGE_LIMIT \}/);
  assert.match(online, /state\.deck\.length >= ONLINE_MAX_IMAGE_COUNT \? "disabled" : ""/);
  assert.match(online, /state\.deck\.length >= ONLINE_MAX_IMAGE_COUNT \? "is-disabled" : ""/);
  assert.match(online, /最大\$\{ONLINE_MAX_IMAGE_COUNT\}枚登録済み/);
  assert.match(online, /const remaining = ONLINE_MAX_IMAGE_COUNT - state\.deck\.length;/);
  assert.match(online, /const remaining = onlineSampleFillCount\(state\.deck\.length\);/);

  const setupReady = sourceBetween(
    online,
    "function isMatchmakingSetupReady()",
    "function updateMatchmakingSetupButton()",
  );
  const beginMatchmaking = sourceBetween(
    online,
    "async function beginMatchmaking",
    "async function startPublicPresence",
  );
  assert.match(setupReady, /isOnlineDeckReady\(state\.deck\.length\)/);
  assert.match(beginMatchmaking, /isOnlineDeckReady\(expectedState\.deck\.length\)/);
  assert.doesNotMatch(setupReady, /deck\.length === MAX_ROUNDS/);
  assert.doesNotMatch(beginMatchmaking, /deck\.length !== MAX_ROUNDS/);
});

test("all registered images remain selectable while the match still ends at five rounds", () => {
  const roundSelect = sourceBetween(online, "function renderRoundSelect()", "function renderWaitingPick()");
  const matchOver = sourceBetween(online, "function isMatchOver()", "function determineOutcome(");

  assert.match(roundSelect, /state\.deck\.map\(/);
  assert.doesNotMatch(roundSelect, /\.slice\(0,\s*ONLINE_REQUIRED_IMAGE_COUNT\)/);
  assert.match(matchOver, /state\.round >= MAX_ROUNDS/);
});

test("the visible default choice is locked on timeout instead of choosing a hidden random card", () => {
  const timerStart = sourceBetween(online, "function startSelectionTimer(", "function updateSelectionCountdown()");
  const timeout = sourceBetween(online, "async function handleSelectionTimeout()", "function stopSelectionTimer(");

  assert.match(timerStart, /getDefaultAvailableCardId\(state\.deck, state\.selectedCardId\)/);
  assert.match(timeout, /getDefaultAvailableCardId\(state\.deck, state\.selectedCardId\)/);
  assert.match(timeout, /await lockSelection\(\);/);
  assert.doesNotMatch(timeout, /Math\.random/);
});

test("setup, battle selection, and post-match engawa lay out eight cards without the old fifth-card stretch", () => {
  assert.match(styles, /\.select-grid \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(styles, /\.engawa-pick-grid \{\s*display: grid;\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(styles, /\.deck-slot:last-child,\s*\.select-card:last-child\s*\{\s*grid-column: span 2;/);
});

test("player-facing copy and cache keys describe the optional three-card reserve", () => {
  assert.match(online, /控えを3枚まで追加すると、各ラウンドで最大8枚から選べます/);
  assert.match(online, /対戦用に登録した5〜8枚から一枚だけ/);
  assert.match(readme, /通常型1on1では、対戦前に各プレイヤーが必須の対戦画像5枚を選択し、任意で控え画像を3枚まで追加/);
  assert.match(readme, /最大5ラウンド/);
  assert.match(index, /styles\.css\?v=[^"]*online-deck-reserve-v1/);
  assert.match(index, /online\.js\?v=[^"]*online-deck-reserve-v1/);
});
