const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, "../../team-asset-transfer.mjs"),
).href;

function webpBytes(width = 320, height = 240) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
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

function wavBytes(seconds = 1, {
  sampleRate = 8_000,
  channels = 1,
  bitsPerSample = 16,
  format = 1,
} = {}) {
  const blockAlign = channels * (bitsPerSample / 8);
  const dataBytes = Math.round(seconds * sampleRate) * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

function startMessage(overrides = {}) {
  return {
    type: "team-asset-start",
    transferId: "ta_12345678",
    ownerUid: "remote-player",
    phase: "battle",
    kind: "image",
    slot: "main",
    mime: "image/webp",
    size: 30,
    duration: 0,
    ...overrides,
  };
}

function endMessage(start, overrides = {}) {
  return {
    type: "team-asset-end",
    transferId: start.transferId,
    ownerUid: start.ownerUid,
    phase: start.phase,
    kind: start.kind,
    slot: start.slot,
    mime: start.mime,
    size: start.size,
    duration: start.duration,
    ...overrides,
  };
}

test("team assets verify complete WebP structure and bounded dimensions", async () => {
  const {
    isTeamAssetWebp,
    teamAssetWebpDimensions,
  } = await import(moduleUrl);

  assert.equal(isTeamAssetWebp(webpBytes()), true);
  assert.equal(isTeamAssetWebp(Uint8Array.from([0x47, 0x49, 0x46])), false);
  assert.deepEqual(teamAssetWebpDimensions(webpBytes()), { width: 320, height: 240 });
  assert.throws(() => teamAssetWebpDimensions(webpBytes(1281, 240)), /1280px/);

  const wrongRiffSize = webpBytes();
  new DataView(wrongRiffSize.buffer).setUint32(4, 1, true);
  assert.throws(() => teamAssetWebpDimensions(wrongRiffSize), /ファイルサイズ/);

  const truncatedChunk = webpBytes();
  new DataView(truncatedChunk.buffer).setUint32(16, 20, true);
  assert.throws(() => teamAssetWebpDimensions(truncatedChunk), /チャンクサイズ/);

  const trailingGarbage = new Uint8Array(31);
  trailingGarbage.set(webpBytes());
  new DataView(trailingGarbage.buffer).setUint32(4, 23, true);
  assert.throws(() => teamAssetWebpDimensions(trailingGarbage), /途切れ/);
});

test("team assets verify mono 16-bit PCM WAV structure and actual duration", async () => {
  const {
    teamAssetWavDuration,
  } = await import(moduleUrl);

  assert.equal(teamAssetWavDuration(wavBytes(1.25)), 1.25);
  assert.throws(
    () => teamAssetWavDuration(Uint8Array.from([0x52, 0x49, 0x46, 0x46])),
    /PCM WAV/,
  );
  assert.throws(() => teamAssetWavDuration(wavBytes(10.2)), /10秒/);
  assert.throws(
    () => teamAssetWavDuration(wavBytes(1, { channels: 2 })),
    /モノラル16bit PCM WAV/,
  );
  assert.throws(
    () => teamAssetWavDuration(wavBytes(1, { bitsPerSample: 8 })),
    /モノラル16bit PCM WAV/,
  );
  assert.throws(
    () => teamAssetWavDuration(wavBytes(1, { format: 3 })),
    /モノラル16bit PCM WAV/,
  );

  const wrongByteRate = wavBytes(1);
  new DataView(wrongByteRate.buffer).setUint32(28, 1, true);
  assert.throws(() => teamAssetWavDuration(wrongByteRate), /モノラル16bit PCM WAV/);
});

test("incoming transfer strictly validates sender, phase, kind, slot, MIME, size, and duration", async () => {
  const {
    TEAM_ASSET_AUDIO_MAX_BYTES,
    TEAM_ASSET_IMAGE_MAX_BYTES,
    createIncomingTeamAssetTransfer,
  } = await import(moduleUrl);

  const base = startMessage();
  const transfer = createIncomingTeamAssetTransfer(base, {
    expectedOwnerUid: "remote-player",
    expectedPhase: "battle",
  });
  assert.deepEqual(
    {
      ownerUid: transfer.ownerUid,
      phase: transfer.phase,
      kind: transfer.kind,
      slot: transfer.slot,
      received: transfer.received,
    },
    {
      ownerUid: "remote-player",
      phase: "battle",
      kind: "image",
      slot: "main",
      received: 0,
    },
  );

  assert.throws(
    () => createIncomingTeamAssetTransfer(base),
    /P2P受信元/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, ownerUid: "third-player" },
      { expectedOwnerUid: "remote-player" },
    ),
    /接続相手以外/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, phase: "talk", slot: "reference" },
      { expectedOwnerUid: "remote-player", expectedPhase: "battle" },
    ),
    /現在のフェーズ/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, phase: "invalid" },
      { expectedOwnerUid: "remote-player" },
    ),
    /フェーズ/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, kind: "video" },
      { expectedOwnerUid: "remote-player" },
    ),
    /種類/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, slot: "reference" },
      { expectedOwnerUid: "remote-player" },
    ),
    /メイン素材/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, mime: "image/png" },
      { expectedOwnerUid: "remote-player" },
    ),
    /形式/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, size: TEAM_ASSET_IMAGE_MAX_BYTES + 1 },
      { expectedOwnerUid: "remote-player" },
    ),
    /1.5MB/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, transferId: "short" },
      { expectedOwnerUid: "remote-player" },
    ),
    /転送ID/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      { ...base, duration: undefined },
      { expectedOwnerUid: "remote-player" },
    ),
    /再生時間/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      {
        ...base,
        phase: "talk",
        kind: "audio",
        slot: "reference",
        mime: "audio/wav",
        size: TEAM_ASSET_AUDIO_MAX_BYTES + 1,
        duration: 1,
      },
      { expectedOwnerUid: "remote-player" },
    ),
    /480KB/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      {
        ...base,
        phase: "talk",
        kind: "audio",
        slot: "reference",
        mime: "audio/wav",
        duration: 10.01,
      },
      { expectedOwnerUid: "remote-player" },
    ),
    /再生時間/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(base, {
      currentTransfer: transfer,
      expectedOwnerUid: "remote-player",
    }),
    /受信中/,
  );
});

