"use strict";

// Read-only public delivery check for the full-screen strategy DM on phones (strategy-dm-fullscreen-v1): at 900px and
// below the battle hides the site header and the contact panel, the ••• menu carries block, leave, safety and sound, the
// DM header is two rows, the step band one line, and the opponent's image is wider. Only strategy.js and strategy.css
// changed on the public routes (cache keys ending strategy-dm-fullscreen-v1); the strategy modules (still on their own
// keys), player-safety.js, audio.js, online.js, velvet-battle.css and app.js must still match the files committed at HEAD.
// No sign-in, game APIs, production data access, or Firebase writes. With --write the report goes to
// functions/docs/STRATEGY_DM_FULLSCREEN_RELEASE_QA.json.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF } = require("./verify-player-safety-release.cjs");
const { assetUrl, moduleVersion } = require("./verify-strategy-dm-thread-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "strategy-dm-fullscreen-v1";
const CHANGED_FILES = Object.freeze(["strategy.js", "strategy.css"]);
const UNCHANGED_FILES = Object.freeze(["audio.js", "online.js", "velvet-battle.css", "app.js"]);
const MODULES = Object.freeze([
  "strategy-dm-thread.mjs",
  "strategy-voice-transfer.mjs",
  "strategy-chat.mjs",
  "strategy-video-transfer.mjs",
  "strategy-review-asset-transfer.mjs",
  "strategy-hariai-core.mjs",
  "chat-persona.mjs",
  "player-safety.js",
]);
// 前回までの公開の印。新しい index.html に残っていることで、ほかの公開を巻き戻していないと確かめる。
const PREVIOUS_MARKERS = Object.freeze(["strategy-dm-voice-v1", "strategy-media-ack-v1", "strategy-dm-thread-v1", "mirage-achievement-link-v1", "monthly-single-champion-v1", "ranch-premium-icons-v3", "normal-dm-gaze-v1", "normal-dm-thread-v1", "my-stadium-v1"]);
const PRIVATE = Object.freeze([
  "/STRATEGY_DM_THREAD_DESIGN.md",
  "/README.md",
  "/firebase.json",
  "/functions/test/strategy-dm-thread.test.js",
  "/functions/scripts/verify-strategy-dm-fullscreen-release.cjs",
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

const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

async function verifyOrigin(origin, expected, nonce) {
  const home = await fetchText(`${origin}/?releaseCheck=${nonce}`);
  const indexOk = home.status === 200 && /text\/html/i.test(home.contentType) && sha256LF(home.body) === expected.html;
  const missingPreviousMarkers = PREVIOUS_MARKERS.filter((marker) => !home.body.includes(marker));
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
    const result = await fetchText(`${origin}/${name}?v=${version}`);
    files.push({ file: name, version, status: result.status, ok: result.status === 200 && isScript(result) && sha256LF(result.body) === expected.text[name] });
  }
  const excluded = await Promise.all(PRIVATE.map(async (file) => ({ file, status: (await fetchText(`${origin}${file}`)).status })));
  return {
    origin,
    indexOk,
    missingPreviousMarkers,
    files,
    excluded,
    ok: indexOk && !missingPreviousMarkers.length && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404),
  };
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const html = committed(commit, "index.html");
  for (const name of CHANGED_FILES) {
    if (!new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*${MARKER}"`).test(html)) throw new Error(`index.html does not load ${name} with a cache key ending ${MARKER}`);
  }
  const client = committed(commit, "strategy.js");
  for (const needle of ["function renderStrategyPhoneMenuItems(", "function renderStrategyPeopleCard(", "function toggleStrategySound("]) {
    if (!client.includes(needle)) throw new Error(`strategy.js at HEAD does not contain ${needle}`);
  }
  const styles = committed(commit, "strategy.css");
  if (!styles.includes("body:has(.sd-battle) main#app {")) throw new Error("strategy.css at HEAD does not contain the full-screen DM rules");
  const versions = Object.fromEntries(MODULES.map((name) => [name, moduleVersion(client, name)]));
  if (Object.values(versions).some((version) => !version)) throw new Error("strategy.js does not import its modules with cache keys");
  const expected = {
    html: sha256LF(html),
    versions,
    text: Object.fromEntries([...CHANGED_FILES, ...UNCHANGED_FILES, ...MODULES].map((file) => [file, sha256LF(committed(commit, file))])),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce).catch((error) => ({ origin, ok: false, error: error.message }))));
  const report = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, commit, routes, ok: routes.every((route) => route.ok) };
  if (process.argv.includes("--write")) {
    await fs.writeFile(path.join(ROOT, "functions/docs/STRATEGY_DM_FULLSCREEN_RELEASE_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
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
