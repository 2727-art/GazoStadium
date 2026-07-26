import {
  STRATEGY_REVIEW_AUDIO_MAX_BYTES,
  STRATEGY_REVIEW_AUDIO_MAX_SECONDS,
  STRATEGY_REVIEW_IMAGE_MAX_BYTES,
  STRATEGY_REVIEW_IMAGE_MAX_SIDE,
  strategyReviewWavDuration,
  strategyReviewWebpDimensions,
} from "./strategy-review-asset-transfer.mjs";
import {
  STRATEGY_VIDEO_MAX_BYTES,
  STRATEGY_VIDEO_MAX_SECONDS,
  verifiedStrategyVideoMime,
} from "./strategy-video-transfer.mjs";

export const FREE_TABLE_MEDIA_CHANNEL_LABEL = "hariai-free-table-media-v1";
export const FREE_TABLE_MEDIA_PROTOCOL_VERSION = 1;
export const FREE_TABLE_MEDIA_CHUNK_BYTES = 16 * 1024;
export const FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES = 64 * 1024;
export const FREE_TABLE_MEDIA_BUFFER_LIMIT = 256 * 1024;
export const FREE_TABLE_MEDIA_BUFFER_TIMEOUT_MS = 15_000;
export const FREE_TABLE_IMAGE_MAX_BYTES = STRATEGY_REVIEW_IMAGE_MAX_BYTES;
export const FREE_TABLE_IMAGE_MAX_SIDE = STRATEGY_REVIEW_IMAGE_MAX_SIDE;
export const FREE_TABLE_AUDIO_MAX_BYTES = STRATEGY_REVIEW_AUDIO_MAX_BYTES;
export const FREE_TABLE_AUDIO_MAX_SECONDS = STRATEGY_REVIEW_AUDIO_MAX_SECONDS;
export const FREE_TABLE_VIDEO_MAX_BYTES = STRATEGY_VIDEO_MAX_BYTES;
export const FREE_TABLE_VIDEO_MAX_SECONDS = STRATEGY_VIDEO_MAX_SECONDS;

const TRANSFER_ID_PATTERN = /^ft_[a-f0-9]{24}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MEDIA_KINDS = new Set(["image", "audio", "video"]);
const MEDIA_MIMES = Object.freeze({
  image: new Set(["image/webp"]),
  audio: new Set(["audio/wav"]),
  video: new Set(["video/webm", "video/mp4"]),
});
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.35;
const VIDEO_DURATION_TOLERANCE_SECONDS = 0.6;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return MEDIA_KINDS.has(kind) ? kind : "";
}

export function normalizeFreeTableMediaMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";", 1)[0].trim() : "";
}

function maximumBytesForKind(kind) {
  if (kind === "image") return FREE_TABLE_IMAGE_MAX_BYTES;
  if (kind === "audio") return FREE_TABLE_AUDIO_MAX_BYTES;
  return FREE_TABLE_VIDEO_MAX_BYTES;
}

function maximumSecondsForKind(kind) {
  if (kind === "audio") return FREE_TABLE_AUDIO_MAX_SECONDS;
  if (kind === "video") return FREE_TABLE_VIDEO_MAX_SECONDS;
  return 0;
}

function assertSafeIdentifier(value, label) {
  const normalized = String(value || "");
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) throw new Error(`${label}を確認できません。`);
  return normalized;
}

function declaredDurationForKind(kind, value) {
  const duration = Number(value || 0);
  if (kind === "image") {
    if (duration !== 0) throw new Error("画像に再生時間を指定できません。");
    return 0;
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > maximumSecondsForKind(kind) + 0.1) {
    throw new Error(`${kind === "audio" ? "音声" : "動画"}は10秒以内にしてください。`);
  }
  return duration;
}

export function verifyFreeTableMediaBytes(value, {
  kind,
  mime,
  duration = 0,
} = {}) {
  const bytes = bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空のメディアは貼れません。");
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) throw new Error("メディアの種類が不正です。");
  if (bytes.byteLength > maximumBytesForKind(normalizedKind)) {
    if (normalizedKind === "image") throw new Error("画像は約1.5MB以内にしてください。");
    if (normalizedKind === "audio") throw new Error("音声は約480KB以内にしてください。");
    throw new Error("動画は約2MB以内にしてください。");
  }
  const declaredMime = normalizeFreeTableMediaMime(mime);
  if (!MEDIA_MIMES[normalizedKind].has(declaredMime)) throw new Error("メディアの申告形式が不正です。");
  const declaredDuration = declaredDurationForKind(normalizedKind, duration);

  if (normalizedKind === "image") {
    strategyReviewWebpDimensions(bytes);
    return { mime: "image/webp", duration: 0 };
  }
  if (normalizedKind === "audio") {
    const actualDuration = strategyReviewWavDuration(bytes);
    if (Math.abs(actualDuration - declaredDuration) > AUDIO_DURATION_TOLERANCE_SECONDS) {
      throw new Error("音声の申告時間と実データが一致しません。");
    }
    return { mime: "audio/wav", duration: actualDuration };
  }

  const actualMime = verifiedStrategyVideoMime(bytes, declaredMime);
  return { mime: actualMime, duration: declaredDuration };
}

