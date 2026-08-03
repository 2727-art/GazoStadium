"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const videoModule = import(
  pathToFileURL(path.join(root, "ai-text-training-zone-video.mjs")).href
);

function validMetadata(overrides = {}) {
  return {
    size: 5 * 1024 * 1024,
    type: "video/mp4",
    duration: 30,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

test("ZONE video limits expose the agreed five local clips, 20 MiB, 30 seconds, and two portrait formats", async () => {
  const {
    AI_TEXT_TRAINING_ZONE_AUDIO_SOURCES,
    AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS,
    AI_TEXT_TRAINING_ZONE_VIDEO_ASPECT_TOLERANCE,
    AI_TEXT_TRAINING_ZONE_VIDEO_DURATION_TOLERANCE_SECONDS,
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT,
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_SECONDS,
  } = await videoModule;

  assert.equal(AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT, 5);
  assert.equal(AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(AI_TEXT_TRAINING_ZONE_VIDEO_MAX_SECONDS, 30);
  assert.equal(AI_TEXT_TRAINING_ZONE_VIDEO_DURATION_TOLERANCE_SECONDS, 0.1);
  assert.equal(AI_TEXT_TRAINING_ZONE_VIDEO_ASPECT_TOLERANCE, 0.02);
  assert.deepEqual(AI_TEXT_TRAINING_ZONE_AUDIO_SOURCES, ["metronome", "video"]);
  assert.equal(Object.isFrozen(AI_TEXT_TRAINING_ZONE_AUDIO_SOURCES), true);
  assert.deepEqual(AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS, [
    { id: "9:16", width: 9, height: 16, maxWidth: 1080, maxHeight: 1920 },
    { id: "4:5", width: 4, height: 5, maxWidth: 1080, maxHeight: 1350 },
  ]);
  assert.equal(Object.isFrozen(AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS), true);
  assert.ok(AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS.every(Object.isFrozen));
});

test("ZONE video metadata accepts exact size and duration limits and returns normalized immutable metadata", async () => {
  const {
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
    validateAiTextTrainingZoneVideoMetadata,
  } = await videoModule;

  const portrait916 = validateAiTextTrainingZoneVideoMetadata(validMetadata({
    size: AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
    type: "  VIDEO/MP4  ",
    duration: "30",
  }));
  assert.deepEqual(portrait916, {
    size: AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
    type: "video/mp4",
    duration: 30,
    width: 1080,
    height: 1920,
    aspectId: "9:16",
  });
  assert.equal(Object.isFrozen(portrait916), true);

  const portrait45 = validateAiTextTrainingZoneVideoMetadata(validMetadata({
    type: "video/webm;codecs=vp9",
    width: 1080,
    height: 1350,
  }));
  assert.equal(portrait45.aspectId, "4:5");
  assert.equal(portrait45.type, "video/webm;codecs=vp9");

  const unknownBrowserMime = validateAiTextTrainingZoneVideoMetadata(validMetadata({ type: "" }));
  assert.equal(unknownBrowserMime.type, "");
});

test("ZONE video metadata rejects empty, non-finite, and oversized files without rounding past the limit", async () => {
  const {
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
    validateAiTextTrainingZoneVideoMetadata,
  } = await videoModule;

  for (const size of [undefined, null, "", 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ size })),
      /空の動画ファイル/,
    );
  }
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({
      size: AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES + 1,
    })),
    /20MiB以内/,
  );
  assert.equal(
    validateAiTextTrainingZoneVideoMetadata(validMetadata({
      size: AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES - 0.4,
    })).size,
    AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES,
  );
});

test("ZONE video metadata accepts video MIME values or an unavailable MIME and rejects non-video types", async () => {
  const { validateAiTextTrainingZoneVideoMetadata } = await videoModule;

  for (const type of ["video/mp4", "video/webm", "video/quicktime", " VIDEO/MP4 ", ""]) {
    assert.doesNotThrow(() => validateAiTextTrainingZoneVideoMetadata(validMetadata({ type })));
  }
  for (const type of ["image/jpeg", "audio/mp4", "application/octet-stream", "text/plain"]) {
    assert.throws(
      () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ type })),
      /動画として読み込めません/,
    );
  }
});

