export const TEAM_ASSET_IMAGE_MAX_BYTES = 1536 * 1024;
export const TEAM_ASSET_IMAGE_MAX_SIDE = 1280;
export const TEAM_ASSET_AUDIO_MAX_BYTES = 480 * 1024;
export const TEAM_ASSET_AUDIO_MAX_SECONDS = 10;
export const TEAM_ASSET_CHUNK_BYTES = 16 * 1024;

const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const OWNER_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TEAM_ASSET_PHASES = new Set(["battle", "talk"]);
const TEAM_ASSET_KINDS = new Set(["image", "audio"]);
const TEAM_ASSET_SLOTS = new Set(["main", "reference"]);
const TEAM_ASSET_MIMES = Object.freeze({
  image: "image/webp",
  audio: "audio/wav",
});
const SLOT_BY_PHASE = Object.freeze({
  battle: "main",
  talk: "reference",
});
const AUDIO_DURATION_TOLERANCE_SECONDS = 0.35;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function normalizeEnum(value, allowed) {
  const normalized = typeof value === "string" ? value : "";
  return allowed.has(normalized) ? normalized : "";
}

function normalizeMime(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().split(";", 1)[0].trim()
    : "";
}

function maximumBytesForKind(kind) {
  return kind === "image"
    ? TEAM_ASSET_IMAGE_MAX_BYTES
    : TEAM_ASSET_AUDIO_MAX_BYTES;
}

function ascii(bytes, offset, length) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) return "";
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

export function isTeamAssetWebp(value) {
  const bytes = bytesFrom(value);
  return Boolean(
    bytes
      && bytes.byteLength >= 12
      && ascii(bytes, 0, 4) === "RIFF"
      && ascii(bytes, 8, 4) === "WEBP",
  );
}

export function teamAssetWebpDimensions(value) {
  const bytes = bytesFrom(value);
  if (!isTeamAssetWebp(bytes) || bytes.byteLength < 30) {
    throw new Error("推し上手画像の実データがWebP形式ではありません。");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) {
    throw new Error("推し上手画像のWebPファイルサイズ情報が一致しません。");
  }

  let dimensions = null;
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new Error("推し上手画像のWebPチャンク情報が途切れています。");
    }
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (chunkSize > bytes.byteLength - dataOffset) {
      throw new Error("推し上手画像のWebPチャンクサイズが不正です。");
    }

    let width = 0;
    let height = 0;
    if (chunkId === "VP8X" && chunkSize >= 10) {
      width = 1
        + bytes[dataOffset + 4]
        + (bytes[dataOffset + 5] << 8)
        + (bytes[dataOffset + 6] << 16);
      height = 1
        + bytes[dataOffset + 7]
        + (bytes[dataOffset + 8] << 8)
        + (bytes[dataOffset + 9] << 16);
    } else if (chunkId === "VP8L" && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      width = 1
        + bytes[dataOffset + 1]
        + ((bytes[dataOffset + 2] & 0x3f) << 8);
      height = 1
        + ((bytes[dataOffset + 2] & 0xc0) >> 6)
        + (bytes[dataOffset + 3] << 2)
        + ((bytes[dataOffset + 4] & 0x0f) << 10);
    } else if (
      chunkId === "VP8 "
      && chunkSize >= 10
      && bytes[dataOffset + 3] === 0x9d
      && bytes[dataOffset + 4] === 0x01
      && bytes[dataOffset + 5] === 0x2a
    ) {
      width = view.getUint16(dataOffset + 6, true) & 0x3fff;
      height = view.getUint16(dataOffset + 8, true) & 0x3fff;
    }

    if (width > 0 && height > 0) {
      if (dimensions && (dimensions.width !== width || dimensions.height !== height)) {
        throw new Error("推し上手画像のWebP寸法情報が重複しています。");
      }
      dimensions = { width, height };
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    if (paddedSize > bytes.byteLength - dataOffset) {
      throw new Error("推し上手画像のWebPパディングが不足しています。");
    }
    offset = dataOffset + paddedSize;
  }

  if (!dimensions) {
    throw new Error("推し上手画像のWebP寸法を確認できませんでした。");
  }
  if (
    dimensions.width > TEAM_ASSET_IMAGE_MAX_SIDE
    || dimensions.height > TEAM_ASSET_IMAGE_MAX_SIDE
  ) {
    throw new Error(`推し上手画像は長辺${TEAM_ASSET_IMAGE_MAX_SIDE}px以内にしてください。`);
  }
  return dimensions;
}

