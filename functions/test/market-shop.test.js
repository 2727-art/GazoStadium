const assert = require("node:assert/strict");
const test = require("node:test");
const PRODUCT_CATALOG = require("../product-catalog");

const {
  MARKET_SHOP_CATALOG,
  MARKET_SHOP_IMPRESSION_COOLDOWN_MS,
  MARKET_SHOP_SCHEMA_VERSION,
  applyMarketSaleToShop,
  marketQueueCandidateSessionKey,
  marketImpressionDecision,
  marketQueuesCompatible,
  marketSaleRelationshipUpdate,
  marketShopSalesModeRecord,
  marketShopSalesCount,
  normalizeStoredMarketShop,
  preserveLegacyMarketServiceStyles,
  publicSellerShop,
  restoreMarketShopSalesModeRecord,
  selectMarketQueueCandidate,
  selectMarketQueueCandidates,
  shouldReplaceMarketQueue,
  validateMarketShopInput,
} = require("../market-shop");

function validInput(overrides = {}) {
  return {
    shopName: "月灯り商店",
    tagline: "物語のある一枚を届けます",
    specialtyTags: ["story", "night"],
    serviceStyles: ["story", "careful"],
    salesMode: "normal",
    themeId: "lavender",
    sealId: "moon",
    titleId: "title_image_sommelier",
    shopCharmId: "stamp_cute",
    repeatWelcome: true,
    ...overrides,
  };
}

test("oshi market titles use the agreed product IDs and prices", () => {
  assert.deepEqual(
    [
      ["title_oshi_deliverer", 400],
      ["title_oshi_storyteller", 450],
      ["title_tokimeki_scout", 450],
      ["title_one_picture_guide", 500],
      ["title_favorite_matchmaker", 550],
      ["title_tokimeki_curator", 650],
      ["title_oshi_concierge", 750],
    ].map(([id, price]) => PRODUCT_CATALOG[id] && {
      id: PRODUCT_CATALOG[id].id,
      type: PRODUCT_CATALOG[id].type,
      price: PRODUCT_CATALOG[id].price,
    }),
    [
      { id: "title_oshi_deliverer", type: "title", price: 400 },
      { id: "title_oshi_storyteller", type: "title", price: 450 },
      { id: "title_tokimeki_scout", type: "title", price: 450 },
      { id: "title_one_picture_guide", type: "title", price: 500 },
      { id: "title_favorite_matchmaker", type: "title", price: 550 },
      { id: "title_tokimeki_curator", type: "title", price: 650 },
      { id: "title_oshi_concierge", type: "title", price: 750 },
    ],
  );
});

