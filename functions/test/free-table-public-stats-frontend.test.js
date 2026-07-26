const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("landing shows free table room counts with gentle non-competitive copy", () => {
  const appSource = read("app.js");
  const freeTableCardStart = appSource.indexOf('<article class="lobby-mode-card free-table-status">');
  const marketCardStart = appSource.indexOf('<article class="lobby-mode-card market">');
  const freeTableCard = appSource.slice(freeTableCardStart, marketCardStart);

  assert.ok(freeTableCardStart >= 0);
  assert.ok(freeTableCardStart < marketCardStart);
  assert.match(appSource, /aria-label="モード別の参加・開室状況"/);
  assert.match(freeTableCard, /<span>貼り合い自由卓<\/span><small>FREE TABLE<\/small>/);
  assert.match(freeTableCard, /<small>お迎え中<\/small><strong><span id="lobbyFreeTableWelcomingCount">/);
  assert.match(freeTableCard, /<small>同席中<\/small><strong><span id="lobbyFreeTableSeatedCount">/);
  assert.equal((freeTableCard.match(/<em>卓<\/em>/g) || []).length, 2);
  assert.match(appSource, /自由卓は人数ではなく、お迎え中・同席中の卓数です。/);
});

test("free table public stats poll visibly without creating an anonymous account", () => {
  const appSource = read("app.js");
  const onlineSource = read("online.js");
  const refreshStart = onlineSource.indexOf("function refreshFreeTablePublicStats()");
  const refreshEnd = onlineSource.indexOf("function refreshFreeTablePublicStatsImmediately()", refreshStart);
  const refreshSource = onlineSource.slice(refreshStart, refreshEnd);

  assert.ok(refreshStart >= 0);
  assert.match(onlineSource, /httpsCallable\(functions, "freeTablePublicStats"\)/);
  assert.match(refreshSource, /freeTablePublicStatsCallable\(\{\}\)/);
  assert.doesNotMatch(refreshSource, /ensureAuthenticated|signInAnonymously|setPersistence/);
  assert.match(onlineSource, /document\.visibilityState === "visible"\s*&& document\.querySelector\("#lobbyFreeTableWelcomingCount"\) !== null/);
  assert.match(refreshSource, /if \(freeTablePublicStatsRequest\) return freeTablePublicStatsRequest;/);
  assert.match(onlineSource, /const FREE_TABLE_PUBLIC_STATS_POLL_MS = 60_000;/);
  assert.match(onlineSource, /window\.setTimeout\(\(\) => \{\s*freeTablePublicStatsTimer = null;\s*refreshFreeTablePublicStats\(\);\s*\}, delay\);/);
  assert.doesNotMatch(onlineSource, /setInterval\(refreshFreeTablePublicStats/);
  assert.match(onlineSource, /FREE_TABLE_PUBLIC_STATS_POLL_MS \* \(2 \*\* Math\.min\(freeTablePublicStatsFailureCount, 2\)\)/);
  assert.match(appSource, /window\.dispatchEvent\(new Event\("hariai-landing-rendered"\)\);/);
  assert.match(onlineSource, /window\.addEventListener\("hariai-landing-rendered", refreshFreeTablePublicStatsImmediately\);/);
  assert.match(onlineSource, /if \(document\.visibilityState === "visible"\) \{\s*refreshFreeTablePublicStatsImmediately\(\);/);
  assert.match(onlineSource, /welcomingRooms: null,\s*seatedRooms: null,\s*updatedAt: null,/);
  assert.match(onlineSource, /lobbyFreeTableWelcomingCount: lobbyStats\.freeTable\.welcomingRooms/);
  assert.match(onlineSource, /lobbyFreeTableSeatedCount: lobbyStats\.freeTable\.seatedRooms/);
});

test("free table counts retain transient success but expire safely after three minutes", () => {
  const onlineSource = read("online.js");
  const normalizeStart = onlineSource.indexOf("function normalizeFreeTablePublicStats");
  const refreshStart = onlineSource.indexOf("function refreshFreeTablePublicStats()");
  const refreshEnd = onlineSource.indexOf("function refreshFreeTablePublicStatsImmediately()", refreshStart);
  const safetySource = onlineSource.slice(normalizeStart, refreshEnd);

  assert.match(onlineSource, /const FREE_TABLE_PUBLIC_STATS_STALE_MS = 180_000;/);
  assert.match(safetySource, /Number\.isSafeInteger\(updatedAt\)/);
  assert.match(safetySource, /updatedAt <= estimatedServerNow - FREE_TABLE_PUBLIC_STATS_STALE_MS/);
  assert.match(safetySource, /freeTablePublicStatsLastSuccessAt = receivedAt;/);
  assert.match(safetySource, /freeTablePublicStatsLastSuccessAt \+ FREE_TABLE_PUBLIC_STATS_STALE_MS/);
  assert.match(safetySource, /serverUpdatedAtInLocalTime \+ FREE_TABLE_PUBLIC_STATS_STALE_MS/);
  assert.match(safetySource, /\.catch\(\(\) => \{\s*freeTablePublicStatsFailureCount =/);
  assert.match(safetySource, /expireFreeTablePublicStats\(\);\s*return \{ \.\.\.freeTablePublicStats \};/);
  assert.match(onlineSource, /expireFreeTablePublicStats\(Date\.now\(\), false\);/);
});

test("free table stats styling, docs, and cache generations stay wired", () => {
  const cssSource = read("styles.css");
  const html = read("index.html");
  const readme = read("README.md");

  assert.match(cssSource, /\.lobby-mode-card\.free-table-status\s*\{[^}]*grid-column: 1 \/ -1;/s);
  for (const asset of ["styles.css", "app.js", "online.js"]) {
    const escapedAsset = asset.replaceAll(".", "\\.");
    assert.match(html, new RegExp(`${escapedAsset}\\?v=[^"]*free-table-stats-v1`));
  }
  assert.match(readme, /認証不要の公開統計だけを、トップ画面を見ている間に60秒ごとに取得し、閲覧のために匿名アカウントを作りません/);
  assert.match(readme, /3分間更新できなければ`--`へ戻します/);
  assert.match(readme, /`freeTablePublicStats`から、お迎え中・同席中の集計値と更新時刻だけを取得します/);
});
