import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  get,
  limitToLast,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  database,
  functions,
} from "./firebase-services.js?v=app-check-v3-oshi-jouzu-duo-v1-restore-v1";
import {
  FREE_TABLE_AUDIO_MAX_SECONDS,
  FREE_TABLE_IMAGE_MAX_SIDE,
  FREE_TABLE_MEDIA_CHANNEL_LABEL,
  FREE_TABLE_VIDEO_MAX_BYTES,
  FREE_TABLE_VIDEO_MAX_SECONDS,
  appendIncomingFreeTableMediaChunk,
  createFreeTableMediaTransferId,
  createIncomingFreeTableMediaTransfer,
  createLocalFreeTableMediaResource,
  finishIncomingFreeTableMediaTransfer,
  freeTableMediaEndStatus,
  isFreeTableMediaCancelFor,
  releaseFreeTableMediaResource,
  releaseFreeTableMediaResources,
  sendFreeTableMedia,
} from "./free-table-media.mjs?v=free-table-media-v1";

const FREE_TABLE_ROOT = "freeTables";
const FREE_TABLE_CHAT_LIMIT = 80;
const FREE_TABLE_CHAT_SLOT_CAP = 500;
const FREE_TABLE_SIGNAL_LIMIT = 80;
const FREE_TABLE_SIGNAL_SLOT_CAP = 80;
const FREE_TABLE_CHAT_SLOT_PREFIX = "C".repeat(20);
const FREE_TABLE_SIGNAL_SLOT_PREFIX = "S".repeat(22);
const FREE_TABLE_CHAT_SLOT_ID_PATTERN = /^C{20}[01][0-4][0-9]{2}$/;
const FREE_TABLE_SIGNAL_SLOT_ID_PATTERN = /^S{22}[0-7][0-9]$/;
const FREE_TABLE_SIGNAL_TTL_MS = 120_000;
const FREE_TABLE_SIGNAL_MAX_AGE_MS = 60_000;
const FREE_TABLE_SIGNAL_PROTOCOL_VERSION = 1;
const FREE_TABLE_NEGOTIATION_ID_PATTERN = /^neg_[a-f0-9]{24}$/;
const FREE_TABLE_HEARTBEAT_MS = 20_000;
const FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 20_000]);
const FREE_TABLE_FAREWELL_MS = 20_000;
const FREE_TABLE_FAREWELL_VERIFY_DELAYS_MS = Object.freeze([0, 500, 1_500, 3_000, 6_000, 10_000, 20_000, 30_000]);
const FREE_TABLE_PEER_RECOVERY_DELAYS_MS = Object.freeze([2_000, 8_000, 20_000]);
const FREE_TABLE_PEER_RECOVERY_STEADY_MS = 30_000;
const FREE_TABLE_PEER_OFFER_WATCHDOG_MS = 15_000;
const FREE_TABLE_TEXT_MAX_LENGTH = 500;
const FREE_TABLE_REPORT_DETAIL_MAX_LENGTH = 500;
const FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY = "hariaiFreeTableReportContextV1";
const FREE_TABLE_REPORT_CONTEXT_TTL_MS = 15 * 60 * 1000;
const FREE_TABLE_REPORT_MESSAGE_LIMIT = 10;
const FREE_TABLE_CONTROL_MAX_CHARS = 4_000;
const FREE_TABLE_INCOMING_MEDIA_TIMEOUT_MS = 20_000;
const FREE_TABLE_RETAINED_MEDIA_LIMIT = 12;
const FREE_TABLE_RETAINED_MEDIA_MAX_BYTES = 12 * 1024 * 1024;
const FREE_TABLE_IGNORED_SESSION_STORAGE_KEY = "hariaiFreeTableIgnoredSessionsV1";
const FREE_TABLE_IGNORED_SESSION_TTL_MS = 6 * 60 * 60 * 1_000;
const FREE_TABLE_END_RETRY_DELAYS_MS = Object.freeze([0, 1_000, 3_000, 10_000, 30_000, 60_000, 120_000]);
const FREE_TABLE_INVITE_QUERY_KEY = "freeTableInvite";
const FREE_TABLE_INVITE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const FREE_TABLE_PUBLIC_CARD_PREVIEW_HASH_PATTERN = /^[a-f0-9]{64}$/;
const FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH = 120;
const FREE_TABLE_INVITE_PREVIEW_REFRESH_MS = 30_000;
const FREE_TABLE_INVITE_PREVIEW_MAX_BACKOFF_MS = 4 * 60_000;
const FREE_TABLE_ACTIONS = Object.freeze({
  SAVE_SPACE: "save_space",
  OPEN: "open",
  LIST: "list",
  REQUEST: "request",
  CANCEL_REQUEST: "cancel_request",
  RESPOND: "respond",
  ARRIVE: "arrive",
  END: "end",
  BOOKMARK: "bookmark",
  RELATIONSHIP: "relationship",
  BLOCK: "block",
  UNBLOCK: "unblock",
  REPORT: "report",
  GET_MY_STATE: "get_my_state",
  REQUEST_FROM_INVITE: "request_from_invite",
});
const FREE_TABLE_TABS = new Set(["open", "bookmarks", "mine"]);
const FREE_TABLE_ROLEPLAY_LEVELS = Object.freeze({
  none: "なりきりなし",
  light: "ゆるく",
  full: "しっかり",
});
const FREE_TABLE_DURATIONS = Object.freeze({
  "5m": "5分ほど",
  "15m": "15分ほど",
  "30m": "30分ほど",
  leisurely: "ゆっくり",
});
const FREE_TABLE_THEMES = Object.freeze({
  engawa: { label: "夕暮れの縁側", icon: "◌" },
  kitchen: { label: "湯気の食卓", icon: "♨" },
  library: { label: "静かな本棚", icon: "▤" },
  garden: { label: "木漏れ日の庭", icon: "❋" },
  observatory: { label: "星待ちの窓辺", icon: "✦" },
});
const FREE_TABLE_SENDOFF_PRESETS = Object.freeze([
  "いってらっしゃい。またいつでも",
  "いってらっしゃい。よい旅を",
  "いってらっしゃい。次のネタも待っています",
]);
const FREE_TABLE_DEPARTURE_PRESETS = Object.freeze([
  "心がほどけました。いってきます",
  "笑顔になれました。いってきます",
  "元気をもらいました。いってきます",
]);

const freeTableActionCallable = httpsCallable(functions, "freeTableAction");
const freeTableInviteActionCallable = httpsCallable(functions, "freeTableInviteAction");
const freeTableInvitePreviewCallable = httpsCallable(functions, "freeTableInvitePreview");
const app = document.querySelector("#app");

let active = false;
let lifecycleGeneration = 0;
const ignoredSessionTombstones = loadIgnoredSessionTombstones();
const ignoredSessionEndRetries = new Map();
const chatSlotCounters = new Map();
const signalSlotCounters = new Map();
let pendingLeaveSettlement = null;
let roomMutationChain = Promise.resolve();
let state = createFreeTableState();

function createFreeTableState() {
  return {
    generation: 0,
    screen: "hall",
    tab: "open",
    busy: false,
    error: "",
    uid: "",
    authenticatedReady: false,
    serverTimeOffset: 0,
    publicMemberId: "",
    myState: null,
    space: defaultSpace(),
    hostCard: defaultCard(),
    visitorCard: defaultCard(),
    rooms: [],
    bookmarks: new Set(),
    returningRooms: [],
    blocks: [],
    growth: {
      stageId: "none",
      topicToolbox: [],
    },
    inviteId: "",
    invitePreviewStatus: "idle",
    invitePreview: null,
    invitePreviewTimer: null,
    invitePreviewRequest: null,
    invitePreviewFailureCount: 0,
    inviteAuthenticated: false,
    inviteAuthenticating: false,
    inviteReporting: false,
    inviteReportedPreviewHash: "",
    hostInvite: null,
    hostInvitePanelOpen: false,
    hostInviteShareText: "",
    hostInviteImageBusy: false,
    hostInviteExpiryTimer: null,
    selectedRoomId: "",
    publicRoomId: "",
    roomId: "",
    roomOpen: false,
    requests: [],
    pendingRequest: null,
    ignoredRequestIds: new Set(),
    sessionId: "",
    sessionGeneration: 0,
    sessionExpiryTimer: null,
    session: null,
    role: "",
    opponentUid: "",
    opponentPublicMemberId: "",
    arrived: false,
    arrivalPending: false,
    arrivalRetryTimer: null,
    seatEstablished: false,
    chatMessages: new Map(),
    pendingChatMutations: new Map(),
    reportContext: null,
    reportContextTimer: null,
    reportedSessionIds: new Set(),
    mediaMessages: new Map(),
    chatDraft: "",
    formDirty: false,
    unsubscribers: [],
    hallUnsubscribers: [],
    sessionUnsubscribers: [],
    disconnectHandles: [],
    presenceRearmChain: Promise.resolve(),
    heartbeatTimer: null,
    hallRefreshTimer: null,
    presenceTimer: null,
    peer: null,
    peerGeneration: 0,
    negotiationId: "",
    peerRecoveryTimer: null,
    peerRecoveryForced: false,
    peerRecoveryAttempts: 0,
    hostOfferInFlight: false,
    negotiationCreatedAt: 0,
    negotiationOfferKey: "",
    pendingIce: [],
    signalDraining: false,
    deferredSignals: [],
    mediaChannel: null,
    mediaReady: false,
    incomingMedia: null,
    incomingMediaTimer: null,
    incomingMediaChain: Promise.resolve(),
    mediaSendChain: Promise.resolve(),
    mediaGeneration: 0,
    mediaProgress: 0,
    farewell: null,
    farewellTimer: null,
    farewellVerificationTimer: null,
    pendingFarewellControl: null,
    hallReconnectTimer: null,
    relationshipWanted: false,
    relationshipMutual: false,
    ignoredSessionIds: new Set(ignoredSessionTombstones.keys()),
  };
}

function loadIgnoredSessionTombstones() {
  const tombstones = new Map();
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(FREE_TABLE_IGNORED_SESSION_STORAGE_KEY) || "{}");
    const now = Date.now();
    for (const [sessionId, expiresAt] of Object.entries(stored)) {
      if (sessionId && Number(expiresAt) > now) tombstones.set(sessionId, Number(expiresAt));
    }
  } catch {
    // sessionStorage can be unavailable in privacy-restricted browsing contexts.
  }
  return tombstones;
}

function persistIgnoredSessionTombstones() {
  const now = Date.now();
  for (const [sessionId, expiresAt] of ignoredSessionTombstones) {
    if (expiresAt <= now) ignoredSessionTombstones.delete(sessionId);
  }
  try {
    window.sessionStorage.setItem(
      FREE_TABLE_IGNORED_SESSION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(ignoredSessionTombstones)),
    );
  } catch {
    // The in-memory tombstones still protect start/leave cycles in this page.
  }
}

function normalizeReportContext(value, reporterUid, now = Date.now()) {
  const source = valueFromSnapshot(value);
  const createdAt = Number(source.createdAt || 0);
  const expiresAt = Number(source.expiresAt || 0);
  const sessionId = String(source.sessionId || "");
  const opponentUid = String(source.opponentUid || "");
  const storedReporterUid = String(source.reporterUid || "");
  const messageIds = Array.isArray(source.messageIds)
    ? [...new Set(source.messageIds
      .map((messageId) => String(messageId || ""))
      .filter((messageId) => FREE_TABLE_CHAT_SLOT_ID_PATTERN.test(messageId)))]
      .slice(-FREE_TABLE_REPORT_MESSAGE_LIMIT)
    : [];
  if (!reporterUid
      || storedReporterUid !== reporterUid
      || !/^[A-Za-z0-9_-]{20,40}$/.test(sessionId)
      || !opponentUid
      || opponentUid.length > 128
      || /[\u0000-\u001f\u007f-\u009f]/u.test(opponentUid)
      || [".", "#", "$", "[", "]", "/"].some((character) => opponentUid.includes(character))
      || !Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || createdAt <= 0
      || createdAt > now + 15_000
      || expiresAt <= now
      || expiresAt > createdAt + FREE_TABLE_REPORT_CONTEXT_TTL_MS) return null;
  return {
    reporterUid,
    sessionId,
    opponentUid,
    messageIds,
    createdAt,
    expiresAt,
  };
}

function loadReportContext(reporterUid) {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY) || "null",
    );
    const context = normalizeReportContext(parsed, reporterUid);
    if (context) return context;
    window.sessionStorage.removeItem(FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY);
  } catch {
    // The report shortcut can still work in-memory when sessionStorage is unavailable.
  }
  return null;
}

function armReportContextExpiry(context = state.reportContext) {
  if (state.reportContextTimer) window.clearTimeout(state.reportContextTimer);
  state.reportContextTimer = null;
  if (!context) return;
  const reportState = state;
  const sessionId = context.sessionId;
  const reporterUid = context.reporterUid;
  const delay = Math.max(0, Number(context.expiresAt || 0) - Date.now() + 25);
  reportState.reportContextTimer = window.setTimeout(() => {
    reportState.reportContextTimer = null;
    if (state !== reportState) return;
    const current = state.reportContext;
    if (!current
        || current.sessionId !== sessionId
        || current.reporterUid !== reporterUid
        || current.expiresAt > Date.now()) return;
    clearReportContext({ sessionId, reporterUid });
    if (active && !state.sessionId) render();
  }, delay);
}

function clearReportContext({ sessionId = "", reporterUid = "" } = {}) {
  const matches = (context) => Boolean(
    context
    && (!sessionId || context.sessionId === sessionId)
    && (!reporterUid || context.reporterUid === reporterUid),
  );
  if (matches(state?.reportContext)) {
    if (state.reportContextTimer) window.clearTimeout(state.reportContextTimer);
    state.reportContextTimer = null;
    state.reportContext = null;
  }
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY) || "null",
    );
    if (!stored || matches(stored)) {
      window.sessionStorage.removeItem(FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY);
    }
  } catch {
    // Invalid or inaccessible storage must not block the rest of the safety flow.
  }
}

function activeReportContext() {
  const context = state.reportContext;
  if (!context) return null;
  if (context.reporterUid !== state.uid || context.expiresAt <= Date.now()) {
    clearReportContext();
    return null;
  }
  return context;
}

function currentOpponentMessageIds(opponentUid = state.opponentUid) {
  return [...state.chatMessages.values()]
    .filter((message) => (
      message.authorUid === opponentUid
      && FREE_TABLE_CHAT_SLOT_ID_PATTERN.test(String(message.id || ""))
    ))
    .sort((first, second) => (
      Number(first.createdAt || 0) - Number(second.createdAt || 0)
      || String(first.id || "").localeCompare(String(second.id || ""))
    ))
    .slice(-FREE_TABLE_REPORT_MESSAGE_LIMIT)
    .map((message) => message.id);
}

function rememberCurrentReportContext() {
  const sessionId = String(state.sessionId || "");
  const reporterUid = String(state.uid || "");
  const opponentUid = String(state.opponentUid || "");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(sessionId)
      || !reporterUid
      || !opponentUid
      || state.reportedSessionIds.has(sessionId)) return null;
  const createdAt = Date.now();
  const context = {
    reporterUid,
    sessionId,
    opponentUid,
    messageIds: currentOpponentMessageIds(opponentUid),
    createdAt,
    expiresAt: createdAt + FREE_TABLE_REPORT_CONTEXT_TTL_MS,
  };
  state.reportContext = context;
  armReportContextExpiry(context);
  try {
    window.sessionStorage.setItem(
      FREE_TABLE_REPORT_CONTEXT_STORAGE_KEY,
      JSON.stringify(context),
    );
  } catch {
    // Keeping the in-memory shortcut is still useful for an ordinary local return.
  }
  return context;
}

function rememberIgnoredSession(sessionId) {
  const normalizedSessionId = String(sessionId || "");
  if (!normalizedSessionId) return;
  ignoredSessionTombstones.set(normalizedSessionId, Date.now() + FREE_TABLE_IGNORED_SESSION_TTL_MS);
  state?.ignoredSessionIds?.add(normalizedSessionId);
  persistIgnoredSessionTombstones();
}

function ignoredEndIsConverged(error) {
  const code = String(error?.code || "");
  return code === "functions/failed-precondition"
    || code === "failed-precondition"
    || code === "functions/not-found"
    || code === "not-found";
}

function scheduleIgnoredSessionEnd(sessionId, reason = "safe_exit", attempt = 0, message = "") {
  const normalizedSessionId = String(sessionId || "");
  if (!normalizedSessionId || ignoredSessionEndRetries.has(normalizedSessionId)) return;
  rememberIgnoredSession(normalizedSessionId);
  const delay = FREE_TABLE_END_RETRY_DELAYS_MS[Math.min(
    attempt,
    FREE_TABLE_END_RETRY_DELAYS_MS.length - 1,
  )];
  const normalizedMessage = boundedText(message, 80);
  const record = { attempt, reason, message: normalizedMessage, timer: null };
  const run = async () => {
    try {
      await callFreeTableAction(FREE_TABLE_ACTIONS.END, {
        sessionId: normalizedSessionId,
        reason,
        ...(normalizedMessage ? { message: normalizedMessage } : {}),
      });
      ignoredSessionEndRetries.delete(normalizedSessionId);
    } catch (error) {
      ignoredSessionEndRetries.delete(normalizedSessionId);
      if (ignoredEndIsConverged(error)) return;
      if (attempt + 1 < FREE_TABLE_END_RETRY_DELAYS_MS.length) {
        scheduleIgnoredSessionEnd(normalizedSessionId, reason, attempt + 1, normalizedMessage);
      }
    }
  };
  record.timer = window.setTimeout(run, delay);
  ignoredSessionEndRetries.set(normalizedSessionId, record);
}

function defaultSpace() {
  return {
    name: "よりみちの貼り場",
    description: "ふっと一息つける、静かな貼り合いの部屋です。",
    topic: "今日、ちょっと誰かに見せたいもの",
    introduction: "言葉や一枚を貼りながら、ゆっくりお話ししましょう。",
    journeyCue: "少し元気が戻ったら",
    roleplayLevel: "light",
    duration: "15m",
    media: { text: true, image: true, audio: false, video: false },
    avoid: "",
    welcome: "おかえり。どうぞゆっくりしていってください。",
    themeId: "engawa",
  };
}

function defaultCard() {
  return {
    name: "",
    activityTag: "のんびり貼り合い",
    message: "今日はゆっくりお話ししたいです。",
    roleplayLevel: "light",
    media: { text: true, image: true, audio: false, video: false },
  };
}

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
  if (typeof shared()?.showToast === "function") shared().showToast(String(message || ""));
}

function friendlyError(error) {
  if (error?.code === "auth/admin-restricted-operation") return "匿名ログインが無効です。";
  if (String(error?.code || "").includes("unauthenticated")
      || /unauthenticated/i.test(String(error?.message || ""))) {
    return "自由卓の本人確認に失敗しました。ページを読み直してお試しください。";
  }
  if (error?.code === "permission-denied" || String(error?.message).includes("PERMISSION_DENIED")) {
    return "自由卓への接続が許可されませんでした。";
  }
  if (String(error?.code || "").includes("internal")
      || /^internal$/i.test(String(error?.message || ""))) {
    return "自由卓への接続に失敗しました。少し待ってお試しください。";
  }
  return String(error?.message || "自由卓への接続に失敗しました。");
}

function boundedText(value, maximum) {
  return Array.from(String(value ?? "").trim()).slice(0, maximum).join("");
}

function normalizeMedia(value, fallback = {}) {
  return {
    text: true,
    image: value?.image === true || (value?.image == null && fallback.image === true),
    audio: value?.audio === true || (value?.audio == null && fallback.audio === true),
    video: value?.video === true || (value?.video == null && fallback.video === true),
  };
}

function normalizeSpace(value) {
  const fallback = defaultSpace();
  const roleplayLevel = Object.hasOwn(FREE_TABLE_ROLEPLAY_LEVELS, value?.roleplayLevel)
    ? value.roleplayLevel
    : fallback.roleplayLevel;
  const duration = Object.hasOwn(FREE_TABLE_DURATIONS, String(value?.duration))
    ? String(value.duration)
    : fallback.duration;
  const themeId = Object.hasOwn(FREE_TABLE_THEMES, value?.themeId) ? value.themeId : fallback.themeId;
  return {
    name: boundedText(value?.name, 24) || fallback.name,
    description: boundedText(value?.description, 80) || fallback.description,
    topic: boundedText(value?.topic, 60) || fallback.topic,
    introduction: boundedText(value?.introduction, 160) || fallback.introduction,
    journeyCue: boundedText(value?.journeyCue, 60) || fallback.journeyCue,
    roleplayLevel,
    duration,
    media: normalizeMedia(value?.media, fallback.media),
    avoid: boundedText(value?.avoid, 80),
    welcome: boundedText(value?.welcome, 80) || fallback.welcome,
    themeId,
  };
}

function normalizeCard(value, fallbackValue = defaultCard()) {
  const fallback = fallbackValue || defaultCard();
  return {
    name: boundedText(value?.name, 24) || boundedText(fallback.name, 24),
    activityTag: boundedText(value?.activityTag, 24) || fallback.activityTag,
    message: boundedText(value?.message, 40) || fallback.message,
    roleplayLevel: Object.hasOwn(FREE_TABLE_ROLEPLAY_LEVELS, value?.roleplayLevel)
      ? value.roleplayLevel
      : fallback.roleplayLevel,
    media: normalizeMedia(value?.media, fallback.media),
  };
}

function valueFromSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizePublicRoom(value, id = "") {
  const source = valueFromSnapshot(value);
  return {
    id: String(source.publicRoomId || source.id || id),
    publicMemberId: String(source.publicMemberId || source.hostPublicMemberId || source.hostCard?.publicMemberId || ""),
    space: normalizeSpace(source.space || source),
    hostCard: normalizeCard(source.hostCard || source.card),
    open: source.state === "open" || source.active === true || source.open === true,
    bookmarked: source.bookmarked === true,
    updatedAt: Number(source.updatedAt || source.lastSeen || 0),
    furnishing: Array.isArray(source.furnishing) ? source.furnishing.map((item) => boundedText(item, 24)).filter(Boolean).slice(0, 8) : [],
  };
}

function normalizeInviteId(value) {
  const inviteId = String(value || "").trim();
  return FREE_TABLE_INVITE_ID_PATTERN.test(inviteId) ? inviteId : "";
}

