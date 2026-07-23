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
  auth,
  database,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v2";
import {
  CHAT_COSMETIC_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  PLAYER_TITLE_PRODUCTS,
  getPlayerTitlePresentation,
  getPlayerTitleProduct,
} from "./player-titles.js?v=player-titles-v1";
import {
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
} from "./post-match-tip.js?v=post-match-tip-v2";

const MAIN_COUNT = 5;
const RESERVE_COUNT = 5;
const MAX_HP = 30;
const MAX_ROUNDS = 5;
const EXTRA_REQUESTS = 2;
const PURSUIT_PERMITS = 1;
const WEAKNESS_SCOUT_ROUND = 3;
const WEAKNESS_CHAIN_DAMAGE = [4, 3, 2];
const MAX_WEAKNESS_CHAIN = WEAKNESS_CHAIN_DAMAGE.length;
const WEAKNESS_MISS_DAMAGE = 5;
const MAX_AUDIO_SECONDS = 10;
const AUDIO_HIGHLIGHT_SECONDS = 3;
const MAX_AUDIO_TRANSFER_BYTES = 480 * 1024;
const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const MAX_PURSUIT_LINE_LENGTH = 40;
const CUSTOM_PURSUIT_VALUE = "__custom__";
const MATCH_TIMEOUT_MS = 20_000;
const QUEUE_FRESH_MS = 45_000;
const HEARTBEAT_MS = 20_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-strategy-name-v2";
const PROFILE_CLUES_KEY = "hariai-stadium-strategy-clues-v2";
const PROFILE_WEAKNESS_KEY = "hariai-stadium-strategy-weakness-v3";
const LEGACY_PROFILE_BLUFF_KEY = "hariai-stadium-strategy-bluff-v2";
const PURSUIT_LINE_KEY = "hariai-stadium-strategy-pursuit-line-v2";
const PURSUIT_LINES = [
  "その反応、見逃さない。もう一枚いく！",
  "好みは読めた。ここからが本命だ！",
  "刺さったね？ 追撃開始！",
  "まだ終わらない。次の一枚をどうぞ！",
];
const STRATEGY_CHAT_PROMPTS = ["それ、本命？", "今の反応、怪しい…", "どれが一番好き？", "ノーコメント！"];
const ANONYMOUS_CHAT_SCREENS = new Set(["intro", "waitingDecision", "deck", "waitingDeck"]);
const IDENTIFIED_CHAT_SCREENS = new Set([
  "identity", "waitingBattle", "baseSelect", "waitingBasePick", "waitingBaseImage", "baseReveal", "baseRating", "waitingBaseRating",
  "actionSelect", "waitingActionPick", "waitingActionImage", "actionReveal", "actionRating", "waitingActionRating", "roundResult", "waitingContinue",
  "weaknessGuess", "waitingWeaknessGuess", "weaknessChainSelect", "waitingWeaknessChain", "waitingWeaknessChainImage", "weaknessChainResult", "waitingWeaknessContinue",
]);

const app = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createState();

const shared = () => window.HariaiApp?.shared;
const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
const showToast = (message) => shared()?.showToast(message);
const setBusy = (busy, message) => shared()?.setBusy(busy, message);

function savedClues() {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_CLUES_KEY) || "[]");
    return normalizeClues(value);
  } catch {
    return ["", "", ""];
  }
}

function createState() {
  const storedWeaknessValue = localStorage.getItem(PROFILE_WEAKNESS_KEY) ?? localStorage.getItem(LEGACY_PROFILE_BLUFF_KEY);
  const storedWeakness = Number(storedWeaknessValue);
  return {
    screen: "profile",
    uid: "",
    authReady: false,
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    clues: savedClues(),
    weaknessIndex: storedWeaknessValue !== null && Number.isInteger(storedWeakness) && storedWeakness >= 0 && storedWeakness <= 2 ? storedWeakness : null,
    weaknessSalt: "",
    weaknessCommit: "",
    pursuitLine: normalizePursuitLine(localStorage.getItem(PURSUIT_LINE_KEY) || PURSUIT_LINES[0]),
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    economy: { points: 0, inventory: {}, equipped: { stamps: {}, title: "", chatFrame: "", chatBackground: "" } },
    main: [],
    reserve: [],
    roomId: "",
    roomData: {},
    opponentUid: "",
    playerIndex: 0,
    players: [],
    round: 1,
    roundData: {},
    currentResult: null,
    history: [],
    processedRounds: new Set(),
    advancedRounds: new Set(),
    localBaseCards: new Map(),
    localActionCards: new Map(),
    remoteImages: new Map(),
    remoteAvatar: null,
    avatarSent: false,
    incomingAvatarTransfer: null,
    hideOpponentAvatar: false,
    chatMessages: [],
    seenChatIds: new Set(),
    selectedBaseId: "",
    selectedScore: 0,
    selectedReaction: "normal",
    selectedWeaknessGuess: null,
    weaknessTriggerRound: 0,
    selectedWeaknessChainIds: [],
    localWeaknessChainCards: [],
    weaknessChainLocked: false,
    weaknessRevealsVerified: false,
    weaknessIntegrityFailed: false,
    weaknessChainApplied: false,
    weaknessPhaseComplete: false,
    weaknessResult: null,
    weaknessSurrenderApplied: false,
    openedMediaKeys: new Set(),
    chainPlaybackActive: false,
    sentImageKeys: new Set(),
    incomingTransfer: null,
    incomingAudioTransfer: null,
    transferProgress: 0,
    peer: null,
    channel: null,
    channelReady: false,
    peerStatus: "P2P接続を準備中…",
    pendingIce: [],
    matchingBusy: false,
    acceptingOffer: false,
    pendingIncomingOffer: null,
    pendingOffer: null,
    latestQueue: {},
    activeUsers: {},
    matchTimer: null,
    queueHeartbeat: null,
    offerPollTimer: null,
    hostStatusPollTimer: null,
    matchUnsubscribers: [],
    roomUnsubscribers: [],
    disconnectHandles: [],
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    opponentOnline: true,
    destroyedByOpponent: false,
    statsCommitted: false,
    reacting: false,
    reactAgain: false,
    errorMessage: "",
  };
}

function normalizeClues(value) {
  const source = Array.isArray(value) ? value : [value?.[0], value?.[1], value?.[2]];
  return Array.from({ length: 3 }, (_, index) => String(source[index] || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80));
}

function sanitizePursuitLineDraft(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").slice(0, MAX_PURSUIT_LINE_LENGTH);
}

function normalizePursuitLine(value) {
  const normalized = sanitizePursuitLineDraft(value).replace(/\s+/g, " ").trim();
  return normalized || PURSUIT_LINES[0];
}

function randomHex(bytes = 16) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function processStrategyAudioFile(file) {
  const processor = shared()?.processGameAudioFile;
  if (typeof processor !== "function") throw new Error("音声変換機能を読み込めませんでした。ページを再読み込みしてください。");
  return processor(file, {
    maxSeconds: MAX_AUDIO_SECONDS,
    maxOutputBytes: MAX_AUDIO_TRANSFER_BYTES,
    audioName: String(file?.name || "添付音声").slice(0, 80),
  });
}

function releaseCardAudio(item) {
  if (item?.audioUrl) URL.revokeObjectURL(item.audioUrl);
  if (!item) return;
  item.audioBlob = null;
  item.audioUrl = "";
  item.audioDuration = 0;
  item.audioCueStart = 0;
  item.audioName = "";
}

async function prepareWeaknessCommit(roomId) {
  if (!Number.isInteger(state.weaknessIndex)) throw new Error("本当の弱点を確認できませんでした。");
  state.weaknessSalt = randomHex();
  state.weaknessCommit = await sha256Hex(`${roomId}:${state.uid}:${state.weaknessIndex}:${state.weaknessSalt}`);
  return state.weaknessCommit;
}

function normalizeReaction(value, score) {
  if (value === "request" && score <= 3) return "request";
  if (value === "pursuit" && score >= 9) return "pursuit";
  return "normal";
}

async function playerRoomRecord(roomId) {
  const weaknessCommit = await prepareWeaknessCommit(roomId);
  return {
    uid: state.uid,
    name: state.name,
    clues: state.clues,
    weaknessCommit,
    pursuitLine: state.pursuitLine,
    rating: Number(state.profile.rating || INITIAL_RATING),
    streak: Number(state.profile.streak || 0),
  };
}

function runtimePlayer(source) {
  return {
    uid: String(source?.uid || ""),
    name: String(source?.name || "PLAYER").slice(0, 16),
    clues: normalizeClues(source?.clues),
    weaknessCommit: /^[a-f0-9]{64}$/.test(String(source?.weaknessCommit || "")) ? String(source.weaknessCommit) : "",
    weaknessIndex: null,
    weaknessGuess: null,
    weaknessCorrect: false,
    weaknessChainCount: 0,
    overkill: 0,
    pursuitLine: normalizePursuitLine(source?.pursuitLine),
    rating: Number(source?.rating || INITIAL_RATING),
    streak: Math.max(0, Number(source?.streak || 0)),
    mainCount: MAIN_COUNT,
    reserveCount: 0,
    reserveUsed: 0,
    hp: MAX_HP,
    extraRequests: EXTRA_REQUESTS,
    pursuitPermits: PURSUIT_PERMITS,
    totalPower: 0,
    receivedScores: [],
  };
}

function start() {
  if (active) return;
  if (useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEW中はVALUE MARKET以外のオンライン機能へ接続しません。");
    return;
  }
  if (window.HariaiOnline?.isActive?.() || window.HariaiTeam?.isActive?.() || window.HariaiRoyale?.isActive?.() || window.HariaiMarket?.isActive?.()) {
    showToast("進行中のオンライン画面を終了してから開いてください。");
    return;
  }
  if (location.protocol === "file:") {
    showToast("戦略型1on1はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  active = true;
  state = createState();
  setStrategyChrome("STRATEGY CONNECTING");
  render();
  Promise.resolve(shared()?.profileAvatar?.ready?.()).then(() => {
    if (!active || state.screen !== "profile") return;
    syncStrategyProfileDraft();
    render();
  });
  ensureAuthenticated().catch(handleFatalError);
}

function isActive() {
  return active;
}

async function ensureAuthenticated() {
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active) return;
  state.uid = credential.user.uid;
  const [profileSnapshot, economySnapshot] = await Promise.all([
    get(ref(database, `online/strategyProfiles/${state.uid}`)),
    get(ref(database, `online/economy/${state.uid}`)),
  ]);
  if (profileSnapshot.exists()) state.profile = normalizeProfile(profileSnapshot.val());
  if (economySnapshot.exists()) state.economy = normalizeChatCosmeticEconomy(economySnapshot.val());
  state.authReady = true;
  setStrategyChrome("STRATEGY READY");
  render();
}

function normalizeProfile(value) {
  return {
    wins: Math.max(0, Number(value?.wins || 0)),
    losses: Math.max(0, Number(value?.losses || 0)),
    draws: Math.max(0, Number(value?.draws || 0)),
    streak: Math.max(0, Number(value?.streak || 0)),
    bestStreak: Math.max(0, Number(value?.bestStreak || 0)),
    rating: Math.min(3000, Math.max(100, Number(value?.rating || INITIAL_RATING))),
  };
}

function normalizeChatCosmeticEconomy(value) {
  const source = value && typeof value === "object" ? value : {};
  const inventory = {};
  [...STAMP_PRODUCTS, ...PLAYER_TITLE_PRODUCTS, ...CHAT_COSMETIC_PRODUCTS].forEach((product) => {
    if (source.inventory?.[product.id] === true) inventory[product.id] = true;
  });
  const cosmetics = getEquippedChatCosmetics({ inventory, equipped: source.equipped });
  const savedTitle = String(source.equipped?.title || "");
  const title = getPlayerTitleProduct(savedTitle) && inventory[savedTitle] ? savedTitle : "";
  const stamps = normalizeEquippedStamps(source, inventory, Boolean(source.equipped && typeof source.equipped === "object"));
  return {
    points: Math.max(0, Math.floor(Number(source.points || 0))),
    inventory,
    equipped: { stamps, title, chatFrame: cosmetics.chatFrameId, chatBackground: cosmetics.chatBackgroundId },
  };
}

function renderStrategyTitleBadge(titleId) {
  const presentation = getPlayerTitlePresentation(titleId);
  return presentation
    ? `<span class="player-title-badge ${presentation.className}"><span aria-hidden="true">${escapeHtml(presentation.icon)}</span>${escapeHtml(presentation.product.title)}</span>`
    : "";
}

function setStrategyChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "P2P画像・音声転送";
  if (footerItems[0]) footerItems[0].textContent = "STRATEGY 1ON1 / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "自己紹介と進行はルーム内同期、画像・添付音声は対戦相手へ直接転送します";
}

function focusScreen() {
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  if (!active) return;
  const renderers = {
    profile: renderProfile,
    matching: renderMatching,
    connecting: renderConnecting,
    intro: renderAnonymousIntro,
    waitingDecision: renderWaitingDecision,
    deck: renderDeckBuilder,
    waitingDeck: renderWaitingDeck,
    identity: renderIdentityReveal,
    waitingBattle: renderWaitingBattle,
    baseSelect: renderBaseSelect,
    waitingBasePick: () => renderWaiting("SECRET PICK", "相手の画像選択を待っています", "両者がロックするまで画像は送信されません。"),
    waitingBaseImage: () => renderWaiting("P2P IMAGE TRANSFER", "メイン画像を転送しています", `転送状況 ${state.transferProgress}%`),
    baseReveal: renderBaseReveal,
    baseRating: renderBaseRating,
    waitingBaseRating: () => renderWaiting("PRIVATE SCORE", "相手の採点を待っています", "点数とリアクションは両者の確定後に処理されます。"),
    actionSelect: renderActionSelect,
    waitingActionPick: () => renderWaiting("RESERVE PICK", "追加画像の選択を待っています", "追加要求・追撃の選択を同期しています。"),
    waitingActionImage: () => renderWaiting("P2P RESERVE TRANSFER", "リザーブ画像を転送しています", `転送状況 ${state.transferProgress}%`),
    actionReveal: renderActionReveal,
    actionRating: renderActionRating,
    waitingActionRating: () => renderWaiting("RESERVE SCORE", "追加画像の採点を待っています", "追加画像から連鎖効果は発生しません。"),
    roundResult: renderRoundResult,
    waitingContinue: () => renderWaiting("ROUND READY", "相手の準備を待っています", "両者が進むと次のラウンドを開始します。"),
    weaknessGuess: renderWeaknessGuess,
    waitingWeaknessGuess: () => renderWaiting("WEAKNESS GUESS LOCKED", "相手の弱点回答を待っています", "両者の回答が確定するまで答えは公開されません。"),
    weaknessChainSelect: renderWeaknessChainSelect,
    waitingWeaknessChain: () => renderWaiting("WEAKNESS CHECK", "連続追撃の準備を待っています", "看破に成功したプレイヤーは残りリザーブから最大3枚を選びます。"),
    waitingWeaknessChainImage: () => renderWaiting("PURSUIT CHAIN TRANSFER", "連続追撃画像を転送しています", `転送状況 ${state.transferProgress}%`),
    weaknessChainResult: renderWeaknessChainResult,
    waitingWeaknessContinue: () => renderWaiting("WEAKNESS BREAK COMPLETE", "相手の準備を待っています", "両者が確認すると対戦を続行、または最終結果へ進みます。"),
    gameover: renderGameOver,
    withdrawn: renderWithdrawn,
    noContest: renderNoContest,
    error: renderError,
  };
  app.innerHTML = (renderers[state.screen] || renderProfile)();
  if (isStrategyChatVisible()) app.querySelector(".screen")?.insertAdjacentHTML("beforeend", renderStrategyChat());
  bindScreenEvents();
  focusScreen();
}

