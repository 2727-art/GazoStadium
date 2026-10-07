// 戦略型1on1のなりきりDM：手番に合わせた入力中の一文、匿名中の呼び名、「語尾に♡」の残り回数、リアクションの宛先。
// ほかのモジュールに依存しない（口調IDは chat-persona.mjs・strategy-hariai-core.mjs と同じ6種）。

export const HEART_BADGE_TOTAL = 3;

// 相手の手番で、いま何をしているか。ゲームの進み具合（pending.stage）から決める。
const STAGE_ACTIONS = Object.freeze({
  act: "次の1枚を選んでいます",
  score: "点数を考えています",
  right: "権利の使い方を考えています",
  answer: "返事を打っています",
  finish: "仕留めの1枚を選んでいます",
});

const PERSONA_MOODS = Object.freeze({
  tsuyotsuyo: Object.freeze({ lead: "強気に", tail: "" }),
  yowayowa: Object.freeze({ lead: "もじもじしながら", tail: "" }),
  koakuma: Object.freeze({ lead: "くすくす笑いながら", tail: "♡" }),
  oneesan: Object.freeze({ lead: "余裕たっぷりに", tail: "♡" }),
  amaenbo: Object.freeze({ lead: "甘えた顔で", tail: "♡" }),
  seiso: Object.freeze({ lead: "静かに", tail: "" }),
});

export const STRATEGY_TYPING_STAGES = Object.freeze(Object.keys(STAGE_ACTIONS));

function shortName(name) {
  const text = Array.from(String(name ?? "").replace(/[\r\n\t]+/g, " ").trim()).slice(0, 16).join("");
  return text || "相手";
}

export function strategyTypingText(personaId, name, stage) {
  const action = STAGE_ACTIONS[stage];
  if (!action) return "";
  const mood = PERSONA_MOODS[personaId];
  return mood ? `${shortName(name)}が、${mood.lead}${action}${mood.tail}` : `${shortName(name)}が${action}`;
}

// 匿名の間は名前の代わりに口調で呼ぶ（口調は匿名自己紹介ですでに相手へ見えている）。
export function anonymousPersonaName(personaLabel) {
  return `${String(personaLabel || "").trim() || "なりきり"}さん（匿名）`;
}

/*
  「語尾に♡を付けて」の指示の残り回数。対戦の再生結果（スロット）を順にたどり、
  ♡が付いた吹き出しに「♡1/3」のような番号を振る。指示に応じた時点で数え直す。
  数える順番は strategy-hariai-core.mjs の consumeHeart と同じ（言葉→返事→答え→指示への応答、看破では仕留めの言葉）。
*/
export function hariaiHeartBadges(slots = []) {
  const used = new Map();
  const badges = new Map();
  const take = (uid, key) => {
    const count = (used.get(uid) || 0) + 1;
    used.set(uid, count);
    badges.set(key, `♡${Math.min(count, HEART_BADGE_TOTAL)}/${HEART_BADGE_TOTAL}`);
  };
  for (const slot of slots) {
    if (slot?.kind === "post") {
      if (slot.captionHeart) take(slot.by, `${slot.slot}:caption`);
      if (slot.replyHeart) take(slot.receiver, `${slot.slot}:reply`);
      if (slot.answer?.heart) take(slot.receiver, `${slot.slot}:answer`);
      if (slot.right?.kind === "instruction" && slot.right.id === "heart" && slot.answer?.ack === true) used.set(slot.receiver, 0);
    } else if (slot?.kind === "break") {
      (slot.finishCaptions || []).forEach((caption, index) => {
        if (caption?.heart) take(slot.by, `${slot.slot}:finish:${index}`);
      });
    }
  }
  return badges;
}

/*
  リアクションの宛先。スレッドの吹き出しは「t:手:部分」、自由チャットは「c:メッセージID」。
  スレッドの宛先から、その吹き出しを書いた人のUIDを返す（なければ空）。
*/
const THREAD_KEY = /^t:(\d{1,2}):(caption|reply|right|answer|break)$/;

export function hariaiItemAuthor(slots = [], key = "") {
  const match = THREAD_KEY.exec(String(key));
  if (!match) return "";
  const slot = slots.find((item) => item?.slot === Number(match[1]));
  if (!slot) return "";
  const part = match[2];
  if (slot.kind === "break") return part === "break" ? String(slot.by || "") : "";
  if (slot.kind !== "post") return "";
  if (part === "caption") return String(slot.by || "");
  if (part === "reply") return Number.isInteger(slot.score) ? String(slot.receiver || "") : "";
  if (part === "right") return slot.right && slot.right.kind !== "none" ? String(slot.by || "") : "";
  if (part === "answer") return slot.answer ? String(slot.receiver || "") : "";
  return "";
}

export function isStrategyReactionKey(key) {
  const value = String(key ?? "");
  return value.length <= 72 && (THREAD_KEY.test(value) || /^c:[A-Za-z0-9_-]{1,64}$/.test(value));
}
