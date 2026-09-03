"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const coreUrl = pathToFileURL(
  path.resolve(__dirname, "..", "..", "roulette-training-core.mjs"),
).href;
const coreModule = import(coreUrl);

function menu(id, overrides = {}) {
  return {
    id,
    menuText: `${id} トレーニング`,
    detailText: "痛みのない範囲で行います。",
    countUnit: "reps",
    cheerLines: [`${id}、あと100回と言っても正式回数ではないよ`],
    ...overrides,
  };
}

function pack(items) {
  return {
    id: "test-pack",
    revision: 1,
    sellerName: "テスト作者",
    title: "テストメニュー",
    description: "テスト用",
    price: 0,
    builtin: false,
    items,
  };
}

function event(state, type, actionId, now = state.updatedAt + 1) {
  return {
    type,
    actionId,
    expectedRevision: state.revision,
    now,
  };
}

function sequenceRandom(values, fallback = 0) {
  let index = 0;
  const random = () => {
    const value = index < values.length ? values[index] : fallback;
    index += 1;
    return value;
  };
  random.calls = () => index;
  return random;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createSession(core, overrides = {}) {
  return core.createRouletteTrainingSession({
    sessionId: "session-a",
    pack: pack([menu("menu-a"), menu("menu-b")]),
    imageIds: ["image-a", "image-b"],
    now: 1_000,
    ...overrides,
  });
}

function reachTraining(core, state, prefix = "flow", random = () => 0) {
  let next = core.transitionRouletteTraining(
    state,
    event(state, "spin", `${prefix}-spin`),
    { random },
  );
  assert.equal(next.phase, "menu_result");
  next = core.transitionRouletteTraining(
    next,
    event(next, "spin_count", `${prefix}-count`),
    { random },
  );
  next = core.transitionRouletteTraining(
    next,
    event(next, "start", `${prefix}-start`, 2_000),
    { random },
  );
  assert.equal(next.phase, "training");
  return next;
}

test("roulette defaults keep the agreed BPM, probability, effects, units, and bounded counts", async () => {
  const core = await coreModule;

  assert.equal(core.BASE_BPM, 60);
  assert.equal(core.MIN_BPM, 40);
  assert.equal(core.MAX_BPM, 100);
  assert.equal(core.BPM_STEP, 5);
  assert.equal(core.BPM_DOUBLE_STEP, 10);
  assert.equal(core.TEMP_EFFECT_MS, 20_000);
  assert.equal(core.MENU_PROBABILITY, 0.65);
  assert.equal(core.EFFECT_PROBABILITY, 0.35);
  assert.equal(core.EFFECTS.length, 7);
  assert.deepEqual(
    core.EFFECTS.find((effect) => effect.id === "all_out_time"),
    {
      id: "all_out_time",
      label: "おーるあうとたいむ♡",
      kind: "count_override",
      delta: null,
      multiplier: null,
      durationMs: 0,
      allOutCount: true,
    },
  );
  assert.deepEqual(core.UNITS.map((unit) => unit.id), [
    "reps",
    "seconds",
    "round_trips",
    "sets",
  ]);
  const standardCounts = [10, 20, 25, 30, 35, 40, 50];
  for (const unit of core.UNITS) {
    assert.deepEqual(core.countCandidates(unit.id, "light"), standardCounts);
    assert.deepEqual(core.countCandidates(unit.id, "standard"), standardCounts);
  }
  assert.deepEqual(
    core.countCandidates("reps", "standard", { allOut: true }),
    [100, 100, 100, 100, 100, 100, 100],
  );
});

test("pack normalization keeps menu and cheer as free text but never derives the count from either", async () => {
  const core = await coreModule;
  const normalized = core.normalizePack(pack([
    menu("numeric-copy", {
      menuText: "スクワットを30回",
      cheerLines: ["100回いける！", "あと999回！"],
    }),
  ]));

  assert.equal(normalized.items[0].menuText, "スクワットを30回");
  assert.deepEqual(normalized.items[0].cheerLines, ["100回いける!", "あと999回!"], "client text uses the same NFKC form as publication validation");
  const emojiCheer = "😀".repeat(31);
  assert.equal(core.normalizePack(pack([
    menu("emoji-cheer", { cheerLines: [emojiCheer] }),
  ])).items[0].cheerLines[0], emojiCheer);
  assert.equal(core.normalizePack(pack([
    menu("nfkc-cheer", { cheerLines: ["㍍".repeat(15)] }),
  ])).items[0].cheerLines[0], "メートル".repeat(15));
  assert.throws(
    () => core.normalizePack(pack([menu("long-emoji-cheer", { cheerLines: ["😀".repeat(61)] })])),
    /at most 60/,
  );
  assert.throws(
    () => core.normalizePack(pack([menu("expanded-cheer", { cheerLines: ["㍍".repeat(16)] })])),
    /at most 60/,
  );
  assert.deepEqual(core.drawCount("reps", "light", () => 0.999).candidates, [10, 20, 25, 30, 35, 40, 50]);
  assert.equal(core.drawCount("reps", "light", () => 0.999).value, 50);

  assert.throws(
    () => core.normalizePack(pack(Array.from({ length: 11 }, (_, index) => menu(`m-${index}`)))),
    /1-10/,
  );
  assert.throws(
    () => core.normalizePack(pack([menu("same"), menu("same")])),
    /unique/,
  );
  assert.throws(
    () => core.normalizePack(pack([menu("no-cheer", { cheerLines: [] })])),
    /1-4/,
  );
  assert.throws(
    () => core.normalizePack(pack([menu("long-detail", { detailText: "長".repeat(121) })])),
    /at most 120/,
  );
  assert.throws(
    () => core.normalizePack({ ...pack([menu("long-description")]), description: "長".repeat(121) }),
    /at most 120/,
  );
  assert.equal(core.normalizePack({ ...pack([]) }, { allowEmptyItems: true }).items.length, 0);

  const serverPack = core.normalizePack({
    packId: "server-pack-id",
    revision: 2,
    sellerName: "作者",
    title: "サーバーパック",
    description: "購入時に固定されたパックです。",
    price: 10,
    items: [{
      menuText: "その場足踏み",
      detailText: "",
      countUnit: "round_trips",
      cheerLines: ["自分のペースでいこう"],
    }],
  });
  assert.equal(serverPack.id, "server-pack-id");
  assert.equal(serverPack.items[0].id, "menu-1");
  assert.equal(serverPack.items[0].countUnit, "round_trips");
});

test("the 65/35 category probability does not change when active menu count changes", async () => {
  const core = await coreModule;

  for (const menuCount of [1, 10]) {
    const menus = Array.from({ length: menuCount }, (_, index) => menu(`menu-${index}`));
    const random = seededRandom(91 + menuCount);
    let menuBag = [];
    let effectBag = [];
    let lastMenuId = "";
    let lastEffectId = "";
    let menuHits = 0;
    const itemHits = new Map(menus.map((item) => [item.id, 0]));

    for (let index = 0; index < 50_000; index += 1) {
      const draw = core.drawMain({
        menus,
        menuBag,
        effectBag,
        random,
        lastMenuId,
        lastEffectId,
      });
      menuBag = draw.menuBag;
      effectBag = draw.effectBag;
      if (draw.type === "menu") {
        menuHits += 1;
        lastMenuId = draw.item.id;
        itemHits.set(draw.item.id, itemHits.get(draw.item.id) + 1);
      } else {
        lastEffectId = draw.item.id;
      }
    }

    assert.ok(Math.abs((menuHits / 50_000) - 0.65) < 0.012);
    const itemCounts = [...itemHits.values()];
    assert.ok(Math.max(...itemCounts) - Math.min(...itemCounts) <= 1);
  }
});

test("shuffle bags exhaust every menu, effect, and image before repeating and avoid a cycle-boundary repeat", async () => {
  const core = await coreModule;
  const ids = ["a", "b", "c"];
  let bag = [];
  let lastId = "";
  const values = [];

  for (let index = 0; index < 6; index += 1) {
    const drawn = core.drawShuffleBag({ ids, bag, lastId, random: () => 0 });
    values.push(drawn.value);
    bag = drawn.bag;
    lastId = drawn.value;
  }

  assert.equal(new Set(values.slice(0, 3)).size, 3);
  assert.equal(new Set(values.slice(3, 6)).size, 3);
  assert.notEqual(values[2], values[3]);

  const one = core.drawShuffleBag({ ids: ["only"], bag: [], lastId: "only", random: () => 0 });
  assert.equal(one.value, "only");

  let effectBag = [];
  let lastEffectId = "";
  const effectValues = [];
  const random = seededRandom(402);
  for (let index = 0; index < core.EFFECTS.length + 1; index += 1) {
    const drawn = core.drawMain({
      menus: [menu("only-menu")],
      effectBag,
      menuProbability: 0,
      lastEffectId,
      random,
    });
    assert.equal(drawn.type, "effect");
    effectValues.push(drawn.item.id);
    effectBag = drawn.effectBag;
    lastEffectId = drawn.item.id;
  }
  assert.equal(new Set(effectValues.slice(0, core.EFFECTS.length)).size, core.EFFECTS.length);
  assert.notEqual(effectValues.at(-2), effectValues.at(-1));
});

test("an effect always forces the next main draw to be a menu instead of chaining effects", async () => {
  const core = await coreModule;
  const menus = [menu("only-menu")];
  const effectDraw = core.drawMain({
    menus,
    effectBag: ["tempo_up"],
    menuProbability: 0,
    random: () => 0.5,
  });

  assert.equal(effectDraw.type, "effect");
  assert.equal(effectDraw.item.id, "tempo_up");
  assert.equal(effectDraw.forceMenuNext, true);

  const noCategoryRandom = () => {
    throw new Error("forced menu must not draw another category");
  };
  const forced = core.drawMain({
    menus,
    menuBag: effectDraw.menuBag,
    effectBag: effectDraw.effectBag,
    forceMenu: effectDraw.forceMenuNext,
    menuProbability: 0,
    random: noCategoryRandom,
  });
  assert.equal(forced.type, "menu");
  assert.equal(forced.item.id, "only-menu");
  assert.equal(forced.forceMenuNext, false);
});

test("persistent and one-menu temporary effects use the agreed clamping and five-BPM rounding", async () => {
  const core = await coreModule;

  assert.equal(core.applyEffect({ baseBpm: 60, effectId: "tempo_up" }).baseBpm, 65);
  assert.equal(core.applyEffect({ baseBpm: 60, effectId: "tempo_down" }).baseBpm, 55);
  assert.equal(core.applyEffect({ baseBpm: 60, effectId: "tempo_up_2" }).baseBpm, 70);
  assert.equal(core.applyEffect({ baseBpm: 60, effectId: "tempo_down_2" }).baseBpm, 50);

  const fever = core.applyEffect({ baseBpm: 60, effectId: "fever" });
  assert.deepEqual({
    baseBpm: fever.baseBpm,
    workoutBpm: fever.workoutBpm,
    temporary: fever.temporary,
    durationMs: fever.durationMs,
  }, {
    baseBpm: 60,
    workoutBpm: 80,
    temporary: true,
    durationMs: 20_000,
  });

  const slow = core.applyEffect({ baseBpm: 60, effectId: "slow" });
  assert.equal(slow.baseBpm, 60);
  assert.equal(slow.workoutBpm, 40);
  assert.equal(core.applyEffect({ baseBpm: 100, effectId: "tempo_up" }).changed, false);
  assert.equal(core.applyEffect({ baseBpm: 40, effectId: "tempo_down_2" }).changed, false);
  const allOut = core.applyEffect({ baseBpm: 60, effectId: "all_out_time" });
  assert.deepEqual(
    {
      baseBpm: allOut.baseBpm,
      workoutBpm: allOut.workoutBpm,
      temporary: allOut.temporary,
      allOutCount: allOut.allOutCount,
    },
    { baseBpm: 60, workoutBpm: 60, temporary: false, allOutCount: true },
  );
  assert.equal(core.normalizeBpm(78), 80);
  assert.equal(core.normalizeBpm(101), 100);
  assert.equal(core.normalizeBpm(90, { minimum: 40, maximum: 80, fallback: 60 }), 80);
  assert.equal(core.normalizeBpm("invalid", { minimum: 40, maximum: 80, fallback: 55 }), 55);

  for (const unit of core.UNITS) {
    const first = core.drawCount(unit.id, "light", () => 0);
    const last = core.drawCount(unit.id, "standard", () => 0.999999);
    assert.equal(first.value, core.countCandidates(unit.id, "light")[0]);
    assert.equal(last.value, core.countCandidates(unit.id, "standard").at(-1));
  }
});

test("clear records only a self-reported completion, enters rest, and then returns to a fresh roulette", async () => {
  const core = await coreModule;
  assert.ok(core.ROULETTE_TRAINING_TRANSITIONS.some((transition) => (
    transition.from === "training" && transition.event === "clear" && transition.to === "rest"
  )));
  assert.ok(core.ROULETTE_TRAINING_TRANSITIONS.some((transition) => (
    transition.from === "training" && transition.event === "give_up" && transition.to === "result"
  )));
  assert.ok(core.ROULETTE_TRAINING_TRANSITIONS.some((transition) => (
    transition.from === "result" && transition.event === "finish" && transition.to === "ended"
  )));
  const initial = createSession(core, { menuProbability: 1 });
  assert.equal(initial.config.targetRounds, 5);
  const training = reachTraining(core, initial, "clear", () => 0);

  assert.equal(initial.phase, "roulette", "transitions must not mutate their input state");
  assert.equal(training.currentRound.count, 10);
  assert.match(training.currentRound.cheerLine, /100回/);
  assert.equal(training.currentRound.count, 10, "free-text numerals must not override the count draw");
  assert.equal(core.rouletteTrainingTempo(training, 2_001).metronomeBpm, 60);

  const rest = core.transitionRouletteTraining(
    training,
    event(training, "clear", "clear-round", 5_000),
  );
  assert.equal(rest.phase, "rest");
  assert.equal(rest.stats.clearedRounds, 1);
  assert.equal(rest.history[0].status, "clear");
  assert.equal(rest.currentRound, null);
  assert.equal(core.rouletteTrainingTempo(rest, 5_000).metronomeBpm, 0);
  assert.equal("score" in rest.stats, false);
  assert.equal("rate" in rest.stats, false);
  assert.equal("reward" in rest.stats, false);

  const roulette = core.transitionRouletteTraining(
    rest,
    event(rest, "next_roulette", "next-round", 5_001),
  );
  assert.equal(roulette.phase, "roulette");
  assert.equal(roulette.history.length, 1);
});

test("menu and image bags remain independent and do not repeat within their cycles", async () => {
  const core = await coreModule;
  let state = createSession(core, { menuProbability: 1 });
  const firstTraining = reachTraining(core, state, "bag-one", () => 0);
  const firstMenu = firstTraining.currentRound.menuId;
  const firstImage = firstTraining.currentRound.imageId;
  state = core.transitionRouletteTraining(
    firstTraining,
    event(firstTraining, "clear", "bag-clear", 3_000),
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "next_roulette", "bag-next", 3_001),
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "bag-spin-two", 3_002),
    { random: () => 0 },
  );

  assert.notEqual(state.currentRound.menuId, firstMenu);
  assert.notEqual(state.currentRound.imageId, firstImage);
});

