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

test("the initial-only loader retains one lifetime request, bounded timeouts and only the active battle presence source", () => {
  const online = read("online.js");
  const loader = sourceBetween(online, "function loadInitialLobbyStats", "function watchLobbyStats");
  const watcher = sourceBetween(online, "function watchLobbyStats()", "function watchDailyDateRollover");
  assert.match(online, /let lobbyInitialStatsRequest = null/);
  assert.match(loader, /if \(lobbyInitialStatsRequest\) return lobbyInitialStatsRequest/);
  assert.doesNotMatch(loader, /lobbyInitialStatsRequest\s*=\s*null|\.finally\(/);
  assert.match(online, /const LOBBY_PUBLIC_STATS_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(loader, /get\(ref\(database, "\.info\/serverTimeOffset"\)\)/);
  assert.ok(loader.indexOf('get(ref(database, ".info/serverTimeOffset"))') < loader.indexOf('get(ref(database, "online/publicPresence"))'));
  assert.match(loader, /get\(ref\(database, "online\/publicPresence"\)\)/);
  assert.doesNotMatch(loader, /[Ff]reeTablePublicStats|httpsCallable/);
  assert.match(loader, /URLSearchParams\(location.search\).has\("freeTableInvite"\)/);
  assert.doesNotMatch(loader, /onValue\(|setInterval\(|ensureAuthenticated|signInAnonymously/);
  assert.doesNotMatch(online, /publicMarketPresence|aiTextTrainingPublicStats|refreshLobbyPublicStats|getLobbyStatsRefreshStatus|lobbyPublicStatsRefresh|LOBBY_PUBLIC_STATS_REFRESH_COOLDOWN_MS/);
  assert.match(watcher, /loadInitialLobbyStats\(\)/);
  assert.doesNotMatch(watcher, /onValue\(|visibilitychange|setInterval\(/);
  const listener = watcher.slice(watcher.indexOf('window.addEventListener("hariai-landing-rendered"'));
  assert.match(listener, /renderLobbyStats\(\)/);
  assert.doesNotMatch(listener, /refreshLobbyStats\(|loadFreeTable|get\(/);
  assert.match(listener, /loadInitialLobbyStats\(\)/, "home can start the deferred initial snapshot after a retired invite");
});

test("landing snapshots keep their notification channel without free-table result lamps", () => {
  const app = read("app.js");
  const online = read("online.js");
  const refresh = sourceBetween(online, "function refreshLobbyStats(", "function renderLobbyStats()");
  assert.match(refresh, /hariai-lobby-stats-updated/);
  assert.doesNotMatch(app + online, /hariai-free-table-public-stats-updated|updateLandingFreeTableEntrance|refreshFreeTablePublicStats/);
  assert.match(online, /function formatLobbyStatsUpdatedAt\(/, "battle presence timestamp formatting remains available");
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
