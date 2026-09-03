import {
  normalizeOnlineImageMime,
  onlineImageMimeFromBytes,
} from "./online-image-transfer.mjs";

export const STRATEGY_DECK_SCHEMA_VERSION = 1;
export const STRATEGY_DECK_MAIN_COUNT = 5;
export const STRATEGY_DECK_RESERVE_COUNT = 5;
export const STRATEGY_DECK_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const STRATEGY_DECK_IMAGE_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
export const STRATEGY_DECK_IMAGE_MIME_TYPES = Object.freeze([
  "image/webp",
  "image/png",
  "image/jpeg",
]);
export const STRATEGY_DECK_AUDIO_MAX_SECONDS = 10;
export const STRATEGY_DECK_AUDIO_CUE_SECONDS = 3;
export const STRATEGY_DECK_AUDIO_NAME_MAX_LENGTH = 80;
export const STRATEGY_DECK_AUDIO_MAX_BYTES = 480 * 1024;
export const STRATEGY_DECK_STORAGE_TIMEOUT_MS = 12_000;

export const STRATEGY_DECK_DATABASE_NAME = "hariai-stadium-strategy-decks-v1";
export const STRATEGY_DECK_DATABASE_VERSION = 1;
export const STRATEGY_DECK_STORE_NAME = "decks";

// A Strategy screen can be torn down and recreated while an IndexedDB write is
// still pending. Keep one invocation-order queue per UID so an older save can
// never finish after a newer delete/save and resurrect stale media.
const strategyDeckOperationTails = new Map();
const strategyDeckImageMimeTypes = new Set(STRATEGY_DECK_IMAGE_MIME_TYPES);

export class StrategyDeckStorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "StrategyDeckStorageError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function validationError(message, cause) {
  return new StrategyDeckStorageError("invalid-deck", message, cause);
}

function normalizeUid(value) {
  if (typeof value !== "string") {
    throw new StrategyDeckStorageError("invalid-uid", "戦略デッキのユーザーIDが不正です。");
  }
  const uid = value.trim();
  if (!uid || uid.length > 256 || /[\u0000-\u001f\u007f]/u.test(uid)) {
    throw new StrategyDeckStorageError("invalid-uid", "戦略デッキのユーザーIDが不正です。");
  }
  return uid;
}

function isBlobOfType(value, expectedType) {
  return typeof globalThis.Blob === "function"
    && value instanceof globalThis.Blob
    && value.size > 0
    && value.type.toLowerCase() === expectedType;
}

function isSupportedImageBlob(value) {
  return typeof globalThis.Blob === "function"
    && value instanceof globalThis.Blob
    && Number.isSafeInteger(value.size)
    && value.size > 0
    && value.size <= STRATEGY_DECK_IMAGE_MAX_BYTES
    && strategyDeckImageMimeTypes.has(normalizeOnlineImageMime(value.type));
}

function hasSampleFlag(card) {
  return card?.isSample === true
    || card?.sample === true
    || card?.isSampleCard === true;
}

function normalizeAudioName(value) {
  const name = String(value || "添付音声")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, STRATEGY_DECK_AUDIO_NAME_MAX_LENGTH);
  return name || "添付音声";
}

