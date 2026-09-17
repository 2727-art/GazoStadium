"use strict";

// Actual local app with deterministic fixtures; all backend traffic is blocked.
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
  const errors = [];
  const blockedRequests = new Set();
  const viewportChecks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("hariai-anju-pay-unit-notice-v1", "1"));
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/*", (socket) => socket.close());
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || url.startsWith("https://www.gstatic.com/firebasejs/")) return route.continue();
      blockedRequests.add(new URL(url).hostname);
      return route.abort();
    });
    async function openPreview(preview) {
      await page.goto(`${origin}/?marketPreview=1&achievementPreview=${preview}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.HariaiOnline && window.HariaiAchievements);
      await page.locator("#achievementButton").click();
      await page.locator(".achievement-screen").waitFor();
    }
    async function captureWidths(label, locator, childSelector) {
      for (const [width, height] of [[1440, 1000], [390, 844], [320, 568]]) {
        await page.setViewportSize({ width, height });
        await locator.scrollIntoViewIfNeeded();
        const layout = await locator.evaluate((element, selector) => {
          const bounds = element.getBoundingClientRect();
          const offenders = [...element.querySelectorAll(selector)]
            .filter((child) => { const rect = child.getBoundingClientRect();
              return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || child.scrollWidth > child.clientWidth + 1; })
            .map((child) => child.className);
          return { pageOverflow: document.documentElement.scrollWidth > innerWidth, offenders };
        }, childSelector);
        assert.equal(layout.pageOverflow, false, `${label} page overflow at ${width}`);
        assert.deepEqual(layout.offenders, [], `${label} content overflow at ${width}`);
        const hiddenPreferenceText = await locator.locator('.achievement-badge[class*="achievement-preference-"] > span, .achievement-badge[class*="achievement-preference-"] small')
          .evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).display === "none").length);
        assert.equal(hiddenPreferenceText, 0, `${label} preference names/levels hidden at ${width}`);
        const screenshot = `image-preference-${label}-${width}.png`;
        await locator.screenshot({ path: path.join(output, screenshot) });
        viewportChecks.push({ surface: label, width, height, ...layout, hiddenPreferenceText, screenshot });
      }
    }
    await openPreview("image-preference");
    await page.locator("#achievementUnlockLayer.is-visible").waitFor();
    await page.locator("#achievementUnlockLayer:not(.is-visible)").waitFor({ state: "attached" });
    const category = page.locator('.achievement-category[aria-labelledby="achievementCategory-battle_preference"]');
    assert.equal(await category.locator(".achievement-family-card").count(), 2);
    assert.match(await category.innerText(), /アニメ・イラストの境地/);
    assert.match(await category.innerText(), /実写探究/);
    assert.match(await category.innerText(), /通算10000試合/);
    assert.match(await category.innerText(), /Lv\.5 \/ 10/);
    assert.match(await category.innerText(), /FINAL ACHIEVEMENT/);
    assert.match(await category.innerText(), /「どちらも歓迎」は対象外/);
    assert.match(await category.innerText(), /展示した実績だけ公開/);
    assert.equal(await category.locator('[aria-pressed="true"]').count(), 2);
    await captureWidths("collection", category, ".achievement-family-card,.achievement-family-copy,.achievement-showcase-toggle");
    await captureWidths("showcase", page.locator(".achievement-summary"), ".achievement-badge");

    // Preserve the established opt-in SECRET and SPECIAL rendering paths.
    await openPreview("loss-secret");
    assert.equal(await page.locator(".achievement-family-card.is-secret.is-unlocked").count(), 2);
    assert.equal(await page.locator(".achievement-summary .achievement-badge.is-secret").count(), 1);
    await openPreview("dollmaster");
    assert.equal(await page.locator(".achievement-family-card.is-dollmaster.is-unlocked").count(), 1);

    await page.goto(`${origin}/?marketPreview=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.HariaiOnline && window.HariaiAchievements);
    await page.evaluate(() => {
      const rows = [
        { entryId: "fixture-one", name: "アニメも実写も楽しむプレイヤー", rank: 1, rating: 100,
          serverMatches: 12345, crownTheme: "gold", crownSignatureId: "daily_champion", commentsEnabled: false,
          achievementShowcase: ["battle_preference_illustration_10000", "battle_preference_live_action_100", "battle_loss_streak_secret_200"] },
        { entryId: "fixture-two", name: "実写の境地プレイヤー", rank: 2, rating: 200,
          serverMatches: 10001, crownTheme: "aqua", crownSignatureId: "monthly_champion", commentsEnabled: false,
          achievementShowcase: ["battle_preference_live_action_10000", "battle_preference_illustration_1", "special_dollmaster"] },
      ];
      Object.assign(window.HariaiOnline, {
        getOverallLeaderboard: () => rows,
        getOverallLeaderboardStatus: () => "ready",
        refreshOverallLeaderboard: async () => rows,
        getRateFloorLeaderboard: () => rows,
        getRateFloorLeaderboardStatus: () => "ready",
        refreshRateFloorLeaderboard: async () => rows,
      });
    });
    await page.locator("#rankingButton").click();
    for (const [name, id] of [["overall", "rankingOverallBoard"], ["floor", "rankingRateFloorBoard"]]) {
      const board = page.locator(`#${id}`);
      await board.waitFor();
      assert.equal(await board.locator(".achievement-badge").count(), 6);
      assert.equal(await board.locator(".achievement-preference-illustration").count(), 2);
      assert.equal(await board.locator(".achievement-preference-live-action").count(), 2);
      assert.equal(await board.locator(".achievement-badge.is-final").count(), 2);
      assert.equal(await board.locator(".achievement-badge.is-secret").count(), 1);
      assert.equal(await board.locator(".achievement-badge.is-dollmaster").count(), 1);
      await captureWidths(name, board, ".achievement-badge,.ranking-signature");
    }
    assert.deepEqual(errors, []);
    const report = { checkedAt: new Date().toISOString(), ok: true,
      scope: "Actual local app with synthetic achievement/public-row fixtures; all backend requests and WebSockets blocked",
      checks: ["Two preference families and adopted names", "Lv.5 and Lv.10 FINAL progress/conditions", "Opt-in and post-release copy", "Selected showcase state", "SECRET/SPECIAL preview regression", "Overall and rate-floor ranking badges", "No page or badge overflow"],
      viewportChecks, blockedHosts: [...blockedRequests].sort(), pageErrors: errors };
    fs.writeFileSync(path.join(output, "IMAGE_PREFERENCE_ACHIEVEMENTS_UI_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    server.closeAllConnections(); server.close();
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
})().then(() => process.exit(0)).catch((error) => { console.error(error); server.closeAllConnections(); server.close(); process.exit(1); });
