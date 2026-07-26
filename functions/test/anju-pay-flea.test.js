"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FLEA_CATEGORIES,
  FLEA_DESCRIPTION_MAX_LENGTH,
  FLEA_DESCRIPTION_MIN_LENGTH,
  FLEA_LISTING_FEE,
  FLEA_LISTING_STATUSES,
  FLEA_PRICE_OPTIONS,
  FLEA_REPORT_REASONS,
  FLEA_SCHEMA_VERSION,
  FLEA_SUCCESS_FEE_BASIS_POINTS,
  FLEA_TITLE_MAX_LENGTH,
  effectiveFleaListingStatus,
  fleaExpiresAt,
  fleaJstDateKey,
  fleaListingId,
  fleaPublicSellerId,
  fleaSaleSettlement,
  isFleaReportReason,
  normalizeFleaListingInput,
  normalizeFleaSellerName,
  normalizeFleaXPostUrl,
} = require("../anju-pay-flea");

function errorCode(code) {
  return (error) => error instanceof RangeError && error.code === code;
}

function validListing(overrides = {}) {
  return {
    category: "illustration",
    title: "今日の色を描いた一枚",
    description: "やわらかな色合いで、今日の穏やかな気分を表したイラストです。",
    price: 25,
    xPostUrl: "",
    xConsent: false,
    ...overrides,
  };
}

test("flea constants pin the independent MVP economy and content contract", () => {
  assert.equal(FLEA_SCHEMA_VERSION, 1);
  assert.equal(FLEA_LISTING_FEE, 1);
  assert.deepEqual(FLEA_PRICE_OPTIONS, [10, 25, 50]);
  assert.equal(FLEA_SUCCESS_FEE_BASIS_POINTS, 500);
  assert.deepEqual(FLEA_CATEGORIES, ["illustration", "photo", "outfit"]);
  assert.equal(FLEA_TITLE_MAX_LENGTH, 30);
  assert.equal(FLEA_DESCRIPTION_MIN_LENGTH, 20);
  assert.equal(FLEA_DESCRIPTION_MAX_LENGTH, 240);
  assert.deepEqual(FLEA_REPORT_REASONS, [
    "rights",
    "privacy",
    "adult",
    "external_trade",
    "other",
  ]);
  assert.deepEqual(FLEA_LISTING_STATUSES, [
    "active",
    "sold",
    "canceled",
    "expired",
    "hidden",
  ]);
  for (const value of [
    FLEA_PRICE_OPTIONS,
    FLEA_CATEGORIES,
    FLEA_REPORT_REASONS,
    FLEA_LISTING_STATUSES,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test("JST date keys and expiry switch exactly at midnight", () => {
  const beforeMidnight = Date.parse("2026-07-25T14:59:59.999Z");
  const atMidnight = Date.parse("2026-07-25T15:00:00.000Z");

  assert.equal(fleaJstDateKey(beforeMidnight), "2026-07-25");
  assert.equal(fleaExpiresAt(beforeMidnight), atMidnight);
  assert.equal(fleaJstDateKey(atMidnight), "2026-07-26");
  assert.equal(
    fleaExpiresAt(atMidnight),
    Date.parse("2026-07-26T15:00:00.000Z"),
  );
  assert.equal(
    fleaJstDateKey(new Date("2026-01-01T00:00:00.000Z")),
    "2026-01-01",
  );
  assert.throws(() => fleaJstDateKey("not-a-date"), errorCode("invalid_timestamp"));
  assert.throws(() => fleaExpiresAt(Number.NaN), errorCode("invalid_timestamp"));
});

test("X post URLs are optional and canonicalized without query or hash", () => {
  assert.equal(normalizeFleaXPostUrl(""), "");
  assert.equal(normalizeFleaXPostUrl("   "), "");
  assert.equal(normalizeFleaXPostUrl(null), "");
  assert.equal(
    normalizeFleaXPostUrl(" https://www.x.com/Anju_27/status/1234567890?s=20#photo "),
    "https://x.com/Anju_27/status/1234567890",
  );
  assert.equal(
    normalizeFleaXPostUrl("ｈｔｔｐｓ：／／ｘ．ｃｏｍ／anju／status／９９"),
    "https://x.com/anju/status/99",
  );
});

test("X post URL validation rejects non-post, insecure, deceptive, and malformed URLs", () => {
  for (const value of [
    "http://x.com/anju/status/123",
    "https://twitter.com/anju/status/123",
    "https://x.com.evil.example/anju/status/123",
    "https://evil.example/?next=https://x.com/anju/status/123",
    "https://x.com/anju",
    "https://x.com/anju/status/not-digits",
    "https://x.com/anju/status/123/extra",
    "https://x.com/too_long_handle_123/status/123",
    "https://user:pass@x.com/anju/status/123",
    "https://x.com:444/anju/status/123",
    "x.com/anju/status/123",
    123,
  ]) {
    assert.throws(
      () => normalizeFleaXPostUrl(value),
      errorCode("invalid_x_post_url"),
      String(value),
    );
  }
});

test("listing input trims and NFKC-normalizes fields while preserving description lines", () => {
  const source = validListing({
    category: "ｐｈｏｔｏ",
    title: "　夜の光を写した一枚　",
    description: "　静かな帰り道で見つけた光です。\r\n色の重なりと空気感を言葉で紹介します。　",
    price: 50,
    xPostUrl: "https://www.x.com/anju/status/123?s=20",
    xConsent: true,
  });
  const normalized = normalizeFleaListingInput(source);

  assert.deepEqual(normalized, {
    category: "photo",
    title: "夜の光を写した一枚",
    description: "静かな帰り道で見つけた光です。\n色の重なりと空気感を言葉で紹介します。",
    price: 50,
    xPostUrl: "https://x.com/anju/status/123",
    xConsent: true,
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(source.description.includes("\r\n"), true, "input must not be mutated");
});

test("a post URL requires explicit consent and ordinary listings store no consent flag", () => {
  assert.throws(
    () => normalizeFleaListingInput(validListing({
      xPostUrl: "https://x.com/anju/status/123",
      xConsent: false,
    })),
    errorCode("x_post_consent_required"),
  );
  assert.equal(normalizeFleaListingInput(validListing()).xConsent, false);
});

test("category and price use exact allowlists without numeric coercion", () => {
  for (const category of ["both", "clothes", "", null]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ category })),
      errorCode("invalid_flea_category"),
    );
  }
  for (const price of [0, 11, 100, "25", 25.5, null]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ price })),
      errorCode("invalid_flea_price"),
    );
  }
  for (const category of FLEA_CATEGORIES) {
    for (const price of FLEA_PRICE_OPTIONS) {
      const normalized = normalizeFleaListingInput(validListing({ category, price }));
      assert.equal(normalized.category, category);
      assert.equal(normalized.price, price);
    }
  }
});

