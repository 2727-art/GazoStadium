"use strict";

// Read-only public delivery verification. Never signs in or invokes game APIs.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "retire-market-lobby-v1";
const ASSETS = ["app.js", "online.js", "styles.css"];
const PREVIOUS = ["retire-flea-danwaku-v1", "retire-training-lights-v1", "lobby-manual-refresh-v1",
  "global-player-block-v1", "solo-match-cost-guard-v1", "strategy-idle-guard-v1",
  "tribute-cost-guard-v1", "tribute-ranch-v1", "desktop-align-v1"];
const PRIVATE = ["/functions/index.js", "/functions/scripts/verify-market-lobby-retirement-release.cjs",
  "/functions/test/training-lights-landing-retirement.test.js", "/README.md"];

function invariant(file, body) {
  if (file === "app.js") return !/lobbyMarket|lobbyStats\.market|class="lobby-mode-card market"|market-counts|売り手待機|買い手待機/.test(body)
    && ["lobbySoloWaitingCount", "lobbyStrategyWaitingCount", "lobbyFreeTableWelcomingCount",
      "lobbyStatsRefreshButton", "valueMarketRankingButton"].every((id) => body.includes('id="' + id + '"'))
    && body.includes("旧推し値市場の記録");
  if (file === "online.js") return !/publicMarketPresence|market-presence\.mjs|summarizeMarketPresence|marketPresenceEntries|lobbyStats\.market|lobbyMarket/.test(body)
    && body.includes('get(ref(database, "online/publicPresence"))')
    && body.includes("loadFreeTablePublicStatsSnapshot()")
    && body.includes("const [presenceResult, freeTableResult] = results;");
  return !/\.lobby-mode-card\.market|\.lobby-mode-counts\.market-counts/.test(body)
    && body.includes(".lobby-mode-card.free-table-status") && body.includes(".lobby-stats-refresh");
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

async function main() {
  const html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expectedHtml = sha256LF(html);
  const expected = Object.fromEntries(await Promise.all(ASSETS.map(async (file) => {
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
      const assets = await Promise.all(ASSETS.map(async (file) => {
        const urls = pages.map((page) => assetReference(page.text, file, origin));
        if (!urls.every((url) => url && new URL(url).searchParams.get("v")?.includes(MARKER))) {
          throw new Error("Missing referenced asset or marker: " + file);
        }
        const fresh = new URL(urls[1]);
        fresh.searchParams.set("releaseCheck", String(nonce));
        const responses = await Promise.all([read(urls[0]), read(fresh.href)]);
        const mime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
        const checks = responses.map((response) => ({ ...metadata(response, expected[file]),
          ok: response.status === 200 && mime.test(response.contentType)
            && sha256LF(response.text) === expected[file] && invariant(file, response.text) }));
        return { file, responses: checks, ok: checks.every((check) => check.ok) };
      }));
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
    marker: MARKER, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
module.exports = { invariant };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