test("shop save input accepts only catalog selections and an owned title", () => {
  const result = validateMarketShopInput(validInput(), {
    ownedTitleIds: ["title_image_sommelier"],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.shop.specialtyTags, ["story", "night"]);
  assert.equal(result.shop.shopCharmId, "stamp_cute");
  assert.equal(result.shop.repeatWelcome, true);

  const invalid = validateMarketShopInput(validInput({
    specialtyTags: ["story", "story"],
    serviceStyles: ["unknown"],
    themeId: "paid_trust_badge",
    sealId: "verified",
    titleId: "title_not_owned",
    shopCharmId: "stamp_god_photo",
  }), { ownedTitleIds: [] });
  assert.equal(invalid.valid, false);
  assert.deepEqual(
    invalid.errors,
    ["specialtyTags", "serviceStyles", "themeId", "sealId", "titleId", "shopCharmId"],
  );
});
test("shop save input accepts and stores the explicit oshijo sales mode", () => {
  const result = validateMarketShopInput(validInput({
    serviceStyles: ["story"],
    salesMode: "oshijo",
  }), {
    ownedTitleIds: ["title_image_sommelier"],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.shop.salesMode, "oshijo");
  assert.deepEqual(result.shop.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(result.shop.regularServiceStyles, ["story"]);
  assert.deepEqual(
    MARKET_SHOP_CATALOG.serviceStyles.find(({ id }) => id === "oshijo"),
    { id: "oshijo", label: "推し嬢モード（商談後に自由請求）" },
  );
});

test("oshijo sales mode does not consume either regular service-style slot", () => {
  const result = validateMarketShopInput(validInput({
    titleId: "",
    serviceStyles: ["story", "careful"],
    salesMode: "oshijo",
  }));
  assert.equal(result.valid, true);
  assert.equal(result.shop.salesMode, "oshijo");
  assert.deepEqual(result.shop.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(result.shop.regularServiceStyles, ["story", "careful"]);
  assert.equal(MARKET_SHOP_SCHEMA_VERSION, 2);
  assert.equal(MARKET_SHOP_CATALOG.limits.serviceStyles, 2);
  assert.equal(MARKET_SHOP_CATALOG.limits.regularServiceStyles, 2);
  assert.equal(MARKET_SHOP_CATALOG.limits.salesModes, 1);
  assert.deepEqual(
    MARKET_SHOP_CATALOG.salesModes.map(({ id }) => id),
    ["normal", "oshijo"],
  );
  const normalized = normalizeStoredMarketShop({
    ...validInput({ titleId: "" }),
    serviceStyles: ["oshijo", "story"],
    regularServiceStyles: ["story", "careful"],
    salesMode: "oshijo",
  });
  assert.deepEqual(normalized.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(normalized.regularServiceStyles, ["story", "careful"]);

  const tooManyRegularStyles = validateMarketShopInput(validInput({
    titleId: "",
    serviceStyles: ["story", "careful", "audio"],
  }));
  assert.equal(tooManyRegularStyles.valid, false);
  assert.ok(tooManyRegularStyles.errors.includes("serviceStyles"));
});

test("v2 oshijo settings are fully restored after cached v1 Functions rewrite the shop", () => {
  const saved = validateMarketShopInput(validInput({
    titleId: "",
    serviceStyles: ["story", "careful"],
    salesMode: "oshijo",
  })).shop;
  const durableRecord = marketShopSalesModeRecord(saved, 123);

  assert.deepEqual(saved.serviceStyles, ["oshijo", "story"]);
  assert.equal(saved.serviceStyles.length <= 2, true);
  assert.deepEqual(durableRecord, {
    schemaVersion: 2,
    salesMode: "oshijo",
    regularServiceStyles: ["story", "careful"],
    updatedAt: 123,
  });

  // Cached v1 Functions know only serviceStyles and drop schema-v2 fields.
  const rewrittenByV1 = { ...saved };
  delete rewrittenByV1.salesMode;
  delete rewrittenByV1.regularServiceStyles;
  const restored = restoreMarketShopSalesModeRecord(rewrittenByV1, durableRecord);
  assert.equal(restored.salesMode, "oshijo");
  assert.deepEqual(restored.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(restored.regularServiceStyles, ["story", "careful"]);

  const legacyReplacement = restoreMarketShopSalesModeRecord({
    ...rewrittenByV1,
    serviceStyles: ["oshijo", "audio"],
  }, durableRecord);
  assert.equal(legacyReplacement.salesMode, "oshijo");
  assert.deepEqual(legacyReplacement.serviceStyles, ["oshijo", "audio"]);
  assert.deepEqual(legacyReplacement.regularServiceStyles, ["audio", "careful"]);

  const legacyOptOut = restoreMarketShopSalesModeRecord({
    ...rewrittenByV1,
    serviceStyles: ["story"],
  }, durableRecord);
  assert.equal(legacyOptOut.salesMode, "normal");
  assert.deepEqual(legacyOptOut.serviceStyles, ["story", "careful"]);
  assert.deepEqual(legacyOptOut.regularServiceStyles, ["story", "careful"]);

  const nativeV2Edit = restoreMarketShopSalesModeRecord({
    ...saved,
    salesMode: "normal",
    serviceStyles: ["audio"],
    regularServiceStyles: ["audio"],
  }, durableRecord);
  assert.equal(nativeV2Edit.salesMode, "normal");
  assert.deepEqual(nativeV2Edit.regularServiceStyles, ["audio"]);
});

test("legacy oshijo saves retain a hidden second regular style without blocking opt-out", () => {
  const current = {
    ...validInput({ titleId: "" }),
    salesMode: "oshijo",
    serviceStyles: ["oshijo", "story"],
    regularServiceStyles: ["story", "careful"],
  };
  const legacyPayload = validInput({
    titleId: "",
    serviceStyles: ["oshijo", "story"],
  });
  delete legacyPayload.salesMode;
  const legacyValidation = validateMarketShopInput(legacyPayload);
  assert.equal(legacyValidation.valid, true);
  assert.equal(legacyValidation.legacySalesModeContract, true);
  assert.equal(legacyValidation.shop.salesMode, "oshijo");
  const preserved = preserveLegacyMarketServiceStyles(
    current,
    legacyValidation.shop,
    legacyValidation.legacySalesModeContract,
  );
  assert.deepEqual(preserved.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(preserved.regularServiceStyles, ["story", "careful"]);

  const legacyReplacementPayload = validInput({
    titleId: "",
    serviceStyles: ["oshijo", "audio"],
  });
  delete legacyReplacementPayload.salesMode;
  const legacyReplacement = validateMarketShopInput(legacyReplacementPayload);
  const replaced = preserveLegacyMarketServiceStyles(current, legacyReplacement.shop, true);
  assert.deepEqual(replaced.serviceStyles, ["oshijo", "audio"]);
  assert.deepEqual(replaced.regularServiceStyles, ["audio", "careful"]);

  const legacyOptOutPayload = validInput({
    titleId: "",
    serviceStyles: ["story"],
  });
  delete legacyOptOutPayload.salesMode;
  const legacyOptOut = validateMarketShopInput(legacyOptOutPayload);
  assert.equal(legacyOptOut.shop.salesMode, "normal");
  const optedOut = preserveLegacyMarketServiceStyles(current, legacyOptOut.shop, true);
  assert.deepEqual(optedOut.serviceStyles, ["story", "careful"]);
  assert.deepEqual(optedOut.regularServiceStyles, ["story", "careful"]);

  const legacyOptOutReplacementPayload = validInput({
    titleId: "",
    serviceStyles: ["audio"],
  });
  delete legacyOptOutReplacementPayload.salesMode;
  const legacyOptOutReplacement = validateMarketShopInput(legacyOptOutReplacementPayload);
  const optedOutReplacement = preserveLegacyMarketServiceStyles(
    current,
    legacyOptOutReplacement.shop,
    legacyOptOutReplacement.legacySalesModeContract,
  );
  assert.deepEqual(optedOutReplacement.serviceStyles, ["audio", "careful"]);
  assert.deepEqual(optedOutReplacement.regularServiceStyles, ["audio", "careful"]);

  const legacyTwoVisiblePayload = validInput({
    titleId: "",
    serviceStyles: ["story", "audio"],
  });
  delete legacyTwoVisiblePayload.salesMode;
  const legacyTwoVisible = validateMarketShopInput(legacyTwoVisiblePayload);
  const twoVisible = preserveLegacyMarketServiceStyles(current, legacyTwoVisible.shop, true);
  assert.deepEqual(twoVisible.serviceStyles, ["story", "audio"]);
  assert.deepEqual(twoVisible.regularServiceStyles, ["story", "audio"]);
});

test("stored legacy oshijo tags migrate to salesMode and invalid explicit modes are rejected", () => {
  const legacyStored = normalizeStoredMarketShop({
    ...validInput({ titleId: "" }),
    serviceStyles: ["careful", "oshijo"],
  });
  assert.equal(legacyStored.salesMode, "normal");

  const withoutExplicitMode = validInput({
    titleId: "",
    serviceStyles: ["careful", "oshijo"],
  });
  delete withoutExplicitMode.salesMode;
  const migrated = normalizeStoredMarketShop(withoutExplicitMode);
  assert.equal(migrated.salesMode, "oshijo");
  assert.deepEqual(migrated.serviceStyles, ["oshijo", "careful"]);
  assert.deepEqual(migrated.regularServiceStyles, ["careful"]);

  const invalidMode = validateMarketShopInput(validInput({
    titleId: "",
    salesMode: "unknown",
  }));
  assert.equal(invalidMode.valid, false);
  assert.ok(invalidMode.errors.includes("salesMode"));
});


test("shop charms accept free stamps and only owned paid stamps", () => {
  const freeCharm = validateMarketShopInput(validInput({
    shopCharmId: "stamp_thanks",
  }), {
    ownedTitleIds: ["title_image_sommelier"],
    ownedShopCharmIds: [],
  });
  assert.equal(freeCharm.valid, true);

  const ownedPaidCharm = validateMarketShopInput(validInput({
    shopCharmId: "stamp_god_photo",
  }), {
    ownedTitleIds: ["title_image_sommelier"],
    ownedShopCharmIds: ["stamp_god_photo"],
  });
  assert.equal(ownedPaidCharm.valid, true);
  assert.equal(ownedPaidCharm.shop.shopCharmId, "stamp_god_photo");

  for (const shopCharmId of ["stamp_god_photo", "stamp_not_in_catalog"]) {
    const unavailableCharm = validateMarketShopInput(validInput({ shopCharmId }), {
      ownedTitleIds: ["title_image_sommelier"],
      ownedShopCharmIds: [],
    });
    assert.equal(unavailableCharm.valid, false);
    assert.deepEqual(unavailableCharm.errors, ["shopCharmId"]);
  }
});

test("shop names and taglines are bounded single-line text and taglines reject URLs", () => {
  for (const overrides of [
    { shopName: "写真。大好きです" },
    { tagline: "これは良い。ですね" },
    { tagline: "猫。好きな一枚を届けます。" },
  ]) {
    assert.equal(
      validateMarketShopInput(validInput(overrides), {
        ownedTitleIds: ["title_image_sommelier"],
      }).valid,
      true,
    );
  }

  for (const overrides of [
    { shopName: "" },
    { shopName: "あ".repeat(17) },
    { shopName: "example.jp" },
    { shopName: "bit.ly" },
    { shopName: "example．jp" },
    { shopName: "example。jp" },
    { tagline: "line one\nline two" },
    { tagline: "https://example.com を見てください" },
    { tagline: "example.jp/profile" },
    { tagline: "example．jp/profile" },
    { tagline: "example。jp/profile" },
    { tagline: "あ".repeat(41) },
  ]) {
    assert.equal(
      validateMarketShopInput(validInput(overrides), {
        ownedTitleIds: ["title_image_sommelier"],
      }).valid,
      false,
    );
  }
});

test("public shop cards expose stable presentation and aggregate report without private IDs", () => {
  const card = publicSellerShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    ...validInput(),
    issueCount: 8,
    uniqueBuyerCount: 6,
    repeatBuyerCount: 2,
    favoriteCount: 3,
    impressionBuyerCount: 6,
    impressionCounts: { kind: 5, insightful: 2, ignored: 99 },
  }, {
    marketStats: { uniqueCounterparties: 99 },
  });
  assert.equal(card.shopName, "月灯り商店");
  assert.equal(card.shopCharmId, "stamp_cute");
  assert.equal(card.verified.repeatBuyerCount, 2);
  assert.equal(card.verified.salesCount, 8);
  assert.equal(card.verified.uniqueCounterparties, 6);
  assert.equal(card.verified.impressions.kind, 5);
  assert.equal(card.verified.impressions.ignored, undefined);
  assert.equal(card.favoriteCount, undefined);
  assert.equal(card.uid, undefined);
  assert.equal(card.sellerUid, undefined);

  const oshijoCard = publicSellerShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    ...validInput({ salesMode: "oshijo" }),
  });
  assert.equal(oshijoCard.salesMode, "oshijo");
  assert.deepEqual(oshijoCard.serviceStyles, ["oshijo", "story"]);
  assert.deepEqual(oshijoCard.regularServiceStyles, ["story", "careful"]);

  const legacyCard = publicSellerShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    ...validInput(),
  }, {
    marketStats: { salesCount: 11 },
  });
  assert.equal(legacyCard.verified.salesCount, 11);

  const migratedCard = publicSellerShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    ...validInput(),
    issueCount: 4,
  }, {
    marketStats: { salesCount: 11 },
  });
  assert.equal(migratedCard.verified.salesCount, 4);
  assert.equal(marketShopSalesCount({}, { salesCount: 11 }), 11);
  assert.equal(marketShopSalesCount({ issueCount: 4 }, { salesCount: 11 }), 4);

  const sanitizedAgain = publicSellerShop(card);
  assert.deepEqual(sanitizedAgain.verified, card.verified);

  const repeatedTagsFromFourBuyers = publicSellerShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    ...validInput(),
    impressionBuyerCount: 4,
    impressionCounts: { kind: 10 },
  });
  assert.deepEqual(repeatedTagsFromFourBuyers.verified.impressions, {});
  assert.equal(repeatedTagsFromFourBuyers.verified.impressionsCollecting, true);
});

