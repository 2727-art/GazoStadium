const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const serverCatalog = require("../product-catalog");

const COLLECTION_TITLE_ROWS = Object.freeze([
  ["title_oshi_deliverer", 400],
  ["title_oshi_storyteller", 450],
  ["title_tokimeki_scout", 450],
  ["title_one_picture_guide", 500],
  ["title_favorite_matchmaker", 550],
  ["title_tokimeki_curator", 650],
  ["title_oshi_concierge", 750],
]);

const COLLECTION_PRODUCT_IDS = Object.freeze([
  ...COLLECTION_TITLE_ROWS.map(([id]) => id),
  "stamp_god_photo",
  "stamp_genius",
  "stamp_best_shot",
  "stamp_more",
  "stamp_hit",
  "chat_bg_sakura_milk",
  "chat_bg_peach_fizz",
  "chat_bg_lavender_mist",
  "chat_frame_heart_ribbon",
  "chat_frame_lace",
  "chat_frame_cat_paw",
  "chat_frame_flower",
  "chat_frame_jewel",
  "chat_frame_stardust",
]);

function parseProductRows(relativePaths) {
  const products = [];
  for (const relativePath of relativePaths) {
    for (const line of read(relativePath).split(/\r?\n/)) {
      const match = line.match(
        /\{\s*id:\s*"([^"]+)",\s*type:\s*"([^"]+)"[^}]*\bprice:\s*(\d+)(?:\s*[,}])/,
      );
      if (match) products.push({ id: match[1], type: match[2], price: Number(match[3]) });
    }
  }
  return products;
}

function idsAllowedByValidation(expression) {
  const ids = new Set();
  for (const match of expression.matchAll(/(?:\$productId|newData\.val\(\))\s*===\s*'([^']+)'/g)) {
    ids.add(match[1]);
  }
  for (const match of expression.matchAll(/matches\(\/\^([a-z][a-z0-9_]*_)\(([^)]+)\)\$\/\)/g)) {
    for (const suffix of match[2].split("|")) ids.add(`${match[1]}${suffix}`);
  }
  return [...ids].sort();
}

test("browser, Functions, and Realtime Database point-shop catalogs stay identical", () => {
  const browserProducts = parseProductRows([
    "online.js",
    "stamps.js",
    "player-titles.js",
    "chat-cosmetics.js",
  ]);
  const online = read("online.js");
  const topMessageId = online.match(/const TOP_MESSAGE_PRODUCT_ID = "([^"]+)"/)?.[1];
  const topMessageProduct = online.match(
    /\{\s*id:\s*TOP_MESSAGE_PRODUCT_ID,\s*type:\s*"([^"]+)"[^}]*\bprice:\s*(\d+)/,
  );
  assert.ok(topMessageId && topMessageProduct);
  browserProducts.push({
    id: topMessageId,
    type: topMessageProduct[1],
    price: Number(topMessageProduct[2]),
  });
  const browserIds = browserProducts.map(({ id }) => id);
  assert.equal(new Set(browserIds).size, browserIds.length, "browser catalog has duplicate IDs");

  const browserRows = browserProducts
    .map(({ id, type, price }) => [id, type, price])
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  const serverRows = Object.values(serverCatalog)
    .map(({ id, type, price }) => [id, type, price])
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId));
  assert.deepEqual(browserRows, serverRows);
  assert.equal(browserRows.length, 126);

  const rules = JSON.parse(read("database.rules.json")).rules;
  const economyRules = rules.online.economy["$uid"];
  const inventoryIds = idsAllowedByValidation(
    economyRules.inventory["$productId"][".validate"],
  );
  assert.deepEqual(inventoryIds, browserIds.sort());

  const titleIds = browserProducts
    .filter(({ type }) => type === "title")
    .map(({ id }) => id)
    .sort();
  const equippedTitleIds = idsAllowedByValidation(economyRules.equipped.title[".validate"]);
  assert.deepEqual(equippedTitleIds, titleIds);
  assert.equal(titleIds.length, 55);
});

test("oshi activity collection has the agreed titles and only reuses valid shared products", () => {
  for (const [id, price] of COLLECTION_TITLE_ROWS) {
    assert.deepEqual(serverCatalog[id], { id, type: "title", price });
  }

  const titles = read("player-titles.js");
  for (const [id] of COLLECTION_TITLE_ROWS) {
    assert.match(
      titles,
      new RegExp(`id: "${id}"[^\\n]+category: "oshi_market"[^\\n]+collection: "oshi_market"`),
    );
  }

  const online = read("online.js");
  const collectionStart = online.indexOf("const OSHI_MARKET_COLLECTION_GROUPS");
  const collectionEnd = online.indexOf("const LEADERBOARD_PERIODS", collectionStart);
  assert.ok(collectionStart >= 0 && collectionEnd > collectionStart);
  const collectionSource = online.slice(collectionStart, collectionEnd);
  const displayedProductIds = [...collectionSource.matchAll(
    /"((?:title|stamp|chat_bg|chat_frame)_[a-z0-9_]+)"/g,
  )].map((match) => match[1]);
  assert.deepEqual(displayedProductIds, [...COLLECTION_PRODUCT_IDS]);
  assert.equal(new Set(displayedProductIds).size, displayedProductIds.length);
  for (const productId of displayedProductIds) assert.ok(serverCatalog[productId], productId);

  assert.match(online, /推し活・ときめきコレクション/);
  assert.match(online, /商品ID・購入状態・装備状態は共通/);
  assert.match(online, /standardTitleProducts\s*=\s*PLAYER_TITLE_PRODUCTS\.filter/);
  assert.match(
    online,
    /useOfflineMarketPreview[\s\S]*?screen === "shop"[\s\S]*?POINT SHOP PREVIEW/,
  );
  assert.match(online, /LOCAL UI PREVIEWでは購入・装備を変更しません/);
  assert.match(
    online,
    /async function cleanupMatchmaking[\s\S]*?if \(useOfflineMarketPreview\) \{[\s\S]*?return;[\s\S]*?online\/queue/,
  );
});

test("market shop charms use owned stamp IDs without consuming chat equipment slots", () => {
  const browser = read("market.js");
  const css = read("market.css");
  const marketShop = read("functions/market-shop.js");
  const server = read("functions/index.js");
  const readme = read("README.md");

  for (const source of [browser, marketShop, server]) assert.match(source, /shopCharmId/);
  for (const source of [browser, server]) assert.match(source, /ownedShopCharmIds/);
  for (const id of ["stamp_like", "stamp_cute", "stamp_surprise", "stamp_thanks"]) {
    assert.match(marketShop, new RegExp(`"${id}"`));
  }
  assert.match(browser, /name="marketShopCharm"/);
  assert.match(browser, /チャットの6個の装備枠とは別/);
  assert.match(browser, /getStamp\(shopCharmId\)/);
  assert.match(css, /\.market-shop-charm-option/);
  assert.match(css, /\.market-shop-charm(?!-option)/);
  assert.match(server, /economyPurchases/);
  assert.match(server, /readLegacyEconomy/);
  assert.match(readme, /無料4種とポイントショップで購入済みのスタンプ/);

  const html = read("index.html");
  assert.match(html, /market\.css\?v=[^"]*shop-charm-v1/);
  assert.match(html, /market\.js\?v=[^"]*shop-charm-v1/);
  for (const entry of ["online.js", "strategy.js", "team.js", "royale.js", "market.js"]) {
    assert.match(read(entry), /player-titles\.js\?v=player-titles-v2/, entry);
  }
});
