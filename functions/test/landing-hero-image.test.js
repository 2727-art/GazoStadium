const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const imagePath = "assets/landing/hero-example.d9a004076802.png";
const imageSha256 = "d9a00407680297c6b33868c9b12b42165dd94437b54ff9fe66b70bfbdfe414a0";
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const heroExample = () => {
  const app = read("app.js");
  const start = app.indexOf('<div class="vl-hero-thread"');
  const end = app.indexOf('<div class="hero-actions">', start);
  assert.ok(start >= 0 && end > start, "homepage hero example exists");
  return app.slice(start, end);
};

test("the homepage hero shows the supplied image without the placeholder or circular avatar", () => {
  const hero = heroExample();
  const images = hero.match(/<img\b[^>]*>/g) || [];
  assert.equal(images.length, 1, "the hero displays one sample image");
  assert.match(images[0], /\bclass="ha-photo"/);
  assert.ok(images[0].includes(`src="${imagePath}"`), "the hero loads the local fingerprinted image");
  assert.match(images[0], /\bwidth="360"/);
  assert.match(images[0], /\bheight="270"/);
  assert.doesNotMatch(hero, /is-placeholder|class="ha-avatar"|>小<|<i><\/i>画像/);
  assert.ok(hero.includes("こちらが90点で返す。"), "the accessible example retains its 90-point reply");
  assert.ok(hero.includes('<b class="ha-score-number">90<small>点</small></b>っ…90点。'));
});

test("the fingerprinted hero asset preserves the supplied PNG bytes and dimensions", () => {
  const image = fs.readFileSync(path.join(root, imagePath));
  assert.equal(image.length, 38093, "the original attachment is preserved without re-encoding");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the asset is a PNG");
  assert.equal(image.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(image.readUInt32BE(16), 360);
  assert.equal(image.readUInt32BE(20), 270);
  assert.equal(crypto.createHash("sha256").update(image).digest("hex"), imageSha256);
  assert.ok(imagePath.includes(imageSha256.slice(0, 12)), "the filename changes when its content changes");
});

test("immutable Hosting caching is limited to the fingerprinted hero image", () => {
  const hosting = JSON.parse(read("firebase.json")).hosting;
  const cacheRules = (hosting.headers || []).flatMap((rule) =>
    (rule.headers || [])
      .filter((header) => header.key.toLowerCase() === "cache-control")
      .map((header) => ({ source: rule.source, value: header.value })),
  );
  assert.deepEqual(cacheRules, [{
    source: `/${imagePath}`,
    value: "public, max-age=31536000, immutable",
  }], "HTML, scripts, styles, and other image paths must not inherit the hero's immutable cache rule");
});

test("the homepage loads the updated hero markup and image styling cache versions", () => {
  const html = read("index.html");
  assert.match(html, /app\.js\?v=[^"]*hero-image-v1/);
  assert.match(html, /velvet\.css\?v=[^"]*hero-image-v1/);
});
