"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const serviceModule = require("../anju-pay-flea-service");

const servicePath = path.resolve(__dirname, "..", "anju-pay-flea-service.js");
const source = fs.readFileSync(servicePath, "utf8");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("service is an injected factory with the three required operations", () => {
  assert.equal(typeof serviceModule.createAnjuPayFleaService, "function");
  assert.match(source, /function createAnjuPayFleaService\(deps\)/);
  for (const dependency of [
    "firestore",
    "realtime",
    "HttpsError",
    "ensureWallet",
    "walletRef",
    "anjuPayLedgerConfigRef",
    "walletData",
    "walletCreditCapacity",
    "debitPoints",
    "creditPoints",
    "stageAnjuPayOpening",
    "appendAnjuPayEntry",
    "anjuPayWalletMetadataPatch",
    "anjuPayEntryId",
    "mirrorWallet",
    "bestEffort",
  ]) {
    assert.match(source, new RegExp(`"${dependency}"`));
  }
  assert.match(source, /async getState\(uid\)/);
  assert.match(source, /async performAction\(uid, data\)/);
  assert.match(source, /async expireListings\(now\)/);
});

test("market achievements are read-only decoration and never mutate market progression", () => {
  assert.match(source, /require\("\.\/achievements"\)/);
  assert.match(source, /firestore\.collection\("achievementProfiles"\)\.doc\(uid\)/);
  assert.match(source, /definition\.scope !== "market"/);
  assert.match(source, /normalizeAchievementProfile/);
  assert.doesNotMatch(source, /collection\("valueMarket/);
  assert.doesNotMatch(source, /marketStatsRef|addMarketTransaction|ensureAchievementState/);
  assert.doesNotMatch(source, /unlockAchievements|ensureMarketShop|applyMarketSaleToShop/);
  assert.doesNotMatch(source, /syncCreatorCardGrowth|RankedPairs|AchievementPairs/);
  assert.doesNotMatch(source, /MarketCertificates|patronFund|marketShop/i);
  const save = between("async function saveUrikkoCard", "async function setFavorite");
  assert.doesNotMatch(
    save,
    /walletRef|ensureWallet|debitPoints|creditPoints|stageAnjuPayOpening|appendAnjuPayEntry/,
  );
  assert.doesNotMatch(save, /transaction\.(?:set|update|create)\(profileReference/);
});

test("all flea persistence stays in dedicated callable-only collections", () => {
  const rules = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "firestore.rules"),
    "utf8",
  );
  for (const collection of [
    "anjuPayFleaListings",
    "anjuPayFleaSales",
    "anjuPayFleaReceipts",
    "anjuPayFleaFavorites",
    "anjuPayFleaReports",
    "anjuPayFleaSellerCards",
  ]) {
    assert.match(source, new RegExp(`collection\\("${collection}"\\)`));
  }
  for (const action of [
    "state",
    "browse_more",
    "browse_sellers",
    "create_listing",
    "buy",
    "cancel_listing",
    "save_urikko_card",
    "set_favorite",
    "report",
  ]) {
    assert.match(source, new RegExp(`"${action}"`));
  }
  assert.match(
    rules,
    /match \/anjuPayFleaSellerCards\/\{uid\} \{[\s\S]*?allow read, write: if false;[\s\S]*?\}/,
  );
});

test("public responses are allowlisted and recursively reject private UIDs", () => {
  assert.match(
    source,
    /PRIVATE_FLEA_RESPONSE_FIELDS[\s\S]*?"sellerUid"[\s\S]*?"buyerUid"[\s\S]*?"reporterUid"/,
  );
  assert.match(
    source,
    /function assertNoPrivateFleaFields[\s\S]*?PRIVATE_FLEA_RESPONSE_FIELDS\.has\(key\)/,
  );
  for (const sanitizer of [
    "publicFleaListing",
    "publicFleaReceipt",
    "publicCreatorCard",
    "publicUrikkoCard",
  ]) {
    assert.match(source, new RegExp(`function ${sanitizer}\\(`));
  }
  const card = between("function publicCreatorCard", "async function readCreatorCard");
  for (const field of [
    "schemaVersion",
    "name",
    "titleId",
    "text",
    "creatorType",
    "cardTheme",
    "growthLevel",
    "achievementShowcase",
    "xHandle",
  ]) {
    assert.match(card, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(card, /sellerUid|buyerUid|reporterUid/);
  const urikkoCard = between(
    "function publicUrikkoCard",
    "function highestUnlockedMarketAchievements",
  );
  for (const field of [
    "schemaVersion",
    "tagline",
    "themeId",
    "sealId",
    "achievementIds",
  ]) {
    assert.match(urikkoCard, new RegExp(`\\b${field}\\b`));
  }
  assert.match(urikkoCard, /definition\.scope !== "market"/);
  assert.match(
    urikkoCard,
    /achievementIds\.length >= FLEA_SELLER_CARD_MAX_ACHIEVEMENTS/,
  );
  assert.doesNotMatch(
    urikkoCard,
    /sellerUid|buyerUid|reporterUid|grossSales|netSales|bestSale|salesCount|purchaseCount|favoriteCount|viewCount|impression|ranking|marketShop|publicMarketSellerId/i,
  );
  assert.match(source, /function safePublicXPostUrl[\s\S]*?normalizeFleaXPostUrl\(value\)/);
  assert.match(
    source,
    /function withoutCreatorCardXHandle[\s\S]*?xHandle: _discardedXHandle[\s\S]*?function privateFavoriteCreatorCard[\s\S]*?withoutCreatorCardXHandle\(value\)/,
  );
  const listing = between("function publicFleaListing", "function publicFleaReceipt");
  assert.match(
    listing,
    /id:[\s\S]*?dateKey:[\s\S]*?category:[\s\S]*?title:[\s\S]*?description:[\s\S]*?price:[\s\S]*?status,[\s\S]*?createdAt:[\s\S]*?expiresAt:[\s\S]*?isOwn,[\s\S]*?seller:/,
  );
  assert.match(
    listing,
    /publicSellerId:[\s\S]*?name:[\s\S]*?creatorCard:[\s\S]*?urikkoCard:/,
  );
  assert.doesNotMatch(listing, /\blistingFee\b|\bcreatorCardEntryId\b|\bsellerName:/);
  const receipt = between("function publicFleaReceipt", "function publicFleaFavorite");
  assert.match(
    receipt,
    /id:[\s\S]*?role:[\s\S]*?status: "sold"[\s\S]*?price:[\s\S]*?feeAmount:[\s\S]*?sellerProceeds:[\s\S]*?counterpartyName:[\s\S]*?listing:[\s\S]*?createdAt:/,
  );
});

test("state returns a bounded first page in stable browse order", () => {
  const indexes = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "..", "..", "firestore.indexes.json"),
    "utf8",
  ));
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "anjuPayFleaListings"
    && ["dateKey", "status", "browseOrder"].every((fieldPath) => (
      index.fields.some((field) => (
        field.fieldPath === fieldPath && field.order === "ASCENDING"
      ))
    ))
  )));
  const state = between("async function getStateInternal", "async function mirrorCommittedBalances");
  const browse = between("function activeBrowseQuery", "async function getStateInternal");
  assert.match(source, /const STATE_LISTING_LIMIT = 50;/);
  assert.match(browse, /\.where\("dateKey", "==", dateKey\)/);
  assert.match(browse, /\.where\("status", "==", "active"\)/);
  assert.match(browse, /\.orderBy\("browseOrder", "asc"\)/);
  assert.match(browse, /\.limit\(STATE_LISTING_LIMIT \+ 1\)/);
  assert.match(browse, /documents\.slice\(0, STATE_LISTING_LIMIT\)/);
  assert.match(browse, /nextBrowseCursor/);
  assert.match(browse, /hasMore: Boolean\(nextBrowseCursor\)/);
  assert.match(state, /publicFleaListing/);
  assert.match(
    between("function publicFleaListing", "function publicFleaReceipt"),
    /effectiveFleaListingStatus/,
  );
  assert.match(state, /fleaJstDateKey\(serverNow\) !== dateKey/);
  assert.match(state, /getStateInternal\(uid, false\)/);
  assert.match(state, /sellerCardRef\(uid\)\.get\(\)/);
  assert.match(state, /achievementProfileRef\(uid\)\.get\(\)/);
  assert.match(state, /receiptItemsRef\(uid\)[\s\S]*?\.orderBy\("createdAt", "desc"\)[\s\S]*?\.limit\(STATE_RECEIPT_LIMIT\)/);
  assert.match(
    state,
    /serverNow,[\s\S]*?dateKey,[\s\S]*?expiresAt,[\s\S]*?policy: policy\(\),[\s\S]*?balance:[\s\S]*?\.\.\.browsePage,[\s\S]*?ownListing,[\s\S]*?favorites,[\s\S]*?receipts,[\s\S]*?urikkoCard:[\s\S]*?unlockedMarketAchievementIds:/,
  );
});