test("fever starts with the workout, expires to persistent BPM, and cannot stack before the forced menu", async () => {
  const core = await coreModule;
  let state = createSession(core, {
    pack: pack([menu("only")]),
    imageIds: ["only-image"],
    menuProbability: 0,
  });
  state.effectBag = ["fever"];

  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "fever-spin", 1_100),
    { random: () => 0.9 },
  );
  assert.equal(state.phase, "effect_result");
  assert.equal(state.pendingEffect.effectId, "fever");
  assert.equal(state.forceMenuNext, true);
  assert.throws(
    () => core.transitionRouletteTraining(
      state,
      event(state, "spin", "illegal-second-effect", 1_101),
      { random: () => 0.9 },
    ),
    /not allowed/,
  );

  state = core.transitionRouletteTraining(
    state,
    event(state, "continue_after_effect", "effect-ack", 1_102),
  );
  const forcedRandom = sequenceRandom([0]);
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "forced-menu", 1_103),
    { random: forcedRandom },
  );
  assert.equal(state.phase, "menu_result");
  assert.equal(state.forceMenuNext, false);

  state = core.transitionRouletteTraining(
    state,
    event(state, "spin_count", "fever-count", 1_104),
    { random: () => 0 },
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "start", "fever-start", 2_000),
  );
  assert.equal(core.rouletteTrainingTempo(state, 2_000).metronomeBpm, 80);
  assert.equal(core.rouletteTrainingTempo(state, 21_999).temporary, true);
  assert.deepEqual(core.rouletteTrainingTempo(state, 22_000), {
    baseBpm: 60,
    workoutBpm: 60,
    metronomeBpm: 60,
    temporary: false,
    remainingMs: 0,
  });
});

