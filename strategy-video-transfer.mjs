export const STRATEGY_VIDEO_MAX_SECONDS = 10;
export const STRATEGY_VIDEO_MAX_BYTES = 2 * 1024 * 1024;
export const STRATEGY_VIDEO_CHUNK_BYTES = 16 * 1024;
export const STRATEGY_VIDEO_VIDEO_BITS_PER_SECOND = 1_200_000;
export const STRATEGY_VIDEO_AUDIO_BITS_PER_SECOND = 64_000;
export const STRATEGY_VIDEO_TIMESLICE_MS = 250;

const STRATEGY_VIDEO_DURATION_TOLERANCE_SECONDS = 0.1;
const STRATEGY_VIDEO_PHASES = new Set(["battle", "review"]);
const STRATEGY_VIDEO_MIME_TYPES = new Set(["video/webm", "video/mp4"]);
const STRATEGY_VIDEO_MIME_CANDIDATES = Object.freeze([
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/mp4;codecs=avc1.42e01e,mp4a.40.2",
  "video/mp4",
  "video/webm",
]);
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const OWNER_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function strategyVideoBaseMime(value) {
  return normalizeMime(value).split(";", 1)[0].trim();
}

export function isSupportedStrategyVideoMime(value) {
  const normalized = normalizeMime(value);
  return normalized.length <= 120 && STRATEGY_VIDEO_MIME_TYPES.has(strategyVideoBaseMime(normalized));
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function strategyVideoMimeFromBytes(value) {
  const bytes = bytesFrom(value);
  if (!bytes) return "";
  if (bytes.length >= 4
      && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  if (bytes.length >= 12
      && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "video/mp4";
  }
  return "";
}

export function strategyVideoMimeFromChunks(chunks) {
  const prefix = new Uint8Array(32);
  let length = 0;
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const bytes = bytesFrom(chunk);
    if (!bytes) continue;
    const available = Math.min(bytes.length, prefix.length - length);
    if (available > 0) {
      prefix.set(bytes.subarray(0, available), length);
      length += available;
    }
    if (length === prefix.length) break;
  }
  return strategyVideoMimeFromBytes(prefix.subarray(0, length));
}

export function verifiedStrategyVideoMime(value, declaredMime = "") {
  const mime = strategyVideoMimeFromBytes(value);
  if (!mime) throw new Error("動画形式が不正です。WebMまたはMP4で録画してください。");
  const declaredBaseMime = strategyVideoBaseMime(declaredMime);
  if (declaredBaseMime && declaredBaseMime !== mime) throw new Error("動画の申告形式と実データが一致しません。");
  return mime;
}

export function verifiedStrategyVideoMimeFromChunks(chunks, declaredMime = "") {
  const mime = strategyVideoMimeFromChunks(chunks);
  if (!mime) throw new Error("動画形式が不正です。WebMまたはMP4で録画してください。");
  const declaredBaseMime = strategyVideoBaseMime(declaredMime);
  if (declaredBaseMime && declaredBaseMime !== mime) throw new Error("動画の申告形式と実データが一致しません。");
  return mime;
}

function positiveLimit(value, fallback, label) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new Error(`${label}の設定が不正です。`);
  return normalized;
}

function normalizeAllowedPhases(value) {
  const source = value instanceof Set ? [...value] : Array.isArray(value) ? value : ["battle"];
  const phases = new Set(source.filter((phase) => STRATEGY_VIDEO_PHASES.has(phase)));
  if (!phases.size) throw new Error("動画を受信できるフェーズがありません。");
  return phases;
}

