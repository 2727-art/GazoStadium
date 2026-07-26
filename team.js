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
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  database,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v3-oshi-jouzu-duo-v1-restore-v1";
import {
  CHAT_COSMETIC_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  PLAYER_TITLE_PRODUCTS,
  getPlayerTitlePresentation,
  getPlayerTitleProduct,
} from "./player-titles.js?v=player-titles-v2-oshi-jouzu-duo-v1-restore-v1";
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
} from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1";
import {
  bindPostMatchTip,
  isPostMatchTipBusy,
  renderPostMatchTip,
} from "./post-match-tip.js?v=post-match-tip-v4-app-check-v3-oshi-jouzu-duo-v1-restore-v1";
import {
  STRATEGY_VIDEO_MAX_BYTES,
  appendStrategyVideoChunk,
  createIncomingStrategyVideoTransfer,
  createStrategyVideoTransferId,
  finishIncomingStrategyVideoTransfer,
  releaseStrategyVideoResource,
  sendStrategyVideoClip,
  startStrategyVideoRecording,
} from "./strategy-video-transfer.mjs?v=strategy-video-review-v1";
import {
  appendTeamAssetChunk,
  createIncomingTeamAssetTransfer,
  createTeamAssetTransferId,
  finishIncomingTeamAssetTransfer,
  releaseTeamAssetResource,
  releaseTeamAssetResources,
  sendTeamAsset,
  teamAssetEndStatus,
} from "./team-asset-transfer.mjs?v=oshi-jouzu-duo-v1-restore-v1";
import {
  TEAM_CHALLENGE_FOCUSES,
  TEAM_CHALLENGE_PROTOCOL_VERSION,
  TEAM_CHALLENGE_ROLES,
  TEAM_CHALLENGE_SIDES,
  TEAM_CHALLENGE_VARIANT,
  allMembersMarked,
  createPerPeerTransferQueue,
  validTeamChallengeQueueEntries,
  normalizePresentationOrder,
  normalizeTeamChallengeFocus,
  normalizeTeamChallengeRole,
  normalizeTeamChallengeWords,
  presentationReplayStatus,
  randomPresentationOrder,
  referenceVideoPlayStatus,
  resolveDuoChallengeScores,
  resolveDuoPlan,
  selectTeamChallengeGroup,
  sortedChallengePlayers,
  teamChallengeMembersByRole,
  teamTalkStatus,
} from "./team-duo-challenge.mjs?v=oshi-jouzu-duo-v1-roleplay-v1-restore-v1";

const PLAYER_COUNT = 3;
const DUO_STRATEGY_MS = 20_000;
const SCORE_TIME_MS = 20_000;
const TALK_DURATION_MS = 10 * 60 * 1000;
const MATCH_TIMEOUT_MS = 30_000;
const MATCH_LOCK_TTL_MS = MATCH_TIMEOUT_MS + 10_000;
const QUEUE_FRESH_MS = 45_000;
const HEARTBEAT_MS = 20_000;
const DATA_BUFFER_LIMIT = 512 * 1024;
const MAX_AUDIO_SECONDS = 10;
const MAX_AUDIO_TRANSFER_BYTES = 480 * 1024;
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const ASSET_CHANNEL_LABEL = "hariai-team-challenge-assets-v2";
const VIDEO_CHANNEL_LABEL = "hariai-team-challenge-videos-v2";
const FALLBACK_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
  Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
]);
const DEFAULT_REACTIONS = ["すごい！", "かわいい", "その組み合わせ好き", "もっと聞きたい"];
const MAX_EQUIPPED_REACTIONS = 8;
const FOCUS_LABELS = Object.freeze({
  image: "画像の選び方",
  audio: "音声の添え方",
  video: "10秒動画",
  words: "ことば",
  overall: "全体の掛け合わせ",
});
const SHOP_FEATURE_IDS = ["feature_top_message"];
const SHOP_REACTIONS = [
  { id: "reaction_color", reaction: "色づかいが好き！" },
  { id: "reaction_best_shot", reaction: "最高の一枚！" },
  { id: "reaction_composition", reaction: "構図がうまい！" },
  { id: "reaction_atmosphere", reaction: "空気感が最高" },
  { id: "reaction_idea", reaction: "発想がおもしろい！" },
  { id: "reaction_healing", reaction: "癒やされる" },
  { id: "reaction_keep_watching", reaction: "ずっと見ていたい" },
  { id: "reaction_today_favorite", reaction: "今日の推し！" },
  { id: "reaction_story", reaction: "物語を感じる" },
  { id: "reaction_masterpiece", reaction: "これは名作" },
];

const economyActionCallable = httpsCallable(functions, "economyAction");
const appRoot = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createState();
let lastRenderedScreen = "";

function emptyComposition() {
  return {
    image: null,
    audio: null,
    video: null,
    words: "",
  };
}

function prepareDeckForRematch(items) {
  items.forEach((item) => {
    item.used = false;
  });
  return items;
}

function createState() {
  return {
    screen: "role",
    uid: "",
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    authReady: false,
    role: "",
    focus: "overall",
    economy: {
      points: 0,
      inventory: {},
      equipped: { reactions: {}, stamps: {}, title: "", chatFrame: "", chatBackground: "" },
      daily: {},
    },
    composition: emptyComposition(),
    deck: [],
    roomId: "",
    pendingRoomId: "",
    room: null,
    members: [],
    soloUid: "",
    challengerUids: [],
    presentationOrder: [TEAM_CHALLENGE_SIDES.SOLO, TEAM_CHALLENGE_SIDES.DUO],
    selectedDuoChoice: { audioOwnerUid: "", videoOwnerUid: "", wordsOwnerUid: "" },
    duoPlan: null,
    duoTimer: null,
    duoLocking: false,
    connections: new Map(),
    transferQueue: createPerPeerTransferQueue(),
    remoteCompositions: new Map(),
    remoteReferences: new Map(),
    localReference: null,
    localReferenceSent: false,
    receiveTalkMedia: true,
    muted: false,
    assetsReadyWritten: false,
    presentationOpening: false,
    presentationOpened: false,
    selectedScores: {},
    sealedScores: null,
    sealedScoresLoading: false,
    scoreTimer: null,
    scoreLocking: false,
    scoreWritten: false,
    resolvedResult: null,
    verifiedResultCommitted: false,
    verifiedResultPending: false,
    feedbackChoice: "overall",
    feedbackWritten: false,
    localFeedback: null,
    remoteFeedback: new Map(),
    talkClock: null,
    talkReplayRunning: new Set(),
    referenceVideoPlaying: new Set(),
    chatMessages: [],
    teamChatMessages: [],
    seenChatIds: new Set(),
    seenTeamChatIds: new Set(),
    latestQueue: {},
    latestInvites: {},
    activeUsers: {},
    acceptingInvite: false,
    matchingBusy: false,
    queueHeartbeat: null,
    matchTimer: null,
    serverTimeOffset: 0,
    publicPresenceId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    matchmakingUnsubscribers: [],
    roomUnsubscribers: [],
    disconnectHandles: [],
    destroyed: false,
    outcome: null,
    videoRecording: null,
    videoCaptureStarting: false,
    videoCaptureAbortController: null,
    iceServers: FALLBACK_ICE_SERVERS.map((server) => ({ ...server })),
    videoTarget: "composition",
    errorMessage: "",
  };
}

const shared = () => window.HariaiApp?.shared;
const escapeHtml = (value) => shared()?.escapeHtml(value) ?? String(value);
const showToast = (message) => shared()?.showToast(message);
const setBusy = (busy, message) => shared()?.setBusy(busy, message);
const firebaseNow = () => Date.now() + Number(state.serverTimeOffset || 0);

function start() {
  if (active) return;
  if (useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEW中はVALUE MARKET以外のオンライン機能へ接続しません。");
    return;
  }
  if (location.protocol === "file:") {
    showToast("推し上手！ふたりチャレンジはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (window.HariaiOnline?.isActive?.()
    || window.HariaiRoyale?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiMarket?.isActive?.()) {
    showToast("ほかの対戦画面を終了してから、ふたりチャレンジを開始してください。");
    return;
  }
  active = true;
  state = createState();
  lastRenderedScreen = "";
  setTeamChrome("推し上手 CONNECTING");
  render();
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
  const initialization = await economyActionCallable({ action: "initialize" });
  if (initialization.data?.economy) state.economy = normalizeEconomy(initialization.data.economy);
  else {
    const economySnapshot = await get(ref(database, `online/economy/${state.uid}`));
    if (economySnapshot.exists()) state.economy = normalizeEconomy(economySnapshot.val());
  }
  state.authReady = true;
  setTeamChrome("推し上手 READY");
  render();
}

function normalizeEconomy(value) {
  const source = value || {};
  const inventory = {};
  [...SHOP_FEATURE_IDS.map((id) => ({ id })), ...SHOP_REACTIONS, ...STAMP_PRODUCTS, ...PLAYER_TITLE_PRODUCTS, ...CHAT_COSMETIC_PRODUCTS]
    .forEach((item) => {
      if (source.inventory?.[item.id] === true) inventory[item.id] = true;
    });
  const equipped = { reactions: {}, stamps: {}, title: "", chatFrame: "", chatBackground: "" };
  SHOP_REACTIONS.filter((item) => inventory[item.id] && source.equipped?.reactions?.[item.id] === true)
    .slice(0, MAX_EQUIPPED_REACTIONS)
    .forEach((item) => { equipped.reactions[item.id] = true; });
  equipped.stamps = normalizeEquippedStamps(source, inventory, Boolean(source.equipped));
  const titleId = String(source.equipped?.title || "");
  if (getPlayerTitleProduct(titleId) && inventory[titleId]) equipped.title = titleId;
  const cosmetics = getEquippedChatCosmetics({ inventory, equipped: source.equipped });
  equipped.chatFrame = cosmetics.chatFrameId;
  equipped.chatBackground = cosmetics.chatBackgroundId;
  return {
    points: Math.min(999_999_999, Math.max(0, Math.floor(Number(source.points || 0)))),
    inventory,
    equipped,
    daily: source.daily || {},
    periodRewards: source.periodRewards || {},
  };
}

function titleLabel(titleId = state.economy.equipped?.title) {
  return getPlayerTitleProduct(titleId)?.title || "";
}

function renderTitleBadge(titleId = state.economy.equipped?.title) {
  const presentation = getPlayerTitlePresentation(titleId);
  return presentation
    ? `<span class="player-title-badge ${presentation.className}"><span aria-hidden="true">${escapeHtml(presentation.icon)}</span>${escapeHtml(presentation.product.title)}</span>`
    : "";
}

function setTeamChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "3人P2P一時転送";
  if (footerItems[0]) footerItems[0].textContent = "推し上手！ふたりチャレンジ / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "画像・音声・動画は3人へP2P転送し、Firebaseには保存しません";
}