test("ZONE video duration permits only positive finite metadata through the 0.1 second boundary", async () => {
  const { validateAiTextTrainingZoneVideoMetadata } = await videoModule;

  for (const duration of [0.001, 1, 29.999, 30, 30.1, "30.1"]) {
    assert.doesNotThrow(() => validateAiTextTrainingZoneVideoMetadata(validMetadata({ duration })));
  }
  for (const duration of [undefined, null, "", 0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ duration })),
      /動画の長さを確認できません/,
    );
  }
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ duration: 30.100001 })),
    /30秒以内/,
  );
});

test("ZONE video aspect detection accepts both exact portrait ratios and rejects invalid dimensions and landscape video", async () => {
  const { aiTextTrainingZoneVideoAspect } = await videoModule;

  assert.equal(aiTextTrainingZoneVideoAspect(1080, 1920)?.id, "9:16");
  assert.equal(aiTextTrainingZoneVideoAspect(720, 1280)?.id, "9:16");
  assert.equal(aiTextTrainingZoneVideoAspect(1080, 1350)?.id, "4:5");
  assert.equal(aiTextTrainingZoneVideoAspect(720, 900)?.id, "4:5");
  for (const dimensions of [
    [0, 1920],
    [1080, 0],
    [-1080, 1920],
    [1080, Number.NaN],
    [Number.POSITIVE_INFINITY, 1920],
    [1920, 1080],
    [1000, 1000],
  ]) {
    assert.equal(aiTextTrainingZoneVideoAspect(...dimensions), null);
  }
});

test("ZONE video aspect tolerance is relative, inclusive at two percent, and rejects either side beyond it", async () => {
  const { aiTextTrainingZoneVideoAspect } = await videoModule;

  const cases = [
    { id: "9:16", insideLow: [441, 800], outsideLow: [440, 800], insideHigh: [459, 800], outsideHigh: [460, 800] },
    { id: "4:5", insideLow: [98, 125], outsideLow: [979, 1250], insideHigh: [102, 125], outsideHigh: [1021, 1250] },
  ];
  for (const { id, insideLow, outsideLow, insideHigh, outsideHigh } of cases) {
    assert.equal(aiTextTrainingZoneVideoAspect(...insideLow)?.id, id, `${id} lower 2% boundary`);
    assert.equal(aiTextTrainingZoneVideoAspect(...insideHigh)?.id, id, `${id} upper 2% boundary`);
    assert.equal(aiTextTrainingZoneVideoAspect(...outsideLow), null, `${id} below tolerance`);
    assert.equal(aiTextTrainingZoneVideoAspect(...outsideHigh), null, `${id} above tolerance`);
  }
});

test("ZONE video metadata enforces the resolution ceiling for the detected aspect", async () => {
  const { validateAiTextTrainingZoneVideoMetadata } = await videoModule;

  assert.equal(
    validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1080, height: 1920 })).aspectId,
    "9:16",
  );
  assert.equal(
    validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1080, height: 1350 })).aspectId,
    "4:5",
  );
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1081, height: 1920 })),
    /9:16動画は最大1080×1920px/,
  );
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1080, height: 1921 })),
    /9:16動画は最大1080×1920px/,
  );
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1081, height: 1350 })),
    /4:5動画は最大1080×1350px/,
  );
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1080, height: 1351 })),
    /4:5動画は最大1080×1350px/,
  );
  assert.throws(
    () => validateAiTextTrainingZoneVideoMetadata(validMetadata({ width: 1000, height: 1000 })),
    /縦向きの9:16または4:5/,
  );
});

