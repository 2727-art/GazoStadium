import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  get,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  database,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";
import {
  ANJU_PAY_UNIT,
  formatAnjuPay,
  formatAnjuPayNumber,
} from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import {
  summarizeMarketPresence,
} from "./market-presence.mjs?v=market-presence-v1";
import {
  CHAT_BACKGROUND_PRODUCTS,
  CHAT_COSMETIC_PRODUCTS,
  CHAT_SPECIAL_FRAME_PRODUCTS,
  CHAT_STANDARD_FRAME_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  PLAYER_TITLE_CATEGORIES,
  PLAYER_TITLE_PRODUCTS,
  getPlayerTitleCategory,
  getPlayerTitlePresentation,
  getPlayerTitleProduct,
} from "./player-titles.js?v=player-titles-v2";
import {
  MAX_EQUIPPED_STAMPS,
  STAMP_PRODUCTS,
  acquireStampCooldown,
  bindChatToolTabs,
  canUseStamp,
  getAvailableStamps,
  getStamp,
  normalizeEquippedStamps,
  renderChatTools,
  renderStampBubble,
  startStampButtonCooldown,
} from "./stamps.js?v=stamps-v1";
import {
  bindPostMatchTip,
  isPostMatchTipBusy,
  renderPostMatchTip,
} from "./post-match-tip.js?v=post-match-tip-v4";

const MAX_HP = 30;
const MAX_ROUNDS = 5;
const SAMPLE_HP_PENALTY = 5;
const MIN_STARTING_HP = 5;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const PURSUIT_LINE_KEY = "hariai-stadium-online-pursuit-line-v1";
const FINISH_LINE_KEY = "hariai-stadium-online-finish-line-v1";
const OPPONENT_CUSTOM_FINISH_KEY = "hariai-stadium-online-opponent-custom-finish-v1";
const IMAGE_PREFERENCE_KEY = "hariai-stadium-online-image-preference-v1";
const MAX_PURSUIT_LINE_LENGTH = 40;
const MAX_FINISH_LINE_LENGTH = 30;
const CUSTOM_PURSUIT_VALUE = "__custom__";
const CUSTOM_FINISH_VALUE = "__custom_finish__";
const FINISH_LINE_DISABLED_VALUE = "__finish_line_disabled__";
const FINISH_CUT_IN_DURATION_MS = 1800;
const PURSUIT_LINES = [
  "その反応、見逃さない。もう一枚いく！",
  "好みは読めた。ここからが本命だ！",
  "刺さったね？ 追撃開始！",
  "まだ終わらない。次の一枚をどうぞ！",
];
const FINISH_LINES = [
  "これで決着だ！",
  "この一枚で、勝負を決める。",
  "最後の一撃、受け取って！",
  "推しの力、見届けたか！",
  "いい勝負だった。またやろう。",
];
const IMAGE_PREFERENCE_OPTIONS = Object.freeze([
  Object.freeze({
    id: "illustration",
    label: "アニメ・イラストが刺さりやすい",
    shortLabel: "アニメ・イラスト",
    description: "漫画・イラスト・2Dゲーム絵などを高く評価しやすい",
  }),
  Object.freeze({
    id: "live_action",
    label: "実写が刺さりやすい",
    shortLabel: "実写",
    description: "人物・風景・動物・物撮りなどを高く評価しやすい",
  }),
  Object.freeze({
    id: "both",
    label: "どちらも歓迎",
    shortLabel: "どちらも歓迎",
    description: "画像表現を絞らず、両方の相手とすぐにマッチング",
  }),
]);
const RANKING_PUBLIC_KEY = "hariai-stadium-ranking-public-v1";
const X_HANDLE_KEY = "hariai-stadium-x-handle-v1";
const X_PUBLIC_KEY = "hariai-stadium-x-public-v1";
const RANKING_COMMENTS_ENABLED_KEY = "hariai-stadium-ranking-comments-enabled-v1";
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const RANKING_COMMENT_MAX_LENGTH = 80;
const RANKING_COMMENT_URL_PATTERN = /(?:https?:\/\/|www\.)/i;
const TOP_MESSAGE_PRODUCT_ID = "feature_top_message";
const TOP_MESSAGE_MAX_LENGTH = 30;
const TOP_MESSAGE_FETCH_LIMIT = 10;
const TOP_MESSAGE_DISPLAY_LIMIT = 5;
const TOP_MESSAGE_MUTED_KEY = "hariai-stadium-muted-top-messages-v1";
const OSHI_MARKET_COLLECTION_ID = "oshi_market";
const OSHI_MARKET_COLLECTION_GROUPS = Object.freeze([
  Object.freeze({
    id: "titles",
    eyebrow: "SELLER TITLE",
    title: "店主らしさを伝える称号",
    description: "装備した称号は、プロフィールに加えて推し値市場の店主カードにも表示されます。",
    productIds: Object.freeze([
      "title_oshi_deliverer",
      "title_oshi_storyteller",
      "title_tokimeki_scout",
      "title_one_picture_guide",
      "title_favorite_matchmaker",
      "title_tokimeki_curator",
      "title_oshi_concierge",
    ]),
  }),
  Object.freeze({
    id: "stamps",
    eyebrow: "TOKIMEKI STAMP",
    title: "好きを伝えるスタンプ",
    description: "推し値商店の「商店チャーム」に1個を飾れます。購入品を装備すると、オンライン対戦チャットでも使えます。",
    productIds: Object.freeze([
      "stamp_god_photo",
      "stamp_genius",
      "stamp_best_shot",
      "stamp_more",
      "stamp_hit",
    ]),
  }),
  Object.freeze({
    id: "chat-cosmetics",
    eyebrow: "CUTE CHAT COSMETICS",
    title: "かわいい背景・フレーム",
    description: "オンライン対戦チャットの吹き出しを、背景1個とフレーム1個の組み合わせで飾れます。",
    productIds: Object.freeze([
      "chat_bg_sakura_milk",
      "chat_bg_peach_fizz",
      "chat_bg_lavender_mist",
      "chat_frame_heart_ribbon",
      "chat_frame_lace",
      "chat_frame_cat_paw",
      "chat_frame_flower",
      "chat_frame_jewel",
      "chat_frame_stardust",
    ]),
  }),
]);
const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"];
const LEADERBOARD_MODES = ["solo", "strategy", "team", "royale"];
const DEFAULT_LEADERBOARD_PERIOD = "weekly";
const PERIOD_REWARD_CONFIG = Object.freeze({
  daily: Object.freeze({ label: "デイリー", minimumMatches: 1, tiers: Object.freeze([{ points: 6, reward: 30 }, { points: 3, reward: 20 }, { points: 0, reward: 10 }]) }),
  weekly: Object.freeze({ label: "ウィークリー", minimumMatches: 3, tiers: Object.freeze([{ points: 12, reward: 180 }, { points: 6, reward: 100 }, { points: 0, reward: 50 }]) }),
  monthly: Object.freeze({ label: "マンスリー", minimumMatches: 5, tiers: Object.freeze([{ points: 30, reward: 500 }, { points: 12, reward: 300 }, { points: 0, reward: 150 }]) }),
});
const SERVER_RANKING_CUTOVER_KEYS = Object.freeze({
  daily: "2026-07-24",
  weekly: "2026-07-27",
  monthly: "2026-08",
});
const SERVER_RANKING_AWARD_MINIMUM_MATCHES = Object.freeze({
  daily: 1,
  weekly: 3,
  monthly: 10,
});
const MAX_POINTS = 999_999;
const MAX_EQUIPPED_REACTIONS = 8;
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "センスいい", "もっと見たい"];
const GENERIC_MATCH_MISSION_END_DATE_KEY = "2026-07-23";
const DAILY_MISSIONS = [
  { id: "complete_match", progressKey: "matches", title: "1試合を完走", description: "ルーム破棄では進みません。", target: 1, reward: 100 },
  { id: "score_three", progressKey: "scores", title: "3回採点する", description: "相手の画像を合計3回採点します。", target: 3, reward: 60 },
  { id: "give_critical", progressKey: "criticals", title: "8点以上をつける", description: "CRITICAL評価を1回つけます。", target: 1, reward: 90 },
  { id: "play_solo", progressKey: "soloMatches", title: "通常型1on1を1回完走", description: "通常型1on1の正式な決着が対象です。", target: 1, reward: 40 },
  { id: "play_strategy", progressKey: "strategyMatches", title: "戦略型1on1を1回完走", description: "戦略型1on1の正式な決着が対象です。", target: 1, reward: 50 },
  { id: "play_team", progressKey: "teamMatches", title: "2on2を1回完走", description: "2on2の正式な決着が対象です。", target: 1, reward: 70 },
  { id: "play_royale", progressKey: "royaleMatches", title: "バトルロワイヤルを1回完走", description: "バトルロワイヤルの正式な決着が対象です。", target: 1, reward: 90 },
];
const dailyMissionsForDate = (dateKey) => DAILY_MISSIONS.filter((mission) => (
  mission.id !== "complete_match" || dateKey < GENERIC_MATCH_MISSION_END_DATE_KEY
));
const DAILY_PROGRESS_LIMITS = Object.freeze({
  matches: 1,
  scores: 3,
  criticals: 1,
  soloMatches: 1,
  strategyMatches: 1,
  teamMatches: 1,
  royaleMatches: 1,
});
const SHOP_PRODUCTS = [
  { id: TOP_MESSAGE_PRODUCT_ID, type: "feature", name: "トップメッセージ枠", description: "トップページに表示するひとことを投稿・編集できる買い切り機能", price: 500 },
  { id: "reaction_color", type: "reaction", name: "カラーパレット", reaction: "色づかいが好き！", description: "色の組み合わせを褒める追加リアクション", price: 120 },
  { id: "reaction_best_shot", type: "reaction", name: "ベストショット", reaction: "最高の一枚！", description: "力強く褒める追加リアクション", price: 150 },
  { id: "reaction_composition", type: "reaction", name: "コンポジション", reaction: "構図がうまい！", description: "画面構成に注目した追加リアクション", price: 160 },
  { id: "reaction_atmosphere", type: "reaction", name: "アトモスフィア", reaction: "空気感が最高", description: "画像全体の雰囲気を褒める追加リアクション", price: 200 },
  { id: "reaction_idea", type: "reaction", name: "アイデア賞", reaction: "発想がおもしろい！", description: "意外性や着眼点を褒める追加リアクション", price: 240 },
  { id: "reaction_healing", type: "reaction", name: "ヒーリング", reaction: "癒やされる", description: "穏やかな画像に似合う追加リアクション", price: 250 },
  { id: "reaction_keep_watching", type: "reaction", name: "ロングルック", reaction: "ずっと見ていたい", description: "見飽きない魅力を伝える追加リアクション", price: 300 },
  { id: "reaction_today_favorite", type: "reaction", name: "トゥデイズピック", reaction: "今日の推し！", description: "その日の一番を伝える追加リアクション", price: 350 },
  { id: "reaction_story", type: "reaction", name: "ストーリーテラー", reaction: "物語を感じる", description: "背景まで想像したときの追加リアクション", price: 400 },
  { id: "reaction_masterpiece", type: "reaction", name: "マスターピース", reaction: "これは名作", description: "ここぞという一枚に送る追加リアクション", price: 600 },
  ...STAMP_PRODUCTS,
  ...PLAYER_TITLE_PRODUCTS,
  ...CHAT_COSMETIC_PRODUCTS,
];
const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const SELECTION_TIME_LIMIT_MS = 10_000;
const SELECTION_WARNING_SECONDS = 3;
const MATCH_TIMEOUT_MS = 20_000;
const MATCH_SCOPE_EXPAND_DELAY_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const MAX_IMAGE_TRANSFER_BYTES = 15 * 1024 * 1024;
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const PUBLIC_PRESENCE_FRESH_MS = 45_000;
const PUBLIC_PRESENCE_HEARTBEAT_MS = 20_000;

const economyActionCallable = httpsCallable(functions, "economyAction");
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const sampleHandicapDialog = document.querySelector("#sampleHandicapDialog");
const sampleHandicapMessage = document.querySelector("#sampleHandicapMessage");
const confirmSampleMatch = document.querySelector("#confirmSampleMatch");
const fxLayer = document.querySelector("#fxLayer");
const finishCutInDialog = document.querySelector("#finishCutInDialog");
const finishCutInContent = document.querySelector("#finishCutInContent");

let active = false;
let state = createOnlineState();
let finishCutInGeneration = 0;
let matchmakingGenerationCounter = 0;
let lobbyPresenceEntries = null;
let marketPresenceEntries = null;
const LOBBY_MODES = ["solo", "strategy", "team", "royale"];
const createLobbyStats = (value = null) => ({
  ...Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { waiting: value, playing: value }])),
  market: { sellerWaiting: value, buyerWaiting: value, negotiating: value },
});
let lobbyStats = createLobbyStats();
let leaderboardEntries = [];
let leaderboardStatus = "idle";
let leaderboardPeriod = DEFAULT_LEADERBOARD_PERIOD;
let leaderboardPeriodKey = "";
let leaderboardRequestId = 0;
let monthlyBeyondRanks = new Map();
let monthlyBeyondPeriodKey = "";
let monthlyHallOfFameRecords = [];
let publicServerTimeOffset = 0;
let topMessageRecords = [];
let topMessagesStatus = "idle";
let topMessagesRequestId = 0;

function createOnlineState() {
  const leaderboardPublic = localStorage.getItem(RANKING_PUBLIC_KEY) === "1";
  const savedXHandle = normalizeXHandle(localStorage.getItem(X_HANDLE_KEY) || "");
  const pursuitSettings = getSavedPursuitSettings();
  const finishSettings = getSavedFinishSettings();
  const imagePreference = normalizeImagePreference(localStorage.getItem(IMAGE_PREFERENCE_KEY), "");
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    overallProfile: null,
    authReady: false,
    ...pursuitSettings,
    ...finishSettings,
    showOpponentCustomFinish: localStorage.getItem(OPPONENT_CUSTOM_FINISH_KEY) !== "0",
    imagePreference,
    deck: [],
    signatureCardId: "",
    roomId: "",
    room: null,
    opponentUid: "",
    playerIndex: 0,
    players: [],
    round: 1,
    selectedCardId: "",
    selectedScore: null,
    remoteImages: new Map(),
    remoteAvatar: null,
    avatarSent: false,
    incomingAvatarTransfer: null,
    hideOpponentAvatar: false,
    history: [],
    outcome: null,
    processedRounds: new Set(),
    continuedRounds: new Set(),
    sentImageRounds: new Set(),
    roundData: {},
    chatMessages: [],
    seenChatIds: new Set(),
    matchingBusy: false,
    acceptingOffer: false,
    pendingIncomingOffer: null,
    activeUsers: {},
    latestQueue: {},
    pendingOffer: null,
    matchmakingGeneration: 0,
    matchTimer: null,
    matchScopeTimer: null,
    matchScopeAvailable: false,
    matchScopeExpanded: false,
    queueHeartbeat: null,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    leaderboardId: "",
    leaderboardPublic,
    xHandle: savedXHandle,
    xPublic: leaderboardPublic && X_HANDLE_PATTERN.test(savedXHandle) && localStorage.getItem(X_PUBLIC_KEY) === "1",
    rankingCommentsEnabled: localStorage.getItem(RANKING_COMMENTS_ENABLED_KEY) !== "0",
    economy: createEmptyEconomy(),
    economyReady: false,
    economyBusy: false,
    dailyPlay: createEmptyDailyPlayRewardState(),
    achievements: window.HariaiAchievements?.normalizeProfile?.(null) || {
      unlocked: {},
      pendingUnlocks: [],
      customShowcase: [],
      showcase: [],
      unlockedCount: 0,
      totalCount: 0,
      stats: {},
    },
    achievementsReady: false,
    achievementsBusy: false,
    notifiedAchievementIds: new Set(),
    rankingAwards: [],
    rankingAwardsReady: false,
    periodRewardReminderShown: false,
    titleCategoryFilter: "all",
    expandedTitleCategories: new Set(["preference"]),
    topMessage: null,
    topMessageEntryId: "",
    topMessageReady: false,
    topMessageBusy: false,
    offerPollTimer: null,
    hostStatusPollTimer: null,
    matchUnsubscribers: [],
    roomUnsubscribers: [],
    roundUnsubscribe: null,
    serverTimeOffset: 0,
    selectionTimer: null,
    selectionStartedAt: 0,
    selectionRemainingMs: SELECTION_TIME_LIMIT_MS,
    selectionLastSoundSecond: null,
    selectionReadyRound: 0,
    selectionStartRequestRound: 0,
    selectionTimeoutHandledRound: 0,
    selectionLocking: false,
    disconnectHandles: [],
    peer: null,
    channel: null,
    channelReady: false,
    peerStatus: "未接続",
    pendingIce: [],
    incomingTransfer: null,
    transferProgress: 0,
    finishCutInTimer: null,
    opponentOnline: true,
    statsCommitted: false,
    destroyedByOpponent: false,
  };
}

function normalizeImagePreference(value, fallback = "both") {
  const preference = String(value || "").trim();
  return IMAGE_PREFERENCE_OPTIONS.some((option) => option.id === preference) ? preference : fallback;
}

function getImagePreferenceOption(value) {
  const preference = normalizeImagePreference(value);
  return IMAGE_PREFERENCE_OPTIONS.find((option) => option.id === preference) || IMAGE_PREFERENCE_OPTIONS[2];
}

function sanitizePursuitLineDraft(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").slice(0, MAX_PURSUIT_LINE_LENGTH);
}

function normalizePursuitLine(value) {
  const normalized = sanitizePursuitLineDraft(value).replace(/\s+/g, " ").trim();
  return normalized || PURSUIT_LINES[0];
}

function getSavedPursuitSettings() {
  const savedValue = localStorage.getItem(PURSUIT_LINE_KEY) || "";
  const pursuitLine = normalizePursuitLine(savedValue);
  const usesCustomLine = Boolean(savedValue) && !PURSUIT_LINES.includes(pursuitLine);
  return {
    pursuitLine,
    pursuitLineChoice: usesCustomLine ? CUSTOM_PURSUIT_VALUE : pursuitLine,
    customPursuitLine: usesCustomLine ? pursuitLine : "",
  };
}

function applyPursuitLineSetting(value) {
  const pursuitLine = normalizePursuitLine(value);
  const usesCustomLine = !PURSUIT_LINES.includes(pursuitLine);
  state.pursuitLine = pursuitLine;
  state.pursuitLineChoice = usesCustomLine ? CUSTOM_PURSUIT_VALUE : pursuitLine;
  state.customPursuitLine = usesCustomLine ? pursuitLine : "";
}

function sanitizeFinishLineDraft(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").slice(0, MAX_FINISH_LINE_LENGTH);
}

function normalizeFinishLine(value, fallback = FINISH_LINES[0]) {
  const normalized = sanitizeFinishLineDraft(value).replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeReceivedFinishLine(value) {
  if (typeof value !== "string") return FINISH_LINES[0];
  return normalizeFinishLine(value, "");
}

function getSavedFinishSettings() {
  const savedValue = localStorage.getItem(FINISH_LINE_KEY);
  if (savedValue === FINISH_LINE_DISABLED_VALUE) {
    return {
      finishLine: "",
      finishLineChoice: FINISH_LINE_DISABLED_VALUE,
      customFinishLine: "",
    };
  }
  const finishLine = normalizeFinishLine(savedValue || "");
  const usesCustomLine = savedValue !== null && !FINISH_LINES.includes(finishLine);
  return {
    finishLine,
    finishLineChoice: usesCustomLine ? CUSTOM_FINISH_VALUE : finishLine,
    customFinishLine: usesCustomLine ? finishLine : "",
  };
}

function applyFinishLineSetting(value) {
  if (value === FINISH_LINE_DISABLED_VALUE || value === "") {
    state.finishLine = "";
    state.finishLineChoice = FINISH_LINE_DISABLED_VALUE;
    return;
  }
  const finishLine = normalizeFinishLine(value);
  const usesCustomLine = !FINISH_LINES.includes(finishLine);
  state.finishLine = finishLine;
  state.finishLineChoice = usesCustomLine ? CUSTOM_FINISH_VALUE : finishLine;
  if (usesCustomLine) state.customFinishLine = finishLine;
}

function jstDateKey(timestamp = Date.now()) {
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function normalizeLeaderboardPeriod(value) {
  return LEADERBOARD_PERIODS.includes(value) ? value : DEFAULT_LEADERBOARD_PERIOD;
}

function isServerRankingPeriod(period, key) {
  return LEADERBOARD_PERIODS.includes(period)
    && typeof key === "string"
    && key >= SERVER_RANKING_CUTOVER_KEYS[period];
}

function leaderboardPeriodKeyFor(period, timestamp = Date.now()) {
  const normalizedPeriod = normalizeLeaderboardPeriod(period);
  const shifted = new Date(timestamp + (9 * 60 * 60 * 1000));
  if (normalizedPeriod === "monthly") return shifted.toISOString().slice(0, 7);
  if (normalizedPeriod === "weekly") {
    const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
    shifted.setUTCDate(shifted.getUTCDate() - daysSinceMonday);
  }
  return shifted.toISOString().slice(0, 10);
}

function leaderboardPeriodStartAt(period, key) {
  const normalizedPeriod = normalizeLeaderboardPeriod(period);
  const startKey = normalizedPeriod === "monthly" ? `${key}-01` : key;
  return Date.parse(`${startKey}T00:00:00+09:00`);
}

function leaderboardPeriodInfoFor(period = leaderboardPeriod, timestamp = Date.now() + publicServerTimeOffset) {
  const normalizedPeriod = normalizeLeaderboardPeriod(period);
  const key = leaderboardPeriodKeyFor(normalizedPeriod, timestamp);
  const startAt = leaderboardPeriodStartAt(normalizedPeriod, key);
  let nextResetAt = startAt + (24 * 60 * 60 * 1000);
  if (normalizedPeriod === "weekly") nextResetAt = startAt + (7 * 24 * 60 * 60 * 1000);
  if (normalizedPeriod === "monthly") {
    const shiftedStart = new Date(startAt + (9 * 60 * 60 * 1000));
    nextResetAt = Date.UTC(shiftedStart.getUTCFullYear(), shiftedStart.getUTCMonth() + 1, 1) - (9 * 60 * 60 * 1000);
  }
  const shortDate = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" });
  const label = normalizedPeriod === "daily"
    ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }).format(startAt)
    : normalizedPeriod === "weekly"
      ? `${shortDate.format(startAt)}〜${shortDate.format(nextResetAt - 1)}`
      : new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", timeZone: "Asia/Tokyo" }).format(startAt);
  return {
    period: normalizedPeriod,
    key,
    label,
    startAt,
    nextResetAt,
    minimumMatches: normalizedPeriod === "daily" ? 1 : normalizedPeriod === "weekly" ? 3 : 5,
    awardMinimumMatches: SERVER_RANKING_AWARD_MINIMUM_MATCHES[normalizedPeriod],
    serverAuthoritative: isServerRankingPeriod(normalizedPeriod, key),
  };
}

function getLeaderboardPeriodInfo(period = leaderboardPeriod) {
  return leaderboardPeriodInfoFor(period);
}

function periodRewardKeyIsValid(period, key) {
  if (period === "monthly") return /^[0-9]{4}-[0-9]{2}$/.test(String(key || ""));
  return (period === "daily" || period === "weekly") && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(key || ""));
}

function periodRewardEndsAtFor(period, key) {
  if (!periodRewardKeyIsValid(period, key)) return 0;
  const startAt = leaderboardPeriodStartAt(period, key);
  if (!Number.isFinite(startAt)) return 0;
  return leaderboardPeriodInfoFor(period, startAt + 1_000).nextResetAt;
}

function createEmptyPeriodRewards() {
  return Object.fromEntries(LEADERBOARD_PERIODS.map((period) => [period, {}]));
}

function calculatePeriodReward(period, record) {
  const config = PERIOD_REWARD_CONFIG[period];
  const matches = Math.max(0, Math.floor(Number(record?.matches || 0)));
  if (!config || matches < config.minimumMatches) return 0;
  const points = Math.max(0, Math.floor(Number(record?.points || 0)));
  return config.tiers.find((tier) => points >= tier.points)?.reward || 0;
}

function normalizePeriodRewardRecord(value, period, key) {
  if (!value || typeof value !== "object" || !periodRewardKeyIsValid(period, key)) return null;
  const wins = Math.max(0, Math.floor(Number(value.wins || 0)));
  const losses = Math.max(0, Math.floor(Number(value.losses || 0)));
  const draws = Math.max(0, Math.floor(Number(value.draws || 0)));
  const matches = wins + losses + draws;
  let modeMatches = Object.fromEntries(LEADERBOARD_MODES.map((mode) => [mode, Math.max(0, Math.floor(Number(value.modeMatches?.[mode] || 0)))]));
  if (Object.values(modeMatches).reduce((total, count) => total + count, 0) !== matches) {
    modeMatches = { solo: matches, strategy: 0, team: 0, royale: 0 };
  }
  const record = {
    matches,
    verifiedMatches: Math.min(matches, Math.max(0, Math.floor(Number(value.verifiedMatches || 0)))),
    wins,
    losses,
    draws,
    points: (wins * 3) + draws,
    modeMatches,
    endsAt: periodRewardEndsAtFor(period, key),
    claimed: value.claimed === true,
    reward: 0,
    updatedAt: Math.max(0, Math.floor(Number(value.updatedAt || 0))),
  };
  if (record.claimed) {
    record.reward = calculatePeriodReward(period, record);
    record.claimedAt = Math.max(record.endsAt, Math.floor(Number(value.claimedAt || value.updatedAt || record.endsAt)));
  }
  return record;
}

function normalizePeriodRewards(value) {
  const source = value && typeof value === "object" ? value : {};
  const rewards = createEmptyPeriodRewards();
  LEADERBOARD_PERIODS.forEach((period) => {
    Object.entries(source[period] || {}).forEach(([key, entry]) => {
      const normalized = normalizePeriodRewardRecord(entry, period, key);
      if (normalized) rewards[period][key] = normalized;
    });
  });
  return rewards;
}

function periodRewardEntries(economy = state.economy) {
  return LEADERBOARD_PERIODS.flatMap((period) => Object.entries(economy?.periodRewards?.[period] || {}).map(([key, record]) => ({
    period,
    key,
    record,
    reward: calculatePeriodReward(period, record),
  })));
}

function pendingPeriodRewards(economy = state.economy, timestamp = serverNow()) {
  return periodRewardEntries(economy).filter(({ record, reward }) => (
    !record.claimed
    && record.matches > 0
    && record.verifiedMatches === record.matches
    && reward > 0
    && Number(record.endsAt || 0) <= timestamp
  ));
}

function pendingPeriodRewardSummary(economy = state.economy, timestamp = serverNow()) {
  const entries = pendingPeriodRewards(economy, timestamp);
  return { entries, total: entries.reduce((total, entry) => total + entry.reward, 0) };
}

function createEmptyDailyPlayRewardState(dateKey = jstDateKey()) {
  return {
    dateKey,
    startsOn: "2026-07-23",
    graceDays: 7,
    matches: 0,
    basicTarget: 10,
    maxMatches: 200,
    basicComplete: false,
    previousTarget: 0,
    nextTarget: 0,
    nextReward: 0,
    pendingCount: 0,
    pendingPoints: 0,
    claimedTierIds: [],
    tiers: [],
  };
}

