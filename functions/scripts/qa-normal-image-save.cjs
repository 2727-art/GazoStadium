"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "tmp/mobile-image-save-qa");
const sourceOrigin = process.argv.includes("--production") ? "https://hariaistadium.com" : null;
fs.mkdirSync(output, { recursive: true });
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
  try {
    if (sourceOrigin) {
      // Preview uses only the deployed static assets. Browser backend traffic remains blocked below.
      const upstream = await fetch(new URL(request.url, sourceOrigin), { signal: AbortSignal.timeout(20000) });
      return response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream" })
        .end(Buffer.from(await upstream.arrayBuffer()));
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", acceptDownloads: true });
    await context.routeWebSocket("**/*", socket => socket.close());
    await context.route("**/*", route => {
      const url = route.request().url();
      return url.startsWith(origin + "/") || url.startsWith("https://www.gstatic.com/firebasejs/") || url.startsWith("https://fonts.googleapis.com/") || url.startsWith("https://fonts.gstatic.com/") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("hariai-anju-pay-unit-notice-v1", "1"));
    await page.goto(`${origin}/?battlePreview`, { waitUntil: "networkidle" });
    // The local-only preview toolbar sits above all screens; hide it while viewing the actual lightbox.
    await page.addStyleTag({ content: "body:has(.vb-lightbox) #battlePreviewBar { visibility: hidden; }" });
    await page.locator("#onlineButton").click();
    await page.waitForFunction(() => window.HariaiOnline).catch(async error => {
      console.error(JSON.stringify({ errors, text: (await page.locator("body").innerText()).slice(-1400) }));
      throw error;
    });
    await page.locator('[data-preview-step="gaze:score"]').click();
    const gazeImage = page.locator("[data-gaze-image]");
    assert.equal(await gazeImage.evaluate(image => image.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))), true);
    const gazeSource = await gazeImage.getAttribute("src");
    const gazeBytes = await page.evaluate(async src => Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer())), gazeSource);
    for (const clean of [false, true]) {
      if (clean) await page.locator(".vb-gaze-head [data-gaze-chrome]").click();
      const button = page.locator(clean ? ".vb-gaze-restore [data-gaze-save]" : ".vb-gaze-head [data-gaze-save]");
      const [file] = await Promise.all([page.waitForEvent("download"), button.click()]);
      const destination = path.join(output, clean ? "gaze-clean.jpg" : "gaze-score.jpg");
      await file.saveAs(destination);
      assert.equal(digest(fs.readFileSync(destination)), digest(Buffer.from(gazeBytes)));
      assert.equal(await page.locator("[data-gaze]").count(), 1);
      await page.screenshot({ path: path.join(output, clean ? "gaze-clean.png" : "gaze-score.png") });
    }
    results.push("current opponent image: normal and image-only gaze views save exact bytes without changing view or score");
    await page.locator('.vb-gaze-restore [data-gaze-chrome]').click();
    await page.locator('[data-preview-step="gaze:past"]').click();
    const pastBytes = await gazeImage.evaluate(async image => Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())));
    const [pastDownload] = await Promise.all([page.waitForEvent("download"), page.locator(".vb-gaze-head [data-gaze-save]").click()]);
    await pastDownload.saveAs(path.join(output, "gaze-past.jpg"));
    assert.equal(digest(fs.readFileSync(path.join(output, "gaze-past.jpg"))), digest(Buffer.from(pastBytes)));
    assert.notEqual(digest(Buffer.from(pastBytes)), digest(Buffer.from(gazeBytes)));
    results.push("previous-round gaze view saves the displayed round's image, not the current round's image");
    await page.locator('[data-preview-step="result:local"]').click();
    const card = page.locator(".vb-dm-item.is-remote-post .vb-dm-photo img").last();
    assert.equal(await card.evaluate(image => image.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))), true, "battle image does not cancel the context menu");
    const source = await card.getAttribute("src");
    const sourceBytes = await page.evaluate(async src => Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer())), source);
    await page.evaluate(src => window.HariaiBattleFx.openLightbox(src, "相手の画像"), source);
    await page.waitForFunction(() => document.querySelector(".vb-lightbox-save")?.disabled === false);
    assert.equal(await page.locator(".vb-lightbox img").evaluate(image => image.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))), true, "enlarged image does not cancel the context menu");
    await page.locator(".vb-lightbox img").click();
    assert.equal(await page.locator(".vb-lightbox").count(), 1, "touching the image does not dismiss the viewer");
    await page.locator(".vb-lightbox").screenshot({ path: path.join(output, "mobile-portrait.png") });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".vb-lightbox-save").click()]);
    assert.equal(download.suggestedFilename(), "hariai-image.jpg");
    assert.equal(await page.locator(".vb-lightbox").count(), 1, "saving does not close the viewer");
    await page.locator(".vb-lightbox-close").click();
    await download.saveAs(path.join(output, download.suggestedFilename()));
    assert.equal(digest(fs.readFileSync(path.join(output, download.suggestedFilename()))), digest(Buffer.from(sourceBytes)), "download bytes match the displayed opponent image even if the viewer is closed immediately");
    results.push("375px touch viewport: context menus allowed, save and close work, downloaded JPEG matches the opponent image byte for byte");

    for (const [label, width, height, landscape] of [["small-portrait", 320, 568, false], ["mobile-landscape", 812, 375, true], ["desktop", 1280, 900, false]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(src => window.HariaiBattleFx.openLightbox(src, "相手の画像"), source);
      await page.waitForFunction(() => document.querySelector(".vb-lightbox-save")?.disabled === false);
      const bounds = await page.locator(".vb-lightbox-actions").boundingBox();
      const imageBounds = await page.locator(".vb-lightbox img").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      assert.ok(imageBounds.y >= bounds.y + bounds.height && imageBounds.y + imageBounds.height <= height, "controls do not overlap the image");
      await page.locator(".vb-lightbox").screenshot({ path: path.join(output, `${label}.png`) });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(".vb-lightbox").count(), 0);
      await page.locator('[data-preview-step="gaze:score"]').click();
      if (landscape) await page.locator("[data-preview-orientation]").click();
      const saveBounds = await page.locator(".vb-gaze-head [data-gaze-save]").boundingBox();
      assert.ok(saveBounds.x >= 0 && saveBounds.x + saveBounds.width <= width && saveBounds.height >= 44);
      await page.screenshot({ path: path.join(output, `gaze-${label}.png`) });
      if (landscape) await page.locator("[data-preview-orientation]").click();
      results.push(`${width}x${height}: image and controls fit; Escape closes the viewer`);
    }

    for (const [mime, extension] of [["image/png", "png"], ["image/webp", "webp"]]) {
      const original = await page.evaluate(async mime => {
        const canvas = document.createElement("canvas");
        canvas.width = 200; canvas.height = 120;
        const drawing = canvas.getContext("2d");
        drawing.fillStyle = "#e68ab6"; drawing.fillRect(0, 0, 200, 120);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime));
        const url = URL.createObjectURL(blob);
        window.HariaiBattleFx.openLightbox(url, "保存検証画像");
        return { url, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      }, mime);
      await page.waitForFunction(() => document.querySelector(".vb-lightbox-save")?.disabled === false);
      // Simulate the round ending and releasing its original URL while the image is open.
      await page.evaluate(url => URL.revokeObjectURL(url), original.url);
      const [file] = await Promise.all([page.waitForEvent("download"), page.locator(".vb-lightbox-save").click()]);
      assert.equal(file.suggestedFilename(), `hariai-image.${extension}`);
      await file.saveAs(path.join(output, file.suggestedFilename()));
      assert.equal(digest(fs.readFileSync(path.join(output, file.suggestedFilename()))), digest(Buffer.from(original.bytes)));
      await page.locator(".vb-lightbox-close").click();
      results.push(`${mime}: correct filename and unmodified bytes after original URL release`);
    }
    await page.evaluate(() => {
      const url = URL.createObjectURL(new Blob(["unavailable"], { type: "image/png" }));
      URL.revokeObjectURL(url);
      window.HariaiBattleFx.openLightbox(url, "読み込み失敗の検証");
    });
    await page.waitForFunction(() => document.querySelector(".vb-lightbox small")?.textContent.includes("保存の準備ができませんでした"));
    assert.equal(await page.locator(".vb-lightbox-save").isDisabled(), true);
    await page.locator(".vb-lightbox-close").click();
    results.push("unavailable image: save stays disabled with a readable fallback message; close remains usable");
    assert.deepEqual(errors, [], "no unhandled browser errors");
    fs.writeFileSync(path.join(output, sourceOrigin ? "production-results.json" : "results.json"), JSON.stringify({ sourceOrigin, results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } catch (error) {
    console.error("Browser QA failed:", error.message);
    throw error;
  } finally {
    server.closeAllConnections();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
