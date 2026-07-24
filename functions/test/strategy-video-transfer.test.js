const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const transferModule = import(pathToFileURL(path.join(root, "strategy-video-transfer.mjs")).href);

function webmBytes(length = 40) {
  const bytes = new Uint8Array(length);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return bytes;
}

function mp4Bytes(length = 40) {
  const bytes = new Uint8Array(length);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return bytes;
}

const incomingOptions = {
  expectedOwnerUid: "opponent_123",
  allowedPhases: ["battle"],
  now: 1_800_000_000_000,
};

function validStart(overrides = {}) {
  return {
    type: "strategy-video-start",
    transferId: "sv_0123456789abcdef",
    ownerUid: "opponent_123",
    phase: "battle",
    round: 2,
    mime: "video/webm;codecs=vp8,opus",
    size: 40,
    duration: 9.8,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("strategy video detects WebM and MP4 bytes even when headers are split", async () => {
  const {
    strategyVideoMimeFromBytes,
    strategyVideoMimeFromChunks,
    verifiedStrategyVideoMimeFromChunks,
  } = await transferModule;

  assert.equal(strategyVideoMimeFromBytes(webmBytes()), "video/webm");
  assert.equal(strategyVideoMimeFromBytes(mp4Bytes()), "video/mp4");
  assert.equal(strategyVideoMimeFromChunks([
    mp4Bytes().slice(0, 3),
    mp4Bytes().slice(3, 9),
    mp4Bytes().slice(9),
  ]), "video/mp4");
  assert.equal(verifiedStrategyVideoMimeFromChunks([
    webmBytes().slice(0, 2),
    webmBytes().slice(2),
  ], "video/webm;codecs=vp8,opus"), "video/webm");
  assert.throws(
    () => verifiedStrategyVideoMimeFromChunks([mp4Bytes()], "video/webm"),
    /申告形式と実データが一致しません/,
  );
  assert.throws(
    () => verifiedStrategyVideoMimeFromChunks([Uint8Array.from([0x47, 0x49, 0x46])], "video/webm"),
    /動画形式が不正です/,
  );
});

test("incoming strategy video enforces opponent, consent phase, round, size, duration, MIME, and one transfer", async () => {
  const {
    STRATEGY_VIDEO_MAX_BYTES,
    createIncomingStrategyVideoTransfer,
  } = await transferModule;

  const transfer = createIncomingStrategyVideoTransfer(validStart(), incomingOptions);
  assert.equal(transfer.ownerUid, "opponent_123");
  assert.equal(transfer.phase, "battle");
  assert.equal(transfer.round, 2);
  assert.equal(transfer.mime, "video/webm");
  assert.equal(transfer.received, 0);

  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ ownerUid: "stranger" }), incomingOptions),
    /対戦相手以外/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ type: "strategy-image-start" }), incomingOptions),
    /開始情報/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ phase: "review", round: 0 }), incomingOptions),
    /現在のフェーズ/,
  );
  assert.doesNotThrow(() => createIncomingStrategyVideoTransfer(
    validStart({ phase: "review", round: 0 }),
    { ...incomingOptions, allowedPhases: ["review"] },
  ));
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ phase: "review", round: 3 }), {
      ...incomingOptions,
      allowedPhases: ["review"],
    }),
    /ラウンド情報/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ size: STRATEGY_VIDEO_MAX_BYTES + 1 }), incomingOptions),
    /受信サイズ/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ duration: 10.11 }), incomingOptions),
    /録画時間/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart({ mime: "video/quicktime" }), incomingOptions),
    /動画形式/,
  );
  assert.throws(
    () => createIncomingStrategyVideoTransfer(validStart(), { ...incomingOptions, currentTransfer: transfer }),
    /別の動画転送/,
  );
});

test("strategy video appends bounded binary chunks and requires matching complete end metadata", async () => {
  const {
    appendStrategyVideoChunk,
    createIncomingStrategyVideoTransfer,
    strategyVideoEndMessage,
    strategyVideoEndStatus,
  } = await transferModule;

  const transfer = createIncomingStrategyVideoTransfer(validStart(), incomingOptions);
  await appendStrategyVideoChunk(transfer, webmBytes().slice(0, 12));
  await appendStrategyVideoChunk(transfer, new Blob([webmBytes().slice(12)], { type: "application/octet-stream" }));
  assert.equal(transfer.received, 40);
  const end = strategyVideoEndMessage(transfer);
  assert.equal(strategyVideoEndStatus(transfer, end), "complete");
  assert.equal(strategyVideoEndStatus(transfer, { ...end, transferId: "sv_different000000" }), "mismatch");
  assert.equal(strategyVideoEndStatus(null, end), "orphan");

  const incomplete = createIncomingStrategyVideoTransfer(validStart(), incomingOptions);
  await appendStrategyVideoChunk(incomplete, webmBytes().slice(0, 12));
  assert.equal(strategyVideoEndStatus(incomplete, strategyVideoEndMessage(incomplete)), "incomplete");
  await assert.rejects(
    appendStrategyVideoChunk(incomplete, new Uint8Array(29)),
    /申告値を超えました/,
  );
});