test("ZONE video playback gives five clips equal four-second turns across the 20-second rush", async () => {
  const { aiTextTrainingZoneVideoPlaybackFrame } = await videoModule;
  const input = { durations: [30, 30, 30, 30, 30], totalMs: 20_000 };
  const expectations = [
    [20_000, 0, 0],
    [16_001, 0, 3.999],
    [16_000, 1, 0],
    [12_000, 2, 0],
    [8_000, 3, 0],
    [4_000, 4, 0],
    [1, 4, 3.999],
    [0, 4, 4],
  ];

  for (const [remainingMs, index, currentTime] of expectations) {
    const frame = aiTextTrainingZoneVideoPlaybackFrame({ ...input, remainingMs });
    assert.equal(frame.index, index, `remaining ${remainingMs}`);
    assert.equal(frame.segmentMs, 4_000);
    assert.ok(Math.abs(frame.currentTime - currentTime) < 1e-9);
    assert.equal(Object.isFrozen(frame), true);
  }
});

test("ZONE video playback loops a short clip inside its turn and clamps invalid remaining time", async () => {
  const { aiTextTrainingZoneVideoPlaybackFrame } = await videoModule;

  const looped = aiTextTrainingZoneVideoPlaybackFrame({
    durations: [2, 30],
    totalMs: 20_000,
    remainingMs: 16_500,
  });
  assert.equal(looped.index, 0);
  assert.equal(looped.segmentMs, 10_000);
  assert.equal(looped.currentTime, 1.5);

  assert.deepEqual(
    aiTextTrainingZoneVideoPlaybackFrame({ durations: [10], totalMs: 20_000, remainingMs: 99_000 }),
    { index: 0, currentTime: 0, segmentMs: 20_000 },
  );
  assert.deepEqual(
    aiTextTrainingZoneVideoPlaybackFrame({ durations: [10], totalMs: 20_000, remainingMs: -1 }),
    { index: 0, currentTime: 0, segmentMs: 20_000 },
  );
});

test("ZONE video playback ignores unusable durations, caps the sequence at five slots, and returns null without a timeline", async () => {
  const { aiTextTrainingZoneVideoPlaybackFrame } = await videoModule;

  for (const input of [
    {},
    { durations: [], totalMs: 20_000 },
    { durations: [0, -1, Number.NaN, Number.POSITIVE_INFINITY], totalMs: 20_000 },
    { durations: [30], totalMs: 0 },
    { durations: [30], totalMs: -1 },
    { durations: "30", totalMs: 20_000 },
  ]) {
    assert.equal(aiTextTrainingZoneVideoPlaybackFrame(input), null);
  }

  const filtered = aiTextTrainingZoneVideoPlaybackFrame({
    durations: [0, 10, Number.NaN, 20, -1, 30],
    totalMs: 20_000,
    remainingMs: 5_000,
  });
  assert.equal(filtered.index, 1);
  assert.equal(filtered.segmentMs, 10_000);
  assert.equal(filtered.currentTime, 5);

  const capped = aiTextTrainingZoneVideoPlaybackFrame({
    durations: [10, 10, 10, 10, 10, 10],
    totalMs: 20_000,
    remainingMs: 0,
  });
  assert.equal(capped.index, 4);
  assert.equal(capped.segmentMs, 4_000);
});

test("ZONE video playback eligibility is limited to defeat-ZONE doodle sessions with one through five clips", async () => {
  const { aiTextTrainingZoneVideoIsEligible } = await videoModule;

  for (const clipCount of [1, 2, 5, "5", 5.9]) {
    assert.equal(aiTextTrainingZoneVideoIsEligible({
      playStyle: "defeat_zone",
      cheerPresentation: "doodle",
      clipCount,
    }), true);
  }
  for (const input of [
    { playStyle: "standard", cheerPresentation: "doodle", clipCount: 1 },
    { playStyle: "defeat_zone", cheerPresentation: "classic", clipCount: 1 },
    { playStyle: "defeat_zone", cheerPresentation: "DOODLE", clipCount: 1 },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: 0 },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: 0.9 },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: -1 },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: 6 },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: Number.NaN },
    { playStyle: "defeat_zone", cheerPresentation: "doodle", clipCount: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(aiTextTrainingZoneVideoIsEligible(input), false);
  }
});

