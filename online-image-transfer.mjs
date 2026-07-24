const MAX_DECLARED_MIME_LENGTH = 80;

export function normalizeOnlineImageMime(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function onlineImageMimeFromBytes(value) {
  const bytes = bytesFrom(value);
  if (!bytes) return "";
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

export function onlineImageMimeFromChunks(chunks) {
  const prefix = new Uint8Array(12);
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
  return onlineImageMimeFromBytes(prefix.subarray(0, length));
}

export function verifiedOnlineImageMime(value) {
  const mime = onlineImageMimeFromBytes(value);
  if (!mime) throw new Error("送信画像の形式が不正です。");
  return mime;
}

export function verifiedOnlineImageMimeFromChunks(chunks) {
  const mime = onlineImageMimeFromChunks(chunks);
  if (!mime) throw new Error("受信画像の形式が不正です。");
  return mime;
}

export function createIncomingOnlineImageTransfer(message, {
  expectedRound,
  maxBytes,
} = {}) {
  const round = Number(message?.round);
  if (!Number.isSafeInteger(round) || round !== Number(expectedRound)) {
    throw new Error("受信画像のラウンド情報が不正です。");
  }

  const size = Number(message?.size);
  const maximum = Number(maxBytes);
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(maximum) || maximum <= 0 || size > maximum) {
    throw new Error("受信画像のサイズが不正です。");
  }

  const declaredMime = normalizeOnlineImageMime(message?.mime);
  if (declaredMime.length > MAX_DECLARED_MIME_LENGTH) {
    throw new Error("受信画像の形式情報が不正です。");
  }

  return {
    round,
    size,
    declaredMime,
    chunks: [],
    received: 0,
  };
}

export function appendIncomingOnlineImageChunk(transfer, value) {
  if (!transfer) return "orphan";
  const bytes = bytesFrom(value);
  if (!bytes || bytes.byteLength <= 0) throw new Error("受信画像のデータが不正です。");
  if (transfer.received + bytes.byteLength > transfer.size) {
    throw new Error("受信画像のサイズが宣言値を超えました。");
  }

  const chunk = value instanceof ArrayBuffer
    ? value
    : bytes.slice().buffer;
  transfer.chunks.push(chunk);
  transfer.received += bytes.byteLength;
  return "accepted";
}

export function onlineImageEndStatus(transfer, message) {
  if (!transfer) return "orphan";
  if (!message || Number(message.round) !== transfer.round) return "mismatch";
  return "complete";
}

export function completeIncomingOnlineImageTransfer(transfer) {
  if (!transfer || transfer.received !== transfer.size) {
    throw new Error("受信画像のサイズが一致しませんでした。");
  }
  return verifiedOnlineImageMimeFromChunks(transfer.chunks);
}