function normalizeHostInvite(value) {
  const source = valueFromSnapshot(value);
  const inviteId = normalizeInviteId(source.inviteId);
  const expiresAt = Number(source.expiresAt || 0);
  if (!inviteId || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return { inviteId, expiresAt };
}

function hostInviteIsLive(invite = state.hostInvite) {
  if (!invite) return false;
  const serverNow = Date.now() + Number(state.serverTimeOffset || 0);
  return normalizeInviteId(invite.inviteId)
    && Number.isFinite(Number(invite.expiresAt))
    && Number(invite.expiresAt) > serverNow;
}

function clearHostInviteUi({ keepPanelOpen = false } = {}) {
  if (state.hostInviteExpiryTimer) window.clearTimeout(state.hostInviteExpiryTimer);
  state.hostInviteExpiryTimer = null;
  state.hostInvite = null;
  state.hostInvitePanelOpen = Boolean(keepPanelOpen);
  state.hostInviteShareText = "";
  state.hostInviteImageBusy = false;
}

function armHostInviteExpiry(invite = state.hostInvite) {
  if (state.hostInviteExpiryTimer) window.clearTimeout(state.hostInviteExpiryTimer);
  state.hostInviteExpiryTimer = null;
  if (!hostInviteIsLive(invite)) return;
  const inviteState = state;
  const inviteId = invite.inviteId;
  const serverNow = Date.now() + Number(state.serverTimeOffset || 0);
  const delay = Math.max(0, Number(invite.expiresAt) - serverNow + 50);
  inviteState.hostInviteExpiryTimer = window.setTimeout(() => {
    inviteState.hostInviteExpiryTimer = null;
    if (state !== inviteState || state.hostInvite?.inviteId !== inviteId) return;
    clearHostInviteUi({ keepPanelOpen: true });
    if (active && state.roomOpen) render();
  }, delay);
}

function normalizeInvitePreview(value, expectedInviteId = "") {
  const data = valueFromSnapshot(value);
  const inviteId = normalizeInviteId(data.inviteId);
  const expected = normalizeInviteId(expectedInviteId);
  const previewHash = String(data.previewHash || "");
  const source = valueFromSnapshot(data.preview);
  const rawSpace = valueFromSnapshot(source.space);
  const open = Boolean(data.ok !== false
    && data.active === true
    && data.state === "open"
    && inviteId
    && FREE_TABLE_PUBLIC_CARD_PREVIEW_HASH_PATTERN.test(previewHash)
    && (!expected || inviteId === expected)
    && boundedText(rawSpace.name, 24)
    && boundedText(rawSpace.topic, 60));
  if (!open) {
    return {
      active: false,
      inviteId: expected || inviteId,
      updatedAt: Number(data.updatedAt || 0),
    };
  }
  return {
    active: true,
    inviteId,
    expiresAt: Number(data.expiresAt || 0),
    updatedAt: Number(data.updatedAt || 0),
    previewHash,
    space: normalizeSpace(rawSpace),
    hostDisplayName: boundedText(source.hostDisplayName, 24),
  };
}

function normalizeRequest(value, id = "") {
  const source = valueFromSnapshot(value);
  return {
    id: String(source.requestId || source.id || id),
    publicMemberId: String(source.publicMemberId || source.visitorPublicMemberId || ""),
    visitorCard: normalizeCard(source.visitorCard || source.card),
    status: String(source.status || "pending"),
    sessionId: String(source.sessionId || ""),
    createdAt: Number(source.requestedAt || source.createdAt || 0),
  };
}

function normalizeSession(value, id = "") {
  const source = valueFromSnapshot(value);
  const participants = valueFromSnapshot(source.participants);
  const host = valueFromSnapshot(source.host || participants.host);
  const visitor = valueFromSnapshot(source.visitor || participants.visitor);
  const you = valueFromSnapshot(source.you);
  const peer = valueFromSnapshot(source.peer);
  const cards = valueFromSnapshot(source.cards);
  const publicMembers = valueFromSnapshot(source.publicMembers);
  const ownRole = source.role === "host" || source.role === "visitor" ? source.role : "";
  const hostUid = String(source.hostUid || host.uid || "");
  const visitorUid = String(source.visitorUid || visitor.uid || "");
  const ending = valueFromSnapshot(source.ending || source.end);
  const canonicalRoomMedia = normalizeMedia(source.space?.media);
  const canonicalVisitorMedia = normalizeMedia(cards[visitorUid]?.media);
  return {
    id: String(source.sessionId || source.id || id),
    status: String(source.status || "connecting"),
    hostUid,
    visitorUid,
    hostPublicMemberId: String(source.hostPublicMemberId || host.publicMemberId || publicMembers[hostUid] || ""),
    visitorPublicMemberId: String(source.visitorPublicMemberId || visitor.publicMemberId || publicMembers[visitorUid] || ""),
    hostCard: normalizeCard(
      source.hostCard
      || host.card
      || cards[hostUid]
      || (ownRole === "host" ? you.card : ownRole === "visitor" ? peer.card : null),
    ),
    visitorCard: normalizeCard(
      source.visitorCard
      || visitor.card
      || cards[visitorUid]
      || (ownRole === "visitor" ? you.card : ownRole === "host" ? peer.card : null),
    ),
    clientRole: ownRole,
    peerUid: String(peer.uid || source.peerUid || ""),
    peerPublicMemberId: String(peer.publicMemberId || source.peerPublicMemberId || ""),
    negotiatedMedia: normalizeMedia(source.negotiatedMedia, {
      image: canonicalRoomMedia.image && canonicalVisitorMedia.image,
      audio: canonicalRoomMedia.audio && canonicalVisitorMedia.audio,
      video: canonicalRoomMedia.video && canonicalVisitorMedia.video,
    }),
    space: normalizeSpace(source.space || source.spaceSnapshot),
    arrivals: valueFromSnapshot(source.arrivals || source.arrived),
    ending: {
      reason: String(source.endReason || ending.reason || ending.kind || ""),
      message: boundedText(source.endMessage || ending.message || ending.line, 100),
      byUid: String(source.endedByUid || ending.byUid || ""),
      at: Number(source.endedAt || ending.at || 0),
    },
    seatEstablished: source.seatEstablished === true
      || source.seat?.established === true
      || (source.p2pConnected === true
        && source.admissionAccepted === true
        && (source.arrivals?.host === true)
        && (source.arrivals?.visitor === true)),
    createdAt: Number(source.createdAt || 0),
    expiresAt: Number(source.expiresAt || 0),
  };
}

function roomById(roomId) {
  return state.rooms.find((room) => room.id === roomId)
    || state.returningRooms.find((room) => room.id === roomId)
    || null;
}

function isLiveSession() {
  return Boolean(
    active
    && state.sessionId
    && state.session
    && !state.session.ending?.reason
    && !state.farewell
    && !["ended", "closed", "safe_exit"].includes(state.session.status),
  );
}

function isHost() {
  return state.role === "host";
}

function isVisitor() {
  return state.role === "visitor";
}

async function callFreeTableAction(action, payload = {}) {
  const response = await freeTableActionCallable({ action, ...payload });
  const data = valueFromSnapshot(response?.data);
  if (data.ok === false) throw new Error(data.message || "自由卓の操作を完了できませんでした。");
  return data;
}

async function callFreeTableInviteAction(action, payload = {}) {
  const response = await freeTableInviteActionCallable({ action, ...payload });
  const data = valueFromSnapshot(response?.data);
  if (data.ok === false) throw new Error(data.message || "灯り札の操作を完了できませんでした。");
  return data;
}

function callRoomOpen(activeValue) {
  const task = roomMutationChain
    .catch(() => {})
    .then(() => callFreeTableAction(FREE_TABLE_ACTIONS.OPEN, { active: Boolean(activeValue) }));
  roomMutationChain = task.catch(() => {});
  return task;
}

function trackPendingLeaveSettlement(task) {
  const tracked = Promise.resolve(task).catch(() => {});
  pendingLeaveSettlement = tracked;
  tracked.finally(() => {
    if (pendingLeaveSettlement === tracked) pendingLeaveSettlement = null;
  });
  return tracked;
}

async function waitForPendingLeaveSettlement() {
  if (pendingLeaveSettlement) await pendingLeaveSettlement;
}

function waitForDelay(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(delayMs || 0)));
  });
}

async function ensureAuthenticated() {
  if (auth.currentUser) return auth.currentUser;
  await setPersistence(auth, browserLocalPersistence);
  const credential = await signInAnonymously(auth);
  return credential.user;
}

function setBusy(busy) {
  state.busy = Boolean(busy);
  app?.classList.toggle("is-busy", state.busy);
}

async function runBusy(task) {
  if (state.busy) return null;
  const operationState = state;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  setBusy(true);
  try {
    return await task();
  } catch (error) {
    if (!active
        || state !== operationState
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return null;
    state.error = friendlyError(error);
    showToast(state.error);
    render();
    return null;
  } finally {
    operationState.busy = false;
    if (state === operationState) setBusy(false);
  }
}

function pathFor(...parts) {
  return [FREE_TABLE_ROOT, ...parts].filter((part) => part !== "" && part != null).join("/");
}

function takeNextSlot(counterMap, scope, capacity) {
  let sequence = counterMap.get(scope);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    sequence = Date.now() % capacity;
  }
  counterMap.set(scope, sequence + 1);
  return sequence % capacity;
}

function chatSlotId(role, slot) {
  const roleDigit = role === "host" ? "0" : role === "visitor" ? "1" : "";
  if (!roleDigit || !Number.isInteger(slot) || slot < 0 || slot >= FREE_TABLE_CHAT_SLOT_CAP) {
    throw new Error("自由卓の発言枠を確認できません。");
  }
  return `${FREE_TABLE_CHAT_SLOT_PREFIX}${roleDigit}${String(slot).padStart(3, "0")}`;
}

function nextSignalSlotId(sessionId, targetUid) {
  const scope = `${sessionId}:${targetUid}`;
  const slot = takeNextSlot(signalSlotCounters, scope, FREE_TABLE_SIGNAL_SLOT_CAP);
  return `${FREE_TABLE_SIGNAL_SLOT_PREFIX}${String(slot).padStart(2, "0")}`;
}

async function findWritableChatSlot({
  sessionId,
  sessionGeneration,
  uid,
  role,
}) {
  const scope = `${sessionId}:${role}`;
  const startingSlot = takeNextSlot(chatSlotCounters, scope, FREE_TABLE_CHAT_SLOT_CAP);
  const visibleIds = new Set(
    [...state.chatMessages.keys()].filter((messageId) => FREE_TABLE_CHAT_SLOT_ID_PATTERN.test(messageId)),
  );
  const serverNow = Date.now() + Number(state.serverTimeOffset || 0);
  for (let offset = 0; offset < FREE_TABLE_CHAT_SLOT_CAP; offset += 1) {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return null;
    const messageId = chatSlotId(role, (startingSlot + offset) % FREE_TABLE_CHAT_SLOT_CAP);
    if (visibleIds.has(messageId)) continue;
    const messageRef = ref(database, pathFor("chat", sessionId, messageId));
    const snapshot = await get(messageRef);
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return null;
    if (!snapshot.exists()) return { messageId, messageRef };
    const previous = valueFromSnapshot(snapshot.val());
    if (previous.authorUid === uid
        && Number(previous.expiresAt || 0) > 0
        && Number(previous.expiresAt) <= serverNow) {
      return { messageId, messageRef };
    }
  }
  throw new Error("短い間にたくさんの言葉が交わされました。少し休んでから、もう一度お試しください。");
}

function addUnsubscriber(collection, unsubscribe) {
  if (typeof unsubscribe === "function") collection.push(unsubscribe);
  return unsubscribe;
}

function clearUnsubscribers(collection) {
  collection.splice(0).forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      // Listener cleanup must continue.
    }
  });
}

function signalPriority(snapshot) {
  const type = String(valueFromSnapshot(snapshot?.val?.()).type || "");
  if (type === "offer" || type === "answer") return 2;
  if (type === "candidate") return 1;
  return 0;
}

function signalSnapshotCreatedAt(snapshot) {
  const createdAt = Number(valueFromSnapshot(snapshot?.val?.()).createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function queueDeferredSignal(snapshot) {
  if (!FREE_TABLE_SIGNAL_SLOT_ID_PATTERN.test(String(snapshot?.key || ""))) return;
  const existingIndex = state.deferredSignals.findIndex((entry) => entry.key === snapshot.key);
  if (existingIndex >= 0) {
    if (signalSnapshotCreatedAt(state.deferredSignals[existingIndex]) >= signalSnapshotCreatedAt(snapshot)) return;
    state.deferredSignals.splice(existingIndex, 1);
  }
  state.deferredSignals.push(snapshot);
  state.deferredSignals.sort((first, second) => (
    signalSnapshotCreatedAt(first) - signalSnapshotCreatedAt(second)
    || String(first.key || "").localeCompare(String(second.key || ""))
  ));
  if (state.deferredSignals.length <= FREE_TABLE_SIGNAL_LIMIT) return;
  let dropIndex = 0;
  let lowestPriority = signalPriority(state.deferredSignals[0]);
  for (let index = 1; index < state.deferredSignals.length; index += 1) {
    const priority = signalPriority(state.deferredSignals[index]);
    if (priority < lowestPriority) {
      dropIndex = index;
      lowestPriority = priority;
    }
  }
  state.deferredSignals.splice(dropIndex, 1);
}

function applyMyState(value, { suppressSessionResume = false } = {}) {
  const data = valueFromSnapshot(value);
  const serverUpdatedAt = Number(data.updatedAt || 0);
  const inferredOffset = serverUpdatedAt - Date.now();
  if (Number.isFinite(inferredOffset) && Math.abs(inferredOffset) <= 24 * 60 * 60 * 1000) {
    state.serverTimeOffset = inferredOffset;
  }
  state.myState = data;
  const identity = valueFromSnapshot(data.identity);
  const savedSpace = valueFromSnapshot(data.space);
  const openRoom = data.open ? normalizePublicRoom(data.open) : null;
  state.publicMemberId = String(identity.publicMemberId || state.publicMemberId);
  state.space = normalizeSpace(savedSpace.space || state.space);
  state.hostCard = normalizeCard(savedSpace.hostCard, state.hostCard);
  state.visitorCard = normalizeCard(data.visitorCard, {
    ...state.hostCard,
    message: state.visitorCard.message,
  });
  state.publicRoomId = String(
    openRoom?.id
    || savedSpace.publicRoomId
    || identity.publicRoomId
    || state.publicRoomId,
  );
  state.roomOpen = Boolean(openRoom);
  if (!state.roomOpen && state.hostInvite) clearHostInviteUi();
  state.requests = (Array.isArray(data.requests) ? data.requests : [])
    .map((request) => normalizeRequest(request))
    .filter((request) => request.id);
  state.blocks = (Array.isArray(data.blocks) ? data.blocks : [])
    .map((block) => ({
      publicMemberId: String(block?.publicMemberId || ""),
      name: boundedText(block?.name, 24) || "名前を表示しない相手",
    }))
    .filter((block) => block.publicMemberId);
  const bookmarkValues = data.bookmarks || data.bookmarkedRoomIds || {};
  const bookmarkEntries = Array.isArray(bookmarkValues)
    ? bookmarkValues.map((entry) => [String(entry?.publicRoomId || entry?.id || entry), entry])
    : Object.entries(bookmarkValues);
  state.bookmarks = new Set(bookmarkEntries
    .filter(([roomId, entry]) => roomId && (entry === true || typeof entry === "object"))
    .map(([roomId]) => roomId));
  state.returningRooms = bookmarkEntries
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([roomId, entry]) => normalizePublicRoom(entry.room || entry.snapshot || entry, roomId))
    .filter((room) => room.id);
  const growth = valueFromSnapshot(savedSpace.growth || data.growth || data.spaceGrowth);
  const stageValue = growth.stageId ?? growth.stage ?? growth.currentMilestone?.id ?? "none";
  const stageIds = ["light", "seat", "shelf", "window", "sendoff"];
  state.growth = {
    stageId: typeof stageValue === "number"
      ? (stageValue <= 0
        ? "none"
        : stageIds[Math.min(stageIds.length - 1, Math.floor(stageValue) - 1)])
      : (stageIds.includes(String(stageValue)) ? String(stageValue) : "none"),
    topicToolbox: (growth.topicToolbox || growth.topicPresets || growth.unlockedTopics || [])
      .map((topic) => boundedText(typeof topic === "string" ? topic : topic?.label || topic?.text, 60))
      .filter(Boolean)
      .slice(0, 12),
  };
  const pendingRequest = data.pending?.request
    ? normalizeRequest(data.pending.request)
    : null;
  state.pendingRequest = pendingRequest && !state.ignoredRequestIds.has(pendingRequest.id)
    ? pendingRequest
    : null;
  const activeSessionId = String(data.session?.sessionId || "");
  if (activeSessionId && state.ignoredSessionIds.has(activeSessionId)) {
    scheduleIgnoredSessionEnd(activeSessionId);
  } else if (!suppressSessionResume
      && activeSessionId
      && !state.sessionId) {
    enterSession(activeSessionId, data.session).catch(handleError);
  }
}

async function refreshMyState(expectedGeneration = state.generation, {
  expectedSessionGeneration = null,
  requireNoSession = false,
} = {}) {
  const data = await callFreeTableAction(FREE_TABLE_ACTIONS.GET_MY_STATE);
  if (!active
      || state.generation !== expectedGeneration
      || (expectedSessionGeneration != null
        && state.sessionGeneration !== expectedSessionGeneration)
      || (requireNoSession && state.sessionId)) return data;
  applyMyState(data);
  return data;
}

async function refreshRooms(expectedGeneration = state.generation, {
  expectedSessionGeneration = null,
  requireNoSession = false,
} = {}) {
  const data = await callFreeTableAction(FREE_TABLE_ACTIONS.LIST);
  if (!active
      || state.generation !== expectedGeneration
      || (expectedSessionGeneration != null
        && state.sessionGeneration !== expectedSessionGeneration)
      || (requireNoSession && state.sessionId)) return [];
  const source = data.rooms || data.publicRooms || [];
  state.rooms = Array.isArray(source)
    ? source.map((room) => normalizePublicRoom(room)).filter((room) => room.id && room.open)
    : Object.entries(source).map(([id, room]) => normalizePublicRoom(room, id)).filter((room) => room.id && room.open);
  return state.rooms;
}

function listenToHall(expectedGeneration = state.generation) {
  const uid = state.uid;
  const contextIsCurrent = () => (
    active
    && state.generation === expectedGeneration
    && state.uid === uid
    && !state.sessionId
  );
  clearUnsubscribers(state.hallUnsubscribers);
  addUnsubscriber(state.hallUnsubscribers, onValue(
    ref(database, pathFor("active", uid)),
    (snapshot) => {
      if (!contextIsCurrent()) return;
      const activeValue = valueFromSnapshot(snapshot.val());
      const sessionId = String(activeValue.sessionId || activeValue.id || "");
      if (sessionId && sessionId !== state.sessionId && !state.ignoredSessionIds.has(sessionId)) {
        enterSession(sessionId).catch((error) => {
          if (contextIsCurrent()) handleError(error);
        });
      }
    },
    (error) => {
      if (contextIsCurrent()) handleError(error);
    },
  ));
  addUnsubscriber(state.hallUnsubscribers, onValue(
    ref(database, pathFor("visitorPending", uid)),
    (snapshot) => {
      if (!contextIsCurrent()) return;
      const pending = valueFromSnapshot(snapshot.val());
      if (!Object.keys(pending).length) {
        state.pendingRequest = null;
        render();
        return;
      }
      const normalizedPending = normalizeRequest(pending, pending.requestId);
      if (state.ignoredRequestIds.has(normalizedPending.id)) return;
      state.pendingRequest = normalizedPending;
      const sessionId = String(pending.sessionId || "");
      if (sessionId && pending.status === "accepted") {
        enterSession(sessionId).catch((error) => {
          if (contextIsCurrent()) handleError(error);
        });
      }
      else render();
    },
    (error) => {
      if (contextIsCurrent()) handleError(error);
    },
  ));
  startHallRefresh(expectedGeneration);
}

function startHallRefresh(expectedGeneration = state.generation) {
  stopHallRefresh();
  const sessionGeneration = state.sessionGeneration;
  state.hallRefreshTimer = window.setInterval(() => {
    if (!active || state.generation !== expectedGeneration || state.sessionId) return;
    const preservingUnsavedSetup = state.formDirty && (
      state.screen === "room"
      || (state.screen === "hall" && state.tab === "mine" && !state.roomOpen)
      || (state.screen === "invite" && state.inviteAuthenticated)
    );
    if (preservingUnsavedSetup) return;
    const refreshOptions = { expectedSessionGeneration: sessionGeneration, requireNoSession: true };
    Promise.all([
      refreshRooms(expectedGeneration, refreshOptions),
      refreshMyState(expectedGeneration, refreshOptions),
    ])
      .then(() => {
        if (active && state.generation === expectedGeneration && !state.sessionId) render();
      })
      .catch((error) => {
        if (active && state.generation === expectedGeneration && !state.sessionId) handleError(error);
      });
  }, 10_000);
}

function stopHallRefresh() {
  if (state.hallRefreshTimer) window.clearInterval(state.hallRefreshTimer);
  state.hallRefreshTimer = null;
}

function startOpenHeartbeat(expectedGeneration = state.generation) {
  stopOpenHeartbeat();
  if (!state.roomOpen) return;
  const sessionGeneration = state.sessionGeneration;
  state.heartbeatTimer = window.setInterval(() => {
    if (!active
        || state.generation !== expectedGeneration
        || !state.roomOpen
        || state.sessionId) return;
    callRoomOpen(true)
      .then(() => refreshMyState(expectedGeneration, {
        expectedSessionGeneration: sessionGeneration,
        requireNoSession: true,
      }))
      .catch((error) => {
        if (active && state.generation === expectedGeneration) handleError(error);
      });
  }, FREE_TABLE_HEARTBEAT_MS);
}

function stopOpenHeartbeat() {
  if (state.heartbeatTimer) window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function saveSpaceFromForm(form) {
  const data = new FormData(form);
  const space = normalizeSpace({
    name: data.get("spaceName"),
    description: data.get("spaceDescription"),
    topic: data.get("spaceTopic"),
    introduction: data.get("spaceIntroduction"),
    journeyCue: data.get("spaceJourneyCue"),
    roleplayLevel: data.get("spaceRoleplayLevel"),
    duration: data.get("spaceDuration"),
    media: {
      text: true,
      image: data.get("spaceMediaImage") === "on",
      audio: data.get("spaceMediaAudio") === "on",
      video: data.get("spaceMediaVideo") === "on",
    },
    avoid: data.get("spaceAvoid"),
    welcome: data.get("spaceWelcome"),
    themeId: data.get("spaceThemeId"),
  });
  const hostCard = normalizeCard({
    name: data.get("hostName"),
    activityTag: data.get("hostActivityTag"),
    message: data.get("hostMessage"),
    roleplayLevel: data.get("hostRoleplayLevel"),
    media: space.media,
  });
  if (!hostCard.name) throw new Error("部屋主カードのお名前を入力してください。");
  return { space, hostCard };
}

function visitorCardFromForm(form, allowedMedia = null) {
  const data = new FormData(form);
  const room = roomById(state.selectedRoomId);
  const allowed = allowedMedia || room?.space.media || {};
  const card = normalizeCard({
    name: data.get("visitorName"),
    activityTag: data.get("visitorActivityTag"),
    message: data.get("visitorMessage"),
    roleplayLevel: data.get("visitorRoleplayLevel"),
    media: {
      text: true,
      image: allowed.image === true && data.get("visitorMediaImage") === "on",
      audio: allowed.audio === true && data.get("visitorMediaAudio") === "on",
      video: allowed.video === true && data.get("visitorMediaVideo") === "on",
    },
  }, state.visitorCard);
  if (!card.name) throw new Error("来訪札のお名前を入力してください。");
  return card;
}

function themeFor(themeId) {
  return FREE_TABLE_THEMES[themeId] || FREE_TABLE_THEMES.engawa;
}

function mediaLabels(media) {
  const values = ["文字"];
  if (media?.image) values.push("画像");
  if (media?.audio) values.push("10秒音声");
  if (media?.video) values.push("10秒動画");
  return values;
}

function freeTableInviteUrl(inviteId = state.hostInvite?.inviteId || state.inviteId) {
  const normalizedInviteId = normalizeInviteId(inviteId);
  if (!normalizedInviteId) return "";
  const base = String(shared()?.officialGameUrl || `${location.origin}${location.pathname}`);
  const url = new URL(base, location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(FREE_TABLE_INVITE_QUERY_KEY, normalizedInviteId);
  return url.toString();
}

function defaultInviteShareText(space = state.space) {
  const normalizedSpace = normalizeSpace(space);
  const roomName = boundedText(normalizedSpace.name, 18);
  const topic = boundedText(normalizedSpace.topic, 36);
  const media = mediaLabels(normalizedSpace.media);
  const mediaPhrase = media.length > 1
    ? `${media.slice(0, -1).join("、")}や${media.at(-1)}`
    : media[0];
  return boundedText([
    `今夜、「${roomName}」に灯りをつけました。`,
    "",
    `「${topic}」`,
    `${mediaPhrase}で、${FREE_TABLE_DURATIONS[normalizedSpace.duration]}。手ぶらでもどうぞ。`,
  ].join("\n"), FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH);
}

function currentInviteShareText() {
  return boundedText(
    state.hostInviteShareText || defaultInviteShareText(),
    FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH,
  );
}

function createXInvitePostUrl(text = currentInviteShareText(), inviteUrl = freeTableInviteUrl()) {
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set("text", boundedText(text, FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH));
  if (inviteUrl) url.searchParams.set("url", inviteUrl);
  url.searchParams.set("lang", "ja");
  return url.toString();
}

function formatInviteExpiry(expiresAt) {
  const value = Number(expiresAt || 0);
  if (!Number.isFinite(value) || value <= 0) return "部屋を閉じるまで";
  return `${new Intl.DateTimeFormat("ja-JP", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}ごろまで`;
}

function inviteCanvasPalette(themeId) {
  const palettes = {
    engawa: ["#382820", "#b96c48", "#f8dfae", "#637e69"],
    kitchen: ["#3a211b", "#c97646", "#ffe0ae", "#8b6b4b"],
    library: ["#2c251e", "#8d7353", "#f1dfbd", "#64766a"],
    garden: ["#243127", "#77916e", "#e9e2b5", "#b66f4e"],
    observatory: ["#242538", "#747aa3", "#eee0b6", "#b87979"],
  };
  return palettes[themeId] || palettes.engawa;
}

function drawInviteWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const lines = [];
  let line = "";
  for (const character of Array.from(String(text || ""))) {
    const candidate = `${line}${character}`;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((entry, index) => {
    const finalLine = index === maxLines - 1 && lines.length > maxLines
      ? `${Array.from(entry).slice(0, -1).join("")}…`
      : entry;
    context.fillText(finalLine, x, y + (index * lineHeight));
  });
}

function inviteCanvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("灯り札の画像を作成できませんでした。"));
    }, "image/png");
  });
}

