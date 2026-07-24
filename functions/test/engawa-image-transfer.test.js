const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const transferModule = import(pathToFileURL(path.join(root, "engawa-image-transfer.mjs")).href);
const maxBytes = 15 * 1024 * 1024;

const webpBytes = () => Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const pngBytes = () => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const jpegBytes = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

test("engawa detects WebP, PNG, and JPEG from bytes without trusting declared MIME", async () => {
  const {
    appendIncomingEngawaImageChunk,
    completeIncomingEngawaImageTransfer,
    createIncomingEngawaImageTransfer,
  } = await transferModule;

  for (const [bytes, declaredMime, actualMime] of [
    [webpBytes(), "image/png", "image/webp"],
    [pngBytes(), "image/jpeg", "image/png"],
    [jpegBytes(), "application/octet-stream", "image/jpeg"],
  ]) {
    const transfer = createIncomingEngawaImageTransfer({
      size: bytes.byteLength,
      mime: declaredMime,
    }, { maxBytes });
    const split = Math.max(1, Math.floor(bytes.byteLength / 2));
    appendIncomingEngawaImageChunk(transfer, bytes.slice(0, split));
    appendIncomingEngawaImageChunk(transfer, bytes.slice(split).buffer);

    assert.equal(transfer.declaredMime, declaredMime);
    assert.equal(transfer.received, bytes.byteLength);
    assert.equal(completeIncomingEngawaImageTransfer(transfer), actualMime);
  }
});

test("engawa rejects unsafe declared sizes and overlong MIME metadata", async () => {
  const { createIncomingEngawaImageTransfer } = await transferModule;

  for (const size of [0, -1, 1.5, maxBytes + 1]) {
    assert.throws(() => createIncomingEngawaImageTransfer({
      size,
      mime: "image/webp",
    }, { maxBytes }), /縁側画像の受信サイズが不正です/);
  }
  assert.throws(() => createIncomingEngawaImageTransfer({
    size: 12,
    mime: "x".repeat(81),
  }, { maxBytes }), /縁側画像の形式情報が不正です/);
});

test("engawa rejects zero-byte, overrun, incomplete, and unsupported image data", async () => {
  const {
    appendIncomingEngawaImageChunk,
    completeIncomingEngawaImageTransfer,
    createIncomingEngawaImageTransfer,
  } = await transferModule;

  const zeroByte = createIncomingEngawaImageTransfer({
    size: 4,
    mime: "image/jpeg",
  }, { maxBytes });
  assert.throws(
    () => appendIncomingEngawaImageChunk(zeroByte, new ArrayBuffer(0)),
    /受信画像のデータが不正です/,
  );
  assert.equal(zeroByte.received, 0);
  assert.equal(zeroByte.chunks.length, 0);

  const overrun = createIncomingEngawaImageTransfer({
    size: 3,
    mime: "image/jpeg",
  }, { maxBytes });
  assert.throws(
    () => appendIncomingEngawaImageChunk(overrun, jpegBytes()),
    /宣言値を超えました/,
  );
  assert.equal(overrun.received, 0);
  assert.equal(overrun.chunks.length, 0);

  const incomplete = createIncomingEngawaImageTransfer({
    size: pngBytes().byteLength + 1,
    mime: "image/png",
  }, { maxBytes });
  appendIncomingEngawaImageChunk(incomplete, pngBytes());
  assert.throws(
    () => completeIncomingEngawaImageTransfer(incomplete),
    /受信画像のサイズが一致しませんでした/,
  );

  const unsupported = createIncomingEngawaImageTransfer({
    size: 4,
    mime: "image/webp",
  }, { maxBytes });
  appendIncomingEngawaImageChunk(unsupported, Uint8Array.from([0x47, 0x49, 0x46, 0x38]));
  assert.throws(
    () => completeIncomingEngawaImageTransfer(unsupported),
    /受信画像の形式が不正です/,
  );
});

test("engawa image end is idempotent for orphan and duplicate notifications", async () => {
  const {
    createIncomingEngawaImageTransfer,
    engawaImageEndStatus,
  } = await transferModule;
  const transfer = createIncomingEngawaImageTransfer({
    size: webpBytes().byteLength,
    mime: "",
  }, { maxBytes });

  assert.equal(engawaImageEndStatus(null), "orphan");
  assert.equal(engawaImageEndStatus(undefined), "orphan");
  assert.equal(engawaImageEndStatus(transfer), "complete");
});

test("profile, engawa, and battle incoming image namespaces are mutually exclusive", async () => {
  const { assertIncomingTransferNamespaceExclusive } = await transferModule;
  const fields = {
    profile: "incomingAvatarTransfer",
    engawa: "incomingEngawaTransfer",
    battle: "incomingTransfer",
  };

  for (const [requestedKind, requestedField] of Object.entries(fields)) {
    assert.equal(assertIncomingTransferNamespaceExclusive({
      [requestedField]: { active: true },
    }, requestedKind), true);
    for (const [activeKind, activeField] of Object.entries(fields)) {
      if (activeKind === requestedKind) continue;
      assert.throws(
        () => assertIncomingTransferNamespaceExclusive({
          [activeField]: { active: true },
        }, requestedKind),
        /別のP2P画像を受信中です/,
      );
    }
  }
  assert.throws(
    () => assertIncomingTransferNamespaceExclusive({}, "unknown"),
    /P2P画像転送の種別が不正です/,
  );
});