function normalizeDailyPlayRewardState(value, fallback = state?.dailyPlay) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object"
    ? fallback
    : createEmptyDailyPlayRewardState();
  const maxMatches = Math.min(200, Math.max(1, Math.floor(Number(source.maxMatches || base.maxMatches || 200))));
  const matches = Math.min(maxMatches, Math.max(0, Math.floor(Number(source.matches || 0))));
  const claimedTierIds = Array.isArray(source.claimedTierIds)
    ? source.claimedTierIds.map((id) => String(id || "")).filter((id) => /^daily_play_\d+$/.test(id))
    : [];
  const claimed = new Set(claimedTierIds);
  const tiers = Array.isArray(source.tiers)
    ? source.tiers.map((tier) => ({
      id: String(tier?.id || ""),
      target: Math.min(maxMatches, Math.max(1, Math.floor(Number(tier?.target || 0)))),
      reward: Math.max(0, Math.floor(Number(tier?.reward || 0))),
      phase: ["basic", "bonus", "record"].includes(tier?.phase) ? tier.phase : "bonus",
    }))
      .filter((tier) => /^daily_play_\d+$/.test(tier.id) && tier.reward > 0)
      .sort((first, second) => first.target - second.target)
    : base.tiers || [];
  const normalizedTiers = tiers.map((tier) => ({
    ...tier,
    complete: matches >= tier.target,
    claimed: claimed.has(tier.id),
  }));
  const nextTier = normalizedTiers.find((tier) => !tier.complete) || null;
  const previousTarget = nextTier
    ? Math.max(0, ...normalizedTiers.filter((tier) => tier.target < nextTier.target).map((tier) => tier.target))
    : maxMatches;
  const basicTarget = Math.min(maxMatches, Math.max(1, Math.floor(Number(source.basicTarget || base.basicTarget || 10))));
  return {
    dateKey: /^\d{4}-\d{2}-\d{2}$/.test(String(source.dateKey || "")) ? source.dateKey : currentDailyDateKey(),
    startsOn: /^\d{4}-\d{2}-\d{2}$/.test(String(source.startsOn || "")) ? source.startsOn : base.startsOn,
    graceDays: Math.min(30, Math.max(1, Math.floor(Number(source.graceDays || base.graceDays || 7)))),
    matches,
    basicTarget,
    maxMatches,
    basicComplete: matches >= basicTarget,
    previousTarget,
    nextTarget: nextTier?.target || 0,
    nextReward: nextTier?.reward || 0,
    pendingCount: Math.max(0, Math.floor(Number(source.pendingCount || 0))),
    pendingPoints: Math.max(0, Math.floor(Number(source.pendingPoints || 0))),
    claimedTierIds: [...claimed],
    tiers: normalizedTiers,
  };
}

function applyDailyPlayRewardState(value) {
  if (!value || typeof value !== "object") return state.dailyPlay;
  const incomingDateKey = String(value.dateKey || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(incomingDateKey)
    && /^\d{4}-\d{2}-\d{2}$/.test(String(state.dailyPlay?.dateKey || ""))
    && incomingDateKey < state.dailyPlay.dateKey) {
    return state.dailyPlay;
  }
  state.dailyPlay = normalizeDailyPlayRewardState(value, state.dailyPlay);
  return state.dailyPlay;
}

function emptyOverallModeRecord() {
  return { wins: 0, losses: 0, draws: 0, matches: 0, points: 0 };
}

function normalizeOverallModeRecord(value) {
  const wins = Math.max(0, Math.floor(Number(value?.wins || 0)));
  const losses = Math.max(0, Math.floor(Number(value?.losses || 0)));
  const draws = Math.max(0, Math.floor(Number(value?.draws || 0)));
  return { wins, losses, draws, matches: wins + losses + draws, points: (wins * 3) + draws };
}

function overallProfileSeed(name, soloProfile = null) {
  const solo = normalizeOverallModeRecord(soloProfile);
  const modes = Object.fromEntries(LEADERBOARD_MODES.map((mode) => [mode, mode === "solo" ? solo : emptyOverallModeRecord()]));
  return {
    name: String(name || soloProfile?.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
    wins: solo.wins,
    losses: solo.losses,
    draws: solo.draws,
    streak: Math.max(0, Math.floor(Number(soloProfile?.streak || 0))),
    bestStreak: Math.max(0, Math.floor(Number(soloProfile?.bestStreak || 0))),
    rating: Math.min(3000, Math.max(100, Math.round(Number(soloProfile?.rating || INITIAL_RATING)))),
    modes,
    updatedAt: serverNow(),
  };
}

function normalizeOverallProfile(value, fallbackName = "PLAYER", soloSeed = null) {
  const source = value && typeof value === "object" ? value : overallProfileSeed(fallbackName, soloSeed);
  const hasModes = source.modes && typeof source.modes === "object";
  const legacySolo = hasModes ? null : normalizeOverallModeRecord(source);
  const modes = Object.fromEntries(LEADERBOARD_MODES.map((mode) => [
    mode,
    normalizeOverallModeRecord(hasModes ? source.modes?.[mode] : mode === "solo" ? legacySolo : null),
  ]));
  const wins = LEADERBOARD_MODES.reduce((sum, mode) => sum + modes[mode].wins, 0);
  const losses = LEADERBOARD_MODES.reduce((sum, mode) => sum + modes[mode].losses, 0);
  const draws = LEADERBOARD_MODES.reduce((sum, mode) => sum + modes[mode].draws, 0);
  const streak = Math.max(0, Math.floor(Number(source.streak || 0)));
  return {
    name: String(fallbackName || source.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
    wins,
    losses,
    draws,
    streak,
    bestStreak: Math.max(streak, Math.floor(Number(source.bestStreak || 0))),
    rating: Math.min(3000, Math.max(100, Math.round(Number(source.rating || INITIAL_RATING)))),
    modes,
    updatedAt: Number(source.updatedAt || serverNow()),
  };
}

function leaderboardPublicSettings() {
  const enabled = localStorage.getItem(RANKING_PUBLIC_KEY) === "1";
  const xHandle = normalizeXHandle(localStorage.getItem(X_HANDLE_KEY) || "");
  return {
    enabled,
    xHandle,
    xPublic: enabled && X_HANDLE_PATTERN.test(xHandle) && localStorage.getItem(X_PUBLIC_KEY) === "1",
    commentsEnabled: localStorage.getItem(RANKING_COMMENTS_ENABLED_KEY) !== "0",
  };
}

function getOverallRankingPreference() {
  return { ...leaderboardPublicSettings() };
}

function normalizeRankingControlId(controlId) {
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(String(controlId)) ? String(controlId) : "overallRankingParticipation";
}

function renderOverallRankingParticipation({ controlId = "overallRankingParticipation" } = {}) {
  const settings = getOverallRankingPreference();
  const safeControlId = normalizeRankingControlId(controlId);
  const handleId = `${safeControlId}XHandle`;
  const publicId = `${safeControlId}XPublic`;
  const commentsId = `${safeControlId}CommentsEnabled`;
  const saveId = `${safeControlId}Save`;
  const publicSettings = settings.enabled ? `<details class="overall-ranking-settings">
    <summary><span><strong>公開プロフィール設定</strong><small>Xリンクと、自分の順位欄でコメントを受け付けるかを設定します。</small></span><b>設定を開く</b></summary>
    <div class="overall-ranking-public-controls">
      <label class="ranking-x-handle" for="${handleId}"><span>@</span><input id="${handleId}" type="text" maxlength="15" value="${escapeHtml(settings.xHandle)}" placeholder="username" autocomplete="off" autocapitalize="none" spellcheck="false" /></label>
      <label class="ranking-x-public"><input type="checkbox" id="${publicId}" ${settings.xPublic ? "checked" : ""} /><span>ランキングでXを公開する</span></label>
      <label class="ranking-x-public"><input type="checkbox" id="${commentsId}" ${settings.commentsEnabled ? "checked" : ""} /><span>自分の順位欄でコメントを受け付ける</span></label>
      <button class="button button-ghost button-small" type="button" id="${saveId}">公開設定を保存</button>
    </div>
    <p>Xを公開すると匿名性が下がります。コメントはランキング参加者だけが1人1件、80文字以内で投稿できます。</p>
  </details>` : "";
  return `<section class="overall-ranking-panel ${settings.enabled ? "is-enabled" : "is-disabled"}">
    <div class="overall-ranking-copy"><span class="eyebrow">ONLINE OVERALL RANKING</span><div><strong>オンライン総合ランキング</strong>
      <p>${settings.enabled ? "4モード共通で期間スコアを集計し、総合RATEを公開しています。" : "戦績と総合RATEは非公開で保持され、期間スコアは参加中の対戦だけ集計されます。"}</p></div></div>
    <div class="overall-ranking-control"><span class="overall-ranking-status">${settings.enabled ? "● 参加中" : "○ 非参加"}</span>
      <button class="button ${settings.enabled ? "button-ghost" : "button-primary"} button-small" type="button" id="${safeControlId}" aria-pressed="${settings.enabled}">${settings.enabled ? "参加をやめる" : "参加する"}</button></div>
    <small>通常型1on1・戦略型1on1・2on2・バトルロワイヤルで同じ設定を使用します。匿名UIDとルーム履歴は公開しません。サーバー期間で確定したランキング実績と月間王者記録は、参加終了後も名誉記録として残ります。</small>
    ${publicSettings}
  </section>`;
}

function bindOverallRankingParticipation({ controlId = "overallRankingParticipation", name = "", onUpdate } = {}) {
  const safeControlId = normalizeRankingControlId(controlId);
  const button = document.getElementById(safeControlId);
  button?.addEventListener("click", async () => {
    const nextEnabled = !getOverallRankingPreference().enabled;
    button.disabled = true;
    try {
      const displayName = typeof name === "function" ? name() : name;
      await setOverallRankingParticipation(nextEnabled, displayName);
      showToast(nextEnabled ? "オンライン総合ランキングへの参加を有効にしました。" : "オンライン総合ランキングから非公開にしました。");
    } catch (error) {
      showToast(error?.message || "ランキング設定を更新できませんでした。");
    } finally {
      onUpdate?.();
    }
  });
  const saveButton = document.getElementById(`${safeControlId}Save`);
  saveButton?.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      const displayName = typeof name === "function" ? name() : name;
      await saveOverallRankingPublicSettings({
        xHandle: document.getElementById(`${safeControlId}XHandle`)?.value,
        xPublic: document.getElementById(`${safeControlId}XPublic`)?.checked,
        commentsEnabled: document.getElementById(`${safeControlId}CommentsEnabled`)?.checked,
        name: displayName,
      });
      showToast("ランキングの公開設定を保存しました。");
      onUpdate?.();
    } catch (error) {
      saveButton.disabled = false;
      showToast(error?.message || "ランキングの公開設定を更新できませんでした。");
    }
  });
}

function createEmptyEconomy(dateKey = jstDateKey()) {
  return {
    points: 0,
    inventory: {},
    equipped: { reactions: {}, stamps: {}, title: "", chatFrame: "", chatBackground: "" },
    periodRewards: createEmptyPeriodRewards(),
    daily: {
      dateKey,
      matches: 0,
      scores: 0,
      criticals: 0,
      soloMatches: 0,
      strategyMatches: 0,
      teamMatches: 0,
      royaleMatches: 0,
      claimed: {},
    },
    updatedAt: Date.now(),
  };
}

function serverNow() {
  return Date.now() + Number(state.serverTimeOffset || 0);
}

function currentDailyDateKey() {
  return jstDateKey(serverNow());
}

function normalizeEconomyRecord(value, dateKey = currentDailyDateKey()) {
  const source = value && typeof value === "object" ? value : {};
  const sameDate = source.daily?.dateKey === dateKey;
  const record = createEmptyEconomy(dateKey);
  record.points = Math.min(MAX_POINTS, Math.max(0, Math.floor(Number(source.points || 0))));
  record.updatedAt = serverNow();
  SHOP_PRODUCTS.forEach((product) => {
    if (source.inventory?.[product.id] === true) record.inventory[product.id] = true;
  });
  const ownedReactions = SHOP_PRODUCTS.filter((product) => product.type === "reaction" && record.inventory[product.id]);
  const savedEquipment = source.equipped && typeof source.equipped === "object";
  const reactionIds = savedEquipment
    ? ownedReactions.filter((product) => source.equipped?.reactions?.[product.id] === true).map((product) => product.id)
    : ownedReactions.map((product) => product.id);
  reactionIds.slice(0, MAX_EQUIPPED_REACTIONS).forEach((id) => { record.equipped.reactions[id] = true; });
  record.equipped.stamps = normalizeEquippedStamps(source, record.inventory, savedEquipment);
  const savedTitle = String(source.equipped?.title || "");
  const titleProduct = SHOP_PRODUCTS.find((product) => product.type === "title" && product.id === savedTitle && record.inventory[product.id]);
  record.equipped.title = titleProduct?.id || "";
  const chatCosmetics = getEquippedChatCosmetics({ inventory: record.inventory, equipped: source.equipped });
  record.equipped.chatFrame = chatCosmetics.chatFrameId;
  record.equipped.chatBackground = chatCosmetics.chatBackgroundId;
  record.periodRewards = normalizePeriodRewards(source.periodRewards);
  if (sameDate) {
    Object.entries(DAILY_PROGRESS_LIMITS).forEach(([progressKey, limit]) => {
      record.daily[progressKey] = Math.min(limit, Math.max(0, Math.floor(Number(source.daily[progressKey] || 0))));
    });
    DAILY_MISSIONS.forEach((mission) => {
      if (source.daily.claimed?.[mission.id] === true) record.daily.claimed[mission.id] = true;
    });
  }
  return record;
}

const shared = () => window.HariaiApp?.shared;
const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
const showToast = (message) => shared()?.showToast(message);
const setBusy = (busy, message) => shared()?.setBusy(busy, message);

function getEquippedReactionProducts(economy = state.economy) {
  return SHOP_PRODUCTS.filter((product) => product.type === "reaction" && economy.equipped?.reactions?.[product.id] === true);
}

function getEquippedStampProducts(economy = state.economy) {
  return STAMP_PRODUCTS.filter((product) => economy.equipped?.stamps?.[product.id] === true);
}

function getTitleProduct(titleId = state.economy.equipped?.title) {
  return getPlayerTitleProduct(titleId);
}

function getShopProductLabel(productId) {
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === String(productId || ""));
  return product ? String(product.reaction || product.title || product.name || "") : "";
}

function titleLabel(titleId) {
  return getTitleProduct(titleId)?.title || "";
}

function renderTitleBadge(titleId = state.economy.equipped?.title) {
  const presentation = getPlayerTitlePresentation(titleId);
  return presentation
    ? `<span class="player-title-badge ${presentation.className}"><span aria-hidden="true">${escapeHtml(presentation.icon)}</span>${escapeHtml(presentation.product.title)}</span>`
    : "";
}

function attachEquippedChatCosmetics(message, economy = state.economy) {
  const cosmetics = getEquippedChatCosmetics(economy);
  if (cosmetics.chatFrameId) message.chatFrameId = cosmetics.chatFrameId;
  if (cosmetics.chatBackgroundId) message.chatBackgroundId = cosmetics.chatBackgroundId;
  return message;
}

function renderChatCosmeticBubble(text, message = {}) {
  const classes = chatCosmeticClassNames(message.chatFrameId, message.chatBackgroundId);
  return `<p${classes ? ` class="${classes}"` : ""}>${escapeHtml(text)}</p>`;
}

function openOnlineScreen(screen) {
  if (useOfflineMarketPreview) {
    if (screen === "shop" || screen === "missions") {
      active = true;
      state = createOnlineState();
      state.uid = `local-preview-${screen}`;
      state.screen = screen;
      state.authReady = true;
      state.economyReady = true;
      state.economy = normalizeEconomyRecord({
        points: 2_500,
        inventory: {
          title_oshi_storyteller: true,
          title_tokimeki_curator: true,
          stamp_god_photo: true,
          chat_bg_sakura_milk: true,
          chat_frame_heart_ribbon: true,
        },
        equipped: {
          reactions: {},
          stamps: { stamp_god_photo: true },
          title: "title_oshi_storyteller",
          chatBackground: "chat_bg_sakura_milk",
          chatFrame: "chat_frame_heart_ribbon",
        },
      });
      setOnlineChrome(screen === "shop" ? "ANJUPAY STORE PREVIEW" : "DAILY MISSION PREVIEW");
      render();
      return;
    }
    if (screen === "achievements") {
      active = true;
      state = createOnlineState();
      state.screen = "achievements";
      state.authReady = true;
      state.economyReady = true;
      state.achievementsReady = true;
      const previewUnlocked = Object.fromEntries([
        "battle_total_100",
        "battle_solo_100",
        "battle_strategy_5",
        "battle_team_1",
        "battle_royale_1",
        "battle_variety_all_1",
        "battle_losses_30",
        "battle_loss_streak_5",
        "battle_days_3",
        "market_seller_3",
        "market_buyer_1",
        "market_both_1",
        "market_first_turn",
      ].map((id, index) => [id, Date.now() - (index * 60_000)]));
      state.achievements = window.HariaiAchievements?.normalizeProfile?.({
        unlocked: previewUnlocked,
        customShowcase: [],
        showcase: ["market_first_turn", "market_both_1", "battle_days_3"],
      }) || state.achievements;
      setOnlineChrome("ACHIEVEMENTS PREVIEW");
      render();
      return;
    }
    showToast("LOCAL UI PREVIEW中は市場・実績・ミッション・AnjuPayストア以外のオンライン機能へ接続しません。");
    return;
  }
  if (active) {
    if (["setup", "missions", "shop", "achievements"].includes(state.screen)) {
      state.screen = screen;
      render();
    }
    return;
  }
  if (location.protocol === "file:") {
    showToast("オンライン対戦はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiMarket?.isActive?.()) {
    showToast("推し値市場を終了してからオンライン画面を開いてください。");
    return;
  }
  active = true;
  state = createOnlineState();
  state.screen = screen;
  setOnlineChrome("CONNECTING");
  render();
  Promise.resolve(shared()?.profileAvatar?.ready?.()).then(() => { if (active && state.screen === screen) render(); });
  ensureAuthenticated().catch(handleFatalError);
}

function start() {
  openOnlineScreen("setup");
}

function openDailyMissions() {
  openOnlineScreen("missions");
}

function openPointShop() {
  openOnlineScreen("shop");
}

function openAchievements() {
  openOnlineScreen("achievements");
}

function isActive() {
  return active;
}

function getLobbyStats() {
  return {
    ...Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { ...lobbyStats[mode] }])),
    market: { ...lobbyStats.market },
  };
}

function getLeaderboard() {
  return leaderboardEntries.map((entry) => ({ ...entry }));
}

function normalizeServerRankingAwards(value) {
  return (Array.isArray(value) ? value : []).map((award) => ({
    period: normalizeLeaderboardPeriod(award?.period),
    key: String(award?.key || ""),
    rank: Math.max(1, Math.floor(Number(award?.rank || 1))),
    matches: Math.max(0, Math.floor(Number(award?.matches || 0))),
    tier: String(award?.tier || "").slice(0, 40),
    label: String(award?.label || "").slice(0, 40),
    endsAt: Number(award?.endsAt || 0),
    activeUntil: Number(award?.activeUntil || 0),
    awardedAt: Number(award?.awardedAt || 0),
  })).filter((award) => (
    award.key
    && award.tier
    && isServerRankingPeriod(award.period, award.key)
  ));
}

function applyServerRankingAwards(value) {
  state.rankingAwards = normalizeServerRankingAwards(value);
  state.rankingAwardsReady = true;
  window.dispatchEvent(new Event("hariai-ranking-awards-updated"));
}

function getServerRankingAwards() {
  return {
    ready: state.rankingAwardsReady,
    awards: state.rankingAwards.map((award) => ({ ...award })),
  };
}

function getMonthlyRankingHallOfFame() {
  return monthlyHallOfFameRecords.map((record) => ({ ...record }));
}

async function loadServerRankingAwards() {
  if (!state.authReady || !state.uid) return [];
  const response = await economyActionCallable({ action: "get_server_ranking_awards" });
  applyServerRankingAwards(response.data?.awards);
  return state.rankingAwards;
}

function getLeaderboardStatus() {
  return leaderboardStatus;
}

function getLeaderboardLoadedPeriod() {
  return { period: leaderboardPeriod, key: leaderboardPeriodKey };
}

function getMonthlyBeyondRank(entryId, rating) {
  const normalizedRating = Math.min(3000, Math.max(100, Math.round(Number(rating || INITIAL_RATING))));
  if (normalizedRating < 1400 || monthlyBeyondPeriodKey !== leaderboardPeriodKeyFor("monthly", Date.now() + publicServerTimeOffset)) return 0;
  const rank = Number(monthlyBeyondRanks.get(String(entryId || "")) || 0);
  return rank >= 1 && rank <= 10 ? rank : 0;
}

function getMonthlyBeyondPeriodKey() {
  return monthlyBeyondPeriodKey;
}

