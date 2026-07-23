function normalizeMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array();
}

export function marketImageMimeFromBytes(value) {
  const bytes = bytesFrom(value);
  if (bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return "";
}

export function marketImageMimeFromChunks(chunks) {
  const prefix = new Uint8Array(12);
  let length = 0;
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    const bytes = bytesFrom(chunk);
    const available = Math.min(bytes.length, prefix.length - length);
    if (available > 0) {
      prefix.set(bytes.subarray(0, available), length);
      length += available;
    }
    if (length === prefix.length) break;
  }
  return marketImageMimeFromBytes(prefix.subarray(0, length));
}

export function verifiedMarketImageMime(value) {
  const mime = marketImageMimeFromBytes(value);
  if (!mime) throw new Error("画像形式が不正です。");
  return mime;
}

export function verifiedMarketImageMimeFromChunks(chunks) {
  const mime = marketImageMimeFromChunks(chunks);
  if (!mime) throw new Error("画像形式が不正です。");
  return mime;
}

export function createIncomingMarketTransfer(message, {
  role,
  maxImageBytes,
  maxAudioBytes,
  maxTurns,
  now = Date.now(),
} = {}) {
  if (role !== "buyer") throw new Error("買い手以外は市場素材を受信できません。");
  if (!message || !["image", "audio"].includes(message.kind)) throw new Error("受信データの種類が不正です。");

  const maximum = message.kind === "audio" ? Number(maxAudioBytes) : Number(maxImageBytes);
  const size = Number(message.size || 0);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(maximum) || size > maximum) {
    throw new Error("受信データのサイズが不正です。");
  }

  const mime = normalizeMime(message.mime);
  if (message.kind === "image" && mime.length > 80) throw new Error("画像形式が不正です。");
  if (message.kind === "audio" && mime !== "audio/wav") throw new Error("音声形式が不正です。");

  const turn = Number(message.turn || 0);
  if ((message.kind === "image" && turn !== 0)
      || (message.kind === "audio" && (!Number.isInteger(turn) || turn < 1 || turn > Number(maxTurns)))) {
    throw new Error("受信データのターンが不正です。");
  }

  const createdAt = Number(message.createdAt || now);
  return {
    kind: message.kind,
    turn,
    name: String(message.name || "").slice(0, 80),
    mime,
    size,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
    received: 0,
    chunks: [],
  };
}

export function marketAssetEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  if (!message || message.kind !== transfer.kind || Number(message.turn || 0) !== transfer.turn) {
    return "mismatch";
  }
  return "complete";
}
