"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("landing exposes one accessible manual refresh control and retrieval timestamp", () => {
  const app = read("app.js");
  const styles = read("styles.css");

  for (const id of [
    "lobbyStatsRefreshPanel",
    "lobbyStatsRefreshButton",
    "lobbyStatsRefreshStatus",
  ]) {
    assert.match(app, new RegExp(`id="${id}"`));
  }
  assert.match(app, /最新の状況を読み込む/);
  assert.match(app, /最終更新 \$\{formattedTime\}（取得時点の参考値）/);
  assert.match(app, /aria-live="polite" aria-busy=/);
  assert.match(
    app,
    /querySelector\("#lobbyStatsRefreshButton"\)\?\.addEventListener\("click"[\s\S]*refreshLobbyPublicStats/,
  );
  assert.match(styles, /\.lobby-stats-refresh\s*\{/);
  assert.match(styles, /\.lobby-stats-refresh \.button:disabled\s*\{/);
});

test("public lobby stats use one initial batch and manual batches without presence listeners", () => {
  const online = read("online.js");
  const refreshSource = sourceBetween(
    online,
    "async function refreshLobbyPublicStats",
    "function getFreeTableLampState",
  );
  const watchSource = sourceBetween(
    online,
    "function watchLobbyStats()",
    "function watchDailyDateRollover",
  );

  assert.match(refreshSource, /if \(lobbyPublicStatsRefreshRequest\) return lobbyPublicStatsRefreshRequest/);
  assert.match(refreshSource, /LOBBY_PUBLIC_STATS_REFRESH_COOLDOWN_MS/);
  assert.match(online, /const LOBBY_PUBLIC_STATS_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(online, /function withLobbyPublicStatsTimeout\(promise, timeoutMs = LOBBY_PUBLIC_STATS_REQUEST_TIMEOUT_MS\)/);
  assert.match(refreshSource, /initial && lobbyPublicStatsInitialRefreshStarted/);
  assert.match(refreshSource, /Promise\.allSettled\(\[/);
  assert.match(refreshSource, /get\(ref\(database, "\.info\/serverTimeOffset"\)\)/);
  assert.ok(
    refreshSource.indexOf('get(ref(database, ".info/serverTimeOffset"))')
      < refreshSource.indexOf("Promise.allSettled(["),
    "server time should be sampled before validating public snapshots",
  );
  assert.match(refreshSource, /get\(ref\(database, "online\/publicPresence"\)\)/);
  assert.match(refreshSource, /get\(ref\(database, "online\/publicMarketPresence"\)\)/);
  assert.match(refreshSource, /loadFreeTablePublicStatsSnapshot\(\)/);
  assert.match(refreshSource, /loadAiTextTrainingPublicStatsSnapshot\(\)/);
  assert.doesNotMatch(refreshSource, /onValue\(/);
  assert.match(watchSource, /refreshLobbyPublicStats\(\{ initial: true \}\)/);
  assert.doesNotMatch(watchSource, /online\/publicPresence["`]/);
  assert.doesNotMatch(watchSource, /online\/publicMarketPresence["`]/);
  assert.doesNotMatch(watchSource, /onValue\(/);
  assert.doesNotMatch(watchSource, /visibilitychange|setInterval|PublicStatsCallable/);
});

test("refresh batches preserve previous values on partial failure and never age snapshots into false zeroes", () => {
  const online = read("online.js");
  const refreshSource = sourceBetween(
    online,
    "async function refreshLobbyPublicStats",
    "function getFreeTableLampState",
  );
  const watchSource = sourceBetween(
    online,
    "function watchLobbyStats()",
    "function watchDailyDateRollover",
  );

  assert.match(refreshSource, /let nextLobbyPresenceEntries = lobbyPresenceEntries/);
  assert.match(refreshSource, /let nextMarketPresenceEntries = marketPresenceEntries/);
  assert.match(refreshSource, /let nextFreeTableStats = \{ \.\.\.lobbyStats\.freeTable \}/);
  assert.match(refreshSource, /let nextAiTrainingStats = \{ \.\.\.lobbyStats\.aiTextTraining \}/);
  assert.match(refreshSource, /refreshPresence: presenceResult\.status === "fulfilled"/);
  assert.match(refreshSource, /refreshMarket: marketResult\.status === "fulfilled"/);
  assert.match(online, /refreshPresence \? \{[\s\S]*\} : \{ \.\.\.previousStats\[mode\] \}/);
  assert.match(online, /if \(!refreshMarket\) \{\s*nextStats\.market = \{ \.\.\.previousStats\.market \}/);
  assert.match(refreshSource, /successCount === 0/);
  assert.match(refreshSource, /successCount < results\.length/);
  assert.match(refreshSource, /一部の状況を更新できませんでした。/);
  assert.match(refreshSource, /finally\(\(\) => \{[\s\S]*lobbyPublicStatsRefreshRequest = null/);
  assert.doesNotMatch(watchSource, /refreshLobbyStats\(\)/);
  assert.doesNotMatch(online, /window\.setInterval\(refreshLobbyStats/);
  assert.doesNotMatch(online, /FREE_TABLE_PUBLIC_STATS_POLL_MS|AI_TEXT_TRAINING_PUBLIC_STATS_POLL_MS/);
});

test("landing redraw and visibility changes do not trigger another public stats batch", () => {
  const online = read("online.js");
  const watchSource = sourceBetween(
    online,
    "function watchLobbyStats()",
    "function watchDailyDateRollover",
  );
  const listenerStart = watchSource.indexOf('window.addEventListener("hariai-landing-rendered"');
  assert.ok(listenerStart >= 0);
  const landingListener = watchSource.slice(listenerStart);

  assert.match(landingListener, /renderLobbyStats\(\)/);
  assert.match(landingListener, /renderLobbyStatsRefreshStatus\(\)/);
  assert.doesNotMatch(landingListener, /refreshLobbyPublicStats|loadFreeTable|loadAiText|get\(/);
  assert.doesNotMatch(watchSource, /visibilitychange/);
});

test("manual refresh assets use a distinct Hosting cache generation", () => {
  const html = read("index.html");
  const readme = read("README.md");
  for (const asset of ["styles.css", "app.js", "online.js"]) {
    assert.match(
      html,
      new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]*lobby-manual-refresh-v1`),
    );
  }
  assert.match(readme, /ページ初回表示時に一度だけ自動取得/);
  assert.match(readme, /30秒の連打防止と最終更新時刻/);
  assert.match(readme, /トップへ戻る操作やタブ復帰では自動取得しません/);
});
