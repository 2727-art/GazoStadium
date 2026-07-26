"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const vm = require("node:vm");
const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the flea market is a separate top-level discovery panel, not another VALUE MARKET action", () => {
  const app = read("app.js");
  const html = read("index.html");
  const flea = read("flea-market.js");
  const heroActions = between(app, '<div class="hero-actions">', "</div>");
  const fleaPanel = between(app, "function renderLandingFleaPanel", "function bindLandingTopMessageEvents");

  assert.match(html, /styles\.css\?v=[^"]*urikko-card-v1/);
  assert.match(html, /flea-market\.css\?v=[^"]*urikko-card-v1/);
  assert.match(html, /app\.js\?v=[^"]*urikko-card-v1/);
  assert.match(html, /flea-market\.js\?v=[^"]*app-check-v2[^"]*urikko-card-v1/);
  assert.match(app, /function renderLandingFleaPanel\(\)/);
  assert.ok(
    app.indexOf("${renderLandingTopMessagePanel()}")
      < app.indexOf("${renderLandingFleaPanel()}"),
    "the flea panel must follow the public creator-card showcase",
  );
  assert.doesNotMatch(heroActions, /fleaMarket/);
  assert.match(fleaPanel, /id="fleaMarketSellersButton"[^>]*>今日の売りっ子を見る/);
  assert.match(fleaPanel, /id="fleaMarketBrowseButton"[^>]*>一品から見る/);
  assert.match(fleaPanel, /id="fleaMarketSellButton"[^>]*>今日の一品を出す/);
  assert.ok(
    fleaPanel.indexOf('id="fleaMarketSellersButton"')
      < fleaPanel.indexOf('id="fleaMarketBrowseButton"')
      && fleaPanel.indexOf('id="fleaMarketBrowseButton"')
        < fleaPanel.indexOf('id="fleaMarketSellButton"'),
    "seller discovery must be the primary flea-market route",
  );
  assert.match(app, /function startFleaMarketSellers\(\) \{[\s\S]*?startFleaMarketDestination\("sellers"\)/);
  assert.match(app, /const initialScreen = \["sellers", "sell"\]\.includes\(destination\) \? destination : "shelf"/);
  assert.match(app, /#fleaMarketSellersButton, #fleaMarketBrowseButton, #fleaMarketSellButton/);
  assert.match(app, /フリマの取引は、推し値市場の販売実績・ランキング・常連帳・店主評価へ加算しません/);
  assert.match(app, /本人が選んだ解除済みの推し値市場実績だけを、売りっ子カードに飾れます/);
  assert.match(flea, /httpsCallable\(functions, "anjuPayFleaAction"\)/);
  assert.doesNotMatch(flea, /valueMarketAction|valueMarketQueue|valueMarketShop/);
  assert.doesNotMatch(flea, /marketStats|unlockAchievements|MarketCertificates|patronFund/);
});

test("the seller directory is a category-based daily discovery view, never a fifth ranking tab", () => {
  const source = read("flea-market.js");
  const css = read("flea-market.css");
  const tabs = between(source, "function renderTabs", "function renderFrame");
  const directory = between(source, "function sellerDirectoryListings", "function activeListingForSeller");
  const sellerCardCss = between(
    css,
    ".flea-urikko-card {",
    ".flea-urikko-card.is-theme-standard",
  );

  assert.match(source, /const SCREEN_IDS = new Set\(\[[\s\S]*"sellers"[\s\S]*"seller-card-editor"/);
  assert.equal((tabs.match(/role="tab"/g) || []).length, 4);
  assert.doesNotMatch(tabs, /data-flea-nav="sellers"/);
  assert.match(tabs, /\["sell", "publish-review", "own", "seller-card-editor"\]\.includes\(state\.screen\)/);
  assert.match(directory, /renderDiscoverySwitch\("sellers"\)/);
  assert.match(directory, /renderCategoryFilters\(\)/);
  assert.match(directory, /state\.categoryFilter === "all"[\s\S]*state\.listings[\s\S]*state\.sellerListingsCategory === state\.categoryFilter[\s\S]*state\.sellerListings/);
  assert.match(directory, /listingIsOpen\(listing\)/);
  assert.match(directory, /順位ではありません \/ 0:00に日替わり/);
  assert.match(directory, /売上、推し帳の人数、カードの装飾、実績の数を使わない日替わりの順番/);
  assert.match(directory, /data-flea-sellers-more=/);
  assert.match(directory, /state\.nextSellerCursor/);
  assert.doesNotMatch(directory, /\.sort\(|marketStats|salesCount|favoriteCount|bestSale|data-flea-rank|<ol\b/);
  assert.match(source, /performAction\("browse_sellers", \{[\s\S]*category: state\.categoryFilter/);
  assert.doesNotMatch(source, /推し値市場の成績とは別に集計します/);
  assert.doesNotMatch(source, /実績の件数や段階は一覧に表示しません/);
  assert.match(source, /推し値市場の成績へ加算しません/);
  assert.match(
    source,
    /選んだ実績の名前と印だけを表示し、解除済み総数・進捗値・達成条件・解除日時は表示しません/,
  );

  const claimsEqualCardSize = /同じ(?:大きさ|高さ)/.test(source);
  const fixesCardSize = /(?:^|\n)\s*(?:height|block-size):\s*(?!auto\b)[^;]+;/m
    .test(sellerCardCss);
  assert.ok(
    !claimsEqualCardSize || fixesCardSize,
    "equal-size copy requires an actual fixed seller-card size",
  );
});

test("seller-card customization is public, optional, market-achievement-only, and accessible", () => {
  const source = read("flea-market.js");
  const css = read("flea-market.css");
  const achievementNormalizer = between(
    source,
    "function normalizeMarketAchievementIds",
    "function normalizeCreatorCard",
  );
  const editor = between(source, "function renderSellerCardEditor", "function renderSell");
  const formLogic = between(source, "function captureUrikkoCardFromForm", "async function performAction");

  assert.match(achievementNormalizer, /definition\.scope !== "market"/);
  assert.match(achievementNormalizer, /ids\.length >= maximum/);
  assert.match(editor, /id="fleaUrikkoCardForm"/);
  assert.match(editor, /id="fleaUrikkoFormStatus" role="status"/);
  assert.match(editor, /id="fleaUrikkoTagline"[\s\S]*maxlength="40"/);
  assert.match(editor, /<fieldset><legend>カードテーマ<\/legend>/);
  assert.match(editor, /<fieldset><legend>商いの印<\/legend>/);
  assert.match(editor, /<fieldset><legend>本人が選ぶ推し値市場実績<\/legend>/);
  assert.match(editor, /本人が選んだ解除済みの推し値市場実績（最大3件）/);
  assert.match(editor, /売上・成約数・推し帳人数・順位はカードにも並び順にも使用しません/);
  assert.doesNotMatch(editor, /fleaX|xPostUrl|xHandle|marketStats|salesCount|favoriteCount/);
  assert.match(formLogic, /achievementIds\.length > 3/);
  assert.match(formLogic, /achievementIds\.some\(\(id\) => !unlockedIds\.has\(id\)\)/);
  assert.match(formLogic, /performAction\("save_urikko_card", validation\.value\)/);
  assert.match(
    source,
    /control\.type === "text" \? "input" : "change",[\s\S]*?updateUrikkoCardPreview/,
  );

  assert.match(css, /\.flea-urikko-theme-choice > span::after/);
  assert.match(css, /\.flea-urikko-theme-choice input:checked \+ span::after[\s\S]*content: "●"/);
  assert.match(css, /\.flea-urikko-achievement-choice > span::after[\s\S]*content: "□"/);
  assert.match(css, /\.flea-urikko-achievement-choice input:checked \+ span::after[\s\S]*content: "✓"/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*\.flea-urikko-theme-grid,[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.flea-discovery-switch button,[\s\S]*\.flea-urikko-directory-card,[\s\S]*transition: none/);

  const sandbox = {
    state: {
      busyAction: "save_urikko_card",
      urikkoCardDraft: {
        schemaVersion: 1,
        tagline: "ことばから見つけてください",
        themeId: "standard",
        sealId: "heart",
        achievementIds: ["market_seller_1"],
      },
      unlockedMarketAchievementIds: ["market_seller_1"],
      urikkoCardFormMessage: "",
    },
    normalizeUrikkoCard: (value) => value,
    URIKKO_THEME_DEFINITIONS: [{ id: "standard", label: "スタンダード" }],
    URIKKO_SEAL_DEFINITIONS: [{ id: "heart", label: "ハート", mark: "♥" }],
    window: {
      HariaiAchievements: {
        byId: new Map([[
          "market_seller_1",
          {
            id: "market_seller_1",
            name: "成約第一号",
            icon: "✦",
            familyLabel: "販売",
            scope: "market",
          },
        ]]),
      },
    },
    renderFrame: (value) => value,
    renderUrikkoCard: () => "",
    ownUrikkoSeller: () => ({}),
    escapeHtml: (value) => String(value ?? ""),
  };
  vm.runInNewContext(editor, sandbox);
  const savingHtml = sandbox.renderSellerCardEditor();
  const inputTags = savingHtml.match(/<input\b[^>]*>/g) || [];
  const inputsAreDirectlyDisabled = inputTags.every((tag) => /\bdisabled\b/.test(tag));
  const disabledFieldsets = (savingHtml.match(/<fieldset\b[^>]*\bdisabled\b[^>]*>/g) || []).length;
  const controlsAreDisabledByFieldsets = disabledFieldsets >= 3
    && /<input\b[^>]*id="fleaUrikkoTagline"[^>]*\bdisabled\b/.test(savingHtml);
  assert.ok(inputTags.length >= 4, "the editor fixture must render every input type");
  assert.ok(
    inputsAreDirectlyDisabled || controlsAreDisabledByFieldsets,
    "all seller-card inputs must be disabled while save_urikko_card is pending",
  );
});

test("internal flea design and local artifacts are excluded from every static publisher", () => {
  const firebase = JSON.parse(read("firebase.json"));
  const workerIgnore = read(".assetsignore");
  const privatePaths = [
    "ANJU_PAY_FLEA_DESIGN.md",
    ".codex-remote-attachments",
    "database-debug.log",
    "firestore-debug.log",
    "ui-debug.log",
  ];

  for (const privatePath of privatePaths) {
    assert.ok(
      firebase.hosting.ignore.includes(privatePath)
        || firebase.hosting.ignore.includes(`${privatePath}/**`),
      `${privatePath} must be excluded from Firebase Hosting`,
    );
    assert.match(
      workerIgnore,
      new RegExp(`^${privatePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`, "m"),
      `${privatePath} must be excluded from Cloudflare static assets`,
    );
  }
});

test("the flea experience stays text-only and never embeds or fetches X content", () => {
  const source = read("flea-market.js");
  const xConfirmation = between(source, "function bindFleaXLinkConfirmations", "function bindEvents");

  assert.doesNotMatch(source, /<img\b|<iframe\b|type=["']file["']/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|FileReader|getUserMedia|oEmbed|twitter\.com/i);
  assert.match(source, /url\.protocol !== "https:"[\s\S]*?\["x\.com", "www\.x\.com"\]\.includes\(hostname\)/);
  assert.match(source, /url\.pathname\.match\(/);
  assert.match(source, /return `https:\/\/x\.com\/\$\{match\[1\]\}\/status\/\$\{match\[2\]\}`/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer nofollow ugc"/);
  assert.match(source, /referrerpolicy="no-referrer"/);
  assert.match(source, /ポスト本文や画像はゲーム内に表示しません/);
  assert.match(source, /自分の投稿/);
  assert.match(source, /推しカード[^\n]{0,120}同じXユーザー名/);
  assert.match(source, /FLEA_X_EXTERNAL_CONFIRM_MESSAGE[^\n]*店主が自己申告/);
  assert.match(source, /運営は店主とXアカウントの本人確認も、リンク先の内容確認も行っていません/);
  assert.match(source, /店主が公開設定した自己申告の情報/);
  assert.doesNotMatch(source, /本人確認済み|運営確認済み|公式認証済み/);
  assert.match(xConfirmation, /\.flea-screen a\[href\]/);
  assert.match(xConfirmation, /\["x\.com", "www\.x\.com"\]/);
  assert.match(xConfirmation, /window\.confirm\(FLEA_X_EXTERNAL_CONFIRM_MESSAGE\)/);
  assert.match(xConfirmation, /addEventListener\("click", confirmNavigation\)/);
  assert.match(xConfirmation, /addEventListener\("auxclick", confirmNavigation\)/);
});

test("a successful report removes every local X path, including listings beyond page one", () => {
  const source = read("flea-market.js");
  const xRemovalHelpers = between(
    source,
    "function stripCreatorCardXHandle",
    "function appendUniqueBrowseListings",
  );
  const actions = between(source, "async function performAction", "async function performPreviewAction");
  const previewAction = between(source, "async function performPreviewAction", "function openValueMarket");
  const reportPanel = between(source, "function renderReportPanel", "function renderDetail");
  const makeListing = (id) => ({
    id,
    xPostUrl: `https://x.com/seller_x/status/${id.length + 100}`,
    seller: {
      name: "SELLER",
      creatorCard: {
        name: "SELLER",
        text: "ことば",
        xHandle: "seller_x",
      },
    },
  });
  const targetId = "target-listing";
  const unrelated = makeListing("unrelated-listing");
  const target = makeListing(targetId);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const localState = {
    listings: [
      unrelated,
      ...Array.from({ length: 53 }, (_, index) => makeListing(`filler-${index}`)),
      target,
    ],
    sellerListings: [clone(target)],
    ownListing: clone(target),
    receipts: [
      { id: "unrelated-listing", listing: clone(unrelated) },
      { id: targetId, listing: clone(target) },
    ],
    success: { listing: clone(target), purchase: { price: 25 } },
  };
  const sandbox = { state: localState };
  vm.runInNewContext(xRemovalHelpers, sandbox);
  sandbox.removeReportedListingXLocally(targetId);

  const assertXRemoved = (listing) => {
    assert.equal(Object.hasOwn(listing, "xPostUrl"), false);
    assert.equal(Object.hasOwn(listing.seller.creatorCard, "xHandle"), false);
  };
  assert.equal(localState.listings.length, 55);
  assert.equal(localState.listings[54].id, targetId);
  assertXRemoved(localState.listings[54]);
  assertXRemoved(localState.sellerListings[0]);
  assertXRemoved(localState.ownListing);
  assertXRemoved(localState.receipts.find((receipt) => receipt.id === targetId).listing);
  assertXRemoved(localState.success.listing);
  assert.equal(unrelated.xPostUrl.startsWith("https://x.com/"), true);
  assert.equal(unrelated.seller.creatorCard.xHandle, "seller_x");

  assert.match(actions, /removeReportedListingXLocally\(reportedListingId\)/);
  assert.match(actions, /data\.reported\?\.xQuarantined === true[\s\S]*安全確認中/);
  assert.match(actions, /この端末では対象のXリンクを表示しません/);
  assert.match(previewAction, /removeReportedListingXLocally\(payload\.listingId\)/);
  assert.match(reportPanel, /権利・個人情報・成人向け・外部取引の通報/);
  assert.match(reportPanel, /出品本体を自動非表示にせず、参考Xリンクだけを直ちに安全確認中/);
  assert.match(reportPanel, /「その他」は運営確認用に記録/);
  assert.match(reportPanel, /購入・残高・ランキングには影響しません/);
});

test("buying requires a review step and describes the intangible encounter record", () => {
  const source = read("flea-market.js");
  const detail = between(source, "function renderListingDetailBody", "function renderReportPanel");
  const review = between(source, "function renderPurchaseReview", "function renderSuccess");
  const success = between(source, "function renderSuccess", "function renderHistoryReceipt");
  const eventBindings = between(source, "function bindEvents", "async function start");
  const favoriteBindings = between(
    eventBindings,
    'document.querySelectorAll("[data-flea-favorite]")',
    'document.querySelectorAll("[data-flea-unfavorite-seller]")',
  );

  assert.match(detail, /data-flea-purchase-review/);
  assert.doesNotMatch(detail, /data-flea-buy=/);
  assert.match(review, /data-flea-buy=/);
  assert.match(review, /届くもの[\s\S]*ゲーム内の出会いの記録/);
  assert.match(review, /届かないもの[\s\S]*実物・画像データ・衣服・権利/);
  assert.match(review, /発送、DMでの受け渡し、現金取引は発生しません/);
  assert.match(source, /購入は終点ではなく、推し始めるきっかけです/);
  assert.match(success, /renderFavoriteButton\(listing/);
  assert.match(success, /推し帳/);
  assert.match(success, /detailReturnDestination\(\)/);
  assert.match(favoriteBindings, /\|\| currentListing\(\)/);
});

test("the private favorite book is seller-keyed and exposes no popularity metric", () => {
  const source = read("flea-market.js");
  const favoriteButton = between(
    source,
    "function renderFavoriteButton",
    "function favoriteSnapshotFromListing",
  );

  assert.match(source, /"favorites"/);
  assert.match(source, /state\.favoriteSellers/);
  assert.match(source, /listing\.seller\.publicSellerId/);
  assert.match(source, /data-flea-favorite="\$\{escapeHtml\(listing\.id\)\}"/);
  assert.match(source, /data-flea-nav="favorites"/);
  assert.match(source, /非公開の推し帳/);
  assert.match(source, /normalizeFavoriteCreatorCard/);
  assert.match(source, /xHandle: _discardedXHandle/);
  assert.match(source, /追加した時点のカードです。Xリンクは保存せず/);
  assert.doesNotMatch(source, /favoriteCount|followerCount|人気順|売上順|登録人数/);

  const sandbox = {
    state: {
      ownListing: { id: "own-listing" },
      favorites: new Set(),
      busyAction: "",
    },
    escapeHtml: (value) => String(value ?? ""),
  };
  vm.runInNewContext(favoriteButton, sandbox);
  const ownListing = {
    id: "own-listing",
    isOwn: true,
    seller: { publicSellerId: "self" },
  };
  const otherListing = {
    id: "other-listing",
    isOwn: false,
    seller: { publicSellerId: "other" },
  };
  assert.equal(sandbox.renderFavoriteButton(ownListing), "");
  assert.match(sandbox.renderFavoriteButton(otherListing), /data-flea-favorite="other-listing"/);
});

test("detail navigation returns to its discovery origin", () => {
  const source = read("flea-market.js");
  const returnDestination = between(
    source,
    "function detailReturnDestination",
    "function hasTodayListing",
  );
  const detail = between(source, "function renderListingDetailBody", "function renderReportPanel");
  const eventBindings = between(source, "function bindEvents", "async function start");
  const detailBindings = between(
    eventBindings,
    'document.querySelectorAll("[data-flea-detail]")',
    'document.querySelectorAll("[data-flea-favorite]")',
  );
  assert.match(returnDestination, /state\.detailReturnScreen === "sellers"/);
  assert.match(returnDestination, /state\.detailReturnScreen === "favorites"/);
  assert.match(returnDestination, /screen: "shelf"/);
  assert.match(detail, /detailReturnDestination\(\)/);
  assert.match(detailBindings, /state\.detailReturnScreen/);
  assert.match(detailBindings, /state\.screen/);
  assert.doesNotMatch(detail, /data-flea-nav="shelf">棚へ戻る/);
  assert.match(detailBindings, /\["sellers", "favorites"\]\.includes\(state\.screen\)/);
});

test("category seller refresh and pagination preserve errors and the JST date boundary", () => {
  const source = read("flea-market.js");
  const refresh = between(source, "async function refreshState", "function previewCreatorCard");
  const directory = between(source, "function sellerDirectoryListings", "function activeListingForSeller");
  const actions = between(source, "async function performAction", "async function performPreviewAction");
  const eventBindings = between(source, "function bindEvents", "async function start");
  const sellerMore = between(
    eventBindings,
    'document.querySelector("[data-flea-sellers-more]")',
    'document.querySelectorAll("[data-flea-detail]")',
  );

  assert.match(refresh, /(?:state\.screen|screenBefore) === "sellers"/);
  assert.match(refresh, /CATEGORY_IDS\.has\(state\.categoryFilter\)/);
  assert.match(refresh, /action: "browse_sellers"/);
  assert.match(refresh, /category: (?:state\.categoryFilter|sellerCategory)/);
  assert.match(
    directory,
    /const directoryError = state\.categoryFilter === "all"[\s\S]*state\.browseErrorMessage[\s\S]*state\.sellerBrowseErrorMessage/,
  );
  assert.match(directory, /directoryError[\s\S]*role="alert"/);
  assert.match(actions, /action === "browse_sellers"[\s\S]*state\.sellerBrowseErrorMessage = message/);
  assert.match(sellerMore, /state\.expiresAt/);
  assert.match(sellerMore, /currentServerTime\(\) >= state\.expiresAt/);
  assert.match(sellerMore, /refreshState\(\)/);
  assert.match(
    sellerMore,
    /performAction\("browse_sellers", \{[\s\S]*category: state\.categoryFilter,[\s\S]*cursor: state\.nextSellerCursor/,
  );
});

test("same-screen refreshes preserve scroll and each lifecycle resets the sentinel", () => {
  const source = read("flea-market.js");
  const render = between(source, "function render() {", "function navigate");
  const start = between(source, "async function start", "function isActive");

  assert.match(source, /let lastRenderedScreen = "";/);
  assert.match(render, /const screenChanged = lastRenderedScreen !== state\.screen;/);
  assert.match(render, /lastRenderedScreen = state\.screen;[\s\S]*if \(screenChanged\) \{[\s\S]*window\.scrollTo\(0, 0\)/);
  assert.match(start, /active = true;[\s\S]*lastRenderedScreen = "";/);
});

test("direct Firestore access is denied and the callable starts with enforced App Check", () => {
  const rules = read("firestore.rules");
  const indexes = JSON.parse(read("firestore.indexes.json"));
  const server = read("functions/index.js");
  const rollout = require("../app-check-rollout");

  for (const collection of [
    "anjuPayFleaListings",
    "anjuPayFleaFavorites",
    "anjuPayFleaReceipts",
    "anjuPayFleaSales",
    "anjuPayFleaReports",
  ]) {
    const start = rules.indexOf(`match /${collection}/`);
    assert.notEqual(start, -1, `${collection} rules are missing`);
    assert.match(rules.slice(start, start + 280), /allow read, write: if false;/);
  }
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.anjuPayFleaAction, true);
  assert.match(server, /exports\.anjuPayFleaAction = onCall\(callableOptions\("anjuPayFleaAction"\)/);
  assert.match(server, /exports\.expireAnjuPayFleaListings = onSchedule\(\{[\s\S]*schedule: "every day 00:00"[\s\S]*timeZone: "Asia\/Tokyo"/);
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "anjuPayFleaListings"
      && index.fields.some((field) => field.fieldPath === "dateKey")
      && index.fields.some((field) => field.fieldPath === "status")
  )));
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "anjuPayFleaListings"
      && index.fields.some((field) => field.fieldPath === "status")
      && index.fields.some((field) => field.fieldPath === "expiresAt")
  )));
});

test("the wallet recognizes flea ledger entries without reclassifying VALUE MARKET", () => {
  const source = read("account.js");

  assert.match(source, /ANJU_PAY_CATEGORIES = new Set\(\[[^\]]*"market", "flea", "tip"/);
  assert.match(source, /flea_listing_fee: "AnjuPayフリマの出品料"/);
  assert.match(source, /flea_purchase: "AnjuPayフリマで一品を選んだ"/);
  assert.match(source, /flea_sale: "AnjuPayフリマで一品が選ばれた"/);
  assert.match(source, /entry\.category === "market"[\s\S]*entry\.category === "flea"/);
  assert.ok(
    source.indexOf('key.includes("flea_purchase")')
      < source.indexOf('!key.includes("market") && (key.includes("purchase")'),
    "flea purchases must be labeled before the generic shop-purchase fallback",
  );
});

test("the daily shelf pages safely without replacing loaded listings", () => {
  const source = read("flea-market.js");
  const css = read("flea-market.css");
  const initialState = between(source, "function createState", "function currentServerTime");
  const applyState = between(source, "function applyServerState", "function isCurrentLifecycle");
  const browseHelpers = between(source, "function appendUniqueBrowseListings", "function applyServerState");
  const shelf = between(source, "function renderShelf", "function activeListingForSeller");
  const actions = between(source, "async function performAction", "async function performPreviewAction");
  const previewAction = between(source, "async function performPreviewAction", "function openValueMarket");
  const eventBindings = between(source, "function bindEvents", "async function start");

  assert.match(initialState, /nextBrowseCursor: ""/);
  assert.match(initialState, /browseErrorMessage: ""/);
  assert.match(applyState, /const dateChanged = Boolean/);
  assert.match(source, /BROWSE_CURSOR_PATTERN = \/\^\[a-f0-9\]\{40\}\$\//);
  assert.match(source, /function normalizeBrowseCursor[\s\S]*BROWSE_CURSOR_PATTERN\.test\(cursor\)/);
  assert.match(applyState, /const appendBrowse = !dateChanged[\s\S]*data\.appendListings === true/);
  assert.match(applyState, /const preserveBrowse = !dateChanged && browseMode === "preserve"/);
  assert.match(applyState, /appendUniqueBrowseListings\(state\.listings, incomingListings\)/);
  assert.match(applyState, /mergeRefreshedBrowseListings\(state\.listings, incomingListings\)/);
  assert.match(applyState, /else \{[\s\S]*state\.listings = incomingListings;/);
  assert.match(applyState, /Object\.hasOwn\(data, "nextBrowseCursor"\)/);

  const sandbox = {};
  vm.runInNewContext(browseHelpers, sandbox);
  const current = [
    { id: "a", status: "active" },
    { id: "b", status: "active" },
  ];
  const incoming = [
    { id: "b", status: "sold" },
    { id: "c", status: "active" },
  ];
  const localValue = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(
    localValue(sandbox.appendUniqueBrowseListings(current, incoming)),
    [current[0], current[1], incoming[1]],
  );
  assert.deepEqual(
    localValue(sandbox.mergeRefreshedBrowseListings(current, incoming)),
    [incoming[0], incoming[1], current[0]],
  );
  assert.match(applyState, /if \(!preserveBrowse\)[\s\S]*normalizeBrowseCursor/);
  assert.match(shelf, /data-flea-browse-more/);
  assert.match(shelf, /続きを読み込んでいます…/);
  assert.match(shelf, /state\.browseErrorMessage[\s\S]*role="alert"/);
  assert.match(eventBindings, /performAction\("browse_more", \{ cursor \}\)/);
  assert.match(eventBindings, /currentServerTime\(\) >= state\.expiresAt[\s\S]*refreshState\(\)/);
  assert.match(actions, /action === "browse_more"[\s\S]*state\.browseErrorMessage = message/);
  assert.match(
    actions,
    /browseMode: action === "browse_more"[\s\S]*\? "append"[\s\S]*action === "create_listing"[\s\S]*\? "replace"[\s\S]*: "preserve"/,
  );
  const createAction = between(
    actions,
    'if (action === "create_listing")',
    '} else if (action === "buy")',
  );
  const previewCreate = between(
    previewAction,
    'if (action === "create_listing")',
    '} else if (action === "buy")',
  );
  assert.doesNotMatch(createAction, /state\.listings\s*=\s*\[createdListing,/);
  assert.match(createAction, /state\.sellerListings = \[\]/);
  assert.match(createAction, /state\.sellerListingsCategory = ""/);
  assert.match(createAction, /state\.nextSellerCursor = ""/);
  assert.doesNotMatch(previewCreate, /state\.listings\s*=\s*\[listing,/);
  assert.match(actions, /action === "buy"[\s\S]*entry\.id === requestedListingId \? \{ \.\.\.entry, status: "sold" \}/);
  assert.match(actions, /action === "cancel_listing"[\s\S]*entry\.id === requestedListingId \? \{ \.\.\.entry, status: "canceled" \}/);
  assert.match(previewAction, /action === "browse_more"[\s\S]*state\.nextBrowseCursor = ""/);
  assert.match(source, /nextBrowseCursor: ""[\s\S]*ownListing: screen === "own"/);
  assert.match(css, /\.flea-browse-more \{/);
});
