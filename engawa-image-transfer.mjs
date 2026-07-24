import {
  appendIncomingOnlineImageChunk,
  completeIncomingOnlineImageTransfer,
  normalizeOnlineImageMime,
} from "./online-image-transfer.mjs";

const MAX_DECLARED_MIME_LENGTH = 80;
const INCOMING_TRANSFER_FIELDS = Object.freeze({
  profile: "incomingAvatarTransfer",
  engawa: "incomingEngawaTransfer",
  battle: "incomingTransfer",
});

export function assertIncomingTransferNamespaceExclusive(state, requestedKind) {
  const requestedField = INCOMING_TRANSFER_FIELDS[requestedKind];
  if (!requestedField) throw new Error("P2P画像転送の種別が不正です。");
  const conflict = Object.entries(INCOMING_TRANSFER_FIELDS).find(([kind, field]) => (
    kind !== requestedKind && state?.[field]
  ));
  if (conflict) throw new Error("別のP2P画像を受信中です。");
  return true;
}

export function createIncomingEngawaImageTransfer(message, { maxBytes } = {}) {
  const size = Number(message?.size);
  const maximum = Number(maxBytes);
  if (!Number.isSafeInteger(size) || size <= 0
      || !Number.isSafeInteger(maximum) || maximum <= 0 || size > maximum) {
    throw new Error("縁側画像の受信サイズが不正です。");
  }
  const declaredMime = normalizeOnlineImageMime(message?.mime);
  if (declaredMime.length > MAX_DECLARED_MIME_LENGTH) {
    throw new Error("縁側画像の形式情報が不正です。");
  }
  return {
    size,
    declaredMime,
    chunks: [],
    received: 0,
  };
}

export function appendIncomingEngawaImageChunk(transfer, value) {
  return appendIncomingOnlineImageChunk(transfer, value);
}

export function engawaImageEndStatus(transfer) {
  return transfer ? "complete" : "orphan";
}

export function completeIncomingEngawaImageTransfer(transfer) {
  return completeIncomingOnlineImageTransfer(transfer);
}