test("completed strategy video creates one object URL and cleanup is idempotent", async () => {
  const {
    appendStrategyVideoChunk,
    createIncomingStrategyVideoTransfer,
    finishIncomingStrategyVideoTransfer,
    releaseStrategyVideoResource,
    releaseStrategyVideoResources,
    strategyVideoEndMessage,
  } = await transferModule;

  const created = [];
  const revoked = [];
  const urlApi = {
    createObjectURL(blob) {
      created.push(blob);
      return "blob:strategy-video-1";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const transfer = createIncomingStrategyVideoTransfer(validStart(), incomingOptions);
  await appendStrategyVideoChunk(transfer, webmBytes());
  const resource = finishIncomingStrategyVideoTransfer(transfer, strategyVideoEndMessage(transfer), { urlApi });
  assert.equal(resource.url, "blob:strategy-video-1");
  assert.equal(resource.blob.size, 40);
  assert.equal(resource.mime, "video/webm");
  assert.equal(resource.duration, 9.8);
  assert.equal(created.length, 1);

  releaseStrategyVideoResource(resource, { urlApi });
  releaseStrategyVideoResource(resource, { urlApi });
  assert.deepEqual(revoked, ["blob:strategy-video-1"]);
  assert.equal(resource.url, "");
  assert.equal(resource.blob, null);
  assert.equal(resource.released, true);

  const mapResource = { blob: new Blob([webmBytes()]), url: "blob:strategy-video-2", released: false };
  const resources = new Map([["clip", mapResource]]);
  releaseStrategyVideoResources(resources, { urlApi });
  assert.equal(resources.size, 0);
  assert.equal(mapResource.released, true);
  assert.deepEqual(revoked, ["blob:strategy-video-1", "blob:strategy-video-2"]);
});

test("recording defaults request 480p and prefer WebM with a Safari-compatible MP4 fallback", async () => {
  const {
    preferredStrategyVideoMimeType,
    strategyVideoCaptureConstraints,
  } = await transferModule;

  class WebmRecorder {
    static isTypeSupported(type) {
      return type === "video/webm;codecs=vp8,opus";
    }
  }
  class Mp4Recorder {
    static isTypeSupported(type) {
      return type === "video/mp4";
    }
  }
  assert.equal(preferredStrategyVideoMimeType(WebmRecorder), "video/webm;codecs=vp8,opus");
  assert.equal(preferredStrategyVideoMimeType(Mp4Recorder), "video/mp4");
  assert.equal(preferredStrategyVideoMimeType(class {}), "");

  const constraints = strategyVideoCaptureConstraints();
  assert.equal(constraints.video.width.max, 854);
  assert.equal(constraints.video.height.max, 480);
  assert.equal(constraints.video.frameRate.max, 30);
  assert.equal(constraints.video.facingMode.ideal, "environment");
  assert.equal(constraints.audio.channelCount.max, 1);
});

test("recording session stops camera and microphone and returns a releasable clip", async () => {
  const {
    releaseStrategyVideoResource,
    startStrategyVideoRecording,
  } = await transferModule;

  const tracks = [{ stopped: 0, stop() { this.stopped += 1; } }, { stopped: 0, stop() { this.stopped += 1; } }];
  const stream = { getTracks: () => tracks };
  let requestedConstraints = null;
  const mediaDevices = {
    async getUserMedia(constraints) {
      requestedConstraints = constraints;
      return stream;
    },
  };
  class FakeRecorder {
    static isTypeSupported(type) {
      return type === "video/webm;codecs=vp8,opus";
    }
    constructor(receivedStream, options) {
      this.stream = receivedStream;
      this.options = options;
      this.mimeType = "video/webm;codecs=vp8,opus";
      this.state = "inactive";
      this.listeners = new Map();
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    start(timeslice) {
      this.timeslice = timeslice;
      this.state = "recording";
    }
    stop() {
      this.emit("dataavailable", { data: new Blob([webmBytes()], { type: this.mimeType }) });
      this.state = "inactive";
      this.emit("stop");
    }
  }
  const timers = {
    setTimeout() { return 7; },
    clearTimeout() {},
  };
  const objectUrls = [];
  const urlApi = {
    createObjectURL() {
      objectUrls.push("blob:recorded");
      return "blob:recorded";
    },
    revokeObjectURL(url) {
      objectUrls.push(`revoked:${url}`);
    },
  };
  let elapsedMs = 0;
  const session = await startStrategyVideoRecording({
    mediaDevices,
    MediaRecorderClass: FakeRecorder,
    timerApi: timers,
    urlApi,
    clock: () => elapsedMs,
  });
  elapsedMs = 5_000;
  const clip = await session.stop();

  assert.equal(requestedConstraints.video.height.max, 480);
  assert.equal(session.recorder.options.videoBitsPerSecond, 1_200_000);
  assert.equal(session.recorder.options.audioBitsPerSecond, 64_000);
  assert.equal(session.recorder.timeslice, 250);
  assert.equal(clip.mime, "video/webm");
  assert.equal(clip.duration, 5);
  assert.equal(clip.size, 40);
  assert.equal(clip.url, "blob:recorded");
  assert.deepEqual(tracks.map((track) => track.stopped), [1, 1]);

  releaseStrategyVideoResource(clip, { urlApi });
  assert.deepEqual(objectUrls, ["blob:recorded", "revoked:blob:recorded"]);
});

test("sender emits validated start, bounded chunks, and matching end frames", async () => {
  const {
    sendStrategyVideoClip,
    strategyVideoEndStatus,
  } = await transferModule;

  const sent = [];
  const progress = [];
  const channel = {
    readyState: "open",
    send(value) {
      sent.push(value);
    },
  };
  const clip = {
    blob: new Blob([mp4Bytes()], { type: "video/mp4" }),
    mime: "video/mp4",
    duration: 4.2,
    createdAt: 1_700_000_000_000,
  };
  const transfer = await sendStrategyVideoClip(channel, clip, {
    transferId: "sv_abcdef0123456789",
    ownerUid: "local_123",
    phase: "review",
    round: 0,
  }, {
    chunkBytes: 16,
    onProgress: (value) => progress.push(value),
  });

  const start = JSON.parse(sent[0]);
  const end = JSON.parse(sent.at(-1));
  assert.equal(start.type, "strategy-video-start");
  assert.equal(start.phase, "review");
  assert.equal(end.type, "strategy-video-end");
  assert.equal(strategyVideoEndStatus({ ...transfer, received: transfer.size }, end), "complete");
  assert.equal(sent.length, 5);
  assert.deepEqual(progress, [40, 80, 100]);
  assert.ok(sent.slice(1, -1).every((value) => value instanceof ArrayBuffer));
});

test("strategy browser wiring isolates video transfer and releases ephemeral media", () => {
  const source = fs.readFileSync(path.join(root, "strategy.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "strategy.css"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(source, /strategy-video-transfer\.mjs\?v=strategy-video-review-v1/);
  assert.match(source, /STRATEGY_VIDEO_CHANNEL_LABEL = "hariai-strategy-videos-v1"/);
  assert.match(source, /createDataChannel\(STRATEGY_VIDEO_CHANNEL_LABEL, \{ ordered: true \}\)/);
  assert.match(source, /expectedOwnerUid: state\.opponentUid/);
  assert.match(source, /allowedPhases: \[phase\]/);
  assert.match(source, /if \(data\.length > 4096\)/);
  assert.match(source, /if \(!channel \|\| channel\.readyState !== "open"\) return Promise\.reject/);
  assert.match(source, /finishIncomingStrategyVideoTransfer\(transfer, message\)/);
  assert.match(source, /state\.videoChannel\?\.close\(\)/);
  assert.match(source, /releaseStrategyVideoResources\(state\.videoClips\)/);
  assert.match(source, /function releaseMatchMedia\(\)[\s\S]*?releaseStrategyVideoData\(\)/);
  assert.match(source, /function releaseAllImages\(\)[\s\S]*?releaseMatchMedia\(\)/);
  assert.match(source, /async function retryConnection\(\)[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.errorMessage/);
  assert.match(styles, /\.strategy-video-dialog\b/);
  assert.match(styles, /\.strategy-video-clip video[\s\S]*?aspect-ratio: 16 \/ 9/);
  assert.match(html, /strategy\.css\?v=[^"]*video-review-v1/);
  assert.match(html, /strategy\.js\?v=[^"]*video-review-v1/);
});
