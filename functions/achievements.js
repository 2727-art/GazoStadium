"use strict";

const BATTLE_MODES = Object.freeze(["solo", "strategy", "team", "team_duo", "royale"]);
const ACTIVE_BATTLE_MODES = Object.freeze(["solo", "strategy"]);
const BATTLE_VARIETY_MODE_GROUPS = Object.freeze([
  Object.freeze(["solo"]),
  Object.freeze(["strategy"]),
]);
const VALID_SCOPES = new Set(["battle", "training", "ai_training", "market", "flea"]);
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
  legacy = false,
  hint = "",
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
    hint: hint || `${familyLabel}を続けると解除`,
    autoPublic,
    legacy,
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
    thresholds: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    names: ["開幕の一枚", "いつもの観客席", "貼り合い常連", "画像フォルダの住人", "帰る場所はここ", "千本貼り", "スタジアムの一部", "五千戦の目撃者", "万戦の貼り手", "スタジアムの歴史"],
    description: (target) => `検証済みオンライン対戦を通算${target}試合完走した`,
    condition: (target) => ({ type: "battle_stat", key: "totalMatches", target }),
  }),
  ...[
    ["solo", "通常型1on1", "◆", ["通常型の一歩", "スタンダード見習い", "通常型の常連", "五十戦の貼り手", "通常型百景", "スタンダードの主", "千試合の定番", "三千戦の定石", "五千戦の正攻法", "通常型の金字塔"]],
    ["strategy", "戦略型1on1", "◇", ["弱点捜査開始", "読み合い見習い", "読み合いの常連", "五十の読み筋", "読み合い百景", "戦略型の主", "千回の読み合い", "三千の読み筋", "五千手先を見る", "戦略型の金字塔"]],
  ].flatMap(([mode, label, icon, names]) => series({
    scope: "battle",
    category: "battle_modes",
    family: `battle_${mode}`,
    familyLabel: label,
    icon,
    thresholds: [1, 5, 20, 50, 100, 300, 1000, 3000, 5000, 10000],
    names,
    description: (target) => `${label}を${target}試合完走した`,
    condition: (target) => ({ type: "battle_mode", mode, target }),
  })),
  ...series({
    scope: "battle",
    category: "battle_modes",
    family: "battle_team",
    familyLabel: "ふたりチャレンジ（終了）",
    icon: "∞",
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names: ["相棒募集中", "連携見習い", "チームの常連", "五十の共闘", "連携百景", "2on2の主", "千回の共闘"],
    description: (target) => `終了したチーム対戦を${target}試合完走した記録`,
    condition: (target) => ({ type: "battle_mode", mode: "team", target }),
    hint: "終了したモードの記録",
    legacy: true,
  }),
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
    familyLabel: "旧3モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["三つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `旧3種類のオンライン対戦モードをそれぞれ${target}試合完走した記録`,
    condition: (target) => ({ type: "minimum_battle_modes", target }),
    hint: "終了したモードを含む記録",
    legacy: true,
  }).map((definition, index) => Object.freeze({
    ...definition,
    id: `battle_variety_three_${definition.target}`,
    level: index + 2,
  })),
  ...series({
    scope: "battle",
    category: "battle_modes",
    family: "battle_royale",
    familyLabel: "バトルロワイヤル（終了）",
    icon: "♛",
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names: ["四人寄れば", "混戦見習い", "混戦の常連", "五十の乱戦", "乱戦百景", "BRの主", "千回の混戦"],
    description: (target) => `終了したバトルロワイヤルを${target}試合完走した記録`,
    condition: (target) => ({ type: "battle_mode", mode: "royale", target }),
    legacy: true,
  }),
  ...series({
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety_legacy",
    familyLabel: "旧4モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["四つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `旧4種類のオンライン対戦モードをそれぞれ${target}試合完走した`,
    condition: (target) => ({ type: "minimum_battle_modes", target }),
    legacy: true,
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
    thresholds: [1, 10, 30, 100, 300, 1000, 2000, 3000, 5000, 10000],
    names: ["黒星デビュー", "負けても貼る", "敗北を知る者", "百敗将軍", "負けの向こう側", "千敗の景色", "二千敗の轍", "三千敗の不屈", "五千の黒星を越えて", "黒星の果ての星"],
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
    thresholds: [3, 5, 8, 12, 16, 20, 25, 30, 40, 50],
    names: ["三連敗、通常運転", "沼もまたスタジアム", "出口はどこ", "それでも貼る", "十六戦目も席にいる", "二十の夜を越えて", "二十五戦の不屈", "三十戦、また次へ", "四十の向こう側", "何度でも戻る人"],
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
    thresholds: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    names: ["三日通い", "七日分の一枚", "二週間の顔", "月の常連", "二か月の住人", "百日の貼り手", "百八十日の観客席", "一年の貼り合い", "二年分の一枚", "千日のスタジアム"],
    description: (target) => `異なる${target}日でオンライン対戦を完走した`,
    condition: (target) => ({ type: "battle_stat", key: "playDays", target }),
  }),
  ...series({
    scope: "training",
    category: "training_record",
    family: "training_sessions",
    familyLabel: "鍛え合い参加（終了）",
    icon: "拳",
    thresholds: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    names: ["最初の一歩", "鍛錬の入口", "二十のセッション", "五十回の積み重ね", "百鍛錬", "鍛え合いの住人", "五百回の構え", "千日の鍛錬", "三千の積み重ね", "万鍛錬の到達者"],
    description: (target) => `終了した鍛え合い60へ${target}回参加した記録`,
    hint: "終了したモードの記録",
    legacy: true,
    condition: (target) => ({ type: "training_stat", key: "sessions", target }),
  }),
  ...series({
    scope: "training",
    category: "training_workout",
    family: "training_workouts",
    familyLabel: "運動完了（終了）",
    icon: "力",
    thresholds: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    names: ["一本やりきった", "十本の鍛錬", "三十本の汗", "百本稽古", "積み重ねの証", "千本鍛錬", "三千本の呼吸", "五千本の力", "万本鍛錬", "三万本の極み"],
    description: (target) => `終了した鍛え合い60で運動を${target}本完了した記録`,
    hint: "終了したモードの記録",
    legacy: true,
    condition: (target) => ({ type: "training_stat", key: "workouts", target }),
  }),
  ...series({
    scope: "training",
    category: "training_workout",
    family: "training_minutes",
    familyLabel: "累計運動時間（終了）",
    icon: "秒",
    thresholds: [1, 10, 30, 60, 300, 1000, 3000, 10000, 30000, 60000],
    names: ["最初の60秒", "十分の集中", "三十分の汗", "一時間の鍛錬", "五時間の積み重ね", "千分の証", "五十時間の鍛錬", "一万分の集中", "五百時間の軌跡", "千時間の極み"],
    description: (target) => `終了した鍛え合い60で累計${target}分の運動を完了した記録`,
    hint: "終了したモードの記録",
    legacy: true,
    condition: (target) => ({ type: "training_stat", key: "seconds", target: target * 60 }),
  }),
  ...[
    {
      id: "team_oshi_jouzu_defense",
      family: "team_oshi_jouzu_defense",
      level: 1,
      name: "つよ推しの証",
      description: "推し上手さんとして、ふたりの挑戦を退けた",
      signal: "teamOshiJozuDefense",
    },
    {
      id: "team_oshi_jouzu_clean_defense",
      family: "team_oshi_jouzu_defense",
      level: 2,
      name: "ひとりで魅せきった",
      description: "推し上手さんとして、2点以上の差で防衛した",
      signal: "teamOshiJozuCleanDefense",
    },
    {
      id: "team_duo_breakthrough",
      family: "team_duo_breakthrough",
      level: 1,
      name: "ふたりの推しが届いた",
      description: "ふたりで推し上手さんを上回った",
      signal: "teamDuoBreakthrough",
    },
    {
      id: "team_duo_clean_breakthrough",
      family: "team_duo_breakthrough",
      level: 2,
      name: "ふたりで魅せきった",
      description: "ふたりで2点以上の差をつけて推し上手さんを上回った",
      signal: "teamDuoCleanBreakthrough",
    },
  ].map((definition) => Object.freeze({
    id: definition.id,
    scope: "battle",
    category: "battle_honor",
    family: definition.family,
    familyLabel: "推し上手！ふたりチャレンジ（終了）",
    icon: "❀",
    level: definition.level,
    target: 1,
    name: definition.name,
    description: definition.description,
    hint: "終了したモードの記録",
    autoPublic: false,
    legacy: true,
    condition: { type: "battle_signal", signal: definition.signal },
  })),
];

