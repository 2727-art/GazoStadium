const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const canonicalUrl = "https://gazostadium.anjugames.workers.dev/";
const imageUrl = `${canonicalUrl}ogp.png`;
const title = "貼り合いスタジアム";
const description = "好きな画像で通常型・戦略型1on1、AI文字コラやルーレットのソロトレーニングを楽しめる画像ゲーム。";

const attributes = (tag) => Object.fromEntries(
  Array.from(tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (match) => [
    match[1].toLowerCase(), match[2] ?? match[3],
  ]),
);

const staticDocument = () => {
  // A crawler must find real elements in the response, without executing scripts.
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const heads = Array.from(html.matchAll(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/gi));
  assert.equal(heads.length, 1, "the initial document has one head");
  return { html, head: heads[0][1] };
};

const metaContent = (document, attribute, key) => {
  const find = (html) => Array.from(html.matchAll(/<meta\b[^>]*>/gi), ([tag]) => attributes(tag))
    .filter((meta) => meta["property"] === key || meta["name"] === key);
  const all = find(document.html);
  const inHead = find(document.head);
  assert.equal(all.length, 1, `${key} appears exactly once in the initial document`);
  assert.equal(inHead.length, 1, `${key} is present in the static head`);
  assert.equal(inHead[0][attribute], key, `${key} uses the ${attribute} attribute`);
  assert.ok(inHead[0].content, `${key} has nonempty content`);
  return inHead[0].content;
};

test("the initial HTML head provides one complete Open Graph website preview", () => {
  const document = staticDocument();
  const expected = {
    "og:type": "website",
    "og:url": canonicalUrl,
    "og:title": title,
    "og:description": description,
    "og:image": imageUrl,
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:type": "image/png",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(metaContent(document, "property", key), value, key);
  }
  assert.ok(metaContent(document, "property", "og:image:alt").trim(), "the preview image has descriptive alternative text");
});

test("the initial HTML head provides a large Twitter image card with the same preview text and image", () => {
  const document = staticDocument();
  assert.equal(metaContent(document, "name", "twitter:card"), "summary_large_image");
  for (const key of ["title", "description", "image"]) {
    assert.equal(
      metaContent(document, "name", `twitter:${key}`),
      metaContent(document, "property", `og:${key}`),
      `Twitter and Open Graph ${key} match`,
    );
  }
});

test("preview URLs use the public canonical HTTPS origin without relative paths or cache queries", () => {
  const document = staticDocument();
  for (const [attribute, key, expected] of [
    ["property", "og:url", canonicalUrl],
    ["property", "og:image", imageUrl],
    ["name", "twitter:image", imageUrl],
  ]) {
    const value = metaContent(document, attribute, key);
    const url = new URL(value);
    assert.equal(url.protocol, "https:", `${key} is an absolute HTTPS URL`);
    assert.equal(url.href, expected, `${key} uses the canonical public URL`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
  const canonicalLinks = Array.from(document.head.matchAll(/<link\b[^>]*>/gi), ([tag]) => attributes(tag))
    .filter((link) => (link.rel || "").split(/\s+/).includes("canonical"));
  assert.ok(canonicalLinks.length <= 1, "an optional canonical link is not duplicated");
  for (const link of canonicalLinks) assert.equal(link.href, canonicalUrl);
});

test("the shared preview is a static 1200 by 630 PNG below five megabytes", () => {
  const image = fs.readFileSync(path.join(root, "ogp.png"));
  assert.ok(image.length >= 33, "the asset includes a complete PNG header");
  assert.ok(image.length < 5_000_000, "the share image remains below 5 MB");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the asset is a PNG");
  assert.equal(image.readUInt32BE(8), 13, "the PNG starts with a standard IHDR chunk");
  assert.equal(image.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
