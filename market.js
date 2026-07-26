import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  limitToLast,
  onChildAdded,
  onDisconnect,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  auth,
  database,
  firestore,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2-oshi-jouzu-duo-v1-restore-v1";
import {
  ANJU_PAY_UNIT,
  formatAnjuPay,
  formatAnjuPayNumber,
} from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import {
  createIncomingMarketTransfer,
  marketAssetEndStatus,
  verifiedMarketImageMime,
  verifiedMarketImageMimeFromChunks,
} from "./market-transfer.mjs?v=value-market-transfer-v1";
import {
  getPlayerTitlePresentation,
  getPlayerTitleProduct,
} from "./player-titles.js?v=player-titles-v2-oshi-jouzu-duo-v1-restore-v1";
import {
  getStamp,
} from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1";

const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const MARKET_ROLE_KEY = "hariai-stadium-value-market-role-v1";
const ENTRY_FEE = 5;
const MAX_TURNS = 3;
const ANJU_PAY_MAX_BALANCE = 999_999_999;
const MARKET_PRICES = Object.freeze([10, 25, 50, 100, 200, 300, 500]);
const MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS = 20_000;
const DEFAULT_MARKET_POLICY = Object.freeze({
  successFeeBasisPoints: 500,
  minimumSuccessFee: 1,
});
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 480 * 1024;
const TERMINAL_STATES = new Set(["sold", "ended", "canceled"]);
const MARKET_X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const MARKET_TAGLINE_MAX_LENGTH = 40;
const MARKET_SHOP_NAME_MAX_LENGTH = 16;
const MARKET_SHOP_TAGLINE_MAX_LENGTH = 40;
const MARKET_SHOP_MAX_SPECIALTY_TAGS = 3;
const MARKET_SHOP_MAX_SERVICE_STYLES = 2;
const OSHIJO_SERVICE_STYLE_ID = "oshijo";
const OSHIJO_CLOSING_MODE = "oshijo";
const OSHIJO_MAX_CLAIM_AMOUNT = 999_999;
const OSHIJO_RANKING_CAP = 500;
const OSHIJO_MAX_CLOSING_TURNS = 3;
const OSHIJO_CLOSING_TEXT_MAX_LENGTH = 160;
const OSHIJO_CLOSING_IMAGE_PREFIX = "oshijo-closing-image:";
const OSHIJO_CLOSING_AUDIO_PREFIX = "oshijo-closing-audio:";
const MARKET_RANKING_PERIODS = Object.freeze(["monthly", "lifetime"]);
const FREE_MARKET_SHOP_CHARM_IDS = Object.freeze([
  "stamp_like",
  "stamp_cute",
  "stamp_surprise",
  "stamp_thanks",
]);
const MARKET_SHOP_FALLBACK_CATALOG = Object.freeze({
  specialtyTags: Object.freeze([
    Object.freeze({ id: "animals", label: "どうぶつ" }),
    Object.freeze({ id: "landscape", label: "風景" }),
    Object.freeze({ id: "food", label: "食べもの" }),
    Object.freeze({ id: "people", label: "人物" }),
    Object.freeze({ id: "illustration", label: "イラスト" }),
    Object.freeze({ id: "night", label: "夜景" }),
    Object.freeze({ id: "humor", label: "ネタ" }),
    Object.freeze({ id: "story", label: "物語" }),
  ]),
  serviceStyles: Object.freeze([
    Object.freeze({ id: "story", label: "物語で伝える" }),
    Object.freeze({ id: "technical", label: "技術を解説" }),
    Object.freeze({ id: "intuition", label: "直感で語る" }),
    Object.freeze({ id: "concise", label: "ひとこと勝負" }),
    Object.freeze({ id: "audio", label: "音声で熱く" }),
    Object.freeze({ id: "careful", label: "じっくり丁寧" }),
    Object.freeze({ id: "oshijo", label: "推し嬢（熱血クロージング）" }),
  ]),
  themes: Object.freeze([
    Object.freeze({ id: "standard", label: "スタンダード" }),
    Object.freeze({ id: "sakura", label: "さくら" }),
    Object.freeze({ id: "lavender", label: "ラベンダー" }),
    Object.freeze({ id: "mint", label: "ミント" }),
    Object.freeze({ id: "cream", label: "クリーム" }),
    Object.freeze({ id: "midnight", label: "ミッドナイト" }),
  ]),
  seals: Object.freeze([
    Object.freeze({ id: "heart", label: "ハート", icon: "♥" }),
    Object.freeze({ id: "star", label: "スター", icon: "★" }),
    Object.freeze({ id: "ribbon", label: "リボン", icon: "◆" }),
    Object.freeze({ id: "flower", label: "フラワー", icon: "✿" }),
    Object.freeze({ id: "cat", label: "キャット", icon: "●" }),
    Object.freeze({ id: "moon", label: "ムーン", icon: "☾" }),
  ]),
  impressionTags: Object.freeze([
    Object.freeze({ id: "kind", label: "やさしい接客" }),
    Object.freeze({ id: "insightful", label: "新しい魅力に気づけた" }),
    Object.freeze({ id: "memorable_voice", label: "言葉・声が印象的" }),
    Object.freeze({ id: "want_more", label: "もっと見たい" }),
  ]),
});
const PATRON_FUND_POLICY_LABELS = Object.freeze({
  balanced: "出会いと常連",
  discovery: "新しい出会い",
  trust: "常連の信頼",
});
const PATRON_FUND_KIND_LABELS = Object.freeze({
  discovery: "新しい商店との成立",
  trust: "常連商店との成立",
});
const PATRON_FUND_MAX_SUBSIDY_PER_SALE = 10;

const useMarketPreview = useOfflineMarketPreview;
const economyActionCallable = httpsCallable(functions, "economyAction");
const marketQueueCallable = httpsCallable(functions, "valueMarketQueue");
const marketActionCallable = httpsCallable(functions, "valueMarketAction");
const marketRankingsCallable = httpsCallable(functions, "valueMarketRankings");
const marketShopCallable = httpsCallable(functions, "valueMarketShop");
const appRoot = document.querySelector("#app");

let active = false;
let state = createState();
let lastRenderedScreen = "";
let lastRenderedMarketFocusKey = "";
let lifecycleGeneration = 0;

function createState() {
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    role: localStorage.getItem(MARKET_ROLE_KEY) === "buyer" ? "buyer" : "seller",
    authReady: false,
    balance: 0,
    patron: normalizeMarketPatron(null),
    patronFund: normalizePatronFund(null),
    patronImpact: normalizePatronImpact(null),
    patronEligibility: normalizeOshijoPatronEligibility(null),
    recommendations: [],
    recommendedShelf: [],
    recommendationBusySellerId: "",
    preferredRecommendedSellerId: "",
    marketPolicy: { ...DEFAULT_MARKET_POLICY },
    listingTitle: "",
    askingPrice: 50,
    pitchStyle: "either",
    maxBudget: 100,
    image: null,
    roomId: "",
    room: null,
    busy: false,
    queueJoinPending: false,
    queueHeartbeatPending: false,
    queueAttemptGeneration: 0,
    errorMessage: "",
    queueHeartbeat: null,
    roomHeartbeat: null,
    roomHeartbeatPending: false,
    roomSyncRetry: null,
    roomSyncPending: false,
    roomSyncWarningShown: false,
    roomSyncRetryAttempts: 0,
    activeUnsubscribe: null,
    walletUnsubscribe: null,
    roomUnsubscribe: null,
    realtimeUnsubscribers: [],
    realtimeRoomId: "",
    presenceConnections: [],
    enteringRoomId: "",
    peer: null,
    peerTimeout: null,
    channel: null,
    channelReady: false,
    peerStatus: "P2P接続を準備中…",
    pendingIce: [],
    imageSent: false,
    outgoingTransfer: Promise.resolve(),
    incomingTransfer: null,
    remoteImage: null,
    chatMessages: [],
    seenChatIds: new Set(),
    pitchSentTurns: new Set(),
    audioMessages: [],
    pendingActionKey: "",
    pendingActionId: "",
    rankings: {
      monthly: { sellers: [], buyers: [], label: "" },
      lifetime: { sellers: [], buyers: [], label: "" },
    },
    rankingPeriod: "monthly",
    rankingPeriodsLoaded: new Set(),
    rankingMonthlyAchievements: normalizeMarketMonthlyAchievements(null),
    rankingMonthlyAchievementsAvailable: false,
    rankingMeta: { monthlyStartKey: "", finalizedSeasonKey: "", rankingContributionCap: OSHIJO_RANKING_CAP },
    rankingsStatus: "idle",
    rankingReturnScreen: "setup",
    rankingProfile: { xHandle: "", tagline: "" },
    rankingProfileEligible: false,
    rankingProfileName: "",
    rankingProfileOpen: false,
    rankingProfileBusy: false,
    shop: normalizeMarketShop(null),
    shopCatalog: normalizeMarketShopCatalog(null),
    shopReport: normalizeSellerVerified(null),
    ownedTitleIds: [],
    ownedShopCharmIds: [...FREE_MARKET_SHOP_CHARM_IDS],
    favorites: [],
    shopBusy: false,
    shopStatus: "idle",
    shopErrorMessage: "",
    matchMode: "discover",
    selectedFavoriteSellerId: "",
    relationshipFeedback: createRelationshipFeedbackState(),
    certificates: [],
    certificateStatus: "idle",
    certificateHasMore: false,
    certificateReturnScreen: "setup",
    achievementNotificationRooms: new Set(),
    notifiedAchievementIds: new Set(),
    oshijoClaimOpen: false,
    oshijoClaimDraft: "",
    oshijoAudioMuted: false,
    oshijoClosingImages: [],
    oshijoShareChoice: "",
    oshijoDecisionRequested: false,
    restartGuide: normalizeMarketRestartGuide(null),
  };
}

function isCurrentLifecycle(generation) {
  return active && generation === lifecycleGeneration;
}

function beginQueueAttempt() {
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeat = null;
  state.queueHeartbeatPending = false;
  state.queueAttemptGeneration += 1;
  return state.queueAttemptGeneration;
}

function isCurrentQueueAttempt(generation, queueAttemptGeneration) {
  return isCurrentLifecycle(generation)
    && queueAttemptGeneration === state.queueAttemptGeneration;
}

function normalizeBuyerBudget() {
  if (state.role !== "buyer") return;
  const affordable = MARKET_PRICES.filter((price) => price + ENTRY_FEE <= state.balance);
  if (!affordable.length) {
    state.maxBudget = MARKET_PRICES[0];
    return;
  }
  if (!affordable.includes(Number(state.maxBudget))) state.maxBudget = affordable.at(-1);
}

function updateMarketBalance(value) {
  const balance = Number(value);
  if (!Number.isFinite(balance)) return;
  state.balance = Math.min(ANJU_PAY_MAX_BALANCE, Math.max(0, Math.floor(balance)));
  normalizeBuyerBudget();
}

function currentPatronSeasonKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function normalizeMarketPatron(value) {
  const seasonKey = String(value?.seasonKey || currentPatronSeasonKey());
  const current = seasonKey === currentPatronSeasonKey();
  const tier = current ? Math.max(0, Math.min(3, Math.floor(Number(value?.tier || 0)))) : 0;
  const definitions = [
    { id: "guest", label: "MARKET GUEST", icon: "◇" },
    { id: "supporter", label: "SUPPORTER", icon: "✦" },
    { id: "patron", label: "PATRON", icon: "◆" },
    { id: "grand_patron", label: "GRAND PATRON", icon: "♛" },
  ];
  return {
    seasonKey: currentPatronSeasonKey(),
    seasonSpent: current ? Math.max(0, Math.floor(Number(value?.seasonSpent || 0))) : 0,
    tier,
    ...definitions[tier],
  };
}

function normalizeMarketPolicy(value) {
  const successFeeBasisPoints = Math.max(0, Math.min(10_000, Math.floor(Number(
    value?.successFeeBasisPoints ?? DEFAULT_MARKET_POLICY.successFeeBasisPoints,
  ))));
  const minimumSuccessFee = Math.max(0, Math.min(500, Math.floor(Number(
    value?.minimumSuccessFee ?? DEFAULT_MARKET_POLICY.minimumSuccessFee,
  ))));
  return { successFeeBasisPoints, minimumSuccessFee };
}

function maximumPatronFundSubsidy(feeValue) {
  const fee = normalizeNonNegativeInteger(feeValue, 500);
  if (fee < 2) return 0;
  return Math.min(
    Math.floor(fee / 2),
    PATRON_FUND_MAX_SUBSIDY_PER_SALE,
    fee - 1,
  );
}

function marketSettlement(price, room = null) {
  const grossAmount = Math.max(0, Math.floor(Number(price || 0)));
  const quote = room?.settlementQuote;
  const quotedFee = Math.max(0, Number(quote?.feeAmount || 0));
  const quotedSubsidy = Math.min(
    maximumPatronFundSubsidy(quotedFee),
    normalizeNonNegativeInteger(
      room?.patronFundSubsidy ?? quote?.patronFundSubsidy,
      maximumPatronFundSubsidy(quotedFee),
    ),
  );
  if (Number(quote?.grossAmount) === grossAmount
      && Number.isInteger(Number(quote?.feeAmount))
      && Number.isInteger(Number(quote?.sellerProceeds))
      && Number(quote.feeAmount) >= 0
      && quotedSubsidy <= Number(quote.feeAmount)
      && Number(quote.sellerProceeds) + Number(quote.feeAmount) - quotedSubsidy === grossAmount) {
    return {
      grossAmount,
      feeAmount: Number(quote.feeAmount),
      patronFundSubsidy: quotedSubsidy,
      sellerProceeds: Number(quote.sellerProceeds),
    };
  }
  const policy = normalizeMarketPolicy(state.marketPolicy);
  const calculatedFee = grossAmount
    ? Math.max(
      policy.minimumSuccessFee,
      Math.ceil((grossAmount * policy.successFeeBasisPoints) / 10_000),
    )
    : 0;
  const serverFee = Number(room?.marketFee);
  const feeAmount = Number.isInteger(serverFee) && serverFee >= 0
    ? Math.min(grossAmount, serverFee)
    : calculatedFee;
  const patronFundSubsidy = Math.min(
    maximumPatronFundSubsidy(feeAmount),
    normalizeNonNegativeInteger(
      room?.patronFundSubsidy,
      maximumPatronFundSubsidy(feeAmount),
    ),
  );
  const serverSellerProceeds = Number(room?.sellerProceeds);
  const calculatedProceeds = Math.max(0, grossAmount - feeAmount + patronFundSubsidy);
  return {
    grossAmount,
    feeAmount,
    patronFundSubsidy,
    sellerProceeds: Number.isInteger(serverSellerProceeds)
      && serverSellerProceeds >= 0
      && serverSellerProceeds + feeAmount - patronFundSubsidy === grossAmount
      ? serverSellerProceeds
      : calculatedProceeds,
  };
}

function renderMarketFeeBreakdown(price, { id = "", room = null, compact = false } = {}) {
  const settlement = marketSettlement(price, room);
  return `<dl class="market-fee-breakdown ${compact ? "is-compact" : ""}" ${id ? `id="${id}" aria-live="polite"` : ""}>
    <div><dt>成約価格</dt><dd>${formatAnjuPay(settlement.grossAmount)}</dd></div>
    <div><dt>成約手数料（売り手負担）</dt><dd>−${formatAnjuPay(settlement.feeAmount)}</dd></div>
    ${settlement.patronFundSubsidy > 0 ? `<div><dt>パトロン基金補填</dt><dd>＋${formatAnjuPay(settlement.patronFundSubsidy)}</dd></div>` : ""}
    <div><dt>売り手受取</dt><dd>${formatAnjuPay(settlement.sellerProceeds)}</dd></div>
    <div><dt>買い手支払</dt><dd>${formatAnjuPay(settlement.grossAmount)}</dd></div>
  </dl>`;
}

function renderMarketPatronBadge(value, { compact = false } = {}) {
  const patron = normalizeMarketPatron(value);
  if (!patron.tier) return "";
  return `<span class="market-patron-badge tier-${patron.id} ${compact ? "is-compact" : ""}"><b aria-hidden="true">${patron.icon}</b>${escapeHtml(patron.label)}</span>`;
}

function renderPatronBackedBadge(value, { compact = false } = {}) {
  if (normalizeNonNegativeInteger(value) <= 0) return "";
  return `<span class="market-patron-badge tier-grand_patron ${compact ? "is-compact" : ""}"><b aria-hidden="true">◆</b>PATRON BACKED</span>`;
}

function renderOshijoPatronHonor(value, { compact = false } = {}) {
  const honor = normalizeOshijoPatronEligibility(value);
  if (!honor.eligible && !honor.badges.length) return "";
  const badges = honor.badges.map((badge) => {
    const source = badge && typeof badge === "object" ? badge : { label: badge };
    const label = normalizeShopText(
      source.label || source.title || source.name || source.id || "パトロン",
      40,
    );
    const level = normalizeNonNegativeInteger(source.level ?? source.tier ?? source.count, 999);
    return `<span class="market-oshijo-patron-honor-badge"><b aria-hidden="true">${escapeHtml(normalizeShopText(source.icon, 4) || "♛")}</b>${escapeHtml(label)}${level > 1 ? `<small>LV.${level}</small>` : ""}</span>`;
  }).join("");
  return `<div class="market-oshijo-patron-honor ${compact ? "is-compact" : ""}"><span>POPULAR OSHIJO / PATRON HONOR</span><strong>${escapeHtml(honor.label || "人気推し嬢")}</strong>${honor.detail ? `<p>${escapeHtml(honor.detail)}</p>` : ""}${badges ? `<div>${badges}</div>` : ""}</div>`;
}

function purchaseBalanceCopy(purchasePrice) {
  const after = Math.max(0, state.balance - Math.max(0, Number(purchasePrice || 0)));
  return `購入後のAnjuPay残高は${formatAnjuPay(after)}です。`;
}

function marketActionIdentity(action, roomId, turn, extra = {}) {
  const actionKey = JSON.stringify([roomId, action, turn, Object.entries(extra).sort(([left], [right]) => left.localeCompare(right))]);
  if (state.pendingActionKey !== actionKey || !state.pendingActionId) {
    state.pendingActionKey = actionKey;
    state.pendingActionId = crypto.randomUUID();
  }
  return { actionId: state.pendingActionId, actionKey };
}

function clearMarketActionIdentity(actionId) {
  if (state.pendingActionId !== actionId) return;
  state.pendingActionKey = "";
  state.pendingActionId = "";
}

function shared() {
  return window.HariaiApp?.shared;
}

function escapeHtml(value) {
  return shared()?.escapeHtml?.(value) || String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeMarketName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 16) || "PLAYER";
}

function normalizeMarketXHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function normalizeMarketTagline(value) {
  return String(value || "").trim();
}

function sanitizeMarketPublicProfile(value) {
  const xHandle = normalizeMarketXHandle(value?.xHandle);
  const tagline = normalizeMarketTagline(value?.tagline);
  return {
    xHandle: MARKET_X_HANDLE_PATTERN.test(xHandle) ? xHandle : "",
    tagline: tagline.length >= 1
      && tagline.length <= MARKET_TAGLINE_MAX_LENGTH
      && !/[\u0000-\u001f\u007f\r\n]/.test(tagline)
      ? tagline
      : "",
  };
}

function normalizeShopText(value, maximum) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f\r\n]+/g, " ").replace(/\s+/g, " ").slice(0, maximum);
}

function normalizeNonNegativeInteger(value, maximum = 999_999_999) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function normalizePatronFundPolicy(value) {
  const policy = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PATRON_FUND_POLICY_LABELS, policy) ? policy : "";
}

function normalizePatronFundKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PATRON_FUND_KIND_LABELS, kind) ? kind : "";
}

function normalizePatronFund(value) {
  const source = value && typeof value === "object" ? value : {};
  const contributed = normalizeNonNegativeInteger(source.contributed);
  const budget = Math.min(contributed || 999_999_999, normalizeNonNegativeInteger(source.budget));
  const subsidyPaid = Math.min(budget, normalizeNonNegativeInteger(source.subsidyPaid));
  const remaining = Math.min(
    budget,
    normalizeNonNegativeInteger(
      source.remaining === undefined ? Math.max(0, budget - subsidyPaid) : source.remaining,
    ),
  );
  const votesSource = source.votes && typeof source.votes === "object" ? source.votes : {};
  return {
    seasonKey: normalizeShopText(source.seasonKey, 16),
    contributed,
    burned: normalizeNonNegativeInteger(source.burned),
    budget,
    subsidyPaid,
    remaining,
    supportedDeals: normalizeNonNegativeInteger(source.supportedDeals, 100_000),
    activePolicy: normalizePatronFundPolicy(source.activePolicy),
    votes: Object.fromEntries(Object.keys(PATRON_FUND_POLICY_LABELS).map((policy) => (
      [policy, normalizeNonNegativeInteger(votesSource[policy], 100_000)]
    ))),
    viewerVote: normalizePatronFundPolicy(source.viewerVote) || null,
  };
}

function normalizePatronImpact(value) {
  const source = value && typeof value === "object" ? value : {};
  const recommendationLimit = normalizeNonNegativeInteger(source.recommendationLimit, 100);
  return {
    recommendationLimit,
    recommendedShopCount: Math.min(
      recommendationLimit || 100,
      normalizeNonNegativeInteger(source.recommendedShopCount, 100),
    ),
  };
}

function normalizeShopOptionId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(id) ? id : "";
}

function normalizeCatalogOptions(value, fallback) {
  const source = Array.isArray(value)
    ? value.map((item) => [String(item?.id || item?.value || item || ""), item])
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  const seen = new Set();
  const options = [];
  for (const [key, rawValue] of source) {
    const id = normalizeShopOptionId(rawValue?.id || rawValue?.value || key);
    if (!id || seen.has(id)) continue;
    const label = normalizeShopText(
      typeof rawValue === "string" && rawValue !== id
        ? rawValue
        : rawValue?.label || rawValue?.name || rawValue?.title || id,
      40,
    );
    const icon = normalizeShopText(rawValue?.icon, 4);
    seen.add(id);
    options.push({ id, label: label || id, ...(icon ? { icon } : {}) });
  }
  return options.length ? options : fallback.map((option) => ({ ...option }));
}

function normalizeMarketShopCatalog(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    specialtyTags: normalizeCatalogOptions(
      source.specialtyTags || source.specialties || source.tags,
      MARKET_SHOP_FALLBACK_CATALOG.specialtyTags,
    ),
    serviceStyles: normalizeCatalogOptions(
      source.serviceStyles || source.styles,
      MARKET_SHOP_FALLBACK_CATALOG.serviceStyles,
    ),
    themes: normalizeCatalogOptions(
      source.themes || source.themeIds,
      MARKET_SHOP_FALLBACK_CATALOG.themes,
    ),
    seals: normalizeCatalogOptions(
      source.seals || source.sealIds,
      MARKET_SHOP_FALLBACK_CATALOG.seals,
    ),
    impressionTags: normalizeCatalogOptions(
      source.impressionTags || source.feedbackTags || source.impressions,
      MARKET_SHOP_FALLBACK_CATALOG.impressionTags,
    ),
  };
}

function normalizeShopIdList(value, maximum = 100) {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).filter(([, enabled]) => enabled === true).map(([id]) => id)
      : [];
  return [...new Set(candidates.map(normalizeShopOptionId).filter(Boolean))].slice(0, maximum);
}

function normalizeOwnedTitleIds(value) {
  return normalizeShopIdList(value).filter((titleId) => Boolean(getPlayerTitleProduct(titleId)));
}

function normalizeOwnedShopCharmIds(value) {
  return normalizeShopIdList(value).filter((stampId) => Boolean(getStamp(stampId)));
}

function normalizeSellerImpressions(value) {
  const source = value && typeof value === "object" ? value : {};
  const impressions = {};
  for (const [rawId, rawCount] of Object.entries(source)) {
    const id = normalizeShopOptionId(rawId);
    const count = Math.max(0, Math.floor(Number(rawCount || 0)));
    if (id && count) impressions[id] = count;
  }
  return impressions;
}

function normalizeSellerVerified(value) {
  const source = value?.verified && typeof value.verified === "object"
    ? value.verified
    : value?.report && typeof value.report === "object"
      ? value.report
      : (value || {});
  return {
    salesCount: Math.max(0, Math.floor(Number(source.salesCount || source.issueCount || source.sales || 0))),
    bestSale: Math.max(0, Math.floor(Number(source.bestSale || source.highestSale || 0))),
    marketDays: Math.max(0, Math.floor(Number(source.marketDays || source.days || 0))),
    uniqueCounterparties: Math.max(0, Math.floor(Number(
      source.uniqueCounterparties || source.uniqueBuyerCount || source.customers || 0,
    ))),
    repeatBuyerCount: Math.max(0, Math.floor(Number(source.repeatBuyerCount || source.repeatBuyers || 0))),
    favoriteCount: Math.max(0, Math.floor(Number(source.favoriteCount || source.favorites || 0))),
    impressions: normalizeSellerImpressions(source.impressions || source.impressionCounts),
    impressionsCollecting: source.impressionsCollecting === true,
  };
}

function normalizeSellerRelationship(value) {
  const source = value && typeof value === "object" ? value : {};
  const previousPurchases = Math.max(0, Math.floor(Number(
    source.previousPurchases || source.purchaseCount || source.purchases || 0,
  )));
  return {
    previousPurchases,
    isFavorite: source.isFavorite === true || source.favorite === true,
    metBefore: source.metBefore === true || source.previouslyPurchased === true || previousPurchases > 0,
    lastPurchasePrice: Math.max(0, Math.floor(Number(
      source.lastPurchasePrice || source.lastPrice || source.previousPrice || 0,
    ))),
  };
}

function normalizeMarketShop(value) {
  const source = value?.sellerShop && typeof value.sellerShop === "object"
    ? value.sellerShop
    : value && typeof value === "object"
      ? value
      : {};
  return {
    publicSellerId: normalizeShopText(source.publicSellerId || source.sellerPublicId, 96),
    shopName: normalizeShopText(source.shopName || source.name, MARKET_SHOP_NAME_MAX_LENGTH),
    tagline: normalizeShopText(
      source.tagline || source.philosophy || source.shopTagline,
      MARKET_SHOP_TAGLINE_MAX_LENGTH,
    ),
    specialtyTags: normalizeShopIdList(source.specialtyTags || source.specialties || source.tags, MARKET_SHOP_MAX_SPECIALTY_TAGS),
    serviceStyles: normalizeShopIdList(source.serviceStyles || source.styles, MARKET_SHOP_MAX_SERVICE_STYLES),
    themeId: normalizeShopOptionId(source.themeId || source.theme) || "standard",
    sealId: normalizeShopOptionId(source.sealId || source.seal) || "heart",
    titleId: normalizeShopOptionId(source.titleId),
    shopCharmId: normalizeShopOptionId(source.shopCharmId || source.charmId),
    repeatWelcome: source.repeatWelcome === true,
    verified: normalizeSellerVerified(source.verified || source.report || source),
    relationship: normalizeSellerRelationship(source.relationship || source.viewerRelationship),
  };
}
function marketShopSupportsOshijo(value) {
  return normalizeMarketShop(value).serviceStyles.includes(OSHIJO_SERVICE_STYLE_ID);
}

function isOshijoClosing(room) {
  return String(room?.closingMode || "") === OSHIJO_CLOSING_MODE;
}

function normalizeMarketRankingPeriod(value) {
  const period = String(value || "").trim().toLowerCase();
  return MARKET_RANKING_PERIODS.includes(period) ? period : "monthly";
}

function normalizeOshijoPhase(room) {
  if (!isOshijoClosing(room)) return "";
  const explicit = String(
    room?.oshijoPhase
      || room?.closingPhase
      || room?.decisionPhase
      || "",
  ).trim().toLowerCase();
  if (["warning", "claim", "offer", "oshijo_warning"].includes(explicit)) return "warning";
  if (["closing", "hearing", "negotiation", "oshijo_closing"].includes(explicit)) return "closing";
  if (["silent", "final", "decision", "silent_decision"].includes(explicit)) return "final";
  const status = String(room?.status || "").trim().toLowerCase();
  if (["oshijo_warning", "oshijo_offer", "closing_warning"].includes(status)) return "warning";
  if (["oshijo_closing", "closing_round", "oshijo_hearing"].includes(status)) return "closing";
  if (status === "decision") return "final";
  if (TERMINAL_STATES.has(status)) return "result";
  return "";
}

function normalizeOshijoDeal(room = state.room) {
  const source = room && typeof room === "object" ? room : {};
  const fallbackClaim = isOshijoClosing(source) ? source.listing?.askingPrice : 0;
  const claimAmount = Math.max(1, normalizeNonNegativeInteger(
    source.claimAmount
      ?? source.oshijoClaimAmount
      ?? source.closingClaimAmount
      ?? source.requestedAmount
      ?? fallbackClaim,
    OSHIJO_MAX_CLAIM_AMOUNT,
  ));
  const paidAmountValue = source.paidAmount
    ?? source.actualPaidAmount
    ?? source.actualPayment
    ?? source.salePrice;
  const paidAmount = Number.isFinite(Number(paidAmountValue))
    ? normalizeNonNegativeInteger(paidAmountValue, OSHIJO_MAX_CLAIM_AMOUNT)
    : Math.min(claimAmount, normalizeNonNegativeInteger(state.balance, OSHIJO_MAX_CLAIM_AMOUNT));
  const rankingContribution = Math.min(
    OSHIJO_RANKING_CAP,
    normalizeNonNegativeInteger(
      source.rankingContribution
        ?? source.rankingAmount
        ?? source.rankingPay
        ?? Math.min(paidAmount, OSHIJO_RANKING_CAP),
      OSHIJO_RANKING_CAP,
    ),
  );
  const closingTurns = Array.isArray(source.closingTurns)
    ? source.closingTurns.length
    : source.closingTurns && typeof source.closingTurns === "object"
      ? Object.keys(source.closingTurns).length
      : 0;
  const closingTurnsUsed = Math.min(
    OSHIJO_MAX_CLOSING_TURNS,
    normalizeNonNegativeInteger(
      source.closingTurnsUsed
        ?? source.closingTurnCount
        ?? source.oshijoClosingTurnCount
        ?? source.oshijoClosingTurns
        ?? closingTurns,
      OSHIJO_MAX_CLOSING_TURNS,
    ),
  );
  const allIn = source.allIn === true
    || source.isAllIn === true
    || paidAmount < claimAmount;
  return {
    claimAmount,
    paidAmount,
    rankingContribution,
    closingTurnsUsed,
    allIn,
  };
}

function isOshijoClosingMessage(message) {
  return String(message?.phase || message?.marketPhase || "").toLowerCase() === "oshijo_closing"
    || String(message?.name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX);
}

function normalizeMarketRankingEntry(value) {
  const source = value && typeof value === "object" ? value : {};
  const showcase = Array.isArray(source.achievementShowcase)
    ? source.achievementShowcase
    : Array.isArray(source.monthlyAchievements)
      ? source.monthlyAchievements
      : Array.isArray(source.badges)
        ? source.badges
        : [];
  const monthlyBadges = Array.isArray(source.monthlyAchievements)
    ? source.monthlyAchievements
    : Array.isArray(source.monthlyBadges)
      ? source.monthlyBadges
      : Array.isArray(source.badges)
        ? source.badges
        : [];
  return {
    ...source,
    name: normalizeMarketName(source.name || source.displayName),
    primary: normalizeNonNegativeInteger(
      source.primary
        ?? source.rankingContribution
        ?? source.rankingAmount
        ?? source.total
        ?? source.sales
        ?? source.spent,
    ),
    count: normalizeNonNegativeInteger(source.count ?? source.dealCount ?? source.salesCount ?? source.purchaseCount, 100_000),
    best: normalizeNonNegativeInteger(source.best ?? source.bestSale ?? source.highestAmount),
    uniqueCounterparties: normalizeNonNegativeInteger(
      source.uniqueCounterparties ?? source.uniqueBuyerCount ?? source.uniqueSellerCount,
      100_000,
    ),
    achievementShowcase: showcase,
    monthlyAchievements: monthlyBadges,
  };
}

