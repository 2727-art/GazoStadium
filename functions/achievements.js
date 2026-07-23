"use strict";

const BATTLE_MODES = Object.freeze(["solo", "strategy", "team", "royale"]);
const VALID_SCOPES = new Set(["battle", "market"]);
const MAX_SHOWCASE = 3;

function series({
  scope,
  category,
  family,
  familyLabel,
  icon,
  thresholds,
  names,
  description,
  condition,
  autoPublic = true,
}) {
  return thresholds.map((target, index) => Object.freeze({
    id: `${family}_${target}`,
    scope,
    category,
    family,
    familyLabel,
    icon,
    level: index + 1,
    target,
    name: names[index],
    description: description(target),
    hint: `${familyLabel}を続けると解除`,
    autoPublic,
    condition: condition(target),
  }));
}

const battleDefinitions = [
  ...series({
    scope: "battle",
    category: "battle_record",
    family: "battle_total",
    familyLabel: "通算対戦",
    icon: "▣",
    thresholds: [1, 10, 30, 100, 300, 1000, 3000],
    names: ["開幕の一枚", "いつもの観客席", "貼り合い常連", "画像フォルダの住人", "帰る場所はここ", "千本貼り", "スタジアムの一部"],
    description: (target) => `検証済みオンライン対戦を通算${target}試合完走した`,
    condition: (target) => ({ type: "battle_stat", key: "totalMatches", target }),
  }),
  ...[
    ["solo", "通常型1on1", "◆", ["通常型の一歩", "スタンダード見習い", "通常型の常連", "五十戦の貼り手", "通常型百景", "スタンダードの主", "千試合の定番"]],
    ["strategy", "戦略型1on1", "◇", ["弱点捜査開始", "読み合い見習い", "読み合いの常連", "五十の読み筋", "読み合い百景", "戦略型の主", "千回の読み合い"]],
    ["team", "2on2", "∞", ["相棒募集中", "連携見習い", "チームの常連", "五十の共闘", "連携百景", "2on2の主", "千回の共闘"]],
    ["royale", "バトルロワイヤル", "♛", ["四人寄れば", "混戦見習い", "混戦の常連", "五十の乱戦", "乱戦百景", "BRの主", "千回の混戦"]],
  ].flatMap(([mode, label, icon, names]) => series({
    scope: "battle",
    category: "battle_modes",
    family: `battle_${mode}`,
    familyLabel: label,
    icon,
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names,
    description: (target) => `${label}を${target}試合完走した`,
    condition: (target) => ({ type: "battle_mode", mode, target }),
  })),
  Object.freeze({
    id: "battle_variety_2",
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety",
    familyLabel: "モード回遊",
    icon: "✦",
    level: 1,
    target: 2,
    name: "二つの入口",
    description: "2種類のオンライン対戦モードを完走した",
    hint: "いつもと違う入口へ行くと解除",
    autoPublic: true,
    condition: { type: "distinct_battle_modes", target: 2 },
  }),
  ...series({
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety",
    familyLabel: "モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["四つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `4種類のオンライン対戦モードをそれぞれ${target}試合完走した`,
    condition: (target) => ({ type: "minimum_battle_modes", target }),
  }).map((definition, index) => Object.freeze({
    ...definition,
    id: `battle_variety_all_${definition.target}`,
    level: index + 2,
  })),
  ...series({
    scope: "battle",
    category: "battle_loss",
    family: "battle_losses",
    familyLabel: "通算敗北",
    icon: "☂",
    thresholds: [1, 10, 30, 100, 300, 1000],
    names: ["黒星デビュー", "負けても貼る", "敗北を知る者", "百敗将軍", "負けの向こう側", "千敗の景色"],
    description: (target) => `オンライン対戦で通算${target}敗を記録した`,
    condition: (target) => ({ type: "battle_stat", key: "losses", target }),
    autoPublic: false,
  }),
  ...series({
    scope: "battle",
    category: "battle_loss",
    family: "battle_loss_streak",
    familyLabel: "連敗",
    icon: "≋",
    thresholds: [3, 5, 8, 12],
    names: ["三連敗、通常運転", "沼もまたスタジアム", "出口はどこ", "それでも貼る"],
    description: (target) => `${target}連敗しても対戦を続けた`,
    condition: (target) => ({ type: "battle_stat", key: "bestLossStreak", target }),
    autoPublic: false,
  }),
  ...series({
    scope: "battle",
    category: "battle_days",
    family: "battle_days",
    familyLabel: "対戦日数",
    icon: "◷",
    thresholds: [3, 7, 14, 30, 60, 100],
    names: ["三日通い", "七日分の一枚", "二週間の顔", "月の常連", "二か月の住人", "百日の貼り手"],
    description: (target) => `異なる${target}日でオンライン対戦を完走した`,
    condition: (target) => ({ type: "battle_stat", key: "playDays", target }),
  }),
];

