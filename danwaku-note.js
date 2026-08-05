import {
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  auth,
  functions,
} from "./firebase-services.js?v=app-check-v3-remove-royale-v1-retire-team-v1-ai-text-training-v1";

const appRoot = document.querySelector("#app");
const danwakuNoteActionCallable = httpsCallable(functions, "danwakuNoteAction");

const NOTE_TITLE_MAX_LENGTH = 30;
const NOTE_COMMITMENT_MAX_LENGTH = 100;
const SAFE_NOTE_ID_PATTERN = /^[^\u0000-\u001f\u007f.#$\[\]\/]{1,128}$/;
const ONE_LINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const SCREEN_IDS = new Set(["notes", "detail", "editor", "archive", "ranking", "error"]);
const DANWAKU_ACTIONS = Object.freeze({
  STATE: "state",
  CREATE: "create",
  UPDATE: "update",
  CONTINUE: "continue",
  RESET: "reset",
  ARCHIVE: "archive",
  RESTORE: "restore",
  DELETE: "delete",
  SET_PUBLIC: "set_public",
  HISTORY: "history",
  RANKING: "ranking",
});
const MUTATION_ACTIONS = new Set([
  DANWAKU_ACTIONS.CREATE,
  DANWAKU_ACTIONS.UPDATE,
  DANWAKU_ACTIONS.CONTINUE,
  DANWAKU_ACTIONS.RESET,
  DANWAKU_ACTIONS.ARCHIVE,
  DANWAKU_ACTIONS.RESTORE,
  DANWAKU_ACTIONS.DELETE,
  DANWAKU_ACTIONS.SET_PUBLIC,
]);
const RETRYABLE_MUTATION_CODES = new Set(["unavailable", "deadline-exceeded", "internal"]);
const DANWAKU_ACHIEVEMENTS = Object.freeze([
  Object.freeze({ days: 1, name: "発心の一歩", icon: "一" }),
  Object.freeze({ days: 3, name: "一念の灯", icon: "灯" }),
  Object.freeze({ days: 7, name: "精進の芽", icon: "芽" }),
  Object.freeze({ days: 14, name: "日々の歩み", icon: "歩" }),
  Object.freeze({ days: 30, name: "不放逸のしるし", icon: "守" }),
  Object.freeze({ days: 60, name: "心調う", icon: "調" }),
  Object.freeze({ days: 100, name: "蓮のつぼみ", icon: "蓮" }),
  Object.freeze({ days: 180, name: "蓮華ひらく", icon: "華" }),
  Object.freeze({ days: 270, name: "光の道標", icon: "光" }),
  Object.freeze({ days: 365, name: "無尽の歩み", icon: "∞", final: true }),
]);

let active = false;
let lifecycleGeneration = 0;
let lastRenderedScreen = "";
let boundaryTimer = null;
let state = createState();

function createState() {
  return {
    screen: "notes",
    loading: true,
    refreshing: false,
    authReady: false,
    serverNow: 0,
    serverStateReceivedAt: 0,
    dayKey: "",
    nextBoundaryAt: 0,
    profile: {
      highestEverDays: 0,
      publicNoteId: "",
      rankingVisible: false,
      matchVisible: false,
      shareTitle: false,
    },
    notes: [],
    ranking: {
      top: [],
      nearby: [],
      viewerRank: 0,
      participantCount: 0,
      todayCount: 0,
    },
    rankingStatus: "idle",
    rankingError: "",
    selectedNoteId: "",
    editorMode: "create",
    editorDraft: { noteId: "", title: "", commitment: "" },
    historyByNoteId: new Map(),
    historyStatusByNoteId: new Map(),
    historyErrorByNoteId: new Map(),
    busyAction: "",
    confirmResetNoteId: "",
    confirmDeleteNoteId: "",
    fatalError: "",
  };
}

function shared() {
  return window.HariaiApp?.shared || null;
}

function escapeHtml(value) {
  const sharedEscape = shared()?.escapeHtml;
  if (typeof sharedEscape === "function") return sharedEscape(value);
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  if (typeof shared()?.showToast === "function") shared().showToast(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNfcText(value) {
  return String(value ?? "").normalize("NFC");
}

function codePointLength(value) {
  return Array.from(String(value ?? "")).length;
}

function truncateCodePoints(value, maximum) {
  return Array.from(String(value ?? "")).slice(0, maximum).join("");
}

function normalizeText(value, maximum) {
  return truncateCodePoints(normalizeNfcText(value).trim(), maximum);
}

function nonnegativeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(maximum, Math.floor(number));
}

function normalizeDayKey(value) {
  const dayKey = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : "";
}

function normalizeNote(value, serverDayKey = "") {
  if (!isRecord(value)) return null;
  const id = String(value.id ?? value.noteId ?? "");
  const title = normalizeText(value.title, NOTE_TITLE_MAX_LENGTH);
  if (!SAFE_NOTE_ID_PATTERN.test(id) || !title) return null;
  const status = value.status === "archived" ? "archived" : "active";
  const currentDays = nonnegativeInteger(value.currentDays);
  const bestDays = Math.max(currentDays, nonnegativeInteger(value.bestDays));
  const totalContinuedDays = Math.max(currentDays, nonnegativeInteger(value.totalContinuedDays));
  const lastContinueDayKey = normalizeDayKey(value.lastContinueDayKey);
  const lastResetDayKey = normalizeDayKey(value.lastResetDayKey);
  const canContinueToday = status === "active"
    && Boolean(serverDayKey)
    && lastContinueDayKey !== serverDayKey
    && lastResetDayKey !== serverDayKey
    && value.canContinueToday !== false;
  const canResetToday = status === "active"
    && currentDays > 0
    && Boolean(serverDayKey)
    && lastResetDayKey !== serverDayKey
    && value.canResetToday !== false;
  return Object.freeze({
    id,
    title,
    commitment: normalizeText(value.commitment, NOTE_COMMITMENT_MAX_LENGTH),
    status,
    currentDays,
    bestDays,
    totalContinuedDays,
    resetCount: nonnegativeInteger(value.resetCount),
    lastContinueDayKey,
    lastResetDayKey,
    canContinueToday,
    canResetToday,
  });
}

function normalizeProfile(value, notes) {
  const source = isRecord(value) ? value : {};
  const activeNoteIds = new Set(notes.filter((note) => note.status === "active").map((note) => note.id));
  const selectedNoteId = String(source.publicNoteId ?? source.noteId ?? "");
  const publicNoteId = activeNoteIds.has(selectedNoteId)
    ? selectedNoteId
    : "";
  return Object.freeze({
    highestEverDays: nonnegativeInteger(source.highestEverDays),
    publicNoteId,
    rankingVisible: Boolean(publicNoteId && source.rankingVisible === true),
    matchVisible: Boolean(publicNoteId && source.matchVisible === true),
    shareTitle: Boolean(publicNoteId && source.rankingVisible === true && source.shareTitle === true),
  });
}

function normalizeRankingEntry(value) {
  if (!isRecord(value)) return null;
  const rank = nonnegativeInteger(value.rank, 1_000_000_000);
  const days = nonnegativeInteger(value.currentDays ?? value.days, 1_000_000_000);
  const name = normalizeText(value.name ?? value.displayName ?? "PLAYER", 16) || "PLAYER";
  if (!rank || !days) return null;
  return Object.freeze({
    rank,
    name,
    days,
    title: normalizeText(value.title ?? value.noteTitle, NOTE_TITLE_MAX_LENGTH),
    isViewer: value.isViewer === true || value.viewer === true,
  });
}

function normalizeRankingEntries(value) {
  if (!Array.isArray(value)) return [];
  // 同名・同日数でも別の参加者になり得るため、公開行は重複排除しない。
  // 描画にも個人識別子や不透明な識別子を要求しない。
  return value.map(normalizeRankingEntry).filter(Boolean).slice(0, 100);
}

function normalizeRanking(value) {
  const source = isRecord(value) ? value : {};
  return Object.freeze({
    top: Object.freeze(normalizeRankingEntries(source.top)),
    nearby: Object.freeze(normalizeRankingEntries(source.nearby)),
    viewerRank: nonnegativeInteger(source.viewerRank, 1_000_000_000),
    participantCount: nonnegativeInteger(source.participantCount, 1_000_000_000),
    todayCount: nonnegativeInteger(source.todayCount, 1_000_000_000),
  });
}

function applyRanking(value) {
  const source = responseState(value);
  state.ranking = normalizeRanking(isRecord(source.ranking) ? source.ranking : source);
  state.rankingStatus = "ready";
  state.rankingError = "";
}

function responseState(value) {
  if (isRecord(value?.state)) return value.state;
  return isRecord(value) ? value : {};
}

function unlockedAchievementIds(value) {
  const source = responseState(value);
  const candidates = Array.isArray(source.newlyUnlocked)
    ? source.newlyUnlocked
    : Array.isArray(value?.newlyUnlocked) ? value.newlyUnlocked : [];
  return [...new Set(candidates.map(String).filter(Boolean))].slice(0, 20);
}

function applyServerState(value) {
  const source = responseState(value);
  if (source.serverNow != null) {
    state.serverNow = nonnegativeInteger(source.serverNow);
    state.serverStateReceivedAt = Date.now();
  }
  if (source.dayKey != null) state.dayKey = normalizeDayKey(source.dayKey);
  if (source.nextBoundaryAt != null) state.nextBoundaryAt = nonnegativeInteger(source.nextBoundaryAt);
  if (Array.isArray(source.notes)) {
    const noteIds = new Set();
    state.notes = source.notes.map((note) => normalizeNote(note, state.dayKey)).filter((note) => {
      if (!note || noteIds.has(note.id)) return false;
      noteIds.add(note.id);
      return true;
    });
  }
  if (isRecord(source.profile) || Array.isArray(source.notes)) {
    state.profile = normalizeProfile(isRecord(source.profile) ? source.profile : state.profile, state.notes);
  }
  if (isRecord(source.ranking)) applyRanking(source.ranking);
  const unlockedIds = unlockedAchievementIds(value);
  if (unlockedIds.length) {
    window.dispatchEvent(new CustomEvent("hariai-achievements-unlocked", {
      detail: { ids: unlockedIds },
    }));
  }
  const selected = selectedNote();
  if (state.selectedNoteId && !selected) {
    state.selectedNoteId = "";
    if (["detail", "editor"].includes(state.screen)) state.screen = "notes";
  }
  scheduleBoundaryRefresh();
}

function selectedNote() {
  return state.notes.find((note) => note.id === state.selectedNoteId) || null;
}

function activeNotes() {
  return state.notes.filter((note) => note.status === "active");
}

function archivedNotes() {
  return state.notes.filter((note) => note.status === "archived");
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(nonnegativeInteger(value));
}

function formatDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function friendlyError(error, fallback = "断惑NOTEを更新できませんでした。") {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("unauthenticated")) return "アカウントを確認できませんでした。ページを読み直してください。";
  if (code.includes("resource-exhausted")) return "操作が続いています。少し待ってからもう一度お試しください。";
  if (code.includes("failed-precondition")) return normalizeText(error?.message, 160) || "最新の記録を確認してから、もう一度お試しください。";
  if (code.includes("invalid-argument")) return normalizeText(error?.message, 160) || "入力内容を確認してください。";
  return normalizeText(error?.message, 160) || fallback;
}

async function ensureUser() {
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady?.();
  return auth.currentUser || (await signInAnonymously(auth)).user;
}

async function callDanwakuAction(action, payload = {}) {
  const response = await danwakuNoteActionCallable({ action, ...payload });
  return response.data || {};
}

function createOperationId() {
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `op_${cryptoApi.randomUUID().replaceAll("-", "")}`;
  }
  const bytes = new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return `op_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isLifecycleCurrent(generation) {
  return active && lifecycleGeneration === generation;
}

function mutationErrorIsRetryable(error) {
  const code = String(error?.code || "").toLowerCase().replace(/^functions\//, "");
  return RETRYABLE_MUTATION_CODES.has(code);
}

async function callMutationWithRetry(action, payload, operationId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callDanwakuAction(action, { ...payload, operationId });
    } catch (error) {
      if (attempt > 0 || !active || !mutationErrorIsRetryable(error)) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }
  throw new Error("Mutation retry exhausted");
}

async function refreshState({ silent = false } = {}) {
  if (!active || !state.authReady || state.refreshing || state.busyAction) return;
  const generation = lifecycleGeneration;
  state.refreshing = true;
  if (!silent) render();
  try {
    const payload = await callDanwakuAction(DANWAKU_ACTIONS.STATE);
    if (!isLifecycleCurrent(generation)) return;
    applyServerState(payload);
  } catch (error) {
    if (!isLifecycleCurrent(generation)) return;
    if (!silent) showToast(friendlyError(error, "断惑NOTEを再読み込みできませんでした。"));
  } finally {
    if (isLifecycleCurrent(generation)) {
      state.refreshing = false;
      render();
    }
  }
}

function invalidateHistory(noteId) {
  state.historyByNoteId.delete(noteId);
  state.historyStatusByNoteId.delete(noteId);
  state.historyErrorByNoteId.delete(noteId);
}

function mutationOutcomeMessage(action, outcome, successMessage) {
  const messages = {
    create: {
      created: successMessage,
      repeated: "このNOTEはすでに作成されています。最新の状態を表示しました。",
    },
    update: {
      updated: successMessage,
      unchanged: "NOTEの表記に変更はありません。",
      repeated: "NOTEの表記変更はすでに反映されています。",
    },
    continue: {
      recorded: successMessage,
      "already-recorded": "本日の断惑継続はすでに記録済みです。",
      "reset-today": "今日はすでに一区切りを記録しています。次の一日から、また始められます。",
    },
    reset: {
      reset: successMessage,
      "already-zero": "現在の断惑記録はすでに0日です。",
      "already-reset": "今日はすでに一区切りを記録済みです。",
      repeated: "一区切りはすでに反映されています。",
    },
    archive: {
      archive: successMessage,
      "already-archived": "このNOTEはすでに「過去の歩み」へ保管されています。",
      repeated: "NOTEの保管はすでに反映されています。",
    },
    restore: {
      restore: successMessage,
      "already-active": "このNOTEはすでに再開されています。",
      repeated: "NOTEの再開はすでに反映されています。",
    },
    delete: {
      deleted: successMessage,
      repeated: "NOTEの削除はすでに反映されています。",
    },
    set_public: {
      saved: successMessage,
      unchanged: "公開設定に変更はありません。",
      repeated: "公開設定はすでに反映されています。",
    },
  };
  if (outcome === "no-op") return "変更はありませんでした。最新の状態を表示しています。";
  return messages[action]?.[outcome] || "最新の状態を確認しました。";
}

async function runMutation(action, payload, {
  successMessage = "断惑NOTEを更新しました。",
  historyNoteId = "",
  onSettled,
} = {}) {
  if (!active || state.busyAction) return null;
  if (!MUTATION_ACTIONS.has(action)) throw new TypeError("Mutation action is not allowed");
  const generation = lifecycleGeneration;
  const operationId = createOperationId();
  state.busyAction = action;
  render();
  try {
    const result = await callMutationWithRetry(action, payload, operationId);
    if (!isLifecycleCurrent(generation)) return null;
    applyServerState(result);
    state.rankingStatus = "idle";
    if (historyNoteId) invalidateHistory(historyNoteId);
    const outcome = normalizeText(result?.outcome, 40);
    onSettled?.(result, outcome);
    showToast(mutationOutcomeMessage(action, outcome, successMessage));
    return result;
  } catch (error) {
    if (isLifecycleCurrent(generation)) showToast(friendlyError(error));
    return null;
  } finally {
    if (isLifecycleCurrent(generation)) {
      state.busyAction = "";
      render();
    }
  }
}

function normalizeHistoryEvent(value, index) {
  if (!isRecord(value)) return null;
  const type = ["create", "continue", "reset", "archive", "restore", "update", "set_public"]
    .includes(String(value.type || "")) ? String(value.type) : "update";
  const createdAt = nonnegativeInteger(value.createdAt ?? value.recordedAt);
  return Object.freeze({
    id: normalizeText(value.id ?? `${createdAt}:${index}`, 160),
    type,
    createdAt,
    dayKey: normalizeDayKey(value.dayKey),
    days: nonnegativeInteger(value.afterDays ?? value.days ?? value.currentDays),
  });
}

async function loadHistory(noteId, { force = false } = {}) {
  if (!active || !SAFE_NOTE_ID_PATTERN.test(noteId)) return;
  if (!force && ["loading", "ready"].includes(state.historyStatusByNoteId.get(noteId))) return;
  const generation = lifecycleGeneration;
  state.historyStatusByNoteId.set(noteId, "loading");
  state.historyErrorByNoteId.delete(noteId);
  render();
  try {
    const payload = await callDanwakuAction(DANWAKU_ACTIONS.HISTORY, { noteId });
    if (!isLifecycleCurrent(generation) || state.selectedNoteId !== noteId) return;
    const source = responseState(payload);
    const entries = Array.isArray(source.events)
      ? source.events
      : Array.isArray(payload.events) ? payload.events : [];
    state.historyByNoteId.set(noteId, entries.map(normalizeHistoryEvent).filter(Boolean));
    state.historyStatusByNoteId.set(noteId, "ready");
  } catch (error) {
    if (!isLifecycleCurrent(generation)) return;
    state.historyStatusByNoteId.set(noteId, "error");
    state.historyErrorByNoteId.set(noteId, friendlyError(error, "過去の歩みを読み込めませんでした。"));
  } finally {
    if (isLifecycleCurrent(generation)) render();
  }
}

async function loadRanking({ force = false } = {}) {
  if (!active || !state.authReady || state.busyAction) return;
  if (!force && ["loading", "ready"].includes(state.rankingStatus)) return;
  const generation = lifecycleGeneration;
  state.rankingStatus = "loading";
  state.rankingError = "";
  render();
  try {
    const payload = await callDanwakuAction(DANWAKU_ACTIONS.RANKING);
    if (!isLifecycleCurrent(generation)) return;
    applyRanking(payload);
  } catch (error) {
    if (!isLifecycleCurrent(generation)) return;
    state.rankingStatus = "error";
    state.rankingError = friendlyError(error, "みんなの灯りを読み込めませんでした。");
  } finally {
    if (isLifecycleCurrent(generation)) render();
  }
}

function scheduleBoundaryRefresh() {
  window.clearTimeout(boundaryTimer);
  boundaryTimer = null;
  if (!active || !state.nextBoundaryAt || !state.serverNow) return;
  const elapsedSinceServerState = state.serverStateReceivedAt
    ? Math.max(0, Date.now() - state.serverStateReceivedAt)
    : 0;
  const delay = Math.max(
    1_000,
    state.nextBoundaryAt - state.serverNow - elapsedSinceServerState + 1_500,
  );
  boundaryTimer = window.setTimeout(() => {
    if (!active) return;
    refreshState({ silent: true });
  }, Math.min(delay, 2_147_000_000));
}

function setDanwakuChrome(statusLabel = "DANWAKU NOTE") {
  const status = document.querySelector(".status-dot");
  const privacy = document.querySelector(".privacy-badge");
  const footerItems = document.querySelectorAll(".site-footer span");
  if (status) status.innerHTML = `<i></i> ${escapeHtml(statusLabel)}`;
  if (privacy) privacy.textContent = "自分との約束は常に非公開";
  if (footerItems[0]) footerItems[0].textContent = "DANWAKU NOTE / SELF-REPORTED HABIT RECORD";
  if (footerItems[1]) footerItems[1].textContent = "未記録の日は増減なし。一区切りにしても自己ベスト・累計・実績は残ります";
}

function renderLoading() {
  return `<section class="screen danwaku-screen danwaku-loading" aria-busy="true" aria-live="polite">
    <div class="danwaku-loading-mark" aria-hidden="true"><i></i><i></i><i></i></div>
    <span>DANWAKU NOTE</span><h1>あなたの歩みを開いています</h1>
    <p>今日の記録と、これまで積み重ねた日々を確認しています。</p>
  </section>`;
}

function renderFatalError() {
  return `<section class="screen danwaku-screen danwaku-error" role="alert">
    <span class="eyebrow">DANWAKU NOTE</span><div class="danwaku-error-mark" aria-hidden="true">蓮</div>
    <h1>断惑NOTEを開けませんでした</h1>
    <p>${escapeHtml(state.fatalError || "通信状態を確かめて、もう一度お試しください。")}</p>
    <div class="danwaku-button-row"><button class="button button-primary" type="button" data-danwaku-retry>もう一度読み込む</button>
      <button class="button button-ghost" type="button" data-danwaku-home>トップへ</button></div>
  </section>`;
}

function renderFrame(content, { label = "断惑NOTE" } = {}) {
  const refreshing = state.refreshing ? '<span class="danwaku-refreshing" role="status">更新中…</span>' : "";
  return `<section class="screen danwaku-screen" aria-busy="${state.busyAction ? "true" : "false"}">
    <header class="danwaku-header">
      <div class="danwaku-brand"><span aria-hidden="true">蓮</span><div><small>DANWAKU NOTE</small><strong>${escapeHtml(label)}</strong></div></div>
      <nav class="danwaku-nav" aria-label="断惑NOTE内の移動">
        <button type="button" data-danwaku-screen="notes" aria-current="${state.screen === "notes" ? "page" : "false"}">NOTE一覧</button>
        <button type="button" data-danwaku-screen="ranking" aria-current="${state.screen === "ranking" ? "page" : "false"}">みんなの灯り</button>
        <button type="button" data-danwaku-screen="archive" aria-current="${state.screen === "archive" ? "page" : "false"}">過去の歩み</button>
        <button type="button" data-danwaku-home>トップへ</button>
      </nav>
      ${refreshing}
    </header>
    ${content}
  </section>`;
}

function noteTodayStatus(note) {
  if (note.status === "archived") return { className: "is-archived", label: "保管中", copy: "過去の歩みとして記録を残しています。" };
  if (!note.canContinueToday && note.lastContinueDayKey === state.dayKey) {
    return { className: "is-recorded", label: "本日は記録済み", copy: "次の一日になるまで、現在の記録をそっと残します。" };
  }
  if (!note.canContinueToday && note.lastResetDayKey === state.dayKey) {
    return { className: "is-reset", label: "今日は一区切り", copy: "次の一日から、また始められます。" };
  }
  return { className: "is-open", label: "今日は未記録", copy: "今日は守れた、と自分で思えた日に記録してください。" };
}

function renderNoteCard(note) {
  const today = noteTodayStatus(note);
  const publicNote = state.profile.publicNoteId === note.id;
  return `<article class="danwaku-note-card ${publicNote ? "is-public" : ""}">
    <header><div><span>${publicNote ? "PUBLIC NOTE" : note.status === "archived" ? "PAST NOTE" : "DANWAKU NOTE"}</span><h2>${escapeHtml(note.title)}</h2></div>
      ${publicNote ? '<b class="danwaku-public-chip">公開NOTE</b>' : ""}</header>
    ${note.commitment ? `<p class="danwaku-note-commitment">${escapeHtml(note.commitment)}</p>` : '<p class="danwaku-note-commitment is-empty">自分との約束は未入力です。</p>'}
    <div class="danwaku-card-days"><strong>${formatNumber(note.currentDays)}</strong><span>日分</span><small>現在の断惑記録</small></div>
    <div class="danwaku-card-metrics"><span>自己ベスト <b>${formatNumber(note.bestDays)}日</b></span><span>累計 <b>${formatNumber(note.totalContinuedDays)}日</b></span></div>
    <p class="danwaku-today-status ${today.className}"><b>${escapeHtml(today.label)}</b><span>${escapeHtml(today.copy)}</span></p>
    <button class="button ${note.status === "active" ? "button-primary" : "button-ghost"}" type="button" data-danwaku-detail="${escapeHtml(note.id)}">記録を開く</button>
  </article>`;
}

function renderPublicSettings() {
  const notes = activeNotes();
  const disabled = !notes.length || Boolean(state.busyAction);
  const options = [`<option value="">公開しない</option>`, ...notes.map((note) => (
    `<option value="${escapeHtml(note.id)}" ${state.profile.publicNoteId === note.id ? "selected" : ""}>${escapeHtml(note.title)}</option>`
  ))].join("");
  return `<section class="danwaku-public-settings" aria-labelledby="danwakuPublicTitle">
    <div class="danwaku-section-heading"><div><span>VOLUNTARY PUBLICATION</span><h2 id="danwakuPublicTitle">公開する歩み</h2></div><small>初期値はすべて非公開</small></div>
    <p>1アカウントにつき1件だけ、ランキングや1on1バッジに使うNOTEを選べます。「自分との約束」は常に非公開です。NOTE名は、希望した場合だけランキングへ追加表示できます。</p>
    <form id="danwakuPublicForm">
      <label class="danwaku-field"><span>公開NOTE</span><select name="publicNoteId" ${disabled ? "disabled" : ""}>${options}</select></label>
      <div class="danwaku-public-options">
        <label><input type="checkbox" name="rankingVisible" ${state.profile.rankingVisible ? "checked" : ""} ${disabled ? "disabled" : ""} /><span><b>みんなの灯りに参加</b><small>公開名と日数を表示</small></span></label>
        <label><input type="checkbox" name="matchVisible" ${state.profile.matchVisible ? "checked" : ""} ${disabled ? "disabled" : ""} /><span><b>1on1でバッジを表示</b><small>対戦相手へは日数だけを表示</small></span></label>
        <label><input type="checkbox" name="shareTitle" ${state.profile.shareTitle ? "checked" : ""} ${disabled || !state.profile.rankingVisible ? "disabled" : ""} /><span><b>NOTE名だけを追加表示</b><small>「自分との約束」は公開されません</small></span></label>
      </div>
      <button class="button button-primary" type="submit" ${disabled ? "disabled" : ""}>${state.busyAction === DANWAKU_ACTIONS.SET_PUBLIC ? "公開設定を保存中…" : "公開設定を保存"}</button>
    </form>
  </section>`;
}

function renderNotes() {
  const notes = activeNotes();
  const cards = notes.length
    ? `<div class="danwaku-note-grid">${notes.map(renderNoteCard).join("")}</div>`
    : `<section class="danwaku-empty"><span aria-hidden="true">蓮</span><h2>まだ断惑NOTEはありません</h2><p>お菓子、飲酒、夜更かしなど、今の自分が向き合いたいことを自由な言葉で残せます。</p>
      <button class="button button-primary" type="button" data-danwaku-new>最初のNOTEを作る</button></section>`;
  return renderFrame(`<main class="danwaku-main">
    <section class="danwaku-intro" aria-labelledby="danwakuNotesTitle"><div><span>ONE DAY AT A TIME</span><h1 id="danwakuNotesTitle">断ちたい習慣との歩みを、自分の判断で。</h1>
      <p>記録しない日は、成功にも失敗にもなりません。「断惑継続」を押した日だけ、1日分ずつ積み重ねます。</p></div>
      <button class="button button-primary danwaku-new-button" type="button" data-danwaku-new><small>NEW NOTE</small>断惑NOTEを作る</button></section>
    <div class="danwaku-day-boundary"><span>今日の記録日</span><strong>${escapeHtml(state.dayKey || "確認中")}</strong><small>日本時間の午前4時に切り替わります</small></div>
    ${cards}
    ${renderPublicSettings()}
  </main>`);
}

function nextAchievement(bestDays) {
  return DANWAKU_ACHIEVEMENTS.find((achievement) => bestDays < achievement.days) || null;
}

function renderAchievementPath() {
  const highestEverDays = state.profile.highestEverDays;
  const items = DANWAKU_ACHIEVEMENTS.map((achievement, index) => {
    const unlocked = highestEverDays >= achievement.days;
    return `<article class="danwaku-achievement ${unlocked ? "is-unlocked" : "is-locked"} ${achievement.final ? "is-final" : ""}">
      <div class="danwaku-achievement-icon" aria-hidden="true">${escapeHtml(achievement.icon)}</div>
      <div><span>${achievement.final ? "FINAL " : ""}Lv.${index + 1}</span><h3>${escapeHtml(achievement.name)}</h3><p>${formatNumber(achievement.days)}日分の断惑記録</p></div>
      <b>${unlocked ? "獲得済み" : `あと${formatNumber(Math.max(0, achievement.days - highestEverDays))}日`}</b>
    </article>`;
  }).join("");
  return `<section class="danwaku-achievements" aria-labelledby="danwakuAchievementTitle">
    <div class="danwaku-section-heading"><div><span>DANWAKU ACHIEVEMENTS</span><h2 id="danwakuAchievementTitle">実績コレクション</h2></div><small>全NOTE共通・永続最高 ${formatNumber(highestEverDays)}日</small></div>
    <div class="danwaku-achievement-grid">${items}</div>
  </section>`;
}

function historyEventPresentation(event) {
  if (event.type === "create") return { icon: "一", label: "NOTEを始めた", copy: "新しい歩みを0日から始めました。" };
  if (event.type === "continue") return { icon: "蓮", label: "断惑継続", copy: `${formatNumber(event.days)}日分まで積み重ねました。` };
  if (event.type === "reset") return { icon: "節", label: "ここで一区切り", copy: "現在の記録を0日にし、過去の歩みを残しました。" };
  if (event.type === "archive") return { icon: "帖", label: "過去の歩みへ保管", copy: "NOTEを閲覧用として保管しました。" };
  if (event.type === "restore") return { icon: "再", label: "NOTEを再開", copy: "これまでの記録を保ったまま再開しました。" };
  if (event.type === "set_public") return { icon: "灯", label: "公開設定を変更", copy: "みんなの灯りと1on1バッジの公開設定を変更しました。" };
  return { icon: "記", label: "NOTEを更新", copy: "記録を保ったまま表記を更新しました。" };
}

function renderHistory(note) {
  const status = state.historyStatusByNoteId.get(note.id) || "idle";
  const events = state.historyByNoteId.get(note.id) || [];
  let content = '<div class="danwaku-history-loading" role="status">過去の歩みを確認しています…</div>';
  if (status === "error") {
    content = `<div class="danwaku-history-error" role="alert"><p>${escapeHtml(state.historyErrorByNoteId.get(note.id) || "履歴を読み込めませんでした。")}</p>
      <button class="button button-ghost button-small" type="button" data-danwaku-history-retry="${escapeHtml(note.id)}">もう一度読み込む</button></div>`;
  } else if (status === "ready" && !events.length) {
    content = '<div class="danwaku-history-empty">過去の記録はまだありません。</div>';
  } else if (status === "ready") {
    content = `<ol class="danwaku-history-list">${events.map((event) => {
      const presentation = historyEventPresentation(event);
      const when = event.createdAt ? formatDateTime(event.createdAt) : event.dayKey;
      return `<li><i aria-hidden="true">${escapeHtml(presentation.icon)}</i><div><span>${escapeHtml(when || "日時不明")}</span><h3>${escapeHtml(presentation.label)}</h3><p>${escapeHtml(presentation.copy)}</p></div></li>`;
    }).join("")}</ol>`;
  }
  return `<section class="danwaku-history" aria-labelledby="danwakuHistoryTitle">
    <div class="danwaku-section-heading"><div><span>PRIVATE HISTORY</span><h2 id="danwakuHistoryTitle">過去の歩み</h2></div><small>あなたにだけ表示</small></div>${content}
  </section>`;
}

function renderResetDialog(note) {
  if (state.confirmResetNoteId !== note.id) return "";
  return `<dialog class="danwaku-dialog" id="danwakuResetDialog" aria-labelledby="danwakuResetTitle">
    <div class="danwaku-dialog-mark" aria-hidden="true">節</div><span>PAUSE AND BEGIN AGAIN</span><h2 id="danwakuResetTitle">ここで一区切りにしますか？</h2>
    <p>現在の断惑記録 <strong>${formatNumber(note.currentDays)}日分</strong> は0日になります。</p>
    <ul><li>自己ベスト ${formatNumber(note.bestDays)}日は残ります</li><li>累計 ${formatNumber(note.totalContinuedDays)}日は残ります</li><li>獲得済み実績は残ります</li></ul>
    <div class="danwaku-dialog-actions"><button class="button button-ghost" type="button" data-danwaku-reset-cancel>まだ続ける</button>
      <button class="button button-danger" type="button" data-danwaku-reset-confirm="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>${state.busyAction === DANWAKU_ACTIONS.RESET ? "一区切りを記録中…" : "一区切りにして0日から再出発する"}</button></div>
  </dialog>`;
}

function renderDeleteDialog(note) {
  if (state.confirmDeleteNoteId !== note.id) return "";
  return `<dialog class="danwaku-dialog is-delete" id="danwakuDeleteDialog" aria-labelledby="danwakuDeleteTitle">
    <div class="danwaku-dialog-mark" aria-hidden="true">×</div><span>DELETE PRIVATE RECORD</span><h2 id="danwakuDeleteTitle">このNOTEを完全に削除しますか？</h2>
    <p>「${escapeHtml(note.title)}」のNOTE自由文と履歴は削除され、元に戻せません。</p>
    <ul><li>獲得済み実績はコレクションに残ります</li></ul>
    <div class="danwaku-dialog-actions"><button class="button button-ghost" type="button" data-danwaku-delete-cancel>削除しない</button>
      <button class="button button-danger" type="button" data-danwaku-delete-confirm="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>${state.busyAction === DANWAKU_ACTIONS.DELETE ? "削除中…" : "完全に削除する"}</button></div>
  </dialog>`;
}

function renderDetail() {
  const note = selectedNote();
  if (!note) return renderNotes();
  const today = noteTodayStatus(note);
  const next = nextAchievement(note.bestDays);
  const publicNote = state.profile.publicNoteId === note.id;
  const actionButtons = note.status === "active"
    ? `<button class="button button-primary danwaku-continue-button" type="button" data-danwaku-continue="${escapeHtml(note.id)}" ${!note.canContinueToday || state.busyAction ? "disabled" : ""}>${state.busyAction === DANWAKU_ACTIONS.CONTINUE ? "継続を記録中…" : note.canContinueToday ? "断惑継続" : "本日は記録済み"}</button>
      <button class="button button-danger" type="button" data-danwaku-reset-open="${escapeHtml(note.id)}" ${!note.canResetToday || state.busyAction ? "disabled" : ""}>断惑失敗</button>
      <button class="button button-ghost" type="button" data-danwaku-edit="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>NOTEの表記を編集</button>
      <button class="button button-ghost" type="button" data-danwaku-archive="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>過去の歩みへ保管</button>`
    : `<button class="button button-primary" type="button" data-danwaku-restore="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>このNOTEを再開する</button>
      <button class="button button-danger" type="button" data-danwaku-delete-open="${escapeHtml(note.id)}" ${state.busyAction ? "disabled" : ""}>完全に削除</button>`;
  return renderFrame(`<main class="danwaku-main">
    <button class="danwaku-back-link" type="button" data-danwaku-screen="${note.status === "active" ? "notes" : "archive"}">← ${note.status === "active" ? "NOTE一覧" : "過去の歩み"}へ</button>
    <article class="danwaku-detail-hero ${note.status === "archived" ? "is-archived" : ""}">
      <div class="danwaku-detail-copy"><span>${publicNote ? "PUBLIC DANWAKU NOTE" : "PRIVATE DANWAKU NOTE"}</span><h1>${escapeHtml(note.title)}</h1>
        ${note.commitment ? `<p>${escapeHtml(note.commitment)}</p>` : '<p class="is-empty">自分との約束は未入力です。</p>'}
        <div class="danwaku-detail-chips">${publicNote ? '<b>公開NOTEに選択中</b>' : ""}<b class="${today.className}">${escapeHtml(today.label)}</b></div></div>
      <div class="danwaku-current-record"><small>CURRENT RECORD</small><strong>${formatNumber(note.currentDays)}</strong><span>日分</span><p>未記録の日は増減しません</p></div>
    </article>
    <div class="danwaku-detail-metrics"><article><span>PERSONAL BEST</span><strong>${formatNumber(note.bestDays)}<small>日</small></strong><p>一区切りの後も残る最高記録</p></article>
      <article><span>LIFETIME TOTAL</span><strong>${formatNumber(note.totalContinuedDays)}<small>日</small></strong><p>このNOTEで継続を記録した累計</p></article>
      <article><span>NEW BEGINNINGS</span><strong>${formatNumber(note.resetCount)}<small>回</small></strong><p>自分で一区切りにした回数</p></article></div>
    ${note.status === "active" ? `<section class="danwaku-today-panel ${today.className}"><div><span>TODAY</span><h2>${escapeHtml(today.label)}</h2><p>${escapeHtml(today.copy)}</p></div>
      <div class="danwaku-primary-actions">${actionButtons}</div><small>「断惑失敗」は確認画面の後にだけ反映します。</small></section>` : `<section class="danwaku-today-panel is-archived"><div><span>PAST NOTE</span><h2>このNOTEは過去の歩みに保管中です</h2><p>再開しても、自己ベスト・累計・実績はそのまま残ります。</p></div><div class="danwaku-primary-actions">${actionButtons}</div></section>`}
    ${next ? `<p class="danwaku-next-achievement"><span>THIS NOTE / NEXT MILESTONE</span><strong>${escapeHtml(next.name)}</strong><small>このNOTEの自己ベストがあと${formatNumber(next.days - note.bestDays)}日分で、この節目に届きます</small></p>` : '<p class="danwaku-next-achievement is-final"><span>THIS NOTE / FINAL MILESTONE</span><strong>無尽の歩み</strong><small>このNOTEが最終節目に到達した後も、記録は増え続けます</small></p>'}
    ${renderAchievementPath()}
    ${renderHistory(note)}
    ${renderResetDialog(note)}${renderDeleteDialog(note)}
  </main>`, { label: note.title });
}

