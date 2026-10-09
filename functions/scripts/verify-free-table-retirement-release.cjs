"use strict";

// Read-only public Hosting verification. No authentication, callable requests,
// production game-data access, file writes, or browser-side code execution.
// Default JSON output is a concise per-origin summary; --details adds hashes and
// individual responses. Parent should run this only after the Hosting release.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference, mapLimited } = require("./verify-player-safety-release.cjs");
const { localImageUrl, inspectHtml, inspectPng } = require("./verify-ogp-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const BASE_REF = "3c31c9c";
const MARKER = "retire-free-table-v1";
const PUBLIC_ASSETS = Object.freeze([
  "app.js", "online.js", "strategy.js", "ai-text-training.js", "roulette-training.js", "tribute.js",
]);
const PRESERVED_HTML_ASSETS = Object.freeze(["landing-hero.mjs", "velvet.css", "chat-persona.css", "strategy.css"]);
const PRESERVED_MODULES = Object.freeze([
  { file: "chat-persona.mjs", importer: "online.js" },
  { file: "chat-persona.mjs", importer: "strategy.js" },
  { file: "strategy-chat.mjs", importer: "strategy.js" },
  { file: "finish-roleplay.mjs", importer: "landing-hero.mjs" },
]);
const HERO_PATH = "assets/landing/hero-example.d9a004076802.png";
const PRIVATE_PATHS = Object.freeze([
  "/functions/index.js", "/functions/free-table.js", "/functions/retired-community-modes.js",
  "/functions/free-table-retirement.js", "/functions/free-table-retention.js",
  "/functions/scripts/retire-free-table-runtime.cjs",
  "/functions/scripts/verify-free-table-retirement-release.cjs",
  "/functions/test/free-table-retirement.test.js", "/database.rules.json", "/README.md",
]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const lf = (value) => String(value).replace(/\r\n?/g, "\n");
const git = (args, encoding = "utf8") => execFileSync("git", args, {
  cwd: ROOT, encoding, timeout: 10_000, windowsHide: true, maxBuffer: MAX_BODY_BYTES,
});

function parseOptions(argv) {
  const options = { details: false, timeoutMs: 20_000 };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (seen.has(arg)) throw new Error("Duplicate verification option");
    seen.add(arg);
    if (arg === "--details") options.details = true;
    else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 30_000) {
        throw new Error("--timeout-ms must be between 1000 and 30000");
      }
    } else throw new Error("Unsupported verification option");
  }
  return options;
}

function retiredLoadsAbsent(html, origin) {
  for (const match of String(html).matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const url = new URL(match[1].replace(/&amp;/g, "&"), `${origin}/`);
    if (/\/(?:free-table)\.(?:js|css)$/i.test(url.pathname)) return false;
  }
  return true;
}

function moduleReference(source, importerUrl, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(source).match(new RegExp(`from\\s+["'](\\./${escaped}(?:\\?[^"']*)?)["']`));
  return match ? new URL(match[1], importerUrl).href : null;
}

function heroAndShareSection(source) {
  const normalized = lf(source);
  const start = normalized.indexOf('<div class="vl-hero">');
  const end = normalized.indexOf('<section class="vl-board"', start);
  if (start < 0 || end <= start) throw new Error("Hero/share source section is missing");
  return normalized.slice(start, end);
}

