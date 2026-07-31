import {
  TRAINING_V6_PROTOCOL_VERSION,
  TRAINING_V6_VARIANT,
  validateTrainingV6P2PEvent,
} from "./training-v6-domain.mjs";

export const TRAINING_V6_IMAGE_CHUNK_BYTES = 48 * 1024;
export const TRAINING_V6_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const TRAINING_V6_IMAGE_ACK_TIMEOUT_MS = 45_000;

const IMAGE_MAGIC = Object.freeze([0x54, 0x56, 0x36, 0x49]);
const SAFE_TOKEN = /^[-_0-9A-Za-z]{8,128}$/;
const SIGNAL_TYPES = new Set(["offer", "answer", "candidate"]);
const MESSAGE_RETRY_DELAYS_MS = Object.freeze([900, 1_800]);

function noop() {}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

function normalizedConnectionId(value) {
  const result = String(value || "");
  if (!/^[-_0-9A-Za-z]{16,128}$/.test(result)) {
    throw new TypeError("connectionId is invalid");
  }
  return result;
}

function normalizedUid(value) {
  const result = String(value || "");
  if (!result
      || result.length > 128
      || /[\u0000-\u001f\u007f.#$\[\]\/]/.test(result)) {
    throw new TypeError("uid is invalid");
  }
  return result;
}

function normalizedRoomId(value) {
  const result = String(value || "");
  if (!isSafeToken(result)) throw new TypeError("roomId is invalid");
  return result;
}

function normalizedRoundNumber(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 5) {
    throw new TypeError("roundNumber is invalid");
  }
  return result;
}

function normalizedImageIndex(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 5) {
    throw new TypeError("imageIndex is invalid");
  }
  return result;
}

function normalizedMime(value) {
  const result = String(value || "").toLowerCase();
  if (!["image/webp", "image/jpeg", "image/png"].includes(result)) {
    throw new TypeError("image mime is invalid");
  }
  return result;
}

function normalizedSignal(signal, context, currentTime) {
  if (!signal || typeof signal !== "object"
      || signal.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION
      || signal.roomId !== context.roomId
      || signal.fromUid !== context.remoteUid
      || signal.toUid !== context.ownUid
      || signal.fromConnectionId !== context.remoteConnectionId
      || signal.toConnectionId !== context.ownConnectionId
      || !Number.isSafeInteger(signal.createdAt)
      || signal.createdAt < currentTime - 60_000
      || signal.createdAt > currentTime + 15_000
      || !SIGNAL_TYPES.has(signal.type)) {
    return null;
  }
  if (signal.type === "offer" || signal.type === "answer") {
    if (typeof signal.sdp !== "string" || !signal.sdp || signal.sdp.length > 120_000) {
      return null;
    }
    return {
      type: signal.type,
      sdp: signal.sdp,
    };
  }
  if (typeof signal.candidate !== "string"
      || !signal.candidate
      || signal.candidate.length > 4_096
      || /[\r\n]/.test(signal.candidate)) {
    return null;
  }
  return {
    candidate: signal.candidate,
    sdpMid: typeof signal.sdpMid === "string" ? signal.sdpMid : "",
    sdpMLineIndex: Number.isInteger(Number(signal.sdpMLineIndex))
      ? Number(signal.sdpMLineIndex)
      : 0,
  };
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return "";
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", buffer));
}

function imageChunkCount(size) {
  const numeric = Number(size);
  if (!Number.isInteger(numeric)
      || numeric <= 0
      || numeric > TRAINING_V6_MAX_IMAGE_BYTES) return 0;
  return Math.ceil(numeric / TRAINING_V6_IMAGE_CHUNK_BYTES);
}

export function encodeTrainingV6ImageChunk(transferId, sequence, payload) {
  const idBytes = new TextEncoder().encode(transferId);
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (idBytes.byteLength < 8 || idBytes.byteLength > 128
      || !Number.isInteger(sequence) || sequence < 0
      || !data.byteLength || data.byteLength > TRAINING_V6_IMAGE_CHUNK_BYTES) {
    throw new TypeError("image chunk is invalid");
  }
  const headerLength = 9 + idBytes.byteLength;
  const frame = new Uint8Array(headerLength + data.byteLength);
  frame.set(IMAGE_MAGIC, 0);
  frame[4] = idBytes.byteLength;
  frame.set(idBytes, 5);
  new DataView(frame.buffer).setUint32(5 + idBytes.byteLength, sequence);
  frame.set(data, headerLength);
  return frame.buffer;
}

