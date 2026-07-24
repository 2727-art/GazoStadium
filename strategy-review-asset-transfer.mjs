export const STRATEGY_REVIEW_IMAGE_MAX_BYTES = 1536 * 1024;
export const STRATEGY_REVIEW_IMAGE_MAX_SIDE = 1280;
export const STRATEGY_REVIEW_AUDIO_MAX_BYTES = 480 * 1024;
export const STRATEGY_REVIEW_AUDIO_MAX_SECONDS = 10;
export const STRATEGY_REVIEW_ASSET_CHUNK_BYTES = 16 * 1024;

const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const OWNER_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REVIEW_ASSET_KINDS = new Set(["image", "audio"]);
const REVIEW_ASSET_MIMES = Object.freeze({
  image: "image/webp",
  audio: "audio/wav",
});
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.35;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function normalizeKind(value) {
  const kind = String(value || "");
  return REVIEW_ASSET_KINDS.has(kind) ? kind : "";
}

function normalizeMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";", 1)[0].trim() : "";
}

function maximumBytesForKind(kind) {
  return kind === "image" ? STRATEGY_REVIEW_IMAGE_MAX_BYTES : STRATEGY_REVIEW_AUDIO_MAX_BYTES;
}

function ascii(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) return "";
  let value = "";
  for (let index = offset; index < offset + length; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

export function isStrategyReviewWebp(value) {
  const bytes = bytesFrom(value);
  return Boolean(bytes
    && bytes.byteLength >= 12
    && ascii(bytes, 0, 4) === "RIFF"
    && ascii(bytes, 8, 4) === "WEBP");
}

export function strategyReviewWebpDimensions(value) {
  const bytes = bytesFrom(value);
  if (!isStrategyReviewWebp(bytes) || bytes.byteLength < 30) throw new Error("画像の実データがWebP形式ではありません。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error("WebP画像のファイルサイズ情報が一致しません。");
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (chunkSize > bytes.byteLength - dataOffset) throw new Error("WebP画像のチャンクサイズが不正です。");
    let width = 0;
    let height = 0;
    if (chunkId === "VP8X" && chunkSize >= 10) {
      width = 1 + bytes[dataOffset + 4] + (bytes[dataOffset + 5] << 8) + (bytes[dataOffset + 6] << 16);
      height = 1 + bytes[dataOffset + 7] + (bytes[dataOffset + 8] << 8) + (bytes[dataOffset + 9] << 16);
    } else if (chunkId === "VP8L" && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      width = 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8);
      height = 1 + ((bytes[dataOffset + 2] & 0xc0) >> 6) + (bytes[dataOffset + 3] << 2) + ((bytes[dataOffset + 4] & 0x0f) << 10);
    } else if (chunkId === "VP8 " && chunkSize >= 10
        && bytes[dataOffset + 3] === 0x9d && bytes[dataOffset + 4] === 0x01 && bytes[dataOffset + 5] === 0x2a) {
      width = view.getUint16(dataOffset + 6, true) & 0x3fff;
      height = view.getUint16(dataOffset + 8, true) & 0x3fff;
    }
    if (width > 0 && height > 0) {
      if (width > STRATEGY_REVIEW_IMAGE_MAX_SIDE || height > STRATEGY_REVIEW_IMAGE_MAX_SIDE) {
        throw new Error(`画像は長辺${STRATEGY_REVIEW_IMAGE_MAX_SIDE}px以内にしてください。`);
      }
      return { width, height };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  throw new Error("WebP画像の寸法を確認できませんでした。");
}

export function strategyReviewWavDuration(value) {
  const bytes = bytesFrom(value);
  if (!bytes || bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("音声形式が不正です。WAV音声を使用してください。");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) throw new Error("WAV音声のファイルサイズ情報が一致しません。");
  let byteRate = 0;
  let dataBytes = -1;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4);
    const declaredSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (declaredSize > bytes.byteLength - dataOffset) throw new Error("WAV音声のチャンクサイズが不正です。");
    if (chunkId === "fmt ") {
      if (declaredSize < 16) throw new Error("WAV音声の形式情報が不足しています。");
      const format = view.getUint16(dataOffset, true);
      const channels = view.getUint16(dataOffset + 2, true);
      const sampleRate = view.getUint32(dataOffset + 4, true);
      byteRate = view.getUint32(dataOffset + 8, true);
      const bitsPerSample = view.getUint16(dataOffset + 14, true);
      if (format !== 1 || channels !== 1 || bitsPerSample !== 16 || sampleRate < 8_000 || sampleRate > 48_000 || byteRate !== sampleRate * 2) {
        throw new Error("音声はモノラル16bit PCM WAVに変換してください。");
      }
    } else if (chunkId === "data") {
      dataBytes = declaredSize;
    }
    offset = dataOffset + declaredSize + (declaredSize % 2);
  }
  if (!byteRate || dataBytes <= 0) throw new Error("WAV音声の再生データを確認できませんでした。");
  const duration = dataBytes / byteRate;
  if (!Number.isFinite(duration) || duration <= 0 || duration > STRATEGY_REVIEW_AUDIO_MAX_SECONDS + 0.1) {
    throw new Error("音声は10秒以内にしてください。");
  }
  return duration;
}