function normalizeStrategyVideoTransfer(message, {
  expectedOwnerUid = "",
  requireExpectedOwner = false,
  allowedPhases = ["battle"],
  maxBytes = STRATEGY_VIDEO_MAX_BYTES,
  maxSeconds = STRATEGY_VIDEO_MAX_SECONDS,
  maxRounds = 5,
  now = Date.now(),
} = {}) {
  if (message?.type !== "strategy-video-start") throw new Error("動画転送の開始情報が不正です。");
  const transferId = String(message?.transferId || "");
  if (!TRANSFER_ID_PATTERN.test(transferId)) throw new Error("動画転送IDが不正です。");

  const ownerUid = String(message?.ownerUid || "");
  if (!OWNER_UID_PATTERN.test(ownerUid)) throw new Error("動画送信者が不正です。");
  if (requireExpectedOwner && !expectedOwnerUid) throw new Error("動画の受信元を確認できません。");
  if (expectedOwnerUid && ownerUid !== expectedOwnerUid) throw new Error("対戦相手以外からの動画は受信できません。");

  const phase = String(message?.phase || "");
  if (!normalizeAllowedPhases(allowedPhases).has(phase)) throw new Error("現在のフェーズでは動画を受信できません。");

  const round = Number(message?.round);
  const normalizedMaxRounds = Number(maxRounds);
  if (!Number.isInteger(normalizedMaxRounds) || normalizedMaxRounds <= 0) throw new Error("対戦ラウンド上限の設定が不正です。");
  if ((phase === "battle" && (!Number.isInteger(round) || round < 1 || round > normalizedMaxRounds))
      || (phase === "review" && round !== 0)) {
    throw new Error("動画のラウンド情報が不正です。");
  }

  const maximumBytes = positiveLimit(maxBytes, STRATEGY_VIDEO_MAX_BYTES, "動画サイズ上限");
  const size = Number(message?.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maximumBytes) throw new Error("動画の受信サイズが不正です。");

  const maximumSeconds = positiveLimit(maxSeconds, STRATEGY_VIDEO_MAX_SECONDS, "動画時間上限");
  const duration = Number(message?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > maximumSeconds + STRATEGY_VIDEO_DURATION_TOLERANCE_SECONDS) {
    throw new Error("動画の録画時間が不正です。");
  }

  const declaredMime = normalizeMime(message?.mime);
  if (!isSupportedStrategyVideoMime(declaredMime)) throw new Error("動画形式が不正です。WebMまたはMP4で録画してください。");

  const createdAt = Number(message?.createdAt ?? now);
  return {
    transferId,
    ownerUid,
    phase,
    round,
    mime: strategyVideoBaseMime(declaredMime),
    size,
    duration,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
  };
}

export function createIncomingStrategyVideoTransfer(message, {
  currentTransfer = null,
  expectedOwnerUid,
  allowedPhases = ["battle"],
  maxBytes = STRATEGY_VIDEO_MAX_BYTES,
  maxSeconds = STRATEGY_VIDEO_MAX_SECONDS,
  maxRounds = 5,
  now = Date.now(),
} = {}) {
  if (currentTransfer) throw new Error("別の動画転送が進行中です。");
  return {
    ...normalizeStrategyVideoTransfer(message, {
      expectedOwnerUid,
      requireExpectedOwner: true,
      allowedPhases,
      maxBytes,
      maxSeconds,
      maxRounds,
      now,
    }),
    received: 0,
    chunks: [],
  };
}

export async function appendStrategyVideoChunk(transfer, value) {
  if (!transfer || !Array.isArray(transfer.chunks)) throw new Error("開始されていない動画データを受信しました。");
  let bytes;
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else {
    bytes = bytesFrom(value);
  }
  if (!bytes?.byteLength) throw new Error("空の動画データを受信しました。");
  if (transfer.received + bytes.byteLength > transfer.size) throw new Error("動画の受信サイズが申告値を超えました。");
  const copy = bytes.slice().buffer;
  transfer.chunks.push(copy);
  transfer.received += bytes.byteLength;
  return transfer.received;
}

export function strategyVideoEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  const matches = message
    && message.type === "strategy-video-end"
    && String(message.transferId || "") === transfer.transferId
    && String(message.ownerUid || "") === transfer.ownerUid
    && String(message.phase || "") === transfer.phase
    && Number(message.round) === transfer.round
    && Number(message.size) === transfer.size
    && Number(message.duration) === transfer.duration
    && strategyVideoBaseMime(message.mime) === transfer.mime;
  if (!matches) return "mismatch";
  if (transfer.received !== transfer.size) return "incomplete";
  return "complete";
}

