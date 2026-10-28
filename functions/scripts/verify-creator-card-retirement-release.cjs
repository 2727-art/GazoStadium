"use strict";

// Read-only checks against committed assets, without authentication or game APIs.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const root = path.resolve(__dirname, "../..");
const files = ["app.js", "online.js", "account.js", "styles.css", "velvet.css"];
const privateFiles = ["/database.rules.json", "/functions/creator-card-refund.js", "/functions/scripts/refund-retired-creator-cards.cjs", "/functions/docs/CREATOR_CARD_RETIREMENT_RELEASE.md"];
const committed = (file) => execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" });
  return { status: response.status, body: await response.text() };
}
async function main() {
  const expected = Object.fromEntries(["index.html", ...files].map((file) => [file, sha256LF(committed(file))]));
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const html = await read(`${origin}/?retirementCheck=${Date.now()}`);
      const assets = await Promise.all(files.map(async (file) => {
        const url = assetReference(html.body, file, origin);
        if (!url?.endsWith("retire-creator-card-v1")) return { file, ok: false };
        const result = await read(url);
        return { file, ok: result.status === 200 && sha256LF(result.body) === expected[file] };
      }));
      const excluded = await Promise.all(privateFiles.map(async (file) => ({ file, status: (await read(origin + file)).status })));
      return { origin, assets, excluded, ok: html.status === 200 && sha256LF(html.body) === expected["index.html"] && assets.every((item) => item.ok) && excluded.every((item) => item.status === 404) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