const aiTrainingDefinitions = [
  ...series({
    scope: "ai_training",
    category: "ai_training_record",
    family: "ai_training_sessions",
    familyLabel: "文字コラ完走",
    icon: "五",
    thresholds: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    names: ["文字コラ開幕", "五回のエール", "文字コラ日和", "五十回の歩み", "百回トレーニー", "文字コラの住人", "五百のエール", "千回トレーニー", "三千回の伴走", "万回の文字コラ"],
    description: (target) => `文字コラトレーニングを5ラウンド${target}回完走した`,
    hint: "自分のペースで5ラウンドを終えると解除",
    condition: (target) => ({ type: "ai_training_stat", key: "completedSessions", target }),
  }),
  ...series({
    scope: "ai_training",
    category: "ai_training_record",
    family: "ai_training_days",
    familyLabel: "文字コラ日数",
    icon: "日",
    thresholds: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    names: ["三日分の一歩", "七日の文字コラ", "二週間のエール", "月のトレーニー", "六十日の歩み", "百日の文字コラ", "百八十日の伴走", "一年のエール", "二年の文字コラ", "千日のトレーニー"],
    description: (target) => `異なる${target}日で文字コラトレーニングを5ラウンド完走した`,
    hint: "日にちを分けて文字コラを続けると解除",
    condition: (target) => ({ type: "ai_training_stat", key: "completionDays", target }),
  }),
  ...series({
    scope: "ai_training",
    category: "ai_training_script_sales",
    family: "ai_training_script_uses",
    familyLabel: "台本利用成立",
    icon: "文",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["台本販売第一号", "駆け出し応援作者", "十回届いた言葉", "頼られる台本", "百回届いた言葉", "言葉で支える人", "五百回の応援", "千回届いた言葉", "三千のエール", "万の言葉を届けた人"],
    description: (target) => `応援台本のランキング対象利用が${target}回成立した`,
    hint: "同じ利用者からはJSTの1日1回だけ数える",
    condition: (target) => ({ type: "ai_training_stat", key: "rankingUseCount", target }),
  }),
  ...series({
    scope: "ai_training",
    category: "ai_training_script_sales",
    family: "ai_training_unique_buyers",
    familyLabel: "台本の利用者",
    icon: "輪",
    thresholds: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    names: ["三人に届いた", "十人の応援仲間", "広がるエール", "百人に届く声", "二百人の応援先", "三百人に届く台本", "五百のエールの輪", "千人の応援仲間", "二千人へ届く声", "三千人を支えた言葉"],
    description: (target) => `異なる${target}人が応援台本を有料利用した`,
    hint: "いろいろな人へ応援が届くと解除",
    condition: (target) => ({ type: "ai_training_stat", key: "uniqueBuyers", target }),
  }),
];