test("all-out replaces every count slot with 100 for exactly the next menu and survives recovery", async () => {
  const core = await coreModule;
  let state = createSession(core, {
    pack: pack([menu("only")]),
    imageIds: ["only-image"],
    menuProbability: 0,
  });
  state.effectBag = ["all_out_time"];

  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "all-out-spin", 1_100),
    { random: () => 0.9 },
  );
  assert.equal(state.phase, "effect_result");
  assert.equal(state.lastOutcome.effectId, "all_out_time");
  assert.equal(state.pendingAllOutCount, true);
  assert.equal(state.persistentBpm, 60);

  const tampered = JSON.parse(core.serializeRouletteTrainingState(state));
  tampered.lastEffectId = "tempo_up";
  assert.throws(
    () => core.restoreRouletteTrainingState(tampered),
    /does not match the decided main effect/,
  );

  state = core.restoreRouletteTrainingState(core.serializeRouletteTrainingState(state));
  assert.equal(state.pendingAllOutCount, true);
  state = core.transitionRouletteTraining(
    state,
    event(state, "continue_after_effect", "all-out-ack", 1_101),
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "all-out-menu", 1_102),
    { random: () => 0 },
  );
  assert.equal(state.phase, "menu_result");
  assert.equal(state.pendingAllOutCount, false);
  assert.equal(state.currentRound.allOutCount, true);

  state = core.restoreRouletteTrainingState(core.serializeRouletteTrainingState(state));
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin_count", "all-out-count", 1_103),
    { random: () => 0.999999 },
  );
  assert.equal(state.currentRound.count, 100);
  assert.deepEqual(state.currentRound.countCandidates, [100, 100, 100, 100, 100, 100, 100]);
  assert.equal(state.lastOutcome.value, 100);

  state = core.restoreRouletteTrainingState(core.serializeRouletteTrainingState(state));
  state = core.transitionRouletteTraining(
    state,
    event(state, "start", "all-out-start", 2_000),
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "clear", "all-out-clear", 3_000),
  );
  assert.equal(state.history[0].allOutCount, true);
  assert.equal(state.history[0].count, 100);

  state = core.transitionRouletteTraining(
    state,
    event(state, "next_roulette", "ordinary-next", 3_001),
  );
  state = { ...state, config: { ...state.config, menuProbability: 1 } };
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "ordinary-menu", 3_002),
    { random: () => 0 },
  );
  assert.equal(state.currentRound.allOutCount, false);
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin_count", "ordinary-count", 3_003),
    { random: () => 0 },
  );
  assert.equal(state.currentRound.count, 10);
  assert.deepEqual(state.currentRound.countCandidates, [10, 20, 25, 30, 35, 40, 50]);
});

