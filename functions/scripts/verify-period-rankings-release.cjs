"use strict";

// Read-only production verification; credentials stay in memory and headers.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF } = require("./verify-player-safety-release.cjs");
const { createAdminReader } = require("./verify-image-preference-functions.cjs");
const { assetUrl } = require("./verify-strategy-dm-thread-release.cjs");
const root = path.resolve(__dirname, "../..");
const changed = ["app.js", "online.js", "strategy.js"];
const retained = ["tribute.js", "strategy.css", "feature-loader.js", "normal-dm-gaze.mjs"];
const marker = "ranking-screen-load-v1";
const previousMarkers = ["strategy-dm-gaze-v1", "monthly-single-champion-v1", "mirage-achievement-link-v1", "ranch-premium-icons-v3", "mobile-loading-v1"];

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "manual" });
  return { status: response.status, body: await response.text() };
}

async function main() {
  const since = process.argv[2];
  if (!Number.isFinite(Date.parse(since))) throw new Error("Deployment timestamp required");
  const hashes = Object.fromEntries(await Promise.all(["index.html", ...changed, ...retained].map(async file => [file, sha256LF(await fs.readFile(path.join(root, file), "utf8"))])));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async origin => {
    const home = await read(`${origin}/?releaseCheck=${nonce}`);
    const files = await Promise.all([...changed, ...retained].map(async file => {
      const url = assetUrl(home.body, file, origin) || `${origin}/${file}?releaseCheck=${nonce}`;
      const response = await read(url);
      return { file, status: response.status, ok: response.status === 200 && sha256LF(response.body) === hashes[file]
        && (!changed.includes(file) || url.includes(marker)) };
    }));
    const excluded = await Promise.all(["/tmp/period-rankings-qa/report.json", "/functions/index.js", "/functions/.env.gazostadium"].map(async file => ({ file, status: (await read(`${origin}${file}`)).status })));
    return { origin, files, excluded, ok: home.status === 200 && sha256LF(home.body) === hashes["index.html"]
      && previousMarkers.every(value => home.body.includes(value)) && files.every(file => file.ok)
      && excluded.every(file => file.status === 404) };
  }));
  const admin = await createAdminReader();
  const deployed = await admin("https://cloudfunctions.googleapis.com/v2/projects/gazostadium/locations/us-central1/functions?pageSize=100");
  const source = await fs.readFile(path.join(root, "functions/index.js"), "utf8");
  const targets = [...source.matchAll(/^exports\.(\w+)\s*=/gm)].map(match => match[1]);
  const functions = targets.map(name => {
    const fn = deployed.functions.find(value => value.name.endsWith(`/${name}`));
    return { name, state: fn?.state, revision: fn?.serviceConfig?.revision, updatedAt: fn?.updateTime,
      ok: fn?.state === "ACTIVE" && fn?.buildConfig?.runtime === "nodejs24" && Date.parse(fn?.updateTime) >= Date.parse(since) };
  });
  const rules = await admin("https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app/.settings/rules.json");
  const expectedRules = JSON.parse(await fs.readFile(path.join(root, "database.rules.json"), "utf8"));
  const rulesMatch = JSON.stringify(rules) === JSON.stringify(expectedRules);
  const retired = await Promise.all(["serverOverallLeaderboard", "serverRateFloorLeaderboard", "serverOverallLeaderboardEntriesByUser"].map(async name => {
    const response = await fetch(`https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app/online/${name}.json?shallow=true`, { signal: AbortSignal.timeout(25000) });
    await response.body?.cancel();
    return { name, status: response.status, denied: [401, 403].includes(response.status) };
  }));
  const probe = await fetch("https://us-central1-gazostadium.cloudfunctions.net/economyAction", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { action: "get_ranking_dashboard" } }), signal: AbortSignal.timeout(25000),
  });
  const probeBody = await probe.json();
  const authBoundary = { status: probe.status, error: probeBody.error?.status,
    ok: probe.status === 401 && probeBody.error?.status === "UNAUTHENTICATED" };
  const report = { checkedAt: new Date().toISOString(), since, project: "gazostadium", readOnly: true, marker,
    routes, functions, rulesMatch, retired, authBoundary,
    ok: routes.every(route => route.ok) && functions.every(fn => fn.ok) && rulesMatch && retired.every(item => item.denied) && authBoundary.ok };
  await fs.writeFile(path.join(root, "functions/docs/PERIOD_RANKINGS_RELEASE_QA.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.ok, routes: routes.map(({ origin, ok }) => ({ origin, ok })),
    functionsActive: functions.filter(fn => fn.ok).length, functionsExpected: functions.length, rulesMatch, retired, authBoundary }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => { console.error(`Release verification failed (${error.name}).`); process.exitCode = 1; });
