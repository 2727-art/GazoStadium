export const ROULETTE_TRAINING_SCHEMA_VERSION = 1;
export const IMAGE_MAX_COUNT = 10;
export const MENU_MAX_COUNT = 10;
export const BASE_BPM = 60;
export const MIN_BPM = 40;
export const MAX_BPM = 100;
export const BPM_STEP = 5;
export const BPM_DOUBLE_STEP = 10;
export const TEMP_EFFECT_MS = 20_000;
export const MENU_PROBABILITY = 0.65;
export const EFFECT_PROBABILITY = 0.35;
export const DEFAULT_TARGET_ROUNDS = 5;
export const ALL_OUT_COUNT_VALUE = 100;
export const COUNT_CANDIDATES = Object.freeze([10, 20, 25, 30, 35, 40, 50]);
export const ALL_OUT_COUNT_CANDIDATES = Object.freeze(
  COUNT_CANDIDATES.map(() => ALL_OUT_COUNT_VALUE),
);

const LEGACY_COUNT_CANDIDATES = Object.freeze({
  light: Object.freeze({
    reps: Object.freeze([3, 5, 8]),
    seconds: Object.freeze([10, 15, 20]),
    round_trips: Object.freeze([2, 3, 5]),
    sets: Object.freeze([1, 2, 3]),
  }),
  standard: Object.freeze({
    reps: Object.freeze([5, 8, 10, 12]),
    seconds: Object.freeze([15, 20, 30, 40]),
    round_trips: Object.freeze([3, 5, 8, 10]),
    sets: Object.freeze([2, 3, 4, 5]),
  }),
});

export const UNITS = Object.freeze([
  Object.freeze({ id: "reps", label: "回" }),
  Object.freeze({ id: "seconds", label: "秒" }),
  Object.freeze({ id: "round_trips", label: "往復" }),
  Object.freeze({ id: "sets", label: "セット" }),
]);

export const EFFECTS = Object.freeze([
  Object.freeze({
    id: "tempo_up",
    label: "テンポアップ",
    kind: "persistent",
    delta: BPM_STEP,
    multiplier: null,
    durationMs: 0,
  }),
  Object.freeze({
    id: "tempo_down",
    label: "テンポダウン",
    kind: "persistent",
    delta: -BPM_STEP,
    multiplier: null,
    durationMs: 0,
  }),
  Object.freeze({
    id: "fever",
    label: "フィーバータイム",
    kind: "temporary",
    delta: null,
    multiplier: 1.3,
    durationMs: TEMP_EFFECT_MS,
  }),
  Object.freeze({
    id: "slow",
    label: "スロータイム",
    kind: "temporary",
    delta: null,
    multiplier: 0.7,
    durationMs: TEMP_EFFECT_MS,
  }),
  Object.freeze({
    id: "tempo_up_2",
    label: "テンポ2段階アップ",
    kind: "persistent",
    delta: BPM_DOUBLE_STEP,
    multiplier: null,
    durationMs: 0,
  }),
  Object.freeze({
    id: "tempo_down_2",
    label: "テンポ2段階ダウン",
    kind: "persistent",
    delta: -BPM_DOUBLE_STEP,
    multiplier: null,
    durationMs: 0,
  }),
  Object.freeze({
    id: "all_out_time",
    label: "おーるあうとたいむ♡",
    kind: "count_override",
    delta: null,
    multiplier: null,
    durationMs: 0,
    allOutCount: true,
  }),
]);

const UNIT_IDS = new Set(UNITS.map((unit) => unit.id));
const EFFECT_BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]));
const EFFECT_IDS = Object.freeze(EFFECTS.map((effect) => effect.id));
const INTENSITY_IDS = new Set(["light", "standard"]);
const PHASE_IDS = new Set([
  "roulette",
  "effect_result",
  "menu_result",
  "ready",
  "training",
  "paused",
  "rest",
  "result",
  "ended",
]);

export const FREE_PACK = Object.freeze({
  id: "roulette-training-free",
  revision: 1,
  sellerName: "SYSTEM",
  title: "はじめてのルーレットトレーニング",
  description: "道具を使わず、自分のペースで試せる基本メニューです。",
  price: 0,
  builtin: true,
  items: Object.freeze([
    Object.freeze({
      id: "march",
      menuText: "その場足踏み",
      detailText: "姿勢を安定させ、無理のない高さで交互に足を上げます。",
      countUnit: "reps",
      cheerLines: Object.freeze(["焦らず、今のリズムでいこう！"]),
    }),
    Object.freeze({
      id: "squat",
      menuText: "浅めのスクワット",
      detailText: "痛みのない範囲で浅く腰を下げ、ゆっくり戻します。",
      countUnit: "reps",
      cheerLines: Object.freeze(["小さな動きでも大丈夫。その調子！"]),
    }),
    Object.freeze({
      id: "wall_push",
      menuText: "壁プッシュ",
      detailText: "安定した壁に手をつき、身体を支えながら曲げ伸ばしします。",
      countUnit: "reps",
      cheerLines: Object.freeze(["呼吸を止めずに、丁寧にいこう！"]),
    }),
  ]),
});

