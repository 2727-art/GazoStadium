"use strict";

// Read-only public delivery verification. Run after the intended Hosting release.
// No sign-in, game APIs, production data access, or filesystem writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ORIGINS, sha256LF, assetReference } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const MARKER = "hero-image-v1";
const ASSETS = ["app.js", "velvet.css"];
const IMAGE = Object.freeze({
  src: "assets/landing/hero-example.d9a004076802.png", bytes: 38093,
  sha256: "d9a00407680297c6b33868c9b12b42165dd94437b54ff9fe66b70bfbdfe414a0",
  width: 360, height: 270,
});
const PRIVATE = ["/firebase.json", "/functions/scripts/verify-hero-image-release.cjs", "/README.md", "/_headers"];
const ALLOWED_PATHS = new Set(["/", ...ASSETS.map((file) => "/" + file), "/" + IMAGE.src, ...PRIVATE]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function attribute(tag, name) {
  return tag.match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"))?.[2] ?? null;
}

function heroDetails(body) {
  const starts = [...body.matchAll(/<div\b[^>]*>/gi)].filter((match) =>
    (attribute(match[0], "class") || "").split(/\s+/).includes("vl-hero-thread"));
  if (starts.length !== 1) return { ok: false, error: "Expected exactly one hero thread" };
  let depth = 0;
  let hero = null;
  const start = starts[0].index;
  for (const tag of body.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0) {
      hero = body.slice(start, start + tag.index + tag[0].length);
      break;
    }
  }
  if (!hero) return { ok: false, error: "Unclosed hero thread" };
  const images = [...hero.matchAll(/<img\b[^>]*>/gi)];
  const image = images[0]?.[0] || "";
  const checks = {
    oneImage: images.length === 1,
    expectedSource: attribute(image, "src") === IMAGE.src,
    expectedDimensions: attribute(image, "width") === String(IMAGE.width)
      && attribute(image, "height") === String(IMAGE.height),
    photoClass: (attribute(image, "class") || "").split(/\s+/).includes("ha-photo"),
    noPlaceholderOrAvatar: !/ha-avatar|小|is-placeholder/.test(hero),
    score90: /class=["']ha-score-number["']\s*>90<small>点<\/small>/.test(hero)
      && hero.includes("っ…90点。ずるい…♡") && hero.includes("こちらが90点で返す。"),
    meter90: /Array\.from\(\{\s*length:\s*10\s*\}/.test(body)
      && /score\s*<=\s*9\s*\?\s*`is-on is-\$\{band\}`/.test(body),
  };
  return { src: attribute(image, "src"), checks, ok: Object.values(checks).every(Boolean) };
}

function invariant(file, body) {
  if (file === "app.js") return heroDetails(body).ok;
  if (file === "velvet.css") {
    const rule = body.match(/\.vl-hero-thread\s+img\.ha-photo\s*\{([^}]*)\}/)?.[1] || "";
    return /max-width:\s*100%\s*;/.test(rule) && /height:\s*auto\s*;/.test(rule)
      && /object-fit:\s*contain\s*;/.test(rule);
  }
  return false;
}

function cachePolicy(value, immutableImage = false) {
  const directives = String(value).toLowerCase().split(",").map((part) => part.trim());
  const ages = directives.flatMap((part) => {
    const match = part.match(/^(max-age|s-maxage)\s*=\s*"?(\d+)"?$/);
    return match ? [{ name: match[1], value: Number(match[2]) }] : [];
  });
  if (immutableImage) return directives.includes("public") && directives.includes("immutable")
    && !directives.some((part) => /^(?:private|no-store|no-cache)(?:\s*=|$)/.test(part))
    && ages.filter((age) => age.name === "max-age").length === 1
    && ages.some((age) => age.name === "max-age" && age.value === 31536000);
  return !directives.some((part) => /^immutable(?:\s*=|$)/.test(part))
    && ages.every((age) => age.value < 31536000);
}

// One shared limiter bounds all origins, HTML, referenced assets, and exclusions.
function createLimiter(maximum) {
  let active = 0;
  const waiting = [];
  return async (operation) => {
    if (active >= maximum) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try { return await operation(); }
    finally {
      if (waiting.length) waiting.shift()();
      else active -= 1;
    }
  };
}
const limited = createLimiter(CONCURRENCY);

async function read(url) {
  const target = new URL(url);
  if (!ORIGINS.includes(target.origin) || !ALLOWED_PATHS.has(target.pathname)
      || target.username || target.password) throw new Error("URL outside public verification scope");
  return limited(async () => {
    const started = Date.now();
    try {
      const response = await fetch(target.href, {
        signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body || []) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BODY_BYTES) throw new Error("Response exceeds verification size limit");
        chunks.push(Buffer.from(chunk));
      }
      return {
        url: target.href, status: response.status, contentType: response.headers.get("content-type") || "",
        cacheControl: response.headers.get("cache-control") || "", etag: response.headers.get("etag"),
        bytes, body: Buffer.concat(chunks), elapsedMs: Date.now() - started,
      };
    } catch (error) {
      return { url: target.href, status: null, error: error.message, elapsedMs: Date.now() - started };
    }
  });
}

function metadata(response) {
  const { body, ...result } = response;
  return result;
}

function mimeIs(response, expected) {
  return expected.test((response.contentType || "").split(";", 1)[0].trim());
}

function textCheck(response, expected, mime) {
  const actual = response.body ? sha256LF(response.body.toString("utf8")) : null;
  const cachePolicyOk = cachePolicy(response.cacheControl);
  return {
    ...metadata(response), actualSha256LF: actual, expectedSha256LF: expected, cachePolicyOk,
    ok: response.status === 200 && mimeIs(response, mime) && actual === expected && cachePolicyOk,
  };
}

