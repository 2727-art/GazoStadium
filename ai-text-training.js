import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  doc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  auth,
  firestore,
  functions,
  useOfflineMarketPreview,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1";
import {
  formatAnjuPay,
  formatAnjuPayNumber,
} from "./anju-pay-format.mjs?v=anju-pay-format-v1";
import {
  AI_TEXT_TRAINING_BUILTIN_SCRIPTS,
  AI_TEXT_TRAINING_EXERCISES,
  AI_TEXT_TRAINING_MODES,
  AI_TEXT_TRAINING_REACTIONS,
  AI_TEXT_TRAINING_ROUND_COUNT,
  AI_TEXT_TRAINING_SCRIPT_SLOTS,
  aiTextTrainingExercise,
  aiTextTrainingMessageCadenceMs,
  aiTextTrainingMode,
  aiTextTrainingScriptSlot,
  aiTextTrainingTempoBand,
  aiTextTrainingTempoDirection,
  applyAiTextTrainingReaction,
  createAiTextTrainingPlan,
  normalizeAiTextTrainingBpm,
  normalizeAiTextTrainingScriptSnapshot,
  pickAiTextTrainingLine,
  renderAiTextTrainingLine,
} from "./ai-text-training-core.mjs?v=ai-text-training-core-v1";
import {
  AI_TEXT_TRAINING_ROSTER_MAX_COUNT,
  drawAiTextTrainingRosterIndices,
  isAiTextTrainingRosterCount,
  normalizeAiTextTrainingDrawIndices,
} from "./ai-text-training-roster.mjs?v=ai-text-training-roster-v1";
import {
  AI_TEXT_TRAINING_STYLE_PRODUCTS,
  aiTextTrainingCosmeticsAreOwned,
  getAiTextTrainingStyleProduct,
  normalizeAiTextTrainingCosmetics,
} from "./ai-text-training-cosmetics.js?v=ai-text-training-cosmetics-v2";
import {
  createFreeTableAmbienceController,
  normalizeFreeTableAmbienceToneProfileId,
} from "./free-table-ambience.mjs?v=free-table-ambience-v2";

const appRoot = document.querySelector("#app");
const aiTextTrainingAction = httpsCallable(functions, "aiTextTrainingAction");
const economyActionCallable = httpsCallable(functions, "economyAction");
const PROFILE_NAME_KEY = "hariai-stadium-online-name-v1";
const SESSION_STORAGE_KEY = "hariai-ai-text-training-session-v1";
const ACHIEVEMENT_RETRY_QUEUE_KEY = "hariai-ai-text-training-achievement-retry-v1";
const DAILY_COMPLETE_PREFIX = "hariai-ai-text-training-daily-v1:";
const DECK_PERSISTENCE_KEY = "hariai-ai-text-training-deck-persistence-v1";
const BEAT_CHARACTER_PREFERENCE_KEY = "hariai-ai-text-training-beat-character-v1";
const DECK_DATABASE_NAME = "hariai-ai-text-training-deck-v1";
const DECK_STORE_NAME = "decks";
const DECK_RECORD_KEY = "latest";
const X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクは台本作者が自己申告したものです。運営は作者とXアカウントの本人確認も、リンク先の内容確認も行っていません。外部サイトのXへ移動しますか？";
const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost"]);
const PREVIEW_SCREENS = new Set([
  "setup",
  "market",
  "editor",
  "purchase",
  "draw",
  "play",
  "reaction",
  "result",
  "safety",
  "rankings",
]);
const REPORT_REASONS = Object.freeze([
  Object.freeze({ id: "dangerous", label: "危険な運動指示" }),
  Object.freeze({ id: "harassment", label: "人格否定・脅迫・差別" }),
  Object.freeze({ id: "sexual", label: "性的・不適切な家族表現" }),
  Object.freeze({ id: "privacy", label: "個人情報・プライバシー" }),
  Object.freeze({ id: "external", label: "外部連絡・外部取引への誘導" }),
  Object.freeze({ id: "other", label: "その他" }),
]);
const ROUND_SECONDS_OPTIONS = Object.freeze([15, 20, 30, 45, 60]);
const DEFAULT_BPMS = Object.freeze([80, 90, 100, 110, 120]);
const DEFAULT_ROSTER_BPMS = Object.freeze([
  80, 90, 100, 110, 120,
  80, 90, 100, 110, 120,
]);
const AI_TEXT_TRAINING_BEAT_CHARACTERS = Object.freeze([
  Object.freeze({
    id: "heavy_pulse",
    label: "重厚パルス",
    description: "低く太い、渋く落ち着いたビート",
    glyph: "LOW",
  }),
  Object.freeze({
    id: "soft_bell",
    label: "まろやかベル",
    description: "丸く柔らかい、包み込むようなビート",
    glyph: "SOFT",
  }),
  Object.freeze({
    id: "clear_tap",
    label: "クリアタップ",
    description: "聞き取りやすい、現在の標準に近いビート",
    glyph: "CLEAR",
  }),
  Object.freeze({
    id: "glass_spark",
    label: "グラススパーク",
    description: "高く軽快で、若々しい印象のビート",
    glyph: "HIGH",
  }),
  Object.freeze({
    id: "machine_ai",
    label: "無機質AI",
    description: "感情を抑えた、電子的なビート",
    glyph: "AI",
  }),
]);
const DEFAULT_BEAT_CHARACTER_ID = "clear_tap";
const SESSION_SCHEMA_VERSION = 2;
const DECK_SCHEMA_VERSION = 2;
const DEFAULT_POLICY = Object.freeze({
  prices: Object.freeze([5, 10, 25]),
  publishFee: 1,
  successFeeBasisPoints: 2_000,
  minimumSuccessFee: 1,
  rankingPairDailyLimit: 1,
  oneActivePaidUseAtATime: true,
  verifiedBuyerQuarantineThreshold: 3,
});

let active = false;
let state = createState();
let achievementRetryFlushPromise = null;

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

function normalizeBeatCharacterId(value) {
  return normalizeFreeTableAmbienceToneProfileId(value);
}

function beatCharacter(value = state.beatCharacterId) {
  const normalized = normalizeBeatCharacterId(value);
  return AI_TEXT_TRAINING_BEAT_CHARACTERS.find((character) => character.id === normalized)
    || AI_TEXT_TRAINING_BEAT_CHARACTERS[2];
}

function setBusy(busy, message = "") {
  shared()?.setBusy?.(busy, message);
}

