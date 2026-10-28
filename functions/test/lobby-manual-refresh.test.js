"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, "missing start marker: " + startMarker);
  assert.ok(end > start, "missing end marker: " + endMarker);
  return source.slice(start, end);
}

test("landing keeps snapshot counts on the entry cards and removes the duplicate status panel and controls", () => {
  const app = read("app.js");
  assert.doesNotMatch(app, /vl-live-board|landingLiveTitle|lobbyStatsRefresh|freeTableStatusButton|いまの参加状況|最新の状況を読み込む/);
  assert.match(app, /人数はページ表示時点の参考値/);
  for (const id of ["boardSoloWaitingCount", "boardSoloPlayingCount", "boardStrategyWaitingCount", "boardStrategyPlayingCount", "heroSoloWaitingCount", "heroSoloPlayingCount"]) {
    assert.ok(app.includes(id), id);
  }
  for (const file of ["styles.css", "velvet.css"]) {
    assert.doesNotMatch(read(file), /\.vl-live-board\b|\.mode-lobby-stats\b|\.lobby-mode-(?:card|head|counts)\b|\.lobby-stats-refresh\b/, file);
  }
});

test("the protected landing loader uses one lifetime request without full game services", () => {
 const source = read("landing-presence.mjs");
 assert.match(source, /if \(request\) return request/);
 assert.match(source, /get\(ref\(database, "online\/publicPresence"\)\)/);
 assert.match(source, /firebase-database-client/);
 assert.doesNotMatch(source, /from.*firebase-services|onValue\(|setInterval\(|signInAnonymously/);
 assert.match(source, /hariai-lobby-stats-updated/);
 assert.match(read("firebase-database-client.mjs"), /from.*firebase-client/);
});

test("initial snapshot assets carry a new cache generation and document the one-read lifecycle", () => {
  const html = read("index.html");
  const readme = read("README.md");
  for (const file of ["styles.css", "velvet.css", "app.js", "online.js"]) {
    const line = html.split("\n").find((value) => value.includes(file + "?v="));
    assert.match(line, /lobby-initial-snapshot-v1/, file);
  }
  assert.match(readme, /ページ初回表示時に一度だけ/);
  assert.match(readme, /同じページ内では再取得しません/);
  assert.match(readme, /人数はページ表示時点の参考値/);
  assert.doesNotMatch(readme, /30秒の連打防止と最終更新時刻|初回表示時とプレイヤーが「最新の状況を読み込む」を押した時/);
});
