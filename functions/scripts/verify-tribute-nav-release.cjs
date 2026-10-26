"use strict";

// Read-only public delivery check for the お貢ぎ牧場 導線 release (ranch-nav-v1):
// the top-page shortcut, ?open=ranch, やること and the contract list first, and 「次へ」 in threads.
// Compares all public routes with the files committed at HEAD. No sign-in, game APIs,
// production data access, or filesystem writes. This release changes no Functions or rules.
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-nav-v1";
// 今回キャッシュキーが変わったページのファイル（どれも末尾が ranch-nav-v1）。
const PAGE_FILES = Object.freeze(["app.js", "tribute.js", "tribute.css"]);
const PREVIOUS_MARKERS = Object.freeze(["ranch-edge-fixes-v1", "ranch-illustration-icons-v1", "normal-dm-thread-v1", "ranch-vault-v1", "ranch-rank-score-v1", "ranch-photo-icons-v1", "ranch-board-fresh-v1", "ranch-kidoku-v1", "my-stadium-v1"]);
// 招待リンクの形（?ranch=公開ID）と、牧場を直接開く形（?open=ranch）でも、同じページが返ること。IDはダミー。
const ENTRY_PATHS = Object.freeze(["/", "/?ranch=000000000000000000000000", "/?open=ranch"]);
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/functions/tribute-service.js",
  "/functions/scripts/verify-tribute-nav-release.cjs",
  "/functions/test/tribute-nav.test.js",
]);
const TIMEOUT_MS = 20_000;

function committed(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

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

const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

async function verifyOrigin(origin, expected, nonce) {
  const pages = await Promise.all(ENTRY_PATHS.map((entry) => fetchText(`${origin}${entry}${entry.includes("?") ? "&" : "?"}releaseCheck=${nonce}`)));
  const indexOk = pages.every((result) => result.status === 200 && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html);
  const html = pages[0].body;
  const previousMarkers = PREVIOUS_MARKERS.every((marker) => html.includes(marker));
  const files = [];
  for (const name of PAGE_FILES) {
    const url = assetReference(html, name, origin);
    if (!url?.endsWith(MARKER)) {
      files.push({ file: name, url, ok: false, error: `Missing cache key ending ${MARKER}` });
      continue;
    }
    const result = await fetchText(url);
    const typeOk = name.endsWith(".js") ? isScript(result) : /text\/css/i.test(result.contentType);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  // 牧場の画面が import するモジュール（tribute-core.mjs は今回の判定を持つ。ほかの2つは変更なし）。
  for (const [name, version] of Object.entries(expected.versions)) {
    const url = `${origin}/${name}?v=${version}`;
    const result = await fetchText(url);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && isScript(result) && sha256LF(result.body) === expected.text[name] });
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
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const client = committed(commit, "tribute.js");
  const versions = {
    "tribute-core.mjs": moduleVersion(client, "tribute-core.mjs"),
    "tribute-share.mjs": moduleVersion(client, "tribute-share.mjs"),
    "tribute-deco.mjs": moduleVersion(client, "tribute-deco.mjs"),
  };
  if (!versions["tribute-core.mjs"].endsWith(MARKER) || !versions["tribute-share.mjs"] || !versions["tribute-deco.mjs"]) {
    throw new Error("the ranch modules are not imported with the expected cache keys");
  }
  const expected = {
    html: sha256LF(committed(commit, "index.html")),
    versions,
    text: Object.fromEntries([...PAGE_FILES, ...Object.keys(versions)].map((file) => [file, sha256LF(committed(commit, file))])),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)
    .catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, commit, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