function renderEditor() {
  const editing = state.editorMode === "edit";
  const note = editing ? selectedNote() : null;
  if (editing && !note) return renderNotes();
  const draft = state.editorDraft;
  return renderFrame(`<main class="danwaku-main">
    <button class="danwaku-back-link" type="button" data-danwaku-screen="${editing ? "detail" : "notes"}">← ${editing ? "NOTE詳細" : "NOTE一覧"}へ</button>
    <section class="danwaku-editor" aria-labelledby="danwakuEditorTitle"><div class="danwaku-editor-heading"><span>${editing ? "EDIT WORDING" : "NEW DANWAKU NOTE"}</span>
      <h1 id="danwakuEditorTitle">${editing ? "記録はそのまま、NOTEの表記を整える" : "新しい断惑NOTEを始める"}</h1>
      <p>判定はシステムではなく、いつも本人が行います。「自分との約束」は常に非公開です。NOTE名は後から公開を選べます。</p></div>
      <form id="danwakuEditorForm" class="danwaku-editor-form">
        <label class="danwaku-field"><span>断惑NOTE名 <b>必須</b></span><input name="title" type="text" minlength="1" value="${escapeHtml(draft.title)}" placeholder="例：深夜ラーメンを断つ" autocomplete="off" required /><small><output id="danwakuTitleCount">${codePointLength(draft.title)}</output> / ${NOTE_TITLE_MAX_LENGTH}文字目安</small></label>
        <label class="danwaku-field"><span>自分との約束 <b class="is-optional">任意</b></span><textarea name="commitment" rows="4" placeholder="例：22時以降はラーメンを食べない">${escapeHtml(draft.commitment)}</textarea><small><output id="danwakuCommitmentCount">${codePointLength(draft.commitment)}</output> / ${NOTE_COMMITMENT_MAX_LENGTH}文字目安</small></label>
        ${editing ? '<p class="danwaku-edit-boundary"><strong>約束の意味が大きく変わるときは、</strong>このNOTEを保管し、新しいNOTEを0日から始めてください。</p>' : ""}
        <div class="danwaku-button-row"><button class="button button-primary" type="submit" ${state.busyAction ? "disabled" : ""}>${state.busyAction ? "保存中…" : editing ? "表記を保存" : "0日からNOTEを始める"}</button>
          <button class="button button-ghost" type="button" data-danwaku-screen="${editing ? "detail" : "notes"}" ${state.busyAction ? "disabled" : ""}>キャンセル</button></div>
      </form>
    </section>
  </main>`, { label: editing ? "NOTEを編集" : "新しいNOTE" });
}