async function createInviteCardPngBlob({
  space = state.space,
  hostDisplayName = state.hostCard.name,
  growthStageId = state.growth.stageId,
} = {}) {
  const normalizedSpace = normalizeSpace(space);
  const theme = themeFor(normalizedSpace.themeId);
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("灯り札の画像を作成できませんでした。");
  const [surface, accent, paper, green] = inviteCanvasPalette(normalizedSpace.themeId);
  const background = context.createLinearGradient(0, 0, 1200, 675);
  background.addColorStop(0, "#17130f");
  background.addColorStop(0.48, surface);
  background.addColorStop(1, "#18211b");
  context.fillStyle = background;
  context.fillRect(0, 0, 1200, 675);

  context.globalAlpha = 0.22;
  context.fillStyle = accent;
  context.beginPath();
  context.arc(1040, 100, 330, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = green;
  context.beginPath();
  context.arc(110, 650, 260, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = "rgba(255, 249, 235, 0.94)";
  context.beginPath();
  context.roundRect(54, 48, 1092, 579, 42);
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = `${accent}bb`;
  context.stroke();

  context.fillStyle = accent;
  context.beginPath();
  context.arc(1041, 152, 62, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = paper;
  context.lineWidth = 5;
  context.beginPath();
  context.arc(1041, 152, 43, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = paper;
  context.font = "700 38px serif";
  context.textAlign = "center";
  context.fillText(theme.icon, 1041, 166);
  context.textAlign = "left";

  const stageIds = ["light", "seat", "shelf", "window", "sendoff"];
  const stageIndex = stageIds.indexOf(String(growthStageId || ""));
  for (let index = 0; index <= stageIndex; index += 1) {
    const x = 918 + (index * 42);
    context.fillStyle = index % 2 ? `${green}dd` : `${accent}cc`;
    context.beginPath();
    context.ellipse(x, 564 - ((index % 2) * 10), 17, 9, -0.45, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = green;
  context.font = "800 24px system-ui, sans-serif";
  context.fillText("貼り合い自由卓", 96, 110);
  context.fillStyle = accent;
  context.font = "800 25px system-ui, sans-serif";
  context.fillText("今夜の灯り札", 96, 153);
  context.fillStyle = "#352b23";
  context.font = "700 52px 'Noto Serif JP', 'Yu Mincho', serif";
  drawInviteWrappedText(context, normalizedSpace.name, 96, 228, 850, 62, 2);
  context.fillStyle = "#79695c";
  context.font = "700 21px system-ui, sans-serif";
  context.fillText("今日の貼り題", 96, 342);
  context.fillStyle = "#3a3028";
  context.font = "750 39px 'Noto Serif JP', 'Yu Mincho', serif";
  drawInviteWrappedText(context, `「${normalizedSpace.topic}」`, 96, 397, 940, 51, 2);

  const labels = [
    FREE_TABLE_DURATIONS[normalizedSpace.duration],
    FREE_TABLE_ROLEPLAY_LEVELS[normalizedSpace.roleplayLevel],
    ...mediaLabels(normalizedSpace.media),
  ];
  context.font = "700 20px system-ui, sans-serif";
  let badgeX = 96;
  for (const label of labels) {
    const width = Math.min(210, context.measureText(label).width + 34);
    if (badgeX + width > 878) break;
    context.fillStyle = "rgba(99, 126, 105, 0.12)";
    context.beginPath();
    context.roundRect(badgeX, 500, width, 43, 22);
    context.fill();
    context.fillStyle = green;
    context.fillText(label, badgeX + 17, 529);
    badgeX += width + 12;
  }

  context.fillStyle = "#6e6155";
  context.font = "650 21px system-ui, sans-serif";
  context.fillText("手ぶらでもどうぞ。ひと席だけ、灯りをつけています。", 96, 586);
  context.textAlign = "right";
  context.fillStyle = accent;
  context.font = "700 21px system-ui, sans-serif";
  context.fillText(
    boundedText(hostDisplayName, 24) ? `部屋主  ${boundedText(hostDisplayName, 24)}` : "貼り合いスタジアム",
    1098,
    586,
  );
  return inviteCanvasToBlob(canvas);
}

function inviteCardFilename(space = state.space) {
  const safeName = String(space?.name || "akari")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 24) || "akari";
  return `hariai-akari-${safeName}.png`;
}

function renderTabs() {
  const tabs = [
    ["open", "お迎え中"],
    ["bookmarks", "帰る場所"],
    ["mine", "自分の部屋"],
  ];
  return `<div class="free-table-tabs" role="tablist" aria-label="自由卓の広間">
    ${tabs.map(([id, label]) => `<button type="button" role="tab" class="free-table-tab${state.tab === id ? " is-active" : ""}" aria-selected="${state.tab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("")}
  </div>`;
}

function renderRoomCard(room, { returning = false } = {}) {
  const theme = themeFor(room.space.themeId);
  return `<article class="free-table-room-card theme-${escapeHtml(room.space.themeId)}">
    <div class="free-table-room-mark" aria-hidden="true">${theme.icon}</div>
    <div class="free-table-room-copy">
      <p class="free-table-eyebrow">${returning ? "また帰れる場所" : escapeHtml(theme.label)}</p>
      <h3>${escapeHtml(room.space.name)}</h3>
      <p>${escapeHtml(room.space.description)}</p>
      <dl class="free-table-room-meta">
        <div><dt>今日の貼り題</dt><dd>${escapeHtml(room.space.topic)}</dd></div>
        <div><dt>過ごし方</dt><dd>${escapeHtml(FREE_TABLE_ROLEPLAY_LEVELS[room.space.roleplayLevel])}・${escapeHtml(FREE_TABLE_DURATIONS[room.space.duration])}</dd></div>
      </dl>
      <div class="free-table-tags">${mediaLabels(room.space.media).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
    </div>
    ${room.open
    ? `<button type="button" class="button free-table-room-enter" data-action="select-room" data-room-id="${escapeHtml(room.id)}">部屋札を見る</button>`
    : `<span class="free-table-room-resting">いまはお休み中</span>`}
  </article>`;
}

function renderOpenRooms() {
  if (state.pendingRequest) {
    return `<section class="free-table-note-card" aria-live="polite">
      <p class="free-table-eyebrow">来訪札を届けました</p>
      <h2>部屋主からのお返事を待っています</h2>
      <p>このまま広間を眺めていて大丈夫です。見送られた時も理由や履歴は表示されません。</p>
      <button type="button" class="button secondary" data-action="cancel-request">来訪札を取り下げる</button>
    </section>`;
  }
  if (!state.rooms.length) {
    return `<section class="free-table-empty">
      <span aria-hidden="true">◌</span>
      <h2>いまは静かな時間です</h2>
      <p>自分の部屋を整えたり、またあとで広間をのぞいてみてください。</p>
    </section>`;
  }
  return `<section class="free-table-room-grid" aria-label="お迎え中の部屋">
    ${state.rooms.map((room) => renderRoomCard(room)).join("")}
  </section>`;
}

function renderBookmarks() {
  const byId = new Map(state.returningRooms.map((room) => [room.id, room]));
  state.rooms
    .filter((room) => state.bookmarks.has(room.id) || room.bookmarked)
    .forEach((room) => byId.set(room.id, room));
  const rooms = [...byId.values()];
  if (!rooms.length) {
    return `<section class="free-table-empty">
      <span aria-hidden="true">⌂</span>
      <h2>帰る場所は、ゆっくり増えていきます</h2>
      <p>心地よかった部屋を私的なしおりに残せます。相手や広間には数を表示しません。</p>
    </section>`;
  }
  return `<section class="free-table-room-grid" aria-label="帰る場所">
    ${rooms.map((room) => renderRoomCard(room, { returning: true })).join("")}
  </section>`;
}

function renderPlaceGrowth() {
  const stages = [
    ["light", "灯り", "帰ってこられる灯りがともっています"],
    ["seat", "席", "いつもの席が部屋に馴染んでいます"],
    ["shelf", "棚", "貼り題をしまう棚が育っています"],
    ["window", "窓", "次の景色を眺める窓辺があります"],
    ["sendoff", "見送り", "やさしく送り出す間が整っています"],
  ];
  const currentIndex = stages.findIndex(([id]) => id === state.growth.stageId);
  const toolbox = state.growth.topicToolbox;
  return `<section class="free-table-growth" aria-label="部屋の育ち">
    <div><p class="free-table-eyebrow">この部屋に馴染んだもの</p>
      <div class="free-table-growth-path">${stages.map(([id, label, description], index) => `<article class="${index <= currentIndex ? "is-present" : ""}${id === state.growth.stageId ? " is-current" : ""}">
        <span aria-hidden="true">${index <= currentIndex ? "●" : "○"}</span><strong>${label}</strong><small>${description}</small>
      </article>`).join("")}</div>
    </div>
    <div class="free-table-toolbox"><p class="free-table-eyebrow">貼り題の引き出し</p>
      ${toolbox.length
    ? `<div>${toolbox.map((topic) => `<button type="button" class="button text" data-action="use-topic" data-topic="${escapeHtml(topic)}"${state.roomOpen ? " disabled" : ""}>${escapeHtml(topic)}</button>`).join("")}</div>`
    : "<p>部屋で過ごした題材から、導入のきっかけが少しずつ馴染んでいきます。</p>"}
    </div>
  </section>`;
}

function renderRequestCard(request) {
  const card = request.visitorCard;
  return `<article class="free-table-visitor-card">
    <div class="free-table-card-avatar" aria-hidden="true">◯</div>
    <div>
      <p class="free-table-eyebrow">来訪札</p>
      <h3>${escapeHtml(card.name || "名もなき旅人")}</h3>
      <p class="free-table-card-tag">${escapeHtml(card.activityTag)}</p>
      <p>${escapeHtml(card.message)}</p>
      <p class="free-table-muted">${escapeHtml(FREE_TABLE_ROLEPLAY_LEVELS[card.roleplayLevel])}・${mediaLabels(card.media).map(escapeHtml).join("・")}</p>
    </div>
    <div class="free-table-card-actions">
      <button type="button" class="button primary" data-action="respond-request" data-request-id="${escapeHtml(request.id)}" data-accept="true">この人を迎える</button>
      <button type="button" class="button secondary" data-action="respond-request" data-request-id="${escapeHtml(request.id)}" data-accept="false">今回は見送る</button>
      ${request.publicMemberId ? `<button type="button" class="button text danger" data-action="block-member" data-member-id="${escapeHtml(request.publicMemberId)}">ブロック</button>` : ""}
    </div>
  </article>`;
}

function renderHostInvitePanel() {
  if (!state.roomOpen) return "";
  if (state.hostInvite && !hostInviteIsLive()) {
    clearHostInviteUi({ keepPanelOpen: true });
  }
  if (!state.hostInvitePanelOpen && !state.hostInvite) {
    return `<aside class="free-table-invite-host-callout">
      <div><p class="free-table-eyebrow">今夜の灯り札</p>
        <h3>Xに、そっと暖簾を出せます</h3>
        <p>宣伝文ではなく、今日の貼り題を一枚の札にします。投稿するかどうかも、ことばも、最後まで自分で選べます。</p></div>
      <button type="button" class="button free-table-noren-button" data-action="issue-invite">Xに暖簾を出す</button>
    </aside>`;
  }
  if (!state.hostInvite) {
    return `<aside class="free-table-invite-host-callout is-open">
      <div><p class="free-table-eyebrow">今夜の灯り札</p>
        <h3>今夜の一席だけに、暖簾を出します</h3>
        <p>部屋を閉じた時、同席が始まった時、または期限を迎えた時に、この入口も静かに閉じます。</p></div>
      <div class="free-table-invite-host-actions">
        <button type="button" class="button free-table-noren-button" data-action="issue-invite">灯り札をつくる</button>
        <button type="button" class="button text" data-action="close-invite-panel">今は出さない</button>
      </div>
    </aside>`;
  }
  const inviteUrl = freeTableInviteUrl(state.hostInvite.inviteId);
  const shareText = currentInviteShareText();
  const busy = state.hostInviteImageBusy ? " disabled" : "";
  return `<aside class="free-table-invite-host-panel" aria-label="Xに出す今夜の灯り札">
    <header>
      <div><p class="free-table-eyebrow">今夜の灯り札</p><h3>暖簾ができました</h3></div>
      <span>この灯りは${escapeHtml(formatInviteExpiry(state.hostInvite.expiresAt))}</span>
    </header>
    <div class="free-table-invite-card-preview theme-${escapeHtml(state.space.themeId)}" aria-hidden="true">
      <span>${themeFor(state.space.themeId).icon}</span>
      <div><small>今夜の灯り札</small><strong>${escapeHtml(state.space.name)}</strong>
        <p>「${escapeHtml(state.space.topic)}」</p></div>
    </div>
    <section class="free-table-invite-public-preview" aria-label="入口で公開される内容">
      <div>
        <p class="free-table-eyebrow">公開前の確認</p>
        <h4>この入口から見えるもの</h4>
      </div>
      <dl>
        <div><dt>部屋主</dt><dd>${escapeHtml(state.hostCard.name)}</dd></div>
        <div><dt>この部屋らしさ</dt><dd>${escapeHtml(state.space.description)}</dd></div>
        <div><dt>はじまり</dt><dd>${escapeHtml(state.space.introduction)}</dd></div>
        <div><dt>旅立ちのきっかけ</dt><dd>${escapeHtml(state.space.journeyCue)}</dd></div>
        <div><dt>過ごし方</dt><dd>${escapeHtml(FREE_TABLE_ROLEPLAY_LEVELS[state.space.roleplayLevel])}・${escapeHtml(FREE_TABLE_DURATIONS[state.space.duration])}・${mediaLabels(state.space.media).map(escapeHtml).join("・")}</dd></div>
        ${state.space.avoid ? `<div><dt>避けたい内容</dt><dd>${escapeHtml(state.space.avoid)}</dd></div>` : ""}
        <div><dt>お迎えのことば</dt><dd>${escapeHtml(state.space.welcome)}</dd></div>
      </dl>
      <p>画像には、部屋名・貼り題・過ごし方・使えるもの・部屋主名と、部屋の育ちに応じた背景のしつらえが入ります。説明・避けたい内容・お迎えのことばは、入口を開いた先だけに表示します。</p>
    </section>
    <label class="free-table-invite-share-copy">Xへ添えることば
      <textarea id="freeTableInviteShareText" rows="5" maxlength="${FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH}">${escapeHtml(shareText)}</textarea>
    </label>
    <p class="free-table-invite-url"><span>今夜だけの入口</span><code>${escapeHtml(inviteUrl)}</code></p>
    <div class="free-table-invite-share-actions">
      <button type="button" class="button primary" data-action="share-invite-card"${busy}>画像と一緒に共有</button>
      <a class="button secondary" id="freeTableInviteXLink" href="${escapeHtml(createXInvitePostUrl(shareText, inviteUrl))}" target="_blank" rel="noopener noreferrer">Xで文章を開く</a>
      <button type="button" class="button secondary" data-action="save-invite-card"${busy}>画像だけ保存</button>
      <button type="button" class="button text" data-action="copy-invite-url">入口をコピー</button>
    </div>
    <details class="free-table-invite-host-settings">
      <summary>この暖簾を整え直す</summary>
      <p>掛け直すと、いまの入口は閉じて新しい入口になります。過去のポストから入室できる状態には戻りません。</p>
      <div>
        <button type="button" class="button secondary" data-action="rotate-invite"${busy}>入口を掛け直す</button>
        <button type="button" class="button text danger" data-action="revoke-invite"${busy}>暖簾をしまう</button>
      </div>
    </details>
    <p class="free-table-invite-privacy">札にはUID・部屋の公開ID・来訪数・会話履歴を載せません。Xへの投稿も自動では行いません。</p>
  </aside>`;
}

function renderSpaceForm() {
  const space = state.space;
  const card = state.hostCard;
  const theme = themeFor(space.themeId);
  return `<section class="free-table-my-room theme-${escapeHtml(space.themeId)}">
    <header class="free-table-my-room-header">
      <span class="free-table-room-mark" aria-hidden="true">${theme.icon}</span>
      <div><p class="free-table-eyebrow">しつらえを育てる</p><h2>${escapeHtml(space.name)}</h2>
      <p>迎えた時間は、灯りや棚などの表現として部屋に馴染んでいきます。公開の数字にはなりません。</p></div>
    </header>
    ${renderPlaceGrowth()}
    <form id="freeTableSpaceForm" class="free-table-form">
      <fieldset${state.roomOpen ? " disabled" : ""}><legend>部屋札</legend>
        <label>部屋の名前<input name="spaceName" maxlength="24" required value="${escapeHtml(space.name)}"></label>
        <label>この部屋らしさ<textarea name="spaceDescription" maxlength="80" rows="2" required>${escapeHtml(space.description)}</textarea></label>
        <label>今日の貼り題<input name="spaceTopic" maxlength="60" required value="${escapeHtml(space.topic)}"></label>
        <label>導入と過ごし方<textarea name="spaceIntroduction" maxlength="160" rows="3" required>${escapeHtml(space.introduction)}</textarea></label>
        <label>旅立ちのきっかけ<input name="spaceJourneyCue" maxlength="60" required value="${escapeHtml(space.journeyCue)}"></label>
        <div class="free-table-form-row">
          <label>なりきり温度<select name="spaceRoleplayLevel">${Object.entries(FREE_TABLE_ROLEPLAY_LEVELS).map(([id, label]) => `<option value="${id}"${space.roleplayLevel === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>目安の時間<select name="spaceDuration">${Object.entries(FREE_TABLE_DURATIONS).map(([id, label]) => `<option value="${id}"${space.duration === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
          <label>部屋のしつらえ<select name="spaceThemeId">${Object.entries(FREE_TABLE_THEMES).map(([id, item]) => `<option value="${id}"${space.themeId === id ? " selected" : ""}>${item.icon} ${item.label}</option>`).join("")}</select></label>
        </div>
        <div class="free-table-checks" aria-label="この部屋で使えるもの">
          <span>使えるもの</span><label><input type="checkbox" checked disabled>文字</label>
          <label><input type="checkbox" name="spaceMediaImage"${space.media.image ? " checked" : ""}>画像</label>
          <label><input type="checkbox" name="spaceMediaAudio"${space.media.audio ? " checked" : ""}>10秒音声</label>
          <label><input type="checkbox" name="spaceMediaVideo"${space.media.video ? " checked" : ""}>10秒動画</label>
        </div>
        <label>避けたい内容<textarea name="spaceAvoid" maxlength="80" rows="2">${escapeHtml(space.avoid)}</textarea></label>
        <label>お迎えのことば<textarea name="spaceWelcome" maxlength="80" rows="2" required>${escapeHtml(space.welcome)}</textarea></label>
      </fieldset>
      <fieldset${state.roomOpen ? " disabled" : ""}><legend>部屋主カード</legend>
        <div class="free-table-form-row">
          <label>表示名<input name="hostName" maxlength="24" required value="${escapeHtml(card.name)}"></label>
          <label>今日の過ごし方<input name="hostActivityTag" maxlength="24" required value="${escapeHtml(card.activityTag)}"></label>
        </div>
        <label>ひとこと<input name="hostMessage" maxlength="40" required value="${escapeHtml(card.message)}"></label>
        <label>なりきり温度<select name="hostRoleplayLevel">${Object.entries(FREE_TABLE_ROLEPLAY_LEVELS).map(([id, label]) => `<option value="${id}"${card.roleplayLevel === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      </fieldset>
      <div class="free-table-form-actions">
        <button type="submit" class="button secondary"${state.roomOpen ? " disabled" : ""}>しつらえを保存</button>
        <button type="button" class="button ${state.roomOpen ? "secondary" : "primary"}" data-action="toggle-room" data-open="${!state.roomOpen}">${state.roomOpen ? "今日は部屋を閉じる" : "お迎えを始める"}</button>
      </div>
    </form>
    ${state.roomOpen ? `<p class="free-table-open-status" role="status"><span></span> お迎え中です。席を外す時は部屋を閉じてください。</p>` : ""}
    ${renderHostInvitePanel()}
  </section>
  <section class="free-table-request-shelf">
    <header><p class="free-table-eyebrow">届いた来訪札</p><h2>${state.requests.length ? "お迎えする人を選べます" : "いまは静かです"}</h2></header>
    ${state.requests.length ? state.requests.map(renderRequestCard).join("") : "<p>来訪札が届くまで、部屋の灯りを眺めて待てます。</p>"}
  </section>
  ${state.blocks.length ? `<details class="free-table-blocked-list">
    <summary>ブロックした相手を確認する</summary>
    <p>この一覧は自分にだけ表示されます。</p>
    ${state.blocks.map((block) => `<div><span>${escapeHtml(block.name)}</span><button type="button" class="button text" data-action="unblock-member" data-member-id="${escapeHtml(block.publicMemberId)}">ブロックを解除</button></div>`).join("")}
  </details>` : ""}`;
}

function renderRecentReportShortcut() {
  if (!activeReportContext() || state.sessionId) return "";
  return `<aside class="free-table-recent-report" aria-label="直前の席の安全確認">
    <div><p class="free-table-eyebrow">直前の一席</p>
      <p>席を閉じた後も、通報に必要な発言の参照だけを15分間保っています。本文はこの端末に保存していません。</p></div>
    <button type="button" class="button text danger" data-action="report-recent-session">直前の席を通報</button>
  </aside>`;
}

function renderHall() {
  return `<section class="free-table">
    <header class="free-table-hero">
      <button type="button" class="button text free-table-home" data-action="home">← ホーム</button>
      <div><p class="free-table-kicker">貼り合い自由卓</p><h1>好きなものを貼って、<br>また出かけられる場所。</h1>
        <p>ここではターンも採点もありません。部屋を開いて迎える日も、誰かの部屋で休む日も。ネタを貼り、話し、元気が戻ったら「いってきます」。</p></div>
      <div class="free-table-hero-orbit" aria-hidden="true"><span>ただいま</span><i></i><span>いってきます</span></div>
    </header>
    ${renderRecentReportShortcut()}
    ${renderTabs()}
    <div class="free-table-tab-panel" role="tabpanel">
      ${state.error ? `<p class="free-table-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
      ${state.tab === "open" ? renderOpenRooms() : state.tab === "bookmarks" ? renderBookmarks() : renderSpaceForm()}
    </div>
  </section>`;
}

function renderInviteInactive() {
  return `<section class="free-table-invite-resting" aria-live="polite">
    <span class="free-table-room-mark" aria-hidden="true">◌</span>
    <p class="free-table-eyebrow">今夜の灯り札</p>
    <h1>いまはお迎えを休んでいます。</h1>
    <p>部屋が閉じた時も、誰かと過ごしている時も、期限を迎えた時も、入口には同じ案内を出しています。</p>
    <button type="button" class="button primary" data-action="browse-invite-hall"${state.inviteAuthenticating ? " disabled" : ""}>${state.inviteAuthenticating ? "広間を用意しています…" : "ほかのお迎え中を見る"}</button>
    <p class="free-table-invite-auth-note">「ほかのお迎え中を見る」を押すと、自由卓を使うための匿名ログインを始めます。</p>
  </section>`;
}

function renderInviteVisitorForm(preview) {
  const card = state.visitorCard;
  const space = preview.space;
  return `<section class="free-table-invite-visitor-form">
    <p class="free-table-eyebrow">来訪札</p>
    <h2>あなたの「ただいま」を整える</h2>
    <p>この札が届いてから、部屋主がお迎えするかを選びます。入口を開いただけでは何も届きません。</p>
    <form id="freeTableInviteVisitorForm" class="free-table-form">
      <label>表示名<input name="visitorName" maxlength="24" required value="${escapeHtml(card.name)}"></label>
      <label>今日の過ごし方<input name="visitorActivityTag" maxlength="24" required value="${escapeHtml(card.activityTag)}"></label>
      <label>ひとこと<input name="visitorMessage" maxlength="40" required value="${escapeHtml(card.message)}"></label>
      <label>なりきり温度<select name="visitorRoleplayLevel">${Object.entries(FREE_TABLE_ROLEPLAY_LEVELS).map(([id, label]) => `<option value="${id}"${card.roleplayLevel === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <div class="free-table-checks"><span>使いたいもの</span>
        <label><input type="checkbox" checked disabled>文字</label>
        ${space.media.image ? `<label><input type="checkbox" name="visitorMediaImage"${card.media.image ? " checked" : ""}>画像</label>` : ""}
        ${space.media.audio ? `<label><input type="checkbox" name="visitorMediaAudio"${card.media.audio ? " checked" : ""}>10秒音声</label>` : ""}
        ${space.media.video ? `<label><input type="checkbox" name="visitorMediaVideo"${card.media.video ? " checked" : ""}>10秒動画</label>` : ""}
      </div>
      <button type="submit" class="button primary">この部屋に「ただいま」</button>
    </form>
    <p class="free-table-muted">部屋主が今回は見送った場合、理由や履歴は表示されません。</p>
  </section>`;
}

function renderInviteEntrance() {
  const status = state.invitePreviewStatus;
  if (status === "loading" || status === "idle") {
    return `<section class="free-table free-table-invite-entrance">
      <button type="button" class="button text free-table-home" data-action="invite-home">← 貼り合いスタジアムへ</button>
      <section class="free-table-invite-loading" aria-live="polite">
        <span class="free-table-room-mark is-pulsing" aria-hidden="true">◌</span>
        <p class="free-table-eyebrow">今夜の灯り札</p>
        <h1>玄関の灯りをたしかめています</h1>
        <p>ここではまだ、来訪札もログインも始まりません。</p>
      </section>
    </section>`;
  }
  const preview = state.invitePreview;
  if (!preview?.active) {
    return `<section class="free-table free-table-invite-entrance">
      <button type="button" class="button text free-table-home" data-action="invite-home">← 貼り合いスタジアムへ</button>
      ${renderInviteInactive()}
    </section>`;
  }
  const space = preview.space;
  const theme = themeFor(space.themeId);
  return `<section class="free-table free-table-invite-entrance theme-${escapeHtml(space.themeId)}">
    <button type="button" class="button text free-table-home" data-action="invite-home">← 貼り合いスタジアムへ</button>
    <div class="free-table-invite-entrance-layout">
      <section class="free-table-invite-room">
        <header><span class="free-table-room-mark" aria-hidden="true">${theme.icon}</span>
          <div><p class="free-table-eyebrow">今夜、灯りがついています</p><h1>${escapeHtml(space.name)}</h1>
            <p>${escapeHtml(space.description)}</p></div></header>
        <dl class="free-table-room-meta is-large">
          <div><dt>今日の貼り題</dt><dd>${escapeHtml(space.topic)}</dd></div>
          <div><dt>はじまり</dt><dd>${escapeHtml(space.introduction)}</dd></div>
          <div><dt>旅立ちのきっかけ</dt><dd>${escapeHtml(space.journeyCue)}</dd></div>
          <div><dt>過ごし方</dt><dd>${escapeHtml(FREE_TABLE_ROLEPLAY_LEVELS[space.roleplayLevel])}・${escapeHtml(FREE_TABLE_DURATIONS[space.duration])}</dd></div>
        </dl>
        ${space.avoid ? `<aside class="free-table-invite-boundary" aria-label="この部屋で避けたい内容">
          <strong>この部屋で避けたい内容</strong>
          <p>${escapeHtml(space.avoid)}</p>
        </aside>` : ""}
        <div class="free-table-tags">${mediaLabels(space.media).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
        ${preview.hostDisplayName ? `<p class="free-table-invite-host-name">部屋主　<strong>${escapeHtml(preview.hostDisplayName)}</strong></p>` : ""}
        <blockquote>${escapeHtml(space.welcome)}</blockquote>
        <div class="free-table-invite-safety">
          <button type="button" class="button text danger" data-action="report-invite-card"${state.inviteReporting || state.inviteReportedPreviewHash === preview.previewHash ? " disabled" : ""}>${state.inviteReportedPreviewHash === preview.previewHash ? "この灯り札を通報しました" : "この灯り札の内容を通報"}</button>
          <p class="free-table-muted">未ログインの場合、通報を送る時だけ匿名ログインを始めます。入室や来訪札の作成は行いません。</p>
        </div>
      </section>
      ${state.inviteAuthenticated
    ? renderInviteVisitorForm(preview)
    : `<section class="free-table-invite-welcome">
          <p class="free-table-eyebrow">玄関</p>
          <h2>もう少し話したくなったら</h2>
          <p>「来訪札を置く」を押してから、この部屋だけに届ける自己紹介を整えます。部屋主の許可なく席へ入ることはありません。</p>
          ${state.error ? `<p class="free-table-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
          <button type="button" class="button primary" data-action="authenticate-invite"${state.inviteAuthenticating ? " disabled" : ""}>${state.inviteAuthenticating ? "来訪札を用意しています…" : "来訪札を置く"}</button>
          <p class="free-table-invite-auth-note">来訪札を置く、または通報を送るまで、匿名ログインは始めません。</p>
        </section>`}
    </div>
  </section>`;
}

function renderRoomDetail() {
  const room = roomById(state.selectedRoomId);
  if (!room) {
    state.screen = "hall";
    return renderHall();
  }
  const card = state.visitorCard;
  const theme = themeFor(room.space.themeId);
  const bookmarked = state.bookmarks.has(room.id) || room.bookmarked;
  return `<section class="free-table free-table-detail theme-${escapeHtml(room.space.themeId)}">
    <button type="button" class="button text free-table-home" data-action="back-hall">← 広間へ戻る</button>
    <section class="free-table-room-detail">
      <header><span class="free-table-room-mark" aria-hidden="true">${theme.icon}</span>
        <div><p class="free-table-eyebrow">${escapeHtml(theme.label)}</p><h1>${escapeHtml(room.space.name)}</h1><p>${escapeHtml(room.space.description)}</p></div>
      </header>
      <dl class="free-table-room-meta is-large">
        <div><dt>今日の貼り題</dt><dd>${escapeHtml(room.space.topic)}</dd></div>
        <div><dt>はじまり</dt><dd>${escapeHtml(room.space.introduction)}</dd></div>
        <div><dt>旅立ちのきっかけ</dt><dd>${escapeHtml(room.space.journeyCue)}</dd></div>
        <div><dt>雰囲気</dt><dd>${escapeHtml(FREE_TABLE_ROLEPLAY_LEVELS[room.space.roleplayLevel])}・${escapeHtml(FREE_TABLE_DURATIONS[room.space.duration])}</dd></div>
        ${room.space.avoid ? `<div><dt>避けたい内容</dt><dd>${escapeHtml(room.space.avoid)}</dd></div>` : ""}
      </dl>
      <div class="free-table-host-card"><p class="free-table-eyebrow">部屋主</p><h2>${escapeHtml(room.hostCard.name || "部屋主")}</h2>
        <p>${escapeHtml(room.hostCard.message)}</p><span>${escapeHtml(room.hostCard.activityTag)}</span></div>
      <button type="button" class="button text" data-action="bookmark-room" data-room-id="${escapeHtml(room.id)}" data-active="${!bookmarked}">${bookmarked ? "帰る場所から外す" : "帰る場所にしおりを挟む"}</button>
    </section>
    ${room.open ? `<section class="free-table-visitor-form-card">
      <p class="free-table-eyebrow">来訪札</p><h2>「ただいま」を届ける</h2>
      <form id="freeTableVisitorForm" class="free-table-form">
        <label>表示名<input name="visitorName" maxlength="24" required value="${escapeHtml(card.name)}"></label>
        <label>今日の過ごし方<input name="visitorActivityTag" maxlength="24" required value="${escapeHtml(card.activityTag)}"></label>
        <label>ひとこと<input name="visitorMessage" maxlength="40" required value="${escapeHtml(card.message)}"></label>
        <label>なりきり温度<select name="visitorRoleplayLevel">${Object.entries(FREE_TABLE_ROLEPLAY_LEVELS).map(([id, label]) => `<option value="${id}"${card.roleplayLevel === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>
        <div class="free-table-checks"><span>使いたいもの</span>
          <label><input type="checkbox" checked disabled>文字</label>
          ${room.space.media.image ? `<label><input type="checkbox" name="visitorMediaImage"${card.media.image ? " checked" : ""}>画像</label>` : ""}
          ${room.space.media.audio ? `<label><input type="checkbox" name="visitorMediaAudio"${card.media.audio ? " checked" : ""}>10秒音声</label>` : ""}
          ${room.space.media.video ? `<label><input type="checkbox" name="visitorMediaVideo"${card.media.video ? " checked" : ""}>10秒動画</label>` : ""}
        </div>
        <button type="submit" class="button primary">この部屋に「ただいま」</button>
      </form>
      <p class="free-table-muted">部屋主が今回は見送った場合、理由や履歴は残りません。</p>
    </section>` : `<section class="free-table-visitor-form-card">
      <p class="free-table-eyebrow">いまは留守です</p>
      <h2>灯りがともるまで、しおりを挟んで待てます</h2>
      <p>部屋が閉じている間も、帰る場所から消えません。活動を休んでも部屋が枯れることはありません。</p>
    </section>`}
  </section>`;
}

function participantName(role) {
  if (!state.session) return "同席者";
  const card = role === "host" ? state.session.hostCard : state.session.visitorCard;
  const ownCard = role === "host" ? state.hostCard : state.visitorCard;
  return card.name || (state.role === role ? ownCard.name : "") || (role === "host" ? "部屋主" : "来訪者");
}

function ownName() {
  return participantName(state.role);
}

function otherRole() {
  return isHost() ? "visitor" : "host";
}

function renderConnecting() {
  const space = state.session?.space || state.space;
  return `<section class="free-table free-table-connecting theme-${escapeHtml(space.themeId)}">
    <section class="free-table-connecting-card">
      <span class="free-table-room-mark is-pulsing" aria-hidden="true">${themeFor(space.themeId).icon}</span>
      <p class="free-table-eyebrow">席を整えています</p>
      <h1>${escapeHtml(space.name)}</h1>
      <p>${state.arrived ? "同席者とのP2P経路を結んでいます。文字の席は先に開けます。" : "「ただいま／おかえり」を交わす準備をしています。"}</p>
      <div class="free-table-connection-status" role="status"><span class="${state.mediaReady ? "is-ready" : ""}"></span>${state.mediaReady ? "メディアのP2P接続ができました" : "接続経路を調整中"}</div>
      <button type="button" class="button secondary" data-action="safe-exit">安全に退出</button>
    </section>
  </section>`;
}

function timelineEntries() {
  return [
    ...state.chatMessages.values(),
    ...state.mediaMessages.values(),
  ].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function pruneChatMessages() {
  if (state.chatMessages.size <= FREE_TABLE_CHAT_LIMIT) return;
  const overflow = state.chatMessages.size - FREE_TABLE_CHAT_LIMIT;
  [...state.chatMessages.values()]
    .sort((first, second) => (
      Number(first.createdAt || 0) - Number(second.createdAt || 0)
      || String(first.id || "").localeCompare(String(second.id || ""))
    ))
    .slice(0, overflow)
    .forEach((message) => state.chatMessages.delete(message.id));
}

function applyChatSnapshot(snapshot, sessionId, sessionGeneration) {
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
  const messageId = String(snapshot?.key || "");
  if (!FREE_TABLE_CHAT_SLOT_ID_PATTERN.test(messageId)) return;
  const message = valueFromSnapshot(snapshot.val());
  if (message.type !== "text") return;
  const text = boundedText(message.text, FREE_TABLE_TEXT_MAX_LENGTH);
  const createdAt = Number(message.createdAt);
  const authorRole = message.authorRole === "host"
    ? "host"
    : message.authorRole === "visitor"
      ? "visitor"
      : "";
  const roleDigit = authorRole === "host" ? "0" : authorRole === "visitor" ? "1" : "";
  if (!text
      || !Number.isFinite(createdAt)
      || createdAt <= 0
      || !authorRole
      || messageId.charAt(FREE_TABLE_CHAT_SLOT_PREFIX.length) !== roleDigit) return;
  const existing = state.chatMessages.get(messageId);
  const pending = state.pendingChatMutations.get(messageId);
  const previousCreatedAt = Number(pending?.previousEntry?.createdAt || 0);
  const isPendingValue = Boolean(
    pending
    && message.authorUid === pending.authorUid
    && authorRole === pending.authorRole
    && text === pending.text
    && createdAt > previousCreatedAt
  );
  if (!pending
      && existing
      && Number(existing.createdAt || 0) >= createdAt) return;
  state.chatMessages.set(messageId, {
    id: messageId,
    type: "text",
    text,
    authorUid: String(message.authorUid || message.uid || ""),
    authorRole,
    createdAt,
    ...(isPendingValue ? { pendingToken: pending.token } : {}),
  });
  pruneChatMessages();
  render();
}

function removeChatSnapshot(snapshot, sessionId, sessionGeneration) {
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
  const messageId = String(snapshot?.key || "");
  const existing = state.chatMessages.get(messageId);
  if (!existing) return;
  const removedCreatedAt = Number(valueFromSnapshot(snapshot.val()).createdAt || 0);
  if (!existing.pendingToken
      && Number.isFinite(removedCreatedAt)
      && Number(existing.createdAt || 0) !== removedCreatedAt) return;
  state.chatMessages.delete(messageId);
  render();
}

function renderMedia(resource) {
  if (!resource?.url || resource.released) return `<p class="free-table-media-unavailable">メディアは席を閉じたため破棄されました。</p>`;
  if (resource.kind === "image") {
    return `<img class="free-table-shared-image" src="${escapeHtml(resource.url)}" alt="自由卓に貼られた画像">`;
  }
  if (resource.kind === "audio") {
    return `<audio controls preload="none" src="${escapeHtml(resource.url)}">音声を再生できません。</audio>`;
  }
  return `<video controls preload="metadata" playsinline src="${escapeHtml(resource.url)}">動画を再生できません。</video>`;
}

function renderTimelineEntry(entry) {
  const mine = entry.authorUid === state.uid || entry.mine === true;
  const role = entry.authorRole === "host" ? "host" : "visitor";
  const name = mine ? ownName() : participantName(role);
  const safeMessageId = escapeHtml(entry.id || entry.transferId || "");
  if (entry.type === "media") {
    return `<article class="free-table-bubble is-${mine ? "mine" : "theirs"}" data-message-id="${safeMessageId}">
      <header><span>${escapeHtml(name)}</span><small>${entry.kind === "image" ? "画像" : entry.kind === "audio" ? "10秒音声" : "10秒動画"}</small></header>
      <div class="free-table-media-frame">${renderMedia(entry.resource)}</div>
      ${mine ? "" : `<button type="button" class="button text free-table-hide-media" data-action="hide-media" data-media-id="${safeMessageId}">このメディアを隠す</button>`}
    </article>`;
  }
  if (entry.type === "system") {
    return `<p class="free-table-system-line">${escapeHtml(entry.text)}</p>`;
  }
  return `<article class="free-table-bubble is-${mine ? "mine" : "theirs"}" data-message-id="${safeMessageId}">
    <header><span>${escapeHtml(name)}</span></header>
    <p>${escapeHtml(entry.text).replaceAll("\n", "<br>")}</p>
  </article>`;
}

function negotiatedSessionMedia() {
  const negotiatedMedia = state.session?.negotiatedMedia;
  if (negotiatedMedia) return normalizeMedia(negotiatedMedia);
  const roomMedia = state.session?.space?.media || {};
  const visitorMedia = state.session?.visitorCard?.media || state.visitorCard.media || {};
  return {
    text: true,
    image: roomMedia.image === true && visitorMedia.image === true,
    audio: roomMedia.audio === true && visitorMedia.audio === true,
    video: roomMedia.video === true && visitorMedia.video === true,
  };
}

function sessionAllowsMediaKind(kind) {
  return ["image", "audio", "video"].includes(kind) && negotiatedSessionMedia()[kind] === true;
}

function renderMediaTools() {
  const media = negotiatedSessionMedia();
  if (!media.image && !media.audio && !media.video) return "";
  const disabled = !state.mediaReady;
  return `<div class="free-table-media-tools" aria-label="メディアを貼る">
    ${media.image ? `<label class="button secondary free-table-file-button${disabled ? " is-disabled" : ""}">画像を貼る<input type="file" data-media-kind="image" accept="image/*" hidden${disabled ? " disabled" : ""}></label>` : ""}
    ${media.audio ? `<label class="button secondary free-table-file-button${disabled ? " is-disabled" : ""}">10秒音声を貼る<input type="file" data-media-kind="audio" accept="audio/*,.wav" hidden${disabled ? " disabled" : ""}></label>` : ""}
    ${media.video ? `<label class="button secondary free-table-file-button${disabled ? " is-disabled" : ""}">10秒動画を貼る<input type="file" data-media-kind="video" accept="video/webm,video/mp4" hidden${disabled ? " disabled" : ""}></label>` : ""}
    <span class="free-table-p2p-note">${state.mediaReady ? "メディアはこの席の間だけP2Pで届きます" : "P2P接続後にメディアを貼れます"}</span>
    ${state.mediaProgress > 0 && state.mediaProgress < 100 ? `<progress max="100" value="${state.mediaProgress}" aria-label="メディア送信">${state.mediaProgress}%</progress>` : ""}
  </div>`;
}

function renderSession() {
  const session = state.session;
  if (!session) return renderConnecting();
  const opponentName = participantName(otherRole());
  return `<section class="free-table free-table-session theme-${escapeHtml(session.space.themeId)}">
    <header class="free-table-session-header">
      <div><p class="free-table-eyebrow">${isHost() ? "おかえり" : "ただいま"}</p>
        <h1>${escapeHtml(session.space.topic)}</h1>
        <p>${escapeHtml(session.space.introduction)}</p></div>
      <div class="free-table-seat-status"><span class="${state.mediaReady ? "is-ready" : ""}"></span>${escapeHtml(opponentName)}さんと同席中</div>
    </header>
    <section class="free-table-timeline" id="freeTableTimeline" aria-live="polite" aria-label="貼り合いの会話">
      <p class="free-table-system-line">${escapeHtml(session.space.welcome)}</p>
      <p class="free-table-system-line">${state.seatEstablished
    ? "「ただいま／おかえり」がそろい、一席の記憶が灯りました。"
    : "文字の席は開いています。P2Pが整うと一席の記憶が灯ります。"}</p>
      ${timelineEntries().map(renderTimelineEntry).join("")}
    </section>
    <section class="free-table-composer">
      <form id="freeTableChatForm">
        <label for="freeTableChatText">言葉を貼る</label>
        <textarea id="freeTableChatText" name="text" rows="3" maxlength="${FREE_TABLE_TEXT_MAX_LENGTH}" placeholder="ターンはありません。思いついた時に、ゆっくりどうぞ。">${escapeHtml(state.chatDraft)}</textarea>
        <button type="submit" class="button primary">貼る</button>
      </form>
      ${renderMediaTools()}
    </section>
    <footer class="free-table-session-footer">
      ${isVisitor() ? `<button type="button" class="button free-table-ittekimasu" data-action="open-departure">敗北して、いってきます</button>` : ""}
      ${state.seatEstablished ? `<button type="button" class="button secondary" data-action="relationship">${state.relationshipWanted ? "「またここで」を外す" : "またここで会いたい"}</button>` : ""}
      ${state.relationshipMutual ? `<span class="free-table-mutual-note">お互いの「またここで」が重なりました</span>` : ""}
      <button type="button" class="button secondary" data-action="close-session">今日はここまで</button>
      <button type="button" class="button text danger" data-action="safe-exit">安全に退出</button>
      ${state.opponentPublicMemberId ? `<button type="button" class="button text danger" data-action="block-member" data-member-id="${escapeHtml(state.opponentPublicMemberId)}">ブロック</button>` : ""}
      <button type="button" class="button text" data-action="report-session">通報</button>
    </footer>
  </section>`;
}

function renderDepartureComposer() {
  return `<section class="free-table free-table-farewell theme-${escapeHtml(state.session?.space?.themeId || "engawa")}">
    <section class="free-table-farewell-card">
      <p class="free-table-eyebrow">旅立ちのあいさつ</p>
      <h1>敗北は、負けではありません。</h1>
      <p>この部屋で受け取ったものを胸に、外へ戻る「いってきます」です。</p>
      <form id="freeTableDepartureForm" class="free-table-form">
        <fieldset><legend>ことばを選ぶ</legend>
          ${FREE_TABLE_DEPARTURE_PRESETS.map((line, index) => `<label class="free-table-choice"><input type="radio" name="departurePreset" value="${index}"${index === 0 ? " checked" : ""}><span>${escapeHtml(line)}</span></label>`).join("")}
          <label class="free-table-choice"><input type="radio" name="departurePreset" value="custom"><span>自分のことばで</span></label>
          <textarea name="departureCustom" maxlength="80" rows="2" placeholder="最後は「いってきます」で結びます"></textarea>
        </fieldset>
        <div class="free-table-form-actions">
          <button type="button" class="button secondary" data-action="cancel-departure">もう少し過ごす</button>
          <button type="submit" class="button free-table-ittekimasu">敗北して、いってきます</button>
        </div>
      </form>
    </section>
  </section>`;
}

function farewellRemainingSeconds() {
  return Math.max(0, Math.ceil((Number(state.farewell?.expiresAt || 0) - Date.now()) / 1000));
}

function renderFarewell() {
  const farewell = state.farewell || {};
  const visitorMessage = farewell.departureMessage || state.session?.ending?.message || "いってきます";
  const remaining = farewellRemainingSeconds();
  if (isHost()) {
    return `<section class="free-table free-table-farewell theme-${escapeHtml(state.session?.space?.themeId || "engawa")}">
      <section class="free-table-farewell-card">
        <p class="free-table-eyebrow">旅立ち</p>
        <h1>${escapeHtml(participantName("visitor"))}さんが「いってきます」を告げました。</h1>
        <blockquote>${escapeHtml(visitorMessage)}</blockquote>
        <p>返礼は待ち時間を止めません。無言で見送っても、灯りがやさしく送り出します。</p>
        <form id="freeTableSendoffForm" class="free-table-form">
          <fieldset><legend>見送りのことば</legend>
            ${FREE_TABLE_SENDOFF_PRESETS.map((line, index) => `<label class="free-table-choice"><input type="radio" name="sendoffPreset" value="${index}"${index === 0 ? " checked" : ""}><span>${escapeHtml(line)}</span></label>`).join("")}
            <label class="free-table-choice"><input type="radio" name="sendoffPreset" value="custom"><span>自分のことばで</span></label>
            <textarea name="sendoffCustom" maxlength="80" rows="2" placeholder="いってらっしゃい"></textarea>
            <label class="free-table-choice"><input type="radio" name="sendoffPreset" value="silent"><span>無言で、静かに見送る</span></label>
          </fieldset>
          <button type="submit" class="button primary">いってらっしゃい</button>
        </form>
        <p class="free-table-farewell-timer" role="status">あと${remaining}秒ほどで、席は静かに閉じます。</p>
      </section>
    </section>`;
  }
  return `<section class="free-table free-table-farewell theme-${escapeHtml(state.session?.space?.themeId || "engawa")}">
    <section class="free-table-farewell-card">
      <p class="free-table-eyebrow">いってきます</p>
      <h1>${farewell.responseReceived ? "「いってらっしゃい」が届きました。" : "見送りを待っても、先に出かけても大丈夫です。"}</h1>
      ${farewell.responseReceived
    ? `<blockquote>${escapeHtml(farewell.responseMessage || "部屋の灯りに見送られました。")}</blockquote>`
    : `<p>返礼がなくても、この旅立ちはきちんと成立しています。</p>`}
      <button type="button" class="button primary" data-action="finish-farewell">待たずに広間へ</button>
      <p class="free-table-farewell-timer" role="status">あと${remaining}秒ほどで、自動で広間へ戻ります。</p>
    </section>
  </section>`;
}

function render() {
  if (!active || !app) return;
  const previousTimeline = state.screen === "session" ? document.querySelector("#freeTableTimeline") : null;
  const scrollTop = previousTimeline?.scrollTop ?? null;
  const followTimeline = previousTimeline
    ? previousTimeline.scrollHeight - previousTimeline.scrollTop - previousTimeline.clientHeight < 80
    : true;
  if (state.screen === "invite") app.innerHTML = renderInviteEntrance();
  else if (state.screen === "room") app.innerHTML = renderRoomDetail();
  else if (state.screen === "connecting") app.innerHTML = renderConnecting();
  else if (state.screen === "session") app.innerHTML = renderSession();
  else if (state.screen === "departure") app.innerHTML = renderDepartureComposer();
  else if (state.screen === "farewell") app.innerHTML = renderFarewell();
  else app.innerHTML = renderHall();
  bindRenderedEvents();
  if (state.screen === "session") {
    const timeline = document.querySelector("#freeTableTimeline");
    if (timeline) timeline.scrollTop = followTimeline ? timeline.scrollHeight : (scrollTop ?? timeline.scrollHeight);
  }
}

function bindRenderedEvents() {
  const spaceForm = document.querySelector("#freeTableSpaceForm");
  const visitorForm = document.querySelector("#freeTableVisitorForm");
  const inviteVisitorForm = document.querySelector("#freeTableInviteVisitorForm");
  const inviteShareText = document.querySelector("#freeTableInviteShareText");
  spaceForm?.addEventListener("submit", handleSaveSpace);
  visitorForm?.addEventListener("submit", handleRequest);
  inviteVisitorForm?.addEventListener("submit", handleInviteRequest);
  spaceForm?.addEventListener("input", () => { state.formDirty = true; });
  spaceForm?.addEventListener("change", () => { state.formDirty = true; });
  visitorForm?.addEventListener("input", () => { state.formDirty = true; });
  visitorForm?.addEventListener("change", () => { state.formDirty = true; });
  inviteVisitorForm?.addEventListener("input", () => { state.formDirty = true; });
  inviteVisitorForm?.addEventListener("change", () => { state.formDirty = true; });
  inviteShareText?.addEventListener("input", (event) => {
    state.hostInviteShareText = boundedText(
      event.currentTarget.value,
      FREE_TABLE_INVITE_SHARE_TEXT_MAX_LENGTH,
    );
    const xLink = document.querySelector("#freeTableInviteXLink");
    if (xLink) {
      xLink.href = createXInvitePostUrl(
        state.hostInviteShareText,
        freeTableInviteUrl(state.hostInvite?.inviteId),
      );
    }
  });
  document.querySelector("#freeTableChatForm")?.addEventListener("submit", handleSendChat);
  document.querySelector("#freeTableChatText")?.addEventListener("input", (event) => {
    state.chatDraft = String(event.currentTarget.value || "").slice(0, FREE_TABLE_TEXT_MAX_LENGTH);
  });
  document.querySelector("#freeTableDepartureForm")?.addEventListener("submit", handleDeparture);
  document.querySelector("#freeTableSendoffForm")?.addEventListener("submit", handleSendoff);
  document.querySelectorAll("[data-media-kind]").forEach((input) => {
    input.addEventListener("change", handleMediaFile);
  });
}

function handleError(error) {
  console.error(error);
  state.error = friendlyError(error);
  showToast(state.error);
  render();
}

function handleSessionAuxiliaryError(error) {
  const permissionDenied = error?.code === "permission-denied"
    || String(error?.message || "").includes("PERMISSION_DENIED");
  if (permissionDenied && state.sessionId) {
    console.warn("自由卓の補助経路を閉じました。");
    return;
  }
  handleError(error);
}

async function handleSaveSpace(event) {
  event.preventDefault();
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    const { space, hostCard } = saveSpaceFromForm(event.currentTarget);
    const data = await callFreeTableAction(FREE_TABLE_ACTIONS.SAVE_SPACE, { space, hostCard });
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return;
    state.space = space;
    state.hostCard = hostCard;
    state.formDirty = false;
    applyMyState(data);
    showToast("部屋のしつらえを保存しました。");
    render();
  });
}

async function toggleRoom(open) {
  if (open) {
    await waitForPendingLeaveSettlement();
    if (!active) return;
  }
  if (open && state.formDirty) {
    showToast("先に部屋のしつらえを保存してください。");
    return;
  }
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    if (open && !state.hostCard.name) throw new Error("先に部屋主カードを保存してください。");
    const data = await callRoomOpen(open);
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration
        || state.sessionId) return;
    state.roomOpen = open;
    state.publicRoomId = String(data.room?.publicRoomId || data.publicRoomId || state.publicRoomId);
    if (open) {
      clearHostInviteUi();
      startOpenHeartbeat();
      await refreshMyState(lifecycle, {
        expectedSessionGeneration: sessionGeneration,
        requireNoSession: true,
      });
      if (!active
          || state.generation !== lifecycle
          || state.sessionGeneration !== sessionGeneration
          || state.sessionId) return;
      showToast("部屋の灯りをつけました。");
    } else {
      state.formDirty = false;
      stopOpenHeartbeat();
      state.requests = [];
      clearHostInviteUi();
      showToast("今日は部屋を閉じました。");
    }
    render();
  });
}

async function issueHostInvite(action = "issue") {
  if (!state.roomOpen || !["issue", "rotate"].includes(action)) return;
  if (action === "rotate" && !hostInviteIsLive()) {
    clearHostInviteUi({ keepPanelOpen: true });
    action = "issue";
  }
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    const payload = action === "rotate" && state.hostInvite?.inviteId
      ? { inviteId: state.hostInvite.inviteId }
      : {};
    const data = await callFreeTableInviteAction(action, payload);
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration
        || state.sessionId
        || !state.roomOpen) return;
    const invite = normalizeHostInvite(data.invite);
    if (!invite) throw new Error("今夜の灯り札を確認できませんでした。");
    state.hostInvite = invite;
    state.hostInvitePanelOpen = true;
    armHostInviteExpiry(invite);
    if (!state.hostInviteShareText) {
      state.hostInviteShareText = defaultInviteShareText(state.space);
    }
    showToast(action === "rotate"
      ? "暖簾を掛け直しました。前の入口は静かに閉じました。"
      : "今夜の灯り札ができました。投稿する前にことばを整えられます。");
    render();
  });
}

async function revokeHostInvite() {
  const inviteId = normalizeInviteId(state.hostInvite?.inviteId);
  if (!inviteId) return;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    await callFreeTableInviteAction("revoke", { inviteId });
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return;
    if (state.hostInvite?.inviteId === inviteId) {
      clearHostInviteUi({ keepPanelOpen: true });
    }
    showToast("Xの暖簾をしまいました。部屋の灯りはそのままです。");
    render();
  });
}

async function createCurrentInviteCardBlob() {
  if (!state.roomOpen || !hostInviteIsLive()) {
    clearHostInviteUi({ keepPanelOpen: true });
    throw new Error("この灯り札は期限を迎えました。新しい灯り札をつくってください。");
  }
  return createInviteCardPngBlob({
    space: state.space,
    hostDisplayName: state.hostCard.name,
    growthStageId: state.growth.stageId,
  });
}

async function shareHostInviteCard() {
  if (state.hostInviteImageBusy) return;
  const inviteId = normalizeInviteId(state.hostInvite?.inviteId);
  const inviteUrl = freeTableInviteUrl(inviteId);
  if (!inviteId || !inviteUrl) return;
  state.hostInviteImageBusy = true;
  render();
  try {
    const blob = await createCurrentInviteCardBlob();
    const filename = inviteCardFilename();
    const file = new File([blob], filename, { type: "image/png" });
    const shareText = currentInviteShareText();
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "貼り合い自由卓｜今夜の灯り札",
          text: shareText,
          url: inviteUrl,
          files: [file],
        });
        return;
      } catch (error) {
        if (String(error?.name || "") === "AbortError") return;
        console.warn("端末の共有を開けなかったため、灯り札を保存します。", error);
      }
    }
    shared()?.downloadBlob?.(blob, filename);
    showToast("共有対応端末ではないため画像を保存しました。Xで文章を開き、添付できます。");
  } finally {
    state.hostInviteImageBusy = false;
    if (active) render();
  }
}

async function saveHostInviteCard() {
  if (state.hostInviteImageBusy) return;
  const inviteId = normalizeInviteId(state.hostInvite?.inviteId);
  if (!inviteId) return;
  state.hostInviteImageBusy = true;
  render();
  try {
    const blob = await createCurrentInviteCardBlob();
    shared()?.downloadBlob?.(blob, inviteCardFilename());
    showToast("今夜の灯り札を保存しました。投稿する時に添付できます。");
  } finally {
    state.hostInviteImageBusy = false;
    if (active) render();
  }
}

async function copyHostInviteUrl() {
  if (!hostInviteIsLive()) {
    clearHostInviteUi({ keepPanelOpen: true });
    render();
    showToast("この灯り札は期限を迎えました。新しい灯り札をつくれます。");
    return;
  }
  const inviteUrl = freeTableInviteUrl();
  if (!inviteUrl) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(inviteUrl);
  } else {
    const input = document.createElement("textarea");
    input.value = inviteUrl;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast("今夜だけの入口をコピーしました。");
}

async function handleRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await waitForPendingLeaveSettlement();
  if (!active) return;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  const publicRoomId = state.selectedRoomId;
  await runBusy(async () => {
    const visitorCard = visitorCardFromForm(form);
    const data = await callFreeTableAction(FREE_TABLE_ACTIONS.REQUEST, {
      publicRoomId,
      visitorCard,
    });
    if (active && state.generation === lifecycle && state.sessionId) return;
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) {
      trackPendingLeaveSettlement(settlePendingAfterLeave());
      return;
    }
    state.visitorCard = visitorCard;
    state.formDirty = false;
    state.pendingRequest = normalizeRequest(data.request || data, data.requestId);
    state.screen = "hall";
    state.tab = "open";
    showToast("来訪札を届けました。");
    render();
  });
}

