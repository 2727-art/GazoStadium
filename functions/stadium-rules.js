"use strict";

// マイスタジアムの数値の表と、精算・回収・建設の純粋関数。
// 画面の stadium-core.mjs も同じ表と見え方の計算を持つ（stadium-parity.test.js で一致を確かめる）。
// 金額はサーバーの中では 1/1,000 Pay 単位の整数（milli）で持ち、回収するのは整数の Pay だけにする。

const STADIUM_SCHEMA_VERSION = 1;
const FANS_PER_MATCH = 30;
const DAILY_COLLECT_LIMIT = 200;
const MILLI_PER_PAY = 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const JST_OFFSET_MS = 9 * HOUR_MS;

// value の意味: stand は収容人数、shop は入場者1,000人あたりの時給（milli Pay）、vault は貯められる時間。
const FACILITIES = Object.freeze({
  stand: Object.freeze({
    id: "stand",
    label: "スタンド",
    levels: Object.freeze([
      Object.freeze({ level: 1, name: "仮設スタンド", value: 1_000, cost: 0 }),
      Object.freeze({ level: 2, name: "木造スタンド", value: 1_500, cost: 500 }),
      Object.freeze({ level: 3, name: "鉄骨スタンド", value: 2_000, cost: 1_000 }),
      Object.freeze({ level: 4, name: "二層スタンド", value: 3_000, cost: 2_500 }),
      Object.freeze({ level: 5, name: "屋根付きスタンド", value: 4_000, cost: 4_000 }),
      Object.freeze({ level: 6, name: "ドーム", value: 5_000, cost: 6_000 }),
    ]),
  }),
  shop: Object.freeze({
    id: "shop",
    label: "売店",
    levels: Object.freeze([
      Object.freeze({ level: 1, name: "屋台", value: 1_000, cost: 0 }),
      Object.freeze({ level: 2, name: "売店", value: 1_200, cost: 800 }),
      Object.freeze({ level: 3, name: "フードコート", value: 1_400, cost: 2_000 }),
      Object.freeze({ level: 4, name: "ラウンジ", value: 1_600, cost: 4_000 }),
    ]),
  }),
  vault: Object.freeze({
    id: "vault",
    label: "金庫",
    levels: Object.freeze([
      Object.freeze({ level: 1, name: "手提げ金庫", value: 12, cost: 0 }),
      Object.freeze({ level: 2, name: "金庫", value: 16, cost: 500 }),
      Object.freeze({ level: 3, name: "大金庫", value: 20, cost: 1_500 }),
      Object.freeze({ level: 4, name: "金庫室", value: 24, cost: 3_000 }),
    ]),
  }),
});
const FACILITY_IDS = Object.freeze(["stand", "shop", "vault"]);

