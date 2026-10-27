"use strict";

// お貢ぎ牧場の純粋な規則。上限・入力・禁止表現・手数料・金庫の段階をここに集め、サービスとテストで共有する。
// 上限と離脱は預ける側が持つ。ここにある関数は、預ける側の上限を超える移動を通さないためにある。

const TRIBUTE_SCHEMA_VERSION = 1;
const TRIBUTE_AGE_VERSION = "tribute-age-v1";

const PER_TRIBUTE_OPTIONS = Object.freeze([10, 30, 50, 100, 300, 500, 1_000, 3_000, 5_000, 10_000]);
const PER_DAY_OPTIONS = Object.freeze([30, 100, 300, 500, 1_000, 3_000, 5_000, 10_000, 30_000]);
const TOTAL_OPTIONS = Object.freeze([100, 300, 1_000, 3_000, 5_000, 10_000, 30_000, 50_000, 100_000]);
// 契約の期間。14日・30日は、月単位で続く管理のために足した（2026-10-27、ユーザー決定）。
const DURATION_DAYS_OPTIONS = Object.freeze([1, 3, 7, 14, 30]);
const MAX_DURATION_DAYS = DURATION_DAYS_OPTIONS.at(-1);
const ENTRY_FEE_OPTIONS = Object.freeze([0, 5, 10, 30, 50, 100]);
// 出稼ぎ命令の回数（命令の後の1on1の正式完走）。毎日のプレイ報酬の段と同じで、10回は本日の基本目標に当たる。
const WORK_ORDER_TARGETS = Object.freeze([1, 3, 5, 10]);
// 復唱の回数（管理人が言わせたい一言を、財布が一字一句同じに打つ回数）。
const RECITE_TARGETS = Object.freeze([1, 3, 5]);
const TONES = Object.freeze(["sweet", "normal", "harsh"]);
const DISCLOSURES = Object.freeze(["nekama", "as_is", "undisclosed"]);
// 管理の型（2026-10-27 に5つへ）。見透かす・管理する・煽る・甘やかす・突き放す。カードに1つか2つ選ぶ。
// それまでの3つ（カードの style: harsh・cold・sweet）は解除し、読まない。選び直してもらう。
const MANAGER_STYLES = Object.freeze(["insight", "manage", "tease", "pamper", "aloof"]);
const MAX_MANAGER_STYLES = 2;
const SIGIL_COLORS = Object.freeze([0, 1, 2, 3, 4, 5]);
// 管理人の印のアイコン。0 はペルソナ名の1文字、1〜42 は用意したアイコン（画像のアップロードはない）。
// 1〜12・24〜35 はイラスト、13〜16 は写真・地雷系、17〜23 は写真・夜ギャル（ここまで無料）。
// 36〜42 は有料の四角いアイコン（1枚 500 Pay の買い切り）。商品IDは ranch_avatar_<番号>。
const AVATAR_MAX = 42;
const AVATAR_IDS = Object.freeze(Array.from({ length: AVATAR_MAX + 1 }, (_, id) => id));
const PREMIUM_AVATAR_IDS = Object.freeze([36, 37, 38, 39, 40, 41, 42]);
const PREMIUM_AVATAR_TYPE = "ranchAvatar";
const PREMIUM_AVATAR_PREFIX = "ranch_avatar_";