function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function generatedActionId(prefix) {
  const token = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${token}`.slice(0, 80);
}

function previewRequest() {
  if (!LOCAL_PREVIEW_HOSTS.has(location.hostname)) return "";
  const requested = new URLSearchParams(location.search).get("aiTextTrainingPreview") || "";
  return PREVIEW_SCREENS.has(requested) ? requested : "";
}

function readLocalValue(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocalValue(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function storedSession() {
  try {
    const parsed = JSON.parse(readLocalValue(SESSION_STORAGE_KEY, "null"));
    if (!parsed || ![1, SESSION_SCHEMA_VERSION].includes(Number(parsed.schemaVersion))) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeAchievementOwnerUid(value) {
  if (typeof value !== "string") return "";
  const uid = value.trim();
  if (!uid || uid.length > 128 || /[\u0000-\u001f\u007f]/u.test(uid)) return "";
  return uid;
}

function currentAchievementOwner() {
  const ownerUid = normalizeAchievementOwnerUid(auth.currentUser?.uid);
  return ownerUid
    ? { ownerState: "bound", ownerUid }
    : { ownerState: "pending", ownerUid: "" };
}

function achievementRetryOwnerMatches(record, owner) {
  if (!record || !owner || record.ownerState !== owner.ownerState) return false;
  if (owner.ownerState === "pending") return !record.ownerUid && !owner.ownerUid;
  return Boolean(owner.ownerUid) && record.ownerUid === owner.ownerUid;
}

function sanitizeAchievementRetryRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requestedOwnerState = String(value.ownerState || "pending");
  const requestedOwnerUid = normalizeAchievementOwnerUid(value.ownerUid);
  let ownerState = "pending";
  let ownerUid = "";
  if (requestedOwnerState === "bound") {
    if (!requestedOwnerUid) return null;
    ownerState = "bound";
    ownerUid = requestedOwnerUid;
  } else if (requestedOwnerState !== "pending" || requestedOwnerUid) {
    return null;
  }
  const actionId = String(value.actionId || "");
  const modeId = String(value.modeId || "");
  const roundSeconds = Number(value.roundSeconds);
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(actionId)
      || !AI_TEXT_TRAINING_MODES.some((mode) => mode.id === modeId)
      || !ROUND_SECONDS_OPTIONS.includes(roundSeconds)) {
    return null;
  }
  const sessionId = /^[a-f0-9]{40}$/u.test(String(value.sessionId || ""))
    ? String(value.sessionId)
    : "";
  const outcome = ["completed", "safety_stopped", "exited"].includes(value.outcome)
    ? value.outcome
    : "";
  const completedRounds = Number.isSafeInteger(Number(value.completedRounds))
    ? Math.max(0, Math.min(AI_TEXT_TRAINING_ROUND_COUNT, Number(value.completedRounds)))
    : 0;
  const maximumActiveSeconds = roundSeconds * AI_TEXT_TRAINING_ROUND_COUNT;
  const activeSeconds = Number.isFinite(Number(value.activeSeconds))
    ? Math.max(0, Math.min(maximumActiveSeconds, Number(value.activeSeconds)))
    : 0;
  return {
    ownerState,
    ownerUid,
    actionId,
    modeId,
    roundSeconds,
    sessionId,
    outcome,
    completedRounds,
    activeSeconds,
  };
}

function readAchievementRetryQueue() {
  try {
    const parsed = JSON.parse(readLocalValue(ACHIEVEMENT_RETRY_QUEUE_KEY, "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeAchievementRetryRecord)
      .filter(Boolean)
      .slice(-12);
  } catch {
    return [];
  }
}

function writeAchievementRetryQueue(records) {
  const sanitized = (Array.isArray(records) ? records : [])
    .map(sanitizeAchievementRetryRecord)
    .filter(Boolean)
    .slice(-12);
  if (!sanitized.length) {
    removeLocalValue(ACHIEVEMENT_RETRY_QUEUE_KEY);
    return [];
  }
  writeLocalValue(ACHIEVEMENT_RETRY_QUEUE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

function upsertAchievementRetryRecord(value) {
  const incoming = sanitizeAchievementRetryRecord(value);
  if (!incoming) return null;
  const records = readAchievementRetryQueue();
  const index = records.findIndex((record) => record.actionId === incoming.actionId);
  if (index >= 0) {
    const previous = records[index];
    const outcome = incoming.outcome || previous.outcome;
    const owner = previous.ownerState === "bound"
      ? { ownerState: "bound", ownerUid: previous.ownerUid }
      : incoming.ownerState === "bound"
        ? { ownerState: "bound", ownerUid: incoming.ownerUid }
        : { ownerState: "pending", ownerUid: "" };
    records[index] = sanitizeAchievementRetryRecord({
      ...previous,
      ...incoming,
      ...owner,
      sessionId: incoming.sessionId || previous.sessionId,
      outcome,
      completedRounds: incoming.outcome
        ? incoming.completedRounds
        : previous.outcome
          ? previous.completedRounds
          : incoming.completedRounds,
      activeSeconds: incoming.outcome
        ? incoming.activeSeconds
        : previous.outcome
          ? previous.activeSeconds
          : incoming.activeSeconds,
    });
  } else {
    records.push(incoming);
  }
  return writeAchievementRetryQueue(records)
    .find((record) => record.actionId === incoming.actionId) || null;
}

function bindPendingAchievementRetryRecords(ownerUidValue) {
  const ownerUid = normalizeAchievementOwnerUid(ownerUidValue);
  const records = readAchievementRetryQueue();
  if (!ownerUid) return records;
  let changed = false;
  const bound = records.map((record) => {
    if (record.ownerState === "bound") return record;
    changed = true;
    return sanitizeAchievementRetryRecord({
      ...record,
      ownerState: "bound",
      ownerUid,
    });
  }).filter(Boolean);
  return changed ? writeAchievementRetryQueue(bound) : bound;
}

function currentAchievementRetryRecord() {
  if (!state.achievementActionId) return null;
  return readAchievementRetryQueue()
    .find((record) => record.actionId === state.achievementActionId) || null;
}

function notifyAchievementUnlocks(idsValue) {
  const normalizedIds = window.HariaiAchievements?.normalizeIds?.(idsValue)
    || (Array.isArray(idsValue)
      ? [...new Set(idsValue
        .map((id) => String(id || ""))
        .filter((id) => /^[a-z0-9_]{1,80}$/u.test(id)))]
      : []);
  const ids = normalizedIds
    .filter((id) => !state.notifiedAchievementIds.has(id));
  if (!ids.length) return;
  ids.forEach((id) => state.notifiedAchievementIds.add(id));
  window.dispatchEvent(new CustomEvent(
    "hariai-achievements-unlocked",
    { detail: { ids } },
  ));
  economyActionCallable({
    action: "ack_achievements",
    achievementIds: ids,
  }).catch(() => {
    ids.forEach((id) => state.notifiedAchievementIds.delete(id));
  });
}

function flushAchievementRetryQueue() {
  if (achievementRetryFlushPromise) return achievementRetryFlushPromise;
  const authenticatedUid = normalizeAchievementOwnerUid(auth.currentUser?.uid);
  if (state.preview || !authenticatedUid) return Promise.resolve(false);
  achievementRetryFlushPromise = (async () => {
    state.achievementRetryInFlight = true;
    state.achievementRetryError = "";
    let allSucceeded = true;
    try {
      const records = bindPendingAchievementRetryRecords(authenticatedUid);
      const authenticatedOwner = { ownerState: "bound", ownerUid: authenticatedUid };
      for (const queuedRecord of records) {
        if (!achievementRetryOwnerMatches(queuedRecord, authenticatedOwner)) {
          continue;
        }
        if (normalizeAchievementOwnerUid(auth.currentUser?.uid) !== authenticatedUid) {
          allSucceeded = false;
          break;
        }
        try {
          let record = readAchievementRetryQueue()
            .find((item) => item.actionId === queuedRecord.actionId);
          if (!record
              || record.ownerState !== "bound"
              || record.ownerUid !== authenticatedUid) {
            continue;
          }
          if (!record.sessionId) {
            const response = await aiTextTrainingAction({
              action: "begin_achievement_session",
              actionId: record.actionId,
              modeId: record.modeId,
              roundSeconds: record.roundSeconds,
            });
            const sessionId = String(response.data?.session?.id || "");
            if (!/^[a-f0-9]{40}$/u.test(sessionId)) {
              throw new Error("実績記録の開始を確認できませんでした。");
            }
            const latest = readAchievementRetryQueue()
              .find((item) => item.actionId === record.actionId);
            if (!latest
                || latest.ownerState !== "bound"
                || latest.ownerUid !== authenticatedUid) {
              continue;
            }
            record = upsertAchievementRetryRecord({ ...latest, sessionId });
            if (state.achievementActionId === queuedRecord.actionId) {
              state.achievementSessionId = sessionId;
              persistSession();
            }
          }
          if (!record?.outcome) continue;
          if (normalizeAchievementOwnerUid(auth.currentUser?.uid) !== authenticatedUid) {
            allSucceeded = false;
            break;
          }
          const response = await aiTextTrainingAction({
            action: "finish_achievement_session",
            sessionId: record.sessionId,
            outcome: record.outcome,
            completedRounds: record.completedRounds,
            activeSeconds: record.activeSeconds,
          });
          writeAchievementRetryQueue(
            readAchievementRetryQueue()
              .filter((item) => item.actionId !== record.actionId),
          );
          if (state.achievementActionId === record.actionId) {
            state.achievementSessionId = String(
              response.data?.session?.id || record.sessionId,
            );
            persistSession();
          }
          notifyAchievementUnlocks(response.data?.newlyUnlocked);
        } catch (error) {
          allSucceeded = false;
          state.achievementRetryError = error?.message
            || "実績記録を送信できませんでした。";
        }
      }
      return allSucceeded;
    } finally {
      state.achievementRetryInFlight = false;
    }
  })().finally(() => {
    achievementRetryFlushPromise = null;
    if (active && state.screen === "result") render();
  });
  return achievementRetryFlushPromise;
}

function createState() {
  const persistDeck = readLocalValue(DECK_PERSISTENCE_KEY) === "true";
  const beatCharacterId = normalizeBeatCharacterId(
    readLocalValue(BEAT_CHARACTER_PREFERENCE_KEY, DEFAULT_BEAT_CHARACTER_ID),
  );
  const ambienceController = createFreeTableAmbienceController({ initialVolume: 0.16 });
  return {
    generation: 0,
    preview: "",
    screen: "setup",
    phase: "idle",
    previousRenderedScreen: "",
    authReady: false,
    authSettled: false,
    authError: "",
    uid: "",
    balance: 0,
    policy: { ...DEFAULT_POLICY, prices: [...DEFAULT_POLICY.prices] },
    marketPresets: [],
    ownPresets: [],
    profile: { xPublic: false, xHandle: "" },
    cosmetics: {
      panelThemeId: "",
      messageDecorationId: "",
      ownedStyleIds: [],
    },
    cosmeticDraft: null,
    cosmeticBusy: false,
    sessionCosmetics: null,
    activeUse: null,
    selectedPreset: normalizeAiTextTrainingScriptSnapshot(
      AI_TEXT_TRAINING_BUILTIN_SCRIPTS.mama,
    ),
    selectedPresetSource: "builtin",
    selectedMarketPresetId: "",
    marketModeFilter: "mama",
    rankingPeriod: "monthly",
    ranking: null,
    rankingLoading: false,
    rankingError: "",
    modeId: "mama",
    exerciseId: "march",
    roundSeconds: 20,
    rosterImages: Array(AI_TEXT_TRAINING_ROSTER_MAX_COUNT).fill(null),
    rosterBpms: [...DEFAULT_ROSTER_BPMS],
    rosterExpanded: false,
    pendingDrawIndices: [],
    sessionDrawIndices: [],
    drawLeg: 1,
    recoveryRosterCount: 0,
    recoveryError: "",
    images: Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null),
    bpms: [...DEFAULT_BPMS],
    beatCharacterId,
    sessionBeatCharacterId: beatCharacterId,
    persistDeck,
    storedDeckAvailable: false,
    initialDeckRestorePromise: null,
    plan: null,
    roundIndex: 0,
    remainingMs: 20_000,
    roundEndsAt: 0,
    countdownValue: 3,
    countdownTimer: null,
    ticker: null,
    messageTimer: null,
    beatPreviewTimer: null,
    currentMessage: "",
    lastMessage: "",
    lastAnnouncedSecond: null,
    sessionStartedAt: 0,
    completedActiveSeconds: 0,
    completedRounds: 0,
    resultOutcome: "",
    achievementActionId: "",
    achievementSessionId: "",
    achievementBeginRequested: false,
    achievementRetryInFlight: false,
    achievementRetryError: "",
    notifiedAchievementIds: new Set(),
    paidUseId: "",
    purchaseActionId: "",
    pendingPaidPreset: null,
    finishPending: false,
    finishInFlight: false,
    editorDraft: null,
    editorActionId: "",
    editorPreview: {
      phase: "active",
      bpm: 80,
      remaining: 10,
      direction: "same",
    },
    busyAction: "",
    unsubscribeWallet: null,
    wakeLock: null,
    ambienceController,
    ambienceRevision: 0,
    muted: false,
  };
}

function modeIsActiveElsewhere() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiTraining?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiAccount?.isActive?.()
  );
}

function setModeChrome() {
  const status = document.querySelector(".status-dot");
  if (status) status.innerHTML = "<i></i> SOLO TRAINING";
  const privacy = document.querySelector(".privacy-badge");
  if (privacy) privacy.textContent = "最大10画像は端末内";
  document.title = "AIと対戦しよう 文字コラトレーニング | 貼り合いスタジアム";
}

function releaseImage(item) {
  if (item?.url?.startsWith("blob:")) URL.revokeObjectURL(item.url);
}

function releaseRosterImages() {
  state.rosterImages.forEach(releaseImage);
  state.rosterImages = Array(AI_TEXT_TRAINING_ROSTER_MAX_COUNT).fill(null);
  state.images = Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null);
}

function stopRuntimeTimers() {
  window.clearInterval(state.ticker);
  window.clearInterval(state.countdownTimer);
  window.clearTimeout(state.messageTimer);
  window.clearTimeout(state.beatPreviewTimer);
  state.ticker = null;
  state.countdownTimer = null;
  state.messageTimer = null;
  state.beatPreviewTimer = null;
  state.roundEndsAt = 0;
}

async function releaseWakeLock() {
  const sentinel = state.wakeLock;
  state.wakeLock = null;
  if (!sentinel || sentinel.released) return;
  try {
    await sentinel.release();
  } catch {
    // Wake Lock is only a convenience; the session remains usable.
  }
}

async function acquireWakeLock() {
  if (!active
      || state.phase !== "playing"
      || document.visibilityState !== "visible"
      || !navigator.wakeLock?.request) return;
  await releaseWakeLock();
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (!active || state.phase !== "playing") {
      await sentinel.release();
      return;
    }
    state.wakeLock = sentinel;
    sentinel.addEventListener("release", () => {
      if (state.wakeLock === sentinel) state.wakeLock = null;
    }, { once: true });
  } catch {
    // Some browsers or battery modes deny Wake Lock. Training still continues.
  }
}

function persistSession() {
  if (!state.plan || !["play", "result"].includes(state.screen)) return;
  const remainingMs = state.phase === "playing" && state.roundEndsAt
    ? Math.max(0, state.roundEndsAt - performance.now())
    : state.remainingMs;
  const payload = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    paidUseId: state.paidUseId,
    modeId: state.modeId,
    exerciseId: state.exerciseId,
    roundSeconds: state.roundSeconds,
    bpms: [...state.bpms],
    rosterCount: rosterEntries().length,
    drawIndices: [...state.sessionDrawIndices],
    drawLeg: state.drawLeg === 2 ? 2 : 1,
    beatCharacterId: state.sessionBeatCharacterId,
    plan: state.plan,
    roundIndex: state.roundIndex,
    remainingMs,
    phase: state.phase === "playing" || state.phase === "countdown"
      ? "paused"
      : state.phase,
    completedActiveSeconds: state.completedActiveSeconds,
    completedRounds: state.completedRounds,
    sessionStartedAt: state.sessionStartedAt,
    achievementActionId: state.achievementActionId,
    achievementSessionId: state.achievementSessionId,
    achievementBeginRequested: state.achievementBeginRequested,
    selectedPreset: state.selectedPreset,
    selectedPresetSource: state.selectedPresetSource,
    cosmetics: state.sessionCosmetics,
    resultOutcome: state.resultOutcome,
    updatedAt: Date.now(),
  };
  try {
    writeLocalValue(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Local recovery is best-effort; paid server receipt remains resumable.
  }
}

function clearPersistedSession() {
  removeLocalValue(SESSION_STORAGE_KEY);
}

function rosterEntries() {
  return state.rosterImages.flatMap((image, slotIndex) => (
    image
      ? [{
        image,
        bpm: state.rosterBpms[slotIndex],
        slotIndex,
      }]
      : []
  ));
}

function invalidatePendingDraw() {
  state.pendingDrawIndices = [];
  state.drawLeg = 1;
}

function openDeckDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("このブラウザーは画像の端末保存に対応していません。"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DECK_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DECK_STORE_NAME)) {
        request.result.createObjectStore(DECK_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("保存領域を開けませんでした。"));
  });
}

async function writeStoredDeck() {
  const entries = rosterEntries();
  if (!state.persistDeck
      || !isAiTextTrainingRosterCount(entries.length)
      || entries.some((entry) => !entry.image?.blob)) {
    return false;
  }
  const database = await openDeckDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DECK_STORE_NAME, "readwrite");
      transaction.objectStore(DECK_STORE_NAME).put({
        schemaVersion: DECK_SCHEMA_VERSION,
        items: entries.map((entry) => ({
          blob: entry.image.blob,
          bpm: entry.bpm,
        })),
        updatedAt: Date.now(),
      }, DECK_RECORD_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("画像を保存できませんでした。"));
      transaction.onabort = () => reject(transaction.error || new Error("画像の保存が中断されました。"));
    });
    state.storedDeckAvailable = true;
    return true;
  } finally {
    database.close();
  }
}

async function readStoredDeck() {
  const database = await openDeckDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DECK_STORE_NAME, "readonly");
      const request = transaction.objectStore(DECK_STORE_NAME).get(DECK_RECORD_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("保存画像を読み込めませんでした。"));
    });
  } finally {
    database.close();
  }
}

async function deleteStoredDeck() {
  const database = await openDeckDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DECK_STORE_NAME, "readwrite");
      transaction.objectStore(DECK_STORE_NAME).delete(DECK_RECORD_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("保存画像を削除できませんでした。"));
    });
    state.storedDeckAvailable = false;
  } finally {
    database.close();
  }
}

function normalizeStoredRosterRecord(value) {
  const source = value && typeof value === "object" ? value : null;
  const schemaVersion = Number(source?.schemaVersion);
  const items = Array.isArray(source?.items) ? source.items : [];
  const validItemCount = schemaVersion === 1
    ? items.length === AI_TEXT_TRAINING_ROUND_COUNT
    : schemaVersion === DECK_SCHEMA_VERSION
      ? isAiTextTrainingRosterCount(items.length)
      : false;
  if (!validItemCount) {
    return null;
  }
  const normalizedItems = items.map((item) => ({
    blob: item?.blob || null,
    bpm: normalizeAiTextTrainingBpm(item?.bpm),
  }));
  if (normalizedItems.some((item) => !item.blob || item.bpm === null)) return null;
  return {
    schemaVersion,
    items: normalizedItems,
    updatedAt: Number(source.updatedAt) || 0,
  };
}

async function restoreStoredDeck({ quiet = false } = {}) {
  const targetState = state;
  const targetGeneration = targetState.generation;
  const rosterSnapshot = [...targetState.rosterImages];
  const bpmSnapshot = [...targetState.rosterBpms];
  if (!active || targetState.screen !== "setup" || targetState.plan) return false;
  try {
    const record = await readStoredDeck();
    const normalizedRecord = normalizeStoredRosterRecord(record);
    const storedItems = normalizedRecord?.items || [];
    if (!active
        || state !== targetState
        || targetState.generation !== targetGeneration
        || targetState.screen !== "setup"
        || targetState.plan
        || targetState.rosterImages.some((item, index) => item !== rosterSnapshot[index])
        || targetState.rosterBpms.some((bpm, index) => bpm !== bpmSnapshot[index])) {
      return false;
    }
    targetState.storedDeckAvailable = Boolean(normalizedRecord);
    if (!targetState.persistDeck || !targetState.storedDeckAvailable) return false;
    const nextImages = Array(AI_TEXT_TRAINING_ROSTER_MAX_COUNT).fill(null);
    const nextBpms = [...DEFAULT_ROSTER_BPMS];
    storedItems.forEach((item, index) => {
      nextImages[index] = {
        id: `stored-${index}-${Date.now()}`,
        blob: item.blob,
        url: URL.createObjectURL(item.blob),
        position: index,
        used: false,
        isSample: false,
      };
      nextBpms[index] = normalizeAiTextTrainingBpm(item.bpm) ?? DEFAULT_ROSTER_BPMS[index];
    });
    releaseRosterImages();
    targetState.rosterImages = nextImages;
    targetState.rosterBpms = nextBpms;
    targetState.rosterExpanded = storedItems.length > AI_TEXT_TRAINING_ROUND_COUNT;
    invalidatePendingDraw();
    if (!quiet) showToast(`この端末に保存した${storedItems.length}枚のロスターを読み込みました。`);
    if (active && state === targetState && targetState.screen === "setup") render();
    return true;
  } catch (error) {
    if (!quiet) showToast(error?.message || "保存画像を読み込めませんでした。");
    return false;
  }
}

async function persistRosterIfConsented() {
  if (!state.persistDeck) return;
  if (isAiTextTrainingRosterCount(rosterEntries().length)) {
    await writeStoredDeck();
    return;
  }
  await deleteStoredDeck();
}

function presetSnapshot(value) {
  const source = value && typeof value === "object" ? value : {};
  return normalizeAiTextTrainingScriptSnapshot({
    ...source,
    authorName: source.authorName || source.sellerName,
  }, source.modeId || state.modeId);
}

function selectedPresetForMode() {
  if (state.activeUse?.preset) {
    state.modeId = state.activeUse.preset.modeId;
    state.selectedPreset = presetSnapshot(state.activeUse.preset);
    state.selectedPresetSource = "active_use";
    return state.selectedPreset;
  }
  if (state.selectedPreset?.modeId === state.modeId) return state.selectedPreset;
  state.selectedPreset = normalizeAiTextTrainingScriptSnapshot(
    AI_TEXT_TRAINING_BUILTIN_SCRIPTS[state.modeId],
  );
  state.selectedPresetSource = "builtin";
  return state.selectedPreset;
}

function normalizeServerCosmetics(value) {
  const source = value && typeof value === "object" ? value : {};
  const ownedStyleIds = AI_TEXT_TRAINING_STYLE_PRODUCTS
    .map((product) => product.id)
    .filter((productId) => Array.isArray(source.ownedStyleIds)
      && source.ownedStyleIds.includes(productId));
  return {
    ...normalizeAiTextTrainingCosmetics(source, { ownedStyleIds }),
    ownedStyleIds,
  };
}

function equippedCosmetics() {
  return normalizeAiTextTrainingCosmetics(state.cosmetics, {
    ownedStyleIds: state.cosmetics?.ownedStyleIds,
  });
}

function previewCosmetics() {
  return state.cosmeticDraft
    ? normalizeAiTextTrainingCosmetics(state.cosmeticDraft, { allowUnowned: true })
    : equippedCosmetics();
}

function activeCosmetics() {
  if (["play", "result"].includes(state.screen) && state.sessionCosmetics) {
    return normalizeAiTextTrainingCosmetics(state.sessionCosmetics, {
      ownedStyleIds: state.cosmetics?.ownedStyleIds,
    });
  }
  if (state.screen === "setup") return previewCosmetics();
  return equippedCosmetics();
}

function cosmeticDataAttributes(value = activeCosmetics()) {
  const cosmetics = normalizeAiTextTrainingCosmetics(value, { allowUnowned: true });
  return `data-att-panel-theme="${escapeHtml(cosmetics.panelThemeId || "default")}" data-att-message-decoration="${escapeHtml(cosmetics.messageDecorationId || "default")}"`;
}

function sameCosmetics(left, right) {
  const normalizedLeft = normalizeAiTextTrainingCosmetics(left, { allowUnowned: true });
  const normalizedRight = normalizeAiTextTrainingCosmetics(right, { allowUnowned: true });
  return normalizedLeft.panelThemeId === normalizedRight.panelThemeId
    && normalizedLeft.messageDecorationId === normalizedRight.messageDecorationId;
}

function previewImageData(index) {
  const colors = [
    "#ff6f91", "#8f7cff", "#50d6c7", "#f6b84b", "#ff875f",
    "#4d8dff", "#ec69d4", "#71c96b", "#ff5c65", "#7381a8",
  ];
  const label = `IMAGE ${index + 1}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[index]}"/><stop offset="1" stop-color="#11162a"/></linearGradient></defs><rect width="720" height="960" fill="url(#g)"/><circle cx="360" cy="360" r="180" fill="rgba(255,255,255,.14)"/><text x="360" y="500" fill="white" font-family="sans-serif" font-size="64" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function installPreview(requestedScreen) {
  state.authReady = true;
  state.authSettled = true;
  state.uid = "preview-player";
  state.balance = 120;
  state.cosmetics = {
    panelThemeId: "ai_training_style_soft_glow",
    messageDecorationId: "ai_training_style_neon_beat",
    ownedStyleIds: [
      "ai_training_style_soft_glow",
      "ai_training_style_neon_beat",
    ],
  };
  state.cosmeticDraft = {
    panelThemeId: "ai_training_style_crimson_azure",
    messageDecorationId: "ai_training_style_crimson_azure",
  };
  state.policy = { ...DEFAULT_POLICY, prices: [...DEFAULT_POLICY.prices] };
  state.rosterImages = Array.from({ length: AI_TEXT_TRAINING_ROSTER_MAX_COUNT }, (_, index) => ({
    id: `preview-${index}`,
    url: previewImageData(index),
    blob: null,
    position: index,
  }));
  state.rosterExpanded = true;
  const samplePreset = presetSnapshot({
    ...AI_TEXT_TRAINING_BUILTIN_SCRIPTS.mama,
    id: "1111111111111111111111111111111111111111",
    title: "朝のやさしい伴走",
    description: "LOWからHIGHまで、その時の実テンポに合わせて応援します。",
    sellerName: "SAMPLE AUTHOR",
    publicSellerId: "2222222222222222222222222222222222222222",
    price: 10,
    revision: 3,
    actualUseCount: 42,
    rankingUseCount: 28,
  });
  state.marketPresets = [{
    ...samplePreset,
    sellerName: samplePreset.authorName,
    actualUseCount: 42,
    rankingUseCount: 28,
    status: "active",
    isOwn: false,
  }];
  state.selectedPreset = samplePreset;
  state.selectedPresetSource = "market";
  state.ranking = {
    period: "monthly",
    periodKey: "2026-07",
    rows: [{
      rank: 1,
      publicSellerId: samplePreset.publicSellerId,
      sellerName: "SAMPLE AUTHOR",
      rankingGross: 280,
      actualGross: 420,
      netSales: 336,
      useCount: 42,
      rankingUseCount: 28,
      uniqueBuyers: 12,
      xPublic: true,
      xHandle: "sample_author",
    }],
  };
  if (requestedScreen === "market") state.screen = "market";
  if (requestedScreen === "editor") {
    state.screen = "editor";
    state.editorDraft = createEditorDraft();
  }
  if (requestedScreen === "purchase") {
    state.screen = "purchase_review";
    state.pendingPaidPreset = samplePreset;
    state.pendingDrawIndices = [7, 2, 9, 0, 4];
  }
  if (requestedScreen === "draw") {
    state.pendingDrawIndices = [7, 2, 9, 0, 4];
    state.screen = "draw_review";
  }
  if (["play", "reaction", "result", "safety"].includes(requestedScreen)) {
    state.sessionDrawIndices = [0, 1, 2, 3, 4];
    state.images = state.sessionDrawIndices.map((index) => state.rosterImages[index]);
    state.bpms = state.sessionDrawIndices.map((index) => state.rosterBpms[index]);
    state.sessionBeatCharacterId = state.beatCharacterId;
    state.sessionCosmetics = equippedCosmetics();
    state.plan = createAiTextTrainingPlan({ modeId: "mama", bpms: state.bpms });
    state.screen = ["result", "safety"].includes(requestedScreen) ? "result" : "play";
    state.phase = requestedScreen === "reaction" ? "reaction" : "paused";
    state.roundIndex = requestedScreen === "reaction" ? 1 : 0;
    state.remainingMs = 12_000;
    state.resultOutcome = requestedScreen === "result"
      ? "completed"
      : requestedScreen === "safety"
        ? "safety_stopped"
        : "";
    if (["result", "safety"].includes(requestedScreen)) {
      state.selectedPresetSource = "active_use";
      state.completedActiveSeconds = requestedScreen === "result"
        ? state.roundSeconds * AI_TEXT_TRAINING_ROUND_COUNT
        : 24;
      state.completedRounds = requestedScreen === "result"
        ? AI_TEXT_TRAINING_ROUND_COUNT
        : 1;
    }
  }
  if (requestedScreen === "rankings") state.screen = "rankings";
  render();
}

async function initializeAuthenticatedState(targetState = state) {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const credential = auth.currentUser
      ? { user: auth.currentUser }
      : await signInAnonymously(auth);
    if (!active || state !== targetState) return;
    targetState.uid = credential.user.uid;
    const response = await aiTextTrainingAction({
      action: "state",
      modeId: targetState.modeId,
    });
    if (!active || state !== targetState) return;
    const data = response.data || {};
    targetState.balance = Number(data.balance || 0);
    targetState.policy = data.policy || targetState.policy;
    targetState.marketPresets = Array.isArray(data.presets) ? data.presets : [];
    targetState.ownPresets = Array.isArray(data.ownPresets) ? data.ownPresets : [];
    targetState.profile = data.profile || targetState.profile;
    targetState.cosmetics = normalizeServerCosmetics(data.cosmetics);
    targetState.activeUse = data.activeUse || null;
    targetState.authReady = true;
    targetState.authError = "";
    if (targetState.activeUse?.preset) {
      targetState.modeId = targetState.activeUse.preset.modeId;
      targetState.marketModeFilter = targetState.modeId;
      targetState.selectedPreset = presetSnapshot(targetState.activeUse.preset);
      targetState.selectedPresetSource = "active_use";
      targetState.paidUseId = targetState.activeUse.id;
    } else if (storedSession()?.resultOutcome) {
      clearPersistedSession();
    }
    targetState.unsubscribeWallet?.();
    targetState.unsubscribeWallet = onSnapshot(
      doc(firestore, "wallets", targetState.uid),
      (snapshot) => {
        if (!active || state !== targetState || !snapshot.exists()) return;
        const nextBalance = Number(snapshot.get("balance"));
        if (Number.isSafeInteger(nextBalance) && nextBalance >= 0) {
          const balanceChanged = targetState.balance !== nextBalance;
          targetState.balance = nextBalance;
          if (balanceChanged
              && ["purchase_review", "editor_review"].includes(targetState.screen)) {
            render();
            return;
          }
          document.querySelectorAll("[data-ai-text-training-balance]").forEach((element) => {
            element.textContent = formatAnjuPayNumber(nextBalance);
          });
        }
      },
      () => {},
    );
    await (targetState.initialDeckRestorePromise || restoreStoredDeck({ quiet: true }));
    if (!active || state !== targetState) return;
    recoverPaidSession();
    targetState.authSettled = true;
    render();
    flushAchievementRetryQueue().catch(() => {});
  } catch (error) {
    if (!active || state !== targetState) return;
    targetState.authReady = false;
    targetState.authSettled = true;
    targetState.authError = error?.message || "市場へ接続できませんでした。";
    render();
    flushAchievementRetryQueue().catch(() => {});
  }
}