export function decodeTrainingV6ImageChunk(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || bytes.byteLength < 18
      || IMAGE_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new TypeError("image chunk frame is invalid");
  }
  const idLength = bytes[4];
  const headerLength = 9 + idLength;
  if (idLength < 8 || idLength > 128 || bytes.byteLength <= headerLength) {
    throw new TypeError("image chunk header is invalid");
  }
  const transferId = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes.slice(5, 5 + idLength));
  if (!isSafeToken(transferId)) throw new TypeError("image transferId is invalid");
  const sequence = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(5 + idLength);
  const payload = bytes.slice(headerLength);
  if (!payload.byteLength || payload.byteLength > TRAINING_V6_IMAGE_CHUNK_BYTES) {
    throw new TypeError("image chunk payload is invalid");
  }
  return { transferId, sequence, payload };
}

function waitForBufferedAmount(channel) {
  if (!channel || channel.readyState !== "open") {
    return Promise.reject(new Error("P2P画像接続が切れています。"));
  }
  if (channel.bufferedAmount <= 512 * 1024) return Promise.resolve();
  channel.bufferedAmountLowThreshold = 256 * 1024;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(
      () => finish(new Error("画像送信の待機時間を超えました。")),
      10_000,
    );
    const finish = (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onLow = () => finish();
    const onClose = () => finish(new Error("画像送信中にP2P接続が切れました。"));
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
  });
}

function timeoutPromise(delayMs) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