test("ZONE audio source is exclusive, defaults to metronome, and requires a selected video for video sound", async () => {
  const { normalizeAiTextTrainingZoneAudioSource } = await videoModule;

  assert.equal(normalizeAiTextTrainingZoneAudioSource("video", 1), "video");
  assert.equal(normalizeAiTextTrainingZoneAudioSource("video", 5), "video");
  for (const [value, count] of [
    ["video", 0],
    ["video", -1],
    ["metronome", 5],
    ["unknown", 5],
    ["VIDEO", 5],
    [null, 5],
  ]) {
    assert.equal(normalizeAiTextTrainingZoneAudioSource(value, count), "metronome");
  }
});

test("session video maps five rounds one-to-one and cycles smaller local clip sets", async () => {
  const { aiTextTrainingZoneVideoClipIndex } = await videoModule;

  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingZoneVideoClipIndex(roundIndex, 5)
    )),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingZoneVideoClipIndex(roundIndex, 4)
    )),
    [0, 1, 2, 3, 0],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingZoneVideoClipIndex(roundIndex, 3)
    )),
    [0, 1, 2, 0, 1],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingZoneVideoClipIndex(roundIndex, 2)
    )),
    [0, 1, 0, 1, 0],
  );
  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingZoneVideoClipIndex(roundIndex, 1)
    )),
    [0, 0, 0, 0, 0],
  );
  for (const [logicalSlotIndex, clipCount] of [
    [-1, 5],
    [Number.NaN, 5],
    [0, 0],
    [0, -1],
    [0, 6],
    [0, Number.POSITIVE_INFINITY],
  ]) {
    assert.equal(aiTextTrainingZoneVideoClipIndex(logicalSlotIndex, clipCount), null);
  }
});

test("round video playback keeps one mapped clip and loops it by active round time", async () => {
  const { aiTextTrainingRoundVideoPlaybackFrame } = await videoModule;
  const durations = [2, 3, 4, 5, 6];

  const cases = [
    { roundIndex: 0, remainingMs: 20_000, index: 0, currentTime: 0 },
    { roundIndex: 0, remainingMs: 15_000, index: 0, currentTime: 1 },
    { roundIndex: 1, remainingMs: 15_000, index: 1, currentTime: 2 },
    { roundIndex: 2, remainingMs: 15_000, index: 2, currentTime: 1 },
    { roundIndex: 3, remainingMs: 15_000, index: 3, currentTime: 0 },
    { roundIndex: 4, remainingMs: 15_000, index: 4, currentTime: 5 },
  ];
  for (const expected of cases) {
    const frame = aiTextTrainingRoundVideoPlaybackFrame({
      durations,
      roundIndex: expected.roundIndex,
      totalMs: 20_000,
      remainingMs: expected.remainingMs,
    });
    assert.equal(frame?.index, expected.index);
    assert.equal(frame?.currentTime, expected.currentTime);
  }

  assert.deepEqual(
    Array.from({ length: 5 }, (_, roundIndex) => (
      aiTextTrainingRoundVideoPlaybackFrame({
        durations: [7, 11],
        roundIndex,
        totalMs: 60_000,
        remainingMs: 60_000,
      })?.index
    )),
    [0, 1, 0, 1, 0],
  );
});

test("round video playback clamps elapsed time and rejects unusable timelines", async () => {
  const { aiTextTrainingRoundVideoPlaybackFrame } = await videoModule;

  assert.equal(
    aiTextTrainingRoundVideoPlaybackFrame({
      durations: [7],
      roundIndex: 0,
      totalMs: 60_000,
      remainingMs: 99_000,
    })?.currentTime,
    0,
  );
  assert.equal(
    aiTextTrainingRoundVideoPlaybackFrame({
      durations: [7],
      roundIndex: 0,
      totalMs: 60_000,
      remainingMs: -1,
    })?.currentTime,
    4,
  );
  for (const input of [
    {},
    { durations: [], roundIndex: 0, totalMs: 20_000, remainingMs: 20_000 },
    { durations: [2], roundIndex: 0, totalMs: 0, remainingMs: 0 },
    { durations: [2], roundIndex: -1, totalMs: 20_000, remainingMs: 20_000 },
    { durations: [2], roundIndex: Number.NaN, totalMs: 20_000, remainingMs: 20_000 },
  ]) {
    assert.equal(aiTextTrainingRoundVideoPlaybackFrame(input), null);
  }
});