function normalizeRecoveredPlan(value, {
  modeId,
  bpms,
  roundIndex,
} = {}) {
  const source = value && typeof value === "object" ? value : null;
  if (!source
      || Number(source.schemaVersion) !== 1
      || !AI_TEXT_TRAINING_MODES.some((mode) => mode.id === modeId)
      || source.modeId !== modeId
      || !Array.isArray(source.baseBpms)
      || !Array.isArray(source.imoutoOffsets)
      || !Array.isArray(source.effectiveBpms)
      || !Array.isArray(source.reactions)
      || [
        source.baseBpms,
        source.imoutoOffsets,
        source.effectiveBpms,
        source.reactions,
      ].some((items) => items.length !== AI_TEXT_TRAINING_ROUND_COUNT)) {
    throw new Error("保存されたトレーニング計画を確認できません。");
  }
  const baseBpms = source.baseBpms.map((value) => normalizeAiTextTrainingBpm(value));
  if (baseBpms.some((value) => value === null)
      || !Array.isArray(bpms)
      || bpms.some((value, index) => normalizeAiTextTrainingBpm(value) !== baseBpms[index])) {
    throw new Error("保存されたBPMを確認できません。");
  }
  const imoutoOffsets = source.imoutoOffsets.map((value) => Number(value));
  const allowedImoutoOffsets = new Set([-20, -10, 0, 10, 20]);
  if (imoutoOffsets[0] !== 0 || imoutoOffsets.some((value, index) => (
    !allowedImoutoOffsets.has(value)
    || (index > 0 && value === imoutoOffsets[index - 1])
  ))) {
    throw new Error("保存されたテンポ補正を確認できません。");
  }
  const effectiveBpms = source.effectiveBpms.map((value) => (
    value === null ? null : normalizeAiTextTrainingBpm(value)
  ));
  if (effectiveBpms.some((value, index) => (
    source.effectiveBpms[index] !== null && value === null
  )) || effectiveBpms.some((value, index) => index <= roundIndex && value === null)) {
    throw new Error("保存された実効BPMを確認できません。");
  }
  const reactionIds = new Set(AI_TEXT_TRAINING_REACTIONS.map((reaction) => reaction.id));
  const reactions = source.reactions.map((value) => (
    value === null ? null : String(value)
  ));
  let reactionGapFound = false;
  if (reactions.some((value) => {
    if (value === null) {
      reactionGapFound = true;
      return false;
    }
    return reactionGapFound || !reactionIds.has(value);
  }) || reactions.some((value, index) => (
    (index < roundIndex && value === null)
    || (index > roundIndex && value !== null)
  ))) {
    throw new Error("保存された体感回答を確認できません。");
  }
  const expectedPlan = {
    schemaVersion: 1,
    modeId,
    baseBpms: [...baseBpms],
    imoutoOffsets: [...imoutoOffsets],
    effectiveBpms: Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null),
    reactions: Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null),
  };
  expectedPlan.effectiveBpms[0] = baseBpms[0];
  if (modeId === "imouto") {
    for (let index = 1; index < AI_TEXT_TRAINING_ROUND_COUNT; index += 1) {
      expectedPlan.effectiveBpms[index] = baseBpms[index] === 0
        ? 0
        : Math.max(40, Math.min(160, baseBpms[index] + imoutoOffsets[index]));
    }
  }
  reactions.forEach((reactionId, index) => {
    if (reactionId !== null) {
      applyAiTextTrainingReaction(expectedPlan, index, reactionId);
    }
  });
  if (effectiveBpms.some((value, index) => value !== expectedPlan.effectiveBpms[index])) {
    throw new Error("保存された実効BPMと体感回答が一致しません。");
  }
  return {
    schemaVersion: 1,
    modeId,
    baseBpms,
    imoutoOffsets,
    effectiveBpms,
    reactions,
  };
}

function recoverPaidSession() {
  state.recoveryError = "";
  const saved = storedSession();
  if (!saved || !state.activeUse || saved.paidUseId !== state.activeUse.id) return false;
  try {
    const activeModeId = String(state.activeUse.preset?.modeId || "");
    const savedResultOutcome = String(saved.resultOutcome || "");
    if (saved.modeId !== activeModeId
        || !["", "completed", "safety_stopped", "exited"].includes(savedResultOutcome)) {
      throw new Error("保存された利用状態を確認できません。");
    }
    state.modeId = saved.modeId;
    state.exerciseId = saved.exerciseId;
    state.roundSeconds = ROUND_SECONDS_OPTIONS.includes(saved.roundSeconds)
      ? saved.roundSeconds
      : 20;
    if (!Array.isArray(saved.bpms) || saved.bpms.length !== AI_TEXT_TRAINING_ROUND_COUNT) {
      throw new Error("保存されたBPMを確認できません。");
    }
    state.bpms = saved.bpms.map((value) => {
      const bpm = normalizeAiTextTrainingBpm(value);
      if (bpm === null) throw new Error("保存されたBPMを確認できません。");
      return bpm;
    });
    const entries = rosterEntries();
    const savedSchemaVersion = Number(saved.schemaVersion);
    const savedRosterCount = savedSchemaVersion === SESSION_SCHEMA_VERSION
      ? isAiTextTrainingRosterCount(saved.rosterCount)
        ? Number(saved.rosterCount)
        : null
      : AI_TEXT_TRAINING_ROUND_COUNT;
    const savedDrawIndices = savedRosterCount === null
      ? null
      : normalizeAiTextTrainingDrawIndices(
        saved.drawIndices,
        savedRosterCount,
      );
    if (savedSchemaVersion === SESSION_SCHEMA_VERSION
        && (savedRosterCount === null || savedDrawIndices === null)) {
      throw new Error("保存されたDRAWを確認できません。");
    }
    state.recoveryRosterCount = savedSchemaVersion === SESSION_SCHEMA_VERSION
      ? savedRosterCount || 0
      : AI_TEXT_TRAINING_ROUND_COUNT;
    state.sessionDrawIndices = savedSchemaVersion === SESSION_SCHEMA_VERSION
      ? savedDrawIndices && entries.length === savedRosterCount
        ? savedDrawIndices
        : []
      : entries.length >= AI_TEXT_TRAINING_ROUND_COUNT
        ? Array.from({ length: AI_TEXT_TRAINING_ROUND_COUNT }, (_, index) => index)
        : [];
    state.drawLeg = Number(saved.drawLeg) === 2 ? 2 : 1;
    state.images = state.sessionDrawIndices.map((index) => entries[index]?.image || null);
    state.sessionDrawIndices.forEach((entryIndex, roundIndex) => {
      const slotIndex = entries[entryIndex]?.slotIndex;
      if (Number.isInteger(slotIndex)) state.rosterBpms[slotIndex] = state.bpms[roundIndex];
    });
    state.sessionBeatCharacterId = normalizeBeatCharacterId(saved.beatCharacterId);
    state.beatCharacterId = state.sessionBeatCharacterId;
    state.roundIndex = Math.max(0, Math.min(4, Number(saved.roundIndex) || 0));
    state.plan = normalizeRecoveredPlan(saved.plan, {
      modeId: state.modeId,
      bpms: state.bpms,
      roundIndex: state.roundIndex,
    });
    state.remainingMs = Math.max(
      0,
      Math.min(state.roundSeconds * 1_000, Number(saved.remainingMs) || state.roundSeconds * 1_000),
    );
    state.phase = ["paused", "reaction", "next_preview"].includes(saved.phase)
      ? saved.phase
      : "paused";
    state.completedActiveSeconds = Math.max(0, Number(saved.completedActiveSeconds) || 0);
    state.completedRounds = Math.max(
      0,
      Math.min(AI_TEXT_TRAINING_ROUND_COUNT, Number(saved.completedRounds) || 0),
    );
    state.sessionStartedAt = Number(saved.sessionStartedAt) || Date.now();
    state.achievementActionId = /^[A-Za-z0-9_-]{16,80}$/u.test(
      String(saved.achievementActionId || ""),
    )
      ? String(saved.achievementActionId)
      : "";
    state.achievementSessionId = /^[a-f0-9]{40}$/u.test(
      String(saved.achievementSessionId || ""),
    )
      ? String(saved.achievementSessionId)
      : "";
    state.achievementBeginRequested = saved.achievementBeginRequested === true
      && Boolean(state.achievementActionId);
    state.selectedPreset = presetSnapshot(state.activeUse.preset);
    state.selectedPresetSource = "active_use";
    state.paidUseId = state.activeUse.id;
    state.sessionCosmetics = normalizeAiTextTrainingCosmetics(
      saved.cosmetics || equippedCosmetics(),
      {
      ownedStyleIds: state.cosmetics?.ownedStyleIds,
      },
    );
    if (state.achievementBeginRequested) {
      const pending = upsertAchievementRetryRecord({
        ...currentAchievementOwner(),
        actionId: state.achievementActionId,
        modeId: state.modeId,
        roundSeconds: state.roundSeconds,
        sessionId: state.achievementSessionId,
        outcome: ["completed", "safety_stopped", "exited"].includes(savedResultOutcome)
          ? savedResultOutcome
          : "",
        completedRounds: savedResultOutcome === "completed"
          ? AI_TEXT_TRAINING_ROUND_COUNT
          : state.completedRounds,
        activeSeconds: savedResultOutcome === "completed"
          ? state.roundSeconds * AI_TEXT_TRAINING_ROUND_COUNT
          : state.completedActiveSeconds,
      });
      if (pending?.sessionId) state.achievementSessionId = pending.sessionId;
    }
    if (savedResultOutcome) {
      state.resultOutcome = savedResultOutcome;
      state.screen = "result";
      state.phase = "result";
      state.finishPending = true;
      const recoveryState = state;
      finishPaidUse(savedResultOutcome).finally(() => {
        if (active && state === recoveryState && recoveryState.screen === "result") render();
      });
    }
    return true;
  } catch {
    state.plan = null;
    state.sessionDrawIndices = [];
    state.images = Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null);
    state.recoveryRosterCount = 0;
    state.recoveryError = "端末に残った開始済み利用の計画またはDRAWを確認できません。";
    return false;
  }
}

function start() {
  if (active) return;
  const preview = previewRequest();
  if (!preview && useOfflineMarketPreview) {
    showToast("LOCAL UI PREVIEW中は文字コラトレーニングを開けません。");
    return;
  }
  if (!preview && location.protocol === "file:") {
    showToast("文字コラトレーニングはローカルサーバーまたは公開URLから起動してください。");
    return;
  }
  if (!preview && modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してから文字コラトレーニングを開いてください。");
    return;
  }
  active = true;
  state.ambienceController?.destroy();
  state = createState();
  state.generation += 1;
  state.preview = preview;
  setModeChrome();
  if (preview) {
    installPreview(preview);
    return;
  }
  render();
  state.initialDeckRestorePromise = restoreStoredDeck({ quiet: true });
  initializeAuthenticatedState(state);
}

function isActive() {
  return active;
}

function renderFrame(content, {
  eyebrow = "SOLO · 5 ROUNDS",
  title = "AIと対戦しよう 文字コラトレーニング",
  backLabel = "トップへ戻る",
  backAction = "home",
} = {}) {
  return `<section class="screen ai-text-training-screen" data-ai-text-training-screen="${escapeHtml(state.screen)}" ${cosmeticDataAttributes()}>
    <header class="ai-text-training-header">
      <div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1></div>
      <button class="button button-ghost ai-text-training-back" type="button" data-ai-text-training-action="${escapeHtml(backAction)}" ${state.finishInFlight ? "disabled" : ""}>${escapeHtml(backLabel)}</button>
    </header>
    ${content}
    <div class="ai-text-training-sr-status" id="aiTextTrainingAnnouncer" role="status" aria-live="polite" aria-atomic="true"></div>
  </section>`;
}

function authStatusHtml() {
  if (state.preview) return `<span class="ai-text-training-connection is-ready">PREVIEW · 残高 ${formatAnjuPay(state.balance)}</span>`;
  if (!state.authSettled) return `<span class="ai-text-training-connection">開始済み利用と残高を確認中…</span>`;
  if (state.authError) return `<span class="ai-text-training-connection is-error">市場オフライン · 無料トレーニングは利用できます</span>`;
  return `<span class="ai-text-training-connection is-ready">AnjuPay <strong data-ai-text-training-balance>${formatAnjuPayNumber(state.balance)}</strong> Pay</span>`;
}

function paidRecoverySettingsLocked() {
  const saved = storedSession();
  return Boolean(
    state.activeUse
    && saved?.paidUseId === state.activeUse.id
    && saved?.plan,
  );
}

function imageSetupCard(item, index) {
  const bpm = state.rosterBpms[index];
  const bpmCopy = bpm === 0 ? "FREE RHYTHM" : `${bpm} BPM`;
  const bpmLocked = paidRecoverySettingsLocked()
    && state.sessionDrawIndices.length === AI_TEXT_TRAINING_ROUND_COUNT;
  return `<article class="ai-text-training-image-card ${item ? "has-image" : ""}">
    <div class="ai-text-training-image-stage">
      ${item
        ? `<img src="${escapeHtml(item.url)}" alt="対戦候補${index + 1}の選択画像" />`
        : `<span><strong>${index + 1}</strong><small>IMAGE</small></span>`}
      <em>ROSTER ${String(index + 1).padStart(2, "0")}</em>
    </div>
    <div class="ai-text-training-image-actions">
      <label class="button button-ghost ai-text-training-file-button">
        ${item ? "画像を差し替え" : "画像を選ぶ"}
        <input type="file" accept="image/*" data-ai-text-training-image="${index}" aria-label="対戦候補${index + 1}の画像を${item ? "差し替える" : "選ぶ"}" />
      </label>
      ${item ? `<button class="button button-ghost ai-text-training-image-remove" type="button" data-ai-text-training-remove-image="${index}" aria-label="対戦候補${index + 1}を外す">外す</button>` : ""}
    </div>
    <div class="ai-text-training-bpm-control">
      <label for="aiTextTrainingBpm${index}">候補${index + 1}のBPM</label>
      <div>
        <input id="aiTextTrainingBpm${index}" type="number" inputmode="numeric" min="0" max="160" step="1" value="${bpm}" data-ai-text-training-bpm="${index}" aria-describedby="aiTextTrainingBpmHelp${index}" ${bpmLocked ? "disabled" : ""} />
        <button type="button" data-ai-text-training-free="${index}" ${bpmLocked ? "disabled" : ""}>FREE</button>
      </div>
      <small id="aiTextTrainingBpmHelp${index}">${escapeHtml(bpmCopy)} · ${bpmLocked ? "開始時設定に固定" : "0または40〜160"}</small>
    </div>
  </article>`;
}

function modeCard(mode) {
  const checked = state.modeId === mode.id;
  const locked = Boolean(state.activeUse);
  return `<label class="ai-text-training-mode-card ${checked ? "is-selected" : ""} ${locked ? "is-locked" : ""}">
    <input type="radio" name="aiTextTrainingMode" value="${mode.id}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""} />
    <span><strong>${escapeHtml(mode.label)}</strong><small>${escapeHtml(mode.description)}</small>${mode.warning ? `<em>${escapeHtml(mode.warning)}</em>` : ""}</span>
  </label>`;
}

function beatCharacterCard(character) {
  const selected = state.beatCharacterId === character.id;
  const locked = paidRecoverySettingsLocked();
  return `<article class="ai-text-training-beat-card ${selected ? "is-selected" : ""}">
    <label>
      <input type="radio" name="aiTextTrainingBeatCharacter" value="${escapeHtml(character.id)}" ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
      <span aria-hidden="true">${escapeHtml(character.glyph)}</span>
      <strong>${escapeHtml(character.label)}</strong>
      <small>${escapeHtml(character.description)}</small>
    </label>
    <button class="button button-ghost" type="button" data-ai-text-training-preview-beat="${escapeHtml(character.id)}" aria-label="${escapeHtml(character.label)}を試聴">音を試す</button>
  </article>`;
}

function renderBeatCharacterPanel() {
  const locked = paidRecoverySettingsLocked();
  return `<section class="ai-text-training-panel ai-text-training-beat-panel">
    <div class="ai-text-training-section-heading"><span>STEP 4</span><h2>ビートキャラクター</h2><em>5 TONES</em></div>
    <div class="ai-text-training-beat-grid">${AI_TEXT_TRAINING_BEAT_CHARACTERS.map(beatCharacterCard).join("")}</div>
    <p class="ai-text-training-mode-note">${locked ? "開始済み利用のビートは開始時設定に固定されています。試聴はできますが、再開する音色は変更しません。" : "音色はAIの人物像だけを演出し、BPM・難易度・実績には影響しません。「音を試す」を押した時だけ短く再生します。トレーニング中はいつでもメトロノームをOFFにできます。"}</p>
  </section>`;
}

function selectedSupportHtml() {
  const script = selectedPresetForMode();
  const free = Number(script.price || 0) === 0 || state.selectedPresetSource === "author_preview";
  return `<article class="ai-text-training-selected-support ${free ? "is-free" : "is-paid"}">
    <div><span>${free ? "FREE SUPPORT" : `${formatAnjuPay(script.price)} · 1 SESSION`}</span><h3>${escapeHtml(script.title)}</h3><p>${escapeHtml(script.description)}</p></div>
    <dl><div><dt>AI性格</dt><dd>${escapeHtml(aiTextTrainingMode(script.modeId).label)}</dd></div><div><dt>作者</dt><dd>${escapeHtml(script.authorName)}</dd></div><div><dt>改訂</dt><dd>REV.${Number(script.revision || 1)}</dd></div></dl>
  </article>`;
}

function activeUseBanner() {
  if (!state.activeUse) return "";
  const saved = storedSession();
  const recoveryCount = state.recoveryRosterCount || Number(saved?.rosterCount) || 5;
  if (state.recoveryError) {
    return `<aside class="ai-text-training-active-use">
      <strong>開始済み応援の復旧を止めています</strong>
      <p>${escapeHtml(state.recoveryError)}確定済みの内容を再抽選せず、追加請求も行いません。</p>
      <p>復旧できない場合は、この1回分を自主終了できます。応援は使い切りとなり返金はありませんが、新しい支払いは発生しません。</p>
      <div>
        <button class="button button-primary" type="button" data-ai-text-training-action="resume-paid" ${state.finishInFlight ? "disabled" : ""}>復旧状態をもう一度確認</button>
        <button class="button button-ghost" type="button" data-ai-text-training-action="abandon-corrupt-paid-use" ${state.finishInFlight ? "disabled" : ""}>${state.finishInFlight ? "自主終了を送信中…" : state.finishPending ? "自主終了を再送" : "この1回分を自主終了"}</button>
      </div>
    </aside>`;
  }
  const recoveryCopy = saved?.plan
    ? `画像を失った場合は開始時と同じ${recoveryCount}枚を同じロスター順で選び直してください。確定済みの5枚・順番・運動・時間・BPM・ビート・演出は開始時設定に固定し、再抽選や途中変更をしません。`
    : "利用開始だけが確定しています。5〜10枚を準備すると、追加支払いなしで今回の5枚をDRAWできます。";
  return `<aside class="ai-text-training-active-use">
    <strong>追加支払いなしで再開できる応援があります</strong>
    <p>「${escapeHtml(state.activeUse.preset?.title || "応援台本")}」は開始済みです。${escapeHtml(recoveryCopy)}同じ利用記録で再開します。</p>
    <button class="button button-primary" type="button" data-ai-text-training-action="resume-paid">この応援で再開準備</button>
  </aside>`;
}

function cosmeticOptionHtml(slot, product = null) {
  const selection = previewCosmetics();
  const productId = product?.id || "";
  const selected = selection[slot] === productId;
  const owned = !productId || state.cosmetics.ownedStyleIds.includes(productId);
  const isPanel = slot === "panelThemeId";
  const label = product
    ? (isPanel ? product.panelLabel : product.messageLabel)
    : (isPanel ? "標準ウィンドウ" : "標準メッセージ");
  const description = product
    ? product.name
    : "最初から使えるシンプルな見た目";
  const badge = !productId ? "FREE" : owned ? "OWNED" : "試着";
  return `<label class="ai-text-training-cosmetic-option ${selected ? "is-selected" : ""} ${owned ? "" : "is-locked"}">
    <input type="radio" name="aiTextTrainingCosmetic_${slot}" value="${escapeHtml(productId)}" ${selected ? "checked" : ""} ${state.cosmeticBusy ? "disabled" : ""} />
    <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span>
    <em class="ai-text-training-cosmetic-badge">${escapeHtml(badge)}</em>
  </label>`;
}

