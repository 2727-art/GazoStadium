"use strict";

// Read-only public delivery verification. Never signs in or invokes game APIs.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "hero-persona-v1";
const HTML_ASSETS = ["app.js", "velvet.css", "landing-hero.mjs"];
const MODULE_ASSETS = [{ file: "finish-roleplay.mjs", importer: "landing-hero.mjs", marker: "finish-reply-v2-girl-voice-v1" }];
const PREVIOUS = ["chat-persona-v1", "lobby-initial-snapshot-v1", "hero-image-v1", "hero-score-90-v1",
  "velvet-stage-v1", "hariai-dm-v1", "retire-market-lobby-v1", "global-player-block-v1"];
const PRIVATE = ["/functions/scripts/verify-hero-persona-release.cjs", "/functions/test/landing-hero-persona.test.js",
  "/README.md", "/database.rules.json"];

function invariant(file, body) {
  if (file === "app.js") return ['<div class="vl-hero-stage" data-landing-hero>', '<p class="vl-eyebrow">#貼り合い ・ 1on1</p>',
    'class="vl-persona-chip" data-hero-persona="${id}"', '<em class="vl-live" data-hero-live="${heroLive}">',
    "一番乗りで待ってみる", "画像はサーバーに残らない", "終わったら「名場面カード」に",
    '<b class="ha-score-number">90<small>点</small></b>っ…90点。ずるい…♡', 'id="heroSoloWaitingCount"', 'id="heroSoloPlayingCount"']
    .every((marker) => body.includes(marker));
  if (file === "velvet.css") return ['grid-template-areas: "copy" "actions" "stage";', 'grid-template-areas: "copy stage" "actions stage";',
    '.vl-live[data-hero-live="unknown"] {', '.vl-persona-chip[aria-pressed="true"] {', ".vl-meibamen {",
    ".vl-hero-thread.is-intro .chat-reaction-sticker {"].every((marker) => body.includes(marker));
  if (file === "landing-hero.mjs") return body.includes("export function heroLiveState(")
    && body.includes("let introPlayed = false;")
    && body.includes('from "./finish-roleplay.mjs?v=finish-reply-v2-girl-voice-v1"')
    && !/localStorage|sessionStorage|fetch\(/.test(body);
  return body.includes("export const ROLEPLAY_VOICE_SETS");
}

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("Response exceeds verification size limit");
    chunks.push(Buffer.from(chunk));
  }
  return { url, status: response.status, contentType: response.headers.get("content-type") || "",
    text: Buffer.concat(chunks).toString("utf8") };
}

function metadata(item, expected) {
  return { url: item.url, status: item.status, contentType: item.contentType,
    actualSha256LF: sha256LF(item.text), expectedSha256LF: expected };
}

function withNonce(url, nonce) {
  const fresh = new URL(url);
  fresh.searchParams.set("releaseCheck", String(nonce));
  return fresh.href;
}

async function checkAsset(file, urls, expected, nonce, marker = MARKER) {
  if (!urls.every((url) => url && new URL(url).searchParams.get("v")?.includes(marker))) {
    throw new Error("Missing referenced asset or marker: " + file);
  }
  const responses = await Promise.all([read(urls[0]), read(withNonce(urls[1], nonce))]);
  const mime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
  const checks = responses.map((response) => ({ ...metadata(response, expected[file]),
    ok: response.status === 200 && mime.test(response.contentType)
      && sha256LF(response.text) === expected[file] && invariant(file, response.text) }));
  return { file, responses: checks, ok: checks.every((check) => check.ok), bodies: responses.map((response) => response.text) };
}

function moduleReference(importerText, importerUrl, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = importerText.match(new RegExp(`from "(\\./${escaped}\\?v=[^"]+)"`));
  return match ? new URL(match[1], importerUrl).href : null;
}

async function main() {
  const html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expectedHtml = sha256LF(html);
  const files = [...HTML_ASSETS, ...MODULE_ASSETS.map(({ file }) => file)];
  const expected = Object.fromEntries(await Promise.all(files.map(async (file) => {
    const body = await fs.readFile(path.join(ROOT, file), "utf8");
    if (!invariant(file, body)) throw new Error("Local invariant failed: " + file);
    return [file, sha256LF(body)];
  })));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const pages = await Promise.all([read(origin + "/"), read(origin + "/?releaseCheck=" + nonce)]);
      const index = pages.map((page) => ({ ...metadata(page, expectedHtml),
        ok: page.status === 200 && /text\/html/i.test(page.contentType) && sha256LF(page.text) === expectedHtml
          && PREVIOUS.every((marker) => page.text.includes(marker)) }));
      const htmlAssets = await Promise.all(HTML_ASSETS.map((file) => checkAsset(
        file, pages.map((page) => assetReference(page.text, file, origin)), expected, nonce)));
      const moduleAssets = await Promise.all(MODULE_ASSETS.map(({ file, importer, marker }) => {
        const parent = htmlAssets.find((asset) => asset.file === importer);
        const urls = parent.responses.map((response, position) => moduleReference(parent.bodies[position], response.url, file));
        return checkAsset(file, urls, expected, nonce, marker);
      }));
      const assets = [...htmlAssets, ...moduleAssets].map(({ bodies, ...asset }) => asset);
      const excluded = await Promise.all(PRIVATE.map(async (file) => {
        const response = await read(origin + file);
        return { file, status: response.status, ok: response.status === 404 };
      }));
      return { origin, index, assets, excluded,
        ok: index.every((check) => check.ok) && assets.every((check) => check.ok) && excluded.every((check) => check.ok) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, productionDataAccessed: false,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(),
    marker: MARKER, normalization: "CRLF and CR converted to LF before SHA-256", routes,
    ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
module.exports = { invariant };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
