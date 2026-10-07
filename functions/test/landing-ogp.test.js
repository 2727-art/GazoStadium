const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const canonicalUrl = "https://gazostadium.anjugames.workers.dev/";
// 共有画像は内容のSHA-256先頭12桁を名前に含める。差し替えるとURLが変わり、Xなどの取得済み画像が残らない。
const imagePattern = /^https:\/\/gazostadium\.anjugames\.workers\.dev\/assets\/ogp\/ogp\.([0-9a-f]{12})\.png$/;
const title = "貼り合いスタジアム";
const description = "DMじゃ物足りない貼り合いに。女の子になり切れる吹き出しで、推し画像を貼り合って刺さり具合を点で返す1on1。画像はサーバーに残りません。";

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

const sharedImage = () => {
  const url = metaContent(staticDocument(), "property", "og:image");
  const match = url.match(imagePattern);
  assert.ok(match, "og:image is the fingerprinted share card");
  return { url, hash: match[1], file: path.join(root, "assets", "ogp", `ogp.${match[1]}.png`) };
};

test("the initial HTML head provides one complete Open Graph website preview", () => {
  const document = staticDocument();
  const expected = {
    "og:type": "website",
    "og:url": canonicalUrl,
    "og:title": title,
    "og:description": description,
    "og:image": sharedImage().url,
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
  const imageUrl = sharedImage().url;
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
  const { file, hash } = sharedImage();
  const image = fs.readFileSync(file);
  assert.equal(crypto.createHash("sha256").update(image).digest("hex").slice(0, 12), hash, "the filename matches the image content");
  assert.ok(image.length >= 33, "the asset includes a complete PNG header");
  assert.ok(image.length < 5_000_000, "the share image remains below 5 MB");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the asset is a PNG");
  assert.equal(image.readUInt32BE(8), 13, "the PNG starts with a standard IHDR chunk");
  assert.equal(image.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test("the share card is rendered from a private template that keeps X's title corner clear", () => {
  const template = fs.readFileSync(path.join(root, "functions", "scripts", "ogp-card.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "functions", "scripts", "render-ogp.cjs"), "utf8");
  assert.match(renderer, /`ogp\.\$\{sha256\.slice\(0, 12\)\}\.png`/);
  assert.match(renderer, /--window-size=\$\{width\},\$\{height\}/);
  assert.ok(template.includes('src="../../assets/landing/hero-example.d9a004076802.png"'), "the card reuses the homepage sample image");
  assert.ok(fs.existsSync(path.join(root, "assets", "landing", "hero-example.d9a004076802.png")));
  assert.match(template, /<span class="tag">#貼り合い<\/span>/);
  assert.match(template, /DMじゃ物足りない貼り合いに。<br><em>女の子になり切れる吹き出し<\/em>で。/);
  // 左下は X がタイトルの札を重ねるので、チップは折り返さず1行に収める。
  assert.match(template, /\.chips \{ display: flex; gap: 10px; margin-top: 26px; \}/);
  assert.doesNotMatch(template, /https?:\/\/gazostadium|workers\.dev/, "the card image carries no site URL");
  assert.equal(fs.existsSync(path.join(root, "ogp.png")), false, "the old unversioned share image is retired");
  const ignore = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8")).hosting.ignore;
  assert.ok(ignore.includes("functions/**"), "the template and renderer stay out of Hosting");
});