function normalizeTransferMessage(message, {
  expectedOwnerUid = "",
  expectedSessionId = "",
  requireExpectedContext = false,
  now = Date.now(),
} = {}) {
  if (message?.type !== "free-table-media-start") throw new Error("自由卓メディアの開始情報が不正です。");
  if (Number(message.protocolVersion) !== FREE_TABLE_MEDIA_PROTOCOL_VERSION) {
    throw new Error("自由卓メディアの通信バージョンが一致しません。");
  }
  const transferId = String(message.transferId || "");
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw new Error("自由卓メディアの転送IDが不正です。");
  const ownerUid = assertSafeIdentifier(message.ownerUid, "送信者");
  const sessionId = assertSafeIdentifier(message.sessionId, "自由卓");
  if (requireExpectedContext && (!expectedOwnerUid || !expectedSessionId)) {
    throw new Error("自由卓メディアの受信元を確認できません。");
  }
  if (expectedOwnerUid && ownerUid !== expectedOwnerUid) throw new Error("同席者以外からのメディアは受信できません。");
  if (expectedSessionId && sessionId !== expectedSessionId) throw new Error("別の自由卓からのメディアは受信できません。");
  const kind = normalizeKind(message.kind);
  if (!kind) throw new Error("自由卓メディアの種類が不正です。");
  const mime = normalizeFreeTableMediaMime(message.mime);
  if (!MEDIA_MIMES[kind].has(mime)) throw new Error("自由卓メディアの形式が不正です。");
  const size = Number(message.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytesForKind(kind)) {
    throw new Error("自由卓メディアの受信サイズが不正です。");
  }
  const duration = declaredDurationForKind(kind, message.duration);
  const createdAt = Number(message.createdAt ?? now);
  return {
    type: "free-table-media-start",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId,
    ownerUid,
    sessionId,
    kind,
    mime,
    size,
    duration,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
  };
}

export function createIncomingFreeTableMediaTransfer(message, {
  currentTransfer = null,
  expectedOwnerUid,
  expectedSessionId,
  now = Date.now(),
} = {}) {
  if (currentTransfer) throw new Error("別の自由卓メディアを受信中です。");
  return {
    ...normalizeTransferMessage(message, {
      expectedOwnerUid,
      expectedSessionId,
      requireExpectedContext: true,
      now,
    }),
    received: 0,
    chunks: [],
  };
}

export async function appendIncomingFreeTableMediaChunk(transfer, value) {
  if (!transfer || !Array.isArray(transfer.chunks)) throw new Error("開始されていない自由卓メディアを受信しました。");
  let bytes;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    if (value.size > FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES) {
      throw new Error("自由卓メディアの1回の受信サイズが大きすぎます。");
    }
    bytes = new Uint8Array(await value.arrayBuffer());
  }
  else bytes = bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空の自由卓メディアを受信しました。");
  if (bytes.byteLength > FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES) {
    throw new Error("自由卓メディアの1回の受信サイズが大きすぎます。");
  }
  if (transfer.received + bytes.byteLength > transfer.size) {
    throw new Error("自由卓メディアの受信サイズが申告値を超えました。");
  }
  transfer.chunks.push(bytes.slice().buffer);
  transfer.received += bytes.byteLength;
  return transfer.received;
}

export function freeTableMediaEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  const matches = message
    && message.type === "free-table-media-end"
    && Number(message.protocolVersion) === FREE_TABLE_MEDIA_PROTOCOL_VERSION
    && String(message.transferId || "") === transfer.transferId
    && String(message.ownerUid || "") === transfer.ownerUid
    && String(message.sessionId || "") === transfer.sessionId
    && String(message.kind || "") === transfer.kind
    && normalizeFreeTableMediaMime(message.mime) === transfer.mime
    && Number(message.size) === transfer.size
    && Number(message.duration || 0) === transfer.duration;
  if (!matches) return "mismatch";
  if (transfer.received !== transfer.size) return "incomplete";
  return "complete";
}