export const ROULETTE_TRAINING_TRANSITIONS = Object.freeze([
  { from: "roulette", event: "spin", to: "menu_result|effect_result" },
  { from: "effect_result", event: "continue_after_effect", to: "roulette" },
  { from: "menu_result", event: "spin_count", to: "ready" },
  { from: "ready", event: "start", to: "training" },
  { from: "paused", event: "resume", to: "training" },
  { from: "training", event: "clear", to: "rest" },
  { from: "rest", event: "next_roulette", to: "roulette" },
  ...[
    "roulette",
    "effect_result",
    "menu_result",
    "ready",
    "training",
    "paused",
    "rest",
  ].map((from) => ({ from, event: "give_up", to: "result" })),
  { from: "roulette", event: "show_result", to: "result" },
  { from: "rest", event: "show_result", to: "result" },
  { from: "result", event: "finish", to: "ended" },
].map((transition) => Object.freeze(transition)));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedId(value, fieldName) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 128) {
    throw new RangeError(`${fieldName} must be 1-128 characters`);
  }
  return id;
}

function normalizedText(value, fieldName, {
  required = true,
  maximum = 200,
  oneLine = false,
} = {}) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (required && !text) throw new RangeError(`${fieldName} is required`);
  if (oneLine && /\n/u.test(text)) throw new RangeError(`${fieldName} must be one line`);
  if (Array.from(text).length > maximum) {
    throw new RangeError(`${fieldName} must be at most ${maximum} characters`);
  }
  return text;
}

function normalizedInteger(value, fallback, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) return fallback;
  return numeric;
}

function clamped(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedToStep(value, step = BPM_STEP) {
  return Math.round(value / step) * step;
}

function randomUnit(random) {
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random must return a number from 0 (inclusive) to 1 (exclusive)");
  }
  return value;
}

function normalizeBag(bag, allowedIds, fieldName) {
  if (!Array.isArray(bag)) throw new TypeError(`${fieldName} must be an array`);
  const allowed = new Set(allowedIds);
  const normalized = bag.map((id) => normalizedId(id, `${fieldName} item`));
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError(`${fieldName} cannot contain duplicate ids`);
  }
  if (normalized.some((id) => !allowed.has(id))) {
    throw new RangeError(`${fieldName} contains an unknown id`);
  }
  return normalized;
}

function shuffledCycle(ids, random, avoidFirstId = "") {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomUnit(random) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  if (result.length > 1 && avoidFirstId && result[0] === avoidFirstId) {
    const swapIndex = result.findIndex((id) => id !== avoidFirstId);
    [result[0], result[swapIndex]] = [result[swapIndex], result[0]];
  }
  return result;
}

export function drawShuffleBag({ ids, bag = [], lastId = "", random = Math.random }) {
  const normalizedIds = ids.map((id) => normalizedId(id, "shuffle id"));
  if (normalizedIds.length < 1 || new Set(normalizedIds).size !== normalizedIds.length) {
    throw new RangeError("shuffle ids must be a non-empty unique array");
  }
  let remaining = normalizeBag(bag, normalizedIds, "shuffle bag");
  let cycleStarted = false;
  if (remaining.length === 0) {
    remaining = shuffledCycle(normalizedIds, random, lastId);
    cycleStarted = true;
  }
  const value = remaining[0];
  return {
    value,
    bag: remaining.slice(1),
    cycleStarted,
  };
}

export function normalizeUnit(value) {
  const unitId = String(value ?? "").trim().toLowerCase();
  return UNIT_IDS.has(unitId) ? unitId : "reps";
}

export function normalizeBpm(value, fallbackOrOptions = BASE_BPM, maximumBpm = MAX_BPM) {
  const options = fallbackOrOptions
    && typeof fallbackOrOptions === "object"
    && !Array.isArray(fallbackOrOptions)
    ? fallbackOrOptions
    : null;
  const minimum = clamped(
    roundedToStep(Number(options?.minimum) || MIN_BPM),
    MIN_BPM,
    MAX_BPM,
  );
  const maximum = clamped(
    roundedToStep(Number(options?.maximum ?? maximumBpm) || MAX_BPM),
    minimum,
    MAX_BPM,
  );
  const numeric = Number(value);
  const fallbackNumeric = Number(options?.fallback ?? fallbackOrOptions);
  const source = Number.isFinite(numeric)
    ? numeric
    : (Number.isFinite(fallbackNumeric) ? fallbackNumeric : BASE_BPM);
  return clamped(roundedToStep(source), minimum, maximum);
}

export function countCandidates(
  unitId = "reps",
  intensity = "standard",
  { allOut = false } = {},
) {
  normalizeUnit(unitId);
  normalizeIntensity(intensity);
  return [...(allOut ? ALL_OUT_COUNT_CANDIDATES : COUNT_CANDIDATES)];
}

function normalizeCheerLines(value) {
  const source = Array.isArray(value)
    ? value
    : (value == null || value === "" ? [] : [value]);
  if (source.length < 1 || source.length > 4) {
    throw new RangeError("cheerLines must contain 1-4 lines");
  }
  return source.map((line, index) => normalizedText(
    line,
    `cheerLines[${index}]`,
    { maximum: 60, oneLine: true },
  ));
}

function normalizeMenuItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError(`items[${index}] must be an object`);
  }
  const menuText = normalizedText(
    item.menuText ?? item.training ?? item.exercise ?? item.title,
    `items[${index}].menuText`,
    { maximum: 80, oneLine: true },
  );
  const dialogueSource = item.cheerLines ?? item.dialogue ?? item.line;
  return {
    id: normalizedId(item.id ?? `menu-${index + 1}`, `items[${index}].id`),
    menuText,
    detailText: normalizedText(item.detailText, `items[${index}].detailText`, {
      required: false,
      maximum: 120,
    }),
    countUnit: normalizeUnit(item.countUnit ?? item.unit),
    cheerLines: normalizeCheerLines(dialogueSource),
  };
}

export function normalizePack(value, { allowEmptyItems = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("pack must be an object");
  }
  const sourceItems = value.items ?? value.menus ?? [];
  if (!Array.isArray(sourceItems)) throw new TypeError("pack.items must be an array");
  if ((!allowEmptyItems && sourceItems.length < 1) || sourceItems.length > MENU_MAX_COUNT) {
    throw new RangeError(`pack.items must contain ${allowEmptyItems ? "0" : "1"}-${MENU_MAX_COUNT} menus`);
  }
  const items = sourceItems.map(normalizeMenuItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new RangeError("pack item ids must be unique");
  }
  return {
    id: normalizedId(value.id ?? value.packId ?? "roulette-training-pack", "pack.id"),
    revision: normalizedInteger(value.revision, 1, { minimum: 1 }),
    sellerName: normalizedText(value.sellerName ?? "", "pack.sellerName", {
      required: false,
      maximum: 16,
      oneLine: true,
    }),
    title: normalizedText(value.title ?? "トレーニングメニュー", "pack.title", {
      maximum: 30,
      oneLine: true,
    }),
    description: normalizedText(value.description ?? "", "pack.description", {
      required: false,
      maximum: 120,
    }),
    price: normalizedInteger(value.price, 0, { minimum: 0, maximum: 1_000_000_000 }),
    builtin: value.builtin === true,
    items,
  };
}

export function chooseMainType({
  forceMenu = false,
  menuProbability = MENU_PROBABILITY,
  random = Math.random,
} = {}) {
  if (forceMenu) return "menu";
  const probability = Number(menuProbability);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("menuProbability must be from 0 through 1");
  }
  return randomUnit(random) < probability ? "menu" : "effect";
}

export function drawMain({
  menus,
  menuBag = [],
  effectBag = [],
  forceMenu = false,
  menuProbability = MENU_PROBABILITY,
  random = Math.random,
  lastMenuId = "",
  lastEffectId = "",
} = {}) {
  if (!Array.isArray(menus) || menus.length < 1 || menus.length > MENU_MAX_COUNT) {
    throw new RangeError(`menus must contain 1-${MENU_MAX_COUNT} items`);
  }
  const normalizedMenus = menus.map(normalizeMenuItem);
  if (new Set(normalizedMenus.map((item) => item.id)).size !== normalizedMenus.length) {
    throw new RangeError("menu ids must be unique");
  }
  const type = chooseMainType({ forceMenu, menuProbability, random });
  if (type === "menu") {
    const drawn = drawShuffleBag({
      ids: normalizedMenus.map((menu) => menu.id),
      bag: menuBag,
      lastId: lastMenuId,
      random,
    });
    return {
      type,
      item: normalizedMenus.find((menu) => menu.id === drawn.value),
      menuBag: drawn.bag,
      effectBag: normalizeBag(effectBag, EFFECT_IDS, "effectBag"),
      forceMenuNext: false,
    };
  }
  const drawn = drawShuffleBag({
    ids: EFFECT_IDS,
    bag: effectBag,
    lastId: lastEffectId,
    random,
  });
  return {
    type,
    item: EFFECT_BY_ID.get(drawn.value),
    menuBag: normalizeBag(menuBag, normalizedMenus.map((menu) => menu.id), "menuBag"),
    effectBag: drawn.bag,
    forceMenuNext: true,
  };
}

export function drawCount(
  unitId = "reps",
  intensity = "standard",
  random = Math.random,
  { allOut = false } = {},
) {
  const candidates = countCandidates(unitId, intensity, { allOut });
  const index = Math.floor(randomUnit(random) * candidates.length);
  return { value: candidates[index], index, candidates };
}

export function applyEffect({
  baseBpm = BASE_BPM,
  effectId,
  maximumBpm = MAX_BPM,
} = {}) {
  const effect = EFFECT_BY_ID.get(String(effectId ?? ""));
  if (!effect) throw new RangeError("effectId is unknown");
  const maximum = normalizeBpm(maximumBpm, MAX_BPM, MAX_BPM);
  const before = normalizeBpm(baseBpm, BASE_BPM, maximum);
  if (effect.kind === "count_override") {
    return {
      effect,
      baseBpm: before,
      workoutBpm: before,
      temporary: false,
      durationMs: 0,
      changed: true,
      allOutCount: true,
    };
  }
  if (effect.kind === "persistent") {
    const after = normalizeBpm(before + effect.delta, before, maximum);
    return {
      effect,
      baseBpm: after,
      workoutBpm: after,
      temporary: false,
      durationMs: 0,
      changed: after !== before,
      allOutCount: false,
    };
  }
  const workoutBpm = normalizeBpm(before * effect.multiplier, before, maximum);
  return {
    effect,
    baseBpm: before,
    workoutBpm,
    temporary: true,
    durationMs: effect.durationMs,
    changed: workoutBpm !== before,
    allOutCount: false,
  };
}

