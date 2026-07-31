"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeRetiredTrainingHistory,
  retiredTrainingHistoryHasActivity,
} = require("../retired-training-history");

test("retired Training 60 history keeps only achievement aggregate inputs", () => {
  assert.deepEqual(normalizeRetiredTrainingHistory({
    sessions: 4,
    completedSets: 5,
    completedSeconds: 300,
    hpSessions: 6,
    hpCompletedWorkouts: 7,
    hpCompletedSeconds: 420,
    hpWins: 99,
    unsafe: "discarded",
  }), {
    sessions: 4,
    completedSets: 5,
    completedSeconds: 300,
    hpSessions: 6,
    hpCompletedWorkouts: 7,
    hpCompletedSeconds: 420,
  });
});

test("retired Training 60 history rejects malformed and negative counters", () => {
  assert.deepEqual(normalizeRetiredTrainingHistory({
    sessions: -1,
    completedSets: "bad",
    completedSeconds: Number.MAX_SAFE_INTEGER + 1,
    hpSessions: null,
    hpCompletedWorkouts: 1.8,
    hpCompletedSeconds: 60,
  }), {
    sessions: 0,
    completedSets: 0,
    completedSeconds: 0,
    hpSessions: 0,
    hpCompletedWorkouts: 1,
    hpCompletedSeconds: 60,
  });
});

test("any historical Training 60 metric keeps a transfer target non-pristine", () => {
  assert.equal(retiredTrainingHistoryHasActivity(null), false);
  assert.equal(retiredTrainingHistoryHasActivity({ sessions: 0, hpWins: 0 }), false);
  assert.equal(retiredTrainingHistoryHasActivity({ sessions: 1 }), true);
  assert.equal(retiredTrainingHistoryHasActivity({ hpWins: 1 }), true);
  assert.equal(retiredTrainingHistoryHasActivity({ boostSeconds: 30 }), true);
});
