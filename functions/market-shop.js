"use strict";

const MARKET_SHOP_SCHEMA_VERSION = 1;
const MARKET_SHOP_NAME_MAX_LENGTH = 16;
const MARKET_SHOP_TAGLINE_MAX_LENGTH = 40;
const MARKET_SHOP_MAX_SPECIALTY_TAGS = 3;
const MARKET_SHOP_MAX_SERVICE_STYLES = 2;
const MARKET_SHOP_IMPRESSION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function catalogEntries(rows) {
  return Object.freeze(rows.map(([id, label, icon]) => Object.freeze({
    id,
    label,
    ...(icon ? { icon } : {}),
  })));
}

const MARKET_SHOP_CATALOG = Object.freeze({
  specialtyTags: catalogEntries([
    ["animals", "どうぶつ"],
    ["landscape", "風景"],
    ["food", "食べもの"],
    ["people", "人物"],
    ["illustration", "イラスト"],
    ["night", "夜景"],
    ["humor", "ネタ"],
    ["story", "物語"],
  ]),
  serviceStyles: catalogEntries([
    ["story", "物語で伝える"],
    ["technical", "技術を解説"],
    ["intuition", "直感で語る"],
    ["concise", "ひとこと勝負"],
    ["audio", "音声で熱く"],
    ["careful", "じっくり丁寧"],
  ]),
  themes: catalogEntries([
    ["standard", "スタンダード"],
    ["sakura", "さくら"],
    ["lavender", "ラベンダー"],
    ["mint", "ミント"],
    ["cream", "クリーム"],
    ["midnight", "ミッドナイト"],
  ]),
  seals: catalogEntries([
    ["heart", "ハート", "♥"],
    ["star", "スター", "★"],
    ["ribbon", "リボン", "◆"],
    ["flower", "フラワー", "✿"],
    ["cat", "キャット", "●"],
    ["moon", "ムーン", "☾"],
  ]),
  impressionTags: catalogEntries([
    ["kind", "やさしい接客"],
    ["insightful", "新しい魅力に気づけた"],
    ["memorable_voice", "言葉・声が印象的"],
    ["want_more", "もっと見たい"],
  ]),
  limits: Object.freeze({
    shopName: MARKET_SHOP_NAME_MAX_LENGTH,
    tagline: MARKET_SHOP_TAGLINE_MAX_LENGTH,
    specialtyTags: MARKET_SHOP_MAX_SPECIALTY_TAGS,
    serviceStyles: MARKET_SHOP_MAX_SERVICE_STYLES,
  }),
});

const CATALOG_IDS = Object.freeze({
  specialtyTags: new Set(MARKET_SHOP_CATALOG.specialtyTags.map(({ id }) => id)),
  serviceStyles: new Set(MARKET_SHOP_CATALOG.serviceStyles.map(({ id }) => id)),
  themes: new Set(MARKET_SHOP_CATALOG.themes.map(({ id }) => id)),
  seals: new Set(MARKET_SHOP_CATALOG.seals.map(({ id }) => id)),
  impressionTags: new Set(MARKET_SHOP_CATALOG.impressionTags.map(({ id }) => id)),
});

const DEFAULT_MARKET_SHOP = Object.freeze({
  shopName: "PLAYER",
  tagline: "",
  specialtyTags: Object.freeze([]),
  serviceStyles: Object.freeze([]),
  themeId: "standard",
  sealId: "heart",
  titleId: "",
  repeatWelcome: false,
});

function normalizedSingleLine(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f\r\n]/.test(String(value || ""));
}

