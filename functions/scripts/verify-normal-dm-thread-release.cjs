"use strict";
// Read-only public file checks for the normal 1on1 DM thread release. No player API calls, no Firebase writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const root = path.resolve(__dirname, "../..");
const marker = "normal-dm-thread-v1";
// 前回までの公開の印。新しい index.html に残っていることで、ほかの公開を巻き戻していないと確かめる。
const previousMarkers = ["ranch-edge-fixes-v1", "ranch-illustration-icons-v1", "my-stadium-v1", "chat-persona-v2", "girl-voice-casual-v1"];
const linkedAssets = ["online.js", "velvet-battle.css", "app.js"];
const directFiles = [
  { file: "normal-dm-thread.mjs", url: `normal-dm-thread.mjs?v=${marker}` },
  { file: "how-to-play/index.html", url: "how-to-play/" },
];
const privateFiles = ["NORMAL_DM_THREAD_DESIGN.md", "README.md", "firebase.json", "functions/test/normal-dm-thread.test.js", "functions/scripts/verify-normal-dm-thread-release.cjs"];

async function read(url, redirect = "error") {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: "no-store", redirect });
  return { status: response.status, url: response.url, body: await response.text() };
}

function show(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: root, encoding: "utf8", windowsHide: true });
}

async function main() {
  const since = process.argv[2];
  if (!Number.isFinite(Date.parse(since))) throw new Error("Deployment start timestamp required");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const files = ["index.html", ...linkedAssets, ...directFiles.map(({ file }) => file)];
  const hashes = Object.fromEntries(files.map((file) => [file, sha256LF(show(commit, file))]));
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    const home = await read(`${origin}/?releaseCheck=${Date.now()}`);
    const markersKept = previousMarkers.every((value) => home.body.includes(value));
    const linked = await Promise.all(linkedAssets.map(async (file) => {
      const url = assetReference(home.body, file, origin);
      const response = url ? await read(url) : null;
      return { file, url, status: response?.status, ok: Boolean(url?.includes(marker) && response?.status === 200 && sha256LF(response.body) === hashes[file]) };
    }));
    const direct = await Promise.all(directFiles.map(async ({ file, url }) => {
      const response = await read(`${origin}/${url}`, "follow");
      return { file, url: response.url, status: response.status, ok: response.status === 200 && sha256LF(response.body) === hashes[file] };
    }));
    const hidden = await Promise.all(privateFiles.map(async (file) => {
      const response = await read(`${origin}/${file}`, "manual");
      return { file, status: response.status, ok: response.status === 404 };
    }));
    return {
      origin,
      index: { status: home.status, ok: home.status === 200 && sha256LF(home.body) === hashes["index.html"] },
      markersKept,
      linked,
      direct,
      hidden,
      ok: home.status === 200 && sha256LF(home.body) === hashes["index.html"] && markersKept
        && linked.every((item) => item.ok) && direct.every((item) => item.ok) && hidden.every((item) => item.ok),
    };
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker, since, commit, hashes, routes, ok: routes.every((route) => route.ok) };
  await fs.writeFile(path.join(root, "functions/docs/NORMAL_DM_THREAD_RELEASE_QA.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.ok, commit, routes: routes.map(({ origin, ok, index, markersKept, linked, direct, hidden }) => ({
    origin, ok, index: index.ok, markersKept,
    failed: [...linked, ...direct, ...hidden].filter((item) => !item.ok).map((item) => `${item.file}:${item.status}`),
  })) }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(`Release check failed (${error.name}: ${error.message}).`); process.exitCode = 1; });