function verifyStrategyReviewAssetBytes(value, {
  kind,
  mime,
  duration = 0,
} = {}) {
  const bytes = bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空の品評会メディアは送信できません。");
  const normalizedKind = normalizeKind(kind);
  if (!normalizedKind) throw new Error("品評会メディアの種類が不正です。");
  const expectedMime = REVIEW_ASSET_MIMES[normalizedKind];
  if (normalizeMime(mime) !== expectedMime) throw new Error("品評会メディアの申告形式が不正です。");
  if (bytes.byteLength > maximumBytesForKind(normalizedKind)) throw new Error("品評会メディアの容量が上限を超えています。");
  if (normalizedKind === "image") {
    strategyReviewWebpDimensions(bytes);
    if (Number(duration || 0) !== 0) throw new Error("画像に再生時間を指定できません。");
    return { mime: expectedMime, duration: 0 };
  }
  const actualDuration = strategyReviewWavDuration(bytes);
  const declaredDuration = Number(duration);
  if (!Number.isFinite(declaredDuration)
      || declaredDuration <= 0
      || Math.abs(declaredDuration - actualDuration) > AUDIO_DURATION_TOLERANCE_SECONDS) {
    throw new Error("音声の申告時間と実データが一致しません。");
  }
  return { mime: expectedMime, duration: actualDuration };
}

function normalizeStrategyReviewAssetTransfer(message, {
  expectedOwnerUid = "",
  requireExpectedOwner = false,
  now = Date.now(),
} = {}) {
  if (message?.type !== "strategy-review-asset-start") throw new Error("品評会メディアの開始情報が不正です。");
  const transferId = String(message.transferId || "");
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw new Error("品評会メディアの転送IDが不正です。");
  const ownerUid = String(message.ownerUid || "");
  if (!OWNER_UID_PATTERN.test(ownerUid)) throw new Error("品評会メディアの送信者が不正です。");
  if (requireExpectedOwner && !expectedOwnerUid) throw new Error("品評会メディアの受信元を確認できません。");
  if (expectedOwnerUid && ownerUid !== expectedOwnerUid) throw new Error("対戦相手以外からのメディアは受信できません。");
  if (message.phase !== "review") throw new Error("品評会以外のメディアは受信できません。");
  const kind = normalizeKind(message.kind);
  if (!kind) throw new Error("品評会メディアの種類が不正です。");
  const mime = normalizeMime(message.mime);
  if (mime !== REVIEW_ASSET_MIMES[kind]) throw new Error("品評会メディアの形式が不正です。");
  const size = Number(message.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytesForKind(kind)) {
    throw new Error(kind === "image" ? "画像は約1.5MB以内にしてください。" : "音声は約480KB以内にしてください。");
  }
  const duration = Number(message.duration || 0);
  if ((kind === "image" && duration !== 0)
      || (kind === "audio" && (!Number.isFinite(duration) || duration <= 0 || duration > STRATEGY_REVIEW_AUDIO_MAX_SECONDS + 0.1))) {
    throw new Error("品評会メディアの再生時間が不正です。");
  }
  const createdAt = Number(message.createdAt ?? now);
  return {
    transferId,
    ownerUid,
    phase: "review",
    kind,
    mime,
    size,
    duration,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
  };
}

