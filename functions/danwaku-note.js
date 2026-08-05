"use strict";

const crypto = require("node:crypto");

const DANWAKU_SCHEMA_VERSION = 1;
const DANWAKU_ACTIVE_NOTE_LIMIT = 10;
const DANWAKU_TITLE_MAX_LENGTH = 30;
const DANWAKU_COMMITMENT_MAX_LENGTH = 100;
const DANWAKU_DISPLAY_NAME_MAX_LENGTH = 16;
const DANWAKU_HISTORY_LIMIT = 100;
const DANWAKU_ARCHIVED_NOTE_LIMIT = 100;
const DANWAKU_DAY_START_HOUR_JST = 4;
const DANWAKU_RANKING_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const DANWAKU_RANKING_READ_LIMIT = 2000;
const DANWAKU_RANKING_TOP_LIMIT = 20;
const DANWAKU_RANKING_NEARBY_RADIUS = 2;
const DANWAKU_ID_BYTES = 18;
const DANWAKU_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const DANWAKU_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const DANWAKU_ACTIONS = Object.freeze([
  "state",
  "create",
  "update",
  "continue",
  "reset",
  "archive",
  "restore",
  "delete",
  "set_public",
  "history",
  "ranking",
]);
const DANWAKU_NOTE_STATUSES = Object.freeze(["active", "archived", "deleted"]);
const ONE_LINE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MULTILINE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

class DanwakuNoteError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DanwakuNoteError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = minimum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

function normalizeNfc(value) {
  return String(value).normalize("NFC");
}

function normalizeDanwakuTitle(value) {
  if (typeof value !== "string") {
    throw new DanwakuNoteError("invalid-argument", "断惑NOTE名を入力してください。");
  }
  const title = normalizeNfc(value).trim();
  if (!title
      || unicodeLength(title) > DANWAKU_TITLE_MAX_LENGTH
      || ONE_LINE_CONTROL_PATTERN.test(title)) {
    throw new DanwakuNoteError(
      "invalid-argument",
      `断惑NOTE名は1行${DANWAKU_TITLE_MAX_LENGTH}文字以内で入力してください。`,
    );
  }
  return title;
}

function normalizeDanwakuCommitment(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new DanwakuNoteError("invalid-argument", "自分との約束を確認してください。");
  }
  const commitment = normalizeNfc(value).replace(/\r\n?/gu, "\n").trim();
  if (unicodeLength(commitment) > DANWAKU_COMMITMENT_MAX_LENGTH
      || MULTILINE_CONTROL_PATTERN.test(commitment)) {
    throw new DanwakuNoteError(
      "invalid-argument",
      `自分との約束は${DANWAKU_COMMITMENT_MAX_LENGTH}文字以内で入力してください。`,
    );
  }
  return commitment;
}

function normalizeDanwakuDisplayName(value) {
  if (typeof value !== "string") {
    throw new DanwakuNoteError("invalid-argument", "公開名を入力してください。");
  }
  const displayName = normalizeNfc(value).trim();
  if (!displayName
      || unicodeLength(displayName) > DANWAKU_DISPLAY_NAME_MAX_LENGTH
      || ONE_LINE_CONTROL_PATTERN.test(displayName)) {
    throw new DanwakuNoteError(
      "invalid-argument",
      `公開名は1行${DANWAKU_DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください。`,
    );
  }
  return displayName;
}

function requireDanwakuId(value, label = "断惑NOTE") {
  const id = typeof value === "string" ? value : "";
  if (!DANWAKU_ID_PATTERN.test(id)) {
    throw new DanwakuNoteError("invalid-argument", `${label}の識別情報が正しくありません。`);
  }
  return id;
}

function normalizeOperationId(value) {
  const operationId = typeof value === "string" ? value : "";
  if (!DANWAKU_OPERATION_ID_PATTERN.test(operationId)) {
    throw new DanwakuNoteError("invalid-argument", "操作情報が正しくありません。");
  }
  return operationId;
}

