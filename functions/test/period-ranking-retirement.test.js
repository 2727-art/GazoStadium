"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const crown = require("../crown-circuit");

const root = path.resolve(__dirname, "../..");
const server = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
const online = fs.readFileSync(path.join(root, "online.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} / ${end}`);
  return source.slice(from, to);
}

function dashboardHarness({ enabled = true, run = true, presentationFails = false } = {}) {
  const calls = [];
  const profile = { enabled, entryId: "public-entry-player", rating: 1375,
    serverMatches: 42, crownTheme: "gold", crownSignatureId: "daily_champion",
    bestOverallRank: 1, rateFloorEnabled: true };
  const crownRun = { key: "2026-11-04", status: "active", matchCount: 1, crownPower: 1400 };
  const deps = {
    ...crown,
    periodKey: () => "2026-11-04",
    periodEndsAt: () => Date.now() + 60_000,
    isCrownCircuitPeriod: () => true,
    serverRankingProfileRef: () => ({ get: async () => {
      calls.push("profile.read"); return { data: () => profile };
    } }),
    crownCircuitRunRef: () => ({ get: async () => {
      calls.push("run.read"); return { exists: run, data: () => crownRun };
    } }),
    normalizeServerRankingProfile: (value) => value,
    publicCrownCircuitEntry: (value) => value,
    realtime: { ref: (key) => {
      assert.equal(key, "online/rankingSpotlights/current");
      return { get: async () => {
        calls.push("spotlight.read");
        if (presentationFails) throw new Error("unavailable");
        return { exists: true, child: () => ({ val: () => Date.now() + 60_000 }),
          val: () => ({ entryId: "champion-entry", name: "Champion" }) };
      } };
    } },
    maskPlayerRankingEntries: async (_uid, rows) => {
      calls.push("spotlight.mask"); assert.equal(rows.length, 1); return rows;
    },
    objectValue: (value) => value,
    rankingDependencyErrorCode: () => "unavailable",
    console: { warn() {} },
  };
  // No Firestore query/write or overall-standing dependency is available here.
  const get = Function(...Object.keys(deps), `${between(server,
    "async function getRankingDashboard", "async function startRankingCrownRun")}; return getRankingDashboard;`)(...Object.values(deps));
  return { get, calls, profile, crownRun };
}

test("preparation dashboard reads only the profile and today's run, retaining internal RATE", async () => {
  for (const options of [{}, { enabled: false, run: false }]) {
    const harness = dashboardHarness(options);
    const result = await harness.get("viewer");
    assert.deepEqual(harness.calls, ["profile.read", "run.read"]);
    assert.equal(result.profile.rating, 1375);
    assert.deepEqual(result.overall, { rating: 1375 });
    assert.equal(result.presentationIncluded, false);
    assert.equal(result.spotlight, null);
    assert.equal("customization" in result, false);
    assert.equal("rateFloorEnabled" in result.profile, false);
    assert.equal(result.crownRun, options.run === false ? null : harness.crownRun);
    assert.deepEqual(result.rules.modes, ["solo", "strategy"]);
  }
});

test("ranking screen reads only profile, proof and spotlight without customization queries", async () => {
  const harness = dashboardHarness();
  const result = await harness.get("viewer", { includePresentation: true });
  assert.deepEqual(harness.calls, ["profile.read", "run.read", "spotlight.read", "spotlight.mask"]);
  assert.equal(result.presentationIncluded, true);
  assert.equal(result.spotlight.name, "Champion");
  assert.deepEqual(result.overall, { rating: 1375 });
  assert.equal(harness.profile.bestOverallRank, 1);
  assert.equal("customization" in result, false);
  assert.equal(harness.profile.crownTheme, "gold");
  assert.equal(harness.profile.crownSignatureId, "daily_champion");
});

test("unavailable presentation still returns the current proof run and internal rating", async () => {
  const harness = dashboardHarness({ presentationFails: true });
  const result = await harness.get("viewer", { includePresentation: true });
  assert.equal(result.crownRun, harness.crownRun);
  assert.equal(result.profile.rating, 1375);
  assert.equal(result.spotlight, null);
  assert.equal("customization" in result, false);
});

test("daily and weekly fetch only the selected period; monthly stays available on demand", async () => {
  const calls = [];
  const deps = {
    normalizeLeaderboardPeriod: (value) => value,
    leaderboardPeriodInfoFor: (period, _time, key) => ({ period, key: key || `${period}-current` }),
    readCachedPeriodPublicTop10: async (_info, period, options) => {
      calls.push({ period, options }); return [{ entryId: `${period}-winner` }];
    },
    refreshMonthlyBeyondCache: async (options) => {
      calls.push({ period: "monthly", options }); return [{ entryId: "monthly-winner" }];
    },
    refreshMonthlyHallOfFame: async () => {},
    window: { dispatchEvent() {} },
  };
  const harness = Function(...Object.keys(deps), `
    let leaderboardPeriod = "weekly", leaderboardPeriodKey = "", leaderboardRequestId = 0;
    let leaderboardEntries = [], leaderboardStatus = "idle";
    const publicServerTimeOffset = 0, useOfflineMarketPreview = false;
    const rankingDashboardVisibleSurface = () => "ranking";
    ${between(online, "async function refreshLeaderboard", "async function ensureAuthenticated")}
    return { refreshLeaderboard, entries: () => leaderboardEntries, status: () => leaderboardStatus };
  `)(...Object.values(deps));
  for (const period of ["daily", "weekly", "monthly"]) {
    calls.length = 0;
    await harness.refreshLeaderboard(period, { force: true });
    assert.deepEqual(calls, [{ period, options: { force: true } }]);
    assert.equal(harness.entries()[0].entryId, `${period}-winner`);
    assert.equal(harness.status(), "ready");
  }
});

test("ranking refresh requests only the selected period and presentation dashboard", () => {
  const calls = [];
  const refresh = Function("window", "refreshSelectedRankingPeriod", `${between(app,
    "function refreshRankingSurfaces", "function selectRankingPeriod")}; return refreshRankingSurfaces;`)(
    { HariaiOnline: {
      refreshRankingDashboard: (options) => calls.push(options),
      refreshOverallLeaderboard: () => assert.fail("retired overall read"),
      refreshRateFloorLeaderboard: () => assert.fail("retired floor read"),
    } }, () => calls.push("selected-period"),
  );
  refresh();
  assert.deepEqual(calls, ["selected-period", { includePresentation: true }]);
});

test("a lightweight refresh preserves the already loaded spotlight", () => {
  const presentation = { spotlight: { name: "Champion" } };
  const harness = Function("initial", `
    let rankingDashboard = initial, rankingDashboardStatus = "idle", rankingDashboardError = "";
    const normalizeRankingDashboard = (value) => value;
    const dispatchRankingDashboardUpdated = () => {};
    ${between(online, "function applyRankingDashboard", "function applyCrownRunToRankingDashboard")}
    return applyRankingDashboard;
  `)(presentation);
  const result = harness({ presentationIncluded: false, overall: { rating: 1400 }, crownRun: { matchCount: 2 } });
  assert.equal("customization" in result, false);
  assert.deepEqual(result.spotlight, presentation.spotlight);
  assert.equal(result.crownRun.matchCount, 2);
  assert.equal(result.overall.rating, 1400);
});

test("participation withdrawal removes spotlight using the retained public identity index", () => {
  const withdrawal = between(server, "async function removeServerRankingPublicEntries", "async function setServerRankingParticipation");
  assert.match(withdrawal, /online\/leaderboardEntriesByUser/);
  assert.match(withdrawal, /updates\["online\/rankingSpotlights\/current"\] = null/);
  assert.doesNotMatch(withdrawal, /serverOverallLeaderboard|serverRateFloorLeaderboard/);
});
