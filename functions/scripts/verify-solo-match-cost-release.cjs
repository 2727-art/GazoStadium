"use strict";

// Read-only, exact public-source verification. Does not sign in or play a match.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "solo-match-cost-guard-v1";
const ASSETS = ["online.js", "online-solo-idle-guard.mjs"];

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "",
    body: await response.text() };
}

async function main() {
  const expectedHtml = sha256LF(await fs.readFile(path.join(ROOT, "index.html"), "utf8"));
  const expected = Object.fromEntries(await Promise.all(ASSETS.map(async (file) =>
    [file, sha256LF(await fs.readFile(path.join(ROOT, file), "utf8"))])));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const html = await read(`${origin}/`);
      const freshHtml = await read(`${origin}/?releaseCheck=${nonce}`);
      const onlineUrl = assetReference(html.body, "online.js", origin);
      const online = await read(new URL(onlineUrl, origin).href);
      const idleReference = online.body.match(/from\s+["'](\.\/online-solo-idle-guard\.mjs\?[^"']+)["']/)?.[1];
      if (!onlineUrl?.includes(MARKER) || !idleReference?.includes(MARKER)) throw new Error("Missing release marker/import");
      const urls = [new URL(onlineUrl, origin), new URL(idleReference, origin)];
      const assets = await Promise.all(ASSETS.map(async (file, i) => {
        const normal = i === 0 ? online : await read(urls[i].href);
        const freshUrl = new URL(urls[i]);
        freshUrl.searchParams.set("releaseCheck", String(nonce));
        const fresh = await read(freshUrl.href);
        const ok = [normal, fresh].every((result) => result.status === 200
          && /javascript|ecmascript/i.test(result.contentType)
          && sha256LF(result.body) === expected[file]);
        return { file, url: urls[i].href, status: normal.status, sha256LF: sha256LF(normal.body), ok };
      }));
      const excluded = await Promise.all([
        "/functions/index.js", "/functions/test/online-solo-idle-runtime.test.js",
      ].map(async (file) => ({ file, status: (await read(`${origin}${file}`)).status })));
      const indexOk = [html, freshHtml].every((result) => result.status === 200
        && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expectedHtml);
      return { origin, indexOk, assets, excluded,
        ok: indexOk && assets.every((result) => result.ok) && excluded.every((result) => result.status === 404) };
    } catch (error) {
      return { origin, ok: false, error: error.message };
    }
  }));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER,
    routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
