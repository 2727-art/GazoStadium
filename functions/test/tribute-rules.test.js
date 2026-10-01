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
  const base = { caps: { perTribute: 10, perDay: 30, total: 100 }, durationDays: 1, tone: "harsh" };
  assert.match(rules.normalizeApplication(base, { entryFee: 30 }).error, /入場料/);
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
  assert.equal(rules.honorTierFor(5_000).label, "界隈の主");
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
  assert.match(rules.capViolation(101, contract, rules.effectiveCaps(contract, later).caps, later), /合計上限/);
  assert.equal(rules.capViolation(100, contract, rules.effectiveCaps(contract, later).caps, later), "");
});
