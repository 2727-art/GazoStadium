import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";
import {
  IMAGE_MAX_COUNT,
  MENU_MAX_COUNT,
  BASE_BPM,
  MIN_BPM,
  MAX_BPM,
  TEMP_EFFECT_MS,
  UNITS,
  EFFECTS,
  FREE_PACK,
  normalizePack,
  normalizeBpm,
  normalizeUnit,
  countCandidates,
  drawMain,
  drawCount,
  applyEffect,
  resultSummary,
} from "./roulette-training-core.mjs?v=roulette-training-v1-count-all-out-v1";

const appRoot = document.querySelector("#app");
const rouletteTrainingAction = httpsCallable(functions, "rouletteTrainingAction");
const economyActionCallable = httpsCallable(functions, "economyAction");
const DRAFT_STORAGE_KEY = "hariai-roulette-training-draft-v1";
const CONFIG_STORAGE_KEY = "hariai-roulette-training-config-v1";
const SESSION_STORAGE_KEY = "hariai-roulette-training-session-v1";
const FINISH_RETRY_STORAGE_KEY = "hariai-roulette-training-finish-retry-v1";
const PUBLISH_ATTEMPT_STORAGE_KEY = "hariai-roulette-training-publish-attempt-v1";
const USE_ATTEMPT_STORAGE_KEY = "hariai-roulette-training-use-attempt-v1";
const LOCAL_OWNER_STORAGE_KEY = "hariai-roulette-training-local-owner-v1";
const X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクはパック作者が自己申告したものです。運営は作者とXアカウントの本人確認も、リンク先の内容確認も行っていません。外部サイトのx.comへ移動しますか？";
const IMAGE_DATABASE_NAME = "hariai-roulette-training-images-v1";
const IMAGE_STORE_NAME = "session-images";
const IMAGE_RECORD_KEY = "active";
const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PREVIEW_SCREENS = new Set([
  "hub",
  "setup",
  "editor",
  "market",
  "ranking",
  "creator-dashboard",
  "play",
  "fever",
  "all-out",
  "result",
  "result-completed",
  "result-empty",
]);
const TARGET_OPTIONS = Object.freeze([3, 5, 10]);
const REST_OPTIONS = Object.freeze([0, 15, 30]);
const PRICE_OPTIONS = Object.freeze([5, 10, 25]);
const RANKING_PERIODS = Object.freeze(["monthly", "lifetime"]);
const REEL_VISUAL_ROW_COUNT = Object.freeze({ main: 36, count: 30 });
const REEL_SPIN_DURATION_MS = Object.freeze({ main: 2_000, count: 1_600 });
const REEL_REDUCED_MOTION_DURATION_MS = 140;
const REEL_FALLBACK_BUFFER_MS = 420;
const CHEER_ROTATION_INTERVAL_MS = 8_000;
const CHEER_EXIT_DURATION_MS = 160;
const CHEER_ENTRY_DURATION_MS = 240;
const DEFAULT_CONFIG = Object.freeze({
  baseBpm: BASE_BPM,
  maximumBpm: MAX_BPM,
  intensity: "standard",
  restSeconds: 15,
  targetCount: 5,
  keepImages: false,
});
const EFFECT_PRESENTATIONS = Object.freeze({
  tempo_up: Object.freeze({ presentation: "tempo", rarity: "standard" }),
  tempo_down: Object.freeze({ presentation: "tempo", rarity: "standard" }),
  fever: Object.freeze({ presentation: "fever", rarity: "rare" }),
  slow: Object.freeze({ presentation: "slow", rarity: "standard" }),
  tempo_up_2: Object.freeze({ presentation: "tempo", rarity: "standard" }),
  tempo_down_2: Object.freeze({ presentation: "tempo", rarity: "standard" }),
  all_out_time: Object.freeze({ presentation: "all-out", rarity: "rare" }),
});
const DEFAULT_EFFECT_PRESENTATION = Object.freeze({ presentation: "standard", rarity: "standard" });
const RARE_PRESENTATION_SKIP_DELAY_MS = 600;
const PUBLIC_REPORT_REASONS = Object.freeze([
  Object.freeze({ id: "dangerous_exercise", label: "危険な運動指示" }),
  Object.freeze({ id: "stop_obstruction", label: "中止・休憩を妨げる表現" }),
  Object.freeze({ id: "harassment", label: "人格否定・脅迫・差別" }),
  Object.freeze({ id: "sexual", label: "性的・不適切な内容" }),
  Object.freeze({ id: "privacy", label: "個人情報・外部連絡先" }),
  Object.freeze({ id: "rights", label: "権利侵害" }),
  Object.freeze({ id: "external_trade", label: "外部取引への誘導" }),
  Object.freeze({ id: "other", label: "その他" }),
]);

let active = false;
let renderGeneration = 0;
let spinTimer = null;
let activeSpinAnimation = null;
let activeMarkerAnimation = null;
let activeSpinType = "";
let spinFeedbackTimers = [];
let decorationCleanupTimer = null;
let countdownTimer = null;
let workoutTicker = null;
let metronomeTimer = null;
let cheerRotationTimer = null;
let cheerTransitionTimer = null;
let temporaryEffectTimer = null;
let rarePresentationSkipTimer = null;
let rarePresentationStartedAt = 0;
let resultCountAnimationFrame = null;
let animatedResultKey = "";
let audioContext = null;
let imageDatabasePromise = null;
let pendingFinishRetryPromise = null;
let pendingFinishRetryUseId = "";
let pendingFinishRetryOwnerUid = "";
const pendingFinishRequests = new Map();
let volatileFinishRetryRecord = null;
let authResetPromise = null;
let authResetTargetUid = "";
const finishedPaidUseIds = new Set();
let state = createState();

function shared() {
  return window.HariaiApp?.shared || null;
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

function effectIdOf(value) {
  return String(value?.id || value?.effectId || value?.effect?.id || "");
}

function effectPresentation(value) {
  return EFFECT_PRESENTATIONS[effectIdOf(value)] || DEFAULT_EFFECT_PRESENTATION;
}

function sessionPresentation(session = state.session) {
  if (!session) return "";
  const candidates = [
    session.currentEffect,
    session.pendingTemporaryEffect,
    session.activeTemporaryEffect,
  ];
  if (session.pendingAllOutCount === true || session.currentAllOutCount === true
      || candidates.some((effect) => effectIdOf(effect) === "all_out_time")) {
    return "all-out";
  }
  if (candidates.some((effect) => effectIdOf(effect) === "fever")) return "fever";
  return "";
}

function roomDecorMarkup() {
  return `<div class="roulette-training-room-decor" aria-hidden="true"><i class="roulette-training-room-wallpaper"></i><i class="roulette-training-room-lamp-light"></i><i class="roulette-training-room-floor"></i><i class="roulette-training-room-baseboard"></i><i class="roulette-training-room-rug"></i></div>`;
}

function showToast(message) {
  shared()?.showToast?.(message);
}

function setBusy(busy, message = "") {
  shared()?.setBusy?.(busy, message);
}

function randomId(prefix) {
  const token = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${token}`.slice(0, 80);
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(key);
    return localStorage.getItem(key) === null;
  } catch {
    // Storage failures must not block the safety controls.
    return false;
  }
}

function localOwnerId() {
  const stored = String(readJson(LOCAL_OWNER_STORAGE_KEY, "") || "");
  if (/^roulette_local_[A-Za-z0-9_-]{12,64}$/u.test(stored)) return stored;
  const created = randomId("roulette_local");
  writeJson(LOCAL_OWNER_STORAGE_KEY, created);
  return created;
}

function operationGeneration() {
  return renderGeneration;
}

function generationIsCurrent(generation) {
  return active && generation === renderGeneration;
}

function unitInfo(value) {
  const normalized = normalizeUnit(value);
  if (normalized && typeof normalized === "object") return normalized;
  return UNITS.find((unit) => unit.id === normalized) || UNITS[0];
}

function normalizeConfig(value = {}) {
  const maximumBpm = normalizeBpm(value.maximumBpm ?? MAX_BPM, {
    minimum: MIN_BPM,
    maximum: MAX_BPM,
    fallback: MAX_BPM,
  });
  return {
    baseBpm: normalizeBpm(value.baseBpm ?? BASE_BPM, {
      minimum: MIN_BPM,
      maximum: maximumBpm,
      fallback: BASE_BPM,
    }),
    maximumBpm,
    intensity: value.intensity === "light" ? "light" : "standard",
    restSeconds: REST_OPTIONS.includes(Number(value.restSeconds)) ? Number(value.restSeconds) : 15,
    targetCount: TARGET_OPTIONS.includes(Number(value.targetCount)) ? Number(value.targetCount) : 5,
    keepImages: value.keepImages === true || value.keepImages === "true" || value.keepImages === "on",
  };
}

function blankMenu(index = 0) {
  return {
    id: `draft-menu-${index + 1}`,
    menuText: "",
    detailText: "",
    countUnit: "reps",
    cheerLines: [""],
  };
}

function blankDraft() {
  return {
    id: "local-draft",
    revision: 0,
    sellerName: "",
    title: "",
    description: "",
    price: 5,
    packId: "",
    baseRevision: 0,
    items: [blankMenu(0)],
  };
}

function normalizeEditorCheerLines(value, { validate = false, itemIndex = 0 } = {}) {
  const lines = String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);
  if (validate && (lines.length < 1 || lines.length > 4)) {
    throw new Error(`メニュー${itemIndex + 1}の応援台詞は1〜4行で入力してください。`);
  }
  if (validate && lines.some((line) => Array.from(line).length > 60)) {
    throw new Error(`メニュー${itemIndex + 1}の応援台詞は各行60文字以内で入力してください。`);
  }
  return validate
    ? lines
    : lines.slice(0, 4).map((line) => Array.from(line).slice(0, 60).join(""));
}

function restoreDraft() {
  const saved = readJson(DRAFT_STORAGE_KEY, null);
  if (!saved || typeof saved !== "object") return blankDraft();
  const currentUid = String(auth.currentUser?.uid || "");
  const savedUid = String(saved.ownerUid || "");
  const savedLocalOwner = String(saved.localOwnerId || "");
  const ownerMatches = savedUid
    ? currentUid === savedUid
    : (!currentUid && savedLocalOwner === localOwnerId());
  if (!ownerMatches) {
    removeStored(DRAFT_STORAGE_KEY);
    return blankDraft();
  }
  const items = Array.isArray(saved.items) && saved.items.length
    ? saved.items.slice(0, MENU_MAX_COUNT).map((item, index) => ({
      id: `draft-menu-${index + 1}`,
      menuText: String(item?.menuText || "").slice(0, 80),
      detailText: String(item?.detailText || "").slice(0, 120),
      countUnit: unitInfo(item?.countUnit).id,
      cheerLines: normalizeEditorCheerLines(
        (Array.isArray(item?.cheerLines) ? item.cheerLines : [""]).join("\n"),
      ),
    }))
    : [blankMenu(0)];
  return {
    ...blankDraft(),
    sellerName: String(saved.sellerName || "").slice(0, 16),
    title: String(saved.title || "").slice(0, 30),
    description: String(saved.description || "").slice(0, 120),
    price: PRICE_OPTIONS.includes(Number(saved.price)) ? Number(saved.price) : 5,
    packId: String(saved.packId || "").slice(0, 128),
    baseRevision: Number.isInteger(Number(saved.baseRevision)) ? Number(saved.baseRevision) : 0,
    items,
  };
}

function persistEditorDraft() {
  const ownerUid = String(auth.currentUser?.uid || state.uid || "");
  writeJson(DRAFT_STORAGE_KEY, {
    ...state.editorDraft,
    ownerUid,
    localOwnerId: ownerUid ? "" : localOwnerId(),
  });
}

function createState() {
  return {
    screen: "hub",
    loadingImages: false,
    images: [],
    selectedPack: FREE_PACK,
    selectedPackSource: "builtin",
    selectedMarketPack: null,
    config: normalizeConfig(readJson(CONFIG_STORAGE_KEY, DEFAULT_CONFIG)),
    editorDraft: blankDraft(),
    editorReviewPack: null,
    editorBusy: false,
    creatorLoading: false,
    bootstrapLoading: false,
    marketLoading: false,
    marketLoaded: false,
    marketError: "",
    marketPacks: [],
    marketView: "packs",
    rankingPeriod: "monthly",
    rankings: { monthly: null, lifetime: null },
    rankingLoading: { monthly: false, lifetime: false },
    rankingLoaded: { monthly: false, lifetime: false },
    rankingErrors: { monthly: "", lifetime: "" },
    ownPacks: [],
    purchasedRevisions: [],
    creatorStats: null,
    creatorStatsLoading: false,
    creatorStatsLoaded: false,
    creatorStatsError: "",
    profileBusy: false,
    notifiedCreatorAchievementIds: new Set(),
    activeUse: null,
    balance: null,
    policy: null,
    uid: "",
    authReady: false,
    session: null,
    result: null,
    countdownValue: 3,
    purchaseBusy: false,
    reportReason: "",
    reportBusy: false,
    recoveryAvailable: false,
    recoveryError: "",
    recoveryDiscardBusy: false,
    ending: false,
    finishRetryBusy: false,
  };
}

function previewRequest() {
  if (!LOCAL_PREVIEW_HOSTS.has(location.hostname)) return "";
  const requested = new URLSearchParams(location.search).get("rouletteTrainingPreview") || "";
  return PREVIEW_SCREENS.has(requested) ? requested : "";
}

function modeIsActiveElsewhere() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiDanwakuNote?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiAccount?.isActive?.(),
  );
}

function setModeChrome() {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = "<i></i> ROULETTE TRAINING";
  if (privacy) privacy.textContent = "画像・運動結果は端末内";
  if (footerItems[0]) footerItems[0].textContent = "SOLO ROULETTE TRAINING / SELF-REPORTED PLAY";
  if (footerItems[1]) footerItems[1].textContent = "画像・BPM・抽選結果・クリア／ギブアップはFirebaseへ送信しません";
  document.title = "ルーレットトレーニング | 貼り合いスタジアム";
}

function renderFrame(content, {
  eyebrow = "SOLO · ROULETTE",
  title = "ルーレットトレーニング",
  backLabel = "トップへ戻る",
  backAction = "home",
  showBack = true,
  showHeader = true,
} = {}) {
  return `<section class="screen roulette-training-screen" data-roulette-training-screen="${escapeHtml(state.screen)}" aria-label="${escapeHtml(title)}">
    ${showHeader ? `<header class="roulette-training-header">
      <div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1></div>
      ${showBack ? `<button class="button button-ghost roulette-training-back" type="button" data-roulette-action="${escapeHtml(backAction)}">${escapeHtml(backLabel)}</button>` : ""}
    </header>` : `<h1 class="sr-only">${escapeHtml(title)}</h1>`}
    <p class="roulette-training-announcer sr-only" id="rouletteTrainingAnnouncer" role="status" aria-live="polite"></p>
    ${content}
  </section>`;
}

function announce(message) {
  const live = document.querySelector("#rouletteTrainingAnnouncer");
  if (!live) return;
  live.textContent = "";
  window.setTimeout(() => {
    if (live.isConnected) live.textContent = message;
  }, 20);
}

function restoreFocusAfterRender(selector) {
  if (!selector) return;
  const control = document.querySelector(selector);
  if (control && !control.disabled) control.focus({ preventScroll: true });
}

function packItems(pack = state.selectedPack) {
  return Array.isArray(pack?.items) ? pack.items : [];
}

function packIdentity(pack) {
  return String(pack?.id || pack?.packId || "");
}

function packRevision(pack) {
  return Number(pack?.revision ?? pack?.currentRevision ?? 0) || 0;
}

function packFromServer(value) {
  const pack = value?.packSnapshot || value?.pack || value;
  const packId = String(pack?.id || pack?.packId || value?.packId || "market-pack");
  const items = (Array.isArray(pack?.items) ? pack.items : []).map((item, index) => ({
    id: String(item?.itemId || item?.id || `${packId}-menu-${index + 1}`),
    menuText: item?.menuText,
    detailText: item?.detailText || "",
    countUnit: item?.countUnit,
    cheerLines: item?.cheerLines,
  }));
  const normalized = normalizePack({
    id: packId,
    revision: pack?.revision ?? pack?.currentRevision ?? value?.revision ?? 0,
    sellerName: pack?.sellerName || pack?.authorName || "匿名作者",
    title: pack?.title,
    description: pack?.description || "",
    price: pack?.price,
    builtin: false,
    items,
  });
  return {
    ...normalized,
    status: String(pack?.status || value?.status || "active"),
    isOwn: pack?.isOwn === true || value?.isOwn === true,
    publicSellerId: String(pack?.publicSellerId || value?.publicSellerId || ""),
  };
}

function purchasedRevisionFromServer(value) {
  const use = value && typeof value === "object" ? value : {};
  const pack = packFromServer(use.pack || use.packSnapshot || use);
  return {
    ...pack,
    reportOnly: true,
    purchasedUseId: String(use.id || use.useId || ""),
    purchasedFinishedAt: Number(use.finishedAt || 0),
  };
}

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizedXHandle(value) {
  const handle = String(value || "").normalize("NFKC").trim().replace(/^@/u, "");
  return /^[A-Za-z0-9_]{1,15}$/u.test(handle) ? handle : "";
}

function publicXProfile(value) {
  const profile = value && typeof value === "object" ? value : {};
  const xHandle = normalizedXHandle(profile.xHandle);
  return {
    xPublic: profile.xPublic === true && Boolean(xHandle),
    xHandle: profile.xPublic === true ? xHandle : "",
    updatedAt: nonnegativeInteger(profile.updatedAt),
  };
}

function rankingPayloadFromServer(value, requestedPeriod = "monthly") {
  const source = value && typeof value === "object" ? value : {};
  const period = RANKING_PERIODS.includes(source.period) ? source.period : requestedPeriod;
  const minimumUniqueBuyers = Math.max(1, nonnegativeInteger(source.minimumUniqueBuyers || 3));
  let previousPrimary = -1;
  let previousSecondary = -1;
  let competitionRank = 0;
  const eligibleRows = (Array.isArray(source.rows) ? source.rows : [])
    .filter((row) => nonnegativeInteger(row?.uniqueBuyers) >= minimumUniqueBuyers)
    .slice(0, 20);
  const rows = eligibleRows.map((row, index) => {
    const uniqueBuyers = nonnegativeInteger(row?.uniqueBuyers);
    const rankingUseCount = nonnegativeInteger(row?.rankingUseCount);
    if (uniqueBuyers !== previousPrimary || rankingUseCount !== previousSecondary) {
      competitionRank = index + 1;
      previousPrimary = uniqueBuyers;
      previousSecondary = rankingUseCount;
    }
    const profile = publicXProfile(row);
    const packId = String(row?.packId || row?.id || "").slice(0, 128);
    let pack = null;
    if (row?.pack && typeof row.pack === "object") {
      try {
        const candidate = packFromServer(row.pack);
        if (packIdentity(candidate) === packId && candidate.status === "active") pack = candidate;
      } catch {
        pack = null;
      }
    }
    return {
      rank: competitionRank,
      packId,
      title: String(row?.title || "名称未設定のパック").slice(0, 80),
      sellerName: String(row?.sellerName || "匿名作者").slice(0, 32),
      publicSellerId: String(row?.publicSellerId || "").slice(0, 64),
      price: nonnegativeInteger(row?.price),
      revision: nonnegativeInteger(row?.revision || row?.currentRevision),
      uniqueBuyers,
      rankingUseCount,
      xPublic: profile.xPublic,
      xHandle: profile.xHandle,
      updatedAt: nonnegativeInteger(row?.updatedAt),
      pack,
    };
  }).filter((row) => row.packId);
  return {
    period,
    periodKey: String(source.periodKey || (period === "lifetime" ? "lifetime" : "")),
    updatedAt: nonnegativeInteger(source.updatedAt),
    minimumUniqueBuyers,
    rows,
  };
}

function salesStatsFromServer(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    actualGross: nonnegativeInteger(source.actualGross),
    rankingGross: nonnegativeInteger(source.rankingGross),
    netSales: nonnegativeInteger(source.netSales),
    feesPaid: nonnegativeInteger(source.feesPaid),
    useCount: nonnegativeInteger(source.useCount),
    rankingUseCount: nonnegativeInteger(source.rankingUseCount),
    uniqueBuyers: nonnegativeInteger(source.uniqueBuyers),
    packCount: nonnegativeInteger(source.packCount),
    updatedAt: nonnegativeInteger(source.updatedAt),
  };
}

function creatorStatsFromServer(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    profile: publicXProfile(source.profile),
    periodKey: String(source.periodKey || ""),
    lifetime: salesStatsFromServer(source.lifetime || source.stats?.lifetime),
    monthly: salesStatsFromServer(source.monthly || source.stats?.monthly),
    packs: (Array.isArray(source.packs) ? source.packs : []).map((pack) => ({
      id: String(pack?.id || pack?.packId || "").slice(0, 128),
      title: String(pack?.title || "名称未設定のパック").slice(0, 80),
      status: String(pack?.status || "hidden"),
      moderationStatus: String(pack?.moderationStatus || "clear"),
      price: nonnegativeInteger(pack?.price),
      revision: nonnegativeInteger(pack?.revision || pack?.currentRevision),
      uniqueBuyers: nonnegativeInteger(pack?.uniqueBuyers),
      rankingUseCount: nonnegativeInteger(pack?.rankingUseCount),
      remainingUniqueBuyers: nonnegativeInteger(pack?.remainingUniqueBuyers),
      eligible: pack?.eligible === true,
      updatedAt: nonnegativeInteger(pack?.updatedAt),
    })).filter((pack) => pack.id),
    achievements: source.achievements && typeof source.achievements === "object"
      ? source.achievements
      : null,
    updatedAt: nonnegativeInteger(source.updatedAt),
  };
}

function rankingPeriodLabel(payload, period) {
  if (period === "lifetime") return "累計";
  const match = /^(\d{4})-(\d{2})$/u.exec(String(payload?.periodKey || ""));
  return match ? `${Number(match[1])}年${Number(match[2])}月` : "今月";
}

function formattedUpdateTime(value) {
  const timestamp = nonnegativeInteger(value);
  if (!timestamp) return "";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
}

function seedMarketInsightsPreview(preview) {
  if (!["ranking", "creator-dashboard"].includes(preview)) return;
  const now = Date.now();
  const rowFacts = [
    { packId: "preview-ranking-1", title: "夜ふかし前のやさしい全身メニュー", sellerName: "あんじゅ", publicSellerId: "RT-ANJU", price: 10, revision: 3, uniqueBuyers: 18, rankingUseCount: 31, xPublic: true, xHandle: "anju_example", updatedAt: now },
    { packId: "preview-ranking-2", title: "椅子でゆっくり10分トレ", sellerName: "ホームトレーナー", publicSellerId: "RT-HOME", price: 5, revision: 1, uniqueBuyers: 12, rankingUseCount: 20, updatedAt: now - 30_000 },
    { packId: "preview-ranking-3", title: "推しに応援されるスクワット帳", sellerName: "応援係", publicSellerId: "RT-CHEER", price: 25, revision: 2, uniqueBuyers: 12, rankingUseCount: 20, updatedAt: now - 60_000 },
    { packId: "preview-ranking-4", title: "寝る前ストレッチ＆体幹", sellerName: "夜の部屋", publicSellerId: "RT-NIGHT", price: 10, revision: 4, uniqueBuyers: 8, rankingUseCount: 15, updatedAt: now - 90_000 },
  ];
  const rows = rowFacts.map((row, index) => ({
    ...row,
    pack: {
      id: row.packId,
      sellerName: row.sellerName,
      publicSellerId: row.publicSellerId,
      title: row.title,
      description: "自分のペースで取り組める、プレビュー用の公開トレーニングメニューです。",
      price: row.price,
      revision: row.revision,
      status: "active",
      moderationStatus: "clear",
      isOwn: index === 0,
      items: FREE_PACK.items.map((item, itemIndex) => ({
        id: `preview-${index + 1}-${itemIndex + 1}`,
        itemId: `preview-${index + 1}-${itemIndex + 1}`,
        menuText: itemIndex === 0 ? row.title : item.menuText,
        detailText: item.detailText || "無理のない範囲で行います。",
        countUnit: item.countUnit,
        cheerLines: [...(item.cheerLines || ["自分のペースで進めよう。"])],
      })),
    },
  }));
  state.rankings.monthly = rankingPayloadFromServer({
    period: "monthly",
    periodKey: "2026-09",
    minimumUniqueBuyers: 3,
    rows,
    updatedAt: now,
  });
  state.rankings.lifetime = rankingPayloadFromServer({
    period: "lifetime",
    periodKey: "lifetime",
    minimumUniqueBuyers: 3,
    rows: rows.map((row) => ({
      ...row,
      uniqueBuyers: row.uniqueBuyers * 4,
      rankingUseCount: row.rankingUseCount * 4,
    })),
    updatedAt: now,
  });
  state.rankingLoaded = { monthly: true, lifetime: true };
  state.marketPacks = rows.map((row) => packFromServer(row.pack));
  state.marketLoaded = true;
  state.balance = 120;
  if (preview === "ranking") {
    state.screen = "market";
    state.marketView = "ranking";
    return;
  }
  const unlocked = {};
  rouletteAchievementDefinitions()
    .filter((definition) => Number(definition.target) <= (definition.family === "roulette_training_pack_uses" ? 10 : 3))
    .forEach((definition) => { unlocked[definition.id] = now - 86_400_000; });
  state.creatorStats = creatorStatsFromServer({
    profile: { xPublic: true, xHandle: "anju_example", updatedAt: now },
    periodKey: "2026-09",
    monthly: { actualGross: 70, netSales: 56, feesPaid: 14, useCount: 7, rankingUseCount: 5, uniqueBuyers: 4, updatedAt: now },
    lifetime: { actualGross: 180, netSales: 144, feesPaid: 36, useCount: 18, rankingUseCount: 12, uniqueBuyers: 7, packCount: 2, updatedAt: now },
    packs: [
      { id: "preview-own-1", title: "夜ふかし前のやさしい全身メニュー", status: "active", moderationStatus: "clear", price: 10, revision: 3, uniqueBuyers: 5, rankingUseCount: 8, remainingUniqueBuyers: 0, eligible: true, updatedAt: now },
      { id: "preview-own-2", title: "椅子でできる朝のミニメニュー", status: "active", moderationStatus: "clear", price: 5, revision: 1, uniqueBuyers: 1, rankingUseCount: 1, remainingUniqueBuyers: 2, eligible: false, updatedAt: now },
    ],
    achievements: { unlocked, pendingUnlocks: [], stats: { rouletteTraining: { rankingUseCount: 12, uniqueBuyers: 7 } } },
    updatedAt: now,
  });
  state.creatorStatsLoaded = true;
  state.screen = "creator_dashboard";
}

function friendlyError(error, fallback = "操作を完了できませんでした。") {
  const message = String(error?.message || "").replace(/^FirebaseError:\s*/u, "").trim();
  if (/確認画面から変わ|価格またはパックが更新|最新の内容/u.test(message)) {
    return "残高・価格・改訂が更新されています。最新の内容をもう一度確認してください。";
  }
  if (/insufficient|残高が不足/u.test(message)) return "AnjuPay残高が不足しています。";
  if (/unauthenticated|認証/u.test(message)) return "匿名アカウントを準備できませんでした。もう一度お試しください。";
  if (/failed-precondition|改訂|価格/u.test(message)) return "公開内容または価格が更新されています。最新の内容を確認してください。";
  if (/unavailable|network|fetch|offline/u.test(message)) return "通信できませんでした。無料パックはオフラインでも遊べます。";
  return message || fallback;
}

function requiresFreshReview(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return /failed-precondition/u.test(code)
    && /残高|価格|改訂|更新|確認画面/u.test(message);
}

function paidRecoveryIsDefinitivelyUnavailable(error) {
  const code = String(error?.code || "").toLowerCase();
  return code === "functions/not-found"
    || code === "functions/failed-precondition";
}

function hasUnboundLocalOwnerData() {
  const savedSession = readJson(SESSION_STORAGE_KEY, null);
  const savedDraft = readJson(DRAFT_STORAGE_KEY, null);
  return Boolean(
    (savedSession && !savedSession.ownerUid)
    || (savedDraft && !savedDraft.ownerUid)
    || (state.session?.localOwnerId && !state.session?.ownerUid)
    || (state.recoveryAvailable && !savedSession?.ownerUid)
    || state.images.length > 0
    || state.loadingImages
  );
}

async function ensureUser() {
  const generation = operationGeneration();
  const previousUid = String(state.uid || "");
  await setPersistence(auth, browserLocalPersistence);
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  if (generationIsCurrent(generation)) {
    if (active && !previousUid && hasUnboundLocalOwnerData()) {
      await handleActiveAuthUidChange(user.uid, "local-owner");
      return user;
    }
    if (active && previousUid && previousUid !== user.uid) return user;
    state.uid = user.uid;
    state.authReady = true;
  }
  return user;
}

async function callRouletteTrainingAction(action, payload = {}) {
  if (useOfflineMarketPreview) throw new Error("offline-preview");
  const actionGeneration = operationGeneration();
  const expectedUid = String(state.uid || "");
  const user = await ensureUser();
  if (!generationIsCurrent(actionGeneration)) {
    throw new Error("利用中のアカウントが変わったため、この操作を中止しました。");
  }
  if (active && expectedUid && expectedUid !== user.uid) {
    await handleActiveAuthUidChange(user.uid, expectedUid);
    throw new Error("アカウントが切り替わったため、この操作を中止しました。新しいアカウントで内容を確認し直してください。");
  }
  const response = await rouletteTrainingAction({ action, ...payload });
  return response?.data || {};
}

function actionIdFor(prefix) {
  return randomId(prefix);
}

function pendingActionId(storageKey, signature, prefix) {
  const stored = readJson(storageKey, null);
  if (stored?.signature === signature && /^[A-Za-z0-9_-]{16,80}$/u.test(String(stored.actionId || ""))) {
    return stored.actionId;
  }
  const actionId = actionIdFor(prefix);
  writeJson(storageKey, { signature, actionId });
  return actionId;
}

function renderHub() {
  const hasRecovery = state.recoveryAvailable === true;
  const savedRecovery = hasRecovery ? readJson(SESSION_STORAGE_KEY, null) : null;
  const savedPaidUseId = String(savedRecovery?.paidUseId || "");
  const activeUseId = String(state.activeUse?.id || state.activeUse?.useId || "");
  const terminalUseId = terminalFinishUseId();
  const hasMatchingPaidRecovery = Boolean(savedPaidUseId && activeUseId === savedPaidUseId && activeUseId !== terminalUseId);
  let continuation = "";
  if (state.bootstrapLoading) {
    continuation = `<p class="roulette-training-market-status" role="status">開始済みの利用と端末内の復旧データを確認しています…</p>`;
  } else if (hasMatchingPaidRecovery) {
    continuation = `<button class="roulette-training-recovery" type="button" data-roulette-action="resume-local"><strong>進行中の有料トレーニングへ戻る</strong><span>所有権を再確認して、画像・抽選結果・クリア数・一時停止状態を端末から復元します。</span></button>`;
  } else if (state.activeUse && !finishUseIsFenced(activeUseId)) {
    continuation = `<button class="roulette-training-active-use" type="button" data-roulette-action="resume-paid"><strong>開始済みの有料パックを続ける</strong><span>追加課金なしで準備画面へ戻れます。終了する場合も、準備画面からギブアップできます。</span></button>`;
  } else if (hasRecovery && !savedPaidUseId) {
    continuation = `<div class="roulette-training-recovery-choice"><button class="roulette-training-recovery" type="button" data-roulette-action="resume-local"><strong>前回の画面に戻る</strong><span>端末内に残っているルーレット結果を復元します</span></button><button class="button button-ghost" type="button" data-roulette-action="discard-recovery" ${state.recoveryDiscardBusy ? "disabled" : ""}>${state.recoveryDiscardBusy ? "前回データを削除中…" : "前回データを破棄して新しく始める"}</button></div>`;
  } else if (terminalUseId) {
    continuation = `<div class="roulette-training-market-error" role="status"><p>前回の有料利用を終了処理中です。同じ利用の再開や市場・販売機能は、終了確認後に利用できます。</p><div class="roulette-training-review-actions"><button class="button button-ghost" type="button" data-roulette-action="retry-finish" ${state.finishRetryBusy ? "disabled" : ""}>${state.finishRetryBusy ? "終了を確認中…" : "終了処理を再試行"}</button><button class="button button-cyan" type="button" data-roulette-action="choose-free">公式無料パックで遊ぶ</button></div></div>`;
  } else if (hasRecovery) {
    continuation = `<button class="roulette-training-recovery" type="button" data-roulette-action="resume-local"><strong>前回の画面に戻る</strong><span>端末内に残っているルーレット結果を復元します</span></button>`;
  }
  if (state.recoveryError && !state.bootstrapLoading) {
    continuation += `<p class="roulette-training-market-status" role="status">${escapeHtml(state.recoveryError)}</p>`;
  }
  const showHubActions = !state.bootstrapLoading && !state.activeUse && !terminalUseId && !hasRecovery;
  return renderFrame(`<div class="roulette-training-hub">
    <section class="roulette-training-intro">
      <div class="roulette-training-intro-copy">
        <span class="roulette-training-kicker">SPIN · MOVE · CLEAR</span>
        <h2>回すたび、テンポとメニューが変わる。</h2>
        <p>好きな画像の下で縦ドラムを回し、出たメニューをメトロノームに合わせて行う、ひとり用のトレーニングです。</p>
      </div>
      <div class="roulette-training-intro-reel" aria-hidden="true"><span>テンポUP</span><strong>トレーニング</strong><span>フィーバー</span></div>
    </section>
    ${continuation}
    ${showHubActions ? `<div class="roulette-training-hub-actions">
      <button class="roulette-training-hub-card is-primary" type="button" data-roulette-action="choose-free">
        <small>FREE START</small><strong>無料パックで試す</strong><span>公式の${packItems(FREE_PACK).length}メニューですぐ遊ぶ</span>
      </button>
      <button class="roulette-training-hub-card" type="button" data-roulette-action="open-editor">
        <small>CREATOR</small><strong>メニューを作る・販売</strong><span>自由入力のメニューと応援台詞を最大10個</span>
      </button>
      <button class="roulette-training-hub-card" type="button" data-roulette-action="open-market">
        <small>MENU MARKET</small><strong>販売中パックを選ぶ</strong><span>全文と価格を確認してから1セッション開始</span>
      </button>
    </div>` : ""}
    <aside class="roulette-training-safety-note">
      <strong>テンポは運動強度そのものではなく、動く速さの目安です。</strong>
      <p>体調と動ける範囲を優先し、痛み・めまい・強い息苦しさなどを感じたら「ギブアップ」で止めてください。ギブアップによるペナルティはありません。</p>
    </aside>
    <p class="roulette-training-privacy">選んだ画像、BPM、抽選結果、クリア／ギブアップは端末内だけで扱います。販売パックの公開・利用開始・通報だけFirebaseへ送信します。</p>
  </div>`, { showBack: true });
}

function imageTile(image, index) {
  return `<figure class="roulette-training-image-tile">
    <img src="${escapeHtml(image.url)}" alt="選択画像 ${index + 1}" />
    <button type="button" data-roulette-remove-image="${index}" aria-label="選択画像${index + 1}を外す">×</button>
    <figcaption>${index + 1}</figcaption>
  </figure>`;
}

function configOption(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function saleSettlement(price) {
  const amount = Number(price) || 0;
  const basisPoints = Number(state.policy?.successFeeBasisPoints ?? 2_000);
  const minimumFee = Number(state.policy?.minimumSuccessFee ?? 1);
  const fee = Math.max(minimumFee, Math.floor((amount * basisPoints) / 10_000));
  return { fee, proceeds: Math.max(0, amount - fee) };
}

function priceOptionLabel(price) {
  const settlement = saleSettlement(price);
  return `${price} Pay（作者受取 ${settlement.proceeds}／手数料 ${settlement.fee}）`;
}

function renderSetup() {
  const pack = state.selectedPack || FREE_PACK;
  const images = state.images.map(imageTile).join("");
  return renderFrame(`<div class="roulette-training-setup-grid">
    <section class="roulette-training-panel roulette-training-pack-summary">
      <span class="roulette-training-panel-label">SELECTED MENU PACK</span>
      <h2>${escapeHtml(pack.title)}</h2>
      <p>${escapeHtml(pack.description || "")}</p>
      <dl><div><dt>作者</dt><dd>${escapeHtml(pack.sellerName || "匿名作者")}</dd></div><div><dt>メニュー</dt><dd>${packItems(pack).length}個</dd></div><div><dt>利用</dt><dd>${Number(pack.price || 0) > 0 ? `${Number(pack.price)} Pay / 1セッション` : "無料"}</dd></div></dl>
      ${state.activeUse ? `<p class="roulette-training-active-pack-note">開始済みの利用です。このパックを続けるか、準備画面下部の「ギブアップ」で終了してください。</p>` : `<button class="button button-ghost" type="button" data-roulette-action="hub">別のパックを選ぶ</button>`}
    </section>
    <form class="roulette-training-panel roulette-training-setup-form" id="rouletteTrainingSetupForm">
      <div class="roulette-training-section-heading"><span>01</span><div><h2>画像を選ぶ</h2><p>1〜${IMAGE_MAX_COUNT}枚。画像はサーバーへ送信しません。</p></div></div>
      <label class="roulette-training-file-button ${state.loadingImages ? "is-busy" : ""}">
        <strong>${state.images.length ? "画像を選び直す" : "画像を選ぶ"}</strong>
        <span>複数選択できます（最大${IMAGE_MAX_COUNT}枚）</span>
        <input id="rouletteTrainingImages" type="file" accept="image/*" multiple ${state.loadingImages ? "disabled" : ""} />
      </label>
      <div class="roulette-training-image-grid" aria-label="選択中の画像">${images || `<p class="roulette-training-empty">まだ画像を選択していません。</p>`}</div>
      <div class="roulette-training-section-heading"><span>02</span><div><h2>テンポとゴール</h2><p>開始前に自分の体調へ合わせてください。</p></div></div>
      <div class="roulette-training-config-grid">
        <label><span>開始BPM</span><input name="baseBpm" type="range" min="${MIN_BPM}" max="${state.config.maximumBpm}" step="5" value="${state.config.baseBpm}" /><output data-roulette-output="baseBpm">${state.config.baseBpm}</output></label>
        <label><span>BPM上限</span><input name="maximumBpm" type="range" min="${MIN_BPM}" max="${MAX_BPM}" step="5" value="${state.config.maximumBpm}" /><output data-roulette-output="maximumBpm">${state.config.maximumBpm}</output></label>
        <label><span>休憩</span><select name="restSeconds">${REST_OPTIONS.map((value) => configOption(value, value ? `${value}秒` : "なし", state.config.restSeconds)).join("")}</select></label>
        <label><span>目標クリア数</span><select name="targetCount">${TARGET_OPTIONS.map((value) => configOption(value, `${value}回`, state.config.targetCount)).join("")}</select></label>
      </div>
      <label class="roulette-training-image-consent"><input name="keepImages" type="checkbox" ${state.config.keepImages ? "checked" : ""} /><span><strong>再読み込みに備えて画像をこの端末へ保存する</strong><small>既定はOFFです。ONにした画像もFirebaseや作者には送信されません。</small></span></label>
      <aside class="roulette-training-setup-check"><strong>開始後の判定は自己申告です。</strong><span>できたら「クリア」、続けられない時は「ギブアップ」を押します。</span></aside>
      <button class="button button-primary roulette-training-start-button" type="submit" ${state.images.length < 1 || state.loadingImages ? "disabled" : ""}>ルーレットトレーニング開始</button>
      ${state.activeUse ? `<aside class="roulette-training-setup-abandon"><div><strong>画像を用意できない時も、この利用を終了できます。</strong><span>返金はありませんが、追加料金や結果送信もありません。0クリアの結果画面へ進みます。</span></div><button class="button button-danger" type="button" data-roulette-action="give-up-before-start">ギブアップ</button></aside>` : ""}
    </form>
  </div>`, { backLabel: "入口へ戻る", backAction: "hub" });
}

function editorMenuCard(item, index) {
  const cheerText = (Array.isArray(item.cheerLines) ? item.cheerLines : [""]).join("\n");
  return `<fieldset class="roulette-training-editor-item" data-roulette-editor-item="${index}">
    <legend><span>MENU ${String(index + 1).padStart(2, "0")}</span><strong>ルーレット項目 ${index + 1}</strong></legend>
    <label><span>トレーニングメニュー</span><input name="menuText-${index}" type="text" maxlength="80" value="${escapeHtml(item.menuText)}" placeholder="例：ゆっくりスクワット" required /></label>
    <label><span>やり方・補足（任意）</span><textarea name="detailText-${index}" maxlength="120" rows="3" placeholder="動き方や必要な道具など">${escapeHtml(item.detailText || "")}</textarea></label>
    <label><span>回数ルーレットの単位</span><select name="countUnit-${index}">${UNITS.map((unit) => configOption(unit.id, unit.label, item.countUnit)).join("")}</select></label>
    <label><span>応援台詞</span><textarea name="cheerLines-${index}" rows="4" placeholder="1行につき1台詞、最大4行" required>${escapeHtml(cheerText)}</textarea><small>1〜4行・各行60文字以内。画像の吹き出しへ表示し、トレーニング中は8秒ごとに入力順で切り替わります（1行なら固定）。文章中の数字は回数やBPMに反映されません。</small></label>
    ${state.editorDraft.items.length > 1 ? `<button class="button button-ghost" type="button" data-roulette-remove-menu="${index}">この項目を削除</button>` : ""}
  </fieldset>`;
}

function renderEditor() {
  const draft = state.editorDraft;
  const finishBlocked = Boolean(terminalFinishUseId());
  return renderFrame(`<form class="roulette-training-editor" id="rouletteTrainingEditorForm">
    <section class="roulette-training-panel roulette-training-editor-about">
      <span class="roulette-training-panel-label">CREATOR WORKSHOP</span>
      <h2>自由なメニューと応援を作る</h2>
      <p>「何をするか」と「どう応援するか」は作者が自由に入力できます。正式な回数とBPMはゲームが決めます。</p>
      <div class="roulette-training-editor-meta">
        <label><span>作者名</span><input name="sellerName" type="text" maxlength="16" value="${escapeHtml(draft.sellerName)}" required /></label>
        <label><span>パック名</span><input name="title" type="text" maxlength="30" value="${escapeHtml(draft.title)}" required /></label>
        <label class="is-wide"><span>パックの説明</span><textarea name="description" minlength="10" maxlength="120" rows="3" required>${escapeHtml(draft.description)}</textarea><small>10〜120文字で、パック全体の内容を説明します。</small></label>
        <label><span>販売価格</span><select name="price">${PRICE_OPTIONS.map((price) => configOption(price, priceOptionLabel(price), draft.price)).join("")}</select><small>売れた時の成功手数料は20%（最低1 Pay）です。</small></label>
      </div>
    </section>
    <div class="roulette-training-editor-items">${draft.items.map(editorMenuCard).join("")}</div>
    <div class="roulette-training-editor-actions">
      <button class="button button-ghost" type="button" data-roulette-action="add-menu" ${finishBlocked || state.creatorLoading || draft.items.length >= MENU_MAX_COUNT ? "disabled" : ""}>＋ メニューを追加（${draft.items.length}/${MENU_MAX_COUNT}）</button>
      <button class="button button-cyan" type="button" data-roulette-action="test-draft" ${finishBlocked || state.creatorLoading ? "disabled" : ""}>${finishBlocked ? "前回利用の終了確認待ち" : state.creatorLoading ? "利用状態を確認中…" : "この端末で無料テスト"}</button>
      <button class="button button-primary" type="submit" ${finishBlocked || state.creatorLoading ? "disabled" : ""}>販売内容を確認</button>
    </div>
    <aside class="roulette-training-safety-note"><strong>公開前に確認される内容</strong><p>危険な運動の強制、痛みや体調不良を無視させる表現、停止を妨げる表現、人格否定・脅迫、個人情報や外部取引への誘導などは販売できません。</p></aside>
  </form>`, { backLabel: "入口へ戻る", backAction: "hub" });
}

function menuDisclosure(pack, { showCounts = true } = {}) {
  return `<ol class="roulette-training-menu-disclosure">${packItems(pack).map((item) => {
    const unit = unitInfo(item.countUnit);
    const counts = countCandidates(unit.id, "standard");
    return `<li><div><strong>${escapeHtml(item.menuText)}</strong>${item.detailText ? `<p>${escapeHtml(item.detailText)}</p>` : ""}<span>単位：${escapeHtml(unit.label)}${showCounts ? ` ／ 通常候補：${counts.map((count) => `${count}${unit.label}`).join("・")}` : ""}</span></div><blockquote>${(item.cheerLines || []).map((line) => `<span>「${escapeHtml(line)}」</span>`).join("")}</blockquote></li>`;
  }).join("")}</ol>`;
}

function renderEditorReview() {
  const pack = state.editorReviewPack;
  if (!pack) {
    state.screen = "editor";
    return renderEditor();
  }
  const publishFee = Number(state.policy?.publishFee ?? 1);
  const hasBalance = Number.isFinite(state.balance);
  const afterBalance = hasBalance ? state.balance - publishFee : null;
  const settlement = saleSettlement(pack.price);
  return renderFrame(`<div class="roulette-training-review">
    <section class="roulette-training-panel">
      <span class="roulette-training-panel-label">PUBLISH REVIEW</span>
      <h2>${escapeHtml(pack.title)}</h2>
      <p>${escapeHtml(pack.description || "説明なし")}</p>
      <dl class="roulette-training-review-facts"><div><dt>作者</dt><dd>${escapeHtml(pack.sellerName)}</dd></div><div><dt>販売価格</dt><dd>${pack.price} Pay</dd></div><div><dt>購入1件の成功手数料</dt><dd>${settlement.fee} Pay</dd></div><div><dt>購入1件の作者受取</dt><dd>${settlement.proceeds} Pay</dd></div><div><dt>メニュー</dt><dd>${pack.items.length}個</dd></div><div><dt>現在残高</dt><dd>${hasBalance ? `${state.balance} Pay` : "確認中…"}</dd></div><div><dt>公開・改訂料</dt><dd>${publishFee} Pay</dd></div><div><dt>公開後残高</dt><dd>${afterBalance === null ? "確認中…" : `${afterBalance} Pay`}</dd></div></dl>
      ${menuDisclosure(pack)}
    </section>
    <aside class="roulette-training-publish-warning"><strong>公開・改訂には${publishFee} Pay、売れた時には20%（最低1 Pay）の成功手数料がかかります。</strong><p>この価格では購入1件につき作者受取は${settlement.proceeds} Payです。購入者は、ここに表示された全メニューと全応援台詞を支払い前に確認できます。公開後の変更は新しい改訂として扱われます。</p></aside>
    <div class="roulette-training-review-actions"><button class="button button-ghost" type="button" data-roulette-action="back-editor">編集へ戻る</button><button class="button button-primary" type="button" data-roulette-action="publish" ${state.editorBusy || !hasBalance || afterBalance < 0 ? "disabled" : ""}>${state.editorBusy ? "公開処理中…" : !hasBalance ? "残高を確認中…" : afterBalance < 0 ? "残高が不足しています" : "この内容で販売する"}</button></div>
  </div>`, { backLabel: "編集へ戻る", backAction: "back-editor" });
}

function xProfileLink(value) {
  const profile = publicXProfile(value);
  if (!profile.xPublic || !profile.xHandle) return "";
  const label = `Xの自己申告プロフィール @${profile.xHandle} を新しいタブで開く（外部サイト）`;
  return `<span class="roulette-training-ranking-x"><button type="button" data-roulette-x-profile="${escapeHtml(profile.xHandle)}" aria-label="${escapeHtml(label)}"><b aria-hidden="true">X</b><span>（外部）@${escapeHtml(profile.xHandle)}</span><i aria-hidden="true">↗</i></button><small>作者の自己申告・本人未確認</small></span>`;
}

function openConfirmedXProfile(handleValue) {
  const handle = normalizedXHandle(handleValue);
  if (!handle || !window.confirm(X_EXTERNAL_CONFIRM_MESSAGE)) return;
  const externalWindow = window.open(
    `https://x.com/${encodeURIComponent(handle)}`,
    "_blank",
    "noopener,noreferrer",
  );
  if (externalWindow) externalWindow.opener = null;
}

