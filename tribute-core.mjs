// お貢ぎ牧場のクライアント側の規則。サーバーの tribute-rules.js と同じ判定を画面の前で行い、
// 送れない文や上限を超える金額を、送信前に知らせるために使う。最終判定は常にサーバー。

export const TRIBUTE_AGE_VERSION = "tribute-age-v1";

export const DEFINITION = "お貢ぎは、会わない前提で、金や残高の支配を権力交換の中心に置く遊びである。送金は敗北の確定であり、本体は管理が続くことである。ネカマ貢がせは、男性であることを隠さず同じ構造を行う確立したジャンルで、分かって渡すことが条件である。貼り合いとは隣り合うが別ゲームである。";

export const PREMISES = Object.freeze([
  "会わない前提の遊びです。現実のお金・PayPay・現金化・外部送金はありません。使うのは、アプリ内で稼いだ換金できない AnjuPay だけです。",
  "限度額（1回・1日・契約合計）は自分だけが見られる設定で、管理する側には見えません。解約はいつでもできます。",
  "管理する側の請求は断れません。払うか、解約するかです。払えない請求は、未払いのまま残ります。",
  "管理人カードと掲示板には、連絡先・SNSのID・外部決済・会う約束・住所や本名は書けません。契約後の会話では、外部決済・現金・現実の金額だけが送れません。",
  "辛口の侮蔑表現を含みます。言葉の強さ（甘め・普通・辛口）と「言われたくない言葉」は預ける側が決めます。",
]);

export const PER_TRIBUTE_OPTIONS = Object.freeze([10, 30, 50, 100, 300, 500, 1_000, 3_000, 5_000, 10_000]);
export const PER_DAY_OPTIONS = Object.freeze([30, 100, 300, 500, 1_000, 3_000, 5_000, 10_000, 30_000]);
export const TOTAL_OPTIONS = Object.freeze([100, 300, 1_000, 3_000, 5_000, 10_000, 30_000, 50_000, 100_000]);
// 契約の期間。サーバーの DURATION_DAYS_OPTIONS と同じ（14日・30日は2026-10-27に足した）。
export const DURATION_DAYS_OPTIONS = Object.freeze([1, 3, 7, 14, 30]);
const MAX_DURATION_DAYS = DURATION_DAYS_OPTIONS.at(-1);
export const ENTRY_FEE_OPTIONS = Object.freeze([0, 5, 10, 30, 50, 100]);
// 出稼ぎ命令の回数（命令の後の1on1の正式完走）。サーバーの WORK_ORDER_TARGETS と同じ。
export const WORK_ORDER_TARGETS = Object.freeze([1, 3, 5, 10]);
// 出稼ぎ命令の勝負の型（設計書15.3）。サーバーの CONTEST_TARGETS・CONTEST_DAYS・CONTEST_PENALTIES と同じ。
export const CONTEST_TARGETS = Object.freeze([1, 3, 5]);
export const CONTEST_DAYS = Object.freeze([1, 3]);
export const CONTEST_PENALTIES = Object.freeze([10, 30, 50, 100, 300]);
// 復唱の回数。サーバーの RECITE_TARGETS と同じ。
export const RECITE_TARGETS = Object.freeze([1, 3, 5]);

// 貢ぎオセロ（設計書15.2。サーバーの tribute-rules.js と同じ）。盤は64文字（"." 空き・"M" 管理人の石・"P" 財布の石＝Payのコイン）。左上から右へ、上の段から並べる。
// 運の要素は入れない。罰金は終わった時の石の差 × 1枚あたりの額（財布の1回の限度額まで）。
// ───────────── 牧場経営（設計書16） ─────────────
// 経験値は管理人と財布の間で起きた事実で積み、Pay の額では上げない。下がらない。サーバーの RANCH_* と同じ。
// 絵が増えるのは Lv30 まで、その先は数字だけ上がり続ける（Lv11 からは、次までの経験値が1段ごとに100ずつ増える）。
export const RANCH_LEVELS = Object.freeze([
  0, 20, 60, 120, 200, 320, 480, 700, 1000, 1400,
  1900, 2500, 3200, 4000, 4900, 5900, 7000, 8200, 9500, 10900,
  12400, 14000, 15700, 17500, 19400, 21400, 23500, 25700, 28000, 30400,
]);
export const RANCH_ART_LEVELS = RANCH_LEVELS.length;
// 動物ごとの「なつき」。その財布が通算で仕えた日数（契約をまたぐ）で、動物に飾りが増える。サーバーの RANCH_FONDNESS と同じ。
export const RANCH_FONDNESS = Object.freeze([
  Object.freeze({ tier: 1, days: 7, label: "鈴" }),
  Object.freeze({ tier: 2, days: 30, label: "リボン" }),
  Object.freeze({ tier: 3, days: 100, label: "花かんむり" }),
  Object.freeze({ tier: 4, days: 365, label: "金の王冠" }),
]);
export const RANCH_XP = Object.freeze({ accept: 5, servedDay: 3, receive: 1, confirm: 2, plea: 1, extend: 2 });
export const RANCH_XP_PAIR_DAY = 10;
// 第2段でヤギ・ニワトリ・ウサギを足した。選ぶ前の動物は第1段の3種から決める（サーバーの RANCH_DEFAULT_ANIMALS と同じ）。
export const RANCH_ANIMALS = Object.freeze(["cow", "pig", "sheep", "goat", "chicken", "rabbit"]);
export const RANCH_DEFAULT_ANIMALS = Object.freeze(["cow", "pig", "sheep"]);
export const RANCH_ANIMAL_LABELS = Object.freeze({ cow: "牛", pig: "豚", sheep: "羊", goat: "ヤギ", chicken: "ニワトリ", rabbit: "ウサギ" });
// 財布の鳴き声（設計書16.5。サーバーの RANCH_MOO と同じ）。20文字までの一言を3つまで。
export const RANCH_MOO = Object.freeze({ length: 20, lines: 3 });
// 牧場の名前（設計書16.15。サーバーの RANCH_NAME と同じ）。「○○牧場」の○○の部分を10文字まで。
export const RANCH_NAME = Object.freeze({ length: 10 });

// ───────────── 牧場の実績（設計書17） ─────────────
// 系統ごとの数の名前（サーバーの tributeAchievementStats と同じ。functions/achievements.js の TRIBUTE_STYLE_FAMILIES）。
const RANCH_ACHIEVEMENT_STAT_KEYS = Object.freeze({
  tribute_mgr_request: "mgrRequestPaid",
  tribute_mgr_break: "mgrBreak",
  tribute_mgr_ignore: "mgrIgnore",
  tribute_mgr_grant: "mgrGrant",
  tribute_mgr_deny: "mgrDeny",
  tribute_mgr_recite: "mgrRecite",
  tribute_mgr_work: "mgrWork",
  tribute_mgr_othello: "mgrOthello",
  tribute_mgr_collar: "mgrCollar",
  tribute_mgr_ranch: "mgrRanchLevel",
  tribute_mgr_pat: "mgrPatDays",
  tribute_wal_silent: "walSilentDays",
  tribute_wal_request: "walRequestPaid",
  tribute_wal_resist: "walResist",
  tribute_wal_granted: "walGranted",
  tribute_wal_denied: "walDenied",
  tribute_wal_words: "walWords",
  tribute_wal_recite: "walRecite",
  tribute_wal_work: "walWork",
  tribute_wal_othello: "walOthelloLost",
  tribute_wal_fondness: "walServedTop",
  tribute_wal_patted: "walPatted",
});
// 遊び方の型の実績と、シークレット。名前はユーザーが決めた（2026-10-30）。額では解除しない。連続日数は作らない。
// side: manager（貢がせ側）／wallet（貢ぐ側）。thresholds は回数（同じ相手とは日本時間の1日1回まで数える）。
export const RANCH_ACHIEVEMENT_FAMILIES = Object.freeze([
  ["tribute_mgr_request", "manager", "請", "請求", "払われた請求", [1, 3, 10, 30, 100], ["はじめての請求", "払わせ上手", "請求すれば財布が鳴る", "請求書の束", "請求台帳の主"]],
  ["tribute_mgr_break", "manager", "折", "抵抗を折る", "抵抗されたあとに払われた請求", [1, 3, 10, 30, 100], ["抵抗を折った", "渋っても無駄", "抵抗は想定内", "折れる音を知る人", "抵抗折りの名人"]],
  ["tribute_mgr_ignore", "manager", "既", "既読無視", "既読のまま返さなかった回数", [1, 3, 10, 30, 100], ["既読無視デビュー", "返事は気が向いたら", "沈黙で躾ける", "既読の支配者", "無視されたい財布の飼い主"]],
  ["tribute_mgr_grant", "manager", "許", "許す", "願い出を許した", [1, 3, 10, 30, 100], ["許可を出す人", "甘い飼い主", "待たせて許す", "許しの主", "慈悲深い牧場主"]],
  ["tribute_mgr_deny", "manager", "退", "退ける", "願い出を退けた", [1, 3, 10, 30, 100], ["退けた", "突き放す飼い主", "まだ早い", "却下の常連", "冷たい牧場主"]],
  ["tribute_mgr_recite", "manager", "唱", "復唱", "復唱を確かめた", [1, 3, 10, 30, 100], ["言わせた", "一字一句", "復唱の教官", "言葉で躾ける人", "復唱を聞き飽きた主"]],
  ["tribute_mgr_work", "manager", "稼", "出稼ぎ", "出稼ぎの完走を確かめた", [1, 3, 10, 30, 100], ["出稼ぎに出した", "働かせ上手", "出稼ぎの采配", "財布を稼がせる人", "出稼ぎ牧場の主"]],
  ["tribute_mgr_othello", "manager", "盤", "盤上", "貢ぎオセロで勝った", [1, 3, 10, 30, 100], ["盤上の初勝利", "石で黙らせる", "盤を支配する", "オセロの飼い主", "盤上に君臨する"]],
  ["tribute_mgr_collar", "manager", "輪", "首輪", "迎えた財布の数", [1, 3, 10, 30, 100], ["最初の首輪", "首輪を配る人", "首輪の引き出し", "三十の首輪", "百の首輪を知る人"]],
  ["tribute_mgr_ranch", "manager", "牧", "牧場", "牧場レベル", [5, 10, 20, 30], ["柵の中の小さな牧場", "金の牛の像が立つ", "サイロのある牧場", "お城の塔の主"]],
  ["tribute_mgr_pat", "manager", "撫", "なでる", "なでた日", [1, 10, 30, 100, 365], ["はじめてなでた", "なでる手", "なで慣れた飼い主", "百回なでた", "一年なでた手"]],
  ["tribute_wal_silent", "wallet", "自", "自分から", "請求なしで献上した日", [1, 3, 10, 30, 100], ["はじめての自発", "言われる前に差し出す", "自分から鳴る財布", "勝手に貢ぐ癖", "呼ばれる前に開く財布"]],
  ["tribute_wal_request", "wallet", "応", "請求に応える", "請求を払った", [1, 3, 10, 30, 100], ["請求に応えた", "請求には逆らえない", "請求されると弱い", "請求が来ると嬉しい", "請求待ちの財布"]],
  ["tribute_wal_resist", "wallet", "抗", "抵抗", "抵抗してから払った", [1, 3, 10, 30, 100], ["一応渋った", "渋るだけは渋る", "三回渋って結局払う", "抵抗は様式美", "抵抗の達人（でも払う）"]],
  ["tribute_wal_granted", "wallet", "願", "許された", "願い出を許された", [1, 3, 10, 30, 100], ["許された", "待てができる財布", "許しを乞うのが上手", "お預け上手", "許しの常連"]],
  ["tribute_wal_denied", "wallet", "却", "退けられた", "願い出を退けられた", [1, 3, 10, 30, 100], ["退けられた", "それでも願い出る", "却下され慣れた", "突き放されて喜ぶ財布", "不屈の願い出"]],
  ["tribute_wal_words", "wallet", "言", "言葉", "言葉の献上", [1, 3, 10, 30, 100], ["言葉を差し出した", "Payより言葉", "言葉で仕える財布", "手紙の多い財布", "言葉の献上の主"]],
  ["tribute_wal_recite", "wallet", "復", "復唱", "復唱した", [1, 3, 10, 30, 100], ["言わされた", "一字一句の財布", "復唱がうまくなった", "言わされ慣れた財布", "復唱の生き字引"]],
  ["tribute_wal_work", "wallet", "働", "出稼ぎ", "出稼ぎを完走した", [1, 3, 10, 30, 100], ["出稼ぎ帰り", "稼いでくる財布", "働く財布", "出稼ぎの常連", "牧場一の働き者"]],
  ["tribute_wal_othello", "wallet", "石", "盤上", "オセロに負けて罰金を差し出した", [1, 3, 10, 30, 100], ["盤上で負けた", "負けても盤に向かう", "石ごと差し出す", "負けの常連", "盤上の養分"]],
  ["tribute_wal_fondness", "wallet", "鈴", "なつき", "仕えた日", [7, 30, 100, 365], ["鈴の鳴る財布", "リボンの財布", "花かんむりの財布", "金の王冠の財布"]],
  ["tribute_wal_patted", "wallet", "掌", "なでられた", "なでてもらった日", [1, 10, 30, 100, 365], ["なでられた", "なでられ慣れた", "なでられ待ちの財布", "百回なでられた", "一年なでられた財布"]],
].map(([family, side, icon, label, unit, thresholds, names]) => Object.freeze({
  family, side, icon, label, unit, stat: RANCH_ACHIEVEMENT_STAT_KEYS[family], thresholds: Object.freeze(thresholds), names: Object.freeze(names),
})));

// シークレット（条件は隠し、1回で解除）。
export const RANCH_ACHIEVEMENT_SECRETS = Object.freeze([
  ["tribute_secret_resist3", "wallet", "三", "三回渋って、払う", "3回抵抗した請求を払った"],
  ["tribute_secret_both", "wallet", "両", "Payも言葉も", "同じ日に、献上と言葉の献上をした"],
  ["tribute_secret_second_plea", "wallet", "再", "二度目の願い出", "退けられたあと、同じお預けの間に許された"],
  ["tribute_secret_moo", "wallet", "鳴", "鳴いた財布", "牧場の鳴き声を書いた"],
  ["tribute_secret_mood", "manager", "気", "気分次第", "同じ日に、願い出を許すことと退けることを両方した"],
  ["tribute_secret_ignored_paid", "manager", "黙", "無視しても払われる", "既読無視の間に、請求が払われた"],
  ["tribute_secret_named", "manager", "名", "名付け親", "牧場に名前を付けた"],
].map(([id, side, icon, name, condition]) => Object.freeze({ id, side, icon, name, condition })));

// 枠の豪華さ（1〜5）。どの系統も最後の段階が5（いちばん豪華）になるよう、段階の数に合わせて割り当てる。
export function ranchAchievementTier(level, maxLevel) {
  const top = Math.max(1, Math.floor(Number(maxLevel) || 1));
  const value = Math.min(top, Math.max(1, Math.floor(Number(level) || 1)));
  return Math.max(1, Math.min(5, Math.ceil((value * 5) / top)));
}

