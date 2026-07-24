const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("VALUE MARKET presents the balance and held amounts as game-only AnjuPay", () => {
  const market = read("market.js");

  assert.match(market, /ANJUPAY BALANCE/);
  assert.match(market, /貼り合いスタジアム内専用ウォレット/);
  assert.match(market, /着手料[\s\S]*?AnjuPay残高[\s\S]*?保留/);
  assert.match(market, /内金分のAnjuPayを残高から保留/);
  assert.match(market, /買い手のAnjuPay残高へ返還/);
  assert.match(market, /\.replaceAll\("ポイント", "AnjuPay"\)/);
  assert.doesNotMatch(market, /MARKET WALLET|POINT AUTHORITY|ポイントショップ|返金/);
});

test("post-match tips identify the transferred PT as AnjuPay", () => {
  const tips = read("post-match-tip.js");

  assert.match(tips, /AnjuPay残高/);
  assert.match(tips, /<legend>AnjuPay<\/legend>/);
  assert.match(tips, /自分のAnjuPayを一度だけ贈れます/);
  assert.match(tips, /PTのAnjuPayを差し入れ/);
  assert.doesNotMatch(tips, /自分のポイント|<legend>ポイント<\/legend>/);
});

test("all match modes use the same post-match tip cache revision", () => {
  for (const file of ["online.js", "strategy.js", "team.js", "royale.js"]) {
    assert.match(
      read(file),
      /post-match-tip\.js\?v=post-match-tip-v3/,
      `${file} must load the AnjuPay tip copy`,
    );
  }
});

test("mission and shop balance readouts identify PT as AnjuPay", () => {
  const online = read("online.js");
  assert.match(online, /point-balance-inline">AnjuPay ◆/);
  assert.match(online, /gameover-missions-head[\s\S]*?<strong>AnjuPay ◆/);
  assert.doesNotMatch(online, /point-balance-inline">◆/);
});

test("README fixes AnjuPay scope without renaming non-currency points", () => {
  const readme = read("README.md");

  assert.match(readme, /TRPG世界観とゲーム内経済圏/);
  assert.match(readme, /現金チャージ、換金、プレイヤー間の自由送金、ゲーム外での利用には対応せず、将来も追加しません/);
  assert.match(readme, /「AnjuPay開始残高」を1件記録/);
  assert.match(readme, /PTの数値、商品価格、報酬、購入済み状態[\s\S]*?仕様は変わりません/);
  assert.match(readme, /旧インスタンスのドレイン時間として30秒を超えて待ち/);
  assert.match(readme, /systemConfig\/anjuPayLedger[\s\S]*?activatedAt: 0[\s\S]*?enabled: true[\s\S]*?activatedAt/);
  assert.match(readme, /ANJU_PAY_LEDGER_REQUIRED=false[\s\S]*?ANJU_PAY_LEDGER_REQUIRED=true/);
  assert.match(readme, /fail-closed/);
  assert.match(readme, /旧Functions revisionや互換パラメータのrevisionへロールバックしない/);

  assert.match(readme, /ランキングポイント/);
  assert.match(readme, /戦績ポイント/);
  assert.match(readme, /合計ポイント、モード別ポイント/);
  assert.match(read("royale.js"), /支持ポイント/);
});
