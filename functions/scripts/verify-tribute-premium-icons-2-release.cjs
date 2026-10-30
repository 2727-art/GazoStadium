"use strict";

// Read-only public delivery check for the second batch of paid ranch icons (ranch-premium-icons-v2): avatar 43-48,
// 500 Pay each. The same release replaces the gold frame with the owner's sigil border and an edge hologram drawn by
// tribute.css and tribute-share.mjs, and remakes all 13 paid icons (36-48) without the baked-in sparkles. On the public
// routes tribute.js, tribute.css, online.js and account.js changed (account.js only for a cache key), with
// tribute-core.mjs, tribute-deco.mjs, tribute-share.mjs and shop-products.mjs. All 48 manager icons and all 549 ranch
// images must match the files committed at HEAD. No sign-in, game APIs, production data access, or filesystem writes.
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "ranch-premium-icons-v2";
const RANCH_ASSET_KEY = "ranch-growth-v1";
const AVATAR_COUNT = 48;
const NEW_AVATARS = Object.freeze([43, 44, 45, 46, 47, 48]);
// キャッシュキーが今回の印で終わるファイルと、前回のまま中身も同じであるべきファイル。
const CHANGED_FILES = Object.freeze(["tribute.js", "tribute.css", "online.js", "account.js"]);
const UNCHANGED_FILES = Object.freeze(["app.js", "achievements.js"]);
// tribute.js が読むモジュールは、どれもキャッシュキーが今回の印で終わる。
const CHANGED_MODULES = Object.freeze(["tribute-core.mjs", "tribute-share.mjs", "tribute-deco.mjs"]);
const PREVIOUS_MARKERS = Object.freeze(["ranch-achievements-v1", "ranch-photo-v1", "ranch-pat-v1", "ranch-peek-v1", "ranch-growth-v1", "ranch-pasture-v1", "ranch-reception-card-v1", "ranch-contest-v1", "ranch-othello-v1", "ranch-served-days-v1", "ranch-style-words-v1", "ranch-styles-v1", "ranch-safari-regex-v1", "ranch-report-marks-v1", "ranch-recite-v1", "ranch-premium-icons-v1", "ranch-hold-v1", "ranch-wallet-words-v1", "ranch-cheers-v1", "ranch-activity-optin-v1", "ranch-first-steps-v1", "ranch-work-orders-v1", "ranch-double-pay-refund-v1", "ranch-request-fix-v1", "ranch-thread-ux-v1", "ranch-screenshot-v1", "ranch-free-talk-v1", "ranch-nav-v1", "ranch-vault-v1", "my-stadium-v1"]);
const ENTRY_PATHS = Object.freeze(["/", "/?ranch=000000000000000000000000", "/?open=ranch"]);
const PRIVATE = Object.freeze([
  "/TRIBUTE_DESIGN.md",
  "/firebase.json",
  "/database.rules.json",
  "/wrangler.jsonc",
  "/functions/tribute-rules.js",
  "/functions/product-catalog.js",
  "/functions/scripts/verify-tribute-premium-icons-2-release.cjs",
  "/functions/test/tribute-premium-icons-2.test.js",
  "/functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json",
  "/functions/docs/tribute-premium-icons-preview.png",
  "/functions/docs/TRIBUTE_RANCH_ACHIEVEMENTS_RELEASE.md",
  "/tools/tribute-avatars/premium-icons.py",
  "/art/tribute-ranch/render_ranch.py",
]);
const TIMEOUT_MS = 20_000;

const AVATARS = Object.freeze(Array.from({ length: AVATAR_COUNT }, (_, index) => `avatar-${String(index + 1).padStart(2, "0")}.webp`));
// 牧場の絵（背景30段階・動物6種 × しぐさ5つ × なつき5段階・小物3つ、それぞれ昼・夕方・夜）。中身はバイトのまま比べる。
const RANCH_IMAGES = Object.freeze(["day", "evening", "night"].flatMap((time) => [
  ...Array.from({ length: 30 }, (_, index) => `ranch-lv${index + 1}-${time}.webp`),
  ...["cow", "pig", "sheep", "goat", "chicken", "rabbit"].flatMap((animal) => ["stand", "walk1", "walk2", "eat", "sleep"].flatMap((pose) => [0, 1, 2, 3, 4].map((tier) => `${animal}-${pose}${tier ? `-t${tier}` : ""}-${time}.webp`))),
  ...["letter", "hay", "stake"].map((prop) => `prop-${prop}-${time}.webp`),
]));