export function teamAssetWavDuration(value) {
  const bytes = bytesFrom(value);
  if (
    !bytes
    || bytes.byteLength < 44
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 4) !== "WAVE"
  ) {
    throw new Error("推し上手音声の形式が不正です。PCM WAV音声を使用してください。");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) {
    throw new Error("推し上手音声のWAVファイルサイズ情報が一致しません。");
  }

  let byteRate = 0;
  let sampleRate = 0;
  let dataBytes = -1;
  let foundFormat = false;
  let foundData = false;
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new Error("推し上手音声のWAVチャンク情報が途切れています。");
    }
    const chunkId = ascii(bytes, offset, 4);
    const declaredSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (declaredSize > bytes.byteLength - dataOffset) {
      throw new Error("推し上手音声のWAVチャンクサイズが不正です。");
    }

    if (chunkId === "fmt ") {
      if (foundFormat) {
        throw new Error("推し上手音声のWAV形式情報が重複しています。");
      }
      if (declaredSize < 16) {
        throw new Error("推し上手音声のWAV形式情報が不足しています。");
      }
      const format = view.getUint16(dataOffset, true);
      const channels = view.getUint16(dataOffset + 2, true);
      sampleRate = view.getUint32(dataOffset + 4, true);
      byteRate = view.getUint32(dataOffset + 8, true);
      const blockAlign = view.getUint16(dataOffset + 12, true);
      const bitsPerSample = view.getUint16(dataOffset + 14, true);
      if (
        format !== 1
        || channels !== 1
        || bitsPerSample !== 16
        || sampleRate < 8_000
        || sampleRate > 48_000
        || blockAlign !== 2
        || byteRate !== sampleRate * blockAlign
      ) {
        throw new Error("推し上手音声はモノラル16bit PCM WAVに変換してください。");
      }
      foundFormat = true;
    } else if (chunkId === "data") {
      if (foundData) {
        throw new Error("推し上手音声のWAV再生データが重複しています。");
      }
      dataBytes = declaredSize;
      foundData = true;
    }

    const paddedSize = declaredSize + (declaredSize % 2);
    if (paddedSize > bytes.byteLength - dataOffset) {
      throw new Error("推し上手音声のWAVパディングが不足しています。");
    }
    offset = dataOffset + paddedSize;
  }

  if (!foundFormat || !foundData || !byteRate || dataBytes <= 0 || dataBytes % 2 !== 0) {
    throw new Error("推し上手音声のWAV再生データを確認できませんでした。");
  }
  const duration = dataBytes / byteRate;
  const maximumWithOneSampleTolerance = TEAM_ASSET_AUDIO_MAX_SECONDS + (1 / sampleRate);
  if (!Number.isFinite(duration) || duration <= 0 || duration > maximumWithOneSampleTolerance) {
    throw new Error(`推し上手音声は${TEAM_ASSET_AUDIO_MAX_SECONDS}秒以内にしてください。`);
  }
  return duration;
}