async function loadExpected() {
  const html = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const image = localImageUrl(html);
  const baselineHtml = git(["show", `${BASE_REF}:index.html`]);
  const legacyFreeTableUrl = assetReference(baselineHtml, "free-table.js", ORIGINS[0]);
  if (!legacyFreeTableUrl) throw new Error("Baseline free-table module reference is missing");
  if (localImageUrl(baselineHtml).url !== image.url || !inspectHtml(html, image.url).ok) {
    throw new Error("Local OGP metadata changed or failed its existing invariant");
  }
  if (!retiredLoadsAbsent(html, ORIGINS[0])) throw new Error("Local HTML still loads retired free-table assets");
  const textFiles = [...new Set([...PUBLIC_ASSETS, ...PRESERVED_HTML_ASSETS,
    ...PRESERVED_MODULES.map(({ file }) => file), "free-table.js"])];
  const source = Object.fromEntries(await Promise.all(textFiles.map(async (file) => [file,
    await fs.readFile(path.join(ROOT, file), "utf8")])));
  if (!/const\s+FREE_TABLE_RETIRED\s*=\s*true\s*;/.test(source["free-table.js"])
      || !source["app.js"].includes("function clearRetiredFreeTableInvite(")
      || !source["app.js"].includes("貼り合い自由卓は終了しました")
      || /id=["']freeTableButton["']/.test(source["app.js"])) {
    throw new Error("Local retirement invariant failed");
  }
  const preservedTextFiles = [...new Set([...PRESERVED_HTML_ASSETS, ...PRESERVED_MODULES.map(({ file }) => file)])];
  for (const file of preservedTextFiles) {
    if (sha256LF(git(["show", `${BASE_REF}:${file}`])) !== sha256LF(source[file])) {
      throw new Error(`Preserved hero/share asset changed locally: ${file}`);
    }
  }
  const heroSectionHash = sha256LF(heroAndShareSection(source["app.js"]));
  if (heroSectionHash !== sha256LF(heroAndShareSection(git(["show", `${BASE_REF}:app.js`])))) {
    throw new Error("Hero/share preview changed locally");
  }
  const images = [HERO_PATH, image.path];
  const imageHashes = Object.fromEntries(await Promise.all(images.map(async (file) => {
    const bytes = await fs.readFile(path.join(ROOT, file));
    const hash = sha256(bytes);
    if (hash !== sha256(git(["show", `${BASE_REF}:${file}`], null))) throw new Error(`Preserved image changed locally: ${file}`);
    return [file, hash];
  })));
  return { htmlHash: sha256LF(html), hashes: Object.fromEntries(textFiles.map((file) => [file, sha256LF(source[file])])),
    images, imageHashes, imageUrl: image.url, heroSectionHash,
    legacyFreeTablePath: new URL(legacyFreeTableUrl).pathname + new URL(legacyFreeTableUrl).search,
    sourceCommit: git(["rev-parse", "HEAD"]).trim(),
    localPreservation: { baseRef: BASE_REF, heroAndSharePreviewUnchanged: true,
      unchangedTextAssets: preservedTextFiles.length, unchangedImages: images.length, ogpMetadataUnchanged: true } };
}

function withNonce(url, nonce) {
  const target = new URL(url);
  target.searchParams.set("releaseCheck", String(nonce));
  return target.href;
}

function createReader(expected, timeoutMs, fetchImpl = fetch) {
  const paths = new Set(["/", ...Object.keys(expected.hashes).map((file) => `/${file}`),
    ...expected.images.map((file) => `/${file}`), ...PRIVATE_PATHS]);
  return async function read(url) {
    const target = new URL(url);
    if (!ORIGINS.includes(target.origin) || !paths.has(target.pathname) || target.username || target.password) {
      throw new Error("URL outside fixed public verification scope");
    }
    const response = await fetchImpl(target.href, { method: "GET", credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store", headers: { "Cache-Control": "no-cache", Accept: "*/*" } });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error("Response exceeds verification size limit");
      chunks.push(Buffer.from(chunk));
    }
    return { url: target.href, status: response.status, contentType: response.headers.get("content-type") || "",
      body: Buffer.concat(chunks), bytes };
  };
}

async function verifyOrigin(origin, expected, { timeoutMs = 20_000, nonce = Date.now(), fetchImpl = fetch } = {}) {
  const read = createReader(expected, timeoutMs, fetchImpl);
  const pages = await Promise.all([
    read(`${origin}/`), read(withNonce(`${origin}/`, nonce)),
    read(withNonce(`${origin}/?freeTableInvite=${"A".repeat(32)}`, nonce)),
  ]);
  const index = pages.map((page, position) => {
    const text = page.body.toString("utf8");
    const hash = sha256LF(text);
    const loadsAbsent = retiredLoadsAbsent(text, origin);
    const ogpPreserved = inspectHtml(text, expected.imageUrl).ok;
    return { variant: ["root", "cache-busted", "legacy-invite"][position], status: page.status,
      actualSha256LF: hash, retiredLoadsAbsent: loadsAbsent, ogpPreserved,
      ok: page.status === 200 && /text\/html/i.test(page.contentType) && hash === expected.htmlHash && loadsAbsent && ogpPreserved };
  });
  const bodies = {};
  const references = {};
  async function checkText(file, urls, markerRequired = false, explicitUrls = false) {
    if (urls.some((url) => !url || (markerRequired && !new URL(url).searchParams.get("v")?.includes(MARKER)))) {
      return { file, ok: false, reason: "missing actual asset reference or retirement cache marker" };
    }
    const unique = [...new Set(urls.map((url, position) => !explicitUrls && position ? withNonce(url, nonce) : url))];
    const fetched = await Promise.all(unique.map(read));
    const checks = fetched.map((response) => {
      const text = response.body.toString("utf8");
      const hash = sha256LF(text);
      const mime = file.endsWith(".css") ? /text\/css/i : /javascript|ecmascript/i;
      const invariant = file === "free-table.js" ? /const\s+FREE_TABLE_RETIRED\s*=\s*true\s*;/.test(text)
        : file === "app.js" ? sha256LF(heroAndShareSection(text)) === expected.heroSectionHash : true;
      return { url: response.url, status: response.status, actualSha256LF: hash, invariant,
        ok: response.status === 200 && mime.test(response.contentType) && hash === expected.hashes[file] && invariant };
    });
    bodies[file] = fetched.map((response) => response.body.toString("utf8"));
    references[file] = fetched.map((response) => response.url);
    return { file, references: urls, responses: checks, ok: checks.every((check) => check.ok) };
  }
  const htmlAssets = await mapLimited([...PUBLIC_ASSETS, ...PRESERVED_HTML_ASSETS], 4, async (file) => checkText(
    file, pages.map((page) => assetReference(page.body.toString("utf8"), file, origin)), PUBLIC_ASSETS.includes(file)));
  const modules = await mapLimited(PRESERVED_MODULES, 4, async ({ file, importer }) => {
    if (!bodies[importer] || !references[importer]) return { file, importer, ok: false, reason: "missing importer" };
    return { ...await checkText(file, bodies[importer].map((body, position) => moduleReference(body, references[importer][position], file))), importer };
  });
  const directFreeTable = `${origin}/free-table.js`;
  const legacyFreeTable = `${origin}${expected.legacyFreeTablePath}`;
  const staleClient = await checkText("free-table.js", [directFreeTable, withNonce(directFreeTable, nonce),
    legacyFreeTable, withNonce(legacyFreeTable, nonce)], false, true);
  const images = await mapLimited(expected.images, 3, async (file) => {
    const fetched = await Promise.all([read(`${origin}/${file}`), read(withNonce(`${origin}/${file}`, nonce))]);
    const checks = fetched.map((response) => {
      const hash = sha256(response.body);
      const pngOk = file === HERO_PATH ? response.body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
        : inspectPng(response.body).ok;
      return { status: response.status, actualSha256: hash,
        ok: response.status === 200 && /image\/png/i.test(response.contentType) && hash === expected.imageHashes[file] && pngOk };
    });
    return { file, responses: checks, ok: checks.every((check) => check.ok) };
  });
  const excluded = await mapLimited(PRIVATE_PATHS, 4, async (file) => {
    const response = await read(`${origin}${file}`);
    return { file, status: response.status, ok: response.status === 404 };
  });
  const assets = [...htmlAssets, ...modules];
  const failures = [
    ...index.filter((check) => !check.ok).map((check) => `html:${check.variant}`),
    ...assets.filter((check) => !check.ok).map((check) => `asset:${check.file}`),
    ...images.filter((check) => !check.ok).map((check) => `image:${check.file}`),
    ...excluded.filter((check) => !check.ok).map((check) => `private:${check.file}`),
    ...(!staleClient.ok ? ["stale-client:free-table.js"] : []),
  ];
  return { origin, ok: failures.length === 0,
    summary: { htmlVariants: index.length, changedAssets: PUBLIC_ASSETS.length,
      preservedAssetChecks: assets.length - PUBLIC_ASSETS.length, preservedImages: images.length,
      staleClientRetired: staleClient.ok, privatePaths404: excluded.filter((check) => check.ok).length,
      privatePathsChecked: excluded.length }, failures, index, assets, images, staleClient, excluded };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const expected = await loadExpected();
  const nonce = Date.now();
  const settled = await Promise.allSettled(ORIGINS.map((origin) => verifyOrigin(origin, expected, { ...options, nonce })));
  const routes = settled.map((result, index) => result.status === "fulfilled" ? result.value
    : { origin: ORIGINS[index], ok: false, failures: [String(result.reason?.message || "verification failed")] });
  const report = { checkedAt: new Date().toISOString(), readOnly: true, productionDataAccessed: false,
    sourceCommit: expected.sourceCommit, marker: MARKER,
    normalization: "Text SHA-256 after CRLF/CR to LF; image SHA-256 over raw bytes",
    localPreservation: expected.localPreservation, ok: routes.every((route) => route.ok),
    routes: options.details ? routes : routes.map(({ origin, ok, summary, failures }) => ({ origin, ok, summary, failures })),
    ...(options.details ? { expectedHashes: expected.hashes, expectedHtmlHash: expected.htmlHash,
      expectedImageHashes: expected.imageHashes } : {}),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

module.exports = { PUBLIC_ASSETS, PRIVATE_PATHS, BASE_REF, MARKER, parseOptions, retiredLoadsAbsent,
  moduleReference, heroAndShareSection, loadExpected, createReader, verifyOrigin, main };
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Free table public release verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