function renderArchive() {
  const notes = archivedNotes();
  const content = notes.length
    ? `<div class="danwaku-note-grid is-archive">${notes.map(renderNoteCard).join("")}</div>`
    : `<section class="danwaku-empty"><span aria-hidden="true">帖</span><h2>過去の歩みはまだありません</h2><p>保管したNOTEは、現在の記録・自己ベスト・累計・実績を保ったままここへ残ります。</p></section>`;
  return renderFrame(`<main class="danwaku-main"><section class="danwaku-page-heading"><span>PAST STEPS</span><h1>過去の歩み</h1><p>終えた約束も、そこまで積み重ねた記録も、なかったことにはしません。</p></section>${content}</main>`, { label: "過去の歩み" });
}

function renderRankingRow(entry) {
  return `<li class="danwaku-ranking-row ${entry.isViewer ? "is-viewer" : ""}"><strong class="danwaku-rank">${entry.rank}<small>位</small></strong>
    <div><span>${entry.isViewer ? "YOU / " : ""}${escapeHtml(entry.name)}</span>${entry.title ? `<small>${escapeHtml(entry.title)}</small>` : '<small>NOTE名は非公開</small>'}</div>
    <p><i aria-hidden="true">🪷</i><strong>断惑 ${formatNumber(entry.days)}日目</strong></p></li>`;
}