export function createIncomingStrategyReviewAssetTransfer(message, {
  currentTransfer = null,
  expectedOwnerUid,
  now = Date.now(),
} = {}) {
  if (currentTransfer) throw new Error("別の品評会メディアを受信中です。");
  return {
    ...normalizeStrategyReviewAssetTransfer(message, {
      expectedOwnerUid,
      requireExpectedOwner: true,
      now,
    }),
    received: 0,
    chunks: [],
  };
}

export async function appendStrategyReviewAssetChunk(transfer, value) {
  if (!transfer || !Array.isArray(transfer.chunks)) throw new Error("開始されていない品評会メディアを受信しました。");
  let bytes;
  if (typeof Blob !== "undefined" && value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
  else bytes = bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空の品評会メディアを受信しました。");
  if (transfer.received + bytes.byteLength > transfer.size) throw new Error("品評会メディアの受信サイズが申告値を超えました。");
  transfer.chunks.push(bytes.slice().buffer);
  transfer.received += bytes.byteLength;
  return transfer.received;
}

export function strategyReviewAssetEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  const matches = message
    && message.type === "strategy-review-asset-end"
    && String(message.transferId || "") === transfer.transferId
    && String(message.ownerUid || "") === transfer.ownerUid
    && message.phase === "review"
    && String(message.kind || "") === transfer.kind
    && normalizeMime(message.mime) === transfer.mime
    && Number(message.size) === transfer.size
    && Number(message.duration || 0) === transfer.duration;
  if (!matches) return "mismatch";
  if (transfer.received !== transfer.size) return "incomplete";
  return "complete";
}

function createStrategyReviewAssetResource(blob, metadata, { urlApi = globalThis.URL } = {}) {
  const url = typeof urlApi?.createObjectURL === "function" ? urlApi.createObjectURL(blob) : "";
  return {
    id: metadata.transferId || "",
    transferId: metadata.transferId || "",
    ownerUid: metadata.ownerUid || "",
    phase: "review",
    kind: metadata.kind,
    blob,
    url,
    mime: metadata.mime,
    size: blob.size,
    duration: Number(metadata.duration || 0),
    createdAt: Number(metadata.createdAt || Date.now()),
    released: false,
  };
}

export async function finishIncomingStrategyReviewAssetTransfer(transfer, endMessage, {
  BlobClass = globalThis.Blob,
  urlApi = globalThis.URL,
} = {}) {
  const status = strategyReviewAssetEndStatus(transfer, endMessage);
  if (status === "orphan") throw new Error("開始されていない品評会メディア転送が終了しました。");
  if (status === "mismatch") throw new Error("品評会メディアの終端情報が一致しません。");
  if (status === "incomplete") throw new Error("品評会メディアの受信が完了していません。");
  if (typeof BlobClass !== "function") throw new Error("このブラウザは品評会メディアの生成に対応していません。");
  const rawBlob = new BlobClass(transfer.chunks, { type: transfer.mime });
  if (rawBlob.size !== transfer.size) throw new Error("品評会メディアの受信サイズが一致しませんでした。");
  const buffer = await rawBlob.arrayBuffer();
  const verified = verifyStrategyReviewAssetBytes(buffer, transfer);
  const blob = rawBlob.type === verified.mime ? rawBlob : new BlobClass([rawBlob], { type: verified.mime });
  return createStrategyReviewAssetResource(blob, {
    ...transfer,
    mime: verified.mime,
    duration: verified.duration,
  }, { urlApi });
}