function readMutedTopMessageIds() {
  try {
    const value = JSON.parse(localStorage.getItem(TOP_MESSAGE_MUTED_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(validLeaderboardEntryId).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function getTopMessages() {
  const mutedIds = readMutedTopMessageIds();
  return topMessageRecords
    .filter((message) => !mutedIds.has(message.entryId))
    .slice(0, TOP_MESSAGE_DISPLAY_LIMIT)
    .map((message) => ({ ...message }));
}

function getTopMessagesStatus() {
  return topMessagesStatus;
}

function getMutedTopMessageCount() {
  return readMutedTopMessageIds().size;
}

function notifyTopMessagesUpdated() {
  window.dispatchEvent(new Event("hariai-top-messages-updated"));
}

async function refreshTopMessages({ silent = false } = {}) {
  if (useOfflineMarketPreview) {
    topMessageRecords = [];
    topMessagesStatus = "ready";
    notifyTopMessagesUpdated();
    return;
  }
  const requestId = ++topMessagesRequestId;
  if (!silent || topMessagesStatus === "idle") {
    topMessagesStatus = "loading";
    notifyTopMessagesUpdated();
  }
  try {
    const records = await readPublicDatabasePath("online/topMessages", {
      orderByChildKey: "updatedAt",
      limit: TOP_MESSAGE_FETCH_LIMIT,
    });
    if (requestId !== topMessagesRequestId) return;
    topMessageRecords = Object.entries(records || {})
      .map(([entryId, record]) => {
        const titlePresentation = getPlayerTitlePresentation(record?.titleId);
        return {
          entryId: String(entryId || ""),
          name: String(record?.name || "").slice(0, 16),
          titleId: String(record?.titleId || ""),
          title: titlePresentation?.product.title || "",
          titleIcon: titlePresentation?.icon || "",
          titleClassName: titlePresentation?.className || "",
          text: String(record?.text || "").slice(0, TOP_MESSAGE_MAX_LENGTH),
          updatedAt: Number(record?.updatedAt || 0),
        };
      })
      .filter((record) => validLeaderboardEntryId(record.entryId) && record.name && record.text && Number.isFinite(record.updatedAt))
      .sort((first, second) => second.updatedAt - first.updatedAt);
    topMessagesStatus = "ready";
  } catch (error) {
    if (requestId !== topMessagesRequestId) return;
    console.error(error);
    topMessageRecords = [];
    topMessagesStatus = "error";
  } finally {
    if (requestId === topMessagesRequestId) notifyTopMessagesUpdated();
  }
}

function muteTopMessage(entryId) {
  const safeEntryId = validLeaderboardEntryId(entryId);
  if (!safeEntryId) return;
  const mutedIds = readMutedTopMessageIds();
  mutedIds.add(safeEntryId);
  localStorage.setItem(TOP_MESSAGE_MUTED_KEY, JSON.stringify(Array.from(mutedIds)));
  notifyTopMessagesUpdated();
}

function clearMutedTopMessages() {
  localStorage.removeItem(TOP_MESSAGE_MUTED_KEY);
  notifyTopMessagesUpdated();
}

async function readPublicDatabasePath(path, { orderByChildKey = "", limit = 0 } = {}) {
  if (useOfflineMarketPreview) return null;
  const constraints = [];
  if (orderByChildKey) constraints.push(orderByChild(String(orderByChildKey)));
  if (limit) {
    const normalizedLimit = Number(limit);
    if (!Number.isSafeInteger(normalizedLimit) || normalizedLimit <= 0) {
      throw new Error("公開データの取得件数が不正です。");
    }
    constraints.push(limitToLast(normalizedLimit));
  }
  const targetRef = ref(database, path);
  const targetQuery = constraints.length ? query(targetRef, ...constraints) : targetRef;
  const [snapshot, offsetSnapshot] = await Promise.all([
    get(targetQuery),
    get(ref(database, ".info/serverTimeOffset")).catch(() => null),
  ]);
  const offset = Number(offsetSnapshot?.val());
  if (Number.isFinite(offset)) publicServerTimeOffset = offset;
  return snapshot.val();
}

function validLeaderboardEntryId(value) {
  const entryId = String(value || "");
  return /^[A-Za-z0-9_-]{16,40}$/.test(entryId) ? entryId : "";
}

async function ensureRankingCommentUser() {
  if (useOfflineMarketPreview) throw new Error("LOCAL UI PREVIEW中はランキングコメントへ接続しません。");
  await setPersistence(auth, browserLocalPersistence);
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function authenticatedDatabaseRequest(path, { method = "GET", body } = {}) {
  await ensureRankingCommentUser();
  const targetRef = ref(database, path);
  try {
    if (method === "GET") return (await get(targetRef)).val();
    if (method === "PUT") {
      await set(targetRef, body);
      return null;
    }
    if (method === "DELETE") {
      await remove(targetRef);
      return null;
    }
    throw new Error(`未対応のコメント通信です（${method}）`);
  } catch (error) {
    const code = String(error?.code || "").toLowerCase();
    const detail = String(error?.message || "").toLowerCase();
    if (code.includes("permission-denied") || detail.includes("permission denied")) {
      throw new Error("このコメント操作は許可されていません。");
    }
    throw new Error("コメント通信に失敗しました。ページを再読み込みして、もう一度お試しください。");
  }
}

async function getLeaderboardComments(targetEntryId) {
  const targetId = validLeaderboardEntryId(targetEntryId);
  if (!targetId) throw new Error("ランキング情報を確認できませんでした。");
  const records = await readPublicDatabasePath(`online/leaderboardComments/${targetId}`, {
    orderByChildKey: "updatedAt",
    limit: 20,
  });
  return Object.entries(records || {})
    .map(([authorEntryId, record]) => ({
      authorEntryId: validLeaderboardEntryId(authorEntryId),
      authorName: String(record?.authorName || "").slice(0, 16),
      text: String(record?.text || "").slice(0, RANKING_COMMENT_MAX_LENGTH),
      updatedAt: Number(record?.updatedAt || 0),
    }))
    .filter((record) => record.authorEntryId && record.authorName && record.text && Number.isFinite(record.updatedAt))
    .sort((first, second) => second.updatedAt - first.updatedAt);
}

async function getLeaderboardCommentIdentity() {
  const user = await ensureRankingCommentUser();
  const entryId = validLeaderboardEntryId(await authenticatedDatabaseRequest(`online/leaderboardEntriesByUser/${user.uid}`));
  if (!entryId) return { canPost: false, entryId: "", name: "" };
  const entry = await readPublicDatabasePath(`online/leaderboard/${entryId}`);
  if (!entry?.name) return { canPost: false, entryId: "", name: "" };
  return {
    canPost: true,
    entryId,
    name: String(entry.name).slice(0, 16),
    commentsEnabled: entry.commentsEnabled !== false,
  };
}

async function saveLeaderboardComment(targetEntryId, value) {
  const targetId = validLeaderboardEntryId(targetEntryId);
  const text = String(value || "").trim();
  if (!targetId) throw new Error("ランキング情報を確認できませんでした。");
  if (!text || text.length > RANKING_COMMENT_MAX_LENGTH || /[\r\n]/.test(text)) {
    throw new Error(`コメントは1行${RANKING_COMMENT_MAX_LENGTH}文字以内で入力してください。`);
  }
  if (RANKING_COMMENT_URL_PATTERN.test(text)) throw new Error("コメントにURLは入力できません。");
  const identity = await getLeaderboardCommentIdentity();
  if (!identity.canPost) throw new Error("コメントするにはランキングへの参加が必要です。");
  if (identity.entryId === targetId) throw new Error("自分のランキング欄にはコメントできません。");
  await authenticatedDatabaseRequest(`online/leaderboardComments/${targetId}/${identity.entryId}`, {
    method: "PUT",
    body: { text, authorName: identity.name, updatedAt: { ".sv": "timestamp" } },
  });
}

async function deleteLeaderboardComment(targetEntryId, authorEntryId) {
  const targetId = validLeaderboardEntryId(targetEntryId);
  const authorId = validLeaderboardEntryId(authorEntryId);
  if (!targetId || !authorId) throw new Error("コメント情報を確認できませんでした。");
  await authenticatedDatabaseRequest(`online/leaderboardComments/${targetId}/${authorId}`, { method: "DELETE" });
}

function refreshLobbyStats() {
  const now = Date.now() + Number(publicServerTimeOffset || 0);
  const freshAfter = now - PUBLIC_PRESENCE_FRESH_MS;
  const entries = Object.values(lobbyPresenceEntries || {}).filter((entry) => (
    Number(entry?.lastSeen) >= freshAfter
    && LOBBY_MODES.includes(entry?.mode)
    && (entry?.state === "waiting" || entry?.state === "playing")
  ));
  lobbyStats = createLobbyStats();
  LOBBY_MODES.forEach((mode) => {
    lobbyStats[mode] = {
      waiting: lobbyPresenceEntries === null ? null : 0,
      playing: lobbyPresenceEntries === null ? null : 0,
    };
  });
  entries.forEach((entry) => {
    lobbyStats[entry.mode][entry.state] += 1;
  });
  if (marketPresenceEntries !== null) {
    lobbyStats.market = summarizeMarketPresence(marketPresenceEntries, now);
  }
  renderLobbyStats();
}

function renderLobbyStats() {
  const values = {
    lobbySoloWaitingCount: lobbyStats.solo.waiting,
    lobbySoloPlayingCount: lobbyStats.solo.playing,
    lobbyStrategyWaitingCount: lobbyStats.strategy.waiting,
    lobbyStrategyPlayingCount: lobbyStats.strategy.playing,
    lobbyTeamWaitingCount: lobbyStats.team.waiting,
    lobbyTeamPlayingCount: lobbyStats.team.playing,
    lobbyRoyaleWaitingCount: lobbyStats.royale.waiting,
    lobbyRoyalePlayingCount: lobbyStats.royale.playing,
    lobbyMarketSellerWaitingCount: lobbyStats.market.sellerWaiting,
    lobbyMarketBuyerWaitingCount: lobbyStats.market.buyerWaiting,
    lobbyMarketNegotiatingCount: lobbyStats.market.negotiating,
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = Number.isInteger(value) ? String(value) : "--";
  });
}

function watchLobbyStats() {
  onValue(ref(database, "online/publicPresence"), (snapshot) => {
    lobbyPresenceEntries = snapshot.val() || {};
    refreshLobbyStats();
  }, () => {
    lobbyPresenceEntries = null;
    refreshLobbyStats();
  });
  onValue(ref(database, "online/publicMarketPresence"), (snapshot) => {
    marketPresenceEntries = snapshot.val() || {};
    refreshLobbyStats();
  }, () => {
    marketPresenceEntries = null;
    refreshLobbyStats();
  });
  onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    const offset = Number(snapshot.val());
    if (Number.isFinite(offset)) publicServerTimeOffset = offset;
    refreshLobbyStats();
  }, () => {
    // A local clock fallback is sufficient when the offset cannot be read.
    refreshLobbyStats();
  });
  window.setInterval(refreshLobbyStats, 10_000);
}

function watchDailyDateRollover() {
  let observedDateKey = currentDailyDateKey();
  window.setInterval(() => {
    const nextDateKey = currentDailyDateKey();
    if (nextDateKey === observedDateKey) return;
    observedDateKey = nextDateKey;
    if (!active || !state.uid || !state.authReady) return;
    initializeEconomy().then(() => {
      state.periodRewardReminderShown = false;
      notifyPendingPeriodRewards();
      if (active && ["missions", "gameover"].includes(state.screen)) render();
    }).catch((error) => console.error(error));
  }, 10_000);
}

function normalizeLeaderboardRecords(entries) {
  return Object.entries(entries || {})
    .map(([entryId, entry]) => ({ entryId, ...entry }))
    .filter((entry) => (
      entry?.name
      && Number.isFinite(Number(entry.points))
      && Number.isFinite(Number(entry.rating))
    ))
    .sort((first, second) => (
      Number(second.points) - Number(first.points)
      || ((Number(second.wins || 0) + (Number(second.draws || 0) * 0.5)) / Math.max(1, Number(second.wins || 0) + Number(second.losses || 0) + Number(second.draws || 0)))
        - ((Number(first.wins || 0) + (Number(first.draws || 0) * 0.5)) / Math.max(1, Number(first.wins || 0) + Number(first.losses || 0) + Number(first.draws || 0)))
      || Number(second.wins || 0) - Number(first.wins || 0)
      || Number(second.rating || INITIAL_RATING) - Number(first.rating || INITIAL_RATING)
      || Number(first.updatedAt || 0) - Number(second.updatedAt || 0)
      || String(first.entryId || "").localeCompare(String(second.entryId || ""))
    ))
    .slice(0, 50);
}

async function refreshLeaderboard(period = leaderboardPeriod) {
  const selectedPeriod = normalizeLeaderboardPeriod(period);
  const periodInfo = leaderboardPeriodInfoFor(selectedPeriod);
  const monthlyPeriodInfo = leaderboardPeriodInfoFor("monthly");
  if (useOfflineMarketPreview) {
    leaderboardPeriod = selectedPeriod;
    leaderboardPeriodKey = periodInfo.key;
    leaderboardEntries = [];
    monthlyBeyondRanks = new Map();
    monthlyBeyondPeriodKey = monthlyPeriodInfo.key;
    leaderboardStatus = "ready";
    window.dispatchEvent(new Event("hariai-leaderboard-updated"));
    return;
  }
  const requestId = ++leaderboardRequestId;
  leaderboardPeriod = selectedPeriod;
  leaderboardPeriodKey = periodInfo.key;
  leaderboardEntries = [];
  monthlyBeyondRanks = new Map();
  monthlyBeyondPeriodKey = "";
  leaderboardStatus = "loading";
  window.dispatchEvent(new Event("hariai-leaderboard-updated"));
  try {
    const selectedRoot = periodInfo.serverAuthoritative ? "serverLeaderboardPeriods" : "leaderboardPeriods";
    const monthlyRoot = monthlyPeriodInfo.serverAuthoritative ? "serverLeaderboardPeriods" : "leaderboardPeriods";
    const selectedEntriesPromise = readPublicDatabasePath(`online/${selectedRoot}/${selectedPeriod}/${periodInfo.key}`, {
      orderByChildKey: "points",
      limit: 100,
    });
    const monthlyEntriesPromise = selectedPeriod === "monthly"
      ? selectedEntriesPromise
      : readPublicDatabasePath(`online/${monthlyRoot}/monthly/${monthlyPeriodInfo.key}`, {
        orderByChildKey: "points",
        limit: 100,
      }).catch(() => null);
    const hallOfFamePromise = readPublicDatabasePath("online/serverRankingHallOfFame/monthly").catch(() => null);
    const [entries, monthlyEntries, hallOfFame] = await Promise.all([
      selectedEntriesPromise,
      monthlyEntriesPromise,
      hallOfFamePromise,
    ]);
    if (requestId !== leaderboardRequestId) return;
    leaderboardEntries = normalizeLeaderboardRecords(entries);
    if (hallOfFame !== null) {
      monthlyHallOfFameRecords = Object.entries(hallOfFame || {})
        .map(([key, value]) => ({
          key,
          entryId: String(value?.entryId || ""),
          name: String(value?.name || "PLAYER").slice(0, 16) || "PLAYER",
          points: Math.max(0, Math.floor(Number(value?.points || 0))),
          wins: Math.max(0, Math.floor(Number(value?.wins || 0))),
          losses: Math.max(0, Math.floor(Number(value?.losses || 0))),
          draws: Math.max(0, Math.floor(Number(value?.draws || 0))),
          rating: Math.min(3000, Math.max(100, Math.floor(Number(value?.rating || INITIAL_RATING)))),
          participants: Math.max(1, Math.floor(Number(value?.participants || 1))),
          finalizedAt: Number(value?.finalizedAt || 0),
        }))
        .filter((record) => isServerRankingPeriod("monthly", record.key))
        .sort((first, second) => second.key.localeCompare(first.key))
        .slice(0, 12);
    }
    if (monthlyEntries !== null) {
      const monthlyRecords = selectedPeriod === "monthly" ? leaderboardEntries : normalizeLeaderboardRecords(monthlyEntries);
      monthlyBeyondRanks = new Map(monthlyRecords.slice(0, 10).map((entry, index) => [entry.entryId, index + 1]));
      monthlyBeyondPeriodKey = monthlyPeriodInfo.key;
    }
    leaderboardStatus = "ready";
  } catch {
    if (requestId !== leaderboardRequestId) return;
    leaderboardEntries = [];
    leaderboardStatus = "error";
  } finally {
    if (requestId === leaderboardRequestId) window.dispatchEvent(new Event("hariai-leaderboard-updated"));
  }
}

async function ensureAuthenticated() {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active) return;
  state.uid = credential.user.uid;
  const offsetPromise = new Promise((resolve) => {
    try {
      onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => resolve(Number(snapshot.val() || 0)), () => resolve(0), { onlyOnce: true });
    } catch {
      resolve(0);
    }
  });
  const [profileSnapshot, serverOffset] = await Promise.all([
    get(ref(database, `online/profiles/${state.uid}`)),
    offsetPromise,
  ]);
  state.serverTimeOffset = serverOffset;
  if (profileSnapshot.exists()) {
    state.profile = { ...state.profile, ...profileSnapshot.val() };
    if (!localStorage.getItem(PROFILE_NAME_KEY) && state.profile.name) state.name = state.profile.name;
    if (!localStorage.getItem(PURSUIT_LINE_KEY) && state.profile.pursuitLine) applyPursuitLineSetting(state.profile.pursuitLine);
  }
  try {
    state.overallProfile = await ensureOverallProfileSeeded(state.uid, state.name, state.profile);
  } catch (error) {
    console.error(error);
    showToast("総合ランキング情報を読み込めませんでした。対戦機能は利用できます。");
  }
  state.authReady = true;
  try {
    await initializeEconomy();
    notifyPendingPeriodRewards();
  } catch (error) {
    console.error(error);
    state.economyReady = false;
    showToast("AnjuPay情報を読み込めませんでした。対戦機能は利用できます。");
  }
  if (state.economyReady) {
    try {
      await loadOwnTopMessage();
    } catch (error) {
      console.error(error);
      state.topMessageReady = false;
      showToast("トップメッセージを読み込めませんでした。AnjuPayストアは利用できます。");
    }
  }
  if (state.leaderboardPublic) {
    try {
      await syncLeaderboardEntry();
    } catch (error) {
      console.error(error);
      showToast("ランキング情報を更新できませんでした。");
    }
  } else {
    loadServerRankingAwards().catch((error) => console.error(error));
  }
  setOnlineChrome("ONLINE READY");
  render();
  if (state.screen === "achievements") {
    loadAchievements({ syncPublic: true }).catch(() => showToast("実績情報を更新できませんでした。"));
  }
}

async function initializeEconomy() {
  const dateKey = currentDailyDateKey();
  const response = await economyActionCallable({ action: "initialize" });
  const snapshot = await get(ref(database, `online/economy/${state.uid}`));
  state.economy = normalizeEconomyRecord(snapshot.val(), dateKey);
  state.economy.points = Math.min(MAX_POINTS, Math.max(0, Number(response.data?.balance || 0)));
  applyDailyPlayRewardState(response.data?.dailyPlay);
  applyAchievementPayload(response.data?.achievements, { notifyPending: true });
  state.economyReady = true;
  if (state.dailyPlay.pendingCount > 0) {
    try {
      await settleDailyPlayRewards(state.uid, { announce: true, renderAfter: false });
    } catch (error) {
      console.error(error);
      showToast("デイリープレイ報酬を自動受取できませんでした。ミッション画面から再確認できます。");
    }
  }
}

function notifyAchievementUnlocks(idsValue) {
  const ids = (window.HariaiAchievements?.normalizeIds?.(idsValue) || [])
    .filter((id) => !state.notifiedAchievementIds.has(id));
  if (!ids.length) return;
  ids.forEach((id) => state.notifiedAchievementIds.add(id));
  window.dispatchEvent(new CustomEvent("hariai-achievements-unlocked", { detail: { ids } }));
  economyActionCallable({ action: "ack_achievements", achievementIds: ids }).catch(() => {
    ids.forEach((id) => state.notifiedAchievementIds.delete(id));
  });
}

function applyAchievementPayload(value, { notifyPending = false } = {}) {
  if (!value || typeof value !== "object") return;
  const profile = window.HariaiAchievements?.normalizeProfile?.(value) || value;
  state.achievements = profile;
  state.achievementsReady = true;
  if (notifyPending) notifyAchievementUnlocks(profile.pendingUnlocks);
}

async function loadAchievements({ syncPublic = true, renderAfter = true } = {}) {
  if (!state.uid || state.achievementsBusy) return state.achievements;
  state.achievementsBusy = true;
  if (renderAfter && state.screen === "achievements") render();
  try {
    const response = await economyActionCallable({
      action: "get_achievements",
      syncPublic,
    });
    applyAchievementPayload(response.data, { notifyPending: true });
    return state.achievements;
  } finally {
    state.achievementsBusy = false;
    if (renderAfter && state.screen === "achievements") render();
  }
}

async function saveAchievementShowcase(idsValue) {
  if (!state.uid || state.achievementsBusy) return;
  state.achievementsBusy = true;
  render();
  try {
    const response = await economyActionCallable({
      action: "set_achievement_showcase",
      achievementIds: idsValue,
    });
    if (response.data?.saved !== true) throw new Error("実績ショーケースの保存を確認できませんでした。");
    applyAchievementPayload(response.data?.achievements);
    showToast("ランキングの実績ショーケースを更新しました。");
  } catch (error) {
    showToast(error?.message || "実績ショーケースを更新できませんでした。");
  } finally {
    state.achievementsBusy = false;
    render();
  }
}

function normalizeOwnTopMessage(value) {
  if (!value || typeof value !== "object") return null;
  const text = String(value.text || "").trim().slice(0, TOP_MESSAGE_MAX_LENGTH);
  if (!text) return null;
  return {
    name: String(value.name || "").trim().slice(0, 16),
    titleId: String(value.titleId || ""),
    text,
    updatedAt: Number(value.updatedAt || 0),
  };
}

async function loadOwnTopMessage() {
  if (!state.uid || !state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID]) {
    state.topMessage = null;
    state.topMessageEntryId = "";
    state.topMessageReady = true;
    return;
  }
  const entrySnapshot = await get(ref(database, `online/topMessageEntriesByUser/${state.uid}`));
  const entryId = validLeaderboardEntryId(entrySnapshot.val());
  state.topMessageEntryId = entryId;
  if (!entryId) {
    state.topMessage = null;
    state.topMessageReady = true;
    return;
  }
  const snapshot = await get(ref(database, `online/topMessages/${entryId}`));
  state.topMessage = snapshot.exists() ? normalizeOwnTopMessage(snapshot.val()) : null;
  state.topMessageReady = true;
}

async function ensureTopMessageEntryId() {
  if (state.topMessageEntryId) return state.topMessageEntryId;
  const indexRef = ref(database, `online/topMessageEntriesByUser/${state.uid}`);
  const existing = validLeaderboardEntryId((await get(indexRef)).val());
  if (existing) {
    state.topMessageEntryId = existing;
    return existing;
  }
  const entryId = push(ref(database, "online/topMessages")).key;
  if (!validLeaderboardEntryId(entryId)) throw new Error("投稿枠を準備できませんでした。");
  await set(ref(database, `online/topMessageOwners/${entryId}`), state.uid);
  const result = await runTransaction(indexRef, (current) => current || entryId);
  if (!result.committed || !result.snapshot.exists()) throw new Error("投稿枠を保存できませんでした。");
  const savedEntryId = validLeaderboardEntryId(result.snapshot.val());
  if (!savedEntryId) throw new Error("投稿枠を確認できませんでした。");
  state.topMessageEntryId = savedEntryId;
  return savedEntryId;
}

function validateTopMessageText(value) {
  const text = String(value || "").trim();
  if (!text || text.length > TOP_MESSAGE_MAX_LENGTH || /[\r\n]/.test(text)) {
    throw new Error(`メッセージは1行${TOP_MESSAGE_MAX_LENGTH}文字以内で入力してください。`);
  }
  if (RANKING_COMMENT_URL_PATTERN.test(text)) throw new Error("メッセージにURLは入力できません。");
  return text;
}

async function saveTopMessage(nameValue, textValue) {
  if (!state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID]) throw new Error("先にトップメッセージ枠を購入してください。");
  if (state.topMessageBusy) return;
  const name = String(nameValue || "").trim().slice(0, 16);
  const text = validateTopMessageText(textValue);
  if (!name) throw new Error("表示名を入力してください。");
  state.topMessageBusy = true;
  render();
  try {
    const entryId = await ensureTopMessageEntryId();
    const record = {
      name,
      titleId: getTitleProduct()?.id || "",
      text,
      updatedAt: serverTimestamp(),
    };
    await set(ref(database, `online/topMessages/${entryId}`), record);
    state.name = name;
    localStorage.setItem(PROFILE_NAME_KEY, name);
    state.topMessage = { ...record, updatedAt: serverNow() };
    state.topMessageReady = true;
    await refreshTopMessages({ silent: true });
    showToast("トップメッセージを公開しました。");
  } finally {
    state.topMessageBusy = false;
    render();
  }
}

async function deleteTopMessage() {
  if (!state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] || state.topMessageBusy || !state.topMessage) return;
  state.topMessageBusy = true;
  render();
  try {
    const entryId = state.topMessageEntryId || validLeaderboardEntryId((await get(ref(database, `online/topMessageEntriesByUser/${state.uid}`))).val());
    if (entryId) await remove(ref(database, `online/topMessages/${entryId}`));
    state.topMessage = null;
    state.topMessageReady = true;
    await refreshTopMessages({ silent: true });
    showToast("トップメッセージを非公開にしました。");
  } finally {
    state.topMessageBusy = false;
    render();
  }
}

function setOnlineChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "P2P画像転送";
  if (footerItems[0]) footerItems[0].textContent = "ONLINE 1ON1 / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "画像本体は対戦相手へ直接送信し、サーバーへ保存しません";
}