function renderProfile() {
  const usesCustom = !PURSUIT_LINES.includes(state.pursuitLine);
  return `<section class="screen strategy-screen">
    <div class="section-head"><div><span class="eyebrow">ONLINE STRATEGY 1ON1 / PROFILE</span><h1>秘密のプロフィール登録</h1>
      <p>弱点候補を3つ登録し、本当の弱点を1つ選びます。残り2つは相手を惑わせるブラフです。</p></div>
      <button class="button button-ghost button-small" id="strategyBackHome">タイトルへ</button></div>
    <div class="online-profile-strip"><span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      <span>STRATEGY RATE ${Number(state.profile.rating || INITIAL_RATING)}</span><span>${state.profile.wins}勝 ${state.profile.losses}敗 ${state.profile.draws}分</span></div>
    ${window.HariaiOnline?.renderOverallRankingParticipation?.({ controlId: "strategyOverallRanking" }) || ""}
    <div class="strategy-profile-layout"><aside class="setup-guide"><h2>オンライン読み合い</h2><ol class="guide-list">
      <li><b>1</b><span>本当の弱点1つとブラフ2つを登録し、相手には候補だけを表示します。</span></li>
      <li><b>2</b><span>各ラウンド後に一度だけ看破を宣言でき、成功すると最大3連続追撃、失敗すると自分に5ダメージです。</span></li>
      <li><b>3</b><span>画像には10秒までの音声を任意で添付できます。画像・音声はP2P直送でFirebaseには保存しません。</span></li>
    </ol><p class="privacy-note">試合前は弱点のハッシュだけを共有し、両者の回答確定後に答えを公開して照合します。</p></aside>
    <form class="setup-panel strategy-form" id="strategyProfileForm">
      <label class="field-label">プレイヤーネーム（デッキ確定まで画面非公開）<input class="text-input" id="strategyName" maxlength="16" autocomplete="nickname" value="${escapeHtml(state.name)}" required /></label>
      ${shared()?.profileAvatar?.renderSetting?.({ controlId: "strategyProfileAvatar", name: state.name }) || ""}
      <fieldset class="strategy-clue-fieldset"><legend>弱点候補（1つだけ本当の弱点を選択）</legend>
        ${state.clues.map((clue, index) => `<label class="strategy-clue-row"><input type="radio" name="weakness" value="${index}" ${state.weaknessIndex === index ? "checked" : ""} required />
          <span class="weakness-selector">本命</span><input class="text-input strategy-clue-input" data-clue-index="${index}" maxlength="80" autocomplete="off" placeholder="例：豚骨ラーメン" value="${escapeHtml(clue)}" required /></label>`).join("")}
      </fieldset>
      <div class="pursuit-line-settings"><label class="field-label">追撃時のセリフ<select class="text-input" id="strategyPursuitLine">
        ${PURSUIT_LINES.map((line) => `<option value="${escapeHtml(line)}" ${line === state.pursuitLine ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}
        <option value="${CUSTOM_PURSUIT_VALUE}" ${usesCustom ? "selected" : ""}>自由記述</option></select></label>
        <div class="pursuit-custom-field" id="strategyCustomPursuitField" ${usesCustom ? "" : "hidden"}><label class="field-label">自由記述（1行・最大${MAX_PURSUIT_LINE_LENGTH}文字）
          <input class="text-input" id="strategyCustomPursuitLine" maxlength="${MAX_PURSUIT_LINE_LENGTH}" autocomplete="off" value="${usesCustom ? escapeHtml(state.pursuitLine) : ""}" /></label>
          <span class="pursuit-character-count"><b id="strategyPursuitCharacterCount">${usesCustom ? state.pursuitLine.length : 0}</b> / ${MAX_PURSUIT_LINE_LENGTH}</span></div>
      </div>
      <div class="screen-actions setup-actions"><button class="button button-primary" type="submit" ${state.authReady ? "" : "disabled"}>プロフィールを封印して対戦相手を探す</button></div>
    </form></div></section>`;
}

function renderMatching() {
  return renderStatusCard("◎", "STRATEGY MATCHING", "戦略型1on1の対戦相手を探しています", "プロフィールはマッチ成立後に対戦ルームへ登録します。", `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 匿名ログイン済み</span>`, `<button class="button button-ghost" id="strategyCancelMatching">マッチングをやめる</button>`);
}

function renderConnecting() {
  return renderStatusCard("VS", "MATCH FOUND", "対戦相手とマッチングしました", "匿名自己紹介を表示する前にP2P画像・音声転送を準備しています。", `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderAnonymousIntro() {
  const opponent = getOpponent();
  return `<section class="screen strategy-screen strategy-intro-screen"><div class="strategy-anonymous-head"><span class="strategy-anonymous-icon" aria-hidden="true">?</span>
    <div><span class="eyebrow">ANONYMOUS OPPONENT</span><h1>対戦相手の弱点候補</h1><p>3つのうち1つだけが本当の弱点、残り2つはブラフです。</p></div></div>
    <div class="strategy-clue-cards">${opponent.clues.map((clue, index) => `<article><small>弱点候補 ${String(index + 1).padStart(2, "0")}</small><p>${escapeHtml(clue)}</p></article>`).join("")}</div>
    <div class="strategy-intro-actions"><button class="button button-danger" id="strategyWithdraw">この勝負から撤退</button><button class="button button-primary" id="strategyAccept">推理してデッキを組む</button></div>
    <p class="strategy-rule-note">撤退はノーコンテストとなり、相手の名前・弱点は公開されず、戦績にも影響しません。</p></section>`;
}

function renderWaitingDecision() {
  return renderStatusCard("?", "ANONYMOUS DECISION", "相手の判断を待っています", "両者が対戦を受けるとデッキ構築へ進みます。", `<span class="connection-pill connected">● あなたは対戦を承諾しました</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderDeckBuilder() {
  const opponent = getOpponent();
  return `<section class="screen strategy-screen"><div class="section-head"><div><span class="eyebrow">COUNTER DECK BUILD</span><h1>相手に刺さる10枚を選ぶ</h1>
    <p>メインは必ず5枚。各画像には10秒までの音声を任意で添付でき、弱点看破後の追撃では指定した3秒を連続再生します。</p></div><span class="strategy-step">YOU / ONLINE</span></div>
    <div class="strategy-build-layout"><aside class="strategy-scout-note"><span>SCOUTING MEMO</span><h2>匿名の対戦相手</h2>
      ${opponent.clues.map((clue, index) => `<p><b>${index + 1}</b>${escapeHtml(clue)}</p>`).join("")}<small>本当の弱点は1つ。残り2つはブラフです。</small></aside>
      <div class="strategy-deck-panel">${renderDeckZone("main")}${renderDeckZone("reserve")}
        <div class="screen-actions setup-actions"><button class="button button-primary" id="strategyLockDeck" ${state.main.length === MAIN_COUNT ? "" : "disabled"}>デッキを封印する</button></div>
      </div></div></section>`;
}

function renderDeckZone(zone) {
  const isMain = zone === "main";
  const items = state[zone];
  const limit = isMain ? MAIN_COUNT : RESERVE_COUNT;
  return `<section class="strategy-deck-zone ${zone}"><div class="deck-toolbar"><div><span class="eyebrow">${isMain ? "MAIN DECK / 必須" : "RESERVE / 任意"}</span>
    <p>${isMain ? "各ラウンドで1枚ずつ使用" : "再提示または追撃で消費"}</p></div><div class="deck-counter"><strong>${items.length}</strong> / ${limit}</div>
    <div class="upload-actions"><label class="button button-ghost button-small file-button">画像を追加<input type="file" accept="image/*" multiple data-strategy-upload="${zone}" /></label>
      <button class="button button-ghost button-small" data-strategy-sample="${zone}" ${items.length >= limit ? "disabled" : ""}>サンプルで補充</button></div></div>
    <div class="strategy-deck-grid">${Array.from({ length: limit }, (_, index) => {
      const item = items[index];
      const cueMax = Math.max(0, Number(item?.audioDuration || 0) - AUDIO_HIGHLIGHT_SECONDS);
      return item ? `<article class="deck-slot"><img src="${item.url}" alt="${isMain ? "メイン" : "リザーブ"}画像 ${index + 1}" />
        <div class="deck-label"><span>${isMain ? "MAIN" : "RESERVE"} ${String(index + 1).padStart(2, "0")}</span><button class="remove-card" type="button" data-strategy-remove="${zone}:${item.id}" aria-label="画像を外す">×</button></div>
        <div class="deck-audio ${item.audioBlob ? "has-audio" : ""}">${item.audioBlob
          ? `<div class="deck-audio-head"><span>♪ ${escapeHtml(item.audioName || "添付音声")} / ${Number(item.audioDuration).toFixed(1)}秒</span><button type="button" data-strategy-audio-remove="${zone}:${item.id}">音声を外す</button></div>
            <audio controls preload="metadata" src="${item.audioUrl}"></audio>
            <label>追撃で使う3秒 <input type="range" min="0" max="${cueMax.toFixed(1)}" step="0.1" value="${Math.min(Number(item.audioCueStart || 0), cueMax).toFixed(1)}" data-strategy-audio-cue="${zone}:${item.id}" /><output>${Number(item.audioCueStart || 0).toFixed(1)}秒〜</output></label>`
          : `<label class="deck-audio-add">＋ 10秒音声を添付<input type="file" accept="audio/*" data-strategy-audio="${zone}:${item.id}" /></label>`}</div></article>`
        : '<div class="deck-slot empty"><span>+</span></div>';
    }).join("")}</div></section>`;
}

function renderWaitingDeck() {
  return renderStatusCard("▦", "DECK SEALED", "相手のデッキ確定を待っています", "メイン5枚とリザーブ枚数だけを同期し、画像本体はまだ送信しません。", `<span class="connection-pill connected">● MAIN ${state.main.length} / RESERVE ${state.reserve.length}</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderIdentityReveal() {
  return `<section class="screen strategy-screen strategy-identity-screen"><div class="strategy-versus-title"><span class="eyebrow">IDENTITY REVEAL</span><h1>対戦相手、判明</h1>
    <p>本当の弱点は、どちらかが看破を宣言して両者の回答が確定するまで秘密です。</p></div><div class="strategy-identity-grid">
    ${state.players.map((player, index) => { const localPlayer = index === state.playerIndex; const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url; return `<article class="strategy-identity-card player-${index + 1}"><small>${localPlayer ? "YOU" : "OPPONENT"}</small>${shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar, className: "identity-avatar" }) || ""}<h2>${escapeHtml(player.name)}</h2>
      <div><span>MAIN</span><strong>${player.mainCount}</strong></div><div><span>RESERVE</span><strong>${player.reserveCount}</strong></div></article>`; }).join("")}<div class="strategy-vs-mark">VS</div></div>
    <button class="avatar-visibility-toggle strategy-avatar-toggle" type="button" data-strategy-avatar-visibility aria-pressed="${state.hideOpponentAvatar}">${state.hideOpponentAvatar ? "相手画像を表示" : "相手画像を隠す"}</button>
    <button class="button button-primary strategy-center-button" id="strategyBattleStart">画像貼り合い開始</button></section>`;
}

function renderWaitingBattle() {
  return renderStatusCard("VS", "BATTLE READY", "相手の開始準備を待っています", "両者が準備するとROUND 1の秘密選択を開始します。", `<span class="connection-pill connected">● デッキ・通信準備完了</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderBaseSelect() {
  const items = state.main.filter((item) => !item.used);
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="section-head strategy-compact-head"><div><span class="eyebrow">SECRET MAIN PICK</span><h1>あなたの画像選択</h1>
    <p>相手の自己紹介を思い出し、今ラウンドに出す1枚を選んでロックします。</p></div><button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button></div>
    <div class="strategy-pick-grid">${items.map((item) => `<button class="select-card strategy-pick-card ${state.selectedBaseId === item.id ? "selected" : ""}" type="button" data-base-card="${item.id}">
      <img src="${item.url}" alt="選択候補" /><span>この画像を選ぶ</span></button>`).join("")}</div></section>`;
}

function renderBaseReveal() {
  const local = state.localBaseCards.get(state.round);
  const remote = state.remoteImages.get(imageKey("base", state.round));
  const mediaKey = imageKey("base", state.round);
  const opened = state.openedMediaKeys.has(mediaKey);
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="strategy-versus-title"><span class="eyebrow">SIMULTANEOUS REVEAL</span><h1>メイン画像公開</h1>
    <p>${opened ? "音声も手掛かりにして、本音で秘密採点します。" : "ボタンを押すと相手の画像を公開し、添付音声があれば再生します。"}</p></div><div class="strategy-reveal-grid">
      ${renderBattleImage(state.playerIndex === 0 ? local : remote, state.players[0].name, "PLAYER 1", state.playerIndex !== 0 && !opened)}
      ${renderBattleImage(state.playerIndex === 1 ? local : remote, state.players[1].name, "PLAYER 2", state.playerIndex !== 1 && !opened)}</div>
    ${opened ? '<button class="button button-primary strategy-center-button" id="strategyBeginRating">相手の画像を秘密採点</button>'
      : '<button class="button button-primary strategy-center-button strategy-open-media" id="strategyOpenBaseMedia">画像＋音声を開く</button>'}</section>`;
}

function renderBaseRating() {
  const remote = state.remoteImages.get(imageKey("base", state.round));
  const localPlayer = getLocalPlayer();
  const opponent = getOpponent();
  const canRequest = localPlayer.extraRequests > 0 && remainingReserve(opponent) > 0;
  const canPursuit = localPlayer.pursuitPermits > 0 && remainingReserve(opponent) > 0;
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="strategy-rating-layout">${renderBattleImage(remote, "相手の画像", "OWNER HIDDEN")}
    <div class="score-panel strategy-score-panel"><span class="eyebrow">HONEST SCORE</span><h2>本音の点数を選ぶ</h2><p>採点とリアクションは相手の確定まで非公開です。</p>
      <div class="score-buttons">${renderScoreButtons()}</div><fieldset class="strategy-reaction-fieldset"><legend>戦闘リアクション</legend>
        <label><input type="radio" name="reaction" value="normal" ${state.selectedReaction === "normal" ? "checked" : ""} /><span><b>通常</b><small>追加効果なし</small></span></label>
        <label class="reaction-low"><input type="radio" name="reaction" value="request" ${state.selectedReaction === "request" ? "checked" : ""} ${canRequest ? "" : "disabled"} /><span><b>もう1枚見せろ</b><small>残り${localPlayer.extraRequests}回 / 1〜3点で有効</small></span></label>
        <label class="reaction-high"><input type="radio" name="reaction" value="pursuit" ${state.selectedReaction === "pursuit" ? "checked" : ""} ${canPursuit ? "" : "disabled"} /><span><b>追撃を許可</b><small>残り${localPlayer.pursuitPermits}回 / 9〜10点で有効</small></span></label>
      </fieldset><button class="button button-primary score-lock" id="strategyLockRating" ${state.selectedScore ? "" : "disabled"}>採点を封印</button></div></div></section>`;
}

function renderActionSelect() {
  const actionType = localActionType();
  const items = state.reserve.filter((item) => !item.used);
  const pursuit = actionType === "pursuit";
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="section-head strategy-compact-head"><div><span class="eyebrow">${pursuit ? "PURSUIT CHANCE" : "ONE MORE IMAGE"}</span>
    <h1>${pursuit ? "追撃するリザーブを選ぶ" : "追加提示するリザーブを選ぶ"}</h1><p>${pursuit ? "追撃画像の評価は半分をボーナス加算します。" : "追加画像が高評価ならメイン画像の点数を更新できます。"}</p></div></div>
    <div class="strategy-pick-grid">${items.map((item) => `<button class="select-card strategy-pick-card" type="button" data-action-card="${item.id}"><img src="${item.url}" alt="リザーブ候補" />
      <span>${pursuit ? "この画像で追撃" : "この画像を追加提示"}</span></button>`).join("")}</div>
    ${pursuit ? '<button class="button button-ghost strategy-center-button" id="strategySkipPursuit">今回は追撃しない</button>' : ""}</section>`;
}

function renderActionReveal() {
  const data = currentRoundData();
  const picks = data.actionPicks || {};
  const localPick = picks[state.uid];
  const opponentPick = picks[state.opponentUid];
  const localItem = localPick && !localPick.skipped ? state.localActionCards.get(state.round) : null;
  const remoteItem = opponentPick && !opponentPick.skipped ? state.remoteImages.get(imageKey("action", state.round)) : null;
  const mediaKey = imageKey("action", state.round);
  const opened = state.openedMediaKeys.has(mediaKey);
  const cards = [];
  if (localItem) cards.push({ item: localItem, player: getLocalPlayer(), type: localPick.type });
  if (remoteItem) cards.push({ item: remoteItem, player: getOpponent(), type: opponentPick.type });
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="strategy-versus-title"><span class="eyebrow">RESERVE OPEN</span><h1>リザーブ画像公開</h1></div>
    <div class="strategy-reveal-grid ${cards.length === 1 ? "single" : ""}">${cards.map(({ item, player, type }) => `<div class="strategy-action-reveal">
      ${renderBattleImage(item, player.name, type === "pursuit" ? "PURSUIT" : "ONE MORE", item === remoteItem && !opened)}${type === "pursuit" ? `<blockquote>${escapeHtml(player.pursuitLine)}</blockquote>` : ""}</div>`).join("")}</div>
    ${remoteItem ? opened ? '<button class="button button-primary strategy-center-button" id="strategyRateAction">相手の追加画像を秘密採点</button>'
      : '<button class="button button-primary strategy-center-button strategy-open-media" id="strategyOpenActionMedia">画像＋音声を開く</button>'
      : '<p class="strategy-rule-note">あなたが提示した追加画像を相手が採点しています。</p>'}</section>`;
}

function renderActionRating() {
  const item = state.remoteImages.get(imageKey("action", state.round));
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="strategy-rating-layout">${renderBattleImage(item, "相手の追加画像", localOpponentActionType() === "pursuit" ? "PURSUIT" : "ONE MORE")}
    <div class="score-panel strategy-score-panel"><span class="eyebrow">RESERVE SCORE</span><h2>追加画像を採点</h2><p>追加画像から、さらに追加要求や追撃は発生しません。</p>
      <div class="score-buttons">${renderScoreButtons()}</div><button class="button button-primary score-lock" id="strategyLockActionRating" ${state.selectedScore ? "" : "disabled"}>採点を封印</button></div></div></section>`;
}

function renderRoundResult() {
  const result = state.currentResult;
  if (!result) return renderWaiting("ROUND RESULT", "結果を集計しています", "両者の採点を同期しています。");
  const winner = result.powers[0] === result.powers[1] ? -1 : result.powers[0] > result.powers[1] ? 0 : 1;
  const nextLabel = state.round === WEAKNESS_SCOUT_ROUND && !state.weaknessPhaseComplete
    ? "弱点看破フェイズへ"
    : isGameOver() ? "最終結果を見る" : `ROUND ${state.round + 1}へ`;
  const canDeclare = !state.weaknessPhaseComplete && state.round < WEAKNESS_SCOUT_ROUND && !state.roomData?.weaknessGuesses?.[state.uid];
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="result-card strategy-round-result"><span class="eyebrow">ROUND ${state.round} RESULT</span>
    <h1>${winner < 0 ? "DRAW / ノーダメージ" : `${escapeHtml(state.players[winner].name)}の攻撃`}</h1><div class="strategy-power-versus">
      ${state.players.map((player, index) => `<article class="${winner === index ? "winner" : ""}"><small>${escapeHtml(player.name)}</small><strong>${result.powers[index]}</strong><span>IMAGE POWER</span>
        ${result.damage[1 - index] ? `<b>${result.damage[1 - index]} DAMAGE</b>` : ""}</article>`).join('<div class="strategy-vs-small">VS</div>')}</div>
    <div class="strategy-round-breakdown">${state.players.map((player, owner) => {
      const detail = result.actions[owner]?.cardShown ? `${result.actions[owner].type === "pursuit" ? "追撃" : "再提示"} ${result.actionScores[owner]}点` : "追加効果なし";
      return `<p><b>${escapeHtml(player.name)}</b><span>メイン ${result.baseScores[owner]}点 / ${detail}</span></p>`;
    }).join("")}</div><div class="strategy-result-actions"><button class="button button-primary" id="strategyNextRound">${nextLabel}</button>
      ${canDeclare ? '<button class="button button-danger strategy-declare-weakness" id="strategyDeclareWeakness">今ここで弱点を看破する</button><small>回答は一度だけ。誤答すると自分に5ダメージ</small>' : ""}</div></div></section>`;
}

function renderWeaknessGuess() {
  const opponent = getOpponent();
  const triggerRound = Number(state.weaknessTriggerRound || state.round || WEAKNESS_SCOUT_ROUND);
  const responding = Boolean(state.roomData?.weaknessGuesses?.[state.opponentUid] && !state.roomData?.weaknessGuesses?.[state.uid]);
  return `<section class="screen strategy-screen">${renderBattleHud()}<div class="strategy-weakness-head"><span class="eyebrow">SCOUT PHASE COMPLETE</span>
    <h1>${responding ? "相手が看破を宣言しました" : "本当の弱点を看破せよ"}</h1><p>ROUND ${triggerRound}までの画像・音声・会話を読み、相手の本当の弱点を1つ選びます。回答は1回だけ。誤答すると自分に${WEAKNESS_MISS_DAMAGE}ダメージです。</p></div>
    <form class="strategy-weakness-guess" id="strategyWeaknessGuessForm"><fieldset><legend>${escapeHtml(opponent.name)}の弱点候補</legend>
      ${opponent.clues.map((clue, index) => `<label class="strategy-guess-card"><input type="radio" name="weaknessGuess" value="${index}" ${state.selectedWeaknessGuess === index ? "checked" : ""} />
        <span><small>CANDIDATE ${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtml(clue)}</strong></span></label>`).join("")}
    </fieldset><button class="button button-primary" type="submit" ${Number.isInteger(state.selectedWeaknessGuess) ? "" : "disabled"} id="strategyLockWeaknessGuess">この弱点で回答を封印</button></form></section>`;
}

function renderWeaknessChainSelect() {
  const opponent = getOpponent();
  const available = state.reserve.filter((item) => !item.used);
  const selected = new Set(state.selectedWeaknessChainIds);
  return `<section class="screen strategy-screen strategy-chain-screen">${renderBattleHud()}<div class="strategy-weakness-break-banner"><span>WEAKNESS BREAK</span>
    <h1>${escapeHtml(opponent.clues[opponent.weaknessIndex])}</h1><p>弱点看破成功。残りリザーブから最大${MAX_WEAKNESS_CHAIN}枚を選び、固定ダメージ ${WEAKNESS_CHAIN_DAMAGE.join(" → ")} の連続追撃を放ちます。</p></div>
    <div class="strategy-chain-counter"><strong>${selected.size}</strong> / ${Math.min(MAX_WEAKNESS_CHAIN, available.length)} CHAIN</div>
    <div class="strategy-pick-grid strategy-chain-pick-grid">${available.map((item) => `<button class="select-card strategy-pick-card ${selected.has(item.id) ? "selected" : ""}" type="button" data-weakness-chain-card="${item.id}" aria-pressed="${selected.has(item.id)}">
      <img src="${item.url}" alt="連続追撃候補" /><span>${selected.has(item.id) ? "追撃にセット済み" : "追撃へ追加"}</span></button>`).join("")}</div>
    <button class="button button-primary strategy-center-button" id="strategyLockWeaknessChain" ${selected.size ? "" : "disabled"}>${selected.size}連続追撃を封印</button></section>`;
}

function renderWeaknessChainResult() {
  const result = state.weaknessResult;
  if (!result) return renderWaiting("WEAKNESS BREAK", "連続追撃を集計しています", "弱点コミットと転送画像を照合しています。");
  const guessSummary = state.players.map((player, index) => {
    const opponent = state.players[1 - index];
    const guess = player.weaknessGuess;
    return `<article class="${player.weaknessCorrect ? "success" : "failed"}"><small>${escapeHtml(player.name)}の回答</small>
      <strong>${escapeHtml(opponent.clues[guess] || "未回答")}</strong><span>${player.weaknessCorrect ? "看破成功" : `看破失敗 / 自分に${WEAKNESS_MISS_DAMAGE} DAMAGE`}</span></article>`;
  }).join("");
  const chains = state.players.map((player, owner) => {
    const count = result.chainCounts[owner];
    const defender = state.players[1 - owner];
    if (!count) return `<article class="strategy-chain-lane is-empty"><h2>${escapeHtml(player.name)}</h2><p>${player.weaknessCorrect ? "リザーブ不足のため連続追撃なし" : "看破失敗のため連続追撃なし"}</p></article>`;
    const cards = Array.from({ length: count }, (_, index) => {
      const item = owner === state.playerIndex ? state.localWeaknessChainCards[index] : state.remoteImages.get(imageKey("weaknessChain", index));
      return `<div class="strategy-chain-card" data-chain-owner="${owner}" data-chain-slot="${index}" style="--chain-index:${index}">${renderBattleImage(item, player.name, `PURSUIT CHAIN ×${index + 1}`)}
        <blockquote>${escapeHtml(player.pursuitLine)}</blockquote><b>${WEAKNESS_CHAIN_DAMAGE[index]} DAMAGE</b></div>`;
    }).join("");
    return `<article class="strategy-chain-lane"><h2>${escapeHtml(player.name)} → ${escapeHtml(defender.name)}</h2><div class="strategy-chain-cards">${cards}</div>
      <p class="strategy-chain-total">CHAIN DAMAGE <strong>${result.chainDamage[owner]}</strong>${result.overkill[1 - owner] > 0 ? `<em>OVERKILL +${result.overkill[1 - owner]}</em>` : ""}</p></article>`;
  }).join("");
  const matchEnds = state.players.some((player) => player.hp <= 0);
  const surrendered = (result.surrenders || []).some(Boolean);
  const headline = surrendered ? "SURRENDER KO" : result.overkill.some((value) => value > 0) ? "OVERKILL" : state.players.some((player) => player.weaknessCorrect) ? "WEAKNESS BREAK" : "READ FAILED";
  const localCanSurrender = getOpponent().weaknessCorrect && getLocalPlayer().hp > 0 && !state.roomData?.weaknessSurrenders?.[state.uid];
  const nextRound = Number(state.weaknessTriggerRound || state.round) + 1;
  return `<section class="screen strategy-screen strategy-chain-result">${renderBattleHud()}<div class="strategy-weakness-head"><span class="eyebrow">WEAKNESS REVEAL</span><h1>${headline}</h1>
    <p>事前登録したハッシュとの照合に成功しました。追撃音声は各カードで指定した3秒を順番に再生します。</p></div><div class="strategy-guess-summary">${guessSummary}</div>
    <div class="strategy-chain-result-grid">${chains}</div>
    ${state.players.some((player) => player.weaknessChainCount > 0) ? '<button class="button button-danger strategy-center-button strategy-chain-play" id="strategyPlayWeaknessChain">怒涛の連続追撃を再生</button>' : ""}
    ${localCanSurrender ? '<button class="button button-ghost strategy-center-button strategy-surrender" id="strategyWeaknessSurrender">参りました（敗北を認める）</button>' : ""}
    <button class="button button-primary strategy-center-button" id="strategyWeaknessContinue">${matchEnds ? "最終結果を見る" : `ROUND ${nextRound}へ`}</button></section>`;
}

function renderGameOver() {
  const outcome = determineOutcome();
  const winner = outcome.winnerIndex;
  const localPlayer = getLocalPlayer();
  const localResult = winner < 0 ? "DRAW" : winner === state.playerIndex ? "WIN" : "LOSE";
  const weaknessDetail = localPlayer.weaknessCorrect
    ? `弱点看破成功 / ${Number(localPlayer.weaknessChainCount || 0)} CHAIN`
    : "弱点看破：未達";
  const finishDetail = Number(localPlayer.overkill || 0) > 0
    ? `OVERKILL +${Number(localPlayer.overkill || 0)}`
    : `残りHP ${Number(localPlayer.hp || 0)}`;
  const shareButton = shared()?.renderResultShareButton?.({
    mode: "戦略型1on1",
    result: localResult,
    details: [weaknessDetail, finishDetail],
  }) || "";
  const weaknessReview = state.weaknessResult ? `<div class="strategy-guess-summary strategy-final-guess-summary">${state.players.map((player, index) => {
    const opponent = state.players[1 - index];
    return `<article class="${player.weaknessCorrect ? "success" : "failed"}"><small>${escapeHtml(player.name)}の回答</small><strong>${escapeHtml(opponent.clues[player.weaknessGuess] || "未回答")}</strong><span>${player.weaknessCorrect ? `看破成功 / ${player.weaknessChainCount} CHAIN` : "看破失敗"}</span></article>`;
  }).join("")}</div>` : "";
  return `<section class="screen strategy-screen"><div class="gameover-card strategy-gameover"><span class="eyebrow">ONLINE STRATEGY 1ON1 COMPLETE</span>
    <h1>${winner < 0 ? "DRAW" : `${escapeHtml(state.players[winner].name)} WIN`}</h1><p>匿名紹介の読み、メイン5枚、リザーブの使いどころを振り返りましょう。</p>
    <div class="strategy-final-grid">${state.players.map((player, index) => `<article class="${winner === index ? "winner" : ""}"><small>${index === state.playerIndex ? "YOU" : "OPPONENT"}</small><h2>${escapeHtml(player.name)}</h2>
      <div><span>残りHP</span><strong>${player.hp}</strong></div><div><span>累計パワー</span><strong>${player.totalPower}</strong></div><div><span>平均評価</span><strong>${average(player.receivedScores)}</strong></div>${player.overkill > 0 ? `<em>OVERKILL +${player.overkill}</em>` : ""}</article>`).join("")}</div>
    ${weaknessReview}
    <section class="strategy-bluff-reveal"><span class="eyebrow">弱点公開</span><h2>弱点候補の答え合わせ</h2>${state.players.map((player) => `<article><h3>${escapeHtml(player.name)}</h3>
      ${player.clues.map((clue, index) => `<p class="${index === player.weaknessIndex ? "is-weakness" : "is-bluff"}"><b>${index === player.weaknessIndex ? "本当の弱点" : "ブラフ"}</b>${escapeHtml(clue)}</p>`).join("")}</article>`).join("")}</section>
    <section class="strategy-history"><span class="eyebrow">BATTLE LOG</span>${state.history.map((round) => `<p><b>R${round.round}</b><span>${escapeHtml(state.players[0].name)} ${round.powers[0]} - ${round.powers[1]} ${escapeHtml(state.players[1].name)}</span></p>`).join("")}</section>
    <div class="online-profile-strip"><span>あなたの戦略型戦績</span><span>${state.profile.wins}勝 ${state.profile.losses}敗 ${state.profile.draws}分</span><span>RATE ${state.profile.rating}</span></div>
    ${renderPostMatchTip({ mode: "strategy", roomId: state.roomId, viewerUid: state.uid, recipients: state.players, balance: state.economy.points })}
    <div class="screen-actions strategy-final-actions">${shareButton}<button class="button button-ghost" id="strategyNewMatch">別の相手を探す</button><button class="button button-primary" id="strategyFinish">タイトルへ戻る</button></div>
  </div></section>`;
}

function renderWithdrawn() {
  return renderStatusCard("×", "NO CONTEST", "勝負は撤退されました", "プレイヤーネームと弱点は公開されず、戦績にも影響しません。", "", `<button class="button button-primary" id="strategyWithdrawAgain">別の相手を探す</button><button class="button button-ghost" id="strategyWithdrawHome">タイトルへ戻る</button>`);
}

function renderNoContest() {
  return renderStatusCard("×", "NO CONTEST", "戦略型1on1対戦を終了しました", "ルームが破棄されました。画像と進行情報への参照を解放しました。", "", `<button class="button button-primary" id="strategyNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="strategyNoContestHome">タイトルへ戻る</button>`);
}

function renderError() {
  return renderStatusCard("!", "CONNECTION ERROR", "戦略型1on1へ接続できません", state.errorMessage || "通信状態を確認してください。", "", `<button class="button button-primary" id="strategyRetry">もう一度試す</button><button class="button button-ghost" id="strategyErrorHome">タイトルへ戻る</button>`);
}

function renderWaiting(eyebrow, title, body) {
  return `<section class="screen strategy-screen">${renderBattleHud()}${renderStatusCard("…", eyebrow, title, body, `<div class="matching-pulse"><i></i><i></i><i></i></div>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}</section>`;
}

function renderStatusCard(icon, eyebrow, title, body, details = "", actions = "") {
  return `<section class="screen handoff-wrap"><article class="handoff-card online-status-card"><div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><div class="online-status-details">${details}</div><div class="button-row">${actions}</div></article></section>`;
}

function isStrategyChatVisible() {
  return ANONYMOUS_CHAT_SCREENS.has(state.screen) || IDENTIFIED_CHAT_SCREENS.has(state.screen);
}

function isStrategyChatAnonymous() {
  return ANONYMOUS_CHAT_SCREENS.has(state.screen);
}

function renderStrategyChatAvatar(player, localPlayer, anonymous) {
  if (anonymous) return shared()?.profileAvatar?.renderBattle?.(localPlayer ? "YOU" : "?", "", { className: "strategy-chat-avatar" }) || "";
  const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url;
  return shared()?.profileAvatar?.renderBattle?.(player?.name || "PLAYER", avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar, className: "strategy-chat-avatar" }) || "";
}

function renderStrategyChatParticipant(player, localPlayer, anonymous) {
  const displayName = anonymous ? (localPlayer ? "あなた" : "匿名の相手") : (player?.name || "PLAYER");
  return `<div class="strategy-chat-participant ${localPlayer ? "is-local" : "is-opponent"}">${renderStrategyChatAvatar(player, localPlayer, anonymous)}
    <span><small>${localPlayer ? "YOU" : "OPPONENT"}</small><strong>${escapeHtml(displayName)}</strong></span></div>`;
}

function renderStrategyChatMessage(message, anonymous) {
  const localPlayer = message.authorUid === state.uid;
  const player = state.players.find((candidate) => candidate.uid === message.authorUid);
  const displayName = anonymous ? (localPlayer ? "あなた" : "匿名の相手") : (player?.name || "PLAYER");
  const phaseLabel = message.phase === "scout" ? "SCOUT" : `R${Math.max(1, Math.min(MAX_ROUNDS, Number(message.round) || 1))}`;
  const showIdentityCosmetics = !anonymous && message.phase !== "scout";
  const cosmeticClasses = showIdentityCosmetics ? chatCosmeticClassNames(message.chatFrameId, message.chatBackgroundId) : "";
  const titleBadge = showIdentityCosmetics ? renderStrategyTitleBadge(message.titleId) : "";
  const content = message.stampId
    ? renderStampBubble(message.stampId, cosmeticClasses)
    : `<p${cosmeticClasses ? ` class="${cosmeticClasses}"` : ""}>${escapeHtml(message.text)}</p>`;
  return `<div class="strategy-chat-message-row ${localPlayer ? "is-local" : "is-opponent"}">${renderStrategyChatAvatar(player, localPlayer, anonymous)}
    <div class="chat-message ${localPlayer ? "player-two" : "player-one"}"><small>${escapeHtml(displayName)} / ${phaseLabel}${titleBadge}</small>${content}</div></div>`;
}

function renderStrategyChat() {
  const anonymous = isStrategyChatAnonymous();
  const localPlayer = getLocalPlayer();
  const opponent = getOpponent();
  const messages = state.chatMessages.length
    ? state.chatMessages.map((message) => renderStrategyChatMessage(message, anonymous)).join("")
    : `<div class="chat-empty">会話も弱点を見抜くための手掛かりです。<br />質問・ブラフ・反応を使って読み合いましょう。</div>`;
  return `<aside class="chat-panel strategy-chat-panel"><div class="chat-head"><strong>${anonymous ? "ANONYMOUS SCOUT CHAT" : "WEAKNESS SCOUT CHAT"}</strong>
      <span>${anonymous ? "名前・写真はデッキ封印まで非公開" : "会話も推理材料"}</span></div>
    <div class="strategy-chat-participants">${renderStrategyChatParticipant(localPlayer, true, anonymous)}${renderStrategyChatParticipant(opponent, false, anonymous)}</div>
    <div class="chat-messages" id="strategyChatMessages">${messages}</div>
    ${renderChatTools({ id: "strategy", textReactions: STRATEGY_CHAT_PROMPTS, stamps: getAvailableStamps(state.economy, { freeOnly: anonymous }), textAttribute: "data-strategy-chat-reaction", stampAttribute: "data-strategy-chat-stamp" })}
    <form class="chat-form" id="strategyChatForm"><input class="chat-input" id="strategyChatInput" maxlength="80" placeholder="会話から本当の弱点を探る…" autocomplete="off" aria-label="戦略型1on1チャットメッセージ" />
      <button class="button button-cyan button-small" type="submit">送信</button></form></aside>`;
}

function renderBattleHud() {
  if (state.players.length !== 2) return "";
  return `<div class="round-topbar strategy-hud">${renderHudPlayer(0)}<div class="round-badge"><small>ROUND</small><strong>${state.round} / ${MAX_ROUNDS}</strong></div>${renderHudPlayer(1)}</div>
    <div class="online-room-strip"><span>STRATEGY ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span><span class="connection-pill ${state.channelReady ? "connected" : ""}">${state.channelReady ? "● P2P接続中" : "○ P2P接続待ち"}</span>
      <span class="connection-pill ${state.opponentOnline ? "connected" : "warning"}">${state.opponentOnline ? "● 相手オンライン" : "○ 相手の接続切れ"}</span>
      <button class="avatar-visibility-toggle" type="button" data-strategy-avatar-visibility aria-pressed="${state.hideOpponentAvatar}">${state.hideOpponentAvatar ? "相手画像を表示" : "相手画像を隠す"}</button></div>`;
}

function renderHudPlayer(index) {
  const player = state.players[index];
  const hpPercent = Math.max(0, Math.min(100, (player.hp / MAX_HP) * 100));
  const localPlayer = index === state.playerIndex;
  const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url;
  const avatar = shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar }) || "";
  return `<div class="hud-player ${localPlayer ? "local-player" : ""}"><div class="hud-player-main">${avatar}<div class="hud-player-details"><div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}${localPlayer ? "（あなた）" : ""}</span></div>
    <div class="hp-bar"><div class="hp-fill" style="--hp:${hpPercent}%"></div></div><span class="hp-value">HP ${player.hp} / ${MAX_HP} ・ ASK ${player.extraRequests} ・ PERMIT ${player.pursuitPermits}</span></div></div></div>`;
}

function renderBattleImage(item, name, label, concealed = false) {
  const audio = item?.audioUrl ? `<div class="strategy-card-audio"><span>♪ 音声 ${Number(item.audioDuration || 0).toFixed(1)}秒</span><button type="button" data-strategy-play-audio="${escapeHtml(item.audioUrl)}" data-audio-start="0" data-audio-duration="${Number(item.audioDuration || 0)}">もう一度聴く</button></div>` : '<div class="strategy-card-audio is-empty"><span>音声なし</span></div>';
  return `<article class="strategy-battle-image ${concealed ? "is-concealed" : ""}"><div class="strategy-image-head"><span>${escapeHtml(label)}</span><b>${escapeHtml(name)}</b></div><div class="strategy-image-media"><img src="${item?.url || ""}" alt="${escapeHtml(name)}の対戦画像" />${concealed ? '<span class="strategy-media-lock">TAP TO REVEAL<br /><b>画像＋音声を開く</b></span>' : ""}</div>${concealed ? "" : audio}</article>`;
}

function renderScoreButtons() {
  return Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    return `<button class="score-button ${score >= 9 ? "critical-zone" : ""} ${state.selectedScore === score ? "selected" : ""}" type="button" data-strategy-score="${score}">${score}</button>`;
  }).join("");
}

function bindScreenEvents() {
  document.querySelector("#strategyBackHome")?.addEventListener("click", leaveToLanding);
  if (state.screen === "profile") {
    window.HariaiOnline?.bindOverallRankingParticipation?.({
      controlId: "strategyOverallRanking",
      name: () => document.querySelector("#strategyName")?.value || state.name,
      onUpdate: () => { syncStrategyProfileDraft(); render(); },
    });
    shared()?.profileAvatar?.bindSetting?.({ controlId: "strategyProfileAvatar", onUpdate: () => { syncStrategyProfileDraft(); render(); } });
  }
  document.querySelectorAll("[data-strategy-avatar-visibility]").forEach((button) => button.addEventListener("click", () => { state.hideOpponentAvatar = !state.hideOpponentAvatar; render(); }));
  bindStrategyChatEvents();
  document.querySelector("#strategyProfileForm")?.addEventListener("submit", saveProfile);
  bindPursuitFields();
  document.querySelector("#strategyCancelMatching")?.addEventListener("click", cancelMatching);
  document.querySelector("#strategyWithdraw")?.addEventListener("click", () => submitDecision("withdraw"));
  document.querySelector("#strategyAccept")?.addEventListener("click", () => submitDecision("accept"));
  document.querySelectorAll("[data-strategy-upload]").forEach((input) => input.addEventListener("change", (event) => addDeckFiles(input.dataset.strategyUpload, [...event.target.files])));
  document.querySelectorAll("[data-strategy-sample]").forEach((button) => button.addEventListener("click", () => fillDeckSamples(button.dataset.strategySample)));
  document.querySelectorAll("[data-strategy-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.strategyRemove)));
  document.querySelectorAll("[data-strategy-audio]").forEach((input) => input.addEventListener("change", (event) => addCardAudio(input.dataset.strategyAudio, event.target.files?.[0])));
  document.querySelectorAll("[data-strategy-audio-remove]").forEach((button) => button.addEventListener("click", () => removeCardAudio(button.dataset.strategyAudioRemove)));
  document.querySelectorAll("[data-strategy-audio-cue]").forEach((input) => input.addEventListener("input", () => updateCardAudioCue(input.dataset.strategyAudioCue, input.value, input)));
  document.querySelectorAll("[data-strategy-play-audio]").forEach((button) => button.addEventListener("click", () => playAudioUrl(button.dataset.strategyPlayAudio, Number(button.dataset.audioStart || 0), Number(button.dataset.audioDuration || 0))));
  document.querySelector("#strategyLockDeck")?.addEventListener("click", lockDeck);
  document.querySelector("#strategyBattleStart")?.addEventListener("click", startBattle);
  document.querySelectorAll("[data-base-card]").forEach((button) => button.addEventListener("click", () => lockBaseCard(button.dataset.baseCard)));
  document.querySelector("#strategyOpenBaseMedia")?.addEventListener("click", () => openStrategyMedia("base"));
  document.querySelector("#strategyBeginRating")?.addEventListener("click", () => { state.screen = "baseRating"; state.selectedScore = 0; state.selectedReaction = "normal"; render(); });
  bindScoreButtons();
  document.querySelectorAll('input[name="reaction"]').forEach((input) => input.addEventListener("change", () => { state.selectedReaction = input.value; }));
  document.querySelector("#strategyLockRating")?.addEventListener("click", lockBaseRating);
  document.querySelectorAll("[data-action-card]").forEach((button) => button.addEventListener("click", () => lockActionCard(button.dataset.actionCard)));
  document.querySelector("#strategySkipPursuit")?.addEventListener("click", skipPursuit);
  document.querySelector("#strategyOpenActionMedia")?.addEventListener("click", () => openStrategyMedia("action"));
  document.querySelector("#strategyRateAction")?.addEventListener("click", () => { state.screen = "actionRating"; state.selectedScore = 0; render(); });
  document.querySelector("#strategyLockActionRating")?.addEventListener("click", lockActionRating);
  document.querySelector("#strategyNextRound")?.addEventListener("click", continueRound);
  document.querySelector("#strategyDeclareWeakness")?.addEventListener("click", declareWeaknessGuess);
  document.querySelectorAll('input[name="weaknessGuess"]').forEach((input) => input.addEventListener("change", () => {
    state.selectedWeaknessGuess = Number(input.value);
    document.querySelector("#strategyLockWeaknessGuess")?.removeAttribute("disabled");
  }));
  document.querySelector("#strategyWeaknessGuessForm")?.addEventListener("submit", lockWeaknessGuess);
  document.querySelectorAll("[data-weakness-chain-card]").forEach((button) => button.addEventListener("click", () => toggleWeaknessChainCard(button.dataset.weaknessChainCard)));
  document.querySelector("#strategyLockWeaknessChain")?.addEventListener("click", lockWeaknessChain);
  document.querySelector("#strategyWeaknessContinue")?.addEventListener("click", continueAfterWeaknessChain);
  document.querySelector("#strategyPlayWeaknessChain")?.addEventListener("click", playWeaknessChainSequence);
  document.querySelector("#strategyWeaknessSurrender")?.addEventListener("click", surrenderToWeaknessBreak);
  document.querySelectorAll("[data-strategy-destroy]").forEach((button) => button.addEventListener("click", requestHome));
  if (state.screen === "gameover") {
    bindPostMatchTip(app, {
      mode: "strategy",
      roomId: state.roomId,
      viewerUid: state.uid,
      recipients: state.players,
      balance: state.economy.points,
      onBalanceChange: (balance) => { state.economy.points = balance; },
    });
  }
  document.querySelector("#strategyNewMatch")?.addEventListener("click", resetStrategySetup);
  document.querySelector("#strategyWithdrawAgain")?.addEventListener("click", resetStrategySetup);
  document.querySelector("#strategyNoContestAgain")?.addEventListener("click", resetStrategySetup);
  document.querySelector("#strategyRetry")?.addEventListener("click", retryConnection);
  document.querySelector("#strategyFinish")?.addEventListener("click", leaveToLanding);
  document.querySelector("#strategyWithdrawHome")?.addEventListener("click", leaveToLanding);
  document.querySelector("#strategyNoContestHome")?.addEventListener("click", leaveToLanding);
  document.querySelector("#strategyErrorHome")?.addEventListener("click", leaveToLanding);
}

function bindStrategyChatEvents() {
  bindChatToolTabs();
  document.querySelectorAll("[data-strategy-chat-reaction]").forEach((button) => button.addEventListener("click", () => sendStrategyChat(button.dataset.strategyChatReaction)));
  document.querySelectorAll("[data-strategy-chat-stamp]").forEach((button) => button.addEventListener("click", () => sendStrategyChat("", button.dataset.strategyChatStamp)));
  document.querySelector("#strategyChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#strategyChatInput");
    const text = input?.value || "";
    if (input) input.value = "";
    sendStrategyChat(text);
    input?.focus();
  });
  scrollStrategyChat();
}

async function sendStrategyChat(value, stampId = "") {
  const anonymous = isStrategyChatAnonymous();
  const stamp = getStamp(stampId);
  if (stampId && (!stamp || !canUseStamp(stampId, state.economy, { freeOnly: anonymous }))) {
    showToast(anonymous ? "匿名偵察中は無料スタンプ4種だけ使用できます。" : "このスタンプは現在の装備に含まれていません。");
    return;
  }
  if (stamp && !acquireStampCooldown("strategy")) {
    showToast("スタンプは2秒に1回送信できます。");
    return;
  }
  const text = stamp ? stamp.label : String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
  if (!text || !state.roomId || !isStrategyChatVisible()) return;
  const message = {
    authorUid: state.uid,
    text,
    phase: isStrategyChatAnonymous() ? "scout" : "battle",
    round: Math.max(1, Math.min(MAX_ROUNDS, Number(state.round) || 1)),
    createdAt: serverTimestamp(),
  };
  if (stamp) { message.stampId = stamp.id; startStampButtonCooldown("[data-strategy-chat-stamp]"); }
  if (!isStrategyChatAnonymous()) {
    const equippedTitle = getPlayerTitleProduct(state.economy.equipped?.title);
    if (equippedTitle && state.economy.inventory?.[equippedTitle.id]) message.titleId = equippedTitle.id;
    const cosmetics = getEquippedChatCosmetics(state.economy);
    if (cosmetics.chatFrameId) message.chatFrameId = cosmetics.chatFrameId;
    if (cosmetics.chatBackgroundId) message.chatBackgroundId = cosmetics.chatBackgroundId;
  }
  await set(push(ref(database, `online/strategyChats/${state.roomId}`)), message).catch(() => showToast("チャットを送信できませんでした。"));
}

function refreshStrategyChat() {
  const list = document.querySelector("#strategyChatMessages");
  if (!list) return;
  const anonymous = isStrategyChatAnonymous();
  list.innerHTML = state.chatMessages.length
    ? state.chatMessages.map((message) => renderStrategyChatMessage(message, anonymous)).join("")
    : `<div class="chat-empty">会話も弱点を見抜くための手掛かりです。<br />質問・ブラフ・反応を使って読み合いましょう。</div>`;
  scrollStrategyChat();
}

function scrollStrategyChat() {
  const list = document.querySelector("#strategyChatMessages");
  if (list) list.scrollTop = list.scrollHeight;
}

function syncStrategyProfileDraft() {
  const nameInput = document.querySelector("#strategyName");
  if (nameInput) state.name = nameInput.value.slice(0, 16);
  const clueInputs = [...document.querySelectorAll(".strategy-clue-input")];
  if (clueInputs.length === 3) state.clues = clueInputs.map((input) => input.value.slice(0, 80));
  const weakness = document.querySelector('input[name="weakness"]:checked');
  if (weakness) state.weaknessIndex = Number(weakness.value);
  const choice = document.querySelector("#strategyPursuitLine")?.value || PURSUIT_LINES[0];
  const custom = document.querySelector("#strategyCustomPursuitLine")?.value || "";
  state.pursuitLine = choice === CUSTOM_PURSUIT_VALUE ? sanitizePursuitLineDraft(custom) : normalizePursuitLine(choice);
}

function bindPursuitFields() {
  const select = document.querySelector("#strategyPursuitLine");
  const field = document.querySelector("#strategyCustomPursuitField");
  const input = document.querySelector("#strategyCustomPursuitLine");
  const counter = document.querySelector("#strategyPursuitCharacterCount");
  const sync = () => { if (field) field.hidden = select?.value !== CUSTOM_PURSUIT_VALUE; };
  select?.addEventListener("change", () => { sync(); if (select.value === CUSTOM_PURSUIT_VALUE) input?.focus(); });
  input?.addEventListener("input", () => { input.value = sanitizePursuitLineDraft(input.value); if (counter) counter.textContent = String(input.value.length); });
  sync();
}

function bindScoreButtons() {
  document.querySelectorAll("[data-strategy-score]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScore = Number(button.dataset.strategyScore);
    document.querySelectorAll("[data-strategy-score]").forEach((item) => item.classList.toggle("selected", item === button));
    document.querySelector("#strategyLockRating, #strategyLockActionRating")?.removeAttribute("disabled");
  }));
}

async function saveProfile(event) {
  event.preventDefault();
  const name = document.querySelector("#strategyName")?.value.trim().slice(0, 16) || "";
  const clues = [...document.querySelectorAll(".strategy-clue-input")].map((input) => input.value.trim());
  const weakness = document.querySelector('input[name="weakness"]:checked');
  if (!state.authReady || !state.uid) return showToast("Firebaseへの接続完了を待ってください。");
  if (!name || clues.some((clue) => !clue) || !weakness) return showToast("名前、3つの弱点候補、本当の弱点1つをすべて入力してください。");
  state.name = name;
  state.clues = normalizeClues(clues);
  state.weaknessIndex = Number(weakness.value);
  const choice = document.querySelector("#strategyPursuitLine")?.value || PURSUIT_LINES[0];
  const custom = document.querySelector("#strategyCustomPursuitLine")?.value || "";
  state.pursuitLine = choice === CUSTOM_PURSUIT_VALUE ? normalizePursuitLine(custom) : normalizePursuitLine(choice);
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  localStorage.setItem(PROFILE_CLUES_KEY, JSON.stringify(state.clues));
  localStorage.setItem(PROFILE_WEAKNESS_KEY, String(state.weaknessIndex));
  localStorage.setItem(PURSUIT_LINE_KEY, state.pursuitLine);
  window.HariaiAudio?.playButton?.("confirm");
  await beginMatchmaking();
}

async function beginMatchmaking() {
  state.screen = "matching";
  setStrategyChrome("STRATEGY MATCHING");
  render();
  const activeRef = ref(database, `online/strategyActive/${state.uid}`);
  if ((await get(activeRef)).exists()) await remove(activeRef);
  const offersRef = ref(database, `online/strategyOffers/${state.uid}`);
  const staleOffers = await get(offersRef);
  if (staleOffers.exists()) await Promise.allSettled(Object.keys(staleOffers.val()).map((roomId) => remove(ref(database, `online/strategyOffers/${state.uid}/${roomId}`))));
  const queueRef = ref(database, `online/strategyQueue/${state.uid}`);
  await set(queueRef, { uid: state.uid, joinedAt: Date.now(), lastSeen: Date.now(), state: "waiting" });
  await startPublicPresence();
  const disconnect = onDisconnect(queueRef);
  await disconnect.remove();
  state.disconnectHandles.push(disconnect);
  state.queueHeartbeat = window.setInterval(() => update(queueRef, { lastSeen: Date.now() }).then(() => attemptToHost(state.latestQueue)).catch(() => {}), HEARTBEAT_MS);
  state.matchUnsubscribers.push(onValue(offersRef, processIncomingOffers, handleRecoverableError));
  state.offerPollTimer = window.setInterval(() => {
    if (!active || state.screen !== "matching" || state.roomId) return;
    get(offersRef).then(processIncomingOffers).catch(handleRecoverableError);
  }, 1500);
  state.matchUnsubscribers.push(onValue(ref(database, "online/strategyActive"), (snapshot) => { state.activeUsers = snapshot.val() || {}; attemptToHost(state.latestQueue).catch(handleRecoverableError); }));
  state.matchUnsubscribers.push(onValue(ref(database, "online/strategyQueue"), (snapshot) => { state.latestQueue = snapshot.val() || {}; attemptToHost(state.latestQueue).catch(handleRecoverableError); }));
}

function processIncomingOffers(snapshot) {
  const offers = snapshot.val() || {};
  const newest = Object.entries(offers).sort(([, a], [, b]) => Number(b.createdAt) - Number(a.createdAt))[0];
  state.pendingIncomingOffer = newest ? { roomId: newest[0], offer: newest[1] } : null;
  drainIncomingOffers().catch(handleRecoverableError);
}

async function attemptToHost(queue) {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingOffer || state.pendingOffer) return;
  const waiting = Object.values(queue).filter((entry) => entry?.state === "waiting" && Number(entry.lastSeen) >= Date.now() - QUEUE_FRESH_MS && !state.activeUsers[entry.uid]);
  if (waiting.length < 2) return;
  waiting.sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt) || String(a.uid).localeCompare(String(b.uid)));
  if (waiting[0].uid !== state.uid) return;
  const candidates = waiting.filter((entry) => entry.uid !== state.uid);
  if (candidates.length) await createOffer(candidates[Math.floor(Math.random() * candidates.length)]);
}

async function createOffer(candidate) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/strategyRooms")).key;
  try {
    const reservation = await runTransaction(ref(database, `online/strategyActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const roomRef = ref(database, `online/strategyRooms/${roomId}`);
    const localPlayerRecord = await playerRoomRecord(roomId);
    await set(ref(database, `online/strategyRooms/${roomId}/hostUid`), state.uid);
    await update(roomRef, {
      guestUid: candidate.uid,
      createdAt: serverTimestamp(),
      status: "offered",
      [`members/${state.uid}`]: true,
      [`members/${candidate.uid}`]: true,
      [`players/${state.uid}`]: localPlayerRecord,
    });
    await set(ref(database, `online/strategyOffers/${candidate.uid}/${roomId}`), { roomId, fromUid: state.uid, toUid: candidate.uid, createdAt: Date.now() });
    await update(ref(database, `online/strategyQueue/${state.uid}`), { state: "offering", roomId });
    state.pendingOffer = { roomId, targetUid: candidate.uid };
    const statusRef = ref(database, `online/strategyRooms/${roomId}/status`);
    const handleStatus = async (snapshot) => {
      if (snapshot.val() !== "active" || state.roomId) return;
      await remove(ref(database, `online/strategyOffers/${candidate.uid}/${roomId}`)).catch(() => {});
      await enterRoom(roomId);
    };
    state.matchUnsubscribers.push(onValue(statusRef, (snapshot) => handleStatus(snapshot).catch(handleRecoverableError), handleRecoverableError));
    state.hostStatusPollTimer = window.setInterval(() => {
      if (!active || state.screen !== "matching" || state.roomId || state.pendingOffer?.roomId !== roomId) return;
      get(statusRef).then(handleStatus).catch(handleRecoverableError);
    }, 1500);
    state.matchTimer = window.setTimeout(() => expireOffer(roomId, candidate.uid), MATCH_TIMEOUT_MS);
  } finally {
    state.matchingBusy = false;
  }
}