const marketDefinitions = [
  ...series({
    scope: "market",
    category: "market_roles",
    family: "market_seller",
    familyLabel: "売り手成約",
    icon: "◆",
    thresholds: [1, 3, 10, 30, 100, 300],
    names: ["成約第一号", "駆け出しセラー", "推しの営業担当", "市場の顔役", "百戦錬磨の売り手", "価値をつくる人"],
    description: (target) => `ランキング集計対象の売買を売り手として${target}件成立させた`,
    condition: (target) => ({ type: "market_stat", key: "salesCount", target }),
  }),
  ...series({
    scope: "market",
    category: "market_roles",
    family: "market_buyer",
    familyLabel: "買い手購入",
    icon: "◈",
    thresholds: [1, 3, 10, 30, 100, 300],
    names: ["はじめての推し買い", "目利き見習い", "推し値コレクター", "市場の目利き", "百の価値を見た者", "推し値の証人"],
    description: (target) => `ランキング集計対象の売買を買い手として${target}件成立させた`,
    condition: (target) => ({ type: "market_stat", key: "purchases", target }),
  }),
  ...series({
    scope: "market",
    category: "market_balance",
    family: "market_both",
    familyLabel: "両役割",
    icon: "⇄",
    thresholds: [1, 3, 10, 30, 100],
    names: ["市場の両面", "売って買って", "VALUE TRADER", "市場を回す人", "推し値市場の住人"],
    description: (target) => `売却と購入をそれぞれ${target}件成立させた`,
    condition: (target) => ({ type: "market_both", target }),
  }),
  ...series({
    scope: "market",
    category: "market_community",
    family: "market_days",
    familyLabel: "市場利用日数",
    icon: "▦",
    thresholds: [2, 7, 30, 100],
    names: ["また来た", "七日市場", "月の常連商人", "商いは続く"],
    description: (target) => `異なる${target}日でランキング集計対象の売買を成立させた`,
    condition: (target) => ({ type: "market_stat", key: "marketDays", target }),
  }),
  ...series({
    scope: "market",
    category: "market_community",
    family: "market_partners",
    familyLabel: "取引相手",
    icon: "◎",
    thresholds: [3, 10, 30, 100],
    names: ["顔見知り", "市場に知り合いが増えた", "取引網", "スタジアム商会"],
    description: (target) => `${target}人の異なる相手とランキング集計対象の売買を成立させた`,
    condition: (target) => ({ type: "market_stat", key: "uniqueCounterparties", target }),
  }),
  ...[
    ["market_first_turn", "即決", "第1営業ターンで売買が成立した", "✧", "firstTurn"],
    ["market_extended", "もう1ターンの価値", "追加検討を経て売買が成立した", "＋", "extended"],
    ["market_third_turn", "三度目の正直", "第3営業ターンで売買が成立した", "Ⅲ", "thirdTurn"],
    ["market_both_roles_day", "一日二役", "同じ日に売り手と買い手の両方で成立取引を行った", "☀", "bothRolesDay"],
    ["market_role_switch", "立場を替えて", "前回とは反対の役割で成立取引を行った", "↻", "roleSwitch"],
  ].map(([id, name, description, icon, signal]) => Object.freeze({
    id,
    scope: "market",
    category: "market_discovery",
    family: id,
    familyLabel: "市場の発見",
    icon,
    level: 1,
    target: 1,
    name,
    description,
    hint: "市場で少し変わった取引をすると解除",
    autoPublic: true,
    condition: { type: "market_signal", signal },
  })),
];

