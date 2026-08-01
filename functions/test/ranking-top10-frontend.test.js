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

test("public boards display TOP 10 while complex legacy points ordering keeps its safe query window", () => {
  const online = read("online.js");
  const app = read("app.js");

  assert.match(online, /const PUBLIC_RANKING_LIMIT = 10;/);
  assert.match(online, /const LEGACY_PERIOD_QUERY_LIMIT = 100;/);
  for (const marker of [
    "function normalizeLeaderboardRecords",
    "function normalizeOverallLeaderboardRecords",
    "function normalizeCrownCircuitRecords",
  ]) {
    const section = sourceBetween(online, marker, `\n}\n`);
    assert.match(section, /slice\(0, PUBLIC_RANKING_LIMIT\)/);
  }
  const legacyRead = sourceBetween(
    online,
    "async function readPeriodPublicTop10",
    "async function readCachedPeriodPublicTop10",
  );
  assert.match(legacyRead, /limit: LEGACY_PERIOD_QUERY_LIMIT/);
  assert.match(app, /PERMANENT STRENGTH \/ TOP 10/);
  assert.match(app, /CROWN CIRCUIT \/ TOP 10/);
  assert.doesNotMatch(app, /TOP 50/);
});

test("overall tenth-seat ties use Firebase key order and only fetch the missing boundary seats", () => {
  const online = read("online.js");
  const keyComparator = sourceBetween(
    online,
    "function compareFirebaseKeys",
    "function normalizeOverallLeaderboardRecords",
  );
  const compareFirebaseKeys = Function(`${keyComparator}; return compareFirebaseKeys;`)();
  const mixedKeys = [
    "z000000000000000",
    "_000000000000000",
    "A000000000000000",
    "-000000000000000",
    "a000000000000000",
    "Z000000000000000",
    "0000000000000000",
  ];
  assert.deepEqual(mixedKeys.sort(compareFirebaseKeys), [
    "-000000000000000",
    "0000000000000000",
    "A000000000000000",
    "Z000000000000000",
    "_000000000000000",
    "a000000000000000",
    "z000000000000000",
  ]);

  const overallRead = sourceBetween(
    online,
    "async function readOverallPublicTop10",
    "async function readCrownCircuitPublicTop10",
  );
  assert.match(overallRead, /limit: PUBLIC_RANKING_LIMIT/);
  assert.match(overallRead, /boundarySeats = Math\.max\(0, PUBLIC_RANKING_LIMIT - higherEntries\.length\)/);
  assert.match(overallRead, /equalToValue: boundaryRating/);
  assert.match(overallRead, /limit: boundarySeats/);
  assert.match(overallRead, /limitDirection: "first"/);
  const overallNormalize = sourceBetween(
    online,
    "function normalizeOverallLeaderboardRecords",
    "function crownCircuitEntryIsQualified",
  );
  assert.match(overallNormalize, /compareFirebaseKeys\(first\.entryId, second\.entryId\)/);
  assert.doesNotMatch(overallNormalize, /localeCompare/);
});

test("Crown TOP 10 excludes provisional zero scores and expands only a positive boundary tie", () => {
  const online = read("online.js");
  const crown = read("functions/crown-circuit.js");
  const crownRead = sourceBetween(
    online,
    "async function readCrownCircuitPublicTop10",
    "async function readPeriodPublicTop10",
  );
  assert.match(crownRead, /Number\(entry\?\.rankScore \|\| 0\) > 0/);
  assert.match(crownRead, /positiveEntries\.length < PUBLIC_RANKING_LIMIT/);
  assert.match(crownRead, /boundaryRankScore > 0/);
  assert.match(crownRead, /equalToValue: boundaryRankScore/);
  assert.doesNotMatch(crownRead, /equalToValue: boundaryRankScore[\s\S]*?limit:/);
  const crownNormalize = sourceBetween(
    online,
    "function normalizeCrownCircuitRecords",
    "function normalizeDashboardPerson",
  );
  assert.match(crownNormalize, /entry\.qualified/);
  assert.match(crown, /rankScore: complete \? crownPower : 0/);
  assert.match(crown, /rankScore: qualifyingDays >= CROWN_WEEKLY_MIN_DAYS \? aggregate\.total : 0/);
  assert.match(crown, /rankScore: qualifyingWeeks >= CROWN_MONTHLY_MIN_WEEKS \? aggregate\.total : 0/);
});