function createMediaResource(blob, metadata, { urlApi = globalThis.URL } = {}) {
  return {
    id: metadata.transferId,
    transferId: metadata.transferId,
    ownerUid: metadata.ownerUid,
    sessionId: metadata.sessionId,
    kind: metadata.kind,
    mime: metadata.mime,
    duration: Number(metadata.duration || 0),
    size: blob.size,
    createdAt: Number(metadata.createdAt || Date.now()),
    blob,
    url: typeof urlApi?.createObjectURL === "function" ? urlApi.createObjectURL(blob) : "",
    released: false,
  };
}

export async function finishIncomingFreeTableMediaTransfer(transfer, endMessage, {
  BlobClass = globalThis.Blob,
  urlApi = globalThis.URL,
} = {}) {
  const status = freeTableMediaEndStatus(transfer, endMessage);
  if (status === "orphan") return null;
  if (status === "mismatch") throw new Error("自由卓メディアの終端情報が一致しません。");
  if (status === "incomplete") throw new Error("自由卓メディアの受信が完了していません。");
  if (typeof BlobClass !== "function") throw new Error("このブラウザは自由卓メディアの生成に対応していません。");
  const rawBlob = new BlobClass(transfer.chunks, { type: transfer.mime });
  if (rawBlob.size !== transfer.size) throw new Error("自由卓メディアの受信サイズが一致しませんでした。");
  const verified = verifyFreeTableMediaBytes(await rawBlob.arrayBuffer(), transfer);
  const blob = rawBlob.type === verified.mime ? rawBlob : new BlobClass([rawBlob], { type: verified.mime });
  return createMediaResource(blob, {
    ...transfer,
    mime: verified.mime,
    duration: verified.duration,
  }, { urlApi });
}

export async function createLocalFreeTableMediaResource(asset, metadata, {
  urlApi = globalThis.URL,
} = {}) {
  if (!asset?.blob || typeof asset.blob.arrayBuffer !== "function") throw new Error("貼るメディアがありません。");
  const transferId = metadata?.transferId || createFreeTableMediaTransferId();
  const verified = verifyFreeTableMediaBytes(await asset.blob.arrayBuffer(), {
    kind: asset.kind,
    mime: asset.mime || asset.blob.type,
    duration: asset.duration,
  });
  const transfer = normalizeTransferMessage({
    type: "free-table-media-start",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId,
    ownerUid: metadata?.ownerUid,
    sessionId: metadata?.sessionId,
    kind: asset.kind,
    mime: verified.mime,
    size: asset.blob.size,
    duration: verified.duration,
    createdAt: metadata?.createdAt ?? Date.now(),
  });
  const blob = asset.blob.type === verified.mime
    ? asset.blob
    : new Blob([asset.blob], { type: verified.mime });
  return createMediaResource(blob, transfer, { urlApi });
}

export function releaseFreeTableMediaResource(resource, { urlApi = globalThis.URL } = {}) {
  if (!resource || resource.released) return;
  if (resource.url && typeof urlApi?.revokeObjectURL === "function") urlApi.revokeObjectURL(resource.url);
  resource.url = "";
  resource.blob = null;
  resource.released = true;
}

export function releaseFreeTableMediaResources(resources, options) {
  const values = resources instanceof Map ? resources.values() : resources || [];
  for (const resource of values) releaseFreeTableMediaResource(resource, options);
  if (typeof resources?.clear === "function") resources.clear();
  else if (Array.isArray(resources)) resources.length = 0;
}

