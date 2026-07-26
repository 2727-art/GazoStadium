import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";
import {
  ANJU_PAY_UNIT,
  formatAnjuPay,
  formatAnjuPayNumber,
} from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import {
  getPlayerTitlePresentation,
} from "./player-titles.js?v=player-titles-v2";

const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const FLEA_DRAFT_KEY = "hariai-stadium-anju-pay-flea-draft-v1";
const DEFAULT_PRICES = Object.freeze([10, 25, 50]);
const DEFAULT_POLICY = Object.freeze({
  listingFee: 1,
  prices: DEFAULT_PRICES,
  successFeeBasisPoints: 500,
  minimumSuccessFee: 1,
});
const CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "illustration", label: "イラスト", mark: "✦" }),
  Object.freeze({ id: "photo", label: "実写", mark: "▣" }),
  Object.freeze({ id: "outfit", label: "衣装コーデ", mark: "◇" }),
]);
const CATEGORY_IDS = new Set(CATEGORY_DEFINITIONS.map((category) => category.id));
const REPORT_REASONS = Object.freeze([
  Object.freeze({ id: "rights", label: "権利・無断掲載のおそれ" }),
  Object.freeze({ id: "privacy", label: "個人情報・プライバシー" }),
  Object.freeze({ id: "adult", label: "成人向け・不適切な内容" }),
  Object.freeze({ id: "external_trade", label: "外部取引への誘導" }),
  Object.freeze({ id: "other", label: "その他" }),
]);
const REPORT_REASON_IDS = new Set(REPORT_REASONS.map((reason) => reason.id));
const LISTING_STATUSES = new Set(["active", "sold", "canceled", "expired", "hidden"]);
const RECEIPT_STATUSES = new Set(["sold", "canceled", "expired"]);
const SCREEN_IDS = new Set([
  "shelf",
  "favorites",
  "detail",
  "sell",
  "publish-review",
  "own",
  "purchase-review",
  "success",
  "history",
  "error",
]);
const URL_LIKE_PATTERN = /(?:https?:\/\/|www\.|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?:[/?#]\S*)?)/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/i;
const BROWSE_CURSOR_PATTERN = /^[a-f0-9]{40}$/;
const FLEA_X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクは店主が自己申告したものです。運営は店主とXアカウントの本人確認も、リンク先の内容確認も行っていません。外部サイトのXへ移動しますか？";
const appRoot = document.querySelector("#app");
const fleaActionCallable = httpsCallable(functions, "anjuPayFleaAction");
const useFleaPreview = useOfflineMarketPreview;
const requestedPreviewScreen = new URLSearchParams(location.search).get("fleaPreview") || "shelf";

let active = false;
let state = createState();
let lifecycleGeneration = 0;
let lastRenderedScreen = "";
let boundaryTimer = null;

function shared() {
  return window.HariaiApp?.shared;
}

function escapeHtml(value) {
  if (typeof shared()?.escapeHtml === "function") return shared().escapeHtml(value);
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  shared()?.showToast?.(message);
}

function integer(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function boundedText(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function categoryDefinition(value) {
  return CATEGORY_DEFINITIONS.find((category) => category.id === value)
    || CATEGORY_DEFINITIONS[0];
}

function normalizeBrowseCursor(value) {
  const cursor = typeof value === "string" ? value.trim().toLowerCase() : "";
  return BROWSE_CURSOR_PATTERN.test(cursor) ? cursor : "";
}

function normalizeXPostUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !["x.com", "www.x.com"].includes(hostname)) return "";
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)\/?$/);
    if (!match) return "";
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {
    return "";
  }
}

function normalizeAchievementIds(value) {
  const candidates = Array.isArray(value)
    ? value
    : String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return window.HariaiAchievements?.normalizeIds?.(candidates, 3)
    || candidates.filter((entry) => /^[a-z0-9_]{1,64}$/.test(entry)).slice(0, 3);
}

function normalizeCreatorCard(value) {
  if (!value || typeof value !== "object") return null;
  const name = boundedText(value.name, 16);
  const text = boundedText(value.text, 30);
  if (!name || !text) return null;
  const titlePresentation = getPlayerTitlePresentation(String(value.titleId || ""));
  const creatorType = ["illustration", "photo", "both", "community"].includes(value.creatorType)
    ? value.creatorType
    : "community";
  const cardTheme = /^(?:basic|premium)-[a-z]+$/.test(String(value.cardTheme || ""))
    ? String(value.cardTheme)
    : "basic-rose";
  const xHandle = /^[A-Za-z0-9_]{1,15}$/.test(String(value.xHandle || ""))
    ? String(value.xHandle)
    : "";
  return {
    schemaVersion: Math.max(0, integer(value.schemaVersion)),
    name,
    text,
    creatorType,
    cardTheme,
    growthLevel: Math.min(5, Math.max(1, integer(value.growthLevel, 1))),
    achievementShowcase: normalizeAchievementIds(value.achievementShowcase),
    titleId: String(value.titleId || ""),
    title: titlePresentation?.product?.title || "",
    titleIcon: titlePresentation?.icon || "",
    titleClassName: titlePresentation?.className || "",
    ...(xHandle ? { xHandle } : {}),
  };
}

function normalizeFavoriteCreatorCard(value) {
  const card = normalizeCreatorCard(value);
  if (!card) return null;
  const { xHandle: _discardedXHandle, ...snapshot } = card;
  return snapshot;
}

function normalizeListing(value) {
  if (!value || typeof value !== "object") return null;
  const id = boundedText(value.id, 80);
  const title = boundedText(value.title, 30);
  const description = boundedText(value.description, 240);
  const category = CATEGORY_IDS.has(value.category) ? value.category : "";
  if (!id || !title || !description || !category) return null;
  const sellerValue = value.seller && typeof value.seller === "object" ? value.seller : {};
  const sellerName = boundedText(sellerValue.name, 16) || "PLAYER";
  const status = LISTING_STATUSES.has(value.status) ? value.status : "active";
  const xPostUrl = normalizeXPostUrl(value.xPostUrl);
  return {
    id,
    dateKey: boundedText(value.dateKey, 10),
    category,
    title,
    description,
    price: Math.max(0, integer(value.price)),
    status,
    createdAt: Math.max(0, integer(value.createdAt)),
    expiresAt: Math.max(0, integer(value.expiresAt)),
    seller: {
      publicSellerId: boundedText(sellerValue.publicSellerId, 80),
      name: sellerName,
      creatorCard: normalizeCreatorCard(sellerValue.creatorCard),
    },
    ...(xPostUrl ? { xPostUrl } : {}),
  };
}

function normalizeReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const id = boundedText(value.id, 100);
  const listingValue = value.listing && typeof value.listing === "object" ? value.listing : {};
  const category = CATEGORY_IDS.has(listingValue.category) ? listingValue.category : "illustration";
  const xPostUrl = normalizeXPostUrl(listingValue.xPostUrl);
  if (!id) return null;
  return {
    id,
    role: value.role === "seller" ? "seller" : "buyer",
    status: RECEIPT_STATUSES.has(value.status) ? value.status : "sold",
    price: Math.max(0, integer(value.price)),
    feeAmount: Math.max(0, integer(value.feeAmount)),
    sellerProceeds: Math.max(0, integer(value.sellerProceeds)),
    counterpartyName: boundedText(value.counterpartyName, 16) || "PLAYER",
    listing: {
      category,
      title: boundedText(listingValue.title, 30) || "ことばの一品",
      description: boundedText(listingValue.description, 240),
      ...(xPostUrl ? { xPostUrl } : {}),
    },
    createdAt: Math.max(0, integer(value.createdAt)),
  };
}

function normalizeFavorites(value) {
  const ids = new Set();
  const sellersById = new Map();
  if (!Array.isArray(value)) return { ids, sellers: [] };
  value.forEach((entry) => {
    const entryValue = entry && typeof entry === "object" ? entry : null;
    const publicSellerId = String(
      typeof entry === "string" ? entry : entryValue?.publicSellerId || "",
    ).trim().slice(0, 80);
    if (!/^[-0-9A-Z_a-z:]{1,80}$/.test(publicSellerId)) return;
    ids.add(publicSellerId);
    if (!entryValue) return;
    const creatorCard = normalizeFavoriteCreatorCard(entryValue.creatorCard);
    sellersById.set(publicSellerId, {
      publicSellerId,
      name: boundedText(entryValue.name, 16) || creatorCard?.name || "PLAYER",
      creatorCard,
      updatedAt: Math.max(0, integer(entryValue.updatedAt)),
    });
  });
  return {
    ids,
    sellers: [...sellersById.values()].sort((left, right) => (
      right.updatedAt - left.updatedAt
    )),
  };
}

function normalizePolicy(value) {
  const source = value && typeof value === "object" ? value : {};
  const prices = Array.isArray(source.prices)
    ? [...new Set(source.prices.map((price) => integer(price)).filter((price) => DEFAULT_PRICES.includes(price)))]
    : [];
  return {
    listingFee: Math.max(0, integer(source.listingFee, DEFAULT_POLICY.listingFee)),
    prices: prices.length ? prices : [...DEFAULT_PRICES],
    successFeeBasisPoints: Math.min(
      10_000,
      Math.max(0, integer(source.successFeeBasisPoints, DEFAULT_POLICY.successFeeBasisPoints)),
    ),
    minimumSuccessFee: Math.max(
      0,
      integer(source.minimumSuccessFee, DEFAULT_POLICY.minimumSuccessFee),
    ),
  };
}

