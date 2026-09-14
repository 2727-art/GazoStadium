"use strict";

// Read-only release verification. Run only after the intended Hosting release.
// Optional report: --out functions/docs/PLAYER_SAFETY_RELEASE_QA.json
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const BASE_REF = "92d5724";
const MARKER = "global-player-block-v1";
const ORIGINS = Object.freeze([
  "https://gazostadium.web.app",
  "https://gazostadium.firebaseapp.com",
  "https://gazostadium.anjugames.workers.dev",
]);
// Explicit list derived from `git diff --name-only 92d5724 --` for this release.
// A mismatch with that diff fails before any network request.
const PUBLIC_ASSETS = Object.freeze([
  "ai-text-training.js",
  "app.js",
  "danwaku-note.js",
  "flea-market.js",
  "free-table.js",
  "market.js",
  "online.js",
  "player-safety.css",
  "player-safety.js",
  "roulette-training.js",
  "strategy.js",
]);
const EXCLUDED_PATH = "/functions/player-safety.js";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function sha256LF(value) {
  return crypto.createHash("sha256").update(String(value).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function parseOptions(argv) {
  const options = { out: null, timeoutMs: 15000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out") {
      const destination = argv[++index];
      if (!destination) throw new Error("--out requires a JSON path under functions/docs");
      const docs = path.resolve(ROOT, "functions/docs");
      const resolved = path.resolve(ROOT, destination);
      const relative = path.relative(docs, resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.extname(resolved) !== ".json") {
        throw new Error("--out must resolve to a JSON file inside functions/docs");
      }
      options.out = resolved;
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 30000) {
        throw new Error("--timeout-ms must be between 1000 and 30000");
      }
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  return options;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 10000, windowsHide: true }).trim();
}

function verifyAssetScope() {
  const changed = git(["diff", "--name-only", BASE_REF, "--"])
    .split(/\r?\n/).filter((name) => /^[^/]+\.(?:js|css)$/.test(name)).sort();
  if (JSON.stringify(changed) !== JSON.stringify([...PUBLIC_ASSETS].sort())) {
    throw new Error(`Public asset scope differs from ${BASE_REF}; review the explicit release list. Diff: ${changed.join(", ")}`);
  }
}

function assetReference(html, name, origin) {
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const url = new URL(match[1].replace(/&amp;/g, "&"), `${origin}/`);
    if (url.origin === origin && url.pathname === `/${name}`) return url.href;
  }
  return null;
}

async function fetchText(url, timeoutMs) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      cache: "no-store",
      headers: { "cache-control": "no-cache", accept: "text/html,text/javascript,text/css,*/*;q=0.5" },
    });
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        throw new Error("Response exceeds the verification size limit");
      }
      chunks.push(Buffer.from(chunk));
    }
    return {
      url, status: response.status, contentType: response.headers.get("content-type") || "",
      bytes, text: Buffer.concat(chunks).toString("utf8"), elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { url, status: null, error: error.name === "TimeoutError" ? "request timeout" : error.message, elapsedMs: Date.now() - startedAt };
  }
}

async function mapLimited(values, concurrency, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await callback(values[index], index);
    }
  }));
  return results;
}

function withoutText(result) {
  const { text, ...metadata } = result;
  return metadata;
}

async function verifyOrigin(origin, expected, timeoutMs) {
  const indexResponse = await fetchText(`${origin}/`, timeoutMs);
  const html = indexResponse.text || "";
  const index = {
    ...withoutText(indexResponse),
    markerPresent: html.includes(MARKER),
    safetyButtonPresent: /id=["']playerSafetyButton["']/.test(html),
    expectedSha256LF: expected.indexHash,
    actualSha256LF: indexResponse.text === undefined ? null : sha256LF(html),
  };
  index.ok = index.status === 200 && /text\/html/i.test(index.contentType)
    && index.markerPresent && index.safetyButtonPresent && index.actualSha256LF === index.expectedSha256LF;
  const assets = await mapLimited(PUBLIC_ASSETS, 4, async (name) => {
    const url = assetReference(html, name, origin);
    const response = await fetchText(url || `${origin}/${name}`, timeoutMs);
    const actualHash = response.text === undefined ? null : sha256LF(response.text);
    const typeOk = name.endsWith(".css") ? /text\/css/i.test(response.contentType || "")
      : /(?:javascript|ecmascript)/i.test(response.contentType || "");
    return {
      name, ...withoutText(response), referencedByIndex: Boolean(url),
      expectedSha256LF: expected.assets[name], actualSha256LF: actualHash,
      ok: Boolean(url) && response.status === 200 && typeOk && actualHash === expected.assets[name],
    };
  });
  const excludedResponse = await fetchText(`${origin}${EXCLUDED_PATH}`, timeoutMs);
  const excluded = { ...withoutText(excludedResponse), ok: excludedResponse.status === 404 };
  return { origin, ok: index.ok && assets.every((asset) => asset.ok) && excluded.ok, index, assets, excluded };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  verifyAssetScope();
  const indexText = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
  const expected = { indexHash: sha256LF(indexText), assets: {} };
  for (const name of PUBLIC_ASSETS) expected.assets[name] = sha256LF(await fs.readFile(path.join(ROOT, name), "utf8"));
  const startedAt = new Date().toISOString();
  const settled = await Promise.allSettled(ORIGINS.map((origin) => verifyOrigin(origin, expected, options.timeoutMs)));
  const routes = settled.map((result, index) => result.status === "fulfilled" ? result.value
    : { origin: ORIGINS[index], ok: false, error: String(result.reason?.message || result.reason) });
  const report = {
    startedAt, finishedAt: new Date().toISOString(), baseRef: BASE_REF, localHead: git(["rev-parse", "HEAD"]),
    marker: MARKER, normalization: "CRLF and CR converted to LF before SHA-256", timeoutMs: options.timeoutMs,
    readOnly: true, publicAssets: PUBLIC_ASSETS, routes, ok: routes.every((route) => route.ok),
  };
  if (options.out) {
    await fs.mkdir(path.dirname(options.out), { recursive: true });
    await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  // Only verification metadata/hashes are printed; no response bodies or tokens.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

module.exports = { PUBLIC_ASSETS, ORIGINS, sha256LF, parseOptions, assetReference, mapLimited, main };
if (require.main === module) main().catch((error) => { process.stderr.write(`Verification failed: ${error.message}\n`); process.exitCode = 1; });
