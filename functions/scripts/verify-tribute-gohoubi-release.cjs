"use strict";

// Read-only public delivery check for the お貢ぎ牧場 icons / 受け取る・ご褒美 / 名目 release.
// No sign-in, game APIs, production data access, or filesystem writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-gohoubi-v1";
const PREVIOUS_MARKERS = Object.freeze(["tribute-cost-guard-v1", "retire-free-table-v1"]);
const AVATARS = Object.freeze(Array.from({ length: 12 }, (_, index) => `assets/tribute-avatars/avatar-${String(index + 1).padStart(2, "0")}.webp`));
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/functions/tribute-service.js",
  "/functions/tribute-rules.js",
  "/functions/scripts/verify-tribute-gohoubi-release.cjs",
]);
const TIMEOUT_MS = 20_000;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fetchResult(url, { binary = false } = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const body = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  return { status: response.status, contentType: response.headers.get("content-type") || "", body };
}

async function verifyOrigin(origin, expected, nonce) {
  const html = await fetchResult(`${origin}/`);
  const freshHtml = await fetchResult(`${origin}/?releaseCheck=${nonce}`);
  const indexOk = [html, freshHtml].every((result) => result.status === 200
    && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html);
  const previousMarkers = PREVIOUS_MARKERS.every((marker) => html.body.includes(marker));

  const text = [];
  for (const name of ["tribute.js", "tribute.css"]) {
    const url = assetReference(html.body, name, origin);
    if (!url?.includes(MARKER)) {
      text.push({ file: name, url, ok: false, error: "Missing release marker" });
      continue;
    }
    const result = await fetchResult(url);
    const typeOk = name.endsWith(".js") ? /javascript|ecmascript/i.test(result.contentType) : /text\/css/i.test(result.contentType);
    text.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  // tribute-core.mjs は tribute.js の import から読まれる。同じキャッシュキーで取りに行く。
  const coreUrl = `${origin}/tribute-core.mjs?v=${expected.coreVersion}`;
  const core = await fetchResult(coreUrl);
  text.push({ file: "tribute-core.mjs", url: coreUrl, status: core.status,
    ok: core.status === 200 && /javascript|ecmascript/i.test(core.contentType) && sha256LF(core.body) === expected.text["tribute-core.mjs"] });

  const avatars = await Promise.all(AVATARS.map(async (file) => {
    const result = await fetchResult(`${origin}/${file}`, { binary: true });
    return { file, status: result.status, contentType: result.contentType,
      ok: result.status === 200 && /image\/webp/i.test(result.contentType) && sha256(result.body) === expected.avatars[file] };
  }));
  const excluded = await Promise.all(PRIVATE.map(async (file) => ({ file, status: (await fetchResult(`${origin}${file}`)).status })));

  return {
    origin,
    indexOk,
    previousMarkers,
    text,
    avatars: { ok: avatars.every((entry) => entry.ok), failed: avatars.filter((entry) => !entry.ok) },
    excluded,
    ok: indexOk && previousMarkers && text.every((entry) => entry.ok)
      && avatars.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404),
  };
}

async function main() {
  const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
  const client = await read("tribute.js");
  const coreVersion = client.match(/from "\.\/tribute-core\.mjs\?v=([^"]+)"/)?.[1] || "";
  if (!coreVersion.includes(MARKER)) throw new Error("tribute.js does not import the release tribute-core.mjs");
  const expected = {
    html: sha256LF(await read("index.html")),
    coreVersion,
    text: {
      "tribute.js": sha256LF(client),
      "tribute.css": sha256LF(await read("tribute.css")),
      "tribute-core.mjs": sha256LF(await read("tribute-core.mjs")),
    },
    avatars: Object.fromEntries(await Promise.all(AVATARS.map(async (file) => [file, sha256(await fs.readFile(path.join(ROOT, file)))]))),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