export function verifyTeamAssetBytes(value, {
  kind,
  mime,
  duration,
} = {}) {
  const bytes = bytesFrom(value);
  if (!bytes?.byteLength) {
    throw new Error("空の推し上手メディアは送信できません。");
  }
  const normalizedKind = normalizeEnum(kind, TEAM_ASSET_KINDS);
  if (!normalizedKind) {
    throw new Error("推し上手メディアの種類が不正です。");
  }
  const expectedMime = TEAM_ASSET_MIMES[normalizedKind];
  if (normalizeMime(mime) !== expectedMime) {
    throw new Error("推し上手メディアの申告形式が不正です。");
  }
  if (bytes.byteLength > maximumBytesForKind(normalizedKind)) {
    throw new Error("推し上手メディアの容量が上限を超えています。");
  }

  if (normalizedKind === "image") {
    if (Number(duration) !== 0) {
      throw new Error("推し上手画像に再生時間を指定できません。");
    }
    return {
      kind: normalizedKind,
      mime: expectedMime,
      duration: 0,
      ...teamAssetWebpDimensions(bytes),
    };
  }

  const actualDuration = teamAssetWavDuration(bytes);
  const declaredDuration = Number(duration);
  if (
    !Number.isFinite(declaredDuration)
    || declaredDuration <= 0
    || Math.abs(declaredDuration - actualDuration) > AUDIO_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error("推し上手音声の申告時間と実データが一致しません。");
  }
  return {
    kind: normalizedKind,
    mime: expectedMime,
    duration: actualDuration,
    width: 0,
    height: 0,
  };
}

function normalizeTeamAssetTransfer(message, {
  expectedOwnerUid = "",
  requireExpectedOwner = false,
  expectedPhase = "",
} = {}) {
  if (message?.type !== "team-asset-start") {
    throw new Error("推し上手メディアの開始情報が不正です。");
  }

  const transferId = typeof message.transferId === "string" ? message.transferId : "";
  if (!TRANSFER_ID_PATTERN.test(transferId)) {
    throw new Error("推し上手メディアの転送IDが不正です。");
  }
  const ownerUid = typeof message.ownerUid === "string" ? message.ownerUid : "";
  if (!OWNER_UID_PATTERN.test(ownerUid)) {
    throw new Error("推し上手メディアの送信者が不正です。");
  }
  if (requireExpectedOwner && !OWNER_UID_PATTERN.test(expectedOwnerUid)) {
    throw new Error("推し上手メディアのP2P受信元を確認できません。");
  }
  if (expectedOwnerUid && ownerUid !== expectedOwnerUid) {
    throw new Error("接続相手以外からの推し上手メディアは受信できません。");
  }

  const phase = normalizeEnum(message.phase, TEAM_ASSET_PHASES);
  if (!phase) {
    throw new Error("推し上手メディアのフェーズが不正です。");
  }
  if (expectedPhase && phase !== expectedPhase) {
    throw new Error("現在のフェーズではこの推し上手メディアを受信できません。");
  }
  const kind = normalizeEnum(message.kind, TEAM_ASSET_KINDS);
  if (!kind) {
    throw new Error("推し上手メディアの種類が不正です。");
  }
  const slot = normalizeEnum(message.slot, TEAM_ASSET_SLOTS);
  if (!slot || slot !== SLOT_BY_PHASE[phase]) {
    throw new Error("対戦本番はメイン素材、推しトーク会は参考素材だけ送信できます。");
  }

  const mime = normalizeMime(message.mime);
  if (mime !== TEAM_ASSET_MIMES[kind]) {
    throw new Error("推し上手メディアの形式が不正です。");
  }
  const size = Number(message.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytesForKind(kind)) {
    throw new Error(
      kind === "image"
        ? "推し上手画像は約1.5MB以内にしてください。"
        : "推し上手音声は約480KB以内にしてください。",
    );
  }
  const duration = Number(message.duration);
  if (
    (kind === "image" && duration !== 0)
    || (
      kind === "audio"
      && (
        !Number.isFinite(duration)
        || duration <= 0
        || duration > TEAM_ASSET_AUDIO_MAX_SECONDS
      )
    )
  ) {
    throw new Error("推し上手メディアの再生時間が不正です。");
  }

  return {
    transferId,
    ownerUid,
    phase,
    kind,
    slot,
    mime,
    size,
    duration,
  };
}

