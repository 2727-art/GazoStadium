const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const transferModule = import(pathToFileURL(path.join(root, "market-transfer.mjs")).href);

const limits = {
  role: "buyer",
  maxImageBytes: 5 * 1024 * 1024,
  maxAudioBytes: 480 * 1024,
  maxTurns: 3,
  now: 1_800_000_000_000,
};

test("VALUE MARKET accepts image starts without trusting the declared MIME", async () => {
  const { createIncomingMarketTransfer } = await transferModule;

  for (const mime of ["image/webp", "image/png", "image/jpeg", "", " application/octet-stream "]) {
    const transfer = createIncomingMarketTransfer({
      kind: "image",
      turn: 0,
      mime,
      size: 12_345,
      name: "ブラウザ変換画像",
      createdAt: 1_700_000_000_000,
    }, limits);

    assert.equal(transfer.kind, "image");
    assert.equal(transfer.mime, mime.trim().toLowerCase());
    assert.equal(transfer.size, 12_345);
    assert.equal(transfer.turn, 0);
  }
});

test("VALUE MARKET identifies supported raster bytes and rejects other data", async () => {
  const {
    marketImageMimeFromBytes,
    marketImageMimeFromChunks,
    verifiedMarketImageMime,
  } = await transferModule;

  const webpHeader = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(marketImageMimeFromBytes(webpHeader), "image/webp");
  assert.equal(marketImageMimeFromChunks([
    webpHeader.slice(0, 2),
    webpHeader.slice(2, 9),
    webpHeader.slice(9),
  ]), "image/webp");
  assert.equal(marketImageMimeFromBytes(Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])), "image/png");
  assert.equal(marketImageMimeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.throws(() => verifiedMarketImageMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38])), /画像形式が不正です/);
});

test("VALUE MARKET still rejects invalid audio metadata", async () => {
  const { createIncomingMarketTransfer } = await transferModule;

  assert.throws(() => createIncomingMarketTransfer({
    kind: "audio",
    turn: 1,
    mime: "audio/mpeg",
    size: 1_000,
  }, limits), /音声形式が不正です/);
});

test("VALUE MARKET keeps transfer size and turn limits", async () => {
  const { createIncomingMarketTransfer } = await transferModule;

  assert.throws(() => createIncomingMarketTransfer({
    kind: "image",
    turn: 0,
    mime: "image/png",
    size: limits.maxImageBytes + 1,
  }, limits), /受信データのサイズが不正です/);

  assert.throws(() => createIncomingMarketTransfer({
    kind: "audio",
    turn: 4,
    mime: "audio/wav",
    size: 1_000,
  }, limits), /受信データのターンが不正です/);
});

test("a rejected start does not turn its trailing end into a second error", async () => {
  const { marketAssetEndStatus } = await transferModule;

  assert.equal(marketAssetEndStatus(null, { kind: "image", turn: 0 }), "orphan");
  assert.equal(marketAssetEndStatus({ kind: "image", turn: 0 }, { kind: "image", turn: 0 }), "complete");
  assert.equal(marketAssetEndStatus({ kind: "audio", turn: 1 }, { kind: "audio", turn: 2 }), "mismatch");
});

test("the browser market handler uses the tested transfer validator", () => {
  const source = fs.readFileSync(path.join(root, "market.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(source, /market-transfer\.mjs\?v=value-market-transfer-v1/);
  assert.match(source, /createIncomingMarketTransfer\(message/);
  assert.match(source, /verifiedMarketImageMime\(buffer\)/);
  assert.match(source, /verifiedMarketImageMimeFromChunks\(transfer\.chunks\)/);
  assert.match(source, /if \(endStatus === "orphan"\) return;/);
  assert.doesNotMatch(source, /message\.mime !== "image\/webp"/);
  assert.match(html, /market\.js\?v=[^"]*transfer-v1[^"]*app-check-v2/);
});