test("give_up stops immediately at result, spin stays locked, and finish alone reaches ended", async () => {
  const core = await coreModule;
  const training = reachTraining(
    core,
    createSession(core, { menuProbability: 1 }),
    "give-up",
    () => 0,
  );

  const result = core.transitionRouletteTraining(
    training,
    event(training, "give_up", "give-up-now", 2_500),
  );
  assert.equal(result.phase, "result");
  assert.equal(result.currentRound, null);
  assert.equal(result.activeEffect, null);
  assert.equal(result.result.outcome, "give_up");
  assert.equal(result.result.givenUpRounds, 1);
  assert.equal(core.rouletteTrainingTempo(result, 2_500).metronomeBpm, 0);
  assert.throws(
    () => core.transitionRouletteTraining(
      result,
      event(result, "spin", "spin-after-give-up", 2_501),
      { random: () => 0 },
    ),
    /not allowed/,
  );

  const finishEvent = event(result, "finish", "finish-result", 3_000);
  const ended = core.transitionRouletteTraining(result, finishEvent);
  assert.equal(ended.phase, "ended");
  assert.equal(ended.result.finalized, true);
  assert.equal(ended.result.endedAt, 3_000);
  assert.strictEqual(
    core.transitionRouletteTraining(ended, finishEvent),
    ended,
    "the same finish action must be idempotent",
  );
  assert.throws(
    () => core.transitionRouletteTraining(ended, { ...finishEvent, type: "spin" }),
    /reused for another event type/,
  );
});