function renderRankingList(entries, emptyCopy) {
  return entries.length
    ? `<ol class="danwaku-ranking-list">${entries.map(renderRankingRow).join("")}</ol>`
    : `<p class="danwaku-ranking-empty">${escapeHtml(emptyCopy)}</p>`;
}

function renderRanking() {
  const ranking = state.ranking;
  return renderFrame(`<main class="danwaku-main">
    <section class="danwaku-ranking-hero" aria-labelledby="danwakuRankingTitle"><div><span>EVERYONE'S LIGHT</span><h1 id="danwakuRankingTitle">みんなの灯り</h1><p>誰かの歩みを、今日の励みに。日数は人の強さや価値を示すものではありません。</p></div>
      <div class="danwaku-today-lights"><i aria-hidden="true"></i><span>今日、断惑を記録した人</span><strong>${formatNumber(ranking.todayCount)}<small>人</small></strong></div></section>
    <div class="danwaku-ranking-summary"><article><span>PUBLIC NOTES</span><strong>${formatNumber(ranking.participantCount)}</strong><small>現在掲載中の歩み</small></article>
      <article><span>YOUR PLACE</span><strong>${ranking.viewerRank ? formatNumber(ranking.viewerRank) : "--"}</strong><small>${state.profile.rankingVisible ? "公開NOTEの現在位置" : "参加すると周辺を表示"}</small></article>
      <button class="button button-ghost" type="button" data-danwaku-ranking-refresh ${state.rankingStatus === "loading" || state.busyAction ? "disabled" : ""}>${state.rankingStatus === "loading" ? "読み込み中…" : "最新の灯りを読み込む"}</button></div>
    <section class="danwaku-ranking-board" aria-labelledby="danwakuTopTitle"><div class="danwaku-section-heading"><div><span>CURRENT RECORDS</span><h2 id="danwakuTopTitle">現在の灯り</h2></div><small>同じ日数は同順位</small></div>
      ${state.rankingStatus === "error" ? `<p class="danwaku-ranking-empty" role="alert">${escapeHtml(state.rankingError)}</p>` : renderRankingList(ranking.top, state.rankingStatus === "loading" ? "みんなの灯りを読み込んでいます…" : "公開中の断惑NOTEはまだありません。")}</section>
    <section class="danwaku-ranking-board is-nearby" aria-labelledby="danwakuNearbyTitle"><div class="danwaku-section-heading"><div><span>AROUND YOU</span><h2 id="danwakuNearbyTitle">あなたの周辺</h2></div><small>上位だけでなく近い灯りを表示</small></div>
      ${renderRankingList(ranking.nearby, state.profile.rankingVisible ? "周辺の記録を確認できませんでした。" : "NOTE一覧で公開NOTEを選ぶと、あなたの周辺を表示できます。")}</section>
    <p class="danwaku-ranking-policy">この記録は本人の自己申告です。RATE、AnjuPay、マッチング優遇、報酬には使用しません。</p>
  </main>`, { label: "みんなの灯り" });
}