test("period revisits, monthly BEYOND, and Hall of Fame reuse bounded session caches", () => {
  const online = read("online.js");
  const periodCache = sourceBetween(
    online,
    "async function readCachedPeriodPublicTop10",
    "function normalizeMonthlyHallOfFameRecords",
  );
  assert.match(online, /const PERIOD_RANKING_CACHE_TTL_MS = 60 \* 1000;/);
  assert.match(periodCache, /periodLeaderboardCache\.get\(cacheKey\)/);
  assert.match(periodCache, /Date\.now\(\) - cached\.loadedAt < PERIOD_RANKING_CACHE_TTL_MS/);
  assert.match(periodCache, /periodLeaderboardRequests\.has\(cacheKey\)/);

  const refresh = sourceBetween(
    online,
    "async function refreshLeaderboard",
    "async function ensureAuthenticated",
  );
  assert.match(refresh, /readCachedPeriodPublicTop10\(periodInfo, selectedPeriod, \{ force \}\)/);
  assert.match(refresh, /refreshMonthlyBeyondCache\(\)\.catch\(\(\) => null\)/);
  assert.match(refresh, /refreshMonthlyHallOfFame\(\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(refresh, /readPublicDatabasePath\(/);

  const hall = sourceBetween(
    online,
    "function restoreMonthlyHallOfFameSessionCache",
    "async function refreshMonthlyBeyondCache",
  );
  assert.match(hall, /sessionStorage\.getItem\(MONTHLY_HALL_OF_FAME_SESSION_KEY\)/);
  assert.match(hall, /sessionStorage\.setItem\(MONTHLY_HALL_OF_FAME_SESSION_KEY/);
  assert.match(hall, /MONTHLY_HALL_OF_FAME_CACHE_TTL_MS/);
  assert.match(hall, /MONTHLY_HALL_OF_FAME_RETRY_COOLDOWN_MS/);
  assert.match(hall, /legacyResult\.status === "fulfilled" \? legacyResult\.value : cachedLegacyRecords/);
  assert.match(hall, /crownResult\.status === "fulfilled" \? crownResult\.value : cachedCrownRecords/);
});

test("an empty monthly read is successful and failures retry monthly only after cooldown", () => {
  const online = read("online.js");
  const app = read("app.js");
  const monthly = sourceBetween(
    online,
    "async function refreshMonthlyBeyondCache",
    "async function refreshMonthlyBeyondRanking",
  );
  assert.match(monthly, /monthlyBeyondAttemptedPeriodKey = monthlyPeriodInfo\.key/);
  assert.match(monthly, /MONTHLY_BEYOND_RETRY_COOLDOWN_MS/);
  assert.match(monthly, /monthlyBeyondEntries = entries;/);
  assert.match(monthly, /monthlyBeyondPeriodKey = monthlyPeriodInfo\.key;/);
  assert.doesNotMatch(monthly, /if \(entries\.length\)/);

  const retry = sourceBetween(
    app,
    "function refreshRankingAtPeriodBoundary",
    "async function beginDailyCrownRun",
  );
  assert.match(retry, /getMonthlyBeyondLoadState/);
  assert.match(retry, /Date\.now\(\) >= Number\(monthlyLoad\.retryAt \|\| 0\)/);
  assert.match(retry, /refreshMonthlyBeyondRanking/);
  assert.doesNotMatch(retry, /loadedMonthlyKey/);

  const monthlyRecovery = sourceBetween(
    online,
    "async function refreshMonthlyBeyondRanking",
    "async function refreshOverallLeaderboard",
  );
  assert.match(monthlyRecovery, /leaderboardPeriod === "monthly"/);
  assert.match(monthlyRecovery, /leaderboardEntries = entries/);
  assert.match(monthlyRecovery, /leaderboardStatus = "ready"/);
});

test("top navigation reaches all four boards while Rival Zone and personal run remain visible", () => {
  const app = read("app.js");
  const styles = read("styles.css");
  const navigation = sourceBetween(
    app,
    "function navigateRankingSection",
    "function refreshRankingAtPeriodBoundary",
  );
  const rankingScreen = sourceBetween(app, "function renderRankingScreen", "function startOnlineBattle");
  const jumpIndex = rankingScreen.indexOf('class="ranking-jump-nav"');
  const dashboardIndex = rankingScreen.indexOf("${renderRankingDashboardPanel()}");
  assert.ok(jumpIndex >= 0 && jumpIndex < dashboardIndex);
  for (const target of ["overall", "daily", "weekly", "monthly"]) {
    assert.match(rankingScreen, new RegExp(`data-ranking-jump="${target}"`));
  }
  assert.match(app, /YOUR RIVAL ZONE/);
  assert.match(app, /renderCrownRunPanel\(dashboard\)/);
  assert.match(navigation, /const refreshRequest = selectRankingPeriod\(selected\)/);
  assert.match(navigation, /refreshRequest\.finally\(scrollToCircuit\)/);
  assert.match(styles, /\.ranking-jump-nav/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.ranking-jump-nav/);
});

test("all changed browser assets share the ranking TOP 10 cache marker", () => {
  const html = read("index.html");
  assert.match(html, /styles\.css\?v=[^"]*ranking-top10-v2/);
  assert.match(html, /app\.js\?v=[^"]*ranking-top10-v2/);
  assert.match(html, /online\.js\?v=[^"]*ranking-top10-v2/);
});