test("battle/main and talk/reference are the only valid routing combinations", async () => {
  const {
    createIncomingTeamAssetTransfer,
  } = await import(moduleUrl);

  assert.doesNotThrow(() => createIncomingTeamAssetTransfer(
    startMessage(),
    { expectedOwnerUid: "remote-player" },
  ));
  assert.doesNotThrow(() => createIncomingTeamAssetTransfer(
    startMessage({ phase: "talk", slot: "reference" }),
    { expectedOwnerUid: "remote-player" },
  ));
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      startMessage({ phase: "battle", slot: "reference" }),
      { expectedOwnerUid: "remote-player" },
    ),
    /メイン素材/,
  );
  assert.throws(
    () => createIncomingTeamAssetTransfer(
      startMessage({ phase: "talk", slot: "main" }),
      { expectedOwnerUid: "remote-player" },
    ),
    /参考素材/,
  );
});

test("chunks are connection-local, copied, bounded, and accept Blob input", async () => {
  const {
    appendTeamAssetChunk,
    createIncomingTeamAssetTransfer,
  } = await import(moduleUrl);

  const transfer = createIncomingTeamAssetTransfer(
    startMessage({ size: 5 }),
    { expectedOwnerUid: "remote-player" },
  );
  const source = Uint8Array.from([1, 2]);
  assert.equal(await appendTeamAssetChunk(transfer, source), 2);
  source[0] = 9;
  assert.deepEqual(new Uint8Array(transfer.chunks[0]), Uint8Array.from([1, 2]));
  assert.equal(await appendTeamAssetChunk(transfer, new Blob([Uint8Array.from([3, 4, 5])])), 5);
  await assert.rejects(
    appendTeamAssetChunk(transfer, Uint8Array.from([6])),
    /申告値を超えました/,
  );
  await assert.rejects(
    appendTeamAssetChunk(null, Uint8Array.from([1])),
    /開始されていない/,
  );
  await assert.rejects(
    appendTeamAssetChunk(transfer, new Uint8Array()),
    /空の/,
  );
});

test("end status makes orphan ends harmless and distinguishes mismatch and incomplete", async () => {
  const {
    appendTeamAssetChunk,
    createIncomingTeamAssetTransfer,
    teamAssetEndStatus,
  } = await import(moduleUrl);

  const start = startMessage({ size: 3 });
  const end = endMessage(start);
  assert.equal(teamAssetEndStatus(null, end), "orphan");

  const transfer = createIncomingTeamAssetTransfer(start, {
    expectedOwnerUid: "remote-player",
  });
  assert.equal(teamAssetEndStatus(transfer, end), "incomplete");
  assert.equal(
    teamAssetEndStatus(transfer, { ...end, slot: "reference" }),
    "mismatch",
  );
  assert.equal(
    teamAssetEndStatus(transfer, { ...end, transferId: "ta_different" }),
    "mismatch",
  );
  await appendTeamAssetChunk(transfer, Uint8Array.from([1, 2, 3]));
  assert.equal(teamAssetEndStatus(transfer, end), "complete");
});