function normalizeMarketRankingSet(value, fallback = null) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
  const sellers = Array.isArray(source.sellers)
    ? source.sellers
    : Array.isArray(fallbackSource.sellers)
      ? fallbackSource.sellers
      : [];
  const buyers = Array.isArray(source.buyers)
    ? source.buyers
    : Array.isArray(fallbackSource.buyers)
      ? fallbackSource.buyers
      : [];
  return {
    sellers: sellers.map(normalizeMarketRankingEntry),
    buyers: buyers.map(normalizeMarketRankingEntry),
    label: normalizeShopText(
      source.label || source.periodLabel || source.monthLabel || fallbackSource.label,
      40,
    ),
  };
}

function normalizeMarketRankingPayload(value) {
  const data = value && typeof value === "object" ? value : {};
  const root = data.rankings && typeof data.rankings === "object" ? data.rankings : data;
  const periods = root.periods && typeof root.periods === "object" ? root.periods : root;
  const requestedPeriod = normalizeMarketRankingPeriod(data.period || root.period);
  const flat = {
    sellers: Array.isArray(root.sellers) ? root.sellers : [],
    buyers: Array.isArray(root.buyers) ? root.buyers : [],
    label: root.label || root.periodLabel || "",
  };
  const selectedFlat = flat.sellers.length || flat.buyers.length ? flat : null;
  const monthlySource = periods.monthly
    || periods.currentMonth
    || data.monthly
    || (requestedPeriod === "monthly" ? selectedFlat : null);
  const lifetimeSource = periods.lifetime
    || periods.allTime
    || data.lifetime
    || data.allTime
    || (requestedPeriod === "lifetime" ? selectedFlat : null);
  return {
    monthly: normalizeMarketRankingSet(monthlySource, selectedFlat || lifetimeSource),
    lifetime: normalizeMarketRankingSet(lifetimeSource, selectedFlat || monthlySource),
  };
}

function normalizeMarketMonthlyAchievements(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizeRole = (role) => {
    const entry = source[role] && typeof source[role] === "object" ? source[role] : {};
    return {
      months: normalizeNonNegativeInteger(entry.months, 999),
      top3Months: normalizeNonNegativeInteger(entry.top3Months, 999),
      championMonths: normalizeNonNegativeInteger(entry.championMonths, 999),
      level: normalizeNonNegativeInteger(entry.level, 99),
      latestSeasonKey: /^\d{4}-\d{2}$/.test(String(entry.latestSeasonKey || ""))
        ? String(entry.latestSeasonKey)
        : "",
      latestAwardId: ["champion", "top3", "top10"].includes(String(entry.latestAwardId || ""))
        ? String(entry.latestAwardId)
        : "",
      latestRank: normalizeNonNegativeInteger(entry.latestRank, 10_000),
    };
  };
  const levelMonths = (Array.isArray(source.levelMonths) ? source.levelMonths : [1, 3, 6, 12])
    .map((month) => normalizeNonNegativeInteger(month, 999))
    .filter((month, index, values) => month > 0 && values.indexOf(month) === index)
    .sort((left, right) => left - right);
  return {
    seller: normalizeRole("seller"),
    buyer: normalizeRole("buyer"),
    levelMonths: levelMonths.length ? levelMonths : [1, 3, 6, 12],
  };
}

function normalizeMarketRestartGuide(value) {
  const source = value && typeof value === "object" ? value : {};
  const buyerMinimumBalance = Math.max(
    1,
    normalizeNonNegativeInteger(
      source.buyerMinimumBalance
        ?? source.buyerEntryTarget
        ?? source.marketBuyerMinimum
        ?? 15,
      10_000,
    ),
  );
  return {
    buyerMinimumBalance,
    remainingPay: normalizeNonNegativeInteger(
      source.remainingPay ?? source.payToBuyerReturn ?? source.shortage,
      10_000,
    ),
    rewardLabel: normalizeShopText(
      source.rewardLabel || source.nextRewardLabel || source.availableRewardLabel,
      60,
    ),
    rewardAmount: normalizeNonNegativeInteger(
      source.rewardAmount ?? source.nextRewardAmount ?? source.availableRewardAmount,
      10_000,
    ),
    matchesUntilReward: normalizeNonNegativeInteger(
      source.matchesUntilReward ?? source.matchesRemaining ?? source.battlesRemaining,
      100,
    ),
    rewardAvailable: source.rewardAvailable === true || source.available === true,
  };
}

function normalizeOshijoPatronEligibility(value) {
  const source = value && typeof value === "object" ? value : {};
  const badges = Array.isArray(source.badges)
    ? source.badges
    : Array.isArray(source.achievements)
      ? source.achievements
      : [];
  const salesCount = normalizeNonNegativeInteger(source.salesCount, 100_000);
  const uniqueBuyers = normalizeNonNegativeInteger(source.uniqueBuyers ?? source.uniqueBuyerCount, 100_000);
  const minimumSales = normalizeNonNegativeInteger(source.minimumSales, 100_000);
  const minimumUniqueBuyers = normalizeNonNegativeInteger(source.minimumUniqueBuyers, 100_000);
  const progressDetail = minimumSales || minimumUniqueBuyers
    ? `月間成立 ${salesCount}/${minimumSales || "―"}・異なる買い手 ${uniqueBuyers}/${minimumUniqueBuyers || "―"}`
    : "";
  return {
    eligible: source.eligible === true
      || source.popular === true
      || source.popularSeller === true
      || source.isEligible === true,
    label: normalizeShopText(source.label || source.title || "人気推し嬢", 40),
    detail: normalizeShopText(source.detail || source.reason || source.message || progressDetail, 120),
    badges,
  };
}

function normalizeMarketFavorite(value, fallbackId = "") {
  const source = value && typeof value === "object" ? value : {};
  const shop = normalizeMarketShop(source.shop || source.sellerShop || source);
  const publicSellerId = normalizeShopText(
    source.publicSellerId || source.sellerPublicId || shop.publicSellerId || fallbackId,
    96,
  );
  if (!publicSellerId) return null;
  const lastPurchasePrice = Math.max(0, Math.floor(Number(
    source.lastPurchasePrice
      || source.lastPrice
      || source.previousPrice
      || source.relationship?.lastPurchasePrice
      || shop.relationship.lastPurchasePrice
      || 0,
  )));
  return {
    ...shop,
    publicSellerId,
    lastPurchasePrice,
    favoritedAt: Math.max(0, Number(source.favoritedAt || source.updatedAt || 0)),
  };
}

function normalizeMarketFavorites(value) {
  const source = Array.isArray(value)
    ? value.map((favorite) => ["", favorite])
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  const favorites = [];
  const seen = new Set();
  for (const [fallbackId, rawFavorite] of source) {
    const favorite = normalizeMarketFavorite(rawFavorite, fallbackId);
    if (!favorite || seen.has(favorite.publicSellerId)) continue;
    seen.add(favorite.publicSellerId);
    favorites.push(favorite);
  }
  return favorites.sort((first, second) => second.favoritedAt - first.favoritedAt);
}

function normalizeMarketRecommendation(value, fallbackId = "") {
  const source = value && typeof value === "object" ? value : {};
  const unavailable = source.unavailable === true;
  const shop = unavailable
    ? null
    : normalizeMarketShop(source.shop || source.sellerShop || source);
  const publicSellerId = normalizeShopText(
    source.publicSellerId || source.sellerPublicId || shop?.publicSellerId || fallbackId,
    96,
  );
  if (!publicSellerId) return null;
  return {
    publicSellerId,
    shop: shop ? { ...shop, publicSellerId } : null,
    unavailable,
    recommendedAt: normalizeNonNegativeInteger(source.recommendedAt || source.updatedAt),
  };
}

function normalizeMarketRecommendations(value) {
  const source = Array.isArray(value)
    ? value.map((recommendation) => ["", recommendation])
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  const seen = new Set();
  const recommendations = [];
  for (const [fallbackId, rawRecommendation] of source) {
    const recommendation = normalizeMarketRecommendation(rawRecommendation, fallbackId);
    if (!recommendation || seen.has(recommendation.publicSellerId)) continue;
    seen.add(recommendation.publicSellerId);
    recommendations.push(recommendation);
  }
  return recommendations.sort((first, second) => second.recommendedAt - first.recommendedAt);
}

function normalizeRecommendedShelf(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const shops = [];
  for (const rawShop of source) {
    const shop = normalizeMarketShop(rawShop);
    if (!shop.publicSellerId || seen.has(shop.publicSellerId)) continue;
    seen.add(shop.publicSellerId);
    shops.push(shop);
  }
  return shops.slice(0, 30);
}

function applyMarketPatronExperience(value) {
  const data = value && typeof value === "object" ? value : {};
  if (Object.prototype.hasOwnProperty.call(data, "patronFund")) {
    state.patronFund = normalizePatronFund(data.patronFund);
  }
  if (Object.prototype.hasOwnProperty.call(data, "patronImpact")) {
    state.patronImpact = normalizePatronImpact(data.patronImpact);
  }
  if (Object.prototype.hasOwnProperty.call(data, "recommendations")) {
    state.recommendations = normalizeMarketRecommendations(data.recommendations);
  }
  if (Object.prototype.hasOwnProperty.call(data, "recommendedShelf")) {
    state.recommendedShelf = normalizeRecommendedShelf(data.recommendedShelf);
  }
  const eligibility = data.oshijoPatronEligibility
    || data.oshijoPatron
    || data.patronEligibility
    || data.sellerPatronEligibility;
  if (eligibility) state.patronEligibility = normalizeOshijoPatronEligibility(eligibility);
  const restartGuide = data.restartGuide || data.reentryGuide || data.marketRestartGuide;
  if (restartGuide) state.restartGuide = normalizeMarketRestartGuide(restartGuide);
}

function normalizeMarketRoom(value) {
  const room = value && typeof value === "object" ? { ...value } : {};
  const price = normalizeNonNegativeInteger(room.salePrice || room.listing?.askingPrice, 999_999);
  const fee = Math.min(price, normalizeNonNegativeInteger(
    room.marketFee ?? room.settlementQuote?.feeAmount,
    price,
  ));
  room.patronFundSubsidy = Math.min(
    maximumPatronFundSubsidy(fee),
    normalizeNonNegativeInteger(
      room.patronFundSubsidy ?? room.settlementQuote?.patronFundSubsidy,
      maximumPatronFundSubsidy(fee),
    ),
  );
  room.patronFundPolicy = normalizePatronFundPolicy(room.patronFundPolicy);
  room.patronFundKind = normalizePatronFundKind(room.patronFundKind);
  if (room.settlementQuote && typeof room.settlementQuote === "object") {
    room.settlementQuote = {
      ...room.settlementQuote,
      patronFundSubsidy: room.patronFundSubsidy,
    };
  }
  const restartGuide = room.restartGuide || room.reentryGuide || room.marketRestartGuide;
  if (restartGuide) room.restartGuide = normalizeMarketRestartGuide(restartGuide);
  const eligibility = room.oshijoPatronEligibility
    || room.oshijoPatron
    || room.patronEligibility
    || room.sellerPatronEligibility;
  if (eligibility) room.oshijoPatronEligibility = normalizeOshijoPatronEligibility(eligibility);
  return room;
}

function createRelationshipFeedbackState(roomId = "", favorite = false) {
  return {
    roomId: String(roomId || ""),
    impressionTag: "",
    alreadyRecorded: false,
    favorite: favorite === true,
    favoritePersisted: favorite === true,
    favoriteBeforeBlock: false,
    submitted: false,
    blocked: false,
    busy: false,
  };
}

function marketShopSample() {
  return normalizeMarketShop({
    publicSellerId: "preview-owner-shop",
    shopName: "ときめき発見商店",
    tagline: "まだ言葉にならない推しの魅力まで、丁寧に届けます。",
    specialtyTags: ["animals", "illustration", "story"],
    serviceStyles: ["story", "oshijo"],
    themeId: "sakura",
    sealId: "ribbon",
    titleId: "title_oshi_concierge",
    shopCharmId: "stamp_cute",
    repeatWelcome: true,
    verified: {
      salesCount: 12,
      bestSale: 300,
      marketDays: 8,
      uniqueCounterparties: 9,
      repeatBuyerCount: 3,
      impressions: { kind: 7, insightful: 5, want_more: 4 },
    },
  });
}

function previewMarketFavorites() {
  return normalizeMarketFavorites([
    {
      publicSellerId: "preview-favorite-one",
      shopName: "月あかり写真店",
      tagline: "夜の色と静かな物語を選んでいます。",
      specialtyTags: ["night", "landscape"],
      serviceStyles: ["concise", "audio"],
      themeId: "midnight",
      sealId: "moon",
      titleId: "title_night_view_collector",
      shopCharmId: "stamp_best_shot",
      repeatWelcome: true,
      lastPurchasePrice: 300,
      favoritedAt: Date.now() - 10_000,
      verified: { salesCount: 21, bestSale: 500, repeatBuyerCount: 6 },
    },
    {
      publicSellerId: "preview-favorite-two",
      shopName: "ふわもこ推し便",
      tagline: "どうぶつのかわいさを全力でお届け。",
      specialtyTags: ["animals", "humor"],
      serviceStyles: ["intuition", "careful"],
      themeId: "mint",
      sealId: "cat",
      titleId: "title_animal_lover",
      shopCharmId: "stamp_like",
      repeatWelcome: false,
      lastPurchasePrice: 100,
      favoritedAt: Date.now() - 20_000,
      verified: { salesCount: 7, bestSale: 200, repeatBuyerCount: 1 },
    },
  ]);
}

function applyMarketShopResponse(value) {
  const data = value && typeof value === "object" ? value : {};
  applyMarketPatronExperience(data);
  state.shopCatalog = normalizeMarketShopCatalog(data.catalog || state.shopCatalog);
  state.shop = normalizeMarketShop(data.shop || state.shop);
  state.shopReport = normalizeSellerVerified(data.report || state.shop.verified);
  state.ownedTitleIds = normalizeOwnedTitleIds(data.ownedTitleIds || data.ownedTitles);
  state.ownedShopCharmIds = normalizeOwnedShopCharmIds(
    [
      ...FREE_MARKET_SHOP_CHARM_IDS,
      ...normalizeShopIdList(data.ownedShopCharmIds || data.ownedCharmIds),
    ],
  );
  state.favorites = normalizeMarketFavorites(data.favorites);
  reconcileSelectedFavoriteSeller();
  if (state.room && !state.relationshipFeedback.submitted) {
    const sellerId = normalizeMarketShop(state.room.sellerShop).publicSellerId;
    if (sellerId) {
      const favorite = Boolean(favoriteForSeller(sellerId));
      state.relationshipFeedback.favorite = favorite;
      state.relationshipFeedback.favoritePersisted = favorite;
    }
  }
  state.shopStatus = "ready";
  state.shopErrorMessage = "";
}

function favoriteForSeller(publicSellerId) {
  const id = String(publicSellerId || "");
  return id ? state.favorites.find((favorite) => favorite.publicSellerId === id) || null : null;
}

function matchableMarketFavorite(publicSellerId, favorites = state.favorites) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  return sellerId
    ? favorites.find((favorite) => favorite.publicSellerId === sellerId && favorite.repeatWelcome === true) || null
    : null;
}

function fallbackMarketFavorite(favorites = state.favorites) {
  return favorites.find((favorite) => favorite.repeatWelcome === true) || null;
}

function marketFavoritePreviousPrice(favorite) {
  return Math.max(0, Math.floor(Number(
    favorite?.lastPurchasePrice || favorite?.relationship?.lastPurchasePrice || 0,
  )));
}

function marketFavoriteRequiredBudget(favorite) {
  const previousPrice = marketFavoritePreviousPrice(favorite);
  if (!previousPrice) return 0;
  return MARKET_PRICES.find((price) => price >= previousPrice) || 0;
}

function alignBudgetToMarketFavorite(favorite, { announce = false } = {}) {
  const previousPrice = marketFavoritePreviousPrice(favorite);
  const requiredBudget = marketFavoriteRequiredBudget(favorite);
  if (!previousPrice || !requiredBudget) {
    return { ok: true, previousPrice, requiredBudget: 0, shortage: 0, adjusted: false };
  }
  const shortage = Math.max(0, previousPrice + ENTRY_FEE - state.balance);
  if (shortage) {
    return { ok: false, previousPrice, requiredBudget, shortage, adjusted: false };
  }
  const adjusted = Number(state.maxBudget) < requiredBudget;
  if (adjusted) {
    state.maxBudget = requiredBudget;
    if (announce) {
      showToast(`前回価格に合わせて購入上限を${formatAnjuPay(requiredBudget)}へ調整しました。`);
    }
  }
  return { ok: true, previousPrice, requiredBudget, shortage: 0, adjusted };
}

function reconcileSelectedFavoriteSeller() {
  const selected = matchableMarketFavorite(state.selectedFavoriteSellerId);
  if (selected) return selected;
  state.selectedFavoriteSellerId = "";
  if (state.matchMode === "favorites") state.matchMode = "discover";
  return null;
}

function ensureRelationshipFeedback(room = state.room) {
  const roomId = String(room?.roomId || state.roomId || "");
  if (!roomId || state.relationshipFeedback.roomId === roomId) return;
  const shop = normalizeMarketShop(room?.sellerShop);
  state.relationshipFeedback = createRelationshipFeedbackState(
    roomId,
    Boolean(favoriteForSeller(shop.publicSellerId)) || shop.relationship.isFavorite,
  );
}

function showToast(message) {
  shared()?.showToast?.(message);
}

function notifyMarketAchievementUnlocks(idsValue) {
  const ids = (window.HariaiAchievements?.normalizeIds?.(idsValue) || [])
    .filter((id) => !state.notifiedAchievementIds.has(id));
  if (!ids.length) return;
  ids.forEach((id) => state.notifiedAchievementIds.add(id));
  window.dispatchEvent(new CustomEvent("hariai-achievements-unlocked", { detail: { ids } }));
  economyActionCallable({ action: "ack_achievements", achievementIds: ids }).catch(() => {
    ids.forEach((id) => state.notifiedAchievementIds.delete(id));
  });
}

async function refreshMarketAchievementNotifications(roomId) {
  if (!roomId || state.achievementNotificationRooms.has(roomId)) return;
  state.achievementNotificationRooms.add(roomId);
  try {
    const response = await economyActionCallable({ action: "get_achievements", syncPublic: true });
    notifyMarketAchievementUnlocks(response.data?.pendingUnlocks);
  } catch {
    state.achievementNotificationRooms.delete(roomId);
  }
}

function callableMessage(error, fallback) {
  const message = String(error?.message || "");
  const detail = message.includes(":") ? message.slice(message.lastIndexOf(":") + 1).trim() : message;
  return (detail || fallback)
    .replace(/(\d[\d,]*)\s*PT\b/g, `$1 ${ANJU_PAY_UNIT}`)
    .replaceAll("ポイント残高", "AnjuPay残高")
    .replaceAll("所持ポイント", "AnjuPay残高")
    .replaceAll("ポイントが不足", "AnjuPay残高が不足")
    .replaceAll("ポイント不足", "AnjuPay残高不足");
}

function setMarketChrome(status = "VALUE MARKET") {
  const statusBadge = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (statusBadge) statusBadge.innerHTML = `<i></i> ${escapeHtml(status)}`;
  if (privacy) privacy.textContent = "画像・音声保存なし";
  if (footerItems[0]) footerItems[0].textContent = "VALUE MARKET / CLOUD FUNCTIONS + FIRESTORE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "取引だけを記録し、画像と音声はP2Pで一時転送します";
}

function isActive() {
  return active;
}

async function start({ initialScreen = "setup" } = {}) {
  if (active) return;
  if (location.protocol === "file:") {
    showToast("VALUE MARKETはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiOnline?.isActive?.() || window.HariaiStrategy?.isActive?.()
      || window.HariaiTeam?.isActive?.() || window.HariaiRoyale?.isActive?.()) {
    showToast("ほかのモードを終了してからVALUE MARKETを開始してください。");
    return;
  }
  active = true;
  const generation = ++lifecycleGeneration;
  state = createState();
  const openLandingRankings = initialScreen === "rankings";
  if (openLandingRankings) {
    state.screen = "rankings";
    state.rankingReturnScreen = "landing";
    state.rankingsStatus = "loading";
  }
  lastRenderedScreen = "";
  setMarketChrome("CONNECTING");
  render();
  ensureAuthenticated(generation, { openLandingRankings })
    .catch((error) => handleFatalError(error, generation));
}

function openRankingsFromLanding() {
  return start({ initialScreen: "rankings" });
}

async function ensureAuthenticated(generation, { openLandingRankings = false } = {}) {
  if (useMarketPreview) {
    state.uid = "local-preview-user";
    updateMarketBalance(500);
    state.patron = normalizeMarketPatron({ seasonKey: currentPatronSeasonKey(), seasonSpent: 300, tier: 1 });
    state.shop = marketShopSample();
    state.shopCatalog = normalizeMarketShopCatalog(null);
    state.shopReport = normalizeSellerVerified(state.shop.verified);
    state.ownedTitleIds = normalizeOwnedTitleIds([
      "title_oshi_concierge",
      "title_good_praiser",
      "title_animal_lover",
      "title_night_view_collector",
      "title_image_sommelier",
    ]);
    state.ownedShopCharmIds = normalizeOwnedShopCharmIds([
      "stamp_like",
      "stamp_cute",
      "stamp_surprise",
      "stamp_thanks",
      "stamp_best_shot",
      "stamp_god_photo",
    ]);
    state.favorites = previewMarketFavorites();
    state.patronFund = normalizePatronFund({
      seasonKey: currentPatronSeasonKey(),
      contributed: 1_200,
      burned: 4_800,
      budget: 1_200,
      subsidyPaid: 175,
      remaining: 1_025,
      supportedDeals: 24,
      activePolicy: "balanced",
      votes: { balanced: 12, discovery: 8, trust: 10 },
      viewerVote: "balanced",
    });
    state.patronImpact = normalizePatronImpact({ recommendationLimit: 1, recommendedShopCount: 1 });
    state.recommendations = normalizeMarketRecommendations([{
      publicSellerId: state.favorites[0]?.publicSellerId,
      shop: state.favorites[0],
      recommendedAt: Date.now() - 5_000,
    }]);
    state.recommendedShelf = normalizeRecommendedShelf([
      state.favorites[0],
      marketShopSample(),
    ]);
    state.shopStatus = "ready";
    state.shopErrorMessage = "";
    state.authReady = true;
    setMarketChrome("VALUE MARKET PREVIEW");
    if (openLandingRankings) {
      await openRankings("landing");
      return;
    }
    render();
    return;
  }
  await setPersistence(auth, browserLocalPersistence);
  if (!isCurrentLifecycle(generation)) return;
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!isCurrentLifecycle(generation)) return;
  state.uid = credential.user.uid;
  const response = await economyActionCallable({ action: "initialize" });
  if (!isCurrentLifecycle(generation)) return;
  updateMarketBalance(response.data?.balance || 0);
  state.patron = normalizeMarketPatron(response.data?.patron);
  applyMarketPatronExperience(response.data);
  state.marketPolicy = normalizeMarketPolicy(response.data?.marketPolicy);
  state.authReady = true;
  subscribeToActiveRoom(generation);
  subscribeToWallet(generation);
  setMarketChrome("VALUE MARKET");
  if (openLandingRankings) {
    await openRankings("landing");
    return;
  }
  render();
  await loadMarketShop(generation);
}

async function loadMarketShop(generation = lifecycleGeneration) {
  if (useMarketPreview || !isCurrentLifecycle(generation) || !state.uid) return;
  state.shopBusy = true;
  state.shopStatus = "loading";
  render();
  try {
    const response = await marketShopCallable({ action: "get" });
    if (!isCurrentLifecycle(generation)) return;
    applyMarketShopResponse(response.data);
  } catch (error) {
    if (!isCurrentLifecycle(generation)) return;
    console.warn("VALUE MARKET shop profile is unavailable.", error);
    state.shopStatus = "error";
    state.shopErrorMessage = callableMessage(error, "推し値商店を読み込めませんでした。");
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.shopBusy = false;
      render();
    }
  }
}

function subscribeToActiveRoom(generation = lifecycleGeneration) {
  state.activeUnsubscribe?.();
  const uid = state.uid;
  state.activeUnsubscribe = onSnapshot(doc(firestore, "valueMarketActive", state.uid), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.uid !== uid) return;
    const roomId = snapshot.exists() ? String(snapshot.data()?.roomId || "") : "";
    if (roomId && roomId !== state.roomId) {
      enterRoom(roomId, generation).catch((error) => handleFatalError(error, generation));
    }
  }, (error) => handleFatalError(error, generation));
}

function subscribeToWallet(generation = lifecycleGeneration) {
  state.walletUnsubscribe?.();
  const uid = state.uid;
  state.walletUnsubscribe = onSnapshot(doc(firestore, "wallets", uid), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.uid !== uid || !snapshot.exists()) return;
    const previousBalance = state.balance;
    updateMarketBalance(snapshot.data()?.balance);
    if (state.balance !== previousBalance) render();
  }, (error) => handleFatalError(error, generation));
}

