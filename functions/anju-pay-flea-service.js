"use strict";

const {
  FLEA_CATEGORIES,
  FLEA_DESCRIPTION_MAX_LENGTH,
  FLEA_LISTING_FEE,
  FLEA_PRICE_OPTIONS,
  FLEA_SCHEMA_VERSION,
  FLEA_SELLER_CARD_MAX_ACHIEVEMENTS,
  FLEA_SELLER_CARD_SCHEMA_VERSION,
  FLEA_SELLER_CARD_SEALS,
  FLEA_SELLER_CARD_TAGLINE_MAX_LENGTH,
  FLEA_SELLER_CARD_THEMES,
  FLEA_SUCCESS_FEE_BASIS_POINTS,
  FLEA_TITLE_MAX_LENGTH,
  assertSafeFleaListingText,
  effectiveFleaListingStatus,
  fleaExpiresAt,
  fleaJstDateKey,
  fleaListingId,
  fleaPublicSellerId,
  fleaSaleSettlement,
  isFleaReportReason,
  normalizeFleaListingInput,
  normalizeFleaSellerCardInput,
  normalizeFleaSellerName,
  normalizeFleaXPostUrl,
} = require("./anju-pay-flea");
const {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_DEFINITIONS,
  eligibleAchievementIds,
  normalizeAchievementProfile,
  normalizeFleaStats,
  unlockAchievements,
} = require("./achievements");

const FLEA_ACTIONS = Object.freeze([
  "state",
  "browse_more",
  "browse_sellers",
  "create_listing",
  "buy",
  "cancel_listing",
  "save_urikko_card",
  "set_favorite",
  "report",
]);
const PRIVATE_FLEA_RESPONSE_FIELDS = Object.freeze(new Set([
  "sellerUid",
  "buyerUid",
  "reporterUid",
  "soldAt",
]));
const REQUIRED_DEPENDENCIES = Object.freeze([
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
  "ensureFleaAchievementStats",
  "fleaAchievementStatsRef",
]);
const FLEA_ID_PATTERN = /^[a-f0-9]{40}$/;
const CREATOR_CARD_ENTRY_ID_PATTERN = /^[-0-9A-Z_a-z]{16,40}$/;
const CREATOR_CARD_X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const CREATOR_CARD_FIELDS = Object.freeze([
  "schemaVersion",
  "name",
  "titleId",
  "text",
  "creatorType",
  "cardTheme",
  "growthLevel",
  "achievementShowcase",
  "xHandle",
]);
const STATE_LISTING_LIMIT = 50;
const STATE_FAVORITE_LIMIT = 100;
const STATE_RECEIPT_LIMIT = 30;
const EXPIRY_BATCH_LIMIT = 100;
const PUBLIC_FLEA_LISTING_STATUSES = Object.freeze(["active", "sold"]);
const DEFAULT_FLEA_SELLER_CARD = Object.freeze({
  schemaVersion: FLEA_SELLER_CARD_SCHEMA_VERSION,
  tagline: "",
  themeId: "standard",
  sealId: "heart",
  achievementIds: Object.freeze([]),
});
const X_QUARANTINE_REPORT_REASONS = Object.freeze(new Set([
  "rights",
  "privacy",
  "adult",
  "external_trade",
]));