function normalizeImages(imageIds) {
  if (!Array.isArray(imageIds) || imageIds.length < 1 || imageIds.length > IMAGE_MAX_COUNT) {
    throw new RangeError(`imageIds must contain 1-${IMAGE_MAX_COUNT} ids`);
  }
  const normalized = imageIds.map((image, index) => normalizedId(
    image && typeof image === "object" ? image.id : image,
    `imageIds[${index}]`,
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError("imageIds must be unique");
  }
  return normalized;
}

function normalizeIntensity(value) {
  return INTENSITY_IDS.has(value) ? value : "standard";
}

function normalizeNow(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : fallback;
}

export function createRouletteTrainingSession({
  sessionId,
  pack = FREE_PACK,
  menus,
  imageIds,
  intensity = "standard",
  baseBpm = BASE_BPM,
  maximumBpm = MAX_BPM,
  menuProbability = MENU_PROBABILITY,
  targetRounds = DEFAULT_TARGET_ROUNDS,
  now = 0,
} = {}) {
  const normalizedPack = normalizePack(menus ? {
    id: pack?.id ?? "session-pack",
    revision: pack?.revision ?? 1,
    sellerName: pack?.sellerName ?? "",
    title: pack?.title ?? "トレーニングメニュー",
    description: pack?.description ?? "",
    price: pack?.price ?? 0,
    builtin: pack?.builtin === true,
    items: menus,
  } : pack);
  const probability = Number(menuProbability);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("menuProbability must be from 0 through 1");
  }
  const normalizedMaximum = normalizeBpm(maximumBpm, MAX_BPM, MAX_BPM);
  const createdAt = normalizeNow(now);
  return {
    schemaVersion: ROULETTE_TRAINING_SCHEMA_VERSION,
    sessionId: normalizedId(sessionId, "sessionId"),
    phase: "roulette",
    revision: 0,
    createdAt,
    updatedAt: createdAt,
    config: {
      pack: normalizedPack,
      imageIds: normalizeImages(imageIds),
      intensity: normalizeIntensity(intensity),
      maximumBpm: normalizedMaximum,
      menuProbability: probability,
      targetRounds: normalizedInteger(targetRounds, DEFAULT_TARGET_ROUNDS, {
        minimum: 1,
        maximum: 100,
      }),
    },
    persistentBpm: normalizeBpm(baseBpm, BASE_BPM, normalizedMaximum),
    forceMenuNext: false,
    menuBag: [],
    effectBag: [],
    imageBag: [],
    lastMenuId: "",
    lastEffectId: "",
    lastImageId: "",
    pendingEffect: null,
    pendingAllOutCount: false,
    activeEffect: null,
    currentRound: null,
    history: [],
    stats: {
      clearedRounds: 0,
      givenUpRounds: 0,
    },
    result: null,
    lastOutcome: null,
    lastAction: null,
  };
}

export const createRouletteTrainingState = createRouletteTrainingSession;

function validateRound(round, state) {
  if (round == null) return;
  if (!round || typeof round !== "object" || Array.isArray(round)) {
    throw new TypeError("currentRound must be an object or null");
  }
  const menus = state.config.pack.items;
  const menu = menus.find((candidate) => candidate.id === round.menuId);
  if (!menu) {
    throw new RangeError("currentRound references an unknown menu");
  }
  if (!state.config.imageIds.includes(round.imageId)) {
    throw new RangeError("currentRound references an unknown image");
  }
  if (round.count != null && (!Number.isInteger(round.count) || round.count < 1)) {
    throw new RangeError("currentRound.count is invalid");
  }
  if (round.countUnit !== menu.countUnit) {
    throw new RangeError("currentRound count unit does not match its menu");
  }
  if (round.menuText !== menu.menuText || round.detailText !== menu.detailText) {
    throw new RangeError("currentRound text does not match its fixed menu snapshot");
  }
  if (round.cheerLine && !menu.cheerLines.includes(round.cheerLine)) {
    throw new RangeError("currentRound cheer line does not match its fixed menu snapshot");
  }
  if (round.allOutCount != null && typeof round.allOutCount !== "boolean") {
    throw new TypeError("currentRound.allOutCount must be boolean");
  }
  const currentCandidates = countCandidates(
    round.countUnit,
    state.config.intensity,
    { allOut: round.allOutCount === true },
  );
  const legacyCandidates = LEGACY_COUNT_CANDIDATES[state.config.intensity][round.countUnit];
  const persistedCandidates = round.countCandidates;
  const currentSnapshot = Array.isArray(persistedCandidates)
    && JSON.stringify(persistedCandidates) === JSON.stringify(currentCandidates);
  const compatibleLegacySnapshot = round.allOutCount !== true
    && Array.isArray(persistedCandidates)
    && JSON.stringify(persistedCandidates) === JSON.stringify(legacyCandidates);
  if (persistedCandidates != null && !currentSnapshot && !compatibleLegacySnapshot) {
    throw new RangeError("currentRound count candidate snapshot is invalid");
  }
  if (round.count != null
      && !currentCandidates.includes(round.count)
      && !(compatibleLegacySnapshot && persistedCandidates.includes(round.count))) {
    throw new RangeError("currentRound count is outside its fixed roulette candidates");
  }
}