function assertActionKeys(value, required, optional = []) {
  if (!isRecord(value)) {
    throw new DanwakuNoteError("invalid-argument", "断惑NOTEの操作内容が正しくありません。");
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))
      || required.some((key) => !Object.hasOwn(value, key))) {
    throw new DanwakuNoteError("invalid-argument", "断惑NOTEの操作内容が正しくありません。");
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new DanwakuNoteError("invalid-argument", `${label}の設定を確認してください。`);
  }
  return value;
}

function normalizeDanwakuActionData(value) {
  if (!isRecord(value) || typeof value.action !== "string"
      || !DANWAKU_ACTIONS.includes(value.action)) {
    throw new DanwakuNoteError("invalid-argument", "未対応の断惑NOTE操作です。");
  }
  const { action } = value;
  if (action === "state") {
    assertActionKeys(value, ["action"]);
    return { action };
  }
  if (action === "ranking") {
    assertActionKeys(value, ["action"]);
    return { action };
  }
  if (action === "create") {
    assertActionKeys(value, ["action", "operationId", "title"], ["commitment"]);
    return {
      action,
      operationId: normalizeOperationId(value.operationId),
      title: normalizeDanwakuTitle(value.title),
      commitment: normalizeDanwakuCommitment(value.commitment),
    };
  }
  if (action === "update") {
    assertActionKeys(
      value,
      ["action", "operationId", "noteId", "title"],
      ["commitment"],
    );
    return {
      action,
      operationId: normalizeOperationId(value.operationId),
      noteId: requireDanwakuId(value.noteId),
      title: normalizeDanwakuTitle(value.title),
      commitment: normalizeDanwakuCommitment(value.commitment),
    };
  }
  if (["continue", "reset", "archive", "restore", "delete"].includes(action)) {
    assertActionKeys(value, ["action", "operationId", "noteId"]);
    return {
      action,
      operationId: normalizeOperationId(value.operationId),
      noteId: requireDanwakuId(value.noteId),
    };
  }
  if (action === "set_public") {
    assertActionKeys(value, [
      "action",
      "operationId",
      "noteId",
      "rankingVisible",
      "matchVisible",
      "shareTitle",
    ]);
    const rankingVisible = requireBoolean(value.rankingVisible, "ランキング公開");
    const matchVisible = requireBoolean(value.matchVisible, "1on1バッジ公開");
    const shareTitle = requireBoolean(value.shareTitle, "NOTE名公開");
    const noteId = value.noteId === "" ? "" : requireDanwakuId(value.noteId);
    if ((rankingVisible || matchVisible) && !noteId) {
      throw new DanwakuNoteError("invalid-argument", "公開する断惑NOTEを選んでください。");
    }
    if (!rankingVisible && shareTitle) {
      throw new DanwakuNoteError("invalid-argument", "NOTE名はランキング公開時だけ表示できます。");
    }
    return {
      action,
      operationId: normalizeOperationId(value.operationId),
      noteId: rankingVisible || matchVisible ? noteId : "",
      rankingVisible,
      matchVisible,
      shareTitle: rankingVisible && shareTitle,
    };
  }
  assertActionKeys(value, ["action", "noteId"], ["limit"]);
  const rawLimit = value.limit == null ? 30 : Number(value.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > DANWAKU_HISTORY_LIMIT) {
    throw new DanwakuNoteError(
      "invalid-argument",
      `履歴は1件から${DANWAKU_HISTORY_LIMIT}件まで取得できます。`,
    );
  }
  return {
    action,
    noteId: requireDanwakuId(value.noteId),
    limit: rawLimit,
  };
}

function danwakuDayKey(timestamp = Date.now()) {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis) || millis <= 0) {
    throw new TypeError("Invalid Danwaku timestamp");
  }
  const jstShiftMinusBoundary = (9 - DANWAKU_DAY_START_HOUR_JST) * 60 * 60 * 1000;
  return new Date(millis + jstShiftMinusBoundary).toISOString().slice(0, 10);
}