test("title and description enforce line and length boundaries", () => {
  assert.equal(
    normalizeFleaListingInput(validListing({ title: "あ".repeat(30) })).title.length,
    30,
  );
  assert.throws(
    () => normalizeFleaListingInput(validListing({ title: "あ".repeat(31) })),
    errorCode("invalid_flea_title"),
  );
  assert.throws(
    () => normalizeFleaListingInput(validListing({ title: "二行の\nタイトル" })),
    errorCode("invalid_flea_title"),
  );
  assert.equal(
    normalizeFleaListingInput(validListing({ description: "あ".repeat(20) })).description.length,
    20,
  );
  assert.equal(
    normalizeFleaListingInput(validListing({ description: "あ".repeat(240) })).description.length,
    240,
  );
  for (const description of ["あ".repeat(19), "あ".repeat(241), `安全な紹介文です${"\u0000"}残りの文章です`.repeat(2)]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ description })),
      errorCode("invalid_flea_description"),
    );
  }
  for (const title of ["一行目\u2028二行目", "一行目\u2029二行目", "成人\u200B向け作品"] ) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ title })),
      errorCode("invalid_flea_title"),
    );
  }
  assert.throws(
    () => normalizeFleaListingInput(validListing({
      description: "Pay\u200BPayで送金してください。作品の紹介を続けます。",
    })),
    errorCode("invalid_flea_description"),
  );
});