function rankingRow(row, index) {
  const headingId = `rouletteTrainingRankingRow-${state.rankingPeriod}-${index}`;
  const sellerId = row.publicSellerId
    ? `<code title="ゲーム内の作者ID">作者ID ${escapeHtml(row.publicSellerId)}</code>`
    : "";
  return `<article class="roulette-training-ranking-row${row.rank <= 3 ? ` is-rank-${row.rank}` : ""}" role="listitem" aria-labelledby="${headingId}">
    <div class="roulette-training-ranking-place" aria-label="${row.rank}位"><strong>${row.rank}</strong><small>位</small></div>
    <div class="roulette-training-ranking-copy">
      <span class="roulette-training-ranking-revision">販売中・改訂${row.revision || 1}</span>
      <h3 id="${headingId}">${escapeHtml(row.title)}</h3>
      <p><span>作者 ${escapeHtml(row.sellerName)}</span>${sellerId}</p>
      ${xProfileLink(row)}
    </div>
    <dl class="roulette-training-ranking-numbers">
      <div class="is-primary"><dt>異なる購入者</dt><dd>${row.uniqueBuyers}<small>人</small></dd></div>
      <div><dt>対象利用</dt><dd>${row.rankingUseCount}<small>回</small></dd></div>
      <div><dt>現在価格</dt><dd>${row.price ? `${row.price}<small> Pay</small>` : "無料"}</dd></div>
    </dl>
    <button class="button button-ghost roulette-training-ranking-detail" type="button" data-roulette-ranked-pack="${escapeHtml(row.packId)}">内容を見る</button>
  </article>`;
}

function renderRankingPanel() {
  const period = state.rankingPeriod;
  const payload = state.rankings[period];
  const loading = state.rankingLoading[period];
  const error = state.rankingErrors[period];
  const rows = payload?.rows || [];
  const updated = formattedUpdateTime(payload?.updatedAt);
  const minimum = nonnegativeInteger(payload?.minimumUniqueBuyers || 3) || 3;
  let body = "";
  if (loading && !payload) {
    body = `<div class="roulette-training-ranking-empty" role="status"><strong>ランキングを読み込んでいます…</strong><span>販売パックだけを集計しています。</span></div>`;
  } else if (error && !payload) {
    body = `<div class="roulette-training-ranking-empty is-error" role="status"><strong>ランキングを読み込めませんでした</strong><span>${escapeHtml(error)}</span><button class="button button-ghost" type="button" data-roulette-action="reload-rankings">再読み込み</button></div>`;
  } else if (!rows.length) {
    body = `<div class="roulette-training-ranking-empty"><strong>${escapeHtml(rankingPeriodLabel(payload, period))}は、掲載条件を満たすパックがまだありません</strong><span>現在の内容を利用した異なる購入者が${minimum}人になると掲載対象です。</span></div>`;
  } else {
    body = `<div class="roulette-training-ranking-list" role="list">${rows.map(rankingRow).join("")}</div>`;
  }
  return `<section class="roulette-training-ranking-board" aria-labelledby="rouletteTrainingRankingTitle" aria-busy="${loading}">
    <header class="roulette-training-ranking-head">
      <div><span class="roulette-training-panel-label">POPULAR MENU PACKS</span><h2 id="rouletteTrainingRankingTitle">人気パックランキング</h2><p>販売の記録を見つけるための一覧です。トレーニングの上手さや運動結果を競うものではありません。</p></div>
      <span class="roulette-training-ranking-limit">TOP 20</span>
    </header>
    <div class="roulette-training-ranking-periods" role="group" aria-label="ランキング期間">
      <button type="button" data-roulette-ranking-period="monthly" aria-pressed="${period === "monthly"}">月間</button>
      <button type="button" data-roulette-ranking-period="lifetime" aria-pressed="${period === "lifetime"}">累計</button>
    </div>
    <p class="roulette-training-ranking-rule"><strong>${escapeHtml(rankingPeriodLabel(payload, period))}</strong> ／ 現在の内容を利用した「異なる購入者数」を優先し、同数ならランキング対象利用数で比較します。両方同じパックは同順位です。内容を改訂した場合は、新しい内容単位で集計します。順位によるPay報酬やトレーニング上の特典はありません。</p>
    ${body}
    <footer class="roulette-training-ranking-footer"><span>${updated ? `${escapeHtml(updated)} 更新` : "必要な時だけ最新情報を取得します"}</span><button class="button button-ghost button-small" type="button" data-roulette-action="reload-rankings" ${loading ? "disabled" : ""}>${loading ? "更新中…" : "ランキングを更新"}</button></footer>
  </section>`;
}

function creatorPeriodCard(title, subtitle, stats) {
  return `<section class="roulette-training-creator-period">
    <header><span>${escapeHtml(subtitle)}</span><h3>${escapeHtml(title)}</h3></header>
    <dl>
      <div><dt>販売成立</dt><dd>${stats.useCount}<small>回</small></dd></div>
      <div><dt>異なる購入者</dt><dd>${stats.uniqueBuyers}<small>人</small></dd></div>
      <div><dt>ランキング対象利用</dt><dd>${stats.rankingUseCount}<small>回</small></dd></div>
      <div><dt>作者受取</dt><dd>${stats.netSales}<small> Pay</small></dd></div>
    </dl>
    <details><summary>精算内訳を見る</summary><p>売上総額 ${stats.actualGross} Pay ／ 成功手数料 ${stats.feesPaid} Pay ／ 作者受取 ${stats.netSales} Pay</p></details>
  </section>`;
}

function creatorPackCard(pack) {
  const visible = pack.status === "active" && pack.moderationStatus !== "quarantined";
  const status = pack.moderationStatus === "quarantined"
    ? "安全確認中"
    : pack.status === "active" ? "販売中" : "受付停止中";
  const progress = Math.min(3, pack.uniqueBuyers);
  const eligibility = !visible
    ? "ランキングには表示されません"
    : pack.eligible
      ? "ランキング掲載条件を達成"
      : `掲載まで、あと${Math.max(0, pack.remainingUniqueBuyers)}人`;
  return `<article class="roulette-training-creator-pack${pack.eligible && visible ? " is-eligible" : ""}">
    <header><span>${escapeHtml(status)}・改訂${pack.revision || 1}</span><strong>${escapeHtml(pack.title)}</strong><small>${pack.price} Pay</small></header>
    <div class="roulette-training-creator-pack-progress" role="progressbar" aria-label="ランキング掲載条件の異なる購入者3人中${progress}人" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${progress}"><i style="--qualification-progress:${(progress / 3) * 100}%" aria-hidden="true"></i></div>
    <p><strong>${escapeHtml(eligibility)}</strong><span>異なる購入者 ${pack.uniqueBuyers}人 ／ 対象利用 ${pack.rankingUseCount}回</span></p>
  </article>`;
}

function rouletteAchievementDefinitions() {
  return (Array.isArray(window.HariaiAchievements?.catalog)
    ? window.HariaiAchievements.catalog
    : [])
    .filter((definition) => definition?.scope === "roulette_training"
      || definition?.category === "roulette_training_pack_sales")
    .sort((first, second) => String(first.family).localeCompare(String(second.family))
      || Number(first.level || 0) - Number(second.level || 0));
}