function nextDanwakuBoundaryAt(timestamp = Date.now()) {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis) || millis <= 0) {
    throw new TypeError("Invalid Danwaku timestamp");
  }
  const jstDate = new Date(millis + (9 * 60 * 60 * 1000));
  const year = jstDate.getUTCFullYear();
  const month = jstDate.getUTCMonth();
  const day = jstDate.getUTCDate();
  const todayBoundary = Date.UTC(year, month, day, DANWAKU_DAY_START_HOUR_JST)
    - (9 * 60 * 60 * 1000);
  return millis < todayBoundary
    ? todayBoundary
    : Date.UTC(year, month, day + 1, DANWAKU_DAY_START_HOUR_JST)
      - (9 * 60 * 60 * 1000);
}

function createDanwakuOpaqueId(randomBytes = crypto.randomBytes) {
  const id = randomBytes(DANWAKU_ID_BYTES).toString("base64url");
  if (!DANWAKU_ID_PATTERN.test(id)) throw new TypeError("Invalid Danwaku random source");
  return id;
}

function deterministicDanwakuId(...parts) {
  return crypto.createHash("sha256")
    .update(parts.map((part) => String(part)).join("\u001f"))
    .digest("base64url")
    .slice(0, 24);
}

function danwakuEventId(action, noteId, discriminator) {
  return deterministicDanwakuId("event", action, noteId, discriminator);
}

