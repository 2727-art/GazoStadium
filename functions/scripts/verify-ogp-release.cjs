"use strict";

// Read-only public verification after Hosting deployment. JSON stdout only.
// No sign-in, game APIs, production data access, or filesystem writes.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { ORIGINS, sha256LF } = require("./verify-player-safety-release.cjs");

const ROOT = path.resolve(__dirname, "../..");
const CANONICAL = "https://gazostadium.anjugames.workers.dev/";
const WORKER = new URL(CANONICAL).origin;
const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 5_000_000;
const USER_AGENT = "Twitterbot/1.0";
const TITLE = "貼り合いスタジアム";
const DESCRIPTION = "好きな画像で通常型・戦略型1on1、AI文字コラやルーレットのソロトレーニングを楽しめる画像ゲーム。";
const EXPECTED_META = Object.freeze({
  "og:type": "website",
  "og:url": CANONICAL,
  "og:title": TITLE,
  "og:description": DESCRIPTION,
  "og:image": `${CANONICAL}ogp.png`,
  "og:image:width": "1200",
  "og:image:height": "630",
  "og:image:type": "image/png",
  "twitter:card": "summary_large_image",
  "twitter:title": TITLE,
  "twitter:description": DESCRIPTION,
  "twitter:image": `${CANONICAL}ogp.png`,
});
const ALLOWED_URLS = new Set([
  ...ORIGINS.flatMap((origin) => [`${origin}/`, `${origin}/ogp.png`]),
  `${WORKER}/?v=2`, `${WORKER}/robots.txt`,
]);

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const mimeIs = (type, expected) => String(type || "").split(";", 1)[0].trim().toLowerCase() === expected;
const attributes = (tag) => Object.fromEntries(
  Array.from(tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (match) => [
    match[1].toLowerCase(), match[2] ?? match[3],
  ]),
);

function inspectHtml(source) {
  const html = String(source).replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const heads = Array.from(html.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/gi));
  const head = heads[0]?.[1] || "";
  const metas = (text) => Array.from(text.matchAll(/<meta\b[^>]*>/gi), ([tag]) => attributes(tag));
  const allMetas = metas(html);
  const headMetas = metas(head);
  const values = {};
  const counts = {};
  const issues = heads.length === 1 ? [] : ["Expected exactly one initial HTML head"];
  for (const key of [...Object.keys(EXPECTED_META), "og:image:alt"]) {
    const matches = (meta) => meta.property === key || meta.name === key;
    const inHead = headMetas.filter(matches);
    counts[key] = { document: allMetas.filter(matches).length, head: inHead.length };
    values[key] = inHead[0]?.content ?? null;
    if (counts[key].document !== 1 || counts[key].head !== 1) issues.push(`${key}: expected one static head element`);
    const attribute = key.startsWith("og:") ? "property" : "name";
    if (inHead[0]?.[attribute] !== key) issues.push(`${key}: missing ${attribute} attribute`);
    if (key === "og:image:alt") {
      if (!values[key]?.trim()) issues.push(`${key}: alternative text is empty`);
    } else if (values[key] !== EXPECTED_META[key]) issues.push(`${key}: content differs from the required value`);
  }
  const canonicalLinks = Array.from(head.matchAll(/<link\b[^>]*>/gi), ([tag]) => attributes(tag))
    .filter((link) => (link.rel || "").split(/\s+/).includes("canonical"));
  if (canonicalLinks.length > 1 || canonicalLinks.some((link) => link.href !== CANONICAL)) {
    issues.push("The optional canonical link must be unique and use the public canonical URL");
  }
  return { headCount: heads.length, values, counts, canonicalLinks: canonicalLinks.map((link) => link.href), issues, ok: issues.length === 0 };
}

function inspectPng(body) {
  const headerPresent = Buffer.isBuffer(body) && body.length >= 33;
  const signatureOk = headerPresent && body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const ihdrOk = headerPresent && body.readUInt32BE(8) === 13 && body.subarray(12, 16).toString("ascii") === "IHDR";
  const width = headerPresent ? body.readUInt32BE(16) : null;
  const height = headerPresent ? body.readUInt32BE(20) : null;
  const sizeOk = headerPresent && body.length < MAX_BODY_BYTES;
  return { signatureOk, ihdrOk, width, height, sizeOk, ok: signatureOk && ihdrOk && sizeOk && width === 1200 && height === 630 };
}

async function readPublic(url, fetchImpl = fetch) {
  if (!ALLOWED_URLS.has(url)) throw new Error("URL outside the fixed public verification scope");
  const startedAt = Date.now();
  let details = { url, status: null };
  try {
    const response = await fetchImpl(url, {
      method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "User-Agent": USER_AGENT, "Cache-Control": "no-cache", Accept: "*/*" },
    });
    details = {
      url, status: response.status, contentType: response.headers.get("content-type") || "",
      cacheControl: response.headers.get("cache-control") || "", etag: response.headers.get("etag"),
    };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      await response.body?.cancel();
      throw new Error("Response exceeds the five-megabyte verification limit");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body || []) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error("Response exceeds the five-megabyte verification limit");
      chunks.push(Buffer.from(chunk));
    }
    return { ...details, bytes, body: Buffer.concat(chunks), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ...details, error: error.name === "TimeoutError" ? "request timeout" : error.message, elapsedMs: Date.now() - startedAt };
  }
}

