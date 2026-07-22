import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getDatabase,
  get,
  limitToLast,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const MAX_HP = 30;
const MAX_ROUNDS = 5;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const PURSUIT_LINE_KEY = "hariai-stadium-online-pursuit-line-v1";
const MAX_PURSUIT_LINE_LENGTH = 40;
const CUSTOM_PURSUIT_VALUE = "__custom__";
const PURSUIT_LINES = [
  "その反応、見逃さない。もう一枚いく！",
  "好みは読めた。ここからが本命だ！",
  "刺さったね？ 追撃開始！",
  "まだ終わらない。次の一枚をどうぞ！",
];
const RANKING_PUBLIC_KEY = "hariai-stadium-ranking-public-v1";
const X_HANDLE_KEY = "hariai-stadium-x-handle-v1";
const X_PUBLIC_KEY = "hariai-stadium-x-public-v1";
const RANKING_COMMENTS_ENABLED_KEY = "hariai-stadium-ranking-comments-enabled-v1";
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const RANKING_COMMENT_MAX_LENGTH = 80;
const RANKING_COMMENT_URL_PATTERN = /(?:https?:\/\/|www\.)/i;
const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"];
const DEFAULT_LEADERBOARD_PERIOD = "weekly";
const MAX_POINTS = 999_999;
const MAX_EQUIPPED_REACTIONS = 8;
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "センスいい", "もっと見たい"];
const DAILY_MISSIONS = [
  { id: "complete_match", progressKey: "matches", title: "1試合を完走", description: "ルーム破棄では進みません。", target: 1, reward: 100 },
  { id: "score_three", progressKey: "scores", title: "3回採点する", description: "相手の画像を合計3回採点します。", target: 3, reward: 60 },
  { id: "give_critical", progressKey: "criticals", title: "8点以上をつける", description: "CRITICAL評価を1回つけます。", target: 1, reward: 90 },
];
const SHOP_PRODUCTS = [
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
  { id: "title_good_praiser", type: "title", name: "ほめ上手", title: "ほめ上手", description: "相手の魅力を見つけるプレイヤー向け称号", price: 400 },
  { id: "title_plant_lover", type: "title", name: "植物愛好家", title: "植物愛好家", description: "植物画像が好きなことを伝える称号", price: 450 },
  { id: "title_animal_lover", type: "title", name: "どうぶつ派", title: "どうぶつ派", description: "動物画像が好きなことを伝える称号", price: 450 },
  { id: "title_landscape_hunter", type: "title", name: "風景ハンター", title: "風景ハンター", description: "印象的な景色を探すプレイヤー向け称号", price: 500 },
  { id: "title_image_sommelier", type: "title", name: "画像ソムリエ", title: "画像ソムリエ", description: "画像の魅力をじっくり味わう上級称号", price: 650 },
  { id: "title_hariai_master", type: "title", name: "貼り合いマスター", title: "貼り合いマスター", description: "貼り合いを遊び込んだコレクション称号", price: 900 },
  { id: "title_live_action_supremacy", type: "title", name: "実写至上主義", title: "実写至上主義", description: "写真ならではの一瞬を愛するプレイヤー向け称号", price: 500 },
  { id: "title_2d_lover", type: "title", name: "二次元愛好家", title: "二次元愛好家", description: "イラストやアニメ画像への愛を示す称号", price: 500 },
  { id: "title_mushroom_side", type: "title", name: "きのこ派", title: "きのこ派", description: "終わらないお菓子論争で、きのこを選ぶ称号", price: 400 },
  { id: "title_bamboo_side", type: "title", name: "たけのこ派", title: "たけのこ派", description: "終わらないお菓子論争で、たけのこを選ぶ称号", price: 400 },
  { id: "title_image_folder_guardian", type: "title", name: "画像フォルダの守護者", title: "画像フォルダの守護者", description: "大切な画像コレクションを見守る者の称号", price: 450 },
  { id: "title_cant_pick_five", type: "title", name: "5枚に絞れない", title: "5枚に絞れない", description: "候補画像が多すぎて毎回悩む人の称号", price: 350 },
  { id: "title_blur_connoisseur", type: "title", name: "ピンぼけ鑑定士", title: "ピンぼけ鑑定士", description: "少しくらいのぼけにも味を見つける称号", price: 400 },
  { id: "title_mostly_cats", type: "title", name: "だいたい猫", title: "だいたい猫", description: "気づけば猫画像を選んでいる人の称号", price: 450 },
  { id: "title_food_photo_alert", type: "title", name: "飯テロ警戒中", title: "飯テロ警戒中", description: "空腹時の食べ物画像に備えるための称号", price: 450 },
  { id: "title_resolution_is_justice", type: "title", name: "解像度は正義", title: "解像度は正義", description: "細部までくっきり見届けたい人の称号", price: 500 },
  { id: "title_composition_lost", type: "title", name: "構図迷子", title: "構図迷子", description: "正解を探しながら今日も画像を選ぶ称号", price: 350 },
  { id: "title_subjective_today", type: "title", name: "今日も主観", title: "今日も主観", description: "採点は主観、それも含めて楽しむ上位ネタ称号", price: 600 },
];
const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const SELECTION_TIME_LIMIT_MS = 10_000;
const SELECTION_WARNING_SECONDS = 3;
const MATCH_TIMEOUT_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PUBLIC_PRESENCE_FRESH_MS = 45_000;
const PUBLIC_PRESENCE_HEARTBEAT_MS = 20_000;
const LOBBY_REST_REFRESH_MS = 10_000;

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createOnlineState();
let lobbyPresenceEntries = {};
const LOBBY_MODES = ["solo", "strategy", "team", "royale"];
const createLobbyStats = (value = null) => Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { waiting: value, playing: value }]));
let lobbyStats = createLobbyStats();
let leaderboardEntries = [];
let leaderboardStatus = "idle";
let leaderboardPeriod = DEFAULT_LEADERBOARD_PERIOD;
let leaderboardPeriodKey = "";
let lobbyRestRequestPending = false;
let leaderboardRequestId = 0;
let lobbyStatsLoaded = false;
let publicRestServerTimeOffset = 0;

