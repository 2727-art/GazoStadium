"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("frontend reads V2 public boards while private spotlight data stays behind the dashboard action", () => {
  const online = read("online.js");

  assert.match(online, /daily:\s*"2026-07-28"/);
  assert.match(online, /weekly:\s*"2026-08-03"/);
  assert.match(online, /monthly:\s*"2026-08"/);
  assert.match(online, /Object\.freeze\(\["solo", "strategy"\]\)/);
  assert.match(online, /CROWN_DAILY_MATCH_LIMIT\s*=\s*3/);
  assert.match(online, /online\/serverOverallLeaderboard/);
  assert.match(online, /online\/\$\{selectedRoot\}\/\$\{selectedPeriod\}\/\$\{periodInfo\.key\}/);
  assert.match(online, /"crownCircuitPeriods"/);
  assert.match(online, /online\/crownCircuitHallOfFame\/monthly/);
  assert.doesNotMatch(online, /readPublicDatabasePath\("online\/rankingSpotlights\/current"/);
  const crownOrdering = sourceBetween(
    online,
    "function normalizeCrownCircuitRecords",
    "function normalizeDashboardPerson",
  );
  assert.doesNotMatch(crownOrdering, /updatedAt/);
  const legacyRecording = sourceBetween(
    online,
    "async function recordLeaderboardPeriodResult",
    "async function syncServerRankingParticipation",
  );
  assert.match(legacyRecording, /CROWN_CIRCUIT_MODES\.includes\(mode\)/);
  assert.doesNotMatch(legacyRecording, /ACTIVE_BATTLE_MODES\.includes\(mode\)/);
});

test("ranking actions use the callable contract and top-percent semantics", () => {
  const online = read("online.js");
  const app = read("app.js");

  assert.match(online, /action:\s*"get_ranking_dashboard"/);
  assert.match(online, /action:\s*"start_crown_run"/);
  assert.match(online, /dateKey:\s*leaderboardPeriodKeyFor\("daily"/);
  assert.doesNotMatch(online, /expectedDateKey/);
  assert.match(online, /action:\s*"set_crown_customization"/);
  assert.match(online, /crownTheme:\s*normalizedTheme/);
  assert.match(online, /crownSignatureId:\s*normalizedSignatureId/);
  assert.match(online, /topPercent:/);
  assert.match(app, /overall\.topPercent/);
  assert.doesNotMatch(app, /上位\$\{percentile\}/);
});

test("overall RATE and proof dashboard precede the period circuit without retired ranking modes", () => {
  const app = read("app.js");
  const rankingScreen = sourceBetween(
    app,
    "function renderRankingScreen",
    "function startOnlineBattle",
  );
  const dashboardIndex = rankingScreen.indexOf("${renderRankingDashboardPanel()}");
  const spotlightIndex = rankingScreen.indexOf("${renderRankingSpotlight()}");
  const overallIndex = rankingScreen.indexOf("${renderOverallLeaderboardSection()}");
  const periodTabsIndex = rankingScreen.indexOf('class="ranking-period-tabs"');

  assert.ok(dashboardIndex >= 0 && dashboardIndex < periodTabsIndex);
  assert.ok(spotlightIndex >= 0 && spotlightIndex < periodTabsIndex);
  assert.ok(overallIndex >= 0 && overallIndex < periodTabsIndex);
  assert.match(rankingScreen, /宣言後の3戦だけ/);
  assert.match(rankingScreen, /成立デイリーのBEST/);
  assert.match(rankingScreen, /成立ウィークリーのBEST/);
  assert.match(rankingScreen, /通常型・戦略型1on1/);
  assert.doesNotMatch(rankingScreen, /ふたりチャレンジ|旧BR|modePoints\.team|modePoints\.royale/);
});

test("proof run, crown customization, SIGNATURE, and safe X promotion controls are present", () => {
  const app = read("app.js");

  for (const marker of [
    'id="crownRunStartButton"',
    'id="crownRunSoloButton"',
    'id="crownRunStrategyButton"',
    'id="crownThemeSelect"',
    'id="crownSignatureSelect"',
    'id="crownCustomizationSave"',
    "今日の三戦証明",
    "SIGNATURE",
    "24H X SPOTLIGHT",
  ]) {
    assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(app, /rel="noopener noreferrer nofollow ugc"/);
  assert.match(app, /referrerpolicy="no-referrer"/);
});

test("ranking V2 styles and browser cache keys are wired", () => {
  const styles = read("styles.css");
  const html = read("index.html");

  for (const selector of [
    ".ranking-dashboard",
    ".ranking-neighbor-list",
    ".crown-proof-panel",
    ".crown-proof-meter",
    ".crown-customization",
    ".crown-spotlight",
    ".ranking-signature",
    ".ranking-overall-section",
    ".ranking-circuit-section",
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.crown-customization/);
  assert.match(html, /styles\.css\?v=[^"]*crown-circuit-v2/);
  assert.match(html, /app\.js\?v=[^"]*crown-circuit-v2/);
  assert.match(html, /online\.js\?v=[^"]*crown-circuit-v2/);
});