export function createIncomingTeamAssetTransfer(message, {
  currentTransfer = null,
  expectedOwnerUid,
  expectedPhase = "",
} = {}) {
  if (currentTransfer) {
    throw new Error("別の推し上手メディアをこのP2P接続で受信中です。");
  }
  return {
    ...normalizeTeamAssetTransfer(message, {
      expectedOwnerUid,
      requireExpectedOwner: true,
      expectedPhase,
    }),
    received: 0,
    chunks: [],
  };
}

export async function appendTeamAssetChunk(transfer, value) {
  if (!transfer || !Array.isArray(transfer.chunks)) {
    throw new Error("開始されていない推し上手メディアを受信しました。");
  }
  let bytes;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else {
    bytes = bytesFrom(value);
  }
  if (!bytes?.byteLength) {
    throw new Error("空の推し上手メディアチャンクを受信しました。");
  }
  if (transfer.received + bytes.byteLength > transfer.size) {
    throw new Error("推し上手メディアの受信サイズが申告値を超えました。");
  }
  transfer.chunks.push(bytes.slice().buffer);
  transfer.received += bytes.byteLength;
  return transfer.received;
}

export function teamAssetEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  const matches = Boolean(
    message
      && message.type === "team-asset-end"
      && String(message.transferId || "") === transfer.transferId
      && String(message.ownerUid || "") === transfer.ownerUid
      && String(message.phase || "") === transfer.phase
      && String(message.kind || "") === transfer.kind
      && String(message.slot || "") === transfer.slot
      && normalizeMime(message.mime) === transfer.mime
      && Number(message.size) === transfer.size
      && Number(message.duration) === transfer.duration,
  );
  if (!matches) return "mismatch";
  if (transfer.received !== transfer.size) return "incomplete";
  return "complete";
}

function createTeamAssetResource(blob, metadata, verified, {
  urlApi = globalThis.URL,
} = {}) {
  const url = typeof urlApi?.createObjectURL === "function"
    ? urlApi.createObjectURL(blob)
    : "";
  return {
    id: metadata.transferId,
    transferId: metadata.transferId,
    ownerUid: metadata.ownerUid,
    phase: metadata.phase,
    kind: metadata.kind,
    slot: metadata.slot,
    blob,
    url,
    mime: verified.mime,
    size: blob.size,
    duration: verified.duration,
    width: Number(verified.width || 0),
    height: Number(verified.height || 0),
    released: false,
  };
}

export async function finishIncomingTeamAssetTransfer(transfer, endMessage, {
  BlobClass = globalThis.Blob,
  urlApi = globalThis.URL,
} = {}) {
  const status = teamAssetEndStatus(transfer, endMessage);
  if (status === "orphan") {
    throw new Error("開始されていない推し上手メディア転送が終了しました。");
  }
  if (status === "mismatch") {
    throw new Error("推し上手メディアの終端情報が一致しません。");
  }
  if (status === "incomplete") {
    throw new Error("推し上手メディアの受信が完了していません。");
  }
  if (typeof BlobClass !== "function") {
    throw new Error("このブラウザは推し上手メディアの生成に対応していません。");
  }

  const rawBlob = new BlobClass(transfer.chunks, { type: transfer.mime });
  if (rawBlob.size !== transfer.size) {
    throw new Error("推し上手メディアの受信サイズが一致しませんでした。");
  }
  const buffer = await rawBlob.arrayBuffer();
  const verified = verifyTeamAssetBytes(buffer, transfer);
  const blob = rawBlob.type === verified.mime
    ? rawBlob
    : new BlobClass([rawBlob], { type: verified.mime });
  return createTeamAssetResource(blob, transfer, verified, { urlApi });
}