async function handleInviteRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const preview = state.invitePreview;
  const inviteId = normalizeInviteId(state.inviteId);
  if (!state.inviteAuthenticated || !preview?.active || !inviteId) return;
  await waitForPendingLeaveSettlement();
  if (!active || state.screen !== "invite") return;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    const visitorCard = visitorCardFromForm(form, preview.space.media);
    try {
      const data = await callFreeTableAction(FREE_TABLE_ACTIONS.REQUEST_FROM_INVITE, {
        inviteId,
        visitorCard,
      });
      if (active && state.generation === lifecycle && state.sessionId) return;
      if (!active
          || state.generation !== lifecycle
          || state.sessionGeneration !== sessionGeneration) {
        trackPendingLeaveSettlement(settlePendingAfterLeave());
        return;
      }
      state.visitorCard = visitorCard;
      state.formDirty = false;
      state.pendingRequest = normalizeRequest(data.request || data, data.requestId);
      state.screen = "hall";
      state.tab = "open";
      state.inviteId = "";
      stopInvitePreviewRefresh();
      clearInviteQueryFromUrl();
      showToast("来訪札を届けました。部屋主からのお返事を待っています。");
      render();
    } catch (error) {
      const code = String(error?.code || "").toLowerCase();
      if (code.includes("failed-precondition") || code.includes("not-found")) {
        state.invitePreviewStatus = "inactive";
        state.invitePreview = { active: false, inviteId };
        state.error = "";
        stopInvitePreviewRefresh();
        render();
        return;
      }
      throw error;
    }
  });
}