test("a voluntary result is available only from safe idle/rest phases", async () => {
  const core = await coreModule;
  const state = createSession(core);
  const result = core.transitionRouletteTraining(
    state,
    event(state, "show_result", "show-result", 1_100),
  );
  assert.equal(result.phase, "result");
  assert.equal(result.result.outcome, "finished");

  const training = reachTraining(
    core,
    createSession(core, { menuProbability: 1 }),
    "unsafe-finish",
    () => 0,
  );
  assert.throws(
    () => core.transitionRouletteTraining(
      training,
      event(training, "show_result", "skip-give-up", 2_500),
    ),
    /not allowed/,
  );
});

test("recovery retains decided menu, image, count, and bags without invoking random again", async () => {
  const core = await coreModule;
  const initial = createSession(core, { menuProbability: 1 });
  const spinEvent = event(initial, "spin", "durable-spin", 1_100);
  const decided = core.transitionRouletteTraining(initial, spinEvent, { random: () => 0 });
  const serialized = core.serializeRouletteTrainingState(decided);
  const restored = core.restoreRouletteTrainingState(serialized, { now: 10_000 });

  assert.equal(restored.phase, "menu_result");
  assert.deepEqual(restored.currentRound, decided.currentRound);
  assert.deepEqual(restored.menuBag, decided.menuBag);
  assert.deepEqual(restored.imageBag, decided.imageBag);

  let randomCalls = 0;
  assert.throws(
    () => core.transitionRouletteTraining(
      restored,
      event(restored, "spin", "do-not-redraw", 10_001),
      { random: () => {
        randomCalls += 1;
        return 0;
      } },
    ),
    /not allowed/,
  );
  assert.equal(randomCalls, 0);

  randomCalls = 0;
  const replay = core.transitionRouletteTraining(
    decided,
    spinEvent,
    { random: () => {
      randomCalls += 1;
      return 0.999;
    } },
  );
  assert.strictEqual(replay, decided);
  assert.equal(randomCalls, 0);

  assert.throws(
    () => core.transitionRouletteTraining(
      decided,
      { ...spinEvent, actionId: "different-action" },
      { random: () => {
        randomCalls += 1;
        return 0;
      } },
    ),
    /stale/,
  );
  assert.equal(randomCalls, 0);
});

