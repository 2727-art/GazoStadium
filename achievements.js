(() => {
  "use strict";

  const MAX_SHOWCASE = 3;
  const DOLLMASTER_ACHIEVEMENT_ID = "special_dollmaster";
  const definitions = [];
  const addSeries = ({
    scope,
    category,
    family,
    familyLabel,
    icon,
    thresholds,
    names,
    description,
    hint = `${familyLabel}を続けると解除`,
    autoPublic = true,
    legacy = false,
  }) => {
    thresholds.forEach((target, index) => definitions.push(Object.freeze({
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
      hint,
      autoPublic,
      legacy,
    })));
  };

  addSeries({
    scope: "battle",
    category: "battle_record",
    family: "battle_total",
    familyLabel: "通算対戦",
    icon: "▣",
    thresholds: [1, 10, 30, 100, 300, 1000, 3000, 5000, 10000, 30000],
    names: ["開幕の一枚", "いつもの観客席", "貼り合い常連", "画像フォルダの住人", "帰る場所はここ", "千本貼り", "スタジアムの一部", "五千戦の目撃者", "万戦の貼り手", "スタジアムの歴史"],
    description: (target) => `検証済みオンライン対戦を通算${target}試合完走した`,
  });

  [
    ["solo", "通常型1on1", "◆", ["通常型の一歩", "スタンダード見習い", "通常型の常連", "五十戦の貼り手", "通常型百景", "スタンダードの主", "千試合の定番", "三千戦の定石", "五千戦の正攻法", "通常型の金字塔"]],
    ["strategy", "戦略型1on1", "◇", ["弱点捜査開始", "読み合い見習い", "読み合いの常連", "五十の読み筋", "読み合い百景", "戦略型の主", "千回の読み合い", "三千の読み筋", "五千手先を見る", "戦略型の金字塔"]],
  ].forEach(([mode, label, icon, names]) => addSeries({
    scope: "battle",
    category: "battle_modes",
    family: `battle_${mode}`,
    familyLabel: label,
    icon,
    thresholds: [1, 5, 20, 50, 100, 300, 1000, 3000, 5000, 10000],
    names,
    description: (target) => `${label}を${target}試合完走した`,
  }));

  addSeries({
    scope: "battle",
    category: "battle_modes",
    family: "battle_team",
    familyLabel: "ふたりチャレンジ（終了）",
    icon: "∞",
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names: ["相棒募集中", "連携見習い", "チームの常連", "五十の共闘", "連携百景", "2on2の主", "千回の共闘"],
    description: (target) => `終了したチーム対戦を${target}試合完走した記録`,
    hint: "終了したモードの記録",
    legacy: true,
  });

  definitions.push(Object.freeze({
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
  }));
  const varietyStart = definitions.length;
  addSeries({
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety",
    familyLabel: "旧3モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["三つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `旧3種類のオンライン対戦モードをそれぞれ${target}試合完走した記録`,
    hint: "終了したモードを含む記録",
    legacy: true,
  });
  definitions.splice(varietyStart, 5, ...definitions.slice(varietyStart, varietyStart + 5).map((definition, index) => Object.freeze({
    ...definition,
    id: `battle_variety_three_${definition.target}`,
    level: index + 2,
  })));

  addSeries({
    scope: "battle",
    category: "battle_modes",
    family: "battle_royale",
    familyLabel: "バトルロワイヤル（終了）",
    icon: "♛",
    thresholds: [1, 5, 20, 50, 100, 300, 1000],
    names: ["四人寄れば", "混戦見習い", "混戦の常連", "五十の乱戦", "乱戦百景", "BRの主", "千回の混戦"],
    description: (target) => `終了したバトルロワイヤルを${target}試合完走した記録`,
    hint: "終了したモードの記録",
    legacy: true,
  });

  const legacyVarietyStart = definitions.length;
  addSeries({
    scope: "battle",
    category: "battle_variety",
    family: "battle_variety_legacy",
    familyLabel: "旧4モード回遊",
    icon: "✦",
    thresholds: [1, 5, 20, 50, 100],
    names: ["四つの入口", "全方位型・初級", "全方位型・中級", "全方位型・上級", "スタジアムの旅人"],
    description: (target) => `旧4種類のオンライン対戦モードをそれぞれ${target}試合完走した記録`,
    hint: "終了したモードを含む記録",
    legacy: true,
  });
  definitions.splice(legacyVarietyStart, 5, ...definitions.slice(legacyVarietyStart, legacyVarietyStart + 5).map((definition, index) => Object.freeze({
    ...definition,
    id: `battle_variety_all_${definition.target}`,
    level: index + 2,
  })));

  addSeries({
    scope: "battle",
    category: "battle_loss",
    family: "battle_losses",
    familyLabel: "通算敗北",
    icon: "☂",
    thresholds: [1, 10, 30, 100, 300, 1000, 2000, 3000, 5000, 10000],
    names: ["黒星デビュー", "負けても貼る", "敗北を知る者", "百敗将軍", "負けの向こう側", "千敗の景色", "二千敗の轍", "三千敗の不屈", "五千の黒星を越えて", "黒星の果ての星"],
    description: (target) => `オンライン対戦で通算${target}敗を記録した`,
    autoPublic: false,
  });
  addSeries({
    scope: "battle",
    category: "battle_loss",
    family: "battle_loss_streak",
    familyLabel: "連敗",
    icon: "≋",
    thresholds: [3, 5, 8, 12, 16, 20, 25, 30, 40, 50],
    names: ["三連敗、通常運転", "沼もまたスタジアム", "出口はどこ", "それでも貼る", "十六戦目も席にいる", "二十の夜を越えて", "二十五戦の不屈", "三十戦、また次へ", "四十の向こう側", "何度でも戻る人"],
    description: (target) => `${target}連敗しても対戦を続けた`,
    autoPublic: false,
  });
  [
    ["battle_loss_streak_secret_100", 100, "百敗の主演", "検証済みオンライン対戦で100連敗し、負け役の物語を百幕つないだ"],
    ["battle_loss_streak_secret_200", 200, "敗北劇の名優", "検証済みオンライン対戦で200連敗し、負け役の物語を二百幕つないだ"],
  ].forEach(([id, target, name, description]) => definitions.push(Object.freeze({
    id,
    scope: "battle",
    category: "battle_loss",
    family: id,
    familyLabel: "負け役ロールプレイ",
    icon: "幕",
    level: 1,
    target,
    name,
    description,
    hint: "遊びの中で見つかるシークレット実績",
    autoPublic: false,
    legacy: false,
    secret: true,
  })));
  addSeries({
    scope: "battle",
    category: "battle_days",
    family: "battle_days",
    familyLabel: "対戦日数",
    icon: "◷",
    thresholds: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    names: ["三日通い", "七日分の一枚", "二週間の顔", "月の常連", "二か月の住人", "百日の貼り手", "百八十日の観客席", "一年の貼り合い", "二年分の一枚", "千日のスタジアム"],
    description: (target) => `異なる${target}日でオンライン対戦を完走した`,
  });
  [
    ["crown_monthly_participated_1", 1, 1, "月間への第一歩", "2026年8月以降、成立ウィークリーを月間王座へ初めてつないだ"],
    ["crown_monthly_qualified_1", 2, 1, "月間証明成立", "2026年8月以降、月間王座を初めて成立させた"],
    ["crown_monthly_top10_1", 3, 1, "月間十傑", "2026年8月以降、月間王座でTOP10に入った"],
    ["crown_monthly_top3_1", 4, 1, "月間三席", "2026年8月以降、月間王座でTOP3に入った"],
    ["crown_monthly_champion_1", 5, 1, "月間王者", "2026年8月以降、月間王座の頂点に立った"],
    ["crown_monthly_qualified_3", 6, 3, "三月の証明", "月間王座を3回成立させた"],
    ["crown_monthly_top10_3", 7, 3, "三度の十傑", "月間TOP10へ3回入った"],
    ["crown_monthly_top3_3", 8, 3, "三度の三席", "月間TOP3へ3回入った"],
    ["crown_monthly_champion_3", 9, 3, "月間三冠", "月間王者を3回獲得した"],
    ["crown_monthly_champion_10", 10, 10, "十冠の伝説", "2026年8月以降の月間王者を10回獲得した"],
  ].forEach(([id, level, target, name, description]) => definitions.push(Object.freeze({
    id,
    scope: "battle",
    category: "battle_crown",
    family: "crown_monthly",
    familyLabel: "月間王座",
    icon: "✺",
    level,
    target,
    name,
    description,
    hint: "2026年8月以降の検証済み月間王座で解除",
    autoPublic: true,
    legacy: false,
  })));
  addSeries({
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
  });
  addSeries({
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
  });
  addSeries({
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
  });
  addSeries({
    scope: "danwaku",
    category: "danwaku_note",
    family: "danwaku_streak",
    familyLabel: "断惑継続",
    icon: "蓮",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 270, 365],
    names: ["発心の一歩", "一念の灯", "精進の芽", "日々の歩み", "不放逸のしるし", "心調う", "蓮のつぼみ", "蓮華ひらく", "光の道標", "無尽の歩み"],
    description: (target) => `断惑継続の最高記録が${target}日になった`,
    hint: "断惑継続を自分のペースで記録すると解除",
    autoPublic: false,
  });
  addSeries({
    scope: "ai_training",
    category: "ai_training_record",
    family: "ai_training_sessions",
    familyLabel: "文字コラ完走",
    icon: "五",
    thresholds: [1, 5, 20, 50, 100, 300, 500, 1000, 3000, 10000],
    names: ["文字コラ開幕", "五回のエール", "文字コラ日和", "五十回の歩み", "百回トレーニー", "文字コラの住人", "五百のエール", "千回トレーニー", "三千回の伴走", "万回の文字コラ"],
    description: (target) => `文字コラトレーニングを5ラウンド${target}回完走した`,
    hint: "自分のペースで5ラウンドを終えると解除",
  });
  addSeries({
    scope: "ai_training",
    category: "ai_training_record",
    family: "ai_training_days",
    familyLabel: "文字コラ日数",
    icon: "日",
    thresholds: [3, 7, 14, 30, 60, 100, 180, 365, 730, 1000],
    names: ["三日分の一歩", "七日の文字コラ", "二週間のエール", "月のトレーニー", "六十日の歩み", "百日の文字コラ", "百八十日の伴走", "一年のエール", "二年の文字コラ", "千日のトレーニー"],
    description: (target) => `異なる${target}日で文字コラトレーニングを5ラウンド完走した`,
    hint: "日にちを分けて文字コラを続けると解除",
  });
  addSeries({
    scope: "ai_training",
    category: "ai_training_script_sales",
    family: "ai_training_script_uses",
    familyLabel: "台本利用成立",
    icon: "文",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["台本販売第一号", "駆け出し応援作者", "十回届いた言葉", "頼られる台本", "百回届いた言葉", "言葉で支える人", "五百回の応援", "千回届いた言葉", "三千のエール", "万の言葉を届けた人"],
    description: (target) => `応援台本のランキング対象利用が${target}回成立した`,
    hint: "同じ利用者からはJSTの1日1回だけ数える",
  });
  addSeries({
    scope: "ai_training",
    category: "ai_training_script_sales",
    family: "ai_training_unique_buyers",
    familyLabel: "台本の利用者",
    icon: "輪",
    thresholds: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    names: ["三人に届いた", "十人の応援仲間", "広がるエール", "百人に届く声", "二百人の応援先", "三百人に届く台本", "五百のエールの輪", "千人の応援仲間", "二千人へ届く声", "三千人を支えた言葉"],
    description: (target) => `異なる${target}人が応援台本を有料利用した`,
    hint: "いろいろな人へ応援が届くと解除",
  });
  addSeries({
    scope: "roulette_training",
    category: "roulette_training_pack_sales",
    family: "roulette_training_pack_uses",
    familyLabel: "パック利用成立",
    icon: "札",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["パック販売第一号", "駆け出しパック作者", "十回届いたメニュー", "頼られるトレーニング帳", "百回届いたおうちトレ", "おうちトレを支える人", "五百回の応援メニュー", "千回届いたトレーニング帳", "三千回の伴走", "万回のメニューを届けた人"],
    description: (target) => `ルーレットトレーニングパックのランキング対象利用が${target}回成立した`,
    hint: "同じ利用者からはJSTの1日1回だけ数える",
  });
  addSeries({
    scope: "roulette_training",
    category: "roulette_training_pack_sales",
    family: "roulette_training_unique_buyers",
    familyLabel: "パックの利用者",
    icon: "輪",
    thresholds: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    names: ["三人に届いたパック", "十人のトレーニング仲間", "広がるおうちトレ", "百人に届くメニュー", "二百人のトレーニー", "三百人に届いたパック", "五百人のエールの輪", "千人のトレーニング仲間", "二千人へ届くメニュー", "三千人を支えた作者"],
    description: (target) => `異なる${target}人がルーレットトレーニングパックを有料利用した`,
    hint: "いろいろな人へトレーニングメニューが届くと解除",
  });
  [
    ["team_oshi_jouzu_defense", "team_oshi_jouzu_defense", 1, "つよ推しの証", "推し上手さんとして、ふたりの挑戦を退けた"],
    ["team_oshi_jouzu_clean_defense", "team_oshi_jouzu_defense", 2, "ひとりで魅せきった", "推し上手さんとして、2点以上の差で防衛した"],
    ["team_duo_breakthrough", "team_duo_breakthrough", 1, "ふたりの推しが届いた", "ふたりで推し上手さんを上回った"],
    ["team_duo_clean_breakthrough", "team_duo_breakthrough", 2, "ふたりで魅せきった", "ふたりで2点以上の差をつけて推し上手さんを上回った"],
  ].forEach(([id, family, level, name, description]) => definitions.push(Object.freeze({
    id,
    scope: "battle",
    category: "battle_honor",
    family,
    familyLabel: "推し上手！ふたりチャレンジ（終了）",
    icon: "❀",
    level,
    target: 1,
    name,
    description,
    hint: "終了したモードの記録",
    autoPublic: false,
    legacy: true,
  })));

  addSeries({
    scope: "market",
    category: "market_roles",
    family: "market_seller",
    familyLabel: "売り手成約",
    icon: "◆",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["成約第一号", "駆け出しセラー", "推しの営業担当", "市場の顔役", "百戦錬磨の売り手", "価値をつくる人", "五百の価値を結ぶ", "千件の営業譚", "三千の推し値", "万の価値をつくる人"],
    description: (target) => `ランキング集計対象の売買を売り手として${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_roles",
    family: "market_buyer",
    familyLabel: "買い手購入",
    icon: "◈",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["はじめての推し買い", "目利き見習い", "推し値コレクター", "市場の目利き", "百の価値を見た者", "推し値の証人", "五百の価値を見届ける", "千件の推し買い", "三千の証人", "万の価値を見届けた人"],
    description: (target) => `ランキング集計対象の売買を買い手として${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_balance",
    family: "market_both",
    familyLabel: "両役割",
    icon: "⇄",
    thresholds: [1, 3, 10, 30, 100, 200, 300, 500, 1000, 3000],
    names: ["市場の両面", "売って買って", "VALUE TRADER", "市場を回す人", "推し値市場の住人", "二百の両面", "三百往復の商い", "五百の売買往来", "千の両役", "推し値市場の大循環"],
    description: (target) => `売却と購入をそれぞれ${target}件成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_community",
    family: "market_days",
    familyLabel: "市場利用日数",
    icon: "▦",
    thresholds: [2, 7, 30, 100, 180, 300, 365, 500, 730, 1000],
    names: ["また来た", "七日市場", "月の常連商人", "商いは続く", "百八十日の店明かり", "三百日の商い", "一年市場", "五百日の往来", "二年の市場通い", "千日の市場守"],
    description: (target) => `異なる${target}日でランキング集計対象の売買を成立させた`,
  });
  addSeries({
    scope: "market",
    category: "market_community",
    family: "market_partners",
    familyLabel: "取引相手",
    icon: "◎",
    thresholds: [3, 10, 30, 100, 200, 300, 500, 1000, 2000, 3000],
    names: ["顔見知り", "市場に知り合いが増えた", "取引網", "スタジアム商会", "二百人の顔なじみ", "三百のご縁", "五百人の取引網", "千人の市場仲間", "二千の縁を結ぶ", "三千の縁を結ぶ人"],
    description: (target) => `${target}人の異なる相手とランキング集計対象の売買を成立させた`,
  });
  [
    ["market_first_turn", "即決", "第1営業ターンで売買が成立した", "✧"],
    ["market_extended", "もう1ターンの価値", "追加検討を経て売買が成立した", "＋"],
    ["market_third_turn", "三度目の正直", "第3営業ターンで売買が成立した", "Ⅲ"],
    ["market_both_roles_day", "一日二役", "同じ日に売り手と買い手の両方で成立取引を行った", "☀"],
    ["market_role_switch", "立場を替えて", "前回とは反対の役割で成立取引を行った", "↻"],
  ].forEach(([id, name, description, icon]) => definitions.push(Object.freeze({
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
  })));

  addSeries({
    scope: "flea",
    category: "flea_listing",
    family: "flea_listings",
    familyLabel: "一日棚への出品",
    icon: "棚",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 365, 1000],
    names: ["今日の棚開き", "三日の店主", "七つの一品", "二週間の棚", "三十日のことば", "六十日の店先", "百日の売りっ子", "半年の一日棚", "一年分のことば", "千日のフリマ店主"],
    description: (target) => `AnjuPayフリマへ異なる${target}日で一品を出品した`,
    hint: "連続でなくても、一日棚へ出品した日が積み重なると解除",
    autoPublic: false,
  });
  addSeries({
    scope: "flea",
    category: "flea_connections",
    family: "flea_sales",
    familyLabel: "届いた一品",
    icon: "縁",
    thresholds: [1, 3, 7, 14, 30, 60, 100, 180, 365, 1000],
    names: ["ご縁第一号", "三つのご縁", "七つの旅立ち", "二週間分のご縁", "三十の旅立ち", "六十の出会い", "百のご縁", "百八十の旅立ち", "三百六十五のご縁", "千のご縁を結ぶ人"],
    description: (target) => `AnjuPayフリマで出品した一品が${target}件届いた`,
    hint: "価格の高さではなく、一品が誰かへ届くと解除",
    autoPublic: false,
  });
  addSeries({
    scope: "flea",
    category: "flea_connections",
    family: "flea_purchases",
    familyLabel: "出会いの記録",
    icon: "帖",
    thresholds: [1, 3, 10, 30, 100, 300, 500, 1000, 3000, 10000],
    names: ["はじめての出会い記録", "三つのことば", "十の出会い", "三十の一品", "百のことばを受け取る", "三百の出会い記録", "五百の店主を知る", "千の一日棚", "三千のことば", "万のご縁を見届けた人"],
    description: (target) => `AnjuPayフリマで${target}件の出会いの記録を残した`,
    hint: "価格の高さではなく、ことばから一品を選ぶと解除",
    autoPublic: false,
  });

  definitions.unshift(Object.freeze({
    id: "special_dollmaster",
    scope: "special",
    category: "special_collection",
    family: "special_dollmaster",
    familyLabel: "シークレットコレクション",
    icon: "＠",
    level: 1,
    target: 1,
    name: "DOLLM＠STER",
    description: "別のゲームで手にした実績コードが結んだ、特別なコレクション",
    hint: "別のゲームで獲得した実績コードを入力すると解除",
    autoPublic: false,
    legacy: false,
  }));

  const catalog = Object.freeze(definitions);
  const byId = new Map(catalog.map((definition) => [definition.id, definition]));
  const categoryInfo = Object.freeze([
    { id: "special_collection", label: "SPECIAL COLLECTION", copy: "別のゲームで受け取った証を、このスタジアムだけの特別な実績として残します" },
    { id: "battle_record", label: "通算対戦", copy: "勝敗に関係なく、正式な対戦を完走した記録" },
    { id: "battle_modes", label: "モード別", copy: "現在遊べる2種類のオンライン対戦と、解除済みの旧モード記録" },
    { id: "battle_variety", label: "モード回遊", copy: "複数の入口を訪れたオールラウンダーの記録" },
    { id: "battle_loss", label: "敗北も記録", copy: "勝てない日も、負け役のロールプレイも、貼り続けた記録" },
    { id: "battle_days", label: "継続", copy: "異なる日にスタジアムへ戻ってきた記録" },
    { id: "battle_crown", label: "月間王座", copy: "2026年8月以降の検証済み月間王座で刻む、参加・入賞・戴冠の記録" },
    { id: "battle_honor", label: "つよ推しの証（終了）", copy: "終了したふたりチャレンジで刻んだ武勲" },
    { id: "training_record", label: "鍛え合い60（終了）", copy: "終了したモードへ参加した歩み" },
    { id: "training_workout", label: "鍛錬の積み重ね（終了）", copy: "終了前に完了した運動の本数と時間" },
    { id: "danwaku_note", label: "断惑NOTE", copy: "断ちたい習慣と向き合い、自分で継続を記した日々の歩み" },
    { id: "ai_training_record", label: "文字コラトレーニング", copy: "BPMや運動強度ではなく、自分のペースで5ラウンドを終えた歩み" },
    { id: "ai_training_script_sales", label: "応援台本の販売", copy: "価格や売上額ではなく、応援が利用された回数と広がりの記録" },
    { id: "roulette_training_pack_sales", label: "ルーレットトレーニング・パック販売", copy: "価格や売上額、ランキング順位ではなく、トレーニングパックが利用された回数と広がりの記録" },
    { id: "flea_listing", label: "AnjuPayフリマ・一日棚", copy: "連続日数ではなく、自分のペースで一品を言葉にした日々の記録" },
    { id: "flea_connections", label: "AnjuPayフリマ・ご縁", copy: "売上額や順位ではなく、一品が届いた回数と出会いの記録" },
    { id: "market_roles", label: "市場の役割", copy: "売り手・買い手として成立させた取引の記録" },
    { id: "market_balance", label: "市場を回す", copy: "両方の役割を体験した記録" },
    { id: "market_community", label: "市場の交流", copy: "日数と異なる取引相手の記録" },
    { id: "market_discovery", label: "市場の発見", copy: "商談の中で見つかる一度限りの隠し実績" },
  ]);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeIds(value, maximum = catalog.length) {
    const candidates = typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : Object.entries(value && typeof value === "object" ? value : {})
          .filter(([, enabled]) => enabled === true)
          .map(([id]) => id);
    return [...new Set(candidates.map(String).filter((id) => byId.has(id)))].slice(0, maximum);
  }

  function canonicalShowcase(value, unlocked) {
    const result = [];
    normalizeIds(value, MAX_SHOWCASE).filter((id) => unlocked[id]).forEach((id) => {
      const definition = byId.get(id);
      const highest = catalog
        .filter((candidate) => candidate.family === definition.family && unlocked[candidate.id])
        .sort((first, second) => second.level - first.level)[0] || definition;
      if (!result.includes(highest.id)) result.push(highest.id);
    });
    return result;
  }

  function normalizeProfile(value) {
    const unlocked = {};
    Object.entries(value?.unlocked || {}).forEach(([id, timestamp]) => {
      if (byId.has(id) && Number(timestamp) > 0) unlocked[id] = Number(timestamp);
    });
    return {
      unlocked,
      pendingUnlocks: normalizeIds(value?.pendingUnlocks),
      customShowcase: canonicalShowcase(value?.customShowcase, unlocked),
      showcase: normalizeIds(value?.showcase, MAX_SHOWCASE).filter((id) => unlocked[id]),
      unlockedCount: Math.max(Object.keys(unlocked).length, Number(value?.unlockedCount || 0)),
      totalCount: catalog.filter((definition) => !definition.legacy).length
        + Object.keys(unlocked).filter((id) => byId.get(id)?.legacy === true).length,
      stats: value?.stats && typeof value.stats === "object" ? value.stats : {},
    };
  }

  function achievementPresentationClass(definition) {
    const level = Math.min(10, Math.max(1, Math.floor(Number(definition?.level) || 1)));
    const dollmasterClass = definition?.id === DOLLMASTER_ACHIEVEMENT_ID ? " is-dollmaster" : "";
    const secretClass = definition?.secret === true ? " is-secret" : "";
    return `achievement-level-${level}${level === 10 ? " is-final" : ""}${dollmasterClass}${secretClass}`;
  }

  function orderUnlockIds(value) {
    return normalizeIds(value).sort((firstId, secondId) => {
      const first = byId.get(firstId);
      const second = byId.get(secondId);
      return Number(second?.id === DOLLMASTER_ACHIEVEMENT_ID)
        - Number(first?.id === DOLLMASTER_ACHIEVEMENT_ID)
        || Number(second?.level === 10) - Number(first?.level === 10)
        || Number(second?.secret === true) - Number(first?.secret === true)
        || (first?.secret === true && second?.secret === true
          ? Number(second?.target || 0) - Number(first?.target || 0)
          : 0)
        || Number(second?.level || 0) - Number(first?.level || 0)
        || catalog.indexOf(first) - catalog.indexOf(second);
    });
  }

  function renderBadges(value, { compact = true, empty = "" } = {}) {
    const ids = normalizeIds(value, MAX_SHOWCASE);
    if (!ids.length) return empty;
    return `<span class="achievement-badges ${compact ? "is-compact" : ""}" aria-label="実績ショーケース">${ids.map((id) => {
      const achievement = byId.get(id);
      const levelLabel = achievement.id === DOLLMASTER_ACHIEVEMENT_ID
        ? "SPECIAL"
        : achievement.secret === true ? "SECRET"
        : achievement.level === 10 ? "FINAL Lv.10" : `Lv.${achievement.level}`;
      return `<span class="achievement-badge achievement-scope-${achievement.scope} ${achievementPresentationClass(achievement)}" title="${escapeHtml(`${achievement.name} / ${achievement.description}`)}"><i aria-hidden="true">${escapeHtml(achievement.icon)}</i><span>${escapeHtml(achievement.name)}</span><small>${levelLabel}</small></span>`;
    }).join("")}</span>`;
  }

  function highestUnlockedByFamily(profile) {
    const highest = new Map();
    catalog.forEach((definition) => {
      if (!profile.unlocked[definition.id]) return;
      const current = highest.get(definition.family);
      if (!current || definition.level > current.level) highest.set(definition.family, definition);
    });
    return highest;
  }

  function renderCollection(value) {
    const profile = normalizeProfile(value);
    const highest = highestUnlockedByFamily(profile);
    const showcased = new Set(profile.showcase);
    const sections = categoryInfo.map((category) => {
      const families = [...new Set(catalog
        .filter((definition) => definition.category === category.id
          && (!definition.legacy || profile.unlocked[definition.id]))
        .map((definition) => definition.family))];
      const cards = families.map((family) => {
        const familyDefinitions = catalog.filter((definition) => definition.family === family).sort((a, b) => a.level - b.level);
        const current = highest.get(family);
        const legacyFamily = familyDefinitions.every((definition) => definition.legacy);
        const secretFamily = familyDefinitions.every((definition) => definition.secret === true);
        const next = legacyFamily
          ? null
          : current
          ? familyDefinitions.find((definition) => definition.level > current.level)
          : familyDefinitions[0];
        const selected = current && showcased.has(current.id);
        const unlockedClass = current ? "is-unlocked" : "is-locked";
        const finalAchievement = current?.level === 10;
        const secretAchievement = current?.secret === true;
        const dollmasterAchievement = (current || next)?.id === DOLLMASTER_ACHIEVEMENT_ID;
        const progressLabel = legacyFamily
          ? "終了モードの記録"
          : secretFamily
            ? current ? "シークレット実績・取得済み" : "未解除・シークレット"
          : dollmasterAchievement && current
            ? "特典コード実績・取得済み"
          : finalAchievement
            ? "Lv.10 / 10・最終実績"
            : `${current ? `Lv.${current.level} / ${familyDefinitions.at(-1).level}` : `未解除 / 最大Lv.${familyDefinitions.at(-1).level}`}${next && current ? "・次の条件は非公開" : ""}`;
        const presentationClass = current
          ? achievementPresentationClass(current)
          : dollmasterAchievement || secretFamily ? achievementPresentationClass(next) : "";
        return `<article class="achievement-family-card ${unlockedClass} ${selected ? "is-showcased" : ""} ${presentationClass}">
          <div class="achievement-family-icon" aria-hidden="true">${current ? escapeHtml(current.icon) : "?"}</div>
          <div class="achievement-family-copy">
            <span>${escapeHtml(current?.familyLabel || (secretFamily ? "SECRET RECORD" : next?.familyLabel) || "隠し実績")}</span>
            <h3>${current ? escapeHtml(current.name) : "？？？"}</h3>
            <p>${current ? escapeHtml(current.description) : secretFamily ? "条件は解除まで非公開です" : escapeHtml(next?.hint || "遊び続けると解除")}</p>
            <small>${progressLabel}</small>
            ${finalAchievement ? '<b class="achievement-final-mark"><span aria-hidden="true">✦</span> FINAL ACHIEVEMENT <span aria-hidden="true">✦</span></b>' : ""}
            ${secretAchievement ? '<b class="achievement-secret-mark"><span aria-hidden="true">✦</span> SECRET ACHIEVEMENT <span aria-hidden="true">✦</span></b>' : ""}
            ${dollmasterAchievement && current ? '<b class="achievement-dollmaster-mark"><span aria-hidden="true">✦</span> LIMITED LEGENDARY <span aria-hidden="true">✦</span></b>' : ""}
          </div>
          ${current ? `<button class="achievement-showcase-toggle ${selected ? "is-selected" : ""}" type="button" data-achievement-showcase="${escapeHtml(current.id)}" aria-pressed="${selected}">${selected ? "展示中" : "展示する"}</button>` : ""}
        </article>`;
      }).join("");
      return `<section class="achievement-category" aria-labelledby="achievementCategory-${escapeHtml(category.id)}">
        <div class="achievement-category-head"><div><span>ACHIEVEMENT SERIES</span><h2 id="achievementCategory-${escapeHtml(category.id)}">${escapeHtml(category.label)}</h2></div><p>${escapeHtml(category.copy)}</p></div>
        <div class="achievement-family-grid">${cards}</div>
      </section>`;
    }).join("");
    return `<div class="achievement-summary">
        <div><span>UNLOCKED</span><strong>${profile.unlockedCount}<small> / ${profile.totalCount}</small></strong></div>
        <div><span>SHOWCASE</span>${renderBadges(profile.showcase, { compact: false, empty: "<em>自動選択される実績はまだありません</em>" })}</div>
      </div>
      <div class="achievement-showcase-guide"><p>ランキングへ表示する実績は最大${MAX_SHOWCASE}件です。敗北実績とAnjuPayフリマ実績は自動公開されず、展示するかは本人が選べます。</p>
        <button class="button button-ghost button-small" type="button" data-achievement-showcase-auto ${profile.customShowcase.length ? "" : "disabled"}>自動選択に戻す</button></div>
      ${sections}`;
  }

  let unlockQueue = [];
  let unlockTimer = null;
  const sessionSeen = new Set();

  function showNextUnlock() {
    unlockTimer = null;
    const ids = orderUnlockIds(unlockQueue.splice(0, unlockQueue.length));
    if (!ids.length) return;
    const first = byId.get(ids[0]);
    if (!first) return;
    const finalAchievement = first.level === 10;
    const secretAchievement = first.secret === true;
    const dollmasterAchievement = first.id === DOLLMASTER_ACHIEVEMENT_ID;
    let layer = document.querySelector("#achievementUnlockLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "achievementUnlockLayer";
      layer.className = "achievement-unlock-layer";
      layer.setAttribute("aria-live", "polite");
      document.body.append(layer);
    }
    layer.innerHTML = `<article class="achievement-unlock-card ${achievementPresentationClass(first)}">
      <span class="achievement-unlock-kicker">${dollmasterAchievement ? "CROSSOVER COLLECTION UNLOCKED" : secretAchievement ? "SECRET ACHIEVEMENT UNLOCKED" : finalAchievement ? "FINAL ACHIEVEMENT UNLOCKED" : "ACHIEVEMENT UNLOCKED"}</span>
      <div><i aria-hidden="true">${escapeHtml(first.icon)}</i><span><strong>${escapeHtml(first.name)}</strong><small>${escapeHtml(first.description)}</small></span></div>
      ${finalAchievement ? '<b class="achievement-unlock-final"><span aria-hidden="true">✦</span> Lv.10・最終実績 <span aria-hidden="true">✦</span></b>' : ""}
      ${secretAchievement ? '<b class="achievement-unlock-secret"><span aria-hidden="true">✦</span> 負け役ロールプレイの秘密記録 <span aria-hidden="true">✦</span></b>' : ""}
      ${dollmasterAchievement ? '<b class="achievement-unlock-dollmaster"><span aria-hidden="true">✦</span> LIMITED LEGENDARY COLLECTION <span aria-hidden="true">✦</span></b>' : ""}
      ${ids.length > 1 ? `<p>ほか${ids.length - 1}件の実績も解除しました</p>` : ""}
    </article>`;
    layer.classList.add("is-visible");
    window.setTimeout(() => layer.classList.remove("is-visible"), dollmasterAchievement ? 5600 : secretAchievement ? 5200 : 4200);
  }

  function notify(value) {
    const ids = normalizeIds(value).filter((id) => {
      if (sessionSeen.has(id)) return false;
      sessionSeen.add(id);
      return true;
    });
    if (!ids.length) return;
    unlockQueue.push(...ids);
    if (unlockTimer) return;
    unlockTimer = window.setTimeout(showNextUnlock, 500);
  }

  window.addEventListener("hariai-achievements-unlocked", (event) => notify(event.detail?.ids || []));
  window.HariaiAchievements = Object.freeze({
    catalog,
    byId,
    normalizeIds,
    normalizeProfile,
    notify,
    orderUnlockIds,
    renderBadges,
    renderCollection,
  });
})();
