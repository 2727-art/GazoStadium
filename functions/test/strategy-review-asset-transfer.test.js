const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../../strategy-review-asset-transfer.mjs")).href;

function webpBytes(width = 320, height = 240) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  const write24 = (offset, value) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  write(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, "WEBP");
  write(12, "VP8X");
  view.setUint32(16, 10, true);
  write24(24, width - 1);
  write24(27, height - 1);
  return bytes;
}

function wavBytes(seconds = 1, sampleRate = 8_000) {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

test("review assets verify WebP bytes and mono PCM WAV duration", async () => {
  const {
    isStrategyReviewWebp,
    strategyReviewWebpDimensions,
    strategyReviewWavDuration,
  } = await import(moduleUrl);
  assert.equal(isStrategyReviewWebp(webpBytes()), true);
  assert.equal(isStrategyReviewWebp(Uint8Array.from([0x47, 0x49, 0x46])), false);
  assert.deepEqual(strategyReviewWebpDimensions(webpBytes()), { width: 320, height: 240 });
  assert.throws(() => strategyReviewWebpDimensions(webpBytes(1281, 240)), /1280px/);
  assert.equal(strategyReviewWavDuration(wavBytes(1.25)), 1.25);
  assert.throws(() => strategyReviewWavDuration(Uint8Array.from([0x52, 0x49, 0x46, 0x46])), /WAV/);
  assert.throws(() => strategyReviewWavDuration(wavBytes(10.2)), /10秒/);
});

test("incoming review asset enforces opponent, kind, format, size, duration, and one transfer", async () => {
  const {
    STRATEGY_REVIEW_IMAGE_MAX_BYTES,
    createIncomingStrategyReviewAssetTransfer,
  } = await import(moduleUrl);
  const base = {
    type: "strategy-review-asset-start",
    transferId: "sr_12345678",
    ownerUid: "opponent",
    phase: "review",
    kind: "image",
    mime: "image/webp",
    size: 16,
    duration: 0,
    createdAt: 123,
  };
  const transfer = createIncomingStrategyReviewAssetTransfer(base, { expectedOwnerUid: "opponent" });
  assert.equal(transfer.kind, "image");
  assert.equal(transfer.received, 0);
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer({ ...base, ownerUid: "third-party" }, { expectedOwnerUid: "opponent" }),
    /対戦相手以外/,
  );
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer({ ...base, phase: "battle" }, { expectedOwnerUid: "opponent" }),
    /品評会以外/,
  );
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer({ ...base, mime: "image/png" }, { expectedOwnerUid: "opponent" }),
    /形式/,
  );
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer({ ...base, size: STRATEGY_REVIEW_IMAGE_MAX_BYTES + 1 }, { expectedOwnerUid: "opponent" }),
    /1.5MB/,
  );
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer({
      ...base,
      kind: "audio",
      mime: "audio/wav",
      duration: 11,
    }, { expectedOwnerUid: "opponent" }),
    /再生時間/,
  );
  assert.throws(
    () => createIncomingStrategyReviewAssetTransfer(base, { currentTransfer: transfer, expectedOwnerUid: "opponent" }),
    /受信中/,
  );
});

test("completed incoming review image checks exact framing and releases its object URL once", async () => {
  const {
    appendStrategyReviewAssetChunk,
    createIncomingStrategyReviewAssetTransfer,
    finishIncomingStrategyReviewAssetTransfer,
    releaseStrategyReviewAssetResource,
  } = await import(moduleUrl);
  const bytes = webpBytes();
  const message = {
    type: "strategy-review-asset-start",
    transferId: "sr_abcdefgh",
    ownerUid: "opponent",
    phase: "review",
    kind: "image",
    mime: "image/webp",
    size: bytes.byteLength,
    duration: 0,
    createdAt: 456,
  };
  const transfer = createIncomingStrategyReviewAssetTransfer(message, { expectedOwnerUid: "opponent" });
  await appendStrategyReviewAssetChunk(transfer, bytes.slice(0, 7));
  await appendStrategyReviewAssetChunk(transfer, new Blob([bytes.slice(7)]));
  const created = [];
  const revoked = [];
  const urlApi = {
    createObjectURL(blob) {
      created.push(blob);
      return "blob:review-image";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const resource = await finishIncomingStrategyReviewAssetTransfer(transfer, {
    type: "strategy-review-asset-end",
    transferId: message.transferId,
    ownerUid: message.ownerUid,
    phase: "review",
    kind: "image",
    mime: "image/webp",
    size: bytes.byteLength,
    duration: 0,
  }, { urlApi });
  assert.equal(resource.kind, "image");
  assert.equal(resource.url, "blob:review-image");
  assert.equal(created[0].size, bytes.byteLength);
  releaseStrategyReviewAssetResource(resource, { urlApi });
  releaseStrategyReviewAssetResource(resource, { urlApi });
  assert.deepEqual(revoked, ["blob:review-image"]);
  assert.equal(resource.blob, null);
});

test("incoming audio rejects duration metadata that does not match WAV bytes", async () => {
  const {
    appendStrategyReviewAssetChunk,
    createIncomingStrategyReviewAssetTransfer,
    finishIncomingStrategyReviewAssetTransfer,
  } = await import(moduleUrl);
  const bytes = wavBytes(1);
  const message = {
    type: "strategy-review-asset-start",
    transferId: "sr_audio1234",
    ownerUid: "opponent",
    phase: "review",
    kind: "audio",
    mime: "audio/wav",
    size: bytes.byteLength,
    duration: 2,
  };
  const transfer = createIncomingStrategyReviewAssetTransfer(message, { expectedOwnerUid: "opponent" });
  await appendStrategyReviewAssetChunk(transfer, bytes);
  await assert.rejects(
    finishIncomingStrategyReviewAssetTransfer(transfer, {
      type: "strategy-review-asset-end",
      transferId: message.transferId,
      ownerUid: message.ownerUid,
      phase: "review",
      kind: "audio",
      mime: "audio/wav",
      size: bytes.byteLength,
      duration: 2,
    }),
    /申告時間/,
  );
});

test("review asset sender emits bounded ordered frames with progress", async () => {
  const {
    sendStrategyReviewAsset,
  } = await import(moduleUrl);
  const sent = [];
  const progress = [];
  const channel = {
    readyState: "open",
    send(value) {
      sent.push(value);
    },
  };
  const asset = {
    kind: "image",
    mime: "image/webp",
    blob: new Blob([webpBytes()], { type: "image/webp" }),
    duration: 0,
  };
  const transfer = await sendStrategyReviewAsset(channel, asset, {
    transferId: "sr_outgoing1",
    ownerUid: "sender",
    createdAt: 789,
  }, {
    chunkBytes: 7,
    onProgress(value) {
      progress.push(value);
    },
  });
  assert.equal(transfer.kind, "image");
  assert.equal(JSON.parse(sent[0]).type, "strategy-review-asset-start");
  assert.equal(JSON.parse(sent.at(-1)).type, "strategy-review-asset-end");
  assert.ok(sent.slice(1, -1).every((value) => value instanceof ArrayBuffer));
  assert.equal(progress.at(-1), 100);
});