test("an interrupted workout restores paused with the same task and needs an explicit resume", async () => {
  const core = await coreModule;
  let state = createSession(core, {
    pack: pack([menu("only")]),
    imageIds: ["only-image"],
    menuProbability: 0,
  });
  state.effectBag = ["fever"];
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "recover-fever", 1_100),
    { random: () => 0.9 },
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "continue_after_effect", "recover-effect-ack", 1_101),
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin", "recover-menu", 1_102),
    { random: () => 0 },
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "spin_count", "recover-count", 1_103),
    { random: () => 0 },
  );
  state = core.transitionRouletteTraining(
    state,
    event(state, "start", "recover-start", 2_000),
  );
  const decidedTask = { ...state.currentRound };

  const paused = core.restoreRouletteTrainingState(
    core.serializeRouletteTrainingState(state),
    { now: 7_000 },
  );
  assert.equal(paused.phase, "paused");
  assert.equal(paused.currentRound.menuId, decidedTask.menuId);
  assert.equal(paused.currentRound.imageId, decidedTask.imageId);
  assert.equal(paused.currentRound.count, decidedTask.count);
  assert.equal(core.rouletteTrainingTempo(paused, 7_000).metronomeBpm, 0);
  assert.equal(paused.activeEffect.remainingMs, 15_000);

  const resumed = core.transitionRouletteTraining(
    paused,
    event(paused, "resume", "explicit-resume", 8_000),
  );
  assert.equal(resumed.phase, "training");
  assert.equal(core.rouletteTrainingTempo(resumed, 8_000).metronomeBpm, 80);
  assert.equal(core.rouletteTrainingTempo(resumed, 23_000).metronomeBpm, 60);
});