function render() {
  if (!active) return;
  const screenChanged = lastRenderedScreen !== state.screen;
  const renderers = {
    role: renderRoleSelect,
    setup: renderSetup,
    matching: renderMatching,
    forming: renderForming,
    connecting: renderConnecting,
    duoStrategy: renderDuoStrategy,
    waitingAssets: renderWaitingAssets,
    reveal: renderReveal,
    score: renderScoring,
    waitingScore: renderWaitingScore,
    result: renderResult,
    talk: renderTalk,
    noContest: renderNoContest,
    error: renderError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderRoleSelect)();
  lastRenderedScreen = state.screen;
  bindEvents();
  if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function renderRoleSelect() {
  return `<section class="screen"><div class="section-head"><div><span class="eyebrow">推し上手！ふたりチャレンジ</span>
    <h1>ひとりの推し技、ふたりの推し愛。</h1>
    <p>画像・音声・10秒動画・ことばを掛け合わせる、一度きりの1対2チャレンジです。</p></div>
    <button class="button button-ghost button-small" id="teamBackHome">タイトルへ</button></div>
    <div class="team-rule-summary"><div><strong>1：2</strong><span>ASYMMETRY</span></div><div><strong>1</strong><span>ONE SHOT</span></div><div><strong>10</strong><span>SEC MEDIA</span></div><div><strong>3</strong><span>OSHITALK</span></div></div>
    <div class="setup-layout">
      <aside class="setup-guide"><h2>どちらで参加する？</h2><ol class="guide-list">
        <li><b>1</b><span>推し上手さんは、厳選した一枚でふたりを迎えます。</span></li>
        <li><b>2</b><span>ふたり推しは、それぞれの一枚を持ち寄って挑みます。</span></li>
        <li><b>3</b><span>対戦後は全員同意で、三人の推しトーク会を開けます。</span></li>
      </ol><div class="privacy-note">メディアは対戦中だけ端末間で転送し、終了時に破棄します。</div></aside>
      <div class="setup-panel"><div class="team-final-grid">
        <article class="team-final-card"><span>ひとり側・ロールプレイ</span><h2>推し上手さん</h2><p>ひとつの推し表現で、ふたり分の推し愛を受け止める役です。戦績や順位に関係なく選べます。</p>
          <span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● どなたでも演じられます" : "○ Firebaseへ接続中…"}</span>
          <button class="button button-primary" id="chooseOshiJouzu" ${state.authReady ? "" : "disabled"}>推し上手さんを演じる</button></article>
        <article class="team-final-card"><span>ふたり側</span><h2>ふたり推し</h2><p>二枚と共同演出を組み合わせて、推し上手さんへ挑みます。</p>
          <span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● 参加できます" : "○ Firebaseへ接続中…"}</span>
          <button class="button button-cyan" id="chooseFutariOshi" ${state.authReady ? "" : "disabled"}>ふたりで挑戦する</button></article>
      </div></div>
    </div></section>`;
}

function renderCompositionMedia() {
  const image = state.composition.image;
  const audio = state.composition.audio;
  const video = state.composition.video;
  return `<div class="deck-grid">${image
    ? `<div class="deck-slot"><img src="${escapeHtml(image.url)}" alt="勝負に使う推し画像" draggable="false" />
      <div class="deck-label"><span>MAIN IMAGE</span><button class="remove-card" id="removeTeamImage" aria-label="画像を外す">×</button></div></div>`
    : '<div class="deck-slot empty"><span>IMAGE</span></div>'}</div>
    <div class="team-final-grid">
      <article class="team-final-card"><span>♪ 10秒音声 / 任意</span><h2>${audio ? `${Number(audio.duration || 0).toFixed(1)}秒` : "音声なし"}</h2>
        ${audio ? `<audio controls preload="metadata" src="${escapeHtml(audio.url)}"></audio><button class="button button-ghost button-small" id="removeTeamAudio">音声を外す</button>`
          : '<label class="button button-ghost button-small file-button">音声を添える<input id="teamAudioInput" type="file" accept="audio/*" /></label>'}</article>
      <article class="team-final-card"><span>▻ 10秒動画 / 任意</span><h2>${video ? `${Number(video.duration || 0).toFixed(1)}秒` : "動画なし"}</h2>
        ${video ? `<video controls controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata" src="${escapeHtml(video.url)}"></video><button class="button button-ghost button-small" id="removeTeamVideo">動画を外す</button>`
          : `<button class="button button-ghost button-small" id="recordTeamVideo" ${state.videoCaptureStarting ? "disabled" : ""}>その場で10秒動画を録画</button>`}</article>
    </div>`;
}

function renderFocusOptions(name, selected = state.focus) {
  return TEAM_CHALLENGE_FOCUSES.map((focus) => `<label class="strategy-guess-card"><input type="radio" name="${name}" value="${focus}" ${selected === focus ? "checked" : ""} />
    <span><small>${focus.toUpperCase()}</small><strong>${escapeHtml(FOCUS_LABELS[focus])}</strong></span></label>`).join("");
}

function renderSetup() {
  const isSolo = state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU;
  const ready = state.authReady
    && Boolean(state.composition.image?.blob);
  return `<section class="screen"><div class="section-head"><div><span class="eyebrow">推し上手！ふたりチャレンジ / ${isSolo ? "推し上手さん" : "ふたり推し"}</span>
    <h1>${isSolo ? "一枚に、あなたの推し技を込める" : "ふたりへ持ち寄る一枚を選ぶ"}</h1>
    <p>画像は必須。音声・10秒動画・100字以内のことばは任意です。組み合わせて、画像の魅力をそっと引き出せます。</p></div>
    <button class="button button-ghost button-small" id="changeTeamRole">役を選び直す</button></div>
    <div class="online-profile-strip"><span class="connection-pill connected">● Firebase接続済み</span>${renderTitleBadge()}<span>${isSolo ? "推し上手さん" : "ふたり推し候補"}</span><span>つよ推しの証は正式記録から</span></div>
    <div class="setup-layout"><aside class="setup-guide"><h2>今回の推しセット</h2><ol class="guide-list">
      <li><b>1</b><span>画像1枚を端末内でWebPへ整えます。</span></li>
      <li><b>2</b><span>音声は10秒WAV、動画はその場で最大10秒まで。</span></li>
      <li><b>3</b><span>${isSolo ? "試したいところは対戦後まで秘密です。" : "相方と20秒で共同演出を選びます。"}</span></li></ol>
      <div class="privacy-note">音声・動画を付けなくても参加できます。数値ボーナスはありません。</div></aside>
      <div class="setup-panel"><label class="field-label">表示名<input class="text-input" id="teamPlayerName" maxlength="16" value="${escapeHtml(state.name)}" autocomplete="nickname" /></label>
        <div class="deck-toolbar"><div class="deck-counter"><strong>${state.composition.image ? "1" : "0"}</strong> / 1 IMAGE</div>
          <div class="upload-actions"><label class="button button-cyan button-small file-button">画像を選ぶ<input id="teamImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
          <button class="button button-ghost button-small" id="teamFillSample" ${state.composition.image ? "disabled" : ""}>サンプル画像</button></div></div>
        ${renderCompositionMedia()}
        <label class="field-label">この一枚に添えることば（任意・100字以内）
          <textarea class="text-input" id="teamWords" maxlength="100" rows="3" placeholder="この瞬間の、ここが好き。">${escapeHtml(state.composition.words)}</textarea>
          <small><span id="teamWordsCount">${normalizeTeamChallengeWords(state.composition.words).length}</span> / 100</small></label>
        ${isSolo ? `<fieldset class="strategy-weakness-form"><legend>今回、試してみたいところ（対戦後まで非公開）</legend>${renderFocusOptions("teamFocus")}</fieldset>` : ""}
        <div class="setup-actions"><button class="button button-primary" id="findTeamMatch" ${ready ? "" : "disabled"}>${isSolo ? "ふたりの挑戦を待つ" : "相方と推し上手さんを探す"}</button></div>
      </div></div></section>`;
}

function renderStatusCard(icon, eyebrow, title, body, details = "", actions = "") {
  return `<section class="screen handoff-wrap"><div class="handoff-card online-status-card"><div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>
    <div class="online-status-details">${details}</div><div class="button-row">${actions}</div></div></section>`;
}

function renderMatching() {
  const solo = state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU;
  return renderStatusCard(
    "♡",
    "推し上手！ MATCHING",
    solo ? "ふたりの挑戦を待っています" : "推し上手さんと相方を探しています",
    solo
      ? "ふたり推しが2人そろうと、三人だけの一発勝負が始まります。"
      : "あなたの一枚はそのまま。もう1人のふたり推しと一緒に挑みます。",
    '<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● protocol v2だけを検索中</span>',
    '<button class="button button-ghost" id="cancelTeamMatching">マッチングをやめる</button>',
  );
}

function renderForming() {
  const accepted = Object.keys(state.room?.accepted || {}).length;
  return renderStatusCard(
    "3",
    "THREE HEARTS",
    "三人の参加確認中",
    `${accepted} / 3人が参加を確定しました。`,
    '<span class="connection-pill connected">● 推し上手さん1人＋ふたり推し2人</span>',
    '<button class="button button-danger button-small" data-team-destroy>この場を閉じる</button>',
  );
}

function openAssetConnectionCount() {
  return [...state.connections.values()].filter((connection) => connection.assetChannel?.readyState === "open").length;
}

function renderConnecting() {
  const connected = openAssetConnectionCount();
  return renderStatusCard(
    "P2P",
    "THREE PLAYER MESH",
    "三人の推しセットをつなぎます",
    `${connected} / 2人とP2P接続済みです。`,
    `<span class="connection-pill ${connected === 2 ? "connected" : ""}">● ${connected} / 2 CONNECTIONS</span>`,
    '<button class="button button-danger button-small" data-team-destroy>この場を閉じる</button>',
  );
}

function localPlayer() {
  return state.members.find((player) => player.uid === state.uid) || null;
}

function soloPlayer() {
  return state.members.find((player) => player.uid === state.soloUid) || null;
}

function challengerPlayers() {
  return state.members.filter((player) => state.challengerUids.includes(player.uid));
}

function playerName(uid) {
  return state.members.find((player) => player.uid === uid)?.name || "PLAYER";
}

function renderChallengeHud() {
  const solo = soloPlayer();
  const challengers = challengerPlayers();
  return `<div class="team-round-hud"><div class="team-hud ${state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU ? "local-team" : ""}">
      <div class="team-hud-head"><strong>推し上手さん</strong><span>1 IMAGE</span></div><div class="team-hud-members"><span><small>${escapeHtml(solo?.name || "準備中")}${solo?.uid === state.uid ? "（あなた）" : ""}</small></span></div></div>
    <div class="round-badge"><small>ONE</small><strong>♡</strong></div>
    <div class="team-hud ${state.role === TEAM_CHALLENGE_ROLES.CHALLENGER ? "local-team" : ""}"><div class="team-hud-head"><strong>ふたり推し</strong><span>2 IMAGES</span></div>
      <div class="team-hud-members">${challengers.map((player) => `<span><small>${escapeHtml(player.name)}${player.uid === state.uid ? "（あなた）" : ""}</small></span>`).join("")}</div></div></div>
    <div class="online-room-strip"><span>OSHIAI ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span><span class="connection-pill connected">● 3人P2P</span>
      <span>ひとりの推し技、ふたりの推し愛。</span></div>`;
}

function duoRemainingSeconds() {
  const startedAt = Number(state.room?.duoStartedAt || 0);
  if (!startedAt) return Math.ceil(DUO_STRATEGY_MS / 1000);
  return Math.max(0, Math.ceil((DUO_STRATEGY_MS - (firebaseNow() - startedAt)) / 1000));
}

function componentCandidates(kind) {
  return challengerPlayers().filter((player) => {
    const component = player.components || {};
    if (kind === "words") return component.words === true;
    return component[kind] === true;
  });
}

function renderDuoChoice(kind, label) {
  const key = `${kind}OwnerUid`;
  const selected = String(state.selectedDuoChoice[key] || "");
  const candidates = componentCandidates(kind);
  return `<fieldset class="strategy-weakness-form"><legend>${escapeHtml(label)}</legend>
    <label class="strategy-guess-card"><input type="radio" name="duo-${kind}" value="" ${selected === "" ? "checked" : ""} />
      <span><small>NONE</small><strong>今回は使わない</strong></span></label>
    ${candidates.map((player) => `<label class="strategy-guess-card"><input type="radio" name="duo-${kind}" value="${escapeHtml(player.uid)}" ${selected === player.uid ? "checked" : ""} />
      <span><small>${player.uid === state.uid ? "YOU" : "MATE"}</small><strong>${escapeHtml(player.name)}の${escapeHtml(label)}</strong></span></label>`).join("")}
  </fieldset>`;
}

function renderDuoStrategy() {
  const remaining = duoRemainingSeconds();
  const choices = state.room?.duoChoices || {};
  const locked = Object.keys(choices).filter((uid) => choices[uid]?.locked === true).length;
  return `<section class="screen">${renderChallengeHud()}<div class="section-head"><div><span class="eyebrow">ふたり推し / ひみつの作戦室</span>
    <h1>ふたりの共同演出を選ぶ</h1><p>画像は2枚とも登場します。音声・動画・ことばは、ふたり分から1つずつ選びます。</p></div>
    <div class="team-phase-timer ${remaining <= 5 ? "warning" : ""}"><small>PAIR</small><strong id="duoStrategyTimer">${remaining}</strong></div></div>
    <div class="team-link-planner"><div class="team-link-heading"><div><span>PAIR MAKE</span><h2>同じ組み合わせなら、そのまま採用</h2></div><strong>${locked} / 2人が決定</strong></div>
      <div class="team-final-grid">${renderDuoChoice("audio", "音声")}${renderDuoChoice("video", "10秒動画")}</div>${renderDuoChoice("words", "ことば")}
      <div class="team-link-footer"><small>未合意・時間切れは、ふたりの並び順から決定論的に選びます。</small>
        <button class="button button-primary" id="lockDuoChoice" ${state.duoLocking ? "disabled" : ""}>この組み合わせを提案</button></div></div>
    ${renderTeamPrivateChat()}<div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>この場を閉じる</button></div></section>`;
}

function receivedComposition(uid) {
  if (uid === state.uid) {
    return {
      image: state.composition.image,
      audio: state.composition.audio,
      video: state.composition.video,
      words: state.composition.words,
      meta: {
        words: state.composition.words,
        hasAudio: Boolean(state.composition.audio),
        hasVideo: Boolean(state.composition.video),
      },
      complete: true,
    };
  }
  return state.remoteCompositions.get(uid) || {};
}

function renderWaitingAssets() {
  const ready = Object.keys(state.room?.assetsReady || {}).length;
  const plan = state.room?.duoPlan;
  return `<section class="screen">${renderChallengeHud()}${renderStatusCard(
    "✦",
    "推しセット準備中",
    state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU ? "ふたりの共同演出を待っています" : "三人の推しセットを届けています",
    `${ready} / 3人が必須画像を受け取りました。任意メディアの失敗では対戦を止めません。`,
    `<span class="connection-pill ${plan ? "connected" : ""}">${plan ? "● 共同演出が決まりました" : "○ ふたり推しが相談中"}</span>`,
    '<button class="button button-danger button-small" data-team-destroy>この場を閉じる</button>',
  ).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace("</section>", "</div>")}</section>`;
}

function selectedDuoMedia(kind) {
  const ownerUid = String(state.room?.duoPlan?.[`${kind}OwnerUid`] || "");
  return ownerUid ? receivedComposition(ownerUid)[kind] || null : null;
}

function selectedDuoWords() {
  const ownerUid = String(state.room?.duoPlan?.wordsOwnerUid || "");
  return ownerUid ? normalizeTeamChallengeWords(receivedComposition(ownerUid).meta?.words || receivedComposition(ownerUid).words) : "";
}

function renderCompositionCard(player, side, label) {
  const composition = receivedComposition(player.uid);
  return `<article class="team-image-card"><div class="team-image-owner"><span>${escapeHtml(player.name)}</span><strong>${escapeHtml(label)}</strong></div>
    <img src="${escapeHtml(composition.image?.url || "")}" alt="${escapeHtml(player.name)}の推し画像" draggable="false" />
    <div class="team-image-votes"><span>${side === TEAM_CHALLENGE_SIDES.SOLO ? "推し技の一枚" : "ふたり推しの一枚"}</span></div></article>`;
}

function renderThreeImageBoard() {
  const solo = soloPlayer();
  const duo = challengerPlayers();
  return `<div class="four-image-board"><div class="team-image-group"><div class="team-image-group-head"><strong>推し上手さん</strong><span>ONE</span></div>
      <div class="team-image-pair">${solo ? renderCompositionCard(solo, TEAM_CHALLENGE_SIDES.SOLO, "ONE") : ""}</div></div>
    <div class="team-versus">VS</div>
    <div class="team-image-group"><div class="team-image-group-head"><strong>ふたり推し</strong><span>DUO</span></div>
      <div class="team-image-pair">${duo.map((player, index) => renderCompositionCard(player, TEAM_CHALLENGE_SIDES.DUO, `DUO ${index + 1}`)).join("")}</div></div></div>`;
}

function renderWordsBoard() {
  const soloWords = normalizeTeamChallengeWords(receivedComposition(state.soloUid).meta?.words || receivedComposition(state.soloUid).words);
  const duoWords = selectedDuoWords();
  return `<div class="team-link-results"><article class="team-link-result active"><span>推し上手さんのことば</span><strong>${escapeHtml(soloWords || "ことばなし")}</strong></article>
    <article class="team-link-result active"><span>ふたり推しのことば</span><strong>${escapeHtml(duoWords || "ことばなし")}</strong></article></div>`;
}

function renderReveal() {
  const completed = state.room?.presentationCompleted || {};
  const localComplete = completed[state.uid] === true;
  const completeCount = Object.keys(completed).length;
  return `<section class="screen">${renderChallengeHud()}<div class="section-head"><div><span class="eyebrow">ONE SHOT REVEAL</span>
    <h1>三枚と、ふたつの推し演出</h1><p>音声・動画・ことばは画像の魅力を引き出す表現です。数値ボーナスにはなりません。</p></div></div>
    ${renderThreeImageBoard()}${state.presentationOpened || localComplete ? renderWordsBoard() : ""}
    <div class="team-result-score"><div><span>紹介順</span><strong>${state.presentationOrder[0] === TEAM_CHALLENGE_SIDES.SOLO ? "ひとり→ふたり" : "ふたり→ひとり"}</strong></div>
      <b>${localComplete ? `演出確認済み / ${completeCount} of 3` : "一度きりの本番演出"}</b></div>
    <div class="screen-actions"><button class="button button-danger button-small" data-team-destroy>この場を閉じる</button>
      ${localComplete ? '<button class="button button-primary" disabled>ほかの2人を待っています</button>'
        : `<button class="button button-primary" id="openMainPresentation" ${state.presentationOpening ? "disabled" : ""}>三人の演出をひらく</button>`}</div>
    ${renderAllChat()}</section>`;
}

function scoreTimerSeconds() {
  const startedAt = Number(state.room?.scoringStartedAt || 0);
  if (!startedAt) return Math.ceil(SCORE_TIME_MS / 1000);
  return Math.max(0, Math.ceil((SCORE_TIME_MS - (firebaseNow() - startedAt)) / 1000));
}

function renderScoreButtons(targetUid) {
  const selected = Number(state.selectedScores[targetUid] || 0);
  return Array.from({ length: 10 }, (_, index) => {
    const score = index + 1;
    return `<button class="score-button ${selected === score ? "selected" : ""}" type="button" data-team-score-target="${escapeHtml(targetUid)}" data-team-score="${score}">${score}</button>`;
  }).join("");
}

function scoreTargets() {
  return state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU ? challengerPlayers() : [soloPlayer()].filter(Boolean);
}

function renderScoring() {
  const targets = scoreTargets();
  return `<section class="screen">${renderChallengeHud()}<div class="section-head"><div><span class="eyebrow">SECRET SCORE</span>
    <h1>${state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU ? "ふたりの一枚を、それぞれ採点" : "推し上手さんの推し表現を採点"}</h1>
    <p>画像・音声・動画・ことばの掛け合わせを、1～10点で秘密採点します。</p></div>
    <div class="team-phase-timer ${scoreTimerSeconds() <= 5 ? "warning" : ""}"><small>SCORE</small><strong id="teamScoreTimer">${scoreTimerSeconds()}</strong></div></div>
    <div class="team-score-grid">${targets.map((player) => {
      const composition = receivedComposition(player.uid);
      return `<article class="team-score-card"><div class="team-score-image"><span>${escapeHtml(player.name)}</span><img src="${escapeHtml(composition.image?.url || "")}" alt="採点する推し画像" /></div>
        <div class="team-score-controls"><strong>${Number(state.selectedScores[player.uid] || 0) || "--"}</strong><div class="score-buttons">${renderScoreButtons(player.uid)}</div></div></article>`;
    }).join("")}</div>
    <div class="screen-actions"><button class="button button-primary" id="lockTeamScores" ${targets.every((player) => Number.isInteger(state.selectedScores[player.uid])) ? "" : "disabled"}>採点を確定</button></div></section>`;
}

function renderWaitingScore() {
  const ready = Object.values(state.room?.scoreReady || {}).filter((value) => value === true).length;
  return `<section class="screen">${renderChallengeHud()}${renderStatusCard(
    "♡",
    "SCORE SEALED",
    "三人の秘密採点を集めています",
    `${ready} / 3人が採点済みです。`,
    '<div class="matching-pulse"><i></i><i></i><i></i></div>',
    "",
  ).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace("</section>", "</div>")}</section>`;
}

function localOutcomeLabel() {
  const outcome = state.resolvedResult?.outcomes?.[state.uid] || "";
  return outcome === "win" ? "WIN" : outcome === "loss" ? "LOSE" : "DRAW";
}

function resultHeadline() {
  const winner = state.resolvedResult?.winnerSide;
  if (winner === TEAM_CHALLENGE_SIDES.SOLO) return "推し上手さん、一枚で魅せきった！";
  if (winner === TEAM_CHALLENGE_SIDES.DUO) return "ふたり推し、二枚で届いた！";
  return "推し上手さんが、ふたりの推し愛を受け止めた";
}

function allFeedbackWritten() {
  return state.members.length === PLAYER_COUNT
    && state.members.every((player) => state.room?.feedbackReady?.[player.uid] === true);
}

function renderFeedbackForm() {
  if (state.feedbackWritten || state.room?.feedbackReady?.[state.uid] === true) {
    return `<section class="strategy-review-invite"><span class="eyebrow">推しポイント回答済み</span><h2>ほかの2人の回答を待っています</h2>
      <p>${allFeedbackWritten() ? "三人分がそろいました。推しトーク会が開いた時に、一緒に見られます。" : "答えは三人全員がトーク会へ同意した時だけ開示します。"}</p></section>`;
  }
  const question = state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU
    ? "ふたり推しの、どこが良かった？"
    : "推し上手さんの、何がすごかった？";
  return `<section class="strategy-review-invite"><span class="eyebrow">AFTER SCORE / 非公開回答</span><h2>${question}</h2>
    <fieldset class="strategy-weakness-form">${renderFocusOptions("teamFeedback", state.feedbackChoice)}</fieldset>
    <button class="button button-primary" id="submitTeamFeedback">この推しポイントで回答</button>
    <small>三人の推しトーク会が開かなければ、ほかの人には表示しません。</small></section>`;
}

function renderTalkInvite() {
  if (!allFeedbackWritten()) return "";
  const decisions = state.room?.talkDecisions || {};
  const localDecision = decisions[state.uid] || "";
  const status = teamTalkStatus(state.room, state.members.map((player) => player.uid), firebaseNow(), TALK_DURATION_MS);
  let body = "三人全員が参加を選んだ時だけ、最大10分の推しトーク会を開きます。";
  if (localDecision === "accept") body = "参加を希望しました。ほかの2人の回答を待っています。";
  if (status === "declined") body = "今回は推しトーク会を開きません。回答内容は公開されません。";
  if (status === "ended" || status === "expired") body = "三人の推しトーク会は終了しました。";
  return `<section class="strategy-review-invite"><span class="eyebrow">三人の推しトーク会 / 任意参加</span><h2>この一戦を、三人でほどいてみる？</h2><p>${escapeHtml(body)}</p>
    <small>参加・滞在・メディア共有に、AnjuPay・ポイント・実績報酬はありません。いつでも退出できます。</small>
    ${!localDecision && status === "inviting" ? '<div class="strategy-review-actions"><button class="button button-primary" id="acceptTeamTalk">参加する</button><button class="button button-ghost" id="declineTeamTalk">今回は終了</button></div>' : ""}</section>`;
}

function renderResult() {
  const result = state.resolvedResult;
  const outcome = localOutcomeLabel();
  const shareButton = shared()?.renderResultShareButton?.({
    mode: "推し上手！ふたりチャレンジ",
    result: outcome,
    details: [`推し上手さん ${result?.soloScore?.toFixed(1) || "0.0"}`, `ふたり推し ${result?.duoScore?.toFixed(1) || "0.0"}`],
  }) || "";
  const recipients = state.members;
  return `<section class="screen gameover-wrap"><div class="gameover-card team-gameover"><div class="winner-emblem">${result?.winnerSide === TEAM_CHALLENGE_SIDES.SOLO ? "1" : result?.winnerSide === TEAM_CHALLENGE_SIDES.DUO ? "2" : "♡"}</div>
    <span class="eyebrow">推し上手！ ONE SHOT COMPLETE</span><h1>${escapeHtml(resultHeadline())}</h1>
    <p>${result?.winnerSide ? "高い平均点の側が勝利です。" : "得点は同じ。正式結果は引き分けです。"}</p>
    ${renderThreeImageBoard()}${renderWordsBoard()}
    <div class="team-result-score"><div><span>推し上手さん</span><strong>${result?.soloScore?.toFixed(1) || "0.0"}</strong></div>
      <b>${result?.winnerSide ? "STRICT HIGHER WINS" : "DRAW / 受け止めた"}</b><div><span>ふたり推し</span><strong>${result?.duoScore?.toFixed(1) || "0.0"}</strong></div></div>
    <div class="online-profile-strip"><span>勝利 3pt</span><span>引き分け 1pt</span><span>敗北 0pt</span><span>${state.verifiedResultCommitted ? "● 正式記録済み" : "○ 正式記録を確認中"}</span></div>
    ${renderFeedbackForm()}${renderTalkInvite()}
    ${renderPostMatchTip({ mode: "team", roomId: state.roomId, viewerUid: state.uid, recipients, balance: state.economy.points })}
    <div class="gameover-actions">${shareButton}<button class="button button-primary" id="teamNewMatch">もう一度チャレンジ</button><button class="button button-ghost" id="teamGameoverHome">タイトルへ戻る</button></div>
  </div></section>`;
}

function talkRemainingMs() {
  const startedAt = Number(state.room?.talkStartedAt || 0);
  return startedAt ? Math.max(0, startedAt + TALK_DURATION_MS - firebaseNow()) : 0;
}

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderFeedbackReveal() {
  const feedback = Object.fromEntries(state.remoteFeedback);
  if (state.localFeedback) feedback[state.uid] = state.localFeedback;
  const soloFeedback = feedback[state.soloUid] || {};
  return `<section class="team-link-planner ready"><div class="team-link-heading"><div><span>推しポイント、開示</span><h2>勝敗を決めた表現をほどく</h2></div><strong>三人同意済み</strong></div>
    <div class="team-link-results"><article class="team-link-result active"><span>推し上手さんが試したかったこと</span><strong>${escapeHtml(FOCUS_LABELS[soloFeedback.testFocus] || FOCUS_LABELS.overall)}</strong></article>
      <article class="team-link-result active"><span>推し上手さんが感じた、ふたりの良さ</span><strong>${escapeHtml(FOCUS_LABELS[soloFeedback.point] || FOCUS_LABELS.overall)}</strong></article></div>
    <div class="team-final-grid">${challengerPlayers().map((player) => `<article class="team-final-card"><span>${escapeHtml(player.name)}が感じたすごさ</span>
      <h2>${escapeHtml(FOCUS_LABELS[feedback[player.uid]?.point] || FOCUS_LABELS.overall)}</h2></article>`).join("")}</div></section>`;
}

function renderReplayCard(side) {
  const replay = state.room?.talkReplay?.[side] || {};
  const memberUids = state.members.map((player) => player.uid);
  const status = presentationReplayStatus(replay, memberUids);
  const localReady = replay.ready?.[state.uid] === true;
  const localComplete = replay.completed?.[state.uid] === true;
  const label = side === TEAM_CHALLENGE_SIDES.SOLO ? "推し上手さんの演出" : "ふたり推しの演出";
  let button = `<button class="button button-ghost button-small" data-talk-replay-ready="${side}" ${localReady ? "disabled" : ""}>${localReady ? "準備OK" : "もう一度見る準備"}</button>`;
  if (status === "playing" && !localComplete) {
    button = `<button class="button button-primary button-small" data-talk-replay-play="${side}" ${state.talkReplayRunning.has(side) ? "disabled" : ""}>再鑑賞する</button>`;
  } else if (status === "completed") {
    button = '<button class="button button-ghost button-small" disabled>一度だけ再鑑賞済み</button>';
  }
  return `<article class="team-final-card"><span>ONE MORE LOOK / 1回だけ</span><h2>${escapeHtml(label)}</h2><p>${status === "waiting" ? "三人全員が準備すると再鑑賞できます。" : status === "ready" ? "再生を準備しています。" : status === "playing" ? "成功した端末だけ完了として記録します。" : "三人とも見終わりました。"}</p>${button}</article>`;
}

function renderReferenceItem(item, ownerUid) {
  if (!item) return "";
  const local = ownerUid === state.uid;
  const name = playerName(ownerUid);
  if (item.kind === "image") {
    return `<article class="strategy-review-asset ${local ? "is-local" : "is-opponent"}"><div><span><small>参考画像 / ${local ? "YOU" : "PLAYER"}</small><strong>${escapeHtml(name)}</strong></span></div>
      <img src="${escapeHtml(item.url || "")}" alt="${escapeHtml(name)}の参考画像" /><small>推しトーク会が終わるまで表示</small></article>`;
  }
  const playState = referenceVideoPlayStatus(state.room?.referenceVideoPlay?.[ownerUid], state.uid);
  return `<article class="strategy-review-asset ${local ? "is-local" : "is-opponent"}"><div><span><small>参考動画 / ${local ? "YOU" : "PLAYER"}</small><strong>${escapeHtml(name)}</strong></span></div>
    <video controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata" src="${escapeHtml(item.url || "")}" data-reference-video="${escapeHtml(ownerUid)}"></video>
    <button class="button button-ghost button-small" data-play-reference-video="${escapeHtml(ownerUid)}" ${playState !== "ready" ? "disabled" : ""}>${playState === "completed" ? "1回再生済み" : playState === "playing" ? "再生中" : "1回だけ再生"}</button></article>`;
}

function renderTalkReferences() {
  const items = [];
  if (state.localReference) items.push(renderReferenceItem(state.localReference, state.uid));
  state.remoteReferences.forEach((item, uid) => items.push(renderReferenceItem(item, uid)));
  const canAdd = !state.localReference;
  return `<section class="strategy-review-asset-panel"><div class="strategy-review-media-head"><div><strong>参考アイテム</strong><span>1人1つ / 画像または10秒動画</span></div>
    <button class="button button-ghost button-small ${state.receiveTalkMedia ? "is-receiving" : ""}" id="toggleTeamTalkMedia" aria-pressed="${state.receiveTalkMedia}">${state.receiveTalkMedia ? "メディア受信 ON" : "メディア受信 OFF"}</button></div>
    <div class="strategy-review-asset-toolbar"><label class="button button-ghost button-small file-button ${canAdd ? "" : "is-disabled"}">＋ 参考画像<input id="teamReferenceImageInput" type="file" accept="image/png,image/jpeg,image/webp" ${canAdd ? "" : "disabled"} /></label>
      <button class="button button-ghost button-small" id="recordTeamReferenceVideo" ${canAdd ? "" : "disabled"}>▻ 参考動画を録画</button>
      <button class="button button-ghost button-small" id="toggleTeamMute">${state.muted ? "ミュート解除" : "音声をミュート"}</button></div>
    <small class="strategy-review-asset-note">受信OFFはこれから届く参考メディアだけを止めます。対戦画像は固定表示します。</small>
    ${items.length ? `<div class="strategy-review-assets">${items.join("")}</div>` : '<p class="strategy-review-asset-empty">参考アイテムはまだありません。</p>'}</section>`;
}

function renderTalk() {
  return `<section class="screen strategy-review-screen">${renderChallengeHud()}<header class="strategy-review-head"><div><span class="eyebrow">三人の推しトーク会 / 任意参加</span>
    <h1>この一戦の魅力を、三人でほどく</h1><p>教える人と教わる人に分かれず、届いたところ・工夫したところを持ち寄る時間です。</p></div>
    <div class="strategy-review-clock"><small>残り時間</small><strong id="teamTalkCountdown">${formatRemaining(talkRemainingMs())}</strong></div></header>
    <div class="strategy-review-notice"><span>● 三人同意済み</span><p>いつでも退出できます。参加・再鑑賞・参考アイテムに報酬はありません。</p></div>
    ${renderFeedbackReveal()}${renderThreeImageBoard()}${renderWordsBoard()}
    <div class="team-final-grid">${renderReplayCard(TEAM_CHALLENGE_SIDES.SOLO)}${renderReplayCard(TEAM_CHALLENGE_SIDES.DUO)}</div>
    ${renderTalkReferences()}${renderAllChat()}
    <div class="screen-actions"><button class="button button-danger" id="leaveTeamTalk">推しトーク会を終了</button></div></section>`;
}

function renderNoContest() {
  return renderStatusCard("×", "NO CONTEST", "ふたりチャレンジを終了しました", "誰かが退出または切断したため、ポイント・実績・つよ推しの証には影響しません。", "", '<button class="button button-primary" id="teamNoContestAgain">もう一度探す</button><button class="button button-ghost" id="teamNoContestHome">タイトルへ</button>');
}

function renderError() {
  return renderStatusCard("!", "CONNECTION ERROR", "ふたりチャレンジへ接続できません", state.errorMessage || "通信状態を確認してください。", "", '<button class="button button-primary" id="teamRetry">もう一度試す</button><button class="button button-ghost" id="teamErrorHome">タイトルへ</button>');
}

function bindEvents() {
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("contextmenu", (event) => event.preventDefault());
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });
  document.querySelectorAll("[data-team-destroy]").forEach((button) => button.addEventListener("click", () => destroyDialog.showModal()));
  bindChatEvents();
  if (state.screen === "role") bindRoleEvents();
  if (state.screen === "setup") bindSetupEvents();
  if (state.screen === "matching") document.querySelector("#cancelTeamMatching")?.addEventListener("click", cancelMatching);
  if (state.screen === "duoStrategy") bindDuoStrategyEvents();
  if (state.screen === "reveal") document.querySelector("#openMainPresentation")?.addEventListener("click", openMainPresentation);
  if (state.screen === "score") bindScoreEvents();
  if (state.screen === "result") bindResultEvents();
  if (state.screen === "talk") bindTalkEvents();
  if (state.screen === "noContest") {
    document.querySelector("#teamNoContestAgain")?.addEventListener("click", resetSetup);
    document.querySelector("#teamNoContestHome")?.addEventListener("click", leaveToLanding);
  }
  if (state.screen === "error") {
    document.querySelector("#teamRetry")?.addEventListener("click", retryConnection);
    document.querySelector("#teamErrorHome")?.addEventListener("click", leaveToLanding);
  }
}

function bindRoleEvents() {
  document.querySelector("#teamBackHome")?.addEventListener("click", leaveToLanding);
  document.querySelector("#chooseOshiJouzu")?.addEventListener("click", () => chooseRole(TEAM_CHALLENGE_ROLES.OSHI_JOUZU));
  document.querySelector("#chooseFutariOshi")?.addEventListener("click", () => chooseRole(TEAM_CHALLENGE_ROLES.CHALLENGER));
}

function chooseRole(role) {
  const normalized = normalizeTeamChallengeRole(role);
  if (!normalized) return;
  state.role = normalized;
  state.screen = "setup";
  render();
}

function bindSetupEvents() {
  document.querySelector("#changeTeamRole")?.addEventListener("click", () => {
    state.role = "";
    state.screen = "role";
    render();
  });
  const nameInput = document.querySelector("#teamPlayerName");
  nameInput?.addEventListener("input", () => {
    state.name = nameInput.value.slice(0, 16);
    updateSetupReadyButton();
  });
  const words = document.querySelector("#teamWords");
  words?.addEventListener("input", () => {
    state.composition.words = normalizeTeamChallengeWords(words.value);
    const count = document.querySelector("#teamWordsCount");
    if (count) count.textContent = String(state.composition.words.length);
    updateSetupReadyButton();
  });
  document.querySelectorAll('input[name="teamFocus"]').forEach((input) => input.addEventListener("change", () => {
    state.focus = normalizeTeamChallengeFocus(input.value);
  }));
  document.querySelector("#teamImageInput")?.addEventListener("change", (event) => prepareMainImage(event.target.files?.[0]));
  document.querySelector("#teamAudioInput")?.addEventListener("change", (event) => prepareMainAudio(event.target.files?.[0]));
  document.querySelector("#teamFillSample")?.addEventListener("click", fillSampleImage);
  document.querySelector("#removeTeamImage")?.addEventListener("click", removeMainImage);
  document.querySelector("#removeTeamAudio")?.addEventListener("click", removeMainAudio);
  document.querySelector("#removeTeamVideo")?.addEventListener("click", removeMainVideo);
  document.querySelector("#recordTeamVideo")?.addEventListener("click", () => beginTeamVideoCapture("composition"));
  document.querySelector("#findTeamMatch")?.addEventListener("click", beginMatchmaking);
}

function updateSetupReadyButton() {
  const button = document.querySelector("#findTeamMatch");
  if (!button) return;
  button.disabled = !state.authReady
    || !state.name.trim()
    || !state.composition.image?.blob;
}

async function prepareMainImage(file) {
  if (!file) return;
  setBusy(true, "推し画像を整えています…");
  try {
    const item = await shared().processImageFile(file, 0, { maxSide: 1280, quality: 0.82 });
    removeMainImage(false);
    state.composition.image = {
      ...item,
      kind: "image",
      mime: "image/webp",
      duration: 0,
    };
    state.deck = [state.composition.image];
    showToast("勝負の一枚を選びました。");
  } catch (error) {
    showToast(error?.message || "画像を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

async function fillSampleImage() {
  if (state.composition.image) return;
  setBusy(true, "サンプル画像を準備しています…");
  try {
    const [item] = await shared().createSampleItems(2, 1, 0);
    state.composition.image = { ...item, kind: "image", mime: "image/webp", duration: 0 };
    state.deck = [state.composition.image];
  } finally {
    setBusy(false);
    render();
  }
}

function removeMainImage(shouldRender = true) {
  const item = state.composition.image;
  if (item?.url) URL.revokeObjectURL(item.url);
  state.composition.image = null;
  state.deck = [];
  if (shouldRender) render();
}

async function prepareMainAudio(file) {
  if (!file) return;
  const processor = shared()?.processGameAudioFile;
  if (typeof processor !== "function") return showToast("音声変換機能を読み込めませんでした。");
  setBusy(true, "音声を10秒WAVへ整えています…");
  try {
    const audio = await processor(file, {
      maxSeconds: MAX_AUDIO_SECONDS,
      maxOutputBytes: MAX_AUDIO_TRANSFER_BYTES,
      audioName: String(file.name || "添付音声").slice(0, 80),
    });
    removeMainAudio(false);
    state.composition.audio = {
      kind: "audio",
      blob: audio.audioBlob,
      url: audio.audioUrl,
      mime: "audio/wav",
      duration: Number(audio.audioDuration || 0),
    };
    showToast("推し画像へ音声を添えました。");
  } catch (error) {
    showToast(error?.message || "音声を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

function removeMainAudio(shouldRender = true) {
  const item = state.composition.audio;
  if (item?.url) URL.revokeObjectURL(item.url);
  state.composition.audio = null;
  if (shouldRender) render();
}

function removeMainVideo(shouldRender = true) {
  if (state.composition.video) releaseStrategyVideoResource(state.composition.video);
  state.composition.video = null;
  if (shouldRender) render();
}

async function beginTeamVideoCapture(target = "composition") {
  if (state.videoCaptureStarting || state.videoRecording) return;
  state.videoTarget = target;
  const controller = new AbortController();
  state.videoCaptureAbortController = controller;
  state.videoCaptureStarting = true;
  showToast("ブラウザのカメラ・マイク許可を確認してください。");
  try {
    const session = await startStrategyVideoRecording({ includeAudio: true, signal: controller.signal });
    if (controller.signal.aborted || state.videoCaptureAbortController !== controller) {
      session.cancel().catch(() => {});
      return;
    }
    const capture = { session, target };
    state.videoRecording = capture;
    state.videoCaptureStarting = false;
    state.videoCaptureAbortController = null;
    showToast("録画中です。10秒で自動停止します。");
    session.result.then((clip) => {
      if (state.videoRecording !== capture) {
        releaseStrategyVideoResource(clip);
        return;
      }
      state.videoRecording = null;
      clip.ownerUid = state.uid;
      if (target === "reference" && state.screen === "talk" && !state.localReference) {
        clip.kind = "video";
        clip.phase = "review";
        clip.round = 0;
        state.localReference = clip;
        sendLocalReference().catch(handleRecoverableError);
      } else {
        removeMainVideo(false);
        clip.kind = "video";
        clip.phase = "battle";
        clip.round = 1;
        state.composition.video = clip;
      }
      render();
    }).catch((error) => {
      if (state.videoRecording === capture) state.videoRecording = null;
      if (error?.name !== "AbortError") showToast(error?.message || "動画を録画できませんでした。");
      render();
    });
  } catch (error) {
    if (state.videoCaptureAbortController === controller) {
      state.videoCaptureStarting = false;
      state.videoCaptureAbortController = null;
    }
    if (error?.name !== "AbortError") showToast(error?.message || "カメラを開始できませんでした。");
    render();
  }
}

function stopVideoCapture() {
  state.videoCaptureAbortController?.abort();
  state.videoCaptureAbortController = null;
  state.videoCaptureStarting = false;
  const capture = state.videoRecording;
  if (capture) {
    state.videoRecording = null;
    capture.session.cancel().catch(() => {});
  }
}

async function beginMatchmaking() {
  state.name = state.name.trim().slice(0, 16);
  state.composition.words = normalizeTeamChallengeWords(state.composition.words);
  if (!state.uid || !state.name || !state.composition.image?.blob) return;
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  state.screen = "matching";
  setTeamChrome("推し上手 MATCHING");
  render();
  await Promise.allSettled([
    remove(ref(database, `online/teamActive/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}`)),
  ]);
  const offset = await get(ref(database, ".info/serverTimeOffset")).catch(() => null);
  state.serverTimeOffset = Number(offset?.val() || 0);
  const queueRef = ref(database, `online/teamQueue/${state.uid}`);
  const entry = {
    uid: state.uid,
    name: state.name,
    rating: 1000,
    streak: 0,
    role: state.role,
    protocolVersion: TEAM_CHALLENGE_PROTOCOL_VERSION,
    variant: TEAM_CHALLENGE_VARIANT,
    components: {
      audio: Boolean(state.composition.audio),
      video: Boolean(state.composition.video),
      words: Boolean(state.composition.words),
    },
    joinedAt: firebaseNow(),
    lastSeen: firebaseNow(),
    state: "waiting",
  };
  await set(queueRef, entry);
  const disconnect = onDisconnect(queueRef);
  await disconnect.remove();
  state.disconnectHandles.push(disconnect);
  await startPublicPresence();
  state.queueHeartbeat = window.setInterval(() => {
    update(queueRef, { lastSeen: firebaseNow() }).then(attemptToHost).catch(() => {});
  }, HEARTBEAT_MS);
  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/teamQueue"), (snapshot) => {
    state.latestQueue = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/teamActive"), (snapshot) => {
    state.activeUsers = snapshot.val() || {};
    attemptToHost().catch(handleRecoverableError);
  }, handleRecoverableError));
  state.matchmakingUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  state.matchmakingUnsubscribers.push(onValue(ref(database, "online/teamMatchLock"), () => attemptToHost().catch(handleRecoverableError)));
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/teamInvites/${state.uid}`), (snapshot) => {
    state.latestInvites = snapshot.val() || {};
    processInvites().catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function startPublicPresence() {
  await cleanupPublicPresence();
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  await set(ref(database, `online/publicPresenceOwners/${presenceId}`), state.uid);
  await writePublicPresence(presenceId, "waiting");
  const disconnect = onDisconnect(ref(database, `online/publicPresence/${presenceId}`));
  await disconnect.remove();
  state.publicPresenceId = presenceId;
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (state.publicPresenceId) writePublicPresence(state.publicPresenceId, state.publicPresenceState).catch(() => {});
  }, HEARTBEAT_MS);
}