function render() {
  if (!active) return;
  const draft = document.querySelector("#marketChatInput")?.value ?? null;
  const closingDraft = document.querySelector("#marketOshijoClosingText")?.value ?? null;
  const claimDraft = document.querySelector("#marketOshijoClaimAmount")?.value ?? null;
  const oshijoFocusSelector = (() => {
    const focused = document.activeElement;
    if (!focused?.closest?.("#marketOshijoDecision")) return "";
    if (state.busy || focused.matches('[data-market-action="buy"]')) {
      return "#marketOshijoDecision";
    }
    if (focused.matches("[data-market-oshijo-review]")) return "[data-market-oshijo-review]";
    if (focused.matches('[data-market-action="leave"]')) return '[data-market-action="leave"]';
    return "#marketOshijoDecision";
  })();
  const oshijoResultFocusSelector = (() => {
    const focused = document.activeElement;
    if (
      !isOshijoClosing(state.room)
      || !TERMINAL_STATES.has(state.room?.status)
      || !focused?.closest?.("#marketResultPanel")
    ) return "";
    if (state.relationshipFeedback?.busy) return "#marketResultPanel";
    for (const id of [
      "marketPlayAgain",
      "marketResultCertificates",
      "marketResultRanking",
      "marketReturnHome",
    ]) {
      if (focused.id === id) return `#${id}`;
    }
    if (focused.matches("[data-market-block-counterparty]")) {
      return "[data-market-block-counterparty]";
    }
    return "#marketResultPanel";
  })();
  const playingAudio = [...document.querySelectorAll("audio[data-market-audio-key]")]
    .find((audio) => !audio.paused && !audio.ended);
  const enteringQuietDecision = normalizeOshijoPhase(state.room) === "final";
  const playback = playingAudio && !(enteringQuietDecision && playingAudio.dataset.marketOshijoAudio === "true") ? {
    key: playingAudio.dataset.marketAudioKey,
    currentTime: playingAudio.currentTime,
  } : null;
  const screenChanged = lastRenderedScreen !== state.screen;
  const focusPresentation = (() => {
    if (state.screen !== "room" || !state.room || !state.roomId) return { key: "", selector: "" };
    const role = roomRole();
    const oshijoPhase = normalizeOshijoPhase(state.room);
    if (role === "buyer" && oshijoPhase === "warning") {
      return {
        key: `${state.roomId}:buyer:oshijo:warning`,
        selector: "#marketOshijoWarning",
      };
    }
    if (role === "buyer" && oshijoPhase === "closing") {
      return {
        key: `${state.roomId}:buyer:oshijo:closing`,
        selector: "#marketOshijoClosingBuyer",
      };
    }
    if (role === "buyer" && oshijoPhase === "final") {
      return {
        key: `${state.roomId}:buyer:decision:oshijo`,
        selector: "#marketOshijoDecision",
      };
    }
    if (TERMINAL_STATES.has(state.room.status) && isOshijoClosing(state.room)) {
      return {
        key: `${state.roomId}:${role}:${state.room.status}:oshijo`,
        selector: "#marketResultPanel",
      };
    }
    return { key: "", selector: "" };
  })();
  const marketFocusChanged = Boolean(
    focusPresentation.key && focusPresentation.key !== lastRenderedMarketFocusKey
  );
  lastRenderedMarketFocusKey = focusPresentation.key;
  if (state.screen === "setup") appRoot.innerHTML = renderSetup();
  else if (state.screen === "waiting") appRoot.innerHTML = renderWaiting();
  else if (state.screen === "rankings") appRoot.innerHTML = renderRankings();
  else if (state.screen === "certificates") appRoot.innerHTML = renderCertificates();
  else if (state.screen === "room") appRoot.innerHTML = renderRoom();
  else appRoot.innerHTML = renderError();
  lastRenderedScreen = state.screen;
  bindEvents();
  const restoredDraft = document.querySelector("#marketChatInput");
  if (!screenChanged && restoredDraft && draft !== null) restoredDraft.value = draft;
  const restoredClosingDraft = document.querySelector("#marketOshijoClosingText");
  if (!screenChanged && restoredClosingDraft && closingDraft !== null) restoredClosingDraft.value = closingDraft;
  const restoredClaimDraft = document.querySelector("#marketOshijoClaimAmount");
  if (!screenChanged && restoredClaimDraft && claimDraft !== null) restoredClaimDraft.value = claimDraft;
  if (!screenChanged && playback) {
    const restoredAudio = [...document.querySelectorAll("audio[data-market-audio-key]")]
      .find((audio) => audio.dataset.marketAudioKey === playback.key);
    if (restoredAudio) {
      const resume = () => {
        try {
          restoredAudio.currentTime = playback.currentTime;
          restoredAudio.play().catch(() => {});
        } catch {
          // The next render can retry after metadata becomes available.
        }
      };
      if (restoredAudio.readyState >= 1) resume();
      else restoredAudio.addEventListener("loadedmetadata", resume, { once: true });
    }
  }
  if (marketFocusChanged) {
    document.querySelector(focusPresentation.selector)?.focus();
  } else if (oshijoFocusSelector) {
    document.querySelector(oshijoFocusSelector)?.focus({ preventScroll: true });
  } else if (oshijoResultFocusSelector) {
    document.querySelector(oshijoResultFocusSelector)?.focus({ preventScroll: true });
  } else if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function renderWallet({ showPatron = true } = {}) {
  return `<div class="market-wallet"><span>ANJUPAY BALANCE</span><strong>${formatAnjuPayNumber(Math.floor(state.balance))} <small>${ANJU_PAY_UNIT}</small></strong>${showPatron ? renderMarketPatronBadge(state.patron) : ""}<p>貼り合いスタジアム内専用ウォレット</p></div>`;
}

function safeShopClassToken(value, fallback = "standard") {
  return normalizeShopOptionId(value) || fallback;
}

function marketShopCatalogOption(group, id) {
  const options = state.shopCatalog?.[group] || MARKET_SHOP_FALLBACK_CATALOG[group] || [];
  return options.find((option) => option.id === id) || null;
}

function marketShopCatalogLabel(group, id) {
  return marketShopCatalogOption(group, id)?.label || String(id || "");
}

function renderMarketPlayerTitle(titleId) {
  const presentation = getPlayerTitlePresentation(titleId);
  return presentation
    ? `<span class="player-title-badge market-seller-title ${escapeHtml(presentation.className)}"><span aria-hidden="true">${escapeHtml(presentation.icon)}</span>${escapeHtml(presentation.product.title)}</span>`
    : "";
}

function renderMarketShopCharm(shopCharmId, { compact = false } = {}) {
  const stamp = getStamp(shopCharmId);
  if (!stamp) return "";
  return `<span class="market-shop-charm ${compact ? "is-compact" : ""}" role="img" aria-label="商店チャーム：${escapeHtml(stamp.label)}" title="商店チャーム：${escapeHtml(stamp.label)}"><img src="${escapeHtml(stamp.asset)}" alt="" draggable="false" /><small aria-hidden="true">CHARM</small></span>`;
}

function sellerImpressionTotal(verified) {
  return Object.values(verified?.impressions || {}).reduce((sum, count) => sum + Math.max(0, Number(count || 0)), 0);
}

function renderSellerVerified(verifiedValue, { report = false } = {}) {
  const verified = normalizeSellerVerified(verifiedValue);
  const hasRecord = verified.salesCount > 0
    || verified.bestSale > 0
    || verified.marketDays > 0
    || verified.uniqueCounterparties > 0
    || verified.repeatBuyerCount > 0
    || verified.favoriteCount > 0
    || sellerImpressionTotal(verified) > 0;
  if (!hasRecord && !report) {
    return `<div class="market-shop-verified is-new"><strong class="market-shop-verified-label"><span aria-hidden="true">◇</span> NEW SHOP</strong><p>実績収集中の新しい推し値商店です。印象タグは異なる買い手5人から届くまで収集中です。</p></div>`;
  }
  const impressionItems = Object.entries(verified.impressions)
    .sort(([, first], [, second]) => second - first)
    .map(([id, count]) => `<span><b>${escapeHtml(marketShopCatalogLabel("impressionTags", id))}</b><small>${Number(count).toLocaleString("ja-JP")}</small></span>`)
    .join("");
  return `<div class="${report ? "market-shop-report" : "market-shop-verified"}">
    ${report ? `<div class="market-shop-report-head"><span>PRIVATE OWNER REPORT</span><strong>店主レポート</strong><small>あなたにだけ表示</small></div>` : `<strong class="market-shop-verified-label"><span aria-hidden="true">✓</span> FUNCTIONS集計</strong>`}
    <dl>
      <div><dt>成立</dt><dd>${verified.salesCount.toLocaleString("ja-JP")}<small>件</small></dd></div>
      <div><dt>${report ? "購入者" : "最高加算"}</dt><dd>${report ? verified.uniqueCounterparties.toLocaleString("ja-JP") : `${formatAnjuPayNumber(verified.bestSale)} <small>${ANJU_PAY_UNIT}</small>`}</dd></div>
      <div><dt>リピーター</dt><dd>${verified.repeatBuyerCount.toLocaleString("ja-JP")}<small>人</small></dd></div>
      <div><dt>${report ? "常連登録" : "市場日数"}</dt><dd>${report ? verified.favoriteCount.toLocaleString("ja-JP") : verified.marketDays.toLocaleString("ja-JP")}<small>${report ? "人" : "日"}</small></dd></div>
    </dl>
    ${impressionItems
    ? `<div class="market-shop-impressions"><small>届いた印象</small>${impressionItems}</div>`
    : verified.impressionsCollecting && !report
      ? `<div class="market-shop-impressions is-collecting"><small>届いた印象</small><span><b>異なる買い手5人から届くまで収集中</b></span></div>`
      : `<p class="market-shop-report-empty">${report ? "購入者からの印象はまだありません。" : ""}</p>`}
  </div>`;
}

function renderSellerShopCard(shopValue, {
  sellerName = "",
  compact = false,
  force = false,
  relationship = null,
  heading = "店主カード",
  showVerified = true,
} = {}) {
  const shop = normalizeMarketShop(shopValue);
  const hasIdentity = Boolean(
    shop.shopName
    || shop.tagline
    || shop.specialtyTags.length
    || shop.serviceStyles.length
    || shop.titleId
    || shop.shopCharmId
    || shop.repeatWelcome,
  );
  if (!force && !hasIdentity) return "";
  const themeId = safeShopClassToken(shop.themeId);
  const sealId = safeShopClassToken(shop.sealId, "heart");
  const seal = marketShopCatalogOption("seals", sealId)
    || MARKET_SHOP_FALLBACK_CATALOG.seals.find((option) => option.id === sealId)
    || MARKET_SHOP_FALLBACK_CATALOG.seals[0];
  const relationshipSource = relationship === undefined ? shop.relationship : relationship;
  const sellerRelationship = relationshipSource === false || relationshipSource === null
    ? null
    : normalizeSellerRelationship(relationshipSource);
  const relationshipBadges = sellerRelationship ? [
    sellerRelationship.isFavorite ? `<span class="is-favorite">♥ 常連帳のお店</span>` : "",
    sellerRelationship.previousPurchases > 0
      ? `<span>以前${sellerRelationship.previousPurchases}回購入</span>`
      : sellerRelationship.metBefore
        ? `<span>以前取引した店主</span>`
        : "",
    shop.repeatWelcome ? `<span class="market-shop-repeat">常連さん歓迎</span>` : "",
  ].filter(Boolean).join("") : (shop.repeatWelcome ? `<span class="market-shop-repeat">常連さん歓迎</span>` : "");
  const specialtyTags = shop.specialtyTags
    .map((id) => `<span>#${escapeHtml(marketShopCatalogLabel("specialtyTags", id))}</span>`)
    .join("");
  const serviceStyles = shop.serviceStyles
    .map((id) => `<span>${escapeHtml(marketShopCatalogLabel("serviceStyles", id))}</span>`)
    .join("");
  return `<article class="market-seller-card market-shop-theme-${themeId} is-theme-${themeId} ${compact ? "is-compact" : ""}">
    <div class="market-seller-card-head">
      <div class="market-shop-identity-marks">
        <span class="market-shop-seal seal-${sealId}" aria-label="${escapeHtml(seal.label)}">${escapeHtml(seal.icon || "◆")}</span>
        ${renderMarketShopCharm(shop.shopCharmId, { compact })}
      </div>
      <div><small>${escapeHtml(heading)}</small><h2>${escapeHtml(shop.shopName || `${normalizeMarketName(sellerName)}の推し値商店`)}</h2>${shop.publicSellerId ? `<span class="market-shop-public-id">店コード ${escapeHtml(shop.publicSellerId)}</span>` : ""}${shop.tagline ? `<p class="market-shop-tagline">「${escapeHtml(shop.tagline)}」</p>` : `<p class="market-shop-tagline is-empty">商店の理念はまだ設定されていません。</p>`}</div>
      ${renderMarketPlayerTitle(shop.titleId)}
    </div>
    ${relationshipBadges ? `<div class="market-shop-relationship">${relationshipBadges}</div>` : ""}
    ${specialtyTags ? `<div class="market-shop-tags" aria-label="得意タグ">${specialtyTags}</div>` : ""}
    ${serviceStyles ? `<div class="market-shop-styles" aria-label="接客スタイル">${serviceStyles}</div>` : ""}
    ${showVerified ? renderSellerVerified(shop.verified) : ""}
  </article>`;
}

function recommendationForSeller(publicSellerId) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  return sellerId
    ? state.recommendations.find((entry) => entry.publicSellerId === sellerId) || null
    : null;
}

function recommendationShopSnapshot(publicSellerId) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  if (!sellerId) return null;
  return state.favorites.find((shop) => shop.publicSellerId === sellerId)
    || state.certificates.map((certificate) => normalizeMarketShop(certificate?.sellerShop))
      .find((shop) => shop.publicSellerId === sellerId)
    || state.recommendedShelf.find((shop) => shop.publicSellerId === sellerId)
    || (normalizeMarketShop(state.room?.sellerShop).publicSellerId === sellerId
      ? normalizeMarketShop(state.room?.sellerShop)
      : null);
}

function preferredRecommendedShop(shelf = state.recommendedShelf) {
  const sellerId = normalizeShopText(state.preferredRecommendedSellerId, 96);
  if (!sellerId) return null;
  return shelf.find((shop) => shop.publicSellerId === sellerId) || null;
}

function focusMarketJoinButton() {
  window.requestAnimationFrame(() => {
    const joinButton = document.querySelector(".market-join-button");
    joinButton?.scrollIntoView({ behavior: "smooth", block: "center" });
    joinButton?.focus({ preventScroll: true });
  });
}

function focusRecommendedPreferenceButton(publicSellerId) {
  window.requestAnimationFrame(() => {
    const button = [...document.querySelectorAll("[data-market-prefer-recommended]")]
      .find((candidate) => candidate.dataset.marketPreferRecommended === publicSellerId);
    button?.focus({ preventScroll: true });
  });
}

function setRecommendedShopPreference(publicSellerId) {
  if (
    state.role !== "buyer"
    || state.busy
    || state.shopBusy
    || state.queueJoinPending
  ) return;
  const sellerId = normalizeShopText(publicSellerId, 96);
  const shop = state.recommendedShelf.find((entry) => entry.publicSellerId === sellerId);
  if (!shop || sellerId === normalizeMarketShop(state.shop).publicSellerId) {
    showToast("この推薦商店は優先先に選べません。");
    return;
  }
  const removing = state.preferredRecommendedSellerId === sellerId;
  state.preferredRecommendedSellerId = removing ? "" : sellerId;
  state.matchMode = "discover";
  showToast(removing
    ? "推薦商店の優先を外しました。"
    : `${shop.shopName || "この商店"}を最初の${MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS / 1000}秒だけ優先します。`);
  render();
  if (removing) focusRecommendedPreferenceButton(sellerId);
  else focusMarketJoinButton();
}

function renderMarketRecommendationAction(publicSellerId) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  if (!sellerId) return "";
  const recommended = Boolean(recommendationForSeller(sellerId));
  const limit = state.patronImpact.recommendationLimit;
  const used = state.patronImpact.recommendedShopCount;
  const busy = state.recommendationBusySellerId === sellerId;
  const blocked = Boolean(state.recommendationBusySellerId)
    || state.busy
    || state.shopBusy
    || state.queueJoinPending
    || (!recommended && (!limit || used >= limit));
  const label = recommended
    ? "推薦を解除"
    : limit
      ? "発見棚へ推薦"
      : "PATRONで推薦可能";
  return `<div class="market-favorite-actions">
    <span>${recommended ? "あなたの推薦商店です" : `推薦枠 ${used}/${limit}`}</span>
    <button type="button" class="button button-ghost button-small" data-market-recommend-shop="${escapeHtml(sellerId)}" data-market-recommend-action="${recommended ? "remove" : "add"}" ${blocked ? "disabled" : ""}>${busy ? "更新中…" : label}</button>
  </div>`;
}

function renderUnavailableRecommendationManagement() {
  const unavailable = state.recommendations.filter((entry) => entry.unavailable === true);
  if (!unavailable.length) return "";
  const locked = Boolean(state.recommendationBusySellerId)
    || state.busy
    || state.shopBusy
    || state.queueJoinPending;
  const rows = unavailable.map((entry) => {
    const busy = state.recommendationBusySellerId === entry.publicSellerId;
    return `<li class="market-favorite-actions">
      <span>表示できない推薦 / 店コード ${escapeHtml(entry.publicSellerId)}</span>
      <button type="button" class="button button-ghost button-small" data-market-recommend-shop="${escapeHtml(entry.publicSellerId)}" data-market-recommend-action="remove" aria-label="表示できない推薦 ${escapeHtml(entry.publicSellerId)} を解除" ${locked ? "disabled" : ""}>${busy ? "解除中…" : "推薦を解除"}</button>
    </li>`;
  }).join("");
  return `<details class="market-safety-note market-recommendation-maintenance">
    <summary><strong>表示できない推薦 ${unavailable.length}件を管理</strong></summary>
    <p>閉店などで商店カードを表示できない推薦です。推薦枠を空けるには解除してください。</p>
    <ul class="market-favorite-list">${rows}</ul>
  </details>`;
}

function renderPatronFundPanel() {
  const fund = state.patronFund;
  const impact = state.patronImpact;
  const activePolicyLabel = PATRON_FUND_POLICY_LABELS[fund.activePolicy] || "方針を集計中";
  const voteSummary = Object.entries(PATRON_FUND_POLICY_LABELS)
    .map(([id, label]) => `${label} ${fund.votes[id].toLocaleString("ja-JP")}`)
    .join(" / ");
  const viewerVote = fund.viewerVote
    ? `あなたの方針投票：${PATRON_FUND_POLICY_LABELS[fund.viewerVote]}`
    : "方針投票はまだ選んでいません";
  return `<section class="market-rule-card" aria-labelledby="marketPatronFundTitle">
    <span class="eyebrow">VALUE MARKET PATRON FUND</span><h2 id="marketPatronFundTitle">パトロン基金</h2>
    <p>パトロン支援の一部を、成立した商談の売り手手数料へ補填します。買い手の支払額は変わらず、補填分だけ店主の受取を守ります。</p>
    <dl class="market-fee-breakdown market-patron-fund-metrics is-compact">
      <div><dt>基金への総拠出</dt><dd>${formatAnjuPay(fund.contributed)}</dd></div>
      <div><dt>市場全体の消却</dt><dd>${formatAnjuPay(fund.burned)}</dd></div>
      <div><dt>支援原資</dt><dd>${formatAnjuPay(fund.budget)}</dd></div>
      <div><dt>補填済み</dt><dd>${formatAnjuPay(fund.subsidyPaid)}</dd></div>
      <div><dt>基金残り</dt><dd>${formatAnjuPay(fund.remaining)}</dd></div>
      <div><dt>支援成立</dt><dd>${fund.supportedDeals.toLocaleString("ja-JP")}件</dd></div>
    </dl>
    <div class="market-safety-note"><strong>今月の基金方針：${escapeHtml(activePolicyLabel)}</strong><p>${escapeHtml(voteSummary)}。${escapeHtml(viewerVote)}。</p></div>
    <p class="market-roleplay-note">商店の推薦はPayの配分ではありません。推薦枠 ${impact.recommendedShopCount}/${impact.recommendationLimit} を使い、ほかの買い手が店主を見つける「推薦商店」棚へ載せる発見機能です。</p>
    ${renderUnavailableRecommendationManagement()}
  </section>`;
}

function renderRecommendedShelf() {
  if (!state.recommendedShelf.length) return "";
  const locked = state.busy || state.shopBusy || state.queueJoinPending;
  const ownPublicSellerId = normalizeMarketShop(state.shop).publicSellerId;
  const shops = state.recommendedShelf.map((shop) => {
    const selected = state.role === "buyer"
      && state.matchMode === "discover"
      && state.preferredRecommendedSellerId === shop.publicSellerId;
    const ownShop = Boolean(ownPublicSellerId && ownPublicSellerId === shop.publicSellerId);
    const action = state.role !== "buyer"
      ? `<div class="market-favorite-actions"><span>${recommendationForSeller(shop.publicSellerId) ? "あなたも推薦中" : "パトロン推薦で発見"}</span></div>`
      : ownShop
        ? `<div class="market-favorite-actions"><span>あなたの商店です</span></div>`
        : `<div class="market-favorite-actions"><span>${selected ? `最初の${MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS / 1000}秒はこの商店を優先中` : "見つからない場合は通常の商店探しへ自動で広がります"}</span></div>
          <button type="button" class="button ${selected ? "button-primary" : "button-ghost"} button-small" data-market-prefer-recommended="${escapeHtml(shop.publicSellerId)}" aria-pressed="${selected}" ${locked ? "disabled" : ""}>${selected ? "優先を外す" : "この商店を優先して探す"}</button>`;
    return `<li class="market-favorite-card ${selected ? "is-selected" : ""}">
      ${renderSellerShopCard(shop, { compact: true, force: true, heading: "PATRON RECOMMENDED SHOP" })}
      ${action}
    </li>`;
  }).join("");
  return `<section class="market-favorites-book" aria-labelledby="marketRecommendedShelfTitle">
    <div class="market-shop-section-head"><div><span class="eyebrow">PATRON DISCOVERY</span><h2 id="marketRecommendedShelfTitle">推薦商店</h2><p>常連や証書で出会った店主を紹介する発見棚です。買い手は1店を${MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS / 1000}秒だけ優先でき、見つからなければ通常の商店探しへ広がります。推薦によって基金のPay配分やランキングは変わりません。</p></div><strong>${state.recommendedShelf.length} SHOP${state.recommendedShelf.length === 1 ? "" : "S"}</strong></div>
    <ol class="market-favorite-list">${shops}</ol>
  </section>`;
}

function renderMarketShopOptionChecks(group, selectedIds, maximum, inputName) {
  const locked = state.busy || state.shopBusy || state.queueJoinPending;
  return state.shopCatalog[group].map((option) => `<label><input type="checkbox" name="${inputName}" value="${escapeHtml(option.id)}" ${selectedIds.includes(option.id) ? "checked" : ""} ${locked ? "disabled" : ""} /><span>${escapeHtml(option.label)}</span></label>`).join("");
}

function renderMarketShopSettings() {
  const shop = normalizeMarketShop(state.shop);
  const locked = state.busy || state.shopBusy || state.queueJoinPending;
  const titleIds = [...state.ownedTitleIds];
  if (shop.titleId && getPlayerTitleProduct(shop.titleId) && !titleIds.includes(shop.titleId)) titleIds.push(shop.titleId);
  const titleOptions = titleIds.map((titleId) => {
    const title = getPlayerTitleProduct(titleId);
    return title ? `<option value="${escapeHtml(titleId)}" ${titleId === shop.titleId ? "selected" : ""}>${escapeHtml(title.title)}</option>` : "";
  }).join("");
  const shopCharmIds = [...state.ownedShopCharmIds];
  if (shop.shopCharmId && getStamp(shop.shopCharmId) && !shopCharmIds.includes(shop.shopCharmId)) {
    shopCharmIds.push(shop.shopCharmId);
  }
  const shopCharmOptions = shopCharmIds.map((stampId) => {
    const stamp = getStamp(stampId);
    if (!stamp) return "";
    return `<label class="market-shop-charm-option ${stampId === shop.shopCharmId ? "is-selected" : ""}">
      <input type="radio" name="marketShopCharm" value="${escapeHtml(stampId)}" ${stampId === shop.shopCharmId ? "checked" : ""} ${locked ? "disabled" : ""} />
      <img src="${escapeHtml(stamp.asset)}" alt="" draggable="false" />
      <span>${escapeHtml(stamp.name || stamp.label)}</span>
    </label>`;
  }).join("");
  const statusNote = state.shopStatus === "loading"
    ? `<p class="market-shop-status">推し値商店を読み込んでいます…</p>`
    : state.shopStatus === "save-error"
      ? `<p class="market-shop-status is-error"><strong>未保存です。</strong> ${escapeHtml(state.shopErrorMessage || "通信を確認して、もう一度保存してください。")}</p>`
      : state.shopStatus === "error"
        ? `<p class="market-shop-status is-error">商店設定を読み込めませんでした。従来の市場にはそのまま参加できます。保存すると再接続します。</p>`
        : "";
  return `<section class="market-shop-settings" aria-labelledby="marketShopSettingsTitle">
    <div class="market-shop-section-head"><div><span class="eyebrow">YOUR VALUE SHOP</span><h2 id="marketShopSettingsTitle">推し値商店</h2><p>何を売るかだけでなく、誰がどう届けるかを店主カードにします。</p></div><strong>公開する情報を自分で編集</strong></div>
    ${statusNote}
    <div class="market-shop-settings-grid">
      <form class="market-shop-form" id="marketShopForm">
        <div class="market-shop-fields">
          <label class="field"><span>店名（${MARKET_SHOP_NAME_MAX_LENGTH}文字）</span><input id="marketShopName" maxlength="${MARKET_SHOP_NAME_MAX_LENGTH}" value="${escapeHtml(shop.shopName)}" placeholder="ときめき発見商店" required ${locked ? "disabled" : ""} /></label>
          <label class="field"><span>商店の理念（任意・${MARKET_SHOP_TAGLINE_MAX_LENGTH}文字）</span><input id="marketShopTagline" maxlength="${MARKET_SHOP_TAGLINE_MAX_LENGTH}" value="${escapeHtml(shop.tagline)}" placeholder="推しの魅力を丁寧に届けます" ${locked ? "disabled" : ""} /></label>
        </div>
        <fieldset class="market-shop-checks"><legend>得意タグ <small>最大${MARKET_SHOP_MAX_SPECIALTY_TAGS}個</small></legend><div class="market-shop-option-grid">${renderMarketShopOptionChecks("specialtyTags", shop.specialtyTags, MARKET_SHOP_MAX_SPECIALTY_TAGS, "marketShopSpecialty")}</div></fieldset>
        <fieldset class="market-shop-checks"><legend>接客スタイル <small>最大${MARKET_SHOP_MAX_SERVICE_STYLES}個</small></legend><div class="market-shop-option-grid">${renderMarketShopOptionChecks("serviceStyles", shop.serviceStyles, MARKET_SHOP_MAX_SERVICE_STYLES, "marketShopServiceStyle")}</div></fieldset>
        <div class="market-shop-fields is-three-column">
          <label class="field"><span>カードテーマ</span><select id="marketShopTheme" ${locked ? "disabled" : ""}>${state.shopCatalog.themes.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === shop.themeId ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
          <label class="field"><span>商店の印</span><select id="marketShopSeal" ${locked ? "disabled" : ""}>${state.shopCatalog.seals.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === shop.sealId ? "selected" : ""}>${escapeHtml(`${option.icon ? `${option.icon} ` : ""}${option.label}`)}</option>`).join("")}</select></label>
          <label class="field"><span>店主の称号</span><select id="marketShopTitle" ${locked ? "disabled" : ""}><option value="">称号なし</option>${titleOptions}</select><small>AnjuPayストアで所有する称号から選択</small></label>
        </div>
        <fieldset class="market-shop-charm-picker">
          <legend>商店チャーム <small>無料・購入済みスタンプから1個</small></legend>
          <p>AnjuPayストアの「推し活・ときめきコレクション」で集めたスタンプを、店主カードの目印にできます。チャットの6個の装備枠とは別です。</p>
          <div class="market-shop-charm-options">
            <label class="market-shop-charm-option is-none ${shop.shopCharmId ? "" : "is-selected"}">
              <input type="radio" name="marketShopCharm" value="" ${shop.shopCharmId ? "" : "checked"} ${locked ? "disabled" : ""} />
              <span aria-hidden="true">◇</span>
              <span>なし</span>
            </label>
            ${shopCharmOptions}
          </div>
        </fieldset>
        <label class="market-profile-check market-shop-repeat-check"><input id="marketShopRepeatWelcome" type="checkbox" ${shop.repeatWelcome ? "checked" : ""} ${locked ? "disabled" : ""} /><span>「常連さん歓迎」を店主カードへ表示する</span></label>
        <button class="button button-primary" type="submit" ${!state.authReady || locked ? "disabled" : ""}>${state.shopBusy ? "保存中…" : "推し値商店を保存"}</button>
      </form>
      <div class="market-shop-owner-preview">
        ${renderSellerShopCard(shop, { sellerName: state.name, force: true, heading: "PUBLIC OWNER CARD" })}
        ${renderSellerVerified(state.shopReport, { report: true })}
      </div>
    </div>
  </section>`;
}

function favoritePriceCopy(favorite) {
  const price = marketFavoritePreviousPrice(favorite);
  if (!price) return "前回価格は記録されていません";
  const requiredBalance = price + ENTRY_FEE;
  const shortage = Math.max(0, requiredBalance - state.balance);
  if (shortage) {
    return `前回 ${formatAnjuPay(price)} ＋ 着手料${formatAnjuPay(ENTRY_FEE)} ／ あと${formatAnjuPay(shortage)}`;
  }
  const requiredBudget = marketFavoriteRequiredBudget(favorite);
  if (requiredBudget && Number(state.maxBudget) < requiredBudget) {
    return `前回 ${formatAnjuPay(price)} ＋ 着手料${formatAnjuPay(ENTRY_FEE)} ／ 選ぶと購入上限を${formatAnjuPay(requiredBudget)}へ調整`;
  }
  return `前回 ${formatAnjuPay(price)} ＋ 着手料${formatAnjuPay(ENTRY_FEE)} ／ 現在の購入上限で届きます`;
}

function renderMarketFavoritesBook() {
  const hasFavorites = state.favorites.length > 0;
  const locked = state.busy || state.shopBusy || state.queueJoinPending;
  const selectedFavorite = reconcileSelectedFavoriteSeller();
  const hasMatchableFavorites = Boolean(fallbackMarketFavorite());
  const canUseFavoriteMode = Boolean(selectedFavorite);
  const statusNote = state.shopStatus === "loading"
    ? `<p class="market-shop-status">非公開常連帳を読み込んでいます…</p>`
    : state.shopStatus === "error"
      ? `<p class="market-shop-status is-error">常連帳を読み込めませんでした。「新しい商店を探す」はそのまま利用できます。</p>`
      : "";
  const favoriteItems = hasFavorites
    ? state.favorites.map((favorite) => {
      const selectable = favorite.repeatWelcome === true;
      const selected = selectable && favorite.publicSellerId === selectedFavorite?.publicSellerId;
      const activelySelected = selected && state.matchMode === "favorites";
      return `<li class="market-favorite-card ${activelySelected ? "is-selected" : ""}">
        ${renderSellerShopCard(favorite, { compact: true, force: true, heading: "REGULAR SHOP", relationship: { isFavorite: true } })}
        ${selectable
    ? `<label class="market-favorite-select ${activelySelected ? "is-selected" : ""}"><input type="radio" name="marketFavoriteSeller" value="${escapeHtml(favorite.publicSellerId)}" ${activelySelected ? "checked" : ""} ${locked ? "disabled" : ""} /><span><strong>この商店を待つ</strong><small>${activelySelected ? "この商店を指名中" : "選ぶとこの商店だけを指名して待機"}</small></span></label>`
    : `<div class="market-favorite-select is-unavailable"><span><strong>常連受付は休止中</strong><small>店主が「常連さん歓迎」にすると指名できます</small></span></div>`}
        <div class="market-favorite-actions"><span>${escapeHtml(favoritePriceCopy(favorite))}</span><button type="button" class="button button-ghost button-small" data-market-remove-favorite="${escapeHtml(favorite.publicSellerId)}" ${locked ? "disabled" : ""}>常連帳から解除</button></div>
        ${renderMarketRecommendationAction(favorite.publicSellerId)}
      </li>`;
    }).join("")
    : `<li class="market-favorite-empty"><span aria-hidden="true">♡</span><strong>常連帳はまだ空です</strong><p>営業を受けた商談の終了後に「またこの人から買いたい」を保存すると、ここへ追加されます。</p></li>`;
  return `<section class="market-favorites-book" aria-labelledby="marketFavoritesTitle">
    <div class="market-shop-section-head"><div><span class="eyebrow">PRIVATE REGULAR BOOK</span><h2 id="marketFavoritesTitle">非公開常連帳</h2><p>登録した商店は自分にだけ表示されます。誰が登録したかは売り手へ伝えず、店主には合計人数だけを表示します。</p></div><strong>${state.favorites.length} SHOP${state.favorites.length === 1 ? "" : "S"}</strong></div>
    ${statusNote}
    <div class="market-match-mode" role="radiogroup" aria-label="売り手の探し方">
      <label class="${state.matchMode === "discover" ? "is-selected" : ""}"><input type="radio" name="marketMatchMode" value="discover" ${state.matchMode === "discover" ? "checked" : ""} ${locked ? "disabled" : ""} /><span><strong>新しい商店を探す</strong><small>価格条件が合う売り手と出会う</small></span></label>
      <label class="${state.matchMode === "favorites" ? "is-selected" : ""} ${!canUseFavoriteMode ? "is-disabled" : ""}"><input type="radio" name="marketMatchMode" value="favorites" ${state.matchMode === "favorites" ? "checked" : ""} ${!canUseFavoriteMode || locked ? "disabled" : ""} /><span><strong>指名した商店を待つ</strong><small>${selectedFavorite ? `「${escapeHtml(selectedFavorite.shopName || "登録した商店")}」だけを待つ` : hasMatchableFavorites ? "商店カードで指名先を1店選んでください" : hasFavorites ? "「常連さん歓迎」の登録店があると選べます" : "商店を登録すると選べます"}</small></span></label>
    </div>
    <ol class="market-favorite-list">${favoriteItems}</ol>
  </section>`;
}

function renderSetup() {
  const seller = state.role === "seller";
  const locked = state.busy || state.shopBusy || state.queueJoinPending;
  const selectedFavorite = !seller && state.matchMode === "favorites"
    ? matchableMarketFavorite(state.selectedFavoriteSellerId)
    : null;
  const preferredRecommended = !seller && state.matchMode === "discover"
    ? preferredRecommendedShop()
    : null;
  const buyerSearchSummary = !seller
    ? `<div class="market-safety-note market-preferred-summary" role="status">
      <strong>${selectedFavorite
    ? `常連帳「${escapeHtml(selectedFavorite.shopName || "選択した商店")}」を指名`
    : preferredRecommended
      ? `推薦商店を優先：${escapeHtml(preferredRecommended.shopName || "選択した商店")}`
      : "新しい商店を探す"}</strong>
      <p>${selectedFavorite
    ? "この商店だけを待ちます。一般市場へは自動で広がりません。"
    : preferredRecommended
      ? `待機開始から${MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS / 1000}秒はこの商店を優先し、見つからなければ通常検索へ広がります。`
      : "価格条件が合う売り手を一般市場から探します。"}</p>
      <button type="button" class="button button-ghost button-small" id="marketSetupOptionsButton" ${locked ? "disabled" : ""}>探し方・常連帳を変更</button>
    </div>`
    : `<div class="market-safety-note market-preferred-summary">
      <strong>店主カード：${escapeHtml(normalizeMarketShop(state.shop).shopName || "推し値商店")}</strong>
      <p>現在保存されている店主カードで待機します。</p>
      <button type="button" class="button button-ghost button-small" id="marketSetupOptionsButton" ${locked ? "disabled" : ""}>店主カードを編集</button>
    </div>`;
  const imagePreview = state.image?.url
    ? `<figure class="market-listing-preview"><img src="${escapeHtml(state.image.url)}" alt="出品する画像のプレビュー" /><figcaption>${escapeHtml(state.listingTitle || "無題の推し")} / ${formatAnjuPay(state.askingPrice)}</figcaption></figure>`
    : `<div class="market-image-empty"><span>♡</span><strong>推し画像を1枚選択</strong><small>画像はFirebaseへ保存されません</small></div>`;
  return `<section class="screen market-screen market-setup">
    <div class="market-hero">
      <div><span class="eyebrow">END CONTENT / VALUE ROLEPLAY</span><h1>推し値市場 <small>VALUE MARKET</small></h1>
      <p>ゲーム内通貨AnjuPayで推し値をつけ、画像の魅力を営業するTRPGエンドコンテンツです。</p></div>
      ${renderWallet()}
    </div>
    <div class="market-role-tabs" role="tablist" aria-label="市場でのロール">
      <button type="button" class="${seller ? "is-active" : ""}" data-market-role="seller" role="tab" aria-selected="${seller}" ${locked ? "disabled" : ""}><span>SELLER</span><strong>売り手</strong><small>画像の魅力を言葉や10秒音声で営業</small></button>
      <button type="button" class="${!seller ? "is-active" : ""}" data-market-role="buyer" role="tab" aria-selected="${!seller}" ${locked ? "disabled" : ""}><span>BUYER</span><strong>買い手</strong><small>自分のAnjuPayで推し値を評価</small></button>
    </div>
    <div class="market-entry-grid">
      <form class="market-entry-card" id="marketEntryForm">
        <label class="field"><span>プレイヤーネーム</span><input id="marketName" maxlength="16" value="${escapeHtml(state.name)}" required /></label>
        ${seller ? `<label class="market-image-picker">${imagePreview}<input id="marketImageInput" type="file" accept="image/*" /></label>
          <label class="field"><span>出品タイトル（30文字）</span><input id="marketListingTitle" maxlength="30" value="${escapeHtml(state.listingTitle)}" placeholder="この一枚の呼び名" required /></label>
          <div class="market-inline-fields">
            <label class="field"><span>販売価格</span><select id="marketAskingPrice" aria-describedby="marketSetupFeeBreakdown">${MARKET_PRICES.map((price) => `<option value="${price}" ${price === Number(state.askingPrice) ? "selected" : ""}>${formatAnjuPay(price)}</option>`).join("")}</select></label>
            <label class="field"><span>営業方法</span><select id="marketPitchStyle"><option value="either" ${state.pitchStyle === "either" ? "selected" : ""}>チャット／10秒音声</option><option value="chat" ${state.pitchStyle === "chat" ? "selected" : ""}>チャット中心</option><option value="audio" ${state.pitchStyle === "audio" ? "selected" : ""}>10秒音声中心</option></select></label>
          </div>
          ${renderMarketFeeBreakdown(state.askingPrice, { id: "marketSetupFeeBreakdown", compact: true })}`
          : `<label class="field"><span>購入上限</span><select id="marketMaxBudget">${MARKET_PRICES.map((price) => `<option value="${price}" ${price === Number(state.maxBudget) ? "selected" : ""} ${price + ENTRY_FEE > state.balance ? "disabled" : ""}>${formatAnjuPay(price)}</option>`).join("")}</select><small>販売価格が上限以内の売り手だけとマッチします。着手料${formatAnjuPay(ENTRY_FEE)}は別途必要です。</small></label>`}
        ${buyerSearchSummary}
        <button class="button button-primary market-join-button" type="submit" ${!state.authReady || locked || (seller && !state.image) || (!seller && state.balance < 15) ? "disabled" : ""}>${state.queueJoinPending || state.busy ? "参加処理中…" : seller ? "売り手として待機する" : "買い手として待機する"}</button>
      </form>
      <aside class="market-rule-card">
        <span class="eyebrow">FAIR DEAL FLOW</span><h2>取引の流れ</h2>
        <ol><li><b>1</b><span>マッチ後、買い手は画像と価格を無料で確認します。</span></li><li><b>2</b><span>「営業を受ける」を選ぶと、着手料として${formatAnjuPay(ENTRY_FEE)}をAnjuPay残高からFunctionsが保留します。</span></li><li><b>3</b><span>売り手がチャットまたは10秒音声で営業し、完了時に保留中のAnjuPayを受け取ります。</span></li><li><b>4</b><span>購入成立時だけ売り手へ5%（端数切り上げ・最低${formatAnjuPay(1)}）の市場手数料が発生し、買い手へ非譲渡の推し値証書を発行します。</span></li></ol>
        <div class="market-safety-note"><strong>ANJUPAY AUTHORITY</strong><p>AnjuPayの残高移動はCloud Functionsだけが確定し、売買と独立ランキングをFirestoreの同一トランザクションで更新します。</p></div>
        <p class="market-roleplay-note">売買はTRPGとしてのロールプレイです。画像データや著作権・所有権は移転しません。画像の一時判定、音声通報機能は設けません。</p>
        <div class="market-setup-links"><button class="button button-ghost" type="button" id="marketRankingsButton" ${locked ? "disabled" : ""}>売り手・買い手ランキング</button><button class="button button-ghost" type="button" id="marketCertificatesButton" ${locked ? "disabled" : ""}>推し値証書コレクション</button></div>
        ${useMarketPreview ? `<div class="market-preview-controls">
          <small>LOCAL UI PREVIEW</small>
          <button type="button" data-market-preview-room="preview:buyer">買い手プレビュー画面</button>
          <button type="button" data-market-preview-room="pitch:seller">売り手営業画面</button>
          <button type="button" data-market-preview-room="decision:buyer">買い手決済画面</button>
          <button type="button" data-market-preview-room="oshijo_warning:buyer:oshijo">推し嬢・警告画面</button>
          <button type="button" data-market-preview-room="oshijo_closing:buyer:oshijo">推し嬢・本気商談画面</button>
          <button type="button" data-market-preview-room="decision:buyer:oshijo">推し嬢・静かな最終判断</button>
          <button type="button" data-market-preview-room="extension_offer:buyer">内金確認画面</button>
          <button type="button" data-market-preview-room="sold:buyer">成立結果画面</button>
          <button type="button" data-market-preview-room="sold:buyer:oshijo">推し嬢・オールイン結果</button>
        </div>` : ""}
      </aside>
    </div>
    ${seller ? renderMarketShopSettings() : renderMarketFavoritesBook()}
    ${renderPatronFundPanel()}
    ${renderRecommendedShelf()}
  </section>`;
}

function renderWaiting() {
  const selectedFavorite = state.matchMode === "favorites"
    ? matchableMarketFavorite(state.selectedFavoriteSellerId)
    : null;
  const preferredRecommended = state.role === "buyer" && state.matchMode === "discover"
    ? preferredRecommendedShop()
    : null;
  const selectedFavoritePreviousPrice = marketFavoritePreviousPrice(selectedFavorite);
  const waitingTitle = state.role === "seller"
    ? "買い手を探しています"
    : selectedFavorite
      ? `「${escapeHtml(selectedFavorite.shopName || "登録した商店")}」を待っています`
      : preferredRecommended
        ? `「${escapeHtml(preferredRecommended.shopName || "推薦商店")}」を優先して探しています`
      : "売り手を探しています";
  const waitingDetail = state.role === "seller"
    ? `${escapeHtml(state.listingTitle)} / ${formatAnjuPay(state.askingPrice)}`
    : `購入上限 ${formatAnjuPay(state.maxBudget)}${selectedFavorite
      ? `${selectedFavoritePreviousPrice ? ` / 前回価格 ${formatAnjuPay(selectedFavoritePreviousPrice)}` : ""} / 指名店コード ${escapeHtml(selectedFavorite.publicSellerId)}`
      : preferredRecommended
        ? ` / 最初の${MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS / 1000}秒だけ優先し、その後は通常検索`
        : ""}`;
  return `<section class="screen market-screen market-waiting"><div class="market-waiting-card">
    <div class="market-radar" aria-hidden="true"><i></i><i></i><span>♡</span></div>
    <span class="eyebrow">SEARCHING VALUE PARTNER</span><h1>${waitingTitle}</h1>
    <p>${waitingDetail} で待機中です。</p>
    <small>ブラウザを閉じるかキャンセルすると待機列から外れます。</small>
    <button class="button button-ghost" id="marketCancelQueueButton" ${state.busy ? "disabled" : ""}>待機をキャンセル</button>
  </div></section>`;
}

function renderMarketXLink(profile) {
  const { xHandle } = sanitizeMarketPublicProfile(profile);
  if (!xHandle) return "";
  return `<a class="market-ranking-x" href="https://x.com/${encodeURIComponent(xHandle)}" target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer" aria-label="Xの自己申告プロフィール @${escapeHtml(xHandle)} を新しいタブで開く"><span>X・自己申告</span>@${escapeHtml(xHandle)} <b aria-hidden="true">↗</b></a>`;
}

