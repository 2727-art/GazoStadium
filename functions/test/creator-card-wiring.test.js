const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("existing 500 Pay entitlement remains and unlocks the editor-only premium finish", () => {
  const catalog = require("../product-catalog");
  const online = read("online.js");
  assert.deepEqual(catalog.feature_top_message, {
    id: "feature_top_message",
    type: "feature",
    price: 500,
  });
  assert.match(
    online,
    /\{\s*id:\s*TOP_MESSAGE_PRODUCT_ID,\s*type:\s*"feature",\s*name:\s*"推しカード プレミアム仕上げ"[^}]*price:\s*500\s*\}/,
  );
  assert.match(online, /基本カードは無料でトップページへ飾れます。/);
  assert.match(online, /公開中のカードはそのままです。/);

  const purchaseStart = online.indexOf("async function purchaseShopProduct");
  const purchaseEnd = online.indexOf("async function toggleShopProduct", purchaseStart);
  const purchaseSource = online.slice(purchaseStart, purchaseEnd);
  assert.ok(purchaseStart >= 0 && purchaseEnd > purchaseStart);
  assert.doesNotMatch(purchaseSource, /state\.topMessage\s*=/);
});

test("premium finish is tried and purchased in the creator-card editor, not a shop shelf", () => {
  const online = read("online.js");
  const editorStart = online.indexOf("function renderCreatorCardEditor");
  const editorEnd = online.indexOf("function renderPointShop", editorStart);
  const editorSource = online.slice(editorStart, editorEnd);
  const shopStart = editorEnd;
  const shopEnd = online.indexOf("function renderMatching", shopStart);
  const shopSource = online.slice(shopStart, shopEnd);
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.ok(shopStart >= 0 && shopEnd > shopStart);

  assert.match(editorSource, /id="creatorCardPremiumPanel"/);
  assert.match(editorSource, /id="creatorCardUnlockPremium"/);
  assert.match(editorSource, /id="creatorCardPremiumTrialLabel"/);
  assert.match(editorSource, /id="creatorCardSubmit"/);
  assert.match(editorSource, /creator-card-theme-group/);
  assert.match(editorSource, /creator-card-theme-grid is-premium/);
  assert.match(editorSource, /無料4種/);
  assert.match(editorSource, /プレミアム3種/);
  assert.match(editorSource, /3つのプレミアム仕上げ/);
  assert.match(editorSource, /500 Pay/);
  assert.match(editorSource, /買い切り/);
  assert.match(editorSource, /試着/);
  assert.doesNotMatch(editorSource, /const locked = theme\.premium/);
  assert.match(editorSource, /\$\{premiumTrial \? "disabled" : ""\}/);
  assert.match(editorSource, /aria-disabled="\$\{premiumTrial\}"/);
  assert.match(editorSource, /useOfflineMarketPreview/);

  assert.doesNotMatch(shopSource, /const featureProducts\s*=/);
  assert.doesNotMatch(shopSource, /shop-feature-grid/);
  assert.match(shopSource, /shop-free-card-callout/);
  assert.match(shopSource, /推しカード編集ルームへ移動/);
  assert.match(shopSource, /data-open-creator-card/);
});

test("premium trial and purchase preserve the draft and never publish implicitly", () => {
  const online = read("online.js");
  assert.match(online, /creatorCardDraft:\s*null/);
  assert.match(online, /state\.creatorCardDraft/);
  assert.match(online, /function captureCreatorCardDraft/);
  assert.match(online, /function creatorCardUsesLockedPremium/);
  assert.doesNotMatch(online, /プレミアム装飾/);

  const purchaseStart = online.indexOf("async function purchaseShopProduct");
  const purchaseEnd = online.indexOf("async function toggleShopProduct", purchaseStart);
  const purchaseSource = online.slice(purchaseStart, purchaseEnd);
  assert.ok(purchaseStart >= 0 && purchaseEnd > purchaseStart);
  assert.doesNotMatch(purchaseSource, /state\.topMessage\s*=/);
  assert.doesNotMatch(purchaseSource, /publish_creator_card/);
  assert.doesNotMatch(purchaseSource, /creatorCardDraft\s*=\s*null/);
  assert.match(purchaseSource, /const expectedState = state;/);
  assert.match(purchaseSource, /const expectedUid = expectedState\.uid;/);
  assert.match(purchaseSource, /state !== expectedState \|\| state\.uid !== expectedUid/);

  const saveStart = online.indexOf("async function saveTopMessage");
  const saveEnd = online.indexOf("async function deleteTopMessage", saveStart);
  const saveSource = online.slice(saveStart, saveEnd);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(saveSource, /publish_creator_card/);

  const downloadStart = online.indexOf("async function downloadCreatorCard");
  const downloadEnd = online.indexOf("async function retryCreatorCardDependencies", downloadStart);
  const downloadSource = online.slice(downloadStart, downloadEnd);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart);
  assert.match(downloadSource, /creatorCardUsesLockedPremium\(value\)/);

  const bindStart = online.indexOf("function bindCreatorCardEvents");
  const bindEnd = online.indexOf("function bindEconomyEvents", bindStart);
  const bindSource = online.slice(bindStart, bindEnd);
  assert.ok(bindStart >= 0 && bindEnd > bindStart);
  assert.match(bindSource, /creatorCardFormValue\(\)[\s\S]*?purchaseShopProduct\(TOP_MESSAGE_PRODUCT_ID\)/);
  assert.match(bindSource, /creatorCardXShare[\s\S]*?creatorCardUsesLockedPremium[\s\S]*?preventDefault/);
  assert.match(bindSource, /form\.addEventListener\("submit"[\s\S]*?creatorCardUsesLockedPremium[\s\S]*?return/);
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
  assert.match(styles, /\.creator-card-theme-group/);
  assert.match(styles, /\.creator-card-theme-grid\.is-premium/);
  assert.match(styles, /\.creator-card-premium-panel/);
  assert.match(styles, /\.creator-card-premium-panel\.is-owned/);
  assert.match(styles, /\.creator-card-share-actions \.button\.is-disabled/);
  assert.match(online, /get\("creatorCardPremium"\) === "locked"/);

  for (const asset of ["styles.css", "app.js", "online.js"]) {
    assert.match(html, new RegExp(`${asset.replace(".", "\\.")}\\?v=[^"]*favorite-card-v2`));
  }
  assert.match(readme, /基本カードを無料公開/);
  assert.match(readme, /推しカードの販売棚は設けず/);
  assert.match(readme, /無料4種とプレミアム3種/);
  assert.match(readme, /500 Pay[^。\n]*まとめて[^。\n]*買い切り/);
  assert.match(readme, /購入時[^。\n]*試着中テーマを維持/);
  assert.match(readme, /購入だけでは公開中のカードを変更しない/);
  assert.match(readme, /プレミアム仕上げ/);
  assert.match(readme, /\?marketPreview=1&creatorCardPremium=locked/);
  assert.doesNotMatch(readme, /プレミアム装飾/);
  assert.match(readme, /既存購入者/);
  assert.match(readme, /匿名UID、勝敗、RATE、画像、ルーム履歴/);
});