function renderCosmeticsPanel() {
  const selection = previewCosmetics();
  const equipped = equippedCosmetics();
  const draftChanged = Boolean(state.cosmeticDraft) && !sameCosmetics(selection, equipped);
  const selectionOwned = aiTextTrainingCosmeticsAreOwned(
    selection,
    state.cosmetics.ownedStyleIds,
  );
  const selectedPanel = getAiTextTrainingStyleProduct(selection.panelThemeId);
  const selectedMessage = getAiTextTrainingStyleProduct(selection.messageDecorationId);
  const saveDisabled = !state.authReady
    || state.cosmeticBusy
    || !draftChanged
    || !selectionOwned;
  const saveLabel = state.cosmeticBusy
    ? "装着を保存中…"
    : !selectionOwned
      ? "未購入のため装着できません"
      : draftChanged
        ? "この組み合わせを装着"
        : "装着済み";
  return `<section class="ai-text-training-panel ai-text-training-cosmetics-panel">
    <div class="ai-text-training-section-heading"><span>STEP 5</span><h2>トレーニングルームを飾る</h2><em>買い切り演出</em></div>
    <div class="ai-text-training-cosmetics-layout">
      <div class="ai-text-training-cosmetic-controls">
        <fieldset class="ai-text-training-cosmetic-slot">
          <legend>画像ウィンドウ</legend>
          <div class="ai-text-training-cosmetic-options">${[null, ...AI_TEXT_TRAINING_STYLE_PRODUCTS].map((product) => cosmeticOptionHtml("panelThemeId", product)).join("")}</div>
        </fieldset>
        <fieldset class="ai-text-training-cosmetic-slot">
          <legend>応援メッセージ</legend>
          <div class="ai-text-training-cosmetic-options">${[null, ...AI_TEXT_TRAINING_STYLE_PRODUCTS].map((product) => cosmeticOptionHtml("messageDecorationId", product)).join("")}</div>
        </fieldset>
      </div>
      <div class="ai-text-training-cosmetic-preview" ${cosmeticDataAttributes(selection)}>
        <span>PRIVATE TRAINING PREVIEW</span>
        <div class="ai-text-training-cosmetic-preview-window">
          <div><span>ROUND 1 / 5</span><strong>80 BPM</strong></div>
          <em>20</em>
          <p class="ai-text-training-cosmetic-preview-message ai-text-training-message-surface">今日の気分で、一緒に始めよう</p>
        </div>
        <dl><div><dt>窓</dt><dd>${escapeHtml(selectedPanel?.panelLabel || "標準ウィンドウ")}</dd></div><div><dt>セリフ</dt><dd>${escapeHtml(selectedMessage?.messageLabel || "標準メッセージ")}</dd></div></dl>
      </div>
    </div>
    <div class="ai-text-training-cosmetic-actions">
      <button class="button button-primary" type="button" data-ai-text-training-action="save-cosmetics" ${saveDisabled ? "disabled" : ""}>${escapeHtml(saveLabel)}</button>
      ${state.cosmeticDraft ? '<button class="button button-ghost" type="button" data-ai-text-training-action="cancel-cosmetics">試着を取り消す</button>' : ""}
    </div>
    <p class="ai-text-training-cosmetic-note">未購入品もここで試着できますが、保存はされません。購入はトップのAnjuPayストアから。購入済みの窓とセリフは別々に組み合わせ、標準を含め最大25通りから何度でも変更できます。</p>
    <p class="ai-text-training-mode-note">演出は見た目だけです。BPM・運動時間・結果・即停止などの安全操作は変わりません。</p>
  </section>`;
}

function renderSetup() {
  const registeredCount = rosterEntries().length;
  const imagesReady = isAiTextTrainingRosterCount(registeredCount);
  const visibleRosterSlots = state.rosterExpanded || registeredCount > AI_TEXT_TRAINING_ROUND_COUNT
    ? AI_TEXT_TRAINING_ROSTER_MAX_COUNT
    : AI_TEXT_TRAINING_ROUND_COUNT;
  const script = selectedPresetForMode();
  const authChecking = !state.preview && !state.authSettled;
  const recoverySettingsLocked = paidRecoverySettingsLocked();
  const startCopy = state.activeUse
    ? "追加支払いなしで再開"
    : Number(script.price || 0) > 0 && state.selectedPresetSource === "market"
      ? registeredCount > AI_TEXT_TRAINING_ROUND_COUNT
        ? "AI DRAWへ"
        : `${formatAnjuPay(script.price)}で1回使って開始`
      : registeredCount > AI_TEXT_TRAINING_ROUND_COUNT
        ? "AI DRAWへ"
        : "無料で5ラウンド開始";
  const startReady = imagesReady && !state.cosmeticDraft && !authChecking;
  const displayedStartCopy = authChecking
    ? "開始済み利用を確認中…"
    : state.cosmeticDraft
      ? "試着を確定して開始"
      : startCopy;
  const todayComplete = readLocalValue(`${DAILY_COMPLETE_PREFIX}${jstDateKey()}`) === "true";
  return renderFrame(`
    <div class="ai-text-training-setup-intro">
      <div><p>好きな画像を5〜10枚登録。AIが内容を見ずに5枚をDRAWし、文字の応援とBPMで対戦します。</p><small>カメラ・動作判定・P2Pなし。画像・BPM・DRAW結果は市場や作者へ送られません。</small></div>
      ${authStatusHtml()}
    </div>
    ${activeUseBanner()}
    <section class="ai-text-training-daily ${todayComplete ? "is-complete" : ""}" aria-label="今日のチャレンジ">
      <span>${todayComplete ? "TODAY COMPLETE" : "TODAY'S QUICK CHALLENGE"}</span>
      <strong>${todayComplete ? "今日の5ラウンドを完走しました" : "好きな性格で5ラウンド完走しよう"}</strong>
      <small>カメラや動作判定は使いません。5ラウンド完走だけが実績へ加算され、安全停止・途中終了で今までの進捗は減りません。有料応援は任意で、完走によるPay還元はありません。</small>
    </section>
    <section class="ai-text-training-panel">
      <div class="ai-text-training-section-heading"><span>STEP 1</span><h2>対戦ロスターとBPM</h2><em>${registeredCount} / 10 · 最低5</em></div>
      <div class="ai-text-training-image-grid">${state.rosterImages.slice(0, visibleRosterSlots).map(imageSetupCard).join("")}</div>
      ${visibleRosterSlots < AI_TEXT_TRAINING_ROSTER_MAX_COUNT ? `<button class="button button-ghost ai-text-training-expand-roster" type="button" data-ai-text-training-action="expand-roster">候補を10枚まで追加する</button>` : ""}
      <p class="ai-text-training-mode-note">5枚なら登録順で対戦します。6〜10枚なら開始前に重複なしで5枚をDRAWし、選ばれた順番とBPMを確認してから開始できます。</p>
      <div class="ai-text-training-local-save">
        <label><input type="checkbox" id="aiTextTrainingPersistDeck" ${state.persistDeck ? "checked" : ""} /> この端末にロスターを保存し、次回すぐ使う</label>
        <p>明示的にONにした時だけIndexedDBへ保存します。Firebaseへは送信しません。</p>
        <div><button class="button button-ghost" type="button" data-ai-text-training-action="load-deck" ${state.storedDeckAvailable ? "" : "disabled"}>保存ロスターを読み込む</button><button class="button button-ghost" type="button" data-ai-text-training-action="forget-deck" ${state.storedDeckAvailable ? "" : "disabled"}>端末保存を削除</button></div>
      </div>
    </section>
    <section class="ai-text-training-panel">
      <div class="ai-text-training-section-heading"><span>STEP 2</span><h2>AIの性格を選ぶ</h2></div>
      <div class="ai-text-training-mode-grid">${AI_TEXT_TRAINING_MODES.map(modeCard).join("")}</div>
      <p class="ai-text-training-mode-note">3つは難易度ではなく、次のBPMを決める性格です。BPMの変更はラウンド間だけに行います。</p>
    </section>
    <section class="ai-text-training-panel">
      <div class="ai-text-training-section-heading"><span>STEP 3</span><h2>運動と長さ</h2></div>
      <div class="ai-text-training-config-grid">
        <label>運動<select id="aiTextTrainingExercise" ${recoverySettingsLocked ? "disabled" : ""}>${AI_TEXT_TRAINING_EXERCISES.map((exercise) => `<option value="${exercise.id}" ${state.exerciseId === exercise.id ? "selected" : ""}>${escapeHtml(exercise.label)}</option>`).join("")}</select><small>${escapeHtml(aiTextTrainingExercise(state.exerciseId).cue)}</small></label>
        <fieldset><legend>1ラウンド</legend><div>${ROUND_SECONDS_OPTIONS.map((seconds) => `<label><input type="radio" name="aiTextTrainingRoundSeconds" value="${seconds}" ${state.roundSeconds === seconds ? "checked" : ""} ${recoverySettingsLocked ? "disabled" : ""} /><span>${seconds}秒</span></label>`).join("")}</div></fieldset>
      </div>
      <p class="ai-text-training-mode-note">${recoverySettingsLocked ? "開始済み利用の運動と時間は、支払い時の設定に固定されています。" : "1ラウンドは最大60秒。5ラウンドの運動時間は最大5分です（3秒カウントと、自分で次へ進むまでの休憩は含みません）。"}</p>
    </section>
    ${renderBeatCharacterPanel()}
    ${renderCosmeticsPanel()}
    <section class="ai-text-training-panel">
      <div class="ai-text-training-section-heading"><span>STEP 6</span><h2>応援台本</h2><em>1セッション単位</em></div>
      ${selectedSupportHtml()}
      <div class="ai-text-training-support-actions">
        <button class="button button-ghost" type="button" data-ai-text-training-action="builtin-support">無料の標準応援</button>
        <button class="button button-primary" type="button" data-ai-text-training-action="market">みんなの応援から選ぶ</button>
        <button class="button button-ghost" type="button" data-ai-text-training-action="editor">応援台本を売る</button>
        <button class="button button-ghost" type="button" data-ai-text-training-action="rankings">売上ランキング</button>
      </div>
      <p class="ai-text-training-economy-note">有料応援は買い切りではありません。1回の支払いで5ラウンド1セッションに使用し、開始後に自主終了・即停止した場合も使い切りです。</p>
    </section>
    <section class="ai-text-training-start-panel">
      <div><strong>${state.cosmeticDraft ? "演出を試着中" : imagesReady ? registeredCount > 5 ? `${registeredCount}枚からAI DRAW` : "5枚の準備OK" : `あと${AI_TEXT_TRAINING_ROUND_COUNT - registeredCount}枚`}</strong><small>痛み・めまい・息苦しさ・体調不良がある時は開始せず、運動中は即停止してください。</small></div>
      <button class="button button-primary ai-text-training-start" type="button" data-ai-text-training-action="start-session" ${startReady ? "" : "disabled"}>${escapeHtml(displayedStartCopy)}</button>
    </section>
  `);
}

function drawReviewCard(entry, roundIndex) {
  const bpm = normalizeAiTextTrainingBpm(entry?.bpm) ?? 0;
  return `<article class="ai-text-training-draw-card">
    <div class="ai-text-training-image-stage">
      ${entry?.image
        ? `<img src="${escapeHtml(entry.image.url)}" alt="DRAWされたラウンド${roundIndex + 1}の画像" />`
        : `<span><strong>${roundIndex + 1}</strong><small>IMAGE</small></span>`}
      <em>ROUND ${roundIndex + 1}</em>
    </div>
    <strong>${bpm === 0 ? "FREE RHYTHM" : `${bpm} BPM`}</strong>
    <small>ROSTER ${String((entry?.slotIndex ?? 0) + 1).padStart(2, "0")}</small>
  </article>`;
}

function renderDrawReview() {
  const entries = rosterEntries();
  const drawIndices = normalizeAiTextTrainingDrawIndices(
    state.pendingDrawIndices,
    entries.length,
  );
  if (!drawIndices) {
    return renderFrame(`
      <section class="ai-text-training-draw-error">
        <span>DRAW RESET</span>
        <h2>ロスターを確認してください</h2>
        <p>登録画像が変更されたため、DRAWをやり直します。支払いと台本消費は発生していません。</p>
        <button class="button button-primary" type="button" data-ai-text-training-action="setup">準備へ戻る</button>
      </section>
    `, { eyebrow: "AI DRAW", title: "対戦相手を選出", backLabel: "準備へ戻る", backAction: "setup" });
  }
  const script = selectedPresetForMode();
  const paid = Number(script.price || 0) > 0
    && ["market", "active_use"].includes(state.selectedPresetSource);
  const confirmLabel = state.activeUse
    ? "この5枚で追加支払いなしで再開"
    : paid
      ? `この5枚で${formatAnjuPay(script.price)}の支払い確認へ`
      : "この5枚で無料トレーニング開始";
  return renderFrame(`
    <section class="ai-text-training-draw-hero">
      <span>AI DRAW · ${entries.length} → 5</span>
      <h2>今回の対戦相手をDRAWしました</h2>
      <p>画像の中身は解析せず、登録ロスターから重複なしで選んでいます。順番とBPMを確認し、無理のない構成で開始してください。</p>
    </section>
    <section class="ai-text-training-draw-grid">${drawIndices.map((index, roundIndex) => drawReviewCard(entries[index], roundIndex)).join("")}</section>
    <aside class="ai-text-training-draw-summary">
      <dl><div><dt>AI性格</dt><dd>${escapeHtml(aiTextTrainingMode(state.modeId).label)}</dd></div><div><dt>ビート</dt><dd>${escapeHtml(beatCharacter().label)}</dd></div><div><dt>応援</dt><dd>${escapeHtml(script.title)}</dd></div><div><dt>1ラウンド</dt><dd>${state.roundSeconds}秒</dd></div></dl>
      <p>DRAWし直しても料金はかかりません。有料応援は、この5枚を確定した後の支払い確認で同意し、実際に利用開始が成立した時だけ消費します。</p>
    </aside>
    <div class="ai-text-training-draw-actions">
      ${state.activeUse || (state.drawLeg === 2 && entries.length === AI_TEXT_TRAINING_ROSTER_MAX_COUNT) ? "" : '<button class="button button-ghost" type="button" data-ai-text-training-action="redraw">別の5枚をDRAW</button>'}
      <button class="button button-primary" type="button" data-ai-text-training-action="confirm-draw">${escapeHtml(confirmLabel)}</button>
    </div>
  `, { eyebrow: "AI DRAW · NO IMAGE ANALYSIS", title: "対戦相手を選出", backLabel: "準備へ戻る", backAction: "setup" });
}

function marketPresetCard(preset) {
  const own = preset.isOwn === true;
  return `<article class="ai-text-training-market-card">
    <div class="ai-text-training-market-card-head"><span>${formatAnjuPay(preset.price)} / 1回</span><em>REV.${Number(preset.revision || 1)}</em></div>
    <h3>${escapeHtml(preset.title)}</h3>
    <p>${escapeHtml(preset.description)}</p>
    <dl><div><dt>作者</dt><dd>${escapeHtml(preset.sellerName || preset.authorName || "匿名作者")}</dd></div><div><dt>実利用</dt><dd>${Number(preset.actualUseCount || 0)}回</dd></div><div><dt>ランキング対象</dt><dd>${Number(preset.rankingUseCount || 0)}回</dd></div></dl>
    <button class="button ${own ? "button-ghost" : "button-primary"}" type="button" data-ai-text-training-preset="${escapeHtml(preset.id)}">${own ? "作者プレビュー" : "全文を見て選ぶ"}</button>
  </article>`;
}

function renderMarket() {
  const presets = state.marketPresets.filter((preset) => preset.modeId === state.marketModeFilter);
  return renderFrame(`
    <nav class="ai-text-training-subnav" aria-label="応援市場メニュー">
      <button class="button button-ghost" type="button" data-ai-text-training-action="setup">トレーニング準備</button>
      <button class="button button-ghost" type="button" data-ai-text-training-action="editor">台本を売る</button>
      <button class="button button-ghost" type="button" data-ai-text-training-action="rankings">売上ランキング</button>
      ${authStatusHtml()}
    </nav>
    <section class="ai-text-training-market-hero">
      <span>CONSUMABLE SUPPORT MARKET</span>
      <h2>同じ5枚でも、応援の言葉で体験が変わる。</h2>
      <p>全文を確認してから、5ラウンド1回だけ使います。無料の標準応援はいつでも選べます。</p>
    </section>
    <div class="ai-text-training-mode-tabs" role="tablist" aria-label="AI性格で絞り込み">
      ${AI_TEXT_TRAINING_MODES.map((mode) => `<button type="button" role="tab" aria-selected="${state.marketModeFilter === mode.id}" data-ai-text-training-market-mode="${mode.id}">${escapeHtml(mode.label)}</button>`).join("")}
    </div>
    <section class="ai-text-training-market-grid">
      ${presets.length ? presets.map(marketPresetCard).join("") : `<div class="ai-text-training-empty"><strong>この性格の公開台本はまだありません</strong><p>無料の標準応援で遊ぶか、最初の作者になれます。</p></div>`}
    </section>
    <aside class="ai-text-training-market-policy"><strong>経済とランキング</strong><p>利用料から20%（最低1 Pay）を市場手数料として吸収し、残りを作者へ渡します。同じ購入者→作者のランキング加算はJST同日1回ですが、実際の支払いと作者受取は毎回行われます。</p></aside>
  `, { eyebrow: "SUPPORT SCRIPT MARKET", backLabel: "準備へ戻る", backAction: "setup" });
}

function scriptSlotPreview(script, slot) {
  const lines = script.lines?.[slot.id] || [];
  return `<section class="ai-text-training-script-slot"><h4>${escapeHtml(slot.label)}</h4><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></section>`;
}

function renderPresetDetail() {
  const raw = state.marketPresets.find((preset) => preset.id === state.selectedMarketPresetId);
  if (!raw) {
    state.screen = "market";
    return renderMarket();
  }
  const script = presetSnapshot(raw);
  const own = raw.isOwn === true;
  return renderFrame(`
    <article class="ai-text-training-detail">
      <header><span>${formatAnjuPay(script.price)} / 5ラウンド1回</span><h2>${escapeHtml(script.title)}</h2><p>${escapeHtml(script.description)}</p></header>
      <dl class="ai-text-training-detail-meta"><div><dt>AI性格</dt><dd>${escapeHtml(aiTextTrainingMode(script.modeId).label)}</dd></div><div><dt>作者</dt><dd>${escapeHtml(script.authorName)}</dd></div><div><dt>改訂</dt><dd>REV.${script.revision}</dd></div></dl>
      <div class="ai-text-training-script-preview">${AI_TEXT_TRAINING_SCRIPT_SLOTS.map((slot) => scriptSlotPreview(script, slot)).join("")}</div>
      <aside><strong>台本が変更できるのは文字だけです</strong><p>BPM・運動時間・安全停止・休憩操作はシステムが管理し、この台本から変更できません。</p></aside>
      <div class="ai-text-training-detail-actions">
        <button class="button button-primary" type="button" data-ai-text-training-action="${own ? "select-own-preset" : "select-market-preset"}">${own ? "無料で作者プレビュー" : "この応援を選んで準備へ"}</button>
        <button class="button button-ghost" type="button" data-ai-text-training-action="market">一覧へ戻る</button>
      </div>
      ${own ? "" : `<form class="ai-text-training-report-form" id="aiTextTrainingReportForm"><label>問題を通報<select name="reason">${REPORT_REASONS.map((reason) => `<option value="${reason.id}">${escapeHtml(reason.label)}</option>`).join("")}</select></label><button class="button button-ghost" type="submit">この台本を通報</button><small>通報時の改訂全文を証跡として保存します。危険・性的・個人情報の問題は、利用実績のある${Number(state.policy.verifiedBuyerQuarantineThreshold || 3)}人の通報で台本とXリンクを確認のため非公開にします。</small></form>`}
    </article>
  `, { eyebrow: "FULL SCRIPT PREVIEW", title: "応援台本の全文確認", backLabel: "市場へ戻る", backAction: "market" });
}