const ACHIEVEMENT_DEFINITIONS = Object.freeze([...battleDefinitions, ...marketDefinitions]);
const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition]));

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function count(value, maximum = 1_000_000_000) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(maximum, Math.max(0, number)) : 0;
}

function emptyBattleStats() {
  return {
    totalMatches: 0,
    losses: 0,
    currentLossStreak: 0,
    bestLossStreak: 0,
    modeMatches: Object.fromEntries(BATTLE_MODES.map((mode) => [mode, 0])),
    playDays: 0,
    lastPlayDateKey: "",
  };
}

function normalizeBattleStats(value) {
  const stats = emptyBattleStats();
  stats.totalMatches = count(value?.totalMatches);
  stats.losses = count(value?.losses, stats.totalMatches);
  stats.currentLossStreak = count(value?.currentLossStreak, stats.totalMatches);
  stats.bestLossStreak = Math.max(stats.currentLossStreak, count(value?.bestLossStreak, stats.totalMatches));
  stats.modeMatches = Object.fromEntries(BATTLE_MODES.map((mode) => [mode, count(value?.modeMatches?.[mode], stats.totalMatches)]));
  stats.playDays = count(value?.playDays, stats.totalMatches);
  stats.lastPlayDateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(value?.lastPlayDateKey || ""))
    ? String(value.lastPlayDateKey)
    : "";
  return stats;
}

function deriveBattleStatsFromPeriods(periodRewards) {
  const periods = objectValue(periodRewards);
  const monthly = Object.values(objectValue(periods.monthly));
  const daily = Object.entries(objectValue(periods.daily))
    .filter(([key, record]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number(record?.matches || 0) > 0);
  const records = monthly.length ? monthly : daily.map(([, record]) => record);
  const stats = emptyBattleStats();
  records.forEach((record) => {
    const matches = count(record?.matches);
    stats.totalMatches += matches;
    stats.losses += count(record?.losses, matches);
    BATTLE_MODES.forEach((mode) => {
      stats.modeMatches[mode] += count(record?.modeMatches?.[mode], matches);
    });
  });
  stats.playDays = daily.length;
  stats.lastPlayDateKey = daily.map(([key]) => key).sort().at(-1) || "";
  return normalizeBattleStats(stats);
}

function addBattleMatch(value, mode, outcome, dateKey) {
  const stats = normalizeBattleStats(value);
  if (!BATTLE_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) return stats;
  stats.totalMatches += 1;
  stats.modeMatches[mode] += 1;
  if (outcome === "loss") {
    stats.losses += 1;
    stats.currentLossStreak += 1;
    stats.bestLossStreak = Math.max(stats.bestLossStreak, stats.currentLossStreak);
  } else {
    stats.currentLossStreak = 0;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || "")) && stats.lastPlayDateKey !== dateKey) {
    stats.playDays += 1;
    stats.lastPlayDateKey = dateKey;
  }
  return normalizeBattleStats(stats);
}

function normalizeMarketStats(value) {
  const roleDay = /^\d{4}-\d{2}-\d{2}$/.test(String(value?.marketRoleDay?.dateKey || ""))
    ? {
      dateKey: String(value.marketRoleDay.dateKey),
      seller: value.marketRoleDay.seller === true,
      buyer: value.marketRoleDay.buyer === true,
    }
    : { dateKey: "", seller: false, buyer: false };
  return {
    salesCount: count(value?.salesCount),
    purchases: count(value?.purchases),
    marketDays: count(value?.marketDays),
    lastMarketDateKey: /^\d{4}-\d{2}-\d{2}$/.test(String(value?.lastMarketDateKey || ""))
      ? String(value.lastMarketDateKey)
      : "",
    uniqueCounterparties: count(value?.uniqueCounterparties),
    lastRankedRole: ["seller", "buyer"].includes(value?.lastRankedRole) ? value.lastRankedRole : "",
    marketRoleDay: roleDay,
  };
}