async function writePublicPresence(id, presenceState) {
  await set(ref(database, `online/publicPresence/${id}`), { mode: "team", state: presenceState, lastSeen: Date.now() });
}

async function updatePublicPresence(presenceState) {
  if (!state.publicPresenceId) return;
  state.publicPresenceState = presenceState;
  await writePublicPresence(state.publicPresenceId, presenceState);
}

async function cleanupPublicPresence() {
  window.clearInterval(state.publicPresenceHeartbeat);
  state.publicPresenceHeartbeat = null;
  await state.publicPresenceDisconnect?.cancel?.().catch(() => {});
  state.publicPresenceDisconnect = null;
  const id = state.publicPresenceId;
  state.publicPresenceId = "";
  if (!id) return;
  await Promise.allSettled([
    remove(ref(database, `online/publicPresence/${id}`)),
    remove(ref(database, `online/publicPresenceOwners/${id}`)),
  ]);
}

function freshChallengeEntries() {
  return validTeamChallengeQueueEntries(state.latestQueue, {
    now: firebaseNow(),
    freshnessMs: QUEUE_FRESH_MS,
    activeUsers: state.activeUsers,
  });
}

async function attemptToHost() {
  if (!active
    || state.screen !== "matching"
    || state.role !== TEAM_CHALLENGE_ROLES.OSHI_JOUZU
    || state.matchingBusy
    || state.acceptingInvite
    || state.pendingRoomId) return;
  const group = selectTeamChallengeGroup(freshChallengeEntries());
  if (group.length !== PLAYER_COUNT || group[0].uid !== state.uid) return;
  await createTeamRoom(group);
}

