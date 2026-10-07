import { requestSafety, setActiveContact, clearActiveContact, renderContactControls } from "./player-safety.js?v=global-player-block-v1-copy-v2";
import { createStrategyHiddenSearchGuard, createStrategyPrestartGuard, strategyRoomHasStarted } from "./strategy-idle-guard.mjs?v=strategy-idle-guard-v1";
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
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";
import {
  CHAT_COSMETIC_PRODUCTS,
  chatCosmeticClassNames,
  getEquippedChatCosmetics,
} from "./chat-cosmetics.js?v=chat-cosmetics-v1";
import {
  PLAYER_TITLE_PRODUCTS,
  getPlayerTitlePresentation,
  getPlayerTitleProduct,
} from "./player-titles.js?v=player-titles-v3-retire-team-v1-remove-royale-v1";
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
} from "./stamps.js?v=stamps-v1-oshi-jouzu-duo-v1-restore-v1-remove-royale-v1";
import {
  bindPostMatchTip,
  isPostMatchTipBusy,
  renderPostMatchTip,
} from "./post-match-tip.js?v=post-match-tip-v4-app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1-roulette-training-v1";
import {
  STRATEGY_VIDEO_MAX_BYTES,
  appendStrategyVideoChunk,
  createIncomingStrategyVideoTransfer,
  createStrategyVideoTransferId,
  finishIncomingStrategyVideoTransfer,
  releaseStrategyVideoResource,
  releaseStrategyVideoResources,
  sendStrategyVideoClip,
  startStrategyVideoRecording,
} from "./strategy-video-transfer.mjs?v=strategy-video-review-v1";
import {
  STRATEGY_REVIEW_AUDIO_MAX_BYTES,
  STRATEGY_REVIEW_IMAGE_MAX_BYTES,
  appendStrategyReviewAssetChunk,
  createIncomingStrategyReviewAssetTransfer,
  createStrategyReviewAssetTransferId,
  finishIncomingStrategyReviewAssetTransfer,
  releaseStrategyReviewAssetResource,
  releaseStrategyReviewAssetResources,
  sendStrategyReviewAsset,
} from "./strategy-review-asset-transfer.mjs?v=strategy-review-assets-v1";
import {
  STRATEGY_DECK_IMAGE_MAX_BYTES,
  STRATEGY_DECK_IMAGE_MIME_TYPES,
  STRATEGY_DECK_IMAGE_TOTAL_MAX_BYTES,
  deleteStrategyDeck,
  hasPersistableStrategyDeck,
  hasPlayableStrategyDeck,
  loadStrategyDeck,
  saveStrategyDeck,
} from "./strategy-deck-storage.mjs?v=strategy-prepared-deck-v2-strategy-ios-image-fallback-v1";
import {
  normalizeOnlineImageMime,
  verifiedOnlineImageMime,
  verifiedOnlineImageMimeFromChunks,
} from "./online-image-transfer.mjs?v=online-image-transfer-v1";
import {
  HARIAI_ANSWER_MAX,
  HARIAI_BAND_COMBO,
  HARIAI_BAND_QUESTION,
  HARIAI_BREAK_HIT_DAMAGE,
  HARIAI_BREAK_MIN_POSTS,
  HARIAI_BREAK_MISS_DAMAGE,
  HARIAI_CALL_STYLES,
  HARIAI_CAPTION_MAX,
  HARIAI_COMBO_CAP,
  HARIAI_COMBO_STEP,
  HARIAI_DAMAGE_FLOOR,
  HARIAI_FINISH_DAMAGE,
  HARIAI_FINISH_MAX,
  HARIAI_FIRST_PERSONS,
  HARIAI_FLAVOR_MAX,
  HARIAI_HONORIFICS,
  HARIAI_INSTRUCTIONS,
  HARIAI_MAX_SLOTS,
  HARIAI_PENALTIES,
  HARIAI_PERSONA_TYPES,
  HARIAI_PROTOCOL_VERSION,
  HARIAI_QUESTIONS,
  HARIAI_REASON_MAX,
  HARIAI_REASON_MIN_LENGTH,
  HARIAI_REPLY_MAX,
  HARIAI_SCORE_MAX,
  HARIAI_SCORE_MIN,
  ensureHariaiHeart,
  fillHariaiLine,
  hariaiBand,
  hariaiBluffFaces,
  hariaiCallName,
  hariaiCandidateCommitMaterial,
  hariaiDenyAvailable,
  hariaiFirstAttacker,
  hariaiFirstPersonLabel,
  hariaiHonorificName,
  hariaiPartialReveals,
  hariaiPenaltyOptions,
  hariaiPersonaIsComplete,
  hariaiPersonaLine,
  hariaiPersonaType,
  hariaiPostDamage,
  hariaiReadingMemo,
  hariaiReplySuggestions,
  normalizeHariaiFinalReveal,
  normalizeHariaiPenaltyConsent,
  normalizeHariaiPersona,
  normalizeHariaiText,
  replayHariai,
} from "./strategy-hariai-core.mjs?v=strategy-hariai-v1";

const MAIN_COUNT = 5;
const RESERVE_COUNT = 5;
const STRATEGY_PROTOCOL_VERSION = HARIAI_PROTOCOL_VERSION;
const STRATEGY_QUEUE_WAITING_STATE = "waiting-v3";
const STRATEGY_QUEUE_OFFERING_STATE = "offering-v3";
const MAX_AUDIO_SECONDS = 10;
const AUDIO_HIGHLIGHT_SECONDS = 3;
const MAX_AUDIO_TRANSFER_BYTES = 480 * 1024;
const REVIEW_DURATION_MS = 10 * 60 * 1000;
const INITIAL_RATING = 1000;
const RATING_K_FACTOR = 32;
const MATCH_TIMEOUT_MS = 20_000;
const MATCH_SCOPE_EXPAND_DELAY_MS = 20_000;
const QUEUE_FRESH_MS = 45_000;
const HEARTBEAT_MS = 20_000;
const DECK_STORAGE_TIMEOUT_MS = 6_000;
const DECK_SAVE_TIMEOUT_MS = 12_000;
const DECK_STORAGE_WATCHDOG_GRACE_MS = 1_000;
const DATA_CHUNK_BYTES = 16 * 1024;
const DATA_BUFFER_LIMIT = 512 * 1024;
const DATA_BUFFER_WAIT_MS = 10_000;
const STRATEGY_VIDEO_CHANNEL_LABEL = "hariai-strategy-videos-v1";
const STRATEGY_REVIEW_ASSET_CHANNEL_LABEL = "hariai-strategy-review-assets-v1";
const STRATEGY_REVIEW_IMAGE_LIMIT = 3;
const STRATEGY_REVIEW_AUDIO_LIMIT = 1;
const PROFILE_AVATAR_MAX_BYTES = 256 * 1024;
const MATCH_ACHIEVEMENT_SHOWCASE_VERSION = 1;
const MATCH_ACHIEVEMENT_SHOWCASE_LIMIT = 3;
const PROFILE_NAME_KEY = "hariai-stadium-strategy-name-v2";
const PROFILE_CLUES_KEY = "hariai-stadium-strategy-clues-v2";
const PROFILE_WEAKNESS_KEY = "hariai-stadium-strategy-weakness-v3";
const LEGACY_PROFILE_BLUFF_KEY = "hariai-stadium-strategy-bluff-v2";
const PROFILE_PERSONA_KEY = "hariai-stadium-strategy-persona-v1";
const PROFILE_PENALTY_KEY = "hariai-stadium-strategy-penalties-v1";
const PROFILE_IMAGE_PREFERENCE_KEY = "hariai-stadium-strategy-image-preference-v1";
const DECK_PERSISTENCE_KEY_PREFIX = "hariai-stadium-strategy-deck-persistence-v1:";
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
const STRATEGY_CHAT_PROMPTS = ["それ、本命？", "今の反応、怪しい…♡", "何点つけるか楽しみ♡", "ノーコメント！"];
const ANONYMOUS_CHAT_SCREENS = new Set(["intro", "waitingDecision", "deck", "waitingDeck"]);
const IDENTIFIED_CHAT_SCREENS = new Set(["identity", "waitingBattle", "battle", "waitingFinalWeaknessReveal", "review"]);

const app = document.querySelector("#app");
const destroyDialog = document.querySelector("#destroyDialog");
const fxLayer = document.querySelector("#fxLayer");

let active = false;
let state = createState();
let lastRenderedScreen = "";
let strategyMatchmakingGenerationCounter = 0;
let strategyQueueDisconnectOperations = Promise.resolve();
let resultNavigationBusy = false;
// 読みメモの開閉。対戦中に描き直しても、閉じたノートを勝手に開かない。
let hariaiMemoOpen = true;

const matchAchievementShowcaseCallable = httpsCallable(functions, "matchAchievementShowcase");

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

function strategyDeckPersistenceKey(uid) {
  return `${DECK_PERSISTENCE_KEY_PREFIX}${String(uid || "")}`;
}

function createState() {
  const storedWeaknessValue = localStorage.getItem(PROFILE_WEAKNESS_KEY) ?? localStorage.getItem(LEGACY_PROFILE_BLUFF_KEY);
  const storedWeakness = Number(storedWeaknessValue);
  const imagePreference = normalizeImagePreference(localStorage.getItem(PROFILE_IMAGE_PREFERENCE_KEY), "");
  return {
    screen: "profile",
    uid: "",
    authReady: false,
    name: localStorage.getItem(PROFILE_NAME_KEY) || "PLAYER",
    clues: savedClues(),
    weaknessIndex: storedWeaknessValue !== null && Number.isInteger(storedWeakness) && storedWeakness >= 0 && storedWeakness <= 2 ? storedWeakness : null,
    weaknessSalts: [],
    weaknessCommits: [],
    persona: savedPersona(),
    penaltyConsent: savedPenaltyConsent(),
    imagePreference,
    profile: { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, rating: INITIAL_RATING },
    economy: { points: 0, inventory: {}, equipped: { stamps: {}, title: "", chatFrame: "", chatBackground: "" } },
    main: [],
    reserve: [],
    persistDeck: false,
    storedDeckAvailable: false,
    deckRestoreStatus: "idle",
    deckRestoreMessage: "",
    deckSavedAt: 0,
    deckMutationVersion: 0,
    deckSaveBusy: false,
    deckSavePromise: null,
    deckSaveMutationVersion: -1,
    deckDeleteBusy: false,
    normalRouteBusy: false,
    initialDeckRestorePromise: null,
    roomId: "",
    matchReadySoundRoomId: "",
    roomData: {},
    opponentUid: "",
    matchAchievementShowcases: null,
    matchAchievementShowcaseRequested: false,
    playerIndex: 0,
    players: [],
    firstUid: "",
    replay: null,
    drafts: emptyHariaiDrafts(),
    battleBusy: false,
    battleViewKey: "",
    battleAnnounced: false,
    announcedSlots: new Set(),
    localMoveCards: new Map(),
    localFinishCards: new Map(),
    verifiedRevealKeys: new Set(),
    publishedRevealKeys: new Set(),
    ackedMediaKeys: new Set(),
    finishPlaybackActive: false,
    finalRevealPublishing: false,
    remoteImages: new Map(),
    remoteAvatar: null,
    avatarSent: false,
    incomingAvatarTransfer: null,
    hideOpponentAvatar: false,
    chatMessages: [],
    seenChatIds: new Set(),
    localDeckReadyCommitted: false,
    finalWeaknessRevealsVerified: false,
    weaknessIntegrityFailed: false,
    openedMediaKeys: new Set(),
    sentImageKeys: new Set(),
    imageSendCoordinator: null,
    incomingTransfer: null,
    incomingAudioTransfer: null,
    transferProgress: 0,
    videoClips: [],
    pendingVideo: null,
    videoRecording: null,
    videoCaptureStarting: false,
    videoCaptureAbortController: null,
    incomingVideoTransfer: null,
    videoSentPhases: new Set(),
    videoReceivedPhases: new Set(),
    videoSending: false,
    videoTransferProgress: 0,
    videoChannel: null,
    videoChannelReady: false,
    reviewAssets: [],
    reviewAssetSentCounts: { image: 0, audio: 0 },
    reviewAssetReceivedCounts: { image: 0, audio: 0 },
    pendingReviewAsset: null,
    incomingReviewAssetTransfer: null,
    reviewAssetSending: false,
    reviewAssetTransferProgress: 0,
    reviewAssetChannel: null,
    reviewAssetChannelReady: false,
    reviewMediaReceiving: true,
    opponentReviewMediaReceiving: false,
    reviewAudioRecording: null,
    reviewAssetGeneration: 0,
    reviewEndReason: "",
    reviewLocallyEnded: false,
    reviewClockTimer: null,
    serverTimeOffset: 0,
    peer: null,
    channel: null,
    channelReady: false,
    peerStatus: "P2P接続を準備中…",
    pendingIce: [],
    matchingBusy: false,
    matchmakingLaunchBusy: false,
    matchmakingLaunchGeneration: 0,
    acceptingOffer: false,
    acceptingOfferRoomId: "",
    pendingIncomingOffer: null,
    pendingOffer: null,
    latestQueue: {},
    activeUsers: {},
    matchmakingGeneration: 0,
    searchIdleGuard: null,
    searchInitializing: false,
    prestartGuard: null,
    prestartClockTimer: null,
    prestartConfirmPromise: null,
    idleCleanupPromise: null,
    idleCleanupPending: false,
    idleStopped: false,
    idleStopReason: "",
    queueJoinedAt: 0,
    matchmakingConnected: false,
    queueConnectionEpoch: 0,
    queueRecoveryPromise: null,
    queueRecoveryEpoch: 0,
    queueDisconnect: null,
    hostOfferWatch: null,
    matchScopeTimer: null,
    matchScopeAvailable: false,
    matchScopeExpanded: false,
    queueHeartbeat: null,
    offerPollTimer: null,
    matchUnsubscribers: [],
    roomUnsubscribers: [],
    disconnectHandles: [],
    publicPresenceId: "",
    publicPresencePendingId: "",
    publicPresenceState: "",
    publicPresenceHeartbeat: null,
    publicPresenceDisconnect: null,
    opponentOnline: true,
    destroyedByOpponent: false,
    resultClaimCommitted: false,
    statsCommitted: false,
    finalizationBusy: false,
    reacting: false,
    reactAgain: false,
    errorMessage: "",
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

function normalizeClues(value) {
  const source = Array.isArray(value) ? value : [value?.[0], value?.[1], value?.[2]];
  return Array.from({ length: 3 }, (_, index) => String(source[index] || "").replace(/[\r\n]+/g, " ").trim().slice(0, 80));
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

function getTransferableStrategyAudio(item) {
  const blob = item?.audioBlob;
  const duration = Number(item?.audioDuration);
  const cueValue = item?.audioCueStart === undefined || item?.audioCueStart === null || item?.audioCueStart === ""
    ? 0
    : Number(item.audioCueStart);
  if (!(blob instanceof Blob)
      || normalizeOnlineImageMime(blob.type) !== "audio/wav"
      || !Number.isSafeInteger(blob.size)
      || blob.size <= 0
      || blob.size > MAX_AUDIO_TRANSFER_BYTES
      || !Number.isFinite(duration)
      || duration <= 0
      || duration > MAX_AUDIO_SECONDS
      || !Number.isFinite(cueValue)) return null;
  return {
    blob,
    duration,
    cueStart: Math.max(0, Math.min(Math.max(0, duration - AUDIO_HIGHLIGHT_SECONDS), cueValue)),
  };
}

function strategyDeckIsComplete(targetState = state) {
  return hasPlayableStrategyDeck(targetState.main, targetState.reserve);
}

function strategyDeckIsPersistable(targetState = state) {
  return hasPersistableStrategyDeck(targetState.main, targetState.reserve);
}

function validateStrategyDeckImageForAddition(blob, targetState = state) {
  const mime = normalizeOnlineImageMime(blob?.type);
  if (!(blob instanceof Blob) || !Number.isSafeInteger(blob.size) || blob.size <= 0
      || blob.size > STRATEGY_DECK_IMAGE_MAX_BYTES
      || !STRATEGY_DECK_IMAGE_MIME_TYPES.includes(mime)) {
    throw new Error("画像はWebP・PNG・JPEG形式かつ1枚15MB以下にしてください。");
  }
  const currentTotal = [...targetState.main, ...targetState.reserve]
    .reduce((sum, card) => sum + Number(card?.blob?.size || 0), 0);
  if (!Number.isSafeInteger(currentTotal) || currentTotal + blob.size > STRATEGY_DECK_IMAGE_TOTAL_MAX_BYTES) {
    throw new Error("戦略デッキ画像10枚の合計は64MB以下にしてください。追加した画像を外しました。");
  }
}

function strategyDeckStorageBusy() {
  return state.deckRestoreStatus === "loading" || state.deckSaveBusy || state.deckDeleteBusy;
}

function strategyDeckCardId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `strategy-${Date.now()}-${randomHex(8)}`;
}

function releaseLocalStrategyCard(item) {
  if (!item) return;
  if (item.url) URL.revokeObjectURL(item.url);
  releaseCardAudio(item);
  item.url = "";
  item.blob = null;
}

function createRuntimeStrategyCard(card, position) {
  const audioBlob = card.audioBlob instanceof Blob ? card.audioBlob : null;
  return {
    id: strategyDeckCardId(),
    blob: card.blob,
    url: URL.createObjectURL(card.blob),
    position,
    used: false,
    isSample: false,
    audioBlob,
    audioUrl: audioBlob ? URL.createObjectURL(audioBlob) : "",
    audioDuration: audioBlob ? Number(card.audioDuration || 0) : 0,
    audioCueStart: audioBlob ? Number(card.audioCueStart || 0) : 0,
    audioName: audioBlob ? String(card.audioName || "添付音声") : "",
  };
}

function releaseRuntimeStrategyDeck(main, reserve) {
  [...main, ...reserve].forEach(releaseLocalStrategyCard);
}

function renderStrategyDeckIfVisible() {
  if (active && ["profile", "preDeck", "deck"].includes(state.screen)) render();
}

function markStrategyDeckEdited() {
  state.deckMutationVersion += 1;
  if (state.deckRestoreStatus !== "loading") {
    state.deckRestoreStatus = "edited";
    state.deckRestoreMessage = state.persistDeck
      ? "デッキを編集中です。準備完了または封印時に、この完成版で端末保存を更新します。"
      : "デッキを編集中です。端末保存をONにしない限り、このプレイの終了時に破棄されます。";
  }
}

function withStrategyDeckStorageTimeout(promise, actionLabel, timeoutMs = DECK_STORAGE_TIMEOUT_MS) {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        const error = new Error(`${actionLabel}に時間がかかっています。完了を確認できないため、端末保存を待たずに続行します。`);
        error.code = "storage-timeout";
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

async function restoreStoredStrategyDeck({ force = false, quiet = false } = {}) {
  const targetState = state;
  const targetUid = targetState.uid;
  const mutationVersion = targetState.deckMutationVersion;
  if (!targetUid || strategyDeckStorageBusy()) return false;
  targetState.deckRestoreStatus = "loading";
  targetState.deckRestoreMessage = "この端末の前回デッキを確認しています…";
  renderStrategyDeckIfVisible();
  try {
    const record = await withStrategyDeckStorageTimeout(
      loadStrategyDeck(targetUid, { timeoutMs: DECK_STORAGE_TIMEOUT_MS }),
      "前回デッキの読み込み",
      DECK_STORAGE_TIMEOUT_MS + DECK_STORAGE_WATCHDOG_GRACE_MS,
    );
    if (!active || state !== targetState || targetState.uid !== targetUid) return false;
    targetState.storedDeckAvailable = Boolean(record);
    targetState.deckSavedAt = Number(record?.updatedAt || 0);
    if (!record) {
      targetState.deckRestoreStatus = "missing";
      targetState.deckRestoreMessage = "このアカウントで端末保存した完成デッキはありません。";
      renderStrategyDeckIfVisible();
      return false;
    }
    if (!force && !["profile", "preDeck"].includes(targetState.screen)) {
      targetState.deckRestoreStatus = "available";
      targetState.deckRestoreMessage = "保存デッキを確認しました。進行中の画面は変更していません。";
      renderStrategyDeckIfVisible();
      return false;
    }
    if (!force && !targetState.persistDeck) {
      targetState.deckRestoreStatus = "available";
      targetState.deckRestoreMessage = "この端末に保存デッキがあります。端末保存をONにすると次回から自動復元します。";
      renderStrategyDeckIfVisible();
      return false;
    }
    if (!force && (targetState.deckMutationVersion !== mutationVersion
        || targetState.main.length > 0 || targetState.reserve.length > 0)) {
      targetState.deckRestoreStatus = "available";
      targetState.deckRestoreMessage = "編集中のデッキを優先しました。必要なら保存デッキを手動で読み込めます。";
      renderStrategyDeckIfVisible();
      return false;
    }
    const nextMain = [];
    const nextReserve = [];
    try {
      record.main.forEach((card, index) => nextMain.push(createRuntimeStrategyCard(card, index)));
      record.reserve.forEach((card, index) => nextReserve.push(createRuntimeStrategyCard(card, MAIN_COUNT + index)));
    } catch (error) {
      releaseRuntimeStrategyDeck(nextMain, nextReserve);
      throw error;
    }
    const deckChangedWhileLoading = targetState.deckMutationVersion !== mutationVersion;
    const leftEditableScreen = !["profile", "preDeck"].includes(targetState.screen);
    const currentDeckTakesPriority = !force && (targetState.main.length > 0 || targetState.reserve.length > 0);
    if (!active || state !== targetState || targetState.uid !== targetUid
        || leftEditableScreen || deckChangedWhileLoading || currentDeckTakesPriority) {
      releaseRuntimeStrategyDeck(nextMain, nextReserve);
      if (active && state === targetState && targetState.uid === targetUid) {
        targetState.deckRestoreStatus = "available";
        targetState.deckRestoreMessage = deckChangedWhileLoading
          ? "読み込み中に編集されたため、画面上のデッキを優先しました。必要ならもう一度読み込めます。"
          : "保存デッキを確認しました。進行中の画面は変更していません。";
        renderStrategyDeckIfVisible();
      }
      return false;
    }
    releaseRuntimeStrategyDeck(targetState.main, targetState.reserve);
    targetState.main = nextMain;
    targetState.reserve = nextReserve;
    targetState.deckMutationVersion += 1;
    targetState.deckRestoreStatus = "restored";
    targetState.deckRestoreMessage = "前回の完成デッキ10枚をこの端末から復元しました。対戦前に差し替えできます。";
    if (!quiet) showToast("前回の戦略デッキ10枚を読み込みました。");
    renderStrategyDeckIfVisible();
    return true;
  } catch (error) {
    if (!active || state !== targetState || targetState.uid !== targetUid) return false;
    console.error(error);
    targetState.deckRestoreStatus = "load-error";
    targetState.deckRestoreMessage = "端末保存を読み込めませんでした。現在の10枚がそろえば対戦は続けられます。";
    if (!quiet) showToast(error?.message || "保存した戦略デッキを読み込めませんでした。");
    renderStrategyDeckIfVisible();
    return false;
  }
}

async function persistCompleteStrategyDeck({ announceSuccess = false } = {}) {
  const targetState = state;
  if (!targetState.persistDeck || !targetState.uid || !strategyDeckIsComplete(targetState)
      || targetState.deckDeleteBusy || targetState.deckRestoreStatus === "loading") return false;
  if (!strategyDeckIsPersistable(targetState)) {
    targetState.deckRestoreStatus = "unpersistable";
    targetState.deckRestoreMessage = "画像10枚は対戦に使えますが、添付音声などの端末保存データを確認できません。対戦はそのまま続けられます。";
    if (announceSuccess) showToast("画像10枚は対戦に使えますが、現在の内容は端末保存できませんでした。");
    renderStrategyDeckIfVisible();
    return false;
  }
  if (targetState.deckSavePromise) {
    const pendingSave = targetState.deckSavePromise;
    const pendingMutationVersion = targetState.deckSaveMutationVersion;
    const requestedMutationVersion = targetState.deckMutationVersion;
    const pendingResult = await pendingSave;
    if (state !== targetState || !targetState.persistDeck || !strategyDeckIsComplete(targetState)
        || targetState.deckDeleteBusy || targetState.deckRestoreStatus === "loading") return false;
    if (!strategyDeckIsPersistable(targetState)) {
      targetState.deckRestoreStatus = "unpersistable";
      targetState.deckRestoreMessage = "画像10枚は対戦に使えますが、添付音声などの端末保存データを確認できません。対戦はそのまま続けられます。";
      renderStrategyDeckIfVisible();
      return false;
    }
    if (pendingMutationVersion === requestedMutationVersion) return pendingResult;
    if (targetState.deckSavePromise && targetState.deckSavePromise !== pendingSave) {
      return targetState.deckSavePromise;
    }
    return persistCompleteStrategyDeck({ announceSuccess });
  }
  const savedMutationVersion = targetState.deckMutationVersion;
  targetState.deckSaveBusy = true;
  targetState.deckSaveMutationVersion = savedMutationVersion;
  targetState.deckRestoreStatus = "saving";
  targetState.deckRestoreMessage = "完成デッキ10枚をこの端末に保存しています。対戦準備はそのまま進められます。";
  renderStrategyDeckIfVisible();
  let operation;
  operation = Promise.resolve().then(async () => {
    try {
      const record = await withStrategyDeckStorageTimeout(
        saveStrategyDeck({
          uid: targetState.uid,
          main: targetState.main,
          reserve: targetState.reserve,
        }, { timeoutMs: DECK_SAVE_TIMEOUT_MS }),
        "完成デッキの保存",
        DECK_SAVE_TIMEOUT_MS + DECK_STORAGE_WATCHDOG_GRACE_MS,
      );
      if (state !== targetState) return true;
      targetState.storedDeckAvailable = true;
      targetState.deckSavedAt = Number(record.updatedAt || Date.now());
      const savedCurrentVersion = targetState.deckMutationVersion === savedMutationVersion;
      targetState.deckRestoreStatus = savedCurrentVersion ? "saved" : "edited";
      targetState.deckRestoreMessage = savedCurrentVersion
        ? "完成デッキ10枚をこの端末に保存しました。次回は自動で復元します。"
        : "直前の完成版は保存済みです。現在の編集内容は次の準備完了または封印時に保存します。";
      if (announceSuccess) showToast(savedCurrentVersion
        ? "戦略デッキ10枚をこの端末に保存しました。"
        : "直前の完成版を保存しました。現在の編集内容は次回の準備完了時に保存します。");
      return true;
    } catch (error) {
      if (state === targetState) {
        console.error(error);
        targetState.deckRestoreStatus = "save-error";
        const timedOut = error?.code === "storage-timeout";
        targetState.deckRestoreMessage = timedOut
          ? "端末保存の完了を確認できませんでした。保存を待たず、現在の10枚で対戦を続けられます。"
          : "端末保存を更新できませんでした。現在の対戦はそのまま続けられます。";
        showToast(error?.message || "戦略デッキを端末保存できませんでした。現在の対戦は続けられます。");
      }
      return false;
    } finally {
      if (state === targetState && targetState.deckSavePromise === operation) {
        targetState.deckSaveBusy = false;
        targetState.deckSavePromise = null;
        targetState.deckSaveMutationVersion = -1;
        renderStrategyDeckIfVisible();
      }
    }
  });
  targetState.deckSavePromise = operation;
  return operation;
}

async function deleteStoredStrategyDeck() {
  const targetState = state;
  if (!targetState.uid || strategyDeckStorageBusy()) return false;
  const targetUid = targetState.uid;
  targetState.persistDeck = false;
  localStorage.setItem(strategyDeckPersistenceKey(targetUid), "false");
  targetState.deckDeleteBusy = true;
  targetState.deckRestoreStatus = "deleting";
  targetState.deckRestoreMessage = "この端末の保存デッキを削除しています…";
  renderStrategyDeckIfVisible();
  try {
    await deleteStrategyDeck(targetUid, { timeoutMs: DECK_STORAGE_TIMEOUT_MS });
    if (state !== targetState || targetState.uid !== targetUid) return true;
    targetState.storedDeckAvailable = false;
    targetState.deckSavedAt = 0;
    targetState.deckRestoreStatus = "missing";
    targetState.deckRestoreMessage = "この端末の保存デッキを削除しました。画面上の10枚は現在のプレイ中だけ残ります。";
    showToast("この端末に保存した戦略デッキを削除しました。");
    return true;
  } catch (error) {
    if (state === targetState && targetState.uid === targetUid) {
      console.error(error);
      targetState.deckRestoreStatus = "delete-error";
      targetState.deckRestoreMessage = "端末保存を削除できませんでした。自動保存・自動復元はOFFのままです。再試行できます。";
      showToast(error?.message || "端末保存した戦略デッキを削除できませんでした。");
    }
    return false;
  } finally {
    if (state === targetState && targetState.uid === targetUid) {
      targetState.deckDeleteBusy = false;
      renderStrategyDeckIfVisible();
    }
  }
}

function requestDeleteStoredStrategyDeck() {
  if (!state.uid || strategyDeckStorageBusy()) return;
  if (!window.confirm("このアカウントの戦略デッキ端末保存を削除しますか？ 画面上の10枚は現在のプレイ中だけ残ります。")) return;
  deleteStoredStrategyDeck().catch(handleRecoverableError);
}

async function updateStrategyDeckPersistence(enabled) {
  if (!state.uid || strategyDeckStorageBusy()) return;
  if (!enabled) {
    state.persistDeck = false;
    localStorage.setItem(strategyDeckPersistenceKey(state.uid), "false");
    state.deckRestoreStatus = state.storedDeckAvailable ? "available" : "missing";
    state.deckRestoreMessage = state.storedDeckAvailable
      ? "自動保存・自動復元をOFFにしました。保存済みの前回デッキは、削除するまでこの端末に残ります。"
      : "自動保存・自動復元をOFFにしました。現在のデッキはこのプレイ中だけ使用できます。";
    showToast("戦略デッキの自動保存・自動復元をOFFにしました。");
    renderStrategyDeckIfVisible();
    return;
  }
  state.persistDeck = true;
  localStorage.setItem(strategyDeckPersistenceKey(state.uid), "true");
  if (strategyDeckIsComplete()) {
    await persistCompleteStrategyDeck({ announceSuccess: true });
  } else {
    state.deckRestoreStatus = state.storedDeckAvailable ? "available" : "edited";
    state.deckRestoreMessage = "自動保存・自動復元をONにしました。実画像10枚がそろい、準備完了または封印した時に保存します。";
    showToast("端末保存をONにしました。実画像10枚がそろい、準備完了または封印した時に保存します。");
  }
  renderStrategyDeckIfVisible();
}

async function playerRoomRecord(roomId) {
  const weaknessCommits = await prepareWeaknessCommits(roomId);
  return {
    uid: state.uid,
    name: state.name,
    persona: { ...state.persona },
    clues: state.clues,
    weaknessCommits,
    penalties: { ...state.penaltyConsent },
    rating: Number(state.profile.rating || INITIAL_RATING),
    streak: Number(state.profile.streak || 0),
  };
}

function runtimePlayer(source) {
  const commits = [0, 1, 2].map((index) => String(source?.weaknessCommits?.[index] || ""));
  return {
    uid: String(source?.uid || ""),
    name: String(source?.name || "PLAYER").slice(0, 16),
    persona: normalizeHariaiPersona(source?.persona),
    clues: normalizeClues(source?.clues),
    weaknessCommits: commits.every((commit) => /^[a-f0-9]{64}$/.test(commit)) ? commits : [],
    penalties: normalizeHariaiPenaltyConsent(source?.penalties),
    weaknessIndex: null,
    rating: Number(source?.rating || INITIAL_RATING),
    streak: Math.max(0, Number(source?.streak || 0)),
    mainCount: MAIN_COUNT,
    reserveCount: RESERVE_COUNT,
  };
}

function normalizeMatchAchievementShowcases(value) {
  if (Number(value?.version) !== MATCH_ACHIEVEMENT_SHOWCASE_VERSION) return null;
  const capturedAt = Number(value?.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return null;
  const normalizeIds = window.HariaiAchievements?.normalizeIds;
  if (typeof normalizeIds !== "function") return null;
  const playerUids = state.players.map((player) => String(player?.uid || "")).filter(Boolean);
  if (playerUids.length !== 2 || !value.players || typeof value.players !== "object") return null;
  const players = {};
  for (const uid of playerUids) {
    const source = value.players[uid];
    if (!source || typeof source !== "object" || typeof source.ids !== "string") return null;
    const ids = normalizeIds(source.ids, MATCH_ACHIEVEMENT_SHOWCASE_LIMIT);
    const danwakuDays = Math.floor(Number(source.danwakuDays));
    players[uid] = Object.freeze({
      ids: ids.join(","),
      ...(danwakuDays >= 1 && danwakuDays <= 1_000_000 ? { danwakuDays } : {}),
    });
  }
  return Object.freeze({
    version: MATCH_ACHIEVEMENT_SHOWCASE_VERSION,
    capturedAt,
    players: Object.freeze(players),
  });
}

function captureMatchAchievementShowcases(value) {
  if (state.matchAchievementShowcases) return false;
  const normalized = normalizeMatchAchievementShowcases(value);
  if (!normalized) return false;
  state.matchAchievementShowcases = normalized;
  return true;
}

function opponentAchievementShowcaseIds() {
  if (!state.opponentUid || !state.matchAchievementShowcases) return [];
  return window.HariaiAchievements?.normalizeIds?.(
    state.matchAchievementShowcases.players?.[state.opponentUid]?.ids || "",
    MATCH_ACHIEVEMENT_SHOWCASE_LIMIT,
  ) || [];
}

function renderOpponentAchievementShowcase({ compact = false, context = "", label = "公開中の実績" } = {}) {
  const ids = opponentAchievementShowcaseIds();
  const danwakuDays = Math.floor(Number(
    state.matchAchievementShowcases?.players?.[state.opponentUid]?.danwakuDays,
  ));
  const showDanwaku = danwakuDays >= 1 && danwakuDays <= 1_000_000;
  if (!ids.length && !showDanwaku) return "";
  const badges = window.HariaiAchievements?.renderBadges?.(ids, { compact, empty: "" }) || "";
  const danwakuBadge = showDanwaku
    ? `<span class="match-danwaku-badge" title="断惑NOTEで「断惑継続」を記録した日数です">🪷 断惑 ${danwakuDays}日目</span>`
    : "";
  if (!badges && !danwakuBadge) return "";
  const modifier = ["is-identity", "is-hud", "is-result"].includes(context) ? ` ${context}` : "";
  return `<section class="match-achievement-showcase is-opponent${modifier}" aria-label="${escapeHtml(label)}">${badges ? `<small>${escapeHtml(label)}</small>` : ""}${badges}${danwakuBadge}</section>`;
}

function refreshMatchAchievementShowcaseIfVisible() {
  if (!active || !state.matchAchievementShowcases) return;
  if (["identity", "waitingBattle", "gameover"].includes(state.screen)) {
    render();
  }
}

function matchAchievementShowcaseRevealReady(room) {
  const participantUids = [room?.hostUid, room?.guestUid]
    .map((uid) => String(uid || ""))
    .filter(Boolean);
  return participantUids.length === 2 && participantUids.every(
    (uid) => room?.deckReady?.[uid]?.ready === true
      && room?.deckReady?.[uid]?.mainCount === MAIN_COUNT
      && room?.deckReady?.[uid]?.reserveCount === RESERVE_COUNT,
  );
}

async function freezeMatchAchievementShowcases(roomId) {
  try {
    await matchAchievementShowcaseCallable({
      mode: "strategy",
      roomId,
      phase: "freeze",
    });
    return true;
  } catch {
    // 任意表示のfreeze失敗で、成立済みの対戦を止めない。
    return false;
  }
}

function materializeMatchAchievementShowcases(room) {
  if (!state.roomId
      || room?.status !== "active"
      || room?.hostUid !== state.uid
      || !state.localDeckReadyCommitted
      || !matchAchievementShowcaseRevealReady(room)
      || state.matchAchievementShowcaseRequested) return;
  const requestedRoomId = state.roomId;
  state.matchAchievementShowcaseRequested = true;
  try {
    matchAchievementShowcaseCallable({
      mode: "strategy",
      roomId: requestedRoomId,
      phase: "materialize",
    })
      .then((response) => {
        if (!active || state.roomId !== requestedRoomId) return;
        if (captureMatchAchievementShowcases(response.data)) refreshMatchAchievementShowcaseIfVisible();
      })
      .catch(() => {});
  } catch {
    // 実績表示の取得失敗で対戦進行を止めない。
  }
}

function start() {
  if (active) return;
  if (useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEW中はVALUE MARKET以外のオンライン機能へ接続しません。");
    return;
  }
  if (window.HariaiOnline?.isActive?.()
      || window.HariaiAiTextTraining?.isActive?.()
      || window.HariaiRouletteTraining?.isActive?.()
      || window.HariaiTribute?.isActive?.()
      || window.HariaiMarket?.isActive?.()) {
    showToast("進行中のオンライン画面を終了してから開いてください。");
    return;
  }
  if (location.protocol === "file:") {
    showToast("戦略型1on1はローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (useOfflineStrategyPreview) {
    startStrategyPreview().catch(handleFatalError);
    return;
  }
  window.HariaiOnline?.resetBattlePresenceCheck?.("strategy");
  active = true;
  state = createState();
  lastRenderedScreen = "";
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

// localhost で ?strategyPreview を付けた時だけ、Firebaseにつながずに貼り合い本式の対戦画面を確認できる。
const useOfflineStrategyPreview = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has("strategyPreview");
const STRATEGY_PREVIEW_STEPS = [
  ["right", "権利を使う（91点）"],
  ["act", "次の1手（連投）"],
  ["score", "採点する"],
  ["answer", "質問に答える"],
  ["wait", "相手の番"],
  ["finish", "看破成功・仕留め"],
];
// プレビューでは、ルームへ書き込む操作とチャットを押しても実行しない。
const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "[data-hariai-post], [data-hariai-break], [data-hariai-pass], [data-hariai-surrender], [data-hariai-score-submit], [data-hariai-right-skip], [data-hariai-right-submit], [data-hariai-answer], [data-hariai-finish-skip], [data-hariai-finish-submit], [data-hariai-penalty-submit], [data-hariai-penalty-done], .strategy-chat-panel button, .strategy-chat-panel input";
const STRATEGY_PREVIEW_SALT = "0123456789abcdef0123456789abcdef";
const strategyPreview = { remote: [] };

function paintStrategyPreviewArt(index) {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  const hue = (index * 53 + 300) % 360;
  const gradient = context.createLinearGradient(0, 0, 300, 800);
  gradient.addColorStop(0, `hsl(${hue}, 75%, 78%)`);
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360}, 55%, 18%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,.85)";
  context.font = "700 36px system-ui, sans-serif";
  context.fillText(`PREVIEW ${index + 1}`, 36, 760);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)), "image/jpeg", 0.86));
}

// 相手（シオン）が先攻。6手目にあなたが91点をもらい、連投の権利を持つところまでを段階ごとに再現する。
function strategyPreviewMoves(step) {
  const me = "preview-me";
  const rival = "preview-rival";
  const post = (by, target, caption, extra = {}) => ({ post: { by, target, caption }, received: { [by === me ? rival : me]: true }, ...extra });
  const score = (by, value, reply) => ({ score: { by, value, reply } });
  const moves = {
    1: post(rival, 0, "ねぇ、これ好きでしょ？♡", score(me, 78, "…78点。ちょっとだけね")),
    2: post(me, 1, "目、そらさないでね♡", score(rival, 64, "64点かな〜♡ もっと本気出して？")),
  };
  if (step === "wait") return moves;
  const question = { by: rival, kind: "question", id: "spot", flavor: "" };
  if (step === "answer") {
    moves[3] = post(rival, 1, "この後ろ姿、見て？", { ...score(me, 84, "84点…べ、別に効いてないし♡"), right: question });
    return moves;
  }
  moves[3] = post(rival, 1, "この後ろ姿、見て？", { ...score(me, 84, "84点…べ、別に効いてないし♡"), right: question, answer: { by: me, text: "うなじのところ…ずるい" } });
  moves[4] = post(me, 0, "この上目づかい、どう？", {
    ...score(rival, 87, "ふふ、87点♡ ずるい手使うじゃん"),
    right: { by: me, kind: "instruction", id: "deny", flavor: "" },
    answer: { by: rival, candidate: 2, salt: STRATEGY_PREVIEW_SALT },
  });
  if (step === "score") {
    moves[5] = post(rival, 2, "ほら、ここ弱いでしょ♡");
    return moves;
  }
  moves[5] = post(rival, 2, "ほら、ここ弱いでしょ♡", score(me, 76, "…76点。ちょっとだけね"));
  moves[6] = post(me, 0, "この上目づかい、ずるいって言って", score(rival, 91, "91点♡ …もう、覚えてなさいよ"));
  if (step === "right") return moves;
  moves[6].right = { by: me, kind: "question", id: "which", a: 0, b: 1, flavor: "" };
  moves[6].answer = { by: rival, choice: 0 };
  if (step === "act") return moves;
  moves[7] = { break: { by: me, guess: 0 }, breakReveal: { by: rival, index: 0, bit: 1, salt: STRATEGY_PREVIEW_SALT } };
  return moves;
}

async function startStrategyPreview() {
  active = true;
  state = createState();
  lastRenderedScreen = "";
  setStrategyChrome("STRATEGY PREVIEW");
  const urls = await Promise.all(Array.from({ length: 13 }, (_, index) => paintStrategyPreviewArt(index)));
  if (!active) return;
  const persona = (type, callStyle) => ({ type, firstPerson: "watashi", callStyle });
  const me = { uid: "preview-me", name: "ルミナ", persona: persona("tsuyotsuyo", "chan"), clues: ["メガネ", "ポニテ", "うなじ"], penalties: normalizeHariaiPenaltyConsent({}) };
  const rival = { uid: "preview-rival", name: "シオン", persona: persona("koakuma", "anata"), clues: ["ツインテ", "ジト目", "制服"], penalties: normalizeHariaiPenaltyConsent({}) };
  Object.assign(state, {
    uid: me.uid,
    authReady: true,
    roomId: "preview-strategy",
    players: [me, rival],
    playerIndex: 0,
    firstUid: rival.uid,
    weaknessIndex: 1,
    channelReady: true,
    opponentOnline: true,
    main: urls.slice(0, 5).map((url, index) => ({ id: `preview-main-${index}`, url, used: false })),
    reserve: urls.slice(5, 10).map((url, index) => ({ id: `preview-reserve-${index}`, url, used: false })),
  });
  strategyPreview.remote = urls.slice(10);
  mountStrategyPreviewBar();
  showStrategyPreviewStep("right");
}

function showStrategyPreviewStep(step) {
  if (!active || !useOfflineStrategyPreview) return;
  const [host, guest] = state.players;
  const moves = strategyPreviewMoves(step);
  const cards = [...state.main, ...state.reserve];
  cards.forEach((card) => { card.used = false; });
  state.drafts = emptyHariaiDrafts();
  state.localMoveCards = new Map();
  state.remoteImages = new Map();
  state.openedMediaKeys = new Set();
  let localCount = 0;
  let remoteCount = 0;
  Object.entries(moves).forEach(([number, entry]) => {
    if (!entry.post) return;
    const slot = Number(number);
    if (entry.post.by === state.uid) {
      const card = cards[localCount];
      localCount += 1;
      card.used = true;
      state.localMoveCards.set(slot, card);
      return;
    }
    const key = imageKey("move", slot);
    state.remoteImages.set(key, { url: strategyPreview.remote[remoteCount % strategyPreview.remote.length] });
    remoteCount += 1;
    // 「採点する」では、まだ開いていない相手の手を見せる。
    if (!(step === "score" && slot === 5)) state.openedMediaKeys.add(key);
  });
  state.roomData = { moves };
  state.replay = replayHariai({ hostUid: host.uid, guestUid: guest.uid, firstUid: state.firstUid, moves });
  state.screen = "battle";
  render();
}

function mountStrategyPreviewBar() {
  if (document.querySelector("#strategyPreviewBar")) return;
  app.addEventListener("click", blockStrategyPreviewControl, true);
  app.addEventListener("submit", blockStrategyPreviewControl, true);
  const bar = document.createElement("nav");
  bar.id = "strategyPreviewBar";
  bar.className = "vb-preview-bar";
  bar.setAttribute("aria-label", "戦略型プレビューの画面切り替え");
  bar.innerHTML = `<strong>PREVIEW</strong>${STRATEGY_PREVIEW_STEPS.map(([step, label]) => `<button type="button" data-strategy-preview-step="${step}">${label}</button>`).join("")}`;
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-strategy-preview-step]");
    if (button) showStrategyPreviewStep(button.dataset.strategyPreviewStep);
  });
  document.body.append(bar);
}

function blockStrategyPreviewControl(event) {
  if (!active || !useOfflineStrategyPreview) return;
  if (event.type === "click" && !event.target.closest?.(STRATEGY_PREVIEW_BLOCKED_CONTROLS)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showToast("プレビューでは、ルームへの書き込みやチャットは実行しません。");
}

async function ensureAuthenticated() {
  const targetState = state;
  await setPersistence(auth, browserLocalPersistence);
  const credential = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
  if (!active || state !== targetState) return;
  targetState.uid = credential.user.uid;
  targetState.persistDeck = localStorage.getItem(strategyDeckPersistenceKey(targetState.uid)) === "true";
  const [profileSnapshot, economySnapshot] = await Promise.all([
    get(ref(database, `online/strategyProfiles/${targetState.uid}`)),
    get(ref(database, `online/economy/${targetState.uid}`)),
  ]);
  if (!active || state !== targetState) return;
  if (profileSnapshot.exists()) targetState.profile = normalizeProfile(profileSnapshot.val());
  if (economySnapshot.exists()) targetState.economy = normalizeChatCosmeticEconomy(economySnapshot.val());
  if (targetState.screen === "profile") syncStrategyProfileDraft();
  targetState.authReady = true;
  setStrategyChrome("STRATEGY READY");
  render();
  targetState.initialDeckRestorePromise = restoreStoredStrategyDeck({ quiet: true });
  await targetState.initialDeckRestorePromise;
  if (!active || state !== targetState) return;
  if (window.HariaiOnline?.getOverallRankingPreference?.().enabled) {
    window.HariaiOnline.refreshRankingDashboard?.().catch((error) => console.error(error));
  }
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

function strategyDeckStatusCopy() {
  if (state.deckRestoreMessage) return state.deckRestoreMessage;
  if (!state.authReady) return "Firebase接続後、このアカウントの端末保存を確認します。";
  return "実画像10枚を準備すると、戦略型のマッチングを開始できます。";
}

function renderPreparedDeckSummary() {
  const complete = strategyDeckIsComplete();
  const restoring = state.deckRestoreStatus === "loading";
  const routeBusy = state.normalRouteBusy || state.matchmakingLaunchBusy;
  const statusClass = complete ? "is-ready" : "is-incomplete";
  return `<section class="strategy-prepared-summary ${statusClass}" aria-label="戦略デッキ準備状況">
    <div class="strategy-prepared-summary-head"><div><span class="eyebrow">PREPARED HAND / 10 CARDS</span><h2>${complete ? "10枚の手札ができています" : "対戦前に実画像10枚を準備"}</h2></div>
      <span class="strategy-prepared-badge">${complete ? "READY" : `${state.main.length + state.reserve.length} / ${MAIN_COUNT + RESERVE_COUNT}`}</span></div>
    <div class="strategy-prepared-counts"><span>HAND 01-05 <b>${state.main.length} / ${MAIN_COUNT}</b></span><span>HAND 06-10 <b>${state.reserve.length} / ${RESERVE_COUNT}</b></span></div>
    <p>${escapeHtml(strategyDeckStatusCopy())}</p>
    <div class="strategy-prepared-actions"><button class="button ${complete ? "button-ghost" : "button-primary"}" id="strategyOpenPreDeck" type="button" ${restoring || state.normalRouteBusy ? "disabled" : ""}>${restoring ? "保存デッキを確認中…" : complete ? "10枚を確認・差し替え" : "戦略デッキ10枚を準備"}</button>
      <button class="button button-ghost" id="strategyOpenNormal1on1" type="button" ${routeBusy ? "disabled" : ""}>${state.normalRouteBusy ? "通常1on1へ切替中…" : "手軽に遊ぶなら通常1on1へ"}</button></div>
  </section>`;
}

function renderStrategyDeckPersistencePanel() {
  const busy = strategyDeckStorageBusy();
  const canRetryLoad = state.storedDeckAvailable || state.deckRestoreStatus === "load-error";
  const savedAt = state.deckSavedAt > 0
    ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(state.deckSavedAt))
    : "";
  return `<section class="strategy-deck-persistence">
    <label><input type="checkbox" id="strategyPersistDeck" ${state.persistDeck ? "checked" : ""} ${state.authReady && !busy ? "" : "disabled"} /> この端末に完成デッキを保存し、次回自動で読み込む</label>
    <p>明示的にONにした時だけ、準備完了または封印した実画像10枚と任意の添付音声をIndexedDBへ保存します。Firebaseや相手には保存されません。${savedAt ? ` 最終保存: ${escapeHtml(savedAt)}` : ""}</p>
    <p class="strategy-deck-storage-status" role="status">${escapeHtml(strategyDeckStatusCopy())}</p>
    <div><button class="button button-ghost button-small" id="strategyLoadStoredDeck" type="button" ${state.authReady && canRetryLoad && !busy ? "" : "disabled"}>${state.deckRestoreStatus === "load-error" ? "端末保存を再確認" : "保存デッキを読み込む"}</button>
      <button class="button button-ghost button-small" id="strategyForgetStoredDeck" type="button" ${state.authReady && !busy ? "" : "disabled"}>端末保存を削除</button></div>
  </section>`;
}

function setStrategyChrome(label) {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(label)}`;
  if (privacy) privacy.textContent = "P2P画像・音声・短尺映像";
  if (footerItems[0]) footerItems[0].textContent = "STRATEGY 1ON1 / FIREBASE + WEBRTC";
  if (footerItems[1]) footerItems[1].textContent = "進行とチャットはルーム内同期、画像・添付音声・短尺映像は対戦相手へ直接転送します";
}

function syncStrategySafetyContact() {
  if (!state.roomId || !state.opponentUid || state.playerSafetyStopped) {
    clearActiveContact("strategy");
    return;
  }
  const targetState = state;
  const roomId = state.roomId;
  setActiveContact("strategy", {
    roomId,
    name: ANONYMOUS_CHAT_SCREENS.has(state.screen) || ["connecting", "intro", "waitingDecision", "deck", "waitingDeck"].includes(state.screen) ? "匿名の相手" : getOpponent()?.name || "対戦相手",
    stopContact() {
      if (state !== targetState || state.roomId !== roomId || state.playerSafetyStopped) return;
      state.playerSafetyStopped = true;
      state.reviewLocallyEnded = true;
      cleanupOnlineResources(false).catch(() => {});
      releaseMatchMedia();
      state.screen = state.resultClaimCommitted ? "gameover" : "noContest";
      render();
    },
    leave: leaveToLanding,
  });
}

function render() {
  if (!active) return;
  syncStrategySafetyContact();
  const screenChanged = lastRenderedScreen !== state.screen;
  const focused = document.activeElement;
  const focusId = !screenChanged && focused && app.contains(focused) && focused.id ? focused.id : "";
  const selection = focusId && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const renderers = {
    profile: renderProfile,
    preDeck: renderPreparedDeck,
    matching: renderMatching,
    connecting: renderConnecting,
    intro: renderAnonymousIntro,
    waitingDecision: renderWaitingDecision,
    deck: renderDeckBuilder,
    waitingDeck: renderWaitingDeck,
    identity: renderIdentityReveal,
    waitingBattle: renderWaitingBattle,
    battle: renderBattle,
    waitingFinalWeaknessReveal: () => renderWaiting("FINAL WEAKNESS CHECK", "最後の答え合わせをしています", "対戦中に伏せられていた本命とブラフを、事前の封印と照合しています。"),
    gameover: renderGameOver,
    review: renderStrategyReview,
    withdrawn: renderWithdrawn,
    noContest: renderNoContest,
    error: renderError,
  };
  app.innerHTML = renderContactControls("strategy") + (renderers[state.screen] || renderProfile)();
  app.querySelector(".screen")?.insertAdjacentHTML("afterbegin", renderStrategyIdleNotice());
  updateStrategyIdleNotice();
  lastRenderedScreen = state.screen;
  // 同じ画面の描き直しでは登場アニメーションを再生しない（対戦スレッドが点滅しないように）。
  if (!screenChanged) app.querySelector(".screen")?.classList.add("is-refresh");
  if (state.screen === "battle") state.battleViewKey = battleViewKey();
  if (isStrategyChatVisible()) app.querySelector(".screen")?.insertAdjacentHTML("beforeend", renderStrategyChat());
  bindScreenEvents();
  if (screenChanged && state.screen === "gameover") {
    window.HariaiOnline?.refreshFreeTablePublicStats?.().catch(() => {});
  }
  if (screenChanged) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  } else if (focusId) {
    const next = document.getElementById(focusId);
    if (next) {
      next.focus({ preventScroll: true });
      if (selection && typeof next.setSelectionRange === "function") {
        try { next.setSelectionRange(selection[0], selection[1]); } catch { /* 数値入力などは選択範囲を持たない */ }
      }
    }
  }
}

function renderProfile() {
  const preferenceOptions = IMAGE_PREFERENCE_OPTIONS.map((option) => `
    <label class="image-preference-option">
      <input type="radio" name="strategyImagePreference" value="${option.id}" ${state.imagePreference === option.id ? "checked" : ""} required />
      <span class="image-preference-card">
        <strong>${escapeHtml(option.label)}</strong>
        <small>${escapeHtml(option.description)}</small>
      </span>
    </label>`).join("");
  const personaOptions = HARIAI_PERSONA_TYPES.map((type) => `<label class="strategy-persona-option">
      <input type="radio" name="strategyPersonaType" value="${type.id}" ${state.persona.type === type.id ? "checked" : ""} required />
      <span><strong>${escapeHtml(type.label)}</strong><small>${escapeHtml(type.note)}</small></span></label>`).join("");
  const crownMatchmakingActions = renderStrategyCrownMatchmakingActions();
  return `<section class="screen strategy-screen">
    <div class="section-head"><div><span class="eyebrow">STRATEGY 1ON1 / 貼り合い本式</span><h1>貼り合いプロフィール</h1>
      <p>女の子になりきって、相手の弱点を読み、画像に言葉を乗せて刺し、点数で落とす対戦です。弱点候補を3つ登録し、本当の弱点を1つ選びます。</p></div>
      <button class="button button-ghost button-small" id="strategyBackHome">タイトルへ</button></div>
    <div class="online-profile-strip"><span class="connection-pill ${state.authReady ? "connected" : ""}">${state.authReady ? "● Firebase接続済み" : "○ Firebaseへ接続中…"}</span>
      <span>STRATEGY RATE ${Number(state.profile.rating || INITIAL_RATING)}</span><span>${state.profile.wins}勝 ${state.profile.losses}敗 ${state.profile.draws}分</span></div>
    ${window.HariaiOnline?.renderOverallRankingParticipation?.({ controlId: "strategyOverallRanking" }) || ""}
    <div class="strategy-profile-layout"><aside class="setup-guide"><h2>貼り合いの流れ</h2><ol class="guide-list">
      <li><b>1</b><span>マッチング前に実画像10枚を準備します。対戦中はこの10枚が手札です。</span></li>
      <li><b>2</b><span>本当の弱点1つとブラフ2つを登録します。相手には候補だけが見えます。</span></li>
      <li><b>3</b><span>1手＝画像＋言葉＋狙い。受け手は刺さり具合を0〜100点で返し、80点で質問、85点で指示、90点以上で連投が解禁されます。</span></li>
      <li><b>4</b><span>看破は1試合1回。当たれば「強がり」の数だけ仕留めが増えます。理性が0になるか、参りましたで決着します。</span></li>
      <li><b>5</b><span>決着後は、合意した罰で着地します。双方同意なら品評会で見返せます。</span></li>
    </ol><p class="privacy-note">対戦メディアはFirebaseへ保存しません。第三者の画像や、本人の同意がない実在人物の画像は使わないでください。映像には顔・室内・位置情報につながるものを映さないでください。</p></aside>
    <form class="setup-panel strategy-form" id="strategyProfileForm">
      <label class="field-label">なりきり名（デッキ封印まで相手に非公開）<input class="text-input" id="strategyName" maxlength="16" autocomplete="nickname" value="${escapeHtml(state.name)}" required /></label>
      ${shared()?.profileAvatar?.renderSetting?.({ controlId: "strategyProfileAvatar", name: state.name }) || ""}
      <fieldset class="strategy-persona-fieldset"><legend>なりきりペルソナ <span>必須</span></legend>
        <p>双方が女の子になりきって話すのが貼り合いの基本です。キャラ型は、採点のひとこと候補や降参・敗北宣言の口調になります。</p>
        <div class="strategy-persona-grid">${personaOptions}</div>
        <div class="strategy-persona-row"><label class="field-label">一人称<select class="text-input" id="strategyFirstPerson">${HARIAI_FIRST_PERSONS.map((item) => `<option value="${item.id}" ${state.persona.firstPerson === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
          <label class="field-label">相手の呼び方<select class="text-input" id="strategyCallStyle">${HARIAI_CALL_STYLES.map((item) => `<option value="${item.id}" ${state.persona.callStyle === item.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label></div>
      </fieldset>
      <fieldset class="image-preference-settings">
        <legend>高く評価しやすい画像 <span>マッチング優先条件</span></legend>
        <p>弱点候補とは別に、今回の戦略型1on1で相手から見せてもらいたい画像の傾向を選んでください。</p>
        <div class="image-preference-grid">${preferenceOptions}</div>
        <small>同じ傾向、または「どちらも歓迎」の相手を優先します。この選択は対戦画面には表示されません。選択別実績は導入以降の対戦から累計し、本人が展示した場合のみ公開されます。</small>
      </fieldset>
      <fieldset class="strategy-clue-fieldset"><legend>弱点候補（1つだけ本当の弱点を選択）</legend>
        ${state.clues.map((clue, index) => `<label class="strategy-clue-row"><input type="radio" name="weakness" value="${index}" ${state.weaknessIndex === index ? "checked" : ""} required />
          <span class="weakness-selector">本命</span><input class="text-input strategy-clue-input" data-clue-index="${index}" maxlength="80" autocomplete="off" placeholder="例：${["上目づかい", "制服", "ささやき声"][index]}" value="${escapeHtml(clue)}" required /></label>`).join("")}
      </fieldset>
      <fieldset class="strategy-penalty-fieldset"><legend>受けてもいい罰 <span>相手と共通のものだけ有効</span></legend>
        <label class="strategy-penalty-option is-fixed"><input type="checkbox" checked disabled /><span><strong>敗北宣言</strong><small>負けた側のペルソナで勝ちを認めます（常に有効）</small></span></label>
        <label class="strategy-penalty-option"><input type="checkbox" id="strategyPenaltyCall" ${state.penaltyConsent.call ? "checked" : ""} /><span><strong>呼び方</strong><small>負けた側から勝った側への呼び方を、結果画面と品評会で固定します</small></span></label>
        <label class="strategy-penalty-option"><input type="checkbox" id="strategyPenaltyTribute" ${state.penaltyConsent.tribute ? "checked" : ""} /><span><strong>お貢ぎ</strong><small>品評会で、勝った側の本命に向けた画像1枚を送ります</small></span></label>
        <small>罰は演出だけです。RATE・Pay・実績には影響せず、現実の行動や外部への投稿は求めません。</small>
      </fieldset>
      ${renderPreparedDeckSummary()}
      ${window.HariaiOnline?.renderBattlePresenceCheck?.({ mode: "strategy", phase: "setup" }) || ""}
      <div class="screen-actions setup-actions crown-matchmaking-actions" id="strategyCrownMatchmakingActions">${crownMatchmakingActions}</div>
    </form></div></section>`;
}

function renderStrategyCrownMatchmakingActions() {
  const matchmakingReady = state.authReady
    && Boolean(normalizeImagePreference(state.imagePreference, ""))
    && state.deckRestoreStatus !== "loading"
    && !state.normalRouteBusy
    && strategyDeckIsComplete();
  return window.HariaiOnline?.renderCrownMatchmakingActions?.({
    mode: "strategy",
    regularButtonId: "strategyFindOpponent",
    regularLabel: "準備済み10枚で対戦相手を探す",
    crownButtonId: "strategyCrownMatchmaking",
    regularType: "submit",
    ready: matchmakingReady,
    busy: state.matchmakingLaunchBusy || state.normalRouteBusy,
  }) || `<button class="button button-primary" id="strategyFindOpponent" type="submit" ${matchmakingReady ? "" : "disabled"}>準備済み10枚で対戦相手を探す</button>`;
}

function bindStrategyCrownMatchmakingActions() {
  const crownButton = document.querySelector("#strategyCrownMatchmaking");
  crownButton?.addEventListener("click", () => {
    const action = crownButton.dataset.crownMatchmakingAction;
    if (action === "participation") {
      window.HariaiOnline?.focusCrownRankingParticipation?.("strategyOverallRanking");
      return;
    }
    if (action === "retry") {
      window.HariaiOnline?.refreshRankingDashboard?.().catch(handleRecoverableError);
    }
  });
}

function updateStrategyCrownMatchmakingActions() {
  if (!active || state.screen !== "profile") return;
  const container = document.querySelector("#strategyCrownMatchmakingActions");
  if (!container) return;
  container.innerHTML = renderStrategyCrownMatchmakingActions();
  bindStrategyCrownMatchmakingActions();
}

function renderMatching() {
  const preference = getImagePreferenceOption(state.imagePreference);
  const acceptsBoth = preference.id === "both";
  const scopeBody = acceptsBoth
    ? "実写・アニメを問わず、すべての待機相手を候補にしています。"
    : state.matchScopeExpanded
      ? "同じ好みを最優先しつつ、相手も条件を広げた場合は異なる好みともマッチングします。"
      : `「${preference.shortLabel}」または「どちらも歓迎」の相手だけを探しています。`;
  const expandAction = !acceptsBoth && state.matchScopeAvailable && !state.matchScopeExpanded
    ? '<button class="button button-cyan" id="strategyExpandMatchingScope">条件を広げて探す</button>'
    : "";
  const scopeHint = !acceptsBoth && !state.matchScopeAvailable && !state.matchScopeExpanded
    ? `<small class="matching-scope-hint">${MATCH_SCOPE_EXPAND_DELAY_MS / 1000}秒後、必要なら異なる好みまで検索範囲を広げられます。</small>`
    : "";
  const soundHint = '<small class="matching-scope-hint">SE ONなら、マッチ成立時に短い準備完了音が1度鳴ります。</small>';
  return renderStatusCard(
    "◎",
    "PREFERENCE MATCHING",
    "戦略型1on1の対戦相手を探しています",
    scopeBody,
    `<div class="matching-pulse"><i></i><i></i><i></i></div><span class="connection-pill connected">● 匿名ログイン済み</span><span class="connection-pill connected">好み: ${escapeHtml(preference.shortLabel)}</span>${scopeHint}${soundHint}${window.HariaiOnline?.renderBattlePresenceCheck?.({ mode: "strategy", phase: "matching" }) || ""}`,
    `${expandAction}<button class="button button-ghost" id="strategyCancelMatching">マッチングをやめる</button>`,
  );
}

function renderConnecting() {
  return renderStatusCard("VS", "MATCH FOUND", "対戦相手とマッチングしました", "匿名自己紹介を表示する前にP2P画像・音声・短尺映像転送を準備しています。", `<span class="connection-pill ${state.channelReady ? "connected" : ""}">${escapeHtml(state.peerStatus)}</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderAnonymousIntro() {
  const opponent = getOpponent();
  const type = hariaiPersonaType(opponent.persona.type);
  const penalties = hariaiPenaltyOptions(getLocalPlayer().penalties, opponent.penalties);
  return `<section class="screen strategy-screen strategy-intro-screen"><div class="strategy-anonymous-head"><span class="strategy-anonymous-icon" aria-hidden="true">?</span>
    <div><span class="eyebrow">ANONYMOUS OPPONENT</span><h1>対戦相手の弱点候補</h1><p>3つのうち1つだけが本当の弱点、残り2つはブラフです。</p></div></div>
    <div class="hariai-intro-persona"><span>相手のペルソナ</span><strong>${escapeHtml(type?.label || "なりきり")}</strong><small>${escapeHtml(type?.note || "")}／一人称「${escapeHtml(personaFirst(opponent))}」</small></div>
    <div class="strategy-clue-cards">${opponent.clues.map((clue, index) => `<article><small>弱点候補 ${String(index + 1).padStart(2, "0")}</small><p>${escapeHtml(clue)}</p></article>`).join("")}</div>
    <p class="hariai-intro-penalty">この試合の罰：${penalties.map((id) => escapeHtml(hariaiPenaltyLabel(id))).join("／")}</p>
    <div class="strategy-intro-actions"><button class="button button-danger" id="strategyWithdraw">この勝負から撤退</button><button class="button button-primary" id="strategyAccept">読んで、手札を組む</button></div>
    <p class="strategy-rule-note">撤退はノーコンテストとなり、相手の名前・弱点は公開されず、戦績にも影響しません。</p></section>`;
}

function renderWaitingDecision() {
  return renderStatusCard("?", "ANONYMOUS DECISION", "相手の判断を待っています", "両者が対戦を受けるとデッキ構築へ進みます。", `<span class="connection-pill connected">● あなたは対戦を承諾しました</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderDeckBuilder() {
  const opponent = getOpponent();
  const complete = strategyDeckIsComplete();
  return `<section class="screen strategy-screen"><div class="section-head"><div><span class="eyebrow">COUNTER HAND BUILD</span><h1>相手に刺さる10枚を選ぶ</h1>
    <p>準備してきた10枚を、相手の弱点候補とペルソナに合わせて封印前に差し替えられます。対戦中は10枚をひとつの手札として、好きな順に貼ります。各画像には10秒までの音声を任意で添付できます。</p></div><span class="strategy-step">YOU / ONLINE</span></div>
    <div class="strategy-build-layout"><aside class="strategy-scout-note"><span>SCOUTING MEMO</span><h2>匿名の対戦相手（${escapeHtml(personaLabel(opponent))}）</h2>
      ${opponent.clues.map((clue, index) => `<p><b>${index + 1}</b>${escapeHtml(clue)}</p>`).join("")}<small>本当の弱点は1つ。残り2つはブラフです。</small></aside>
      <div class="strategy-deck-panel">${renderDeckZone("main")}${renderDeckZone("reserve")}
        <p class="strategy-deck-lock-note">戦略型は実画像10枚が必須です。10枚に満たないデッキやサンプル画像を含むデッキは封印できません。</p>
        <div class="screen-actions setup-actions"><button class="button button-primary" id="strategyLockDeck" ${complete ? "" : "disabled"}>実画像10枚でデッキを封印する</button></div>
      </div></div></section>`;
}

function renderDeckZone(zone) {
  const isMain = zone === "main";
  const items = state[zone];
  const limit = isMain ? MAIN_COUNT : RESERVE_COUNT;
  const offset = isMain ? 0 : MAIN_COUNT;
  const editingLocked = state.deckRestoreStatus === "loading" || state.normalRouteBusy;
  return `<section class="strategy-deck-zone ${zone}"><div class="deck-toolbar"><div><span class="eyebrow">${isMain ? "HAND 01-05 / 5枚必須" : "HAND 06-10 / 5枚必須"}</span>
    <p>${isMain ? "対戦中はどちらの列も同じ手札です" : "看破に成功すると、残りの手札で仕留めます"}</p></div><div class="deck-counter"><strong>${items.length}</strong> / ${limit}</div>
    <div class="upload-actions"><label class="button button-ghost button-small file-button ${editingLocked ? "is-disabled" : ""}">実画像を追加<input type="file" accept="image/*" multiple data-strategy-upload="${zone}" ${editingLocked ? "disabled" : ""} /></label></div></div>
    <div class="strategy-deck-grid">${Array.from({ length: limit }, (_, index) => {
      const item = items[index];
      const cueMax = Math.max(0, Number(item?.audioDuration || 0) - AUDIO_HIGHLIGHT_SECONDS);
      return item ? `<article class="deck-slot"><img src="${item.url}" alt="手札の画像 ${offset + index + 1}" />
        <div class="deck-label"><span>CARD ${String(offset + index + 1).padStart(2, "0")}</span><button class="remove-card" type="button" data-strategy-remove="${zone}:${item.id}" aria-label="画像を外す" ${editingLocked ? "disabled" : ""}>×</button></div>
        <div class="deck-audio ${item.audioBlob ? "has-audio" : ""}">${item.audioBlob
          ? `<div class="deck-audio-head"><span>♪ ${escapeHtml(item.audioName || "添付音声")} / ${Number(item.audioDuration).toFixed(1)}秒</span><button type="button" data-strategy-audio-remove="${zone}:${item.id}" ${editingLocked ? "disabled" : ""}>音声を外す</button></div>
            <audio controls preload="metadata" src="${item.audioUrl}"></audio>
            <label>仕留めで流す3秒 <input type="range" min="0" max="${cueMax.toFixed(1)}" step="0.1" value="${Math.min(Number(item.audioCueStart || 0), cueMax).toFixed(1)}" data-strategy-audio-cue="${zone}:${item.id}" ${editingLocked ? "disabled" : ""} /><output>${Number(item.audioCueStart || 0).toFixed(1)}秒〜</output></label>`
          : `<label class="deck-audio-add ${editingLocked ? "is-disabled" : ""}">＋ 10秒音声を添付<input type="file" accept="audio/*" data-strategy-audio="${zone}:${item.id}" ${editingLocked ? "disabled" : ""} /></label>`}</div></article>`
        : '<div class="deck-slot empty"><span>+</span></div>';
    }).join("")}</div></section>`;
}

function renderWaitingDeck() {
  return renderStatusCard("▦", "DECK SEALED", "相手のデッキ確定を待っています", "手札10枚の準備完了だけを同期し、画像本体はまだ送信しません。", `<span class="connection-pill connected">● 手札 ${state.main.length + state.reserve.length} / ${MAIN_COUNT + RESERVE_COUNT}</span>`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderIdentityReveal() {
  return `<section class="screen strategy-screen strategy-identity-screen"><div class="strategy-versus-title"><span class="eyebrow">IDENTITY REVEAL</span><h1>対戦相手、判明</h1>
    <p>本当の弱点は秘密のまま。画像に言葉を乗せて刺し、点数を読み、1回だけの看破で落とします。</p></div><div class="strategy-identity-grid">
    ${state.players.map((player, index) => { const localPlayer = index === state.playerIndex; const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url; return `<article class="strategy-identity-card player-${index + 1}"><small>${localPlayer ? "YOU" : "OPPONENT"}</small>${shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar, className: "identity-avatar" }) || ""}<h2>${escapeHtml(player.name)}</h2>
      <p class="hariai-identity-persona">${escapeHtml(personaLabel(player))}／一人称「${escapeHtml(personaFirst(player))}」</p>
      ${localPlayer ? "" : renderOpponentAchievementShowcase({ context: "is-identity", label: "実績コレクション" })}<div><span>手札</span><strong>${player.mainCount + player.reserveCount}</strong></div><div><span>理性</span><strong>${HARIAI_REASON_MAX}</strong></div></article>`; }).join("")}<div class="strategy-vs-mark">VS</div></div>
    <button class="avatar-visibility-toggle strategy-avatar-toggle" type="button" data-strategy-avatar-visibility aria-pressed="${state.hideOpponentAvatar}">${state.hideOpponentAvatar ? "相手画像を表示" : "相手画像を隠す"}</button>
    <button class="button button-primary strategy-center-button" id="strategyBattleStart">貼り合い開始</button></section>`;
}

function renderWaitingBattle() {
  return renderStatusCard("VS", "BATTLE READY", "相手の開始準備を待っています", "両者が準備すると、先攻の1手から貼り合いを始めます。", `<span class="connection-pill connected">● デッキ・通信準備完了</span>${renderOpponentAchievementShowcase({ context: "is-identity", label: "相手の実績" })}`, `<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`);
}

function renderPreparedDeck() {
  const complete = strategyDeckIsComplete();
  const restoringDeck = state.deckRestoreStatus === "loading";
  const routeBusy = state.normalRouteBusy || state.matchmakingLaunchBusy;
  return `<section class="screen strategy-screen"><div class="section-head"><div><span class="eyebrow">PRE-MATCH PREPARED DECK</span><h1>10枚の手札で戦う準備型モード</h1>
    <p>マッチング前に実画像10枚をそろえます。相手の弱点候補を見た後も、封印前ならこの10枚を差し替えられます。</p></div><span class="strategy-step">${state.main.length + state.reserve.length} / ${MAIN_COUNT + RESERVE_COUNT}</span></div>
    <div class="strategy-build-layout"><aside class="strategy-scout-note strategy-prepared-guide"><span>PREPARED MODE</span><h2>待たせないための事前準備</h2>
      <p><b>1</b>10枚が対戦中の手札です。1手ごとに1枚ずつ、言葉を添えて貼ります。</p><p><b>2</b>看破に成功すると、残りの手札から最大3枚で仕留めます。</p><p><b>3</b>サンプル補充はありません。10枚準備が重い時は通常1on1を選べます。</p>
      <small>端末保存はアカウントのUIDごとです。同じ端末・ブラウザでだけ再利用でき、別端末には同期されません。</small></aside>
      <div class="strategy-deck-panel">${renderDeckZone("main")}${renderDeckZone("reserve")}${renderStrategyDeckPersistencePanel()}
        <div class="screen-actions setup-actions strategy-prepared-footer"><button class="button button-ghost" id="strategyPreDeckBack" type="button" ${state.normalRouteBusy ? "disabled" : ""}>プロフィールに戻る</button><button class="button button-primary" id="strategyPreparedDeckDone" type="button" ${complete && !restoringDeck && !state.normalRouteBusy ? "" : "disabled"}>10枚の準備を完了</button></div>
        <button class="button button-ghost strategy-normal-route" id="strategyOpenNormal1on1" type="button" ${routeBusy ? "disabled" : ""}>${state.normalRouteBusy ? "通常1on1へ切替中…" : "10枚を組まず、通常1on1で遊ぶ"}</button>
      </div></div></section>`;
}

function renderGameOver() {
  const outcome = determineOutcome();
  const winner = outcome.winnerIndex;
  const replay = state.replay;
  const localResult = winner < 0 ? "DRAW" : winner === state.playerIndex ? "WIN" : "LOSE";
  const reasonLabel = hariaiOutcomeReasonLabel(replay?.outcome);
  const localRuntime = replay?.players?.[state.uid];
  const shareButton = shared()?.renderResultShareButton?.({
    mode: "戦略型1on1",
    result: localResult,
    details: [`決着：${reasonLabel}`, `残り理性 ${Number(localRuntime?.reason ?? 0)}`],
  }) || "";
  const weaknessMap = Object.fromEntries(state.players.map((player) => [player.uid, player.weaknessIndex]));
  const faces = hariaiBluffFaces(replay, weaknessMap);
  const stats = state.players.map((player, index) => {
    const runtime = replay?.players?.[player.uid] || {};
    const hitScores = (replay?.slots || []).filter((slot) => slot.kind === "post" && slot.by === player.uid && Number.isInteger(slot.score)).map((slot) => slot.score);
    return `<article class="${winner === index ? "winner" : ""}"><small>${index === state.playerIndex ? "YOU" : "OPPONENT"}</small><h2>${escapeHtml(player.name)}</h2>
      <p class="hariai-result-persona">${escapeHtml(personaLabel(player))}</p>
      ${index === state.playerIndex ? "" : renderOpponentAchievementShowcase({ context: "is-result", label: "公開中の実績" })}
      <div><span>残り理性</span><strong>${Number(runtime.reason ?? 0)}</strong></div><div><span>与えたダメージ</span><strong>${Number(runtime.damageDealt || 0)}</strong></div>
      <div><span>刺さった平均点</span><strong>${average(hitScores)}</strong></div><div><span>最大連投</span><strong>${Number(runtime.maxCombo || 0)}</strong></div>
      <div><span>強がり</span><strong>${(faces[player.uid] || []).length}</strong></div></article>`;
  }).join("");
  const faceReview = state.players.map((player) => {
    const slots = (faces[player.uid] || []).map((number) => replay.slots.find((slot) => slot.slot === number)).filter(Boolean);
    if (!slots.length) return "";
    return `<article><h3>${escapeHtml(player.name)}の強がり</h3>${slots.map((slot) => `<p>#${slot.slot} 本命を狙われて ${slot.score}点「${escapeHtml(slot.caption)}」</p>`).join("")}</article>`;
  }).join("");
  return `<section class="screen strategy-screen"><div class="gameover-card strategy-gameover"><span class="eyebrow">STRATEGY 1ON1 / 貼り合い本式 COMPLETE</span>
    <h1>${winner < 0 ? "DRAW" : `${escapeHtml(state.players[winner].name)} WIN`}</h1><p>決着：${escapeHtml(reasonLabel)}。${escapeHtml(hariaiOutcomeText(replay?.outcome))}</p>
    <div class="strategy-final-grid">${stats}</div>
    <section class="strategy-bluff-reveal"><span class="eyebrow">弱点公開</span><h2>弱点候補の答え合わせ</h2>${state.players.map((player) => `<article><h3>${escapeHtml(player.name)}</h3>
      ${player.clues.map((clue, index) => `<p class="${index === player.weaknessIndex ? "is-weakness" : "is-bluff"}"><b>${index === player.weaknessIndex ? "本当の弱点" : "ブラフ"}</b>${escapeHtml(clue)}</p>`).join("")}</article>`).join("")}</section>
    ${faceReview ? `<section class="strategy-bluff-reveal hariai-face-review"><span class="eyebrow">効いてないって言ったよね♡</span><h2>強がりの振り返り</h2>${faceReview}</section>` : ""}
    ${renderHariaiPenaltySection(outcome)}
    <details class="hariai-log"><summary>対戦スレッドを見返す（${replay?.slots?.length || 0}手）</summary><ol class="hariai-thread">${renderHariaiThread()}</ol></details>
    <div class="online-profile-strip"><span>あなたの戦略型戦績</span><span>${state.profile.wins}勝 ${state.profile.losses}敗 ${state.profile.draws}分</span><span>RATE ${state.profile.rating}</span></div>
    ${renderStrategyReviewInvite()}
    ${state.playerSafetyStopped ? "" : renderPostMatchTip({ mode: "strategy", roomId: state.roomId, viewerUid: state.uid, recipients: state.players, balance: state.economy.points })}
    <div id="strategyFreeTableLampSlot" class="free-table-result-lamp-slot" data-free-table-lamp-refresh>${window.HariaiOnline?.renderFreeTableResultLampContent?.({ buttonId: "strategyFreeTableLampButton" }) || ""}</div>
    <div class="screen-actions strategy-final-actions">${shareButton}<button class="button button-ghost" id="strategyNewMatch">別の相手を探す</button><button class="button button-primary" id="strategyFinish">タイトルへ戻る</button></div>
  </div></section>`;
}

function syncStrategyFreeTableResultLamp() {
  if (!active || state.screen !== "gameover") return;
  const slot = document.querySelector("#strategyFreeTableLampSlot");
  window.HariaiOnline?.syncFreeTableResultLampSlot?.({
    slot,
    buttonId: "strategyFreeTableLampButton",
    onClick: leaveToFreeTable,
    focusFallbackSelector: "#strategyNewMatch",
  });
}

function firebaseNow() {
  return Date.now() + Number(state.serverTimeOffset || 0);
}

function reviewRemainingMs() {
  const startedAt = Number(state.roomData?.reviewStartedAt || 0);
  return startedAt ? Math.max(0, startedAt + REVIEW_DURATION_MS - firebaseNow()) : 0;
}

function formatReviewRemaining(milliseconds = reviewRemainingMs()) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderStrategyReviewInvite() {
  if (state.playerSafetyStopped) return `<p class="strategy-review-notice">交流を終了しました。確定済みの対戦結果は残ります。</p>`;
  const finished = state.roomData?.finished || {};
  const decisions = state.roomData?.reviewDecisions || {};
  const ended = state.roomData?.reviewEnded || {};
  const localDecision = decisions[state.uid] || "";
  const opponentDecision = decisions[state.opponentUid] || "";
  const bothFinished = finished[state.uid] === true && finished[state.opponentUid] === true;
  const reviewStarted = Number(state.roomData?.reviewStartedAt || 0) > 0;
  const reviewEnded = Boolean(ended[state.uid] || ended[state.opponentUid] || (reviewStarted && reviewRemainingMs() <= 0));
  let status = "";
  let actions = "";

  if (!bothFinished) {
    status = "相手の対戦終了処理を待っています。両者の結果確定後に選べます。";
  } else if (reviewEnded || state.reviewEndReason) {
    status = state.reviewEndReason === "time"
      ? "10分が経過したため品評会は終了しました。画像・音声・映像データは破棄しました。"
      : "品評会は終了しました。画像・音声・映像データは破棄しました。";
  } else if (localDecision === "decline" || opponentDecision === "decline") {
    status = "どちらかが「今回は終了」を選んだため、品評会は開きません。";
  } else if (!state.opponentOnline && localDecision === "accept") {
    status = "相手が退出または切断したため、品評会は開始できません。";
  } else if (reviewStarted) {
    status = "双方の同意を確認しました。品評会を開いています…";
  } else if (!localDecision) {
    status = opponentDecision === "accept"
      ? "相手は品評会への参加を希望しています。参加は任意です。"
      : "両者が参加を選んだ場合だけ、10分間のチャットとメディア共有を開きます。";
    actions = `<button class="button button-primary" id="strategyReviewAccept">品評会に参加</button>
      <button class="button button-ghost" id="strategyReviewDecline">今回は終了</button>`;
  } else if (localDecision === "accept") {
    status = "参加を希望しました。相手の回答を待っています。";
  }

  return `<section class="strategy-review-invite"><span class="eyebrow">POST-MATCH REVIEW / 任意参加</span><h2>この一戦を一緒に品評しますか？</h2>
    <p>${escapeHtml(status)}</p>
    <small>参加すると、チャットと画像・音声・短尺映像の受信に同意します。最大10分・途中退出で終了。メディアはP2P一時転送で、サーバー保存や後日の再視聴はできません。</small>
    ${actions ? `<div class="strategy-review-actions">${actions}</div>` : ""}</section>`;
}

function renderStrategyReview() {
  return `<section class="screen strategy-screen strategy-review-screen">
    <header class="strategy-review-head"><div><span class="eyebrow">POST-MATCH REVIEW / MUTUAL CONSENT</span><h1>対戦後の品評会</h1>
      <p>${escapeHtml(getLocalPlayer()?.name || "あなた")} と ${escapeHtml(getOpponent()?.name || "対戦相手")}だけの品評会です。対戦画像と追加メディアを見ながら、狙いや刺さったポイントを振り返りましょう。</p></div>
      <div class="strategy-review-clock"><small>残り時間</small><strong id="strategyReviewCountdown">${formatReviewRemaining()}</strong></div></header>
    <div class="strategy-review-notice"><span>● 双方同意済み</span><p>最大10分です。どちらかが終了すると両者とも閉じ、受信・録音・録画した画像・音声・映像を端末メモリから破棄します。</p></div>
    ${renderHariaiReviewPenaltyBanner()}
    <div class="screen-actions strategy-review-leave"><button class="button button-danger" id="strategyReviewLeave">品評会を終了</button></div>
  </section>`;
}

function bindPersonaFields() {
  const persist = () => {
    syncStrategyProfileDraft();
    localStorage.setItem(PROFILE_PERSONA_KEY, JSON.stringify(state.persona));
    localStorage.setItem(PROFILE_PENALTY_KEY, JSON.stringify(state.penaltyConsent));
  };
  document.querySelectorAll('input[name="strategyPersonaType"]').forEach((input) => input.addEventListener("change", persist));
  document.querySelector("#strategyFirstPerson")?.addEventListener("change", persist);
  document.querySelector("#strategyCallStyle")?.addEventListener("change", persist);
  document.querySelector("#strategyPenaltyCall")?.addEventListener("change", persist);
  document.querySelector("#strategyPenaltyTribute")?.addEventListener("change", persist);
}

function savedPersona() {
  try {
    return normalizeHariaiPersona(JSON.parse(localStorage.getItem(PROFILE_PERSONA_KEY) || "{}"));
  } catch {
    return normalizeHariaiPersona({});
  }
}

function savedPenaltyConsent() {
  try {
    return normalizeHariaiPenaltyConsent(JSON.parse(localStorage.getItem(PROFILE_PENALTY_KEY) || "{}"));
  } catch {
    return normalizeHariaiPenaltyConsent({});
  }
}

function emptyHariaiDrafts() {
  return {
    consoleTab: "post",
    cardId: "",
    target: null,
    caption: "",
    breakGuess: null,
    score: null,
    reply: "",
    surrender: false,
    rightTab: "",
    rightKind: "",
    rightId: "",
    rightA: null,
    rightB: null,
    rightParam: "",
    flavor: "",
    answerText: "",
    answerChoice: null,
    answerValue: null,
    answerCandidate: null,
    finishIds: [],
    finishCaptions: ["", "", ""],
    penaltyKind: "",
    penaltyHonorific: HARIAI_HONORIFICS[0].id,
  };
}

async function prepareWeaknessCommits(roomId) {
  if (!Number.isInteger(state.weaknessIndex)) throw new Error("本当の弱点を確認できませんでした。");
  const salts = Array.from({ length: 3 }, () => randomHex());
  const commits = await Promise.all(salts.map((salt, index) => sha256Hex(
    hariaiCandidateCommitMaterial(roomId, state.uid, index, index === state.weaknessIndex, salt),
  )));
  state.weaknessSalts = salts;
  state.weaknessCommits = commits;
  return commits;
}

function playerByUid(uid) {
  return state.players.find((player) => player.uid === uid) || null;
}

function personaLabel(player) {
  return hariaiPersonaType(player?.persona?.type)?.label || "なりきり";
}

function personaFirst(player) {
  return hariaiFirstPersonLabel(player?.persona?.firstPerson);
}

function personaCallName(speaker, listener) {
  const honorific = state.replay?.players?.[speaker?.uid]?.honorific;
  return (honorific && hariaiHonorificName(honorific, listener?.name))
    || hariaiCallName(speaker?.persona?.callStyle, listener?.name);
}

function personaLine(player, key, values = {}) {
  const listener = state.players.find((item) => item.uid !== player?.uid);
  return hariaiPersonaLine(player?.persona?.type, key, {
    first: personaFirst(player),
    call: personaCallName(player, listener),
    ...values,
  });
}

function candidateText(uid, index) {
  return playerByUid(uid)?.clues?.[index] || `候補${Number(index) + 1}`;
}

function handCards() {
  return [...state.main, ...state.reserve].filter((item) => !item.used && item.url);
}

function findHandCard(id) {
  return handCards().find((item) => item.id === id) || null;
}

function currentHariaiSlot() {
  const replay = state.replay;
  return Math.max(1, Math.min(HARIAI_MAX_SLOTS, Number(replay?.pending?.slot || replay?.slots?.length || 1)));
}

function battleViewKey() {
  const replay = state.replay;
  const pending = replay?.pending;
  return JSON.stringify([
    state.screen,
    replay?.ok,
    pending?.slot,
    pending?.stage,
    pending?.actor,
    pending?.receivedCount,
    replay?.outcome?.reason,
    state.battleBusy,
    state.channelReady,
    state.opponentOnline,
    state.remoteImages.size,
    state.openedMediaKeys.size,
    (replay?.slots || []).map((slot) => [slot.kind, slot.score, slot.right?.kind, Boolean(slot.answer), slot.breakResult, slot.finishCount, slot.finishDamage]),
  ]);
}

function renderBattleIfChanged() {
  if (state.screen !== "battle") return;
  if (battleViewKey() === state.battleViewKey) return;
  render();
}

function refreshHariaiTransferProgress() {
  const output = document.querySelector("#hariaiTransferProgress");
  if (output) output.textContent = state.channelReady ? `転送状況 ${state.transferProgress}%` : "P2P接続を待っています…";
}

function renderBattle() {
  const replay = state.replay;
  if (!replay) return renderWaiting("HARIAI", "貼り合いを準備しています", "先攻と手札を確認しています。");
  return `<section class="screen strategy-screen hariai-battle">${renderBattleHud()}
    <div class="hariai-layout">${renderHariaiReadingMemo()}<div class="hariai-main">
      <ol class="hariai-thread" aria-label="貼り合いのやりとり">${renderHariaiThread()}</ol>
      <section class="hariai-console" id="hariaiConsole" aria-live="polite">${renderHariaiConsole()}</section>
    </div><aside class="hariai-side">${renderHariaiSelfCard()}${renderHariaiRuleCard()}</aside></div></section>`;
}

function renderHariaiThread() {
  const slots = state.replay?.slots || [];
  if (!slots.length) {
    const first = playerByUid(state.firstUid);
    return `<li class="hariai-thread-empty">${first ? `先攻は${escapeHtml(first.name)}。1手＝画像＋言葉＋狙いで、最初の1枚を貼ります。` : "先攻を決めています…"}</li>`;
  }
  return slots.map(renderHariaiSlot).join("");
}

function hariaiSlotItem(slot, index = null) {
  if (slot.by === state.uid) {
    return index === null ? state.localMoveCards.get(slot.slot) : state.localFinishCards.get(`${slot.slot}:${index}`);
  }
  return state.remoteImages.get(index === null ? imageKey("move", slot.slot) : imageKey("finish", slot.slot, index));
}

function renderHariaiAvatar(player) {
  return shared()?.profileAvatar?.renderBattle?.(player?.name || "相手", state.remoteAvatar?.url, {
    hidden: state.hideOpponentAvatar,
    className: "hariai-msg-avatar",
  }) || "";
}

// 発言者の側に吹き出しを寄せる。あなたは右、相手は左（アイコン付き）。
function hariaiMessage(player, body, className = "") {
  const mine = player?.uid === state.uid;
  return `<div class="ha-msg ${mine ? "is-mine" : "is-theirs"}${className ? ` ${className}` : ""}">${mine ? "" : renderHariaiAvatar(player)}<div class="ha-msg-body">${body}</div></div>`;
}

// 70〜100点を広く見せるメーター。70未満は左の短い区間に目印を置く。
function renderHariaiMeter(score) {
  const value = Math.max(HARIAI_SCORE_MIN, Math.min(HARIAI_SCORE_MAX, Number(score) || 0));
  const below = value < HARIAI_DAMAGE_FLOOR;
  const position = below ? value / HARIAI_DAMAGE_FLOOR : (value - HARIAI_DAMAGE_FLOOR) / (HARIAI_SCORE_MAX - HARIAI_DAMAGE_FLOOR);
  return `<span class="ha-meter100${below ? " is-below" : ""}" style="--score-pos:${position.toFixed(3)}" aria-hidden="true"><span class="ha-meter100-bar"><i></i><i></i><i></i><i></i><i></i><b></b></span><span class="ha-meter100-scale"><span></span><span>70</span><span>80</span><span>85</span><span>90</span></span></span>`;
}

const HARIAI_BAND_LABELS = Object.freeze({ none: "手番交代", question: "質問権", instruction: "指示権", combo: "権利＋連投" });

function renderHariaiSlotHead(slot, text) {
  return `<p class="ha-divider hariai-slot-head"><span class="hariai-slot-no">${slot.slot}手目</span>${text}</p>`;
}

function renderHariaiSlot(slot) {
  const attacker = playerByUid(slot.by);
  const receiver = playerByUid(slot.receiver);
  const side = slot.by === state.uid ? "is-local" : "is-opponent";
  if (slot.kind === "surrender") {
    return `<li class="hariai-slot hariai-system ${side}">${renderHariaiSlotHead(slot, `${escapeHtml(attacker?.name || "")}が参りました`)}
      ${hariaiMessage(attacker, `<p class="ha-bubble">${escapeHtml(personaLine(attacker, "surrender"))}</p>`)}</li>`;
  }
  if (slot.kind === "pass") {
    return `<li class="hariai-slot hariai-system ${side}">${renderHariaiSlotHead(slot, `${escapeHtml(attacker?.name || "")}は看破を見送りました`)}</li>`;
  }
  if (slot.kind === "break") return renderHariaiBreakSlot(slot, attacker, receiver, side);
  return renderHariaiPostSlot(slot, attacker, receiver, side);
}

function renderHariaiPostSlot(slot, attacker, receiver, side) {
  const item = hariaiSlotItem(slot);
  const key = imageKey("move", slot.slot);
  const concealed = slot.by !== state.uid && !state.openedMediaKeys.has(key);
  const caption = slot.captionHeart ? ensureHariaiHeart(slot.caption) : slot.caption;
  const media = item?.url
    ? `<div class="hariai-media ${concealed ? "is-concealed" : ""}"><img src="${item.url}" alt="${escapeHtml(attacker?.name || "")}が貼った画像" loading="lazy" />
        ${concealed ? `<button type="button" class="hariai-open" data-hariai-open="${escapeHtml(key)}">タップして開く${item.audioBlob ? "（音声あり）" : ""}</button>` : ""}</div>
        ${!concealed && item.audioUrl ? `<button class="hariai-audio" type="button" data-strategy-play-audio="${escapeHtml(item.audioUrl)}" data-audio-start="0" data-audio-duration="${Number(item.audioDuration || 0)}">♪ 音声 ${Number(item.audioDuration || 0).toFixed(1)}秒</button>` : ""}`
    : '<div class="hariai-media is-loading"><span>画像を受信中…</span></div>';
  const owner = slot.receiver === state.uid ? "あなたの" : "相手の";
  const post = `${media}
    <p class="ha-bubble hariai-caption">${escapeHtml(caption)}</p>
    <span class="ha-chip hariai-target">狙い：${owner}「${escapeHtml(candidateText(slot.receiver, slot.target))}」</span>`;
  return `<li class="hariai-slot hariai-post ${side}">
    ${renderHariaiSlotHead(slot, `${escapeHtml(attacker?.name || "")}が貼った${slot.combo > 1 ? `<em class="hariai-combo">${slot.combo}連投</em>` : ""}`)}
    ${hariaiMessage(attacker, post)}
    ${renderHariaiScoreBlock(slot, receiver)}
    ${renderHariaiRightBlock(slot, attacker, receiver)}
  </li>`;
}

// 点数は受け手の吹き出し。数字・ひとこと・メーター・権利と理性の変化をまとめて返す。
function renderHariaiScoreBlock(slot, receiver) {
  if (!Number.isInteger(slot.score)) return "";
  const reply = slot.reply ? (slot.replyHeart ? ensureHariaiHeart(slot.reply) : slot.reply) : "";
  const whose = receiver?.uid === state.uid ? "あなた" : "相手";
  const body = `<div class="ha-bubble hariai-score band-${slot.band}"><div class="hariai-score-head"><strong>${slot.score}<small>点</small></strong>${reply ? `<span class="hariai-reply">${escapeHtml(reply)}</span>` : ""}</div>
      ${renderHariaiMeter(slot.score)}
      ${slot.scoreSurrender ? `<p class="hariai-reply is-surrender">${escapeHtml(personaLine(receiver, "surrender"))}</p>` : ""}</div>
    <p class="hariai-score-meta band-${slot.band}"><span class="hariai-band">${HARIAI_BAND_LABELS[slot.band] || ""}</span>${slot.damage ? `<span class="hariai-damage">${whose}の理性 −${slot.damage}</span>` : ""}</p>`;
  return hariaiMessage(receiver, body, "hariai-score-msg");
}

function hariaiRightPrompt(right, receiverUid) {
  if (right.kind === "question") {
    const question = HARIAI_QUESTIONS.find((item) => item.id === right.id);
    return fillHariaiLine(question?.prompt, { a: candidateText(receiverUid, right.a), b: candidateText(receiverUid, right.b) });
  }
  const instruction = HARIAI_INSTRUCTIONS.find((item) => item.id === right.id);
  const attacker = state.players.find((player) => player.uid !== receiverUid);
  return fillHariaiLine(instruction?.prompt, { honorific: hariaiHonorificName(right.param, attacker?.name) });
}

function hariaiAckLine(right, receiver, attacker) {
  if (right.id === "call") return `はい、${hariaiHonorificName(right.param, attacker?.name)}♡`;
  if (right.id === "confess") return personaLine(receiver, "confess");
  if (right.id === "heart") return "…わかった♡ 次の3回、語尾に♡を付けます";
  return "次の点数は、ちゃんと理由も言います♡";
}

function renderHariaiRightBlock(slot, attacker, receiver) {
  if (!slot.right) return "";
  if (slot.right.kind === "none") return '<p class="hariai-right is-skipped">権利は使わずに進めました。</p>';
  const label = slot.right.kind === "question" ? "質問" : "指示";
  const flavor = slot.right.flavor ? `<span class="hariai-flavor">${escapeHtml(slot.right.flavor)}</span>` : "";
  const answer = slot.answer;
  let text = "";
  if (answer?.text) text = answer.heart ? ensureHariaiHeart(answer.text) : answer.text;
  else if (Number.isInteger(answer?.choice)) text = `「${candidateText(slot.receiver, answer.choice)}」のほう…♡`;
  else if (Number.isInteger(answer?.value)) text = `ほんとは…${answer.value}点♡`;
  else if (Number.isInteger(answer?.candidate)) text = `「${candidateText(slot.receiver, answer.candidate)}」は弱点じゃない（ブラフ確定）`;
  else if (answer?.ack) text = hariaiAckLine(slot.right, receiver, attacker);
  const ask = hariaiMessage(attacker, `<p class="ha-bubble hariai-right is-${slot.right.kind}"><b>${label}</b>${escapeHtml(hariaiRightPrompt(slot.right, slot.receiver))}${flavor}</p>`);
  const reply = answer
    ? hariaiMessage(receiver, `<p class="ha-bubble hariai-answer">${escapeHtml(text)}</p>`)
    : `<p class="hariai-answer is-waiting">${escapeHtml(receiver?.name || "")}の返事を待っています…</p>`;
  return `${ask}${reply}`;
}

function renderHariaiBreakSlot(slot, attacker, receiver, side) {
  const guess = candidateText(slot.receiver, slot.guess);
  let result = '<p class="hariai-break-wait">答え合わせ中…</p>';
  if (slot.breakResult === "miss") {
    result = `<p class="hariai-break-result is-miss">ハズレ。「${escapeHtml(guess)}」はブラフでした。${escapeHtml(attacker?.name || "")}の理性 −${Number(slot.selfDamage || 0)}</p>`;
  } else if (slot.breakResult === "hit") {
    const bluffs = (slot.bluffSlots || []).map((number) => state.replay.slots.find((item) => item.slot === number)).filter(Boolean);
    const faces = bluffs.length
      ? `<div class="hariai-bluffs"><b>効いてないって言ったよね♡</b>${bluffs.map((item) => `<span>${item.slot}手目 ${item.score}点「${escapeHtml(item.caption)}」</span>`).join("")}</div>`
      : "";
    const finish = Number.isInteger(slot.finishCount)
      ? renderHariaiFinish(slot)
      : `<p class="hariai-break-wait">仕留めの準備中…（最大${Number(slot.finishMax || 0)}枚）</p>`;
    result = `<p class="hariai-break-result is-hit">看破成功！ 本命は「${escapeHtml(guess)}」。${escapeHtml(receiver?.name || "")}の理性 −${Number(slot.damage || 0)}</p>${faces}${finish}`;
  }
  return `<li class="hariai-slot hariai-break ${side}">${renderHariaiSlotHead(slot, `${escapeHtml(attacker?.name || "")}の看破`)}
    ${hariaiMessage(attacker, `<p class="ha-bubble hariai-caption is-break">${escapeHtml(personaLine(attacker, "breakCall", { candidate: guess }))}</p>`)}
    <div class="hariai-break-body">${result}</div></li>`;
}

function renderHariaiFinish(slot) {
  if (!slot.finishCount) return '<p class="hariai-break-wait">仕留めはせずに続けます。</p>';
  const cards = Array.from({ length: slot.finishCount }, (_, index) => {
    const item = hariaiSlotItem(slot, index);
    const caption = slot.finishCaptions?.[index];
    const text = caption ? (caption.heart ? ensureHariaiHeart(caption.text) : caption.text) : "";
    return `<figure class="hariai-finish-card" data-hariai-finish-figure="${slot.slot}:${index}">${item?.url ? `<img src="${item.url}" alt="仕留めの画像${index + 1}" loading="lazy" />` : '<span class="hariai-media is-loading">受信中…</span>'}
      <figcaption>${escapeHtml(text)}</figcaption></figure>`;
  }).join("");
  const resolved = Number.isInteger(slot.finishDamage);
  return `<div class="hariai-finish">${cards}</div>${resolved ? `<p class="hariai-damage">仕留め 理性 −${slot.finishDamage}</p>
    <button class="button button-ghost button-small" type="button" data-hariai-play-finish="${slot.slot}">仕留めの音声を再生</button>` : ""}`;
}

function hariaiOutcomeText(outcome) {
  if (!outcome) return "";
  if (outcome.draw) return "引き分けです。";
  const winner = playerByUid(outcome.winnerUid);
  const loser = playerByUid(outcome.loserUid);
  if (outcome.reason === "ko") return `${loser?.name || ""}の理性が0になりました。${winner?.name || ""}の勝ちです。`;
  if (outcome.reason === "surrender") return `${loser?.name || ""}が参りました。${winner?.name || ""}の勝ちです。`;
  return `手札が尽きました。理性が多い${winner?.name || ""}の勝ちです。`;
}

function renderHariaiConsole() {
  const replay = state.replay;
  if (replay?.outcome) {
    return `<div class="hariai-console-wait"><strong>決着</strong><p>${escapeHtml(hariaiOutcomeText(replay.outcome))}</p><p>弱点の最終照合をしています…</p></div>`;
  }
  const pending = replay?.pending;
  if (!pending) return "";
  const mine = pending.actor === state.uid;
  const opponent = getOpponent();
  if (pending.stage === "act") {
    return mine ? renderHariaiActConsole(pending)
      : hariaiWaitConsole(`${opponent.name}が次の1手を選んでいます…`, pending.combo ? `${opponent.name}の連投中（${pending.combo}手連続で90点以上）` : "");
  }
  if (pending.stage === "receive") return renderHariaiTransferConsole(pending.attacker === state.uid ? "画像を送っています" : "画像を受け取っています");
  if (pending.stage === "score") return mine ? renderHariaiScoreConsole(pending) : hariaiWaitConsole(`${opponent.name}が点数を考えています…`, "刺さったかどうかは、相手の自己申告です。");
  if (pending.stage === "right") return mine ? renderHariaiRightConsole(pending) : hariaiWaitConsole(`${opponent.name}が権利を選んでいます…`, "");
  if (pending.stage === "answer") return mine ? renderHariaiAnswerConsole(pending) : hariaiWaitConsole(`${opponent.name}の返事を待っています…`, "");
  if (pending.stage === "breakReveal") return hariaiWaitConsole(mine ? "看破の答え合わせを送っています…" : "看破の答え合わせ中…", "封印した弱点と照合しています。");
  if (pending.stage === "finish") return mine ? renderHariaiFinishConsole(pending) : hariaiWaitConsole(`${opponent.name}が仕留めの準備をしています…`, `最大${pending.finishMax}枚`);
  if (pending.stage === "finishReceive") return renderHariaiTransferConsole(pending.attacker === state.uid ? "仕留めの画像を送っています" : "仕留めの画像を受け取っています");
  return "";
}

function hariaiWaitConsole(title, note) {
  return `<div class="hariai-console-wait"><strong>${escapeHtml(title)}</strong>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div>`;
}

function renderHariaiTransferConsole(title) {
  return `<div class="hariai-console-wait"><strong>${escapeHtml(title)}</strong><p id="hariaiTransferProgress">${state.channelReady ? `転送状況 ${state.transferProgress}%` : "P2P接続を待っています…"}</p></div>`;
}

function renderHariaiActConsole(pending) {
  const opponent = getOpponent();
  const me = state.replay.players[state.uid];
  const tabs = [
    pending.canPost ? ["post", "貼る"] : null,
    pending.canBreak ? ["break", "看破する"] : null,
    pending.canPass ? ["pass", "看破を見送る"] : null,
    ["surrender", "参りました"],
  ].filter(Boolean);
  const requested = state.drafts.consoleTab;
  const tab = tabs.some(([id]) => id === requested) ? requested : tabs[0][0];
  const nav = `<div class="hariai-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${tab === id}" class="${tab === id ? "is-active" : ""}" data-hariai-tab="${id}">${label}</button>`).join("")}</div>`;
  let body = "";
  if (tab === "post") body = renderHariaiPostComposer(me, opponent);
  else if (tab === "break") body = renderHariaiBreakComposer(opponent);
  else if (tab === "pass") {
    body = `<p>手札がなくなりました。看破を見送ると、あとは相手の手番だけが続きます。</p>
      <button class="button button-ghost hariai-submit" type="button" data-hariai-pass ${state.battleBusy ? "disabled" : ""}>看破を見送る</button>`;
  } else {
    body = `<p class="hariai-preview">「${escapeHtml(personaLine(getLocalPlayer(), "surrender"))}」</p><p>降参するとその場で負けになり、RATEに反映されます。</p>
      <button class="button button-danger hariai-submit" type="button" data-hariai-surrender ${state.battleBusy ? "disabled" : ""}>参りました（降参する）</button>`;
  }
  const comboNote = pending.combo
    ? `<em class="hariai-combo">連投中：${pending.combo}手連続で命中／次の手は+${Math.min(HARIAI_COMBO_CAP, HARIAI_COMBO_STEP * pending.combo)}</em>`
    : "";
  return `<div class="hariai-console-act"><div class="hariai-console-head"><strong>あなたの番</strong>${comboNote}</div>${nav}${body}</div>`;
}

function renderHariaiPostComposer(me, opponent) {
  const hand = handCards();
  const memo = hariaiReadingMemo(state.replay, state.uid);
  const drafts = state.drafts;
  const hearts = Number(me?.heartsRemaining || 0);
  const example = `${personaCallName(getLocalPlayer(), opponent)}、こういうの好きでしょ？♡`;
  return `<div class="hariai-composer">
    <p class="hariai-step"><b>1</b>手札から1枚（残り${hand.length}枚）</p>
    <div class="hariai-hand">${hand.map((item) => `<button type="button" class="hariai-hand-card ${drafts.cardId === item.id ? "is-selected" : ""}" data-hariai-card="${item.id}" aria-pressed="${drafts.cardId === item.id}">
      <img src="${item.url}" alt="手札の画像" />${item.audioBlob ? '<span class="hariai-hand-audio">♪</span>' : ""}</button>`).join("")}</div>
    <p class="hariai-step"><b>2</b>狙う弱点候補</p>
    <div class="hariai-targets">${opponent.clues.map((clue, index) => {
      const entry = memo[index];
      const note = entry.weakness ? "本命（看破済み）" : entry.bluff ? "ブラフ確定" : entry.scores.length ? `平均${entry.average}点／${entry.scores.length}回` : "まだ狙っていない";
      return `<label class="hariai-target-option ${entry.bluff ? "is-bluff" : ""} ${entry.weakness ? "is-weakness" : ""}"><input type="radio" name="hariaiTarget" value="${index}" ${drafts.target === index ? "checked" : ""} />
        <span><strong>${escapeHtml(clue)}</strong><small>${escapeHtml(note)}</small></span></label>`;
    }).join("")}</div>
    <p class="hariai-step"><b>3</b>画像に乗せる言葉（必須・${HARIAI_CAPTION_MAX}文字まで）</p>
    <div class="hariai-caption-field"><textarea class="text-input" id="hariaiCaption" maxlength="${HARIAI_CAPTION_MAX}" rows="2" placeholder="例：${escapeHtml(example)}">${escapeHtml(drafts.caption)}</textarea>
      <div class="hariai-caption-tools"><button type="button" class="button button-ghost button-small" data-hariai-heart="hariaiCaption" aria-label="ハートを足す">♡</button><span><b id="hariaiCaptionCount">${drafts.caption.length}</b> / ${HARIAI_CAPTION_MAX}</span></div></div>
    ${hearts ? `<p class="hariai-effect">♡の指示中：あと${hearts}回、送信時に語尾へ♡が付きます</p>` : ""}
    <button class="button button-primary hariai-submit" type="button" data-hariai-post ${state.battleBusy || !state.channelReady ? "disabled" : ""}>${state.channelReady ? "この1手を貼る" : "P2P接続を待っています…"}</button>
  </div>`;
}

function renderHariaiBreakComposer(opponent) {
  const runtime = state.replay.players[opponent.uid];
  const guess = state.drafts.breakGuess;
  const guessText = Number.isInteger(guess) ? opponent.clues[guess] : "…";
  return `<div class="hariai-composer"><p>看破は1試合1回。当たれば${escapeHtml(opponent.name)}の理性 −${HARIAI_BREAK_HIT_DAMAGE}、さらに「強がり」の数＋1枚（最大${HARIAI_FINISH_MAX}枚）で仕留められます。外すと自分の理性 −${HARIAI_BREAK_MISS_DAMAGE}です。</p>
    <div class="hariai-targets">${opponent.clues.map((clue, index) => {
      const bluff = runtime.revealedBluffs.includes(index);
      return `<label class="hariai-target-option ${bluff ? "is-bluff" : ""}"><input type="radio" name="hariaiBreakGuess" value="${index}" ${guess === index ? "checked" : ""} ${bluff ? "disabled" : ""} />
        <span><strong>${escapeHtml(clue)}</strong><small>${bluff ? "ブラフ確定" : ""}</small></span></label>`;
    }).join("")}</div>
    <p class="hariai-preview">「${escapeHtml(personaLine(getLocalPlayer(), "breakCall", { candidate: guessText }))}」</p>
    <button class="button button-danger hariai-submit" type="button" data-hariai-break ${state.battleBusy || !Number.isInteger(guess) ? "disabled" : ""}>この候補で看破する</button></div>`;
}

function renderHariaiScorePreview(value, slot, me) {
  const band = hariaiBand(value);
  const damage = Math.min(Number(me?.reason || 0), hariaiPostDamage(value, slot?.combo || 1));
  const rest = Number(me?.reason || 0) - damage;
  const bandText = {
    none: "80点未満：手番があなたに移ります",
    question: "80〜84点：相手に質問権",
    instruction: "85〜89点：相手に指示権",
    combo: "90点以上：相手は権利＋連投（手番継続）",
  }[band];
  return `<p class="hariai-score-preview band-${band}"><strong>${value}点</strong><span>${escapeHtml(bandText)}／あなたの理性 −${damage}</span>
    ${rest <= 0 ? '<b class="hariai-ko-warning">この点数で陥落します</b>' : `<span>（残り${rest}）</span>`}${renderHariaiMeter(value)}</p>`;
}

function renderHariaiScoreConsole(pending) {
  const slot = state.replay.slots.find((item) => item.slot === pending.slot);
  const key = imageKey("move", pending.slot);
  const me = state.replay.players[state.uid];
  if (!state.openedMediaKeys.has(key)) {
    return `<div class="hariai-console-act"><div class="hariai-console-head"><strong>${escapeHtml(getOpponent().name)}が貼りました</strong></div>
      <p>画像と言葉を開いてから、今の自分に刺さった点数を返します。</p>
      <button class="button button-primary hariai-submit" type="button" data-hariai-open="${escapeHtml(key)}">画像と言葉を開く</button></div>`;
  }
  const value = Number.isInteger(state.drafts.score) ? state.drafts.score : null;
  const local = getLocalPlayer();
  const suggestions = value === null ? [] : hariaiReplySuggestions(local.persona.type, value, {
    first: personaFirst(local),
    call: personaCallName(local, getOpponent()),
  });
  return `<div class="hariai-console-act hariai-score-console">
    <div class="hariai-console-head"><strong>何点刺さった？</strong><small>画像の出来ではなく、今の自分に刺さった度合いを自己申告します</small></div>
    <div class="hariai-score-input"><input type="range" min="0" max="100" step="1" id="hariaiScoreRange" value="${value ?? 70}" aria-label="点数" />
      <input class="text-input" type="number" min="0" max="100" step="1" inputmode="numeric" id="hariaiScoreNumber" value="${value ?? ""}" placeholder="0〜100" aria-label="点数（数値）" /></div>
    <div class="hariai-score-quick">${[60, 75, 80, 85, 90, 95, 100].map((score) => `<button type="button" class="is-${hariaiBand(score)}${value === score ? " is-selected" : ""}" data-hariai-score="${score}">${score}</button>`).join("")}</div>
    <div id="hariaiScorePreview">${value === null ? "" : renderHariaiScorePreview(value, slot, me)}</div>
    <label class="field-label">ひとこと（任意・${HARIAI_REPLY_MAX}文字まで）${pending.reasonRequired ? `<b class="hariai-required">理由の指示中：${HARIAI_REASON_MIN_LENGTH}文字以上</b>` : ""}
      <input class="text-input" id="hariaiReply" maxlength="${HARIAI_REPLY_MAX}" value="${escapeHtml(state.drafts.reply)}" autocomplete="off" /></label>
    ${suggestions.length ? `<div class="hariai-suggestions">${suggestions.map((line) => `<button type="button" data-hariai-suggest="${escapeHtml(line)}">${escapeHtml(line)}</button>`).join("")}</div>` : ""}
    ${me.heartsRemaining ? `<p class="hariai-effect">♡の指示中：ひとことの語尾に♡が付きます（あと${me.heartsRemaining}回）</p>` : ""}
    <label class="hariai-surrender-check"><input type="checkbox" id="hariaiScoreSurrender" ${state.drafts.surrender ? "checked" : ""} />この点数を付けて「参りました」する</label>
    <button class="button button-primary hariai-submit" type="button" data-hariai-score-submit ${state.battleBusy || value === null ? "disabled" : ""}>この点数を返す</button></div>`;
}

function renderHariaiRightConsole(pending) {
  const opponent = getOpponent();
  const opponentRuntime = state.replay.players[opponent.uid];
  const slot = state.replay.slots.find((item) => item.slot === pending.slot);
  const options = pending.options;
  const drafts = state.drafts;
  const headline = options.combo
    ? `${slot.score}点！ 質問か指示をひとつ＋連投`
    : options.instruction ? `${slot.score}点！ 指示をひとつ使えます` : `${slot.score}点！ 質問をひとつ使えます`;
  const selected = (kind, id) => drafts.rightKind === kind && drafts.rightId === id;
  const questionList = options.question ? HARIAI_QUESTIONS.map((question) => `<label class="hariai-right-option"><input type="radio" name="hariaiRight" value="question:${question.id}" ${selected("question", question.id) ? "checked" : ""} />
    <span><strong>${escapeHtml(question.label)}</strong><small>${escapeHtml(fillHariaiLine(question.prompt, { a: "候補A", b: "候補B" }))}</small></span></label>`).join("") : "";
  const denyAvailable = hariaiDenyAvailable(opponentRuntime);
  const instructionList = options.instruction ? HARIAI_INSTRUCTIONS.map((instruction) => {
    const disabled = instruction.id === "deny" && !denyAvailable;
    const note = disabled ? "候補の否定は1試合1回、公開済みの候補がない時だけ" : fillHariaiLine(instruction.prompt, { honorific: "〇〇" });
    return `<label class="hariai-right-option ${disabled ? "is-disabled" : ""}"><input type="radio" name="hariaiRight" value="instruction:${instruction.id}" ${selected("instruction", instruction.id) ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span><strong>${escapeHtml(instruction.label)}</strong><small>${escapeHtml(note)}</small></span></label>`;
  }).join("") : "";
  const both = Boolean(options.question && options.instruction);
  const tab = both
    ? (["question", "instruction"].includes(drafts.rightTab) ? drafts.rightTab : drafts.rightKind === "instruction" ? "instruction" : "question")
    : options.question ? "question" : "instruction";
  const tabs = both
    ? `<div class="hariai-right-tabs" role="tablist" aria-label="権利の種類">${[["question", "質問"], ["instruction", "指示"]].map(([id, label]) => `<button type="button" role="tab" aria-selected="${tab === id}" class="${tab === id ? "is-active" : ""}" data-hariai-right-tab="${id}">${label}</button>`).join("")}</div>`
    : "";
  const candidateOptions = (value) => opponent.clues.map((clue, index) => `<option value="${index}" ${value === index ? "selected" : ""}>${escapeHtml(clue)}</option>`).join("");
  let extra = "";
  if (drafts.rightId === "which") {
    extra = `<div class="hariai-which"><label class="field-label">候補A<select class="text-input" id="hariaiWhichA">${candidateOptions(drafts.rightA)}</select></label>
      <label class="field-label">候補B<select class="text-input" id="hariaiWhichB">${candidateOptions(drafts.rightB)}</select></label></div>`;
  } else if (drafts.rightId === "call") {
    extra = `<label class="field-label">呼ばせ方<select class="text-input" id="hariaiHonorific">${HARIAI_HONORIFICS.map((honorific) => `<option value="${honorific.id}" ${drafts.rightParam === honorific.id ? "selected" : ""}>${escapeHtml(hariaiHonorificName(honorific.id, getLocalPlayer().name))}</option>`).join("")}</select></label>`;
  }
  const ready = Boolean(drafts.rightKind && drafts.rightId)
    && (drafts.rightId !== "which" || (Number.isInteger(drafts.rightA) && Number.isInteger(drafts.rightB) && drafts.rightA !== drafts.rightB))
    && (drafts.rightId !== "call" || Boolean(drafts.rightParam));
  return `<div class="hariai-console-act"><div class="hariai-console-head"><strong>${escapeHtml(headline)}</strong><small>質問と指示はメニューからだけ選べます</small></div>
    ${tabs}
    ${questionList && tab === "question" ? `${both ? "" : '<p class="hariai-step"><b>Q</b>質問</p>'}<div class="hariai-right-list">${questionList}</div>` : ""}
    ${instructionList && tab === "instruction" ? `${both ? "" : '<p class="hariai-step"><b>!</b>指示</p>'}<div class="hariai-right-list">${instructionList}</div>` : ""}
    ${extra}
    <label class="field-label">味付けのひとこと（任意・${HARIAI_FLAVOR_MAX}文字まで）<input class="text-input" id="hariaiFlavor" maxlength="${HARIAI_FLAVOR_MAX}" value="${escapeHtml(drafts.flavor)}" autocomplete="off" /></label>
    <div class="hariai-actions"><button class="button button-ghost" type="button" data-hariai-right-skip ${state.battleBusy ? "disabled" : ""}>今回は使わない</button>
      <button class="button button-primary" type="button" data-hariai-right-submit ${state.battleBusy || !ready ? "disabled" : ""}>${drafts.rightKind === "instruction" ? "この指示を使う" : "この質問を使う"}</button></div></div>`;
}

function renderHariaiAnswerConsole(pending) {
  const right = pending.right;
  const me = getLocalPlayer();
  const opponent = getOpponent();
  const runtime = state.replay.players[state.uid];
  const drafts = state.drafts;
  const flavor = right.flavor ? `<span class="hariai-flavor">${escapeHtml(right.flavor)}</span>` : "";
  let body = "";
  if (right.kind === "question" && (right.id === "spot" || right.id === "next")) {
    body = `<textarea class="text-input" id="hariaiAnswerText" maxlength="${HARIAI_ANSWER_MAX}" rows="2">${escapeHtml(drafts.answerText)}</textarea>
      <span class="hariai-count"><b id="hariaiAnswerCount">${drafts.answerText.length}</b> / ${HARIAI_ANSWER_MAX}</span>
      ${runtime.heartsRemaining ? `<p class="hariai-effect">♡の指示中：答えの語尾に♡が付きます</p>` : ""}`;
  } else if (right.id === "which") {
    body = `<div class="hariai-targets">${[right.a, right.b].map((index) => `<label class="hariai-target-option"><input type="radio" name="hariaiAnswerChoice" value="${index}" ${drafts.answerChoice === index ? "checked" : ""} />
      <span><strong>${escapeHtml(me.clues[index])}</strong><small>${index === state.weaknessIndex ? "あなたの本命" : "ブラフ"}</small></span></label>`).join("")}</div>
      <p class="hariai-note">正直に答えても、ブラフで答えてもかまいません。</p>`;
  } else if (right.id === "honest") {
    body = `<input class="text-input" type="number" min="0" max="100" step="1" inputmode="numeric" id="hariaiAnswerValue" value="${Number.isInteger(drafts.answerValue) ? drafts.answerValue : ""}" placeholder="0〜100" />
      <p class="hariai-note">答えの点数は演出だけで、理性や権利には影響しません。</p>`;
  } else if (right.id === "deny") {
    body = `<div class="hariai-targets">${me.clues.map((clue, index) => {
      const weakness = index === state.weaknessIndex;
      const revealed = runtime.revealedBluffs.includes(index);
      return `<label class="hariai-target-option ${weakness ? "is-weakness" : ""}"><input type="radio" name="hariaiAnswerCandidate" value="${index}" ${drafts.answerCandidate === index ? "checked" : ""} ${weakness || revealed ? "disabled" : ""} />
        <span><strong>${escapeHtml(clue)}</strong><small>${weakness ? "本命は否定できません" : revealed ? "公開済み" : "ブラフとして公開する"}</small></span></label>`;
    }).join("")}</div>`;
  } else {
    body = `<p class="hariai-preview">「${escapeHtml(hariaiAckLine(right, me, opponent))}」</p>`;
  }
  return `<div class="hariai-console-act"><div class="hariai-console-head"><strong>${right.kind === "question" ? "質問されました" : "指示されました"}</strong></div>
    <p class="hariai-prompt">${escapeHtml(hariaiRightPrompt(right, state.uid))}${flavor}</p>${body}
    <button class="button button-primary hariai-submit" type="button" data-hariai-answer ${state.battleBusy ? "disabled" : ""}>${right.kind === "question" ? "答える" : "従う"}</button></div>`;
}

function renderHariaiFinishConsole(pending) {
  const opponent = getOpponent();
  const hand = handCards();
  const selected = state.drafts.finishIds.filter((id) => hand.some((item) => item.id === id)).slice(0, pending.finishMax);
  const weakness = state.replay.players[opponent.uid]?.weaknessRevealed;
  const placeholder = `ほら、${Number.isInteger(weakness) ? opponent.clues[weakness] : "これ"}…ばれてるよ♡`;
  return `<div class="hariai-console-act"><div class="hariai-console-head"><strong>看破成功！ 仕留めの手札を選ぶ</strong>
      <small>最大${pending.finishMax}枚。1枚につき理性 −${HARIAI_FINISH_DAMAGE}（点数はありません）</small></div>
    <div class="hariai-hand">${hand.map((item) => {
      const order = selected.indexOf(item.id);
      return `<button type="button" class="hariai-hand-card ${order >= 0 ? "is-selected" : ""}" data-hariai-finish-card="${item.id}" aria-pressed="${order >= 0}"><img src="${item.url}" alt="手札の画像" />${order >= 0 ? `<span class="hariai-hand-order">${order + 1}</span>` : ""}</button>`;
    }).join("")}</div>
    ${selected.map((_, index) => `<label class="field-label">${index + 1}枚目の言葉（必須）<input class="text-input" data-hariai-finish-caption="${index}" maxlength="${HARIAI_CAPTION_MAX}" value="${escapeHtml(state.drafts.finishCaptions[index] || "")}" autocomplete="off" placeholder="${escapeHtml(placeholder)}" /></label>`).join("")}
    <div class="hariai-actions"><button class="button button-ghost" type="button" data-hariai-finish-skip ${state.battleBusy ? "disabled" : ""}>仕留めずに続ける</button>
      <button class="button button-danger" type="button" data-hariai-finish-submit ${state.battleBusy || !selected.length ? "disabled" : ""}>${selected.length}枚で仕留める</button></div></div>`;
}

function renderHariaiReadingMemo() {
  const opponent = getOpponent();
  const memo = hariaiReadingMemo(state.replay, state.uid);
  const me = state.replay?.players?.[state.uid];
  const myPosts = (state.replay?.slots || []).filter((slot) => slot.kind === "post" && slot.by === state.uid).length;
  let breakNote = `看破は1試合1回。${HARIAI_BREAK_MIN_POSTS}手以上貼ると宣言できます。`;
  if (me?.breakResult === "hit") breakNote = "看破は成功しました。";
  else if (me?.breakResult === "miss") breakNote = "看破は外れました（1試合1回）。";
  else if (me?.breakPassed) breakNote = "看破は見送りました。";
  else if (myPosts >= HARIAI_BREAK_MIN_POSTS) breakNote = `看破は1試合1回。${HARIAI_BREAK_MIN_POSTS}手以上貼ったので宣言できます。`;
  const status = (entry) => entry.weakness ? "本命（看破済み）" : entry.bluff ? "ブラフ確定" : entry.scores.length ? `平均 ${entry.average}` : "まだ狙っていない";
  const digest = memo.map((entry) => `${opponent.clues[entry.index]} ${entry.weakness ? "本命" : entry.bluff ? "ブラフ" : entry.scores.length ? entry.average : "—"}`).join(" · ");
  const rows = memo.map((entry) => {
    const hot = !entry.weakness && !entry.bluff && entry.scores.length && entry.average >= HARIAI_BAND_QUESTION;
    return `<li class="${entry.weakness ? "is-weakness" : entry.bluff ? "is-bluff" : hot ? "is-hot" : ""}">
      <strong>${escapeHtml(opponent.clues[entry.index])}</strong>
      <span class="hariai-memo-scores">${entry.scores.length ? `<span class="ha-sr">狙った時の点数：</span>${entry.scores.map((score) => `<b>${score.score}</b>`).join("")}` : ""}</span>
      <em>${escapeHtml(status(entry))}</em>
      ${entry.answers.length ? `<small>「どっち？」で${entry.answers.length}回選ばれた</small>` : ""}</li>`;
  }).join("");
  return `<details class="hariai-memo" data-hariai-memo${hariaiMemoOpen ? " open" : ""}>
    <summary><span class="hariai-memo-title">読みメモ</span><small>${escapeHtml(opponent.name)}（${escapeHtml(personaLabel(opponent))}）の弱点候補</small><span class="hariai-memo-digest">${escapeHtml(digest)}</span></summary>
    <ol class="hariai-memo-page">${rows}</ol>
    <p class="hariai-memo-note">${escapeHtml(breakNote)}</p></details>`;
}

function renderHariaiSelfCard() {
  const me = getLocalPlayer();
  const opponent = getOpponent();
  const runtime = state.replay?.players?.[state.uid];
  const faces = hariaiBluffFaces(state.replay, { [state.uid]: state.weaknessIndex })[state.uid] || [];
  return `<section class="hariai-self"><h2>あなたの秘密</h2><p>本命：<b>${escapeHtml(me.clues[state.weaknessIndex] || "")}</b></p>
    <p>強がり：<b>${faces.length}</b>回<small>本命を狙われて80点未満で返した回数。看破されると、この数だけ仕留めが増えます。</small></p>
    ${runtime?.revealedBluffs?.length ? `<p>公開済みのブラフ：${runtime.revealedBluffs.map((index) => escapeHtml(me.clues[index])).join("、")}</p>` : ""}
    ${runtime?.honorific ? `<p>呼び方の指示：${escapeHtml(opponent.name)}を「${escapeHtml(hariaiHonorificName(runtime.honorific, opponent.name))}」と呼ぶ</p>` : ""}</section>`;
}

function renderHariaiRuleCard() {
  return `<details class="hariai-rules"><summary>ルール早見表</summary><ul>
    <li>1手＝画像＋言葉＋狙い。言葉のない手は出せません</li>
    <li>点数は「今の自分に刺さった度合い」の自己申告（0〜100）</li>
    <li>80未満：手番交代／80〜84：質問／85〜89：指示／90以上：質問か指示＋連投</li>
    <li>ダメージは点数−70。連投は2手目から+5ずつ（最大+15）</li>
    <li>看破は1試合1回。当たり：相手 −25＋仕留め（強がり数＋1枚、最大3枚）／外れ：自分 −20</li>
    <li>理性が0で陥落。両者の手札が尽きたら理性の多い方の勝ち</li></ul></details>`;
}

function hariaiOutcomeReasonLabel(outcome) {
  if (!outcome) return "";
  if (outcome.reason === "ko") return "陥落";
  if (outcome.reason === "surrender") return "降参";
  return outcome.draw ? "引き分け" : "手札切れの判定";
}

function hariaiPenaltyLabel(id) {
  return HARIAI_PENALTIES.find((penalty) => penalty.id === id)?.label || "罰";
}

function hariaiPenaltyLine(penalty, winner, loser) {
  if (penalty.kind === "call") return `これからは「${hariaiHonorificName(penalty.honorific, winner.name)}」って呼びます…♡`;
  if (penalty.kind === "tribute") return "お貢ぎ、受け取ってください…♡";
  return personaLine(loser, "declare");
}

function renderHariaiPenaltySection(outcome) {
  if (outcome.winnerIndex < 0) {
    return '<section class="hariai-penalty"><span class="eyebrow">PENALTY</span><h2>罰</h2><p>引き分けのため、罰はありません。</p></section>';
  }
  const winner = state.players[outcome.winnerIndex];
  const loser = state.players[1 - outcome.winnerIndex];
  const options = hariaiPenaltyOptions(state.players[0].penalties, state.players[1].penalties);
  const penalty = state.roomData?.penalty;
  const done = state.roomData?.penaltyDone?.[loser.uid];
  const iWon = winner.uid === state.uid;
  let body = "";
  if (!penalty) {
    if (iWon) {
      const kind = options.includes(state.drafts.penaltyKind) ? state.drafts.penaltyKind : "";
      body = `<p>この試合で合意された罰から、ひとつ選んでください。</p>
        <div class="hariai-right-list">${options.map((id) => `<label class="hariai-right-option"><input type="radio" name="hariaiPenalty" value="${id}" ${kind === id ? "checked" : ""} />
          <span><strong>${escapeHtml(hariaiPenaltyLabel(id))}</strong><small>${escapeHtml(HARIAI_PENALTIES.find((item) => item.id === id)?.note || "")}</small></span></label>`).join("")}</div>
        ${kind === "call" ? `<label class="field-label">呼ばせ方<select class="text-input" id="hariaiPenaltyHonorific">${HARIAI_HONORIFICS.map((honorific) => `<option value="${honorific.id}" ${state.drafts.penaltyHonorific === honorific.id ? "selected" : ""}>${escapeHtml(hariaiHonorificName(honorific.id, winner.name))}</option>`).join("")}</select></label>` : ""}
        <button class="button button-primary" type="button" data-hariai-penalty-submit ${kind && !state.battleBusy ? "" : "disabled"}>この罰にする</button>`;
    } else {
      body = `<p>${escapeHtml(winner.name)}が罰を選んでいます…（合意済み：${options.map((id) => escapeHtml(hariaiPenaltyLabel(id))).join("／")}）</p>`;
    }
  } else if (done) {
    body = `<p class="hariai-penalty-done"><b>${escapeHtml(loser.name)}</b>「${escapeHtml(hariaiPenaltyLine(penalty, winner, loser))}」</p>`;
  } else if (iWon) {
    body = `<p>罰「${escapeHtml(hariaiPenaltyLabel(penalty.kind))}」を選びました。${escapeHtml(loser.name)}の実行を待っています…</p>`;
  } else if (penalty.kind === "tribute") {
    body = `<p>品評会で、${escapeHtml(winner.name)}の本命「${escapeHtml(winner.clues[winner.weaknessIndex] || "")}」に向けた画像1枚を送るとお貢ぎ完了です。品評会が開かれない場合は見送りになります。</p>`;
  } else {
    body = `<p class="hariai-preview">「${escapeHtml(hariaiPenaltyLine(penalty, winner, loser))}」</p>
      <button class="button button-primary" type="button" data-hariai-penalty-done ${state.battleBusy ? "disabled" : ""}>罰を実行する</button>`;
  }
  return `<section class="hariai-penalty"><span class="eyebrow">PENALTY</span><h2>罰（合意済みの着地）</h2>${body}<small>罰は演出だけです。RATE・Pay・実績には影響せず、現実の行動や外部への投稿は求めません。</small></section>`;
}

function renderHariaiReviewPenaltyBanner() {
  const penalty = state.roomData?.penalty;
  const outcome = determineOutcome();
  if (!penalty || outcome.winnerIndex < 0) return "";
  const winner = state.players[outcome.winnerIndex];
  const loser = state.players[1 - outcome.winnerIndex];
  const done = state.roomData?.penaltyDone?.[loser.uid];
  const detail = penalty.kind === "tribute"
    ? (done ? "お貢ぎは届きました。" : `${loser.name}が本命「${winner.clues[winner.weaknessIndex] || ""}」に向けた画像を1枚送るとお貢ぎ完了です。`)
    : hariaiPenaltyLine(penalty, winner, loser);
  return `<div class="strategy-review-notice hariai-review-penalty"><span>罰：${escapeHtml(hariaiPenaltyLabel(penalty.kind))}</span><p>${escapeHtml(detail)}</p></div>`;
}

// 品評会中は画面全体を描き直さないため、罰の選択・実行はバナーだけ差し替える。
function refreshHariaiReviewPenaltyBanner() {
  if (state.screen !== "review") return;
  const html = renderHariaiReviewPenaltyBanner();
  const current = app.querySelector(".hariai-review-penalty");
  if (current) {
    current.outerHTML = html;
    return;
  }
  if (html) app.querySelector(".strategy-review-leave")?.insertAdjacentHTML("beforebegin", html);
}

function bindHariaiBattleEvents() {
  const on = (selector, type, handler) => app.querySelectorAll(selector).forEach((element) => element.addEventListener(type, handler));
  const run = (action) => () => action().catch(handleRecoverableError);
  on("[data-hariai-tab]", "click", (event) => { state.drafts.consoleTab = event.currentTarget.dataset.hariaiTab; render(); });
  on("[data-hariai-memo]", "toggle", (event) => { hariaiMemoOpen = event.currentTarget.open; });
  on("[data-hariai-right-tab]", "click", (event) => {
    const tab = event.currentTarget.dataset.hariaiRightTab;
    state.drafts.rightTab = tab;
    // 別のタブで選んでいた項目は外して、送る内容と見えている一覧をそろえる。
    if (state.drafts.rightKind && state.drafts.rightKind !== tab) {
      state.drafts.rightKind = "";
      state.drafts.rightId = "";
    }
    render();
    document.querySelector(`[data-hariai-right-tab="${tab}"]`)?.focus({ preventScroll: true });
  });
  on("[data-hariai-card]", "click", (event) => { state.drafts.cardId = event.currentTarget.dataset.hariaiCard; render(); });
  on('input[name="hariaiTarget"]', "change", (event) => { state.drafts.target = Number(event.currentTarget.value); });
  on("#hariaiCaption", "input", (event) => {
    state.drafts.caption = event.currentTarget.value;
    const counter = document.querySelector("#hariaiCaptionCount");
    if (counter) counter.textContent = String(event.currentTarget.value.length);
  });
  on("[data-hariai-heart]", "click", (event) => {
    const input = document.getElementById(event.currentTarget.dataset.hariaiHeart);
    if (!input) return;
    input.value = `${input.value}♡`.slice(0, Number(input.maxLength) > 0 ? Number(input.maxLength) : HARIAI_CAPTION_MAX);
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
  on("[data-hariai-post]", "click", run(submitHariaiPost));
  on('input[name="hariaiBreakGuess"]', "change", (event) => { state.drafts.breakGuess = Number(event.currentTarget.value); render(); });
  on("[data-hariai-break]", "click", run(submitHariaiBreak));
  on("[data-hariai-pass]", "click", run(submitHariaiPass));
  on("[data-hariai-surrender]", "click", run(submitHariaiSurrender));
  on("[data-hariai-open]", "click", (event) => openHariaiMedia(event.currentTarget.dataset.hariaiOpen).catch(handleRecoverableError));
  on("#hariaiScoreRange", "input", (event) => setHariaiScoreDraft(Number(event.currentTarget.value), false));
  on("#hariaiScoreRange", "change", (event) => setHariaiScoreDraft(Number(event.currentTarget.value), true));
  on("#hariaiScoreNumber", "change", (event) => setHariaiScoreDraft(Number(event.currentTarget.value), true));
  on("[data-hariai-score]", "click", (event) => setHariaiScoreDraft(Number(event.currentTarget.dataset.hariaiScore), true));
  on("#hariaiReply", "input", (event) => { state.drafts.reply = event.currentTarget.value; });
  on("[data-hariai-suggest]", "click", (event) => {
    state.drafts.reply = String(event.currentTarget.dataset.hariaiSuggest || "").slice(0, HARIAI_REPLY_MAX);
    const input = document.querySelector("#hariaiReply");
    if (input) input.value = state.drafts.reply;
  });
  on("#hariaiScoreSurrender", "change", (event) => { state.drafts.surrender = event.currentTarget.checked; });
  on("[data-hariai-score-submit]", "click", run(submitHariaiScore));
  on('input[name="hariaiRight"]', "change", (event) => {
    const [kind, id] = event.currentTarget.value.split(":");
    state.drafts.rightKind = kind;
    state.drafts.rightId = id;
    if (id === "which" && !Number.isInteger(state.drafts.rightA)) { state.drafts.rightA = 0; state.drafts.rightB = 1; }
    if (id === "call" && !state.drafts.rightParam) state.drafts.rightParam = HARIAI_HONORIFICS[0].id;
    render();
  });
  on("#hariaiWhichA", "change", (event) => { state.drafts.rightA = Number(event.currentTarget.value); render(); });
  on("#hariaiWhichB", "change", (event) => { state.drafts.rightB = Number(event.currentTarget.value); render(); });
  on("#hariaiHonorific", "change", (event) => { state.drafts.rightParam = event.currentTarget.value; });
  on("#hariaiFlavor", "input", (event) => { state.drafts.flavor = event.currentTarget.value; });
  on("[data-hariai-right-skip]", "click", run(() => submitHariaiRight(true)));
  on("[data-hariai-right-submit]", "click", run(() => submitHariaiRight(false)));
  on("#hariaiAnswerText", "input", (event) => {
    state.drafts.answerText = event.currentTarget.value;
    const counter = document.querySelector("#hariaiAnswerCount");
    if (counter) counter.textContent = String(event.currentTarget.value.length);
  });
  on('input[name="hariaiAnswerChoice"]', "change", (event) => { state.drafts.answerChoice = Number(event.currentTarget.value); });
  on("#hariaiAnswerValue", "input", (event) => {
    const value = Number(event.currentTarget.value);
    state.drafts.answerValue = event.currentTarget.value !== "" && Number.isInteger(value) ? value : null;
  });
  on('input[name="hariaiAnswerCandidate"]', "change", (event) => { state.drafts.answerCandidate = Number(event.currentTarget.value); });
  on("[data-hariai-answer]", "click", run(submitHariaiAnswer));
  on("[data-hariai-finish-card]", "click", (event) => toggleHariaiFinishCard(event.currentTarget.dataset.hariaiFinishCard));
  on("[data-hariai-finish-caption]", "input", (event) => {
    state.drafts.finishCaptions[Number(event.currentTarget.dataset.hariaiFinishCaption)] = event.currentTarget.value;
  });
  on("[data-hariai-finish-skip]", "click", run(() => submitHariaiFinish(true)));
  on("[data-hariai-finish-submit]", "click", run(() => submitHariaiFinish(false)));
  on("[data-hariai-play-finish]", "click", (event) => playHariaiFinish(Number(event.currentTarget.dataset.hariaiPlayFinish)).catch(handleRecoverableError));
  on('input[name="hariaiPenalty"]', "change", (event) => { state.drafts.penaltyKind = event.currentTarget.value; render(); });
  on("#hariaiPenaltyHonorific", "change", (event) => { state.drafts.penaltyHonorific = event.currentTarget.value; });
  on("[data-hariai-penalty-submit]", "click", run(submitHariaiPenalty));
  on("[data-hariai-penalty-done]", "click", run(submitHariaiPenaltyDone));
}

function setHariaiScoreDraft(value, rerender) {
  if (!Number.isFinite(value)) return;
  const score = Math.max(HARIAI_SCORE_MIN, Math.min(HARIAI_SCORE_MAX, Math.round(value)));
  state.drafts.score = score;
  if (rerender) {
    render();
    return;
  }
  const number = document.querySelector("#hariaiScoreNumber");
  if (number) number.value = String(score);
  const pending = state.replay?.pending;
  const slot = state.replay?.slots?.find((item) => item.slot === pending?.slot);
  const preview = document.querySelector("#hariaiScorePreview");
  if (preview) preview.innerHTML = renderHariaiScorePreview(score, slot, state.replay?.players?.[state.uid]);
  document.querySelector("[data-hariai-score-submit]")?.removeAttribute("disabled");
}

function toggleHariaiFinishCard(cardId) {
  const pending = state.replay?.pending;
  if (pending?.stage !== "finish") return;
  const selected = state.drafts.finishIds.filter((id) => findHandCard(id));
  const index = selected.indexOf(cardId);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length < pending.finishMax) selected.push(cardId);
  else showToast(`仕留めは最大${pending.finishMax}枚です。`);
  state.drafts.finishIds = selected;
  render();
}

async function openHariaiMedia(key) {
  state.openedMediaKeys.add(key);
  const item = state.remoteImages.get(key);
  render();
  if (item?.audioUrl) await playAudioUrl(item.audioUrl, 0, Number(item.audioDuration || 0));
}

async function playHariaiFinish(slotNumber) {
  const slot = state.replay?.slots?.find((item) => item.slot === slotNumber);
  if (!slot?.finishCount || state.finishPlaybackActive) return;
  state.finishPlaybackActive = true;
  try {
    for (let index = 0; index < slot.finishCount; index += 1) {
      const figure = document.querySelector(`[data-hariai-finish-figure="${slotNumber}:${index}"]`);
      figure?.classList.add("is-playing");
      const item = hariaiSlotItem(slot, index);
      if (item?.audioUrl) {
        await playAudioUrl(item.audioUrl, Number(item.audioCueStart || 0), Math.min(AUDIO_HIGHLIGHT_SECONDS, Number(item.audioDuration || AUDIO_HIGHLIGHT_SECONDS)));
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      figure?.classList.remove("is-playing");
    }
  } finally {
    state.finishPlaybackActive = false;
  }
}

function hariaiPendingFor(stage) {
  const pending = state.replay?.pending;
  return pending?.stage === stage && pending.actor === state.uid && !state.replay?.outcome ? pending : null;
}

async function writeHariai(path, value) {
  if (state.battleBusy || !state.roomId) return false;
  const targetState = state;
  const roomId = state.roomId;
  targetState.battleBusy = true;
  render();
  try {
    await set(ref(database, `online/strategyRooms/${roomId}/${path}`), value);
    if (state === targetState) targetState.drafts = { ...emptyHariaiDrafts(), penaltyKind: targetState.drafts.penaltyKind };
    return true;
  } catch (error) {
    if (state === targetState) showToast(error?.message || "送信できませんでした。通信状態を確認してください。");
    return false;
  } finally {
    if (state === targetState) {
      targetState.battleBusy = false;
      render();
    }
  }
}

function hariaiText(value, maxLength, withHeart) {
  const text = normalizeHariaiText(value, maxLength);
  if (!text || !withHeart) return text;
  return ensureHariaiHeart(text.length >= maxLength ? text.slice(0, maxLength - 1) : text);
}

async function submitHariaiPost() {
  const pending = hariaiPendingFor("act");
  if (!pending?.canPost) return;
  const item = findHandCard(state.drafts.cardId);
  const target = state.drafts.target;
  const me = state.replay.players[state.uid];
  const caption = hariaiText(state.drafts.caption, HARIAI_CAPTION_MAX, me.heartsRemaining > 0);
  if (!item) return showToast("貼る画像を手札から1枚選んでください。");
  if (!Number.isInteger(target)) return showToast("狙う弱点候補を選んでください。");
  if (!caption) return showToast("画像に乗せる言葉を書いてください。言葉のない手は出せません。");
  if (!state.channelReady) return showToast("P2P接続の準備ができてから貼ってください。");
  const targetState = state, channel = state.channel, roomId = state.roomId;
  const slot = pending.slot;
  item.used = true;
  state.localMoveCards.set(slot, item);
  const written = await writeHariai(`moves/${slot}/post`, { by: state.uid, target, caption, lockedAt: serverTimestamp() });
  if (!written) {
    item.used = false;
    targetState.localMoveCards.delete(slot);
    if (state === targetState) render();
    return;
  }
  if (!strategyImageSendContextIsCurrent(targetState, channel, roomId)) return;
  window.HariaiAudio?.playReveal?.();
  await ensureMoveImageSent(slot);
}

async function submitHariaiBreak() {
  const pending = hariaiPendingFor("act");
  const guess = state.drafts.breakGuess;
  if (!pending?.canBreak || !Number.isInteger(guess)) return;
  if (!window.confirm(`「${candidateText(state.opponentUid, guess)}」で看破しますか？ 看破は1試合1回です。`)) return;
  await writeHariai(`moves/${pending.slot}/break`, { by: state.uid, guess, lockedAt: serverTimestamp() });
}

async function submitHariaiPass() {
  const pending = hariaiPendingFor("act");
  if (!pending?.canPass) return;
  await writeHariai(`moves/${pending.slot}/pass`, { by: state.uid, lockedAt: serverTimestamp() });
}

async function submitHariaiSurrender() {
  const pending = hariaiPendingFor("act");
  if (!pending) return;
  if (!window.confirm("参りましたと言って、この対戦を降参しますか？ 降参は負けとして記録されます。")) return;
  await writeHariai(`moves/${pending.slot}/surrender`, { by: state.uid, lockedAt: serverTimestamp() });
}

async function submitHariaiScore() {
  const pending = hariaiPendingFor("score");
  const value = state.drafts.score;
  if (!pending || !Number.isInteger(value)) return;
  if (!state.openedMediaKeys.has(imageKey("move", pending.slot))) return showToast("画像と言葉を開いてから採点してください。");
  const me = state.replay.players[state.uid];
  const reply = hariaiText(state.drafts.reply, HARIAI_REPLY_MAX, me.heartsRemaining > 0);
  if (pending.reasonRequired && normalizeHariaiText(state.drafts.reply, HARIAI_REPLY_MAX).length < HARIAI_REASON_MIN_LENGTH) {
    return showToast(`「理由を言わせる」指示中です。ひとことを${HARIAI_REASON_MIN_LENGTH}文字以上書いてください。`);
  }
  const surrender = state.drafts.surrender === true;
  if (surrender && !window.confirm(`${value}点を付けて「参りました」と降参しますか？`)) return;
  const slot = state.replay.slots.find((item) => item.slot === pending.slot);
  const damage = hariaiPostDamage(value, slot?.combo || 1);
  if (!surrender && damage >= me.reason && !window.confirm(`${value}点を付けると、あなたの理性が0になり陥落します。よろしいですか？`)) return;
  const payload = { by: state.uid, value, lockedAt: serverTimestamp() };
  if (reply) payload.reply = reply;
  if (surrender) payload.surrender = true;
  await writeHariai(`moves/${pending.slot}/score`, payload);
}

async function submitHariaiRight(skip) {
  const pending = hariaiPendingFor("right");
  if (!pending) return;
  const drafts = state.drafts;
  if (skip) {
    await writeHariai(`moves/${pending.slot}/right`, { by: state.uid, kind: "none", lockedAt: serverTimestamp() });
    return;
  }
  const kind = drafts.rightKind;
  const id = drafts.rightId;
  if ((kind === "question" && !pending.options.question) || (kind === "instruction" && !pending.options.instruction) || !id) {
    return showToast("使う質問か指示を選んでください。");
  }
  const payload = { by: state.uid, kind, id, lockedAt: serverTimestamp() };
  if (id === "which") {
    if (!Number.isInteger(drafts.rightA) || !Number.isInteger(drafts.rightB) || drafts.rightA === drafts.rightB) return showToast("違う候補を2つ選んでください。");
    payload.a = drafts.rightA;
    payload.b = drafts.rightB;
  }
  if (id === "call") payload.param = drafts.rightParam || HARIAI_HONORIFICS[0].id;
  if (id === "deny" && !hariaiDenyAvailable(state.replay.players[state.opponentUid])) return showToast("候補の否定は、この状況では使えません。");
  const flavor = normalizeHariaiText(drafts.flavor, HARIAI_FLAVOR_MAX);
  if (flavor) payload.flavor = flavor;
  await writeHariai(`moves/${pending.slot}/right`, payload);
}

async function submitHariaiAnswer() {
  const pending = hariaiPendingFor("answer");
  if (!pending) return;
  const right = pending.right;
  const drafts = state.drafts;
  const me = state.replay.players[state.uid];
  const payload = { by: state.uid, lockedAt: serverTimestamp() };
  if (right.kind === "question" && (right.id === "spot" || right.id === "next")) {
    const text = hariaiText(drafts.answerText, HARIAI_ANSWER_MAX, me.heartsRemaining > 0);
    if (!text) return showToast("答えを書いてください。");
    payload.text = text;
  } else if (right.id === "which") {
    if (drafts.answerChoice !== right.a && drafts.answerChoice !== right.b) return showToast("どちらかを選んでください。");
    payload.choice = drafts.answerChoice;
  } else if (right.id === "honest") {
    if (!Number.isInteger(drafts.answerValue) || drafts.answerValue < 0 || drafts.answerValue > 100) return showToast("0〜100の点数で答えてください。");
    payload.value = drafts.answerValue;
  } else if (right.id === "deny") {
    const candidate = drafts.answerCandidate;
    if (!Number.isInteger(candidate) || candidate === state.weaknessIndex || me.revealedBluffs.includes(candidate)) {
      return showToast("否定できるのはブラフの候補だけです。");
    }
    payload.candidate = candidate;
    payload.salt = state.weaknessSalts[candidate];
  } else {
    payload.ack = true;
  }
  await writeHariai(`moves/${pending.slot}/answer`, payload);
}

async function submitHariaiFinish(skip) {
  const pending = hariaiPendingFor("finish");
  if (!pending) return;
  if (skip) {
    await writeHariai(`moves/${pending.slot}/finish`, { by: state.uid, count: 0, lockedAt: serverTimestamp() });
    return;
  }
  const cards = state.drafts.finishIds.map((id) => findHandCard(id)).filter(Boolean).slice(0, pending.finishMax);
  if (!cards.length) return showToast("仕留めに使う手札を選んでください。");
  const me = state.replay.players[state.uid];
  let hearts = Number(me.heartsRemaining || 0);
  const captions = {};
  for (let index = 0; index < cards.length; index += 1) {
    const caption = hariaiText(state.drafts.finishCaptions[index], HARIAI_CAPTION_MAX, hearts > 0);
    if (!caption) return showToast(`${index + 1}枚目の言葉を書いてください。`);
    if (hearts > 0) hearts -= 1;
    captions[index] = caption;
  }
  if (!state.channelReady) return showToast("P2P接続の準備ができてから仕留めてください。");
  const targetState = state, channel = state.channel, roomId = state.roomId;
  cards.forEach((item, index) => {
    item.used = true;
    state.localFinishCards.set(`${pending.slot}:${index}`, item);
  });
  const written = await writeHariai(`moves/${pending.slot}/finish`, { by: state.uid, count: cards.length, captions, lockedAt: serverTimestamp() });
  if (!written) {
    cards.forEach((item, index) => {
      item.used = false;
      targetState.localFinishCards.delete(`${pending.slot}:${index}`);
    });
    if (state === targetState) render();
    return;
  }
  if (!strategyImageSendContextIsCurrent(targetState, channel, roomId)) return;
  await ensureFinishImagesSent(pending.slot, cards.length);
}

async function submitHariaiPenalty() {
  const outcome = determineOutcome();
  const kind = state.drafts.penaltyKind;
  if (outcome.winnerIndex !== state.playerIndex || state.roomData?.penalty) return;
  if (!hariaiPenaltyOptions(state.players[0].penalties, state.players[1].penalties).includes(kind)) return showToast("合意済みの罰から選んでください。");
  const payload = { by: state.uid, kind, at: serverTimestamp() };
  if (kind === "call") payload.honorific = state.drafts.penaltyHonorific || HARIAI_HONORIFICS[0].id;
  await writeHariai("penalty", payload);
}

async function submitHariaiPenaltyDone() {
  const outcome = determineOutcome();
  const penalty = state.roomData?.penalty;
  if (!penalty || outcome.winnerIndex < 0 || outcome.winnerIndex === state.playerIndex || state.roomData?.penaltyDone?.[state.uid]) return;
  await writeHariai(`penaltyDone/${state.uid}`, { kind: penalty.kind, at: serverTimestamp() });
}

async function completeHariaiTribute() {
  const outcome = determineOutcome();
  const penalty = state.roomData?.penalty;
  if (penalty?.kind !== "tribute" || outcome.winnerIndex < 0 || outcome.winnerIndex === state.playerIndex || state.roomData?.penaltyDone?.[state.uid]) return;
  await set(ref(database, `online/strategyRooms/${state.roomId}/penaltyDone/${state.uid}`), { kind: "tribute", at: serverTimestamp() })
    .then(() => showToast("お貢ぎが届きました。罰を実行しました。"))
    .catch(() => showToast("お貢ぎの記録を送信できませんでした。"));
}

async function ensureFirstAttacker() {
  if (state.firstUid) return state.firstUid;
  const roomId = state.roomId;
  const digest = await sha256Hex(`hariai-first:${roomId}`);
  if (state.roomId !== roomId) return "";
  const [host, guest] = state.players;
  state.firstUid = hariaiFirstAttacker({
    hostUid: host.uid,
    guestUid: guest.uid,
    hostRating: host.rating,
    guestRating: guest.rating,
    roomHashFirstByte: Number.parseInt(digest.slice(0, 2), 16),
  });
  return state.firstUid;
}

async function verifyHariaiPartialReveals(replay) {
  for (const check of hariaiPartialReveals(replay)) {
    const key = `${check.slot}:${check.uid}:${check.index}`;
    if (state.verifiedRevealKeys.has(key)) continue;
    const expected = playerByUid(check.uid)?.weaknessCommits?.[check.index];
    const digest = await sha256Hex(hariaiCandidateCommitMaterial(state.roomId, check.uid, check.index, check.bit === 1, check.salt));
    if (!expected || digest !== expected) return false;
    state.verifiedRevealKeys.add(key);
  }
  return true;
}

function announceHariaiSlots(replay, { silent = false } = {}) {
  for (const slot of replay.slots) {
    const resolvedKey = `${slot.slot}:${slot.kind}:${slot.score ?? ""}:${slot.breakResult ?? ""}:${slot.finishDamage ?? ""}`;
    if (state.announcedSlots.has(resolvedKey)) continue;
    state.announcedSlots.add(resolvedKey);
    if (silent) continue;
    if (slot.kind === "post" && Number.isInteger(slot.score)) {
      if (slot.score >= HARIAI_BAND_COMBO) {
        window.HariaiAudio?.playResult?.(slot.score >= 100 ? 10 : 9);
        triggerCriticalFx(slot.score >= 100 ? "PERFECT!!" : slot.combo > 1 ? `${slot.combo}連投！` : "連投！");
      } else if (slot.score >= HARIAI_BAND_QUESTION) {
        window.HariaiAudio?.playResult?.(8);
      } else {
        window.HariaiAudio?.playFlip?.();
      }
    } else if (slot.kind === "break" && slot.breakResult === "hit" && !Number.isInteger(slot.finishDamage)) {
      window.HariaiAudio?.playFinish?.();
      triggerCriticalFx("看破！");
    } else if (slot.kind === "break" && slot.breakResult === "miss") {
      window.HariaiAudio?.playDamage?.();
    } else if (slot.kind === "break" && Number.isInteger(slot.finishDamage) && slot.finishCount) {
      triggerCriticalFx(`仕留め×${slot.finishCount}`);
    }
  }
}

async function ensureMoveImageSent(slot) {
  const item = state.localMoveCards.get(slot);
  if (!item) throw new Error("貼った画像を手札から確認できませんでした。この対戦はノーコンテストになる可能性があります。");
  await sendImage(item, "move", slot);
}

async function ensureFinishImagesSent(slot, count) {
  const targetState = state, channel = state.channel, roomId = state.roomId;
  for (let index = 0; index < count; index += 1) {
    if (!strategyImageSendContextIsCurrent(targetState, channel, roomId)) {
      throw new Error("画像送信中にP2P接続または対戦が切り替わりました。");
    }
    const item = targetState.localFinishCards.get(`${slot}:${index}`);
    if (!item) throw new Error("仕留めの画像を手札から確認できませんでした。");
    await sendImage(item, "finish", slot, index);
  }
}

async function publishBreakReveal(slotNumber) {
  const slot = state.replay?.slots?.find((item) => item.slot === slotNumber);
  const key = `break:${slotNumber}`;
  if (!slot || slot.kind !== "break" || state.publishedRevealKeys.has(key)) return;
  const guess = slot.guess;
  const salt = state.weaknessSalts[guess];
  if (!/^[a-f0-9]{32}$/.test(String(salt || ""))) throw new Error("弱点の封印データを確認できませんでした。");
  state.publishedRevealKeys.add(key);
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/moves/${slotNumber}/breakReveal`), {
      by: state.uid,
      index: guess,
      bit: guess === state.weaknessIndex ? 1 : 0,
      salt,
      revealedAt: serverTimestamp(),
    });
  } catch (error) {
    state.publishedRevealKeys.delete(key);
    throw error;
  }
}

async function performHariaiAutomaticSteps(replay) {
  const pending = replay.pending;
  if (!pending) return;
  if (pending.stage === "receive") {
    if (pending.attacker === state.uid) await ensureMoveImageSent(pending.slot);
    else if (pending.actor === state.uid) {
      const item = state.remoteImages.get(imageKey("move", pending.slot));
      if (item && !item.awaitingAudio) await acknowledgeStrategyMedia("move", pending.slot, 0);
    }
  } else if (pending.stage === "breakReveal" && pending.actor === state.uid) {
    await publishBreakReveal(pending.slot);
  } else if (pending.stage === "finishReceive") {
    if (pending.attacker === state.uid) await ensureFinishImagesSent(pending.slot, pending.finishCount);
    else if (pending.actor === state.uid) {
      for (let index = 0; index < pending.finishCount; index += 1) {
        const item = state.remoteImages.get(imageKey("finish", pending.slot, index));
        if (item && !item.awaitingAudio) await acknowledgeStrategyMedia("finish", pending.slot, index);
      }
    }
  }
}

async function reactToBattle() {
  if (state.weaknessIntegrityFailed || state.screen !== "battle") return;
  const targetState = state;
  const roomId = state.roomId;
  const firstUid = await ensureFirstAttacker();
  if (!firstUid || !strategyRoomOperationIsCurrent(targetState, roomId)) return;
  const [host, guest] = state.players;
  const replay = replayHariai({ hostUid: host.uid, guestUid: guest.uid, firstUid, moves: state.roomData?.moves || {} });
  state.replay = replay;
  if (!replay.ok) {
    await failWeaknessIntegrityCheck(`対戦データの整合性を確認できませんでした（${replay.error}）。この対戦はノーコンテストです。`);
    return;
  }
  if (!await verifyHariaiPartialReveals(replay)) {
    await failWeaknessIntegrityCheck("弱点の封印と答え合わせが一致しませんでした。この対戦はノーコンテストです。");
    return;
  }
  if (!strategyRoomOperationIsCurrent(targetState, roomId)) return;
  const firstAnnouncement = !state.battleAnnounced;
  state.battleAnnounced = true;
  announceHariaiSlots(replay, { silent: firstAnnouncement });
  if (replay.outcome) {
    triggerCriticalFx(replay.outcome.draw ? "DRAW" : replay.outcome.reason === "ko" ? "陥落" : replay.outcome.reason === "surrender" ? "参りました" : "手札切れ");
    await finishMatch();
    return;
  }
  renderBattleIfChanged();
  await performHariaiAutomaticSteps(replay);
}

async function publishFinalWeaknessReveal() {
  if (state.finalRevealPublishing || state.roomData?.weaknessReveals?.[state.uid]) return;
  if (!Number.isInteger(state.weaknessIndex) || state.weaknessSalts.length !== 3) throw new Error("弱点の封印データを確認できませんでした。");
  state.finalRevealPublishing = true;
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/weaknessReveals/${state.uid}`), {
      weaknessIndex: state.weaknessIndex,
      salts: { 0: state.weaknessSalts[0], 1: state.weaknessSalts[1], 2: state.weaknessSalts[2] },
      revealedAt: serverTimestamp(),
    });
  } finally {
    state.finalRevealPublishing = false;
  }
}

async function verifyFinalWeaknessReveals(reveals) {
  for (const player of state.players) {
    const reveal = normalizeHariaiFinalReveal(reveals?.[player.uid]);
    if (!reveal || player.weaknessCommits.length !== 3) return false;
    for (let index = 0; index < 3; index += 1) {
      const digest = await sha256Hex(hariaiCandidateCommitMaterial(state.roomId, player.uid, index, index === reveal.weaknessIndex, reveal.salts[index]));
      if (digest !== player.weaknessCommits[index]) return false;
    }
    player.weaknessIndex = reveal.weaknessIndex;
  }
  return true;
}

function renderWithdrawn() {
  return renderStatusCard("×", "NO CONTEST", "勝負は撤退されました", "プレイヤーネームと弱点は公開されず、戦績にも影響しません。", "", `<button class="button button-primary" id="strategyWithdrawAgain">別の相手を探す</button><button class="button button-ghost" id="strategyWithdrawHome">タイトルへ戻る</button>`);
}

function renderNoContest() {
  if (state.idleStopReason) return renderStatusCard("×", "NO CONTEST", "開始前の待機を終了しました", state.idleStopReason, "", `<button class="button button-primary" id="strategyNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="strategyNoContestHome">タイトルへ戻る</button>`);
  if (state.playerSafetyStopped) return renderStatusCard("×", "CONTACT CLOSED", "交流を終了しました", "画像・音声・チャットを閉じました。確定済みの結果は残ります。", "", `<button class="button button-primary" id="strategyNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="strategyNoContestHome">タイトルへ戻る</button>`);
  return renderStatusCard("×", "NO CONTEST", "戦略型1on1対戦を終了しました", "ルームが破棄されました。画像と進行情報への参照を解放しました。", "", `<button class="button button-primary" id="strategyNoContestAgain">別の相手を探す</button><button class="button button-ghost" id="strategyNoContestHome">タイトルへ戻る</button>`);
}

function renderError() {
  return renderStatusCard("!", "CONNECTION ERROR", "戦略型1on1へ接続できません", state.errorMessage || "通信状態を確認してください。", "", `<button class="button button-primary" id="strategyRetry">もう一度試す</button><button class="button button-ghost" id="strategyErrorHome">タイトルへ戻る</button>`);
}

function renderWaiting(eyebrow, title, body, extraActions = "") {
  return `<section class="screen strategy-screen">${renderBattleHud()}${renderStatusCard("…", eyebrow, title, body, `<div class="matching-pulse"><i></i><i></i><i></i></div>`, `${extraActions}<button class="button button-danger button-small" data-strategy-destroy>ルーム破棄</button>`).replace('<section class="screen handoff-wrap">', '<div class="handoff-wrap">').replace('</section>', '</div>')}</section>`;
}

function renderStatusCard(icon, eyebrow, title, body, details = "", actions = "") {
  return `<section class="screen handoff-wrap"><article class="handoff-card online-status-card"><div class="handoff-icon" aria-hidden="true">${escapeHtml(icon)}</div>
    <span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><div class="online-status-details">${details}</div><div class="button-row">${actions}</div></article></section>`;
}

function isStrategyChatVisible() {
  return !state.playerSafetyStopped && (ANONYMOUS_CHAT_SCREENS.has(state.screen) || IDENTIFIED_CHAT_SCREENS.has(state.screen));
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
  const phaseLabel = message.phase === "scout" ? "SCOUT" : message.phase === "review" ? "REVIEW" : `#${Math.max(1, Math.min(HARIAI_MAX_SLOTS, Number(message.round) || 1))}`;
  const showIdentityCosmetics = !anonymous && message.phase !== "scout";
  const cosmeticClasses = showIdentityCosmetics ? chatCosmeticClassNames(message.chatFrameId, message.chatBackgroundId) : "";
  const titleBadge = showIdentityCosmetics ? renderStrategyTitleBadge(message.titleId) : "";
  const content = message.stampId
    ? renderStampBubble(message.stampId, cosmeticClasses)
    : `<p${cosmeticClasses ? ` class="${cosmeticClasses}"` : ""}>${escapeHtml(message.text)}</p>`;
  return `<div class="strategy-chat-message-row ${localPlayer ? "is-local" : "is-opponent"}">${renderStrategyChatAvatar(player, localPlayer, anonymous)}
    <div class="chat-message ${localPlayer ? "player-two" : "player-one"}"><small>${escapeHtml(displayName)} / ${phaseLabel}${titleBadge}</small>${content}</div></div>`;
}

function strategyReviewIsActive() {
  const decisions = state.roomData?.reviewDecisions || {};
  const ended = state.roomData?.reviewEnded || {};
  return !state.reviewLocallyEnded
    && decisions[state.uid] === "accept"
    && decisions[state.opponentUid] === "accept"
    && Number(state.roomData?.reviewStartedAt || 0) > 0
    && !ended[state.uid]
    && !ended[state.opponentUid]
    && reviewRemainingMs() > 0;
}

function currentStrategyVideoPhase() {
  if (state.screen === "review") return strategyReviewIsActive() ? "review" : "";
  const finished = state.roomData?.finished || {};
  return IDENTIFIED_CHAT_SCREENS.has(state.screen)
    && state.screen !== "review"
    && state.screen !== "identity"
    && state.screen !== "waitingBattle"
    && finished[state.uid] !== true
    && finished[state.opponentUid] !== true
    ? "battle"
    : "";
}

function renderStrategyVideoClip(clip) {
  const local = clip.ownerUid === state.uid;
  const player = local ? getLocalPlayer() : getOpponent();
  const label = clip.phase === "review" ? "品評会" : `対戦 #${Math.max(1, Math.min(HARIAI_MAX_SLOTS, Number(clip.round) || 1))}`;
  return `<article class="strategy-video-clip ${local ? "is-local" : "is-opponent"}">
    <div><small>${escapeHtml(label)} / ${local ? "YOU" : "OPPONENT"}</small><strong>${escapeHtml(player?.name || "PLAYER")}</strong></div>
    <video controls controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata" src="${escapeHtml(clip.url || "")}"></video>
    <span>${Number(clip.duration || 0).toFixed(1)}秒 / ${(Number(clip.size || 0) / (1024 * 1024)).toFixed(1)}MB</span>
  </article>`;
}

function renderStrategyVideoPanel() {
  const phase = currentStrategyVideoPhase();
  const clips = (state.screen === "review" ? state.videoClips : state.videoClips.filter((clip) => clip.phase === "battle"))
    .filter((clip) => !clip.released && clip.url);
  const alreadySent = phase ? state.videoSentPhases.has(phase) : false;
  const reviewPermissionReady = phase !== "review" || state.opponentReviewMediaReceiving;
  const canRecord = Boolean(phase) && state.videoChannelReady && reviewPermissionReady && !alreadySent && !state.videoSending;
  const status = !state.videoChannelReady
    ? "○ 動画P2P接続なし（チャットと対戦は続行できます）"
    : phase === "review" && !state.opponentReviewMediaReceiving
      ? "○ 相手がメディア受信を停止しています"
    : alreadySent
      ? `● この${phase === "review" ? "品評会" : "対戦"}では送信済み`
      : "● 動画P2P接続済み";
  return `<section class="strategy-video-panel" id="strategyVideoPanel"><div class="strategy-video-panel-head"><div><strong>SHORT VIDEO</strong>
      <span>最大10秒・480p・約${Math.round(STRATEGY_VIDEO_MAX_BYTES / (1024 * 1024))}MB / P2P一時転送</span></div>
      <button class="button button-ghost button-small" type="button" data-strategy-video-open ${canRecord ? "" : "disabled"}>${alreadySent ? "このフェーズは送信済み" : "短尺映像を録画"}</button></div>
    <p class="strategy-video-status">${escapeHtml(status)}</p>
    ${clips.length ? `<div class="strategy-video-clips">${clips.map(renderStrategyVideoClip).join("")}</div>` : '<p class="strategy-video-empty">受信・送信した映像は、この対戦または品評会を閉じるまでだけ再生できます。</p>'}
    <small class="strategy-video-privacy">録画前に顔、室内、住所・位置が分かるものが映っていないか確認してください。リアルタイム映像ではなく、確認後に送信します。</small></section>`;
}

function strategyReviewAssetLimit(kind) {
  return kind === "image" ? STRATEGY_REVIEW_IMAGE_LIMIT : STRATEGY_REVIEW_AUDIO_LIMIT;
}

function strategyReviewAssetCount(ownerUid, kind) {
  const counts = ownerUid === state.uid ? state.reviewAssetSentCounts : state.reviewAssetReceivedCounts;
  return Math.max(0, Number(counts?.[kind] || 0));
}

function collectStrategyReviewBattleMedia() {
  const items = [];
  const seen = new Set();
  const add = (item, ownerUid, label) => {
    if (!item?.url || seen.has(item.url)) return;
    seen.add(item.url);
    items.push({
      item,
      ownerUid,
      label,
      name: ownerUid === state.uid ? getLocalPlayer()?.name : getOpponent()?.name,
    });
  };
  for (const slot of state.replay?.slots || []) {
    if (slot.kind === "post") add(hariaiSlotItem(slot), slot.by, `#${slot.slot} ${Number.isInteger(slot.score) ? `${slot.score}点` : ""}`);
    if (slot.kind === "break") {
      for (let index = 0; index < Number(slot.finishCount || 0); index += 1) add(hariaiSlotItem(slot, index), slot.by, `#${slot.slot} 仕留め${index + 1}`);
    }
  }
  return items;
}

function renderStrategyReviewBattleGallery() {
  const items = collectStrategyReviewBattleMedia();
  if (!items.length) return "";
  return `<section class="strategy-review-gallery"><div class="strategy-review-media-head"><div><strong>BATTLE GALLERY</strong><span>対戦で使用した画像は再送せず、この端末内の一時データから表示しています。</span></div></div>
    <div class="strategy-review-gallery-grid">${items.map(({ item, ownerUid, label, name }) => `<article class="${ownerUid === state.uid ? "is-local" : "is-opponent"}">
      <div><small>${escapeHtml(label)} / ${ownerUid === state.uid ? "YOU" : "OPPONENT"}</small><strong>${escapeHtml(name || "PLAYER")}</strong></div>
      <img src="${escapeHtml(item.url)}" alt="${escapeHtml(`${name || "PLAYER"}の${label}画像`)}" loading="lazy" />
      ${item.audioUrl ? `<button class="button button-ghost button-small" type="button" data-strategy-play-audio="${escapeHtml(item.audioUrl)}" data-audio-start="0" data-audio-duration="${Number(item.audioDuration || 0)}">♪ 添付音声 ${Number(item.audioDuration || 0).toFixed(1)}秒</button>` : ""}</article>`).join("")}</div>
  </section>`;
}

function renderStrategyReviewAsset(asset) {
  const local = asset.ownerUid === state.uid;
  const owner = local ? getLocalPlayer() : getOpponent();
  const media = asset.kind === "image"
    ? `<img src="${escapeHtml(asset.url || "")}" alt="${escapeHtml(owner?.name || "PLAYER")}が追加した品評会画像" loading="lazy" />`
    : `<audio controls controlslist="nodownload noplaybackrate" preload="metadata" src="${escapeHtml(asset.url || "")}"></audio>`;
  return `<article class="strategy-review-asset ${local ? "is-local" : "is-opponent"}" data-review-asset-id="${escapeHtml(asset.id)}">
    <div><span><small>${asset.kind === "image" ? "追加画像" : "追加音声"} / ${local ? "YOU" : "OPPONENT"}</small><strong>${escapeHtml(owner?.name || "PLAYER")}</strong></span>
      <button class="review-asset-delete" type="button" data-strategy-review-asset-delete="${escapeHtml(asset.id)}" aria-label="このメディアを端末から削除">×</button></div>
    ${media}<small>${asset.kind === "audio" ? `${Number(asset.duration || 0).toFixed(1)}秒 / ` : ""}${(Number(asset.size || 0) / 1024).toFixed(0)}KB・一時表示</small>
  </article>`;
}

function renderPendingStrategyReviewAsset() {
  const asset = state.pendingReviewAsset;
  if (!asset) return "";
  const canSend = strategyReviewIsActive()
    && state.reviewAssetChannelReady
    && state.opponentReviewMediaReceiving
    && !state.reviewAssetSending;
  const media = asset.kind === "image"
    ? `<img src="${escapeHtml(asset.url || "")}" alt="送信前の追加画像プレビュー" />`
    : `<audio controls preload="metadata" src="${escapeHtml(asset.url || "")}"></audio>`;
  return `<section class="strategy-review-asset-pending"><div><strong>送信前に確認</strong><span>${asset.kind === "image" ? "追加画像" : `音声 ${Number(asset.duration || 0).toFixed(1)}秒`} / ${(Number(asset.size || 0) / 1024).toFixed(0)}KB</span></div>
    ${media}
    <div class="strategy-review-asset-progress" ${state.reviewAssetSending ? "" : "hidden"}><span>相手へP2P送信中</span><strong id="strategyReviewAssetProgress">${state.reviewAssetTransferProgress}%</strong></div>
    <div class="strategy-review-asset-actions"><button class="button button-primary button-small" type="button" id="strategyReviewAssetSend" ${canSend ? "" : "disabled"}>このメディアを送信</button>
      <button class="button button-ghost button-small" type="button" id="strategyReviewAssetCancel" ${state.reviewAssetSending ? "disabled" : ""}>破棄</button></div>
  </section>`;
}

function renderStrategyReviewAssetPanel() {
  const activeReview = state.screen === "review" && strategyReviewIsActive();
  const imageCount = strategyReviewAssetCount(state.uid, "image");
  const audioCount = strategyReviewAssetCount(state.uid, "audio");
  const imageFull = imageCount >= STRATEGY_REVIEW_IMAGE_LIMIT;
  const audioFull = audioCount >= STRATEGY_REVIEW_AUDIO_LIMIT;
  const opponentAllows = state.opponentReviewMediaReceiving;
  const canPrepare = activeReview && state.reviewAssetChannelReady && opponentAllows && !state.reviewAssetSending && !state.pendingReviewAsset && !state.reviewAudioRecording;
  const connectionStatus = !state.reviewAssetChannelReady
    ? "○ 添付P2P接続なし（チャットは続行できます）"
    : !opponentAllows
      ? "○ 相手がメディア受信を停止しています"
      : "● 画像・音声P2P接続済み";
  const recording = state.reviewAudioRecording;
  const assets = state.reviewAssets.filter((asset) => !asset.released && asset.url);
  return `<section class="strategy-review-asset-panel" id="strategyReviewAssetPanel">
    <div class="strategy-review-media-head"><div><strong>REVIEW MEDIA</strong><span>追加画像 ${imageCount}/${STRATEGY_REVIEW_IMAGE_LIMIT}・追加音声 ${audioCount}/${STRATEGY_REVIEW_AUDIO_LIMIT} / 1人あたり</span></div>
      <button class="button button-ghost button-small ${state.reviewMediaReceiving ? "is-receiving" : ""}" type="button" id="strategyReviewMediaToggle" aria-pressed="${state.reviewMediaReceiving}">${state.reviewMediaReceiving ? "メディア受信 ON" : "メディア受信 OFF"}</button></div>
    <p class="strategy-review-asset-status">${escapeHtml(connectionStatus)}</p>
    <div class="strategy-review-asset-toolbar">
      <label class="button button-ghost button-small file-button ${!canPrepare || imageFull ? "is-disabled" : ""}">＋ 画像を追加<input type="file" accept="image/png,image/jpeg,image/webp" id="strategyReviewImageInput" ${!canPrepare || imageFull ? "disabled" : ""} /></label>
      <label class="button button-ghost button-small file-button ${!canPrepare || audioFull ? "is-disabled" : ""}">♪ 音声ファイル<input type="file" accept="audio/*" id="strategyReviewAudioInput" ${!canPrepare || audioFull ? "disabled" : ""} /></label>
      <button class="button button-ghost button-small" type="button" id="strategyReviewAudioRecord" ${!canPrepare || audioFull ? "disabled" : ""}>● マイク録音</button>
      ${recording ? '<button class="button button-danger button-small" type="button" id="strategyReviewAudioStop">録音を停止</button><span class="strategy-review-recording-time" id="strategyReviewAudioRecordingTime">0.0 / 10.0秒</span>' : ""}
    </div>
    <small class="strategy-review-asset-note">画像はWebPへ再生成して約1.5MB以下、音声は10秒・モノラルWAV・約${Math.round(STRATEGY_REVIEW_AUDIO_MAX_BYTES / 1024)}KB以下に変換します。自動再生はしません。</small>
    ${renderPendingStrategyReviewAsset()}
    ${assets.length ? `<div class="strategy-review-assets">${assets.map(renderStrategyReviewAsset).join("")}</div>` : '<p class="strategy-review-asset-empty">追加メディアはまだありません。対戦画像は上のギャラリーから見返せます。</p>'}
  </section>`;
}

function renderStrategyChat() {
  const anonymous = isStrategyChatAnonymous();
  const reviewing = state.screen === "review";
  const localPlayer = getLocalPlayer();
  const opponent = getOpponent();
  const visibleMessages = reviewing ? state.chatMessages.filter((message) => message.phase === "review") : state.chatMessages.filter((message) => message.phase !== "review");
  const messages = visibleMessages.length
    ? visibleMessages.map((message) => renderStrategyChatMessage(message, anonymous)).join("")
    : `<div class="chat-empty">${reviewing ? "まだ品評コメントはありません。<br />画像の狙いや刺さったポイントから話してみましょう。" : "会話も弱点を見抜くための手掛かりです。<br />質問・ブラフ・反応を使って読み合いましょう。"}</div>`;
  return `<aside class="chat-panel strategy-chat-panel ${reviewing ? "is-review" : ""}"><div class="chat-head"><strong>${anonymous ? "ANONYMOUS SCOUT CHAT" : reviewing ? "POST-MATCH REVIEW CHAT" : "WEAKNESS SCOUT CHAT"}</strong>
      <span>${anonymous ? "名前・写真はデッキ封印まで非公開" : reviewing ? "双方同意済み・最大10分" : "会話も推理材料"}</span></div>
    <div class="strategy-chat-participants">${renderStrategyChatParticipant(localPlayer, true, anonymous)}${renderStrategyChatParticipant(opponent, false, anonymous)}</div>
    ${anonymous ? "" : reviewing ? `${renderStrategyReviewBattleGallery()}${renderStrategyReviewAssetPanel()}${renderStrategyVideoPanel()}` : renderStrategyVideoPanel()}
    <div class="chat-messages" id="strategyChatMessages">${messages}</div>
    ${renderChatTools({ id: "strategy", textReactions: STRATEGY_CHAT_PROMPTS, stamps: getAvailableStamps(state.economy, { freeOnly: anonymous }), textAttribute: "data-strategy-chat-reaction", stampAttribute: "data-strategy-chat-stamp" })}
    <form class="chat-form" id="strategyChatForm"><input class="chat-input" id="strategyChatInput" maxlength="80" placeholder="${reviewing ? "この一戦の感想を送る…" : "会話から本当の弱点を探る…"}" autocomplete="off" aria-label="戦略型1on1チャットメッセージ" />
      <button class="button button-cyan button-small" type="submit">送信</button></form></aside>`;
}

function renderBattleHud() {
  if (state.players.length !== 2) return "";
  const replay = state.replay;
  const pending = replay?.pending;
  const comboTurn = pending?.stage === "act" && pending.combo ? "・連投中" : "";
  const turnLabel = replay?.outcome ? "決着" : pending ? `${pending.actor === state.uid ? "あなたの番" : "相手の番"}${comboTurn}` : "準備中";
  return `<div class="round-topbar strategy-hud hariai-hud">${renderHudPlayer(0)}<div class="round-badge"><small>SLOT</small><strong>${Number(pending?.slot || replay?.slots?.length || 0)}</strong><span class="hariai-turn-label">${turnLabel}</span></div>${renderHudPlayer(1)}</div>
    <div class="online-room-strip"><span>STRATEGY ROOM ${escapeHtml(state.roomId.slice(-8).toUpperCase())}</span><span class="connection-pill ${state.channelReady ? "connected" : ""}">${state.channelReady ? "● P2P接続中" : "○ P2P接続待ち"}</span>
      <span class="connection-pill ${state.opponentOnline ? "connected" : "warning"}">${state.opponentOnline ? "● 相手オンライン" : "○ 相手の接続切れ"}</span>
      <button class="avatar-visibility-toggle" type="button" data-strategy-avatar-visibility aria-pressed="${state.hideOpponentAvatar}">${state.hideOpponentAvatar ? "相手画像を表示" : "相手画像を隠す"}</button></div>`;
}

function renderHudPlayer(index) {
  const player = state.players[index];
  const runtime = state.replay?.players?.[player.uid];
  const reason = runtime ? runtime.reason : HARIAI_REASON_MAX;
  const reasonPercent = Math.max(0, Math.min(100, (reason / HARIAI_REASON_MAX) * 100));
  const hand = runtime ? runtime.hand : MAIN_COUNT + RESERVE_COUNT;
  const breakLabel = !runtime ? "未使用" : runtime.breakResult === "hit" ? "成功" : runtime.breakResult === "miss" ? "失敗" : runtime.breakPassed ? "見送り" : "未使用";
  const localPlayer = index === state.playerIndex;
  const avatarUrl = localPlayer ? shared()?.profileAvatar?.get?.().url : state.remoteAvatar?.url;
  const avatar = shared()?.profileAvatar?.renderBattle?.(player.name, avatarUrl, { hidden: !localPlayer && state.hideOpponentAvatar }) || "";
  return `<div class="hud-player ${localPlayer ? "local-player" : ""}"><div class="hud-player-main">${avatar}<div class="hud-player-details"><div class="hud-name-row"><span class="hud-name">${escapeHtml(player.name)}${localPlayer ? "（あなた）" : ""}</span><span class="hariai-persona-chip">${escapeHtml(personaLabel(player))}</span></div>${localPlayer ? "" : renderOpponentAchievementShowcase({ compact: true, context: "is-hud", label: "相手の実績" })}
    <div class="hp-bar hariai-reason-bar"><div class="hp-fill" style="--hp:${reasonPercent}%"></div></div><span class="hp-value">理性 ${reason} / ${HARIAI_REASON_MAX} ・ 手札 ${hand} ・ 看破 ${breakLabel}</span></div></div></div>`;
}

function bindScreenEvents() {
  document.querySelector("#strategyBackHome")?.addEventListener("click", leaveToLanding);
  document.querySelector("#strategyOpenPreDeck")?.addEventListener("click", openPreparedDeck);
  document.querySelector("#strategyPreDeckBack")?.addEventListener("click", returnToStrategyProfile);
  document.querySelector("#strategyPreparedDeckDone")?.addEventListener("click", completePreparedDeck);
  document.querySelector("#strategyOpenNormal1on1")?.addEventListener("click", leaveToNormal1on1);
  document.querySelector("#strategyLoadStoredDeck")?.addEventListener("click", loadSavedPreparedDeck);
  document.querySelector("#strategyForgetStoredDeck")?.addEventListener("click", requestDeleteStoredStrategyDeck);
  document.querySelector("#strategyPersistDeck")?.addEventListener("change", (event) => {
    updateStrategyDeckPersistence(event.currentTarget.checked).catch(handleRecoverableError);
  });
  window.HariaiOnline?.bindBattlePresenceCheck?.({
    mode: "strategy",
    getOwnPresenceId: () => state.publicPresenceId || state.publicPresencePendingId,
  });
  if (state.screen === "profile") {
    window.HariaiOnline?.bindOverallRankingParticipation?.({
      controlId: "strategyOverallRanking",
      name: () => document.querySelector("#strategyName")?.value || state.name,
      onUpdate: () => { syncStrategyProfileDraft(); render(); },
    });
    bindStrategyCrownMatchmakingActions();
    shared()?.profileAvatar?.bindSetting?.({ controlId: "strategyProfileAvatar", onUpdate: () => { syncStrategyProfileDraft(); render(); } });
    document.querySelectorAll('input[name="strategyImagePreference"]').forEach((input) => input.addEventListener("change", () => {
      state.imagePreference = normalizeImagePreference(input.value, "");
      if (state.imagePreference) localStorage.setItem(PROFILE_IMAGE_PREFERENCE_KEY, state.imagePreference);
      updateStrategyCrownMatchmakingActions();
    }));
    bindPersonaFields();
  }
  document.querySelectorAll("[data-strategy-avatar-visibility]").forEach((button) => button.addEventListener("click", () => { state.hideOpponentAvatar = !state.hideOpponentAvatar; render(); }));
  bindStrategyChatEvents();
  document.querySelector("#strategyProfileForm")?.addEventListener("submit", saveProfile);
  document.querySelector("#strategyExpandMatchingScope")?.addEventListener("click", expandMatchmakingScope);
  document.querySelector("#strategyCancelMatching")?.addEventListener("click", cancelMatching);
  document.querySelector("#strategyWithdraw")?.addEventListener("click", () => submitDecision("withdraw"));
  document.querySelector("#strategyAccept")?.addEventListener("click", () => submitDecision("accept"));
  document.querySelectorAll("[data-strategy-upload]").forEach((input) => input.addEventListener("change", (event) => addDeckFiles(input.dataset.strategyUpload, [...event.target.files])));
  document.querySelectorAll("[data-strategy-remove]").forEach((button) => button.addEventListener("click", () => removeDeckItem(button.dataset.strategyRemove)));
  document.querySelectorAll("[data-strategy-audio]").forEach((input) => input.addEventListener("change", (event) => addCardAudio(input.dataset.strategyAudio, event.target.files?.[0])));
  document.querySelectorAll("[data-strategy-audio-remove]").forEach((button) => button.addEventListener("click", () => removeCardAudio(button.dataset.strategyAudioRemove)));
  document.querySelectorAll("[data-strategy-audio-cue]").forEach((input) => input.addEventListener("input", () => updateCardAudioCue(input.dataset.strategyAudioCue, input.value, input)));
  document.querySelectorAll("[data-strategy-play-audio]").forEach((button) => button.addEventListener("click", () => playAudioUrl(button.dataset.strategyPlayAudio, Number(button.dataset.audioStart || 0), Number(button.dataset.audioDuration || 0))));
  document.querySelector("#strategyLockDeck")?.addEventListener("click", lockDeck);
  document.querySelector("#strategyBattleStart")?.addEventListener("click", startBattle);
  if (["battle", "gameover"].includes(state.screen)) bindHariaiBattleEvents();
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
  document.querySelector("#strategyReviewAccept")?.addEventListener("click", () => submitReviewDecision("accept"));
  document.querySelector("#strategyReviewDecline")?.addEventListener("click", () => submitReviewDecision("decline"));
  document.querySelector("#strategyReviewLeave")?.addEventListener("click", leaveStrategyReview);
  document.querySelector("#strategyNewMatch")?.addEventListener("click", resetStrategySetup);
  document.querySelector("#strategyFreeTableLampButton")?.addEventListener("click", leaveToFreeTable);
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
  bindStrategyVideoPanelEvents();
  bindStrategyReviewAssetPanelEvents();
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
    phase: isStrategyChatAnonymous() ? "scout" : state.screen === "review" ? "review" : "battle",
    round: state.screen === "review" ? 0 : Math.max(1, Math.min(HARIAI_MAX_SLOTS, currentHariaiSlot())),
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
  const reviewing = state.screen === "review";
  const messages = reviewing ? state.chatMessages.filter((message) => message.phase === "review") : state.chatMessages.filter((message) => message.phase !== "review");
  list.innerHTML = messages.length
    ? messages.map((message) => renderStrategyChatMessage(message, anonymous)).join("")
    : `<div class="chat-empty">${reviewing ? "まだ品評コメントはありません。<br />画像の狙いや刺さったポイントから話してみましょう。" : "会話も弱点を見抜くための手掛かりです。<br />質問・ブラフ・反応を使って読み合いましょう。"}</div>`;
  scrollStrategyChat();
}

function scrollStrategyChat() {
  const list = document.querySelector("#strategyChatMessages");
  if (list) list.scrollTop = list.scrollHeight;
}

function bindStrategyVideoPanelEvents() {
  document.querySelector("[data-strategy-video-open]")?.addEventListener("click", openStrategyVideoDialog);
}

function refreshStrategyVideoPanel() {
  const panel = document.querySelector("#strategyVideoPanel");
  if (!panel || isStrategyChatAnonymous()) return;
  panel.outerHTML = renderStrategyVideoPanel();
  bindStrategyVideoPanelEvents();
}

function ensureStrategyVideoDialog() {
  let dialog = document.querySelector("#strategyVideoDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "strategyVideoDialog";
  dialog.className = "strategy-video-dialog";
  dialog.setAttribute("aria-labelledby", "strategyVideoDialogTitle");
  dialog.innerHTML = '<div class="strategy-video-dialog-shell" id="strategyVideoDialogBody"></div>';
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelStrategyVideoCapture(true);
  });
  document.body.append(dialog);
  return dialog;
}

function closeStrategyVideoDialog() {
  const dialog = document.querySelector("#strategyVideoDialog");
  if (dialog?.open) dialog.close();
}

function renderStrategyVideoDialog() {
  const dialog = ensureStrategyVideoDialog();
  const body = dialog.querySelector("#strategyVideoDialogBody");
  if (!body) return;
  const pending = state.pendingVideo;
  const capture = state.videoRecording;
  const phaseLabel = (pending?.phase || capture?.phase || currentStrategyVideoPhase()) === "review" ? "品評会" : "対戦中";
  let content = "";
  if (state.videoCaptureStarting) {
    content = `<div class="strategy-video-dialog-head"><div><span class="eyebrow">SHORT VIDEO / ${phaseLabel}</span><h2 id="strategyVideoDialogTitle">カメラを準備しています</h2></div></div>
      <div class="strategy-video-permission-wait"><div class="matching-pulse"><i></i><i></i><i></i></div><p>ブラウザのカメラ・マイク許可を確認してください。</p></div>
      <button class="button button-ghost" type="button" id="strategyVideoCancel">中止</button>`;
  } else if (capture) {
    content = `<div class="strategy-video-dialog-head"><div><span class="eyebrow">RECORDING / ${phaseLabel}</span><h2 id="strategyVideoDialogTitle">短尺映像を録画中</h2></div><strong class="strategy-recording-time" id="strategyVideoRecordingTime">0.0 / 10.0秒</strong></div>
      <div class="strategy-video-preview-wrap is-recording"><video id="strategyVideoLivePreview" muted autoplay playsinline></video><span>REC</span></div>
      <progress id="strategyVideoRecordingProgress" max="10" value="0"></progress>
      <p class="strategy-video-dialog-note">10秒で自動停止します。録画後に内容を確認してから送信できます。</p>
      <div class="strategy-video-dialog-actions"><button class="button button-primary" type="button" id="strategyVideoStop">録画を停止</button><button class="button button-ghost" type="button" id="strategyVideoCancel">破棄して中止</button></div>`;
  } else if (pending) {
    content = `<div class="strategy-video-dialog-head"><div><span class="eyebrow">PREVIEW / ${phaseLabel}</span><h2 id="strategyVideoDialogTitle">送信前に確認</h2></div></div>
      <div class="strategy-video-preview-wrap"><video controls controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata" src="${escapeHtml(pending.url || "")}"></video></div>
      <p class="strategy-video-dialog-note">${Number(pending.duration || 0).toFixed(1)}秒 / ${(Number(pending.size || 0) / (1024 * 1024)).toFixed(1)}MB。送信後も、この対戦または品評会を閉じると破棄されます。</p>
      <div class="strategy-video-send-progress" ${state.videoSending ? "" : "hidden"}><span>相手へP2P送信中</span><strong id="strategyVideoSendProgress">${state.videoTransferProgress}%</strong></div>
      <div class="strategy-video-dialog-actions"><button class="button button-primary" type="button" id="strategyVideoSend" ${state.videoSending ? "disabled" : ""}>この映像を送信</button>
        <button class="button button-ghost" type="button" id="strategyVideoRetake" ${state.videoSending ? "disabled" : ""}>撮り直す</button>
        <button class="button button-ghost" type="button" id="strategyVideoCancel" ${state.videoSending ? "disabled" : ""}>破棄して閉じる</button></div>`;
  } else {
    content = `<div class="strategy-video-dialog-head"><div><span class="eyebrow">SHORT VIDEO / ${phaseLabel}</span><h2 id="strategyVideoDialogTitle">最大10秒の映像を録画</h2></div></div>
      <div class="strategy-video-safety"><strong>録画前の確認</strong><p>顔、室内、住所・位置が分かるもの、個人情報を映さないでください。映像は相手へP2Pで一時送信され、運営サーバーには保存されません。</p></div>
      <label class="strategy-video-audio-option"><input type="checkbox" id="strategyVideoIncludeAudio" checked /> 映像にマイク音声も含める</label>
      <p class="strategy-video-dialog-note">480p・最大10秒・約${Math.round(STRATEGY_VIDEO_MAX_BYTES / (1024 * 1024))}MB。録画後に確認し、送信するか選べます。</p>
      <div class="strategy-video-dialog-actions"><button class="button button-primary" type="button" id="strategyVideoStart">録画を開始</button><button class="button button-ghost" type="button" id="strategyVideoCancel">閉じる</button></div>`;
  }
  body.innerHTML = content;
  body.querySelector("#strategyVideoStart")?.addEventListener("click", beginStrategyVideoCapture);
  body.querySelector("#strategyVideoStop")?.addEventListener("click", () => state.videoRecording?.session?.stop().catch(() => {}));
  body.querySelector("#strategyVideoSend")?.addEventListener("click", sendPendingStrategyVideo);
  body.querySelector("#strategyVideoRetake")?.addEventListener("click", () => {
    if (state.pendingVideo) releaseStrategyVideoResource(state.pendingVideo);
    state.pendingVideo = null;
    state.videoTransferProgress = 0;
    renderStrategyVideoDialog();
  });
  body.querySelector("#strategyVideoCancel")?.addEventListener("click", () => cancelStrategyVideoCapture(true));
  if (capture) {
    const preview = body.querySelector("#strategyVideoLivePreview");
    if (preview) {
      preview.srcObject = capture.session.stream;
      preview.play().catch(() => {});
    }
  }
}

function updateStrategyRecordingClock(capture) {
  if (state.videoRecording !== capture) return;
  const elapsed = Math.min(10, Math.max(0, (performance.now() - capture.session.startedAt) / 1000));
  const label = document.querySelector("#strategyVideoRecordingTime");
  const progress = document.querySelector("#strategyVideoRecordingProgress");
  if (label) label.textContent = `${elapsed.toFixed(1)} / 10.0秒`;
  if (progress) progress.value = elapsed;
}

function openStrategyVideoDialog() {
  const phase = currentStrategyVideoPhase();
  if (!phase) return showToast("現在は短尺映像を送信できません。");
  if (!state.videoChannelReady) return showToast("動画用P2P接続がありません。チャットと対戦はそのまま続けられます。");
  if (phase === "review" && !state.opponentReviewMediaReceiving) return showToast("相手がメディア受信を停止しています。");
  if (state.videoSentPhases.has(phase)) return showToast("短尺映像は対戦中・品評会中にそれぞれ1本までです。");
  renderStrategyVideoDialog();
  const dialog = ensureStrategyVideoDialog();
  if (!dialog.open) dialog.showModal();
}

async function beginStrategyVideoCapture() {
  const phase = currentStrategyVideoPhase();
  if (!phase || state.videoSentPhases.has(phase) || state.videoCaptureStarting || state.videoRecording) return;
  const includeAudio = document.querySelector("#strategyVideoIncludeAudio")?.checked !== false;
  const controller = new AbortController();
  state.videoCaptureAbortController = controller;
  state.videoCaptureStarting = true;
  renderStrategyVideoDialog();
  try {
    const session = await startStrategyVideoRecording({ includeAudio, signal: controller.signal });
    if (controller.signal.aborted || state.videoCaptureAbortController !== controller || currentStrategyVideoPhase() !== phase) {
      session.cancel().catch(() => {});
      return;
    }
    const capture = {
      session,
      phase,
      round: phase === "review" ? 0 : Math.max(1, Math.min(HARIAI_MAX_SLOTS, currentHariaiSlot())),
      clockTimer: null,
    };
    state.videoRecording = capture;
    state.videoCaptureStarting = false;
    state.videoCaptureAbortController = null;
    session.result.then((clip) => {
      window.clearInterval(capture.clockTimer);
      if (state.videoRecording !== capture) {
        releaseStrategyVideoResource(clip);
        return;
      }
      state.videoRecording = null;
      clip.ownerUid = state.uid;
      clip.phase = capture.phase;
      clip.round = capture.round;
      state.pendingVideo = clip;
      renderStrategyVideoDialog();
      refreshStrategyVideoPanel();
    }).catch((error) => {
      window.clearInterval(capture.clockTimer);
      if (state.videoRecording === capture) state.videoRecording = null;
      if (error?.name !== "AbortError") showToast(error?.message || "短尺映像を録画できませんでした。");
      renderStrategyVideoDialog();
    });
    renderStrategyVideoDialog();
    capture.clockTimer = window.setInterval(() => updateStrategyRecordingClock(capture), 100);
    updateStrategyRecordingClock(capture);
  } catch (error) {
    if (state.videoCaptureAbortController === controller) {
      state.videoCaptureStarting = false;
      state.videoCaptureAbortController = null;
    }
    if (error?.name !== "AbortError") showToast(error?.message || "カメラを開始できませんでした。");
    renderStrategyVideoDialog();
  }
}

function stopStrategyVideoRecording({ discard = false } = {}) {
  state.videoCaptureAbortController?.abort();
  state.videoCaptureAbortController = null;
  state.videoCaptureStarting = false;
  const capture = state.videoRecording;
  if (capture) {
    window.clearInterval(capture.clockTimer);
    if (discard) {
      state.videoRecording = null;
      capture.session.cancel().catch(() => {});
    } else {
      capture.session.stop().catch(() => {});
    }
  }
  if (discard && state.pendingVideo) {
    releaseStrategyVideoResource(state.pendingVideo);
    state.pendingVideo = null;
  }
}

function cancelStrategyVideoCapture(closeDialog = false) {
  if (state.videoSending) return;
  stopStrategyVideoRecording({ discard: true });
  state.videoTransferProgress = 0;
  if (closeDialog) closeStrategyVideoDialog();
  else renderStrategyVideoDialog();
  refreshStrategyVideoPanel();
}

function waitForVideoDataBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("動画用P2P接続が切れました。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => done(new Error("動画転送の待機時間を超えました。")), 10_000);
    const done = (error) => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onLow = () => done();
    const onClose = () => done(new Error("動画用P2P接続が切れました。"));
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

async function sendPendingStrategyVideo() {
  const clip = state.pendingVideo;
  const phase = currentStrategyVideoPhase();
  if (!clip || state.videoSending) return;
  if (!phase || clip.phase !== phase) {
    showToast("録画したフェーズが終了したため、この映像は送信できません。");
    releaseStrategyVideoResource(clip);
    state.pendingVideo = null;
    renderStrategyVideoDialog();
    return;
  }
  if (!state.videoChannelReady || !state.videoChannel || state.videoChannel.readyState !== "open") {
    showToast("動画用P2P接続がありません。映像以外の対戦機能は続けられます。");
    return;
  }
  if (phase === "review" && !state.opponentReviewMediaReceiving) {
    showToast("相手がメディア受信を停止したため送信できません。");
    return;
  }
  state.videoSending = true;
  state.videoTransferProgress = 0;
  renderStrategyVideoDialog();
  refreshStrategyVideoPanel();
  try {
    const transfer = await sendStrategyVideoClip(state.videoChannel, clip, {
      transferId: createStrategyVideoTransferId(),
      ownerUid: state.uid,
      phase: clip.phase,
      round: clip.round,
      createdAt: firebaseNow(),
    }, {
      waitForBuffer: waitForVideoDataBuffer,
      isActive: () => active && state.pendingVideo === clip && state.videoChannel?.readyState === "open",
      onProgress: (progress) => {
        state.videoTransferProgress = progress;
        const output = document.querySelector("#strategyVideoSendProgress");
        if (output) output.textContent = `${progress}%`;
      },
    });
    Object.assign(clip, {
      id: transfer.transferId,
      transferId: transfer.transferId,
      ownerUid: state.uid,
      phase: transfer.phase,
      round: transfer.round,
      createdAt: transfer.createdAt,
    });
    state.pendingVideo = null;
    state.videoClips.push(clip);
    state.videoSentPhases.add(transfer.phase);
    closeStrategyVideoDialog();
    showToast("短尺映像を相手へ一時送信しました。");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "短尺映像を送信できませんでした。チャットと対戦は続けられます。");
  } finally {
    state.videoSending = false;
    state.videoTransferProgress = 0;
    refreshStrategyVideoPanel();
    if (state.pendingVideo && document.querySelector("#strategyVideoDialog")?.open) renderStrategyVideoDialog();
  }
}

function releaseStrategyVideoData() {
  stopStrategyVideoRecording({ discard: true });
  releaseStrategyVideoResources(state.videoClips);
  state.incomingVideoTransfer = null;
  state.videoSentPhases.clear();
  state.videoReceivedPhases.clear();
  state.videoSending = false;
  state.videoTransferProgress = 0;
  closeStrategyVideoDialog();
}

function bindStrategyReviewAssetPanelEvents() {
  document.querySelector("#strategyReviewMediaToggle")?.addEventListener("click", toggleStrategyReviewMediaReceiving);
  document.querySelector("#strategyReviewImageInput")?.addEventListener("change", (event) => prepareStrategyReviewImage(event.target.files?.[0]));
  document.querySelector("#strategyReviewAudioInput")?.addEventListener("change", (event) => prepareStrategyReviewAudio(event.target.files?.[0]));
  document.querySelector("#strategyReviewAudioRecord")?.addEventListener("click", startStrategyReviewAudioRecording);
  document.querySelector("#strategyReviewAudioStop")?.addEventListener("click", () => stopStrategyReviewAudioRecording());
  document.querySelector("#strategyReviewAssetSend")?.addEventListener("click", sendPendingStrategyReviewAsset);
  document.querySelector("#strategyReviewAssetCancel")?.addEventListener("click", discardPendingStrategyReviewAsset);
  document.querySelectorAll("[data-strategy-review-asset-delete]").forEach((button) => button.addEventListener("click", () => deleteStrategyReviewAsset(button.dataset.strategyReviewAssetDelete)));
}

function refreshStrategyReviewAssetPanel() {
  const panel = document.querySelector("#strategyReviewAssetPanel");
  if (!panel || state.screen !== "review") return;
  panel.outerHTML = renderStrategyReviewAssetPanel();
  bindStrategyReviewAssetPanelEvents();
}

function sendStrategyReviewMediaPermission() {
  const message = JSON.stringify({
    type: "strategy-review-media-permission",
    enabled: state.reviewMediaReceiving,
  });
  const channels = new Set([state.reviewAssetChannel, state.videoChannel]);
  channels.forEach((channel) => {
    if (channel?.readyState === "open") channel.send(message);
  });
}

function toggleStrategyReviewMediaReceiving() {
  if (state.screen !== "review" || !strategyReviewIsActive()) return;
  state.reviewMediaReceiving = !state.reviewMediaReceiving;
  if (!state.reviewMediaReceiving) {
    state.incomingReviewAssetTransfer = null;
    state.incomingVideoTransfer = null;
  }
  sendStrategyReviewMediaPermission();
  refreshStrategyReviewAssetPanel();
  refreshStrategyVideoPanel();
  showToast(state.reviewMediaReceiving ? "画像・音声・映像の受信を再開しました。" : "新しい画像・音声・映像の受信を停止しました。");
}

function createPendingStrategyReviewAsset({
  kind,
  blob,
  url,
  duration = 0,
}) {
  if (state.pendingReviewAsset) releaseStrategyReviewAssetResource(state.pendingReviewAsset);
  state.pendingReviewAsset = {
    id: `pending-${kind}-${Date.now()}`,
    transferId: "",
    ownerUid: state.uid,
    phase: "review",
    kind,
    blob,
    url,
    mime: kind === "image" ? "image/webp" : "audio/wav",
    size: Number(blob?.size || 0),
    duration: Number(duration || 0),
    createdAt: firebaseNow(),
    released: false,
  };
  state.reviewAssetTransferProgress = 0;
}

async function prepareStrategyReviewImage(file) {
  if (!file || state.pendingReviewAsset || state.reviewAudioRecording || !strategyReviewIsActive()) return;
  if (strategyReviewAssetCount(state.uid, "image") >= STRATEGY_REVIEW_IMAGE_LIMIT) {
    showToast(`追加画像は1人${STRATEGY_REVIEW_IMAGE_LIMIT}枚までです。`);
    return;
  }
  const generation = state.reviewAssetGeneration;
  setBusy(true, "画像をWebPへ変換しています…");
  let processed = null;
  try {
    const attempts = [
      { maxSide: 1280, quality: 0.82 },
      { maxSide: 1024, quality: 0.77 },
      { maxSide: 800, quality: 0.72 },
    ];
    for (const options of attempts) {
      processed = await shared().processImageFile(file, 0, options);
      if (processed.blob.size <= STRATEGY_REVIEW_IMAGE_MAX_BYTES) break;
      releaseStrategyReviewAssetResource(processed);
      processed = null;
    }
    if (!processed?.blob || processed.blob.size > STRATEGY_REVIEW_IMAGE_MAX_BYTES) {
      throw new Error("画像を約1.5MB以下に変換できませんでした。別の画像を選択してください。");
    }
    if (generation !== state.reviewAssetGeneration || !strategyReviewIsActive()) {
      releaseStrategyReviewAssetResource(processed);
      return;
    }
    createPendingStrategyReviewAsset({
      kind: "image",
      blob: processed.blob,
      url: processed.url,
    });
    processed.released = true;
    processed.blob = null;
    processed.url = "";
    showToast("追加画像を準備しました。内容を確認して送信してください。");
  } catch (error) {
    if (processed?.blob || processed?.url) releaseStrategyReviewAssetResource(processed);
    showToast(error?.message || "追加画像を準備できませんでした。");
  } finally {
    setBusy(false);
    refreshStrategyReviewAssetPanel();
  }
}

async function prepareStrategyReviewAudio(file) {
  if (!file || state.pendingReviewAsset || !strategyReviewIsActive()) return;
  if (strategyReviewAssetCount(state.uid, "audio") >= STRATEGY_REVIEW_AUDIO_LIMIT) {
    showToast(`追加音声は1人${STRATEGY_REVIEW_AUDIO_LIMIT}本までです。`);
    return;
  }
  const generation = state.reviewAssetGeneration;
  setBusy(true, "音声を10秒以下・モノラルWAVへ変換しています…");
  let audio = null;
  try {
    audio = await processStrategyAudioFile(file);
    if (generation !== state.reviewAssetGeneration || !strategyReviewIsActive()) {
      releaseCardAudio(audio);
      return;
    }
    createPendingStrategyReviewAsset({
      kind: "audio",
      blob: audio.audioBlob,
      url: audio.audioUrl,
      duration: audio.audioDuration,
    });
    audio.audioBlob = null;
    audio.audioUrl = "";
    showToast("追加音声を準備しました。試聴してから送信してください。");
  } catch (error) {
    if (audio) releaseCardAudio(audio);
    showToast(error?.message || "追加音声を準備できませんでした。");
  } finally {
    setBusy(false);
    refreshStrategyReviewAssetPanel();
  }
}

function preferredStrategyReviewAudioMime() {
  if (typeof MediaRecorder !== "function" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/webm",
  ].find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || "";
}

function releaseStrategyReviewAudioRecording(recording) {
  if (!recording) return;
  window.clearInterval(recording.clockTimer);
  window.clearTimeout(recording.stopTimer);
  recording.stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch {
      // A track may already be stopped.
    }
  });
  recording.clockTimer = null;
  recording.stopTimer = null;
}

function updateStrategyReviewAudioRecordingClock(recording) {
  if (state.reviewAudioRecording !== recording) return;
  const elapsed = Math.min(MAX_AUDIO_SECONDS, Math.max(0, (performance.now() - recording.startedAt) / 1000));
  const output = document.querySelector("#strategyReviewAudioRecordingTime");
  if (output) output.textContent = `${elapsed.toFixed(1)} / ${MAX_AUDIO_SECONDS.toFixed(1)}秒`;
}

async function startStrategyReviewAudioRecording() {
  if (!strategyReviewIsActive() || state.pendingReviewAsset || state.reviewAudioRecording) return;
  if (!state.reviewAssetChannelReady || !state.opponentReviewMediaReceiving) {
    showToast("相手がメディアを受信できる状態ではありません。");
    return;
  }
  if (strategyReviewAssetCount(state.uid, "audio") >= STRATEGY_REVIEW_AUDIO_LIMIT) {
    showToast(`追加音声は1人${STRATEGY_REVIEW_AUDIO_LIMIT}本までです。`);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== "function") {
    showToast("このブラウザはマイク録音に対応していません。音声ファイルを選択してください。");
    return;
  }
  const generation = state.reviewAssetGeneration;
  let provisionalStream = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1, max: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    provisionalStream = stream;
    if (generation !== state.reviewAssetGeneration || !strategyReviewIsActive()) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const mimeType = preferredStrategyReviewAudioMime();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const recording = {
      recorder,
      stream,
      chunks: [],
      startedAt: performance.now(),
      discarded: false,
      clockTimer: null,
      stopTimer: null,
    };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recording.chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      recording.discarded = true;
      showToast("マイク録音中にエラーが発生しました。");
      if (recorder.state === "recording") recorder.stop();
    }, { once: true });
    recorder.addEventListener("stop", async () => {
      releaseStrategyReviewAudioRecording(recording);
      if (state.reviewAudioRecording === recording) state.reviewAudioRecording = null;
      refreshStrategyReviewAssetPanel();
      if (recording.discarded || generation !== state.reviewAssetGeneration || !strategyReviewIsActive()) return;
      const blob = new Blob(recording.chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (!blob.size) {
        showToast("音声を録音できませんでした。");
        return;
      }
      await prepareStrategyReviewAudio(blob);
    }, { once: true });
    state.reviewAudioRecording = recording;
    recorder.start(250);
    provisionalStream = null;
    recording.clockTimer = window.setInterval(() => updateStrategyReviewAudioRecordingClock(recording), 100);
    recording.stopTimer = window.setTimeout(() => stopStrategyReviewAudioRecording(), MAX_AUDIO_SECONDS * 1000);
    refreshStrategyReviewAssetPanel();
    updateStrategyReviewAudioRecordingClock(recording);
  } catch (error) {
    provisionalStream?.getTracks?.().forEach((track) => track.stop());
    if (state.reviewAudioRecording?.stream === provisionalStream) state.reviewAudioRecording = null;
    showToast(error?.name === "NotAllowedError" ? "マイクの使用が許可されませんでした。" : error?.message || "マイク録音を開始できませんでした。");
  }
}

function stopStrategyReviewAudioRecording({ discard = false } = {}) {
  const recording = state.reviewAudioRecording;
  if (!recording) return;
  if (discard) recording.discarded = true;
  window.clearTimeout(recording.stopTimer);
  if (recording.recorder?.state === "recording") recording.recorder.stop();
  else {
    releaseStrategyReviewAudioRecording(recording);
    if (state.reviewAudioRecording === recording) state.reviewAudioRecording = null;
  }
}

function discardPendingStrategyReviewAsset() {
  if (state.reviewAssetSending || !state.pendingReviewAsset) return;
  releaseStrategyReviewAssetResource(state.pendingReviewAsset);
  state.pendingReviewAsset = null;
  state.reviewAssetTransferProgress = 0;
  refreshStrategyReviewAssetPanel();
}

function waitForStrategyReviewAssetBuffer(channel) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("品評会メディアのP2P接続が切れました。"));
  if (channel.bufferedAmount <= DATA_BUFFER_LIMIT) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => done(new Error("品評会メディア転送の待機時間を超えました。")), 10_000);
    const done = (error) => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onLow = () => done();
    const onClose = () => done(new Error("品評会メディアのP2P接続が切れました。"));
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

async function sendPendingStrategyReviewAsset() {
  const asset = state.pendingReviewAsset;
  if (!asset || state.reviewAssetSending) return;
  const limit = strategyReviewAssetLimit(asset.kind);
  if (strategyReviewAssetCount(state.uid, asset.kind) >= limit) {
    showToast(asset.kind === "image" ? `追加画像は1人${limit}枚までです。` : `追加音声は1人${limit}本までです。`);
    return;
  }
  if (!strategyReviewIsActive() || !state.reviewAssetChannelReady || !state.opponentReviewMediaReceiving) {
    showToast("品評会メディアを送信できる状態ではありません。");
    return;
  }
  state.reviewAssetSending = true;
  state.reviewAssetTransferProgress = 0;
  refreshStrategyReviewAssetPanel();
  try {
    const transfer = await sendStrategyReviewAsset(state.reviewAssetChannel, asset, {
      transferId: createStrategyReviewAssetTransferId(),
      ownerUid: state.uid,
      createdAt: firebaseNow(),
    }, {
      waitForBuffer: waitForStrategyReviewAssetBuffer,
      isActive: () => active
        && strategyReviewIsActive()
        && state.pendingReviewAsset === asset
        && state.opponentReviewMediaReceiving
        && state.reviewAssetChannel?.readyState === "open",
      onProgress: (progress) => {
        state.reviewAssetTransferProgress = progress;
        const output = document.querySelector("#strategyReviewAssetProgress");
        if (output) output.textContent = `${progress}%`;
      },
    });
    Object.assign(asset, {
      id: transfer.transferId,
      transferId: transfer.transferId,
      ownerUid: state.uid,
      createdAt: transfer.createdAt,
      duration: transfer.duration,
      size: transfer.size,
    });
    state.pendingReviewAsset = null;
    state.reviewAssets.push(asset);
    state.reviewAssetSentCounts[asset.kind] += 1;
    if (asset.kind === "image") completeHariaiTribute().catch(handleRecoverableError);
    showToast(asset.kind === "image" ? "追加画像を相手へ一時送信しました。" : "追加音声を相手へ一時送信しました。");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "品評会メディアを送信できませんでした。チャットは続けられます。");
  } finally {
    state.reviewAssetSending = false;
    state.reviewAssetTransferProgress = 0;
    refreshStrategyReviewAssetPanel();
  }
}

function deleteStrategyReviewAsset(assetId) {
  const index = state.reviewAssets.findIndex((asset) => asset.id === assetId);
  if (index < 0) return;
  releaseStrategyReviewAssetResource(state.reviewAssets[index]);
  state.reviewAssets.splice(index, 1);
  refreshStrategyReviewAssetPanel();
}

function releaseStrategyReviewAssetData() {
  state.reviewAssetGeneration += 1;
  stopStrategyReviewAudioRecording({ discard: true });
  if (state.pendingReviewAsset) releaseStrategyReviewAssetResource(state.pendingReviewAsset);
  state.pendingReviewAsset = null;
  releaseStrategyReviewAssetResources(state.reviewAssets);
  state.incomingReviewAssetTransfer = null;
  state.reviewAssetSending = false;
  state.reviewAssetTransferProgress = 0;
  state.reviewAssetSentCounts = { image: 0, audio: 0 };
  state.reviewAssetReceivedCounts = { image: 0, audio: 0 };
}

function openPreparedDeck() {
  if (state.normalRouteBusy) return;
  if (state.deckRestoreStatus === "loading") {
    showToast("前回デッキの確認が終わるまでお待ちください。");
    return;
  }
  if (state.screen === "profile") syncStrategyProfileDraft();
  state.screen = "preDeck";
  setStrategyChrome("STRATEGY DECK PREP");
  render();
}

function returnToStrategyProfile() {
  if (state.normalRouteBusy) return;
  state.screen = "profile";
  setStrategyChrome("STRATEGY READY");
  render();
}

function completePreparedDeck() {
  if (state.deckRestoreStatus === "loading" || state.normalRouteBusy) return;
  if (!strategyDeckIsComplete()) {
    showToast("戦略型はメイン5枚とリザーブ5枚の実画像が必要です。");
    return;
  }
  persistCompleteStrategyDeck({ announceSuccess: state.persistDeck }).catch(handleRecoverableError);
  state.screen = "profile";
  setStrategyChrome("STRATEGY READY");
  render();
}

async function loadSavedPreparedDeck() {
  if ((!state.storedDeckAvailable && state.deckRestoreStatus !== "load-error") || strategyDeckStorageBusy()) return;
  if ((state.main.length || state.reserve.length)
      && !window.confirm("編集中の戦略デッキを、端末保存した前回の10枚で置き換えますか？")) return;
  await restoreStoredStrategyDeck({ force: true });
}

function syncStrategyProfileDraft() {
  const nameInput = document.querySelector("#strategyName");
  if (nameInput) state.name = nameInput.value.slice(0, 16);
  const clueInputs = [...document.querySelectorAll(".strategy-clue-input")];
  if (clueInputs.length === 3) state.clues = clueInputs.map((input) => input.value.slice(0, 80));
  const weakness = document.querySelector('input[name="weakness"]:checked');
  if (weakness) state.weaknessIndex = Number(weakness.value);
  const imagePreference = document.querySelector('input[name="strategyImagePreference"]:checked');
  if (imagePreference) state.imagePreference = normalizeImagePreference(imagePreference.value, "");
  const personaType = document.querySelector('input[name="strategyPersonaType"]:checked')?.value;
  state.persona = normalizeHariaiPersona({
    type: personaType || state.persona.type,
    firstPerson: document.querySelector("#strategyFirstPerson")?.value || state.persona.firstPerson,
    callStyle: document.querySelector("#strategyCallStyle")?.value || state.persona.callStyle,
  });
  const call = document.querySelector("#strategyPenaltyCall");
  const tribute = document.querySelector("#strategyPenaltyTribute");
  if (call || tribute) state.penaltyConsent = normalizeHariaiPenaltyConsent({ call: call?.checked, tribute: tribute?.checked });
}

function strategyMatchmakingLaunchIsCurrent(context, { requireProfile = true } = {}) {
  return Boolean(
    context
    && active
    && state === context.expectedState
    && context.expectedState.matchmakingLaunchGeneration === context.generation
    && !context.expectedState.normalRouteBusy
    && (!requireProfile || (
      context.expectedState.screen === "profile"
      && context.expectedState.deckRestoreStatus !== "loading"
      && strategyDeckIsComplete()
    )),
  );
}

function finishStrategyMatchmakingLaunch(context) {
  if (!context
      || state !== context.expectedState
      || context.expectedState.matchmakingLaunchGeneration !== context.generation) return;
  context.expectedState.matchmakingLaunchBusy = false;
  if (active && context.expectedState.screen === "profile") updateStrategyCrownMatchmakingActions();
}

async function saveProfile(event) {
  event.preventDefault();
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("前の通信の終了を確認しています。少し待ってからお試しください。");
  if (state.matchmakingLaunchBusy) return;
  if (state.normalRouteBusy) return;
  const crownIntent = event.submitter?.dataset.crownMatchmakingAction === "start";
  const name = document.querySelector("#strategyName")?.value.trim().slice(0, 16) || "";
  const clues = [...document.querySelectorAll(".strategy-clue-input")].map((input) => input.value.trim());
  const weakness = document.querySelector('input[name="weakness"]:checked');
  const imagePreference = normalizeImagePreference(document.querySelector('input[name="strategyImagePreference"]:checked')?.value, "");
  syncStrategyProfileDraft();
  if (!state.authReady || !state.uid) return showToast("Firebaseへの接続完了を待ってください。");
  if (!name || clues.some((clue) => !clue) || !weakness || !imagePreference) return showToast("なりきり名、採点傾向、3つの弱点候補、本当の弱点1つをすべて入力してください。");
  if (!hariaiPersonaIsComplete(state.persona)) return showToast("なりきりペルソナのキャラ型を選んでください。");
  if (state.deckRestoreStatus === "loading") return showToast("前回デッキの確認が終わるまでお待ちください。");
  if (!strategyDeckIsComplete()) return showToast("戦略型はマッチング前に実画像10枚が必要です。");
  state.name = name;
  state.clues = normalizeClues(clues);
  state.weaknessIndex = Number(weakness.value);
  state.imagePreference = imagePreference;
  localStorage.setItem(PROFILE_NAME_KEY, state.name);
  localStorage.setItem(PROFILE_CLUES_KEY, JSON.stringify(state.clues));
  localStorage.setItem(PROFILE_WEAKNESS_KEY, String(state.weaknessIndex));
  localStorage.setItem(PROFILE_PERSONA_KEY, JSON.stringify(state.persona));
  localStorage.setItem(PROFILE_PENALTY_KEY, JSON.stringify(state.penaltyConsent));
  localStorage.setItem(PROFILE_IMAGE_PREFERENCE_KEY, state.imagePreference);
  window.HariaiAudio?.playButton?.("confirm");
  const expectedState = state;
  const context = {
    crownIntent,
    expectedState,
    generation: expectedState.matchmakingLaunchGeneration + 1,
  };
  expectedState.matchmakingLaunchGeneration = context.generation;
  expectedState.matchmakingLaunchBusy = true;
  updateStrategyCrownMatchmakingActions();
  persistCompleteStrategyDeck().catch(handleRecoverableError);
  let crownReady = !crownIntent;
  try {
    if (crownIntent) {
      const startRun = window.HariaiOnline?.startCrownRun;
      if (typeof startRun !== "function") throw new Error("三戦証明を準備できませんでした。");
      await startRun();
      if (!strategyMatchmakingLaunchIsCurrent(context)) return;
      const crownState = window.HariaiOnline?.getCrownMatchmakingState?.("strategy");
      if (!["active", "complete"].includes(crownState?.phase)) {
        throw new Error("三戦証明の開始状態を確認できませんでした。");
      }
      crownReady = true;
      showToast(crownState.phase === "complete"
        ? "本日の三戦証明は完了済みです。通常対戦を探します。"
        : "三戦証明を開始しました。次の正式対戦から記録します。");
    }
    if (!strategyMatchmakingLaunchIsCurrent(context)) return;
    await beginMatchmaking();
  } catch (error) {
    if (!strategyMatchmakingLaunchIsCurrent(context, { requireProfile: false })) return;
    if (context.expectedState.screen === "matching" && !context.expectedState.roomId) {
      await cancelMatching();
    } else if (context.expectedState.screen !== "profile") {
      return;
    }
    console.error(error);
    showToast(crownIntent && !crownReady
      ? (error?.message || "三戦証明を開始できませんでした。通常対戦は開始していません。")
      : (error?.message || "対戦相手を探せませんでした。もう一度お試しください。"));
  } finally {
    finishStrategyMatchmakingLaunch(context);
  }
}

function strategySearchProgressBlocked(targetState = state) {
  return Boolean(targetState.idleCleanupPending || targetState.idleStopped
    || targetState.searchIdleGuard?.blocksProgress());
}

function startStrategySearchIdleGuard(targetState, generation) {
  targetState.searchIdleGuard?.dispose();
  targetState.searchIdleGuard = createStrategyHiddenSearchGuard({
    getContext: () => ({
      current: strategyQueueContextIsCurrent(targetState, generation),
      visible: document.visibilityState !== "hidden",
      busy: targetState.searchInitializing || targetState.matchingBusy || targetState.acceptingOffer
        || Boolean(targetState.queueRecoveryPromise),
    }),
    stop: () => stopStrategyIdleSearch(targetState, generation),
  });
  targetState.searchIdleGuard.sync();
}

async function stopStrategyIdleSearch(targetState, generation) {
  const current = () => strategyQueueContextIsCurrent(targetState, generation);
  if (!current() || targetState.searchInitializing || targetState.matchingBusy || targetState.acceptingOffer
      || targetState.queueRecoveryPromise) return 1000;
  targetState.idleCleanupPending = true;
  updateStrategyIdleNotice();
  const result = await requestSafety("strategy_stop_waiting", {
    protocolVersion: STRATEGY_PROTOCOL_VERSION, joinedAt: targetState.queueJoinedAt,
  });
  if (!current()) return;
  if (result.stopped === true || result.status === "resource-changed") {
    targetState.idleStopReason = result.stopped === true
      ? "ページが5分間表示されなかったため、相手検索を終了しました。デッキとプロフィールは保持しています。再開するときは、あらためて相手を探してください。"
      : "別の検索が開始されたため、この画面の相手検索を終了しました。";
    await cleanupMatchmaking(true, { targetState, skipServerWrites: true });
    await cleanupPublicPresence(targetState);
    if (!active || state !== targetState || targetState.roomId) return;
    targetState.idleCleanupPending = false;
    targetState.screen = "profile";
    setStrategyChrome("STRATEGY READY");
    render();
    return;
  }
  if (result.status === "match-in-progress" && result.roomId) {
    // A match which won the server race belongs to the pre-start deadline, not
    // to search cancellation. Existing offers must still be able to reconcile.
    targetState.idleCleanupPending = false;
    if (result.roomStatus === "active") {
      await safetyPlayerRoomRecord(result.roomId);
      if (current()) await enterRoom(result.roomId, generation);
    } else if (result.roomStatus === "offered") {
      const snapshot = await get(ref(database, `online/strategyRooms/${result.roomId}`));
      if (!current()) return;
      const room = snapshot.val();
      if (Number(room?.queueJoinedAt?.[targetState.uid]) !== targetState.queueJoinedAt) return 20_000;
      if (room.hostUid === targetState.uid) {
        targetState.pendingOffer = { roomId: result.roomId, targetUid: room.guestUid };
        if (targetState.hostOfferWatch?.roomId !== result.roomId) watchStrategyOffer(result.roomId, targetState, generation);
      } else if (room.guestUid === targetState.uid) {
        targetState.pendingIncomingOffer = { roomId: result.roomId,
          offer: { toUid: targetState.uid, fromUid: room.hostUid, protocolVersion: STRATEGY_PROTOCOL_VERSION } };
        await drainIncomingOffers();
      }
    }
    return 20_000;
  }
  // A lock conflict, malformed response or lost response never permits another
  // search and never falls back to unconditional release/destroy.
  return 20_000;
}

function strategyIdleRoomIsCurrent(targetState, roomId) {
  return active && state === targetState && targetState.roomId === roomId && !targetState.idleStopped;
}

function stopStrategyPrestartGuard(targetState = state) {
  targetState.prestartGuard?.dispose();
  targetState.prestartGuard = null;
  window.clearInterval(targetState.prestartClockTimer);
  targetState.prestartClockTimer = null;
}

function startStrategyPrestartGuard(targetState, roomId) {
  stopStrategyPrestartGuard(targetState);
  if (!(Number(targetState.roomData?.prestartDeadlineAt) > 0) || strategyRoomHasStarted(targetState.roomData)) return;
  targetState.prestartGuard = createStrategyPrestartGuard({
    now: () => Date.now() + targetState.serverTimeOffset,
    getContext: () => ({ current: strategyIdleRoomIsCurrent(targetState, roomId),
      protected: strategyRoomHasStarted(targetState.roomData),
      deadline: targetState.roomData?.prestartDeadlineAt,
      busy: Boolean(targetState.prestartConfirmPromise),
    }),
    stop: () => confirmStrategyPrestartExpiry(targetState, roomId),
  });
  targetState.prestartClockTimer = window.setInterval(() => {
    if (!strategyIdleRoomIsCurrent(targetState, roomId)) { stopStrategyPrestartGuard(targetState); return; }
    targetState.prestartGuard?.sync();
    if (strategyRoomHasStarted(targetState.roomData)) stopStrategyPrestartGuard(targetState);
    updateStrategyIdleNotice();
  }, 1000);
  targetState.prestartGuard.sync();
}

async function confirmStrategyPrestartExpiry(targetState, roomId) {
  if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
  if (targetState.prestartConfirmPromise) return targetState.prestartConfirmPromise;
  targetState.idleCleanupPending = true;
  updateStrategyIdleNotice();
  const operation = (async () => {
    const result = await requestSafety("strategy_expire_prestart", { protocolVersion: STRATEGY_PROTOCOL_VERSION, roomId });
    if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
    if (result.roomId !== roomId) return 20_000;
    if (result.expired === true || ["ended", "missing"].includes(result.status)) {
      await finishStrategyPrestartExpiry(targetState, roomId, result.reason === "prestart-timeout" || result.expired === true);
      return;
    }
    if (["protected", "legacy"].includes(result.status)) {
      targetState.idleCleanupPending = false;
      stopStrategyPrestartGuard(targetState);
      updateStrategyIdleNotice();
      return;
    }
    if (result.status === "pending" && Number(result.prestartDeadlineAt) > 0) {
      targetState.roomData.prestartDeadlineAt = Number(result.prestartDeadlineAt);
      targetState.idleCleanupPending = false;
      updateStrategyIdleNotice();
      return Math.max(1000, Number(result.prestartDeadlineAt) - (Date.now() + targetState.serverTimeOffset));
    }
    return 20_000;
  })();
  targetState.prestartConfirmPromise = operation;
  try { return await operation; }
  finally { if (targetState.prestartConfirmPromise === operation) targetState.prestartConfirmPromise = null; }
}

async function finishStrategyPrestartExpiry(targetState, roomId, timedOut = true) {
  if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
  targetState.idleStopped = true;
  targetState.idleCleanupPending = true;
  targetState.idleStopReason = timedOut
    ? "マッチング成立から5分以内に双方の貼り合い開始が揃わなかったため、この対戦を終了しました。勝敗・RATE・Payには影響しません。デッキとプロフィールを保持したまま、別の相手を探せます。"
    : "開始前の対戦が終了しました。デッキとプロフィールを保持したまま、別の相手を探せます。";
  stopStrategyPrestartGuard(targetState);
  const cleanup = cleanupOnlineResources(true, { targetState, skipServerWrites: true });
  targetState.idleCleanupPromise = cleanup;
  try { await cleanup; }
  finally { if (targetState.idleCleanupPromise === cleanup) targetState.idleCleanupPromise = null; }
  if (!active || state !== targetState || targetState.roomId !== roomId) return;
  releaseMatchMedia();
  targetState.idleCleanupPending = false;
  targetState.screen = "noContest";
  setStrategyChrome("NO CONTEST");
  render();
}

function strategyPrestartProgressBlocked() {
  return Boolean(state.idleStopped || state.idleCleanupPending || state.prestartGuard?.blocksProgress());
}

function renderStrategyIdleNotice() {
  if (state.screen === "profile" && state.idleStopReason) return `<p class="privacy-note" role="status">${escapeHtml(state.idleStopReason)}</p>`;
  if (state.screen === "matching") return '<p class="privacy-note" id="strategyIdleNotice" role="status">ページを5分間表示しないと、相手検索を終了します。</p>';
  if (state.roomId && !state.idleStopped && Number(state.roomData?.prestartDeadlineAt) > 0 && !strategyRoomHasStarted(state.roomData)) {
    return '<p class="privacy-note" id="strategyIdleNotice" role="status"></p>';
  }
  return "";
}

function updateStrategyIdleNotice() {
  if (!active) return;
  const notice = document.getElementById("strategyIdleNotice");
  if (!notice) return;
  if (state.idleCleanupPending) notice.textContent = "通信を終了できるか確認しています。完了するまで、新しい検索や対戦開始は行いません。";
  else if (state.screen === "matching") notice.textContent = "ページを5分間表示しないと、相手検索を終了します。";
  else if (strategyRoomHasStarted(state.roomData)) notice.textContent = "";
  else {
    const seconds = Math.max(0, Math.ceil((Number(state.roomData?.prestartDeadlineAt) - firebaseNow()) / 1000));
    notice.textContent = `成立から5分以内に、双方の「貼り合い開始」まで進んでください。開始期限まで ${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒。期限を過ぎると勝敗なしで終了します。`;
  }
}

function isCurrentStrategyMatchmakingGeneration(generation) {
  return active
    && state.screen === "matching"
    && state.matchmakingGeneration === generation
    && !state.roomId;
}

async function removeStrategyQueueEntryIfCurrent(queueEntryRef, joinedAt) {
  await runTransaction(queueEntryRef, (current) => {
    // An unsubscribed path can have a cold SDK cache even when the server row
    // exists. A null no-op reconciles that cache; undefined would abort locally.
    if (current === null) return null;
    return Number(current.joinedAt) === Number(joinedAt) ? null : undefined;
  }).catch(() => {});
}

function strategyQueueContextIsCurrent(targetState, generation, connectionEpoch) {
  return state === targetState && isCurrentStrategyMatchmakingGeneration(generation)
    && (connectionEpoch === undefined || (targetState.matchmakingConnected
      && targetState.queueConnectionEpoch === connectionEpoch));
}

function queueStrategyDisconnectOperation(operation) {
  const pending = strategyQueueDisconnectOperations.catch(() => {}).then(operation);
  strategyQueueDisconnectOperations = pending;
  return pending;
}

function armStrategyQueueDisconnect(queueRef, targetState, generation, connectionEpoch) {
  return queueStrategyDisconnectOperation(async () => {
    if (!strategyQueueContextIsCurrent(targetState, generation, connectionEpoch)) return false;
    const disconnect = onDisconnect(queueRef);
    await disconnect.remove();
    if (!strategyQueueContextIsCurrent(targetState, generation, connectionEpoch)) {
      await disconnect.cancel().catch(() => {});
      return false;
    }
    targetState.queueDisconnect = disconnect;
    return true;
  });
}

async function refreshStrategyMatchmakingQueue(targetState, generation) {
  if (!strategyQueueContextIsCurrent(targetState, generation) || !targetState.matchmakingConnected) return false;
  if (strategySearchProgressBlocked(targetState)) return false;
  if (targetState.queueRecoveryPromise) {
    const pendingEpoch = targetState.queueRecoveryEpoch;
    const result = await targetState.queueRecoveryPromise;
    if (strategyQueueContextIsCurrent(targetState, generation) && targetState.matchmakingConnected
        && pendingEpoch !== targetState.queueConnectionEpoch) return refreshStrategyMatchmakingQueue(targetState, generation);
    return result;
  }
  const connectionEpoch = targetState.queueConnectionEpoch;
  const joinedAt = targetState.queueJoinedAt;
  const current = () => strategyQueueContextIsCurrent(targetState, generation, connectionEpoch)
    && !strategySearchProgressBlocked(targetState);
  const queueRef = ref(database, `online/strategyQueue/${targetState.uid}`);
  const activeRef = ref(database, `online/strategyActive/${targetState.uid}`);
  const recovery = (async () => {
    const [queueSnapshot, activeSnapshot] = await Promise.all([get(queueRef), get(activeRef)]);
    if (!current()) return false;
    const queue = queueSnapshot.val();
    // A different attempt may own this UID now. Never replace its queue entry.
    if (queue && Number(queue.joinedAt) !== joinedAt) return false;
    // Acceptance removes the queue before the client enters the room. Recreating
    // it here would race that transition; the offer/room listener owns recovery.
    if (activeSnapshot.exists()) return false;
    if (!queue && (targetState.pendingOffer || targetState.acceptingOffer || targetState.matchingBusy)) return false;
    if (!targetState.queueDisconnect) {
      if (!await armStrategyQueueDisconnect(queueRef, targetState, generation, connectionEpoch)) return false;
    }
    const result = await runTransaction(queueRef, (value) => {
      if (!current()) return;
      if (value) {
        if (Number(value.joinedAt) !== joinedAt || value.uid !== targetState.uid) return;
        // Preserve offering-v2 and roomId when the server reserves this queue.
        return { ...value, lastSeen: Date.now() };
      }
      if (activeSnapshot.exists() || targetState.pendingOffer || targetState.acceptingOffer || targetState.matchingBusy) return;
      return {
        protocolVersion: STRATEGY_PROTOCOL_VERSION,
        uid: targetState.uid,
        ratingPreference: targetState.imagePreference,
        allowPreferenceMismatch: targetState.matchScopeExpanded,
        joinedAt,
        lastSeen: Date.now(),
        state: STRATEGY_QUEUE_WAITING_STATE,
      };
    }, { applyLocally: false });
    if (!current()) {
      if (!strategyQueueContextIsCurrent(targetState, generation)) {
        await removeStrategyQueueEntryIfCurrent(queueRef, joinedAt);
      }
      return false;
    }
    if (!result.committed) return false;
    // A remote acceptance can still win after the preflight read. Matching on
    // the server checks strategyActive before considering this queue, and the
    // existing offer/room path removes our entry when it enters the active room.
    targetState.latestQueue = { [targetState.uid]: result.snapshot.val() };
    return true;
  })();
  targetState.queueRecoveryPromise = recovery;
  targetState.queueRecoveryEpoch = connectionEpoch;
  try {
    return await recovery;
  } finally {
    if (targetState.queueRecoveryPromise === recovery) targetState.queueRecoveryPromise = null;
  }
}

function watchStrategyMatchmakingConnection(targetState, generation) {
  targetState.matchUnsubscribers.push(onValue(ref(database, ".info/connected"), (snapshot) => {
    if (!strategyQueueContextIsCurrent(targetState, generation)) return;
    const connected = snapshot.val() === true;
    if (targetState.matchmakingConnected === connected) return;
    targetState.matchmakingConnected = connected;
    targetState.queueConnectionEpoch += 1;
    if (!connected) {
      // onDisconnect registrations run once; the next connection needs its own.
      targetState.queueDisconnect = null;
      return;
    }
    refreshStrategyMatchmakingQueue(targetState, generation)
      .then(() => { if (strategyQueueContextIsCurrent(targetState, generation)) return attemptToHost(); })
      .catch((error) => { if (strategyQueueContextIsCurrent(targetState, generation)) handleRecoverableError(error); });
  }, (error) => { if (strategyQueueContextIsCurrent(targetState, generation)) handleRecoverableError(error); }));
}

async function beginMatchmaking() {
  if (state.idleCleanupPending || state.idleCleanupPromise) throw new Error("前の通信の終了確認が完了するまでお待ちください。");
  if (state.normalRouteBusy) throw new Error("通常1on1へ切り替えています。");
  state.imagePreference = normalizeImagePreference(state.imagePreference, "");
  if (state.deckRestoreStatus === "loading" || !strategyDeckIsComplete()) {
    throw new Error("戦略型はメイン5枚とリザーブ5枚の実画像を準備してから開始してください。");
  }
  if (!state.uid || !state.imagePreference) return;
  const joinedAt = Date.now();
  const generation = ++strategyMatchmakingGenerationCounter;
  const targetState = state;
  state.matchmakingGeneration = generation;
  state.idleStopped = false;
  state.idleStopReason = "";
  state.searchInitializing = true;
  state.queueJoinedAt = joinedAt;
  state.matchScopeAvailable = false;
  state.matchScopeExpanded = false;
  state.screen = "matching";
  setStrategyChrome("STRATEGY MATCHING");
  render();
  startStrategySearchIdleGuard(targetState, generation);
  try {
  const activeRef = ref(database, `online/strategyActive/${state.uid}`);
  const staleActive = await get(activeRef);
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  if (staleActive.exists()) await remove(activeRef);
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  const offersRef = ref(database, `online/strategyOffers/${state.uid}`);
  const staleOffers = await get(offersRef);
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  if (staleOffers.exists()) {
    await Promise.allSettled(Object.keys(staleOffers.val()).map((roomId) => (
      remove(ref(database, `online/strategyOffers/${state.uid}/${roomId}`))
    )));
  }
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  const queueEntryRef = ref(database, `online/strategyQueue/${state.uid}`);
  await set(queueEntryRef, {
    protocolVersion: STRATEGY_PROTOCOL_VERSION,
    uid: state.uid,
    ratingPreference: state.imagePreference,
    allowPreferenceMismatch: false,
    joinedAt,
    lastSeen: joinedAt,
    state: STRATEGY_QUEUE_WAITING_STATE,
  });
  if (!isCurrentStrategyMatchmakingGeneration(generation)) {
    await removeStrategyQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  const presenceStarted = await startPublicPresence(generation);
  if (!presenceStarted || !isCurrentStrategyMatchmakingGeneration(generation)) {
    await removeStrategyQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  if (!await armStrategyQueueDisconnect(queueEntryRef, targetState, generation)) {
    await removeStrategyQueueEntryIfCurrent(queueEntryRef, joinedAt);
    return;
  }
  if (state.imagePreference !== "both") {
    state.matchScopeTimer = window.setTimeout(() => {
      if (!isCurrentStrategyMatchmakingGeneration(generation) || state.matchScopeExpanded) return;
      state.matchScopeAvailable = true;
      render();
    }, MATCH_SCOPE_EXPAND_DELAY_MS);
  }
  state.queueHeartbeat = window.setInterval(() => {
    refreshStrategyMatchmakingQueue(targetState, generation)
      .then(() => { if (strategyQueueContextIsCurrent(targetState, generation)) return attemptToHost(); })
      .catch((error) => { if (strategyQueueContextIsCurrent(targetState, generation)) handleRecoverableError(error); });
  }, HEARTBEAT_MS);
  state.matchUnsubscribers.push(onValue(offersRef, (snapshot) => {
    if (strategyQueueContextIsCurrent(targetState, generation)) processIncomingOffers(snapshot);
  }, handleRecoverableError));
  state.offerPollTimer = window.setInterval(() => {
    if (!strategyQueueContextIsCurrent(targetState, generation)) return;
    if (strategySearchProgressBlocked(targetState)) return;
    get(offersRef).then((snapshot) => {
      if (strategyQueueContextIsCurrent(targetState, generation)) processIncomingOffers(snapshot);
    }).catch(handleRecoverableError);
  }, 1500);
  state.matchUnsubscribers.push(onValue(queueEntryRef, (snapshot) => {
    if (!strategyQueueContextIsCurrent(targetState, generation)) return;
    state.latestQueue = snapshot.exists() ? { [state.uid]: snapshot.val() } : {};
    attemptToHost().catch(handleRecoverableError);
  }));
  watchStrategyMatchmakingConnection(targetState, generation);
  } finally {
    targetState.searchInitializing = false;
    targetState.searchIdleGuard?.sync();
  }
}

function processIncomingOffers(snapshot) {
  const offers = snapshot.val() || {};
  const newest = Object.entries(offers)
    .filter(([, offer]) => Number(offer?.protocolVersion) === STRATEGY_PROTOCOL_VERSION)
    .sort(([, a], [, b]) => Number(b.createdAt) - Number(a.createdAt))[0];
  state.pendingIncomingOffer = newest ? { roomId: newest[0], offer: newest[1] } : null;
  drainIncomingOffers().catch(handleRecoverableError);
}

async function expandMatchmakingScope() {
  if (!active || state.screen !== "matching" || state.roomId || state.imagePreference === "both" || state.matchScopeExpanded) return;
  if (strategySearchProgressBlocked()) return;
  window.clearTimeout(state.matchScopeTimer);
  state.matchScopeTimer = null;
  state.matchScopeAvailable = false;
  state.matchScopeExpanded = true;
  render();
  const lastSeen = Date.now();
  try {
    await update(ref(database, `online/strategyQueue/${state.uid}`), {
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
  } catch {
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

async function attemptToHost() {
  if (!active || state.screen !== "matching" || state.matchingBusy || state.acceptingOffer || state.pendingOffer || state.queueRecoveryPromise) return;
  if (strategySearchProgressBlocked()) return;
  await createOffer();
}

async function safetyPlayerRoomRecord(roomId) {
  state.safetyPlayerRecords ||= new Map();
  const cached = state.safetyPlayerRecords.get(roomId);
  if (cached) {
    state.weaknessSalts = [...cached.salts];
    state.weaknessCommits = [...cached.player.weaknessCommits];
    return cached.player;
  }
  const player = await playerRoomRecord(roomId);
  state.safetyPlayerRecords.set(roomId, { player, salts: [...state.weaknessSalts] });
  return player;
}

function stopStrategyOfferWatch(watch) {
  if (!watch) return;
  watch.stopped = true;
  watch.unsubscribe?.();
  watch.unsubscribe = null;
  window.clearInterval(watch.pollTimer);
  window.clearTimeout(watch.expireTimer);
  watch.pollTimer = null;
  watch.expireTimer = null;
}

function strategyOfferWatchIsCurrent(watch) {
  return watch && strategyQueueContextIsCurrent(watch.targetState, watch.generation)
    && watch.targetState.hostOfferWatch === watch
    && watch.targetState.pendingOffer?.roomId === watch.roomId;
}

function finishStrategyOffer(watch) {
  if (!strategyOfferWatchIsCurrent(watch)) return;
  stopStrategyOfferWatch(watch);
  watch.targetState.hostOfferWatch = null;
  watch.targetState.pendingOffer = null;
  watch.targetState.safetyProposal = null;
}

function watchStrategyOffer(roomId, targetState, generation) {
  stopStrategyOfferWatch(targetState.hostOfferWatch);
  const watch = { roomId, targetState, generation, stopped: false, entering: false,
    unsubscribe: null, pollTimer: null, expireTimer: null, reconciliation: null };
  targetState.hostOfferWatch = watch;
  const statusRef = ref(database, `online/strategyRooms/${roomId}/status`);
  const current = () => strategyOfferWatchIsCurrent(watch) && !watch.stopped;
  const handleStatus = async (snapshot) => {
    if (!current()) return;
    if (["expired", "closed", "blocked"].includes(snapshot.val())) {
      finishStrategyOffer(watch);
    } else if (snapshot.val() === "active" && !watch.entering) {
      watch.entering = true;
      try {
        await safetyPlayerRoomRecord(roomId);
        if (current()) await enterRoom(roomId, generation);
      } finally {
        watch.entering = false;
      }
    }
  };
  const handleError = (error) => {
    if (!current()) return;
    const permissionDenied = /permission[_ -]denied/i.test(`${error?.code || ""} ${error?.message || ""}`);
    if (permissionDenied) {
      // A revoked offer grant intentionally makes status unreadable. Confirm the
      // terminal state through the server; an active room/read failure must surface.
      expireOffer(roomId).catch((failure) => {
        if (strategyQueueContextIsCurrent(targetState, generation)) handleRecoverableError(failure);
      });
    } else {
      handleRecoverableError(error);
    }
  };
  watch.pollTimer = window.setInterval(() => {
    if (current()) get(statusRef).then(handleStatus).catch(handleError);
  }, 1500);
  watch.expireTimer = window.setTimeout(() => {
    if (current()) expireOffer(roomId).catch((error) => {
      if (strategyQueueContextIsCurrent(targetState, generation)) handleRecoverableError(error);
    });
  }, MATCH_TIMEOUT_MS);
  const unsubscribe = onValue(statusRef, (snapshot) => handleStatus(snapshot).catch(handleError), handleError);
  if (watch.stopped) unsubscribe();
  else watch.unsubscribe = unsubscribe;
}

async function createOffer() {
  if (strategySearchProgressBlocked()) return;
  const generation = state.matchmakingGeneration;
  const targetState = state;
  state.matchingBusy = true;
  if (state.safetyProposal?.generation !== generation) {
    state.safetyProposal = { generation, roomId: push(ref(database, "online/strategyRooms")).key };
  }
  const proposedRoomId = state.safetyProposal.roomId;
  try {
    const player = await safetyPlayerRoomRecord(proposedRoomId);
    if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
    if (strategySearchProgressBlocked(targetState)) return;
    const response = await requestSafety("strategy_match", { roomId: proposedRoomId, player, protocolVersion: STRATEGY_PROTOCOL_VERSION });
    const roomId = response.roomId;
    if (!isCurrentStrategyMatchmakingGeneration(generation)) {
      if (roomId) requestSafety("strategy_expire", { roomId }).catch(() => {});
      return;
    }
    if (!roomId || response.status === "waiting") return;
    if (response.status === "active") {
      await safetyPlayerRoomRecord(roomId);
      await enterRoom(roomId, generation);
      return;
    }
    if (response.status === "joined") {
      state.pendingIncomingOffer = { roomId, offer: { toUid: state.uid, fromUid: response.opponentUid, protocolVersion: STRATEGY_PROTOCOL_VERSION } };
      return;
    }
    if (response.status !== "hosted") return;
    state.pendingOffer = { roomId, targetUid: response.opponentUid };
    watchStrategyOffer(roomId, targetState, generation);
  } finally {
    if (state === targetState) {
      state.matchingBusy = false;
      drainIncomingOffers().catch(handleRecoverableError);
    }
  }
}

async function expireOffer(roomId) {
  if (state.roomId || state.pendingOffer?.roomId !== roomId) return;
  const watch = state.hostOfferWatch;
  if (!strategyOfferWatchIsCurrent(watch) || watch.roomId !== roomId) return;
  if (watch.reconciliation) return watch.reconciliation;
  stopStrategyOfferWatch(watch);
  const reconciliation = (async () => {
    try {
      const response = await requestSafety("strategy_expire", { roomId });
      if (!strategyOfferWatchIsCurrent(watch)) return;
      if (response.roomId !== roomId) throw new Error("対戦の終了状態を確認できませんでした。");
      if (response.status === "active") {
        await safetyPlayerRoomRecord(roomId);
        if (strategyOfferWatchIsCurrent(watch)) await enterRoom(roomId, watch.generation);
        return;
      }
      if (!["expired", "closed", "blocked"].includes(response.status)) throw new Error("対戦の終了状態を確認できませんでした。");
      finishStrategyOffer(watch);
    } catch (error) {
      if (strategyOfferWatchIsCurrent(watch)) {
        // Do not resubscribe immediately to a genuinely forbidden active room:
        // its immediate error callback would cause an unbounded callable loop.
        watch.expireTimer = window.setTimeout(() => {
          if (strategyOfferWatchIsCurrent(watch)) expireOffer(roomId).catch((failure) => {
            if (strategyOfferWatchIsCurrent(watch)) handleRecoverableError(failure);
          });
        }, MATCH_TIMEOUT_MS);
      }
      throw error;
    } finally {
      watch.reconciliation = null;
    }
  })();
  watch.reconciliation = reconciliation;
  return reconciliation;
}

async function drainIncomingOffers() {
  if (state.acceptingOffer || state.matchingBusy) return;
  while (active && state.screen === "matching" && !state.roomId && state.pendingIncomingOffer) {
    const incoming = state.pendingIncomingOffer;
    state.pendingIncomingOffer = null;
    await acceptOffer(incoming.roomId, incoming.offer);
  }
}

async function acceptOffer(roomId, offer) {
  if (!active || state.screen !== "matching" || state.roomId || offer?.toUid !== state.uid
      || Number(offer?.protocolVersion) !== STRATEGY_PROTOCOL_VERSION) return;
  const generation = state.matchmakingGeneration;
  const targetState = state;
  state.acceptingOffer = true;
  state.acceptingOfferRoomId = roomId;
  try {
    const player = await safetyPlayerRoomRecord(roomId);
    if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
    const response = await requestSafety("strategy_accept", { roomId, player, protocolVersion: STRATEGY_PROTOCOL_VERSION });
    if (!isCurrentStrategyMatchmakingGeneration(generation)) {
      requestSafety("strategy_expire", { roomId }).catch(() => {});
      return;
    }
    if (!["active", "joined"].includes(response.status)) return;
    await freezeMatchAchievementShowcases(roomId);
    await enterRoom(roomId, generation);
  } finally {
    if (state === targetState && state.acceptingOfferRoomId === roomId) {
      state.acceptingOffer = false;
      state.acceptingOfferRoomId = "";
    }
  }
}

function playStrategyMatchReadySound(roomId) {
  const normalizedRoomId = String(roomId || "");
  if (!normalizedRoomId || state.matchReadySoundRoomId === normalizedRoomId) return;
  state.matchReadySoundRoomId = normalizedRoomId;
  try {
    window.HariaiAudio?.playMatchReady?.();
  } catch {
    // 通知音の失敗や非対応環境で、成立済みの対戦を止めない。
  }
}

async function enterRoom(roomId, generation = state.matchmakingGeneration) {
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  const targetState = state;
  const snapshot = await get(ref(database, `online/strategyRooms/${roomId}`));
  const room = snapshot.val();
  if (!room || Number(room.protocolVersion) !== STRATEGY_PROTOCOL_VERSION || !room.players?.[room.hostUid] || !room.players?.[room.guestUid]) throw new Error("戦略型ルーム情報を取得できませんでした。");
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return;
  if (Number(room.queueJoinedAt?.[state.uid]) !== state.queueJoinedAt) throw new Error("別の検索で成立した対戦です。この画面を終了して確認してください。");
  const ownRecord = state.safetyPlayerRecords?.get(roomId);
  const ownCommits = [0, 1, 2].map((index) => String(room.players[state.uid]?.weaknessCommits?.[index] || ""));
  if (!ownRecord || ownCommits.some((commit, index) => commit !== ownRecord.player.weaknessCommits[index])) {
    throw new Error("弱点の封印を確認できませんでした。もう一度対戦相手を探してください。");
  }
  state.weaknessSalts = [...ownRecord.salts];
  state.weaknessCommits = [...ownRecord.player.weaknessCommits];
  state.roomId = roomId;
  state.idleCleanupPending = false;
  state.playerSafetyStopped = false;
  state.roomData = room;
  state.opponentUid = room.hostUid === state.uid ? room.guestUid : room.hostUid;
  state.playerIndex = room.hostUid === state.uid ? 0 : 1;
  state.players = [runtimePlayer(room.players[room.hostUid]), runtimePlayer(room.players[room.guestUid])];
  captureMatchAchievementShowcases(room.achievementShowcases);
  playStrategyMatchReadySound(roomId);
  await cleanupMatchmaking(true);
  if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
  updatePublicPresence("playing").catch(() => {});
  state.screen = "connecting";
  state.peerStatus = "P2P接続を準備中…";
  setStrategyChrome("STRATEGY ONLINE BATTLE");
  render();
  // The deadline must exist before listener/presence registration can await an
  // offline connection. Otherwise a failed setup can strand an expired room.
  startStrategyPrestartGuard(targetState, roomId);
  try {
    await setupRoomListeners();
  } catch (error) {
    if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
    if (Number(targetState.roomData?.prestartDeadlineAt) > 0 && !strategyRoomHasStarted(targetState.roomData)) {
      await confirmStrategyPrestartExpiry(targetState, roomId).catch(handleRecoverableError);
    }
    if (strategyIdleRoomIsCurrent(targetState, roomId)) handleRecoverableError(error);
    return;
  }
  if (state.playerSafetyStopped || !strategyIdleRoomIsCurrent(targetState, roomId)) return;
  await setupPeerConnection();
}

async function setupRoomListeners() {
  const targetState = state;
  const base = `online/strategyRooms/${state.roomId}`;
  const ownedRoomId = state.roomId;
  const current = () => strategyIdleRoomIsCurrent(targetState, ownedRoomId);
  const handleRoomError = (error) => {
    if (!current()) return;
    if (/permission[_ -]denied/i.test(`${error?.code || ""} ${error?.message || ""}`)
        && Number(targetState.roomData?.prestartDeadlineAt) > 0 && !strategyRoomHasStarted(targetState.roomData)) {
      confirmStrategyPrestartExpiry(targetState, ownedRoomId).catch((failure) => {
        if (current()) handleRecoverableError(failure);
      });
    } else handleRecoverableError(error);
  };
  let databaseWasConnected = null;
  // Server-clock correction must not depend on a room write succeeding. In
  // particular, reconnecting at the deadline can reject presence registration.
  targetState.roomUnsubscribers.push(onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => {
    if (!current()) return;
    targetState.serverTimeOffset = Number(snapshot.val() || 0);
    targetState.prestartGuard?.sync();
    updateStrategyIdleNotice();
    if (targetState.screen === "review") startReviewClock();
  }));
  const activeDisconnect = onDisconnect(ref(database, `online/strategyActive/${state.uid}`));
  await activeDisconnect.remove();
  if (!current()) { await activeDisconnect.cancel().catch(() => {}); return; }
  state.disconnectHandles.push(activeDisconnect);
  state.roomUnsubscribers.push(onValue(ref(database, `online/strategyActive/${state.uid}`), (snapshot) => {
    if (!current() || snapshot.val() === ownedRoomId) return;
    cleanupPublicPresence(targetState).catch(() => {});
  }, () => {}));
  const presenceRef = ref(database, `${base}/presence/${state.uid}`);
  await set(presenceRef, { online: true, updatedAt: serverTimestamp() });
  if (!current()) return;
  const presenceDisconnect = onDisconnect(presenceRef);
  await presenceDisconnect.set({ online: false, updatedAt: serverTimestamp() });
  if (!current()) { await presenceDisconnect.cancel().catch(() => {}); return; }
  state.disconnectHandles.push(presenceDisconnect);
  state.roomUnsubscribers.push(onValue(ref(database, base), (snapshot) => {
    if (!current()) return;
    state.roomData = snapshot.val() || {};
    const showcaseCaptured = captureMatchAchievementShowcases(state.roomData.achievementShowcases);
    materializeMatchAchievementShowcases(state.roomData);
    if (showcaseCaptured) refreshMatchAchievementShowcaseIfVisible();
    reactToRoomData().catch(handleRecoverableError);
  }, handleRoomError));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/destroyed`), (snapshot) => {
    if (!current()) return;
    if (snapshot.val()?.reason === "prestart-timeout") {
      finishStrategyPrestartExpiry(targetState, ownedRoomId).catch(handleRoomError);
      return;
    }
    if (snapshot.exists() && snapshot.val().by !== state.uid) handleOpponentDestroyed();
  }, handleRoomError));
  state.roomUnsubscribers.push(onValue(ref(database, `${base}/presence/${state.opponentUid}`), (snapshot) => {
    if (!current()) return;
    state.opponentOnline = snapshot.val()?.online !== false;
    if (!state.opponentOnline && state.screen === "review") finishReviewLocally("left");
    else if (state.screen === "gameover") render();
    else renderBattleIfChanged();
  }, handleRoomError));
  state.roomUnsubscribers.push(onValue(ref(database, ".info/connected"), (snapshot) => {
    if (!current()) return;
    const connected = snapshot.val() === true;
    const reconnected = databaseWasConnected === false && connected;
    databaseWasConnected = connected;
    if (!reconnected || !active || state.roomId !== ownedRoomId) return;
    reactToRoomData().catch(handleRecoverableError);
  }, handleRoomError));
  const chatQuery = query(ref(database, `online/strategyChats/${state.roomId}`), limitToLast(60));
  state.roomUnsubscribers.push(onChildAdded(chatQuery, (snapshot) => {
    if (!current()) return;
    if (state.seenChatIds.has(snapshot.key)) return;
    state.seenChatIds.add(snapshot.key);
    state.chatMessages.push({ id: snapshot.key, ...snapshot.val() });
    if (state.chatMessages.length > 60) state.chatMessages.shift();
    refreshStrategyChat();
  }, handleRoomError));
}

async function setupPeerConnection() {
  const targetState = state;
  const roomId = state.roomId;
  // A local deadline can be ahead of server time until the offset listener
  // arrives. Keep setup resumable; only confirmed termination closes it.
  if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
  if (!("RTCPeerConnection" in window)) throw new Error("このブラウザはWebRTC画像・音声・短尺映像転送に対応していません。");
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
  state.peer = peer;
  const current = () => strategyIdleRoomIsCurrent(targetState, roomId) && targetState.peer === peer;
  peer.onicecandidate = (event) => { if (current() && event.candidate) sendSignal("candidate", event.candidate.toJSON()).catch(handleRecoverableError); };
  peer.onconnectionstatechange = () => {
    if (!current()) return;
    state.peerStatus = peer.connectionState === "connected" ? "● P2P接続済み" : `P2P: ${peer.connectionState}`;
    if (["failed", "closed"].includes(peer.connectionState) && active) showToast("P2P接続が切れました。ルーム破棄で退出できます。");
    if (state.screen === "connecting") render();
  };
  peer.ondatachannel = (event) => {
    if (!current()) { event.channel.close(); return; }
    if (event.channel.label === STRATEGY_VIDEO_CHANNEL_LABEL) configureVideoDataChannel(event.channel);
    else if (event.channel.label === STRATEGY_REVIEW_ASSET_CHANNEL_LABEL) configureStrategyReviewAssetDataChannel(event.channel);
    else if (event.channel.label === "hariai-strategy-images") configureDataChannel(event.channel);
    else event.channel.close();
  };
  const signalsRef = ref(database, `online/strategyRooms/${state.roomId}/signals/${state.uid}`);
  state.roomUnsubscribers.push(onChildAdded(signalsRef, async (snapshot) => {
    if (!current()) return;
    try { await handleSignal(snapshot.val()); } finally { await remove(snapshot.ref).catch(() => {}); }
  }));
  if (state.playerIndex === 0) {
    const channel = peer.createDataChannel("hariai-strategy-images", { ordered: true });
    configureDataChannel(channel);
    const videoChannel = peer.createDataChannel(STRATEGY_VIDEO_CHANNEL_LABEL, { ordered: true });
    configureVideoDataChannel(videoChannel);
    const reviewAssetChannel = peer.createDataChannel(STRATEGY_REVIEW_ASSET_CHANNEL_LABEL, { ordered: true });
    configureStrategyReviewAssetDataChannel(reviewAssetChannel);
    const offer = await peer.createOffer();
    if (!current()) return;
    await peer.setLocalDescription(offer);
    if (!current()) return;
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
  }
}

async function sendSignal(type, payload) {
  await set(push(ref(database, `online/strategyRooms/${state.roomId}/signals/${state.opponentUid}`)), { fromUid: state.uid, type, payload: JSON.stringify(payload), createdAt: Date.now() });
}

async function handleSignal(signal) {
  if (!signal || signal.fromUid !== state.opponentUid || !state.peer) return;
  const targetState = state, roomId = state.roomId, peer = state.peer;
  const current = () => strategyIdleRoomIsCurrent(targetState, roomId) && targetState.peer === peer;
  const payload = JSON.parse(signal.payload);
  if (signal.type === "offer") {
    await peer.setRemoteDescription(payload);
    if (!current()) return;
    await flushPendingIce();
    if (!current()) return;
    const answer = await peer.createAnswer();
    if (!current()) return;
    await peer.setLocalDescription(answer);
    if (!current()) return;
    await sendSignal("answer", { type: answer.type, sdp: answer.sdp });
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription(payload);
    if (!current()) return;
    await flushPendingIce();
  } else if (signal.type === "candidate") {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(payload);
    else state.pendingIce.push(payload);
  }
}

async function flushPendingIce() {
  const targetState = state, roomId = state.roomId, peer = state.peer;
  while (strategyIdleRoomIsCurrent(targetState, roomId) && targetState.peer === peer && peer && targetState.pendingIce.length) {
    await peer.addIceCandidate(targetState.pendingIce.shift());
  }
}

function configureDataChannel(channel) {
  const targetState = state, roomId = state.roomId;
  const current = () => strategyIdleRoomIsCurrent(targetState, roomId) && targetState.channel === channel;
  state.channel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!current()) { channel.close(); return; }
    state.channelReady = true;
    state.peerStatus = "● P2P接続済み";
    sendProfileAvatar().catch(handleRecoverableError);
    if (state.screen === "connecting") state.screen = "intro";
    render();
    reactToRoomData().catch(handleRecoverableError);
  };
  channel.onclose = () => { if (current()) { state.channelReady = false; state.peerStatus = "P2P接続が切れました"; } };
  channel.onerror = () => { if (current()) showToast("画像・音声転送で通信エラーが発生しました。"); };
  channel.onmessage = (event) => { if (current()) handleChannelMessage(event.data).catch(handleRecoverableError); };
}

function configureVideoDataChannel(channel) {
  const targetState = state, roomId = state.roomId;
  const current = () => strategyIdleRoomIsCurrent(targetState, roomId) && targetState.videoChannel === channel;
  state.videoChannel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!current()) { channel.close(); return; }
    state.videoChannelReady = true;
    state.opponentReviewMediaReceiving = true;
    sendStrategyReviewMediaPermission();
    refreshStrategyVideoPanel();
  };
  channel.onclose = () => {
    if (!current()) return;
    state.videoChannelReady = false;
    state.incomingVideoTransfer = null;
    if (state.reviewAssetChannel?.readyState !== "open") state.opponentReviewMediaReceiving = false;
    refreshStrategyReviewAssetPanel();
    refreshStrategyVideoPanel();
  };
  channel.onerror = () => {
    if (!current()) return;
    state.videoChannelReady = false;
    if (state.reviewAssetChannel?.readyState !== "open") state.opponentReviewMediaReceiving = false;
    showToast("短尺映像のP2P通信に失敗しました。チャットと対戦は続けられます。");
    refreshStrategyReviewAssetPanel();
    refreshStrategyVideoPanel();
  };
  channel.onmessage = (event) => { if (!current()) return; return handleVideoChannelMessage(event.data).catch((error) => {
    if (!current()) return;
    state.incomingVideoTransfer = null;
    console.error(error);
    showToast(error?.message || "短尺映像を受信できませんでした。チャットと対戦は続けられます。");
  }); };
}

function configureStrategyReviewAssetDataChannel(channel) {
  const targetState = state, roomId = state.roomId;
  const current = () => strategyIdleRoomIsCurrent(targetState, roomId) && targetState.reviewAssetChannel === channel;
  state.reviewAssetChannel = channel;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = DATA_BUFFER_LIMIT / 2;
  channel.onopen = () => {
    if (!current()) { channel.close(); return; }
    state.reviewAssetChannelReady = true;
    state.opponentReviewMediaReceiving = true;
    sendStrategyReviewMediaPermission();
    refreshStrategyReviewAssetPanel();
  };
  channel.onclose = () => {
    if (!current()) return;
    state.reviewAssetChannelReady = false;
    if (state.videoChannel?.readyState !== "open") state.opponentReviewMediaReceiving = false;
    state.incomingReviewAssetTransfer = null;
    refreshStrategyReviewAssetPanel();
    refreshStrategyVideoPanel();
  };
  channel.onerror = () => {
    if (!current()) return;
    state.reviewAssetChannelReady = false;
    if (state.videoChannel?.readyState !== "open") state.opponentReviewMediaReceiving = false;
    state.incomingReviewAssetTransfer = null;
    showToast("品評会メディアのP2P通信に失敗しました。チャットは続けられます。");
    refreshStrategyReviewAssetPanel();
    refreshStrategyVideoPanel();
  };
  channel.onmessage = (event) => { if (!current()) return; return handleStrategyReviewAssetChannelMessage(event.data).catch((error) => {
    if (!current()) return;
    state.incomingReviewAssetTransfer = null;
    console.error(error);
    showToast(error?.message || "品評会メディアを受信できませんでした。チャットは続けられます。");
  }); };
}

async function handleStrategyReviewAssetChannelMessage(data) {
  if (typeof data === "string") {
    if (data.length > 4096) throw new Error("品評会メディアの制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "strategy-review-media-permission") {
      state.opponentReviewMediaReceiving = message.enabled === true;
      if (!state.opponentReviewMediaReceiving && state.reviewAssetSending) {
        showToast("相手がメディア受信を停止しました。進行中の送信を中止します。");
      }
      refreshStrategyReviewAssetPanel();
      refreshStrategyVideoPanel();
      return;
    }
    if (message.type === "strategy-review-asset-start") {
      if (!strategyReviewIsActive() || !state.reviewMediaReceiving) throw new Error("現在は品評会メディアを受信しません。");
      const kind = String(message.kind || "");
      if (strategyReviewAssetCount(state.opponentUid, kind) >= strategyReviewAssetLimit(kind)) {
        throw new Error(kind === "image" ? `相手からの追加画像は${STRATEGY_REVIEW_IMAGE_LIMIT}枚までです。` : `相手からの追加音声は${STRATEGY_REVIEW_AUDIO_LIMIT}本までです。`);
      }
      state.incomingReviewAssetTransfer = createIncomingStrategyReviewAssetTransfer(message, {
        currentTransfer: state.incomingReviewAssetTransfer,
        expectedOwnerUid: state.opponentUid,
        now: firebaseNow(),
      });
      return;
    }
    if (message.type === "strategy-review-asset-end") {
      const transfer = state.incomingReviewAssetTransfer;
      if (!transfer) return;
      state.incomingReviewAssetTransfer = null;
      const asset = await finishIncomingStrategyReviewAssetTransfer(transfer, message);
      if (!strategyReviewIsActive() || !state.reviewMediaReceiving) {
        releaseStrategyReviewAssetResource(asset);
        return;
      }
      if (strategyReviewAssetCount(state.opponentUid, asset.kind) >= strategyReviewAssetLimit(asset.kind)) {
        releaseStrategyReviewAssetResource(asset);
        throw new Error(asset.kind === "image" ? `相手からの追加画像は${STRATEGY_REVIEW_IMAGE_LIMIT}枚までです。` : `相手からの追加音声は${STRATEGY_REVIEW_AUDIO_LIMIT}本までです。`);
      }
      state.reviewAssets.push(asset);
      state.reviewAssetReceivedCounts[asset.kind] += 1;
      refreshStrategyReviewAssetPanel();
      showToast(asset.kind === "image" ? "相手から追加画像を受信しました。" : "相手から追加音声を受信しました。自動再生はしません。");
    }
    return;
  }
  if (!state.incomingReviewAssetTransfer) return;
  try {
    await appendStrategyReviewAssetChunk(state.incomingReviewAssetTransfer, data);
  } catch (error) {
    state.incomingReviewAssetTransfer = null;
    throw error;
  }
}

async function handleVideoChannelMessage(data) {
  if (typeof data === "string") {
    if (data.length > 4096) throw new Error("動画転送の制御情報が大きすぎます。");
    const message = JSON.parse(data);
    if (message.type === "strategy-review-media-permission") {
      state.opponentReviewMediaReceiving = message.enabled === true;
      refreshStrategyReviewAssetPanel();
      refreshStrategyVideoPanel();
      return;
    }
    if (message.type === "strategy-video-start") {
      const phase = currentStrategyVideoPhase();
      if (!phase || message.phase !== phase) throw new Error("現在のフェーズでは短尺映像を受信できません。");
      if (phase === "review" && !state.reviewMediaReceiving) throw new Error("現在は品評会メディアを受信しません。");
      if (state.videoReceivedPhases.has(phase)) throw new Error("相手からの短尺映像は各フェーズ1本までです。");
      state.incomingVideoTransfer = createIncomingStrategyVideoTransfer(message, {
        currentTransfer: state.incomingVideoTransfer,
        expectedOwnerUid: state.opponentUid,
        allowedPhases: [phase],
        maxRounds: HARIAI_MAX_SLOTS,
        now: firebaseNow(),
      });
      return;
    }
    if (message.type === "strategy-video-end") {
      const transfer = state.incomingVideoTransfer;
      if (!transfer) return;
      state.incomingVideoTransfer = null;
      const clip = finishIncomingStrategyVideoTransfer(transfer, message);
      if (clip.phase === "review" && (!strategyReviewIsActive() || !state.reviewMediaReceiving)) {
        releaseStrategyVideoResource(clip);
        return;
      }
      if (state.videoReceivedPhases.has(clip.phase)) {
        releaseStrategyVideoResource(clip);
        throw new Error("相手からの短尺映像は各フェーズ1本までです。");
      }
      state.videoReceivedPhases.add(clip.phase);
      state.videoClips.push(clip);
      refreshStrategyVideoPanel();
      showToast("相手から短尺映像を受信しました。自動再生はしません。");
    }
    return;
  }
  if (!state.incomingVideoTransfer) return;
  try {
    await appendStrategyVideoChunk(state.incomingVideoTransfer, data);
  } catch (error) {
    state.incomingVideoTransfer = null;
    throw error;
  }
}

function imageKey(kind, slot, index = 0) {
  return `${kind}:${slot}:${index}`;
}

function normalizeIncomingStrategyImageStart(message, targetState = state) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("受信画像の開始情報が不正です。");
  }
  const kind = String(message.kind || "");
  const slot = Number(message.slot);
  const index = Number(message.index ?? 0);
  const ownerUid = String(message.ownerUid || "");
  const size = Number(message.size);
  const mime = normalizeOnlineImageMime(message.mime);
  if (ownerUid !== targetState.opponentUid) throw new Error("受信画像の送信者が対戦相手と一致しません。");
  if (!Number.isSafeInteger(size) || size <= 0 || size > STRATEGY_DECK_IMAGE_MAX_BYTES) {
    throw new Error("受信画像のサイズが不正です。");
  }
  if (!STRATEGY_DECK_IMAGE_MIME_TYPES.includes(mime)) throw new Error("受信画像の形式が不正です。");
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > HARIAI_MAX_SLOTS) throw new Error("受信画像の手番情報が不正です。");
  // P2Pの到着がRealtime Databaseより早い場合があるため、確定済みの手と食い違う時だけ拒否する。
  const move = targetState.roomData?.moves?.[slot];
  if (kind === "move") {
    if (index !== 0) throw new Error("受信画像の手番情報が不正です。");
    if (move?.post && move.post.by !== ownerUid) throw new Error("受信画像が確定した手と一致しません。");
  } else if (kind === "finish") {
    if (!Number.isSafeInteger(index) || index < 0 || index >= HARIAI_FINISH_MAX) throw new Error("受信した仕留め画像の位置が不正です。");
    if (move?.break && move.break.by !== ownerUid) throw new Error("受信した仕留め画像が確定した看破と一致しません。");
    const declared = Number(move?.finish?.count);
    if (move?.finish && (!Number.isSafeInteger(declared) || index >= declared)) throw new Error("受信した仕留め画像が宣言枚数を超えています。");
  } else {
    throw new Error("受信画像の用途が不正です。");
  }
  const current = targetState.incomingTransfer;
  if (current && (current.kind !== kind || current.slot !== slot || current.index !== index || current.ownerUid !== ownerUid)) {
    throw new Error("別の画像を受信中です。");
  }
  return {
    kind,
    slot,
    index,
    ownerUid,
    mime,
    size,
    hasAudio: message.hasAudio === true,
    chunks: [],
    received: 0,
  };
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
      state.incomingTransfer = normalizeIncomingStrategyImageStart(message, state);
    } else if (message.type === "strategy-image-end") {
      await finishIncomingImage(message.kind, message.slot, message.index ?? 0, message.ownerUid);
    } else if (message.type === "strategy-audio-start") {
      const size = Number(message.size);
      const duration = Number(message.duration);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_TRANSFER_BYTES) throw new Error("添付音声の受信サイズが不正です。");
      if (message.mime !== "audio/wav" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS + 0.1) throw new Error("添付音声の形式が不正です。");
      state.incomingAudioTransfer = { kind: message.kind, slot: Number(message.slot), index: Number(message.index ?? 0), ownerUid: message.ownerUid, mime: "audio/wav", size, duration, cueStart: Number(message.cueStart || 0), chunks: [], received: 0 };
    } else if (message.type === "strategy-audio-end") {
      await finishIncomingAudio(message.kind, Number(message.slot), Number(message.index ?? 0), message.ownerUid);
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
    refreshHariaiTransferProgress();
    return;
  }
  if (!state.incomingTransfer) return;
  const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
  if (!chunk || !Number.isSafeInteger(chunk.byteLength) || chunk.byteLength <= 0
      || state.incomingTransfer.received + chunk.byteLength > state.incomingTransfer.size) {
    state.incomingTransfer = null;
    throw new Error("受信画像のサイズが宣言値を超えました。");
  }
  state.incomingTransfer.chunks.push(chunk);
  state.incomingTransfer.received += chunk.byteLength;
  state.transferProgress = Math.min(99, Math.round((state.incomingTransfer.received / state.incomingTransfer.size) * 100));
  refreshHariaiTransferProgress();
}

function strategyImageSendContextIsCurrent(targetState, channel, roomId) {
  return state === targetState && targetState.roomId === roomId
    && targetState.channel === channel && channel?.readyState === "open";
}

function getStrategyImageSendCoordinator(targetState, channel) {
  let coordinator = targetState.imageSendCoordinator;
  if (!coordinator || coordinator.channel !== channel || coordinator.roomId !== targetState.roomId) {
    coordinator = {
      channel, roomId: targetState.roomId, tail: Promise.resolve(),
      pendingImages: new Map(), avatarPromise: null, failure: null,
    };
    targetState.imageSendCoordinator = coordinator;
  }
  return coordinator;
}

function assertStrategyImageSendContext(targetState, coordinator) {
  if (!strategyImageSendContextIsCurrent(targetState, coordinator.channel, coordinator.roomId)) {
    throw new Error("画像送信中にP2P接続または対戦が切り替わりました。");
  }
  if (coordinator.failure) throw coordinator.failure;
}

function queueStrategyImageSend(targetState, coordinator, transfer) {
  // Binary chunks carry no image ID. Keep start/body/end and attached audio
  // together on this channel; preparation happens before entering this queue.
  const operation = coordinator.tail.then(async () => {
    assertStrategyImageSendContext(targetState, coordinator);
    let started = false;
    const send = (data) => {
      assertStrategyImageSendContext(targetState, coordinator);
      started = true;
      coordinator.channel.send(data);
    };
    try {
      await transfer(send);
    } catch (error) {
      if (started) {
        // There is no abort frame in this protocol. Do not append another
        // image to a partially transmitted one, or implicitly retry it.
        coordinator.failure = error;
        if (strategyImageSendContextIsCurrent(targetState, coordinator.channel, coordinator.roomId)) {
          targetState.channelReady = false;
          targetState.peerStatus = "画像・音声の送信に失敗しました";
          try { coordinator.channel.close(); } catch {}
        }
      }
      throw error;
    }
  });
  coordinator.tail = operation.catch(() => {});
  return operation;
}

async function sendProfileAvatar() {
  const targetState = state, channel = state.channel;
  if (targetState.avatarSent || !channel || channel.readyState !== "open") return;
  const coordinator = getStrategyImageSendCoordinator(targetState, channel);
  if (coordinator.avatarPromise) return coordinator.avatarPromise;
  const pending = (async () => {
    // Optional avatar loading must not hold up battle image transfers.
    await shared()?.profileAvatar?.ready?.();
    assertStrategyImageSendContext(targetState, coordinator);
    const avatar = shared()?.profileAvatar?.get?.();
    const blob = avatar?.blob;
    const buffer = blob && blob.size > 0 && blob.size <= PROFILE_AVATAR_MAX_BYTES
      ? await blob.arrayBuffer() : null;
    assertStrategyImageSendContext(targetState, coordinator);
    await queueStrategyImageSend(targetState, coordinator, async (send) => {
      if (!buffer || buffer.byteLength !== blob.size) {
        send(JSON.stringify({ type: "profile-avatar-empty" }));
        return;
      }
      send(JSON.stringify({ type: "profile-avatar-start", size: buffer.byteLength, mime: blob.type || "image/webp" }));
      for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
        await waitForDataBuffer(channel);
        send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
      }
      send(JSON.stringify({ type: "profile-avatar-end" }));
    });
    assertStrategyImageSendContext(targetState, coordinator);
    targetState.avatarSent = true;
  })().finally(() => {
    if (coordinator.avatarPromise === pending) coordinator.avatarPromise = null;
  });
  coordinator.avatarPromise = pending;
  return pending;
}

function finishIncomingProfileAvatar() {
  const transfer = state.incomingAvatarTransfer;
  if (!transfer || transfer.received !== transfer.size) throw new Error("プロフィール画像の受信が完了していません。");
  releaseRemoteAvatar();
  const blob = new Blob(transfer.chunks, { type: transfer.mime });
  state.remoteAvatar = { blob, url: URL.createObjectURL(blob) };
  state.incomingAvatarTransfer = null;
  // 対戦中は入力途中の言葉を消さないよう、アバターだけのために全体を描き直さない。
  if (["identity", "waitingBattle", "waitingFinalWeaknessReveal"].includes(state.screen)) render();
}

function releaseRemoteAvatar() {
  if (state.remoteAvatar?.url) URL.revokeObjectURL(state.remoteAvatar.url);
  state.remoteAvatar = null;
  state.incomingAvatarTransfer = null;
}

async function finishIncomingImage(kind, slot, index, ownerUid) {
  const transfer = state.incomingTransfer;
  if (!transfer) return false;
  const normalizedSlot = Number(slot);
  const normalizedIndex = Number(index ?? 0);
  if (transfer.kind !== String(kind || "") || transfer.slot !== normalizedSlot || transfer.index !== normalizedIndex || transfer.ownerUid !== String(ownerUid || "")) {
    throw new Error("受信中の画像と完了情報が一致しませんでした。");
  }
  if (transfer.received !== transfer.size) {
    state.incomingTransfer = null;
    throw new Error("受信画像のサイズが一致しませんでした。");
  }
  let mime;
  try {
    mime = verifiedOnlineImageMimeFromChunks(transfer.chunks);
    if (mime !== transfer.mime) throw new Error("受信画像の形式と実データが一致しません。");
  } catch (error) {
    state.incomingTransfer = null;
    throw error;
  }
  const key = imageKey(transfer.kind, transfer.slot, transfer.index);
  const previous = state.remoteImages.get(key);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  releaseCardAudio(previous);
  const blob = new Blob(transfer.chunks, { type: mime });
  state.remoteImages.set(key, { blob, url: URL.createObjectURL(blob), awaitingAudio: transfer.hasAudio });
  state.incomingTransfer = null;
  state.transferProgress = 100;
  if (!transfer.hasAudio) await acknowledgeStrategyMedia(transfer.kind, transfer.slot, transfer.index);
  renderBattleIfChanged();
  return true;
}

async function finishIncomingAudio(kind, slot, index, ownerUid) {
  const transfer = state.incomingAudioTransfer;
  if (!transfer || transfer.kind !== kind || transfer.slot !== slot || transfer.index !== index || transfer.ownerUid !== ownerUid || transfer.received !== transfer.size) {
    throw new Error("受信音声のサイズが一致しませんでした。");
  }
  const item = state.remoteImages.get(imageKey(kind, slot, index));
  if (!item?.awaitingAudio) throw new Error("音声に対応する画像を確認できませんでした。");
  const blob = new Blob(transfer.chunks, { type: "audio/wav" });
  item.audioBlob = blob;
  item.audioUrl = URL.createObjectURL(blob);
  item.audioDuration = transfer.duration;
  item.audioCueStart = Math.max(0, Math.min(Math.max(0, transfer.duration - AUDIO_HIGHLIGHT_SECONDS), transfer.cueStart || 0));
  item.awaitingAudio = false;
  state.incomingAudioTransfer = null;
  state.transferProgress = 100;
  await acknowledgeStrategyMedia(kind, slot, index);
  renderBattleIfChanged();
}

async function acknowledgeStrategyMedia(kind, slot, index = 0) {
  const key = imageKey(kind, slot, index);
  if (state.ackedMediaKeys.has(key)) return;
  state.ackedMediaKeys.add(key);
  try {
    if (kind === "move") await set(ref(database, `online/strategyRooms/${state.roomId}/moves/${slot}/received/${state.uid}`), true);
    else if (kind === "finish") await set(ref(database, `online/strategyRooms/${state.roomId}/moves/${slot}/finishReceived/${index}`), true);
  } catch (error) {
    state.ackedMediaKeys.delete(key);
    throw error;
  }
}

async function sendImage(item, kind, slot, index = 0) {
  const targetState = state;
  const channel = targetState.channel;
  const senderUid = targetState.uid;
  const key = imageKey(kind, slot, index);
  const coordinator = getStrategyImageSendCoordinator(targetState, channel);
  assertStrategyImageSendContext(targetState, coordinator);
  // A second finish loop must wait for the first image, not skip ahead to
  // the next one just because transmission of this key has started.
  if (coordinator.pendingImages.has(key)) return coordinator.pendingImages.get(key);
  if (targetState.sentImageKeys.has(key)) return;
  const blob = item?.blob;
  if (!blob) throw new Error("送信する画像を確認できませんでした。");
  const pending = (async () => {
    const buffer = await blob.arrayBuffer();
    assertStrategyImageSendContext(targetState, coordinator);
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || buffer.byteLength > STRATEGY_DECK_IMAGE_MAX_BYTES) {
      throw new Error("送信画像のサイズが不正です。");
    }
    const mime = verifiedOnlineImageMime(buffer);
    if (mime !== normalizeOnlineImageMime(blob.type)) {
      throw new Error("送信画像の形式と実データが一致しません。");
    }
    let audio = getTransferableStrategyAudio(item);
    let audioBuffer = null;
    if (audio) {
      try {
        audioBuffer = await audio.blob.arrayBuffer();
        if (audioBuffer.byteLength !== audio.blob.size) {
          audio = null;
          audioBuffer = null;
        }
      } catch {
        audio = null;
        audioBuffer = null;
      }
    }
    assertStrategyImageSendContext(targetState, coordinator);
    await queueStrategyImageSend(targetState, coordinator, async (send) => {
      targetState.transferProgress = 0;
      refreshHariaiTransferProgress();
      send(JSON.stringify({ type: "strategy-image-start", kind, slot, index, ownerUid: senderUid, size: buffer.byteLength, mime, hasAudio: Boolean(audioBuffer) }));
      for (let offset = 0; offset < buffer.byteLength; offset += DATA_CHUNK_BYTES) {
        await waitForDataBuffer(channel);
        send(buffer.slice(offset, Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES)));
        targetState.transferProgress = Math.round((Math.min(buffer.byteLength, offset + DATA_CHUNK_BYTES) / buffer.byteLength) * 100);
        refreshHariaiTransferProgress();
      }
      send(JSON.stringify({ type: "strategy-image-end", kind, slot, index, ownerUid: senderUid }));
      if (audioBuffer) {
        targetState.transferProgress = 0;
        send(JSON.stringify({ type: "strategy-audio-start", kind, slot, index, ownerUid: senderUid, size: audioBuffer.byteLength, mime: "audio/wav", duration: audio.duration, cueStart: audio.cueStart }));
        for (let offset = 0; offset < audioBuffer.byteLength; offset += DATA_CHUNK_BYTES) {
          await waitForDataBuffer(channel);
          send(audioBuffer.slice(offset, Math.min(audioBuffer.byteLength, offset + DATA_CHUNK_BYTES)));
          targetState.transferProgress = Math.round((Math.min(audioBuffer.byteLength, offset + DATA_CHUNK_BYTES) / audioBuffer.byteLength) * 100);
          refreshHariaiTransferProgress();
        }
        send(JSON.stringify({ type: "strategy-audio-end", kind, slot, index, ownerUid: senderUid }));
      }
    });
    assertStrategyImageSendContext(targetState, coordinator);
    targetState.sentImageKeys.add(key);
  })().finally(() => {
    if (coordinator.pendingImages.get(key) === pending) coordinator.pendingImages.delete(key);
  });
  coordinator.pendingImages.set(key, pending);
  return pending;
}

function waitForDataBuffer(channel = state.channel) {
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

async function submitDecision(decision) {
  if (strategyPrestartProgressBlocked()) return;
  const targetState = state, roomId = state.roomId, uid = state.uid;
  if (!roomId || !["intro", "waitingDecision"].includes(state.screen)) return;
  state.screen = decision === "withdraw" ? "withdrawn" : "waitingDecision";
  render();
  try {
    await set(ref(database, `online/strategyRooms/${roomId}/decisions/${uid}`), decision);
  } catch (error) {
    await handleStrategyPrestartWriteFailure(targetState, roomId, error, "intro");
  }
}

async function handleStrategyPrestartWriteFailure(targetState, roomId, error, fallbackScreen) {
  if (!strategyIdleRoomIsCurrent(targetState, roomId)) return;
  if (Number(targetState.roomData?.prestartDeadlineAt) > 0 && !strategyRoomHasStarted(targetState.roomData)) {
    try { await confirmStrategyPrestartExpiry(targetState, roomId); }
    catch { /* The deadline guard retries without permitting another session. */ }
  }
  if (!strategyIdleRoomIsCurrent(targetState, roomId) || targetState.idleCleanupPending) return;
  if (!strategyRoomHasStarted(targetState.roomData)) targetState.screen = fallbackScreen;
  render();
  showToast(error?.message || "開始前の通信に失敗しました。通信状態を確認してもう一度お試しください。");
}

function stopReviewClock() {
  window.clearInterval(state.reviewClockTimer);
  state.reviewClockTimer = null;
}

function finishReviewLocally(reason) {
  stopReviewClock();
  stopStrategyVideoRecording({ discard: true });
  releaseStrategyVideoData();
  releaseStrategyReviewAssetData();
  state.reviewEndReason = reason;
  state.reviewLocallyEnded = true;
  if (state.screen !== "gameover") {
    state.screen = "gameover";
    setStrategyChrome("STRATEGY COMPLETE");
    render();
  }
}

function startReviewClock() {
  stopReviewClock();
  const updateClock = () => {
    const remaining = reviewRemainingMs();
    const clock = document.querySelector("#strategyReviewCountdown");
    if (clock) clock.textContent = formatReviewRemaining(remaining);
    if (remaining <= 0 && state.screen === "review") finishReviewLocally("time");
  };
  updateClock();
  if (state.screen === "review" && reviewRemainingMs() > 0) state.reviewClockTimer = window.setInterval(updateClock, 1000);
}

async function submitReviewDecision(decision) {
  const finished = state.roomData?.finished || {};
  const current = state.roomData?.reviewDecisions?.[state.uid];
  if (current || finished[state.uid] !== true || finished[state.opponentUid] !== true) return;
  if (decision !== "accept" && decision !== "decline") return;
  document.querySelectorAll("#strategyReviewAccept, #strategyReviewDecline").forEach((button) => { button.disabled = true; });
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/reviewDecisions/${state.uid}`), decision);
    if (decision === "decline") {
      stopStrategyVideoRecording({ discard: true });
      releaseStrategyVideoData();
      releaseStrategyReviewAssetData();
    }
  } catch (error) {
    console.error(error);
    showToast("品評会の回答を送信できませんでした。通信状態を確認してください。");
    render();
  }
}

async function maybeStartStrategyReview() {
  if (Number(state.roomData?.reviewStartedAt || 0) > 0) return;
  const decisions = state.roomData?.reviewDecisions || {};
  if (decisions[state.uid] !== "accept" || decisions[state.opponentUid] !== "accept") return;
  if (!state.opponentOnline) return;
  try {
    await set(ref(database, `online/strategyRooms/${state.roomId}/reviewStartedAt`), serverTimestamp());
  } catch (error) {
    const snapshot = await get(ref(database, `online/strategyRooms/${state.roomId}/reviewStartedAt`)).catch(() => null);
    if (!snapshot?.exists()) throw error;
  }
}

async function leaveStrategyReview(returnHome = false) {
  if (state.screen !== "review") return;
  document.querySelector("#strategyReviewLeave")?.setAttribute("disabled", "");
  await set(ref(database, `online/strategyRooms/${state.roomId}/reviewEnded/${state.uid}`), true).catch((error) => {
    console.error(error);
    showToast("終了通知を相手へ送れませんでした。品評会を閉じます。");
  });
  finishReviewLocally("left");
  if (returnHome) await leaveToLanding();
}

async function reactToReviewData() {
  refreshHariaiReviewPenaltyBanner();
  const finished = state.roomData?.finished || {};
  const decisions = state.roomData?.reviewDecisions || {};
  const ended = state.roomData?.reviewEnded || {};
  const bothFinished = finished[state.uid] === true && finished[state.opponentUid] === true;
  const bothAccepted = decisions[state.uid] === "accept" && decisions[state.opponentUid] === "accept";
  const declined = decisions[state.uid] === "decline" || decisions[state.opponentUid] === "decline";
  const startedAt = Number(state.roomData?.reviewStartedAt || 0);
  const endedByPlayer = Boolean(ended[state.uid] || ended[state.opponentUid]);
  const expired = startedAt > 0 && reviewRemainingMs() <= 0;

  if (!bothFinished) {
    if (state.screen === "gameover") render();
    return;
  }
  if (declined) {
    stopStrategyVideoRecording({ discard: true });
    releaseStrategyVideoData();
    releaseStrategyReviewAssetData();
    if (state.screen === "review") finishReviewLocally("left");
    else if (state.screen === "gameover") render();
    return;
  }
  if (bothAccepted && !startedAt) {
    if (!state.opponentOnline) {
      if (state.screen === "gameover") render();
      return;
    }
    await maybeStartStrategyReview();
    if (state.screen === "gameover") render();
    return;
  }
  if (startedAt && !endedByPlayer && !expired && bothAccepted) {
    if (state.reviewLocallyEnded) return;
    state.reviewEndReason = "";
    if (state.screen !== "review") {
      state.screen = "review";
      setStrategyChrome("POST-MATCH REVIEW");
      render();
    }
    startReviewClock();
    return;
  }
  if (startedAt && (endedByPlayer || expired)) {
    finishReviewLocally(expired ? "time" : "left");
    return;
  }
  if (state.screen === "gameover") render();
}

async function addDeckFiles(zone, files) {
  const targetState = state;
  if (!["main", "reserve"].includes(zone) || !["preDeck", "deck"].includes(targetState.screen)) return;
  const limit = zone === "main" ? MAIN_COUNT : RESERVE_COUNT;
  const room = Math.max(0, limit - targetState[zone].length);
  if (!room) return;
  const initialCount = targetState[zone].length;
  setBusy(true, "デッキ画像を準備しています…");
  try {
    for (const file of files.slice(0, room)) {
      const position = zone === "main" ? targetState.main.length : MAIN_COUNT + targetState.reserve.length;
      const item = await shared().processImageFile(file, position, { maxSide: 1280, quality: 0.84 });
      if (!active || state !== targetState || !["preDeck", "deck"].includes(targetState.screen)) {
        releaseLocalStrategyCard(item);
        return;
      }
      try {
        validateStrategyDeckImageForAddition(item.blob, targetState);
      } catch (error) {
        releaseLocalStrategyCard(item);
        throw error;
      }
      targetState[zone].push(item);
    }
    if (files.length > room) showToast(`${limit}枚を超えた画像は追加していません。`);
  } catch (error) {
    if (active && state === targetState) showToast(error.message || "画像を追加できませんでした。");
  } finally {
    if (active && state === targetState && targetState[zone].length !== initialCount) markStrategyDeckEdited();
    setBusy(false);
    if (active && state === targetState) render();
  }
}

function findDeckCard(token) {
  const [zone, id] = String(token || "").split(":");
  if (!['main', 'reserve'].includes(zone)) return {};
  return { zone, item: state[zone].find((card) => card.id === id) };
}

async function addCardAudio(token, file) {
  const targetState = state;
  const { zone, item } = findDeckCard(token);
  if (!item || !file) return;
  setBusy(true, "音声を10秒以下・モノラルWAVへ変換しています…");
  try {
    const audio = await processStrategyAudioFile(file);
    if (!active || state !== targetState || !["preDeck", "deck"].includes(targetState.screen)
        || !targetState[zone]?.includes(item)) {
      if (audio.audioUrl) URL.revokeObjectURL(audio.audioUrl);
      return;
    }
    releaseCardAudio(item);
    Object.assign(item, audio);
    markStrategyDeckEdited();
    showToast(file.size > audio.audioBlob.size ? "音声を軽量化して画像に添付しました。" : "音声を画像に添付しました。");
  } catch (error) {
    if (active && state === targetState) showToast(error.message || "音声を添付できませんでした。");
  } finally {
    setBusy(false);
    if (active && state === targetState) render();
  }
}

function removeCardAudio(token) {
  const { item } = findDeckCard(token);
  if (!item?.audioBlob) return;
  releaseCardAudio(item);
  markStrategyDeckEdited();
  render();
}

function updateCardAudioCue(token, value, input) {
  const { item } = findDeckCard(token);
  if (!item?.audioBlob) return;
  const max = Math.max(0, Number(item.audioDuration || 0) - AUDIO_HIGHLIGHT_SECONDS);
  const nextCueStart = Math.max(0, Math.min(max, Number(value) || 0));
  if (nextCueStart !== item.audioCueStart) markStrategyDeckEdited();
  item.audioCueStart = nextCueStart;
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

function removeDeckItem(token) {
  const [zone, id] = token.split(":");
  const index = state[zone].findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = state[zone].splice(index, 1);
  releaseCardAudio(removed);
  URL.revokeObjectURL(removed.url);
  removed.url = "";
  removed.blob = null;
  markStrategyDeckEdited();
  render();
}

async function lockDeck() {
  if (strategyPrestartProgressBlocked()) return;
  if (!strategyDeckIsComplete()) return showToast("戦略型はメイン5枚とリザーブ5枚の実画像をそろえてください。");
  const targetState = state;
  const roomId = targetState.roomId;
  const uid = targetState.uid;
  if (!roomId || !uid || targetState.screen !== "deck") return;
  persistCompleteStrategyDeck().catch(handleRecoverableError);
  targetState.localDeckReadyCommitted = false;
  targetState.screen = "waitingDeck";
  render();
  try {
    await set(ref(database, `online/strategyRooms/${roomId}/deckReady/${uid}`), { ready: true, mainCount: MAIN_COUNT, reserveCount: RESERVE_COUNT, lockedAt: serverTimestamp() });
  } catch (error) {
    if (!active || state !== targetState || targetState.roomId !== roomId) return;
    targetState.localDeckReadyCommitted = false;
    if (targetState.screen === "waitingDeck") {
      targetState.screen = "deck";
      render();
    }
    await handleStrategyPrestartWriteFailure(targetState, roomId, error, "deck");
    return;
  }
  if (!active || state !== targetState || targetState.roomId !== roomId) return;
  targetState.localDeckReadyCommitted = true;
  materializeMatchAchievementShowcases(targetState.roomData);
  reactToRoomData().catch(handleRecoverableError);
}

async function startBattle() {
  if (strategyPrestartProgressBlocked() || state.screen !== "identity") return;
  const targetState = state, roomId = state.roomId, uid = state.uid;
  if (!roomId || !uid) return;
  state.screen = "waitingBattle";
  render();
  try {
    await set(ref(database, `online/strategyRooms/${roomId}/battleReady/${uid}`), true);
  } catch (error) {
    await handleStrategyPrestartWriteFailure(targetState, roomId, error, "identity");
  }
}

async function failWeaknessIntegrityCheck(message = "弱点の封印の照合に失敗しました。この対戦はノーコンテストです。") {
  if (state.weaknessIntegrityFailed) return;
  state.weaknessIntegrityFailed = true;
  await runTransaction(ref(database, `online/strategyRooms/${state.roomId}/destroyed`), (current) => current || { by: state.uid, at: Date.now() }).catch(() => {});
  handleFatalError(new Error(message));
}

function both(object) {
  return Boolean(object?.[state.uid] && object?.[state.opponentUid]);
}

function strategyRoomOperationIsCurrent(targetState, roomId) {
  if (targetState.playerSafetyStopped || targetState.idleStopped) return false;
  return Boolean(active
    && state === targetState
    && state.roomId === roomId
    && !targetState.destroyedByOpponent
    && !targetState.weaknessIntegrityFailed
    && !targetState.roomData?.destroyed
    && !Object.values(targetState.roomData?.decisions || {}).includes("withdraw"));
}

async function reactToRoomData() {
  if (!active || !state.roomId || state.idleStopped) return;
  if (state.reacting) { state.reactAgain = true; return; }
  state.reacting = true;
  try {
    if (state.roomData.destroyed?.reason === "prestart-timeout") {
      await finishStrategyPrestartExpiry(state, state.roomId);
      return;
    }
    if (strategyRoomHasStarted(state.roomData)) {
      state.idleCleanupPending = false;
      stopStrategyPrestartGuard();
    }
    if (state.roomData.destroyed && state.roomData.destroyed.by !== state.uid) return handleOpponentDestroyed();
    const decisions = state.roomData.decisions || {};
    if (Object.values(decisions).includes("withdraw")) {
      cleanupPublicPresence().catch(() => {});
      if (state.screen !== "withdrawn") { state.screen = "withdrawn"; render(); }
      return;
    }
    const finished = state.roomData?.finished || {};
    if (state.screen === "waitingFinalWeaknessReveal") {
      await finishMatch();
      return;
    }
    if (["gameover", "review"].includes(state.screen) || (finished[state.uid] === true && finished[state.opponentUid] === true)) {
      await reactToReviewData();
      return;
    }
    if (decisions[state.uid] === "accept" && decisions[state.opponentUid] === "accept" && ["intro", "waitingDecision"].includes(state.screen)) {
      state.screen = "deck";
      render();
    }
    const deckReady = state.roomData.deckReady || {};
    const bothDecksComplete = both(deckReady) && [state.uid, state.opponentUid].every(
      (uid) => deckReady[uid]?.ready === true
        && deckReady[uid]?.mainCount === MAIN_COUNT
        && deckReady[uid]?.reserveCount === RESERVE_COUNT,
    );
    if (state.localDeckReadyCommitted && bothDecksComplete && ["deck", "waitingDeck"].includes(state.screen)) {
      state.players.forEach((player) => {
        const data = deckReady[player.uid] || {};
        player.mainCount = Number(data.mainCount || MAIN_COUNT);
        player.reserveCount = Number(data.reserveCount || RESERVE_COUNT);
      });
      state.screen = "identity";
      render();
    }
    if (both(state.roomData.battleReady) && ["identity", "waitingBattle"].includes(state.screen)) {
      state.screen = "battle";
      setStrategyChrome("HARIAI BATTLE");
      render();
    }
    if (both(state.roomData.battleReady) && state.screen === "battle") await reactToBattle();
  } finally {
    state.reacting = false;
    if (state.reactAgain) {
      state.reactAgain = false;
      queueMicrotask(() => reactToRoomData().catch(handleRecoverableError));
    }
  }
}

function determineOutcome() {
  const outcome = state.replay?.outcome;
  if (!outcome || outcome.draw) return { winnerIndex: -1 };
  return { winnerIndex: state.players.findIndex((player) => player.uid === outcome.winnerUid) };
}

async function ensureStrategyResultClaim(targetState, outcome) {
  if (targetState.resultClaimCommitted) return true;
  const roomId = targetState.roomId;
  const uid = targetState.uid;
  const claimOutcome = outcome.winnerIndex < 0
    ? "draw"
    : outcome.winnerIndex === targetState.playerIndex ? "win" : "loss";
  const roomPath = `online/strategyRooms/${roomId}`;
  const matchesStoredClaim = (room) => (
    room?.resultClaims?.[uid]?.outcome === claimOutcome
    && room?.finished?.[uid] === true
  );
  if (matchesStoredClaim(targetState.roomData)) {
    targetState.resultClaimCommitted = true;
    return true;
  }
  let writeError = null;
  try {
    await update(ref(database, roomPath), {
      [`resultClaims/${uid}`]: {
        outcome: claimOutcome,
        createdAt: serverTimestamp(),
      },
      [`finished/${uid}`]: true,
    });
  } catch (error) {
    writeError = error;
  }
  if (writeError) {
    const snapshot = await get(ref(database, roomPath)).catch(() => null);
    if (!matchesStoredClaim(snapshot?.val())) throw writeError;
  }
  targetState.resultClaimCommitted = true;
  return true;
}

async function finishMatch() {
  if (state.finalizationBusy || state.screen === "gameover") return;
  const targetState = state;
  const roomId = state.roomId;
  if (!strategyRoomOperationIsCurrent(targetState, roomId)) return;
  state.finalizationBusy = true;
  try {
    stopStrategyVideoRecording({ discard: true });
    closeStrategyVideoDialog();
    if (state.screen !== "waitingFinalWeaknessReveal") {
      state.screen = "waitingFinalWeaknessReveal";
      setStrategyChrome("FINAL WEAKNESS CHECK");
      render();
    }
    const reveals = state.roomData?.weaknessReveals || {};
    if (!reveals[state.uid]) {
      await publishFinalWeaknessReveal();
      return;
    }
    if (!both(reveals)) {
      return;
    }
    if (!state.finalWeaknessRevealsVerified) {
      const verified = await verifyFinalWeaknessReveals(reveals);
      if (!strategyRoomOperationIsCurrent(targetState, roomId)) return;
      if (!verified) {
        await failWeaknessIntegrityCheck("最終弱点のハッシュ照合に失敗しました。この対戦はノーコンテストです。");
        return;
      }
      targetState.finalWeaknessRevealsVerified = true;
    }
    const outcome = determineOutcome();
    await ensureStrategyResultClaim(targetState, outcome);
    if (!strategyRoomOperationIsCurrent(targetState, roomId)) return;
    cleanupPublicPresence().catch(() => {});
    try {
      await commitStrategyStats();
    } catch (error) {
      console.error(error);
      showToast("対戦結果は確定しました。戦績の同期だけ完了しませんでした。");
    }
    if (!strategyRoomOperationIsCurrent(targetState, roomId)) return;
    state.screen = "gameover";
    setStrategyChrome("STRATEGY COMPLETE");
    render();
  } finally {
    if (state === targetState) state.finalizationBusy = false;
  }
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
    if (overallUpdate) {
      const overallResult = await overallUpdate.catch(() => {
        showToast("総合ランキングを更新できませんでした。");
        return null;
      });
      if (overallResult?.economyBalance !== null
        && overallResult?.economyBalance !== undefined
        && Number.isFinite(Number(overallResult.economyBalance))) {
        state.economy.points = Number(overallResult.economyBalance);
      }
    }
  }
}

function getLocalPlayer() {
  return state.players[state.playerIndex];
}

function getOpponent() {
  return state.players[state.playerIndex === 0 ? 1 : 0];
}

function average(values) {
  return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : "0.0";
}

function triggerCriticalFx(text) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  fxLayer.innerHTML = `<div class="critical-flash"></div><div class="critical-text">${escapeHtml(text)}</div>`;
  window.setTimeout(() => { fxLayer.innerHTML = ""; }, 1250);
}

async function startPublicPresence(generation) {
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return false;
  await cleanupPublicPresence();
  if (!isCurrentStrategyMatchmakingGeneration(generation)) return false;
  const presenceId = push(ref(database, "online/publicPresence")).key;
  if (!presenceId) throw new Error("参加状況を登録できませんでした。");
  state.publicPresencePendingId = presenceId;
  window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
  const ownerRef = ref(database, `online/publicPresenceOwners/${presenceId}`);
  const presenceRef = ref(database, `online/publicPresence/${presenceId}`);
  await set(ownerRef, state.uid);
  if (!isCurrentStrategyMatchmakingGeneration(generation)) {
    if (state.publicPresencePendingId === presenceId) state.publicPresencePendingId = "";
    window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
    await remove(ownerRef).catch(() => {});
    return false;
  }
  await writePublicPresence(presenceRef, "waiting");
  if (!isCurrentStrategyMatchmakingGeneration(generation)) {
    if (state.publicPresencePendingId === presenceId) state.publicPresencePendingId = "";
    window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
    await Promise.allSettled([remove(presenceRef), remove(ownerRef)]);
    return false;
  }
  const disconnect = onDisconnect(presenceRef);
  await disconnect.remove();
  if (!isCurrentStrategyMatchmakingGeneration(generation)) {
    if (state.publicPresencePendingId === presenceId) state.publicPresencePendingId = "";
    window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
    await disconnect.cancel().catch(() => {});
    await Promise.allSettled([remove(presenceRef), remove(ownerRef)]);
    return false;
  }
  state.publicPresenceId = presenceId;
  state.publicPresencePendingId = "";
  state.publicPresenceState = "waiting";
  state.publicPresenceDisconnect = disconnect;
  state.publicPresenceHeartbeat = window.setInterval(() => {
    if (state.publicPresenceId) writePublicPresence(ref(database, `online/publicPresence/${state.publicPresenceId}`), state.publicPresenceState).catch(() => {});
  }, HEARTBEAT_MS);
  window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
  return true;
}

async function writePublicPresence(presenceRef, presenceState) {
  await set(presenceRef, { mode: "strategy", state: presenceState, lastSeen: Date.now() });
}

async function updatePublicPresence(nextState) {
  const id = state.publicPresenceId;
  if (!id) return false;
  state.publicPresenceState = nextState;
  try {
    await writePublicPresence(ref(database, `online/publicPresence/${id}`), nextState);
    return true;
  } catch {
    if (state.publicPresenceId === id) await cleanupPublicPresence();
    return false;
  }
}

async function cleanupPublicPresence(targetState = state) {
  window.clearInterval(targetState.publicPresenceHeartbeat);
  targetState.publicPresenceHeartbeat = null;
  const disconnect = targetState.publicPresenceDisconnect;
  const id = targetState.publicPresenceId || targetState.publicPresencePendingId;
  const ownerUid = targetState.uid;
  targetState.publicPresenceDisconnect = null;
  targetState.publicPresenceId = "";
  targetState.publicPresencePendingId = "";
  targetState.publicPresenceState = "";
  window.HariaiOnline?.syncBattlePresenceCheckPanels?.("strategy");
  await disconnect?.cancel?.().catch(() => {});
  if (!id || !ownerUid) return;
  try {
    await remove(ref(database, `online/publicPresence/${id}`));
  } catch {
    return;
  }
  await remove(ref(database, `online/publicPresenceOwners/${id}`)).catch(() => {});
}

function requestHome() {
  if (!active || state.normalRouteBusy) return;
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("通信の終了確認が完了するまでお待ちください。");
  if ((state.finalizationBusy || state.resultClaimCommitted) && !["gameover", "review"].includes(state.screen)) {
    showToast("対戦結果を確定中です。完了するまでお待ちください。");
    return;
  }
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (state.screen === "review") {
    leaveStrategyReview(true).catch(handleRecoverableError);
    return;
  }
  if (["profile", "preDeck", "matching", "gameover", "withdrawn", "noContest", "error"].includes(state.screen)) {
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
  if (state.finalizationBusy || state.resultClaimCommitted) {
    showToast("対戦結果を確定中です。完了するまでお待ちください。");
    return;
  }
  if (state.roomId) {
    const targetState = state;
    const roomId = state.roomId;
    const uid = state.uid;
    const destroyedRef = ref(database, `online/strategyRooms/${roomId}/destroyed`);
    let destroyed = null;
    let committed = false;
    try {
      const result = await runTransaction(destroyedRef, (current) => current || { by: uid, at: Date.now() });
      committed = result.committed === true;
      destroyed = result.snapshot?.val?.() || null;
    } catch (error) {
      console.error(error);
      const snapshot = await get(destroyedRef).catch(() => null);
      if (!active || state !== targetState || state.roomId !== roomId) return;
      destroyed = snapshot?.val?.() || null;
      committed = destroyed?.by === uid;
    }
    if (destroyed?.by && destroyed.by !== uid) {
      await handleOpponentDestroyed();
      return;
    }
    if (!committed || destroyed?.by !== uid) {
      showToast("ルーム破棄を確定できませんでした。通信状態または対戦結果を確認してください。");
      return;
    }
  }
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
  releaseMatchMedia();
  state.screen = "noContest";
  setStrategyChrome("NO CONTEST");
  render();
}

async function cancelMatching() {
  if (state.idleCleanupPending || state.searchIdleGuard?.expired) {
    state.searchIdleGuard?.retry();
    return showToast("検索の終了を安全に確認しています。少し待ってからお試しください。");
  }
  await cleanupMatchmaking(false);
  await cleanupPublicPresence();
  state.screen = "profile";
  setStrategyChrome("STRATEGY READY");
  render();
}

function beginResultNavigation(triggerId = "") {
  if (resultNavigationBusy) return false;
  resultNavigationBusy = true;
  document.querySelectorAll([
    "#strategyNewMatch",
    "#strategyFreeTableLampButton",
    "#strategyFinish",
    "#strategyWithdrawAgain",
    "#strategyWithdrawHome",
    "#strategyNoContestAgain",
    "#strategyNoContestHome",
    "#strategyErrorHome",
  ].join(", ")).forEach((button) => {
    button.setAttribute("disabled", "");
  });
  if (triggerId) {
    document.querySelector(`#${triggerId}`)?.setAttribute("aria-busy", "true");
  }
  return true;
}

async function resetStrategySetup() {
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("前の通信の終了確認が完了するまでお待ちください。");
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (!beginResultNavigation("strategyNewMatch")) return;
  try {
    const main = prepareDeckForRematch(state.main);
    const reserve = prepareDeckForRematch(state.reserve);
    const identity = {
      uid: state.uid,
      authReady: state.authReady,
      name: state.name,
      clues: [...state.clues],
      weaknessIndex: state.weaknessIndex,
      persona: { ...state.persona },
      penaltyConsent: { ...state.penaltyConsent },
      imagePreference: state.imagePreference,
      profile: { ...state.profile },
      economy: state.economy,
      persistDeck: state.persistDeck,
      storedDeckAvailable: state.storedDeckAvailable,
      deckRestoreStatus: state.deckRestoreStatus,
      deckRestoreMessage: state.deckRestoreMessage,
      deckSavedAt: state.deckSavedAt,
      deckMutationVersion: state.deckMutationVersion,
    };
    await cleanupOnlineResources(false);
    releaseMatchMedia();
    state = createState();
    Object.assign(state, identity);
    state.main = main;
    state.reserve = reserve;
    state.screen = "profile";
    setStrategyChrome("STRATEGY READY");
    render();
  } finally {
    resultNavigationBusy = false;
  }
}

function prepareDeckForRematch(items) {
  items.forEach((item) => { item.used = false; });
  return items;
}

async function retryConnection() {
  const main = prepareDeckForRematch(state.main);
  const reserve = prepareDeckForRematch(state.reserve);
  await cleanupOnlineResources(false);
  releaseMatchMedia();
  state = createState();
  state.main = main;
  state.reserve = reserve;
  state.errorMessage = "";
  state.authReady = false;
  state.screen = "profile";
  setStrategyChrome("STRATEGY CONNECTING");
  render();
  ensureAuthenticated().catch(handleFatalError);
}

async function leaveToLanding() {
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("通信の終了確認が完了するまでお待ちください。");
  if (state.normalRouteBusy) return;
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (!beginResultNavigation()) return;
  try {
    state.matchmakingLaunchGeneration += 1;
    state.matchmakingLaunchBusy = false;
    await cleanupOnlineResources(false);
    releaseAllImages();
    active = false;
    window.HariaiApp?.returnHome?.();
  } finally {
    resultNavigationBusy = false;
  }
}

async function leaveToNormal1on1() {
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("通信の終了確認が完了するまでお待ちください。");
  if (!active || state.normalRouteBusy) return;
  const targetState = state;
  targetState.normalRouteBusy = true;
  targetState.matchmakingLaunchGeneration += 1;
  targetState.matchmakingLaunchBusy = false;
  renderStrategyDeckIfVisible();
  try {
    await cleanupOnlineResources(false);
    releaseAllImages();
    active = false;
    const openNormal1on1 = window.HariaiApp?.openNormal1on1;
    if (typeof openNormal1on1 === "function") openNormal1on1();
    else window.HariaiApp?.returnHome?.();
  } catch (error) {
    if (active && state === targetState) {
      targetState.normalRouteBusy = false;
      renderStrategyDeckIfVisible();
    }
    handleRecoverableError(error);
  }
}

async function leaveToFreeTable() {
  if (state.idleCleanupPending || state.idleCleanupPromise) return showToast("通信の終了確認が完了するまでお待ちください。");
  if (isPostMatchTipBusy("strategy", state.roomId, state.uid)) {
    showToast("差し入れの送信が終わるまでお待ちください。");
    return;
  }
  if (!beginResultNavigation("strategyFreeTableLampButton")) return;
  try {
    state.matchmakingLaunchGeneration += 1;
    state.matchmakingLaunchBusy = false;
    await cleanupOnlineResources(false);
    releaseAllImages();
    active = false;
    const openFreeTable = window.HariaiApp?.openFreeTable;
    if (typeof openFreeTable === "function") openFreeTable({ intent: "lamp" });
    else window.HariaiApp?.returnHome?.();
  } finally {
    resultNavigationBusy = false;
  }
}

async function cleanupMatchmaking(keepActive, { targetState = state, skipServerWrites = false } = {}) {
  const uid = targetState.uid;
  const joinedAt = targetState.queueJoinedAt;
  const queueRecovery = targetState.queueRecoveryPromise;
  const pendingOffer = targetState.pendingOffer;
  const ownedOfferRoomId = pendingOffer?.roomId || targetState.acceptingOfferRoomId
    || targetState.pendingIncomingOffer?.roomId || targetState.safetyProposal?.roomId;
  const ownedActiveRoomId = targetState.roomId || ownedOfferRoomId;
  targetState.searchIdleGuard?.dispose();
  targetState.searchIdleGuard = null;
  targetState.matchmakingGeneration = ++strategyMatchmakingGenerationCounter;
  targetState.matchmakingConnected = false;
  targetState.queueConnectionEpoch += 1;
  stopStrategyOfferWatch(targetState.hostOfferWatch);
  targetState.hostOfferWatch = null;
  window.clearTimeout(targetState.matchScopeTimer);
  window.clearInterval(targetState.queueHeartbeat);
  window.clearInterval(targetState.offerPollTimer);
  targetState.matchScopeTimer = null;
  targetState.matchScopeAvailable = false;
  targetState.matchScopeExpanded = false;
  targetState.queueHeartbeat = null;
  targetState.offerPollTimer = null;
  targetState.matchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  targetState.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  const queueDisconnect = targetState.queueDisconnect;
  targetState.queueDisconnect = null;
  const cancelQueueDisconnect = queueStrategyDisconnectOperation(() => queueDisconnect?.cancel().catch(() => {}));
  targetState.pendingOffer = null;
  targetState.pendingIncomingOffer = null;
  targetState.safetyProposal = null;
  if (!uid) return;
  // Finish any in-flight repair before a subsequent attempt can register its
  // onDisconnect callback on the same Firebase connection and UID path.
  await Promise.allSettled([cancelQueueDisconnect, queueRecovery]);
  if (skipServerWrites) return;
  const removals = [removeStrategyQueueEntryIfCurrent(ref(database, `online/strategyQueue/${uid}`), joinedAt)];
  if (!keepActive && ownedActiveRoomId) removals.push(runTransaction(ref(database, `online/strategyActive/${uid}`),
    (value) => value === null || value === ownedActiveRoomId ? null : undefined));
  if (ownedOfferRoomId && !keepActive) removals.push(requestSafety("strategy_expire", { roomId: ownedOfferRoomId }));
  await Promise.allSettled(removals);
}

async function cleanupOnlineResources(keepActive, { targetState = state, skipServerWrites = false } = {}) {
  clearActiveContact("strategy");
  const roomId = targetState.roomId;
  const uid = targetState.uid;
  stopStrategyPrestartGuard(targetState);
  stopReviewClock();
  stopStrategyVideoRecording({ discard: true });
  targetState.roomUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe?.());
  targetState.disconnectHandles.splice(0).forEach((handle) => handle.cancel?.().catch(() => {}));
  if (targetState.peer) {
    targetState.peer.onicecandidate = null;
    targetState.peer.ondatachannel = null;
    targetState.peer.onconnectionstatechange = null;
    targetState.peer.close();
  }
  for (const channel of [targetState.channel, targetState.videoChannel, targetState.reviewAssetChannel]) {
    if (!channel) continue;
    channel.onopen = null; channel.onclose = null; channel.onerror = null; channel.onmessage = null;
    channel.close();
  }
  targetState.peer = null;
  targetState.channel = null;
  targetState.channelReady = false;
  targetState.videoChannel = null;
  targetState.videoChannelReady = false;
  targetState.incomingVideoTransfer = null;
  targetState.reviewAssetChannel = null;
  targetState.reviewAssetChannelReady = false;
  targetState.opponentReviewMediaReceiving = false;
  targetState.incomingReviewAssetTransfer = null;
  await cleanupMatchmaking(keepActive, { targetState, skipServerWrites });
  await cleanupPublicPresence(targetState);
  if (roomId && !skipServerWrites) {
    await Promise.allSettled([
      set(ref(database, `online/strategyRooms/${roomId}/presence/${uid}`), { online: false, updatedAt: serverTimestamp() }),
      keepActive ? Promise.resolve() : runTransaction(ref(database, `online/strategyActive/${uid}`),
        (value) => value === null || value === roomId ? null : undefined),
    ]);
  }
}

function releaseMatchMedia() {
  state.remoteImages.forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    releaseCardAudio(item);
  });
  state.remoteImages.clear();
  releaseRemoteAvatar();
  releaseStrategyVideoData();
  releaseStrategyReviewAssetData();
  state.chatMessages = [];
  state.seenChatIds.clear();
}

function releaseAllImages() {
  [...state.main, ...state.reserve].forEach((item) => {
    if (item.url) URL.revokeObjectURL(item.url);
    releaseCardAudio(item);
    item.url = "";
    item.blob = null;
  });
  releaseMatchMedia();
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
  state.searchIdleGuard?.dispose();
  stopStrategyPrestartGuard();
  stopReviewClock();
  releaseAllImages();
  state.peer?.close();
});

document.addEventListener("visibilitychange", () => {
  if (!active) return;
  state.searchIdleGuard?.sync();
  state.prestartGuard?.sync();
  updateStrategyIdleNotice();
});

window.addEventListener("hariai-ranking-dashboard-updated", () => {
  if (active && state.screen === "profile") updateStrategyCrownMatchmakingActions();
});

window.addEventListener(
  "hariai-free-table-public-stats-updated",
  syncStrategyFreeTableResultLamp,
);

window.HariaiStrategy = { start, isActive, requestHome, destroyRoom };
window.dispatchEvent(new CustomEvent("hariai-strategy-ready"));