function renderMarketProfilePreview(profile, { xPublic = true, taglinePublic = true } = {}) {
  const sanitized = sanitizeMarketPublicProfile(profile);
  const xLink = xPublic ? renderMarketXLink(sanitized) : "";
  const tagline = taglinePublic && sanitized.tagline
    ? `<p>「${escapeHtml(sanitized.tagline)}」</p>`
    : `<p class="is-empty">市場プロフィールの一言は非公開です。</p>`;
  return `<div class="market-profile-preview" id="marketRankingProfilePreview"><span>PUBLIC PREVIEW</span><strong>${escapeHtml(state.rankingProfileName || state.name)}</strong>${xLink || `<small>Xリンクは非公開です。</small>`}${tagline}</div>`;
}

function renderMarketRankingProfileSettings() {
  const loading = state.rankingsStatus === "loading";
  const profile = sanitizeMarketPublicProfile(state.rankingProfile);
  const opened = state.rankingProfileOpen ? " open" : "";
  let body = "";
  if (loading) {
    body = `<p class="market-profile-unavailable">公開プロフィールの設定状況を確認しています…</p>`;
  } else if (state.rankingsStatus === "error") {
    body = `<p class="market-profile-unavailable">ランキングを再読み込みすると公開プロフィールを設定できます。</p>`;
  } else if (!state.rankingProfileEligible) {
    body = `<p class="market-profile-unavailable">売上または購入実績がランキングへ反映された後に設定できます。</p>`;
  } else {
    body = `<form class="market-profile-form" id="marketRankingProfileForm">
      <div class="market-profile-fields">
        <label class="market-profile-field" for="marketRankingXHandle"><span>Xユーザー名（任意）</span><span class="market-profile-x-input"><b>@</b><input id="marketRankingXHandle" type="text" maxlength="16" value="${escapeHtml(profile.xHandle)}" placeholder="username" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="marketRankingXHint" /></span><small id="marketRankingXHint">英数字と_で15文字以内。@付きの貼り付けも可。</small></label>
        <label class="market-profile-check"><input id="marketRankingXPublic" type="checkbox" ${profile.xHandle ? "checked" : ""} /><span>ランキングでXリンクを公開する</span></label>
        <label class="market-profile-field" for="marketRankingTagline"><span>市場プロフィールの一言（任意）</span><input id="marketRankingTagline" type="text" maxlength="${MARKET_TAGLINE_MAX_LENGTH}" value="${escapeHtml(profile.tagline)}" placeholder="推しの価値を言葉で届けます" aria-describedby="marketRankingTaglineHint" /><small id="marketRankingTaglineHint"><span id="marketRankingTaglineCount">${profile.tagline.length}</span> / ${MARKET_TAGLINE_MAX_LENGTH}文字</small></label>
        <label class="market-profile-check"><input id="marketRankingTaglinePublic" type="checkbox" ${profile.tagline ? "checked" : ""} /><span>ランキングで一言を公開する</span></label>
      </div>
      <p class="market-profile-privacy">ゲーム内表示名とXアカウント名は別の情報です。Xリンクと一言はランキングを見る全員へ公開されます。Xアカウントの本人確認は行いません。公開すると匿名性が下がります。</p>
      ${renderMarketProfilePreview(profile, { xPublic: Boolean(profile.xHandle), taglinePublic: Boolean(profile.tagline) })}
      <button class="button button-primary button-small" type="submit" id="marketRankingProfileSave" ${state.rankingProfileBusy ? "disabled" : ""}>${state.rankingProfileBusy ? "保存中…" : "公開設定を保存"}</button>
    </form>`;
  }
  return `<details class="market-profile-settings"${opened}><summary><span><strong>自分の公開プロフィール</strong><small>Xリンクと市場プロフィールの一言を任意で設定できます。</small></span><b>設定</b></summary>${body}</details>`;
}

function renderMarketRankingBadges(entry, period) {
  const badges = period === "monthly" && entry.monthlyAchievements?.length
    ? entry.monthlyAchievements
    : entry.achievementShowcase || [];
  if (!badges.length) return "";
  const ids = badges.filter((badge) => typeof badge === "string");
  const knownBadges = ids.length
    ? window.HariaiAchievements?.renderBadges?.(ids) || ""
    : "";
  const customBadges = badges
    .filter((badge) => badge && typeof badge === "object")
    .map((badge) => {
      const label = normalizeShopText(
        badge.label || badge.title || badge.name || badge.id || "月間実績",
        40,
      );
      const level = normalizeNonNegativeInteger(badge.level ?? badge.tier ?? badge.count, 999);
      const icon = normalizeShopText(badge.icon, 4);
      return `<span class="market-monthly-achievement">${icon ? `<b aria-hidden="true">${escapeHtml(icon)}</b>` : ""}${escapeHtml(label)}${level > 1 ? `<small>LV.${level}</small>` : ""}</span>`;
    })
    .join("");
  const fallbackIds = !knownBadges
    ? ids.map((id) => `<span class="market-monthly-achievement">${escapeHtml(id)}</span>`).join("")
    : "";
  return `${knownBadges}${customBadges || fallbackIds ? `<div class="market-monthly-achievements" aria-label="${period === "monthly" ? "月間実績" : "累計実績"}">${customBadges}${fallbackIds}</div>` : ""}`;
}

function renderMarketMonthlyAchievementSummary() {
  if (!state.rankingMonthlyAchievementsAvailable) return "";
  const honors = state.rankingMonthlyAchievements;
  const awardLabels = {
    champion: "月間1位",
    top3: "月間TOP3",
    top10: "月間TOP10",
  };
  const roleCard = (role, heading) => {
    const honor = honors[role];
    const nextTarget = honors.levelMonths.find((months) => months > honor.months) || null;
    const latest = honor.latestAwardId
      ? `${awardLabels[honor.latestAwardId]}${honor.latestSeasonKey ? ` / ${honor.latestSeasonKey}` : ""}`
      : "実績の締めを待っています";
    return `<article>
      <span>${role === "seller" ? "SELLER HONOR" : "BUYER HONOR"}</span>
      <h3>${heading} <small>LV.${honor.level}</small></h3>
      <strong>${honor.months}か月の月間実績</strong>
      <dl><div><dt>TOP3</dt><dd>${honor.top3Months}回</dd></div><div><dt>1位</dt><dd>${honor.championMonths}回</dd></div></dl>
      <p>${escapeHtml(latest)}</p>
      <small>${nextTarget ? `あと${nextTarget - honor.months}か月の実績で次のレベル` : "最高レベルへ到達"}</small>
    </article>`;
  };
  return `<section class="market-monthly-achievement-summary" aria-labelledby="marketMonthlyAchievementTitle">
    <div><span>PERMANENT MONTHLY HONORS</span><h2 id="marketMonthlyAchievementTitle">月間の実績は、累計の歩みとして残ります</h2><p>月が替わっても獲得月数やレベルは失われません。順位によるPay報酬はありません。</p></div>
    <div>${roleCard("seller", "月間の推し嬢")}${roleCard("buyer", "推し支え人")}</div>
  </section>`;
}

function renderRankings() {
  const period = normalizeMarketRankingPeriod(state.rankingPeriod);
  const rankings = state.rankings[period] || { sellers: [], buyers: [], label: "" };
  const periodLabel = period === "monthly" ? "月間" : "累計";
  const monthlyStartsLater = period === "monthly"
    && /^\d{4}-\d{2}$/.test(state.rankingMeta.monthlyStartKey)
    && currentPatronSeasonKey() < state.rankingMeta.monthlyStartKey;
  const monthlyStartLabel = monthlyStartsLater
    ? `${Number(state.rankingMeta.monthlyStartKey.slice(0, 4))}年${Number(state.rankingMeta.monthlyStartKey.slice(5, 7))}月`
    : "";
  const row = (entry, index, role) => {
    const profile = sanitizeMarketPublicProfile(entry.publicProfile);
    const xLink = renderMarketXLink(profile);
    const tagline = profile.tagline ? `<p class="market-ranking-tagline">「${escapeHtml(profile.tagline)}」</p>` : "";
    const achievementBadges = renderMarketRankingBadges(entry, period);
    const patronHonor = role === "seller"
      ? renderOshijoPatronHonor(
        entry.oshijoPatronHonor || entry.patronHonor || entry.patronEligibility,
        { compact: true },
      )
      : "";
    const counterparties = Number(entry.uniqueCounterparties || 0);
    const record = role === "seller"
      ? `成立${Number(entry.count || 0)}件${counterparties ? ` / 買い手${counterparties}人` : ""} / 最高加算${formatAnjuPay(Math.min(OSHIJO_RANKING_CAP, entry.best || 0))}`
      : `購入${Number(entry.count || 0)}件${counterparties ? ` / 応援した店主${counterparties}人` : ""} / 最高加算${formatAnjuPay(Math.min(OSHIJO_RANKING_CAP, entry.best || 0))}`;
    return `<li class="${entry.isViewer === true ? "is-viewer" : ""}"><span class="market-rank-number">${index + 1}</span><div class="market-ranking-entry-main"><div class="market-ranking-entry-head"><strong>${escapeHtml(entry.name)}${entry.isViewer === true ? `<small>あなた</small>` : ""}</strong><em>${formatAnjuPay(entry.primary || 0)}</em></div>${xLink || tagline ? `<div class="market-ranking-public-profile">${xLink}${tagline}</div>` : ""}<small class="market-ranking-record">${record}</small>${achievementBadges}${patronHonor}</div></li>`;
  };
  const list = (entries, role) => entries.length
    ? entries.map((entry, index) => row(entry, index, role)).join("")
    : `<li class="market-ranking-empty">集計対象の売買はまだありません。</li>`;
  return `<section class="screen market-screen market-rankings">
    <div class="market-section-head"><div><span class="eyebrow">INDEPENDENT VALUE RANKING</span><h1>VALUE MARKET ランキング</h1><p>月間は今月の出会い、累計はこれまで積み重ねた支持と貢献の記録です。</p></div><button class="button button-ghost" id="marketRankingBack">${state.rankingReturnScreen === "landing" ? "タイトルへ戻る" : state.rankingReturnScreen === "room" && state.room ? "取引結果へ戻る" : "市場へ戻る"}</button></div>
    ${renderMarketRankingProfileSettings()}
    ${renderMarketMonthlyAchievementSummary()}
    <div class="market-ranking-tabs" role="tablist" aria-label="ランキング集計期間">
      <button type="button" role="tab" data-market-ranking-period="monthly" aria-selected="${period === "monthly"}" class="${period === "monthly" ? "is-active" : ""}"><strong>月間</strong><small>新しい店主と今月の活躍</small></button>
      <button type="button" role="tab" data-market-ranking-period="lifetime" aria-selected="${period === "lifetime"}" class="${period === "lifetime" ? "is-active" : ""}"><strong>累計</strong><small>消えない支持と貢献の歩み</small></button>
    </div>
    ${rankings.label ? `<p class="market-ranking-period-label">${escapeHtml(rankings.label)}</p>` : ""}
    ${monthlyStartsLater && !rankings.sellers.length && !rankings.buyers.length ? `<div class="market-ranking-start-note"><strong>月間ランキングは${escapeHtml(monthlyStartLabel)}から始まります</strong><p>開始前の取引実績は累計ランキングに残り、過去の歩みが0になることはありません。</p></div>` : ""}
    ${state.rankingsStatus === "loading" ? `<div class="market-ranking-loading">ランキングを読み込んでいます…</div>` : `<div class="market-ranking-grid">
      <article><span>SELLER / ${period === "monthly" ? "THIS MONTH" : "ALL TIME"}</span><h2>${periodLabel}売上ランキング</h2><ol>${list(rankings.sellers, "seller")}</ol></article>
      <article><span>BUYER / ${period === "monthly" ? "THIS MONTH" : "ALL TIME"}</span><h2>${periodLabel}貢献ランキング</h2><ol>${list(rankings.buyers, "buyer")}</ol></article>
    </div>`}
    <p class="market-ranking-note">同じ売り手・買い手の組み合わせは、日本時間の1日につき最初の成立取引だけ集計します。1回の実支払額が500 Payを超えても、ランキング加算は最大500 Payです。実際のAnjuPay移動と累計の歩みは失われません。</p>
  </section>`;
}

function certificateDate(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return { iso: "", label: "日時不明" };
  const date = new Date(timestamp);
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
}

function normalizeMarketCertificate(value) {
  const source = value && typeof value === "object" ? value : {};
  const purchasePrice = normalizeNonNegativeInteger(source.purchasePrice, 999_999);
  const marketFee = Math.min(purchasePrice, normalizeNonNegativeInteger(source.marketFee, purchasePrice));
  return {
    ...source,
    purchasePrice,
    marketFee,
    sellerProceeds: normalizeNonNegativeInteger(source.sellerProceeds, purchasePrice),
    patronFundSubsidy: Math.min(
      maximumPatronFundSubsidy(marketFee),
      normalizeNonNegativeInteger(
        source.patronFundSubsidy,
        maximumPatronFundSubsidy(marketFee),
      ),
    ),
    patronFundPolicy: normalizePatronFundPolicy(source.patronFundPolicy),
    patronFundKind: normalizePatronFundKind(source.patronFundKind),
  };
}

function renderCertificateCard(certificate) {
  certificate = normalizeMarketCertificate(certificate);
  const issued = certificateDate(certificate?.issuedAt);
  const price = Math.max(0, Math.floor(Number(certificate?.purchasePrice || 0)));
  const settlement = marketSettlement(price, certificate);
  const fee = settlement.feeAmount;
  const proceeds = settlement.sellerProceeds;
  const issueNumberValue = certificate?.sellerIssueNumber;
  const numericIssueNumber = Math.max(0, Math.floor(Number(issueNumberValue || 0)));
  const sellerIssueNumber = numericIssueNumber
    ? `#${numericIssueNumber.toLocaleString("ja-JP")}`
    : normalizeShopText(issueNumberValue, 24);
  const sellerShop = renderSellerShopCard(certificate?.sellerShop, {
    sellerName: certificate?.sellerName,
    compact: true,
    heading: "CERTIFIED SELLER SHOP",
  });
  const oshijoBadge = isOshijoClosing(certificate)
    ? `<small class="market-oshijo-result is-sold">熱血クロージング成立</small>`
    : "";
  return `<li class="market-certificate-card">
    <div class="market-certificate-seal" aria-hidden="true">推</div>
    <div class="market-certificate-heading"><span>VALUE CERTIFICATE</span><strong>${escapeHtml(certificate?.certificateNumber || "OSHI-UNKNOWN")}</strong></div>
    ${oshijoBadge}
    ${renderPatronBackedBadge(settlement.patronFundSubsidy, { compact: true })}
    ${settlement.patronFundSubsidy > 0 ? `<p>基金方針「${escapeHtml(PATRON_FUND_POLICY_LABELS[certificate.patronFundPolicy] || "出会いと常連")}」で${formatAnjuPay(settlement.patronFundSubsidy)}を補填した成立です。</p>` : ""}
    <h2>${escapeHtml(certificate?.listingTitle || "無題の推し")}</h2>
    <p>売り手 <b>${escapeHtml(certificate?.sellerName || "PLAYER")}</b> の推し値に、あなたがAnjuPayで価値をつけた記録です。</p>
    ${sellerIssueNumber ? `<p class="market-certificate-issue"><span>この商店の発行番号</span><strong>${escapeHtml(sellerIssueNumber)}</strong></p>` : ""}
    ${sellerShop ? `<div class="market-certificate-seller-shop">${sellerShop}</div>` : ""}
    ${renderMarketRecommendationAction(normalizeMarketShop(certificate?.sellerShop).publicSellerId)}
    <dl><div><dt>成約価格</dt><dd>${formatAnjuPay(price)}</dd></div><div><dt>市場手数料</dt><dd>${formatAnjuPay(fee)}</dd></div>${settlement.patronFundSubsidy > 0 ? `<div><dt>基金補填</dt><dd>＋${formatAnjuPay(settlement.patronFundSubsidy)}</dd></div>` : ""}<div><dt>売り手受取</dt><dd>${formatAnjuPay(proceeds)}</dd></div><div><dt>営業ターン</dt><dd>${Math.max(1, Number(certificate?.turn || 1))}</dd></div></dl>
    <time ${issued.iso ? `datetime="${issued.iso}"` : ""}>${escapeHtml(issued.label)} JST</time>
    <small>非譲渡・画像データ／著作権／所有権は含みません</small>
  </li>`;
}

function renderCertificates() {
  let body = "";
  if (state.certificateStatus === "loading") {
    body = `<div class="market-certificate-status" role="status"><div class="loader"></div><p>推し値証書を読み込んでいます…</p></div>`;
  } else if (state.certificateStatus === "error") {
    body = `<div class="market-certificate-status is-error" role="alert"><p>証書コレクションを読み込めませんでした。</p><button class="button button-primary" id="marketCertificatesRetry">再読み込み</button></div>`;
  } else if (!state.certificates.length) {
    body = `<div class="market-certificate-status" role="status"><span aria-hidden="true">◇</span><h2>証書はまだありません</h2><p>推し値市場で購入が成立すると、画像を保存しないメタデータ証書がここへ追加されます。</p></div>`;
  } else {
    body = `<ol class="market-certificate-grid">${state.certificates.map(renderCertificateCard).join("")}</ol>${state.certificateHasMore ? `<p class="market-certificate-limit">最新100件を表示しています。</p>` : ""}`;
  }
  return `<section class="screen market-screen market-certificates">
    <div class="market-section-head"><div><span class="eyebrow">VALUE MARKET COLLECTION</span><h1>推し値証書コレクション</h1><p>購入成立の価格・相手・日時だけを残す、あなただけの非譲渡コレクションです。</p></div><button class="button button-ghost" id="marketCertificatesBack">市場へ戻る</button></div>
    <div class="market-certificate-policy"><strong>画像は保存しません</strong><p>証書は取引メタデータだけです。元画像、営業チャット、音声、著作権、所有権は含まれません。</p></div>
    ${body}
  </section>`;
}

function roomRole() {
  return state.uid === state.room?.sellerUid ? "seller" : state.uid === state.room?.buyerUid ? "buyer" : "";
}

function renderMarketImage() {
  const source = roomRole() === "seller" ? (state.image?.url || state.remoteImage?.url) : state.remoteImage?.url;
  if (source) return `<img src="${escapeHtml(source)}" alt="市場で提示された画像" />`;
  return `<div class="market-transfer-wait"><div class="loader"></div><strong>画像をP2P転送中…</strong><small>${escapeHtml(state.peerStatus)}</small></div>`;
}

function renderMarketMessages() {
  const messages = [
    ...state.chatMessages.map((message) => ({ ...message, kind: "text" })),
    ...state.audioMessages.map((message) => ({ ...message, kind: "audio" })),
  ].sort((first, second) => (
    Number(first.turn || 1) - Number(second.turn || 1)
    || Number(first.createdAt || 0) - Number(second.createdAt || 0)
    || String(first.id || "").localeCompare(String(second.id || ""))
  ));
  if (!messages.length) return `<li class="market-chat-empty">営業メッセージはまだありません。</li>`;
  return messages.map((message) => {
    const closingMessage = isOshijoClosingMessage(message);
    const classes = [
      message.uid === state.uid ? "is-mine" : "",
      message.kind === "audio" ? "is-audio" : "",
      closingMessage ? "is-oshijo-closing" : "",
    ].filter(Boolean).join(" ");
    const displayName = String(message.name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX)
      ? String(message.name).slice(OSHIJO_CLOSING_AUDIO_PREFIX.length)
      : message.name;
    const phaseLabel = closingMessage ? "CLOSING" : `TURN ${Number(message.turn || 1)}`;
    if (message.kind === "audio") {
      return `<li class="${classes}"><span>${escapeHtml(displayName)}</span><p>10秒音声（再生は買い手操作）</p><audio controls preload="metadata" ${state.oshijoAudioMuted && closingMessage ? "muted" : ""} data-market-oshijo-audio="${closingMessage ? "true" : "false"}" data-market-audio-key="${escapeHtml(`${message.turn}:${message.createdAt}`)}" src="${escapeHtml(message.url)}"></audio><small>${phaseLabel}</small></li>`;
    }
    return `<li class="${classes}"><span>${escapeHtml(displayName)}</span><p>${escapeHtml(message.text)}</p><small>${phaseLabel}</small></li>`;
  }).join("");
}

function renderMarketRelationshipPanel(room, role, status) {
  ensureRelationshipFeedback(room);
  const feedback = state.relationshipFeedback;
  const disabled = feedback.busy || feedback.blocked;
  let buyerFeedback = "";
  if (role === "buyer" && (status === "sold" || Number(room.pitchCompletedAt || 0) > 0)) {
    if (feedback.submitted) {
      const impression = feedback.impressionTag
        ? marketShopCatalogLabel("impressionTags", feedback.impressionTag)
        : feedback.alreadyRecorded
          ? "以前届けた印象を確認しました"
          : "印象は送信済みです";
      buyerFeedback = `<div class="market-relationship-saved"><span aria-hidden="true">♥</span><div><strong>${feedback.alreadyRecorded ? "以前の印象はそのまま保存されています" : "店主へ印象を届けました"}</strong><p>${escapeHtml(impression)}${feedback.favorite ? "・常連帳へ登録済み" : ""}</p></div></div>`;
    } else {
      const impressionOptions = state.shopCatalog.impressionTags.map((option) => `<label><input type="radio" name="marketImpressionTag" value="${escapeHtml(option.id)}" ${feedback.impressionTag === option.id ? "checked" : ""} ${disabled ? "disabled" : ""} /><span>${escapeHtml(option.label)}</span></label>`).join("");
      buyerFeedback = `<form class="market-relationship-form" id="marketRelationshipForm">
        <div><span>POSITIVE FEEDBACK</span><h3>この店主の良かったところ</h3><p>肯定的な印象を1つだけ匿名で届けられます。</p></div>
        <fieldset><legend>印象を1つ選択</legend><div class="market-impression-options">${impressionOptions}</div></fieldset>
        <label class="market-relationship-favorite"><input id="marketRelationshipFavorite" type="checkbox" ${feedback.favorite ? "checked" : ""} ${disabled ? "disabled" : ""} /><span><strong>またこの人から買いたい</strong><small>非公開常連帳へ保存し、次回この商店だけを待てます。</small></span></label>
        <button class="button button-primary" type="submit" ${disabled ? "disabled" : ""}>${feedback.busy ? "保存中…" : "印象と常連設定を保存"}</button>
      </form>`;
    }
  }
  const counterpart = role === "seller" ? room.buyerName : room.sellerName;
  const blockPanel = `<div class="market-block-panel ${feedback.blocked ? "is-blocked" : ""}">
    <div><strong>${feedback.blocked ? "この相手をブロックしました" : "今後この相手とマッチしない"}</strong><p>${feedback.blocked ? "誤操作の場合は、この結果画面にいる間にすぐ解除できます。" : `${escapeHtml(normalizeMarketName(counterpart))}との今後の市場マッチングを除外します。`}</p></div>
    <button class="button button-ghost button-small" type="button" data-market-block-counterparty="${feedback.blocked ? "false" : "true"}" ${feedback.busy ? "disabled" : ""}>${feedback.blocked ? "ブロックを解除" : "この相手をブロック"}</button>
  </div>`;
  return `<section class="market-relationship-panel">${buyerFeedback}${blockPanel}</section>`;
}

function marketEntryFeeSettlement(room) {
  const nominal = Math.max(0, Math.floor(Number(room?.entryFee || ENTRY_FEE)));
  const refunded = Math.min(
    nominal,
    Math.max(0, Math.floor(Number(room?.entryFeeRefunded || 0))),
  );
  return {
    nominal,
    refunded,
    paid: Math.max(0, nominal - refunded),
  };
}

function oshijoClosingTurnsUsed(room) {
  const serverCount = normalizeOshijoDeal(room).closingTurnsUsed;
  const localTextCount = state.chatMessages.filter(isOshijoClosingMessage).length;
  const localAudioCount = state.audioMessages.filter(isOshijoClosingMessage).length;
  const localImageCount = state.oshijoClosingImages.length;
  return Math.min(
    OSHIJO_MAX_CLOSING_TURNS,
    Math.max(serverCount, localTextCount + localAudioCount + localImageCount),
  );
}

function oshijoClosingMediaUsed(room, mediaKind) {
  const counts = room?.closingMediaCounts || room?.oshijoClosingMediaCounts || {};
  const serverCount = normalizeNonNegativeInteger(counts?.[mediaKind], OSHIJO_MAX_CLOSING_TURNS);
  if (mediaKind === "text") {
    return Math.max(serverCount, state.chatMessages.filter(isOshijoClosingMessage).length);
  }
  if (mediaKind === "audio") {
    return Math.max(serverCount, state.audioMessages.filter(isOshijoClosingMessage).length);
  }
  if (mediaKind === "image") return Math.max(serverCount, state.oshijoClosingImages.length);
  return 0;
}

