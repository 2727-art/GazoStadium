"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const coreUrl = pathToFileURL(
  path.resolve(__dirname, "..", "..", "ai-text-training-core.mjs"),
).href;

test("AI text training accepts only five 0 or 40-160 BPM values", async () => {
  const core = await import(coreUrl);
  const plan = core.createAiTextTrainingPlan({
    modeId: "mama",
    bpms: [0, 40, 80, 120, 160],
  });
  assert.deepEqual(plan.baseBpms, [0, 40, 80, 120, 160]);
  assert.throws(
    () => core.createAiTextTrainingPlan({ modeId: "mama", bpms: [40, 80] }),
    /5枚/,
  );
  assert.throws(
    () => core.createAiTextTrainingPlan({
      modeId: "mama",
      bpms: [39, 40, 80, 120, 160],
    }),
    /40〜160/,
  );
});

test("mama really slows and oneechan really speeds the next played BPM", async () => {
  const core = await import(coreUrl);
  const mama = core.createAiTextTrainingPlan({
    modeId: "mama",
    bpms: [100, 160, 160, 160, 160],
  });
  core.applyAiTextTrainingReaction(mama, 0, "hard_but_ok");
  assert.equal(mama.effectiveBpms[1], 90);
  core.applyAiTextTrainingReaction(mama, 1, "hard_but_ok");
  assert.equal(mama.effectiveBpms[2], 80);

  const oneechan = core.createAiTextTrainingPlan({
    modeId: "oneechan",
    bpms: [100, 40, 40, 40, 40],
  });
  core.applyAiTextTrainingReaction(oneechan, 0, "hard_but_ok");
  assert.equal(oneechan.effectiveBpms[1], 110);
  core.applyAiTextTrainingReaction(oneechan, 1, "hard_but_ok");
  assert.equal(oneechan.effectiveBpms[2], 120);
});

test("FREE RHYTHM stays free in every personality", async () => {
  const core = await import(coreUrl);
  for (const modeId of ["mama", "imouto", "oneechan"]) {
    const plan = core.createAiTextTrainingPlan({
      modeId,
      bpms: [120, 0, 120, 0, 120],
      randomValues: [0.1, 0.3, 0.6, 0.9],
    });
    core.applyAiTextTrainingReaction(plan, 0, "hard_but_ok");
    assert.equal(plan.effectiveBpms[1], 0);
    if (modeId !== "imouto") {
      core.applyAiTextTrainingReaction(plan, 1, "hard_but_ok");
    }
    assert.equal(plan.effectiveBpms[3], modeId === "imouto" ? 0 : null);
  }
});

test("imouto choices are fixed once and never repeat consecutively", async () => {
  const core = await import(coreUrl);
  const plan = core.createAiTextTrainingPlan({
    modeId: "imouto",
    bpms: [80, 80, 80, 80, 80],
    randomValues: [0, 0, 0, 0],
  });
  assert.equal(plan.imoutoOffsets.length, 5);
  for (let index = 2; index < plan.imoutoOffsets.length; index += 1) {
    assert.notEqual(plan.imoutoOffsets[index], plan.imoutoOffsets[index - 1]);
  }
  const before = [...plan.effectiveBpms];
  core.applyAiTextTrainingReaction(plan, 0, "hard_but_ok");
  assert.deepEqual(plan.effectiveBpms, before);
});

test("a reaction is round-idempotent and cannot be changed after confirmation", async () => {
  const core = await import(coreUrl);
  const plan = core.createAiTextTrainingPlan({
    modeId: "mama",
    bpms: [100, 100, 100, 100, 100],
  });
  core.applyAiTextTrainingReaction(plan, 0, "hard_but_ok");
  const next = plan.effectiveBpms[1];
  core.applyAiTextTrainingReaction(plan, 0, "hard_but_ok");
  assert.equal(plan.effectiveBpms[1], next);
  assert.throws(
    () => core.applyAiTextTrainingReaction(plan, 0, "easy"),
    /確定済み/,
  );
});

test("support slots use actual BPM and never select a high chase line at low BPM", async () => {
  const core = await import(coreUrl);
  assert.equal(core.aiTextTrainingScriptSlot({
    phase: "active",
    bpm: 60,
    remainingSeconds: 5,
  }), "final_low");
  assert.equal(core.aiTextTrainingScriptSlot({
    phase: "active",
    bpm: 140,
    remainingSeconds: 5,
  }), "final_high");
  assert.equal(core.aiTextTrainingScriptSlot({
    phase: "transition",
    direction: core.aiTextTrainingTempoDirection(100, 90),
  }), "tempo_down");
  assert.equal(core.aiTextTrainingTempoDirection(0, 120), "same");
});

test("all built-in scripts completely cover the author schema", async () => {
  const core = await import(coreUrl);
  for (const modeId of ["mama", "imouto", "oneechan"]) {
    const script = core.AI_TEXT_TRAINING_BUILTIN_SCRIPTS[modeId];
    assert.deepEqual(
      Object.keys(script.lines).sort(),
      [...core.AI_TEXT_TRAINING_SCRIPT_SLOT_IDS].sort(),
    );
    for (const lines of Object.values(script.lines)) {
      assert.ok(lines.length >= 2);
    }
  }
});