// 保存済みの値を読む時も、範囲外は端のアイコンに寄せず文字の印に戻す（クライアントの avatarId と同じ）。
function normalizeAvatar(value) {
  return pickOption(value, AVATAR_IDS, 0);
}
// 請求と献上の名目。sexual の名目は、預ける側が契約で許した時だけ使え、許可を外すと表示もしない。
const PURPOSES = Object.freeze([
  Object.freeze({ id: "management", label: "管理費", sexual: false }),
  Object.freeze({ id: "reward_fee", label: "ご褒美代", sexual: false }),
  Object.freeze({ id: "penalty", label: "罰金", sexual: false }),
  Object.freeze({ id: "edging", label: "寸止め料", sexual: true }),
  Object.freeze({ id: "release", label: "射精料", sexual: true }),
  Object.freeze({ id: "leak_penalty", label: "お漏らし罰金", sexual: true }),
]);
const PURPOSE_IDS = Object.freeze(PURPOSES.map((purpose) => purpose.id));
const SEXUAL_PURPOSE_IDS = Object.freeze(PURPOSES.filter((purpose) => purpose.sexual).map((purpose) => purpose.id));
// 受け取った時に添える短い承認。押すのは毎回管理人で、システムからは出さない。
// 言葉の強さは財布が決める上限で、管理人は上限までのどの強さのご褒美も選べる。
const REWARDS = Object.freeze([
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
// 財布の「言われたい言葉」をご褒美に使った時の印。記録には言葉そのもの（rewardText）を残す。
const REWARD_WORD = "word";
const RECEIVABLE_KINDS = Object.freeze(["request", "silent"]);
// 管理人の受取印。カードに一覧から3つまで登録し、受け取る時に1つ選んで押す。自由入力はない。
const SEALS = Object.freeze([
  Object.freeze({ id: "kakunin", label: "確認済" }),
  Object.freeze({ id: "juryo", label: "受領" }),
  Object.freeze({ id: "yoku", label: "よくできました" }),
  Object.freeze({ id: "gokaku", label: "合格" }),
  Object.freeze({ id: "zako", label: "雑魚" }),
  Object.freeze({ id: "youbun", label: "養分" }),
  Object.freeze({ id: "gokurou", label: "ご苦労" }),
]);
const SEAL_IDS = Object.freeze(SEALS.map((seal) => seal.id));
const DEFAULT_SEALS = Object.freeze(["juryo", "yoku", "kakunin"]);
const FALLBACK_SEAL = "juryo";
const MAX_SEALS = 3;
// 牧場の飾り。AnjuPayストアで買い切り、管理人カードで選ぶ。既定（枠なし・日付印・朱）は無料。
// 飾りが変えるのは見た目だけで、中の人の札・入場料・管理中の人数・掲示板の並び順・手数料には触れない。
const CARD_FRAMES = Object.freeze(["kurokawa", "kusari", "bara", "kinbuchi", "gyokuza"]);
const SEAL_SHAPES = Object.freeze(["date", "square", "oval", "heart", "crown", "wax"]);
const SEAL_INKS = Object.freeze(["shu", "ai", "sumi", "sakura", "kin"]);
const DEFAULT_FRAME = "";
const DEFAULT_SEAL_SHAPE = "date";
const DEFAULT_SEAL_INK = "shu";
const DECORATION_SLOTS = Object.freeze({
  frame: Object.freeze({ type: "ranchFrame", prefix: "ranch_frame_", ids: CARD_FRAMES, fallback: DEFAULT_FRAME }),
  sealShape: Object.freeze({ type: "ranchSealShape", prefix: "ranch_seal_", ids: SEAL_SHAPES, fallback: DEFAULT_SEAL_SHAPE }),
  sealInk: Object.freeze({ type: "ranchSealInk", prefix: "ranch_ink_", ids: SEAL_INKS, fallback: DEFAULT_SEAL_INK }),
});
// 枠の色。持っている枠なら、どの色も追加料金なしで選べる。どの枠にもピンク系を入れ、1色目はいまの色。
const FRAME_COLORS = Object.freeze({
  kurokawa: Object.freeze(["black", "pink", "brown", "bordeaux", "navy"]),
  kusari: Object.freeze(["silver", "pinkgold", "gold", "iron", "chrome"]),
  bara: Object.freeze(["red", "pink", "black", "white", "blue"]),
  kinbuchi: Object.freeze(["gold", "pinkgold", "silver", "rosegold", "blackgold"]),
  gyokuza: Object.freeze(["crimson", "pink", "jet", "violet", "lapis"]),
  kura: Object.freeze(["shirakabe", "pink", "kurokabe", "shu", "ai"]),
  houmotsu: Object.freeze(["gold", "pinkgold", "silver", "ruby", "lapis"]),
  kinjo: Object.freeze(["gold", "pink", "blackgold", "shu", "violet"]),
});
// 有料アイコンも牧場の飾りと同じに扱う（買っても対戦の装備にはせず、カード編集で選ぶ）。
// 持っている飾りは Firestore の in で読むので、全部で30個までにする。
const DECORATION_PRODUCT_TYPES = Object.freeze([...Object.values(DECORATION_SLOTS).map((slot) => slot.type), PREMIUM_AVATAR_TYPE]);
const DECORATION_PRODUCT_IDS = Object.freeze([
  ...Object.values(DECORATION_SLOTS).flatMap((slot) => (
    slot.ids.filter((id) => id !== slot.fallback).map((id) => `${slot.prefix}${id}`)
  )),
  ...PREMIUM_AVATAR_IDS.map((id) => `${PREMIUM_AVATAR_PREFIX}${id}`),
]);
// 金庫の段階で手に入る非売品の飾り（ストアでは売らない）。一度届いた段階の飾りは、金庫から出してもずっと使える。
const VAULT_DECORATIONS = Object.freeze([
  Object.freeze({ slot: "sealInk", id: "kogane", tier: 1 }),
  Object.freeze({ slot: "sealShape", id: "senryo", tier: 2 }),
  Object.freeze({ slot: "frame", id: "kura", tier: 3 }),
  Object.freeze({ slot: "frame", id: "houmotsu", tier: 4 }),
  Object.freeze({ slot: "frame", id: "kinjo", tier: 5 }),
]);
const CARD_ACHIEVEMENT_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const REPORT_REASONS = Object.freeze([
  "external_trade",
  "personal_info",
  "exit_obstruction",
  "threat",
  "other",
]);
const SEVERE_REPORT_REASONS = Object.freeze(["external_trade", "personal_info", "exit_obstruction", "threat"]);

const LIMITS = Object.freeze({
  personaName: 16,
  intro: 60,
  walletName: 16,
  // 管理人が財布ごとに付ける呼び名（管理人にだけ見える）。
  nickname: 12,
  nicknameEntries: 300,
  ngWordCount: 5,
  ngWordLength: 12,
  // 財布が登録する「言われたい言葉」（言われたくない言葉の反対）。管理人の言葉選びの手がかりにする。
  wantWordCount: 5,
  wantWordLength: 12,
  // 抵抗: 未払いの請求1件に、財布が渋る一言を返せる回数（請求は断れないまま）。
  resistsPerRequest: 3,
  // 言葉の献上（Pay 0 で差し出す文）。1つの契約で日本時間の1日3回まで。
  wordOffering: 400,
  wordOfferingsPerDay: 3,
  // 管理人の自分の言葉（管理人だけが読む）。定型文と、ご褒美。受取印の言葉はカードの受取印に混ぜる。
  ownLines: 10,
  ownLineLength: 60,
  ownRewards: 5,
  ownRewardLength: 12,
  sealWordLength: 7,
  message: 240,
  requestNote: 60,
  pendingRequests: 3,
  payerOpenContracts: 5,
  managerActiveContracts: 50,
  managerPendingContracts: 30,
  messageIntervalMs: 2_000,
  messagesPerDay: 300,
  applicationTtlMs: 48 * 60 * 60 * 1_000,
  managerDailyReceive: 100_000,
  rankDailyPairCap: 500,
  feeRateBasisPoints: 500,
  minimumFee: 1,
  rankingLimit: 20,
  boardLimit: 30,
  eventsPage: 100,
  receiptsPage: 50,
  severeReportHide: 3,
  todayWord: 30,
  todayWordTtlMs: 24 * 60 * 60 * 1_000,
  todayWordsPerDay: 3,
  cardAchievements: 3,
  // 管理人の請求は、財布の限度額に関係なく1回10,000 Payまで。払えない請求は未払いのまま残る。
  requestMax: 10_000,
  // 直近30日に3,000 Pay以上を請求した管理人のカードに「高額請求」の札を出す。
  highRequest: 3_000,
  highRequestWindowMs: 30 * 24 * 60 * 60 * 1_000,
  // 掲示板には、直近7日に動いた管理人だけを並べる（放置されたカードは読まない）。外れる2日前から管理人に知らせる。
  boardActiveWindowMs: 7 * 24 * 60 * 60 * 1_000,
  boardNoticeMs: 2 * 24 * 60 * 60 * 1_000,
  // 1回の限度額を3,000 Pay以上にできるのは、AnjuPayウォレットを Google で保護した財布だけ。
  googleCapThreshold: 3_000,
  // 金庫を作れるのは、お貢ぎ牧場で累計3人以上の財布から、合わせて1,000 Pay以上を受け取った管理人だけ（推し値市場の実績は数えない）。
  vaultQualifyPayers: 3,
  vaultQualifyReceived: 1_000,
  vaultRankingLimit: 30,
  vaultRecentOps: 20,
  // 貢がれ総額の番付（当月）。財布3人以上から貢がれた管理人だけ、上位10まで。1〜5位はカードにハートの札。
  grossRankingLimit: 10,
  grossRankingMinPayers: 3,
  grossRankingScan: 60,
  rankBadgeTop: 5,
  rankBadgeCacheMs: 10 * 60 * 1_000,
  // 番付のひとこと（貢がれ総額の10位以内で番付に載る）と、管理人の詳細の応援欄。
  rankingWord: 40,
  cheer: 40,
  cheersPerDay: 3,
  cheersLimit: 30,
});

// 管理人の金庫の段階。いま金庫にある額で決まり、外には段階だけを見せる（額は本人だけ）。
const VAULT_TIERS = Object.freeze([
  Object.freeze({ level: 1, id: "box", label: "木箱", threshold: 1_000 }),
  Object.freeze({ level: 2, id: "safe", label: "金庫", threshold: 5_000 }),
  Object.freeze({ level: 3, id: "kura", label: "蔵", threshold: 10_000 }),
  Object.freeze({ level: 4, id: "treasury", label: "宝物庫", threshold: 30_000 }),
  Object.freeze({ level: 5, id: "castle", label: "金の城", threshold: 100_000 }),
]);

// 終わった牧場基金の上納の称号（2026年10月まで）。実績コレクションの限定称号として残す。
const HONOR_TIERS = Object.freeze([
  Object.freeze({ id: "offerer", label: "上納者", threshold: 300, achievementId: "tribute_honor_offerer" }),
  Object.freeze({ id: "grand_offerer", label: "大上納者", threshold: 1_500, achievementId: "tribute_honor_grand_offerer" }),
  Object.freeze({ id: "master", label: "牧場の主", threshold: 5_000, achievementId: "tribute_honor_master" }),
]);

function cleanLine(value, maximumLength) {
  return Array.from(String(value ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()).slice(0, maximumLength).join("");
}

// 会話は打った文字のまま残す（全角の？！も保つ）。禁止表現の判定は forbiddenReason が NFKC で行う。
function cleanMultiline(value, maximumLength) {
  const text = String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return Array.from(text).slice(0, maximumLength).join("");
}

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

function pickOption(value, options, fallback = null) {
  const number = Number(value);
  return options.includes(number) ? number : fallback;
}

function pickEnum(value, options, fallback = null) {
  const text = String(value ?? "");
  return options.includes(text) ? text : fallback;
}

// 外部連絡先・外部決済・現金・会う約束・住所や本名・晒しの脅しを拒否する。理由コードを返し、問題がなければ空文字。
const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({ reason: "email", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu }),
  Object.freeze({ reason: "url", pattern: /https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|jp|me|io|app|link|ly|gg|co|info|xyz|cc|to|tv)\b/iu }),
  Object.freeze({ reason: "phone", pattern: /(?:\d[\s-]?){10,}/u }),
  Object.freeze({ reason: "contact_app", pattern: /(?:\bline\s?(?:id|交換|で|やって|追加)|ライン(?:id|ＩＤ|交換|で話|やって|追加|教)|discord|ディスコード|telegram|テレグラム|kakao|カカオトーク|skype|スカイプ|instagram|インスタ|tiktok|ティックトック|twitter|ツイッター|threads|xのid|ＩＤ交換|id交換|連絡先|アカウント教え|裏垢)/iu }),
  Object.freeze({ reason: "handle", pattern: /(?:^|[\s(（「])@[a-z0-9_]{3,}/iu }),
  Object.freeze({ reason: "external_payment", pattern: /(?:paypay|ペイペイ|ぺいぺい|paypal|ペイパル|kyash|キャッシュアプリ|cash\s?app|venmo|楽天ペイ|メルペイ|d払い|au\s?pay|line\s?pay|ラインペイ|振込|振り込|口座|銀行|送金アプリ|アマギフ|amazon\s?ギフト|アマゾンギフト|itunes|google\s?play\s?ギフト|ギフト券|ギフトコード|プリペイド|電子マネー|ビットコイン|bitcoin|仮想通貨|暗号資産|現金|キャッシュバック|換金|リアルマネー|rmt)/iu }),
  Object.freeze({ reason: "real_money", pattern: /\d[\d,]*\s?(?:円|万円|千円|ドル|＄|\$)|(?:円|万円)\s?\d/u }),
  Object.freeze({ reason: "meeting", pattern: /(?:(?<!出)会(?:おう|いたい|える|お(?:う|か)|って)|オフ会|待ち合わせ|直接会|リアルで会|ホテル|家に来|家行)/u }),
  Object.freeze({ reason: "personal_info", pattern: /(?:住所|本名|電話番号|勤務先|学校名|顔写真|免許証|マイナンバー|生年月日)/u }),
  Object.freeze({ reason: "exposure_threat", pattern: /(?:晒す|晒して|晒し上げ|晒すぞ|特定する|特定して|特定した|ばらす|バラす|拡散する)/u }),
]);

function forbiddenReason(text) {
  const normalized = String(text ?? "").normalize("NFKC");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) return reason;
  }
  return "";
}

