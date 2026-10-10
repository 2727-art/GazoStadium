"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const rules = require("../tribute-rules");

test("forbidden wording blocks contact routes, outside payment, real money, meetings, personal info and exposure threats", () => {
  const blocked = {
    "LINE IDおしえて": "contact_app",
    "ライン交換しよ": "contact_app",
    "ディスコードある？": "contact_app",
    "インスタ見せて": "contact_app",
    "裏垢ある？": "contact_app",
    "@mio_sama で探して": "handle",
    "https://example.com": "url",
    "mio.example.jp": "url",
    "mio@example.com": "email",
    "090-1234-5678": "phone",
    "PayPayで送って": "external_payment",
    "アマギフで払え": "external_payment",
    "現金でちょうだい": "external_payment",
    "換金できる？": "external_payment",
    "500円ちょうだい": "real_money",
    "明日会おうよ": "meeting",
    "オフ会しよ": "meeting",
    "ホテル行こ": "meeting",
    "住所教えて": "personal_info",
    "本名は？": "personal_info",
    "晒すぞ": "exposure_threat",
    "特定してやる": "exposure_threat",
  };
  for (const [text, reason] of Object.entries(blocked)) {
    assert.equal(rules.forbiddenReason(text), reason, text);
  }
  for (const text of [
    "オンラインで遊ぼ",
    "出会ってくれてありがとう",
    "deadlineは今夜",
    "雑魚財布、もっと出せ",
    "今日の分、100 Pay差し出して",
    "ネカマに貢いで満足？",
    "ｵﾏｴの財布、軽すぎ",
  ]) {
    assert.equal(rules.forbiddenReason(text), "", text);
  }
});

test("full-width and half-width variants are normalized before filtering", () => {
  assert.equal(rules.forbiddenReason("ＰａｙＰａｙ"), "external_payment");
  assert.equal(rules.forbiddenReason("ﾗｲﾝ交換"), "contact_app");
  assert.equal(rules.forbiddenReason("５００円"), "real_money");
});

test("messages keep typed punctuation while NG words match normalized text", () => {
  assert.deepEqual(rules.normalizeMessage("まだ？！"), { text: "まだ？！" });
  assert.equal(rules.normalizeMessage("   ").error, "メッセージを入力してください。");
  assert.equal(rules.normalizeMessage("x".repeat(300)).text.length, 240);
  assert.equal(rules.containsNgWord("お前ﾌﾞｽ", ["ブス"]), true);
  assert.equal(rules.containsNgWord("雑魚", ["ブス"]), false);
  assert.deepEqual(rules.normalizeNgWords("ブス、デブ,ハゲ\nブス"), ["ブス", "デブ", "ハゲ"]);
  assert.equal(rules.normalizeNgWords(["a", "b", "c", "d", "e", "f"]).length, 5);
});

test("caps must be chosen options in order and the entry fee must fit one tribute", () => {
  assert.deepEqual(rules.normalizeCaps({ perTribute: 100, perDay: 300, total: 1_000 }), { perTribute: 100, perDay: 300, total: 1_000 });
  assert.equal(rules.normalizeCaps({ perTribute: 300, perDay: 100, total: 1_000 }), null);
  assert.equal(rules.normalizeCaps({ perTribute: 99, perDay: 300, total: 1_000 }), null);
  const base = { caps: { perTribute: 10, perDay: 30, total: 100 }, durationDays: 1, tone: "harsh", acceptNoDecline: true };
  assert.match(rules.normalizeApplication(base, { entryFee: 30 }).error, /入場料/);
  assert.match(rules.normalizeApplication({ ...base, acceptNoDecline: undefined }).error, /請求は断れず/, "the payer must accept that requests cannot be declined");
  assert.match(rules.normalizeApplication({ ...base, acceptNoDecline: "true" }).error, /請求は断れず/);
  assert.deepEqual(rules.normalizeCaps({ perTribute: 10_000, perDay: 30_000, total: 100_000 }), { perTribute: 10_000, perDay: 30_000, total: 100_000 });
  assert.equal(rules.capsNeedGoogle({ perTribute: 3_000 }), true);
  assert.equal(rules.capsNeedGoogle({ perTribute: 1_000 }), false);
  const ok = rules.normalizeApplication({ ...base, walletName: "LINE交換したい財布" }, { entryFee: 10 });
  assert.equal(ok.application.walletName, "名無しの財布", "forbidden wallet names fall back");
  assert.equal(ok.application.allowReportRequests, false);
  assert.equal(ok.application.rankOptIn, false);
  assert.match(rules.normalizeApplication({ ...base, durationDays: 30 }).error, /期間/);
});

