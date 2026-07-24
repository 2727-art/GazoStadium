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
  assert.match(market, /formatAnjuPay\(settlement\.grossAmount\)/);
  assert.match(market, /<small>\$\{ANJU_PAY_UNIT\}<\/small>/);
  assert.match(market, /replace\(\/\(\\d\[\\d,\]\*\)\\s\*PT/);
  assert.match(market, /\.replaceAll\("ポイント残高", "AnjuPay残高"\)/);
  assert.doesNotMatch(market, /\.replaceAll\("ポイント", "AnjuPay"\)/);
  assert.doesNotMatch(market, /[0-9}] ?PT|<small>PT|MARKET WALLET|POINT AUTHORITY|ポイントショップ|返金/);
});

test("post-match tips present transferred AnjuPay in Pay", () => {
  const tips = read("post-match-tip.js");

  assert.match(tips, /AnjuPay残高/);
  assert.match(tips, /<legend>AnjuPay<\/legend>/);
  assert.match(tips, /自分のAnjuPayを一度だけ贈れます/);
  assert.match(tips, /formatAnjuPay\(value\.amount\)/);
  assert.match(tips, /\.replaceAll\("ポイント残高", "AnjuPay残高"\)/);
  assert.doesNotMatch(tips, /\.replaceAll\("ポイント", "AnjuPay"\)/);
  assert.doesNotMatch(tips, /[0-9}] ?PT|<small>PT|PTのAnjuPay|自分のポイント|<legend>ポイント<\/legend>/);
});

test("all match modes use the same post-match tip cache revision", () => {
  for (const file of ["online.js", "strategy.js", "team.js", "royale.js"]) {
    assert.match(
      read(file),
      /post-match-tip\.js\?v=post-match-tip-v4/,
      `${file} must load the AnjuPay tip copy`,
    );
  }
});

test("all currency surfaces share one Pay formatter and expose no legacy PT unit", () => {
  for (const file of ["account.js", "market.js", "online.js", "post-match-tip.js"]) {
    assert.match(
      read(file),
      /anju-pay-format\.mjs\?v=anju-pay-format-v1/,
      `${file} must import the shared Pay formatter`,
    );
  }
  for (const file of ["account.js", "app.js", "market.js", "online.js", "post-match-tip.js", "royale.js"]) {
    assert.doesNotMatch(
      read(file),
      /[0-9}] ?PT|<small>PT|PERIOD PT|[0-9]+pt|期間ポイント|戦績ポイント|支持ポイント|\bPOINTS\b/,
      `${file} must not expose the legacy point vocabulary`,
    );
  }
});

test("mission and shop balance readouts use Pay", () => {
  const online = read("online.js");
  const app = read("app.js");
  assert.match(online, /point-balance-inline">AnjuPay ◆/);
  assert.match(online, /gameover-missions-head[\s\S]*?<strong>AnjuPay ◆/);
  assert.match(online, /formatAnjuPay\(mission\.reward/);
  assert.match(online, /<small>\$\{ANJU_PAY_UNIT\}<\/small>/);
  assert.match(app, /AnjuPayの単位を「Pay」に統一しました。残高・価格・仕様は変わりません。/);
  assert.match(app, /hariai-anju-pay-unit-notice-v1/);
  assert.doesNotMatch(online, /point-balance-inline">◆/);
  assert.doesNotMatch(online, /[0-9}] ?PT|<small>PT/);
});

test("Functions currency errors use Pay without reintroducing PT", () => {
  const functions = read("functions/index.js");

  assert.match(functions, /買い手は着手料\$\{MARKET_ENTRY_FEE\} Payと購入用\$\{MARKET_MIN_PRICE\} Payが必要です/);
  assert.match(functions, /延長内金は5 Pay・10 Pay・20 Payから選択してください/);
  assert.doesNotMatch(functions, /[0-9}] ?PT\b/);
});

test("README separates Pay from non-currency scores", () => {
  const readme = read("README.md");

  assert.match(readme, /TRPG世界観とゲーム内経済圏/);
  assert.match(readme, /現金チャージ、換金、プレイヤー間の自由送金、ゲーム外での利用には対応せず、将来も追加しません/);
  assert.match(readme, /「AnjuPay開始残高」を1件記録/);
  assert.match(readme, /利用単位は`Pay`/);
  assert.match(readme, /残高の数値、商品価格、報酬、購入済み状態[\s\S]*?仕様は変わりません/);
  assert.match(readme, /旧インスタンスのドレイン時間として30秒を超えて待ち/);
  assert.match(readme, /systemConfig\/anjuPayLedger[\s\S]*?activatedAt: 0[\s\S]*?enabled: true[\s\S]*?activatedAt/);
  assert.match(readme, /ANJU_PAY_LEDGER_REQUIRED=false[\s\S]*?ANJU_PAY_LEDGER_REQUIRED=true/);
  assert.match(readme, /fail-closed/);
  assert.match(readme, /旧Functions revisionや互換パラメータのrevisionへロールバックしない/);

  assert.match(readme, /ランキングスコア/);
  assert.match(readme, /戦績スコア/);
  assert.match(readme, /合計スコア、モード別スコア/);
  assert.match(read("app.js"), /PERIOD SCORE/);
  assert.match(read("royale.js"), /支持値/);
  assert.doesNotMatch(readme, /[0-9,]+ ?PT|\bPT\b/);
});
