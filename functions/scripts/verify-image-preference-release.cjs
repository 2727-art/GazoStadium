"use strict";

// Read-only verification of this release on all three public routes.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "image-preference-achievements-v1";
const ASSETS = ["achievements.js", "online.js", "strategy.js", "styles.css"];
const EXCLUDED = ["/functions/match-image-preferences.js", "/functions/scripts/verify-image-preference-functions.cjs",
  "/functions/docs/IMAGE_PREFERENCE_ACHIEVEMENTS_RELEASE.md"];

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", text: await response.text() };
}

async function main() {
  const expectedHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expected = Object.fromEntries(await Promise.all(ASSETS.map(async (name) => [name,
    sha256LF(await fs.readFile(path.join(ROOT, name), "utf8"))])));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const index = await read(`${origin}/`);
      const freshIndex = await read(`${origin}/?releaseCheck=${nonce}`);
      const assets = await Promise.all(ASSETS.map(async (name) => {
        const referenced = assetReference(index.text, name, origin);
        const url = new URL(referenced || `/${name}`, origin);
        const result = await read(url.href);
        const freshUrl = new URL(url.href);
        freshUrl.searchParams.set("releaseCheck", String(nonce));
        const fresh = await read(freshUrl.href);
        const hash = sha256LF(result.text);
        const typePattern = name.endsWith(".css") ? /text\/css/i : /(?:javascript|ecmascript)/i;
        return { name, url: url.href, status: result.status, contentType: result.contentType, sha256LF: hash,
          cacheBust: { status: fresh.status, contentType: fresh.contentType, sha256LF: sha256LF(fresh.text) },
          ok: Boolean(referenced) && referenced.includes(MARKER) && result.status === 200 && hash === expected[name]
            && typePattern.test(result.contentType) && fresh.status === 200 && typePattern.test(fresh.contentType)
            && sha256LF(fresh.text) === expected[name] };
      }));
      const excluded = await Promise.all(EXCLUDED.map(async (name) => {
        const result = await read(`${origin}${name}?releaseCheck=${nonce}`);
        return { path: name, status: result.status, ok: result.status === 404 };
      }));
      const indexOk = index.status === 200 && /text\/html/i.test(index.contentType) && index.text.includes(MARKER)
        && sha256LF(index.text) === sha256LF(expectedHtml) && freshIndex.status === 200
        && /text\/html/i.test(freshIndex.contentType) && sha256LF(freshIndex.text) === sha256LF(expectedHtml);
      return { origin, index: { status: index.status, contentType: index.contentType, sha256LF: sha256LF(index.text),
        cacheBust: { status: freshIndex.status, sha256LF: sha256LF(freshIndex.text) }, ok: indexOk },
        assets, excluded, ok: indexOk && assets.every((value) => value.ok) && excluded.every((value) => value.ok) };
    } catch (error) {
      return { origin, ok: false, error: error.name };
    }
  }));
  const report = { checkedAt: new Date().toISOString(), marker: MARKER, readOnly: true,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(),
    routes, ok: routes.every((value) => value.ok) };
  await fs.writeFile(path.join(ROOT, "functions/docs/IMAGE_PREFERENCE_ACHIEVEMENTS_RELEASE_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Release verification failed (${error.name}).\n`);
  process.exitCode = 1;
});