async function expireOffer(roomId, targetUid) {
  if (state.roomId || state.pendingOffer?.roomId !== roomId) return;
  const result = await runTransaction(ref(database, `online/strategyRooms/${roomId}/status`), (current) => current === "offered" ? "expired" : undefined);
  if (!result.committed) return;
  await Promise.allSettled([
    remove(ref(database, `online/strategyOffers/${targetUid}/${roomId}`)),
    remove(ref(database, `online/strategyActive/${state.uid}`)),
    update(ref(database, `online/strategyQueue/${state.uid}`), { state: "waiting", roomId: null }),
  ]);
  state.pendingOffer = null;
}

async function drainIncomingOffers() {
  if (state.acceptingOffer) return;
  while (active && state.screen === "matching" && !state.roomId && state.pendingIncomingOffer) {
    const incoming = state.pendingIncomingOffer;
    state.pendingIncomingOffer = null;
    await acceptOffer(incoming.roomId, incoming.offer);
  }
}

async function acceptOffer(roomId, offer) {
  if (!active || state.screen !== "matching" || state.roomId || offer?.toUid !== state.uid) return;
  state.acceptingOffer = true;
  try {
    const roomRef = ref(database, `online/strategyRooms/${roomId}`);
    const snapshot = await get(roomRef);
    const room = snapshot.val();
    if (!room || room.status !== "offered" || !room.members?.[state.uid]) {
      await remove(ref(database, `online/strategyOffers/${state.uid}/${roomId}`));
      return;
    }
    const reservation = await runTransaction(ref(database, `online/strategyActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    await set(ref(database, `online/strategyRooms/${roomId}/players/${state.uid}`), await playerRoomRecord(roomId));
    const statusRef = ref(database, `online/strategyRooms/${roomId}/status`);
    if ((await get(statusRef)).val() !== "offered") {
      await remove(ref(database, `online/strategyActive/${state.uid}`));
      return;
    }
    await set(statusRef, "active");
    await Promise.allSettled([remove(ref(database, `online/strategyOffers/${state.uid}/${roomId}`)), remove(ref(database, `online/strategyQueue/${state.uid}`))]);
    await enterRoom(roomId);
  } finally {
    state.acceptingOffer = false;
  }
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  const snapshot = await get(ref(database, `online/strategyRooms/${roomId}`));
  const room = snapshot.val();
  if (!room || !room.players?.[room.hostUid] || !room.players?.[room.guestUid]) throw new Error("戦略型ルーム情報を取得できませんでした。");
  state.roomId = roomId;
  state.roomData = room;
  state.opponentUid = room.hostUid === state.uid ? room.guestUid : room.hostUid;
  state.playerIndex = room.hostUid === state.uid ? 0 : 1;
  state.players = [runtimePlayer(room.players[room.hostUid]), runtimePlayer(room.players[room.guestUid])];
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  state.peerStatus = "P2P接続を準備中…";
  setStrategyChrome("STRATEGY ONLINE BATTLE");
  render();
  await setupRoomListeners();
  await setupPeerConnection();
}

async function setupRoomListeners() {
  const base = `online/strategyRooms/${state.roomId}`;
  const activeDisconnect = onDisconnect(ref(database, `online/strategyActive/${state.uid}`));
  await activeDisconnect.remove();
  state.disconnectHandles.push(activeDisconnect);
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);
  state.roomUnsubscribers.push(onValue(ref(database, base), (snapshot) => {
    state.roomData = snapshot.val() || {};
    state.roundData = currentRoundData();
    reactToRoomData().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (snapshot.exists() && snapshot.val().by !== state.uid) handleOpponentDestroyed();
  }));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${state.opponentUid}`), (snapshot) => {
    state.opponentOnline = snapshot.val()?.online !== false;
  }));
  const chatQuery = query(ref(database, `online/strategyChats/${state.roomId}`), limitToLast(60));
  state.roomUnsubscribers.push(onChildAdded(chatQuery, (snapshot) => {
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 60) state.chatMessages.shift();
    refreshStrategyChat();
  }, handleRecoverableError));
}