async function acquireTeamMatchLock(roomId) {
  const result = await runTransaction(ref(database, "online/teamMatchLock"), (current) => {
    const currentTime = firebaseNow();
    if (current && current.uid !== state.uid && Number(current.expiresAt || 0) > currentTime) return undefined;
    return { uid: state.uid, roomId, createdAt: currentTime, expiresAt: currentTime + MATCH_LOCK_TTL_MS };
  });
  return result.committed && result.snapshot.val()?.uid === state.uid && result.snapshot.val()?.roomId === roomId;
}

async function releaseTeamMatchLock(roomId) {
  await runTransaction(ref(database, "online/teamMatchLock"), (current) => (
    current?.uid === state.uid && current?.roomId === roomId ? null : undefined
  )).catch(() => {});
}

async function createTeamRoom(group) {
  state.matchingBusy = true;
  const roomId = push(ref(database, "online/teamRooms")).key;
  let ownsLock = false;
  try {
    ownsLock = await acquireTeamMatchLock(roomId);
    if (!ownsLock || state.screen !== "matching") return;
    const reservation = await runTransaction(ref(database, `online/teamActive/${state.uid}`), (current) => current === null ? roomId : undefined);
    if (!reservation.committed) return;
    const solo = group.find((entry) => entry.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU);
    const challengers = group.filter((entry) => entry.role === TEAM_CHALLENGE_ROLES.CHALLENGER);
    if (!solo || challengers.length !== 2 || solo.uid !== state.uid) return;
    const players = {};
    players[solo.uid] = {
      uid: solo.uid,
      name: solo.name,
      team: "A",
      slot: 1,
      role: TEAM_CHALLENGE_ROLES.OSHI_JOUZU,
      rating: Number(solo.rating || 1000),
      streak: Number(solo.streak || 0),
      components: solo.components || {},
    };
    challengers.forEach((entry, index) => {
      players[entry.uid] = {
        uid: entry.uid,
        name: entry.name,
        team: "B",
        slot: index + 1,
        role: TEAM_CHALLENGE_ROLES.CHALLENGER,
        rating: Number(entry.rating || 1000),
        streak: Number(entry.streak || 0),
        components: entry.components || {},
      };
    });
    const members = Object.fromEntries(Object.keys(players).map((uid) => [uid, true]));
    const roster = {
      soloUid: solo.uid,
      challenger1Uid: challengers[0].uid,
      challenger2Uid: challengers[1].uid,
    };
    const presentationOrder = randomPresentationOrder();
    await set(ref(database, `online/teamRooms/${roomId}`), {
      protocolVersion: TEAM_CHALLENGE_PROTOCOL_VERSION,
      variant: TEAM_CHALLENGE_VARIANT,
      hostUid: state.uid,
      createdAt: serverTimestamp(),
      status: "forming",
      roster,
      members,
      players,
      presentationOrder,
      accepted: { [state.uid]: true },
    });
    await update(ref(database, `online/teamQueue/${state.uid}`), { state: "forming", roomId });
    await Promise.all(challengers.map((entry) => set(ref(database, `online/teamInvites/${entry.uid}/${roomId}`), {
      roomId,
      hostUid: state.uid,
      protocolVersion: TEAM_CHALLENGE_PROTOCOL_VERSION,
      variant: TEAM_CHALLENGE_VARIANT,
      createdAt: firebaseNow(),
    })));
    state.pendingRoomId = roomId;
    state.room = {
      hostUid: state.uid,
      status: "forming",
      roster,
      members,
      players,
      accepted: { [state.uid]: true },
      protocolVersion: 2,
      variant: TEAM_CHALLENGE_VARIANT,
      presentationOrder,
    };
    state.screen = "forming";
    render();
    watchPendingRoom(roomId, true);
    state.matchTimer = window.setTimeout(() => expireTeamRoom(roomId), MATCH_TIMEOUT_MS);
  } finally {
    if (ownsLock && state.pendingRoomId !== roomId) await releaseTeamMatchLock(roomId);
    state.matchingBusy = false;
  }
}