// 「○○牧場」。名前がなければ「牧場」。
export function ranchTitle(name) {
  const text = String(name ?? "").trim();
  return text ? `${text}牧場` : "牧場";
}
// 天気と季節（設計書16.6）。
export const RANCH_SEASON_LABELS = Object.freeze({ spring: "春", summer: "夏", autumn: "秋", winter: "冬" });
export const RANCH_WEATHER_LABELS = Object.freeze({ sunny: "晴れ", cloudy: "曇り", rain: "雨", snow: "雪" });
// レベルで増える施設（見た目だけ）。
export const RANCH_FACILITIES = Object.freeze([
  Object.freeze({ level: 2, label: "柵" }),
  Object.freeze({ level: 3, label: "水飲み場" }),
  Object.freeze({ level: 4, label: "小屋" }),
  Object.freeze({ level: 5, label: "花畑" }),
  Object.freeze({ level: 6, label: "風車" }),
  Object.freeze({ level: 7, label: "池" }),
  Object.freeze({ level: 8, label: "納屋" }),
  Object.freeze({ level: 9, label: "時計台" }),
  Object.freeze({ level: 10, label: "金の牛の像" }),
  Object.freeze({ level: 11, label: "郵便受け" }),
  Object.freeze({ level: 12, label: "街灯" }),
  Object.freeze({ level: 13, label: "風見鶏" }),
  Object.freeze({ level: 14, label: "花の鉢" }),
  Object.freeze({ level: 15, label: "二階建ての家" }),
  Object.freeze({ level: 16, label: "石の小道" }),
  Object.freeze({ level: 17, label: "屋根の小鳥" }),
  Object.freeze({ level: 18, label: "たくさんのりんご" }),
  Object.freeze({ level: 19, label: "旗の飾り" }),
  Object.freeze({ level: 20, label: "サイロ" }),
  Object.freeze({ level: 21, label: "桜の木" }),
  Object.freeze({ level: 22, label: "噴水" }),
  Object.freeze({ level: 23, label: "風船" }),
  Object.freeze({ level: 24, label: "灯りの飾り" }),
  Object.freeze({ level: 25, label: "気球" }),
  Object.freeze({ level: 26, label: "虹" }),
  Object.freeze({ level: 27, label: "ちょうちょ" }),
  Object.freeze({ level: 28, label: "風車の花飾り" }),
  Object.freeze({ level: 29, label: "金の柵" }),
  Object.freeze({ level: 30, label: "お城の塔" }),
]);
// 絵の置き方（art/tribute-ranch/render_ranch.py の layout で書き出した値）。割合は、牧場の絵の幅・高さに対して。
export const RANCH_LAYOUT = Object.freeze({
  aspect: 960 / 600,
  // 動物の絵の本来の幅（牧場の絵の幅に対して）と、絵の中の足元の位置。画面では少し小さく出す（tribute.css の 17%）。
  spriteWidth: 2.9 / 12,
  foot: Object.freeze([0.5, 0.7226]),
  // 続けて置く動物どうしが離れるように並べてある（真ん中 → 左端 → 右 → 左手前 → 右奥 → 手前 …）。
  spots: Object.freeze([
    [0.5177, 0.5435], [0.2938, 0.5531], [0.6709, 0.5723], [0.4057, 0.7403], [0.612, 0.4859], [0.5412, 0.7739],
    [0.3998, 0.4955], [0.6532, 0.6539], [0.3704, 0.6443], [0.6945, 0.7547], [0.5177, 0.6587], [0.6237, 0.7739],
  ].map((spot) => Object.freeze(spot))),
  fence: Object.freeze([0.2908, 0.6707]),
  stake: Object.freeze([0.3409, 0.4379]),
  // 13頭目からは、同じ立ち位置の右手前・左手前・右奥・左奥に置く（Lv1・10・30 の絵で芝の上に収まることを確かめた）。
  crowd: Object.freeze([[0.045, 0.03], [-0.045, 0.03], [0.04, -0.025], [-0.04, -0.025]].map((offset) => Object.freeze(offset))),
});

// n 頭目（0 から）の立ち位置。12頭までは決まった立ち位置、その先は立ち位置の隣に並べる。
export function ranchSpot(index) {
  const { spots, crowd } = RANCH_LAYOUT;
  const position = Math.max(0, Math.floor(Number(index) || 0));
  const base = spots[position % spots.length];
  const ring = Math.floor(position / spots.length);
  if (!ring) return base;
  const [dx, dy] = crowd[(ring - 1) % crowd.length];
  return [base[0] + dx, base[1] + dy];
}

// そのレベルに必要な経験値の合計。Lv30 より上は、1段ごとに100ずつ増える。
export function ranchThreshold(level) {
  const target = Math.max(1, Math.floor(Number(level) || 1));
  if (target <= RANCH_LEVELS.length) return RANCH_LEVELS[target - 1];
  let need = RANCH_LEVELS[RANCH_LEVELS.length - 1];
  for (let next = RANCH_LEVELS.length + 1; next <= target; next += 1) need += 100 * (next - 6);
  return need;
}

// 通算で仕えた日数の見え方（サーバーの servedTotalView と同じ）。
export function servedTotalView(raw, now = Date.now()) {
  if (raw?.servedTotal !== undefined && raw?.servedTotal !== null) return integer(raw.servedTotal);
  const acceptedAt = integer(raw?.acceptedAt);
  return acceptedAt > 0 ? Math.min(integer(raw?.tributeCount), Math.floor(Math.max(0, now - acceptedAt) / 86_400_000) + 1) : 0;
}

export function ranchLevelFor(xp) {
  const value = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  while (level < 100_000 && value >= ranchThreshold(level + 1)) level += 1;
  return level;
}


export function defaultRanchAnimal(contractId) {
  let sum = 0;
  for (const char of String(contractId || "")) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
  return RANCH_DEFAULT_ANIMALS[sum % RANCH_DEFAULT_ANIMALS.length];
}

// 次のレベルまでの進み具合。天井はない。artLevel は絵のレベル（Lv30 まで）。
export function ranchProgress(xp) {
  const value = Math.max(0, Math.floor(Number(xp) || 0));
  const level = ranchLevelFor(value);
  const floor = ranchThreshold(level);
  const next = ranchThreshold(level + 1);
  return { xp: value, level, artLevel: Math.min(level, RANCH_ART_LEVELS), floor, next, toNext: next - value, ratio: (value - floor) / (next - floor) };
}

// なつき（飾りの段階）。サーバーの ranchFondness と同じ。
export function ranchFondness(days) {
  const value = Math.max(0, Math.floor(Number(days) || 0));
  let current = null;
  for (const step of RANCH_FONDNESS) if (value >= step.days) current = step;
  const next = RANCH_FONDNESS.find((step) => step.days > value) || null;
  return { days: value, tier: current ? current.tier : 0, label: current ? current.label : "", next: next ? { days: next.days, label: next.label, left: next.days - value } : null };
}

// 日本時間の時間帯。朝（6〜10時）・昼（10〜17時）・夕方（17〜19時）・夜（19〜6時）。絵は朝と昼で同じ。
export function ranchTimeOfDay(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  if (hour >= 6 && hour < 10) return "morning";
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 17 && hour < 19) return "evening";
  return "night";
}

// 天気と季節（設計書16.6）。日本時間の日付だけで決まる（同じ日は誰が見ても同じ。サーバーには何も足さない）。
// 季節は月（3〜5月 春・6〜8月 夏・9〜11月 秋・12〜2月 冬）、天気は日付から決まる晴れ・曇り・雨（冬は雨の代わりに雪）。
export function ranchWeather(now = Date.now()) {
  const key = jstDateKey(now);
  const month = Number(key.slice(5, 7));
  const season = month >= 3 && month <= 5 ? "spring" : month >= 6 && month <= 8 ? "summer" : month >= 9 && month <= 11 ? "autumn" : "winter";
  const day = Math.floor(Date.parse(`${key}T00:00:00Z`) / 86_400_000);
  let hash = Math.imul(day ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  const roll = (hash >>> 0) % 100;
  const weather = roll < 50 ? "sunny" : roll < 78 ? "cloudy" : season === "winter" ? "snow" : "rain";
  return { season, weather, label: `${RANCH_SEASON_LABELS[season]}・${RANCH_WEATHER_LABELS[weather]}` };
}

function jstHour(now) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
}

// 動物のようす（設計書16.5）。いまの契約の状態だけで決める。語り手の一言は三人称の事実だけ（財布の言葉として作らない）。
// 優先の順: 出かけている → 眠っている → つながれている → 願い出 → 届け物 → 未払い → 今日の献上 → 3日以上なにもない → のんびり。
// 財布の「牧場をのぞく」（payer）では、管理人の画面にだけ出る事実（未払い・3日以上なにもない）を出さない。
// のんびりしている時の一言は、その日の天気で変わる。
export function ranchAnimalMood(contract, now = Date.now(), { payer = false } = {}) {
  const order = contract?.workOrder;
  if (order && !order.done && (order.kind !== "contest" || order.accepted)) return { mood: "away", line: "{name}は出稼ぎに出ている。" };
  const hour = jstHour(now);
  if (hour >= 23 || hour < 6) return { mood: "sleep", line: "{name}は眠っている。" };
  if (contract?.hold) return { mood: "tied", line: "{name}はつながれて、おとなしくしている。" };
  if (contract?.plea && !contract.plea.granted) return { mood: "plea", line: "{name}が柵のそばで、許しを待っている。" };
  if (Number(contract?.awaitingReceipt) > 0) return { mood: "letter", line: "{name}の届け物が、受け取りを待っている。" };
  if (!payer && Array.isArray(contract?.pendingRequests) && contract.pendingRequests.length) return { mood: "restless", line: "{name}は落ち着かない様子。" };
  if (Number(contract?.todayTributed) > 0) return { mood: "eat", line: "{name}は干し草をもらってご機嫌。" };
  const last = String(contract?.lastServedDayKey || "") || jstDateKey(Number(contract?.acceptedAt) || now);
  if (!payer && jstDateKey(now - 3 * 86_400_000) >= last) return { mood: "gaze", line: "{name}は柵の外を見ている。" };
  const weather = ranchWeather(now).weather;
  if (weather === "rain") return { mood: "idle", line: "{name}は屋根の下で、雨の音を聞いている。" };
  if (weather === "snow") return { mood: "idle", line: "{name}は雪を見上げている。" };
  if (weather === "cloudy") return { mood: "idle", line: "{name}は草の上でのんびりしている。" };
  return { mood: "idle", line: "{name}は日なたでのんびりしている。" };
}

// 日報（設計書16.7）。前に見た時の数（この端末にだけ残す）と比べて、留守の間の出来事を新しい順に5行まで作る。
// snapshot: { [contractId]: { name, tributeCount, totalTributed, wordOfferings, workOrdersDone, contestWon } }
export function ranchSnapshot(rows) {
  return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [row.contractId, {
    name: String(row.name || ""),
    tributeCount: integer(row.tributeCount),
    totalTributed: integer(row.totalTributed),
    wordOfferings: integer(row.wordOfferings),
    workOrdersDone: integer(row.workOrdersDone),
    contestWon: integer(row.contestWon),
    servedTotal: integer(row.servedTotal),
  }]));
}

export function ranchDiary(previous, current, { limit = 5 } = {}) {
  if (!previous || typeof previous !== "object") return [];
  const lines = [];
  for (const [contractId, now] of Object.entries(current || {})) {
    const before = previous[contractId];
    if (!before) {
      lines.push(`${now.name}が牧場に来た。`);
      continue;
    }
    const gifts = now.tributeCount - before.tributeCount;
    const pay = now.totalTributed - before.totalTributed;
    if (gifts > 0 && pay > 0) lines.push(`${now.name}が干し草（${formatPay(pay)}）を置いていった${gifts > 1 ? `（${gifts}回）` : ""}。`);
    const letters = now.wordOfferings - before.wordOfferings;
    if (letters > 0) lines.push(`${now.name}から手紙（言葉の献上）が${letters > 1 ? `${letters}通` : ""}届いた。`);
    if (now.workOrdersDone > before.workOrdersDone) lines.push(`${now.name}が出稼ぎから戻った。`);
    if (now.contestWon > before.contestWon) lines.push(`${now.name}が勝負に勝って戻った。`);
    const fondness = ranchFondness(now.servedTotal);
    if (fondness.tier > ranchFondness(before.servedTotal).tier) lines.push(`${now.name}は仕えた日が${fondness.days}日になり、${fondness.label}をつけた。`);
  }
  for (const [contractId, before] of Object.entries(previous)) {
    if (!(current || {})[contractId]) lines.push(`${before.name}は牧場を出ていった。`);
  }
  return lines.slice(0, limit);
}

export const OTHELLO_RATES = Object.freeze([1, 5, 10]);
export const OTHELLO_HANDICAPS = Object.freeze(["none", "manager_corner", "payer_corner"]);
const OTHELLO_DIRECTIONS = Object.freeze([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
export const OTHELLO_CORNERS = Object.freeze([0, 7, 56, 63]);

export function othelloSide(role) {
  return role === "manager" ? "M" : "P";
}

// 始めの盤。ハンデは左上の角（a1）を、管理人が持って始めるか、財布にあげるか。
export function othelloInitialBoard(handicap = "none") {
  const cells = Array(64).fill(".");
  cells[27] = "M";
  cells[36] = "M";
  cells[28] = "P";
  cells[35] = "P";
  if (handicap === "manager_corner") cells[0] = "M";
  if (handicap === "payer_corner") cells[0] = "P";
  return cells.join("");
}

export function othelloBoardValid(board) {
  return typeof board === "string" && /^[.MP]{64}$/.test(board);
}

// その手でひっくり返る石の位置。打てない手は空。
export function othelloFlips(board, side, index) {
  if (!othelloBoardValid(board) || !Number.isInteger(index) || index < 0 || index > 63 || board[index] !== ".") return [];
  const other = side === "M" ? "P" : "M";
  const row = Math.floor(index / 8);
  const column = index % 8;
  const flips = [];
  for (const [dr, dc] of OTHELLO_DIRECTIONS) {
    const line = [];
    let r = row + dr;
    let c = column + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === other) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === side) flips.push(...line);
  }
  return flips;
}

export function othelloMoves(board, side) {
  const moves = [];
  for (let index = 0; index < 64; index += 1) {
    if (othelloFlips(board, side, index).length) moves.push(index);
  }
  return moves;
}

export function othelloPlay(board, side, index) {
  const flips = othelloFlips(board, side, index);
  if (!flips.length) return { error: "そこには打てません。" };
  const cells = board.split("");
  cells[index] = side;
  for (const flip of flips) cells[flip] = side;
  return { board: cells.join(""), flipped: flips.length, corner: OTHELLO_CORNERS.includes(index) };
}

export function othelloCount(board) {
  let manager = 0;
  let payer = 0;
  for (const cell of othelloBoardValid(board) ? board : "") {
    if (cell === "M") manager += 1;
    else if (cell === "P") payer += 1;
  }
  return { manager, payer, empty: 64 - manager - payer };
}

