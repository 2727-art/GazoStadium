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
  assert.match(index, /account\.js\?v=anju-pay-wallet-v1[^"]*pay-unit-v1/);
  assert.match(index, /online\.js\?v=[^"]*post-match-tip-v4[^"]*anju-pay-v1[^"]*pay-unit-v1/);
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
  assert.match(source, /formatAnjuPay\(period\.nominalAmount\)/);
});

test("patron fund and impact responses are normalized on initialize and upgrade", () => {
  const source = read("account.js");
  const initializeStart = source.indexOf("async function loadAccountData");
  const initializeEnd = source.indexOf("function renderAccountStatus", initializeStart);
  const initialize = source.slice(initializeStart, initializeEnd);
  const upgradeStart = source.indexOf("async function upgradePatron");
  const upgradeEnd = source.indexOf("async function votePatronPolicy", upgradeStart);
  const upgrade = source.slice(upgradeStart, upgradeEnd);

  assert.match(source, /patronFund:\s*normalizePatronFund\(null\)/);
  assert.match(source, /patronImpact:\s*normalizePatronImpact\(null\)/);
  assert.match(initialize, /action:\s*"initialize"[\s\S]*applyPatronEconomyResponse\(requestState,\s*response\.data\)/);
  assert.match(upgrade, /const requestState = state/);
  assert.match(upgrade, /action:\s*"patron_upgrade"[\s\S]*if \(!active \|\| state !== requestState\) return;[\s\S]*applyPatronEconomyResponse\(requestState,\s*response\.data\)/);
  assert.match(upgrade, /await loadAnjuPayHistory\(\{ force: true \}\);[\s\S]*if \(!active \|\| state !== requestState\) return;/);
  assert.match(upgrade, /if \(state === requestState\) \{[\s\S]*requestState\.busyAction = "";[\s\S]*if \(active\) render\(\)/);
  assert.match(source, /contributed:\s*patronMetric\(source\.contributed\)/);
  assert.match(source, /burned:\s*patronMetric\(source\.burned\)/);
  assert.match(source, /budget:\s*patronMetric\(source\.budget\)/);
  assert.match(source, /subsidyPaid:\s*patronMetric\(source\.subsidyPaid\)/);
  assert.match(source, /remaining:\s*patronMetric\(source\.remaining\)/);
  assert.match(source, /supportedDeals:\s*patronMetric\(source\.supportedDeals\)/);
  assert.match(source, /PATRON_POLICY_IDS\.has\(String\(source\.activePolicy/);
  assert.match(source, /recommendedShopCount:\s*Math\.min\(/);
  assert.match(source, /const recommendationLimit = patronMetric\(source\.recommendationLimit/);
});

test("patron page explains circulation, shows impact, and exposes an accessible policy vote", () => {
  const source = read("account.js");
  assert.match(source, /支援額の80%を消却、20%を循環基金へ/);
  assert.match(source, /基金は成立した商談の売り手手数料の半分/);
  assert.match(source, /あなたの市場Impact/);
  assert.match(source, /基金拠出合計/);
  assert.match(source, /あなたの基金拠出/);
  assert.match(source, /推薦中の商店/);
  assert.match(source, /label:\s*"出会いと常連"/);
  assert.match(source, /label:\s*"新しい出会い"/);
  assert.match(source, /label:\s*"常連の信頼"/);
  assert.match(source, /data-patron-policy="\$\{policy\.id\}" aria-pressed="\$\{selected\}"/);
  assert.match(source, /aria-busy="\$\{policyVoteBusy\}"/);
  assert.match(source, /class="patron-policy-status" role="status" aria-live="polite"/);
  assert.match(source, /SUPPORTER以上になると、今月の市場政策へ投票できます/);
});

test("patron policy voting uses an idempotent economy action and restores server state", () => {
  const source = read("account.js");
  const voteStart = source.indexOf("async function votePatronPolicy");
  const voteEnd = source.indexOf("async function createTransfer", voteStart);
  const vote = source.slice(voteStart, voteEnd);

  assert.match(vote, /PATRON_POLICY_OPTIONS\.find/);
  assert.match(vote, /state\.busyAction \|\| state\.patronFund\.viewerVote === policy\.id/);
  assert.match(vote, /requireCurrentAccount\(\{ google: true \}\)/);
  assert.match(vote, /action:\s*"patron_policy_vote"/);
  assert.match(vote, /policyId:\s*policy\.id/);
  assert.match(vote, /actionId:\s*newActionId\(\)/);
  assert.match(vote, /applyPatronEconomyResponse\(requestState,\s*response\.data\)/);
  assert.match(vote, /friendlyError\(error,\s*"今月の市場政策へ投票できませんでした。"\)/);
  assert.match(vote, /requestState\.busyAction = ""/);
  assert.match(source, /button\.addEventListener\("click", \(\) => votePatronPolicy\(button\.dataset\.patronPolicy\)\)/);
});