function renderCreatorAchievements(data) {
  const definitions = rouletteAchievementDefinitions();
  if (!definitions.length) {
    return `<section class="roulette-training-creator-achievements" aria-labelledby="rouletteTrainingCreatorAchievements"><header><span class="roulette-training-panel-label">SALES COLLECTION</span><h2 id="rouletteTrainingCreatorAchievements">販売実績コレクション</h2></header><p class="roulette-training-creator-placeholder">販売記録は保存されています。実績カタログを準備中です。</p></section>`;
  }
  const profile = window.HariaiAchievements?.normalizeProfile?.(data.achievements) || {
    unlocked: data.achievements?.unlocked || {},
    pendingUnlocks: Array.isArray(data.achievements?.pendingUnlocks) ? data.achievements.pendingUnlocks : [],
  };
  const unlockedIds = new Set([
    ...Object.keys(profile.unlocked || {}),
    ...(Array.isArray(profile.pendingUnlocks) ? profile.pendingUnlocks : []),
  ]);
  const families = [...new Set(definitions.map((definition) => definition.family))];
  const cards = families.map((family) => {
    const levels = definitions.filter((definition) => definition.family === family);
    const usesFamily = family === "roulette_training_pack_uses";
    const current = usesFamily ? data.lifetime.rankingUseCount : data.lifetime.uniqueBuyers;
    const next = levels.find((definition) => Number(definition.target) > current) || null;
    const currentUnlocked = [...levels].reverse().find((definition) => unlockedIds.has(definition.id)) || null;
    const unit = usesFamily ? "回" : "人";
    const progressMaximum = Number(next?.target || levels.at(-1)?.target || 1);
    const progress = Math.min(100, Math.round((current / Math.max(1, progressMaximum)) * 100));
    return `<article class="roulette-training-achievement-family">
      <header><i aria-hidden="true">${escapeHtml(currentUnlocked?.icon || levels[0]?.icon || "☆")}</i><div><span>${escapeHtml(levels[0]?.familyLabel || "販売実績")}</span><h3>${escapeHtml(currentUnlocked?.name || "最初の実績へ")}</h3></div><strong>${current}<small>${unit}</small></strong></header>
      <div class="roulette-training-achievement-progress" role="progressbar" aria-label="${escapeHtml(levels[0]?.familyLabel || "販売実績")} ${current}${unit}${next ? `、次の実績まで${Math.max(0, Number(next.target) - current)}${unit}` : "、すべて達成"}" aria-valuemin="0" aria-valuemax="${progressMaximum}" aria-valuenow="${Math.min(current, progressMaximum)}"><i style="--achievement-progress:${progress}%" aria-hidden="true"></i></div>
      <p>${next ? `次は「${escapeHtml(next.name)}」まで、あと${Math.max(0, Number(next.target) - current)}${unit}` : "このシリーズの実績をすべて集めました。"}</p>
      <ol aria-label="${escapeHtml(levels[0]?.familyLabel || "販売実績")}の実績一覧">${levels.map((definition) => `<li class="${unlockedIds.has(definition.id) ? "is-unlocked" : "is-locked"}"><i aria-hidden="true">${escapeHtml(definition.icon || "☆")}</i><span>${escapeHtml(definition.name)}</span><small>${Number(definition.target)}${unit}${unlockedIds.has(definition.id) ? "・取得済み" : ""}</small></li>`).join("")}</ol>
    </article>`;
  }).join("");
  return `<section class="roulette-training-creator-achievements" aria-labelledby="rouletteTrainingCreatorAchievements"><header><span class="roulette-training-panel-label">SALES COLLECTION</span><h2 id="rouletteTrainingCreatorAchievements">販売実績コレクション</h2><p>ランキング対象利用と異なる購入者数による、販売者向けの記録です。購入額や順位そのものは解除条件に使いません。</p></header><div class="roulette-training-achievement-families">${cards}</div></section>`;
}

function renderCreatorProfileForm(data) {
  const profile = data.profile || publicXProfile(null);
  return `<section class="roulette-training-creator-profile" aria-labelledby="rouletteTrainingCreatorProfileTitle">
    <div><span class="roulette-training-panel-label">OPTIONAL X PROFILE</span><h2 id="rouletteTrainingCreatorProfileTitle">ランキングにXプロフィールを添える</h2><p>ルーレットトレーニング専用の任意設定です。他の市場やモードからは引き継ぎません。</p></div>
    <form id="rouletteTrainingXProfileForm" novalidate>
      <label><span>Xユーザー名</span><span class="roulette-training-x-input"><b aria-hidden="true">@</b><input name="xHandle" type="text" maxlength="16" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="anju_example" value="${escapeHtml(profile.xHandle || "")}" aria-describedby="rouletteTrainingXProfileHelp" /></span></label>
      <label class="roulette-training-x-consent"><input name="xPublic" type="checkbox" ${profile.xPublic ? "checked" : ""} /><span><strong>販売中パックのランキング行に任意公開する</strong><small>現在と今後の掲載対象パックへ、同じXユーザー名を表示します。</small></span></label>
      <button class="button button-primary" type="submit" ${state.profileBusy ? "disabled" : ""}>${state.profileBusy ? "公開設定を保存中…" : "X公開設定を保存"}</button>
    </form>
    <p id="rouletteTrainingXProfileHelp">作者の自己申告として表示し、本人確認、X API取得、投稿の埋め込み、閲覧追跡は行いません。OFFにして保存すると、販売実績と順位を残したままXリンクだけが非公開になります。</p>
  </section>`;
}

function renderCreatorDashboard() {
  let content = "";
  if (state.creatorStatsLoading && !state.creatorStats) {
    content = `<div class="roulette-training-creator-status" role="status"><strong>販売記録を読み込んでいます…</strong></div>`;
  } else if (state.creatorStatsError && !state.creatorStats) {
    content = `<div class="roulette-training-creator-status is-error" role="status"><strong>販売記録を読み込めませんでした</strong><p>${escapeHtml(state.creatorStatsError)}</p><button class="button button-ghost" type="button" data-roulette-action="reload-creator-stats">再読み込み</button></div>`;
  } else if (state.creatorStats) {
    const data = state.creatorStats;
    const packCards = data.packs.length
      ? data.packs.map(creatorPackCard).join("")
      : `<p class="roulette-training-creator-placeholder">販売パックはまだありません。パックを公開すると、ここで掲載条件と販売記録を確認できます。</p>`;
    content = `<div class="roulette-training-creator-periods">${creatorPeriodCard("今月", rankingPeriodLabel({ periodKey: data.periodKey }, "monthly"), data.monthly)}${creatorPeriodCard("累計", "LIFETIME", data.lifetime)}</div>
      <section class="roulette-training-creator-packs" aria-labelledby="rouletteTrainingCreatorPacks"><header><span class="roulette-training-panel-label">PACK STATUS</span><h2 id="rouletteTrainingCreatorPacks">パックごとの掲載状況</h2><p>現在の内容を利用した異なる購入者が3人になるとランキング掲載対象です。改訂後は新しい内容として数えます。</p></header><div>${packCards}</div></section>
      ${renderCreatorAchievements(data)}
      ${renderCreatorProfileForm(data)}`;
  }
  const updated = formattedUpdateTime(state.creatorStats?.updatedAt);
  return renderFrame(`<div class="roulette-training-creator-dashboard">
    <header class="roulette-training-creator-hero"><span class="roulette-training-panel-label">MY CREATOR NOTE</span><h2>作者ダッシュボード</h2><p>販売の記録、ランキング掲載までの進み具合、販売実績コレクションを確認できます。プレイヤーの運動結果や画像は作者へ送信されません。</p></header>
    ${content}
    <footer class="roulette-training-creator-footer"><span>${updated ? `${escapeHtml(updated)} 更新` : "必要な時だけ販売記録を取得します"}</span><button class="button button-ghost button-small" type="button" data-roulette-action="reload-creator-stats" ${state.creatorStatsLoading ? "disabled" : ""}>${state.creatorStatsLoading ? "更新中…" : "販売記録を更新"}</button></footer>
  </div>`, { eyebrow: "CREATOR SALES NOTE", title: "販売記録を見る", backLabel: "市場へ戻る", backAction: "back-market" });
}

function marketCard(pack) {
  const finishBlocksPack = Boolean(terminalFinishUseId() && !pack.builtin);
  return `<button class="roulette-training-market-card" type="button" data-roulette-pack-id="${escapeHtml(packIdentity(pack))}" ${finishBlocksPack || state.bootstrapLoading || state.marketLoading ? "disabled" : ""}>
    <span><small>${Number(pack.price || 0) ? `${Number(pack.price)} PAY` : "FREE"}</small><em>${packItems(pack).length} MENUS</em></span>
    <strong>${escapeHtml(pack.title)}</strong>
    <p>${escapeHtml(pack.description || "説明なし")}</p>
    <footer>作者 ${escapeHtml(pack.sellerName || "匿名作者")}<i>内容を見る →</i></footer>
  </button>`;
}

function ownPackCard(pack) {
  const activeLabel = pack.status === "active" ? "販売中" : "受付停止中";
  const finishBlocked = Boolean(terminalFinishUseId());
  return `<article class="roulette-training-own-card">
    <div><span>${escapeHtml(activeLabel)} ／ 改訂${packRevision(pack)}</span><strong>${escapeHtml(pack.title)}</strong><small>${Number(pack.price || 0)} Pay・${packItems(pack).length}メニュー</small></div>
    <div><button class="button button-ghost" type="button" data-roulette-edit-pack="${escapeHtml(packIdentity(pack))}" ${finishBlocked || state.bootstrapLoading || state.marketLoading ? "disabled" : ""}>編集・改訂</button>${pack.status === "active" ? `<button class="button button-danger" type="button" data-roulette-unpublish-pack="${escapeHtml(packIdentity(pack))}" ${finishBlocked || state.bootstrapLoading || state.marketLoading ? "disabled" : ""}>販売受付を停止</button>` : ""}</div>
  </article>`;
}

function purchasedRevisionCard(pack, index) {
  return `<button class="roulette-training-market-card is-purchased-revision" type="button" data-roulette-purchased-index="${index}" ${state.bootstrapLoading || state.marketLoading ? "disabled" : ""}>
    <span><small>購入済み・改訂${packRevision(pack)}</small><em>通報用</em></span>
    <strong>${escapeHtml(pack.title)}</strong>
    <p>${escapeHtml(pack.description || "説明なし")}</p>
    <footer>作者 ${escapeHtml(pack.sellerName || "匿名作者")}<i>旧版全文と通報 →</i></footer>
  </button>`;
}

function hasPurchasedRevision(pack) {
  if (!pack) return false;
  const packId = packIdentity(pack);
  const revision = packRevision(pack);
  return state.purchasedRevisions.some((purchased) => (
    packIdentity(purchased) === packId && packRevision(purchased) === revision
  ));
}

function reportDisclosure(pack) {
  if (pack.builtin || pack.isOwn || !hasPurchasedRevision(pack)) return "";
  return `<details class="roulette-training-report" ${pack.reportOnly ? "open" : ""}><summary>この改訂を通報する</summary><form id="rouletteTrainingReportForm"><label><span class="sr-only">通報理由</span><select name="reason" aria-label="通報理由">${PUBLIC_REPORT_REASONS.map((reason) => configOption(reason.id, reason.label, state.reportReason)).join("")}</select></label><button class="button button-ghost" type="submit" ${state.reportBusy ? "disabled" : ""}>${state.reportBusy ? "送信中…" : "通報を送信"}</button></form></details>`;
}

function renderMarket() {
  const terminalUseId = terminalFinishUseId();
  const freeCard = marketCard(FREE_PACK);
  const onlineCards = state.marketPacks.map(marketCard).join("");
  const ownCards = state.ownPacks.map(ownPackCard).join("");
  const purchasedRevisionCards = state.purchasedRevisions
    .map(purchasedRevisionCard)
    .join("");
  const status = state.marketLoading
    ? `<p class="roulette-training-market-status">販売中パックを読み込んでいます…</p>`
    : state.marketError
      ? `<div class="roulette-training-market-error"><p>${escapeHtml(state.marketError)}</p><button class="button button-ghost" type="button" data-roulette-action="reload-market">再読み込み</button></div>`
      : !onlineCards
        ? `<p class="roulette-training-market-status">現在、公開中のユーザーパックはありません。</p>`
        : "";
  const packView = `${terminalUseId ? `<div class="roulette-training-market-error" role="status"><p>前回の有料利用の終了確認が完了していません。新しい利用は開始できません。</p><button class="button button-ghost" type="button" data-roulette-action="retry-finish" ${state.finishRetryBusy ? "disabled" : ""}>${state.finishRetryBusy ? "終了を確認中…" : "終了処理を再試行"}</button></div>` : state.activeUse ? `<button class="roulette-training-active-use" type="button" data-roulette-action="resume-paid"><strong>開始済みの有料パックがあります</strong><span>追加課金なしで準備画面へ戻る</span></button>` : ""}
    ${ownCards ? `<section class="roulette-training-own-packs"><header><span class="roulette-training-panel-label">MY MENU PACKS</span><h3>自分の販売パック</h3></header>${ownCards}</section>` : ""}
    ${purchasedRevisionCards ? `<section class="roulette-training-purchased-revisions"><header><span class="roulette-training-panel-label">PURCHASED REVISIONS</span><h3>購入済みの改訂（通報用）</h3><p>作者が改訂・受付停止した後も、実際に有料利用した版の全文を確認して通報できます。同じ改訂は1件にまとめて表示します。</p></header><div class="roulette-training-market-grid">${purchasedRevisionCards}</div></section>` : ""}
    <div class="roulette-training-market-grid">${freeCard}${onlineCards}</div>
    ${status}
    <aside class="roulette-training-safety-note"><strong>販売パックはプレイヤーによる自由入力です。</strong><p>内容を確認し、自分に合わない運動は購入・開始しないでください。実施中はいつでもギブアップできます。</p></aside>`;
  return renderFrame(`<div class="roulette-training-market">
    <section class="roulette-training-market-head"><div><span class="roulette-training-panel-label">MENU MARKET</span><h2>全文を見てから選べます</h2><p>購入はパック1セッション単位です。抽選・クリア・ギブアップで追加料金は発生しません。</p></div><div class="roulette-training-market-head-actions"><div class="roulette-training-balance"><small>ANJUPAY BALANCE</small><strong>${Number.isFinite(state.balance) ? `${state.balance} Pay` : "--"}</strong></div><button class="button button-ghost button-small" type="button" data-roulette-action="open-creator-dashboard">作者ダッシュボード</button></div></section>
    <div class="roulette-training-market-switcher" role="group" aria-label="市場の表示">
      <button type="button" data-roulette-action="show-market-packs" aria-pressed="${state.marketView === "packs"}"><span aria-hidden="true">▤</span>パックを選ぶ</button>
      <button type="button" data-roulette-action="show-market-ranking" aria-pressed="${state.marketView === "ranking"}"><span aria-hidden="true">☆</span>人気ランキング</button>
    </div>
    ${state.marketView === "ranking" ? renderRankingPanel() : packView}
  </div>`, { backLabel: "入口へ戻る", backAction: "hub" });
}

function renderPackDetail() {
  const pack = state.selectedMarketPack;
  if (!pack) {
    state.screen = "market";
    return renderMarket();
  }
  const price = Number(pack.price || 0);
  if (pack.reportOnly) {
    return renderFrame(`<div class="roulette-training-review is-report-only">
      <section class="roulette-training-panel">
        <span class="roulette-training-panel-label">PURCHASED REVISION · REPORT ONLY</span>
        <h2>${escapeHtml(pack.title)}</h2>
        <p>${escapeHtml(pack.description || "説明なし")}</p>
        <dl class="roulette-training-review-facts"><div><dt>作者</dt><dd>${escapeHtml(pack.sellerName || "匿名作者")}</dd></div><div><dt>購入時の価格</dt><dd>${price} Pay</dd></div><div><dt>購入した改訂</dt><dd>${packRevision(pack)}</dd></div><div><dt>状態</dt><dd>終了済み・通報用</dd></div></dl>
        ${menuDisclosure(pack)}
      </section>
      <aside class="roulette-training-purchase-warning"><strong>これは購入時に固定された旧版です。</strong><p>この画面から再購入・再開はできません。再び利用する場合は販売中の最新版を改めて確認してください。</p></aside>
      <div class="roulette-training-review-actions"><button class="button button-ghost" type="button" data-roulette-action="back-market">一覧へ戻る</button></div>
      ${reportDisclosure(pack)}
    </div>`, { backLabel: "一覧へ戻る", backAction: "back-market" });
  }
  const selfPreview = pack.isOwn === true;
  const hasBalance = Number.isFinite(state.balance);
  const postBalance = hasBalance ? state.balance - (selfPreview ? 0 : price) : null;
  const paidConsentRequired = price > 0 && !selfPreview;
  return renderFrame(`<div class="roulette-training-review">
    <section class="roulette-training-panel">
      <span class="roulette-training-panel-label">FULL PACK REVIEW</span>
      <h2>${escapeHtml(pack.title)}</h2>
      <p>${escapeHtml(pack.description || "説明なし")}</p>
      <dl class="roulette-training-review-facts"><div><dt>作者</dt><dd>${escapeHtml(pack.sellerName || "匿名作者")}</dd></div><div><dt>価格</dt><dd>${price ? `${price} Pay` : "無料"}</dd></div><div><dt>現在残高</dt><dd>${Number.isFinite(state.balance) ? `${state.balance} Pay` : "--"}</dd></div><div><dt>開始後残高</dt><dd>${postBalance === null ? "--" : `${postBalance} Pay`}</dd></div></dl>
      ${menuDisclosure(pack)}
    </section>
    <section class="roulette-training-odds">
      <h3>抽選のしくみ</h3><div><strong>メニュー 65%</strong><span>特殊効果 35%</span></div><p>特殊効果が出た次は必ずメニューが出ます。メニューは全種類が一巡するまで重複しにくい抽選です。</p>
    </section>
    <aside class="roulette-training-purchase-warning"><strong>${selfPreview ? "作者本人の試遊は無料です。" : price ? `${price} Payで1セッションを開始します。` : "このパックは無料です。"}</strong><p>利用権は譲渡できません。支払いは下のボタンを押し、サーバーで開始が確定した時だけ発生します。回数、抽選、クリア、ギブアップによる追加支払いはありません。</p></aside>
    ${paidConsentRequired ? `<label class="roulette-training-purchase-consent"><input id="rouletteTrainingPurchaseConsent" type="checkbox" /><span><strong>この内容を任意で1セッション利用します</strong><small>${price} Payの支払いは開始時の1回だけで、ルーレット・回数・クリア・ギブアップによる追加料金はありません。</small></span></label>` : ""}
    <div class="roulette-training-review-actions"><button class="button button-ghost" type="button" data-roulette-action="back-market">一覧へ戻る</button><button class="button button-primary" id="rouletteTrainingActivatePack" type="button" data-roulette-action="activate-pack" ${state.purchaseBusy || (price > 0 && !selfPreview && (!hasBalance || postBalance < 0)) || paidConsentRequired ? "disabled" : ""}>${state.purchaseBusy ? "開始を確認中…" : selfPreview ? "無料で作者テストを開始" : price ? `${price} Payで準備へ進む` : "無料で準備へ進む"}</button></div>
    ${reportDisclosure(pack)}
  </div>`, { backLabel: "一覧へ戻る", backAction: "back-market" });
}

function reelItemKey(item) {
  return String(item?.reelId ?? item?.id ?? item?.label ?? item?.menuText ?? "");
}

function cyclicItem(items, index) {
  const normalizedIndex = ((index % items.length) + items.length) % items.length;
  return items[normalizedIndex];
}

function visualSpinRows(items, selectedIndex, type) {
  const total = REEL_VISUAL_ROW_COUNT[type] || REEL_VISUAL_ROW_COUNT.main;
  const landingIndex = total - 3;
  const startIndex = selectedIndex - landingIndex;
  return {
    landingIndex,
    rows: Array.from({ length: total }, (_, index) => cyclicItem(items, startIndex + index)),
  };
}

function mascotStateForSession(session = state.session) {
  const phase = String(session?.phase || "");
  const presentation = sessionPresentation(session);
  if (["main_spinning", "count_spinning"].includes(phase)) return "spinning";
  if (phase === "effect_result") {
    if (presentation === "fever") return "fever-hit";
    if (presentation === "all-out") return "all-out-hit";
    return "effect-hit";
  }
  if (["menu_result", "count_result"].includes(phase)) {
    return presentation === "all-out" ? "all-out-hit" : "normal-hit";
  }
  if (["countdown", "active", "paused"].includes(phase)) return "training";
  return "idle";
}

function renderMascot(mascotState = "idle", placement = "play") {
  const safeState = [
    "idle",
    "spinning",
    "normal-hit",
    "effect-hit",
    "fever-hit",
    "all-out-hit",
    "training",
    "result-completed",
    "result-give-up",
  ].includes(mascotState) ? mascotState : "idle";
  const safePlacement = ["play", "result", "sticker"].includes(placement) ? placement : "play";
  return `<div class="roulette-training-mascot is-${safePlacement} is-${safeState}" aria-hidden="true">
    <svg viewBox="0 0 120 154" focusable="false">
      <ellipse class="mascot-shadow" cx="61" cy="145" rx="34" ry="6"></ellipse>
      <g class="mascot-ear mascot-ear-left"><path d="M38 55C26 40 23 9 36 5c13-4 18 29 16 48z"></path><path class="mascot-ear-inner" d="M36 43c-5-11-7-27-2-31 6 1 10 19 10 34z"></path></g>
      <g class="mascot-ear mascot-ear-right"><path d="M71 51C70 29 81 2 94 7c12 6 1 34-10 48z"></path><path class="mascot-ear-inner" d="M81 45c1-14 7-29 12-30 4 6-2 22-9 32z"></path></g>
      <ellipse class="mascot-body" cx="61" cy="108" rx="34" ry="36"></ellipse>
      <circle class="mascot-tail" cx="91" cy="119" r="13"></circle>
      <circle class="mascot-head" cx="61" cy="65" r="36"></circle>
      <g class="mascot-face">
        <ellipse class="mascot-eye mascot-eye-left" cx="48" cy="62" rx="3.8" ry="5.6"></ellipse>
        <ellipse class="mascot-eye mascot-eye-right" cx="75" cy="62" rx="3.8" ry="5.6"></ellipse>
        <circle class="mascot-cheek" cx="40" cy="75" r="5"></circle><circle class="mascot-cheek" cx="82" cy="75" r="5"></circle>
        <path class="mascot-mouth" d="M56 72q5 7 10 0"></path>
      </g>
      <path class="mascot-neck-ribbon" d="M47 91q14 8 28 0l-4 15-10-8-11 8z"></path>
      <g class="mascot-arm mascot-arm-left"><ellipse cx="34" cy="106" rx="10" ry="20"></ellipse></g>
      <g class="mascot-arm mascot-arm-right"><ellipse cx="88" cy="106" rx="10" ry="20"></ellipse></g>
      <g class="mascot-ribbon-pull"><path d="M88 94c13-8 21-22 26-34"></path><path d="M108 56l8-5-1 10z"></path></g>
      <g class="mascot-effect-star"><path d="M96 78l4 8 9 1-7 6 2 9-8-4-8 4 2-9-7-6 9-1z"></path></g>
      <g class="mascot-penlight"><rect x="94" y="62" width="8" height="34" rx="4"></rect><circle cx="98" cy="60" r="6"></circle></g>
      <g class="mascot-headband"><path d="M31 53q30-15 61 0l-2 10q-28-13-57 0z"></path><path d="M88 53l22-10-8 18 10 10-23-7z"></path></g>
      <g class="mascot-flag"><path d="M94 105V37"></path><path d="M95 39h24v27H95z"></path><text x="107" y="57" text-anchor="middle">100</text></g>
      <g class="mascot-trophy"><path d="M37 96h34l-6 25H43z"></path><path d="M54 82l5 9 10 1-7 7 2 10-10-5-9 5 2-10-7-7 10-1z"></path><path d="M49 121h11v10H49zM42 131h25v7H42z"></path></g>
      <g class="mascot-towel"><path d="M30 91q30 13 61 0l4 28q-34 13-69 0z"></path><path d="M37 103h48M40 111h42"></path></g>
    </svg>
  </div>`;
}