function createAnjuPayFleaService(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("AnjuPay flea service dependencies are required.");
  }
  for (const name of REQUIRED_DEPENDENCIES) {
    if (deps[name] == null) {
      throw new TypeError(`Missing AnjuPay flea service dependency: ${name}`);
    }
  }

  const {
    firestore,
    realtime,
    HttpsError,
    ensureWallet,
    walletRef,
    anjuPayLedgerConfigRef,
    walletData,
    walletCreditCapacity,
    debitPoints,
    creditPoints,
    stageAnjuPayOpening,
    appendAnjuPayEntry,
    anjuPayWalletMetadataPatch,
    anjuPayEntryId,
    mirrorWallet,
    bestEffort,
    ensureFleaAchievementStats,
    fleaAchievementStatsRef,
  } = deps;
  const currentTime = typeof deps.now === "function" ? deps.now : Date.now;

  if (typeof firestore.collection !== "function"
      || typeof firestore.runTransaction !== "function"
      || typeof realtime.ref !== "function") {
    throw new TypeError("AnjuPay flea service storage dependencies are invalid.");
  }

  const listingsCollection = () => firestore.collection("anjuPayFleaListings");
  const listingRef = (listingId) => listingsCollection().doc(listingId);
  const saleRef = (listingId) => firestore.collection("anjuPayFleaSales").doc(listingId);
  const receiptItemsRef = (uid) => firestore
    .collection("anjuPayFleaReceipts")
    .doc(uid)
    .collection("items");
  const receiptRef = (uid, listingId) => receiptItemsRef(uid).doc(listingId);
  const favoriteOwnerRef = (uid) => firestore
    .collection("anjuPayFleaFavorites")
    .doc(uid);
  const favoriteSellersRef = (uid) => favoriteOwnerRef(uid).collection("sellers");
  const favoriteRef = (uid, publicSellerId) => favoriteSellersRef(uid).doc(publicSellerId);
  const reportRef = (reportId) => firestore.collection("anjuPayFleaReports").doc(reportId);
  const sellerCardRef = (uid) => firestore.collection("anjuPayFleaSellerCards").doc(uid);
  const achievementProfileRef = (uid) => firestore.collection("achievementProfiles").doc(uid);

  async function ensureFleaAchievementState(uid) {
    await ensureFleaAchievementStats(uid);
    const statsReference = fleaAchievementStatsRef(uid);
    const profileReference = achievementProfileRef(uid);
    let result = null;
    await firestore.runTransaction(async (transaction) => {
      const [statsSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(statsReference),
        transaction.get(profileReference),
      ]);
      const stats = normalizeFleaStats(statsSnapshot.data());
      const unlockResult = unlockAchievements(
        profileSnapshot.data(),
        eligibleAchievementIds({ fleaStats: stats, scope: "flea" }),
      );
      if (!profileSnapshot.exists || unlockResult.newlyUnlocked.length) {
        transaction.set(profileReference, unlockResult.profile);
      }
      result = {
        stats,
        profile: unlockResult.profile,
        newlyUnlocked: unlockResult.newlyUnlocked,
      };
    });
    return result;
  }

  function httpsError(code, message) {
    return new HttpsError(code, message);
  }

  function mapHelperError(error) {
    if (error instanceof HttpsError) return error;
    if (error instanceof RangeError) {
      return httpsError("invalid-argument", error.message || "入力内容を確認してください。");
    }
    return error;
  }

  function requireUid(uid) {
    if (typeof uid !== "string" || !uid || uid.length > 128 || CONTROL_CHARACTER_PATTERN.test(uid)) {
      throw httpsError("unauthenticated", "匿名ログインが必要です。");
    }
    return uid;
  }

  function requireListingId(value) {
    const listingId = typeof value === "string" ? value.trim() : "";
    if (!FLEA_ID_PATTERN.test(listingId)) {
      throw httpsError("invalid-argument", "出品を確認してください。");
    }
    return listingId;
  }

  function requireBrowseCursor(value) {
    const cursor = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!FLEA_ID_PATTERN.test(cursor)) {
      throw httpsError("invalid-argument", "一覧を最初から読み直してください。");
    }
    return cursor;
  }

  function requirePublicSellerId(value) {
    const publicSellerId = typeof value === "string" ? value.trim() : "";
    if (!FLEA_ID_PATTERN.test(publicSellerId)) {
      throw httpsError("invalid-argument", "出品者を確認してください。");
    }
    return publicSellerId;
  }

  function requireFleaCategory(value) {
    const category = typeof value === "string" ? value.trim() : "";
    if (!FLEA_CATEGORIES.includes(category)) {
      throw httpsError("invalid-argument", "カテゴリを選び直してください。");
    }
    return category;
  }

  function finiteTimestamp(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeBalance(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function safeOneLine(value, maximumLength, fallback = "") {
    if (typeof value !== "string") return fallback;
    const normalized = value.normalize("NFKC").trim();
    if (!normalized
        || normalized.length > maximumLength
        || /[\r\n\u2028\u2029]/u.test(normalized)
        || CONTROL_CHARACTER_PATTERN.test(normalized)) {
      return fallback;
    }
    return normalized;
  }

  function publicCreatorCard(value) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
    if (!source || Number(source.schemaVersion) !== 2) return null;
    const name = safeOneLine(source.name, 16);
    if (!name) return null;
    const card = {
      schemaVersion: 2,
      name,
      titleId: safeOneLine(source.titleId, 80),
      text: safeOneLine(source.text, 30),
      creatorType: safeOneLine(source.creatorType, 24),
      cardTheme: safeOneLine(source.cardTheme, 40),
      growthLevel: Math.min(5, Math.max(1, Math.floor(Number(source.growthLevel) || 1))),
      achievementShowcase: safeOneLine(source.achievementShowcase, 160),
    };
    const xHandle = safeOneLine(source.xHandle, 15);
    if (CREATOR_CARD_X_HANDLE_PATTERN.test(xHandle)) card.xHandle = xHandle;
    return card;
  }

  function creatorCardXHandle(value) {
    const handle = safeOneLine(value?.xHandle, 15);
    return CREATOR_CARD_X_HANDLE_PATTERN.test(handle) ? handle : "";
  }

  function withoutCreatorCardXHandle(value) {
    const card = publicCreatorCard(value);
    if (!card) return null;
    const { xHandle: _discardedXHandle, ...snapshot } = card;
    return snapshot;
  }

  function privateFavoriteCreatorCard(value) {
    return withoutCreatorCardXHandle(value);
  }

  function safeUrikkoTagline(value) {
    const tagline = safeOneLine(value, FLEA_SELLER_CARD_TAGLINE_MAX_LENGTH);
    if (!tagline) return "";
    try {
      assertSafeFleaListingText(tagline, "");
      return tagline;
    } catch {
      return "";
    }
  }

  function publicUrikkoCard(value) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : DEFAULT_FLEA_SELLER_CARD;
    const themeId = FLEA_SELLER_CARD_THEMES.includes(source.themeId)
      ? source.themeId
      : DEFAULT_FLEA_SELLER_CARD.themeId;
    const sealId = FLEA_SELLER_CARD_SEALS.includes(source.sealId)
      ? source.sealId
      : DEFAULT_FLEA_SELLER_CARD.sealId;
    const achievementIds = [];
    for (const candidate of Array.isArray(source.achievementIds) ? source.achievementIds : []) {
      const id = String(candidate || "");
      const definition = ACHIEVEMENT_BY_ID.get(id);
      if (
        !definition
        || definition.scope !== "market"
        || achievementIds.includes(id)
      ) continue;
      achievementIds.push(id);
      if (achievementIds.length >= FLEA_SELLER_CARD_MAX_ACHIEVEMENTS) break;
    }
    return {
      schemaVersion: FLEA_SELLER_CARD_SCHEMA_VERSION,
      tagline: safeUrikkoTagline(source.tagline),
      themeId,
      sealId,
      achievementIds,
    };
  }

  function highestUnlockedMarketAchievements(profileValue) {
    const profile = normalizeAchievementProfile(profileValue);
    const highestByFamily = new Map();
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      if (definition.scope !== "market" || !profile.unlocked[definition.id]) continue;
      const current = highestByFamily.get(definition.family);
      if (!current || definition.level > current.level) {
        highestByFamily.set(definition.family, definition);
      }
    }
    return [...highestByFamily.values()]
      .sort((left, right) => (
        Number(profile.unlocked[right.id] || 0) - Number(profile.unlocked[left.id] || 0)
        || right.level - left.level
        || left.id.localeCompare(right.id)
      ));
  }

  function verifiedUrikkoCard(value, profileValue) {
    const normalized = normalizeFleaSellerCardInput(value);
    const profile = normalizeAchievementProfile(profileValue);
    const selectedFamilies = new Set();
    const achievementIds = normalized.achievementIds.map((id) => {
      const definition = ACHIEVEMENT_BY_ID.get(id);
      if (!definition || definition.scope !== "market" || !profile.unlocked[id]) {
        throw httpsError(
          "failed-precondition",
          "売りっ子カードには、本人が解除済みの推し値市場実績だけを飾れます。",
        );
      }
      if (selectedFamilies.has(definition.family)) {
        throw httpsError(
          "invalid-argument",
          "同じ系統の推し値市場実績は、いちばん新しい1件だけを選んでください。",
        );
      }
      selectedFamilies.add(definition.family);
      return highestUnlockedMarketAchievements(profile)
        .find((candidate) => candidate.family === definition.family)?.id || id;
    });
    return publicUrikkoCard({
      ...normalized,
      achievementIds,
    });
  }

  async function readCreatorCard(uid) {
    const entrySnapshot = await realtime.ref(`online/topMessageEntriesByUser/${uid}`).get();
    const entryId = String(entrySnapshot.val() || "");
    if (!CREATOR_CARD_ENTRY_ID_PATTERN.test(entryId)) {
      return { entryId: "", card: null };
    }
    const [ownerSnapshot, cardSnapshot] = await Promise.all([
      realtime.ref(`online/topMessageOwners/${entryId}`).get(),
      realtime.ref(`online/topMessages/${entryId}`).get(),
    ]);
    if (String(ownerSnapshot.val() || "") !== uid) {
      return { entryId: "", card: null };
    }
    const card = publicCreatorCard(cardSnapshot.val());
    return card ? { entryId, card } : { entryId: "", card: null };
  }

  function xPostHandle(value) {
    if (!value) return "";
    try {
      const parsed = new URL(value);
      const segments = parsed.pathname.split("/");
      return CREATOR_CARD_X_HANDLE_PATTERN.test(segments[1] || "") ? segments[1] : "";
    } catch {
      return "";
    }
  }

  function assertNoPrivateFleaFields(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    for (const [key, nested] of Object.entries(value)) {
      if (PRIVATE_FLEA_RESPONSE_FIELDS.has(key)) {
        throw new Error(`Private AnjuPay flea response field: ${key}`);
      }
      assertNoPrivateFleaFields(nested, seen);
    }
    return value;
  }

  function safePublicXPostUrl(value) {
    if (typeof value !== "string" || !value) return "";
    try {
      return normalizeFleaXPostUrl(value);
    } catch {
      return "";
    }
  }

  function publicFleaListing(listingId, value, viewerUid, now) {
    const source = value && typeof value === "object" ? value : {};
    const status = effectiveFleaListingStatus(source, now);
    const isOwn = source.sellerUid === viewerUid;
    const listing = {
      id: FLEA_ID_PATTERN.test(String(listingId || "")) ? String(listingId) : "",
      dateKey: /^\d{4}-\d{2}-\d{2}$/.test(String(source.dateKey || ""))
        ? String(source.dateKey)
        : "",
      category: FLEA_CATEGORIES.includes(source.category) ? source.category : "",
      title: typeof source.title === "string" ? source.title.slice(0, FLEA_TITLE_MAX_LENGTH) : "",
      description: typeof source.description === "string"
        ? source.description.slice(0, FLEA_DESCRIPTION_MAX_LENGTH)
        : "",
      price: FLEA_PRICE_OPTIONS.includes(Number(source.price)) ? Number(source.price) : 0,
      status,
      createdAt: finiteTimestamp(source.createdAt),
      expiresAt: finiteTimestamp(source.expiresAt),
      isOwn,
      seller: {
        publicSellerId: FLEA_ID_PATTERN.test(String(source.publicSellerId || ""))
          ? String(source.publicSellerId)
          : "",
        name: safeOneLine(source.sellerName, 16, "PLAYER"),
        creatorCard: publicCreatorCard(source.sellerCard),
        urikkoCard: publicUrikkoCard(source.urikkoCard),
      },
    };
    const xPostUrl = safePublicXPostUrl(source.xPostUrl);
    if (xPostUrl) {
      listing.xPostUrl = xPostUrl;
    }
    if (isOwn && status === "sold") {
      listing.feeAmount = Math.max(0, Math.floor(Number(source.saleFee) || 0));
      listing.sellerProceeds = Math.max(0, Math.floor(Number(source.sellerProceeds) || 0));
    }
    return assertNoPrivateFleaFields(listing);
  }

  function publicFleaReceipt(receiptId, value) {
    const source = value && typeof value === "object" ? value : {};
    const receipt = {
      id: FLEA_ID_PATTERN.test(String(receiptId || "")) ? String(receiptId) : "",
      role: source.role === "seller" ? "seller" : "buyer",
      status: "sold",
      price: FLEA_PRICE_OPTIONS.includes(Number(source.purchasePrice))
        ? Number(source.purchasePrice)
        : 0,
      feeAmount: Math.max(0, Math.floor(Number(source.feeAmount) || 0)),
      sellerProceeds: Math.max(0, Math.floor(Number(source.sellerProceeds) || 0)),
      counterpartyName: safeOneLine(
        source.counterpartyName ?? source.counterpartName,
        16,
        "PLAYER",
      ),
      listing: {
        category: FLEA_CATEGORIES.includes(source.category) ? source.category : "",
        title: typeof source.listingTitle === "string"
          ? source.listingTitle.slice(0, FLEA_TITLE_MAX_LENGTH)
          : "",
        description: typeof source.description === "string"
          ? source.description.slice(0, FLEA_DESCRIPTION_MAX_LENGTH)
          : "",
      },
      createdAt: finiteTimestamp(source.createdAt),
    };
    const xPostUrl = safePublicXPostUrl(source.xPostUrl);
    if (xPostUrl) {
      receipt.listing.xPostUrl = xPostUrl;
    }
    return assertNoPrivateFleaFields(receipt);
  }

  function publicFleaFavorite(documentId, value) {
    const source = value && typeof value === "object" ? value : {};
    const publicSellerId = FLEA_ID_PATTERN.test(String(source.publicSellerId || ""))
      ? String(source.publicSellerId)
      : (FLEA_ID_PATTERN.test(String(documentId || "")) ? String(documentId) : "");
    const favorite = { publicSellerId };
    const name = safeOneLine(source.name, 16);
    const creatorCard = privateFavoriteCreatorCard(source.creatorCard);
    const urikkoCard = publicUrikkoCard(source.urikkoCard);
    if (name) favorite.name = name;
    if (creatorCard) favorite.creatorCard = creatorCard;
    favorite.urikkoCard = urikkoCard;
    const updatedAt = finiteTimestamp(source.updatedAt);
    if (updatedAt) favorite.updatedAt = updatedAt;
    return assertNoPrivateFleaFields(favorite);
  }

  function policy() {
    return {
      listingFee: FLEA_LISTING_FEE,
      prices: [...FLEA_PRICE_OPTIONS],
      successFeeBasisPoints: FLEA_SUCCESS_FEE_BASIS_POINTS,
      minimumSuccessFee: 1,
    };
  }

  function publicBrowseQuery(dateKey) {
    return listingsCollection()
      .where("dateKey", "==", dateKey)
      .where("status", "in", PUBLIC_FLEA_LISTING_STATUSES)
      .orderBy("browseOrder", "asc");
  }

  function publicSellerBrowseQuery(dateKey, category) {
    return listingsCollection()
      .where("dateKey", "==", dateKey)
      .where("status", "in", PUBLIC_FLEA_LISTING_STATUSES)
      .where("category", "==", category)
      .orderBy("browseOrder", "asc");
  }

  function publicBrowsePage(snapshot, uid, serverNow) {
    const documents = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    const pageDocuments = documents.slice(0, STATE_LISTING_LIMIT);
    const listings = pageDocuments
      .map((document) => publicFleaListing(document.id, document.data(), uid, serverNow))
      .filter((listing) => (
        listing.id && PUBLIC_FLEA_LISTING_STATUSES.includes(listing.status)
      ));
    const hasMore = documents.length > STATE_LISTING_LIMIT;
    const lastDocumentId = String(pageDocuments.at(-1)?.id || "");
    const nextBrowseCursor = hasMore && FLEA_ID_PATTERN.test(lastDocumentId)
      ? lastDocumentId
      : null;
    return assertNoPrivateFleaFields({
      listings,
      nextBrowseCursor,
      hasMore: Boolean(nextBrowseCursor),
    });
  }

  function getFirstBrowsePage(dateKey) {
    // Firestore appends document ID as the deterministic final ordering field.
    return publicBrowseQuery(dateKey)
      .limit(STATE_LISTING_LIMIT + 1)
      .get();
  }

  async function getStateInternal(uidValue, retryAtDateBoundary = true) {
    const uid = requireUid(uidValue);
    const requestNow = currentTime();
    const dateKey = fleaJstDateKey(requestNow);
    const expiresAt = fleaExpiresAt(requestNow);
    const ownListingId = fleaListingId(uid, dateKey);
    const [
      initializedBalance,
      listingsSnapshot,
      ownListingSnapshot,
      favoritesSnapshot,
      receiptsSnapshot,
      sellerCardSnapshot,
      achievementState,
    ] = await Promise.all([
      ensureWallet(uid),
      getFirstBrowsePage(dateKey),
      listingRef(ownListingId).get(),
      favoriteSellersRef(uid).limit(STATE_FAVORITE_LIMIT).get(),
      receiptItemsRef(uid)
        .orderBy("createdAt", "desc")
        .limit(STATE_RECEIPT_LIMIT)
        .get(),
      sellerCardRef(uid).get(),
      ensureFleaAchievementState(uid),
    ]);
    const serverNow = currentTime();
    if (fleaJstDateKey(serverNow) !== dateKey) {
      if (retryAtDateBoundary) return getStateInternal(uid, false);
      throw httpsError(
        "aborted",
        "日付が変わったため、AnjuPayフリマをもう一度更新してください。",
      );
    }
    const favorites = (favoritesSnapshot.docs || [])
      .map((snapshot) => publicFleaFavorite(snapshot.id, snapshot.data()))
      .filter((favorite) => Boolean(favorite.publicSellerId));
    const browsePage = publicBrowsePage(listingsSnapshot, uid, serverNow);
    const ownListing = ownListingSnapshot.exists
      ? publicFleaListing(
        ownListingSnapshot.id,
        ownListingSnapshot.data(),
        uid,
        serverNow,
      )
      : null;
    const receipts = (receiptsSnapshot.docs || []).map((snapshot) => (
      publicFleaReceipt(snapshot.id, snapshot.data())
    ));
    return assertNoPrivateFleaFields({
      serverNow,
      dateKey,
      expiresAt,
      policy: policy(),
      balance: safeBalance(initializedBalance),
      ...browsePage,
      ownListing,
      favorites,
      receipts,
      urikkoCard: publicUrikkoCard(sellerCardSnapshot.data()),
      unlockedMarketAchievementIds: highestUnlockedMarketAchievements(
        achievementState.profile,
      ).map((definition) => definition.id),
      newlyUnlocked: Object.keys(achievementState.profile.pendingUnlocks)
        .filter((id) => ACHIEVEMENT_BY_ID.get(id)?.scope === "flea"),
      fleaAchievementStats: achievementState.stats,
    });
  }

  async function getMoreBrowseListings(uidValue, cursorValue) {
    const uid = requireUid(uidValue);
    const cursor = requireBrowseCursor(cursorValue);
    const requestNow = currentTime();
    const dateKey = fleaJstDateKey(requestNow);
    const expiresAt = fleaExpiresAt(requestNow);
    const cursorSnapshot = await listingRef(cursor).get();
    const cursorListing = cursorSnapshot.exists ? cursorSnapshot.data() || {} : null;
    if (
      !cursorListing
      || cursorListing.dateKey !== dateKey
      || !FLEA_ID_PATTERN.test(String(cursorListing.browseOrder || ""))
    ) {
      throw httpsError("invalid-argument", "一覧を最初から読み直してください。");
    }
    // A DocumentSnapshot cursor carries Firestore's implicit document-ID tie-break,
    // so equal browseOrder values cannot skip or duplicate a paid listing.
    const listingsSnapshot = await publicBrowseQuery(dateKey)
      .startAfter(cursorSnapshot)
      .limit(STATE_LISTING_LIMIT + 1)
      .get();
    const serverNow = currentTime();
    if (fleaJstDateKey(serverNow) !== dateKey) {
      throw httpsError(
        "aborted",
        "日付が変わったため、AnjuPayフリマを最初から更新してください。",
      );
    }
    return assertNoPrivateFleaFields({
      serverNow,
      dateKey,
      expiresAt,
      appendListings: true,
      ...publicBrowsePage(listingsSnapshot, uid, serverNow),
    });
  }

  async function getSellerBrowseListings(uidValue, categoryValue, cursorValue = "") {
    const uid = requireUid(uidValue);
    const category = requireFleaCategory(categoryValue);
    const cursor = cursorValue == null || cursorValue === ""
      ? ""
      : requireBrowseCursor(cursorValue);
    const requestNow = currentTime();
    const dateKey = fleaJstDateKey(requestNow);
    const expiresAt = fleaExpiresAt(requestNow);
    let query = publicSellerBrowseQuery(dateKey, category);
    if (cursor) {
      const cursorSnapshot = await listingRef(cursor).get();
      const cursorListing = cursorSnapshot.exists ? cursorSnapshot.data() || {} : null;
      if (
        !cursorListing
        || cursorListing.dateKey !== dateKey
        || cursorListing.category !== category
        || !FLEA_ID_PATTERN.test(String(cursorListing.browseOrder || ""))
      ) {
        throw httpsError("invalid-argument", "売りっ子一覧を最初から読み直してください。");
      }
      // The cursor may have sold since the previous page. Its immutable day, category,
      // ordering value and document ID are sufficient to continue without skipping anyone.
      query = query.startAfter(cursorSnapshot);
    }
    const listingsSnapshot = await query.limit(STATE_LISTING_LIMIT + 1).get();
    const serverNow = currentTime();
    if (fleaJstDateKey(serverNow) !== dateKey) {
      throw httpsError(
        "aborted",
        "日付が変わったため、売りっ子一覧を最初から更新してください。",
      );
    }
    const page = publicBrowsePage(listingsSnapshot, uid, serverNow);
    return assertNoPrivateFleaFields({
      serverNow,
      dateKey,
      expiresAt,
      category,
      appendSellerListings: Boolean(cursor),
      sellerListings: page.listings,
      nextSellerCursor: page.nextBrowseCursor,
      hasMoreSellers: page.hasMore,
    });
  }

  async function mirrorCommittedBalances(label, balances) {
    await bestEffort(
      label,
      balances.map(({ uid, balance }) => mirrorWallet(uid, balance)),
    );
  }

  async function createListing(uid, data) {
    const normalized = normalizeFleaListingInput(data);
    const requestedAt = currentTime();
    const dateKey = fleaJstDateKey(requestedAt);
    const expiresAt = fleaExpiresAt(requestedAt);
    const listingId = fleaListingId(uid, dateKey);
    const publicSellerId = fleaPublicSellerId(uid);
    const creatorIdentity = await readCreatorCard(uid);
    const sellerName = normalizeFleaSellerName(creatorIdentity.card?.name || data?.name);
    if (creatorIdentity.card?.text) {
      assertSafeFleaListingText(sellerName, creatorIdentity.card.text);
    }
    if (normalized.xPostUrl) {
      const postHandle = xPostHandle(normalized.xPostUrl);
      const publicHandle = creatorIdentity.card?.xHandle || "";
      if (!publicHandle || publicHandle.toLowerCase() !== postHandle.toLowerCase()) {
        throw httpsError(
          "failed-precondition",
          "Xポストは公開中の推しカードと同じXアカウントから選んでください。",
        );
      }
    }
    const payloadHash = anjuPayEntryId(`flea-payload:${JSON.stringify(normalized)}`);
    const browseOrder = anjuPayEntryId(`flea-browse:${dateKey}:${listingId}`);
    const walletReference = walletRef(uid);
    const listingReference = listingRef(listingId);
    const sellerCardReference = sellerCardRef(uid);
    const fleaStatsReference = fleaAchievementStatsRef(uid);
    const profileReference = achievementProfileRef(uid);
    await Promise.all([
      ensureWallet(uid),
      ensureFleaAchievementState(uid),
    ]);

    let storedListing = null;
    let committedBalance = 0;
    let committedAt = requestedAt;
    let replayed = false;
    await firestore.runTransaction(async (transaction) => {
      const [
        walletSnapshot,
        listingSnapshot,
        ledgerConfigSnapshot,
        sellerCardSnapshot,
        fleaStatsSnapshot,
        profileSnapshot,
      ] = await Promise.all([
        transaction.get(walletReference),
        transaction.get(listingReference),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(sellerCardReference),
        transaction.get(fleaStatsReference),
        transaction.get(profileReference),
      ]);
      const wallet = walletData(walletSnapshot);
      const attemptNow = currentTime();
      if (fleaJstDateKey(attemptNow) !== dateKey || attemptNow >= expiresAt) {
        throw httpsError(
          "aborted",
          "日付が変わったため、出品内容を確認してもう一度お試しください。",
        );
      }
      committedAt = attemptNow;
      committedBalance = wallet.balance;
      if (listingSnapshot.exists) {
        const current = listingSnapshot.data() || {};
        if (
          current.sellerUid === uid
          && current.dateKey === dateKey
          && current.status === "active"
          && effectiveFleaListingStatus(current, attemptNow) === "active"
          && current.payloadHash === payloadHash
        ) {
          replayed = true;
          storedListing = current;
          return;
        }
        throw httpsError("already-exists", "今日はすでに出品しています。");
      }

      const balanceBefore = wallet.balance;
      stageAnjuPayOpening(
        transaction,
        walletReference,
        wallet,
        ledgerConfigSnapshot,
        attemptNow,
      );
      debitPoints(wallet, FLEA_LISTING_FEE);
      const settlement = fleaSaleSettlement(normalized.price);
      if (walletCreditCapacity(wallet) < settlement.sellerProceeds) {
        throw httpsError(
          "failed-precondition",
          "売れた場合のAnjuPayを受け取れる残高上限がありません。",
        );
      }
      const groupId = anjuPayEntryId(`flea-listing:${listingId}`);
      appendAnjuPayEntry(
        transaction,
        walletReference,
        wallet,
        ledgerConfigSnapshot,
        {
          entryId: groupId,
          groupId,
          kind: "flea_listing_fee",
          category: "flea",
          labelKey: "anju_pay_flea_listing_fee",
          status: "settled",
          delta: -FLEA_LISTING_FEE,
          nominalAmount: FLEA_LISTING_FEE,
          balanceBefore,
          balanceAfter: wallet.balance,
          components: [{
            kind: "listing_fee",
            labelKey: "anju_pay_flea_listing_fee",
            status: "settled",
            delta: -FLEA_LISTING_FEE,
            nominalAmount: FLEA_LISTING_FEE,
          }],
          details: {
            role: "seller",
            dateKey,
          },
          occurredAt: attemptNow,
        },
      );
      storedListing = {
        schemaVersion: FLEA_SCHEMA_VERSION,
        sellerUid: uid,
        publicSellerId,
        sellerName,
        creatorCardEntryId: creatorIdentity.entryId,
        sellerCard: creatorIdentity.card,
        urikkoCard: publicUrikkoCard(sellerCardSnapshot.data()),
        dateKey,
        status: "active",
        category: normalized.category,
        title: normalized.title,
        description: normalized.description,
        price: normalized.price,
        xPostUrl: normalized.xPostUrl,
        xConsent: normalized.xConsent,
        listingFee: FLEA_LISTING_FEE,
        payloadHash,
        browseOrder,
        createdAt: attemptNow,
        expiresAt,
        updatedAt: attemptNow,
      };
      transaction.create(listingReference, storedListing);
      const fleaStats = normalizeFleaStats(fleaStatsSnapshot.data());
      fleaStats.listings += 1;
      const unlockResult = unlockAchievements(
        profileSnapshot.data(),
        eligibleAchievementIds({ fleaStats, scope: "flea" }),
        attemptNow,
      );
      transaction.set(fleaStatsReference, {
        ...fleaStats,
        updatedAt: attemptNow,
      }, { merge: true });
      if (unlockResult.newlyUnlocked.length) {
        transaction.set(profileReference, unlockResult.profile);
      }
      transaction.set(
        walletReference,
        {
          ...wallet,
          ...anjuPayWalletMetadataPatch(wallet),
          updatedAt: attemptNow,
        },
        { merge: true },
      );
      committedBalance = wallet.balance;
    });
    if (!replayed) {
      await mirrorCommittedBalances("anjuPayFleaCreate", [{
        uid,
        balance: committedBalance,
      }]);
    }
    return publicFleaListing(listingId, storedListing, uid, committedAt);
  }

  async function purchaseListing(uid, data) {
    const listingId = requireListingId(data?.listingId);
    const listingReference = listingRef(listingId);
    const initialSnapshot = await listingReference.get();
    if (!initialSnapshot.exists) {
      throw httpsError("not-found", "出品が見つかりません。");
    }
    const initialListing = initialSnapshot.data() || {};
    const sellerUid = typeof initialListing.sellerUid === "string"
      ? initialListing.sellerUid
      : "";
    if (!sellerUid) {
      throw httpsError("failed-precondition", "出品者を確認できませんでした。");
    }
    if (sellerUid === uid) {
      throw httpsError("failed-precondition", "自分の出品は購入できません。");
    }
    const buyerName = safeOneLine(data?.buyerName, 16, "PLAYER");
    await Promise.all([
      ensureWallet(uid),
      ensureWallet(sellerUid),
      ensureFleaAchievementState(uid),
      ensureFleaAchievementState(sellerUid),
    ]);

    const buyerWalletReference = walletRef(uid);
    const sellerWalletReference = walletRef(sellerUid);
    const buyerFleaStatsReference = fleaAchievementStatsRef(uid);
    const sellerFleaStatsReference = fleaAchievementStatsRef(sellerUid);
    const buyerAchievementReference = achievementProfileRef(uid);
    const sellerAchievementReference = achievementProfileRef(sellerUid);
    const saleReference = saleRef(listingId);
    const buyerReceiptReference = receiptRef(uid, listingId);
    const sellerReceiptReference = receiptRef(sellerUid, listingId);
    let saleRecord = null;
    let buyerBalance = 0;
    let sellerBalance = 0;
    let replayed = false;

    await firestore.runTransaction(async (transaction) => {
      const [
        listingSnapshot,
        saleSnapshot,
        buyerWalletSnapshot,
        sellerWalletSnapshot,
        ledgerConfigSnapshot,
        buyerFleaStatsSnapshot,
        sellerFleaStatsSnapshot,
        buyerAchievementSnapshot,
        sellerAchievementSnapshot,
      ] = await Promise.all([
        transaction.get(listingReference),
        transaction.get(saleReference),
        transaction.get(buyerWalletReference),
        transaction.get(sellerWalletReference),
        transaction.get(anjuPayLedgerConfigRef()),
        transaction.get(buyerFleaStatsReference),
        transaction.get(sellerFleaStatsReference),
        transaction.get(buyerAchievementReference),
        transaction.get(sellerAchievementReference),
      ]);
      const buyerWallet = walletData(buyerWalletSnapshot);
      const sellerWallet = walletData(sellerWalletSnapshot);
      buyerBalance = buyerWallet.balance;
      sellerBalance = sellerWallet.balance;

      if (saleSnapshot.exists) {
        const saved = saleSnapshot.data() || {};
        if (saved.buyerUid !== uid || saved.sellerUid !== sellerUid) {
          throw httpsError("failed-precondition", "この出品は売り切れました。");
        }
        replayed = true;
        saleRecord = saved;
        return;
      }
      const attemptNow = currentTime();
      if (!listingSnapshot.exists) {
        throw httpsError("not-found", "出品が見つかりません。");
      }
      const listing = listingSnapshot.data() || {};
      if (listing.sellerUid !== sellerUid) {
        throw httpsError("failed-precondition", "出品者が変わったため購入を停止しました。");
      }
      if (listing.sellerUid === uid) {
        throw httpsError("failed-precondition", "自分の出品は購入できません。");
      }
      if (
        listing.status !== "active"
        || effectiveFleaListingStatus(listing, attemptNow) !== "active"
      ) {
        throw httpsError("failed-precondition", "この出品は受付を終了しました。");
      }
      const settlement = fleaSaleSettlement(listing.price);
      if (walletCreditCapacity(sellerWallet) < settlement.sellerProceeds) {
        throw httpsError(
          "failed-precondition",
          "出品者のAnjuPay残高が上限に近いため購入できません。",
        );
      }

      const buyerBalanceBefore = buyerWallet.balance;
      const sellerBalanceBefore = sellerWallet.balance;
      stageAnjuPayOpening(
        transaction,
        buyerWalletReference,
        buyerWallet,
        ledgerConfigSnapshot,
        attemptNow,
      );
      stageAnjuPayOpening(
        transaction,
        sellerWalletReference,
        sellerWallet,
        ledgerConfigSnapshot,
        attemptNow,
      );
      debitPoints(buyerWallet, settlement.grossAmount);
      creditPoints(sellerWallet, settlement.sellerProceeds);
      const groupId = anjuPayEntryId(`flea-sale:${listingId}`);
      appendAnjuPayEntry(
        transaction,
        buyerWalletReference,
        buyerWallet,
        ledgerConfigSnapshot,
        {
          entryId: groupId,
          groupId,
          kind: "flea_purchase",
          category: "flea",
          labelKey: "anju_pay_flea_purchase",
          status: "settled",
          delta: -settlement.grossAmount,
          nominalAmount: settlement.grossAmount,
          balanceBefore: buyerBalanceBefore,
          balanceAfter: buyerWallet.balance,
          components: [{
            kind: "purchase",
            labelKey: "anju_pay_flea_purchase",
            status: "settled",
            delta: -settlement.grossAmount,
            nominalAmount: settlement.grossAmount,
          }],
          details: {
            role: "buyer",
            counterpartyName: safeOneLine(listing.sellerName, 16, "PLAYER"),
            listingTitle: listing.title,
            dateKey: listing.dateKey,
          },
          occurredAt: attemptNow,
        },
      );
      appendAnjuPayEntry(
        transaction,
        sellerWalletReference,
        sellerWallet,
        ledgerConfigSnapshot,
        {
          entryId: groupId,
          groupId,
          kind: "flea_sale",
          category: "flea",
          labelKey: "anju_pay_flea_sale",
          status: "settled",
          delta: settlement.sellerProceeds,
          nominalAmount: settlement.grossAmount,
          balanceBefore: sellerBalanceBefore,
          balanceAfter: sellerWallet.balance,
          components: [
            {
              kind: "sale_gross",
              labelKey: "anju_pay_flea_sale_gross",
              status: "settled",
              delta: settlement.grossAmount,
              nominalAmount: settlement.grossAmount,
            },
            {
              kind: "success_fee",
              labelKey: "anju_pay_flea_success_fee",
              status: "settled",
              delta: -settlement.feeAmount,
              nominalAmount: settlement.feeAmount,
            },
          ],
          details: {
            role: "seller",
            counterpartyName: buyerName,
            listingTitle: listing.title,
            dateKey: listing.dateKey,
          },
          occurredAt: attemptNow,
        },
      );
      saleRecord = {
        schemaVersion: FLEA_SCHEMA_VERSION,
        listingId,
        sellerUid,
        buyerUid: uid,
        publicSellerId: listing.publicSellerId,
        sellerName: safeOneLine(listing.sellerName, 16, "PLAYER"),
        creatorCardEntryId: listing.creatorCardEntryId || "",
        sellerCard: publicCreatorCard(listing.sellerCard),
        urikkoCard: publicUrikkoCard(listing.urikkoCard),
        category: listing.category,
        listingTitle: listing.title,
        description: listing.description,
        xPostUrl: listing.xPostUrl || "",
        purchasePrice: settlement.grossAmount,
        feeAmount: settlement.feeAmount,
        sellerProceeds: settlement.sellerProceeds,
        createdAt: attemptNow,
      };
      const buyerReceipt = {
        ...saleRecord,
        role: "buyer",
        counterpartName: saleRecord.sellerName,
      };
      const sellerReceipt = {
        ...saleRecord,
        role: "seller",
        counterpartName: buyerName,
      };
      transaction.update(listingReference, {
        status: "sold",
        buyerUid: uid,
        soldAt: attemptNow,
        saleFee: settlement.feeAmount,
        sellerProceeds: settlement.sellerProceeds,
        updatedAt: attemptNow,
      });
      transaction.create(saleReference, saleRecord);
      transaction.create(buyerReceiptReference, buyerReceipt);
      transaction.create(sellerReceiptReference, sellerReceipt);
      const buyerFleaStats = normalizeFleaStats(buyerFleaStatsSnapshot.data());
      const sellerFleaStats = normalizeFleaStats(sellerFleaStatsSnapshot.data());
      buyerFleaStats.purchases += 1;
      sellerFleaStats.sales += 1;
      const buyerUnlockResult = unlockAchievements(
        buyerAchievementSnapshot.data(),
        eligibleAchievementIds({ fleaStats: buyerFleaStats, scope: "flea" }),
        attemptNow,
      );
      const sellerUnlockResult = unlockAchievements(
        sellerAchievementSnapshot.data(),
        eligibleAchievementIds({ fleaStats: sellerFleaStats, scope: "flea" }),
        attemptNow,
      );
      transaction.set(buyerFleaStatsReference, {
        ...buyerFleaStats,
        updatedAt: attemptNow,
      }, { merge: true });
      transaction.set(sellerFleaStatsReference, {
        ...sellerFleaStats,
        updatedAt: attemptNow,
      }, { merge: true });
      if (buyerUnlockResult.newlyUnlocked.length) {
        transaction.set(buyerAchievementReference, buyerUnlockResult.profile);
      }
      if (sellerUnlockResult.newlyUnlocked.length) {
        transaction.set(sellerAchievementReference, sellerUnlockResult.profile);
      }
      transaction.set(
        buyerWalletReference,
        {
          ...buyerWallet,
          ...anjuPayWalletMetadataPatch(buyerWallet),
          updatedAt: attemptNow,
        },
        { merge: true },
      );
      transaction.set(
        sellerWalletReference,
        {
          ...sellerWallet,
          ...anjuPayWalletMetadataPatch(sellerWallet),
          updatedAt: attemptNow,
        },
        { merge: true },
      );
      buyerBalance = buyerWallet.balance;
      sellerBalance = sellerWallet.balance;
    });
    if (!replayed) {
      await mirrorCommittedBalances("anjuPayFleaPurchase", [
        { uid, balance: buyerBalance },
        { uid: sellerUid, balance: sellerBalance },
      ]);
    }
    return publicFleaReceipt(listingId, {
      ...saleRecord,
      role: "buyer",
      counterpartName: saleRecord?.sellerName,
    });
  }

  async function cancelListing(uid, data) {
    const listingId = requireListingId(data?.listingId);
    const reference = listingRef(listingId);
    let canceledAt = currentTime();
    let storedListing = null;
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const attemptNow = currentTime();
      canceledAt = attemptNow;
      if (!snapshot.exists) throw httpsError("not-found", "出品が見つかりません。");
      const listing = snapshot.data() || {};
      if (listing.sellerUid !== uid) {
        throw httpsError("permission-denied", "この出品は取り消せません。");
      }
      if (listing.status === "canceled") {
        storedListing = listing;
        return;
      }
      if (
        listing.status !== "active"
        || effectiveFleaListingStatus(listing, attemptNow) !== "active"
      ) {
        throw httpsError("failed-precondition", "この出品はすでに受付を終了しています。");
      }
      storedListing = {
        ...listing,
        status: "canceled",
        canceledAt: attemptNow,
        updatedAt: attemptNow,
      };
      transaction.update(reference, {
        status: "canceled",
        canceledAt: attemptNow,
        updatedAt: attemptNow,
      });
    });
    return publicFleaListing(listingId, storedListing, uid, canceledAt);
  }

  async function saveUrikkoCard(uid, data) {
    // Validate all appearance fields before entering the transaction. Achievement ownership
    // is intentionally checked again from the server-owned profile inside the transaction.
    normalizeFleaSellerCardInput(data);
    const requestedAt = currentTime();
    const dateKey = fleaJstDateKey(requestedAt);
    const cardReference = sellerCardRef(uid);
    const profileReference = achievementProfileRef(uid);
    const todayListingReference = listingRef(fleaListingId(uid, dateKey));
    let savedCard = null;

    await firestore.runTransaction(async (transaction) => {
      const [cardSnapshot, profileSnapshot, listingSnapshot] = await Promise.all([
        transaction.get(cardReference),
        transaction.get(profileReference),
        transaction.get(todayListingReference),
      ]);
      const attemptNow = currentTime();
      if (fleaJstDateKey(attemptNow) !== dateKey) {
        throw httpsError(
          "aborted",
          "日付が変わったため、売りっ子カードをもう一度保存してください。",
        );
      }
      const publicCard = verifiedUrikkoCard(data, profileSnapshot.data());
      const currentPublicCard = publicUrikkoCard(cardSnapshot.data());
      const cardChanged = !cardSnapshot.exists
        || JSON.stringify(currentPublicCard) !== JSON.stringify(publicCard);
      savedCard = {
        ...publicCard,
        publicSellerId: fleaPublicSellerId(uid),
        createdAt: finiteTimestamp(cardSnapshot.get("createdAt"), attemptNow),
        updatedAt: cardChanged
          ? attemptNow
          : finiteTimestamp(cardSnapshot.get("updatedAt"), attemptNow),
      };
      if (cardChanged) transaction.set(cardReference, savedCard);

      if (listingSnapshot.exists) {
        const listing = listingSnapshot.data() || {};
        if (
          listing.sellerUid === uid
          && listing.dateKey === fleaJstDateKey(attemptNow)
          && (
            (
              listing.status === "active"
              && effectiveFleaListingStatus(listing, attemptNow) === "active"
            )
            || (
              listing.status === "sold"
              && finiteTimestamp(listing.expiresAt) > attemptNow
            )
          )
          && JSON.stringify(publicUrikkoCard(listing.urikkoCard)) !== JSON.stringify(publicCard)
        ) {
          transaction.update(todayListingReference, {
            urikkoCard: publicCard,
            updatedAt: attemptNow,
          });
        }
      }
    });
    return publicUrikkoCard(savedCard);
  }

  async function setFavorite(uid, data) {
    if (typeof data?.favorite !== "boolean") {
      throw httpsError("invalid-argument", "お気に入りの状態を確認してください。");
    }
    if (data.favorite === false && data.publicSellerId != null) {
      const publicSellerId = requirePublicSellerId(data.publicSellerId);
      const reference = favoriteRef(uid, publicSellerId);
      const ownerReference = favoriteOwnerRef(uid);
      await firestore.runTransaction(async (transaction) => {
        const [snapshot, ownerSnapshot] = await Promise.all([
          transaction.get(reference),
          transaction.get(ownerReference),
        ]);
        if (!snapshot.exists) return;
        const currentCount = Math.max(0, Math.floor(Number(ownerSnapshot.get("count")) || 0));
        transaction.delete(reference);
        transaction.set(ownerReference, {
          count: Math.max(0, currentCount - 1),
          updatedAt: currentTime(),
        }, { merge: true });
      });
      return assertNoPrivateFleaFields({
        publicSellerId,
        favorite: false,
        seller: null,
      });
    }

    const listingId = requireListingId(data?.listingId);
    const listingReference = listingRef(listingId);
    const ownerReference = favoriteOwnerRef(uid);
    let publicSellerId = "";
    let favoriteSeller = null;
    await firestore.runTransaction(async (transaction) => {
      const listingSnapshot = await transaction.get(listingReference);
      if (!listingSnapshot.exists) throw httpsError("not-found", "出品が見つかりません。");
      const listing = listingSnapshot.data() || {};
      if (listing.sellerUid === uid) {
        throw httpsError("failed-precondition", "自分自身はお気に入りに追加できません。");
      }
      publicSellerId = requirePublicSellerId(listing.publicSellerId);
      const attemptNow = currentTime();
      const canFavoriteActiveListing = listing.status === "active"
        && listing.dateKey === fleaJstDateKey(attemptNow)
        && effectiveFleaListingStatus(listing, attemptNow) === "active";
      const canFavoritePublicSoldListing = listing.status === "sold"
        && listing.dateKey === fleaJstDateKey(attemptNow)
        && finiteTimestamp(listing.expiresAt) > attemptNow;
      if (
        data.favorite
        && !canFavoriteActiveListing
        && !canFavoritePublicSoldListing
      ) {
        throw httpsError("failed-precondition", "この出品はすでに受付を終了しています。");
      }
      const name = safeOneLine(listing.sellerName, 16);
      if (!name || typeof listing.sellerUid !== "string" || !listing.sellerUid) {
        throw httpsError("failed-precondition", "出品者を確認できませんでした。");
      }
      const reference = favoriteRef(uid, publicSellerId);
      const [favoriteSnapshot, ownerSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(ownerReference),
      ]);
      const currentCount = Math.max(0, Math.floor(Number(ownerSnapshot.get("count")) || 0));
      const updatedAt = attemptNow;
      favoriteSeller = {
        publicSellerId,
        name,
        creatorCard: privateFavoriteCreatorCard(listing.sellerCard),
        urikkoCard: publicUrikkoCard(listing.urikkoCard),
        updatedAt,
      };
      if (data.favorite) {
        if (!favoriteSnapshot.exists && currentCount >= STATE_FAVORITE_LIMIT) {
          throw httpsError(
            "resource-exhausted",
            `推し帳へ残せる店主は${STATE_FAVORITE_LIMIT}人までです。`,
          );
        }
        transaction.set(reference, favoriteSeller);
        transaction.set(ownerReference, {
          count: favoriteSnapshot.exists ? Math.max(1, currentCount) : currentCount + 1,
          updatedAt,
        }, { merge: true });
      } else {
        if (favoriteSnapshot.exists) {
          transaction.delete(reference);
          transaction.set(ownerReference, {
            count: Math.max(0, currentCount - 1),
            updatedAt,
          }, { merge: true });
        }
      }
    });
    return assertNoPrivateFleaFields({
      publicSellerId,
      favorite: data.favorite === true,
      seller: data.favorite ? favoriteSeller : null,
    });
  }

  async function reportListing(uid, data) {
    const listingId = requireListingId(data?.listingId);
    const reason = data?.reason;
    if (!isFleaReportReason(reason)) {
      throw httpsError("invalid-argument", "通報理由を選び直してください。");
    }
    const reference = listingRef(listingId);
    const reportId = anjuPayEntryId(["flea-report", listingId, uid].join(":"));
    const reportReference = reportRef(reportId);
    let savedReason = reason;
    let xQuarantined = false;
    await firestore.runTransaction(async (transaction) => {
      const [listingSnapshot, existingReportSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(reportReference),
      ]);
      if (!listingSnapshot.exists) throw httpsError("not-found", "出品が見つかりません。");
      const listing = listingSnapshot.data() || {};
      if (listing.sellerUid === uid) {
        throw httpsError("failed-precondition", "自分の出品は通報できません。");
      }
      const existingReport = existingReportSnapshot.exists
        ? existingReportSnapshot.data() || {}
        : null;
      const existingReason = existingReport && isFleaReportReason(existingReport.reason)
        ? existingReport.reason
        : "";
      savedReason = existingReason || reason;
      if (savedReason === "other" && X_QUARANTINE_REPORT_REASONS.has(reason)) {
        savedReason = reason;
      }
      const shouldQuarantineX = X_QUARANTINE_REPORT_REASONS.has(savedReason);

      let saleReference = null;
      let saleSnapshot = null;
      let sale = null;
      let buyerReceiptReference = null;
      let buyerReceiptSnapshot = null;
      let buyerReceipt = null;
      let sellerReceiptReference = null;
      let sellerReceiptSnapshot = null;
      let sellerReceipt = null;
      if (shouldQuarantineX) {
        saleReference = saleRef(listingId);
        saleSnapshot = await transaction.get(saleReference);
        sale = saleSnapshot.exists ? saleSnapshot.data() || {} : null;
        const sellerUid = typeof listing.sellerUid === "string"
          ? listing.sellerUid
          : typeof sale?.sellerUid === "string" ? sale.sellerUid : "";
        const buyerUid = typeof listing.buyerUid === "string"
          ? listing.buyerUid
          : typeof sale?.buyerUid === "string" ? sale.buyerUid : "";
        if (sellerUid && buyerUid) {
          buyerReceiptReference = receiptRef(buyerUid, listingId);
          sellerReceiptReference = receiptRef(sellerUid, listingId);
          [buyerReceiptSnapshot, sellerReceiptSnapshot] = await Promise.all([
            transaction.get(buyerReceiptReference),
            transaction.get(sellerReceiptReference),
          ]);
          buyerReceipt = buyerReceiptSnapshot.exists
            ? buyerReceiptSnapshot.data() || {}
            : null;
          sellerReceipt = sellerReceiptSnapshot.exists
            ? sellerReceiptSnapshot.data() || {}
            : null;
        }
      }

      const evidence = [
        existingReport,
        listing,
        sale,
        buyerReceipt,
        sellerReceipt,
      ].filter(Boolean);
      const originalXPostUrl = evidence
        .map((item) => safePublicXPostUrl(item.xPostUrl))
        .find(Boolean) || "";
      const originalXHandle = evidence
        .map((item) => {
          const direct = safeOneLine(item.xHandle, 15);
          if (CREATOR_CARD_X_HANDLE_PATTERN.test(direct)) return direct;
          return creatorCardXHandle(item.sellerCard);
        })
        .find(Boolean) || "";
      const reportedAt = currentTime();
      if (!existingReportSnapshot.exists) {
        transaction.create(reportReference, {
          schemaVersion: FLEA_SCHEMA_VERSION,
          listingId,
          sellerUid: typeof listing.sellerUid === "string" ? listing.sellerUid : "",
          reporterUid: uid,
          reason: savedReason,
          xPostUrl: originalXPostUrl,
          xHandle: originalXHandle,
          createdAt: reportedAt,
        });
      } else {
        const evidencePatch = {};
        if (savedReason !== existingReason) {
          evidencePatch.reason = savedReason;
          evidencePatch.escalatedAt = reportedAt;
        }
        if (!safePublicXPostUrl(existingReport?.xPostUrl) && originalXPostUrl) {
          evidencePatch.xPostUrl = originalXPostUrl;
        }
        if (!creatorCardXHandle({ xHandle: existingReport?.xHandle }) && originalXHandle) {
          evidencePatch.xHandle = originalXHandle;
        }
        if (Object.keys(evidencePatch).length) {
          transaction.set(reportReference, evidencePatch, { merge: true });
        }
      }
      if (!shouldQuarantineX) return;

      const patchFor = (source) => ({
        xPostUrl: "",
        sellerCard: withoutCreatorCardXHandle(source?.sellerCard),
        xQuarantinedAt: finiteTimestamp(source?.xQuarantinedAt, reportedAt),
        xQuarantineReason: savedReason,
        updatedAt: reportedAt,
      });
      transaction.update(reference, {
        ...patchFor(listing),
        xConsent: false,
      });
      if (saleSnapshot?.exists) transaction.update(saleReference, patchFor(sale));
      if (buyerReceiptSnapshot?.exists) {
        transaction.update(buyerReceiptReference, patchFor(buyerReceipt));
      }
      if (sellerReceiptSnapshot?.exists) {
        transaction.update(sellerReceiptReference, patchFor(sellerReceipt));
      }
      xQuarantined = true;
    });
    return assertNoPrivateFleaFields({
      listingId,
      reason: savedReason,
      reported: true,
      xQuarantined,
    });
  }

  async function performActionInternal(uidValue, dataValue) {
    const uid = requireUid(uidValue);
    const data = dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)
      ? dataValue
      : {};
    const action = typeof data.action === "string" ? data.action.trim() : "";
    if (!FLEA_ACTIONS.includes(action)) {
      throw httpsError("invalid-argument", "未対応のAnjuPayフリマ操作です。");
    }
    if (action === "state") return getStateInternal(uid);
    if (action === "browse_more") {
      return getMoreBrowseListings(uid, data.cursor);
    }
    if (action === "browse_sellers") {
      return getSellerBrowseListings(uid, data.category, data.cursor);
    }

    let field = "";
    let mutation = null;
    if (action === "create_listing") {
      field = "createdListing";
      mutation = await createListing(uid, data);
    } else if (action === "buy") {
      field = "purchase";
      mutation = await purchaseListing(uid, data);
    } else if (action === "cancel_listing") {
      field = "canceled";
      mutation = await cancelListing(uid, data);
    } else if (action === "save_urikko_card") {
      field = "savedUrikkoCard";
      mutation = await saveUrikkoCard(uid, data);
    } else if (action === "set_favorite") {
      field = "favorite";
      mutation = await setFavorite(uid, data);
    } else if (action === "report") {
      field = "reported";
      mutation = await reportListing(uid, data);
    }
    const state = await getStateInternal(uid);
    return assertNoPrivateFleaFields({
      ...state,
      [field]: mutation,
    });
  }

  async function expireListingsInternal(now = currentTime()) {
    const serverNow = now instanceof Date ? now.getTime() : Number(now);
    fleaJstDateKey(serverNow);
    let expired = 0;
    while (true) {
      const snapshot = await listingsCollection()
        .where("status", "==", "active")
        .where("expiresAt", "<=", serverNow)
        .limit(EXPIRY_BATCH_LIMIT)
        .get();
      if (!snapshot.docs?.length) break;
      const outcomes = await Promise.all(snapshot.docs.map((document) => (
        firestore.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(document.ref);
          if (!currentSnapshot.exists) return false;
          const current = currentSnapshot.data() || {};
          if (
            current.status !== "active"
            || finiteTimestamp(current.expiresAt, Number.POSITIVE_INFINITY) > serverNow
          ) {
            return false;
          }
          transaction.update(document.ref, {
            status: "expired",
            expiredAt: serverNow,
            updatedAt: serverNow,
          });
          return true;
        })
      )));
      expired += outcomes.filter(Boolean).length;
      if (!outcomes.some(Boolean)) break;
    }
    return assertNoPrivateFleaFields({ serverNow, expired });
  }

  return Object.freeze({
    async getState(uid) {
      try {
        return await getStateInternal(uid);
      } catch (error) {
        throw mapHelperError(error);
      }
    },
    async performAction(uid, data) {
      try {
        return await performActionInternal(uid, data);
      } catch (error) {
        throw mapHelperError(error);
      }
    },
    async expireListings(now) {
      try {
        return await expireListingsInternal(now);
      } catch (error) {
        throw mapHelperError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  createAnjuPayFleaService,
});