function render() {
  if (!active) return;
  const renderers = {
    setup: renderSetup,
    missions: renderDailyMissions,
    shop: renderPointShop,
    achievements: renderAchievements,
    matching: renderMatching,
    connecting: renderConnecting,
    select: renderRoundSelect,
    waitingPick: renderWaitingPick,
    waitingImage: renderWaitingImage,
    reveal: renderReveal,
    score: renderScore,
    waitingScore: renderWaitingScore,
    result: renderRoundResult,
    waitingContinue: renderWaitingContinue,
    gameover: renderGameOver,
    noContest: renderNoContest,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderSetup)();
  bindScreenEvents();
  appRoot.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSetup() {
  const sampleCount = getDeckSampleCount();
  const realImageCount = state.deck.length - sampleCount;
  const startingHp = getStartingHp(sampleCount);
  const preferenceOptions = IMAGE_PREFERENCE_OPTIONS.map((option) => `
    <label class="image-preference-option">
      <input type="radio" name="onlineImagePreference" value="${option.id}" ${state.imagePreference === option.id ? "checked" : ""} />
      <span class="image-preference-card">
        <strong>${escapeHtml(option.label)}</strong>
        <small>${escapeHtml(option.description)}</small>
      </span>
    </label>`).join("");
  const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const item = state.deck[index];
    if (!item) return `<div class="deck-slot empty" aria-label="空きスロット ${index + 1}">${String(index + 1).padStart(2, "0")}</div>`;
    const isSignature = item.id === state.signatureCardId;
    return `<div class="deck-slot ${item.isSample ? "sample-card" : ""} ${isSignature ? "signature-card" : ""}">
      <img src="${item.url}" alt="選択画像 ${index + 1}" draggable="false" />
      ${item.isSample ? '<span class="sample-card-badge">SAMPLE / HP−5</span>' : ""}
      <button class="signature-card-toggle ${isSignature ? "is-selected" : ""}" type="button"
        data-online-signature-card="${escapeHtml(item.id)}" aria-pressed="${isSignature}"
        aria-label="画像${index + 1}をシグネチャーカード${isSignature ? "から外す" : "に指定"}"><span aria-hidden="true">✦</span>${isSignature ? "SIGNATURE" : "切り札に指定"}</button>
      <div class="deck-label"><span>${item.isSample ? "SAMPLE" : "ENTRY"} ${String(index + 1).padStart(2, "0")}</span>
        <button class="remove-card" data-online-remove="${escapeHtml(item.id)}" aria-label="画像${index + 1}を削除">×</button>
      </div>
    </div>`;
  }).join("");
  const ready = isMatchmakingSetupReady();
  const profile = state.profile;
  return `<section class="screen">
    <div class="section-head">
      <div><span class="eyebrow">ONLINE DECK SETUP</span><h1>オンライン対戦の準備</h1>
        <p>画像を5枚選び、評価の好みが近いプレイヤーを優先して対戦します。</p></div>
      <button class="button button-ghost button-small" id="onlineBackHome">タイトルへ</button>
    </div>
    <div class="online-profile-strip">
      <span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      ${renderTitleBadge()}
      <span>RATE ${Number(profile.rating || INITIAL_RATING)}</span>
      <span>戦績 ${profile.wins}勝 ${profile.losses}敗 ${profile.draws}分</span>
      <span>🔥 ${profile.streak}連勝中 / 最高${profile.bestStreak}</span>
      <span class="point-balance-inline">AnjuPay ◆ ${formatAnjuPay(state.economyReady ? state.economy.points : null)}</span>
    </div>
    ${renderOverallRankingParticipation({ controlId: "soloOverallRanking" })}
    <div class="setup-layout">
      <aside class="setup-guide">
        <h2>オンライン画像の取り扱い</h2>
        <ol class="guide-list">
          <li><b>1</b><span>最大1600pxのWebPに変換し、EXIFなどの付随情報を除去します。</span></li>
          <li><b>2</b><span>画像はWebRTCで対戦相手へ直接送信し、Firebaseには保存しません。</span></li>
          <li><b>3</b><span>同じモード内の再戦ではデッキを保持し、タイトル復帰・ページ終了時に画像参照を解放します。</span></li>
        </ol>
        <div class="privacy-note sample-handicap-note">サンプル画像1枚につき、通常型1on1の最大HPが5減少します。</div>
        <div class="privacy-note">スクリーンショットなど、相手側での保存を完全に防ぐことはできません。</div>
      </aside>
      <div class="setup-panel">
        <label class="field-label">表示名
          <input class="text-input" id="onlinePlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" />
        </label>
        ${shared()?.profileAvatar?.renderSetting?.({ controlId: "soloProfileAvatar", name: state.name }) || ""}
        <div class="pursuit-line-settings online-pursuit-line-settings">
          <label class="field-label">追撃時のセリフ
            <select class="text-input" id="onlinePursuitLineChoice">
              ${PURSUIT_LINES.map((line) => `<option value="${escapeHtml(line)}" ${state.pursuitLineChoice === line ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}
              <option value="${CUSTOM_PURSUIT_VALUE}" ${state.pursuitLineChoice === CUSTOM_PURSUIT_VALUE ? "selected" : ""}>自由記述</option>
            </select>
          </label>
          <div class="pursuit-custom-field" id="onlineCustomPursuitField" ${state.pursuitLineChoice === CUSTOM_PURSUIT_VALUE ? "" : "hidden"}>
            <label class="field-label">自由記述（1行・最大${MAX_PURSUIT_LINE_LENGTH}文字）
              <input class="text-input" id="onlineCustomPursuitLine" maxlength="${MAX_PURSUIT_LINE_LENGTH}" autocomplete="off" placeholder="追撃時に表示するセリフ" value="${escapeHtml(state.customPursuitLine)}" />
            </label>
            <span class="pursuit-character-count"><b id="onlinePursuitCharacterCount">${state.customPursuitLine.length}</b> / ${MAX_PURSUIT_LINE_LENGTH}</span>
          </div>
          <p class="pursuit-line-note">9〜10点を受けたラウンド結果で表示します。空白時は定型文へ戻り、HTMLは実行されません。</p>
        </div>
        <div class="finish-line-settings">
          <div class="finish-line-heading"><span>SIGNATURE FINISH</span><strong>決着時のセリフ</strong></div>
          <label class="field-label">HPを0にした時のセリフ
            <select class="text-input" id="onlineFinishLineChoice">
              ${FINISH_LINES.map((line) => `<option value="${escapeHtml(line)}" ${state.finishLineChoice === line ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}
              <option value="${CUSTOM_FINISH_VALUE}" ${state.finishLineChoice === CUSTOM_FINISH_VALUE ? "selected" : ""}>自由記述</option>
              <option value="${FINISH_LINE_DISABLED_VALUE}" ${state.finishLineChoice === FINISH_LINE_DISABLED_VALUE ? "selected" : ""}>セリフなし（画像演出のみ）</option>
            </select>
          </label>
          <div class="pursuit-custom-field" id="onlineCustomFinishField" ${state.finishLineChoice === CUSTOM_FINISH_VALUE ? "" : "hidden"}>
            <label class="field-label">自由記述（1行・最大${MAX_FINISH_LINE_LENGTH}文字）
              <input class="text-input" id="onlineCustomFinishLine" maxlength="${MAX_FINISH_LINE_LENGTH}" autocomplete="off" placeholder="決着時に表示するセリフ" value="${escapeHtml(state.customFinishLine)}" />
            </label>
            <span class="pursuit-character-count finish-character-count"><b id="onlineFinishCharacterCount">${state.customFinishLine.length}</b> / ${MAX_FINISH_LINE_LENGTH}</span>
          </div>
          <label class="finish-visibility-toggle">
            <input id="onlineShowOpponentCustomFinish" type="checkbox" ${state.showOpponentCustomFinish ? "checked" : ""} />
            <span>相手が自由記述したフィニッシュセリフを表示する</span>
          </label>
          <p class="pursuit-line-note">実際にHPを0にした画像へ合成表示します。自由記述を非表示にした場合、相手の定型外セリフだけ安全な定型文へ置き換えます。</p>
        </div>
        <fieldset class="image-preference-settings">
          <legend>高く評価しやすい画像 <span>マッチング優先条件</span></legend>
          <p>今回の通常型1on1で、相手から見せてもらいたい画像の傾向を選んでください。</p>
          <div class="image-preference-grid">${preferenceOptions}</div>
          <small>同じ傾向、または「どちらも歓迎」の相手を優先します。この選択は対戦画面には表示されません。</small>
        </fieldset>
        <div class="deck-toolbar">
          <div class="deck-counter"><strong>${state.deck.length}</strong> / 5 IMAGES</div>
          <div class="upload-actions">
            <label class="button button-cyan button-small file-button">画像を追加
              <input id="onlineImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${state.deck.length >= MAX_ROUNDS ? "disabled" : ""} />
            </label>
            <button class="button button-ghost button-small" id="onlineFillSample">不足分をサンプルで埋める（HP減少）</button>
          </div>
        </div>
        <div class="deck-handicap-summary ${sampleCount ? "has-handicap" : ""}" aria-live="polite">
          <span>実画像 <strong>${realImageCount}</strong>枚</span><span>サンプル <strong>${sampleCount}</strong>枚</span>
          <span>開始HP <strong>${startingHp}</strong> / ${startingHp}</span>${sampleCount ? `<small>HP−${sampleCount * SAMPLE_HP_PENALTY}</small>` : ""}
        </div>
        <div class="signature-card-guide ${state.signatureCardId ? "is-selected" : ""}">
          <span aria-hidden="true">✦</span>
          <p><strong>${state.signatureCardId ? "シグネチャーカード指定済み" : "シグネチャーカードは未指定"}</strong>
            <small>任意の1枚を指定できます。その画像でHPを0にすると、専用の強化演出になります。</small></p>
        </div>
        <div class="deck-grid">${slots}</div>
        <div class="setup-actions">
          <button class="button button-primary" id="findOpponent" ${ready ? "" : "disabled"}>好みの近い対戦相手を探す</button>
        </div>
      </div>
    </div>
  </section>`;
}

function getMissionProgress(mission) {
  return Math.min(mission.target, Number(state.economy.daily?.[mission.progressKey] || 0));
}

function renderMissionCard(mission, compact = false) {
  const progress = getMissionProgress(mission);
  const claimed = state.economy.daily?.claimed?.[mission.id] === true;
  const complete = progress >= mission.target;
  const buttonLabel = claimed ? "受取済み" : complete ? `${formatAnjuPay(mission.reward, { sign: true })}を受け取る` : "挑戦中";
  return `<article class="mission-card ${complete ? "is-complete" : ""} ${claimed ? "is-claimed" : ""}">
    <div class="mission-card-head"><span>${claimed ? "CLEAR" : complete ? "COMPLETE" : "DAILY"}</span><strong>${formatAnjuPay(mission.reward, { sign: true })}</strong></div>
    <h2>${escapeHtml(mission.title)}</h2>${compact ? "" : `<p>${escapeHtml(mission.description)}</p>`}
    <div class="mission-progress"><i style="--mission-progress:${(progress / mission.target) * 100}%"></i></div>
    <div class="mission-card-foot"><span>${progress} / ${mission.target}</span>
      <button class="button button-small ${complete && !claimed ? "button-cyan" : "button-ghost"}" data-claim-mission="${mission.id}" ${!state.economyReady || state.economyBusy || !complete || claimed ? "disabled" : ""}>${buttonLabel}</button></div>
  </article>`;
}

function renderEconomyUnavailable() {
  return `<div class="economy-unavailable"><strong>${state.authReady ? "AnjuPay情報を読み込めませんでした" : "Firebaseへ接続しています…"}</strong>
    <p>${state.authReady ? "時間をおいて画面を開き直してください。対戦機能は通常どおり利用できます。" : "匿名ログイン後にミッションとAnjuPay残高を表示します。"}</p></div>`;
}

function renderDailyPlayRewardPanel() {
  if (!state.economyReady || !state.dailyPlay?.tiers?.length) return "";
  const dailyPlay = state.dailyPlay;
  const reachedMaximum = dailyPlay.matches >= dailyPlay.maxMatches;
  const nextTarget = dailyPlay.nextTarget || dailyPlay.maxMatches;
  const previousTarget = reachedMaximum
    ? 0
    : Math.min(nextTarget, Math.max(0, dailyPlay.previousTarget || 0));
  const intervalMaximum = reachedMaximum
    ? dailyPlay.maxMatches
    : Math.max(previousTarget + 1, nextTarget);
  const intervalValue = Math.min(intervalMaximum, Math.max(previousTarget, dailyPlay.matches));
  const intervalProgress = dailyPlay.nextTarget
    ? ((intervalValue - previousTarget) / Math.max(1, intervalMaximum - previousTarget)) * 100
    : 100;
  const status = dailyPlay.matches >= dailyPlay.maxMatches
    ? "本日の上限達成"
    : dailyPlay.basicComplete
      ? `基本ボーナス達成・あと${dailyPlay.nextTarget - dailyPlay.matches}戦で ${formatAnjuPay(dailyPlay.nextReward, { sign: true })}`
      : `あと${dailyPlay.nextTarget - dailyPlay.matches}戦で ${formatAnjuPay(dailyPlay.nextReward, { sign: true })}`;
  const statusDetail = dailyPlay.matches >= dailyPlay.maxMatches
    ? "今日はここまで。以降の正式完走は報酬回数へ加算されません。"
    : dailyPlay.basicComplete
      ? "10戦以降は、もっと遊びたい人向けの追加ボーナスです。"
      : `${dailyPlay.basicTarget}戦で本日の基本ボーナスが完了します。`;
  const tiers = dailyPlay.tiers.map((tier) => {
    const tierStatus = tier.claimed ? "受取済み" : tier.complete ? "受取可能" : "未達成";
    return `<li class="${tier.complete ? "is-complete" : ""} ${tier.claimed ? "is-claimed" : ""}">
      <span>${tier.target}戦</span><strong>${formatAnjuPay(tier.reward, { sign: true })}</strong><small>${tierStatus}</small>
    </li>`;
  }).join("");
  const pendingLabel = dailyPlay.pendingCount > 0
    ? `未受取 ${formatAnjuPay(dailyPlay.pendingPoints)}`
    : "達成分は自動受取済み";
  return `<section class="daily-play-reward-panel" aria-labelledby="dailyPlayRewardTitle">
    <div class="daily-play-reward-head">
      <div><span class="eyebrow">DAILY PLAY BONUS</span><h2 id="dailyPlayRewardTitle">今日の正式完走 <strong>${dailyPlay.matches}戦</strong></h2>
        <p>${escapeHtml(status)}</p></div>
      <div class="daily-play-reward-claim ${dailyPlay.pendingCount ? "has-reward" : ""}">
        <span>${escapeHtml(pendingLabel)}</span>
        <button class="button button-small ${dailyPlay.pendingCount ? "button-primary" : "button-ghost"}" id="claimDailyPlayRewardsButton" ${state.economyBusy || !dailyPlay.pendingCount ? "disabled" : ""}>${state.economyBusy ? "確認中…" : dailyPlay.pendingCount ? "まとめて受け取る" : "受取済み"}</button>
      </div>
    </div>
    <div class="daily-play-reward-progress" role="progressbar" aria-label="次のデイリープレイ報酬までの進捗" aria-valuemin="${previousTarget}" aria-valuemax="${intervalMaximum}" aria-valuenow="${intervalValue}" aria-valuetext="${dailyPlay.matches}戦完走、${escapeHtml(status)}">
      <i style="--daily-play-progress:${Math.max(0, Math.min(100, intervalProgress))}%"></i>
    </div>
    <p class="daily-play-reward-copy">${escapeHtml(statusDetail)}</p>
    <details class="daily-play-reward-details"><summary>全${dailyPlay.tiers.length}段階を見る</summary><ol>${tiers}</ol></details>
    <p class="daily-play-reward-note">勝敗を問わず、4モードのサーバー検証済み完走が対象です。未受取分は達成日の終了後${dailyPlay.graceDays}日間まとめて受け取れます。</p>
  </section>`;
}

function renderPeriodRewardPanel() {
  if (!state.economyReady) return "";
  const pending = pendingPeriodRewardSummary();
  const periodCards = LEADERBOARD_PERIODS.map((period) => {
    const config = PERIOD_REWARD_CONFIG[period];
    const info = leaderboardPeriodInfoFor(period, serverNow());
    const record = normalizePeriodRewardRecord(state.economy.periodRewards?.[period]?.[info.key], period, info.key) || {
      matches: 0,
      points: 0,
    };
    const remainingMatches = Math.max(0, config.minimumMatches - record.matches);
    const estimatedReward = calculatePeriodReward(period, record);
    const status = remainingMatches > 0
      ? `あと${remainingMatches}試合で ${formatAnjuPay(config.tiers.at(-1).reward)}`
      : `見込み ${formatAnjuPay(estimatedReward)}`;
    const periodCopy = period === "daily" ? "今日" : period === "weekly" ? "今週" : "今月";
    return `<article class="period-reward-card period-reward-${period}">
      <div><span>${escapeHtml(config.label)}</span><strong>${escapeHtml(status)}</strong></div>
      <p>${periodCopy} ${record.matches}試合 / 戦績スコア ${record.points}</p>
      <small>${escapeHtml(info.label)}・終了後に受取可能</small>
    </article>`;
  }).join("");
  return `<section class="period-reward-panel" aria-labelledby="periodRewardTitle">
    <div class="period-reward-head"><div><span class="eyebrow">PERIOD BATTLE REWARDS</span><h2 id="periodRewardTitle">期間戦績報酬</h2>
      <p>好きなモードで正式対戦を完走すると、自動で3期間へ蓄積されます。</p></div>
      <div class="period-reward-claim ${pending.total ? "has-reward" : ""}"><span>${pending.total ? `${pending.entries.length}期間分` : "受取待ち"}</span>
        <strong>${formatAnjuPay(pending.total)}</strong>
        <button class="button button-small ${pending.total ? "button-primary" : "button-ghost"}" id="claimPeriodRewardsButton" ${!pending.total || state.economyBusy ? "disabled" : ""}>${state.economyBusy ? "精算中…" : pending.total ? "まとめて受け取る" : "期間終了後に受取"}</button></div></div>
    <div class="period-reward-grid">${periodCards}</div>
    <p class="period-reward-note">勝利3・引き分け1の戦績スコアで報酬額が上がります。負けても必要試合数を満たせば基本報酬を獲得できます。ランキング公開設定は不要です。</p>
  </section>`;
}

function renderDailyMissions() {
  const missions = dailyMissionsForDate(currentDailyDateKey());
  const missionContent = state.economyReady
    ? `<div class="mission-grid">${missions.map((mission) => renderMissionCard(mission)).join("")}</div>`
    : renderEconomyUnavailable();
  return `<section class="screen economy-screen">
    <div class="section-head"><div><span class="eyebrow">DAILY CHALLENGE</span><h1>デイリーミッション</h1>
      <p>毎日0:00（日本時間）に更新。達成した報酬はボタンで受け取ってください。</p></div>
      <button class="button button-ghost button-small" id="economyHomeButton">タイトルへ</button></div>
    <div class="economy-balance"><span>ANJUPAY BALANCE</span><strong>${formatAnjuPayNumber(state.economyReady ? state.economy.points : null)}</strong><small>${ANJU_PAY_UNIT}</small></div>
    ${renderDailyPlayRewardPanel()}
    ${renderPeriodRewardPanel()}
    ${missionContent}
    <div class="economy-actions"><button class="button button-primary" id="missionsShopButton">AnjuPayストアへ</button>
      <button class="button button-ghost" id="missionsBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">AnjuPay残高と進捗は匿名アカウントに保存されます。サイトデータを削除すると引き継げません。</p>
  </section>`;
}

function renderAchievements() {
  const content = state.achievementsReady
    ? window.HariaiAchievements?.renderCollection?.(state.achievements)
    : `<div class="economy-unavailable"><strong>実績情報を読み込んでいます…</strong><p>匿名アカウントの検証済み記録を確認しています。</p></div>`;
  return `<section class="screen achievement-screen">
    <div class="section-head"><div><span class="eyebrow">ACHIEVEMENT COLLECTION</span><h1>実績コレクション</h1>
      <p>勝利・連勝・RATEではなく、遊んだ回数、モード回遊、敗北、市場での成立取引を記録します。</p></div>
      <button class="button button-ghost button-small" id="achievementHomeButton">タイトルへ</button></div>
    <div class="achievement-policy">
      <span>条件は解除まで非公開</span><span>AnjuPay報酬なし</span><span>ランキング展示は最大3件</span>
    </div>
    ${state.achievementsBusy ? `<div class="achievement-loading">実績情報を更新しています…</div>` : ""}
    ${content || `<div class="economy-unavailable"><strong>実績表示を準備できませんでした</strong><p>ページを読み直してお試しください。</p></div>`}
    <div class="economy-actions"><button class="button button-ghost" id="achievementRefreshButton" ${state.achievementsBusy ? "disabled" : ""}>実績を再読み込み</button>
      <button class="button button-primary" id="achievementBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">対戦実績はFunctionsが参加人数・完走・双方の結果を確認した試合だけ、市場実績は同じ相手との1日最初の成立取引だけを数えます。</p>
  </section>`;
}

function renderPointShop() {
  const equippedReactionCount = getEquippedReactionProducts().length;
  const equippedStampCount = getEquippedStampProducts().length;
  const equippedChatCosmetics = getEquippedChatCosmetics(state.economy);
  const topMessageOwned = state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] === true;
  const topMessageLabel = state.topMessage ? "公開中" : topMessageOwned ? "投稿できます" : "未購入";
  const standardTitleCategories = PLAYER_TITLE_CATEGORIES.filter((category) => category.collection !== OSHI_MARKET_COLLECTION_ID);
  const standardTitleProducts = PLAYER_TITLE_PRODUCTS.filter((product) => product.collection !== OSHI_MARKET_COLLECTION_ID);
  const renderProduct = (product) => {
    const owned = state.economy.inventory?.[product.id] === true;
    const affordable = state.economy.points >= product.price;
    const equipped = product.type === "reaction" || product.type === "stamp"
      ? state.economy.equipped?.[product.type === "stamp" ? "stamps" : "reactions"]?.[product.id] === true
      : product.type === "title"
        ? state.economy.equipped?.title === product.id
        : product.type === "chatFrame"
          ? equippedChatCosmetics.chatFrameId === product.id
          : product.type === "chatBackground" && equippedChatCosmetics.chatBackgroundId === product.id;
    const equipLimit = product.type === "stamp" ? MAX_EQUIPPED_STAMPS : MAX_EQUIPPED_REACTIONS;
    const equippedCount = product.type === "stamp" ? equippedStampCount : equippedReactionCount;
    const equipDisabled = !equipped && (product.type === "reaction" || product.type === "stamp") && equippedCount >= equipLimit;
    const previewFrameId = product.type === "chatFrame" ? product.id : equippedChatCosmetics.chatFrameId;
    const previewBackgroundId = product.type === "chatBackground" ? product.id : equippedChatCosmetics.chatBackgroundId;
    const previewClasses = chatCosmeticClassNames(previewFrameId, previewBackgroundId);
    const titlePresentation = product.type === "title" ? getPlayerTitlePresentation(product.id) : null;
    const preview = product.type === "reaction"
      ? `<button class="reaction-button shop-reaction-preview" data-preview-reaction="${escapeHtml(product.reaction)}">${escapeHtml(product.reaction)}</button>`
      : product.type === "stamp"
        ? `<div class="shop-stamp-preview"><img src="${escapeHtml(product.asset)}" alt="${escapeHtml(product.label)}" /><span>${escapeHtml(product.label)}</span></div>`
      : product.type === "title"
        ? `<span class="player-title-badge shop-title-preview ${titlePresentation?.className || ""}"><span aria-hidden="true">${escapeHtml(titlePresentation?.icon || "◆")}</span>${escapeHtml(product.title)}</span>`
        : product.type === "chatFrame" || product.type === "chatBackground"
          ? `<div class="shop-chat-cosmetic-preview"><span>YOU / R1</span><p class="${previewClasses}">次の一枚も楽しみ！</p></div>`
          : `<div class="shop-message-preview"><span>♡ COMMUNITY MESSAGE</span><strong>トップページにひとこと</strong></div>`;
    let action = `<button class="button button-wide button-primary" data-buy-product="${product.id}" ${useOfflineMarketPreview || !state.economyReady || state.economyBusy || !affordable ? "disabled" : ""}>${affordable ? `${formatAnjuPay(product.price)}で購入` : `あと${formatAnjuPay(product.price - state.economy.points)}`}</button>`;
    if (owned && product.type === "feature") {
      action = `<button class="button button-wide button-cyan" data-edit-top-message ${state.topMessageBusy ? "disabled" : ""}>${state.topMessage ? "メッセージを編集" : "メッセージを投稿"}</button>`;
    } else if (owned) {
      action = `<button class="button button-wide ${equipped ? "button-cyan" : "button-ghost"}" data-equip-product="${product.id}" ${useOfflineMarketPreview || !state.economyReady || state.economyBusy || equipDisabled ? "disabled" : ""}>${equipped ? "装備を外す" : equipDisabled ? `装備枠 ${equipLimit}/${equipLimit}` : "装備する"}</button>`;
    }
    const productTypeLabel = product.type === "reaction" ? "CHAT REACTION"
      : product.type === "stamp" ? "CHAT STAMP"
      : product.type === "title" ? (getPlayerTitleCategory(product.category)?.eyebrow || "PLAYER TITLE")
        : product.type === "chatFrame" ? (product.special ? "SPECIAL CHAT FRAME" : "CHAT FRAME")
          : product.type === "chatBackground" ? "CHAT BACKGROUND" : "TOP MESSAGE ACCESS";
    return `<article class="shop-card ${owned ? "is-owned" : ""} ${equipped ? "is-equipped" : ""}">
      <div class="shop-card-top"><span>${equipped ? "EQUIPPED" : owned ? "OWNED" : productTypeLabel}</span><strong>${formatAnjuPay(product.price)}</strong></div>
      <h2>${escapeHtml(product.name)}</h2>${preview}
      <p>${escapeHtml(product.description)}</p>
      ${action}
    </article>`;
  };
  const featureProducts = SHOP_PRODUCTS.filter((product) => product.type === "feature").map(renderProduct).join("");
  const reactionProducts = SHOP_PRODUCTS.filter((product) => product.type === "reaction").map(renderProduct).join("");
  const stampProducts = SHOP_PRODUCTS.filter((product) => product.type === "stamp").map(renderProduct).join("");
  const shopProductById = new Map(SHOP_PRODUCTS.map((product) => [product.id, product]));
  const oshiMarketCollectionGroups = OSHI_MARKET_COLLECTION_GROUPS.map((group) => {
    const products = group.productIds.map((productId) => shopProductById.get(productId)).filter(Boolean);
    return `<section class="shop-oshi-market-group" aria-labelledby="shopOshiMarketGroup-${group.id}">
      <div class="shop-oshi-market-group-head">
        <div><span>${escapeHtml(group.eyebrow)}</span><h3 id="shopOshiMarketGroup-${group.id}">${escapeHtml(group.title)}</h3></div>
        <p>${escapeHtml(group.description)}</p>
      </div>
      <div class="shop-grid">${products.map(renderProduct).join("")}</div>
    </section>`;
  }).join("");
  const selectedTitleCategory = state.titleCategoryFilter === "all" || standardTitleCategories.some((category) => category.id === state.titleCategoryFilter)
    ? state.titleCategoryFilter
    : "all";
  const titleCategoryFilters = [
    { id: "all", label: `すべて ${standardTitleProducts.length}` },
    ...standardTitleCategories.map((category) => ({
      id: category.id,
      label: `${category.icon} ${category.label} ${standardTitleProducts.filter((product) => product.category === category.id).length}`,
    })),
  ].map((filter) => `<button class="shop-title-filter ${selectedTitleCategory === filter.id ? "active" : ""}" type="button" data-title-category-filter="${filter.id}" aria-pressed="${selectedTitleCategory === filter.id}">${escapeHtml(filter.label)}</button>`).join("");
  const titleGroups = standardTitleCategories
    .map((category) => {
      const categoryProducts = standardTitleProducts.filter((product) => product.category === category.id);
      const open = selectedTitleCategory === category.id || state.expandedTitleCategories.has(category.id);
      const hidden = selectedTitleCategory !== "all" && selectedTitleCategory !== category.id;
      return `<details class="shop-title-group ${category.className}" data-title-category-group="${category.id}" ${open ? "open" : ""} ${hidden ? "hidden" : ""}>
        <summary><span class="shop-title-group-icon" aria-hidden="true">${escapeHtml(category.icon)}</span><span><small>${escapeHtml(category.eyebrow)} / ${categoryProducts.length} TITLES</small><strong>${escapeHtml(category.label)}</strong><em>${escapeHtml(category.description)}</em></span><b>＋</b></summary>
        <div class="shop-grid">${categoryProducts.map(renderProduct).join("")}</div>
      </details>`;
    }).join("");
  const chatBackgroundProducts = CHAT_BACKGROUND_PRODUCTS.map(renderProduct).join("");
  const chatFrameProducts = CHAT_STANDARD_FRAME_PRODUCTS.map(renderProduct).join("");
  const specialChatFrameProducts = CHAT_SPECIAL_FRAME_PRODUCTS.map(renderProduct).join("");
  const topMessageComposer = topMessageOwned ? `<section class="top-message-composer" id="topMessageComposer">
    <div class="shop-category-head"><div><span>YOUR COMMUNITY MESSAGE</span><h2>${state.topMessage ? "トップメッセージを編集" : "トップメッセージを投稿"}</h2></div><p>トップページで表示名・装備中の称号と一緒に公開されます。</p></div>
    ${state.topMessageReady ? `<form id="topMessageForm">
      <label for="topMessageName">表示名</label>
      <input id="topMessageName" type="text" maxlength="16" required value="${escapeHtml(state.topMessage?.name || state.name)}" placeholder="PLAYER" autocomplete="nickname" />
      <label for="topMessageText">メッセージ</label>
      <textarea id="topMessageText" maxlength="${TOP_MESSAGE_MAX_LENGTH}" rows="2" required placeholder="対戦相手募集中！">${escapeHtml(state.topMessage?.text || "")}</textarea>
      <div class="top-message-composer-foot"><small>1行${TOP_MESSAGE_MAX_LENGTH}文字以内。URL・連絡先・個人情報は投稿しないでください。</small><span><b id="topMessageLength">${String(state.topMessage?.text || "").length}</b> / ${TOP_MESSAGE_MAX_LENGTH}</span></div>
      <div class="top-message-composer-actions"><button class="button button-primary" type="submit" ${state.topMessageBusy ? "disabled" : ""}>${state.topMessage ? "更新して公開" : "トップページに公開"}</button>
        ${state.topMessage ? `<button class="button button-ghost" id="deleteTopMessage" type="button" ${state.topMessageBusy ? "disabled" : ""}>非公開にする</button>` : ""}</div>
    </form>` : `<p class="economy-note">トップメッセージを読み込めませんでした。ページを開き直してお試しください。</p>`}
  </section>` : "";
  return `<section class="screen economy-screen">
    <div class="section-head"><div><span class="eyebrow">ANJUPAY STORE</span><h1>AnjuPayストア</h1>
      <p>チャット装飾、トップメッセージ、リアクション、スタンプ、称号で交流をカスタマイズできます。</p></div>
      <button class="button button-ghost button-small" id="economyHomeButton">タイトルへ</button></div>
    <div class="economy-balance"><span>ANJUPAY BALANCE</span><strong>${formatAnjuPayNumber(state.economyReady ? state.economy.points : null)}</strong><small>${ANJU_PAY_UNIT}</small></div>
    ${state.economyReady ? `<div class="shop-loadout-summary"><span>トップメッセージ <strong>${topMessageLabel}</strong></span><span>リアクション装備 <strong>${equippedReactionCount} / ${MAX_EQUIPPED_REACTIONS}</strong></span><span>スタンプ装備 <strong>${equippedStampCount} / ${MAX_EQUIPPED_STAMPS}</strong></span><span>称号 <strong>${escapeHtml(getTitleProduct()?.title || "未装備")}</strong></span><span>チャット背景 <strong>${escapeHtml(CHAT_BACKGROUND_PRODUCTS.find((product) => product.id === equippedChatCosmetics.chatBackgroundId)?.name || "標準")}</strong></span><span>チャット枠 <strong>${escapeHtml(CHAT_COSMETIC_PRODUCTS.find((product) => product.id === equippedChatCosmetics.chatFrameId)?.name || "標準")}</strong></span></div>
      <section class="shop-category shop-oshi-market-collection" id="shopOshiMarketCollection" aria-labelledby="shopOshiMarketCollectionTitle">
        <div class="shop-oshi-market-hero">
          <div><span>OSHI-KATSU / TOKIMEKI COLLECTION</span><h2 id="shopOshiMarketCollectionTitle">推し活・ときめきコレクション</h2>
            <p>「この人から買いたい」が伝わる店主称号と、好きを表現するかわいいチャットアイテムを集めました。</p></div>
          <div class="shop-oshi-market-uses" aria-label="コレクション商品の使い道">
            <span><b aria-hidden="true">♡</b> 称号は推し値市場の店主カードへ</span>
            <span><b aria-hidden="true">✿</b> スタンプは商店チャーム・オンライン対戦チャットへ</span>
            <span><b aria-hidden="true">✦</b> 背景・フレームはオンライン対戦チャットへ</span>
          </div>
        </div>
        <p class="shop-oshi-market-shared"><strong>通常の商品棚と同じ商品です。</strong> 商品ID・購入状態・装備状態は共通のため、どちらの棚から購入しても二重購入にはなりません。</p>
        <div class="shop-oshi-market-groups">${oshiMarketCollectionGroups}</div>
      </section>
      <section class="shop-category"><div class="shop-category-head"><div><span>COMMUNITY FEATURE</span><h2>トップページ機能</h2></div><p>${formatAnjuPay(500)}の買い切りで、自分のひとことをいつでも投稿・編集できます。</p></div><div class="shop-grid shop-feature-grid">${featureProducts}</div></section>
      ${topMessageComposer}
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT BACKGROUND / ${CHAT_BACKGROUND_PRODUCTS.length} COLORS</span><h2>チャット背景</h2></div><p>吹き出しの背景を1個装備できます。フレームと自由に組み合わせられます。</p></div><div class="shop-grid">${chatBackgroundProducts}</div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT FRAME / ${CHAT_STANDARD_FRAME_PRODUCTS.length} STYLES</span><h2>チャットフレーム</h2></div><p>かわいい・クール・ネタ系から、吹き出しの枠を1個装備できます。</p></div><div class="shop-grid">${chatFrameProducts}</div></section>
      <section class="shop-category shop-special-category"><div class="shop-category-head"><div><span>PREMIUM FRAME / ${CHAT_SPECIAL_FRAME_PRODUCTS.length} STYLES</span><h2>特別なアニメフレーム</h2></div><p>長期目標として集められる、控えめな動きと光を持つ最高級フレームです。</p></div><div class="shop-grid">${specialChatFrameProducts}</div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT REACTION</span><h2>追加リアクション</h2></div><p>購入品から最大${MAX_EQUIPPED_REACTIONS}個を装備できます。</p></div><div class="shop-grid">${reactionProducts}</div></section>
      <section class="shop-category shop-stamp-category"><div class="shop-category-head"><div><span>CHAT STAMP / ${STAMP_PRODUCTS.length} ITEMS</span><h2>追加スタンプ</h2></div><p>無料4種に加え、購入品から最大${MAX_EQUIPPED_STAMPS}個を装備できます。オンライン対戦チャット共通で、推し値商店の商店チャームは装備枠と別に選べます。</p></div><div class="shop-grid">${stampProducts}</div></section>
      <section class="shop-category shop-title-category" id="shopTitleCategory"><div class="shop-category-head"><div><span>PLAYER TITLE / ${standardTitleProducts.length} STANDARD TITLES</span><h2>プレイヤー称号</h2></div><p>称号は1個だけ装備できます。推し値市場向け7種は上の「推し活・ときめきコレクション」にあります。</p></div><div class="shop-title-filters" role="group" aria-label="称号カテゴリ">${titleCategoryFilters}</div><div class="shop-title-groups">${titleGroups}</div></section>` : renderEconomyUnavailable()}
    <div class="economy-actions"><button class="button button-primary" id="shopMissionsButton">ミッションを見る</button>
      <button class="button button-ghost" id="shopBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">${useOfflineMarketPreview ? "LOCAL UI PREVIEWでは購入・装備を変更しません。表示とレイアウトだけを安全に確認できます。" : "購入後の払い戻しはありません。トップメッセージは公開情報です。商品は交流と表示のカスタマイズ専用で、採点や勝敗には影響しません。"}</p>
  </section>`;
}

function renderMatching() {
  const sampleCount = getDeckSampleCount();
  const startingHp = getStartingHp(sampleCount);
  const preference = getImagePreferenceOption(state.imagePreference);
  const acceptsBoth = preference.id === "both";
  const scopeBody = acceptsBoth
    ? "実写・アニメを問わず、すべての待機相手を候補にしています。"
    : state.matchScopeExpanded
      ? "同じ好みを最優先しつつ、相手も条件を広げた場合は異なる好みともマッチングします。"
      : `「${preference.shortLabel}」または「どちらも歓迎」の相手だけを探しています。`;
  const expandAction = !acceptsBoth && state.matchScopeAvailable && !state.matchScopeExpanded
    ? '<button class="button button-cyan" id="expandMatchingScope">条件を広げて探す</button>'
    : "";
  const scopeHint = !acceptsBoth && !state.matchScopeAvailable && !state.matchScopeExpanded
    ? `<small class="matching-scope-hint">${MATCH_SCOPE_EXPAND_DELAY_MS / 1000}秒後、必要なら異なる好みまで検索範囲を広げられます。</small>`
    : "";
  return renderStatusCard({
    icon: "◎",
    eyebrow: "PREFERENCE MATCHING",
    title: "対戦相手を探しています",
    body: scopeBody,
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">好み: ${escapeHtml(preference.shortLabel)}</span>${sampleCount ? `<span class="connection-pill warning">SAMPLE ${sampleCount}枚 / 開始HP ${startingHp}</span>` : `<span class="connection-pill">実画像デッキ / 開始HP ${MAX_HP}</span>`}${scopeHint}`,
    actions: `${expandAction}<button class="button button-ghost" id="cancelMatching">マッチングをやめる</button>`,
  });
}