// 契約後の会話と請求の一言は、ロールプレイの幅を広げるため、現実のお金の判定だけを残す（ユーザー決定）。
// 連絡先・会う約束・個人情報・晒しの判定は、カード・掲示板・財布名にだけかける。牧場の「管理口座」は通す。
const CONTRACT_TEXT_REASONS = Object.freeze(["external_payment", "real_money"]);

function contractTextReason(text) {
  const normalized = String(text ?? "").normalize("NFKC").replace(/管理口座/gu, "");
  for (const { reason, pattern } of FORBIDDEN_PATTERNS) {
    if (CONTRACT_TEXT_REASONS.includes(reason) && pattern.test(normalized)) return reason;
  }
  return "";
}

const FORBIDDEN_MESSAGES = Object.freeze({
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

// 掲示板は、性的な名目に同意する前の人も見る。今日のひとことには性的な言葉を書けない。
const BOARD_SEXUAL_PATTERN = /(?:寸止め|射精|お漏らし|おもらし|イかせ|イきた|イかな|イっ|絶頂|オナ|シコ|しこしこ|勃起|精液|性器|ちんこ|ちんぽ|まんこ|セックス|中出し|フェラ|手コキ|足コキ|乳首|おっぱい|エロ)/u;
const BOARD_SEXUAL_MESSAGE = "掲示板は同意前の人も見るため、性的な言葉は今日のひとことに書けません。";

function boardSexualWord(text) {
  return BOARD_SEXUAL_PATTERN.test(String(text ?? "").normalize("NFKC"));
}

// 番付と応援欄も、同意前の人が見る。掲示板と同じく、連絡先などの禁止表現と性的な言葉は通さない。
const RANKING_SEXUAL_MESSAGE = "番付は同意前の人も見るため、性的な言葉は番付のひとことに書けません。";
const CHEER_SEXUAL_MESSAGE = "応援欄は同意前の人も見るため、性的な言葉は書けません。";

// 番付のひとこと。40文字まで、空なら外す。
function normalizeRankingWord(value) {
  const text = cleanLine(value, LIMITS.rankingWord);
  if (!text) return { text: "" };
  const reason = forbiddenReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  if (boardSexualWord(text)) return { error: RANKING_SEXUAL_MESSAGE };
  return { text };
}

// 応援欄のひとこと。40文字まで、空なら消す。
function normalizeCheer(value) {
  const text = cleanLine(value, LIMITS.cheer);
  if (!text) return { text: "" };
  const reason = forbiddenReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  if (boardSexualWord(text)) return { error: CHEER_SEXUAL_MESSAGE };
  return { text };
}

// 今日のひとこと。30文字まで、連絡先などの禁止表現と性的な言葉は通さない。
function normalizeTodayWord(value) {
  const text = cleanLine(value, LIMITS.todayWord);
  if (!text) return { error: "今日のひとことを入力してください。" };
  const reason = forbiddenReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  if (boardSexualWord(text)) return { error: BOARD_SEXUAL_MESSAGE };
  return { text };
}

function normalizeNgWords(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,、]/u);
  return [...new Set(list
    .map((word) => cleanLine(word, LIMITS.ngWordLength))
    .filter(Boolean))].slice(0, LIMITS.ngWordCount);
}