export function validateRouletteTrainingState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("roulette training state must be an object");
  }
  if (state.schemaVersion !== ROULETTE_TRAINING_SCHEMA_VERSION) {
    throw new RangeError("roulette training state schema is unsupported");
  }
  normalizedId(state.sessionId, "sessionId");
  if (!PHASE_IDS.has(state.phase)) throw new RangeError("roulette training phase is invalid");
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    throw new RangeError("roulette training revision is invalid");
  }
  const pack = normalizePack(state.config?.pack);
  const imageIds = normalizeImages(state.config?.imageIds);
  if (JSON.stringify(pack) !== JSON.stringify(state.config.pack)) {
    throw new RangeError("roulette training pack snapshot is not canonical");
  }
  if (JSON.stringify(imageIds) !== JSON.stringify(state.config.imageIds)) {
    throw new RangeError("roulette training image snapshot is not canonical");
  }
  if (!INTENSITY_IDS.has(state.config?.intensity)) {
    throw new RangeError("roulette training intensity is invalid");
  }
  if (!Number.isFinite(state.config?.menuProbability)
      || state.config.menuProbability < 0
      || state.config.menuProbability > 1) {
    throw new RangeError("roulette training menuProbability is invalid");
  }
  if (!Number.isInteger(state.config?.targetRounds)
      || state.config.targetRounds < 1
      || state.config.targetRounds > 100) {
    throw new RangeError("roulette training targetRounds is invalid");
  }
  normalizeBag(state.menuBag, pack.items.map((menu) => menu.id), "menuBag");
  normalizeBag(state.effectBag, EFFECT_IDS, "effectBag");
  normalizeBag(state.imageBag, imageIds, "imageBag");
  if (state.lastMenuId && !pack.items.some((menu) => menu.id === state.lastMenuId)) {
    throw new RangeError("lastMenuId is invalid");
  }
  if (state.lastEffectId && !EFFECT_BY_ID.has(state.lastEffectId)) {
    throw new RangeError("lastEffectId is invalid");
  }
  if (state.lastImageId && !imageIds.includes(state.lastImageId)) {
    throw new RangeError("lastImageId is invalid");
  }
  const maximumBpm = normalizeBpm(state.config?.maximumBpm, MAX_BPM, MAX_BPM);
  if (maximumBpm !== state.config.maximumBpm) {
    throw new RangeError("maximumBpm is invalid");
  }
  if (normalizeBpm(state.persistentBpm, BASE_BPM, maximumBpm) !== state.persistentBpm) {
    throw new RangeError("persistentBpm is invalid");
  }
  if (!Array.isArray(state.history)) throw new TypeError("history must be an array");
  for (const round of state.history) validateRound(round, state);
  validateRound(state.currentRound, state);
  const roundRequired = ["menu_result", "ready", "training", "paused"].includes(state.phase);
  if (roundRequired !== Boolean(state.currentRound)) {
    throw new RangeError("roulette training phase and currentRound do not match");
  }
  if (state.phase === "menu_result" && state.currentRound.count !== null) {
    throw new RangeError("menu_result cannot already contain a count result");
  }
  if (["ready", "training", "paused"].includes(state.phase)
      && state.currentRound.count === null) {
    throw new RangeError("this phase requires a fixed count result");
  }
  if (state.forceMenuNext !== true && state.forceMenuNext !== false) {
    throw new TypeError("forceMenuNext must be boolean");
  }
  if (state.pendingAllOutCount != null && typeof state.pendingAllOutCount !== "boolean") {
    throw new TypeError("pendingAllOutCount must be boolean");
  }
  if (state.pendingAllOutCount === true
      && !["effect_result", "roulette"].includes(state.phase)) {
    throw new RangeError("pendingAllOutCount is invalid for this phase");
  }
  if (state.pendingAllOutCount === true
      && (state.lastEffectId !== "all_out_time" || state.forceMenuNext !== true)) {
    throw new RangeError("pendingAllOutCount does not match the decided main effect");
  }
  if (state.pendingEffect && !EFFECT_BY_ID.has(state.pendingEffect.effectId)) {
    throw new RangeError("pendingEffect is invalid");
  }
  if (state.activeEffect && !EFFECT_BY_ID.has(state.activeEffect.effectId)) {
    throw new RangeError("activeEffect is invalid");
  }
  if (state.pendingEffect && state.activeEffect) {
    throw new RangeError("temporary roulette effects cannot stack");
  }
  if (state.pendingEffect
      && !["effect_result", "roulette", "menu_result", "ready"].includes(state.phase)) {
    throw new RangeError("pendingEffect is invalid for this phase");
  }
  if (state.activeEffect && !["training", "paused"].includes(state.phase)) {
    throw new RangeError("activeEffect is invalid for this phase");
  }
  for (const temporaryEffect of [state.pendingEffect, state.activeEffect].filter(Boolean)) {
    const definition = EFFECT_BY_ID.get(temporaryEffect.effectId);
    if (definition.kind !== "temporary"
        || temporaryEffect.durationMs !== TEMP_EFFECT_MS
        || normalizeBpm(
          temporaryEffect.workoutBpm,
          state.persistentBpm,
          state.config.maximumBpm,
        ) !== temporaryEffect.workoutBpm) {
      throw new RangeError("temporary roulette effect snapshot is invalid");
    }
  }
  const clearedRounds = state.history.filter((round) => round.status === "clear").length;
  const givenUpRounds = state.history.filter((round) => round.status === "give_up").length;
  if (state.stats?.clearedRounds !== clearedRounds
      || state.stats?.givenUpRounds !== givenUpRounds) {
    throw new RangeError("roulette training self-report totals do not match history");
  }
  if (state.lastAction != null) {
    if (!state.lastAction
        || typeof state.lastAction !== "object"
        || !state.lastAction.id
        || state.lastAction.revision !== state.revision) {
      throw new RangeError("roulette training lastAction is invalid");
    }
  }
  const terminal = state.phase === "result" || state.phase === "ended";
  if (terminal !== Boolean(state.result)) {
    throw new RangeError("roulette training phase and result do not match");
  }
  if (state.phase === "result" && state.result.finalized === true) {
    throw new RangeError("result cannot be finalized before finish");
  }
  if (state.phase === "ended" && state.result.finalized !== true) {
    throw new RangeError("ended requires a finalized result");
  }
  return true;
}

