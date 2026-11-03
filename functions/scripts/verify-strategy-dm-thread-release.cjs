"use strict";

// Read-only public delivery check for the strategy 1on1 DM thread (strategy-dm-thread-v1, STRATEGY_DM_THREAD_DESIGN.md).
// On the public routes strategy.js and strategy.css changed (cache keys) and strategy-dm-thread.mjs is new. The other
// strategy modules, online.js, velvet-battle.css and app.js are unchanged and must still match the files committed at HEAD.
// No sign-in, game APIs, production data access, or Firebase writes. The report goes to functions/docs/STRATEGY_DM_THREAD_RELEASE_QA.json.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "strategy-dm-thread-v1";
// キャッシュキーが今回の印で終わるファイルと、前回のまま中身も同じであるべきファイル。
const CHANGED_FILES = Object.freeze(["strategy.js", "strategy.css"]);
const UNCHANGED_FILES = Object.freeze(["online.js", "velvet-battle.css", "app.js"]);
// strategy.js が読むモジュール。strategy-dm-thread.mjs だけが新しく、ほかはキャッシュキーも中身も前のまま。
const CHANGED_MODULES = Object.freeze(["strategy-dm-thread.mjs"]);
const UNCHANGED_MODULES = Object.freeze(["strategy-chat.mjs", "strategy-video-transfer.mjs", "strategy-hariai-core.mjs", "chat-persona.mjs"]);
// 前回までの公開の印。新しい index.html に残っていることで、ほかの公開を巻き戻していないと確かめる。
const PREVIOUS_MARKERS = Object.freeze(["mirage-achievement-link-v1", "monthly-single-champion-v1", "ranch-premium-icons-v3", "normal-dm-gaze-v1", "normal-dm-thread-v1", "strategy-persona-chat-v1", "my-stadium-v1"]);
const PRIVATE = Object.freeze([
  "/STRATEGY_DM_THREAD_DESIGN.md",
  "/README.md",
  "/firebase.json",
  "/wrangler.jsonc",
  "/database.rules.json",
  "/functions/test/strategy-dm-thread.test.js",
  "/functions/scripts/verify-strategy-dm-thread-release.cjs",
  "/.claude/e2e-strategy.js",
]);
const TIMEOUT_MS = 20_000;

function committed(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

function moduleVersion(source, name) {
  return source.match(new RegExp(`(?:from |import\\()"\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
}

// strategy.css は data-src、strategy.js・online.js は機能の一覧（featureManifest）に載る。
function assetUrl(html, name, origin) {
  const direct = assetReference(html, name, origin);
  if (direct) return direct;
  for (const match of html.matchAll(/["']([^"'\s<>]+)["']/g)) {
    if (match[1].split("?")[0] !== name) continue;
    const url = new URL(match[1].replace(/&amp;/g, "&"), `${origin}/`);
    if (url.origin === origin) return url.href;
  }
  return null;
}

const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

async function verifyOrigin(origin, expected, nonce) {
  const home = await fetchText(`${origin}/?releaseCheck=${nonce}`);
  const indexOk = home.status === 200 && /text\/html/i.test(home.contentType) && sha256LF(home.body) === expected.html;
  const previousMarkers = PREVIOUS_MARKERS.filter((marker) => !home.body.includes(marker));
  const files = [];
  for (const name of [...CHANGED_FILES, ...UNCHANGED_FILES]) {
    const url = assetUrl(home.body, name, origin);
    if (!url || (CHANGED_FILES.includes(name) && !url.endsWith(MARKER))) {
      files.push({ file: name, url, ok: false, error: `Missing cache key${CHANGED_FILES.includes(name) ? ` ending ${MARKER}` : ""}` });
      continue;
    }
    const result = await fetchText(url);
    const typeOk = name.endsWith(".js") ? isScript(result) : /text\/css/i.test(result.contentType);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && typeOk && sha256LF(result.body) === expected.text[name] });
  }
  for (const [name, version] of Object.entries(expected.versions)) {
    const url = `${origin}/${name}?v=${version}`;
    const result = await fetchText(url);
    files.push({ file: name, url, status: result.status, ok: result.status === 200 && isScript(result) && sha256LF(result.body) === expected.text[name] });
  }
  const excluded = await Promise.all(PRIVATE.map(async (file) => ({ file, status: (await fetchText(`${origin}${file}`)).status })));
  return {
    origin,
    indexOk,
    missingPreviousMarkers: previousMarkers,
    files,
    excluded,
    ok: indexOk && !previousMarkers.length && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404),
  };
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const html = committed(commit, "index.html");
  if (!CHANGED_FILES.every((name) => html.includes(`${name}?v=`) && new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*${MARKER}"`).test(html))) {
    throw new Error(`index.html does not load ${CHANGED_FILES.join(" and ")} with cache keys ending ${MARKER}`);
  }
  const client = committed(commit, "strategy.js");
  const versions = Object.fromEntries([...CHANGED_MODULES, ...UNCHANGED_MODULES].map((name) => [name, moduleVersion(client, name)]));
  if (Object.values(versions).some((version) => !version)) throw new Error("strategy.js does not import its modules with cache keys");
  if (CHANGED_MODULES.some((name) => versions[name] !== MARKER)) throw new Error(`strategy-dm-thread.mjs must be imported with ?v=${MARKER}`);
  if (UNCHANGED_MODULES.some((name) => versions[name].includes(MARKER))) throw new Error("the other strategy modules should keep their cache keys");
  const expected = {
    html: sha256LF(html),
    versions,
    text: Object.fromEntries([...CHANGED_FILES, ...UNCHANGED_FILES, ...Object.keys(versions)].map((file) => [file, sha256LF(committed(commit, file))])),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce).catch((error) => ({ origin, ok: false, error: error.message }))));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, commit, routes, ok: routes.every((route) => route.ok) };
  if (process.argv.includes("--write")) {
    await fs.writeFile(path.join(ROOT, "functions/docs/STRATEGY_DM_THREAD_RELEASE_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    ok: report.ok,
    commit,
    routes: routes.map((route) => ({
      origin: route.origin,
      ok: route.ok,
      index: route.indexOk,
      error: route.error,
      missingPreviousMarkers: route.missingPreviousMarkers,
      failed: [...(route.files || []).filter((entry) => !entry.ok).map((entry) => `${entry.file}:${entry.status ?? entry.error}`),
        ...(route.excluded || []).filter((entry) => entry.status !== 404).map((entry) => `${entry.file}:${entry.status}`)],
    })),
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(`Release check failed (${error.message}).`); process.exitCode = 1; });

module.exports = { MARKER, CHANGED_FILES, UNCHANGED_FILES, CHANGED_MODULES, UNCHANGED_MODULES, PRIVATE, moduleVersion, assetUrl };