function loadDraft() {
  const fallback = {
    name: boundedText(localStorage.getItem(PROFILE_NAME_KEY), 16) || "PLAYER",
    category: "illustration",
    title: "",
    description: "",
    price: DEFAULT_PRICES[0],
    xPostUrl: "",
    xConsent: false,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(FLEA_DRAFT_KEY) || "null");
    if (!stored || typeof stored !== "object") return fallback;
    return {
      name: boundedText(stored.name, 16) || fallback.name,
      category: CATEGORY_IDS.has(stored.category) ? stored.category : fallback.category,
      title: String(stored.title ?? "").slice(0, 30),
      description: String(stored.description ?? "").slice(0, 240),
      price: DEFAULT_PRICES.includes(integer(stored.price)) ? integer(stored.price) : fallback.price,
      xPostUrl: String(stored.xPostUrl ?? "").slice(0, 240),
      xConsent: stored.xConsent === true,
    };
  } catch {
    return fallback;
  }
}

function saveDraft() {
  try {
    localStorage.setItem(FLEA_DRAFT_KEY, JSON.stringify(state.draft));
  } catch {
    // The form still works when storage is unavailable.
  }
}

function createState(initialScreen = "shelf") {
  return {
    screen: SCREEN_IDS.has(initialScreen) ? initialScreen : "shelf",
    loading: true,
    authReady: false,
    uid: "",
    busyAction: "",
    errorMessage: "",
    formError: "",
    notice: "",
    serverTimeOffset: 0,
    dateKey: "",
    expiresAt: 0,
    policy: { ...DEFAULT_POLICY, prices: [...DEFAULT_PRICES] },
    balance: 0,
    listings: [],
    nextBrowseCursor: "",
    browseErrorMessage: "",
    ownListing: null,
    favoriteSellers: [],
    favorites: new Set(),
    receipts: [],
    categoryFilter: "all",
    selectedListingId: "",
    draft: loadDraft(),
    cancelReviewOpen: false,
    success: null,
    preview: useFleaPreview,
  };
}

function currentServerTime() {
  return Date.now() + Number(state.serverTimeOffset || 0);
}

function currentListing() {
  return state.listings.find((listing) => listing.id === state.selectedListingId)
    || (state.ownListing?.id === state.selectedListingId ? state.ownListing : null)
    || state.success?.listing
    || null;
}

function hasTodayListing() {
  return Boolean(state.ownListing && state.ownListing.dateKey === state.dateKey);
}

function listingIsOpen(listing) {
  if (!listing || listing.status !== "active") return false;
  const expiresAt = Number(listing.expiresAt || state.expiresAt || 0);
  return expiresAt <= 0 || expiresAt > currentServerTime();
}

function listingStatusLabel(listing) {
  if (listingIsOpen(listing)) return "本日の棚に公開中";
  if (listing?.status === "sold") return "売れました";
  if (listing?.status === "canceled") return "取り下げ済み";
  if (listing?.status === "hidden") return "安全確認のため非表示";
  return "本日の店じまい";
}

function formatDateTime(timestamp) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(timestamp)));
}

function successFee(price) {
  const gross = Math.max(0, integer(price));
  if (!gross) return 0;
  return Math.max(
    state.policy.minimumSuccessFee,
    Math.ceil((gross * state.policy.successFeeBasisPoints) / 10_000),
  );
}

function successFeeRateLabel() {
  const percent = state.policy.successFeeBasisPoints / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function stripCreatorCardXHandle(value) {
  if (!value || typeof value !== "object") return value;
  const { xHandle: _discardedXHandle, ...creatorCard } = value;
  return creatorCard;
}

function stripListingXReferences(value) {
  if (!value || typeof value !== "object") return value;
  const { xPostUrl: _discardedXPostUrl, ...listing } = value;
  if (!listing.seller || typeof listing.seller !== "object") return listing;
  return {
    ...listing,
    seller: {
      ...listing.seller,
      creatorCard: stripCreatorCardXHandle(listing.seller.creatorCard),
    },
  };
}

function removeReportedListingXLocally(listingIdValue) {
  const listingId = String(listingIdValue || "");
  if (!listingId) return;
  state.listings = state.listings.map((listing) => (
    listing.id === listingId ? stripListingXReferences(listing) : listing
  ));
  if (state.ownListing?.id === listingId) {
    state.ownListing = stripListingXReferences(state.ownListing);
  }
  state.receipts = state.receipts.map((receipt) => (
    receipt.id === listingId
      ? { ...receipt, listing: stripListingXReferences(receipt.listing) }
      : receipt
  ));
  if (state.success?.listing?.id === listingId) {
    state.success = {
      ...state.success,
      listing: stripListingXReferences(state.success.listing),
    };
  }
}

function appendUniqueBrowseListings(currentListings, incomingListings) {
  const knownListingIds = new Set(currentListings.map((listing) => listing.id));
  return [
    ...currentListings,
    ...incomingListings.filter((listing) => {
      if (knownListingIds.has(listing.id)) return false;
      knownListingIds.add(listing.id);
      return true;
    }),
  ];
}

function mergeRefreshedBrowseListings(currentListings, incomingListings) {
  const refreshedListingIds = new Set(incomingListings.map((listing) => listing.id));
  return [
    ...incomingListings,
    ...currentListings.filter((listing) => !refreshedListingIds.has(listing.id)),
  ];
}

function applyServerState(value, { browseMode = "replace" } = {}) {
  const data = value && typeof value === "object" ? value : {};
  const previousDateKey = state.dateKey;
  const incomingDateKey = typeof data.dateKey === "string"
    ? data.dateKey.slice(0, 10)
    : "";
  const dateChanged = Boolean(
    previousDateKey
      && incomingDateKey
      && previousDateKey !== incomingDateKey,
  );
  if (Number.isFinite(Number(data.serverNow))) {
    state.serverTimeOffset = Number(data.serverNow) - Date.now();
  }
  if (incomingDateKey) state.dateKey = incomingDateKey;
  if (Number.isFinite(Number(data.expiresAt))) state.expiresAt = Math.max(0, Number(data.expiresAt));
  if (Object.hasOwn(data, "policy")) state.policy = normalizePolicy(data.policy);
  if (Number.isFinite(Number(data.balance))) state.balance = Math.max(0, integer(data.balance));
  const appendBrowse = !dateChanged && (browseMode === "append" || data.appendListings === true);
  const preserveBrowse = !dateChanged && browseMode === "preserve";
  if (Array.isArray(data.listings)) {
    const incomingListings = data.listings.map(normalizeListing).filter(Boolean);
    if (appendBrowse) {
      state.listings = appendUniqueBrowseListings(state.listings, incomingListings);
    } else if (preserveBrowse) {
      state.listings = mergeRefreshedBrowseListings(state.listings, incomingListings);
    } else {
      state.listings = incomingListings;
    }
  }
  if (Object.hasOwn(data, "nextBrowseCursor")) {
    if (!preserveBrowse) {
      state.nextBrowseCursor = normalizeBrowseCursor(data.nextBrowseCursor);
    }
  } else if (dateChanged) {
    state.nextBrowseCursor = "";
  }
  if (Object.hasOwn(data, "ownListing")) {
    state.ownListing = normalizeListing(data.ownListing);
  }
  if (Array.isArray(data.favorites)) {
    const favorites = normalizeFavorites(data.favorites);
    state.favorites = favorites.ids;
    state.favoriteSellers = favorites.sellers;
  }
  if (Array.isArray(data.receipts)) {
    state.receipts = data.receipts.map(normalizeReceipt).filter(Boolean)
      .sort((left, right) => right.createdAt - left.createdAt);
  }
  if (!state.policy.prices.includes(integer(state.draft.price))) {
    state.draft.price = state.policy.prices[0];
    saveDraft();
  }
  scheduleBoundaryRefresh();
}

function isCurrentLifecycle(generation) {
  return active && generation === lifecycleGeneration;
}

function friendlyMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  const detail = message.includes(":") ? message.slice(message.lastIndexOf(":") + 1).trim() : message;
  return detail || fallback;
}