export function createFreeTableMediaTransferId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("安全な自由卓メディア転送IDを生成できません。");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(12));
  return `ft_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createOutgoingFreeTableMediaTransfer(asset, metadata) {
  if (!asset?.blob || typeof asset.blob.arrayBuffer !== "function") throw new Error("貼るメディアがありません。");
  const buffer = await asset.blob.arrayBuffer();
  const verified = verifyFreeTableMediaBytes(buffer, {
    kind: asset.kind,
    mime: asset.mime || asset.blob.type,
    duration: asset.duration,
  });
  const transfer = normalizeTransferMessage({
    type: "free-table-media-start",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId: metadata?.transferId || createFreeTableMediaTransferId(),
    ownerUid: metadata?.ownerUid,
    sessionId: metadata?.sessionId,
    kind: asset.kind,
    mime: verified.mime,
    size: buffer.byteLength,
    duration: verified.duration,
    createdAt: metadata?.createdAt ?? asset.createdAt ?? Date.now(),
  });
  return { transfer, buffer };
}

export function freeTableMediaStartMessage(transfer) {
  return {
    type: "free-table-media-start",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    sessionId: transfer.sessionId,
    kind: transfer.kind,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
    createdAt: transfer.createdAt,
  };
}

export function freeTableMediaEndMessage(transfer) {
  return {
    type: "free-table-media-end",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    sessionId: transfer.sessionId,
    kind: transfer.kind,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
  };
}

export function freeTableMediaCancelMessage(transfer) {
  return {
    type: "free-table-media-cancel",
    protocolVersion: FREE_TABLE_MEDIA_PROTOCOL_VERSION,
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    sessionId: transfer.sessionId,
  };
}

export function isFreeTableMediaCancelFor(transfer, message) {
  return Boolean(transfer
    && message?.type === "free-table-media-cancel"
    && Number(message.protocolVersion) === FREE_TABLE_MEDIA_PROTOCOL_VERSION
    && String(message.transferId || "") === transfer.transferId
    && String(message.ownerUid || "") === transfer.ownerUid
    && String(message.sessionId || "") === transfer.sessionId);
}

export function waitForFreeTableMediaBuffer(channel, {
  limit = FREE_TABLE_MEDIA_BUFFER_LIMIT,
  timeoutMs = FREE_TABLE_MEDIA_BUFFER_TIMEOUT_MS,
  timerApi = globalThis,
} = {}) {
  if (!channel || channel.readyState !== "open") return Promise.reject(new Error("自由卓のP2P接続が閉じています。"));
  if (Number(channel.bufferedAmount || 0) <= limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const previous = channel.onbufferedamountlow;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) timerApi.clearTimeout?.(timeoutId);
      channel.onbufferedamountlow = previous || null;
      if (error) reject(error);
      else resolve();
    };
    const timeoutId = timerApi.setTimeout?.(
      () => finish(new Error("自由卓メディアの送信待ちがタイムアウトしました。")),
      timeoutMs,
    );
    channel.bufferedAmountLowThreshold = Math.max(1, Math.floor(limit / 2));
    channel.onbufferedamountlow = (event) => {
      if (typeof previous === "function") previous.call(channel, event);
      if (channel.readyState !== "open") finish(new Error("自由卓のP2P接続が閉じました。"));
      else if (Number(channel.bufferedAmount || 0) <= limit) finish();
    };
  });
}

export async function sendFreeTableMedia(channel, asset, metadata, {
  chunkBytes = FREE_TABLE_MEDIA_CHUNK_BYTES,
  waitForBuffer = waitForFreeTableMediaBuffer,
  isActive = () => true,
  onProgress = () => {},
} = {}) {
  if (!channel || channel.readyState !== "open") throw new Error("自由卓のP2P接続が完了していません。");
  const normalizedChunkBytes = Math.floor(Number(chunkBytes));
  if (!Number.isFinite(normalizedChunkBytes)
      || normalizedChunkBytes <= 0
      || normalizedChunkBytes > FREE_TABLE_MEDIA_MAX_RECEIVE_CHUNK_BYTES) {
    throw new Error("自由卓メディアのチャンクサイズが不正です。");
  }
  const { transfer, buffer } = await createOutgoingFreeTableMediaTransfer(asset, metadata);
  let started = false;
  let ended = false;
  try {
    if (!isActive()) throw new Error("自由卓が終了したためメディアを貼れません。");
    channel.send(JSON.stringify(freeTableMediaStartMessage(transfer)));
    started = true;
    for (let offset = 0; offset < buffer.byteLength; offset += normalizedChunkBytes) {
      await waitForBuffer(channel);
      if (!isActive() || channel.readyState !== "open") throw new Error("自由卓メディアのP2P転送が中断されました。");
      const end = Math.min(buffer.byteLength, offset + normalizedChunkBytes);
      channel.send(buffer.slice(offset, end));
      onProgress(Math.round((end / buffer.byteLength) * 100));
    }
    channel.send(JSON.stringify(freeTableMediaEndMessage(transfer)));
    ended = true;
    return transfer;
  } catch (error) {
    if (started && !ended && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(freeTableMediaCancelMessage(transfer)));
      } catch {
        // Preserve the original transfer failure.
      }
    }
    throw error;
  }
}
