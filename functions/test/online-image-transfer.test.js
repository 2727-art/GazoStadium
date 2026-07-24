const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const transferModule = import(pathToFileURL(path.join(root, "online-image-transfer.mjs")).href);
const maxBytes = 15 * 1024 * 1024;

const webpBytes = () => Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const pngBytes = () => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const jpegBytes = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

test("normal 1on1 detects WebP, PNG, and JPEG from actual bytes", async () => {
  const {
    onlineImageMimeFromBytes,
    onlineImageMimeFromChunks,
    verifiedOnlineImageMime,
  } = await transferModule;

  assert.equal(onlineImageMimeFromBytes(webpBytes()), "image/webp");
  assert.equal(onlineImageMimeFromBytes(pngBytes()), "image/png");
  assert.equal(onlineImageMimeFromBytes(jpegBytes()), "image/jpeg");
  assert.equal(verifiedOnlineImageMime(pngBytes()), "image/png");

  const webp = webpBytes();
  assert.equal(onlineImageMimeFromChunks([
    webp.slice(0, 1),
    webp.slice(1, 3),
    webp.slice(3, 9),
    webp.slice(9),
  ]), "image/webp");
  assert.equal(onlineImageMimeFromChunks([
    pngBytes().slice(0, 2),
    pngBytes().slice(2, 7),
    pngBytes().slice(7),
  ]), "image/png");
});

test("normal 1on1 validates round and size without trusting declared MIME", async () => {
  const { createIncomingOnlineImageTransfer } = await transferModule;

  for (const mime of ["image/webp", "image/png", "application/octet-stream", ""]) {
    const transfer = createIncomingOnlineImageTransfer({
      round: 2,
      size: maxBytes,
      mime,
    }, {
      expectedRound: 2,
      maxBytes,
    });
    assert.equal(transfer.round, 2);
    assert.equal(transfer.size, maxBytes);
    assert.equal(transfer.declaredMime, mime);
  }

  for (const size of [0, -1, 1.5, maxBytes + 1]) {
    assert.throws(() => createIncomingOnlineImageTransfer({
      round: 2,
      size,
      mime: "image/webp",
    }, {
      expectedRound: 2,
      maxBytes,
    }), /受信画像のサイズが不正です/);
  }
  assert.throws(() => createIncomingOnlineImageTransfer({
    round: 3,
    size: 12,
    mime: "image/webp",
  }, {
    expectedRound: 2,
    maxBytes,
  }), /受信画像のラウンド情報が不正です/);
  assert.throws(() => createIncomingOnlineImageTransfer({
    round: 2,
    size: 12,
    mime: "x".repeat(81),
  }, {
    expectedRound: 2,
    maxBytes,
  }), /受信画像の形式情報が不正です/);
});

test("normal 1on1 completes from chunk bytes and rejects incomplete or unsafe data", async () => {
  const {
    appendIncomingOnlineImageChunk,
    completeIncomingOnlineImageTransfer,
    createIncomingOnlineImageTransfer,
  } = await transferModule;

  const png = pngBytes();
  const transfer = createIncomingOnlineImageTransfer({
    round: 1,
    size: png.byteLength,
    mime: "image/webp",
  }, {
    expectedRound: 1,
    maxBytes,
  });
  appendIncomingOnlineImageChunk(transfer, png.slice(0, 3));
  appendIncomingOnlineImageChunk(transfer, png.slice(3).buffer);
  assert.equal(transfer.received, png.byteLength);
  assert.equal(completeIncomingOnlineImageTransfer(transfer), "image/png");

  const incomplete = createIncomingOnlineImageTransfer({
    round: 1,
    size: png.byteLength + 1,
    mime: "",
  }, {
    expectedRound: 1,
    maxBytes,
  });
  appendIncomingOnlineImageChunk(incomplete, png);
  assert.throws(() => completeIncomingOnlineImageTransfer(incomplete), /受信画像のサイズが一致しませんでした/);

  const invalid = createIncomingOnlineImageTransfer({
    round: 1,
    size: 4,
    mime: "image/webp",
  }, {
    expectedRound: 1,
    maxBytes,
  });
  appendIncomingOnlineImageChunk(invalid, Uint8Array.from([0x47, 0x49, 0x46, 0x38]));
  assert.throws(() => completeIncomingOnlineImageTransfer(invalid), /受信画像の形式が不正です/);

  const overrun = createIncomingOnlineImageTransfer({
    round: 1,
    size: 3,
    mime: "image/jpeg",
  }, {
    expectedRound: 1,
    maxBytes,
  });
  assert.throws(() => appendIncomingOnlineImageChunk(overrun, jpegBytes()), /宣言値を超えました/);
  assert.equal(overrun.received, 0);
  assert.equal(overrun.chunks.length, 0);
  assert.throws(() => appendIncomingOnlineImageChunk(overrun, new ArrayBuffer(0)), /受信画像のデータが不正です/);
  assert.throws(() => appendIncomingOnlineImageChunk(overrun, "not binary"), /受信画像のデータが不正です/);
});