test("listing text rejects URLs and email addresses because X has a dedicated field", () => {
  for (const [description, code] of [
    ["作品の詳細は https://example.com/item を見てください。これは紹介文です。", "url_in_listing_text"],
    ["作品の詳細は example.com/item を見てください。これは紹介文です。", "url_in_listing_text"],
    ["質問は artist@example.com へ送ってください。作品の紹介文です。", "email_in_listing_text"],
  ]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ description })),
      errorCode(code),
    );
  }
});

test("listing text rejects external payments, marketplaces, direct delivery, and contact solicitation", () => {
  for (const [description, code] of [
    ["この衣装が気になる方はPayPayで送金してください。外部でお渡しします。", "external_trade_in_listing_text"],
    ["気に入った方はメルカリで購入してください。こちらは作品の紹介です。", "external_trade_in_listing_text"],
    ["この作品はゲーム外で直接取引を希望します。気になる方を募集します。", "external_trade_in_listing_text"],
    ["この洋服は実物を送付します。手触りまで楽しめる一着です。", "external_trade_in_listing_text"],
    ["この作品が気になる方はLINE IDを送ってください。よろしくお願いします。", "contact_solicitation_in_listing_text"],
  ]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ description })),
      errorCode(code),
      description,
    );
  }
});

test("listing text rejects obvious personal information and restricted trade solicitation", () => {
  for (const [description, code] of [
    ["連絡先はこちらです。電話番号：090-1234-5678までお願いします。", "personal_information_in_listing_text"],
    ["購入前に住所を教えてください。詳しい受け渡し方法を案内します。", "personal_information_in_listing_text"],
    ["成人向け写真を販売します。購入を希望する方を募集しています。", "restricted_trade_in_listing_text"],
    ["この作品には成人向けの性的描写が含まれます。内容を言葉で紹介します。", "restricted_trade_in_listing_text"],
    ["この作品には成人\n向けの性的描写が含まれます。内容を言葉で紹介します。", "restricted_trade_in_listing_text"],
    ["未成年を性的に扱うイラストについて説明する出品です。", "restricted_trade_in_listing_text"],
    ["大麻を販売します。購入したい方からの注文を募集しています。", "restricted_trade_in_listing_text"],
  ]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ description })),
      errorCode(code),
      description,
    );
  }
});

test("creative descriptions allow isolated place, comparison, vehicle, and fictional weapon words", () => {
  for (const description of [
    "東京都新宿区の夜景を青い光と静かな空気感で描いたイラストです。",
    "実物より鮮やかな色を目指し、光と影の重なりを言葉で紹介します。",
    "拳銃を持つ架空の探偵が事件を追う、古い映画風のイラスト作品です。",
    "現金輸送車が都市を走る場面を、力強い構図で写した作品です。",
  ]) {
    assert.equal(
      normalizeFleaListingInput(validListing({ description })).description,
      description,
    );
  }
});

test("contextual safety rejects precise location, pickup, off-platform direction, adult, and regulated sales", () => {
  for (const [description, code] of [
    ["東京都新宿区西新宿2丁目8番1号で受け取ってください。詳しく案内します。", "personal_information_in_listing_text"],
    ["新宿駅の改札で会って受け取ります。時間は相談できます。", "external_trade_in_listing_text"],
    ["現金のみ、送料込みで本物の服をお渡しします。詳しく案内します。", "external_trade_in_listing_text"],
    ["楽天Payやクレカのことはプロフィールから連絡してください。", "contact_solicitation_in_listing_text"],
    ["この作品が気になる方はXでanjuを検索してください。紹介を載せています。", "contact_solicitation_in_listing_text"],
    ["固定ポストを見てください。作品について詳しく紹介しています。", "contact_solicitation_in_listing_text"],
    ["JKのきわどい無修正ロリ画像について紹介する出品です。", "restricted_trade_in_listing_text"],
    ["本物の銃とナイフを売って後で渡します。詳しく説明します。", "restricted_trade_in_listing_text"],
  ]) {
    assert.throws(
      () => normalizeFleaListingInput(validListing({ description })),
      errorCode(code),
      description,
    );
  }
  for (const [name, code] of [
    ["@another_account", "contact_solicitation_in_listing_text"],
    ["現金のみ", "external_trade_in_listing_text"],
    ["Xでanjuを検索して", "contact_solicitation_in_listing_text"],
  ]) {
    assert.throws(() => normalizeFleaSellerName(name), errorCode(code), name);
  }
  assert.equal(normalizeFleaSellerName("東京都の夜景好き"), "東京都の夜景好き");
});

