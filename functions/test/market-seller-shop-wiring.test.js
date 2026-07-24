const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("seller-shop assets use the same cache generation", () => {
  const html = read("index.html");
  assert.match(html, /market\.css\?v=[^"]*seller-shop-v1/);
  assert.match(html, /market\.js\?v=[^"]*seller-shop-v1/);
  assert.match(html, /market\.js\?v=[^"]*app-check-v2/);
});

test("seller-shop Firestore collections are server-only", () => {
  const rules = read("firestore.rules");
  const server = read("functions/index.js");
  for (const collectionName of [
    "valueMarketShops",
    "valueMarketShopPublic",
    "valueMarketShopFavorites",
    "valueMarketShopBlocks",
    "valueMarketShopRelationships",
    "valueMarketShopImpressions",
    "valueMarketQueueControls",
  ]) {
    assert.match(server, new RegExp(`collection\\("${collectionName}"\\)`));
  }
  for (const pattern of [
    /match \/valueMarketShops\/\{uid\} \{\s*allow read, write: if false;/,
    /match \/valueMarketShopPublic\/\{publicSellerId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketShopFavorites\/\{buyerUid\} \{\s*allow read, write: if false;[\s\S]*?match \/sellers\/\{sellerUid\} \{\s*allow read, write: if false;/,
    /match \/valueMarketShopBlocks\/\{uid\} \{\s*allow read, write: if false;[\s\S]*?match \/users\/\{targetUid\} \{\s*allow read, write: if false;/,
    /match \/valueMarketShopRelationships\/\{relationshipId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketShopImpressions\/\{impressionId\} \{\s*allow read, write: if false;/,
    /match \/valueMarketQueueControls\/\{uid\} \{\s*allow read, write: if false;/,
  ]) {
    assert.match(rules, pattern);
  }
});

test("seller-shop UI and documentation cover identity, relationships, and safety", () => {
  const css = read("market.css");
  const browser = read("market.js");
  const readme = read("README.md");

  for (const className of [
    "market-shop-",
    "market-seller-card",
    "market-favorite-",
    "market-impression-",
    "market-block-",
  ]) {
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.match(css, /\.is-theme-/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*560px\)/);

  const sellerShopClassPrefix =
    /^market-(?:shop|seller|favorite|favorites|impression|block|certificate|relationship)/;
  const frontendClasses = [...browser.matchAll(/class="([^"]+)"/g)]
    .flatMap(([, classNames]) => classNames.split(/\s+/))
    .filter((className) => sellerShopClassPrefix.test(className) && !className.includes("${"));
  for (const className of new Set(frontendClasses)) {
    assert.match(css, new RegExp(`\\.${className}(?![\\w-])`), `${className} needs a CSS selector`);
  }
  for (const themeId of ["standard", "sakura", "lavender", "mint", "cream", "midnight"]) {
    assert.match(css, new RegExp(`\\.market-shop-theme-${themeId}(?![\\w-])`));
    assert.match(css, new RegExp(`\\.is-theme-${themeId}(?![\\w-])`));
  }

  for (const term of [
    "推し値商店",
    "店コード",
    "商印",
    "店主カード",
    "常連帳",
    "優先待機",
    "肯定タグ",
    "ブロック",
    "証書来歴",
    "評価悪用",
  ]) {
    assert.match(readme, new RegExp(term));
  }
  assert.match(readme, /選択した1店に限定して待機/);
  assert.match(readme, /販売価格と着手料5 Payの合計以上/);
  assert.match(readme, /異なる買い手5人/);
  assert.match(readme, /同じ結果画面にいる間ならすぐ解除/);
  assert.doesNotMatch(readme, /ブロック一覧/);
});

test("regular-shop targeting and result-screen unblock stay explicit", () => {
  const browser = read("market.js");
  const css = read("market.css");

  assert.match(browser, /name="marketFavoriteSeller"/);
  assert.match(browser, /joinedFavoritePublicSellerId[\s\S]*?selectedFavorite\?\.publicSellerId/);
  assert.match(browser, /favoritePublicSellerId:\s*joinedFavoritePublicSellerId/);
  assert.match(browser, /requiredBalance\s*=\s*price\s*\+\s*ENTRY_FEE/);
  assert.match(browser, /異なる買い手5人/);
  assert.ok(
    browser.includes('data-market-block-counterparty="${feedback.blocked ? "false" : "true"}"'),
  );
  assert.match(browser, /ブロックを解除/);
  assert.ok(
    [...browser.matchAll(/state\.room\.sellerShop = \{ \.\.\.returnedShop, relationship \};/g)].length >= 2,
    "relationship and block responses should preserve the room's prior-purchase context",
  );

  assert.match(css, /\.market-favorite-card\.is-selected/);
  assert.match(css, /\.market-favorite-select\.is-selected/);
  assert.match(css, /\.market-favorite-select\.is-unavailable/);
  assert.match(css, /\.market-block-panel\.is-blocked \.button/);
});

test("queue indexes cover affordable discover and targeted-shop scans", () => {
  const indexConfig = JSON.parse(read("firestore.indexes.json"));
  const fieldSets = indexConfig.indexes
    .filter((index) => index.collectionGroup === "valueMarketQueues")
    .map((index) => index.fields.map((field) => field.fieldPath).join(","));
  assert.ok(fieldSets.includes("selectedFavoriteSellerUid,status,lastSeen"));
  assert.ok(fieldSets.includes("role,status,matchMode,maxBudget,lastSeen"));
  assert.ok(fieldSets.includes("role,status,listing.askingPrice,lastSeen"));
});
