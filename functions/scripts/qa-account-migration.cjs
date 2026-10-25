"use strict";
// Static browser QA on intercepted origins. Only Firebase SDK assets may use
// the network; all backend calls are blocked and the wallet uses local preview.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, ".firebase/account-migration");
const hosts = ["gazostadium.anjugames.workers.dev", "gazostadium.web.app", "gazostadium.firebaseapp.com", "hariaistadium.com"];
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const checks = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    context.setDefaultTimeout(20000);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname === "www.gstatic.com") return route.continue();
      if (!hosts.includes(url.hostname)) return route.abort();
      const relative = decodeURIComponent(url.pathname).replace(/^\//, "") + (url.pathname.endsWith("/") ? "index.html" : "");
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: "Not found" });
      let body = fs.readFileSync(file);
      if (["/firebase-services.js", "/firebase-app-check.js"].includes(url.pathname)) {
        // Preview is normally localhost-only. Enable it only in these intercepted
        // responses so hostname-specific banners can be tested without a backend.
        body = Buffer.from(body.toString().replace('const isLocalhost = ["127.0.0.1", "localhost"].includes(location.hostname);', 'const isLocalhost = true;'));
      }
      return route.fulfill({ contentType: types[path.extname(file)] || "application/octet-stream", body });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const host of hosts.slice(0, 3)) {
      await page.goto(`https://${host}/?marketPreview=1`);
      await page.waitForSelector(".domain-move");
      assert.match(await page.locator(".domain-move").innerText(), /ログイン状態は自動では引き継がれません/);
      assert.equal(new URL(page.url()).hostname, host);
    }
    checks.push("all legacy origins show guidance without automatically redirecting");
    await page.goto(`https://${hosts[0]}/?marketPreview=1`);
    await page.locator("[data-domain-wallet]").waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-domain-wallet]")?.disabled);
    await page.locator(".domain-move").screenshot({ path: path.join(output, "banner-mobile.png"), animations: "disabled" });
    assert.ok(await page.locator(".domain-move").evaluate(e => e.getBoundingClientRect().left >= 0 && e.getBoundingClientRect().right <= innerWidth));
    await page.click("[data-domain-wallet]");
    await page.waitForSelector(".account-wallet").catch(async error => {
      console.log(JSON.stringify({ errors, text: (await page.locator("body").innerText()).slice(0, 1800) }));
      await page.screenshot({ path: path.join(output, "guide-failure.png"), animations: "disabled" });
      throw error;
    });
    assert.equal(new URL(page.url()).hostname, hosts[0]);
    checks.push("legacy wallet opens in place on mobile");
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.locator(".domain-move").screenshot({ path: path.join(output, "banner-desktop.png"), animations: "disabled" });
    await page.click(".domain-move-close");
    await page.reload();
    assert.equal(await page.locator(".domain-move").count(), 0);
    checks.push("closing the notice persists only for the current tab session");
    await page.goto("https://hariaistadium.com/?marketPreview=1&account=1");
    await page.waitForSelector(".account-wallet");
    assert.equal(await page.locator(".domain-move").count(), 0);
    assert.equal(new URL(page.url()).searchParams.has("account"), false);
    checks.push("new domain has no migration banner and explicit wallet links open correctly");
    await page.goto("https://hariaistadium.com/account-guide/");
    assert.match(await page.locator("main").innerText(), /サイトデータやCookieは削除しない/);
    assert.equal(await page.locator('a[href="https://hariaistadium.com/?account=1"]').count(), 1);
    assert.equal(await page.locator('a[target="_blank"]:not([rel="noopener"])').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, "guide-mobile.png"), animations: "disabled" });
    checks.push("guide explains both methods, preserves the old tab and fits mobile width");
    assert.deepEqual(errors, []);
    const report = { ok: true, checks, errors, scope: "Intercepted static origins and local wallet preview only" };
    fs.writeFileSync(path.join(output, "browser-guide.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