async function setupPeerConnection() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像・音声転送に対応していません。");
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
  state.peer = peer;
  peer.onicecandidate = (event) => { if (event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError); };
  peer.onconnectionstatechange = () => {
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    if (["failed", "closed"].includes(peer.connectionState) && active) showToast("P2P接続が切れました。ルーム破棄で退出できます。");
    if (state.screen === "connecting") render();
  };
  peer.ondatachannel = (event) => configureDataChannel(event.channel);
  const signalsRef = ref(database, `online/strategyRooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try { await handleSignal(snapshot.val()); } finally { await remove(snapshot.ref).catch(() => {}); }
  }));
  if (state.playerIndex === 0) {
    const channel = peer.createDataChannel("hariai-strategy-images", { ordered: true });
    configureDataChannel(channel);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
  }
}

async function sendSignal(type, payload) {
  await set(push(ref(database, `online/strategyRooms/${state.roomId}/signals/${state.opponentUid}`)), { fromUid: state.uid, type, payload: JSON.stringify(payload), createdAt: Date.now() });
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
    if (state.screen === "connecting") state.screen = "intro";
    render();
    reactToRoomData().catch(handleRecoverableError);
  };
  channel.onclose = () => { state.channelReady = false; state.peerStatus = "P2P接続が切れました"; };
  channel.onerror = () => showToast("画像・音声転送で通信エラーが発生しました。");
  channel.onmessage = (event) => handleChannelMessage(event.data).catch(handleRecoverableError);
}

function imageKey(kind, round) {
  return `${kind}:${round}`;
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
    } else if (message.type === "strategy-image-start") {
      state.incomingTransfer = { kind: message.kind, round: message.round, ownerUid: message.ownerUid, actionType: message.actionType || "", mime: message.mime, size: message.size, hasAudio: message.hasAudio === true, chunks: [], received: 0 };
    } else if (message.type === "strategy-image-end") {
      await finishIncomingImage(message.kind, message.round, message.ownerUid);
    } else if (message.type === "strategy-audio-start") {
      const size = Number(message.size);
      const duration = Number(message.duration);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_TRANSFER_BYTES) throw new Error("添付音声の受信サイズが不正です。");
      if (message.mime !== "audio/wav" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS + 0.1) throw new Error("添付音声の形式が不正です。");
      state.incomingAudioTransfer = { kind: message.kind, round: message.round, ownerUid: message.ownerUid, mime: "audio/wav", size, duration, cueStart: Number(message.cueStart || 0), chunks: [], received: 0 };
    } else if (message.type === "strategy-audio-end") {
      await finishIncomingAudio(message.kind, message.round, message.ownerUid);
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
  if (state.incomingAudioTransfer) {
    const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
    state.incomingAudioTransfer.chunks.push(chunk);
    state.incomingAudioTransfer.received += chunk.byteLength;
    if (state.incomingAudioTransfer.received > state.incomingAudioTransfer.size) {
      state.incomingAudioTransfer = null;
      throw new Error("添付音声の受信サイズが一致しませんでした。");
    }
    state.transferProgress = Math.min(99, Math.round((state.incomingAudioTransfer.received / state.incomingAudioTransfer.size) * 100));
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
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
  if (["identity", "waitingBattle", "baseSelect", "waitingBasePick", "waitingBaseImage", "baseReveal", "baseRating", "waitingBaseRating", "actionSelect", "waitingAction", "waitingActionImage", "actionReveal", "actionRating", "waitingActionRating", "result", "waitingContinue", "weaknessGuess", "waitingWeaknessGuess", "weaknessChainSelect", "waitingWeaknessChain", "waitingWeaknessChainImage", "weaknessChainResult", "waitingWeaknessContinue"].includes(state.screen)) render();
}

function releaseRemoteAvatar() {
  if (state.remoteAvatar?.url) URL.revokeObjectURL(state.remoteAvatar.url);
  state.remoteAvatar = null;
  state.incomingAvatarTransfer = null;
}

async function finishIncomingImage(kind, round, ownerUid) {
  const transfer = state.incomingTransfer;
  if (!transfer || transfer.kind !== kind || transfer.round !== round || transfer.ownerUid !== ownerUid || transfer.received !== transfer.size) throw new Error("受信画像のサイズが一致しませんでした。");
  const key = imageKey(kind, round);
  const previous = state.remoteImages.get(key);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  releaseCardAudio(previous);
  const blob = new Blob(transfer.chunks, { type: transfer.mime || "image/webp" });
  state.remoteImages.set(key, { blob, url: URL.createObjectURL(blob), actionType: transfer.actionType, awaitingAudio: transfer.hasAudio });
  state.incomingTransfer = null;
  state.transferProgress = 100;
  if (!transfer.hasAudio) await acknowledgeStrategyMedia(kind, round, ownerUid);
}

async function finishIncomingAudio(kind, round, ownerUid) {
  const transfer = state.incomingAudioTransfer;
  if (!transfer || transfer.kind !== kind || transfer.round !== round || transfer.ownerUid !== ownerUid || transfer.received !== transfer.size) throw new Error("受信音声のサイズが一致しませんでした。");
  const item = state.remoteImages.get(imageKey(kind, round));
  if (!item?.awaitingAudio) throw new Error("音声に対応する画像を確認できませんでした。");
  const blob = new Blob(transfer.chunks, { type: "audio/wav" });
  item.audioBlob = blob;
  item.audioUrl = URL.createObjectURL(blob);
  item.audioDuration = transfer.duration;
  item.audioCueStart = Math.max(0, Math.min(Math.max(0, transfer.duration - AUDIO_HIGHLIGHT_SECONDS), transfer.cueStart || 0));
  item.awaitingAudio = false;
  state.incomingAudioTransfer = null;
  state.transferProgress = 100;
  await acknowledgeStrategyMedia(kind, round, ownerUid);
}

async function acknowledgeStrategyMedia(kind, round, ownerUid) {
  if (kind === "base") await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${round}/baseImagesReceived/${state.uid}`), true);
  else if (kind === "action") await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${round}/actionImagesReceived/${ownerUid}/${state.uid}`), true);
  else if (kind === "weaknessChain") await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessChainImagesReceived/${ownerUid}/${state.uid}/${round}`), true);
}

