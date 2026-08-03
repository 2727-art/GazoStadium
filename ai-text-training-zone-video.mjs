export const AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT = 5;
export const AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const AI_TEXT_TRAINING_ZONE_VIDEO_MAX_SECONDS = 30;
export const AI_TEXT_TRAINING_ZONE_VIDEO_DURATION_TOLERANCE_SECONDS = 0.1;
export const AI_TEXT_TRAINING_ZONE_VIDEO_ASPECT_TOLERANCE = 0.02;
export const AI_TEXT_TRAINING_ZONE_AUDIO_SOURCES = Object.freeze([
  "metronome",
  "video",
]);

export const AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS = Object.freeze([
  Object.freeze({
    id: "9:16",
    width: 9,
    height: 16,
    maxWidth: 1080,
    maxHeight: 1920,
  }),
  Object.freeze({
    id: "4:5",
    width: 4,
    height: 5,
    maxWidth: 1080,
    maxHeight: 1350,
  }),
]);

function finiteNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizedVideoDurations(durations) {
  return Array.isArray(durations)
    ? durations
      .slice(0, AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT)
      .map((value) => finiteNumber(value))
      .filter((value) => value !== null && value > 0)
    : [];
}

export function aiTextTrainingZoneVideoClipIndex(logicalSlotIndex, clipCount) {
  const normalizedSlotIndex = Math.floor(finiteNumber(logicalSlotIndex) ?? -1);
  const normalizedCount = Math.max(0, Math.floor(finiteNumber(clipCount) || 0));
  if (normalizedSlotIndex < 0
      || normalizedCount <= 0
      || normalizedCount > AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT) return null;
  return normalizedSlotIndex % normalizedCount;
}

export function aiTextTrainingZoneVideoAspect(width, height) {
  const normalizedWidth = finiteNumber(width);
  const normalizedHeight = finiteNumber(height);
  if (normalizedWidth === null
      || normalizedHeight === null
      || normalizedWidth <= 0
      || normalizedHeight <= 0) {
    return null;
  }
  const ratio = normalizedWidth / normalizedHeight;
  return AI_TEXT_TRAINING_ZONE_VIDEO_ASPECTS.find((candidate) => {
    const target = candidate.width / candidate.height;
    return Math.abs(ratio - target) / target
      <= AI_TEXT_TRAINING_ZONE_VIDEO_ASPECT_TOLERANCE + (Number.EPSILON * 8);
  }) || null;
}

export function validateAiTextTrainingZoneVideoMetadata({
  size,
  type = "",
  duration,
  width,
  height,
} = {}) {
  const normalizedSize = finiteNumber(size);
  if (normalizedSize === null || normalizedSize <= 0) {
    throw new RangeError("空の動画ファイルは選択できません。");
  }
  if (normalizedSize > AI_TEXT_TRAINING_ZONE_VIDEO_MAX_BYTES) {
    throw new RangeError("動画は1本20MiB以内にしてください。");
  }
  const normalizedType = String(type || "").trim().toLowerCase();
  if (normalizedType && !normalizedType.startsWith("video/")) {
    throw new TypeError("このファイルは動画として読み込めません。");
  }
  const normalizedDuration = finiteNumber(duration);
  if (normalizedDuration === null || normalizedDuration <= 0) {
    throw new RangeError("動画の長さを確認できませんでした。");
  }
  if (normalizedDuration
      > AI_TEXT_TRAINING_ZONE_VIDEO_MAX_SECONDS
        + AI_TEXT_TRAINING_ZONE_VIDEO_DURATION_TOLERANCE_SECONDS) {
    throw new RangeError("動画は30秒以内にしてください。");
  }
  const normalizedWidth = Math.round(finiteNumber(width) || 0);
  const normalizedHeight = Math.round(finiteNumber(height) || 0);
  const aspect = aiTextTrainingZoneVideoAspect(normalizedWidth, normalizedHeight);
  if (!aspect) {
    throw new RangeError("動画は縦向きの9:16または4:5にしてください。");
  }
  if (normalizedWidth > aspect.maxWidth || normalizedHeight > aspect.maxHeight) {
    throw new RangeError(
      `${aspect.id}動画は最大${aspect.maxWidth}×${aspect.maxHeight}pxにしてください。`,
    );
  }
  return Object.freeze({
    size: Math.round(normalizedSize),
    type: normalizedType,
    duration: normalizedDuration,
    width: normalizedWidth,
    height: normalizedHeight,
    aspectId: aspect.id,
  });
}

export function aiTextTrainingZoneVideoPlaybackFrame({
  durations = [],
  totalMs,
  remainingMs,
} = {}) {
  const normalizedDurations = normalizedVideoDurations(durations);
  const normalizedTotalMs = Math.max(0, finiteNumber(totalMs) || 0);
  if (!normalizedDurations.length || normalizedTotalMs <= 0) return null;
  const normalizedRemainingMs = Math.max(
    0,
    Math.min(normalizedTotalMs, finiteNumber(remainingMs) ?? normalizedTotalMs),
  );
  const elapsedMs = normalizedTotalMs - normalizedRemainingMs;
  const segmentMs = normalizedTotalMs / normalizedDurations.length;
  const index = Math.min(
    normalizedDurations.length - 1,
    Math.floor(elapsedMs / segmentMs),
  );
  const segmentElapsedMs = Math.max(0, elapsedMs - (index * segmentMs));
  const duration = normalizedDurations[index];
  return Object.freeze({
    index,
    currentTime: (segmentElapsedMs / 1000) % duration,
    segmentMs,
  });
}

export function aiTextTrainingRoundVideoPlaybackFrame({
  durations = [],
  roundIndex,
  totalMs,
  remainingMs,
} = {}) {
  const normalizedDurations = normalizedVideoDurations(durations);
  const index = aiTextTrainingZoneVideoClipIndex(roundIndex, normalizedDurations.length);
  const normalizedTotalMs = Math.max(0, finiteNumber(totalMs) || 0);
  if (index === null || normalizedTotalMs <= 0) return null;
  const normalizedRemainingMs = Math.max(
    0,
    Math.min(normalizedTotalMs, finiteNumber(remainingMs) ?? normalizedTotalMs),
  );
  const elapsedMs = normalizedTotalMs - normalizedRemainingMs;
  return Object.freeze({
    index,
    currentTime: (elapsedMs / 1000) % normalizedDurations[index],
    segmentMs: normalizedTotalMs,
  });
}

export function aiTextTrainingZoneVideoIsEligible({
  playStyle,
  cheerPresentation,
  clipCount,
} = {}) {
  const normalizedCount = Math.max(0, Math.floor(finiteNumber(clipCount) || 0));
  return playStyle === "defeat_zone"
    && cheerPresentation === "doodle"
    && normalizedCount > 0
    && normalizedCount <= AI_TEXT_TRAINING_ZONE_VIDEO_MAX_COUNT;
}

export function normalizeAiTextTrainingZoneAudioSource(value, clipCount = 0) {
  const normalizedCount = Math.max(0, Math.floor(finiteNumber(clipCount) || 0));
  return value === "video" && normalizedCount > 0 ? "video" : "metronome";
}
