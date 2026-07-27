const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const browser = fs.readFileSync(path.join(root, "market.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const marketStyles = fs.readFileSync(path.join(root, "market.css"), "utf8");

test("favorite targeting aligns and validates the buyer budget", () => {
  assert.match(browser, /function marketFavoritePreviousPrice\(/);
  assert.match(browser, /function alignBudgetToMarketFavorite\(/);
  assert.match(
    browser,
    /state\.maxBudget\s*=\s*requiredBudget/,
    "an affordable regular-shop selection should raise the purchase cap",
  );
  assert.match(
    browser,
    /alignBudgetToMarketFavorite\(selectedFavorite,\s*\{\s*announce:\s*true\s*\}\)/,
    "selecting a regular shop should align its budget immediately",
  );
  assert.match(
    browser,
    /const budgetAlignment = alignBudgetToMarketFavorite\(selectedFavorite\);[\s\S]*?if \(!budgetAlignment\.ok\) \{[\s\S]*?return;/,
    "queue join should reject a stale or unaffordable favorite budget",
  );
  assert.match(browser, /const joinedMaxBudget = state\.maxBudget;/);
  assert.match(browser, /maxBudget:\s*joinedMaxBudget/);
});

test("landing opens the existing market rankings after authentication", () => {
  assert.match(app, /id="valueMarketRankingButton"[^>]*>[\s\S]*?推し値市場ランキング<\/button>/);
  assert.match(
    app,
    /#valueMarketRankingButton"\)\?\.addEventListener\("click", startValueMarketRankings\)/,
  );
  assert.match(app, /let pendingValueMarketDestination = "";/);
  assert.match(app, /let valueMarketReadyListenerPending = false;/);
  assert.match(app, /function startValueMarket\(\) \{\s*startValueMarketDestination\("setup"\);/);
  assert.match(app, /function startValueMarketRankings\(\) \{\s*startValueMarketDestination\("rankings"\);/);
  assert.match(
    app,
    /function startValueMarketDestination\(destination\)[\s\S]*?pendingValueMarketDestination = normalizedDestination;[\s\S]*?if \(valueMarketReadyListenerPending\) return;[\s\S]*?requestedDestination === "rankings" \? "openRankingsFromLanding" : "start"/,
    "the latest market destination should win while the module is loading",
  );
  assert.equal(
    (app.match(/window\.addEventListener\("hariai-market-ready"/g) || []).length,
    1,
    "market setup and rankings must share one delayed-ready listener",
  );
  assert.match(
    app,
    /control\.matches\("#valueMarketButton, #valueMarketRankingButton"\)[\s\S]*?pendingValueMarketDestination = "";/,
    "choosing another landing action should cancel a delayed market navigation",
  );
  assert.match(
    browser,
    /function openRankingsFromLanding\(\) \{\s*return start\(\{ initialScreen: "rankings" \}\);\s*\}/,
  );
  assert.match(
    browser,
    /async function ensureAuthenticated\([\s\S]*?if \(openLandingRankings\) \{\s*await openRankings\("landing"\);/,
    "the rankings callable must wait until authentication and economy initialization finish",
  );
  const authenticationStart = browser.indexOf("async function ensureAuthenticated");
  const authenticationEnd = browser.indexOf(
    "async function loadMarketShop",
    authenticationStart,
  );
  assert.ok(authenticationStart >= 0 && authenticationEnd > authenticationStart);
  const authenticationBody = browser.slice(authenticationStart, authenticationEnd);
  assert.ok(
    authenticationBody.lastIndexOf('await openRankings("landing")')
      > authenticationBody.indexOf('await economyActionCallable({ action: "initialize" })'),
    "the live ranking request must run after the authenticated economy initialization",
  );
  assert.match(
    browser,
    /state\.rankingReturnScreen === "landing" \? "タイトルへ戻る"/,
  );
  assert.match(browser, /window\.HariaiMarket = \{[\s\S]*?openRankingsFromLanding,/);
  assert.match(marketStyles, /\.button\.hero-market-ranking-button\s*\{/);
});

test("ranking navigation returns to its landing or terminal-room source", () => {
  assert.match(browser, /rankingReturnScreen:\s*"setup"/);
  assert.match(browser, /openRankings\("room"\)/);
  assert.match(
    browser,
    /state\.rankingReturnScreen = returnScreen === "landing"[\s\S]*?\? "landing"[\s\S]*?: returnScreen === "room" && state\.room \? "room" : "setup"/,
  );
  assert.match(
    browser,
    /function returnFromRankings\(\) \{\s*if \(state\.rankingReturnScreen === "landing"\) \{\s*returnHome\(\);\s*return;\s*\}[\s\S]*?state\.screen = state\.rankingReturnScreen === "room" && state\.room \? "room" : "setup";/,
  );
  const returnFromRankingsBody = browser.match(
    /function returnFromRankings\(\) \{([\s\S]*?)\n\}/,
  )?.[1] || "";
  assert.doesNotMatch(
    returnFromRankingsBody,
    /resetForReplay\(/,
    "the ranking back button must not discard unsent relationship feedback",
  );
});

test("queue join is locked and snapshots its role and target", () => {
  assert.match(
    browser,
    /if \(!state\.authReady \|\| state\.busy \|\| state\.shopBusy \|\| state\.queueJoinPending\) return;/,
  );
  assert.match(
    browser,
    /data-market-role="seller"[\s\S]*?\$\{locked \? "disabled" : ""\}/,
  );
  assert.match(
    browser,
    /if \(state\.busy \|\| state\.shopBusy \|\| state\.queueJoinPending\) return;\s*state\.role = button\.dataset\.marketRole;/,
  );
  assert.match(browser, /const joinedRole = state\.role;/);
  assert.match(browser, /const joinedFavoritePublicSellerId =/);
  assert.match(browser, /const joinedPreferredPublicSellerId =/);
  assert.match(browser, /role:\s*joinedRole/);
  assert.match(browser, /favoritePublicSellerId:\s*joinedFavoritePublicSellerId/);
  assert.match(browser, /preferredPublicSellerId:\s*joinedPreferredPublicSellerId/);
});

test("stale queue responses cannot rewind a newer room or queue attempt", () => {
  assert.match(browser, /queueAttemptGeneration:\s*0/);
  assert.match(browser, /queueHeartbeatPending:\s*false/);
  assert.match(browser, /const queueAttemptGeneration = beginQueueAttempt\(\);/);
  assert.match(
    browser,
    /if \(!isCurrentQueueAttempt\(generation, queueAttemptGeneration\) \|\| state\.roomId\) return;/,
  );
  assert.match(
    browser,
    /\["canceled", "missing", "superseded"\]\.includes/,
  );
  assert.match(
    browser,
    /state\.screen !== "waiting"\s*\|\| state\.queueHeartbeatPending/,
  );
  assert.match(
    browser,
    /state\.roomId === roomId && state\.roomUnsubscribe[\s\S]*?state\.screen = "room"/,
  );
});

test("replay preserves the negotiated buyer and seller settings", () => {
  assert.match(browser, /const pitchStyle = state\.pitchStyle;/);
  assert.match(browser, /const maxBudget = state\.maxBudget;/);
  assert.match(browser, /askingPrice,\s*pitchStyle,\s*maxBudget,/);
  assert.match(browser, /normalizeBuyerBudget\(\);/);
});

test("relationship feedback drafts survive unrelated renders", () => {
  assert.match(
    browser,
    /input\[name="marketImpressionTag"\][\s\S]*?state\.relationshipFeedback\.impressionTag = normalizeShopOptionId\(input\.value\)/,
  );
  assert.match(
    browser,
    /#marketRelationshipFavorite[\s\S]*?state\.relationshipFeedback\.favorite = event\.currentTarget\.checked === true/,
  );
  assert.match(browser, /favoritePersisted:\s*favorite === true/);
  assert.match(
    browser,
    /favoriteBeforeBlock = state\.relationshipFeedback\.favoritePersisted/,
    "blocking must restore only a previously persisted favorite, not an unsaved checkbox draft",
  );
});

test("new sales invalidate the certificate collection cache", () => {
  const invalidations = browser.match(/state\.certificateStatus = "idle";/g) || [];
  assert.ok(invalidations.length >= 3, "preview buy, live buy, and sold snapshots should invalidate certificates");
  assert.match(
    browser,
    /if \(previousStatus !== "sold"\) state\.certificateStatus = "idle";/,
  );
});

test("seller setup exposes the sales mode and explains its price before queueing", () => {
  const setupStart = browser.indexOf("function renderSetup");
  const setupEnd = browser.indexOf("function renderWaiting", setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  const setup = browser.slice(setupStart, setupEnd);

  assert.match(setup, /name="marketSellerSalesMode" value="normal"[\s\S]*?通常営業/);
  assert.match(
    setup,
    /name="marketSellerSalesMode" value="oshijo"[\s\S]*?推し嬢モード（商談後に自由請求）/,
  );
  assert.match(
    setup,
    /id="marketSellerModeStatus"[^>]*role="status" aria-live="polite"/,
  );
  assert.match(setup, /推し嬢モード ON/);
  assert.match(setup, /推し嬢モード OFF／通常営業/);
  assert.match(setup, /自由請求を使うには、上の推し嬢モードを選んで保存してください/);
  assert.ok(
    setup.indexOf('id="marketSellerModeStatus"')
      < setup.indexOf("market-join-button"),
    "the saved mode status must appear before queue participation",
  );
  assert.match(setup, /\$\{sellerOshijoMode \? "マッチング基準額" : "販売価格"\}/);
  assert.match(
    setup,
    /id="marketAskingPrice" aria-describedby="marketAskingPriceHelp marketSetupFeeBreakdown"/,
  );
  assert.match(setup, /id="marketAskingPriceHelp"[\s\S]*?マッチング上限[\s\S]*?自由請求額は営業後に決めます/);
  assert.match(setup, /通常営業では、この金額が購入価格になります/);
  assert.match(setup, /<span>マッチング上限<\/span>/);
  assert.match(setup, /推し嬢モードの自由請求額を制限する金額ではありません/);
  assert.match(
    browser,
    /renderMarketShopOptionChecks\("serviceStyles"[\s\S]*?excludeIds: \[OSHIJO_SERVICE_STYLE_ID\]/,
    "oshijo must not remain buried as a duplicate contact-style checkbox",
  );
  assert.match(
    browser,
    /input\[name="marketSellerSalesMode"\][\s\S]*?state\.shop\.salesMode = selectedSalesMode/,
    "the visible sales mode must update the dedicated persisted field",
  );
  assert.match(
    browser,
    /function readMarketShopForm\(\)[\s\S]*?salesMode: document\.querySelector\('input\[name="marketSellerSalesMode"\]:checked'\)/,
  );
  assert.match(
    browser,
    /const selectedServiceStyles = \[[\s\S]*?marketShopServiceStyle[\s\S]*?serviceStyles: selectedServiceStyles,\s*regularServiceStyles: selectedServiceStyles,/,
    "the current form selection must override any older v2 style snapshot",
  );
});

test("unsaved shop changes stay visible and cannot enter the seller queue", () => {
  assert.match(browser, /shopErrorMessage:\s*""/);
  assert.match(browser, /shopDirty:\s*false/);
  assert.match(
    browser,
    /function markMarketShopDirty\(\) \{[\s\S]*?state\.shopDirty = true;/,
  );
  assert.match(
    browser,
    /function applyMarketShopResponse\(value\) \{[\s\S]*?state\.shopDirty = false;/,
  );
  assert.match(browser, /state\.shopStatus = "save-error";/);
  assert.match(browser, /<strong>未保存です。<\/strong>/);
  assert.match(
    browser,
    /joinedRole === "seller" && state\.shopStatus !== "ready"/,
  );
  assert.match(browser, /推し値商店の変更が未保存です。保存してから待機してください。/);
  assert.match(browser, /店主カードと販売モードを確認できません。再読み込みしてから待機してください。/);
  assert.match(browser, /販売モードを確認できません/);
  assert.match(browser, /data-market-reload-shop/);
  assert.match(
    browser,
    /function renderMarketShopOptionChecks\([\s\S]*?state\.shopStatus === "error"/,
    "failed shop loads must lock every shop checkbox as well as queueing",
  );
  assert.match(
    browser,
    /seller && \(!state\.image \|\| state\.shopStatus !== "ready"\)/,
    "seller queue UI must remain blocked until the server shop is confirmed",
  );
  assert.match(
    browser,
    /state\.shopStatus = "ready";\s*state\.shopErrorMessage = "";\s*state\.shopDirty = false;/,
    "only a successful save should clear the dirty flag",
  );
  for (const inputName of [
    "marketShopName",
    "marketShopTagline",
    "marketShopSpecialty",
    "marketShopServiceStyle",
    "marketShopTheme",
    "marketShopSeal",
    "marketShopTitle",
    "marketShopCharm",
    "marketShopRepeatWelcome",
  ]) {
    const inputPosition = browser.indexOf(inputName, browser.indexOf("function bindEvents"));
    assert.ok(inputPosition >= 0, `${inputName} edit binding should exist`);
    assert.ok(
      browser.indexOf("markMarketShopDirty()", inputPosition) > inputPosition,
      `${inputName} edits should mark the shop dirty`,
    );
  }
});

test("sales-mode keyboard focus stays on the selected radio after rerender", () => {
  assert.match(
    browser,
    /const selectedSalesMode = input\.value === OSHIJO_CLOSING_MODE[\s\S]*?render\(\);[\s\S]*?input\[name="marketSellerSalesMode"\]\[value="\$\{selectedSalesMode\}"\]/,
  );
  assert.doesNotMatch(
    browser,
    /input\[name="marketSellerSalesMode"\][\s\S]{0,800}?#marketSaveSalesModeButton"\)\?\.focus/,
  );
});

test("new sales-mode UI fails closed when connected to legacy Functions", () => {
  assert.match(browser, /shopSalesModeContractReady:\s*false/);
  assert.match(
    browser,
    /const salesModeCatalog = Array\.isArray\(data\.catalog\?\.salesModes\)[\s\S]*?state\.shopSalesModeContractReady = salesModeCatalog\.includes\("normal"\)[\s\S]*?includes\(savedSalesMode\)/,
  );
  assert.match(
    browser,
    /async function saveMarketShop\(event\)[\s\S]*?if \(!state\.shopSalesModeContractReady\)[\s\S]*?ページを再読み込みしてから保存してください/,
  );
  assert.match(browser, /販売モード設定の更新を確認できません/);
  assert.match(
    browser,
    /const modeControlsLocked = locked[\s\S]*?\|\| sellerShopContractUnavailable/,
  );
  assert.match(
    browser,
    /const shopSalesModeContractReady = state\.shopSalesModeContractReady;[\s\S]*?shopSalesModeContractReady,/,
    "replay must preserve a confirmed server contract",
  );
});

test("patron fund state is normalized from economy and shop responses", () => {
  for (const field of [
    "seasonKey",
    "contributed",
    "burned",
    "budget",
    "subsidyPaid",
    "remaining",
    "supportedDeals",
    "activePolicy",
    "votes",
    "viewerVote",
  ]) {
    assert.match(browser, new RegExp(`${field}[,:]`), `patronFund.${field} should be normalized`);
  }
  assert.match(browser, /patronFund:\s*normalizePatronFund\(null\)/);
  assert.match(browser, /patronImpact:\s*normalizePatronImpact\(null\)/);
  assert.match(browser, /recommendations:\s*\[\]/);
  assert.match(browser, /recommendedShelf:\s*\[\]/);
  assert.match(
    browser,
    /state\.patron = normalizeMarketPatron\(response\.data\?\.patron\);\s*applyMarketPatronExperience\(response\.data\);/,
    "economy initialization should hydrate the patron-fund contract",
  );
  assert.match(
    browser,
    /function applyMarketShopResponse\(value\) \{[\s\S]*?applyMarketPatronExperience\(data\);/,
    "shop responses should refresh fund impact and discovery data",
  );
});

test("patron fund subsidies produce correct seller proceeds without purchase-hoarding copy", () => {
  assert.match(browser, /patronFundSubsidy/);
  assert.match(browser, /function maximumPatronFundSubsidy\(feeValue\)/);
  assert.match(browser, /Math\.floor\(fee \/ 2\)/);
  assert.match(browser, /PATRON_FUND_MAX_SUBSIDY_PER_SALE/);
  assert.match(browser, /fee - 1/);
  assert.match(
    browser,
    /grossAmount - feeAmount \+ patronFundSubsidy/,
    "seller proceeds should add the server-authorized subsidy back after the fee",
  );
  assert.match(browser, /パトロン基金補填/);
  assert.match(browser, /PATRON BACKED/);
  assert.match(browser, /function purchaseBalanceCopy\(purchasePrice\)/);
  assert.match(browser, /購入後のAnjuPay残高は/);
  assert.match(
    browser,
    /grossAmount: 100, feeAmount: 5, patronFundSubsidy: 2, sellerProceeds: 97/,
    "the local preview should demonstrate half-fee support rather than a full fee refund",
  );
  assert.doesNotMatch(browser, /function patronOpportunityCopy\(/);
  assert.doesNotMatch(browser, /次の\$\{next\.label\}[\s\S]*?残せます/);
  assert.match(
    browser,
    /settlement\.patronFundSubsidy > 0[\s\S]*?renderPatronBackedBadge/,
    "terminal results should show patron backing only when a subsidy exists",
  );
  assert.match(
    browser,
    /renderPatronBackedBadge\(settlement\.patronFundSubsidy,\s*\{\s*compact:\s*true\s*\}\)/,
    "certificates should carry the same conditional backing mark",
  );
});

test("regular-book and certificate shops can be recommended without allocating Pay", () => {
  assert.match(browser, /recommendationBusySellerId:\s*""/);
  assert.match(browser, /data-market-recommend-shop=/);
  assert.match(browser, /renderMarketRecommendationAction\(favorite\.publicSellerId\)/);
  assert.match(
    browser,
    /renderMarketRecommendationAction\(normalizeMarketShop\(certificate\?\.sellerShop\)\.publicSellerId\)/,
  );
  assert.match(browser, /action:\s*requestedRecommendation \? "recommend_shop" : "remove_recommendation"/);
  assert.match(browser, /publicSellerId:\s*sellerId/);
  assert.match(browser, /推薦はPayの配分ではありません/);
  assert.match(browser, /推薦によって基金のPay配分やランキングは変わりません/);
  assert.match(browser, /applyMarketPatronExperience\(responseData\)/);
});

test("recommended shelf offers an accessible soft matchmaking preference", () => {
  assert.match(browser, /const MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS = 20_000;/);
  assert.match(browser, /preferredRecommendedSellerId:\s*""/);
  assert.match(browser, /data-market-prefer-recommended=/);
  assert.match(browser, /aria-pressed="\$\{selected\}"/);
  assert.match(browser, /この商店を優先して探す/);
  assert.match(browser, /見つからなければ通常の商店探しへ広がります/);
  assert.match(
    browser,
    /state\.preferredRecommendedSellerId = removing \? "" : sellerId;\s*state\.matchMode = "discover";/,
    "choosing a recommendation should remain discovery and must not become favorite-only matching",
  );
  assert.match(
    browser,
    /最初の\$\{MARKET_RECOMMENDED_PREFERENCE_EXPAND_MS \/ 1000\}秒だけ優先し、その後は通常検索/,
  );
  assert.match(browser, /joinButton\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(browser, /function focusRecommendedPreferenceButton\(publicSellerId\)/);
  assert.match(browser, /if \(removing\) focusRecommendedPreferenceButton\(sellerId\)/);
  assert.ok(
    browser.indexOf('<div class="market-entry-grid">')
      < browser.indexOf("${seller ? renderMarketShopSettings() : renderMarketFavoritesBook()}"),
    "the core join form should appear before the detailed shop and regular-book panels",
  );
  assert.ok(
    browser.indexOf("${seller ? renderMarketShopSettings() : renderMarketFavoritesBook()}")
      < browser.indexOf("${renderPatronFundPanel()}"),
    "fund panels should stay below the actionable setup",
  );
  assert.match(browser, /id="marketSetupOptionsButton"/);
  assert.match(browser, /market-preferred-summary/);
});

test("unavailable recommendations remain removable from a collapsed management path", () => {
  assert.match(browser, /const unavailable = source\.unavailable === true;/);
  assert.match(browser, /shop: shop \? \{ \.\.\.shop, publicSellerId \} : null/);
  assert.match(browser, /function renderUnavailableRecommendationManagement\(\)/);
  assert.match(browser, /<details class="market-safety-note market-recommendation-maintenance">/);
  assert.match(browser, /data-market-recommend-action="remove"/);
  assert.match(browser, /表示できない推薦 \$\{unavailable\.length\}件を管理/);
});
