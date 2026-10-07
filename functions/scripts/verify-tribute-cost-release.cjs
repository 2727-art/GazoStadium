"use strict";

// Read-only source-delivery checks: no sign-in, real contracts, or wallet writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");
const ROOT = path.resolve(__dirname, "../..");
const MARKER = "tribute-cost-guard-v1";

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error",
    cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "",
    body: await response.text() };
}

async function main() {
  const expectedHtml = sha256LF(await fs.readFile(path.join(ROOT, "index.html"), "utf8"));
  const expectedScript = sha256LF(await fs.readFile(path.join(ROOT, "tribute.js"), "utf8"));
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map(async (origin) => {
    try {
      const html = await read(`${origin}/`);
      const freshHtml = await read(`${origin}/?releaseCheck=${nonce}`);
      const assetUrl = assetReference(html.body, "tribute.js", origin);
      if (!assetUrl?.includes(MARKER)) throw new Error("Missing tribute release marker");
      const script = await read(assetUrl);
      const freshUrl = new URL(assetUrl);
      freshUrl.searchParams.set("releaseCheck", String(nonce));
      const freshScript = await read(freshUrl.href);
      const scriptOk = [script, freshScript].every((result) => result.status === 200
        && /javascript|ecmascript/i.test(result.contentType) && sha256LF(result.body) === expectedScript);
      const indexOk = [html, freshHtml].every((result) => result.status === 200
        && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expectedHtml);
      const previousReleaseMarkers = ["strategy-idle-guard-v1", "solo-match-cost-guard-v1"]
        .every((marker) => html.body.includes(marker));
      const excluded = await Promise.all([
        "/functions/index.js", "/functions/tribute-service.js",
        "/functions/test/tribute-cost-emulator.test.js",
      ].map(async (file) => ({ file, status: (await read(`${origin}${file}`)).status })));
      return { origin, indexOk, previousReleaseMarkers,
        asset: { file: "tribute.js", url: assetUrl, status: script.status, sha256LF: sha256LF(script.body), ok: scriptOk },
        excluded, ok: indexOk && previousReleaseMarkers && scriptOk && excluded.every((item) => item.status === 404) };
    } catch (error) { return { origin, ok: false, error: error.message }; }
  }));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER,
    routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
