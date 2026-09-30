export const MAX_FINISH_REPLY_LENGTH = 40;
export const MAX_FINISH_REPLY_INPUT_UNITS = MAX_FINISH_REPLY_LENGTH * 2;
export const CUSTOM_FINISH_REPLY_VALUE = "__custom_finish_reply__";
export const FINISH_REPLY_DISABLED_VALUE = "__finish_reply_disabled__";

// 通常型1on1の口調セットは、戦略型と同じ6つの女の子なりきりキャラ型に揃える。
// 各セットは追撃・決着・返礼に加え、カードのひとことの定型と採点リアクションを持つ。
export const ROLEPLAY_VOICE_SETS = Object.freeze([
  Object.freeze({
    id: "tsuyotsuyo",
    label: "つよつよ",
    description: "上から目線で勝ち気。強がりが似合う",
    pursuitLine: "今の、効いたでしょ？ まだまだ貼るからね♡",
    finishLine: "はい、わたしの勝ち♡ ざんねんでした",
    replyLine: "…今日は負けてあげる。次は覚えてなさいよ♡",
    cardLine: "これ、耐えられる？♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点。まだ全然平気なんだけど？♡", "ふーん、{score}点かな"]),
      mid: Object.freeze(["{score}点…べ、別に効いてないし♡", "…{score}点。ちょっとだけね"]),
      high: Object.freeze(["っ…{score}点。ずるい…♡", "{score}点…今のはやばかった…♡"]),
    }),
  }),
  Object.freeze({
    id: "yowayowa",
    label: "よわよわ",
    description: "押しに弱くて、すぐ照れる",
    pursuitLine: "えへへ…刺さった？ もう一枚、いくね…♡",
    finishLine: "か、勝っちゃった…♡ ありがとう…！",
    replyLine: "まいりました…♡ よわよわでごめんね",
    cardLine: "これ、どうかな…？♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点…が、がんばって耐えたもん♡", "ま、まだ{score}点だよ…？"]),
      mid: Object.freeze(["{score}点…ちょっと、きいちゃった…♡", "ぅ…{score}点。ずるいよぉ"]),
      high: Object.freeze(["{score}点…もうむり…♡", "ひぅ…{score}点…♡"]),
    }),
  }),
  Object.freeze({
    id: "koakuma",
    label: "小悪魔",
    description: "からかい上手で、余裕のふり",
    pursuitLine: "ふふ、今の顔見えちゃった♡ 次もいくよ？",
    finishLine: "はい、落ちた♡ わたしの勝ち",
    replyLine: "…今日だけ負けにしてあげる♡",
    cardLine: "ねぇ、これ好きでしょ？♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点♡ その程度でどきどきすると思った？", "{score}点かな〜♡ もっと本気出して？"]),
      mid: Object.freeze(["{score}点♡ …悪くないかも", "ふふ、{score}点♡ ずるい手使うじゃん"]),
      high: Object.freeze(["{score}点…♡ …やだ、ほんとに効いた", "{score}点♡ …もう、覚えてなさいよ"]),
    }),
  }),
  Object.freeze({
    id: "oneesan",
    label: "お姉さん",
    description: "余裕たっぷりで、甘やかし上手",
    pursuitLine: "あら、効いちゃった？ 次はもっと甘やかしてあげる♡",
    finishLine: "おしまい♡ よくがんばりました",
    replyLine: "参りました♡ …本気で落とされちゃった",
    cardLine: "お姉さんのとっておき、見て？♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点ね♡ まだまだ余裕よ", "ふふ、{score}点♡ かわいい攻め方ね"]),
      mid: Object.freeze(["{score}点…♡ 少しどきっとしたわ", "あら、{score}点♡ やるじゃない"]),
      high: Object.freeze(["{score}点…♡ …本気にさせるなんて", "{score}点♡ …もう、ずるい子"]),
    }),
  }),
  Object.freeze({
    id: "amaenbo",
    label: "甘えんぼ",
    description: "ハート多めで、甘えたがり",
    pursuitLine: "えへへ、刺さった？ もっとちょうだい♡",
    finishLine: "勝った〜♡ ぎゅってしていい？",
    replyLine: "まけちゃった〜♡ でも楽しかった！",
    cardLine: "これ、いっしょに見よ？♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点〜♡ もっとちょうだい？", "{score}点だよ♡ まだ足りないの〜"]),
      mid: Object.freeze(["{score}点♡ …うれしくなっちゃった", "{score}点〜♡ それ好きかも…"]),
      high: Object.freeze(["{score}点♡♡ だいすき…", "{score}点…♡ もうとろけちゃう"]),
    }),
  }),
  Object.freeze({
    id: "seiso",
    label: "清楚",
    description: "丁寧な言葉づかいで、崩れる瞬間が見せ場",
    pursuitLine: "失礼いたします…もう一枚、お見せしますね♡",
    finishLine: "ごめんあそばせ。わたくしの勝ちです♡",
    replyLine: "参りました♡ …取り繕えませんでした",
    cardLine: "お気に召すでしょうか…♡",
    reactions: Object.freeze({
      low: Object.freeze(["{score}点です。まだ大丈夫ですよ♡", "{score}点でした。お上品ではありませんね"]),
      mid: Object.freeze(["{score}点です…心が揺れました♡", "…{score}点。いけない気持ちになりそうです"]),
      high: Object.freeze(["{score}点です…♡ いけません、こんな…", "{score}点…♡ もう、取り繕えません…"]),
    }),
  }),
]);

