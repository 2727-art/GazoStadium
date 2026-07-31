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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function monthlyOpeningHarness(online) {
  const periodKey = sourceBetween(
    online,
    "function leaderboardPeriodKeyFor",
    "function leaderboardPeriodStartAt",
  );
  const periodStart = sourceBetween(
    online,
    "function leaderboardPeriodStartAt",
    "function leaderboardPeriodInfoFor",
  );
  const earliestOpening = sourceBetween(
    online,
    "function crownMonthlyEarliestOpeningAt",
    "function crownMonthlyOpeningProgress",
  );
  const openingProgress = sourceBetween(
    online,
    "function crownMonthlyOpeningProgress",
    "function getCrownMonthlyOpeningStatus",
  );
  const openingStatus = sourceBetween(
    online,
    "function getCrownMonthlyOpeningStatus",
    "function getLeaderboardPeriodInfo",
  );
  return Function(`
    "use strict";
    const CROWN_CIRCUIT_CUTOVER_KEYS = { weekly: "2026-08-03", monthly: "2026-08" };
    const CROWN_MONTHLY_MIN_WEEKS = 2;
    const normalizeLeaderboardPeriod = (value) => value;
    const isCrownCircuitPeriod = (period, key) => period === "monthly" && key >= "2026-08";
    ${periodKey}
    ${periodStart}
    ${earliestOpening}
    ${openingProgress}
    const publicServerTimeOffset = 0;
    let leaderboardPeriod = "monthly";
    let leaderboardPeriodKey = "2026-08";
    let leaderboardEntries = [];
    const leaderboardPeriodInfoFor = (_period, timestamp) => {
      const key = leaderboardPeriodKeyFor("monthly", timestamp);
      return { key, crownCircuit: isCrownCircuitPeriod("monthly", key) };
    };
    ${openingStatus}
    const openingStatusAt = (timestamp, entries = []) => {
      leaderboardPeriod = "monthly";
      leaderboardPeriodKey = leaderboardPeriodKeyFor("monthly", timestamp);
      leaderboardEntries = entries;
      return getCrownMonthlyOpeningStatus(timestamp);
    };
    return { crownMonthlyEarliestOpeningAt, crownMonthlyOpeningProgress, openingStatusAt };
  `)();
}