async function resolveCancelledRequestRace() {
  const fresh = await callFreeTableAction(FREE_TABLE_ACTIONS.GET_MY_STATE);
  const racedSessionId = String(fresh.session?.sessionId || "");
  if (racedSessionId) {
    scheduleIgnoredSessionEnd(racedSessionId);
  }
  applyMyState(fresh, { suppressSessionResume: true });
  state.pendingRequest = null;
}

async function settlePendingAfterLeave(attempt = 0) {
  try {
    const result = await callFreeTableAction(FREE_TABLE_ACTIONS.CANCEL_REQUEST);
    if (result.cancelled === true) return;
    const fresh = await callFreeTableAction(FREE_TABLE_ACTIONS.GET_MY_STATE);
    const racedSessionId = String(fresh.session?.sessionId || "");
    if (racedSessionId) {
      scheduleIgnoredSessionEnd(racedSessionId);
    }
    return;
  } catch {
    try {
      const fresh = await callFreeTableAction(FREE_TABLE_ACTIONS.GET_MY_STATE);
      const racedSessionId = String(fresh.session?.sessionId || "");
      if (racedSessionId) {
        scheduleIgnoredSessionEnd(racedSessionId);
        return;
      }
      if (!fresh.pending?.request || attempt >= 3) return;
    } catch {
      if (attempt >= 3) return;
    }
    await waitForDelay((attempt + 1) * 500);
    return settlePendingAfterLeave(attempt + 1);
  }
}

async function cancelPendingRequest({ bestEffort = false } = {}) {
  const pendingRequest = state.pendingRequest;
  const requestId = String(pendingRequest?.id || "");
  if (!requestId) return false;
  state.ignoredRequestIds.add(requestId);
  state.pendingRequest = null;
  if (active) render();
  if (bestEffort) {
    trackPendingLeaveSettlement(settlePendingAfterLeave());
    return true;
  }
  try {
    const result = await callFreeTableAction(FREE_TABLE_ACTIONS.CANCEL_REQUEST);
    if (result.cancelled === true) {
      await refreshMyState();
      showToast("来訪札を取り下げました。");
    } else {
      await resolveCancelledRequestRace();
      showToast("来訪札の現在地を確認し、安全に閉じました。");
    }
  } catch (error) {
    const acceptanceRace = error?.code === "functions/failed-precondition"
      || error?.code === "failed-precondition";
    if (acceptanceRace) {
      await resolveCancelledRequestRace();
      showToast("入室との行き違いを安全に閉じました。");
    } else {
      state.ignoredRequestIds.delete(requestId);
      state.pendingRequest = pendingRequest;
      render();
      throw error;
    }
  }
  render();
  return true;
}

async function respondToRequest(requestId, accept) {
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    const data = await callFreeTableAction(FREE_TABLE_ACTIONS.RESPOND, { requestId, accept });
    const racedSessionId = String(data.sessionId || data.session?.sessionId || "");
    if (accept
        && racedSessionId
        && active
        && state.generation === lifecycle
        && state.sessionId === racedSessionId) return;
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration
        || state.sessionId) {
      if (accept && racedSessionId) scheduleIgnoredSessionEnd(racedSessionId);
      return;
    }
    state.requests = state.requests.filter((request) => request.id !== requestId);
    if (!accept) {
      showToast("今回は静かに見送りました。");
      render();
      return;
    }
    state.roomOpen = false;
    clearHostInviteUi();
    stopOpenHeartbeat();
    const sessionId = String(data.sessionId || data.session?.sessionId || "");
    if (!sessionId) throw new Error("自由卓の席を確認できませんでした。");
    await enterSession(sessionId, data.session);
  });
}

async function toggleBookmark(roomId, enabled) {
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    await callFreeTableAction(FREE_TABLE_ACTIONS.BOOKMARK, { publicRoomId: roomId, active: enabled });
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return;
    if (enabled) {
      state.bookmarks.add(roomId);
      const room = roomById(roomId);
      if (room && !state.returningRooms.some((entry) => entry.id === roomId)) {
        state.returningRooms.unshift({ ...room });
      }
    } else {
      state.bookmarks.delete(roomId);
      state.returningRooms = state.returningRooms.filter((room) => room.id !== roomId);
    }
    showToast(enabled ? "帰る場所にしおりを挟みました。" : "しおりを外しました。");
    render();
  });
}

async function blockMember(publicMemberId) {
  if (!publicMemberId) return;
  if (state.sessionId && publicMemberId === state.opponentPublicMemberId) {
    scheduleIgnoredSessionEnd(state.sessionId);
    finishSessionLocally("相手との接続を閉じました。", { deferHallMs: 500 });
    const lifecycle = state.generation;
    const sessionGeneration = state.sessionGeneration;
    callFreeTableAction(FREE_TABLE_ACTIONS.BLOCK, { publicMemberId })
      .then(() => refreshMyState(lifecycle, {
        expectedSessionGeneration: sessionGeneration,
        requireNoSession: true,
      }))
      .catch((error) => {
        if (active
            && state.generation === lifecycle
            && state.sessionGeneration === sessionGeneration
            && !state.sessionId) handleError(error);
      });
    return;
  }
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    await callFreeTableAction(FREE_TABLE_ACTIONS.BLOCK, { publicMemberId });
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return;
    state.requests = state.requests.filter((request) => request.publicMemberId !== publicMemberId);
    state.rooms = state.rooms.filter((room) => room.publicMemberId !== publicMemberId);
    showToast("この相手をブロックしました。");
    render();
  });
}

async function unblockMember(publicMemberId) {
  if (!publicMemberId) return;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    await callFreeTableAction(FREE_TABLE_ACTIONS.UNBLOCK, { publicMemberId });
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration) return;
    state.blocks = state.blocks.filter((block) => block.publicMemberId !== publicMemberId);
    showToast("ブロックを解除しました。");
    render();
  });
}

function resolveRole(session) {
  if (session.clientRole === "host" || session.clientRole === "visitor") return session.clientRole;
  if (session.hostUid === state.uid) return "host";
  if (session.visitorUid === state.uid) return "visitor";
  return state.role;
}

function resolveOpponentUid(session) {
  if (session.peerUid) return session.peerUid;
  const role = resolveRole(session);
  return role === "host" ? session.visitorUid : role === "visitor" ? session.hostUid : "";
}

function resolveOpponentPublicMemberId(session) {
  if (session.peerPublicMemberId) return session.peerPublicMemberId;
  const role = resolveRole(session);
  return role === "host" ? session.visitorPublicMemberId : role === "visitor" ? session.hostPublicMemberId : "";
}

function arrivalPresent(arrivals, role, uid) {
  return arrivals?.[role] === true
    || arrivals?.[role]?.arrived === true
    || arrivals?.[uid] === true
    || arrivals?.[uid]?.arrived === true;
}

function seatIsReady(session) {
  if (!session) return false;
  if (session.seatEstablished === true || state.seatEstablished === true) return true;
  return Boolean(session.hostUid
    && session.visitorUid
    && arrivalPresent(session.arrivals, "host", session.hostUid)
    && arrivalPresent(session.arrivals, "visitor", session.visitorUid));
}

function sessionContextIsCurrent(sessionId, sessionGeneration) {
  return Boolean(
    active
    && state.sessionId === sessionId
    && state.sessionGeneration === sessionGeneration
  );
}

function handleSessionTaskError(error, sessionId, sessionGeneration) {
  if (sessionContextIsCurrent(sessionId, sessionGeneration)) handleError(error);
}

function canonicalSessionErrorIsTerminal(error) {
  const code = String(error?.code || "")
    .toLowerCase()
    .replace(/^database\//, "")
    .replaceAll("_", "-");
  return code === "permission-denied" || code === "not-found";
}

function handleCanonicalSessionError(error, sessionId, sessionGeneration) {
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
  if (canonicalSessionErrorIsTerminal(error)) {
    finishSessionLocally("席の期限を迎えたため、静かに広間へ戻りました。");
    return;
  }
  handleError(error);
}

function clearSessionExpiryTimer() {
  if (state.sessionExpiryTimer) window.clearTimeout(state.sessionExpiryTimer);
  state.sessionExpiryTimer = null;
}

function armSessionExpiryTimer(
  sessionId = state.sessionId,
  sessionGeneration = state.sessionGeneration,
  expiresAt = Number(state.session?.expiresAt || 0),
) {
  clearSessionExpiryTimer();
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)
      || !Number.isFinite(expiresAt)
      || expiresAt <= 0) return;
  const serverNow = Date.now() + Number(state.serverTimeOffset || 0);
  const delay = Math.max(0, expiresAt - serverNow + 50);
  state.sessionExpiryTimer = window.setTimeout(() => {
    state.sessionExpiryTimer = null;
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    const currentExpiresAt = Number(state.session?.expiresAt || 0);
    const currentServerNow = Date.now() + Number(state.serverTimeOffset || 0);
    if (currentExpiresAt > 0 && currentExpiresAt <= currentServerNow) {
      finishSessionLocally("席の期限を迎えたため、静かに広間へ戻りました。");
      return;
    }
    armSessionExpiryTimer(sessionId, sessionGeneration, currentExpiresAt);
  }, delay);
}

async function enterSession(sessionId, initialSession = null) {
  if (!active || !sessionId || state.ignoredSessionIds.has(sessionId)) return;
  if (state.sessionId === sessionId && state.session) return;
  clearReportContext();
  clearUnsubscribers(state.hallUnsubscribers);
  stopHallRefresh();
  stopOpenHeartbeat();
  stopInvitePreviewRefresh();
  clearHostInviteUi();
  cleanupSession({ keepIdentity: false });
  state.sessionId = sessionId;
  const sessionGeneration = state.sessionGeneration;
  state.session = initialSession ? normalizeSession(initialSession, sessionId) : null;
  state.role = state.session ? resolveRole(state.session) : "";
  state.opponentUid = state.session ? resolveOpponentUid(state.session) : "";
  state.opponentPublicMemberId = state.session ? resolveOpponentPublicMemberId(state.session) : "";
  state.screen = "connecting";
  state.roomOpen = false;
  if (state.session) armSessionExpiryTimer(sessionId, sessionGeneration, state.session.expiresAt);
  render();

  const sessionRef = ref(database, pathFor("sessions", sessionId));
  addUnsubscriber(state.sessionUnsubscribers, onValue(sessionRef, (snapshot) => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    if (!snapshot.exists()) {
      if (!state.farewell) finishSessionLocally("この席は静かに閉じられました。");
      return;
    }
    const previousReason = state.session?.ending?.reason || "";
    state.session = normalizeSession(snapshot.val(), sessionId);
    state.role = resolveRole(state.session);
    state.opponentUid = resolveOpponentUid(state.session);
    state.opponentPublicMemberId = resolveOpponentPublicMemberId(state.session);
    armSessionExpiryTimer(sessionId, sessionGeneration, state.session.expiresAt);
    const ending = state.session.ending;
    if (ending.reason && ending.reason !== previousReason) {
      handleRemoteEnding(ending);
      return;
    }
    setupPeerConnection().catch((error) => {
      handleSessionTaskError(error, sessionId, sessionGeneration);
    });
    if (!ending.reason && ["connecting", "active"].includes(state.session.status) && !state.farewell) {
      state.screen = "session";
    }
    if (seatIsReady(state.session)) {
      state.seatEstablished = true;
      if (!state.farewell) state.screen = "session";
    }
    render();
  }, (error) => handleCanonicalSessionError(error, sessionId, sessionGeneration)));

  const chatRef = query(
    ref(database, pathFor("chat", sessionId)),
    orderByChild("createdAt"),
    limitToLast(FREE_TABLE_CHAT_LIMIT),
  );
  const handleChatError = (error) => {
    if (sessionContextIsCurrent(sessionId, sessionGeneration)) handleSessionAuxiliaryError(error);
  };
  addUnsubscriber(
    state.sessionUnsubscribers,
    onChildAdded(
      chatRef,
      (snapshot) => applyChatSnapshot(snapshot, sessionId, sessionGeneration),
      handleChatError,
    ),
  );
  addUnsubscriber(
    state.sessionUnsubscribers,
    onChildChanged(
      chatRef,
      (snapshot) => applyChatSnapshot(snapshot, sessionId, sessionGeneration),
      handleChatError,
    ),
  );
  addUnsubscriber(
    state.sessionUnsubscribers,
    onChildRemoved(
      chatRef,
      (snapshot) => removeChatSnapshot(snapshot, sessionId, sessionGeneration),
      handleChatError,
    ),
  );

  const signalsRef = query(
    ref(database, pathFor("signals", sessionId, state.uid)),
    orderByChild("createdAt"),
    limitToLast(FREE_TABLE_SIGNAL_LIMIT),
  );
  const handleSignalSnapshot = (snapshot) => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    queueDeferredSignal(snapshot);
    drainDeferredSignals().catch((error) => {
      handleSessionTaskError(error, sessionId, sessionGeneration);
    });
  };
  const handleSignalError = (error) => {
    if (sessionContextIsCurrent(sessionId, sessionGeneration)) handleSessionAuxiliaryError(error);
  };
  addUnsubscriber(
    state.sessionUnsubscribers,
    onChildAdded(signalsRef, handleSignalSnapshot, handleSignalError),
  );
  addUnsubscriber(
    state.sessionUnsubscribers,
    onChildChanged(signalsRef, handleSignalSnapshot, handleSignalError),
  );

  try {
    if (!state.session) {
      const snapshot = await get(sessionRef);
      if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
      if (snapshot.exists()) state.session = normalizeSession(snapshot.val(), sessionId);
    }
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    if (state.session) {
      state.role = resolveRole(state.session);
      state.opponentUid = resolveOpponentUid(state.session);
      state.opponentPublicMemberId = resolveOpponentPublicMemberId(state.session);
      armSessionExpiryTimer(sessionId, sessionGeneration, state.session.expiresAt);
      if (state.session.ending?.reason) {
        handleRemoteEnding(state.session.ending);
        return;
      }
      if (["ended", "closed"].includes(state.session.status)) {
        finishSessionLocally("この席は静かに閉じられました。");
        return;
      }
      state.screen = "session";
      await establishPresence(sessionId, sessionGeneration);
      if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
      await setupPeerConnection();
    }
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    render();
  } catch (error) {
    if (sessionContextIsCurrent(sessionId, sessionGeneration)) throw error;
  }
}