function reelRows(items, selectedId, type, spinning) {
  const normalized = items.length ? items : [{ id: "empty", label: "準備中" }];
  const matchedIndex = normalized.findIndex((item) => reelItemKey(item) === String(selectedId));
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const reduced = spinning && prefersReducedMotion();
  const visual = spinning && !reduced
    ? visualSpinRows(normalized, selectedIndex, type)
    : {
      landingIndex: 2,
      rows: [-2, -1, 0, 1, 2].map((offset) => cyclicItem(normalized, selectedIndex + offset)),
    };
  const settledVisual = !spinning || reduced;
  const hasSelection = settledVisual && Boolean(String(selectedId || ""));
  const rows = visual.rows.map((item, index) => {
    const distance = settledVisual ? Math.abs(2 - index) : "";
    const selected = settledVisual && index === 2;
    const reelId = reelItemKey(item);
    const isEffect = reelId.startsWith("effect:");
    const presentation = isEffect ? effectPresentation(item) : DEFAULT_EFFECT_PRESENTATION;
    const rare = isEffect && presentation.rarity === "rare";
    const allOutCount = item?.allOut === true;
    const rowClasses = [
      "roulette-training-reel-row",
      selected ? "is-selected" : "",
      rare ? "is-rare-effect-row" : "",
      rare ? `is-${presentation.presentation}-row` : "",
      allOutCount ? "is-all-out-count-row" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${rowClasses}" data-reel-item-id="${escapeHtml(reelId)}" data-visual-row-index="${index}"${rare ? ` data-effect-presentation="${escapeHtml(presentation.presentation)}" data-effect-rarity="rare"` : ""}${distance === "" ? "" : ` data-distance="${distance}"`}><span>${escapeHtml(item.label || item.menuText || String(item))}</span>${rare ? `<small class="roulette-training-row-rare">★ RARE</small>` : ""}</div>`;
  }).join("");
  return `<div class="roulette-training-reel-shell">
    <div class="roulette-training-reel-window ${spinning ? "is-spinning" : "is-settled"}${reduced ? " is-reduced-motion" : ""}${hasSelection ? " has-selection" : ""}" data-reel-type="${escapeHtml(type)}" data-reel-landing-index="${visual.landingIndex}" aria-hidden="true">
      <div class="roulette-training-reel-track">${rows}</div>
      <div class="roulette-training-reel-fade" aria-hidden="true"></div>
    </div>
    <i class="roulette-training-reel-lock is-left" aria-hidden="true"></i>
    <i class="roulette-training-reel-lock is-right" aria-hidden="true"></i>
    <i class="roulette-training-reel-marker" aria-hidden="true"></i>
  </div>`;
}

function particleField(count = 12, kind = "menu") {
  if (prefersReducedMotion()) return "";
  const positions = [
    [9, 34], [17, 13], [29, 25], [40, 9], [53, 19], [65, 8], [77, 26], [90, 14],
    [13, 72], [26, 88], [41, 77], [56, 92], [70, 79], [84, 90], [93, 65], [5, 91],
  ];
  const amount = Math.min(12, Math.max(0, Number(count) || 0));
  return `<div class="roulette-training-particles is-${escapeHtml(kind)}" aria-hidden="true">${positions.slice(0, amount).map(([x, y], index) => `<i style="--particle-x:${x}%;--particle-y:${y}%;--particle-delay:${(index % 4) * 55}ms"></i>`).join("")}</div>`;
}

function renderProgressGems(session = state.session) {
  const target = Math.max(1, Math.min(10, Number(session?.config?.targetCount) || 5));
  const completed = Math.max(0, Math.min(target, Number(session?.completedCount) || 0));
  const columns = Math.min(5, target);
  const gems = Array.from({ length: target }, (_, index) => `<i class="${index < completed ? "is-lit" : ""}" style="--light-index:${index}"></i>`).join("");
  return `<div class="roulette-training-stage-progress" role="progressbar" aria-label="目標${target}回中${completed}回達成" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${completed}">
    <span class="sr-only">目標${target}回中${completed}回クリア</span>
    <div class="roulette-training-progress-lights ${target === 10 ? "is-two-row" : ""}" style="--light-columns:${columns}" aria-hidden="true">${gems}</div>
    <strong aria-hidden="true">${completed} / ${target}</strong>
  </div>`;
}

function renderGoalLights(completedCount, targetCount = completedCount, { sequential = false } = {}) {
  const target = TARGET_OPTIONS.includes(Number(targetCount)) ? Number(targetCount) : DEFAULT_CONFIG.targetCount;
  const completed = Math.max(0, Math.min(target, Number(completedCount) || 0));
  const columns = Math.min(5, target);
  const lights = Array.from({ length: target }, (_, index) => `<i class="${index < completed ? "is-lit" : ""}" style="--light-index:${index}"></i>`).join("");
  return `<div class="roulette-training-goal-lights ${target === 10 ? "is-two-row" : ""}${sequential ? " is-sequential" : ""}" style="--light-columns:${columns}" aria-hidden="true">${lights}</div>`;
}

function sessionImage() {
  const session = state.session;
  if (!session || state.images.length < 1) return null;
  const index = Math.min(state.images.length - 1, Math.max(0, Number(session.imageIndex) || 0));
  return state.images[index] || state.images[0];
}

function currentCheer() {
  return String(state.session?.currentCheer || "");
}

function renderStage() {
  const image = sessionImage();
  const session = state.session;
  const cheer = currentCheer();
  const cheerVisible = cheer && ["menu_result", "count_ready", "count_spinning", "count_result", "countdown", "active", "paused", "rest"].includes(session?.phase);
  return `<div class="roulette-training-image-stage">
    ${image ? `<img src="${escapeHtml(image.url)}" alt="トレーニング用に選択した画像" />` : `<div class="roulette-training-image-missing"><strong>画像を復元できませんでした</strong><span>トレーニング終了後に選び直せます</span></div>`}
    <span class="roulette-training-photo-tape is-top" aria-hidden="true"></span>
    <span class="roulette-training-photo-tape is-bottom" aria-hidden="true"></span>
    ${cheerVisible ? `<div class="roulette-training-speech-bubble ${session.phase === "menu_result" ? "is-pop-in" : ""}"><span class="roulette-training-note-tape" aria-hidden="true"></span><p data-roulette-cheer-text>${escapeHtml(cheer)}</p></div>` : ""}
    ${renderProgressGems(session)}
  </div>`;
}

function mainReelItems() {
  return [
    ...EFFECTS.map((effect) => ({
      ...effect,
      ...effectPresentation(effect),
      reelId: `effect:${effect.id}`,
      label: effect.label,
    })),
    ...packItems(state.session?.pack).map((item) => ({ ...item, reelId: `menu:${item.id}`, label: item.menuText })),
  ];
}

function selectedMainId() {
  const session = state.session;
  if (session?.pendingMain?.item?.id) return `${session.pendingMain.type}:${session.pendingMain.item.id}`;
  if (session?.currentEffect?.id) return `effect:${session.currentEffect.id}`;
  if (session?.currentMenu?.id) return `menu:${session.currentMenu.id}`;
  return "";
}

function challengeLabel(session = state.session) {
  if (!session?.currentMenu || !Number.isFinite(Number(session.currentCount))) return "";
  return `${session.currentMenu.menuText}・${session.currentCount}${unitInfo(session.currentMenu.countUnit).label}`;
}

function temporaryEffectCopy(session = state.session) {
  if (!session?.pendingTemporaryEffect && !session?.activeTemporaryEffect) return "";
  const effect = session.activeTemporaryEffect || session.pendingTemporaryEffect;
  return `${effect.effect?.label || effect.label || "一時効果"}：開始から${Math.round((effect.durationMs || TEMP_EFFECT_MS) / 1000)}秒`;
}

function renderMachine({
  ariaLabel,
  type,
  stateClass = "",
  status,
  items,
  selectedId,
  spinning = false,
  drawer = "",
  controls = "",
  note = "",
  particles = "",
  banner = "",
  presentation = "",
  skipRare = false,
}) {
  const mainMachine = type !== "count";
  return `<section class="roulette-training-machine is-${escapeHtml(type)} ${escapeHtml(stateClass)}" aria-label="${escapeHtml(ariaLabel)}" data-machine-phase="${escapeHtml(state.session?.phase || "")}"${presentation ? ` data-effect-presentation="${escapeHtml(presentation)}"` : ""}>
    <span class="roulette-training-machine-pins" aria-hidden="true"><i class="is-pearl-one"></i><i class="is-star-one"></i><i class="is-pearl-two"></i><i class="is-star-two"></i></span>
    <header class="roulette-training-machine-heading"><span><b>${mainMachine ? "きょうのルーレット" : "回数ルーレット"}</b><small aria-hidden="true">${mainMachine ? "TODAY'S ROULETTE" : "COUNT ROULETTE"}</small></span><strong>${escapeHtml(status)}</strong></header>
    ${banner}
    <div class="roulette-training-machine-display">
      ${reelRows(items, selectedId, type, spinning)}
      ${drawer}
    </div>
    ${skipRare ? `<button class="roulette-training-rare-skip" type="button" data-roulette-action="skip-rare-presentation" aria-hidden="true" disabled>レア演出をスキップ</button>` : ""}
    ${controls ? `<div class="roulette-training-machine-controls">${controls}</div>` : ""}
    ${note ? `<p class="roulette-training-machine-note">${escapeHtml(note)}</p>` : ""}
    ${particles}
  </section>`;
}

function renderRareEffectCard(effect) {
  const meta = effectPresentation(effect);
  if (meta.rarity !== "rare") return "";
  if (meta.presentation === "fever") {
    return `<div class="roulette-training-rare-effect-card is-fever"><span class="roulette-training-rare-effect-sticker">★ RARE EFFECT</span><strong>FEVER TIME</strong><p>フェアリーライトと一緒に、次のトレーニングを応援します。</p></div>`;
  }
  return `<div class="roulette-training-rare-effect-card is-all-out"><span class="roulette-training-rare-effect-sticker">★ レア効果</span><strong>100 × 7</strong><p>次の回数は100固定です</p><small class="roulette-training-rare-safety">無理のない範囲で。続けられないときは、いつでも今日はここまでで大丈夫です。</small></div>`;
}

function temporaryEffectRemainingSeconds(session = state.session) {
  if (!session?.activeTemporaryEffect) {
    return Math.max(0, Math.ceil(Number(session?.pendingTemporaryEffect?.durationMs || 0) / 1_000));
  }
  if (session.tempEffectEndsAt) return Math.max(0, Math.ceil((session.tempEffectEndsAt - Date.now()) / 1_000));
  return Math.max(0, Math.ceil(Number(session.temporaryRemainingMs || 0) / 1_000));
}

function renderStatusEffect(session = state.session) {
  const presentation = sessionPresentation(session);
  if (presentation === "fever") {
    const seconds = temporaryEffectRemainingSeconds(session);
    return `<mark class="roulette-training-status-effect is-fever">FEVER${seconds ? `<small data-roulette-effect-seconds>残り${seconds}秒</small>` : ""}</mark>`;
  }
  if (presentation === "all-out") {
    return `<mark class="roulette-training-status-effect is-all-out">ALL OUT<small>次は100固定</small></mark>`;
  }
  return "";
}

function resultDrawer({ kind, title, detail = "", meta = "", action, actionLabel, content = "" }) {
  return `<div class="roulette-training-selection-drawer is-${escapeHtml(kind)} is-open">
    <div class="roulette-training-drawer-copy">
      ${title ? `<strong class="roulette-training-drawer-title">${escapeHtml(title)}</strong>` : ""}
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
      ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
      ${content}
    </div>
    <button class="button button-primary roulette-training-spin" type="button" data-roulette-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>
  </div>`;
}

function renderMainRoulette() {
  const session = state.session;
  const spinning = session.phase === "main_spinning";
  const effectResult = session.phase === "effect_result";
  const shownEffect = effectResult
    ? session.currentEffect
    : spinning && session.pendingMain?.type === "effect"
      ? session.pendingMain.item
      : null;
  const shownPresentation = effectPresentation(shownEffect);
  const rare = shownEffect && shownPresentation.rarity === "rare";
  const drawer = effectResult
    ? resultDrawer({
      kind: "effect",
      title: session.currentEffect.label,
      detail: session.effectMessage,
      content: renderRareEffectCard(session.currentEffect),
      action: "spin-main",
      actionLabel: "続けてメニューを回す",
    })
    : "";
  const controls = effectResult
    ? ""
    : `<button class="button button-primary roulette-training-spin" type="button" data-roulette-action="spin-main" ${spinning ? "disabled" : ""}>${spinning ? "回転中…" : "ルーレットを回す"}</button>`;
  return renderMachine({
    ariaLabel: "メインルーレット",
    type: "main",
    stateClass: [
      effectResult ? "is-special-result" : spinning ? "is-spinning" : "is-ready",
      rare ? "is-rare-effect" : "",
      rare ? `is-presentation-${shownPresentation.presentation}` : "",
      rare && spinning ? "is-rare-spinning" : "",
    ].filter(Boolean).join(" "),
    status: effectResult ? (rare ? "レア効果" : "おまけチャンス") : spinning ? "抽選中…" : "準備OK",
    items: mainReelItems(),
    selectedId: selectedMainId(),
    spinning,
    drawer,
    controls,
    presentation: rare ? shownPresentation.presentation : "",
    skipRare: rare && spinning,
    particles: effectResult && rare ? particleField(8, shownPresentation.presentation) : "",
    note: effectResult ? "" : "特殊効果の後は必ずトレーニングメニューが決まります。",
  });
}

function renderMenuResult() {
  const session = state.session;
  return renderMachine({
    ariaLabel: "決定したトレーニングメニュー",
    type: "main",
    stateClass: "is-menu-locked",
    status: "きょうのメニュー",
    items: mainReelItems(),
    selectedId: `menu:${session.currentMenu.id}`,
    drawer: resultDrawer({
      kind: "menu",
      title: session.currentMenu.menuText,
      detail: session.currentMenu.detailText,
      meta: temporaryEffectCopy(session),
      action: "open-count",
      actionLabel: "回数ルーレットへ",
    }),
    particles: particleField(12, "menu"),
  });
}

function countReelItems() {
  const session = state.session;
  if (!session?.currentMenu) return [];
  const unit = unitInfo(session.currentMenu.countUnit);
  const persisted = ["count_spinning", "count_result"].includes(session.phase)
    && Array.isArray(session.pendingCount?.candidates)
    && session.pendingCount.candidates.length
    ? session.pendingCount.candidates
    : null;
  const candidates = persisted || countCandidates(
    unit.id,
    session.config.intensity,
    { allOut: session.currentAllOutCount === true },
  );
  return candidates.map((value, index) => ({
    id: `${index}:${value}`,
    value: Number(value),
    label: `${value}${unit.label}`,
    allOut: session.currentAllOutCount === true,
  }));
}

function renderOdometer(value, unitLabel) {
  const numeric = Math.max(0, Math.round(Number(value) || 0));
  const digits = String(numeric).split("");
  const columns = digits.map((digit, index) => {
    const finalDigit = Number(digit);
    const sequence = [
      (finalDigit + 3) % 10,
      (finalDigit + 7) % 10,
      (finalDigit + 1) % 10,
      finalDigit,
    ];
    return `<span class="roulette-training-odometer-column" style="--odometer-delay:${index * 45}ms"><span class="roulette-training-odometer-strip">${sequence.map((item) => `<i>${item}</i>`).join("")}</span></span>`;
  }).join("");
  return `<strong class="roulette-training-odometer" aria-label="${escapeHtml(`${numeric}${unitLabel}`)}"><span class="roulette-training-odometer-digits" aria-hidden="true">${columns}</span><small aria-hidden="true">${escapeHtml(unitLabel)}</small></strong>`;
}

function renderCountRoulette() {
  const session = state.session;
  const spinning = session.phase === "count_spinning";
  const settled = session.phase === "count_result";
  const allOut = session.currentAllOutCount === true;
  const items = countReelItems();
  const selectedValue = Number(session.pendingCount?.value ?? session.currentCount);
  const persistedIndex = Number(session.pendingCount?.index);
  const selectedIndex = Number.isInteger(persistedIndex)
    && persistedIndex >= 0
    && persistedIndex < items.length
    ? persistedIndex
    : items.findIndex((item) => item.value === selectedValue);
  const selected = settled || spinning ? (items[selectedIndex]?.id || "") : "";
  const unitLabel = unitInfo(session.currentMenu.countUnit).label;
  const drawer = settled
    ? resultDrawer({
      kind: "count",
      action: "start-challenge",
      actionLabel: "3秒カウントで開始",
      content: `<span class="roulette-training-count-caption">今回の回数</span>${renderOdometer(session.currentCount, unitLabel)}<div class="roulette-training-final-check"><span>${escapeHtml(session.currentMenu.menuText)}</span><strong>BPM ${session.workoutBpm}</strong>${temporaryEffectCopy(session) ? `<em>${escapeHtml(temporaryEffectCopy(session))}</em>` : ""}</div>`,
    })
    : "";
  const controls = settled
    ? ""
    : `<button class="button button-primary roulette-training-spin" type="button" data-roulette-action="spin-count" ${spinning ? "disabled" : ""}>${spinning ? "回転中…" : "回数を決める"}</button>`;
  return renderMachine({
    ariaLabel: "回数ルーレット",
    type: "count",
    stateClass: [
      settled ? "is-count-result" : spinning ? "is-spinning" : "is-ready",
      allOut ? "is-all-out-count" : "",
    ].filter(Boolean).join(" "),
    status: allOut ? (settled ? "100回で挑戦" : spinning ? "100を抽選中…" : "100固定") : settled ? "この回数で挑戦" : spinning ? "抽選中…" : "回数を決めよう",
    items,
    selectedId: selected,
    spinning,
    drawer,
    controls,
    presentation: allOut ? "all-out" : "",
    banner: allOut ? `<div class="roulette-training-all-out-count-card"><strong>100 × 7</strong><span>次の回数は100固定です</span></div>` : "",
    note: allOut ? "無理のない範囲で。続けられないときは、いつでも今日はここまでで大丈夫です。" : "",
  });
}

function renderCountdown() {
  return `<section class="roulette-training-challenge is-countdown"><span class="roulette-training-challenge-kicker"><b>もうすぐスタート</b><small aria-hidden="true">READY</small></span><strong class="roulette-training-countdown-number">${state.countdownValue}</strong><p>${escapeHtml(challengeLabel())} ／ BPM ${state.session.workoutBpm}</p><button class="button button-danger roulette-training-give-up" type="button" data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで</button></section>`;
}

function remainingSeconds() {
  const session = state.session;
  if (!session?.challengeEndsAt) return null;
  return Math.max(0, Math.ceil((session.challengeEndsAt - Date.now()) / 1000));
}

function renderActiveChallenge() {
  const session = state.session;
  const seconds = remainingSeconds();
  const timerCopy = session.currentMenu.countUnit === "seconds"
    ? seconds > 0
      ? `<div class="roulette-training-workout-timer"><strong data-roulette-workout-seconds>${seconds}</strong><span>秒</span></div>`
      : `<div class="roulette-training-workout-timer is-done"><strong>時間</strong><span>自己申告してください</span></div>`
    : `<div class="roulette-training-workout-count"><strong>${session.currentCount}</strong><span>${escapeHtml(unitInfo(session.currentMenu.countUnit).label)}</span></div>`;
  return `<section class="roulette-training-challenge is-active">
    <span class="roulette-training-challenge-kicker"><b>いま挑戦中</b><small aria-hidden="true">HOME TRAINING</small></span>
    <h2>${escapeHtml(session.currentMenu.menuText)}</h2>
    ${session.currentMenu.detailText ? `<p class="roulette-training-detail">${escapeHtml(session.currentMenu.detailText)}</p>` : ""}
    ${timerCopy}
    <div class="roulette-training-bpm"><i aria-hidden="true"></i><span>テンポ目安</span><strong data-roulette-current-bpm>BPM ${session.currentWorkoutBpm}</strong></div>
    ${session.activeTemporaryEffect ? `<p class="roulette-training-temp-effect" data-roulette-temp-effect>${escapeHtml(session.activeTemporaryEffect.effect?.label || "一時効果")}を適用中</p>` : ""}
    <p class="roulette-training-challenge-safety">できたら「できた！」。つらいときは無理せず休もう。</p>
    <small class="roulette-training-self-report">結果は自己申告です。</small>
    <div class="roulette-training-judgement"><button class="button button-primary" type="button" data-roulette-action="clear">できた！</button><button class="button button-danger" type="button" data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで</button></div>
  </section>`;
}

function renderPausedChallenge() {
  return `<section class="roulette-training-challenge is-paused"><span class="roulette-training-challenge-kicker"><b>ひと休み中</b><small aria-hidden="true">PAUSED</small></span><h2>画面が隠れたため停止しました</h2><p>メトロノームとタイマーは止まっています。準備ができたら再開してください。</p><div class="roulette-training-judgement"><button class="button button-primary" type="button" data-roulette-action="resume-challenge">再開</button><button class="button button-danger" type="button" data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで</button></div></section>`;
}

function renderRest() {
  const seconds = Math.max(0, Math.ceil((state.session.restEndsAt - Date.now()) / 1000));
  return `<section class="roulette-training-challenge is-rest"><span class="roulette-training-challenge-kicker"><b>休憩タイム</b><small aria-hidden="true">REST</small></span><strong class="roulette-training-rest-number" data-roulette-rest-seconds>${seconds}</strong><p>呼吸を整えたら、次のルーレットへ。</p><button class="button button-primary" type="button" data-roulette-action="finish-rest">休憩を終える</button><button class="button button-danger roulette-training-give-up" type="button" data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで</button></section>`;
}

function renderPlay() {
  const session = state.session;
  if (!session) {
    state.screen = "setup";
    return renderSetup();
  }
  let machine;
  if (["main_ready", "main_spinning", "effect_result"].includes(session.phase)) machine = renderMainRoulette();
  else if (session.phase === "menu_result") machine = renderMenuResult();
  else if (["count_ready", "count_spinning", "count_result"].includes(session.phase)) machine = renderCountRoulette();
  else if (session.phase === "countdown") machine = renderCountdown();
  else if (session.phase === "active") machine = renderActiveChallenge();
  else if (session.phase === "paused") machine = renderPausedChallenge();
  else if (session.phase === "rest") machine = renderRest();
  else machine = renderMainRoulette();
  const phaseClass = String(session.phase || "main_ready").replaceAll("_", "-");
  const remainingTarget = Math.max(0, Number(session.config.targetCount) - Number(session.completedCount || 0));
  const presentation = sessionPresentation(session);
  const presentationClass = presentation ? ` has-presentation-${presentation}` : "";
  const beatBpm = Math.max(MIN_BPM, Number(session.currentWorkoutBpm || session.workoutBpm || session.baseBpm) || BASE_BPM);
  const hiddenClass = document.visibilityState === "hidden" ? " is-roulette-document-hidden" : "";
  return renderFrame(`<div class="roulette-training-play is-phase-${escapeHtml(phaseClass)}${presentationClass}${hiddenClass}" data-training-phase="${escapeHtml(session.phase)}"${presentation ? ` data-roulette-presentation="${escapeHtml(presentation)}"` : ""} style="--fever-beat:${Math.round(60_000 / beatBpm)}ms">
    ${roomDecorMarkup()}
    <div class="roulette-training-play-status" role="group" aria-label="トレーニング状況"><i class="roulette-training-status-shelf" aria-hidden="true"></i><span class="is-base"><small>基本テンポ</small><strong>${session.baseBpm}<em>BPM</em></strong>${renderStatusEffect(session)}</span><span class="is-maximum"><small>上限</small><strong>${session.config.maximumBpm}<em>BPM</em></strong></span><span class="is-remaining"><small>あと${remainingTarget}回</small><strong>${session.completedCount} / ${session.config.targetCount}</strong></span></div>
    ${renderStage()}
    ${machine}
    ${renderMascot(mascotStateForSession(session), "play")}
  </div>`, { showBack: false, showHeader: false, title: "ルーレットトレーニング" });
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resultTargetCount(result) {
  const candidates = [result?.targetCount, state.session?.config?.targetCount, DEFAULT_CONFIG.targetCount];
  return candidates.map(Number).find((value) => TARGET_OPTIONS.includes(value)) || DEFAULT_CONFIG.targetCount;
}

function resultImage() {
  if (!state.images.length) return null;
  const session = state.session;
  const preferred = Number.isInteger(session?.lastImageIndex) && session.lastImageIndex >= 0
    ? session.lastImageIndex
    : Number(session?.imageIndex);
  const index = Number.isInteger(preferred) && preferred >= 0 && preferred < state.images.length ? preferred : 0;
  return state.images[index] || null;
}

function renderResultPolaroid() {
  const image = resultImage();
  if (image?.url) {
    return `<figure class="roulette-training-result-polaroid"><img src="${escapeHtml(image.url)}" alt="最後に使用したトレーニング画像"><figcaption>LAST SNAP</figcaption></figure>`;
  }
  return `<figure class="roulette-training-result-polaroid is-sticker"><div>${renderMascot("idle", "sticker")}</div><figcaption>ROOM BUDDY</figcaption></figure>`;
}

function animateResultNumbers() {
  if (state.screen !== "result" || prefersReducedMotion()) return;
  const result = state.result || state.session?.result;
  if (!result) return;
  const key = `${Number(result.finishedAt) || 0}:${result.finishReason || ""}:${Number(result.completedCount) || 0}`;
  if (animatedResultKey === key) return;
  animatedResultKey = key;
  const counters = [...appRoot.querySelectorAll("[data-roulette-result-countup]")];
  if (!counters.length) return;
  const startedAt = performance.now();
  const duration = 650;
  const tick = (now) => {
    const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
    const eased = 1 - ((1 - progress) ** 3);
    counters.forEach((counter) => {
      const finalValue = Math.max(0, Number(counter.dataset.rouletteResultCountup) || 0);
      const current = Math.round(finalValue * eased);
      counter.textContent = counter.dataset.rouletteResultFormat === "duration"
        ? formatDuration(current * 1_000)
        : String(current);
    });
    if (progress < 1) {
      resultCountAnimationFrame = window.requestAnimationFrame(tick);
    } else {
      resultCountAnimationFrame = null;
    }
  };
  counters.forEach((counter) => {
    counter.textContent = counter.dataset.rouletteResultFormat === "duration" ? "00:00" : "0";
  });
  resultCountAnimationFrame = window.requestAnimationFrame(tick);
}

function armRarePresentationSkip() {
  window.clearTimeout(rarePresentationSkipTimer);
  rarePresentationSkipTimer = null;
  const button = appRoot.querySelector('[data-roulette-action="skip-rare-presentation"]');
  if (!button) return;
  const remaining = Math.max(0, rarePresentationStartedAt + RARE_PRESENTATION_SKIP_DELAY_MS - Date.now());
  rarePresentationSkipTimer = window.setTimeout(() => {
    rarePresentationSkipTimer = null;
    if (!button.isConnected) return;
    button.disabled = false;
    button.removeAttribute("aria-hidden");
    button.setAttribute("aria-label", "レア演出をスキップして結果を表示");
  }, remaining);
}

function renderResult() {
  const result = state.result || state.session?.result;
  if (!result) {
    state.screen = "hub";
    return renderHub();
  }
  const last = result.lastChallenge;
  const recordedFinishReason = result.finishReason || state.session?.finishReason;
  const finishReason = recordedFinishReason === "give_up" ? "give_up" : "completed";
  const goalCleared = finishReason === "completed";
  const completedCount = Math.max(0, Number(result.completedCount) || 0);
  const targetCount = resultTargetCount(result);
  const litCount = Math.min(targetCount, completedCount);
  const activeSeconds = Math.max(0, Math.round(Number(result.activeMs || 0) / 1_000));
  const emptyResult = completedCount === 0 && !last;
  const resultState = goalCleared ? "completed" : "give-up";
  const hiddenClass = document.visibilityState === "hidden" ? " is-roulette-document-hidden" : "";
  const summary = goalCleared
    ? "自分のペースで、きょうの目標まで進めました。"
    : emptyResult
      ? "今回は準備したところまで記録しました。<br>また動けそうな日に始めよう。"
      : "進んだぶんを記録しました。";
  return renderFrame(`<div class="roulette-training-result is-result-${resultState}${goalCleared ? " is-goal-clear" : ""}${hiddenClass}">
    ${roomDecorMarkup()}
    <article class="roulette-training-result-notebook">
      <i class="roulette-training-result-binding" aria-hidden="true"></i>
      <i class="roulette-training-result-tape" aria-hidden="true"></i>
      ${renderResultPolaroid()}
      <header class="roulette-training-result-header">
        <span class="roulette-training-result-subtitle">TODAY'S TRAINING NOTE</span>
        <h2>${goalCleared ? "きょうのゴール、達成！" : "きょうはここまで。"}</h2>
        <p class="roulette-training-result-summary">${summary}</p>
        ${goalCleared ? `<span class="roulette-training-goal-stamp" aria-label="ゴールクリア">GOAL<br>CLEAR</span>` : ""}
      </header>
      <div class="roulette-training-result-progress" role="progressbar" aria-label="目標${targetCount}回中${litCount}回達成" aria-valuemin="0" aria-valuemax="${targetCount}" aria-valuenow="${litCount}">
        ${renderGoalLights(litCount, targetCount, { sequential: goalCleared })}
        <small>${litCount} / ${targetCount}</small>
      </div>
      <dl class="roulette-training-result-primary" aria-label="トレーニングの主要な記録">
        <div class="roulette-training-result-stat is-completed"><dt>できたメニュー</dt><dd><span class="sr-only">${completedCount}回</span><strong aria-hidden="true" data-roulette-result-countup="${completedCount}">${completedCount}</strong><small aria-hidden="true">回</small></dd></div>
        <div class="roulette-training-result-stat is-duration"><dt>動いていた時間</dt><dd><span class="sr-only">${escapeHtml(formatDuration(result.activeMs))}</span><strong aria-hidden="true" data-roulette-result-countup="${activeSeconds}" data-roulette-result-format="duration">${escapeHtml(formatDuration(result.activeMs))}</strong></dd></div>
      </dl>
      <section class="roulette-training-tempo-record" aria-labelledby="rouletteTrainingTempoTitle">
        <h3 id="rouletteTrainingTempoTitle">テンポのきろく</h3>
        <div class="roulette-training-tempo-axis">
          <span class="roulette-training-tempo-point is-start"><small>START</small><strong>${Number(result.startBpm)}</strong><em>BPM</em></span>
          <i class="roulette-training-tempo-line" aria-hidden="true"></i>
          <span class="roulette-training-tempo-point is-end"><small>END</small><strong>${Number(result.finalBpm)}</strong><em>BPM</em></span>
          <span class="roulette-training-tempo-max-badge"><small>★ MAX</small><strong>${Number(result.maximumReachedBpm)}</strong><em>BPM</em></span>
        </div>
      </section>
      <section class="roulette-training-last-challenge${last ? "" : " is-empty"}">
        <h3>さいごのチャレンジ</h3>
        ${last ? `<strong>${escapeHtml(last.menuText)}</strong><p>${Number(last.count)}${escapeHtml(unitInfo(last.countUnit).label)} ／ BPM ${Number(last.bpm)}</p>` : `<strong>まだチャレンジは始まっていません</strong><p>準備したところまで、きちんと記録しました。</p>`}
      </section>
      <footer class="roulette-training-result-footer">
        <p class="roulette-training-result-note">結果は自己申告による端末内の記録です。作者、ランキング、RATE、Payには反映されません。</p>
        <button class="button button-primary roulette-training-end-button" type="button" data-roulette-action="end-training" ${state.ending ? "disabled" : ""}>${state.ending ? "端末データを削除中…" : "記録を閉じてお部屋に戻る"}</button>
        <p class="roulette-training-result-delete-note">終了すると、このセッションの進行データと端末保存画像を削除します。</p>
      </footer>
    </article>
    ${renderMascot(goalCleared ? "result-completed" : "result-give-up", "result")}
    ${goalCleared ? particleField(10, "goal") : ""}
  </div>`, { showBack: false, showHeader: false, title: "ルーレットトレーニング結果" });
}

function render() {
  if (!active || !appRoot) return;
  if (resultCountAnimationFrame != null) {
    window.cancelAnimationFrame(resultCountAnimationFrame);
    resultCountAnimationFrame = null;
  }
  const screenRenderers = {
    hub: renderHub,
    setup: renderSetup,
    editor: renderEditor,
    editor_review: renderEditorReview,
    market: renderMarket,
    creator_dashboard: renderCreatorDashboard,
    pack_detail: renderPackDetail,
    play: renderPlay,
    result: renderResult,
  };
  const renderer = screenRenderers[state.screen] || renderHub;
  appRoot.innerHTML = renderer();
  bindEvents();
  armRarePresentationSkip();
  animateResultNumbers();
  appRoot.focus({ preventScroll: true });
  window.clearTimeout(decorationCleanupTimer);
  const transientDecorations = [...appRoot.querySelectorAll(".roulette-training-particles")];
  decorationCleanupTimer = transientDecorations.length
    ? window.setTimeout(() => transientDecorations.forEach((element) => element.remove()), 1_500)
    : null;
}

function navigate(screen) {
  state.screen = screen;
  render();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function spinDuration(type = "main") {
  return prefersReducedMotion()
    ? REEL_REDUCED_MOTION_DURATION_MS
    : REEL_SPIN_DURATION_MS[type] || REEL_SPIN_DURATION_MS.main;
}

function spinFallbackDuration(type) {
  return spinDuration(type) + REEL_FALLBACK_BUFFER_MS;
}

function clearSpinFeedbackTimers() {
  spinFeedbackTimers.forEach((timer) => window.clearTimeout(timer));
  spinFeedbackTimers = [];
}

function clearSpinPresentation({ playStop = false, cancelTrack = true } = {}) {
  const finishedType = activeSpinType;
  activeSpinType = "";
  clearSpinFeedbackTimers();
  if (activeMarkerAnimation) {
    activeMarkerAnimation.cancel();
    activeMarkerAnimation = null;
  }
  if (activeSpinAnimation) {
    const animation = activeSpinAnimation;
    activeSpinAnimation = null;
    if (cancelTrack) animation.cancel();
  }
  if (playStop && finishedType) playRouletteStopSound(finishedType);
}

function playRouletteTone({ frequency, endFrequency = frequency, duration, volume, wave = "square", delay = 0 }) {
  const context = ensureAudioContext();
  if (!context) return;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + Math.max(0, Number(delay) || 0);
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  } catch {
    // Audio is optional; the reel remains fully usable when synthesis is unavailable.
  }
}

function playRoulettePaperFeed(type) {
  const context = ensureAudioContext();
  if (!context) return;
  try {
    const duration = type === "count" ? 0.1 : 0.14;
    const frameCount = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = type === "count" ? 1709 : 1423;
    for (let index = 0; index < frameCount; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      const noise = (seed / 2_147_483_647) * 2 - 1;
      channel[index] = noise * (1 - index / frameCount);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(type === "count" ? 1_250 : 980, start);
    filter.Q.setValueAtTime(0.7, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.018, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + duration + 0.01);
  } catch {
    // Paper-feed feedback is decorative; unsupported audio nodes never block a draw.
  }
}

function playRouletteStartSound(type) {
  playRoulettePaperFeed(type);
  playRouletteTone({
    frequency: type === "count" ? 230 : 190,
    endFrequency: type === "count" ? 155 : 130,
    duration: 0.07,
    volume: 0.018,
    wave: "triangle",
  });
}

function playRouletteClickSound(step = 0) {
  playRouletteTone({
    frequency: 330 + step * 7,
    endFrequency: 145 + step * 4,
    duration: 0.045,
    volume: 0.022,
    wave: "triangle",
  });
}

function playRareFeverChime() {
  [659, 784, 988].forEach((frequency, index) => {
    playRouletteTone({
      frequency,
      endFrequency: frequency * 1.04,
      duration: 0.18,
      volume: 0.026,
      wave: "sine",
      delay: index * 0.075,
    });
  });
}

function playAllOutToyDrum() {
  playRouletteTone({ frequency: 170, endFrequency: 92, duration: 0.12, volume: 0.032, wave: "triangle" });
  playRouletteTone({ frequency: 205, endFrequency: 110, duration: 0.1, volume: 0.024, wave: "triangle", delay: 0.13 });
}

function playPaperStampSound() {
  playRouletteTone({ frequency: 138, endFrequency: 82, duration: 0.11, volume: 0.028, wave: "triangle" });
  playRouletteTone({ frequency: 420, endFrequency: 310, duration: 0.07, volume: 0.012, wave: "sine", delay: 0.035 });
}

function playRouletteStopSound(type) {
  if (type === "main") {
    const pendingEffect = state.session?.pendingMain?.type === "effect" ? state.session.pendingMain.item : null;
    const meta = effectPresentation(pendingEffect);
    if (meta.presentation === "fever" && meta.rarity === "rare") {
      playRareFeverChime();
      return;
    }
    if (meta.presentation === "all-out" && meta.rarity === "rare") {
      playAllOutToyDrum();
      return;
    }
  }
  playRouletteTone({
    frequency: type === "count" ? 587 : 523,
    endFrequency: type === "count" ? 659 : 587,
    duration: 0.22,
    volume: 0.036,
    wave: "sine",
  });
  playRouletteTone({
    frequency: type === "count" ? 880 : 784,
    endFrequency: type === "count" ? 988 : 880,
    duration: 0.25,
    volume: 0.025,
    wave: "sine",
    delay: 0.045,
  });
}

function reelPassageOffsets(passages) {
  const amount = Math.max(1, Math.round(Number(passages) || 1));
  return Array.from({ length: amount }, (_, index) => {
    const progress = (index + 1) / amount;
    const deceleratedProgress = (0.72 * progress) + (0.28 * (progress ** 3));
    return Number((0.06 + (0.88 * deceleratedProgress)).toFixed(6));
  });
}

function markerPassageKeyframes(passageOffsets) {
  const frames = [
    { transform: "translate3d(0, 0, 0)", offset: 0 },
    { transform: "translate3d(0, 0, 0)", offset: 0.045 },
  ];
  passageOffsets.forEach((offset, index) => {
    const previous = passageOffsets[index - 1] ?? 0.045;
    const next = passageOffsets[index + 1] ?? 0.965;
    const lead = Math.min(0.004, Math.max(0.001, (offset - previous) * 0.22));
    const trail = Math.min(0.008, Math.max(0.002, (next - offset) * 0.22));
    frames.push(
      { transform: "translate3d(0, 0, 0)", offset: offset - lead },
      { transform: "translate3d(-2.5px, 0, 0)", offset },
      { transform: "translate3d(0, 0, 0)", offset: offset + trail },
    );
  });
  frames.push({ transform: "translate3d(0, 0, 0)", offset: 1 });
  return frames;
}

function scheduleSpinFeedback(type, duration, passageOffsets) {
  if (prefersReducedMotion()) return;
  passageOffsets.slice(-6).forEach((offset, index) => {
    const timer = window.setTimeout(() => {
      playRouletteClickSound(index);
    }, Math.round(duration * offset));
    spinFeedbackTimers.push(timer);
  });
}

function runReelAnimation(type, settle) {
  const reel = document.querySelector(`.roulette-training-reel-window[data-reel-type="${type}"]`);
  const track = reel?.querySelector(".roulette-training-reel-track");
  const marker = reel?.closest(".roulette-training-reel-shell")?.querySelector(".roulette-training-reel-marker");
  if (!reel || !track) return;
  activeSpinType = type;
  playRouletteStartSound(type);
  const duration = spinDuration(type);
  if (prefersReducedMotion()) {
    if (!reel.animate) return;
    const animation = reel.animate([
      { opacity: 0.48 },
      { opacity: 1 },
    ], { duration, easing: "ease-out", fill: "forwards" });
    activeSpinAnimation = animation;
    animation.finished.then(() => {
      if (activeSpinAnimation !== animation) return;
      clearSpinPresentation({ playStop: true, cancelTrack: false });
      settle();
    }).catch(() => {});
    return;
  }
  const firstRow = track.querySelector(".roulette-training-reel-row");
  // offsetHeight is the layout row pitch; getBoundingClientRect() would include
  // the reel row's visual scale and make the decided result stop off-centre.
  const rowHeight = firstRow?.offsetHeight || 52;
  const landingIndex = Math.max(2, Number(reel.dataset.reelLandingIndex) || 2);
  const landingY = -((landingIndex - 2) * rowHeight);
  const reverseY = type === "count" ? 6 : 8;
  const overshoot = type === "count" ? 7 : 9;
  const passages = Math.max(1, landingIndex - 2);
  const passageOffsets = reelPassageOffsets(passages);
  scheduleSpinFeedback(type, duration, passageOffsets);
  if (!track.animate) {
    reel.classList.add("is-css-fallback");
    return;
  }
  const animation = track.animate([
    { transform: "translate3d(0, 0, 0)", offset: 0, easing: "cubic-bezier(.2,.75,.35,1)" },
    { transform: `translate3d(0, ${reverseY}px, 0)`, offset: 0.045, easing: "cubic-bezier(.2,.75,.35,1)" },
    ...passageOffsets.map((offset, index) => ({
      transform: `translate3d(0, ${-((index + 1) * rowHeight)}px, 0)`,
      offset,
    })),
    { transform: `translate3d(0, ${landingY - overshoot}px, 0)`, offset: 0.965, easing: "cubic-bezier(.2,.82,.24,1)" },
    { transform: `translate3d(0, ${landingY}px, 0)`, offset: 1 },
  ], { duration, fill: "forwards", easing: "linear" });
  activeSpinAnimation = animation;
  if (marker?.animate) {
    activeMarkerAnimation = marker.animate(markerPassageKeyframes(passageOffsets), {
      duration,
      fill: "none",
      easing: "linear",
    });
  }
  animation.finished.then(() => {
    if (activeSpinAnimation !== animation) return;
    clearSpinPresentation({ playStop: true, cancelTrack: false });
    settle();
  }).catch(() => {});
}

function serializeSession(session = state.session) {
  if (!session) return null;
  return {
    version: 1,
    pack: session.pack,
    config: session.config,
    phase: session.phase,
    baseBpm: session.baseBpm,
    startBpm: session.startBpm,
    maximumReachedBpm: session.maximumReachedBpm,
    completedCount: session.completedCount,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt || 0,
    finishReason: session.finishReason || "",
    result: session.result || null,
    menuBag: session.menuBag,
    effectBag: session.effectBag,
    lastMenuId: session.lastMenuId || "",
    lastEffectId: session.lastEffectId || "",
    forceMenu: session.forceMenu,
    pendingMain: session.pendingMain,
    currentEffect: session.currentEffect,
    effectMessage: session.effectMessage,
    pendingAllOutCount: session.pendingAllOutCount === true,
    currentAllOutCount: session.currentAllOutCount === true,
    pendingTemporaryEffect: session.pendingTemporaryEffect,
    activeTemporaryEffect: session.activeTemporaryEffect,
    currentMenu: session.currentMenu,
    currentCheer: session.currentCheer,
    pendingCount: session.pendingCount,
    currentCount: session.currentCount,
    workoutBpm: session.workoutBpm,
    currentWorkoutBpm: session.currentWorkoutBpm,
    imageIndex: session.imageIndex,
    imageBag: session.imageBag,
    lastChallenge: session.lastChallenge,
    paidUseId: session.paidUseId || "",
    ownerUid: session.ownerUid || "",
    localOwnerId: session.localOwnerId || "",
    challengeRemainingMs: session.challengeRemainingMs || 0,
    temporaryRemainingMs: session.temporaryRemainingMs || 0,
    challengeEndsAt: session.challengeEndsAt || 0,
    tempEffectEndsAt: session.tempEffectEndsAt || 0,
    challengeTimedOut: session.challengeTimedOut === true,
    completedActiveMs: session.completedActiveMs || 0,
    activeSegmentStartedAt: session.activeSegmentStartedAt || 0,
    lastImageIndex: Number.isInteger(session.lastImageIndex) ? session.lastImageIndex : -1,
  };
}

function persistSession() {
  const value = serializeSession();
  if (!value) {
    removeStored(SESSION_STORAGE_KEY);
    state.recoveryAvailable = false;
  } else {
    writeJson(SESSION_STORAGE_KEY, value);
    state.recoveryAvailable = true;
  }
}

function normalizeRecoveredPhase(phase, saved) {
  if (saved?.result || phase === "result") return "result";
  if (["active", "paused"].includes(phase)) return "paused";
  if (phase === "countdown") return "count_result";
  if (phase === "main_spinning") return saved?.pendingMain ? "main_settle_recovery" : "main_ready";
  if (phase === "count_spinning") return saved?.pendingCount ? "count_settle_recovery" : "count_ready";
  if (phase === "rest") return "main_ready";
  return ["main_ready", "effect_result", "menu_result", "count_ready", "count_result"].includes(phase)
    ? phase
    : "main_ready";
}

function recoverLocalSession(saved) {
  if (!saved || saved.version !== 1 || !saved.pack || !saved.config) return false;
  try {
    const pack = normalizePack(saved.pack);
    const recoveredConfig = normalizeConfig(saved.config);
    const phase = normalizeRecoveredPhase(saved.phase, saved);
    if (phase === "result") {
      state.config = recoveredConfig;
      state.result = saved.result;
      state.session = { ...saved, pack, config: recoveredConfig, phase: "result", result: saved.result };
      state.screen = "result";
      return true;
    }
    state.selectedPack = pack;
    state.config = recoveredConfig;
    const now = Date.now();
    const wasActive = saved.phase === "active";
    const recoveredChallengeRemainingMs = wasActive && saved.challengeEndsAt
      ? Math.max(0, Number(saved.challengeEndsAt) - now)
      : Math.max(0, Number(saved.challengeRemainingMs) || 0);
    const recoveredTemporaryRemainingMs = wasActive && saved.tempEffectEndsAt
      ? Math.max(0, Number(saved.tempEffectEndsAt) - now)
      : Math.max(0, Number(saved.temporaryRemainingMs) || 0);
    const interruptedSegmentStartedAt = Number(saved.activeSegmentStartedAt) || 0;
    const interruptedSegmentEndedAt = wasActive
      && saved.currentMenu?.countUnit === "seconds"
      && Number(saved.challengeEndsAt) > 0
      ? Math.min(now, Number(saved.challengeEndsAt))
      : now;
    const interruptedActiveMs = wasActive && interruptedSegmentStartedAt > 0
      ? Math.max(0, interruptedSegmentEndedAt - interruptedSegmentStartedAt)
      : 0;
    state.session = {
      ...saved,
      pack,
      config: state.config,
      phase: phase === "main_settle_recovery" ? "main_spinning" : phase === "count_settle_recovery" ? "count_spinning" : phase,
      challengeEndsAt: 0,
      tempEffectEndsAt: 0,
      challengeRemainingMs: recoveredChallengeRemainingMs,
      temporaryRemainingMs: recoveredTemporaryRemainingMs,
      activeTemporaryEffect: recoveredTemporaryRemainingMs > 0 ? saved.activeTemporaryEffect : null,
      pendingAllOutCount: saved.pendingAllOutCount === true,
      currentAllOutCount: saved.currentAllOutCount === true,
      currentWorkoutBpm: recoveredTemporaryRemainingMs > 0
        ? Number(saved.currentWorkoutBpm || saved.workoutBpm || saved.baseBpm)
        : Number(saved.baseBpm),
      completedActiveMs: Math.max(0, Number(saved.completedActiveMs) || 0) + interruptedActiveMs,
      activeSegmentStartedAt: 0,
      challengeTimedOut: saved.challengeTimedOut === true
        || (["active", "paused"].includes(saved.phase)
          && saved.currentMenu?.countUnit === "seconds"
          && recoveredChallengeRemainingMs <= 0),
      restEndsAt: 0,
    };
    state.screen = "play";
    if (phase === "main_settle_recovery") window.setTimeout(settleMainSpin, 0);
    if (phase === "count_settle_recovery") window.setTimeout(settleCountSpin, 0);
    return true;
  } catch {
    removeStored(SESSION_STORAGE_KEY);
    return false;
  }
}

function effectAppliedMessage(applied) {
  const effect = applied.effect;
  if (applied.allOutCount) return "次の回数ルーレットは7枠すべて100になります。";
  if (applied.temporary) return `${effect.label}を予約しました。次のトレーニング開始から${Math.round(applied.durationMs / 1000)}秒だけ、BPM ${applied.workoutBpm}になります。`;
  if (applied.baseBpm === state.session.baseBpm) return `${effect.label}。設定したBPM上限・下限に達しているため、BPM ${applied.baseBpm}のままです。`;
  return `${effect.label}。基本テンポがBPM ${state.session.baseBpm}から${applied.baseBpm}に変わります。`;
}

function spinMainRoulette() {
  const session = state.session;
  if (!session || !["main_ready", "effect_result"].includes(session.phase)) return;
  const draw = drawMain({
    menus: packItems(session.pack),
    menuBag: session.menuBag,
    effectBag: session.effectBag,
    forceMenu: session.forceMenu,
    lastMenuId: session.lastMenuId,
    lastEffectId: session.lastEffectId,
  });
  session.menuBag = [...draw.menuBag];
  session.effectBag = [...draw.effectBag];
  session.forceMenu = draw.forceMenuNext;
  session.pendingMain = draw.type === "menu"
    ? {
      ...draw,
      imageIndex: nextImageIndex(session),
      cheerLine: cheerForMenu(draw.item, session.currentCheer),
    }
    : draw;
  rarePresentationStartedAt = draw.type === "effect" && effectPresentation(draw.item).rarity === "rare"
    ? Date.now()
    : 0;
  session.phase = "main_spinning";
  persistSession();
  render();
  spinTimer = window.setTimeout(settleMainSpin, spinFallbackDuration("main"));
  runReelAnimation("main", settleMainSpin);
}

function skipRarePresentation() {
  const session = state.session;
  const effect = session?.pendingMain?.type === "effect" ? session.pendingMain.item : null;
  if (!session || session.phase !== "main_spinning" || effectPresentation(effect).rarity !== "rare") return;
  if (!rarePresentationStartedAt
      || Date.now() - rarePresentationStartedAt < RARE_PRESENTATION_SKIP_DELAY_MS) return;
  clearSpinPresentation({ playStop: true });
  window.clearTimeout(spinTimer);
  spinTimer = null;
  settleMainSpin();
}

function nextImageIndex(session) {
  let bag = Array.isArray(session.imageBag)
    ? session.imageBag.filter((index) => Number.isInteger(index) && index >= 0 && index < state.images.length)
    : [];
  if (!bag.length) {
    bag = Array.from({ length: state.images.length }, (_, index) => index);
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[swapIndex]] = [bag[swapIndex], bag[index]];
    }
    if (bag.length > 1 && Number.isInteger(session.lastImageIndex) && bag[0] === session.lastImageIndex) {
      const swapIndex = bag.findIndex((value) => value !== session.lastImageIndex);
      [bag[0], bag[swapIndex]] = [bag[swapIndex], bag[0]];
    }
  }
  const imageIndex = bag.shift() ?? 0;
  session.imageBag = bag;
  session.lastImageIndex = imageIndex;
  return imageIndex;
}

function menuCheerLines(menu) {
  return [...new Set(
    (Array.isArray(menu?.cheerLines) ? menu.cheerLines : [])
      .map((line) => String(line || "").trim())
      .filter(Boolean),
  )];
}

function cheerForMenu(menu, previous = "") {
  const lines = Array.isArray(menu?.cheerLines) ? menu.cheerLines.filter(Boolean) : [];
  if (!lines.length) return "その調子！ 自分のペースでいこう！";
  const alternatives = lines.filter((line) => line !== previous);
  const candidates = alternatives.length ? alternatives : lines;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function nextCheerForMenu(menu, current = "") {
  const lines = menuCheerLines(menu);
  if (!lines.length) return "その調子！ 自分のペースでいこう！";
  if (lines.length === 1) return lines[0];
  const currentIndex = lines.indexOf(String(current || ""));
  return lines[(currentIndex + 1 + lines.length) % lines.length];
}

function updateCheerBubble(cheer) {
  const bubble = appRoot.querySelector(".roulette-training-speech-bubble");
  const text = bubble?.querySelector("[data-roulette-cheer-text]");
  if (!bubble || !text) return;
  window.clearTimeout(cheerTransitionTimer);
  cheerTransitionTimer = null;
  text.classList.remove("is-leaving", "is-entering");
  if (prefersReducedMotion()) {
    text.textContent = cheer;
    return;
  }
  text.classList.add("is-leaving");
  cheerTransitionTimer = window.setTimeout(() => {
    cheerTransitionTimer = null;
    if (!text.isConnected) return;
    text.textContent = cheer;
    text.classList.remove("is-leaving");
    text.classList.add("is-entering");
    cheerTransitionTimer = window.setTimeout(() => {
      cheerTransitionTimer = null;
      if (text.isConnected) text.classList.remove("is-entering");
    }, CHEER_ENTRY_DURATION_MS);
  }, CHEER_EXIT_DURATION_MS);
}

function scheduleCheerRotation() {
  window.clearTimeout(cheerRotationTimer);
  cheerRotationTimer = null;
  const session = state.session;
  if (!active
      || state.screen !== "play"
      || document.visibilityState === "hidden"
      || session?.phase !== "active"
      || session.challengeTimedOut
      || menuCheerLines(session.currentMenu).length < 2) return;
  const menuId = String(session.currentMenu?.id || "");
  if (!menuId) return;
  cheerRotationTimer = window.setTimeout(
    () => rotateCheer(session, menuId),
    CHEER_ROTATION_INTERVAL_MS,
  );
}

function rotateCheer(expectedSession = null, expectedMenuId = "") {
  cheerRotationTimer = null;
  const session = state.session;
  if (!active
      || state.screen !== "play"
      || document.visibilityState === "hidden"
      || session?.phase !== "active"
      || session.challengeTimedOut
      || session !== expectedSession
      || String(session.currentMenu?.id || "") !== expectedMenuId) return;
  const nextCheer = nextCheerForMenu(session.currentMenu, session.currentCheer);
  if (nextCheer !== session.currentCheer) {
    session.currentCheer = nextCheer;
    persistSession();
    updateCheerBubble(nextCheer);
  }
  scheduleCheerRotation();
}

function settleMainSpin() {
  clearSpinPresentation({ playStop: activeSpinType === "main" });
  window.clearTimeout(rarePresentationSkipTimer);
  rarePresentationSkipTimer = null;
  rarePresentationStartedAt = 0;
  window.clearTimeout(spinTimer);
  spinTimer = null;
  const session = state.session;
  const draw = session?.pendingMain;
  if (!session || session.phase !== "main_spinning" || !draw?.item) return;
  if (draw.type === "effect") {
    const before = session.baseBpm;
    const applied = applyEffect({
      baseBpm: before,
      effectId: draw.item.id,
      maximumBpm: session.config.maximumBpm,
    });
    session.currentEffect = draw.item;
    session.lastEffectId = draw.item.id;
    session.effectMessage = effectAppliedMessage({ ...applied, previousBaseBpm: before });
    session.pendingAllOutCount = applied.allOutCount === true;
    if (applied.temporary) session.pendingTemporaryEffect = applied;
    else {
      session.baseBpm = applied.baseBpm;
      session.maximumReachedBpm = Math.max(session.maximumReachedBpm, applied.baseBpm);
    }
    session.pendingMain = null;
    session.phase = "effect_result";
    persistSession();
    render();
    announce(`${draw.item.label}。${session.effectMessage}`);
    return;
  }
  session.currentMenu = draw.item;
  session.lastMenuId = draw.item.id;
  session.currentCheer = String(draw.cheerLine || "その調子！ 自分のペースでいこう！");
  session.imageIndex = Number.isInteger(draw.imageIndex) ? draw.imageIndex : 0;
  session.currentAllOutCount = session.pendingAllOutCount === true;
  session.pendingAllOutCount = false;
  session.currentEffect = null;
  session.effectMessage = "";
  session.pendingMain = null;
  session.phase = "menu_result";
  persistSession();
  render();
  announce(`トレーニングは${draw.item.menuText}です。`);
}

function openCountRoulette() {
  if (state.session?.phase !== "menu_result") return;
  state.session.phase = "count_ready";
  persistSession();
  render();
}

function spinCountRoulette() {
  const session = state.session;
  if (!session || session.phase !== "count_ready") return;
  session.pendingCount = drawCount(
    session.currentMenu.countUnit,
    session.config.intensity,
    Math.random,
    { allOut: session.currentAllOutCount === true },
  );
  session.phase = "count_spinning";
  persistSession();
  render();
  spinTimer = window.setTimeout(settleCountSpin, spinFallbackDuration("count"));
  runReelAnimation("count", settleCountSpin);
}

function settleCountSpin() {
  clearSpinPresentation({ playStop: activeSpinType === "count" });
  window.clearTimeout(spinTimer);
  spinTimer = null;
  const session = state.session;
  if (!session || session.phase !== "count_spinning" || !session.pendingCount) return;
  session.currentCount = Number(session.pendingCount.value);
  session.workoutBpm = Number(session.pendingTemporaryEffect?.workoutBpm || session.baseBpm);
  session.currentWorkoutBpm = session.workoutBpm;
  session.phase = "count_result";
  persistSession();
  render();
  announce(`${challengeLabel(session)}、テンポ目安BPM ${session.workoutBpm}です。`);
}

function clearRuntimeTimers() {
  clearSpinPresentation();
  window.clearTimeout(spinTimer);
  window.clearTimeout(decorationCleanupTimer);
  window.clearTimeout(rarePresentationSkipTimer);
  window.clearInterval(countdownTimer);
  window.clearInterval(workoutTicker);
  window.clearTimeout(metronomeTimer);
  window.clearTimeout(cheerRotationTimer);
  window.clearTimeout(cheerTransitionTimer);
  window.clearTimeout(temporaryEffectTimer);
  spinTimer = null;
  decorationCleanupTimer = null;
  rarePresentationSkipTimer = null;
  rarePresentationStartedAt = 0;
  countdownTimer = null;
  workoutTicker = null;
  metronomeTimer = null;
  cheerRotationTimer = null;
  cheerTransitionTimer = null;
  temporaryEffectTimer = null;
  if (resultCountAnimationFrame != null) {
    window.cancelAnimationFrame(resultCountAnimationFrame);
    resultCountAnimationFrame = null;
  }
}

function ensureAudioContext() {
  if (!window.HariaiAudio?.isEnabled?.()) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function playMetronomeBeat() {
  const indicator = document.querySelector(".roulette-training-bpm i");
  if (indicator?.animate && !prefersReducedMotion()) {
    indicator.animate([
      { opacity: 0.55, transform: "scale(0.82)" },
      { opacity: 1, transform: "scale(1.35)" },
      { opacity: 0.72, transform: "scale(1)" },
    ], { duration: 180, easing: "ease-out" });
  }
  const context = ensureAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(720, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.055, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.075);
}

function scheduleMetronome() {
  window.clearTimeout(metronomeTimer);
  if (state.session?.phase !== "active") return;
  if (state.session.currentMenu?.countUnit === "seconds" && state.session.challengeTimedOut) return;
  playMetronomeBeat();
  const bpm = Math.max(MIN_BPM, Number(state.session.currentWorkoutBpm || BASE_BPM));
  metronomeTimer = window.setTimeout(scheduleMetronome, 60_000 / bpm);
}

function startCountdown() {
  const session = state.session;
  if (!session || session.phase !== "count_result") return;
  ensureAudioContext();
  session.phase = "countdown";
  state.countdownValue = 3;
  persistSession();
  render();
  window.HariaiAudio?.playCountdown?.(3);
  countdownTimer = window.setInterval(() => {
    state.countdownValue -= 1;
    if (state.countdownValue <= 0) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
      window.HariaiAudio?.playCountdown?.(0);
      beginChallenge();
      return;
    }
    window.HariaiAudio?.playCountdown?.(state.countdownValue);
    render();
  }, 1_000);
}

function beginChallenge({ resume = false } = {}) {
  const session = state.session;
  if (!session || (!resume && session.phase !== "countdown") || (resume && session.phase !== "paused")) return;
  const now = Date.now();
  if (resume) {
    if (session.currentMenu.countUnit === "seconds" && session.challengeRemainingMs > 0) {
      session.challengeEndsAt = now + session.challengeRemainingMs;
    }
    if (session.activeTemporaryEffect && session.temporaryRemainingMs > 0) {
      session.tempEffectEndsAt = now + session.temporaryRemainingMs;
    }
    if (session.activeTemporaryEffect && session.temporaryRemainingMs <= 0) {
      session.activeTemporaryEffect = null;
    }
    if (session.currentMenu.countUnit === "seconds" && session.challengeRemainingMs <= 0) {
      session.challengeTimedOut = true;
    }
  } else {
    session.challengeRemainingMs = session.currentMenu.countUnit === "seconds" ? session.currentCount * 1_000 : 0;
    session.challengeEndsAt = session.challengeRemainingMs ? now + session.challengeRemainingMs : 0;
    session.activeTemporaryEffect = session.pendingTemporaryEffect;
    session.pendingTemporaryEffect = null;
    session.temporaryRemainingMs = session.activeTemporaryEffect?.durationMs || 0;
    session.tempEffectEndsAt = session.temporaryRemainingMs ? now + session.temporaryRemainingMs : 0;
    session.lastChallenge = {
      menuText: session.currentMenu.menuText,
      count: session.currentCount,
      countUnit: session.currentMenu.countUnit,
      bpm: session.workoutBpm,
    };
    session.challengeTimedOut = false;
  }
  session.currentWorkoutBpm = session.activeTemporaryEffect?.workoutBpm || session.baseBpm;
  session.maximumReachedBpm = Math.max(session.maximumReachedBpm, session.currentWorkoutBpm);
  session.activeSegmentStartedAt = session.challengeTimedOut ? 0 : now;
  session.phase = "active";
  persistSession();
  render();
  scheduleMetronome();
  scheduleCheerRotation();
  scheduleTemporaryEffectExpiry();
  workoutTicker = window.setInterval(updateWorkout, 250);
  announce(`${challengeLabel(session)}を開始しました。できたら「できた！」、つらいときは「今日はここまで」を選んでください。`);
}

function scheduleTemporaryEffectExpiry() {
  window.clearTimeout(temporaryEffectTimer);
  const session = state.session;
  if (!session?.activeTemporaryEffect || !session.tempEffectEndsAt) return;
  const remaining = Math.max(0, session.tempEffectEndsAt - Date.now());
  temporaryEffectTimer = window.setTimeout(expireTemporaryEffect, remaining);
}

function expireTemporaryEffect() {
  const session = state.session;
  if (!session?.activeTemporaryEffect || session.phase !== "active") return;
  const label = session.activeTemporaryEffect.effect?.label || "一時効果";
  session.activeTemporaryEffect = null;
  session.tempEffectEndsAt = 0;
  session.temporaryRemainingMs = 0;
  session.currentWorkoutBpm = session.baseBpm;
  if (!(session.currentMenu?.countUnit === "seconds" && session.challengeTimedOut)) scheduleMetronome();
  persistSession();
  const bpm = document.querySelector("[data-roulette-current-bpm]");
  const effect = document.querySelector("[data-roulette-temp-effect]");
  const play = document.querySelector(".roulette-training-play");
  if (bpm) bpm.textContent = `BPM ${session.baseBpm}`;
  effect?.remove();
  play?.classList.remove("has-presentation-fever");
  play?.removeAttribute("data-roulette-presentation");
  play?.querySelector(".roulette-training-status-effect.is-fever")?.remove();
  announce(`${label}が終了し、BPM ${session.baseBpm}に戻りました。`);
}

function updateTemporaryEffectDisplay() {
  const label = document.querySelector("[data-roulette-effect-seconds]");
  if (!label || !state.session?.activeTemporaryEffect) return;
  label.textContent = `残り${temporaryEffectRemainingSeconds(state.session)}秒`;
}

function updateWorkout() {
  const session = state.session;
  if (!session || session.phase !== "active") return;
  updateTemporaryEffectDisplay();
  if (session.currentMenu.countUnit !== "seconds" || !session.challengeEndsAt) return;
  const seconds = remainingSeconds();
  session.challengeRemainingMs = Math.max(0, session.challengeEndsAt - Date.now());
  const display = document.querySelector("[data-roulette-workout-seconds]");
  if (display) display.textContent = String(seconds);
  if (seconds > 0) return;
  stopActiveClock();
  session.challengeEndsAt = 0;
  session.challengeRemainingMs = 0;
  session.challengeTimedOut = true;
  window.clearInterval(workoutTicker);
  workoutTicker = null;
  window.clearTimeout(metronomeTimer);
  metronomeTimer = null;
  window.clearTimeout(cheerRotationTimer);
  cheerRotationTimer = null;
  window.clearTimeout(cheerTransitionTimer);
  cheerTransitionTimer = null;
  persistSession();
  render();
  announce("時間になりました。できたら「できた！」、つらいときは「今日はここまで」を選んでください。");
}

function pauseChallengeForVisibility() {
  const session = state.session;
  if (!session || session.phase !== "active") return;
  const now = Date.now();
  if (session.challengeEndsAt) session.challengeRemainingMs = Math.max(0, session.challengeEndsAt - now);
  if (session.tempEffectEndsAt) session.temporaryRemainingMs = Math.max(0, session.tempEffectEndsAt - now);
  if (session.currentMenu?.countUnit === "seconds" && session.challengeRemainingMs <= 0) {
    session.challengeTimedOut = true;
  }
  stopActiveClock(now);
  session.challengeEndsAt = 0;
  session.tempEffectEndsAt = 0;
  session.phase = "paused";
  clearRuntimeTimers();
  persistSession();
}

function clearActionOrigin() {
  if (prefersReducedMotion()) return null;
  const button = document.querySelector('[data-roulette-action="clear"]');
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function launchClearProgressEffect(origin) {
  if (!origin || prefersReducedMotion() || !appRoot) return;
  const litLights = appRoot.querySelectorAll(".roulette-training-progress-lights i.is-lit");
  const target = litLights[litLights.length - 1];
  if (!target) return;
  const targetRect = target.getBoundingClientRect();
  const targetX = targetRect.left + targetRect.width / 2;
  const targetY = targetRect.top + targetRect.height / 2;
  const spreads = [-34, -20, -8, 9, 23, 36];
  const particles = document.createElement("div");
  particles.className = "roulette-training-clear-particles";
  particles.setAttribute("aria-hidden", "true");
  particles.innerHTML = spreads.map((spread, index) => {
    const middleX = (origin.x + targetX) / 2 + spread;
    const middleY = Math.min(origin.y, targetY) - 44 - (index % 3) * 8;
    const finishX = targetX + ((index % 3) - 1) * 5;
    const finishY = targetY + (index % 2 ? 2 : -2);
    return `<i style="--start-x:${origin.x}px;--start-y:${origin.y}px;--middle-x:${middleX}px;--middle-y:${middleY}px;--finish-x:${finishX}px;--finish-y:${finishY}px;--clear-delay:${index * 34}ms"></i>`;
  }).join("");
  target.classList.add("is-just-lit");
  appRoot.append(particles);
  window.setTimeout(() => particles.remove(), 1_000);
}

function clearChallenge() {
  const session = state.session;
  if (!session || session.phase !== "active") return;
  const clearOrigin = clearActionOrigin();
  stopActiveClock();
  clearRuntimeTimers();
  session.completedCount += 1;
  session.activeTemporaryEffect = null;
  session.pendingTemporaryEffect = null;
  session.pendingAllOutCount = false;
  session.currentAllOutCount = false;
  session.tempEffectEndsAt = 0;
  session.temporaryRemainingMs = 0;
  session.challengeEndsAt = 0;
  session.challengeRemainingMs = 0;
  if (session.completedCount >= session.config.targetCount) {
    finishSession("completed");
    return;
  }
  if (session.config.restSeconds > 0) {
    session.phase = "rest";
    session.restEndsAt = Date.now() + session.config.restSeconds * 1_000;
    persistSession();
    render();
    launchClearProgressEffect(clearOrigin);
    workoutTicker = window.setInterval(updateRest, 250);
    announce(`できた！ ${session.config.restSeconds}秒休憩です。`);
    return;
  }
  prepareNextMain();
  launchClearProgressEffect(clearOrigin);
}

function stopActiveClock(now = Date.now()) {
  const session = state.session;
  if (!session?.activeSegmentStartedAt) return;
  session.completedActiveMs = Math.max(0, Number(session.completedActiveMs) || 0)
    + Math.max(0, Number(now) - Number(session.activeSegmentStartedAt));
  session.activeSegmentStartedAt = 0;
}

function updateRest() {
  const session = state.session;
  if (!session || session.phase !== "rest") return;
  const seconds = Math.max(0, Math.ceil((session.restEndsAt - Date.now()) / 1000));
  const display = document.querySelector("[data-roulette-rest-seconds]");
  if (display) display.textContent = String(seconds);
  if (seconds <= 0) finishRest();
}

function prepareNextMain() {
  const session = state.session;
  if (!session) return;
  clearRuntimeTimers();
  session.phase = "main_ready";
  session.currentEffect = null;
  session.effectMessage = "";
  session.pendingAllOutCount = false;
  session.currentAllOutCount = false;
  session.currentMenu = null;
  session.currentCheer = "";
  session.pendingCount = null;
  session.currentCount = null;
  session.workoutBpm = session.baseBpm;
  session.currentWorkoutBpm = session.baseBpm;
  session.restEndsAt = 0;
  persistSession();
  render();
  announce("次のルーレットを回せます。");
}

function finishRest() {
  if (state.session?.phase !== "rest") return;
  prepareNextMain();
}

function finishRetryRecord() {
  const stored = readJson(FINISH_RETRY_STORAGE_KEY, null);
  const useId = String(stored?.useId || "");
  if (useId) {
    volatileFinishRetryRecord = {
      useId,
      ownerUid: String(stored?.ownerUid || ""),
    };
  }
  return volatileFinishRetryRecord;
}

function currentFinishOwnerUid() {
  return String(state.session?.ownerUid || state.uid || auth.currentUser?.uid || "");
}

function finishRetryBelongsToCurrentOwner(record = finishRetryRecord()) {
  if (!record) return false;
  const currentUid = currentFinishOwnerUid();
  return !record.ownerUid || !currentUid || record.ownerUid === currentUid;
}

function terminalFinishUseId() {
  const record = finishRetryRecord();
  if (record && finishRetryBelongsToCurrentOwner(record)) return record.useId;
  const currentUid = currentFinishOwnerUid();
  if (pendingFinishRetryUseId && !record
      && (!pendingFinishRetryOwnerUid || !currentUid || pendingFinishRetryOwnerUid === currentUid)) {
    return pendingFinishRetryUseId;
  }
  return "";
}

function finishUseIsFenced(useId) {
  const normalizedUseId = String(useId || "");
  return Boolean(normalizedUseId && normalizedUseId === terminalFinishUseId());
}

function removeFinishRetryRecord(useId) {
  const normalizedUseId = String(useId || "");
  const stored = readJson(FINISH_RETRY_STORAGE_KEY, null);
  if (String(stored?.useId || "") === normalizedUseId
      && (!removeStored(FINISH_RETRY_STORAGE_KEY) || readJson(FINISH_RETRY_STORAGE_KEY, null))) {
    return false;
  }
  if (volatileFinishRetryRecord?.useId === normalizedUseId) volatileFinishRetryRecord = null;
  return String(finishRetryRecord()?.useId || "") !== normalizedUseId;
}

function finishSession(reason) {
  const session = state.session;
  if (!session || session.result) return;
  stopActiveClock();
  clearRuntimeTimers();
  session.finishedAt = Date.now();
  session.finishReason = reason === "give_up" ? "give_up" : "completed";
  session.pendingAllOutCount = false;
  session.currentAllOutCount = false;
  session.result = {
    ...resultSummary({
      completedCount: session.completedCount,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      startBpm: session.startBpm,
      finalBpm: session.baseBpm,
      maximumReachedBpm: session.maximumReachedBpm,
      finishReason: session.finishReason,
      lastChallenge: session.lastChallenge,
    }),
    activeMs: Math.max(0, Number(session.completedActiveMs) || 0),
    targetCount: TARGET_OPTIONS.includes(Number(session.config?.targetCount))
      ? Number(session.config.targetCount)
      : DEFAULT_CONFIG.targetCount,
  };
  session.phase = "result";
  state.result = session.result;
  state.screen = "result";
  persistSession();
  render();
  if (session.finishReason === "completed") playPaperStampSound();
  announce(session.finishReason === "completed"
    ? `きょうのゴール、達成！ ${session.completedCount}メニューできました。`
    : `きょうはここまで。${session.completedCount}メニュー分を端末内に記録しました。`);
  if (session.paidUseId) finishPaidUseBestEffort(session.paidUseId, session.ownerUid);
}

function giveUpBeforeStart() {
  const paidUseId = String(state.activeUse?.id || state.activeUse?.useId || "");
  if (!paidUseId || state.screen !== "setup") return;
  const now = Date.now();
  const pack = normalizePack(state.selectedPack || state.activeUse?.pack || FREE_PACK);
  const owner = storageOwner({ paidUseId });
  state.session = {
    version: 1,
    pack,
    config: { ...state.config },
    phase: "main_ready",
    baseBpm: state.config.baseBpm,
    startBpm: state.config.baseBpm,
    maximumReachedBpm: state.config.baseBpm,
    completedCount: 0,
    startedAt: now,
    finishedAt: 0,
    finishReason: "",
    result: null,
    lastChallenge: null,
    paidUseId,
    ...owner,
    completedActiveMs: 0,
    activeSegmentStartedAt: 0,
  };
  finishSession("give_up");
}

function finishPaidUseBestEffort(useId, ownerUid = "") {
  const normalizedUseId = String(useId || "");
  if (!normalizedUseId || useOfflineMarketPreview) return Promise.resolve(true);
  if (finishedPaidUseIds.has(normalizedUseId)) return Promise.resolve(true);
  const existingRequest = pendingFinishRequests.get(normalizedUseId);
  if (existingRequest) return existingRequest.promise;

  const existing = finishRetryRecord();
  const normalizedOwnerUid = String(ownerUid || currentFinishOwnerUid() || (existing?.useId === normalizedUseId ? existing.ownerUid : ""));
  volatileFinishRetryRecord = {
    useId: normalizedUseId,
    ownerUid: normalizedOwnerUid,
  };
  writeJson(FINISH_RETRY_STORAGE_KEY, volatileFinishRetryRecord);
  pendingFinishRetryUseId = normalizedUseId;
  pendingFinishRetryOwnerUid = normalizedOwnerUid;
  let request;
  request = (async () => {
    try {
      await callRouletteTrainingAction("finish_use", { useId: normalizedUseId });
      if (!removeFinishRetryRecord(normalizedUseId)) return false;
      finishedPaidUseIds.add(normalizedUseId);
      const activeUseId = String(state.activeUse?.id || state.activeUse?.useId || "");
      if (activeUseId === normalizedUseId) state.activeUse = null;
      state.marketLoaded = false;
      return true;
    } catch {
      // The server receives no local result. Keep the owner-bound fence for an explicit retry.
      return false;
    } finally {
      const entry = pendingFinishRequests.get(normalizedUseId);
      if (entry?.promise === request) pendingFinishRequests.delete(normalizedUseId);
      if (pendingFinishRetryPromise === request) {
        pendingFinishRetryPromise = null;
        pendingFinishRetryUseId = "";
        pendingFinishRetryOwnerUid = "";
      }
    }
  })();
  pendingFinishRequests.set(normalizedUseId, { promise: request, ownerUid: normalizedOwnerUid });
  pendingFinishRetryPromise = request;
  return request;
}

async function validateFinishRetryOwner(record) {
  if (!record?.useId) return false;
  let user;
  try {
    user = await ensureUser();
  } catch {
    return false;
  }
  const currentUid = String(user?.uid || "");
  if (record.ownerUid) {
    if (record.ownerUid === currentUid) return true;
    removeFinishRetryRecord(record.useId);
    return false;
  }

  try {
    const serverState = await callRouletteTrainingAction("state");
    const activeUseId = String(serverState?.activeUse?.id || serverState?.activeUse?.useId || "");
    if (currentUid && activeUseId === record.useId) {
      writeJson(FINISH_RETRY_STORAGE_KEY, { useId: record.useId, ownerUid: currentUid });
      return true;
    }
    removeFinishRetryRecord(record.useId);
  } catch {
    // A legacy ownerless fence is retained, but never sent until ownership can be proven.
  }
  return false;
}

async function flushFinishRetry() {
  const queued = finishRetryRecord();
  if (!queued?.useId || useOfflineMarketPreview) return true;
  const existingRequest = pendingFinishRequests.get(queued.useId);
  if (existingRequest) return existingRequest.promise;
  const ownerConfirmed = await validateFinishRetryOwner(queued);
  if (!ownerConfirmed) return !finishRetryRecord();
  return finishPaidUseBestEffort(queued.useId, queued.ownerUid || currentFinishOwnerUid());
}

function storageOwner(session = state.session) {
  const paidUseId = String(session?.paidUseId || state.activeUse?.id || state.activeUse?.useId || "");
  const ownerUid = String(session?.ownerUid || state.uid || auth.currentUser?.uid || "");
  if (ownerUid) {
    return {
      ownerUid,
      localOwnerId: "",
    };
  }
  if (paidUseId) return { ownerUid: "", localOwnerId: "" };
  return {
    ownerUid: "",
    localOwnerId: String(session?.localOwnerId || localOwnerId()),
  };
}

function storageOwnerMatches(left, right) {
  const expectedUid = String(right?.ownerUid || "");
  const expectedLocal = String(right?.localOwnerId || "");
  if (expectedUid) return String(left?.ownerUid || "") === expectedUid;
  return Boolean(expectedLocal) && String(left?.localOwnerId || "") === expectedLocal;
}

async function purgeStoredRecovery(message = "") {
  removeStored(SESSION_STORAGE_KEY);
  state.recoveryAvailable = false;
  state.recoveryError = "";
  state.session = null;
  state.result = null;
  releaseImages();
  let cleared = false;
  try {
    cleared = await clearSessionImageBlobs({ force: true });
  } catch {
    cleared = false;
  }
  if (message) showToast(message);
  if (!cleared) showToast("別アカウントの端末保存画像を削除できませんでした。ブラウザのサイトデータを削除してください。");
  return cleared;
}

function handleActiveAuthUidChange(nextUid, previousUid = state.uid) {
  const normalizedNextUid = String(nextUid || "");
  const normalizedPreviousUid = String(previousUid || state.uid || "");
  if (!active || !normalizedPreviousUid || normalizedPreviousUid === normalizedNextUid) {
    if (active && !normalizedPreviousUid) {
      state.uid = normalizedNextUid;
      state.authReady = Boolean(normalizedNextUid);
    }
    return Promise.resolve();
  }
  if (authResetPromise && authResetTargetUid === normalizedNextUid) return authResetPromise;

  renderGeneration += 1;
  const generation = operationGeneration();
  clearRuntimeTimers();
  setBusy(false);
  releaseImages();
  removeStored(SESSION_STORAGE_KEY);
  removeStored(DRAFT_STORAGE_KEY);
  removeStored(PUBLISH_ATTEMPT_STORAGE_KEY);
  removeStored(USE_ATTEMPT_STORAGE_KEY);
  const retry = finishRetryRecord();
  if (retry && (!retry.ownerUid || retry.ownerUid === normalizedPreviousUid)) {
    removeFinishRetryRecord(retry.useId);
  }
  state = createState();
  state.uid = normalizedNextUid;
  state.authReady = Boolean(normalizedNextUid);
  state.bootstrapLoading = true;
  state.screen = "hub";
  render();

  authResetTargetUid = normalizedNextUid;
  let resetTask;
  resetTask = (async () => {
    let imagesCleared = false;
    try {
      imagesCleared = await clearSessionImageBlobs({ force: true });
      if (!generationIsCurrent(generation)) return;
      const finishConfirmed = await flushFinishRetry();
      if (!generationIsCurrent(generation)) return;
      if (!finishConfirmed || terminalFinishUseId()) return;
      const serverState = await callRouletteTrainingAction("state");
      if (!generationIsCurrent(generation)) return;
      applyServerMarketState(serverState);
      state.editorDraft = restoreDraft();
    } catch (error) {
      if (generationIsCurrent(generation)) {
        showToast(friendlyError(error, "新しいアカウントの利用状態を読み込めませんでした。無料お試しは利用できます。"));
      }
    } finally {
      if (generationIsCurrent(generation)) {
        state.bootstrapLoading = false;
        render();
        showToast("アカウントが切り替わったため、前のアカウントの端末内データを画面から外しました。");
        if (!imagesCleared) {
          showToast("前のアカウントの端末保存画像を削除できませんでした。ブラウザのサイトデータを削除してください。");
        }
      }
      if (authResetPromise === resetTask) {
        authResetPromise = null;
        authResetTargetUid = "";
      }
    }
  })();
  authResetPromise = resetTask;
  return resetTask;
}

async function validateStoredRecoveryOwner(saved) {
  const generation = operationGeneration();
  if (!saved || saved.version !== 1) return false;
  const paidUseId = String(saved.paidUseId || "");
  const savedOwnerUid = String(saved.ownerUid || "");
  if (savedOwnerUid) {
    try {
      const user = await ensureUser();
      if (!generationIsCurrent(generation)) return false;
      if (user.uid === savedOwnerUid) return true;
    } catch {
      return false;
    }
    await purgeStoredRecovery("別のアカウントで保存されたセッションと画像を破棄しました。");
    return false;
  }
  if (typeof auth.authStateReady === "function") {
    try {
      await auth.authStateReady();
    } catch {
      return false;
    }
    if (!generationIsCurrent(generation)) return false;
  }
  if (paidUseId || auth.currentUser) {
    await purgeStoredRecovery(paidUseId
      ? "所有者を確認できない有料セッションの端末データを破棄しました。"
      : "認証前に保存された端末内セッションは、アカウントを確認できないため破棄しました。");
    return false;
  }
  if (String(saved.localOwnerId || "") === localOwnerId()) return true;
  await purgeStoredRecovery("所有者を確認できない端末内セッションと画像を破棄しました。");
  return false;
}

async function openImageDatabase() {
  if (!("indexedDB" in window)) return null;
  if (imageDatabasePromise) return imageDatabasePromise;
  imageDatabasePromise = new Promise((resolve) => {
    const request = indexedDB.open(IMAGE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) database.createObjectStore(IMAGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      imageDatabasePromise = null;
      resolve(null);
    };
    request.onblocked = () => {
      imageDatabasePromise = null;
      resolve(null);
    };
  });
  return imageDatabasePromise;
}

async function writeSessionImageBlobs(items) {
  if (!state.config.keepImages) return true;
  const generation = operationGeneration();
  const owner = storageOwner();
  if ((state.activeUse || state.session?.paidUseId) && !owner.ownerUid) return false;
  const database = await openImageDatabase();
  if (!database) return false;
  if (!generationIsCurrent(generation)) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({
      schemaVersion: 1,
      ...owner,
      blobs: items.map((item) => item.blob),
    }, IMAGE_RECORD_KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

async function readSessionImageBlobs(expectedOwner = storageOwner()) {
  if (!state.config.keepImages) return [];
  const generation = operationGeneration();
  const database = await openImageDatabase();
  if (!database) return [];
  const record = await new Promise((resolve) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(IMAGE_STORE_NAME).get(IMAGE_RECORD_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
  if (!generationIsCurrent(generation)) return [];
  if (!record) return [];
  if (!storageOwnerMatches(record, expectedOwner)) {
    await purgeStoredRecovery("別のアカウントで保存された画像を表示せず破棄しました。");
    return [];
  }
  return Array.isArray(record.blobs) ? record.blobs : [];
}

async function clearSessionImageBlobs({ force = false } = {}) {
  if (!force && !state.config.keepImages) return true;
  if (!("indexedDB" in window)) return true;
  const database = await openImageDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).delete(IMAGE_RECORD_KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });
}

function releaseImages() {
  state.images.forEach((item) => {
    if (String(item?.url || "").startsWith("blob:")) URL.revokeObjectURL(item.url);
  });
  state.images = [];
}

async function restoreSessionImages(savedSession = state.session) {
  const generation = operationGeneration();
  const blobs = await readSessionImageBlobs(storageOwner(savedSession));
  if (!generationIsCurrent(generation) || !blobs.length) return;
  releaseImages();
  state.images = blobs.slice(0, IMAGE_MAX_COUNT).map((blob, index) => ({
    id: `recovered-${index}`,
    blob,
    url: URL.createObjectURL(blob),
    position: index,
  }));
  render();
}

async function handleImageSelection(fileList) {
  const generation = operationGeneration();
  const files = [...(fileList || [])];
  if (files.length < 1) return;
  if (files.length > IMAGE_MAX_COUNT) {
    showToast(`画像は最大${IMAGE_MAX_COUNT}枚までです。先頭${IMAGE_MAX_COUNT}枚を読み込みます。`);
  }
  state.loadingImages = true;
  render();
  setBusy(true, "ルーレット用の画像を端末内で準備しています…");
  const next = [];
  try {
    for (const [index, file] of files.slice(0, IMAGE_MAX_COUNT).entries()) {
      let item;
      if (typeof shared()?.processImageFile === "function") {
        item = await shared().processImageFile(file, index, { maxSide: 1_600, quality: 0.86 });
      } else {
        if (!String(file.type || "").startsWith("image/")) throw new Error("画像ファイルだけ選択できます。");
        item = { id: `roulette-${Date.now()}-${index}`, blob: file, url: URL.createObjectURL(file), position: index };
      }
      if (!generationIsCurrent(generation)) {
        if (String(item?.url || "").startsWith("blob:")) URL.revokeObjectURL(item.url);
        next.forEach((entry) => {
          if (String(entry?.url || "").startsWith("blob:")) URL.revokeObjectURL(entry.url);
        });
        return;
      }
      next.push(item);
    }
    if (!generationIsCurrent(generation)) return;
    releaseImages();
    state.images = next;
    if (state.config.keepImages) {
      const saved = await writeSessionImageBlobs(next);
      if (!saved) showToast("画像は現在の画面では使えますが、再読み込み用の端末保存はできませんでした。");
    }
  } catch (error) {
    next.forEach((item) => {
      if (String(item?.url || "").startsWith("blob:")) URL.revokeObjectURL(item.url);
    });
    showToast(friendlyError(error, "画像を準備できませんでした。"));
  } finally {
    if (generationIsCurrent(generation)) {
      state.loadingImages = false;
      setBusy(false);
      render();
    }
  }
}

async function removeImage(index) {
  const generation = operationGeneration();
  const item = state.images[index];
  if (!item) return;
  const nextImages = state.images
    .filter((_, position) => position !== index)
    .map((entry, position) => ({ ...entry, position }));
  if (state.config.keepImages) {
    let saved = false;
    try {
      saved = await writeSessionImageBlobs(nextImages);
    } catch {
      saved = false;
    }
    if (!generationIsCurrent(generation)) return;
    if (!saved) {
      showToast("端末保存を更新できなかったため、画像を外しませんでした。もう一度お試しください。");
      return;
    }
  }
  state.images = nextImages;
  if (String(item.url || "").startsWith("blob:")) URL.revokeObjectURL(item.url);
  render();
}

function updateSetupConfig(form, { preserveImageConsent = false } = {}) {
  const data = new FormData(form);
  state.config = normalizeConfig({
    baseBpm: data.get("baseBpm"),
    maximumBpm: data.get("maximumBpm"),
    intensity: data.get("intensity"),
    restSeconds: data.get("restSeconds"),
    targetCount: data.get("targetCount"),
    keepImages: preserveImageConsent
      ? state.config.keepImages
      : data.get("keepImages") === "on",
  });
  writeJson(CONFIG_STORAGE_KEY, state.config);
}

async function setImagePersistenceConsent(enabled) {
  const generation = operationGeneration();
  const previous = state.config.keepImages;
  state.config = { ...state.config, keepImages: enabled === true };
  writeJson(CONFIG_STORAGE_KEY, state.config);
  if (state.config.keepImages) {
    if (state.images.length) {
      const saved = await writeSessionImageBlobs(state.images);
      if (!generationIsCurrent(generation)) return;
      if (!saved) showToast("端末へ画像を保存できませんでした。現在の画面では引き続き使えます。");
    }
    return;
  }
  if (previous) {
    let cleared = false;
    try {
      cleared = await clearSessionImageBlobs({ force: true });
    } catch {
      cleared = false;
    }
    if (!generationIsCurrent(generation)) return;
    if (!cleared) {
      state.config = { ...state.config, keepImages: true };
      writeJson(CONFIG_STORAGE_KEY, state.config);
      throw new Error("端末保存画像を削除できなかったため、保存設定をONのままにしました。もう一度お試しください。");
    }
  }
}

function beginSession(form) {
  if (state.recoveryAvailable) {
    showToast("前回データを復元するか、安全に破棄してから新しく始めてください。");
    navigate("hub");
    return;
  }
  if (terminalFinishUseId() && !(state.selectedPack?.builtin && state.selectedPackSource === "builtin")) {
    showToast("前回の有料利用の終了処理を完了してから、新しいトレーニングを開始できます。");
    navigate("hub");
    return;
  }
  if (state.activeUse) {
    let activePack = null;
    try {
      activePack = packFromServer(state.activeUse.pack || state.activeUse.packSnapshot);
    } catch {
      activePack = null;
    }
    const selectionMatchesActive = activePack
      && state.selectedPackSource === "active_use"
      && packIdentity(state.selectedPack) === packIdentity(activePack)
      && packRevision(state.selectedPack) === packRevision(activePack);
    if (!selectionMatchesActive) {
      if (activePack) {
        state.selectedPack = activePack;
        state.selectedPackSource = "active_use";
      }
      showToast("開始済みの有料利用と選択中のパックが一致しないため、開始せず利用内容を再確認します。");
      render();
      return;
    }
  }
  if (state.images.length < 1) {
    showToast("トレーニングに使う画像を1枚以上選んでください。");
    return;
  }
  if (form) updateSetupConfig(form);
  const pack = normalizePack(state.selectedPack);
  const paidUseId = String(state.activeUse?.id || state.activeUse?.useId || "");
  const owner = storageOwner({ paidUseId });
  state.session = {
    version: 1,
    pack,
    config: { ...state.config },
    phase: "main_ready",
    baseBpm: state.config.baseBpm,
    startBpm: state.config.baseBpm,
    maximumReachedBpm: state.config.baseBpm,
    completedCount: 0,
    startedAt: Date.now(),
    finishedAt: 0,
    finishReason: "",
    result: null,
    menuBag: [],
    effectBag: [],
    lastMenuId: "",
    lastEffectId: "",
    forceMenu: false,
    pendingMain: null,
    currentEffect: null,
    effectMessage: "",
    pendingAllOutCount: false,
    currentAllOutCount: false,
    pendingTemporaryEffect: null,
    activeTemporaryEffect: null,
    currentMenu: null,
    currentCheer: "",
    pendingCount: null,
    currentCount: null,
    workoutBpm: state.config.baseBpm,
    currentWorkoutBpm: state.config.baseBpm,
    imageIndex: 0,
    imageBag: [],
    lastImageIndex: -1,
    lastChallenge: null,
    paidUseId,
    ...owner,
    challengeRemainingMs: 0,
    temporaryRemainingMs: 0,
    challengeEndsAt: 0,
    tempEffectEndsAt: 0,
    challengeTimedOut: false,
    completedActiveMs: 0,
    activeSegmentStartedAt: 0,
    restEndsAt: 0,
  };
  state.result = null;
  state.screen = "play";
  persistSession();
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
  announce("ルーレットトレーニングを開始しました。最初のルーレットを回してください。");
}

function updateEditorDraftFromForm(form, { validateCheerLines = false } = {}) {
  if (!form) return state.editorDraft;
  const data = new FormData(form);
  const items = state.editorDraft.items.map((item, index) => ({
    id: `draft-menu-${index + 1}`,
    menuText: String(data.get(`menuText-${index}`) || ""),
    detailText: String(data.get(`detailText-${index}`) || ""),
    countUnit: unitInfo(data.get(`countUnit-${index}`)).id,
    cheerLines: normalizeEditorCheerLines(data.get(`cheerLines-${index}`), {
      validate: validateCheerLines,
      itemIndex: index,
    }),
  }));
  state.editorDraft = {
    ...state.editorDraft,
    sellerName: String(data.get("sellerName") || ""),
    title: String(data.get("title") || ""),
    description: String(data.get("description") || ""),
    price: Number(data.get("price") || 5),
    items,
  };
  persistEditorDraft();
  return state.editorDraft;
}

function editorDraftPack(form) {
  const draft = updateEditorDraftFromForm(form, { validateCheerLines: true });
  if ([...draft.description].length < 10) throw new Error("パックの説明は10文字以上で入力してください。");
  const normalized = normalizePack({
    ...draft,
    id: draft.packId || draft.id || "local-draft",
    revision: draft.baseRevision || 1,
  });
  return { ...normalized, packId: draft.packId || "", baseRevision: draft.baseRevision || 0 };
}

function addEditorMenu() {
  const form = document.querySelector("#rouletteTrainingEditorForm");
  updateEditorDraftFromForm(form);
  if (state.editorDraft.items.length >= MENU_MAX_COUNT) return;
  state.editorDraft.items.push(blankMenu(state.editorDraft.items.length));
  persistEditorDraft();
  render();
}

function removeEditorMenu(index) {
  const form = document.querySelector("#rouletteTrainingEditorForm");
  updateEditorDraftFromForm(form);
  if (state.editorDraft.items.length <= 1) return;
  state.editorDraft.items.splice(index, 1);
  state.editorDraft.items.forEach((item, position) => { item.id = `draft-menu-${position + 1}`; });
  persistEditorDraft();
  render();
}

function testEditorDraft() {
  if (state.recoveryAvailable) {
    showToast("前回データを復元するか、安全に破棄してから無料テストを開始してください。");
    navigate("hub");
    return;
  }
  if (terminalFinishUseId()) {
    showToast("前回の有料利用の終了処理を完了してから、無料テストを開始できます。");
    navigate("hub");
    return;
  }
  if (state.activeUse) {
    showToast("開始済みの利用を再開するか、ギブアップして終了してください。");
    return;
  }
  try {
    const pack = editorDraftPack(document.querySelector("#rouletteTrainingEditorForm"));
    state.selectedPack = { ...pack, id: "local-draft-test", revision: 0, price: 0 };
    state.selectedPackSource = "draft";
    state.activeUse = null;
    navigate("setup");
  } catch (error) {
    showToast(friendlyError(error, "入力内容を確認してください。"));
  }
}

async function publishEditorPack() {
  const generation = operationGeneration();
  const pack = state.editorReviewPack;
  if (!pack || state.editorBusy) return;
  if (terminalFinishUseId()) {
    showToast("前回の有料利用の終了処理を完了してから、販売操作を続けられます。");
    navigate("hub");
    return;
  }
  state.editorBusy = true;
  render();
  try {
    if (!Number.isFinite(state.balance)) {
      const serverState = await callRouletteTrainingAction("state");
      if (!generationIsCurrent(generation)) return;
      applyServerMarketState(serverState);
    }
    const publication = {
      baseRevision: Number(pack.baseRevision || 0),
      sellerName: pack.sellerName,
      title: pack.title,
      description: pack.description,
      price: pack.price,
      items: pack.items.map((item) => ({
        menuText: item.menuText,
        detailText: item.detailText || "",
        countUnit: item.countUnit,
        cheerLines: [...item.cheerLines],
      })),
    };
    if (pack.packId) publication.packId = pack.packId;
    const signature = JSON.stringify(publication);
    const actionId = pendingActionId(PUBLISH_ATTEMPT_STORAGE_KEY, signature, "roulette_publish");
    const response = await callRouletteTrainingAction("publish", {
      actionId,
      expectedBalance: Number(state.balance || 0),
      ...publication,
    });
    if (!generationIsCurrent(generation)) return;
    removeStored(PUBLISH_ATTEMPT_STORAGE_KEY);
    if (Number.isFinite(Number(response.balance))) state.balance = Number(response.balance);
    invalidateMarketInsights();
    showToast("トレーニングメニューパックを公開しました。");
    state.editorReviewPack = null;
    state.screen = "market";
    render();
    loadMarket({ force: true });
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    if (requiresFreshReview(error)) {
      state.screen = "market";
      state.selectedMarketPack = null;
      state.marketLoaded = false;
      render();
      await loadMarket({ force: true });
      if (generationIsCurrent(generation)) {
        showToast("残高または改訂が更新されました。市場の最新版から内容を確認し直してください。下書きは端末に残っています。");
      }
    } else {
      showToast(friendlyError(error, "パックを公開できませんでした。下書きは端末に残っています。"));
    }
  } finally {
    if (generationIsCurrent(generation)) {
      state.editorBusy = false;
      render();
    }
  }
}

function applyServerMarketState(payload = {}) {
  if (Number.isFinite(Number(payload.balance))) state.balance = Number(payload.balance);
  if (payload.policy && typeof payload.policy === "object") state.policy = payload.policy;
  if (Object.prototype.hasOwnProperty.call(payload, "packs") && Array.isArray(payload.packs)) {
    state.marketPacks = payload.packs
      .map((pack) => {
        try { return packFromServer(pack); } catch { return null; }
      })
      .filter(Boolean);
    state.marketLoaded = true;
    state.marketError = "";
  }
  const own = Array.isArray(payload.ownPacks) ? payload.ownPacks : [];
  state.ownPacks = own.map((pack) => {
    try { return packFromServer(pack); } catch { return null; }
  }).filter(Boolean);
  const seenPurchasedRevisions = new Set();
  state.purchasedRevisions = (Array.isArray(payload.purchasedRevisions)
    ? payload.purchasedRevisions
    : [])
    .map((use) => {
      try { return purchasedRevisionFromServer(use); } catch { return null; }
    })
    .filter((pack) => {
      if (!pack) return false;
      const key = `${packIdentity(pack)}:${packRevision(pack)}`;
      if (!packIdentity(pack) || packRevision(pack) < 1 || seenPurchasedRevisions.has(key)) return false;
      seenPurchasedRevisions.add(key);
      return true;
    });
  if (Object.prototype.hasOwnProperty.call(payload, "activeUse")) {
    const serverActiveUse = payload.activeUse && typeof payload.activeUse === "object" ? payload.activeUse : null;
    const serverActiveUseId = String(serverActiveUse?.id || serverActiveUse?.useId || "");
    state.activeUse = finishUseIsFenced(serverActiveUseId) ? null : serverActiveUse;
  }
}

function invalidateMarketInsights() {
  state.rankingLoaded = { monthly: false, lifetime: false };
  state.creatorStatsLoaded = false;
}

async function loadMarket({ force = false } = {}) {
  const generation = operationGeneration();
  if (state.marketLoading || (state.marketLoaded && !force)) return;
  state.marketLoading = true;
  state.marketError = "";
  render();
  try {
    const finishConfirmed = await flushFinishRetry();
    if (!generationIsCurrent(generation)) return;
    if (!finishConfirmed || terminalFinishUseId()) {
      state.marketLoaded = false;
      state.marketError = "前回の有料利用の終了を確認できていません。入口へ戻り、終了処理を再試行してください。";
      return;
    }
    const serverState = await callRouletteTrainingAction("state");
    if (!generationIsCurrent(generation)) return;
    applyServerMarketState(serverState);
    if (!Array.isArray(serverState.packs)) {
      const browse = await callRouletteTrainingAction("browse");
      if (!generationIsCurrent(generation)) return;
      state.marketPacks = (Array.isArray(browse.packs) ? browse.packs : [])
        .map((pack) => {
          try { return packFromServer(pack); } catch { return null; }
        })
        .filter(Boolean);
    }
    state.marketLoaded = true;
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    state.marketError = friendlyError(error, "販売中パックを読み込めませんでした。無料パックはそのまま遊べます。");
  } finally {
    if (generationIsCurrent(generation)) {
      state.marketLoading = false;
      if (["hub", "market"].includes(state.screen)) render();
    }
  }
}

async function loadPackRankings(periodValue = state.rankingPeriod, {
  force = false,
  focusSelector = "",
  announcement = "",
} = {}) {
  const period = RANKING_PERIODS.includes(periodValue) ? periodValue : "monthly";
  const generation = operationGeneration();
  const renderRankingView = (notify = false) => {
    if (state.screen !== "market" || state.marketView !== "ranking" || state.rankingPeriod !== period) return;
    render();
    restoreFocusAfterRender(focusSelector);
    if (notify && announcement) announce(announcement);
  };
  state.rankingPeriod = period;
  if (state.rankingLoading[period]) {
    renderRankingView();
    return;
  }
  if (state.rankingLoaded[period] && !force) {
    renderRankingView(true);
    return;
  }
  state.rankingLoading[period] = true;
  state.rankingErrors[period] = "";
  renderRankingView();
  try {
    const response = await callRouletteTrainingAction("pack_rankings", { period });
    if (!generationIsCurrent(generation)) return;
    state.rankings[period] = rankingPayloadFromServer(response, period);
    state.rankingLoaded[period] = true;
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    state.rankingErrors[period] = friendlyError(error, "人気パックランキングを読み込めませんでした。");
  } finally {
    if (generationIsCurrent(generation)) {
      state.rankingLoading[period] = false;
      renderRankingView(true);
    }
  }
}

function notifyCreatorAchievementUnlocks(idsValue) {
  const normalized = window.HariaiAchievements?.normalizeIds?.(idsValue)
    || (Array.isArray(idsValue) ? idsValue.map((id) => String(id || "")) : []);
  const ids = [...new Set(normalized)]
    .filter((id) => /^[a-z0-9_]{1,80}$/u.test(id))
    .filter((id) => !state.notifiedCreatorAchievementIds.has(id));
  if (!ids.length) return;
  ids.forEach((id) => state.notifiedCreatorAchievementIds.add(id));
  window.dispatchEvent(new CustomEvent(
    "hariai-achievements-unlocked",
    { detail: { ids } },
  ));
  economyActionCallable({
    action: "ack_achievements",
    achievementIds: ids,
  }).catch(() => {
    ids.forEach((id) => state.notifiedCreatorAchievementIds.delete(id));
  });
}

async function loadCreatorStats({ force = false } = {}) {
  const generation = operationGeneration();
  if (state.creatorStatsLoading || (state.creatorStatsLoaded && !force)) {
    if (state.screen === "creator_dashboard") render();
    return;
  }
  state.creatorStatsLoading = true;
  state.creatorStatsError = "";
  if (state.screen === "creator_dashboard") render();
  try {
    const response = await callRouletteTrainingAction("creator_stats");
    if (!generationIsCurrent(generation)) return;
    state.creatorStats = creatorStatsFromServer(response);
    state.creatorStatsLoaded = true;
    notifyCreatorAchievementUnlocks(state.creatorStats.achievements?.pendingUnlocks);
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    state.creatorStatsError = friendlyError(error, "作者の販売記録を読み込めませんでした。");
  } finally {
    if (generationIsCurrent(generation)) {
      state.creatorStatsLoading = false;
      if (state.screen === "creator_dashboard") render();
    }
  }
}

async function saveCreatorXProfile(form) {
  const generation = operationGeneration();
  let successAnnouncement = "";
  if (!form || state.profileBusy) return;
  const data = new FormData(form);
  const xPublic = data.get("xPublic") === "on";
  const xHandle = normalizedXHandle(data.get("xHandle"));
  if (xPublic && !xHandle) {
    showToast("Xユーザー名は英数字とアンダースコアの1〜15文字で入力してください。");
    form.querySelector('input[name="xHandle"]')?.focus();
    return;
  }
  state.profileBusy = true;
  render();
  try {
    const response = await callRouletteTrainingAction("save_profile", { xPublic, xHandle });
    if (!generationIsCurrent(generation)) return;
    const profile = publicXProfile(response.profile || { xPublic, xHandle });
    if (state.creatorStats) state.creatorStats.profile = profile;
    invalidateMarketInsights();
    showToast(profile.xPublic
      ? "ランキングのXリンクを公開しました。"
      : "Xリンクを非公開にしました。販売実績と順位は変わりません。");
    successAnnouncement = profile.xPublic
      ? `Xプロフィール @${profile.xHandle} をランキングへ公開しました。`
      : "ランキングのXプロフィールを非公開にしました。販売実績と順位は変わりません。";
  } catch (error) {
    if (generationIsCurrent(generation)) {
      showToast(friendlyError(error, "X公開設定を保存できませんでした。"));
    }
  } finally {
    if (generationIsCurrent(generation)) {
      state.profileBusy = false;
      if (state.screen === "creator_dashboard") {
        render();
        restoreFocusAfterRender('#rouletteTrainingXProfileForm button[type="submit"]');
        if (successAnnouncement) announce(successAnnouncement);
      }
    }
  }
}

async function selectRankedPack(packId) {
  const normalizedPackId = String(packId || "");
  if (!normalizedPackId) return;
  const rankedPack = state.rankings[state.rankingPeriod]?.rows
    ?.find((row) => row.packId === normalizedPackId)?.pack;
  if (rankedPack && packIdentity(rankedPack) === normalizedPackId) {
    state.marketPacks = [
      rankedPack,
      ...state.marketPacks.filter((candidate) => packIdentity(candidate) !== normalizedPackId),
    ];
    selectMarketPack(normalizedPackId);
    return;
  }
  let pack = state.marketPacks.find((candidate) => packIdentity(candidate) === normalizedPackId);
  if (!pack) {
    state.marketView = "packs";
    render();
    await loadMarket({ force: true });
    pack = state.marketPacks.find((candidate) => packIdentity(candidate) === normalizedPackId);
  }
  if (!pack) {
    showToast("このパックは現在の販売一覧にありません。受付停止または改訂された可能性があります。");
    announce("選んだパックは現在の販売一覧にありません。販売一覧を更新しました。");
    return;
  }
  selectMarketPack(normalizedPackId);
}

async function loadCreatorState() {
  const generation = operationGeneration();
  if (useOfflineMarketPreview) return;
  state.creatorLoading = true;
  if (["editor", "editor_review"].includes(state.screen)) render();
  try {
    const finishConfirmed = await flushFinishRetry();
    if (!generationIsCurrent(generation)) return;
    if (!finishConfirmed || terminalFinishUseId()) {
      state.creatorLoading = false;
      state.screen = "hub";
      render();
      showToast("前回の有料利用の終了を確認してから、メニュー作成・販売を利用できます。");
      return;
    }
    const serverState = await callRouletteTrainingAction("state");
    if (!generationIsCurrent(generation)) return;
    applyServerMarketState(serverState);
    if (state.activeUse && ["editor", "editor_review"].includes(state.screen)) {
      const activePack = packFromServer(state.activeUse.pack || state.activeUse.packSnapshot);
      state.selectedPack = activePack;
      state.selectedPackSource = "active_use";
      state.editorReviewPack = null;
      state.creatorLoading = false;
      navigate("setup");
      showToast("別画面で開始済みの利用が確認されたため、その利用の準備画面へ戻りました。");
      return;
    }
  } catch (error) {
    if (generationIsCurrent(generation)) showToast(friendlyError(error, "販売用の残高と公開状態を確認できませんでした。"));
  } finally {
    if (generationIsCurrent(generation)) {
      state.creatorLoading = false;
      if (["editor", "editor_review"].includes(state.screen)) render();
    }
  }
}

function selectMarketPack(packId) {
  if (state.recoveryAvailable) {
    showToast("前回データを復元するか、安全に破棄してから新しいパックを選んでください。");
    navigate("hub");
    return;
  }
  if (state.bootstrapLoading || state.marketLoading) {
    showToast("開始済みの利用と販売内容を確認しています。少し待ってから選んでください。");
    return;
  }
  if (state.activeUse) {
    showToast("開始済みの利用を再開するか、ギブアップして終了してください。");
    return;
  }
  const pack = [FREE_PACK, ...state.marketPacks, ...state.ownPacks]
    .find((candidate) => packIdentity(candidate) === packId);
  if (!pack) return;
  if (terminalFinishUseId() && !pack.builtin) {
    showToast("前回の有料利用の終了処理を完了してから、有料パックを選べます。");
    return;
  }
  state.selectedMarketPack = pack;
  navigate("pack_detail");
}

function selectPurchasedRevision(index) {
  const pack = state.purchasedRevisions[Number(index)];
  if (!pack?.reportOnly) return;
  state.selectedMarketPack = pack;
  navigate("pack_detail");
}

function editOwnPack(packId) {
  if (terminalFinishUseId()) {
    showToast("前回の有料利用の終了処理を完了してから、販売パックを編集できます。");
    return;
  }
  const pack = state.ownPacks.find((candidate) => packIdentity(candidate) === packId);
  if (!pack) return;
  state.editorDraft = {
    id: "local-draft",
    packId: packIdentity(pack),
    baseRevision: packRevision(pack),
    sellerName: pack.sellerName,
    title: pack.title,
    description: pack.description,
    price: pack.price,
    items: pack.items.map((item, index) => ({
      id: `draft-menu-${index + 1}`,
      menuText: item.menuText,
      detailText: item.detailText || "",
      countUnit: item.countUnit,
      cheerLines: [...item.cheerLines],
    })),
  };
  state.editorReviewPack = null;
  persistEditorDraft();
  removeStored(PUBLISH_ATTEMPT_STORAGE_KEY);
  navigate("editor");
}

async function unpublishOwnPack(packId) {
  const generation = operationGeneration();
  if (terminalFinishUseId()) {
    showToast("前回の有料利用の終了処理を完了してから、販売受付を変更できます。");
    return;
  }
  const pack = state.ownPacks.find((candidate) => packIdentity(candidate) === packId);
  if (!pack || pack.status !== "active") return;
  if (!window.confirm(`「${pack.title}」の販売受付を停止しますか？ 購入済みセッションの利用は妨げません。`)) return;
  try {
    await callRouletteTrainingAction("unpublish", { packId });
    if (!generationIsCurrent(generation)) return;
    invalidateMarketInsights();
    showToast("販売受付を停止しました。");
    await loadMarket({ force: true });
  } catch (error) {
    if (generationIsCurrent(generation)) showToast(friendlyError(error, "販売受付を停止できませんでした。"));
  }
}

async function activateSelectedPack() {
  const generation = operationGeneration();
  const pack = state.selectedMarketPack;
  if (!pack || state.purchaseBusy) return;
  if (state.recoveryAvailable) {
    showToast("前回データを復元するか、安全に破棄してから新しい利用を開始してください。");
    navigate("hub");
    return;
  }
  if (terminalFinishUseId() && !pack.builtin) {
    showToast("前回の有料利用の終了処理を完了してから、新しいトレーニングを開始できます。");
    return;
  }
  if (pack.reportOnly) {
    showToast("購入済みの旧改訂は通報確認専用です。再利用は販売中の最新版から開始してください。");
    return;
  }
  if (state.activeUse) {
    showToast("開始済みの利用を再開するか、ギブアップして終了してください。");
    return;
  }
  if (Number(pack.price || 0) > 0 && !pack.isOwn
      && document.querySelector("#rouletteTrainingPurchaseConsent")?.checked !== true) {
    showToast("1セッション利用と支払い内容を確認してチェックしてください。");
    return;
  }
  if (pack.builtin || Number(pack.price || 0) === 0) {
    state.selectedPack = pack;
    state.selectedPackSource = "builtin";
    state.activeUse = null;
    navigate("setup");
    return;
  }
  state.purchaseBusy = true;
  render();
  try {
    const attemptSignature = JSON.stringify({
      packId: packIdentity(pack),
      expectedRevision: packRevision(pack),
      expectedPrice: Number(pack.price),
    });
    const actionId = pendingActionId(USE_ATTEMPT_STORAGE_KEY, attemptSignature, "roulette_use");
    const response = await callRouletteTrainingAction("start_paid_use", {
      packId: packIdentity(pack),
      expectedRevision: packRevision(pack),
      expectedPrice: Number(pack.price),
      expectedBalance: Number(state.balance || 0),
      actionId,
    });
    if (!generationIsCurrent(generation)) return;
    if (response.terminalAction === true) {
      removeStored(USE_ATTEMPT_STORAGE_KEY);
      state.screen = "market";
      state.marketLoaded = false;
      await loadMarket({ force: true });
      showToast("前回の利用はすでに終了しています。最新の内容を確認し、新しく開始してください。");
      return;
    }
    const use = response.use || response.activeUse;
    if (!use || !(use.id || use.useId)) throw new Error("利用開始を確認できませんでした。もう一度お試しください。");
    const usePack = use?.pack ? packFromServer(use.pack) : pack;
    state.activeUse = use;
    state.selectedPack = usePack;
    state.selectedPackSource = "active_use";
    const balanceAfterStart = Number(response.balance ?? use?.buyerBalanceAfter);
    if (Number.isFinite(balanceAfterStart)) state.balance = balanceAfterStart;
    invalidateMarketInsights();
    removeStored(USE_ATTEMPT_STORAGE_KEY);
    showToast(response.charged === false ? "追加課金なしでセッションを再開します。" : `${pack.price} Payでセッションを開始しました。`);
    navigate("setup");
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    if (requiresFreshReview(error)) {
      state.screen = "market";
      state.selectedMarketPack = null;
      state.marketLoaded = false;
      render();
      await loadMarket({ force: true });
      if (generationIsCurrent(generation)) {
        showToast("残高・価格・改訂が更新されました。最新の全文と支払後残高を確認し直してください。");
      }
    } else {
      showToast(friendlyError(error, "有料パックを開始できませんでした。支払い状況を確認してください。"));
    }
  } finally {
    if (generationIsCurrent(generation)) {
      state.purchaseBusy = false;
      render();
    }
  }
}

async function resumePaidUse() {
  const generation = operationGeneration();
  const useId = String(state.activeUse?.id || state.activeUse?.useId || "");
  if (!useId) return;
  if (finishUseIsFenced(useId)) {
    state.activeUse = null;
    navigate("hub");
    showToast("この利用は終了処理中です。再開せず、終了確認を再試行してください。");
    return;
  }
  const recoveryCleared = await discardConflictingRecoveryForActiveUse(useId);
  if (!generationIsCurrent(generation) || !recoveryCleared) return;
  try {
    const response = await callRouletteTrainingAction("resume_use", { useId });
    if (!generationIsCurrent(generation)) return;
    const use = response.use || state.activeUse;
    const pack = packFromServer(use.pack || use.packSnapshot || state.activeUse.pack);
    state.activeUse = use;
    state.selectedPack = pack;
    state.selectedPackSource = "active_use";
    navigate("setup");
  } catch (error) {
    if (!generationIsCurrent(generation)) return;
    showToast(friendlyError(error, "開始済みパックを再開できませんでした。"));
    state.marketLoaded = false;
    await loadMarket({ force: true });
  }
}

async function submitReport(form) {
  const generation = operationGeneration();
  const pack = state.selectedMarketPack;
  if (!pack || pack.builtin || state.reportBusy) return;
  if (!hasPurchasedRevision(pack)) {
    showToast("実際に有料利用した改訂だけを通報できます。");
    return;
  }
  state.reportBusy = true;
  state.reportReason = String(new FormData(form).get("reason") || "other");
  render();
  try {
    await callRouletteTrainingAction("report", {
      packId: packIdentity(pack),
      expectedRevision: packRevision(pack),
      reason: state.reportReason,
    });
    if (!generationIsCurrent(generation)) return;
    invalidateMarketInsights();
    showToast("通報を受け付けました。");
  } catch (error) {
    if (generationIsCurrent(generation)) showToast(friendlyError(error, "通報を送信できませんでした。"));
  } finally {
    if (generationIsCurrent(generation)) {
      state.reportBusy = false;
      render();
    }
  }
}

async function retryPendingFinishFromUi() {
  const generation = operationGeneration();
  if (state.finishRetryBusy || !terminalFinishUseId()) return;
  state.finishRetryBusy = true;
  render();
  const finishConfirmed = await flushFinishRetry();
  if (!generationIsCurrent(generation)) return;
  state.finishRetryBusy = false;
  if (!finishConfirmed || terminalFinishUseId()) {
    render();
    showToast("終了を確認できませんでした。通信状態を確認して、もう一度お試しください。");
    return;
  }

  state.bootstrapLoading = true;
  state.marketLoaded = false;
  render();
  try {
    const serverState = await callRouletteTrainingAction("state");
    if (!generationIsCurrent(generation)) return;
    applyServerMarketState(serverState);
    showToast("前回の有料利用の終了を確認しました。");
  } catch (error) {
    if (generationIsCurrent(generation)) {
      showToast(friendlyError(error, "終了は確認できましたが、最新の利用状態を読み込めませんでした。"));
    }
  } finally {
    if (generationIsCurrent(generation)) {
      state.bootstrapLoading = false;
      render();
    }
  }
}

async function discardStoredRecovery({ allowPaid = false, confirmation = "" } = {}) {
  const generation = operationGeneration();
  const saved = readJson(SESSION_STORAGE_KEY, null);
  if (!saved) {
    state.recoveryAvailable = false;
    render();
    return true;
  }
  if (saved.paidUseId && !allowPaid) {
    showToast("有料利用の復旧データはここでは破棄できません。前回の画面へ戻り、ギブアップから終了してください。");
    return false;
  }
  if (confirmation && !window.confirm(confirmation)) return false;
  state.recoveryDiscardBusy = true;
  render();
  let imagesCleared = false;
  try {
    imagesCleared = await clearSessionImageBlobs({ force: true });
  } catch {
    imagesCleared = false;
  }
  if (!generationIsCurrent(generation)) return false;
  state.recoveryDiscardBusy = false;
  if (!imagesCleared) {
    render();
    showToast("端末保存画像を削除できなかったため、前回データは保持しました。ブラウザのサイトデータを確認してから再試行してください。");
    return false;
  }
  if (!removeStored(SESSION_STORAGE_KEY) || readJson(SESSION_STORAGE_KEY, null)) {
    render();
    showToast("端末内の前回データを削除できなかったため、新しい開始を中止しました。ブラウザのサイトデータを確認してください。");
    return false;
  }
  releaseImages();
  state.session = null;
  state.result = null;
  state.recoveryAvailable = false;
  state.recoveryError = "";
  render();
  return true;
}

async function discardFreeRecoveryFromUi() {
  return discardStoredRecovery({
    allowPaid: false,
    confirmation: "前回の無料トレーニングの進行状態と端末保存画像を破棄し、新しく始めますか？",
  });
}

async function discardConflictingRecoveryForActiveUse(activeUseId) {
  const saved = readJson(SESSION_STORAGE_KEY, null);
  if (!saved) return true;
  if (String(saved.paidUseId || "") === String(activeUseId || "")) {
    showToast("この利用の端末内進行状態があります。入口の「進行中の有料トレーニングへ戻る」から復元してください。");
    return false;
  }
  return discardStoredRecovery({
    allowPaid: true,
    confirmation: "端末には別のトレーニングの復旧データがあります。進行状態と保存画像を破棄して、開始済みの有料利用を続けますか？",
  });
}

async function endTraining() {
  if (state.ending) return;
  renderGeneration += 1;
  const generation = operationGeneration();
  state.ending = true;
  render();
  const paidUseId = String(state.session?.paidUseId || "");
  const finishPromise = paidUseId
    ? finishPaidUseBestEffort(paidUseId, state.session?.ownerUid)
    : Promise.resolve(true);
  clearRuntimeTimers();
  const sessionCleared = removeStored(SESSION_STORAGE_KEY) && !readJson(SESSION_STORAGE_KEY, null);
  state.recoveryAvailable = false;
  releaseImages();
  let imagesCleared = false;
  try {
    imagesCleared = await clearSessionImageBlobs({ force: true });
  } catch {
    imagesCleared = false;
  }
  if (!generationIsCurrent(generation)) return;
  state.session = null;
  state.result = null;
  state.activeUse = null;
  state.marketLoaded = false;
  state.ending = false;
  navigate("hub");
  finishPromise.then((finishConfirmed) => {
    if (!active || !generationIsCurrent(generation) || state.screen !== "hub") return;
    render();
    if (!finishConfirmed) showToast("有料利用の終了確認が保留中です。「終了処理を再試行」から確認してください。");
  });
  if (!imagesCleared) {
    showToast("端末保存画像を削除できませんでした。ブラウザのサイトデータを削除してから再度ご利用ください。");
  }
  if (!sessionCleared) {
    showToast("端末内のセッション結果を削除できませんでした。ブラウザのサイトデータを削除してください。");
  }
}

function chooseFreePack() {
  if (state.recoveryAvailable) {
    showToast("前回データを復元するか、「前回データを破棄して新しく始める」を選んでください。");
    return;
  }
  const activeUseId = String(state.activeUse?.id || state.activeUse?.useId || "");
  if (state.activeUse && finishUseIsFenced(activeUseId)) state.activeUse = null;
  if (state.activeUse) {
    showToast("開始済みの利用を再開するか、ギブアップして終了してください。");
    return;
  }
  state.selectedPack = FREE_PACK;
  state.selectedPackSource = "builtin";
  state.activeUse = null;
  navigate("setup");
}

function updateXProfileFormValidity(form) {
  if (!form) return;
  const input = form.querySelector('input[name="xHandle"]');
  const consent = form.querySelector('input[name="xPublic"]');
  const submit = form.querySelector('button[type="submit"]');
  if (!input || !consent || !submit) return;
  const valid = !consent.checked || Boolean(normalizedXHandle(input.value));
  input.required = consent.checked;
  input.setCustomValidity(valid ? "" : "英数字とアンダースコアの1〜15文字で入力してください。先頭の@は省略できます。");
  input.setAttribute("aria-invalid", String(!valid));
  submit.disabled = state.profileBusy || !valid;
}

function bindEvents() {
  const actions = {
    home: requestHome,
    hub: () => navigate("hub"),
    "choose-free": chooseFreePack,
    "open-editor": () => {
      navigate("editor");
      loadCreatorState();
    },
    "open-market": () => {
      navigate("market");
      loadMarket();
    },
    "show-market-packs": () => {
      state.marketView = "packs";
      render();
      restoreFocusAfterRender('[data-roulette-action="show-market-packs"]');
      announce("販売パック一覧を表示しました。");
    },
    "show-market-ranking": () => {
      state.marketView = "ranking";
      return loadPackRankings(state.rankingPeriod, {
        focusSelector: '[data-roulette-action="show-market-ranking"]',
        announcement: "人気パックランキングを表示しました。",
      });
    },
    "open-creator-dashboard": () => {
      navigate("creator_dashboard");
      return loadCreatorStats();
    },
    "reload-market": () => loadMarket({ force: true }),
    "reload-rankings": () => loadPackRankings(state.rankingPeriod, {
      force: true,
      focusSelector: '[data-roulette-action="reload-rankings"]',
    }),
    "reload-creator-stats": () => loadCreatorStats({ force: true }),
    "back-market": () => navigate("market"),
    "back-editor": () => navigate("editor"),
    "add-menu": addEditorMenu,
    "test-draft": testEditorDraft,
    publish: publishEditorPack,
    "activate-pack": activateSelectedPack,
    "resume-paid": resumePaidUse,
    "retry-finish": retryPendingFinishFromUi,
    "discard-recovery": discardFreeRecoveryFromUi,
    "resume-local": async () => {
      const generation = operationGeneration();
      const saved = readJson(SESSION_STORAGE_KEY, null);
      if (saved?.paidUseId && finishUseIsFenced(saved.paidUseId)) {
        state.screen = "hub";
        render();
        showToast("この有料利用は終了処理中のため再開できません。終了確認を再試行してください。");
        return;
      }
      if (!await validateStoredRecoveryOwner(saved) || !generationIsCurrent(generation)) {
        showToast("復元できるセッションがありませんでした。");
        render();
        return;
      }
      let verifiedSaved = saved;
      if (saved.paidUseId) {
        try {
          const response = await callRouletteTrainingAction("resume_use", { useId: saved.paidUseId });
          if (!generationIsCurrent(generation)) return;
          const use = response.use;
          if (!use || String(use.id || use.useId || "") !== String(saved.paidUseId)) {
            throw new Error("利用記録の所有者を確認できませんでした。");
          }
          const verifiedPack = packFromServer(use.pack || use.packSnapshot);
          state.activeUse = use;
          state.selectedPack = verifiedPack;
          state.selectedPackSource = "active_use";
          state.recoveryError = "";
          verifiedSaved = { ...saved, pack: verifiedPack, ownerUid: state.uid };
        } catch (error) {
          if (!generationIsCurrent(generation)) return;
          state.session = null;
          state.screen = "hub";
          if (paidRecoveryIsDefinitivelyUnavailable(error)) {
            await purgeStoredRecovery("有料利用が終了済み、または現在の利用として確認できないため、端末内の復旧データと画像を破棄しました。");
            if (!generationIsCurrent(generation)) return;
            state.activeUse = null;
          } else {
            state.recoveryAvailable = true;
            state.recoveryError = "通信のため前回の有料トレーニングを復旧できませんでした。端末内の進行状態と画像は保持しています。通信状態を確認して、もう一度「前回の画面に戻る」を押してください。";
          }
          render();
          return;
        }
      }
      state.recoveryError = "";
      if (verifiedSaved?.config) state.config = normalizeConfig(verifiedSaved.config);
      await restoreSessionImages(verifiedSaved);
      if (!generationIsCurrent(generation)) return;
      if (!readJson(SESSION_STORAGE_KEY, null)) {
        state.screen = "hub";
        render();
        return;
      }
      if (!recoverLocalSession(verifiedSaved)) {
        showToast("復元できるセッションがありませんでした。");
      } else if (state.screen !== "result" && state.images.length < 1) {
        state.selectedPack = state.session?.pack || FREE_PACK;
        state.activeUse = state.session?.paidUseId ? { id: state.session.paidUseId, pack: state.selectedPack } : null;
        state.session = null;
        removeStored(SESSION_STORAGE_KEY);
        state.recoveryAvailable = false;
        state.screen = "setup";
        showToast("画像は保存されていなかったため、同じパックで画像を選び直してください。追加課金はありません。");
      }
      render();
    },
    "spin-main": spinMainRoulette,
    "skip-rare-presentation": skipRarePresentation,
    "open-count": openCountRoulette,
    "spin-count": spinCountRoulette,
    "start-challenge": startCountdown,
    "resume-challenge": () => beginChallenge({ resume: true }),
    clear: clearChallenge,
    "give-up": () => finishSession("give_up"),
    "give-up-before-start": giveUpBeforeStart,
    "finish-rest": finishRest,
    "end-training": endTraining,
  };
  document.querySelectorAll("[data-roulette-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const handler = actions[button.dataset.rouletteAction];
      if (!handler) return;
      Promise.resolve(handler()).catch((error) => showToast(friendlyError(error)));
    });
  });
  document.querySelector("#rouletteTrainingImages")?.addEventListener("change", (event) => {
    const files = event.currentTarget.files;
    const setupForm = document.querySelector("#rouletteTrainingSetupForm");
    if (setupForm) updateSetupConfig(setupForm, { preserveImageConsent: true });
    const consent = setupForm?.querySelector('input[name="keepImages"]')?.checked === true;
    Promise.resolve(setImagePersistenceConsent(consent))
      .then(() => handleImageSelection(files))
      .catch((error) => showToast(friendlyError(error, "画像の保存設定を反映できませんでした。")));
  });
  document.querySelector('#rouletteTrainingSetupForm input[name="keepImages"]')?.addEventListener("change", (event) => {
    const setupForm = document.querySelector("#rouletteTrainingSetupForm");
    if (setupForm) updateSetupConfig(setupForm, { preserveImageConsent: true });
    setImagePersistenceConsent(event.currentTarget.checked).catch((error) => {
      showToast(friendlyError(error, "画像の保存設定を反映できませんでした。"));
      render();
    });
  });
  document.querySelectorAll("[data-roulette-remove-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const setupForm = document.querySelector("#rouletteTrainingSetupForm");
      if (setupForm) updateSetupConfig(setupForm, { preserveImageConsent: true });
      removeImage(Number(button.dataset.rouletteRemoveImage));
    });
  });
  document.querySelector("#rouletteTrainingSetupForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    beginSession(event.currentTarget);
  });
  document.querySelectorAll('#rouletteTrainingSetupForm input[type="range"]').forEach((input) => {
    input.addEventListener("input", () => {
      const form = document.querySelector("#rouletteTrainingSetupForm");
      const maximum = form?.querySelector('input[name="maximumBpm"]');
      const base = form?.querySelector('input[name="baseBpm"]');
      if (input.name === "maximumBpm") {
        if (base) base.max = input.value;
        if (base && Number(base.value) > Number(input.value)) {
          base.value = input.value;
          const baseOutput = document.querySelector('[data-roulette-output="baseBpm"]');
          if (baseOutput) baseOutput.textContent = base.value;
        }
      } else if (input.name === "baseBpm" && maximum && Number(input.value) > Number(maximum.value)) {
        input.value = maximum.value;
      }
      const output = document.querySelector(`[data-roulette-output="${input.name}"]`);
      if (output) output.textContent = input.value;
      if (form) updateSetupConfig(form);
    });
  });
  document.querySelectorAll("#rouletteTrainingSetupForm select").forEach((select) => {
    select.addEventListener("change", () => {
      const form = document.querySelector("#rouletteTrainingSetupForm");
      if (form) updateSetupConfig(form);
    });
  });
  document.querySelector("#rouletteTrainingEditorForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      state.editorReviewPack = editorDraftPack(event.currentTarget);
      state.balance = null;
      navigate("editor_review");
      loadCreatorState();
    } catch (error) {
      showToast(friendlyError(error, "入力内容を確認してください。"));
    }
  });
  document.querySelectorAll("[data-roulette-remove-menu]").forEach((button) => {
    button.addEventListener("click", () => removeEditorMenu(Number(button.dataset.rouletteRemoveMenu)));
  });
  document.querySelectorAll("[data-roulette-pack-id]").forEach((button) => {
    button.addEventListener("click", () => selectMarketPack(button.dataset.roulettePackId));
  });
  document.querySelectorAll("[data-roulette-ranked-pack]").forEach((button) => {
    button.addEventListener("click", () => {
      Promise.resolve(selectRankedPack(button.dataset.rouletteRankedPack))
        .catch((error) => showToast(friendlyError(error, "パックの内容を開けませんでした。")));
    });
  });
  document.querySelectorAll("[data-roulette-ranking-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const period = RANKING_PERIODS.includes(button.dataset.rouletteRankingPeriod)
        ? button.dataset.rouletteRankingPeriod
        : "monthly";
      Promise.resolve(loadPackRankings(period, {
        focusSelector: `[data-roulette-ranking-period="${period}"]`,
        announcement: `${period === "monthly" ? "月間" : "累計"}ランキングを表示しました。`,
      }))
        .catch((error) => showToast(friendlyError(error, "ランキング期間を切り替えられませんでした。")));
    });
  });
  document.querySelectorAll("[data-roulette-purchased-index]").forEach((button) => {
    button.addEventListener("click", () => selectPurchasedRevision(button.dataset.roulettePurchasedIndex));
  });
  document.querySelectorAll("[data-roulette-edit-pack]").forEach((button) => {
    button.addEventListener("click", () => editOwnPack(button.dataset.rouletteEditPack));
  });
  document.querySelectorAll("[data-roulette-unpublish-pack]").forEach((button) => {
    button.addEventListener("click", () => unpublishOwnPack(button.dataset.rouletteUnpublishPack));
  });
  document.querySelector("#rouletteTrainingReportForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitReport(event.currentTarget);
  });
  document.querySelector("#rouletteTrainingPurchaseConsent")?.addEventListener("change", (event) => {
    const button = document.querySelector("#rouletteTrainingActivatePack");
    const price = Number(state.selectedMarketPack?.price || 0);
    const balanceAllows = Number.isFinite(state.balance) && state.balance >= price;
    if (button) button.disabled = !event.currentTarget.checked || !balanceAllows || state.purchaseBusy;
  });
  const xProfileForm = document.querySelector("#rouletteTrainingXProfileForm");
  xProfileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCreatorXProfile(event.currentTarget);
  });
  xProfileForm?.querySelectorAll('input[name="xHandle"], input[name="xPublic"]').forEach((input) => {
    input.addEventListener("input", () => updateXProfileFormValidity(xProfileForm));
    input.addEventListener("change", () => updateXProfileFormValidity(xProfileForm));
  });
  updateXProfileFormValidity(xProfileForm);
  document.querySelectorAll("button[data-roulette-x-profile]").forEach((button) => {
    button.addEventListener("click", () => openConfirmedXProfile(button.dataset.rouletteXProfile));
  });
}

