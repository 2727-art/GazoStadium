// 戦略型1on1の対戦中のボイス：最大10秒・モノラル16bit WAV を P2P で一時的に送る（Firebase には保存しない）。
// 品評会メディア用のチャネルを使い、合図は strategy-voice-start → 本体 → strategy-voice-end。
// 古い画面は知らない合図と、開始のない本体を無視する。WAV の確かめ方は品評会の音声と同じ。
import {
  STRATEGY_REVIEW_AUDIO_MAX_BYTES,
  STRATEGY_REVIEW_AUDIO_MAX_SECONDS,
  STRATEGY_REVIEW_ASSET_CHUNK_BYTES,
  strategyReviewWavDuration,
} from "./strategy-review-asset-transfer.mjs?v=strategy-review-assets-v1";

export const STRATEGY_VOICE_MAX_SECONDS = STRATEGY_REVIEW_AUDIO_MAX_SECONDS;
export const STRATEGY_VOICE_MAX_BYTES = STRATEGY_REVIEW_AUDIO_MAX_BYTES;
export const STRATEGY_VOICE_MIME = "audio/wav";

const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const OWNER_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_ROUND = 30;
const DURATION_TOLERANCE_SECONDS = 0.35;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function normalizeMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";", 1)[0].trim() : "";
}

// 本体が WAV で、申告の時間と実際の時間が合っているか。
export function verifyStrategyVoiceBytes(value, declaredDuration) {
  const bytes = bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空のボイスは送れません。");
  if (bytes.byteLength > STRATEGY_VOICE_MAX_BYTES) throw new Error("ボイスの容量が上限を超えています。");
  const duration = strategyReviewWavDuration(bytes);
  const declared = Number(declaredDuration);
  if (!Number.isFinite(declared) || declared <= 0 || Math.abs(declared - duration) > DURATION_TOLERANCE_SECONDS) {
    throw new Error("ボイスの申告時間と実データが一致しません。");
  }
  return duration;
}

function normalizeStrategyVoiceTransfer(message, { expectedOwnerUid = "", requireExpectedOwner = false, now = Date.now() } = {}) {
  if (message?.type !== "strategy-voice-start") throw new Error("ボイスの開始情報が不正です。");
  const transferId = String(message.transferId || "");
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw new Error("ボイスの転送IDが不正です。");
  const ownerUid = String(message.ownerUid || "");
  if (!OWNER_UID_PATTERN.test(ownerUid)) throw new Error("ボイスの送信者が不正です。");
  if (requireExpectedOwner && !expectedOwnerUid) throw new Error("ボイスの受信元を確認できません。");
  if (expectedOwnerUid && ownerUid !== expectedOwnerUid) throw new Error("対戦相手以外からのボイスは受信できません。");
  if (message.phase !== "battle") throw new Error("対戦中以外のボイスは受信できません。");
  if (normalizeMime(message.mime) !== STRATEGY_VOICE_MIME) throw new Error("ボイスの形式が不正です。");
  const round = Number(message.round);
  if (!Number.isSafeInteger(round) || round < 1 || round > MAX_ROUND) throw new Error("ボイスの手番情報が不正です。");
  const size = Number(message.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > STRATEGY_VOICE_MAX_BYTES) throw new Error("ボイスは約480KB以内にしてください。");
  const duration = Number(message.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > STRATEGY_VOICE_MAX_SECONDS + 0.1) throw new Error("ボイスの再生時間が不正です。");
  const createdAt = Number(message.createdAt ?? now);
  return {
    transferId,
    ownerUid,
    phase: "battle",
    round,
    mime: STRATEGY_VOICE_MIME,
    size,
    duration,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
  };
}

export function createIncomingStrategyVoiceTransfer(message, { currentTransfer = null, expectedOwnerUid, now = Date.now() } = {}) {
  if (currentTransfer) throw new Error("別のボイスを受信中です。");
  return {
    ...normalizeStrategyVoiceTransfer(message, { expectedOwnerUid, requireExpectedOwner: true, now }),
    received: 0,
    chunks: [],
  };
}

export async function appendStrategyVoiceChunk(transfer, value) {
  if (!transfer || !Array.isArray(transfer.chunks)) throw new Error("開始されていないボイスを受信しました。");
  const bytes = typeof Blob !== "undefined" && value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : bytesFrom(value);
  if (!bytes?.byteLength) throw new Error("空のボイスを受信しました。");
  if (transfer.received + bytes.byteLength > transfer.size) throw new Error("ボイスの受信サイズが申告値を超えました。");
  transfer.chunks.push(bytes.slice().buffer);
  transfer.received += bytes.byteLength;
  return transfer.received;
}

