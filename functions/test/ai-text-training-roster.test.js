"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const modulePath = path.join(root, "ai-text-training-roster.mjs");
const moduleUrl = pathToFileURL(modulePath).href;

function sequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

test("roster accepts five through ten registrations and always draws five unique indices", async () => {
  const roster = await import(moduleUrl);
  assert.equal(roster.AI_TEXT_TRAINING_DRAW_COUNT, 5);
  assert.equal(roster.AI_TEXT_TRAINING_ROSTER_MIN_COUNT, 5);
  assert.equal(roster.AI_TEXT_TRAINING_ROSTER_MAX_COUNT, 10);
  assert.equal(roster.isAiTextTrainingRosterCount(4), false);
  assert.equal(roster.isAiTextTrainingRosterCount(5), true);
  assert.equal(roster.isAiTextTrainingRosterCount(10), true);
  assert.equal(roster.isAiTextTrainingRosterCount(11), false);
  assert.equal(roster.isAiTextTrainingRosterCount(5.5), false);

  for (let rosterCount = 5; rosterCount <= 10; rosterCount += 1) {
    const indices = roster.drawAiTextTrainingRosterIndices({
      rosterCount,
      rng: sequenceRng([0.91, 0.12, 0.73, 0.36, 0.55, 0.04, 0.82, 0.27, 0.64]),
    });
    assert.equal(indices.length, 5);
    assert.equal(new Set(indices).size, 5);
    assert.ok(indices.every((index) => index >= 0 && index < rosterCount));
  }
  assert.throws(
    () => roster.drawAiTextTrainingRosterIndices({ rosterCount: 4 }),
    /5〜10枚/,
  );
  assert.throws(
    () => roster.drawAiTextTrainingRosterIndices({ rosterCount: 11 }),
    /5〜10枚/,
  );
});

test("an injected RNG makes DRAW order deterministic", async () => {
  const roster = await import(moduleUrl);
  const randomValues = [0.04, 0.87, 0.22, 0.69, 0.41, 0.95, 0.13, 0.58, 0.31];
  const first = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 9,
    rng: sequenceRng(randomValues),
  });
  const second = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 9,
    rng: sequenceRng(randomValues),
  });
  assert.deepEqual(first, second);
  assert.throws(
    () => roster.drawAiTextTrainingRosterIndices({
      rosterCount: 5,
      rng: "not-a-function",
    }),
    /乱数生成器/,
  );
});

test("a ten-card redraw returns the previous five-card complement in RNG order", async () => {
  const roster = await import(moduleUrl);
  const previousIndices = [7, 2, 9, 0, 4];
  const next = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 10,
    previousIndices,
    rng: () => 0,
  });
  assert.deepEqual(next, [3, 5, 6, 8, 1]);
  assert.deepEqual([...next].sort((a, b) => a - b), [1, 3, 5, 6, 8]);
  assert.ok(next.every((index) => !previousIndices.includes(index)));
  assert.deepEqual(previousIndices, [7, 2, 9, 0, 4]);
});

test("redraw avoids the previous complete selection whenever another set exists", async () => {
  const roster = await import(moduleUrl);
  const previousSix = [5, 4, 3, 2, 1];
  const redrawnSix = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 6,
    previousIndices: previousSix,
    rng: () => 0,
  });
  assert.notDeepEqual(
    [...redrawnSix].sort((a, b) => a - b),
    [...previousSix].sort((a, b) => a - b),
  );
  assert.equal(new Set(redrawnSix).size, 5);

  const previousFive = [1, 2, 3, 4, 0];
  const redrawnFive = roster.drawAiTextTrainingRosterIndices({
    rosterCount: 5,
    previousIndices: previousFive,
    rng: () => 0,
  });
  assert.notDeepEqual(redrawnFive, previousFive);
  assert.deepEqual(
    [...redrawnFive].sort((a, b) => a - b),
    [...previousFive].sort((a, b) => a - b),
  );
});

test("saved DRAW indices restore only as five distinct in-range integers in order", async () => {
  const roster = await import(moduleUrl);
  const saved = [4, 1, 7, 0, 6];
  const restored = roster.normalizeAiTextTrainingDrawIndices(saved, 8);
  assert.deepEqual(restored, saved);
  assert.notEqual(restored, saved);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices([0, 1, 2, 3], 8), null);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices([0, 1, 2, 3, 3], 8), null);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices([0, 1, 2, 3, 8], 8), null);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices([0, 1, 2, 3, 4.5], 8), null);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices(saved, 4), null);
  assert.equal(roster.normalizeAiTextTrainingDrawIndices(saved, 11), null);
  assert.throws(
    () => roster.drawAiTextTrainingRosterIndices({
      rosterCount: 8,
      previousIndices: [0, 1, 2, 3, 8],
    }),
    /前回DRAW/,
  );
});

test("the roster core depends only on counts, indices, and injected randomness", () => {
  const source = fs.readFileSync(modulePath, "utf8");
  assert.doesNotMatch(
    source,
    /firebase|firestore|localStorage|indexedDB|FileReader|Blob|objectURL/iu,
  );
  assert.doesNotMatch(source, /\b(?:image|bpm|script|dialogue|message)\b/iu);
  assert.match(source, /rng = Math\.random/);
  assert.match(source, /Array\.from\(\{ length: rosterCount \}/);
});
