const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const functionsRoot = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(functionsRoot, "index.js"), "utf8");

test("favorite matchmaking resolves one owned public shop and bypasses the broad first-30 query", () => {
  assert.match(indexSource, /data\?\.favoritePublicSellerId/);
  assert.match(indexSource, /\.where\("publicSellerId", "==", favoritePublicSellerId\)/);
  assert.match(indexSource, /selectedFavoriteSellerUid/);
  assert.match(indexSource, /marketQueueRef\(ownEntry\.selectedFavoriteSellerUid\)\.get\(\)/);
  assert.match(
    indexSource,
    /\.where\("selectedFavoriteSellerUid", "==", ownEntry\.uid\)[\s\S]*?\.where\("status", "==", "waiting"\)[\s\S]*?\.where\("lastSeen", ">=", minimumLastSeen\)[\s\S]*?\.limit\(40\)/,
  );
  assert.match(indexSource, /for \(let page = 0; page < 3; page \+= 1\)/);
  assert.match(indexSource, /\.slice\(0, 8\)/);
  assert.match(indexSource, /\.where\("maxBudget", ">=", Number\(ownEntry\.listing\?\.askingPrice/);
  assert.match(indexSource, /\.where\("listing\.askingPrice", "<=", Number\(ownEntry\.maxBudget/);
  assert.match(indexSource, /heartbeatMarketQueue[\s\S]*?tryMatchMarketQueueSession\(uid, outcome\.entry\)/);
  assert.doesNotMatch(indexSource, /favoriteSellerUids/);
});

test("matching rechecks both live block directions inside the room-creation transaction", () => {
  assert.match(
    indexSource,
    /const sellerBlockRef = marketShopBlockRef\(sellerUid, buyerUid\)/,
  );
  assert.match(
    indexSource,
    /const buyerBlockRef = marketShopBlockRef\(buyerUid, sellerUid\)/,
  );
  assert.match(
    indexSource,
    /sellerBlockSnapshot\.exists\s*\|\|\s*buyerBlockSnapshot\.exists/,
  );
});

test("queue join, cancel, and heartbeat use one session-aware transaction boundary", () => {
  assert.match(indexSource, /function marketQueueControlRef\(uid\)/);
  assert.match(indexSource, /queueToken,\s*queueRequestedAt,/);
  assert.match(
    indexSource,
    /async function claimMarketQueue[\s\S]*?transaction\.get\(queueRef\)[\s\S]*?transaction\.get\(activeRef\)[\s\S]*?transaction\.get\(controlRef\)/,
  );
  assert.match(
    indexSource,
    /sameMarketQueueSession\(currentOwn, ownEntry\.queueToken\)/,
  );
  assert.match(
    indexSource,
    /latestRequestedAt > 0[\s\S]*?!shouldReplaceMarketQueue\([\s\S]*?latestToken/,
  );
  assert.match(
    indexSource,
    /latestRequestedAt: claimedEntry\.queueRequestedAt,\s*latestToken: claimedEntry\.queueToken/,
  );
  assert.match(
    indexSource,
    /async function cancelMarketQueue[\s\S]*?firestore\.runTransaction[\s\S]*?transaction\.get\(activeRef\)[\s\S]*?transaction\.get\(queueRef\)[\s\S]*?generation: Math\.min/,
  );
  assert.match(
    indexSource,
    /async function heartbeatMarketQueue[\s\S]*?firestore\.runTransaction[\s\S]*?transaction\.get\(queueRef\)[\s\S]*?transaction\.get\(activeRef\)/,
  );
});

test("favorite matches recheck the live favorite and seller welcome setting", () => {
  assert.match(
    indexSource,
    /const favoriteRef = marketShopFavoriteRef\(buyerUid, sellerUid\)/,
  );
  assert.match(
    indexSource,
    /favoriteSnapshot\.get\("buyerUid"\) === buyer\.uid[\s\S]*?favoriteSnapshot\.get\("sellerUid"\) === seller\.uid/,
  );
  assert.match(
    indexSource,
    /targetedBuyer && \(!validFavorite \|\| liveSellerShop\.repeatWelcome !== true\)/,
  );
  assert.match(
    indexSource,
    /queueSnapshot\.get\("role"\) === "seller"[\s\S]*?sellerShop: publicSellerShop\(savedShop/,
  );
  assert.match(
    indexSource,
    /async function validateTargetedMarketQueueSession[\s\S]*?liveSellerShop\.repeatWelcome === true/,
  );
  assert.match(
    indexSource,
    /selectedFavoritePublicSellerId/,
  );
});

test("rejected candidate sessions rotate and heartbeat matching is throttled", () => {
  assert.match(indexSource, /function nextSkippedMarketQueueSessions/);
  assert.match(
    indexSource,
    /skippedCandidateSessions: nextSkippedMarketQueueSessions\(currentOwn, candidateEntry\)/,
  );
  assert.match(
    indexSource,
    /Number\(current\.lastMatchAttemptAt \|\| 0\) <= now - 10_000/,
  );
  assert.match(
    indexSource,
    /if \(!outcome\.shouldMatch\) \{[\s\S]*?return \{ status: "waiting", roomId: "" \};/,
  );
  assert.match(
    indexSource,
    /actorQueueSnapshot\.get\("status"\) === "waiting"[\s\S]*?blockedUids/,
  );
});

test("certificate shop snapshots keep the presented identity and refresh verified totals", () => {
  const buyBranch = indexSource.indexOf('} else if (action === "buy") {');
  const statsUpdate = indexSource.indexOf(
    "Object.assign(sellerStats, addMarketTransaction",
    buyBranch,
  );
  const shopSnapshot = indexSource.indexOf(
    "const liveSellerShop = publicSellerShop",
    buyBranch,
  );
  const presentedSnapshot = indexSource.indexOf(
    "const presentedSellerShop = publicSellerShop(room.sellerShop)",
    buyBranch,
  );
  const certificateWrite = indexSource.indexOf(
    "transaction.create(certificateRef",
    buyBranch,
  );
  assert.ok(buyBranch >= 0);
  assert.ok(statsUpdate > buyBranch);
  assert.ok(shopSnapshot > statsUpdate);
  assert.ok(presentedSnapshot > shopSnapshot);
  assert.ok(certificateWrite > shopSnapshot);
  assert.match(
    indexSource,
    /shopName: presentedSellerShop\.shopName,[\s\S]*?shopCharmId: presentedSellerShop\.shopCharmId,[\s\S]*?verified: liveSellerShop\.verified,/,
  );
});

test("shop customization ownership is read once and returns free plus owned stamp charms", () => {
  assert.match(
    indexSource,
    /async function ownedMarketProductIds\(uid\)[\s\S]*?readLegacyEconomy\(uid\)[\s\S]*?collection\("economyPurchases"\)[\s\S]*?return ownedIds;/,
  );
  assert.match(
    indexSource,
    /async function ownedMarketCustomizationIds\(uid\)[\s\S]*?type === "stamp"[\s\S]*?FREE_MARKET_SHOP_CHARM_IDS/,
  );
  assert.match(
    indexSource,
    /const customizationIds = await ownedMarketCustomizationIds\(uid\);[\s\S]*?validateMarketShopInput\(data, customizationIds\)/,
  );
  assert.match(
    indexSource,
    /ownedShopCharmIds: customizationIds\.ownedShopCharmIds/g,
  );
});

test("same-room impression retries return the stored tag and explicit idempotency flags", () => {
  assert.match(
    indexSource,
    /responseImpressionTag = marketShopImpressionTag\(impressionSnapshot\.get\("impressionTag"\)\)/,
  );
  assert.match(indexSource, /impressionRecorded,\s*alreadyRecorded,/);
  assert.match(indexSource, /if \(decision\.addsDistinctBuyer\) shop\.impressionBuyerCount \+= 1;/);
});

test("impression cooldown preserves relationship updates and result cards count only earlier purchases", () => {
  assert.match(
    indexSource,
    /if \(!favoriteRequested && !blockRequested\) \{\s*throw new HttpsError\([\s\S]*?30日ごとに1回送れます。/,
  );
  assert.match(
    indexSource,
    /alreadyRecorded = true;\s*responseImpressionTag = marketShopImpressionTag\(relationship\.lastImpressionTag\);/,
  );
  assert.match(
    indexSource,
    /previousPurchases: Math\.max\(0, saleRelationship\.saleCount - 1\),\s*metBefore: saleRelationship\.saleCount > 1,/,
  );
});

test("unblocking can restore only the favorite removed by that buyer's block", () => {
  assert.match(
    indexSource,
    /const restoringFavoriteFromBlock = blockValue === false[\s\S]*?blockSnapshot\.get\("removedFavorite"\) === true;/,
  );
  assert.match(
    indexSource,
    /&& !pitchCompleted\s*&& !restoringFavoriteFromBlock/,
  );
  assert.match(
    indexSource,
    /removedFavorite: actorRole === "buyer"\s*&& \(favoriteSnapshot\.exists \|\| blockSnapshot\.get\("removedFavorite"\) === true\)/,
  );
  assert.match(
    indexSource,
    /data\?\.favorite === true && blockSnapshot\.exists && blockValue !== false/,
  );
});

test("actual shop best sale is independent from same-day ranking deduplication", () => {
  assert.match(
    indexSource,
    /sellerShopResult = applyMarketSaleToShop\([\s\S]*?issuedAt,\s*amount,\s*\)/,
  );
  assert.match(
    indexSource,
    /bestSale: Object\.prototype\.hasOwnProperty\.call\([\s\S]*?shop\.bestSale/,
  );
});

test("favorite books are bounded and use denormalized sale data for normal reads", () => {
  assert.match(
    indexSource,
    /marketShopFavoritesRef\(buyerUid\)\.limit\(100\)/,
  );
  assert.match(
    indexSource,
    /favoriteBookSnapshot\.size >= 100/,
  );
  assert.match(
    indexSource,
    /marketShopPublicRef\(publicSellerId\)\.get\(\)/,
  );
  assert.match(
    indexSource,
    /typeof storedSaleCount === "number"\s*\?\s*null\s*:\s*await marketShopRelationshipRef/,
  );
  assert.match(
    indexSource,
    /saleCount: saleRelationship\.saleCount/,
  );
});