function renderConnecting() {
  const opponent = getOpponent();
  const ownPlayer = state.players[state.playerIndex];
  const handicapDetails = [ownPlayer, opponent].map((player, index) => {
    const sampleCount = normalizeSampleCount(player?.sampleCount);
    const startingHp = getStartingHp(sampleCount);
    return `<span class="connection-pill ${sampleCount ? "warning" : ""}">${index === 0 ? "あなた" : escapeHtml(player?.name || "対戦相手")}: HP ${startingHp}${sampleCount ? ` / SAMPLE ${sampleCount}` : ""}</span>`;
  }).join("");
  const status = renderStatusCard({
    icon: "VS",
    eyebrow: "MATCH FOUND",
    title: `${escapeHtml(opponent?.name || "対戦相手")}とマッチング`,
    body: "画像を一時転送するためのP2P接続を準備しています。Firebaseには画像をアップロードしません。",
    details: `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>${handicapDetails}`,
    actions: `<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>`,
  });
  return `<section class="screen">${status.replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}
    <div class="online-chat-standalone">${renderOnlineChat()}</div></section>`;
}

function renderStatusCard({ icon, eyebrow, title, body, details = "", actions = "" }) {
  return `<section class="screen handoff-wrap"><div class="handoff-card online-status-card">
    <div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span>
    <h1>${title}</h1><p>${escapeHtml(body)}</p>
    <div class="online-status-details">${details}</div><div class="button-row">${actions}</div>
  </div></section>`;
}

function renderOnlineHud() {
  const playerHtml = (player, index) => {
    const maxHp = Number(player.maxHp || player.startingHp || MAX_HP);
    const sampleCount = normalizeSampleCount(player.sampleCount);
    const localPlayer = index === state.playerIndex;
    const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url;
    const avatar = shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar }) || "";
    return `<div class="hud-player ${index === state.playerIndex ? "local-player" : ""}">
    <div class="hud-player-main">${avatar}<div class="hud-player-details"><div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}${localPlayer ? "（あなた）" : ""}</span>
      ${sampleCount ? `<span class="sample-hud-badge">SAMPLE ${sampleCount}</span>` : ""}${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</div>
    <div class="hp-bar" aria-label="${escapeHtml(player.name)} HP ${player.hp}/${maxHp}"><div class="hp-fill" style="--hp:${Math.max(0, (player.hp / maxHp) * 100)}%"></div></div>
    <span class="hp-value">HP ${Math.max(0, player.hp)} / ${maxHp}${sampleCount ? ` ・ サンプル${sampleCount}枚` : ""}</span></div></div>
  </div>`;
  };
  return `<div class="round-topbar">${playerHtml(state.players[0], 0)}
    <div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>
    ${playerHtml(state.players[1], 1)}</div>
    <div class="online-room-strip"><span>ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span>
      <span class="connection-pill ${state.channelReady ? "connected" : ""}">${state.channelReady ? "● P2P接続中" : "○ 再接続待ち"}</span>
      <span class="connection-pill ${state.opponentOnline ? "connected" : "warning"}">${state.opponentOnline ? "● 相手オンライン" : "○ 相手の接続切れ"}</span>
      <button class="avatar-visibility-toggle" type="button" data-online-avatar-visibility aria-pressed="${state.hideOpponentAvatar}">${state.hideOpponentAvatar ? "相手画像を表示" : "相手画像を隠す"}</button></div>`;
}

function renderRoundSelect() {
  const timerStarted = hasSelectionStarted();
  const remainingSeconds = Math.max(0, Math.ceil(state.selectionRemainingMs / 1000));
  const progress = Math.max(0, Math.min(100, (state.selectionRemainingMs / SELECTION_TIME_LIMIT_MS) * 100));
  const warning = timerStarted && remainingSeconds <= SELECTION_WARNING_SECONDS;
  const cards = state.deck.map((item, index) => `<button class="select-card ${item.isSample ? "sample-card" : ""} ${item.id === state.signatureCardId ? "signature-card" : ""} ${item.used ? "used" : ""} ${state.selectedCardId === item.id ? "selected" : ""}"
    data-online-card="${escapeHtml(item.id)}" ${item.used || !timerStarted ? "disabled" : ""} aria-pressed="${state.selectedCardId === item.id}">
    <img src="${item.url}" alt="候補画像 ${index + 1}" draggable="false" />
    ${item.id === state.signatureCardId ? '<i class="select-signature-badge" aria-label="シグネチャーカード">✦ SIGNATURE</i>' : ""}
    <span>${item.used ? "USED" : item.isSample ? "SAMPLE / HP−5" : `ENTRY ${String(index + 1).padStart(2, "0")}`}</span>
  </button>`).join("");
  return `<section class="screen">${renderOnlineHud()}
    <div class="section-head"><div><span class="eyebrow">SECRET PICK</span><h1>あなたの画像選択</h1>
      <p>相手の選択が完了するまで、どの画像を選んだかは送信されません。</p></div>
      <div class="selection-heading-actions"><div class="selection-timer ${timerStarted ? "running" : "pending"} ${warning ? "warning" : ""}"
        data-selection-timer role="timer" aria-live="polite" aria-label="${timerStarted ? `画像選択 残り${remainingSeconds}秒` : "画像選択の開始待ち"}"
        style="--selection-progress:${progress}%"><small>SELECT LIMIT</small><strong data-selection-seconds>${timerStarted ? remainingSeconds : "--"}</strong>
        <span data-selection-unit>${timerStarted ? "SEC" : "SYNC"}</span><i></i></div>
        <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div></div>
    <div class="select-panel"><div class="select-grid">${cards}</div>
      <div class="selection-footer"><p>${timerStarted ? "10秒以内に選択してください。時間切れ時は未使用画像を自動選択します。" : "両者の通信準備が整うと、10秒の選択時間が始まります。"}</p>
        <button class="button button-primary" id="onlineLockSelection" ${state.selectedCardId && timerStarted ? "" : "disabled"}>この画像でロック</button></div></div>
    <div class="online-chat-standalone">${renderOnlineChat()}</div>
  </section>`;
}

function renderWaitingPick() {
  return renderBattleWait("SECRET PICK", "相手の画像選択を待っています", "選んだ画像はまだ相手へ送信していません。");
}

function renderWaitingImage() {
  return renderBattleWait("P2P IMAGE TRANSFER", "画像を安全に転送しています", `転送状況 ${state.transferProgress}%`);
}

function renderWaitingScore() {
  return renderBattleWait("PRIVATE SCORE", "相手の採点を待っています", "あなたの点数は相手の確定まで非公開です。");
}

function renderWaitingContinue() {
  return renderBattleWait("ROUND READY", "相手の準備を待っています", "両者が準備すると次の画面へ進みます。");
}

function renderBattleWait(eyebrow, title, body) {
  return `<section class="screen">${renderOnlineHud()}${renderStatusCard({
    icon: "…", eyebrow, title, body,
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div>`,
    actions: `<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>`,
  }).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}
    <div class="online-chat-standalone">${renderOnlineChat()}</div></section>`;
}

function renderReveal() {
  const localItem = getSelectedItem();
  const remoteItem = state.remoteImages.get(state.round);
  const itemFor = (index) => index === state.playerIndex ? localItem : remoteItem;
  return `<section class="screen">${renderOnlineHud()}
    <div class="section-head"><div><span class="eyebrow">IMAGE REVEAL</span><h1>画像、オープン。</h1>
      <p>通常型は自由な画像勝負。チャットで感想やリアクションを送りながら楽しめます。</p></div>
      <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div>
    <div class="battle-layout"><div class="arena-panel"><div class="arena-grid">
      ${renderArenaCard(0, itemFor(0))}<div class="arena-vs">VS</div>${renderArenaCard(1, itemFor(1))}
    </div><div class="arena-actions"><button class="button button-primary" id="onlineBeginScoring">相手の画像を採点</button></div></div>
    ${renderOnlineChat()}</div></section>`;
}

function renderArenaCard(index, item) {
  const player = state.players[index];
  return `<article class="arena-card ${index === 0 ? "player-one" : "player-two"}">
    <div class="arena-image"><img src="${item?.url || ""}" alt="${escapeHtml(player.name)}が出した画像" draggable="false" /></div>
    <div class="arena-meta"><strong>${escapeHtml(player.name)}${index === state.playerIndex ? "（あなた）" : ""}</strong><span>ROUND ${state.round}</span></div>
  </article>`;
}

function renderScore() {
  const opponent = getOpponent();
  const item = state.remoteImages.get(state.round);
  const buttons = Array.from({ length: 10 }, (_, index) => index + 1).map((score) => `<button
    class="score-button ${score >= 8 ? "critical-zone" : ""} ${state.selectedScore === score ? "selected" : ""}"
    data-online-score="${score}" aria-pressed="${state.selectedScore === score}">${score}</button>`).join("");
  return `<section class="screen">${renderOnlineHud()}<div class="score-layout">
    <div class="score-image"><img src="${item?.url || ""}" alt="${escapeHtml(opponent?.name || "相手")}の採点対象画像" draggable="false" /></div>
    <div class="score-panel"><span class="eyebrow">YOUR PRIVATE SCORE</span><h2>${escapeHtml(opponent?.name || "相手")}の画像を採点</h2>
      <p>1～10点を選択してください。確定後の変更はできません。</p><div class="score-buttons">${buttons}</div>
      <button class="button button-primary button-wide score-lock" id="onlineLockScore" ${state.selectedScore ? "" : "disabled"}>この点数で確定</button>
      <button class="button button-danger button-small" data-online-destroy>ルーム破棄</button></div>
  </div><div class="online-chat-standalone">${renderOnlineChat()}</div></section>`;
}

function renderRoundResult() {
  const result = state.history.at(-1);
  const labelFor = (score) => score === 10 ? "PERFECT!!" : score >= 8 ? "CRITICAL!" : score >= 6 ? "GREAT" : score >= 4 ? "GOOD" : "HIT";
  const damageText = result.winnerIndex === null
    ? "同点。両者ノーダメージです。"
    : `${state.players[result.loserIndex].name}に ${result.damage} DAMAGE。${result.lethal ? " HP 0、決着！" : ""}`;
  const pursuitLines = renderOnlinePursuitLines(result);
  const finishBadge = result.lethal
    ? `<div class="finish-result-badge ${result.finish?.signature ? "is-signature" : ""}"><span>${result.finish?.signature ? "SIGNATURE FINISH" : "FINISH"}</span><strong>${escapeHtml(result.finish?.winnerName || state.players[result.winnerIndex].name)}の決着演出</strong></div>`
    : "";
  return `<section class="screen result-wrap">${renderOnlineHud()}<div class="result-card">
    <span class="eyebrow">ROUND ${state.round} RESULT</span><h1>${result.winnerIndex === null ? "DRAW ROUND" : `${escapeHtml(state.players[result.winnerIndex].name)} TAKES IT`}</h1>
    <div class="result-scores">${resultPlayerHtml(0, result.scorePlayerOne, result.winnerIndex, labelFor(result.scorePlayerOne))}
      <div class="result-vs">VS</div>${resultPlayerHtml(1, result.scorePlayerTwo, result.winnerIndex, labelFor(result.scorePlayerTwo))}</div>
    <div class="damage-callout">${escapeHtml(damageText)}</div>${finishBadge}${pursuitLines}<div class="result-chat">${renderOnlineChat()}</div>
    <div class="button-row" style="justify-content:center"><button class="button button-danger" data-online-destroy>ルーム破棄</button>
      <button class="button button-primary" id="onlineContinue">${isMatchOver() ? "試合結果を見る" : `ROUND ${state.round + 1}へ`}</button></div>
  </div></section>`;
}

function renderOnlinePursuitLines(result) {
  if (result.lethal) return "";
  const scores = [result.scorePlayerOne, result.scorePlayerTwo];
  const calls = state.players.map((player, index) => ({ player, score: scores[index] }))
    .filter(({ score }) => score >= 9)
    .map(({ player, score }) => `<article class="online-pursuit-call"><span>追撃セリフ / SCORE ${score}</span><strong>${escapeHtml(player.name)}</strong><blockquote>${escapeHtml(normalizePursuitLine(player.pursuitLine))}</blockquote></article>`)
    .join("");
  return calls ? `<section class="online-pursuit-lines" aria-label="追撃セリフ">${calls}</section>` : "";
}

function resultPlayerHtml(index, score, winnerIndex, label) {
  return `<div class="result-player ${winnerIndex === index ? "winner" : ""}"><strong>${escapeHtml(state.players[index].name)}</strong>
    <span>${score}</span><small>${escapeHtml(label)}</small></div>`;
}

function renderGameOver() {
  const outcome = state.outcome;
  const title = outcome.winnerIndex === null ? "引き分け" : `${escapeHtml(state.players[outcome.winnerIndex].name)} WIN`;
  const subtitle = outcome.reason === "hp" ? "HPが0になり、決着しました。" : outcome.reason === "draw" ? "すべての判定項目が同点でした。" : "5ラウンド終了。残りHPと獲得点で判定しました。";
  const localPlayer = state.players[state.playerIndex];
  const localResult = outcome.winnerIndex === null ? "DRAW" : outcome.winnerIndex === state.playerIndex ? "WIN" : "LOSE";
  const shareButton = window.HariaiApp?.shared?.renderResultShareButton?.({
    mode: "通常型1on1",
    result: localResult,
    details: [`残りHP ${Number(localPlayer?.hp || 0)}`, `全${state.round}ラウンド / 合計獲得点 ${Number(localPlayer?.totalReceived || 0)}`],
  }) || "";
  return `<section class="screen gameover-wrap"><div class="gameover-card"><div class="winner-emblem" aria-hidden="true">${outcome.winnerIndex === null ? "=" : "✦"}</div>
    <span class="eyebrow">ONLINE MATCH COMPLETE</span><h1>${title}</h1><p>${escapeHtml(subtitle)}</p>
    <div class="final-stats">${state.players.map((player, index) => `<div class="final-player ${outcome.winnerIndex === index ? "winner" : ""}">
      <h2>${escapeHtml(player.name)} ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</h2>
      <div class="stats-row"><div class="stat-box"><strong>${player.hp}</strong><span>残りHP</span></div>
      <div class="stat-box"><strong>${player.totalReceived}</strong><span>合計獲得点</span></div><div class="stat-box"><strong>${player.criticals}</strong><span>CRITICAL</span></div></div>
    </div>`).join("")}</div>
    ${state.economyReady ? `<div class="gameover-missions"><div class="gameover-missions-head"><div><span class="eyebrow">DAILY PROGRESS</span><h2>デイリーミッション</h2></div><strong>AnjuPay ◆ ${formatAnjuPay(state.economy.points)}</strong></div>
      <div class="mission-grid compact">${dailyMissionsForDate(currentDailyDateKey()).map((mission) => renderMissionCard(mission, true)).join("")}</div></div>` : ""}
    <div class="result-chat">${renderOnlineChat()}</div>
    ${renderPostMatchTip({ mode: "solo", roomId: state.roomId, viewerUid: state.uid, recipients: state.players, balance: state.economy.points })}
    <div class="gameover-actions">${shareButton}<button class="button button-primary" id="onlineNewMatch">別の相手を探す</button>
      <button class="button button-ghost" id="onlineGameoverMissions">ミッション・ショップ</button>
      <button class="button button-ghost" id="onlineGameoverHome">タイトルへ戻る</button></div>
  </div></section>`;
}

function renderNoContest() {
  return renderStatusCard({
    icon: "×", eyebrow: "NO CONTEST", title: "ルームが破棄されました",
    body: "この対戦は勝敗・勝率・連勝数に影響しません。画像とチャットへの参照を破棄しました。",
    actions: `<button class="button button-primary" id="onlineNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="onlineNoContestHome">タイトルへ</button>`,
  });
}

function renderError() {
  return renderStatusCard({
    icon: "!", eyebrow: "CONNECTION ERROR", title: "オンライン接続に失敗しました",
    body: state.errorMessage || "通信状態を確認して、もう一度お試しください。",
    actions: `<button class="button button-primary" id="onlineRetry">もう一度試す</button><button class="button button-ghost" id="onlineErrorHome">タイトルへ</button>`,
  });
}

function renderOnlineChat() {
  const messages = state.chatMessages.length ? state.chatMessages.map((message) => {
    const authorIndex = state.players.findIndex((player) => player.uid === message.authorUid);
    const content = message.stampId
      ? renderStampBubble(message.stampId, chatCosmeticClassNames(message.chatFrameId, message.chatBackgroundId))
      : renderChatCosmeticBubble(message.text, message);
    return `<div class="chat-message ${authorIndex === 1 ? "player-two" : "player-one"}"><small>${escapeHtml(message.name)} / R${message.round}${message.titleId ? renderTitleBadge(message.titleId) : ""}</small>${content}</div>`;
  }).join("") : `<div class="chat-empty">画像について話してみましょう。<br />チャットはルーム内の2人だけに表示されます。</div>`;
  const reactions = [
    ...DEFAULT_REACTIONS,
    ...getEquippedReactionProducts().map((product) => product.reaction),
  ];
  return `<aside class="chat-panel"><div class="chat-head"><strong>ONLINE CHAT</strong><span>ルーム終了後に非表示</span></div>
    <div class="chat-messages" id="onlineChatMessages">${messages}</div>
    ${renderChatTools({ id: "online", textReactions: reactions, stamps: getAvailableStamps(state.economy), textAttribute: "data-online-reaction", stampAttribute: "data-online-stamp" })}
    <form class="chat-form" id="onlineChatForm"><input class="chat-input" id="onlineChatInput" maxlength="80" placeholder="ひとこと送る…" autocomplete="off" aria-label="チャットメッセージ" />
      <button class="button button-cyan button-small" type="submit">送信</button></form></aside>`;
}

function bindScreenEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-online-destroy]").forEach((button) => button.addEventListener("click", () => destroyDialog.showModal()));
  document.querySelector("[data-online-avatar-visibility]")?.addEventListener("click", () => { state.hideOpponentAvatar = !state.hideOpponentAvatar; render(); });
  document.querySelectorAll("[data-claim-mission]").forEach((button) => button.addEventListener("click", () => claimDailyMission(button.dataset.claimMission)));
  document.querySelector("#claimPeriodRewardsButton")?.addEventListener("click", claimClosedPeriodRewards);
  document.querySelectorAll("[data-buy-product]").forEach((button) => button.addEventListener("click", () => purchaseShopProduct(button.dataset.buyProduct)));
  document.querySelectorAll("[data-equip-product]").forEach((button) => button.addEventListener("click", () => toggleShopProductEquip(button.dataset.equipProduct)));
  document.querySelectorAll("[data-preview-reaction]").forEach((button) => button.addEventListener("click", () => showToast(`チャットでは「${button.dataset.previewReaction}」と送信します。`)));
  bindChatToolTabs();
  document.querySelectorAll("[data-title-category-filter]").forEach((button) => button.addEventListener("click", () => applyTitleCategoryFilter(button.dataset.titleCategoryFilter)));
  document.querySelectorAll("[data-title-category-group]").forEach((details) => details.addEventListener("toggle", () => {
    const categoryId = details.dataset.titleCategoryGroup;
    if (!getPlayerTitleCategory(categoryId)) return;
    if (details.open) state.expandedTitleCategories.add(categoryId);
    else state.expandedTitleCategories.delete(categoryId);
  }));
  bindChatEvents();

  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "missions" || state.screen === "shop") bindEconomyEvents();
  if (state.screen === "achievements") bindAchievementEvents();
  if (state.screen === "matching") {
    document.querySelector("#expandMatchingScope")?.addEventListener("click", expandMatchmakingScope);
    document.querySelector("#cancelMatching")?.addEventListener("click", cancelMatching);
  }
  if (state.screen === "select") bindSelectEvents();
  if (state.screen === "reveal") document.querySelector("#onlineBeginScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") document.querySelector("#onlineContinue")?.addEventListener("click", continueRound);
  if (state.screen === "gameover") {
    bindPostMatchTip(appRoot, {
      mode: "solo",
      roomId: state.roomId,
      viewerUid: state.uid,
      recipients: state.players,
      balance: state.economy.points,
      onBalanceChange: (balance) => { state.economy.points = balance; },
    });
    document.querySelector("#onlineNewMatch")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineGameoverMissions")?.addEventListener("click", openPostMatchMissions);
    document.querySelector("#onlineGameoverHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "noContest") {
    document.querySelector("#onlineNoContestAgain")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#onlineRetry")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function applyTitleCategoryFilter(categoryId) {
  const nextFilter = categoryId === "all" || getPlayerTitleCategory(categoryId) ? categoryId : "all";
  state.titleCategoryFilter = nextFilter;
  document.querySelectorAll("[data-title-category-filter]").forEach((button) => {
    const activeFilter = button.dataset.titleCategoryFilter === nextFilter;
    button.classList.toggle("active", activeFilter);
    button.setAttribute("aria-pressed", String(activeFilter));
  });
  document.querySelectorAll("[data-title-category-group]").forEach((details) => {
    const visible = nextFilter === "all" || details.dataset.titleCategoryGroup === nextFilter;
    details.hidden = !visible;
    if (visible && nextFilter !== "all") details.open = true;
  });
}

function bindEconomyEvents() {
  document.querySelector("#economyHomeButton")?.addEventListener("click", leaveToLanding);
  document.querySelector("#claimDailyPlayRewardsButton")?.addEventListener("click", claimDailyPlayRewards);
  document.querySelector("#missionsShopButton")?.addEventListener("click", () => { state.screen = "shop"; render(); });
  document.querySelector("#shopMissionsButton")?.addEventListener("click", () => { state.screen = "missions"; render(); });
  document.querySelector("#missionsBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
  document.querySelector("#shopBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
  document.querySelector("[data-edit-top-message]")?.addEventListener("click", () => {
    document.querySelector("#topMessageComposer")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.querySelector("#topMessageText")?.focus(), 280);
  });
  const topMessageText = document.querySelector("#topMessageText");
  topMessageText?.addEventListener("input", () => {
    const counter = document.querySelector("#topMessageLength");
    if (counter) counter.textContent = String(topMessageText.value.length);
  });
  document.querySelector("#topMessageForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveTopMessage(document.querySelector("#topMessageName")?.value, topMessageText?.value);
    } catch (error) {
      showToast(error?.message || "トップメッセージを公開できませんでした。");
    }
  });
  document.querySelector("#deleteTopMessage")?.addEventListener("click", async () => {
    if (!window.confirm("トップページからこのメッセージを非公開にしますか？")) return;
    try {
      await deleteTopMessage();
    } catch (error) {
      showToast(error?.message || "トップメッセージを非公開にできませんでした。");
    }
  });
}

function bindAchievementEvents() {
  document.querySelector("#achievementHomeButton")?.addEventListener("click", leaveToLanding);
  document.querySelector("#achievementBattleButton")?.addEventListener("click", () => {
    state.screen = "setup";
    render();
  });
  document.querySelector("#achievementRefreshButton")?.addEventListener("click", () => {
    loadAchievements({ syncPublic: true }).catch(() => showToast("実績情報を再読み込みできませんでした。"));
  });
  document.querySelector("[data-achievement-showcase-auto]")?.addEventListener("click", () => {
    saveAchievementShowcase([]);
  });
  document.querySelectorAll("[data-achievement-showcase]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.achievementShowcase || "");
      const profile = window.HariaiAchievements?.normalizeProfile?.(state.achievements) || state.achievements;
      const selected = [...(profile.customShowcase.length ? profile.customShowcase : profile.showcase)];
      const index = selected.indexOf(id);
      if (index >= 0) selected.splice(index, 1);
      else if (selected.length >= 3) {
        showToast("ランキングへ展示できる実績は最大3件です。");
        return;
      } else selected.push(id);
      saveAchievementShowcase(selected);
    });
  });
}

function bindSetupEvents() {
  document.querySelector("#onlineBackHome")?.addEventListener("click", leaveToLanding);
  bindOverallRankingParticipation({
    controlId: "soloOverallRanking",
    name: () => document.querySelector("#onlinePlayerName")?.value || state.name,
    onUpdate: render,
  });
  shared()?.profileAvatar?.bindSetting?.({ controlId: "soloProfileAvatar", onUpdate: render });
  const nameInput = document.querySelector("#onlinePlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    updateMatchmakingSetupButton();
  });
  document.querySelectorAll('input[name="onlineImagePreference"]').forEach((input) => input.addEventListener("change", () => {
    state.imagePreference = normalizeImagePreference(input.value, "");
    if (state.imagePreference) localStorage.setItem(IMAGE_PREFERENCE_KEY, state.imagePreference);
    updateMatchmakingSetupButton();
  }));
  bindOnlinePursuitFields();
  bindOnlineFinishFields();
  document.querySelector("#onlineImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#onlineFillSample")?.addEventListener("click", fillSampleDeck);
  document.querySelectorAll("[data-online-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.onlineRemove)));
  document.querySelectorAll("[data-online-signature-card]").forEach((button) => button.addEventListener("click", () => {
    toggleSignatureCard(button.dataset.onlineSignatureCard);
  }));
  document.querySelector("#findOpponent")?.addEventListener("click", requestMatchmaking);
}

function isMatchmakingSetupReady() {
  return Boolean(
    state.authReady
    && state.deck.length === MAX_ROUNDS
    && state.name.trim()
    && normalizeImagePreference(state.imagePreference, ""),
  );
}

function updateMatchmakingSetupButton() {
  const button = document.querySelector("#findOpponent");
  if (button) button.disabled = !isMatchmakingSetupReady();
}

function normalizeSampleCount(value) {
  return Math.max(0, Math.min(MAX_ROUNDS, Math.floor(Number(value) || 0)));
}

function getDeckSampleCount() {
  return state.deck.filter((item) => item.isSample === true).length;
}

function getStartingHp(sampleCount) {
  return Math.max(MIN_STARTING_HP, MAX_HP - normalizeSampleCount(sampleCount) * SAMPLE_HP_PENALTY);
}

function requestMatchmaking() {
  const sampleCount = getDeckSampleCount();
  if (!sampleCount) {
    beginMatchmaking();
    return;
  }
  const startingHp = getStartingHp(sampleCount);
  if (!sampleHandicapDialog || !sampleHandicapMessage || !confirmSampleMatch) {
    if (window.confirm(`サンプル画像${sampleCount}枚を含むため、最大HP${startingHp}で開始します。対戦を探しますか？`)) beginMatchmaking();
    return;
  }
  sampleHandicapMessage.textContent = `サンプル画像${sampleCount}枚を含むため、最大HP${startingHp}で開始します。対戦相手にもサンプル枚数と開始HPが表示されます。`;
  confirmSampleMatch.textContent = `HP ${startingHp}で対戦を探す`;
  sampleHandicapDialog.returnValue = "";
  sampleHandicapDialog.showModal();
}

