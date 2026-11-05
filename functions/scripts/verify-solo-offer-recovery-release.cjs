"use strict";

// Public delivery only. No sign-in, backend calls, or production data writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF } = require("./verify-player-safety-release.cjs");
const { assetUrl } = require("./verify-strategy-dm-thread-release.cjs");
const root = path.resolve(__dirname, "../..");
const marker = "solo-offer-recovery-v1";
const files = ["online.js", "app.js", "strategy.js", "styles.css", "strategy.css", "tribute.js", "feature-loader.js"];

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "manual" });
  return { status: response.status, body: await response.text() };
}

async function main() {
  const expected = Object.fromEntries(await Promise.all(["index.html", ...files].map(async file =>
    [file, sha256LF(await fs.readFile(path.join(root, file), "utf8"))])));
  const results = await Promise.all(ORIGINS.map(async origin => {
    const home = await read(`${origin}/?releaseCheck=${Date.now()}`);
    const assets = await Promise.all(files.map(async file => {
      const url = assetUrl(home.body, file, origin);
      if (!url) return { file, ok: false };
      const result = await read(url);
      return { file, status: result.status, ok: result.status === 200 && sha256LF(result.body) === expected[file]
        && (file !== "online.js" || url.includes(marker)) };
    }));
    const privateFiles = await Promise.all(["/tmp/reproduce-hosted-offer-denied.test.cjs",
      "/functions/index.js", "/functions/docs/MATCH_DENIED_INVESTIGATION.md"].map(async file =>
      ({ file, status: (await read(`${origin}${file}`)).status })));
    return { origin, assets, privateFiles, ok: home.status === 200 && sha256LF(home.body) === expected["index.html"]
      && assets.every(asset => asset.ok) && privateFiles.every(file => file.status === 404) };
  }));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker, results,
    ok: results.every(result => result.ok) };
  await fs.writeFile(path.join(root, "functions/docs/SOLO_OFFER_RECOVERY_RELEASE_QA.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
main().catch(error => { console.error(`Public release verification failed (${error.name}).`); process.exitCode = 1; });
