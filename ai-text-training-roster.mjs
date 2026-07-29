import {
  AI_TEXT_TRAINING_ROUND_COUNT,
} from "./ai-text-training-core.mjs";

export const AI_TEXT_TRAINING_DRAW_COUNT = AI_TEXT_TRAINING_ROUND_COUNT;
export const AI_TEXT_TRAINING_ROSTER_MIN_COUNT = AI_TEXT_TRAINING_DRAW_COUNT;
export const AI_TEXT_TRAINING_ROSTER_MAX_COUNT = 10;

function normalizeRosterCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count)
      || count < AI_TEXT_TRAINING_ROSTER_MIN_COUNT
      || count > AI_TEXT_TRAINING_ROSTER_MAX_COUNT) {
    return null;
  }
  return count;
}

function randomUnit(rng) {
  if (typeof rng !== "function") {
    throw new TypeError("DRAW用の乱数生成器を確認してください。");
  }
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

function shuffled(values, rng) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(randomUnit(rng) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function sameOrderedIndices(first, second) {
  return first.every((value, index) => value === second[index]);
}

function sameIndexSet(first, second) {
  if (first.length !== second.length) return false;
  const secondSet = new Set(second);
  return first.every((value) => secondSet.has(value));
}

export function isAiTextTrainingRosterCount(value) {
  return normalizeRosterCount(value) !== null;
}

export function normalizeAiTextTrainingDrawIndices(value, rosterCountValue) {
  const rosterCount = normalizeRosterCount(rosterCountValue);
  if (rosterCount === null
      || !Array.isArray(value)
      || value.length !== AI_TEXT_TRAINING_DRAW_COUNT) {
    return null;
  }
  const indices = value.map((entry) => Number(entry));
  if (indices.some((index) => (
    !Number.isSafeInteger(index)
    || index < 0
    || index >= rosterCount
  ))) {
    return null;
  }
  if (new Set(indices).size !== AI_TEXT_TRAINING_DRAW_COUNT) return null;
  return indices;
}

export function drawAiTextTrainingRosterIndices({
  rosterCount: rosterCountValue,
  previousIndices: previousValue = null,
  rng = Math.random,
} = {}) {
  const rosterCount = normalizeRosterCount(rosterCountValue);
  if (rosterCount === null) {
    throw new RangeError("登録画像は5〜10枚にしてください。");
  }
  let previousIndices = null;
  if (previousValue !== null && previousValue !== undefined) {
    previousIndices = normalizeAiTextTrainingDrawIndices(
      previousValue,
      rosterCount,
    );
    if (!previousIndices) {
      throw new RangeError("前回DRAWの5枚を読み直してください。");
    }
  }
  if (typeof rng !== "function") {
    throw new TypeError("DRAW用の乱数生成器を確認してください。");
  }

  const allIndices = Array.from({ length: rosterCount }, (_, index) => index);
  if (rosterCount === AI_TEXT_TRAINING_ROSTER_MAX_COUNT && previousIndices) {
    const previousSet = new Set(previousIndices);
    return shuffled(
      allIndices.filter((index) => !previousSet.has(index)),
      rng,
    );
  }

  const drawn = shuffled(allIndices, rng).slice(0, AI_TEXT_TRAINING_DRAW_COUNT);
  if (!previousIndices) return drawn;

  if (rosterCount > AI_TEXT_TRAINING_DRAW_COUNT
      && sameIndexSet(drawn, previousIndices)) {
    const drawnSet = new Set(drawn);
    const replacements = allIndices.filter((index) => !drawnSet.has(index));
    const replaceAt = Math.floor(
      randomUnit(rng) * AI_TEXT_TRAINING_DRAW_COUNT,
    );
    const replacement = replacements[
      Math.floor(randomUnit(rng) * replacements.length)
    ];
    drawn[replaceAt] = replacement;
  }

  if (sameOrderedIndices(drawn, previousIndices)) {
    drawn.push(drawn.shift());
  }
  return drawn;
}