async function processInvites() {
  if (state.acceptingInvite || state.pendingRoomId || state.roomId || state.screen !== "matching") return;
  state.acceptingInvite = true;
  try {
    const entries = Object.entries(state.latestInvites)
      .filter(([, invite]) => invite?.protocolVersion === TEAM_CHALLENGE_PROTOCOL_VERSION && invite?.variant === TEAM_CHALLENGE_VARIANT)
      .sort(([, first], [, second]) => Number(first.createdAt || 0) - Number(second.createdAt || 0));
    for (const [roomId, invite] of entries) {
      if (await acceptInvite(roomId, invite)) return;
    }
  } finally {
    state.acceptingInvite = false;
  }
}

async function acceptInvite(roomId, invite) {
  const snapshot = await get(ref(database, `online/teamRooms/${roomId}`));
  const room = snapshot.val();
  if (!room
    || room.protocolVersion !== TEAM_CHALLENGE_PROTOCOL_VERSION
    || room.variant !== TEAM_CHALLENGE_VARIANT
    || room.status !== "forming"
    || room.players?.[state.uid]?.role !== TEAM_CHALLENGE_ROLES.CHALLENGER
    || invite.hostUid !== room.hostUid) {
    await remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`));
    return false;
  }
  const reservation = await runTransaction(ref(database, `online/teamActive/${state.uid}`), (current) => current === null ? roomId : undefined);
  if (!reservation.committed) return false;
  await set(ref(database, `online/teamRooms/${roomId}/accepted/${state.uid}`), true);
  await Promise.allSettled([
    remove(ref(database, `online/teamQueue/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`)),
  ]);
  state.pendingRoomId = roomId;
  state.room = { ...room, accepted: { ...(room.accepted || {}), [state.uid]: true } };
  state.screen = "forming";
  render();
  watchPendingRoom(roomId, false);
  state.matchTimer = window.setTimeout(() => abandonPendingRoom(roomId).catch(handleRecoverableError), MATCH_TIMEOUT_MS + 5_000);
  return true;
}

function watchPendingRoom(roomId, isHost) {
  state.matchmakingUnsubscribers.push(onValue(ref(database, `online/teamRooms/${roomId}`), (snapshot) => {
    const room = snapshot.val();
    if (!room || room.protocolVersion !== TEAM_CHALLENGE_PROTOCOL_VERSION || room.variant !== TEAM_CHALLENGE_VARIANT) return;
    state.room = room;
    if (state.screen === "forming") render();
    if (isHost && Object.keys(room.accepted || {}).length === PLAYER_COUNT && room.status === "forming") {
      set(ref(database, `online/teamRooms/${roomId}/status`), "active").catch(handleRecoverableError);
    }
    if (room.status === "active") enterRoom(roomId).catch(handleRecoverableError);
    if (room.status === "expired") handleExpiredRoom(roomId).catch(handleRecoverableError);
  }, handleRecoverableError));
}

async function expireTeamRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId || state.room?.hostUid !== state.uid) return;
  await runTransaction(ref(database, `online/teamRooms/${roomId}/status`), (current) => current === "forming" ? "expired" : undefined);
  await releaseTeamMatchLock(roomId);
}

async function abandonPendingRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId) return;
  const status = (await get(ref(database, `online/teamRooms/${roomId}/status`))).val();
  if (status === "active") return enterRoom(roomId);
  await returnToWaitingQueue(roomId);
}

async function handleExpiredRoom(roomId) {
  if (state.roomId || state.pendingRoomId !== roomId) return;
  await returnToWaitingQueue(roomId);
}

async function returnToWaitingQueue(roomId) {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  await Promise.allSettled([
    remove(ref(database, `online/teamActive/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}/${roomId}`)),
  ]);
  await releaseTeamMatchLock(roomId);
  state.pendingRoomId = "";
  state.room = null;
  state.screen = "matching";
  await beginMatchmaking();
}

async function enterRoom(roomId) {
  if (state.roomId) return;
  window.clearTimeout(state.matchTimer);
  const room = (await get(ref(database, `online/teamRooms/${roomId}`))).val();
  if (!room
    || room.status !== "active"
    || room.protocolVersion !== TEAM_CHALLENGE_PROTOCOL_VERSION
    || room.variant !== TEAM_CHALLENGE_VARIANT
    || room.members?.[state.uid] !== true) {
    throw new Error("推し上手！ふたりチャレンジの場へ参加できませんでした。");
  }
  const layout = teamChallengeMembersByRole(room.players);
  if (!layout.solo || layout.challengers.length !== 2) throw new Error("三人の役割を確認できませんでした。");
  state.roomId = roomId;
  state.pendingRoomId = "";
  state.room = room;
  state.members = sortedChallengePlayers(room.players);
  state.soloUid = layout.solo.uid;
  state.challengerUids = layout.challengers.map((player) => player.uid);
  state.role = room.players[state.uid].role;
  state.presentationOrder = normalizePresentationOrder(room.presentationOrder);
  await releaseTeamMatchLock(roomId);
  await cleanupMatchmaking(true);
  await updatePublicPresence("playing");
  state.screen = "connecting";
  setTeamChrome("推し上手 BATTLE");
  render();
  await setupRoomListeners();
  try {
    const iceConfiguration = await window.HariaiOnline?.getP2pIceConfiguration?.();
    if (Array.isArray(iceConfiguration?.iceServers) && iceConfiguration.iceServers.length) {
      state.iceServers = iceConfiguration.iceServers;
    }
  } catch {
    state.iceServers = FALLBACK_ICE_SERVERS.map((server) => ({ ...server }));
  }
  await setupPeerMesh();
}

async function setupRoomListeners() {
  const base = `online/teamRooms/${state.roomId}`;
  state.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    state.serverTimeOffset = Number(snapshot.val() || 0);
  }));
  const activeDisconnect = onDisconnect(ref(database, `online/teamActive/${state.uid}`));
  await activeDisconnect.remove();
  state.disconnectHandles.push(activeDisconnect);
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  state.disconnectHandles.push(presenceDisconnect);
  state.members.filter((player) => player.uid !== state.uid).forEach((player) => {
    state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${player.uid}`), (snapshot) => {
      if (snapshot.exists() && snapshot.val()?.online === false && state.roomId && !state.outcome && state.screen !== "result" && state.screen !== "talk") {
        markDisconnected(player.uid).catch(() => {});
      }
      if (state.screen === "talk" && snapshot.exists() && snapshot.val()?.online === false) finishTalkLocally("left");
    }));
  });
  state.roomUnsubscribers.push(onValue(ref(database, base), (snapshot) => {
    const room = snapshot.val();
    if (!room) return;
    state.room = room;
    reactToRoomData().catch(handleRecoverableError);
  }, handleRecoverableError));
  const allChat = query(ref(database, `${base}/chat`), limitToLast(60));
  state.roomUnsubscribers.push(onChildAdded(allChat, (snapshot) => {
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 60) state.chatMessages.shift();
    refreshChats();
  }));
  if (state.role === TEAM_CHALLENGE_ROLES.CHALLENGER) {
    const teamChat = query(ref(database, `online/teamChats/${state.roomId}/B`), limitToLast(60));
    state.roomUnsubscribers.push(onChildAdded(teamChat, (snapshot) => {
      if (state.seenTeamChatIds.has(snapshot.key)) return;
      state.seenTeamChatIds.add(snapshot.key);
      state.teamChatMessages.push({ id: snapshot.key, ...snapshot.val() });
      if (state.teamChatMessages.length > 60) state.teamChatMessages.shift();
      refreshChats();
    }));
  }
}

async function markDisconnected(uid) {
  if (state.destroyed || state.outcome) return;
  state.destroyed = true;
  await runTransaction(ref(database, `online/teamRooms/${state.roomId}/destroyed`), (current) => current || {
    by: state.uid,
    at: firebaseNow(),
    reason: `disconnect:${uid}`,
  });
  await handleDestroyedRoom();
}

