"use strict";

// お貢ぎ牧場の有料アイコンの3回目（49 キャラメル・50 漆黒・51 バニラ、2026-10-30）。1枚 500 Pay、四角に印の色の縁とホログラム。
// 続けて渡された4枚のうち、制服が見える3枚は入れていない。そのうち2枚は、ユーザーが服と背景を変えて作り直した
// （50・51）。設計書の有料アイコンの行に書いた。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const catalog = require("../product-catalog");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const loadDeco = () => import(pathToFileURL(path.join(root, "tribute-deco.mjs")).href);
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const MARKER = "-ranch-premium-icons-v3";
const NEW = Object.freeze({ 49: "キャラメル", 50: "漆黒", 51: "バニラ" });
const NEW_IDS = Object.keys(NEW).map(Number);

test("icons 49-51: the same numbers, products and prices on the server, in the store and on screen", async () => {
  const [deco, core] = await Promise.all([loadDeco(), loadCore()]);
  assert.equal(rules.AVATAR_MAX, 51);
  assert.equal(core.AVATAR_MAX, 51);
  for (const id of NEW_IDS) {
    const productId = `ranch_avatar_${id}`;
    assert.ok(rules.PREMIUM_AVATAR_IDS.includes(id), `rules ${id}`);
    assert.equal(rules.premiumAvatarProductId(id), productId);
    const product = Object.values(catalog).find((entry) => entry.id === productId);
    assert.deepEqual([product?.type, product?.price], ["ranchAvatar", 500], productId);
    assert.equal(deco.premiumAvatar(id)?.productId, productId);
    assert.match(deco.premiumAvatarUrl(id), new RegExp(`/assets/tribute-avatars/avatar-${id}\\.webp$`));
    assert.deepEqual(core.AVATARS.find((avatar) => avatar.id === id), { id, group: "premium", label: `有料・${NEW[id]}` });
    const entry = deco.RANCH_DECORATION_PRODUCTS.find((item) => item.avatar === id);
    assert.equal(entry.name, `アイコン・${NEW[id]}`);
    assert.match(entry.description, /四角いホログラムの印。$/);
    assert.doesNotMatch(`${entry.name}${entry.description}`, /制服|学校|学生|生徒|女子高|JK|少女|子供|ロリ|セーラー|の子/, `product ${id}`);
  }
  // 持っている飾りは Firestore の in（30個まで）で読む。51 で30個ちょうど。
  assert.equal(rules.DECORATION_PRODUCT_IDS.length, 30);
  assert.match(read("database.rules.json"), /ranch_avatar_\(36\|37\|38\|39\|40\|41\|42\|43\|44\|45\|46\|47\|48\|49\|50\|51\)/);
});

test("icons 49-51 are made like the others, without sparkles, and recorded with their source hashes", () => {
  const record = JSON.parse(read("functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json"));
  assert.deepEqual(record.icons.map((icon) => icon.id), Array.from({ length: 16 }, (_, index) => 36 + index));
  for (const icon of record.icons.slice(-3)) {
    const file = fs.readFileSync(path.join(root, icon.file));
    assert.equal(icon.file, `assets/tribute-avatars/avatar-${icon.id}.webp`);
    assert.equal(crypto.createHash("sha256").update(file).digest("hex"), icon.sha256, icon.file);
    assert.ok(file.length < 20_000, icon.file);
    assert.match(icon.sourceSha256, /^[0-9a-f]{64}$/);
  }
  // 50・51 の元画像は 1254px の正方形。1024 に縮めてから同じ座標で切り抜いた。
  assert.deepEqual(record.icons.filter((icon) => icon.sourceSize).map((icon) => [icon.id, icon.sourceSize]), [[50, [1254, 1254]], [51, [1254, 1254]]]);
  const script = read("tools/tribute-avatars/premium-icons.py");
  assert.match(script, /\{"id": 49, "center": \(512, 480\), "key": \(230, 165, 110\)\},\s+# キャラメル/);
  assert.match(script, /\{"id": 50, "center": \(520, 420\), "key": \(200, 170, 150\)\},\s+# 漆黒/);
  assert.match(script, /\{"id": 51, "center": \(530, 450\), "key": \(245, 210, 160\)\},\s+# バニラ/);
  assert.match(script, /if image\.width != image\.height:/, "only square sources");
});

test("cache keys: the ranch, the store and the account page load the product list with icons 49-51 as one module", () => {
  const html = read("index.html");
  for (const name of ["tribute.js", "online.js", "account.js"]) {
    assert.ok(new RegExp(`"module": "${name.replace(".", "\\.")}\\?v=[^"]*${MARKER}[^"]*"`).test(html), name);
  }
  const specifier = (source, name) => source.match(new RegExp(`(?:from |import\\()"\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
  const client = read("tribute.js");
  const online = read("online.js");
  for (const name of ["tribute-core.mjs", "tribute-deco.mjs", "tribute-share.mjs"]) assert.ok(specifier(client, name).includes(MARKER), name);
  assert.ok(specifier(online, "shop-products.mjs").includes(MARKER));
  assert.ok(specifier(read("account.js"), "shop-products.mjs").includes(MARKER));
  const decoKeys = new Set([client, online, read("tribute-share.mjs"), read("shop-products.mjs")].map((source) => specifier(source, "tribute-deco.mjs")));
  assert.equal(decoKeys.size, 1, "one tribute-deco.mjs module in the browser");
  const design = read("TRIBUTE_DESIGN.md");
  assert.match(design, /管理人の印は、用意した51種のアイコン（`avatar` 1〜51。36〜51 は有料/);
  assert.match(design, /キャラメル（49）を足した。残りの3枚/);
  assert.match(design, /漆黒（50、「働きたくない」のTシャツ）とバニラ（51、ケーブルニット）を足した/);
  assert.match(design, /飾りと有料アイコンの商品は51で30個ちょうど/);
  assert.ok(fs.existsSync(path.join(root, "functions/scripts/verify-tribute-premium-icons-3-release.cjs")));
});
