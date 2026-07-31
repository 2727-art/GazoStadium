export const AI_TEXT_TRAINING_SCHEMA_VERSION = 1;
export const AI_TEXT_TRAINING_ROUND_COUNT = 5;
export const AI_TEXT_TRAINING_BPM_MIN = 40;
export const AI_TEXT_TRAINING_BPM_MAX = 160;
export const AI_TEXT_TRAINING_FREE_BPM = 0;
export const AI_TEXT_TRAINING_FINAL_GAUGE_MS = 10_000;
export const AI_TEXT_TRAINING_PRODUCT_TYPES = Object.freeze([
  Object.freeze({
    id: "standard",
    label: "通常台本",
    shortLabel: "通常",
    description: "5ラウンドの応援台詞を収録した、通常トレーニング向けの商品です。",
  }),
  Object.freeze({
    id: "defeat_zone",
    label: "敗北ZONE専用台本",
    shortLabel: "ZONE専用",
    description: "5ラウンドに加え、最終攻勢・敗北・クールダウン・敗北証明まで収録します。",
  }),
]);
export const AI_TEXT_TRAINING_PLAY_STYLES = Object.freeze([
  Object.freeze({
    id: "standard",
    label: "通常トレーニング",
    shortLabel: "通常",
    description: "5ラウンドを終えたら、そのまま結果へ進む短時間モードです。",
  }),
  Object.freeze({
    id: "defeat_zone",
    label: "敗北ZONE",
    shortLabel: "敗北ZONE",
    description: "5枚の最終攻勢にギブアップし、クールダウンを経て敗北証明を受け取ります。",
  }),
]);
export const AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_BPM = 200;
export const AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS = 20_000;
export const AI_TEXT_TRAINING_DEFEAT_ZONE_DECEL_MS = 6_000;
export const AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_BPM = 30;
export const AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_MS = 60_000;
export const AI_TEXT_TRAINING_DEFEAT_ZONE_READY_SECONDS = 3;

export const AI_TEXT_TRAINING_MODES = Object.freeze([
  Object.freeze({
    id: "mama",
    label: "ママモード",
    shortLabel: "ママ",
    description: "「きつい」で、次のテンポをやさしく遅くします。",
    warning: "",
  }),
  Object.freeze({
    id: "imouto",
    label: "いもうとモード",
    shortLabel: "いもうと",
    description: "次のテンポを、開始時に決めた気まぐれな幅で変えます。",
    warning: "",
  }),
  Object.freeze({
    id: "oneechan",
    label: "お姉ちゃんモード",
    shortLabel: "お姉ちゃん",
    description: "「きつい」で、次のテンポをさらに速くします。",
    warning: "「きつい」と答えると次のBPMが速くなります。無理な時は即停止してください。",
  }),
]);

export const AI_TEXT_TRAINING_EXERCISES = Object.freeze([
  Object.freeze({
    id: "march",
    label: "その場足踏み",
    cue: "1拍ごとに、片足ずつ交互に動かす目安",
  }),
  Object.freeze({
    id: "squat",
    label: "スクワット",
    cue: "2拍で1回の目安。無理に深くしゃがまない",
  }),
  Object.freeze({
    id: "wall_push",
    label: "壁プッシュ",
    cue: "2拍で1回の目安。安定した壁で行う",
  }),
  Object.freeze({
    id: "free",
    label: "好きな運動",
    cue: "BPMはテンポの目安。自分に合う動きで行う",
  }),
]);

export const AI_TEXT_TRAINING_REACTIONS = Object.freeze([
  Object.freeze({ id: "easy", label: "余裕" }),
  Object.freeze({ id: "just_right", label: "ちょうどいい" }),
  Object.freeze({ id: "hard_but_ok", label: "きつい（まだ続けられる）" }),
]);