export function createTrainingV6P2PController({
  roomId,
  ownUid,
  remoteUid,
  ownConnectionId,
  remoteConnectionId,
  initiator,
  iceServers = [],
  signalTransport,
  peerFactory = (configuration) => new RTCPeerConnection(configuration),
  onStatus = noop,
  onImage = noop,
  onCompanionMessage = noop,
  onError = noop,
  now = () => Date.now(),
} = {}) {
  const context = Object.freeze({
    roomId: normalizedRoomId(roomId),
    ownUid: normalizedUid(ownUid),
    remoteUid: normalizedUid(remoteUid),
    ownConnectionId: normalizedConnectionId(ownConnectionId),
    remoteConnectionId: normalizedConnectionId(remoteConnectionId),
  });
  if (context.ownUid === context.remoteUid) throw new TypeError("remoteUid is invalid");
  if (!signalTransport
      || typeof signalTransport.send !== "function"
      || typeof signalTransport.subscribe !== "function") {
    throw new TypeError("signalTransport is required");
  }

  let peer = null;
  let channel = null;
  let unsubscribeSignals = null;
  let stopped = false;
  let started = false;
  let status = "idle";
  let signalChain = Promise.resolve();
  let messageChain = Promise.resolve();
  let incomingImage = null;
  const pendingCandidates = [];
  const imageAcknowledgements = new Map();
  const messageAcknowledgements = new Map();
  const receivedMessageIds = new Set();
  const receivedTransferIds = new Set();

  const setStatus = (next, detail = "") => {
    if (status === next && !detail) return;
    status = next;
    onStatus({ status, detail });
  };

  const reportError = (error) => {
    if (stopped) return;
    onError(error instanceof Error ? error : new Error(String(error || "P2P error")));
  };

  const contextIsCurrent = () => !stopped && Boolean(peer);

  const sendSignal = async (type, payload) => {
    if (!contextIsCurrent()) return;
    const envelope = {
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      roomId: context.roomId,
      fromUid: context.ownUid,
      toUid: context.remoteUid,
      fromConnectionId: context.ownConnectionId,
      toConnectionId: context.remoteConnectionId,
      type,
      ...payload,
    };
    await signalTransport.send(envelope);
  };

  const drainCandidates = async () => {
    if (!peer?.remoteDescription) return;
    while (pendingCandidates.length && contextIsCurrent()) {
      const candidate = pendingCandidates.shift();
      await peer.addIceCandidate(candidate);
    }
  };

  const handleSignal = async (entry) => {
    if (!contextIsCurrent()) return;
    const signal = normalizedSignal(entry?.value || entry, context, Number(now()));
    if (!signal) {
      await entry?.consume?.().catch?.(noop);
      return;
    }
    try {
      if (signal.type === "offer") {
        await peer.setRemoteDescription(signal);
        await drainCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await sendSignal("answer", { sdp: answer.sdp });
      } else if (signal.type === "answer") {
        if (peer.signalingState !== "have-local-offer") return;
        await peer.setRemoteDescription(signal);
        await drainCandidates();
      } else {
        const candidate = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        };
        if (peer.remoteDescription) await peer.addIceCandidate(candidate);
        else pendingCandidates.push(candidate);
      }
    } catch (error) {
      reportError(error);
    } finally {
      await entry?.consume?.().catch?.(noop);
    }
  };

  const sendJson = (value) => {
    if (channel?.readyState !== "open") {
      throw new Error("P2Pメッセージ接続が切れています。");
    }
    channel.send(JSON.stringify(value));
  };

  const completeIncomingImage = async (message) => {
    const transfer = incomingImage;
    if (!transfer || transfer.transferId !== message.transferId) return;
    incomingImage = null;
    if (transfer.nextSequence !== transfer.chunkCount
        || transfer.receivedBytes !== transfer.size
        || Number(message.chunkCount) !== transfer.chunkCount) {
      throw new Error("画像転送が途中で終了しました。");
    }
    const blob = new Blob(transfer.chunks, { type: transfer.mime });
    const buffer = await blob.arrayBuffer();
    const digest = await sha256Hex(buffer);
    if (transfer.sha256 && digest !== transfer.sha256) {
      throw new Error("受信画像の検証に失敗しました。");
    }
    receivedTransferIds.add(transfer.transferId);
    while (receivedTransferIds.size > 12) {
      receivedTransferIds.delete(receivedTransferIds.values().next().value);
    }
    const delivery = Promise.resolve(onImage({
      blob,
      transferId: transfer.transferId,
      roundNumber: transfer.roundNumber,
      imageIndex: transfer.imageIndex,
      sha256: digest,
    }));
    sendJson({
      type: "v6-image-ack",
      protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
      transferId: transfer.transferId,
      roundNumber: transfer.roundNumber,
    });
    await delivery;
  };

  const handleJsonMessage = async (message) => {
    if (!message || typeof message !== "object"
        || message.protocolVersion !== TRAINING_V6_PROTOCOL_VERSION) return;
    if (message.type === "v6-image-start") {
      const transferId = String(message.transferId || "");
      const roundNumber = normalizedRoundNumber(message.roundNumber);
      const imageIndex = normalizedImageIndex(message.imageIndex);
      const size = Number(message.size);
      const chunkCount = imageChunkCount(size);
      const mime = normalizedMime(message.mime);
      const sha256 = String(message.sha256 || "");
      if (!isSafeToken(transferId)
          || !chunkCount
          || Number(message.chunkCount) !== chunkCount
          || (sha256 && !/^[0-9a-f]{64}$/.test(sha256))) {
        throw new Error("画像転送情報が不正です。");
      }
      if (receivedTransferIds.has(transferId)) {
        sendJson({
          type: "v6-image-ack",
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          transferId,
          roundNumber,
        });
        return;
      }
      incomingImage = {
        transferId,
        roundNumber,
        imageIndex,
        size,
        chunkCount,
        mime,
        sha256,
        chunks: [],
        nextSequence: 0,
        receivedBytes: 0,
      };
      return;
    }
    if (message.type === "v6-image-end") {
      await completeIncomingImage(message);
      return;
    }
    if (message.type === "v6-image-ack") {
      imageAcknowledgements.get(String(message.transferId || ""))?.resolve?.();
      return;
    }
    if (message.type === "v6-companion") {
      const event = message.event;
      if (!validateTrainingV6P2PEvent(event)
          || event.roomId !== context.roomId
          || event.fromUid !== context.remoteUid
          || event.toUid !== context.ownUid) return;
      sendJson({
        type: "v6-companion-ack",
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        eventId: event.eventId,
      });
      if (receivedMessageIds.has(event.eventId)) return;
      receivedMessageIds.add(event.eventId);
      while (receivedMessageIds.size > 40) {
        receivedMessageIds.delete(receivedMessageIds.values().next().value);
      }
      onCompanionMessage(event);
      return;
    }
    if (message.type === "v6-companion-ack") {
      messageAcknowledgements.get(String(message.eventId || ""))?.resolve?.();
    }
  };

  const handleChannelData = async (data) => {
    if (typeof data === "string") {
      if (data.length > 8_192) throw new Error("P2P制御情報が大きすぎます。");
      await handleJsonMessage(JSON.parse(data));
      return;
    }
    const frameValue = data instanceof Blob ? await data.arrayBuffer() : data;
    const frame = decodeTrainingV6ImageChunk(frameValue);
    if (!incomingImage || incomingImage.transferId !== frame.transferId) return;
    if (frame.sequence < incomingImage.nextSequence) return;
    if (frame.sequence !== incomingImage.nextSequence
        || frame.sequence >= incomingImage.chunkCount) {
      incomingImage = null;
      throw new Error("画像チャンクの順序が一致しません。");
    }
    const expectedSize = frame.sequence === incomingImage.chunkCount - 1
      ? incomingImage.size - (frame.sequence * TRAINING_V6_IMAGE_CHUNK_BYTES)
      : TRAINING_V6_IMAGE_CHUNK_BYTES;
    if (frame.payload.byteLength !== expectedSize) {
      incomingImage = null;
      throw new Error("画像チャンクのサイズが一致しません。");
    }
    incomingImage.chunks.push(frame.payload);
    incomingImage.nextSequence += 1;
    incomingImage.receivedBytes += frame.payload.byteLength;
  };

  const configureChannel = (nextChannel) => {
    if (channel && channel !== nextChannel) channel.close();
    channel = nextChannel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (!stopped && channel === nextChannel) setStatus("connected");
    };
    channel.onclose = () => {
      if (!stopped && channel === nextChannel) setStatus("recovering", "channel-closed");
    };
    channel.onerror = () => {
      if (!stopped && channel === nextChannel) setStatus("recovering", "channel-error");
    };
    channel.onmessage = (event) => {
      messageChain = messageChain
        .catch(noop)
        .then(() => handleChannelData(event.data))
        .catch(reportError);
    };
  };

  const start = async () => {
    if (started || stopped) return;
    started = true;
    setStatus("connecting");
    peer = peerFactory({
      iceServers: Array.isArray(iceServers) ? iceServers : [],
      iceTransportPolicy: "all",
    });
    peer.onicecandidate = (event) => {
      if (!event.candidate || !contextIsCurrent()) return;
      const candidate = event.candidate.toJSON
        ? event.candidate.toJSON()
        : event.candidate;
      sendSignal("candidate", {
        candidate: String(candidate.candidate || ""),
        sdpMid: String(candidate.sdpMid || ""),
        sdpMLineIndex: Number.isInteger(Number(candidate.sdpMLineIndex))
          ? Number(candidate.sdpMLineIndex)
          : 0,
      }).catch(reportError);
    };
    const handleConnectionState = () => {
      if (!contextIsCurrent()) return;
      if (peer.connectionState === "connected"
          || ["connected", "completed"].includes(peer.iceConnectionState)) {
        setStatus(channel?.readyState === "open" ? "connected" : "connecting");
      } else if (["failed", "closed"].includes(peer.connectionState)
          || peer.iceConnectionState === "failed") {
        setStatus("recovering", "ice-failed");
      } else if (peer.connectionState === "disconnected"
          || peer.iceConnectionState === "disconnected") {
        setStatus("recovering", "ice-disconnected");
      }
    };
    peer.onconnectionstatechange = handleConnectionState;
    peer.oniceconnectionstatechange = handleConnectionState;
    peer.ondatachannel = (event) => configureChannel(event.channel);
    unsubscribeSignals = signalTransport.subscribe((entry) => {
      signalChain = signalChain
        .catch(noop)
        .then(() => handleSignal(entry))
        .catch(reportError);
    });
    if (initiator) {
      configureChannel(peer.createDataChannel("hariai-training-v6", {
        ordered: true,
      }));
      const offer = await peer.createOffer();
      if (!contextIsCurrent()) return;
      await peer.setLocalDescription(offer);
      await sendSignal("offer", { sdp: offer.sdp });
    }
  };

  const sendImage = async ({
    blob,
    roundNumber,
    imageIndex,
  } = {}) => {
    if (!(blob instanceof Blob) || channel?.readyState !== "open") {
      throw new Error("画像を送るP2P接続を確認できません。");
    }
    const normalizedRound = normalizedRoundNumber(roundNumber);
    const normalizedIndex = normalizedImageIndex(imageIndex);
    const buffer = await blob.arrayBuffer();
    const count = imageChunkCount(buffer.byteLength);
    if (!count) throw new Error("送信画像が鍛え合い60の上限を超えています。");
    const transferId = createId();
    const mime = normalizedMime(blob.type || "image/webp");
    const digest = await sha256Hex(buffer);
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        imageAcknowledgements.delete(transferId);
        reject(new Error("相手の画像受信確認を待っています。"));
      }, TRAINING_V6_IMAGE_ACK_TIMEOUT_MS);
      imageAcknowledgements.set(transferId, {
        resolve: () => {
          globalThis.clearTimeout(timer);
          imageAcknowledgements.delete(transferId);
          resolve();
        },
        reject: (error) => {
          globalThis.clearTimeout(timer);
          imageAcknowledgements.delete(transferId);
          reject(error);
        },
      });
    });
    try {
      sendJson({
        type: "v6-image-start",
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        variant: TRAINING_V6_VARIANT,
        transferId,
        roundNumber: normalizedRound,
        imageIndex: normalizedIndex,
        size: buffer.byteLength,
        chunkCount: count,
        mime,
        sha256: digest,
      });
      for (let sequence = 0; sequence < count; sequence += 1) {
        await waitForBufferedAmount(channel);
        if (channel?.readyState !== "open") {
          throw new Error("画像送信中にP2P接続が切れました。");
        }
        const startOffset = sequence * TRAINING_V6_IMAGE_CHUNK_BYTES;
        const endOffset = Math.min(
          buffer.byteLength,
          startOffset + TRAINING_V6_IMAGE_CHUNK_BYTES,
        );
        channel.send(encodeTrainingV6ImageChunk(
          transferId,
          sequence,
          buffer.slice(startOffset, endOffset),
        ));
      }
      sendJson({
        type: "v6-image-end",
        protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
        transferId,
        roundNumber: normalizedRound,
        chunkCount: count,
      });
      await acknowledgement;
    } catch (error) {
      imageAcknowledgements.get(transferId)?.reject?.(error);
      await acknowledgement.catch(() => {});
      throw error;
    }
    return { transferId, sha256: digest };
  };

  const sendCompanionMessage = async (event) => {
    if (!validateTrainingV6P2PEvent(event)
        || event.roomId !== context.roomId
        || event.fromUid !== context.ownUid
        || event.toUid !== context.remoteUid) {
      throw new TypeError("companion event is invalid");
    }
    let acknowledged = false;
    let resolveAck = noop;
    let cancelAck = noop;
    const ackPromise = new Promise((resolve) => {
      resolveAck = () => {
        acknowledged = true;
        resolve(true);
      };
      cancelAck = () => resolve(false);
    });
    messageAcknowledgements.set(event.eventId, {
      resolve: resolveAck,
      cancel: cancelAck,
    });
    try {
      for (let attempt = 0; attempt <= MESSAGE_RETRY_DELAYS_MS.length; attempt += 1) {
        if (acknowledged) break;
        sendJson({
          type: "v6-companion",
          protocolVersion: TRAINING_V6_PROTOCOL_VERSION,
          event,
        });
        const waitMs = MESSAGE_RETRY_DELAYS_MS[
          Math.min(attempt, MESSAGE_RETRY_DELAYS_MS.length - 1)
        ];
        await Promise.race([ackPromise, timeoutPromise(waitMs)]);
      }
      return acknowledged;
    } finally {
      messageAcknowledgements.delete(event.eventId);
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribeSignals?.();
    unsubscribeSignals = null;
    channel?.close();
    peer?.close();
    channel = null;
    peer = null;
    incomingImage = null;
    for (const pending of imageAcknowledgements.values()) {
      pending.reject?.(new Error("P2P画像接続を終了しました。"));
    }
    imageAcknowledgements.clear();
    for (const pending of messageAcknowledgements.values()) pending.cancel?.();
    messageAcknowledgements.clear();
    setStatus("closed");
  };

  return Object.freeze({
    start,
    stop,
    sendImage,
    sendCompanionMessage,
    getStatus: () => status,
    isConnected: () => status === "connected" && channel?.readyState === "open",
    context,
    now,
  });
}