function render() {
  if (!active || !appRoot) return;
  if (state.loading) {
    appRoot.innerHTML = renderLoading();
    lastRenderedScreen = "loading";
    appRoot.focus({ preventScroll: true });
    return;
  }
  const screenChanged = lastRenderedScreen !== state.screen;
  const renderers = {
    notes: renderNotes,
    detail: renderDetail,
    editor: renderEditor,
    archive: renderArchive,
    ranking: renderRanking,
    error: renderFatalError,
  };
  appRoot.innerHTML = (renderers[state.screen] || renderNotes)();
  lastRenderedScreen = state.screen;
  bindEvents();
  openPendingDialog();
  if (screenChanged) {
    window.scrollTo(0, 0);
    appRoot.focus({ preventScroll: true });
  }
}

function openPendingDialog() {
  const dialog = document.querySelector("#danwakuResetDialog, #danwakuDeleteDialog");
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute("open", "");
  }
}

function navigate(screen) {
  if (!active) return;
  const target = SCREEN_IDS.has(screen) ? screen : "notes";
  if (target === "detail" && !selectedNote()) {
    state.screen = "notes";
  } else {
    state.screen = target;
  }
  state.confirmResetNoteId = "";
  state.confirmDeleteNoteId = "";
  render();
  if (state.screen === "detail" && selectedNote()) loadHistory(selectedNote().id);
  if (state.screen === "ranking") loadRanking();
}