function scheduleBoundaryRefresh() {
  window.clearTimeout(boundaryTimer);
  boundaryTimer = null;
  if (!active || !state.expiresAt) return;
  const delay = state.expiresAt - currentServerTime() + 1_100;
  if (delay <= 0) return;
  boundaryTimer = window.setTimeout(() => {
    boundaryTimer = null;
    if (!active) return;
    if (useFleaPreview) {
      state.listings = state.listings.map((listing) => (
        listing.status === "active" ? { ...listing, status: "expired" } : listing
      ));
      if (state.ownListing?.status === "active") {
        state.ownListing = { ...state.ownListing, status: "expired" };
      }
      render();
      return;
    }
    refreshState({ silent: true });
  }, Math.min(delay, 2_147_000_000));
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function refreshState({ silent = false } = {}) {
  if (!active || useFleaPreview) return;
  const generation = lifecycleGeneration;
  if (!silent) {
    state.busyAction = "refresh";
    state.notice = "";
    render();
  }
  try {
    const response = await fleaActionCallable({ action: "state" });
    if (!isCurrentLifecycle(generation)) return;
    applyServerState(response.data);
    state.errorMessage = "";
    state.browseErrorMessage = "";
  } catch (error) {
    if (!isCurrentLifecycle(generation)) return;
    if (!silent) {
      const message = friendlyMessage(error, "AnjuPayフリマを更新できませんでした。");
      state.errorMessage = message;
      state.notice = message;
    }
  } finally {
    if (isCurrentLifecycle(generation)) {
      if (!silent) state.busyAction = "";
      render();
    }
  }
}

function previewCreatorCard(name = "ANJU FAN") {
  return {
    schemaVersion: 2,
    name,
    text: "好きなものを、ことばでも届けたい。",
    creatorType: "illustration",
    cardTheme: "basic-rose",
    growthLevel: 3,
    achievementShowcase: ["market_seller_1"],
    titleId: "",
    xHandle: "anju_example",
  };
}

function previewListings() {
  const now = Date.now();
  const expiresAt = now + (8 * 60 * 60 * 1000);
  return [
    {
      id: "flea-preview-illustration",
      dateKey: "2026-07-26",
      category: "illustration",
      title: "夕暮れ色のオリジナルイラスト",
      description: "やわらかな夕焼けの中で、帰り道を急がず歩く二人を描いた一枚です。色の重なりと、言葉にしすぎない距離感を大切にしました。",
      price: 25,
      status: "active",
      createdAt: now - 40 * 60_000,
      expiresAt,
      seller: {
        publicSellerId: "flea-preview-seller-one",
        name: "ANJU FAN",
        creatorCard: previewCreatorCard("ANJU FAN"),
      },
      xPostUrl: "https://x.com/anju_example/status/1234567890123456789",
    },
    {
      id: "flea-preview-photo",
      dateKey: "2026-07-26",
      category: "photo",
      title: "雨上がりの商店街",
      description: "閉店前の灯りが濡れた路面に映った瞬間です。派手ではないけれど、帰ってきたくなる空気を言葉と一緒に残しました。",
      price: 10,
      status: "active",
      createdAt: now - 2 * 60 * 60_000,
      expiresAt,
      seller: {
        publicSellerId: "flea-preview-seller-two",
        name: "RAIN WALKER",
      },
    },
    {
      id: "flea-preview-outfit",
      dateKey: "2026-07-26",
      category: "outfit",
      title: "水色リボンの夏コーデ",
      description: "白を中心に、水色の小物を一つずつ合わせました。かわいさを主張しすぎず、歩いたときに少し気分が上がる組み合わせです。",
      price: 50,
      status: "active",
      createdAt: now - 3 * 60 * 60_000,
      expiresAt,
      seller: {
        publicSellerId: "flea-preview-seller-three",
        name: "MINT CLOSET",
        creatorCard: {
          ...previewCreatorCard("MINT CLOSET"),
          creatorType: "photo",
          cardTheme: "basic-aqua",
          text: "衣装の好きなところを丁寧に話します。",
          xHandle: "",
        },
      },
    },
  ];
}

function applyPreviewState(initialScreen) {
  const listings = previewListings();
  const previewAlias = {
    active: "own",
    sold: "own",
    empty: "shelf",
  };
  const requestedScreen = previewAlias[requestedPreviewScreen] || requestedPreviewScreen;
  const screen = SCREEN_IDS.has(requestedScreen)
    ? requestedScreen
    : (SCREEN_IDS.has(initialScreen) ? initialScreen : "shelf");
  const ownListing = {
    ...listings[2],
    id: "flea-preview-own",
    status: requestedPreviewScreen === "sold" ? "sold" : "active",
    seller: {
      publicSellerId: "flea-preview-owner",
      name: state.draft.name || "PLAYER",
      creatorCard: previewCreatorCard(state.draft.name || "PLAYER"),
    },
  };
  applyServerState({
    serverNow: Date.now(),
    dateKey: "2026-07-26",
    expiresAt: Date.now() + (8 * 60 * 60 * 1000),
    policy: DEFAULT_POLICY,
    balance: 240,
    listings,
    nextBrowseCursor: "",
    ownListing: screen === "own" ? ownListing : null,
    favorites: [{
      publicSellerId: listings[0].seller.publicSellerId,
      name: listings[0].seller.name,
      creatorCard: listings[0].seller.creatorCard,
      updatedAt: Date.now() - 20 * 60_000,
    }],
    receipts: [
      {
        id: "flea-preview-receipt-buyer",
        role: "buyer",
        status: "sold",
        price: 25,
        feeAmount: 2,
        sellerProceeds: 23,
        counterpartyName: "ANJU FAN",
        listing: listings[0],
        createdAt: Date.now() - 86_400_000,
      },
      {
        id: ownListing.id,
        role: "seller",
        status: "sold",
        price: 50,
        feeAmount: 3,
        sellerProceeds: 47,
        counterpartyName: "MINT BUYER",
        listing: listings[2],
        createdAt: Date.now() - (2 * 86_400_000),
      },
    ],
  });
  state.authReady = true;
  state.loading = false;
  state.screen = screen;
  if (requestedPreviewScreen === "empty") {
    state.listings = [];
  } else if (screen === "error") {
    state.screen = "error";
    state.errorMessage = "プレビュー用の通信エラー表示です。";
  } else if (["detail", "purchase-review", "success"].includes(screen)) {
    state.selectedListingId = listings[0].id;
    if (screen === "success") {
      state.success = {
        listing: listings[0],
        purchase: {
          id: "flea-preview-purchase",
          status: "sold",
          price: listings[0].price,
          counterpartyName: listings[0].seller.name,
        },
      };
    }
  } else if (screen === "publish-review") {
    state.draft = {
      name: "PLAYER",
      category: "illustration",
      title: "今日いちばん話したいイラスト",
      description: "やさしい色合いと、見た人が自分の思い出を重ねられる余白を大切にして描いた一枚です。",
      price: 25,
      xPostUrl: "https://x.com/anju_example/status/1234567890123456789",
      xConsent: true,
    };
  }
  setFleaChrome("ANJUPAY FLEA PREVIEW");
  render();
}

function setFleaChrome(status = "ANJUPAY FLEA") {
  const statusBadge = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (statusBadge) statusBadge.innerHTML = `<i></i> ${escapeHtml(status)}`;
  if (privacy) privacy.textContent = "画像投稿なし";
  if (footerItems[0]) footerItems[0].textContent = "ANJUPAY FLEA MARKET / TEXT + OPTIONAL X LINK";
  if (footerItems[1]) footerItems[1].textContent = "ゲーム内には文章と任意のXリンクだけを表示し、ポスト本文や画像は埋め込みません";
}

function renderWallet() {
  return `<aside class="flea-wallet" aria-label="AnjuPay残高">
    <span>ANJUPAY BALANCE</span>
    <strong>${formatAnjuPayNumber(state.balance)} <small>${ANJU_PAY_UNIT}</small></strong>
    <p>貼り合いスタジアム内専用</p>
  </aside>`;
}

function renderTabs() {
  const tabForScreen = ["sell", "publish-review", "own"].includes(state.screen)
    ? "sell"
    : state.screen === "favorites"
      ? "favorites"
      : state.screen === "history" ? "history" : "shelf";
  return `<nav class="flea-tabs" role="tablist" aria-label="AnjuPayフリマ">
    <button type="button" role="tab" aria-selected="${tabForScreen === "shelf"}" class="${tabForScreen === "shelf" ? "is-active" : ""}" data-flea-nav="shelf"><span aria-hidden="true">⌂</span><strong>見つける</strong><small>今日の一日棚</small></button>
    <button type="button" role="tab" aria-selected="${tabForScreen === "favorites"}" class="${tabForScreen === "favorites" ? "is-active" : ""}" data-flea-nav="favorites"><span aria-hidden="true">♡</span><strong>推し帳</strong><small>非公開・店主単位</small></button>
    <button type="button" role="tab" aria-selected="${tabForScreen === "sell"}" class="${tabForScreen === "sell" ? "is-active" : ""}" data-flea-nav="sell"><span aria-hidden="true">✎</span><strong>今日の出品</strong><small>1日1回まで</small></button>
    <button type="button" role="tab" aria-selected="${tabForScreen === "history"}" class="${tabForScreen === "history" ? "is-active" : ""}" data-flea-nav="history"><span aria-hidden="true">≡</span><strong>出会いの記録</strong><small>購入・販売履歴</small></button>
  </nav>`;
}

function renderFrame(body, { compactHeader = false } = {}) {
  return `<section class="screen flea-screen">
    <header class="flea-hero ${compactHeader ? "is-compact" : ""}">
      <div><span class="eyebrow">ANJUPAY FLEA MARKET</span><h1>AnjuPayフリマ</h1>
        <p>画像ではなく、ことばと人柄から今日の推しに出会う一日棚です。</p>
      </div>
      ${renderWallet()}
    </header>
    <div class="flea-top-actions">
      <button class="button button-ghost button-small" type="button" data-flea-home>トップへ戻る</button>
      <button class="button button-ghost button-small" type="button" data-flea-refresh ${state.busyAction ? "disabled" : ""}>${state.busyAction === "refresh" ? "更新中…" : "棚を更新"}</button>
    </div>
    ${renderTabs()}
    ${useFleaPreview ? '<p class="flea-preview-notice" role="status">LOCAL UI PREVIEW：表示確認用です。Firebaseへの出品・購入・通報は行いません。</p>' : ""}
    ${state.notice ? `<p class="flea-notice" role="status" aria-live="polite">${escapeHtml(state.notice)}</p>` : ""}
    ${body}
  </section>`;
}

function renderLoading() {
  return `<section class="screen flea-screen flea-loading" role="status" aria-live="polite">
    <span class="eyebrow">ANJUPAY FLEA MARKET</span>
    <div class="flea-loader" aria-hidden="true"><i></i><i></i><i></i></div>
    <h1>今日の一日棚を準備しています</h1>
    <p>出品状況とAnjuPay残高を安全に確認しています。</p>
  </section>`;
}

function renderError() {
  return renderFrame(`<section class="flea-error" role="alert">
    <span>FLEA MARKET ERROR</span>
    <h2>一日棚を開けませんでした</h2>
    <p>${escapeHtml(state.errorMessage || "しばらく待ってから、もう一度お試しください。")}</p>
    <div><button class="button button-primary" type="button" data-flea-refresh>再読み込み</button><button class="button button-ghost" type="button" data-flea-home>トップへ戻る</button></div>
  </section>`, { compactHeader: true });
}

function renderCategoryFilters() {
  const definitions = [{ id: "all", label: "すべて", mark: "♡" }, ...CATEGORY_DEFINITIONS];
  return `<div class="flea-category-filters" aria-label="興味カテゴリ">
    ${definitions.map((category) => {
      const selected = state.categoryFilter === category.id;
      return `<button type="button" aria-pressed="${selected}" class="${selected ? "is-active" : ""}" data-flea-category="${category.id}"><span aria-hidden="true">${category.mark}</span>${category.label}</button>`;
    }).join("")}
  </div>`;
}

function renderFavoriteButton(listing, { compact = false } = {}) {
  const sellerId = listing?.seller?.publicSellerId || "";
  if (!sellerId) return "";
  const selected = state.favorites.has(sellerId);
  return `<button class="flea-favorite ${compact ? "is-compact" : ""} ${selected ? "is-selected" : ""}" type="button" data-flea-favorite="${escapeHtml(listing.id)}" aria-pressed="${selected}" ${state.busyAction ? "disabled" : ""}><span aria-hidden="true">${selected ? "♥" : "♡"}</span>${selected ? "推し帳に追加済み" : "推し帳に追加"}</button>`;
}

function favoriteSnapshotFromListing(listing) {
  const publicSellerId = listing?.seller?.publicSellerId || "";
  if (!publicSellerId) return null;
  return {
    publicSellerId,
    name: listing.seller.name || "PLAYER",
    creatorCard: normalizeFavoriteCreatorCard(listing.seller.creatorCard),
    updatedAt: currentServerTime(),
  };
}

function removeLocalFavorite(publicSellerId) {
  if (!publicSellerId) return;
  state.favorites.delete(publicSellerId);
  state.favoriteSellers = state.favoriteSellers.filter((entry) => entry.publicSellerId !== publicSellerId);
}

function applyLocalFavorite(listing, favorite) {
  const snapshot = favoriteSnapshotFromListing(listing);
  if (!snapshot) return;
  if (favorite) {
    state.favorites.add(snapshot.publicSellerId);
    if (!state.favoriteSellers.some((entry) => entry.publicSellerId === snapshot.publicSellerId)) {
      state.favoriteSellers = [snapshot, ...state.favoriteSellers];
    }
  } else {
    removeLocalFavorite(snapshot.publicSellerId);
  }
}

function applyLocalFavoriteAction(listing, payload) {
  if (payload.favorite === true) {
    applyLocalFavorite(listing, true);
    return;
  }
  const sellerId = listing?.seller?.publicSellerId || String(payload.publicSellerId || "");
  removeLocalFavorite(sellerId);
}

function renderListingCard(listing) {
  const category = categoryDefinition(listing.category);
  return `<article class="flea-listing-card" data-flea-listing-card="${escapeHtml(listing.id)}">
    <header><span class="flea-category is-${category.id}"><i aria-hidden="true">${category.mark}</i>${category.label}</span><time datetime="${escapeHtml(new Date(listing.expiresAt || state.expiresAt).toISOString())}">本日23:59まで</time></header>
    <div class="flea-listing-copy"><small>FROM ${escapeHtml(listing.seller.name)}</small><h2>${escapeHtml(listing.title)}</h2><p>${escapeHtml(listing.description)}</p></div>
    <footer><strong>${formatAnjuPay(listing.price)}</strong><div>${renderFavoriteButton(listing, { compact: true })}<button class="button button-primary button-small" type="button" data-flea-detail="${escapeHtml(listing.id)}">詳しく読む</button></div></footer>
  </article>`;
}

function renderShelf() {
  const listings = state.listings.filter((listing) => (
    listingIsOpen(listing)
    && (state.categoryFilter === "all" || listing.category === state.categoryFilter)
  ));
  const body = listings.length
    ? `<div class="flea-shelf-grid">${listings.map(renderListingCard).join("")}</div>`
    : `<section class="flea-empty">
        <span aria-hidden="true">♡</span><h2>${state.categoryFilter === "all" ? "今日の棚は、まだ静かです" : "このカテゴリの出品はまだありません"}</h2>
        <p>売れ残りや空の棚も失敗ではありません。気が向いたときに、またのぞいてみてください。</p>
        <button class="button button-primary" type="button" data-flea-nav="sell">今日の一品を出す</button>
      </section>`;
  const browseMore = state.nextBrowseCursor
    ? `<div class="flea-browse-more" aria-live="polite">
        <button class="button button-ghost" type="button" data-flea-browse-more ${state.busyAction ? "disabled" : ""}>
          ${state.busyAction === "browse_more" ? "続きを読み込んでいます…" : "続きを見る"}
        </button>
        ${state.browseErrorMessage ? `<p role="alert">${escapeHtml(state.browseErrorMessage)}</p>` : ""}
      </div>`
    : "";
  return renderFrame(`<section class="flea-shelf" aria-labelledby="fleaShelfHeading">
    <div class="flea-section-head"><div><span>TODAY'S SHELF</span><h2 id="fleaShelfHeading">今日の出品を見つける</h2><p>カテゴリは興味の入口です。最後は、紹介することばと店主の人柄で選べます。</p></div><small>日本時間 0:00 に本日の店じまい</small></div>
    ${renderCategoryFilters()}
    ${body}
    ${browseMore}
    <p class="flea-market-boundary"><strong>推し値市場とは別の場所です。</strong>ここでの購入・販売は、推し値市場のランキング・実績・常連帳・店主評価へ加算しません。店主推し帳も、自分だけに見える別の記録です。</p>
  </section>`);
}

function activeListingForSeller(publicSellerId) {
  return state.listings.find((listing) => (
    listingIsOpen(listing) && listing.seller.publicSellerId === publicSellerId
  )) || null;
}

function favoriteSellerEntries() {
  const sellersById = new Map(
    state.favoriteSellers.map((seller) => [seller.publicSellerId, seller]),
  );
  state.favorites.forEach((publicSellerId) => {
    if (sellersById.has(publicSellerId)) return;
    const listing = activeListingForSeller(publicSellerId);
    const snapshot = favoriteSnapshotFromListing(listing);
    if (snapshot) sellersById.set(publicSellerId, snapshot);
  });
  return [...sellersById.values()].sort((left, right) => (
    right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "ja")
  ));
}