export const AI_TEXT_TRAINING_SCRIPT_SLOTS = Object.freeze([
  Object.freeze({ id: "start", label: "開始・ラウンド開始" }),
  Object.freeze({ id: "active_free", label: "通常・FREE RHYTHM" }),
  Object.freeze({ id: "active_low", label: "通常・LOW 40〜79" }),
  Object.freeze({ id: "active_mid", label: "通常・MID 80〜119" }),
  Object.freeze({ id: "active_high", label: "通常・HIGH 120〜160" }),
  Object.freeze({ id: "final_free", label: "残り5秒・FREE RHYTHM" }),
  Object.freeze({ id: "final_low", label: "残り5秒・LOW 40〜79" }),
  Object.freeze({ id: "final_mid", label: "残り5秒・MID 80〜119" }),
  Object.freeze({ id: "final_high", label: "残り5秒・HIGH 120〜160" }),
  Object.freeze({ id: "tempo_down", label: "次のテンポが遅くなる" }),
  Object.freeze({ id: "tempo_same", label: "同じ・FREE・上下限" }),
  Object.freeze({ id: "tempo_up", label: "次のテンポが速くなる" }),
  Object.freeze({ id: "rest", label: "反応・呼吸・次の確認" }),
  Object.freeze({ id: "clear", label: "5ラウンド完走" }),
]);

export const AI_TEXT_TRAINING_SCRIPT_SLOT_IDS = Object.freeze(
  AI_TEXT_TRAINING_SCRIPT_SLOTS.map((slot) => slot.id),
);
export const AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS = Object.freeze([
  Object.freeze({ id: "zone_rush", label: "最終攻勢・200 BPM" }),
  Object.freeze({ id: "zone_surrendered", label: "ギブアップ後・敗北確定" }),
  Object.freeze({ id: "zone_overpowered", label: "時間切れ後・敗北確定" }),
  Object.freeze({ id: "zone_cooldown", label: "クールダウン・30 BPM" }),
  Object.freeze({ id: "zone_certificate", label: "敗北証明" }),
]);
export const AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS = Object.freeze(
  AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS.map((slot) => slot.id),
);

const MODE_IDS = new Set(AI_TEXT_TRAINING_MODES.map((mode) => mode.id));
const PLAY_STYLE_IDS = new Set(AI_TEXT_TRAINING_PLAY_STYLES.map((style) => style.id));
const PRODUCT_TYPE_IDS = new Set(
  AI_TEXT_TRAINING_PRODUCT_TYPES.map((productType) => productType.id),
);
const REACTION_IDS = new Set(AI_TEXT_TRAINING_REACTIONS.map((reaction) => reaction.id));
const IMOUTO_OFFSETS = Object.freeze([-20, -10, 0, 10, 20]);

function freezeLines(lines) {
  return Object.freeze(lines.map((line) => String(line)));
}

function freezeScript(script) {
  return Object.freeze(Object.fromEntries(
    AI_TEXT_TRAINING_SCRIPT_SLOT_IDS.map((slotId) => [
      slotId,
      freezeLines(script[slotId]),
    ]),
  ));
}