async function setupPeerMesh() {
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTCメディア転送に対応していません。");
  const signalsRef = ref(database, `online/teamRooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    try {
      await handleSignal(snapshot.val());
    } finally {
      await remove(snapshot.ref).catch(() => {});
    }
  }));
  state.members.filter((player) => player.uid !== state.uid).forEach((player) => createConnection(player.uid));
  for (const [remoteUid, connection] of state.connections) {
    if (state.uid.localeCompare(remoteUid) < 0) {
      configureAssetChannel(remoteUid, connection.peer.createDataChannel(ASSET_CHANNEL_LABEL, { ordered: true }));
      configureVideoChannel(remoteUid, connection.peer.createDataChannel(VIDEO_CHANNEL_LABEL, { ordered: true }));
      const offer = await connection.peer.createOffer();
      await connection.peer.setLocalDescription(offer);
      await sendSignal(remoteUid, "offer", { type: offer.type, sdp: offer.sdp });
    }
  }
}

function createConnection(remoteUid) {
  const peer = new RTCPeerConnection({
    iceServers: state.iceServers,
  });
  const connection = {
    remoteUid,
    peer,
    assetChannel: null,
    videoChannel: null,
    pendingIce: [],
    incomingAsset: null,
    incomingVideo: null,
    localCompositionSent: false,
    localFeedbackSent: false,
    compositionAttempts: 0,
    compositionRetryTimer: null,
    remoteTalkMediaReceiving: true,
  };
  state.connections.set(remoteUid, connection);
  peer.onicecandidate = (event) => {
    if (event.candidate) sendSignal(remoteUid, "candidate", event.candidate.toJSON()).catch(handleRecoverableError);
  };
  peer.ondatachannel = (event) => {
    if (event.channel.label === ASSET_CHANNEL_LABEL) configureAssetChannel(remoteUid, event.channel);
    else if (event.channel.label === VIDEO_CHANNEL_LABEL) configureVideoChannel(remoteUid, event.channel);
    else event.channel.close();
  };
  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState) && state.roomId && !state.outcome) markDisconnected(remoteUid).catch(() => {});
    if (state.screen === "connecting") render();
  };
}

async function sendSignal(targetUid, type, payload) {
  await set(push(ref(database, `online/teamRooms/${state.roomId}/signals/${targetUid}`)), {
    fromUid: state.uid,
    type,
    payload: JSON.stringify(payload),
    createdAt: firebaseNow(),
  });
}

async function handleSignal(signal) {
  if (!signal?.fromUid || !state.connections.has(signal.fromUid)) return;
  const connection = state.connections.get(signal.fromUid);
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await connection.peer.setRemoteDescription(payload);
    await flushPendingIce(connection);
    const answer = await connection.peer.createAnswer();
    await connection.peer.setLocalDescription(answer);
    await sendSignal(signal.fromUid, "answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await connection.peer.setRemoteDescription(payload);
    await flushPendingIce(connection);
  } else if (signal.type === "candidate") {
    if (connection.peer.remoteDescription) await connection.peer.addIceCandidate(payload);
    else connection.pendingIce.push(payload);
  }
}

async function flushPendingIce(connection) {
  while (connection.pendingIce.length) await connection.peer.addIceCandidate(connection.pendingIce.shift());
}

function configureAssetChannel(remoteUid, channel) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return channel.close();
  connection.assetChannel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    sendReviewPermission(connection);
    sendLocalFeedback(connection);
    maybeAnnounceMeshReady().catch(handleRecoverableError);
    sendLocalCompositionTo(remoteUid).catch(handleRecoverableError);
    if (state.screen === "connecting") render();
  };
  channel.onclose = () => {
    if (state.roomId && !state.outcome) markDisconnected(remoteUid).catch(() => {});
  };
  channel.onerror = () => showToast("推しセットのP2P通信でエラーが発生しました。");
  channel.onmessage = (event) => handleAssetChannelMessage(remoteUid, event.data).catch((error) => {
    const incomingKind = connection.incomingAsset?.kind || "";
    connection.incomingAsset = null;
    if (incomingKind === "image" && state.screen !== "talk") markDisconnected(remoteUid).catch(() => {});
    else showToast(error?.message || "任意メディアを受信できませんでした。対戦は続行します。");
  });
}

function configureVideoChannel(remoteUid, channel) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return channel.close();
  connection.videoChannel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => sendReviewPermission(connection);
  channel.onclose = () => {
    connection.incomingVideo = null;
  };
  channel.onerror = () => {
    connection.incomingVideo = null;
    showToast("10秒動画を転送できませんでした。画像・音声・ことばで対戦を続けます。");
  };
  channel.onmessage = (event) => handleVideoChannelMessage(remoteUid, event.data).catch((error) => {
    connection.incomingVideo = null;
    showToast(error?.message || "10秒動画を受信できませんでした。対戦は続行します。");
  });
}

function sendReviewPermission(connection) {
  const message = JSON.stringify({ type: "team-talk-media-permission", enabled: state.receiveTalkMedia });
  [connection.assetChannel, connection.videoChannel].forEach((channel) => {
    if (channel?.readyState === "open") channel.send(message);
  });
}

function sendLocalFeedback(connection) {
  if (!state.localFeedback
    || state.screen !== "talk"
    || connection.localFeedbackSent
    || connection.assetChannel?.readyState !== "open") return;
  const memberUids = state.members.map((player) => player.uid);
  if (teamTalkStatus(state.room, memberUids, firebaseNow(), TALK_DURATION_MS) !== "active") return;
  connection.assetChannel.send(JSON.stringify({
    type: "team-talk-feedback",
    ownerUid: state.uid,
    point: normalizeTeamChallengeFocus(state.localFeedback.point),
    role: state.role,
    ...(state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU
      ? { testFocus: normalizeTeamChallengeFocus(state.localFeedback.testFocus) }
      : {}),
  }));
  connection.localFeedbackSent = true;
}

function sendAllLocalFeedback() {
  state.connections.forEach((connection) => sendLocalFeedback(connection));
}

async function maybeAnnounceMeshReady() {
  if (openAssetConnectionCount() !== PLAYER_COUNT - 1 || state.room?.meshReady?.[state.uid]) return;
  await set(ref(database, `online/teamRooms/${state.roomId}/meshReady/${state.uid}`), true);
}

function compositionMeta(ownerUid) {
  return {
    type: "team-composition-meta",
    protocolVersion: TEAM_CHALLENGE_PROTOCOL_VERSION,
    variant: TEAM_CHALLENGE_VARIANT,
    ownerUid,
    words: normalizeTeamChallengeWords(state.composition.words),
    hasAudio: Boolean(state.composition.audio),
    hasVideo: Boolean(state.composition.video),
  };
}

function waitForChannelBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("P2P接続が切れています。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => done(new Error("メディア転送の待機時間を超えました。")), 10_000);
    const done = (error) => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onLow = () => done();
    const onClose = () => done(new Error("P2P接続が切れました。"));
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

function waitForConnectionChannel(connection, key, timeoutMs = 3_000) {
  const current = connection?.[key];
  if (current?.readyState === "open") return Promise.resolve(current);
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const channel = connection?.[key];
      if (channel?.readyState === "open") {
        window.clearInterval(timer);
        resolve(channel);
      } else if (!active || !state.roomId || performance.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}

async function sendLocalCompositionTo(remoteUid) {
  const connection = state.connections.get(remoteUid);
  if (!connection || connection.localCompositionSent || connection.assetChannel?.readyState !== "open") return;
  connection.localCompositionSent = true;
  connection.compositionAttempts += 1;
  try {
    await state.transferQueue.enqueue(remoteUid, async () => {
      const result = { image: false, audio: false, video: false };
      connection.assetChannel.send(JSON.stringify(compositionMeta(state.uid)));
      await sendTeamAsset(connection.assetChannel, state.composition.image, {
        transferId: createTeamAssetTransferId(),
        ownerUid: state.uid,
        phase: "battle",
        slot: "main",
        createdAt: firebaseNow(),
      }, {
        waitForBuffer: waitForChannelBuffer,
        isActive: () => active && state.roomId && connection.assetChannel?.readyState === "open",
      });
      result.image = true;
      if (state.composition.audio) {
        try {
          await sendTeamAsset(connection.assetChannel, state.composition.audio, {
            transferId: createTeamAssetTransferId(),
            ownerUid: state.uid,
            phase: "battle",
            slot: "main",
            createdAt: firebaseNow(),
          }, {
            waitForBuffer: waitForChannelBuffer,
            isActive: () => active && state.roomId && connection.assetChannel?.readyState === "open",
          });
          result.audio = true;
        } catch (error) {
          console.error(error);
          showToast(`${playerName(remoteUid)}へ音声を届けられませんでした。画像で対戦を続けます。`);
        }
      }
      if (state.composition.video) {
        const videoChannel = await waitForConnectionChannel(connection, "videoChannel");
        if (videoChannel?.readyState === "open") {
          try {
            await sendStrategyVideoClip(videoChannel, state.composition.video, {
              transferId: createStrategyVideoTransferId(),
              ownerUid: state.uid,
              phase: "battle",
              round: 1,
              createdAt: firebaseNow(),
            }, {
              waitForBuffer: waitForChannelBuffer,
              isActive: () => active && state.roomId && videoChannel.readyState === "open",
            });
            result.video = true;
          } catch (error) {
            console.error(error);
            showToast(`${playerName(remoteUid)}へ動画を届けられませんでした。画像で対戦を続けます。`);
          }
        } else {
          showToast(`${playerName(remoteUid)}への動画用接続が整わなかったため、画像・音声・ことばで続けます。`);
        }
      }
      connection.assetChannel.send(JSON.stringify({
        type: "team-composition-complete",
        ownerUid: state.uid,
        imageSent: result.image,
        audioSent: result.audio,
        videoSent: result.video,
      }));
    });
    connection.compositionAttempts = 0;
  } catch (error) {
    connection.localCompositionSent = false;
    if (connection.compositionAttempts < 3
      && active
      && state.roomId
      && connection.assetChannel?.readyState === "open") {
      window.clearTimeout(connection.compositionRetryTimer);
      connection.compositionRetryTimer = window.setTimeout(() => {
        connection.compositionRetryTimer = null;
        sendLocalCompositionTo(remoteUid).catch(handleRecoverableError);
      }, 750 * connection.compositionAttempts);
    } else if (state.roomId && !state.outcome) {
      markDisconnected(remoteUid).catch(() => {});
    }
    throw error;
  }
}

function ensureRemoteComposition(uid) {
  if (!state.remoteCompositions.has(uid)) state.remoteCompositions.set(uid, {});
  return state.remoteCompositions.get(uid);
}

async function handleAssetChannelMessage(remoteUid, data) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return;
  if (typeof data === "string") {
    if (data.length > 4096) throw new Error("メディア制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "team-talk-media-permission") {
      connection.remoteTalkMediaReceiving = message.enabled === true;
      return;
    }
    if (message.type === "team-talk-feedback") {
      const memberUids = state.members.map((player) => player.uid);
      const expectedRole = state.room?.players?.[remoteUid]?.role;
      if (state.screen !== "talk"
        || teamTalkStatus(state.room, memberUids, firebaseNow(), TALK_DURATION_MS) !== "active"
        || message.ownerUid !== remoteUid
        || message.role !== expectedRole) return;
      const feedback = {
        point: normalizeTeamChallengeFocus(message.point),
        role: expectedRole,
      };
      if (expectedRole === TEAM_CHALLENGE_ROLES.OSHI_JOUZU) {
        feedback.testFocus = normalizeTeamChallengeFocus(message.testFocus);
      }
      state.remoteFeedback.set(remoteUid, feedback);
      render();
      return;
    }
    if (message.type === "team-composition-meta") {
      if (message.ownerUid !== remoteUid
        || message.protocolVersion !== TEAM_CHALLENGE_PROTOCOL_VERSION
        || message.variant !== TEAM_CHALLENGE_VARIANT) throw new Error("推しセットの送信者情報が一致しません。");
      ensureRemoteComposition(remoteUid).meta = {
        words: normalizeTeamChallengeWords(message.words),
        hasAudio: message.hasAudio === true,
        hasVideo: message.hasVideo === true,
      };
      return;
    }
    if (message.type === "team-composition-complete") {
      if (message.ownerUid !== remoteUid || message.imageSent !== true || !ensureRemoteComposition(remoteUid).image) {
        throw new Error("必須の推し画像を受信できませんでした。");
      }
      ensureRemoteComposition(remoteUid).complete = true;
      await maybeMarkAssetsReady();
      return;
    }
    if (message.type === "team-reference-meta") {
      if (state.screen !== "talk" || !state.receiveTalkMedia || message.ownerUid !== remoteUid) return;
      ensureRemoteComposition(remoteUid).referenceKind = message.kind === "image" || message.kind === "video" ? message.kind : "";
      return;
    }
    if (message.type === "team-asset-start") {
      const expectedPhase = state.screen === "talk" ? String(message.phase || "") : "battle";
      if (expectedPhase === "talk" && !state.receiveTalkMedia) throw new Error("参考メディアの受信を停止しています。");
      if (connection.incomingAsset
        && connection.incomingAsset.kind === "image"
        && message.kind === "image"
        && connection.incomingAsset.phase === "battle"
        && message.phase === "battle") {
        connection.incomingAsset = null;
      }
      connection.incomingAsset = createIncomingTeamAssetTransfer(message, {
        currentTransfer: connection.incomingAsset,
        expectedOwnerUid: remoteUid,
        expectedPhase,
      });
      return;
    }
    if (message.type === "team-asset-end") {
      const transfer = connection.incomingAsset;
      const status = teamAssetEndStatus(transfer, message);
      if (status === "orphan") return;
      if (status !== "complete") {
        connection.incomingAsset = null;
        throw new Error("推しメディアの受信が完了しませんでした。");
      }
      connection.incomingAsset = null;
      const asset = await finishIncomingTeamAssetTransfer(transfer, message);
      if (asset.phase === "talk") {
        if (!state.receiveTalkMedia || state.screen !== "talk" || state.remoteReferences.has(remoteUid)) {
          releaseTeamAssetResource(asset);
          return;
        }
        state.remoteReferences.set(remoteUid, asset);
      } else {
        const composition = ensureRemoteComposition(remoteUid);
        if (asset.kind === "image") {
          if (composition.image) releaseTeamAssetResource(composition.image);
          composition.image = asset;
        } else {
          if (composition.audio) releaseTeamAssetResource(composition.audio);
          composition.audio = asset;
        }
      }
      render();
    }
    return;
  }
  if (!connection.incomingAsset) return;
  await appendTeamAssetChunk(connection.incomingAsset, data);
}

async function handleVideoChannelMessage(remoteUid, data) {
  const connection = state.connections.get(remoteUid);
  if (!connection) return;
  if (typeof data === "string") {
    if (data.length > 4096) throw new Error("動画制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "team-talk-media-permission") {
      connection.remoteTalkMediaReceiving = message.enabled === true;
      return;
    }
    if (message.type === "strategy-video-start") {
      const phase = message.phase === "review" ? "review" : "battle";
      if (phase === "review" && (state.screen !== "talk" || !state.receiveTalkMedia || state.remoteReferences.has(remoteUid))) {
        throw new Error("現在は参考動画を受信しません。");
      }
      connection.incomingVideo = createIncomingStrategyVideoTransfer(message, {
        currentTransfer: connection.incomingVideo,
        expectedOwnerUid: remoteUid,
        allowedPhases: [phase],
        maxRounds: 1,
        now: firebaseNow(),
      });
      return;
    }
    if (message.type === "strategy-video-end") {
      const transfer = connection.incomingVideo;
      if (!transfer) return;
      connection.incomingVideo = null;
      const clip = finishIncomingStrategyVideoTransfer(transfer, message);
      clip.kind = "video";
      if (clip.phase === "review") {
        if (!state.receiveTalkMedia || state.screen !== "talk" || state.remoteReferences.has(remoteUid)) {
          releaseStrategyVideoResource(clip);
          return;
        }
        state.remoteReferences.set(remoteUid, clip);
      } else {
        const composition = ensureRemoteComposition(remoteUid);
        if (composition.video) releaseStrategyVideoResource(composition.video);
        composition.video = clip;
      }
      render();
    }
    return;
  }
  if (!connection.incomingVideo) return;
  await appendStrategyVideoChunk(connection.incomingVideo, data);
}

function hasAllRemoteCompositions() {
  return state.members.filter((player) => player.uid !== state.uid)
    .every((player) => {
      const composition = state.remoteCompositions.get(player.uid);
      return composition?.complete === true && Boolean(composition.image?.url) && Boolean(composition.meta);
    });
}

async function maybeMarkAssetsReady() {
  if (state.assetsReadyWritten || !hasAllRemoteCompositions()) return;
  state.assetsReadyWritten = true;
  await set(ref(database, `online/teamRooms/${state.roomId}/assetsReady/${state.uid}`), true);
}

async function reactToRoomData() {
  if (!state.roomId || !state.room) return;
  if (state.room.destroyed && !state.outcome && state.screen !== "noContest") {
    await handleDestroyedRoom();
    return;
  }
  const memberUids = state.members.map((player) => player.uid);
  const host = state.room.hostUid === state.uid;
  if (host && allMembersMarked(state.room.meshReady, memberUids) && !state.room.duoStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/duoStartedAt`), (current) => current === null ? firebaseNow() : undefined);
    return;
  }
  if (Number(state.room.duoStartedAt || 0) > 0 && !state.room.duoPlan) {
    startDuoTimer();
    if (state.role === TEAM_CHALLENGE_ROLES.CHALLENGER && !["duoStrategy", "noContest", "error"].includes(state.screen)) {
      state.screen = "duoStrategy";
      seedDuoChoice();
      render();
    } else if (state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU && state.screen === "connecting") {
      state.screen = "waitingAssets";
      render();
    }
    const bothLocked = state.challengerUids.every((uid) => state.room.duoChoices?.[uid]?.locked === true);
    const expired = firebaseNow() >= Number(state.room.duoStartedAt) + DUO_STRATEGY_MS;
    if (host && (bothLocked || expired)) await lockDuoPlan();
  }
  if (state.room.duoPlan) {
    state.duoPlan = state.room.duoPlan;
    stopDuoTimer();
    if (["connecting", "duoStrategy"].includes(state.screen)) {
      state.screen = "waitingAssets";
      render();
    }
  }
  await maybeMarkAssetsReady();
  if (host && state.room.duoPlan && allMembersMarked(state.room.assetsReady, memberUids) && !state.room.revealStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/revealStartedAt`), (current) => current === null ? firebaseNow() : undefined);
    return;
  }
  if (Number(state.room.revealStartedAt || 0) > 0 && !allMembersMarked(state.room.presentationCompleted, memberUids)) {
    if (!["reveal", "score", "waitingScore", "result", "talk"].includes(state.screen)) {
      state.screen = "reveal";
      render();
    }
  }
  if (host && allMembersMarked(state.room.presentationCompleted, memberUids) && !state.room.scoringStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/scoringStartedAt`), (current) => current === null ? firebaseNow() : undefined);
    return;
  }
  if (Number(state.room.scoringStartedAt || 0) > 0 && state.room.scoreReady?.[state.uid] !== true && !["score", "waitingScore", "result", "talk"].includes(state.screen)) {
    state.screen = "score";
    startScoreTimer();
    render();
  }
  if (allMembersMarked(state.room.scoreReady, memberUids)) await resolveSealedScores();
  const talkStatus = teamTalkStatus(state.room, memberUids, firebaseNow(), TALK_DURATION_MS);
  if (host && talkStatus === "ready" && !state.room.talkStartedAt) {
    await runTransaction(ref(database, `online/teamRooms/${state.roomId}/talkStartedAt`), (current) => current === null ? firebaseNow() : undefined);
    return;
  }
  if (talkStatus === "active" && state.screen !== "talk") {
    state.screen = "talk";
    setTeamChrome("三人の推しトーク会");
    startTalkClock();
    sendAllReviewPermissions();
    sendAllLocalFeedback();
    render();
  }
  if (state.screen === "talk" && ["ended", "expired"].includes(talkStatus)) {
    finishTalkLocally(talkStatus);
  }
  if (state.screen === "talk") {
    for (const side of Object.values(TEAM_CHALLENGE_SIDES)) {
      const replay = state.room.talkReplay?.[side] || {};
      if (host && presentationReplayStatus(replay, memberUids) === "ready" && !replay.startedAt) {
        await runTransaction(ref(database, `online/teamRooms/${state.roomId}/talkReplay/${side}/startedAt`), (current) => current === null ? firebaseNow() : undefined);
      }
    }
    render();
  }
}

