// 通常型1on1の見つめるモード：開ける場面、開閉の判断、重ねる吹き出しの選び方、拡大の計算。
// DOM・Firebase・P2Pには触れない。画面の描画は online.js が受け持つ。

// 次の1枚を選ぶ間（10秒のタイマー）は開かない。
export const GAZE_SCENES = Object.freeze([
  "waitingPick",
  "waitingImage",
  "reveal",
  "score",
  "waitingScore",
  "result",
  "waitingContinue",
]);
export const GAZE_RECENT_LIMIT = 3;
export const GAZE_MIN_SCALE = 1;
export const GAZE_MAX_SCALE = 4;
export const GAZE_DOUBLE_TAP_SCALE = 2.5;
const GAZE_LINE_OPACITY = Object.freeze([1, 0.72, 0.46]);

export function canGaze(screen) {
  return GAZE_SCENES.includes(screen);
}

// 画面が進んだ時の開閉。届いた時は設定がオンならラウンドごとに1回だけ自動で開き、
// 点数がそろった時（result）と選ぶ時（select）は閉じる。画像が手元にない1枚は開かない。
export function nextGazeRound({
  previousScreen = "",
  screen = "",
  gazeRound = null,
  round = 1,
  autoOpen = true,
  autoOpenedRounds = [],
  hasImage = () => false,
} = {}) {
  if (!canGaze(screen)) return { gazeRound: null, autoOpened: false };
  const entered = previousScreen !== screen;
  if (entered && screen === "result") return { gazeRound: null, autoOpened: false };
  if (entered && screen === "reveal" && autoOpen && !autoOpenedRounds.includes(round) && hasImage(round)) {
    return { gazeRound: round, autoOpened: true };
  }
  if (gazeRound !== null && !hasImage(gazeRound)) return { gazeRound: null, autoOpened: false };
  return { gazeRound, autoOpened: false };
}

// 重ねるのはチャットだけ。スレッドの並びのうち、新しい方から決まった数を古い順に返す。
export function recentGazeChatIds(entries, limit = GAZE_RECENT_LIMIT) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.kind === "chat" && entry.chatId)
    .slice(-Math.max(0, limit))
    .map((entry) => entry.chatId);
}

// 新しい吹き出しほど濃く、古いものほど薄く。
export function gazeLineOpacity(indexFromNewest) {
  const index = Math.max(0, Math.floor(Number(indexFromNewest) || 0));
  return GAZE_LINE_OPACITY[Math.min(index, GAZE_LINE_OPACITY.length - 1)];
}

// 拡大の状態は { scale, x, y }（x・y は画像の中心からのずれ、px）。
// 画像の外の何もない所が見えないよう、ずらせる幅を倍率に合わせて止める。
export function clampGazeZoom({ scale = 1, x = 0, y = 0 } = {}, { width = 0, height = 0 } = {}) {
  const nextScale = Math.min(GAZE_MAX_SCALE, Math.max(GAZE_MIN_SCALE, Number(scale) || GAZE_MIN_SCALE));
  if (nextScale === GAZE_MIN_SCALE) return { scale: GAZE_MIN_SCALE, x: 0, y: 0 };
  const limit = (value, size) => {
    const max = Math.max(0, (Number(size) || 0) * (nextScale - 1) / 2);
    return Math.min(max, Math.max(-max, Number(value) || 0));
  };
  return { scale: nextScale, x: limit(x, width), y: limit(y, height) };
}

// focus（画像の中心からの位置、px）を指の下に止めたまま倍率を変える。
export function zoomGazeAt(zoom, nextScale, focus = { x: 0, y: 0 }, size = {}) {
  const current = clampGazeZoom(zoom, size);
  const target = Math.min(GAZE_MAX_SCALE, Math.max(GAZE_MIN_SCALE, Number(nextScale) || GAZE_MIN_SCALE));
  const ratio = target / current.scale;
  return clampGazeZoom({
    scale: target,
    x: focus.x - (focus.x - current.x) * ratio,
    y: focus.y - (focus.y - current.y) * ratio,
  }, size);
}

// ダブルタップ：等倍ならその場所を拡大し、拡大中なら等倍に戻す。
export function toggleGazeZoom(zoom, focus, size) {
  return clampGazeZoom(zoom, size).scale > GAZE_MIN_SCALE
    ? { scale: GAZE_MIN_SCALE, x: 0, y: 0 }
    : zoomGazeAt(zoom, GAZE_DOUBLE_TAP_SCALE, focus, size);
}
