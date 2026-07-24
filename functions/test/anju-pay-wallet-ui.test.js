const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("AnjuPay wallet loads paginated server history without exposing reserved balance", () => {
  const source = read("account.js");
  assert.match(source, /action:\s*"get_anju_pay_wallet"/);
  assert.match(source, /limit:\s*ANJU_PAY_HISTORY_PAGE_SIZE/);
  assert.match(source, /request\.cursor = requestState\.historyNextCursor/);
  assert.match(source, /response\.availableBalance \?\? response\.balance/);
  assert.match(source, /state\.historyHasMore = response\.hasMore === true/);
  assert.doesNotMatch(source, /reservedIncoming/);
});

test("wallet history renders only normalized classes and escaped server text", () => {
  const source = read("account.js");
  assert.match(source, /ANJU_PAY_CATEGORIES\.has\(categoryValue\) \? categoryValue : "other"/);
  assert.match(source, /ANJU_PAY_STATUSES\.has\(statusValue\) \? statusValue : "posted"/);
  assert.match(source, /<strong>\$\{escapeHtml\(historyLabel\(entry\)\)\}<\/strong>/);
  assert.match(source, /\$\{detail \? `<p>\$\{escapeHtml\(detail\)\}<\/p>` : ""\}/);
  assert.match(source, /replace\(\/\[&<>"'\]\/g/);
  assert.doesNotMatch(source, /\$\{entry\.(?:detail|label|labelKey)\}/);
});

test("local preview provides fixed history and does not call Firebase paths", () => {
  const source = read("account.js");
  const loaderStart = source.indexOf("async function loadAnjuPayHistory");
  const loaderEnd = source.indexOf("function currentSeasonKey", loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  assert.ok(loader.indexOf("if (useAccountPreview)") < loader.indexOf("economyActionCallable(request)"));
  assert.match(loader, /applyHistoryResponse\(previewHistory/);

  const online = read("online.js");
  assert.match(online, /screen === "shop" \|\| screen === "missions"/);
  assert.match(online, /ANJUPAY STORE PREVIEW/);
});

test("top-level economic entry points are branded without adding another utility button", () => {
  const app = read("app.js");
  const index = read("index.html");
  assert.match(app, /id="pointShopButton">AnjuPayストア</);
  assert.match(app, /id="accountButton">AnjuPayウォレット</);
  assert.equal((app.match(/id="pointShopButton"/g) || []).length, 1);
  assert.equal((app.match(/id="accountButton"/g) || []).length, 1);
  assert.match(index, /account\.js\?v=anju-pay-wallet-v1/);
  assert.match(index, /online\.js\?v=[^"]*post-match-tip-v3[^"]*anju-pay-v1/);
});

test("wallet explains its closed game economy and preserves safe handoff navigation", () => {
  const source = read("account.js");
  assert.match(source, /現金での購入・チャージ、換金、自由送金、ゲーム外での利用には対応せず、今後も追加しません/);
  assert.match(source, /記録開始より前の増減をさかのぼった完全な履歴はありません/);
  assert.match(source, /requestHome\(\);[\s\S]*window\.setTimeout/);
  assert.match(source, /data-anju-pay-destination="missions"/);
  assert.match(source, /data-anju-pay-destination="shop"/);
  assert.match(source, /data-anju-pay-destination="market"/);
  assert.match(source, /data-anju-pay-destination="patron"/);
});

test("wallet ignores stale requests, supersedes refreshes, and restores trigger focus", () => {
  const source = read("account.js");
  assert.match(source, /historyRequestId:\s*0/);
  assert.match(source, /state !== requestState \|\| requestState\.historyRequestId !== requestId/);
  assert.match(source, /historyLoading && !force/);
  assert.match(source, /loadAnjuPayHistory\(\{\s*force: true\s*\}\)/);
  assert.match(source, /loadAnjuPayHistory\(\{\s*append: false,\s*showLoading: true,\s*force: true,/);
  assert.match(source, /target\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /class="account-live-status" role="status" aria-live="polite"/);
  assert.match(source, /liveStatus\.textContent = "AnjuPay利用履歴を更新しました。"/);
  assert.doesNotMatch(source, /anju-pay-history-list"[^>]*aria-live/);
  assert.match(source, /const requestState = state;[\s\S]*const requestIsCurrent/);
});

test("market and reward history preserve transaction meaning and safe detail", () => {
  const source = read("account.js");
  assert.match(source, /!key\.includes\("market"\) && \(key\.includes\("purchase"\)/);
  assert.match(source, /key\.includes\("entry_fee_hold"\)/);
  assert.match(source, /key\.includes\("entry_fee_settlement"\)/);
  assert.match(source, /key\.includes\("entry_fee_compensation"\)/);
  assert.match(source, /key\.includes\("extension_incentive"\)/);
  assert.match(source, /key\.includes\("market_buy"\)[\s\S]*?role === "seller"/);
  assert.match(source, /dailyPlayClaims:[\s\S]*?slice\(0, 100\)/);
  assert.match(source, /period\.nominalAmount[\s\S]*?toLocaleString\("ja-JP"\)/);
});
