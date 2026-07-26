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
} from "./firebase-services.js?v=app-check-v3-oshi-jouzu-duo-v1-restore-v1";
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
} from "./player-titles.js?v=player-titles-v2-oshi-jouzu-duo-v1-restore-v1";
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
} from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1";
import {
  bindPostMatchTip,
  isPostMatchTipBusy,
  renderPostMatchTip,
} from "./post-match-tip.js?v=post-match-tip-v4-app-check-v3-oshi-jouzu-duo-v1-restore-v1";
import {
  appendIncomingOnlineImageChunk,
  completeIncomingOnlineImageTransfer,
  createIncomingOnlineImageTransfer,
  normalizeOnlineImageMime,
  onlineImageEndStatus,
  verifiedOnlineImageMime,
  verifiedOnlineImageMimeFromChunks,
} from "./online-image-transfer.mjs?v=online-image-transfer-v1";
import {
  appendIncomingEngawaImageChunk,
  assertIncomingTransferNamespaceExclusive,
  completeIncomingEngawaImageTransfer,
  createIncomingEngawaImageTransfer,
  engawaImageEndStatus,
} from "./engawa-image-transfer.mjs?v=engawa-image-transfer-v1";
import {
  beginOnlineStateTransition,
  captureOnlineRoomContext,
  captureOnlineRoundContext,
  isOnlineRoomContextCurrent,
  isOnlineRoundContextCurrent,
  isOnlineSameRoomIdentity,
  isOnlineStateTransitionCurrent,
  runOnlineOpponentDestroyedTransition,
} from "./online-room-lifecycle.mjs?v=online-room-lifecycle-v1";
import {
  ONLINE_P2P_RECOVERY_PHASES,
  createOnlineP2pGenerationToken,
  createOnlineP2pRecoveryState,
  getOnlineP2pRecoveryTimer,
  isOnlineP2pOpponentCoolingDown,
  transitionOnlineP2pRecovery,
} from "./online-p2p-hardening.mjs?v=online-p2p-hardening-v2";
import {
  ONLINE_SESSION_LEASE_DEFAULTS,
  ONLINE_SESSION_PROTOCOL_VERSION,
  ONLINE_SESSION_STORAGE_KEY,
  createOnlineSessionToken,
  createOnlineSessionFence,
  decideOnlineSessionHeartbeatResult,
  decideOnlineSignalEnvelope,
  isValidOnlineSessionId,
  isOnlineSessionLeaseOwner,
  resolveOnlineSessionId,
  shouldConsumeOnlineSignal,
} from "./online-session-guard.mjs?v=online-session-guard-v2";
import {
  CUSTOM_FINISH_REPLY_VALUE,
  FINISH_REPLY_DISABLED_VALUE,
  FINISH_REPLY_LINES,
  MAX_FINISH_REPLY_INPUT_UNITS,
  MAX_FINISH_REPLY_LENGTH,
  ROLEPLAY_VOICE_SETS,
  countFinishReplyCharacters,
  getRoleplayVoiceSet,
  inferRoleplayVoiceSetId,
  normalizeFinishReplyLine,
  normalizeReceivedFinishReplyLine,
  normalizeRoleplayVoiceSetId,
  resolveVisibleFinishReplyLine,
  sanitizeFinishReplyDraft,
} from "./finish-roleplay.mjs?v=finish-reply-v2";

const MAX_HP = 30;
const MAX_ROUNDS = 5;
const SAMPLE_HP_PENALTY = 5;
const MIN_STARTING_HP = 5;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const PURSUIT_LINE_KEY = "hariai-stadium-online-pursuit-line-v1";
const FINISH_LINE_KEY = "hariai-stadium-online-finish-line-v1";
const FINISH_REPLY_LINE_KEY = "hariai-stadium-online-finish-reply-line-v1";
const ROLEPLAY_VOICE_SET_KEY = "hariai-stadium-online-roleplay-voice-v1";
const OPPONENT_CUSTOM_FINISH_KEY = "hariai-stadium-online-opponent-custom-finish-v1";
const IMAGE_PREFERENCE_KEY = "hariai-stadium-online-image-preference-v1";
const SOLO_REUNION_PREFERENCE_KEY = "hariai-stadium-solo-reunion-preference-v1";
const MAX_PURSUIT_LINE_LENGTH = 40;
const MAX_FINISH_LINE_LENGTH = 30;
const CUSTOM_PURSUIT_VALUE = "__custom__";
const CUSTOM_FINISH_VALUE = "__custom_finish__";
const FINISH_LINE_DISABLED_VALUE = "__finish_line_disabled__";
const FINISH_CUT_IN_DURATION_MS = 12_000;
const FINISH_REPLY_SETTLE_DURATION_MS = 1_600;
const FINISH_REPLY_ACK_TIMEOUT_MS = 5_000;
const FINISH_REPLY_PROTOCOL_VERSION = 2;
const FINISH_REPLY_ID_PATTERN = /^[a-f0-9]{32}$/;
const SOLO_STATS_PROJECTION_VERSION = 2;
const LEGACY_PURSUIT_LINES = [
  "その反応、見逃さない。もう一枚いく！",
  "好みは読めた。ここからが本命だ！",
  "刺さったね？ 追撃開始！",
  "まだ終わらない。次の一枚をどうぞ！",
];
const LEGACY_FINISH_LINES = [
  "これで決着だ！",
  "この一枚で、勝負を決める。",
  "最後の一撃、受け取って！",
  "推しの力、見届けたか！",
  "いい勝負だった。またやろう。",
];
const PURSUIT_LINES = Object.freeze(Array.from(new Set([
  ...ROLEPLAY_VOICE_SETS.map(({ pursuitLine }) => pursuitLine),
  ...LEGACY_PURSUIT_LINES,
])));
const FINISH_LINES = Object.freeze(Array.from(new Set([
  ...ROLEPLAY_VOICE_SETS.map(({ finishLine }) => finishLine),
  ...LEGACY_FINISH_LINES,
])));
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
const PENDING_SOLO_PUBLIC_RESULTS_KEY = "hariai-stadium-pending-solo-public-results-v1";
const X_HANDLE_KEY = "hariai-stadium-x-handle-v1";
const X_PUBLIC_KEY = "hariai-stadium-x-public-v1";
const RANKING_COMMENTS_ENABLED_KEY = "hariai-stadium-ranking-comments-enabled-v1";
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const RANKING_COMMENT_MAX_LENGTH = 80;
const RANKING_COMMENT_URL_PATTERN = /(?:https?:\/\/|www\.)/i;
const TOP_MESSAGE_PRODUCT_ID = "feature_top_message";
const CREATOR_CARD_PREMIUM_PREVIEW_LOCKED = useOfflineMarketPreview && new URLSearchParams(window.location.search).get("creatorCardPremium") === "locked";
const TOP_MESSAGE_MAX_LENGTH = 30;
const CREATOR_CARD_URL_PATTERN = /(?:https?:\/\/|www\.|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}(?:[/?#]\S*)?)/i;
const CREATOR_CARD_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/i;
const TOP_MESSAGE_FETCH_LIMIT = 20;
const TOP_MESSAGE_DISPLAY_LIMIT = 10;
const TOP_MESSAGE_MUTED_KEY = "hariai-stadium-muted-top-messages-v1";
const CREATOR_CARD_VERSION = 2;
const CREATOR_CARD_TYPES = Object.freeze([
  Object.freeze({
    id: "illustration",
    label: "イラスト",
    icon: "✦",
    templates: Object.freeze(["Xでイラストを投稿しています", "女の子のイラストを描いています", "新作を見てもらえたら嬉しいです"]),
  }),
  Object.freeze({
    id: "photo",
    label: "写真",
    icon: "▣",
    templates: Object.freeze(["Xで写真を投稿しています", "風景や街の写真を撮っています", "お気に入りの一枚を見にきてね"]),
  }),
  Object.freeze({
    id: "both",
    label: "イラスト・写真",
    icon: "◆",
    templates: Object.freeze(["イラストと写真を投稿しています", "好きな一枚を気ままに投稿中です", "作品を見てもらえたら嬉しいです"]),
  }),
  Object.freeze({
    id: "community",
    label: "対戦・交流",
    icon: "♡",
    templates: Object.freeze(["対戦相手募集中です", "みんなの好きな画像も見たいです", "気軽に声をかけてください"]),
  }),
]);
const CREATOR_CARD_THEMES = Object.freeze([
  Object.freeze({ id: "basic-rose", label: "ローズ", premium: false }),
  Object.freeze({ id: "basic-aqua", label: "アクア", premium: false }),
  Object.freeze({ id: "basic-violet", label: "バイオレット", premium: false }),
  Object.freeze({ id: "basic-sunset", label: "サンセット", premium: false }),
  Object.freeze({ id: "premium-hologram", label: "ホログラム", premium: true }),
  Object.freeze({ id: "premium-stardust", label: "スターダスト", premium: true }),
  Object.freeze({ id: "premium-royal", label: "ロイヤル箔", premium: true }),
]);
const CREATOR_CARD_GROWTH_THRESHOLDS = Object.freeze([0, 1, 10, 30, 100]);
const CREATOR_CARD_GROWTH_LABELS = Object.freeze(["はじまり", "一枚目", "いつもの一枚", "育った一枚", "自分だけの名刺"]);
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
const MAX_POINTS = 999_999_999;
const MAX_EQUIPPED_REACTIONS = 8;
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "センスいい", "もっと見たい"];
const GENERIC_MATCH_MISSION_END_DATE_KEY = "2026-07-23";
const DAILY_MISSIONS = [
  { id: "complete_match", progressKey: "matches", title: "1試合を完走", description: "ルーム破棄では進みません。", target: 1, reward: 100 },
  { id: "score_three", progressKey: "scores", title: "3回採点する", description: "相手の画像を合計3回採点します。", target: 3, reward: 60 },
  { id: "give_critical", progressKey: "criticals", title: "8点以上をつける", description: "CRITICAL評価を1回つけます。", target: 1, reward: 90 },
  { id: "play_solo", progressKey: "soloMatches", title: "通常型1on1を1回完走", description: "通常型1on1の正式な決着が対象です。", target: 1, reward: 40 },
  { id: "play_strategy", progressKey: "strategyMatches", title: "戦略型1on1を1回完走", description: "戦略型1on1の正式な決着が対象です。", target: 1, reward: 50 },
  { id: "play_team", progressKey: "teamMatches", title: "ふたりチャレンジを1回完走", description: "推し上手！ふたりチャレンジの正式な決着が対象です。", target: 1, reward: 70 },
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
  { id: TOP_MESSAGE_PRODUCT_ID, type: "feature", name: "推しカード プレミアム仕上げ", description: "無料の推しカードでホログラム、スターダスト、ロイヤル箔を何度でも使える買い切り機能", price: 500 },
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
const DATA_BUFFER_WAIT_MS = 10_000;
const IMAGE_ACK_WAIT_MS = 15_000;
const MAX_IMAGE_TRANSFER_BYTES = 15 * 1024 * 1024;
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const PROFILE_AVATAR_READY_WAIT_MS = 3_000;
const ENGAWA_MESSAGE_MAX_CHARS = 2048;
const ENGAWA_BUFFER_WAIT_MS = 5000;
const SOLO_SERVER_MATCH_POLL_MS = 3000;
const SOLO_FAMILIAR_STAGES = Object.freeze(["engawa_only", "familiar_book", "reunion"]);
const ENGAWA_MOODS = Object.freeze([
  Object.freeze({ id: "just_look", label: "ただ見てほしい", description: "言葉にしなくても大丈夫" }),
  Object.freeze({ id: "smile", label: "少し笑ってほしい", description: "ふっと力が抜ける一枚" }),
  Object.freeze({ id: "recent_favorite", label: "最近これが好き", description: "近ごろ手元に置きたい一枚" }),
  Object.freeze({ id: "calm", label: "なんとなく落ち着く", description: "理由はなくても心地よい一枚" }),
]);
const ENGAWA_RESPONSES = Object.freeze([
  Object.freeze({ id: "thanks", label: "見せてくれてありがとう" }),
  Object.freeze({ id: "like", label: "これ、好きです" }),
  Object.freeze({ id: "calm", label: "なんか落ち着く" }),
  Object.freeze({ id: "again", label: "また見たい" }),
]);
const PUBLIC_PRESENCE_FRESH_MS = 45_000;
const PUBLIC_PRESENCE_HEARTBEAT_MS = 20_000;
const FREE_TABLE_PUBLIC_STATS_POLL_MS = 60_000;
const FREE_TABLE_PUBLIC_STATS_STALE_MS = 180_000;
const FREE_TABLE_PUBLIC_STATS_MAX_BACKOFF_MS = 240_000;
const FREE_TABLE_PUBLIC_STATS_FUTURE_TOLERANCE_MS = 30_000;
const SOLO_REMATCH_SOFT_WIDEN_MS = 20_000;
const FALLBACK_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);

const economyActionCallable = httpsCallable(functions, "economyAction");
const soloFamiliarActionCallable = httpsCallable(functions, "soloFamiliarAction");
const soloSessionActionCallable = httpsCallable(functions, "soloSessionAction");
const getP2pIceServersCallable = httpsCallable(functions, "getP2pIceServers");
const reportP2pConnectivityCallable = httpsCallable(functions, "reportP2pConnectivity");
const freeTablePublicStatsCallable = httpsCallable(functions, "freeTablePublicStats");
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const sampleHandicapDialog = document.querySelector("#sampleHandicapDialog");
const sampleHandicapMessage = document.querySelector("#sampleHandicapMessage");
const confirmSampleMatch = document.querySelector("#confirmSampleMatch");
const fxLayer = document.querySelector("#fxLayer");
const finishCutInDialog = document.querySelector("#finishCutInDialog");
const finishCutInContent = document.querySelector("#finishCutInContent");

let active = false;
let state;
let lastRenderedScreen = "";
let finishCutInGeneration = 0;
let matchmakingGenerationCounter = 0;
let pendingDestroyContext = null;
let lobbyPresenceEntries = null;
let marketPresenceEntries = null;
let freeTablePublicStats = {
  welcomingRooms: null,
  seatedRooms: null,
  updatedAt: null,
};
let freeTablePublicStatsLastSuccessAt = 0;
let freeTablePublicStatsFailureCount = 0;
let freeTablePublicStatsRequest = null;
let freeTablePublicStatsTimer = null;
const LOBBY_MODES = ["solo", "strategy", "team", "royale"];
const createLobbyStats = (value = null) => ({
  ...Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { waiting: value, playing: value }])),
  freeTable: { ...freeTablePublicStats },
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
let publicServerTimeOffsetReady = false;
let topMessageRecords = [];
let topMessagesStatus = "idle";
let topMessagesRequestId = 0;
let cachedP2pIceServers = null;

function loadOrCreateSoloSessionId() {
  const generatedSessionId = createOnlineSessionToken(window.crypto);
  try {
    const decision = resolveOnlineSessionId({
      storedSessionId: sessionStorage.getItem(ONLINE_SESSION_STORAGE_KEY),
      generatedSessionId,
    });
    if (decision.shouldPersist) {
      sessionStorage.setItem(ONLINE_SESSION_STORAGE_KEY, decision.sessionId);
    }
    return decision.sessionId;
  } catch {
    return generatedSessionId;
  }
}

const clientSoloSessionId = loadOrCreateSoloSessionId();
const clientSoloLeaseToken = createOnlineSessionToken(window.crypto);
state = createOnlineState();

function createOnlineState() {
  const leaderboardPublic = localStorage.getItem(RANKING_PUBLIC_KEY) === "1";
  const savedXHandle = normalizeXHandle(localStorage.getItem(X_HANDLE_KEY) || "");
  const pursuitSettings = getSavedPursuitSettings();
  const finishSettings = getSavedFinishSettings();
  const finishReplySettings = getSavedFinishReplySettings();
  const savedVoiceSetId = normalizeRoleplayVoiceSetId(localStorage.getItem(ROLEPLAY_VOICE_SET_KEY));
  const inferredVoiceSetId = inferRoleplayVoiceSetId({
    pursuitLine: pursuitSettings.pursuitLine,
    finishLine: finishSettings.finishLine,
    replyLine: finishReplySettings.finishReplyLine,
  });
  const imagePreference = normalizeImagePreference(localStorage.getItem(IMAGE_PREFERENCE_KEY), "");
  const soloReunionPreference = localStorage.getItem(SOLO_REUNION_PREFERENCE_KEY) === "1";
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    overallProfile: null,
    authReady: false,
    ...pursuitSettings,
    ...finishSettings,
    ...finishReplySettings,
    roleplayVoiceSetId: savedVoiceSetId === inferredVoiceSetId ? savedVoiceSetId : inferredVoiceSetId,
    roleplayVoiceFallbackId: inferredVoiceSetId || savedVoiceSetId || ROLEPLAY_VOICE_SETS[0].id,
    showOpponentCustomFinish: localStorage.getItem(OPPONENT_CUSTOM_FINISH_KEY) !== "0",
    imagePreference,
    soloFamiliarStage: "engawa_only",
    soloFamiliarReady: false,
    soloFamiliarRefreshGeneration: 0,
    soloFamiliars: [],
    soloBlockedFamiliars: [],
    soloBlockedCursor: "",
    soloBlockedDetailsOpen: false,
    soloFamiliarBookBusy: false,
    soloReunionPreference,
    deck: [],
    signatureCardId: "",
    roomId: "",
    room: null,
    opponentUid: "",
    clientSessionId: clientSoloSessionId,
    clientLeaseToken: clientSoloLeaseToken,
    opponentSessionId: "",
    roomConnectionGeneration: "",
    signalingAttemptId: "",
    soloSessionLeaseHeld: false,
    soloSessionLease: null,
    soloSessionGeneration: 0,
    soloSessionFence: null,
    soloSessionHeartbeat: null,
    soloSessionHeartbeatInFlight: false,
    soloSessionReleasePromise: null,
    soloSessionReleaseStarted: false,
    soloSessionCancelPromise: null,
    soloSessionCancelRoomId: "",
    soloSessionCancelResult: null,
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
    pendingFinishReplies: new Map(),
    pendingFinishReplyAcks: new Map(),
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
    creatorCardDependenciesSettled: false,
    creatorCardDependenciesBusy: false,
    creatorCardDraft: null,
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
    outgoingTransferChain: Promise.resolve(),
    incomingMessageChain: Promise.resolve(),
    peerStatus: "未接続",
    pendingIce: [],
    p2pGenerationToken: null,
    p2pRecovery: null,
    p2pRecoveryTimer: null,
    p2pRestartIce: null,
    p2pCleanupPromise: null,
    p2pAutoRequeueCount: 0,
    p2pOpponentCooldown: null,
    p2pAutoRequeueStartedAt: 0,
    p2pAutoRequeueCancelling: false,
    p2pTurnAvailable: false,
    p2pStartedAt: 0,
    p2pDiagnosticSent: new Set(),
    incomingTransfer: null,
    transferProgress: 0,
    imageTransferError: "",
    imageAckTimer: null,
    imageAckRound: 0,
    engawaLocalDecision: "",
    engawaRemoteDecision: "",
    engawaSelectedCardId: "",
    engawaMoodId: "",
    engawaSharedCardId: "",
    engawaSharedMoodId: "",
    engawaImageSent: false,
    engawaSending: false,
    engawaTransferProgress: 0,
    engawaTransferGeneration: 0,
    engawaRemoteImage: null,
    incomingEngawaTransfer: null,
    engawaLocalResponse: "",
    engawaRemoteResponse: "",
    engawaClosed: false,
    engawaEndReason: "",
    engawaErrorMessage: "",
    engawaResumeTimer: null,
    soloFamiliarDecision: "",
    soloFamiliarDecisionBusy: false,
    soloFamiliarDecisionSaved: false,
    soloFamiliarDecisionError: "",
    soloServerMatchTimer: null,
    soloServerMatchBusy: false,
    soloServerMatchErrorNotified: false,
    reunionMatch: false,
    finishCutInTimer: null,
    finishConnectionLossNotified: false,
    opponentOnline: true,
    statsCommitted: false,
    statsCommitInFlight: false,
    resultClaimCommitted: false,
    matchFinalizationPromise: null,
    destroyInFlight: false,
    destroyedByOpponent: false,
    roomTerminationToken: null,
    lifecycleTransitionToken: null,
    cleanupPromise: null,
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

function normalizeSoloFamiliarStage(value) {
  return SOLO_FAMILIAR_STAGES.includes(value) ? value : "engawa_only";
}

function soloFamiliarBookEnabled() {
  return state.soloFamiliarStage === "familiar_book" || state.soloFamiliarStage === "reunion";
}

function soloServerMatchmakingEnabled() {
  return state.soloFamiliarStage === "reunion";
}

function normalizeSoloFamiliarEntries(value, { blocked = false } = {}) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    id: /^[a-f0-9]{40}$/.test(String(entry?.id || "")) ? String(entry.id) : "",
    name: String(entry?.name || "").trim().slice(0, 16),
    ...(blocked ? {} : { createdAt: Math.max(0, Number(entry?.createdAt || 0)) }),
  })).filter((entry) => entry.id && entry.name);
}

function normalizeSoloBlockedCursor(value) {
  const cursor = String(value || "");
  return /^[a-f0-9]{40}$/.test(cursor) ? cursor : "";
}

function applySoloFamiliarPayload(payload) {
  const stage = normalizeSoloFamiliarStage(payload?.rollout?.stage);
  state.soloFamiliarStage = stage;
  state.soloFamiliarReady = true;
  if (stage !== "reunion" && state.soloServerMatchTimer) {
    window.clearInterval(state.soloServerMatchTimer);
    state.soloServerMatchTimer = null;
  }
  state.soloFamiliars = stage === "engawa_only"
    ? []
    : normalizeSoloFamiliarEntries(payload?.familiars);
  state.soloBlockedFamiliars = stage === "engawa_only"
    ? []
    : normalizeSoloFamiliarEntries(payload?.blocked, { blocked: true });
  state.soloBlockedCursor = stage === "engawa_only"
    ? ""
    : normalizeSoloBlockedCursor(payload?.blockedCursor);
  if (stage === "engawa_only" && state.screen === "familiarBook") {
    state.screen = "setup";
    setOnlineChrome("ONLINE READY");
  }
}

function failClosedSoloFamiliarState() {
  state.soloFamiliarStage = "engawa_only";
  state.soloFamiliarReady = true;
  window.clearInterval(state.soloServerMatchTimer);
  state.soloServerMatchTimer = null;
  state.soloFamiliars = [];
  state.soloBlockedFamiliars = [];
  state.soloBlockedCursor = "";
  if (state.screen === "familiarBook") {
    state.screen = "setup";
    setOnlineChrome("ONLINE READY");
  }
}