async function establishPresence(sessionId, sessionGeneration = state.sessionGeneration) {
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return false;
  const uid = state.uid;
  const presenceRef = ref(database, pathFor("presence", sessionId, uid));
  const writePresence = () => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration) || state.uid !== uid) return Promise.resolve();
    return set(presenceRef, {
      online: true,
      lastSeen: serverTimestamp(),
      expiresAt: currentRecordExpiry(45_000),
    });
  };
  const rearmPresence = async () => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration) || state.uid !== uid) return false;
    const disconnectHandle = onDisconnect(presenceRef);
    await disconnectHandle.remove();
    if (!sessionContextIsCurrent(sessionId, sessionGeneration) || state.uid !== uid) {
      return false;
    }
    state.disconnectHandles.splice(0, state.disconnectHandles.length, disconnectHandle);
    await writePresence();
    return sessionContextIsCurrent(sessionId, sessionGeneration);
  };
  await rearmPresence();
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return false;
  let wasConnected = false;
  addUnsubscriber(state.sessionUnsubscribers, onValue(
    ref(database, ".info/connected"),
    (snapshot) => {
      if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
      const connected = snapshot.val() === true;
      if (connected && !wasConnected) {
        state.presenceRearmChain = state.presenceRearmChain
          .catch(() => {})
          .then(rearmPresence)
          .catch(() => false);
      }
      wasConnected = connected;
    },
    () => {},
  ));
  if (state.presenceTimer) window.clearInterval(state.presenceTimer);
  state.presenceTimer = window.setInterval(() => {
    if (sessionContextIsCurrent(sessionId, sessionGeneration)) writePresence().catch(() => {});
  }, FREE_TABLE_HEARTBEAT_MS);
  return true;
}

async function loadIceConfiguration() {
  const loader = window.HariaiOnline?.getP2pIceConfiguration;
  if (typeof loader === "function") {
    try {
      const configuration = await loader();
      if (Array.isArray(configuration?.iceServers) && configuration.iceServers.length) {
        return { iceServers: configuration.iceServers };
      }
    } catch {
      console.warn("自由卓のTURN設定を取得できなかったため、STUN接続を試します。");
    }
  }
  return { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
}

function createNegotiationId() {
  return createFreeTableMediaTransferId().replace(/^ft_/, "neg_");
}

function peerContextIsCurrent(peer, sessionId, peerGeneration) {
  return Boolean(
    active
    && state.sessionId === sessionId
    && state.peer === peer
    && state.peerGeneration === peerGeneration
  );
}

function clearPeerRecoveryTimer() {
  if (state.peerRecoveryTimer) window.clearTimeout(state.peerRecoveryTimer);
  state.peerRecoveryTimer = null;
  state.peerRecoveryForced = false;
}

function peerNeedsRecovery(peer) {
  return ["disconnected", "failed"].includes(peer?.connectionState)
    || ["disconnected", "failed"].includes(peer?.iceConnectionState);
}

function resetPeerTransport({
  preserveDeferredSignals = true,
  preserveRecoveryAttempts = true,
  preservePendingIce = false,
} = {}) {
  clearPeerRecoveryTimer();
  state.mediaGeneration += 1;
  state.mediaReady = false;
  state.mediaProgress = 0;
  state.incomingMedia = null;
  if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
  state.incomingMediaTimer = null;
  state.incomingMediaChain = Promise.resolve();
  state.mediaSendChain = Promise.resolve();
  state.arrivalPending = false;
  if (state.arrivalRetryTimer) window.clearTimeout(state.arrivalRetryTimer);
  state.arrivalRetryTimer = null;
  if (state.farewellVerificationTimer) window.clearTimeout(state.farewellVerificationTimer);
  state.farewellVerificationTimer = null;
  state.pendingFarewellControl = null;
  const mediaChannel = state.mediaChannel;
  state.mediaChannel = null;
  if (mediaChannel) {
    mediaChannel.onopen = null;
    mediaChannel.onclose = null;
    mediaChannel.onerror = null;
    mediaChannel.onmessage = null;
    mediaChannel.close();
  }
  state.peerGeneration += 1;
  const peer = state.peer;
  state.peer = null;
  if (peer) {
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    peer.ondatachannel = null;
    peer.close();
  }
  state.negotiationId = "";
  state.negotiationCreatedAt = 0;
  state.negotiationOfferKey = "";
  state.hostOfferInFlight = false;
  if (!preservePendingIce) state.pendingIce = [];
  if (!preserveDeferredSignals) state.deferredSignals = [];
  if (!preserveRecoveryAttempts) state.peerRecoveryAttempts = 0;
}

async function createAndSendHostOffer(peer, {
  sessionId,
  peerGeneration,
  opponentUid,
  uid,
  iceRestart = false,
} = {}) {
  const contextIsCurrent = () => peerContextIsCurrent(peer, sessionId, peerGeneration);
  if (!contextIsCurrent() || !isHost() || state.hostOfferInFlight) return false;
  state.hostOfferInFlight = true;
  const negotiationId = createNegotiationId();
  state.negotiationId = negotiationId;
  state.negotiationCreatedAt = Date.now() + Number(state.serverTimeOffset || 0);
  state.negotiationOfferKey = "";
  state.pendingIce = [];
  try {
    if (iceRestart && typeof peer.restartIce === "function") peer.restartIce();
    const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (!contextIsCurrent() || state.negotiationId !== negotiationId) return false;
    await peer.setLocalDescription(offer);
    if (!contextIsCurrent() || state.negotiationId !== negotiationId) return false;
    await sendSignal("offer", { type: offer.type, sdp: offer.sdp }, {
      sessionId,
      opponentUid,
      uid,
      negotiationId,
    });
    return true;
  } finally {
    if (contextIsCurrent()) state.hostOfferInFlight = false;
  }
}

function schedulePeerRecovery(peer, {
  sessionId,
  peerGeneration,
  immediate = false,
  force = false,
  minimumDelayMs = 0,
} = {}) {
  if (!peerContextIsCurrent(peer, sessionId, peerGeneration)
      || !isHost()
      || !isLiveSession()
      || state.farewell) return;
  if (state.peerRecoveryTimer) {
    if (!immediate && (!force || state.peerRecoveryForced)) return;
    window.clearTimeout(state.peerRecoveryTimer);
    state.peerRecoveryTimer = null;
  }
  const attempt = state.peerRecoveryAttempts;
  const sessionGeneration = state.sessionGeneration;
  const recoveryDelay = FREE_TABLE_PEER_RECOVERY_DELAYS_MS[attempt]
    ?? FREE_TABLE_PEER_RECOVERY_STEADY_MS;
  const delay = immediate ? 0 : Math.max(recoveryDelay, Number(minimumDelayMs) || 0);
  state.peerRecoveryForced = force;
  state.peerRecoveryTimer = window.setTimeout(async () => {
    state.peerRecoveryTimer = null;
    state.peerRecoveryForced = false;
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)
        || !peerContextIsCurrent(peer, sessionId, peerGeneration)
        || (!force && !peerNeedsRecovery(peer))) return;
    state.peerRecoveryAttempts = Math.min(
      attempt + 1,
      FREE_TABLE_PEER_RECOVERY_DELAYS_MS.length,
    );
    resetPeerTransport({
      preserveDeferredSignals: true,
      preserveRecoveryAttempts: true,
    });
    try {
      await setupPeerConnection();
    } catch (error) {
      if (sessionContextIsCurrent(sessionId, sessionGeneration) && !state.peer) {
        console.warn("自由卓のP2P再接続を試行できませんでした。", error);
      }
    }
  }, delay);
}

async function setupPeerConnection() {
  if (!active || !state.sessionId || !state.session || !state.opponentUid || state.peer) return;
  if (typeof RTCPeerConnection !== "function") {
    state.error = "このブラウザではP2Pメディアを利用できません。文字での貼り合いは続けられます。";
    render();
    return;
  }
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const opponentUid = state.opponentUid;
  const uid = state.uid;
  const peerGeneration = ++state.peerGeneration;
  const peer = new RTCPeerConnection(await loadIceConfiguration());
  if (!sessionContextIsCurrent(sessionId, sessionGeneration)
      || state.peerGeneration !== peerGeneration
      || state.opponentUid !== opponentUid
      || state.uid !== uid) {
    peer.close();
    return;
  }
  state.peer = peer;
  const contextIsCurrent = () => (
    peerContextIsCurrent(peer, sessionId, peerGeneration)
    && state.sessionGeneration === sessionGeneration
    && state.opponentUid === opponentUid
    && state.uid === uid
  );
  peer.onicecandidate = (event) => {
    const negotiationId = state.negotiationId;
    if (event.candidate
        && contextIsCurrent()
        && FREE_TABLE_NEGOTIATION_ID_PATTERN.test(negotiationId)) {
      sendSignal("candidate", event.candidate.toJSON(), {
        sessionId,
        opponentUid,
        uid,
        negotiationId,
      }).catch((error) => {
        if (contextIsCurrent()) handleSessionAuxiliaryError(error);
      });
    }
  };
  const handleConnectionState = () => {
    if (!contextIsCurrent()) return;
    if (peer.connectionState === "connected" || peer.iceConnectionState === "connected") {
      if (!state.peerRecoveryForced) {
        clearPeerRecoveryTimer();
        state.peerRecoveryAttempts = 0;
      }
    } else if (peerNeedsRecovery(peer)) {
      state.mediaReady = false;
      const failed = peer.connectionState === "failed" || peer.iceConnectionState === "failed";
      schedulePeerRecovery(peer, {
        sessionId,
        peerGeneration,
        opponentUid,
        uid,
        immediate: failed,
        force: failed,
      });
      render();
    }
  };
  peer.onconnectionstatechange = handleConnectionState;
  peer.oniceconnectionstatechange = handleConnectionState;
  peer.ondatachannel = (event) => {
    if (!contextIsCurrent()) return;
    if (event.channel?.label !== FREE_TABLE_MEDIA_CHANNEL_LABEL) {
      event.channel?.close();
      return;
    }
    configureMediaDataChannel(event.channel, {
      sessionId,
      sessionGeneration,
      peer,
      peerGeneration,
    });
  };
  drainDeferredSignals().catch((error) => {
    if (contextIsCurrent()) handleSessionAuxiliaryError(error);
  });

  if (isHost()) {
    configureMediaDataChannel(
      peer.createDataChannel(FREE_TABLE_MEDIA_CHANNEL_LABEL, { ordered: true }),
      {
        sessionId,
        sessionGeneration,
        peer,
        peerGeneration,
      },
    );
    try {
      const offerSent = await createAndSendHostOffer(peer, {
        sessionId,
        peerGeneration,
        opponentUid,
        uid,
      });
      if (offerSent && contextIsCurrent() && !state.mediaReady) {
        schedulePeerRecovery(peer, {
          sessionId,
          peerGeneration,
          force: true,
          minimumDelayMs: FREE_TABLE_PEER_OFFER_WATCHDOG_MS,
        });
      }
    } catch (error) {
      if (contextIsCurrent()) {
        schedulePeerRecovery(peer, {
          sessionId,
          peerGeneration,
          force: true,
        });
      }
      throw error;
    }
  }
}

async function sendSignal(type, payload, {
  sessionId = state.sessionId,
  opponentUid = state.opponentUid,
  uid = state.uid,
  negotiationId = state.negotiationId,
} = {}) {
  if (!sessionId || !opponentUid || !uid) throw new Error("自由卓の接続相手を確認できません。");
  if (!FREE_TABLE_NEGOTIATION_ID_PATTERN.test(String(negotiationId || ""))) {
    throw new Error("自由卓の接続世代を確認できません。");
  }
  const encodedPayload = JSON.stringify({
    protocolVersion: FREE_TABLE_SIGNAL_PROTOCOL_VERSION,
    negotiationId,
    ...(type === "candidate" ? { candidate: payload } : { description: payload }),
  });
  if (encodedPayload.length > 30_000) throw new Error("自由卓の接続情報が長すぎます。");
  const signalId = nextSignalSlotId(sessionId, opponentUid);
  if (!FREE_TABLE_SIGNAL_SLOT_ID_PATTERN.test(signalId)) {
    throw new Error("自由卓の接続枠を確認できません。");
  }
  const signalRef = ref(database, pathFor("signals", sessionId, opponentUid, signalId));
  await set(signalRef, {
    fromUid: uid,
    toUid: opponentUid,
    type,
    payload: encodedPayload,
    createdAt: serverTimestamp(),
    expiresAt: currentRecordExpiry(90_000),
  });
}

async function handleSignal(rawSignal, {
  peer = state.peer,
  sessionId = state.sessionId,
  opponentUid = state.opponentUid,
  uid = state.uid,
  role = state.role,
  peerGeneration = state.peerGeneration,
  signalKey = "",
} = {}) {
  const signal = valueFromSnapshot(rawSignal);
  const contextIsCurrent = () => active
    && state.sessionId === sessionId
    && state.peer === peer
    && state.peerGeneration === peerGeneration
    && state.opponentUid === opponentUid
    && state.uid === uid
    && state.role === role;
  if (!peer || !contextIsCurrent()) return false;
  if (signal.fromUid !== opponentUid
      || signal.toUid !== uid
      || !["offer", "answer", "candidate"].includes(signal.type)
      || typeof signal.payload !== "string"
      || signal.payload.length > 30_000) return true;
  const signalCreatedAt = Number(signal.createdAt);
  const signalExpiresAt = Number(signal.expiresAt);
  const serverNow = Date.now() + Number(state.serverTimeOffset || 0);
  if (!Number.isFinite(signalCreatedAt)
      || !Number.isFinite(signalExpiresAt)
      || signalCreatedAt <= 0
      || signalCreatedAt < serverNow - FREE_TABLE_SIGNAL_MAX_AGE_MS
      || signalCreatedAt > serverNow + 15_000
      || signalExpiresAt <= serverNow
      || signalExpiresAt > signalCreatedAt + FREE_TABLE_SIGNAL_TTL_MS) return true;
  let payload;
  try {
    payload = JSON.parse(signal.payload);
  } catch {
    return true;
  }
  const negotiationId = String(payload?.negotiationId || "");
  if (Number(payload?.protocolVersion) !== FREE_TABLE_SIGNAL_PROTOCOL_VERSION
      || !FREE_TABLE_NEGOTIATION_ID_PATTERN.test(negotiationId)) return true;
  if (signal.type === "offer") {
    const description = valueFromSnapshot(payload.description);
    if (role !== "visitor"
        || description.type !== "offer"
        || typeof description.sdp !== "string"
        || !description.sdp
        || description.sdp.length > 25_000) return true;
    const olderThanCurrent = signalCreatedAt < state.negotiationCreatedAt
      || (signalCreatedAt === state.negotiationCreatedAt
        && state.negotiationOfferKey
        && String(signalKey || "") <= state.negotiationOfferKey);
    if (olderThanCurrent || negotiationId === state.negotiationId) return true;
    if (state.negotiationId) return { replacePeerFor: negotiationId };
    state.negotiationId = negotiationId;
    state.negotiationCreatedAt = signalCreatedAt;
    state.negotiationOfferKey = String(signalKey || "");
    await peer.setRemoteDescription({ type: description.type, sdp: description.sdp });
    if (!contextIsCurrent()) return true;
    await flushPendingIce(peer, sessionId, negotiationId, peerGeneration);
    const answer = await peer.createAnswer();
    if (!contextIsCurrent() || state.negotiationId !== negotiationId) return true;
    await peer.setLocalDescription(answer);
    if (!contextIsCurrent() || state.negotiationId !== negotiationId) return true;
    await sendSignal("answer", { type: answer.type, sdp: answer.sdp }, {
      sessionId,
      opponentUid,
      uid,
      negotiationId,
    });
  } else if (signal.type === "answer") {
    const description = valueFromSnapshot(payload.description);
    if (role !== "host"
        || negotiationId !== state.negotiationId
        || description.type !== "answer"
        || typeof description.sdp !== "string"
        || !description.sdp
        || description.sdp.length > 25_000
        || peer.signalingState !== "have-local-offer") return true;
    await peer.setRemoteDescription({ type: description.type, sdp: description.sdp });
    if (!contextIsCurrent()) return true;
    await flushPendingIce(peer, sessionId, negotiationId, peerGeneration);
  } else {
    const candidateValue = valueFromSnapshot(payload.candidate);
    const candidate = {
      candidate: typeof candidateValue.candidate === "string" ? candidateValue.candidate : "",
      sdpMid: candidateValue.sdpMid == null ? null : String(candidateValue.sdpMid),
      sdpMLineIndex: candidateValue.sdpMLineIndex == null
        ? null
        : Number(candidateValue.sdpMLineIndex),
      usernameFragment: candidateValue.usernameFragment == null
        ? null
        : String(candidateValue.usernameFragment),
    };
    if (!candidate.candidate
        || candidate.candidate.length > 4_096
        || (candidate.sdpMid != null && candidate.sdpMid.length > 128)
        || (candidate.sdpMLineIndex != null
          && (!Number.isInteger(candidate.sdpMLineIndex)
            || candidate.sdpMLineIndex < 0
            || candidate.sdpMLineIndex > 64))
        || (candidate.usernameFragment != null && candidate.usernameFragment.length > 256)) return true;
    if (negotiationId === state.negotiationId && peer.remoteDescription) {
      await peer.addIceCandidate(candidate);
      return true;
    }
    if (negotiationId !== state.negotiationId && role !== "visitor") return true;
    if (state.pendingIce.length >= FREE_TABLE_SIGNAL_LIMIT) state.pendingIce.shift();
    state.pendingIce.push({ negotiationId, candidate, createdAt: signalCreatedAt });
  }
  return true;
}

async function drainDeferredSignals() {
  if (state.signalDraining || !state.peer || !state.deferredSignals.length) return;
  const sessionId = state.sessionId;
  const peer = state.peer;
  const peerGeneration = state.peerGeneration;
  const opponentUid = state.opponentUid;
  const uid = state.uid;
  const role = state.role;
  state.signalDraining = true;
  try {
    while (active
        && state.sessionId === sessionId
        && state.peer === peer
        && state.peerGeneration === peerGeneration
        && state.opponentUid === opponentUid
        && state.uid === uid
        && state.role === role
        && state.deferredSignals.length) {
      const snapshot = state.deferredSignals.shift();
      try {
        const consumed = await handleSignal(snapshot.val(), {
          peer,
          sessionId,
          peerGeneration,
          opponentUid,
          uid,
          role,
          signalKey: snapshot.key,
        });
        if (consumed?.replacePeerFor) {
          state.deferredSignals.unshift(snapshot);
          state.signalDraining = false;
          resetPeerTransport({
            preserveDeferredSignals: true,
            preserveRecoveryAttempts: true,
            preservePendingIce: true,
          });
          try {
            await setupPeerConnection();
          } catch (error) {
            console.warn("自由卓のP2P接続を作り直せませんでした。", error);
          }
          return;
        }
        if (consumed !== true && peerContextIsCurrent(peer, sessionId, peerGeneration)) {
          queueDeferredSignal(snapshot);
        }
      } catch {
        console.warn("自由卓の接続信号を破棄しました。");
      }
    }
  } finally {
    if (state.sessionId === sessionId
        && state.peer === peer
        && state.peerGeneration === peerGeneration) {
      state.signalDraining = false;
      if (active && state.deferredSignals.length) {
        queueMicrotask(() => drainDeferredSignals().catch(handleError));
      }
    }
  }
}

async function flushPendingIce(
  peer = state.peer,
  sessionId = state.sessionId,
  negotiationId = state.negotiationId,
  peerGeneration = state.peerGeneration,
) {
  const queued = state.pendingIce.splice(0);
  const retained = [];
  for (const entry of queued) {
    if (!peerContextIsCurrent(peer, sessionId, peerGeneration)
        || state.negotiationId !== negotiationId
        || !peer?.remoteDescription) return;
    if (entry.negotiationId !== negotiationId) {
      retained.push(entry);
      continue;
    }
    await peer.addIceCandidate(entry.candidate).catch(() => {});
  }
  if (peerContextIsCurrent(peer, sessionId, peerGeneration)
      && state.negotiationId === negotiationId) {
    state.pendingIce = [...retained, ...state.pendingIce].slice(-FREE_TABLE_SIGNAL_LIMIT);
  }
}

function configureMediaDataChannel(channel, {
  sessionId = state.sessionId,
  sessionGeneration = state.sessionGeneration,
  peer = state.peer,
  peerGeneration = state.peerGeneration,
} = {}) {
  if (!channel || channel.label !== FREE_TABLE_MEDIA_CHANNEL_LABEL) {
    throw new Error("自由卓専用ではないメディア経路は利用できません。");
  }
  const previousChannel = state.mediaChannel;
  if (previousChannel && previousChannel !== channel) {
    state.mediaGeneration += 1;
    previousChannel.onopen = null;
    previousChannel.onclose = null;
    previousChannel.onerror = null;
    previousChannel.onmessage = null;
    previousChannel.close();
    state.incomingMedia = null;
    if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
    state.incomingMediaTimer = null;
    state.incomingMediaChain = Promise.resolve();
    state.mediaSendChain = Promise.resolve();
  }
  state.mediaChannel = channel;
  const mediaGeneration = state.mediaGeneration;
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && state.mediaChannel === channel
    && state.mediaGeneration === mediaGeneration
    && (!peer || peerContextIsCurrent(peer, sessionId, peerGeneration))
  );
  const handleContextError = (error) => {
    if (contextIsCurrent()) handleSessionAuxiliaryError(error);
  };
  channel.binaryType = "arraybuffer";
  channel.onopen = () => {
    if (!contextIsCurrent()) return;
    state.mediaReady = true;
    clearPeerRecoveryTimer();
    state.peerRecoveryAttempts = 0;
    confirmArrivalAfterP2p(channel).catch(handleContextError);
    render();
  };
  channel.onclose = () => {
    if (!contextIsCurrent()) return;
    state.mediaGeneration += 1;
    state.mediaReady = false;
    state.incomingMedia = null;
    if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
    state.incomingMediaTimer = null;
    state.incomingMediaChain = Promise.resolve();
    state.mediaSendChain = Promise.resolve();
    state.arrivalPending = false;
    if (state.arrivalRetryTimer) window.clearTimeout(state.arrivalRetryTimer);
    state.arrivalRetryTimer = null;
    if (isHost() && peerContextIsCurrent(peer, sessionId, peerGeneration)) {
      schedulePeerRecovery(peer, {
        sessionId,
        peerGeneration,
        immediate: true,
        force: true,
      });
    }
    render();
  };
  channel.onerror = () => {
    if (contextIsCurrent()) {
      state.mediaReady = false;
      showToast("メディアのP2P経路で通信エラーが発生しました。文字の席は続けられます。");
      render();
    }
  };
  channel.onmessage = (event) => {
    if (!contextIsCurrent()) return;
    state.incomingMediaChain = state.incomingMediaChain
      .catch(() => {})
      .then(() => {
        if (!contextIsCurrent()) return;
        return handleMediaChannelMessage(event.data, channel, {
          sessionId,
          sessionGeneration,
          mediaGeneration,
        });
      })
      .catch((error) => {
        if (!contextIsCurrent()) return;
        state.incomingMedia = null;
        if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
        state.incomingMediaTimer = null;
        handleContextError(error);
      });
  };
  if (channel.readyState === "open" && contextIsCurrent()) {
    state.mediaReady = true;
    confirmArrivalAfterP2p(channel).catch(handleContextError);
    render();
  }
}