function createStrategyVideoResource(blob, metadata, { urlApi = globalThis.URL } = {}) {
  const url = typeof urlApi?.createObjectURL === "function" ? urlApi.createObjectURL(blob) : "";
  return {
    id: metadata.transferId || "",
    transferId: metadata.transferId || "",
    ownerUid: metadata.ownerUid || "",
    phase: metadata.phase || "",
    round: Number(metadata.round || 0),
    blob,
    url,
    mime: strategyVideoBaseMime(blob.type || metadata.mime),
    size: blob.size,
    duration: Number(metadata.duration || 0),
    createdAt: Number(metadata.createdAt || Date.now()),
    released: false,
  };
}

export function finishIncomingStrategyVideoTransfer(transfer, endMessage, {
  BlobClass = globalThis.Blob,
  urlApi = globalThis.URL,
} = {}) {
  const status = strategyVideoEndStatus(transfer, endMessage);
  if (status === "orphan") throw new Error("開始されていない動画転送が終了しました。");
  if (status === "mismatch") throw new Error("動画転送の終端情報が一致しません。");
  if (status === "incomplete") throw new Error("動画の受信が完了していません。");
  if (typeof BlobClass !== "function") throw new Error("このブラウザは動画データの生成に対応していません。");

  const mime = verifiedStrategyVideoMimeFromChunks(transfer.chunks, transfer.mime);
  const blob = new BlobClass(transfer.chunks, { type: mime });
  if (blob.size !== transfer.size) throw new Error("動画の受信サイズが一致しませんでした。");
  return createStrategyVideoResource(blob, { ...transfer, mime }, { urlApi });
}

export function releaseStrategyVideoResource(resource, { urlApi = globalThis.URL } = {}) {
  if (!resource || resource.released) return;
  if (resource.url && typeof urlApi?.revokeObjectURL === "function") urlApi.revokeObjectURL(resource.url);
  resource.url = "";
  resource.blob = null;
  resource.released = true;
}

export function releaseStrategyVideoResources(resources, options) {
  const values = resources instanceof Map ? resources.values() : resources || [];
  for (const resource of values) releaseStrategyVideoResource(resource, options);
  if (typeof resources?.clear === "function") resources.clear();
  else if (Array.isArray(resources)) resources.length = 0;
}

export function stopStrategyVideoStream(stream) {
  let stopped = 0;
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
      stopped += 1;
    } catch {
      // A track may already have ended; cleanup remains best effort.
    }
  }
  return stopped;
}