async function refreshSoloFamiliarBook({ renderAfter = false, notifyError = false } = {}) {
  const expectedState = state;
  const expectedUid = state.uid;
  const refreshGeneration = ++state.soloFamiliarRefreshGeneration;
  try {
    const response = await soloFamiliarActionCallable({ action: "get" });
    if (!active || state !== expectedState || state.uid !== expectedUid
        || state.soloFamiliarRefreshGeneration !== refreshGeneration) return false;
    applySoloFamiliarPayload(response.data || {});
    if (renderAfter) render();
    return true;
  } catch (error) {
    console.error(error);
    if (!active || state !== expectedState || state.uid !== expectedUid
        || state.soloFamiliarRefreshGeneration !== refreshGeneration) return false;
    failClosedSoloFamiliarState();
    if (renderAfter) render();
    if (notifyError) showToast("顔なじみ機能を確認できませんでした。通常1on1の対戦方式は待機開始時に再確認します。");
    return false;
  }
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

function getSavedFinishReplySettings() {
  const savedValue = localStorage.getItem(FINISH_REPLY_LINE_KEY);
  if (savedValue === FINISH_REPLY_DISABLED_VALUE) {
    return {
      finishReplyLine: "",
      finishReplyChoice: FINISH_REPLY_DISABLED_VALUE,
      customFinishReplyLine: "",
    };
  }
  const finishReplyLine = normalizeFinishReplyLine(savedValue || "");
  const usesCustomLine = savedValue !== null && !FINISH_REPLY_LINES.includes(finishReplyLine);
  return {
    finishReplyLine,
    finishReplyChoice: usesCustomLine ? CUSTOM_FINISH_REPLY_VALUE : finishReplyLine,
    customFinishReplyLine: usesCustomLine ? finishReplyLine : "",
  };
}

function applyFinishReplySetting(value) {
  if (value === FINISH_REPLY_DISABLED_VALUE || value === "") {
    state.finishReplyLine = "";
    state.finishReplyChoice = FINISH_REPLY_DISABLED_VALUE;
    return;
  }
  const finishReplyLine = normalizeFinishReplyLine(value);
  const usesCustomLine = !FINISH_REPLY_LINES.includes(finishReplyLine);
  state.finishReplyLine = finishReplyLine;
  state.finishReplyChoice = usesCustomLine ? CUSTOM_FINISH_REPLY_VALUE : finishReplyLine;
  if (usesCustomLine) state.customFinishReplyLine = finishReplyLine;
}

function persistRoleplayLineSettings(targetState = state) {
  localStorage.setItem(PURSUIT_LINE_KEY, targetState.pursuitLine);
  localStorage.setItem(FINISH_LINE_KEY, targetState.finishLine || FINISH_LINE_DISABLED_VALUE);
  localStorage.setItem(FINISH_REPLY_LINE_KEY, targetState.finishReplyLine || FINISH_REPLY_DISABLED_VALUE);
  localStorage.setItem(
    ROLEPLAY_VOICE_SET_KEY,
    normalizeRoleplayVoiceSetId(targetState.roleplayVoiceFallbackId || targetState.roleplayVoiceSetId)
      || ROLEPLAY_VOICE_SETS[0].id,
  );
}

function markRoleplayVoiceSetIndividual() {
  state.roleplayVoiceSetId = "";
  const select = document.querySelector("#onlineRoleplayVoiceSet");
  if (select) select.value = "";
  const summary = document.querySelector("#onlineRoleplayVoiceSummary");
  if (summary) {
    summary.innerHTML = "<strong>個別設定</strong><small>追撃・決着・返礼を自分のキャラクターに合わせて編集しています。</small>";
  }
}

function applyRoleplayVoiceSetSetting(value) {
  const voiceSet = getRoleplayVoiceSet(value);
  if (!voiceSet) {
    markRoleplayVoiceSetIndividual();
    return;
  }
  state.roleplayVoiceSetId = voiceSet.id;
  state.roleplayVoiceFallbackId = voiceSet.id;
  state.pursuitLine = voiceSet.pursuitLine;
  state.pursuitLineChoice = voiceSet.pursuitLine;
  state.customPursuitLine = "";
  state.finishLine = voiceSet.finishLine;
  state.finishLineChoice = voiceSet.finishLine;
  state.customFinishLine = "";
  state.finishReplyLine = voiceSet.replyLine;
  state.finishReplyChoice = voiceSet.replyLine;
  state.customFinishReplyLine = "";
  persistRoleplayLineSettings();
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
  const seed = {
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
  if (soloProfile?.appliedResults && typeof soloProfile.appliedResults === "object"
      && !Array.isArray(soloProfile.appliedResults)) {
    seed.appliedResults = { ...soloProfile.appliedResults };
  }
  if (/^[-0-9A-Z_a-z]{20}$/.test(String(soloProfile?.lastResultRoomId || ""))
      && ["win", "loss", "draw"].includes(soloProfile?.lastResultOutcome)) {
    seed.lastResultRoomId = soloProfile.lastResultRoomId;
    seed.lastResultMode = "solo";
    seed.lastResultOutcome = soloProfile.lastResultOutcome;
  }
  return seed;
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

function applyServerSoloProjectionProfiles(targetState, payload) {
  const soloProfile = payload?.soloProfile;
  if (soloProfile && typeof soloProfile === "object" && !Array.isArray(soloProfile)) {
    const streak = Math.max(0, Math.floor(Number(soloProfile.streak || 0)));
    targetState.profile = {
      ...targetState.profile,
      name: String(soloProfile.name || targetState.profile.name || targetState.name || "PLAYER")
        .trim()
        .slice(0, 16) || "PLAYER",
      pursuitLine: normalizePursuitLine(
        soloProfile.pursuitLine || targetState.profile.pursuitLine || targetState.pursuitLine,
      ),
      wins: Math.max(0, Math.floor(Number(soloProfile.wins || 0))),
      losses: Math.max(0, Math.floor(Number(soloProfile.losses || 0))),
      draws: Math.max(0, Math.floor(Number(soloProfile.draws || 0))),
      streak,
      bestStreak: Math.max(streak, Math.floor(Number(soloProfile.bestStreak || 0))),
      rating: Math.min(3000, Math.max(
        100,
        Math.round(Number(soloProfile.rating || INITIAL_RATING)),
      )),
      updatedAt: Math.max(0, Math.floor(Number(soloProfile.updatedAt || 0))),
    };
  }
  const overallProfile = payload?.overallProfile;
  if (overallProfile && typeof overallProfile === "object" && !Array.isArray(overallProfile)) {
    targetState.overallProfile = normalizeOverallProfile(
      overallProfile,
      targetState.name,
      targetState.profile,
    );
  }
}

async function reconcileSoloProfileBeforeMatchmaking(targetState, generation) {
  const response = await economyActionCallable({ action: "reconcile_solo_profile" });
  if (state !== targetState || targetState.matchmakingGeneration !== generation) return false;
  const result = response.data || {};
  if (result.profileProjectionMode !== "server-v2") {
    throw new Error("表示戦績の再同期方式を確認できませんでした。");
  }
  applyServerSoloProjectionProfiles(targetState, result);
  if (result.profileProjectionPending === true) {
    const error = new Error("前回までの表示戦績を再同期しています。少し待ってから、もう一度お試しください。");
    error.soloProfileProjectionPending = true;
    throw error;
  }
  await flushPendingSoloPublicResults(targetState).catch((error) => {
    console.error(error);
    showToast("表示戦績は同期済みです。公開ランキングだけ後でもう一度同期します。");
  });
  return true;
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
      <p>${settings.enabled ? "4モード共通で期間スコアを集計し、対称戦で更新した総合RATEを公開しています。" : "戦績と総合RATEは非公開で保持され、期間スコアは参加中の対戦だけ集計されます。"}</p></div></div>
    <div class="overall-ranking-control"><span class="overall-ranking-status">${settings.enabled ? "● 参加中" : "○ 非参加"}</span>
      <button class="button ${settings.enabled ? "button-ghost" : "button-primary"} button-small" type="button" id="${safeControlId}" aria-pressed="${settings.enabled}">${settings.enabled ? "参加をやめる" : "参加する"}</button></div>
    <small>通常型1on1・戦略型1on1・ふたりチャレンジ・バトルロワイヤルで同じ設定を使用します。匿名UIDとルーム履歴は公開しません。サーバー期間で確定したランキング実績と月間王者記録は、参加終了後も名誉記録として残ります。</small>
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
    if (screen === "shop" || screen === "missions" || screen === "creatorCard") {
      active = true;
      state = createOnlineState();
      lastRenderedScreen = "";
      state.uid = `local-preview-${screen}`;
      state.screen = screen;
      state.authReady = true;
      state.economyReady = true;
      state.economy = normalizeEconomyRecord({
        points: 2_500,
        inventory: {
          [TOP_MESSAGE_PRODUCT_ID]: !CREATOR_CARD_PREMIUM_PREVIEW_LOCKED,
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
      if (screen === "creatorCard") {
        const previewUnlocked = Object.fromEntries([
          "battle_total_30",
          "battle_solo_20",
          "market_seller_3",
        ].map((id, index) => [id, Date.now() - (index * 60_000)]));
        state.achievementsReady = true;
        state.achievements = window.HariaiAchievements?.normalizeProfile?.({
          unlocked: previewUnlocked,
          showcase: Object.keys(previewUnlocked),
        }) || state.achievements;
        state.achievements.stats = {
          battle: { totalMatches: 30 },
          market: { salesCount: 3, purchases: 1 },
        };
        state.topMessageReady = true;
        state.creatorCardDependenciesSettled = true;
        state.topMessage = normalizeOwnTopMessage({
          schemaVersion: CREATOR_CARD_VERSION,
          name: "ANJU",
          titleId: "title_oshi_storyteller",
          text: "Xでイラストを投稿しています",
          creatorType: "illustration",
          cardTheme: "premium-hologram",
          growthLevel: 4,
          achievementShowcase: Object.keys(previewUnlocked).join(","),
          xHandle: "example",
          updatedAt: Date.now(),
        });
      }
      setOnlineChrome(screen === "shop"
        ? "ANJUPAY STORE PREVIEW"
        : screen === "creatorCard" ? "FAVORITE CARD PREVIEW" : "DAILY MISSION PREVIEW");
      render();
      return;
    }
    if (screen === "achievements") {
      active = true;
      state = createOnlineState();
      lastRenderedScreen = "";
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
    showToast("LOCAL UI PREVIEW中は市場・実績・ミッション・AnjuPayストア・推しカード以外のオンライン機能へ接続しません。");
    return;
  }
  if (active) {
    if (["setup", "familiarBook", "missions", "shop", "achievements", "creatorCard"].includes(state.screen)) {
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
  lastRenderedScreen = "";
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

function openCreatorCard() {
  state.creatorCardDraft = null;
  openOnlineScreen("creatorCard");
}

function isActive() {
  return active;
}

function getLobbyStats() {
  expireFreeTablePublicStats(Date.now(), false);
  return {
    ...Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { ...lobbyStats[mode] }])),
    freeTable: { ...lobbyStats.freeTable },
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

function getCreatorCardType(value) {
  return CREATOR_CARD_TYPES.find((type) => type.id === String(value || ""))
    || CREATOR_CARD_TYPES.at(-1);
}

function getCreatorCardTheme(value, { legacyPremium = false } = {}) {
  return CREATOR_CARD_THEMES.find((theme) => theme.id === String(value || ""))
    || CREATOR_CARD_THEMES.find((theme) => theme.id === (legacyPremium ? "premium-hologram" : "basic-rose"));
}

function normalizeCreatorCardAchievementIds(value) {
  return window.HariaiAchievements?.normalizeIds?.(value, 3) || [];
}

function creatorCardDailyOrder(entryId) {
  const day = Math.floor((Date.now() + Number(publicServerTimeOffset || 0) + (9 * 60 * 60 * 1000)) / 86_400_000);
  const text = `${entryId}:${day}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
        const schemaVersion = Math.max(0, Math.floor(Number(record?.schemaVersion || 0)));
        const creatorType = getCreatorCardType(record?.creatorType);
        const cardTheme = getCreatorCardTheme(record?.cardTheme, { legacyPremium: schemaVersion < CREATOR_CARD_VERSION });
        const xHandle = normalizeXHandle(record?.xHandle);
        return {
          entryId: String(entryId || ""),
          schemaVersion,
          name: String(record?.name || "").slice(0, 16),
          titleId: String(record?.titleId || ""),
          title: titlePresentation?.product.title || "",
          titleIcon: titlePresentation?.icon || "",
          titleClassName: titlePresentation?.className || "",
          text: String(record?.text || "").slice(0, TOP_MESSAGE_MAX_LENGTH),
          creatorType: creatorType.id,
          cardTheme: cardTheme.id,
          growthLevel: Math.min(5, Math.max(1, Math.floor(Number(record?.growthLevel || 1)))),
          achievementShowcase: normalizeCreatorCardAchievementIds(record?.achievementShowcase),
          ...(X_HANDLE_PATTERN.test(xHandle) ? { xHandle } : {}),
          updatedAt: Number(record?.updatedAt || 0),
        };
      })
      .filter((record) => validLeaderboardEntryId(record.entryId) && record.name && record.text && Number.isFinite(record.updatedAt))
      .sort((first, second) => creatorCardDailyOrder(first.entryId) - creatorCardDailyOrder(second.entryId)
        || second.updatedAt - first.updatedAt);
    topMessagesStatus = "ready";
  } catch (error) {
    if (requestId !== topMessagesRequestId) return;
    console.error(error);
    topMessagesStatus = topMessageRecords.length ? "ready" : "error";
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

function normalizeFreeTablePublicStats(value, receivedAt) {
  const welcomingRooms = value?.welcomingRooms;
  const seatedRooms = value?.seatedRooms;
  const updatedAt = value?.updatedAt;
  if (!Number.isSafeInteger(welcomingRooms)
      || welcomingRooms < 0
      || !Number.isSafeInteger(seatedRooms)
      || seatedRooms < 0
      || !Number.isSafeInteger(updatedAt)
      || updatedAt < 0) return null;
  if (Number.isSafeInteger(freeTablePublicStats.updatedAt)
      && updatedAt < freeTablePublicStats.updatedAt) return null;
  if (publicServerTimeOffsetReady) {
    const estimatedServerNow = receivedAt + publicServerTimeOffset;
    if (updatedAt > estimatedServerNow + FREE_TABLE_PUBLIC_STATS_FUTURE_TOLERANCE_MS
        || updatedAt <= estimatedServerNow - FREE_TABLE_PUBLIC_STATS_STALE_MS) return null;
  }
  return { welcomingRooms, seatedRooms, updatedAt };
}

function canRefreshFreeTablePublicStats() {
  return document.visibilityState === "visible"
    && document.querySelector("#lobbyFreeTableWelcomingCount") !== null;
}

function freeTablePublicStatsAreExpired(now = Date.now()) {
  if (!freeTablePublicStatsLastSuccessAt) return false;
  let expiresAt = freeTablePublicStatsLastSuccessAt + FREE_TABLE_PUBLIC_STATS_STALE_MS;
  if (publicServerTimeOffsetReady && Number.isSafeInteger(freeTablePublicStats.updatedAt)) {
    const serverUpdatedAtInLocalTime = freeTablePublicStats.updatedAt - publicServerTimeOffset;
    expiresAt = Math.min(
      expiresAt,
      serverUpdatedAtInLocalTime + FREE_TABLE_PUBLIC_STATS_STALE_MS,
    );
  }
  return now >= expiresAt;
}

function expireFreeTablePublicStats(now = Date.now(), shouldRender = true) {
  if (!freeTablePublicStatsAreExpired(now)) return false;
  freeTablePublicStats = {
    welcomingRooms: null,
    seatedRooms: null,
    updatedAt: null,
  };
  freeTablePublicStatsLastSuccessAt = 0;
  lobbyStats.freeTable = { ...freeTablePublicStats };
  if (shouldRender) renderLobbyStats();
  return true;
}

function clearFreeTablePublicStatsTimer() {
  window.clearTimeout(freeTablePublicStatsTimer);
  freeTablePublicStatsTimer = null;
}

function scheduleFreeTablePublicStatsRefresh(delay) {
  clearFreeTablePublicStatsTimer();
  if (!canRefreshFreeTablePublicStats()) return;
  freeTablePublicStatsTimer = window.setTimeout(() => {
    freeTablePublicStatsTimer = null;
    refreshFreeTablePublicStats();
  }, delay);
}

function nextFreeTablePublicStatsDelay(succeeded) {
  if (succeeded) return FREE_TABLE_PUBLIC_STATS_POLL_MS;
  return Math.min(
    FREE_TABLE_PUBLIC_STATS_POLL_MS * (2 ** Math.min(freeTablePublicStatsFailureCount, 2)),
    FREE_TABLE_PUBLIC_STATS_MAX_BACKOFF_MS,
  );
}

function refreshFreeTablePublicStats() {
  expireFreeTablePublicStats();
  if (!canRefreshFreeTablePublicStats()) {
    return Promise.resolve({ ...freeTablePublicStats });
  }
  if (freeTablePublicStatsRequest) return freeTablePublicStatsRequest;
  let succeeded = false;
  const request = Promise.resolve()
    .then(() => freeTablePublicStatsCallable({}))
    .then((response) => {
      const receivedAt = Date.now();
      const nextStats = normalizeFreeTablePublicStats(response?.data, receivedAt);
      if (!nextStats) throw new Error("Invalid free table public stats response.");
      freeTablePublicStats = nextStats;
      freeTablePublicStatsLastSuccessAt = receivedAt;
      freeTablePublicStatsFailureCount = 0;
      lobbyStats.freeTable = { ...nextStats };
      renderLobbyStats();
      succeeded = true;
      return { ...nextStats };
    })
    .catch(() => {
      freeTablePublicStatsFailureCount = Math.min(freeTablePublicStatsFailureCount + 1, 8);
      expireFreeTablePublicStats();
      return { ...freeTablePublicStats };
    })
    .finally(() => {
      if (freeTablePublicStatsRequest === request) freeTablePublicStatsRequest = null;
      if (canRefreshFreeTablePublicStats()) {
        scheduleFreeTablePublicStatsRefresh(nextFreeTablePublicStatsDelay(succeeded));
      }
    });
  freeTablePublicStatsRequest = request;
  return request;
}

function refreshFreeTablePublicStatsImmediately() {
  clearFreeTablePublicStatsTimer();
  return refreshFreeTablePublicStats();
}

function refreshLobbyStats() {
  expireFreeTablePublicStats(Date.now(), false);
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
    lobbyFreeTableWelcomingCount: lobbyStats.freeTable.welcomingRooms,
    lobbyFreeTableSeatedCount: lobbyStats.freeTable.seatedRooms,
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
  refreshFreeTablePublicStatsImmediately();
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
    if (Number.isFinite(offset)) {
      publicServerTimeOffset = offset;
      publicServerTimeOffsetReady = true;
    }
    refreshLobbyStats();
  }, () => {
    // A local clock fallback is sufficient when the offset cannot be read.
    refreshLobbyStats();
  });
  window.setInterval(refreshLobbyStats, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshFreeTablePublicStatsImmediately();
    } else {
      clearFreeTablePublicStatsTimer();
    }
  });
  window.addEventListener("hariai-landing-rendered", refreshFreeTablePublicStatsImmediately);
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
    if (!localStorage.getItem(PURSUIT_LINE_KEY) && state.profile.pursuitLine) {
      applyPursuitLineSetting(state.profile.pursuitLine);
      state.roleplayVoiceSetId = inferRoleplayVoiceSetId({
        pursuitLine: state.pursuitLine,
        finishLine: state.finishLine,
        replyLine: state.finishReplyLine,
      });
      if (state.roleplayVoiceSetId) state.roleplayVoiceFallbackId = state.roleplayVoiceSetId;
    }
  }
  try {
    state.overallProfile = await ensureOverallProfileSeeded(state.uid, state.name, state.profile);
  } catch (error) {
    console.error(error);
    showToast("総合ランキング情報を読み込めませんでした。対戦機能は利用できます。");
  }
  state.authReady = true;
  state.creatorCardDependenciesBusy = true;
  state.creatorCardDependenciesSettled = false;
  refreshSoloFamiliarBook({ renderAfter: true }).catch((error) => console.error(error));
  try {
    await initializeEconomy();
    notifyPendingPeriodRewards();
  } catch (error) {
    console.error(error);
    state.economyReady = false;
    showToast("AnjuPay情報を読み込めませんでした。対戦機能は利用できます。");
  }
  try {
    await loadOwnTopMessage();
  } catch (error) {
    console.error(error);
    state.topMessageReady = false;
    showToast("推しカードを読み込めませんでした。時間をおいてもう一度お試しください。");
  }
  state.creatorCardDependenciesBusy = false;
  state.creatorCardDependenciesSettled = true;
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
  const schemaVersion = Math.max(0, Math.floor(Number(value.schemaVersion || 0)));
  return {
    schemaVersion,
    name: String(value.name || "").trim().slice(0, 16),
    titleId: String(value.titleId || ""),
    text,
    creatorType: getCreatorCardType(value.creatorType).id,
    cardTheme: getCreatorCardTheme(value.cardTheme, { legacyPremium: schemaVersion < CREATOR_CARD_VERSION }).id,
    growthLevel: Math.min(5, Math.max(1, Math.floor(Number(value.growthLevel || 1)))),
    achievementShowcase: normalizeCreatorCardAchievementIds(value.achievementShowcase),
    xHandle: normalizeXHandle(value.xHandle),
    updatedAt: Number(value.updatedAt || 0),
  };
}

async function loadOwnTopMessage() {
  if (!state.uid) {
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

function validateTopMessageText(value) {
  const text = String(value || "").trim();
  if (!text || text.length > TOP_MESSAGE_MAX_LENGTH || /[\r\n]/.test(text)) {
    throw new Error(`紹介文は1行${TOP_MESSAGE_MAX_LENGTH}文字以内で入力してください。`);
  }
  if (CREATOR_CARD_URL_PATTERN.test(text) || CREATOR_CARD_EMAIL_PATTERN.test(text)) {
    throw new Error("紹介文にURL・メールアドレスは入力できません。Xのユーザー名は専用欄へ入力してください。");
  }
  return text;
}

async function saveTopMessage({
  name: nameValue,
  text: textValue,
  creatorType: creatorTypeValue,
  xHandle: xHandleValue = "",
  cardTheme: cardThemeValue,
  achievementIds = [],
} = {}) {
  if (useOfflineMarketPreview) {
    throw new Error("LOCAL UI PREVIEWでは推しカードを公開・更新しません。");
  }
  if (state.topMessageBusy) return;
  const name = String(nameValue || "").trim();
  if (!name || name.length > 16 || /[\r\n]/.test(name)) throw new Error("表示名は1行16文字以内で入力してください。");
  const text = validateTopMessageText(textValue);
  const creatorType = getCreatorCardType(creatorTypeValue);
  if (creatorType.id !== creatorTypeValue) throw new Error("活動札を選び直してください。");
  const cardTheme = getCreatorCardTheme(cardThemeValue);
  if (cardTheme.id !== cardThemeValue) throw new Error("カードテーマを選び直してください。");
  const premiumOwned = state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] === true;
  if (cardTheme.premium && !premiumOwned) throw new Error("プレミアム仕上げを先に解放してください。");
  const rawXHandle = String(xHandleValue || "").trim().replace(/^@+/, "");
  const xHandle = normalizeXHandle(rawXHandle);
  if (rawXHandle && !X_HANDLE_PATTERN.test(xHandle)) {
    throw new Error("Xのユーザー名は英数字と_の15文字以内で入力してください。");
  }
  const normalizedAchievementIds = normalizeCreatorCardAchievementIds(achievementIds);
  if (!Array.isArray(achievementIds) || normalizedAchievementIds.length !== achievementIds.length) {
    throw new Error("カードへ飾る実績は解除済みから3件まで選んでください。");
  }
  state.topMessageBusy = true;
  setBusy(true, "推しカードを公開しています…");
  let saved = false;
  try {
    const response = await economyActionCallable({
      action: "publish_creator_card",
      name,
      text,
      creatorType: creatorType.id,
      xHandle,
      cardTheme: cardTheme.id,
      achievementIds: normalizedAchievementIds,
    });
    const result = response.data || {};
    if (result.saved !== true || !validLeaderboardEntryId(result.entryId)) {
      throw new Error("推しカードの公開を確認できませんでした。");
    }
    state.name = name;
    localStorage.setItem(PROFILE_NAME_KEY, name);
    state.topMessageEntryId = result.entryId;
    state.topMessage = normalizeOwnTopMessage(result.card);
    state.topMessageReady = true;
    state.creatorCardDraft = null;
    await refreshTopMessages({ silent: true });
    saved = true;
    showToast("推しカードをトップページに飾りました。");
  } finally {
    state.topMessageBusy = false;
    setBusy(false);
    if (saved) render();
  }
}

async function deleteTopMessage() {
  if (useOfflineMarketPreview) {
    throw new Error("LOCAL UI PREVIEWでは公開中の推しカードを外しません。");
  }
  if (state.topMessageBusy || !state.topMessage) return;
  state.topMessageBusy = true;
  setBusy(true, "推しカードをトップページから外しています…");
  let deleted = false;
  try {
    await economyActionCallable({ action: "delete_creator_card" });
    state.topMessage = null;
    state.topMessageReady = true;
    state.creatorCardDraft = null;
    await refreshTopMessages({ silent: true });
    deleted = true;
    showToast("推しカードをトップページから外しました。");
  } finally {
    state.topMessageBusy = false;
    setBusy(false);
    if (deleted) render();
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
  const screenChanged = lastRenderedScreen !== state.screen;
  const renderers = {
    setup: renderSetup,
    familiarBook: renderSoloFamiliarBook,
    missions: renderDailyMissions,
    shop: renderPointShop,
    achievements: renderAchievements,
    creatorCard: renderCreatorCardEditor,
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
    engawa: renderEngawa,
    noContest: renderNoContest,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderSetup)();
  lastRenderedScreen = state.screen;
  bindScreenEvents();
  if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function renderSoloFamiliarSetupPanel() {
  if (!soloFamiliarBookEnabled()) return "";
  const reunionSetting = soloServerMatchmakingEnabled() ? `
    <label class="solo-reunion-toggle">
      <input id="soloReunionPreference" type="checkbox" ${state.soloReunionPreference ? "checked" : ""} />
      <span><strong>顔なじみとの再会を優先する</strong>
        <small>お互いが同時に待っている時だけ優先します。見つからなければ、待ち時間を延ばさず通常の相手を探します。</small></span>
    </label>` : "";
  return `<section class="solo-familiar-setup" aria-labelledby="soloFamiliarSetupTitle">
    <div><span class="eyebrow">FAMILIAR BOOK</span><h2 id="soloFamiliarSetupTitle">顔なじみ帳</h2>
      <p>「縁側で一息」のあと、お互いが望んだ相手だけを静かに覚えておく帳面です。</p></div>
    <button class="button button-ghost button-small" id="openSoloFamiliarBook" type="button">帳面をひらく</button>
    ${reunionSetting}
  </section>`;
}

function renderSoloFamiliarBook() {
  const familiarItems = state.soloFamiliars.length
    ? state.soloFamiliars.map((entry) => `<article class="solo-familiar-entry">
      <div><span>縁側で知り合った人</span><strong>${escapeHtml(entry.name)}</strong></div>
      <div class="solo-familiar-entry-actions">
        <button class="button button-ghost button-small" type="button" data-solo-familiar-remove="${entry.id}" ${state.soloFamiliarBookBusy ? "disabled" : ""}>帳面から外す</button>
        <button class="button button-ghost button-small solo-familiar-block-button" type="button" data-solo-familiar-block="${entry.id}" ${state.soloFamiliarBookBusy ? "disabled" : ""}>ブロック</button>
      </div>
    </article>`).join("")
    : `<div class="solo-familiar-empty"><strong>まだ白いページです</strong><p>縁側でお互いが「またどこかで」と思った時だけ、ここに名前が残ります。</p></div>`;
  const blockedItems = state.soloBlockedFamiliars.length
    ? state.soloBlockedFamiliars.map((entry) => `<article class="solo-familiar-blocked-entry">
      <strong>${escapeHtml(entry.name)}</strong>
      <button class="button button-ghost button-small" type="button" data-solo-familiar-unblock="${entry.id}" ${state.soloFamiliarBookBusy ? "disabled" : ""}>ブロック解除</button>
    </article>`).join("")
    : '<p class="solo-familiar-blocked-empty">ブロック中の相手はいません。</p>';
  return `<section class="screen solo-familiar-book-screen">
    <div class="section-head"><div><span class="eyebrow">A QUIET MEMORY</span><h1>顔なじみ帳</h1>
      <p>表示するのは名前だけです。オンライン状態、最終ログイン、勝敗は記録・表示しません。</p></div>
      <button class="button button-ghost button-small" id="soloFamiliarBack" type="button">対戦準備へ</button></div>
    <div class="solo-familiar-book-note"><strong>相手の選択は見えません</strong><span>片方だけが望んだ場合は何も残らず、通知も届きません。</span></div>
    ${state.soloFamiliarBookBusy ? '<p class="solo-familiar-book-loading" aria-live="polite">帳面を整えています…</p>' : ""}
    <div class="solo-familiar-list">${familiarItems}</div>
    <details class="solo-familiar-blocked" ${state.soloBlockedDetailsOpen ? "open" : ""}>
      <summary>ブロック管理</summary>
      <p>ブロックした相手は顔なじみ帳と再会優先から外れます。通常検索での偶然の再会まで防ぐことを保証するものではありません。</p>
      <div>${blockedItems}</div>
      ${state.soloBlockedCursor ? `<button class="button button-ghost button-small solo-familiar-load-more" id="soloFamiliarLoadMoreBlocked" type="button" ${state.soloFamiliarBookBusy ? "disabled" : ""}>さらに読み込む</button>` : ""}
    </details>
    <div class="solo-familiar-book-actions">
      <button class="button button-ghost" id="soloFamiliarRefresh" type="button" ${state.soloFamiliarBookBusy ? "disabled" : ""}>帳面を読み直す</button>
    </div>
  </section>`;
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
  const activeVoiceSet = getRoleplayVoiceSet(state.roleplayVoiceSetId);
  const voiceSetOptions = ROLEPLAY_VOICE_SETS.map((voiceSet) => `
    <option value="${voiceSet.id}" ${state.roleplayVoiceSetId === voiceSet.id ? "selected" : ""}>${escapeHtml(voiceSet.label)} — ${escapeHtml(voiceSet.description)}</option>`).join("");
  const voiceSetSummary = activeVoiceSet
    ? `<strong>${escapeHtml(activeVoiceSet.label)}</strong><small>${escapeHtml(activeVoiceSet.description)}。下の各セリフは個別に変更できます。</small>`
    : "<strong>個別設定</strong><small>追撃・決着・返礼を自分のキャラクターに合わせて編集しています。</small>";
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
    ${renderSoloFamiliarSetupPanel()}
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
        <section class="roleplay-voice-settings" aria-labelledby="onlineRoleplayVoiceTitle">
          <div class="finish-line-heading"><span>ROLEPLAY VOICE</span><strong id="onlineRoleplayVoiceTitle">キャラクターの口調セット</strong></div>
          <label class="field-label">初心者向け一括設定
            <select class="text-input" id="onlineRoleplayVoiceSet">
              <option value="" ${state.roleplayVoiceSetId ? "" : "selected"}>個別に設定する</option>
              ${voiceSetOptions}
            </select>
          </label>
          <div class="roleplay-voice-summary" id="onlineRoleplayVoiceSummary" role="status" aria-live="polite">${voiceSetSummary}</div>
          <p class="pursuit-line-note">口調セットは追撃・決着・敗北時の返礼を一括設定します。選んだ後に、好きな項目だけ自由記述へ変更できます。</p>
        </section>
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
          <div class="finish-reply-divider" aria-hidden="true"></div>
          <div class="finish-line-heading"><span>FINISH REPLY</span><strong>敗北時の決着返礼</strong></div>
          <label class="field-label">HPが0になった時に返すセリフ
            <select class="text-input" id="onlineFinishReplyChoice">
              ${FINISH_REPLY_LINES.map((line) => `<option value="${escapeHtml(line)}" ${state.finishReplyChoice === line ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}
              <option value="${CUSTOM_FINISH_REPLY_VALUE}" ${state.finishReplyChoice === CUSTOM_FINISH_REPLY_VALUE ? "selected" : ""}>自由記述</option>
              <option value="${FINISH_REPLY_DISABLED_VALUE}" ${state.finishReplyChoice === FINISH_REPLY_DISABLED_VALUE ? "selected" : ""}>返礼なし（静かに決着を受け入れる）</option>
            </select>
          </label>
          <div class="pursuit-custom-field" id="onlineCustomFinishReplyField" ${state.finishReplyChoice === CUSTOM_FINISH_REPLY_VALUE ? "" : "hidden"}>
            <label class="field-label">自由記述（最大${MAX_FINISH_REPLY_LENGTH}文字・改行1回まで）
              <textarea class="text-input finish-reply-input" id="onlineCustomFinishReplyLine" maxlength="${MAX_FINISH_REPLY_INPUT_UNITS}" rows="2" autocomplete="off" placeholder="敗北時に返すセリフ">${escapeHtml(state.customFinishReplyLine)}</textarea>
            </label>
            <span class="pursuit-character-count finish-character-count"><b id="onlineFinishReplyCharacterCount">${countFinishReplyCharacters(state.customFinishReplyLine)}</b> / ${MAX_FINISH_REPLY_LENGTH}</span>
            <small class="field-help">空欄のままなら、セリフを送らず静かに結果へ進みます。</small>
          </div>
          <label class="finish-visibility-toggle">
            <input id="onlineShowOpponentCustomFinish" type="checkbox" ${state.showOpponentCustomFinish ? "checked" : ""} />
            <span>相手が自由記述した決着セリフ・返礼を表示する</span>
          </label>
          <p class="pursuit-line-note">決着セリフと返礼はP2Pで対戦相手だけへ一時送信します。自由記述を非表示にした場合、相手の定型外セリフだけ安全な定型文へ置き換えます。</p>
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

function creatorCardActivityCountFromState() {
  const battleMatches = Math.max(0, Math.floor(Number(state.achievements?.stats?.battle?.totalMatches || 0)));
  const marketSales = Math.max(0, Math.floor(Number(state.achievements?.stats?.market?.salesCount || 0)));
  const marketPurchases = Math.max(0, Math.floor(Number(state.achievements?.stats?.market?.purchases || 0)));
  return battleMatches + marketSales + marketPurchases;
}

function creatorCardGrowthProgress() {
  const activity = creatorCardActivityCountFromState();
  let level = 1;
  CREATOR_CARD_GROWTH_THRESHOLDS.forEach((threshold, index) => {
    if (activity >= threshold) level = index + 1;
  });
  const currentTarget = CREATOR_CARD_GROWTH_THRESHOLDS[level - 1];
  const nextTarget = CREATOR_CARD_GROWTH_THRESHOLDS[level] || 0;
  const progress = nextTarget
    ? Math.min(100, Math.max(0, ((activity - currentTarget) / (nextTarget - currentTarget)) * 100))
    : 100;
  return {
    activity,
    level,
    label: CREATOR_CARD_GROWTH_LABELS[level - 1],
    nextTarget,
    remaining: nextTarget ? Math.max(0, nextTarget - activity) : 0,
    progress,
  };
}

function creatorCardUnlockedAchievements() {
  const unlocked = state.achievements?.unlocked || {};
  const highestByFamily = new Map();
  (window.HariaiAchievements?.catalog || []).forEach((achievement) => {
    if (!unlocked[achievement.id]) return;
    const current = highestByFamily.get(achievement.family);
    if (!current || achievement.level > current.level) highestByFamily.set(achievement.family, achievement);
  });
  return [...highestByFamily.values()].sort((first, second) => (
    Number(unlocked[second.id] || 0) - Number(unlocked[first.id] || 0)
    || second.level - first.level
    || first.id.localeCompare(second.id)
  ));
}

function creatorCardHighestUnlockedAchievementId(id) {
  const definition = window.HariaiAchievements?.byId?.get?.(id);
  if (!definition) return "";
  const unlocked = state.achievements?.unlocked || {};
  return (window.HariaiAchievements?.catalog || [])
    .filter((candidate) => candidate.family === definition.family && unlocked[candidate.id])
    .sort((first, second) => second.level - first.level)[0]?.id || "";
}

function creatorCardInitialAchievementIds() {
  const currentIds = state.topMessage
    ? normalizeCreatorCardAchievementIds(state.topMessage.achievementShowcase)
    : normalizeCreatorCardAchievementIds(state.achievements?.showcase);
  return normalizeCreatorCardAchievementIds(
    currentIds.map(creatorCardHighestUnlockedAchievementId).filter(Boolean),
  );
}

function creatorCardPresentation({
  name = state.topMessage?.name || state.name,
  text = state.topMessage?.text || "",
  creatorType = state.topMessage?.creatorType || "illustration",
  xHandle = state.topMessage?.xHandle || "",
  cardTheme = state.topMessage?.cardTheme || "basic-rose",
  achievementShowcase = creatorCardInitialAchievementIds(),
} = {}) {
  const titlePresentation = getPlayerTitlePresentation(getTitleProduct()?.id);
  const growth = creatorCardGrowthProgress();
  return {
    schemaVersion: CREATOR_CARD_VERSION,
    name,
    text,
    creatorType,
    xHandle,
    cardTheme,
    growthLevel: Math.max(growth.level, Number(state.topMessage?.growthLevel || 1)),
    achievementShowcase,
    title: titlePresentation?.product.title || "",
    titleIcon: titlePresentation?.icon || "",
    titleClassName: titlePresentation?.className || "",
  };
}

function renderCreatorCardEditor() {
  if (!state.authReady || !state.creatorCardDependenciesSettled) {
    return `<section class="screen creator-card-screen">
      <div class="section-head"><div><span class="eyebrow">MY FAVORITE CARD</span><h1>あなたの推しカード</h1><p>公開カードを準備しています…</p></div><button class="button button-ghost button-small" id="creatorCardHomeButton">タイトルへ</button></div>
      <div class="economy-unavailable"><strong>カード情報を読み込んでいます</strong><p>匿名アカウントと公開設定を確認しています。</p></div>
    </section>`;
  }
  if (!state.economyReady || !state.achievementsReady || !state.topMessageReady) {
    return `<section class="screen creator-card-screen">
      <div class="section-head"><div><span class="eyebrow">MY FAVORITE CARD</span><h1>あなたの推しカード</h1><p>公開権・実績・現在のカードを安全に確認できませんでした。</p></div><button class="button button-ghost button-small" id="creatorCardHomeButton">タイトルへ</button></div>
      <div class="economy-unavailable"><strong>カード情報を読み込めませんでした</strong><p>既存のプレミアム仕上げや実績を失わないよう、確認できるまで編集を停止しています。</p><button class="button button-primary" id="creatorCardRetry" type="button" ${state.creatorCardDependenciesBusy ? "disabled" : ""}>再読み込み</button></div>
    </section>`;
  }
  const premiumOwned = state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] === true;
  const existing = state.topMessage;
  const growth = creatorCardGrowthProgress();
  const unlockedAchievements = creatorCardUnlockedAchievements();
  const draft = state.creatorCardDraft ? normalizeCreatorCardDraft(state.creatorCardDraft) : null;
  const creatorType = getCreatorCardType(draft?.creatorType || existing?.creatorType || "illustration");
  const legacyPremium = Number(existing?.schemaVersion || CREATOR_CARD_VERSION) < CREATOR_CARD_VERSION;
  const requestedTheme = getCreatorCardTheme(draft?.cardTheme || existing?.cardTheme, { legacyPremium });
  const selectedTheme = requestedTheme.premium && !premiumOwned && !draft
    ? getCreatorCardTheme("basic-rose")
    : requestedTheme;
  const initialName = draft ? draft.name : existing?.name || state.name;
  const initialText = draft ? draft.text : existing?.text || creatorType.templates[0];
  const initialXHandle = draft ? draft.xHandleInput : existing?.xHandle || state.xHandle || "";
  const initialXPublic = draft ? draft.xPublic : Boolean(existing?.xHandle);
  const initialAchievementIds = draft ? draft.achievementShowcase : creatorCardInitialAchievementIds();
  const premiumTrial = selectedTheme.premium && !premiumOwned;
  const premiumBalance = Math.max(0, Math.floor(Number(state.economy.points || 0)));
  const premiumAffordable = premiumBalance >= 500;
  const preview = creatorCardPresentation({
    name: initialName,
    text: initialText,
    creatorType: creatorType.id,
    xHandle: initialXPublic ? initialXHandle : "",
    cardTheme: selectedTheme.id,
    achievementShowcase: initialAchievementIds,
  });
  const typeOptions = CREATOR_CARD_TYPES.map((type) => `<label class="creator-card-choice"><input type="radio" name="creatorCardType" value="${type.id}" ${creatorType.id === type.id ? "checked" : ""} /><span><i aria-hidden="true">${type.icon}</i><b>${type.label}</b></span></label>`).join("");
  const templateButtons = CREATOR_CARD_TYPES.flatMap((type) => type.templates.map((template) => `<button type="button" data-creator-card-template="${escapeHtml(template)}" data-creator-card-template-type="${type.id}" ${type.id === creatorType.id ? "" : "hidden"}>${escapeHtml(template)}</button>`)).join("");
  const renderThemeOption = (theme) => `<label class="creator-card-theme-option creator-card-theme-${theme.id} ${theme.premium ? "is-premium" : ""}"><input type="radio" name="creatorCardTheme" value="${theme.id}" ${selectedTheme.id === theme.id ? "checked" : ""} /><span><i aria-hidden="true"></i><b>${theme.label}</b><small>${theme.premium ? (premiumOwned ? "PREMIUM" : "試着") : "FREE"}</small></span></label>`;
  const freeThemeOptions = CREATOR_CARD_THEMES.filter((theme) => !theme.premium).map(renderThemeOption).join("");
  const premiumThemeOptions = CREATOR_CARD_THEMES.filter((theme) => theme.premium).map(renderThemeOption).join("");
  const achievementOptions = unlockedAchievements.length
    ? unlockedAchievements.map((achievement) => `<button class="creator-card-achievement-option" type="button" data-creator-card-achievement="${achievement.id}" aria-pressed="${initialAchievementIds.includes(achievement.id)}"><i aria-hidden="true">${escapeHtml(achievement.icon)}</i><span>${escapeHtml(achievement.name)}</span><small>Lv.${achievement.level}</small></button>`).join("")
    : `<p class="creator-card-achievement-empty">検証済みの対戦や市場成立で実績を解除すると、ここから最大3件を飾れます。</p>`;
  const shareUrl = premiumTrial ? "#" : shared()?.createXCreatorCardPostUrl?.(preview) || "#";
  return `<section class="screen creator-card-screen">
    <div class="section-head"><div><span class="eyebrow">MY FAVORITE CARD</span><h1>あなたの推しカード</h1>
      <p>遊んだ歩みで育つ、自分だけの作品名刺です。基本カードは無料でトップページへ飾れます。</p></div>
      <button class="button button-ghost button-small" id="creatorCardHomeButton" ${state.economyBusy ? "disabled" : ""}>タイトルへ</button></div>
    <div class="creator-card-growth-panel">
      <div><span>CARD GROWTH</span><strong>STAGE ${growth.level}・${growth.label}</strong><p>勝敗や順位ではなく、検証済みの正式対戦と市場成立で育ちます。</p></div>
      <div class="creator-card-growth-meter"><span role="progressbar" aria-label="次のカード段階までの進み具合" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(growth.progress)}"><i style="width:${growth.progress.toFixed(1)}%"></i></span><small>${growth.nextTarget ? `次の成長まであと${growth.remaining}回` : "カードは最高段階まで育ちました"}</small></div>
    </div>
    <div class="creator-card-editor-layout">
      <aside class="creator-card-editor-preview"><div><span>LIVE PREVIEW</span><small>公開前に完成形を確認できます</small></div><div id="creatorCardPreview">${shared()?.renderCreatorCard?.(preview, { preview: true }) || ""}</div>
        <div class="creator-card-share-actions"><button class="button button-ghost button-small" id="creatorCardDownload" type="button" ${premiumTrial ? "disabled" : ""}>カード画像を保存</button><button class="button button-ghost button-small" id="creatorCardNativeShare" type="button" ${premiumTrial ? "disabled" : ""}>画像付きで共有</button>
          <a class="button button-x-share button-small ${premiumTrial ? "is-disabled" : ""}" id="creatorCardXShare" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer" aria-disabled="${premiumTrial}" ${premiumTrial ? 'tabindex="-1"' : ""}><span class="x-share-mark" aria-hidden="true">X</span><span>Xで披露</span></a></div>
        <small id="creatorCardTrialShareNote" ${premiumTrial ? "" : "hidden"}>プレミアム仕上げの試着中は、解放するまで画像保存・共有・公開はできません。</small>
        <small>Xの投稿画面には画像を自動添付できません。画像保存後、X側で添付してください。共有対応端末では「画像付きで共有」を利用できます。</small>
      </aside>
      <form class="creator-card-editor-form" id="creatorCardForm">
        <section><div class="creator-card-field-head"><label for="creatorCardName">表示名</label><small>16文字以内</small></div><input id="creatorCardName" type="text" maxlength="16" required value="${escapeHtml(initialName)}" autocomplete="nickname" /></section>
        <fieldset><legend>活動札</legend><div class="creator-card-choice-grid">${typeOptions}</div></fieldset>
        <section><div class="creator-card-field-head"><label for="creatorCardText">カードの紹介文</label><span><b id="creatorCardLength">${String(initialText).length}</b> / ${TOP_MESSAGE_MAX_LENGTH}</span></div>
          <textarea id="creatorCardText" maxlength="${TOP_MESSAGE_MAX_LENGTH}" rows="2" required>${escapeHtml(initialText)}</textarea>
          <div class="creator-card-templates" aria-label="紹介文テンプレート">${templateButtons}</div><small>URL・メールアドレス・個人情報は入力しないでください。Xは下の専用欄から公開できます。</small></section>
        <section><div class="creator-card-field-head"><label for="creatorCardXHandle">Xユーザー名</label><small>英数字と_、15文字以内</small></div>
          <label class="creator-card-x-input" for="creatorCardXHandle"><span>@</span><input id="creatorCardXHandle" type="text" maxlength="15" value="${escapeHtml(initialXHandle)}" placeholder="username" autocomplete="off" autocapitalize="none" spellcheck="false" /></label>
          <label class="creator-card-public-check"><input id="creatorCardXPublic" type="checkbox" ${initialXPublic ? "checked" : ""} /><span>このカードからXを公開する</span></label><small>ランキングや市場の公開設定とは別です。チェックした場合だけカードにXリンクを表示します。</small></section>
        <fieldset><legend>カードテーマ</legend>
          <section class="creator-card-theme-group"><div class="creator-card-theme-group-head"><strong>無料4種</strong><small>いつでも選べます</small></div><div class="creator-card-theme-grid">${freeThemeOptions}</div></section>
          <section class="creator-card-theme-group"><div class="creator-card-theme-group-head"><strong>プレミアム3種</strong><small>${premiumOwned ? "解放済み" : "選ぶとプレビューへ試着"}</small></div><div class="creator-card-theme-grid is-premium">${premiumThemeOptions}</div></section>
        </fieldset>
        <div class="creator-card-premium-panel ${premiumOwned ? "is-owned" : ""}" id="creatorCardPremiumPanel" role="region" aria-labelledby="creatorCardPremiumHeading" aria-busy="${state.economyBusy}">
          <div class="creator-card-premium-panel-head"><span>ONE-TIME FAVORITE CARD FINISH</span><strong id="creatorCardPremiumHeading">${premiumOwned ? "3つのプレミアム仕上げを解放済み" : "3つのプレミアム仕上げを500 Payで解放"}</strong>
            <p id="creatorCardPremiumTrialLabel" aria-live="polite">${premiumOwned ? "解放済み・追加料金なし" : premiumTrial ? `「${escapeHtml(selectedTheme.label)}」を試着中です` : "プレミアムを選ぶと、自分のカードで仕上がりを試せます"}</p></div>
          <div class="creator-card-premium-panel-body">
            <ul><li>ホログラム・スターダスト・ロイヤル箔の3種セット</li><li>一度解放すれば何度でも使える買い切りです</li><li>見た目だけの仕上げで、成長やトップの表示順には影響しません</li></ul>
            ${premiumOwned ? '<div class="creator-card-premium-owned"><strong>解放済み</strong><span>3つすべてを追加料金なしで使えます。</span></div>' : `<div class="creator-card-premium-purchase"><div class="creator-card-premium-balance"><span>現在 <strong>${formatAnjuPay(premiumBalance)}</strong></span><span>解放後 <strong>${premiumAffordable ? formatAnjuPay(premiumBalance - 500) : "残高不足"}</strong></span></div><button class="button button-primary" id="creatorCardUnlockPremium" type="button" ${!premiumTrial || !premiumAffordable || state.economyBusy || useOfflineMarketPreview ? "disabled" : ""}>${useOfflineMarketPreview ? "LOCAL UI PREVIEWでは購入できません" : !premiumTrial ? "プレミアム仕上げを選んで試着" : premiumAffordable ? "3つの仕上げを500 Payで解放" : `あと${formatAnjuPay(500 - premiumBalance)}`}</button></div>`}
          </div>
          <small>解放しただけでは公開中のカードは変わりません。「カードを更新して飾る」で初めて反映します。</small>
        </div>
        <fieldset><legend>カードに飾る実績 <small>最大3件</small></legend><div class="creator-card-achievement-grid">${achievementOptions}</div></fieldset>
        <div class="creator-card-public-note"><strong>公開されるもの</strong><span>表示名・活動札・紹介文・選んだ実績・称号・カード段階・許可したXユーザー名。匿名UID、勝敗、RATE、画像、ルーム履歴は公開しません。</span></div>
        ${useOfflineMarketPreview ? '<p class="creator-card-preview-notice">LOCAL UI PREVIEWでは見た目と画像保存だけを確認でき、公開・更新・削除・購入は行いません。</p>' : ""}
        <div class="creator-card-editor-actions"><button class="button button-primary" id="creatorCardSubmit" type="submit" ${state.topMessageBusy || useOfflineMarketPreview || premiumTrial ? "disabled" : ""}>${existing ? "カードを更新して飾る" : "トップページに飾る"}</button>
          ${existing ? `<button class="button button-ghost" id="deleteTopMessage" type="button" ${state.topMessageBusy || useOfflineMarketPreview ? "disabled" : ""}>トップページから外す</button>` : ""}</div>
      </form>
    </div>
  </section>`;
}

function renderPointShop() {
  const equippedReactionCount = getEquippedReactionProducts().length;
  const equippedStampCount = getEquippedStampProducts().length;
  const equippedChatCosmetics = getEquippedChatCosmetics(state.economy);
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
          : `<div class="shop-message-preview"><span>✦ FAVORITE CARD FINISH</span><strong>推しカードを特別な一枚へ</strong></div>`;
    let action = `<button class="button button-wide button-primary" data-buy-product="${product.id}" ${useOfflineMarketPreview || !state.economyReady || state.economyBusy || !affordable ? "disabled" : ""}>${affordable ? `${formatAnjuPay(product.price)}で購入` : `あと${formatAnjuPay(product.price - state.economy.points)}`}</button>`;
    if (owned && product.type === "feature") {
      action = `<button class="button button-wide button-cyan" data-open-creator-card ${state.topMessageBusy ? "disabled" : ""}>プレミアム仕上げを選ぶ</button>`;
    } else if (owned) {
      action = `<button class="button button-wide ${equipped ? "button-cyan" : "button-ghost"}" data-equip-product="${product.id}" ${useOfflineMarketPreview || !state.economyReady || state.economyBusy || equipDisabled ? "disabled" : ""}>${equipped ? "装備を外す" : equipDisabled ? `装備枠 ${equipLimit}/${equipLimit}` : "装備する"}</button>`;
    }
    const productTypeLabel = product.type === "reaction" ? "CHAT REACTION"
      : product.type === "stamp" ? "CHAT STAMP"
      : product.type === "title" ? (getPlayerTitleCategory(product.category)?.eyebrow || "PLAYER TITLE")
        : product.type === "chatFrame" ? (product.special ? "SPECIAL CHAT FRAME" : "CHAT FRAME")
          : product.type === "chatBackground" ? "CHAT BACKGROUND" : "FAVORITE CARD PREMIUM";
    return `<article class="shop-card ${owned ? "is-owned" : ""} ${equipped ? "is-equipped" : ""}">
      <div class="shop-card-top"><span>${equipped ? "EQUIPPED" : owned ? "OWNED" : productTypeLabel}</span><strong>${formatAnjuPay(product.price)}</strong></div>
      <h2>${escapeHtml(product.name)}</h2>${preview}
      <p>${escapeHtml(product.description)}</p>
      ${action}
    </article>`;
  };
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
  return `<section class="screen economy-screen">
    <div class="section-head"><div><span class="eyebrow">ANJUPAY STORE</span><h1>AnjuPayストア</h1>
      <p>チャット装飾、リアクション、スタンプ、称号で交流をカスタマイズできます。</p></div>
      <button class="button button-ghost button-small" id="economyHomeButton">タイトルへ</button></div>
    <div class="economy-balance"><span>ANJUPAY BALANCE</span><strong>${formatAnjuPayNumber(state.economyReady ? state.economy.points : null)}</strong><small>${ANJU_PAY_UNIT}</small></div>
    ${state.economyReady ? `<div class="shop-loadout-summary"><span>リアクション装備 <strong>${equippedReactionCount} / ${MAX_EQUIPPED_REACTIONS}</strong></span><span>スタンプ装備 <strong>${equippedStampCount} / ${MAX_EQUIPPED_STAMPS}</strong></span><span>称号 <strong>${escapeHtml(getTitleProduct()?.title || "未装備")}</strong></span><span>チャット背景 <strong>${escapeHtml(CHAT_BACKGROUND_PRODUCTS.find((product) => product.id === equippedChatCosmetics.chatBackgroundId)?.name || "標準")}</strong></span><span>チャット枠 <strong>${escapeHtml(CHAT_COSMETIC_PRODUCTS.find((product) => product.id === equippedChatCosmetics.chatFrameId)?.name || "標準")}</strong></span></div>
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
      <section class="shop-category"><div class="shop-category-head"><div><span>FAVORITE CARD</span><h2>推しカードの仕上げ</h2></div><p>推しカードに関する選択と解放は、自分のカードを見ながら行える編集ルームへまとめました。</p></div>
        <div class="shop-free-card-callout"><div><strong>推しカード編集ルームへ移動しました</strong><span>無料テーマもプレミアム仕上げも、自分のカードで試してから選べます。プレミアム3種の500 Pay買い切り解放も編集ルーム内で行います。</span></div><button class="button button-cyan" type="button" data-open-creator-card>推しカード編集へ</button></div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT BACKGROUND / ${CHAT_BACKGROUND_PRODUCTS.length} COLORS</span><h2>チャット背景</h2></div><p>吹き出しの背景を1個装備できます。フレームと自由に組み合わせられます。</p></div><div class="shop-grid">${chatBackgroundProducts}</div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT FRAME / ${CHAT_STANDARD_FRAME_PRODUCTS.length} STYLES</span><h2>チャットフレーム</h2></div><p>かわいい・クール・ネタ系から、吹き出しの枠を1個装備できます。</p></div><div class="shop-grid">${chatFrameProducts}</div></section>
      <section class="shop-category shop-special-category"><div class="shop-category-head"><div><span>PREMIUM FRAME / ${CHAT_SPECIAL_FRAME_PRODUCTS.length} STYLES</span><h2>特別なアニメフレーム</h2></div><p>長期目標として集められる、控えめな動きと光を持つ最高級フレームです。</p></div><div class="shop-grid">${specialChatFrameProducts}</div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT REACTION</span><h2>追加リアクション</h2></div><p>購入品から最大${MAX_EQUIPPED_REACTIONS}個を装備できます。</p></div><div class="shop-grid">${reactionProducts}</div></section>
      <section class="shop-category shop-stamp-category"><div class="shop-category-head"><div><span>CHAT STAMP / ${STAMP_PRODUCTS.length} ITEMS</span><h2>追加スタンプ</h2></div><p>無料4種に加え、購入品から最大${MAX_EQUIPPED_STAMPS}個を装備できます。オンライン対戦チャット共通で、推し値商店の商店チャームは装備枠と別に選べます。</p></div><div class="shop-grid">${stampProducts}</div></section>
      <section class="shop-category shop-title-category" id="shopTitleCategory"><div class="shop-category-head"><div><span>PLAYER TITLE / ${standardTitleProducts.length} STANDARD TITLES</span><h2>プレイヤー称号</h2></div><p>称号は1個だけ装備できます。推し値市場向け7種は上の「推し活・ときめきコレクション」にあります。</p></div><div class="shop-title-filters" role="group" aria-label="称号カテゴリ">${titleCategoryFilters}</div><div class="shop-title-groups">${titleGroups}</div></section>` : renderEconomyUnavailable()}
    <div class="economy-actions"><button class="button button-primary" id="shopMissionsButton">ミッションを見る</button>
      <button class="button button-ghost" id="shopBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">${useOfflineMarketPreview ? "LOCAL UI PREVIEWでは購入・装備を変更しません。表示とレイアウトだけを安全に確認できます。" : "購入後の払い戻しはありません。推しカードは本人が公開を選んだ情報だけを表示します。商品は交流と表示のカスタマイズ専用で、採点や勝敗には影響しません。"}</p>
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
  const reunionDetail = soloServerMatchmakingEnabled()
    ? `<span class="connection-pill ${state.soloReunionPreference ? "connected" : ""}">${state.soloReunionPreference ? "顔なじみとの再会を静かに優先" : "通常の相手を優先"}</span>`
    : "";
  return renderStatusCard({
    icon: "◎",
    eyebrow: "PREFERENCE MATCHING",
    title: "対戦相手を探しています",
    body: scopeBody,
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">好み: ${escapeHtml(preference.shortLabel)}</span>${reunionDetail}${sampleCount ? `<span class="connection-pill warning">SAMPLE ${sampleCount}枚 / 開始HP ${startingHp}</span>` : `<span class="connection-pill">実画像デッキ / 開始HP ${MAX_HP}</span>`}${scopeHint}`,
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
    eyebrow: state.reunionMatch ? "FAMILIAR REUNION" : "MATCH FOUND",
    title: state.reunionMatch ? `${escapeHtml(opponent?.name || "顔なじみ")}と、また会えました` : `${escapeHtml(opponent?.name || "対戦相手")}とマッチング`,
    body: state.reunionMatch
      ? "縁側で知り合った顔なじみとの再会です。いつもの通常型1on1を始めます。"
      : "画像を一時転送するためのP2P接続を準備しています。Firebaseには画像をアップロードしません。",
    details: `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>${state.reunionMatch ? '<span class="connection-pill connected">縁側の顔なじみ</span>' : ""}${handicapDetails}`,
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
      ${state.reunionMatch ? '<span class="connection-pill connected">顔なじみと再会</span>' : ""}
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
  const retryAction = state.imageTransferError
    ? '<button class="button button-primary button-small" id="onlineRetryImageTransfer">画像を再送する</button>'
    : "";
  const body = state.imageTransferError
    ? `転送を完了できませんでした：${escapeHtml(state.imageTransferError)}`
    : `転送状況 ${state.transferProgress}%`;
  return renderBattleWait("P2P IMAGE TRANSFER", state.imageTransferError ? "画像を再送できます" : "画像を安全に転送しています", body, retryAction);
}

function renderWaitingScore() {
  return renderBattleWait("PRIVATE SCORE", "相手の採点を待っています", "あなたの点数は相手の確定まで非公開です。");
}

function renderWaitingContinue() {
  return renderBattleWait(
    "ROUND READY",
    "相手の準備を待っています",
    "両者が準備すると次の画面へ進みます。",
    "",
    renderFinishReplySlot(state.history.at(-1), { terminal: true }),
    !isMatchOver(),
  );
}

function renderBattleWait(
  eyebrow,
  title,
  body,
  extraActions = "",
  extraContent = "",
  allowDestroy = true,
) {
  return `<section class="screen">${renderOnlineHud()}${renderStatusCard({
    icon: "…", eyebrow, title, body,
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div>`,
    actions: `${extraActions}${allowDestroy ? '<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>' : ""}`,
  }).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}
    ${extraContent}<div class="online-chat-standalone">${renderOnlineChat()}</div></section>`;
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

function renderFinishReplySummary(result) {
  const finish = result?.finish;
  if (!finish?.replyAcknowledged) return "";
  const name = escapeHtml(finish.replyName || state.players[result.loserIndex]?.name || "PLAYER");
  const signatureClass = finish.signature ? " is-signature" : "";
  let label = "決着返礼";
  let body = finish.replyLine
    ? `<blockquote>${escapeHtml(finish.replyLine)}</blockquote>`
    : '<p class="finish-result-reply-note">静かに決着を受け入れました。</p>';
  let note = "";
  if (finish.replyDeliveryStatus === "pending") {
    label = "返礼送信中";
    body = '<p class="finish-result-reply-note">相手側の受信確認を待っています…</p>';
  } else if (finish.replyDeliveryStatus === "unconfirmed") {
    label = "返礼受信未確認";
    body = '<p class="finish-result-reply-note is-error">相手側の受信確認が届かなかったため、届いた扱いにはしていません。</p>';
  } else if (finish.replyDeliveryStatus === "not-sent" || finish.replyDeliveryFailed) {
    label = "返礼未送信";
    body = '<p class="finish-result-reply-note is-error">P2P接続が切れているため、この返礼は相手へ届いていません。</p>';
  } else if (finish.replySkipped) {
    label = "返礼なし";
    body = '<p class="finish-result-reply-note">返礼せず結果へ進みました。</p>';
  } else if (finish.replyLineReplaced) {
    note = '<small class="finish-result-reply-disclosure">自由記述は表示設定により、送信者の口調セットに対応する定型文へ置き換えています。</small>';
  }
  return `<article class="finish-result-reply${signatureClass}"><span>${label}</span><strong>${name}</strong>${body}${note}</article>`;
}

function renderFinishReplySlot(result, { terminal = false } = {}) {
  const round = Number.isInteger(result?.round) ? result.round : state.round;
  return `<div class="finish-reply-slot${terminal ? " is-terminal" : ""}" data-finish-reply-slot="${round}" aria-live="polite">${renderFinishReplySummary(result)}</div>`;
}

function syncFinishReplySlot(result) {
  if (!Number.isInteger(result?.round)) return;
  const html = renderFinishReplySummary(result);
  document.querySelectorAll(`[data-finish-reply-slot="${result.round}"]`).forEach((slot) => {
    slot.innerHTML = html;
  });
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
    <div class="damage-callout">${escapeHtml(damageText)}</div>${finishBadge}${renderFinishReplySlot(result)}${pursuitLines}<div class="result-chat">${renderOnlineChat()}</div>
    <div class="button-row" style="justify-content:center">${isMatchOver() ? "" : '<button class="button button-danger" data-online-destroy>ルーム破棄</button>'}
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
    ${state.reunionMatch ? '<div class="solo-reunion-result-note"><strong>また会えました</strong><span>顔なじみとの通常型1on1でした。</span></div>' : ""}
    <div class="final-stats">${state.players.map((player, index) => `<div class="final-player ${outcome.winnerIndex === index ? "winner" : ""}">
      <h2>${escapeHtml(player.name)} ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</h2>
      <div class="stats-row"><div class="stat-box"><strong>${player.hp}</strong><span>残りHP</span></div>
      <div class="stat-box"><strong>${player.totalReceived}</strong><span>合計獲得点</span></div><div class="stat-box"><strong>${player.criticals}</strong><span>CRITICAL</span></div></div>
    </div>`).join("")}</div>
    ${renderFinishReplySlot(state.history.at(-1), { terminal: true })}
    ${renderEngawaInvitation()}
    ${state.economyReady ? `<div class="gameover-missions"><div class="gameover-missions-head"><div><span class="eyebrow">DAILY PROGRESS</span><h2>デイリーミッション</h2></div><strong>AnjuPay ◆ ${formatAnjuPay(state.economy.points)}</strong></div>
      <div class="mission-grid compact">${dailyMissionsForDate(currentDailyDateKey()).map((mission) => renderMissionCard(mission, true)).join("")}</div></div>` : ""}
    <div class="result-chat">${renderOnlineChat()}</div>
    ${renderPostMatchTip({ mode: "solo", roomId: state.roomId, viewerUid: state.uid, recipients: state.players, balance: state.economy.points })}
    <div class="gameover-actions">${shareButton}<button class="button button-primary" id="onlineNewMatch">別の相手を探す</button>
      <button class="button button-ghost" id="onlineGameoverMissions">ミッション・ショップ</button>
      <button class="button button-ghost" id="onlineGameoverHome">タイトルへ戻る</button></div>
  </div></section>`;
}

function getEngawaMood(id) {
  return ENGAWA_MOODS.find((item) => item.id === id) || null;
}

function getEngawaResponse(id) {
  return ENGAWA_RESPONSES.find((item) => item.id === id) || null;
}

function engawaIsMutuallyAccepted() {
  return state.engawaLocalDecision === "accept"
    && state.engawaRemoteDecision === "accept"
    && !state.engawaClosed;
}

function renderEngawaInvitation() {
  const connected = state.opponentOnline && state.channel?.readyState === "open";
  let status = "参加するかどうかは相手に伏せたまま選び、両方が望んだ時だけ開きます。";
  let actions = "";

  if (state.engawaClosed) {
    status = state.engawaEndReason || "縁側は閉じました。共有した画像と反応は保存されません。";
  } else if (!connected) {
    status = "相手とのP2P接続が閉じたため、今回はここで一戦を終えます。";
  } else if (state.engawaLocalDecision === "accept") {
    status = "希望を送りました。相手の選択を静かに待っています。";
    actions = '<button class="button button-ghost button-small" type="button" data-engawa-end>今回はやめておく</button>';
  } else {
    actions = `<button class="button button-primary" type="button" data-engawa-decision="accept">一息ついていく</button>
      <button class="button button-ghost" type="button" data-engawa-decision="decline">今日はここまで</button>`;
  }

  return `<section class="engawa-invite" aria-labelledby="engawaInviteTitle">
    <div class="engawa-invite-head"><div><span>AFTER MATCH / P2P ONLY</span><h2 id="engawaInviteTitle">縁側で一息</h2></div><i aria-hidden="true">♨</i></div>
    <p>勝負はここまで。お互いが望んだ時だけ、手元の一枚と今の気分をそっと見せ合えます。</p>
    <div class="engawa-promises" aria-label="縁側の約束"><span>採点なし</span><span>報酬なし</span><span>保存なし</span></div>
    <p class="engawa-invite-status" aria-live="polite">${escapeHtml(status)}</p>
    ${actions ? `<div class="engawa-invite-actions">${actions}</div>` : ""}
  </section>`;
}

function soloFamiliarDecisionAvailable() {
  return soloFamiliarBookEnabled()
    && engawaIsMutuallyAccepted()
    && state.screen === "engawa"
    && state.engawaImageSent
    && Boolean(state.engawaRemoteImage?.url);
}

function renderSoloFamiliarDecision() {
  if (!soloFamiliarDecisionAvailable()) return "";
  let status = "お互いが同じように思った時だけ、顔なじみ帳に名前が残ります。";
  let actions = `<button class="button button-primary" type="button" data-solo-familiar-decision="accept">またどこかで</button>
    <button class="button button-ghost" type="button" data-solo-familiar-decision="local-only">この場だけ</button>`;
  if (state.soloFamiliarDecision === "local-only") {
    status = "この場だけの思い出にしました。この選択は相手へ送られません。";
    actions = "";
  } else if (state.soloFamiliarDecision === "accept" && state.soloFamiliarDecisionBusy) {
    status = "希望をそっと預けています…";
    actions = '<button class="button button-primary" type="button" disabled>送信中…</button>';
  } else if (state.soloFamiliarDecision === "accept" && state.soloFamiliarDecisionSaved) {
    status = "「またどこかで」を預けました。相手の選択は表示されません。";
    actions = "";
  } else if (state.soloFamiliarDecision === "accept") {
    status = state.soloFamiliarDecisionError || "希望を預けられませんでした。通信状態を確認してください。";
    actions = '<button class="button button-primary" type="button" data-solo-familiar-decision="accept">もう一度預ける</button>';
  }
  return `<section class="solo-familiar-decision" data-solo-familiar-decision-panel aria-labelledby="soloFamiliarDecisionTitle">
    <div><span>ONE QUIET QUESTION</span><h2 id="soloFamiliarDecisionTitle">この人を覚えておく？</h2>
      <p>片方だけの希望や「この場だけ」は、相手に通知されません。</p></div>
    <p class="solo-familiar-decision-status" aria-live="polite">${escapeHtml(status)}</p>
    ${actions ? `<div class="solo-familiar-decision-actions">${actions}</div>` : ""}
    <small>画像・気分・ひとことは保存しません。「またどこかで」を選んだ時だけ、希望をFirebaseで照合します。</small>
  </section>`;
}

function renderEngawa() {
  const opponent = getOpponent();
  const selectedCard = state.deck.find((item) => item.id === state.engawaSelectedCardId);
  const sharedCard = state.deck.find((item) => item.id === state.engawaSharedCardId);
  const sharedMood = getEngawaMood(state.engawaSharedMoodId);
  const remoteMood = getEngawaMood(state.engawaRemoteImage?.moodId);
  const remoteResponse = getEngawaResponse(state.engawaRemoteResponse);
  const localResponse = getEngawaResponse(state.engawaLocalResponse);
  const cards = state.deck.filter((item) => item?.blob && item?.url).map((item, index) => `
    <button class="engawa-pick ${item.id === state.engawaSelectedCardId ? "selected" : ""}" type="button"
      data-engawa-card="${escapeHtml(item.id)}" aria-pressed="${item.id === state.engawaSelectedCardId}">
      <img src="${item.url}" alt="縁側で見せる候補 ${index + 1}" draggable="false" />
      <span>CARD ${String(index + 1).padStart(2, "0")}</span>
    </button>`).join("");
  const moods = ENGAWA_MOODS.map((mood) => `
    <button class="engawa-mood ${mood.id === state.engawaMoodId ? "selected" : ""}" type="button"
      data-engawa-mood="${mood.id}" aria-pressed="${mood.id === state.engawaMoodId}">
      <strong>${escapeHtml(mood.label)}</strong><small>${escapeHtml(mood.description)}</small>
    </button>`).join("");
  const responseButtons = ENGAWA_RESPONSES.map((response) => `
    <button type="button" data-engawa-response="${response.id}">${escapeHtml(response.label)}</button>`).join("");

  const selection = !state.engawaSharedCardId ? `<section class="engawa-selection" aria-labelledby="engawaSelectionTitle">
    <div class="engawa-section-copy"><span>ONE MORE PICTURE</span><h2 id="engawaSelectionTitle">いま見せたい一枚</h2>
      <p>対戦用に用意した5枚から一枚だけ。勝負で使わなかった画像でもかまいません。</p></div>
    <div class="engawa-pick-grid">${cards}</div>
    <div class="engawa-section-copy"><span>HOW IT FEELS</span><h2>今の気分を添える</h2></div>
    <div class="engawa-mood-grid">${moods}</div>
    ${state.engawaRemoteImage ? '<p class="engawa-arrival-note">相手の一枚は届いています。あなたの準備ができるまで伏せておきます。</p>' : ""}
    <button class="button button-primary engawa-share-button" id="engawaShareImage" type="button"
      ${selectedCard && getEngawaMood(state.engawaMoodId) ? "" : "disabled"}>この一枚をそっと置く</button>
  </section>` : "";

  const localTransferText = state.engawaSending
    ? `P2Pで転送中 ${state.engawaTransferProgress}%`
    : state.engawaImageSent
      ? "相手の端末へ直接届けました"
      : state.engawaErrorMessage || "まだ相手へ届いていません";
  const localCardPanel = state.engawaSharedCardId ? `<article class="engawa-share-card is-local">
    <div class="engawa-card-owner"><span>あなたの一枚</span><strong>${escapeHtml(state.players[state.playerIndex]?.name || "YOU")}</strong></div>
    ${sharedCard?.url ? `<div class="engawa-card-image"><img src="${sharedCard.url}" alt="あなたが縁側で見せた画像" draggable="false" /></div>` : '<div class="engawa-card-placeholder">画像を表示できません</div>'}
    <p class="engawa-mood-label">${escapeHtml(sharedMood?.label || "")}</p>
    <p class="engawa-transfer-status ${state.engawaErrorMessage ? "is-error" : ""}" data-engawa-transfer-status aria-live="polite">${escapeHtml(localTransferText)}</p>
    ${!state.engawaImageSent && !state.engawaSending ? '<button class="button button-ghost button-small" id="engawaRetryImage" type="button">もう一度送る</button>' : ""}
    ${remoteResponse ? `<blockquote data-engawa-remote-response-slot><span>${escapeHtml(opponent?.name || "相手")}から</span>${escapeHtml(remoteResponse.label)}</blockquote>` : '<p class="engawa-response-wait" data-engawa-remote-response-slot>相手からのひとことを待っています。</p>'}
  </article>` : "";

  let remoteCardPanel = "";
  if (state.engawaSharedCardId) {
    if (state.engawaRemoteImage?.url) {
      const reaction = localResponse
        ? `<blockquote class="is-sent" data-engawa-local-response-slot><span>あなたから</span>${escapeHtml(localResponse.label)}</blockquote>`
        : state.engawaImageSent
          ? `<div class="engawa-response-panel" data-engawa-local-response-slot><span>ひとことだけ返す</span><div>${responseButtons}</div></div>`
          : '<p class="engawa-response-wait" data-engawa-local-response-slot>あなたの一枚が届くと、ひとこと返せます。</p>';
      remoteCardPanel = `<article class="engawa-share-card is-remote">
        <div class="engawa-card-owner"><span>相手の一枚</span><strong>${escapeHtml(opponent?.name || "PLAYER")}</strong></div>
        <div class="engawa-card-image"><img src="${state.engawaRemoteImage.url}" alt="相手が縁側で見せた画像" draggable="false" /></div>
        <p class="engawa-mood-label">${escapeHtml(remoteMood?.label || "")}</p>
        ${reaction}
      </article>`;
    } else {
      remoteCardPanel = `<article class="engawa-share-card is-waiting">
        <div class="engawa-card-owner"><span>相手の一枚</span><strong>${escapeHtml(opponent?.name || "PLAYER")}</strong></div>
        <div class="engawa-card-placeholder"><i aria-hidden="true">湯</i><span>相手が一枚を選んでいます</span></div>
      </article>`;
    }
  }

  return `<section class="screen engawa-screen"><div class="engawa-shell">
    <header class="engawa-header"><div><span>QUIET AFTER MATCH</span><h1>縁側で一息</h1>
      <p>競う時間を終えて、一枚だけ眺める場所です。</p></div>
      <button class="button button-ghost button-small" id="engawaClose" type="button">縁側を終える</button></header>
    <div class="engawa-privacy-note"><strong>この場だけのやりとり</strong><span>画像・気分・ひとことはP2Pで直接送り、Firebaseや端末履歴へ保存しません。</span></div>
    ${selection}
    ${state.engawaSharedCardId ? `<div class="engawa-gallery">${localCardPanel}${remoteCardPanel}</div>` : ""}
    ${renderSoloFamiliarDecision()}
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
  document.querySelectorAll("[data-online-destroy]").forEach((button) => button.addEventListener("click", openDestroyDialog));
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
  if (state.screen === "familiarBook") bindSoloFamiliarBookEvents();
  if (state.screen === "missions" || state.screen === "shop") bindEconomyEvents();
  if (state.screen === "achievements") bindAchievementEvents();
  if (state.screen === "creatorCard") bindCreatorCardEvents();
  if (state.screen === "matching") {
    document.querySelector("#expandMatchingScope")?.addEventListener("click", expandMatchmakingScope);
    document.querySelector("#cancelMatching")?.addEventListener("click", cancelMatching);
  }
  if (state.screen === "select") bindSelectEvents();
  if (state.screen === "waitingImage") {
    document.querySelector("#onlineRetryImageTransfer")?.addEventListener("click", () => {
      sendSelectedImage().catch(handleRecoverableError);
    });
  }
  if (state.screen === "reveal") document.querySelector("#onlineBeginScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") {
    document.querySelector("#onlineContinue")?.addEventListener("click", () => {
      continueRound().catch(handleRecoverableError);
    });
  }
  if (state.screen === "gameover") {
    bindPostMatchTip(appRoot, {
      mode: "solo",
      roomId: state.roomId,
      viewerUid: state.uid,
      recipients: state.players,
      balance: state.economy.points,
      onBalanceChange: (balance) => { state.economy.points = balance; },
    });
    document.querySelectorAll("[data-engawa-decision]").forEach((button) => button.addEventListener("click", () => {
      submitEngawaDecision(button.dataset.engawaDecision);
    }));
    document.querySelector("[data-engawa-end]")?.addEventListener("click", () => endEngawa("縁側は開かず、ここで一戦を終えました。"));
    document.querySelector("#onlineNewMatch")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineGameoverMissions")?.addEventListener("click", openPostMatchMissions);
    document.querySelector("#onlineGameoverHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "engawa") bindEngawaEvents();
  if (state.screen === "noContest") {
    document.querySelector("#onlineNoContestAgain")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#onlineRetry")?.addEventListener("click", resetOnlineSetup);
    document.querySelector("#onlineErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function bindEngawaEvents() {
  document.querySelectorAll("[data-engawa-card]").forEach((button) => button.addEventListener("click", () => {
    if (state.engawaSharedCardId || !state.deck.some((item) => item.id === button.dataset.engawaCard && item.blob)) return;
    state.engawaSelectedCardId = button.dataset.engawaCard;
    syncEngawaSelectionControls();
  }));
  document.querySelectorAll("[data-engawa-mood]").forEach((button) => button.addEventListener("click", () => {
    if (state.engawaSharedCardId || !getEngawaMood(button.dataset.engawaMood)) return;
    state.engawaMoodId = button.dataset.engawaMood;
    syncEngawaSelectionControls();
  }));
  document.querySelector("#engawaShareImage")?.addEventListener("click", () => {
    sendEngawaImage().catch(handleRecoverableError);
  });
  document.querySelector("#engawaRetryImage")?.addEventListener("click", () => {
    sendEngawaImage().catch(handleRecoverableError);
  });
  document.querySelectorAll("[data-engawa-response]").forEach((button) => button.addEventListener("click", () => {
    sendEngawaResponse(button.dataset.engawaResponse);
  }));
  document.querySelector("#engawaClose")?.addEventListener("click", () => {
    endEngawa("縁側を閉じました。共有した画像と反応は破棄しました。");
  });
  bindSoloFamiliarDecisionEvents();
}

function bindSoloFamiliarDecisionEvents() {
  document.querySelectorAll("[data-solo-familiar-decision]").forEach((button) => {
    button.addEventListener("click", () => {
      submitSoloFamiliarDecision(button.dataset.soloFamiliarDecision);
    });
  });
}

function refreshSoloFamiliarDecisionPanel() {
  const current = document.querySelector("[data-solo-familiar-decision-panel]");
  const markup = renderSoloFamiliarDecision();
  if (!markup) {
    current?.remove();
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = markup;
  const next = wrapper.firstElementChild;
  if (!next) return;
  if (current) current.replaceWith(next);
  else document.querySelector(".engawa-shell")?.append(next);
  bindSoloFamiliarDecisionEvents();
}

async function submitSoloFamiliarDecision(decision) {
  if (!soloFamiliarDecisionAvailable() || state.soloFamiliarDecisionBusy) return;
  if (decision === "local-only") {
    if (state.soloFamiliarDecision) return;
    state.soloFamiliarDecision = "local-only";
    state.soloFamiliarDecisionError = "";
    refreshSoloFamiliarDecisionPanel();
    return;
  }
  if (decision !== "accept" || state.soloFamiliarDecisionSaved) return;
  const expectedState = state;
  const expectedRoomId = state.roomId;
  state.soloFamiliarDecision = "accept";
  state.soloFamiliarDecisionBusy = true;
  state.soloFamiliarDecisionError = "";
  refreshSoloFamiliarDecisionPanel();
  try {
    const response = await soloFamiliarActionCallable({
      action: "accept_familiar",
      roomId: expectedRoomId,
    });
    if (!active || state !== expectedState || state.roomId !== expectedRoomId) return;
    if (response.data?.received !== true) throw new Error("顔なじみ希望を保存できませんでした。");
    state.soloFamiliarDecisionSaved = true;
  } catch (error) {
    console.error(error);
    if (!active || state !== expectedState || state.roomId !== expectedRoomId) return;
    state.soloFamiliarDecisionError = "希望を預けられませんでした。もう一度お試しください。";
  } finally {
    if (active && state === expectedState && state.roomId === expectedRoomId) {
      state.soloFamiliarDecisionBusy = false;
      refreshSoloFamiliarDecisionPanel();
    }
  }
}

function openSoloFamiliarBook() {
  if (!soloFamiliarBookEnabled()) return;
  state.screen = "familiarBook";
  setOnlineChrome("FAMILIAR BOOK");
  render();
  refreshSoloFamiliarBook({ renderAfter: true, notifyError: true });
}

async function mutateSoloFamiliarBook(action, id) {
  if (!soloFamiliarBookEnabled() || state.soloFamiliarBookBusy) return;
  const expectedState = state;
  state.soloFamiliarBookBusy = true;
  render();
  try {
    const payload = { action };
    if (action === "unblock") payload.blockId = id;
    else payload.familiarId = id;
    await soloFamiliarActionCallable(payload);
    if (!active || state !== expectedState) return;
    await refreshSoloFamiliarBook();
    if (!active || state !== expectedState) return;
    const message = action === "remove"
      ? "顔なじみ帳から静かに外しました。"
      : action === "block"
        ? "顔なじみ帳から外し、ブロックしました。"
        : "ブロックを解除しました。";
    showToast(message);
  } catch (error) {
    console.error(error);
    if (active && state === expectedState) showToast("顔なじみ帳を更新できませんでした。");
  } finally {
    if (active && state === expectedState) {
      state.soloFamiliarBookBusy = false;
      render();
    }
  }
}

async function loadMoreSoloBlockedFamiliars() {
  if (!soloFamiliarBookEnabled() || state.soloFamiliarBookBusy || !state.soloBlockedCursor) return;
  const expectedState = state;
  const afterId = state.soloBlockedCursor;
  const refreshGeneration = state.soloFamiliarRefreshGeneration;
  state.soloFamiliarBookBusy = true;
  state.soloBlockedDetailsOpen = true;
  render();
  try {
    const response = await soloFamiliarActionCallable({
      action: "get_blocks",
      afterId,
    });
    if (!active || state !== expectedState || state.screen !== "familiarBook"
        || state.soloFamiliarRefreshGeneration !== refreshGeneration
        || state.soloBlockedCursor !== afterId) return;
    const combinedEntries = new Map(
      state.soloBlockedFamiliars.map((entry) => [entry.id, entry]),
    );
    normalizeSoloFamiliarEntries(response.data?.blocked, { blocked: true })
      .forEach((entry) => {
        if (!combinedEntries.has(entry.id)) combinedEntries.set(entry.id, entry);
      });
    state.soloBlockedFamiliars = [...combinedEntries.values()];
    const nextCursor = normalizeSoloBlockedCursor(response.data?.blockedCursor);
    state.soloBlockedCursor = nextCursor === afterId ? "" : nextCursor;
  } catch (error) {
    console.error(error);
    if (active && state === expectedState) {
      showToast("ブロック一覧の続きを読み込めませんでした。");
    }
  } finally {
    if (active && state === expectedState) {
      state.soloFamiliarBookBusy = false;
      render();
    }
  }
}

function bindSoloFamiliarBookEvents() {
  document.querySelector(".solo-familiar-blocked")?.addEventListener("toggle", (event) => {
    state.soloBlockedDetailsOpen = event.currentTarget.open === true;
  });
  document.querySelector("#soloFamiliarBack")?.addEventListener("click", () => {
    state.screen = "setup";
    setOnlineChrome("ONLINE READY");
    render();
  });
  document.querySelector("#soloFamiliarRefresh")?.addEventListener("click", async () => {
    if (state.soloFamiliarBookBusy) return;
    const expectedState = state;
    state.soloFamiliarBookBusy = true;
    render();
    await refreshSoloFamiliarBook({ notifyError: true });
    if (active && state === expectedState) {
      state.soloFamiliarBookBusy = false;
      render();
    }
  });
  document.querySelectorAll("[data-solo-familiar-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!window.confirm("顔なじみ帳から外しますか？ 相手には通知されません。")) return;
      mutateSoloFamiliarBook("remove", button.dataset.soloFamiliarRemove);
    });
  });
  document.querySelectorAll("[data-solo-familiar-block]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!window.confirm("この相手をブロックしますか？ 顔なじみ帳と再会優先から外れますが、通常検索での偶然の再会まで防ぐ保証はありません。")) return;
      mutateSoloFamiliarBook("block", button.dataset.soloFamiliarBlock);
    });
  });
  document.querySelectorAll("[data-solo-familiar-unblock]").forEach((button) => {
    button.addEventListener("click", () => {
      mutateSoloFamiliarBook("unblock", button.dataset.soloFamiliarUnblock);
    });
  });
  document.querySelector("#soloFamiliarLoadMoreBlocked")?.addEventListener("click", () => {
    loadMoreSoloBlockedFamiliars();
  });
}

function syncEngawaSelectionControls() {
  document.querySelectorAll("[data-engawa-card]").forEach((button) => {
    const selected = button.dataset.engawaCard === state.engawaSelectedCardId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-engawa-mood]").forEach((button) => {
    const selected = button.dataset.engawaMood === state.engawaMoodId;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const shareButton = document.querySelector("#engawaShareImage");
  if (shareButton) {
    const selectedCard = state.deck.find((item) => item.id === state.engawaSelectedCardId && item.blob);
    shareButton.disabled = !selectedCard || !getEngawaMood(state.engawaMoodId);
  }
}

function syncEngawaResponseControls() {
  const localSlot = document.querySelector("[data-engawa-local-response-slot]");
  const localResponse = getEngawaResponse(state.engawaLocalResponse);
  if (localSlot && localResponse) {
    localSlot.outerHTML = `<blockquote class="is-sent" data-engawa-local-response-slot><span>あなたから</span>${escapeHtml(localResponse.label)}</blockquote>`;
  }
  const remoteSlot = document.querySelector("[data-engawa-remote-response-slot]");
  const remoteResponse = getEngawaResponse(state.engawaRemoteResponse);
  if (remoteSlot && remoteResponse) {
    const opponent = getOpponent();
    remoteSlot.outerHTML = `<blockquote data-engawa-remote-response-slot><span>${escapeHtml(opponent?.name || "相手")}から</span>${escapeHtml(remoteResponse.label)}</blockquote>`;
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

function normalizeCreatorCardDraft(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    name: String(source.name ?? "").slice(0, 16),
    text: String(source.text ?? "").slice(0, TOP_MESSAGE_MAX_LENGTH),
    creatorType: getCreatorCardType(source.creatorType || "illustration").id,
    xHandleInput: String(source.xHandleInput ?? "").trim().replace(/^@+/, "").slice(0, 15),
    xPublic: source.xPublic === true,
    cardTheme: getCreatorCardTheme(source.cardTheme || "basic-rose").id,
    achievementShowcase: normalizeCreatorCardAchievementIds(source.achievementShowcase),
  };
}

function captureCreatorCardDraft() {
  const form = document.querySelector("#creatorCardForm");
  if (!form) return state.creatorCardDraft;
  const achievementShowcase = [...document.querySelectorAll("[data-creator-card-achievement][aria-pressed='true']")]
    .map((button) => button.dataset.creatorCardAchievement)
    .filter(Boolean)
    .slice(0, 3);
  const draft = normalizeCreatorCardDraft({
    name: document.querySelector("#creatorCardName")?.value ?? "",
    text: document.querySelector("#creatorCardText")?.value ?? "",
    creatorType: document.querySelector('input[name="creatorCardType"]:checked')?.value,
    xHandleInput: document.querySelector("#creatorCardXHandle")?.value ?? "",
    xPublic: document.querySelector("#creatorCardXPublic")?.checked === true,
    cardTheme: document.querySelector('input[name="creatorCardTheme"]:checked')?.value,
    achievementShowcase,
  });
  state.creatorCardDraft = draft;
  return draft;
}

function creatorCardUsesLockedPremium(value) {
  return getCreatorCardTheme(value?.cardTheme).premium && state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] !== true;
}

function creatorCardFormValue() {
  const draft = captureCreatorCardDraft() || normalizeCreatorCardDraft();
  return creatorCardPresentation({
    name: draft.name,
    text: draft.text,
    creatorType: draft.creatorType,
    xHandle: draft.xPublic ? draft.xHandleInput : "",
    cardTheme: draft.cardTheme,
    achievementShowcase: draft.achievementShowcase,
  });
}

function updateCreatorCardPreview() {
  const value = creatorCardFormValue();
  const selectedTheme = getCreatorCardTheme(value.cardTheme);
  const premiumOwned = state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] === true;
  const premiumTrial = selectedTheme.premium && !premiumOwned;
  const preview = document.querySelector("#creatorCardPreview");
  if (preview) preview.innerHTML = shared()?.renderCreatorCard?.(value, { preview: true }) || "";
  const counter = document.querySelector("#creatorCardLength");
  if (counter) counter.textContent = String(document.querySelector("#creatorCardText")?.value.length || 0);
  document.querySelectorAll("[data-creator-card-template]").forEach((button) => {
    button.hidden = button.dataset.creatorCardTemplateType !== value.creatorType;
  });
  const premiumPanel = document.querySelector("#creatorCardPremiumPanel");
  if (premiumPanel) {
    premiumPanel.classList.toggle("is-owned", premiumOwned);
    premiumPanel.setAttribute("aria-busy", String(state.economyBusy));
  }
  const trialLabel = document.querySelector("#creatorCardPremiumTrialLabel");
  if (trialLabel) {
    trialLabel.textContent = premiumOwned ? "解放済み・追加料金なし" : premiumTrial ? `「${selectedTheme.label}」を試着中です` : "プレミアムを選ぶと、自分のカードで仕上がりを試せます";
  }
  const unlockButton = document.querySelector("#creatorCardUnlockPremium");
  if (unlockButton) {
    const balance = Math.max(0, Math.floor(Number(state.economy.points || 0)));
    const affordable = balance >= 500;
    unlockButton.disabled = !premiumTrial || !affordable || state.economyBusy || useOfflineMarketPreview;
    unlockButton.textContent = useOfflineMarketPreview
      ? "LOCAL UI PREVIEWでは購入できません"
      : !premiumTrial
        ? "プレミアム仕上げを選んで試着"
        : !affordable
          ? `あと${formatAnjuPay(500 - balance)}`
          : "3つの仕上げを500 Payで解放";
  }
  const submitButton = document.querySelector("#creatorCardSubmit");
  if (submitButton) submitButton.disabled = state.topMessageBusy || useOfflineMarketPreview || premiumTrial;
  const downloadButton = document.querySelector("#creatorCardDownload");
  if (downloadButton) downloadButton.disabled = premiumTrial;
  const nativeShareButton = document.querySelector("#creatorCardNativeShare");
  if (nativeShareButton) nativeShareButton.disabled = premiumTrial;
  const xShare = document.querySelector("#creatorCardXShare");
  if (xShare) {
    xShare.classList.toggle("is-disabled", premiumTrial);
    xShare.setAttribute("aria-disabled", String(premiumTrial));
    if (premiumTrial) {
      xShare.href = "#";
      xShare.setAttribute("tabindex", "-1");
    } else {
      xShare.href = shared()?.createXCreatorCardPostUrl?.(value) || "#";
      xShare.removeAttribute("tabindex");
    }
  }
  const trialShareNote = document.querySelector("#creatorCardTrialShareNote");
  if (trialShareNote) trialShareNote.hidden = !premiumTrial;
  return value;
}

function creatorCardDownloadName(value) {
  const safeName = String(value?.name || "player").replace(/[\\/:*?"<>|]/g, "_").slice(0, 24) || "player";
  return `hariai-favorite-card-${safeName}.png`;
}

async function downloadCreatorCard({ shareFile = false } = {}) {
  const value = creatorCardFormValue();
  if (creatorCardUsesLockedPremium(value)) throw new Error("プレミアム仕上げを解放すると画像保存・共有できます。");
  setBusy(true, "推しカード画像をつくっています…");
  try {
    const blob = await shared()?.createCreatorCardPngBlob?.(value);
    if (!(blob instanceof Blob)) throw new Error("カード画像を作成できませんでした。");
    const filename = creatorCardDownloadName(value);
    const file = new File([blob], filename, { type: "image/png" });
    if (shareFile && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "貼り合いスタジアム｜推しカード",
        text: shared()?.creatorCardShareText?.(value) || "",
        files: [file],
      });
      return;
    }
    shared()?.downloadBlob?.(blob, filename);
    showToast(shareFile
      ? "共有対応端末ではないため画像を保存しました。X側で添付できます。"
      : "推しカード画像を保存しました。Xの投稿へ添付できます。");
  } finally {
    setBusy(false);
  }
}

async function retryCreatorCardDependencies() {
  if (!state.uid || state.creatorCardDependenciesBusy) return;
  state.creatorCardDependenciesBusy = true;
  state.creatorCardDependenciesSettled = false;
  render();
  const errors = [];
  try {
    await initializeEconomy();
  } catch (error) {
    console.error(error);
    state.economyReady = false;
    errors.push(error);
  }
  try {
    await loadOwnTopMessage();
  } catch (error) {
    console.error(error);
    state.topMessageReady = false;
    errors.push(error);
  }
  state.creatorCardDependenciesBusy = false;
  state.creatorCardDependenciesSettled = true;
  render();
  if (errors.length) showToast("推しカード情報を再読み込みできませんでした。時間をおいてお試しください。");
  else showToast("推しカード情報を再読み込みしました。");
}

function bindCreatorCardEvents() {
  document.querySelector("#creatorCardHomeButton")?.addEventListener("click", leaveToLanding);
  document.querySelector("#creatorCardRetry")?.addEventListener("click", () => {
    retryCreatorCardDependencies().catch((error) => {
      console.error(error);
      showToast("推しカード情報を再読み込みできませんでした。");
    });
  });
  const form = document.querySelector("#creatorCardForm");
  if (!form) return;
  document.querySelector("#creatorCardUnlockPremium")?.addEventListener("click", async () => {
    const value = creatorCardFormValue();
    const selectedTheme = getCreatorCardTheme(value.cardTheme);
    if (!selectedTheme.premium) {
      showToast("プレミアム仕上げを選び、自分のカードで試着してから解放できます。");
      return;
    }
    if (state.economy.inventory?.[TOP_MESSAGE_PRODUCT_ID] === true) {
      showToast("プレミアム仕上げは解放済みです。追加料金はかかりません。");
      updateCreatorCardPreview();
      return;
    }
    if (useOfflineMarketPreview) {
      showToast("LOCAL UI PREVIEWではAnjuPayを使用しません。");
      return;
    }
    if (state.economyBusy) return;
    const balance = Math.max(0, Math.floor(Number(state.economy.points || 0)));
    if (balance < 500) {
      showToast(`プレミアム仕上げの解放まで、あと${formatAnjuPay(500 - balance)}です。`);
      return;
    }
    const confirmed = window.confirm(
      `プレミアム仕上げ3種を500 Payで解放しますか？\n\n残高 ${formatAnjuPay(balance)} → ${formatAnjuPay(balance - 500)}\n買い切りで、ホログラム・スターダスト・ロイヤル箔を何度でも使えます。\n購入だけでは公開中のカードは変わりません。`,
    );
    if (!confirmed) return;
    await purchaseShopProduct(TOP_MESSAGE_PRODUCT_ID);
  });
  document.querySelector("#creatorCardXShare")?.addEventListener("click", (event) => {
    if (!creatorCardUsesLockedPremium(creatorCardFormValue())) return;
    event.preventDefault();
    showToast("プレミアム仕上げを解放するとXで披露できます。");
  });
  form.querySelectorAll("input, textarea").forEach((control) => {
    control.addEventListener("input", updateCreatorCardPreview);
    control.addEventListener("change", updateCreatorCardPreview);
  });
  document.querySelectorAll("[data-creator-card-template]").forEach((button) => button.addEventListener("click", () => {
    const typeInput = document.querySelector(`input[name="creatorCardType"][value="${button.dataset.creatorCardTemplateType}"]`);
    if (typeInput) typeInput.checked = true;
    const text = document.querySelector("#creatorCardText");
    if (text) {
      text.value = button.dataset.creatorCardTemplate || "";
      text.focus();
    }
    updateCreatorCardPreview();
  }));
  document.querySelectorAll("[data-creator-card-achievement]").forEach((button) => button.addEventListener("click", () => {
    const selected = button.getAttribute("aria-pressed") === "true";
    const selectedCount = document.querySelectorAll("[data-creator-card-achievement][aria-pressed='true']").length;
    if (!selected && selectedCount >= 3) {
      showToast("カードへ飾れる実績は3件までです。");
      return;
    }
    button.setAttribute("aria-pressed", String(!selected));
    updateCreatorCardPreview();
  }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = creatorCardFormValue();
    if (creatorCardUsesLockedPremium(value)) {
      showToast("プレミアム仕上げを解放してからカードを公開してください。");
      return;
    }
    try {
      await saveTopMessage({
        name: value.name,
        text: value.text,
        creatorType: value.creatorType,
        xHandle: value.xHandle,
        cardTheme: value.cardTheme,
        achievementIds: value.achievementShowcase,
      });
    } catch (error) {
      showToast(error?.message || "推しカードを公開できませんでした。");
    }
  });
  document.querySelector("#deleteTopMessage")?.addEventListener("click", async () => {
    if (!window.confirm("トップページから推しカードを外しますか？育成や仕上げの権利は失われません。")) return;
    try {
      await deleteTopMessage();
    } catch (error) {
      showToast(error?.message || "推しカードを外せませんでした。");
    }
  });
  document.querySelector("#creatorCardDownload")?.addEventListener("click", () => {
    downloadCreatorCard().catch((error) => showToast(error?.message || "カード画像を保存できませんでした。"));
  });
  document.querySelector("#creatorCardNativeShare")?.addEventListener("click", () => {
    downloadCreatorCard({ shareFile: true }).catch((error) => {
      if (error?.name !== "AbortError") showToast(error?.message || "カード画像を共有できませんでした。");
    });
  });
  updateCreatorCardPreview();
}

function bindEconomyEvents() {
  document.querySelector("#economyHomeButton")?.addEventListener("click", leaveToLanding);
  document.querySelector("#claimDailyPlayRewardsButton")?.addEventListener("click", claimDailyPlayRewards);
  document.querySelector("#missionsShopButton")?.addEventListener("click", () => { state.screen = "shop"; render(); });
  document.querySelector("#shopMissionsButton")?.addEventListener("click", () => { state.screen = "missions"; render(); });
  document.querySelector("#missionsBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
  document.querySelector("#shopBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
  document.querySelectorAll("[data-open-creator-card]").forEach((button) => button.addEventListener("click", () => {
    openCreatorCard();
  }));
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
  document.querySelector("#openSoloFamiliarBook")?.addEventListener("click", openSoloFamiliarBook);
  document.querySelector("#soloReunionPreference")?.addEventListener("change", (event) => {
    state.soloReunionPreference = event.currentTarget.checked === true;
    localStorage.setItem(SOLO_REUNION_PREFERENCE_KEY, state.soloReunionPreference ? "1" : "0");
  });
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
  bindOnlineRoleplayVoiceField();
  bindOnlinePursuitFields();
  bindOnlineFinishFields();
  bindOnlineFinishReplyFields();
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
    beginMatchmaking().catch(handleRecoverableError);
    return;
  }
  const startingHp = getStartingHp(sampleCount);
  if (!sampleHandicapDialog || !sampleHandicapMessage || !confirmSampleMatch) {
    if (window.confirm(`サンプル画像${sampleCount}枚を含むため、最大HP${startingHp}で開始します。対戦を探しますか？`)) {
      beginMatchmaking().catch(handleRecoverableError);
    }
    return;
  }
  sampleHandicapMessage.textContent = `サンプル画像${sampleCount}枚を含むため、最大HP${startingHp}で開始します。対戦相手にもサンプル枚数と開始HPが表示されます。`;
  confirmSampleMatch.textContent = `HP ${startingHp}で対戦を探す`;
  sampleHandicapDialog.returnValue = "";
  sampleHandicapDialog.showModal();
}

function bindOnlineRoleplayVoiceField() {
  document.querySelector("#onlineRoleplayVoiceSet")?.addEventListener("change", (event) => {
    const value = normalizeRoleplayVoiceSetId(event.currentTarget.value);
    if (!value) {
      markRoleplayVoiceSetIndividual();
      return;
    }
    applyRoleplayVoiceSetSetting(value);
    render();
    document.querySelector("#onlineRoleplayVoiceSet")?.focus({ preventScroll: true });
  });
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
    markRoleplayVoiceSetIndividual();
    state.pursuitLineChoice = select.value;
    if (select.value === CUSTOM_PURSUIT_VALUE) {
      state.pursuitLine = normalizePursuitLine(state.customPursuitLine);
      input?.focus();
    } else {
      state.pursuitLine = normalizePursuitLine(select.value);
    }
    persistRoleplayLineSettings();
    syncCustomVisibility();
  });
  input?.addEventListener("input", () => {
    markRoleplayVoiceSetIndividual();
    input.value = sanitizePursuitLineDraft(input.value);
    state.customPursuitLine = input.value;
    state.pursuitLine = normalizePursuitLine(input.value);
    persistRoleplayLineSettings();
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
    markRoleplayVoiceSetIndividual();
    state.finishLineChoice = select.value;
    if (select.value === CUSTOM_FINISH_VALUE) {
      state.finishLine = normalizeFinishLine(state.customFinishLine);
      input?.focus();
    } else {
      applyFinishLineSetting(select.value);
    }
    persistRoleplayLineSettings();
    syncCustomVisibility();
  });
  input?.addEventListener("input", () => {
    markRoleplayVoiceSetIndividual();
    input.value = sanitizeFinishLineDraft(input.value);
    state.customFinishLine = input.value;
    state.finishLine = normalizeFinishLine(input.value);
    persistRoleplayLineSettings();
    if (counter) counter.textContent = String(input.value.length);
  });
  visibilityToggle?.addEventListener("change", () => {
    state.showOpponentCustomFinish = visibilityToggle.checked;
    localStorage.setItem(OPPONENT_CUSTOM_FINISH_KEY, state.showOpponentCustomFinish ? "1" : "0");
  });
  syncCustomVisibility();
}

function bindOnlineFinishReplyFields() {
  const select = document.querySelector("#onlineFinishReplyChoice");
  const field = document.querySelector("#onlineCustomFinishReplyField");
  const input = document.querySelector("#onlineCustomFinishReplyLine");
  const counter = document.querySelector("#onlineFinishReplyCharacterCount");
  const syncCustomVisibility = () => {
    if (field) field.hidden = select?.value !== CUSTOM_FINISH_REPLY_VALUE;
  };
  select?.addEventListener("change", () => {
    markRoleplayVoiceSetIndividual();
    state.finishReplyChoice = select.value;
    if (select.value === CUSTOM_FINISH_REPLY_VALUE) {
      state.finishReplyLine = normalizeFinishReplyLine(state.customFinishReplyLine, "");
      input?.focus();
    } else {
      applyFinishReplySetting(select.value);
    }
    persistRoleplayLineSettings();
    syncCustomVisibility();
  });
  input?.addEventListener("input", () => {
    markRoleplayVoiceSetIndividual();
    input.value = sanitizeFinishReplyDraft(input.value);
    state.customFinishReplyLine = input.value;
    state.finishReplyLine = normalizeFinishReplyLine(input.value, "");
    persistRoleplayLineSettings();
    if (counter) counter.textContent = String(countFinishReplyCharacters(input.value));
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
  if (useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEWではAnjuPayを使用しません。");
    return;
  }
  const dateKey = currentDailyDateKey();
  const expectedState = state;
  const expectedUid = expectedState.uid;
  expectedState.economyBusy = true;
  render();
  try {
    const response = await economyActionCallable({ action: "purchase", productId: product.id });
    const result = response.data || {};
    if (!active || state !== expectedState || state.uid !== expectedUid) {
      expectedState.economyBusy = false;
      return;
    }
    const wasEquipped = product.type === "reaction"
      ? expectedState.economy.equipped?.reactions?.[product.id] === true
      : product.type === "stamp"
        ? expectedState.economy.equipped?.stamps?.[product.id] === true
        : ["title", "chatFrame", "chatBackground"].includes(product.type)
          ? expectedState.economy.equipped?.[product.type] === product.id
          : false;
    const economySnapshot = await get(ref(database, `online/economy/${expectedUid}`));
    if (!active || state !== expectedState || state.uid !== expectedUid) {
      expectedState.economyBusy = false;
      return;
    }
    applyEconomySnapshot(economySnapshot, dateKey);
    if (Number.isFinite(Number(result.balance))) expectedState.economy.points = Math.min(MAX_POINTS, Math.max(0, Number(result.balance)));
    const isEquipped = product.type === "reaction"
      ? expectedState.economy.equipped?.reactions?.[product.id] === true
      : product.type === "stamp"
        ? expectedState.economy.equipped?.stamps?.[product.id] === true
        : ["title", "chatFrame", "chatBackground"].includes(product.type)
          ? expectedState.economy.equipped?.[product.type] === product.id
          : false;
    expectedState.economyBusy = false;
    render();
    if (result.outcome === "purchased" && isEquipped && !wasEquipped) showToast(`「${product.reaction || product.title || product.name}」を購入し、装備しました。`);
    else if (result.outcome === "purchased" && product.type === "feature") showToast("推しカードのプレミアム仕上げ3種を解放しました。カードを更新して飾るまでは、公開中のカードはそのままです。");
    else if (result.outcome === "purchased") showToast(`「${product.reaction || product.title || product.name}」を購入しました。装備枠を空けると使用できます。`);
    else if (result.outcome === "owned") showToast("この商品は購入済みです。");
    else showToast("AnjuPay残高が不足しています。");
  } catch (error) {
    console.error(error);
    if (!active || state !== expectedState || state.uid !== expectedUid) {
      expectedState.economyBusy = false;
      return;
    }
    expectedState.economyBusy = false;
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
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const response = await economyActionCallable({
      action: "record_match",
      mode,
      outcome,
      roomId,
      ...(mode === "solo" ? { finalizationVersion: 2 } : {}),
    });
    const result = response.data || {};
    if (result.outcome === "pending") {
      const retryDelay = Math.min(750, Math.max(250, Number(result.retryAfterMs) || 750));
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
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
  if (current?.appliedResults && typeof current.appliedResults === "object") {
    record.appliedResults = { ...current.appliedResults };
  }
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

async function recordLeaderboardPeriodResult(
  outcome,
  mode,
  uid,
  profile,
  name,
  settings,
  roomId = "",
  resultToken = "",
) {
  if (!LEADERBOARD_PERIODS.length || !["win", "loss", "draw"].includes(outcome) || !LEADERBOARD_MODES.includes(mode)) return;
  const entryId = await ensureLeaderboardIdentityForUser(uid);
  const timestamp = serverNow();
  await Promise.all(LEADERBOARD_PERIODS.map(async (period) => {
    const key = leaderboardPeriodKeyFor(period, timestamp);
    if (isServerRankingPeriod(period, key)) return;
    await rememberLeaderboardPeriod(entryId, period, key, uid);
    const result = await runTransaction(ref(database, `online/leaderboardPeriods/${period}/${key}/${entryId}`), (current) => {
      if (resultToken && current?.appliedResults?.[resultToken] === outcome) {
        return undefined;
      }
      const record = periodLeaderboardRecord(current, outcome, mode, profile, name, settings);
      if (roomId) {
        record.lastResultRoomId = roomId;
        record.lastResultMode = mode;
        record.lastResultOutcome = outcome;
      }
      if (resultToken) {
        record.appliedResults = {
          ...record.appliedResults,
          [resultToken]: outcome,
        };
      }
      return record;
    });
    const storedPeriod = result.snapshot.val();
    if (resultToken && storedPeriod?.appliedResults?.[resultToken] !== outcome) {
      throw new Error("期間ランキングを更新できませんでした。");
    }
    if (!resultToken && roomId && (
      storedPeriod?.lastResultRoomId !== roomId
        || storedPeriod?.lastResultMode !== mode
        || storedPeriod?.lastResultOutcome !== outcome
    )) throw new Error("期間ランキングを更新できませんでした。");
    if (!roomId && !result.committed) throw new Error("期間ランキングを更新できませんでした。");
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
  if (event) {
    await recordLeaderboardPeriodResult(
      event.outcome,
      event.mode,
      uid,
      profile,
      name,
      settings,
      event.roomId,
      event.resultToken,
    );
  }
  else await syncCurrentPeriodLeaderboardMetadata(entryId, uid, profile, name, settings);
  const achievementResponse = await economyActionCallable({ action: "sync_achievement_showcase" });
  if (state.uid === uid) applyAchievementPayload(achievementResponse.data?.achievements, { notifyPending: true });
  await syncServerRankingParticipation(uid, entryId, true);
}

function pendingSoloPublicResultsStorageKey(uid) {
  return `${PENDING_SOLO_PUBLIC_RESULTS_KEY}:${String(uid || "")}`;
}

function normalizePendingSoloPublicResult(value) {
  const resultToken = String(value?.resultToken || "");
  const roomId = String(value?.roomId || "");
  const outcome = String(value?.outcome || "");
  if (value?.mode !== "solo"
      || !/^[a-f0-9]{40}$/.test(resultToken)
      || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)
      || !["win", "loss", "draw"].includes(outcome)) return null;
  return {
    mode: "solo",
    outcome,
    roomId,
    resultToken,
    name: String(value?.name || "PLAYER").trim().slice(0, 16) || "PLAYER",
  };
}

function pendingSoloPublicResults(uid) {
  if (!uid) return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(pendingSoloPublicResultsStorageKey(uid)) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePendingSoloPublicResult)
      .filter(Boolean)
      .slice(-20);
  } catch {
    return [];
  }
}

function writePendingSoloPublicResults(uid, entries) {
  if (!uid) return;
  const normalized = entries
    .map(normalizePendingSoloPublicResult)
    .filter(Boolean)
    .slice(-20);
  try {
    if (normalized.length) {
      localStorage.setItem(
        pendingSoloPublicResultsStorageKey(uid),
        JSON.stringify(normalized),
      );
    } else {
      localStorage.removeItem(pendingSoloPublicResultsStorageKey(uid));
    }
  } catch {
    // A ranking retry must never block the verified match result.
  }
}

function queuePendingSoloPublicResult(uid, event) {
  const normalized = normalizePendingSoloPublicResult(event);
  if (!uid || !normalized) return;
  const pending = pendingSoloPublicResults(uid)
    .filter((entry) => entry.resultToken !== normalized.resultToken);
  pending.push(normalized);
  writePendingSoloPublicResults(uid, pending);
}

function clearPendingSoloPublicResult(uid, resultToken) {
  writePendingSoloPublicResults(
    uid,
    pendingSoloPublicResults(uid)
      .filter((entry) => entry.resultToken !== resultToken),
  );
}

async function flushPendingSoloPublicResults(targetState = state) {
  const uid = targetState?.uid || "";
  const settings = leaderboardPublicSettings();
  if (!uid || !settings.enabled) return 0;
  const pending = pendingSoloPublicResults(uid);
  let completed = 0;
  for (const event of pending) {
    await publishOverallLeaderboard(
      uid,
      targetState.overallProfile,
      event.name || targetState.name,
      settings,
      event,
    );
    clearPendingSoloPublicResult(uid, event.resultToken);
    completed += 1;
  }
  return completed;
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

async function recordOverallResult({
  mode,
  outcome,
  name,
  opponentRating = INITIAL_RATING,
  soloSeed = null,
  roomId = "",
  sourceState = state,
  deferPublicSync = false,
} = {}) {
  if (!LEADERBOARD_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) return null;
  await setPersistence(auth, browserLocalPersistence);
  const user = auth.currentUser || (await signInAnonymously(auth)).user;
  await economyActionCallable({ action: "initialize" });
  const displayName = String(name || localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER").trim().slice(0, 16) || "PLAYER";
  const resultTimestamp = Date.now() + Number(sourceState.uid === user.uid ? sourceState.serverTimeOffset : publicServerTimeOffset || 0);
  const periodResult = await recordPeriodRewardResult(user.uid, mode, outcome, roomId, resultTimestamp);
  const resultToken = String(periodResult?.resultToken || "");
  if (!/^[a-f0-9]{40}$/.test(resultToken)) {
    throw new Error("検証済み対戦IDを確認できませんでした。");
  }
  const preserveOverallRating = mode === "team"
    && periodResult?.teamChallengeResult?.variant === "oshi_jouzu_duo";
  const serverProjection = mode === "solo"
    && periodResult?.profileProjectionMode === "server-v2";
  const projectionPending = serverProjection
    && periodResult?.profileProjectionPending === true;
  let profile;
  if (serverProjection) {
    if (sourceState.uid === user.uid) {
      applyServerSoloProjectionProfiles(sourceState, periodResult);
      profile = normalizeOverallProfile(
        sourceState.overallProfile,
        displayName,
        sourceState.profile,
      );
    } else {
      profile = normalizeOverallProfile(
        periodResult?.overallProfile,
        displayName,
        soloSeed,
      );
    }
  } else {
    await ensureOverallProfileSeeded(user.uid, displayName, soloSeed || (sourceState.uid === user.uid ? sourceState.profile : null));
    const result = await runTransaction(ref(database, `online/overallProfiles/${user.uid}`), (current) => {
      if (current?.appliedResults?.[resultToken] === outcome) {
        return undefined;
      }
      const record = normalizeOverallProfile(current, displayName);
      const modeRecord = { ...record.modes[mode] };
      if (outcome === "win") { record.wins += 1; modeRecord.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
      else if (outcome === "loss") { record.losses += 1; modeRecord.losses += 1; record.streak = 0; }
      else { record.draws += 1; modeRecord.draws += 1; }
      modeRecord.matches = modeRecord.wins + modeRecord.losses + modeRecord.draws;
      modeRecord.points = (modeRecord.wins * 3) + modeRecord.draws;
      record.modes[mode] = modeRecord;
      record.name = displayName;
      record.rating = preserveOverallRating
        ? record.rating
        : calculateRating(record.rating, Math.min(3000, Math.max(100, Number(opponentRating || INITIAL_RATING))), outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0);
      record.updatedAt = Date.now();
      if (roomId) {
        record.lastResultRoomId = roomId;
        record.lastResultMode = mode;
        record.lastResultOutcome = outcome;
      }
      record.appliedResults = {
        ...(current?.appliedResults && typeof current.appliedResults === "object"
          ? current.appliedResults
          : {}),
        [resultToken]: outcome,
      };
      if (typeof current?.serverProjectionReceipts === "string"
          && current.serverProjectionReceipts.length <= 800) {
        record.serverProjectionReceipts = current.serverProjectionReceipts;
      }
      if (Number.isSafeInteger(current?.serverProjectionSequence)
          && current.serverProjectionSequence > 0) {
        record.serverProjectionSequence = current.serverProjectionSequence;
      }
      return record;
    });
    const storedOverallProfile = result.snapshot.val();
    if (storedOverallProfile?.appliedResults?.[resultToken] !== outcome) {
      throw new Error("総合戦績を更新できませんでした。");
    }
    profile = normalizeOverallProfile(storedOverallProfile, displayName);
    if (sourceState.uid === user.uid) sourceState.overallProfile = profile;
  }
  const settings = leaderboardPublicSettings();
  const publicResultEvent = {
    mode,
    outcome,
    roomId,
    resultToken,
    name: displayName,
  };
  if (settings.enabled && projectionPending) {
    queuePendingSoloPublicResult(user.uid, publicResultEvent);
  } else if (settings.enabled) {
    const publicSync = publishOverallLeaderboard(
      user.uid,
      profile,
      displayName,
      settings,
      publicResultEvent,
    );
    if (deferPublicSync) {
      publicSync.then(() => {
        clearPendingSoloPublicResult(user.uid, resultToken);
      }).catch((error) => {
        if (mode === "solo") queuePendingSoloPublicResult(user.uid, publicResultEvent);
        console.error(error);
        if (sourceState.uid === user.uid) {
          showToast("対戦結果は確定しました。公開ランキングの同期だけ完了しませんでした。");
        }
      });
    } else {
      try {
        await publicSync;
        clearPendingSoloPublicResult(user.uid, resultToken);
      } catch (error) {
        if (mode === "solo") queuePendingSoloPublicResult(user.uid, publicResultEvent);
        throw error;
      }
    }
  }
  return {
    ...profile,
    resultToken,
    profileProjectionMode: serverProjection ? "server-v2" : "",
    profileProjectionPending: projectionPending,
    soloProfile: serverProjection ? periodResult?.soloProfile || null : null,
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

const soloSessionChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("hariai-stadium-solo-session-v2")
  : null;

soloSessionChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== "probe"
      || message.sessionId !== state.clientSessionId
      || message.leaseToken === state.clientLeaseToken
      || !state.soloSessionLeaseHeld) return;
  soloSessionChannel.postMessage({
    type: "probe-response",
    probeId: message.probeId,
    sessionId: state.clientSessionId,
    leaseToken: state.clientLeaseToken,
  });
});

function soloQueueEntryPath(uid, sessionId) {
  return `online/queueV2/${uid}/${sessionId}`;
}

function soloOfferPath(targetUid, targetSessionId, roomId = "") {
  const base = `online/offersV2/${targetUid}/${targetSessionId}`;
  return roomId ? `${base}/${roomId}` : base;
}

function soloRoomSignalPath(roomId, targetUid, targetSessionId) {
  return `online/rooms/${roomId}/signalsV2/${targetUid}/${targetSessionId}`;
}

function soloRoomPresencePath(roomId, uid, sessionId) {
  return `online/rooms/${roomId}/presenceV2/${uid}/${sessionId}`;
}

async function legacySoloActiveRoomIsLive(uid) {
  const activeSnapshot = await get(ref(database, `online/active/${uid}`));
  if (!activeSnapshot.exists()) return false;
  const activeValue = activeSnapshot.val();
  const roomId = String(
    typeof activeValue === "string" ? activeValue : activeValue?.roomId || "",
  );
  if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) return false;
  const roomSnapshot = await get(ref(database, `online/rooms/${roomId}`));
  const room = roomSnapshot.val();
  if (!room || room.members?.[uid] !== true || room.destroyed) return false;
  if (room.status === "offered") {
    return Number(room.createdAt || 0) >= serverNow() - 60_000;
  }
  return room.status === "active" && room.presence?.[uid]?.online !== false;
}

async function confirmSameSessionOwnerGone(expectedState) {
  if (!soloSessionChannel) return false;
  const probeId = createOnlineSessionToken(window.crypto);
  let ownerResponded = false;
  const listener = (event) => {
    const message = event.data;
    if (message?.type === "probe-response"
        && message.probeId === probeId
        && message.sessionId === expectedState.clientSessionId
        && message.leaseToken !== expectedState.clientLeaseToken) {
      ownerResponded = true;
    }
  };
  soloSessionChannel.addEventListener("message", listener);
  soloSessionChannel.postMessage({
    type: "probe",
    probeId,
    sessionId: expectedState.clientSessionId,
    leaseToken: expectedState.clientLeaseToken,
  });
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  soloSessionChannel.removeEventListener("message", listener);
  return !ownerResponded;
}

async function releaseSoloSessionClaimExact({
  sessionId,
  leaseToken,
  generation,
} = {}) {
  if (!isValidOnlineSessionId(sessionId)
      || !/^[a-f0-9]{32}$/.test(String(leaseToken || ""))
      || !/^[A-Za-z0-9_-]{22}$/.test(String(generation || ""))) return false;
  try {
    const response = await soloSessionActionCallable({
      action: "release",
      sessionId,
      leaseToken,
      generation,
    });
    return response?.data?.released === true;
  } catch {
    return false;
  }
}

async function claimSoloSessionLease(
  expectedState = state,
  expectedMatchmakingGeneration = expectedState.matchmakingGeneration,
) {
  const sessionId = expectedState.clientSessionId;
  const leaseToken = expectedState.clientLeaseToken;
  const contextIsCurrent = () => (
    state === expectedState
    && isCurrentMatchmakingGeneration(expectedMatchmakingGeneration)
  );
  if (!expectedState.uid || !contextIsCurrent()) return false;
  const request = (sameSessionOwnerConfirmedGone = false) => (
    soloSessionActionCallable({
      action: "claim",
      sessionId,
      leaseToken,
      sameSessionOwnerConfirmedGone,
      profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION,
    })
  );
  const requestWithLegacyQueueWait = async (sameSessionOwnerConfirmedGone = false) => {
    const retryDeadline = p2pMonotonicNow() + 50_000;
    let notified = false;
    while (true) {
      if (!contextIsCurrent()) return null;
      const result = await request(sameSessionOwnerConfirmedGone);
      if (result?.data?.claimed !== false
          || result.data.reason !== "legacy-waiting"
          || !contextIsCurrent()
          || document.visibilityState !== "visible"
          || !navigator.onLine
          || p2pMonotonicNow() + 5_000 > retryDeadline) {
        return result;
      }
      if (!notified) {
        showToast("前の接続が終了するのを確認しています。少しお待ちください。");
        notified = true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
    }
  };
  const abandonStaleResponse = async (candidateResponse) => {
    if (contextIsCurrent()) return false;
    const staleGeneration = String(candidateResponse?.data?.sessionGeneration || "");
    const newerAttemptMayAdopt = active
      && state.clientSessionId === sessionId
      && state.clientLeaseToken === leaseToken
      && !state.cleanupPromise
      && !state.p2pAutoRequeueCancelling
      && (
        state.soloSessionLeaseHeld
        || (state.screen === "matching"
          && state.matchmakingGeneration !== expectedMatchmakingGeneration)
      );
    if (candidateResponse?.data?.claimed === true && !newerAttemptMayAdopt) {
      await releaseSoloSessionClaimExact({
        sessionId,
        leaseToken,
        generation: staleGeneration,
      });
    }
    return true;
  };
  let response;
  try {
    response = await requestWithLegacyQueueWait(false);
  } catch (error) {
    if (!contextIsCurrent()) return false;
    const reason = String(error?.details?.reason || "");
    if (reason !== "same-session-owned-by-another-page"
        || !await confirmSameSessionOwnerGone(expectedState)) {
      if (reason === "occupied" || await legacySoloActiveRoomIsLive(expectedState.uid)) {
        showToast("別のタブまたは端末で通常版1on1の対戦中です。");
      } else {
        showToast("通常版1on1は別のタブまたは端末で使用中です。そちらを閉じてからお試しください。");
      }
      return false;
    }
    response = await requestWithLegacyQueueWait(true);
  }
  if (await abandonStaleResponse(response)) return false;
  if (response?.data?.claimed === false) {
    const reason = String(response.data.reason || "");
    if (reason === "same-session-owned"
        && await confirmSameSessionOwnerGone(expectedState)) {
      response = await requestWithLegacyQueueWait(true);
    } else {
      showToast(reason === "legacy-waiting"
        ? "前の通常版1on1の待機が残っています。別のタブを閉じ、少し待ってからお試しください。"
        : reason === "client-upgrade-required"
          ? "通常型1on1が更新されました。ページを再読み込みしてからお試しください。"
        : reason === "occupied"
          ? "別のタブまたは端末で通常版1on1の対戦中です。"
          : "通常版1on1は別のタブまたは端末で使用中です。そちらを閉じてからお試しください。");
      return false;
    }
  }
  if (await abandonStaleResponse(response)) return false;
  if (response?.data?.claimed === false) {
    const reason = String(response.data.reason || "");
    showToast(reason === "legacy-waiting"
      ? "前の通常版1on1の待機が残っています。別のタブを閉じ、少し待ってからお試しください。"
      : reason === "client-upgrade-required"
        ? "通常型1on1が更新されました。ページを再読み込みしてからお試しください。"
      : "通常版1on1は別のタブまたは端末で使用中です。そちらを閉じてからお試しください。");
    return false;
  }
  const lease = response?.data?.lease;
  const sessionGeneration = String(response?.data?.sessionGeneration || "");
  if (!isOnlineSessionLeaseOwner(lease, {
    sessionId,
    leaseToken,
  }) || !/^[A-Za-z0-9_-]{22}$/.test(sessionGeneration)) {
    showToast("通常版1on1のセッションを確認できませんでした。もう一度お試しください。");
    return false;
  }
  if (!contextIsCurrent()) {
    await releaseSoloSessionClaimExact({
      sessionId,
      leaseToken,
      generation: sessionGeneration,
    });
    return false;
  }
  expectedState.soloSessionLeaseHeld = true;
  expectedState.soloSessionLease = lease;
  expectedState.soloSessionGeneration = sessionGeneration;
  expectedState.soloSessionReleasePromise = null;
  expectedState.soloSessionReleaseStarted = false;
  expectedState.soloSessionCancelPromise = null;
  expectedState.soloSessionCancelRoomId = "";
  expectedState.soloSessionCancelResult = null;
  scheduleSoloSessionLeaseHeartbeat(expectedState);
  return true;
}

function clearSoloSessionHeartbeat(expectedState = state) {
  window.clearTimeout(expectedState.soloSessionHeartbeat);
  expectedState.soloSessionHeartbeat = null;
}

function markSoloSessionLeaseLost(expectedState = state) {
  if (!expectedState.soloSessionLeaseHeld) return;
  expectedState.soloSessionLeaseHeld = false;
  clearSoloSessionHeartbeat(expectedState);
  handleSoloSessionLeaseLost(expectedState).catch(handleRecoverableError);
}

function scheduleSoloSessionLeaseHeartbeat(
  expectedState = state,
  delayMs = ONLINE_SESSION_LEASE_DEFAULTS.heartbeatIntervalMs,
) {
  clearSoloSessionHeartbeat(expectedState);
  if (!active || state !== expectedState || !expectedState.soloSessionLeaseHeld) return false;
  const remainingMs = Number(expectedState.soloSessionLease?.expiresAt || 0) - serverNow();
  if (remainingMs <= 0) {
    markSoloSessionLeaseLost(expectedState);
    return false;
  }
  const requestedDelay = Number.isFinite(Number(delayMs))
    ? Math.max(1, Math.floor(Number(delayMs)))
    : ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs;
  const boundedDelay = Math.max(1, Math.min(requestedDelay, remainingMs));
  const timer = window.setTimeout(() => {
    if (expectedState.soloSessionHeartbeat !== timer) return;
    expectedState.soloSessionHeartbeat = null;
    refreshSoloSessionLease(expectedState).catch(handleRecoverableError);
  }, boundedDelay);
  expectedState.soloSessionHeartbeat = timer;
  return true;
}

async function refreshSoloSessionLease(expectedState = state) {
  if (!active
      || state !== expectedState
      || !expectedState.soloSessionLeaseHeld
      || expectedState.soloSessionHeartbeatInFlight) return false;
  if (Number(expectedState.soloSessionLease?.expiresAt || 0) <= serverNow()) {
    markSoloSessionLeaseLost(expectedState);
    return false;
  }
  expectedState.soloSessionHeartbeatInFlight = true;
  let responseData = null;
  try {
    try {
      const response = await soloSessionActionCallable({
        action: "heartbeat",
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        generation: expectedState.soloSessionGeneration,
      });
      responseData = response?.data || null;
    } catch {
      responseData = null;
    }
    if (state !== expectedState || !expectedState.soloSessionLeaseHeld) return false;
    const decision = decideOnlineSessionHeartbeatResult({
      responseData,
      currentLease: expectedState.soloSessionLease,
      sessionId: expectedState.clientSessionId,
      leaseToken: expectedState.clientLeaseToken,
      sessionGeneration: expectedState.soloSessionGeneration,
      now: serverNow(),
      retryIntervalMs: ONLINE_SESSION_LEASE_DEFAULTS.retryIntervalMs,
    });
    if (decision.action === "lost") {
      markSoloSessionLeaseLost(expectedState);
      return false;
    }
    if (decision.action === "retry") {
      scheduleSoloSessionLeaseHeartbeat(expectedState, decision.retryDelayMs);
      return false;
    }
    expectedState.soloSessionLease = decision.lease;
    const heartbeat = {
      lastSeen: serverNow(),
      expiresAt: decision.lease.expiresAt,
    };
    const heartbeatWrites = [
      update(ref(database, soloQueueEntryPath(
        expectedState.uid,
        expectedState.clientSessionId,
      )), heartbeat),
    ];
    if (expectedState.roomId && expectedState.soloSessionGeneration) {
      heartbeatWrites.push(update(ref(database, soloRoomPresencePath(
        expectedState.roomId,
        expectedState.uid,
        expectedState.clientSessionId,
      )), {
        online: true,
        updatedAt: serverTimestamp(),
      }));
    }
    await Promise.allSettled(heartbeatWrites);
    scheduleSoloSessionLeaseHeartbeat(expectedState);
    return true;
  } finally {
    expectedState.soloSessionHeartbeatInFlight = false;
  }
}

async function handleSoloSessionLeaseLost(expectedState = state) {
  if (!active || state !== expectedState) return;
  if (!expectedState.roomId) {
    if (["matching", "connecting"].includes(expectedState.screen)) {
      showToast("別のタブまたは端末に通常版1on1の接続が移ったため、この画面の検索を終了します。");
      await cancelMatching();
    }
    return;
  }
  if (expectedState.roomTerminationToken) return;
  const roomId = expectedState.roomId;
  if (await preserveResolvedMatchBeforeP2pCleanup(expectedState)) {
    preserveResolvedFinishFromP2pRecovery(expectedState, { notify: true });
    return;
  }
  await runTransaction(
    ref(database, `online/rooms/${roomId}/destroyed`),
    (current) => current || { by: expectedState.uid, at: Date.now() },
  ).catch(() => {});
  if (await preserveResolvedMatchBeforeP2pCleanup(expectedState)) {
    preserveResolvedFinishFromP2pRecovery(expectedState, { notify: true });
    return;
  }
  const terminationToken = Object.freeze({ type: "session-lease-lost" });
  expectedState.roomTerminationToken = terminationToken;
  await cleanupOnlineResources(false, expectedState);
  if (state !== expectedState
      || expectedState.roomTerminationToken !== terminationToken
      || expectedState.roomId !== roomId) return;
  releaseMatchMedia();
  expectedState.screen = "noContest";
  setOnlineChrome("NO CONTEST");
  render();
  showToast("別のタブまたは端末に通常版1on1の接続が移ったため、この対戦を終了しました。");
}

async function releaseSoloSessionLease(expectedState = state) {
  if (expectedState.soloSessionReleasePromise) {
    return expectedState.soloSessionReleasePromise;
  }
  if (expectedState.soloSessionReleaseStarted) return false;
  const hadLease = Boolean(expectedState.soloSessionLease);
  if (!hadLease || !expectedState.uid || !expectedState.clientSessionId) return false;
  expectedState.soloSessionReleaseStarted = true;
  clearSoloSessionHeartbeat(expectedState);
  expectedState.soloSessionLeaseHeld = false;
  const releasePromise = (async () => {
    let released = false;
    try {
      const response = await soloSessionActionCallable({
        action: "release",
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        generation: expectedState.soloSessionGeneration,
      });
      released = response?.data?.released === true;
    } catch {
      released = false;
    } finally {
      expectedState.soloSessionLease = null;
      expectedState.soloSessionGeneration = 0;
      expectedState.soloSessionFence = null;
    }
    return released;
  })();
  expectedState.soloSessionReleasePromise = releasePromise;
  return releasePromise;
}

function isCurrentMatchmakingGeneration(generation) {
  return active
    && state.screen === "matching"
    && state.matchmakingGeneration === generation
    && !state.roomId
    && (state.p2pAutoRequeueStartedAt <= 0
      || (document.visibilityState === "visible" && navigator.onLine));
}

async function cancelSoloSessionRoomOnce(roomId, expectedState = state) {
  const normalizedRoomId = String(roomId || "");
  if (!normalizedRoomId || !expectedState.uid || !expectedState.clientSessionId) return null;
  if (expectedState.soloSessionCancelRoomId === normalizedRoomId) {
    if (expectedState.soloSessionCancelPromise) {
      return expectedState.soloSessionCancelPromise;
    }
    return expectedState.soloSessionCancelResult;
  }
  expectedState.soloSessionCancelRoomId = normalizedRoomId;
  expectedState.soloSessionCancelResult = null;
  const cancelPromise = (async () => {
    try {
      const response = await soloSessionActionCallable({
        action: "cancel",
        sessionId: expectedState.clientSessionId,
        leaseToken: expectedState.clientLeaseToken,
        roomId: normalizedRoomId,
      });
      expectedState.soloSessionCancelResult = response?.data || null;
    } catch {
      expectedState.soloSessionCancelResult = null;
    }
    return expectedState.soloSessionCancelResult;
  })();
  expectedState.soloSessionCancelPromise = cancelPromise;
  try {
    return await cancelPromise;
  } finally {
    if (expectedState.soloSessionCancelPromise === cancelPromise) {
      expectedState.soloSessionCancelPromise = null;
    }
  }
}

async function releaseActiveReservation(roomId, expectedState = state) {
  const result = await cancelSoloSessionRoomOnce(roomId, expectedState);
  return result?.cancelled === true
    || ["active", "destroyed", "expired"].includes(String(result?.status || ""));
}

async function armActiveReservationDisconnect(
  roomId,
  expectedState = state,
  contextIsCurrent = () => state === expectedState,
) {
  return Boolean(
    roomId
      && expectedState.uid
      && expectedState.soloSessionLeaseHeld
      && state === expectedState
      && contextIsCurrent(),
  );
}

async function beginMatchmaking({ automatic = false } = {}) {
  const expectedState = state;
  expectedState.name = expectedState.name.trim().slice(0, 16);
  expectedState.imagePreference = normalizeImagePreference(expectedState.imagePreference, "");
  if (!expectedState.uid
      || expectedState.deck.length !== MAX_ROUNDS
      || !expectedState.name
      || !expectedState.imagePreference) return;
  if (automatic && (
    document.visibilityState !== "visible"
    || !navigator.onLine
  )) return;
  if (automatic) {
    expectedState.p2pAutoRequeueStartedAt = Date.now();
  } else {
    expectedState.p2pAutoRequeueCount = 0;
    expectedState.p2pOpponentCooldown = null;
    expectedState.p2pAutoRequeueStartedAt = 0;
  }
  expectedState.p2pAutoRequeueCancelling = false;
  const sampleCount = getDeckSampleCount();
  const startingHp = getStartingHp(sampleCount);
  const generation = ++matchmakingGenerationCounter;
  expectedState.matchmakingGeneration = generation;
  try {
    expectedState.matchScopeAvailable = false;
    expectedState.matchScopeExpanded = false;
    expectedState.pursuitLine = expectedState.pursuitLineChoice === CUSTOM_PURSUIT_VALUE
      ? normalizePursuitLine(expectedState.customPursuitLine)
      : normalizePursuitLine(expectedState.pursuitLineChoice);
    expectedState.finishLine = expectedState.finishLineChoice === FINISH_LINE_DISABLED_VALUE
      ? ""
      : expectedState.finishLineChoice === CUSTOM_FINISH_VALUE
        ? normalizeFinishLine(expectedState.customFinishLine)
        : normalizeFinishLine(expectedState.finishLineChoice);
    expectedState.finishReplyLine = expectedState.finishReplyChoice === FINISH_REPLY_DISABLED_VALUE
      ? ""
      : expectedState.finishReplyChoice === CUSTOM_FINISH_REPLY_VALUE
        ? normalizeFinishReplyLine(expectedState.customFinishReplyLine, "")
        : normalizeFinishReplyLine(expectedState.finishReplyChoice);
    localStorage.setItem(PROFILE_NAME_KEY, expectedState.name);
    persistRoleplayLineSettings(expectedState);
    localStorage.setItem(IMAGE_PREFERENCE_KEY, expectedState.imagePreference);
    expectedState.screen = "matching";
    setOnlineChrome("MATCHING");
    render();

    const projectionReady = await reconcileSoloProfileBeforeMatchmaking(
      expectedState,
      generation,
    );
    if (!projectionReady || !isCurrentMatchmakingGeneration(generation)) return;
    if (expectedState.leaderboardPublic) {
      syncLeaderboardEntry().catch(() => showToast("ランキング情報を更新できませんでした。"));
    }
    if (!await claimSoloSessionLease(expectedState, generation)) {
      if (isCurrentMatchmakingGeneration(generation)) {
        expectedState.screen = "setup";
        setOnlineChrome("ONLINE READY");
        render();
      }
      return;
    }
    if (!isCurrentMatchmakingGeneration(generation)) return;
    await refreshSoloFamiliarBook({ renderAfter: true });
    if (!isCurrentMatchmakingGeneration(generation)) return;
    expectedState.soloSessionFence = createOnlineSessionFence({
      sessionId: expectedState.clientSessionId,
      leaseToken: expectedState.clientLeaseToken,
      connectionGeneration: generation,
    });
    const ownOffersRef = ref(database, soloOfferPath(
      expectedState.uid,
      expectedState.clientSessionId,
    ));
    const queueEntryRef = ref(database, soloQueueEntryPath(
      expectedState.uid,
      expectedState.clientSessionId,
    ));
    const joinedAt = serverNow();
    await set(queueEntryRef, {
      protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
      profileProjectionVersion: SOLO_STATS_PROJECTION_VERSION,
      uid: expectedState.uid,
      sessionId: expectedState.clientSessionId,
      leaseToken: expectedState.clientLeaseToken,
      generation: expectedState.soloSessionGeneration,
      connectionGeneration: generation,
      name: expectedState.name,
      pursuitLine: expectedState.pursuitLine,
      streak: Number(expectedState.profile.streak || 0),
      rating: Number(expectedState.profile.rating || INITIAL_RATING),
      ratingPreference: expectedState.imagePreference,
      allowPreferenceMismatch: false,
      reunionPreference: soloServerMatchmakingEnabled() && expectedState.soloReunionPreference,
      sampleCount,
      startingHp,
      joinedAt,
      lastSeen: joinedAt,
      expiresAt: expectedState.soloSessionLease.expiresAt,
      state: "waiting",
    });
    if (!isCurrentMatchmakingGeneration(generation)) return;
    const presenceStarted = await startPublicPresence(generation);
    if (!presenceStarted || !isCurrentMatchmakingGeneration(generation)) return;
    if (expectedState.imagePreference !== "both") {
      expectedState.matchScopeTimer = window.setTimeout(() => {
        if (!isCurrentMatchmakingGeneration(generation) || expectedState.matchScopeExpanded) return;
        expectedState.matchScopeAvailable = true;
        render();
      }, MATCH_SCOPE_EXPAND_DELAY_MS);
    }
    expectedState.queueHeartbeat = window.setInterval(() => {
      update(queueEntryRef, { lastSeen: serverNow() })
        .then(() => attemptCurrentSoloMatchmaking(generation))
        .catch(() => {});
    }, 20_000);
    startSoloServerMatchPolling(generation);

    expectedState.matchUnsubscribers.push(
      onValue(ownOffersRef, processIncomingOffers, handleRecoverableError),
    );
    expectedState.offerPollTimer = window.setInterval(() => {
      if (!isCurrentMatchmakingGeneration(generation)) return;
      get(ownOffersRef).then(processIncomingOffers).catch(handleRecoverableError);
    }, 1_500);
  } catch (error) {
    if (state !== expectedState
        || expectedState.matchmakingGeneration !== generation
        || expectedState.roomId) return;
    const transitionToken = beginOnlineStateTransition(
      expectedState,
      "matchmaking-initialization-failed",
    );
    await cleanupOnlineResources(false, expectedState);
    if (!isOnlineStateTransitionCurrent(expectedState, transitionToken, state)) return;
    expectedState.p2pAutoRequeueStartedAt = 0;
    expectedState.p2pAutoRequeueCancelling = false;
    expectedState.screen = "setup";
    setOnlineChrome("ONLINE READY");
    render();
    console.error(error);
    showToast(error?.soloProfileProjectionPending
      ? error.message
      : "対戦の検索を開始できませんでした。通信環境を確認して、もう一度お試しください。");
  }
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
  const lastSeen = serverNow();
  try {
    await set(presenceRef, { mode, state: presenceState, lastSeen });
  } catch (error) {
    const detail = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (!detail.includes("permission_denied") && !detail.includes("permission-denied")) throw error;
    await set(presenceRef, { state: presenceState, lastSeen });
  }
}

async function cleanupPublicPresence(targetState = state) {
  window.clearInterval(targetState.publicPresenceHeartbeat);
  targetState.publicPresenceHeartbeat = null;
  const presenceDisconnect = targetState.publicPresenceDisconnect;
  const presenceId = targetState.publicPresenceId;
  const ownUid = targetState.uid;
  targetState.publicPresenceDisconnect = null;
  targetState.publicPresenceId = "";
  targetState.publicPresenceState = "";
  await presenceDisconnect?.cancel?.().catch(() => {});
  if (!presenceId || !ownUid) return;
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
  const lastSeen = serverNow();
  try {
    await update(ref(database, soloQueueEntryPath(
      state.uid,
      state.clientSessionId,
    )), {
      allowPreferenceMismatch: true,
      lastSeen,
    });
    await attemptCurrentSoloMatchmaking(state.matchmakingGeneration);
  } catch (error) {
    state.matchScopeExpanded = false;
    state.matchScopeAvailable = true;
    if (state.screen === "matching") render();
    showToast("検索範囲を広げられませんでした。通信状態を確認してください。");
  }
}

function normalizeSoloPermitCandidate(value) {
  const uid = String(value?.uid || "").trim().slice(0, 128);
  const name = String(value?.name || "").trim().slice(0, 16);
  const sessionId = String(value?.sessionId || "");
  const generation = value?.sessionGeneration;
  if (!uid || uid === state.uid || !name
      || !isValidOnlineSessionId(sessionId)
      || typeof generation !== "string"
      || !/^[A-Za-z0-9_-]{22}$/.test(generation)) return null;
  const sampleCount = normalizeSampleCount(value?.sampleCount);
  return {
    uid,
    sessionId,
    generation,
    name,
    pursuitLine: normalizePursuitLine(value?.pursuitLine),
    streak: Math.max(0, Math.floor(Number(value?.streak || 0))),
    rating: Math.min(3000, Math.max(100, Math.floor(Number(value?.rating || INITIAL_RATING)))),
    sampleCount,
    startingHp: getStartingHp(sampleCount),
  };
}

function startSoloServerMatchPolling(generation = state.matchmakingGeneration) {
  if (!isCurrentMatchmakingGeneration(generation)
      || state.soloServerMatchTimer) return;
  state.soloServerMatchTimer = window.setInterval(() => {
    attemptSoloServerMatch(generation);
  }, SOLO_SERVER_MATCH_POLL_MS);
}

function attemptCurrentSoloMatchmaking(generation = state.matchmakingGeneration) {
  return attemptSoloServerMatch(generation);
}

async function attemptSoloServerMatch(generation = state.matchmakingGeneration) {
  if (!isCurrentMatchmakingGeneration(generation)
      || state.soloServerMatchBusy
      || state.matchingBusy
      || state.acceptingOffer
      || state.pendingIncomingOffer
      || state.pendingOffer) return;
  const expectedState = state;
  state.soloServerMatchBusy = true;
  try {
    const cooldown = state.p2pOpponentCooldown;
    const response = await soloSessionActionCallable({
      action: "try_match",
      sessionId: state.clientSessionId,
      leaseToken: state.clientLeaseToken,
      ...(cooldown && isOnlineP2pOpponentCoolingDown(
        cooldown,
        cooldown.opponentUid,
        Date.now(),
      ) ? { avoidUid: cooldown.opponentUid } : {}),
    });
    if (!isCurrentMatchmakingGeneration(generation) || state !== expectedState) return;
    const result = response.data || {};
    state.soloServerMatchErrorNotified = false;
    if (result.outcome === "join") {
      const roomId = String(result.roomId || "");
      if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId)) {
        throw new Error("サーバーの通常型1on1ルーム情報が不正です。");
      }
      await enterRoom(roomId);
      return;
    }
    if (result.outcome !== "hosted") return;
    const roomId = String(result.roomId || "");
    const candidate = normalizeSoloPermitCandidate(result.candidate);
    if (!/^[-0-9A-Z_a-z]{20}$/.test(roomId) || !candidate) {
      throw new Error("サーバーの通常型1on1許可情報が不正です。");
    }
    if (state.matchingBusy || state.acceptingOffer || state.pendingIncomingOffer || state.pendingOffer) return;
    await adoptSoloServerHostedMatch(candidate, {
      roomId,
      reunion: result.reunion === true,
    });
  } catch (error) {
    console.error(error);
    if (isCurrentMatchmakingGeneration(generation)
        && state === expectedState
        && !state.soloServerMatchErrorNotified) {
      state.soloServerMatchErrorNotified = true;
      showToast("対戦相手の確認に時間がかかっています。自動で再試行します。");
    }
  } finally {
    if (state === expectedState && state.matchmakingGeneration === generation) {
      state.soloServerMatchBusy = false;
    }
  }
}

async function restoreHostedOfferToWaiting(roomId, targetUid, expectedState = state) {
  void targetUid;
  await soloSessionActionCallable({
    action: "expire",
    sessionId: expectedState.clientSessionId,
    leaseToken: expectedState.clientLeaseToken,
    roomId,
  });
}

async function finishHostedOfferAsTerminal(
  roomId,
  targetUid,
  expectedState = state,
  generation = state.matchmakingGeneration,
) {
  if (state !== expectedState
      || !isCurrentMatchmakingGeneration(generation)
      || state.roomId
      || state.pendingOffer?.roomId !== roomId) return false;
  const pendingOffer = state.pendingOffer;
  if (pendingOffer.terminalCleanupRunning) return false;
  pendingOffer.terminalCleanupRunning = true;
  try {
    await restoreHostedOfferToWaiting(roomId, targetUid, expectedState);
  } catch (error) {
    if (state === expectedState && state.pendingOffer === pendingOffer && !state.roomId) {
      pendingOffer.terminalCleanupRunning = false;
    }
    throw error;
  }
  if (state !== expectedState
      || !isCurrentMatchmakingGeneration(generation)
      || state.roomId
      || state.pendingOffer !== pendingOffer) return false;
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.hostStatusPollTimer);
  state.matchTimer = null;
  state.hostStatusPollTimer = null;
  state.pendingOffer = null;
  attemptCurrentSoloMatchmaking(generation).catch(handleRecoverableError);
  return true;
}

function registerHostedOfferMonitor({
  roomId,
  candidate,
  reunion,
  expectedState,
  generation,
}) {
  const roomStatusRef = ref(database, `online/rooms/${roomId}/status`);
  const contextIsCurrent = () => state === expectedState && isCurrentMatchmakingGeneration(generation);
  state.pendingOffer = {
    roomId,
    targetUid: candidate.uid,
    targetSessionId: candidate.sessionId,
    reunion,
  };
  const handleHostedRoomStatus = async (snapshot) => {
    if (!contextIsCurrent() || state.pendingOffer?.roomId !== roomId || state.roomId) return;
    const status = snapshot.val();
    if (status === "active") {
      const pendingOffer = state.pendingOffer;
      if (pendingOffer.enteringRoom) return;
      pendingOffer.enteringRoom = true;
      if (!contextIsCurrent() || state.pendingOffer !== pendingOffer || state.roomId) return;
      try {
        await enterRoom(roomId);
      } catch (error) {
        if (contextIsCurrent() && state.pendingOffer === pendingOffer && !state.roomId) {
          pendingOffer.enteringRoom = false;
        }
        throw error;
      }
      return;
    }
    if (status === "offered") return;
    await finishHostedOfferAsTerminal(roomId, candidate.uid, expectedState, generation);
  };
  const unsubscribe = onValue(roomStatusRef, (snapshot) => {
    handleHostedRoomStatus(snapshot).catch(handleRecoverableError);
  }, handleRecoverableError);
  state.matchUnsubscribers.push(unsubscribe);
  state.hostStatusPollTimer = window.setInterval(() => {
    if (!contextIsCurrent() || state.roomId || state.pendingOffer?.roomId !== roomId) return;
    get(roomStatusRef).then(handleHostedRoomStatus).catch(handleRecoverableError);
  }, 1_500);
  state.matchTimer = window.setTimeout(() => {
    expireOffer(roomId, candidate.uid).catch(handleRecoverableError);
  }, MATCH_TIMEOUT_MS);
}

async function adoptSoloServerHostedMatch(candidate, hosted) {
  const expectedState = state;
  const generation = state.matchmakingGeneration;
  const roomId = String(hosted?.roomId || "");
  const contextIsCurrent = () => (
    state === expectedState && isCurrentMatchmakingGeneration(generation)
  );
  if (!isCurrentMatchmakingGeneration(generation)
      || !/^[-0-9A-Z_a-z]{20}$/.test(roomId)) return;
  state.matchingBusy = true;
  try {
    const disconnectArmed = await armActiveReservationDisconnect(
      roomId,
      expectedState,
      contextIsCurrent,
    );
    if (!disconnectArmed) {
      await releaseActiveReservation(roomId, expectedState).catch(handleRecoverableError);
      return;
    }
    const roomSnapshot = await get(ref(database, `online/rooms/${roomId}`));
    if (!contextIsCurrent()) {
      await releaseActiveReservation(roomId, expectedState).catch(handleRecoverableError);
      return;
    }
    const room = roomSnapshot.val();
    if (!room
        || room.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION
        || room.signalingVersion !== ONLINE_SESSION_PROTOCOL_VERSION
        || room.hostUid !== state.uid
        || room.guestUid !== candidate.uid
        || !["offered", "active"].includes(room.status)
        || room.members?.[state.uid] !== true
        || room.members?.[candidate.uid] !== true
        || room.sessions?.[state.uid]?.sessionId !== state.clientSessionId
        || room.sessions?.[state.uid]?.generation !== state.soloSessionGeneration
        || room.sessions?.[candidate.uid]?.sessionId !== candidate.sessionId
        || room.sessions?.[candidate.uid]?.generation !== candidate.generation
        || (room.reunion === true) !== (hosted?.reunion === true)) {
      throw new Error("サーバーが準備した通常型1on1ルームを確認できませんでした。");
    }
    registerHostedOfferMonitor({
      roomId,
      candidate,
      reunion: hosted?.reunion === true,
      expectedState,
      generation,
    });
  } catch (error) {
    await releaseActiveReservation(roomId, expectedState).catch(handleRecoverableError);
    throw error;
  } finally {
    if (state === expectedState && state.matchmakingGeneration === generation) {
      state.matchingBusy = false;
    }
  }
}

async function expireOffer(roomId, targetUid) {
  if (state.roomId || state.pendingOffer?.roomId !== roomId) return;
  const expectedState = state;
  const generation = state.matchmakingGeneration;
  const response = await soloSessionActionCallable({
    action: "expire",
    sessionId: expectedState.clientSessionId,
    leaseToken: expectedState.clientLeaseToken,
    roomId,
  });
  const status = String(response.data?.status || "");
  if (status === "active" || status === "offered") return;
  await finishHostedOfferAsTerminal(roomId, targetUid, expectedState, generation);
}

async function acceptOffer(roomId, offer) {
  if (!active || state.screen !== "matching" || state.roomId) return;
  if (!offer
      || offer.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION
      || offer.toUid !== state.uid
      || offer.toSessionId !== state.clientSessionId
      || offer.sessions?.[state.uid]?.generation !== state.soloSessionGeneration) return;
  const expectedState = state;
  const generation = state.matchmakingGeneration;
  const contextIsCurrent = () => state === expectedState && isCurrentMatchmakingGeneration(generation);
  state.acceptingOffer = true;
  try {
    const response = await soloSessionActionCallable({
      action: "accept",
      sessionId: state.clientSessionId,
      leaseToken: state.clientLeaseToken,
      roomId,
    });
    if (response.data?.accepted !== true) return;
    if (!contextIsCurrent()) {
      await releaseActiveReservation(roomId, expectedState).catch(() => {});
      return;
    }
    await enterRoom(roomId);
  } finally {
    if (state === expectedState && state.matchmakingGeneration === generation) {
      state.acceptingOffer = false;
    }
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
  const expectedState = state;
  const generation = state.matchmakingGeneration;
  const ownUid = state.uid;
  const matchmakingContextIsCurrent = () => (
    state === expectedState && isCurrentMatchmakingGeneration(generation)
  );
  const releaseReservation = () => releaseActiveReservation(roomId, expectedState);
  if (!isCurrentMatchmakingGeneration(generation)) return;
  let disconnectArmed = false;
  try {
    disconnectArmed = await armActiveReservationDisconnect(
      roomId,
      expectedState,
      matchmakingContextIsCurrent,
    );
  } catch (error) {
    await releaseReservation();
    throw error;
  }
  if (!disconnectArmed) {
    await releaseReservation();
    return;
  }
  let snapshot;
  try {
    snapshot = await get(ref(database, `online/rooms/${roomId}`));
  } catch (error) {
    if (state === expectedState && state.matchmakingGeneration === generation) {
      await releaseReservation();
    }
    throw error;
  }
  if (!matchmakingContextIsCurrent()) {
    await releaseReservation();
    return;
  }
  const room = snapshot.val();
  const roomPlayers = room ? [room.players?.[room.hostUid], room.players?.[room.guestUid]] : [];
  const opponentUid = room?.hostUid === ownUid ? room?.guestUid : room?.hostUid;
  if (!room
      || room.protocolVersion !== ONLINE_SESSION_PROTOCOL_VERSION
      || room.signalingVersion !== ONLINE_SESSION_PROTOCOL_VERSION
      || !/^[-_0-9A-Za-z]{8,128}$/.test(String(room.connectionGeneration || ""))
      || !/^[-_0-9A-Za-z]{8,128}$/.test(String(room.attemptId || ""))
      || !room.members?.[ownUid]
      || room.sessions?.[ownUid]?.sessionId !== state.clientSessionId
      || room.sessions?.[ownUid]?.generation !== state.soloSessionGeneration
      || !isValidOnlineSessionId(String(room.sessions?.[opponentUid]?.sessionId || ""))
      || roomPlayers.some((player) => !player?.uid)) {
    await releaseReservation();
    throw new Error("ルーム情報を取得できませんでした。");
  }
  window.clearTimeout(state.matchTimer);
  state.roomId = roomId;
  state.room = room;
  state.reunionMatch = room.reunion === true;
  state.opponentUid = opponentUid;
  state.opponentSessionId = room.sessions[opponentUid].sessionId;
  state.roomConnectionGeneration = room.connectionGeneration;
  state.signalingAttemptId = room.attemptId;
  state.playerIndex = room.hostUid === ownUid ? 0 : 1;
  state.players = roomPlayers.map((player) => {
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
  state.screen = "connecting";
  state.peerStatus = "P2P接続を準備中…";
  setOnlineChrome(state.reunionMatch ? "FAMILIAR REUNION" : "ONLINE BATTLE");
  render();
  const cleanupPromise = cleanupMatchmaking(true);
  const roomGeneration = state.matchmakingGeneration;
  await cleanupPromise;
  const roomContextIsCurrent = () => active
    && state === expectedState
    && state.matchmakingGeneration === roomGeneration
    && state.roomId === roomId
    && state.screen === "connecting";
  if (!roomContextIsCurrent()) {
    if (state === expectedState && state.roomId === roomId) state.roomId = "";
    await releaseReservation();
    return;
  }
  await updatePublicPresence("playing");
  if (!roomContextIsCurrent()) {
    if (state === expectedState && state.roomId === roomId) state.roomId = "";
    await releaseReservation();
    return;
  }
  if (state.reunionMatch) {
    soloFamiliarActionCallable({ action: "confirm_reunion", roomId })
      .catch((error) => console.error("再会確認を保存できませんでした。", error));
  }
  const roomSetupContext = captureOnlineRoomContext(expectedState, {
    generation: roomGeneration,
    roomId,
    ownUid,
    opponentUid: state.opponentUid,
  });
  let roomListenersReady = false;
  try {
    roomListenersReady = await setupRoomListeners(roomSetupContext);
  } catch (error) {
    await releaseReservation();
    throw error;
  }
  if (!roomListenersReady) {
    await releaseReservation();
    return;
  }
  if (!roomContextIsCurrent()) {
    await releaseReservation();
    return;
  }
  await setupPeerConnection(roomSetupContext);
}

function isCurrentRoomSetupContext(context) {
  return isOnlineRoomContextCurrent(context, { active, currentState: state });
}

function isSameRoomIdentity(context) {
  return isOnlineSameRoomIdentity(context, { active, currentState: state });
}

function isCurrentRoundContext(context) {
  return isOnlineRoundContextCurrent(context, { active, currentState: state });
}

async function setupRoomListeners(context) {
  if (!isCurrentRoomSetupContext(context)) return false;
  const disconnectArmed = await armActiveReservationDisconnect(
    context.roomId,
    context.expectedState,
    () => isCurrentRoomSetupContext(context),
  );
  if (!disconnectArmed) return false;
  const base = `online/rooms/${context.roomId}`;
  const presenceRef = ref(database, soloRoomPresencePath(
    context.roomId,
    context.ownUid,
    context.expectedState.clientSessionId,
  ));
  const presencePayload = (online) => ({
    protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
    sessionId: context.expectedState.clientSessionId,
    leaseToken: context.expectedState.clientLeaseToken,
    generation: context.expectedState.soloSessionGeneration,
    online,
    updatedAt: serverTimestamp(),
  });
  let presenceWritten = false;
  let presenceDisconnect = null;
  const abandonSetup = async () => {
    await Promise.allSettled([
      presenceDisconnect?.cancel?.(),
      presenceWritten
        ? set(presenceRef, presencePayload(false))
        : Promise.resolve(),
    ]);
  };
  try {
    await set(presenceRef, presencePayload(true));
    presenceWritten = true;
    if (!isCurrentRoomSetupContext(context)) {
      await abandonSetup();
      return false;
    }
    presenceDisconnect = onDisconnect(presenceRef);
    await presenceDisconnect.set(presencePayload(false));
    if (!isCurrentRoomSetupContext(context)) {
      await abandonSetup();
      return false;
    }
  } catch (error) {
    await abandonSetup();
    throw error;
  }
  state.disconnectHandles.push(presenceDisconnect);

  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    if (!isCurrentRoomSetupContext(context)) return;
    state.serverTimeOffset = Number(snapshot.val() || 0);
    if (state.selectionTimer) updateSelectionCountdown();
  }));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (!isCurrentRoomSetupContext(context)) return;
    if (snapshot.exists()) {
      handleOpponentDestroyed(context, snapshot.val()).catch(handleRecoverableError);
    }
  }));
  state.roomUnsubscribers.push(onValue(ref(database, soloRoomPresencePath(
    context.roomId,
    context.opponentUid,
    context.expectedState.opponentSessionId,
  )), (snapshot) => {
    if (!isCurrentRoomSetupContext(context)) return;
    state.opponentOnline = snapshot.val()?.online !== false;
    document.querySelectorAll(".online-room-strip .connection-pill")[1]?.classList.toggle("warning", !state.opponentOnline);
    if (!state.opponentOnline && state.screen === "engawa") {
      closeEngawaLocally("相手の接続が切れたため、縁側を閉じました。");
    } else if (state.screen === "gameover") {
      if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
        scheduleEngawaAfterPostMatchTip();
      } else {
        render();
      }
    }
  }));
  const chatQuery = query(ref(database, `${base}/chat`), limitToLast(50));
  state.roomUnsubscribers.push(onChildAdded(chatQuery, (snapshot) => {
    if (!isCurrentRoomSetupContext(context)) return;
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 50) state.chatMessages.shift();
    refreshChat();
  }));
  listenToRound(context);
  return true;
}

function listenToRound(roomContext) {
  if (!isCurrentRoomSetupContext(roomContext)) return;
  const targetState = roomContext.expectedState;
  const roundContext = captureOnlineRoundContext(roomContext, targetState.round);
  targetState.roundUnsubscribe?.();
  targetState.roundUnsubscribe = onValue(ref(
    database,
    `online/rooms/${roomContext.roomId}/rounds/${roundContext.expectedRound}`,
  ), (snapshot) => {
    if (!isCurrentRoundContext(roundContext)) return;
    const roundData = snapshot.val() || {};
    targetState.roundData = roundData;
    reactToRoundData(roundContext, roundData).catch((error) => {
      if (isCurrentRoundContext(roundContext)) handleRecoverableError(error);
    });
  });
}

function p2pDiagnosticPhase(screen) {
  if (screen === "matching") return "matchmaking";
  if (screen === "connecting") return "connecting";
  if (screen === "select") return "select";
  if (["play", "score", "roundResult"].includes(screen)) return "battle";
  if (["gameover", "engawa", "noContest"].includes(screen)) return "result";
  return "unknown";
}

function validCloudflareIceUrl(url) {
  return typeof url === "string" && (
    /^stun:stun\.cloudflare\.com:(?:3478|53)$/.test(url)
    || /^turn:turn\.cloudflare\.com:(?:3478|53)\?transport=udp$/.test(url)
    || /^turn:turn\.cloudflare\.com:(?:3478|53|80)\?transport=tcp$/.test(url)
    || /^turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp$/.test(url)
  );
}

function validateClientIceServers(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new Error("TURN構成が不正です。");
  }
  let hasTurn = false;
  const normalized = value.map((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    if (!urls.length || urls.length > 12 || urls.some((url) => !validCloudflareIceUrl(url))) {
      throw new Error("TURN接続先が不正です。");
    }
    const containsTurn = urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"));
    hasTurn ||= containsTurn;
    if (!containsTurn) return { urls };
    if (typeof server.username !== "string" || server.username.length < 8
        || typeof server.credential !== "string" || server.credential.length < 8) {
      throw new Error("TURN資格情報が不正です。");
    }
    return {
      urls,
      username: server.username,
      credential: server.credential,
    };
  });
  if (!hasTurn) throw new Error("TURN接続先がありません。");
  return normalized;
}

function p2pMonotonicNow() {
  const value = globalThis.performance?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}

function p2pTurnCacheWindow(value, {
  monotonicAt = p2pMonotonicNow(),
  wallClockAt = Date.now(),
} = {}) {
  const issuedAt = Number(value?.issuedAt || 0);
  const refreshAt = Number(value?.refreshAt || 0);
  const expiresAt = Number(value?.expiresAt || 0);
  const refreshAfterMs = refreshAt - issuedAt;
  const expiresAfterMs = expiresAt - issuedAt;
  const expirySafetyMs = 30_000;
  if (!Number.isFinite(monotonicAt)
      || !Number.isFinite(wallClockAt)
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(refreshAt)
      || !Number.isFinite(expiresAt)
      || issuedAt <= 0
      || refreshAfterMs <= 0
      || expiresAfterMs <= refreshAfterMs + expirySafetyMs
      || expiresAfterMs > 2 * 60 * 60 * 1000) {
    throw new Error("TURN有効期限が不正です。");
  }
  return {
    refreshDeadlineMonotonic: monotonicAt + refreshAfterMs,
    expiresDeadlineMonotonic: monotonicAt + expiresAfterMs - expirySafetyMs,
    refreshDeadlineWall: wallClockAt + refreshAfterMs,
    expiresDeadlineWall: wallClockAt + expiresAfterMs - expirySafetyMs,
  };
}

function p2pTurnCacheBeforeDeadline(cache, kind) {
  const monotonicDeadline = Number(cache?.[`${kind}DeadlineMonotonic`]);
  const wallDeadline = Number(cache?.[`${kind}DeadlineWall`]);
  return Number.isFinite(monotonicDeadline)
    && Number.isFinite(wallDeadline)
    && monotonicDeadline > p2pMonotonicNow()
    && wallDeadline > Date.now();
}

async function loadP2pIceServers() {
  if (cachedP2pIceServers
      && p2pTurnCacheBeforeDeadline(cachedP2pIceServers, "refresh")) {
    return {
      iceServers: cachedP2pIceServers.iceServers,
      turnAvailable: true,
    };
  }
  try {
    const response = await getP2pIceServersCallable({});
    const iceServers = validateClientIceServers(response.data?.iceServers);
    const cacheWindow = p2pTurnCacheWindow(response.data);
    cachedP2pIceServers = { iceServers, ...cacheWindow };
    return { iceServers, turnAvailable: true };
  } catch {
    if (cachedP2pIceServers
        && p2pTurnCacheBeforeDeadline(cachedP2pIceServers, "expires")) {
      return {
        iceServers: cachedP2pIceServers.iceServers,
        turnAvailable: true,
      };
    }
    cachedP2pIceServers = null;
    return {
      iceServers: FALLBACK_ICE_SERVERS.map((server) => ({ ...server })),
      turnAvailable: false,
    };
  }
}

async function selectedP2pCandidateSummary(peer) {
  if (!peer?.getStats) return {};
  try {
    const stats = await peer.getStats();
    let selectedPair = null;
    for (const report of stats.values()) {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        selectedPair = stats.get(report.selectedCandidatePairId);
        break;
      }
      if (report.type === "candidate-pair" && report.state === "succeeded"
          && (report.selected === true || report.nominated === true)) {
        selectedPair = report;
      }
    }
    const localCandidate = selectedPair?.localCandidateId
      ? stats.get(selectedPair.localCandidateId)
      : null;
    const candidateType = ["host", "srflx", "prflx", "relay"].includes(localCandidate?.candidateType)
      ? localCandidate.candidateType
      : "none";
    const rawTransport = String(localCandidate?.relayProtocol || localCandidate?.protocol || "none");
    const transport = ["udp", "tcp", "tls"].includes(rawTransport) ? rawTransport : "none";
    return { candidateType, transport };
  } catch {
    return { candidateType: "unknown", transport: "unknown" };
  }
}

async function reportP2pDiagnostic(event, targetState = state, peer = targetState.peer, extra = {}) {
  if (!targetState.roomId || !targetState.clientSessionId) return;
  const dedupeKey = `${event}:${targetState.p2pRecovery?.iceRestartCount || 0}`;
  if (targetState.p2pDiagnosticSent.has(dedupeKey)
      && !["ice_disconnected", "cleanup"].includes(event)) return;
  targetState.p2pDiagnosticSent.add(dedupeKey);
  const candidate = await selectedP2pCandidateSummary(peer);
  const elapsedMs = Math.min(
    10 * 60 * 1000,
    Math.max(0, Date.now() - Number(targetState.p2pStartedAt || Date.now())),
  );
  const diagnostic = {
    event,
    phase: event === "cleanup" ? "cleanup" : p2pDiagnosticPhase(targetState.screen),
    turnAvailable: targetState.p2pTurnAvailable === true,
    connectionState: String(peer?.connectionState || "unknown"),
    iceConnectionState: String(peer?.iceConnectionState || "unknown"),
    iceGatheringState: String(peer?.iceGatheringState || "unknown"),
    candidateType: candidate.candidateType || "none",
    transport: candidate.transport || "none",
    attempt: Math.min(3, Math.max(0, Number(targetState.p2pRecovery?.iceRestartCount || 0))),
    elapsedMs,
    ...extra,
  };
  reportP2pConnectivityCallable({
    sessionId: targetState.clientSessionId,
    roomId: targetState.roomId,
    diagnostic,
  }).catch(() => {});
}

function clearP2pRecoveryTimer(targetState = state) {
  window.clearTimeout(targetState.p2pRecoveryTimer);
  targetState.p2pRecoveryTimer = null;
}

function scheduleP2pRecoveryTimer(targetState = state) {
  clearP2pRecoveryTimer(targetState);
  const timer = getOnlineP2pRecoveryTimer(targetState.p2pRecovery);
  if (!timer) return;
  targetState.p2pRecoveryTimer = window.setTimeout(() => {
    dispatchP2pRecoveryEvent("TIMER_EXPIRED", targetState, {
      timerToken: timer.timerToken,
    });
  }, Math.max(0, timer.deadlineAt - Date.now()));
}

function dispatchP2pRecoveryEvent(type, targetState = state, detail = {}) {
  if (preserveResolvedFinishFromP2pRecovery(targetState)) return;
  const recovery = targetState.p2pRecovery;
  if (!recovery || state !== targetState) return;
  const result = transitionOnlineP2pRecovery(recovery, {
    type,
    generationToken: recovery.generationToken,
    now: Date.now(),
    ...detail,
  });
  if (result.ignored) {
    if (type === "TIMER_EXPIRED"
        && detail.timerToken === recovery.timerToken
        && Number.isFinite(recovery.deadlineAt)
        && Date.now() < recovery.deadlineAt) {
      scheduleP2pRecoveryTimer(targetState);
    }
    return;
  }
  targetState.p2pRecovery = result.state;
  scheduleP2pRecoveryTimer(targetState);
  result.effects.forEach((effect) => {
    handleP2pRecoveryEffect(effect, targetState).catch(handleRecoverableError);
  });
}

async function completeP2pFailureCleanup(targetState, effect) {
  if (await preserveResolvedMatchBeforeP2pCleanup(targetState)) return;
  if (targetState.p2pCleanupPromise) return targetState.p2pCleanupPromise;
  const roomId = targetState.roomId;
  targetState.p2pCleanupPromise = (async () => {
    await reportP2pDiagnostic("cleanup", targetState, targetState.peer);
    if (await preserveResolvedMatchBeforeP2pCleanup(targetState)) return;
    if (roomId && targetState.uid) {
      await runTransaction(
        ref(database, `online/rooms/${roomId}/destroyed`),
        (current) => (
          getResolvedMatchResultForRound(targetState.round, targetState)
            ? undefined
            : current || { by: targetState.uid, at: Date.now() }
        ),
      ).catch(() => {});
    }
    if (await preserveResolvedMatchBeforeP2pCleanup(targetState)) return;
    await cleanupOnlineResources(false, targetState, { preserveP2pRecovery: true });
    const currentRecovery = targetState.p2pRecovery;
    if (state !== targetState
        || currentRecovery?.generationToken !== effect.generationToken
        || currentRecovery.phase !== ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP) return;
    if (currentRecovery.manuallyCancelled) {
      targetState.p2pRecovery = null;
      targetState.p2pGenerationToken = null;
      return;
    }
    dispatchP2pRecoveryEvent("CLEANUP_COMPLETED", targetState);
  })();
  try {
    await targetState.p2pCleanupPromise;
  } finally {
    targetState.p2pCleanupPromise = null;
  }
}

async function resetAfterP2pFailure(targetState, {
  autoRequeueCount = 0,
  opponentCooldown = null,
  automatic = false,
} = {}) {
  if (state !== targetState
      || !active
      || (automatic && (
        targetState.p2pRecovery?.manuallyCancelled
        || document.visibilityState !== "visible"
        || !navigator.onLine
      ))) return false;
  const resetSucceeded = await resetOnlineState("setup");
  if (!resetSucceeded
      || !active
      || state.screen !== "setup"
      || (automatic && (
        document.visibilityState !== "visible"
        || !navigator.onLine
      ))) return false;
  const replacementState = state;
  replacementState.p2pAutoRequeueCount = autoRequeueCount;
  replacementState.p2pOpponentCooldown = opponentCooldown;
  replacementState.p2pAutoRequeueStartedAt = automatic ? Date.now() : 0;
  if (!automatic) {
    showToast("P2P接続を確立できませんでした。通信環境を確認して、もう一度お試しください。");
    return true;
  }
  showToast("接続先を切り替えて、対戦相手をもう一度探しています。");
  await beginMatchmaking({ automatic: true });
  return state !== replacementState
    || replacementState.screen !== "setup";
}

async function handleP2pRecoveryEffect(effect, targetState = state) {
  if (preserveResolvedFinishFromP2pRecovery(targetState)) return;
  const recovery = targetState.p2pRecovery;
  if (state !== targetState
      || recovery?.generationToken !== effect.generationToken) return;
  if (effect.type === "restart-ice") {
    await reportP2pDiagnostic("restart_started", targetState, targetState.peer);
    const currentRecovery = targetState.p2pRecovery;
    if (state !== targetState
        || currentRecovery?.generationToken !== effect.generationToken
        || currentRecovery.phase !== ONLINE_P2P_RECOVERY_PHASES.RESTARTING
        || currentRecovery.channelWasOpened
        || currentRecovery.manuallyCancelled) return;
    try {
      await targetState.p2pRestartIce?.();
    } catch {
      const failedRecovery = targetState.p2pRecovery;
      if (state === targetState
          && failedRecovery?.generationToken === effect.generationToken
          && failedRecovery.phase === ONLINE_P2P_RECOVERY_PHASES.RESTARTING
          && !failedRecovery.channelWasOpened
          && !failedRecovery.manuallyCancelled) {
        dispatchP2pRecoveryEvent("ICE_FAILED", targetState);
      }
    }
    return;
  }
  if (effect.type === "cleanup-failed-room") {
    if (effect.reason === "connection-timeout") {
      await reportP2pDiagnostic("connection_timeout", targetState, targetState.peer);
    } else if (effect.reason === "restart-timeout") {
      await reportP2pDiagnostic("restart_timeout", targetState, targetState.peer);
    }
    const currentRecovery = targetState.p2pRecovery;
    if (state !== targetState
        || currentRecovery?.generationToken !== effect.generationToken
        || currentRecovery.phase !== ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP) return;
    await completeP2pFailureCleanup(targetState, effect);
    return;
  }
  if (effect.type === "auto-requeue") {
    await resetAfterP2pFailure(targetState, {
      automatic: true,
      autoRequeueCount: effect.autoRequeueCount,
      opponentCooldown: effect.opponentCooldown,
    });
    return;
  }
  if (effect.type === "show-connection-failure") {
    await resetAfterP2pFailure(targetState);
  }
}

async function setupPeerConnection(context) {
  if (!isCurrentRoomSetupContext(context)) return false;
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像転送に対応していません。");
  const iceConfiguration = await loadP2pIceServers();
  if (!isCurrentRoomSetupContext(context)) return false;
  const peer = new RTCPeerConnection({
    iceServers: iceConfiguration.iceServers,
    iceTransportPolicy: "all",
  });
  const peerContextIsCurrent = () => (
    isCurrentRoomSetupContext(context) && state.peer === peer
  );
  let signalUnsubscribe = null;
  let signalHandlingChain = Promise.resolve();
  let createdChannel = null;
  const abandonPeerSetup = () => {
    signalUnsubscribe?.();
    if (state === context.expectedState && createdChannel && state.channel === createdChannel) {
      createdChannel.close();
      state.channel = null;
      state.channelReady = false;
    }
    peer.onicecandidate = null;
    peer.onicecandidateerror = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    peer.ondatachannel = null;
    peer.close();
    if (state === context.expectedState && state.peer === peer) {
      clearP2pRecoveryTimer(context.expectedState);
      context.expectedState.p2pRestartIce = null;
      context.expectedState.peer = null;
    }
  };
  const sendRoomSignal = async (type, payload) => {
    if (!peerContextIsCurrent()) return;
    await set(push(ref(database, soloRoomSignalPath(
      context.roomId,
      context.opponentUid,
      context.expectedState.opponentSessionId,
    ))), {
      protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
      signalingVersion: ONLINE_SESSION_PROTOCOL_VERSION,
      fromUid: context.ownUid,
      fromSessionId: context.expectedState.clientSessionId,
      toUid: context.opponentUid,
      toSessionId: context.expectedState.opponentSessionId,
      connectionGeneration: context.expectedState.roomConnectionGeneration,
      attemptId: context.expectedState.signalingAttemptId,
      type,
      payload: JSON.stringify(payload),
      createdAt: serverTimestamp(),
    });
  };
  state.peer = peer;
  state.pendingIce = [];
  state.p2pStartedAt = Date.now();
  state.p2pTurnAvailable = iceConfiguration.turnAvailable;
  state.p2pGenerationToken = createOnlineP2pGenerationToken({
    matchmakingGeneration: context.generation,
    roomId: context.roomId,
    sessionId: state.clientSessionId,
  });
  state.p2pRecovery = createOnlineP2pRecoveryState({
    generationToken: state.p2pGenerationToken,
    isHost: state.playerIndex === 0,
    opponentUid: context.opponentUid,
    startedAt: state.p2pStartedAt,
    autoRequeueCount: state.p2pAutoRequeueCount,
    visible: document.visibilityState === "visible",
    online: navigator.onLine,
  });
  state.p2pRestartIce = async () => {
    const restartIsCurrent = () => (
      peerContextIsCurrent()
      && state.playerIndex === 0
      && state.p2pRecovery?.phase === ONLINE_P2P_RECOVERY_PHASES.RESTARTING
      && state.p2pRecovery?.channelWasOpened !== true
    );
    if (!restartIsCurrent()) return;
    peer.restartIce?.();
    const restartOffer = await peer.createOffer({ iceRestart: true });
    if (!restartIsCurrent()) return;
    await peer.setLocalDescription(restartOffer);
    if (!restartIsCurrent()) return;
    await sendRoomSignal("offer", {
      type: restartOffer.type,
      sdp: restartOffer.sdp,
      iceRestart: true,
    });
  };
  scheduleP2pRecoveryTimer(state);
  reportP2pDiagnostic("peer_created", state, peer).catch(() => {});
  if (!iceConfiguration.turnAvailable) {
    reportP2pDiagnostic("turn_unavailable", state, peer).catch(() => {});
  }
  peer.onicecandidate = (event) => {
    if (event.candidate && peerContextIsCurrent()) {
      sendRoomSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError);
    }
  };
  peer.onicecandidateerror = () => {
    if (peerContextIsCurrent() && state.screen === "connecting") {
      state.peerStatus = "P2P接続経路を調整中…";
      render();
    }
  };
  const handlePeerStateChange = () => {
    if (!peerContextIsCurrent()) return;
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    const peerDisconnected = peer.connectionState === "disconnected"
      || peer.iceConnectionState === "disconnected";
    const peerFailed = ["failed", "closed"].includes(peer.connectionState)
      || peer.iceConnectionState === "failed";
    if ((peerDisconnected || peerFailed)
        && preserveResolvedFinishFromP2pRecovery(state, { notify: true })) {
      return;
    }
    if (peer.connectionState === "connected"
        || ["connected", "completed"].includes(peer.iceConnectionState)) {
      dispatchP2pRecoveryEvent("ICE_CONNECTED", state);
    } else if (peerDisconnected) {
      reportP2pDiagnostic("ice_disconnected", state, peer).catch(() => {});
      dispatchP2pRecoveryEvent("ICE_DISCONNECTED", state);
    } else if (peerFailed) {
      reportP2pDiagnostic("ice_failed", state, peer).catch(() => {});
      dispatchP2pRecoveryEvent("ICE_FAILED", state);
    }
    if (state.screen === "connecting") render();
  };
  peer.onconnectionstatechange = handlePeerStateChange;
  peer.oniceconnectionstatechange = handlePeerStateChange;
  peer.ondatachannel = (event) => {
    if (peerContextIsCurrent()) configureDataChannel(event.channel, context.expectedState);
  };

  const signalsRef = ref(database, soloRoomSignalPath(
    context.roomId,
    context.ownUid,
    context.expectedState.clientSessionId,
  ));
  signalUnsubscribe = onChildAdded(signalsRef, (snapshot) => {
    signalHandlingChain = signalHandlingChain
      .catch(() => {})
      .then(async () => {
        if (!peerContextIsCurrent()) return;
        const signal = snapshot.val();
        const decision = decideOnlineSignalEnvelope({
          envelope: signal,
          ownSessionId: context.expectedState.clientSessionId,
          remoteSessionId: context.expectedState.opponentSessionId,
          connectionGeneration: context.expectedState.roomConnectionGeneration,
          isCurrentLeaseOwner: context.expectedState.soloSessionLeaseHeld,
        });
        if (!decision.accepted) return;
        let handledSuccessfully = false;
        try {
          await handleSignal(signal, {
            context,
            peer,
            sendRoomSignal,
          });
          handledSuccessfully = true;
        } catch (error) {
          if (peerContextIsCurrent()) handleRecoverableError(error);
        }
        if (shouldConsumeOnlineSignal(decision, {
          handledSuccessfully,
          contextStillCurrent: peerContextIsCurrent(),
        })) {
          await remove(snapshot.ref).catch(() => {});
        }
      });
  });
  state.roomUnsubscribers.push(signalUnsubscribe);

  try {
    if (state.playerIndex === 0) {
      createdChannel = peer.createDataChannel("hariai-images", { ordered: true });
      configureDataChannel(createdChannel, context.expectedState);
      const offer = await peer.createOffer();
      if (!peerContextIsCurrent()) {
        abandonPeerSetup();
        return false;
      }
      await peer.setLocalDescription(offer);
      if (!peerContextIsCurrent()) {
        abandonPeerSetup();
        return false;
      }
      await sendRoomSignal("offer", {
        type: offer.type,
        sdp: offer.sdp,
        iceRestart: false,
      });
      if (!peerContextIsCurrent()) {
        abandonPeerSetup();
        return false;
      }
    }
  } catch (error) {
    abandonPeerSetup();
    throw error;
  }
  return true;
}

async function handleSignal(signal, { context, peer, sendRoomSignal }) {
  const targetState = context.expectedState;
  const contextIsCurrent = () => (
    isCurrentRoomSetupContext(context) && state.peer === peer
  );
  if (!contextIsCurrent()
      || signal?.fromUid !== context.opponentUid
      || signal?.toUid !== context.ownUid
      || signal?.attemptId !== targetState.signalingAttemptId) {
    throw new Error("現在の接続試行と異なるシグナルです。");
  }
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    if (payload?.iceRestart === true) {
      dispatchP2pRecoveryEvent("RESTART_OFFER_RECEIVED", targetState);
    }
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    await flushPendingIce(peer, targetState.pendingIce, contextIsCurrent);
    const answer = await peer.createAnswer();
    if (!contextIsCurrent()) return;
    await peer.setLocalDescription(answer);
    if (!contextIsCurrent()) return;
    await sendRoomSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    if (!contextIsCurrent()) return;
    await flushPendingIce(peer, targetState.pendingIce, contextIsCurrent);
  } else if (signal.type === "candidate") {
    if (peer.remoteDescription) await peer.addIceCandidate(payload);
    else targetState.pendingIce.push(payload);
  } else {
    throw new Error("未対応の接続シグナルです。");
  }
}

async function flushPendingIce(peer, pendingIce, contextIsCurrent = () => true) {
  while (pendingIce.length && contextIsCurrent()) {
    await peer.addIceCandidate(pendingIce.shift());
  }
}

function configureDataChannel(channel, expectedState = state) {
  expectedState.channel = channel;
  const channelContextIsCurrent = () => (
    state === expectedState
      && expectedState.channel === channel
      && !expectedState.roomTerminationToken
  );
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!channelContextIsCurrent()) return;
    dispatchP2pRecoveryEvent("CHANNEL_OPENED", expectedState);
    reportP2pDiagnostic("channel_open", expectedState, expectedState.peer).catch(() => {});
    if ([
      ONLINE_P2P_RECOVERY_PHASES.CLEANING_UP,
      ONLINE_P2P_RECOVERY_PHASES.TERMINAL,
    ].includes(expectedState.p2pRecovery?.phase)) return;
    expectedState.channelReady = true;
    expectedState.p2pAutoRequeueStartedAt = 0;
    expectedState.p2pAutoRequeueCancelling = false;
    expectedState.peerStatus = "● P2P接続済み";
    if (expectedState.screen === "connecting") {
      expectedState.screen = "select";
      render();
    }
    (async () => {
      let profileTransferSettled = false;
      try {
        await sendProfileAvatar();
        profileTransferSettled = true;
      } catch (error) {
        profileTransferSettled = error?.profileTransferReset === true;
        if (channelContextIsCurrent()) handleRecoverableError(error);
      }
      if (profileTransferSettled && channelContextIsCurrent() && channel.readyState === "open") {
        await announceSelectionReady();
      }
    })().catch((error) => {
      if (channelContextIsCurrent()) handleRecoverableError(error);
    });
  };
  channel.onclose = () => {
    if (!channelContextIsCurrent()) return;
    expectedState.channelReady = false;
    expectedState.peerStatus = "P2P接続が切れました";
    markPendingFinishReplyAcksUnconfirmed(expectedState, channel);
    const resolvedFinishPreserved = preserveResolvedFinishFromP2pRecovery(
      expectedState,
      { notify: true },
    );
    if (!resolvedFinishPreserved && !["gameover", "engawa", "noContest"].includes(expectedState.screen)) {
      dispatchP2pRecoveryEvent("ICE_FAILED", expectedState);
    }
    if (expectedState.screen === "engawa") {
      closeEngawaLocally("P2P接続が切れたため、縁側を閉じました。");
    } else if (expectedState.screen === "gameover" && !expectedState.engawaClosed) {
      closeEngawaLocally("P2P接続が閉じたため、今回はここで一戦を終えます。");
    }
  };
  channel.onerror = () => {
    if (channelContextIsCurrent()) showToast("画像転送で通信エラーが発生しました。");
  };
  channel.onmessage = (event) => {
    const data = event.data;
    expectedState.incomingMessageChain = expectedState.incomingMessageChain
      .catch(() => {})
      .then(() => {
        if (!channelContextIsCurrent()) return;
        return handleChannelMessage(data, expectedState, channel);
      })
      .catch((error) => {
        if (channelContextIsCurrent()) handleRecoverableError(error);
      });
  };
}

async function handleChannelMessage(data, expectedState = state, expectedChannel = expectedState.channel) {
  const contextIsCurrent = () => (
    state === expectedState
      && expectedState.channel === expectedChannel
      && !expectedState.roomTerminationToken
  );
  if (!contextIsCurrent()) return;
  if (typeof data === "string") {
    if (data.length > ENGAWA_MESSAGE_MAX_CHARS) throw new Error("P2Pメッセージが長すぎます。");
    const message = JSON.parse(data);
    if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("P2Pメッセージの形式が不正です。");
    if (message.type === "engawa-decision") {
      handleRemoteEngawaDecision(message.decision);
    } else if (message.type === "engawa-image-start") {
      startIncomingEngawaImage(message);
    } else if (message.type === "engawa-image-end") {
      await finishIncomingEngawaImage();
    } else if (message.type === "engawa-image-cancel") {
      state.incomingEngawaTransfer = null;
    } else if (message.type === "engawa-response") {
      handleRemoteEngawaResponse(message.responseId);
    } else if (message.type === "engawa-end") {
      handleRemoteEngawaEnd();
    } else if (message.type === "finish-reply") {
      handleRemoteFinishReply(message, expectedState, expectedChannel);
    } else if (message.type === "finish-reply-ack") {
      handleRemoteFinishReplyAck(message, expectedState, expectedChannel);
    } else if (message.type === "profile-avatar-start") {
      assertIncomingTransferNamespaceExclusive(state, "profile");
      if (state.incomingAvatarTransfer) {
        state.incomingAvatarTransfer = null;
      }
      const size = Number(message.size);
      if (!Number.isSafeInteger(size) || size <= 0 || size > PROFILE_AVATAR_MAX_BYTES) throw new Error("プロフィール画像の受信サイズが不正です。");
      const declaredMime = normalizeOnlineImageMime(message.mime);
      if (declaredMime.length > 80) throw new Error("プロフィール画像の形式情報が不正です。");
      state.incomingAvatarTransfer = { declaredMime, size, chunks: [], received: 0 };
    } else if (message.type === "profile-avatar-end") {
      finishIncomingProfileAvatar();
    } else if (message.type === "profile-avatar-empty") {
      releaseRemoteAvatar();
    } else if (message.type === "image-start") {
      assertIncomingTransferNamespaceExclusive(state, "battle");
      if (state.incomingTransfer) {
        state.incomingTransfer = null;
        state.transferProgress = 0;
      }
      state.incomingTransfer = {
        ...createIncomingOnlineImageTransfer(message, {
          expectedRound: state.round,
          maxBytes: MAX_IMAGE_TRANSFER_BYTES,
        }),
        signature: message.signature === true,
        finishLine: normalizeReceivedFinishLine(message.finishLine),
      };
    } else if (message.type === "image-cancel") {
      const round = Number(message.round);
      if (state.incomingTransfer?.round === round) {
        state.incomingTransfer = null;
        state.transferProgress = 0;
      }
    } else if (message.type === "image-end") {
      await finishIncomingImage(Number(message.round));
    }
    return;
  }
  if (state.incomingAvatarTransfer) {
    const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
    if (!contextIsCurrent()) return;
    if (!(chunk instanceof ArrayBuffer) || chunk.byteLength <= 0) {
      state.incomingAvatarTransfer = null;
      throw new Error("プロフィール画像の受信データが不正です。");
    }
    state.incomingAvatarTransfer.chunks.push(chunk);
    state.incomingAvatarTransfer.received += chunk.byteLength;
    if (state.incomingAvatarTransfer.received > state.incomingAvatarTransfer.size) {
      state.incomingAvatarTransfer = null;
      throw new Error("プロフィール画像の受信サイズが宣言値を超えました。");
    }
    return;
  }
  if (state.incomingEngawaTransfer) {
    const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
    if (!contextIsCurrent()) return;
    try {
      appendIncomingEngawaImageChunk(state.incomingEngawaTransfer, chunk);
    } catch (error) {
      state.incomingEngawaTransfer = null;
      throw error;
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  if (!contextIsCurrent()) return;
  try {
    appendIncomingOnlineImageChunk(state.incomingTransfer, chunk);
  } catch (error) {
    state.incomingTransfer = null;
    state.transferProgress = 0;
    throw error;
  }
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
  if (state.screen === "waitingImage") updateTransferText();
}

function queueOutgoingDataTransfer(expectedState, task) {
  const previous = expectedState.outgoingTransferChain || Promise.resolve();
  const run = previous.catch(() => {}).then(() => {
    if (state !== expectedState) throw new Error("画像転送の対象ルームが切り替わりました。");
    return task();
  });
  expectedState.outgoingTransferChain = run.catch(() => {});
  return run;
}

function waitForProfileAvatarReady() {
  const ready = shared()?.profileAvatar?.ready?.();
  if (!ready || typeof ready.then !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, PROFILE_AVATAR_READY_WAIT_MS);
    Promise.resolve(ready).then(finish, finish);
  });
}

async function sendProfileAvatar() {
  if (state.avatarSent || !state.channel || state.channel.readyState !== "open") return;
  const expectedState = state;
  const channel = state.channel;
  state.avatarSent = true;
  await queueOutgoingDataTransfer(expectedState, async () => {
    let started = false;
    try {
      await waitForProfileAvatarReady();
      if (state !== expectedState || state.channel !== channel || channel.readyState !== "open") {
        throw new Error("プロフィール画像の送信前にP2P接続が切れました。");
      }
      const avatar = shared()?.profileAvatar?.get?.();
      if (!avatar?.blob || avatar.blob.size > PROFILE_AVATAR_MAX_BYTES) {
        channel.send(JSON.stringify({ type: "profile-avatar-empty" }));
        return;
      }
      const buffer = await avatar.blob.arrayBuffer();
      let mime;
      try {
        mime = verifiedOnlineImageMime(buffer);
      } catch {
        channel.send(JSON.stringify({ type: "profile-avatar-empty" }));
        return;
      }
      channel.send(JSON.stringify({ type: "profile-avatar-start", size: buffer.byteLength, mime }));
      started = true;
      for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
        await waitForDataBuffer(channel);
        channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      }
      channel.send(JSON.stringify({ type: "profile-avatar-end" }));
    } catch (error) {
      let resetSent = !started;
      if (started && channel.readyState === "open") {
        try {
          channel.send(JSON.stringify({ type: "profile-avatar-empty" }));
          resetSent = true;
        } catch {
          // The original transfer error is more useful than a best-effort reset failure.
        }
      }
      if (error && typeof error === "object") error.profileTransferReset = resetSent;
      throw error;
    }
  });
}

function finishIncomingProfileAvatar() {
  const transfer = state.incomingAvatarTransfer;
  if (!transfer) return;
  if (transfer.received !== transfer.size) {
    state.incomingAvatarTransfer = null;
    throw new Error("プロフィール画像の受信が完了していません。");
  }
  let mime;
  try {
    mime = verifiedOnlineImageMimeFromChunks(transfer.chunks);
  } catch {
    state.incomingAvatarTransfer = null;
    throw new Error("プロフィール画像の形式が不正です。");
  }
  releaseRemoteAvatar();
  const blob = new Blob(transfer.chunks, { type: mime });
  state.remoteAvatar = { blob, url: URL.createObjectURL(blob) };
  if (!["connecting", "gameover", "noContest", "error"].includes(state.screen)) render();
}

function releaseRemoteAvatar() {
  if (state.remoteAvatar?.url) URL.revokeObjectURL(state.remoteAvatar.url);
  state.remoteAvatar = null;
  state.incomingAvatarTransfer = null;
}

async function finishIncomingImage(round) {
  const transfer = state.incomingTransfer;
  const endStatus = onlineImageEndStatus(transfer, { round });
  if (endStatus === "orphan") return;
  if (endStatus === "mismatch") {
    state.incomingTransfer = null;
    state.transferProgress = 0;
    throw new Error("受信画像のラウンド情報が一致しませんでした。");
  }
  let mime;
  try {
    mime = completeIncomingOnlineImageTransfer(transfer);
  } catch (error) {
    state.incomingTransfer = null;
    state.transferProgress = 0;
    throw error;
  }
  state.incomingTransfer = null;
  const previous = state.remoteImages.get(round);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  const blob = new Blob(transfer.chunks, { type: mime });
  state.remoteImages.set(round, {
    blob,
    url: URL.createObjectURL(blob),
    signature: transfer.signature === true,
    finishLine: normalizeReceivedFinishLine(transfer.finishLine),
  });
  state.transferProgress = 100;
  await set(ref(database, `online/rooms/${state.roomId}/rounds/${round}/imagesReceived/${state.uid}`), true);
}

function sendEngawaMessage(message, channel = state.channel) {
  if (!channel || channel.readyState !== "open") throw new Error("相手とのP2P接続が閉じています。");
  const payload = JSON.stringify(message);
  if (payload.length > ENGAWA_MESSAGE_MAX_CHARS) throw new Error("縁側の送信内容が長すぎます。");
  channel.send(payload);
}

function submitEngawaDecision(decision) {
  if (state.screen !== "gameover" || state.engawaLocalDecision || state.engawaClosed) return;
  if (decision !== "accept" && decision !== "decline") return;
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  try {
    sendEngawaMessage({ type: "engawa-decision", decision });
  } catch (error) {
    handleRecoverableError(error);
    return;
  }
  state.engawaLocalDecision = decision;
  if (decision === "decline") {
    state.engawaClosed = true;
    state.engawaEndReason = "今日はここまで。縁側は開かず、一戦を終えました。";
    render();
    return;
  }
  maybeEnterEngawa();
  if (state.screen === "gameover") render();
}

function handleRemoteEngawaDecision(decision) {
  if (decision !== "accept" && decision !== "decline") throw new Error("縁側の参加回答が不正です。");
  if (!state.outcome && !isMatchOver()) throw new Error("試合終了前の縁側回答は受け取れません。");
  if (state.engawaRemoteDecision) {
    if (state.engawaRemoteDecision !== decision) throw new Error("縁側の参加回答は変更できません。");
    return;
  }
  state.engawaRemoteDecision = decision;
  if (decision === "decline") {
    closeEngawaLocally("今回は縁側を開かず、ここで一戦を終えます。");
    return;
  }
  maybeEnterEngawa();
}

function maybeEnterEngawa() {
  if (state.screen !== "gameover" || !state.outcome || !engawaIsMutuallyAccepted()) return;
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    scheduleEngawaAfterPostMatchTip();
    return;
  }
  if (!state.opponentOnline || state.channel?.readyState !== "open") {
    closeEngawaLocally("相手とのP2P接続が閉じたため、縁側を開けませんでした。");
    return;
  }
  state.screen = "engawa";
  state.engawaErrorMessage = "";
  setOnlineChrome("ENGAWA / P2P");
  render();
}

function scheduleEngawaAfterPostMatchTip() {
  if (state.engawaResumeTimer || state.screen !== "gameover") return;
  state.engawaResumeTimer = window.setTimeout(() => {
    state.engawaResumeTimer = null;
    if (state.screen !== "gameover") return;
    if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
      scheduleEngawaAfterPostMatchTip();
      return;
    }
    if (engawaIsMutuallyAccepted()) {
      maybeEnterEngawa();
    } else {
      render();
    }
  }, 250);
}

function endEngawa(reason) {
  if (state.engawaClosed) return;
  if (state.screen === "gameover" && isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  try {
    sendEngawaMessage({ type: "engawa-end" });
  } catch (error) {
    if (state.channel?.readyState === "open") handleRecoverableError(error);
  }
  closeEngawaLocally(reason);
}

function handleRemoteEngawaEnd() {
  if (!state.outcome && !isMatchOver()) throw new Error("試合終了前の縁側終了通知は受け取れません。");
  closeEngawaLocally("相手が縁側を終えました。共有した画像と反応は破棄しました。");
}

function closeEngawaLocally(reason) {
  if (!state.engawaClosed) {
    state.engawaClosed = true;
    state.engawaEndReason = reason;
  }
  releaseEngawaMedia();
  if (state.screen === "engawa") {
    state.screen = "gameover";
    setOnlineChrome("MATCH COMPLETE");
  }
  if (state.screen === "gameover" && isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    scheduleEngawaAfterPostMatchTip();
  } else if (state.screen === "gameover") {
    render();
  }
}

function notifyEngawaDeparture(targetState = state) {
  if (!targetState.outcome || targetState.engawaClosed) return;
  if (targetState.channel?.readyState === "open") {
    try {
      sendEngawaMessage({ type: "engawa-end" }, targetState.channel);
    } catch {
      // The connection is closing; local cleanup still proceeds.
    }
  }
  targetState.engawaClosed = true;
  targetState.engawaEndReason = "縁側を終了しました。";
}

function startIncomingEngawaImage(message) {
  if (!engawaIsMutuallyAccepted() || state.screen !== "engawa") throw new Error("縁側が開いていないため画像を受け取れません。");
  assertIncomingTransferNamespaceExclusive(state, "engawa");
  if (state.incomingEngawaTransfer || state.engawaRemoteImage) {
    throw new Error("縁側では画像を一枚だけ受け取れます。");
  }
  const mood = getEngawaMood(message.moodId);
  if (!mood) throw new Error("縁側の気分札が不正です。");
  state.incomingEngawaTransfer = {
    ...createIncomingEngawaImageTransfer(message, { maxBytes: MAX_IMAGE_TRANSFER_BYTES }),
    moodId: mood.id,
  };
}

async function finishIncomingEngawaImage() {
  const transfer = state.incomingEngawaTransfer;
  if (engawaImageEndStatus(transfer) === "orphan") return;
  let mime;
  try {
    mime = completeIncomingEngawaImageTransfer(transfer);
  } catch (error) {
    state.incomingEngawaTransfer = null;
    throw error;
  }
  state.incomingEngawaTransfer = null;
  if (!engawaIsMutuallyAccepted() || state.screen !== "engawa") return;
  releaseEngawaRemoteImage();
  const blob = new Blob(transfer.chunks, { type: mime });
  state.engawaRemoteImage = {
    blob,
    url: URL.createObjectURL(blob),
    moodId: transfer.moodId,
  };
  render();
}

function handleRemoteEngawaResponse(responseId) {
  const response = getEngawaResponse(responseId);
  if (!engawaIsMutuallyAccepted() || state.screen !== "engawa") throw new Error("縁側が開いていないため反応を受け取れません。");
  if (!response || !state.engawaImageSent) throw new Error("縁側の定型反応が不正です。");
  if (state.engawaRemoteResponse) {
    if (state.engawaRemoteResponse !== response.id) throw new Error("縁側の反応は一度だけ送れます。");
    return;
  }
  state.engawaRemoteResponse = response.id;
  syncEngawaResponseControls();
}

function sendEngawaResponse(responseId) {
  const response = getEngawaResponse(responseId);
  if (!response || state.engawaLocalResponse || !state.engawaRemoteImage || !state.engawaImageSent
      || !engawaIsMutuallyAccepted() || state.screen !== "engawa") return;
  try {
    sendEngawaMessage({ type: "engawa-response", responseId: response.id });
  } catch (error) {
    handleRecoverableError(error);
    return;
  }
  state.engawaLocalResponse = response.id;
  syncEngawaResponseControls();
}

async function sendEngawaImage() {
  if (!engawaIsMutuallyAccepted() || state.screen !== "engawa" || state.engawaSending || state.engawaImageSent) return;
  const expectedState = state;
  const channel = expectedState.channel;
  if (!channel || channel.readyState !== "open") throw new Error("相手とのP2P接続が閉じています。");
  const cardId = state.engawaSharedCardId || state.engawaSelectedCardId;
  const moodId = state.engawaSharedMoodId || state.engawaMoodId;
  const item = state.deck.find((card) => card.id === cardId);
  const mood = getEngawaMood(moodId);
  if (!item?.blob || !mood) {
    showToast("見せたい一枚と、今の気分を選んでください。");
    return;
  }
  state.engawaSharedCardId = item.id;
  state.engawaSharedMoodId = mood.id;
  state.engawaSending = true;
  state.engawaTransferProgress = 0;
  state.engawaErrorMessage = "";
  const transferGeneration = ++state.engawaTransferGeneration;
  render();

  try {
    await queueOutgoingDataTransfer(expectedState, async () => {
      const transferIsCurrent = () => (
        state === expectedState
        && expectedState.channel === channel
        && channel.readyState === "open"
        && transferGeneration === expectedState.engawaTransferGeneration
        && !expectedState.engawaClosed
        && expectedState.screen === "engawa"
      );
      let transferStarted = false;
      try {
        if (!transferIsCurrent()) throw new Error("縁側画像の送信前にP2P接続または画面が切り替わりました。");
        const buffer = await item.blob.arrayBuffer();
        if (!transferIsCurrent()) throw new Error("縁側画像の送信前にP2P接続または画面が切り替わりました。");
        if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
          throw new Error("縁側で送る画像のサイズが不正です。");
        }
        const mime = verifiedOnlineImageMime(buffer);
        sendEngawaMessage({
          type: "engawa-image-start",
          size: buffer.byteLength,
          mime,
          moodId: mood.id,
        }, channel);
        transferStarted = true;
        for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
          await waitForEngawaDataBuffer(channel);
          if (!transferIsCurrent()) throw new Error("縁側画像の送信中にP2P接続または画面が切り替わりました。");
          channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
          expectedState.engawaTransferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
          updateEngawaTransferText();
        }
        if (!transferIsCurrent()) throw new Error("縁側画像の送信中にP2P接続または画面が切り替わりました。");
        sendEngawaMessage({ type: "engawa-image-end" }, channel);
        expectedState.engawaImageSent = true;
      } catch (error) {
        if (transferStarted && channel.readyState === "open") {
          try {
            sendEngawaMessage({ type: "engawa-image-cancel" }, channel);
          } catch {
            // The original transfer error is more useful than a best-effort cancel failure.
          }
        }
        throw error;
      }
    });
  } catch (error) {
    if (state !== expectedState || transferGeneration !== expectedState.engawaTransferGeneration
        || expectedState.engawaClosed || expectedState.screen !== "engawa") return;
    expectedState.engawaErrorMessage = error?.message || "画像を送れませんでした。";
    throw error;
  } finally {
    if (state === expectedState && transferGeneration === expectedState.engawaTransferGeneration) {
      expectedState.engawaSending = false;
      if (expectedState.screen === "engawa") render();
    }
  }
}

function waitForEngawaDataBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("相手とのP2P接続が閉じています。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", handleLow);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleClose);
      if (error) reject(error);
      else resolve();
    };
    const handleLow = () => finish();
    const handleClose = () => finish(new Error("画像転送中にP2P接続が切れました。"));
    const timer = window.setTimeout(() => finish(new Error("画像転送が混み合っています。もう一度お試しください。")), ENGAWA_BUFFER_WAIT_MS);
    channel.addEventListener("bufferedamountlow", handleLow, { once: true });
    channel.addEventListener("close", handleClose, { once: true });
    channel.addEventListener("error", handleClose, { once: true });
    if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) finish();
  });
}

function updateEngawaTransferText() {
  const status = document.querySelector("[data-engawa-transfer-status]");
  if (status && state.screen === "engawa" && state.engawaSending) {
    status.textContent = `P2Pで転送中 ${state.engawaTransferProgress}%`;
  }
}

function hasSelectionStarted() {
  return Number.isFinite(state.selectionStartedAt) && state.selectionStartedAt > 0;
}

async function announceSelectionReady() {
  if (!active || !state.roomId || !state.channelReady || state.screen !== "select" || state.selectionReadyRound === state.round) return;
  const expectedState = state;
  const roomId = expectedState.roomId;
  const ownUid = expectedState.uid;
  const readyRound = expectedState.round;
  expectedState.selectionReadyRound = readyRound;
  try {
    await set(ref(database, `online/rooms/${roomId}/rounds/${readyRound}/selectionReady/${ownUid}`), true);
  } catch (error) {
    if (state === expectedState && expectedState.round === readyRound) {
      expectedState.selectionReadyRound = 0;
    }
    throw error;
  }
}

async function startSharedSelectionClock() {
  const expectedState = state;
  const roomId = expectedState.roomId;
  const startRound = expectedState.round;
  if (expectedState.playerIndex !== 0 || expectedState.selectionStartRequestRound === startRound
      || Number(expectedState.roundData.selectionStartedAt) > 0) return;
  expectedState.selectionStartRequestRound = startRound;
  try {
    await set(ref(database, `online/rooms/${roomId}/rounds/${startRound}/selectionStartedAt`), serverTimestamp());
  } catch (error) {
    if (state === expectedState && expectedState.round === startRound) {
      expectedState.selectionStartRequestRound = 0;
    }
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

function stopSelectionTimer(targetState = state) {
  if (targetState.selectionTimer) window.clearInterval(targetState.selectionTimer);
  targetState.selectionTimer = null;
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
  const expectedState = state;
  const roomId = expectedState.roomId;
  const round = expectedState.round;
  const ownUid = expectedState.uid;
  expectedState.selectionLocking = true;
  stopSelectionTimer(expectedState);
  expectedState.screen = "waitingPick";
  render();
  try {
    await set(ref(database, `online/rooms/${roomId}/rounds/${round}/picks/${ownUid}`), {
      ready: true,
      lockedAt: serverTimestamp(),
    });
  } finally {
    expectedState.selectionLocking = false;
  }
}

async function reactToRoundData(roundContext, roundData) {
  const contextIsCurrent = () => (
    isCurrentRoundContext(roundContext) && state.roundData === roundData
  );
  if (!contextIsCurrent()) return;
  const selectionReady = roundData.selectionReady || {};
  if (state.playerIndex === 0 && selectionReady[state.uid] && selectionReady[state.opponentUid]
      && !Number.isFinite(Number(roundData.selectionStartedAt))) {
    startSharedSelectionClock().catch(handleRecoverableError);
  }
  const selectionStartedAt = Number(roundData.selectionStartedAt);
  if (Number.isFinite(selectionStartedAt) && selectionStartedAt > 0 && state.screen === "select") {
    startSelectionTimer(selectionStartedAt);
  }
  const picks = roundData.picks || {};
  if (picks[state.uid]?.ready && picks[state.opponentUid]?.ready
      && !state.sentImageRounds.has(state.round) && !state.imageTransferError) {
    await sendSelectedImage();
    if (!contextIsCurrent()) return;
  }
  const received = roundData.imagesReceived || {};
  if (received[state.opponentUid] && state.imageAckRound === state.round) {
    clearImageAckWatchdog(state);
  }
  if (received[state.uid] && received[state.opponentUid] && state.remoteImages.has(state.round)
      && ["waitingPick", "waitingImage"].includes(state.screen)) {
    state.screen = "reveal";
    render();
  }
  const scores = roundData.scores || {};
  if (Number.isInteger(scores[state.uid]) && Number.isInteger(scores[state.opponentUid])) {
    resolveRound(scores);
    if (getResolvedMatchResultForRound(state.round)) {
      settleOnlineMatch(roundContext).catch((error) => {
        if (isCurrentRoundContext(roundContext)) handleRecoverableError(error);
      });
    }
  }
  const continued = roundData.continue || {};
  if (continued[state.uid] && continued[state.opponentUid]) {
    advanceAfterRound(roundContext);
  }
}

async function sendSelectedImage() {
  const item = getSelectedItem();
  if (!item?.blob || !state.channel || state.channel.readyState !== "open") return;
  const expectedState = state;
  const channel = state.channel;
  const round = state.round;
  const signature = item.id === state.signatureCardId;
  const finishLine = state.finishLine;
  clearImageAckWatchdog(expectedState);
  state.sentImageRounds.add(round);
  state.screen = "waitingImage";
  state.transferProgress = 0;
  state.imageTransferError = "";
  render();
  try {
    await queueOutgoingDataTransfer(expectedState, async () => {
      if (state.channel !== channel || channel.readyState !== "open" || state.round !== round) {
        throw new Error("画像送信前にP2P接続またはラウンドが切り替わりました。");
      }
      const buffer = await item.blob.arrayBuffer();
      if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || buffer.byteLength > MAX_IMAGE_TRANSFER_BYTES) {
        throw new Error("送信画像のサイズが不正です。");
      }
      const mime = verifiedOnlineImageMime(buffer);
      let started = false;
      try {
        channel.send(JSON.stringify({
          type: "image-start",
          round,
          size: buffer.byteLength,
          mime,
          signature,
          finishLine,
        }));
        started = true;
        for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
          await waitForDataBuffer(channel);
          channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
          if (state === expectedState && state.round === round) {
            state.transferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
            updateTransferText();
          }
        }
        channel.send(JSON.stringify({ type: "image-end", round }));
        startImageAckWatchdog(expectedState, round);
      } catch (error) {
        if (started && channel.readyState === "open") {
          try {
            channel.send(JSON.stringify({ type: "image-cancel", round }));
          } catch {
            // The original transfer error is more useful than a best-effort cancel failure.
          }
        }
        throw error;
      }
    });
  } catch (error) {
    if (state === expectedState) {
      clearImageAckWatchdog(expectedState);
      state.sentImageRounds.delete(round);
      state.transferProgress = 0;
      state.imageTransferError = error?.message || "画像を送信できませんでした。";
      if (state.screen === "waitingImage") render();
    }
    throw error;
  }
}

function clearImageAckWatchdog(targetState) {
  if (targetState.imageAckTimer) window.clearTimeout(targetState.imageAckTimer);
  targetState.imageAckTimer = null;
  targetState.imageAckRound = 0;
}

function startImageAckWatchdog(expectedState, round) {
  clearImageAckWatchdog(expectedState);
  expectedState.imageAckRound = round;
  expectedState.imageAckTimer = window.setTimeout(() => {
    expectedState.imageAckTimer = null;
    expectedState.imageAckRound = 0;
    if (state !== expectedState || state.round !== round || state.screen !== "waitingImage") return;
    const received = state.roundData.imagesReceived || {};
    if (received[state.opponentUid]) return;
    state.sentImageRounds.delete(round);
    state.transferProgress = 0;
    state.imageTransferError = "相手側の受信完了を確認できませんでした。";
    render();
  }, IMAGE_ACK_WAIT_MS);
}

function waitForDataBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("画像転送中にP2P接続が切れました。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", handleLow);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleClose);
      if (error) reject(error);
      else resolve();
    };
    const handleLow = () => finish();
    const handleClose = () => finish(new Error("画像転送中にP2P接続が切れました。"));
    const timer = window.setTimeout(() => finish(new Error("画像転送が混み合っています。もう一度お試しください。")), DATA_BUFFER_WAIT_MS);
    channel.addEventListener("bufferedamountlow", handleLow, { once: true });
    channel.addEventListener("close", handleClose, { once: true });
    channel.addEventListener("error", handleClose, { once: true });
    if (channel.readyState !== "open") finish(new Error("画像転送中にP2P接続が切れました。"));
    else if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) finish();
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
  if (isMatchOver()) preserveResolvedFinishFromP2pRecovery(state);
  const pendingFinishReply = state.pendingFinishReplies.get(state.round) || null;
  state.pendingFinishReplies.delete(state.round);
  state.screen = "result";
  render();
  const topScore = Math.max(scorePlayerOne, scorePlayerTwo);
  if (topScore >= 8) window.HariaiAudio?.playResult(topScore);
  if (lethal) {
    triggerFinishCutIn(finish);
    if (pendingFinishReply) {
      handleRemoteFinishReply(
        pendingFinishReply.message || pendingFinishReply,
        state,
        pendingFinishReply.channel || state.channel,
      );
    }
  } else if (topScore >= 8) {
    triggerCriticalFx(topScore === 10 ? "PERFECT!!" : "CRITICAL!");
  }
}

async function continueRound() {
  const expectedState = state;
  const roundContext = captureOnlineRoundContext(
    captureOnlineRoomContext(expectedState),
    expectedState.round,
  );
  state.screen = "waitingContinue";
  render();
  const continueWrite = set(ref(
    database,
    `online/rooms/${expectedState.roomId}/rounds/${expectedState.round}/continue/${expectedState.uid}`,
  ), true);
  if (isMatchOver()) {
    continueWrite.catch(() => {});
    try {
      await finishOnlineMatch(roundContext);
    } catch (error) {
      if (isCurrentRoundContext(roundContext) && state.screen === "waitingContinue") {
        state.screen = "result";
        render();
      }
      throw error;
    }
    return;
  }
  await continueWrite;
}

function advanceAfterRound(roundContext) {
  if (!isCurrentRoundContext(roundContext)) return;
  if (state.continuedRounds.has(state.round) || !state.processedRounds.has(state.round)) return;
  state.continuedRounds.add(state.round);
  if (isMatchOver()) {
    finishOnlineMatch(roundContext).catch((error) => {
      if (isCurrentRoundContext(roundContext)) handleRecoverableError(error);
    });
    return;
  }
  clearImageAckWatchdog(state);
  resetSelectionTimerState();
  releaseRemoteImage(state.round);
  state.round += 1;
  state.selectedCardId = "";
  state.selectedScore = null;
  state.roundData = {};
  state.transferProgress = 0;
  state.screen = "select";
  listenToRound(roundContext.roomContext);
  render();
  announceSelectionReady().catch(handleRecoverableError);
}

function isMatchOver() {
  return state.players.some((player) => player.hp <= 0) || state.round >= MAX_ROUNDS;
}

function determineOutcome(targetState = state) {
  const [first, second] = targetState.players;
  if (first.hp !== second.hp) return { winnerIndex: first.hp > second.hp ? 0 : 1, reason: first.hp <= 0 || second.hp <= 0 ? "hp" : "rounds" };
  if (first.totalReceived !== second.totalReceived) return { winnerIndex: first.totalReceived > second.totalReceived ? 0 : 1, reason: "rounds" };
  if (first.criticals !== second.criticals) return { winnerIndex: first.criticals > second.criticals ? 0 : 1, reason: "rounds" };
  if (first.perfects !== second.perfects) return { winnerIndex: first.perfects > second.perfects ? 0 : 1, reason: "rounds" };
  return { winnerIndex: null, reason: "draw" };
}

async function ensureOnlineResultClaim(targetState, outcome, roundContext) {
  if (!isCurrentRoundContext(roundContext)) return false;
  if (targetState.resultClaimCommitted) return true;
  const claimOutcome = outcome.winnerIndex === null
    ? "draw"
    : outcome.winnerIndex === targetState.playerIndex
      ? "win"
      : "loss";
  const roomPath = `online/rooms/${roundContext.roomContext.roomId}`;
  const claim = {
    outcome: claimOutcome,
    round: roundContext.expectedRound,
    createdAt: serverNow(),
  };
  let writeError = null;
  try {
    await update(ref(database, roomPath), {
      [`resultClaims/${roundContext.roomContext.ownUid}`]: claim,
      [`finished/${roundContext.roomContext.ownUid}`]: true,
    });
  } catch (error) {
    writeError = error;
  }
  if (writeError) {
    try {
      const snapshot = await get(ref(database, roomPath));
      const room = snapshot.val();
      const storedClaim = room?.resultClaims?.[roundContext.roomContext.ownUid];
      const storedFinished = room?.finished?.[roundContext.roomContext.ownUid];
      const storedRound = storedClaim?.round;
      if (storedClaim?.outcome !== claimOutcome
          || (storedRound !== undefined
            && storedRound !== null
            && Number(storedRound) !== roundContext.expectedRound)
          || storedFinished !== true) {
        throw writeError;
      }
    } catch (verificationError) {
      if (verificationError === writeError) throw writeError;
      throw writeError;
    }
  }
  targetState.resultClaimCommitted = true;
  return isCurrentRoundContext(roundContext);
}

async function settleOnlineMatch(roundContext) {
  if (!isCurrentRoundContext(roundContext)) return;
  const expectedState = state;
  if (expectedState.outcome) return true;
  if (expectedState.matchFinalizationPromise) {
    return expectedState.matchFinalizationPromise;
  }
  const finalizationPromise = (async () => {
    const outcome = determineOutcome(expectedState);
    const claimCommitted = await ensureOnlineResultClaim(expectedState, outcome, roundContext);
    if (!claimCommitted || !isCurrentRoundContext(roundContext)) return false;
    const statsCommitted = await commitOnlineStats(expectedState, outcome, roundContext);
    if (!statsCommitted || !isCurrentRoundContext(roundContext)) return false;
    expectedState.outcome = outcome;
    return true;
  })();
  expectedState.matchFinalizationPromise = finalizationPromise;
  try {
    return await finalizationPromise;
  } finally {
    if (expectedState.matchFinalizationPromise === finalizationPromise) {
      expectedState.matchFinalizationPromise = null;
    }
  }
}

async function finishOnlineMatch(roundContext) {
  if (!isCurrentRoundContext(roundContext)) return;
  const expectedState = state;
  const settled = await settleOnlineMatch(roundContext);
  if (!settled || !isCurrentRoundContext(roundContext)) return;
  expectedState.screen = "gameover";
  render();
}

function calculateRating(currentRating, opponentRating, actualScore) {
  const expectedScore = 1 / (1 + (10 ** ((opponentRating - currentRating) / 400)));
  return Math.min(3000, Math.max(100, Math.round(currentRating + RATING_K_FACTOR * (actualScore - expectedScore))));
}

async function commitOnlineStats(targetState, outcome, roundContext) {
  if (!isCurrentRoundContext(roundContext)) return false;
  if (targetState.statsCommitted) return true;
  if (targetState.statsCommitInFlight) return false;
  targetState.statsCommitInFlight = true;
  const myWon = outcome.winnerIndex === targetState.playerIndex;
  const draw = outcome.winnerIndex === null;
  const periodOutcome = draw ? "draw" : myWon ? "win" : "loss";
  const opponent = targetState.players[targetState.playerIndex === 0 ? 1 : 0];
  const opponentRating = Number(opponent?.rating || INITIAL_RATING);
  const actualScore = draw ? 0.5 : myWon ? 1 : 0;
  const soloSeed = { ...targetState.profile };
  try {
    const overallResult = await recordOverallResult({
      mode: "solo",
      outcome: periodOutcome,
      name: targetState.name,
      opponentRating,
      soloSeed,
      roomId: targetState.roomId,
      sourceState: targetState,
      deferPublicSync: true,
    });
    const resultToken = String(overallResult?.resultToken || "");
    if (!/^[a-f0-9]{40}$/.test(resultToken)) return false;
    if (!isCurrentRoundContext(roundContext)) return false;
    if (overallResult?.profileProjectionMode === "server-v2") {
      applyServerSoloProjectionProfiles(targetState, overallResult);
      if (overallResult.profileProjectionPending === true) {
        showToast("対戦結果は確定しました。表示戦績はサーバーで再同期中です。");
      }
    } else {
      const result = await runTransaction(ref(database, `online/profiles/${targetState.uid}`), (current) => {
        if (current?.appliedResults?.[resultToken] === periodOutcome) {
          return undefined;
        }
        const record = {
          name: targetState.name,
          pursuitLine: normalizePursuitLine(targetState.pursuitLine),
          wins: Number(current?.wins || 0),
          losses: Number(current?.losses || 0),
          draws: Number(current?.draws || 0),
          streak: Number(current?.streak || 0),
          bestStreak: Number(current?.bestStreak || 0),
          rating: Number(current?.rating || INITIAL_RATING),
          updatedAt: Date.now(),
          lastResultRoomId: targetState.roomId,
          lastResultOutcome: periodOutcome,
          appliedResults: {
            ...(current?.appliedResults && typeof current.appliedResults === "object"
              ? current.appliedResults
              : {}),
            [resultToken]: periodOutcome,
          },
        };
        if (typeof current?.serverProjectionReceipts === "string"
            && current.serverProjectionReceipts.length <= 800) {
          record.serverProjectionReceipts = current.serverProjectionReceipts;
        }
        if (Number.isSafeInteger(current?.serverProjectionSequence)
            && current.serverProjectionSequence > 0) {
          record.serverProjectionSequence = current.serverProjectionSequence;
        }
        if (draw) record.draws += 1;
        else if (myWon) { record.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
        else { record.losses += 1; record.streak = 0; }
        record.rating = calculateRating(record.rating, opponentRating, actualScore);
        return record;
      });
      const savedProfile = result.snapshot.val();
      if (savedProfile?.appliedResults?.[resultToken] !== periodOutcome) return false;
      targetState.profile = savedProfile;
    }
    targetState.statsCommitted = true;
    if (!isCurrentRoundContext(roundContext)) return false;
    targetState.players.forEach((player, index) => {
      if (draw) return;
      player.streak = outcome.winnerIndex === index ? Number(player.streak || 0) + 1 : 0;
    });
    return true;
  } finally {
    targetState.statsCommitInFlight = false;
  }
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
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const media = winnerIsLocal ? getSelectedItem() : state.remoteImages.get(state.round);
  const receivedLine = winnerIsLocal
    ? normalizeReceivedFinishLine(state.finishLine)
    : normalizeReceivedFinishLine(media?.finishLine);
  const customOpponentLine = !winnerIsLocal && receivedLine && !FINISH_LINES.includes(receivedLine);
  const finishLineReplaced = Boolean(customOpponentLine && !state.showOpponentCustomFinish);
  return {
    round: state.round,
    winnerIndex,
    loserIndex,
    winnerName: String(state.players[winnerIndex]?.name || "PLAYER").slice(0, 16),
    loserName: String(state.players[loserIndex]?.name || "PLAYER").slice(0, 16),
    imageUrl: String(media?.url || ""),
    signature: winnerIsLocal ? media?.id === state.signatureCardId : media?.signature === true,
    finishLine: finishLineReplaced ? FINISH_LINES[0] : receivedLine,
    finishLineReplaced,
    replyAcknowledged: false,
    replyLine: "",
    replySkipped: false,
    replyLineReplaced: false,
    replyDeliveryPending: false,
    replyDeliveryFailed: false,
    replyId: "",
  };
}

function getLethalResultForRound(round, targetState = state) {
  const result = targetState.history.at(-1);
  return result?.lethal && result.round === round ? result : null;
}

function getResolvedMatchResultForRound(round, targetState = state) {
  const result = targetState.history.at(-1);
  return result?.round === round && (result.lethal || round >= MAX_ROUNDS)
    ? result
    : null;
}

function preserveResolvedFinishFromP2pRecovery(targetState = state, {
  notify = false,
} = {}) {
  if (!getResolvedMatchResultForRound(targetState.round, targetState)) return false;
  clearP2pRecoveryTimer(targetState);
  targetState.p2pRestartIce = null;
  targetState.p2pRecovery = null;
  targetState.p2pGenerationToken = null;
  if (notify
      && state === targetState
      && !targetState.finishConnectionLossNotified) {
    targetState.finishConnectionLossNotified = true;
    showToast("P2P接続は切れましたが、確定済みの決着結果は保持しています。");
  }
  queueResolvedMatchSettlement(targetState);
  return true;
}

function roundScoresAreComplete(scores, targetState = state) {
  return Number.isInteger(scores?.[targetState.uid])
    && Number.isInteger(scores?.[targetState.opponentUid]);
}

function queueResolvedMatchSettlement(targetState = state) {
  if (state !== targetState || targetState.outcome || !targetState.roomId) return;
  const roundContext = captureOnlineRoundContext(
    captureOnlineRoomContext(targetState),
    targetState.round,
  );
  settleOnlineMatch(roundContext).catch((error) => {
    if (isCurrentRoundContext(roundContext)) handleRecoverableError(error);
  });
}

async function preserveResolvedMatchBeforeP2pCleanup(targetState = state) {
  if (preserveResolvedFinishFromP2pRecovery(targetState)) return true;
  if (state !== targetState || !targetState.roomId) return false;
  let scores = targetState.roundData?.scores || {};
  if (!roundScoresAreComplete(scores, targetState)) {
    try {
      const snapshot = await get(ref(
        database,
        `online/rooms/${targetState.roomId}/rounds/${targetState.round}/scores`,
      ));
      if (state !== targetState) return false;
      scores = snapshot.val() || {};
    } catch {
      return false;
    }
  }
  if (!roundScoresAreComplete(scores, targetState)) return false;
  resolveRound(scores);
  if (!preserveResolvedFinishFromP2pRecovery(targetState)) return false;
  return true;
}

function restoreFinishCutInFocus() {
  window.requestAnimationFrame(() => {
    if (finishCutInDialog?.open) return;
    const target = state.screen === "result"
      ? document.querySelector("#onlineContinue")
      : appRoot;
    target?.focus({ preventScroll: true });
  });
}

function clearFinishCutIn({ restoreFocus = true } = {}) {
  finishCutInGeneration += 1;
  if (state.finishCutInTimer) window.clearTimeout(state.finishCutInTimer);
  state.finishCutInTimer = null;
  if (finishCutInDialog?.open) finishCutInDialog.close();
  finishCutInContent?.replaceChildren();
  if (finishCutInContent) delete finishCutInContent.dataset.round;
  if (restoreFocus) restoreFinishCutInFocus();
}

function scheduleFinishCutInClose(generation, delayMs) {
  if (state.finishCutInTimer) window.clearTimeout(state.finishCutInTimer);
  state.finishCutInTimer = window.setTimeout(() => {
    if (generation === finishCutInGeneration) clearFinishCutIn();
  }, delayMs);
}

function applyFinishReplyToResult(result, {
  line,
  name,
  skipped = false,
  lineReplaced = false,
  deliveryStatus = "delivered",
  replyId = "",
} = {}) {
  if (!result?.finish || result.finish.replyAcknowledged) return false;
  result.finish.replyAcknowledged = true;
  result.finish.replyLine = skipped ? "" : normalizeReceivedFinishReplyLine(line);
  result.finish.replyName = String(name || result.finish.loserName || "PLAYER").slice(0, 16);
  result.finish.replySkipped = skipped === true;
  result.finish.replyLineReplaced = !skipped && lineReplaced === true;
  result.finish.replyDeliveryStatus = deliveryStatus;
  result.finish.replyDeliveryPending = deliveryStatus === "pending";
  result.finish.replyDeliveryFailed = deliveryStatus === "not-sent";
  result.finish.replyId = FINISH_REPLY_ID_PATTERN.test(replyId) ? replyId : "";
  return true;
}

function updateFinishReplyDelivery(result, status, targetState = state) {
  if (!result?.finish?.replyAcknowledged
      || !["pending", "unconfirmed", "delivered", "not-sent"].includes(status)) return false;
  result.finish.replyDeliveryStatus = status;
  result.finish.replyDeliveryPending = status === "pending";
  result.finish.replyDeliveryFailed = status === "not-sent";
  if (state === targetState && targetState.history.includes(result)) {
    syncFinishReplySlot(result);
    completeFinishReplyPresentation(result.finish);
  }
  return true;
}

function completeFinishReplyPresentation(payload) {
  if (!finishCutInContent || finishCutInContent.dataset.round !== String(payload.round)) return;
  const cutIn = finishCutInContent.querySelector(".finish-cutin");
  const panel = finishCutInContent.querySelector(".finish-reply-panel");
  if (!cutIn || !panel) return;
  const focusWasInsidePanel = panel.contains(document.activeElement);
  panel.classList.add("is-acknowledged");
  const deliveryPending = payload.replyDeliveryStatus === "pending";
  const deliveryUnconfirmed = payload.replyDeliveryStatus === "unconfirmed";
  const deliveryNotSent = payload.replyDeliveryStatus === "not-sent"
    || payload.replyDeliveryFailed === true;
  panel.classList.toggle("is-delivery-failed", deliveryNotSent || deliveryUnconfirmed);
  const heading = document.createElement("span");
  heading.className = "finish-reply-heading";
  heading.textContent = deliveryPending
    ? "REPLY SENDING"
    : deliveryUnconfirmed
      ? "REPLY UNCONFIRMED"
      : deliveryNotSent
        ? "REPLY NOT SENT"
        : payload.replySkipped
      ? "REPLY CLOSED"
      : "DECISION REPLY";
  const replyName = document.createElement("strong");
  replyName.className = "finish-reply-name";
  replyName.textContent = payload.replyName || payload.loserName;
  const reply = payload.replyLine
      && !payload.replySkipped
      && !deliveryPending
      && !deliveryUnconfirmed
      && !deliveryNotSent
    ? document.createElement("blockquote")
    : document.createElement("p");
  reply.className = "finish-reply-line";
  reply.textContent = deliveryPending
    ? "相手側の受信確認を待っています…"
    : deliveryUnconfirmed
      ? "相手側の受信確認が届かなかったため、届いた扱いにはしていません。"
      : deliveryNotSent
        ? "P2P接続が切れているため、相手へは届いていません。"
        : payload.replySkipped
      ? "返礼せず結果へ進みました。"
      : payload.replyLine || "静かに決着を受け入れました。";
  const seal = document.createElement("span");
  seal.className = "finish-reply-seal";
  seal.textContent = deliveryPending
    ? "確認中"
    : deliveryUnconfirmed
      ? "未確認"
      : deliveryNotSent
        ? "未送信"
        : payload.replySkipped
      ? "終了"
      : payload.signature ? "返礼" : "勝負あり";
  const disclosure = payload.replyLineReplaced
    ? document.createElement("small")
    : null;
  if (disclosure) {
    disclosure.className = "finish-reply-disclosure";
    disclosure.textContent = "自由記述は表示設定により、口調セットの定型文へ置き換えています。";
  }
  panel.replaceChildren(heading, replyName, reply, ...(disclosure ? [disclosure] : []), seal);
  cutIn.classList.add("has-reply");
  const skip = finishCutInContent.querySelector(".finish-cutin-skip");
  if (skip) skip.textContent = "結果を見る";
  if (focusWasInsidePanel) skip?.focus({ preventScroll: true });
  scheduleFinishCutInClose(
    finishCutInGeneration,
    deliveryPending
      ? FINISH_REPLY_ACK_TIMEOUT_MS + FINISH_REPLY_SETTLE_DURATION_MS
      : FINISH_REPLY_SETTLE_DURATION_MS,
  );
}

function settlePendingFinishReplyAck(targetState, tracker, status) {
  if (!tracker
      || targetState.pendingFinishReplyAcks.get(tracker.replyId) !== tracker
      || !["unconfirmed", "delivered"].includes(status)) return false;
  if (tracker.timeoutId) window.clearTimeout(tracker.timeoutId);
  tracker.timeoutId = null;
  tracker.status = status;
  if (status === "delivered") targetState.pendingFinishReplyAcks.delete(tracker.replyId);
  return updateFinishReplyDelivery(tracker.result, status, targetState);
}

function clearPendingFinishReplyAcks(targetState = state) {
  targetState.pendingFinishReplyAcks.forEach((tracker) => {
    if (tracker.timeoutId) window.clearTimeout(tracker.timeoutId);
  });
  targetState.pendingFinishReplyAcks.clear();
}

function markPendingFinishReplyAcksUnconfirmed(targetState, channel) {
  targetState.pendingFinishReplyAcks.forEach((tracker) => {
    if (tracker.channel === channel && tracker.status === "pending") {
      settlePendingFinishReplyAck(targetState, tracker, "unconfirmed");
    }
  });
}

function sendLocalFinishReply(targetState, result, payload, { replyLine, skipped }) {
  const channel = targetState.channel;
  if (state !== targetState || channel?.readyState !== "open") return "not-sent";
  const replyId = createOnlineSessionToken(window.crypto);
  const tracker = {
    replyId,
    roomId: targetState.roomId,
    round: payload.round,
    fromUid: targetState.uid,
    toUid: targetState.opponentUid,
    channel,
    result,
    status: "pending",
    timeoutId: null,
  };
  targetState.pendingFinishReplyAcks.set(replyId, tracker);
  tracker.timeoutId = window.setTimeout(() => {
    settlePendingFinishReplyAck(targetState, tracker, "unconfirmed");
  }, FINISH_REPLY_ACK_TIMEOUT_MS);
  try {
    channel.send(JSON.stringify({
      type: "finish-reply",
      finishReplyVersion: FINISH_REPLY_PROTOCOL_VERSION,
      replyId,
      roomId: tracker.roomId,
      round: tracker.round,
      fromUid: tracker.fromUid,
      toUid: tracker.toUid,
      replyLine,
      skipped: skipped === true,
      voiceSetId: normalizeRoleplayVoiceSetId(targetState.roleplayVoiceFallbackId),
    }));
    result.finish.replyId = replyId;
    return "pending";
  } catch {
    if (tracker.timeoutId) window.clearTimeout(tracker.timeoutId);
    targetState.pendingFinishReplyAcks.delete(replyId);
    return "not-sent";
  }
}

function acknowledgeLocalFinishReply(payload, {
  skipped = false,
  present = true,
} = {}) {
  const targetState = state;
  const result = getLethalResultForRound(payload.round, targetState);
  if (!result
      || result.loserIndex !== targetState.playerIndex
      || result.finish?.replyAcknowledged) return false;
  const replyLine = skipped ? "" : normalizeReceivedFinishReplyLine(targetState.finishReplyLine);
  const deliveryStatus = sendLocalFinishReply(
    targetState,
    result,
    payload,
    { replyLine, skipped },
  );
  if (!applyFinishReplyToResult(result, {
    line: replyLine,
    name: targetState.players[targetState.playerIndex]?.name,
    skipped,
    deliveryStatus,
    replyId: result.finish.replyId,
  })) return false;
  syncFinishReplySlot(result);
  if (deliveryStatus === "not-sent") {
    showToast("P2P接続が切れているため、返礼は相手へ届きませんでした。");
  }
  if (present) completeFinishReplyPresentation(result.finish);
  return deliveryStatus === "pending";
}

function dismissFinishCutIn(payload) {
  if (payload?.loserIndex === state.playerIndex) {
    acknowledgeLocalFinishReply(payload, { skipped: true, present: false });
  }
  clearFinishCutIn();
}

function finishReplyV2Envelope(message, targetState, expectedChannel, {
  acknowledge = false,
} = {}) {
  const v2Keys = [
    "finishReplyVersion",
    "replyId",
    "roomId",
    "fromUid",
    "toUid",
  ];
  const hasV2Field = v2Keys.some((key) => Object.hasOwn(message || {}, key));
  if (!hasV2Field) return { legacy: true, valid: !acknowledge };
  const round = Number(message?.round);
  const valid = message?.finishReplyVersion === FINISH_REPLY_PROTOCOL_VERSION
    && FINISH_REPLY_ID_PATTERN.test(String(message?.replyId || ""))
    && message?.roomId === targetState.roomId
    && message?.fromUid === targetState.opponentUid
    && message?.toUid === targetState.uid
    && Number.isInteger(round)
    && round >= 1
    && round <= MAX_ROUNDS
    && expectedChannel === targetState.channel;
  return {
    legacy: false,
    valid,
    replyId: valid ? message.replyId : "",
    round,
  };
}

function sendFinishReplyAck(message, targetState, channel) {
  if (state !== targetState || channel !== targetState.channel || channel?.readyState !== "open") return false;
  try {
    channel.send(JSON.stringify({
      type: "finish-reply-ack",
      finishReplyVersion: FINISH_REPLY_PROTOCOL_VERSION,
      replyId: message.replyId,
      roomId: targetState.roomId,
      round: Number(message.round),
      fromUid: targetState.uid,
      toUid: targetState.opponentUid,
    }));
    return true;
  } catch {
    return false;
  }
}

function handleRemoteFinishReplyAck(
  message,
  targetState = state,
  expectedChannel = targetState.channel,
) {
  const envelope = finishReplyV2Envelope(
    message,
    targetState,
    expectedChannel,
    { acknowledge: true },
  );
  if (!envelope.valid) return false;
  const tracker = targetState.pendingFinishReplyAcks.get(envelope.replyId);
  if (!tracker
      || tracker.channel !== expectedChannel
      || tracker.roomId !== targetState.roomId
      || tracker.round !== envelope.round
      || tracker.fromUid !== targetState.uid
      || tracker.toUid !== targetState.opponentUid) return false;
  return settlePendingFinishReplyAck(targetState, tracker, "delivered");
}

function handleRemoteFinishReply(
  message,
  targetState = state,
  expectedChannel = targetState.channel,
) {
  const round = Number(message?.round);
  if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS || typeof message?.replyLine !== "string") return;
  const envelope = finishReplyV2Envelope(message, targetState, expectedChannel);
  if (!envelope.valid) return;
  const replyLine = normalizeReceivedFinishReplyLine(message.replyLine);
  const skipped = message.skipped === true;
  const result = getLethalResultForRound(round, targetState);
  if (!result) {
    if (round === targetState.round) {
      const pending = targetState.pendingFinishReplies.get(round);
      if (!pending) {
        targetState.pendingFinishReplies.set(round, {
          channel: expectedChannel,
          message: {
            type: "finish-reply",
            ...(!envelope.legacy ? {
              finishReplyVersion: FINISH_REPLY_PROTOCOL_VERSION,
              replyId: envelope.replyId,
              roomId: targetState.roomId,
              fromUid: targetState.opponentUid,
              toUid: targetState.uid,
            } : {}),
            round,
            replyLine,
            skipped,
            voiceSetId: normalizeRoleplayVoiceSetId(message.voiceSetId),
          },
        });
      }
    }
    return;
  }
  if (result.winnerIndex !== targetState.playerIndex) return;
  if (result.finish?.replyAcknowledged) {
    if (envelope.replyId && result.finish.replyId === envelope.replyId) {
      sendFinishReplyAck(message, targetState, expectedChannel);
    }
    return;
  }
  const visibleReply = skipped
    ? { line: "", custom: false, replaced: false }
    : resolveVisibleFinishReplyLine(replyLine, {
      showCustom: targetState.showOpponentCustomFinish,
      voiceSetId: normalizeRoleplayVoiceSetId(message.voiceSetId),
    });
  if (!applyFinishReplyToResult(result, {
    line: visibleReply.line,
    name: targetState.players[result.loserIndex]?.name,
    skipped,
    lineReplaced: visibleReply.replaced,
    deliveryStatus: "delivered",
    replyId: envelope.replyId,
  })) return;
  if (envelope.replyId) sendFinishReplyAck(message, targetState, expectedChannel);
  if (state === targetState) {
    syncFinishReplySlot(result);
    completeFinishReplyPresentation(result.finish);
  }
}

function triggerFinishCutIn(payload) {
  if (!finishCutInDialog || !finishCutInContent || !payload) return;
  clearFinishCutIn({ restoreFocus: false });
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
    quote.className = "finish-cutin-line";
    quote.textContent = payload.finishLine;
    copy.append(quote);
    if (payload.finishLineReplaced) {
      const lineDisclosure = document.createElement("small");
      lineDisclosure.className = "finish-cutin-line-disclosure";
      lineDisclosure.textContent = "自由記述は表示設定により、定型文へ置き換えています。";
      copy.append(lineDisclosure);
    }
  }

  const replyPanel = document.createElement("section");
  replyPanel.className = "finish-reply-panel";
  replyPanel.setAttribute("aria-live", "polite");
  const localIsLoser = payload.loserIndex === state.playerIndex;
  const replyHeading = document.createElement("span");
  replyHeading.className = "finish-reply-heading";
  replyHeading.textContent = localIsLoser ? "YOUR FINISH REPLY" : "WAITING FOR REPLY";
  replyPanel.append(replyHeading);
  let replyAction = null;
  if (localIsLoser) {
    const replyPreview = state.finishReplyLine
      ? document.createElement("blockquote")
      : document.createElement("p");
    replyPreview.className = "finish-reply-line";
    replyPreview.textContent = state.finishReplyLine || "セリフを送らず、静かに決着を受け入れます。";
    replyAction = document.createElement("button");
    replyAction.type = "button";
    replyAction.className = "finish-reply-action";
    replyAction.textContent = state.finishReplyLine
      ? "この言葉で決着に応える"
      : "静かに決着を受け入れる";
    replyAction.addEventListener("click", () => acknowledgeLocalFinishReply(payload), { once: true });
    replyPanel.append(replyPreview, replyAction);
  } else {
    const waiting = document.createElement("p");
    waiting.className = "finish-reply-waiting";
    waiting.textContent = `${payload.loserName}の返礼を待っています…`;
    replyPanel.append(waiting);
  }
  copy.append(replyPanel);

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "finish-cutin-skip";
  skip.textContent = localIsLoser ? "返礼せず結果へ" : "結果へ進む";
  skip.addEventListener("click", () => dismissFinishCutIn(payload), { once: true });
  stage.append(imageFrame, copy);
  cutIn.append(stage, skip);
  finishCutInContent.replaceChildren(cutIn);
  finishCutInContent.dataset.round = String(payload.round);
  finishCutInDialog.showModal();
  (replyAction || skip).focus({ preventScroll: true });
  scheduleFinishCutInClose(generation, FINISH_CUT_IN_DURATION_MS);
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

function notifyResolvedMatchDestroyBlocked(targetState = state) {
  if (state !== targetState) return;
  showToast("決着は確定済みです。「試合結果を見る」から結果へ進んでください。");
  window.requestAnimationFrame(() => {
    document.querySelector("#onlineContinue")?.focus({ preventScroll: true });
  });
}

function openDestroyDialog() {
  const context = captureOnlineRoomContext(state);
  if (!isCurrentRoomSetupContext(context)) return;
  if (getResolvedMatchResultForRound(state.round, state)) {
    queueResolvedMatchSettlement(state);
    notifyResolvedMatchDestroyBlocked(state);
    return;
  }
  pendingDestroyContext = context;
  destroyDialog.showModal();
}

function requestHome() {
  pendingDestroyContext = null;
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (["setup", "missions", "shop", "achievements", "matching", "gameover", "engawa", "noContest", "error"].includes(state.screen)
    || state.screen === "familiarBook") {
    leaveToLanding();
  } else {
    openDestroyDialog();
  }
}

async function destroyRoom() {
  const context = pendingDestroyContext;
  pendingDestroyContext = null;
  if (!isCurrentRoomSetupContext(context)) return;
  const expectedState = context.expectedState;
  if (expectedState.destroyInFlight || expectedState.roomTerminationToken) return;
  expectedState.destroyInFlight = true;
  try {
    if (await preserveResolvedMatchBeforeP2pCleanup(expectedState)) {
      notifyResolvedMatchDestroyBlocked(expectedState);
      return;
    }
    let destroyResult;
    try {
      destroyResult = await runTransaction(
        ref(database, `online/rooms/${context.roomId}/destroyed`),
        (current) => current || { by: context.ownUid, at: Date.now() },
      );
    } catch (error) {
      if (await preserveResolvedMatchBeforeP2pCleanup(expectedState)) {
        notifyResolvedMatchDestroyBlocked(expectedState);
        return;
      }
      console.error(error);
      showToast("ルームを破棄できませんでした。通信状態を確認して、もう一度お試しください。");
      return;
    }
    if (await preserveResolvedMatchBeforeP2pCleanup(expectedState)) {
      notifyResolvedMatchDestroyBlocked(expectedState);
      return;
    }
    const marker = destroyResult.snapshot.val();
    if (marker?.by !== context.ownUid) {
      if (marker?.by === context.opponentUid) {
        await handleOpponentDestroyed(context, marker);
      } else {
        showToast("ルームの終了状態を確認できませんでした。");
      }
      return;
    }
    dispatchP2pRecoveryEvent("MANUAL_CANCELLED", expectedState);
    const terminationToken = Object.freeze({ type: "local-destroy" });
    expectedState.roomTerminationToken = terminationToken;
    const transitionToken = beginOnlineStateTransition(expectedState, "local-destroy");
    await cleanupOnlineResources(false, expectedState);
    if (expectedState.roomTerminationToken !== terminationToken
        || !isSameRoomIdentity(context)
        || !isOnlineStateTransitionCurrent(expectedState, transitionToken, state)) return;
    releaseAllImages();
    active = false;
    window.HariaiApp?.returnHome();
    showToast("ルームを破棄しました。戦績には影響しません。");
  } finally {
    expectedState.destroyInFlight = false;
  }
}

async function handleOpponentDestroyed(context, marker) {
  if (isCurrentRoomSetupContext(context)
      && marker?.by === context.opponentUid
      && await preserveResolvedMatchBeforeP2pCleanup(context.expectedState)) {
    context.expectedState.opponentOnline = false;
    preserveResolvedFinishFromP2pRecovery(context.expectedState, { notify: true });
    return;
  }
  await runOnlineOpponentDestroyedTransition({
    context,
    marker,
    isCurrent: () => isCurrentRoomSetupContext(context),
    cleanup: (targetState) => cleanupOnlineResources(false, targetState),
    isStillSameRoom: () => isSameRoomIdentity(context),
    finalize: () => {
      releaseMatchMedia();
      state.screen = "noContest";
      setOnlineChrome("NO CONTEST");
      render();
    },
  });
}

async function cancelMatching() {
  const expectedState = state;
  dispatchP2pRecoveryEvent("MANUAL_CANCELLED", expectedState);
  const transitionToken = beginOnlineStateTransition(expectedState, "cancel-matching");
  await cleanupOnlineResources(false, expectedState);
  if (!isOnlineStateTransitionCurrent(expectedState, transitionToken, state)) return;
  expectedState.screen = "setup";
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
  const expectedState = state;
  dispatchP2pRecoveryEvent("MANUAL_CANCELLED", expectedState);
  const transitionToken = beginOnlineStateTransition(expectedState, `reset:${screen}`);
  const deck = prepareDeckForRematch(expectedState.deck);
  const identity = {
    uid: expectedState.uid,
    profile: expectedState.profile,
    overallProfile: expectedState.overallProfile,
    authReady: expectedState.authReady,
    name: expectedState.name,
    pursuitLine: expectedState.pursuitLine,
    pursuitLineChoice: expectedState.pursuitLineChoice,
    customPursuitLine: expectedState.customPursuitLine,
    finishLine: expectedState.finishLine,
    finishLineChoice: expectedState.finishLineChoice,
    customFinishLine: expectedState.customFinishLine,
    finishReplyLine: expectedState.finishReplyLine,
    finishReplyChoice: expectedState.finishReplyChoice,
    customFinishReplyLine: expectedState.customFinishReplyLine,
    roleplayVoiceSetId: expectedState.roleplayVoiceSetId,
    roleplayVoiceFallbackId: expectedState.roleplayVoiceFallbackId,
    showOpponentCustomFinish: expectedState.showOpponentCustomFinish,
    imagePreference: expectedState.imagePreference,
    soloFamiliarStage: expectedState.soloFamiliarStage,
    soloFamiliarReady: expectedState.soloFamiliarReady,
    soloFamiliars: expectedState.soloFamiliars,
    soloBlockedFamiliars: expectedState.soloBlockedFamiliars,
    soloBlockedCursor: expectedState.soloBlockedCursor,
    soloBlockedDetailsOpen: expectedState.soloBlockedDetailsOpen,
    soloReunionPreference: expectedState.soloReunionPreference,
    signatureCardId: expectedState.signatureCardId,
    economy: expectedState.economy,
    economyReady: expectedState.economyReady,
    dailyPlay: expectedState.dailyPlay,
    achievements: expectedState.achievements,
    achievementsReady: expectedState.achievementsReady,
    notifiedAchievementIds: expectedState.notifiedAchievementIds,
    rankingAwards: expectedState.rankingAwards,
    rankingAwardsReady: expectedState.rankingAwardsReady,
    periodRewardReminderShown: expectedState.periodRewardReminderShown,
    titleCategoryFilter: expectedState.titleCategoryFilter,
    expandedTitleCategories: expectedState.expandedTitleCategories,
    topMessage: expectedState.topMessage,
    topMessageEntryId: expectedState.topMessageEntryId,
    topMessageReady: expectedState.topMessageReady,
    creatorCardDependenciesSettled: expectedState.creatorCardDependenciesSettled
      || (
        expectedState.authReady
        && expectedState.economyReady
        && expectedState.achievementsReady
        && expectedState.topMessageReady
      ),
    serverTimeOffset: expectedState.serverTimeOffset,
  };
  await cleanupOnlineResources(false, expectedState);
  if (!isOnlineStateTransitionCurrent(expectedState, transitionToken, state)) return false;
  releaseMatchMedia();
  state = createOnlineState();
  Object.assign(state, identity);
  state.deck = deck;
  state.screen = screen;
  setOnlineChrome("ONLINE READY");
  render();
  return true;
}

async function leaveToLanding() {
  if (isPostMatchTipBusy("solo", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  const expectedState = state;
  dispatchP2pRecoveryEvent("MANUAL_CANCELLED", expectedState);
  const transitionToken = beginOnlineStateTransition(expectedState, "leave");
  await cleanupOnlineResources(false, expectedState);
  if (!isOnlineStateTransitionCurrent(expectedState, transitionToken, state)) return;
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive, targetState = state) {
  targetState.matchmakingGeneration = ++matchmakingGenerationCounter;
  window.clearTimeout(targetState.matchTimer);
  window.clearTimeout(targetState.matchScopeTimer);
  window.clearInterval(targetState.queueHeartbeat);
  window.clearInterval(targetState.offerPollTimer);
  window.clearInterval(targetState.hostStatusPollTimer);
  window.clearInterval(targetState.soloServerMatchTimer);
  targetState.matchTimer = null;
  targetState.matchScopeTimer = null;
  targetState.matchScopeAvailable = false;
  targetState.matchScopeExpanded = false;
  targetState.queueHeartbeat = null;
  targetState.offerPollTimer = null;
  targetState.hostStatusPollTimer = null;
  targetState.soloServerMatchTimer = null;
  targetState.matchingBusy = false;
  targetState.acceptingOffer = false;
  targetState.soloServerMatchBusy = false;
  targetState.soloServerMatchErrorNotified = false;
  targetState.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  const disconnectHandles = targetState.disconnectHandles.splice(0);
  await Promise.allSettled(disconnectHandles.map((handle) => handle.cancel?.()));
  if (useOfflineMarketPreview) {
    targetState.pendingOffer = null;
    targetState.pendingIncomingOffer = null;
    return;
  }
  targetState.pendingOffer = null;
  targetState.pendingIncomingOffer = null;
}

async function cleanupOnlineResources(
  keepActive,
  targetState = state,
  { preserveP2pRecovery = false } = {},
) {
  if (targetState.cleanupPromise) {
    await targetState.cleanupPromise;
    return;
  }
  const cleanupPromise = (async () => {
    clearP2pRecoveryTimer(targetState);
    targetState.p2pRestartIce = null;
    if (!preserveP2pRecovery) {
      targetState.p2pRecovery = null;
      targetState.p2pGenerationToken = null;
    }
    if (state === targetState) clearFinishCutIn({ restoreFocus: false });
    clearPendingFinishReplyAcks(targetState);
    clearImageAckWatchdog(targetState);
    stopSelectionTimer(targetState);
    notifyEngawaDeparture(targetState);
    releaseEngawaMedia(targetState);

    targetState.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
    targetState.roundUnsubscribe?.();
    targetState.roundUnsubscribe = null;

    const peer = targetState.peer;
    const channel = targetState.channel;
    targetState.peer = null;
    targetState.channel = null;
    targetState.channelReady = false;
    if (peer) {
      peer.onicecandidate = null;
      peer.onicecandidateerror = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.ondatachannel = null;
      peer.close();
    }
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      channel.close();
    }

    const activeRoomId = targetState.roomId;
    const cancelRoomId = activeRoomId || targetState.pendingOffer?.roomId || "";
    const ownUid = targetState.uid;
    await cleanupMatchmaking(keepActive, targetState);
    await cleanupPublicPresence(targetState);
    if (activeRoomId && ownUid) {
      await set(ref(database, soloRoomPresencePath(
        activeRoomId,
        ownUid,
        targetState.clientSessionId,
      )), {
        protocolVersion: ONLINE_SESSION_PROTOCOL_VERSION,
        sessionId: targetState.clientSessionId,
        leaseToken: targetState.clientLeaseToken,
        generation: targetState.soloSessionGeneration,
        online: false,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
    if (!keepActive && cancelRoomId) {
      await cancelSoloSessionRoomOnce(cancelRoomId, targetState);
    }
    if (!keepActive) await releaseSoloSessionLease(targetState);
  })();
  targetState.cleanupPromise = cleanupPromise;
  try {
    await cleanupPromise;
  } finally {
    if (targetState.cleanupPromise === cleanupPromise) targetState.cleanupPromise = null;
  }
}

function releaseRemoteImage(round) {
  const item = state.remoteImages.get(round);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.remoteImages.delete(round);
}

function releaseEngawaRemoteImage() {
  if (state.engawaRemoteImage?.url) URL.revokeObjectURL(state.engawaRemoteImage.url);
  state.engawaRemoteImage = null;
}

function releaseEngawaMedia(targetState = state) {
  if (targetState.engawaResumeTimer) window.clearTimeout(targetState.engawaResumeTimer);
  targetState.engawaResumeTimer = null;
  targetState.engawaTransferGeneration += 1;
  if (targetState.engawaRemoteImage?.url) URL.revokeObjectURL(targetState.engawaRemoteImage.url);
  targetState.engawaRemoteImage = null;
  targetState.incomingEngawaTransfer = null;
  targetState.engawaSelectedCardId = "";
  targetState.engawaMoodId = "";
  targetState.engawaSharedCardId = "";
  targetState.engawaSharedMoodId = "";
  targetState.engawaImageSent = false;
  targetState.engawaSending = false;
  targetState.engawaTransferProgress = 0;
  targetState.engawaLocalResponse = "";
  targetState.engawaRemoteResponse = "";
  targetState.engawaErrorMessage = "";
}

function releaseMatchMedia() {
  state.remoteImages.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  state.remoteImages.clear();
  releaseEngawaMedia();
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

function cancelUnavailableAutomaticMatchmaking() {
  const expectedState = state;
  if (!active
      || expectedState.p2pAutoRequeueStartedAt <= 0
      || expectedState.p2pAutoRequeueCancelling
      || !["matching", "connecting"].includes(expectedState.screen)
      || (document.visibilityState === "visible" && navigator.onLine)) return;
  expectedState.p2pAutoRequeueCancelling = true;
  cancelMatching().catch(handleRecoverableError).finally(() => {
    if (state === expectedState) {
      expectedState.p2pAutoRequeueCancelling = false;
    }
  });
}

document.addEventListener("visibilitychange", () => {
  dispatchP2pRecoveryEvent("VISIBILITY_CHANGED", state, {
    visible: document.visibilityState === "visible",
  });
  cancelUnavailableAutomaticMatchmaking();
});

window.addEventListener("online", () => {
  dispatchP2pRecoveryEvent("NETWORK_CHANGED", state, { online: true });
});

window.addEventListener("offline", () => {
  dispatchP2pRecoveryEvent("NETWORK_CHANGED", state, { online: false });
  cancelUnavailableAutomaticMatchmaking();
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(state.soloServerMatchTimer);
  window.clearTimeout(state.soloSessionHeartbeat);
  clearP2pRecoveryTimer(state);
  releaseAllImages();
  state.peer?.close();
  soloSessionChannel?.close();
});

sampleHandicapDialog?.addEventListener("close", () => {
  const confirmed = sampleHandicapDialog.returnValue === "confirm";
  sampleHandicapDialog.returnValue = "";
  if (confirmed && active && state.screen === "setup") {
    beginMatchmaking().catch(handleRecoverableError);
  }
});

finishCutInDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  const round = Number(finishCutInContent?.dataset.round);
  const result = getLethalResultForRound(round);
  dismissFinishCutIn(result?.finish);
});

if (!useOfflineMarketPreview) watchLobbyStats();
watchDailyDateRollover();

window.HariaiOnline = {
  start,
  openDailyMissions,
  openPointShop,
  openAchievements,
  openCreatorCard,
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
  getP2pIceConfiguration: loadP2pIceServers,
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
