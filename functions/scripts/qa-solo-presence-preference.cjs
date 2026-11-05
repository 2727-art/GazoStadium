"use strict";
// Real client UI with a synthetic presence response. No production backend access.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../..");
const out = path.join(root, ".firebase/presence-preference");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  try {
    const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
      const errors = [];
      const backend = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket("**/*", socket => { backend.push("websocket"); socket.close(); });
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          if (/identitytoolkit|securetoken|cloudfunctions|firestore|firebasedatabase|firebaseio|run\.app/.test(url.hostname)) backend.push(url.hostname);
          return route.abort();
        }
        if (url.pathname === "/landing-presence.mjs") {
          const source = fs.readFileSync(path.join(root, "landing-presence.mjs"), "utf8")
            .replace(/^import \{ get, ref \} from .*;$/m, "const ref = (_db, p) => p; const get = window.__presenceGet;")
            .replace(/^const preview = .*;$/m, "const preview = false;");
          return route.fulfill({ contentType: "text/javascript", body: source });
        }
        if (url.pathname === "/online.js") {
          const source = fs.readFileSync(path.join(root, "online.js"), "utf8") + `\nwindow.__presencePanelQA = (mode, phase, entries) => {
            Object.assign(battlePresenceChecks[mode], summarizeBattlePresence(entries, {mode, now: Date.now(), freshMs: 45000, ownPresenceId: 'own'}), {checkedAt: Date.now()});
            document.querySelector('#app').innerHTML = '<section class="screen">' + renderBattlePresenceCheck({mode,phase}) + '</section>';
          };`;
          return route.fulfill({ contentType: "text/javascript", body: source });
        }
        return route.continue();
      });
      await page.addInitScript(() => {
        const now = Date.now();
        const row = (pref, extra = {}) => ({ mode: "solo", state: "waiting", lastSeen: now, ...(pref ? { pref } : {}), ...extra });
        window.__presenceRows = { own: row("i"), anime: row("i"), photo: row("l"), both: row("b"), old: row(),
          expired: row("l", { lastSeen: now - 60000 }), playing: row(null, { state: "playing" }), strategy: row(null, { mode: "strategy" }) };
        window.__presenceReads = [];
        window.__presenceGet = async p => { window.__presenceReads.push(p); return { val: () => p.startsWith(".info") ? 0 : window.__presenceRows }; };
        localStorage.setItem("hariai-anju-pay-unit-notice-v1", "1");
      });
      await page.goto(origin + "/?marketPreview=1", { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.HariaiLobby?.getStats().solo.waiting === 5);
      const top = await page.locator("[data-solo-waiting-breakdown]").allTextContents();
      assert.equal(top.length, 2);
      for (const text of top) for (const expected of ["アニメ・イラスト 2人", "実写 1人", "どちらも歓迎 1人", "未分類 1人"]) assert.ok(text.includes(expected), text);
      await page.screenshot({ path: path.join(out, `landing-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() => {
        const scroll = document.documentElement.scrollWidth;
        const nodes = [...document.querySelectorAll("[data-solo-waiting-breakdown]")];
        const outside = nodes.some(e => { const r=e.getBoundingClientRect(); return r.right > innerWidth || r.left < 0; });
        const locations = nodes.map(e => ({ e, parent: e.parentNode, next: e.nextSibling }));
        nodes.forEach(e => e.remove());
        const baselineScroll = document.documentElement.scrollWidth;
        locations.forEach(({ e, parent, next }) => parent.insertBefore(e, next));
        return { scroll, baselineScroll, outside };
      });
      assert.equal(overflow.outside, false, "all added counts fit the viewport");
      assert.ok(overflow.scroll <= overflow.baselineScroll, `new landing overflow ${JSON.stringify(overflow)}`);
      await page.click("#onlineButton");
      await page.waitForFunction(() => typeof window.__presencePanelQA === "function");
      for (const phase of ["setup", "matching"]) {
        await page.evaluate(phase => window.__presencePanelQA("solo", phase, window.__presenceRows), phase);
        const panel = page.locator("[data-battle-presence-panel]");
        assert.equal(await panel.locator("[data-battle-presence-waiting]").textContent(), phase === "matching" ? "4" : "5");
        assert.equal(await panel.locator('[data-solo-waiting-pref="illustration"] b').textContent(), phase === "matching" ? "1" : "2");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `panel overflow ${width}`);
        await panel.screenshot({ path: path.join(out, `${phase}-${width}.png`) });
      }
      await page.evaluate(() => window.__presencePanelQA("strategy", "setup", window.__presenceRows));
      assert.equal(await page.locator("[data-solo-waiting-breakdown]").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__presenceReads), [".info/serverTimeOffset", "online/publicPresence"]);
      assert.deepEqual(errors, []);
      assert.deepEqual(backend, []);
      results.push({ width, landing: true, setup: true, matching: true, ownExcluded: true, strategyUnchanged: true, presenceReads: 1, backendRequests: 0, overflow });
      await page.close();
    }
    const report = { ok: true, syntheticPresence: true, productionDataAccessed: false, results };
    fs.writeFileSync(path.join(out, "browser-qa.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => server.close());