function openDetail(noteId) {
  if (!state.notes.some((note) => note.id === noteId)) return;
  state.selectedNoteId = noteId;
  state.screen = "detail";
  state.confirmResetNoteId = "";
  state.confirmDeleteNoteId = "";
  render();
  loadHistory(noteId);
}

function openNewEditor() {
  state.editorMode = "create";
  state.editorDraft = { noteId: "", title: "", commitment: "" };
  state.screen = "editor";
  render();
}

function openEditEditor(noteId) {
  const note = state.notes.find((candidate) => candidate.id === noteId && candidate.status === "active");
  if (!note) return;
  state.selectedNoteId = note.id;
  state.editorMode = "edit";
  state.editorDraft = { noteId: note.id, title: note.title, commitment: note.commitment };
  state.screen = "editor";
  render();
}

function rawEditorDraft(form) {
  const data = new FormData(form);
  return {
    noteId: state.editorMode === "edit" ? state.selectedNoteId : "",
    title: normalizeNfcText(data.get("title")),
    commitment: normalizeNfcText(data.get("commitment")).replace(/\r\n?/gu, "\n"),
  };
}

function captureEditorDraft(form) {
  const raw = rawEditorDraft(form);
  state.editorDraft = {
    noteId: raw.noteId,
    title: truncateCodePoints(raw.title, NOTE_TITLE_MAX_LENGTH),
    commitment: truncateCodePoints(raw.commitment, NOTE_COMMITMENT_MAX_LENGTH),
  };
  return state.editorDraft;
}

