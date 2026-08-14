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

function functionDeclaration(source, name) {
  const asyncIndex = source.indexOf(`async function ${name}(`);
  const syncIndex = source.indexOf(`function ${name}(`);
  const startIndex = asyncIndex >= 0 && (syncIndex < 0 || asyncIndex < syncIndex)
    ? asyncIndex
    : syncIndex;
  assert.notEqual(startIndex, -1, `missing function: ${name}`);
  const parametersStart = source.indexOf("(", startIndex);
  assert.notEqual(parametersStart, -1, `missing function parameters: ${name}`);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    else if (source[index] === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  assert.notEqual(parametersEnd, -1, `unterminated function parameters: ${name}`);
  const bodyStart = source.indexOf("{", parametersEnd + 1);
  assert.notEqual(bodyStart, -1, `missing function body: ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }
  assert.fail(`unterminated function: ${name}`);
}

function weeklyPeriodHarness(online) {
  const declarations = [
    "normalizeLeaderboardPeriod",
    "leaderboardPeriodKeyFor",
    "leaderboardPeriodStartAt",
    "validWeeklyLeaderboardPeriodKey",
    "weeklyLeaderboardPeriodKeys",
    "leaderboardPeriodInfoFor",
    "weeklyLeaderboardPeriodOptions",
  ].map((name) => functionDeclaration(online, name)).join("\n");
  return Function(`
    "use strict";
    const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"];
    const CROWN_CIRCUIT_CUTOVER_KEYS = {
      daily: "2026-07-28",
      weekly: "2026-08-03",
      monthly: "2026-08",
    };
    const SERVER_RANKING_AWARD_MINIMUM_MATCHES = { daily: 1, weekly: 3, monthly: 10 };
    const CROWN_WEEKLY_HISTORY_LIMIT = 5;
    const CROWN_DAILY_MATCH_LIMIT = 3;
    const CROWN_WEEKLY_MIN_DAYS = 2;
    const CROWN_MONTHLY_MIN_WEEKS = 2;
    const CROWN_WEEKLY_BEST_DAYS = 3;
    const CROWN_MONTHLY_BEST_WEEKS = 3;
    const publicServerTimeOffset = 0;
    let leaderboardPeriod = "weekly";
    const jstDateKey = (timestamp) => new Date(timestamp + (9 * 60 * 60 * 1000))
      .toISOString().slice(0, 10);
    const isCrownCircuitPeriod = (period, key) => key >= CROWN_CIRCUIT_CUTOVER_KEYS[period];
    const isServerRankingPeriod = () => true;
    ${declarations}
    return { leaderboardPeriodInfoFor, weeklyLeaderboardPeriodOptions };
  `)();
}

function monthlyReadHarness(online, readPublicDatabasePath) {
  const declarations = [
    "publicRankingRecordMap",
    "publicPeriodLeaderboardPath",
    "crownMonthlyOpeningProgress",
    "readCrownCircuitPublicTop10",
    "readCrownMonthlyOpeningProgress",
  ].map((name) => functionDeclaration(online, name)).join("\n");
  return Function("readPublicDatabasePath", `
    "use strict";
    const PUBLIC_RANKING_LIMIT = 10;
    const CROWN_MONTHLY_MIN_WEEKS = 2;
    const normalizeCrownCircuitRecords = (entries) => Object.entries(entries || {})
      .map(([entryId, entry]) => ({ entryId, ...entry }));
    ${declarations}
    return { readCrownCircuitPublicTop10, readCrownMonthlyOpeningProgress };
  `)(readPublicDatabasePath);
}

function weeklyReadHarness(online, readPublicDatabasePath) {
  const declarations = [
    "validLeaderboardEntryId",
    "normalizeCrownTheme",
    "normalizeCrownSignatureIds",
    "crownCircuitEntryIsQualified",
    "normalizeCrownCircuitRecords",
    "publicPeriodLeaderboardPath",
    "normalizeCrownWeeklySeatHistoryRecords",
    "readPeriodPublicTop10",
  ].map((name) => functionDeclaration(online, name)).join("\n");
  return Function("readPublicDatabasePath", `
    "use strict";
    const PUBLIC_RANKING_LIMIT = 10;
    const LEGACY_PERIOD_QUERY_LIMIT = 100;
    const INITIAL_RATING = 1000;
    const CROWN_DAILY_MATCH_LIMIT = 3;
    const CROWN_THEMES = ["rose"];
    const CROWN_SIGNATURE_IDS = [];
    const normalizeLeaderboardPeriod = (value) => value;
    const readCrownCircuitPublicTop10 = async (path, period) => [{ kind: "live", path, period }];
    const normalizeLeaderboardRecords = (records) => records;
    ${declarations}
    return {
      publicPeriodLeaderboardPath,
      normalizeCrownWeeklySeatHistoryRecords,
      readPeriodPublicTop10,
    };
  `)(readPublicDatabasePath);
}

function periodCacheHarness(online, readPeriodPublicTop10) {
  const declaration = functionDeclaration(online, "readCachedPeriodPublicTop10");
  return Function("readPeriodPublicTop10", `
    "use strict";
    const PERIOD_RANKING_CACHE_TTL_MS = 60 * 1000;
    const periodLeaderboardCache = new Map();
    const periodLeaderboardRequests = new Map();
    ${declaration}
    return {
      readCachedPeriodPublicTop10,
      cacheKeys: () => [...periodLeaderboardCache.keys()].sort(),
    };
  `)(readPeriodPublicTop10);
}

test("monthly rankScore zero stays out of TOP 10 while a separate progress query reports 1/2", async () => {
  const online = read("online.js");
  const provisional = {
    name: "ONE WEEK PLAYER",
    rating: 1000,
    qualifyingCount: 1,
    circuitScore: 25,
    rankScore: 0,
  };
  const calls = [];
  const harness = monthlyReadHarness(online, async (pathValue, options) => {
    calls.push({ path: pathValue, options });
    return { entry_aaaaaaaaaa: provisional };
  });

  const officialTopTen = await harness.readCrownCircuitPublicTop10(
    "online/crownCircuitPeriods/monthly/2026-08",
    "monthly",
  );
  assert.deepEqual(officialTopTen, [], "rankScore=0 must remain provisional, not an official seat");

  const progress = await harness.readCrownMonthlyOpeningProgress({
    period: "monthly",
    key: "2026-08",
    crownCircuit: true,
    historical: false,
  });
  assert.deepEqual(progress, {
    opened: false,
    highestQualifyingWeeks: 1,
  });
  assert.deepEqual(calls, [
    {
      path: "online/crownCircuitPeriods/monthly/2026-08",
      options: { orderByChildKey: "rankScore", limit: 10 },
    },
    {
      path: "online/crownCircuitPeriods/monthly/2026-08",
      options: {
        orderByChildKey: "qualifyingCount",
        limit: 1,
        limitDirection: "last",
        readServerTimeOffset: false,
      },
    },
  ]);
});

test("weekly options show the current August week plus finalized history and never cross cutover", () => {
  const online = read("online.js");
  const {
    leaderboardPeriodInfoFor,
    weeklyLeaderboardPeriodOptions,
  } = weeklyPeriodHarness(online);
  const august14 = Date.parse("2026-08-14T12:00:00+09:00");
  const firstAugustOptions = weeklyLeaderboardPeriodOptions(
    august14,
    5,
  );
  assert.deepEqual(firstAugustOptions.map((option) => ({
    key: option.key,
    label: option.label,
    current: option.current,
    historical: option.historical,
    finalized: option.finalized,
  })), [
    {
      key: "2026-08-10",
      label: "8/10〜8/16",
      current: true,
      historical: false,
      finalized: false,
    },
    {
      key: "2026-08-03",
      label: "8/3〜8/9",
      current: false,
      historical: true,
      finalized: true,
    },
  ]);

  const establishedOptions = weeklyLeaderboardPeriodOptions(
    Date.parse("2026-09-18T12:00:00+09:00"),
    5,
  );
  assert.equal(establishedOptions.length, 6, "current week plus five finalized weeks");
  assert.equal(establishedOptions.filter((option) => option.historical).length, 5);
  assert.deepEqual(establishedOptions.map((option) => option.key), [
    "2026-09-14",
    "2026-09-07",
    "2026-08-31",
    "2026-08-24",
    "2026-08-17",
    "2026-08-10",
  ]);
  assert.deepEqual(
    weeklyLeaderboardPeriodOptions(Date.parse("2026-08-05T12:00:00+09:00"), 5)
      .map((option) => option.key),
    ["2026-08-03"],
    "the pre-cutover 2026-07-27 week must never be offered as Crown history",
  );

  assert.equal(
    leaderboardPeriodInfoFor("weekly", august14, "2026-08-03").historical,
    true,
  );
  for (const rejectedKey of [
    "2026-08-17",
    "2026-08-11",
    "2026-07-27",
  ]) {
    assert.throws(
      () => leaderboardPeriodInfoFor("weekly", august14, rejectedKey),
      /表示できないウィークリー期間です/,
      `${rejectedKey} must not be accepted as selectable history on 2026-08-14`,
    );
  }
});

test("current weekly reads the live path while finalized history reads seatHistory first ten seats", async () => {
  const online = read("online.js");
  const calls = [];
  const rawHistory = {
    1: {
      entryId: "entry_aaaaaaaaaa",
      name: "FIRST",
      rating: 1200,
      rank: 1,
      rankScore: 80,
      qualifyingCount: 2,
    },
    2: {
      entryId: "entry_bbbbbbbbbb",
      name: "SECOND",
      rating: 1100,
      displayRank: 2,
      circuitScore: 50,
      qualifyingCount: 2,
    },
    3: {
      entryId: "entry_cccccccccc",
      name: "MISMATCHED SEAT",
      rating: 1050,
      rank: 4,
      rankScore: 40,
      qualifyingCount: 2,
    },
  };
  const harness = weeklyReadHarness(online, async (pathValue, options) => {
    calls.push({ path: pathValue, options });
    return rawHistory;
  });
  const current = {
    period: "weekly",
    key: "2026-08-10",
    crownCircuit: true,
    historical: false,
  };
  const history = {
    period: "weekly",
    key: "2026-08-03",
    crownCircuit: true,
    historical: true,
  };

  assert.equal(
    harness.publicPeriodLeaderboardPath(current, "weekly"),
    "online/crownCircuitPeriods/weekly/2026-08-10",
  );
  assert.equal(
    harness.publicPeriodLeaderboardPath(history, "weekly"),
    "online/crownCircuitSeatHistory/weekly/2026-08-03",
  );
  assert.deepEqual(await harness.readPeriodPublicTop10(current, "weekly"), [{
    kind: "live",
    path: "online/crownCircuitPeriods/weekly/2026-08-10",
    period: "weekly",
  }]);

  const finalized = await harness.readPeriodPublicTop10(history, "weekly");
  assert.deepEqual(finalized.map((entry) => ({
    entryId: entry.entryId,
    rank: entry.rank,
    displayRank: entry.displayRank,
    status: entry.status,
    qualified: entry.qualified,
  })), [
    {
      entryId: "entry_aaaaaaaaaa",
      rank: 1,
      displayRank: 1,
      status: "finalized",
      qualified: true,
    },
    {
      entryId: "entry_bbbbbbbbbb",
      rank: 2,
      displayRank: 2,
      status: "finalized",
      qualified: true,
    },
  ]);
  assert.deepEqual(calls, [{
    path: "online/crownCircuitSeatHistory/weekly/2026-08-03",
    options: {
      orderByKeyOnly: true,
      limit: 10,
      limitDirection: "first",
      readServerTimeOffset: false,
    },
  }]);

  const publicRead = functionDeclaration(online, "readPublicDatabasePath");
  assert.match(publicRead, /orderByKeyOnly/);
  assert.match(publicRead, /constraints\.push\(orderByKey\(\)\)/);
  assert.match(publicRead, /limitDirection === "first"[\s\S]*limitToFirst\(normalizedLimit\)/);
});

test("live and historical weekly results have independent session cache namespaces", async () => {
  const online = read("online.js");
  const reads = [];
  const harness = periodCacheHarness(online, async (periodInfo, period) => {
    const source = periodInfo.historical ? "history" : "live";
    reads.push(`${source}:${period}:${periodInfo.key}`);
    return [{ source, key: periodInfo.key }];
  });
  const live = { key: "2026-08-10", historical: false };
  const history = { key: "2026-08-10", historical: true };

  assert.deepEqual(await harness.readCachedPeriodPublicTop10(live, "weekly"), [{
    source: "live",
    key: "2026-08-10",
  }]);
  assert.deepEqual(await harness.readCachedPeriodPublicTop10(history, "weekly"), [{
    source: "history",
    key: "2026-08-10",
  }]);
  await harness.readCachedPeriodPublicTop10(live, "weekly");
  await harness.readCachedPeriodPublicTop10(history, "weekly");

  assert.deepEqual(reads, [
    "live:weekly:2026-08-10",
    "history:weekly:2026-08-10",
  ]);
  assert.deepEqual(harness.cacheKeys(), [
    "history:weekly:2026-08-10",
    "live:weekly:2026-08-10",
  ]);
});

test("weekly picker identifies current and finalized labels and forwards only a selected history key", () => {
  const app = read("app.js");
  const picker = sourceBetween(
    app,
    "function weeklyLeaderboardPeriodOptions",
    "function rankingResetLabel",
  );
  const selection = sourceBetween(
    app,
    "function refreshSelectedRankingPeriod",
    "function rankingJumpSurfacesSettled",
  );
  const rankingScreen = sourceBetween(
    app,
    "function renderRankingScreen",
    "function startOnlineBattle",
  );

  assert.match(picker, /option\.isCurrent \? "進行中" : "確定"/);
  assert.match(picker, /確定済みの直近5週を、選んだ時だけ取得します/);
  assert.match(selection, /selectedKey = rankingPeriod === "weekly"/);
  assert.match(selection, /refreshLeaderboard\?\.\(rankingPeriod, \{ force, key: selectedKey \}\)/);
  assert.match(selection, /!option\.isCurrent && option\.key === selectedKey/);
  assert.match(rankingScreen, /#rankingWeeklyHistorySelect/);
  assert.match(rankingScreen, /selectRankingWeeklyPeriod\(event\.currentTarget\.value\)/);
  assert.match(rankingScreen, /monthlyOpeningProgressStatus === "ready"/);
  assert.match(rankingScreen, /rankingMonthlyProgressRetryButton/);
  assert.match(rankingScreen, /CROWN CIRCUIT V2 \/ FINAL/);
  const boundaryRefresh = sourceBetween(
    app,
    "function refreshRankingAtPeriodBoundary",
    "async function beginDailyCrownRun",
  );
  assert.match(boundaryRefresh, /!viewingFinalizedWeekly\(info\)/);
});

test("monthly progress index and weekly-history browser cache marker are published together", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  const indexes = rules.crownCircuitPeriods.$period.$periodKey[".indexOn"];
  assert.deepEqual(indexes, ["rankScore", "qualifyingCount"]);

  const index = read("index.html");
  for (const asset of ["styles.css", "app.js", "online.js"]) {
    assert.match(
      index,
      new RegExp(`${asset.replace(".", "\\.")}\\?v=[^\"']*weekly-history-progress-v1`),
      `${asset} must carry the weekly-history cache marker`,
    );
  }
});