function containsNgWord(text, ngWords) {
  const normalized = String(text ?? "").normalize("NFKC").toLowerCase();
  return (Array.isArray(ngWords) ? ngWords : [])
    .some((word) => word && normalized.includes(String(word).normalize("NFKC").toLowerCase()));
}

// 言われたい言葉。会話と同じく外部決済・現金・現実の金額を止め、言われたくない言葉を含む語は登録できない。
// 財布が自分の受け方を決める設定なので、性的な言葉は止めない。
const WANT_WORDS_NG_MESSAGE = "「言われたくない言葉」を含む言葉は、言われたい言葉に登録できません。";

function normalizeWantWords(value, { ngWords = [] } = {}) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,、]/u);
  const words = [...new Set(list
    .map((word) => cleanLine(word, LIMITS.wantWordLength))
    .filter(Boolean))].slice(0, LIMITS.wantWordCount);
  for (const word of words) {
    const reason = contractTextReason(word);
    if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
    if (containsNgWord(word, ngWords)) return { error: WANT_WORDS_NG_MESSAGE };
  }
  return { words };
}

function normalizeCaps(value) {
  const perTribute = pickOption(value?.perTribute, PER_TRIBUTE_OPTIONS);
  const perDay = pickOption(value?.perDay, PER_DAY_OPTIONS);
  const total = pickOption(value?.total, TOTAL_OPTIONS);
  if (perTribute === null || perDay === null || total === null) return null;
  if (perTribute > perDay || perDay > total) return null;
  return { perTribute, perDay, total };
}

function capsAreLowerOrEqual(next, current) {
  return next.perTribute <= current.perTribute
    && next.perDay <= current.perDay
    && next.total <= current.total;
}