test("normal 1on1 ignores orphan ends and identifies mismatched rounds", async () => {
  const {
    createIncomingOnlineImageTransfer,
    onlineImageEndStatus,
  } = await transferModule;
  const transfer = createIncomingOnlineImageTransfer({
    round: 4,
    size: 12,
    mime: "image/webp",
  }, {
    expectedRound: 4,
    maxBytes,
  });

  assert.equal(onlineImageEndStatus(null, { round: 4 }), "orphan");
  assert.equal(onlineImageEndStatus(transfer, { round: 3 }), "mismatch");
  assert.equal(onlineImageEndStatus(transfer, { round: 4 }), "complete");
});

test("normal 1on1 browser wiring validates bytes, serializes sends, and bounds buffer waits", () => {
  const source = fs.readFileSync(path.join(root, "online.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(source, /online-image-transfer\.mjs\?v=online-image-transfer-v1/);
  assert.match(source, /createIncomingOnlineImageTransfer\(message/);
  assert.match(source, /completeIncomingOnlineImageTransfer\(transfer\)/);
  assert.match(source, /verifiedOnlineImageMime\(buffer\)/);
  assert.match(source, /if \(endStatus === "orphan"\) return;/);
  assert.match(source, /message\.type === "image-cancel"/);
  assert.doesNotMatch(source, /受信画像の転送開始情報が重複しています/);
  assert.doesNotMatch(
    source,
    /message\.type === "image-start"[\s\S]{0,700}message\.mime !== "image\/webp"/,
  );

  assert.match(
    source,
    /await sendProfileAvatar\(\);[\s\S]{0,300}await announceSelectionReady\(\);/,
  );
  assert.match(source, /queueOutgoingDataTransfer\(expectedState/);
  assert.match(source, /PROFILE_AVATAR_READY_WAIT_MS/);
  assert.match(source, /profileTransferSettled = error\?\.profileTransferReset === true/);
  assert.match(source, /type: "profile-avatar-empty"/);
  assert.match(source, /channel\.addEventListener\("close", handleClose/);
  assert.match(source, /channel\.addEventListener\("error", handleClose/);
  assert.match(source, /DATA_BUFFER_WAIT_MS/);
  assert.match(source, /incomingMessageChain/);

  assert.match(source, /normalizeOnlineImageMime\(message\.mime\)/);
  assert.match(source, /verifiedOnlineImageMimeFromChunks\(transfer\.chunks\)/);
  assert.match(source, /function finishIncomingProfileAvatar\(\)[\s\S]{0,120}if \(!transfer\) return;/);
  assert.match(source, /id="onlineRetryImageTransfer"/);
  assert.match(source, /state\.imageTransferError = error\?\.message/);
  assert.match(source, /!state\.sentImageRounds\.has\(state\.round\) && !state\.imageTransferError/);
  assert.match(source, /startImageAckWatchdog\(expectedState, round\)/);
  assert.match(source, /IMAGE_ACK_WAIT_MS/);
  assert.match(source, /if \(received\[state\.opponentUid\] && state\.imageAckRound === state\.round\)/);
  assert.match(html, /online\.js\?v=[^"]*online-image-transfer-v1/);
});