const marketDefinitions = [
  ...series({
    scope: "market",
    category: "market_roles",
    family: "market_seller",
    familyLabel: "売り手成約",
    icon: "◆",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["成約第一号", "駆け出しセラー", "推しの営業担当", "市場の顔役", "百戦錬磨の売り手", "価値をつくる人", "五百の価値を結ぶ", "千件の営業譚", "三千の推し値", "万の価値をつくる人"],
    description: (target) => `ランキング集計対象の売買を売り手として${target}件成立させた`,
    condition: (target) => ({ type: "market_stat", key: "salesCount", target }),
  }),
  ...series({
    scope: "market",
    category: "market_roles",
    family: "market_buyer",
    familyLabel: "買い手購入",
    icon: "◈",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["はじめての推し買い", "目利き見習い", "推し値コレクター", "市場の目利き", "百の価値を見た者", "推し値の証人", "五百の価値を見届ける", "千件の推し買い", "三千の証人", "万の価値を見届けた人"],
    description: (target) => `ランキング集計対象の売買を買い手として${target}件成立させた`,
    condition: (target) => ({ type: "market_stat", key: "purchases", target }),
  }),
  ...series({
    scope: "market",
    category: "market_balance",
    family: "market_both",
    familyLabel: "両役割",
    icon: "⇄",
    thresholds: [1, 3, 10, 30, 100, 200, 300, 500, 1000, 3000],
    names: ["市場の両面", "売って買って", "VALUE TRADER", "市場を回す人", "推し値市場の住人", "二百の両面", "三百往復の商い", "五百の売買往来", "千の両役", "推し値市場の大循環"],
    description: (target) => `売却と購入をそれぞれ${target}件成立させた`,
    condition: (target) => ({ type: "market_both", target }),
  }),
  ...series({
    scope: "market",
    category: "market_community",
    family: "market_days",
    familyLabel: "市場利用日数",
    icon: "▦",
    thresholds: [2, 7, 30, 100, 180, 300, 365, 500, 730, 1000],
    names: ["また来た", "七日市場", "月の常連商人", "商いは続く", "百八十日の店明かり", "三百日の商い", "一年市場", "五百日の往来", "二年の市場通い", "千日の市場守"],
    description: (target) => `異なる${target}日でランキング集計対象の売買を成立させた`,
    condition: (target) => ({ type: "market_stat", key: "marketDays", target }),
  }),
  ...series({
    scope: "market",
    category: "market_community",
    family: "market_partners",
    familyLabel: "取引相手",
    icon: "◎",
    thresholds: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    names: ["顔見知り", "市場に知り合いが増えた", "取引網", "スタジアム商会", "二百人の顔なじみ", "三百のご縁", "五百人の取引網", "千人の市場仲間", "二千の縁を結ぶ", "三千の縁を結ぶ人"],
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

const fleaDefinitions = [
  ...series({
    scope: "flea",
    category: "flea_listing",
    family: "flea_listings",
    familyLabel: "一日棚への出品",
    icon: "棚",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 365, 1000],
    names: ["今日の棚開き", "三日の店主", "七つの一品", "二週間の棚", "三十日のことば", "六十日の店先", "百日の売りっ子", "半年の一日棚", "一年分のことば", "千日のフリマ店主"],
    description: (target) => `AnjuPayフリマへ異なる${target}日で一品を出品した`,
    hint: "連続でなくても、一日棚へ出品した日が積み重なると解除",
    condition: (target) => ({ type: "flea_stat", key: "listings", target }),
    autoPublic: false,
  }),
  ...series({
    scope: "flea",
    category: "flea_connections",
    family: "flea_sales",
    familyLabel: "届いた一品",
    icon: "縁",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 365, 1000],
    names: ["ご縁第一号", "三つのご縁", "七つの旅立ち", "二週間分のご縁", "三十の旅立ち", "六十の出会い", "百のご縁", "百八十の旅立ち", "三百六十五のご縁", "千のご縁を結ぶ人"],
    description: (target) => `AnjuPayフリマで出品した一品が${target}件届いた`,
    hint: "価格の高さではなく、一品が誰かへ届くと解除",
    condition: (target) => ({ type: "flea_stat", key: "sales", target }),
    autoPublic: false,
  }),
  ...series({
    scope: "flea",
    category: "flea_connections",
    family: "flea_purchases",
    familyLabel: "出会いの記録",
    icon: "帖",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["はじめての出会い記録", "三つのことば", "十の出会い", "三十の一品", "百のことばを受け取る", "三百の出会い記録", "五百の店主を知る", "千の一日棚", "三千のことば", "万のご縁を見届けた人"],
    description: (target) => `AnjuPayフリマで${target}件の出会いの記録を残した`,
    hint: "価格の高さではなく、ことばから一品を選ぶと解除",
    condition: (target) => ({ type: "flea_stat", key: "purchases", target }),
    autoPublic: false,
  }),
];

const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  ...battleDefinitions,
  ...aiTrainingDefinitions,
  ...marketDefinitions,
  ...fleaDefinitions,
]);
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
    const teamDuoMatches = count(record?.variantMatches?.teamDuo, matches);
    stats.modeMatches.solo += count(record?.modeMatches?.solo, matches);
    stats.modeMatches.strategy += count(record?.modeMatches?.strategy, matches);
    stats.modeMatches.team_duo += teamDuoMatches;
    stats.modeMatches.team += Math.max(0, count(record?.modeMatches?.team, matches) - teamDuoMatches);
    stats.modeMatches.royale += count(record?.modeMatches?.royale, matches);
  });
  stats.playDays = daily.length;
  stats.lastPlayDateKey = daily.map(([key]) => key).sort().at(-1) || "";
  return normalizeBattleStats(stats);
}

