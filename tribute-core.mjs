// お貢ぎ界隈のクライアント側の規則。サーバーの tribute-rules.js と同じ判定を画面の前で行い、
// 送れない文や上限を超える金額を、送信前に知らせるために使う。最終判定は常にサーバー。

export const TRIBUTE_AGE_VERSION = "tribute-age-v1";

export const DEFINITION = "お貢ぎは、会わない前提で、金や残高の支配を権力交換の中心に置く遊びである。送金は敗北の確定であり、本体は管理が続くことである。ネカマ貢がせは、男性であることを隠さず同じ構造を行う確立したジャンルで、分かって渡すことが条件である。貼り合いとは隣り合うが別ゲームである。";

export const PREMISES = Object.freeze([
  "会わない前提の遊びです。現実のお金・PayPay・現金化・外部送金はありません。使うのは、アプリ内で稼いだ換金できない AnjuPay だけです。",
  "上限（1回・1日・契約合計）と解約は、預ける側がいつでも握っています。管理する側は触れられません。",
  "連絡先・SNSのID・外部決済・会う約束・住所や本名は、送ろうとしても送れません。",
  "辛口の侮蔑表現を含みます。言葉の強さ（甘め・普通・辛口）と「言われたくない言葉」は預ける側が決めます。",
]);

export const PER_TRIBUTE_OPTIONS = Object.freeze([10, 30, 50, 100, 300, 500, 1_000]);
export const PER_DAY_OPTIONS = Object.freeze([30, 100, 300, 500, 1_000, 3_000, 5_000]);
export const TOTAL_OPTIONS = Object.freeze([100, 300, 1_000, 3_000, 5_000, 10_000, 30_000]);
export const DURATION_DAYS_OPTIONS = Object.freeze([1, 3, 7]);
export const ENTRY_FEE_OPTIONS = Object.freeze([0, 5, 10, 30, 50, 100]);

export const LIMITS = Object.freeze({
  personaName: 16,
  intro: 60,
  walletName: 16,
  ngWordCount: 5,
  ngWordLength: 12,
  message: 240,
  requestNote: 60,
  pendingRequests: 3,
  payerOpenContracts: 3,
  feeRateBasisPoints: 500,
  minimumFee: 1,
});

export const TONE_LABELS = Object.freeze({ sweet: "甘め", normal: "普通", harsh: "辛口" });
export const DISCLOSURE_LABELS = Object.freeze({
  nekama: "ネカマ（中身は男）",
  as_is: "演じていない",
  undisclosed: "非開示",
});
export const DISCLOSURE_SHORT = Object.freeze({ nekama: "ネカマ", as_is: "素", undisclosed: "非開示" });
export const STYLE_LABELS = Object.freeze({ harsh: "罵倒", cold: "事務的", sweet: "甘やかし" });
export const SIGIL_COLORS = Object.freeze(["#ff4fa3", "#b48cff", "#5fd4ff", "#ffd166", "#7ee08a", "#ff7a59"]);
export const KIND_LABELS = Object.freeze({
  entry: "入場料",
  request: "請求に応えて",
  silent: "無言の献上",
  escrow_take: "管理口座から徴収",
});
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
  exit_obstruction: "解約や上限の引き下げを妨げられた",
  threat: "脅迫・差別・晒しの脅し",
  other: "その他",
});
export const POLICY_LABELS = Object.freeze({
  both: "両方（初めての関係と続く管理）",
  first: "初めての関係",
  renewal: "続く管理",
});

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