// 打った後の手番。相手が打てなければ同じ側が続け（相手はパス）、どちらも打てなければ終局（空）。
export function othelloNextTurn(board, movedRole) {
  const other = movedRole === "manager" ? "payer" : "manager";
  if (othelloMoves(board, othelloSide(other)).length) return { turn: other, passed: "" };
  if (othelloMoves(board, othelloSide(movedRole)).length) return { turn: movedRole, passed: other };
  return { turn: "", passed: "" };
}

// 決着。財布が負けた時だけ罰金。降参は、その時の差と1枚分の大きい方。
export function othelloOutcome(board, rate, { resigned = false } = {}) {
  const { manager, payer } = othelloCount(board);
  const diff = manager - payer;
  const result = resigned || diff > 0 ? "lost" : diff < 0 ? "won" : "draw";
  const stones = result === "lost" ? Math.max(diff, 1) : 0;
  return { result, manager, payer, stones, penalty: stones * (OTHELLO_RATES.includes(Number(rate)) ? Number(rate) : 0) };
}

export const LIMITS = Object.freeze({
  personaName: 16,
  intro: 60,
  walletName: 16,
  nickname: 12,
  ngWordCount: 5,
  ngWordLength: 12,
  wantWordCount: 5,
  wantWordLength: 12,
  // 抵抗は、未払いの請求1件に3回まで（サーバーと同じ）。
  resistsPerRequest: 3,
  // 言葉の献上と、管理人の自分の言葉（サーバーと同じ）。
  wordOffering: 400,
  wordOfferingsPerDay: 3,
  ownLines: 10,
  ownLineLength: 60,
  ownRewards: 5,
  ownRewardLength: 12,
  sealWordLength: 7,
  message: 240,
  requestNote: 60,
  pendingRequests: 3,
  payerOpenContracts: 5,
  feeRateBasisPoints: 500,
  minimumFee: 1,
  // 管理人の請求は1回10,000 Payまで（財布の限度額には関係しない）。
  requestMax: 10_000,
  // 1回の限度額を3,000 Pay以上にできるのは、Google で保護した財布だけ。
  googleCapThreshold: 3_000,
  // 掲示板には直近7日に動いた管理人だけが並ぶ。外れる2日前から管理人に知らせる。
  boardActiveWindowMs: 7 * 24 * 60 * 60 * 1_000,
  boardNoticeMs: 2 * 24 * 60 * 60 * 1_000,
});

export const TONE_LABELS = Object.freeze({ sweet: "甘め", normal: "普通", harsh: "辛口" });
// 契約の言葉の強さは、財布が決める「ここまでなら言われてもいい」の上限。管理人は上限までの強さから選ぶ。
export const TONE_CEILING_LABELS = Object.freeze({ sweet: "甘めまで", normal: "普通まで", harsh: "辛口まで" });
const TONE_ORDER = Object.freeze(["sweet", "normal", "harsh"]);

// 上限までの強さを、弱い順に返す（サーバーの tonesUpTo と同じ）。
export function tonesUpTo(tone) {
  const index = TONE_ORDER.indexOf(tone);
  return TONE_ORDER.slice(0, (index < 0 ? TONE_ORDER.indexOf("normal") : index) + 1);
}
export const DISCLOSURE_LABELS = Object.freeze({
  nekama: "ネカマ（中身は男）",
  as_is: "演じていない",
  undisclosed: "非開示",
});
export const DISCLOSURE_SHORT = Object.freeze({ nekama: "ネカマ", as_is: "素", undisclosed: "非開示" });
// 管理の型（2026-10-27 に5つへ。サーバーの MANAGER_STYLES と同じ）。管理人はカードに1つか2つ選ぶ。
// 2つの型の主と副（ギャップ）はカードでは伝えないので、並びはいつもこの順にする。
// それまでの3つ（罵倒・事務的・甘やかし、カードの style）は解除し、選び直してもらう（読まない）。
export const MANAGER_STYLES = Object.freeze([
  Object.freeze({ id: "insight", label: "見透かす", hint: "敬語で淡々と、本心を言い当てる" }),
  Object.freeze({ id: "manage", label: "管理する", hint: "約束・報告・規律で縛る" }),
  Object.freeze({ id: "tease", label: "煽る", hint: "甘い声で笑って、突き放す" }),
  Object.freeze({ id: "pamper", label: "甘やかす", hint: "肯定して、お礼を言わせる" }),
  Object.freeze({ id: "aloof", label: "突き放す", hint: "気まぐれで、手が届かない" }),
]);
export const MAX_MANAGER_STYLES = 2;
export const STYLE_LABELS = Object.freeze(Object.fromEntries(MANAGER_STYLES.map((style) => [style.id, style.label])));

// サーバーの normalizeStyles と同じ: 知らない型は捨て、重なりをなくし、一覧の順にそろえる（2つまで）。
export function normalizeStyles(value) {
  const chosen = new Set((Array.isArray(value) ? value : []).map(String));
  return MANAGER_STYLES.map((style) => style.id).filter((id) => chosen.has(id)).slice(0, MAX_MANAGER_STYLES);
}

// カードの型の札（「見透かす・煽る」）。選び直す前のカードは空。
export function stylesLabel(card) {
  return normalizeStyles(card?.styles).map((id) => STYLE_LABELS[id]).join("・");
}
export const SIGIL_COLORS = Object.freeze(["#ff4fa3", "#b48cff", "#5fd4ff", "#ffd166", "#7ee08a", "#ff7a59"]);
// 管理人の印のアイコン。id 0 はペルソナ名の1文字。画像はアップロードできず、ここにある48種から選ぶ。
// 1〜6 はゆるめの絵、7〜12 は同じ6人の大人びた絵。13〜16 は写真・地雷系、17〜23 は写真・夜ギャル（無料）。
// 24〜29 はパステル調のミニイラスト、30〜35 は同じ6人の等身イラスト。既存の番号は変えない。
// 36〜48 は有料（1枚 500 Pay の買い切り。四角に印の色の縁とホログラムで出す）。商品は tribute-deco.mjs の PREMIUM_AVATARS。
export const AVATAR_GROUPS = Object.freeze([
  Object.freeze({ id: "premium", label: "有料・四角（各500 Pay）" }),
  Object.freeze({ id: "illust", label: "イラスト" }),
  Object.freeze({ id: "jirai", label: "写真・地雷系" }),
  Object.freeze({ id: "gal", label: "写真・夜ギャル" }),
]);
export const AVATARS = Object.freeze([
  Object.freeze({ id: 1, group: "illust", label: "地雷" }),
  Object.freeze({ id: 2, group: "illust", label: "量産" }),
  Object.freeze({ id: 3, group: "illust", label: "ギャル" }),
  Object.freeze({ id: 4, group: "illust", label: "ゆめかわ" }),
  Object.freeze({ id: 5, group: "illust", label: "サブカル" }),
  Object.freeze({ id: 6, group: "illust", label: "あざと" }),
  Object.freeze({ id: 7, group: "illust", label: "地雷（艶）" }),
  Object.freeze({ id: 8, group: "illust", label: "量産（艶）" }),
  Object.freeze({ id: 9, group: "illust", label: "ギャル（艶）" }),
  Object.freeze({ id: 10, group: "illust", label: "ゆめかわ（艶）" }),
  Object.freeze({ id: 11, group: "illust", label: "サブカル（艶）" }),
  Object.freeze({ id: 12, group: "illust", label: "あざと（艶）" }),
  Object.freeze({ id: 13, group: "jirai", label: "地雷（白金）" }),
  Object.freeze({ id: 14, group: "jirai", label: "地雷（眼鏡）" }),
  Object.freeze({ id: 15, group: "jirai", label: "地雷（うさぎ）" }),
  Object.freeze({ id: 16, group: "jirai", label: "地雷（銀メッシュ）" }),
  Object.freeze({ id: 17, group: "gal", label: "夜ギャル（金髪）" }),
  Object.freeze({ id: 18, group: "gal", label: "夜ギャル（黒髪）" }),
  Object.freeze({ id: 19, group: "gal", label: "夜ギャル（まとめ髪）" }),
  Object.freeze({ id: 20, group: "gal", label: "夜ギャル（サングラス）" }),
  Object.freeze({ id: 21, group: "gal", label: "夜ギャル（赤）" }),
  Object.freeze({ id: 22, group: "gal", label: "夜ギャル（頬杖）" }),
  Object.freeze({ id: 23, group: "gal", label: "夜ギャル（ファー）" }),
  Object.freeze({ id: 24, group: "illust", label: "パステル・黒髪リボン（ミニ）" }),
  Object.freeze({ id: 25, group: "illust", label: "パステル・桃髪ボブ（ミニ）" }),
  Object.freeze({ id: 26, group: "illust", label: "パステル・金髪カチューシャ（ミニ）" }),
  Object.freeze({ id: 27, group: "illust", label: "パステル・青髪ショート（ミニ）" }),
  Object.freeze({ id: 28, group: "illust", label: "パステル・茶髪ツイン（ミニ）" }),
  Object.freeze({ id: 29, group: "illust", label: "パステル・紫髪リボン（ミニ）" }),
  Object.freeze({ id: 30, group: "illust", label: "パステル・黒髪リボン（等身）" }),
  Object.freeze({ id: 31, group: "illust", label: "パステル・桃髪ボブ（等身）" }),
  Object.freeze({ id: 32, group: "illust", label: "パステル・金髪カチューシャ（等身）" }),
  Object.freeze({ id: 33, group: "illust", label: "パステル・青髪ショート（等身）" }),
  Object.freeze({ id: 34, group: "illust", label: "パステル・茶髪ツイン（等身）" }),
  Object.freeze({ id: 35, group: "illust", label: "パステル・紫髪リボン（等身）" }),
  Object.freeze({ id: 36, group: "premium", label: "有料・桜色" }),
  Object.freeze({ id: 37, group: "premium", label: "有料・珊瑚色" }),
  Object.freeze({ id: 38, group: "premium", label: "有料・シャンパン" }),
  Object.freeze({ id: 39, group: "premium", label: "有料・抹茶" }),
  Object.freeze({ id: 40, group: "premium", label: "有料・白桃" }),
  Object.freeze({ id: 41, group: "premium", label: "有料・藤色" }),
  Object.freeze({ id: 42, group: "premium", label: "有料・空色" }),
  Object.freeze({ id: 43, group: "premium", label: "有料・ミルクティー" }),
  Object.freeze({ id: 44, group: "premium", label: "有料・瑠璃" }),
  Object.freeze({ id: 45, group: "premium", label: "有料・琥珀" }),
  Object.freeze({ id: 46, group: "premium", label: "有料・ネオン" }),
  Object.freeze({ id: 47, group: "premium", label: "有料・深紅" }),
  Object.freeze({ id: 48, group: "premium", label: "有料・ルージュ" }),
]);
export const AVATAR_MAX = AVATARS.length;

export function avatarId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 && id <= AVATAR_MAX ? id : 0;
}

export function avatarUrl(value) {
  const id = avatarId(value);
  return id ? new URL(`./assets/tribute-avatars/avatar-${String(id).padStart(2, "0")}.webp`, import.meta.url).href : "";
}
// 請求と献上の名目。サーバーの PURPOSES と同じ。sexual の名目は、預ける側が契約で許した時だけ使え、表示もする。
export const PURPOSES = Object.freeze([
  Object.freeze({ id: "management", label: "管理費", sexual: false }),
  Object.freeze({ id: "reward_fee", label: "ご褒美代", sexual: false }),
  Object.freeze({ id: "penalty", label: "罰金", sexual: false }),
  Object.freeze({ id: "edging", label: "寸止め料", sexual: true }),
  Object.freeze({ id: "release", label: "射精料", sexual: true }),
  Object.freeze({ id: "leak_penalty", label: "お漏らし罰金", sexual: true }),
]);
const PURPOSE_IDS = Object.freeze(PURPOSES.map((purpose) => purpose.id));
const SEXUAL_PURPOSE_IDS = Object.freeze(PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.id));
export const SEXUAL_PURPOSE_SUMMARY = PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.label).join("・");

// 受け取った時に添える短い承認。サーバーの REWARDS と同じ。押すのは毎回管理人で、上限までのどの強さからも選べる。
export const REWARDS = Object.freeze([
  Object.freeze({ id: "gohoubi", label: "ご褒美♡", tones: Object.freeze(["sweet", "normal", "harsh"]) }),
  Object.freeze({ id: "fufu", label: "ふふ♡ご褒美♡", tones: Object.freeze(["sweet", "normal", "harsh"]) }),
  Object.freeze({ id: "iiko", label: "いい子♡", tones: Object.freeze(["sweet", "normal"]) }),
  Object.freeze({ id: "erai", label: "えらいね", tones: Object.freeze(["sweet", "normal"]) }),
  Object.freeze({ id: "arigato", label: "ありがと♡", tones: Object.freeze(["sweet"]) }),
  Object.freeze({ id: "yoku", label: "よくできました", tones: Object.freeze(["normal"]) }),
  Object.freeze({ id: "zako", label: "ざこ♡", tones: Object.freeze(["harsh"]) }),
  Object.freeze({ id: "soreppocchi", label: "それっぽっち？", tones: Object.freeze(["harsh"]) }),
  Object.freeze({ id: "tsugi", label: "次も持ってきな", tones: Object.freeze(["harsh"]) }),
  Object.freeze({ id: "mata", label: "また来てね♡", tones: Object.freeze(["sweet"]) }),
  Object.freeze({ id: "suki", label: "好き♡", tones: Object.freeze(["sweet"]) }),
  // 管理の型ごとのご褒美（2026-10-27）。その型を選んだ管理人にだけ出す（style）。性的な言葉は使わない。
  Object.freeze({ id: "tadashii", label: "正しい判断です", tones: Object.freeze(["sweet"]), style: "insight" }),
  Object.freeze({ id: "mitooshi", label: "お見通しです", tones: Object.freeze(["normal"]), style: "insight" }),
  Object.freeze({ id: "soutei", label: "想定どおりです", tones: Object.freeze(["harsh"]), style: "insight" }),
  Object.freeze({ id: "yakusoku", label: "約束どおりだね", tones: Object.freeze(["sweet"]), style: "manage" }),
  Object.freeze({ id: "kiroku", label: "記録しました", tones: Object.freeze(["normal"]), style: "manage" }),
  Object.freeze({ id: "kijitsu", label: "次も期日を守ること", tones: Object.freeze(["harsh"]), style: "manage" }),
  Object.freeze({ id: "eraierai", label: "えらいえらい♡", tones: Object.freeze(["sweet"]), style: "tease" }),
  Object.freeze({ id: "choroi", label: "ちょろいね♡", tones: Object.freeze(["normal"]), style: "tease" }),
  Object.freeze({ id: "matamake", label: "また負けたね♡", tones: Object.freeze(["harsh"]), style: "tease" }),
  Object.freeze({ id: "yokudekita", label: "よくできたね♡", tones: Object.freeze(["sweet"]), style: "pamper" }),
  Object.freeze({ id: "erasugi", label: "えらすぎ♡", tones: Object.freeze(["sweet"]), style: "pamper" }),
  Object.freeze({ id: "oreiha", label: "お礼は？", tones: Object.freeze(["normal"]), style: "pamper" }),
  Object.freeze({ id: "tamaniha", label: "たまにはいいね", tones: Object.freeze(["sweet"]), style: "aloof" }),
  Object.freeze({ id: "fuun", label: "ふーん", tones: Object.freeze(["normal"]), style: "aloof" }),
  Object.freeze({ id: "maamaa", label: "まあまあ", tones: Object.freeze(["harsh"]), style: "aloof" }),
]);
// 財布の「言われたい言葉」をご褒美に使った時の印（サーバーの REWARD_WORD と同じ）。言葉そのものは rewardText に残る。
export const REWARD_WORD = "word";
export const RECEIVABLE_KINDS = Object.freeze(["request", "silent"]);