function renderOshijoDecisionValues(room, { balance = state.balance } = {}) {
  const deal = normalizeOshijoDeal(room);
  const currentBalance = normalizeNonNegativeInteger(balance, ANJU_PAY_MAX_BALANCE);
  const payment = Math.min(deal.claimAmount, currentBalance);
  return `<dl class="market-oshijo-values">
    <div><dt>推し嬢からの請求額</dt><dd>${formatAnjuPay(deal.claimAmount)}</dd></div>
    <div><dt>現在の所持Pay</dt><dd>${formatAnjuPay(currentBalance)}</dd></div>
    <div><dt>購入後残高（同意時）</dt><dd>${formatAnjuPay(currentBalance - payment)}</dd></div>
    <div><dt>ランキング加算</dt><dd>最大 ${formatAnjuPay(OSHIJO_RANKING_CAP)}</dd></div>
  </dl>`;
}

function renderOshijoClosingImages() {
  if (!state.oshijoClosingImages.length) return "";
  return `<div class="market-oshijo-closing-images" aria-label="推し嬢クロージング画像">${state.oshijoClosingImages.map((image, index) => (
    `<figure><img src="${escapeHtml(image.url)}" alt="推し嬢クロージングで届いた補足画像 ${index + 1}" /><figcaption>クロージング画像 ${index + 1} / この商談中だけ表示</figcaption></figure>`
  )).join("")}</div>`;
}

function renderOshijoWarning(room, role) {
  const deal = normalizeOshijoDeal(room);
  if (role === "seller") {
    return `<div class="market-wait-panel market-oshijo-wait market-oshijo-claim-wait">
      <span>OSHIJO CLAIM / BUYER WARNING</span>
      <h2>${formatAnjuPay(deal.claimAmount)}を請求しました</h2>
      <p>買い手には、請求額・現在残高・同意後残高・ランキング加算上限を示した警告画面が表示されています。買い手が「営業を聞く」を選ぶまで、追い込み営業は送れません。</p>
      <div class="market-oshijo-seller-rule"><strong>オールイン成約について</strong><span>相手の残高は表示されません。残高が請求額に満たない場合でも、買い手が明示的に同意すれば、その時点の全残高が実支払額となり、請求額との差額は残りません。</span></div>
    </div>`;
  }
  return `<div id="marketOshijoWarning" class="market-decision-panel market-oshijo-warning" role="alertdialog" aria-modal="false" aria-labelledby="marketOshijoWarningHeading" aria-describedby="marketOshijoWarningCaution" tabindex="-1">
    <span>PAYMENT CLAIM / NORMAL JUDGMENT FIRST</span>
    <h2 id="marketOshijoWarningHeading">${formatAnjuPay(deal.claimAmount)}の任意請求です</h2>
    <p id="marketOshijoWarningCaution" class="market-oshijo-pay-warning"><strong>支払義務はありません。</strong>営業を聞かず、ここで見送ることもできます。画像データ・著作権・所有権は移りません。</p>
    ${renderOshijoDecisionValues(room)}
    <p class="market-oshijo-entry-fee">ランキングは実支払額にかかわらず、1回の成立につき最大${formatAnjuPay(OSHIJO_RANKING_CAP)}だけ加算されます。</p>
    <div class="market-oshijo-warning-actions">
      <button class="button market-oshijo-leave" data-market-action="leave" ${state.busy ? "disabled" : ""}>ここで見送る</button>
      <button class="button button-ghost" data-market-action="hear_oshijo_closing" ${state.busy ? "disabled" : ""}>警告を理解して営業を聞く</button>
    </div>
  </div>`;
}

function renderOshijoClosingRound(room, role) {
  const deal = normalizeOshijoDeal(room);
  const used = oshijoClosingTurnsUsed(room);
  const remaining = Math.max(0, OSHIJO_MAX_CLOSING_TURNS - used);
  if (role === "seller") {
    const imageUsed = oshijoClosingMediaUsed(room, "image") > 0;
    const audioUsed = oshijoClosingMediaUsed(room, "audio") > 0;
    return `<div class="market-pitch-panel market-oshijo-closing-panel">
      <span>OSHIJO CLOSING / ${used} OF ${OSHIJO_MAX_CLOSING_TURNS}</span>
      <h2>警戒心を言葉・画像・声で解きほぐす</h2>
      <p>請求額は${formatAnjuPay(deal.claimAmount)}です。最大${OSHIJO_MAX_CLOSING_TURNS}手まで届けられます。買い手が静かな最終判断へ進んだ瞬間、すべての送信は止まります。</p>
      <div class="market-oshijo-seller-rule"><strong>成約額の約束</strong><span>相手の残高は非公開です。請求額未満でも、買い手がオールインへ同意した場合は実際に残っている全Payで成立します。売り手はその実支払額を最終成約額として受け入れます。</span></div>
      <div class="market-oshijo-turn-meter"><span>残り ${remaining} 手</span><progress max="${OSHIJO_MAX_CLOSING_TURNS}" value="${used}">${used}/${OSHIJO_MAX_CLOSING_TURNS}</progress></div>
      <form id="marketOshijoClosingTextForm">
        <label for="marketOshijoClosingText">文字で届ける</label>
        <textarea id="marketOshijoClosingText" maxlength="${OSHIJO_CLOSING_TEXT_MAX_LENGTH}" placeholder="相手の迷いを受け止め、自分の言葉で価値を伝える…" ${state.busy || remaining <= 0 ? "disabled" : ""}></textarea>
        <button class="button button-cyan" ${state.busy || remaining <= 0 ? "disabled" : ""}>文字を1手送る</button>
      </form>
      <div class="market-oshijo-media-actions">
        <label class="button button-ghost ${imageUsed ? "is-used" : ""}">${imageUsed ? "クロージング画像は送信済み" : "画像を1手送る"}<input id="marketOshijoClosingImageInput" type="file" accept="image/png,image/jpeg,image/webp" ${state.busy || remaining <= 0 || imageUsed || !state.channelReady ? "disabled" : ""} /></label>
        <label class="button button-ghost ${audioUsed ? "is-used" : ""}">${audioUsed ? "クロージング音声は送信済み" : "10秒音声を1手送る"}<input id="marketOshijoClosingAudioInput" type="file" accept="audio/*" ${state.busy || remaining <= 0 || audioUsed || !state.channelReady ? "disabled" : ""} /></label>
      </div>
      ${remaining <= 0 ? `<p class="market-oshijo-limit-reached">3手を届けました。買い手が最終判断へ進むまでお待ちください。</p>` : ""}
    </div>`;
  }
  return `<div id="marketOshijoClosingBuyer" class="market-decision-panel market-oshijo-closing-buyer" role="region" aria-live="polite" aria-labelledby="marketOshijoClosingBuyerHeading" tabindex="-1">
    <span>OSHIJO CLOSING / BUYER CONTROLLED</span>
    <h2 id="marketOshijoClosingBuyerHeading">本気商談を聞いています</h2>
    <p>文字・画像・音声は最大${OSHIJO_MAX_CLOSING_TURNS}手です。音声は自動再生されません。いつでも営業を止め、静かな最終判断へ進むか、見送れます。</p>
    ${renderOshijoDecisionValues(room)}
    <div class="market-oshijo-playback-control">
      <button type="button" class="button button-ghost button-small" id="marketOshijoAudioMute" aria-pressed="${state.oshijoAudioMuted}">${state.oshijoAudioMuted ? "クロージング音声のミュートを解除" : "クロージング音声をミュート"}</button>
      <small>再生ボタンを押した音声だけ再生されます。</small>
    </div>
    ${renderOshijoClosingImages()}
    <div class="market-oshijo-warning-actions">
      <button class="button market-oshijo-leave" data-market-action="leave" ${state.busy ? "disabled" : ""}>今回は見送る</button>
      <button class="button button-primary" data-market-action="enter_silent_decision" ${state.busy ? "disabled" : ""}>営業を止めて静かな最終判断へ</button>
    </div>
  </div>`;
}

function renderOshijoFinalDecision(room, role) {
  const deal = normalizeOshijoDeal(room);
  if (role === "seller") {
    return `<div class="market-wait-panel market-oshijo-wait is-quiet">
      <span>QUIET FINAL DECISION</span>
      <h2>営業入力は終了しました</h2>
      <p>買い手が新しい営業を受けない静かな画面で、${formatAnjuPay(deal.claimAmount)}の請求へ最終判断をしています。購入または見送りが選ばれるまで、そのままお待ちください。</p>
    </div>`;
  }
  const currentBalance = normalizeNonNegativeInteger(state.balance, ANJU_PAY_MAX_BALANCE);
  const paidAmount = Math.min(deal.claimAmount, currentBalance);
  const allIn = currentBalance < deal.claimAmount;
  const entryFee = marketEntryFeeSettlement(room);
  const totalSpend = paidAmount + entryFee.paid;
  const entryFeeCopy = entryFee.refunded > 0
    ? `着手料${formatAnjuPay(entryFee.nominal)}のうち${formatAnjuPay(entryFee.paid)}は営業分として支払済みで、${formatAnjuPay(entryFee.refunded)}は返還済みです。`
    : `着手料${formatAnjuPay(entryFee.paid)}は購入代金とは別に、営業分として支払済みです。`;
  const confirmationCopy = allIn
    ? `請求額${formatAnjuPay(deal.claimAmount)}に対し、現在の${formatAnjuPay(currentBalance)}すべてを支払います。今回の総支出は${formatAnjuPay(totalSpend)}です。`
    : `${formatAnjuPay(deal.claimAmount)}を支払います。今回の総支出は${formatAnjuPay(totalSpend)}です。`;
  const buyLabel = allIn
    ? `${formatAnjuPay(currentBalance)}すべてでオールイン成約`
    : `${formatAnjuPay(deal.claimAmount)}を支払って購入を確定`;
  return `<div id="marketOshijoDecision" class="market-decision-panel market-oshijo-decision is-quiet" role="region" aria-live="polite" aria-atomic="true" aria-labelledby="marketOshijoHeading" aria-describedby="marketOshijoCaution marketOshijoConsent" tabindex="-1">
    <span>OSHIJO MODE / 筋と人情の熱血お嬢 / QUIET FINAL DECISION</span>
    <h2 id="marketOshijoHeading">営業は止まりました。ここからは、あなたの判断です。</h2>
    <p id="marketOshijoCaution" class="market-oshijo-pay-warning"><strong>Payは貴重です。購入は任意です。</strong>新しい文字・画像・音声は届きません。落ち着いて支払額と残高を確認してください。</p>
    <p class="market-oshijo-roleplay">これは画像の魅力にPayで価値をつけるロールプレイです。画像データ・著作権・所有権は移りません。</p>
    ${renderOshijoDecisionValues(room, { balance: currentBalance })}
    <p class="market-oshijo-entry-fee">${entryFeeCopy}</p>
    <div id="marketOshijoConsent" class="market-oshijo-consent"><strong>${allIn ? "オールイン成約の確認" : "購入内容の確認"}</strong><span>${allIn ? `所持Payが請求額に満たないため、同意すると${formatAnjuPay(currentBalance)}すべてが実支払額になります。不足分の請求は残らず、後払いもありません。` : "請求額を全額支払います。購入後残高は上の表示どおりです。"}</span></div>
    <div class="market-oshijo-actions">
      <div class="market-oshijo-confirm">
        <button type="button" class="button market-oshijo-review" data-market-oshijo-review aria-expanded="false" aria-controls="marketOshijoFinalConfirm" ${state.busy ? "disabled" : ""}>${allIn ? "オールイン内容の最終確認へ" : "購入内容の最終確認へ"}</button>
        <div id="marketOshijoFinalConfirm" role="group" aria-label="購入の最終確認" hidden><strong>最終確認</strong><span>${confirmationCopy}</span><button class="button market-oshijo-buy ${allIn ? "is-all-in" : ""}" data-market-action="buy" ${state.busy || paidAmount <= 0 ? "disabled" : ""}>${buyLabel}</button></div>
      </div>
      <button class="button market-oshijo-leave" data-market-action="leave" ${state.busy ? "disabled" : ""}>今回は見送る</button>
    </div>
  </div>`;
}

function oshijoShareCopy(room, choice) {
  const deal = normalizeOshijoDeal(room);
  if (choice === "persuasion") {
    return "推し嬢の営業の説得力が素晴らしく、ついつい購入してしまった。";
  }
  if (choice === "all_in") {
    return `推し嬢の本気営業に心を動かされ、${formatAnjuPay(deal.paidAmount)}の全Payを託した。0 Payから、また始める。`;
  }
  if (choice === "value") {
    return `この商談で${formatAnjuPay(deal.paidAmount)}を、自分で選んだ推し値として届けました。`;
  }
  return "";
}

function renderOshijoSharePanel(room, role, status) {
  if (role !== "buyer" || status !== "sold" || !isOshijoClosing(room)) return "";
  const deal = normalizeOshijoDeal(room);
  const options = [
    ["persuasion", "説得力を称える", "推し嬢の営業の説得力が素晴らしく、ついつい購入してしまった。"],
    ...(deal.allIn ? [["all_in", "0 Payからの再出発", `全Payを託した。0 Payから、また始める。`]] : []),
    ["value", "自分の推し値として残す", `${formatAnjuPay(deal.paidAmount)}を、自分で選んだ推し値として届けた。`],
  ];
  return `<section class="market-oshijo-share">
    <div><span>OPTIONAL SHARE COPY</span><h3>本人が選んだ言葉だけ残す</h3><p>共有は任意です。選択するまで文章は決まりません。</p></div>
    <div class="market-oshijo-share-options">${options.map(([id, label, preview]) => `<label><input type="radio" name="marketOshijoShareChoice" value="${id}" ${state.oshijoShareChoice === id ? "checked" : ""} /><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(preview)}</small></span></label>`).join("")}</div>
    <button type="button" class="button button-ghost button-small" id="marketOshijoCopyShare" ${state.oshijoShareChoice ? "" : "disabled"}>選んだ文章をコピー</button>
  </section>`;
}

function renderOshijoRestartPanel(room, role, status) {
  if (role !== "buyer" || status !== "sold" || state.balance !== 0 || !isOshijoClosing(room)) return "";
  const guide = normalizeMarketRestartGuide(room.restartGuide || state.restartGuide);
  const remaining = guide.remainingPay || Math.max(0, guide.buyerMinimumBalance - state.balance);
  let rewardCopy = "現在取得できる対戦・ランキング報酬は、各モードの報酬表示から確認できます。";
  if (guide.rewardLabel || guide.rewardAmount) {
    rewardCopy = `${guide.rewardLabel || "次の報酬"}${guide.rewardAmount ? ` ${formatAnjuPay(guide.rewardAmount)}` : ""}${guide.matchesUntilReward ? `まであと${guide.matchesUntilReward}試合` : guide.rewardAvailable ? "を現在受け取れます" : ""}。`;
  }
  return `<section class="market-oshijo-restart">
    <span>ZERO PAY / NEW CHAPTER</span>
    <h3>0 Payから、また市場へ</h3>
    <p>買い手として戻る目安は${formatAnjuPay(guide.buyerMinimumBalance)}です。あと${formatAnjuPay(remaining)}で、最小価格の商談へ参加できます。</p>
    <p>売り手は0 Payでも参加でき、買い手に営業を受けてもらって完了すると着手料${formatAnjuPay(ENTRY_FEE)}を受け取れます。</p>
    <p>${escapeHtml(rewardCopy)}</p>
    <div><button type="button" class="button button-primary" id="marketRestartAsSeller">売り手として0 Payから営業する</button><button type="button" class="button button-ghost" id="marketRestartHome">対戦・報酬を確認する</button></div>
  </section>`;
}

function renderRoomControls(room, role) {
  const status = room.status;
  const terminal = TERMINAL_STATES.has(status);
  if (terminal) {
    const title = status === "sold" ? "売買成立" : status === "canceled" ? "取引中止" : "今回は見送り";
    const oshijoDeal = normalizeOshijoDeal(room);
    const settlementAmount = isOshijoClosing(room)
      ? oshijoDeal.paidAmount
      : room.salePrice || room.listing?.askingPrice;
    const settlement = marketSettlement(settlementAmount, {
      settlementQuote: {
        grossAmount: Number(settlementAmount || 0),
        feeAmount: Number(room.marketFee ?? room.settlementQuote?.feeAmount),
        sellerProceeds: Number(room.sellerProceeds ?? room.settlementQuote?.sellerProceeds),
        patronFundSubsidy: Number(room.patronFundSubsidy || 0),
      },
      patronFundSubsidy: Number(room.patronFundSubsidy || 0),
    });
    const copy = status === "sold"
      ? role === "buyer"
        ? `${formatAnjuPay(settlement.grossAmount)}で成立し、推し値証書 ${room.certificateNumber || ""} をコレクションへ追加しました。`
        : `${formatAnjuPay(settlement.grossAmount)}で成立。成約手数料${formatAnjuPay(settlement.feeAmount)}を差し引き、${formatAnjuPay(settlement.sellerProceeds)}を受け取りました。`
      : "このルームでのAnjuPay移動と営業履歴はここで終了です。";
    const rankingCopy = status === "sold"
      ? `<small>${room.rankingCounted === false
        ? "同一ペア本日2回目以降のためランキング対象外です。"
        : isOshijoClosing(room)
          ? `ランキングには${formatAnjuPay(oshijoDeal.rankingContribution)}を加算します（1成立最大${formatAnjuPay(OSHIJO_RANKING_CAP)}）。`
          : "独立ランキングへ反映されます。"}</small>`
      : "";
    const fundCopy = status === "sold" && settlement.patronFundSubsidy > 0
      ? `<p>パトロン基金が${formatAnjuPay(settlement.patronFundSubsidy)}を補填しました。基金方針「${escapeHtml(PATRON_FUND_POLICY_LABELS[normalizePatronFundPolicy(room.patronFundPolicy)] || "出会いと常連")}」／${escapeHtml(PATRON_FUND_KIND_LABELS[normalizePatronFundKind(room.patronFundKind)] || "店主の成立を支援")}。</p>`
      : "";
    const entryFee = marketEntryFeeSettlement(room);
    const entryFeeResultCopy = entryFee.refunded > 0
      ? `着手料${formatAnjuPay(entryFee.nominal)}のうち${formatAnjuPay(entryFee.paid)}を営業分として精算し、${formatAnjuPay(entryFee.refunded)}は買い手の残高へ返還済みです。`
      : `着手料${formatAnjuPay(entryFee.paid)}は購入代金とは別に、営業分として精算済みです。`;
    const oshijoResultBadge = isOshijoClosing(room) && (status === "sold" || status === "ended")
      ? `<small class="market-oshijo-result is-${status}">${status === "sold" ? "熱血クロージング成立" : "熱血クロージング見送り"}</small>`
      : "";
    const oshijoSettlementCopy = isOshijoClosing(room)
      ? status === "sold"
        ? role === "buyer"
          ? `<div class="market-oshijo-result-values"><div><span>請求額</span><strong>${formatAnjuPay(oshijoDeal.claimAmount)}</strong></div><div><span>実支払額</span><strong>${formatAnjuPay(settlement.grossAmount)}</strong></div><div><span>成約種別</span><strong>${oshijoDeal.allIn ? "オールイン" : "全額成約"}</strong></div></div><p>${entryFeeResultCopy}今回の総支出は${formatAnjuPay(settlement.grossAmount + entryFee.paid)}です。${oshijoDeal.allIn ? "請求額との差額は残らず、0 Payから新しい章が始まります。" : ""}</p>`
          : `<div class="market-oshijo-result-values"><div><span>請求額</span><strong>${formatAnjuPay(oshijoDeal.claimAmount)}</strong></div><div><span>実支払額</span><strong>${formatAnjuPay(settlement.grossAmount)}</strong></div><div><span>成約種別</span><strong>${oshijoDeal.allIn ? "オールイン" : "全額成約"}</strong></div></div><p>${entryFeeResultCopy}${oshijoDeal.allIn ? "買い手の全残高を実支払額として成約しました。" : ""}</p>`
        : role === "buyer"
          ? `<p>購入代金は支払っていません。${entryFeeResultCopy}</p>`
          : `<p>購入は見送りになりました。${entryFeeResultCopy}</p>`
      : "";
    const patronHonor = renderOshijoPatronHonor(
      room.oshijoPatron
        || room.oshijoPatronHonor
        || room.patronHonor
        || room.oshijoPatronEligibility
        || (role === "seller" ? state.patronEligibility : null),
    );
    return `<div id="marketResultPanel" class="market-result-panel ${status}" role="status" aria-live="polite" tabindex="-1"><span>${status === "sold" ? "DEAL COMPLETE" : "MARKET CLOSED"}</span>${status === "sold" ? renderPatronBackedBadge(settlement.patronFundSubsidy) : ""}${oshijoResultBadge}<h2>${title}</h2><p>${copy}</p>${oshijoSettlementCopy}${fundCopy}${status === "sold" ? renderMarketFeeBreakdown(settlement.grossAmount, { room: { settlementQuote: settlement, patronFundSubsidy: settlement.patronFundSubsidy } }) : ""}${rankingCopy}${patronHonor}${renderOshijoSharePanel(room, role, status)}${renderOshijoRestartPanel(room, role, status)}${renderMarketRelationshipPanel(room, role, status)}<div><button class="button button-primary" id="marketPlayAgain">もう一度参加</button>${status === "sold" ? `<button class="button button-cyan" id="marketResultCertificates">${role === "buyer" ? "今回の証書を見る" : "証書コレクション"}</button>` : ""}<button class="button button-ghost" id="marketResultRanking">ランキングを見る</button><button class="button button-ghost" id="marketReturnHome">トップへ戻る</button></div></div>`;
  }
  if (status === "preview") {
    if (role === "buyer") {
      const oshijoNotice = marketShopSupportsOshijo(room.sellerShop)
        ? `<aside class="market-oshijo-notice"><span>熱血お嬢スタイルの店主</span><strong>推し嬢モードの事前案内</strong><p>推し嬢＝筋と人情で背中を押す熱血お嬢スタイル。この店主は通常価格とは別に、営業後に自由な金額を請求できます。請求時は先に警告画面が開き、営業を聞かず見送るか、最大3手の本気商談を聞くかを選べます。推し嬢モードでは追加検討は使えず、購入か見送りを最終的に選びます。購入は任意で、自動購入や時間切れ購入はありません。</p></aside>`
        : "";
      return `<div class="market-decision-panel">
        <span>FREE PREVIEW</span>
        <h2>この画像の営業を受けますか？</h2>
        <p>受けると着手料として${formatAnjuPay(room.entryFee || ENTRY_FEE)}をAnjuPay残高から保留し、営業完了時に売り手へ移します。画像確認だけなら無料です。</p>
        ${oshijoNotice}
        <div><button class="button button-primary" data-market-action="accept_pitch" ${!state.remoteImage || state.busy ? "disabled" : ""}>${formatAnjuPay(room.entryFee || ENTRY_FEE)}で営業を受ける</button><button class="button button-ghost" data-market-action="decline_preview" ${state.busy ? "disabled" : ""}>営業を受けず退室</button></div>
      </div>`;
    }
    return `<div class="market-wait-panel"><span>BUYER PREVIEW</span><h2>買い手が画像を確認中です</h2><p>営業を受けるまでは着手料は発生しません。</p></div>`;
  }
  if (status === "pitch") {
    if (role === "seller") {
      const sent = state.pitchSentTurns.has(Number(room.turn || 1));
      const supportsOshijo = marketShopSupportsOshijo(room.sellerShop);
      const claimDefault = state.oshijoClaimDraft
        || String(Math.max(1, Number(room.listing?.askingPrice || state.askingPrice || 1)));
      const completionActions = supportsOshijo
        ? `<div class="market-pitch-completion-actions">
          <button class="button button-primary" data-market-action="pitch_complete" ${!sent || state.busy ? "disabled" : ""}>通常営業を完了</button>
          <button type="button" class="button market-oshijo-trigger" id="marketOshijoClaimToggle" aria-expanded="${state.oshijoClaimOpen}" aria-controls="marketOshijoClaimForm" ${!sent || state.busy ? "disabled" : ""}>推し嬢モードの請求額を決める</button>
        </div>
        <form id="marketOshijoClaimForm" class="market-oshijo-claim-form" ${state.oshijoClaimOpen ? "" : "hidden"}>
          <div><label for="marketOshijoClaimAmount">自由請求額</label><span><input id="marketOshijoClaimAmount" type="number" inputmode="numeric" min="1" max="${OSHIJO_MAX_CLAIM_AMOUNT}" step="1" value="${escapeHtml(claimDefault)}" ${state.busy ? "disabled" : ""} /><b>Pay</b></span></div>
          <p>相手の残高は見えません。相手が請求額を持っていない場合でも、明示的にオールインへ同意すれば、その時点の全残高が実支払額になります。ランキング加算は最大${formatAnjuPay(OSHIJO_RANKING_CAP)}です。</p>
          <label class="market-oshijo-seller-consent"><input id="marketOshijoAllInConsent" type="checkbox" ${state.busy ? "disabled" : ""} /><span>請求額未満のオールイン成約では、実支払額を最終成約額として受け入れます。</span></label>
          <button class="button market-oshijo-trigger" ${state.busy ? "disabled" : ""}>この金額で警告画面を送る</button>
        </form>`
        : `<button class="button button-primary market-complete-pitch" data-market-action="pitch_complete" ${!sent || state.busy ? "disabled" : ""}>通常営業を完了</button>`;
      return `<div class="market-pitch-panel">
        <span>SALES TURN ${Number(room.turn || 1)} / ${room.maxTurns || MAX_TURNS}</span><h2>画像の魅力を営業する</h2>
        <form id="marketChatForm"><textarea id="marketChatInput" maxlength="240" placeholder="この画像だからこそ伝わる魅力を240文字以内で…" ${state.busy ? "disabled" : ""}></textarea><button class="button button-cyan" ${state.busy ? "disabled" : ""}>チャットを送る</button></form>
        <div class="market-audio-pitch"><label class="button button-ghost">10秒音声を送る<input id="marketAudioInput" type="file" accept="audio/*" ${state.busy || !state.channelReady ? "disabled" : ""} /></label><small>トップページの10秒音声メーカーで作成したWAVも使えます。</small></div>
        ${completionActions}
      </div>`;
    }
    const decisionNotice = marketShopSupportsOshijo(room.sellerShop)
      ? "この店主は営業後に自由請求を提示する場合があります。提示された場合は、警告画面で見送るか、本気商談を聞くかを先に選べます。"
      : "営業完了後に、購入・退室・追加検討を選択できます。";
    return `<div class="market-wait-panel"><span>SALES TURN ${Number(room.turn || 1)}</span><h2>売り手の営業を受けています</h2><p>${decisionNotice}</p></div>`;
  }
  if (status === "oshijo_warning") return renderOshijoWarning(room, role);
  if (status === "oshijo_closing") return renderOshijoClosingRound(room, role);
  if (status === "decision") {
    const oshijoClosing = isOshijoClosing(room);
    if (role === "buyer") {
      if (oshijoClosing) {
        return renderOshijoFinalDecision(room, role);
      }
      const canExtend = Number(room.turn || 1) < Number(room.maxTurns || MAX_TURNS);
      return `<div class="market-decision-panel"><span>VALUE DECISION</span><h2>この推し値で購入しますか？</h2><p>購入はロールプレイで、画像データの所有権は移りません。成約手数料は売り手負担のため、買い手の支払額は販売価格のままです。</p>${renderMarketFeeBreakdown(room.listing?.askingPrice, { room })}<small class="market-opportunity-cost">${escapeHtml(purchaseBalanceCopy(room.listing?.askingPrice))}</small><div><button class="button button-primary" data-market-action="buy" ${state.busy ? "disabled" : ""}>合計${formatAnjuPay(room.listing?.askingPrice)}で購入</button>${canExtend ? `<button class="button button-cyan" data-market-action="request_extension" ${state.busy ? "disabled" : ""}>もう1ターン検討</button>` : ""}<button class="button button-ghost" data-market-action="leave" ${state.busy ? "disabled" : ""}>今回は見送る</button></div></div>`;
    }
    if (oshijoClosing) return renderOshijoFinalDecision(room, role);
    return `<div class="market-wait-panel"><span>BUYER DECISION</span><h2>買い手の判断を待っています</h2><p>購入・退室・追加検討のいずれかが選ばれます。購入成立時だけ成約手数料が差し引かれます。</p>${renderMarketFeeBreakdown(room.listing?.askingPrice, { room, compact: true })}</div>`;
  }
  if (status === "extension_request") {
    if (role === "seller") {
      return `<div class="market-extension-panel"><span>ANOTHER TURN REQUEST</span><h2>追加営業の内金を提示</h2><p>内金分のAnjuPayを残高から保留し、買い手へ提示します。買い手が受け取ると次ターンへ進みます。</p><div><select id="marketExtensionIncentive"><option value="5">${formatAnjuPay(5)}</option><option value="10">${formatAnjuPay(10)}</option><option value="20">${formatAnjuPay(20)}</option></select><button class="button button-primary" id="marketOfferExtension" ${state.busy ? "disabled" : ""}>内金を提示する</button><button class="button button-ghost" data-market-action="cancel" ${state.busy ? "disabled" : ""}>取引を終了</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>EXTENSION REQUESTED</span><h2>売り手が内金を検討中です</h2><p>提示された内金を受け取るか選択できます。</p></div>`;
  }
  if (status === "extension_offer") {
    if (role === "buyer") {
      return `<div class="market-decision-panel"><span>EXTENSION OFFER</span><h2>${formatAnjuPay(room.extensionIncentive)}を受け取り、次の営業へ？</h2><p>承諾すると保留中のAnjuPayが売り手から買い手へ移動し、ターン${Number(room.turn || 1) + 1}へ進みます。</p><div><button class="button button-primary" data-market-action="accept_extension" ${state.busy ? "disabled" : ""}>${formatAnjuPay(room.extensionIncentive)}を受け取り続行</button><button class="button button-ghost" data-market-action="decline_extension" ${state.busy ? "disabled" : ""}>受け取らず退室</button></div></div>`;
    }
    return `<div class="market-wait-panel"><span>EXTENSION OFFERED</span><h2>買い手の返答を待っています</h2><p>${formatAnjuPay(room.extensionIncentive)}の内金を提示中です。</p></div>`;
  }
  return `<div class="market-wait-panel"><h2>市場の状態を同期しています</h2></div>`;
}

function renderRoom() {
  if (!state.room) return `<section class="screen market-screen market-waiting"><div class="market-waiting-card"><div class="loader"></div><h1>市場ルームを準備しています</h1></div></section>`;
  const room = state.room;
  const role = roomRole();
  const oshijoPhase = normalizeOshijoPhase(room);
  const suppressBuyerDecisionInfluence = role === "buyer"
    && ["warning", "closing", "final"].includes(oshijoPhase);
  const counterpart = role === "seller" ? room.buyerName : room.sellerName;
  const counterpartPatron = role === "seller" ? room.buyerPatron : room.sellerPatron;
  ensureRelationshipFeedback(room);
  const normalizedSellerShop = normalizeMarketShop(room.sellerShop);
  const localFavorite = favoriteForSeller(normalizedSellerShop.publicSellerId);
  const sellerShopCard = renderSellerShopCard(room.sellerShop, {
    sellerName: room.sellerName,
    heading: role === "seller" ? "YOUR SHOP" : "SELLER OWNER CARD",
    relationship: role === "buyer"
      ? { ...normalizedSellerShop.relationship, isFavorite: Boolean(localFavorite) }
      : false,
  });
  const patronHonor = suppressBuyerDecisionInfluence
    ? ""
    : renderOshijoPatronHonor(
      room.oshijoPatron
        || room.oshijoPatronHonor
        || room.patronHonor
        || room.sellerShop?.oshijoPatron,
      { compact: true },
    );
  const roomPrice = isOshijoClosing(room) && oshijoPhase
    ? normalizeOshijoDeal(room).claimAmount
    : room.listing?.askingPrice;
  const salesLog = role === "buyer" && oshijoPhase === "final"
    ? `<section class="market-sales-log market-sales-log-quiet" aria-label="営業入力停止"><div class="market-sales-log-head"><span>QUIET DECISION</span><strong>営業ログを閉じました</strong></div><div><strong>新しい営業は届きません</strong><p>文字・画像・音声から離れて、支払内容だけを確認できます。</p></div></section>`
    : `<section class="market-sales-log"><div class="market-sales-log-head"><span>SALES LOG</span><strong>営業メッセージ</strong></div><ol id="marketMessageList">${renderMarketMessages()}</ol></section>`;
  return `<section class="screen market-screen market-room">
    <div class="market-room-head"><div><span class="eyebrow">VALUE MARKET / TURN ${Number(room.turn || 1)}</span><h1>${escapeHtml(room.listing?.title || "無題の推し")}</h1><p>${role === "seller" ? "SELLER" : "BUYER"} / 相手：${escapeHtml(counterpart)} ${suppressBuyerDecisionInfluence ? "" : renderMarketPatronBadge(counterpartPatron, { compact: true })}</p></div>${renderWallet({ showPatron: !suppressBuyerDecisionInfluence })}</div>
    <div class="market-room-status"><span class="market-price">${formatAnjuPayNumber(roomPrice)} <small>${isOshijoClosing(room) && oshijoPhase ? "請求 Pay" : ANJU_PAY_UNIT}</small></span><span class="market-p2p ${state.channelReady ? "is-connected" : ""}">${escapeHtml(state.peerStatus)}</span><button type="button" id="marketExitRoom">取引を終了</button></div>
    ${sellerShopCard}
    ${patronHonor}
    <div class="market-room-grid">
      <figure class="market-main-image">${renderMarketImage()}<figcaption>画像はこの対戦中だけP2Pで表示されます</figcaption></figure>
      ${salesLog}
    </div>
    ${renderRoomControls(room, role)}
  </section>`;
}

function renderError() {
  const inRoom = Boolean(state.roomId);
  return `<section class="screen market-screen market-error"><div><span class="eyebrow">VALUE MARKET ERROR</span><h1>${inRoom ? "取引を継続できません" : "市場へ接続できませんでした"}</h1><p>${escapeHtml(state.errorMessage || "通信処理に失敗しました。")}</p><button class="button button-primary" id="marketErrorBack">${inRoom ? "取引を終了して戻る" : "トップへ戻る"}</button></div></section>`;
}

function bindEvents() {
  document.querySelectorAll("[data-market-role]").forEach((button) => button.addEventListener("click", () => {
    if (state.busy || state.shopBusy || state.queueJoinPending) return;
    state.role = button.dataset.marketRole;
    normalizeBuyerBudget();
    localStorage.setItem(MARKET_ROLE_KEY, state.role);
    render();
  }));
  document.querySelector("#marketEntryForm")?.addEventListener("submit", joinQueue);
  document.querySelector("#marketSetupOptionsButton")?.addEventListener("click", () => {
    const target = state.role === "seller"
      ? document.querySelector("#marketShopForm")
      : document.querySelector("#marketFavoritesTitle");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      if (state.role === "seller") document.querySelector("#marketShopName")?.focus({ preventScroll: true });
      else document.querySelector('input[name="marketMatchMode"]')?.focus({ preventScroll: true });
    });
  });
  document.querySelector("#marketName")?.addEventListener("input", (event) => { state.name = event.target.value.slice(0, 16); });
  document.querySelector("#marketShopForm")?.addEventListener("submit", saveMarketShop);
  document.querySelector("#marketShopName")?.addEventListener("input", (event) => {
    state.shop.shopName = event.target.value.slice(0, MARKET_SHOP_NAME_MAX_LENGTH);
  });
  document.querySelector("#marketShopTagline")?.addEventListener("input", (event) => {
    state.shop.tagline = event.target.value.slice(0, MARKET_SHOP_TAGLINE_MAX_LENGTH);
  });
  document.querySelectorAll('input[name="marketShopSpecialty"]').forEach((input) => {
    input.addEventListener("change", () => updateMarketShopMultiChoice(
      "specialtyTags",
      "marketShopSpecialty",
      MARKET_SHOP_MAX_SPECIALTY_TAGS,
      input,
    ));
  });
  document.querySelectorAll('input[name="marketShopServiceStyle"]').forEach((input) => {
    input.addEventListener("change", () => updateMarketShopMultiChoice(
      "serviceStyles",
      "marketShopServiceStyle",
      MARKET_SHOP_MAX_SERVICE_STYLES,
      input,
    ));
  });
  document.querySelector("#marketShopTheme")?.addEventListener("change", (event) => { state.shop.themeId = normalizeShopOptionId(event.target.value) || "standard"; });
  document.querySelector("#marketShopSeal")?.addEventListener("change", (event) => { state.shop.sealId = normalizeShopOptionId(event.target.value) || "heart"; });
  document.querySelector("#marketShopTitle")?.addEventListener("change", (event) => { state.shop.titleId = normalizeShopOptionId(event.target.value); });
  document.querySelectorAll('input[name="marketShopCharm"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.shop.shopCharmId = normalizeShopOptionId(input.value);
      render();
    });
  });
  document.querySelector("#marketShopRepeatWelcome")?.addEventListener("change", (event) => { state.shop.repeatWelcome = event.target.checked; });
  document.querySelectorAll('input[name="marketMatchMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (state.busy || state.shopBusy || state.queueJoinPending) return;
      const selectedFavorite = reconcileSelectedFavoriteSeller();
      state.matchMode = input.value === "favorites" && selectedFavorite ? "favorites" : "discover";
      state.preferredRecommendedSellerId = "";
      render();
      focusMarketJoinButton();
    });
  });
  document.querySelectorAll('input[name="marketFavoriteSeller"]').forEach((input) => {
    input.addEventListener("click", () => {
      if (state.busy || state.shopBusy || state.queueJoinPending) return;
      const selectedFavorite = matchableMarketFavorite(input.value);
      if (!selectedFavorite) return;
      state.selectedFavoriteSellerId = selectedFavorite.publicSellerId;
      state.matchMode = "favorites";
      state.preferredRecommendedSellerId = "";
      const budgetAlignment = alignBudgetToMarketFavorite(selectedFavorite, { announce: true });
      if (!budgetAlignment.ok) {
        showToast(`前回価格で待つには、あと${formatAnjuPay(budgetAlignment.shortage)}が必要です。`);
      }
      render();
      focusMarketJoinButton();
    });
  });
  document.querySelectorAll("[data-market-remove-favorite]").forEach((button) => {
    button.addEventListener("click", () => removeMarketFavorite(button.dataset.marketRemoveFavorite));
  });
  document.querySelectorAll("[data-market-recommend-shop]").forEach((button) => {
    button.addEventListener("click", () => setMarketShopRecommendation(
      button.dataset.marketRecommendShop,
      button.dataset.marketRecommendAction !== "remove",
    ));
  });
  document.querySelectorAll("[data-market-prefer-recommended]").forEach((button) => {
    button.addEventListener("click", () => setRecommendedShopPreference(
      button.dataset.marketPreferRecommended,
    ));
  });
  document.querySelector("#marketListingTitle")?.addEventListener("input", (event) => { state.listingTitle = event.target.value.slice(0, 30); });
  document.querySelector("#marketAskingPrice")?.addEventListener("change", (event) => {
    state.askingPrice = Number(event.target.value);
    const breakdown = document.querySelector("#marketSetupFeeBreakdown");
    if (breakdown) breakdown.outerHTML = renderMarketFeeBreakdown(state.askingPrice, { id: "marketSetupFeeBreakdown", compact: true });
  });
  document.querySelector("#marketPitchStyle")?.addEventListener("change", (event) => { state.pitchStyle = event.target.value; });
  document.querySelector("#marketMaxBudget")?.addEventListener("change", (event) => { state.maxBudget = Number(event.target.value); });
  document.querySelector("#marketImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#marketRankingsButton")?.addEventListener("click", () => openRankings("setup"));
  document.querySelector("#marketCertificatesButton")?.addEventListener("click", () => openCertificates("setup"));
  document.querySelectorAll("[data-market-preview-room]").forEach((button) => button.addEventListener("click", () => {
    const [status, role, closingMode] = button.dataset.marketPreviewRoom.split(":");
    previewRoom(status, role, closingMode);
  }));
  document.querySelector("#marketRankingBack")?.addEventListener("click", returnFromRankings);
  document.querySelectorAll("[data-market-ranking-period]").forEach((button) => {
    button.addEventListener("click", () => selectMarketRankingPeriod(button.dataset.marketRankingPeriod));
  });
  document.querySelector("#marketCertificatesBack")?.addEventListener("click", returnFromCertificates);
  document.querySelector("#marketCertificatesRetry")?.addEventListener("click", () => openCertificates(state.certificateReturnScreen, { force: true }));
  document.querySelector(".market-profile-settings")?.addEventListener("toggle", (event) => {
    state.rankingProfileOpen = event.currentTarget.open;
  });
  document.querySelector("#marketRankingProfileForm")?.addEventListener("submit", saveMarketRankingPublicProfile);
  document.querySelector("#marketRankingXHandle")?.addEventListener("input", updateMarketXHandleInput);
  document.querySelector("#marketRankingTagline")?.addEventListener("input", updateMarketProfilePreview);
  for (const id of ["marketRankingXPublic", "marketRankingTaglinePublic"]) {
    document.getElementById(id)?.addEventListener("change", updateMarketProfilePreview);
  }
  document.querySelector("#marketCancelQueueButton")?.addEventListener("click", () => cancelQueue());
  document.querySelector("#marketExitRoom")?.addEventListener("click", requestHome);
  document.querySelector("#marketChatForm")?.addEventListener("submit", sendChatPitch);
  document.querySelector("#marketAudioInput")?.addEventListener("change", sendAudioPitch);
  document.querySelector("#marketOshijoClaimToggle")?.addEventListener("click", () => {
    state.oshijoClaimOpen = !state.oshijoClaimOpen;
    render();
    if (state.oshijoClaimOpen) document.querySelector("#marketOshijoClaimAmount")?.focus({ preventScroll: true });
  });
  document.querySelector("#marketOshijoClaimAmount")?.addEventListener("input", (event) => {
    state.oshijoClaimDraft = String(event.currentTarget.value || "").replace(/[^\d]/g, "").slice(0, 6);
  });
  document.querySelector("#marketOshijoClaimForm")?.addEventListener("submit", submitOshijoClaim);
  document.querySelector("#marketOshijoClosingTextForm")?.addEventListener("submit", sendOshijoClosingText);
  document.querySelector("#marketOshijoClosingImageInput")?.addEventListener("change", sendOshijoClosingImage);
  document.querySelector("#marketOshijoClosingAudioInput")?.addEventListener("change", sendOshijoClosingAudio);
  document.querySelector("#marketOshijoAudioMute")?.addEventListener("click", () => {
    state.oshijoAudioMuted = !state.oshijoAudioMuted;
    document.querySelectorAll('audio[data-market-oshijo-audio="true"]').forEach((audio) => {
      audio.muted = state.oshijoAudioMuted;
    });
    render();
  });
  document.querySelectorAll("[data-market-oshijo-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const confirmation = document.getElementById(button.getAttribute("aria-controls"));
      if (!confirmation) return;
      const expanding = confirmation.hidden;
      confirmation.hidden = !expanding;
      button.setAttribute("aria-expanded", String(expanding));
    });
  });
  document.querySelectorAll("[data-market-action]").forEach((button) => button.addEventListener("click", () => {
    const closingMode = button.dataset.marketClosingMode === OSHIJO_CLOSING_MODE ? OSHIJO_CLOSING_MODE : "";
    if (closingMode) return performAction(button.dataset.marketAction, { closingMode });
    return performAction(button.dataset.marketAction);
  }));
  document.querySelector("#marketOfferExtension")?.addEventListener("click", () => performAction("offer_extension", { incentive: Number(document.querySelector("#marketExtensionIncentive")?.value || 5) }));
  document.querySelector("#marketPlayAgain")?.addEventListener("click", resetForReplay);
  document.querySelector("#marketResultRanking")?.addEventListener("click", () => openRankings("room"));
  document.querySelector("#marketResultCertificates")?.addEventListener("click", () => openCertificates("room", { force: true }));
  document.querySelector("#marketRelationshipForm")?.addEventListener("submit", saveMarketRelationship);
  document.querySelectorAll('input[name="marketImpressionTag"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.relationshipFeedback.impressionTag = normalizeShopOptionId(input.value);
    });
  });
  document.querySelector("#marketRelationshipFavorite")?.addEventListener("change", (event) => {
    state.relationshipFeedback.favorite = event.currentTarget.checked === true;
  });
  document.querySelectorAll('input[name="marketOshijoShareChoice"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.oshijoShareChoice = input.value;
      render();
    });
  });
  document.querySelector("#marketOshijoCopyShare")?.addEventListener("click", copyOshijoShareText);
  document.querySelector("#marketRestartAsSeller")?.addEventListener("click", restartMarketAsSeller);
  document.querySelector("#marketRestartHome")?.addEventListener("click", returnHome);
  document.querySelector("[data-market-block-counterparty]")?.addEventListener("click", (event) => {
    setMarketCounterpartyBlocked(event.currentTarget.dataset.marketBlockCounterparty !== "false");
  });
  document.querySelector("#marketReturnHome")?.addEventListener("click", returnHome);
  document.querySelector("#marketErrorBack")?.addEventListener("click", requestHome);
}

