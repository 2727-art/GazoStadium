"use strict";

// お貢ぎ牧場の有料アイコンの3回目（49 キャラメル、2026-10-30）。1枚 500 Pay、四角に印の色の縁とホログラム。
// 続けて渡された4枚のうち、制服が見える3枚は入れていない（設計書の有料アイコンの行）。
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

test("icon 49: the same number, product and price on the server, in the store and on screen", async () => {
  const [deco, core] = await Promise.all([loadDeco(), loadCore()]);
  assert.equal(rules.AVATAR_MAX, 49);
  assert.equal(core.AVATAR_MAX, 49);
  assert.ok(rules.PREMIUM_AVATAR_IDS.includes(49));
  assert.equal(rules.premiumAvatarProductId(49), "ranch_avatar_49");
  const product = Object.values(catalog).find((entry) => entry.id === "ranch_avatar_49");
  assert.deepEqual([product?.type, product?.price], ["ranchAvatar", 500]);
  assert.equal(deco.premiumAvatar(49)?.productId, "ranch_avatar_49");
  assert.match(deco.premiumAvatarUrl(49), /\/assets\/tribute-avatars\/avatar-49\.webp$/);
  assert.deepEqual(core.AVATARS.find((avatar) => avatar.id === 49), { id: 49, group: "premium", label: "有料・キャラメル" });
  const entry = deco.RANCH_DECORATION_PRODUCTS.find((item) => item.avatar === 49);
  assert.equal(entry.name, "アイコン・キャラメル");
  assert.match(entry.description, /四角いホログラムの印。$/);
  assert.doesNotMatch(`${entry.name}${entry.description}`, /制服|学校|学生|生徒|女子高|JK|少女|子供|ロリ|セーラー|の子/);
  // 持っている飾りは Firestore の in（30個まで）で読む。今28個。
  assert.equal(rules.DECORATION_PRODUCT_IDS.length, 28);
  assert.match(read("database.rules.json"), /ranch_avatar_\(36\|37\|38\|39\|40\|41\|42\|43\|44\|45\|46\|47\|48\|49\)/);
});

test("icon 49 is made like the others, without sparkles, and recorded with its source hash", () => {
  const record = JSON.parse(read("functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json"));
  assert.deepEqual(record.icons.map((icon) => icon.id), [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
  const icon = record.icons.at(-1);
  const file = fs.readFileSync(path.join(root, icon.file));
  assert.equal(icon.file, "assets/tribute-avatars/avatar-49.webp");
  assert.equal(crypto.createHash("sha256").update(file).digest("hex"), icon.sha256);
  assert.ok(file.length < 20_000);
  assert.match(icon.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(read("tools/tribute-avatars/premium-icons.py"), /\{"id": 49, "center": \(512, 480\), "key": \(230, 165, 110\)\},\s+# キャラメル/);
});

test("cache keys: the ranch, the store and the account page load the product list with icon 49 as one module", () => {
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
  assert.match(design, /管理人の印は、用意した49種のアイコン（`avatar` 1〜49。36〜49 は有料/);
  assert.match(design, /キャラメル（49）を足した。残りの3枚/);
  assert.ok(fs.existsSync(path.join(root, "functions/scripts/verify-tribute-premium-icons-3-release.cjs")));
});