function renderFavoriteSeller(snapshot) {
  const listing = activeListingForSeller(snapshot.publicSellerId);
  const card = listing?.seller?.creatorCard || snapshot.creatorCard;
  const name = listing?.seller?.name || snapshot.name || card?.name || "PLAYER";
  const cardMarkup = card ? shared()?.renderCreatorCard?.(card, { compact: true }) || "" : "";
  const savedAt = snapshot.updatedAt > 0
    ? `<time datetime="${escapeHtml(new Date(snapshot.updatedAt).toISOString())}">${escapeHtml(formatDateTime(snapshot.updatedAt))}に追加</time>`
    : "";
  const path = listing
    ? `<div><strong>今日の一品があります</strong><p>新しいことばから、今のこの人を知れます。</p></div>`
    : `<div><strong>今日は出品していません</strong><p>推し帳へ追加した時点のカードです。Xリンクは保存せず、また一日棚で出会える日まで静かに残します。</p></div>`;
  return `<article class="flea-favorite-seller">
    <header><div><span>PRIVATE FAVORITE</span><h3>${escapeHtml(name)}</h3></div>${savedAt}</header>
    <div class="flea-favorite-seller-card">${cardMarkup || `<section class="flea-creator-card-empty"><span>MY FAVORITE CARD</span><h3>${escapeHtml(name)}</h3><p>この店主は、現在推しカードを公開していません。</p></section>`}</div>
    <footer>${path}<div class="flea-favorite-seller-actions">${listing ? `<button class="button button-primary button-small" type="button" data-flea-detail="${escapeHtml(listing.id)}">今日の一品を読む</button>` : ""}<button class="flea-favorite is-compact is-selected" type="button" data-flea-unfavorite-seller="${escapeHtml(snapshot.publicSellerId)}" aria-pressed="true" ${state.busyAction ? "disabled" : ""}><span aria-hidden="true">♥</span>推し帳から外す</button></div></footer>
  </article>`;
}

function renderFavorites() {
  const sellers = favoriteSellerEntries();
  const content = sellers.length
    ? `<div class="flea-favorite-sellers">${sellers.map(renderFavoriteSeller).join("")}</div>`
    : `<section class="flea-empty"><span aria-hidden="true">♡</span><h2>推し帳は、まだ空です</h2><p>ことばや人柄が気になった店主を、一日棚から自分だけの推し帳へ残せます。</p><button class="button button-primary" type="button" data-flea-nav="shelf">今日の棚を見る</button></section>`;
  return renderFrame(`<section class="flea-favorites" aria-labelledby="fleaFavoritesHeading">
    <div class="flea-section-head"><div><span>PRIVATE FAVORITE BOOK</span><h2 id="fleaFavoritesHeading">店主の推し帳</h2><p>一品ではなく、気になった店主を覚えておく自分だけの場所です。</p></div><small>あなたにだけ表示</small></div>
    <div class="flea-favorites-boundary"><strong>競争には使いません</strong><p>誰が誰を推し帳に残したかは、本人以外には一切見えません。推し値市場のランキング・実績・常連帳・店主評価とも別の記録です。</p></div>
    ${content}
  </section>`);
}

function renderXPostLink(url, sellerName, { className = "" } = {}) {
  const safeUrl = normalizeXPostUrl(url);
  if (!safeUrl) return "";
  return `<a class="flea-x-link ${className}" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer" aria-label="${escapeHtml(sellerName)}の参考ポストをXで新しいタブに開く"><span class="x-share-mark" aria-hidden="true">X</span><span><strong>Xで参考ポストを見る</strong><small>店主の自己申告 / 運営は本人・内容未確認</small></span><b aria-hidden="true">↗</b></a>`;
}

function renderCreatorCard(listing, { success = false } = {}) {
  const card = listing?.seller?.creatorCard;
  if (!card) {
    return `<section class="flea-creator-card-empty"><span>MY FAVORITE CARD</span><h3>${escapeHtml(listing?.seller?.name || "PLAYER")}</h3><p>この店主は、現在推しカードを公開していません。</p></section>`;
  }
  const content = shared()?.renderCreatorCard?.(card, { compact: true }) || "";
  return `<section class="flea-creator-card ${success ? "is-success" : ""}" aria-labelledby="fleaCreatorCardHeading">
    <div><span>${success ? "NEXT FAVORITE" : "ABOUT THIS PLAYER"}</span><h3 id="fleaCreatorCardHeading">${success ? "この人を、もっと知る" : "店主の推しカード"}</h3><p>${success ? "購入は終点ではなく、推し始めるきっかけです。" : "店主が公開設定した自己申告の情報です。運営による本人確認は行っていません。"}</p></div>
    ${content || `<p>${escapeHtml(card.text)}</p>`}
  </section>`;
}