function committedBytes(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function committed(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store" });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: Buffer.from(await response.arrayBuffer()) };
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

// 静的な import（from "./x.mjs?v=…"）と、あとで読む import("./x.mjs?v=…") の両方を見る。
function moduleVersion(source, name) {
  return source.match(new RegExp(`(?:from |import\\()"\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
}

const hashBytes = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const isScript = (result) => /javascript|ecmascript/i.test(result.contentType);

// tribute.css は data-src、tribute.js・online.js・account.js は機能の一覧（featureManifest）に載る。
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
  const check = async (folder, names, key) => {
    const results = [];
    for (let start = 0; start < names.length; start += 12) {
      results.push(...await Promise.all(names.slice(start, start + 12).map(async (name) => {
        const result = await fetchBytes(`${origin}/assets/${folder}/${name}${key ? `?v=${key}` : ""}`);
        return { name, status: result.status, ok: result.status === 200 && /image\/webp/i.test(result.contentType) && hashBytes(result.body) === expected.images[`${folder}/${name}`] };
      })));
    }
    return results;
  };
  const avatars = await check("tribute-avatars", AVATARS, "");
  const images = await check("tribute-ranch", RANCH_IMAGES, RANCH_ASSET_KEY);
  const badAvatars = avatars.filter((entry) => !entry.ok);
  const badImages = images.filter((entry) => !entry.ok);
  return {
    origin, indexOk, previousMarkers, files, excluded,
    avatars: { checked: avatars.length, bad: badAvatars },
    images: { checked: images.length, bad: badImages },
    ok: indexOk && previousMarkers && files.every((entry) => entry.ok) && excluded.every((entry) => entry.status === 404) && !badAvatars.length && !badImages.length,
  };
}

async function main() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
  const client = committed(commit, "tribute.js");
  const online = committed(commit, "online.js");
  const versions = {
    ...Object.fromEntries(CHANGED_MODULES.map((name) => [name, moduleVersion(client, name)])),
    "shop-products.mjs": moduleVersion(online, "shop-products.mjs"),
  };
  if (Object.values(versions).some((version) => !version)) throw new Error("the ranch modules are not imported with cache keys");
  const stale = Object.entries(versions).filter(([, version]) => !version.endsWith(MARKER)).map(([name]) => name);
  if (stale.length) throw new Error(`the cache keys of ${stale.join(", ")} do not end with ${MARKER}`);
  // 画面・ストア・共有画像は、同じ URL で tribute-deco.mjs を読む（ブラウザでは1つのモジュール）。
  const decoKeys = new Set([client, online, committed(commit, "tribute-share.mjs"), committed(commit, "shop-products.mjs")].map((source) => moduleVersion(source, "tribute-deco.mjs")));
  if (decoKeys.size !== 1) throw new Error("tribute-deco.mjs is imported with different cache keys");
  const expected = {
    html: sha256LF(committed(commit, "index.html")),
    versions,
    text: Object.fromEntries([...CHANGED_FILES, ...UNCHANGED_FILES, ...Object.keys(versions)].map((file) => [file, sha256LF(committed(commit, file))])),
    images: Object.fromEntries([
      ...AVATARS.map((name) => `tribute-avatars/${name}`),
      ...RANCH_IMAGES.map((name) => `tribute-ranch/${name}`),
    ].map((name) => [name, hashBytes(committedBytes(commit, `assets/${name}`))])),
  };
  const nonce = Date.now();
  const routes = await Promise.all(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce).catch((error) => ({ origin, ok: false, error: error.message }))));
  const result = { checkedAt: new Date().toISOString(), readOnly: true, marker: MARKER, commit, newAvatars: NEW_AVATARS, routes, ok: routes.every((route) => route.ok) };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
