"use strict";

// Real local app, synthetic period results, and all backend traffic blocked.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "tmp/period-rankings-qa");
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  try {
    const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
      ".png": "image/png", ".webp": "image/webp" }[path.extname(file)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors = [];
    const failedRequests = [];
    const consoleErrors = [];
    const responseErrors = [];
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) responseErrors.push({ url: response.url(), status: response.status() }); });
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.routeWebSocket("**/*", (socket) => socket.close());
    await page.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(`${origin}/`) || url.startsWith("https://www.gstatic.com/firebasejs/")
        ? route.continue() : route.abort();
    });
    await page.addInitScript(() => {
      localStorage.setItem("hariai-anju-pay-unit-notice-v1", "1");
      localStorage.setItem("hariai-stadium-ranking-public-v1", "1");
      window.__rankingLoadEvents = 0;
      window.addEventListener("hariai-ranking-dashboard-updated", () => { window.__rankingLoadEvents += 1; });
    });
    await page.clock.install({ time: new Date("2026-11-04T14:59:55Z") });
    await page.goto(`${origin}/?marketPreview=1`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.HariaiFeatures.load("online"));
    await page.waitForFunction(() => window.HariaiOnline && window.HariaiAchievements).catch(async (error) => {
      console.error(JSON.stringify({ errors, failedRequests, consoleErrors, responseErrors,
        globals: await page.evaluate(() => Object.keys(window).filter((key) => key.startsWith("Hariai"))), title: await page.title() }, null, 2));
      throw error;
    });
    assert.equal(await page.evaluate(() => window.HariaiOnline.getOverallRankingPreference().enabled), true);
    await page.clock.fastForward(15_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(await page.evaluate(() => window.__rankingLoadEvents), 0, "top page never starts dashboard refresh on midnight or tab return");
    const topPageDashboardLoads = await page.evaluate(() => window.__rankingLoadEvents);
    await page.evaluate(() => {
      if (window.HariaiOnline.refreshOverallLeaderboard || window.HariaiOnline.refreshRateFloorLeaderboard || window.HariaiOnline.setCrownCustomization) {
        throw new Error("Retired public board API still exported");
      }
      const periodInfo = window.HariaiOnline.getLeaderboardPeriodInfo("daily");
      const dashboard = {
        enabled: true, entryId: "fixture-own", overall: { rating: 1350 },
        run: { key: periodInfo.key, status: "active", matchCount: 1, crownPower: 1380, ratingAtStart: 1350,
          uniqueOpponents: 1, modeMatches: { solo: 1, strategy: 0 }, signatureIds: ["upset"], endsAt: periodInfo.nextResetAt },
        rules: { dailyKey: periodInfo.key },
      };
      const state = { period: "weekly", status: "ready", reads: [], dashboardRequests: [] };
      window.__periodRankingQA = state;
      Object.assign(window.HariaiOnline, {
        getLeaderboard: () => state.status === "ready" ? [{ entryId: "fixture-entry", name: "期間ランキングの参加者",
          displayRank: 1, qualified: true, rating: 1350, crownPower: 1380, circuitScore: 150, matchCount: 3,
          qualifyingCount: 3, wins: 2, losses: 0, draws: 1, modeMatches: { solo: 2, strategy: 1 },
          crownTheme: "gold", crownSignatureId: "daily_champion", achievementShowcase: [], commentsEnabled: false }] : [],
        getLeaderboardStatus: () => state.status,
        refreshLeaderboard: async (period) => { state.reads.push(period); state.period = period;
          window.dispatchEvent(new Event("hariai-leaderboard-updated")); },
        getRankingDashboard: () => dashboard,
        getRankingDashboardStatus: () => ({ status: "ready", busy: false }),
        refreshRankingDashboard: async (options) => { state.dashboardRequests.push(options); return dashboard; },
        getCrownMonthlyOpeningStatus: () => ({ pending: false, progressStatus: "ready" }),
        getMonthlyBeyondLoadState: () => ({ ready: true }),
        getServerRankingAwards: () => ({ ready: false, awards: [] }), getMonthlyRankingHallOfFame: () => [],
      });
    });
    await page.locator("#rankingButton").click();
    await page.locator(".ranking-screen").waitFor({ timeout: 10000 }).catch(async (error) => {
      console.error(JSON.stringify({ errors, consoleErrors, text: (await page.locator("#app").innerText()).slice(0, 1000) }, null, 2));
      throw error;
    });
    assert.deepEqual(await page.locator("[data-ranking-jump]").evaluateAll((nodes) => nodes.map((node) => node.dataset.rankingJump)), ["daily", "weekly", "monthly"]);
    assert.equal(await page.locator("#rankingOverallBoard, #rankingRateFloorBoard, .ranking-neighbor-list, .rating-class-badge").count(), 0);
    assert.doesNotMatch(await page.locator(".ranking-screen").innerText(), /あなたの現在地|総合RATEランキング|下限チャレンジ|総合RATEクラス/);
    assert.equal(await page.locator("#crownRunSoloButton").count(), 1);
    assert.equal(await page.locator("#crownRunStrategyButton").count(), 1);
    assert.equal(await page.locator(".crown-customization, #crownCustomizationSave, #crownThemeSelect, #crownSignatureSelect").count(), 0);
    assert.doesNotMatch(await page.locator(".ranking-screen").innerText(), /CROWN CUSTOMIZATION|王座の見せ方/);
    assert.match(await page.locator(".crown-proof-signatures").innerText(), /番狂わせ/);
    const viewports = [];
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      for (const period of ["daily", "weekly", "monthly"]) {
        await page.locator(`[data-ranking-period="${period}"]`).click();
        assert.equal(await page.locator(`[data-ranking-period="${period}"]`).getAttribute("aria-selected"), "true");
        assert.equal(await page.locator(".crown-ranking-entry").count(), 1);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `horizontal overflow at ${width}`);
      const screenshot = path.join(output, `ranking-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      viewports.push({ width, height, overflow, screenshot });
    }
    await page.evaluate(() => { window.__periodRankingQA.status = "error"; window.dispatchEvent(new Event("hariai-leaderboard-updated")); });
    assert.equal(await page.locator("#rankingRetryButton").count(), 1);
    await page.evaluate(() => { window.__periodRankingQA.status = "ready"; window.HariaiOnline.getLeaderboard = () => [];
      window.dispatchEvent(new Event("hariai-leaderboard-updated")); });
    assert.equal(await page.locator(".crown-ranking-entry").count(), 0);
    assert.equal(await page.locator(".ranking-empty").count() > 0, true);
    const calls = await page.evaluate(() => window.__periodRankingQA);
    assert.deepEqual(calls.dashboardRequests, [{ includePresentation: true }]);
    assert.deepEqual(errors, []);
    const report = { ok: true, checkedAt: new Date().toISOString(), scope: "Local actual app, synthetic ranking rows; backend traffic blocked",
      viewports, topPageDashboardLoads, periodRequests: calls.reads, dashboardRequests: calls.dashboardRequests, pageErrors: errors };
    fs.writeFileSync(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    server.closeAllConnections(); server.close();
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
})().then(() => process.exit(0)).catch((error) => { console.error(error); server.closeAllConnections(); server.close(); process.exit(1); });