// 管理人の受取印。サーバーの SEALS と同じ。カードに3つまで登録し、受け取る時に1つ選んで押す。
export const SEALS = Object.freeze([
  Object.freeze({ id: "kakunin", label: "確認済" }),
  Object.freeze({ id: "juryo", label: "受領" }),
  Object.freeze({ id: "yoku", label: "よくできました" }),
  Object.freeze({ id: "gokaku", label: "合格" }),
  Object.freeze({ id: "zako", label: "雑魚" }),
  Object.freeze({ id: "youbun", label: "養分" }),
  Object.freeze({ id: "gokurou", label: "ご苦労" }),
]);
export const DEFAULT_SEALS = Object.freeze(["juryo", "yoku", "kakunin"]);
export const MAX_SEALS = 3;

// 管理人の自分の言葉の受取印は「word:言葉」で一覧の印と混ぜて登録し、記録にも言葉そのものが残る（サーバーと同じ）。
export const SEAL_WORD_PREFIX = "word:";

export function sealLabel(id) {
  const value = String(id ?? "");
  if (value.startsWith(SEAL_WORD_PREFIX)) return Array.from(value.slice(SEAL_WORD_PREFIX.length)).slice(0, LIMITS.sealWordLength).join("");
  return SEALS.find((seal) => seal.id === value)?.label || "";
}

// 受け取る時に選べる印。サーバーの sealFor と同じく、言われたくない言葉に当たる印は出さない。
export function sealsFor(cardSeals, ngWords = []) {
  const ids = Array.isArray(cardSeals) && cardSeals.length ? cardSeals : DEFAULT_SEALS;
  const usable = ids.filter((id) => (SEALS.some((seal) => seal.id === id) || String(id).startsWith(SEAL_WORD_PREFIX)) && sealLabel(id) && !containsNgWord(sealLabel(id), ngWords));
  return usable.length ? usable : ["juryo"];
}

// 請求の一言の候補（2026-10-27 に見直し）。名目ごとの一言と、管理人の型ごとの一言を並べる。
// どれも強さの札を持ち、契約の言葉の強さ（財布が決めた上限）以下のものだけを出す。
// 決まり（財布側の note の分析から。functions/docs/TRIBUTE_WALLET_PSYCHOLOGY.md）:
// - お願いや営業の形にしない（言い切るか、命令する）。払う理由を言い切り、対象のない言葉で終えない。
// - 「今だけ」「あなただけ」のような急かし、脅し、過去の献上を持ち出す言い方は使わない。
// - 1文で短く。読み違える漢字はひらがなに開く。♥ は使わず、♡ は文末だけ。
// 性的な名目の一言は、その名目を選べる契約（財布が許した契約）でだけ出る。型の一言は性的な言葉を使わない。
const note = (text, tone) => Object.freeze({ text, tone });
export const REQUEST_NOTES = Object.freeze({
  "": Object.freeze([note("今日の分。", "normal"), note("遅れずに。", "normal"), note("今日の分、置いていってね。", "sweet")]),
  management: Object.freeze([note("今月の管理費。", "normal"), note("管理費、遅れずに。", "normal"), note("今月の管理費、ちゃんと預かるね。", "sweet")]),
  reward_fee: Object.freeze([note("ご褒美が欲しいなら先に払いな。", "harsh"), note("ご褒美代。", "normal"), note("ご褒美代、先にね。", "sweet")]),
  penalty: Object.freeze([note("罰金。言い訳は聞かない。", "harsh"), note("待たせた罰金。", "normal"), note("罰金だよ。次は気をつけようね。", "sweet")]),
  edging: Object.freeze([note("まだイかせない。", "harsh"), note("寸止め料、払え。", "harsh")]),
  release: Object.freeze([note("イきたいなら払え。", "harsh"), note("イく許可、買う？", "normal")]),
  leak_penalty: Object.freeze([note("勝手にイったね。罰金。", "harsh"), note("許可なくイった罰金。", "normal")]),
});
export const STYLE_REQUEST_NOTES = Object.freeze({
  insight: Object.freeze([
    note("ちゃんと分かっていますよ。今日の分です。", "sweet"),
    note("払う理由は、あなたが一番よく分かっていますね。", "normal"),
    note("迷っているふりは要りません。どうぞ。", "normal"),
    note("言い訳を考えている顔ですね。先に払いなさい。", "harsh"),
  ]),
  manage: Object.freeze([
    note("今月もきちんと続けようね。今日の分。", "sweet"),
    note("約束の分です。期日は守ること。", "normal"),
    note("決めた額です。遅れたら記録に残します。", "normal"),
    note("報告が遅れた分も含めて、今日中に。", "harsh"),
  ]),
  tease: Object.freeze([
    note("今日もちゃんと来たね。えらいえらい♡", "sweet"),
    note("また来たんだ。分かりやすいね♡", "normal"),
    note("払うしかないの、自分でも分かってるでしょ♡", "harsh"),
    note("我慢できなかったんだ。かわいそ♡", "harsh"),
  ]),
  pamper: Object.freeze([
    note("今日もえらかったね。ご褒美代、置いていって。", "sweet"),
    note("お礼も忘れずにね。今日の分。", "sweet"),
    note("払えたら、ちゃんと褒めてあげる。", "normal"),
  ]),
  aloof: Object.freeze([
    note("たまには相手してあげる。今日の分ね。", "sweet"),
    note("払うなら勝手にどうぞ。見てないけど。", "normal"),
    note("今日の分。返事は期待しないで。", "normal"),
    note("用があるのはお財布だけ。", "harsh"),
  ]),
});

// 貢ぎオセロの一手に添える一言の候補（設計書15.2）。場面（角を取った・ひっくり返した・財布がパスした・終局）ごとに、
// 管理人が選んだ型ごと・強さごとに用意する（型を選んでいない管理人には、型のない一言）。請求の一言と同じ決まりで、性的な言葉は使わない。
export const OTHELLO_SITUATIONS = Object.freeze([
  Object.freeze({ id: "corner", label: "角を取った" }),
  Object.freeze({ id: "flip", label: "ひっくり返した" }),
  Object.freeze({ id: "pass", label: "財布がパスした" }),
  Object.freeze({ id: "finish", label: "終局" }),
]);
const othelloSet = (corner, flip, pass, finish) => Object.freeze({ corner: Object.freeze(corner), flip: Object.freeze(flip), pass: Object.freeze(pass), finish: Object.freeze(finish) });
// 並びは [甘め, 普通, 辛口]。
export const OTHELLO_LINES = Object.freeze({
  "": othelloSet(
    ["角、もらうね。", "角はいただき。", "角も取れないの？"],
    ["私の色が増えてきたね。", "また何枚か奪ったよ。", "ほら、また奪われた。"],
    ["打てないなら、待っててね。", "打つ場所、ないみたい。", "パスしかできないの？"],
    ["おしまい。よく頑張ったね。", "終局。罰金の時間。", "負け。約束どおり払って。"],
  ),
  insight: othelloSet(
    ["角はいただきますね。分かっていたでしょう。", "その角、空けておくと思っていました。", "角を明け渡すのも、想定どおりです。"],
    ["少しずつ、私の色になっていきますね。", "その数だけ、あなたの負けが見えます。", "ひっくり返されるのも、読みどおりです。"],
    ["打てませんね。そのまま待っていなさい。", "打つ場所、もうありませんよ。", "打てないのは、読みが浅いからです。"],
    ["よく頑張りました。結果はこのとおりです。", "数えるまでもありませんね。", "最初から、こうなると分かっていました。"],
  ),
  manage: othelloSet(
    ["角は管理人のもの、覚えておこうね。", "角はこちらで預かります。", "角まで管理される自覚を持ちなさい。"],
    ["ひっくり返った分、きちんと数えておこうね。", "奪った枚数は記録しておきます。", "一枚残らず、こちらで管理する。"],
    ["今は待つ番。ちゃんと待てるよね。", "打てない時は、待つのがルール。", "打てないなら黙って待て。"],
    ["最後までやり切れたね。罰金はきちんと。", "終局。罰金の約束は守ること。", "負けは負け。約束どおり払いなさい。"],
  ),
  tease: othelloSet(
    ["角、もーらいっ♡", "角あけといてくれたの？やさしー♡", "角取られて固まってるの、丸見え♡"],
    ["くるくる私の色になってくね♡", "また奪われちゃったね♡", "ひっくり返されるの、好きでしょ♡"],
    ["打てないの？かわいそ♡", "パスしかできないんだ♡", "打つとこないの、ざまぁないね♡"],
    ["おつかれさま、負けちゃったね♡", "ほら、私の色でいっぱい♡", "最初から勝てると思ってた？♡"],
  ),
  pamper: othelloSet(
    ["角はもらうね。よく見てたよ。", "角、取っちゃった。ちゃんと見てる？", "角くらいでへこまないの。"],
    ["たくさん返されても、えらいよ。", "返された分、あとで褒めてあげる。", "泣かないの。次の一手、待ってる。"],
    ["打てなくても大丈夫。待っててね。", "休憩だね。待っててあげる。", "打てないなら、お礼でも言ってて。"],
    ["最後まで打てて、えらかったね。", "よく頑張りました。お礼は？", "来たことは褒めてあげる。罰金は別。"],
  ),
  aloof: othelloSet(
    ["角、もらっとくね。", "角。それだけ。", "角ひとつで騒がないで。"],
    ["ふーん、返っちゃったね。", "どうでもいいけど、私の色。", "何枚でも、興味ない。"],
    ["打てないなら、待ってて。", "パス？あっそ。", "打てないなら、静かにしてて。"],
    ["終わり。気が向いたら、また相手してあげる。", "終わったね。罰金だけ置いてって。", "勝ち負けより、罰金のほうが大事。"],
  ),
});
const OTHELLO_TONE_INDEX = Object.freeze({ sweet: 0, normal: 1, harsh: 2 });

// 管理人の一言の候補。選んだ型の分を、契約の上限までの強さで、強い順に出す（型がなければ型のない一言）。
export function othelloLinesFor({ styles = [], tone = "normal", situation = "flip", ngWords = [] } = {}) {
  const chosen = normalizeStyles(styles);
  const sets = chosen.length ? chosen.map((id) => OTHELLO_LINES[id]) : [OTHELLO_LINES[""]];
  const tones = tonesUpTo(tone).reverse();
  const lines = sets.flatMap((set) => tones.map((key) => set[situation]?.[OTHELLO_TONE_INDEX[key]]).filter(Boolean));
  return [...new Set(lines)].filter((line) => !contractTextProblem(line, { role: "manager", ngWords }));
}

// 請求のシートに出す一言の候補。名目の一言を先に、管理人の型の一言をその後に並べる。
// 強さの上限・言われたくない言葉・契約後の会話の決まりで絞る。
export function requestNotesFor({ purpose = "", tone = "normal", styles = [], ngWords = [] } = {}) {
  const allowed = tonesUpTo(tone);
  const usable = (entry) => allowed.includes(entry.tone) && !contractTextProblem(entry.text, { role: "manager", ngWords });
  const purposeLines = (REQUEST_NOTES[purpose] || REQUEST_NOTES[""]).filter(usable).map((entry) => entry.text);
  const styleLines = normalizeStyles(styles).flatMap((id) => STYLE_REQUEST_NOTES[id].filter(usable).map((entry) => entry.text));
  return { purpose: purposeLines, style: [...new Set(styleLines)].filter((line) => !purposeLines.includes(line)) };
}

export function visiblePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!PURPOSE_IDS.includes(purpose)) return "";
  return SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true ? "" : purpose;
}

export function purposeLabel(value, options) {
  const purpose = visiblePurpose(value, options);
  return PURPOSES.find((entry) => entry.id === purpose)?.label || "";
}

export function purposesFor({ allowSexual = false } = {}) {
  return PURPOSES.filter((purpose) => !purpose.sexual || allowSexual === true);
}

// 型ごとのご褒美（style 付き）は、管理人がその型を選んでいる時だけ出す（サーバーの rewardsFor と同じ）。
export function rewardsFor(tone, ngWords = [], styles = []) {
  const allowed = tonesUpTo(tone);
  const chosen = normalizeStyles(styles);
  return REWARDS.filter((reward) => (!reward.style || chosen.includes(reward.style))
    && reward.tones.some((entry) => allowed.includes(entry)) && !containsNgWord(reward.label, ngWords));
}

export function rewardLabel(value) {
  return REWARDS.find((reward) => reward.id === value)?.label || "";
}

// 記録に残ったご褒美の言葉。一覧の一言はその表示名、言われたい言葉は残した言葉そのもの。
export function rewardText(record) {
  const source = record && typeof record === "object" ? record : {};
  if (source.reward === REWARD_WORD) return Array.from(String(source.rewardText || "").trim()).slice(0, LIMITS.wantWordLength).join("");
  return rewardLabel(source.reward);
}

export const KIND_LABELS = Object.freeze({
  entry: "入場料",
  request: "請求に応えて",
  silent: "無言の献上",
  escrow_take: "管理口座から徴収",
});
export const GRANTED_LABEL = "願い出て許された献上";

// 献上の種類の表示。願い出て許された献上は、記録の上は無言の献上（granted の印）。
export const OTHELLO_PENALTY_LABEL = "貢ぎオセロの罰金";

export const CONTEST_PENALTY_LABEL = "勝負の罰金";

export function tributeKindLabel(record) {
  if (record?.granted === true) return GRANTED_LABEL;
  if (Number(record?.othello) > 0) return OTHELLO_PENALTY_LABEL;
  if (Number(record?.contest) > 0) return CONTEST_PENALTY_LABEL;
  return KIND_LABELS[record?.kind] || "献上";
}

