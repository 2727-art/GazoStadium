export const STRATEGY_DECK_SCHEMA_VERSION = 1;
export const STRATEGY_DECK_MAIN_COUNT = 5;
export const STRATEGY_DECK_RESERVE_COUNT = 5;
export const STRATEGY_DECK_AUDIO_MAX_SECONDS = 10;
export const STRATEGY_DECK_AUDIO_CUE_SECONDS = 3;
export const STRATEGY_DECK_AUDIO_NAME_MAX_LENGTH = 80;

export const STRATEGY_DECK_DATABASE_NAME = "hariai-stadium-strategy-decks-v1";
export const STRATEGY_DECK_DATABASE_VERSION = 1;
export const STRATEGY_DECK_STORE_NAME = "decks";

// A Strategy screen can be torn down and recreated while an IndexedDB write is
// still pending. Keep one invocation-order queue per UID so an older save can
// never finish after a newer delete/save and resurrect stale media.
const strategyDeckOperationTails = new Map();

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

function serializeCard(card, label) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw validationError(`${label}を読み取れません。`);
  }
  if (hasSampleFlag(card)) {
    throw validationError(`${label}にはサンプル画像を使用できません。`);
  }

  const blob = card.blob ?? card.imageBlob;
  if (!isBlobOfType(blob, "image/webp")) {
    throw validationError(`${label}の画像はWebP形式である必要があります。`);
  }

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

  if (!isBlobOfType(audioBlob, "audio/wav")) {
    throw validationError(`${label}の音声はWAV形式である必要があります。`);
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

function normalizeUpdatedAt(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw validationError("戦略デッキの更新日時が不正です。");
  }
  return value;
}

/** Returns true only when both zones contain five persistable, non-sample cards. */
export function hasCompleteStrategyDeck(main, reserve) {
  try {
    requireDeckZone(main, STRATEGY_DECK_MAIN_COUNT, "メインデッキ");
    requireDeckZone(reserve, STRATEGY_DECK_RESERVE_COUNT, "リザーブ");
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the complete record written by one IndexedDB put. Only reusable media
 * and its audio metadata are copied; match-local IDs, URLs and usage state are
 * intentionally omitted.
 */
export function serializeStrategyDeck({ uid, main, reserve, updatedAt = Date.now() } = {}) {
  return {
    schemaVersion: STRATEGY_DECK_SCHEMA_VERSION,
    uid: normalizeUid(uid),
    main: requireDeckZone(main, STRATEGY_DECK_MAIN_COUNT, "メインデッキ"),
    reserve: requireDeckZone(reserve, STRATEGY_DECK_RESERVE_COUNT, "リザーブ"),
    updatedAt: normalizeUpdatedAt(updatedAt),
  };
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

export function openStrategyDeckDatabase({ indexedDB = globalThis.indexedDB } = {}) {
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
    try {
      request = factory.open(STRATEGY_DECK_DATABASE_NAME, STRATEGY_DECK_DATABASE_VERSION);
    } catch (error) {
      reject(storageError("storage-open-failed", "戦略デッキの保存領域を開けませんでした。", error));
      return;
    }

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(storageError("storage-open-failed", "戦略デッキの保存領域を開けませんでした。", error));
    };
    request.onupgradeneeded = () => {
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
      resolve(request.result);
    };
    request.onerror = () => fail(upgradeError || request.error);
    request.onblocked = () => fail(new Error("IndexedDB upgrade was blocked."));
  });
}

function runStoreTransaction(database, mode, operation, errorCode, errorMessage) {
  return new Promise((resolve, reject) => {
    let transaction;
    let request;
    let requestResult;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
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
        resolve(requestResult);
      };
      transaction.onerror = () => fail(transaction.error || request?.error);
      transaction.onabort = () => fail(transaction.error || request?.error);
    } catch (error) {
      fail(error);
    }
  });
}

/** Saves one complete UID-scoped record with a single atomic put. */
export async function saveStrategyDeck(
  { uid, main, reserve } = {},
  { indexedDB = globalThis.indexedDB, now = Date.now } = {},
) {
  const updatedAt = typeof now === "function" ? now() : now;
  // Serialize before entering the queue. Runtime arrays and metadata may be
  // edited again while an earlier IndexedDB operation is still in flight.
  const record = serializeStrategyDeck({ uid, main, reserve, updatedAt });
  return enqueueStrategyDeckOperation(record.uid, async () => {
    const database = await openStrategyDeckDatabase({ indexedDB });
    try {
      await runStoreTransaction(
        database,
        "readwrite",
        (store) => store.put(record, record.uid),
        "storage-write-failed",
        "戦略デッキをこの端末に保存できませんでした。",
      );
      return record;
    } finally {
      database.close();
    }
  });
}

/** Loads only a complete, current-schema record belonging to the requested UID. */
export async function loadStrategyDeck(uidValue, { indexedDB = globalThis.indexedDB } = {}) {
  const uid = normalizeUid(uidValue);
  // Reads join the UID queue as a barrier: they observe every mutation invoked
  // before them, and mutations invoked afterwards cannot overtake the read.
  return enqueueStrategyDeckOperation(uid, async () => {
    const database = await openStrategyDeckDatabase({ indexedDB });
    try {
      const value = await runStoreTransaction(
        database,
        "readonly",
        (store) => store.get(uid),
        "storage-read-failed",
        "この端末に保存した戦略デッキを読み込めませんでした。",
      );
      return normalizeStrategyDeckRecord(value, { expectedUid: uid });
    } finally {
      database.close();
    }
  });
}

/** Deletes only the requested user's locally saved deck. */
export async function deleteStrategyDeck(uidValue, { indexedDB = globalThis.indexedDB } = {}) {
  const uid = normalizeUid(uidValue);
  return enqueueStrategyDeckOperation(uid, async () => {
    const database = await openStrategyDeckDatabase({ indexedDB });
    try {
      await runStoreTransaction(
        database,
        "readwrite",
        (store) => store.delete(uid),
        "storage-delete-failed",
        "この端末に保存した戦略デッキを削除できませんでした。",
      );
    } finally {
      database.close();
    }
  });
}