async function start({ initialScreen = "hub" } = {}) {
  if (active) {
    navigate(state.recoveryAvailable ? "hub" : initialScreen === "market" ? "market" : "hub");
    return;
  }
  const preview = previewRequest();
  if (!preview && location.protocol === "file:") {
    showToast("ルーレットトレーニングはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (!preview && modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してからルーレットトレーニングを開いてください。");
    return;
  }
  active = true;
  renderGeneration += 1;
  const generation = operationGeneration();
  state = createState();
  state.bootstrapLoading = !preview;
  setModeChrome();
  const requested = preview || initialScreen;
  state.screen = ["setup", "editor", "market"].includes(requested) ? requested : "hub";
  if (!preview && typeof auth.authStateReady === "function") {
    try {
      await auth.authStateReady();
    } catch {
      // Free/offline play can continue with a device-local owner.
    }
    if (!generationIsCurrent(generation)) return;
    if (auth.currentUser) {
      state.uid = auth.currentUser.uid;
      state.authReady = true;
    }
  }
  if (!preview) state.editorDraft = restoreDraft();
  const saved = !preview ? readJson(SESSION_STORAGE_KEY, null) : null;
  if (saved) {
    const ownerMatches = await validateStoredRecoveryOwner(saved);
    if (!generationIsCurrent(generation)) return;
    if (ownerMatches) {
      state.recoveryAvailable = true;
      state.config = normalizeConfig(saved.config || state.config);
      state.screen = "hub";
      if (state.screen === "hub" && saved.result) recoverLocalSession(saved);
    }
  }
  seedMarketInsightsPreview(preview);
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
  if (["play", "fever", "all-out"].includes(preview)) {
    state.selectedPack = FREE_PACK;
    if (!state.images.length) {
      state.images = [{
        id: "preview",
        blob: null,
        url: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%232a3150'/%3E%3Cstop offset='1' stop-color='%235b345d'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='1000' fill='url(%23g)'/%3E%3Ccircle cx='400' cy='390' r='170' fill='%23ffd384' opacity='.85'/%3E%3Cpath d='M170 880c40-220 160-320 230-320s190 100 230 320' fill='%2372e7d5' opacity='.75'/%3E%3C/svg%3E",
        position: 0,
      }];
    }
    state.config = { ...DEFAULT_CONFIG };
    state.session = null;
    beginSession(null);
    if (["fever", "all-out"].includes(preview) && state.session) {
      const effectId = preview === "fever" ? "fever" : "all_out_time";
      const effect = EFFECTS.find((item) => item.id === effectId);
      if (effect) {
        state.session.forceMenu = true;
        state.session.pendingMain = { type: "effect", item: effect };
        state.session.phase = "main_spinning";
        settleMainSpin();
      }
    }
  } else if (["result", "result-completed", "result-empty"].includes(preview)) {
    const now = Date.now();
    const completed = preview === "result-completed";
    const empty = preview === "result-empty";
    state.result = {
      ...resultSummary({
        completedCount: completed ? 5 : empty ? 0 : 3,
        startedAt: now - (empty ? 0 : 272_000),
        finishedAt: now,
        startBpm: 60,
        finalBpm: completed ? 75 : empty ? 60 : 70,
        maximumReachedBpm: completed ? 85 : empty ? 60 : 80,
        finishReason: completed ? "completed" : "give_up",
        lastChallenge: empty ? null : { menuText: "イスからゆっくり立つ・座る", count: 20, countUnit: "reps", bpm: completed ? 75 : 70 },
      }),
      targetCount: 5,
    };
    if (completed) {
      state.images = [{
        id: "result-preview",
        blob: null,
        url: "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'%3E%3Crect width='800' height='1000' fill='%23c9b8e8'/%3E%3Ccircle cx='400' cy='390' r='170' fill='%23ffd977'/%3E%3Cpath d='M170 880c40-220 160-320 230-320s190 100 230 320' fill='%2377ddd0'/%3E%3C/svg%3E",
        position: 0,
      }];
    }
    state.screen = "result";
    render();
  }
  const finishConfirmed = await flushFinishRetry();
  if (!generationIsCurrent(generation)) return;
  if (!preview && (!finishConfirmed || terminalFinishUseId())) {
    state.bootstrapLoading = false;
    if (state.screen !== "result") state.screen = "hub";
    render();
    return;
  }
  if (!preview) {
    try {
      const serverState = await callRouletteTrainingAction("state");
      if (!generationIsCurrent(generation)) return;
      applyServerMarketState(serverState);
    } catch (error) {
      if (!generationIsCurrent(generation)) return;
      showToast(friendlyError(error, "開始済みの利用を確認できませんでした。無料お試しは端末内で利用できます。"));
    } finally {
      if (generationIsCurrent(generation)) {
        state.bootstrapLoading = false;
        if (state.screen === "hub") render();
      }
    }
  }
  if (!generationIsCurrent(generation)) return;
  if (!preview && state.screen === "market") loadMarket();
}