export function releaseTeamAssetResource(resource, {
  urlApi = globalThis.URL,
} = {}) {
  if (!resource || resource.released) return;
  if (resource.url && typeof urlApi?.revokeObjectURL === "function") {
    urlApi.revokeObjectURL(resource.url);
  }
  resource.url = "";
  resource.blob = null;
  resource.released = true;
}

export function releaseTeamAssetResources(resources, options) {
  const values = resources instanceof Map
    ? resources.values()
    : resources || [];
  for (const resource of values) {
    releaseTeamAssetResource(resource, options);
  }
  if (typeof resources?.clear === "function") resources.clear();
  else if (Array.isArray(resources)) resources.length = 0;
}

export function createTeamAssetTransferId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("安全な推し上手メディア転送IDを生成できません。");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(12));
  return `ta_${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function createOutgoingTeamAssetTransfer(asset, metadata) {
  if (!asset?.blob || typeof asset.blob.arrayBuffer !== "function") {
    throw new Error("送信する推し上手メディアがありません。");
  }
  const buffer = await asset.blob.arrayBuffer();
  const verified = verifyTeamAssetBytes(buffer, {
    kind: asset.kind,
    mime: asset.mime || asset.blob.type,
    duration: asset.duration,
  });
  const transfer = normalizeTeamAssetTransfer({
    type: "team-asset-start",
    ...metadata,
    kind: verified.kind,
    mime: verified.mime,
    size: buffer.byteLength,
    duration: verified.duration,
  });
  return { transfer, buffer, verified };
}

export function teamAssetStartMessage(transfer) {
  return {
    type: "team-asset-start",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: transfer.phase,
    kind: transfer.kind,
    slot: transfer.slot,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
  };
}

export function teamAssetEndMessage(transfer) {
  return {
    type: "team-asset-end",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: transfer.phase,
    kind: transfer.kind,
    slot: transfer.slot,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
  };
}

export async function sendTeamAsset(channel, asset, metadata, {
  chunkBytes = TEAM_ASSET_CHUNK_BYTES,
  waitForBuffer = () => Promise.resolve(),
  isActive = () => true,
  onProgress = () => {},
} = {}) {
  if (!channel || channel.readyState !== "open") {
    throw new Error("推し上手メディアのP2P接続が完了していません。");
  }
  const normalizedChunkBytes = Number(chunkBytes);
  if (
    !Number.isSafeInteger(normalizedChunkBytes)
    || normalizedChunkBytes <= 0
    || normalizedChunkBytes > 64 * 1024
  ) {
    throw new Error("推し上手メディアのチャンクサイズが不正です。");
  }

  const { transfer, buffer } = await createOutgoingTeamAssetTransfer(asset, metadata);
  const endMessage = teamAssetEndMessage(transfer);
  let started = false;
  let ended = false;
  try {
    if (!isActive()) {
      throw new Error("推し上手セッションが終了したためメディアを送信できません。");
    }
    channel.send(JSON.stringify(teamAssetStartMessage(transfer)));
    started = true;
    for (let offset = 0; offset < buffer.byteLength; offset += normalizedChunkBytes) {
      await waitForBuffer(channel);
      if (!isActive() || channel.readyState !== "open") {
        throw new Error("推し上手メディアのP2P転送が中断されました。");
      }
      const end = Math.min(buffer.byteLength, offset + normalizedChunkBytes);
      channel.send(buffer.slice(offset, end));
      onProgress(Math.round((end / buffer.byteLength) * 100));
    }
    if (!isActive() || channel.readyState !== "open") {
      throw new Error("推し上手メディアのP2P転送が中断されました。");
    }
    channel.send(JSON.stringify(endMessage));
    ended = true;
    return transfer;
  } catch (error) {
    if (started && !ended && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(endMessage));
      } catch {
        // Preserve the original transfer error.
      }
    }
    throw error;
  }
}
