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
  // ウォレットの所有UIDへ再認証できるため、段階ロールアウトの対象外で常時強制します。
  accountTransfer: true,
  // 顔なじみ関係と再会permitは相手UIDを扱うため、段階公開前から常時強制します。
  soloFamiliarAction: true,
  // 通常版1on1のV2セッションとマッチ生成はサーバー専用境界のため、常時強制します。
  soloSessionAction: true,
  trainingSessionAction: true,
  // TURN認証情報の発行は課金可能な外部リソースのため、常時強制します。
  getP2pIceServers: true,
  // 接続診断は内部保存領域への書き込みとなるため、常時強制します。
  reportP2pConnectivity: true,
  reportMarketP2pConnectivity: true,
  reportFreeTableP2pConnectivity: true,
  // 新規公開の非同期フリマは旧クライアント移行を待つ必要がないため、初日から強制します。
  anjuPayFleaAction: true,
  // 貼り合い自由卓は公開ID・承認・ブロック・通報を扱う新規サーバー境界のため、初日から強制します。
  freeTableAction: true,
  // Xへ置く灯り札も、発行・取り消しと公開プレビューを別境界で常時保護します。
  freeTableInviteAction: true,
  freeTableInvitePreview: true,
  // トップ向け統計も生の卓情報を読まず、App Check済みの集計境界だけを公開します。
  freeTablePublicStats: true,
  // 鍛え合い60は非公開の継続記録とサーバー確定結果を扱う新規境界です。
  trainingAction: true,
  economyAction: reached("economy_enforced"),
  valueMarketQueue: reached("market_enforced"),
  valueMarketAction: reached("market_enforced"),
  valueMarketShop: reached("market_enforced"),
  valueMarketRankings: reached("rankings_enforced"),
});
const MARKET_APP_CHECK_MIGRATION = reached("market_migration");

module.exports = Object.freeze({
  APP_CHECK_ENFORCEMENT,
  APP_CHECK_ROLLOUT_STAGE,
  APP_CHECK_ROLLOUT_STAGES,
  MARKET_APP_CHECK_MIGRATION,
});