function isActive() {
  return active;
}

async function requestHome() {
  if (!active) {
    window.HariaiApp?.returnHome?.();
    return;
  }
  if (state.screen === "result") {
    showToast("結果画面の「記録を閉じてお部屋に戻る」で終了してください。");
    return;
  }
  if (state.screen === "setup" && state.activeUse && !state.session) {
    if (!window.confirm("開始済みの利用をギブアップし、0クリアの結果画面へ進みますか？ 返金はありません。")) return;
    giveUpBeforeStart();
    return;
  }
  if (state.screen === "play" && state.session && !state.session.result) {
    if (!window.confirm("現在のトレーニングをギブアップし、結果画面へ進みますか？")) return;
    finishSession("give_up");
    return;
  }
  const storedRecovery = readJson(SESSION_STORAGE_KEY, null);
  if (!state.session && storedRecovery) {
    active = false;
    renderGeneration += 1;
    clearRuntimeTimers();
    releaseImages();
    state = createState();
    window.HariaiApp?.returnHome?.();
    return;
  }
  active = false;
  renderGeneration += 1;
  const exitGeneration = operationGeneration();
  clearRuntimeTimers();
  releaseImages();
  const sessionCleared = removeStored(SESSION_STORAGE_KEY) && !readJson(SESSION_STORAGE_KEY, null);
  let imagesCleared = false;
  try {
    imagesCleared = await clearSessionImageBlobs({ force: true });
  } catch {
    imagesCleared = false;
  }
  if (renderGeneration !== exitGeneration || active) return;
  state = createState();
  window.HariaiApp?.returnHome?.();
  if (!imagesCleared) {
    showToast("端末保存画像を削除できませんでした。ブラウザのサイトデータを削除してください。");
  }
  if (!sessionCleared) {
    showToast("端末内のセッションを削除できませんでした。ブラウザのサイトデータを削除してください。");
  }
}

