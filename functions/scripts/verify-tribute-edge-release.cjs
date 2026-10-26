"use strict";
// Read-only public file and deployed function metadata checks. No player API calls.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const { createAdminReader } = require("./verify-image-preference-functions.cjs");
const root = path.resolve(__dirname, "../..");
const marker = "ranch-edge-fixes-v1";

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "error" });
  return { status: response.status, body: await response.text() };
}
async function main() {
  const since = process.argv[2];
  if (!Number.isFinite(Date.parse(since))) throw new Error("Deployment start timestamp required");
  const files = ["index.html", "tribute.js", "tribute.css"];
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const hashes = Object.fromEntries(files.map(file => [file, sha256LF(execFileSync("git", ["show", `${commit}:${file}`], { cwd: root, encoding: "utf8", windowsHide: true }))]));
  const routes = await Promise.all(ORIGINS.map(async origin => {
    const home = await read(`${origin}/?releaseCheck=${Date.now()}`);
    const assets = await Promise.all(files.slice(1).map(async file => {
      const url = assetReference(home.body, file, origin);
      const response = url ? await read(url) : null;
      return { file, url, status: response?.status, ok: Boolean(url?.includes(marker) && response?.status === 200 && sha256LF(response.body) === hashes[file]) };
    }));
    return { origin, assets, ok: home.status === 200 && sha256LF(home.body) === hashes["index.html"] && assets.every(asset => asset.ok) };
  }));
  const admin = await createAdminReader();
  const functions = await Promise.all(["tributeAction", "expireTributeContracts", "playerSafetyAction", "cleanupPlayerSafety"].map(async name => {
    const data = await admin(`https://cloudfunctions.googleapis.com/v2/projects/gazostadium/locations/us-central1/functions/${name}`);
    return { name, state: data.state, runtime: data.buildConfig?.runtime, updatedAt: data.updateTime, revision: data.serviceConfig?.revision,
      ok: data.state === "ACTIVE" && data.buildConfig?.runtime === "nodejs24" && Date.parse(data.updateTime) >= Date.parse(since) };
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker, since, commit, hashes, routes, functions, ok: routes.every(route => route.ok) && functions.every(fn => fn.ok) };
  await fs.writeFile(path.join(root, "functions/docs/TRIBUTE_EDGE_FIX_RELEASE_QA.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
main().catch(error => { console.error(`Release check failed (${error.name}).`); process.exitCode = 1; });