// 管理人カードの任意のXプロフィール。https://x.com/ユーザー名 か @ユーザー名 を受け取り、ユーザー名だけを保存する。
// リンクは表示の時に組み立てる。個別ポストや検索など、プロフィール以外のURLは受け付けない。
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
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
const X_PROFILE_ERROR = "Xのプロフィールは https://x.com/ユーザー名 か @ユーザー名 の形で入力してください（英数字と_の15文字以内）。";

function normalizeXProfile(value) {
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

// 管理人の自分の言葉の受取印（「word:言葉」で一覧の印と混ぜて登録する）。どの契約のレシートにも残り、
// 貢ぎ報告の画像にも入るので、今日のひとことと同じ禁止表現と性的な言葉を通さない。
const SEAL_WORD_PREFIX = "word:";
const SEAL_WORD_SEXUAL_MESSAGE = "受取印の言葉はレシートと貢ぎ報告の画像に残るため、性的な言葉は使えません。";

function normalizeSealWord(value) {
  const text = cleanLine(value, LIMITS.sealWordLength);
  if (!text) return { error: "受取印の言葉を入力してください。" };
  const reason = forbiddenReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  if (boardSexualWord(text)) return { error: SEAL_WORD_SEXUAL_MESSAGE };
  return { word: text };
}

function isSealWord(value) {
  const text = String(value ?? "");
  if (!text.startsWith(SEAL_WORD_PREFIX)) return false;
  const word = text.slice(SEAL_WORD_PREFIX.length);
  return normalizeSealWord(word).word === word;
}

// 印の言葉（一覧の印は表示名、自分の言葉の印は言葉そのもの）。
function sealText(value) {
  const id = String(value ?? "");
  if (isSealWord(id)) return id.slice(SEAL_WORD_PREFIX.length);
  return SEALS.find((entry) => entry.id === id)?.label || "";
}

// 記録した印を読む。一覧の印と、自分の言葉の印だけを返す。
function storedSeal(value) {
  const id = String(value ?? "");
  return SEAL_IDS.includes(id) || isSealWord(id) ? id : "";
}

// カードに登録する受取印。一覧の印と自分の言葉の印を、重複なく3つまで。空なら既定の3つ。
function normalizeSeals(value) {
  const list = Array.isArray(value) ? value : [];
  const seals = [...new Set(list.map(String).filter((id) => SEAL_IDS.includes(id) || isSealWord(id)))].slice(0, MAX_SEALS);
  return seals.length ? seals : [...DEFAULT_SEALS];
}

// 受け取る時に押す印。管理人が登録した印だけを使い、財布の「言われたくない言葉」に当たる印は「受領」に置き換える。
function sealFor(value, { seals = DEFAULT_SEALS, ngWords = [] } = {}) {
  const registered = normalizeSeals(seals);
  const requested = String(value ?? "");
  const id = registered.includes(requested) ? requested : registered[0];
  const label = sealText(id);
  return label && !containsNgWord(label, ngWords) ? id : FALLBACK_SEAL;
}

// 飾りの選択。知らない値は既定に戻す（持っているか・金庫の段階に届いたかは、保存する時にサービスで確かめる）。
function normalizeDecorations(value) {
  const decorations = {};
  for (const [key, slot] of Object.entries(DECORATION_SLOTS)) {
    const requested = String(value?.[key] ?? "");
    const vaultItem = VAULT_DECORATIONS.some((item) => item.slot === key && item.id === requested);
    decorations[key] = slot.ids.includes(requested) || vaultItem ? requested : slot.fallback;
  }
  // 枠の色は枠ごとの一覧から。枠がなければ空、知らない色はその枠の1色目。
  const colors = FRAME_COLORS[decorations.frame] || [];
  const color = String(value?.frameColor ?? "");
  decorations.frameColor = colors.includes(color) ? color : colors[0] || "";
  return decorations;
}

function decorationProductId(slotKey, id) {
  const slot = DECORATION_SLOTS[slotKey];
  if (!slot || id === slot.fallback || !slot.ids.includes(id)) return "";
  return `${slot.prefix}${id}`;
}

function premiumAvatarProductId(value) {
  const id = normalizeAvatar(value);
  return PREMIUM_AVATAR_IDS.includes(id) ? `${PREMIUM_AVATAR_PREFIX}${id}` : "";
}

// 既定ではない飾りと有料アイコンの商品ID。保存する前に、この全部を持っているかを確かめる（金庫の飾りは商品ではない）。
function requiredDecorationProducts(decorations) {
  return [
    ...Object.keys(DECORATION_SLOTS).map((key) => decorationProductId(key, decorations?.[key])),
    premiumAvatarProductId(decorations?.avatar),
  ].filter(Boolean);
}

// 選んだ金庫の飾りに必要な段階（いちばん高いもの）。0 なら金庫の飾りを使っていない。
function requiredVaultTier(decorations) {
  return VAULT_DECORATIONS
    .filter((item) => decorations?.[item.slot] === item.id)
    .reduce((highest, item) => Math.max(highest, item.tier), 0);
}

function vaultTierFor(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  return VAULT_TIERS.reduce((level, tier) => (value >= tier.threshold ? tier.level : level), 0);
}

function vaultTierInfo(level) {
  return VAULT_TIERS.find((tier) => tier.level === Number(level)) || null;
}

// 金庫を作れる管理人か（お貢ぎ牧場の組ごとの累計から）。
function vaultQualification(pairs) {
  const paid = (Array.isArray(pairs) ? pairs : []).map((pair) => Math.max(0, Math.floor(Number(pair?.total) || 0))).filter((total) => total > 0);
  const payers = paid.length;
  const received = paid.reduce((sum, total) => sum + total, 0);
  return { payers, received, qualified: payers >= LIMITS.vaultQualifyPayers && received >= LIMITS.vaultQualifyReceived };
}

// 牧場のカードに出す実績（3つまで）。形だけ整え、解除済みかはサービスで確かめる。
function normalizeCardAchievements(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(String).filter((id) => CARD_ACHIEVEMENT_ID_PATTERN.test(id)))].slice(0, LIMITS.cardAchievements);
}