function integer(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function jstDateKey(timestamp) {
  const shifted = new Date(Number(timestamp) + JST_OFFSET_MS);
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : "";
}

function isFacilityId(value) {
  return typeof value === "string" && FACILITY_IDS.includes(value);
}

function maxLevel(facilityId) {
  return FACILITIES[facilityId].levels.length;
}

function facilityRow(facilityId, level) {
  const levels = FACILITIES[facilityId].levels;
  return levels[integer(level, 1, levels.length, 1) - 1];
}

function normalizeFacilities(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(FACILITY_IDS.map((id) => [id, integer(source[id], 1, maxLevel(id), 1)]));
}

// 観客数 =（いまの正式完走数 − 開業した時の正式完走数）× 30人。差が負なら0人。
function fansFor(totalMatches, baselineMatches) {
  const total = integer(totalMatches, 0, Number.MAX_SAFE_INTEGER, 0);
  const baseline = integer(baselineMatches, 0, Number.MAX_SAFE_INTEGER, 0);
  return Math.max(0, total - baseline) * FANS_PER_MATCH;
}

function seatedFor(fans, facilities) {
  return Math.min(integer(fans, 0, Number.MAX_SAFE_INTEGER, 0), facilityRow("stand", facilities.stand).value);
}

function rateMilliPerHour(fans, facilities) {
  return Math.floor((seatedFor(fans, facilities) * facilityRow("shop", facilities.shop).value) / 1_000);
}

function vaultCapMilli(fans, facilities) {
  return rateMilliPerHour(fans, facilities) * facilityRow("vault", facilities.vault).value;
}

function createStadiumRecord({ now, baselineMatches }) {
  const timestamp = integer(now, 1, Number.MAX_SAFE_INTEGER, 1);
  return {
    schemaVersion: STADIUM_SCHEMA_VERSION,
    openedAt: timestamp,
    baselineMatches: integer(baselineMatches, 0, Number.MAX_SAFE_INTEGER, 0),
    facilities: normalizeFacilities(null),
    settledAt: timestamp,
    fansAtSettle: 0,
    lastSeenFans: 0,
    vaultMilli: 0,
    daily: { dateKey: jstDateKey(timestamp), collected: 0 },
    collectSeq: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeStadiumRecord(value) {
  const source = value && typeof value === "object" ? value : {};
  const openedAt = integer(source.openedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  const daily = source.daily && typeof source.daily === "object" ? source.daily : {};
  return {
    schemaVersion: STADIUM_SCHEMA_VERSION,
    openedAt,
    baselineMatches: integer(source.baselineMatches, 0, Number.MAX_SAFE_INTEGER, 0),
    facilities: normalizeFacilities(source.facilities),
    settledAt: integer(source.settledAt, 0, Number.MAX_SAFE_INTEGER, openedAt),
    fansAtSettle: integer(source.fansAtSettle, 0, Number.MAX_SAFE_INTEGER, 0),
    lastSeenFans: integer(source.lastSeenFans, 0, Number.MAX_SAFE_INTEGER, 0),
    vaultMilli: integer(source.vaultMilli, 0, Number.MAX_SAFE_INTEGER, 0),
    daily: {
      dateKey: /^\d{4}-\d{2}-\d{2}$/.test(String(daily.dateKey || "")) ? String(daily.dateKey) : "",
      collected: integer(daily.collected, 0, DAILY_COLLECT_LIMIT, 0),
    },
    collectSeq: integer(source.collectSeq, 0, Number.MAX_SAFE_INTEGER, 0),
    createdAt: integer(source.createdAt, 0, Number.MAX_SAFE_INTEGER, openedAt),
    updatedAt: integer(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, openedAt),
  };
}

// 精算: 最後に精算した時の観客数と施設で、ここまでの売上を金庫へ足す。
// 精算の間に増えた観客は、次の区間から入場する（さかのぼって売上にしない）。
// 金庫が上限以上なら中身を削らず、そのまま止める。
function settleStadium(value, { now, fans }) {
  const record = normalizeStadiumRecord(value);
  const timestamp = integer(now, 0, Number.MAX_SAFE_INTEGER, 0);
  const elapsed = Math.max(0, timestamp - record.settledAt);
  const rate = rateMilliPerHour(record.fansAtSettle, record.facilities);
  const cap = vaultCapMilli(record.fansAtSettle, record.facilities);
  let accruedMilli = 0;
  if (record.vaultMilli < cap && rate > 0 && elapsed > 0) {
    const next = Math.min(cap, record.vaultMilli + Math.floor((rate * elapsed) / HOUR_MS));
    accruedMilli = next - record.vaultMilli;
    record.vaultMilli = next;
  }
  record.settledAt = Math.max(record.settledAt, timestamp);
  record.fansAtSettle = integer(fans, 0, Number.MAX_SAFE_INTEGER, 0);
  return { record, accruedMilli };
}

function dailyCollected(record, dateKey) {
  return record.daily.dateKey === dateKey ? record.daily.collected : 0;
}

// 回収額 = min(金庫の整数 Pay, 今日の残り回収枠, ウォレットの受取余地)。回収しきれない分は金庫に残る。
function collectStadium(value, { now, fans, walletCapacity }) {
  const { record } = settleStadium(value, { now, fans });
  const dateKey = jstDateKey(now);
  const collectedToday = dailyCollected(record, dateKey);
  const available = Math.floor(record.vaultMilli / MILLI_PER_PAY);
  const dailyRemaining = Math.max(0, DAILY_COLLECT_LIMIT - collectedToday);
  const capacity = integer(walletCapacity, 0, Number.MAX_SAFE_INTEGER, 0);
  const amount = Math.min(available, dailyRemaining, capacity);
  let reason = "";
  if (amount <= 0) {
    if (available <= 0) reason = "empty";
    else if (dailyRemaining <= 0) reason = "daily_limit";
    else reason = "wallet_full";
  }
  record.daily = { dateKey, collected: collectedToday + Math.max(0, amount) };
  if (amount > 0) {
    record.vaultMilli -= amount * MILLI_PER_PAY;
    record.collectSeq += 1;
  }
  return { record, amount: Math.max(0, amount), reason, dateKey };
}

// 建設: 建てる前の施設で精算してから段を上げる。同じ段を2回送った時は成功として扱う（冪等）。
function buildStadium(value, { now, fans, facility, level, balance }) {
  if (!isFacilityId(facility)) return { error: "facility" };
  const { record } = settleStadium(value, { now, fans });
  const current = record.facilities[facility];
  const target = Number(level);
  if (!Number.isSafeInteger(target) || target < 2 || target > maxLevel(facility)) return { error: "level", record };
  if (target === current) return { record, replayed: true, cost: 0 };
  if (target !== current + 1) return { error: "order", record };
  const cost = facilityRow(facility, target).cost;
  const wallet = integer(balance, 0, Number.MAX_SAFE_INTEGER, 0);
  if (wallet < cost) return { error: "balance", record, cost, shortfall: cost - wallet };
  record.facilities = { ...record.facilities, [facility]: target };
  return { record, cost, replayed: false };
}

function facilityView(facilityId, level, fans, facilities) {
  const definition = FACILITIES[facilityId];
  const row = facilityRow(facilityId, level);
  const next = level < definition.levels.length ? facilityRow(facilityId, level + 1) : null;
  let nextRateMilliPerHour = null;
  let nextCapMilli = null;
  if (next) {
    const upgraded = { ...facilities, [facilityId]: next.level };
    nextRateMilliPerHour = rateMilliPerHour(fans, upgraded);
    nextCapMilli = vaultCapMilli(fans, upgraded);
  }
  return {
    id: facilityId,
    label: definition.label,
    level: row.level,
    maxLevel: definition.levels.length,
    name: row.name,
    value: row.value,
    next: next
      ? {
        level: next.level,
        name: next.name,
        value: next.value,
        cost: next.cost,
        rateMilliPerHour: nextRateMilliPerHour,
        capMilli: nextCapMilli,
      }
      : null,
  };
}

// 画面に返す状態。now の時点で精算した記録から作る。
function stadiumView(value, { now, fans, previousSeenFans = null, walletBalance = null }) {
  const record = normalizeStadiumRecord(value);
  const fanCount = integer(fans, 0, Number.MAX_SAFE_INTEGER, 0);
  const facilities = record.facilities;
  const capacity = facilityRow("stand", facilities.stand).value;
  const seated = seatedFor(fanCount, facilities);
  const rate = rateMilliPerHour(fanCount, facilities);
  const cap = vaultCapMilli(fanCount, facilities);
  const dateKey = jstDateKey(now);
  const collected = dailyCollected(record, dateKey);
  const seen = previousSeenFans === null ? record.lastSeenFans : integer(previousSeenFans, 0, Number.MAX_SAFE_INTEGER, 0);
  return {
    opened: true,
    openedAt: record.openedAt,
    fansPerMatch: FANS_PER_MATCH,
    fans: fanCount,
    seated,
    waiting: Math.max(0, fanCount - capacity),
    capacity,
    matchesToFull: fanCount >= capacity ? 0 : Math.ceil((capacity - fanCount) / FANS_PER_MATCH),
    newFans: Math.max(0, fanCount - seen),
    rateMilliPerHour: rate,
    vault: {
      milli: record.vaultMilli,
      pay: Math.floor(record.vaultMilli / MILLI_PER_PAY),
      capMilli: cap,
      capPay: Math.floor(cap / MILLI_PER_PAY),
      hours: facilityRow("vault", facilities.vault).value,
      full: cap > 0 && record.vaultMilli >= cap,
      fullInMs: rate > 0 && record.vaultMilli < cap ? Math.ceil(((cap - record.vaultMilli) * HOUR_MS) / rate) : 0,
    },
    daily: {
      dateKey,
      collected,
      limit: DAILY_COLLECT_LIMIT,
      remaining: Math.max(0, DAILY_COLLECT_LIMIT - collected),
    },
    facilities: FACILITY_IDS.map((id) => facilityView(id, facilities[id], fanCount, facilities)),
    walletBalance: walletBalance === null ? null : integer(walletBalance, 0, Number.MAX_SAFE_INTEGER, 0),
    asOf: integer(now, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

module.exports = Object.freeze({
  DAILY_COLLECT_LIMIT,
  FACILITIES,
  FACILITY_IDS,
  FANS_PER_MATCH,
  HOUR_MS,
  MILLI_PER_PAY,
  STADIUM_SCHEMA_VERSION,
  buildStadium,
  collectStadium,
  createStadiumRecord,
  facilityRow,
  fansFor,
  isFacilityId,
  jstDateKey,
  normalizeFacilities,
  normalizeStadiumRecord,
  rateMilliPerHour,
  seatedFor,
  settleStadium,
  stadiumView,
  vaultCapMilli,
});