function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${label}が不正です。`);
  }
  return value;
}

function requirePlayableCard(card, label) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw validationError(`${label}を読み取れません。`);
  }
  if (hasSampleFlag(card)) {
    throw validationError(`${label}にはサンプル画像を使用できません。`);
  }

  const blob = card.blob ?? card.imageBlob;
  if (!isSupportedImageBlob(blob)) {
    throw validationError(`${label}の画像はWebP・PNG・JPEG形式かつ15MB以下である必要があります。`);
  }
  return blob;
}

function serializeCard(card, label) {
  const blob = requirePlayableCard(card, label);

  const audioBlob = card.audioBlob ?? null;
  if (audioBlob === null) {
    const audioDuration = card.audioDuration ?? 0;
    const audioCueStart = card.audioCueStart ?? 0;
    const audioName = card.audioName ?? "";
    if (audioDuration !== 0 || audioCueStart !== 0 || audioName !== "") {
      throw validationError(`${label}の音声情報が画像と一致しません。`);
    }
    return {
      blob,
      audioBlob: null,
      audioDuration: 0,
      audioCueStart: 0,
      audioName: "",
    };
  }

  if (!isBlobOfType(audioBlob, "audio/wav") || audioBlob.size > STRATEGY_DECK_AUDIO_MAX_BYTES) {
    throw validationError(`${label}の音声は480KB以下のWAV形式である必要があります。`);
  }
  const audioDuration = requireFiniteNumber(card.audioDuration, `${label}の音声時間`);
  if (audioDuration <= 0 || audioDuration > STRATEGY_DECK_AUDIO_MAX_SECONDS) {
    throw validationError(`${label}の音声時間は10秒以内である必要があります。`);
  }
  const audioCueStart = requireFiniteNumber(card.audioCueStart ?? 0, `${label}の追撃開始位置`);
  const cueMaximum = Math.max(0, audioDuration - STRATEGY_DECK_AUDIO_CUE_SECONDS);
  if (audioCueStart < 0 || audioCueStart > cueMaximum + Number.EPSILON) {
    throw validationError(`${label}の追撃開始位置が音声の範囲外です。`);
  }

  return {
    blob,
    audioBlob,
    audioDuration,
    audioCueStart: Math.min(audioCueStart, cueMaximum),
    audioName: normalizeAudioName(card.audioName),
  };
}

function requireDeckZone(value, expectedCount, label) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw validationError(`${label}を${expectedCount}枚そろえてください。`);
  }
  return value.map((card, index) => serializeCard(card, `${label}${index + 1}枚目`));
}

function requirePlayableDeckZone(value, expectedCount, label) {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw validationError(`${label}を${expectedCount}枚そろえてください。`);
  }
  return value.map((card, index) => requirePlayableCard(card, `${label}${index + 1}枚目`));
}

function requireImageTotalWithinLimit(main, reserve) {
  const total = [...main, ...reserve].reduce((sum, blob) => sum + blob.size, 0);
  if (!Number.isSafeInteger(total) || total > STRATEGY_DECK_IMAGE_TOTAL_MAX_BYTES) {
    throw validationError("戦略デッキ画像10枚の合計は64MB以下にしてください。");
  }
}

function normalizeUpdatedAt(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw validationError("戦略デッキの更新日時が不正です。");
  }
  return value;
}

/** Returns true when both zones contain five safe, playable, non-sample images. */
export function hasPlayableStrategyDeck(main, reserve) {
  try {
    const playableMain = requirePlayableDeckZone(main, STRATEGY_DECK_MAIN_COUNT, "メインデッキ");
    const playableReserve = requirePlayableDeckZone(reserve, STRATEGY_DECK_RESERVE_COUNT, "リザーブ");
    requireImageTotalWithinLimit(playableMain, playableReserve);
    return true;
  } catch {
    return false;
  }
}

/** Returns true only when a playable deck also satisfies the persistence schema. */
export function hasPersistableStrategyDeck(main, reserve) {
  try {
    const persistableMain = requireDeckZone(main, STRATEGY_DECK_MAIN_COUNT, "メインデッキ");
    const persistableReserve = requireDeckZone(reserve, STRATEGY_DECK_RESERVE_COUNT, "リザーブ");
    requireImageTotalWithinLimit(
      persistableMain.map((card) => card.blob),
      persistableReserve.map((card) => card.blob),
    );
    return true;
  } catch {
    return false;
  }
}

// Compatibility for an older cached strategy.js. New callers choose the
// explicit playable/persistable predicate instead of coupling the two.
export function hasCompleteStrategyDeck(main, reserve) {
  return hasPlayableStrategyDeck(main, reserve);
}

/**
 * Builds the complete record written by one IndexedDB put. Only reusable media
 * and its audio metadata are copied; match-local IDs, URLs and usage state are
 * intentionally omitted.
 */
export function serializeStrategyDeck({ uid, main, reserve, updatedAt = Date.now() } = {}) {
  const serializedMain = requireDeckZone(main, STRATEGY_DECK_MAIN_COUNT, "メインデッキ");
  const serializedReserve = requireDeckZone(reserve, STRATEGY_DECK_RESERVE_COUNT, "リザーブ");
  requireImageTotalWithinLimit(
    serializedMain.map((card) => card.blob),
    serializedReserve.map((card) => card.blob),
  );
  return {
    schemaVersion: STRATEGY_DECK_SCHEMA_VERSION,
    uid: normalizeUid(uid),
    main: serializedMain,
    reserve: serializedReserve,
    updatedAt: normalizeUpdatedAt(updatedAt),
  };
}

async function requireMatchingImageBytes(blob, label, deadline) {
  const declaredMime = normalizeOnlineImageMime(blob?.type);
  let detectedMime = "";
  try {
    const bytes = await withStorageDeadline(
      blob.slice(0, 12).arrayBuffer(),
      deadline,
      `${label}の画像形式を確認する処理`,
    );
    detectedMime = onlineImageMimeFromBytes(bytes);
  } catch (error) {
    if (error instanceof StrategyDeckStorageError) throw error;
    throw validationError(`${label}の画像データを確認できません。`, error);
  }
  if (!detectedMime || detectedMime !== declaredMime) {
    throw validationError(`${label}の画像形式と実データが一致しません。`);
  }
  return detectedMime;
}

async function requireMatchingDeckImageBytes(record, deadline) {
  await Promise.all([
    ...record.main.map((card, index) => requireMatchingImageBytes(card.blob, `メインデッキ${index + 1}枚目`, deadline)),
    ...record.reserve.map((card, index) => requireMatchingImageBytes(card.blob, `リザーブ${index + 1}枚目`, deadline)),
  ]);
  return record;
}

function normalizeStoredCard(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("blob" in value)
      || !("audioBlob" in value)
      || !("audioDuration" in value)
      || !("audioCueStart" in value)
      || !("audioName" in value)) {
    return null;
  }
  try {
    const normalized = serializeCard(value, label);
    if (value.audioBlob === null) {
      if (value.audioDuration !== 0 || value.audioCueStart !== 0 || value.audioName !== "") return null;
    } else if (typeof value.audioName !== "string"
        || !value.audioName
        || value.audioName.length > STRATEGY_DECK_AUDIO_NAME_MAX_LENGTH
        || normalizeAudioName(value.audioName) !== value.audioName) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Validates data returned by IndexedDB without trusting its shape. A corrupt,
 * stale or wrong-user record is represented as null and is never partially
 * restored.
 */
export function normalizeStrategyDeckRecord(value, { expectedUid = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== STRATEGY_DECK_SCHEMA_VERSION) return null;

  let uid;
  try {
    uid = normalizeUid(value.uid);
    if (uid !== value.uid) return null;
    if (expectedUid && uid !== normalizeUid(expectedUid)) return null;
    normalizeUpdatedAt(value.updatedAt);
  } catch {
    return null;
  }

  if (!Array.isArray(value.main) || value.main.length !== STRATEGY_DECK_MAIN_COUNT) return null;
  if (!Array.isArray(value.reserve) || value.reserve.length !== STRATEGY_DECK_RESERVE_COUNT) return null;
  const main = value.main.map((card, index) => normalizeStoredCard(card, `メインデッキ${index + 1}枚目`));
  const reserve = value.reserve.map((card, index) => normalizeStoredCard(card, `リザーブ${index + 1}枚目`));
  if ([...main, ...reserve].some((card) => card === null)) return null;
  try {
    requireImageTotalWithinLimit(
      main.map((card) => card.blob),
      reserve.map((card) => card.blob),
    );
  } catch {
    return null;
  }

  return {
    schemaVersion: STRATEGY_DECK_SCHEMA_VERSION,
    uid,
    main,
    reserve,
    updatedAt: value.updatedAt,
  };
}

function requireIndexedDb(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw new StrategyDeckStorageError(
      "storage-unavailable",
      "このブラウザーは戦略デッキの端末保存に対応していません。",
    );
  }
  return indexedDB;
}

function storageError(code, message, cause) {
  if (cause instanceof StrategyDeckStorageError) return cause;
  return new StrategyDeckStorageError(code, message, cause);
}

function enqueueStrategyDeckOperation(uid, operation) {
  const previousTail = strategyDeckOperationTails.get(uid) || Promise.resolve();
  const result = previousTail.then(operation, operation);
  // The queue tail must always resolve. Callers still receive `result`, which
  // keeps the real failure, while later operations are never poisoned by it.
  const nextTail = result.then(() => undefined, () => undefined);
  strategyDeckOperationTails.set(uid, nextTail);
  nextTail.finally(() => {
    if (strategyDeckOperationTails.get(uid) === nextTail) {
      strategyDeckOperationTails.delete(uid);
    }
  });
  return result;
}

function normalizeStorageTimeout(value) {
  const timeoutMs = Number(value);
  return Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : STRATEGY_DECK_STORAGE_TIMEOUT_MS;
}

function storageTimeoutError(action) {
  return new StrategyDeckStorageError(
    "storage-timeout",
    `${action}に時間がかかっています。端末保存を待たずに続行します。`,
  );
}

function createStorageDeadline(timeoutMs) {
  return Date.now() + normalizeStorageTimeout(timeoutMs);
}

function remainingStorageTimeout(deadline, action) {
  const remaining = Math.ceil(Number(deadline) - Date.now());
  if (!Number.isSafeInteger(remaining) || remaining <= 0) throw storageTimeoutError(action);
  return remaining;
}

function withStorageDeadline(promise, deadline, action) {
  let timer = 0;
  let settled = false;
  return new Promise((resolve, reject) => {
    let remaining;
    try {
      remaining = remainingStorageTimeout(deadline, action);
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      callback(value);
    };
    timer = globalThis.setTimeout(
      () => finish(reject, storageTimeoutError(action)),
      remaining,
    );
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export function openStrategyDeckDatabase({
  indexedDB = globalThis.indexedDB,
  timeoutMs = STRATEGY_DECK_STORAGE_TIMEOUT_MS,
} = {}) {
  let factory;
  try {
    factory = requireIndexedDb(indexedDB);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let upgradeError = null;
    let request;
    let timer = 0;
    try {
      request = factory.open(STRATEGY_DECK_DATABASE_NAME, STRATEGY_DECK_DATABASE_VERSION);
    } catch (error) {
      reject(storageError("storage-open-failed", "戦略デッキの保存領域を開けませんでした。", error));
      return;
    }

    const fail = (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      reject(storageError("storage-open-failed", "戦略デッキの保存領域を開けませんでした。", error));
    };
    timer = globalThis.setTimeout(
      () => fail(storageTimeoutError("戦略デッキの保存領域を開く処理")),
      normalizeStorageTimeout(timeoutMs),
    );
    request.onupgradeneeded = () => {
      if (settled) {
        try {
          request.transaction?.abort();
        } catch {
          // A timed-out open must not perform a late schema upgrade.
        }
        return;
      }
      try {
        if (!request.result.objectStoreNames.contains(STRATEGY_DECK_STORE_NAME)) {
          request.result.createObjectStore(STRATEGY_DECK_STORE_NAME);
        }
      } catch (error) {
        upgradeError = error;
        try {
          request.transaction?.abort();
        } catch {
          // The open request's error event remains the authoritative failure.
        }
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result?.close?.();
        return;
      }
      if (upgradeError) {
        request.result?.close?.();
        fail(upgradeError);
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => fail(upgradeError || request.error);
    request.onblocked = () => fail(new Error("IndexedDB upgrade was blocked."));
  });
}

function runStoreTransaction(
  database,
  mode,
  operation,
  errorCode,
  errorMessage,
  timeoutMs = STRATEGY_DECK_STORAGE_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    let transaction;
    let request;
    let requestResult;
    let settled = false;
    let timer = 0;
    let timeoutError = null;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      reject(storageError(errorCode, errorMessage, error));
    };
    try {
      transaction = database.transaction(STRATEGY_DECK_STORE_NAME, mode);
      request = operation(transaction.objectStore(STRATEGY_DECK_STORE_NAME));
      request.onsuccess = () => {
        requestResult = request.result;
      };
      request.onerror = () => fail(request.error || transaction.error);
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(requestResult);
      };
      transaction.onerror = () => fail(transaction.error || request?.error);
      transaction.onabort = () => fail(timeoutError || transaction.error || request?.error);
      timer = globalThis.setTimeout(() => {
        if (settled) return;
        timeoutError = storageTimeoutError("戦略デッキの端末保存処理");
        try {
          transaction.abort?.();
        } catch {
          // `fail` below remains authoritative when abort is unavailable.
        }
        fail(timeoutError);
      }, normalizeStorageTimeout(timeoutMs));
    } catch (error) {
      fail(error);
    }
  });
}

/** Saves one complete UID-scoped record with a single atomic put. */
export async function saveStrategyDeck(
  { uid, main, reserve } = {},
  {
    indexedDB = globalThis.indexedDB,
    now = Date.now,
    timeoutMs = STRATEGY_DECK_STORAGE_TIMEOUT_MS,
  } = {},
) {
  const deadline = createStorageDeadline(timeoutMs);
  const updatedAt = typeof now === "function" ? now() : now;
  // Serialize before entering the queue. Runtime arrays and metadata may be
  // edited again while an earlier IndexedDB operation is still in flight.
  const record = serializeStrategyDeck({ uid, main, reserve, updatedAt });
  return enqueueStrategyDeckOperation(record.uid, async () => {
    await requireMatchingDeckImageBytes(record, deadline);
    const database = await openStrategyDeckDatabase({
      indexedDB,
      timeoutMs: remainingStorageTimeout(deadline, "戦略デッキの保存領域を開く処理"),
    });
    try {
      await runStoreTransaction(
        database,
        "readwrite",
        (store) => store.put(record, record.uid),
        "storage-write-failed",
        "戦略デッキをこの端末に保存できませんでした。",
        remainingStorageTimeout(deadline, "戦略デッキを端末へ保存する処理"),
      );
      return record;
    } finally {
      database.close();
    }
  });
}

/** Loads only a complete, current-schema record belonging to the requested UID. */
export async function loadStrategyDeck(uidValue, {
  indexedDB = globalThis.indexedDB,
  timeoutMs = STRATEGY_DECK_STORAGE_TIMEOUT_MS,
} = {}) {
  const deadline = createStorageDeadline(timeoutMs);
  const uid = normalizeUid(uidValue);
  // Reads join the UID queue as a barrier: they observe every mutation invoked
  // before them, and mutations invoked afterwards cannot overtake the read.
  return enqueueStrategyDeckOperation(uid, async () => {
    const database = await openStrategyDeckDatabase({
      indexedDB,
      timeoutMs: remainingStorageTimeout(deadline, "戦略デッキの保存領域を開く処理"),
    });
    try {
      const value = await runStoreTransaction(
        database,
        "readonly",
        (store) => store.get(uid),
        "storage-read-failed",
        "この端末に保存した戦略デッキを読み込めませんでした。",
        remainingStorageTimeout(deadline, "端末保存した戦略デッキを読み込む処理"),
      );
      const record = normalizeStrategyDeckRecord(value, { expectedUid: uid });
      if (!record) return null;
      try {
        return await requireMatchingDeckImageBytes(record, deadline);
      } catch (error) {
        if (error?.code === "storage-timeout") throw error;
        return null;
      }
    } finally {
      database.close();
    }
  });
}

/** Deletes only the requested user's locally saved deck. */
export async function deleteStrategyDeck(uidValue, {
  indexedDB = globalThis.indexedDB,
  timeoutMs = STRATEGY_DECK_STORAGE_TIMEOUT_MS,
} = {}) {
  const deadline = createStorageDeadline(timeoutMs);
  const uid = normalizeUid(uidValue);
  return enqueueStrategyDeckOperation(uid, async () => {
    const database = await openStrategyDeckDatabase({
      indexedDB,
      timeoutMs: remainingStorageTimeout(deadline, "戦略デッキの保存領域を開く処理"),
    });
    try {
      await runStoreTransaction(
        database,
        "readwrite",
        (store) => store.delete(uid),
        "storage-delete-failed",
        "この端末に保存した戦略デッキを削除できませんでした。",
        remainingStorageTimeout(deadline, "端末保存した戦略デッキを削除する処理"),
      );
    } finally {
      database.close();
    }
  });
}
