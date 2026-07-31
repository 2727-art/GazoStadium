"use strict";

const assert = require("node:assert/strict");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const moduleUrl = pathToFileURL(
  join(__dirname, "..", "..", "training-v6-p2p.mjs"),
).href;

test("Training V6 image chunks round-trip without JSON/base64 expansion", async () => {
  const {
    decodeTrainingV6ImageChunk,
    encodeTrainingV6ImageChunk,
  } = await import(moduleUrl);
  const payload = Uint8Array.from({ length: 1_024 }, (_, index) => index % 251);
  const encoded = encodeTrainingV6ImageChunk(
    "transfer_1234567890",
    7,
    payload,
  );
  const decoded = decodeTrainingV6ImageChunk(encoded);
  assert.equal(decoded.transferId, "transfer_1234567890");
  assert.equal(decoded.sequence, 7);
  assert.deepEqual([...decoded.payload], [...payload]);
});

test("Training V6 image chunks reject malformed headers and oversized payloads", async () => {
  const {
    decodeTrainingV6ImageChunk,
    encodeTrainingV6ImageChunk,
    TRAINING_V6_IMAGE_CHUNK_BYTES,
  } = await import(moduleUrl);
  assert.throws(
    () => decodeTrainingV6ImageChunk(new Uint8Array([1, 2, 3]).buffer),
    /invalid/,
  );
  assert.throws(
    () => encodeTrainingV6ImageChunk(
      "transfer_1234567890",
      0,
      new Uint8Array(TRAINING_V6_IMAGE_CHUNK_BYTES + 1),
    ),
    /invalid/,
  );
});