async function sendImage(item, kind, actionType = "", slot = state.round) {
  const key = imageKey(kind, slot);
  if (state.sentImageKeys.has(key) || !item?.blob || !state.channel || state.channel.readyState !== "open") return;
  state.sentImageKeys.add(key);
  state.screen = kind === "base" ? "waitingBaseImage" : kind === "weaknessChain" ? "waitingWeaknessChainImage" : "waitingActionImage";
  state.transferProgress = 0;
  render();
  const buffer = await item.blob.arrayBuffer();
  const audioBuffer = item.audioBlob ? await item.audioBlob.arrayBuffer() : null;
  try {
    state.channel.send(JSON.stringify({ type: "strategy-image-start", kind, round: slot, ownerUid: state.uid, actionType, size: buffer.byteLength, mime: item.blob.type || "image/webp", hasAudio: Boolean(audioBuffer) }));
    for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
      await waitForDataBuffer();
      state.channel.send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      state.transferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
    }
    state.channel.send(JSON.stringify({ type: "strategy-image-end", kind, round: slot, ownerUid: state.uid }));
    if (audioBuffer) {
      state.transferProgress = 0;
      state.channel.send(JSON.stringify({ type: "strategy-audio-start", kind, round: slot, ownerUid: state.uid, size: audioBuffer.byteLength, mime: "audio/wav", duration: Number(item.audioDuration || 0), cueStart: Number(item.audioCueStart || 0) }));
      for (let offset = 0; offset < audioBuffer.byteLength; offset += DATA_CHUNK_BYTES) {
        await waitForDataBuffer();
        state.channel.send(audioBuffer.slice(offset, Math.min(audioBuffer.byteLength, offset + DATA_CHUNK_BYTES)));
        state.transferProgress = Math.round((Math.min(audioBuffer.byteLength, offset + DATA_CHUNK_BYTES) / audioBuffer.byteLength) * 100);
      }
      state.channel.send(JSON.stringify({ type: "strategy-audio-end", kind, round: slot, ownerUid: state.uid }));
    }
  } catch (error) {
    state.sentImageKeys.delete(key);
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

async function submitDecision(decision) {
  state.screen = decision === "withdraw" ? "withdrawn" : "waitingDecision";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/decisions/${state.uid}`), decision);
}

async function addDeckFiles(zone, files) {
  const limit = zone === "main" ? MAIN_COUNT : RESERVE_COUNT;
  const room = Math.max(0, limit - state[zone].length);
  if (!room) return;
  setBusy(true, "デッキ画像を準備しています…");
  try {
    for (const file of files.slice(0, room)) {
      const position = zone === "main" ? state.main.length : MAIN_COUNT + state.reserve.length;
      state[zone].push(await shared().processImageFile(file, position, { maxSide: 1280, quality: 0.84 }));
    }
    if (files.length > room) showToast(`${limit}枚を超えた画像は追加していません。`);
  } catch (error) {
    showToast(error.message || "画像を追加できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function findDeckCard(token) {
  const [zone, id] = String(token || "").split(":");
  if (!['main', 'reserve'].includes(zone)) return {};
  return { zone, item: state[zone].find((card) => card.id === id) };
}

async function addCardAudio(token, file) {
  const { item } = findDeckCard(token);
  if (!item || !file) return;
  setBusy(true, "音声を10秒以下・モノラルWAVへ変換しています…");
  try {
    const audio = await processStrategyAudioFile(file);
    releaseCardAudio(item);
    Object.assign(item, audio);
    showToast(file.size > audio.audioBlob.size ? "音声を軽量化して画像に添付しました。" : "音声を画像に添付しました。");
  } catch (error) {
    showToast(error.message || "音声を添付できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function removeCardAudio(token) {
  const { item } = findDeckCard(token);
  if (!item) return;
  releaseCardAudio(item);
  render();
}

function updateCardAudioCue(token, value, input) {
  const { item } = findDeckCard(token);
  if (!item?.audioBlob) return;
  const max = Math.max(0, Number(item.audioDuration || 0) - AUDIO_HIGHLIGHT_SECONDS);
  item.audioCueStart = Math.max(0, Math.min(max, Number(value) || 0));
  const output = input?.parentElement?.querySelector("output");
  if (output) output.textContent = `${item.audioCueStart.toFixed(1)}秒〜`;
}

function playAudioUrl(url, start = 0, duration = 0) {
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.preload = "auto";
    let settled = false;
    let timer = 0;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.pause();
      audio.removeAttribute("src");
      resolve();
    };
    const begin = () => {
      audio.currentTime = Math.max(0, Math.min(Number(start) || 0, Math.max(0, audio.duration - 0.05)));
      audio.play().then(() => {
        if (Number.isFinite(playSeconds)) timer = window.setTimeout(cleanup, playSeconds * 1000);
      }).catch(() => { showToast("音声を再生できませんでした。もう一度再生ボタンを押してください。"); cleanup(); });
    };
    const playSeconds = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    audio.addEventListener("loadedmetadata", begin, { once: true });
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.load();
  });
}

async function openStrategyMedia(kind) {
  const key = imageKey(kind, state.round);
  state.openedMediaKeys.add(key);
  const item = state.remoteImages.get(key);
  render();
  if (item?.audioUrl) await playAudioUrl(item.audioUrl, 0, Number(item.audioDuration || 0));
}

function declareWeaknessGuess() {
  if (state.weaknessPhaseComplete || state.round > WEAKNESS_SCOUT_ROUND || state.roomData?.weaknessGuesses?.[state.uid]) return;
  state.weaknessTriggerRound = state.round;
  state.selectedWeaknessGuess = null;
  state.screen = "weaknessGuess";
  setStrategyChrome("WEAKNESS GUESS");
  render();
}

async function fillDeckSamples(zone) {
  const limit = zone === "main" ? MAIN_COUNT : RESERVE_COUNT;
  const missing = limit - state[zone].length;
  if (missing <= 0) return;
  setBusy(true, "サンプル画像を生成しています…");
  try {
    const offset = zone === "main" ? state.main.length : MAIN_COUNT + state.reserve.length;
    state[zone].push(...await shared().createSampleItems(state.playerIndex, missing, offset));
  } catch (error) {
    showToast(error.message || "サンプル画像を生成できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function removeDeckItem(token) {
  const [zone, id] = token.split(":");
  const index = state[zone].findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = state[zone].splice(index, 1);
  releaseCardAudio(removed);
  URL.revokeObjectURL(removed.url);
  render();
}

async function lockDeck() {
  if (state.main.length !== MAIN_COUNT) return showToast("メインデッキを5枚そろえてください。");
  state.screen = "waitingDeck";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/deckReady/${state.uid}`), { ready: true, mainCount: state.main.length, reserveCount: state.reserve.length, lockedAt: serverTimestamp() });
}