test("completed incoming image validates actual bytes and releases its object URL once", async () => {
  const {
    appendTeamAssetChunk,
    createIncomingTeamAssetTransfer,
    finishIncomingTeamAssetTransfer,
    releaseTeamAssetResource,
  } = await import(moduleUrl);

  const bytes = webpBytes();
  const start = startMessage({ size: bytes.byteLength });
  const transfer = createIncomingTeamAssetTransfer(start, {
    expectedOwnerUid: "remote-player",
  });
  await appendTeamAssetChunk(transfer, bytes.slice(0, 7));
  await appendTeamAssetChunk(transfer, new Blob([bytes.slice(7)]));

  const created = [];
  const revoked = [];
  const urlApi = {
    createObjectURL(blob) {
      created.push(blob);
      return "blob:team-image";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const resource = await finishIncomingTeamAssetTransfer(
    transfer,
    endMessage(start),
    { urlApi },
  );
  assert.equal(resource.ownerUid, "remote-player");
  assert.equal(resource.phase, "battle");
  assert.equal(resource.slot, "main");
  assert.equal(resource.kind, "image");
  assert.equal(resource.width, 320);
  assert.equal(resource.height, 240);
  assert.equal(resource.url, "blob:team-image");
  assert.equal(created[0].size, bytes.byteLength);

  releaseTeamAssetResource(resource, { urlApi });
  releaseTeamAssetResource(resource, { urlApi });
  assert.deepEqual(revoked, ["blob:team-image"]);
  assert.equal(resource.blob, null);
  assert.equal(resource.url, "");
  assert.equal(resource.released, true);
});

test("completed incoming audio stores verified WAV duration rather than trusting metadata", async () => {
  const {
    appendTeamAssetChunk,
    createIncomingTeamAssetTransfer,
    finishIncomingTeamAssetTransfer,
  } = await import(moduleUrl);

  const bytes = wavBytes(1.25);
  const start = startMessage({
    transferId: "ta_audio_ok",
    phase: "talk",
    kind: "audio",
    slot: "reference",
    mime: "audio/wav",
    size: bytes.byteLength,
    duration: 1.2,
  });
  const transfer = createIncomingTeamAssetTransfer(start, {
    expectedOwnerUid: "remote-player",
    expectedPhase: "talk",
  });
  await appendTeamAssetChunk(transfer, bytes);
  const resource = await finishIncomingTeamAssetTransfer(
    transfer,
    endMessage(start),
    {
      urlApi: {
        createObjectURL() {
          return "blob:team-audio";
        },
        revokeObjectURL() {},
      },
    },
  );
  assert.equal(resource.kind, "audio");
  assert.equal(resource.duration, 1.25);
  assert.equal(resource.width, 0);
  assert.equal(resource.height, 0);
});

test("completed incoming audio rejects mismatched duration and mislabeled bytes", async () => {
  const {
    appendTeamAssetChunk,
    createIncomingTeamAssetTransfer,
    finishIncomingTeamAssetTransfer,
  } = await import(moduleUrl);

  const audio = wavBytes(1);
  const start = startMessage({
    transferId: "ta_audio1234",
    phase: "talk",
    kind: "audio",
    slot: "reference",
    mime: "audio/wav",
    size: audio.byteLength,
    duration: 2,
  });
  const transfer = createIncomingTeamAssetTransfer(start, {
    expectedOwnerUid: "remote-player",
    expectedPhase: "talk",
  });
  await appendTeamAssetChunk(transfer, audio);
  await assert.rejects(
    finishIncomingTeamAssetTransfer(transfer, endMessage(start)),
    /申告時間/,
  );

  const fakeStart = startMessage({ size: 30 });
  const fakeTransfer = createIncomingTeamAssetTransfer(fakeStart, {
    expectedOwnerUid: "remote-player",
  });
  await appendTeamAssetChunk(fakeTransfer, new Uint8Array(30));
  await assert.rejects(
    finishIncomingTeamAssetTransfer(fakeTransfer, endMessage(fakeStart)),
    /WebP形式/,
  );
});

test("outgoing transfer revalidates actual bytes and normalizes authoritative metadata", async () => {
  const {
    createOutgoingTeamAssetTransfer,
    verifyTeamAssetBytes,
  } = await import(moduleUrl);

  const bytes = webpBytes(640, 360);
  const verified = verifyTeamAssetBytes(bytes, {
    kind: "image",
    mime: "image/webp",
    duration: 0,
  });
  assert.deepEqual(
    { width: verified.width, height: verified.height, mime: verified.mime },
    { width: 640, height: 360, mime: "image/webp" },
  );

  const outgoing = await createOutgoingTeamAssetTransfer({
    kind: "image",
    mime: "image/webp",
    duration: 0,
    blob: new Blob([bytes], { type: "image/webp" }),
  }, {
    transferId: "ta_outgoing1",
    ownerUid: "local-player",
    phase: "talk",
    slot: "reference",
    size: 1,
    mime: "image/png",
  });
  assert.equal(outgoing.transfer.size, bytes.byteLength);
  assert.equal(outgoing.transfer.mime, "image/webp");
  assert.equal(outgoing.transfer.duration, 0);
  assert.equal(outgoing.verified.width, 640);

  await assert.rejects(
    createOutgoingTeamAssetTransfer({
      kind: "image",
      mime: "image/webp",
      duration: 0,
      blob: new Blob([new Uint8Array(30)], { type: "image/webp" }),
    }, {
      transferId: "ta_outgoing2",
      ownerUid: "local-player",
      phase: "battle",
      slot: "main",
    }),
    /WebP形式/,
  );
});

test("sender emits strict ordered frames, bounded chunks, and progress", async () => {
  const {
    sendTeamAsset,
    teamAssetEndStatus,
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
  const transfer = await sendTeamAsset(channel, asset, {
    transferId: "ta_send12345",
    ownerUid: "local-player",
    phase: "battle",
    slot: "main",
  }, {
    chunkBytes: 7,
    onProgress(value) {
      progress.push(value);
    },
  });

  const start = JSON.parse(sent[0]);
  const end = JSON.parse(sent.at(-1));
  assert.deepEqual(Object.keys(start).sort(), [
    "duration",
    "kind",
    "mime",
    "ownerUid",
    "phase",
    "size",
    "slot",
    "transferId",
    "type",
  ]);
  assert.equal(start.type, "team-asset-start");
  assert.equal(end.type, "team-asset-end");
  assert.ok(sent.slice(1, -1).every((value) => value instanceof ArrayBuffer));
  assert.equal(progress.at(-1), 100);
  assert.equal(
    teamAssetEndStatus({ ...transfer, received: transfer.size }, end),
    "complete",
  );
});

test("sender rejects unavailable channels, invalid chunks, and inactive sessions", async () => {
  const {
    sendTeamAsset,
  } = await import(moduleUrl);

  const asset = {
    kind: "image",
    mime: "image/webp",
    blob: new Blob([webpBytes()], { type: "image/webp" }),
    duration: 0,
  };
  const metadata = {
    transferId: "ta_sendfail1",
    ownerUid: "local-player",
    phase: "battle",
    slot: "main",
  };
  await assert.rejects(
    sendTeamAsset({ readyState: "closed" }, asset, metadata),
    /P2P接続/,
  );
  await assert.rejects(
    sendTeamAsset({ readyState: "open", send() {} }, asset, metadata, {
      chunkBytes: 0,
    }),
    /チャンクサイズ/,
  );

  const sent = [];
  await assert.rejects(
    sendTeamAsset({
      readyState: "open",
      send(value) {
        sent.push(value);
      },
    }, asset, metadata, {
      isActive: () => false,
    }),
    /セッションが終了/,
  );
  assert.deepEqual(sent, []);
});

test("interrupted sender emits one matching end frame so the receiver can clear safely", async () => {
  const {
    sendTeamAsset,
  } = await import(moduleUrl);

  const sent = [];
  let active = true;
  const channel = {
    readyState: "open",
    send(value) {
      sent.push(value);
      if (value instanceof ArrayBuffer) active = false;
    },
  };
  await assert.rejects(
    sendTeamAsset(channel, {
      kind: "image",
      mime: "image/webp",
      blob: new Blob([webpBytes()], { type: "image/webp" }),
      duration: 0,
    }, {
      transferId: "ta_interrupt",
      ownerUid: "local-player",
      phase: "battle",
      slot: "main",
    }, {
      chunkBytes: 7,
      isActive: () => active,
    }),
    /中断/,
  );
  assert.equal(JSON.parse(sent[0]).type, "team-asset-start");
  assert.equal(JSON.parse(sent.at(-1)).type, "team-asset-end");
  assert.equal(sent.filter((value) => typeof value === "string").length, 2);
});

test("transfer IDs are cryptographically generated and resource collections release idempotently", async () => {
  const {
    createTeamAssetTransferId,
    releaseTeamAssetResources,
  } = await import(moduleUrl);

  const id = createTeamAssetTransferId({
    getRandomValues(bytes) {
      bytes.fill(0xab);
      return bytes;
    },
  });
  assert.equal(id, "ta_abababababababababababab");
  assert.throws(
    () => createTeamAssetTransferId({}),
    /安全な/,
  );

  const revoked = [];
  const first = { url: "blob:first", blob: {}, released: false };
  const second = { url: "blob:second", blob: {}, released: false };
  const resources = new Map([
    ["first", first],
    ["second", second],
  ]);
  releaseTeamAssetResources(resources, {
    urlApi: {
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  });
  assert.equal(resources.size, 0);
  assert.deepEqual(revoked, ["blob:first", "blob:second"]);
  assert.equal(first.blob, null);
  assert.equal(second.blob, null);
});