// 知らない型は捨て、重なりをなくし、一覧の順にそろえる（2つまで）。主と副はカードで伝えないので、並びは一覧の順。
function normalizeStyles(value) {
  const chosen = new Set((Array.isArray(value) ? value : []).map(String));
  return MANAGER_STYLES.filter((id) => chosen.has(id)).slice(0, MAX_MANAGER_STYLES);
}

function normalizeManagerCard(value) {
  const personaName = cleanLine(value?.personaName, LIMITS.personaName);
  const intro = cleanLine(value?.intro, LIMITS.intro);
  const disclosure = pickEnum(value?.disclosure, DISCLOSURES);
  const styles = normalizeStyles(value?.styles);
  const entryFee = pickOption(value?.entryFee, ENTRY_FEE_OPTIONS);
  const sigil = pickOption(value?.sigil, SIGIL_COLORS, 0);
  const avatar = normalizeAvatar(value?.avatar);
  if (!personaName) return { error: "ペルソナ名を1〜16文字で入力してください。" };
  if (!disclosure) return { error: "中の人の札を選んでください。" };
  if (!styles.length || (Array.isArray(value?.styles) && value.styles.length > MAX_MANAGER_STYLES)) {
    return { error: `管理の型を1つか${MAX_MANAGER_STYLES}つ選んでください。` };
  }
  if (entryFee === null) return { error: "入場料を選び直してください。" };
  for (const text of [personaName, intro]) {
    const reason = forbiddenReason(text);
    if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  }
  const x = normalizeXProfile(value?.xProfile ?? value?.xHandle);
  if (x.error) return { error: x.error };
  const rankingWord = normalizeRankingWord(value?.rankingWord);
  if (rankingWord.error) return { error: rankingWord.error };
  return {
    card: {
      personaName,
      intro,
      disclosure,
      styles,
      entryFee,
      sigil,
      avatar,
      seals: normalizeSeals(value?.seals),
      ...normalizeDecorations(value),
      achievements: normalizeCardAchievements(value?.achievements),
      // 財布の貢ぎ報告の画像に、名前とアイコンを出してよいか。決めていないカードは出さない。
      reportConsent: value?.reportConsent === true,
      // 管理人の宣言「未払いは既読無視」。財布の画面と掲示板のカードに札として出す。
      ignoreUnpaid: value?.ignoreUnpaid === true,
      // 管理人の宣言「スクショを載せる」。載せてよいのは、財布が申し込みで許した契約だけ（allowScreenshots）。
      postsScreenshots: value?.postsScreenshots === true,
      // 掲示板と管理人の詳細に、最後に動いた時を出すか。管理人が選んだ時だけ出す（初期は出さない）。
      showsActivity: value?.showsActivity === true,
      // 番付のひとこと。貢がれ総額の番付で10位以内に入った時だけ、X のプロフィールと一緒に番付に出す。
      rankingWord: rankingWord.text,
      xHandle: x.xHandle,
      accepting: value?.accepting === true,
    },
  };
}

function normalizeWalletName(value) {
  const name = cleanLine(value, LIMITS.walletName);
  if (!name) return "名無しの財布";
  return forbiddenReason(name) ? "名無しの財布" : name;
}

// 管理人が財布ごとに付ける呼び名。管理人にだけ見えるので、言葉の判定はかけない（空にすると外す）。
function normalizeNickname(value) {
  return cleanLine(value, LIMITS.nickname);
}

function normalizeApplication(value, { entryFee = 0 } = {}) {
  const caps = normalizeCaps(value?.caps);
  if (!caps) return { error: "限度額は「1回 ≦ 1日 ≦ 合計」になるように選んでください。" };
  const durationDays = pickOption(value?.durationDays, DURATION_DAYS_OPTIONS);
  if (durationDays === null) return { error: "期間を選び直してください。" };
  const tone = pickEnum(value?.tone, TONES);
  if (!tone) return { error: "言葉の強さを選び直してください。" };
  if (Number(entryFee) > caps.perTribute) {
    return { error: "この管理人の入場料が、あなたの1回の限度額を超えています。" };
  }
  // 請求は断れない（払うか、解約するか）。申し込む時に、財布が確かめたことを残す。
  if (value?.acceptNoDecline !== true) {
    return { error: "請求は断れず、払うか解約するかであることを確かめてください。" };
  }
  const ngWords = normalizeNgWords(value?.ngWords);
  const want = normalizeWantWords(value?.wantWords, { ngWords });
  if (want.error) return { error: want.error };
  return {
    application: {
      caps,
      durationDays,
      tone,
      ngWords,
      wantWords: want.words,
      allowReportRequests: value?.allowReportRequests === true,
      rankOptIn: value?.rankOptIn === true,
      allowSexualPurposes: value?.allowSexualPurposes === true,
      // 管理人のXに、自分が写る画面のスクショを載せられてもよいか。決めるのは財布だけ（既定は許さない）。
      allowScreenshots: value?.allowScreenshots === true,
      // 管理人の出稼ぎ命令（1on1を○回完走してこい）を受けるか。古い画面から届いた申し込みは受けない。
      allowWorkOrders: value?.allowWorkOrders === true,
      // 管理人の「お預け」（財布から勝手に差し出せなくする）を受けるか。古い画面から届いた申し込みは受けない。
      allowHolds: value?.allowHolds === true,
      walletName: normalizeWalletName(value?.walletName),
    },
  };
}

// 名目なしは空文字。性的な名目は、契約で預ける側が許している時だけ通す。
function normalizePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!purpose) return { purpose: "" };
  if (!PURPOSE_IDS.includes(purpose)) return { error: "名目を選び直してください。" };
  if (SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true) {
    return { error: "この契約では、預ける側が性的な名目を許していません。" };
  }
  return { purpose };
}