function updateMarketShopMultiChoice(key, inputName, maximum, changedInput) {
  let selected = [...document.querySelectorAll(`input[name="${inputName}"]:checked`)]
    .map((input) => normalizeShopOptionId(input.value))
    .filter(Boolean);
  if (selected.length > maximum) {
    changedInput.checked = false;
    selected = selected.filter((id) => id !== changedInput.value);
    showToast(`最大${maximum}個まで選べます。`);
  }
  state.shop[key] = selected.slice(0, maximum);
}

function readMarketShopForm() {
  const ownedTitles = new Set(state.ownedTitleIds);
  const ownedShopCharms = new Set(state.ownedShopCharmIds);
  const requestedTitleId = normalizeShopOptionId(document.querySelector("#marketShopTitle")?.value);
  const requestedShopCharmId = normalizeShopOptionId(
    document.querySelector('input[name="marketShopCharm"]:checked')?.value,
  );
  return normalizeMarketShop({
    ...state.shop,
    shopName: document.querySelector("#marketShopName")?.value,
    tagline: document.querySelector("#marketShopTagline")?.value,
    specialtyTags: [...document.querySelectorAll('input[name="marketShopSpecialty"]:checked')].map((input) => input.value),
    serviceStyles: [...document.querySelectorAll('input[name="marketShopServiceStyle"]:checked')].map((input) => input.value),
    themeId: document.querySelector("#marketShopTheme")?.value,
    sealId: document.querySelector("#marketShopSeal")?.value,
    titleId: requestedTitleId && ownedTitles.has(requestedTitleId) ? requestedTitleId : "",
    shopCharmId: requestedShopCharmId && ownedShopCharms.has(requestedShopCharmId)
      ? requestedShopCharmId
      : "",
    repeatWelcome: document.querySelector("#marketShopRepeatWelcome")?.checked === true,
  });
}

async function saveMarketShop(event) {
  event.preventDefault();
  if (state.busy || state.shopBusy || state.queueJoinPending || !state.authReady) return;
  const shop = readMarketShopForm();
  if (!shop.shopName) {
    document.querySelector("#marketShopName")?.focus();
    showToast("推し値商店の店名を入力してください。");
    return;
  }
  if (/https?:\/\/|www\./i.test(`${shop.shopName} ${shop.tagline}`)) {
    (/https?:\/\/|www\./i.test(shop.shopName)
      ? document.querySelector("#marketShopName")
      : document.querySelector("#marketShopTagline"))?.focus();
    showToast("店名と商店の理念にURLは使用できません。");
    return;
  }
  const generation = lifecycleGeneration;
  state.shop = shop;
  state.shopBusy = true;
  state.shopStatus = "saving";
  state.shopErrorMessage = "";
  render();
  try {
    if (useMarketPreview) {
      state.shop = normalizeMarketShop({ ...shop, verified: state.shopReport });
      state.shopStatus = "ready";
      state.shopErrorMessage = "";
    } else {
      const response = await marketShopCallable({ action: "save", shop, ...shop });
      if (!isCurrentLifecycle(generation)) return;
      state.shop = normalizeMarketShop(response.data?.shop || shop);
      if (response.data?.report) state.shopReport = normalizeSellerVerified(response.data.report);
      if (response.data?.ownedTitleIds || response.data?.ownedTitles) {
        state.ownedTitleIds = normalizeOwnedTitleIds(response.data.ownedTitleIds || response.data.ownedTitles);
      }
      if (response.data?.ownedShopCharmIds || response.data?.ownedCharmIds) {
        state.ownedShopCharmIds = normalizeOwnedShopCharmIds(
          [
            ...FREE_MARKET_SHOP_CHARM_IDS,
            ...normalizeShopIdList(response.data.ownedShopCharmIds || response.data.ownedCharmIds),
          ],
        );
      }
      state.shopStatus = "ready";
      state.shopErrorMessage = "";
    }
    if (isCurrentLifecycle(generation)) showToast("推し値商店の店主カードを保存しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) {
      state.shopStatus = "save-error";
      state.shopErrorMessage = callableMessage(error, "推し値商店を保存できませんでした。");
      showToast(state.shopErrorMessage);
    }
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.shopBusy = false;
      render();
    }
  }
}

async function removeMarketFavorite(publicSellerId) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  if (!sellerId || state.busy || state.shopBusy || state.queueJoinPending) return;
  const generation = lifecycleGeneration;
  state.shopBusy = true;
  render();
  try {
    if (useMarketPreview) {
      state.favorites = state.favorites.filter((favorite) => favorite.publicSellerId !== sellerId);
    } else {
      const response = await marketShopCallable({ action: "remove_favorite", publicSellerId: sellerId });
      if (!isCurrentLifecycle(generation)) return;
      state.favorites = Array.isArray(response.data?.favorites) || (response.data?.favorites && typeof response.data.favorites === "object")
        ? normalizeMarketFavorites(response.data.favorites)
        : state.favorites.filter((favorite) => favorite.publicSellerId !== sellerId);
    }
    reconcileSelectedFavoriteSeller();
    if (isCurrentLifecycle(generation)) showToast("常連帳から解除しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "常連帳から解除できませんでした。"));
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.shopBusy = false;
      render();
    }
  }
}

async function setMarketShopRecommendation(publicSellerId, recommend = true) {
  const sellerId = normalizeShopText(publicSellerId, 96);
  const currentlyRecommended = Boolean(recommendationForSeller(sellerId));
  const requestedRecommendation = recommend === true;
  if (!sellerId
      || state.recommendationBusySellerId
      || state.busy
      || state.shopBusy
      || state.queueJoinPending
      || currentlyRecommended === requestedRecommendation) return;
  if (requestedRecommendation
      && (!state.patronImpact.recommendationLimit
        || state.patronImpact.recommendedShopCount >= state.patronImpact.recommendationLimit)) {
    showToast("今月の商店推薦枠を使い切っています。");
    return;
  }
  const generation = lifecycleGeneration;
  const snapshot = recommendationShopSnapshot(sellerId);
  state.recommendationBusySellerId = sellerId;
  render();
  try {
    let responseData = {};
    if (!useMarketPreview) {
      const response = await marketShopCallable({
        action: requestedRecommendation ? "recommend_shop" : "remove_recommendation",
        publicSellerId: sellerId,
      });
      if (!isCurrentLifecycle(generation)) return;
      responseData = response.data && typeof response.data === "object" ? response.data : {};
    }
    const returnedRecommendations = Object.prototype.hasOwnProperty.call(responseData, "recommendations");
    const returnedImpact = Object.prototype.hasOwnProperty.call(responseData, "patronImpact");
    applyMarketPatronExperience(responseData);
    if (!returnedRecommendations) {
      state.recommendations = requestedRecommendation
        ? [
          normalizeMarketRecommendation({
            publicSellerId: sellerId,
            shop: snapshot || { publicSellerId: sellerId },
            recommendedAt: Date.now(),
          }),
          ...state.recommendations.filter((entry) => entry.publicSellerId !== sellerId),
        ].filter(Boolean)
        : state.recommendations.filter((entry) => entry.publicSellerId !== sellerId);
    }
    if (!returnedImpact) {
      state.patronImpact = {
        ...state.patronImpact,
        recommendedShopCount: Math.min(
          state.patronImpact.recommendationLimit || 100,
          state.recommendations.length,
        ),
      };
    }
    showToast(requestedRecommendation
      ? "この商店を推薦商店の発見棚へ推薦しました。Payの配分は変わりません。"
      : "商店の推薦を解除しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) {
      showToast(callableMessage(
        error,
        requestedRecommendation ? "商店を推薦できませんでした。" : "商店の推薦を解除できませんでした。",
      ));
    }
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.recommendationBusySellerId = "";
      render();
    }
  }
}

function upsertMarketFavorite(value, fallbackShop = null) {
  const room = state.room;
  const favorite = normalizeMarketFavorite(
    value && typeof value === "object"
      ? value
      : {
        ...(fallbackShop || room?.sellerShop || {}),
        lastPurchasePrice: Number(room?.salePrice || room?.listing?.askingPrice || 0),
        favoritedAt: Date.now(),
      },
  );
  if (!favorite) return;
  state.favorites = [
    favorite,
    ...state.favorites.filter((entry) => entry.publicSellerId !== favorite.publicSellerId),
  ];
  reconcileSelectedFavoriteSeller();
}

function removeRoomSellerFromFavorites() {
  const sellerId = normalizeMarketShop(state.room?.sellerShop).publicSellerId;
  if (!sellerId) return;
  state.favorites = state.favorites.filter((favorite) => favorite.publicSellerId !== sellerId);
  reconcileSelectedFavoriteSeller();
}

async function saveMarketRelationship(event) {
  event.preventDefault();
  ensureRelationshipFeedback();
  if (!state.roomId || state.relationshipFeedback.busy || roomRole() !== "buyer") return;
  const impressionTag = normalizeShopOptionId(
    document.querySelector('input[name="marketImpressionTag"]:checked')?.value,
  );
  if (!impressionTag) {
    showToast("店主へ届ける印象を1つ選んでください。");
    return;
  }
  const favorite = document.querySelector("#marketRelationshipFavorite")?.checked === true;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  state.relationshipFeedback.impressionTag = impressionTag;
  state.relationshipFeedback.favorite = favorite;
  state.relationshipFeedback.busy = true;
  render();
  try {
    let responseData = {
      shop: state.room?.sellerShop,
      favorite,
      impressionRecorded: true,
      impressionTag,
      alreadyRecorded: false,
    };
    if (!useMarketPreview) {
      const response = await marketShopCallable({
        action: "relationship",
        roomId,
        impressionTag,
        favorite,
      });
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      responseData = response.data || responseData;
    }
    const returnedShop = responseData.sellerShop || responseData.shop;
    if (returnedShop && state.room) {
      const relationship = normalizeMarketShop(state.room.sellerShop).relationship;
      state.room.sellerShop = { ...returnedShop, relationship };
    }
    const favoriteResult = responseData.favorite;
    const effectiveFavorite = favoriteResult === true
      || Boolean(favoriteResult && typeof favoriteResult === "object")
      || (favoriteResult === undefined && favorite);
    if (!effectiveFavorite) {
      removeRoomSellerFromFavorites();
    } else {
      upsertMarketFavorite(
        favoriteResult && typeof favoriteResult === "object" ? favoriteResult : null,
        returnedShop || state.room?.sellerShop,
      );
    }
    const returnedImpressionTag = normalizeShopOptionId(responseData.impressionTag);
    const alreadyRecorded = responseData.alreadyRecorded === true;
    state.relationshipFeedback.impressionTag = returnedImpressionTag;
    state.relationshipFeedback.alreadyRecorded = alreadyRecorded;
    state.relationshipFeedback.favorite = effectiveFavorite;
    state.relationshipFeedback.favoritePersisted = effectiveFavorite;
    state.relationshipFeedback.submitted = alreadyRecorded
      || (responseData.impressionRecorded !== false
        && (Boolean(returnedImpressionTag) || responseData.impressionRecorded === true));
    showToast(alreadyRecorded
      ? `以前届けた印象は変更せず、${effectiveFavorite ? "常連設定を保存しました。" : "常連設定を解除しました。"}`
      : effectiveFavorite
        ? "印象と「また買いたい」を保存しました。"
        : "店主へ印象を届けました。");
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(callableMessage(error, "店主への印象を保存できませんでした。"));
    }
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.relationshipFeedback.busy = false;
      render();
    }
  }
}

async function setMarketCounterpartyBlocked(blockValue = true) {
  ensureRelationshipFeedback();
  const blockRequested = blockValue !== false;
  if (
    !state.roomId
    || state.relationshipFeedback.busy
    || state.relationshipFeedback.blocked === blockRequested
  ) return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const buyerRole = roomRole() === "buyer";
  const roomSellerId = normalizeMarketShop(state.room?.sellerShop).publicSellerId;
  if (blockRequested && buyerRole) {
    state.relationshipFeedback.favoriteBeforeBlock = state.relationshipFeedback.favoritePersisted
      || Boolean(favoriteForSeller(roomSellerId));
  }
  const restoreFavorite = !blockRequested
    && buyerRole
    && state.relationshipFeedback.favoriteBeforeBlock;
  state.relationshipFeedback.busy = true;
  render();
  try {
    let responseData = {
      blocked: blockRequested,
      favorite: restoreFavorite,
      sellerShop: state.room?.sellerShop,
    };
    if (!useMarketPreview) {
      const relationshipRequest = { action: "relationship", roomId, block: blockRequested };
      if (restoreFavorite) relationshipRequest.favorite = true;
      const response = await marketShopCallable(relationshipRequest);
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      responseData = response.data || responseData;
    }
    const blocked = responseData.blocked === true;
    const returnedShop = responseData.sellerShop || responseData.shop;
    if (returnedShop && state.room) {
      const relationship = normalizeMarketShop(state.room.sellerShop).relationship;
      state.room.sellerShop = { ...returnedShop, relationship };
    }
    state.relationshipFeedback.blocked = blocked;
    if (blocked && buyerRole) {
      removeRoomSellerFromFavorites();
      state.relationshipFeedback.favorite = false;
      state.relationshipFeedback.favoritePersisted = false;
    } else if (!blocked && restoreFavorite) {
      const favoriteResult = responseData.favorite;
      const favoriteRestored = favoriteResult !== false;
      if (favoriteRestored) {
        upsertMarketFavorite(
          favoriteResult && typeof favoriteResult === "object" ? favoriteResult : null,
          returnedShop || state.room?.sellerShop,
        );
      }
      state.relationshipFeedback.favorite = favoriteRestored;
      state.relationshipFeedback.favoritePersisted = favoriteRestored;
      if (favoriteRestored) state.relationshipFeedback.favoriteBeforeBlock = false;
    } else if (!blocked) {
      state.relationshipFeedback.favoriteBeforeBlock = false;
    }
    showToast(blocked
      ? "この相手をブロックしました。今後の市場マッチングから除外されます。"
      : "ブロックを解除しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(callableMessage(
        error,
        blockRequested ? "この相手をブロックできませんでした。" : "ブロックを解除できませんでした。",
      ));
    }
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.relationshipFeedback.busy = false;
      render();
    }
  }
}

async function handleImageInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const generation = lifecycleGeneration;
  state.busy = true;
  render();
  let processedImage = null;
  try {
    releaseLocalImage();
    processedImage = await shared().processImageFile(file, 0, { maxSide: 1600 });
    if (!isCurrentLifecycle(generation)) {
      if (processedImage?.url) URL.revokeObjectURL(processedImage.url);
      return;
    }
    state.image = processedImage;
    state.imageSent = false;
    showToast("市場用の画像を準備しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(error.message || "画像を準備できませんでした。");
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      render();
    }
  }
}

async function joinQueue(event) {
  event.preventDefault();
  if (!state.authReady || state.busy || state.shopBusy || state.queueJoinPending) return;
  const generation = lifecycleGeneration;
  const queueAttemptGeneration = beginQueueAttempt();
  const joinedRole = state.role;
  state.name = normalizeMarketName(document.querySelector("#marketName")?.value || state.name);
  if (joinedRole === "seller") {
    state.listingTitle = String(document.querySelector("#marketListingTitle")?.value || state.listingTitle).trim().slice(0, 30);
    state.askingPrice = Number(document.querySelector("#marketAskingPrice")?.value || state.askingPrice);
    state.pitchStyle = document.querySelector("#marketPitchStyle")?.value || state.pitchStyle;
  } else {
    state.maxBudget = Number(document.querySelector("#marketMaxBudget")?.value || state.maxBudget);
  }
  const requestedMatchMode = joinedRole === "buyer"
    ? document.querySelector('input[name="marketMatchMode"]:checked')?.value
    : "discover";
  let selectedFavorite = null;
  let preferredRecommended = null;
  if (requestedMatchMode === "favorites") {
    const selectedSellerId = document.querySelector('input[name="marketFavoriteSeller"]:checked')?.value
      || state.selectedFavoriteSellerId;
    selectedFavorite = matchableMarketFavorite(selectedSellerId);
    if (!selectedFavorite) {
      state.matchMode = "discover";
      render();
      showToast("指名して待つ商店を1つ選んでください。");
      return;
    }
    state.selectedFavoriteSellerId = selectedFavorite.publicSellerId;
    state.matchMode = "favorites";
    const budgetAlignment = alignBudgetToMarketFavorite(selectedFavorite);
    if (!budgetAlignment.ok) {
      render();
      showToast(`この商店の前回価格で待つには、あと${formatAnjuPay(budgetAlignment.shortage)}が必要です。`);
      return;
    }
  } else {
    state.matchMode = "discover";
    preferredRecommended = joinedRole === "buyer" ? preferredRecommendedShop() : null;
    if (state.preferredRecommendedSellerId && !preferredRecommended) {
      state.preferredRecommendedSellerId = "";
      render();
      showToast("優先先が推薦棚から外れたため、もう一度選んでください。");
      return;
    }
  }
  if (joinedRole === "seller" && state.shopStatus === "save-error") {
    showToast("店主カードが未保存です。再保存してから待機してください。");
    return;
  }
  if (joinedRole === "seller" && (!state.image || !state.listingTitle)) return showToast("出品画像とタイトルを準備してください。");
  const joinedName = state.name;
  const joinedListing = joinedRole === "seller"
    ? { title: state.listingTitle, askingPrice: state.askingPrice, pitchStyle: state.pitchStyle }
    : null;
  const joinedMaxBudget = state.maxBudget;
  const joinedMatchMode = joinedRole === "buyer" ? state.matchMode : "discover";
  const joinedFavoritePublicSellerId = joinedRole === "buyer" && joinedMatchMode === "favorites"
    ? selectedFavorite?.publicSellerId || ""
    : "";
  const joinedPreferredPublicSellerId = joinedRole === "buyer" && joinedMatchMode === "discover"
    ? preferredRecommended?.publicSellerId || ""
    : "";
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  state.busy = true;
  state.queueJoinPending = true;
  render();
  try {
    if (useMarketPreview) {
      state.screen = "waiting";
      return;
    }
    const response = await marketQueueCallable({
      action: "join",
      role: joinedRole,
      name: joinedName,
      listing: joinedListing,
      maxBudget: joinedMaxBudget,
      matchMode: joinedMatchMode,
      favoritePublicSellerId: joinedFavoritePublicSellerId,
      preferredPublicSellerId: joinedPreferredPublicSellerId,
    });
    if (!isCurrentQueueAttempt(generation, queueAttemptGeneration) || state.roomId) return;
    updateMarketBalance(response.data?.balance ?? state.balance);
    if (["canceled", "missing", "superseded"].includes(String(response.data?.status || ""))) {
      state.screen = "setup";
      showToast("待機条件が別の操作で変更されました。内容を確認して、もう一度参加してください。");
      return;
    }
    if (response.data?.roomId) {
      await enterRoom(String(response.data.roomId), generation);
      return;
    }
    state.screen = "waiting";
    startQueueHeartbeat(queueAttemptGeneration);
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "市場の待機列へ参加できませんでした。"));
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      state.queueJoinPending = false;
      render();
    }
  }
}