function arrivalFailureIsTerminal(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return [
    "failed-precondition",
    "not-found",
    "invalid-argument",
  ].includes(code);
}

async function confirmArrivalAfterP2p(channel, attempt = 0) {
  if (!active
      || channel !== state.mediaChannel
      || channel.readyState !== "open"
      || !state.sessionId
      || !isLiveSession()
      || state.arrived
      || state.arrivalPending) return;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const mediaGeneration = state.mediaGeneration;
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && mediaGeneration === state.mediaGeneration
    && channel === state.mediaChannel
    && channel.readyState === "open"
  );
  state.arrivalPending = true;
  try {
    const result = await callFreeTableAction(FREE_TABLE_ACTIONS.ARRIVE, { sessionId });
    if (!contextIsCurrent()) return;
    state.arrived = true;
    state.seatEstablished = state.seatEstablished
      || result.established === true
      || result.seatEstablished === true;
    if (result.session) {
      const projection = normalizeSession(result.session, sessionId);
      const internal = state.session || {};
      state.session = {
        ...internal,
        ...projection,
        hostUid: internal.hostUid || projection.hostUid,
        visitorUid: internal.visitorUid || projection.visitorUid,
        hostPublicMemberId: internal.hostPublicMemberId || projection.hostPublicMemberId,
        visitorPublicMemberId: internal.visitorPublicMemberId || projection.visitorPublicMemberId,
        peerUid: internal.peerUid || projection.peerUid,
        peerPublicMemberId: internal.peerPublicMemberId || projection.peerPublicMemberId,
        seatEstablished: state.seatEstablished || projection.seatEstablished,
      };
      state.role = resolveRole(state.session);
      state.opponentUid = resolveOpponentUid(state.session);
      state.opponentPublicMemberId = resolveOpponentPublicMemberId(state.session);
    }
    if (seatIsReady(state.session)) {
      state.seatEstablished = true;
      state.screen = "session";
    }
    render();
  } catch (error) {
    if (!arrivalFailureIsTerminal(error)
        && contextIsCurrent()
        && isLiveSession()) {
      if (state.arrivalRetryTimer) window.clearTimeout(state.arrivalRetryTimer);
      const retryIndex = Math.min(attempt, FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS.length - 1);
      state.arrivalRetryTimer = window.setTimeout(() => {
        if (!contextIsCurrent()) return;
        state.arrivalRetryTimer = null;
        confirmArrivalAfterP2p(channel, Math.min(
          attempt + 1,
          FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS.length - 1,
        )).catch((retryError) => {
          if (contextIsCurrent()) handleSessionAuxiliaryError(retryError);
        });
      }, FREE_TABLE_ARRIVAL_RETRY_DELAYS_MS[retryIndex]);
      return;
    }
    throw error;
  } finally {
    if (contextIsCurrent()) state.arrivalPending = false;
  }
}

async function handleMediaChannelMessage(data, channel, {
  sessionId = state.sessionId,
  sessionGeneration = state.sessionGeneration,
  mediaGeneration = state.mediaGeneration,
} = {}) {
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && channel === state.mediaChannel
    && mediaGeneration === state.mediaGeneration
  );
  if (!contextIsCurrent()) return;
  if (typeof data !== "string") {
    if (!state.incomingMedia) return;
    const transfer = state.incomingMedia;
    await appendIncomingFreeTableMediaChunk(transfer, data);
    return;
  }
  if (data.length > FREE_TABLE_CONTROL_MAX_CHARS) throw new Error("自由卓のP2Pメッセージが長すぎます。");
  const message = JSON.parse(data);
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("自由卓のP2Pメッセージが不正です。");
  if (message.type === "free-table-media-start") {
    if (!sessionAllowsMediaKind(message.kind)) {
      throw new Error("この部屋では、そのメディアを受け取れません。");
    }
    state.incomingMedia = createIncomingFreeTableMediaTransfer(message, {
      currentTransfer: state.incomingMedia,
      expectedOwnerUid: state.opponentUid,
      expectedSessionId: sessionId,
    });
    const transfer = state.incomingMedia;
    if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
    state.incomingMediaTimer = window.setTimeout(() => {
      if (contextIsCurrent() && state.incomingMedia === transfer) {
        state.incomingMedia = null;
        state.incomingMediaTimer = null;
      }
    }, FREE_TABLE_INCOMING_MEDIA_TIMEOUT_MS);
    return;
  }
  if (message.type === "free-table-media-cancel") {
    if (isFreeTableMediaCancelFor(state.incomingMedia, message)) {
      state.incomingMedia = null;
      if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
      state.incomingMediaTimer = null;
    }
    return;
  }
  if (message.type === "free-table-media-end") {
    const status = freeTableMediaEndStatus(state.incomingMedia, message);
    if (status === "orphan") return;
    const transfer = state.incomingMedia;
    state.incomingMedia = null;
    if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
    state.incomingMediaTimer = null;
    const resource = await finishIncomingFreeTableMediaTransfer(transfer, message);
    if (!resource || !contextIsCurrent() || resource.sessionId !== sessionId) {
      releaseFreeTableMediaResource(resource);
      return;
    }
    if (resource.kind === "video") {
      let actualDuration;
      try {
        actualDuration = await mediaDuration(resource.blob, "video");
      } catch (error) {
        releaseFreeTableMediaResource(resource);
        throw error;
      }
      if (!contextIsCurrent()) {
        releaseFreeTableMediaResource(resource);
        return;
      }
      if (actualDuration > FREE_TABLE_VIDEO_MAX_SECONDS + 0.1
          || Math.abs(actualDuration - resource.duration) > 0.6) {
        releaseFreeTableMediaResource(resource);
        throw new Error("動画の申告時間と実際の長さが一致しません。");
      }
      resource.duration = actualDuration;
    }
    if (!contextIsCurrent()) {
      releaseFreeTableMediaResource(resource);
      return;
    }
    state.mediaMessages.set(resource.transferId, {
      id: resource.transferId,
      type: "media",
      kind: resource.kind,
      resource,
      authorUid: resource.ownerUid,
      authorRole: otherRole(),
      createdAt: resource.createdAt,
    });
    pruneRetainedMedia();
    render();
    return;
  }
  if (message.type === "free-table-farewell") {
    if (!isHost() || message.sessionId !== sessionId || message.ownerUid !== state.opponentUid) return;
    verifyRemoteFarewell(message, channel, {
      sessionId,
      sessionGeneration,
      mediaGeneration,
    }).catch((error) => {
      if (contextIsCurrent()) handleSessionAuxiliaryError(error);
    });
    return;
  }
  if (message.type === "free-table-farewell-response") {
    if (!isVisitor()
        || !state.farewell
        || message.sessionId !== sessionId
        || message.ownerUid !== state.opponentUid) return;
    state.farewell = {
      ...(state.farewell || {}),
      responseReceived: true,
      responseMessage: boundedText(message.message, 100) || "部屋の灯りに見送られました。",
    };
    render();
  }
}

function currentRecordExpiry(maximumLifetimeMs) {
  const expiresAt = Number(state.session?.expiresAt || 0);
  const now = Date.now() + Number(state.serverTimeOffset || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("自由卓の席の期限を確認できません。");
  return Math.min(expiresAt, now + maximumLifetimeMs);
}

async function handleSendChat(event) {
  event.preventDefault();
  const text = boundedText(new FormData(event.currentTarget).get("text"), FREE_TABLE_TEXT_MAX_LENGTH);
  if (!text || !state.sessionId || !isLiveSession()) return;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const uid = state.uid;
  const role = state.role;
  state.chatDraft = text;
  await runBusy(async () => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    const slot = await findWritableChatSlot({
      sessionId,
      sessionGeneration,
      uid,
      role,
    });
    if (!slot || !sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    const { messageId, messageRef } = slot;
    const previousEntry = state.chatMessages.get(messageId);
    const pendingToken = Symbol(messageId);
    const optimisticEntry = {
      id: messageId,
      type: "text",
      text,
      authorUid: uid,
      authorRole: role,
      createdAt: Date.now() + Number(state.serverTimeOffset || 0),
      pendingToken,
    };
    state.pendingChatMutations.set(messageId, {
      token: pendingToken,
      previousEntry,
      authorUid: uid,
      authorRole: role,
      text,
    });
    state.chatMessages.set(messageId, optimisticEntry);
    pruneChatMessages();
    state.chatDraft = "";
    render();
    try {
      await set(messageRef, {
        authorUid: uid,
        authorRole: role,
        type: "text",
        text,
        createdAt: serverTimestamp(),
        expiresAt: currentRecordExpiry(29 * 60 * 1000),
      });
      if (sessionContextIsCurrent(sessionId, sessionGeneration)
          && state.pendingChatMutations.get(messageId)?.token === pendingToken) {
        state.pendingChatMutations.delete(messageId);
        const current = state.chatMessages.get(messageId);
        if (current?.pendingToken === pendingToken) {
          const settledEntry = { ...current };
          delete settledEntry.pendingToken;
          state.chatMessages.set(messageId, settledEntry);
        }
      }
    } catch (error) {
      if (sessionContextIsCurrent(sessionId, sessionGeneration)
          && state.pendingChatMutations.get(messageId)?.token === pendingToken) {
        const current = state.chatMessages.get(messageId);
        if (current?.pendingToken === pendingToken) {
          if (previousEntry) state.chatMessages.set(messageId, previousEntry);
          else state.chatMessages.delete(messageId);
        }
        state.pendingChatMutations.delete(messageId);
        state.chatDraft = text;
        render();
      }
      throw error;
    }
  });
}

function mediaDuration(blob, kind) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (error, duration = 0) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration);
    };
    const timeoutId = window.setTimeout(() => finish(new Error("メディアの長さを確認できませんでした。")), 8_000);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = Number(element.duration || 0);
      if (!Number.isFinite(duration) || duration <= 0) finish(new Error("メディアの長さを確認できませんでした。"));
      else finish(null, duration);
    };
    element.onerror = () => finish(new Error("メディアを読み込めませんでした。"));
    element.src = url;
  });
}

async function prepareMediaAsset(file, kind) {
  if (!file) throw new Error("貼るファイルを選択してください。");
  if (kind === "image") {
    if (typeof shared()?.processImageFile === "function") {
      const item = await shared().processImageFile(file, 0, {
        maxSide: FREE_TABLE_IMAGE_MAX_SIDE,
        quality: 0.82,
      });
      if (item?.url) URL.revokeObjectURL(item.url);
      return { kind: "image", blob: item.blob, mime: item.blob?.type || "image/webp", duration: 0 };
    }
    return { kind: "image", blob: file, mime: file.type, duration: 0 };
  }
  if (kind === "audio") {
    if (typeof shared()?.processGameAudioFile === "function") {
      const output = await shared().processGameAudioFile(file, {
        maxSeconds: FREE_TABLE_AUDIO_MAX_SECONDS,
        audioName: file.name || "10秒音声",
      });
      if (output.audioUrl) URL.revokeObjectURL(output.audioUrl);
      return {
        kind: "audio",
        blob: output.audioBlob,
        mime: "audio/wav",
        duration: output.audioDuration,
      };
    }
    const duration = await mediaDuration(file, "audio");
    return { kind: "audio", blob: file, mime: file.type, duration };
  }
  if (file.size > FREE_TABLE_VIDEO_MAX_BYTES) throw new Error("動画は約2MB以内にしてください。");
  const duration = await mediaDuration(file, "video");
  if (duration > FREE_TABLE_VIDEO_MAX_SECONDS + 0.1) throw new Error("動画は10秒以内にしてください。");
  return { kind: "video", blob: file, mime: file.type, duration };
}

async function handleMediaFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const kind = String(input.dataset.mediaKind || "");
  if (!sessionAllowsMediaKind(kind)) {
    showToast("この席では、そのメディアを使わない約束です。");
    return;
  }
  const generation = state.mediaGeneration;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const channel = state.mediaChannel;
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && generation === state.mediaGeneration
    && channel === state.mediaChannel
  );
  state.mediaSendChain = state.mediaSendChain
    .catch(() => {})
    .then(async () => {
      if (!contextIsCurrent() || !state.mediaReady || channel?.readyState !== "open") {
        throw new Error("P2P接続ができてからメディアを貼ってください。");
      }
      const asset = await prepareMediaAsset(file, kind);
      if (!contextIsCurrent() || !isLiveSession()) return;
      if (!sessionAllowsMediaKind(kind)) throw new Error("この席では、そのメディアを使わない約束です。");
      const transferId = createFreeTableMediaTransferId();
      const metadata = {
        transferId,
        ownerUid: state.uid,
        sessionId,
        createdAt: Date.now(),
      };
      const resource = await createLocalFreeTableMediaResource(asset, metadata);
      try {
        await sendFreeTableMedia(channel, asset, metadata, {
          isActive: () => contextIsCurrent()
            && isLiveSession()
            && sessionAllowsMediaKind(kind)
            && channel.readyState === "open",
          onProgress: (progress) => {
            if (!contextIsCurrent()) return;
            state.mediaProgress = progress;
            render();
          },
        });
      } catch (error) {
        releaseFreeTableMediaResource(resource);
        throw error;
      } finally {
        if (contextIsCurrent()) state.mediaProgress = 0;
      }
      if (!contextIsCurrent() || !isLiveSession()) {
        releaseFreeTableMediaResource(resource);
        return;
      }
      state.mediaMessages.set(transferId, {
        id: transferId,
        type: "media",
        kind,
        resource,
        authorUid: state.uid,
        authorRole: state.role,
        mine: true,
        createdAt: resource.createdAt,
      });
      pruneRetainedMedia();
      render();
    })
    .catch((error) => {
      if (contextIsCurrent()) handleSessionAuxiliaryError(error);
    });
}

function departureLineFromForm(form) {
  const data = new FormData(form);
  const preset = String(data.get("departurePreset") || "0");
  if (preset !== "custom") return FREE_TABLE_DEPARTURE_PRESETS[Number(preset)] || FREE_TABLE_DEPARTURE_PRESETS[0];
  let custom = boundedText(data.get("departureCustom"), 80);
  if (!custom) return "いってきます";
  if (custom.endsWith("いってきます")) return Array.from(custom).slice(0, 80).join("");
  const greeting = "。いってきます";
  const prefix = Array.from(custom.replace(/[。.!！?？\s]+$/u, ""))
    .slice(0, 80 - Array.from(greeting).length)
    .join("");
  return `${prefix}${greeting}`;
}

function sendoffLineFromForm(form) {
  const data = new FormData(form);
  const preset = String(data.get("sendoffPreset") || "0");
  if (preset === "silent") return "";
  if (preset !== "custom") return FREE_TABLE_SENDOFF_PRESETS[Number(preset)] || FREE_TABLE_SENDOFF_PRESETS[0];
  const custom = boundedText(data.get("sendoffCustom"), 80);
  if (!custom) return "いってらっしゃい";
  if (custom.includes("いってらっしゃい")) return Array.from(custom).slice(0, 80).join("");
  const greeting = "いってらっしゃい。";
  const suffix = Array.from(custom).slice(0, 80 - Array.from(greeting).length).join("");
  return `${greeting}${suffix}`;
}

function clearFarewellVerification() {
  if (state.farewellVerificationTimer) window.clearTimeout(state.farewellVerificationTimer);
  state.farewellVerificationTimer = null;
  state.pendingFarewellControl = null;
}

async function verifyRemoteFarewell(message, channel, {
  sessionId = state.sessionId,
  sessionGeneration = state.sessionGeneration,
  mediaGeneration = state.mediaGeneration,
  attempt = 0,
  control = null,
} = {}) {
  const verification = control || {
    channel,
    sessionId,
    sessionGeneration,
    mediaGeneration,
    departureMessage: boundedText(message?.message, 100) || "いってきます",
  };
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && state.mediaGeneration === mediaGeneration
    && state.mediaChannel === channel
    && state.pendingFarewellControl === verification
    && isHost()
  );
  if (control == null) {
    if (state.pendingFarewellControl) return;
    state.pendingFarewellControl = verification;
  }
  if (!contextIsCurrent()) return;

  let confirmed = false;
  try {
    const snapshot = await get(ref(database, pathFor("sessions", sessionId)));
    if (!contextIsCurrent()) return;
    if (snapshot.exists()) {
      const freshSession = normalizeSession(snapshot.val(), sessionId);
      confirmed = freshSession.status === "ended"
        && freshSession.ending.reason === "departure";
      if (confirmed && freshSession.ending.message) {
        verification.departureMessage = freshSession.ending.message;
      }
    }
  } catch {
    if (!contextIsCurrent()) return;
  }

  if (confirmed) {
    clearFarewellVerification();
    beginFarewell({
      departureMessage: verification.departureMessage,
      expiresAt: Date.now() + FREE_TABLE_FAREWELL_MS,
    });
    return;
  }

  const nextAttempt = attempt + 1;
  if (nextAttempt >= FREE_TABLE_FAREWELL_VERIFY_DELAYS_MS.length) {
    clearFarewellVerification();
    if (sessionContextIsCurrent(sessionId, sessionGeneration)) {
      showToast("「いってきます」をサーバーで確認できなかったため、席はそのまま保ちました。");
    }
    return;
  }
  state.farewellVerificationTimer = window.setTimeout(() => {
    state.farewellVerificationTimer = null;
    verifyRemoteFarewell(message, channel, {
      sessionId,
      sessionGeneration,
      mediaGeneration,
      attempt: nextAttempt,
      control: verification,
    }).catch((error) => {
      if (contextIsCurrent()) handleSessionAuxiliaryError(error);
    });
  }, FREE_TABLE_FAREWELL_VERIFY_DELAYS_MS[nextAttempt]);
}

async function handleDeparture(event) {
  event.preventDefault();
  if (!isVisitor() || !isLiveSession()) return;
  const message = departureLineFromForm(event.currentTarget);
  await runBusy(async () => {
    const sessionId = state.sessionId;
    const sessionGeneration = state.sessionGeneration;
    const expiresAt = Date.now() + FREE_TABLE_FAREWELL_MS;
    sendControlMessage({
      type: "free-table-farewell",
      sessionId,
      ownerUid: state.uid,
      message,
      expiresAt,
    });
    beginFarewell({ departureMessage: message, expiresAt });
    try {
      await callFreeTableAction(FREE_TABLE_ACTIONS.END, {
        sessionId,
        reason: "departure",
        message,
      });
    } catch {
      scheduleIgnoredSessionEnd(sessionId, "departure", 0, message);
      if (sessionContextIsCurrent(sessionId, sessionGeneration)) {
        showToast("「いってきます」を届け直しています。見送りの時間はそのまま続けられます。");
      }
    }
  });
}

function sendControlMessage(message) {
  if (state.mediaChannel?.readyState !== "open") return false;
  const encoded = JSON.stringify(message);
  if (encoded.length > FREE_TABLE_CONTROL_MAX_CHARS) throw new Error("自由卓の見送りメッセージが長すぎます。");
  state.mediaChannel.send(encoded);
  return true;
}

function beginFarewell({ departureMessage = "", expiresAt = Date.now() + FREE_TABLE_FAREWELL_MS } = {}) {
  if (!active || !state.sessionId) return;
  clearFarewellVerification();
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const farewellId = state.farewell?.id || createNegotiationId();
  const normalizedExpiry = Math.min(
    Date.now() + FREE_TABLE_FAREWELL_MS,
    Math.max(Date.now() + 1_000, Number(expiresAt || 0)),
  );
  state.farewell = {
    ...(state.farewell || {}),
    id: farewellId,
    departureMessage: boundedText(departureMessage, 100) || "いってきます",
    expiresAt: normalizedExpiry,
  };
  state.screen = "farewell";
  if (state.farewellTimer) window.clearInterval(state.farewellTimer);
  state.farewellTimer = window.setInterval(() => {
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)
        || state.farewell?.id !== farewellId) return;
    if (Date.now() >= state.farewell.expiresAt) {
      finishSessionLocally("席を静かに閉じました。");
      return;
    }
    render();
  }, 1_000);
  render();
}

async function handleSendoff(event) {
  event.preventDefault();
  if (!isHost() || !state.farewell) return;
  const message = sendoffLineFromForm(event.currentTarget);
  if (message) {
    sendControlMessage({
      type: "free-table-farewell-response",
      sessionId: state.sessionId,
      ownerUid: state.uid,
      message,
    });
  }
  state.farewell.responseSent = true;
  state.farewell.responseMessage = message;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const farewellId = state.farewell.id;
  showToast(message ? "「いってらっしゃい」を届けました。" : "静かに見送りました。");
  window.setTimeout(() => {
    if (sessionContextIsCurrent(sessionId, sessionGeneration)
        && state.farewell?.id === farewellId
        && state.farewell.responseSent) {
      finishSessionLocally("見送りを終えました。");
    }
  }, message ? 350 : 0);
}

function handleRemoteEnding(ending) {
  clearFarewellVerification();
  if (ending.reason === "departure") {
    beginFarewell({
      departureMessage: ending.message || "いってきます",
      expiresAt: Date.now() + FREE_TABLE_FAREWELL_MS,
    });
    return;
  }
  if (ending.reason === "safe_exit" || ending.reason === "disconnected") {
    finishSessionLocally("安全に席を閉じました。");
    return;
  }
  finishSessionLocally("今日はここまで。穏やかにお開きになりました。");
}

async function endSession(reason) {
  if (!state.sessionId) return;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  if (reason === "safe_exit") {
    scheduleIgnoredSessionEnd(sessionId, reason);
    finishSessionLocally("安全に退出しました。", { deferHallMs: 500 });
    return;
  }
  await runBusy(async () => {
    await callFreeTableAction(FREE_TABLE_ACTIONS.END, { sessionId, reason });
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    finishSessionLocally("今日はここまで。穏やかにお開きになりました。");
  });
}

async function setRelationshipWanted() {
  if (!state.sessionId) return;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    const wants = !state.relationshipWanted;
    const result = await callFreeTableAction(FREE_TABLE_ACTIONS.RELATIONSHIP, { sessionId, wants });
    if (!sessionContextIsCurrent(sessionId, sessionGeneration)) return;
    state.relationshipWanted = wants;
    state.relationshipMutual = result.mutual === true;
    showToast(state.relationshipMutual
      ? "お互いの「またここで」が重なりました。"
      : wants ? "「またここで」を私的なしおりに残しました。" : "「またここで」のしおりを外しました。");
    render();
  });
}

function promptReportPayload() {
  const reasonChoice = window.prompt(
    "通報理由を番号で選んでください。\n1: いやがらせ\n2: 性的な内容\n3: 差別・憎悪\n4: 個人情報\n5: 権利侵害\n6: スパム\n7: その他",
    "7",
  );
  if (reasonChoice == null) return null;
  const reasons = {
    1: "harassment",
    2: "sexual",
    3: "hate",
    4: "privacy",
    5: "rights",
    6: "spam",
    7: "other",
  };
  const reason = reasons[String(reasonChoice).trim()] || "other";
  const details = boundedText(window.prompt("運営に伝えたい補足があれば入力してください。内容は公開されません。") || "", FREE_TABLE_REPORT_DETAIL_MAX_LENGTH);
  return { reason, details };
}

function inviteReportMustPreserveDraft() {
  return state.screen === "invite"
    && state.inviteAuthenticated
    && state.formDirty;
}

function syncInviteReportButton() {
  const button = app?.querySelector('[data-action="report-invite-card"]');
  if (!button) return;
  const reported = state.inviteReportedPreviewHash
    && state.inviteReportedPreviewHash === state.invitePreview?.previewHash;
  button.disabled = state.inviteReporting || reported;
  button.textContent = reported
    ? "この灯り札を通報しました"
    : "この灯り札の内容を通報";
}

