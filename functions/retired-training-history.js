"use strict";

const RETIRED_TRAINING_ACTIVITY_KEYS = Object.freeze([
  "sessions",
  "completedSets",
  "completedSeconds",
  "boostCompletedSets",
  "boostSeconds",
  "threeSetCompletions",
  "threeSetDays",
  "completeDays",
  "hpSessions",
  "hpWins",
  "hpLosses",
  "hpDraws",
  "hpNoContests",
  "hpRounds",
  "hpDamageTaken",
  "hpScoreReceived",
  "hpHitsTaken",
  "hpPerfect10sReceived",
  "hpCritical9sReceived",
  "hpCompletedWorkouts",
  "hpCompletedSeconds",
  "hpOverkillDealt",
]);

function retiredTrainingCount(value) {
  const count = Math.floor(Number(value));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

// 鍛え合い60のゲーム進行は退役済み。ここでは解除済み実績と
// アカウント履歴を壊さないために必要な集計値だけを読み取る。
function normalizeRetiredTrainingHistory(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    sessions: retiredTrainingCount(source.sessions),
    completedSets: retiredTrainingCount(source.completedSets),
    completedSeconds: retiredTrainingCount(source.completedSeconds),
    hpSessions: retiredTrainingCount(source.hpSessions),
    hpCompletedWorkouts: retiredTrainingCount(source.hpCompletedWorkouts),
    hpCompletedSeconds: retiredTrainingCount(source.hpCompletedSeconds),
  };
}

function retiredTrainingHistoryHasActivity(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return RETIRED_TRAINING_ACTIVITY_KEYS.some(
    (key) => retiredTrainingCount(source[key]) > 0,
  );
}

module.exports = Object.freeze({
  RETIRED_TRAINING_ACTIVITY_KEYS,
  normalizeRetiredTrainingHistory,
  retiredTrainingHistoryHasActivity,
});