export function releaseStrategyReviewAssetResource(resource, { urlApi = globalThis.URL } = {}) {
  if (!resource || resource.released) return;
  if (resource.url && typeof urlApi?.revokeObjectURL === "function") urlApi.revokeObjectURL(resource.url);
  resource.url = "";
  resource.blob = null;
  resource.released = true;
}

export function releaseStrategyReviewAssetResources(resources, options) {
  const values = resources instanceof Map ? resources.values() : resources || [];
  for (const resource of values) releaseStrategyReviewAssetResource(resource, options);
  if (typeof resources?.clear === "function") resources.clear();
  else if (Array.isArray(resources)) resources.length = 0;
}

export function createStrategyReviewAssetTransferId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("安全な品評会メディア転送IDを生成できません。");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(12));
  return `sr_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createOutgoingStrategyReviewAssetTransfer(asset, metadata) {
  if (!asset?.blob || typeof asset.blob.arrayBuffer !== "function") throw new Error("送信する品評会メディアがありません。");
  const buffer = await asset.blob.arrayBuffer();
  const verified = verifyStrategyReviewAssetBytes(buffer, {
    kind: asset.kind,
    mime: asset.mime || asset.blob.type,
    duration: asset.duration,
  });
  const transfer = normalizeStrategyReviewAssetTransfer({
    type: "strategy-review-asset-start",
    ...metadata,
    phase: "review",
    kind: asset.kind,
    mime: verified.mime,
    size: buffer.byteLength,
    duration: verified.duration,
    createdAt: metadata?.createdAt ?? asset.createdAt ?? Date.now(),
  });
  return { transfer, buffer };
}

export function strategyReviewAssetStartMessage(transfer) {
  return {
    type: "strategy-review-asset-start",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: "review",
    kind: transfer.kind,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
    createdAt: transfer.createdAt,
  };
}

export function strategyReviewAssetEndMessage(transfer) {
  return {
    type: "strategy-review-asset-end",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: "review",
    kind: transfer.kind,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
  };
}

export async function sendStrategyReviewAsset(channel, asset, metadata, {
  chunkBytes = STRATEGY_REVIEW_ASSET_CHUNK_BYTES,
  waitForBuffer = () => Promise.resolve(),
  isActive = () => true,
  onProgress = () => {},
} = {}) {
  if (!channel || channel.readyState !== "open") throw new Error("品評会メディアのP2P接続が完了していません。");
  const normalizedChunkBytes = Math.floor(Number(chunkBytes));
  if (!Number.isFinite(normalizedChunkBytes) || normalizedChunkBytes <= 0 || normalizedChunkBytes > 64 * 1024) {
    throw new Error("品評会メディアのチャンクサイズが不正です。");
  }
  const { transfer, buffer } = await createOutgoingStrategyReviewAssetTransfer(asset, metadata);
  const endMessage = strategyReviewAssetEndMessage(transfer);
  let started = false;
  let ended = false;
  try {
    if (!isActive()) throw new Error("品評会が終了したためメディアを送信できません。");
    channel.send(JSON.stringify(strategyReviewAssetStartMessage(transfer)));
    started = true;
    for (let offset = 0; offset < buffer.byteLength; offset += normalizedChunkBytes) {
      await waitForBuffer(channel);
      if (!isActive() || channel.readyState !== "open") throw new Error("品評会メディアのP2P転送が中断されました。");
      const end = Math.min(buffer.byteLength, offset + normalizedChunkBytes);
      channel.send(buffer.slice(offset, end));
      onProgress(Math.round((end / buffer.byteLength) * 100));
    }
    channel.send(JSON.stringify(endMessage));
    ended = true;
    return transfer;
  } catch (error) {
    if (started && !ended && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(endMessage));
      } catch {
        // The original transfer error is more useful to the caller.
      }
    }
    throw error;
  }
}