async function startBattle() {
  state.screen = "waitingBattle";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/battleReady/${state.uid}`), true);
}

async function lockBaseCard(cardId) {
  const item = state.main.find((card) => card.id === cardId && !card.used);
  if (!item || !state.channelReady) return;
  state.selectedBaseId = cardId;
  item.used = true;
  state.localBaseCards.set(state.round, item);
  state.screen = "waitingBasePick";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/basePicks/${state.uid}`), { ready: true, lockedAt: serverTimestamp() });
}

async function lockBaseRating() {
  if (!state.selectedScore) return;
  const score = state.selectedScore;
  const reaction = normalizeReaction(state.selectedReaction, state.selectedScore);
  state.selectedScore = 0;
  state.selectedReaction = "normal";
  state.screen = "waitingBaseRating";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/ratings/${state.uid}`), { score, reaction, lockedAt: serverTimestamp() });
}

function localActionType() {
  const rating = currentRoundData().ratings?.[state.opponentUid];
  return normalizeReaction(rating?.reaction, Number(rating?.score || 0));
}

function localOpponentActionType() {
  return currentRoundData().actionPicks?.[state.opponentUid]?.type || "normal";
}

async function lockActionCard(cardId) {
  const item = state.reserve.find((card) => card.id === cardId && !card.used);
  const type = localActionType();
  if (!item || !["request", "pursuit"].includes(type)) return;
  item.used = true;
  state.localActionCards.set(state.round, item);
  state.screen = "waitingActionPick";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/actionPicks/${state.uid}`), { ready: true, type, skipped: false, lockedAt: serverTimestamp() });
}

