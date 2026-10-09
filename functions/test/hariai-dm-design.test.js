"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const sourceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test("the redesign loads its two fonts and ships every changed asset under a new cache token", () => {
  const html = read("index.html");
  assert.match(html, /fonts\.googleapis\.com\/css2\?[^"]*family=Dela\+Gothic\+One/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?[^"]*family=Yomogi/);
  for (const asset of ["app\\.js", "online\\.js", "strategy\\.js", "velvet\\.css", "velvet-battle\\.css", "strategy\\.css"]) {
    assert.match(html, new RegExp(`${asset}\\?v=[^"]*hariai-dm-v1`), `${asset} cache token`);
  }
  const velvet = read("velvet.css");
  assert.match(velvet, /--ha-font-display:\s*"Dela Gothic One"/);
  assert.match(velvet, /--ha-font-memo:\s*"Yomogi"/);
});

test("the landing opens with a DM example and lists the open tables with live counts only", () => {
  const app = read("app.js");
  const online = read("online.js");
  const landing = sourceBetween(app, "function renderLanding()", "function renderLandingScreen()");
  assert.match(landing, /貼って、刺して、<br \/>点で返す。/);
  assert.doesNotMatch(landing, /vl-curtain|vl-spotlight|vl-fan|Tonight's Stage/, "the stage curtains and card fan are gone");
  assert.match(landing, /role="img" aria-label="やりとりの例。/);
  assert.match(landing, /id="onlineButton"/);
  assert.match(landing, /id="soloBoardButton"/);
  assert.match(app, /querySelector\("#soloBoardButton"\)\?\.addEventListener\("click", startOnlineBattle\)/);
  for (const id of ["boardSoloWaitingCount", "boardSoloPlayingCount", "boardStrategyWaitingCount", "boardStrategyPlayingCount"]) {
    assert.match(landing, new RegExp(`liveCount\\("${id}"`), `${id} rendered`);
    assert.match(online, new RegExp(`${id}: lobbyStats\\.`), `${id} refreshed with the lobby stats`);
  }
  assert.doesNotMatch(landing, /freeTableButton|boardFreeTable|自由卓/);
});

test("normal 1on1 scores on a ten-step meter banded like the reactions", () => {
  const online = read("online.js");
  assert.match(online, /const SCORE_BAND_LABELS = Object\.freeze\(\{ low: "1〜6 まだ平気", mid: "7〜8 効いた", high: "9〜10 刺さった" \}\);/);
  const score = sourceBetween(online, "function renderScore()", "function localRoleplayVoiceSetId(");
  assert.match(score, /class="vb-score-button is-\$\{scoreReactionBand\(score\)\}\$\{lit \? " is-lit" : ""\}" data-online-score="\$\{score\}"/);
  assert.match(score, /送信前 · 点数は、ふたりとも決めてから同時に開きます/);
  assert.match(score, /id="onlineLockScore"/);
  const meter = sourceBetween(online, "function renderScoreMeter(", "function renderThreadAvatar(");
  assert.match(meter, /is-on is-\$\{scoreReactionBand\(step\)\}/);
  const result = sourceBetween(online, "function renderRoundResult()", "function renderOnlinePursuitLines(");
  assert.ok(result.indexOf("${exchange(remoteIndex)}${exchange(state.playerIndex)}") > 0, "the opponent's post comes first, like a DM thread");
  assert.match(result, /data-result-score="\$\{scores\[index\]\}"/);
  assert.match(result, /data-result-sparks/);
  assert.match(sourceBetween(online, "function renderReveal()", "function renderArenaCard("), /renderArenaCard\(remoteIndex, remoteItem\)\}\$\{renderArenaCard\(state\.playerIndex, localItem\)/);
});

test("strategy scores sit on a 70–100 meter whose marker is also the damage", () => {
  const strategy = read("strategy.js");
  const meterSource = sourceBetween(strategy, "function renderHariaiMeter(", "const HARIAI_BAND_LABELS");
  const context = { HARIAI_SCORE_MIN: 0, HARIAI_SCORE_MAX: 100, HARIAI_DAMAGE_FLOOR: 70 };
  vm.runInNewContext(`${meterSource}; this.meter = renderHariaiMeter;`, context);
  const position = (score) => context.meter(score).match(/--score-pos:([0-9.]+)/)[1];
  assert.equal(position(70), "0.000");
  assert.equal(position(91), "0.700");
  assert.equal(position(100), "1.000");
  assert.match(context.meter(60), /ha-meter100 is-below/);
  assert.equal(position(60), "0.857");
  assert.match(sourceBetween(strategy, "function renderHariaiScorePreview(", "function renderHariaiScoreConsole("), /\$\{renderHariaiMeter\(value\)\}/);
});

test("the strategy thread, right tabs and notebook memo keep their state across re-renders", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /let hariaiMemoOpen = true;/);
  assert.match(strategy, /on\("\[data-hariai-memo\]", "toggle", \(event\) => \{ hariaiMemoOpen = event\.currentTarget\.open; \}\);/);
  assert.match(sourceBetween(strategy, "function renderHariaiReadingMemo()", "function renderHariaiSelfCard()"), /<details class="hariai-memo" data-hariai-memo\$\{hariaiMemoOpen \? " open" : ""\}>/);
  const tabHandler = sourceBetween(strategy, 'on("[data-hariai-right-tab]", "click"', 'on("[data-hariai-card]"');
  assert.match(tabHandler, /state\.drafts\.rightKind && state\.drafts\.rightKind !== tab/);
  assert.match(tabHandler, /state\.drafts\.rightId = "";/);
  const layout = sourceBetween(strategy, "function renderBattle()", "function renderHariaiThread()");
  assert.match(layout, /<div class="hariai-layout">\$\{renderHariaiReadingMemo\(\)\}<div class="hariai-main">/);
  const css = read("strategy.css");
  assert.match(css, /grid-template-areas: "memo" "main" "side";/);
  assert.match(css, /grid-template-areas: "main memo" "main side";/);
});

test("the strategy preview only runs on localhost and never writes to a room", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /const useOfflineStrategyPreview = \["127\.0\.0\.1", "localhost"\]\.includes\(window\.location\.hostname\)\n  && new URLSearchParams\(window\.location\.search\)\.has\("strategyPreview"\);/);
  const start = sourceBetween(strategy, "function start() {", "function isActive()");
  assert.ok(start.indexOf("if (useOfflineStrategyPreview)") < start.indexOf("ensureAuthenticated()"), "the preview starts before signing in");
  const blocked = strategy.match(/const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "([^"]+)";/)[1];
  for (const control of ["data-hariai-post", "data-hariai-break", "data-hariai-score-submit", "data-hariai-right-submit", "data-hariai-answer", "data-hariai-finish-submit", "data-hariai-surrender", ".strategy-chat-panel button"]) {
    assert.ok(blocked.includes(control), `${control} is blocked in the preview`);
  }
  assert.match(strategy, /app\.addEventListener\("submit", blockStrategyPreviewControl, true\);/);
});