window.addEventListener("visibilitychange", () => {
  const hidden = document.visibilityState === "hidden";
  document.querySelector(".roulette-training-play, .roulette-training-result")
    ?.classList.toggle("is-roulette-document-hidden", hidden);
  if (!active || !hidden) return;
  if (state.session?.phase === "active") {
    pauseChallengeForVisibility();
    render();
  } else if (state.session?.phase === "countdown") {
    clearRuntimeTimers();
    state.session.phase = "count_result";
    persistSession();
    render();
  }
});

window.addEventListener("pagehide", (event) => {
  if (!active) return;
  if (state.session?.phase === "active") pauseChallengeForVisibility();
  clearRuntimeTimers();
  if (event.persisted && state.session?.phase === "main_spinning") {
    if (state.session.pendingMain) settleMainSpin();
    else {
      state.session.phase = "main_ready";
      persistSession();
    }
  } else if (event.persisted && state.session?.phase === "count_spinning") {
    if (state.session.pendingCount) settleCountSpin();
    else {
      state.session.phase = "count_ready";
      persistSession();
    }
  } else if (event.persisted && state.session?.phase === "countdown") {
    state.session.phase = "count_result";
    persistSession();
  }
  if (!event.persisted) releaseImages();
});

window.addEventListener("pageshow", (event) => {
  if (!active || !event.persisted) return;
  render();
  if (state.session?.phase === "rest") {
    updateRest();
    if (state.session?.phase === "rest") workoutTicker = window.setInterval(updateRest, 250);
  }
  announce("画面へ戻りました。メトロノームとタイマーは停止中です。必要なら自分で再開してください。");
});

onAuthStateChanged(auth, (user) => {
  if (!active) return;
  const nextUid = String(user?.uid || "");
  const contextUid = String(state.uid || "");
  if (!contextUid) {
    if (nextUid && hasUnboundLocalOwnerData()) {
      handleActiveAuthUidChange(nextUid, "local-owner").catch(() => {});
      return;
    }
    state.uid = nextUid;
    state.authReady = Boolean(nextUid);
    return;
  }
  if (contextUid === nextUid) return;
  handleActiveAuthUidChange(nextUid, contextUid).catch(() => {});
});

window.HariaiRouletteTraining = Object.freeze({
  start,
  isActive,
  requestHome,
  openMarket: () => start({ initialScreen: "market" }),
  callAction: callRouletteTrainingAction,
});
window.dispatchEvent(new Event("hariai-roulette-training-ready"));
