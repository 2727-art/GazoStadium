"use strict";

// Public, read-only delivery checks. No sign-in or game API calls.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-manager-submit-v1";
const PRIVATE_PATHS = [
  "/firebase.json",
  "/functions/tribute-service.js",
  "/functions/test/tribute-manager-submit-runtime.test.js",
  "/functions/scripts/verify-tribute-manager-submit-release.cjs",
];

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

async function verifyOrigin(origin, expected, nonce) {
  const pages = await Promise.all(["/", `/?releaseCheck=${nonce}`, "/?ranch=000000000000000000000000"]
    .map(async (route) => {
      const result = await fetchText(`${origin}${route}`);
      return { route, result, ok: result.status === 200 && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html };
    }));
  const url = assetReference(pages[0].result.body, "tribute.js", origin);
  const script = url ? await fetchText(url) : null;
  const scriptOk = Boolean(url?.endsWith(MARKER) && script?.status === 200
    && /javascript|ecmascript/i.test(script.contentType) && sha256LF(script.body) === expected.script);
  const excluded = await Promise.all(PRIVATE_PATHS.map(async (route) => ({ route, status: (await fetchText(`${origin}${route}`)).status })));
  return {
    origin, pages: pages.map(({ route, ok, result }) => ({ route, status: result.status, ok })),
    script: { url, status: script?.status, sha256: script ? sha256LF(script.body) : null, ok: scriptOk },
    excluded, ok: pages.every((page) => page.ok) && scriptOk && excluded.every((entry) => entry.status === 404),
  };
}

async function main() {
  const [html, script] = await Promise.all(["index.html", "tribute.js"].map((file) => fs.readFile(path.join(ROOT, file), "utf8")));
  const expected = { html: sha256LF(html), script: sha256LF(script) };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), marker: MARKER, readOnly: true, expected, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
