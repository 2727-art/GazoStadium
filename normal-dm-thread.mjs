// 通常型1on1のDMスレッド：何をどの順に積むかと、試合結果に出す「効いた」ものを決める。
// DOM・Firebase・P2Pには触れない。画面の描画は online.js が受け持つ。

// 自分の1枚をロックした後の段階。ここに入ったラウンドは「貼った」としてスレッドに積む。
export const DM_POSTED_SCREENS = Object.freeze([
  "waitingPick",
  "waitingImage",
  "reveal",
  "score",
  "waitingScore",
  "result",
  "waitingContinue",
  "gameover",
]);

// 両者の受信がそろった後の段階。相手の画像はここから見せる。
export const DM_REVEALED_SCREENS = Object.freeze([
  "reveal",
  "score",
  "waitingScore",
  "result",
  "waitingContinue",
  "gameover",
]);

export function threadEntryKey(kind, value) {
  return `${kind}:${value}`;
}

export function parseThreadEntryKey(key) {
  const text = String(key || "");
  const split = text.indexOf(":");
  if (split <= 0) return null;
  const kind = text.slice(0, split);
  const value = text.slice(split + 1);
  if (kind === "chat") return value ? { kind, chatId: value } : null;
  if (!["local", "remote", "scores"].includes(kind)) return null;
  const round = Number(value);
  return Number.isInteger(round) && round >= 1 ? { kind, round } : null;
}

// 状態から分かる出来事を、1ラウンドの中では 貼った → 貼ってきた → 点数 の順で並べる。
export function collectThreadEventKeys({
  round = 1,
  screen = "",
  resolvedRounds = [],
  remoteRounds = [],
  chatIds = [],
} = {}) {
  const resolved = new Set(resolvedRounds);
  const remote = new Set(remoteRounds);
  const posted = DM_POSTED_SCREENS.includes(screen);
  const revealed = DM_REVEALED_SCREENS.includes(screen);
  const keys = [];
  for (let current = 1; current <= round; current += 1) {
    const isPast = current < round || resolved.has(current);
    if (isPast || posted) keys.push(threadEntryKey("local", current));
    if (remote.has(current) && (isPast || revealed)) keys.push(threadEntryKey("remote", current));
    if (resolved.has(current)) keys.push(threadEntryKey("scores", current));
  }
  chatIds.forEach((id) => {
    if (id) keys.push(threadEntryKey("chat", id));
  });
  return keys;
}

// 記録にない出来事だけを末尾へ足す。並び順は最初に記録された時の連番で固定する。
export function appendThreadEntries(log, keys) {
  const entries = Array.isArray(log) ? log : [];
  const known = new Set(entries.map((entry) => entry.key));
  let seq = entries.reduce((max, entry) => Math.max(max, Number(entry.seq) || 0), 0);
  const added = [];
  keys.forEach((key) => {
    if (known.has(key) || !parseThreadEntryKey(key)) return;
    known.add(key);
    seq += 1;
    added.push(Object.freeze({ key, seq }));
  });
  return added.length ? [...entries, ...added] : entries;
}

// 描画に使う並び。チャットは、今も手元に残っている発言だけにする。
export function orderedThreadEntries(log, { chatIds = [] } = {}) {
  const chats = new Set(chatIds);
  return (Array.isArray(log) ? log : [])
    .map((entry) => ({ ...parseThreadEntryKey(entry.key), key: entry.key, seq: entry.seq }))
    .filter((entry) => entry.kind && (entry.kind !== "chat" || chats.has(entry.chatId)))
    .sort((first, second) => first.seq - second.seq);
}

export function scoreWord(score) {
  const value = Number(score);
  if (value >= 10) return "堕ちかけ";
  if (value >= 9) return "刺さった";
  if (value >= 7) return "効いた";
  return "まだ平気";
}

// 1ラウンドの点数を、この端末から見た「返した点」と「受けた点」に直す。
export function localRoundScores(result, playerIndex) {
  const scores = [Number(result?.scorePlayerOne), Number(result?.scorePlayerTwo)];
  const remoteIndex = playerIndex === 0 ? 1 : 0;
  return { given: scores[remoteIndex], received: scores[playerIndex] };
}

export function localRoundOutcome(result, playerIndex) {
  if (result?.winnerIndex === null || result?.winnerIndex === undefined) return "draw";
  return result.winnerIndex === playerIndex ? "local" : "remote";
}

// 自分がいちばん高い点を返した相手の1枚。同点は後のラウンドを選ぶ。
export function mostEffectiveRemoteResult(history, playerIndex) {
  let best = null;
  (Array.isArray(history) ? history : []).forEach((result) => {
    const { given } = localRoundScores(result, playerIndex);
    if (!Number.isFinite(given)) return;
    if (!best || given >= localRoundScores(best, playerIndex).given) best = result;
  });
  return best;
}

// 相手から受けた点数の高い順に、自分のひとことを並べる。ひとことのないラウンドは出さない。
export function landedLocalCaptions(history, playerIndex, captionOf, limit = 3) {
  return (Array.isArray(history) ? history : [])
    .map((result) => ({
      round: result.round,
      score: localRoundScores(result, playerIndex).received,
      caption: String(captionOf?.(result) || "").trim(),
    }))
    .filter((entry) => entry.caption && Number.isFinite(entry.score))
    .sort((first, second) => second.score - first.score || first.round - second.round)
    .slice(0, Math.max(0, limit));
}

// 相手の口調は部屋の記録にないので、届いた画像・チャット・入力中の合図から決める。
export function latestOpponentPersona({
  remoteItems = [],
  chatMessages = [],
  opponentUid = "",
  typingVoiceSetId = "",
  knownIds = [],
} = {}) {
  const valid = (id) => knownIds.includes(id);
  const chat = [...chatMessages].reverse().find((message) => (
    message?.authorUid === opponentUid && valid(message.voiceSetId)
  ));
  if (chat) return chat.voiceSetId;
  const image = [...remoteItems]
    .filter(([, item]) => valid(item?.voiceSetId))
    .sort(([first], [second]) => second - first)[0];
  if (image) return image[1].voiceSetId;
  return valid(typingVoiceSetId) ? typingVoiceSetId : "";
}