async function resolveSealedScores() {
  if (state.resolvedResult || state.sealedScoresLoading || !state.roomId) return;
  state.sealedScoresLoading = true;
  try {
    const snapshot = await get(ref(database, `online/teamDuoScores/${state.roomId}`));
    const scores = snapshot.val() || {};
    if (!state.members.every((player) => scores[player.uid])) return;
    state.sealedScores = scores;
    stopScoreTimer();
    state.resolvedResult = resolveDuoChallengeScores({
      scores,
      soloUid: state.soloUid,
      challengerUids: state.challengerUids,
    });
    state.outcome = state.resolvedResult.outcomes[state.uid];
    state.screen = "result";
    render();
    commitVerifiedResult().catch(handleRecoverableError);
  } finally {
    state.sealedScoresLoading = false;
  }
}

function seedDuoChoice() {
  if (state.role !== TEAM_CHALLENGE_ROLES.CHALLENGER) return;
  const player = localPlayer();
  state.selectedDuoChoice = {
    audioOwnerUid: player?.components?.audio ? state.uid : "",
    videoOwnerUid: player?.components?.video ? state.uid : "",
    wordsOwnerUid: player?.components?.words ? state.uid : "",
  };
}

function startDuoTimer() {
  if (state.duoTimer) return;
  const updateTimer = () => {
    const element = document.querySelector("#duoStrategyTimer");
    if (element) element.textContent = String(duoRemainingSeconds());
    if (duoRemainingSeconds() <= 0) {
      stopDuoTimer();
      if (state.room?.hostUid === state.uid && !state.room?.duoPlan) {
        lockDuoPlan().catch(handleRecoverableError);
      }
    }
  };
  updateTimer();
  state.duoTimer = window.setInterval(updateTimer, 250);
}

function stopDuoTimer() {
  window.clearInterval(state.duoTimer);
  state.duoTimer = null;
}

function bindDuoStrategyEvents() {
  ["audio", "video", "words"].forEach((kind) => {
    document.querySelectorAll(`input[name="duo-${kind}"]`).forEach((input) => input.addEventListener("change", () => {
      state.selectedDuoChoice[`${kind}OwnerUid`] = String(input.value || "");
    }));
  });
  document.querySelector("#lockDuoChoice")?.addEventListener("click", submitDuoChoice);
}

async function submitDuoChoice() {
  if (state.duoLocking || state.role !== TEAM_CHALLENGE_ROLES.CHALLENGER) return;
  state.duoLocking = true;
  render();
  try {
    await set(ref(database, `online/teamRooms/${state.roomId}/duoChoices/${state.uid}`), {
      ...state.selectedDuoChoice,
      locked: true,
      lockedAt: serverTimestamp(),
    });
  } finally {
    state.duoLocking = false;
    render();
  }
}

async function lockDuoPlan() {
  if (state.room?.duoPlan) return;
  const plan = resolveDuoPlan({
    challengers: challengerPlayers(),
    choices: state.room?.duoChoices || {},
    components: Object.fromEntries(challengerPlayers().map((player) => [player.uid, {
      audio: player.components?.audio === true,
      video: player.components?.video === true,
      words: player.components?.words === true ? "yes" : "",
    }])),
  });
  if (!plan.ready) return;
  await runTransaction(ref(database, `online/teamRooms/${state.roomId}/duoPlan`), (current) => current === null ? {
    audioOwnerUid: plan.audioOwnerUid,
    videoOwnerUid: plan.videoOwnerUid,
    wordsOwnerUid: plan.wordsOwnerUid,
    agreed: plan.agreed,
    lockedAt: firebaseNow(),
  } : undefined);
}

async function openMainPresentation() {
  if (state.presentationOpening || state.room?.presentationCompleted?.[state.uid]) return;
  state.presentationOpening = true;
  state.presentationOpened = true;
  render();
  try {
    for (const side of state.presentationOrder) await playSidePresentation(side);
  } catch (error) {
    console.error(error);
    showToast("一部の任意メディアを再生できませんでした。画像・ことばで採点へ進みます。");
  } finally {
    state.presentationOpening = false;
    await set(ref(database, `online/teamRooms/${state.roomId}/presentationCompleted/${state.uid}`), true);
  }
}

function sideAudio(side) {
  return side === TEAM_CHALLENGE_SIDES.SOLO ? receivedComposition(state.soloUid).audio : selectedDuoMedia("audio");
}

function sideVideo(side) {
  return side === TEAM_CHALLENGE_SIDES.SOLO ? receivedComposition(state.soloUid).video : selectedDuoMedia("video");
}

async function playMediaElement(kind, url) {
  if (!url) return;
  const element = document.createElement(kind);
  element.preload = "auto";
  element.playsInline = true;
  element.muted = state.muted;
  element.src = url;
  if (kind === "video") {
    element.style.position = "fixed";
    element.style.inset = "10%";
    element.style.width = "80%";
    element.style.height = "80%";
    element.style.zIndex = "999";
    element.style.objectFit = "contain";
    element.style.background = "#070910";
    document.body.append(element);
  }
  try {
    await element.play();
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => resolve(), 11_000);
      element.addEventListener("ended", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      element.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("メディアを再生できませんでした。")); }, { once: true });
    });
  } finally {
    element.pause();
    element.removeAttribute("src");
    element.remove();
  }
}

async function playSidePresentation(side, { requireSuccessfulMedia = false } = {}) {
  const label = side === TEAM_CHALLENGE_SIDES.SOLO ? "推し上手さん" : "ふたり推し";
  triggerCriticalFx(label);
  const audio = sideAudio(side);
  const video = sideVideo(side);
  if (audio?.url) {
    const playback = playMediaElement("audio", audio.url);
    if (requireSuccessfulMedia) await playback;
    else await playback.catch((error) => console.error(error));
  }
  if (video?.url) {
    const playback = playMediaElement("video", video.url);
    if (requireSuccessfulMedia) await playback;
    else await playback.catch((error) => console.error(error));
  }
  if (!audio?.url && !video?.url) await new Promise((resolve) => window.setTimeout(resolve, 700));
}

function startScoreTimer() {
  if (state.scoreTimer || state.scoreWritten) return;
  const updateTimer = () => {
    const remaining = scoreTimerSeconds();
    const element = document.querySelector("#teamScoreTimer");
    if (element) element.textContent = String(remaining);
    if (remaining > 0 || state.scoreLocking || state.scoreWritten) return;
    scoreTargets().forEach((player) => {
      if (!Number.isInteger(state.selectedScores[player.uid])) state.selectedScores[player.uid] = 5;
    });
    showToast("採点時間切れのため、未採点は5点として確定します。");
    lockScores(true).catch(handleRecoverableError);
  };
  updateTimer();
  state.scoreTimer = window.setInterval(updateTimer, 250);
}

function stopScoreTimer() {
  window.clearInterval(state.scoreTimer);
  state.scoreTimer = null;
}

function bindScoreEvents() {
  document.querySelectorAll("[data-team-score-target]").forEach((button) => button.addEventListener("click", () => {
    state.selectedScores[button.dataset.teamScoreTarget] = Number(button.dataset.teamScore);
    render();
  }));
  document.querySelector("#lockTeamScores")?.addEventListener("click", () => lockScores(false));
}

async function lockScores(auto = false) {
  if (state.scoreLocking || state.scoreWritten) return;
  const targets = scoreTargets();
  if (!targets.every((player) => Number.isInteger(state.selectedScores[player.uid]) && state.selectedScores[player.uid] >= 1 && state.selectedScores[player.uid] <= 10)) return;
  state.scoreLocking = true;
  stopScoreTimer();
  state.screen = "waitingScore";
  render();
  const values = Object.fromEntries(targets.map((player) => [player.uid, Number(state.selectedScores[player.uid])]));
  try {
    const scoreRef = ref(database, `online/teamDuoScores/${state.roomId}/${state.uid}`);
    const existingScore = await get(scoreRef);
    if (!existingScore.exists()) {
      await set(scoreRef, {
        values,
        auto: auto === true,
        lockedAt: serverTimestamp(),
      });
    }
    await set(ref(database, `online/teamRooms/${state.roomId}/scoreReady/${state.uid}`), true);
    state.scoreWritten = true;
  } catch (error) {
    state.screen = "score";
    startScoreTimer();
    throw error;
  } finally {
    state.scoreLocking = false;
  }
}

async function commitVerifiedResult() {
  if (state.verifiedResultCommitted || state.verifiedResultPending || !state.resolvedResult || !state.outcome) return;
  state.verifiedResultPending = true;
  try {
    const updateResult = window.HariaiOnline?.recordOverallResult?.({
      mode: "team",
      outcome: state.outcome,
      name: state.name,
      opponentRating: 1000,
      roomId: state.roomId,
    });
    const overallResult = updateResult ? await updateResult : null;
    if (overallResult?.economyBalance !== undefined && overallResult?.economyBalance !== null) {
      state.economy.points = Number(overallResult.economyBalance);
    }
    if (overallResult?.outcome === "pending") {
      window.setTimeout(() => {
        state.verifiedResultPending = false;
        commitVerifiedResult().catch(handleRecoverableError);
      }, Math.max(500, Number(overallResult.retryAfterMs || 1000)));
      return;
    }
    state.verifiedResultCommitted = true;
  } finally {
    if (!state.verifiedResultCommitted) state.verifiedResultPending = false;
    if (state.screen === "result") render();
  }
}

function bindResultEvents() {
  bindPostMatchTip(appRoot, {
    mode: "team",
    roomId: state.roomId,
    viewerUid: state.uid,
    recipients: state.members,
    balance: state.economy.points,
    onBalanceChange: (balance) => { state.economy.points = balance; },
  });
  document.querySelectorAll('input[name="teamFeedback"]').forEach((input) => input.addEventListener("change", () => {
    state.feedbackChoice = normalizeTeamChallengeFocus(input.value);
  }));
  document.querySelector("#submitTeamFeedback")?.addEventListener("click", submitFeedback);
  document.querySelector("#acceptTeamTalk")?.addEventListener("click", () => submitTalkDecision("accept"));
  document.querySelector("#declineTeamTalk")?.addEventListener("click", () => submitTalkDecision("decline"));
  document.querySelector("#teamNewMatch")?.addEventListener("click", resetSetup);
  document.querySelector("#teamGameoverHome")?.addEventListener("click", leaveToLanding);
}

async function submitFeedback() {
  if (state.feedbackWritten || state.room?.feedbackReady?.[state.uid] === true) return;
  const point = normalizeTeamChallengeFocus(state.feedbackChoice);
  const value = {
    point,
    role: state.role,
  };
  if (state.role === TEAM_CHALLENGE_ROLES.OSHI_JOUZU) value.testFocus = normalizeTeamChallengeFocus(state.focus);
  state.localFeedback = value;
  await set(ref(database, `online/teamRooms/${state.roomId}/feedbackReady/${state.uid}`), true);
  state.feedbackWritten = true;
  render();
}

async function submitTalkDecision(decision) {
  if (!["accept", "decline"].includes(decision) || state.room?.talkDecisions?.[state.uid]) return;
  await set(ref(database, `online/teamRooms/${state.roomId}/talkDecisions/${state.uid}`), decision);
}

function bindTalkEvents() {
  document.querySelector("#leaveTeamTalk")?.addEventListener("click", leaveTeamTalk);
  document.querySelectorAll("[data-talk-replay-ready]").forEach((button) => button.addEventListener("click", () => markTalkReplayReady(button.dataset.talkReplayReady)));
  document.querySelectorAll("[data-talk-replay-play]").forEach((button) => button.addEventListener("click", () => playTalkReplay(button.dataset.talkReplayPlay)));
  document.querySelector("#toggleTeamTalkMedia")?.addEventListener("click", toggleTalkMedia);
  document.querySelector("#toggleTeamMute")?.addEventListener("click", () => { state.muted = !state.muted; render(); });
  document.querySelector("#teamReferenceImageInput")?.addEventListener("change", (event) => prepareReferenceImage(event.target.files?.[0]));
  document.querySelector("#recordTeamReferenceVideo")?.addEventListener("click", () => beginTeamVideoCapture("reference"));
  document.querySelectorAll("[data-play-reference-video]").forEach((button) => button.addEventListener("click", () => playReferenceVideo(button.dataset.playReferenceVideo)));
}

function startTalkClock() {
  if (state.talkClock) return;
  const tick = () => {
    const remaining = talkRemainingMs();
    const clock = document.querySelector("#teamTalkCountdown");
    if (clock) clock.textContent = formatRemaining(remaining);
    if (remaining <= 0 && state.screen === "talk") finishTalkLocally("expired");
  };
  tick();
  state.talkClock = window.setInterval(tick, 1000);
}

function stopTalkClock() {
  window.clearInterval(state.talkClock);
  state.talkClock = null;
}

async function leaveTeamTalk() {
  if (state.screen !== "talk") return;
  await set(ref(database, `online/teamRooms/${state.roomId}/talkEnded/${state.uid}`), true).catch(() => {});
  finishTalkLocally("left");
}

function finishTalkLocally() {
  stopTalkClock();
  releaseTalkReferences();
  state.screen = "result";
  setTeamChrome("推し上手 COMPLETE");
  render();
}

async function markTalkReplayReady(side) {
  if (!Object.values(TEAM_CHALLENGE_SIDES).includes(side)) return;
  await set(ref(database, `online/teamRooms/${state.roomId}/talkReplay/${side}/ready/${state.uid}`), true);
}

async function playTalkReplay(side) {
  if (state.talkReplayRunning.has(side) || state.room?.talkReplay?.[side]?.completed?.[state.uid]) return;
  if (!state.room?.talkReplay?.[side]?.startedAt) return;
  state.talkReplayRunning.add(side);
  render();
  try {
    await playSidePresentation(side, { requireSuccessfulMedia: true });
    await set(ref(database, `online/teamRooms/${state.roomId}/talkReplay/${side}/completed/${state.uid}`), true);
  } catch (error) {
    showToast("再鑑賞に失敗しました。回数は消費していないため、もう一度試せます。");
  } finally {
    state.talkReplayRunning.delete(side);
    render();
  }
}

function toggleTalkMedia() {
  state.receiveTalkMedia = !state.receiveTalkMedia;
  if (!state.receiveTalkMedia) {
    state.connections.forEach((connection) => {
      if (connection.incomingAsset?.phase === "talk") connection.incomingAsset = null;
      if (connection.incomingVideo?.phase === "review") connection.incomingVideo = null;
    });
  }
  sendAllReviewPermissions();
  render();
}

function sendAllReviewPermissions() {
  state.connections.forEach(sendReviewPermission);
}

async function prepareReferenceImage(file) {
  if (!file || state.localReference || state.screen !== "talk") return;
  setBusy(true, "参考画像を整えています…");
  try {
    const item = await shared().processImageFile(file, 0, { maxSide: 1280, quality: 0.82 });
    state.localReference = { ...item, kind: "image", mime: "image/webp", duration: 0 };
    await sendLocalReference();
  } catch (error) {
    showToast(error?.message || "参考画像を準備できませんでした。");
  } finally {
    setBusy(false);
    render();
  }
}

