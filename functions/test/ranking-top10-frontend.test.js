"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8")
  .replace(/\r\n/g, "\n");

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function loadAchievements() {
  const window = { addEventListener() {} };
  return Function("window", `${read("achievements.js")}; return window.HariaiAchievements;`)(window);
}

function loadRateFloorNormalizer(achievements = loadAchievements()) {
  const online = read("online.js");
  return Function("window", `
    const INITIAL_RATING = 1000;
    const RATE_FLOOR_MINIMUM_MATCHES = 10;
    const PUBLIC_RANKING_LIMIT = 10;
    ${sourceBetween(online, "const CROWN_THEMES", "const SERVER_RANKING_AWARD_MINIMUM_MATCHES")}
    ${sourceBetween(online, "function normalizeCrownTheme", "function normalizeOverallLeaderboardRecords")}
    ${sourceBetween(online, "function normalizeRateFloorLeaderboardRecords", "function crownCircuitEntryIsQualified")}
    return normalizeRateFloorLeaderboardRecords;
  `)({ HariaiAchievements: achievements });
}

function loadShowcaseActions({ failSave = false, failRefresh = false } = {}) {
  const online = read("online.js");
  const calls = [];
  const toasts = [];
  const harness = {
    async economyActionCallable(payload) {
      calls.push(payload);
      if (failSave) throw new Error("保存エラー");
      return { data: { saved: true, dashboard: { updated: true }, achievements: { showcase: [] } } };
    },
    async ensureRankingCommentUser() {},
    dispatchRankingDashboardUpdated() {},
    applyRankingDashboard(value) { calls.push({ appliedDashboard: value }); },
    getRankingDashboard() { return { updated: true }; },
    async refreshRankingDashboard() {},
    async refreshOverallLeaderboard() { calls.push("overall"); },
    async refreshRateFloorLeaderboard() {
      calls.push("floor");
      if (failRefresh) throw new Error("再取得エラー");
    },
    async refreshLeaderboard(period, options) { calls.push({ period, options }); if (failRefresh) throw new Error("再取得エラー"); },
    applyAchievementPayload(value) { calls.push({ appliedAchievements: value }); },
    showToast(value) { toasts.push(value); },
    render() {},
  };
  const actions = Function("harness", `
    const {
      economyActionCallable, ensureRankingCommentUser, dispatchRankingDashboardUpdated,
      applyRankingDashboard, getRankingDashboard, refreshRankingDashboard,
      refreshOverallLeaderboard, refreshRateFloorLeaderboard, refreshLeaderboard,
      applyAchievementPayload, showToast, render,
    } = harness;
    let rankingDashboardBusy = false;
    const state = { uid: "test-player", achievementsBusy: false };
    const leaderboardPeriod = "weekly";
    const leaderboardPeriodKey = "2026-09-14";
    ${sourceBetween(online, "const CROWN_THEMES", "const SERVER_RANKING_AWARD_MINIMUM_MATCHES")}
    ${sourceBetween(online, "function normalizeCrownTheme", "function normalizeCrownSignatureIds")}
    ${sourceBetween(online, "async function saveAchievementShowcase", "function render()")}
    return { saveAchievementShowcase, state, isBusy: () => rankingDashboardBusy };
  `)(harness);
  return { ...actions, calls, toasts };
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
  assert.doesNotMatch(app, /PERMANENT STRENGTH/);
  assert.match(app, /CROWN CIRCUIT \/ TOP 10/);
  assert.doesNotMatch(app, /TOP 50/);
});

test("Firebase key ordering remains deterministic for period tie breaks", () => {
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

});

test("RATE FLOOR reads the lowest ten deterministically and uses competition ranks for ties", () => {
  const online = read("online.js");
  const normalizeRateFloorLeaderboardRecords = loadRateFloorNormalizer();
  const input = {
    stale_hidden: {
      rateFloorHidden: true,
      rating: 100,
      serverMatches: 10,
      name: "MUST NOT RENDER",
    },
    z_floor: { name: "Z", rating: 604, serverMatches: 9 },
    b_tie: { name: "B", rating: 675, serverMatches: 20, xHandle: "hidden" },
    a_tie: { name: "A", rating: 675, serverMatches: 10, commentsEnabled: true },
    p01: { name: "P1", rating: 604, serverMatches: 10 },
    p04: { name: "P4", rating: 680, serverMatches: 10 },
    p05: { name: "P5", rating: 681, serverMatches: 10 },
    p06: { name: "P6", rating: 682, serverMatches: 10 },
    p07: { name: "P7", rating: 683, serverMatches: 10 },
    p08: { name: "P8", rating: 684, serverMatches: 10 },
    p09: { name: "P9", rating: 685, serverMatches: 10 },
    p10: { name: "P10", rating: 686, serverMatches: 10 },
    p11: { name: "P11", rating: 687, serverMatches: 10 },
    p12: { name: "P12", rating: 688, serverMatches: 10 },
  };
  const entries = normalizeRateFloorLeaderboardRecords(input);
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.slice(0, 4).map(({ entryId, rating, rank }) => ({ entryId, rating, rank })), [
    { entryId: "p01", rating: 604, rank: 1 },
    { entryId: "a_tie", rating: 675, rank: 2 },
    { entryId: "b_tie", rating: 675, rank: 2 },
    { entryId: "p04", rating: 680, rank: 4 },
  ]);
  assert.equal(entries.some(({ entryId }) => entryId === "z_floor"), false);
  assert.equal(entries.some(({ entryId }) => entryId === "stale_hidden"), false);
  assert.deepEqual(Object.keys(entries[1]).sort(), [
    "achievementShowcase", "crownSignatureId", "crownTheme", "entryId", "name", "rank", "rating", "serverMatches",
  ]);

});