function eventEnvelope(state, event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("event must be an object");
  }
  const actionId = normalizedId(event.actionId, "event.actionId");
  if (state.lastAction?.id === actionId) {
    if (state.lastAction.type !== event.type) {
      throw new RangeError("roulette training action id was reused for another event type");
    }
    return { replay: true, actionId };
  }
  if (!Number.isInteger(event.expectedRevision) || event.expectedRevision !== state.revision) {
    throw new RangeError("stale roulette training event revision");
  }
  return {
    replay: false,
    actionId,
    now: Math.max(state.updatedAt, normalizeNow(event.now, state.updatedAt)),
  };
}

function requirePhase(state, ...allowed) {
  if (!allowed.includes(state.phase)) {
    throw new RangeError(`event is not allowed during ${state.phase}`);
  }
}

function committed(previous, next, event, envelope) {
  next.revision = previous.revision + 1;
  next.updatedAt = Math.max(previous.updatedAt, envelope.now);
  next.lastAction = {
    id: envelope.actionId,
    type: event.type,
    from: previous.phase,
    to: next.phase,
    revision: next.revision,
  };
  validateRouletteTrainingState(next);
  return next;
}

function chooseCheerLine(menu, random) {
  if (!menu.cheerLines.length) return "";
  return menu.cheerLines[Math.floor(randomUnit(random) * menu.cheerLines.length)];
}

function spinTransition(state, random, now) {
  requirePhase(state, "roulette");
  const next = cloneJson(state);
  const draw = drawMain({
    menus: next.config.pack.items,
    menuBag: next.menuBag,
    effectBag: next.effectBag,
    forceMenu: next.forceMenuNext,
    menuProbability: next.config.menuProbability,
    random,
    lastMenuId: next.lastMenuId,
    lastEffectId: next.lastEffectId,
  });
  next.menuBag = draw.menuBag;
  next.effectBag = draw.effectBag;
  next.forceMenuNext = draw.forceMenuNext;
  if (draw.type === "effect") {
    const applied = applyEffect({
      baseBpm: next.persistentBpm,
      effectId: draw.item.id,
      maximumBpm: next.config.maximumBpm,
    });
    next.persistentBpm = applied.baseBpm;
    next.lastEffectId = draw.item.id;
    next.pendingAllOutCount = applied.allOutCount === true;
    next.pendingEffect = applied.temporary ? {
      effectId: draw.item.id,
      workoutBpm: applied.workoutBpm,
      durationMs: applied.durationMs,
    } : null;
    next.phase = "effect_result";
    next.lastOutcome = {
      type: "effect",
      effectId: draw.item.id,
      baseBpm: applied.baseBpm,
      workoutBpm: applied.workoutBpm,
      temporary: applied.temporary,
      changed: applied.changed,
    };
    return next;
  }

  const imageDraw = drawShuffleBag({
    ids: next.config.imageIds,
    bag: next.imageBag,
    lastId: next.lastImageId,
    random,
  });
  const cheerLine = chooseCheerLine(draw.item, random);
  next.imageBag = imageDraw.bag;
  next.lastMenuId = draw.item.id;
  next.lastImageId = imageDraw.value;
  next.phase = "menu_result";
  next.currentRound = {
    sequence: next.history.length + 1,
    menuId: draw.item.id,
    menuText: draw.item.menuText,
    detailText: draw.item.detailText,
    cheerLine,
    countUnit: draw.item.countUnit,
    allOutCount: next.pendingAllOutCount === true,
    imageId: imageDraw.value,
    count: null,
    status: "menu_selected",
    selectedAt: now,
    startedAt: null,
    completedAt: null,
  };
  next.pendingAllOutCount = false;
  next.lastOutcome = {
    type: "menu",
    menuId: draw.item.id,
    imageId: imageDraw.value,
    cheerLine,
  };
  return next;
}