function normalCrownLaunchHarness(online, dependencies) {
  const isCurrent = sourceBetween(
    online,
    "function crownMatchmakingLaunchIsCurrent",
    "function finishCrownMatchmakingLaunch",
  );
  const finish = sourceBetween(
    online,
    "function finishCrownMatchmakingLaunch",
    "async function continueRequestedMatchmaking",
  );
  const continueLaunch = sourceBetween(
    online,
    "async function continueRequestedMatchmaking",
    "function requestMatchmaking",
  );
  return Function("dependencies", `
    "use strict";
    let active = true;
    let state = dependencies.state;
    const startCrownRun = dependencies.startCrownRun;
    const getCrownMatchmakingState = dependencies.getCrownMatchmakingState;
    const beginMatchmaking = dependencies.beginMatchmaking;
    const updateSoloCrownMatchmakingActions = dependencies.updateActions;
    const showToast = dependencies.showToast;
    const console = { error() {} };
    ${isCurrent}
    ${finish}
    ${continueLaunch}
    return {
      continueRequestedMatchmaking,
      setActive(value) { active = value; },
      setState(value) { state = value; },
    };
  `)(dependencies);
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

test("monthly Crown opening guidance reports per-player progress and the August earliest date", () => {
  const online = read("online.js");
  const app = read("app.js");
  const {
    crownMonthlyEarliestOpeningAt,
    crownMonthlyOpeningProgress,
    openingStatusAt,
  } = monthlyOpeningHarness(online);

  assert.equal(
    crownMonthlyEarliestOpeningAt("2026-08"),
    Date.parse("2026-08-17T00:05:00+09:00"),
  );
  assert.equal(crownMonthlyEarliestOpeningAt("2026-07"), 0);
  assert.equal(
    crownMonthlyEarliestOpeningAt("2026-09"),
    Date.parse("2026-09-14T00:05:00+09:00"),
  );
  assert.deepEqual(crownMonthlyOpeningProgress([]), {
    opened: false,
    highestQualifyingWeeks: 0,
  });
  assert.deepEqual(crownMonthlyOpeningProgress([{ qualifyingCount: 1, qualified: false }]), {
    opened: false,
    highestQualifyingWeeks: 1,
  });
  assert.deepEqual(crownMonthlyOpeningProgress([{ qualifyingCount: 2, qualified: true }]), {
    opened: true,
    highestQualifyingWeeks: 2,
  });
  assert.equal(
    openingStatusAt(Date.parse("2026-08-17T00:04:59+09:00")).earliestOpeningAt,
    Date.parse("2026-08-17T00:05:00+09:00"),
  );
  assert.equal(
    openingStatusAt(Date.parse("2026-08-17T00:05:00+09:00")).earliestOpeningAt,
    0,
  );

  const rankingScreen = sourceBetween(app, "function renderRankingScreen", "function startOnlineBattle");
  assert.match(rankingScreen, /monthlyOpening\?\.pending === true/);
  assert.match(rankingScreen, /月間王座 開幕準備中/);
  assert.match(rankingScreen, /最高進捗/);
  assert.match(rankingScreen, /最短開幕目安/);
  assert.match(rankingScreen, /同じプレイヤーが成立ウィークリー/);
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

test("normal and strategy setup screens expose one contextual proof-run matchmaking state", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");

  const crownState = sourceBetween(
    online,
    "function getCrownMatchmakingState",
    "function renderCrownMatchmakingActions",
  );
  assert.match(crownState, /dashboard\.rules\.dailyMatchLimit/);
  assert.match(crownState, /dashboard\.rules\.dailyKey/);
  assert.match(crownState, /dashboardDailyKey !== dailyInfo\.key/);
  assert.match(crownState, /dashboard\.rules\.modes\.includes\(normalizedMode\)/);
  assert.match(crownState, /run\.key === expectedKey/);
  assert.match(crownState, /\["complete", "finalized"\]/);
  assert.match(crownState, /matchCount >= limit/);

  const actions = sourceBetween(
    online,
    "function renderCrownMatchmakingActions",
    "function focusCrownRankingParticipation",
  );
  assert.match(actions, /♛ 三戦証明で対戦相手を探す/);
  assert.match(actions, /三戦証明 \$\{crownState\.nextMatch\}\/\$\{crownState\.limit\}戦目の相手を探す/);
  assert.match(actions, /♛ 本日の三戦証明 完了/);
  assert.match(actions, /data-crown-matchmaking-action="participation"/);
  assert.match(actions, /data-crown-matchmaking-action="retry"/);

  assert.match(online, /id="soloCrownMatchmakingActions"/);
  assert.match(online, /crownButtonId:\s*"soloCrownMatchmaking"/);
  assert.match(strategy, /id="strategyCrownMatchmakingActions"/);
  assert.match(strategy, /crownButtonId:\s*"strategyCrownMatchmaking"/);
  assert.match(strategy, /regularType:\s*"submit"/);
  assert.match(strategy, /event\.submitter\?\.dataset\.crownMatchmakingAction === "start"/);
  const strategyAuth = sourceBetween(
    strategy,
    "async function ensureAuthenticated",
    "function normalizeProfile",
  );
  assert.ok(strategyAuth.indexOf("syncStrategyProfileDraft()") < strategyAuth.indexOf("render()"));
});

test("proof matchmaking starts only after confirmation and never creates a second queue path", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");
  const normalLaunch = sourceBetween(
    online,
    "async function continueRequestedMatchmaking",
    "function requestMatchmaking",
  );
  const normalRequest = sourceBetween(
    online,
    "function requestMatchmaking",
    "function bindOnlineRoleplayVoiceField",
  );
  const strategySubmit = sourceBetween(
    strategy,
    "async function saveProfile",
    "function isCurrentStrategyMatchmakingGeneration",
  );

  assert.ok(normalLaunch.indexOf("await startCrownRun()") < normalLaunch.indexOf("await beginMatchmaking()"));
  assert.match(normalLaunch, /crownMatchmakingLaunchIsCurrent\(context\)/);
  assert.match(normalLaunch, /\["active", "complete"\]\.includes\(crownState\.phase\)/);
  assert.doesNotMatch(normalLaunch, /\bset\(ref\(database|\bupdate\(ref\(database/);
  assert.match(normalRequest, /if \(state\.matchmakingLaunchBusy \|\| !isMatchmakingSetupReady\(\)\) return/);
  assert.match(normalRequest, /pendingSampleMatchmakingLaunch = context/);
  assert.match(normalRequest, /if \(window\.confirm[\s\S]*continueRequestedMatchmaking\(context\)/);

  assert.ok(strategySubmit.indexOf("await startRun()") < strategySubmit.indexOf("await beginMatchmaking()"));
  assert.match(strategySubmit, /strategyMatchmakingLaunchIsCurrent\(context\)/);
  assert.match(strategySubmit, /if \(state\.matchmakingLaunchBusy\) return/);
  assert.match(strategySubmit, /context\.expectedState\.screen === "matching"[\s\S]*await cancelMatching\(\)/);
  assert.doesNotMatch(strategySubmit, /\bset\(ref\(database|\bupdate\(ref\(database/);

  assert.match(online, /matchmakingLaunchGeneration/);
  assert.match(strategy, /matchmakingLaunchGeneration/);
  assert.match(online, /pendingSampleMatchmakingLaunch = null/);
  assert.match(online, /confirmed && crownMatchmakingLaunchIsCurrent\(context\)/);
  assert.match(online, /currentDashboard\?\.rules\.dailyKey !== getLeaderboardPeriodInfo\("daily"\)\.key/);
});

test("proof matchmaking waits for declaration, blocks the queue on rejection, and ignores late completion", async () => {
  const online = read("online.js");

  {
    const start = deferred();
    const state = {
      screen: "setup",
      matchmakingLaunchBusy: true,
      matchmakingLaunchGeneration: 1,
    };
    let queueStarts = 0;
    const harness = normalCrownLaunchHarness(online, {
      state,
      startCrownRun: () => start.promise,
      getCrownMatchmakingState: () => ({ phase: "active" }),
      beginMatchmaking: async () => { queueStarts += 1; },
      updateActions() {},
      showToast() {},
    });
    const launch = harness.continueRequestedMatchmaking({
      intent: "crown",
      expectedState: state,
      generation: 1,
    });
    await Promise.resolve();
    assert.equal(queueStarts, 0);
    start.resolve();
    await launch;
    assert.equal(queueStarts, 1);
    assert.equal(state.matchmakingLaunchBusy, false);
  }

  {
    const state = {
      screen: "setup",
      matchmakingLaunchBusy: true,
      matchmakingLaunchGeneration: 2,
    };
    let queueStarts = 0;
    const harness = normalCrownLaunchHarness(online, {
      state,
      startCrownRun: async () => { throw new Error("rejected"); },
      getCrownMatchmakingState: () => ({ phase: "idle" }),
      beginMatchmaking: async () => { queueStarts += 1; },
      updateActions() {},
      showToast() {},
    });
    await harness.continueRequestedMatchmaking({
      intent: "crown",
      expectedState: state,
      generation: 2,
    });
    assert.equal(queueStarts, 0);
    assert.equal(state.matchmakingLaunchBusy, false);
  }

  {
    const start = deferred();
    const state = {
      screen: "setup",
      matchmakingLaunchBusy: true,
      matchmakingLaunchGeneration: 3,
    };
    let queueStarts = 0;
    const harness = normalCrownLaunchHarness(online, {
      state,
      startCrownRun: () => start.promise,
      getCrownMatchmakingState: () => ({ phase: "active" }),
      beginMatchmaking: async () => { queueStarts += 1; },
      updateActions() {},
      showToast() {},
    });
    const launch = harness.continueRequestedMatchmaking({
      intent: "crown",
      expectedState: state,
      generation: 3,
    });
    await Promise.resolve();
    harness.setActive(false);
    start.resolve();
    await launch;
    assert.equal(queueStarts, 0);
  }
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
    ".crown-monthly-opening",
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.crown-customization/);
  assert.match(html, /styles\.css\?v=[^"]*crown-circuit-v2/);
  assert.match(html, /app\.js\?v=[^"]*crown-circuit-v2/);
  assert.match(html, /online\.js\?v=[^"]*crown-circuit-v2/);
  assert.match(html, /styles\.css\?v=[^"]*crown-monthly-achievements-v1/);
  assert.match(html, /app\.js\?v=[^"]*crown-monthly-achievements-v1/);
  assert.match(html, /online\.js\?v=[^"]*crown-monthly-achievements-v1/);
  assert.match(styles, /\.crown-matchmaking-actions/);
  assert.match(styles, /\.button-crown-proof/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.crown-matchmaking-status/);
  assert.match(html, /styles\.css\?v=[^"]*crown-matchmaking-v1/);
  assert.match(html, /strategy\.js\?v=[^"]*crown-matchmaking-v1/);
  assert.match(html, /online\.js\?v=[^"]*crown-matchmaking-v1/);
});
