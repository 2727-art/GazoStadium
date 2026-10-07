"use strict";

// Read-only checks of all independently served origins. Run after deployment.
// Does not sign in, invoke a callable, or inspect/change production game data.
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "retire-flea-danwaku-v1";
const FILES = ["app.js", "achievements.js", "velvet.css"];
const PREVIOUS_MARKERS = [
  "global-player-block-v1", "retire-training-v1", "retire-training-lights-v1",
  "strategy-idle-guard-v1", "solo-match-cost-guard-v1", "tribute-cost-guard-v1",
  "tribute-ranch-v1", "desktop-align-v1",
];
const PRIVATE_PATHS = [
  "/functions/index.js",
  "/functions/retired-community-modes.js",
  "/functions/test/flea-danwaku-retirement-client.test.js",
  "/functions/test/retired-community-modes-runtime.test.js",
  "/functions/scripts/audit-community-retirement.cjs",
  "/functions/scripts/verify-community-retirement-release.cjs",
  "/README.md",
];

async function read(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw new Error("Response exceeds verification size limit: " + url);
    chunks.push(Buffer.from(chunk));
  }
  return { url, status: response.status, contentType: response.headers.get("content-type") || "",
    body: Buffer.concat(chunks).toString("utf8") };
}

function retiredLoadsAbsent(html, origin) {
  // Parse actual src/href paths: historical cache markers may still mention modes.
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const url = new URL(match[1].replace(/&amp;/g, "&"), origin + "/");
    if (/\/(?:flea-market|danwaku-note)\.(?:js|css)$/.test(url.pathname)) return false;
  }
  return true;
}

function achievementHistoryCheck(body) {
  const context = vm.createContext({ window: { addEventListener() {} } });
  vm.runInContext(body, context, { timeout: 1_000 });
  const api = context.window.HariaiAchievements;
  const retired = api.catalog.filter((definition) => ["flea", "danwaku"].includes(definition.scope));
  if (retired.length !== 40 || !retired.every((definition) => definition.legacy && definition.autoPublic === false)) return false;
  for (const family of ["flea_listings", "flea_sales", "flea_purchases", "danwaku_streak"]) {
    if (retired.filter((definition) => definition.id.startsWith(family + "_")).length !== 10) return false;
  }
  const ids = ["flea_listings_1", "flea_sales_1000", "danwaku_streak_365"];
  if (!ids.every((id) => api.byId.has(id))) return false;
  const profile = { unlocked: Object.fromEntries(ids.map((id) => [id, 123])), customShowcase: ids, showcase: ids };
  const normalized = api.normalizeProfile(profile);
  if (!ids.every((id) => normalized.customShowcase.includes(id))) return false;
  const collection = api.renderCollection(profile);
  return ids.every((id) => collection.includes(`data-achievement-showcase="${id}"`))
    && !/id="achievementCategory-(?:danwaku_note|flea_listing|flea_connections)"/.test(api.renderCollection({}))
    && api.catalog.filter((definition) => ["ai_training", "roulette_training", "tribute"].includes(definition.scope))
      .every((definition) => !definition.legacy);
}

function retiredFeatureCheck(file, body) {
  if (file === "app.js") return !/function start(?:FleaMarket|DanwakuNote)|renderLandingFleaPanel|pendingFleaMarketDestination|fleaMarketReadyListenerPending|hariai-(?:flea-market|danwaku-note)-ready|id="(?:fleaMarket[^"\s]*|danwakuNote[^"\s]*)"/.test(body)
    && ["accountButton", "achievementButton", "aiTextTrainingButton", "rouletteTrainingButton", "tributeButton", "freeTableButton"]
      .every((id) => body.includes(`id="${id}"`))
    && /function renderLandingTopMessagePanel\(/.test(body);
  if (file === "achievements.js") return achievementHistoryCheck(body);
  if (file === "velvet.css") return /\.vl-others-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s.test(body)
    && !/\.hero\.vl-landing > \.landing-flea/.test(body);
  return false;
}

function metadata(item, expectedHash) {
  return { url: item.url, status: item.status, contentType: item.contentType,
    sha256LF: sha256LF(item.body), expectedSha256LF: expectedHash };
}

async function main() {
  const localHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expectedHtml = sha256LF(localHtml);
  const expected = new Map(await Promise.all(FILES.map(async (file) => {
    const body = await fs.readFile(path.join(ROOT, file), "utf8");
    if (!retiredFeatureCheck(file, body)) throw new Error("Local retirement invariant failed: " + file);
    return [file, sha256LF(body)];
  })));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const htmlResponses = await Promise.all([read(origin + "/"), read(origin + "/?releaseCheck=" + nonce)]);
      const index = htmlResponses.map((item) => ({ ...metadata(item, expectedHtml),
        retiredLoadsAbsent: retiredLoadsAbsent(item.body, origin),
        previousMarkersPreserved: PREVIOUS_MARKERS.every((marker) => item.body.includes(marker)),
        ok: item.status === 200 && /text\/html/i.test(item.contentType) && sha256LF(item.body) === expectedHtml
          && retiredLoadsAbsent(item.body, origin) && PREVIOUS_MARKERS.every((marker) => item.body.includes(marker)),
      }));
      const assets = await Promise.all(FILES.map(async (file) => {
        const references = htmlResponses.map((item) => assetReference(item.body, file, origin));
        if (!references.every((url) => url && new URL(url).searchParams.get("v")?.includes(MARKER))) {
          throw new Error("Missing HTML asset reference or release marker: " + file);
        }
        // Fetch what each HTML response actually references, not invented URLs.
        const freshUrl = new URL(references[1]);
        freshUrl.searchParams.set("releaseCheck", String(nonce));
        const fetched = await Promise.all([read(references[0]), read(freshUrl.href)]);
        const expectedMime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
        const responses = fetched.map((item) => {
          const contentOk = item.status === 200 && expectedMime.test(item.contentType) && sha256LF(item.body) === expected.get(file);
          // Only evaluate achievement code once its hash matches trusted local source.
          const behaviorOk = contentOk && retiredFeatureCheck(file, item.body);
          return { ...metadata(item, expected.get(file)), contentOk, behaviorOk, ok: contentOk && behaviorOk };
        });
        return { file, references, responses, ok: responses.every((item) => item.ok) };
      }));
      const excluded = await Promise.all(PRIVATE_PATHS.map(async (file) => {
        const response = await read(origin + file);
        return { file, status: response.status, ok: response.status === 404 };
      }));
      return { origin, index, assets, excluded,
        ok: index.every((item) => item.ok) && assets.every((item) => item.ok) && excluded.every((item) => item.ok) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER,
    productionDataAccessed: false, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

module.exports = { retiredLoadsAbsent, retiredFeatureCheck, achievementHistoryCheck };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