test("browse_more validates a same-day 40-hex cursor and preserves collision tie-breaks", () => {
  const more = between("async function getMoreBrowseListings", "async function mirrorCommittedBalances");
  assert.match(source, /function requireBrowseCursor[\s\S]*?trim\(\)\.toLowerCase\(\)[\s\S]*?FLEA_ID_PATTERN\.test\(cursor\)/);
  assert.match(more, /const cursorSnapshot = await listingRef\(cursor\)\.get\(\)/);
  assert.match(more, /cursorListing\.dateKey !== dateKey/);
  assert.match(more, /FLEA_ID_PATTERN\.test\(String\(cursorListing\.browseOrder/);
  assert.match(more, /\.startAfter\(cursorSnapshot\)/);
  assert.match(more, /\.limit\(STATE_LISTING_LIMIT \+ 1\)/);
  assert.match(more, /implicit document-ID tie-break/);
  assert.match(more, /fleaJstDateKey\(serverNow\) !== dateKey/);
  assert.match(more, /appendListings: true/);
  assert.match(more, /serverNow,[\s\S]*?dateKey,[\s\S]*?expiresAt,[\s\S]*?\.\.\.publicBrowsePage/);
  assert.match(source, /action === "browse_more"[\s\S]*?getMoreBrowseListings\(uid, data\.cursor\)/);
});

test("browse_sellers is category-scoped and keeps the neutral daily order", () => {
  const indexes = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "..", "..", "firestore.indexes.json"),
    "utf8",
  ));
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "anjuPayFleaListings"
    && ["dateKey", "status", "category", "browseOrder"].every((fieldPath) => (
      index.fields.some((field) => (
        field.fieldPath === fieldPath && field.order === "ASCENDING"
      ))
    ))
  )));
  const sellerQuery = between("function activeSellerBrowseQuery", "function publicBrowsePage");
  assert.match(sellerQuery, /\.where\("dateKey", "==", dateKey\)/);
  assert.match(sellerQuery, /\.where\("status", "==", "active"\)/);
  assert.match(sellerQuery, /\.where\("category", "==", category\)/);
  assert.deepEqual(
    [...sellerQuery.matchAll(/\.orderBy\("([^"]+)", "asc"\)/g)]
      .map((match) => match[1]),
    ["browseOrder"],
  );
  assert.doesNotMatch(
    sellerQuery,
    /sales|purchase|favorite|view|impression|ranking|achievement|theme|seal/i,
  );

  const sellers = between(
    "async function getSellerBrowseListings",
    "async function mirrorCommittedBalances",
  );
  assert.match(sellers, /requireFleaCategory\(categoryValue\)/);
  assert.match(sellers, /activeSellerBrowseQuery\(dateKey, category\)/);
  assert.match(sellers, /cursorListing\.dateKey !== dateKey/);
  assert.match(sellers, /cursorListing\.category !== category/);
  assert.match(sellers, /\.startAfter\(cursorSnapshot\)/);
  assert.match(sellers, /\.limit\(STATE_LISTING_LIMIT \+ 1\)/);
  assert.match(sellers, /appendSellerListings: Boolean\(cursor\)/);
  assert.match(sellers, /sellerListings: page\.listings/);
  assert.match(sellers, /nextSellerCursor: page\.nextBrowseCursor/);
  assert.match(sellers, /hasMoreSellers: page\.hasMore/);
  assert.match(
    source,
    /action === "browse_sellers"[\s\S]*?getSellerBrowseListings\(uid, data\.category, data\.cursor\)/,
  );
  const create = between("async function createListing", "async function purchaseListing");
  assert.match(
    create,
    /const browseOrder = anjuPayEntryId\(`flea-browse:\$\{dateKey\}:\$\{listingId\}`\)/,
  );
});