test("tampered recovery bags are rejected instead of silently being rebuilt and redrawn", async () => {
  const core = await coreModule;
  const state = createSession(core);
  const snapshot = JSON.parse(core.serializeRouletteTrainingState(state));
  snapshot.menuBag = ["menu-a", "menu-a"];

  assert.throws(
    () => core.restoreRouletteTrainingState(JSON.stringify(snapshot)),
    /duplicate/,
  );
  assert.throws(
    () => core.restoreRouletteTrainingState("{broken"),
    /valid JSON/,
  );

  const fresh = createSession(core, { menuProbability: 1 });
  let decided = core.transitionRouletteTraining(
    fresh,
    event(fresh, "spin", "tamper-spin", 1_100),
    { random: () => 0 },
  );
  decided = core.transitionRouletteTraining(
    decided,
    event(decided, "spin_count", "tamper-count", 1_101),
    { random: () => 0 },
  );
  const unsafeCount = JSON.parse(core.serializeRouletteTrainingState(decided));
  unsafeCount.currentRound.count = 999;
  assert.throws(
    () => core.restoreRouletteTrainingState(unsafeCount),
    /fixed roulette candidates/,
  );

  const legacyCount = JSON.parse(core.serializeRouletteTrainingState(decided));
  legacyCount.currentRound.count = 5;
  legacyCount.currentRound.countCandidates = [5, 8, 10, 12];
  delete legacyCount.currentRound.allOutCount;
  delete legacyCount.pendingAllOutCount;
  const restoredLegacy = core.restoreRouletteTrainingState(legacyCount);
  assert.equal(restoredLegacy.currentRound.count, 5);
  assert.deepEqual(restoredLegacy.currentRound.countCandidates, [5, 8, 10, 12]);
});

test("result summary counts only cleared self-reports in the matching unit", async () => {
  const core = await coreModule;
  const summary = core.resultSummary({
    outcome: "give_up",
    history: [
      { status: "clear", countUnit: "reps", count: 8 },
      { status: "clear", countUnit: "seconds", count: 20 },
      { status: "clear", countUnit: "round_trips", count: 5 },
      { status: "clear", countUnit: "sets", count: 2 },
      { status: "give_up", countUnit: "reps", count: 12 },
    ],
  });
  assert.deepEqual(summary, {
    outcome: "give_up",
    clearedRounds: 4,
    givenUpRounds: 1,
    totalReps: 8,
    totalSeconds: 20,
    totalRoundTrips: 5,
    totalSets: 2,
    totalsByUnit: {
      reps: 8,
      seconds: 20,
      round_trips: 5,
      sets: 2,
    },
    shownAt: null,
    finalized: false,
    endedAt: null,
  });

  const frontendSummary = core.resultSummary({
    completedCount: 3,
    startedAt: 1_000,
    finishedAt: 5_500,
    startBpm: 60,
    finalBpm: 70,
    maximumReachedBpm: 80,
    finishReason: "give_up",
    lastChallenge: {
      menuText: "スクワット",
      count: 8,
      countUnit: "reps",
      bpm: 70,
    },
  });
  assert.deepEqual(frontendSummary, {
    completedCount: 3,
    activeMs: 4_500,
    startedAt: 1_000,
    finishedAt: 5_500,
    startBpm: 60,
    finalBpm: 70,
    maximumReachedBpm: 80,
    finishReason: "give_up",
    lastChallenge: {
      menuText: "スクワット",
      count: 8,
      countUnit: "reps",
      bpm: 70,
    },
  });
});
