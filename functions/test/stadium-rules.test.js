"use strict";

// マイスタジアムの数値の表と、精算・回収・建設の純粋関数。
const assert = require("node:assert/strict");
const test = require("node:test");
const rules = require("../stadium-rules");

const {
  DAILY_COLLECT_LIMIT,
  FACILITIES,
  FANS_PER_MATCH,
  HOUR_MS,
  buildStadium,
  collectStadium,
  createStadiumRecord,
  fansFor,
  jstDateKey,
  rateMilliPerHour,
  settleStadium,
  stadiumView,
  vaultCapMilli,
} = rules;

const OPENED = Date.parse("2026-10-20T09:00:00+09:00");

function opened(overrides = {}) {
  return { ...createStadiumRecord({ now: OPENED, baselineMatches: 12 }), ...overrides };
}

test("the tables match the design document's initial values", () => {
  assert.equal(FANS_PER_MATCH, 30);
  assert.equal(DAILY_COLLECT_LIMIT, 200);
  assert.deepEqual(FACILITIES.stand.levels.map((row) => [row.value, row.cost]), [
    [1_000, 0], [1_500, 500], [2_000, 1_000], [3_000, 2_500], [4_000, 4_000], [5_000, 6_000],
  ]);
  assert.deepEqual(FACILITIES.shop.levels.map((row) => [row.value, row.cost]), [
    [1_000, 0], [1_200, 800], [1_400, 2_000], [1_600, 4_000],
  ]);
  assert.deepEqual(FACILITIES.vault.levels.map((row) => [row.value, row.cost]), [
    [12, 0], [16, 500], [20, 1_500], [24, 3_000],
  ]);
  const total = Object.values(FACILITIES)
    .flatMap((facility) => facility.levels)
    .reduce((sum, row) => sum + row.cost, 0);
  assert.equal(total, 25_800);
  const maxed = { stand: 6, shop: 4, vault: 4 };
  assert.equal(rateMilliPerHour(5_000, maxed), 8_000, "全部建てて満席なら 8 Pay/時");
  assert.equal(rateMilliPerHour(1_000, { stand: 1, shop: 1, vault: 1 }), 1_000, "始めたばかりの満席なら 1 Pay/時");
  assert.ok(rateMilliPerHour(5_000, maxed) * 24 < DAILY_COLLECT_LIMIT * 1_000, "1日の売上は回収枠に届かない");
});

test("fans count only completions after the opening, 30 per completion, never below zero", () => {
  assert.equal(fansFor(12, 12), 0);
  assert.equal(fansFor(13, 12), 30);
  assert.equal(fansFor(46, 12), 1_020);
  assert.equal(fansFor(5, 12), 0, "開業した時より少なく読めても負にしない");
  assert.equal(fansFor(undefined, 0), 0);
});

test("a new record starts at zero fans with every facility at Lv1 and an empty vault", () => {
  const record = createStadiumRecord({ now: OPENED, baselineMatches: 40 });
  assert.equal(record.baselineMatches, 40);
  assert.deepEqual(record.facilities, { stand: 1, shop: 1, vault: 1 });
  assert.equal(record.vaultMilli, 0);
  assert.equal(record.fansAtSettle, 0);
  assert.equal(record.daily.dateKey, jstDateKey(OPENED));
});

test("settling accrues at the rate of the fans seen at the last settle and stops at the vault cap", () => {
  const record = opened({ fansAtSettle: 600 });
  const after3h = settleStadium(record, { now: OPENED + 3 * HOUR_MS, fans: 600 });
  assert.equal(after3h.record.vaultMilli, 1_800, "600人 × 1.0 Pay/1,000人 × 3時間 = 1.8 Pay");
  assert.equal(after3h.record.settledAt, OPENED + 3 * HOUR_MS);

  // 精算の間に観客が増えても、その区間はさかのぼって売上にしない。
  const grown = settleStadium(record, { now: OPENED + 3 * HOUR_MS, fans: 900 });
  assert.equal(grown.record.vaultMilli, 1_800);
  assert.equal(grown.record.fansAtSettle, 900);
  const next = settleStadium(grown.record, { now: OPENED + 4 * HOUR_MS, fans: 900 });
  assert.equal(next.record.vaultMilli, 1_800 + 900, "次の区間からは900人で計算する");

  const full = settleStadium(record, { now: OPENED + 40 * HOUR_MS, fans: 600 });
  assert.equal(full.record.vaultMilli, vaultCapMilli(600, record.facilities), "12時間分で止まる");
  assert.equal(full.record.vaultMilli, 7_200);
});

test("settling never removes money already in the vault and ignores clocks that run backwards", () => {
  const over = opened({ fansAtSettle: 300, vaultMilli: 50_000 });
  const settled = settleStadium(over, { now: OPENED + 5 * HOUR_MS, fans: 300 });
  assert.equal(settled.record.vaultMilli, 50_000);
  const backwards = settleStadium(opened({ fansAtSettle: 600, settledAt: OPENED + HOUR_MS }), { now: OPENED, fans: 600 });
  assert.equal(backwards.record.vaultMilli, 0);
  assert.equal(backwards.record.settledAt, OPENED + HOUR_MS, "精算の時刻を戻さない");
});