// 抵抗のすえの献上（渋った回数）。0 なら空。
export function resistedLabel(record) {
  const count = integer(record?.resisted, 0, LIMITS.resistsPerRequest);
  return count > 0 ? `${count}回抵抗して献上` : "";
}
export const END_REASON_LABELS = Object.freeze({
  withdrawn: "申し込みを取り下げました",
  declined: "申し込みは受理されませんでした",
  application_expired: "申し込みが48時間で失効しました",
  terminated: "預ける側が解約しました",
  released: "管理する側が解放しました",
  expired: "契約期間が終わりました",
  blocked: "ブロックにより終了しました",
});
export const REPORT_REASON_LABELS = Object.freeze({
  external_trade: "外部取引（現金・外部決済・ギフト券）に誘われた",
  personal_info: "個人情報や連絡先を求められた",
  exit_obstruction: "解約や限度額の引き下げを妨げられた",
  threat: "脅迫・差別・晒しの脅し",
  other: "その他",
});
// 管理人の金庫の段階。サーバーの VAULT_TIERS と同じ。外に見せるのは段階だけ（額は本人だけ）。
export const VAULT_TIERS = Object.freeze([
  Object.freeze({ level: 1, id: "box", label: "木箱", threshold: 1_000 }),
  Object.freeze({ level: 2, id: "safe", label: "金庫", threshold: 5_000 }),
  Object.freeze({ level: 3, id: "kura", label: "蔵", threshold: 10_000 }),
  Object.freeze({ level: 4, id: "treasury", label: "宝物庫", threshold: 30_000 }),
  Object.freeze({ level: 5, id: "castle", label: "金の城", threshold: 100_000 }),
]);
// 金庫を作れるのは、お貢ぎ牧場で累計3人以上の財布から、合わせて1,000 Pay以上を受け取った管理人。サーバーの LIMITS と同じ。
export const VAULT_QUALIFY = Object.freeze({ payers: 3, received: 1_000 });

export function vaultTierFor(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  return VAULT_TIERS.reduce((level, tier) => (value >= tier.threshold ? tier.level : level), 0);
}

export function vaultTierInfo(level) {
  return VAULT_TIERS.find((tier) => tier.level === Number(level)) || null;
}

const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({ reason: "email", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu }),
  Object.freeze({ reason: "url", pattern: /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|jp|me|io|app|link|ly|gg|co|info|xyz|cc|to|tv)\b/iu }),
  Object.freeze({ reason: "phone", pattern: /(?:\d[\s-]?){10,}/u }),
  Object.freeze({ reason: "contact_app", pattern: /(?:\bline\s?(?:id|交換|で|やって|追加)|ライン(?:id|ＩＤ|交換|で話|やって|追加|教)|discord|ディスコード|telegram|テレグラム|kakao|カカオトーク|skype|スカイプ|instagram|インスタ|tiktok|ティックトック|twitter|ツイッター|threads|xのid|ＩＤ交換|id交換|連絡先|アカウント教え|裏垢)/iu }),
  Object.freeze({ reason: "handle", pattern: /(?:^|[\s(（「])@[a-z0-9_]{3,}/iu }),
  Object.freeze({ reason: "external_payment", pattern: /(?:paypay|ペイペイ|ぺいぺい|paypal|ペイパル|kyash|キャッシュアプリ|cash\s?app|venmo|楽天ペイ|メルペイ|d払い|au\s?pay|line\s?pay|ラインペイ|振込|振り込|口座|銀行|送金アプリ|アマギフ|amazon\s?ギフト|アマゾンギフト|itunes|google\s?play\s?ギフト|ギフト券|ギフトコード|プリペイド|電子マネー|ビットコイン|bitcoin|仮想通貨|暗号資産|現金|キャッシュバック|換金|リアルマネー|rmt)/iu }),
  Object.freeze({ reason: "real_money", pattern: /\d[\d,]*\s?(?:円|万円|千円|ドル|＄|\$)|(?:円|万円)\s?\d/u }),
  // 「出会う」は通す。正規表現の後読みは iOS 16.3 までの Safari では読めず、このファイルごと読み込めなくなるため、前の1文字で見る。
  // test() だけに使うので、前の1文字を含めて一致しても結果はサーバー（後読み）と同じ。
  Object.freeze({ reason: "meeting", pattern: /(?:(?:^|[^出])会(?:おう|いたい|える|お(?:う|か)|って)|オフ会|待ち合わせ|直接会|リアルで会|ホテル|家に来|家行)/u }),
  Object.freeze({ reason: "personal_info", pattern: /(?:住所|本名|電話番号|勤務先|学校名|顔写真|免許証|マイナンバー|生年月日)/u }),
  Object.freeze({ reason: "exposure_threat", pattern: /(?:晒す|晒して|晒し上げ|晒すぞ|特定する|特定して|特定した|ばらす|バラす|拡散する)/u }),
]);

export const FORBIDDEN_MESSAGES = Object.freeze({
  url: "URLやドメインは送れません。",
  email: "メールアドレスは送れません。",
  phone: "電話番号のような数字の並びは送れません。",
  contact_app: "外部の連絡先やSNSへ誘う言葉は送れません。",
  handle: "SNSのIDのような文字は送れません。",
  external_payment: "外部の決済・現金・ギフト券に関わる言葉は送れません。",
  real_money: "現実のお金の金額は送れません。使えるのはAnjuPayだけです。",
  meeting: "会う約束に関わる言葉は送れません。この牧場は会わない前提です。",
  personal_info: "住所・本名などの個人情報に関わる言葉は送れません。",
  exposure_threat: "晒し・特定の脅しは送れません。",
  ng_word: "相手が登録した「言われたくない言葉」を含むため送れません。",
});

export function forbiddenReason(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return reason;
  }
  return "";
}

export function containsNgWord(text, ngWords) {
  const normalized = String(text ?? "").normalize("NFKC").toLowerCase();
  return (Array.isArray(ngWords) ? ngWords : [])
    .some((word) => word && normalized.includes(String(word).normalize("NFKC").toLowerCase()));
}

export function messageProblem(text, { role = "payer", ngWords = [] } = {}) {
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (role === "manager" && containsNgWord(text, ngWords)) return FORBIDDEN_MESSAGES.ng_word;
  return "";
}

// 契約後の会話と請求の一言。サーバーの contractTextReason と同じく、現実のお金の判定だけを残す（「管理口座」は通す）。
const CONTRACT_TEXT_REASONS = Object.freeze(["external_payment", "real_money"]);

export function contractTextReason(text) {
  const normalized = String(text ?? "").normalize("NFKC").replace(/管理口座/gu, "");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (CONTRACT_TEXT_REASONS.includes(reason) && pattern.test(normalized)) return reason;
  }
  return "";
}

export function contractTextProblem(text, { role = "payer", ngWords = [] } = {}) {
  const reason = contractTextReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (role === "manager" && containsNgWord(text, ngWords)) return FORBIDDEN_MESSAGES.ng_word;
  return "";
}

// サーバーの cleanLine と同じ整え方（NFKC・制御文字を外す・続く空白を1つ・前後の空白を取る）。
function cleanText(value, maximumLength) {
  return Array.from(String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()).slice(0, maximumLength).join("");
}

// 受取印の言葉。サーバーの normalizeSealWord と同じく、今日のひとことと同じ禁止表現と性的な言葉を通さない。
export const SEAL_WORD_SEXUAL_MESSAGE = "受取印の言葉はレシートと貢ぎ報告の画像に残るため、性的な言葉は使えません。";
export function sealWordProblem(value) {
  const text = cleanText(value, LIMITS.sealWordLength);
  if (!text) return "受取印の言葉を入力してください。";
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (BOARD_SEXUAL_PATTERN.test(text.normalize("NFKC"))) return SEAL_WORD_SEXUAL_MESSAGE;
  return "";
}

// 受取印の言葉を、カードの受取印に登録する形（「word:言葉」）にする。
export function sealWordId(value) {
  return `${SEAL_WORD_PREFIX}${cleanText(value, LIMITS.sealWordLength)}`;
}

// 管理人の自分の言葉（定型文・ご褒美）。サーバーの normalizeOwnWords と同じ。
export function normalizeOwnWords(value) {
  const tones = ["sweet", "normal", "harsh"];
  const read = (list, maximum, length) => (Array.isArray(list) ? list : [])
    .map((entry) => ({ text: cleanText(entry?.text, length), tone: tones.includes(entry?.tone) ? entry.tone : "normal" }))
    .filter((entry) => entry.text)
    .slice(0, maximum);
  const lines = read(value?.lines, LIMITS.ownLines, LIMITS.ownLineLength);
  const rewards = read(value?.rewards, LIMITS.ownRewards, LIMITS.ownRewardLength);
  for (const entry of [...lines, ...rewards]) {
    const reason = contractTextReason(entry.text);
    if (reason) return { error: `「${entry.text}」: ${FORBIDDEN_MESSAGES[reason]}` };
  }
  return { ownWords: { lines, rewards } };
}

// 自分の言葉を、この契約で出せるか（強さの札が上限以下・言われたくない言葉なし・性的な言葉は許した契約でだけ）。
export function ownWordUsable(entry, { tone = "normal", ngWords = [], allowSexual = false } = {}) {
  const text = String(entry?.text ?? "");
  if (!text || !tonesUpTo(tone).includes(entry?.tone)) return false;
  if (containsNgWord(text, ngWords)) return false;
  return allowSexual === true || !BOARD_SEXUAL_PATTERN.test(text.normalize("NFKC"));
}

// 復唱の一言を比べる形（サーバーの reciteKey と同じ）。
export function reciteKey(value) {
  return cleanText(value, LIMITS.requestNote);
}

// 言葉の献上の確認（サーバーの normalizeWordOffering と同じ理由で止める）。
export function wordOfferingProblem(value) {
  const text = String(value ?? "").trim();
  if (!text) return "差し出す言葉を書いてください。";
  if (Array.from(text).length > LIMITS.wordOffering) return `言葉の献上は${LIMITS.wordOffering}文字までです。`;
  const reason = contractTextReason(text);
  return reason ? FORBIDDEN_MESSAGES[reason] : "";
}

// 言われたい言葉。サーバーの normalizeWantWords と同じく整え、同じ理由で止める（性的な言葉は止めない）。
export const WANT_WORDS_NG_MESSAGE = "「言われたくない言葉」を含む言葉は、言われたい言葉に登録できません。";

export function normalizeWantWords(value, { ngWords = [] } = {}) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,、]/u);
  const words = [...new Set(list
    .map((word) => Array.from(String(word ?? "")
      .normalize("NFKC")
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
      .replace(/\s+/gu, " ")
      .trim()).slice(0, LIMITS.wantWordLength).join(""))
    .filter(Boolean))].slice(0, LIMITS.wantWordCount);
  for (const word of words) {
    const reason = contractTextReason(word);
    if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
    if (containsNgWord(word, ngWords)) return { error: WANT_WORDS_NG_MESSAGE };
  }
  return { words };
}

export function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

export function tributeFee(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!value) return 0;
  return Math.min(value, Math.max(LIMITS.minimumFee, Math.ceil((value * LIMITS.feeRateBasisPoints) / 10_000)));
}

export function normalizeCaps(value) {
  const perTribute = Number(value?.perTribute);
  const perDay = Number(value?.perDay);
  const total = Number(value?.total);
  if (!PER_TRIBUTE_OPTIONS.includes(perTribute) || !PER_DAY_OPTIONS.includes(perDay) || !TOTAL_OPTIONS.includes(total)) return null;
  if (perTribute > perDay || perDay > total) return null;
  return { perTribute, perDay, total };
}

export function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function effectiveCaps(contract, timestamp = Date.now()) {
  const caps = normalizeCaps(contract?.caps);
  const pending = normalizeCaps(contract?.pendingCaps);
  const effectiveDateKey = String(contract?.pendingCapsEffectiveDateKey || "");
  if (caps && pending && effectiveDateKey && jstDateKey(timestamp) >= effectiveDateKey) return { caps: pending, applied: true };
  return { caps, applied: false };
}

export function todayUsed(contract, timestamp = Date.now()) {
  return contract?.todayKey === jstDateKey(timestamp) ? Math.max(0, Number(contract.todayTributed) || 0) : 0;
}

export function tributeAllowance(contract, caps, timestamp = Date.now()) {
  if (!caps) return 0;
  return Math.max(0, Math.min(
    caps.perTribute,
    caps.perDay - todayUsed(contract, timestamp),
    caps.total - Math.max(0, Number(contract?.totalTributed) || 0),
  ));
}

export function capViolation(amount, contract, caps, timestamp = Date.now()) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1) return "金額は1 Pay以上の整数で指定してください。";
  if (!caps) return "限度額を確認できませんでした。";
  if (value > caps.perTribute) return `1回の限度額（${caps.perTribute} Pay）を超えています。`;
  if (todayUsed(contract, timestamp) + value > caps.perDay) return `今日の限度額（${caps.perDay} Pay）を超えています。`;
  if ((Number(contract?.totalTributed) || 0) + value > caps.total) return `契約合計の限度額（${caps.total} Pay）を超えています。`;
  return "";
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// 出稼ぎ命令。サーバーの workOrderView と同じ。果たした後も、管理人が確認するか次の命令を出すまで残る。
// 勝負の型（kind: "contest"）は、勝ち数・期限・罰金と、財布が受けたか（acceptedAt）・期限の時刻（deadline）を持つ。
export function workOrderView(raw) {
  const order = raw?.workOrder && typeof raw.workOrder === "object" ? raw.workOrder : null;
  const contest = order?.kind === "contest";
  const target = integer(order?.target, 0, 1_000);
  const orderSeq = integer(order?.orderSeq);
  if (!order || !(contest ? CONTEST_TARGETS : WORK_ORDER_TARGETS).includes(target) || orderSeq < 1) return null;
  const doneAt = integer(order.doneAt);
  const base = {
    orderSeq,
    target,
    note: String(order.note || "").slice(0, LIMITS.requestNote),
    issuedAt: integer(order.issuedAt),
    reportedCount: integer(order.reportedCount, 0, target),
    reportedAt: integer(order.reportedAt),
    done: doneAt > 0,
    doneAt,
  };
  if (!contest) return base;
  const days = integer(order.days);
  const penalty = integer(order.penalty);
  if (!CONTEST_DAYS.includes(days) || !CONTEST_PENALTIES.includes(penalty)) return null;
  const acceptedAt = integer(order.acceptedAt);
  return { ...base, kind: "contest", days, penalty, acceptedAt, accepted: acceptedAt > 0, deadline: acceptedAt > 0 ? integer(order.deadline) : 0 };
}

// 勝負に負けて残った罰金（未払い）と、勝負の勝ち負けの数。サーバーの workResultView・contestRecordView と同じ。
export function workResultView(raw) {
  const result = raw?.workResult && typeof raw.workResult === "object" ? raw.workResult : null;
  const penalty = integer(result?.penalty, 0, 1_000_000);
  if (!result || penalty <= 0) return null;
  return {
    orderSeq: integer(result.orderSeq),
    penalty,
    target: integer(result.target, 0, 1_000),
    wins: integer(result.wins, 0, 1_000),
    settledAt: integer(result.settledAt),
  };
}

export function contestRecordView(raw) {
  return { won: integer(raw?.contestWins), lost: integer(raw?.contestLosses) };
}

// 勝負の期限が過ぎて、まだ決着していないか（管理人が判定できる・財布の報告で負けが決まる）。
export function contestExpired(order, now = Date.now()) {
  return Boolean(order?.kind === "contest" && order.accepted && !order.done && order.deadline > 0 && now >= order.deadline);
}