// 旧口調セット（王道主人公〜推し活）と旧定型文。選択肢からは外すが、
// 旧画面を開いたままの相手から届いた時に自由記述と誤判定しないよう、定型として扱う。
export const RETIRED_PURSUIT_LINES = Object.freeze([
  "その反応、見逃さない。もう一枚いく！",
  "その程度じゃ終われない。次が本命だ！",
  "好機は逃さない。次の一枚を！",
  "まだ足掻くか。ならば次だ！",
  "……次で仕留める",
  "まだだ、次のページをめくれ！",
  "刺さったね？ 推しの追撃だ！",
  "好みは読めた。ここからが本命だ！",
  "刺さったね？ 追撃開始！",
  "まだ終わらない。次の一枚をどうぞ！",
]);

export const RETIRED_FINISH_LINES = Object.freeze([
  "これで決着だ！",
  "この瞬間を待っていた！",
  "我が一撃、受けてもらう！",
  "ここで物語は終わりだ！",
  "……終わりだ",
  "勝った！第三部完！",
  "推しの輝きにひれ伏せ！",
  "この一枚で、勝負を決める。",
  "最後の一撃、受け取って！",
  "推しの力、見届けたか！",
  "いい勝負だった。またやろう。",
]);

export const RETIRED_FINISH_REPLY_LINES = Object.freeze([
  "見事だ。今回は君の勝ちだ！",
  "この借りは、次の勝負で返す！",
  "参りました。見事なお手前です",
  "よかろう。今日の勝利は譲ってやる",
  "……完敗だ",
  "やられたー！次回へ続く！",
  "その推し、確かに強かった……！",
]);

export const FINISH_REPLY_LINES = Object.freeze(
  ROLEPLAY_VOICE_SETS.map(({ replyLine }) => replyLine),
);

export const FINISH_REPLY_TEMPLATE_LINES = Object.freeze([
  ...FINISH_REPLY_LINES,
  ...RETIRED_FINISH_REPLY_LINES,
]);

export const MAX_CARD_CAPTION_LENGTH = 30;

export const CARD_CAPTION_TEMPLATES = Object.freeze(Array.from(new Set([
  ...ROLEPLAY_VOICE_SETS.map(({ cardLine }) => cardLine),
  "今日の本命、どうぞ♡",
  "これ、刺さる？",
  "とっておきだよ♡",
  "まずは小手調べ♡",
])));

export function normalizeCardCaption(value) {
  return Array.from(String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, MAX_CARD_CAPTION_LENGTH)
    .join("")
    .trim();
}