export const AI_TEXT_TRAINING_BUILTIN_SCRIPTS = Object.freeze({
  mama: Object.freeze({
    id: "builtin-mama",
    title: "ママの見守り応援",
    description: "急がせすぎず、今の自分に合わせて進める標準台本です。",
    modeId: "mama",
    productType: "standard",
    authorName: "SYSTEM",
    price: 0,
    revision: 1,
    lines: freezeScript({
      start: ["準備できた？ 今日の分だけ一緒にやろう", "ラウンド{round}、焦らず始めようね"],
      active_free: ["自分の呼吸で大丈夫だよ", "丁寧な一回を積み重ねよう"],
      active_low: ["ゆっくりでいいよ、その調子", "{bpm} BPM、呼吸を止めずにね"],
      active_mid: ["いいリズムだよ、動きを小さくしても大丈夫", "今の{bpm} BPMを落ち着いて続けよう"],
      active_high: ["速い時ほど無理に大きく動かなくていいよ", "{bpm} BPM、つらければいつでも止めよう"],
      final_free: ["あと{remaining}秒、自分のペースで締めよう", "最後も急がず丁寧にいこう"],
      final_low: ["あと{remaining}秒、ゆっくりきれいにいこう", "低いテンポのまま落ち着いて締めよう"],
      final_mid: ["あと{remaining}秒、今のリズムを守ろう", "最後まで呼吸を忘れずにね"],
      final_high: ["あと{remaining}秒、動きを小さくしても大丈夫", "最後の速い区間、無理ならすぐ止めよう"],
      tempo_down: ["次は少しゆっくりにするね", "ちゃんと教えてくれてありがとう。テンポを下げるよ"],
      tempo_same: ["次も無理のない範囲でいこう", "FREEか上下限だよ。自分のペースを優先してね"],
      tempo_up: ["次は少し速い画像だよ。無理はしないでね", "テンポが上がるよ。動きを小さくしても大丈夫"],
      rest: ["呼吸を整えて、準備できたら次へ進もう", "ここで休んでいいよ。自分で次を押してね"],
      clear: ["5ラウンド完走、おつかれさま", "今日の自分に拍手。水分も忘れずにね"],
    }),
  }),
  imouto: Object.freeze({
    id: "builtin-imouto",
    title: "いもうとの気まぐれ応援",
    description: "次のテンポを予想できない、明るい標準台本です。",
    modeId: "imouto",
    productType: "standard",
    authorName: "SYSTEM",
    price: 0,
    revision: 1,
    lines: freezeScript({
      start: ["ラウンド{round}、いっしょに始めよ！", "次はどんなテンポかな？ よーい、スタート！"],
      active_free: ["自由なリズムもアリだよ！", "自分のペース、ちゃんとカッコいい！"],
      active_low: ["ゆっくりターン！ 丁寧にいこ", "{bpm} BPM、のんびりでも前進！"],
      active_mid: ["ちょうどノってきたかも！", "{bpm} BPM、そのリズムいいね！"],
      active_high: ["速いターンきた！ 小さな動きでもOK！", "{bpm} BPM、無理ならすぐ止まってね！"],
      final_free: ["あと{remaining}秒、好きなリズムでゴール！", "自由なまま最後までいこ！"],
      final_low: ["あと{remaining}秒、焦らずゴールしよ！", "最後もゆっくり、きれいにね！"],
      final_mid: ["あと{remaining}秒、そのままいけそう！", "今のテンポでゴールまで！"],
      final_high: ["あと{remaining}秒、速いけど無理しないで！", "ラストの高速ターン、止まる判断も大事！"],
      tempo_down: ["次はゆっくりになったよ！", "気まぐれでテンポダウン！"],
      tempo_same: ["次はFREEか同じくらい！", "変わらないのも気まぐれってことで！"],
      tempo_up: ["次は速くなったよ！", "気まぐれテンポアップ、準備できたらね！"],
      rest: ["いったん休憩！ 次は自分で押してね", "深呼吸タイム。まだ急がなくていいよ！"],
      clear: ["5ラウンドできた！ すごい！", "完走おめでとう、今日はここまで！"],
    }),
  }),
  oneechan: Object.freeze({
    id: "builtin-oneechan",
    title: "お姉ちゃんの攻める応援",
    description: "続けられる「きつい」にはテンポアップで返す標準台本です。",
    modeId: "oneechan",
    productType: "standard",
    authorName: "SYSTEM",
    price: 0,
    revision: 1,
    lines: freezeScript({
      start: ["ラウンド{round}、準備ができたらついてきて", "始めるよ。でも無理と我慢は別だからね"],
      active_free: ["FREE RHYTHM、自分の動きで見せて", "自由なテンポでも止め時は自分で決めてね"],
      active_low: ["まだ丁寧に動けるテンポだね", "{bpm} BPM、フォームを崩さずいこう"],
      active_mid: ["いいテンポ。ここから集中して", "{bpm} BPM、呼吸を止めないで"],
      active_high: ["速いよ。動きを小さくしても構わない", "{bpm} BPM、無理なら即停止を選んでね"],
      final_free: ["あと{remaining}秒、自分のペースで決めて", "最後も急がず、正確にいこう"],
      final_low: ["あと{remaining}秒、低いテンポを丁寧に", "ラストも焦らず、きれいにいこう"],
      final_mid: ["あと{remaining}秒、今のリズムを守って", "最後の区間、呼吸までコントロールして"],
      final_high: ["あと{remaining}秒、最後の速い区間だよ", "追い込みだけど、無理なら今すぐ止めて"],
      tempo_down: ["次は基準画像がゆっくり。丁寧にいこう", "テンポダウン、動きを整えるチャンス"],
      tempo_same: ["次はFREEか上下限。同じ条件でいくよ", "変化なし。準備できたら次へ"],
      tempo_up: ["続けられるって言ったね。次は少し速くするよ", "次はテンポアップ。無理なら即停止を使って"],
      rest: ["呼吸を整えて。自分で次を押すまで待つよ", "休憩は戦略。準備できたら進もう"],
      clear: ["5ラウンド完走。よくついてきたね", "今日はここまで。完走、おつかれさま"],
    }),
  }),
});

