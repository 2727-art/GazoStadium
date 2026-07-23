"use strict";

// 変更するのはこの値だけです。関数間で不整合な強制設定を作らない段階定義です。
const APP_CHECK_ROLLOUT_STAGE = "monitor";
const APP_CHECK_ROLLOUT_STAGES = Object.freeze([
  "monitor",
  "rankings_enforced",
  "market_migration",
  "market_enforced",
  "economy_enforced",
]);

const rolloutIndex = APP_CHECK_ROLLOUT_STAGES.indexOf(APP_CHECK_ROLLOUT_STAGE);
if (rolloutIndex < 0) {
  throw new Error(`Unknown App Check rollout stage: ${APP_CHECK_ROLLOUT_STAGE}`);
}

const reached = (stage) => rolloutIndex >= APP_CHECK_ROLLOUT_STAGES.indexOf(stage);
const APP_CHECK_ENFORCEMENT = Object.freeze({
  economyAction: reached("economy_enforced"),
  valueMarketQueue: reached("market_enforced"),
  valueMarketAction: reached("market_enforced"),
  valueMarketRankings: reached("rankings_enforced"),
});
const MARKET_APP_CHECK_MIGRATION = reached("market_migration");

module.exports = Object.freeze({
  APP_CHECK_ENFORCEMENT,
  APP_CHECK_ROLLOUT_STAGE,
  APP_CHECK_ROLLOUT_STAGES,
  MARKET_APP_CHECK_MIGRATION,
});