function bindOnlinePursuitFields() {
  const select = document.querySelector("#onlinePursuitLineChoice");
  const field = document.querySelector("#onlineCustomPursuitField");
  const input = document.querySelector("#onlineCustomPursuitLine");
  const counter = document.querySelector("#onlinePursuitCharacterCount");
  const syncCustomVisibility = () => {
    if (field) field.hidden = select?.value !== CUSTOM_PURSUIT_VALUE;
  };
  select?.addEventListener("change", () => {
    state.pursuitLineChoice = select.value;
    if (select.value === CUSTOM_PURSUIT_VALUE) {
      state.pursuitLine = normalizePursuitLine(state.customPursuitLine);
      input?.focus();
    } else {
      state.pursuitLine = normalizePursuitLine(select.value);
    }
    syncCustomVisibility();
  });
  input?.addEventListener("input", () => {
    input.value = sanitizePursuitLineDraft(input.value);
    state.customPursuitLine = input.value;
    state.pursuitLine = normalizePursuitLine(input.value);
    if (counter) counter.textContent = String(input.value.length);
  });
  syncCustomVisibility();
}

function bindOnlineFinishFields() {
  const select = document.querySelector("#onlineFinishLineChoice");
  const field = document.querySelector("#onlineCustomFinishField");
  const input = document.querySelector("#onlineCustomFinishLine");
  const counter = document.querySelector("#onlineFinishCharacterCount");
  const visibilityToggle = document.querySelector("#onlineShowOpponentCustomFinish");
  const syncCustomVisibility = () => {
    if (field) field.hidden = select?.value !== CUSTOM_FINISH_VALUE;
  };
  select?.addEventListener("change", () => {
    state.finishLineChoice = select.value;
    if (select.value === CUSTOM_FINISH_VALUE) {
      state.finishLine = normalizeFinishLine(state.customFinishLine);
      input?.focus();
    } else {
      applyFinishLineSetting(select.value);
    }
    localStorage.setItem(FINISH_LINE_KEY, state.finishLine || FINISH_LINE_DISABLED_VALUE);
    syncCustomVisibility();
  });
  input?.addEventListener("input", () => {
    input.value = sanitizeFinishLineDraft(input.value);
    state.customFinishLine = input.value;
    state.finishLine = normalizeFinishLine(input.value);
    localStorage.setItem(FINISH_LINE_KEY, state.finishLine);
    if (counter) counter.textContent = String(input.value.length);
  });
  visibilityToggle?.addEventListener("change", () => {
    state.showOpponentCustomFinish = visibilityToggle.checked;
    localStorage.setItem(OPPONENT_CUSTOM_FINISH_KEY, state.showOpponentCustomFinish ? "1" : "0");
  });
  syncCustomVisibility();
}

function toggleSignatureCard(id) {
  if (!state.deck.some((item) => item.id === id)) return;
  state.signatureCardId = state.signatureCardId === id ? "" : id;
  document.querySelectorAll("[data-online-signature-card]").forEach((button) => {
    const selected = button.dataset.onlineSignatureCard === state.signatureCardId;
    const index = state.deck.findIndex((item) => item.id === button.dataset.onlineSignatureCard);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", `画像${index + 1}をシグネチャーカード${selected ? "から外す" : "に指定"}`);
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";
    button.replaceChildren(icon, document.createTextNode(selected ? "SIGNATURE" : "切り札に指定"));
    button.closest(".deck-slot")?.classList.toggle("signature-card", selected);
  });
  const guide = document.querySelector(".signature-card-guide");
  guide?.classList.toggle("is-selected", Boolean(state.signatureCardId));
  const guideTitle = guide?.querySelector("strong");
  if (guideTitle) guideTitle.textContent = state.signatureCardId ? "シグネチャーカード指定済み" : "シグネチャーカードは未指定";
}

function bindSelectEvents() {
  document.querySelectorAll("[data-online-card]").forEach((button) => button.addEventListener("click", () => {
    state.selectedCardId = button.dataset.onlineCard;
    render();
  }));
  document.querySelector("#onlineLockSelection")?.addEventListener("click", lockSelection);
}

function bindScoreEvents() {
  document.querySelectorAll("[data-online-score]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScore = Number(button.dataset.onlineScore);
    render();
  }));
  document.querySelector("#onlineLockScore")?.addEventListener("click", lockScore);
}

function bindChatEvents() {
  document.querySelectorAll("[data-online-reaction]").forEach((button) => button.addEventListener("click", () => sendChat(button.dataset.onlineReaction)));
  document.querySelectorAll("[data-online-stamp]").forEach((button) => button.addEventListener("click", () => sendChat("", button.dataset.onlineStamp)));
  document.querySelector("#onlineChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#onlineChatInput");
    sendChat(input.value);
    input.value = "";
    input.focus();
  });
  scrollChat();
}

async function handleImageInput(event) {
  const files = Array.from(event.target.files || []);
  const remaining = MAX_ROUNDS - state.deck.length;
  if (!files.length || remaining <= 0) return;
  setBusy(true, "画像を安全な形式に変換しています…");
  let added = 0;
  let firstError = "";
  for (const file of files.slice(0, remaining)) {
    try {
      state.deck.push(await shared().processImageFile(file, state.deck.length));
      added += 1;
    } catch (error) {
      firstError ||= error.message;
    }
  }
  setBusy(false);
  render();
  showToast(firstError ? `${added}枚追加。${firstError}` : `${added}枚の画像を追加しました。`);
}

async function fillSampleDeck() {
  const remaining = MAX_ROUNDS - state.deck.length;
  if (remaining <= 0) return showToast("5枚すべて選択済みです。");
  setBusy(true, "サンプル画像を生成しています…");
  state.deck.push(...await shared().createSampleItems(0, remaining, state.deck.length));
  setBusy(false);
  render();
}

function normalizeXHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function applyEconomySnapshot(snapshot, dateKey = currentDailyDateKey()) {
  if (snapshot?.exists()) {
    state.economy = normalizeEconomyRecord(snapshot.val(), dateKey);
    state.economyReady = true;
  } else {
    state.economy = createEmptyEconomy(dateKey);
    state.economyReady = true;
  }
}

async function refreshEconomyFromServer(dateKey = currentDailyDateKey(), balance = null) {
  const snapshot = await get(ref(database, `online/economy/${state.uid}`));
  applyEconomySnapshot(snapshot, dateKey);
  if (Number.isFinite(Number(balance))) state.economy.points = Math.min(MAX_POINTS, Math.max(0, Number(balance)));
  return state.economy;
}

async function claimDailyMission(missionId) {
  const dateKey = currentDailyDateKey();
  const mission = dailyMissionsForDate(dateKey).find((candidate) => candidate.id === missionId);
  if (!mission || !state.economyReady || state.economyBusy) return;
  state.economyBusy = true;
  render();
  try {
    const response = await economyActionCallable({ action: "claim_daily", missionId: mission.id });
    const result = response.data || {};
    await refreshEconomyFromServer(dateKey, result.balance);
    state.economyBusy = false;
    render();
    if (result.outcome === "claimed-now") {
      const credited = Number.isFinite(Number(result.credited)) ? Number(result.credited) : mission.reward;
      showToast(`${formatAnjuPay(credited)}を受け取りました。`);
    }
    else if (result.outcome === "claimed") showToast("この報酬は受取済みです。");
    else showToast("ミッションはまだ達成していません。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("ミッション報酬を受け取れませんでした。");
  }
}

function dailyPlayProgressMessage(dailyPlay = state.dailyPlay) {
  if (!dailyPlay || !Number.isFinite(Number(dailyPlay.matches))) return "";
  if (dailyPlay.matches >= dailyPlay.maxMatches) {
    return `本日${dailyPlay.maxMatches}戦・デイリープレイ報酬の上限に到達しました。`;
  }
  if (!dailyPlay.nextTarget) return `本日${dailyPlay.matches}戦を正式完走しました。`;
  const remaining = Math.max(0, dailyPlay.nextTarget - dailyPlay.matches);
  if (dailyPlay.matches === dailyPlay.basicTarget) {
    return `本日${dailyPlay.matches}戦・基本ボーナス達成。あと${remaining}戦で ${formatAnjuPay(dailyPlay.nextReward, { sign: true })}です。`;
  }
  return `本日${dailyPlay.matches}戦・あと${remaining}戦で ${formatAnjuPay(dailyPlay.nextReward, { sign: true })}です。`;
}

async function settleDailyPlayRewards(uid = state.uid, { announce = false, renderAfter = true } = {}) {
  if (!uid) return null;
  const ownsState = state.uid === uid;
  if (ownsState && state.economyBusy) return null;
  if (ownsState) {
    state.economyBusy = true;
    if (renderAfter && state.screen === "missions") render();
  }
  try {
    const response = await economyActionCallable({ action: "claim_daily_play" });
    const result = response.data || {};
    const dailyPlay = ownsState
      ? applyDailyPlayRewardState(result.dailyPlay)
      : normalizeDailyPlayRewardState(result.dailyPlay, createEmptyDailyPlayRewardState());
    if (ownsState) {
      await refreshEconomyFromServer(currentDailyDateKey(), result.balance);
      state.economyBusy = false;
      if (renderAfter && state.screen === "missions") render();
    }
    if (announce) {
      if (Number(result.claimedCount || 0) > 0) {
        const nextGoal = dailyPlay.nextTarget > dailyPlay.matches
          ? ` あと${dailyPlay.nextTarget - dailyPlay.matches}戦で ${formatAnjuPay(dailyPlay.nextReward, { sign: true })}です。`
          : "";
        const context = dailyPlay.matches >= dailyPlay.maxMatches
          ? `本日${dailyPlay.maxMatches}戦・上限達成。`
          : dailyPlay.matches === dailyPlay.basicTarget
            ? `本日${dailyPlay.matches}戦・基本ボーナス達成。`
            : `本日${dailyPlay.matches}戦。`;
        if (Number(result.credited || 0) < Number(result.nominal || 0)) {
          showToast(`${context}所持上限まで ${formatAnjuPay(result.credited || 0)}を受け取り、達成分を精算しました。${nextGoal}`);
        } else {
          showToast(`${context}段階報酬 ${formatAnjuPay(result.credited || 0)}を受け取りました。${nextGoal}`);
        }
      } else if (renderAfter) {
        showToast("受け取れるデイリープレイ報酬はありません。");
      }
    }
    return { ...result, dailyPlay };
  } catch (error) {
    if (ownsState) {
      state.economyBusy = false;
      if (renderAfter && state.screen === "missions") render();
    }
    throw error;
  }
}

async function claimDailyPlayRewards() {
  try {
    await settleDailyPlayRewards(state.uid, { announce: true, renderAfter: true });
  } catch (error) {
    console.error(error);
    showToast("デイリープレイ報酬を受け取れませんでした。時間をおいてもう一度お試しください。");
  }
}

async function purchaseShopProduct(productId) {
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product || !state.economyReady || state.economyBusy) return;
  const dateKey = currentDailyDateKey();
  state.economyBusy = true;
  render();
  try {
    const response = await economyActionCallable({ action: "purchase", productId: product.id });
    const result = response.data || {};
    const wasEquipped = product.type === "reaction"
      ? state.economy.equipped?.reactions?.[product.id] === true
      : product.type === "stamp"
        ? state.economy.equipped?.stamps?.[product.id] === true
        : ["title", "chatFrame", "chatBackground"].includes(product.type)
          ? state.economy.equipped?.[product.type] === product.id
          : false;
    await refreshEconomyFromServer(dateKey, result.balance);
    const isEquipped = product.type === "reaction"
      ? state.economy.equipped?.reactions?.[product.id] === true
      : product.type === "stamp"
        ? state.economy.equipped?.stamps?.[product.id] === true
        : ["title", "chatFrame", "chatBackground"].includes(product.type)
          ? state.economy.equipped?.[product.type] === product.id
          : false;
    if (result.outcome === "purchased" && product.type === "feature") {
      state.topMessage = null;
      state.topMessageReady = true;
    }
    state.economyBusy = false;
    render();
    if (result.outcome === "purchased" && isEquipped && !wasEquipped) showToast(`「${product.reaction || product.title || product.name}」を購入し、装備しました。`);
    else if (result.outcome === "purchased" && product.type === "feature") showToast("「トップメッセージ枠」を購入しました。メッセージを投稿できます。");
    else if (result.outcome === "purchased") showToast(`「${product.reaction || product.title || product.name}」を購入しました。装備枠を空けると使用できます。`);
    else if (result.outcome === "owned") showToast("この商品は購入済みです。");
    else showToast("AnjuPay残高が不足しています。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("商品を購入できませんでした。");
  }
}

async function toggleShopProductEquip(productId) {
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product || !["reaction", "stamp", "title", "chatFrame", "chatBackground"].includes(product.type) || !state.economyReady || state.economyBusy) return;
  const dateKey = currentDailyDateKey();
  let outcome = "unavailable";
  state.economyBusy = true;
  render();
  try {
    const result = await runTransaction(ref(database, `online/economy/${state.uid}/equipped`), (current) => {
      const record = normalizeEconomyRecord({ ...state.economy, equipped: current }, dateKey);
      if (!record.inventory[product.id]) { outcome = "unowned"; return; }
      if (product.type === "reaction") {
        if (record.equipped.reactions[product.id]) {
          delete record.equipped.reactions[product.id];
          outcome = "removed";
        } else if (Object.keys(record.equipped.reactions).length >= MAX_EQUIPPED_REACTIONS) {
          outcome = "full";
          return;
        } else {
          record.equipped.reactions[product.id] = true;
          outcome = "equipped";
        }
      } else if (product.type === "stamp") {
        if (record.equipped.stamps[product.id]) {
          delete record.equipped.stamps[product.id];
          outcome = "removed";
        } else if (Object.keys(record.equipped.stamps).length >= MAX_EQUIPPED_STAMPS) {
          outcome = "stamp-full";
          return;
        } else {
          record.equipped.stamps[product.id] = true;
          outcome = "equipped";
        }
      } else {
        const equipmentKey = product.type === "title" ? "title" : product.type;
        if (record.equipped[equipmentKey] === product.id) {
          record.equipped[equipmentKey] = "";
          outcome = "removed";
        } else {
          record.equipped[equipmentKey] = product.id;
          outcome = "equipped";
        }
      }
      return record.equipped;
    });
    if (result.committed) state.economy = normalizeEconomyRecord({ ...state.economy, equipped: result.snapshot.val() }, dateKey);
    state.economyBusy = false;
    render();
    if (result.committed && outcome === "equipped") showToast(`「${product.reaction || product.title || product.name}」を装備しました。`);
    else if (result.committed && outcome === "removed") showToast(`「${product.reaction || product.title || product.name}」を装備から外しました。`);
    else if (outcome === "full") showToast(`リアクションは最大${MAX_EQUIPPED_REACTIONS}個まで装備できます。`);
    else if (outcome === "stamp-full") showToast(`スタンプは最大${MAX_EQUIPPED_STAMPS}個まで装備できます。`);
    else showToast("先に商品を購入してください。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("装備を変更できませんでした。");
  }
}

async function recordPeriodRewardResult(uid, mode, outcome, roomId, timestamp = Date.now()) {
  if (!uid || !roomId || !LEADERBOARD_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) return null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await economyActionCallable({ action: "record_match", mode, outcome, roomId });
    const result = response.data || {};
    if (result.outcome === "pending") {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      continue;
    }
    const dailyPlay = state.uid === uid
      ? applyDailyPlayRewardState(result.dailyPlay)
      : normalizeDailyPlayRewardState(result.dailyPlay, createEmptyDailyPlayRewardState());
    if (state.uid === uid) {
      state.economy = normalizeEconomyRecord({
        ...state.economy,
        daily: result.daily,
        periodRewards: result.periodRewards,
      }, jstDateKey(timestamp));
      applyAchievementPayload(result.achievements);
    }
    notifyAchievementUnlocks(result.newlyUnlocked);
    let dailyPlayClaim = null;
    if (dailyPlay.pendingCount > 0) {
      try {
        dailyPlayClaim = await settleDailyPlayRewards(uid, { announce: true, renderAfter: false });
        if (!dailyPlayClaim) {
          const progressMessage = dailyPlayProgressMessage(dailyPlay);
          showToast(`${progressMessage} 達成報酬はミッション画面からまとめて受け取れます。`);
        }
      } catch (error) {
        console.error(error);
        showToast("デイリープレイ報酬を自動受取できませんでした。ミッション画面から再確認できます。");
      }
    } else {
      const progressMessage = dailyPlayProgressMessage(dailyPlay);
      if (progressMessage) showToast(progressMessage);
    }
    return {
      ...result,
      dailyPlay: dailyPlayClaim?.dailyPlay || dailyPlay,
      economyBalance: Number.isFinite(Number(dailyPlayClaim?.balance))
        ? Number(dailyPlayClaim.balance)
        : null,
    };
  }
  throw new Error("参加者全員の試合結果を確認できませんでした。");
}

function notifyPendingPeriodRewards() {
  if (!state.economyReady || state.periodRewardReminderShown) return;
  const pending = pendingPeriodRewardSummary();
  if (!pending.total) return;
  state.periodRewardReminderShown = true;
  showToast(`期間戦績報酬 ${formatAnjuPay(pending.total)}を受け取れます。`);
}

async function claimClosedPeriodRewards() {
  if (!state.uid || !state.economyReady || state.economyBusy) return;
  const dateKey = jstDateKey(serverNow());
  state.economyBusy = true;
  render();
  try {
    const response = await economyActionCallable({ action: "claim_periods" });
    const result = response.data || {};
    await refreshEconomyFromServer(dateKey, result.balance);
    state.economyBusy = false;
    render();
    if (Number(result.claimedCount || 0) > 0) {
      const suffix = Number(result.remaining || 0) > 0 ? "。残りはもう一度受け取れます。" : "";
      showToast(Number(result.credited || 0) === Number(result.nominal || 0)
        ? `${result.claimedCount}期間分の戦績報酬 ${formatAnjuPay(result.credited)}を受け取りました${suffix}`
        : `${result.claimedCount}期間分を精算し、上限まで${formatAnjuPay(result.credited)}を受け取りました${suffix}`);
    } else {
      showToast("受け取れる期間戦績報酬はありません。");
    }
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("期間戦績報酬を受け取れませんでした。");
  }
}

async function openPostMatchMissions() {
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  await resetOnlineState("missions");
}

async function ensureOverallProfileSeeded(uid, name, soloProfile = null) {
  if (!uid) throw new Error("総合戦績のユーザーを確認できませんでした。");
  const profileRef = ref(database, `online/overallProfiles/${uid}`);
  const existing = await get(profileRef);
  if (existing.exists()) {
    const profile = normalizeOverallProfile(existing.val(), name || existing.val()?.name || "PLAYER");
    if (state.uid === uid) state.overallProfile = profile;
    return profile;
  }
  let seedProfile = soloProfile;
  if (!seedProfile) {
    const soloSnapshot = await get(ref(database, `online/profiles/${uid}`));
    seedProfile = soloSnapshot.exists() ? soloSnapshot.val() : null;
  }
  const seed = overallProfileSeed(name, seedProfile);
  const result = await runTransaction(profileRef, (current) => current || seed);
  if (!result.committed) throw new Error("総合戦績を初期化できませんでした。");
  const profile = normalizeOverallProfile(result.snapshot.val(), name || seed.name);
  if (state.uid === uid) state.overallProfile = profile;
  return profile;
}

async function ensureLeaderboardIdentityForUser(uid) {
  if (state.uid === uid && state.leaderboardId) return state.leaderboardId;
  const userEntryRef = ref(database, `online/leaderboardEntriesByUser/${uid}`);
  const existing = await get(userEntryRef);
  if (existing.exists()) {
    const entryId = String(existing.val());
    if (state.uid === uid) state.leaderboardId = entryId;
    return entryId;
  }
  const candidateId = push(ref(database, "online/leaderboard")).key;
  if (!candidateId) throw new Error("ランキングIDを作成できませんでした。");
  await set(ref(database, `online/leaderboardOwners/${candidateId}`), uid);
  const result = await runTransaction(userEntryRef, (current) => current || candidateId);
  if (!result.committed || !result.snapshot.exists()) throw new Error("ランキングIDを保存できませんでした。");
  const entryId = String(result.snapshot.val());
  if (state.uid === uid) state.leaderboardId = entryId;
  return entryId;
}

async function ensureLeaderboardIdentity() {
  return ensureLeaderboardIdentityForUser(state.uid);
}