export function aiTextTrainingMode(modeId) {
  return AI_TEXT_TRAINING_MODES.find((mode) => mode.id === modeId)
    || AI_TEXT_TRAINING_MODES[0];
}

export function aiTextTrainingPlayStyle(playStyleId) {
  return AI_TEXT_TRAINING_PLAY_STYLES.find((style) => style.id === playStyleId)
    || AI_TEXT_TRAINING_PLAY_STYLES[0];
}

export function aiTextTrainingProductType(productTypeId) {
  return AI_TEXT_TRAINING_PRODUCT_TYPES.find((productType) => productType.id === productTypeId)
    || AI_TEXT_TRAINING_PRODUCT_TYPES[0];
}

export function normalizeAiTextTrainingProductType(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return PRODUCT_TYPE_IDS.has(normalized) ? normalized : "standard";
}

export function normalizeAiTextTrainingPlayStyle(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return PLAY_STYLE_IDS.has(normalized) ? normalized : "standard";
}

export function aiTextTrainingExercise(exerciseId) {
  return AI_TEXT_TRAINING_EXERCISES.find((exercise) => exercise.id === exerciseId)
    || AI_TEXT_TRAINING_EXERCISES[0];
}

export function normalizeAiTextTrainingBpm(value) {
  const bpm = Number(value);
  if (!Number.isInteger(bpm)) return null;
  if (bpm === AI_TEXT_TRAINING_FREE_BPM) return bpm;
  if (bpm < AI_TEXT_TRAINING_BPM_MIN || bpm > AI_TEXT_TRAINING_BPM_MAX) return null;
  return bpm;
}

export function clampAiTextTrainingBpm(value) {
  const bpm = Math.round(Number(value));
  if (!Number.isFinite(bpm)) return AI_TEXT_TRAINING_BPM_MIN;
  return Math.max(AI_TEXT_TRAINING_BPM_MIN, Math.min(AI_TEXT_TRAINING_BPM_MAX, bpm));
}

export function aiTextTrainingTempoBand(bpm) {
  const normalized = normalizeAiTextTrainingBpm(bpm);
  if (normalized === null) return "free";
  if (normalized === 0) return "free";
  if (normalized <= 79) return "low";
  if (normalized <= 119) return "mid";
  return "high";
}