function addBattleMatch(value, mode, outcome, dateKey) {
  const stats = normalizeBattleStats(value);
  if (!ACTIVE_BATTLE_MODES.includes(mode) || !["win", "loss", "draw"].includes(outcome)) return stats;
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

function normalizeTrainingStats(value) {
  return {
    sessions: count(value?.sessions) + count(value?.hpSessions),
    workouts: count(value?.completedSets) + count(value?.hpCompletedWorkouts),
    seconds: count(value?.completedSeconds) + count(value?.hpCompletedSeconds),
  };
}

function normalizeAiTextTrainingStats(value) {
  return {
    completedSessions: count(value?.completedSessions),
    completionDays: count(value?.completionDays),
    rankingUseCount: count(value?.rankingUseCount),
    uniqueBuyers: count(value?.uniqueBuyers),
  };
}

function normalizeFleaStats(value) {
  return {
    listings: count(value?.listings),
    sales: count(value?.sales),
    purchases: count(value?.purchases),
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

function achievementConditionMet(
  definition,
  battleStats,
  trainingStats,
  aiTextTrainingStats,
  marketStats,
  fleaStats,
  signals = {},
) {
  const condition = definition.condition;
  if (condition.type === "battle_stat") return count(battleStats?.[condition.key]) >= condition.target;
  if (condition.type === "battle_mode") return count(battleStats?.modeMatches?.[condition.mode]) >= condition.target;
  if (condition.type === "distinct_battle_modes") {
    return BATTLE_VARIETY_MODE_GROUPS
      .filter((modes) => modes.some((mode) => count(battleStats?.modeMatches?.[mode]) > 0))
      .length >= condition.target;
  }
  if (condition.type === "minimum_battle_modes") {
    return BATTLE_VARIETY_MODE_GROUPS.every((modes) => (
      modes.reduce((sum, mode) => sum + count(battleStats?.modeMatches?.[mode]), 0) >= condition.target
    ));
  }
  if (condition.type === "battle_signal") return signals?.[condition.signal] === true;
  if (condition.type === "training_stat") return count(trainingStats?.[condition.key]) >= condition.target;
  if (condition.type === "ai_training_stat") {
    return count(aiTextTrainingStats?.[condition.key]) >= condition.target;
  }
  if (condition.type === "market_stat") return count(marketStats?.[condition.key]) >= condition.target;
  if (condition.type === "market_both") {
    return count(marketStats?.salesCount) >= condition.target && count(marketStats?.purchases) >= condition.target;
  }
  if (condition.type === "market_signal") return signals?.[condition.signal] === true;
  if (condition.type === "flea_stat") return count(fleaStats?.[condition.key]) >= condition.target;
  return false;
}

function eligibleAchievementIds({
  battleStats,
  trainingStats,
  aiTextTrainingStats,
  marketStats,
  fleaStats,
  signals = {},
  scope = "",
} = {}) {
  return ACHIEVEMENT_DEFINITIONS
    .filter((definition) => !definition.legacy
      && (!scope || definition.scope === scope)
      && achievementConditionMet(
        definition,
        battleStats,
        trainingStats,
        aiTextTrainingStats,
        marketStats,
        fleaStats,
        signals,
      ))
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

function publicAchievementProfile(
  profileValue,
  battleStatsValue,
  marketStatsValue,
  trainingStatsValue,
  aiTextTrainingStatsValue,
  fleaStatsValue,
) {
  const profile = normalizeAchievementProfile(profileValue);
  const battleStats = normalizeBattleStats(battleStatsValue);
  const marketStats = normalizeMarketStats(marketStatsValue);
  const trainingStats = normalizeTrainingStats(trainingStatsValue);
  const aiTextTrainingStats = normalizeAiTextTrainingStats(aiTextTrainingStatsValue);
  const fleaStats = normalizeFleaStats(fleaStatsValue);
  const unlockedLegacyCount = Object.keys(profile.unlocked)
    .filter((id) => ACHIEVEMENT_BY_ID.get(id)?.legacy === true)
    .length;
  return {
    unlocked: profile.unlocked,
    pendingUnlocks: Object.keys(profile.pendingUnlocks),
    customShowcase: profile.customShowcase,
    showcase: effectiveShowcase(profile),
    unlockedCount: Object.keys(profile.unlocked).length,
    totalCount: ACHIEVEMENT_DEFINITIONS.filter((definition) => !definition.legacy).length
      + unlockedLegacyCount,
    stats: {
      battle: battleStats,
      training: trainingStats,
      aiTraining: aiTextTrainingStats,
      market: {
        salesCount: marketStats.salesCount,
        purchases: marketStats.purchases,
        marketDays: marketStats.marketDays,
        uniqueCounterparties: marketStats.uniqueCounterparties,
      },
      flea: fleaStats,
    },
  };
}

module.exports = Object.freeze({
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_DEFINITIONS,
  ACTIVE_BATTLE_MODES,
  BATTLE_MODES,
  MAX_SHOWCASE,
  VALID_SCOPES,
  addBattleMatch,
  addMarketTransaction,
  deriveBattleStatsFromPeriods,
  effectiveShowcase,
  eligibleAchievementIds,
  emptyBattleStats,
  normalizeAiTextTrainingStats,
  normalizeAchievementProfile,
  normalizeBattleStats,
  normalizeFleaStats,
  normalizeMarketStats,
  normalizeTrainingStats,
  publicAchievementProfile,
  publicShowcaseMap,
  sanitizeAchievementIds,
  unlockAchievements,
});