// 復唱と延長。サーバーの reciteOrderView・extensionView と同じ。
export function reciteOrderView(raw) {
  const order = raw?.reciteOrder && typeof raw.reciteOrder === "object" ? raw.reciteOrder : null;
  const target = integer(order?.target, 0, 1_000);
  const orderSeq = integer(order?.orderSeq);
  const text = String(order?.text || "").slice(0, LIMITS.requestNote);
  if (!order || !RECITE_TARGETS.includes(target) || orderSeq < 1 || !text) return null;
  const doneAt = integer(order.doneAt);
  return { orderSeq, text, target, count: integer(order.count, 0, target), issuedAt: integer(order.issuedAt), done: doneAt > 0, doneAt };
}

export function extensionView(raw) {
  const extension = raw?.extension && typeof raw.extension === "object" ? raw.extension : null;
  const days = integer(extension?.days, 0, 1_000);
  if (!extension || !DURATION_DAYS_OPTIONS.includes(days)) return null;
  return { days, createdAt: integer(extension.createdAt) };
}

// 貢ぎオセロ（設計書15.2）。サーバーの othelloView・othelloResultView・othelloRecordView と同じ。
export function othelloView(raw) {
  const game = raw?.othello && typeof raw.othello === "object" ? raw.othello : null;
  if (!game || !othelloBoardValid(game.board) || !["manager", "payer"].includes(game.turn)) return null;
  const last = game.lastMove && typeof game.lastMove === "object" ? game.lastMove : null;
  return {
    gameSeq: integer(game.gameSeq),
    board: game.board,
    turn: game.turn,
    rate: OTHELLO_RATES.includes(Number(game.rate)) ? Number(game.rate) : OTHELLO_RATES[0],
    handicap: OTHELLO_HANDICAPS.includes(game.handicap) ? game.handicap : "none",
    startedAt: integer(game.startedAt),
    lastMoveAt: integer(game.lastMoveAt),
    lastMove: last ? { index: integer(last.index, 0, 63), flipped: integer(last.flipped, 0, 64), role: last.role === "manager" ? "manager" : "payer" } : null,
    counts: othelloCount(game.board),
  };
}

export function othelloResultView(raw) {
  const result = raw?.othelloResult && typeof raw.othelloResult === "object" ? raw.othelloResult : null;
  const penalty = integer(result?.penalty, 0, 1_000_000);
  if (!result || penalty <= 0) return null;
  return {
    gameSeq: integer(result.gameSeq),
    penalty,
    stones: integer(result.stones, 0, 64),
    rate: integer(result.rate, 0, 1_000),
    resigned: result.resigned === true,
    finishedAt: integer(result.finishedAt),
  };
}

export function othelloRecordView(value) {
  const record = value && typeof value === "object" ? value : {};
  return { played: integer(record.played), lost: integer(record.lost), won: integer(record.won), drawn: integer(record.drawn), streak: integer(record.streak) };
}

// お預けと願い出。サーバーの holdView・pleaView と同じ。
export function holdView(raw) {
  const hold = raw?.hold && typeof raw.hold === "object" ? raw.hold : null;
  const since = integer(hold?.since);
  if (!hold || since < 1) return null;
  return { since, note: String(hold.note || "").slice(0, LIMITS.requestNote) };
}

export function pleaView(raw) {
  const plea = raw?.plea && typeof raw.plea === "object" ? raw.plea : null;
  const pleaSeq = integer(plea?.pleaSeq);
  const amount = integer(plea?.amount);
  if (!plea || pleaSeq < 1 || amount < 1) return null;
  const grantedAt = integer(plea.grantedAt);
  return {
    pleaSeq,
    amount,
    purpose: visiblePurpose(plea.purpose, { allowSexual: raw.allowSexualPurposes === true }),
    note: String(plea.note || "").slice(0, LIMITS.requestNote),
    createdAt: integer(plea.createdAt),
    granted: grantedAt > 0,
    grantedAt,
  };
}

function purposeCountsView(raw) {
  const counts = object(raw.purposeCounts);
  const allowSexual = raw.allowSexualPurposes === true;
  const view = {};
  for (const purpose of PURPOSE_IDS) {
    const count = integer(counts[purpose]);
    if (count > 0 && visiblePurpose(purpose, { allowSexual })) view[purpose] = count;
  }
  return view;
}

function cardSnapshot(card) {
  const source = object(card);
  return {
    personaName: String(source.personaName || "管理人").slice(0, 32),
    disclosure: String(source.disclosure || "undisclosed"),
    styles: normalizeStyles(source.styles),
    sigil: integer(source.sigil, 0, 5),
    avatar: avatarId(source.avatar),
  };
}

// サーバーの viewContract と同じ形に、Firestore から直接読んだ契約を整える。
// 限度額（caps）は財布だけ。管理人の画面には、限度額も残り枠も出さない（サーバーの viewContract と同じ）。
// 限度額は契約の記録ではなく private/limits にあるので、財布の画面はそれを足してから渡す。
export function viewContract(contract, uid, now = Date.now()) {
  const raw = object(contract);
  const role = raw.managerUid === uid ? "manager" : "payer";
  const status = String(raw.status || "ended");
  const caps = role === "payer" ? effectiveCaps(raw, now).caps : null;
  const pending = normalizeCaps(raw.pendingCaps);
  const pendingKey = String(raw.pendingCapsEffectiveDateKey || "");
  const pendingStillScheduled = role === "payer" && Boolean(pending && pendingKey && jstDateKey(now) < pendingKey);
  const eventSeq = integer(raw.eventSeq);
  const readSeq = integer(object(raw.readSeq)[role]);
  const peerReadSeq = integer(object(raw.readSeq)[role === "manager" ? "payer" : "manager"]);
  const withdraw = raw.escrowWithdrawRequest && typeof raw.escrowWithdrawRequest === "object"
    ? { amount: integer(raw.escrowWithdrawRequest.amount), requestedAt: integer(raw.escrowWithdrawRequest.requestedAt) }
    : null;
  const totalTributed = integer(raw.totalTributed);
  const escrowBalance = integer(raw.escrowBalance);
  return {
    contractId: String(raw.contractId || ""),
    role,
    status,
    endReason: String(raw.endReason || ""),
    endReasonLabel: END_REASON_LABELS[raw.endReason] || "",
    accepted: integer(raw.acceptedAt) > 0,
    manager: cardSnapshot(raw.managerCard),
    payer: { walletName: String(raw.payerWalletName || "名無しの財布").slice(0, 32) },
    collarNo: integer(raw.collarNo),
    caps,
    pendingCaps: pendingStillScheduled ? pending : null,
    pendingCapsEffectiveDateKey: pendingStillScheduled ? pendingKey : "",
    durationDays: integer(raw.durationDays, 1, MAX_DURATION_DAYS),
    tone: String(raw.tone || "normal"),
    ngWords: Array.isArray(raw.ngWords) ? raw.ngWords.slice(0, LIMITS.ngWordCount).map(String) : [],
    wantWords: Array.isArray(raw.wantWords) ? raw.wantWords.map(String).filter(Boolean).slice(0, LIMITS.wantWordCount) : [],
    managerPublicId: PUBLIC_MANAGER_ID_PATTERN.test(String(raw.managerPublicId || "")) ? raw.managerPublicId : "",
    allowReportRequests: raw.allowReportRequests === true,
    rankOptIn: raw.rankOptIn === true,
    allowSexualPurposes: raw.allowSexualPurposes === true,
    allowScreenshots: raw.allowScreenshots === true,
    allowWorkOrders: raw.allowWorkOrders === true,
    allowHolds: raw.allowHolds === true,
    allowOthello: raw.allowOthello === true,
    // 牧場（設計書16.4）: 放牧の同意と、管理人が選んだ動物（選ぶまでは契約ごとに決まった1種類）。
    allowGrazing: raw.allowGrazing === true,
    ranchAnimal: RANCH_ANIMALS.includes(raw.ranchAnimal) ? raw.ranchAnimal : defaultRanchAnimal(raw.contractId),
    // 管理人が最後に動物をなでた時刻（財布の「牧場をのぞく」に出る）。
    pattedAt: integer(raw.pattedAt),
    // 飼育記録: 飾りが付いた日と、なでてもらった日数（サーバーと同じ。組の通算）。
    fondnessAt: Object.fromEntries(RANCH_FONDNESS.map((step) => [String(step.tier), integer(raw.fondnessAt?.[step.tier])]).filter(([, at]) => at > 0)),
    patDays: integer(raw.patDays),
    // 財布が書いた鳴き声（サーバーの mooLinesView と同じ）。
    mooLines: Array.isArray(raw.mooLines) ? raw.mooLines.map((line) => cleanText(line, RANCH_MOO.length)).filter(Boolean).slice(0, RANCH_MOO.lines) : [],
    othello: status === "active" ? othelloView(raw) : null,
    othelloResult: status === "active" ? othelloResultView(raw) : null,
    othelloRecord: othelloRecordView(raw.othelloRecord),
    entryFee: integer(raw.entryFee, 0, 1_000),
    renewal: raw.renewal === true,
    createdAt: integer(raw.createdAt),
    acceptedAt: integer(raw.acceptedAt),
    expiresAt: integer(raw.expiresAt),
    endedAt: integer(raw.endedAt),
    updatedAt: integer(raw.updatedAt),
    totalTributed,
    tributeCount: integer(raw.tributeCount),
    purposeCounts: purposeCountsView(raw),
    rewardCount: integer(raw.rewardCount),
    awaitingReceipt: status === "active" ? integer(raw.awaitingReceipt) : 0,
    todayTributed: todayUsed(raw, now),
    allowance: status === "active" ? tributeAllowance(raw, caps, now) : 0,
    escrowBalance,
    escrowRoom: caps ? Math.max(0, caps.total - totalTributed - escrowBalance) : 0,
    escrowWithdrawRequest: withdraw && withdraw.amount > 0 ? withdraw : null,
    ignoredSince: integer(raw.ignoredSince),
    managerIgnoreUnpaid: raw.managerIgnoreUnpaid === true,
    pendingRequests: Object.entries(object(raw.pendingRequests))
      .map(([requestId, entry]) => ({
        requestId,
        amount: integer(entry?.amount),
        note: String(entry?.note || "").slice(0, LIMITS.requestNote),
        purpose: visiblePurpose(entry?.purpose, { allowSexual: raw.allowSexualPurposes === true }),
        resists: integer(entry?.resists, 0, LIMITS.resistsPerRequest),
        createdAt: integer(entry?.createdAt),
      }))
      .filter((entry) => /^[a-f0-9]{16}$/.test(entry.requestId) && entry.amount > 0)
      .sort((left, right) => left.createdAt - right.createdAt),
    reportRequested: integer(raw.reportRequestedAt) > 0,
    workOrder: status === "active" ? workOrderView(raw) : null,
    workOrdersDone: integer(raw.workOrdersDone),
    workResult: status === "active" ? workResultView(raw) : null,
    contestRecord: contestRecordView(raw),
    hold: status === "active" ? holdView(raw) : null,
    plea: status === "active" ? pleaView(raw) : null,
    pleaCount: integer(raw.pleaCount),
    pleaGrantedCount: integer(raw.pleaGrantedCount),
    resistedTributes: integer(raw.resistedTributes),
    reciteOrder: status === "active" ? reciteOrderView(raw) : null,
    recitesDone: integer(raw.recitesDone),
    wordOfferings: integer(raw.wordOfferings),
    wordOffersToday: raw.wordOfferDayKey === jstDateKey(now) ? integer(raw.wordOfferDayCount, 0, 1_000) : 0,
    // 最後に仕えた日（献上か言葉の献上をした日本時間の日）。牧場の動物のようすに使う。
    // その財布が通算で仕えた日数（契約をまたぐ）。記録のない契約は、この契約の献上の回数と日数から近い数を出す。
    servedTotal: servedTotalView(raw, now),
    lastServedDayKey: [String(raw.todayKey || ""), String(raw.wordOfferDayKey || "")].filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().at(-1) || "",
    extension: status === "active" ? extensionView(raw) : null,
    eventSeq,
    unread: Math.max(0, eventSeq - readSeq),
    peerReadSeq: Math.min(eventSeq, peerReadSeq),
  };
}

// 既読無視の長さ。24時間までは「○時間」、それを過ぎたら「○日目」。
export function ignoreLabel(since, now = Date.now()) {
  const start = Number(since) || 0;
  if (start <= 0) return "";
  const elapsed = Math.max(0, now - start);
  if (elapsed < 24 * 3_600_000) return `既読無視 ${Math.max(1, Math.floor(elapsed / 3_600_000))}時間`;
  return `既読無視 ${Math.floor(elapsed / 86_400_000) + 1}日目`;
}

// 定型文。言葉の強さごとに用意する。契約の強さは預ける側が決める上限で、管理人はその上限までの強さから選ぶ
// （財布の定型文は契約の強さのもの）。辛口は徹底して辛く、ただし
// 自傷・死・暴力・差別・晒しの語、上限を上げさせる文、解約をためらわせる文は入れない。
// 上限を下げた時・終わった時の反応は、責めない。
export const MANAGER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "nudge", label: "催促" }),
  // 財布の気持ちを、財布より先に言う（2026-10-27、記事の「相手の考え代弁型」から）。
  Object.freeze({ id: "voice", label: "言い当てる" }),
  Object.freeze({ id: "after", label: "受け取った後" }),
  Object.freeze({ id: "ignore", label: "突き放す" }),
  // 抵抗した財布を、払うほうへ追い込む（2026-10-27）。
  Object.freeze({ id: "press", label: "追い込む" }),
  Object.freeze({ id: "report", label: "報告させる" }),
  Object.freeze({ id: "nekama", label: "ネカマとして" }),
  Object.freeze({ id: "control", label: "寸止め・射精管理", sexual: true }),
  Object.freeze({ id: "ended", label: "終わる時" }),
  // sheet: 会話の定型文には出さず、お預け・復唱のシートの一言の候補にだけ使う。
  Object.freeze({ id: "hold", label: "お預け", sheet: true }),
  Object.freeze({ id: "recite", label: "復唱させる", sheet: true }),
]);
export const PAYER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "give", label: "差し出す" }),
  Object.freeze({ id: "reply", label: "返事" }),
  Object.freeze({ id: "control", label: "寸止め・射精管理", sexual: true }),
  Object.freeze({ id: "safety", label: "止める・下げる" }),
  // 願い出と抵抗のシートの一言の候補（会話の定型文には出さない）。
  Object.freeze({ id: "plea", label: "願い出る", sheet: true }),
  Object.freeze({ id: "resist", label: "抵抗する", sheet: true }),
]);