function renderListingDetailBody(listing) {
  const category = categoryDefinition(listing.category);
  const own = state.ownListing?.id === listing.id;
  const open = listingIsOpen(listing);
  const affordable = state.balance >= listing.price;
  const xLink = renderXPostLink(listing.xPostUrl, listing.seller.name);
  return `<article class="flea-detail">
    <div class="flea-detail-head"><div><span class="flea-category is-${category.id}"><i aria-hidden="true">${category.mark}</i>${category.label}</span><small>${escapeHtml(listing.seller.name)}の今日の一品</small><h2>${escapeHtml(listing.title)}</h2></div><div class="flea-detail-price"><span>PRICE</span><strong>${formatAnjuPay(listing.price)}</strong><small>${escapeHtml(listingStatusLabel(listing))}</small></div></div>
    <section class="flea-description" aria-labelledby="fleaDescriptionHeading"><span>IN THEIR OWN WORDS</span><h3 id="fleaDescriptionHeading">ことばで紹介</h3><p>${escapeHtml(listing.description)}</p></section>
    ${xLink ? `<section class="flea-reference"><div><span>OPTIONAL REFERENCE</span><h3>もう少し知りたいときだけ</h3><p>ポスト本文や画像はゲーム内に表示しません。Xへ移動して自分で確かめられますが、リンク先の内容・継続公開を運営は保証しません。</p></div>${xLink}</section>` : ""}
    ${renderCreatorCard(listing)}
    <section class="flea-purchase-panel" aria-label="購入判断">
      <div><span>YOUR DECISION</span><h3>${own ? "これはあなたの出品です" : open ? "この一品を購入しますか？" : listingStatusLabel(listing)}</h3>
        <p>購入するのは実物や画像ではなく、このゲーム内でことばと人柄に価値をつける体験です。</p></div>
      <div class="flea-purchase-actions">
        ${own ? '<button class="button button-primary" type="button" data-flea-nav="own">今日の出品状況を見る</button>' : open ? `<button class="button button-primary" type="button" data-flea-purchase-review="${escapeHtml(listing.id)}" ${state.busyAction || !affordable ? "disabled" : ""}>${affordable ? `${formatAnjuPay(listing.price)}で購入内容を確認` : `あと${formatAnjuPay(listing.price - state.balance)}`}</button>${renderFavoriteButton(listing)}` : ""}
        <button class="button button-ghost" type="button" data-flea-nav="shelf">棚へ戻る</button>
      </div>
    </section>
    ${own ? "" : renderReportPanel(listing)}
  </article>`;
}

function renderReportPanel(listing) {
  const options = REPORT_REASONS.map((reason) => `<option value="${reason.id}">${escapeHtml(reason.label)}</option>`).join("");
  const reasonId = `fleaReportReason-${String(listing.id || "listing").replace(/[^-0-9A-Z_a-z]/gi, "-")}`;
  return `<details class="flea-report">
    <summary>この出品を通報する</summary>
    <form data-flea-report-form="${escapeHtml(listing.id)}"><label for="${escapeHtml(reasonId)}">理由</label><select id="${escapeHtml(reasonId)}" name="reason">${options}</select><p>権利・個人情報・成人向け・外部取引の通報では、出品本体を自動非表示にせず、参考Xリンクだけを直ちに安全確認中としてゲーム内から外します。「その他」は運営確認用に記録し、この端末では対象のXリンクを外します。購入・残高・ランキングには影響しません。</p><button class="button button-danger button-small" type="submit" ${state.busyAction ? "disabled" : ""}>通報を送る</button></form>
  </details>`;
}

function renderDetail() {
  const listing = currentListing();
  if (!listing) {
    return renderFrame(`<section class="flea-empty"><span aria-hidden="true">♡</span><h2>この出品は棚から離れました</h2><p>売れたか、本日の店じまいを迎えた可能性があります。</p><button class="button button-primary" type="button" data-flea-nav="shelf">今日の棚へ戻る</button></section>`);
  }
  return renderFrame(renderListingDetailBody(listing), { compactHeader: true });
}

function renderDraftPreview(draft = state.draft) {
  const category = categoryDefinition(draft.category);
  return `<article class="flea-draft-preview">
    <span>PUBLIC PREVIEW</span>
    <header><span class="flea-category is-${category.id}"><i aria-hidden="true">${category.mark}</i>${category.label}</span><strong>${formatAnjuPay(draft.price)}</strong></header>
    <small>FROM ${escapeHtml(draft.name || "PLAYER")}</small>
    <h3>${escapeHtml(draft.title || "今日の一品タイトル")}</h3>
    <p>${escapeHtml(draft.description || "どのような一品なのか、あなたのことばで紹介します。")}</p>
    ${draft.xPostUrl ? '<em><span aria-hidden="true">X</span> 参考ポストあり（ゲーム内表示なし）</em>' : ""}
  </article>`;
}

function renderSell() {
  if (hasTodayListing()) {
    state.screen = "own";
    return renderOwn();
  }
  const draft = state.draft;
  const categoryOptions = CATEGORY_DEFINITIONS.map((category) => `<label class="flea-category-choice"><input type="radio" name="fleaCategory" value="${category.id}" ${draft.category === category.id ? "checked" : ""} /><span><i aria-hidden="true">${category.mark}</i><strong>${category.label}</strong></span></label>`).join("");
  const priceOptions = state.policy.prices.map((price) => `<option value="${price}" ${integer(draft.price) === price ? "selected" : ""}>${formatAnjuPay(price)}</option>`).join("");
  return renderFrame(`<section class="flea-sell" aria-labelledby="fleaSellHeading">
    <div class="flea-section-head"><div><span>OPEN TODAY'S SHELF</span><h2 id="fleaSellHeading">今日の一品を、ことばで出す</h2><p>画像は投稿しません。何を選び、どう紹介する人なのかが買い手へ届きます。</p></div><small>出品は1日1回まで</small></div>
    <div class="flea-editor-layout">
      <aside class="flea-editor-preview"><div><span>LIVE PREVIEW</span><small>公開前に買い手からの見え方を確認</small></div><div id="fleaDraftPreview">${renderDraftPreview()}</div><p>下書きはこの端末に残し、本日の店じまい後も消しません。</p></aside>
      <form class="flea-form" id="fleaListingForm" aria-busy="${Boolean(state.busyAction)}">
        ${state.formError ? `<p class="flea-form-error" role="alert">${escapeHtml(state.formError)}</p>` : ""}
        <section><div class="flea-field-head"><label for="fleaSellerName">店主名</label><small>16文字以内</small></div><input id="fleaSellerName" name="name" type="text" maxlength="16" value="${escapeHtml(draft.name)}" autocomplete="nickname" required /><small>公開中の推しカードがある場合は、カードの名前を店主名として使います。</small></section>
        <fieldset><legend>興味カテゴリ</legend><p>細かな分類ではなく、見つけてもらう入口です。</p><div class="flea-category-choices">${categoryOptions}</div></fieldset>
        <section><div class="flea-field-head"><label for="fleaTitle">一品タイトル</label><span><b id="fleaTitleCount">${draft.title.length}</b> / 30</span></div><input id="fleaTitle" name="title" type="text" maxlength="30" value="${escapeHtml(draft.title)}" required /></section>
        <section><div class="flea-field-head"><label for="fleaDescription">ことばで紹介</label><span><b id="fleaDescriptionCount">${draft.description.length}</b> / 240</span></div><textarea id="fleaDescription" name="description" minlength="20" maxlength="240" rows="7" required>${escapeHtml(draft.description)}</textarea><small>20〜240文字。個人情報、外部連絡、実物/外部取引、成人向け内容は掲載できません。Xポストは下の専用欄を使ってください。</small></section>
        <section class="flea-price-field"><label for="fleaPrice">価格</label><select id="fleaPrice" name="price">${priceOptions}</select><small>買い手の支払額です。販売成立時は販売手数料が差し引かれます。</small></section>
        <section class="flea-x-field"><div class="flea-field-head"><label for="fleaXPostUrl">参考にするXポスト（任意）</label><small>個別ポストのみ</small></div><input id="fleaXPostUrl" name="xPostUrl" type="url" inputmode="url" maxlength="240" value="${escapeHtml(draft.xPostUrl)}" placeholder="https://x.com/username/status/..." autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="fleaXPostHint" /><small id="fleaXPostHint">自分のポストで、推しカードに公開中のXユーザー名と一致する個別ポストだけを指定できます。ゲーム内にはポスト本文・画像・プレビューを表示せず、外部リンクだけを置きます。</small>
          <label class="flea-consent"><input id="fleaXConsent" name="xConsent" type="checkbox" ${draft.xConsent ? "checked" : ""} /><span>自分の投稿で、必要な権利・写っている人の公開同意があり、成人向け・個人情報・実物/外部取引を含まないこと、推しカードに公開中の同じXユーザー名から投稿したことを確認し、外部リンクの公開に同意します</span></label></section>
        <div class="flea-public-note"><strong>公開されるもの</strong><span>店主名、カテゴリ、タイトル、説明文、価格、任意で許可したXポストリンク、公開中の推しカード。</span></div>
        <div class="flea-form-actions"><button class="button button-primary" type="submit" ${state.busyAction ? "disabled" : ""}>出品内容を確認</button><button class="button button-ghost" type="button" data-flea-nav="shelf">出品せず棚を見る</button></div>
      </form>
    </div>
  </section>`);
}

