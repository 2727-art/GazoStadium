"use strict";

// Local fixture QA: real app and styles, deterministic public rows, no backend writes.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "functions/docs");
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
      ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("hariai-anju-pay-unit-notice-v1", "1"));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/*", (socket) => socket.close());
    await page.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(`${origin}/`) || url.startsWith("https://www.gstatic.com/firebasejs/")
        ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/?marketPreview=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.HariaiOnline && window.HariaiAchievements);
    await page.evaluate(() => {
      const final = window.HariaiAchievements.catalog.find((entry) => entry.level === 10 && !entry.secret && !entry.legacy);
      window.__floorQa = { status: "ready", rows: [
        { entryId: "fixture-one", name: "下限チャレンジ表示確認プレイヤー", rank: 1, rating: 100,
          serverMatches: 1234, crownTheme: "gold", crownSignatureId: "daily_champion",
          achievementShowcase: [final.id, "battle_loss_streak_secret_200", "special_dollmaster"] },
        { entryId: "fixture-two", name: "アクアのシグネチャー", rank: 1, rating: 100, serverMatches: 100,
          crownTheme: "aqua", crownSignatureId: "monthly_champion", achievementShowcase: [] },
        { entryId: "fixture-three", name: "装飾を設定していない参加者", rank: 3, rating: 500,
          serverMatches: 10, crownTheme: "rose", crownSignatureId: "", achievementShowcase: [] },
      ] };
      Object.assign(window.HariaiOnline, {
        getRateFloorLeaderboard: () => window.__floorQa.rows,
        getRateFloorLeaderboardStatus: () => window.__floorQa.status,
        refreshRateFloorLeaderboard: async () => window.__floorQa.rows,
      });
    });
    await page.locator("#rankingButton").click();
    const board = page.locator("#rankingRateFloorBoard");
    await board.waitFor();
    assert.equal(await board.locator(".ranking-signature").count(), 2);
    assert.equal(await board.locator(".achievement-badge").count(), 3);
    assert.deepEqual(await board.locator(".ranking-signature").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).getPropertyValue("--crown-color").trim())), ["#ffd06b", "#64e8d5"]);
    assert.equal(await board.locator(".rate-floor-entry").nth(2).locator(".ranking-signature,.achievement-badge").count(), 0);
    assert.deepEqual(await board.locator(".rate-floor-position").allTextContents(), ["FLOOR #1", "FLOOR #1", "FLOOR #3"]);
    const viewportChecks = [];
    for (const [width, height] of [[1440, 1000], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await board.scrollIntoViewIfNeeded();
      const layout = await board.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const offenders = [...element.querySelectorAll(".ranking-signature,.achievement-badge,.rate-floor-rating")]
          .filter((child) => { const rect = child.getBoundingClientRect();
            return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1; })
          .map((child) => child.className);
        return { pageOverflow: document.documentElement.scrollWidth > innerWidth, offenders };
      });
      assert.equal(layout.pageOverflow, false, `page overflow at ${width}`);
      assert.deepEqual(layout.offenders, [], `badge overflow at ${width}`);
      const screenshot = `rate-floor-showcase-${width}.png`;
      await board.screenshot({ path: path.join(output, screenshot) });
      viewportChecks.push({ width, height, ...layout, screenshot });
    }
    await page.evaluate(() => { window.__floorQa.rows = []; window.dispatchEvent(new Event("hariai-leaderboard-updated")); });
    assert.match(await board.innerText(), /公開参加者はまだいません/);
    await page.evaluate(() => { window.__floorQa.status = "error"; window.dispatchEvent(new Event("hariai-leaderboard-updated")); });
    assert.equal(await page.locator("#rateFloorRankingRetryButton").count(), 1);
    assert.deepEqual(errors, []);
    const report = { checkedAt: new Date().toISOString(), scope: "Local actual app with synthetic public-row fixtures; all backend requests blocked",
      checks: ["SIGNATURE themes", "FINAL/SECRET/SPECIAL badges", "unset decorations", "tied ranks", "empty and retry states"],
      viewportChecks, pageErrors: errors, ok: true };
    fs.writeFileSync(path.join(output, "RATE_FLOOR_SHOWCASE_UI_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    server.closeAllConnections(); server.close();
    // Some Windows browser drivers leave close() pending after the browser exits.
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
})().then(() => process.exit(0)).catch((error) => { console.error(error); server.closeAllConnections(); server.close(); process.exit(1); });