function clampEditorFields(form) {
  const title = form.elements.namedItem("title");
  const commitment = form.elements.namedItem("commitment");
  if (title instanceof HTMLInputElement) {
    title.value = truncateCodePoints(normalizeNfcText(title.value), NOTE_TITLE_MAX_LENGTH);
  }
  if (commitment instanceof HTMLTextAreaElement) {
    commitment.value = truncateCodePoints(
      normalizeNfcText(commitment.value).replace(/\r\n?/gu, "\n"),
      NOTE_COMMITMENT_MAX_LENGTH,
    );
  }
}

function validatedEditorDraft(form) {
  const raw = rawEditorDraft(form);
  const draft = {
    noteId: raw.noteId,
    title: raw.title.trim(),
    commitment: raw.commitment.trim(),
  };
  if (!draft.title
      || codePointLength(draft.title) > NOTE_TITLE_MAX_LENGTH
      || ONE_LINE_CONTROL_PATTERN.test(draft.title)) {
    return { error: `断惑NOTE名は1行${NOTE_TITLE_MAX_LENGTH}文字以内で入力してください。`, field: "title" };
  }
  if (codePointLength(draft.commitment) > NOTE_COMMITMENT_MAX_LENGTH
      || MULTILINE_CONTROL_PATTERN.test(draft.commitment)) {
    return { error: `自分との約束は${NOTE_COMMITMENT_MAX_LENGTH}文字以内で入力してください。`, field: "commitment" };
  }
  state.editorDraft = draft;
  return { draft };
}

function submitEditor(form) {
  const validation = validatedEditorDraft(form);
  if (!validation.draft) {
    showToast(validation.error);
    const invalidField = form.elements.namedItem(validation.field);
    if (invalidField instanceof HTMLElement) invalidField.focus();
    return;
  }
  const { draft } = validation;
  if (state.editorMode === "edit") {
    const noteId = state.selectedNoteId;
    runMutation(DANWAKU_ACTIONS.UPDATE, {
      noteId,
      title: draft.title,
      commitment: draft.commitment,
    }, {
      successMessage: "NOTEの表記を更新しました。記録はそのまま残っています。",
      historyNoteId: noteId,
      onSettled: () => { state.screen = "detail"; },
    });
    return;
  }
  runMutation(DANWAKU_ACTIONS.CREATE, {
    title: draft.title,
    commitment: draft.commitment,
  }, {
    successMessage: "新しい断惑NOTEを0日から始めました。",
    onSettled: (result) => {
      const source = responseState(result);
      const createdId = String(source.createdNoteId || source.noteId || result.createdNoteId || result.noteId || "");
      const created = state.notes.find((note) => note.id === createdId)
        || activeNotes().find((note) => note.title === draft.title);
      if (created) {
        state.selectedNoteId = created.id;
        state.screen = "detail";
        window.setTimeout(() => loadHistory(created.id), 0);
      } else {
        state.screen = "notes";
      }
    },
  });
}

function submitPublicSettings(form) {
  const data = new FormData(form);
  const publicNoteId = String(data.get("publicNoteId") || "");
  const validPublicNoteId = activeNotes().some((note) => note.id === publicNoteId) ? publicNoteId : "";
  runMutation(DANWAKU_ACTIONS.SET_PUBLIC, {
    noteId: validPublicNoteId,
    rankingVisible: Boolean(validPublicNoteId && data.has("rankingVisible")),
    matchVisible: Boolean(validPublicNoteId && data.has("matchVisible")),
    shareTitle: Boolean(validPublicNoteId && data.has("rankingVisible") && data.has("shareTitle")),
  }, { successMessage: "断惑NOTEの公開設定を保存しました。" });
}