function validateDraft(draft = state.draft) {
  const name = boundedText(draft.name, 16);
  if (!name || /[\r\n\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, field: "fleaSellerName", message: "店主名は1行16文字以内で入力してください。" };
  }
  if (!CATEGORY_IDS.has(draft.category)) {
    return { ok: false, field: "fleaCategory", message: "興味カテゴリを選び直してください。" };
  }
  const title = String(draft.title || "").trim();
  if (!title || title.length > 30 || /[\r\n\u0000-\u001f\u007f]/.test(title)) {
    return { ok: false, field: "fleaTitle", message: "タイトルは1行30文字以内で入力してください。" };
  }
  const description = String(draft.description || "").trim();
  if (description.length < 20 || description.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
    return { ok: false, field: "fleaDescription", message: "紹介文は20〜240文字で入力してください。" };
  }
  if (URL_LIKE_PATTERN.test(description) || EMAIL_PATTERN.test(description)) {
    return { ok: false, field: "fleaDescription", message: "紹介文にはURLやメールアドレスを書かず、Xは専用欄から設定してください。" };
  }
  const price = integer(draft.price);
  if (!state.policy.prices.includes(price)) {
    return { ok: false, field: "fleaPrice", message: "価格を選び直してください。" };
  }
  const rawXPostUrl = String(draft.xPostUrl || "").trim();
  const xPostUrl = normalizeXPostUrl(rawXPostUrl);
  if (rawXPostUrl && !xPostUrl) {
    return { ok: false, field: "fleaXPostUrl", message: "Xの個別ポストURLを https://x.com/ユーザー名/status/数字 の形で入力してください。" };
  }
  if (xPostUrl && draft.xConsent !== true) {
    return { ok: false, field: "fleaXConsent", message: "Xポストリンクを公開する場合は、専用の同意欄を確認してください。" };
  }
  return {
    ok: true,
    value: {
      name,
      category: draft.category,
      title,
      description,
      price,
      xPostUrl,
      xConsent: Boolean(xPostUrl),
    },
  };
}

function renderFeeSummary(price, { includeListingFee = true } = {}) {
  const fee = successFee(price);
  return `<dl class="flea-fee-summary">
    ${includeListingFee ? `<div><dt>本日の出品手数料</dt><dd>${formatAnjuPay(state.policy.listingFee)}</dd></div>` : ""}
    <div><dt>販売価格</dt><dd>${formatAnjuPay(price)}</dd></div>
    <div><dt>成立時の販売手数料</dt><dd>${formatAnjuPay(fee)} <small>${successFeeRateLabel()}%・最低${formatAnjuPay(state.policy.minimumSuccessFee)}</small></dd></div>
    <div><dt>成立時の受取額</dt><dd>${formatAnjuPay(Math.max(0, price - fee))}</dd></div>
  </dl>`;
}

function renderPublishReview() {
  const validation = validateDraft();
  if (!validation.ok) {
    state.formError = validation.message;
    state.screen = "sell";
    return renderSell();
  }
  const draft = validation.value;
  const balanceAfter = state.balance - state.policy.listingFee;
  return renderFrame(`<section class="flea-review" aria-labelledby="fleaPublishReviewHeading">
    <div class="flea-review-head"><span>FINAL LISTING REVIEW</span><h2 id="fleaPublishReviewHeading">今日の棚へ出す前に</h2><p>公開内容、店じまいの時刻、手数料を確認してください。</p></div>
    <div class="flea-review-grid">
      ${renderDraftPreview(draft)}
      <section class="flea-review-values">
        ${renderFeeSummary(draft.price)}
        <div class="flea-balance-check"><span>現在の残高 <strong>${formatAnjuPay(state.balance)}</strong></span><span>出品後 <strong>${balanceAfter >= 0 ? formatAnjuPay(balanceAfter) : "残高不足"}</strong></span></div>
        <div class="flea-review-caution"><strong>本日23:59で店じまいします</strong><p>売れなくても紹介文の下書きはこの端末に残ります。取り下げても本日の出品回数と手数料は戻りません。</p></div>
        <div class="flea-market-boundary"><strong>推し値市場とは別に記録されます</strong><span>ランキング、実績、常連帳、店主評価、パトロンには加算しません。</span></div>
      </section>
    </div>
    <div class="flea-review-actions"><button class="button button-primary" type="button" data-flea-publish ${state.busyAction || balanceAfter < 0 ? "disabled" : ""}>${state.busyAction === "create_listing" ? "出品を確定しています…" : balanceAfter < 0 ? `あと${formatAnjuPay(-balanceAfter)}` : `${formatAnjuPay(state.policy.listingFee)}を支払い出品を確定`}</button><button class="button button-ghost" type="button" data-flea-nav="sell" ${state.busyAction ? "disabled" : ""}>内容を直す</button></div>
  </section>`, { compactHeader: true });
}

function renderOwn() {
  const listing = state.ownListing;
  if (!listing || listing.dateKey !== state.dateKey) {
    return renderFrame(`<section class="flea-empty"><span aria-hidden="true">✎</span><h2>今日はまだ棚を開いていません</h2><p>下書きはこの端末に残っています。気が向いたときに今日の一品を選べます。</p><button class="button button-primary" type="button" data-flea-nav="sell">今日の一品を出す</button></section>`);
  }
  const open = listingIsOpen(listing);
  const matchingReceipt = state.receipts.find((receipt) => (
    receipt.role === "seller" && receipt.id === listing.id
  ));
  return renderFrame(`<section class="flea-own" aria-labelledby="fleaOwnHeading">
    <div class="flea-section-head"><div><span>MY TODAY'S SHELF</span><h2 id="fleaOwnHeading">${escapeHtml(listingStatusLabel(listing))}</h2><p>${open ? "ことばを棚へ置きました。売れたかどうかは、ここへ戻ると確認できます。" : listing.status === "sold" ? "あなたのことばと人柄を選んだプレイヤーがいました。" : "紹介文の下書きは端末へ残しています。"}</p></div><small>本日の出品回数は使用済みです</small></div>
    ${renderListingDetailBody(listing)}
    ${matchingReceipt ? `<section class="flea-own-settlement"><span>SETTLEMENT</span><h3>販売の記録</h3>${renderFeeSummary(matchingReceipt.price, { includeListingFee: false })}<p>実際の受取額はサーバーで確定した${formatAnjuPay(matchingReceipt.sellerProceeds)}です。</p></section>` : ""}
    ${open ? `<section class="flea-cancel-panel"><button class="button button-danger button-small" type="button" data-flea-cancel-review aria-expanded="${state.cancelReviewOpen}" aria-controls="fleaCancelConfirm">出品を取り下げる</button><div id="fleaCancelConfirm" tabindex="-1" ${state.cancelReviewOpen ? "" : "hidden"}><strong>本当に取り下げますか？</strong><p>手数料と本日の出品回数は戻りません。下書きは端末に残ります。</p><button class="button button-danger" type="button" data-flea-cancel="${escapeHtml(listing.id)}" ${state.busyAction ? "disabled" : ""}>取り下げを確定</button></div></section>` : ""}
  </section>`);
}

function renderPurchaseReview() {
  const listing = currentListing();
  if (!listing || !listingIsOpen(listing)) {
    state.screen = "detail";
    return renderDetail();
  }
  const affordable = state.balance >= listing.price;
  const balanceAfter = state.balance - listing.price;
  return renderFrame(`<section class="flea-review flea-purchase-review" aria-labelledby="fleaPurchaseReviewHeading">
    <div class="flea-review-head"><span>FINAL PURCHASE REVIEW</span><h2 id="fleaPurchaseReviewHeading">購入内容の最終確認</h2><p>Payは貴重です。納得できる場合だけ確定してください。</p></div>
    <div class="flea-purchase-summary"><div><span>${escapeHtml(categoryDefinition(listing.category).label)}</span><h3>${escapeHtml(listing.title)}</h3><p>${escapeHtml(listing.seller.name)}の一品</p></div><strong>${formatAnjuPay(listing.price)}</strong></div>
    <dl class="flea-purchase-values"><div><dt>現在の残高</dt><dd>${formatAnjuPay(state.balance)}</dd></div><div><dt>今回の支払額</dt><dd>${formatAnjuPay(listing.price)}</dd></div><div><dt>購入後残高</dt><dd>${affordable ? formatAnjuPay(balanceAfter) : "残高不足"}</dd></div></dl>
    <div class="flea-delivery-boundary">
      <section><span aria-hidden="true">♡</span><div><strong>届くもの</strong><p>ゲーム内の出会いの記録</p></div></section>
      <section><span aria-hidden="true">×</span><div><strong>届かないもの</strong><p>実物・画像データ・衣服・権利</p></div></section>
    </div>
    <p class="flea-purchase-consent">これは、店主の紹介することばと人柄へAnjuPayで価値をつけるゲーム内体験です。発送、DMでの受け渡し、現金取引は発生しません。</p>
    <div class="flea-review-actions"><button class="button button-primary" type="button" data-flea-buy="${escapeHtml(listing.id)}" ${state.busyAction || !affordable ? "disabled" : ""}>${state.busyAction === "buy" ? "購入を確定しています…" : affordable ? `${formatAnjuPay(listing.price)}を支払って購入を確定` : `あと${formatAnjuPay(-balanceAfter)}`}</button><button class="button button-ghost" type="button" data-flea-nav="detail" ${state.busyAction ? "disabled" : ""}>もう一度考える</button></div>
  </section>`, { compactHeader: true });
}

