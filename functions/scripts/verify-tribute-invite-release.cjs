"use strict";

// Read-only public delivery check for the お貢ぎ牧場 招待リンク・財布の始め方・お試し・見学 release (screen only).
// No sign-in, game APIs, production data access, or filesystem writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-invite-v1";
const PREVIOUS_MARKERS = Object.freeze(["ranch-word-v1", "ranch-collar-v1", "ranch-gohoubi-v1", "tribute-cost-guard-v1", "retire-free-table-v1"]);
// 招待リンクの形（?ranch=公開ID）で開いても、同じページが返ること。IDはダミー。
const INVITE_PATH = "/?ranch=000000000000000000000000";
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/functions/tribute-service.js",
  "/functions/tribute-rules.js",
  "/functions/scripts/verify-tribute-invite-release.cjs",
  "/.claude/mocks/gohoubi.html",
  "/.claude/mocks/share-render.html",
]);
const TIMEOUT_MS = 20_000;

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

function moduleVersion(source, name) {
  return source.match(new RegExp(`from "\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
}

async function verifyOrigin(origin, expected, nonce) {
  const html = await fetchText(`${origin}/`);
  const freshHtml = await fetchText(`${origin}/?releaseCheck=${nonce}`);
  const invite = await fetchText(`${origin}${INVITE_PATH}`);
  const indexOk = [html, freshHtml, invite].every((result) => result.status === 200
    && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html);
  const previousMarkers = PREVIOUS_MARKERS.every((marker) => html.body.includes(marker));
  const files = [];
  for (const name of ["tribute.js", "tribute.css"]) {
    const url = assetReference(html.body, name, origin);
    if (!url?.includes(MARKER)) {
      files.push({ file: name, url, ok: false, error: "Missing release marker" });
      continue;
    }
    const result = await fetchText(url);
    const typeOk = name.endsWith(".js") ? /javascript|ecmascript/i.test(result.contentType) : /text\/css/i.test(result.contentType);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  // tribute.js が import する2つのモジュールは、同じキャッシュキーで取りに行く。
  for (const name of ["tribute-core.mjs", "tribute-share.mjs"]) {
    const url = `${origin}/${name}?v=${expected.versions[name]}`;
    const result = await fetchText(url);
    files.push({ file: name, url, status: result.status,
      ok: result.status === 200 && /javascript|ecmascript/i.test(result.contentType) && sha256LF(result.body) === expected.text[name] });
  }
  const excluded = await Promise.all(PRIVATE.map(async (file) => ({ file, status: (await fetchText(`${origin}${file}`)).status })));
  return {
    origin,
    indexOk,
    previousMarkers,
    files,
    excluded,
    ok: indexOk && previousMarkers && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404),
  };
}

async function main() {
  const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");
  const client = await read("tribute.js");
  const versions = {
    "tribute-core.mjs": moduleVersion(client, "tribute-core.mjs"),
    "tribute-share.mjs": moduleVersion(client, "tribute-share.mjs"),
  };
  // tribute-core.mjs は今回の印、tribute-share.mjs は前回のまま（中身が変わっていないため）。
  if (!versions["tribute-core.mjs"].includes(MARKER) || !versions["tribute-share.mjs"].includes("ranch-collar-v1")) {
    throw new Error("tribute.js does not import the release modules");
  }
  const expected = {
    html: sha256LF(await read("index.html")),
    versions,
    text: Object.fromEntries(await Promise.all(["tribute.js", "tribute.css", "tribute-core.mjs", "tribute-share.mjs"]
      .map(async (file) => [file, sha256LF(await read(file))]))),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
