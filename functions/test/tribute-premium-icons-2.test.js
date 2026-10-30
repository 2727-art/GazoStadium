"use strict";

// お貢ぎ牧場の有料アイコンの2回目（43〜48、2026-10-30）。1枚 500 Pay、四角に金の縁。
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
const NEW_IDS = [43, 44, 45, 46, 47, 48];
const MARKER = "-ranch-premium-icons-v2";

test("six more paid icons: the same number, product, price and square gold look on the server, in the store and on screen", async () => {
  const [deco, core] = await Promise.all([loadDeco(), loadCore()]);
  for (const id of NEW_IDS) {
    const productId = `ranch_avatar_${id}`;
    assert.ok(rules.PREMIUM_AVATAR_IDS.includes(id), `rules ${id}`);
    assert.equal(rules.premiumAvatarProductId(id), productId);
    const product = Object.values(catalog).find((entry) => entry.id === productId);
    assert.deepEqual([product?.type, product?.price], ["ranchAvatar", 500], productId);
    const entry = deco.premiumAvatar(id);
    assert.equal(entry?.productId, productId);
    assert.equal(entry?.price, 500);
    assert.ok(deco.isPremiumAvatar(id));
    assert.match(deco.premiumAvatarUrl(id), new RegExp(`/assets/tribute-avatars/avatar-${id}\\.webp$`));
    assert.equal(core.AVATARS.find((avatar) => avatar.id === id)?.group, "premium", `core ${id}`);
  }
  assert.deepEqual(core.AVATARS.filter((avatar) => avatar.group === "premium").map((avatar) => avatar.label).slice(7),
    ["有料・ミルクティー", "有料・瑠璃", "有料・琥珀", "有料・ネオン", "有料・深紅", "有料・ルージュ"]);
  // 年齢や学校を連想させる言葉は、名前と説明に使わない。
  for (const id of NEW_IDS) {
    const entry = deco.RANCH_DECORATION_PRODUCTS.find((product) => product.avatar === id);
    assert.doesNotMatch(`${entry.name}${entry.description}`, /制服|学校|学生|生徒|女子高|JK|少女|子供|ロリ|セーラー|の子/, `product ${id}`);
  }
  // 持っている飾りは Firestore の in（30個まで）で読む。
  assert.equal(rules.DECORATION_PRODUCT_IDS.length, 27);
  // Realtime Database の持ち物の検証にも入る。
  assert.match(read("database.rules.json"), /ranch_avatar_\(36\|37\|38\|39\|40\|41\|42\|43\|44\|45\|46\|47\|48\)/);
});

test("the icons are processed from the user's images without a redraw, recorded with hashes, and stay small", () => {
  const record = JSON.parse(read("functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json"));
  assert.deepEqual(record.icons.map((icon) => icon.id), [36, 37, 38, 39, 40, 41, 42, ...NEW_IDS]);
  assert.match(record.method, /No generative redraw/);
  for (const icon of record.icons) {
    const file = fs.readFileSync(path.join(root, icon.file));
    assert.equal(crypto.createHash("sha256").update(file).digest("hex"), icon.sha256, icon.file);
    assert.equal(file.length, icon.bytes, icon.file);
    assert.ok(file.length < 20_000, icon.file);
    assert.equal(file.subarray(8, 12).toString("latin1"), "WEBP", icon.file);
    assert.deepEqual([icon.width, icon.height], [256, 256]);
    assert.match(icon.sourceSha256, /^[0-9a-f]{64}$/);
  }
  const script = read("tools/tribute-avatars/premium-icons.py");
  for (const id of NEW_IDS) assert.match(script, new RegExp(`"id": ${id}, "center"`), `crop and colour for ${id}`);
  assert.match(script, /if id not in BY_ID/, "only the requested numbers are remade");
  // 作成スクリプト・記録・見本は公開しない（tools/ と functions/ は Hosting にも workers.dev にも出ない）。
  const hostingIgnore = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(hostingIgnore.includes("tools/**") && hostingIgnore.includes("functions/**"));
  assert.match(read(".assetsignore"), /^tools\/$/m);
  assert.match(read(".assetsignore"), /^functions\/$/m);
});

test("cache keys: the ranch, the store and the account page load the new product list as one module", () => {
  const html = read("index.html");
  for (const name of ["tribute.js", "online.js", "account.js"]) {
    assert.ok(new RegExp(`"module": "${name.replace(".", "\\.")}\\?v=[^"]*${MARKER}"`).test(html), name);
  }
  const specifier = (source, name) => source.match(new RegExp(`(?:from |import\\()"\\./${name.replace(".", "\\.")}\\?v=([^"]+)"`))?.[1] || "";
  const client = read("tribute.js");
  const online = read("online.js");
  for (const name of ["tribute-core.mjs", "tribute-deco.mjs", "tribute-share.mjs"]) assert.ok(specifier(client, name).endsWith(MARKER), name);
  assert.ok(specifier(online, "shop-products.mjs").endsWith(MARKER));
  assert.ok(specifier(read("account.js"), "shop-products.mjs").endsWith(MARKER));
  const decoKeys = new Set([client, online, read("tribute-share.mjs"), read("shop-products.mjs")].map((source) => specifier(source, "tribute-deco.mjs")));
  assert.equal(decoKeys.size, 1, "one tribute-deco.mjs module in the browser");
  const design = read("TRIBUTE_DESIGN.md");
  assert.match(design, /有料アイコン（`avatar` 36〜48/);
  assert.ok(fs.existsSync(path.join(root, "functions/scripts/verify-tribute-premium-icons-2-release.cjs")));
});