async function reportInvitePublicCard() {
  const preview = state.invitePreview;
  const inviteId = normalizeInviteId(state.inviteId);
  const previewHash = String(preview?.previewHash || "");
  if (!active
      || state.screen !== "invite"
      || !preview?.active
      || !inviteId
      || !FREE_TABLE_PUBLIC_CARD_PREVIEW_HASH_PATTERN.test(previewHash)
      || state.inviteReporting
      || state.inviteReportedPreviewHash === previewHash) return;
  const payload = promptReportPayload();
  if (!payload) return;
  if (!auth.currentUser) {
    const confirmed = window.confirm(
      "通報の送信には匿名ログインが必要です。入室や来訪札の作成は行いません。匿名ログインして通報しますか？",
    );
    if (!confirmed) return;
  }
  const reportingState = state;
  const lifecycle = state.generation;
  state.inviteReporting = true;
  state.error = "";
  if (inviteReportMustPreserveDraft()) syncInviteReportButton();
  else render();
  try {
    await ensureAuthenticated();
    if (!active
        || state !== reportingState
        || state.generation !== lifecycle
        || state.screen !== "invite"
        || state.inviteId !== inviteId
        || state.invitePreview?.previewHash !== previewHash) return;
    await callFreeTableInviteAction("report_public_card", {
      inviteId,
      previewHash,
      reason: payload.reason,
      ...(payload.details ? { details: payload.details } : {}),
    });
    if (active
        && state === reportingState
        && state.generation === lifecycle
        && state.screen === "invite"
        && state.inviteId === inviteId) {
      state.inviteReportedPreviewHash = previewHash;
      showToast("灯り札の通報を受け付けました。必要に応じて運営が確認します。");
    }
  } catch (error) {
    if (active && state === reportingState && state.generation === lifecycle) {
      console.error(error);
      state.error = friendlyError(error);
      showToast(state.error);
    }
  } finally {
    reportingState.inviteReporting = false;
    if (active
        && state === reportingState
        && state.generation === lifecycle
        && state.screen === "invite"
        && state.inviteId === inviteId) {
      if (inviteReportMustPreserveDraft()) syncInviteReportButton();
      else render();
    }
  }
}

async function submitReportContext(context, { recent = false } = {}) {
  const sessionId = String(context?.sessionId || "");
  const reporterUid = String(context?.reporterUid || state.uid || "");
  const opponentUid = String(context?.opponentUid || "");
  const messageIds = [...new Set(
    (Array.isArray(context?.messageIds) ? context.messageIds : [])
      .map((messageId) => String(messageId || ""))
      .filter((messageId) => FREE_TABLE_CHAT_SLOT_ID_PATTERN.test(messageId)),
  )].slice(-FREE_TABLE_REPORT_MESSAGE_LIMIT);
  if (!sessionId || !reporterUid || !opponentUid || reporterUid !== state.uid) return;
  const payload = promptReportPayload();
  if (!payload) return;
  const reportingState = state;
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  await runBusy(async () => {
    if (recent) {
      const current = activeReportContext();
      if (state !== reportingState
          || state.generation !== lifecycle
          || state.sessionId
          || current?.sessionId !== sessionId
          || current?.opponentUid !== opponentUid) return;
    } else if (!sessionContextIsCurrent(sessionId, sessionGeneration)
        || state.opponentUid !== opponentUid) return;
    await callFreeTableAction(FREE_TABLE_ACTIONS.REPORT, {
      sessionId,
      reason: payload.reason,
      ...(payload.details ? { details: payload.details } : {}),
      ...(messageIds.length ? { messageIds } : {}),
    });
    reportingState.reportedSessionIds.add(sessionId);
    clearReportContext({ sessionId, reporterUid });
    if (state === reportingState && state.generation === lifecycle) {
      showToast(recent
        ? "直前の席の通報を受け付けました。"
        : "通報を受け付けました。必要なら安全に退出してください。");
      render();
    }
  });
}

async function reportSession() {
  if (!state.sessionId || !state.opponentUid) return;
  await submitReportContext({
    reporterUid: state.uid,
    sessionId: state.sessionId,
    opponentUid: state.opponentUid,
    messageIds: currentOpponentMessageIds(),
  });
}

async function reportRecentSession() {
  const context = activeReportContext();
  if (!context || state.sessionId) return;
  await submitReportContext(context, { recent: true });
}

function hideMedia(mediaId) {
  const entry = state.mediaMessages.get(mediaId);
  if (!entry) return;
  releaseFreeTableMediaResource(entry.resource);
  state.mediaMessages.delete(mediaId);
  render();
}

function pruneRetainedMedia() {
  let entries = [...state.mediaMessages.entries()]
    .sort(([, first], [, second]) => Number(first.createdAt || 0) - Number(second.createdAt || 0));
  let totalBytes = entries.reduce((sum, [, entry]) => sum + Number(entry.resource?.size || 0), 0);
  while (entries.length > FREE_TABLE_RETAINED_MEDIA_LIMIT || totalBytes > FREE_TABLE_RETAINED_MEDIA_MAX_BYTES) {
    const [id, entry] = entries.shift();
    totalBytes -= Number(entry.resource?.size || 0);
    releaseFreeTableMediaResource(entry.resource);
    state.mediaMessages.delete(id);
  }
}

function cleanupSession({ keepIdentity = false, preserveOnDisconnect = false } = {}) {
  state.sessionGeneration += 1;
  const closingSessionId = state.sessionId;
  const closingUid = state.uid;
  clearSessionExpiryTimer();
  clearUnsubscribers(state.sessionUnsubscribers);
  state.disconnectHandles.splice(0).forEach((handle) => {
    if (!preserveOnDisconnect) handle.cancel?.().catch?.(() => {});
  });
  if (state.presenceTimer) window.clearInterval(state.presenceTimer);
  state.presenceTimer = null;
  if (closingSessionId && closingUid) {
    remove(ref(database, pathFor("presence", closingSessionId, closingUid))).catch(() => {});
  }
  if (state.farewellTimer) window.clearInterval(state.farewellTimer);
  state.farewellTimer = null;
  if (state.farewellVerificationTimer) window.clearTimeout(state.farewellVerificationTimer);
  state.farewellVerificationTimer = null;
  state.pendingFarewellControl = null;
  if (state.hallReconnectTimer) window.clearTimeout(state.hallReconnectTimer);
  state.hallReconnectTimer = null;
  if (state.peerRecoveryTimer) window.clearTimeout(state.peerRecoveryTimer);
  state.peerRecoveryTimer = null;
  state.peerRecoveryForced = false;
  state.mediaGeneration += 1;
  state.incomingMedia = null;
  if (state.incomingMediaTimer) window.clearTimeout(state.incomingMediaTimer);
  state.incomingMediaTimer = null;
  releaseFreeTableMediaResources([...state.mediaMessages.values()].map((entry) => entry.resource));
  state.mediaMessages.clear();
  state.chatMessages.clear();
  state.pendingChatMutations.clear();
  const mediaChannel = state.mediaChannel;
  if (mediaChannel) {
    mediaChannel.onopen = null;
    mediaChannel.onclose = null;
    mediaChannel.onerror = null;
    mediaChannel.onmessage = null;
    mediaChannel.close();
  }
  state.mediaChannel = null;
  state.mediaReady = false;
  state.incomingMediaChain = Promise.resolve();
  state.mediaSendChain = Promise.resolve();
  state.presenceRearmChain = Promise.resolve();
  state.peerGeneration += 1;
  const peer = state.peer;
  if (peer) {
    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.oniceconnectionstatechange = null;
    peer.ondatachannel = null;
    peer.close();
  }
  state.peer = null;
  state.negotiationId = "";
  state.negotiationCreatedAt = 0;
  state.negotiationOfferKey = "";
  state.hostOfferInFlight = false;
  state.peerRecoveryAttempts = 0;
  state.pendingIce = [];
  state.deferredSignals = [];
  state.signalDraining = false;
  state.mediaProgress = 0;
  state.arrived = false;
  state.arrivalPending = false;
  if (state.arrivalRetryTimer) window.clearTimeout(state.arrivalRetryTimer);
  state.arrivalRetryTimer = null;
  state.seatEstablished = false;
  state.farewell = null;
  state.relationshipWanted = false;
  state.relationshipMutual = false;
  if (!keepIdentity) {
    state.sessionId = "";
    state.session = null;
    state.role = "";
    state.opponentUid = "";
    state.opponentPublicMemberId = "";
  }
}

function finishSessionLocally(message = "", { deferHallMs = 0 } = {}) {
  if (!active) return;
  rememberCurrentReportContext();
  if (state.sessionId) rememberIgnoredSession(state.sessionId);
  cleanupSession();
  const lifecycle = state.generation;
  const sessionGeneration = state.sessionGeneration;
  state.screen = "hall";
  state.tab = "mine";
  state.roomOpen = false;
  const reconnectHall = () => {
    state.hallReconnectTimer = null;
    if (!active
        || state.generation !== lifecycle
        || state.sessionGeneration !== sessionGeneration
        || state.sessionId) return;
    listenToHall();
    refreshMyState(lifecycle, {
      expectedSessionGeneration: sessionGeneration,
      requireNoSession: true,
    }).then(() => {
      if (!active
          || state.generation !== lifecycle
          || state.sessionGeneration !== sessionGeneration
          || state.sessionId) return;
      startOpenHeartbeat();
      render();
    }).catch(handleError);
  };
  if (deferHallMs > 0) state.hallReconnectTimer = window.setTimeout(reconnectHall, deferHallMs);
  else reconnectHall();
  if (message) showToast(message);
  render();
}

async function leave({ reason = "safe_exit", returnHome = false } = {}) {
  if (!active) return;
  const sessionId = state.sessionId;
  rememberCurrentReportContext();
  const shouldCancelRequest = Boolean(state.pendingRequest?.id);
  if (sessionId) scheduleIgnoredSessionEnd(sessionId, reason);
  if (shouldCancelRequest) cancelPendingRequest({ bestEffort: true });
  else if (!sessionId && state.uid) trackPendingLeaveSettlement(settlePendingAfterLeave());
  stopInvitePreviewRefresh();
  clearHostInviteUi();
  stopOpenHeartbeat();
  stopHallRefresh();
  clearUnsubscribers(state.hallUnsubscribers);
  clearUnsubscribers(state.unsubscribers);
  cleanupSession();
  active = false;
  app?.classList.remove("is-busy");
  if (returnHome) window.HariaiApp?.returnHome?.();
  if (state.uid) callRoomOpen(false).catch(() => {});
}

function clearInviteQueryFromUrl() {
  const url = new URL(location.href);
  if (!url.searchParams.has(FREE_TABLE_INVITE_QUERY_KEY)) return;
  url.searchParams.delete(FREE_TABLE_INVITE_QUERY_KEY);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

async function requestHome() {
  clearInviteQueryFromUrl();
  await leave({ reason: "safe_exit", returnHome: true });
}

async function initializeAuthenticatedFreeTable(generation = state.generation) {
  if (state.uid && state.authenticatedReady) return state.uid;
  try {
    const user = await ensureAuthenticated();
    if (!active || state.generation !== generation) return "";
    state.uid = user.uid;
    state.reportContext = loadReportContext(user.uid);
    armReportContextExpiry(state.reportContext);
    addUnsubscriber(state.unsubscribers, onValue(
      ref(database, ".info/serverTimeOffset"),
      (snapshot) => {
        if (!active || state.generation !== generation) return;
        state.serverTimeOffset = Number(snapshot.val() || 0);
        if (state.sessionId && state.session) {
          armSessionExpiryTimer(
            state.sessionId,
            state.sessionGeneration,
            Number(state.session.expiresAt || 0),
          );
        }
        if (state.hostInvite) {
          if (hostInviteIsLive()) armHostInviteExpiry();
          else {
            clearHostInviteUi({ keepPanelOpen: true });
            if (state.roomOpen) render();
          }
        }
      },
      () => {},
    ));
    await Promise.all([refreshMyState(generation), refreshRooms(generation)]);
    if (!active || state.generation !== generation) return "";
    listenToHall();
    startOpenHeartbeat();
    state.authenticatedReady = true;
    return state.uid;
  } catch (error) {
    if (active && state.generation === generation && !state.authenticatedReady) {
      clearUnsubscribers(state.unsubscribers);
      state.uid = "";
    }
    throw error;
  }
}

async function authenticateInvite() {
  if (!active
      || state.screen !== "invite"
      || !state.invitePreview?.active
      || state.inviteAuthenticating
      || state.inviteAuthenticated) return;
  const lifecycle = state.generation;
  state.inviteAuthenticating = true;
  state.error = "";
  render();
  try {
    const uid = await initializeAuthenticatedFreeTable(lifecycle);
    if (!uid
        || !active
        || state.generation !== lifecycle
        || state.screen !== "invite"
        || state.sessionId) return;
    if (!state.invitePreview?.active) {
      state.inviteAuthenticating = false;
      render();
      return;
    }
    state.inviteAuthenticated = true;
    state.inviteAuthenticating = false;
    render();
  } catch (error) {
    if (!active || state.generation !== lifecycle) return;
    state.inviteAuthenticating = false;
    handleError(error);
  }
}

async function browseInviteHall() {
  if (!active || state.screen !== "invite" || state.inviteAuthenticating) return;
  const lifecycle = state.generation;
  state.inviteAuthenticating = true;
  render();
  try {
    const uid = await initializeAuthenticatedFreeTable(lifecycle);
    if (!uid || !active || state.generation !== lifecycle || state.sessionId) return;
    state.inviteAuthenticating = false;
    state.screen = "hall";
    state.tab = "open";
    state.inviteId = "";
    stopInvitePreviewRefresh();
    clearInviteQueryFromUrl();
    render();
  } catch (error) {
    if (!active || state.generation !== lifecycle) return;
    state.inviteAuthenticating = false;
    handleError(error);
  }
}

function stopInvitePreviewRefresh() {
  if (state.invitePreviewTimer) window.clearTimeout(state.invitePreviewTimer);
  state.invitePreviewTimer = null;
}

function invitePreviewContextIsCurrent(generation, inviteId) {
  return Boolean(active
    && state.generation === generation
    && state.screen === "invite"
    && state.inviteId === inviteId);
}

function invitePreviewRefreshDelay() {
  const failureCount = Math.max(0, Number(state.invitePreviewFailureCount) || 0);
  if (!failureCount) return FREE_TABLE_INVITE_PREVIEW_REFRESH_MS;
  return Math.min(
    FREE_TABLE_INVITE_PREVIEW_MAX_BACKOFF_MS,
    FREE_TABLE_INVITE_PREVIEW_REFRESH_MS * (2 ** Math.min(failureCount, 3)),
  );
}

function scheduleInvitePreviewRefresh(generation, inviteId, delay = invitePreviewRefreshDelay()) {
  stopInvitePreviewRefresh();
  if (!invitePreviewContextIsCurrent(generation, inviteId)
      || document.visibilityState !== "visible"
      || state.invitePreviewStatus === "inactive") return;
  const refreshDelay = Math.min(
    FREE_TABLE_INVITE_PREVIEW_MAX_BACKOFF_MS,
    Math.max(FREE_TABLE_INVITE_PREVIEW_REFRESH_MS, Number(delay) || 0),
  );
  state.invitePreviewTimer = window.setTimeout(() => {
    state.invitePreviewTimer = null;
    refreshInvitePreview(generation, inviteId).catch(() => {});
  }, refreshDelay);
}

async function refreshInvitePreview(generation, expectedInviteId) {
  if (!invitePreviewContextIsCurrent(generation, expectedInviteId)
      || document.visibilityState !== "visible"
      || state.invitePreviewStatus === "inactive") return;
  if (state.invitePreviewRequest) {
    await state.invitePreviewRequest;
    return;
  }
  let request = null;
  try {
    request = freeTableInvitePreviewCallable({ inviteId: expectedInviteId });
    state.invitePreviewRequest = request;
    const response = await request;
    if (!invitePreviewContextIsCurrent(generation, expectedInviteId)) return;
    const preview = normalizeInvitePreview(response?.data, expectedInviteId);
    const preservingInviteDraft = state.inviteAuthenticated
      && state.formDirty
      && state.invitePreview?.active
      && preview.active;
    state.invitePreviewFailureCount = 0;
    state.invitePreview = preview;
    state.invitePreviewStatus = preview.active ? "open" : "inactive";
    if (!preservingInviteDraft) render();
  } catch (error) {
    console.warn("今夜の灯り札を確認できませんでした。", error);
    if (!invitePreviewContextIsCurrent(generation, expectedInviteId)) return;
    state.invitePreviewFailureCount = Math.min(
      Number(state.invitePreviewFailureCount || 0) + 1,
      8,
    );
    if (!state.invitePreview?.active) {
      const shouldRender = state.invitePreviewStatus !== "retrying";
      state.invitePreview = { active: false, inviteId: expectedInviteId };
      state.invitePreviewStatus = "retrying";
      if (shouldRender) render();
    }
  } finally {
    if (state.invitePreviewRequest === request) state.invitePreviewRequest = null;
    scheduleInvitePreviewRefresh(generation, expectedInviteId);
  }
}

async function openInvite(inviteIdValue) {
  if (location.protocol === "file:") {
    showToast("自由卓はローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  if (active) {
    if (state.screen === "invite" && state.inviteId === normalizeInviteId(inviteIdValue)) {
      render();
    }
    return;
  }
  active = true;
  state = createFreeTableState();
  state.screen = "invite";
  state.inviteId = normalizeInviteId(inviteIdValue);
  state.invitePreviewStatus = state.inviteId ? "loading" : "inactive";
  app?.classList.remove("is-busy");
  const generation = ++lifecycleGeneration;
  state.generation = generation;
  render();
  if (!state.inviteId) return;
  const expectedInviteId = state.inviteId;
  await refreshInvitePreview(generation, expectedInviteId);
}

async function start() {
  if (active) {
    render();
    return;
  }
  if (location.protocol === "file:") {
    showToast("自由卓はローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  active = true;
  state = createFreeTableState();
  app?.classList.remove("is-busy");
  const generation = ++lifecycleGeneration;
  state.generation = generation;
  render();
  try {
    await initializeAuthenticatedFreeTable(generation);
    if (!active || state.generation !== generation) return;
    render();
  } catch (error) {
    if (active && state.generation === generation) handleError(error);
  }
}

function isActive() {
  return active;
}

function attachPeerConnection(peer, {
  role = state.role,
  opponentUid = state.opponentUid,
} = {}) {
  if (!peer || typeof peer.createDataChannel !== "function") throw new Error("P2P接続を確認できません。");
  if (!active || !state.sessionId) throw new Error("自由卓の席を確認できません。");
  resetPeerTransport({
    preserveDeferredSignals: true,
    preserveRecoveryAttempts: true,
  });
  state.peer = peer;
  state.role = role;
  state.opponentUid = opponentUid;
  const sessionId = state.sessionId;
  const sessionGeneration = state.sessionGeneration;
  const peerGeneration = state.peerGeneration;
  const contextIsCurrent = () => (
    sessionContextIsCurrent(sessionId, sessionGeneration)
    && peerContextIsCurrent(peer, sessionId, peerGeneration)
  );
  peer.ondatachannel = (event) => {
    if (!contextIsCurrent()) return;
    if (event.channel?.label === FREE_TABLE_MEDIA_CHANNEL_LABEL) {
      configureMediaDataChannel(event.channel, {
        sessionId,
        sessionGeneration,
        peer,
        peerGeneration,
      });
    }
    else event.channel?.close();
  };
  if (role === "host") {
    configureMediaDataChannel(
      peer.createDataChannel(FREE_TABLE_MEDIA_CHANNEL_LABEL, { ordered: true }),
      {
        sessionId,
        sessionGeneration,
        peer,
        peerGeneration,
      },
    );
  }
  return peer;
}

function setDataChannel(channel) {
  configureMediaDataChannel(channel);
  return channel;
}

async function handleDocumentAction(event) {
  if (!active) return;
  const button = event.target.closest("[data-action]");
  if (!button || !app?.contains(button)) return;
  const action = button.dataset.action;
  if (action === "home") await requestHome();
  else if (action === "invite-home") await requestHome();
  else if (action === "browse-invite-hall") await browseInviteHall();
  else if (action === "authenticate-invite") await authenticateInvite();
  else if (action === "report-invite-card") await reportInvitePublicCard();
  else if (action === "issue-invite") {
    state.hostInvitePanelOpen = true;
    render();
    await issueHostInvite("issue");
  } else if (action === "close-invite-panel") {
    state.hostInvitePanelOpen = false;
    render();
  } else if (action === "rotate-invite") await issueHostInvite("rotate");
  else if (action === "revoke-invite") await revokeHostInvite();
  else if (action === "share-invite-card") await shareHostInviteCard();
  else if (action === "save-invite-card") await saveHostInviteCard();
  else if (action === "copy-invite-url") await copyHostInviteUrl();
  else if (action === "back-hall") {
    state.formDirty = false;
    state.screen = "hall";
    render();
  } else if (action === "tab" && FREE_TABLE_TABS.has(button.dataset.tab)) {
    if (state.formDirty) {
      showToast("移動する前に、入力した内容を保存してください。");
      return;
    }
    state.tab = button.dataset.tab;
    render();
  } else if (action === "select-room") {
    state.selectedRoomId = button.dataset.roomId || "";
    state.screen = "room";
    render();
  } else if (action === "toggle-room") await toggleRoom(button.dataset.open === "true");
  else if (action === "use-topic") {
    const topicInput = document.querySelector("#freeTableSpaceForm [name='spaceTopic']");
    if (topicInput) {
      topicInput.value = boundedText(button.dataset.topic, 60);
      state.formDirty = true;
      topicInput.focus();
    }
  }
  else if (action === "respond-request") await respondToRequest(button.dataset.requestId || "", button.dataset.accept === "true");
  else if (action === "cancel-request") await cancelPendingRequest();
  else if (action === "bookmark-room") await toggleBookmark(button.dataset.roomId || "", button.dataset.active === "true");
  else if (action === "block-member") await blockMember(button.dataset.memberId || "");
  else if (action === "unblock-member") await unblockMember(button.dataset.memberId || "");
  else if (action === "open-departure") {
    state.screen = "departure";
    render();
  } else if (action === "cancel-departure") {
    state.screen = "session";
    render();
  } else if (action === "close-session") await endSession("wrap_up");
  else if (action === "safe-exit") await endSession("safe_exit");
  else if (action === "finish-farewell") finishSessionLocally("いってらっしゃいを胸に、広間へ戻りました。");
  else if (action === "relationship") await setRelationshipWanted();
  else if (action === "report-session") await reportSession();
  else if (action === "report-recent-session") await reportRecentSession();
  else if (action === "hide-media") hideMedia(button.dataset.mediaId || "");
}

document.addEventListener("click", (event) => {
  handleDocumentAction(event).catch(handleError);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    stopInvitePreviewRefresh();
    return;
  }
  if (!active
      || state.screen !== "invite"
      || !state.inviteId
      || state.invitePreviewStatus === "inactive") return;
  stopInvitePreviewRefresh();
  refreshInvitePreview(state.generation, state.inviteId).catch(() => {});
});

window.addEventListener("beforeunload", () => {
  stopOpenHeartbeat();
  stopHallRefresh();
  rememberCurrentReportContext();
  cleanupSession({ preserveOnDisconnect: true });
});

window.HariaiFreeTable = {
  start,
  openInvite,
  isActive,
  leave,
  requestHome,
  attachPeerConnection,
  setDataChannel,
  render,
  refresh: async () => {
    await Promise.all([refreshRooms(), refreshMyState()]);
    render();
  },
  actions: FREE_TABLE_ACTIONS,
  mediaChannelLabel: FREE_TABLE_MEDIA_CHANNEL_LABEL,
  createInviteCardPngBlob,
};
window.dispatchEvent(new Event("hariai-free-table-ready"));

const initialInviteParams = new URLSearchParams(location.search);
if (initialInviteParams.has(FREE_TABLE_INVITE_QUERY_KEY)) {
  queueMicrotask(() => {
    openInvite(initialInviteParams.get(FREE_TABLE_INVITE_QUERY_KEY) || "").catch((error) => {
      console.warn("今夜の灯り札を開けませんでした。", error);
    });
  });
}