function renderSuccess() {
  const listing = state.success?.listing || currentListing();
  const purchase = state.success?.purchase || {};
  if (!listing) {
    state.screen = "history";
    return renderHistory();
  }
  return renderFrame(`<section class="flea-success" role="status" aria-live="polite" aria-labelledby="fleaSuccessHeading" tabindex="-1">
    <div class="flea-success-mark" aria-hidden="true">♡</div><span>PUSH FOUND</span><h2 id="fleaSuccessHeading">この人のことばへ、Payが届きました</h2><p>「買った」で終わらず、気になった人をもっと知る入口にできます。</p>
    <div class="flea-success-record"><div><small>出会いの記録</small><strong>${escapeHtml(listing.title)}</strong><span>${escapeHtml(listing.seller.name)}</span></div><strong>${formatAnjuPay(purchase.price || listing.price)}</strong></div>
    ${renderXPostLink(listing.xPostUrl, listing.seller.name, { className: "is-success" })}
    ${renderCreatorCard(listing, { success: true })}
    <section class="flea-live-market-path"><div><span>WHEN YOU WANT TO HEAR THEIR WORDS</span><h3>直接ことばを聞きたいときは、推し値市場へ</h3><p>推し値市場は、売り手が時間と労力をかけて対面営業する別の場所です。フリマの購入実績や店主推し帳は持ち込みません。同じ店主と会える保証はありませんし、優先マッチにもなりません。</p></div><button class="button hero-market-button" type="button" data-flea-open-value-market>推し値市場を見る</button></section>
    <div class="flea-success-actions"><button class="button button-primary" type="button" data-flea-nav="shelf">ほかの一品を見る</button><button class="button button-ghost" type="button" data-flea-nav="history">出会いの記録を見る</button><button class="button button-ghost" type="button" data-flea-home>トップへ戻る</button></div>
  </section>`, { compactHeader: true });
}

function renderHistoryReceipt(receipt) {
  const category = categoryDefinition(receipt.listing.category);
  const seller = receipt.role === "seller";
  return `<article class="flea-receipt">
    <header><span>${seller ? "SOLD" : "FOUND"}</span><time datetime="${escapeHtml(new Date(receipt.createdAt).toISOString())}">${escapeHtml(formatDateTime(receipt.createdAt))}</time></header>
    <div><span class="flea-category is-${category.id}"><i aria-hidden="true">${category.mark}</i>${category.label}</span><h3>${escapeHtml(receipt.listing.title)}</h3><p>${seller ? "購入者" : "店主"}：${escapeHtml(receipt.counterpartyName)}</p></div>
    <dl><div><dt>${seller ? "販売価格" : "支払額"}</dt><dd>${formatAnjuPay(receipt.price)}</dd></div>${seller ? `<div><dt>販売手数料</dt><dd>${formatAnjuPay(receipt.feeAmount)}</dd></div><div><dt>受取額</dt><dd>${formatAnjuPay(receipt.sellerProceeds)}</dd></div>` : ""}</dl>
    ${receipt.listing.xPostUrl ? renderXPostLink(receipt.listing.xPostUrl, receipt.counterpartyName, { className: "is-compact" }) : ""}
    ${seller ? "" : renderReportPanel({ id: receipt.id })}
  </article>`;
}

function renderHistory() {
  const records = state.receipts.length
    ? `<div class="flea-history-grid">${state.receipts.map(renderHistoryReceipt).join("")}</div>`
    : `<section class="flea-empty"><span aria-hidden="true">♡</span><h2>出会いの記録はまだありません</h2><p>購入または販売が成立すると、ここへゲーム内の記録が残ります。</p><button class="button button-primary" type="button" data-flea-nav="shelf">今日の棚を見る</button></section>`;
  return renderFrame(`<section class="flea-history" aria-labelledby="fleaHistoryHeading">
    <div class="flea-section-head"><div><span>ENCOUNTER RECORDS</span><h2 id="fleaHistoryHeading">出会いの記録</h2><p>実物や権利の所有証明ではなく、このゲーム内で誰かのことばを選んだ記録です。</p></div><small>ランキングには使用しません</small></div>
    ${records}
  </section>`);
}