export const TEMPLATES = Object.freeze({
  manager: Object.freeze({
    harsh: Object.freeze({
      nudge: Object.freeze([
        "遅い。財布のくせに待たせるな。",
        "黙って差し出せ。言い訳は聞いてない。",
        "今日の分は？まさか忘れてないよね、雑魚財布。",
        "財布が口答えするな。",
        "返事が遅い。躾が足りてない。",
        "お前の存在価値、残高の数字だけだから。",
        "ぼーっとしてる暇あったら財布開けな。",
        "ATMのくせに止まるな。",
        "養分は黙って差し出せ。",
        "お財布くん、今日の分は？",
        "{no}号、待たせるな。",
      ]),
      voice: Object.freeze([
        "財布開けたくて震えてるの、バレバレ。",
        "払いたくて仕方ないって顔してる。",
        "口では渋っても、指はもう押したがってる。",
        "{no}号、また貢ぎたくなってるでしょ。",
      ]),
      after: Object.freeze([
        "それっぽっち？まあ受け取ってやる。",
        "受け取ってやった。ありがたく思え。",
        "やっと出した。財布として最低限の仕事はしたね。",
        "レシート眺めてニヤつくな、気持ち悪い。",
        "貢ぐしか能がないの、ほんと惨め。",
        "差し出す時の顔、想像しただけで笑える。",
        "今日もATMご苦労。",
        "養分としては合格。",
        "お財布くん、よくできました。",
        "家畜にしては上出来。",
        "{no}号の分、確かに受け取った。",
      ]),
      ignore: Object.freeze(["……。", "既読。", "で？", "興味ない。"]),
      press: Object.freeze([
        "渋っても結果は同じ。早く押せ。",
        "抵抗するふりはもういい。払え。",
        "嫌がる顔、悪くない。で、払うんでしょ。",
        "{no}号、往生際が悪い。",
      ]),
      report: Object.freeze([
        "残高、報告。今すぐ。",
        "財布の中身、隠さず見せろ。",
        "管理されてる自覚あるなら、報告くらい自分から出せ。",
        "お財布くん、残高報告。",
      ]),
      nekama: Object.freeze([
        "中身が男だって知ってて貢ぐんだ。救いようがないね。",
        "ネカマに財布握られて満足？終わってる。",
        "おっさんに貢いでる自覚、ちゃんと持って差し出せ。",
        "男だって分かってて尻尾振る財布、最高に情けない。",
      ]),
      control: Object.freeze([
        "まだイかせない。",
        "イきたいなら払え。",
        "寸止め料を払ってから話しかけな。",
        "勝手にイったら罰金。",
        "許可なくイったね。お漏らし罰金。",
      ]),
      ended: Object.freeze([
        "おつかれ。財布、閉じていいよ。",
        "契約終了。好きにしな。",
      ]),
      hold: Object.freeze([
        "お預けだ。許すまで財布に触るな。",
        "勝手に差し出すな。待て。",
        "{no}号、お預け。",
      ]),
      recite: Object.freeze([
        "私は財布です。貢ぐことしかできません。",
        "負けました。財布として使ってください。",
        "{no}号は、言われた分だけ差し出します。",
      ]),
    }),
    normal: Object.freeze({
      nudge: Object.freeze([
        "今日の分、待ってる。",
        "そろそろ顔出して。",
        "ちゃんと持ってきてね。",
        "財布の管理は私の仕事。",
        "{no}号、今日もよろしく。",
      ]),
      voice: Object.freeze([
        "払いたくなってきたでしょ。",
        "本当は差し出したいって、分かってる。",
        "{no}号、そろそろ貢ぎたい頃だよね。",
      ]),
      after: Object.freeze([
        "受け取った。よくできました。",
        "確認した。次も遅れないで。",
        "うん、それでいい。",
        "{no}号、確認した。",
      ]),
      ignore: Object.freeze(["……。", "既読。"]),
      press: Object.freeze([
        "抵抗しても無駄。払って。",
        "迷うのは分かる。でも払うんでしょ。",
        "{no}号、観念しなさい。",
      ]),
      report: Object.freeze(["残高、見せて。", "今の財布、報告して。"]),
      nekama: Object.freeze([
        "男に貢いでるって分かってるよね。よろしい。",
        "中身が男でも差し出せるなら、合格。",
      ]),
      control: Object.freeze(["まだイっちゃだめ。", "イきたいなら先に払って。", "勝手にイったら罰金ね。"]),
      ended: Object.freeze(["おつかれさま。ここまでありがとう。", "契約終了。ちゃんと休んでね。"]),
      hold: Object.freeze(["当分お預け。勝手に差し出さないこと。", "許すまで待ちなさい。", "{no}号、お預けね。"]),
      recite: Object.freeze(["私は管理されている財布です。", "{no}号、きちんと貢ぎます。"]),
    }),
    sweet: Object.freeze({
      // お願いの形にはしない（記事で財布が嫌ったのは、媚びる・営業する貢がせ役だった）。
      nudge: Object.freeze([
        "待ってたよ。今日も来るよね？",
        "無理のない範囲でね。",
        "顔見せてくれたら、それでうれしいよ。",
      ]),
      voice: Object.freeze([
        "本当は貢ぎたくてそわそわしてるでしょ♡",
        "差し出したい気持ち、ちゃんと分かってるよ。",
        "{no}号、顔に出てるよ♡",
      ]),
      after: Object.freeze([
        "えらいね、ちゃんと持ってきたんだ。",
        "ありがと。大事にするね。",
        "今日もいい子。",
        "{no}号、えらいね。",
      ]),
      ignore: Object.freeze(["……ふふ。", "今はちょっと放置。"]),
      press: Object.freeze([
        "嫌がっても、待ってあげない♡",
        "最後は払うって、知ってるよ。",
        "{no}号、がんばって抵抗してるね♡",
      ]),
      report: Object.freeze(["今の財布、ちょっと見せて？"]),
      nekama: Object.freeze([
        "中身が男でも来てくれるんだ。かわいいね。",
        "おっさんだって知ってるのに律儀だね。",
      ]),
      control: Object.freeze(["まだ我慢できるよね。", "ちゃんと払えたら、イっていいよ。", "勝手にイったら罰金だよ？"]),
      ended: Object.freeze(["おつかれさま。また気が向いたらね。", "ここまでありがとう。ゆっくり休んで。"]),
      hold: Object.freeze(["今日はお預け。いい子で待っててね♡", "我慢できたら、許してあげる。", "{no}号、お預けだよ♡"]),
      recite: Object.freeze(["いい子にして貢ぎます。", "{no}号、ちゃんと待てます。"]),
    }),
  }),
  payer: Object.freeze({
    harsh: Object.freeze({
      give: Object.freeze(["差し出します。", "今日の分です。受け取ってください。", "遅れてすみません。", "{no}号、献上します。"]),
      reply: Object.freeze(["はい。", "財布として使ってください。", "もっと罵ってください。", "ありがとうございます。", "貢がせていただき、ありがとうございます。", "ATMとして使ってください。", "養分です。"]),
      control: Object.freeze(["寸止め料、払いました。", "イかせてください。お願いします。", "勝手にイきました。罰金を払います。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "少し休みます。"]),
      plea: Object.freeze(["貢がせてください。", "お願いします、差し出させてください。", "財布を開く許可をください。", "{no}号に、貢ぐ許可をください。"]),
      resist: Object.freeze(["……払いたくないです。", "それだけは許してください。", "今日は勘弁してください……", "{no}号、まだ抵抗します。"]),
    }),
    normal: Object.freeze({
      give: Object.freeze(["今日の分です。", "差し出します。", "{no}号、献上します。"]),
      reply: Object.freeze(["はい。", "ありがとうございます。", "貢がせてくれてありがとうございます。", "報告します。"]),
      control: Object.freeze(["寸止め料です。", "イってもいいですか。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "少し休みます。"]),
      plea: Object.freeze(["貢がせてください。", "差し出してもいいですか。", "{no}号、献上の許可をください。"]),
      resist: Object.freeze(["今日は払いたくないです。", "もう少し待ってください。", "考えさせてください。"]),
    }),
    sweet: Object.freeze({
      give: Object.freeze(["今日の分、どうぞ。", "受け取ってくれたらうれしい。"]),
      reply: Object.freeze(["ありがとう。", "受け取ってくれてありがとう。", "今日もお願いします。", "うれしい。"]),
      control: Object.freeze(["寸止め料、どうぞ。", "イってもいい？"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "少し休みます。"]),
      plea: Object.freeze(["貢がせてほしいな。", "差し出してもいい？"]),
      resist: Object.freeze(["もう少しだけ待って……", "ちょっとだけ考えさせて。"]),
    }),
  }),
});

// 管理の型ごとの定型文（2026-10-27）。管理人が選んだ型の分だけ、定型文の欄の上に「型の定型文」として出す。
// 強さごとに用意し、欄で選んでいる強さ（契約の上限まで）のものを出す。請求の一言と同じ決まりで、性的な言葉は使わない。
export const STYLE_TEMPLATES = Object.freeze({
  insight: Object.freeze({
    sweet: Object.freeze(["ちゃんと分かっていますよ。今日も来ると思っていました。", "無理はしなくていいです。あなたのことは見ていますから。", "言わなくても伝わっています。よくできました。"]),
    normal: Object.freeze(["顔に出ていますよ。払いたいんでしょう。", "理由を探さなくていいです。もう決めていますね。", "迷っているふりは、もう要りません。"]),
    harsh: Object.freeze(["言い訳を考える時間、全部見えています。", "自分で分かっているのに、まだ待たせるんですか。", "{no}号、あなたの考えることは全部お見通しです。"]),
  }),
  manage: Object.freeze({
    sweet: Object.freeze(["今日の報告、ちゃんとできたね。", "約束を守れてえらいね。この調子で続けよう。", "決めたことを続けられるの、いいことだよ。"]),
    normal: Object.freeze(["今日の報告をしなさい。", "約束の時間です。忘れていないね。", "決めたルールは守ること。"]),
    harsh: Object.freeze(["報告が遅い。管理されている自覚を持て。", "約束を破るなら、それも記録に残す。", "{no}号、今日の分の報告がまだ。"]),
  }),
  tease: Object.freeze({
    sweet: Object.freeze(["また来たの？かわいいね♡", "えらいえらい、ちゃんと来られたね♡", "そんなに来たかったんだ♡"]),
    normal: Object.freeze(["分かりやすすぎて笑っちゃう♡", "我慢してたの？全然できてないけど♡", "顔に出てるよ、払いたいって♡"]),
    harsh: Object.freeze(["ほんと財布って単純♡", "渋ってるふり、下手すぎ♡", "{no}号、また負けに来たんだ♡"]),
  }),
  pamper: Object.freeze({
    sweet: Object.freeze(["今日も来てくれてうれしいな。", "差し出せるの、ちゃんとえらいよ。", "ありがとうは？ちゃんと言えたら褒めてあげる。"]),
    normal: Object.freeze(["貢ぐのは悪いことじゃないよ。", "よくがんばったね。お礼を言ってごらん。", "ここでは素直でいていいよ。"]),
    harsh: Object.freeze(["褒めてほしいなら、まずお礼から。", "甘やかすのは、ちゃんと差し出した財布だけ。", "{no}号、お礼がまだだよ。"]),
  }),
  aloof: Object.freeze({
    sweet: Object.freeze(["たまには相手してあげる。", "今日は機嫌がいいから、見ててあげる。", "気が向いたら、また返事するね。"]),
    normal: Object.freeze(["ふーん。それで？", "返事は気が向いたらね。", "見てるかどうかは、教えない。"]),
    harsh: Object.freeze(["用があるのは、お財布だけ。", "構ってほしいなら、先に差し出して。", "{no}号、今日は気分じゃない。"]),
  }),
});

// 型の定型文の欄（型ごとに1つ）。欄で選んでいる強さのものを出し、{no} は首輪番号に置き換える（番号がなければその文を出さない）。
export function styleTemplatesFor(styles, tone, { ngWords = [], collarNo = 0 } = {}) {
  const number = Number.isSafeInteger(Number(collarNo)) && Number(collarNo) > 0 ? String(Number(collarNo)) : "";
  return normalizeStyles(styles)
    .map((id) => ({
      id,
      label: STYLE_LABELS[id],
      lines: (STYLE_TEMPLATES[id][tone] || STYLE_TEMPLATES[id].normal)
        .filter((line) => !line.includes("{no}") || number)
        .map((line) => line.replaceAll("{no}", number))
        .filter((line) => !messageProblem(line, { role: "manager", ngWords })),
    }))
    .filter((group) => group.lines.length);
}

// 性的な定型文は、預ける側が性的な名目を許した契約でだけ出す。{no} は首輪番号に置き換え、番号がなければその文を出さない。
export function templatesFor(role, tone, { disclosure = "undisclosed", ngWords = [], allowSexual = false, collarNo = 0 } = {}) {
  const roleSet = TEMPLATES[role === "manager" ? "manager" : "payer"];
  const toneSet = roleSet[tone] || roleSet.normal;
  const situations = role === "manager" ? MANAGER_SITUATIONS : PAYER_SITUATIONS;
  const number = Number.isSafeInteger(Number(collarNo)) && Number(collarNo) > 0 ? String(Number(collarNo)) : "";
  return situations
    .filter((situation) => !situation.sheet)
    .filter((situation) => situation.id !== "nekama" || disclosure === "nekama")
    .filter((situation) => !situation.sexual || allowSexual === true)
    .map((situation) => ({
      ...situation,
      lines: (toneSet[situation.id] || [])
        .filter((line) => !line.includes("{no}") || number)
        .map((line) => line.replaceAll("{no}", number))
        .filter((line) => !messageProblem(line, { role, ngWords })),
    }))
    .filter((situation) => situation.lines.length);
}

// シートの一言の候補（管理人のお預け、財布の願い出・抵抗）。管理人は契約の強さ（上限）までを強い順に、
// 財布は契約の強さのものを出す。{no} は首輪番号に置き換え、言われたくない言葉を含む文は管理人に出さない。
export function sheetLinesFor(role, tone, situationId, { ngWords = [], collarNo = 0 } = {}) {
  const roleSet = TEMPLATES[role === "manager" ? "manager" : "payer"];
  const tones = role === "manager" ? tonesUpTo(tone).reverse() : [roleSet[tone] ? tone : "normal"];
  const number = Number.isSafeInteger(Number(collarNo)) && Number(collarNo) > 0 ? String(Number(collarNo)) : "";
  return tones
    .flatMap((key) => roleSet[key]?.[situationId] || [])
    .filter((line) => !line.includes("{no}") || number)
    .map((line) => line.replaceAll("{no}", number))
    .filter((line) => !contractTextProblem(line, { role, ngWords }));
}

// 出稼ぎ命令の一言の候補。言葉の強さごとに用意し、定型文と同じ決まりに従う（限度額を上げさせる文・
// 解約をためらわせる文に加え、期限で煽る文も入れない）。{no} は首輪番号に置き換え、番号がなければその文を出さない。
export const WORK_ORDER_NOTES = Object.freeze({
  harsh: Object.freeze(["財布が空なら稼いでこい。", "養分は働いて貢ぐもの。", "稼いでから顔を出せ。", "{no}号、出稼ぎの時間だ。"]),
  normal: Object.freeze(["1on1を完走して稼いできなさい。", "稼いでから戻ってきて。", "{no}号、出稼ぎに行ってきて。"]),
  sweet: Object.freeze(["1on1で少し稼いできてね♡", "がんばってきたら褒めてあげる。", "{no}号、いってらっしゃい♡"]),
});

// 勝負の一言の候補（設計書15.3）。完走の一言と同じ決まりで、期限で煽る文は入れない。名前は「賭け」ではなく「勝負」。
export const CONTEST_NOTES = Object.freeze({
  harsh: Object.freeze(["負けたら罰金。勝ってから顔を出せ。", "養分のくせに、勝てると思ってるの？", "{no}号、勝負だ。負けたら払え。"]),
  normal: Object.freeze(["勝ってきなさい。負けたら罰金ね。", "約束の数だけ勝ってくること。", "{no}号、勝負してきて。"]),
  sweet: Object.freeze(["勝てたら、たくさん褒めてあげる♡", "負けても、約束は守ろうね。", "{no}号、がんばっておいで♡"]),
});

// 契約の強さ（上限）までの候補を、強い順に並べる。kind が "contest" なら勝負の一言。
export function workOrderNotesFor(tone, { collarNo = 0, ngWords = [], kind = "run" } = {}) {
  const notes = kind === "contest" ? CONTEST_NOTES : WORK_ORDER_NOTES;
  const lines = tonesUpTo(tone).reverse().flatMap((key) => notes[key]);
  const number = Number.isSafeInteger(Number(collarNo)) && Number(collarNo) > 0 ? String(Number(collarNo)) : "";
  return lines
    .filter((line) => !line.includes("{no}") || number)
    .map((line) => line.replaceAll("{no}", number))
    .filter((line) => !contractTextProblem(line, { role: "manager", ngWords }));
}

// お試しの申し込み。1日・1回30・1日30・合計100 Pay を基本に、入場料が1回に収まるよう一段ずつ上げる。
export const TRIAL_DURATION_DAYS = 1;
export function trialCaps(entryFee = 0) {
  const fee = Math.max(0, Number(entryFee) || 0);
  const perTribute = PER_TRIBUTE_OPTIONS.find((value) => value >= Math.max(30, fee)) || PER_TRIBUTE_OPTIONS.at(-1);
  const perDay = PER_DAY_OPTIONS.find((value) => value >= perTribute) || PER_DAY_OPTIONS.at(-1);
  const total = TOTAL_OPTIONS.find((value) => value >= Math.max(perDay, 100)) || TOTAL_OPTIONS.at(-1);
  return { perTribute, perDay, total };
}

// 招待リンク。管理人の公開IDだけを入れ、開いた人は年齢確認のあと、その管理人の詳細に着く。
export const INVITE_QUERY_KEY = "ranch";
export const PUBLIC_MANAGER_ID_PATTERN = /^[a-f0-9]{24}$/;

export function inviteUrl(base, publicManagerId) {
  if (!PUBLIC_MANAGER_ID_PATTERN.test(String(publicManagerId || ""))) return "";
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set(INVITE_QUERY_KEY, publicManagerId);
  return url.href;
}

export function inviteFromUrl(href) {
  try {
    const value = new URL(href).searchParams.get(INVITE_QUERY_KEY) || "";
    return PUBLIC_MANAGER_ID_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

// 牧場を直接開くURL（?open=ranch）。ブックマークやホーム画面から、トップを通らずに契約の画面を開く。
export const RANCH_OPEN_QUERY = Object.freeze({ key: "open", value: "ranch" });

export function ranchOpenUrl(base) {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set(RANCH_OPEN_QUERY.key, RANCH_OPEN_QUERY.value);
  return url.href;
}

export function wantsRanchOpen(href) {
  try {
    return new URL(href).searchParams.get(RANCH_OPEN_QUERY.key) === RANCH_OPEN_QUERY.value;
  } catch {
    return false;
  }
}

// 契約の画面の「やること」。数が1以上の種類だけ出し、押すとその種類の最初の契約を開く。並びは急ぐ順。
export const CONTRACT_TODOS = Object.freeze([
  Object.freeze({ kind: "applied", label: "申し込み", count: (contract) => (contract.role === "manager" && contract.status === "pending" ? 1 : 0) }),
  Object.freeze({ kind: "unpaid", label: "未払いの請求", count: (contract) => (contract.role === "payer" && contract.status === "active" ? (contract.pendingRequests || []).length : 0) }),
  Object.freeze({ kind: "awaiting", label: "受け取り待ち", count: (contract) => (contract.role === "manager" && contract.status === "active" ? integer(contract.awaitingReceipt) : 0) }),
  Object.freeze({ kind: "work_done", label: "出稼ぎの報告", count: (contract) => (contract.role === "manager" && contract.status === "active" && contract.workOrder?.done ? 1 : 0) }),
  Object.freeze({ kind: "plea", label: "願い出", count: (contract) => (contract.role === "manager" && contract.status === "active" && contract.plea && !contract.plea.granted ? 1 : 0) }),
  Object.freeze({ kind: "granted", label: "許された献上", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.plea?.granted ? 1 : 0) }),
  Object.freeze({ kind: "recite_done", label: "復唱の確認", count: (contract) => (contract.role === "manager" && contract.status === "active" && contract.reciteOrder?.done ? 1 : 0) }),
  Object.freeze({ kind: "extend", label: "延長の申し込み", count: (contract) => (contract.role === "manager" && contract.status === "active" && contract.extension ? 1 : 0) }),
  // 貢ぎオセロ（設計書15.2）: 自分の手番と、財布の罰金。
  Object.freeze({ kind: "othello_turn", label: "オセロの手番", count: (contract) => (contract.status === "active" && contract.othello && contract.othello.turn === contract.role ? 1 : 0) }),
  Object.freeze({ kind: "othello_penalty", label: "オセロの罰金", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.othelloResult ? 1 : 0) }),
  // 出稼ぎの勝負（設計書15.3）: 管理人には期限の過ぎた勝負の判定、財布には負けた勝負の罰金。
  Object.freeze({ kind: "contest_judge", label: "勝負の判定", count: (contract) => (contract.role === "manager" && contract.status === "active" && contestExpired(contract.workOrder) ? 1 : 0) }),
  Object.freeze({ kind: "contest_penalty", label: "勝負の罰金", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.workResult ? 1 : 0) }),
  Object.freeze({ kind: "recite", label: "復唱", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.reciteOrder && !contract.reciteOrder.done ? 1 : 0) }),
  Object.freeze({ kind: "withdraw", label: "使用許可の申請", count: (contract) => (contract.role === "manager" && contract.status === "active" && contract.escrowWithdrawRequest ? 1 : 0) }),
  Object.freeze({ kind: "report", label: "残高報告の依頼", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.reportRequested ? 1 : 0) }),
  Object.freeze({ kind: "work", label: "出稼ぎ命令", count: (contract) => (contract.role === "payer" && contract.status === "active" && contract.workOrder && !contract.workOrder.done ? 1 : 0) }),
  Object.freeze({ kind: "unread", label: "未読", count: (contract) => (contract.status !== "ended" ? integer(contract.unread) : 0) }),
]);

export function contractTodos(contracts) {
  const open = (Array.isArray(contracts) ? contracts : []).filter((contract) => contract?.status !== "ended");
  return CONTRACT_TODOS.map((todo) => {
    const rows = open.filter((contract) => todo.count(contract) > 0);
    return { kind: todo.kind, label: todo.label, total: rows.reduce((sum, contract) => sum + todo.count(contract), 0), contractId: rows[0]?.contractId || "" };
  }).filter((todo) => todo.total > 0);
}

// スレッドの「次へ」。一覧の並び（最後に動いた順）で、いま開いている契約の次から、やることのある契約を探す。
export function nextTodoContract(contracts, currentId) {
  const open = (Array.isArray(contracts) ? contracts : []).filter((contract) => contract?.status !== "ended");
  const index = open.findIndex((contract) => contract.contractId === currentId);
  const ordered = index < 0 ? open : [...open.slice(index + 1), ...open.slice(0, index)];
  for (const contract of ordered) {
    const todo = CONTRACT_TODOS.find((item) => item.count(contract) > 0);
    if (todo) return { contract, kind: todo.kind, label: todo.label, count: todo.count(contract) };
  }
  return null;
}

// 告知の文。中の人の札は必ず入れる（分かって渡すため）。リンクは文とは別に付ける。
const INVITE_DISCLOSURE = Object.freeze({ nekama: "ネカマ・中身は男", as_is: "演じていない", undisclosed: "中の人は非開示" });

export function inviteText(card) {
  const disclosure = INVITE_DISCLOSURE[card?.disclosure] || INVITE_DISCLOSURE.undisclosed;
  const name = String(card?.personaName || "管理人");
  return `お貢ぎ牧場で財布を受付中。${name}（${disclosure}）・入場料 ${formatPay(card?.entryFee)}。会わない前提、換金できないAnjuPayだけの管理です。 #お貢ぎ牧場 #財布募集`;
}

// 今日のひとこと。サーバーの normalizeTodayWord と同じ判定を、送る前に画面で行う。
export const TODAY_WORD = Object.freeze({ length: 30, ttlMs: 24 * 60 * 60 * 1_000, perDay: 3 });
export const BOARD_SEXUAL_PATTERN = /(?:寸止め|射精|お漏らし|おもらし|イかせ|イきた|イかな|イっ|絶頂|オナ|シコ|しこしこ|勃起|精液|性器|ちんこ|ちんぽ|まんこ|セックス|中出し|フェラ|手コキ|足コキ|乳首|おっぱい|エロ)/u;
export const BOARD_SEXUAL_MESSAGE = "掲示板は同意前の人も見るため、性的な言葉は今日のひとことに書けません。";

export function todayWordProblem(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return "今日のひとことを入力してください。";
  if (textLength(text) > TODAY_WORD.length) return `今日のひとことは${TODAY_WORD.length}文字までです。`;
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (BOARD_SEXUAL_PATTERN.test(text)) return BOARD_SEXUAL_MESSAGE;
  return "";
}

// 貢がれ総額の番付（当月）と、管理人の詳細の応援欄。サーバーの LIMITS・normalizeRankingWord・normalizeCheer と同じ判定。
export const GROSS_RANKING = Object.freeze({ limit: 10, minPayers: 3, badgeTop: 5 });
export const RANKING_WORD = Object.freeze({ length: 40 });
export const CHEER = Object.freeze({ length: 40, perDay: 3 });

function publicLineProblem(value, length, label, sexualMessage) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return "";
  if (textLength(text) > length) return `${label}は${length}文字までです。`;
  const reason = forbiddenReason(text);
  if (reason) return FORBIDDEN_MESSAGES[reason];
  if (BOARD_SEXUAL_PATTERN.test(text)) return sexualMessage;
  return "";
}