function continueAfterEffectTransition(state) {
  requirePhase(state, "effect_result");
  const next = cloneJson(state);
  next.phase = "roulette";
  return next;
}

function spinCountTransition(state, random) {
  requirePhase(state, "menu_result");
  const next = cloneJson(state);
  const count = drawCount(
    next.currentRound.countUnit,
    next.config.intensity,
    random,
    { allOut: next.currentRound.allOutCount === true },
  );
  next.currentRound.count = count.value;
  next.currentRound.countCandidates = count.candidates;
  next.currentRound.status = "ready";
  next.phase = "ready";
  next.lastOutcome = {
    type: "count",
    value: count.value,
    unit: next.currentRound.countUnit,
  };
  return next;
}

function startTransition(state, now, fromPause = false) {
  requirePhase(state, fromPause ? "paused" : "ready");
  const next = cloneJson(state);
  if (fromPause) {
    const remainingMs = Math.max(0, Number(next.activeEffect?.remainingMs) || 0);
    next.activeEffect = remainingMs > 0 ? {
      effectId: next.activeEffect.effectId,
      workoutBpm: next.activeEffect.workoutBpm,
      durationMs: next.activeEffect.durationMs,
      startedAt: now,
      endsAt: now + remainingMs,
    } : null;
  } else {
    next.activeEffect = next.pendingEffect ? {
      ...next.pendingEffect,
      startedAt: now,
      endsAt: now + next.pendingEffect.durationMs,
    } : null;
    next.pendingEffect = null;
    next.currentRound.startedAt = now;
  }
  next.currentRound.status = "training";
  next.phase = "training";
  next.lastOutcome = {
    type: fromPause ? "resumed" : "started",
    workoutBpm: next.activeEffect?.workoutBpm ?? next.persistentBpm,
  };
  return next;
}

function clearTransition(state, now) {
  requirePhase(state, "training");
  const next = cloneJson(state);
  const completed = {
    ...next.currentRound,
    status: "clear",
    completedAt: now,
  };
  next.history.push(completed);
  next.stats.clearedRounds += 1;
  next.currentRound = null;
  next.pendingEffect = null;
  next.pendingAllOutCount = false;
  next.activeEffect = null;
  next.phase = "rest";
  next.lastOutcome = {
    type: "round_result",
    result: "clear",
    sequence: completed.sequence,
  };
  return next;
}

function nextRouletteTransition(state) {
  requirePhase(state, "rest");
  const next = cloneJson(state);
  next.phase = "roulette";
  next.lastOutcome = null;
  return next;
}

function giveUpTransition(state, now) {
  requirePhase(
    state,
    "roulette",
    "effect_result",
    "menu_result",
    "ready",
    "training",
    "paused",
    "rest",
  );
  const next = cloneJson(state);
  if (next.currentRound) {
    const abandoned = {
      ...next.currentRound,
      status: "give_up",
      completedAt: now,
    };
    next.history.push(abandoned);
    next.stats.givenUpRounds += 1;
  }
  next.currentRound = null;
  next.pendingEffect = null;
  next.pendingAllOutCount = false;
  next.activeEffect = null;
  next.forceMenuNext = false;
  next.phase = "result";
  next.result = resultSummary({
    ...next,
    result: { outcome: "give_up", shownAt: now, finalized: false },
  });
  next.lastOutcome = { type: "session_result", outcome: "give_up" };
  return next;
}

function showResultTransition(state, now) {
  requirePhase(state, "roulette", "rest");
  const next = cloneJson(state);
  next.pendingEffect = null;
  next.pendingAllOutCount = false;
  next.activeEffect = null;
  next.forceMenuNext = false;
  next.phase = "result";
  next.result = resultSummary({
    ...next,
    result: { outcome: "finished", shownAt: now, finalized: false },
  });
  next.lastOutcome = { type: "session_result", outcome: "finished" };
  return next;
}

function finishTransition(state, now) {
  requirePhase(state, "result");
  const next = cloneJson(state);
  next.phase = "ended";
  next.result = {
    ...resultSummary(next),
    finalized: true,
    endedAt: now,
  };
  next.lastOutcome = { type: "session_finished", outcome: next.result.outcome };
  return next;
}