test("RATE FLOOR only preserves validated public decorations and caps the showcase at three", () => {
  const achievements = loadAchievements();
  const normalize = loadRateFloorNormalizer(achievements);
  const ids = achievements.catalog.slice(0, 4).map(({ id }) => id);
  const [entry] = normalize({
    player: {
      name: "Player", rating: 800, serverMatches: 11,
      crownTheme: "aqua", crownSignatureId: "daily_champion",
      achievementShowcase: [ids[0], "unknown-achievement", ids[1], ids[0], ids[2], ids[3]],
      xHandle: "private", commentsEnabled: true, unlocked: { [ids[3]]: 1 },
    },
  });
  assert.equal(entry.crownTheme, "aqua");
  assert.equal(entry.crownSignatureId, "daily_champion");
  assert.deepEqual(entry.achievementShowcase, ids.slice(0, 3));
  assert.equal("unlocked" in entry, false);
  assert.equal("xHandle" in entry, false);
  assert.equal("commentsEnabled" in entry, false);
  assert.deepEqual(normalize({ player: { ...entry, achievementShowcase: ids.join(",") } })[0].achievementShowcase, ids.slice(0, 3));
});

test("RATE FLOOR safely handles missing, invalid and hidden public decorations", () => {
  const normalize = loadRateFloorNormalizer();
  const base = { name: "Player", rating: 800, serverMatches: 10 };
  for (const decorations of [{}, {
    crownTheme: "<script>", crownSignatureId: "__proto__",
    achievementShowcase: { "<img src=x onerror=alert(1)>": true },
  }, { achievementShowcase: null }, { achievementShowcase: 42 }]) {
    const [entry] = normalize({ player: { ...base, ...decorations } });
    assert.equal(entry.crownTheme, "rose");
    assert.equal(entry.crownSignatureId, "");
    assert.deepEqual(entry.achievementShowcase, []);
  }
  assert.deepEqual(normalize({ hidden: { ...base, rateFloorHidden: true, crownSignatureId: "upset" }, invalid: null }), []);
  assert.deepEqual(normalize(null), []);
  const [unavailable] = loadRateFloorNormalizer(null)({ player: { ...base, achievementShowcase: "battle_total_10" } });
  assert.deepEqual(unavailable.achievementShowcase, []);
});


test("saved achievement selections refresh only the selected period and rejected saves do not publish", async () => {
  const actions = loadShowcaseActions({ failRefresh: true });
  await actions.saveAchievementShowcase([]);
  assert.deepEqual(actions.calls[0], { action: "set_achievement_showcase", achievementIds: [] });
  assert.deepEqual(actions.calls.filter((call) => typeof call === "string"), []);
  assert.deepEqual(actions.toasts, ["ランキングの実績ショーケースを更新しました。"]);
  assert.equal(actions.state.achievementsBusy, false);
  const rejected = loadShowcaseActions({ failSave: true });
  await rejected.saveAchievementShowcase([]);
  assert.equal(rejected.calls.includes("floor"), false);
  assert.deepEqual(rejected.toasts, ["保存エラー"]);
  assert.equal(rejected.state.achievementsBusy, false);
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
  assert.doesNotMatch(refresh, /supportingMonthlyPromise/);
  assert.match(refresh, /selectedPeriod === "monthly"/);
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
    "async function refreshRankingDashboard",
  );
  assert.match(monthlyRecovery, /leaderboardPeriod === "monthly"/);
  assert.match(monthlyRecovery, /leaderboardEntries = entries/);
  assert.match(monthlyRecovery, /leaderboardStatus = "ready"/);
});