async function sendLocalReference() {
  if (!state.localReference || state.localReferenceSent || state.screen !== "talk") return;
  state.localReferenceSent = true;
  const tasks = [];
  state.connections.forEach((connection, remoteUid) => {
    if (!connection.remoteTalkMediaReceiving) return;
    tasks.push(state.transferQueue.enqueue(remoteUid, async () => {
      if (connection.assetChannel?.readyState !== "open") return;
      connection.assetChannel.send(JSON.stringify({
        type: "team-reference-meta",
        ownerUid: state.uid,
        kind: state.localReference.kind,
      }));
      if (state.localReference.kind === "image") {
        await sendTeamAsset(connection.assetChannel, state.localReference, {
          transferId: createTeamAssetTransferId(),
          ownerUid: state.uid,
          phase: "talk",
          slot: "reference",
          createdAt: firebaseNow(),
        }, {
          waitForBuffer: waitForChannelBuffer,
          isActive: () => active && state.screen === "talk" && connection.assetChannel?.readyState === "open",
        });
      } else if (connection.videoChannel?.readyState === "open") {
        await sendStrategyVideoClip(connection.videoChannel, state.localReference, {
          transferId: createStrategyVideoTransferId(),
          ownerUid: state.uid,
          phase: "review",
          round: 0,
          createdAt: firebaseNow(),
        }, {
          waitForBuffer: waitForChannelBuffer,
          isActive: () => active && state.screen === "talk" && connection.videoChannel?.readyState === "open",
        });
      }
    }).catch((error) => {
      console.error(error);
      showToast(`${playerName(remoteUid)}へ参考アイテムを届けられませんでした。推しトーク会は続けられます。`);
    }));
  });
  await Promise.allSettled(tasks);
}

async function playReferenceVideo(ownerUid) {
  const item = ownerUid === state.uid ? state.localReference : state.remoteReferences.get(ownerUid);
  if (!item || item.kind !== "video" || state.referenceVideoPlaying.has(ownerUid)) return;
  if (referenceVideoPlayStatus(state.room?.referenceVideoPlay?.[ownerUid], state.uid) !== "ready") return;
  state.referenceVideoPlaying.add(ownerUid);
  await set(ref(database, `online/teamRooms/${state.roomId}/referenceVideoPlay/${ownerUid}/playing/${state.uid}`), true).catch(() => {});
  render();
  try {
    await playMediaElement("video", item.url);
    await set(ref(database, `online/teamRooms/${state.roomId}/referenceVideoPlay/${ownerUid}/success/${state.uid}`), true);
  } catch {
    await remove(ref(database, `online/teamRooms/${state.roomId}/referenceVideoPlay/${ownerUid}/playing/${state.uid}`)).catch(() => {});
    showToast("参考動画を再生できませんでした。回数は消費していません。");
  } finally {
    state.referenceVideoPlaying.delete(ownerUid);
    render();
  }
}

function unlockedReactions() {
  return [...DEFAULT_REACTIONS, ...SHOP_REACTIONS.filter((item) => state.economy.equipped?.reactions?.[item.id]).map((item) => item.reaction)];
}

function attachChatCosmetics(message) {
  const cosmetics = getEquippedChatCosmetics(state.economy);
  if (cosmetics.chatFrameId) message.chatFrameId = cosmetics.chatFrameId;
  if (cosmetics.chatBackgroundId) message.chatBackgroundId = cosmetics.chatBackgroundId;
}

function renderMessages(messages, emptyText) {
  return messages.length ? messages.map((message) => {
    const classes = chatCosmeticClassNames(message.chatFrameId, message.chatBackgroundId);
    const content = message.stampId
      ? renderStampBubble(message.stampId, classes)
      : `<p${classes ? ` class="${classes}"` : ""}>${escapeHtml(message.text)}</p>`;
    return `<div class="chat-message ${message.authorUid === state.uid ? "player-one" : "player-two"}"><small>${escapeHtml(message.name)}${message.titleId ? renderTitleBadge(message.titleId) : ""}</small>${content}</div>`;
  }).join("") : `<div class="chat-empty">${emptyText}</div>`;
}

function renderTeamPrivateChat() {
  return `<aside class="chat-panel team-private-chat"><div class="chat-head"><strong>ふたり推し / ひみつチャット</strong><span>推し上手さんには非公開</span></div>
    <div class="chat-messages" id="teamPrivateChatMessages">${renderMessages(state.teamChatMessages, "ふたりの共同演出を相談しましょう。")}</div>
    ${renderChatTools({ id: "team-private", textReactions: unlockedReactions(), stamps: getAvailableStamps(state.economy), textAttribute: "data-team-private-reaction", stampAttribute: "data-team-private-stamp" })}
    <form class="chat-form" id="teamPrivateChatForm"><input class="chat-input" id="teamPrivateChatInput" maxlength="80" placeholder="相方へひとこと…" /><button class="button button-cyan button-small">送信</button></form></aside>`;
}

function renderAllChat() {
  const reviewing = state.screen === "talk";
  return `<aside class="chat-panel online-chat-standalone"><div class="chat-head"><strong>${reviewing ? "三人の推しトーク会" : "三人チャット"}</strong><span>三人全員に表示</span></div>
    <div class="chat-messages" id="teamAllChatMessages">${renderMessages(state.chatMessages, reviewing ? "どこが届いたか、気軽に話してみましょう。" : "公開された推し表現へ、やさしいひとことを。")}</div>
    ${renderChatTools({ id: "team-all", textReactions: unlockedReactions(), stamps: getAvailableStamps(state.economy), textAttribute: "data-team-all-reaction", stampAttribute: "data-team-all-stamp" })}
    <form class="chat-form" id="teamAllChatForm"><input class="chat-input" id="teamAllChatInput" maxlength="80" placeholder="${reviewing ? "この一戦の感想を送る…" : "三人へひとこと…"}" /><button class="button button-cyan button-small">送信</button></form></aside>`;
}

function bindChatEvents() {
  bindChatToolTabs();
  document.querySelectorAll("[data-team-private-reaction]").forEach((button) => button.addEventListener("click", () => sendTeamPrivateChat(button.dataset.teamPrivateReaction)));
  document.querySelectorAll("[data-team-private-stamp]").forEach((button) => button.addEventListener("click", () => sendTeamPrivateChat("", button.dataset.teamPrivateStamp)));
  document.querySelectorAll("[data-team-all-reaction]").forEach((button) => button.addEventListener("click", () => sendAllChat(button.dataset.teamAllReaction)));
  document.querySelectorAll("[data-team-all-stamp]").forEach((button) => button.addEventListener("click", () => sendAllChat("", button.dataset.teamAllStamp)));
  document.querySelector("#teamPrivateChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#teamPrivateChatInput");
    sendTeamPrivateChat(input?.value || "");
    if (input) input.value = "";
  });
  document.querySelector("#teamAllChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#teamAllChatInput");
    sendAllChat(input?.value || "");
    if (input) input.value = "";
  });
  scrollChats();
}

function chatMessage(value, stampId = "") {
  const stamp = getStamp(stampId);
  if (stampId && (!stamp || !canUseStamp(stampId, state.economy))) {
    showToast("このスタンプは現在の装備に含まれていません。");
    return null;
  }
  const text = stamp ? stamp.label : normalizeTeamChallengeWords(value, 80);
  if (!text) return null;
  const message = { authorUid: state.uid, name: state.name, text, round: 1, createdAt: serverTimestamp() };
  if (stamp) message.stampId = stamp.id;
  if (titleLabel()) message.titleId = state.economy.equipped.title;
  attachChatCosmetics(message);
  return { message, stamp };
}

async function sendTeamPrivateChat(value, stampId = "") {
  if (state.role !== TEAM_CHALLENGE_ROLES.CHALLENGER || !state.roomId) return;
  const prepared = chatMessage(value, stampId);
  if (!prepared) return;
  if (prepared.stamp && !acquireStampCooldown("team-private")) return showToast("スタンプは2秒に1回送信できます。");
  if (prepared.stamp) startStampButtonCooldown("[data-team-private-stamp]");
  await set(push(ref(database, `online/teamChats/${state.roomId}/B`)), prepared.message).catch(() => showToast("ひみつチャットを送信できませんでした。"));
}

async function sendAllChat(value, stampId = "") {
  if (!state.roomId) return;
  const prepared = chatMessage(value, stampId);
  if (!prepared) return;
  if (prepared.stamp && !acquireStampCooldown("team-all")) return showToast("スタンプは2秒に1回送信できます。");
  if (prepared.stamp) startStampButtonCooldown("[data-team-all-stamp]");
  await set(push(ref(database, `online/teamRooms/${state.roomId}/chat`)), prepared.message).catch(() => showToast("三人チャットを送信できませんでした。"));
}

function refreshChats() {
  const privateList = document.querySelector("#teamPrivateChatMessages");
  if (privateList) privateList.innerHTML = renderMessages(state.teamChatMessages, "ふたりの共同演出を相談しましょう。");
  const allList = document.querySelector("#teamAllChatMessages");
  if (allList) allList.innerHTML = renderMessages(state.chatMessages, state.screen === "talk" ? "どこが届いたか、気軽に話してみましょう。" : "公開された推し表現へ、やさしいひとことを。");
  scrollChats();
}

function scrollChats() {
  ["#teamPrivateChatMessages", "#teamAllChatMessages"].forEach((selector) => {
    const list = document.querySelector(selector);
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1200);
}

function requestHome() {
  if (isPostMatchTipBusy("team", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (["role", "setup", "matching", "result", "noContest", "error"].includes(state.screen)) leaveToLanding();
  else destroyDialog.showModal();
}

async function destroyRoom() {
  if (!active) return;
  const targetRoomId = state.roomId || state.pendingRoomId;
  if (targetRoomId) {
    await runTransaction(ref(database, `online/teamRooms/${targetRoomId}/destroyed`), (current) => current || {
      by: state.uid,
      at: firebaseNow(),
      reason: "user",
    }).catch(() => {});
  }
  await cleanupRoomResources(false);
  releaseAllMedia();
  active = false;
  window.HariaiApp?.returnHome();
  showToast("三人の場を閉じました。正式結果前なら戦績には影響しません。");
}

async function handleDestroyedRoom() {
  if (state.screen === "noContest" || state.outcome) return;
  state.destroyed = true;
  await cleanupRoomResources(false);
  releaseMatchMedia();
  state.screen = "noContest";
  setTeamChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "setup";
  setTeamChrome("推し上手 READY");
  render();
}

function preservedIdentity() {
  return {
    uid: state.uid,
    name: state.name,
    authReady: state.authReady,
    role: state.role,
    focus: state.focus,
    economy: state.economy,
    composition: state.composition,
    serverTimeOffset: state.serverTimeOffset,
  };
}

async function resetSetup() {
  if (isPostMatchTipBusy("team", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  const deck = prepareDeckForRematch(state.deck);
  const identity = preservedIdentity();
  await cleanupRoomResources(false);
  releaseMatchMedia();
  state = createState();
  Object.assign(state, identity);
  state.deck = deck;
  state.screen = "setup";
  setTeamChrome("推し上手 READY");
  render();
}

async function retryConnection() {
  const identity = preservedIdentity();
  await cleanupRoomResources(false);
  releaseMatchMedia();
  state = createState();
  Object.assign(state, identity);
  state.authReady = false;
  state.screen = "role";
  setTeamChrome("推し上手 CONNECTING");
  render();
  ensureAuthenticated().catch(handleFatalError);
}

async function leaveToLanding() {
  if (isPostMatchTipBusy("team", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  await cleanupRoomResources(false);
  releaseAllImages();
  active = false;
  window.HariaiApp?.returnHome();
}

async function cleanupMatchmaking(keepActive) {
  window.clearTimeout(state.matchTimer);
  window.clearInterval(state.queueHeartbeat);
  state.matchTimer = null;
  state.queueHeartbeat = null;
  state.matchmakingUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (!state.uid) return;
  const removals = [
    remove(ref(database, `online/teamQueue/${state.uid}`)),
    remove(ref(database, `online/teamInvites/${state.uid}`)),
  ];
  if (!keepActive) removals.push(remove(ref(database, `online/teamActive/${state.uid}`)));
  await Promise.allSettled(removals);
}

async function cleanupRoomResources(keepActive) {
  stopDuoTimer();
  stopScoreTimer();
  stopTalkClock();
  stopVideoCapture();
  await cleanupMatchmaking(keepActive);
  await cleanupPublicPresence();
  state.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  state.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  state.connections.forEach((connection) => {
    window.clearTimeout(connection.compositionRetryTimer);
    if (connection.assetChannel) {
      connection.assetChannel.onclose = null;
      connection.assetChannel.close();
    }
    if (connection.videoChannel) connection.videoChannel.close();
    connection.peer.onconnectionstatechange = null;
    connection.peer.close();
  });
  state.connections.clear();
  state.transferQueue.clear();
  if (state.roomId) {
    await Promise.allSettled([
      set(ref(database, `online/teamRooms/${state.roomId}/presence/${state.uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : remove(ref(database, `online/teamActive/${state.uid}`)),
    ]);
  }
}

function releaseTalkReferences() {
  if (state.localReference) {
    if (state.localReference.kind === "video") releaseStrategyVideoResource(state.localReference);
    else releaseTeamAssetResource(state.localReference);
  }
  state.localReference = null;
  state.localReferenceSent = false;
  state.remoteReferences.forEach((item) => {
    if (item.kind === "video") releaseStrategyVideoResource(item);
    else releaseTeamAssetResource(item);
  });
  state.remoteReferences.clear();
}

function releaseMatchMedia() {
  state.remoteCompositions.forEach((composition) => {
    releaseTeamAssetResources([composition.image, composition.audio].filter(Boolean));
    if (composition.video) releaseStrategyVideoResource(composition.video);
  });
  state.remoteCompositions.clear();
  releaseTalkReferences();
  state.chatMessages = [];
  state.teamChatMessages = [];
  state.seenChatIds.clear();
  state.seenTeamChatIds.clear();
}

function releaseAllImages() {
  state.deck.forEach((item) => {
    if (item?.url) URL.revokeObjectURL(item.url);
  });
  state.deck = [];
  state.composition.image = null;
  removeMainAudio(false);
  removeMainVideo(false);
  releaseMatchMedia();
}

function releaseAllMedia() {
  releaseAllImages();
}

function handleRecoverableError(error) {
  console.error(error);
  showToast(error?.message || "ふたりチャレンジの通信処理に失敗しました。");
}

function handleFatalError(error) {
  console.error(error);
  state.errorMessage = friendlyFirebaseError(error);
  state.screen = "error";
  setTeamChrome("CONNECTION ERROR");
  render();
}

function friendlyFirebaseError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "Firebaseの匿名ログインが無効です。Authentication設定を確認してください。";
  if (error?.code === "PERMISSION_DENIED" || String(error?.message).includes("PERMISSION_DENIED")) return "Realtime Databaseのふたりチャレンジ用ルールにより接続が拒否されました。";
  return error?.message || "Firebaseへ接続できませんでした。";
}

window.addEventListener("beforeunload", () => {
  stopVideoCapture();
  releaseAllImages();
  state.connections.forEach((connection) => connection.peer.close());
});

window.HariaiTeam = { start, isActive, requestHome, destroyRoom };
window.dispatchEvent(new Event("hariai-team-ready"));
