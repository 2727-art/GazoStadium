export const MAX_FINISH_REPLY_LENGTH = 40;
export const CUSTOM_FINISH_REPLY_VALUE = "__custom_finish_reply__";
export const FINISH_REPLY_DISABLED_VALUE = "__finish_reply_disabled__";

export const ROLEPLAY_VOICE_SETS = Object.freeze([
  Object.freeze({
    id: "standard",
    label: "王道主人公",
    description: "まっすぐ勝負し、相手の健闘も称える口調",
    pursuitLine: "その反応、見逃さない。もう一枚いく！",
    finishLine: "これで決着だ！",
    replyLine: "見事だ。今回は君の勝ちだ！",
  }),
  Object.freeze({
    id: "rival",
    label: "好敵手",
    description: "互いを認め、次の勝負へ火を残す口調",
    pursuitLine: "その程度じゃ終われない。次が本命だ！",
    finishLine: "この瞬間を待っていた！",
    replyLine: "この借りは、次の勝負で返す！",
  }),
  Object.freeze({
    id: "knight",
    label: "騎士・武人",
    description: "礼節をもって一撃と敗北を受け止める口調",
    pursuitLine: "好機は逃さない。次の一枚を！",
    finishLine: "我が一撃、受けてもらう！",
    replyLine: "参りました。見事なお手前です",
  }),
  Object.freeze({
    id: "villain",
    label: "魔王・悪役",
    description: "尊大さを崩さず物語を盛り上げる口調",
    pursuitLine: "まだ足掻くか。ならば次だ！",
    finishLine: "ここで物語は終わりだ！",
    replyLine: "よかろう。今日の勝利は譲ってやる",
  }),
  Object.freeze({
    id: "cool",
    label: "無口・クール",
    description: "短い言葉で静かに決着を演じる口調",
    pursuitLine: "……次で仕留める",
    finishLine: "……終わりだ",
    replyLine: "……完敗だ",
  }),
  Object.freeze({
    id: "comic",
    label: "コミカル",
    description: "負けても物語を明るく締める口調",
    pursuitLine: "まだだ、次のページをめくれ！",
    finishLine: "勝った！第三部完！",
    replyLine: "やられたー！次回へ続く！",
  }),
  Object.freeze({
    id: "oshi",
    label: "推し活",
    description: "推しの力を称え合う張り合いスタジアムらしい口調",
    pursuitLine: "刺さったね？ 推しの追撃だ！",
    finishLine: "推しの輝きにひれ伏せ！",
    replyLine: "その推し、確かに強かった……！",
  }),
]);

export const FINISH_REPLY_LINES = Object.freeze(
  ROLEPLAY_VOICE_SETS.map(({ replyLine }) => replyLine),
);

export function getRoleplayVoiceSet(value) {
  const id = String(value || "");
  return ROLEPLAY_VOICE_SETS.find((voiceSet) => voiceSet.id === id) || null;
}

export function normalizeRoleplayVoiceSetId(value) {
  return getRoleplayVoiceSet(value)?.id || "";
}

export function sanitizeFinishReplyDraft(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n");
  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  const secondLine = remainingLines.join(" ");
  return `${firstLine}${remainingLines.length ? `\n${secondLine}` : ""}`
    .slice(0, MAX_FINISH_REPLY_LENGTH);
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
  if (!line) return { line: "", custom: false };
  const custom = !FINISH_REPLY_LINES.includes(line);
  const fallback = getRoleplayVoiceSet(voiceSetId)?.replyLine || FINISH_REPLY_LINES[0];
  return {
    line: custom && !showCustom ? fallback : line,
    custom,
  };
}
