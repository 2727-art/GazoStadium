// 戦略型1on1のDMスレッド：何をどの順に積むかを決める。
// DOM・Firebase・P2Pには触れない。画面の描画は strategy.js が受け持つ。

// 対戦中に手元へ残すチャットの数。これより古い発言はスレッドから外す。
export const STRATEGY_THREAD_CHAT_LIMIT = 200;

// 1手の中の出来事の順番。看破は 宣言 → 答え合わせ → 仕留め。
const SLOT_KINDS = Object.freeze(["post", "score", "right", "answer", "break", "breakResult", "finish", "pass", "surrender"]);
const SINGLE_KINDS = Object.freeze(["start", "outcome"]);
const ID_KINDS = Object.freeze(["chat", "video", "voice"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function strategyThreadKey(kind, value) {
  return SINGLE_KINDS.includes(kind) ? kind : `${kind}:${value}`;
}

export function parseStrategyThreadKey(key) {
  const text = String(key || "");
  if (SINGLE_KINDS.includes(text)) return { kind: text };
  const split = text.indexOf(":");
  if (split <= 0) return null;
  const kind = text.slice(0, split);
  const value = text.slice(split + 1);
  if (ID_KINDS.includes(kind)) return ID_PATTERN.test(value) ? { kind, id: value } : null;
  if (!SLOT_KINDS.includes(kind)) return null;
  const slot = Number(value);
  return Number.isInteger(slot) && slot >= 1 ? { kind, slot } : null;
}

// 再生結果の1手から、もう起きた出来事を順に並べる。
export function slotEventKeys(slot) {
  const number = Number(slot?.slot);
  if (!Number.isInteger(number) || number < 1) return [];
  const key = (kind) => strategyThreadKey(kind, number);
  if (slot.kind === "post") {
    return [
      key("post"),
      ...(Number.isInteger(slot.score) ? [key("score")] : []),
      ...(slot.right ? [key("right")] : []),
      ...(slot.answer ? [key("answer")] : []),
    ];
  }
  if (slot.kind === "break") {
    return [
      key("break"),
      ...(slot.breakResult ? [key("breakResult")] : []),
      ...(Number.isInteger(slot.finishCount) ? [key("finish")] : []),
    ];
  }
  if (slot.kind === "pass" || slot.kind === "surrender") return [key(slot.kind)];
  return [];
}

/*
  状態から分かる出来事を、一度に見つかった時の順番で並べる。
  匿名のころの会話 → 正体判明と先攻 → 手の出来事（手の番号順）→ 対戦中のチャット・映像・ボイス（届いた順）→ 決着。
  すでに記録した出来事の順番は appendStrategyThreadEntries が変えない。
*/
export function collectStrategyThreadKeys({ slots = [], chats = [], videoIds = [], voiceIds = [], outcome = false } = {}) {
  const valid = (id) => ID_PATTERN.test(String(id || ""));
  const keys = chats
    .filter((chat) => chat?.phase === "scout" && valid(chat.id))
    .map((chat) => strategyThreadKey("chat", chat.id));
  keys.push(strategyThreadKey("start"));
  [...slots]
    .sort((first, second) => Number(first?.slot) - Number(second?.slot))
    .forEach((slot) => keys.push(...slotEventKeys(slot)));
  chats
    .filter((chat) => chat?.phase === "battle" && valid(chat.id))
    .forEach((chat) => keys.push(strategyThreadKey("chat", chat.id)));
  videoIds.filter(valid).forEach((id) => keys.push(strategyThreadKey("video", id)));
  voiceIds.filter(valid).forEach((id) => keys.push(strategyThreadKey("voice", id)));
  if (outcome) keys.push(strategyThreadKey("outcome"));
  return keys;
}

// 記録にない出来事だけを末尾へ足す。並び順は最初に記録された時の連番で固定する。
export function appendStrategyThreadEntries(log, keys) {
  const entries = Array.isArray(log) ? log : [];
  const known = new Set(entries.map((entry) => entry.key));
  let seq = entries.reduce((max, entry) => Math.max(max, Number(entry.seq) || 0), 0);
  const added = [];
  (Array.isArray(keys) ? keys : []).forEach((key) => {
    if (known.has(key) || !parseStrategyThreadKey(key)) return;
    known.add(key);
    seq += 1;
    added.push(Object.freeze({ key, seq }));
  });
  return added.length ? [...entries, ...added] : entries;
}

// 描画に使う並び。チャット・映像・ボイスは、今も手元に残っているものだけにする。
export function orderedStrategyThreadEntries(log, { chatIds = [], videoIds = [], voiceIds = [] } = {}) {
  const chats = new Set(chatIds);
  const videos = new Set(videoIds);
  const voices = new Set(voiceIds);
  return (Array.isArray(log) ? log : [])
    .map((entry) => ({ ...parseStrategyThreadKey(entry.key), key: entry.key, seq: entry.seq }))
    .filter((entry) => {
      if (!entry.kind) return false;
      if (entry.kind === "chat") return chats.has(entry.id);
      if (entry.kind === "video") return videos.has(entry.id);
      if (entry.kind === "voice") return voices.has(entry.id);
      return true;
    })
    .sort((first, second) => first.seq - second.seq);
}

/* ---------- 対応機能と既読（P2P の合図。Firebase には書かない） ---------- */

// 対戦中に1人が送れる映像とボイスの本数。品評会の映像は今までどおり1本。
export const STRATEGY_BATTLE_VIDEO_LIMIT = 3;
export const STRATEGY_BATTLE_VOICE_LIMIT = 5;
export const STRATEGY_RECEIPT_KEY_LIMIT = 20;

// 知らせが届くまで・古い画面の相手は、ボイスなし・映像1本・既読なしとして扱う。
export const LEGACY_STRATEGY_FEATURES = Object.freeze({ voice: 0, battleVideos: 1, receipts: false });

export function strategyFeaturesMessage() {
  return { type: "strategy-features", voice: STRATEGY_BATTLE_VOICE_LIMIT, battleVideos: STRATEGY_BATTLE_VIDEO_LIMIT, receipts: true };
}

// 相手が知らせてきた対応機能。自分の上限で切り、壊れた値は古い画面と同じ扱いにする。
export function normalizeStrategyFeatures(message) {
  const count = (value, max, fallback) => (Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback);
  return {
    voice: count(message?.voice, STRATEGY_BATTLE_VOICE_LIMIT, 0),
    battleVideos: Math.max(1, count(message?.battleVideos, STRATEGY_BATTLE_VIDEO_LIMIT, 1)),
    receipts: message?.receipts === true,
  };
}

// 既読は自分のチャット（c:）と手（post:）、再生済みは自分の映像（video:）とボイス（voice:）。
const SEEN_KEY = /^(?:c:[A-Za-z0-9_-]{1,80}|post:(?:[1-9]|[12][0-9]|30))$/;
const PLAYED_KEY = /^(?:video|voice):[A-Za-z0-9_-]{8,80}$/;

export function strategyReceiptMessage(kind, keys) {
  return { type: "strategy-receipt", kind, keys: [...new Set(keys)].slice(0, STRATEGY_RECEIPT_KEY_LIMIT) };
}

// 届いた既読・再生済み。形の正しい鍵だけを、重複なく上限まで。何も残らなければ null。
export function normalizeStrategyReceipt(message) {
  const pattern = message?.kind === "seen" ? SEEN_KEY : message?.kind === "played" ? PLAYED_KEY : null;
  if (!pattern || !Array.isArray(message.keys)) return null;
  const keys = [...new Set(message.keys.filter((key) => typeof key === "string" && pattern.test(key)))].slice(0, STRATEGY_RECEIPT_KEY_LIMIT);
  return keys.length ? { kind: message.kind, keys } : null;
}

// 吹き出しの中身が変わっていなければ、前の要素（画像・動画）を使い回すための短い指紋。
export function strategyThreadSignature(html) {
  const text = String(html ?? "");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${text.length.toString(36)}.${(hash >>> 0).toString(36)}`;
}