export function aiTextTrainingBeatGaugeState({
  bpm,
  effectiveAt = 0,
  now = 0,
  remainingMs = 0,
  phase = "paused",
} = {}) {
  const normalizedBpm = normalizeAiTextTrainingBpm(bpm);
  const numericRemainingMs = Number(remainingMs);
  const safeRemainingMs = Number.isFinite(numericRemainingMs)
    ? Math.max(0, numericRemainingMs)
    : 0;
  const finalTen = phase === "playing"
    && safeRemainingMs <= AI_TEXT_TRAINING_FINAL_GAUGE_MS;
  const urgency = finalTen
    ? Math.max(
      0,
      Math.min(
        1,
        (AI_TEXT_TRAINING_FINAL_GAUGE_MS - safeRemainingMs)
          / AI_TEXT_TRAINING_FINAL_GAUGE_MS,
      ),
    )
    : 0;
  const freeRhythm = normalizedBpm === AI_TEXT_TRAINING_FREE_BPM;
  if (phase !== "playing" || normalizedBpm === null || freeRhythm) {
    return Object.freeze({
      active: false,
      freeRhythm,
      finalTen,
      urgency,
      beatDurationMs: 0,
      cycleDurationMs: 0,
      phaseOffsetMs: 0,
    });
  }

  const beatDurationMs = 60_000 / normalizedBpm;
  const cycleDurationMs = beatDurationMs * 2;
  const numericEffectiveAt = Number(effectiveAt);
  const numericNow = Number(now);
  const elapsedMs = Number.isFinite(numericEffectiveAt)
      && numericEffectiveAt > 0
      && Number.isFinite(numericNow)
    ? Math.max(0, numericNow - numericEffectiveAt)
    : 0;
  const phaseOffsetMs = elapsedMs % cycleDurationMs;
  return Object.freeze({
    active: true,
    freeRhythm: false,
    finalTen,
    urgency,
    beatDurationMs,
    cycleDurationMs,
    phaseOffsetMs,
  });
}

export function aiTextTrainingDefeatZoneBeatGaugeState({
  bpm,
  effectiveAt = 0,
  now = 0,
  remainingMs = 0,
  phase = "zone_paused",
} = {}) {
  const normalizedBpm = Number(bpm);
  const active = Number.isInteger(normalizedBpm)
    && normalizedBpm >= AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_BPM
    && normalizedBpm <= AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_BPM
    && ["zone_rush", "zone_deceleration", "zone_cooldown"].includes(phase);
  const safeBpm = active ? normalizedBpm : AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_BPM;
  const beatDurationMs = 60_000 / safeBpm;
  const cycleDurationMs = beatDurationMs * 2;
  const numericNow = Number(now);
  const numericEffectiveAt = Number(effectiveAt);
  const elapsedMs = Number.isFinite(numericNow) && Number.isFinite(numericEffectiveAt)
    ? Math.max(0, numericNow - numericEffectiveAt)
    : 0;
  const numericRemainingMs = Number(remainingMs);
  const safeRemainingMs = Number.isFinite(numericRemainingMs)
    ? Math.max(0, numericRemainingMs)
    : 0;
  const rush = phase === "zone_rush";
  return {
    active,
    freeRhythm: false,
    finalTen: active && rush && safeRemainingMs <= AI_TEXT_TRAINING_FINAL_GAUGE_MS,
    urgency: active && rush
      ? Math.max(0, Math.min(1, (
        AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS - safeRemainingMs
      ) / AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_MS))
      : 0,
    beatDurationMs,
    cycleDurationMs,
    phaseOffsetMs: elapsedMs % cycleDurationMs,
  };
}

export function aiTextTrainingTempoDirection(previousBpm, nextBpm) {
  const previous = normalizeAiTextTrainingBpm(previousBpm);
  const next = normalizeAiTextTrainingBpm(nextBpm);
  if (previous === null || next === null || previous === 0 || next === 0) return "same";
  if (next < previous) return "down";
  if (next > previous) return "up";
  return "same";
}

function imoutoOffsetAt(randomValue, previousOffset) {
  const normalized = Number.isFinite(Number(randomValue))
    ? Math.max(0, Math.min(0.999999999, Number(randomValue)))
    : Math.random();
  const candidates = IMOUTO_OFFSETS.filter((offset) => offset !== previousOffset);
  return candidates[Math.floor(normalized * candidates.length)] ?? 0;
}