export function preferredStrategyVideoMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  if (typeof MediaRecorderClass !== "function" || typeof MediaRecorderClass.isTypeSupported !== "function") return "";
  return STRATEGY_VIDEO_MIME_CANDIDATES.find((type) => {
    try {
      return MediaRecorderClass.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || "";
}

export function strategyVideoCaptureConstraints({
  facingMode = "environment",
  includeAudio = true,
} = {}) {
  const normalizedFacingMode = facingMode === "user" ? "user" : "environment";
  return {
    audio: includeAudio ? {
      channelCount: { ideal: 1, max: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    } : false,
    video: {
      width: { ideal: 854, max: 854 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: { ideal: normalizedFacingMode },
    },
  };
}

function abortError() {
  const error = new Error("動画録画を中止しました。");
  error.name = "AbortError";
  return error;
}

function createRecorder(MediaRecorderClass, stream, mimeType, {
  videoBitsPerSecond,
  audioBitsPerSecond,
  includeAudio,
}) {
  const attempts = [
    {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond,
      ...(includeAudio ? { audioBitsPerSecond } : {}),
    },
    mimeType ? { mimeType } : undefined,
    undefined,
  ];
  let lastError = null;
  for (const options of attempts) {
    try {
      return new MediaRecorderClass(stream, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("動画録画を開始できませんでした。");
}

export async function startStrategyVideoRecording({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  urlApi = globalThis.URL,
  BlobClass = globalThis.Blob,
  timerApi = globalThis,
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  signal,
  facingMode = "environment",
  includeAudio = true,
  maxSeconds = STRATEGY_VIDEO_MAX_SECONDS,
  maxBytes = STRATEGY_VIDEO_MAX_BYTES,
  videoBitsPerSecond = STRATEGY_VIDEO_VIDEO_BITS_PER_SECOND,
  audioBitsPerSecond = STRATEGY_VIDEO_AUDIO_BITS_PER_SECOND,
  timesliceMs = STRATEGY_VIDEO_TIMESLICE_MS,
  constraints,
} = {}) {
  if (typeof mediaDevices?.getUserMedia !== "function" || typeof MediaRecorderClass !== "function") {
    throw new Error("このブラウザは動画録画に対応していません。");
  }
  if (typeof BlobClass !== "function") throw new Error("このブラウザは動画データの生成に対応していません。");
  const maximumSeconds = positiveLimit(maxSeconds, STRATEGY_VIDEO_MAX_SECONDS, "動画時間上限");
  const maximumBytes = positiveLimit(maxBytes, STRATEGY_VIDEO_MAX_BYTES, "動画サイズ上限");
  if (signal?.aborted) throw abortError();

  const stream = await mediaDevices.getUserMedia(constraints || strategyVideoCaptureConstraints({ facingMode, includeAudio }));
  if (signal?.aborted) {
    stopStrategyVideoStream(stream);
    throw abortError();
  }

  const preferredMime = preferredStrategyVideoMimeType(MediaRecorderClass);
  let recorder;
  try {
    recorder = createRecorder(MediaRecorderClass, stream, preferredMime, {
      videoBitsPerSecond: positiveLimit(videoBitsPerSecond, STRATEGY_VIDEO_VIDEO_BITS_PER_SECOND, "動画ビットレート"),
      audioBitsPerSecond: positiveLimit(audioBitsPerSecond, STRATEGY_VIDEO_AUDIO_BITS_PER_SECOND, "音声ビットレート"),
      includeAudio,
    });
  } catch (error) {
    stopStrategyVideoStream(stream);
    throw error;
  }

  const chunks = [];
  let received = 0;
  let settled = false;
  let canceled = false;
  let terminalError = null;
  let timeoutId = null;
  let cleaned = false;
  const startedAt = clock();
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timeoutId !== null) timerApi.clearTimeout?.(timeoutId);
    timeoutId = null;
    signal?.removeEventListener?.("abort", cancel);
    stopStrategyVideoStream(stream);
  };
  const rejectOnce = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult(error);
  };
  const requestStop = () => {
    if (recorder.state && recorder.state !== "inactive") recorder.stop();
  };
  const stop = () => {
    requestStop();
    return result;
  };
  function cancel() {
    if (settled) return result;
    canceled = true;
    if (recorder.state && recorder.state !== "inactive") requestStop();
    else rejectOnce(abortError());
    return result;
  }

  recorder.addEventListener("dataavailable", (event) => {
    if (!event.data?.size || settled) return;
    chunks.push(event.data);
    received += event.data.size;
    if (received > maximumBytes && !terminalError) {
      terminalError = new Error("録画した動画が約2MBの上限を超えました。");
      requestStop();
    }
  });
  recorder.addEventListener("error", (event) => {
    terminalError = event.error instanceof Error ? event.error : new Error("動画録画中にエラーが発生しました。");
    if (recorder.state && recorder.state !== "inactive") requestStop();
    else rejectOnce(terminalError);
  }, { once: true });
  recorder.addEventListener("stop", async () => {
    if (settled) return;
    cleanup();
    if (canceled) {
      rejectOnce(abortError());
      return;
    }
    if (terminalError) {
      rejectOnce(terminalError);
      return;
    }
    try {
      const duration = Math.max(0, (clock() - startedAt) / 1000);
      if (duration <= 0 || duration > maximumSeconds + STRATEGY_VIDEO_DURATION_TOLERANCE_SECONDS) {
        throw new Error("録画時間が10秒の上限を超えました。");
      }
      const declaredMime = recorder.mimeType || preferredMime || chunks[0]?.type || "";
      const blob = new BlobClass(chunks, { type: strategyVideoBaseMime(declaredMime) || declaredMime });
      if (!blob.size) throw new Error("動画を録画できませんでした。");
      if (blob.size > maximumBytes) throw new Error("録画した動画が約2MBの上限を超えました。");
      const prefix = await blob.slice(0, 32).arrayBuffer();
      const mime = verifiedStrategyVideoMime(prefix, declaredMime);
      const normalizedBlob = blob.type === mime ? blob : new BlobClass([blob], { type: mime });
      const resource = createStrategyVideoResource(normalizedBlob, {
        mime,
        duration,
        createdAt: Date.now(),
      }, { urlApi });
      settled = true;
      resolveResult(resource);
    } catch (error) {
      rejectOnce(error);
    }
  }, { once: true });

  signal?.addEventListener?.("abort", cancel, { once: true });
  try {
    recorder.start(positiveLimit(timesliceMs, STRATEGY_VIDEO_TIMESLICE_MS, "録画チャンク間隔"));
  } catch (error) {
    cleanup();
    throw error;
  }
  timeoutId = timerApi.setTimeout?.(requestStop, maximumSeconds * 1000) ?? null;

  return {
    stream,
    recorder,
    result,
    stop,
    cancel,
    startedAt,
  };
}

export function createStrategyVideoTransferId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("安全な動画転送IDを生成できません。");
  const bytes = cryptoApi.getRandomValues(new Uint8Array(12));
  return `sv_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createOutgoingStrategyVideoTransfer(clip, metadata, {
  maxBytes = STRATEGY_VIDEO_MAX_BYTES,
  maxSeconds = STRATEGY_VIDEO_MAX_SECONDS,
  maxRounds = 5,
} = {}) {
  if (!clip?.blob || typeof clip.blob.arrayBuffer !== "function") throw new Error("送信する動画がありません。");
  const buffer = await clip.blob.arrayBuffer();
  const mime = verifiedStrategyVideoMime(buffer, clip.mime || clip.blob.type);
  const transfer = normalizeStrategyVideoTransfer({
    type: "strategy-video-start",
    ...metadata,
    mime,
    size: buffer.byteLength,
    duration: clip.duration,
    createdAt: metadata?.createdAt ?? clip.createdAt ?? Date.now(),
  }, {
    allowedPhases: ["battle", "review"],
    maxBytes,
    maxSeconds,
    maxRounds,
  });
  return { transfer, buffer };
}

export function strategyVideoStartMessage(transfer) {
  return {
    type: "strategy-video-start",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: transfer.phase,
    round: transfer.round,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
    createdAt: transfer.createdAt,
  };
}

export function strategyVideoEndMessage(transfer) {
  return {
    type: "strategy-video-end",
    transferId: transfer.transferId,
    ownerUid: transfer.ownerUid,
    phase: transfer.phase,
    round: transfer.round,
    mime: transfer.mime,
    size: transfer.size,
    duration: transfer.duration,
  };
}

export async function sendStrategyVideoClip(channel, clip, metadata, {
  chunkBytes = STRATEGY_VIDEO_CHUNK_BYTES,
  waitForBuffer = () => Promise.resolve(),
  isActive = () => true,
  onProgress = () => {},
  ...limits
} = {}) {
  if (!channel || channel.readyState !== "open") throw new Error("P2P接続が完了していません。");
  const normalizedChunkBytes = Math.floor(positiveLimit(chunkBytes, STRATEGY_VIDEO_CHUNK_BYTES, "動画チャンクサイズ"));
  if (normalizedChunkBytes > 64 * 1024) throw new Error("動画チャンクサイズが大きすぎます。");
  const { transfer, buffer } = await createOutgoingStrategyVideoTransfer(clip, metadata, limits);
  const endMessage = strategyVideoEndMessage(transfer);
  let started = false;
  let ended = false;
  try {
    if (!isActive() || channel.readyState !== "open") throw new Error("P2P動画転送が中断されました。");
    channel.send(JSON.stringify(strategyVideoStartMessage(transfer)));
    started = true;
    for (let offset = 0; offset < buffer.byteLength; offset += normalizedChunkBytes) {
      await waitForBuffer(channel);
      if (!isActive() || channel.readyState !== "open") throw new Error("P2P動画転送が中断されました。");
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