function leaderboardRecord(profile = state.overallProfile, name = state.name, settings = leaderboardPublicSettings()) {
  const normalized = normalizeOverallProfile(profile, name, state.profile);
  const record = {
    name: String(name || normalized.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
    rating: normalized.rating,
    wins: normalized.wins,
    losses: normalized.losses,
    draws: normalized.draws,
    streak: normalized.streak,
    bestStreak: normalized.bestStreak,
    commentsEnabled: Boolean(settings.commentsEnabled),
    updatedAt: serverNow(),
  };
  if (settings.xPublic && X_HANDLE_PATTERN.test(settings.xHandle)) record.xHandle = settings.xHandle;
  return record;
}

function periodLeaderboardRecord(current, outcome = null, mode = "solo", profile = state.overallProfile, name = state.name, settings = leaderboardPublicSettings()) {
  const existingMatches = Math.max(0, Math.floor(Number(current?.wins || 0)) + Math.floor(Number(current?.losses || 0)) + Math.floor(Number(current?.draws || 0)));
  const hasModePoints = current?.modePoints && typeof current.modePoints === "object";
  const hasModeMatches = current?.modeMatches && typeof current.modeMatches === "object";
  const modePoints = Object.fromEntries(LEADERBOARD_MODES.map((candidate) => [candidate, Math.max(0, Math.floor(Number(
    hasModePoints ? current.modePoints?.[candidate] : candidate === "solo" ? current?.points : 0,
  ) || 0))]));
  const modeMatches = Object.fromEntries(LEADERBOARD_MODES.map((candidate) => [candidate, Math.max(0, Math.floor(Number(
    hasModeMatches ? current.modeMatches?.[candidate] : candidate === "solo" ? existingMatches : 0,
  ) || 0))]));
  const normalizedProfile = normalizeOverallProfile(profile, name, state.profile);
  const record = {
    name: String(name || normalizedProfile.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
    points: 0,
    wins: Math.max(0, Math.floor(Number(current?.wins || 0))),
    losses: Math.max(0, Math.floor(Number(current?.losses || 0))),
    draws: Math.max(0, Math.floor(Number(current?.draws || 0))),
    rating: normalizedProfile.rating,
    modePoints,
    modeMatches,
    commentsEnabled: Boolean(settings.commentsEnabled),
    updatedAt: serverNow(),
  };
  if (["win", "loss", "draw"].includes(outcome) && LEADERBOARD_MODES.includes(mode)) {
    if (outcome === "win") record.wins += 1;
    else if (outcome === "loss") record.losses += 1;
    else record.draws += 1;
    record.modePoints[mode] += outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
    record.modeMatches[mode] += 1;
  }
  record.points = (record.wins * 3) + record.draws;
  const achievementShowcase = window.HariaiAchievements?.normalizeIds?.(current?.achievementShowcase, 3) || [];
  if (achievementShowcase.length) record.achievementShowcase = achievementShowcase.join(",");
  if (settings.xPublic && X_HANDLE_PATTERN.test(settings.xHandle)) record.xHandle = settings.xHandle;
  return record;
}

async function rememberLeaderboardPeriod(entryId, period, key, uid = state.uid) {
  await set(ref(database, `online/leaderboardPeriodEntriesByUser/${uid}/${period}/${key}`), entryId);
}

async function syncCurrentPeriodLeaderboardMetadata(entryId, uid, profile, name, settings) {
  const timestamp = serverNow();
  await Promise.all(LEADERBOARD_PERIODS.map(async (period) => {
    const key = leaderboardPeriodKeyFor(period, timestamp);
    if (isServerRankingPeriod(period, key)) return;
    const result = await runTransaction(ref(database, `online/leaderboardPeriods/${period}/${key}/${entryId}`), (current) => {
      if (!current) return;
      return periodLeaderboardRecord(current, null, "solo", profile, name, settings);
    });
    if (result.committed) await rememberLeaderboardPeriod(entryId, period, key, uid);
  }));
}

async function recordLeaderboardPeriodResult(outcome, mode, uid, profile, name, settings) {
  if (!LEADERBOARD_PERIODS.length || !["win", "loss", "draw"].includes(outcome) || !LEADERBOARD_MODES.includes(mode)) return;
  const entryId = await ensureLeaderboardIdentityForUser(uid);
  const timestamp = serverNow();
  await Promise.all(LEADERBOARD_PERIODS.map(async (period) => {
    const key = leaderboardPeriodKeyFor(period, timestamp);
    if (isServerRankingPeriod(period, key)) return;
    await rememberLeaderboardPeriod(entryId, period, key, uid);
    const result = await runTransaction(ref(database, `online/leaderboardPeriods/${period}/${key}/${entryId}`), (current) => (
      periodLeaderboardRecord(current, outcome, mode, profile, name, settings)
    ));
    if (!result.committed) throw new Error("期間ランキングを更新できませんでした。");
  }));
}

async function syncServerRankingParticipation(uid, entryId, enabled = true) {
  const response = await economyActionCallable({
    action: "set_server_ranking_participation",
    enabled,
    ...(enabled ? { entryId } : {}),
  });
  if (state.uid === uid) applyServerRankingAwards(response.data?.awards);
  return response.data || {};
}

async function publishOverallLeaderboard(uid, profile, name, settings, event = null) {
  if (!settings.enabled) return;
  const entryId = await ensureLeaderboardIdentityForUser(uid);
  await set(ref(database, `online/leaderboard/${entryId}`), leaderboardRecord(profile, name, settings));
  if (event) await recordLeaderboardPeriodResult(event.outcome, event.mode, uid, profile, name, settings);
  else await syncCurrentPeriodLeaderboardMetadata(entryId, uid, profile, name, settings);
  const achievementResponse = await economyActionCallable({ action: "sync_achievement_showcase" });
  if (state.uid === uid) applyAchievementPayload(achievementResponse.data?.achievements, { notifyPending: true });
  await syncServerRankingParticipation(uid, entryId, true);
}

async function syncLeaderboardEntry({ syncPeriodMetadata = true } = {}) {
  if (!state.authReady || !state.uid || !state.leaderboardPublic) return;
  const profile = await ensureOverallProfileSeeded(state.uid, state.name, state.profile);
  const settings = {
    enabled: true,
    xHandle: state.xHandle,
    xPublic: state.xPublic,
    commentsEnabled: state.rankingCommentsEnabled,
  };
  const entryId = await ensureLeaderboardIdentity();
  await set(ref(database, `online/leaderboard/${entryId}`), leaderboardRecord(profile, state.name, settings));
  if (syncPeriodMetadata) await syncCurrentPeriodLeaderboardMetadata(entryId, state.uid, profile, state.name, settings);
  const achievementResponse = await economyActionCallable({ action: "sync_achievement_showcase" });
  applyAchievementPayload(achievementResponse.data?.achievements, { notifyPending: true });
  await syncServerRankingParticipation(state.uid, entryId, true);
}

async function recordOverallResult({ mode, outcome, name, opponentRating = INITIAL_RATING, soloSeed = null, roomId = "" } = {}) {
  if (!LEADERBOARD_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) return null;
  await setPersistence(auth, browserLocalPersistence);
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  await economyActionCallable({ action: "initialize" });
  const displayName = String(name || localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER").trim().slice(0, 16) || "PLAYER";
  const resultTimestamp = Date.now() + Number(state.uid === user.uid ? state.serverTimeOffset : publicServerTimeOffset || 0);
  const periodResult = await recordPeriodRewardResult(user.uid, mode, outcome, roomId, resultTimestamp);
  await ensureOverallProfileSeeded(user.uid, displayName, soloSeed || (state.uid === user.uid ? state.profile : null));
  const result = await runTransaction(ref(database, `online/overallProfiles/${user.uid}`), (current) => {
    const record = normalizeOverallProfile(current, displayName);
    const modeRecord = { ...record.modes[mode] };
    if (outcome === "win") { record.wins += 1; modeRecord.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
    else if (outcome === "loss") { record.losses += 1; modeRecord.losses += 1; record.streak = 0; }
    else { record.draws += 1; modeRecord.draws += 1; }
    modeRecord.matches = modeRecord.wins + modeRecord.losses + modeRecord.draws;
    modeRecord.points = (modeRecord.wins * 3) + modeRecord.draws;
    record.modes[mode] = modeRecord;
    record.name = displayName;
    record.rating = calculateRating(record.rating, Math.min(3000, Math.max(100, Number(opponentRating || INITIAL_RATING))), outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0);
    record.updatedAt = Date.now();
    return record;
  });
  if (!result.committed) throw new Error("総合戦績を更新できませんでした。");
  const profile = normalizeOverallProfile(result.snapshot.val(), displayName);
  if (state.uid === user.uid) state.overallProfile = profile;
  const settings = leaderboardPublicSettings();
  if (settings.enabled) await publishOverallLeaderboard(user.uid, profile, displayName, settings, { mode, outcome });
  return {
    ...profile,
    economyBalance: periodResult?.economyBalance ?? null,
  };
}

function persistOverallRankingPreference(settings) {
  localStorage.setItem(RANKING_PUBLIC_KEY, settings.enabled ? "1" : "0");
  localStorage.setItem(X_HANDLE_KEY, normalizeXHandle(settings.xHandle || ""));
  localStorage.setItem(X_PUBLIC_KEY, settings.enabled && settings.xPublic ? "1" : "0");
  localStorage.setItem(RANKING_COMMENTS_ENABLED_KEY, settings.commentsEnabled ? "1" : "0");
}

function applyOverallRankingPreferenceToState(settings) {
  state.leaderboardPublic = Boolean(settings.enabled);
  state.xHandle = normalizeXHandle(settings.xHandle || "");
  state.xPublic = Boolean(settings.enabled && settings.xPublic);
  state.rankingCommentsEnabled = Boolean(settings.commentsEnabled);
}

function dispatchOverallRankingPreference(settings = getOverallRankingPreference()) {
  window.dispatchEvent(new CustomEvent("hariai-ranking-preference-updated", { detail: settings }));
}

async function setOverallRankingParticipation(enabled, name = "") {
  const previous = getOverallRankingPreference();
  const next = { ...previous, enabled: Boolean(enabled), xPublic: Boolean(enabled && previous.xPublic) };
  const displayName = String(name || localStorage.getItem(PROFILE_NAME_KEY) || state.name || "PLAYER").trim().slice(0, 16) || "PLAYER";
  persistOverallRankingPreference(next);
  applyOverallRankingPreferenceToState(next);
  try {
    const user = await ensureRankingCommentUser();
    if (next.enabled) {
      const profile = await ensureOverallProfileSeeded(user.uid, displayName, state.uid === user.uid ? state.profile : null);
      await publishOverallLeaderboard(user.uid, profile, displayName, next);
    } else {
      await syncServerRankingParticipation(user.uid, "", false);
      await removeLeaderboardEntryForUser(user.uid);
    }
    const saved = getOverallRankingPreference();
    applyOverallRankingPreferenceToState(saved);
    dispatchOverallRankingPreference(saved);
    return saved;
  } catch (error) {
    persistOverallRankingPreference(previous);
    applyOverallRankingPreferenceToState(previous);
    dispatchOverallRankingPreference(previous);
    throw error;
  }
}

async function saveOverallRankingPublicSettings({ xHandle = "", xPublic = false, commentsEnabled = true, name = "" } = {}) {
  const previous = getOverallRankingPreference();
  if (!previous.enabled) throw new Error("先にオンライン総合ランキングへの参加を有効にしてください。");
  const normalizedHandle = normalizeXHandle(xHandle);
  if (normalizedHandle && !X_HANDLE_PATTERN.test(normalizedHandle)) throw new Error("Xのユーザー名は半角英数字と_で15文字以内にしてください。");
  if (xPublic && !normalizedHandle) throw new Error("公開するXのユーザー名を入力してください。");
  const next = {
    ...previous,
    xHandle: normalizedHandle,
    xPublic: Boolean(xPublic),
    commentsEnabled: Boolean(commentsEnabled),
  };
  const displayName = String(name || localStorage.getItem(PROFILE_NAME_KEY) || state.name || "PLAYER").trim().slice(0, 16) || "PLAYER";
  persistOverallRankingPreference(next);
  applyOverallRankingPreferenceToState(next);
  try {
    const user = await ensureRankingCommentUser();
    const profile = await ensureOverallProfileSeeded(user.uid, displayName, state.uid === user.uid ? state.profile : null);
    await publishOverallLeaderboard(user.uid, profile, displayName, next);
    const saved = getOverallRankingPreference();
    applyOverallRankingPreferenceToState(saved);
    dispatchOverallRankingPreference(saved);
    return saved;
  } catch (error) {
    persistOverallRankingPreference(previous);
    applyOverallRankingPreferenceToState(previous);
    dispatchOverallRankingPreference(previous);
    throw error;
  }
}

async function removeLeaderboardEntryForUser(uid) {
  if (!uid) return;
  let entryId = state.uid === uid ? state.leaderboardId : "";
  if (!entryId) {
    const existing = await get(ref(database, `online/leaderboardEntriesByUser/${uid}`));
    entryId = existing.exists() ? String(existing.val()) : "";
  }
  if (!entryId) return;
  if (state.uid === uid) state.leaderboardId = entryId;
  const periodIndexRef = ref(database, `online/leaderboardPeriodEntriesByUser/${uid}`);
  const periodIndex = await get(periodIndexRef);
  const removals = {
    [`online/leaderboard/${entryId}`]: null,
  };
  if (periodIndex.exists()) {
    Object.entries(periodIndex.val() || {}).forEach(([period, keys]) => {
      if (!LEADERBOARD_PERIODS.includes(period) || !keys || typeof keys !== "object") return;
      Object.entries(keys).forEach(([key, indexedEntryId]) => {
        if (String(indexedEntryId) !== entryId) return;
        removals[`online/leaderboardPeriods/${period}/${key}/${entryId}`] = null;
        removals[`online/leaderboardPeriodEntriesByUser/${uid}/${period}/${key}`] = null;
      });
    });
  }
  await update(ref(database), removals);
}

function removeDeckItem(id) {
  const item = state.deck.find((candidate) => candidate.id === id);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.deck = state.deck.filter((candidate) => candidate.id !== id);
  if (state.signatureCardId === id) state.signatureCardId = "";
  state.deck.forEach((candidate, index) => { candidate.position = index; });
  render();
}

function isCurrentMatchmakingGeneration(generation) {
  return active
    && state.screen === "matching"
    && state.matchmakingGeneration === generation
    && !state.roomId;
}

async function removeQueueEntryIfCurrent(queueEntryRef, joinedAt) {
  await runTransaction(queueEntryRef, (current) => (
    current && Number(current.joinedAt) === Number(joinedAt) ? null : undefined
  )).catch(() => {});
}

async function beginMatchmaking() {
  state.name = state.name.trim().slice(0, 16);
  state.imagePreference = normalizeImagePreference(state.imagePreference, "");
  if (!state.uid || state.deck.length !== MAX_ROUNDS || !state.name || !state.imagePreference) return;
  const sampleCount = getDeckSampleCount();
  const startingHp = getStartingHp(sampleCount);
  const joinedAt = Date.now();
  const generation = ++matchmakingGenerationCounter;
  state.matchmakingGeneration = generation;
  state.matchScopeAvailable = false;
  state.matchScopeExpanded = false;
  state.pursuitLine = state.pursuitLineChoice === CUSTOM_PURSUIT_VALUE
    ? normalizePursuitLine(state.customPursuitLine)
    : normalizePursuitLine(state.pursuitLineChoice);
  state.finishLine = state.finishLineChoice === FINISH_LINE_DISABLED_VALUE
    ? ""
    : state.finishLineChoice === CUSTOM_FINISH_VALUE
      ? normalizeFinishLine(state.customFinishLine)
      : normalizeFinishLine(state.finishLineChoice);
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  localStorage.setItem(PURSUIT_LINE_KEY, state.pursuitLine);
  localStorage.setItem(FINISH_LINE_KEY, state.finishLine || FINISH_LINE_DISABLED_VALUE);
  localStorage.setItem(IMAGE_PREFERENCE_KEY, state.imagePreference);
  if (state.leaderboardPublic) syncLeaderboardEntry().catch(() => showToast("ランキング情報を更新できませんでした。"));
  state.screen = "matching";
  setOnlineChrome("MATCHING");
  render();

  const ownActiveRef = ref(database, `online/active/${state.uid}`);
  const staleActive = await get(ownActiveRef);
  if (!isCurrentMatchmakingGeneration(generation)) return;
  if (staleActive.exists()) await remove(ownActiveRef);
  if (!isCurrentMatchmakingGeneration(generation)) return;
  const ownOffersRef = ref(database, `online/offers/${state.uid}`);
  const staleOffers = await get(ownOffersRef);
  if (!isCurrentMatchmakingGeneration(generation)) return;
  if (staleOffers.exists()) {
    await Promise.allSettled(Object.keys(staleOffers.val()).map((roomId) => (
      remove(ref(database, `online/offers/${state.uid}/${roomId}`))
    )));
  }
  if (!isCurrentMatchmakingGeneration(generation)) return;
  const queueEntryRef = ref(database, `online/queue/${state.uid}`);
  await set(queueEntryRef, {
    uid: state.uid,
    name: state.name,
    pursuitLine: state.pursuitLine,
    streak: Number(state.profile.streak || 0),
    rating: Number(state.profile.rating || INITIAL_RATING),
    ratingPreference: state.imagePreference,
    allowPreferenceMismatch: false,
    sampleCount,
    startingHp,
    joinedAt,
    lastSeen: joinedAt,
    state: "waiting",
  });
  if (!isCurrentMatchmakingGeneration(generation)) {
    await removeQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  const presenceStarted = await startPublicPresence(generation);
  if (!presenceStarted || !isCurrentMatchmakingGeneration(generation)) {
    await removeQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  const queueDisconnect = onDisconnect(queueEntryRef);
  await queueDisconnect.remove();
  if (!isCurrentMatchmakingGeneration(generation)) {
    await queueDisconnect.cancel().catch(() => {});
    await removeQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  state.disconnectHandles.push(queueDisconnect);
  if (state.imagePreference !== "both") {
    state.matchScopeTimer = window.setTimeout(() => {
      if (!isCurrentMatchmakingGeneration(generation) || state.matchScopeExpanded) return;
      state.matchScopeAvailable = true;
      render();
    }, MATCH_SCOPE_EXPAND_DELAY_MS);
  }
  state.queueHeartbeat = window.setInterval(() => {
    update(queueEntryRef, { lastSeen: Date.now() })
      .then(() => attemptToHost(state.latestQueue))
      .catch(() => {});
  }, 20_000);

  state.matchUnsubscribers.push(onValue(ownOffersRef, processIncomingOffers, handleRecoverableError));
  state.offerPollTimer = window.setInterval(() => {
    if (!active || state.screen !== "matching" || state.roomId) return;
    get(ownOffersRef).then(processIncomingOffers).catch(handleRecoverableError);
  }, 1_500);
  state.matchUnsubscribers.push(onValue(ref(database, "online/active"), (snapshot) => {
    state.activeUsers = snapshot.val() || {};
    attemptToHost(state.latestQueue).catch(handleRecoverableError);
  }));
  state.matchUnsubscribers.push(onValue(ref(database, "online/queue"), (snapshot) => {
    state.latestQueue = snapshot.val() || {};
    attemptToHost(state.latestQueue).catch(handleRecoverableError);
  }));
}

async function startPublicPresence(generation) {
  if (!isCurrentMatchmakingGeneration(generation)) return false;
  await cleanupPublicPresence();
  if (!isCurrentMatchmakingGeneration(generation)) return false;
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await set(ownerRef, state.uid);
  if (!isCurrentMatchmakingGeneration(generation)) {
    await remove(ownerRef).catch(() => {});
    return false;
  }
  await writePublicPresence(presenceRef, "solo", "waiting");
  if (!isCurrentMatchmakingGeneration(generation)) {
    await Promise.allSettled([remove(presenceRef), remove(ownerRef)]);
    return false;
  }
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.remove();
  if (!isCurrentMatchmakingGeneration(generation)) {
    await presenceDisconnect.cancel().catch(() => {});
    await Promise.allSettled([remove(presenceRef), remove(ownerRef)]);
    return false;
  }
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = presenceDisconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (!state.publicPresenceId) return;
    writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), "solo", state.publicPresenceState).catch(() => {});
  }, PUBLIC_PRESENCE_HEARTBEAT_MS);
  return true;
}

async function updatePublicPresence(nextState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = nextState;
  await writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), "solo", nextState);
}

async function writePublicPresence(presenceRef, mode, presenceState) {
  const lastSeen = Date.now();
  try {
    await set(presenceRef, { mode, state: presenceState, lastSeen });
  } catch (error) {
    const detail = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (!detail.includes("permission_denied") && !detail.includes("permission-denied")) throw error;
    await set(presenceRef, { state: presenceState, lastSeen });
  }
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  const presenceId = state.publicPresenceId;
  state.publicPresenceId = "";
  state.publicPresenceState = "";
  if (!presenceId || !state.uid) return;
  await remove(ref(database, `online/publicPresence/${presenceId}`)).catch(() => {});
  await remove(ref(database, `online/publicPresenceOwners/${presenceId}`)).catch(() => {});
}

function processIncomingOffers(snapshot) {
  const offers = snapshot.val() || {};
  const newest = Object.entries(offers).sort(([, first], [, second]) => Number(second.createdAt) - Number(first.createdAt))[0];
  state.pendingIncomingOffer = newest ? { roomId: newest[0], offer: newest[1] } : null;
  drainIncomingOffers().catch(handleRecoverableError);
}

async function expandMatchmakingScope() {
  if (!active || state.screen !== "matching" || state.roomId || state.imagePreference === "both" || state.matchScopeExpanded) return;
  window.clearTimeout(state.matchScopeTimer);
  state.matchScopeTimer = null;
  state.matchScopeAvailable = false;
  state.matchScopeExpanded = true;
  render();
  const lastSeen = Date.now();
  try {
    await update(ref(database, `online/queue/${state.uid}`), {
      allowPreferenceMismatch: true,
      lastSeen,
    });
    state.latestQueue = {
      ...state.latestQueue,
      [state.uid]: {
        ...state.latestQueue[state.uid],
        allowPreferenceMismatch: true,
        lastSeen,
      },
    };
    await attemptToHost(state.latestQueue);
  } catch (error) {
    state.matchScopeExpanded = false;
    state.matchScopeAvailable = true;
    if (state.screen === "matching") render();
    showToast("検索範囲を広げられませんでした。通信状態を確認してください。");
  }
}

function getPreferenceMatchTier(firstEntry, secondEntry) {
  const firstPreference = normalizeImagePreference(firstEntry?.ratingPreference, "legacy");
  const secondPreference = normalizeImagePreference(secondEntry?.ratingPreference, "legacy");
  if (firstPreference !== "legacy" && firstPreference === secondPreference) {
    return firstPreference === "both" ? 1 : 0;
  }
  if (firstPreference === "both" || secondPreference === "both") return 1;
  if (firstPreference === "legacy" && secondPreference === "legacy") return 1;
  const firstAllowsMismatch = firstPreference === "legacy" || firstEntry?.allowPreferenceMismatch === true;
  const secondAllowsMismatch = secondPreference === "legacy" || secondEntry?.allowPreferenceMismatch === true;
  return firstAllowsMismatch && secondAllowsMismatch ? 2 : Number.POSITIVE_INFINITY;
}

function findPreferredMatchPair(waiting) {
  for (const tier of [0, 1, 2]) {
    for (let hostIndex = 0; hostIndex < waiting.length - 1; hostIndex += 1) {
      const host = waiting[hostIndex];
      const candidates = waiting
        .slice(hostIndex + 1)
        .filter((candidate) => getPreferenceMatchTier(host, candidate) === tier);
      if (!candidates.length) continue;
      return {
        host,
        candidate: candidates[Math.floor(Math.random() * candidates.length)],
      };
    }
  }
  return null;
}

async function attemptToHost(queue) {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingOffer || state.pendingOffer) return;
  const freshAfter = Date.now() - 45_000;
  const waiting = Object.values(queue).filter((entry) => (
    entry?.uid
    && entry.state === "waiting"
    && Number(entry.lastSeen) >= freshAfter
    && !state.activeUsers[entry.uid]
  ));
  if (waiting.length < 2) return;
  waiting.sort((a, b) => (Number(a.joinedAt) - Number(b.joinedAt)) || String(a.uid).localeCompare(String(b.uid)));
  const pair = findPreferredMatchPair(waiting);
  if (!pair || pair.host.uid !== state.uid) return;
  await createOffer(pair.candidate);
}

async function createOffer(candidate) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/rooms")).key;
  const ownActiveRef = ref(database, `online/active/${state.uid}`);
  try {
    const reservation = await runTransaction(ownActiveRef, (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const roomRef = ref(database, `online/rooms/${roomId}`);
    await set(ref(database, `online/rooms/${roomId}/hostUid`), state.uid);
    await update(roomRef, {
      guestUid: candidate.uid,
      createdAt: serverTimestamp(),
      status: "offered",
      [`members/${state.uid}`]: true,
      [`members/${candidate.uid}`]: true,
      [`players/${state.uid}`]: { uid: state.uid, name: state.name, pursuitLine: state.pursuitLine, streak: Number(state.profile.streak || 0), rating: Number(state.profile.rating || INITIAL_RATING), sampleCount: getDeckSampleCount(), startingHp: getStartingHp(getDeckSampleCount()) },
      [`players/${candidate.uid}`]: { uid: candidate.uid, name: candidate.name, pursuitLine: normalizePursuitLine(candidate.pursuitLine), streak: Number(candidate.streak || 0), rating: Number(candidate.rating || INITIAL_RATING), sampleCount: normalizeSampleCount(candidate.sampleCount), startingHp: getStartingHp(candidate.sampleCount) },
    });
    await set(ref(database, `online/offers/${candidate.uid}/${roomId}`), {
      roomId,
      fromUid: state.uid,
      toUid: candidate.uid,
      fromName: state.name,
      createdAt: Date.now(),
    });
    await update(ref(database, `online/queue/${state.uid}`), { state: "offering", roomId });
    state.pendingOffer = { roomId, targetUid: candidate.uid };
    const roomStatusRef = ref(database, `online/rooms/${roomId}/status`);
    const handleHostedRoomStatus = async (snapshot) => {
      if (snapshot.val() !== "active" || state.roomId) return;
      await remove(ref(database, `online/offers/${candidate.uid}/${roomId}`)).catch(() => {});
      await enterRoom(roomId);
    };
    const unsubscribe = onValue(roomStatusRef, (snapshot) => {
      handleHostedRoomStatus(snapshot).catch(handleRecoverableError);
    }, handleRecoverableError);
    state.matchUnsubscribers.push(unsubscribe);
    state.hostStatusPollTimer = window.setInterval(() => {
      if (!active || state.screen !== "matching" || state.roomId || state.pendingOffer?.roomId !== roomId) return;
      get(roomStatusRef).then(handleHostedRoomStatus).catch(handleRecoverableError);
    }, 1_500);
    state.matchTimer = window.setTimeout(() => expireOffer(roomId, candidate.uid), MATCH_TIMEOUT_MS);
  } finally {
    state.matchingBusy = false;
  }
}

async function expireOffer(roomId, targetUid) {
  if (state.roomId || state.pendingOffer?.roomId !== roomId) return;
  const result = await runTransaction(ref(database, `online/rooms/${roomId}/status`), (current) => current === "offered" ? "expired" : undefined);
  if (!result.committed) return;
  await Promise.allSettled([
    remove(ref(database, `online/offers/${targetUid}/${roomId}`)),
    remove(ref(database, `online/active/${state.uid}`)),
    update(ref(database, `online/queue/${state.uid}`), { state: "waiting", roomId: null }),
  ]);
  state.pendingOffer = null;
}

async function acceptOffer(roomId, offer) {
  if (!active || state.screen !== "matching" || state.roomId) return;
  if (!offer || offer.toUid !== state.uid) return;
  state.acceptingOffer = true;
  try {
    const roomSnapshot = await get(ref(database, `online/rooms/${roomId}`));
    const room = roomSnapshot.val();
    if (!room || room.status !== "offered" || !room.members?.[state.uid] || room.hostUid !== offer.fromUid) {
      await remove(ref(database, `online/offers/${state.uid}/${roomId}`));
      return;
    }
    const [ownQueueSnapshot, hostQueueSnapshot] = await Promise.all([
      get(ref(database, `online/queue/${state.uid}`)),
      get(ref(database, `online/queue/${room.hostUid}`)),
    ]);
    if (
      !ownQueueSnapshot.exists()
      || !hostQueueSnapshot.exists()
      || !Number.isFinite(getPreferenceMatchTier(ownQueueSnapshot.val(), hostQueueSnapshot.val()))
    ) {
      await remove(ref(database, `online/offers/${state.uid}/${roomId}`));
      return;
    }
    const reservation = await runTransaction(ref(database, `online/active/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const roomStatusRef = ref(database, `online/rooms/${roomId}/status`);
    const currentStatus = await get(roomStatusRef);
    if (currentStatus.val() !== "offered") {
      await remove(ref(database, `online/active/${state.uid}`));
      return;
    }
    await set(roomStatusRef, "active");
    await Promise.allSettled([
      remove(ref(database, `online/offers/${state.uid}/${roomId}`)),
      remove(ref(database, `online/queue/${state.uid}`)),
    ]);
    await enterRoom(roomId);
  } finally {
    state.acceptingOffer = false;
  }
}

async function drainIncomingOffers() {
  if (state.acceptingOffer) return;
  while (active && state.screen === "matching" && !state.roomId && state.pendingIncomingOffer) {
    const incoming = state.pendingIncomingOffer;
    state.pendingIncomingOffer = null;
    await acceptOffer(incoming.roomId, incoming.offer);
  }
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  state.roomId = roomId;
  const snapshot = await get(ref(database, `online/rooms/${roomId}`));
  const room = snapshot.val();
  if (!room || !room.members?.[state.uid]) throw new Error("ルーム情報を取得できませんでした。");
  state.room = room;
  state.opponentUid = room.hostUid === state.uid ? room.guestUid : room.hostUid;
  state.playerIndex = room.hostUid === state.uid ? 0 : 1;
  state.players = [room.players[room.hostUid], room.players[room.guestUid]].map((player) => {
    const sampleCount = normalizeSampleCount(player.sampleCount);
    const startingHp = getStartingHp(sampleCount);
    return {
      ...player,
      pursuitLine: normalizePursuitLine(player.pursuitLine),
      sampleCount,
      startingHp,
      maxHp: startingHp,
      hp: startingHp,
      totalReceived: 0,
      criticals: 0,
      perfects: 0,
    };
  });
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  state.peerStatus = "P2P接続を準備中…";
  setOnlineChrome("ONLINE BATTLE");
  render();
  await setupRoomListeners();
  await setupPeerConnection();
}

async function setupRoomListeners() {
  const base = `online/rooms/${state.roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
    if (state.selectionTimer) updateSelectionCountdown();
  }));
  const activeDisconnect = onDisconnect(ref(database, `online/active/${state.uid}`));
  await activeDisconnect.remove();
  state.disconnectHandles.push(activeDisconnect);
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);

  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (snapshot.exists() && snapshot.val().by !== state.uid) handleOpponentDestroyed();
  }));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${state.opponentUid}`), (snapshot) => {
    state.opponentOnline = snapshot.val()?.online !== false;
    document.querySelectorAll(".online-room-strip .connection-pill")[1]?.classList.toggle("warning", !state.opponentOnline);
  }));
  const chatQuery = query(ref(database, `${base}/chat`), limitToLast(50));
  state.roomUnsubscribers.push(onChildAdded(chatQuery, (snapshot) => {
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 50) state.chatMessages.shift();
    refreshChat();
  }));
  listenToRound();
}

function listenToRound() {
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = onValue(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}`), (snapshot) => {
    state.roundData = snapshot.val() || {};
    reactToRoundData().catch(handleRecoverableError);
  });
}

async function setupPeerConnection() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像転送に対応していません。");
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  state.peer = peer;
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.onconnectionstatechange = () => {
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    if (["failed", "closed"].includes(peer.connectionState) && active && state.screen !== "noContest") {
      showToast("P2P接続が切れました。ルーム破棄で退出できます。");
    }
    if (state.screen === "connecting") render();
  };
  peer.ondatachannel = (event) => configureDataChannel(event.channel);

  const signalsRef = ref(database, `online/rooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      await handleSignal(snapshot.val());
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }));

  if (state.playerIndex === 0) {
    const channel = peer.createDataChannel("hariai-images", { ordered: true });
    configureDataChannel(channel);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
  }
}

async function sendSignal(type, payload) {
  await set(push(ref(database, `online/rooms/${state.roomId}/signals/${state.opponentUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: Date.now(),
  });
}

async function handleSignal(signal) {
  if (!signal || signal.fromUid !== state.opponentUid || !state.peer) return;
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await state.peer.setRemoteDescription(payload);
    await flushPendingIce();
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    await sendSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await state.peer.setRemoteDescription(payload);
    await flushPendingIce();
  } else if (signal.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  }
}

async function flushPendingIce() {
  while (state.pendingIce.length) await state.peer.addIceCandidate(state.pendingIce.shift());
}

function configureDataChannel(channel) {
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    state.channelReady = true;
    state.peerStatus = "● P2P接続済み";
    sendProfileAvatar().catch(handleRecoverableError);
    if (state.screen === "connecting") {
      state.screen = "select";
      render();
    }
    announceSelectionReady().catch(handleRecoverableError);
  };
  channel.onclose = () => {
    state.channelReady = false;
    state.peerStatus = "P2P接続が切れました";
  };
  channel.onerror = () => showToast("画像転送で通信エラーが発生しました。");
  channel.onmessage = (event) => handleChannelMessage(event.data).catch(handleRecoverableError);
}

async function handleChannelMessage(data) {
  if (typeof data === "string") {
    const message = JSON.parse(data);
    if (message.type === "profile-avatar-start") {
      const size = Number(message.size);
      if (!Number.isFinite(size) || size <= 0 || size > PROFILE_AVATAR_MAX_BYTES) throw new Error("プロフィール画像の受信サイズが不正です。");
      if (message.mime !== "image/webp") throw new Error("プロフィール画像の形式が不正です。");
      state.incomingAvatarTransfer = { mime: "image/webp", size, chunks: [], received: 0 };
    } else if (message.type === "profile-avatar-end") {
      finishIncomingProfileAvatar();
    } else if (message.type === "profile-avatar-empty") {
      releaseRemoteAvatar();
    } else if (message.type === "image-start") {
      const round = Number(message.round);
      const size = Number(message.size);
      if (!Number.isInteger(round) || round !== state.round) throw new Error("受信画像のラウンド情報が不正です。");
      if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_TRANSFER_BYTES) throw new Error("受信画像のサイズが不正です。");
      if (message.mime !== "image/webp") throw new Error("受信画像の形式が不正です。");
      state.incomingTransfer = {
        round,
        mime: "image/webp",
        size,
        signature: message.signature === true,
        finishLine: normalizeReceivedFinishLine(message.finishLine),
        chunks: [],
        received: 0,
      };
    } else if (message.type === "image-end") {
      await finishIncomingImage(Number(message.round));
    }
    return;
  }
  if (state.incomingAvatarTransfer) {
    const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
    state.incomingAvatarTransfer.chunks.push(chunk);
    state.incomingAvatarTransfer.received += chunk.byteLength;
    if (state.incomingAvatarTransfer.received > state.incomingAvatarTransfer.size) {
      state.incomingAvatarTransfer = null;
      throw new Error("プロフィール画像の受信サイズが一致しませんでした。");
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  if (state.incomingTransfer.received > state.incomingTransfer.size) {
    state.incomingTransfer = null;
    state.transferProgress = 0;
    throw new Error("受信画像のサイズが宣言値を超えました。");
  }
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
  if (state.screen === "waitingImage") updateTransferText();
}

async function sendProfileAvatar() {
  if (state.avatarSent || !state.channel || state.channel.readyState !== "open") return;
  state.avatarSent = true;
  await shared()?.profileAvatar?.ready?.();
  const avatar = shared()?.profileAvatar?.get?.();
  if (!avatar?.blob || avatar.blob.size > PROFILE_AVATAR_MAX_BYTES) {
    state.channel.send(JSON.stringify({ type: "profile-avatar-empty" }));
    return;
  }
  const buffer = await avatar.blob.arrayBuffer();
  state.channel.send(JSON.stringify({ type: "profile-avatar-start", size: buffer.byteLength, mime: avatar.blob.type || "image/webp" }));
  for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
    await waitForDataBuffer();
    state.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
  }
  state.channel.send(JSON.stringify({ type: "profile-avatar-end" }));
}