function createOnlineState() {
  const leaderboardPublic = localStorage.getItem(RANKING_PUBLIC_KEY) === "1";
  const savedXHandle = normalizeXHandle(localStorage.getItem(X_HANDLE_KEY) || "");
  const pursuitSettings = getSavedPursuitSettings();
  return {
    screen: "setup",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    authReady: false,
    ...pursuitSettings,
    deck: [],
    roomId: "",
    room: null,
    opponentUid: "",
    playerIndex: 0,
    players: [],
    round: 1,
    selectedCardId: "",
    selectedScore: null,
    remoteImages: new Map(),
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
    matchTimer: null,
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
    opponentOnline: true,
    statsCommitted: false,
    destroyedByOpponent: false,
  };
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

function jstDateKey(timestamp = Date.now()) {
  return new Date(timestamp + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function normalizeLeaderboardPeriod(value) {
  return LEADERBOARD_PERIODS.includes(value) ? value : DEFAULT_LEADERBOARD_PERIOD;
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

function leaderboardPeriodInfoFor(period = leaderboardPeriod, timestamp = Date.now() + publicRestServerTimeOffset) {
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
  };
}

function getLeaderboardPeriodInfo(period = leaderboardPeriod) {
  return leaderboardPeriodInfoFor(period);
}

function createEmptyEconomy(dateKey = jstDateKey()) {
  return {
    points: 0,
    inventory: {},
    equipped: { reactions: {}, title: "" },
    daily: { dateKey, matches: 0, scores: 0, criticals: 0, claimed: {} },
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
  const savedTitle = String(source.equipped?.title || "");
  const titleProduct = SHOP_PRODUCTS.find((product) => product.type === "title" && product.id === savedTitle && record.inventory[product.id]);
  record.equipped.title = titleProduct?.id || "";
  if (sameDate) {
    record.daily.matches = Math.min(1, Math.max(0, Math.floor(Number(source.daily.matches || 0))));
    record.daily.scores = Math.min(3, Math.max(0, Math.floor(Number(source.daily.scores || 0))));
    record.daily.criticals = Math.min(1, Math.max(0, Math.floor(Number(source.daily.criticals || 0))));
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

function getTitleProduct(titleId = state.economy.equipped?.title) {
  return SHOP_PRODUCTS.find((product) => product.type === "title" && product.id === titleId) || null;
}

function titleLabel(titleId) {
  return getTitleProduct(titleId)?.title || "";
}

function renderTitleBadge(titleId = state.economy.equipped?.title) {
  const label = titleLabel(titleId);
  return label ? `<span class="player-title-badge">◆ ${escapeHtml(label)}</span>` : "";
}

function openOnlineScreen(screen) {
  if (active) {
    if (["setup", "missions", "shop"].includes(state.screen)) {
      state.screen = screen;
      render();
    }
    return;
  }
  if (location.protocol === "file:") {
    showToast("オンライン対戦はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  active = true;
  state = createOnlineState();
  state.screen = screen;
  setOnlineChrome("CONNECTING");
  render();
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

function isActive() {
  return active;
}

function getLobbyStats() {
  return Object.fromEntries(LOBBY_MODES.map((mode) => [mode, { ...lobbyStats[mode] }]));
}

function getLeaderboard() {
  return leaderboardEntries.map((entry) => ({ ...entry }));
}

function getLeaderboardStatus() {
  return leaderboardStatus;
}

function getLeaderboardLoadedPeriod() {
  return { period: leaderboardPeriod, key: leaderboardPeriodKey };
}

async function fetchPublicDatabasePath(path, parameters = {}) {
  const databaseUrl = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
  const url = new URL(`${databaseUrl}/${path}.json`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, { cache: "no-store" });
  const serverDate = Date.parse(response.headers.get("date") || "");
  if (Number.isFinite(serverDate)) publicRestServerTimeOffset = serverDate - Date.now();
  if (!response.ok) throw new Error(`公開データの取得に失敗しました（${response.status}）`);
  return response.json();
}

function validLeaderboardEntryId(value) {
  const entryId = String(value || "");
  return /^[A-Za-z0-9_-]{16,40}$/.test(entryId) ? entryId : "";
}

async function ensureRankingCommentUser() {
  await setPersistence(auth, browserLocalPersistence);
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function authenticatedDatabaseRequest(path, { method = "GET", body } = {}) {
  const user = await ensureRankingCommentUser();
  const token = await user.getIdToken();
  const databaseUrl = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
  const url = new URL(`${databaseUrl}/${path}.json`);
  url.searchParams.set("auth", token);
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = String((await response.json())?.error || "");
    } catch {
      // FirebaseがJSON以外を返した場合は共通メッセージを使います。
    }
    if (response.status === 401 || response.status === 403 || detail.includes("Permission denied")) {
      throw new Error("このコメント操作は許可されていません。");
    }
    throw new Error(`コメント通信に失敗しました（${response.status}）`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getLeaderboardComments(targetEntryId) {
  const targetId = validLeaderboardEntryId(targetEntryId);
  if (!targetId) throw new Error("ランキング情報を確認できませんでした。");
  const records = await fetchPublicDatabasePath(`online/leaderboardComments/${targetId}`, {
    orderBy: JSON.stringify("updatedAt"),
    limitToLast: 20,
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
  const entry = await fetchPublicDatabasePath(`online/leaderboard/${entryId}`);
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
  if (!lobbyStatsLoaded) return;
  const freshAfter = Date.now() - PUBLIC_PRESENCE_FRESH_MS;
  const entries = Object.values(lobbyPresenceEntries).filter((entry) => (
    Number(entry?.lastSeen) >= freshAfter
    && LOBBY_MODES.includes(entry?.mode)
    && (entry?.state === "waiting" || entry?.state === "playing")
  ));
  lobbyStats = createLobbyStats(0);
  entries.forEach((entry) => {
    lobbyStats[entry.mode][entry.state] += 1;
  });
  const values = {
    lobbySoloWaitingCount: lobbyStats.solo.waiting,
    lobbySoloPlayingCount: lobbyStats.solo.playing,
    lobbyStrategyWaitingCount: lobbyStats.strategy.waiting,
    lobbyStrategyPlayingCount: lobbyStats.strategy.playing,
    lobbyTeamWaitingCount: lobbyStats.team.waiting,
    lobbyTeamPlayingCount: lobbyStats.team.playing,
    lobbyRoyaleWaitingCount: lobbyStats.royale.waiting,
    lobbyRoyalePlayingCount: lobbyStats.royale.playing,
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  });
}

async function refreshLobbyStatsFromRest() {
  if (lobbyRestRequestPending) return;
  lobbyRestRequestPending = true;
  try {
    lobbyPresenceEntries = await fetchPublicDatabasePath("online/publicPresence") || {};
    lobbyStatsLoaded = true;
    refreshLobbyStats();
  } catch {
    // 最初の取得に失敗した場合は「--」、取得済みなら最後の値を維持します。
  } finally {
    lobbyRestRequestPending = false;
  }
}

function startLobbyStatsPolling() {
  refreshLobbyStatsFromRest();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refreshLobbyStatsFromRest();
  }, LOBBY_REST_REFRESH_MS);
  window.setInterval(refreshLobbyStats, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshLobbyStatsFromRest();
  });
}

async function refreshLeaderboard(period = leaderboardPeriod) {
  const selectedPeriod = normalizeLeaderboardPeriod(period);
  const periodInfo = leaderboardPeriodInfoFor(selectedPeriod);
  const requestId = ++leaderboardRequestId;
  leaderboardPeriod = selectedPeriod;
  leaderboardPeriodKey = periodInfo.key;
  leaderboardEntries = [];
  leaderboardStatus = "loading";
  window.dispatchEvent(new Event("hariai-leaderboard-updated"));
  try {
    const entries = await fetchPublicDatabasePath(`online/leaderboardPeriods/${selectedPeriod}/${periodInfo.key}`, {
      orderBy: JSON.stringify("points"),
      limitToLast: 100,
    });
    if (requestId !== leaderboardRequestId) return;
    leaderboardEntries = Object.entries(entries || {})
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
      ))
      .slice(0, 50);
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
  state.authReady = true;
  try {
    await initializeEconomy();
  } catch (error) {
    console.error(error);
    state.economyReady = false;
    showToast("ポイント情報を読み込めませんでした。対戦機能は利用できます。");
  }
  setOnlineChrome("ONLINE READY");
  render();
  if (state.leaderboardPublic) syncLeaderboardEntry().catch(() => showToast("ランキング情報を更新できませんでした。"));
}

async function initializeEconomy() {
  const dateKey = currentDailyDateKey();
  const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => normalizeEconomyRecord(current, dateKey));
  if (!result.committed) throw new Error("ポイント情報を初期化できませんでした。");
  state.economy = normalizeEconomyRecord(result.snapshot.val(), dateKey);
  state.economyReady = true;
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
  const slots = Array.from({ length: MAX_ROUNDS }, (_, index) => {
    const item = state.deck[index];
    if (!item) return `<div class="deck-slot empty" aria-label="空きスロット ${index + 1}">${String(index + 1).padStart(2, "0")}</div>`;
    return `<div class="deck-slot">
      <img src="${item.url}" alt="選択画像 ${index + 1}" draggable="false" />
      <div class="deck-label"><span>ENTRY ${String(index + 1).padStart(2, "0")}</span>
        <button class="remove-card" data-online-remove="${item.id}" aria-label="画像${index + 1}を削除">×</button>
      </div>
    </div>`;
  }).join("");
  const ready = state.authReady && state.deck.length === MAX_ROUNDS && state.name.trim();
  const profile = state.profile;
  return `<section class="screen">
    <div class="section-head">
      <div><span class="eyebrow">ONLINE DECK SETUP</span><h1>オンライン対戦の準備</h1>
        <p>画像を5枚選んでから、待機中のプレイヤーとランダムに対戦します。</p></div>
      <button class="button button-ghost button-small" id="onlineBackHome">タイトルへ</button>
    </div>
    <div class="online-profile-strip">
      <span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      ${renderTitleBadge()}
      <span>RATE ${Number(profile.rating || INITIAL_RATING)}</span>
      <span>戦績 ${profile.wins}勝 ${profile.losses}敗 ${profile.draws}分</span>
      <span>🔥 ${profile.streak}連勝中 / 最高${profile.bestStreak}</span>
      <span class="point-balance-inline">◆ ${state.economyReady ? state.economy.points : "--"} PT</span>
    </div>
    <label class="ranking-optin">
      <input type="checkbox" id="rankingPublicToggle" ${state.leaderboardPublic ? "checked" : ""} ${state.authReady ? "" : "disabled"} />
      <span><strong>ランキングに参加する</strong><small>プレイヤーネーム・累積RATE・デイリー／週間／月間戦績を公開します。匿名UIDとルーム履歴は公開しません。</small></span>
    </label>
    <div class="ranking-x-settings ${state.leaderboardPublic ? "" : "is-disabled"}">
      <div class="ranking-x-heading">
        <strong>ランキング公開設定</strong>
        <small>Xリンクと、自分のランキング欄でコメントを受け付けるかを設定します。</small>
      </div>
      <div class="ranking-x-controls">
        <label class="ranking-x-handle" for="rankingXHandle"><span>@</span><input id="rankingXHandle" type="text" maxlength="15" value="${escapeHtml(state.xHandle)}" placeholder="username" autocomplete="off" autocapitalize="none" spellcheck="false" ${state.authReady && state.leaderboardPublic ? "" : "disabled"} /></label>
        <label class="ranking-x-public"><input type="checkbox" id="rankingXPublicToggle" ${state.xPublic ? "checked" : ""} ${state.authReady && state.leaderboardPublic ? "" : "disabled"} /><span>ランキングでXを公開する</span></label>
        <label class="ranking-x-public"><input type="checkbox" id="rankingCommentsEnabledToggle" ${state.rankingCommentsEnabled ? "checked" : ""} ${state.authReady && state.leaderboardPublic ? "" : "disabled"} /><span>コメントを受け付ける</span></label>
        <button class="button button-ghost button-small" id="saveRankingX" ${state.authReady && state.leaderboardPublic ? "" : "disabled"}>公開設定を保存</button>
      </div>
      <p>Xを公開すると匿名性が下がります。コメントはランキング参加者だけが1人1件、80文字以内で投稿できます。</p>
    </div>
    <div class="setup-layout">
      <aside class="setup-guide">
        <h2>オンライン画像の取り扱い</h2>
        <ol class="guide-list">
          <li><b>1</b><span>最大1600pxのWebPに変換し、EXIFなどの付随情報を除去します。</span></li>
          <li><b>2</b><span>画像はWebRTCで対戦相手へ直接送信し、Firebaseには保存しません。</span></li>
          <li><b>3</b><span>対戦終了・ルーム破棄・ページ終了時に画像参照を解放します。</span></li>
        </ol>
        <div class="privacy-note">スクリーンショットなど、相手側での保存を完全に防ぐことはできません。</div>
      </aside>
      <div class="setup-panel">
        <label class="field-label">表示名
          <input class="text-input" id="onlinePlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" />
        </label>
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
        <div class="deck-toolbar">
          <div class="deck-counter"><strong>${state.deck.length}</strong> / 5 IMAGES</div>
          <div class="upload-actions">
            <label class="button button-cyan button-small file-button">画像を追加
              <input id="onlineImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple ${state.deck.length >= MAX_ROUNDS ? "disabled" : ""} />
            </label>
            <button class="button button-ghost button-small" id="onlineFillSample">サンプル画像で埋める</button>
          </div>
        </div>
        <div class="deck-grid">${slots}</div>
        <div class="setup-actions">
          <button class="button button-primary" id="findOpponent" ${ready ? "" : "disabled"}>ランダム対戦を探す</button>
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
  const buttonLabel = claimed ? "受取済み" : complete ? `+${mission.reward} PTを受け取る` : "挑戦中";
  return `<article class="mission-card ${complete ? "is-complete" : ""} ${claimed ? "is-claimed" : ""}">
    <div class="mission-card-head"><span>${claimed ? "CLEAR" : complete ? "COMPLETE" : "DAILY"}</span><strong>+${mission.reward} PT</strong></div>
    <h2>${escapeHtml(mission.title)}</h2>${compact ? "" : `<p>${escapeHtml(mission.description)}</p>`}
    <div class="mission-progress"><i style="--mission-progress:${(progress / mission.target) * 100}%"></i></div>
    <div class="mission-card-foot"><span>${progress} / ${mission.target}</span>
      <button class="button button-small ${complete && !claimed ? "button-cyan" : "button-ghost"}" data-claim-mission="${mission.id}" ${!state.economyReady || state.economyBusy || !complete || claimed ? "disabled" : ""}>${buttonLabel}</button></div>
  </article>`;
}

function renderEconomyUnavailable() {
  return `<div class="economy-unavailable"><strong>${state.authReady ? "ポイント情報を読み込めませんでした" : "Firebaseへ接続しています…"}</strong>
    <p>${state.authReady ? "時間をおいて画面を開き直してください。対戦機能は通常どおり利用できます。" : "匿名ログイン後にミッションと所持ポイントを表示します。"}</p></div>`;
}

function renderDailyMissions() {
  const missionContent = state.economyReady
    ? `<div class="mission-grid">${DAILY_MISSIONS.map((mission) => renderMissionCard(mission)).join("")}</div>`
    : renderEconomyUnavailable();
  return `<section class="screen economy-screen">
    <div class="section-head"><div><span class="eyebrow">DAILY CHALLENGE</span><h1>デイリーミッション</h1>
      <p>毎日0:00（日本時間）に更新。達成した報酬はボタンで受け取ってください。</p></div>
      <button class="button button-ghost button-small" id="economyHomeButton">タイトルへ</button></div>
    <div class="economy-balance"><span>POINT BALANCE</span><strong>${state.economyReady ? state.economy.points.toLocaleString("ja-JP") : "--"}</strong><small>PT</small></div>
    ${missionContent}
    <div class="economy-actions"><button class="button button-primary" id="missionsShopButton">ポイントショップへ</button>
      <button class="button button-ghost" id="missionsBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">ポイントと進捗は匿名アカウントに保存されます。サイトデータを削除すると引き継げません。</p>
  </section>`;
}

function renderPointShop() {
  const equippedReactionCount = getEquippedReactionProducts().length;
  const renderProduct = (product) => {
    const owned = state.economy.inventory?.[product.id] === true;
    const affordable = state.economy.points >= product.price;
    const equipped = product.type === "reaction"
      ? state.economy.equipped?.reactions?.[product.id] === true
      : state.economy.equipped?.title === product.id;
    const equipDisabled = !equipped && product.type === "reaction" && equippedReactionCount >= MAX_EQUIPPED_REACTIONS;
    const preview = product.type === "reaction"
      ? `<button class="reaction-button shop-reaction-preview" data-preview-reaction="${escapeHtml(product.reaction)}">${escapeHtml(product.reaction)}</button>`
      : `<span class="player-title-badge shop-title-preview">◆ ${escapeHtml(product.title)}</span>`;
    const action = owned
      ? `<button class="button button-wide ${equipped ? "button-cyan" : "button-ghost"}" data-equip-product="${product.id}" ${!state.economyReady || state.economyBusy || equipDisabled ? "disabled" : ""}>${equipped ? "装備を外す" : equipDisabled ? `装備枠 ${MAX_EQUIPPED_REACTIONS}/${MAX_EQUIPPED_REACTIONS}` : "装備する"}</button>`
      : `<button class="button button-wide button-primary" data-buy-product="${product.id}" ${!state.economyReady || state.economyBusy || !affordable ? "disabled" : ""}>${affordable ? `${product.price} PTで購入` : `あと${product.price - state.economy.points} PT`}</button>`;
    return `<article class="shop-card ${owned ? "is-owned" : ""} ${equipped ? "is-equipped" : ""}">
      <div class="shop-card-top"><span>${equipped ? "EQUIPPED" : owned ? "OWNED" : product.type === "reaction" ? "CHAT REACTION" : "PLAYER TITLE"}</span><strong>${product.price} PT</strong></div>
      <h2>${escapeHtml(product.name)}</h2>${preview}
      <p>${escapeHtml(product.description)}</p>
      ${action}
    </article>`;
  };
  const reactionProducts = SHOP_PRODUCTS.filter((product) => product.type === "reaction").map(renderProduct).join("");
  const titleProducts = SHOP_PRODUCTS.filter((product) => product.type === "title").map(renderProduct).join("");
  return `<section class="screen economy-screen">
    <div class="section-head"><div><span class="eyebrow">POINT EXCHANGE</span><h1>ポイントショップ</h1>
      <p>購入したリアクションと称号を装備して、対戦中の交流をカスタマイズできます。</p></div>
      <button class="button button-ghost button-small" id="economyHomeButton">タイトルへ</button></div>
    <div class="economy-balance"><span>POINT BALANCE</span><strong>${state.economyReady ? state.economy.points.toLocaleString("ja-JP") : "--"}</strong><small>PT</small></div>
    ${state.economyReady ? `<div class="shop-loadout-summary"><span>リアクション装備 <strong>${equippedReactionCount} / ${MAX_EQUIPPED_REACTIONS}</strong></span><span>称号 <strong>${escapeHtml(getTitleProduct()?.title || "未装備")}</strong></span></div>
      <section class="shop-category"><div class="shop-category-head"><div><span>CHAT REACTION</span><h2>追加リアクション</h2></div><p>購入品から最大${MAX_EQUIPPED_REACTIONS}個を装備できます。</p></div><div class="shop-grid">${reactionProducts}</div></section>
      <section class="shop-category"><div class="shop-category-head"><div><span>PLAYER TITLE</span><h2>プレイヤー称号</h2></div><p>称号は1個だけ装備でき、プロフィールとチャットに表示されます。</p></div><div class="shop-grid">${titleProducts}</div></section>` : renderEconomyUnavailable()}
    <div class="economy-actions"><button class="button button-primary" id="shopMissionsButton">ミッションを見る</button>
      <button class="button button-ghost" id="shopBattleButton">オンライン対戦へ</button></div>
    <p class="economy-note">購入後の払い戻しはありません。商品は交流と表示のカスタマイズ専用で、採点や勝敗には影響しません。</p>
  </section>`;
}

function renderMatching() {
  return renderStatusCard({
    icon: "◎",
    eyebrow: "RANDOM MATCHING",
    title: "対戦相手を探しています",
    body: "待機中のプレイヤーからランダムにマッチングします。この画面を開いたままお待ちください。",
    details: `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 匿名ログイン済み</span>`,
    actions: `<button class="button button-ghost" id="cancelMatching">マッチングをやめる</button>`,
  });
}

function renderConnecting() {
  const opponent = getOpponent();
  return renderStatusCard({
    icon: "VS",
    eyebrow: "MATCH FOUND",
    title: `${escapeHtml(opponent?.name || "対戦相手")}とマッチング`,
    body: "画像を一時転送するためのP2P接続を準備しています。Firebaseには画像をアップロードしません。",
    details: `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>`,
    actions: `<button class="button button-danger button-small" data-online-destroy>ルーム破棄</button>`,
  });
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
  const playerHtml = (player, index) => `<div class="hud-player ${index === state.playerIndex ? "local-player" : ""}">
    <div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}${index === state.playerIndex ? "（あなた）" : ""}</span>
      ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</div>
    <div class="hp-bar" aria-label="${escapeHtml(player.name)} HP ${player.hp}/${MAX_HP}"><div class="hp-fill" style="--hp:${Math.max(0, (player.hp / MAX_HP) * 100)}%"></div></div>
    <span class="hp-value">HP ${Math.max(0, player.hp)} / ${MAX_HP}</span>
  </div>`;
  return `<div class="round-topbar">${playerHtml(state.players[0], 0)}
    <div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>
    ${playerHtml(state.players[1], 1)}</div>
    <div class="online-room-strip"><span>ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span>
      <span class="connection-pill ${state.channelReady ? "connected" : ""}">${state.channelReady ? "● P2P接続中" : "○ 再接続待ち"}</span>
      <span class="connection-pill ${state.opponentOnline ? "connected" : "warning"}">${state.opponentOnline ? "● 相手オンライン" : "○ 相手の接続切れ"}</span></div>`;
}

function renderRoundSelect() {
  const timerStarted = hasSelectionStarted();
  const remainingSeconds = Math.max(0, Math.ceil(state.selectionRemainingMs / 1000));
  const progress = Math.max(0, Math.min(100, (state.selectionRemainingMs / SELECTION_TIME_LIMIT_MS) * 100));
  const warning = timerStarted && remainingSeconds <= SELECTION_WARNING_SECONDS;
  const cards = state.deck.map((item, index) => `<button class="select-card ${item.used ? "used" : ""} ${state.selectedCardId === item.id ? "selected" : ""}"
    data-online-card="${item.id}" ${item.used || !timerStarted ? "disabled" : ""} aria-pressed="${state.selectedCardId === item.id}">
    <img src="${item.url}" alt="候補画像 ${index + 1}" draggable="false" /><span>${item.used ? "USED" : `ENTRY ${String(index + 1).padStart(2, "0")}`}</span>
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
      <p>相手の一枚について、チャットで話してみましょう。</p></div>
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
  </div></section>`;
}

function renderRoundResult() {
  const result = state.history.at(-1);
  const labelFor = (score) => score === 10 ? "PERFECT!!" : score >= 8 ? "CRITICAL!" : score >= 6 ? "GREAT" : score >= 4 ? "GOOD" : "HIT";
  const damageText = result.winnerIndex === null ? "同点。両者ノーダメージです。" : `${state.players[result.loserIndex].name}に ${result.damage} DAMAGE。`;
  const pursuitLines = renderOnlinePursuitLines(result);
  return `<section class="screen result-wrap">${renderOnlineHud()}<div class="result-card">
    <span class="eyebrow">ROUND ${state.round} RESULT</span><h1>${result.winnerIndex === null ? "DRAW ROUND" : `${escapeHtml(state.players[result.winnerIndex].name)} TAKES IT`}</h1>
    <div class="result-scores">${resultPlayerHtml(0, result.scorePlayerOne, result.winnerIndex, labelFor(result.scorePlayerOne))}
      <div class="result-vs">VS</div>${resultPlayerHtml(1, result.scorePlayerTwo, result.winnerIndex, labelFor(result.scorePlayerTwo))}</div>
    <div class="damage-callout">${escapeHtml(damageText)}</div>${pursuitLines}<div class="result-chat">${renderOnlineChat()}</div>
    <div class="button-row" style="justify-content:center"><button class="button button-danger" data-online-destroy>ルーム破棄</button>
      <button class="button button-primary" id="onlineContinue">${isMatchOver() ? "試合結果を見る" : `ROUND ${state.round + 1}へ`}</button></div>
  </div></section>`;
}

function renderOnlinePursuitLines(result) {
  const scores = [result.scorePlayerOne, result.scorePlayerTwo];
  const calls = state.players.map((player, index) => ({ player, score: scores[index] }))
    .filter(({ score }) => score >= 9)
    .map(({ player, score }) => `<article class="online-pursuit-call"><span>追撃セリフ / ${score} POINTS</span><strong>${escapeHtml(player.name)}</strong><blockquote>${escapeHtml(normalizePursuitLine(player.pursuitLine))}</blockquote></article>`)
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
  return `<section class="screen gameover-wrap"><div class="gameover-card"><div class="winner-emblem" aria-hidden="true">${outcome.winnerIndex === null ? "=" : "✦"}</div>
    <span class="eyebrow">ONLINE MATCH COMPLETE</span><h1>${title}</h1><p>${escapeHtml(subtitle)}</p>
    <div class="final-stats">${state.players.map((player, index) => `<div class="final-player ${outcome.winnerIndex === index ? "winner" : ""}">
      <h2>${escapeHtml(player.name)} ${player.streak > 0 ? `<span class="streak-badge">🔥 ${player.streak}連勝中</span>` : ""}</h2>
      <div class="stats-row"><div class="stat-box"><strong>${player.hp}</strong><span>残りHP</span></div>
      <div class="stat-box"><strong>${player.totalReceived}</strong><span>合計獲得点</span></div><div class="stat-box"><strong>${player.criticals}</strong><span>CRITICAL</span></div></div>
    </div>`).join("")}</div>
    ${state.economyReady ? `<div class="gameover-missions"><div class="gameover-missions-head"><div><span class="eyebrow">DAILY PROGRESS</span><h2>デイリーミッション</h2></div><strong>◆ ${state.economy.points} PT</strong></div>
      <div class="mission-grid compact">${DAILY_MISSIONS.map((mission) => renderMissionCard(mission, true)).join("")}</div></div>` : ""}
    <div class="gameover-actions"><button class="button button-primary" id="onlineNewMatch">別の相手を探す</button>
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
    return `<div class="chat-message ${authorIndex === 1 ? "player-two" : "player-one"}"><small>${escapeHtml(message.name)} / R${message.round}${message.titleId ? renderTitleBadge(message.titleId) : ""}</small><p>${escapeHtml(message.text)}</p></div>`;
  }).join("") : `<div class="chat-empty">画像について話してみましょう。<br />チャットはルーム内の2人だけに表示されます。</div>`;
  const reactions = [
    ...DEFAULT_REACTIONS,
    ...getEquippedReactionProducts().map((product) => product.reaction),
  ];
  return `<aside class="chat-panel"><div class="chat-head"><strong>ONLINE CHAT</strong><span>ルーム終了後に非表示</span></div>
    <div class="chat-messages" id="onlineChatMessages">${messages}</div>
    <div class="quick-reactions">${reactions.map((text) => `<button class="reaction-button" data-online-reaction="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}</div>
    <form class="chat-form" id="onlineChatForm"><input class="chat-input" id="onlineChatInput" maxlength="80" placeholder="ひとこと送る…" autocomplete="off" aria-label="チャットメッセージ" />
      <button class="button button-cyan button-small" type="submit">送信</button></form></aside>`;
}

function bindScreenEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-online-destroy]").forEach((button) => button.addEventListener("click", () => destroyDialog.showModal()));
  document.querySelectorAll("[data-claim-mission]").forEach((button) => button.addEventListener("click", () => claimDailyMission(button.dataset.claimMission)));
  document.querySelectorAll("[data-buy-product]").forEach((button) => button.addEventListener("click", () => purchaseShopProduct(button.dataset.buyProduct)));
  document.querySelectorAll("[data-equip-product]").forEach((button) => button.addEventListener("click", () => toggleShopProductEquip(button.dataset.equipProduct)));
  document.querySelectorAll("[data-preview-reaction]").forEach((button) => button.addEventListener("click", () => showToast(`チャットでは「${button.dataset.previewReaction}」と送信します。`)));
  bindChatEvents();

  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "missions" || state.screen === "shop") bindEconomyEvents();
  if (state.screen === "matching") document.querySelector("#cancelMatching")?.addEventListener("click", cancelMatching);
  if (state.screen === "select") bindSelectEvents();
  if (state.screen === "reveal") document.querySelector("#onlineBeginScoring")?.addEventListener("click", () => { state.screen = "score"; render(); });
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") document.querySelector("#onlineContinue")?.addEventListener("click", continueRound);
  if (state.screen === "gameover") {
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

function bindEconomyEvents() {
  document.querySelector("#economyHomeButton")?.addEventListener("click", leaveToLanding);
  document.querySelector("#missionsShopButton")?.addEventListener("click", () => { state.screen = "shop"; render(); });
  document.querySelector("#shopMissionsButton")?.addEventListener("click", () => { state.screen = "missions"; render(); });
  document.querySelector("#missionsBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
  document.querySelector("#shopBattleButton")?.addEventListener("click", () => { state.screen = "setup"; render(); });
}

function bindSetupEvents() {
  document.querySelector("#onlineBackHome")?.addEventListener("click", leaveToLanding);
  document.querySelector("#rankingPublicToggle")?.addEventListener("change", updateRankingPreference);
  document.querySelector("#saveRankingX")?.addEventListener("click", saveRankingXSettings);
  const nameInput = document.querySelector("#onlinePlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    const button = document.querySelector("#findOpponent");
    if (button) button.disabled = !state.authReady || state.deck.length !== MAX_ROUNDS || !state.name.trim();
  });
  bindOnlinePursuitFields();
  document.querySelector("#onlineImageInput")?.addEventListener("change", handleImageInput);
  document.querySelector("#onlineFillSample")?.addEventListener("click", fillSampleDeck);
  document.querySelectorAll("[data-online-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.onlineRemove)));
  document.querySelector("#findOpponent")?.addEventListener("click", beginMatchmaking);
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

async function updateRankingPreference(event) {
  const enabled = event.currentTarget.checked;
  const previousPublic = state.leaderboardPublic;
  const previousXPublic = state.xPublic;
  state.leaderboardPublic = enabled;
  if (!enabled) state.xPublic = false;
  localStorage.setItem(RANKING_PUBLIC_KEY, enabled ? "1" : "0");
  localStorage.setItem(X_PUBLIC_KEY, state.xPublic ? "1" : "0");
  try {
    if (enabled) {
      await syncLeaderboardEntry();
      showToast("ランキングへの参加を有効にしました。");
    } else {
      await removeLeaderboardEntry();
      showToast("ランキングから非公開にしました。");
    }
    render();
  } catch {
    state.leaderboardPublic = previousPublic;
    state.xPublic = previousXPublic;
    localStorage.setItem(RANKING_PUBLIC_KEY, state.leaderboardPublic ? "1" : "0");
    localStorage.setItem(X_PUBLIC_KEY, state.xPublic ? "1" : "0");
    render();
    showToast("ランキング設定を更新できませんでした。");
  }
}

function normalizeXHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

async function saveRankingXSettings() {
  if (!state.authReady || !state.leaderboardPublic) return;
  const input = document.querySelector("#rankingXHandle");
  const publicToggle = document.querySelector("#rankingXPublicToggle");
  const commentsToggle = document.querySelector("#rankingCommentsEnabledToggle");
  const nextHandle = normalizeXHandle(input?.value);
  const nextPublic = Boolean(publicToggle?.checked);
  const nextCommentsEnabled = Boolean(commentsToggle?.checked);
  if (nextHandle && !X_HANDLE_PATTERN.test(nextHandle)) {
    showToast("Xのユーザー名は半角英数字と_で15文字以内にしてください。");
    input?.focus();
    return;
  }
  if (nextPublic && !nextHandle) {
    showToast("公開するXのユーザー名を入力してください。");
    input?.focus();
    return;
  }

  const previousHandle = state.xHandle;
  const previousPublic = state.xPublic;
  const previousCommentsEnabled = state.rankingCommentsEnabled;
  state.xHandle = nextHandle;
  state.xPublic = nextPublic && Boolean(nextHandle);
  state.rankingCommentsEnabled = nextCommentsEnabled;
  localStorage.setItem(X_HANDLE_KEY, state.xHandle);
  localStorage.setItem(X_PUBLIC_KEY, state.xPublic ? "1" : "0");
  localStorage.setItem(RANKING_COMMENTS_ENABLED_KEY, state.rankingCommentsEnabled ? "1" : "0");
  try {
    await syncLeaderboardEntry();
    render();
    showToast("ランキングの公開設定を保存しました。");
  } catch {
    state.xHandle = previousHandle;
    state.xPublic = previousPublic;
    state.rankingCommentsEnabled = previousCommentsEnabled;
    localStorage.setItem(X_HANDLE_KEY, state.xHandle);
    localStorage.setItem(X_PUBLIC_KEY, state.xPublic ? "1" : "0");
    localStorage.setItem(RANKING_COMMENTS_ENABLED_KEY, state.rankingCommentsEnabled ? "1" : "0");
    render();
    showToast("ランキングの公開設定を更新できませんでした。");
  }
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

async function claimDailyMission(missionId) {
  const mission = DAILY_MISSIONS.find((candidate) => candidate.id === missionId);
  if (!mission || !state.economyReady || state.economyBusy) return;
  const dateKey = currentDailyDateKey();
  let outcome = "unavailable";
  state.economyBusy = true;
  render();
  try {
    const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => {
      const record = normalizeEconomyRecord(current, dateKey);
      if (record.daily.claimed[mission.id]) { outcome = "claimed"; return; }
      if (Number(record.daily[mission.progressKey] || 0) < mission.target) { outcome = "incomplete"; return; }
      record.daily.claimed[mission.id] = true;
      record.points = Math.min(MAX_POINTS, record.points + mission.reward);
      record.updatedAt = serverNow();
      outcome = "claimed-now";
      return record;
    });
    applyEconomySnapshot(result.snapshot, dateKey);
    state.economyBusy = false;
    render();
    if (result.committed && outcome === "claimed-now") showToast(`${mission.reward} PTを受け取りました。`);
    else if (outcome === "claimed") showToast("この報酬は受取済みです。");
    else showToast("ミッションはまだ達成していません。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("ミッション報酬を受け取れませんでした。");
  }
}

async function purchaseShopProduct(productId) {
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product || !state.economyReady || state.economyBusy) return;
  const dateKey = currentDailyDateKey();
  let outcome = "unavailable";
  state.economyBusy = true;
  render();
  try {
    const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => {
      const record = normalizeEconomyRecord(current, dateKey);
      if (record.inventory[product.id]) { outcome = "owned"; return; }
      if (record.points < product.price) { outcome = "short"; return; }
      record.points -= product.price;
      record.inventory[product.id] = true;
      let equippedNow = false;
      if (product.type === "reaction" && Object.keys(record.equipped.reactions).length < MAX_EQUIPPED_REACTIONS) {
        record.equipped.reactions[product.id] = true;
        equippedNow = true;
      }
      if (product.type === "title") {
        record.equipped.title = product.id;
        equippedNow = true;
      }
      record.updatedAt = serverNow();
      outcome = equippedNow ? "purchased-equipped" : "purchased";
      return record;
    });
    applyEconomySnapshot(result.snapshot, dateKey);
    state.economyBusy = false;
    render();
    if (result.committed && outcome === "purchased-equipped") showToast(`「${product.reaction || product.title}」を購入し、装備しました。`);
    else if (result.committed && outcome === "purchased") showToast(`「${product.reaction || product.title}」を購入しました。装備枠を空けると使用できます。`);
    else if (outcome === "owned") showToast("この商品は購入済みです。");
    else showToast("ポイントが不足しています。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("商品を購入できませんでした。");
  }
}

async function toggleShopProductEquip(productId) {
  const product = SHOP_PRODUCTS.find((candidate) => candidate.id === productId);
  if (!product || !state.economyReady || state.economyBusy) return;
  const dateKey = currentDailyDateKey();
  let outcome = "unavailable";
  state.economyBusy = true;
  render();
  try {
    const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => {
      const record = normalizeEconomyRecord(current, dateKey);
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
      } else if (record.equipped.title === product.id) {
        record.equipped.title = "";
        outcome = "removed";
      } else {
        record.equipped.title = product.id;
        outcome = "equipped";
      }
      record.updatedAt = serverNow();
      return record;
    });
    applyEconomySnapshot(result.snapshot, dateKey);
    state.economyBusy = false;
    render();
    if (result.committed && outcome === "equipped") showToast(`「${product.reaction || product.title}」を装備しました。`);
    else if (result.committed && outcome === "removed") showToast(`「${product.reaction || product.title}」を装備から外しました。`);
    else if (outcome === "full") showToast(`リアクションは最大${MAX_EQUIPPED_REACTIONS}個まで装備できます。`);
    else showToast("先に商品を購入してください。");
  } catch (error) {
    console.error(error);
    state.economyBusy = false;
    render();
    showToast("装備を変更できませんでした。");
  }
}

async function recordDailyProgress(changes) {
  if (!state.economyReady || !state.uid) return;
  const dateKey = currentDailyDateKey();
  const before = { ...state.economy.daily };
  const result = await runTransaction(ref(database, `online/economy/${state.uid}`), (current) => {
    const record = normalizeEconomyRecord(current, dateKey);
    record.daily.matches = Math.min(1, record.daily.matches + Math.max(0, Number(changes.matches || 0)));
    record.daily.scores = Math.min(3, record.daily.scores + Math.max(0, Number(changes.scores || 0)));
    record.daily.criticals = Math.min(1, record.daily.criticals + Math.max(0, Number(changes.criticals || 0)));
    record.updatedAt = serverNow();
    return record;
  });
  if (!result.committed) return;
  applyEconomySnapshot(result.snapshot, dateKey);
  const completed = DAILY_MISSIONS.filter((mission) => (
    Number(before[mission.progressKey] || 0) < mission.target
    && Number(state.economy.daily[mission.progressKey] || 0) >= mission.target
  ));
  if (completed.length) showToast(`デイリーミッション達成：${completed.map((mission) => mission.title).join("・")}`);
}

async function openPostMatchMissions() {
  await cleanupOnlineResources(false);
  releaseAllImages();
  state.screen = "missions";
  setOnlineChrome("ONLINE READY");
  render();
}

async function ensureLeaderboardIdentity() {
  if (state.leaderboardId) return state.leaderboardId;
  const userEntryRef = ref(database, `online/leaderboardEntriesByUser/${state.uid}`);
  const existing = await get(userEntryRef);
  if (existing.exists()) {
    state.leaderboardId = String(existing.val());
    return state.leaderboardId;
  }
  const entryId = push(ref(database, "online/leaderboard")).key;
  if (!entryId) throw new Error("ランキングIDを作成できませんでした。");
  await set(ref(database, `online/leaderboardOwners/${entryId}`), state.uid);
  await set(userEntryRef, entryId);
  state.leaderboardId = entryId;
  return entryId;
}

function leaderboardRecord() {
  const record = {
    name: state.name.trim().slice(0, 16) || "PLAYER",
    rating: Number(state.profile.rating || INITIAL_RATING),
    wins: Number(state.profile.wins || 0),
    losses: Number(state.profile.losses || 0),
    draws: Number(state.profile.draws || 0),
    streak: Number(state.profile.streak || 0),
    bestStreak: Number(state.profile.bestStreak || 0),
    commentsEnabled: Boolean(state.rankingCommentsEnabled),
    updatedAt: serverNow(),
  };
  if (state.xPublic && X_HANDLE_PATTERN.test(state.xHandle)) record.xHandle = state.xHandle;
  return record;
}

function periodLeaderboardRecord(current, outcome = null) {
  const record = {
    name: state.name.trim().slice(0, 16) || "PLAYER",
    points: 0,
    wins: Math.max(0, Math.floor(Number(current?.wins || 0))),
    losses: Math.max(0, Math.floor(Number(current?.losses || 0))),
    draws: Math.max(0, Math.floor(Number(current?.draws || 0))),
    rating: Number(state.profile.rating || INITIAL_RATING),
    commentsEnabled: Boolean(state.rankingCommentsEnabled),
    updatedAt: serverNow(),
  };
  if (outcome === "win") record.wins += 1;
  else if (outcome === "loss") record.losses += 1;
  else if (outcome === "draw") record.draws += 1;
  record.points = (record.wins * 3) + record.draws;
  if (state.xPublic && X_HANDLE_PATTERN.test(state.xHandle)) record.xHandle = state.xHandle;
  return record;
}

async function rememberLeaderboardPeriod(entryId, period, key) {
  await set(ref(database, `online/leaderboardPeriodEntriesByUser/${state.uid}/${period}/${key}`), entryId);
}

async function syncCurrentPeriodLeaderboardMetadata(entryId) {
  const timestamp = serverNow();
  await Promise.all(LEADERBOARD_PERIODS.map(async (period) => {
    const key = leaderboardPeriodKeyFor(period, timestamp);
    const result = await runTransaction(ref(database, `online/leaderboardPeriods/${period}/${key}/${entryId}`), (current) => {
      if (!current) return;
      return periodLeaderboardRecord(current);
    });
    if (result.committed) await rememberLeaderboardPeriod(entryId, period, key);
  }));
}

async function recordLeaderboardPeriodResult(outcome) {
  if (!LEADERBOARD_PERIODS.length || !["win", "loss", "draw"].includes(outcome)) return;
  const entryId = await ensureLeaderboardIdentity();
  const timestamp = serverNow();
  await Promise.all(LEADERBOARD_PERIODS.map(async (period) => {
    const key = leaderboardPeriodKeyFor(period, timestamp);
    await rememberLeaderboardPeriod(entryId, period, key);
    const result = await runTransaction(ref(database, `online/leaderboardPeriods/${period}/${key}/${entryId}`), (current) => (
      periodLeaderboardRecord(current, outcome)
    ));
    if (!result.committed) throw new Error("期間ランキングを更新できませんでした。");
  }));
}

async function syncLeaderboardEntry({ syncPeriodMetadata = true } = {}) {
  if (!state.authReady || !state.uid || !state.leaderboardPublic) return;
  const entryId = await ensureLeaderboardIdentity();
  await set(ref(database, `online/leaderboard/${entryId}`), leaderboardRecord());
  if (syncPeriodMetadata) await syncCurrentPeriodLeaderboardMetadata(entryId);
}

async function removeLeaderboardEntry() {
  if (!state.authReady || !state.uid) return;
  let entryId = state.leaderboardId;
  if (!entryId) {
    const existing = await get(ref(database, `online/leaderboardEntriesByUser/${state.uid}`));
    entryId = existing.exists() ? String(existing.val()) : "";
  }
  if (!entryId) return;
  state.leaderboardId = entryId;
  const periodIndexRef = ref(database, `online/leaderboardPeriodEntriesByUser/${state.uid}`);
  const periodIndex = await get(periodIndexRef);
  const removals = {
    [`online/leaderboard/${entryId}`]: null,
    [`online/leaderboardPeriodEntriesByUser/${state.uid}`]: null,
  };
  if (periodIndex.exists()) {
    Object.entries(periodIndex.val() || {}).forEach(([period, keys]) => {
      if (!LEADERBOARD_PERIODS.includes(period) || !keys || typeof keys !== "object") return;
      Object.entries(keys).forEach(([key, indexedEntryId]) => {
        if (String(indexedEntryId) !== entryId) return;
        removals[`online/leaderboardPeriods/${period}/${key}/${entryId}`] = null;
      });
    });
  }
  await update(ref(database), removals);
}

function removeDeckItem(id) {
  const item = state.deck.find((candidate) => candidate.id === id);
  if (item?.url) URL.revokeObjectURL(item.url);
  state.deck = state.deck.filter((candidate) => candidate.id !== id);
  state.deck.forEach((candidate, index) => { candidate.position = index; });
  render();
}

async function beginMatchmaking() {
  state.name = state.name.trim().slice(0, 16);
  if (!state.uid || state.deck.length !== MAX_ROUNDS || !state.name) return;
  state.pursuitLine = state.pursuitLineChoice === CUSTOM_PURSUIT_VALUE
    ? normalizePursuitLine(state.customPursuitLine)
    : normalizePursuitLine(state.pursuitLineChoice);
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  localStorage.setItem(PURSUIT_LINE_KEY, state.pursuitLine);
  if (state.leaderboardPublic) syncLeaderboardEntry().catch(() => showToast("ランキング情報を更新できませんでした。"));
  state.screen = "matching";
  setOnlineChrome("MATCHING");
  render();

  const ownActiveRef = ref(database, `online/active/${state.uid}`);
  const staleActive = await get(ownActiveRef);
  if (staleActive.exists()) await remove(ownActiveRef);
  const ownOffersRef = ref(database, `online/offers/${state.uid}`);
  const staleOffers = await get(ownOffersRef);
  if (staleOffers.exists()) {
    await Promise.allSettled(Object.keys(staleOffers.val()).map((roomId) => (
      remove(ref(database, `online/offers/${state.uid}/${roomId}`))
    )));
  }
  const queueEntryRef = ref(database, `online/queue/${state.uid}`);
  await set(queueEntryRef, {
    uid: state.uid,
    name: state.name,
    pursuitLine: state.pursuitLine,
    streak: Number(state.profile.streak || 0),
    rating: Number(state.profile.rating || INITIAL_RATING),
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    state: "waiting",
  });
  await startPublicPresence();
  const queueDisconnect = onDisconnect(queueEntryRef);
  await queueDisconnect.remove();
  state.disconnectHandles.push(queueDisconnect);
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

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await set(ownerRef, state.uid);
  await writePublicPresence(presenceRef, "solo", "waiting");
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = presenceDisconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (!state.publicPresenceId) return;
    writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), "solo", state.publicPresenceState).catch(() => {});
  }, PUBLIC_PRESENCE_HEARTBEAT_MS);
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

async function attemptToHost(queue) {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingOffer || state.pendingOffer) return;
  const freshAfter = Date.now() - 45_000;
  const waiting = Object.values(queue).filter((entry) => entry?.state === "waiting" && Number(entry.lastSeen) >= freshAfter && !state.activeUsers[entry.uid]);
  if (waiting.length < 2) return;
  waiting.sort((a, b) => (Number(a.joinedAt) - Number(b.joinedAt)) || String(a.uid).localeCompare(String(b.uid)));
  if (waiting[0].uid !== state.uid) return;
  const candidates = waiting.filter((entry) => entry.uid !== state.uid);
  if (!candidates.length) return;
  const candidate = candidates[Math.floor(Math.random() * candidates.length)];
  await createOffer(candidate);
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
      createdAt: Date.now(),
      status: "offered",
      [`members/${state.uid}`]: true,
      [`members/${candidate.uid}`]: true,
      [`players/${state.uid}`]: { uid: state.uid, name: state.name, pursuitLine: state.pursuitLine, streak: Number(state.profile.streak || 0), rating: Number(state.profile.rating || INITIAL_RATING) },
      [`players/${candidate.uid}`]: { uid: candidate.uid, name: candidate.name, pursuitLine: normalizePursuitLine(candidate.pursuitLine), streak: Number(candidate.streak || 0), rating: Number(candidate.rating || INITIAL_RATING) },
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
    if (!room || room.status !== "offered" || !room.members?.[state.uid]) {
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
  state.players = [room.players[room.hostUid], room.players[room.guestUid]].map((player) => ({
    ...player,
    pursuitLine: normalizePursuitLine(player.pursuitLine),
    hp: MAX_HP,
    totalReceived: 0,
    criticals: 0,
    perfects: 0,
  }));
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
    if (message.type === "image-start") {
      state.incomingTransfer = { round: message.round, mime: message.mime, size: message.size, chunks: [], received: 0 };
    } else if (message.type === "image-end") {
      await finishIncomingImage(message.round);
    }
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
  if (state.screen === "waitingImage") updateTransferText();
}

async function finishIncomingImage(round) {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.round !== round || transfer.received !== transfer.size) throw new Error("受信画像のサイズが一致しませんでした。");
  const previous = state.remoteImages.get(round);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  const blob = new Blob(transfer.chunks, { type: transfer.mime || "image/webp" });
  state.remoteImages.set(round, { blob, url: URL.createObjectURL(blob) });
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
    state.channel.send(JSON.stringify({ type: "image-start", round: state.round, size: buffer.byteLength, mime: item.blob.type || "image/webp" }));
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
  await recordDailyProgress({ scores: 1, criticals: score >= 8 ? 1 : 0 }).catch((error) => {
    console.error(error);
    showToast("ミッション進捗を更新できませんでした。");
  });
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
  getSelectedItem().used = true;
  let winnerIndex = null;
  let loserIndex = null;
  let damage = 0;
  if (scorePlayerOne > scorePlayerTwo) { winnerIndex = 0; loserIndex = 1; damage = scorePlayerOne; }
  else if (scorePlayerTwo > scorePlayerOne) { winnerIndex = 1; loserIndex = 0; damage = scorePlayerTwo; }
  if (loserIndex !== null) state.players[loserIndex].hp = Math.max(0, state.players[loserIndex].hp - damage);
  state.history.push({ round: state.round, scorePlayerOne, scorePlayerTwo, winnerIndex, loserIndex, damage });
  state.screen = "result";
  render();
  const topScore = Math.max(scorePlayerOne, scorePlayerTwo);
  if (topScore >= 8) {
    window.HariaiAudio?.playResult(topScore);
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
  state.outcome = determineOutcome();
  await commitOnlineStats();
  await recordDailyProgress({ matches: 1 }).catch((error) => {
    console.error(error);
    showToast("ミッション進捗を更新できませんでした。");
  });
  await set(ref(database, `online/rooms/${state.roomId}/finished/${state.uid}`), true);
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
  if (result.committed && state.leaderboardPublic) {
    await syncLeaderboardEntry({ syncPeriodMetadata: false }).catch(() => showToast("累積レートを更新できませんでした。"));
    const periodOutcome = draw ? "draw" : myWon ? "win" : "loss";
    await recordLeaderboardPeriodResult(periodOutcome).catch(() => showToast("期間ランキングを更新できませんでした。"));
  }
  state.players.forEach((player, index) => {
    if (draw) return;
    player.streak = state.outcome.winnerIndex === index ? Number(player.streak || 0) + 1 : 0;
  });
}

async function sendChat(value) {
  const text = String(value || "").trim().slice(0, 80);
  if (!text || !state.roomId) return;
  const message = {
    authorUid: state.uid,
    name: state.name,
    text,
    round: state.round,
    createdAt: serverTimestamp(),
  };
  const equippedTitle = getTitleProduct();
  if (equippedTitle && state.economy.inventory?.[equippedTitle.id]) message.titleId = equippedTitle.id;
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

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

function requestHome() {
  if (["setup", "missions", "shop", "matching", "gameover", "noContest", "error"].includes(state.screen)) {
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
  releaseAllImages();
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
  const identity = {
    uid: state.uid,
    profile: state.profile,
    authReady: state.authReady,
    name: state.name,
    pursuitLine: state.pursuitLine,
    pursuitLineChoice: state.pursuitLineChoice,
    customPursuitLine: state.customPursuitLine,
    economy: state.economy,
    economyReady: state.economyReady,
    serverTimeOffset: state.serverTimeOffset,
  };
  await cleanupOnlineResources(false);
  releaseAllImages();
  state = createOnlineState();
  Object.assign(state, identity);
  state.screen = "setup";
  setOnlineChrome("ONLINE READY");
  render();
}

async function leaveToLanding() {
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive) {
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.queueHeartbeat);
  window.clearInterval(state.offerPollTimer);
  window.clearInterval(state.hostStatusPollTimer);
  state.matchTimer = null;
  state.queueHeartbeat = null;
  state.offerPollTimer = null;
  state.hostStatusPollTimer = null;
  state.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  const removals = [remove(ref(database, `online/queue/${state.uid}`))];
  if (!keepActive) removals.push(remove(ref(database, `online/active/${state.uid}`)));
  if (state.pendingOffer) removals.push(remove(ref(database, `online/offers/${state.pendingOffer.targetUid}/${state.pendingOffer.roomId}`)));
  await Promise.allSettled(removals);
  state.pendingOffer = null;
  state.pendingIncomingOffer = null;
}

async function cleanupOnlineResources(keepActive) {
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

function releaseAllImages() {
  state.deck.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = "";
    item.blob = null;
  });
  state.remoteImages.forEach((item) => item.url && URL.revokeObjectURL(item.url));
  state.remoteImages.clear();
  state.chatMessages = [];
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

startLobbyStatsPolling();

window.HariaiOnline = {
  start,
  openDailyMissions,
  openPointShop,
  isActive,
  requestHome,
  destroyRoom,
  getLobbyStats,
  getLeaderboard,
  getLeaderboardStatus,
  getLeaderboardPeriodInfo,
  getLeaderboardLoadedPeriod,
  refreshLeaderboard,
  getLeaderboardComments,
  getLeaderboardCommentIdentity,
  saveLeaderboardComment,
  deleteLeaderboardComment,
};
window.dispatchEvent(new Event("hariai-online-ready"));
