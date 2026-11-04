// 戦略型1on1の見つめるモード：見られる1枚、開閉の判断、重ねるチャットの選び方。
// DOM・Firebase・P2Pには触れない。画面の描画は strategy.js、拡大の計算は通常型の normal-dm-gaze.mjs が受け持つ。

export const STRATEGY_GAZE_RECENT_LIMIT = 3;

function pendingKey(pending) {
  return pending && pending.stage ? `${pending.slot}:${pending.stage}:${pending.actor}` : "";
}

// 見つめている1枚が、いま自分の採点待ちか。
export function strategyGazeScoring(gazeSlot, pending, uid) {
  return Boolean(gazeSlot !== null && pending && pending.stage === "score" && pending.actor === uid && pending.slot === gazeSlot);
}

// 場面が進んだ時の開閉。見ていた1枚の採点を返した時（採点待ちが終わった時）と、
// 自分が次の1枚を貼る番に入った時、決着した時、画像が手元にない時は閉じる。それ以外は開いたまま。
export function nextStrategyGazeSlot({
  gazeSlot = null,
  previousPending = null,
  pending = null,
  uid = "",
  outcome = null,
  hasImage = () => false,
} = {}) {
  if (gazeSlot === null || gazeSlot === undefined) return null;
  if (outcome) return null;
  if (!hasImage(gazeSlot)) return null;
  if (pendingKey(previousPending) !== pendingKey(pending)) {
    if (strategyGazeScoring(gazeSlot, previousPending, uid)) return null;
    if (pending?.stage === "act" && pending.actor === uid) return null;
  }
  return gazeSlot;
}

// 重ねるのはチャットだけ。スレッドの並びのうち、新しい方から決まった数を古い順に返す。
export function recentStrategyGazeChatIds(entries, limit = STRATEGY_GAZE_RECENT_LIMIT) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.kind === "chat" && entry.id)
    .slice(-Math.max(0, limit))
    .map((entry) => entry.id);
}
