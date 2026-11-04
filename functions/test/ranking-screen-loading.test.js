"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const online = read("online.js");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} / ${end}`);
  return source.slice(from, to);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function dashboardHarness({ authWait, responseWait } = {}) {
  const calls = [];
  const ui = { surface: "top", visibility: "visible", enabled: true, day: "2026-11-04", fail: false };
  let tick, visibilityChanged;
  const deps = {
    document: {
      get visibilityState() { return ui.visibility; },
      querySelector: (selector) => selector.split(", ").includes({
        ranking: ".ranking-screen", solo: "#soloCrownMatchmakingActions", strategy: "#strategyCrownMatchmakingActions",
      }[ui.surface]) ? {} : null,
      addEventListener: (name, callback) => { assert.equal(name, "visibilitychange"); visibilityChanged = callback; },
    },
    window: { setInterval: (callback) => { tick = callback; } },
    getOverallRankingPreference: () => ({ enabled: ui.enabled }),
    getLeaderboardPeriodInfo: () => ({ key: ui.day }),
    currentDailyDateKey: () => ui.day,
    dispatchRankingDashboardUpdated: () => {},
    ensureRankingCommentUser: async () => { calls.push("auth"); await authWait; },
    economyActionCallable: async (payload) => {
      calls.push(payload);
      const day = ui.day;
      await responseWait;
      if (ui.fail) throw new Error("offline");
      return { data: { enabled: true, rules: { dailyKey: day }, crownRun: { key: day, matchCount: 1 } } };
    },
    dispatchP2pRecoveryEvent() {}, cancelUnavailableAutomaticMatchmaking() {},
    console,
  };
  const harness = Function(...Object.keys(deps), `
    let rankingDashboard = null, rankingDashboardStatus = "idle", rankingDashboardError = "";
    let rankingDashboardRequestId = 0, rankingDashboardRequest = null;
    const active = false, state = {}, useOfflineMarketPreview = false;
    const getRankingDashboard = () => rankingDashboard;
    const applyRankingDashboard = (value) => { rankingDashboardStatus = "ready"; rankingDashboard = value; return value; };
    ${between(online, "function rankingDashboardVisibleSurface", "async function startCrownRun")}
    ${between(online, "function watchDailyDateRollover", "function normalizeLeaderboardRecords")}
    ${between(online, 'document.addEventListener("visibilitychange",', 'window.addEventListener("hariai-player-safety-updated",')}
    watchDailyDateRollover();
    return { refresh: refreshRankingDashboard, automatic: refreshVisibleRankingDashboard,
      status: () => rankingDashboardStatus, data: getRankingDashboard };
  `)(...Object.values(deps));
  return { ...harness, calls, ui, tick: () => tick(), visibilityChanged: () => visibilityChanged() };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const reads = (h) => h.calls.filter((call) => typeof call === "object");

test("top and unrelated screens never authenticate or fetch ranking on midnight or tab return", async () => {
  const h = dashboardHarness();
  for (const surface of ["top", "battle", "missions", "shop"]) {
    h.ui.surface = surface;
    h.ui.day += "-next";
    h.tick();
    h.visibilityChanged();
    await h.automatic();
    await h.refresh({ includePresentation: true });
    await settle();
    assert.deepEqual(h.calls, []);
  }
});

test("visible ranking loads presentation; each preparation loads only proof for participants", async () => {
  const h = dashboardHarness();
  for (const surface of ["ranking", "solo", "strategy"]) {
    h.ui.surface = surface;
    await h.automatic();
    assert.deepEqual(reads(h).at(-1), { action: "get_ranking_dashboard", includePresentation: surface === "ranking" });
  }
  h.calls.length = 0;
  h.ui.enabled = false;
  for (const surface of ["solo", "strategy"]) {
    h.ui.surface = surface;
    await h.automatic();
  }
  assert.deepEqual(h.calls, []);
  h.ui.surface = "ranking";
  await h.automatic();
  assert.equal(reads(h).length, 1, "ranking participation controls also work for nonparticipants");
});

test("hidden tabs defer refresh until a relevant screen is visible again", async () => {
  const h = dashboardHarness();
  h.ui.surface = "solo";
  h.ui.visibility = "hidden";
  h.ui.day = "2026-11-05";
  h.tick();
  h.visibilityChanged();
  await h.refresh();
  assert.deepEqual(h.calls, []);
  h.ui.visibility = "visible";
  h.visibilityChanged();
  await settle();
  assert.equal(reads(h).length, 1);
  assert.equal(h.data().rules.dailyKey, "2026-11-05");
  assert.equal(h.status(), "ready");
});

test("period lists are never prefetched on top, preparation, or hidden screens", async () => {
  for (const surface of ["", "preparation"]) {
    const refresh = Function("rankingDashboardVisibleSurface", `
      const leaderboardPeriod = "daily";
      ${between(online, "async function refreshLeaderboard", "async function ensureAuthenticated")}
      return refreshLeaderboard;
    `)(() => surface);
    // No database/cache dependencies are supplied; leaving the guard would fail.
    await refresh("daily", { force: true });
    await refresh("weekly");
    await refresh("monthly");
  }
});

test("midnight refreshes visible proof, and tab return also refreshes same-day changes", async () => {
  const h = dashboardHarness();
  h.ui.surface = "strategy";
  await h.automatic();
  h.ui.day = "2026-11-05";
  h.tick();
  h.visibilityChanged();
  await settle();
  assert.equal(reads(h).length, 2, "overlapping midnight and visibility triggers share a request");
  assert.equal(h.data().rules.dailyKey, "2026-11-05");
  await h.automatic({ onlyIfStale: true });
  assert.equal(reads(h).length, 2);
  h.visibilityChanged();
  await settle();
  assert.equal(reads(h).length, 3);
});

test("leaving during authentication cancels the dashboard read and a later entry can retry", async () => {
  const auth = deferred();
  const h = dashboardHarness({ authWait: auth.promise });
  h.ui.surface = "ranking";
  const pending = h.automatic();
  assert.equal(h.status(), "loading");
  h.ui.surface = "top";
  auth.resolve();
  await pending;
  assert.equal(reads(h).length, 0);
  assert.equal(h.status(), "idle");
  h.ui.surface = "solo";
  await h.automatic();
  assert.equal(reads(h).length, 1);
  assert.equal(h.status(), "ready");
});

test("concurrent entry refreshes share a read and ranking can upgrade a preparation request", async () => {
  const auth = deferred();
  const h = dashboardHarness({ authWait: auth.promise });
  h.ui.surface = "solo";
  const first = h.automatic();
  const duplicate = h.automatic();
  h.ui.surface = "ranking";
  const full = h.automatic();
  auth.resolve();
  await Promise.all([first, duplicate, full]);
  assert.deepEqual(reads(h), [{ action: "get_ranking_dashboard", includePresentation: true }]);
});

test("a new day supersedes an in-flight old-day request", async () => {
  const response = deferred();
  const h = dashboardHarness({ responseWait: response.promise });
  h.ui.surface = "solo";
  const old = h.automatic();
  await settle();
  h.ui.day = "2026-11-05";
  const current = h.automatic();
  await settle();
  response.resolve();
  await Promise.all([old, current]);
  assert.equal(h.data().rules.dailyKey, "2026-11-05");
  assert.equal(reads(h).length, 2);
});

test("failed reads release the pending request so a return can recover", async () => {
  const h = dashboardHarness();
  h.ui.surface = "solo";
  h.ui.fail = true;
  await h.automatic();
  assert.equal(h.status(), "error");
  h.ui.fail = false;
  await h.automatic();
  assert.equal(h.status(), "ready");
  assert.equal(reads(h).length, 2);
});

test("both preparation renderers refresh on auth readiness and real re-entry, not every redraw", () => {
  for (const [file, preparation] of [["online.js", "setup"], ["strategy.js", "profile"]]) {
    const code = between(read(file), "function render() {", "\nfunction ");
    const calls = [];
    const refresh = () => { calls.push("refresh"); return Promise.resolve(); };
    const app = { innerHTML: "", querySelector: () => null, focus() {}, contains: () => false };
    const context = {
      active: true, state: { screen: preparation, authReady: false }, lastRenderedScreen: "", lastRenderedAuthReady: false,
      document: { activeElement: null }, app, appRoot: app, console,
      window: { scrollTo() {}, HariaiOnline: { refreshVisibleRankingDashboard: refresh } },
      refreshVisibleRankingDashboard: refresh, isStrategyChatVisible: () => false, isDmScene: () => false,
    };
    // Stub rendering details while executing the actual production transition hook.
    for (const match of code.matchAll(/\b((?:render|sync|capture|bind|play|update|collect|reuse|restore|settle)[A-Z]\w+)/g)) context[match[1]] = () => "";
    vm.createContext(context);
    vm.runInContext(code, context);
    context.render();
    assert.equal(calls.length, 0, file);
    context.state.authReady = true;
    context.render();
    context.render();
    assert.equal(calls.length, 1, file);
    context.state.screen = file === "online.js" ? "missions" : "preDeck";
    context.render();
    context.state.screen = preparation;
    context.render();
    context.render();
    assert.equal(calls.length, 2, file);
    context.state.screen = "gameover";
    context.render();
    context.state.screen = preparation;
    context.render();
    assert.equal(calls.length, 3, file);
    context.active = false;
    context.render();
    assert.equal(calls.length, 3, file);
  }
});