function addMarketTransaction(value, role, dateKey, { newCounterparty = false } = {}) {
  const stats = normalizeMarketStats(value);
  if (!["seller", "buyer"].includes(role)) return stats;
  if (stats.lastMarketDateKey !== dateKey) {
    stats.marketDays += 1;
    stats.lastMarketDateKey = dateKey;
  }
  if (newCounterparty) stats.uniqueCounterparties += 1;
  if (stats.marketRoleDay.dateKey !== dateKey) {
    stats.marketRoleDay = { dateKey, seller: false, buyer: false };
  }
  stats.marketRoleDay[role] = true;
  stats.lastRankedRole = role;
  return normalizeMarketStats({ ...value, ...stats });
}

function achievementConditionMet(definition, battleStats, marketStats, signals = {}) {
  const condition = definition.condition;
  if (condition.type === "battle_stat") return count(battleStats?.[condition.key]) >= condition.target;
  if (condition.type === "battle_mode") return count(battleStats?.modeMatches?.[condition.mode]) >= condition.target;
  if (condition.type === "distinct_battle_modes") {
    return BATTLE_MODES.filter((mode) => count(battleStats?.modeMatches?.[mode]) > 0).length >= condition.target;
  }
  if (condition.type === "minimum_battle_modes") {
    return BATTLE_MODES.every((mode) => count(battleStats?.modeMatches?.[mode]) >= condition.target);
  }
  if (condition.type === "market_stat") return count(marketStats?.[condition.key]) >= condition.target;
  if (condition.type === "market_both") {
    return count(marketStats?.salesCount) >= condition.target && count(marketStats?.purchases) >= condition.target;
  }
  if (condition.type === "market_signal") return signals?.[condition.signal] === true;
  return false;
}

function eligibleAchievementIds({ battleStats, marketStats, signals = {}, scope = "" } = {}) {
  return ACHIEVEMENT_DEFINITIONS
    .filter((definition) => (!scope || definition.scope === scope)
      && achievementConditionMet(definition, battleStats, marketStats, signals))
    .map((definition) => definition.id);
}

function normalizeAchievementProfile(value) {
  const unlocked = {};
  for (const [id, timestamp] of Object.entries(objectValue(value?.unlocked))) {
    if (!ACHIEVEMENT_BY_ID.has(id)) continue;
    const number = Number(timestamp);
    if (Number.isFinite(number) && number > 0) unlocked[id] = number;
  }
  const pendingUnlocks = {};
  for (const [id, timestamp] of Object.entries(objectValue(value?.pendingUnlocks))) {
    if (!unlocked[id]) continue;
    const number = Number(timestamp);
    pendingUnlocks[id] = Number.isFinite(number) && number > 0 ? number : unlocked[id];
  }
  return {
    schemaVersion: 1,
    unlocked,
    pendingUnlocks,
    customShowcase: canonicalShowcase(value?.customShowcase, unlocked),
    initializedAt: Number(value?.initializedAt || Date.now()),
    updatedAt: Number(value?.updatedAt || Date.now()),
  };
}

function sanitizeAchievementIds(value, { unlocked = null, maximum = MAX_SHOWCASE } = {}) {
  const candidates = Array.isArray(value)
    ? value
    : Object.entries(objectValue(value)).filter(([, enabled]) => enabled === true).map(([id]) => id);
  const result = [];
  for (const candidate of candidates) {
    const id = String(candidate || "");
    if (!ACHIEVEMENT_BY_ID.has(id) || result.includes(id) || (unlocked && !unlocked[id])) continue;
    result.push(id);
    if (result.length >= maximum) break;
  }
  return result;
}