export const FORBIDDEN_MESSAGES = Object.freeze({
  url: "URLやドメインは送れません。",
  email: "メールアドレスは送れません。",
  phone: "電話番号のような数字の並びは送れません。",
  contact_app: "外部の連絡先やSNSへ誘う言葉は送れません。",
  handle: "SNSのIDのような文字は送れません。",
  external_payment: "外部の決済・現金・ギフト券に関わる言葉は送れません。",
  real_money: "現実のお金の金額は送れません。使えるのはAnjuPayだけです。",
  meeting: "会う約束に関わる言葉は送れません。この界隈は会わない前提です。",
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
  if (!caps) return "契約の上限を確認できませんでした。";
  if (value > caps.perTribute) return `1回の上限（${caps.perTribute} Pay）を超えています。`;
  if (todayUsed(contract, timestamp) + value > caps.perDay) return `今日の上限（${caps.perDay} Pay）を超えています。`;
  if ((Number(contract?.totalTributed) || 0) + value > caps.total) return `契約の合計上限（${caps.total} Pay）を超えています。`;
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

function cardSnapshot(card) {
  const source = object(card);
  return {
    personaName: String(source.personaName || "管理人").slice(0, 32),
    disclosure: String(source.disclosure || "undisclosed"),
    style: String(source.style || "cold"),
    sigil: integer(source.sigil, 0, 5),
  };
}

// サーバーの viewContract と同じ形に、Firestore から直接読んだ契約を整える。
export function viewContract(contract, uid, now = Date.now()) {
  const raw = object(contract);
  const role = raw.managerUid === uid ? "manager" : "payer";
  const status = String(raw.status || "ended");
  const { caps } = effectiveCaps(raw, now);
  const pending = normalizeCaps(raw.pendingCaps);
  const pendingKey = String(raw.pendingCapsEffectiveDateKey || "");
  const pendingStillScheduled = Boolean(pending && pendingKey && jstDateKey(now) < pendingKey);
  const eventSeq = integer(raw.eventSeq);
  const readSeq = integer(object(raw.readSeq)[role]);
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
    caps,
    pendingCaps: pendingStillScheduled ? pending : null,
    pendingCapsEffectiveDateKey: pendingStillScheduled ? pendingKey : "",
    durationDays: integer(raw.durationDays, 1, 7),
    tone: String(raw.tone || "normal"),
    ngWords: Array.isArray(raw.ngWords) ? raw.ngWords.slice(0, LIMITS.ngWordCount).map(String) : [],
    allowReportRequests: raw.allowReportRequests === true,
    rankOptIn: raw.rankOptIn === true,
    entryFee: integer(raw.entryFee, 0, 1_000),
    renewal: raw.renewal === true,
    createdAt: integer(raw.createdAt),
    acceptedAt: integer(raw.acceptedAt),
    expiresAt: integer(raw.expiresAt),
    endedAt: integer(raw.endedAt),
    updatedAt: integer(raw.updatedAt),
    totalTributed,
    tributeCount: integer(raw.tributeCount),
    todayTributed: todayUsed(raw, now),
    allowance: status === "active" ? tributeAllowance(raw, caps, now) : 0,
    escrowBalance,
    escrowRoom: caps ? Math.max(0, caps.total - totalTributed - escrowBalance) : 0,
    escrowWithdrawRequest: withdraw && withdraw.amount > 0 ? withdraw : null,
    pendingRequests: Object.entries(object(raw.pendingRequests))
      .map(([requestId, entry]) => ({
        requestId,
        amount: integer(entry?.amount),
        note: String(entry?.note || "").slice(0, LIMITS.requestNote),
        createdAt: integer(entry?.createdAt),
      }))
      .filter((entry) => /^[a-f0-9]{16}$/.test(entry.requestId) && entry.amount > 0)
      .sort((left, right) => left.createdAt - right.createdAt),
    reportRequested: integer(raw.reportRequestedAt) > 0,
    eventSeq,
    unread: Math.max(0, eventSeq - readSeq),
  };
}

// 定型文。言葉の強さ（預ける側が契約で選ぶ）ごとに用意する。辛口は徹底して辛く、ただし
// 自傷・死・暴力・差別・晒しの語、上限を上げさせる文、解約をためらわせる文は入れない。
// 上限を下げた時・終わった時の反応は、責めない。
export const MANAGER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "nudge", label: "催促" }),
  Object.freeze({ id: "after", label: "受け取った後" }),
  Object.freeze({ id: "ignore", label: "突き放す" }),
  Object.freeze({ id: "report", label: "報告させる" }),
  Object.freeze({ id: "nekama", label: "ネカマとして" }),
  Object.freeze({ id: "caps_lowered", label: "上限が下がった時" }),
  Object.freeze({ id: "ended", label: "終わる時" }),
]);
export const PAYER_SITUATIONS = Object.freeze([
  Object.freeze({ id: "give", label: "差し出す" }),
  Object.freeze({ id: "reply", label: "返事" }),
  Object.freeze({ id: "safety", label: "止める・下げる" }),
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
      ]),
      after: Object.freeze([
        "それっぽっち？まあ受け取ってやる。",
        "受け取ってやった。ありがたく思え。",
        "やっと出した。財布として最低限の仕事はしたね。",
        "レシート眺めてニヤつくな、気持ち悪い。",
        "貢ぐしか能がないの、ほんと惨め。",
        "差し出す時の顔、想像しただけで笑える。",
      ]),
      ignore: Object.freeze(["……。", "既読。", "で？", "興味ない。"]),
      report: Object.freeze([
        "残高、報告。今すぐ。",
        "財布の中身、隠さず見せろ。",
        "管理されてる自覚あるなら、報告くらい自分から出せ。",
      ]),
      nekama: Object.freeze([
        "中身が男だって知ってて貢ぐんだ。救いようがないね。",
        "ネカマに財布握られて満足？終わってる。",
        "おっさんに貢いでる自覚、ちゃんと持って差し出せ。",
        "男だって分かってて尻尾振る財布、最高に情けない。",
      ]),
      caps_lowered: Object.freeze([
        "了解。その枠で管理する。",
        "上限は財布が決めること。続けるなら、その枠で。",
      ]),
      ended: Object.freeze([
        "おつかれ。財布、閉じていいよ。",
        "契約終了。好きにしな。",
      ]),
    }),
    normal: Object.freeze({
      nudge: Object.freeze([
        "今日の分、待ってる。",
        "そろそろ顔出して。",
        "ちゃんと持ってきてね。",
        "財布の管理は私の仕事。",
      ]),
      after: Object.freeze([
        "受け取った。よくできました。",
        "確認した。次も遅れないで。",
        "うん、それでいい。",
      ]),
      ignore: Object.freeze(["……。", "既読。"]),
      report: Object.freeze(["残高、見せて。", "今の財布、報告して。"]),
      nekama: Object.freeze([
        "男に貢いでるって分かってるよね。よろしい。",
        "中身が男でも差し出せるなら、合格。",
      ]),
      caps_lowered: Object.freeze(["了解。その枠でいこう。", "決めてくれてありがとう。その範囲で管理する。"]),
      ended: Object.freeze(["おつかれさま。ここまでありがとう。", "契約終了。ちゃんと休んでね。"]),
    }),
    sweet: Object.freeze({
      nudge: Object.freeze([
        "待ってたよ。今日も来てくれる？",
        "無理のない範囲でね。",
        "顔見せてくれたら、それでうれしいよ。",
      ]),
      after: Object.freeze([
        "えらいね、ちゃんと持ってきたんだ。",
        "ありがと。大事にするね。",
        "今日もいい子。",
      ]),
      ignore: Object.freeze(["……ふふ。", "今はちょっと放置。"]),
      report: Object.freeze(["今の財布、ちょっと見せて？"]),
      nekama: Object.freeze([
        "中身が男でも来てくれるんだ。かわいいね。",
        "おっさんだって知ってるのに律儀だね。",
      ]),
      caps_lowered: Object.freeze(["了解。決めてくれてありがとう。", "その枠でも、ちゃんと見てるよ。"]),
      ended: Object.freeze(["おつかれさま。また気が向いたらね。", "ここまでありがとう。ゆっくり休んで。"]),
    }),
  }),
  payer: Object.freeze({
    harsh: Object.freeze({
      give: Object.freeze(["差し出します。", "今日の分です。受け取ってください。", "遅れてすみません。"]),
      reply: Object.freeze(["はい。", "財布として使ってください。", "もっと罵ってください。", "ありがとうございます。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
    normal: Object.freeze({
      give: Object.freeze(["今日の分です。", "差し出します。"]),
      reply: Object.freeze(["はい。", "ありがとうございます。", "報告します。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
    sweet: Object.freeze({
      give: Object.freeze(["今日の分、どうぞ。", "受け取ってくれたらうれしい。"]),
      reply: Object.freeze(["ありがとう。", "今日もお願いします。", "うれしい。"]),
      safety: Object.freeze(["今日はここまで。", "その言い方はやめて。", "上限を下げます。"]),
    }),
  }),
});

export function templatesFor(role, tone, { disclosure = "undisclosed", ngWords = [] } = {}) {
  const roleSet = TEMPLATES[role === "manager" ? "manager" : "payer"];
  const toneSet = roleSet[tone] || roleSet.normal;
  const situations = role === "manager" ? MANAGER_SITUATIONS : PAYER_SITUATIONS;
  return situations
    .filter((situation) => situation.id !== "nekama" || disclosure === "nekama")
    .map((situation) => ({
      ...situation,
      lines: (toneSet[situation.id] || []).filter((line) => !messageProblem(line, { role, ngWords })),
    }))
    .filter((situation) => situation.lines.length);
}

export function formatPay(value) {
  return `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ja-JP")} Pay`;
}

export function remainingLabel(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Number(expiresAt || 0) - now);
  if (!remaining) return "期限切れ";
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 24) return `残り${Math.floor(hours / 24)}日${hours % 24}時間`;
  if (hours >= 1) return `残り${hours}時間`;
  return `残り${Math.max(1, Math.ceil(remaining / 60_000))}分`;
}