function startQueueHeartbeat(queueAttemptGeneration = state.queueAttemptGeneration) {
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeatPending = false;
  const generation = lifecycleGeneration;
  const heartbeatDelay = 20_000 + Math.floor(Math.random() * 5_000);
  state.queueHeartbeat = window.setInterval(async () => {
    if (
      !isCurrentQueueAttempt(generation, queueAttemptGeneration)
      || state.screen !== "waiting"
      || state.queueHeartbeatPending
    ) return;
    state.queueHeartbeatPending = true;
    try {
      const response = await marketQueueCallable({ action: "heartbeat" });
      if (
        !isCurrentQueueAttempt(generation, queueAttemptGeneration)
        || state.screen !== "waiting"
      ) return;
      if (response.data?.roomId) {
        await enterRoom(String(response.data.roomId), generation);
        return;
      }
      if (["canceled", "missing", "superseded"].includes(String(response.data?.status || ""))) {
        beginQueueAttempt();
        state.screen = "setup";
        showToast("待機情報の有効期限が切れました。もう一度参加してください。");
        render();
      }
    } catch {
      // The next heartbeat or active-room listener retries.
    } finally {
      if (isCurrentQueueAttempt(generation, queueAttemptGeneration)) {
        state.queueHeartbeatPending = false;
      }
    }
  }, heartbeatDelay);
}

function stopRoomHeartbeat() {
  window.clearInterval(state.roomHeartbeat);
  state.roomHeartbeat = null;
  state.roomHeartbeatPending = false;
}

function startRoomHeartbeat(roomId, generation = lifecycleGeneration) {
  stopRoomHeartbeat();
  state.roomHeartbeat = window.setInterval(async () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId
        || TERMINAL_STATES.has(state.room?.status) || state.roomHeartbeatPending) return;
    state.roomHeartbeatPending = true;
    try {
      const response = await marketQueueCallable({ action: "heartbeat_room", roomId });
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      if (TERMINAL_STATES.has(String(response.data?.status || ""))) stopRoomHeartbeat();
    } catch {
      // Firestoreのルーム監視と次の同期で再試行する。
    } finally {
      if (isCurrentLifecycle(generation) && state.roomId === roomId && state.roomHeartbeat) {
        state.roomHeartbeatPending = false;
      }
    }
  }, 20_000);
}

function clearRoomSyncRetry({ resetWarning = false } = {}) {
  window.clearTimeout(state.roomSyncRetry);
  state.roomSyncRetry = null;
  if (resetWarning) {
    state.roomSyncWarningShown = false;
    state.roomSyncRetryAttempts = 0;
  }
}

function scheduleRoomSyncRetry(roomId, generation) {
  clearRoomSyncRetry();
  const delay = Math.min(20_000, 3_000 * (2 ** Math.min(state.roomSyncRetryAttempts, 3)));
  state.roomSyncRetryAttempts += 1;
  state.roomSyncRetry = window.setTimeout(() => {
    state.roomSyncRetry = null;
    connectMarketRoomServices(roomId, generation);
  }, delay);
}

async function connectMarketRoomServices(roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.roomSyncPending) return;
  state.roomSyncPending = true;
  let shouldRetry = false;
  try {
    const syncResponse = await marketQueueCallable({ action: "sync_room", roomId });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    if (TERMINAL_STATES.has(String(syncResponse.data?.status || ""))) {
      stopRoomHeartbeat();
      clearRoomSyncRetry({ resetWarning: true });
      return;
    }
    startRoomHeartbeat(roomId, generation);
    await setupRealtimeRoom(generation, roomId);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    clearRoomSyncRetry({ resetWarning: true });
    if (state.room && state.screen === "room") {
      setupPeerConnection(generation, roomId).catch((error) => handleFatalError(error, generation));
    }
  } catch (error) {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    shouldRetry = true;
    state.peerStatus = "ルーム同期を再試行中…";
    if (!state.roomSyncWarningShown) {
      state.roomSyncWarningShown = true;
      showToast(callableMessage(error, "市場ルームの同期を再試行しています。"));
    }
    render();
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.roomSyncPending = false;
      if (shouldRetry && !TERMINAL_STATES.has(state.room?.status)) {
        scheduleRoomSyncRetry(roomId, generation);
      }
    }
  }
}

async function cancelQueue({ cancelMatchedRoom = false } = {}) {
  if (state.busy) return "busy";
  const generation = lifecycleGeneration;
  const queueAttemptGeneration = beginQueueAttempt();
  state.busy = true;
  render();
  try {
    if (useMarketPreview) {
      state.screen = "setup";
      return "canceled";
    }
    const response = await marketQueueCallable({ action: "cancel" });
    if (!isCurrentLifecycle(generation)) return "stale";
    if (response.data?.roomId) {
      const roomId = String(response.data.roomId);
      if (cancelMatchedRoom) {
        const turn = 1;
        const { actionId } = marketActionIdentity("cancel", roomId, turn);
        const cancelResponse = await marketActionCallable({ action: "cancel", roomId, actionId, turn });
        if (!isCurrentLifecycle(generation)) return "stale";
        clearMarketActionIdentity(actionId);
        updateMarketBalance(cancelResponse.data?.balance ?? state.balance);
        return "canceled";
      }
      await enterRoom(roomId, generation);
      return "matched";
    }
    window.clearInterval(state.queueHeartbeat);
    state.queueHeartbeat = null;
    state.screen = "setup";
    return "canceled";
  } catch (error) {
    if (isCurrentQueueAttempt(generation, queueAttemptGeneration)) {
      showToast(callableMessage(error, "待機をキャンセルできませんでした。"));
      if (state.screen === "waiting") startQueueHeartbeat(queueAttemptGeneration);
    }
    return "failed";
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.busy = false;
      render();
    }
  }
}

async function enterRoom(roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || !roomId) return;
  if (state.roomId === roomId && state.roomUnsubscribe) {
    beginQueueAttempt();
    state.screen = "room";
    state.busy = false;
    render();
    return;
  }
  if (state.enteringRoomId === roomId) return;
  beginQueueAttempt();
  state.enteringRoomId = roomId;
  stopRoomHeartbeat();
  state.roomId = roomId;
  state.oshijoDecisionRequested = false;
  state.screen = "room";
  state.busy = false;
  setMarketChrome("VALUE DEAL");
  render();
  state.roomUnsubscribe?.();
  state.roomUnsubscribe = onSnapshot(doc(firestore, "valueMarketRooms", roomId), (snapshot) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !snapshot.exists()) return;
    const previousStatus = state.room?.status;
    state.room = normalizeMarketRoom(snapshot.data());
    const incomingClosingAsset = String(state.incomingTransfer?.name || "").startsWith(OSHIJO_CLOSING_IMAGE_PREFIX)
      || String(state.incomingTransfer?.name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX);
    if (incomingClosingAsset && normalizeOshijoPhase(state.room) !== "closing") {
      state.incomingTransfer = null;
    }
    if (TERMINAL_STATES.has(state.room.status)) {
      stopRoomHeartbeat();
      clearRoomSyncRetry();
    }
    if (state.room.status === "sold") {
      if (previousStatus !== "sold") state.certificateStatus = "idle";
      refreshMarketAchievementNotifications(roomId);
    }
    if (previousStatus !== state.room.status) window.HariaiAudio?.playPhase?.();
    if (!useMarketPreview && roomRole() === "seller" && !state.image?.blob
        && !TERMINAL_STATES.has(state.room.status)) {
      state.errorMessage = "再読み込みで出品画像が端末メモリから消えたため、この取引は継続できません。「取引を終了して戻る」から安全に精算してください。";
      state.screen = "error";
      setMarketChrome("MARKET RECOVERY");
      render();
      return;
    }
    render();
    if (state.realtimeRoomId === roomId) {
      setupPeerConnection(generation, roomId).catch((error) => handleFatalError(error, generation));
    }
  }, (error) => handleFatalError(error, generation));
  await connectMarketRoomServices(roomId, generation);
  if (isCurrentLifecycle(generation) && state.enteringRoomId === roomId) state.enteringRoomId = "";
}

function markPresenceOffline(connection) {
  if (!connection?.reference || !connection?.disconnect) return Promise.resolve();
  return set(connection.reference, { online: false, updatedAt: serverTimestamp() })
    .then(() => connection.disconnect.cancel?.())
    .catch(() => {
      // If the explicit update fails, keep onDisconnect armed as a fallback.
    });
}

async function setupRealtimeRoom(generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || !roomId || state.realtimeRoomId === roomId) return;
  const base = `online/valueMarketRooms/${roomId}`;
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  const disconnect = onDisconnect(presenceRef);
  const connection = { reference: presenceRef, disconnect };
  let unsubscribeChat = null;
  try {
    await disconnect.set({ online: false, updatedAt: serverTimestamp() });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      await markPresenceOffline(connection);
      return;
    }
    await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      await markPresenceOffline(connection);
      return;
    }
    const chatQuery = query(ref(database, `${base}/chat`), limitToLast(60));
    unsubscribeChat = onChildAdded(chatQuery, (snapshot) => {
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
      if (state.seenChatIds.has(snapshot.key)) return;
      state.seenChatIds.add(snapshot.key);
      const message = { id: snapshot.key, ...snapshot.val() };
      state.chatMessages.push(message);
      if (message.uid === state.uid && roomRole() === "seller") {
        state.pitchSentTurns.add(Number(message.turn || 1));
      }
      if (state.chatMessages.length > 60) state.chatMessages.shift();
      render();
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) {
      unsubscribeChat();
      await markPresenceOffline(connection);
      return;
    }
    state.realtimeUnsubscribers.push(unsubscribeChat);
    state.presenceConnections.push(connection);
    state.realtimeRoomId = roomId;
  } catch (error) {
    unsubscribeChat?.();
    await markPresenceOffline(connection);
    if (state.realtimeRoomId === roomId) state.realtimeRoomId = "";
    throw error;
  }
}

async function setupPeerConnection(generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer || !state.room) return;
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC転送に対応していません。");
  const opponentUid = state.uid === state.room.sellerUid ? state.room.buyerUid : state.room.sellerUid;
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  state.peer = peer;
  window.clearTimeout(state.peerTimeout);
  state.peerTimeout = window.setTimeout(() => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer || state.channelReady) return;
    handleFatalError(new Error("P2P接続を確立できませんでした。通信環境を確認するか、取引を終了してください。"), generation);
  }, 20_000);
  peer.onicecandidate = (event) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    if (event.candidate) {
      sendSignal(opponentUid, "candidate", event.candidate.toJSON(), roomId, generation).catch(handleRecoverableError);
    }
  };
  peer.onconnectionstatechange = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    state.channelReady = state.channel?.readyState === "open";
    render();
  };
  peer.ondatachannel = (event) => {
    if (isCurrentLifecycle(generation) && state.roomId === roomId && state.peer === peer) {
      configureDataChannel(event.channel, generation, roomId);
    }
  };
  const signalsRef = ref(database, `online/valueMarketRooms/${roomId}/signals/${state.uid}`);
  state.realtimeUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
      await handleSignal(snapshot.val(), opponentUid, peer, roomId, generation);
    } catch (error) {
      if (isCurrentLifecycle(generation)) handleRecoverableError(error);
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }));
  if (roomRole() === "seller") {
    const channel = peer.createDataChannel("value-market-assets", { ordered: true });
    configureDataChannel(channel, generation, roomId);
    const offer = await peer.createOffer();
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    await peer.setLocalDescription(offer);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.peer !== peer) return;
    await sendSignal(opponentUid, "offer", { type: offer.type, sdp: offer.sdp }, roomId, generation);
  }
}

