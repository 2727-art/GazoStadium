const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("existing 500 Pay entitlement now unlocks premium creator-card decoration", () => {
  const catalog = require("../product-catalog");
  const online = read("online.js");
  assert.deepEqual(catalog.feature_top_message, {
    id: "feature_top_message",
    type: "feature",
    price: 500,
  });
  assert.match(
    online,
    /\{\s*id:\s*TOP_MESSAGE_PRODUCT_ID,\s*type:\s*"feature",\s*name:\s*"推しカード プレミアム装飾"[^}]*price:\s*500\s*\}/,
  );
  assert.match(online, /基本カードの公開は無料です。/);
  assert.match(online, /公開中のカードはそのままです。/);

  const purchaseStart = online.indexOf("async function purchaseShopProduct");
  const purchaseEnd = online.indexOf("async function toggleShopProduct", purchaseStart);
  const purchaseSource = online.slice(purchaseStart, purchaseEnd);
  assert.ok(purchaseStart >= 0 && purchaseEnd > purchaseStart);
  assert.doesNotMatch(purchaseSource, /state\.topMessage\s*=/);
});

test("creator-card publication is callable-authoritative and premium themes require ownership", () => {
  const server = read("functions/index.js");
  const online = read("online.js");
  const publishStart = server.indexOf("async function publishCreatorCard");
  const publishEnd = server.indexOf("async function deleteCreatorCard", publishStart);
  const publishSource = server.slice(publishStart, publishEnd);
  assert.ok(publishStart >= 0 && publishEnd > publishStart);
  assert.match(publishSource, /readLegacyEconomy\(uid\)/);
  assert.match(publishSource, /economy\.inventory\?\.\[CREATOR_CARD_PREMIUM_PRODUCT_ID\] === true/);
  assert.match(publishSource, /isPremiumCreatorCardTheme\(cardTheme\) && !premiumOwned/);
  assert.match(publishSource, /CREATOR_CARD_PUBLISH_COOLDOWN_MS/);
  assert.match(publishSource, /growthLevel:\s*Math\.max\([\s\S]*?record\.growthLevel[\s\S]*?current\?\.growthLevel/);
  assert.match(publishSource, /sanitizeAchievementIds/);
  assert.match(publishSource, /online\/topMessages\/\$\{entryId\}/);
  assert.doesNotMatch(publishSource, /uid\s*:/);
  assert.match(server, /const nextGrowthLevel = Math\.max\(Number\(current\.growthLevel \|\| 1\), growthLevel\)/);

  for (const action of ["publish_creator_card", "delete_creator_card"]) {
    assert.match(server, new RegExp(`action === "${action}"`));
    assert.match(online, new RegExp(`action:\\s*"${action}"`));
  }
  assert.match(server, /action === "publish_creator_card"[\s\S]*?!request\.app[\s\S]*?publishCreatorCard/);
  assert.match(server, /action === "delete_creator_card"\) return await deleteCreatorCard\(uid\)/);
  assert.match(online, /legacyPremium:\s*schemaVersion < CREATOR_CARD_VERSION/);
  assert.match(online, /legacyPremium \? "premium-hologram" : "basic-rose"/);
});

test("clients cannot forge public creator cards or ownership indexes", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.online;
  assert.equal(rules.topMessages.$entryId[".write"], false);
  assert.equal(rules.topMessageOwners.$entryId[".write"], false);
  assert.equal(rules.topMessageEntriesByUser.$uid[".write"], false);

  const online = read("online.js");
  for (const pathName of ["topMessages", "topMessageOwners", "topMessageEntriesByUser"]) {
    assert.doesNotMatch(
      online,
      new RegExp(`(?:set|update|remove|runTransaction)\\([^\\n]*online/${pathName}`),
    );
  }
});

test("creator-card UI remains discoverable, shareable, and cache-busted", () => {
  const app = read("app.js");
  const online = read("online.js");
  const styles = read("styles.css");
  const html = read("index.html");
  const readme = read("README.md");

  assert.match(app, /みんなの推しカード/);
  assert.match(app, /data-top-message-compose/);
  assert.match(app, /data-top-message-autoplay aria-pressed=/);
  assert.match(app, /panel\.matches\(":hover, :focus-within"\)/);
  assert.match(app, /openOnlineFeature\("openCreatorCard"\)/);
  assert.match(app, /createCreatorCardPngBlob/);
  assert.match(app, /growthLabel:\s*CREATOR_CARD_GROWTH_LABELS\[growthLevel - 1\]/);
  assert.match(online, /id="creatorCardDownload"/);
  assert.match(online, /id="creatorCardNativeShare"/);
  assert.match(online, /id="creatorCardXShare"/);
  assert.match(online, /id="creatorCardRetry"/);
  assert.match(online, /role="progressbar"/);
  assert.match(online, /creatorCardDependenciesSettled:\s*expectedState\.creatorCardDependenciesSettled/);
  assert.match(online, /if \(useOfflineMarketPreview\) \{\s*throw new Error\("LOCAL UI PREVIEWでは推しカードを公開・更新しません。"\)/);
  assert.match(online, /state\.topMessageBusy \|\| useOfflineMarketPreview \? "disabled"/);
  assert.match(styles, /\.creator-card-screen/);
  assert.match(styles, /\.creator-card-theme-premium-hologram/);

  for (const asset of ["styles.css", "app.js", "online.js"]) {
    assert.match(html, new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]*favorite-card-v1`));
  }
  assert.match(readme, /基本カードは無料/);
  assert.match(readme, /500 Pay[^。\n]*プレミアム装飾/);
  assert.match(readme, /既存購入者/);
  assert.match(readme, /匿名UID、勝敗、RATE、画像、ルーム履歴/);
});