function createEditorDraft() {
  const existing = state.ownPresets.find((preset) => preset.modeId === state.modeId);
  const fallback = normalizeAiTextTrainingScriptSnapshot(
    AI_TEXT_TRAINING_BUILTIN_SCRIPTS[state.modeId],
  );
  return {
    presetId: existing?.id || "",
    baseRevision: Number(existing?.revision || 0),
    sellerName: existing?.sellerName
      || readLocalValue(PROFILE_NAME_KEY)
      || "PLAYER",
    modeId: state.modeId,
    title: existing?.title || `${aiTextTrainingMode(state.modeId).shortLabel}の応援`,
    description: existing?.description || "実際のBPMと残り時間に合わせて、短い言葉で応援します。",
    price: Number(existing?.price || 10),
    lines: Object.fromEntries(AI_TEXT_TRAINING_SCRIPT_SLOTS.map((slot) => [
      slot.id,
      existing?.lines?.[slot.id]
        ? [...existing.lines[slot.id]]
        : [...fallback.lines[slot.id]],
    ])),
  };
}

function editorSlotField(slot, draft) {
  return `<label class="ai-text-training-editor-slot"><span>${escapeHtml(slot.label)}<em>2〜4行</em></span><textarea name="slot_${slot.id}" rows="3" maxlength="180" required>${escapeHtml((draft.lines[slot.id] || []).join("\n"))}</textarea></label>`;
}

function editorSimulatorMessage(draft) {
  const slotId = aiTextTrainingScriptSlot({
    phase: state.editorPreview.phase,
    bpm: state.editorPreview.bpm,
    remainingSeconds: state.editorPreview.remaining,
    direction: state.editorPreview.direction,
  });
  const line = draft.lines?.[slotId]?.[0] || "";
  return renderAiTextTrainingLine(line, {
    bpm: state.editorPreview.bpm,
    round: 3,
    remaining: state.editorPreview.remaining,
  });
}

function renderEditor() {
  if (!state.editorDraft) state.editorDraft = createEditorDraft();
  const draft = state.editorDraft;
  const current = state.ownPresets.find((preset) => preset.modeId === draft.modeId);
  return renderFrame(`
    <section class="ai-text-training-editor-intro">
      <span>AUTHOR STUDIO</span><h2>実際のBPMに合う言葉をつくる</h2>
      <p>1商品は1つのAI性格専用です。公開・改訂は1 Pay、利用成立時は20%（最低1 Pay）が市場手数料です。</p>
    </section>
    <form id="aiTextTrainingEditorForm" class="ai-text-training-editor">
      <fieldset ${state.busyAction ? "disabled" : ""}>
        <legend>商品情報</legend>
        <div class="ai-text-training-editor-basics">
          <label>作者名<input name="sellerName" maxlength="16" required value="${escapeHtml(draft.sellerName)}" /></label>
          <label>AI性格<select name="modeId">${AI_TEXT_TRAINING_MODES.map((mode) => `<option value="${mode.id}" ${draft.modeId === mode.id ? "selected" : ""}>${escapeHtml(mode.label)}</option>`).join("")}</select></label>
          <label>台本名<input name="title" maxlength="30" required value="${escapeHtml(draft.title)}" /></label>
          <label>価格<select name="price">${state.policy.prices.map((price) => `<option value="${price}" ${draft.price === price ? "selected" : ""}>${formatAnjuPay(price)} / 1回</option>`).join("")}</select></label>
          <label class="is-wide">紹介文<textarea name="description" minlength="10" maxlength="120" rows="3" required>${escapeHtml(draft.description)}</textarea></label>
        </div>
      </fieldset>
      <fieldset ${state.busyAction ? "disabled" : ""}>
        <legend>場面別の応援台詞</legend>
        <p>各場面へ2〜4行、1行4〜42文字。使える差し込みは <code>{bpm}</code> <code>{round}</code> <code>{remaining}</code> だけです。</p>
        <div class="ai-text-training-editor-slots">${AI_TEXT_TRAINING_SCRIPT_SLOTS.map((slot) => editorSlotField(slot, draft)).join("")}</div>
      </fieldset>
      <section class="ai-text-training-simulator">
        <div><span>SIMULATOR</span><h3>テンポ別プレビュー</h3></div>
        <div class="ai-text-training-simulator-controls">
          <label>場面<select id="aiTextTrainingEditorPreviewPhase"><option value="active" ${state.editorPreview.phase === "active" ? "selected" : ""}>運動中</option><option value="start" ${state.editorPreview.phase === "start" ? "selected" : ""}>開始</option><option value="transition" ${state.editorPreview.phase === "transition" ? "selected" : ""}>テンポ変化</option><option value="rest" ${state.editorPreview.phase === "rest" ? "selected" : ""}>休憩</option><option value="clear" ${state.editorPreview.phase === "clear" ? "selected" : ""}>完走</option></select></label>
          <label>BPM<input id="aiTextTrainingEditorPreviewBpm" type="number" min="0" max="160" value="${state.editorPreview.bpm}" /></label>
          <label>残り秒<input id="aiTextTrainingEditorPreviewRemaining" type="number" min="1" max="60" value="${state.editorPreview.remaining}" /></label>
          <label>変化<select id="aiTextTrainingEditorPreviewDirection"><option value="down" ${state.editorPreview.direction === "down" ? "selected" : ""}>遅くなる</option><option value="same" ${state.editorPreview.direction === "same" ? "selected" : ""}>同じ・FREE</option><option value="up" ${state.editorPreview.direction === "up" ? "selected" : ""}>速くなる</option></select></label>
        </div>
        <blockquote id="aiTextTrainingEditorPreviewMessage">${escapeHtml(editorSimulatorMessage(draft))}</blockquote>
        <small>公開台本はBPM・時間・安全UIを変更できません。視覚表示だけを確認するシミュレーターです。</small>
      </section>
      <div class="ai-text-training-editor-actions">
        <button class="button button-primary" type="submit">${current ? "改訂内容を確認" : "公開内容を確認"}</button>
        ${current?.status === "active" ? `<button class="button button-ghost" type="button" data-ai-text-training-action="unpublish">公開を停止</button>` : ""}
        <button class="button button-ghost" type="button" data-ai-text-training-action="setup">保存せず準備へ</button>
      </div>
    </form>
  `, { eyebrow: "SUPPORT SCRIPT AUTHOR", title: "応援台本を売る", backLabel: "準備へ戻る", backAction: "setup" });
}

function renderEditorReview() {
  const draft = state.editorDraft;
  const after = state.balance - Number(state.policy.publishFee || 1);
  return renderFrame(`
    <section class="ai-text-training-review-card">
      <span>PUBLISH REVIEW</span><h2>${escapeHtml(draft.title)}</h2>
      <p>${escapeHtml(draft.description)}</p>
      <dl><div><dt>現在残高</dt><dd>${formatAnjuPay(state.balance)}</dd></div><div><dt>公開・改訂料</dt><dd>− ${formatAnjuPay(state.policy.publishFee)}</dd></div><div><dt>公開後残高</dt><dd>${formatAnjuPay(after)}</dd></div><div><dt>販売価格</dt><dd>${formatAnjuPay(draft.price)} / 1回</dd></div></dl>
      <div class="ai-text-training-review-script">${AI_TEXT_TRAINING_SCRIPT_SLOTS.map((slot) => scriptSlotPreview(draft, slot)).join("")}</div>
      <aside><strong>公開前の最終確認</strong><p>危険な運動指示、停止を妨げる言葉、性的な家族表現、個人情報、外部連絡先は禁止です。自動検査と通報の対象になります。</p></aside>
      <div class="ai-text-training-review-actions"><button class="button button-primary" type="button" data-ai-text-training-action="confirm-publish" ${after < 0 || state.busyAction ? "disabled" : ""}>${state.busyAction ? "公開中…" : `${formatAnjuPay(state.policy.publishFee)}で公開する`}</button><button class="button button-ghost" type="button" data-ai-text-training-action="editor" ${state.busyAction ? "disabled" : ""}>入力へ戻る</button></div>
    </section>
  `, { eyebrow: "AUTHOR CONFIRMATION", title: "全文と残高を確認", backLabel: "入力へ戻る", backAction: "editor" });
}

function renderPurchaseReview() {
  const script = state.pendingPaidPreset || state.selectedPreset;
  const after = state.balance - Number(script.price || 0);
  return renderFrame(`
    <section class="ai-text-training-purchase-review">
      <span>ONE SESSION CONFIRMATION</span><h2>「${escapeHtml(script.title)}」を今回だけ使いますか？</h2>
      <p>${escapeHtml(script.description)}</p>
      <dl><div><dt>現在残高</dt><dd>${formatAnjuPay(state.balance)}</dd></div><div><dt>今回の価格</dt><dd>− ${formatAnjuPay(script.price)}</dd></div><div><dt>支払後残高</dt><dd>${formatAnjuPay(after)}</dd></div><div><dt>利用範囲</dt><dd>5ラウンド1セッション</dd></div></dl>
      <ul><li>買い切り・在庫ではなく、今回の開始と同時に使う応援です。</li><li>全文は安全確認のため公開されています。支払い対象は、BPMに同期した5ラウンド自動演出の1回利用です。</li><li>開始後の自主終了・「無理／痛い／めまい」即停止でも使い切りです。</li><li>通信切断や再読込では同じ利用を追加支払いなしで再開できます。</li><li>無料の標準応援へ戻ることもでき、購入は完全に任意です。</li></ul>
      <label class="ai-text-training-voluntary-check"><input type="checkbox" id="aiTextTrainingPurchaseConsent" /> 使い切り条件と支払後残高を確認し、自分の判断で使います</label>
      <div class="ai-text-training-review-actions"><button class="button button-primary" id="aiTextTrainingConfirmPurchase" type="button" data-ai-text-training-action="confirm-purchase" disabled>${state.busyAction ? "決済を確認中…" : `${formatAnjuPay(script.price)}で今回の応援を開始`}</button><button class="button button-ghost" type="button" data-ai-text-training-action="setup" ${state.busyAction ? "disabled" : ""}>支払わず準備へ戻る</button></div>
      ${after < 0 ? `<p class="ai-text-training-error">残高が不足しています。無料の標準応援はそのまま利用できます。</p>` : ""}
    </section>
  `, { eyebrow: "VOLUNTARY ONE-USE PAYMENT", title: "使い切り応援の確認", backLabel: "支払わず戻る", backAction: "setup" });
}

function xLink(row) {
  if (!row.xPublic || !/^[A-Za-z0-9_]{1,15}$/.test(row.xHandle || "")) return "";
  const url = `https://x.com/${encodeURIComponent(row.xHandle)}`;
  return `<a class="ai-text-training-x-link" href="${url}" target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer" data-ai-text-training-x>@${escapeHtml(row.xHandle)} ↗</a>`;
}

function rankingRow(row) {
  return `<article class="ai-text-training-ranking-row">
    <strong class="ai-text-training-rank">${Number(row.rank)}</strong>
    <div><h3>${escapeHtml(row.sellerName)}</h3>${xLink(row)}<small>作者の自己申告・本人未確認</small></div>
    <dl><div><dt>ランキング売上</dt><dd>${formatAnjuPay(row.rankingGross)}</dd></div><div><dt>実売上</dt><dd>${formatAnjuPay(row.actualGross)}</dd></div><div><dt>利用</dt><dd>${Number(row.useCount || 0)}回</dd></div><div><dt>購入者</dt><dd>${Number(row.uniqueBuyers || 0)}人</dd></div></dl>
  </article>`;
}

function renderRankings() {
  const rows = state.ranking?.rows || [];
  return renderFrame(`
    <nav class="ai-text-training-subnav"><button class="button button-ghost" type="button" data-ai-text-training-action="setup">トレーニング準備</button><button class="button button-ghost" type="button" data-ai-text-training-action="market">応援市場</button><button class="button button-ghost" type="button" data-ai-text-training-action="editor">台本を売る</button>${authStatusHtml()}</nav>
    <section class="ai-text-training-ranking-hero"><span>POPULARITY & CONTRIBUTION</span><h2>応援台本 売上ランキング</h2><p>人気と貢献の可視化です。順位によるPay報酬はありません。</p></section>
    <div class="ai-text-training-ranking-tabs"><button type="button" data-ai-text-training-ranking-period="monthly" aria-pressed="${state.rankingPeriod === "monthly"}">月間</button><button type="button" data-ai-text-training-ranking-period="lifetime" aria-pressed="${state.rankingPeriod === "lifetime"}">累計</button></div>
    <p class="ai-text-training-ranking-rule">同じ購入者→同じ作者はJST同日1回だけランキングへ加算します。対象外の利用でも、実決済と作者受取は通常どおり行われます。</p>
    <section class="ai-text-training-ranking-list">${state.rankingLoading ? `<div class="ai-text-training-empty"><strong>ランキングを読み込み中…</strong></div>` : state.rankingError ? `<div class="ai-text-training-empty"><strong>読み込めませんでした</strong><p>${escapeHtml(state.rankingError)}</p><button class="button button-ghost" type="button" data-ai-text-training-action="reload-rankings">再読み込み</button></div>` : rows.length ? rows.map(rankingRow).join("") : `<div class="ai-text-training-empty"><strong>この期間の売上はまだありません</strong></div>`}</section>
    <form class="ai-text-training-x-profile" id="aiTextTrainingXProfileForm">
      <div><span>OPTIONAL X PROFILE</span><h3>ランキングにXプロフィールを添える</h3><p>文字コラランキング専用の設定です。他市場のX公開は引き継ぎません。</p></div>
      <label>Xユーザー名<input name="xHandle" maxlength="16" placeholder="anju_example" value="${escapeHtml(state.profile.xHandle || "")}" /></label>
      <label class="ai-text-training-x-consent"><input type="checkbox" name="xPublic" ${state.profile.xPublic ? "checked" : ""} /> ランキングに任意公開する</label>
      <button class="button button-primary" type="submit" ${state.busyAction ? "disabled" : ""}>X公開設定を保存</button>
      <small>作者の自己申告として表示し、本人確認・X API取得・埋め込みは行いません。OFFにすると過去順位を残したままリンクだけ消えます。</small>
    </form>
  `, { eyebrow: "SUPPORT SALES RANKING", title: "応援台本の人気を見る", backLabel: "準備へ戻る", backAction: "setup" });
}

function currentBpm() {
  return Number(state.plan?.effectiveBpms?.[state.roundIndex] ?? state.bpms[state.roundIndex] ?? 0);
}

function tempoCopy(bpm) {
  return bpm === 0 ? "FREE RHYTHM" : `${bpm} BPM · ${aiTextTrainingTempoBand(bpm).toUpperCase()}`;
}

function trainingMood() {
  if (state.screen === "result") {
    return state.resultOutcome === "safety_stopped" ? "safety" : "clear";
  }
  if (["reaction", "next_preview", "paused"].includes(state.phase)) return "rest";
  if (state.phase === "countdown") return "ready";
  if (state.phase === "playing" && state.remainingMs <= 5_000) return "final";
  return "active";
}

function renderPlayingImage() {
  const image = state.images[state.roundIndex];
  return image
    ? `<img src="${escapeHtml(image.url)}" alt="ラウンド${state.roundIndex + 1}の選択画像" />`
    : `<div class="ai-text-training-missing-image"><strong>画像を選び直してください</strong></div>`;
}

function transitionMessage() {
  const previous = currentBpm();
  const next = Number(state.plan?.effectiveBpms?.[state.roundIndex + 1] ?? 0);
  const direction = aiTextTrainingTempoDirection(previous, next);
  const slot = aiTextTrainingScriptSlot({ phase: "transition", direction });
  const line = pickAiTextTrainingLine(state.selectedPreset.lines[slot], state.lastMessage, 0.37);
  return renderAiTextTrainingLine(line, {
    bpm: next,
    round: state.roundIndex + 2,
    remaining: state.roundSeconds,
  });
}

function restMessage() {
  const nextBpm = Number(state.plan?.effectiveBpms?.[state.roundIndex + 1] ?? 0);
  const slot = aiTextTrainingScriptSlot({ phase: "rest" });
  const line = pickAiTextTrainingLine(state.selectedPreset.lines[slot], state.lastMessage, 0.63);
  return renderAiTextTrainingLine(line, {
    bpm: nextBpm,
    round: state.roundIndex + 2,
    remaining: state.roundSeconds,
  });
}

function clearMessage() {
  const slot = aiTextTrainingScriptSlot({ phase: "clear" });
  const line = pickAiTextTrainingLine(state.selectedPreset.lines[slot], state.lastMessage, 0.79);
  return renderAiTextTrainingLine(line, {
    bpm: currentBpm(),
    round: AI_TEXT_TRAINING_ROUND_COUNT,
    remaining: 0,
  });
}

function renderPlay() {
  const bpm = currentBpm();
  const remainingSeconds = Math.max(0, Math.ceil(state.remainingMs / 1_000));
  const exercise = aiTextTrainingExercise(state.exerciseId);
  let center = "";
  if (state.phase === "reaction") {
    center = `<section class="ai-text-training-reaction">
      <span>ROUND ${state.roundIndex + 1} COMPLETE</span><h2>今の体感は？</h2>
      <p>「きつい」は、まだ続けられる時だけ選びます。無理・痛い・めまいは下の即停止です。</p>
      <div>${AI_TEXT_TRAINING_REACTIONS.map((reaction) => `<button class="button ${reaction.id === "hard_but_ok" ? "button-ghost" : "button-primary"}" type="button" data-ai-text-training-reaction="${reaction.id}">${escapeHtml(reaction.label)}</button>`).join("")}</div>
      ${state.modeId === "oneechan" ? `<strong class="ai-text-training-oneechan-warning">お姉ちゃんモードでは「きつい」で次のBPMが速くなります。</strong>` : ""}
    </section>`;
  } else if (state.phase === "next_preview") {
    const nextBpm = Number(state.plan.effectiveBpms[state.roundIndex + 1] ?? 0);
    center = `<section class="ai-text-training-next-preview">
      <span>NEXT ROUND ${state.roundIndex + 2}</span><h2>${escapeHtml(tempoCopy(nextBpm))}</h2><blockquote class="ai-text-training-message-surface">${escapeHtml(transitionMessage())}</blockquote>
      <p class="ai-text-training-message-surface">${escapeHtml(restMessage())}</p>
      <small>メトロノームはまだ停止中です。自分で次へ進むまで休めます。</small>
      <button class="button button-primary" type="button" data-ai-text-training-action="next-round">3秒後に次のラウンド</button>
    </section>`;
  } else if (state.phase === "paused") {
    center = `<section class="ai-text-training-pause-overlay"><span>PAUSED</span><h2>一時停止中</h2><p>非表示中の時間は運動時間へ加えません。自動では再開しません。</p><button class="button button-primary" type="button" data-ai-text-training-action="resume-round">3秒後に再開</button></section>`;
  } else {
    center = `<div class="ai-text-training-round-overlay">
      ${state.phase === "countdown" ? `<strong class="ai-text-training-countdown">${state.countdownValue}</strong>` : ""}
      <div class="ai-text-training-round-top"><span>ROUND ${state.roundIndex + 1} / 5</span><strong>${escapeHtml(tempoCopy(bpm))}</strong></div>
      <div class="ai-text-training-timer"><strong id="aiTextTrainingRemaining">${remainingSeconds}</strong><small>SEC</small></div>
      <div class="ai-text-training-progress" aria-hidden="true"><i id="aiTextTrainingProgress" style="width:${Math.max(0, Math.min(100, (state.remainingMs / (state.roundSeconds * 1_000)) * 100))}%"></i></div>
      <div class="ai-text-training-cheer ai-text-training-message-surface" id="aiTextTrainingCheer">${escapeHtml(state.currentMessage || "準備できたら、自分のペースで")}</div>
      <div class="ai-text-training-exercise"><strong>${escapeHtml(exercise.label)}</strong><small>${escapeHtml(exercise.cue)}</small></div>
    </div>`;
  }
  return renderFrame(`
    <section class="ai-text-training-arena ${state.phase === "countdown" ? "is-countdown" : ""}" data-att-mood="${escapeHtml(trainingMood())}" data-att-tempo="${escapeHtml(aiTextTrainingTempoBand(bpm))}">
      <div class="ai-text-training-opponent">${renderPlayingImage()}<div class="ai-text-training-vignette" aria-hidden="true"></div></div>
      ${center}
      <div class="ai-text-training-safety-controls">
        ${["playing", "countdown"].includes(state.phase) ? `<button class="button button-ghost" type="button" data-ai-text-training-action="pause">一時停止</button>` : ""}
        <button class="button button-ghost" type="button" data-ai-text-training-action="toggle-mute" aria-pressed="${state.muted}">${escapeHtml(beatCharacter(state.sessionBeatCharacterId).label)} ${state.muted ? "OFF" : "ON"}</button>
        <button class="button button-danger ai-text-training-emergency" type="button" data-ai-text-training-action="emergency-stop">無理・痛い・めまい／即停止</button>
        <button class="button button-ghost" type="button" data-ai-text-training-action="exit-session">運動を終了</button>
      </div>
      <p class="ai-text-training-system-safety">痛み・めまい・息苦しさ・体調不良がある時は、台本に関係なく即停止してください。</p>
    </section>
  `, { eyebrow: `${aiTextTrainingMode(state.modeId).label} · ${escapeHtml(state.selectedPreset.title)}`, title: "SOLO TRAINING", backLabel: "終了", backAction: "exit-session" });
}

