const DATABASE_NAME = "hariai-training-v6";
const STORE_NAME = "local-sessions";
const DATABASE_VERSION = 1;
const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1_000;

function validUid(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && !/[\u0000-\u001f\u007f.#$\[\]\/]/.test(value);
}

function openDatabase(indexedDb) {
  if (!indexedDb?.open) {
    return Promise.reject(new Error("このブラウザは画像デッキの一時保存に対応していません。"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "uid" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("画像デッキの一時保存領域を開けませんでした。"),
    );
  });
}

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(fallbackMessage));
  });
}

function transactionCompletion(transaction, database, fallbackMessage) {
  return new Promise((resolve, reject) => {
    const finish = (error = null) => {
      database.close();
      if (error) reject(error);
      else resolve();
    };
    transaction.addEventListener("complete", () => finish(), { once: true });
    transaction.addEventListener("abort", () => finish(
      transaction.error || new Error(fallbackMessage),
    ), { once: true });
  });
}

async function completeRequest({
  database,
  transaction,
  request,
  requestError,
  transactionError,
}) {
  const completion = transactionCompletion(
    transaction,
    database,
    transactionError,
  );
  try {
    const [result] = await Promise.all([
      requestResult(request, requestError),
      completion,
    ]);
    return result;
  } catch (error) {
    await completion.catch(() => {});
    throw error;
  }
}

export function createTrainingV6LocalStore({
  indexedDb = globalThis.indexedDB,
  now = () => Date.now(),
} = {}) {
  const save = async ({
    uid,
    roomId = "",
    ticketId = "",
    name,
    safety,
    images,
  } = {}) => {
    if (!validUid(uid)
        || !Array.isArray(images)
        || images.length !== 5
        || !images.every((image) => image instanceof Blob)) {
      throw new TypeError("local training session is invalid");
    }
    const database = await openDatabase(indexedDb);
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await completeRequest({
      database,
      transaction,
      request: transaction.objectStore(STORE_NAME).put({
        uid,
        roomId: String(roomId || ""),
        ticketId: String(ticketId || ""),
        name: String(name || "").slice(0, 30),
        safety: structuredClone(safety || {}),
        images,
        updatedAt: now(),
      }),
      requestError: "画像デッキを一時保存できませんでした。",
      transactionError: "画像デッキの一時保存を完了できませんでした。",
    });
    return true;
  };

  const load = async (uid) => {
    if (!validUid(uid)) return null;
    const database = await openDatabase(indexedDb);
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await completeRequest({
      database,
      transaction,
      request: transaction.objectStore(STORE_NAME).get(uid),
      requestError: "画像デッキを読み込めませんでした。",
      transactionError: "画像デッキの読み込みを完了できませんでした。",
    });
    if (!record) {
      return null;
    }
    const expired = !Number.isFinite(Number(record.updatedAt))
      || now() - Number(record.updatedAt) > MAX_RECORD_AGE_MS;
    const invalid = !Array.isArray(record.images)
        || record.images.length !== 5
        || !record.images.every((image) => image instanceof Blob);
    if (expired || invalid) {
      await remove(uid);
      return null;
    }
    return record;
  };

  const remove = async (uid) => {
    if (!validUid(uid)) return false;
    const database = await openDatabase(indexedDb);
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await completeRequest({
      database,
      transaction,
      request: transaction.objectStore(STORE_NAME).delete(uid),
      requestError: "画像デッキの一時保存を削除できませんでした。",
      transactionError: "画像デッキの一時保存削除を完了できませんでした。",
    });
    return true;
  };

  const updateBinding = async (uid, {
    roomId = "",
    ticketId = "",
  } = {}) => {
    const record = await load(uid);
    if (!record) return false;
    return save({
      ...record,
      uid,
      roomId,
      ticketId,
      images: record.images,
    });
  };

  return Object.freeze({
    save,
    load,
    remove,
    updateBinding,
  });
}