function responseDetails(response) {
  const { body, ...details } = response;
  return details;
}

function checkHtml(response, expectedHash) {
  const html = response.body?.toString("utf8") || "";
  const actualHash = response.body ? sha256LF(html) : null;
  const metadata = inspectHtml(html);
  return {
    ...responseDetails(response), expectedSha256LF: expectedHash, actualSha256LF: actualHash, metadata,
    ok: response.status === 200 && mimeIs(response.contentType, "text/html") && actualHash === expectedHash && metadata.ok,
  };
}

function checkImage(response, expectedHash) {
  const actualHash = response.body ? sha256(response.body) : null;
  const png = inspectPng(response.body);
  const cacheDirectives = String(response.cacheControl || "").toLowerCase().split(",").map((value) => value.trim());
  const cachePolicyOk = !cacheDirectives.some((directive) => /^immutable(?:\s*=|$)/.test(directive)
    || Number(directive.match(/^(?:s-maxage|max-age)\s*=\s*"?(\d+)"?$/)?.[1] || 0) >= 31_536_000);
  return {
    ...responseDetails(response), expectedSha256: expectedHash, actualSha256: actualHash, png, cachePolicyOk,
    ok: response.status === 200 && mimeIs(response.contentType, "image/png") && actualHash === expectedHash && png.ok && cachePolicyOk,
  };
}

function inspectRobots(response) {
  const text = response.body?.toString("utf8") || "";
  const htmlFallback = response.status === 200 && (mimeIs(response.contentType, "text/html")
    || /<!doctype\s+html\b|<html\b|<head\b|<body\b/i.test(text));
  const plainText = response.status === 200 && mimeIs(response.contentType, "text/plain") && !htmlFallback && !response.error;
  const absent = response.status === 404 && !response.error;
  const directives = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => /^(?:user-agent|allow|disallow|sitemap|crawl-delay)\s*:/i.test(line));
  return {
    ...responseDetails(response), classification: htmlFallback ? "html_fallback" : plainText ? "robots_text" : absent ? "not_found" : "unexpected_response",
    text: text.slice(0, 16_384), textTruncated: text.length > 16_384, directives,
    policyEvaluation: "Reported for review; crawler allow/disallow policy is not interpreted automatically.",
    ok: plainText || absent,
  };
}

async function verifyOrigin(origin, expected) {
  const pageUrls = [`${origin}/`, ...(origin === WORKER ? [`${origin}/?v=2`] : [])];
  const responses = await Promise.all([...pageUrls, `${origin}/ogp.png`].map((url) => readPublic(url)));
  const pages = responses.slice(0, pageUrls.length).map((response) => checkHtml(response, expected.htmlHash));
  const image = checkImage(responses.at(-1), expected.imageHash);
  return { origin, pages, image, ok: pages.every((page) => page.ok) && image.ok };
}

async function main() {
  const report = {
    checkedAt: new Date().toISOString(), readOnly: true, productionDataAccessed: false, userAgent: USER_AGENT,
    canonicalUrl: CANONICAL, timeoutMs: TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES,
    normalization: "HTML CRLF and CR converted to LF before SHA-256; PNG uses its original bytes",
    routes: [], robots: null, ok: false,
  };
  try {
    const [html, image] = await Promise.all([
      fs.readFile(path.join(ROOT, "index.html"), "utf8"), fs.readFile(path.join(ROOT, "ogp.png")),
    ]);
    const expected = { htmlHash: sha256LF(html), imageHash: sha256(image) };
    report.local = { htmlSha256LF: expected.htmlHash, imageSha256: expected.imageHash, imageBytes: image.length, metadata: inspectHtml(html), png: inspectPng(image) };
    if (!report.local.metadata.ok || !report.local.png.ok) throw new Error("Local OGP HTML or image validation failed before public requests");
    const settled = await Promise.allSettled([
      ...ORIGINS.map((origin) => verifyOrigin(origin, expected)),
      readPublic(`${WORKER}/robots.txt`).then(inspectRobots),
    ]);
    report.routes = settled.slice(0, ORIGINS.length).map((result, index) => result.status === "fulfilled"
      ? result.value : { origin: ORIGINS[index], ok: false, error: String(result.reason?.message || result.reason) });
    const robotsResult = settled.at(-1);
    report.robots = robotsResult.status === "fulfilled" ? robotsResult.value
      : { ok: false, error: String(robotsResult.reason?.message || robotsResult.reason) };
    report.ok = report.routes.every((route) => route.ok) && report.robots.ok;
  } catch (error) { report.error = error.message; }
  report.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
  return report;
}

module.exports = { inspectHtml, inspectPng, inspectRobots, readPublic, checkHtml, checkImage, main };
if (require.main === module) main();