test("collecting pays whole Pay only and keeps the fraction in the vault", () => {
  const record = opened({ fansAtSettle: 700 });
  const result = collectStadium(record, { now: OPENED + 2 * HOUR_MS, fans: 700, walletCapacity: 1_000_000 });
  assert.equal(result.amount, 1, "1.4 Pay のうち 1 Pay");
  assert.equal(result.record.vaultMilli, 400);
  assert.equal(result.record.collectSeq, 1);
  assert.equal(result.record.daily.collected, 1);
  assert.equal(result.reason, "");
});

test("collecting stops at the daily limit and the wallet capacity, leaving the rest in the vault", () => {
  const rich = opened({ fansAtSettle: 0, vaultMilli: 250_000 });
  const capped = collectStadium(rich, { now: OPENED, fans: 0, walletCapacity: 1_000_000 });
  assert.equal(capped.amount, 200);
  assert.equal(capped.record.vaultMilli, 50_000);
  const again = collectStadium(capped.record, { now: OPENED + 60_000, fans: 0, walletCapacity: 1_000_000 });
  assert.equal(again.amount, 0);
  assert.equal(again.reason, "daily_limit");
  const nextDay = collectStadium(capped.record, { now: OPENED + 24 * HOUR_MS, fans: 0, walletCapacity: 1_000_000 });
  assert.equal(nextDay.amount, 50, "日本時間の翌日は枠が戻る");
  assert.equal(nextDay.record.daily.dateKey, jstDateKey(OPENED + 24 * HOUR_MS));

  const walletFull = collectStadium(opened({ vaultMilli: 30_000 }), { now: OPENED, fans: 0, walletCapacity: 12 });
  assert.equal(walletFull.amount, 12);
  assert.equal(walletFull.record.vaultMilli, 18_000);
  const noRoom = collectStadium(opened({ vaultMilli: 30_000 }), { now: OPENED, fans: 0, walletCapacity: 0 });
  assert.equal(noRoom.reason, "wallet_full");
  assert.equal(noRoom.record.collectSeq, 0);
  const empty = collectStadium(opened(), { now: OPENED, fans: 0, walletCapacity: 100 });
  assert.equal(empty.reason, "empty");
});

test("the JST day boundary is midnight in Japan", () => {
  assert.equal(jstDateKey(Date.parse("2026-10-20T23:59:59+09:00")), "2026-10-20");
  assert.equal(jstDateKey(Date.parse("2026-10-21T00:00:00+09:00")), "2026-10-21");
});

test("building goes one level at a time, replays the same level, and needs the balance", () => {
  const record = opened({ fansAtSettle: 1_200 });
  const built = buildStadium(record, { now: OPENED + HOUR_MS, fans: 1_200, facility: "stand", level: 2, balance: 600 });
  assert.equal(built.cost, 500);
  assert.equal(built.record.facilities.stand, 2);
  assert.equal(built.record.vaultMilli, 1_000, "建てる前の施設（1,000人）で精算してから段を上げる");

  const replay = buildStadium(built.record, { now: OPENED + HOUR_MS, fans: 1_200, facility: "stand", level: 2, balance: 0 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.cost, 0);

  assert.equal(buildStadium(record, { now: OPENED, fans: 0, facility: "stand", level: 3, balance: 99_999 }).error, "order");
  assert.equal(buildStadium(record, { now: OPENED, fans: 0, facility: "stand", level: 7, balance: 99_999 }).error, "level");
  assert.equal(buildStadium(record, { now: OPENED, fans: 0, facility: "stand", level: 1, balance: 99_999 }).error, "level");
  assert.equal(buildStadium(record, { now: OPENED, fans: 0, facility: "gate", level: 2, balance: 99_999 }).error, "facility");
  const poor = buildStadium(record, { now: OPENED, fans: 0, facility: "shop", level: 2, balance: 300 });
  assert.equal(poor.error, "balance");
  assert.equal(poor.shortfall, 500);
});

test("the view reports seats, the queue outside, the matches to a full house and the next level's effect", () => {
  const view = stadiumView(opened({ facilities: { stand: 2, shop: 1, vault: 1 }, lastSeenFans: 1_500 }), {
    now: OPENED,
    fans: 2_100,
    walletBalance: 1_234,
  });
  assert.equal(view.capacity, 1_500);
  assert.equal(view.seated, 1_500);
  assert.equal(view.waiting, 600);
  assert.equal(view.matchesToFull, 0);
  assert.equal(view.newFans, 600);
  assert.equal(view.rateMilliPerHour, 1_500);
  assert.equal(view.walletBalance, 1_234);
  const stand = view.facilities.find((facility) => facility.id === "stand");
  assert.equal(stand.next.level, 3);
  assert.equal(stand.next.rateMilliPerHour, 2_000);
  const vault = view.facilities.find((facility) => facility.id === "vault");
  assert.equal(vault.next.capMilli, 1_500 * 16);

  const sparse = stadiumView(opened(), { now: OPENED, fans: 90 });
  assert.equal(sparse.matchesToFull, 31, "残り910人 ÷ 30人 → 31回");
  assert.equal(sparse.vault.fullInMs, 12 * HOUR_MS);
});