test("manager cards need a persona, a disclosure tag and a style but never a gender", () => {
  const result = rules.normalizeManagerCard({ personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 30, sigil: 9 });
  assert.equal(result.card.disclosure, "nekama");
  assert.equal(result.card.sigil, 0);
  assert.equal(Object.hasOwn(result.card, "gender"), false);
  assert.deepEqual([...rules.DISCLOSURES], ["nekama", "as_is", "undisclosed"]);
  assert.match(rules.normalizeManagerCard({ personaName: "", disclosure: "nekama", style: "harsh", entryFee: 0 }).error, /ペルソナ名/);
  assert.match(rules.normalizeManagerCard({ personaName: "ミオ", disclosure: "female", style: "harsh", entryFee: 0 }).error, /中の人の札/);
});

test("manager cards take one of the twelve prepared icons or fall back to the letter sigil", () => {
  const base = { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0 };
  assert.deepEqual([...rules.AVATAR_IDS], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(rules.AVATAR_MAX, 12);
  assert.equal(rules.normalizeManagerCard(base).card.avatar, 0, "no icon keeps the letter sigil");
  for (const avatar of [1, 7, 12, "5"]) assert.equal(rules.normalizeManagerCard({ ...base, avatar }).card.avatar, Number(avatar));
  for (const avatar of [13, -1, 2.5, "https://example.com/a.png", "../avatar-01.webp", null, { id: 3 }]) {
    assert.equal(rules.normalizeManagerCard({ ...base, avatar }).card.avatar, 0, String(avatar));
    assert.equal(rules.normalizeAvatar(avatar), 0, `stored ${String(avatar)}`);
  }
});

test("fees, subsidies, offering splits and honor tiers", () => {
  assert.equal(rules.tributeFee(1), 1);
  assert.equal(rules.tributeFee(10), 1);
  assert.equal(rules.tributeFee(100), 5);
  assert.equal(rules.tributeFee(101), 6);
  assert.equal(rules.subsidyFor(1), 0, "the fee floor of 1 Pay stays");
  assert.equal(rules.subsidyFor(5), 2);
  assert.equal(rules.subsidyFor(50), 10);
  assert.deepEqual(rules.offerSplit(300), { burned: 240, fund: 60 });
  assert.deepEqual(rules.offerSplit(11), { burned: 9, fund: 2 });
  assert.equal(rules.honorTierFor(299), null);
  assert.equal(rules.honorTierFor(300).label, "上納者");
  assert.equal(rules.honorTierFor(1_600).label, "大上納者");
  assert.equal(rules.honorTierFor(5_000).label, "牧場の主");
});

test("raised caps apply from the next JST day and allowances combine all three caps", () => {
  const now = Date.parse("2026-10-05T23:30:00+09:00");
  const contract = {
    caps: { perTribute: 50, perDay: 300, total: 1_000 },
    pendingCaps: { perTribute: 300, perDay: 300, total: 1_000 },
    pendingCapsEffectiveDateKey: rules.nextJstDateKey(now),
    todayKey: rules.jstDateKey(now),
    todayTributed: 280,
    totalTributed: 900,
  };
  assert.equal(rules.nextJstDateKey(now), "2026-10-06");
  assert.deepEqual(rules.effectiveCaps(contract, now).caps.perTribute, 50);
  assert.equal(rules.tributeAllowance(contract, rules.effectiveCaps(contract, now).caps, now), 20);
  const later = Date.parse("2026-10-06T00:00:01+09:00");
  assert.equal(rules.effectiveCaps(contract, later).applied, true);
  assert.equal(rules.tributeAllowance(contract, rules.effectiveCaps(contract, later).caps, later), 100, "today resets but the total cap remains");
  assert.match(rules.capViolation(101, contract, rules.effectiveCaps(contract, later).caps, later), /契約合計の限度額/);
  assert.equal(rules.capViolation(100, contract, rules.effectiveCaps(contract, later).caps, later), "");
});

test("the optional X profile accepts only an x.com profile and stores just the username", () => {
  const accepted = {
    "": "",
    "@mio_sama": "mio_sama",
    "mio_sama": "mio_sama",
    "https://x.com/mio_sama": "mio_sama",
    "x.com/mio_sama/": "mio_sama",
    "https://www.x.com/mio_sama#top": "mio_sama",
    "https://twitter.com/mio_sama?s=21": "mio_sama",
    "ｍｉｏ＿ｓａｍａ": "mio_sama",
  };
  for (const [input, handle] of Object.entries(accepted)) {
    assert.deepEqual(rules.normalizeXProfile(input), { xHandle: handle }, input);
  }
  for (const input of [
    "https://x.com/mio_sama/status/1234567890",
    "https://x.com/home",
    "https://x.com/i/flow/login",
    "https://x.com/",
    "https://x.com.evil.example/mio_sama",
    "https://evil.example/mio_sama",
    "https://x.com:8443/mio_sama",
    "https://user:pass@x.com/mio_sama",
    "javascript:alert(1)",
    "https://x.com/toolong_username_",
    "@mio sama",
  ]) {
    assert.match(rules.normalizeXProfile(input).error, /https:\/\/x\.com\/ユーザー名/, input);
  }
  const card = rules.normalizeManagerCard({ personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0, xProfile: "https://x.com/mio_sama" });
  assert.equal(card.card.xHandle, "mio_sama");
  assert.equal(rules.normalizeManagerCard({ personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0 }).card.xHandle, "");
  assert.match(rules.normalizeManagerCard({ personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0, xProfile: "https://x.com/mio/status/1" }).error, /x\.com/);
  assert.match(rules.normalizeManagerCard({ personaName: "ミオ様", intro: "@mio_sama で探して", disclosure: "nekama", style: "harsh", entryFee: 0 }).error, /SNSのID/, "the intro still cannot carry an SNS ID");
});

test("named fees: sexual names only with the payer's consent, and hidden again when it is withdrawn", () => {
  assert.deepEqual(rules.PURPOSES.map((purpose) => [purpose.id, purpose.label, purpose.sexual]), [
    ["management", "管理費", false],
    ["reward_fee", "ご褒美代", false],
    ["penalty", "罰金", false],
    ["edging", "寸止め料", true],
    ["release", "射精料", true],
    ["leak_penalty", "お漏らし罰金", true],
  ]);
  assert.deepEqual(rules.normalizePurpose(""), { purpose: "" });
  assert.deepEqual(rules.normalizePurpose("penalty"), { purpose: "penalty" });
  assert.match(rules.normalizePurpose("bogus").error, /名目を選び直して/);
  for (const purpose of rules.SEXUAL_PURPOSE_IDS) {
    assert.match(rules.normalizePurpose(purpose).error, /性的な名目を許していません/, purpose);
    assert.deepEqual(rules.normalizePurpose(purpose, { allowSexual: true }), { purpose });
    assert.equal(rules.visiblePurpose(purpose), "", `${purpose} is hidden without consent`);
    assert.equal(rules.visiblePurpose(purpose, { allowSexual: true }), purpose);
  }
  assert.equal(rules.visiblePurpose("<script>"), "");
  const base = { caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true };
  assert.equal(rules.normalizeApplication(base).application.allowSexualPurposes, false, "consent is off unless the payer ticks it");
  assert.equal(rules.normalizeApplication({ ...base, allowSexualPurposes: "true" }).application.allowSexualPurposes, false);
  assert.equal(rules.normalizeApplication({ ...base, allowSexualPurposes: true }).application.allowSexualPurposes, true);
});

test("rewards are short fixed praises chosen per tone and filtered by the payer's NG words", () => {
  assert.deepEqual(rules.rewardsFor("sweet").map((reward) => reward.id), ["gohoubi", "fufu", "iiko", "erai", "arigato"]);
  assert.deepEqual(rules.rewardsFor("normal").map((reward) => reward.id), ["gohoubi", "fufu", "iiko", "erai", "yoku"]);
  assert.deepEqual(rules.rewardsFor("harsh").map((reward) => reward.id), ["gohoubi", "fufu", "zako", "soreppocchi", "tsugi"]);
  assert.deepEqual(rules.rewardsFor("unknown"), rules.rewardsFor("normal"));
  assert.ok(!rules.rewardsFor("harsh", ["ざこ"]).some((reward) => reward.id === "zako"));
  assert.deepEqual(rules.normalizeReward(""), { reward: "" });
  assert.deepEqual(rules.normalizeReward("zako", { tone: "harsh" }), { reward: "zako" });
  assert.match(rules.normalizeReward("zako", { tone: "sweet" }).error, /選べません/);
  assert.match(rules.normalizeReward("zako", { tone: "harsh", ngWords: ["ざこ"] }).error, /選べません/);
  for (const reward of rules.REWARDS) {
    assert.equal(rules.forbiddenReason(reward.label), "", reward.label);
    assert.ok(Array.from(reward.label).length <= 12, reward.label);
  }
  assert.deepEqual([...rules.RECEIVABLE_KINDS], ["request", "silent"]);
});

test("receipt seals come from a fixed list, three per card, and fall back to 受領 on the payer's NG words", () => {
  assert.deepEqual(rules.SEALS.map((seal) => [seal.id, seal.label]), [
    ["kakunin", "確認済"], ["juryo", "受領"], ["yoku", "よくできました"], ["gokaku", "合格"],
    ["zako", "雑魚"], ["youbun", "養分"], ["gokurou", "ご苦労"],
  ]);
  assert.deepEqual(rules.normalizeSeals(["zako", "zako", "bogus", "yoku", "gokaku", "juryo"]), ["zako", "yoku", "gokaku"]);
  assert.deepEqual(rules.normalizeSeals([]), [...rules.DEFAULT_SEALS]);
  assert.deepEqual(rules.normalizeSeals("zako"), [...rules.DEFAULT_SEALS], "free text is never a seal");
  assert.equal(rules.sealFor("zako", { seals: ["yoku", "zako"] }), "zako");
  assert.equal(rules.sealFor("gokaku", { seals: ["yoku", "zako"] }), "yoku", "an unregistered seal becomes the card's first seal");
  assert.equal(rules.sealFor("", { seals: ["zako"] }), "zako");
  assert.equal(rules.sealFor("zako", { seals: ["zako"], ngWords: ["雑魚"] }), rules.FALLBACK_SEAL);
  for (const seal of rules.SEALS) assert.equal(rules.forbiddenReason(seal.label), "", seal.label);
  const base = { personaName: "ミオ様", disclosure: "nekama", style: "harsh", entryFee: 0 };
  const card = rules.normalizeManagerCard(base).card;
  assert.deepEqual(card.seals, [...rules.DEFAULT_SEALS]);
  assert.equal(card.reportConsent, false, "consent to appear in payers' images is never assumed");
  assert.equal(rules.normalizeManagerCard({ ...base, reportConsent: "true" }).card.reportConsent, false);
  assert.equal(rules.normalizeManagerCard({ ...base, reportConsent: true, seals: ["zako"] }).card.reportConsent, true);
});

test("today's word is 30 characters, keeps the forbidden lines, and keeps sexual words off the board", () => {
  assert.equal(rules.LIMITS.todayWord, 30);
  assert.equal(rules.LIMITS.todayWordTtlMs, 24 * 60 * 60 * 1_000);
  assert.equal(rules.LIMITS.todayWordsPerDay, 3);
  assert.deepEqual(rules.normalizeTodayWord("  今夜は機嫌がいい。財布は並びな。 "), { text: "今夜は機嫌がいい。財布は並びな。" });
  assert.equal(rules.normalizeTodayWord("あ".repeat(40)).text.length, 30);
  assert.deepEqual(rules.normalizeTodayWord("イケメン好き"), { text: "イケメン好き" }, "ordinary katakana words pass");
  assert.match(rules.normalizeTodayWord("").error, /入力してください/);
  assert.match(rules.normalizeTodayWord("LINE交換しよ").error, /外部の連絡先/);
  assert.match(rules.normalizeTodayWord("PayPayで払って").error, /外部の決済/);
  assert.match(rules.normalizeTodayWord("会おうよ").error, /会う約束/);
  for (const text of ["寸止め料デー", "射精管理します", "お漏らし罰金", "イかせてあげる", "ｾｯｸｽ", "エロい財布"]) {
    assert.equal(rules.normalizeTodayWord(text).error, rules.BOARD_SEXUAL_MESSAGE, text);
  }
});