async function skipPursuit() {
  if (localActionType() !== "pursuit") return;
  state.screen = "waitingActionPick";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/actionPicks/${state.uid}`), { ready: true, type: "pursuit", skipped: true, lockedAt: serverTimestamp() });
}

async function lockActionRating() {
  if (!state.selectedScore) return;
  const score = state.selectedScore;
  state.selectedScore = 0;
  state.screen = "waitingActionRating";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/actionRatings/${state.uid}`), { score, lockedAt: serverTimestamp() });
}

async function continueRound() {
  state.screen = "waitingContinue";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/continue/${state.uid}`), true);
}

async function lockWeaknessGuess(event) {
  event.preventDefault();
  const selected = Number(document.querySelector('input[name="weaknessGuess"]:checked')?.value);
  if (!Number.isInteger(selected) || selected < 0 || selected > 2) return showToast("相手の弱点候補を1つ選んでください。");
  state.selectedWeaknessGuess = selected;
  const existingGuess = Object.values(state.roomData?.weaknessGuesses || {}).find((guess) => Number.isInteger(Number(guess?.round)));
  const triggerRound = Math.max(1, Math.min(WEAKNESS_SCOUT_ROUND, Number(existingGuess?.round || state.weaknessTriggerRound || state.round)));
  state.weaknessTriggerRound = triggerRound;
  state.screen = "waitingWeaknessGuess";
  render();
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessGuesses/${state.uid}`), { guessIndex: selected, round: triggerRound, lockedAt: serverTimestamp() });
  } catch (error) {
    console.error(error);
    state.screen = "weaknessGuess";
    render();
    showToast("回答を送信できませんでした。通信状態を確認して、もう一度お試しください。");
  }
}

function toggleWeaknessChainCard(cardId) {
  const available = state.reserve.find((item) => item.id === cardId && !item.used);
  if (!available) return;
  const selected = state.selectedWeaknessChainIds;
  const index = selected.indexOf(cardId);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length < MAX_WEAKNESS_CHAIN) selected.push(cardId);
  else return showToast(`連続追撃に選べる画像は最大${MAX_WEAKNESS_CHAIN}枚です。`);
  render();
}

async function lockWeaknessChain() {
  const cards = state.selectedWeaknessChainIds.map((cardId) => state.reserve.find((item) => item.id === cardId && !item.used)).filter(Boolean).slice(0, MAX_WEAKNESS_CHAIN);
  if (!cards.length) return showToast("連続追撃に使うリザーブ画像を選んでください。");
  cards.forEach((item) => { item.used = true; });
  state.localWeaknessChainCards = cards;
  state.weaknessChainLocked = true;
  state.screen = "waitingWeaknessChain";
  render();
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessChains/${state.uid}`), { ready: true, count: cards.length, lockedAt: serverTimestamp() });
  } catch (error) {
    console.error(error);
    cards.forEach((item) => { item.used = false; });
    state.localWeaknessChainCards = [];
    state.weaknessChainLocked = false;
    state.screen = "weaknessChainSelect";
    render();
    showToast("追撃画像を確定できませんでした。通信状態を確認して、もう一度お試しください。");
  }
}

async function continueAfterWeaknessChain() {
  state.screen = "waitingWeaknessContinue";
  render();
  await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessContinue/${state.uid}`), true);
}

async function surrenderToWeaknessBreak() {
  if (!getOpponent()?.weaknessCorrect || getLocalPlayer()?.hp <= 0 || state.roomData?.weaknessSurrenders?.[state.uid]) return;
  await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessSurrenders/${state.uid}`), { surrendered: true, at: serverTimestamp() })
    .catch(() => showToast("降参を送信できませんでした。通信状態を確認してください。"));
}

function applyWeaknessSurrenders(surrenders) {
  if (!state.weaknessResult) return;
  let changed = false;
  state.players.forEach((player, index) => {
    if (surrenders[player.uid]?.surrendered === true && state.players[1 - index].weaknessCorrect && !state.weaknessResult.surrenders[index]) {
      player.hp = 0;
      state.weaknessResult.surrenders[index] = true;
      changed = true;
    }
  });
  if (!changed) return;
  state.weaknessSurrenderApplied = true;
  setStrategyChrome("SURRENDER KO");
  triggerCriticalFx("SURRENDER KO");
  if (state.screen === "weaknessChainResult") render();
}

async function playWeaknessChainSequence() {
  if (state.chainPlaybackActive || !state.weaknessResult) return;
  state.chainPlaybackActive = true;
  const button = document.querySelector("#strategyPlayWeaknessChain");
  if (button) { button.disabled = true; button.textContent = "連続追撃 再生中…"; }
  try {
    const opponentIndex = 1 - state.playerIndex;
    const owner = Number(state.weaknessResult.chainCounts[state.playerIndex] || 0) > 0 ? state.playerIndex : opponentIndex;
    const count = Number(state.weaknessResult.chainCounts[owner] || 0);
    for (let index = 0; index < count; index += 1) {
      const card = document.querySelector(`[data-chain-owner="${owner}"][data-chain-slot="${index}"]`);
      card?.classList.add("is-playing");
      const item = owner === state.playerIndex ? state.localWeaknessChainCards[index] : state.remoteImages.get(imageKey("weaknessChain", index));
      if (item?.audioUrl) await playAudioUrl(item.audioUrl, Number(item.audioCueStart || 0), Math.min(AUDIO_HIGHLIGHT_SECONDS, Number(item.audioDuration || AUDIO_HIGHLIGHT_SECONDS)));
      else await new Promise((resolve) => window.setTimeout(resolve, 420));
      card?.classList.remove("is-playing");
    }
  } finally {
    state.chainPlaybackActive = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = "怒涛の連続追撃を再生"; }
  }
}

async function verifyWeaknessReveals(guesses, reveals) {
  const guessRounds = state.players.map((player) => Number(guesses[player.uid]?.round));
  if (!guessRounds.every((round) => Number.isInteger(round) && round >= 1 && round <= WEAKNESS_SCOUT_ROUND && round === guessRounds[0])) return false;
  state.weaknessTriggerRound = guessRounds[0];
  for (const player of state.players) {
    const reveal = reveals[player.uid];
    const expected = await sha256Hex(`${state.roomId}:${player.uid}:${Number(reveal?.weaknessIndex)}:${String(reveal?.salt || "")}`);
    if (!player.weaknessCommit || expected !== player.weaknessCommit) return false;
  }
  state.players.forEach((player, index) => {
    const opponent = state.players[1 - index];
    player.weaknessIndex = Number(reveals[player.uid].weaknessIndex);
    player.weaknessGuess = Number(guesses[player.uid].guessIndex);
    player.weaknessCorrect = player.weaknessGuess === Number(reveals[opponent.uid].weaknessIndex);
  });
  return true;
}

async function failWeaknessIntegrityCheck(message = "弱点コミットの照合に失敗しました。この対戦はノーコンテストです。") {
  if (state.weaknessIntegrityFailed) return;
  state.weaknessIntegrityFailed = true;
  await runTransaction(ref(database, `online/strategyRooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now() }).catch(() => {});
  handleFatalError(new Error(message));
}

async function sendWeaknessChainImages(count) {
  for (let index = 0; index < count; index += 1) {
    await sendImage(state.localWeaknessChainCards[index], "weaknessChain", "pursuit", index);
  }
}

function weaknessChainImagesReady(chains, receipts) {
  return state.players.every((player, owner) => {
    const count = Math.max(0, Math.min(MAX_WEAKNESS_CHAIN, Number(chains[player.uid]?.count || 0)));
    if (!count) return true;
    const recipientUid = state.players[1 - owner].uid;
    const acknowledged = Array.from({ length: count }, (_, index) => receipts[player.uid]?.[recipientUid]?.[index] === true).every(Boolean);
    if (!acknowledged) return false;
    if (owner === state.playerIndex) return state.localWeaknessChainCards.length >= count;
    return Array.from({ length: count }, (_, index) => state.remoteImages.has(imageKey("weaknessChain", index))).every(Boolean);
  });
}

function weaknessChainsValid(chains) {
  return state.players.every((player) => {
    const count = Number(chains[player.uid]?.count);
    return Number.isInteger(count)
      && count >= 0
      && count <= Math.min(MAX_WEAKNESS_CHAIN, remainingReserve(player))
      && (count === 0 || player.weaknessCorrect);
  });
}

function resolveWeaknessChain(guesses, chains) {
  if (state.weaknessChainApplied) return;
  state.weaknessChainApplied = true;
  const chainCounts = state.players.map((player) => Math.max(0, Math.min(MAX_WEAKNESS_CHAIN, Number(chains[player.uid]?.count || 0))));
  const chainDamage = chainCounts.map((count) => WEAKNESS_CHAIN_DAMAGE.slice(0, count).reduce((sum, damage) => sum + damage, 0));
  const hpBefore = state.players.map((player) => player.hp);
  const missDamage = state.players.map((player) => player.weaknessCorrect ? 0 : WEAKNESS_MISS_DAMAGE);
  const hpAfterMiss = hpBefore.map((hp, index) => Math.max(0, hp - missDamage[index]));
  const overkill = [0, 0];
  state.players.forEach((player, owner) => {
    player.weaknessChainCount = chainCounts[owner];
    player.reserveUsed += chainCounts[owner];
    player.totalPower += chainDamage[owner];
    const defender = state.players[1 - owner];
    overkill[1 - owner] = Math.max(0, chainDamage[owner] - hpAfterMiss[1 - owner]);
    defender.hp = Math.max(0, hpAfterMiss[1 - owner] - chainDamage[owner]);
  });
  state.players.forEach((player, index) => { player.overkill = overkill[index]; });
  state.weaknessResult = { guesses, chainCounts, chainDamage, missDamage, hpBefore, overkill, surrenders: [false, false] };
  state.screen = "weaknessChainResult";
  const overkillTotal = overkill.reduce((sum, value) => sum + value, 0);
  const weaknessBroken = state.players.some((player) => player.weaknessCorrect);
  setStrategyChrome(overkillTotal > 0 ? "OVERKILL" : weaknessBroken ? "WEAKNESS BREAK" : "WEAKNESS REVEAL");
  if (weaknessBroken) triggerCriticalFx(overkillTotal > 0 ? `OVERKILL +${overkillTotal}` : "WEAKNESS BREAK");
  render();
}

async function advanceAfterWeaknessPhase() {
  if (state.weaknessPhaseComplete) return;
  state.weaknessPhaseComplete = true;
  if (state.players.some((player) => player.hp <= 0)) {
    await finishMatch();
    return;
  }
  state.round = Math.max(1, Math.min(WEAKNESS_SCOUT_ROUND, Number(state.weaknessTriggerRound || state.round))) + 1;
  state.currentResult = null;
  state.selectedBaseId = "";
  state.selectedScore = 0;
  state.selectedReaction = "normal";
  state.screen = "baseSelect";
  setStrategyChrome("STRATEGY ONLINE BATTLE");
  render();
  await reactToRoomData();
}

async function reactToWeaknessPhase() {
  if (state.weaknessIntegrityFailed || state.weaknessPhaseComplete) return;
  const guesses = state.roomData?.weaknessGuesses || {};
  const firstGuess = Object.values(guesses).find((guess) => Number.isInteger(Number(guess?.round)));
  if (firstGuess) state.weaknessTriggerRound = Math.max(1, Math.min(WEAKNESS_SCOUT_ROUND, Number(firstGuess.round)));
  if (!both(guesses)) {
    if (guesses[state.opponentUid] && !guesses[state.uid] && state.screen !== "weaknessGuess") {
      state.selectedWeaknessGuess = null;
      state.screen = "weaknessGuess";
      setStrategyChrome("WEAKNESS GUESS");
      render();
    }
    return;
  }
  const reveals = state.roomData?.weaknessReveals || {};
  if (!reveals[state.uid]) {
    await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessReveals/${state.uid}`), {
      weaknessIndex: state.weaknessIndex,
      salt: state.weaknessSalt,
      revealedAt: serverTimestamp(),
    });
    return;
  }
  if (!both(reveals)) return;
  if (!state.weaknessRevealsVerified) {
    const verified = await verifyWeaknessReveals(guesses, reveals);
    if (!verified) {
      await failWeaknessIntegrityCheck();
      return;
    }
    state.weaknessRevealsVerified = true;
  }

  const chains = state.roomData?.weaknessChains || {};
  const localPlayer = getLocalPlayer();
  const availableReserve = state.reserve.filter((item) => !item.used);
  if (!chains[state.uid]) {
    if (state.weaknessChainLocked) {
      if (state.screen !== "waitingWeaknessChain") { state.screen = "waitingWeaknessChain"; render(); }
      return;
    }
    if (localPlayer.weaknessCorrect && availableReserve.length) {
      if (state.screen !== "weaknessChainSelect") {
        state.selectedWeaknessChainIds = [];
        state.screen = "weaknessChainSelect";
        render();
      }
      return;
    }
    state.weaknessChainLocked = true;
    state.screen = "waitingWeaknessChain";
    render();
    try {
      await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessChains/${state.uid}`), { ready: true, count: 0, lockedAt: serverTimestamp() });
    } catch (error) {
      console.error(error);
      state.weaknessChainLocked = false;
      showToast("弱点判定を送信できませんでした。通信状態を確認してください。");
    }
    return;
  }
  if (!both(chains)) {
    if (state.screen !== "weaknessChainSelect") { state.screen = "waitingWeaknessChain"; render(); }
    return;
  }
  if (!weaknessChainsValid(chains)) {
    await failWeaknessIntegrityCheck("連続追撃の枚数または弱点判定を照合できませんでした。この対戦はノーコンテストです。");
    return;
  }

  const localCount = Math.max(0, Math.min(MAX_WEAKNESS_CHAIN, Number(chains[state.uid]?.count || 0)));
  if (localCount) await sendWeaknessChainImages(localCount);
  const receipts = state.roomData?.weaknessChainImagesReceived || {};
  if (!weaknessChainImagesReady(chains, receipts)) {
    if (state.screen !== "waitingWeaknessChainImage") { state.screen = "waitingWeaknessChainImage"; render(); }
    return;
  }
  resolveWeaknessChain(guesses, chains);
  applyWeaknessSurrenders(state.roomData?.weaknessSurrenders || {});
  const continued = state.roomData?.weaknessContinue || {};
  if (both(continued)) await advanceAfterWeaknessPhase();
}

function currentRoundData() {
  return state.roomData?.rounds?.[state.round] || {};
}

function both(object) {
  return Boolean(object?.[state.uid] && object?.[state.opponentUid]);
}