function render() {
  if (!active || !appRoot) return;
  if (state.loading) {
    appRoot.innerHTML = renderLoading();
    lastRenderedScreen = "loading";
    appRoot.focus({ preventScroll: true });
    return;
  }
  const screenChanged = lastRenderedScreen !== state.screen;
  if (state.screen === "shelf") appRoot.innerHTML = renderShelf();
  else if (state.screen === "favorites") appRoot.innerHTML = renderFavorites();
  else if (state.screen === "detail") appRoot.innerHTML = renderDetail();
  else if (state.screen === "sell") appRoot.innerHTML = renderSell();
  else if (state.screen === "publish-review") appRoot.innerHTML = renderPublishReview();
  else if (state.screen === "own") appRoot.innerHTML = renderOwn();
  else if (state.screen === "purchase-review") appRoot.innerHTML = renderPurchaseReview();
  else if (state.screen === "success") appRoot.innerHTML = renderSuccess();
  else if (state.screen === "history") appRoot.innerHTML = renderHistory();
  else appRoot.innerHTML = renderError();
  lastRenderedScreen = state.screen;
  bindEvents();
  if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function navigate(screen) {
  if (!active) return;
  const target = SCREEN_IDS.has(screen) ? screen : "shelf";
  state.formError = "";
  state.notice = "";
  if (target === "sell" && hasTodayListing()) state.screen = "own";
  else if (target === "detail" && !currentListing()) state.screen = "shelf";
  else state.screen = target;
  render();
}

function captureDraftFromForm() {
  const form = document.querySelector("#fleaListingForm");
  if (!form) return;
  state.draft = {
    name: String(document.querySelector("#fleaSellerName")?.value ?? "").slice(0, 16),
    category: document.querySelector('input[name="fleaCategory"]:checked')?.value || "illustration",
    title: String(document.querySelector("#fleaTitle")?.value ?? "").slice(0, 30),
    description: String(document.querySelector("#fleaDescription")?.value ?? "").slice(0, 240),
    price: integer(document.querySelector("#fleaPrice")?.value, state.policy.prices[0]),
    xPostUrl: String(document.querySelector("#fleaXPostUrl")?.value ?? "").slice(0, 240),
    xConsent: document.querySelector("#fleaXConsent")?.checked === true,
  };
  saveDraft();
}

function updateDraftPreview() {
  captureDraftFromForm();
  const preview = document.querySelector("#fleaDraftPreview");
  if (preview) preview.innerHTML = renderDraftPreview();
  const titleCount = document.querySelector("#fleaTitleCount");
  if (titleCount) titleCount.textContent = String(state.draft.title.length);
  const descriptionCount = document.querySelector("#fleaDescriptionCount");
  if (descriptionCount) descriptionCount.textContent = String(state.draft.description.length);
}

function submitListingDraft(event) {
  event.preventDefault();
  captureDraftFromForm();
  const validation = validateDraft();
  if (!validation.ok) {
    state.formError = validation.message;
    render();
    const field = validation.field === "fleaCategory"
      ? document.querySelector('input[name="fleaCategory"]')
      : document.getElementById(validation.field);
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  state.draft = { ...state.draft, ...validation.value };
  saveDraft();
  state.formError = "";
  state.screen = "publish-review";
  render();
}

async function performAction(action, payload = {}) {
  if (!active || state.busyAction) return null;
  const generation = lifecycleGeneration;
  const requestedListingId = String(payload.listingId || "");
  const requestedListing = requestedListingId
    ? state.listings.find((listing) => listing.id === requestedListingId) || null : null;
  const selectedBefore = action === "set_favorite" ? requestedListing : currentListing();
  state.busyAction = action;
  state.notice = "";
  state.errorMessage = "";
  if (action === "browse_more") state.browseErrorMessage = "";
  render();
  try {
    if (useFleaPreview) {
      await performPreviewAction(action, payload, selectedBefore);
      return {};
    }
    const response = await fleaActionCallable({ action, ...payload });
    if (!isCurrentLifecycle(generation)) return null;
    const data = response.data && typeof response.data === "object" ? response.data : {};
    applyServerState(data, {
      browseMode: action === "browse_more" ? "append" : "preserve",
    });
    if (action === "create_listing") {
      const createdListing = normalizeListing(data.createdListing) || state.ownListing;
      if (createdListing) {
        state.ownListing = createdListing;
        if (!createdListing.dateKey || createdListing.dateKey === state.dateKey) {
          state.listings = [createdListing, ...state.listings.filter((listing) => listing.id !== createdListing.id)];
        }
      }
      state.screen = "own";
      state.notice = "今日の一品を棚へ出しました。下書きはこの端末に残しています。";
    } else if (action === "buy") {
      const listing = selectedBefore || currentListing();
      state.listings = state.listings.map((entry) => (
        entry.id === requestedListingId ? { ...entry, status: "sold" } : entry
      ));
      state.success = {
        listing,
        purchase: data.purchase && typeof data.purchase === "object" ? data.purchase : {
          price: listing?.price || 0,
        },
      };
      state.screen = "success";
    } else if (action === "cancel_listing") {
      state.cancelReviewOpen = false;
      state.screen = "own";
      state.notice = "本日の出品を取り下げました。下書きはこの端末に残っています。";
      state.listings = state.listings.map((entry) => (
        entry.id === requestedListingId ? { ...entry, status: "canceled" } : entry
      ));
    } else if (action === "set_favorite") {
      applyLocalFavoriteAction(selectedBefore, payload);
      state.notice = payload.favorite
        ? "この店主を非公開の推し帳に加えました。"
        : "この店主を推し帳から外しました。";
    } else if (action === "report") {
      const reportedListingId = String(data.reported?.listingId || requestedListingId);
      removeReportedListingXLocally(reportedListingId);
      state.notice = data.reported?.xQuarantined === true
        ? "通報を受け付けました。参考Xリンクは安全確認中のため、ゲーム内での表示を止めました。"
        : "通報を受け付けました。この端末では対象のXリンクを表示しません。";
    } else if (action === "browse_more") {
      state.browseErrorMessage = "";
    }
    return data;
  } catch (error) {
    if (!isCurrentLifecycle(generation)) return null;
    const message = friendlyMessage(error, "AnjuPayフリマの操作を完了できませんでした。");
    state.errorMessage = message;
    if (action === "create_listing") {
      state.formError = message;
      state.screen = "sell";
    } else if (action === "browse_more") {
      state.browseErrorMessage = message;
    } else {
      state.notice = message;
    }
    return null;
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busyAction = "";
      render();
    }
  }
}

async function performPreviewAction(action, payload, selectedBefore) {
  if (action === "create_listing") {
    const validation = validateDraft();
    if (!validation.ok) throw new Error(validation.message);
    const listing = normalizeListing({
      id: "flea-preview-own-created",
      dateKey: state.dateKey,
      ...validation.value,
      status: "active",
      createdAt: currentServerTime(),
      expiresAt: state.expiresAt,
      seller: {
        publicSellerId: "flea-preview-owner",
        name: validation.value.name,
        creatorCard: previewCreatorCard(validation.value.name),
      },
    });
    state.ownListing = listing;
    state.listings = [listing, ...state.listings];
    state.balance = Math.max(0, state.balance - state.policy.listingFee);
    state.screen = "own";
    state.notice = "PREVIEW：今日の一品を棚へ出した表示に切り替えました。";
  } else if (action === "buy") {
    const listing = selectedBefore;
    if (!listing) throw new Error("出品を確認できません。");
    state.balance = Math.max(0, state.balance - listing.price);
    state.listings = state.listings.map((entry) => (
      entry.id === listing.id ? { ...entry, status: "sold" } : entry
    ));
    state.success = {
      listing,
      purchase: {
        id: "flea-preview-purchase",
        status: "sold",
        price: listing.price,
        counterpartyName: listing.seller.name,
      },
    };
    state.screen = "success";
  } else if (action === "cancel_listing") {
    if (state.ownListing) state.ownListing = { ...state.ownListing, status: "canceled" };
    state.listings = state.listings.map((entry) => (
      entry.id === payload.listingId ? { ...entry, status: "canceled" } : entry
    ));
    state.cancelReviewOpen = false;
    state.notice = "PREVIEW：取り下げ後の表示に切り替えました。";
  } else if (action === "set_favorite") {
    applyLocalFavoriteAction(selectedBefore, payload);
    state.notice = payload.favorite
      ? "PREVIEW：この店主を非公開の推し帳に加えました。"
      : "PREVIEW：この店主を推し帳から外しました。";
  } else if (action === "report") {
    removeReportedListingXLocally(payload.listingId);
    state.notice = "PREVIEW：通報後に対象のXリンクを外す表示です。実際には送信していません。";
  } else if (action === "browse_more") {
    state.nextBrowseCursor = "";
    state.browseErrorMessage = "";
  }
}

function openValueMarket() {
  if (!active) return;
  const invoke = () => {
    if (typeof window.HariaiMarket?.start !== "function") return false;
    window.HariaiMarket.start();
    return true;
  };
  const readyNow = typeof window.HariaiMarket?.start === "function";
  if (!readyNow) {
    window.addEventListener("hariai-market-ready", () => {
      window.setTimeout(() => {
        if (!invoke()) showToast("推し値市場を開けませんでした。ページを読み直してお試しください。");
      }, 0);
    }, { once: true });
  }
  returnHome();
  if (readyNow) window.setTimeout(invoke, 0);
}

function bindFleaXLinkConfirmations() {
  document.querySelectorAll(".flea-screen a[href]").forEach((link) => {
    let linkUrl = null;
    try {
      linkUrl = new URL(link.getAttribute("href") || "", location.href);
    } catch {
      return;
    }
    if (
      linkUrl.protocol !== "https:"
      || !["x.com", "www.x.com"].includes(linkUrl.hostname.toLowerCase())
    ) return;
    const confirmNavigation = (event) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      if (window.confirm(FLEA_X_EXTERNAL_CONFIRM_MESSAGE)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    link.addEventListener("click", confirmNavigation);
    link.addEventListener("auxclick", confirmNavigation);
  });
}

function bindEvents() {
  bindFleaXLinkConfirmations();
  document.querySelectorAll("[data-flea-home]").forEach((button) => {
    button.addEventListener("click", requestHome);
  });
  document.querySelectorAll("[data-flea-refresh]").forEach((button) => {
    button.addEventListener("click", () => {
      if (useFleaPreview) {
        state.notice = "LOCAL UI PREVIEWではFirebaseへ接続しません。";
        render();
      } else {
        refreshState();
      }
    });
  });
  document.querySelectorAll("[data-flea-nav]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.fleaNav));
  });
  document.querySelectorAll("[data-flea-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = button.dataset.fleaCategory;
      state.categoryFilter = category === "all" || CATEGORY_IDS.has(category) ? category : "all";
      render();
      document.querySelector(`[data-flea-category="${state.categoryFilter}"]`)?.focus({ preventScroll: true });
    });
  });
  document.querySelector("[data-flea-browse-more]")?.addEventListener("click", () => {
    const cursor = state.nextBrowseCursor;
    if (!cursor) return;
    if (state.expiresAt && currentServerTime() >= state.expiresAt) {
      refreshState();
      return;
    }
    performAction("browse_more", { cursor });
  });
  document.querySelectorAll("[data-flea-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedListingId = String(button.dataset.fleaDetail || "");
      navigate("detail");
    });
  });
  document.querySelectorAll("[data-flea-favorite]").forEach((button) => {
    button.addEventListener("click", () => {
      const listingId = String(button.dataset.fleaFavorite || "");
      const listing = state.listings.find((entry) => entry.id === listingId) || currentListing();
      const sellerId = listing?.seller?.publicSellerId || "";
      if (!sellerId) return;
      performAction("set_favorite", {
        listingId,
        favorite: !state.favorites.has(sellerId),
      });
    });
  });
  document.querySelectorAll("[data-flea-unfavorite-seller]").forEach((button) => {
    button.addEventListener("click", () => {
      const publicSellerId = String(button.dataset.fleaUnfavoriteSeller || "");
      if (!publicSellerId) return;
      performAction("set_favorite", {
        publicSellerId,
        favorite: false,
      });
    });
  });
  document.querySelectorAll("[data-flea-purchase-review]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedListingId = String(button.dataset.fleaPurchaseReview || "");
      navigate("purchase-review");
    });
  });
  const form = document.querySelector("#fleaListingForm");
  form?.addEventListener("submit", submitListingDraft);
  form?.querySelectorAll("input, textarea, select").forEach((control) => {
    control.addEventListener("input", updateDraftPreview);
    control.addEventListener("change", updateDraftPreview);
  });
  document.querySelector("[data-flea-publish]")?.addEventListener("click", () => {
    const validation = validateDraft();
    if (!validation.ok) {
      state.formError = validation.message;
      state.screen = "sell";
      render();
      return;
    }
    performAction("create_listing", validation.value);
  });
  document.querySelector("[data-flea-buy]")?.addEventListener("click", (event) => {
    performAction("buy", { listingId: event.currentTarget.dataset.fleaBuy });
  });
  document.querySelector("[data-flea-cancel-review]")?.addEventListener("click", () => {
    state.cancelReviewOpen = !state.cancelReviewOpen;
    render();
    if (state.cancelReviewOpen) document.querySelector("#fleaCancelConfirm")?.focus?.({ preventScroll: true });
  });
  document.querySelector("[data-flea-cancel]")?.addEventListener("click", (event) => {
    performAction("cancel_listing", { listingId: event.currentTarget.dataset.fleaCancel });
  });
  document.querySelectorAll("[data-flea-report-form]").forEach((reportForm) => {
    reportForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const reason = String(new FormData(reportForm).get("reason") || "");
      if (!REPORT_REASON_IDS.has(reason)) {
        showToast("通報理由を選び直してください。");
        return;
      }
      performAction("report", {
        listingId: reportForm.dataset.fleaReportForm,
        reason,
      });
    });
  });
  document.querySelector("[data-flea-open-value-market]")?.addEventListener("click", openValueMarket);
}

async function start({ initialScreen = "shelf" } = {}) {
  const normalizedInitialScreen = ["sell", "own", "favorites", "history"].includes(initialScreen)
    ? initialScreen
    : "shelf";
  if (active) {
    navigate(normalizedInitialScreen);
    return;
  }
  if (location.protocol === "file:") {
    showToast("AnjuPayフリマはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  const anotherModeActive = window.HariaiAccount?.isActive?.()
    || window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiTeam?.isActive?.()
    || window.HariaiRoyale?.isActive?.()
    || window.HariaiMarket?.isActive?.();
  if (anotherModeActive) {
    showToast("ほかのモードを終了してからAnjuPayフリマを開いてください。");
    return;
  }
  active = true;
  const generation = ++lifecycleGeneration;
  state = createState(normalizedInitialScreen);
  lastRenderedScreen = "";
  setFleaChrome(useFleaPreview ? "ANJUPAY FLEA PREVIEW" : "CONNECTING");
  render();
  if (useFleaPreview) {
    applyPreviewState(normalizedInitialScreen);
    return;
  }
  try {
    const user = await ensureUser();
    if (!isCurrentLifecycle(generation)) return;
    state.uid = String(user.uid || "");
    state.authReady = true;
    const response = await fleaActionCallable({ action: "state" });
    if (!isCurrentLifecycle(generation)) return;
    applyServerState(response.data);
    state.loading = false;
    setFleaChrome();
    if (state.screen === "sell" && hasTodayListing()) state.screen = "own";
    render();
  } catch (error) {
    if (!isCurrentLifecycle(generation)) return;
    state.loading = false;
    state.screen = "error";
    state.errorMessage = friendlyMessage(error, "AnjuPayフリマへ接続できませんでした。");
    setFleaChrome("FLEA MARKET ERROR");
    render();
  }
}

function isActive() {
  return active;
}

function returnHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  window.clearTimeout(boundaryTimer);
  boundaryTimer = null;
  state.busyAction = "";
  window.HariaiApp?.returnHome?.();
}

function requestHome() {
  returnHome();
}

window.addEventListener("visibilitychange", () => {
  if (!active || document.visibilityState !== "visible" || useFleaPreview) return;
  if (state.expiresAt && currentServerTime() >= state.expiresAt) {
    refreshState({ silent: true });
  }
});

window.addEventListener("beforeunload", () => {
  active = false;
  lifecycleGeneration += 1;
  window.clearTimeout(boundaryTimer);
});

window.HariaiFleaMarket = Object.freeze({
  start,
  isActive,
  requestHome,
});
window.dispatchEvent(new Event("hariai-flea-market-ready"));
