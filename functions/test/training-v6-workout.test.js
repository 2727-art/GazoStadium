"use strict";

const assert = require("node:assert/strict");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const moduleUrl = pathToFileURL(
  join(__dirname, "..", "..", "training-v6-workout.mjs"),
).href;

test("Training V6 workout progress follows the server time window", async () => {
  const { trainingV6WorkoutProgress } = await import(moduleUrl);
  assert.deepEqual(
    trainingV6WorkoutProgress({
      startedAt: 1_000,
      endsAt: 61_000,
      now: 31_000,
    }),
    {
      valid: true,
      elapsedMs: 30_000,
      remainingMs: 30_000,
      progress: 0.5,
      complete: false,
    },
  );
  assert.equal(trainingV6WorkoutProgress({
    startedAt: 1_000,
    endsAt: 61_000,
    now: 61_001,
  }).complete, true);
});

test("Training V6 workout progress rejects missing canonical timestamps", async () => {
  const { trainingV6WorkoutProgress } = await import(moduleUrl);
  assert.deepEqual(
    trainingV6WorkoutProgress({ startedAt: 0, endsAt: 0, now: 0 }),
    {
      valid: false,
      elapsedMs: 0,
      remainingMs: 60_000,
      progress: 0,
      complete: false,
    },
  );
});