export function transitionRouletteTraining(state, event, { random = Math.random } = {}) {
  validateRouletteTrainingState(state);
  const envelope = eventEnvelope(state, event);
  if (envelope.replay) return state;
  let next;
  switch (event.type) {
    case "spin":
      next = spinTransition(state, random, envelope.now);
      break;
    case "continue_after_effect":
      next = continueAfterEffectTransition(state);
      break;
    case "spin_count":
      next = spinCountTransition(state, random);
      break;
    case "start":
      next = startTransition(state, envelope.now, false);
      break;
    case "resume":
      next = startTransition(state, envelope.now, true);
      break;
    case "clear":
      next = clearTransition(state, envelope.now);
      break;
    case "next_roulette":
      next = nextRouletteTransition(state);
      break;
    case "give_up":
      next = giveUpTransition(state, envelope.now);
      break;
    case "show_result":
      next = showResultTransition(state, envelope.now);
      break;
    case "finish":
      next = finishTransition(state, envelope.now);
      break;
    default:
      throw new RangeError("roulette training event type is unknown");
  }
  return committed(state, next, event, envelope);
}

export function rouletteTrainingTempo(state, now = state?.updatedAt ?? 0) {
  validateRouletteTrainingState(state);
  const active = state.phase === "training" ? state.activeEffect : null;
  const currentTime = normalizeNow(now, state.updatedAt);
  const temporaryActive = Boolean(active && currentTime < active.endsAt);
  return {
    baseBpm: state.persistentBpm,
    workoutBpm: temporaryActive ? active.workoutBpm : state.persistentBpm,
    metronomeBpm: state.phase === "training"
      ? (temporaryActive ? active.workoutBpm : state.persistentBpm)
      : 0,
    temporary: temporaryActive,
    remainingMs: temporaryActive ? active.endsAt - currentTime : 0,
  };
}

export function rouletteTrainingTargetReached(state) {
  validateRouletteTrainingState(state);
  return state.stats.clearedRounds >= state.config.targetRounds;
}

export function resultSummary(value = {}) {
  if (Object.hasOwn(value, "completedCount")
      || Object.hasOwn(value, "finishReason")
      || Object.hasOwn(value, "startedAt")
      || Object.hasOwn(value, "finishedAt")) {
    const startedAt = normalizeNow(value.startedAt);
    const finishedAt = Math.max(startedAt, normalizeNow(value.finishedAt, startedAt));
    const startBpm = normalizeBpm(value.startBpm, BASE_BPM);
    const finalBpm = normalizeBpm(value.finalBpm, startBpm);
    const maximumReachedBpm = Math.max(
      startBpm,
      finalBpm,
      normalizeBpm(value.maximumReachedBpm, Math.max(startBpm, finalBpm)),
    );
    return {
      completedCount: normalizedInteger(value.completedCount, 0, {
        minimum: 0,
        maximum: 100_000,
      }),
      activeMs: Math.max(0, finishedAt - startedAt),
      startedAt,
      finishedAt,
      startBpm,
      finalBpm,
      maximumReachedBpm,
      finishReason: value.finishReason === "give_up" ? "give_up" : "completed",
      lastChallenge: value.lastChallenge && typeof value.lastChallenge === "object"
        ? cloneJson(value.lastChallenge)
        : null,
    };
  }
  const history = Array.isArray(value.history) ? value.history : [];
  const cleared = history.filter((round) => round?.status === "clear");
  const givenUp = history.filter((round) => round?.status === "give_up");
  const existing = value.result && typeof value.result === "object" ? value.result : {};
  const totalsByUnit = Object.fromEntries(UNITS.map((unit) => [unit.id, 0]));
  for (const round of cleared) {
    if (UNIT_IDS.has(round.countUnit)) {
      totalsByUnit[round.countUnit] += Number(round.count) || 0;
    }
  }
  return {
    outcome: existing.outcome ?? value.outcome ?? "finished",
    clearedRounds: cleared.length,
    givenUpRounds: givenUp.length,
    totalReps: totalsByUnit.reps,
    totalSeconds: totalsByUnit.seconds,
    totalRoundTrips: totalsByUnit.round_trips,
    totalSets: totalsByUnit.sets,
    totalsByUnit,
    shownAt: existing.shownAt ?? null,
    finalized: existing.finalized === true,
    endedAt: existing.endedAt ?? null,
  };
}

export function serializeRouletteTrainingState(state) {
  validateRouletteTrainingState(state);
  return JSON.stringify(state);
}

export function restoreRouletteTrainingState(snapshot, { now } = {}) {
  let state;
  try {
    state = typeof snapshot === "string" ? JSON.parse(snapshot) : cloneJson(snapshot);
  } catch {
    throw new TypeError("roulette training snapshot is not valid JSON");
  }
  validateRouletteTrainingState(state);
  if (state.phase !== "training") return state;

  const restoredAt = Math.max(state.updatedAt, normalizeNow(now, state.updatedAt));
  const remainingMs = state.activeEffect
    ? Math.max(0, state.activeEffect.endsAt - restoredAt)
    : 0;
  state.phase = "paused";
  state.revision += 1;
  state.updatedAt = Math.max(state.updatedAt, restoredAt);
  state.activeEffect = remainingMs > 0 ? {
    effectId: state.activeEffect.effectId,
    workoutBpm: state.activeEffect.workoutBpm,
    durationMs: state.activeEffect.durationMs,
    remainingMs,
  } : null;
  state.currentRound.status = "paused";
  state.lastAction = {
    id: `recovery:${state.sessionId}:${state.revision}`,
    type: "recover",
    from: "training",
    to: "paused",
    revision: state.revision,
  };
  validateRouletteTrainingState(state);
  return state;
}