test("seller cards accept only owner-selected unlocked market achievements", () => {
  const verified = between("function verifiedUrikkoCard", "async function readCreatorCard");
  assert.match(verified, /normalizeFleaSellerCardInput\(value\)/);
  assert.match(verified, /normalizeAchievementProfile\(profileValue\)/);
  assert.match(
    verified,
    /!definition \|\| definition\.scope !== "market" \|\| !profile\.unlocked\[id\]/,
  );
  assert.match(verified, /const selectedFamilies = new Set\(\)/);
  assert.match(verified, /selectedFamilies\.has\(definition\.family\)/);
  assert.match(verified, /highestUnlockedMarketAchievements\(profile\)/);

  const save = between("async function saveUrikkoCard", "async function setFavorite");
  const firstWrite = Math.min(
    ...["transaction.set(", "transaction.update("]
      .map((marker) => save.indexOf(marker))
      .filter((index) => index >= 0),
  );
  for (const read of [
    "transaction.get(cardReference)",
    "transaction.get(profileReference)",
    "transaction.get(todayListingReference)",
  ]) {
    assert.ok(save.indexOf(read) >= 0 && save.indexOf(read) < firstWrite, read);
  }
  assert.match(save, /verifiedUrikkoCard\(data, profileSnapshot\.data\(\)\)/);
  assert.match(save, /transaction\.set\(cardReference, savedCard\)/);
  assert.match(
    save,
    /listing\.sellerUid === uid[\s\S]*?listing\.status === "active"[\s\S]*?effectiveFleaListingStatus\(listing, attemptNow\) === "active"/,
  );
  assert.match(
    save,
    /transaction\.update\(todayListingReference, \{[\s\S]*?urikkoCard: publicCard/,
  );
  assert.doesNotMatch(
    save,
    /walletRef|ensureWallet|debitPoints|creditPoints|stageAnjuPayOpening|appendAnjuPayEntry|marketStatsRef|valueMarket|unlockAchievements|ensureMarketShop|syncCreatorCardGrowth/,
  );
  assert.doesNotMatch(save, /transaction\.(?:set|update|create)\(profileReference/);
  assert.match(
    source,
    /action === "save_urikko_card"[\s\S]*?mutation = await saveUrikkoCard\(uid, data\)/,
  );
});

test("creator-card identity is owner-verified and X posts must use its public handle", () => {
  assert.match(source, /online\/topMessageEntriesByUser\/\$\{uid\}/);
  assert.match(source, /online\/topMessageOwners\/\$\{entryId\}/);
  assert.match(source, /online\/topMessages\/\$\{entryId\}/);
  assert.match(source, /String\(ownerSnapshot\.val\(\) \|\| ""\) !== uid/);
  assert.match(
    source,
    /normalized\.xPostUrl[\s\S]*?creatorIdentity\.card\?\.xHandle[\s\S]*?toLowerCase\(\) !== postHandle\.toLowerCase\(\)/,
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|request\s*\(/);
});

test("listing creation reads every transaction dependency before charging once", () => {
  const create = between("async function createListing", "async function purchaseListing");
  const firstWrite = Math.min(
    ...["stageAnjuPayOpening(", "transaction.create(", "transaction.set("]
      .map((marker) => create.indexOf(marker))
      .filter((index) => index >= 0),
  );
  for (const read of [
    "transaction.get(walletReference)",
    "transaction.get(listingReference)",
    "transaction.get(anjuPayLedgerConfigRef())",
    "transaction.get(sellerCardReference)",
  ]) {
    assert.ok(create.indexOf(read) >= 0 && create.indexOf(read) < firstWrite, read);
  }
  assert.match(create, /current\.payloadHash === payloadHash/);
  assert.match(create, /const attemptNow = currentTime\(\)/);
  assert.match(create, /fleaJstDateKey\(attemptNow\) !== dateKey \|\| attemptNow >= expiresAt/);
  assert.match(create, /occurredAt: attemptNow/);
  assert.match(create, /current\.status === "active"/);
  assert.match(create, /throw httpsError\("already-exists"/);
  assert.match(create, /debitPoints\(wallet, FLEA_LISTING_FEE\)/);
  assert.match(create, /walletCreditCapacity\(wallet\) < settlement\.sellerProceeds/);
  assert.match(
    create,
    /normalizeFleaSellerName\(creatorIdentity\.card\?\.name \|\| data\?\.name\)/,
  );
  assert.match(
    create,
    /creatorIdentity\.card\?\.text[\s\S]*?assertSafeFleaListingText\(sellerName, creatorIdentity\.card\.text\)/,
  );
  assert.match(create, /category: "flea"/);
  assert.match(create, /labelKey: "anju_pay_flea_listing_fee"/);
  const feeEntry = create.slice(
    create.indexOf('kind: "flea_listing_fee"'),
    create.indexOf("storedListing = {"),
  );
  assert.doesNotMatch(feeEntry, /listingTitle/);
  assert.match(create, /transaction\.create\(listingReference, storedListing\)/);
  assert.match(create, /urikkoCard: publicUrikkoCard\(sellerCardSnapshot\.data\(\)\)/);
  assert.match(create, /mirrorCommittedBalances\("anjuPayFleaCreate"/);
});

test("purchase is one atomic sale with two wallets, two receipts, and one fee sink", () => {
  const purchase = between("async function purchaseListing", "async function cancelListing");
  for (const read of [
    "transaction.get(listingReference)",
    "transaction.get(saleReference)",
    "transaction.get(buyerWalletReference)",
    "transaction.get(sellerWalletReference)",
    "transaction.get(anjuPayLedgerConfigRef())",
  ]) {
    assert.match(purchase, new RegExp(read.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(purchase, /listing\.sellerUid === uid/);
  assert.match(purchase, /effectiveFleaListingStatus\(listing, attemptNow\) !== "active"/);
  assert.match(purchase, /const attemptNow = currentTime\(\)/);
  assert.match(purchase, /occurredAt: attemptNow/);
  assert.match(purchase, /walletCreditCapacity\(sellerWallet\) < settlement\.sellerProceeds/);
  assert.match(purchase, /debitPoints\(buyerWallet, settlement\.grossAmount\)/);
  assert.match(purchase, /creditPoints\(sellerWallet, settlement\.sellerProceeds\)/);
  assert.match(purchase, /const groupId = anjuPayEntryId\(`flea-sale:\$\{listingId\}`\)/);
  assert.match(purchase, /labelKey: "anju_pay_flea_purchase"/);
  assert.match(purchase, /labelKey: "anju_pay_flea_sale"/);
  assert.match(purchase, /labelKey: "anju_pay_flea_sale_gross"/);
  assert.match(purchase, /labelKey: "anju_pay_flea_success_fee"/);
  assert.equal((purchase.match(/transaction\.create\([^,]*ReceiptReference/g) || []).length, 2);
  assert.match(purchase, /transaction\.create\(saleReference, saleRecord\)/);
  assert.match(purchase, /if \(saleSnapshot\.exists\)[\s\S]*?saved\.buyerUid !== uid/);
  assert.match(purchase, /mirrorCommittedBalances\("anjuPayFleaPurchase"/);
});

test("cancel, favorite, and report remain non-rewarding and idempotent", () => {
  const cancel = between("async function cancelListing", "async function setFavorite");
  const favorite = between("async function setFavorite", "async function reportListing");
  const report = between("async function reportListing", "async function performActionInternal");
  assert.match(cancel, /status: "canceled"/);
  assert.doesNotMatch(cancel, /creditPoints|appendAnjuPayEntry|mirrorWallet/);
  assert.match(favorite, /requireListingId\(data\?\.listingId\)/);
  assert.match(favorite, /data\.favorite === false && data\.publicSellerId != null/);
  assert.match(favorite, /requirePublicSellerId\(data\.publicSellerId\)/);
  assert.match(favorite, /if \(!snapshot\.exists\) return;[\s\S]*?transaction\.delete\(reference\)/);
  assert.match(favorite, /transaction\.get\(listingReference\)/);
  assert.match(favorite, /listing\.sellerUid === uid/);
  assert.match(favorite, /publicSellerId,[\s\S]*?name,[\s\S]*?creatorCard:[\s\S]*?updatedAt,/);
  assert.match(favorite, /transaction\.set\(reference, favoriteSeller\)/);
  assert.match(favorite, /transaction\.delete\(reference\)/);
  assert.doesNotMatch(favorite, /favoriteCount|counter|increment/i);
  assert.match(favorite, /privateFavoriteCreatorCard\(listing\.sellerCard\)/);
  assert.match(favorite, /const attemptNow = currentTime\(\)/);
  assert.match(favorite, /const canFavoriteActiveListing = listing\.status === "active"[\s\S]*?effectiveFleaListingStatus\(listing, attemptNow\) === "active"/);
  assert.match(favorite, /const canFavoritePurchasedListing = listing\.status === "sold"[\s\S]*?listing\.buyerUid === uid/);
  assert.match(favorite, /data\.favorite[\s\S]*?!canFavoriteActiveListing[\s\S]*?!canFavoritePurchasedListing/);
  assert.match(favorite, /const updatedAt = attemptNow/);
  assert.ok(favorite.indexOf("data.favorite === false") < favorite.indexOf("const listingId"));
  assert.match(favorite, /currentCount >= STATE_FAVORITE_LIMIT/);
  assert.match(favorite, /count: favoriteSnapshot\.exists \? Math\.max\(1, currentCount\) : currentCount \+ 1/);
  assert.match(favorite, /count: Math\.max\(0, currentCount - 1\)/);
  assert.match(source, /const \{ xHandle: _discardedXHandle, \.\.\.snapshot \} = card/);
  assert.match(report, /isFleaReportReason\(reason\)/);
  assert.match(report, /listing\.sellerUid === uid/);
  assert.match(report, /existingReportSnapshot\.exists/);
  assert.match(report, /reporterUid: uid/);
  assert.match(
    report,
    /const existingReason = existingReport[\s\S]*?savedReason = existingReason \|\| reason/,
  );
  assert.match(
    report,
    /savedReason === "other"[\s\S]*?X_QUARANTINE_REPORT_REASONS\.has\(reason\)[\s\S]*?savedReason = reason/,
  );
  assert.match(
    report,
    /savedReason !== existingReason[\s\S]*?evidencePatch\.reason = savedReason[\s\S]*?evidencePatch\.escalatedAt = reportedAt/,
  );
  assert.match(report, /X_QUARANTINE_REPORT_REASONS\.has\(savedReason\)/);
  assert.match(report, /transaction\.get\(saleReference\)/);
  assert.match(report, /transaction\.get\(buyerReceiptReference\)/);
  assert.match(report, /transaction\.get\(sellerReceiptReference\)/);
  assert.match(report, /originalXPostUrl/);
  assert.match(report, /originalXHandle/);
  assert.match(report, /transaction\.update\(reference,[\s\S]*?xConsent: false/);
  assert.match(report, /transaction\.update\(saleReference, patchFor\(sale\)\)/);
  assert.match(
    report,
    /transaction\.update\(buyerReceiptReference, patchFor\(buyerReceipt\)\)/,
  );
  assert.match(
    report,
    /transaction\.update\(sellerReceiptReference, patchFor\(sellerReceipt\)\)/,
  );
  assert.match(report, /xQuarantined = true/);
  assert.doesNotMatch(report, /status: "hidden"|status: "canceled"|auto/i);
});

test("expiry materialization rechecks each document transactionally", () => {
  const expiry = between("async function expireListingsInternal", "return Object.freeze({");
  assert.match(expiry, /\.where\("status", "==", "active"\)/);
  assert.match(expiry, /\.where\("expiresAt", "<=", serverNow\)/);
  assert.match(expiry, /\.limit\(EXPIRY_BATCH_LIMIT\)/);
  assert.match(expiry, /firestore\.runTransaction/);
  assert.match(expiry, /transaction\.get\(document\.ref\)/);
  assert.match(
    expiry,
    /current\.status !== "active"[\s\S]*?current\.expiresAt[\s\S]*?> serverNow/,
  );
  assert.match(expiry, /status: "expired"/);
});