test("top navigation reaches exactly three periods while personal proof remains visible", () => {
  const app = read("app.js");
  const styles = read("styles.css");
  const navigation = sourceBetween(
    app,
    "function rankingJumpSurfacesSettled",
    "function refreshRankingAtPeriodBoundary",
  );
  const rankingScreen = sourceBetween(app, "function renderRankingScreen", "function startOnlineBattle");
  const jumpIndex = rankingScreen.indexOf('class="ranking-jump-nav"');
  const dashboardIndex = rankingScreen.indexOf("${renderRankingDashboardPanel()}");
  assert.ok(jumpIndex >= 0 && jumpIndex < dashboardIndex);
  for (const target of ["daily", "weekly", "monthly"]) {
    assert.match(rankingScreen, new RegExp(`data-ranking-jump="${target}"`));
  }
  assert.doesNotMatch(app, /YOUR RIVAL ZONE|あなたの現在地|data-ranking-jump="(?:overall|floor)"/);
  assert.match(app, /renderCrownRunPanel\(dashboard\)/);
  assert.match(navigation, /getLeaderboardStatus/);
  assert.doesNotMatch(navigation, /getOverallLeaderboardStatus|getRateFloorLeaderboardStatus/);
  assert.match(navigation, /getRankingDashboardStatus/);
  assert.match(navigation, /pendingRankingJump = "circuit"/);
  assert.match(navigation, /applyPendingRankingJump\(\)/);
  assert.match(navigation, /scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/);
  assert.match(rankingScreen, /if \(currentScreen !== "ranking"\) pendingRankingJump = ""/);
  assert.match(rankingScreen, /applyPendingRankingJump\(\)/);
  assert.match(styles, /\.ranking-jump-nav/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.ranking-jump-nav/);
});

test("all changed browser assets share the ranking TOP 10 cache marker", () => {
  const html = read("index.html");
  assert.match(html, /styles\.css\?v=[^"]*ranking-top10-v3/);
  assert.match(html, /app\.js\?v=[^"]*ranking-top10-v3/);
  assert.match(html, /online\.js\?v=[^"]*ranking-top10-v3/);
});

test("updated ranking assets share the period-only cache marker", () => {
  const html = read("index.html");
  for (const asset of ["app", "online", "strategy"]) {
    assert.match(html, new RegExp(`${asset}\\.js\\?v=[^"]*period-rankings-only-v1`));
  }
});

test("Crown proof remains usable when optional personal ranking context is unavailable", () => {
  const online = read("online.js");
  const app = read("app.js");
  const html = read("index.html");
  const applyRun = sourceBetween(
    online,
    "function applyCrownRunToRankingDashboard",
    "function getRankingDashboard",
  );
  const startRun = sourceBetween(
    online,
    "async function startCrownRun",
    "async function refreshLeaderboard",
  );

  assert.doesNotMatch(online, /contextAvailable: overallSource/);
  assert.doesNotMatch(app, /順位の周辺情報/);
  assert.match(applyRun, /if \(!rankingDashboard\)/);
  assert.match(applyRun, /enabled: true/);
  assert.match(applyRun, /contextAvailable: false/);
  assert.match(startRun, /applyCrownRunToRankingDashboard\(result\.run \|\| result\.crownRun\)/);
  assert.match(startRun, /refreshLeaderboard\("daily", \{ force: true \}\)\.catch/);
  assert.doesNotMatch(startRun, /await refreshLeaderboard/);
  assert.match(html, /styles\.css\?v=[^"]*crown-dashboard-recovery-v1/);
  assert.match(html, /app\.js\?v=[^"]*crown-dashboard-recovery-v1/);
  assert.match(html, /online\.js\?v=[^"]*crown-dashboard-recovery-v1/);
});

test("battle launch releases ranking ownership only after the target feature is active", () => {
  const app = read("app.js");
  const launchers = sourceBetween(app, "function releaseRankingScreenOwnership", "function startAiTextTraining");
  const onlineLauncher = sourceBetween(app, "function openOnlineFeature", "async function processImageFile");
  assert.match(launchers, /if \(currentScreen !== "ranking" \|\| featureActive !== true\) return/);
  assert.match(launchers, /pendingRankingJump = ""/);
  assert.match(launchers, /currentScreen = nextScreen/);
  assert.match(launchers, /releaseRankingScreenOwnership\("online", window\.HariaiOnline\?\.isActive\?\.\(\) === true\)/);
  assert.match(launchers, /releaseRankingScreenOwnership\("strategy", window\.HariaiStrategy\?\.isActive\?\.\(\) === true\)/);
  assert.match(onlineLauncher, /window\.HariaiOnline\[method\]\(\);\s+onStarted\?\.\(\)/);
  assert.match(onlineLauncher, /launchFeature\("online"/);
});
