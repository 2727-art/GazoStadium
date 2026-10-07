"use strict";

// Read-only checks of each independently served public origin. Never signs in.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "retire-training-lights-v1";
const FILES = ["app.js", "online.js", "ai-text-training.js", "styles.css", "velvet.css", "ai-text-training.css"];

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "",
    body: await response.text() };
}

function retiredFeatureCheck(file, body) {
  if (file === "app.js") return !/aiTextTrainingLights|renderAiTextTrainingLights|文字コラジムの灯り/.test(body)
    && /id="aiTextTrainingButton"/.test(body) && /id="lobbyStatsRefreshButton"/.test(body);
  if (file === "online.js") return !/aiTextTrainingPublicStats|loadAiTextTrainingPublicStatsSnapshot|hariai-ai-text-training-public-stats-updated/.test(body)
    && /loadFreeTablePublicStatsSnapshot/.test(body) && /online\/publicPresence/.test(body);
  if (file === "ai-text-training.js") return !/heartbeat_achievement_session|AI_TEXT_TRAINING_LIGHT_HEARTBEAT_MS|TRAINING LIGHTS/.test(body)
    && ["begin_achievement_session", "finish_achievement_session", "close_achievement_presence"].every((action) => body.includes(action));
  return !/\.training-lights-card|\.ai-text-training-companion|\.ai-text-training-light-result/.test(body);
}

async function main() {
  const expectedHtml = sha256LF(await fs.readFile(path.join(ROOT, "index.html"), "utf8"));
  const expected = new Map(await Promise.all(FILES.map(async (file) => [file, sha256LF(await fs.readFile(path.join(ROOT, file), "utf8"))])));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const [html, freshHtml] = await Promise.all([read(origin + "/"), read(origin + "/?releaseCheck=" + nonce)]);
      const indexOk = [html, freshHtml].every((item) => item.status === 200
        && /text\/html/i.test(item.contentType) && sha256LF(item.body) === expectedHtml);
      const assets = await Promise.all(FILES.map(async (file) => {
        const url = assetReference(html.body, file, origin);
        if (!url?.includes(MARKER)) throw new Error("Missing release marker: " + file);
        const freshUrl = new URL(url);
        freshUrl.searchParams.set("releaseCheck", String(nonce));
        const fetched = await Promise.all([read(url), read(freshUrl.href)]);
        const expectedMime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
        const contentOk = fetched.every((item) => item.status === 200 && expectedMime.test(item.contentType)
          && sha256LF(item.body) === expected.get(file));
        const behaviorOk = fetched.every((item) => retiredFeatureCheck(file, item.body));
        return { file, url, status: fetched[0].status, sha256LF: sha256LF(fetched[0].body), contentOk, behaviorOk,
          ok: contentOk && behaviorOk };
      }));
      const excluded = await Promise.all(["/functions/index.js", "/functions/test/ai-text-training-retired-lights-runtime.test.js", "/README.md"]
        .map(async (file) => ({ file, status: (await read(origin + file)).status })));
      const previousReleaseMarkers = ["strategy-idle-guard-v1", "solo-match-cost-guard-v1", "tribute-cost-guard-v1"]
        .every((marker) => html.body.includes(marker));
      return { origin, indexOk, previousReleaseMarkers, assets, excluded,
        ok: indexOk && previousReleaseMarkers && assets.every((item) => item.ok) && excluded.every((item) => item.status === 404) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER,
    routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