test("sale settlement charges five percent rounded up with a one Pay minimum", () => {
  assert.deepEqual(fleaSaleSettlement(10), {
    grossAmount: 10,
    feeAmount: 1,
    sellerProceeds: 9,
  });
  assert.deepEqual(fleaSaleSettlement(25), {
    grossAmount: 25,
    feeAmount: 2,
    sellerProceeds: 23,
  });
  assert.deepEqual(fleaSaleSettlement(50), {
    grossAmount: 50,
    feeAmount: 3,
    sellerProceeds: 47,
  });
  assert.equal(Object.isFrozen(fleaSaleSettlement(25)), true);
  for (const price of [0, 11, 100, "25", 25.5]) {
    assert.throws(() => fleaSaleSettlement(price), errorCode("invalid_flea_price"));
  }
});

test("effective status expires active listings at the exact deadline and preserves terminal states", () => {
  const expiresAt = Date.parse("2026-07-25T15:00:00.000Z");
  assert.equal(
    effectiveFleaListingStatus({ status: "active", expiresAt }, expiresAt - 1),
    "active",
  );
  assert.equal(
    effectiveFleaListingStatus({ status: "active", expiresAt }, expiresAt),
    "expired",
  );
  assert.equal(
    effectiveFleaListingStatus({ status: "active", expiresAt }, expiresAt + 1),
    "expired",
  );
  assert.equal(effectiveFleaListingStatus({ status: "active" }, expiresAt - 1), "expired");
  for (const status of ["sold", "canceled", "expired", "hidden"]) {
    assert.equal(
      effectiveFleaListingStatus({ status, expiresAt }, expiresAt + 1),
      status,
    );
  }
  assert.equal(effectiveFleaListingStatus({ status: "unknown", expiresAt }, 0), "expired");
  assert.throws(
    () => effectiveFleaListingStatus({ status: "active", expiresAt }, Number.NaN),
    errorCode("invalid_timestamp"),
  );
});

test("listing and public seller IDs are stable, separated, and do not expose their source", () => {
  const uid = "anonymous-user-123";
  const first = fleaListingId(uid, "2026-07-26");
  const same = fleaListingId(uid, "2026-07-26");
  const nextDay = fleaListingId(uid, "2026-07-27");
  const otherUser = fleaListingId("anonymous-user-456", "2026-07-26");
  const publicSellerId = fleaPublicSellerId(uid);

  assert.equal(first, same);
  assert.match(first, /^[a-f0-9]{40}$/);
  assert.match(publicSellerId, /^[a-f0-9]{40}$/);
  assert.notEqual(first, nextDay);
  assert.notEqual(first, otherUser);
  assert.notEqual(first, publicSellerId);
  assert.doesNotMatch(first, /anonymous|2026/);
  assert.equal(publicSellerId, fleaPublicSellerId(uid));
  assert.notEqual(publicSellerId, fleaPublicSellerId("anonymous-user-456"));

  for (const invalidUid of ["", `bad${"\u0000"}uid`, "x".repeat(129), null]) {
    assert.throws(
      () => fleaPublicSellerId(invalidUid),
      errorCode("invalid_flea_uid"),
    );
  }
  for (const invalidDateKey of ["2026-02-30", "2026-7-26", "not-a-date", null]) {
    assert.throws(
      () => fleaListingId(uid, invalidDateKey),
      errorCode("invalid_flea_date_key"),
    );
  }
});

test("report reasons accept only the fixed moderation taxonomy", () => {
  for (const reason of FLEA_REPORT_REASONS) {
    assert.equal(isFleaReportReason(reason), true);
  }
  for (const reason of ["spam", "adult ", "", null, 1]) {
    assert.equal(isFleaReportReason(reason), false);
  }
});