function resultTitle() {
  if (state.resultOutcome === "completed") return "5ラウンド完走";
  if (state.resultOutcome === "safety_stopped") return "安全のため停止しました";
  return "ここでトレーニング終了";
}

function formatActiveDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}分${seconds}秒`;
}

function renderResultLineup() {
  return `<section class="ai-text-training-result-lineup" aria-label="今回DRAWされた5枚">
    ${state.images.map((image, index) => `<figure>
      ${image ? `<img src="${escapeHtml(image.url)}" alt="今回のラウンド${index + 1}の画像" />` : `<span>${index + 1}</span>`}
      <figcaption>R${index + 1} · ${state.bpms[index] === 0 ? "FREE" : `${state.bpms[index]} BPM`}</figcaption>
    </figure>`).join("")}
  </section>`;
}

function renderResult() {
  const completedRounds = state.resultOutcome === "completed"
    ? AI_TEXT_TRAINING_ROUND_COUNT
    : Math.min(AI_TEXT_TRAINING_ROUND_COUNT, state.completedRounds);
  const achievementPending = Boolean(currentAchievementRetryRecord()?.outcome);
  const rosterCount = rosterEntries().length;
  const replayAllowed = state.resultOutcome !== "safety_stopped";
  const alternateDrawAllowed = state.resultOutcome === "completed"
    && rosterCount > AI_TEXT_TRAINING_ROUND_COUNT
    && !(rosterCount === AI_TEXT_TRAINING_ROSTER_MAX_COUNT && state.drawLeg === 2);
  return renderFrame(`
    <section class="ai-text-training-result ${state.resultOutcome === "safety_stopped" ? "is-safety" : ""}">
      <span>${state.resultOutcome === "completed" ? "SESSION CLEAR" : "SESSION ENDED"}</span>
      <h2>${escapeHtml(resultTitle())}</h2>
      <p>${state.resultOutcome === "safety_stopped" ? "止まる判断は失敗ではありません。体調が戻らない場合は運動を再開しないでください。" : "動作の回数やフォームは判定していません。実際に到達した範囲だけを記録します。"}</p>
      ${state.resultOutcome === "completed" ? `<blockquote class="ai-text-training-message-surface">${escapeHtml(clearMessage())}</blockquote>` : ""}
      ${renderResultLineup()}
      <dl><div><dt>到達</dt><dd>${completedRounds} / 5 ROUND</dd></div><div><dt>運動時間</dt><dd>${formatActiveDuration(state.completedActiveSeconds)}</dd></div><div><dt>AI性格</dt><dd>${escapeHtml(aiTextTrainingMode(state.modeId).label)}</dd></div><div><dt>ビート</dt><dd>${escapeHtml(beatCharacter(state.sessionBeatCharacterId).label)}</dd></div><div><dt>応援</dt><dd>${escapeHtml(state.selectedPreset.title)}</dd></div></dl>
      ${state.finishPending ? `<p class="ai-text-training-pending">${state.finishInFlight ? "有料利用の終了記録を送信中です。" : "有料利用の終了記録を確認できませんでした。再送してください。"}追加請求はありません。</p>` : ""}
      ${achievementPending ? `<p class="ai-text-training-pending">${state.achievementRetryInFlight ? "実績記録を送信中です。" : "実績記録を送信できませんでした。"}運動結果を妨げず、画像・BPM・台詞を含まない最小限の記録だけをこの端末に残して再送します。</p>` : ""}
      <p>実績はカメラや動作判定を使わず、5ラウンド完走時だけ1回加算します。安全停止・途中終了では加算せず、解除済み実績や既存の進捗も減りません。</p>
      <div>${replayAllowed ? `<button class="button button-primary" type="button" data-ai-text-training-action="setup-after-result" ${state.finishPending || state.activeUse ? "disabled" : ""}>${state.finishPending || state.activeUse ? "終了記録の確認後にもう一度" : "同じ5枚で再戦準備"}</button>` : ""}${alternateDrawAllowed ? `<button class="button button-ghost" type="button" data-ai-text-training-action="alternate-draw-after-result" ${state.finishPending || state.activeUse ? "disabled" : ""}>${rosterCount === AI_TEXT_TRAINING_ROSTER_MAX_COUNT ? "未登場の残り5枚で再戦" : "別の5枚をDRAWして再戦"}</button>` : ""}${state.finishPending ? `<button class="button button-ghost" type="button" data-ai-text-training-action="retry-finish" ${state.finishInFlight ? "disabled" : ""}>終了記録を再送</button>` : ""}${achievementPending ? `<button class="button button-ghost" type="button" data-ai-text-training-action="retry-achievement-finish" ${state.achievementRetryInFlight ? "disabled" : ""}>実績記録を再送</button>` : ""}<button class="button button-ghost" type="button" data-ai-text-training-action="home">トップへ戻る</button></div>
      <small>水分を取り、必要なら十分に休んでください。実績送信の失敗を理由に運動を続ける必要はありません。</small>
    </section>
  `, { eyebrow: "SOLO RESULT", title: "文字コラトレーニング結果", backLabel: "トップへ", backAction: "home" });
}

function render() {
  if (!active) return;
  let html = "";
  if (state.screen === "setup") html = renderSetup();
  if (state.screen === "market") html = renderMarket();
  if (state.screen === "preset_detail") html = renderPresetDetail();
  if (state.screen === "editor") html = renderEditor();
  if (state.screen === "editor_review") html = renderEditorReview();
  if (state.screen === "purchase_review") html = renderPurchaseReview();
  if (state.screen === "draw_review") html = renderDrawReview();
  if (state.screen === "rankings") html = renderRankings();
  if (state.screen === "play") html = renderPlay();
  if (state.screen === "result") html = renderResult();
  appRoot.innerHTML = html || renderSetup();
  bindEvents();
  const renderedKey = `${state.screen}:${state.phase}`;
  if (renderedKey !== state.previousRenderedScreen) {
    appRoot.focus({ preventScroll: true });
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    state.previousRenderedScreen = renderedKey;
  }
}

function updateEditorDraftFromForm(form) {
  const formData = new FormData(form);
  const modeId = String(formData.get("modeId") || "mama");
  const previousMode = state.editorDraft?.modeId;
  const fallback = normalizeAiTextTrainingScriptSnapshot(
    AI_TEXT_TRAINING_BUILTIN_SCRIPTS[modeId],
  );
  const lines = {};
  for (const slot of AI_TEXT_TRAINING_SCRIPT_SLOTS) {
    const value = String(formData.get(`slot_${slot.id}`) || "");
    lines[slot.id] = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (previousMode !== modeId && !lines[slot.id].length) {
      lines[slot.id] = [...fallback.lines[slot.id]];
    }
  }
  const existing = state.ownPresets.find((preset) => preset.modeId === modeId);
  state.editorDraft = {
    presetId: existing?.id || "",
    baseRevision: Number(existing?.revision || 0),
    sellerName: String(formData.get("sellerName") || "").trim(),
    modeId,
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    price: Number(formData.get("price") || 10),
    lines,
  };
}

function validateEditorDraft(draft) {
  if (!AI_TEXT_TRAINING_MODES.some((mode) => mode.id === draft.modeId)) {
    throw new Error("AI性格を選び直してください。");
  }
  if (!draft.sellerName || draft.sellerName.length > 16) {
    throw new Error("作者名は1行16文字以内で入力してください。");
  }
  if (!draft.title || draft.title.length > 30) {
    throw new Error("台本名は1行30文字以内で入力してください。");
  }
  if (draft.description.length < 10 || draft.description.length > 120) {
    throw new Error("紹介文は10〜120文字で入力してください。");
  }
  for (const slot of AI_TEXT_TRAINING_SCRIPT_SLOTS) {
    const lines = draft.lines[slot.id] || [];
    if (lines.length < 2 || lines.length > 4) {
      throw new Error(`「${slot.label}」へ2〜4行入力してください。`);
    }
    if (lines.some((line) => line.length < 4 || line.length > 42)) {
      throw new Error(`「${slot.label}」は1行4〜42文字で入力してください。`);
    }
  }
}

async function handleImageSelection(input) {
  const index = Number(input.dataset.aiTextTrainingImage);
  const file = input.files?.[0];
  if (!file
      || !Number.isInteger(index)
      || index < 0
      || index >= AI_TEXT_TRAINING_ROSTER_MAX_COUNT) {
    return;
  }
  input.disabled = true;
  try {
    const item = await shared()?.processImageFile?.(file, index, {
      maxSide: 1_280,
      quality: 0.82,
    });
    if (!item) throw new Error("画像を準備できませんでした。");
    releaseImage(state.rosterImages[index]);
    state.rosterImages[index] = item;
    state.rosterExpanded = state.rosterExpanded || index >= AI_TEXT_TRAINING_ROUND_COUNT;
    invalidatePendingDraw();
    await persistRosterIfConsented();
    render();
  } catch (error) {
    showToast(error?.message || "画像を準備できませんでした。");
    input.disabled = false;
  }
}

async function removeRosterImage(index) {
  if (!Number.isInteger(index)
      || index < 0
      || index >= AI_TEXT_TRAINING_ROSTER_MAX_COUNT
      || !state.rosterImages[index]) {
    return;
  }
  releaseImage(state.rosterImages[index]);
  state.rosterImages[index] = null;
  invalidatePendingDraw();
  try {
    await persistRosterIfConsented();
  } catch {
    showToast("画面から外しましたが、端末保存を更新できませんでした。保存ロスターを確認してください。");
  }
  render();
}

async function refreshMarketState() {
  if (!state.authReady || state.preview) return;
  const response = await aiTextTrainingAction({
    action: "state",
    modeId: state.marketModeFilter,
  });
  const data = response.data || {};
  state.balance = Number(data.balance || state.balance);
  state.policy = data.policy || state.policy;
  state.marketPresets = Array.isArray(data.presets) ? data.presets : [];
  state.ownPresets = Array.isArray(data.ownPresets) ? data.ownPresets : [];
  state.profile = data.profile || state.profile;
  state.activeUse = data.activeUse || null;
}

async function loadRankings(period = state.rankingPeriod) {
  state.rankingPeriod = period;
  state.rankingLoading = true;
  state.rankingError = "";
  render();
  if (state.preview) {
    state.rankingLoading = false;
    render();
    return;
  }
  if (!state.authReady) {
    state.rankingLoading = false;
    state.rankingError = state.authError || "市場への接続を待っています。";
    render();
    return;
  }
  try {
    const response = await aiTextTrainingAction({ action: "rankings", period });
    state.ranking = response.data || { period, rows: [] };
  } catch (error) {
    state.rankingError = error?.message || "ランキングを読み込めませんでした。";
  } finally {
    state.rankingLoading = false;
    render();
  }
}

async function publishEditorDraft() {
  if (state.preview) {
    showToast("プレビューではAnjuPayを使用しません。");
    state.screen = "editor";
    render();
    return;
  }
  if (!state.authReady) throw new Error("市場への接続を確認できません。");
  if (!state.editorActionId) state.editorActionId = generatedActionId("publish");
  state.busyAction = "publish";
  render();
  try {
    const response = await aiTextTrainingAction({
      action: "publish",
      actionId: state.editorActionId,
      expectedBalance: state.balance,
      ...state.editorDraft,
    });
    state.balance = Number(response.data?.balance ?? state.balance);
    state.editorActionId = "";
    state.busyAction = "";
    await refreshMarketState();
    state.modeId = state.editorDraft.modeId;
    state.marketModeFilter = state.modeId;
    state.screen = "editor";
    state.editorDraft = createEditorDraft();
    showToast("応援台本を公開しました。");
    render();
  } catch (error) {
    state.busyAction = "";
    showToast(error?.message || "応援台本を公開できませんでした。");
    render();
  }
}

async function unpublishCurrentPreset() {
  const preset = state.ownPresets.find((item) => item.modeId === state.editorDraft?.modeId);
  if (!preset) return;
  if (!window.confirm("この台本の新しい利用を停止しますか？ 開始済みの利用内容は変わりません。")) return;
  if (state.preview) {
    showToast("プレビューでは公開状態を変更しません。");
    return;
  }
  state.busyAction = "unpublish";
  render();
  try {
    await aiTextTrainingAction({ action: "unpublish", presetId: preset.id });
    await refreshMarketState();
    state.editorDraft = createEditorDraft();
    showToast("新しい利用受付を停止しました。");
  } catch (error) {
    showToast(error?.message || "公開を停止できませんでした。");
  } finally {
    state.busyAction = "";
    render();
  }
}

async function saveXProfile(form) {
  if (state.preview) {
    showToast("プレビューではX公開設定を保存しません。");
    return;
  }
  const formData = new FormData(form);
  state.busyAction = "save_profile";
  render();
  try {
    const response = await aiTextTrainingAction({
      action: "save_profile",
      xPublic: formData.get("xPublic") === "on",
      xHandle: String(formData.get("xHandle") || "").trim(),
    });
    state.profile = response.data?.profile || state.profile;
    showToast(state.profile.xPublic ? "ランキングのXリンクを公開しました。" : "ランキングのXリンクを非公開にしました。");
    await loadRankings(state.rankingPeriod);
  } catch (error) {
    showToast(error?.message || "X公開設定を保存できませんでした。");
  } finally {
    state.busyAction = "";
    if (state.screen === "rankings") render();
  }
}

async function reportSelectedPreset(form) {
  if (state.preview) {
    showToast("プレビューでは通報を送信しません。");
    return;
  }
  if (!state.authReady) throw new Error("市場への接続を確認できません。");
  const formData = new FormData(form);
  const viewedPreset = state.marketPresets.find(
    (preset) => preset.id === state.selectedMarketPresetId,
  );
  if (!viewedPreset) throw new Error("通報する台本を読み直してください。");
  const response = await aiTextTrainingAction({
    action: "report",
    presetId: state.selectedMarketPresetId,
    expectedRevision: viewedPreset.revision,
    reason: String(formData.get("reason") || ""),
  });
  if (response.data?.quarantined) {
    await refreshMarketState();
    state.selectedMarketPresetId = "";
    state.screen = "market";
    showToast("複数の購入者による安全通報を受け、台本とXリンクを確認のため非公開にしました。");
    render();
    return;
  }
  if (response.data?.reported) {
    showToast("通報を受け付けました。改訂内容の証跡を保存しました。");
  }
}

function validateRoster() {
  const entries = rosterEntries();
  if (!isAiTextTrainingRosterCount(entries.length)) {
    throw new Error("対戦候補の画像を5〜10枚登録してください。");
  }
  const normalizedEntries = entries.map((entry) => ({
    ...entry,
    bpm: normalizeAiTextTrainingBpm(entry.bpm),
  }));
  if (normalizedEntries.some((entry) => entry.bpm === null)) {
    throw new Error("BPMは0または40〜160の整数で設定してください。");
  }
  return normalizedEntries;
}

function currentPendingDrawIndices(entries = validateRoster()) {
  if (entries.length === AI_TEXT_TRAINING_ROUND_COUNT) {
    return Array.from({ length: AI_TEXT_TRAINING_ROUND_COUNT }, (_, index) => index);
  }
  return normalizeAiTextTrainingDrawIndices(
    state.pendingDrawIndices,
    entries.length,
  );
}

function drawRoster({ previousIndices = null } = {}) {
  const entries = validateRoster();
  state.drawLeg = 1;
  state.pendingDrawIndices = drawAiTextTrainingRosterIndices({
    rosterCount: entries.length,
    previousIndices,
  });
  state.screen = "draw_review";
  state.previousRenderedScreen = "";
  render();
  announceCurrentDraw(entries);
}

function announceCurrentDraw(entries = validateRoster()) {
  const indices = normalizeAiTextTrainingDrawIndices(
    state.pendingDrawIndices,
    entries.length,
  );
  if (!indices) return;
  const summary = indices.map((index, roundIndex) => {
    const bpm = entries[index].bpm;
    return `ラウンド${roundIndex + 1}、${bpm === 0 ? "フリーリズム" : `${bpm} BPM`}`;
  }).join("。");
  announce(`AI DRAWが決まりました。${summary}。`);
}

function newSessionPlan() {
  const entries = validateRoster();
  const drawIndices = currentPendingDrawIndices(entries);
  if (!drawIndices) throw new Error("AI DRAWを確認してから開始してください。");
  state.sessionDrawIndices = [...drawIndices];
  state.images = drawIndices.map((index) => entries[index].image);
  state.bpms = drawIndices.map((index) => entries[index].bpm);
  state.sessionBeatCharacterId = normalizeBeatCharacterId(state.beatCharacterId);
  state.sessionCosmetics = equippedCosmetics();
  state.plan = createAiTextTrainingPlan({
    modeId: state.modeId,
    bpms: state.bpms,
    randomValues: Array.from({ length: 4 }, () => Math.random()),
  });
  state.roundIndex = 0;
  state.remainingMs = state.roundSeconds * 1_000;
  state.lastAnnouncedSecond = null;
  state.completedActiveSeconds = 0;
  state.completedRounds = 0;
  state.sessionStartedAt = Date.now();
  state.resultOutcome = "";
  state.achievementActionId = generatedActionId("achievement_session");
  state.achievementSessionId = "";
  state.achievementBeginRequested = false;
  state.achievementRetryError = "";
  state.recoveryRosterCount = 0;
  state.recoveryError = "";
  state.phase = "paused";
}

function continuePreparedSession() {
  currentPendingDrawIndices();
  if (state.activeUse) {
    newSessionPlan();
    state.screen = "play";
    state.phase = "paused";
    persistSession();
    render();
    return;
  }
  if (state.selectedPresetSource === "market" && Number(state.selectedPreset.price || 0) > 0) {
    state.pendingPaidPreset = state.selectedPreset;
    state.purchaseActionId = "";
    state.screen = "purchase_review";
    render();
    return;
  }
  state.paidUseId = "";
  newSessionPlan();
  state.screen = "play";
  persistSession();
  render();
}

function prepareStartSession() {
  window.clearTimeout(state.beatPreviewTimer);
  state.beatPreviewTimer = null;
  state.ambienceController.disable();
  if (!state.preview && !state.authSettled) {
    throw new Error("開始済みの有料応援と残高の確認が終わるまでお待ちください。");
  }
  const entries = validateRoster();
  if (state.cosmeticDraft) {
    throw new Error("演出を試着中です。「この組み合わせを装着」または「試着を取り消す」を選んでください。");
  }
  if (state.activeUse?.preset) {
    state.modeId = state.activeUse.preset.modeId;
    state.marketModeFilter = state.modeId;
  }
  selectedPresetForMode();
  if (state.activeUse) {
    state.selectedPreset = presetSnapshot(state.activeUse.preset);
    state.selectedPresetSource = "active_use";
    state.paidUseId = state.activeUse.id;
    const recovered = recoverPaidSession();
    if (!recovered && state.recoveryError) {
      throw new Error(`${state.recoveryError}確定済み利用の内容を変更せず停止しています。`);
    }
    if (recovered && state.resultOutcome) {
      showToast("この1回分は終了記録の確認中です。完了後に新しい利用を開始できます。");
      render();
      return;
    }
    if (recovered && state.plan) {
      if (state.sessionDrawIndices.length !== AI_TEXT_TRAINING_ROUND_COUNT
          || state.images.some((image) => !image)) {
        throw new Error(`開始時と同じ${state.recoveryRosterCount || AI_TEXT_TRAINING_ROUND_COUNT}枚のロスターを選び直してください。DRAW結果と追加請求は変わりません。`);
      }
      state.screen = "play";
      state.phase = state.phase === "reaction" || state.phase === "next_preview"
        ? state.phase
        : "paused";
      persistSession();
      render();
      return;
    }
  }
  selectedPresetForMode();
  if (entries.length > AI_TEXT_TRAINING_ROUND_COUNT) {
    const existingDraw = currentPendingDrawIndices(entries);
    if (!existingDraw) {
      state.pendingDrawIndices = drawAiTextTrainingRosterIndices({
        rosterCount: entries.length,
      });
      state.drawLeg = 1;
    }
    state.screen = "draw_review";
    render();
    announceCurrentDraw(entries);
    return;
  }
  state.pendingDrawIndices = Array.from(
    { length: AI_TEXT_TRAINING_ROUND_COUNT },
    (_, index) => index,
  );
  state.drawLeg = 1;
  continuePreparedSession();
}

async function saveCosmetics() {
  const selection = previewCosmetics();
  if (!state.cosmeticDraft || sameCosmetics(selection, equippedCosmetics())) {
    state.cosmeticDraft = null;
    render();
    return;
  }
  if (!aiTextTrainingCosmeticsAreOwned(selection, state.cosmetics.ownedStyleIds)) {
    throw new Error("未購入の演出は試着できますが、装着はできません。AnjuPayストアで購入してください。");
  }
  if (!state.authReady) {
    throw new Error("市場との接続を確認できないため、装着を保存できません。");
  }
  if (state.preview) {
    state.cosmetics = {
      ...selection,
      ownedStyleIds: [...state.cosmetics.ownedStyleIds],
    };
    state.cosmeticDraft = null;
    showToast("プレビュー上で装着しました。");
    render();
    return;
  }
  state.cosmeticBusy = true;
  render();
  try {
    const response = await aiTextTrainingAction({
      action: "save_cosmetics",
      panelThemeId: selection.panelThemeId,
      messageDecorationId: selection.messageDecorationId,
    });
    if (!active) return;
    state.cosmetics = normalizeServerCosmetics(response.data?.cosmetics);
    state.cosmeticDraft = null;
    showToast("トレーニング演出を装着しました。次のセッションから固定して使います。");
  } finally {
    if (active) {
      state.cosmeticBusy = false;
      render();
    }
  }
}

async function confirmPaidUse() {
  const consent = document.querySelector("#aiTextTrainingPurchaseConsent");
  if (!consent?.checked) {
    showToast("使い切り条件と支払後残高を確認してください。");
    consent?.focus();
    return;
  }
  if (state.preview) {
    state.activeUse = {
      id: "3333333333333333333333333333333333333333",
      preset: state.pendingPaidPreset,
    };
    state.modeId = state.pendingPaidPreset.modeId;
    state.selectedPreset = state.pendingPaidPreset;
    state.selectedPresetSource = "active_use";
    state.paidUseId = state.activeUse.id;
    newSessionPlan();
    state.screen = "play";
    render();
    return;
  }
  if (!state.authReady) {
    showToast("市場への接続を確認できません。無料の標準応援は利用できます。");
    return;
  }
  if (!state.purchaseActionId) state.purchaseActionId = generatedActionId("use");
  state.busyAction = "purchase";
  render();
  try {
    const script = state.pendingPaidPreset;
    const response = await aiTextTrainingAction({
      action: "start_paid_use",
      actionId: state.purchaseActionId,
      presetId: script.id,
      expectedPrice: script.price,
      expectedRevision: script.revision,
      expectedBalance: state.balance,
    });
    if (response.data?.terminalAction === true) {
      state.activeUse = null;
      state.paidUseId = "";
      state.purchaseActionId = "";
      state.busyAction = "";
      showToast("この1回分は終了済みです。もう一度使う場合は、支払後残高を改めて確認してください。");
      render();
      return;
    }
    const use = response.data?.use;
    if (!use?.id) throw new Error("利用記録を確認できませんでした。");
    if (use.status !== "active") {
      state.activeUse = null;
      state.paidUseId = "";
      state.purchaseActionId = "";
      state.busyAction = "";
      showToast("この1回分は終了済みです。もう一度使う場合は、支払後残高を改めて確認してください。");
      render();
      return;
    }
    state.activeUse = use;
    state.modeId = use.preset.modeId;
    state.balance = Number(use.buyerBalanceAfter ?? state.balance);
    state.selectedPreset = presetSnapshot(use.preset);
    state.selectedPresetSource = "active_use";
    state.paidUseId = use.id;
    state.pendingPaidPreset = null;
    state.purchaseActionId = "";
    state.busyAction = "";
    newSessionPlan();
    state.screen = "play";
    persistSession();
    render();
  } catch (error) {
    state.busyAction = "";
    try {
      await refreshMarketState();
      if (state.activeUse?.preset) {
        state.selectedPreset = presetSnapshot(state.activeUse.preset);
        state.selectedPresetSource = "active_use";
        state.paidUseId = state.activeUse.id;
        state.screen = "setup";
      }
    } catch {
      // Keep the same action ID so the exact transaction can be retried.
    }
    showToast(error?.message || "利用決済を完了できませんでした。");
    render();
  }
}

async function previewBeatCharacter(value) {
  if (state.screen !== "setup") return;
  const characterId = normalizeBeatCharacterId(value);
  if (!paidRecoverySettingsLocked()) {
    state.beatCharacterId = characterId;
    writeLocalValue(BEAT_CHARACTER_PREFERENCE_KEY, characterId);
  }
  window.clearTimeout(state.beatPreviewTimer);
  state.beatPreviewTimer = null;
  state.ambienceController.disable();
  const effectiveAt = Date.now() + 120;
  state.ambienceRevision += 1;
  state.ambienceController.setToneProfile(characterId, { effectiveAt });
  state.ambienceController.setAmbience({
    metronomeBpm: 96,
    revision: state.ambienceRevision,
    effectiveAt,
    lightingId: "ai-text-training-beat-preview",
    updatedAt: Date.now(),
  }, {
    serverTimeOffset: 0,
    rephase: true,
  });
  state.ambienceController.setMuted(false);
  const enabled = await state.ambienceController.enable();
  if (!enabled) throw new Error("このブラウザーでは音色を再生できません。");
  state.beatPreviewTimer = window.setTimeout(() => {
    state.beatPreviewTimer = null;
    state.ambienceController.disable();
    state.ambienceController.setMuted(state.muted);
  }, 2_200);
  render();
}

function configureRoundAmbience(effectiveAt) {
  state.ambienceRevision += 1;
  state.ambienceController.setToneProfile(
    state.sessionBeatCharacterId,
    { effectiveAt },
  );
  state.ambienceController.setAmbience({
    metronomeBpm: currentBpm(),
    revision: state.ambienceRevision,
    effectiveAt,
    lightingId: `ai-text-training-${state.roundIndex}`,
    updatedAt: Date.now(),
  }, {
    serverTimeOffset: 0,
    rephase: true,
  });
  state.ambienceController.setMuted(state.muted);
}

function announce(message) {
  const element = document.querySelector("#aiTextTrainingAnnouncer");
  if (!element) return;
  element.textContent = "";
  window.setTimeout(() => {
    if (element.isConnected) element.textContent = message;
  }, 20);
}

function supportMessage({ initial = false } = {}) {
  if (!active || state.screen !== "play" || state.phase !== "playing") return;
  const remainingSeconds = Math.max(0, Math.ceil(state.remainingMs / 1_000));
  const slot = aiTextTrainingScriptSlot({
    phase: initial ? "start" : "active",
    bpm: currentBpm(),
    remainingSeconds,
  });
  const line = pickAiTextTrainingLine(
    state.selectedPreset.lines[slot],
    state.lastMessage,
  );
  state.lastMessage = line;
  state.currentMessage = renderAiTextTrainingLine(line, {
    bpm: currentBpm(),
    round: state.roundIndex + 1,
    remaining: remainingSeconds,
  });
  const element = document.querySelector("#aiTextTrainingCheer");
  if (element) element.textContent = state.currentMessage;
  window.clearTimeout(state.messageTimer);
  state.messageTimer = window.setTimeout(
    () => supportMessage(),
    aiTextTrainingMessageCadenceMs(currentBpm()),
  );
}

function updatePlayingDom() {
  if (state.phase !== "playing") return;
  state.remainingMs = Math.max(0, state.roundEndsAt - performance.now());
  const remainingSeconds = Math.max(0, Math.ceil(state.remainingMs / 1_000));
  const timer = document.querySelector("#aiTextTrainingRemaining");
  if (timer) timer.textContent = String(remainingSeconds);
  const progress = document.querySelector("#aiTextTrainingProgress");
  if (progress) progress.style.width = `${Math.max(0, (state.remainingMs / (state.roundSeconds * 1_000)) * 100)}%`;
  const arena = document.querySelector(".ai-text-training-arena");
  if (arena) arena.dataset.attMood = remainingSeconds <= 5 ? "final" : "active";
  if (
    state.roundSeconds >= 45
    && remainingSeconds === 30
    && state.lastAnnouncedSecond !== 30
  ) {
    state.lastAnnouncedSecond = 30;
    announce(`ラウンド${state.roundIndex + 1}、残り30秒です。`);
  }
  if (remainingSeconds === 5 && state.lastAnnouncedSecond !== 5) {
    state.lastAnnouncedSecond = 5;
    announce(`ラウンド${state.roundIndex + 1}、残り5秒です。`);
    supportMessage();
  }
  if (state.remainingMs <= 0) finishRound();
}

function beginRound() {
  window.clearInterval(state.countdownTimer);
  state.countdownTimer = null;
  state.phase = "playing";
  state.roundEndsAt = performance.now() + state.remainingMs;
  render();
  announce(`ラウンド${state.roundIndex + 1}を開始します。${tempoCopy(currentBpm())}です。`);
  supportMessage({ initial: true });
  state.ticker = window.setInterval(updatePlayingDom, 100);
  acquireWakeLock();
  persistSession();
}

function beginAchievementTracking() {
  if (state.preview
      || state.roundIndex !== 0
      || state.achievementBeginRequested
      || !state.achievementActionId) {
    return;
  }
  state.achievementBeginRequested = true;
  const currentOwner = currentAchievementOwner();
  writeAchievementRetryQueue(readAchievementRetryQueue().map((record) => (
    record.actionId !== state.achievementActionId
      && !record.outcome
      && achievementRetryOwnerMatches(record, currentOwner)
      ? {
        ...record,
        outcome: "exited",
        completedRounds: 0,
        activeSeconds: 0,
      }
      : record
  )));
  const pending = upsertAchievementRetryRecord({
    ...currentOwner,
    actionId: state.achievementActionId,
    modeId: state.modeId,
    roundSeconds: state.roundSeconds,
    sessionId: state.achievementSessionId,
    outcome: "",
    completedRounds: 0,
    activeSeconds: 0,
  });
  if (pending?.sessionId) state.achievementSessionId = pending.sessionId;
  if (pending) {
    writeAchievementRetryQueue([
      pending,
      ...readAchievementRetryQueue()
        .filter((record) => record.actionId !== pending.actionId),
    ]);
  }
  persistSession();
  flushAchievementRetryQueue().catch(() => {});
}

function startRoundCountdown() {
  if (!state.plan) return;
  beginAchievementTracking();
  stopRuntimeTimers();
  releaseWakeLock();
  state.phase = "countdown";
  state.countdownValue = 3;
  configureRoundAmbience(Date.now() + 3_000);
  state.ambienceController.enable().catch(() => {
    showToast("メトロノームを再生できませんでした。無音でも進行できます。");
  });
  render();
  announce("3秒後にトレーニングを開始します。");
  state.countdownTimer = window.setInterval(() => {
    state.countdownValue -= 1;
    const element = document.querySelector(".ai-text-training-countdown");
    if (element) element.textContent = String(Math.max(0, state.countdownValue));
    if (state.countdownValue <= 0) beginRound();
  }, 1_000);
}

function pauseSession({ fromVisibility = false } = {}) {
  if (!["playing", "countdown"].includes(state.phase)) return;
  if (state.phase === "playing" && state.roundEndsAt) {
    state.remainingMs = Math.max(0, state.roundEndsAt - performance.now());
  }
  stopRuntimeTimers();
  state.ambienceController.disable();
  releaseWakeLock();
  state.phase = "paused";
  persistSession();
  render();
  if (fromVisibility) announce("画面が非表示になったため一時停止しました。");
}

function currentRoundElapsedSeconds() {
  const roundMs = Math.max(0, (Number(state.roundSeconds) || 0) * 1_000);
  const rawRemainingMs = Number(state.remainingMs);
  const remainingMs = Number.isFinite(rawRemainingMs)
    ? Math.max(0, Math.min(roundMs, rawRemainingMs))
    : roundMs;
  return (roundMs - remainingMs) / 1_000;
}

function recordCurrentRoundElapsed() {
  if (state.completedRounds > state.roundIndex) return;
  state.completedActiveSeconds += currentRoundElapsedSeconds();
}

function finishRound() {
  if (state.phase !== "playing") return;
  recordCurrentRoundElapsed();
  state.completedRounds = Math.max(state.completedRounds, state.roundIndex + 1);
  state.remainingMs = 0;
  stopRuntimeTimers();
  state.ambienceController.disable();
  releaseWakeLock();
  state.phase = "reaction";
  persistSession();
  render();
  announce(`ラウンド${state.roundIndex + 1}が終わりました。体感を選んでください。`);
}

function chooseReaction(reactionId) {
  try {
    applyAiTextTrainingReaction(state.plan, state.roundIndex, reactionId);
  } catch (error) {
    showToast(error?.message || "反応を確定できませんでした。");
    return;
  }
  if (state.roundIndex >= AI_TEXT_TRAINING_ROUND_COUNT - 1) {
    completeSession("completed");
    return;
  }
  state.phase = "next_preview";
  persistSession();
  render();
}

function advanceRound() {
  state.roundIndex += 1;
  state.remainingMs = state.roundSeconds * 1_000;
  state.lastAnnouncedSecond = null;
  state.phase = "paused";
  persistSession();
  startRoundCountdown();
}

function queueAchievementFinish(outcome) {
  if (state.preview
      || !state.achievementBeginRequested
      || !state.achievementActionId
      || !["completed", "safety_stopped", "exited"].includes(outcome)) {
    return false;
  }
  const completedRounds = outcome === "completed"
    ? AI_TEXT_TRAINING_ROUND_COUNT
    : Math.max(0, Math.min(
      AI_TEXT_TRAINING_ROUND_COUNT,
      Number(state.completedRounds) || 0,
    ));
  const maximumActiveSeconds = state.roundSeconds * AI_TEXT_TRAINING_ROUND_COUNT;
  const measuredActiveSeconds = outcome === "completed"
    ? maximumActiveSeconds
    : Number(state.completedActiveSeconds) || 0;
  const activeSeconds = Math.round(
    Math.max(0, Math.min(maximumActiveSeconds, measuredActiveSeconds)) * 1_000,
  ) / 1_000;
  const pending = upsertAchievementRetryRecord({
    ...currentAchievementOwner(),
    actionId: state.achievementActionId,
    modeId: state.modeId,
    roundSeconds: state.roundSeconds,
    sessionId: state.achievementSessionId,
    outcome,
    completedRounds,
    activeSeconds,
  });
  if (pending?.sessionId) state.achievementSessionId = pending.sessionId;
  state.achievementRetryError = "";
  return Boolean(pending);
}

async function finishPaidUse(outcome) {
  const targetState = state;
  const useId = String(targetState.paidUseId || "");
  if (!useId) return true;
  if (targetState.preview) {
    targetState.finishPending = false;
    targetState.activeUse = null;
    targetState.paidUseId = "";
    return true;
  }
  if (targetState.finishInFlight) return false;
  targetState.finishInFlight = true;
  targetState.finishPending = true;
  persistSession();
  try {
    await aiTextTrainingAction({
      action: "finish_use",
      useId,
      outcome,
    });
    if (state === targetState && targetState.paidUseId === useId) {
      targetState.finishPending = false;
      targetState.activeUse = null;
      targetState.paidUseId = "";
      const saved = storedSession();
      if (!saved || String(saved.paidUseId || "") === useId) clearPersistedSession();
    }
    return true;
  } catch {
    if (state === targetState && targetState.paidUseId === useId) {
      targetState.finishPending = true;
      persistSession();
    }
    return false;
  } finally {
    targetState.finishInFlight = false;
  }
}

async function retryFinishPaidUse() {
  const targetState = state;
  if (!targetState.paidUseId) return;
  await finishPaidUse(targetState.resultOutcome || "exited");
  if (active && state === targetState && targetState.screen === "result") render();
}

async function abandonCorruptPaidUse() {
  const targetState = state;
  if (!targetState.activeUse || !targetState.recoveryError || targetState.finishInFlight) return;
  const title = targetState.activeUse.preset?.title || "開始済みの応援";
  const confirmed = window.confirm(
    `「${title}」のこの1回分を自主終了します。\n\n`
    + "応援は使い切りとなり返金されません。新しい支払いは発生しません。\n"
    + "復旧をやめて終了記録を送信しますか？",
  );
  if (!confirmed) return;
  if (state !== targetState) return;
  targetState.paidUseId = targetState.paidUseId || targetState.activeUse.id;
  const finishPromise = finishPaidUse("exited");
  if (active && state === targetState) render();
  const finished = await finishPromise;
  if (state !== targetState) return;
  if (!finished) {
    showToast("自主終了の記録を確認できませんでした。追加請求はありません。通信を確認して再送してください。");
    if (active && state === targetState) render();
    return;
  }
  targetState.recoveryError = "";
  targetState.finishPending = false;
  targetState.resultOutcome = "";
  targetState.pendingPaidPreset = null;
  targetState.purchaseActionId = "";
  targetState.selectedPreset = normalizeAiTextTrainingScriptSnapshot(
    AI_TEXT_TRAINING_BUILTIN_SCRIPTS[targetState.modeId],
  );
  targetState.selectedPresetSource = "builtin";
  targetState.screen = "setup";
  showToast("この1回分を自主終了しました。新しい支払いは発生していません。");
  if (active && state === targetState) render();
}

async function retryAchievementFinish() {
  const pending = currentAchievementRetryRecord();
  if (!pending?.outcome) return;
  state.achievementRetryError = "";
  render();
  const sent = await flushAchievementRetryQueue();
  if (!sent && active && state.screen === "result") {
    showToast("実績記録を再送できませんでした。端末内に残し、次回接続時にも再送します。");
  }
}

function completeSession(outcome) {
  if (state.phase === "playing" && state.roundEndsAt) {
    state.remainingMs = Math.max(0, state.roundEndsAt - performance.now());
  }
  if (["playing", "paused", "countdown"].includes(state.phase)) {
    recordCurrentRoundElapsed();
  }
  stopRuntimeTimers();
  state.ambienceController.disable();
  releaseWakeLock();
  state.resultOutcome = outcome;
  state.screen = "result";
  state.phase = "result";
  if (outcome === "completed") {
    writeLocalValue(`${DAILY_COMPLETE_PREFIX}${jstDateKey()}`, "true");
  }
  queueAchievementFinish(outcome);
  persistSession();
  flushAchievementRetryQueue().catch(() => {});
  const completedState = state;
  finishPaidUse(outcome).finally(() => {
    if (active && state === completedState && completedState.screen === "result") render();
  });
  render();
}

function emergencyStop() {
  if (["result", "idle"].includes(state.phase)) return;
  completeSession("safety_stopped");
}

function exitSession() {
  const paidWarning = state.paidUseId
    ? "開始済みの有料応援は使い切りになります。追加請求はありません。"
    : "ここまでの運動を終了します。";
  if (!window.confirm(`${paidWarning}\n\nトレーニングを終了しますか？`)) return;
  completeSession("exited");
}

function resetForAnotherSession({ drawMode = "same" } = {}) {
  if (state.paidUseId || state.activeUse) {
    showToast("有料利用の終了記録を確認してから、次のセッションを開始できます。");
    retryFinishPaidUse().catch(() => {});
    return;
  }
  if (drawMode === "alternate" && state.resultOutcome !== "completed") return;
  const entries = rosterEntries();
  const previousDrawIndices = normalizeAiTextTrainingDrawIndices(
    state.sessionDrawIndices,
    entries.length,
  );
  const repeatPaidPreset = state.selectedPresetSource === "active_use"
    && Number(state.selectedPreset?.price || 0) > 0;
  const previousPreset = state.selectedPreset;
  stopRuntimeTimers();
  state.ambienceController.disable();
  releaseWakeLock();
  state.screen = "setup";
  state.phase = "idle";
  state.plan = null;
  state.sessionCosmetics = null;
  state.sessionBeatCharacterId = state.beatCharacterId;
  state.images = Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null);
  state.bpms = [...DEFAULT_BPMS];
  state.pendingDrawIndices = previousDrawIndices ? [...previousDrawIndices] : [];
  state.drawLeg = 1;
  if (drawMode === "alternate"
      && entries.length > AI_TEXT_TRAINING_ROUND_COUNT
      && previousDrawIndices) {
    state.pendingDrawIndices = drawAiTextTrainingRosterIndices({
      rosterCount: entries.length,
      previousIndices: previousDrawIndices,
    });
    state.drawLeg = entries.length === AI_TEXT_TRAINING_ROSTER_MAX_COUNT ? 2 : 1;
    state.screen = "draw_review";
  }
  state.sessionDrawIndices = [];
  state.recoveryRosterCount = 0;
  state.recoveryError = "";
  state.roundIndex = 0;
  state.remainingMs = state.roundSeconds * 1_000;
  state.completedActiveSeconds = 0;
  state.completedRounds = 0;
  state.resultOutcome = "";
  state.achievementActionId = "";
  state.achievementSessionId = "";
  state.achievementBeginRequested = false;
  state.achievementRetryError = "";
  state.finishPending = false;
  state.previousRenderedScreen = "";
  if (repeatPaidPreset) {
    state.selectedPreset = previousPreset;
    state.selectedPresetSource = "market";
  } else if (!state.activeUse) {
    state.selectedPreset = normalizeAiTextTrainingScriptSnapshot(
      AI_TEXT_TRAINING_BUILTIN_SCRIPTS[state.modeId],
    );
    state.selectedPresetSource = "builtin";
  }
  clearPersistedSession();
  render();
  if (state.screen === "draw_review") announceCurrentDraw(entries);
}

function requestHome() {
  if (!active) {
    window.HariaiApp?.returnHome?.();
    return;
  }
  if (state.finishInFlight) {
    showToast("有料利用の終了記録を確認しています。完了するまでお待ちください。");
    return;
  }
  if (state.screen === "play" && state.phase !== "result") {
    const paidWarning = state.paidUseId
      ? "開始済みの有料応援は使い切りになります。"
      : "";
    if (!window.confirm(`${paidWarning} トレーニングを終了してトップへ戻りますか？`.trim())) return;
    completeSession("exited");
  }
  if (!state.finishPending) clearPersistedSession();
  cleanup({ releaseDeck: true });
  window.HariaiApp?.returnHome?.();
}

function cleanup({ releaseDeck = false } = {}) {
  stopRuntimeTimers();
  releaseWakeLock();
  state.ambienceController.destroy();
  state.unsubscribeWallet?.();
  state.unsubscribeWallet = null;
  if (releaseDeck) releaseRosterImages();
  active = false;
  document.title = "貼り合いスタジアム | Online Image Battle";
}

function bindXConfirmations() {
  document.querySelectorAll("a[data-ai-text-training-x]").forEach((link) => {
    const confirmNavigation = (event) => {
      if (!window.confirm(X_EXTERNAL_CONFIRM_MESSAGE)) event.preventDefault();
    };
    link.addEventListener("click", confirmNavigation);
    link.addEventListener("auxclick", confirmNavigation);
  });
}

function bindEvents() {
  document.querySelectorAll("[data-ai-text-training-image]").forEach((input) => {
    input.addEventListener("change", () => handleImageSelection(input));
  });
  document.querySelectorAll("[data-ai-text-training-bpm]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.aiTextTrainingBpm);
      const bpm = normalizeAiTextTrainingBpm(Number(input.value));
      if (bpm === null) {
        input.value = String(state.rosterBpms[index]);
        showToast("BPMは0または40〜160の整数で設定してください。");
        return;
      }
      state.rosterBpms[index] = bpm;
      persistRosterIfConsented().catch(() => {
        showToast("BPMは変更しましたが、端末保存を更新できませんでした。");
      });
      render();
    });
  });
  document.querySelectorAll("[data-ai-text-training-free]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.aiTextTrainingFree);
      state.rosterBpms[index] = 0;
      persistRosterIfConsented().catch(() => {
        showToast("BPMは変更しましたが、端末保存を更新できませんでした。");
      });
      render();
    });
  });
  document.querySelectorAll("[data-ai-text-training-remove-image]").forEach((button) => {
    button.addEventListener("click", () => {
      removeRosterImage(Number(button.dataset.aiTextTrainingRemoveImage)).catch(() => {});
    });
  });
  document.querySelectorAll('input[name="aiTextTrainingMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (state.activeUse) {
        state.modeId = state.activeUse.preset.modeId;
        showToast("開始済みの有料応援では、購入したAI性格が固定されます。");
        render();
        return;
      }
      state.modeId = input.value;
      state.marketModeFilter = input.value;
      state.selectedPreset = normalizeAiTextTrainingScriptSnapshot(
        AI_TEXT_TRAINING_BUILTIN_SCRIPTS[state.modeId],
      );
      state.selectedPresetSource = "builtin";
      render();
    });
  });
  document.querySelector("#aiTextTrainingExercise")?.addEventListener("change", (event) => {
    state.exerciseId = event.currentTarget.value;
    render();
  });
  document.querySelectorAll('input[name="aiTextTrainingRoundSeconds"]').forEach((input) => {
    input.addEventListener("change", () => {
      const seconds = Number(input.value);
      if (!ROUND_SECONDS_OPTIONS.includes(seconds)) return;
      state.roundSeconds = seconds;
      state.remainingMs = state.roundSeconds * 1_000;
      render();
    });
  });
  document.querySelectorAll('input[name="aiTextTrainingBeatCharacter"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.beatCharacterId = normalizeBeatCharacterId(input.value);
      writeLocalValue(BEAT_CHARACTER_PREFERENCE_KEY, state.beatCharacterId);
      render();
    });
  });
  document.querySelectorAll("[data-ai-text-training-preview-beat]").forEach((button) => {
    button.addEventListener("click", () => {
      previewBeatCharacter(button.dataset.aiTextTrainingPreviewBeat).catch((error) => {
        showToast(error?.message || "音色を試聴できませんでした。無音でも利用できます。");
      });
    });
  });
  document.querySelectorAll('input[name^="aiTextTrainingCosmetic_"]').forEach((input) => {
    input.addEventListener("change", () => {
      const slot = input.name.replace("aiTextTrainingCosmetic_", "");
      if (!["panelThemeId", "messageDecorationId"].includes(slot)) return;
      const nextSelection = {
        ...previewCosmetics(),
        [slot]: input.value,
      };
      state.cosmeticDraft = sameCosmetics(nextSelection, equippedCosmetics())
        ? null
        : nextSelection;
      render();
    });
  });
  document.querySelector("#aiTextTrainingPersistDeck")?.addEventListener("change", async (event) => {
    const requestedPersistence = event.currentTarget.checked;
    if (requestedPersistence) {
      state.persistDeck = true;
      writeLocalValue(DECK_PERSISTENCE_KEY, "true");
      if (isAiTextTrainingRosterCount(rosterEntries().length)) {
        try {
          await writeStoredDeck();
          showToast(`${rosterEntries().length}枚のロスターをこの端末に保存しました。`);
        } catch (error) {
          showToast(error?.message || "画像を端末に保存できませんでした。");
        }
      } else {
        showToast("端末保存をONにしました。画像が5枚そろうとロスターを保存します。");
      }
    } else {
      try {
        await deleteStoredDeck();
        state.persistDeck = false;
        writeLocalValue(DECK_PERSISTENCE_KEY, "false");
        showToast("この端末の保存画像を削除しました。");
      } catch {
        state.persistDeck = true;
        writeLocalValue(DECK_PERSISTENCE_KEY, "true");
        showToast("保存画像を削除できませんでした。保存設定はONのままです。");
      }
    }
    render();
  });
  document.querySelectorAll("[data-ai-text-training-market-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.marketModeFilter = button.dataset.aiTextTrainingMarketMode;
      if (!state.preview && state.authReady) {
        try {
          const response = await aiTextTrainingAction({
            action: "browse",
            modeId: state.marketModeFilter,
          });
          state.marketPresets = response.data?.presets || [];
        } catch (error) {
          showToast(error?.message || "応援台本を読み込めませんでした。");
        }
      }
      render();
    });
  });
  document.querySelectorAll("[data-ai-text-training-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedMarketPresetId = button.dataset.aiTextTrainingPreset;
      state.screen = "preset_detail";
      render();
    });
  });
  document.querySelectorAll("[data-ai-text-training-reaction]").forEach((button) => {
    button.addEventListener("click", () => chooseReaction(button.dataset.aiTextTrainingReaction));
  });
  document.querySelectorAll("[data-ai-text-training-ranking-period]").forEach((button) => {
    button.addEventListener("click", () => loadRankings(button.dataset.aiTextTrainingRankingPeriod));
  });
  document.querySelector("#aiTextTrainingPurchaseConsent")?.addEventListener("change", (event) => {
    const confirmButton = document.querySelector("#aiTextTrainingConfirmPurchase");
    if (!confirmButton) return;
    const script = state.pendingPaidPreset || state.selectedPreset;
    const affordable = state.balance - Number(script?.price || 0) >= 0;
    confirmButton.disabled = !event.currentTarget.checked || !affordable || Boolean(state.busyAction);
  });

  const actionHandlers = {
    home: requestHome,
    setup: () => {
      state.screen = "setup";
      state.previousRenderedScreen = "";
      render();
    },
    market: async () => {
      state.screen = "market";
      if (!state.preview && state.authReady) {
        try {
          await refreshMarketState();
        } catch (error) {
          showToast(error?.message || "応援市場を読み込めませんでした。");
        }
      }
      render();
    },
    rankings: () => {
      state.screen = "rankings";
      loadRankings("monthly");
    },
    "reload-rankings": () => loadRankings(state.rankingPeriod),
    editor: () => {
      state.screen = "editor";
      state.editorDraft = createEditorDraft();
      state.editorActionId = "";
      render();
    },
    "builtin-support": () => {
      state.selectedPreset = normalizeAiTextTrainingScriptSnapshot(
        AI_TEXT_TRAINING_BUILTIN_SCRIPTS[state.modeId],
      );
      state.selectedPresetSource = "builtin";
      state.screen = "setup";
      render();
    },
    "select-market-preset": () => {
      const preset = state.marketPresets.find((item) => item.id === state.selectedMarketPresetId);
      if (!preset) return;
      state.modeId = preset.modeId;
      state.selectedPreset = presetSnapshot(preset);
      state.selectedPresetSource = "market";
      state.screen = "setup";
      render();
    },
    "select-own-preset": () => {
      const preset = state.marketPresets.find((item) => item.id === state.selectedMarketPresetId);
      if (!preset) return;
      state.modeId = preset.modeId;
      state.selectedPreset = presetSnapshot(preset);
      state.selectedPresetSource = "author_preview";
      state.screen = "setup";
      render();
    },
    "start-session": () => {
      try {
        prepareStartSession();
      } catch (error) {
        showToast(error?.message || "開始準備を確認してください。");
      }
    },
    "expand-roster": () => {
      state.rosterExpanded = true;
      render();
    },
    redraw: () => {
      if (state.activeUse) {
        throw new Error("開始済みの有料応援では、確定したDRAWを変更できません。");
      }
      const entries = validateRoster();
      const previousIndices = normalizeAiTextTrainingDrawIndices(
        state.pendingDrawIndices,
        entries.length,
      );
      drawRoster({ previousIndices });
    },
    "confirm-draw": continuePreparedSession,
    "save-cosmetics": saveCosmetics,
    "cancel-cosmetics": () => {
      state.cosmeticDraft = null;
      render();
    },
    "resume-paid": () => {
      if (!state.activeUse) return;
      state.modeId = state.activeUse.preset.modeId;
      state.selectedPreset = presetSnapshot(state.activeUse.preset);
      state.selectedPresetSource = "active_use";
      state.screen = "setup";
      render();
    },
    "abandon-corrupt-paid-use": abandonCorruptPaidUse,
    "confirm-purchase": confirmPaidUse,
    "load-deck": () => restoreStoredDeck(),
    "forget-deck": async () => {
      try {
        await deleteStoredDeck();
        state.persistDeck = false;
        writeLocalValue(DECK_PERSISTENCE_KEY, "false");
        showToast("この端末の保存画像を削除しました。");
        render();
      } catch (error) {
        showToast(error?.message || "保存画像を削除できませんでした。");
      }
    },
    "confirm-publish": publishEditorDraft,
    unpublish: unpublishCurrentPreset,
    "resume-round": startRoundCountdown,
    "next-round": advanceRound,
    pause: () => pauseSession(),
    "toggle-mute": () => {
      state.muted = !state.muted;
      state.ambienceController.setMuted(state.muted);
      render();
    },
    "emergency-stop": emergencyStop,
    "exit-session": exitSession,
    "setup-after-result": () => resetForAnotherSession({ drawMode: "same" }),
    "alternate-draw-after-result": () => resetForAnotherSession({ drawMode: "alternate" }),
    "retry-finish": retryFinishPaidUse,
    "retry-achievement-finish": retryAchievementFinish,
  };
  document.querySelectorAll("[data-ai-text-training-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const handler = actionHandlers[button.dataset.aiTextTrainingAction];
      if (handler) Promise.resolve(handler()).catch((error) => {
        showToast(error?.message || "操作を完了できませんでした。");
      });
    });
  });

  document.querySelector("#aiTextTrainingEditorForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      updateEditorDraftFromForm(event.currentTarget);
      validateEditorDraft(state.editorDraft);
      state.editorActionId = "";
      state.screen = "editor_review";
      render();
    } catch (error) {
      showToast(error?.message || "入力内容を確認してください。");
    }
  });
  document.querySelector('select[name="modeId"]')?.addEventListener("change", (event) => {
    const form = event.currentTarget.form;
    updateEditorDraftFromForm(form);
    state.editorDraft.modeId = event.currentTarget.value;
    const existing = state.ownPresets.find((preset) => preset.modeId === state.editorDraft.modeId);
    if (existing) {
      state.modeId = existing.modeId;
      state.editorDraft = createEditorDraft();
    }
    render();
  });
  document.querySelectorAll("#aiTextTrainingEditorForm textarea, #aiTextTrainingEditorForm input, #aiTextTrainingEditorForm select").forEach((control) => {
    control.addEventListener("input", () => {
      updateEditorDraftFromForm(control.form);
      const preview = document.querySelector("#aiTextTrainingEditorPreviewMessage");
      if (preview) preview.textContent = editorSimulatorMessage(state.editorDraft);
    });
  });
  document.querySelector("#aiTextTrainingEditorPreviewBpm")?.addEventListener("input", (event) => {
    state.editorPreview.bpm = normalizeAiTextTrainingBpm(Number(event.currentTarget.value)) ?? 0;
    const preview = document.querySelector("#aiTextTrainingEditorPreviewMessage");
    if (preview) preview.textContent = editorSimulatorMessage(state.editorDraft);
  });
  document.querySelector("#aiTextTrainingEditorPreviewRemaining")?.addEventListener("input", (event) => {
    state.editorPreview.remaining = Math.max(1, Math.min(60, Number(event.currentTarget.value) || 10));
    const preview = document.querySelector("#aiTextTrainingEditorPreviewMessage");
    if (preview) preview.textContent = editorSimulatorMessage(state.editorDraft);
  });
  document.querySelector("#aiTextTrainingEditorPreviewPhase")?.addEventListener("change", (event) => {
    state.editorPreview.phase = event.currentTarget.value;
    const preview = document.querySelector("#aiTextTrainingEditorPreviewMessage");
    if (preview) preview.textContent = editorSimulatorMessage(state.editorDraft);
  });
  document.querySelector("#aiTextTrainingEditorPreviewDirection")?.addEventListener("change", (event) => {
    state.editorPreview.direction = event.currentTarget.value;
    const preview = document.querySelector("#aiTextTrainingEditorPreviewMessage");
    if (preview) preview.textContent = editorSimulatorMessage(state.editorDraft);
  });
  document.querySelector("#aiTextTrainingXProfileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveXProfile(event.currentTarget);
  });
  document.querySelector("#aiTextTrainingReportForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    reportSelectedPreset(event.currentTarget).catch((error) => {
      showToast(error?.message || "通報を送信できませんでした。");
    });
  });
  bindXConfirmations();
}

document.addEventListener("visibilitychange", () => {
  if (!active) return;
  if (document.visibilityState === "hidden") {
    if (["playing", "countdown"].includes(state.phase)) pauseSession({ fromVisibility: true });
    state.ambienceController.suspendForVisibility(true);
    releaseWakeLock();
  }
});

window.addEventListener("pagehide", () => {
  if (!active) return;
  if (["playing", "countdown"].includes(state.phase)) {
    if (state.phase === "playing" && state.roundEndsAt) {
      state.remainingMs = Math.max(0, state.roundEndsAt - performance.now());
    }
    state.phase = "paused";
    persistSession();
  }
  stopRuntimeTimers();
  releaseWakeLock();
  state.ambienceController.destroy();
  state.unsubscribeWallet?.();
  releaseRosterImages();
}, { once: true });

window.HariaiAiTextTraining = Object.freeze({
  isActive,
  requestHome,
  start,
});
window.dispatchEvent(new CustomEvent("hariai-ai-text-training-ready"));

if (previewRequest()) queueMicrotask(start);