function containsUrl(value) {
  return /(?:https?:\/\/|www[.．。]|(?:[\p{L}\p{N}-]+[.．。])+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?:[/?#:\s]|$))/iu
    .test(String(value || ""));
}

function uniqueCatalogSelection(value, catalogIds, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const normalized = value.map((entry) => normalizedSingleLine(entry));
  if (normalized.some((entry) => !catalogIds.has(entry))) return null;
  const unique = [...new Set(normalized)];
  return unique.length === normalized.length ? unique : null;
}

function validateMarketShopInput(value, { ownedTitleIds = [] } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const shopName = normalizedSingleLine(source.shopName);
  const tagline = normalizedSingleLine(source.tagline);
  const specialtyTags = uniqueCatalogSelection(
    source.specialtyTags,
    CATALOG_IDS.specialtyTags,
    MARKET_SHOP_MAX_SPECIALTY_TAGS,
  );
  const serviceStyles = uniqueCatalogSelection(
    source.serviceStyles,
    CATALOG_IDS.serviceStyles,
    MARKET_SHOP_MAX_SERVICE_STYLES,
  );
  const themeId = normalizedSingleLine(source.themeId);
  const sealId = normalizedSingleLine(source.sealId);
  const titleId = normalizedSingleLine(source.titleId);
  const ownedTitles = new Set(Array.isArray(ownedTitleIds) ? ownedTitleIds.map(String) : []);
  const errors = [];

  if (
    !shopName
    || shopName.length > MARKET_SHOP_NAME_MAX_LENGTH
    || hasControlCharacters(source.shopName)
    || containsUrl(shopName)
  ) {
    errors.push("shopName");
  }
  if (
    tagline.length > MARKET_SHOP_TAGLINE_MAX_LENGTH
    || hasControlCharacters(source.tagline)
    || containsUrl(tagline)
  ) {
    errors.push("tagline");
  }
  if (!specialtyTags) errors.push("specialtyTags");
  if (!serviceStyles) errors.push("serviceStyles");
  if (!CATALOG_IDS.themes.has(themeId)) errors.push("themeId");
  if (!CATALOG_IDS.seals.has(sealId)) errors.push("sealId");
  if (titleId && !ownedTitles.has(titleId)) errors.push("titleId");
  if (typeof source.repeatWelcome !== "boolean") errors.push("repeatWelcome");

  return {
    valid: errors.length === 0,
    errors,
    shop: {
      shopName,
      tagline,
      specialtyTags: specialtyTags || [],
      serviceStyles: serviceStyles || [],
      themeId: CATALOG_IDS.themes.has(themeId) ? themeId : DEFAULT_MARKET_SHOP.themeId,
      sealId: CATALOG_IDS.seals.has(sealId) ? sealId : DEFAULT_MARKET_SHOP.sealId,
      titleId,
      repeatWelcome: source.repeatWelcome === true,
    },
  };
}

function nonNegativeInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizedImpressionCounts(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(MARKET_SHOP_CATALOG.impressionTags.map(({ id }) => (
    [id, nonNegativeInteger(source[id])]
  )));
}

function normalizeStoredMarketShop(value, {
  fallbackName = DEFAULT_MARKET_SHOP.shopName,
  publicSellerId = "",
} = {}) {
  const source = value && typeof value === "object" ? value : {};
  const specialtyTags = uniqueCatalogSelection(
    source.specialtyTags,
    CATALOG_IDS.specialtyTags,
    MARKET_SHOP_MAX_SPECIALTY_TAGS,
  ) || [];
  const serviceStyles = uniqueCatalogSelection(
    source.serviceStyles,
    CATALOG_IDS.serviceStyles,
    MARKET_SHOP_MAX_SERVICE_STYLES,
  ) || [];
  const shopName = normalizedSingleLine(source.shopName || fallbackName);
  const tagline = normalizedSingleLine(source.tagline);
  const storedPublicSellerId = normalizedSingleLine(source.publicSellerId || publicSellerId);

  return {
    schemaVersion: MARKET_SHOP_SCHEMA_VERSION,
    publicSellerId: isValidPublicSellerId(storedPublicSellerId) ? storedPublicSellerId : "",
    shopName: shopName
      && shopName.length <= MARKET_SHOP_NAME_MAX_LENGTH
      && !hasControlCharacters(shopName)
      && !containsUrl(shopName)
      ? shopName
      : DEFAULT_MARKET_SHOP.shopName,
    tagline: tagline.length <= MARKET_SHOP_TAGLINE_MAX_LENGTH
      && !hasControlCharacters(tagline)
      && !containsUrl(tagline)
      ? tagline
      : "",
    specialtyTags,
    serviceStyles,
    themeId: CATALOG_IDS.themes.has(source.themeId) ? source.themeId : DEFAULT_MARKET_SHOP.themeId,
    sealId: CATALOG_IDS.seals.has(source.sealId) ? source.sealId : DEFAULT_MARKET_SHOP.sealId,
    titleId: normalizedSingleLine(source.titleId),
    repeatWelcome: source.repeatWelcome === true,
    issueCount: nonNegativeInteger(source.issueCount),
    bestSale: nonNegativeInteger(source.bestSale),
    uniqueBuyerCount: nonNegativeInteger(source.uniqueBuyerCount),
    repeatBuyerCount: nonNegativeInteger(source.repeatBuyerCount),
    favoriteCount: nonNegativeInteger(source.favoriteCount),
    impressionBuyerCount: nonNegativeInteger(source.impressionBuyerCount),
    impressionCounts: normalizedImpressionCounts(source.impressionCounts),
    createdAt: nonNegativeInteger(source.createdAt),
    updatedAt: nonNegativeInteger(source.updatedAt),
  };
}

function isValidPublicSellerId(value) {
  return /^[A-Za-z0-9_-]{16,40}$/.test(String(value || ""));
}

function marketShopReport(value) {
  const shop = normalizeStoredMarketShop(value);
  return {
    issueCount: shop.issueCount,
    bestSale: shop.bestSale,
    uniqueBuyerCount: shop.uniqueBuyerCount,
    repeatBuyerCount: shop.repeatBuyerCount,
    favoriteCount: shop.favoriteCount,
    impressionBuyerCount: shop.impressionBuyerCount,
    impressionCounts: shop.impressionCounts,
  };
}

function marketShopSalesCount(value, marketStats = {}) {
  const source = value && typeof value === "object" ? value : {};
  if (Object.prototype.hasOwnProperty.call(source, "issueCount")
    && typeof source.issueCount === "number"
    && Number.isFinite(source.issueCount)
    && source.issueCount >= 0) {
    return nonNegativeInteger(source.issueCount);
  }
  return nonNegativeInteger(marketStats?.salesCount);
}

function publicSellerShop(value, { marketStats = {} } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const verifiedSource = source.verified && typeof source.verified === "object"
    ? source.verified
    : {};
  const providedStats = marketStats && typeof marketStats === "object" ? marketStats : {};
  const effectiveStats = { ...verifiedSource, ...providedStats };
  const shop = normalizeStoredMarketShop(value);
  if (!shop.publicSellerId) return null;
  const hasStoredImpressionCounts = Object.prototype.hasOwnProperty.call(source, "impressionCounts");
  const impressionCounts = hasStoredImpressionCounts
    ? shop.impressionCounts
    : normalizedImpressionCounts(verifiedSource.impressions);
  const impressionTotal = Object.values(impressionCounts)
    .reduce((sum, count) => sum + nonNegativeInteger(count), 0);
  const repeatBuyerCount = Object.prototype.hasOwnProperty.call(source, "repeatBuyerCount")
    ? shop.repeatBuyerCount
    : nonNegativeInteger(verifiedSource.repeatBuyerCount);
  const hasStoredImpressionBuyerCount = Object.prototype.hasOwnProperty.call(
    source,
    "impressionBuyerCount",
  );
  const impressionsVisible = hasStoredImpressionBuyerCount
    ? shop.impressionBuyerCount >= 5 && impressionTotal > 0
    : verifiedSource.impressionsCollecting === false && impressionTotal > 0;
  const uniqueBuyerCount = Object.prototype.hasOwnProperty.call(source, "uniqueBuyerCount")
    ? shop.uniqueBuyerCount
    : nonNegativeInteger(verifiedSource.uniqueCounterparties);
  const bestSale = Object.prototype.hasOwnProperty.call(source, "bestSale")
    ? shop.bestSale
    : nonNegativeInteger(effectiveStats.bestSale);
  return {
    publicSellerId: shop.publicSellerId,
    shopName: shop.shopName,
    tagline: shop.tagline,
    specialtyTags: shop.specialtyTags,
    serviceStyles: shop.serviceStyles,
    themeId: shop.themeId,
    sealId: shop.sealId,
    titleId: shop.titleId,
    repeatWelcome: shop.repeatWelcome,
    verified: {
      salesCount: marketShopSalesCount(value, effectiveStats),
      bestSale,
      marketDays: nonNegativeInteger(effectiveStats.marketDays),
      uniqueCounterparties: uniqueBuyerCount,
      repeatBuyerCount,
      impressions: impressionsVisible ? impressionCounts : {},
      impressionsCollecting: !impressionsVisible,
    },
  };
}

function marketQueuesCompatible(first, second) {
  if (!first || !second || first.uid === second.uid || first.role === second.role) return false;
  const seller = first.role === "seller" ? first : second;
  const buyer = first.role === "buyer" ? first : second;
  if (Number(seller.listing?.askingPrice || 0) > Number(buyer.maxBudget || 0)) return false;
  const sellerBlocks = new Set(Array.isArray(seller.blockedUids) ? seller.blockedUids : []);
  const buyerBlocks = new Set(Array.isArray(buyer.blockedUids) ? buyer.blockedUids : []);
  if (sellerBlocks.has(buyer.uid) || buyerBlocks.has(seller.uid)) return false;
  if (buyer.matchMode === "favorites") {
    return buyer.selectedFavoriteSellerUid === seller.uid
      && seller.sellerShop?.repeatWelcome === true;
  }
  return true;
}

function marketQueueCandidateSessionKey(entry) {
  const uid = typeof entry?.uid === "string" ? entry.uid : "";
  if (!uid) return "";
  const queueToken = /^[a-f0-9]{32}$/.test(String(entry?.queueToken || ""))
    ? String(entry.queueToken)
    : "";
  return queueToken
    ? `${uid}:${queueToken}`
    : `${uid}:legacy:${nonNegativeInteger(entry?.joinedAt)}:${nonNegativeInteger(entry?.lastSeen)}`;
}

function selectMarketQueueCandidates(ownEntry, candidateEntries, {
  minimumLastSeen = 0,
  requireAppCheck = false,
} = {}) {
  const skippedSessions = new Set(
    Array.isArray(ownEntry?.skippedCandidateSessions)
      ? ownEntry.skippedCandidateSessions.map(String)
      : [],
  );
  const candidatesByUid = new Map();
  (Array.isArray(candidateEntries) ? candidateEntries : []).forEach((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.uid !== "string" || !entry.uid) return;
    const existing = candidatesByUid.get(entry.uid);
    if (!existing || nonNegativeInteger(entry.lastSeen) > nonNegativeInteger(existing.lastSeen)) {
      candidatesByUid.set(entry.uid, entry);
    }
  });
  return [...candidatesByUid.values()]
    .filter((entry) => entry.status === "waiting"
      && nonNegativeInteger(entry.lastSeen) >= nonNegativeInteger(minimumLastSeen)
      && (!requireAppCheck || entry.appCheckVerified === true)
      && !skippedSessions.has(marketQueueCandidateSessionKey(entry))
      && marketQueuesCompatible(ownEntry, entry))
    .sort((first, second) => (
      nonNegativeInteger(first.joinedAt) - nonNegativeInteger(second.joinedAt)
      || nonNegativeInteger(first.lastSeen) - nonNegativeInteger(second.lastSeen)
      || first.uid.localeCompare(second.uid)
    ));
}

function selectMarketQueueCandidate(ownEntry, candidateEntries, options = {}) {
  return selectMarketQueueCandidates(ownEntry, candidateEntries, options)[0] || null;
}

function shouldReplaceMarketQueue(currentEntry, incomingEntry) {
  if (!currentEntry || currentEntry.status !== "waiting") return true;
  const currentRequestedAt = nonNegativeInteger(
    currentEntry.queueRequestedAt ?? currentEntry.joinedAt,
  );
  const incomingRequestedAt = nonNegativeInteger(
    incomingEntry?.queueRequestedAt ?? incomingEntry?.joinedAt,
  );
  if (incomingRequestedAt !== currentRequestedAt) {
    return incomingRequestedAt > currentRequestedAt;
  }
  const currentToken = String(currentEntry.queueToken || "");
  const incomingToken = String(incomingEntry?.queueToken || "");
  return incomingToken >= currentToken;
}

function marketImpressionDecision({
  existingRoomImpression = false,
  lastImpressionAt = 0,
  now = Date.now(),
} = {}) {
  if (existingRoomImpression) {
    return {
      action: "noop",
      retryAfterMs: 0,
      impressionRecorded: false,
      alreadyRecorded: true,
      addsDistinctBuyer: false,
    };
  }
  const retryAfterMs = Math.max(
    0,
    nonNegativeInteger(lastImpressionAt) + MARKET_SHOP_IMPRESSION_COOLDOWN_MS - nonNegativeInteger(now),
  );
  const action = retryAfterMs > 0 ? "cooldown" : "write";
  return {
    action,
    retryAfterMs,
    impressionRecorded: action === "write",
    alreadyRecorded: false,
    addsDistinctBuyer: action === "write" && nonNegativeInteger(lastImpressionAt) === 0,
  };
}

function marketSaleRelationshipUpdate(value, dateKey, now = Date.now()) {
  const previousSaleCount = nonNegativeInteger(value?.saleCount);
  const normalizedDateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
    ? String(dateKey)
    : "";
  const lastSaleDateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(value?.lastSaleDateKey || ""))
    ? String(value.lastSaleDateKey)
    : "";
  const repeatCounted = value?.repeatCounted === true;
  return {
    saleCount: previousSaleCount + 1,
    firstSaleAt: nonNegativeInteger(value?.firstSaleAt) || nonNegativeInteger(now),
    lastSaleAt: nonNegativeInteger(now),
    lastSaleDateKey: normalizedDateKey || lastSaleDateKey,
    repeatCounted: repeatCounted || (
      previousSaleCount > 0
      && Boolean(normalizedDateKey)
      && normalizedDateKey !== lastSaleDateKey
    ),
    addsUniqueBuyer: previousSaleCount === 0,
    addsRepeatBuyer: !repeatCounted
      && previousSaleCount > 0
      && Boolean(normalizedDateKey)
      && normalizedDateKey !== lastSaleDateKey,
  };
}