async function reactToRoomData() {
  if (!active || !state.roomId) return;
  if (state.reacting) { state.reactAgain = true; return; }
  state.reacting = true;
  try {
    if (state.roomData.destroyed && state.roomData.destroyed.by !== state.uid) return handleOpponentDestroyed();
    const decisions = state.roomData.decisions || {};
    if (Object.values(decisions).includes("withdraw")) {
      if (state.screen !== "withdrawn") { state.screen = "withdrawn"; render(); }
      return;
    }
    if (decisions[state.uid] === "accept" && decisions[state.opponentUid] === "accept" && ["intro", "waitingDecision"].includes(state.screen)) {
      state.screen = "deck";
      render();
    }
    const deckReady = state.roomData.deckReady || {};
    if (both(deckReady) && ["deck", "waitingDeck"].includes(state.screen)) {
      state.players.forEach((player) => {
        const data = deckReady[player.uid] || {};
        player.mainCount = Number(data.mainCount || MAIN_COUNT);
        player.reserveCount = Number(data.reserveCount || 0);
      });
      state.screen = "identity";
      render();
    }
    if (both(state.roomData.battleReady) && ["identity", "waitingBattle"].includes(state.screen)) {
      state.screen = "baseSelect";
      render();
    }
    if (both(state.roomData.battleReady)) {
      if (Object.keys(state.roomData?.weaknessGuesses || {}).length && !state.weaknessPhaseComplete) await reactToWeaknessPhase();
      else if (state.round === WEAKNESS_SCOUT_ROUND && state.advancedRounds.has(WEAKNESS_SCOUT_ROUND) && !state.weaknessPhaseComplete) await reactToWeaknessPhase();
      else await reactToRoundData();
    }
  } finally {
    state.reacting = false;
    if (state.reactAgain) {
      state.reactAgain = false;
      queueMicrotask(() => reactToRoomData().catch(handleRecoverableError));
    }
  }
}

async function reactToRoundData() {
  const data = currentRoundData();
  state.roundData = data;
  if (state.processedRounds.has(state.round) && both(data.continue)) {
    await advanceRoundOrFinish();
    return;
  }
  const basePicks = data.basePicks || {};
  if (both(basePicks) && !state.sentImageKeys.has(imageKey("base", state.round))) {
    await sendImage(state.localBaseCards.get(state.round), "base");
  }
  if (both(data.baseImagesReceived) && state.remoteImages.has(imageKey("base", state.round))
      && ["baseSelect", "waitingBasePick", "waitingBaseImage"].includes(state.screen)) {
    state.screen = "baseReveal";
    render();
  }
  const ratings = data.ratings || {};
  if (!both(ratings)) return;
  const actionPicks = data.actionPicks || {};
  if (!actionPicks[state.uid]) {
    const type = localActionType();
    if (type === "normal" || !state.reserve.some((item) => !item.used)) {
      await set(ref(database, `online/strategyRooms/${state.roomId}/rounds/${state.round}/actionPicks/${state.uid}`), { ready: true, type: "normal", skipped: true, lockedAt: serverTimestamp() });
      if (["baseReveal", "baseRating", "waitingBaseRating"].includes(state.screen)) { state.screen = "waitingActionPick"; render(); }
    } else if (["baseReveal", "baseRating", "waitingBaseRating"].includes(state.screen)) {
      state.screen = "actionSelect";
      render();
    }
    return;
  }
  if (!both(actionPicks)) return;
  const localPick = actionPicks[state.uid];
  const opponentPick = actionPicks[state.opponentUid];
  if (!localPick.skipped && !state.sentImageKeys.has(imageKey("action", state.round))) {
    await sendImage(state.localActionCards.get(state.round), "action", localPick.type);
  }
  const actionReceipts = data.actionImagesReceived || {};
  const localSentReady = localPick.skipped || actionReceipts[state.uid]?.[state.opponentUid] === true;
  const remoteSentReady = opponentPick.skipped || (actionReceipts[state.opponentUid]?.[state.uid] === true && state.remoteImages.has(imageKey("action", state.round)));
  if (!localSentReady || !remoteSentReady) return;
  const anyAction = !localPick.skipped || !opponentPick.skipped;
  if (!anyAction) {
    resolveRound(data);
    return;
  }
  const actionRatings = data.actionRatings || {};
  const localRatingRequired = !opponentPick.skipped;
  const opponentRatingRequired = !localPick.skipped;
  const allRatingsReady = (!localRatingRequired || Number.isInteger(actionRatings[state.uid]?.score))
    && (!opponentRatingRequired || Number.isInteger(actionRatings[state.opponentUid]?.score));
  if (allRatingsReady) {
    resolveRound(data);
    return;
  }
  if (["waitingActionPick", "waitingActionImage", "actionSelect", "waitingBaseRating"].includes(state.screen)) {
    state.screen = "actionReveal";
    render();
  }
}

function resolveRound(data) {
  if (state.processedRounds.has(state.round)) return;
  const ratings = data.ratings || {};
  const picks = data.actionPicks || {};
  const actionRatings = data.actionRatings || {};
  const baseScores = [0, 1].map((owner) => Number(ratings[state.players[1 - owner].uid]?.score || 0));
  const actions = [0, 1].map((owner) => {
    const pick = picks[state.players[owner].uid] || { type: "normal", skipped: true };
    return { type: pick.type || "normal", cardShown: !pick.skipped };
  });
  const actionScores = [0, 1].map((owner) => actions[owner].cardShown ? Number(actionRatings[state.players[1 - owner].uid]?.score || 0) : 0);
  const powers = baseScores.map((base, owner) => {
    if (actions[owner].type === "request" && actionScores[owner]) return Math.max(base, actionScores[owner]);
    if (actions[owner].type === "pursuit" && actionScores[owner]) return base + Math.ceil(actionScores[owner] / 2);
    return base;
  });
  const damage = [0, 0];
  state.processedRounds.add(state.round);
  state.players.forEach((player, owner) => {
    const rater = state.players[1 - owner];
    const reaction = normalizeReaction(ratings[rater.uid]?.reaction, Number(ratings[rater.uid]?.score || 0));
    if (reaction === "request") rater.extraRequests = Math.max(0, rater.extraRequests - 1);
    if (reaction === "pursuit") rater.pursuitPermits = Math.max(0, rater.pursuitPermits - 1);
    if (actions[owner].cardShown) player.reserveUsed += 1;
    player.totalPower += powers[owner];
    player.receivedScores.push(baseScores[owner]);
    if (actionScores[owner]) player.receivedScores.push(actionScores[owner]);
  });
  if (powers[0] > powers[1]) { damage[1] = powers[0]; state.players[1].hp = Math.max(0, state.players[1].hp - powers[0]); }
  else if (powers[1] > powers[0]) { damage[0] = powers[1]; state.players[0].hp = Math.max(0, state.players[0].hp - powers[1]); }
  const result = { round: state.round, baseScores, actions, actionScores, powers, damage };
  state.history.push(result);
  state.currentResult = result;
  state.screen = "roundResult";
  window.HariaiAudio?.playResult?.(Math.max(...powers));
  if (Math.max(...powers) >= 9) triggerCriticalFx(Math.max(...powers) >= 10 ? "PERFECT!!" : "CRITICAL!");
  render();
}

async function advanceRoundOrFinish() {
  if (state.advancedRounds.has(state.round)) return;
  state.advancedRounds.add(state.round);
  if (state.round === WEAKNESS_SCOUT_ROUND && !state.weaknessPhaseComplete) {
    state.weaknessTriggerRound = WEAKNESS_SCOUT_ROUND;
    state.screen = "weaknessGuess";
    setStrategyChrome("WEAKNESS GUESS");
    render();
    await reactToWeaknessPhase();
    return;
  }
  if (isGameOver()) {
    await finishMatch();
    return;
  }
  state.round += 1;
  state.currentResult = null;
  state.selectedBaseId = "";
  state.selectedScore = 0;
  state.selectedReaction = "normal";
  state.screen = "baseSelect";
  render();
  await reactToRoomData();
}

function isGameOver() {
  if (!state.weaknessPhaseComplete && state.round <= WEAKNESS_SCOUT_ROUND) return false;
  return state.round >= MAX_ROUNDS || state.players.some((player) => player.hp <= 0);
}

function determineOutcome() {
  const [first, second] = state.players;
  if (first.hp !== second.hp) return { winnerIndex: first.hp > second.hp ? 0 : 1 };
  if (first.totalPower !== second.totalPower) return { winnerIndex: first.totalPower > second.totalPower ? 0 : 1 };
  return { winnerIndex: -1 };
}

async function finishMatch() {
  const outcome = determineOutcome();
  const draw = outcome.winnerIndex < 0;
  const won = outcome.winnerIndex === state.playerIndex;
  await update(ref(database, `online/strategyRooms/${state.roomId}`), {
    [`resultClaims/${state.uid}`]: {
      outcome: draw ? "draw" : won ? "win" : "loss",
      createdAt: serverTimestamp(),
    },
    [`finished/${state.uid}`]: true,
  });
  await commitStrategyStats();
  state.screen = "gameover";
  setStrategyChrome("STRATEGY COMPLETE");
  render();
}

function calculateRating(currentRating, opponentRating, actualScore) {
  const expected = 1 / (1 + (10 ** ((opponentRating - currentRating) / 400)));
  return Math.min(3000, Math.max(100, Math.round(currentRating + RATING_K_FACTOR * (actualScore - expected))));
}

async function commitStrategyStats() {
  if (state.statsCommitted) return;
  state.statsCommitted = true;
  const outcome = determineOutcome();
  const draw = outcome.winnerIndex < 0;
  const won = outcome.winnerIndex === state.playerIndex;
  const opponentRating = Number(getOpponent().rating || INITIAL_RATING);
  const result = await runTransaction(ref(database, `online/strategyProfiles/${state.uid}`), (current) => {
    const record = {
      name: state.name,
      wins: Number(current?.wins || 0),
      losses: Number(current?.losses || 0),
      draws: Number(current?.draws || 0),
      streak: Number(current?.streak || 0),
      bestStreak: Number(current?.bestStreak || 0),
      rating: Number(current?.rating || INITIAL_RATING),
      updatedAt: Date.now(),
    };
    if (draw) record.draws += 1;
    else if (won) { record.wins += 1; record.streak += 1; record.bestStreak = Math.max(record.bestStreak, record.streak); }
    else { record.losses += 1; record.streak = 0; }
    record.rating = calculateRating(record.rating, opponentRating, draw ? 0.5 : won ? 1 : 0);
    return record;
  });
  if (result.committed) {
    state.profile = normalizeProfile(result.snapshot.val());
    const overallUpdate = window.HariaiOnline?.recordOverallResult?.({
      mode: "strategy",
      outcome: draw ? "draw" : won ? "win" : "loss",
      name: state.name,
      opponentRating,
      roomId: state.roomId,
    });
    if (overallUpdate) await overallUpdate.catch(() => showToast("総合ランキングを更新できませんでした。"));
  }
}

function getLocalPlayer() {
  return state.players[state.playerIndex];
}

function getOpponent() {
  return state.players[state.playerIndex === 0 ? 1 : 0];
}

function remainingReserve(player) {
  return Math.max(0, Number(player?.reserveCount || 0) - Number(player?.reserveUsed || 0));
}

function average(values) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : "0.0";
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  await set(ref(database, `online/publicPresenceOwners/${presenceId}`), state.uid);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await writePublicPresence(presenceRef, "waiting");
  const disconnect = onDisconnect(presenceRef);
  await disconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (state.publicPresenceId) writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), state.publicPresenceState).catch(() => {});
  }, HEARTBEAT_MS);
}

async function writePublicPresence(presenceRef, presenceState) {
  await set(presenceRef, { mode: "strategy", state: presenceState, lastSeen: Date.now() });
}

async function updatePublicPresence(nextState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = nextState;
  await writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), nextState);
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  const id = state.publicPresenceId;
  state.publicPresenceId = "";
  if (!id || !state.uid) return;
  await Promise.allSettled([remove(ref(database, `online/publicPresence/${id}`)), remove(ref(database, `online/publicPresenceOwners/${id}`))]);
}

function requestHome() {
  if (!active) return;
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (["profile", "matching", "gameover", "withdrawn", "noContest", "error"].includes(state.screen)) {
    leaveToLanding();
    return;
  }
  const title = destroyDialog?.querySelector("h2");
  const body = destroyDialog?.querySelector("p");
  const confirm = destroyDialog?.querySelector("#confirmDestroy");
  if (title) title.textContent = "戦略型1on1対戦を終了しますか？";
  if (body) body.textContent = "対戦はノーコンテストとなり、選択画像とルーム接続を破棄します。";
  if (confirm) confirm.textContent = "戦略型1on1対戦を終了";
  destroyDialog?.showModal();
}

async function destroyRoom() {
  if (!active) return;
  if (state.roomId) await runTransaction(ref(database, `online/strategyRooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now() }).catch(() => {});
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome?.();
  showToast("戦略型1on1対戦を終了しました。戦績には影響しません。");
}

async function handleOpponentDestroyed() {
  if (state.destroyedByOpponent) return;
  state.destroyedByOpponent = true;
  await cleanupOnlineResources(false);
  releaseAllImages();
  state.screen = "noContest";
  setStrategyChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "profile";
  setStrategyChrome("STRATEGY READY");
  render();
}

async function resetStrategySetup() {
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  const identity = { uid: state.uid, authReady: state.authReady, name: state.name, clues: [...state.clues], weaknessIndex: state.weaknessIndex, pursuitLine: state.pursuitLine, profile: { ...state.profile }, economy: state.economy };
  await cleanupOnlineResources(false);
  releaseAllImages();
  state = createState();
  Object.assign(state, identity);
  state.screen = "profile";
  setStrategyChrome("STRATEGY READY");
  render();
}

async function retryConnection() {
  await cleanupOnlineResources(false);
  state.errorMessage = "";
  state.authReady = false;
  state.screen = "profile";
  setStrategyChrome("STRATEGY CONNECTING");
  render();
  ensureAuthenticated().catch(handleFatalError);
}

async function leaveToLanding() {
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  await cleanupOnlineResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome?.();
}

async function cleanupMatchmaking(keepActive) {
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.queueHeartbeat);
  window.clearInterval(state.offerPollTimer);
  window.clearInterval(state.hostStatusPollTimer);
  state.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (!state.uid) return;
  const removals = [remove(ref(database, `online/strategyQueue/${state.uid}`))];
  if (!keepActive) removals.push(remove(ref(database, `online/strategyActive/${state.uid}`)));
  if (state.pendingOffer) removals.push(remove(ref(database, `online/strategyOffers/${state.pendingOffer.targetUid}/${state.pendingOffer.roomId}`)));
  await Promise.allSettled(removals);
  state.pendingOffer = null;
  state.pendingIncomingOffer = null;
}

async function cleanupOnlineResources(keepActive) {
  await cleanupMatchmaking(keepActive);
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
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
      set(ref(database, `online/strategyRooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/strategyActive/${state.uid}`)),
    ]);
  }
}

function releaseAllImages() {
  [...state.main, ...state.reserve].forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    releaseCardAudio(item);
    item.url = "";
    item.blob = null;
  });
  state.remoteImages.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    releaseCardAudio(item);
  });
  state.remoteImages.clear();
  releaseRemoteAvatar();
  state.chatMessages = [];
  state.seenChatIds.clear();
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "戦略型1on1の通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = error?.code === "auth/admin-restricted-operation" ? "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。"
    : String(error?.message || "Firebaseへ接続できませんでした。");
  state.screen = "error";
  setStrategyChrome("CONNECTION ERROR");
  render();
}

window.addEventListener("beforeunload", () => {
  releaseAllImages();
  state.peer?.close();
});

window.HariaiStrategy = { start, isActive, requestHome, destroyRoom };
window.dispatchEvent(new CustomEvent("hariai-strategy-ready"));