function canonicalShowcase(value, unlocked) {
  const result = [];
  for (const id of sanitizeAchievementIds(value, { unlocked })) {
    const definition = ACHIEVEMENT_BY_ID.get(id);
    const highest = ACHIEVEMENT_DEFINITIONS
      .filter((candidate) => candidate.family === definition.family && unlocked[candidate.id])
      .sort((first, second) => second.level - first.level)[0] || definition;
    if (!result.includes(highest.id)) result.push(highest.id);
  }
  return result.slice(0, MAX_SHOWCASE);
}

function unlockAchievements(profileValue, eligibleIds, timestamp = Date.now()) {
  const profile = normalizeAchievementProfile(profileValue);
  const newlyUnlocked = [];
  for (const id of sanitizeAchievementIds(eligibleIds, { maximum: ACHIEVEMENT_DEFINITIONS.length })) {
    if (profile.unlocked[id]) continue;
    profile.unlocked[id] = timestamp;
    profile.pendingUnlocks[id] = timestamp;
    newlyUnlocked.push(id);
  }
  profile.customShowcase = canonicalShowcase(profile.customShowcase, profile.unlocked);
  if (newlyUnlocked.length) profile.updatedAt = timestamp;
  return { profile, newlyUnlocked };
}

function effectiveShowcase(profileValue) {
  const profile = normalizeAchievementProfile(profileValue);
  if (profile.customShowcase.length) return profile.customShowcase.slice(0, MAX_SHOWCASE);
  const highestByFamily = new Map();
  Object.entries(profile.unlocked).forEach(([id, unlockedAt]) => {
    const definition = ACHIEVEMENT_BY_ID.get(id);
    if (!definition?.autoPublic) return;
    const current = highestByFamily.get(definition.family);
    if (!current || definition.level > current.definition.level
      || (definition.level === current.definition.level && unlockedAt > current.unlockedAt)) {
      highestByFamily.set(definition.family, { definition, unlockedAt });
    }
  });
  return [...highestByFamily.values()]
    .sort((first, second) => second.unlockedAt - first.unlockedAt
      || second.definition.level - first.definition.level
      || first.definition.id.localeCompare(second.definition.id))
    .slice(0, MAX_SHOWCASE)
    .map(({ definition }) => definition.id);
}

function publicShowcaseMap(profileValue) {
  return Object.fromEntries(effectiveShowcase(profileValue).map((id) => [id, true]));
}

function publicAchievementProfile(profileValue, battleStatsValue, marketStatsValue) {
  const profile = normalizeAchievementProfile(profileValue);
  const battleStats = normalizeBattleStats(battleStatsValue);
  const marketStats = normalizeMarketStats(marketStatsValue);
  return {
    unlocked: profile.unlocked,
    pendingUnlocks: Object.keys(profile.pendingUnlocks),
    customShowcase: profile.customShowcase,
    showcase: effectiveShowcase(profile),
    unlockedCount: Object.keys(profile.unlocked).length,
    totalCount: ACHIEVEMENT_DEFINITIONS.length,
    stats: {
      battle: battleStats,
      market: {
        salesCount: marketStats.salesCount,
        purchases: marketStats.purchases,
        marketDays: marketStats.marketDays,
        uniqueCounterparties: marketStats.uniqueCounterparties,
      },
    },
  };
}

module.exports = Object.freeze({
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_DEFINITIONS,
  BATTLE_MODES,
  MAX_SHOWCASE,
  VALID_SCOPES,
  addBattleMatch,
  addMarketTransaction,
  deriveBattleStatsFromPeriods,
  effectiveShowcase,
  eligibleAchievementIds,
  emptyBattleStats,
  normalizeAchievementProfile,
  normalizeBattleStats,
  normalizeMarketStats,
  publicAchievementProfile,
  publicShowcaseMap,
  sanitizeAchievementIds,
  unlockAchievements,
});