function applyMarketSaleToShop(value, relationshipUpdate, now = Date.now(), salePrice = 0) {
  const shop = normalizeStoredMarketShop(value);
  shop.issueCount += 1;
  shop.bestSale = Math.max(shop.bestSale, nonNegativeInteger(salePrice));
  if (relationshipUpdate?.addsUniqueBuyer === true) shop.uniqueBuyerCount += 1;
  if (relationshipUpdate?.addsRepeatBuyer === true) shop.repeatBuyerCount += 1;
  shop.updatedAt = nonNegativeInteger(now);
  return shop;
}

module.exports = Object.freeze({
  DEFAULT_MARKET_SHOP,
  MARKET_SHOP_CATALOG,
  MARKET_SHOP_IMPRESSION_COOLDOWN_MS,
  MARKET_SHOP_MAX_SERVICE_STYLES,
  MARKET_SHOP_MAX_SPECIALTY_TAGS,
  MARKET_SHOP_NAME_MAX_LENGTH,
  MARKET_SHOP_SCHEMA_VERSION,
  MARKET_SHOP_TAGLINE_MAX_LENGTH,
  applyMarketSaleToShop,
  containsUrl,
  isValidPublicSellerId,
  marketImpressionDecision,
  marketQueueCandidateSessionKey,
  marketQueuesCompatible,
  marketSaleRelationshipUpdate,
  marketShopReport,
  marketShopSalesCount,
  normalizeStoredMarketShop,
  publicSellerShop,
  selectMarketQueueCandidate,
  selectMarketQueueCandidates,
  shouldReplaceMarketQueue,
  validateMarketShopInput,
});