async function sendSignal(targetUid, type, payload, roomId = state.roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
  await set(push(ref(database, `online/valueMarketRooms/${roomId}/signals/${targetUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: serverTimestamp(),
  });
}

async function handleSignal(signal, opponentUid, peer = state.peer, roomId = state.roomId, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !signal || signal.fromUid !== opponentUid || !peer) return;
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await peer.setRemoteDescription(payload);
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await flushPendingIce(peer);
    const answer = await peer.createAnswer();
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await peer.setLocalDescription(answer);
    await sendSignal(opponentUid, "answer", { type: answer.type, sdp: answer.sdp }, roomId, generation);
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription(payload);
    if (!isCurrentLifecycle(generation) || state.peer !== peer) return;
    await flushPendingIce(peer);
  } else if (signal.type === "candidate") {
    if (peer.remoteDescription) await peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  }
}

async function flushPendingIce(peer = state.peer) {
  while (peer && state.pendingIce.length) await peer.addIceCandidate(state.pendingIce.shift());
}

function configureDataChannel(channel, generation = lifecycleGeneration, roomId = state.roomId) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    window.clearTimeout(state.peerTimeout);
    state.peerTimeout = null;
    state.channelReady = true;
    state.peerStatus = "● P2P接続済み";
    if (roomRole() === "seller") sendListingImage().catch(handleRecoverableError);
    render();
  };
  channel.onclose = () => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    state.channelReady = false;
    state.peerStatus = "P2P接続が切れました";
    render();
  };
  channel.onerror = () => {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) showToast("P2P転送で通信エラーが発生しました。");
  };
  channel.onmessage = (event) => {
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel) return;
    handleChannelMessage(event.data).catch(handleRecoverableError);
  };
}

async function sendListingImage() {
  if (state.imageSent || !state.image?.blob) return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  await sendAsset(state.image.blob, {
    kind: "image",
    turn: 0,
    name: state.room?.listing?.title || "推し画像",
    createdAt: Date.now(),
    generation,
    roomId,
  });
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
  state.imageSent = true;
}

function sendAsset(blob, options) {
  const transferState = state;
  const request = {
    ...options,
    createdAt: options.createdAt ?? Date.now(),
    generation: options.generation ?? lifecycleGeneration,
    roomId: options.roomId ?? state.roomId,
  };
  const task = transferState.outgoingTransfer
    .catch(() => {})
    .then(() => sendAssetNow(blob, request));
  transferState.outgoingTransfer = task;
  return task;
}

async function sendAssetNow(blob, {
  kind,
  turn,
  name,
  createdAt,
  generation,
  roomId,
}) {
  const channel = state.channel;
  const closingOnly = String(name || "").startsWith(OSHIJO_CLOSING_IMAGE_PREFIX)
    || String(name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX);
  const closingStillOpen = () => !closingOnly
    || normalizeOshijoPhase(state.room) === "closing";
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !channel || channel.readyState !== "open") {
    throw new Error("P2P接続が完了していません。");
  }
  if (!closingStillOpen()) throw new Error("静かな最終判断へ進んだため、営業素材は送信しませんでした。");
  const buffer = await blob.arrayBuffer();
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel || !closingStillOpen()) {
    throw new Error("P2P転送が中断されました。");
  }
  const mime = kind === "image" ? verifiedMarketImageMime(buffer) : blob.type;
  channel.send(JSON.stringify({ type: "asset-start", kind, turn, name, mime, size: buffer.byteLength, createdAt }));
  for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
    await waitForDataBuffer(channel, generation, roomId);
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.channel !== channel || !closingStillOpen()) {
      throw new Error("P2P転送が中断されました。");
    }
    channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
  }
  if (!closingStillOpen()) throw new Error("静かな最終判断へ進んだため、営業素材の転送を終了しました。");
  channel.send(JSON.stringify({ type: "asset-end", kind, turn }));
}

function waitForDataBuffer(channel = state.channel, generation = lifecycleGeneration, roomId = state.roomId) {
  if (!isCurrentLifecycle(generation) || state.roomId !== roomId || !channel || channel.readyState !== "open") {
    return Promise.reject(new Error("P2P接続が閉じました。"));
  }
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("P2P転送がタイムアウトしました。")), 10_000);
    channel.addEventListener("bufferedamountlow", () => {
      window.clearTimeout(timer);
      if (isCurrentLifecycle(generation) && state.roomId === roomId && state.channel === channel) resolve();
      else reject(new Error("P2P転送が中断されました。"));
    }, { once: true });
  });
}

async function handleChannelMessage(data) {
  if (typeof data === "string") {
    if (data.length > 4_096) throw new Error("P2P制御データが大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "asset-start") {
      if (state.incomingTransfer) throw new Error("別のP2P転送が進行中です。");
      const closingAsset = String(message.name || "").startsWith(OSHIJO_CLOSING_IMAGE_PREFIX)
        || String(message.name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX);
      if (closingAsset && (
        state.oshijoDecisionRequested
        || normalizeOshijoPhase(state.room) !== "closing"
      )) return;
      state.incomingTransfer = createIncomingMarketTransfer(message, {
        role: roomRole(),
        maxImageBytes: MAX_IMAGE_BYTES,
        maxAudioBytes: MAX_AUDIO_BYTES,
        maxTurns: MAX_TURNS,
      });
    } else if (message.type === "asset-end") {
      const endStatus = marketAssetEndStatus(state.incomingTransfer, message);
      if (endStatus === "orphan") return;
      if (endStatus === "mismatch") {
        state.incomingTransfer = null;
        throw new Error("P2P転送の終端情報が一致しません。");
      }
      finishIncomingAsset();
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  if (state.incomingTransfer.received > state.incomingTransfer.size) {
    state.incomingTransfer = null;
    throw new Error("受信データのサイズが一致しません。");
  }
}

function finishIncomingAsset() {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.received !== transfer.size) {
    state.incomingTransfer = null;
    throw new Error("P2P受信が完了していません。");
  }
  try {
    const mime = transfer.kind === "image"
      ? verifiedMarketImageMimeFromChunks(transfer.chunks)
      : transfer.mime;
    const blob = new Blob(transfer.chunks, { type: mime });
    const closingImage = transfer.kind === "image"
      && String(transfer.name || "").startsWith(OSHIJO_CLOSING_IMAGE_PREFIX);
    const closingAudio = transfer.kind === "audio"
      && String(transfer.name || "").startsWith(OSHIJO_CLOSING_AUDIO_PREFIX);
    if ((closingImage || closingAudio) && (
      state.oshijoDecisionRequested
      || normalizeOshijoPhase(state.room) !== "closing"
    )) return;
    if (closingImage) {
      state.oshijoClosingImages.push({
        uid: state.room?.sellerUid,
        blob,
        url: URL.createObjectURL(blob),
        createdAt: transfer.createdAt,
      });
    } else if (transfer.kind === "image") {
      releaseRemoteImage();
      state.remoteImage = { blob, url: URL.createObjectURL(blob) };
    } else {
      state.audioMessages.push({
        uid: state.room?.sellerUid,
        name: state.room?.sellerName || "SELLER",
        turn: transfer.turn,
        phase: closingAudio ? "oshijo_closing" : "",
        blob,
        url: URL.createObjectURL(blob),
        createdAt: transfer.createdAt,
      });
    }
    render();
  } finally {
    state.incomingTransfer = null;
  }
}

async function sendChatPitch(event) {
  event.preventDefault();
  if (roomRole() !== "seller" || state.room?.status !== "pitch") return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Number(state.room.turn || 1);
  const input = document.querySelector("#marketChatInput");
  const text = String(input?.value || "").trim().slice(0, 240);
  if (!text) return;
  state.busy = true;
  render();
  try {
    await set(push(ref(database, `online/valueMarketRooms/${roomId}/chat`)), {
      uid: state.uid,
      name: normalizeMarketName(state.room?.sellerName || state.name),
      text,
      turn,
      createdAt: serverTimestamp(),
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    state.pitchSentTurns.add(turn);
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast("営業チャットを送信できませんでした。");
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function sendAudioPitch(event) {
  const file = event.target.files?.[0];
  if (!file || roomRole() !== "seller" || state.room?.status !== "pitch") return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Number(state.room.turn || 1);
  state.busy = true;
  render();
  let processed = null;
  const createdAt = Date.now();
  try {
    processed = await shared().processGameAudioFile(file, { audioName: file.name });
    await sendAsset(processed.audioBlob, {
      kind: "audio",
      turn,
      name: processed.audioName,
      createdAt,
      generation,
      roomId,
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return;
    state.audioMessages.push({
      uid: state.uid,
      name: state.name,
      turn,
      blob: processed.audioBlob,
      url: processed.audioUrl,
      createdAt,
    });
    processed.audioUrl = "";
    state.pitchSentTurns.add(turn);
    showToast("10秒音声をP2Pで送りました。");
  } catch (error) {
    if (isCurrentLifecycle(generation)) showToast(error.message || "10秒音声を送信できませんでした。");
  } finally {
    if (processed?.audioUrl) URL.revokeObjectURL(processed.audioUrl);
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function submitOshijoClaim(event) {
  event.preventDefault();
  if (roomRole() !== "seller" || state.room?.status !== "pitch" || state.busy) return;
  const input = document.querySelector("#marketOshijoClaimAmount");
  const consent = document.querySelector("#marketOshijoAllInConsent");
  const claimAmount = Math.floor(Number(input?.value || 0));
  if (!Number.isInteger(claimAmount) || claimAmount < 1 || claimAmount > OSHIJO_MAX_CLAIM_AMOUNT) {
    input?.focus();
    showToast(`請求額は1〜${formatAnjuPay(OSHIJO_MAX_CLAIM_AMOUNT)}で入力してください。`);
    return;
  }
  if (consent?.checked !== true) {
    consent?.focus();
    showToast("オールイン時は実支払額で成約することを確認してください。");
    return;
  }
  state.oshijoClaimDraft = String(claimAmount);
  const completed = await performAction("pitch_complete", {
    closingMode: OSHIJO_CLOSING_MODE,
    claimAmount,
  });
  if (completed) state.oshijoClaimOpen = false;
}

async function authorizeOshijoClosingTurn(mediaKind) {
  if (
    roomRole() !== "seller"
    || state.room?.status !== "oshijo_closing"
    || !["text", "image", "audio"].includes(mediaKind)
  ) return false;
  if (oshijoClosingTurnsUsed(state.room) >= OSHIJO_MAX_CLOSING_TURNS) {
    showToast("クロージングは最大3手までです。");
    return false;
  }
  if (useMarketPreview) {
    state.room.closingTurnsUsed = Math.min(
      OSHIJO_MAX_CLOSING_TURNS,
      normalizeNonNegativeInteger(state.room.closingTurnsUsed, OSHIJO_MAX_CLOSING_TURNS) + 1,
    );
    state.room.closingMediaCounts = {
      ...(state.room.closingMediaCounts || {}),
      [mediaKind]: normalizeNonNegativeInteger(state.room.closingMediaCounts?.[mediaKind], OSHIJO_MAX_CLOSING_TURNS) + 1,
    };
    return true;
  }
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Math.max(1, Number(state.room?.turn || 1));
  const extra = { mediaKind };
  const { actionId } = marketActionIdentity("oshijo_closing_turn", roomId, turn, extra);
  try {
    const response = await marketActionCallable({
      action: "oshijo_closing_turn",
      roomId,
      mediaKind,
      actionId,
      turn,
    });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return false;
    clearMarketActionIdentity(actionId);
    if (state.room) {
      const returnedCount = response.data?.closingTurnsUsed
        ?? response.data?.closingTurnCount
        ?? response.data?.oshijoClosingTurnCount;
      if (Number.isFinite(Number(returnedCount))) {
        state.room.closingTurnsUsed = normalizeNonNegativeInteger(returnedCount, OSHIJO_MAX_CLOSING_TURNS);
      }
      const returnedCounts = response.data?.closingMediaCounts || response.data?.oshijoClosingMediaCounts;
      if (returnedCounts && typeof returnedCounts === "object") {
        state.room.closingMediaCounts = { ...returnedCounts };
      }
    }
    return true;
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(callableMessage(error, "クロージングの送信枠を確保できませんでした。"));
    }
    return false;
  }
}

async function sendOshijoClosingText(event) {
  event.preventDefault();
  if (state.busy || roomRole() !== "seller" || state.room?.status !== "oshijo_closing") return;
  const input = document.querySelector("#marketOshijoClosingText");
  const text = String(input?.value || "").trim().slice(0, OSHIJO_CLOSING_TEXT_MAX_LENGTH);
  if (!text) return;
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  state.busy = true;
  render();
  try {
    if (!await authorizeOshijoClosingTurn("text")) return;
    const message = {
      uid: state.uid,
      name: normalizeMarketName(state.room?.sellerName || state.name),
      text,
      turn: Number(state.room?.turn || 1),
      phase: "oshijo_closing",
      createdAt: useMarketPreview ? Date.now() : serverTimestamp(),
    };
    if (useMarketPreview) {
      state.chatMessages.push({ id: crypto.randomUUID(), ...message });
    } else {
      await set(push(ref(database, `online/valueMarketRooms/${roomId}/chat`)), message);
    }
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast("クロージングの言葉を1手届けました。");
    }
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(error.message || "クロージングの言葉を送信できませんでした。");
    }
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function sendOshijoClosingImage(event) {
  const file = event.currentTarget.files?.[0];
  if (!file || state.busy || roomRole() !== "seller" || state.room?.status !== "oshijo_closing") return;
  if (oshijoClosingMediaUsed(state.room, "image") > 0) {
    showToast("クロージング画像は1枚までです。");
    return;
  }
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  state.busy = true;
  render();
  let processed = null;
  try {
    processed = await shared().processImageFile(file, 0, { maxSide: 1200 });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.room?.status !== "oshijo_closing") return;
    if (!await authorizeOshijoClosingTurn("image")) return;
    const createdAt = Date.now();
    if (!useMarketPreview) {
      await sendAsset(processed.blob, {
        kind: "image",
        turn: 0,
        name: `${OSHIJO_CLOSING_IMAGE_PREFIX}${createdAt}`,
        createdAt,
        generation,
        roomId,
      });
    }
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.room?.status !== "oshijo_closing") return;
    state.oshijoClosingImages.push({
      uid: state.uid,
      blob: processed.blob,
      url: processed.url,
      createdAt,
    });
    processed.url = "";
    showToast("クロージング画像を1手届けました。");
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(error.message || "クロージング画像を送信できませんでした。");
    }
  } finally {
    if (processed?.url) URL.revokeObjectURL(processed.url);
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function sendOshijoClosingAudio(event) {
  const file = event.currentTarget.files?.[0];
  if (!file || state.busy || roomRole() !== "seller" || state.room?.status !== "oshijo_closing") return;
  if (oshijoClosingMediaUsed(state.room, "audio") > 0) {
    showToast("クロージング音声は1件までです。");
    return;
  }
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Math.max(1, Number(state.room?.turn || 1));
  state.busy = true;
  render();
  let processed = null;
  try {
    processed = await shared().processGameAudioFile(file, { audioName: file.name });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.room?.status !== "oshijo_closing") return;
    if (!await authorizeOshijoClosingTurn("audio")) return;
    const createdAt = Date.now();
    const name = `${OSHIJO_CLOSING_AUDIO_PREFIX}${processed.audioName}`;
    if (!useMarketPreview) {
      await sendAsset(processed.audioBlob, {
        kind: "audio",
        turn,
        name,
        createdAt,
        generation,
        roomId,
      });
    }
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId || state.room?.status !== "oshijo_closing") return;
    state.audioMessages.push({
      uid: state.uid,
      name,
      turn,
      phase: "oshijo_closing",
      blob: processed.audioBlob,
      url: processed.audioUrl,
      createdAt,
    });
    processed.audioUrl = "";
    showToast("クロージング音声を1手届けました。");
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      showToast(error.message || "クロージング音声を送信できませんでした。");
    }
  } finally {
    if (processed?.audioUrl) URL.revokeObjectURL(processed.audioUrl);
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

async function copyOshijoShareText() {
  const copy = oshijoShareCopy(state.room, state.oshijoShareChoice);
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(copy);
    showToast("選んだ共有文をコピーしました。");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = copy;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    showToast(copied ? "選んだ共有文をコピーしました。" : "共有文をコピーできませんでした。");
  }
}

function restartMarketAsSeller() {
  state.role = "seller";
  localStorage.setItem(MARKET_ROLE_KEY, "seller");
  resetForReplay();
}

function performPreviewAction(action, extra = {}) {
  const room = state.room;
  if (!room) return false;
  if (action === "accept_pitch") {
    updateMarketBalance(state.balance - (room.entryFee || ENTRY_FEE));
    room.status = "pitch";
  } else if (action === "decline_preview") {
    room.status = "ended";
  } else if (action === "pitch_complete") {
    updateMarketBalance(state.balance + (room.entryFee || ENTRY_FEE));
    room.closingMode = extra.closingMode === OSHIJO_CLOSING_MODE ? OSHIJO_CLOSING_MODE : "";
    room.claimAmount = room.closingMode
      ? normalizeNonNegativeInteger(extra.claimAmount || room.listing?.askingPrice, OSHIJO_MAX_CLAIM_AMOUNT)
      : 0;
    room.status = room.closingMode ? "oshijo_warning" : "decision";
    room.pitchCompletedAt = Date.now();
  } else if (action === "hear_oshijo_closing") {
    room.status = "oshijo_closing";
    room.closingStartedAt = Date.now();
  } else if (action === "enter_silent_decision") {
    room.status = "decision";
    room.silentDecisionAt = Date.now();
  } else if (action === "buy") {
    const deal = normalizeOshijoDeal(room);
    const purchaseAmount = isOshijoClosing(room)
      ? Math.min(deal.claimAmount, state.balance)
      : room.listing?.askingPrice;
    const settlement = marketSettlement(purchaseAmount, room);
    updateMarketBalance(state.balance - settlement.grossAmount);
    room.status = "sold";
    room.paidAmount = settlement.grossAmount;
    room.salePrice = settlement.grossAmount;
    room.allIn = isOshijoClosing(room) && settlement.grossAmount < deal.claimAmount;
    room.rankingContribution = Math.min(OSHIJO_RANKING_CAP, settlement.grossAmount);
    room.marketFee = settlement.feeAmount;
    room.patronFundSubsidy = settlement.patronFundSubsidy;
    room.patronFundPolicy = normalizePatronFundPolicy(room.patronFundPolicy) || "balanced";
    room.patronFundKind = normalizePatronFundKind(room.patronFundKind) || "trust";
    room.sellerProceeds = settlement.sellerProceeds;
    room.certificateNumber = "OSHI-PREVIEW0000001";
    room.sellerIssueNumber = Math.max(1, Number(room.sellerIssueNumber || 13));
    state.certificateStatus = "idle";
    if (settlement.patronFundSubsidy > 0) {
      state.patronFund = normalizePatronFund({
        ...state.patronFund,
        subsidyPaid: state.patronFund.subsidyPaid + settlement.patronFundSubsidy,
        remaining: Math.max(0, state.patronFund.remaining - settlement.patronFundSubsidy),
        supportedDeals: state.patronFund.supportedDeals + 1,
      });
    }
    if (room.sellerShop) {
      const sellerShop = normalizeMarketShop(room.sellerShop);
      sellerShop.verified.salesCount += 1;
      sellerShop.verified.bestSale = Math.max(sellerShop.verified.bestSale, settlement.grossAmount);
      room.sellerShop = sellerShop;
    }
  } else if (action === "leave") {
    room.status = "ended";
  } else if (action === "request_extension") {
    room.status = "extension_request";
  } else if (action === "offer_extension") {
    const incentive = Number(extra.incentive || 5);
    updateMarketBalance(state.balance - incentive);
    room.extensionIncentive = incentive;
    room.status = "extension_offer";
  } else if (action === "accept_extension") {
    updateMarketBalance(state.balance + Number(room.extensionIncentive || 0));
    room.extensionFeesPaid = Number(room.extensionFeesPaid || 0) + Number(room.extensionIncentive || 0);
    room.extensionIncentive = 0;
    room.turn = Number(room.turn || 1) + 1;
    room.status = "pitch";
  } else if (action === "decline_extension") {
    room.status = "ended";
  } else if (action === "cancel") {
    room.status = "canceled";
  } else {
    return false;
  }
  render();
  return true;
}

async function performAction(action, extra = {}) {
  if (!state.roomId || state.busy) return false;
  if (useMarketPreview) return performPreviewAction(action, extra);
  const generation = lifecycleGeneration;
  const roomId = state.roomId;
  const turn = Math.max(1, Number(state.room?.turn || 1));
  let requestExtra = { ...extra };
  if (action === "buy" && isOshijoClosing(state.room)) {
    const deal = normalizeOshijoDeal(state.room);
    const confirmedBalance = normalizeNonNegativeInteger(state.balance, ANJU_PAY_MAX_BALANCE);
    const confirmedPaidAmount = Math.min(deal.claimAmount, confirmedBalance);
    requestExtra = {
      ...requestExtra,
      confirmedBalance,
      confirmedPaidAmount,
      acceptedClaimAmount: deal.claimAmount,
      acceptedPayableAmount: confirmedPaidAmount,
      allIn: confirmedPaidAmount < deal.claimAmount,
    };
  }
  const enteringSilentDecision = action === "enter_silent_decision" && isOshijoClosing(state.room);
  if (enteringSilentDecision) {
    state.oshijoDecisionRequested = true;
    state.incomingTransfer = null;
  }
  const { actionId } = marketActionIdentity(action, roomId, turn, requestExtra);
  state.busy = true;
  render();
  try {
    const response = await marketActionCallable({ action, roomId, ...requestExtra, actionId, turn });
    if (!isCurrentLifecycle(generation) || state.roomId !== roomId) return false;
    clearMarketActionIdentity(actionId);
    updateMarketBalance(response.data?.balance ?? state.balance);
    applyMarketPatronExperience(response.data);
    if (action === "accept_pitch") showToast(`${formatAnjuPay(state.room?.entryFee || ENTRY_FEE)}の着手料をAnjuPay残高から保留しました。`);
    if (action === "buy") {
      state.certificateStatus = "idle";
      if (state.room) {
        const paidAmount = normalizeNonNegativeInteger(
          response.data?.paidAmount
            ?? response.data?.salePrice
            ?? requestExtra.confirmedPaidAmount
            ?? state.room.salePrice
            ?? state.room.listing?.askingPrice,
          OSHIJO_MAX_CLAIM_AMOUNT,
        );
        state.room.claimAmount = normalizeNonNegativeInteger(
          response.data?.claimAmount
            ?? requestExtra.acceptedClaimAmount
            ?? state.room.claimAmount
            ?? state.room.listing?.askingPrice,
          OSHIJO_MAX_CLAIM_AMOUNT,
        );
        state.room.paidAmount = paidAmount;
        state.room.salePrice = paidAmount;
        state.room.allIn = response.data?.allIn === true
          || (isOshijoClosing(state.room) && paidAmount < state.room.claimAmount);
        state.room.rankingContribution = Math.min(
          OSHIJO_RANKING_CAP,
          normalizeNonNegativeInteger(
            response.data?.rankingContribution
              ?? response.data?.rankingAmount
              ?? paidAmount,
            OSHIJO_RANKING_CAP,
          ),
        );
        state.room.marketFee = Number(response.data?.marketFee || 0);
        state.room.patronFundSubsidy = Math.min(
          maximumPatronFundSubsidy(state.room.marketFee),
          normalizeNonNegativeInteger(
            response.data?.patronFundSubsidy,
            maximumPatronFundSubsidy(state.room.marketFee),
          ),
        );
        state.room.patronFundPolicy = normalizePatronFundPolicy(response.data?.patronFundPolicy);
        state.room.patronFundKind = normalizePatronFundKind(response.data?.patronFundKind);
        state.room.sellerProceeds = Number(response.data?.sellerProceeds || 0);
        state.room.settlementQuote = {
          ...(state.room.settlementQuote || {}),
          grossAmount: paidAmount,
          feeAmount: state.room.marketFee,
          patronFundSubsidy: state.room.patronFundSubsidy,
          sellerProceeds: state.room.sellerProceeds,
        };
        state.room.certificateNumber = String(response.data?.certificateNumber || "");
        state.room.sellerIssueNumber = Math.max(0, Number(response.data?.sellerIssueNumber || 0));
        if (response.data?.sellerShop || response.data?.shop) {
          state.room.sellerShop = response.data.sellerShop || response.data.shop;
        }
      }
      showToast("売買が成立しました。");
      notifyMarketAchievementUnlocks(response.data?.newlyUnlocked);
    }
    if (action === "pitch_complete" && requestExtra.closingMode === OSHIJO_CLOSING_MODE && state.room) {
      state.room.closingMode = OSHIJO_CLOSING_MODE;
      state.room.claimAmount = normalizeNonNegativeInteger(
        response.data?.claimAmount ?? requestExtra.claimAmount,
        OSHIJO_MAX_CLAIM_AMOUNT,
      );
    }
    if (action === "enter_silent_decision" && state.room) {
      state.room.status = "decision";
    }
    if (action === "offer_extension") showToast("内金分のAnjuPayを残高から保留し、買い手へ提示しました。");
    if (action === "accept_extension") showToast("内金分のAnjuPayを受け取り、次の営業ターンへ進みます。");
    return true;
  } catch (error) {
    if (enteringSilentDecision && isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.oshijoDecisionRequested = false;
    }
    if (isCurrentLifecycle(generation)) showToast(callableMessage(error, "市場操作を完了できませんでした。"));
    return false;
  } finally {
    if (isCurrentLifecycle(generation) && state.roomId === roomId) {
      state.busy = false;
      render();
    }
  }
}

function readMarketProfileForm() {
  return {
    xHandle: normalizeMarketXHandle(document.querySelector("#marketRankingXHandle")?.value),
    xPublic: document.querySelector("#marketRankingXPublic")?.checked === true,
    tagline: normalizeMarketTagline(document.querySelector("#marketRankingTagline")?.value),
    taglinePublic: document.querySelector("#marketRankingTaglinePublic")?.checked === true,
  };
}

function updateMarketXHandleInput(event) {
  const input = event.currentTarget;
  input.value = String(input.value || "").trimStart().replace(/^@+/, "").slice(0, 15);
  updateMarketProfilePreview();
}

function updateMarketProfilePreview() {
  const formValue = readMarketProfileForm();
  const count = document.querySelector("#marketRankingTaglineCount");
  if (count) count.textContent = String(formValue.tagline.length);
  const preview = document.querySelector("#marketRankingProfilePreview");
  if (preview) {
    preview.outerHTML = renderMarketProfilePreview(formValue, {
      xPublic: formValue.xPublic,
      taglinePublic: formValue.taglinePublic,
    });
  }
}

function applyMarketRankingResponse(data, { requestedPeriod = state.rankingPeriod } = {}) {
  const payload = data && typeof data === "object" ? data : {};
  const normalized = normalizeMarketRankingPayload(payload);
  const root = payload.rankings && typeof payload.rankings === "object" ? payload.rankings : payload;
  const periods = root.periods && typeof root.periods === "object" ? root.periods : root;
  const hasMonthly = Boolean(periods.monthly || periods.currentMonth || payload.monthly);
  const hasLifetime = Boolean(periods.lifetime || periods.allTime || payload.lifetime || payload.allTime);
  const hasFlat = Array.isArray(root.sellers) || Array.isArray(root.buyers);
  if (hasMonthly) {
    state.rankings.monthly = normalized.monthly;
    state.rankingPeriodsLoaded.add("monthly");
  }
  if (hasLifetime) {
    state.rankings.lifetime = normalized.lifetime;
    state.rankingPeriodsLoaded.add("lifetime");
  }
  if (!hasMonthly && !hasLifetime && hasFlat) {
    const selected = normalizeMarketRankingPeriod(payload.period || root.period || requestedPeriod);
    state.rankings[selected] = normalized[selected];
    const periodKey = normalizeShopText(payload.periodKey || root.periodKey, 16);
    if (periodKey) {
      state.rankings[selected].label = selected === "monthly" && /^\d{4}-\d{2}$/.test(periodKey)
        ? `${Number(periodKey.slice(0, 4))}年${Number(periodKey.slice(5, 7))}月`
        : "市場開始からの累計";
    }
    state.rankingPeriodsLoaded.add(selected);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "monthlyAchievements")) {
    state.rankingMonthlyAchievements = normalizeMarketMonthlyAchievements(payload.monthlyAchievements);
    state.rankingMonthlyAchievementsAvailable = true;
  }
  state.rankingMeta = {
    monthlyStartKey: /^\d{4}-\d{2}$/.test(String(payload.monthlyStartKey || ""))
      ? String(payload.monthlyStartKey)
      : state.rankingMeta.monthlyStartKey,
    finalizedSeasonKey: /^\d{4}-\d{2}$/.test(String(payload.finalizedSeasonKey || ""))
      ? String(payload.finalizedSeasonKey)
      : state.rankingMeta.finalizedSeasonKey,
    rankingContributionCap: Math.min(
      OSHIJO_RANKING_CAP,
      normalizeNonNegativeInteger(
        payload.rankingContributionCap ?? state.rankingMeta.rankingContributionCap,
        OSHIJO_RANKING_CAP,
      ) || OSHIJO_RANKING_CAP,
    ),
  };
  state.rankingProfile = sanitizeMarketPublicProfile(data?.viewerProfile);
  state.rankingProfileEligible = data?.viewerEligible === true;
  state.rankingProfileName = data?.viewerName
    ? normalizeMarketName(data.viewerName)
    : (state.rankingProfileName || state.name);
  state.rankingsStatus = "ready";
}

async function selectMarketRankingPeriod(value) {
  const period = normalizeMarketRankingPeriod(value);
  state.rankingPeriod = period;
  if (useMarketPreview || state.rankingPeriodsLoaded.has(period)) {
    render();
    return;
  }
  const generation = lifecycleGeneration;
  state.rankingsStatus = "loading";
  render();
  try {
    const response = await marketRankingsCallable({ action: "list", period });
    if (!isCurrentLifecycle(generation) || state.screen !== "rankings" || state.rankingPeriod !== period) return;
    applyMarketRankingResponse(response.data, { requestedPeriod: period });
  } catch (error) {
    if (!isCurrentLifecycle(generation) || state.screen !== "rankings" || state.rankingPeriod !== period) return;
    state.rankingsStatus = "error";
    showToast(callableMessage(error, "市場ランキングを読み込めませんでした。"));
  }
  if (isCurrentLifecycle(generation) && state.screen === "rankings" && state.rankingPeriod === period) render();
}

async function saveMarketRankingPublicProfile(event) {
  event.preventDefault();
  if (state.rankingProfileBusy || !state.rankingProfileEligible) return;
  const formValue = readMarketProfileForm();
  if (formValue.xPublic && !MARKET_X_HANDLE_PATTERN.test(formValue.xHandle)) {
    document.querySelector("#marketRankingXHandle")?.focus();
    showToast("Xユーザー名は半角英数字と_で15文字以内にしてください。");
    return;
  }
  if (formValue.taglinePublic && (
    !formValue.tagline
    || formValue.tagline.length > MARKET_TAGLINE_MAX_LENGTH
    || /[\u0000-\u001f\u007f\r\n]/.test(formValue.tagline)
  )) {
    document.querySelector("#marketRankingTagline")?.focus();
    showToast("市場プロフィールの一言は改行なしの40文字以内にしてください。");
    return;
  }

  const generation = lifecycleGeneration;
  state.rankingProfileBusy = true;
  state.rankingProfileOpen = true;
  const saveButton = document.querySelector("#marketRankingProfileSave");
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "保存中…";
  }
  let saved = false;
  try {
    let savedProfile = {
      xHandle: formValue.xPublic ? formValue.xHandle : "",
      tagline: formValue.taglinePublic ? formValue.tagline : "",
    };
    if (!useMarketPreview) {
      const response = await marketRankingsCallable({
        action: "save_public_profile",
        xHandle: formValue.xHandle,
        xPublic: formValue.xPublic,
        tagline: formValue.tagline,
        taglinePublic: formValue.taglinePublic,
      });
      if (!isCurrentLifecycle(generation) || state.screen !== "rankings") return;
      if (response.data?.saved !== true) {
        throw new Error("公開プロフィールの保存を確認できませんでした。");
      }
      savedProfile = sanitizeMarketPublicProfile(response.data?.profile);
    }
    if (!isCurrentLifecycle(generation) || state.screen !== "rankings") return;
    state.rankingProfile = sanitizeMarketPublicProfile(savedProfile);
    for (const period of MARKET_RANKING_PERIODS) {
      for (const role of ["sellers", "buyers"]) {
        state.rankings[period][role] = state.rankings[period][role].map((entry) => (
          entry.isViewer === true ? { ...entry, publicProfile: state.rankingProfile } : entry
        ));
      }
    }
    saved = true;
    showToast("市場ランキングの公開設定を保存しました。");
  } catch (error) {
    if (isCurrentLifecycle(generation) && state.screen === "rankings") {
      showToast(callableMessage(error, "公開プロフィールを保存できませんでした。"));
    }
  } finally {
    if (isCurrentLifecycle(generation)) {
      state.rankingProfileBusy = false;
      if (state.screen === "rankings") {
        if (saved) {
          render();
        } else if (saveButton?.isConnected) {
          saveButton.disabled = false;
          saveButton.textContent = "公開設定を保存";
        }
      }
    }
  }
}

async function openRankings(returnScreen = state.screen) {
  const generation = lifecycleGeneration;
  state.rankingReturnScreen = returnScreen === "landing"
    ? "landing"
    : returnScreen === "room" && state.room ? "room" : "setup";
  state.screen = "rankings";
  state.rankingPeriod = "monthly";
  state.rankingsStatus = useMarketPreview ? "ready" : "loading";
  if (useMarketPreview) {
    state.rankings = {
      monthly: normalizeMarketRankingSet({
        label: "2026年8月（レイアウト例）",
        sellers: [{
          name: "SELLER TEST",
          primary: 1280,
          count: 9,
          best: 3000,
          uniqueCounterparties: 6,
          isViewer: true,
          publicProfile: { xHandle: "seller_art", tagline: "推しの価値を言葉で届けます" },
          monthlyAchievements: [{ label: "月間の推し嬢", level: 3, icon: "◆" }],
        }],
        buyers: [{
          name: "BUYER TEST",
          primary: 960,
          count: 7,
          best: 1500,
          uniqueCounterparties: 4,
          monthlyAchievements: [{ label: "推し支え人", level: 2, icon: "✦" }],
        }],
      }),
      lifetime: normalizeMarketRankingSet({
        label: "市場開始からの累計",
        sellers: [{
          name: "SELLER TEST",
          primary: 12_800,
          count: 42,
          best: 5000,
          uniqueCounterparties: 18,
          isViewer: true,
          publicProfile: { xHandle: "seller_art", tagline: "推しの価値を言葉で届けます" },
          achievementShowcase: ["market_seller_3", "market_first_turn"],
        }],
        buyers: [{ name: "BUYER TEST", primary: 9_600, count: 31, best: 3000, achievementShowcase: ["market_buyer_3"] }],
      }),
    };
    state.rankingPeriodsLoaded = new Set(MARKET_RANKING_PERIODS);
    state.rankingMonthlyAchievements = normalizeMarketMonthlyAchievements({
      seller: { months: 4, top3Months: 2, championMonths: 1, level: 2, latestSeasonKey: "2026-06", latestAwardId: "top3", latestRank: 2 },
      buyer: { months: 2, top3Months: 1, championMonths: 0, level: 1, latestSeasonKey: "2026-06", latestAwardId: "top10", latestRank: 8 },
      levelMonths: [1, 3, 6, 12],
    });
    state.rankingMonthlyAchievementsAvailable = true;
    state.rankingMeta = { monthlyStartKey: "2026-08", finalizedSeasonKey: "2026-07", rankingContributionCap: OSHIJO_RANKING_CAP };
    state.rankingProfile = { xHandle: "seller_art", tagline: "推しの価値を言葉で届けます" };
    state.rankingProfileEligible = true;
    state.rankingProfileName = "SELLER TEST";
    render();
    return;
  }
  render();
  try {
    const response = await marketRankingsCallable({ action: "list", period: "monthly" });
    if (!isCurrentLifecycle(generation) || state.screen !== "rankings") return;
    applyMarketRankingResponse(response.data, { requestedPeriod: "monthly" });
  } catch (error) {
    if (!isCurrentLifecycle(generation) || state.screen !== "rankings") return;
    state.rankingsStatus = "error";
    showToast(callableMessage(error, "市場ランキングを読み込めませんでした。"));
  }
  if (isCurrentLifecycle(generation) && state.screen === "rankings") render();
}

function previewCertificates() {
  return [
    {
      certificateNumber: "OSHI-PREVIEW0000001",
      listingTitle: "夕焼けの推し",
      sellerName: "SELLER TEST",
      sellerShop: marketShopSample(),
      sellerIssueNumber: 13,
      purchasePrice: 100,
      marketFee: 5,
      patronFundSubsidy: 2,
      patronFundPolicy: "balanced",
      patronFundKind: "trust",
      sellerProceeds: 97,
      closingMode: OSHIJO_CLOSING_MODE,
      turn: 1,
      extended: false,
      rankingCounted: true,
      nonTransferable: true,
      issuedAt: Date.now() - (25 * 60 * 1000),
    },
    {
      certificateNumber: "OSHI-PREVIEW0000002",
      listingTitle: "雨上がりの一枚",
      sellerName: "VALUE MAKER",
      sellerShop: {
        ...previewMarketFavorites()[0],
        relationship: { isFavorite: true, metBefore: true, previousPurchases: 2, lastPurchasePrice: 300 },
      },
      sellerIssueNumber: 22,
      purchasePrice: 25,
      marketFee: 2,
      sellerProceeds: 23,
      turn: 2,
      extended: true,
      rankingCounted: true,
      nonTransferable: true,
      issuedAt: Date.now() - (2 * 24 * 60 * 60 * 1000),
    },
  ];
}

async function openCertificates(returnScreen = state.screen, { force = false } = {}) {
  const generation = lifecycleGeneration;
  state.certificateReturnScreen = returnScreen === "room" && state.room ? "room" : "setup";
  state.screen = "certificates";
  if (!force && state.certificateStatus === "ready") {
    render();
    return;
  }
  state.certificateStatus = "loading";
  render();
  if (useMarketPreview) {
    state.certificates = previewCertificates().map(normalizeMarketCertificate);
    state.certificateHasMore = false;
    state.certificateStatus = "ready";
    render();
    return;
  }
  try {
    const response = await marketRankingsCallable({ action: "collection" });
    if (!isCurrentLifecycle(generation) || state.screen !== "certificates") return;
    applyMarketPatronExperience(response.data);
    state.certificates = Array.isArray(response.data?.certificates)
      ? response.data.certificates.map(normalizeMarketCertificate)
      : [];
    state.certificateHasMore = response.data?.hasMore === true;
    state.certificateStatus = "ready";
  } catch (error) {
    if (!isCurrentLifecycle(generation) || state.screen !== "certificates") return;
    state.certificateStatus = "error";
    showToast(callableMessage(error, "推し値証書を読み込めませんでした。"));
  }
  if (isCurrentLifecycle(generation) && state.screen === "certificates") render();
}

function returnFromCertificates() {
  state.screen = state.certificateReturnScreen === "room" && state.room ? "room" : "setup";
  render();
}

async function requestHome() {
  if (!active) return;
  if (useMarketPreview) {
    returnHome();
    return;
  }
  if (state.queueJoinPending) {
    showToast("待機列への参加処理が終わってから、もう一度トップへ戻ってください。");
    return;
  }
  if (state.screen === "waiting") {
    const outcome = await cancelQueue({ cancelMatchedRoom: true });
    if (outcome === "canceled") returnHome();
    return;
  }
  if (state.roomId && (!state.room || !TERMINAL_STATES.has(state.room.status))) {
    if (!window.confirm("現在の市場取引を終了しますか？ 未完了営業の着手料は、売り手終了なら買い手のAnjuPay残高へ返還し、買い手終了なら売り手へ移します。確定済みの内金は返還されません。")) return;
    if (!await performAction("cancel")) return;
  }
  returnHome();
}

function returnFromRankings() {
  if (state.rankingReturnScreen === "landing") {
    returnHome();
    return;
  }
  state.screen = state.rankingReturnScreen === "room" && state.room ? "room" : "setup";
  render();
}

function resetForReplay() {
  const generation = ++lifecycleGeneration;
  const role = state.role;
  const name = state.name;
  const balance = state.balance;
  const patron = state.patron;
  const patronFund = state.patronFund;
  const patronImpact = state.patronImpact;
  const patronEligibility = state.patronEligibility;
  const recommendations = state.recommendations;
  const recommendedShelf = state.recommendedShelf;
  const marketPolicy = state.marketPolicy;
  const image = role === "seller" ? state.image : null;
  const listingTitle = state.listingTitle;
  const askingPrice = state.askingPrice;
  const pitchStyle = state.pitchStyle;
  const maxBudget = state.maxBudget;
  const shop = state.shop;
  const shopCatalog = state.shopCatalog;
  const shopReport = state.shopReport;
  const ownedTitleIds = state.ownedTitleIds;
  const ownedShopCharmIds = state.ownedShopCharmIds;
  const favorites = state.favorites;
  const shopStatus = state.shopStatus;
  const shopErrorMessage = state.shopErrorMessage;
  const matchMode = state.matchMode;
  const preferredRecommendedSellerId = preferredRecommendedShop(recommendedShelf)?.publicSellerId || "";
  const preservedFavoriteSeller = matchableMarketFavorite(state.selectedFavoriteSellerId, favorites);
  state.activeUnsubscribe?.();
  state.activeUnsubscribe = null;
  state.walletUnsubscribe?.();
  state.walletUnsubscribe = null;
  cleanupRoom({ preserveLocalImage: role === "seller" });
  state = {
    ...createState(),
    uid: useMarketPreview ? "local-preview-user" : (auth.currentUser?.uid || ""),
    authReady: true,
    role,
    name,
    balance,
    patron,
    patronFund,
    patronImpact,
    patronEligibility,
    recommendations,
    recommendedShelf,
    marketPolicy,
    image,
    listingTitle,
    askingPrice,
    pitchStyle,
    maxBudget,
    shop,
    shopCatalog,
    shopReport,
    ownedTitleIds,
    ownedShopCharmIds,
    favorites,
    shopStatus,
    shopErrorMessage,
    matchMode: matchMode === "favorites" && preservedFavoriteSeller ? "favorites" : "discover",
    selectedFavoriteSellerId: preservedFavoriteSeller?.publicSellerId || "",
    preferredRecommendedSellerId: matchMode === "discover"
      ? preferredRecommendedSellerId
      : "",
  };
  normalizeBuyerBudget();
  active = true;
  lastRenderedScreen = "";
  if (!useMarketPreview) {
    subscribeToActiveRoom(generation);
    subscribeToWallet(generation);
  }
  setMarketChrome(useMarketPreview ? "VALUE MARKET PREVIEW" : "VALUE MARKET");
  render();
  if (!useMarketPreview) loadMarketShop(generation);
}

function returnHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  state.activeUnsubscribe?.();
  state.activeUnsubscribe = null;
  state.walletUnsubscribe?.();
  state.walletUnsubscribe = null;
  cleanupRoom();
  window.HariaiApp?.returnHome?.();
}

function cleanupRoom({ preserveLocalImage = false, preserveOnDisconnect = false } = {}) {
  window.clearInterval(state.queueHeartbeat);
  state.queueHeartbeat = null;
  state.queueHeartbeatPending = false;
  state.queueAttemptGeneration += 1;
  stopRoomHeartbeat();
  clearRoomSyncRetry({ resetWarning: true });
  state.roomSyncPending = false;
  state.roomUnsubscribe?.();
  state.roomUnsubscribe = null;
  state.realtimeUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const presenceConnections = state.presenceConnections.splice(0);
  if (!preserveOnDisconnect) presenceConnections.forEach(markPresenceOffline);
  state.peer?.close();
  state.channel?.close();
  window.clearTimeout(state.peerTimeout);
  state.peerTimeout = null;
  state.peer = null;
  state.channel = null;
  state.channelReady = false;
  state.pendingIce = [];
  state.outgoingTransfer = Promise.resolve();
  state.incomingTransfer = null;
  state.enteringRoomId = "";
  state.realtimeRoomId = "";
  state.audioMessages.forEach((message) => message.url && URL.revokeObjectURL(message.url));
  state.audioMessages = [];
  state.oshijoClosingImages.forEach((image) => image.url && URL.revokeObjectURL(image.url));
  state.oshijoClosingImages = [];
  releaseRemoteImage();
  if (!preserveLocalImage) releaseLocalImage();
}

function releaseLocalImage() {
  if (state.image?.url) URL.revokeObjectURL(state.image.url);
  state.image = null;
}

function releaseRemoteImage() {
  if (state.remoteImage?.url) URL.revokeObjectURL(state.remoteImage.url);
  state.remoteImage = null;
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "市場の通信処理に失敗しました。");
}

function handleFatalError(error, generation = lifecycleGeneration) {
  if (!isCurrentLifecycle(generation)) return;
  console.error(error);
  state.errorMessage = callableMessage(error, "市場へ接続できませんでした。");
  state.screen = "error";
  setMarketChrome("MARKET ERROR");
  render();
}

function previewRoom(status = "preview", role = "buyer", closingMode = "") {
  if (!useMarketPreview) return;
  const sellerUid = "local-preview-seller";
  const buyerUid = "local-preview-buyer";
  state.role = role;
  state.uid = role === "seller" ? sellerUid : buyerUid;
  state.audioMessages.forEach((message) => message.url && URL.revokeObjectURL(message.url));
  state.audioMessages = [];
  state.oshijoClosingImages.forEach((image) => image.url && URL.revokeObjectURL(image.url));
  state.oshijoClosingImages = [];
  state.chatMessages = [];
  state.seenChatIds = new Set();
  state.oshijoShareChoice = "";
  const pitchAccepted = ["pitch", "oshijo_warning", "oshijo_closing", "decision", "extension_request", "extension_offer", "sold", "ended"]
    .includes(status);
  const pitchCompleted = ["oshijo_warning", "oshijo_closing", "decision", "extension_request", "extension_offer", "sold", "ended"]
    .includes(status);
  const oshijoPreview = closingMode === OSHIJO_CLOSING_MODE;
  const previewClaimAmount = oshijoPreview ? 800 : 100;
  const previewPaidAmount = oshijoPreview ? 495 : 100;
  let previewBalance = 500;
  if (role === "buyer" && pitchAccepted) previewBalance -= ENTRY_FEE;
  if (role === "seller" && pitchCompleted) previewBalance += ENTRY_FEE;
  if (status === "sold") {
    if (role === "buyer") previewBalance -= previewPaidAmount;
    else previewBalance += Math.max(0, previewPaidAmount - Math.ceil(previewPaidAmount * .05));
  }
  updateMarketBalance(previewBalance);
  state.roomId = "local-preview-room";
  state.screen = "room";
  state.channelReady = true;
  state.peerStatus = "● P2P接続済み";
  state.room = {
    roomId: state.roomId,
    participants: { [sellerUid]: true, [buyerUid]: true },
    sellerUid,
    buyerUid,
    sellerName: "SELLER TEST",
    buyerName: "BUYER TEST",
    sellerShop: {
      ...marketShopSample(),
      relationship: {
        isFavorite: false,
        metBefore: true,
        previousPurchases: 1,
        lastPurchasePrice: 100,
      },
    },
    sellerPatron: { seasonKey: currentPatronSeasonKey(), seasonSpent: 1_500, tier: 2 },
    buyerPatron: { seasonKey: currentPatronSeasonKey(), seasonSpent: 300, tier: 1 },
    oshijoPatron: {
      eligible: true,
      label: "人気推し嬢パトロン",
      detail: "月間の支持条件を満たし、基金へ還元できる店主です。",
      badges: [{ label: "PATRON", level: 2, icon: "♛" }],
    },
    listing: { title: "夕焼けの推し", askingPrice: 100, pitchStyle: "either" },
    settlementQuote: status === "sold" && oshijoPreview
      ? { grossAmount: previewPaidAmount, feeAmount: 25, patronFundSubsidy: 10, sellerProceeds: 480 }
      : { grossAmount: 100, feeAmount: 5, patronFundSubsidy: 2, sellerProceeds: 97 },
    patronFundSubsidy: status === "sold" && oshijoPreview ? 10 : 2,
    patronFundPolicy: "balanced",
    patronFundKind: "trust",
    status,
    closingMode: oshijoPreview ? OSHIJO_CLOSING_MODE : "",
    claimAmount: oshijoPreview ? previewClaimAmount : 0,
    pitchCompletedAt: pitchCompleted ? Date.now() - 20_000 : 0,
    closingTurnsUsed: status === "oshijo_closing" ? 1 : 0,
    closingMediaCounts: status === "oshijo_closing" ? { text: 1, image: 0, audio: 0 } : {},
    turn: status === "extension_offer" ? 2 : 1,
    maxTurns: MAX_TURNS,
    entryFee: ENTRY_FEE,
    extensionIncentive: 10,
    paidAmount: status === "sold" ? previewPaidAmount : 0,
    salePrice: status === "sold" ? previewPaidAmount : 100,
    allIn: status === "sold" && oshijoPreview,
    rankingContribution: status === "sold" ? Math.min(OSHIJO_RANKING_CAP, previewPaidAmount) : 0,
    marketFee: status === "sold" && oshijoPreview ? 25 : 5,
    sellerProceeds: status === "sold" && oshijoPreview ? 480 : 97,
    certificateNumber: "OSHI-PREVIEW0000001",
    sellerIssueNumber: 13,
    rankingCounted: true,
  };
  state.relationshipFeedback = createRelationshipFeedbackState(state.roomId, false);
  if (status === "pitch" && role === "seller") state.pitchSentTurns.add(1);
  if (status === "oshijo_closing") {
    state.chatMessages.push({
      id: crypto.randomUUID(),
      uid: sellerUid,
      name: "SELLER TEST",
      text: "その警戒は当然だよ。だからこそ、この一枚を選んだ理由から聞いてほしい。",
      turn: 1,
      phase: "oshijo_closing",
      createdAt: Date.now(),
    });
  }
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#ff6b9c"/><stop offset=".55" stop-color="#7d4ba8"/><stop offset="1" stop-color="#102b4d"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="210" r="92" fill="#ffd36d"/><path d="M0 570L260 420 480 560 720 350 1200 610V800H0Z" fill="#101827" opacity=".78"/><text x="55" y="90" fill="white" font-family="sans-serif" font-size="42" font-weight="700">VALUE MARKET PREVIEW</text></svg>`;
  releaseRemoteImage();
  state.remoteImage = { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sampleSvg)}` };
  setMarketChrome("VALUE MARKET PREVIEW");
  render();
}

window.addEventListener("beforeunload", () => {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  state.activeUnsubscribe?.();
  state.walletUnsubscribe?.();
  cleanupRoom({ preserveOnDisconnect: true });
});

window.HariaiMarket = {
  start,
  openRankingsFromLanding,
  isActive,
  requestHome,
};
if (useMarketPreview) window.HariaiMarket.previewRoom = previewRoom;
window.dispatchEvent(new Event("hariai-market-ready"));
