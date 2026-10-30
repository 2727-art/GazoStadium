"use strict";

// Read-only public delivery check for the お貢ぎ牧場 achievements (ranch-achievements-v1, design 17): play-style
// achievements for managers and wallets plus seven secrets, counted on the server once per pair per Japan day, shown
// in per-family frames. All Functions changed (the shared achievement catalog), no index change. On the public routes
// tribute.js, tribute.css, tribute-core.mjs and the shared achievements.js changed. No new images: all 549 ranch
// images must stay byte-identical. Compares all public routes with the files committed at HEAD. No sign-in, game
// APIs, production data access, or filesystem writes.
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-achievements-v1";
// 絵のキャッシュキー（tribute.js の RANCH_ASSET_KEY）。前からの絵は変わっていないので、第2段でも変えていない。
const RANCH_ASSET_KEY = "ranch-growth-v1";
// キャッシュキーが今回の印で終わるファイルと、前回のまま中身も同じであるべきファイル。
const CHANGED_FILES = Object.freeze(["tribute.js", "tribute.css", "achievements.js"]);
const UNCHANGED_FILES = Object.freeze(["account.js", "app.js", "online.js"]);
// tribute.js が読むモジュールのうち、キャッシュキーが今回の印で終わるもの（残りは前回のまま）。
const CHANGED_MODULES = Object.freeze(["tribute-core.mjs"]);
const PREVIOUS_MARKERS = Object.freeze(["ranch-photo-v1", "ranch-pat-v1", "ranch-peek-v1", "ranch-growth-v1", "ranch-pasture-v1", "ranch-reception-card-v1", "ranch-contest-v1", "ranch-othello-v1", "ranch-served-days-v1", "ranch-style-words-v1", "ranch-styles-v1", "ranch-safari-regex-v1", "ranch-report-marks-v1", "ranch-recite-v1", "ranch-premium-icons-v1", "ranch-hold-v1", "ranch-wallet-words-v1", "ranch-cheers-v1", "ranch-activity-optin-v1", "ranch-first-steps-v1", "ranch-work-orders-v1", "ranch-double-pay-refund-v1", "ranch-request-fix-v1", "ranch-thread-ux-v1", "ranch-screenshot-v1", "ranch-free-talk-v1", "ranch-nav-v1", "ranch-vault-v1", "my-stadium-v1"]);
const ENTRY_PATHS = Object.freeze(["/", "/?ranch=000000000000000000000000", "/?open=ranch"]);
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/functions/tribute-service.js",
  "/functions/tribute-rules.js",
  "/functions/scripts/verify-tribute-ranch-achievements-release.cjs",
  "/functions/test/tribute-ranch-achievements.test.js",
  "/functions/test/tribute-ranch-achievement-frames.test.js",
  "/functions/docs/TRIBUTE_RANCH_PHOTO_RELEASE.md",
  "/functions/achievements.js",
  "/art/tribute-ranch/render_ranch.py",
  "/functions/test/tribute-service-runtime.test.js",
  "/functions/docs/TRIBUTE_MANAGER_PSYCHOLOGY.md",
  "/functions/docs/TRIBUTE_WALLET_PSYCHOLOGY.md",
  "/firestore.indexes.json",
]);
const TIMEOUT_MS = 20_000;

// 牧場の絵（背景30段階・動物6種 × しぐさ5つ × なつき5段階・小物3つ、それぞれ昼・夕方・夜）。中身はバイトのまま比べる。
const RANCH_IMAGES = Object.freeze(["day", "evening", "night"].flatMap((time) => [
  ...Array.from({ length: 30 }, (_, index) => `ranch-lv${index + 1}-${time}.webp`),
  ...["cow", "pig", "sheep", "goat", "chicken", "rabbit"].flatMap((animal) => ["stand", "walk1", "walk2", "eat", "sleep"].flatMap((pose) => [0, 1, 2, 3, 4].map((tier) => `${animal}-${pose}${tier ? `-t${tier}` : ""}-${time}.webp`))),
  ...["letter", "hay", "stake"].map((prop) => `prop-${prop}-${time}.webp`),
]));

function committedBytes(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store" });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: Buffer.from(await response.arrayBuffer()) };
}

function committed(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

function moduleVersion(source, name) {
  return source.match(new RegExp(`from "\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
}

const hashBytes = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

// 2026-10-28 の読み込みの見直し（main #16）から、tribute.css は data-src、tribute.js は機能の一覧（featureManifest）に載る。
// src・href に無い時は、ページの中の引用符で囲まれた参照を探す。
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

async function verifyOrigin(origin, expected, nonce) {
  const pages = await Promise.all(ENTRY_PATHS.map((entry) => fetchText(`${origin}${entry}${entry.includes("?") ? "&" : "?"}releaseCheck=${nonce}`)));
  const indexOk = pages.every((result) => result.status === 200 && /text\/html/i.test(result.contentType) && sha256LF(result.body) === expected.html);
  const html = pages[0].body;
  const previousMarkers = PREVIOUS_MARKERS.every((marker) => html.includes(marker));
  const files = [];
  for (const name of [...CHANGED_FILES, ...UNCHANGED_FILES]) {
    const url = assetUrl(html, name, origin);
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
  const images = [];
  for (let start = 0; start < RANCH_IMAGES.length; start += 12) {
    images.push(...await Promise.all(RANCH_IMAGES.slice(start, start + 12).map(async (name) => {
      const result = await fetchBytes(`${origin}/assets/tribute-ranch/${name}?v=${RANCH_ASSET_KEY}`);
      return { name, status: result.status, ok: result.status === 200 && /image\/webp/i.test(result.contentType) && hashBytes(result.body) === expected.images[name] };
    })));
  }
  const badImages = images.filter((entry) => !entry.ok);
  return {
    origin, indexOk, previousMarkers, files, excluded, images: { checked: images.length, bad: badImages },
    ok: indexOk && previousMarkers && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404) && !badImages.length,
  };
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const client = committed(commit, "tribute.js");
  const versions = Object.fromEntries(["tribute-core.mjs", "tribute-share.mjs", "tribute-deco.mjs"].map((name) => [name, moduleVersion(client, name)]));
  if (Object.values(versions).some((version) => !version)) throw new Error("the ranch modules are not imported with cache keys");
  const stale = CHANGED_MODULES.filter((name) => !versions[name].endsWith(MARKER));
  if (stale.length) throw new Error(`the cache keys of ${stale.join(", ")} do not end with ${MARKER}`);
  const expected = {
    html: sha256LF(committed(commit, "index.html")),
    versions,
    text: Object.fromEntries([...CHANGED_FILES, ...UNCHANGED_FILES, ...Object.keys(versions)].map((file) => [file, sha256LF(committed(commit, file))])),
    images: Object.fromEntries(RANCH_IMAGES.map((name) => [name, hashBytes(committedBytes(commit, `assets/tribute-ranch/${name}`))])),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce).catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, commit, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