export function createAiTextTrainingPlan({
  modeId = "mama",
  bpms = [],
  randomValues = [],
} = {}) {
  if (!MODE_IDS.has(modeId)) throw new RangeError("AIモードを選び直してください。");
  if (!Array.isArray(bpms) || bpms.length !== AI_TEXT_TRAINING_ROUND_COUNT) {
    throw new RangeError("画像5枚それぞれのBPMを設定してください。");
  }
  const baseBpms = bpms.map((value) => {
    const bpm = normalizeAiTextTrainingBpm(value);
    if (bpm === null) throw new RangeError("BPMは0または40〜160の整数で設定してください。");
    return bpm;
  });
  const imoutoOffsets = Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(0);
  let previousOffset = 0;
  for (let index = 1; index < AI_TEXT_TRAINING_ROUND_COUNT; index += 1) {
    const offset = imoutoOffsetAt(randomValues[index - 1], previousOffset);
    imoutoOffsets[index] = offset;
    previousOffset = offset;
  }
  const effectiveBpms = Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null);
  effectiveBpms[0] = baseBpms[0];
  if (modeId === "imouto") {
    for (let index = 1; index < AI_TEXT_TRAINING_ROUND_COUNT; index += 1) {
      effectiveBpms[index] = baseBpms[index] === 0
        ? 0
        : clampAiTextTrainingBpm(baseBpms[index] + imoutoOffsets[index]);
    }
  }
  return {
    schemaVersion: AI_TEXT_TRAINING_SCHEMA_VERSION,
    modeId,
    baseBpms,
    imoutoOffsets,
    effectiveBpms,
    reactions: Array(AI_TEXT_TRAINING_ROUND_COUNT).fill(null),
  };
}
export function applyAiTextTrainingReaction(plan, roundIndex, reactionId) {
  if (!plan || Number(plan.schemaVersion) !== AI_TEXT_TRAINING_SCHEMA_VERSION) {
    throw new RangeError("トレーニング状態を読み直してください。");
  }
  if (!Number.isInteger(roundIndex)
      || roundIndex < 0
      || roundIndex >= AI_TEXT_TRAINING_ROUND_COUNT) {
    throw new RangeError("ラウンドを確認してください。");
  }
  if (!REACTION_IDS.has(reactionId)) throw new RangeError("反応を選び直してください。");
  if (plan.reactions[roundIndex]) {
    if (plan.reactions[roundIndex] !== reactionId) {
      throw new RangeError("このラウンドの反応は確定済みです。");
    }
    return plan;
  }
  plan.reactions[roundIndex] = reactionId;
  if (roundIndex >= AI_TEXT_TRAINING_ROUND_COUNT - 1) return plan;
  if (plan.effectiveBpms[roundIndex + 1] !== null) return plan;

  const nextBaseBpm = plan.baseBpms[roundIndex + 1];
  if (nextBaseBpm === 0) {
    plan.effectiveBpms[roundIndex + 1] = 0;
    return plan;
  }
  const currentBpm = plan.effectiveBpms[roundIndex];
  if (reactionId !== "hard_but_ok" || currentBpm === 0) {
    plan.effectiveBpms[roundIndex + 1] = nextBaseBpm;
    return plan;
  }
  if (plan.modeId === "mama") {
    plan.effectiveBpms[roundIndex + 1] = clampAiTextTrainingBpm(
      Math.min(nextBaseBpm, currentBpm - 10),
    );
    return plan;
  }
  if (plan.modeId === "oneechan") {
    plan.effectiveBpms[roundIndex + 1] = clampAiTextTrainingBpm(
      Math.max(nextBaseBpm, currentBpm + 10),
    );
    return plan;
  }
  plan.effectiveBpms[roundIndex + 1] = nextBaseBpm;
  return plan;
}

export function aiTextTrainingScriptSlot({
  phase = "active",
  bpm = 0,
  remainingSeconds = 0,
  direction = "same",
} = {}) {
  if (phase === "start") return "start";
  if (phase === "rest") return "rest";
  if (phase === "clear") return "clear";
  if (phase === "transition") {
    return ["down", "up"].includes(direction) ? `tempo_${direction}` : "tempo_same";
  }
  const band = aiTextTrainingTempoBand(bpm);
  return `${Number(remainingSeconds) <= 5 ? "final" : "active"}_${band}`;
}