function finishIncomingProfileAvatar() {
  const transfer = state.incomingAvatarTransfer;
  if (!transfer || transfer.received !== transfer.size) throw new Error("プロフィール画像の受信が完了していません。");
  releaseRemoteAvatar();
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  state.remoteAvatar = { blob, url: URL.createObjectURL(blob) };
  state.incomingAvatarTransfer = null;
  if (!["connecting", "gameover", "noContest", "error"].includes(state.screen)) render();
}

function releaseRemoteAvatar() {
  if (state.remoteAvatar?.url) URL.revokeObjectURL(state.remoteAvatar.url);
  state.remoteAvatar = null;
  state.incomingAvatarTransfer = null;
}

async function finishIncomingImage(round) {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.round !== round || transfer.received !== transfer.size) throw new Error("受信画像のサイズが一致しませんでした。");
  const previous = state.remoteImages.get(round);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  const blob = new Blob(transfer.chunks, { type: transfer.mime || "image/webp" });
  state.remoteImages.set(round, {
    blob,
    url: URL.createObjectURL(blob),
    signature: transfer.signature === true,
    finishLine: normalizeReceivedFinishLine(transfer.finishLine),
  });
  state.incomingTransfer = null;
  state.transferProgress = 100;
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${round}/imagesReceived/${state.uid}`), true);
}

function hasSelectionStarted() {
  return Number.isFinite(state.selectionStartedAt) && state.selectionStartedAt > 0;
}

async function announceSelectionReady() {
  if (!active || !state.roomId || !state.channelReady || state.screen !== "select" || state.selectionReadyRound === state.round) return;
  const readyRound = state.round;
  state.selectionReadyRound = readyRound;
  try {
    await set(ref(database, `online/rooms/${state.roomId}/rounds/${readyRound}/selectionReady/${state.uid}`), true);
  } catch (error) {
    if (state.round === readyRound) state.selectionReadyRound = 0;
    throw error;
  }
}

async function startSharedSelectionClock() {
  const startRound = state.round;
  if (state.playerIndex !== 0 || state.selectionStartRequestRound === startRound
      || Number(state.roundData.selectionStartedAt) > 0) return;
  state.selectionStartRequestRound = startRound;
  try {
    await set(ref(database, `online/rooms/${state.roomId}/rounds/${startRound}/selectionStartedAt`), serverTimestamp());
  } catch (error) {
    if (state.round === startRound) state.selectionStartRequestRound = 0;
    throw error;
  }
}

function startSelectionTimer(startedAt) {
  const firstStart = state.selectionStartedAt !== startedAt;
  if (firstStart) {
    stopSelectionTimer();
    state.selectionStartedAt = startedAt;
    state.selectionLastSoundSecond = null;
    state.selectionTimeoutHandledRound = 0;
    state.selectionRemainingMs = Math.max(0, SELECTION_TIME_LIMIT_MS - ((Date.now() + state.serverTimeOffset) - startedAt));
    if (state.screen === "select") render();
  }
  if (!state.selectionTimer && state.screen === "select") {
    state.selectionTimer = window.setInterval(updateSelectionCountdown, 100);
  }
  updateSelectionCountdown();
}

function updateSelectionCountdown() {
  if (state.screen !== "select" || !hasSelectionStarted()) {
    stopSelectionTimer();
    return;
  }
  state.selectionRemainingMs = Math.max(0, (state.selectionStartedAt + SELECTION_TIME_LIMIT_MS) - (Date.now() + state.serverTimeOffset));
  const remainingSeconds = Math.max(0, Math.ceil(state.selectionRemainingMs / 1000));
  updateSelectionTimerDisplay(remainingSeconds);
  if (remainingSeconds > 0 && remainingSeconds <= SELECTION_WARNING_SECONDS
      && state.selectionLastSoundSecond !== remainingSeconds) {
    state.selectionLastSoundSecond = remainingSeconds;
    window.HariaiAudio?.playCountdown?.(remainingSeconds);
  }
  if (state.selectionRemainingMs <= 0 && state.selectionTimeoutHandledRound !== state.round) {
    state.selectionTimeoutHandledRound = state.round;
    stopSelectionTimer();
    handleSelectionTimeout().catch(handleRecoverableError);
  }
}

function updateSelectionTimerDisplay(remainingSeconds) {
  const timer = document.querySelector("[data-selection-timer]");
  if (!timer) return;
  const progress = Math.max(0, Math.min(100, (state.selectionRemainingMs / SELECTION_TIME_LIMIT_MS) * 100));
  timer.style.setProperty("--selection-progress", `${progress}%`);
  timer.classList.toggle("warning", remainingSeconds <= SELECTION_WARNING_SECONDS);
  timer.setAttribute("aria-label", `画像選択 残り${remainingSeconds}秒`);
  const seconds = timer.querySelector("[data-selection-seconds]");
  const unit = timer.querySelector("[data-selection-unit]");
  if (seconds) seconds.textContent = String(remainingSeconds);
  if (unit) unit.textContent = "SEC";
}

async function handleSelectionTimeout() {
  if (state.screen !== "select" || state.selectionLocking) return;
  const hadSelection = Boolean(state.selectedCardId);
  if (!hadSelection) {
    const available = state.deck.filter((item) => !item.used);
    if (!available.length) return;
    state.selectedCardId = available[Math.floor(Math.random() * available.length)].id;
  }
  window.HariaiAudio?.playCountdown?.(0);
  showToast(hadSelection
    ? "時間切れのため、選択中の画像を自動ロックしました。"
    : "時間切れのため、未使用画像を自動選択しました。");
  await lockSelection();
}

function stopSelectionTimer() {
  if (state.selectionTimer) window.clearInterval(state.selectionTimer);
  state.selectionTimer = null;
}

function resetSelectionTimerState() {
  stopSelectionTimer();
  state.selectionStartedAt = 0;
  state.selectionRemainingMs = SELECTION_TIME_LIMIT_MS;
  state.selectionLastSoundSecond = null;
  state.selectionReadyRound = 0;
  state.selectionStartRequestRound = 0;
  state.selectionTimeoutHandledRound = 0;
  state.selectionLocking = false;
}

async function lockSelection() {
  if (!state.selectedCardId || !state.channelReady || !hasSelectionStarted() || state.selectionLocking) return;
  state.selectionLocking = true;
  stopSelectionTimer();
  state.screen = "waitingPick";
  render();
  try {
    await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/picks/${state.uid}`), {
      ready: true,
      lockedAt: serverTimestamp(),
    });
  } finally {
    state.selectionLocking = false;
  }
}

async function reactToRoundData() {
  const selectionReady = state.roundData.selectionReady || {};
  if (state.playerIndex === 0 && selectionReady[state.uid] && selectionReady[state.opponentUid]
      && !Number.isFinite(Number(state.roundData.selectionStartedAt))) {
    startSharedSelectionClock().catch(handleRecoverableError);
  }
  const selectionStartedAt = Number(state.roundData.selectionStartedAt);
  if (Number.isFinite(selectionStartedAt) && selectionStartedAt > 0 && state.screen === "select") {
    startSelectionTimer(selectionStartedAt);
  }
  const picks = state.roundData.picks || {};
  if (picks[state.uid]?.ready && picks[state.opponentUid]?.ready && !state.sentImageRounds.has(state.round)) {
    await sendSelectedImage();
  }
  const received = state.roundData.imagesReceived || {};
  if (received[state.uid] && received[state.opponentUid] && state.remoteImages.has(state.round)
      && ["waitingPick", "waitingImage"].includes(state.screen)) {
    state.screen = "reveal";
    render();
  }
  const scores = state.roundData.scores || {};
  if (Number.isInteger(scores[state.uid]) && Number.isInteger(scores[state.opponentUid])) resolveRound(scores);
  const continued = state.roundData.continue || {};
  if (continued[state.uid] && continued[state.opponentUid]) advanceAfterRound();
}

async function sendSelectedImage() {
  const item = getSelectedItem();
  if (!item?.blob || !state.channel || state.channel.readyState !== "open") return;
  state.sentImageRounds.add(state.round);
  state.screen = "waitingImage";
  state.transferProgress = 0;
  render();
  const buffer = await item.blob.arrayBuffer();
  try {
    state.channel.send(JSON.stringify({
      type: "image-start",
      round: state.round,
      size: buffer.byteLength,
      mime: item.blob.type || "image/webp",
      signature: item.id === state.signatureCardId,
      finishLine: state.finishLine,
    }));
    for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
      await waitForDataBuffer();
      state.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      state.transferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
      updateTransferText();
    }
    state.channel.send(JSON.stringify({ type: "image-end", round: state.round }));
  } catch (error) {
    state.sentImageRounds.delete(state.round);
    throw error;
  }
}

function waitForDataBuffer() {
  if (!state.channel || state.channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { state.channel?.removeEventListener("bufferedamountlow", done); resolve(); };
    state.channel.addEventListener("bufferedamountlow", done, { once: true });
  });
}

function updateTransferText() {
  const card = document.querySelector(".online-status-card p");
  if (card && state.screen === "waitingImage") card.textContent = `転送状況 ${state.transferProgress}%`;
}

async function lockScore() {
  if (!state.selectedScore) return;
  const score = state.selectedScore;
  state.selectedScore = null;
  state.screen = "waitingScore";
  render();
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/scores/${state.uid}`), score);
}

function resolveRound(scores) {
  if (state.processedRounds.has(state.round)) return;
  state.processedRounds.add(state.round);
  const scorePlayerOne = state.playerIndex === 0 ? scores[state.opponentUid] : scores[state.uid];
  const scorePlayerTwo = state.playerIndex === 0 ? scores[state.uid] : scores[state.opponentUid];
  state.players[0].totalReceived += scorePlayerOne;
  state.players[1].totalReceived += scorePlayerTwo;
  [scorePlayerOne, scorePlayerTwo].forEach((score, index) => {
    if (score >= 8) state.players[index].criticals += 1;
    if (score === 10) state.players[index].perfects += 1;
  });
  const selectedItem = getSelectedItem();
  if (selectedItem) selectedItem.used = true;
  let winnerIndex = null;
  let loserIndex = null;
  let damage = 0;
  if (scorePlayerOne > scorePlayerTwo) { winnerIndex = 0; loserIndex = 1; damage = scorePlayerOne; }
  else if (scorePlayerTwo > scorePlayerOne) { winnerIndex = 1; loserIndex = 0; damage = scorePlayerTwo; }
  const previousHp = loserIndex === null ? null : state.players[loserIndex].hp;
  if (loserIndex !== null) state.players[loserIndex].hp = Math.max(0, previousHp - damage);
  const lethal = loserIndex !== null && previousHp > 0 && state.players[loserIndex].hp === 0;
  const finish = lethal ? createFinishCutInPayload(winnerIndex) : null;
  state.history.push({
    round: state.round,
    scorePlayerOne,
    scorePlayerTwo,
    winnerIndex,
    loserIndex,
    damage,
    previousHp,
    lethal,
    finish,
  });
  state.screen = "result";
  render();
  const topScore = Math.max(scorePlayerOne, scorePlayerTwo);
  if (topScore >= 8) window.HariaiAudio?.playResult(topScore);
  if (lethal) {
    triggerFinishCutIn(finish);
  } else if (topScore >= 8) {
    triggerCriticalFx(topScore === 10 ? "PERFECT!!" : "CRITICAL!");
  }
}

async function continueRound() {
  state.screen = "waitingContinue";
  render();
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${state.round}/continue/${state.uid}`), true);
}

function advanceAfterRound() {
  if (state.continuedRounds.has(state.round) || !state.processedRounds.has(state.round)) return;
  state.continuedRounds.add(state.round);
  if (isMatchOver()) {
    finishOnlineMatch().catch(handleRecoverableError);
    return;
  }
  resetSelectionTimerState();
  releaseRemoteImage(state.round);
  state.round += 1;
  state.selectedCardId = "";
  state.selectedScore = null;
  state.roundData = {};
  state.transferProgress = 0;
  state.screen = "select";
  listenToRound();
  render();
  announceSelectionReady().catch(handleRecoverableError);
}

function isMatchOver() {
  return state.players.some((player) => player.hp <= 0) || state.round >= MAX_ROUNDS;
}

function determineOutcome() {
  const [first, second] = state.players;
  if (first.hp !== second.hp) return { winnerIndex: first.hp > second.hp ? 0 : 1, reason: first.hp <= 0 || second.hp <= 0 ? "hp" : "rounds" };
  if (first.totalReceived !== second.totalReceived) return { winnerIndex: first.totalReceived > second.totalReceived ? 0 : 1, reason: "rounds" };
  if (first.criticals !== second.criticals) return { winnerIndex: first.criticals > second.criticals ? 0 : 1, reason: "rounds" };
  if (first.perfects !== second.perfects) return { winnerIndex: first.perfects > second.perfects ? 0 : 1, reason: "rounds" };
  return { winnerIndex: null, reason: "draw" };
}

async function finishOnlineMatch() {
  if (state.outcome) return;
  const outcome = determineOutcome();
  const myWon = outcome.winnerIndex === state.playerIndex;
  const draw = outcome.winnerIndex === null;
  await update(ref(database, `online/rooms/${state.roomId}`), {
    [`resultClaims/${state.uid}`]: {
      outcome: draw ? "draw" : myWon ? "win" : "loss",
      createdAt: serverTimestamp(),
    },
    [`finished/${state.uid}`]: true,
  });
  state.outcome = outcome;
  await commitOnlineStats();
  state.screen = "gameover";
  render();
}

function calculateRating(currentRating, opponentRating, actualScore) {
  const expectedScore = 1 / (1 + (10 ** ((opponentRating - currentRating) / 400)));
  return Math.min(3000, Math.max(100, Math.round(currentRating + RATING_K_FACTOR * (actualScore - expectedScore))));
}

async function commitOnlineStats() {
  if (state.statsCommitted) return;
  state.statsCommitted = true;
  const myWon = state.outcome.winnerIndex === state.playerIndex;
  const draw = state.outcome.winnerIndex === null;
  const opponentRating = Number(getOpponent()?.rating || INITIAL_RATING);
  const actualScore = draw ? 0.5 : myWon ? 1 : 0;
  const soloSeed = { ...state.profile };
  const result = await runTransaction(ref(database, `online/profiles/${state.uid}`), (current) => {
    const record = {
      name: state.name,
      pursuitLine: normalizePursuitLine(state.pursuitLine),
      wins: Number(current?.wins || 0),
      losses: Number(current?.losses || 0),
      draws: Number(current?.draws || 0),
      streak: Number(current?.streak || 0),
      bestStreak: Number(current?.bestStreak || 0),
      rating: Number(current?.rating || INITIAL_RATING),
      updatedAt: Date.now(),
    };
    if (draw) record.draws += 1;
    else if (myWon) { record.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
    else { record.losses += 1; record.streak = 0; }
    record.rating = calculateRating(record.rating, opponentRating, actualScore);
    return record;
  });
  if (result.committed) state.profile = result.snapshot.val();
  if (result.committed) {
    const periodOutcome = draw ? "draw" : myWon ? "win" : "loss";
    await recordOverallResult({
      mode: "solo",
      outcome: periodOutcome,
      name: state.name,
      opponentRating,
      soloSeed,
      roomId: state.roomId,
    }).catch(() => showToast("総合ランキングを更新できませんでした。"));
  }
  state.players.forEach((player, index) => {
    if (draw) return;
    player.streak = state.outcome.winnerIndex === index ? Number(player.streak || 0) + 1 : 0;
  });
}

async function sendChat(value, stampId = "") {
  const stamp = getStamp(stampId);
  if (stampId && (!stamp || !canUseStamp(stampId, state.economy))) {
    showToast("このスタンプは現在の装備に含まれていません。");
    return;
  }
  if (stamp && !acquireStampCooldown("online")) {
    showToast("スタンプは2秒に1回送信できます。");
    return;
  }
  const text = stamp ? stamp.label : String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId) return;
  const message = {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  };
  if (stamp) {
    message.stampId = stamp.id;
    startStampButtonCooldown("[data-online-stamp]");
  }
  const equippedTitle = getTitleProduct();
  if (equippedTitle && state.economy.inventory?.[equippedTitle.id]) message.titleId = equippedTitle.id;
  attachEquippedChatCosmetics(message);
  await set(push(ref(database, `online/rooms/${state.roomId}/chat`)), message).catch(() => showToast("チャットを送信できませんでした。"));
}

function refreshChat() {
  const list = document.querySelector("#onlineChatMessages");
  if (!list) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderOnlineChat();
  const next = wrapper.querySelector("#onlineChatMessages");
  if (next) list.innerHTML = next.innerHTML;
  scrollChat();
}

function scrollChat() {
  const list = document.querySelector("#onlineChatMessages");
  if (list) list.scrollTop = list.scrollHeight;
}

function getSelectedItem() {
  return state.deck.find((item) => item.id === state.selectedCardId);
}

function getOpponent() {
  return state.players[state.playerIndex === 0 ? 1 : 0];
}

function createFinishCutInPayload(winnerIndex) {
  const winnerIsLocal = winnerIndex === state.playerIndex;
  const media = winnerIsLocal ? getSelectedItem() : state.remoteImages.get(state.round);
  const receivedLine = winnerIsLocal
    ? normalizeReceivedFinishLine(state.finishLine)
    : normalizeReceivedFinishLine(media?.finishLine);
  const customOpponentLine = !winnerIsLocal && receivedLine && !FINISH_LINES.includes(receivedLine);
  return {
    winnerName: String(state.players[winnerIndex]?.name || "PLAYER").slice(0, 16),
    imageUrl: String(media?.url || ""),
    signature: winnerIsLocal ? media?.id === state.signatureCardId : media?.signature === true,
    finishLine: customOpponentLine && !state.showOpponentCustomFinish ? FINISH_LINES[0] : receivedLine,
  };
}

function clearFinishCutIn() {
  finishCutInGeneration += 1;
  if (state.finishCutInTimer) window.clearTimeout(state.finishCutInTimer);
  state.finishCutInTimer = null;
  if (finishCutInDialog?.open) finishCutInDialog.close();
  finishCutInContent?.replaceChildren();
}

function triggerFinishCutIn(payload) {
  if (!finishCutInDialog || !finishCutInContent || !payload) return;
  clearFinishCutIn();
  const generation = finishCutInGeneration;
  const cutIn = document.createElement("article");
  cutIn.className = `finish-cutin ${payload.signature ? "is-signature" : "is-standard"}`;
  cutIn.setAttribute("aria-label", `${payload.winnerName}の${payload.signature ? "シグネチャー" : ""}フィニッシュ`);

  if (payload.imageUrl) {
    const backdrop = document.createElement("img");
    backdrop.className = "finish-cutin-backdrop";
    backdrop.src = payload.imageUrl;
    backdrop.alt = "";
    backdrop.setAttribute("aria-hidden", "true");
    cutIn.append(backdrop);
  }

  const shade = document.createElement("div");
  shade.className = "finish-cutin-shade";
  shade.setAttribute("aria-hidden", "true");
  cutIn.append(shade);

  const stage = document.createElement("div");
  stage.className = "finish-cutin-stage";
  const imageFrame = document.createElement("div");
  imageFrame.className = "finish-cutin-image-frame";
  if (payload.imageUrl) {
    const image = document.createElement("img");
    image.className = "finish-cutin-image";
    image.src = payload.imageUrl;
    image.alt = `${payload.winnerName}の決着カード`;
    image.draggable = false;
    imageFrame.append(image);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "finish-cutin-image-fallback";
    fallback.textContent = "FINISH";
    imageFrame.append(fallback);
  }

  const copy = document.createElement("div");
  copy.className = "finish-cutin-copy";
  const label = document.createElement("span");
  label.className = "finish-cutin-label";
  label.textContent = payload.signature ? "SIGNATURE FINISH" : "FINISH";
  const winnerName = document.createElement("strong");
  winnerName.className = "finish-cutin-winner";
  winnerName.textContent = payload.winnerName;
  copy.append(label, winnerName);
  if (payload.finishLine) {
    const quote = document.createElement("blockquote");
    quote.textContent = payload.finishLine;
    copy.append(quote);
  }

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "finish-cutin-skip";
  skip.textContent = "演出をスキップ";
  skip.addEventListener("click", clearFinishCutIn, { once: true });
  stage.append(imageFrame, copy);
  cutIn.append(stage, skip);
  cutIn.addEventListener("click", (event) => {
    if (event.target !== skip) clearFinishCutIn();
  }, { once: true });
  finishCutInContent.replaceChildren(cutIn);
  finishCutInDialog.showModal();
  skip.focus({ preventScroll: true });
  state.finishCutInTimer = window.setTimeout(() => {
    if (generation === finishCutInGeneration) clearFinishCutIn();
  }, FINISH_CUT_IN_DURATION_MS);
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

function requestHome() {
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (["setup", "missions", "shop", "achievements", "matching", "gameover", "noContest", "error"].includes(state.screen)) {
    leaveToLanding();
  } else {
    destroyDialog.showModal();
  }
}

async function destroyRoom() {
  if (!active) return;
  if (state.roomId) {
    await runTransaction(ref(database, `online/rooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now() }).catch(() => {});
  }
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
  showToast("ルームを破棄しました。戦績には影響しません。");
}

async function handleOpponentDestroyed() {
  if (state.destroyedByOpponent) return;
  state.destroyedByOpponent = true;
  await cleanupOnlineResources(false);
  releaseMatchMedia();
  state.screen = "noContest";
  setOnlineChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "setup";
  setOnlineChrome("ONLINE READY");
  render();
}

async function resetOnlineSetup() {
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  await resetOnlineState("setup");
}

function prepareDeckForRematch(items) {
  items.forEach((item, index) => {
    item.position = index;
    item.used = false;
  });
  return items;
}

async function resetOnlineState(screen) {
  const deck = prepareDeckForRematch(state.deck);
  const identity = {
    uid: state.uid,
    profile: state.profile,
    overallProfile: state.overallProfile,
    authReady: state.authReady,
    name: state.name,
    pursuitLine: state.pursuitLine,
    pursuitLineChoice: state.pursuitLineChoice,
    customPursuitLine: state.customPursuitLine,
    finishLine: state.finishLine,
    finishLineChoice: state.finishLineChoice,
    customFinishLine: state.customFinishLine,
    showOpponentCustomFinish: state.showOpponentCustomFinish,
    imagePreference: state.imagePreference,
    signatureCardId: state.signatureCardId,
    economy: state.economy,
    economyReady: state.economyReady,
    dailyPlay: state.dailyPlay,
    achievements: state.achievements,
    achievementsReady: state.achievementsReady,
    notifiedAchievementIds: state.notifiedAchievementIds,
    rankingAwards: state.rankingAwards,
    rankingAwardsReady: state.rankingAwardsReady,
    periodRewardReminderShown: state.periodRewardReminderShown,
    titleCategoryFilter: state.titleCategoryFilter,
    expandedTitleCategories: state.expandedTitleCategories,
    topMessage: state.topMessage,
    topMessageEntryId: state.topMessageEntryId,
    topMessageReady: state.topMessageReady,
    serverTimeOffset: state.serverTimeOffset,
  };
  await cleanupOnlineResources(false);
  releaseMatchMedia();
  state = createOnlineState();
  Object.assign(state, identity);
  state.deck = deck;
  state.screen = screen;
  setOnlineChrome("ONLINE READY");
  render();
}

async function leaveToLanding() {
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive) {
  state.matchmakingGeneration = ++matchmakingGenerationCounter;
  window.clearTimeout(state.matchTimer);
  window.clearTimeout(state.matchScopeTimer);
  window.clearInterval(state.queueHeartbeat);
  window.clearInterval(state.offerPollTimer);
  window.clearInterval(state.hostStatusPollTimer);
  state.matchTimer = null;
  state.matchScopeTimer = null;
  state.matchScopeAvailable = false;
  state.matchScopeExpanded = false;
  state.queueHeartbeat = null;
  state.offerPollTimer = null;
  state.hostStatusPollTimer = null;
  state.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (useOfflineMarketPreview) {
    state.pendingOffer = null;
    state.pendingIncomingOffer = null;
    return;
  }
  const removals = [remove(ref(database, `online/queue/${state.uid}`))];
  if (!keepActive) removals.push(remove(ref(database, `online/active/${state.uid}`)));
  if (state.pendingOffer) removals.push(remove(ref(database, `online/offers/${state.pendingOffer.targetUid}/${state.pendingOffer.roomId}`)));
  await Promise.allSettled(removals);
  state.pendingOffer = null;
  state.pendingIncomingOffer = null;
}

async function cleanupOnlineResources(keepActive) {
  clearFinishCutIn();
  stopSelectionTimer();
  await cleanupMatchmaking(keepActive);
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.roundUnsubscribe?.();
  state.roundUnsubscribe = null;
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (state.peer) {
    state.peer.onicecandidate = null;
    state.peer.ondatachannel = null;
    state.peer.close();
  }
  state.channel?.close();
  state.peer = null;
  state.channel = null;
  if (state.roomId) {
    await Promise.allSettled([
      set(ref(database, `online/rooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/active/${state.uid}`)),
    ]);
  }
}

function releaseRemoteImage(round) {
  const item = state.remoteImages.get(round);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.remoteImages.delete(round);
}

function releaseMatchMedia() {
  state.remoteImages.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  state.remoteImages.clear();
  releaseRemoteAvatar();
  state.chatMessages = [];
}

function releaseAllImages() {
  state.deck.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = "";
    item.blob = null;
  });
  releaseMatchMedia();
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = friendlyFirebaseError(error);
  state.screen = "error";
  setOnlineChrome("CONNECTION ERROR");
  render();
}

function friendlyFirebaseError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。";
  if (error?.code === "PERMISSION_DENIED" || String(error?.message).includes("PERMISSION_DENIED")) return "Realtime Databaseのセキュリティルールにより接続が拒否されました。";
  return error?.message || "Firebaseへ接続できませんでした。";
}

window.addEventListener("beforeunload", () => {
  releaseAllImages();
  state.peer?.close();
});

sampleHandicapDialog?.addEventListener("close", () => {
  const confirmed = sampleHandicapDialog.returnValue === "confirm";
  sampleHandicapDialog.returnValue = "";
  if (confirmed && active && state.screen === "setup") beginMatchmaking();
});

finishCutInDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  clearFinishCutIn();
});

if (!useOfflineMarketPreview) watchLobbyStats();
watchDailyDateRollover();

window.HariaiOnline = {
  start,
  openDailyMissions,
  openPointShop,
  openAchievements,
  getShopProductLabel,
  isActive,
  requestHome,
  destroyRoom,
  getLobbyStats,
  getLeaderboard,
  getLeaderboardStatus,
  getLeaderboardPeriodInfo,
  getLeaderboardLoadedPeriod,
  getServerRankingAwards,
  getMonthlyRankingHallOfFame,
  getMonthlyBeyondRank,
  getMonthlyBeyondPeriodKey,
  isServerRankingPeriod,
  refreshLeaderboard,
  getTopMessages,
  getTopMessagesStatus,
  getMutedTopMessageCount,
  refreshTopMessages,
  muteTopMessage,
  clearMutedTopMessages,
  getLeaderboardComments,
  getLeaderboardCommentIdentity,
  saveLeaderboardComment,
  deleteLeaderboardComment,
  recordOverallResult,
  getOverallRankingPreference,
  renderOverallRankingParticipation,
  bindOverallRankingParticipation,
  setOverallRankingParticipation,
  saveOverallRankingPublicSettings,
};
window.dispatchEvent(new Event("hariai-online-ready"));
