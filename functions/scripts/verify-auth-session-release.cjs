"use strict";

// Public, read-only checks. No authentication or player data requests.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const CLIENTS = ["account.js", "online.js", "strategy.js", "tribute.js", "stadium.js",
  "roulette-training.js", "ai-text-training.js", "player-safety.js", "market.js",
  "flea-market.js", "danwaku-note.js", "free-table.js"];
const HELPERS = ["auth-session.js", "auth-session-core.mjs", "account-switch.js"];
const FIREBASE = ["firebase-services.js", "firebase-client.js", "firebase-config.js", "firebase-app-check.js"];
const PRIVATE = ["/functions/scripts/verify-auth-session-release.cjs", "/functions/test/auth-session.test.js",
  "/.firebase/auth-session-release/backend-before.json", "/firebase.json", "/firestore.rules"];

async function read(url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
  return { status: response.status, type: response.headers.get("content-type") || "",
    frameOptions: response.headers.get("x-frame-options"),
    csp: response.headers.get("content-security-policy"), body: await response.text() };
}

async function main() {
  const files = ["index.html", ...CLIENTS, ...HELPERS, ...FIREBASE];
  const hashes = Object.fromEntries(await Promise.all(files.map(async (file) =>
    [file, sha256LF(await fs.readFile(path.join(ROOT, file), "utf8"))])));
  const origins = await Promise.all(ORIGINS.map(async (origin) => {
    const html = await read(`${origin}/`);
    const indexOk = html.status === 200 && sha256LF(html.body) === hashes["index.html"];
    const assets = [];
    for (const file of [...CLIENTS, ...HELPERS, ...FIREBASE]) {
      const reference = assetReference(html.body, file, origin);
      const url = reference || `${origin}/${file}${file === "account-switch.js" ? "?v=account-switch-v1" : HELPERS.includes(file) ? "?v=auth-session-v1" : ""}`;
      const response = await read(url);
      const hashOk = sha256LF(response.body) === hashes[file];
      const authImportOk = !CLIENTS.includes(file)
        || response.body.includes('from "./auth-session.js?v=auth-session-v1"');
      const cacheKeyOk = !reference || new URL(reference).searchParams.get("v")?.includes("auth-session-v1");
      assets.push({ file, status: response.status, hashOk, authImportOk, cacheKeyOk,
        ok: response.status === 200 && /javascript|ecmascript/i.test(response.type) && hashOk && authImportOk && cacheKeyOk });
    }
    const privatePaths = await Promise.all(PRIVATE.map(async (route) => ({ route, status: (await read(origin + route)).status })));
    return { origin, indexOk, assets, privatePaths,
      ok: indexOk && assets.every((asset) => asset.ok) && privatePaths.every((entry) => entry.status === 404) };
  }));
  const helper = await read("https://gazostadium.firebaseapp.com/__/auth/iframe");
  const googleHelper = { status: helper.status, frameOptions: helper.frameOptions, csp: helper.csp,
    ok: helper.status === 200 && !helper.frameOptions && !/frame-ancestors\s+'none'/i.test(helper.csp || "") };
  const report = { checkedAt: new Date().toISOString(), readOnly: true, origins, googleHelper,
    ok: origins.every((origin) => origin.ok) && googleHelper.ok };
  const destination = path.join(ROOT, ".firebase/auth-session-release/public.json");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, origins: origins.map(({ origin, indexOk, assets, privatePaths, ok }) =>
    ({ origin, indexOk, assetChecks: assets.length, failedAssets: assets.filter((asset) => !asset.ok),
      privatePathsOk: privatePaths.every((entry) => entry.status === 404), ok })) }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