export function renderAiTextTrainingLine(
  line,
  { bpm = 0, round = 1, remaining = 0 } = {},
) {
  const normalizedBpm = normalizeAiTextTrainingBpm(bpm);
  const zoneBpm = Number(bpm);
  const renderedBpm = normalizedBpm
    ?? ([AI_TEXT_TRAINING_DEFEAT_ZONE_COOLDOWN_BPM,
      AI_TEXT_TRAINING_DEFEAT_ZONE_RUSH_BPM].includes(zoneBpm)
      ? zoneBpm
      : 0);
  return String(line ?? "")
    .replaceAll("{bpm}", String(renderedBpm))
    .replaceAll("{round}", String(Math.max(1, Math.min(5, Math.floor(Number(round) || 1)))))
    .replaceAll("{remaining}", String(Math.max(0, Math.ceil(Number(remaining) || 0))));
}

export function pickAiTextTrainingLine(lines, previousLine = "", randomValue = Math.random()) {
  const candidates = Array.isArray(lines)
    ? lines.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  if (!candidates.length) return "";
  const alternatives = candidates.length > 1
    ? candidates.filter((line) => line !== previousLine)
    : candidates;
  const normalized = Number.isFinite(Number(randomValue))
    ? Math.max(0, Math.min(0.999999999, Number(randomValue)))
    : Math.random();
  return alternatives[Math.floor(normalized * alternatives.length)] || alternatives[0];
}

export function aiTextTrainingMessageCadenceMs(bpm) {
  const normalized = normalizeAiTextTrainingBpm(bpm);
  if (!normalized) return 4_600;
  const eightBeats = (60_000 / normalized) * 8;
  return Math.round(Math.max(2_400, Math.min(5_200, eightBeats)));
}

export function normalizeAiTextTrainingScriptSnapshot(value, fallbackModeId = "mama") {
  const source = value && typeof value === "object" ? value : {};
  const modeId = MODE_IDS.has(source.modeId) ? source.modeId : fallbackModeId;
  const productType = normalizeAiTextTrainingProductType(source.productType);
  const builtin = AI_TEXT_TRAINING_BUILTIN_SCRIPTS[modeId];
  const sourceLines = source.lines && typeof source.lines === "object" ? source.lines : {};
  const sourceZoneLines = source.zoneLines && typeof source.zoneLines === "object"
    ? source.zoneLines
    : {};
  const lines = {};
  for (const slotId of AI_TEXT_TRAINING_SCRIPT_SLOT_IDS) {
    const candidates = Array.isArray(sourceLines[slotId])
      ? sourceLines[slotId].map((line) => String(line || "").trim()).filter(Boolean).slice(0, 4)
      : [];
    lines[slotId] = candidates.length >= 2 ? candidates : [...builtin.lines[slotId]];
  }
  const zoneLines = Object.fromEntries(
    AI_TEXT_TRAINING_ZONE_SCRIPT_SLOT_IDS.map((slotId) => {
      const candidates = Array.isArray(sourceZoneLines[slotId])
        ? sourceZoneLines[slotId]
          .map((line) => String(line || "").trim())
          .filter(Boolean)
          .slice(0, 4)
        : [];
      return [slotId, productType === "defeat_zone" ? candidates : []];
    }),
  );
  return {
    id: String(source.id || builtin.id),
    title: String(source.title || builtin.title).slice(0, 30),
    description: String(source.description || builtin.description).slice(0, 120),
    modeId,
    productType,
    authorName: String(source.authorName || builtin.authorName).slice(0, 16),
    publicSellerId: String(source.publicSellerId || ""),
    price: Math.max(0, Math.floor(Number(source.price) || 0)),
    revision: Math.max(1, Math.floor(Number(source.revision) || 1)),
    lines,
    zoneLines,
  };
}