async function localExpectations(sourceCommit) {
  const expected = {};
  for (const file of ["index.html", ...ASSETS, IMAGE.src]) {
    const body = await fs.readFile(path.join(ROOT, file));
    const committed = execFileSync("git", ["show", sourceCommit + ":" + file], {
      cwd: ROOT, timeout: 10_000, windowsHide: true, maxBuffer: MAX_BODY_BYTES,
    });
    if (file === IMAGE.src) {
      if (body.length !== IMAGE.bytes || sha256(body) !== IMAGE.sha256 || sha256(committed) !== IMAGE.sha256) {
        throw new Error("Local image differs from the authorized source commit or original image");
      }
    } else {
      const text = body.toString("utf8");
      expected[file] = sha256LF(text);
      if (expected[file] !== sha256LF(committed.toString("utf8"))) {
        throw new Error("Local public file differs from the authorized source commit: " + file);
      }
      if (ASSETS.includes(file) && !invariant(file, text)) throw new Error("Local invariant failed: " + file);
      if (file === "index.html" && !ASSETS.every((name) => {
        const reference = assetReference(text, name, ORIGINS[0]);
        return reference && new URL(reference).searchParams.get("v")?.includes(MARKER);
      })) throw new Error("Local HTML is missing a marked asset reference");
    }
  }
  return expected;
}

async function verifyOrigin(origin, expected, nonce) {
  const pages = await Promise.all([read(origin + "/"), read(origin + "/?releaseCheck=" + nonce)]);
  const index = pages.map((page) => textCheck(page, expected["index.html"], /^text\/html$/i));
  const assetResults = await Promise.all(ASSETS.map(async (file) => {
    const results = await Promise.all(pages.map(async (page, variant) => {
      const reference = assetReference(page.body?.toString("utf8") || "", file, origin);
      if (!reference) return { check: { sourcePageUrl: page.url, ok: false, error: "Missing HTML asset reference" } };
      const markerPresent = new URL(reference).searchParams.get("v")?.includes(MARKER) === true;
      const target = new URL(reference);
      if (variant === 1) target.searchParams.set("releaseCheck", nonce);
      const response = await read(target.href);
      const text = response.body?.toString("utf8") || "";
      const mime = file.endsWith(".css") ? /^text\/css$/i : /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)$/i;
      const check = textCheck(response, expected[file], mime);
      const invariantOk = invariant(file, text);
      const hero = file === "app.js" ? heroDetails(text) : null;
      return { hero, check: { ...check, sourcePageUrl: page.url, referencedUrl: reference,
        markerPresent, invariantOk, ...(hero ? { hero } : {}), ok: check.ok && markerPresent && invariantOk } };
    }));
    return { file, results };
  }));
  const assets = assetResults.map(({ file, results }) => ({
    file, responses: results.map((result) => result.check), ok: results.every((result) => result.check.ok),
  }));
  const appResults = assetResults.find((asset) => asset.file === "app.js").results;
  const imageUrls = appResults.map((result) => result.hero?.src ? new URL(result.hero.src, origin + "/") : null);
  let image = { ok: false, error: "Hero image is missing, mismatched, or outside this origin" };
  if (imageUrls.every((url) => url?.origin === origin && url.pathname === "/" + IMAGE.src
      && !url.search && !url.hash) && imageUrls[0].href === imageUrls[1].href) {
    // Fetch exactly the src resolved from both delivered app.js variants; no invented query.
    const response = await read(imageUrls[0].href);
    const actualHash = response.body ? sha256(response.body) : null;
    const cachePolicyOk = cachePolicy(response.cacheControl, true);
    image = {
      ...metadata(response), referencedByAppVariants: appResults.length,
      expectedBytes: IMAGE.bytes, expectedSha256: IMAGE.sha256, actualSha256: actualHash, cachePolicyOk,
      ok: response.status === 200 && mimeIs(response, /^image\/png$/i)
        && response.bytes === IMAGE.bytes && actualHash === IMAGE.sha256 && cachePolicyOk,
    };
  }
  const excluded = await Promise.all(PRIVATE.map(async (file) => {
    const response = await read(origin + file);
    return { file, ...metadata(response), ok: response.status === 404 };
  }));
  return { origin, index, assets, image, excluded,
    ok: index.every((check) => check.ok) && assets.every((check) => check.ok)
      && image.ok && excluded.every((check) => check.ok) };
}

async function main() {
  const report = { sourceCommit: null, checkedAt: new Date().toISOString(),
    readOnly: true, productionDataAccessed: false, marker: MARKER,
    timeoutMs: TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES, concurrency: CONCURRENCY, routes: [], ok: false };
  try {
    report.sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT, encoding: "utf8", timeout: 10_000, windowsHide: true,
    }).trim();
    const expected = await localExpectations(report.sourceCommit);
    const nonce = Date.now() + "-" + crypto.randomUUID();
    const settled = await Promise.allSettled(ORIGINS.map((origin) => verifyOrigin(origin, expected, nonce)));
    report.routes = settled.map((result, index) => result.status === "fulfilled" ? result.value
      : { origin: ORIGINS[index], ok: false, error: String(result.reason?.message || result.reason) });
    report.ok = report.routes.every((route) => route.ok);
  } catch (error) { report.error = error.message; }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
  return report;
}

module.exports = { invariant, heroDetails, cachePolicy, main };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