function emptyDanwakuProfile(timestamp = Date.now()) {
  const now = integer(timestamp, 1, Number.MAX_SAFE_INTEGER, Date.now());
  return {
    schemaVersion: DANWAKU_SCHEMA_VERSION,
    activeNoteCount: 0,
    noteCount: 0,
    highestEverDays: 0,
    publicNoteId: "",
    rankingVisible: false,
    matchVisible: false,
    shareTitle: false,
    displayName: "",
    publicEntryId: "",
    publicDays: 0,
    publicTitle: "",
    publicLastContinuedAt: 0,
    rankingExpiresAt: 0,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDanwakuProfile(value, timestamp = Date.now()) {
  const source = isRecord(value) ? value : {};
  const fallback = emptyDanwakuProfile(timestamp);
  const publicNoteId = DANWAKU_ID_PATTERN.test(String(source.publicNoteId || ""))
    ? String(source.publicNoteId)
    : "";
  const rankingVisible = publicNoteId && source.rankingVisible === true;
  const matchVisible = publicNoteId && source.matchVisible === true;
  const publicEntryId = rankingVisible && DANWAKU_ID_PATTERN.test(String(source.publicEntryId || ""))
    ? String(source.publicEntryId)
    : "";
  return {
    schemaVersion: DANWAKU_SCHEMA_VERSION,
    activeNoteCount: integer(source.activeNoteCount, 0, 1_000_000, 0),
    noteCount: integer(source.noteCount, 0, 1_000_000, 0),
    highestEverDays: integer(source.highestEverDays, 0, 1_000_000_000, 0),
    publicNoteId,
    rankingVisible: Boolean(rankingVisible),
    matchVisible: Boolean(matchVisible),
    shareTitle: Boolean(rankingVisible && source.shareTitle === true),
    displayName: publicNoteId && typeof source.displayName === "string"
      ? normalizeNfc(source.displayName).trim().slice(0, DANWAKU_DISPLAY_NAME_MAX_LENGTH)
      : "",
    publicEntryId,
    publicDays: integer(source.publicDays, 0, 1_000_000_000, 0),
    publicTitle: rankingVisible && source.shareTitle === true && typeof source.publicTitle === "string"
      ? normalizeNfc(source.publicTitle).trim().slice(0, DANWAKU_TITLE_MAX_LENGTH)
      : "",
    publicLastContinuedAt: integer(source.publicLastContinuedAt, 0),
    rankingExpiresAt: integer(source.rankingExpiresAt, 0),
    revision: integer(source.revision, 0),
    createdAt: integer(source.createdAt, 1, Number.MAX_SAFE_INTEGER, fallback.createdAt),
    updatedAt: integer(source.updatedAt, 1, Number.MAX_SAFE_INTEGER, fallback.updatedAt),
  };
}

function emptyDanwakuNote({ noteId, title, commitment = "", timestamp = Date.now() }) {
  const now = integer(timestamp, 1, Number.MAX_SAFE_INTEGER, Date.now());
  return {
    schemaVersion: DANWAKU_SCHEMA_VERSION,
    noteId: requireDanwakuId(noteId),
    title: normalizeDanwakuTitle(title),
    commitment: normalizeDanwakuCommitment(commitment),
    status: "active",
    currentDays: 0,
    bestDays: 0,
    totalContinuedDays: 0,
    resetCount: 0,
    currentRunStartedDayKey: "",
    lastContinueDayKey: "",
    lastContinueAt: 0,
    lastResetDayKey: "",
    createdAt: now,
    updatedAt: now,
    archivedAt: 0,
    deletedAt: 0,
    revision: 1,
  };
}

function normalizeDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

function normalizeDanwakuNote(value, noteIdValue = "") {
  if (!isRecord(value)) return null;
  const noteId = DANWAKU_ID_PATTERN.test(String(value.noteId || ""))
    ? String(value.noteId)
    : DANWAKU_ID_PATTERN.test(String(noteIdValue || ""))
      ? String(noteIdValue)
      : "";
  if (!noteId) return null;
  const status = DANWAKU_NOTE_STATUSES.includes(value.status) ? value.status : "active";
  const currentDays = status === "deleted" ? 0 : integer(value.currentDays, 0, 1_000_000_000, 0);
  const title = status === "deleted" ? "" : String(value.title || "").normalize("NFC").trim();
  const commitment = status === "deleted" ? "" : String(value.commitment || "").normalize("NFC").trim();
  return {
    schemaVersion: DANWAKU_SCHEMA_VERSION,
    noteId,
    title,
    commitment,
    status,
    currentDays,
    bestDays: Math.max(currentDays, integer(value.bestDays, 0, 1_000_000_000, 0)),
    totalContinuedDays: integer(value.totalContinuedDays, 0, 1_000_000_000, 0),
    resetCount: integer(value.resetCount, 0, 1_000_000_000, 0),
    currentRunStartedDayKey: normalizeDayKey(value.currentRunStartedDayKey),
    lastContinueDayKey: normalizeDayKey(value.lastContinueDayKey),
    lastContinueAt: integer(value.lastContinueAt, 0),
    lastResetDayKey: normalizeDayKey(value.lastResetDayKey),
    createdAt: integer(value.createdAt, 1, Number.MAX_SAFE_INTEGER, Date.now()),
    updatedAt: integer(value.updatedAt, 1, Number.MAX_SAFE_INTEGER, Date.now()),
    archivedAt: integer(value.archivedAt, 0),
    deletedAt: integer(value.deletedAt, 0),
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, 1),
  };
}

function requireMutableNote(noteValue, { activeOnly = false } = {}) {
  const note = normalizeDanwakuNote(noteValue);
  if (!note || note.status === "deleted") {
    throw new DanwakuNoteError("not-found", "断惑NOTEが見つかりません。");
  }
  if (activeOnly && note.status !== "active") {
    throw new DanwakuNoteError("failed-precondition", "終了した断惑NOTEでは記録できません。");
  }
  return note;
}

function nextDanwakuProfile(profileValue, timestamp) {
  const profile = normalizeDanwakuProfile(profileValue, timestamp);
  return {
    ...profile,
    revision: Math.min(Number.MAX_SAFE_INTEGER, profile.revision + 1),
    updatedAt: timestamp,
  };
}

function refreshDanwakuPublicCache(profileValue, noteValue, timestamp) {
  const profile = nextDanwakuProfile(profileValue, timestamp);
  const note = normalizeDanwakuNote(noteValue);
  if (!profile.publicNoteId || !note || note.noteId !== profile.publicNoteId
      || note.status !== "active") {
    return {
      ...profile,
      publicNoteId: "",
      rankingVisible: false,
      matchVisible: false,
      shareTitle: false,
      displayName: "",
      publicEntryId: "",
      publicDays: 0,
      publicTitle: "",
      publicLastContinuedAt: 0,
      rankingExpiresAt: 0,
    };
  }
  return {
    ...profile,
    publicDays: note.currentDays,
    publicTitle: profile.rankingVisible && profile.shareTitle ? note.title : "",
    publicLastContinuedAt: note.lastContinueAt,
    rankingExpiresAt: note.lastContinueAt > 0
      ? note.lastContinueAt + DANWAKU_RANKING_FRESH_MS
      : 0,
  };
}

function continueDanwakuNote(noteValue, profileValue, timestamp = Date.now()) {
  const note = requireMutableNote(noteValue, { activeOnly: true });
  const dayKey = danwakuDayKey(timestamp);
  if (note.lastResetDayKey === dayKey) {
    return { outcome: "reset-today", changed: false, note, profile: normalizeDanwakuProfile(profileValue) };
  }
  if (note.lastContinueDayKey === dayKey) {
    return { outcome: "already-recorded", changed: false, note, profile: normalizeDanwakuProfile(profileValue) };
  }
  const currentDays = note.currentDays + 1;
  const nextNote = {
    ...note,
    currentDays,
    bestDays: Math.max(note.bestDays, currentDays),
    totalContinuedDays: note.totalContinuedDays + 1,
    currentRunStartedDayKey: note.currentDays > 0 && note.currentRunStartedDayKey
      ? note.currentRunStartedDayKey
      : dayKey,
    lastContinueDayKey: dayKey,
    lastContinueAt: timestamp,
    updatedAt: timestamp,
    revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
  };
  const previousProfile = normalizeDanwakuProfile(profileValue, timestamp);
  const highestEverDays = Math.max(previousProfile.highestEverDays, nextNote.bestDays);
  const nextProfile = previousProfile.publicNoteId === nextNote.noteId
    ? refreshDanwakuPublicCache({ ...previousProfile, highestEverDays }, nextNote, timestamp)
    : { ...nextDanwakuProfile(previousProfile, timestamp), highestEverDays };
  return {
    outcome: "recorded",
    changed: true,
    dayKey,
    note: nextNote,
    profile: nextProfile,
    event: {
      type: "continue",
      noteId: nextNote.noteId,
      dayKey,
      beforeDays: note.currentDays,
      afterDays: nextNote.currentDays,
      createdAt: timestamp,
    },
  };
}

function resetDanwakuNote(noteValue, profileValue, timestamp = Date.now()) {
  const note = requireMutableNote(noteValue, { activeOnly: true });
  const dayKey = danwakuDayKey(timestamp);
  if (note.currentDays === 0) {
    return { outcome: "already-zero", changed: false, note, profile: normalizeDanwakuProfile(profileValue) };
  }
  if (note.lastResetDayKey === dayKey) {
    return { outcome: "already-reset", changed: false, note, profile: normalizeDanwakuProfile(profileValue) };
  }
  const nextNote = {
    ...note,
    currentDays: 0,
    resetCount: note.resetCount + 1,
    currentRunStartedDayKey: "",
    lastResetDayKey: dayKey,
    updatedAt: timestamp,
    revision: Math.min(Number.MAX_SAFE_INTEGER, note.revision + 1),
  };
  const previousProfile = normalizeDanwakuProfile(profileValue, timestamp);
  const nextProfile = previousProfile.publicNoteId === nextNote.noteId
    ? refreshDanwakuPublicCache(previousProfile, nextNote, timestamp)
    : nextDanwakuProfile(previousProfile, timestamp);
  return {
    outcome: "reset",
    changed: true,
    dayKey,
    note: nextNote,
    profile: nextProfile,
    event: {
      type: "reset",
      noteId: nextNote.noteId,
      dayKey,
      beforeDays: note.currentDays,
      afterDays: 0,
      createdAt: timestamp,
    },
  };
}

function danwakuPublicEntry(profileValue, noteValue, timestamp = Date.now()) {
  const profile = normalizeDanwakuProfile(profileValue, timestamp);
  const note = normalizeDanwakuNote(noteValue);
  if (!profile.rankingVisible || !profile.publicEntryId || !profile.publicNoteId
      || !note || note.noteId !== profile.publicNoteId || note.status !== "active"
      || note.currentDays <= 0 || note.lastContinueAt <= 0) return null;
  const expiresAt = note.lastContinueAt + DANWAKU_RANKING_FRESH_MS;
  if (expiresAt <= timestamp || !profile.displayName) return null;
  return {
    days: note.currentDays,
    displayName: profile.displayName,
    ...(profile.shareTitle ? { title: note.title } : {}),
    expiresAt,
    lastContinuedDayKey: note.lastContinueDayKey,
  };
}

function rankDanwakuPublicEntries(
  entriesValue,
  {
    viewerEntryId = "",
    timestamp = Date.now(),
    topLimit = DANWAKU_RANKING_TOP_LIMIT,
    nearbyRadius = DANWAKU_RANKING_NEARBY_RADIUS,
  } = {},
) {
  const todayKey = danwakuDayKey(timestamp);
  const entries = Array.isArray(entriesValue) ? entriesValue : [];
  const normalized = entries.flatMap((value) => {
    if (!isRecord(value) || !DANWAKU_ID_PATTERN.test(String(value.entryId || ""))) return [];
    const days = Number(value.days);
    const expiresAt = Number(value.expiresAt);
    const displayName = typeof value.displayName === "string"
      ? normalizeNfc(value.displayName).trim()
      : "";
    const lastContinuedDayKey = normalizeDayKey(value.lastContinuedDayKey);
    if (!Number.isSafeInteger(days) || days < 1 || days > 1_000_000_000
        || !Number.isSafeInteger(expiresAt) || expiresAt <= timestamp
        || !displayName || unicodeLength(displayName) > DANWAKU_DISPLAY_NAME_MAX_LENGTH
        || ONE_LINE_CONTROL_PATTERN.test(displayName) || !lastContinuedDayKey) return [];
    const title = typeof value.title === "string" ? normalizeNfc(value.title).trim() : "";
    return [{
      entryId: String(value.entryId),
      days,
      displayName,
      ...(title && unicodeLength(title) <= DANWAKU_TITLE_MAX_LENGTH
        && !ONE_LINE_CONTROL_PATTERN.test(title) ? { title } : {}),
      expiresAt,
      lastContinuedDayKey,
    }];
  });
  normalized.sort((left, right) => (
    right.days - left.days || left.entryId.localeCompare(right.entryId)
  ));
  let previousDays = null;
  const ranked = normalized.map((entry, index) => {
    const rank = previousDays === entry.days ? null : index + 1;
    if (rank !== null) previousDays = entry.days;
    return { ...entry, rank };
  });
  let inheritedRank = 0;
  for (const entry of ranked) {
    if (entry.rank !== null) inheritedRank = entry.rank;
    else entry.rank = inheritedRank;
  }
  const row = (entry) => ({
    rank: entry.rank,
    days: entry.days,
    displayName: entry.displayName,
    isViewer: entry.entryId === viewerEntryId,
    ...(entry.title ? { title: entry.title } : {}),
  });
  const safeTopLimit = integer(topLimit, 1, DANWAKU_RANKING_TOP_LIMIT, DANWAKU_RANKING_TOP_LIMIT);
  const safeRadius = integer(
    nearbyRadius,
    0,
    DANWAKU_RANKING_NEARBY_RADIUS,
    DANWAKU_RANKING_NEARBY_RADIUS,
  );
  const viewerIndex = ranked.findIndex((entry) => entry.entryId === viewerEntryId);
  const nearby = viewerIndex < 0 ? [] : ranked
    .slice(Math.max(0, viewerIndex - safeRadius), viewerIndex + safeRadius + 1)
    .map(row);
  return {
    top: ranked.slice(0, safeTopLimit).map(row),
    nearby,
    viewerRank: viewerIndex < 0 ? null : ranked[viewerIndex].rank,
    participantCount: ranked.length,
    todayCount: ranked.filter((entry) => entry.lastContinuedDayKey === todayKey).length,
  };
}

function danwakuMatchBadge(profileValue, noteValue) {
  const profile = normalizeDanwakuProfile(profileValue);
  const note = normalizeDanwakuNote(noteValue);
  if (!profile.matchVisible || !profile.publicNoteId || !note
      || note.noteId !== profile.publicNoteId || note.status !== "active"
      || note.currentDays <= 0) return null;
  return { days: note.currentDays };
}

function publicDanwakuProfile(profileValue) {
  const profile = normalizeDanwakuProfile(profileValue);
  return {
    activeNoteCount: profile.activeNoteCount,
    noteCount: profile.noteCount,
    highestEverDays: profile.highestEverDays,
    publicNoteId: profile.publicNoteId,
    rankingVisible: profile.rankingVisible,
    matchVisible: profile.matchVisible,
    shareTitle: profile.shareTitle,
    displayName: profile.displayName,
    rankingExpiresAt: profile.rankingExpiresAt,
    revision: profile.revision,
    updatedAt: profile.updatedAt,
  };
}

function publicDanwakuNote(noteValue) {
  const note = normalizeDanwakuNote(noteValue);
  if (!note || note.status === "deleted") return null;
  return { ...note };
}

module.exports = Object.freeze({
  DANWAKU_ACTIONS,
  DANWAKU_ACTIVE_NOTE_LIMIT,
  DANWAKU_ARCHIVED_NOTE_LIMIT,
  DANWAKU_COMMITMENT_MAX_LENGTH,
  DANWAKU_DAY_START_HOUR_JST,
  DANWAKU_DISPLAY_NAME_MAX_LENGTH,
  DANWAKU_HISTORY_LIMIT,
  DANWAKU_ID_PATTERN,
  DANWAKU_NOTE_STATUSES,
  DANWAKU_OPERATION_ID_PATTERN,
  DANWAKU_RANKING_FRESH_MS,
  DANWAKU_RANKING_NEARBY_RADIUS,
  DANWAKU_RANKING_READ_LIMIT,
  DANWAKU_RANKING_TOP_LIMIT,
  DANWAKU_SCHEMA_VERSION,
  DANWAKU_TITLE_MAX_LENGTH,
  DanwakuNoteError,
  continueDanwakuNote,
  createDanwakuOpaqueId,
  danwakuDayKey,
  danwakuEventId,
  danwakuMatchBadge,
  danwakuPublicEntry,
  deterministicDanwakuId,
  emptyDanwakuNote,
  emptyDanwakuProfile,
  normalizeDanwakuActionData,
  normalizeDanwakuCommitment,
  normalizeDanwakuDisplayName,
  normalizeDanwakuNote,
  normalizeDanwakuProfile,
  normalizeDanwakuTitle,
  nextDanwakuBoundaryAt,
  publicDanwakuNote,
  publicDanwakuProfile,
  refreshDanwakuPublicCache,
  rankDanwakuPublicEntries,
  resetDanwakuNote,
});