// 相手のひとことを表示する時の判定。自由記述を隠す設定なら、送信者の口調セットの定型へ置き換える。
export function resolveVisibleCardCaption(value, {
  showCustom = true,
  voiceSetId = "",
} = {}) {
  const caption = typeof value === "string" ? normalizeCardCaption(value) : "";
  if (!caption) return { caption: "", custom: false, replaced: false };
  const custom = !CARD_CAPTION_TEMPLATES.includes(caption);
  const replaced = custom && !showCustom;
  const fallback = getRoleplayVoiceSet(voiceSetId)?.cardLine || CARD_CAPTION_TEMPLATES[0];
  return { caption: replaced ? fallback : caption, custom, replaced };
}

export const SCORE_REACTION_BANDS = Object.freeze(["low", "mid", "high"]);

export function scoreReactionBand(score) {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 10) return "";
  if (value >= 9) return "high";
  if (value >= 7) return "mid";
  return "low";
}

export function scoreReactionOptions(voiceSetId, score) {
  const voiceSet = getRoleplayVoiceSet(voiceSetId) || ROLEPLAY_VOICE_SETS[0];
  const band = scoreReactionBand(score);
  if (!band) return [];
  return voiceSet.reactions[band].map((line, index) => ({
    band,
    index,
    text: line.replaceAll("{score}", String(score)),
  }));
}

// 受け取ったリアクションを、実際に確定した点数と照合してから文面へ戻す。
export function resolveScoreReaction({ voiceSetId, band, index, score } = {}) {
  const voiceSet = getRoleplayVoiceSet(voiceSetId);
  const expectedBand = scoreReactionBand(score);
  if (!voiceSet || !expectedBand || band !== expectedBand || !Number.isInteger(index)) return "";
  const line = voiceSet.reactions[band][index];
  return line ? line.replaceAll("{score}", String(score)) : "";
}

export function getRoleplayVoiceSet(value) {
  const id = String(value || "");
  return ROLEPLAY_VOICE_SETS.find((voiceSet) => voiceSet.id === id) || null;
}

export function normalizeRoleplayVoiceSetId(value) {
  return getRoleplayVoiceSet(value)?.id || "";
}

export function countFinishReplyCharacters(value) {
  return Array.from(String(value || "")).length;
}

export function sanitizeFinishReplyDraft(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n");
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const secondLine = remainingLines.join(" ");
  return Array.from(`${firstLine}${remainingLines.length ? `\n${secondLine}` : ""}`)
    .slice(0, MAX_FINISH_REPLY_LENGTH)
    .join("");
}

export function normalizeFinishReplyLine(value, fallback = FINISH_REPLY_LINES[0]) {
  const normalized = sanitizeFinishReplyDraft(value)
    .split("\n")
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
  return normalized || fallback;
}

export function normalizeReceivedFinishReplyLine(value) {
  if (typeof value !== "string") return FINISH_REPLY_LINES[0];
  return normalizeFinishReplyLine(value, "");
}

export function inferRoleplayVoiceSetId({
  pursuitLine,
  finishLine,
  replyLine,
} = {}) {
  return ROLEPLAY_VOICE_SETS.find((voiceSet) => (
    voiceSet.pursuitLine === pursuitLine
      && voiceSet.finishLine === finishLine
      && voiceSet.replyLine === replyLine
  ))?.id || "";
}

export function resolveVisibleFinishReplyLine(value, {
  showCustom = true,
  voiceSetId = "",
} = {}) {
  const line = normalizeReceivedFinishReplyLine(value);
  if (!line) return { line: "", custom: false, replaced: false };
  const custom = !FINISH_REPLY_TEMPLATE_LINES.includes(line);
  const fallback = getRoleplayVoiceSet(voiceSetId)?.replyLine || FINISH_REPLY_LINES[0];
  const replaced = custom && !showCustom;
  return {
    line: replaced ? fallback : line,
    custom,
    replaced,
  };
}