// 保存済みの名目を表示用に読む。許可が外れた契約では、性的な名目を出さない。
function visiblePurpose(value, { allowSexual = false } = {}) {
  const purpose = String(value ?? "");
  if (!PURPOSE_IDS.includes(purpose)) return "";
  return SEXUAL_PURPOSE_IDS.includes(purpose) && allowSexual !== true ? "" : purpose;
}

// 契約の言葉の強さは、財布が決めた「ここまでなら言われてもいい」の上限。上限までの強さを、弱い順に返す。
function tonesUpTo(tone) {
  const index = TONES.indexOf(tone);
  return TONES.slice(0, (index < 0 ? TONES.indexOf("normal") : index) + 1);
}

// 型ごとのご褒美（style 付き）は、管理人がその型をカードで選んでいる時だけ選べる。
function rewardsFor(tone, ngWords = [], styles = []) {
  const allowed = tonesUpTo(tone);
  const chosen = normalizeStyles(styles);
  return REWARDS.filter((reward) => (!reward.style || chosen.includes(reward.style))
    && reward.tones.some((entry) => allowed.includes(entry)) && !containsNgWord(reward.label, ngWords));
}

// 管理人の自分の言葉（定型文・ご褒美）を、この契約で出せるか。強さの札が契約の上限以下、言われたくない言葉を含まない、
// 性的な言葉は性的な名目を許した契約でだけ。
function ownWordUsable(entry, { tone = "normal", ngWords = [], allowSexual = false } = {}) {
  const text = String(entry?.text ?? "");
  if (!text || !tonesUpTo(tone).includes(entry?.tone)) return false;
  if (containsNgWord(text, ngWords)) return false;
  return allowSexual === true || !boardSexualWord(text);
}

// ご褒美は一覧の一言か、言葉そのもの（REWARD_WORD）。言葉は、財布がいま登録している言われたい言葉か、
// 管理人の自分のご褒美のうちこの契約で出せるもの。
function normalizeReward(value, { tone = "normal", ngWords = [], wantWords = [], ownRewards = [], allowSexual = false, text = "", styles = [] } = {}) {
  const reward = String(value ?? "");
  if (!reward) return { reward: "" };
  if (reward === REWARD_WORD) {
    const word = cleanLine(text, Math.max(LIMITS.wantWordLength, LIMITS.ownRewardLength));
    const wanted = Array.isArray(wantWords) ? wantWords.map((entry) => cleanLine(entry, LIMITS.wantWordLength)) : [];
    const own = (Array.isArray(ownRewards) ? ownRewards : [])
      .filter((entry) => ownWordUsable(entry, { tone, ngWords, allowSexual }))
      .map((entry) => cleanLine(entry.text, LIMITS.ownRewardLength));
    if (!word || (!wanted.includes(word) && !own.includes(word))) return { error: "その言葉は、いまのご褒美の候補にありません。開き直してください。" };
    if (containsNgWord(word, ngWords)) return { error: "このご褒美は、この契約では選べません。" };
    return { reward, rewardText: word };
  }
  if (!rewardsFor(tone, ngWords, styles).some((entry) => entry.id === reward)) {
    return { error: "このご褒美は、この契約では選べません。" };
  }
  return { reward };
}

// 言われたい言葉を使ったご褒美の、記録した言葉。一覧の一言（id だけで読める）と、読めないものは空文字。
function storedRewardText(record) {
  const source = record && typeof record === "object" ? record : {};
  if (source.reward !== REWARD_WORD) return "";
  return cleanLine(source.rewardText, Math.max(LIMITS.wantWordLength, LIMITS.ownRewardLength));
}

// 管理人の自分の言葉（定型文10・ご褒美5、強さの札付き）。確認は会話と同じ（外部決済・現金・現実の金額）。
function normalizeOwnWords(value) {
  const read = (list, maximum, length) => (Array.isArray(list) ? list : [])
    .map((entry) => ({ text: cleanLine(entry?.text, length), tone: TONES.includes(entry?.tone) ? entry.tone : "normal" }))
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

// 言葉の献上（Pay 0 で差し出す文）。400文字まで、会話と同じ確認。
function normalizeWordOffering(value) {
  const text = cleanMultiline(value, LIMITS.wordOffering);
  if (!text) return { error: "差し出す言葉を書いてください。" };
  const reason = contractTextReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason] };
  return { text };
}

// 復唱の一言を比べる形（NFKC にし、前後の空白を取り、続く空白を1つにする）。
function reciteKey(value) {
  return cleanLine(value, LIMITS.requestNote);
}

function normalizeMessage(value) {
  const text = cleanMultiline(value, LIMITS.message);
  if (!text) return { error: "メッセージを入力してください。" };
  const reason = contractTextReason(text);
  if (reason) return { error: FORBIDDEN_MESSAGES[reason], reason };
  return { text };
}

function tributeFee(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  if (!value) return 0;
  return Math.min(value, Math.max(LIMITS.minimumFee, Math.ceil((value * LIMITS.feeRateBasisPoints) / 10_000)));
}

function honorTierFor(offeredTotal) {
  const total = Math.max(0, Number(offeredTotal) || 0);
  return [...HONOR_TIERS].reverse().find((tier) => total >= tier.threshold) || null;
}

// その月に取った称号と、それより下の称号の限定実績（上の称号を取った人は、下の称号も持つ）。
function honorAchievementIds(honor) {
  const reached = HONOR_TIERS.find((tier) => tier.id === honor?.tierId) || honorTierFor(honor?.offered);
  if (!reached) return [];
  return HONOR_TIERS.slice(0, HONOR_TIERS.indexOf(reached) + 1).map((tier) => tier.achievementId);
}

function jstDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function jstMonthKey(timestamp = Date.now()) {
  return jstDateKey(timestamp).slice(0, 7);
}

function nextJstDateKey(timestamp = Date.now()) {
  return jstDateKey(Number(timestamp) + 24 * 60 * 60 * 1_000);
}

// 上げる変更は翌日0時（日本時間）から効く。その日を過ぎていれば予約中の上限を適用する。
function effectiveCaps(contract, timestamp = Date.now()) {
  const caps = normalizeCaps(contract?.caps);
  const pending = normalizeCaps(contract?.pendingCaps);
  const effectiveDateKey = String(contract?.pendingCapsEffectiveDateKey || "");
  if (caps && pending && effectiveDateKey && jstDateKey(timestamp) >= effectiveDateKey) {
    return { caps: pending, applied: true };
  }
  return { caps, applied: false };
}

function todayUsed(contract, timestamp = Date.now()) {
  const todayKey = jstDateKey(timestamp);
  return contract?.todayKey === todayKey ? Math.max(0, Number(contract.todayTributed) || 0) : 0;
}

// 1回・1日・合計の上限から、この献上で渡せる最大額を出す。
function tributeAllowance(contract, caps, timestamp = Date.now()) {
  if (!caps) return 0;
  const usedToday = todayUsed(contract, timestamp);
  const usedTotal = Math.max(0, Number(contract?.totalTributed) || 0);
  return Math.max(0, Math.min(
    caps.perTribute,
    caps.perDay - usedToday,
    caps.total - usedTotal,
  ));
}

// 1回の限度額が大きい（3,000 Pay以上）か。Google で保護した財布だけが選べる。
function capsNeedGoogle(caps) {
  return Number(caps?.perTribute) >= LIMITS.googleCapThreshold;
}

function capViolation(amount, contract, caps, timestamp = Date.now()) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 1) return "金額は1 Pay以上の整数で指定してください。";
  if (!caps) return "限度額を確認できませんでした。";
  if (value > caps.perTribute) return `1回の限度額（${caps.perTribute} Pay）を超えています。`;
  if (todayUsed(contract, timestamp) + value > caps.perDay) return `今日の限度額（${caps.perDay} Pay）を超えています。`;
  if ((Number(contract?.totalTributed) || 0) + value > caps.total) return `契約合計の限度額（${caps.total} Pay）を超えています。`;
  return "";
}

function pairId(managerUid, payerUid) {
  return `${managerUid}__${payerUid}`;
}

module.exports = {
  TRIBUTE_SCHEMA_VERSION,
  TRIBUTE_AGE_VERSION,
  PER_TRIBUTE_OPTIONS,
  PER_DAY_OPTIONS,
  TOTAL_OPTIONS,
  DURATION_DAYS_OPTIONS,
  MAX_DURATION_DAYS,
  ENTRY_FEE_OPTIONS,
  WORK_ORDER_TARGETS,
  RECITE_TARGETS,
  TONES,
  tonesUpTo,
  DISCLOSURES,
  MANAGER_STYLES,
  MAX_MANAGER_STYLES,
  normalizeStyles,
  SIGIL_COLORS,
  PURPOSES,
  PURPOSE_IDS,
  SEXUAL_PURPOSE_IDS,
  REWARDS,
  REWARD_WORD,
  RECEIVABLE_KINDS,
  SEALS,
  SEAL_IDS,
  DEFAULT_SEALS,
  FALLBACK_SEAL,
  CARD_FRAMES,
  SEAL_SHAPES,
  SEAL_INKS,
  DEFAULT_FRAME,
  DEFAULT_SEAL_SHAPE,
  DEFAULT_SEAL_INK,
  DECORATION_SLOTS,
  FRAME_COLORS,
  DECORATION_PRODUCT_TYPES,
  DECORATION_PRODUCT_IDS,
  VAULT_DECORATIONS,
  normalizeDecorations,
  decorationProductId,
  requiredDecorationProducts,
  requiredVaultTier,
  normalizeCardAchievements,
  AVATAR_IDS,
  AVATAR_MAX,
  PREMIUM_AVATAR_IDS,
  normalizeAvatar,
  premiumAvatarProductId,
  REPORT_REASONS,
  SEVERE_REPORT_REASONS,
  LIMITS,
  HONOR_TIERS,
  VAULT_TIERS,
  FORBIDDEN_MESSAGES,
  cleanLine,
  cleanMultiline,
  textLength,
  forbiddenReason,
  contractTextReason,
  normalizeNgWords,
  containsNgWord,
  normalizeWantWords,
  normalizeCaps,
  capsAreLowerOrEqual,
  normalizeManagerCard,
  normalizeTodayWord,
  normalizeRankingWord,
  normalizeCheer,
  boardSexualWord,
  BOARD_SEXUAL_MESSAGE,
  normalizeSeals,
  sealFor,
  SEAL_WORD_PREFIX,
  normalizeSealWord,
  isSealWord,
  sealText,
  storedSeal,
  ownWordUsable,
  normalizeOwnWords,
  normalizeWordOffering,
  reciteKey,
  normalizeXProfile,
  X_HANDLE_PATTERN,
  normalizeWalletName,
  normalizeNickname,
  normalizeApplication,
  normalizePurpose,
  visiblePurpose,
  rewardsFor,
  normalizeReward,
  storedRewardText,
  normalizeMessage,
  tributeFee,
  honorTierFor,
  honorAchievementIds,
  vaultTierFor,
  vaultTierInfo,
  vaultQualification,
  jstDateKey,
  jstMonthKey,
  nextJstDateKey,
  effectiveCaps,
  todayUsed,
  tributeAllowance,
  capViolation,
  capsNeedGoogle,
  pairId,
};