test("favorite-only matching still enforces price and mutual blocks", () => {
  const seller = {
    uid: "seller",
    role: "seller",
    listing: { askingPrice: 100 },
    blockedUids: [],
    sellerShop: { repeatWelcome: true },
  };
  const buyer = {
    uid: "buyer",
    role: "buyer",
    maxBudget: 100,
    blockedUids: [],
    matchMode: "favorites",
    selectedFavoriteSellerUid: "seller",
  };
  assert.equal(marketQueuesCompatible(seller, buyer), true);
  assert.equal(marketQueuesCompatible({ ...seller, sellerShop: { repeatWelcome: false } }, buyer), false);
  assert.equal(marketQueuesCompatible(seller, { ...buyer, selectedFavoriteSellerUid: "other" }), false);
  assert.equal(marketQueuesCompatible(seller, { ...buyer, maxBudget: 50 }), false);
  assert.equal(marketQueuesCompatible({ ...seller, blockedUids: ["buyer"] }, buyer), false);
  assert.equal(marketQueuesCompatible(seller, { ...buyer, blockedUids: ["seller"] }), false);
  assert.equal(marketQueuesCompatible(seller, { ...buyer, matchMode: "any", selectedFavoriteSellerUid: "" }), true);
});

test("candidate selection can use a specifically targeted buyer beyond the standard first 30", () => {
  const seller = {
    uid: "seller",
    role: "seller",
    listing: { askingPrice: 100 },
    blockedUids: [],
    sellerShop: { repeatWelcome: true },
  };
  const unrelatedBuyers = Array.from({ length: 30 }, (_, index) => ({
    uid: `buyer-${index}`,
    role: "buyer",
    status: "waiting",
    joinedAt: index + 1,
    lastSeen: 2_000,
    maxBudget: 100,
    blockedUids: [],
    matchMode: "favorites",
    selectedFavoriteSellerUid: "another-seller",
    appCheckVerified: true,
  }));
  const selectedBuyer = {
    uid: "selected-buyer",
    role: "buyer",
    status: "waiting",
    joinedAt: 31,
    lastSeen: 2_000,
    maxBudget: 100,
    blockedUids: [],
    matchMode: "favorites",
    selectedFavoriteSellerUid: "seller",
    appCheckVerified: true,
  };
  assert.equal(selectMarketQueueCandidate(
    seller,
    [...unrelatedBuyers, selectedBuyer],
    { minimumLastSeen: 1_000, requireAppCheck: true },
  )?.uid, "selected-buyer");
  assert.deepEqual(
    selectMarketQueueCandidates(
      seller,
      [selectedBuyer, { ...selectedBuyer, uid: "selected-buyer-2", joinedAt: 40 }],
      { minimumLastSeen: 1_000, requireAppCheck: true },
    ).map((entry) => entry.uid),
    ["selected-buyer", "selected-buyer-2"],
  );
  const skippedBuyer = {
    ...selectedBuyer,
    queueToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.equal(
    selectMarketQueueCandidate(
      {
        ...seller,
        skippedCandidateSessions: [marketQueueCandidateSessionKey(skippedBuyer)],
      },
      [skippedBuyer],
      { minimumLastSeen: 1_000, requireAppCheck: true },
    ),
    null,
  );
});

test("newer queue requests replace older sessions deterministically", () => {
  const current = {
    status: "waiting",
    joinedAt: 100,
    queueRequestedAt: 100,
    queueToken: "11111111111111111111111111111111",
  };
  assert.equal(shouldReplaceMarketQueue(current, {
    ...current,
    queueRequestedAt: 99,
    queueToken: "ffffffffffffffffffffffffffffffff",
  }), false);
  assert.equal(shouldReplaceMarketQueue(current, {
    ...current,
    queueRequestedAt: 101,
    queueToken: "00000000000000000000000000000000",
  }), true);
  assert.equal(shouldReplaceMarketQueue(current, {
    ...current,
    queueToken: "22222222222222222222222222222222",
  }), true);
  assert.equal(shouldReplaceMarketQueue(current, {
    ...current,
    queueToken: "00000000000000000000000000000000",
  }), false);
});

test("impressions are idempotent per room and limited to one per pair every 30 days", () => {
  const now = 2_000_000_000_000;
  assert.deepEqual(marketImpressionDecision({
    existingRoomImpression: true,
    lastImpressionAt: now,
    now,
  }), {
    action: "noop",
    retryAfterMs: 0,
    impressionRecorded: false,
    alreadyRecorded: true,
    addsDistinctBuyer: false,
  });
  assert.deepEqual(marketImpressionDecision({
    lastImpressionAt: now - MARKET_SHOP_IMPRESSION_COOLDOWN_MS + 1,
    now,
  }), {
    action: "cooldown",
    retryAfterMs: 1,
    impressionRecorded: false,
    alreadyRecorded: false,
    addsDistinctBuyer: false,
  });
  assert.deepEqual(marketImpressionDecision({
    lastImpressionAt: now - MARKET_SHOP_IMPRESSION_COOLDOWN_MS,
    now,
  }), {
    action: "write",
    retryAfterMs: 0,
    impressionRecorded: true,
    alreadyRecorded: false,
    addsDistinctBuyer: false,
  });
  assert.equal(marketImpressionDecision({
    lastImpressionAt: 0,
    now,
  }).addsDistinctBuyer, true);
});

test("the first later-day repeat sale adds one repeat buyer and seller issue numbers stay monotonic", () => {
  const first = marketSaleRelationshipUpdate(null, "2026-07-23", 100);
  assert.equal(first.addsUniqueBuyer, true);
  assert.equal(first.addsRepeatBuyer, false);
  const firstShop = applyMarketSaleToShop({
    publicSellerId: "shop_A1B2C3D4E5F6",
    shopName: "SHOP",
  }, first, 100);
  assert.equal(firstShop.issueCount, 1);
  assert.equal(firstShop.uniqueBuyerCount, 1);
  assert.equal(firstShop.repeatBuyerCount, 0);

  const sameDay = marketSaleRelationshipUpdate(first, "2026-07-23", 150);
  assert.equal(sameDay.addsRepeatBuyer, false);
  const sameDayShop = applyMarketSaleToShop(firstShop, sameDay, 150);
  assert.equal(sameDayShop.issueCount, 2);
  assert.equal(sameDayShop.repeatBuyerCount, 0);
  const second = marketSaleRelationshipUpdate(sameDay, "2026-07-24", 200);
  assert.equal(second.addsUniqueBuyer, false);
  assert.equal(second.addsRepeatBuyer, true);
  const secondShop = applyMarketSaleToShop(sameDayShop, second, 200);
  assert.equal(secondShop.issueCount, 3);
  assert.equal(secondShop.uniqueBuyerCount, 1);
  assert.equal(secondShop.repeatBuyerCount, 1);

  const third = marketSaleRelationshipUpdate(second, "2026-07-25", 300);
  const thirdShop = applyMarketSaleToShop(secondShop, third, 300);
  assert.equal(thirdShop.issueCount, 4);
  assert.equal(thirdShop.repeatBuyerCount, 1);

  const pricedShop = applyMarketSaleToShop(thirdShop, third, 400, 500);
  assert.equal(pricedShop.bestSale, 500);
  const lowerPricedShop = applyMarketSaleToShop(pricedShop, third, 500, 100);
  assert.equal(lowerPricedShop.bestSale, 500);
  assert.equal(publicSellerShop(lowerPricedShop, {
    marketStats: { bestSale: 100 },
  }).verified.bestSale, 500);
});

test("catalog IDs are unique within each selectable family", () => {
  for (const key of ["specialtyTags", "serviceStyles", "salesModes", "themes", "seals", "impressionTags"]) {
    const ids = MARKET_SHOP_CATALOG[key].map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
  }
  const fallback = normalizeStoredMarketShop({});
  assert.equal(fallback.themeId, "standard");
  assert.equal(fallback.sealId, "heart");
  assert.equal(fallback.shopCharmId, "");
  assert.equal(normalizeStoredMarketShop({ shopCharmId: "stamp_not_in_catalog" }).shopCharmId, "");
  assert.equal(fallback.impressionBuyerCount, 0);
});