function bindEvents() {
  document.querySelectorAll("[data-danwaku-home]").forEach((button) => button.addEventListener("click", requestHome));
  document.querySelectorAll("[data-danwaku-screen]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.danwakuScreen)));
  document.querySelectorAll("[data-danwaku-detail]").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.danwakuDetail)));
  document.querySelectorAll("[data-danwaku-new]").forEach((button) => button.addEventListener("click", openNewEditor));
  document.querySelectorAll("[data-danwaku-edit]").forEach((button) => button.addEventListener("click", () => openEditEditor(button.dataset.danwakuEdit)));

  document.querySelector("#danwakuEditorForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitEditor(event.currentTarget);
  });
  document.querySelector("#danwakuEditorForm")?.addEventListener("input", (event) => {
    if (event.isComposing) return;
    clampEditorFields(event.currentTarget);
    captureEditorDraft(event.currentTarget);
    const titleCount = document.querySelector("#danwakuTitleCount");
    const commitmentCount = document.querySelector("#danwakuCommitmentCount");
    if (titleCount) titleCount.textContent = String(codePointLength(state.editorDraft.title));
    if (commitmentCount) commitmentCount.textContent = String(codePointLength(state.editorDraft.commitment));
  });
  document.querySelector("#danwakuEditorForm")?.addEventListener("compositionend", (event) => {
    clampEditorFields(event.currentTarget);
    captureEditorDraft(event.currentTarget);
    const titleCount = document.querySelector("#danwakuTitleCount");
    const commitmentCount = document.querySelector("#danwakuCommitmentCount");
    if (titleCount) titleCount.textContent = String(codePointLength(state.editorDraft.title));
    if (commitmentCount) commitmentCount.textContent = String(codePointLength(state.editorDraft.commitment));
  });
  document.querySelector("#danwakuPublicForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitPublicSettings(event.currentTarget);
  });
  document.querySelector('#danwakuPublicForm [name="rankingVisible"]')?.addEventListener("change", (event) => {
    const share = document.querySelector('#danwakuPublicForm [name="shareTitle"]');
    if (!share) return;
    share.disabled = !event.currentTarget.checked;
    if (share.disabled) share.checked = false;
  });

  document.querySelectorAll("[data-danwaku-continue]").forEach((button) => button.addEventListener("click", () => {
    const noteId = button.dataset.danwakuContinue;
    runMutation(DANWAKU_ACTIONS.CONTINUE, { noteId }, {
      successMessage: "今日の断惑継続を1日分記録しました。",
      historyNoteId: noteId,
      onSettled: () => window.setTimeout(() => loadHistory(noteId, { force: true }), 0),
    });
  }));
  document.querySelectorAll("[data-danwaku-reset-open]").forEach((button) => button.addEventListener("click", () => {
    state.confirmResetNoteId = button.dataset.danwakuResetOpen;
    render();
  }));
  document.querySelector("[data-danwaku-reset-cancel]")?.addEventListener("click", () => {
    state.confirmResetNoteId = "";
    render();
  });
  document.querySelector("[data-danwaku-reset-confirm]")?.addEventListener("click", (event) => {
    const noteId = event.currentTarget.dataset.danwakuResetConfirm;
    runMutation(DANWAKU_ACTIONS.RESET, { noteId }, {
      successMessage: "ここまでの歩みは残っています。次の一日から、また始められます。",
      historyNoteId: noteId,
      onSettled: () => {
        state.confirmResetNoteId = "";
        window.setTimeout(() => loadHistory(noteId, { force: true }), 0);
      },
    });
  });
  document.querySelector("#danwakuResetDialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    state.confirmResetNoteId = "";
    render();
  });

  document.querySelectorAll("[data-danwaku-archive]").forEach((button) => button.addEventListener("click", () => {
    const noteId = button.dataset.danwakuArchive;
    runMutation(DANWAKU_ACTIONS.ARCHIVE, { noteId }, {
      successMessage: "NOTEを「過去の歩み」へ保管しました。",
      historyNoteId: noteId,
      onSettled: () => { state.screen = "archive"; state.selectedNoteId = ""; },
    });
  }));
  document.querySelectorAll("[data-danwaku-restore]").forEach((button) => button.addEventListener("click", () => {
    const noteId = button.dataset.danwakuRestore;
    runMutation(DANWAKU_ACTIONS.RESTORE, { noteId }, {
      successMessage: "NOTEを再開しました。これまでの記録は残っています。",
      historyNoteId: noteId,
    });
  }));
  document.querySelectorAll("[data-danwaku-delete-open]").forEach((button) => button.addEventListener("click", () => {
    state.confirmDeleteNoteId = button.dataset.danwakuDeleteOpen;
    render();
  }));
  document.querySelector("[data-danwaku-delete-cancel]")?.addEventListener("click", () => {
    state.confirmDeleteNoteId = "";
    render();
  });
  document.querySelector("[data-danwaku-delete-confirm]")?.addEventListener("click", (event) => {
    const noteId = event.currentTarget.dataset.danwakuDeleteConfirm;
    runMutation(DANWAKU_ACTIONS.DELETE, { noteId }, {
      successMessage: "NOTEを完全に削除しました。",
      historyNoteId: noteId,
      onSettled: () => {
        state.confirmDeleteNoteId = "";
        state.selectedNoteId = "";
        state.screen = "archive";
      },
    });
  });
  document.querySelector("#danwakuDeleteDialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    state.confirmDeleteNoteId = "";
    render();
  });

  document.querySelectorAll("[data-danwaku-history-retry]").forEach((button) => button.addEventListener("click", () => loadHistory(button.dataset.danwakuHistoryRetry, { force: true })));
  document.querySelector("[data-danwaku-ranking-refresh]")?.addEventListener("click", () => loadRanking({ force: true }));
  document.querySelector("[data-danwaku-retry]")?.addEventListener("click", () => {
    requestHome();
    window.setTimeout(start, 0);
  });
}

function modeIsActiveElsewhere() {
  return Boolean(
    window.HariaiOnline?.isActive?.()
    || window.HariaiStrategy?.isActive?.()
    || window.HariaiAiTextTraining?.isActive?.()
    || window.HariaiFreeTable?.isActive?.()
    || window.HariaiMarket?.isActive?.()
    || window.HariaiFleaMarket?.isActive?.()
    || window.HariaiAccount?.isActive?.(),
  );
}

async function start({ initialScreen = "notes" } = {}) {
  const requestedScreen = ["notes", "archive", "ranking"].includes(initialScreen) ? initialScreen : "notes";
  if (active) {
    navigate(requestedScreen);
    return;
  }
  if (location.protocol === "file:") {
    showToast("断惑NOTEはローカルサーバーまたは公開URLから開いてください。");
    return;
  }
  if (modeIsActiveElsewhere()) {
    showToast("ほかのモードを終了してから断惑NOTEを開いてください。");
    return;
  }
  active = true;
  const generation = ++lifecycleGeneration;
  state = createState();
  state.screen = requestedScreen;
  lastRenderedScreen = "";
  setDanwakuChrome("DANWAKU NOTE / CONNECTING");
  render();
  try {
    await ensureUser();
    if (!isLifecycleCurrent(generation)) return;
    state.authReady = true;
    const payload = await callDanwakuAction(DANWAKU_ACTIONS.STATE);
    if (!isLifecycleCurrent(generation)) return;
    applyServerState(payload);
    state.loading = false;
    setDanwakuChrome();
    render();
    if (state.screen === "ranking") window.setTimeout(() => loadRanking(), 0);
  } catch (error) {
    if (!isLifecycleCurrent(generation)) return;
    state.loading = false;
    state.screen = "error";
    state.fatalError = friendlyError(error, "断惑NOTEへ接続できませんでした。");
    setDanwakuChrome("DANWAKU NOTE / ERROR");
    render();
  }
}

function isActive() {
  return active;
}

function requestHome() {
  if (!active) return;
  active = false;
  lifecycleGeneration += 1;
  window.clearTimeout(boundaryTimer);
  boundaryTimer = null;
  state.busyAction = "";
  state.historyStatusByNoteId.clear();
  window.HariaiApp?.returnHome?.();
}

window.addEventListener("visibilitychange", () => {
  if (!active || document.visibilityState !== "visible" || !state.authReady || state.loading) return;
  refreshState({ silent: true });
});

window.addEventListener("beforeunload", () => {
  active = false;
  lifecycleGeneration += 1;
  window.clearTimeout(boundaryTimer);
});

window.HariaiDanwakuNote = Object.freeze({
  start,
  isActive,
  requestHome,
});
window.dispatchEvent(new Event("hariai-danwaku-note-ready"));