export function strategyVoiceEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  const matches = message
    && message.type === "strategy-voice-end"
    && String(message.transferId || "") === transfer.transferId
    && String(message.ownerUid || "") === transfer.ownerUid
    && Number(message.size) === transfer.size
    && Number(message.duration) === transfer.duration;
  if (!matches) return "mismatch";
  if (transfer.received !== transfer.size) return "incomplete";
  return "complete";
}

function createStrategyVoiceResource(blob, metadata, { urlApi = globalThis.URL } = {}) {
  return {
    id: metadata.transferId,
    transferId: metadata.transferId,
    ownerUid: metadata.ownerUid,
    phase: "battle",
    round: metadata.round,
    blob,
    url: typeof urlApi?.createObjectURL === "function" ? urlApi.createObjectURL(blob) : "",
    duration: Number(metadata.duration || 0),
    createdAt: Number(metadata.createdAt || Date.now()),
    released: false,
  };
}

export async function finishIncomingStrategyVoiceTransfer(transfer, endMessage, { BlobClass = globalThis.Blob, urlApi = globalThis.URL } = {}) {
  const status = strategyVoiceEndStatus(transfer, endMessage);
  if (status === "orphan") throw new Error("開始されていないボイスの転送が終了しました。");
  if (status === "mismatch") throw new Error("ボイスの終端情報が一致しません。");
  if (status === "incomplete") throw new Error("ボイスの受信が完了していません。");
  if (typeof BlobClass !== "function") throw new Error("このブラウザはボイスの再生に対応していません。");
  const blob = new BlobClass(transfer.chunks, { type: STRATEGY_VOICE_MIME });
  if (blob.size !== transfer.size) throw new Error("ボイスの受信サイズが一致しませんでした。");
  const duration = verifyStrategyVoiceBytes(await blob.arrayBuffer(), transfer.duration);
  return createStrategyVoiceResource(blob, { ...transfer, duration }, { urlApi });
}

export function releaseStrategyVoiceResource(resource, { urlApi = globalThis.URL } = {}) {
  if (!resource || resource.released) return;
  if (resource.url && typeof urlApi?.revokeObjectURL === "function") urlApi.revokeObjectURL(resource.url);
  resource.url = "";
  resource.blob = null;
  resource.released = true;
}

export function releaseStrategyVoiceResources(resources, options) {
  for (const resource of resources || []) releaseStrategyVoiceResource(resource, options);
  if (Array.isArray(resources)) resources.length = 0;
}

export function createStrategyVoiceTransferId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("安全なボイスの転送IDを生成できません。");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(12));
  return `vo_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function strategyVoiceStartMessage(transfer) {
  return {
    type: "strategy-voice-start",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: "battle",
    round: transfer.round,
    mime: STRATEGY_VOICE_MIME,
    size: transfer.size,
    duration: transfer.duration,
    createdAt: transfer.createdAt,
  };
}

export function strategyVoiceEndMessage(transfer) {
  return {
    type: "strategy-voice-end",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    size: transfer.size,
    duration: transfer.duration,
  };
}

// 録ったボイス（{ blob, duration }）を送る。送り終えたら転送の情報を返す。
export async function sendStrategyVoice(channel, voice, metadata, {
  chunkBytes = STRATEGY_REVIEW_ASSET_CHUNK_BYTES,
  waitForBuffer = () => Promise.resolve(),
  isActive = () => true,
  onProgress = () => {},
} = {}) {
  if (!channel || channel.readyState !== "open") throw new Error("ボイスのP2P接続が完了していません。");
  if (!voice?.blob || typeof voice.blob.arrayBuffer !== "function") throw new Error("送るボイスがありません。");
  const buffer = await voice.blob.arrayBuffer();
  const duration = verifyStrategyVoiceBytes(buffer, voice.duration);
  const transfer = normalizeStrategyVoiceTransfer({
    type: "strategy-voice-start",
    ...metadata,
    phase: "battle",
    mime: STRATEGY_VOICE_MIME,
    size: buffer.byteLength,
    duration,
  });
  const endMessage = strategyVoiceEndMessage(transfer);
  let started = false;
  let ended = false;
  try {
    if (!isActive()) throw new Error("対戦が終わったためボイスを送れません。");
    channel.send(JSON.stringify(strategyVoiceStartMessage(transfer)));
    started = true;
    for (let offset = 0; offset < buffer.byteLength; offset += chunkBytes) {
      await waitForBuffer(channel);
      if (!isActive() || channel.readyState !== "open") throw new Error("ボイスのP2P転送が中断されました。");
      const end = Math.min(buffer.byteLength, offset + chunkBytes);
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
        // 元の転送エラーのほうが呼び出し元に役立つ。
      }
    }
    throw error;
  }
}