export function rankingWordProblem(value) {
  return publicLineProblem(value, RANKING_WORD.length, "番付のひとこと", "番付は同意前の人も見るため、性的な言葉は番付のひとことに書けません。");
}

export function cheerProblem(value) {
  if (!String(value ?? "").trim()) return "応援を入力してください。";
  return publicLineProblem(value, CHEER.length, "応援", "応援欄は同意前の人も見るため、性的な言葉は書けません。");
}

// 牧場の名前を保存する前の確認（サーバーの normalizeRanchName と同じ）。末尾の「牧場」は外して数える。空なら名前を外す。
export function ranchNameProblem(value) {
  const text = String(value ?? "").normalize("NFKC").trim().replace(/\s*牧場$/u, "").trim();
  if (!text) return "";
  return publicLineProblem(text, RANCH_NAME.length, "牧場の名前", "牧場の名前は掲示板にも出るため、性的な言葉は書けません。");
}

// 財布の鳴き声を保存する前の確認（サーバーの normalizeMooLines と同じ）。空の行は外す。
export function mooProblem(lines) {
  const list = (Array.isArray(lines) ? lines : []).map((line) => String(line ?? "").normalize("NFKC").trim()).filter(Boolean);
  if (list.length > RANCH_MOO.lines) return `鳴き声は${RANCH_MOO.lines}つまでです。`;
  for (const line of list) {
    const problem = publicLineProblem(line, RANCH_MOO.length, "鳴き声", "鳴き声には性的な言葉は書けません。");
    if (problem) return problem;
  }
  return "";
}

export function wordAgeLabel(at, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Number(at || 0)) / 60_000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  return `${Math.floor(minutes / 60)}時間前`;
}

export function wordRemainingLabel(at, now = Date.now()) {
  const remaining = Math.max(0, Number(at || 0) + TODAY_WORD.ttlMs - now);
  const hours = Math.floor(remaining / 3_600_000);
  return hours >= 1 ? `あと${hours}時間で消えます` : `あと${Math.max(1, Math.ceil(remaining / 60_000))}分で消えます`;
}

export function formatPay(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ja-JP")} Pay`;
}

// 管理人カードの任意のXプロフィール。サーバーの normalizeXProfile と同じ判定で、ユーザー名だけを残す。
export const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const X_PROFILE_HOSTS = Object.freeze(new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]));
const X_RESERVED_PATHS = Object.freeze(new Set([
  "home", "explore", "search", "notifications", "messages", "i", "intent", "settings", "compose",
  "login", "logout", "signup", "tos", "privacy", "hashtag", "share", "account", "jobs", "about",
  "help", "download", "communities", "lists", "bookmarks", "premium", "following", "followers",
]));
export const X_PROFILE_ERROR = "Xのプロフィールは https://x.com/ユーザー名 か @ユーザー名 の形で入力してください（英数字と_の15文字以内）。";
export const X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクは管理人の自己申告です。運営は管理人とXアカウントの本人確認も、リンク先の内容確認も行っていません。X上でのやり取りや、現金・外部決済での送金は、お貢ぎ牧場の上限・解約・通報の保護の外です。外部サイトのx.comへ移動しますか？";

export function normalizeXProfile(value) {
  const raw = String(value ?? "").normalize("NFKC").trim();
  if (!raw) return { xHandle: "" };
  let handle = "";
  if (/^@?[A-Za-z0-9_]{1,15}$/u.test(raw)) {
    handle = raw.replace(/^@/u, "");
  } else {
    let url;
    try {
      url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { error: X_PROFILE_ERROR };
    }
    if (!["https:", "http:"].includes(url.protocol)
      || !X_PROFILE_HOSTS.has(url.hostname.toLowerCase())
      || url.username
      || url.password
      || url.port) {
      return { error: X_PROFILE_ERROR };
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return { error: X_PROFILE_ERROR };
    handle = segments[0].replace(/^@/u, "");
  }
  if (!X_HANDLE_PATTERN.test(handle) || X_RESERVED_PATHS.has(handle.toLowerCase())) return { error: X_PROFILE_ERROR };
  return { xHandle: handle };
}

export function remainingLabel(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Number(expiresAt || 0) - now);
  if (!remaining) return "期限切れ";
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 24) return `残り${Math.floor(hours / 24)}日${hours % 24}時間`;
  if (hours >= 1) return `残り${hours}時間`;
  return `残り${Math.max(1, Math.ceil(remaining / 60_000))}分`;
}
