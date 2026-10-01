"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
const client = read("roulette-training.js");
const styles = read("roulette-training.css");
const design = read("ROULETTE_TRAINING_DESIGN.md");
const html = read("index.html");
const serverSources = fs.readdirSync(path.join(root, "functions"))
  .filter((name) => /^roulette-training.*\.js$/u.test(name))
  .map((name) => read(path.join("functions", name)))
  .join("\n");
const personaModule = import(pathToFileURL(path.join(root, "roulette-training-persona.mjs")).href);
const coreModule = import(pathToFileURL(path.join(root, "roulette-training-core.mjs")).href);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `source marker is available: ${startMarker}`);
  assert.ok(end > start, `source marker follows ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("four manager personas cover every situation with filled, deterministic lines", async () => {
  const persona = await personaModule;
  assert.deepEqual(persona.PERSONAS.map((item) => item.id), ["tsuyotsuyo", "cool", "ojou", "taiiku"]);
  assert.equal(persona.DEFAULT_PERSONA_ID, "tsuyotsuyo");
  assert.equal(persona.normalizePersonaId("cool"), "cool");
  assert.equal(persona.normalizePersonaId("unknown"), "tsuyotsuyo");
  const values = { menu: "壁プッシュ", count: 30, unit: "回", low: 25, bpm: 70, seconds: 15, target: 5 };
  for (const item of persona.PERSONAS) {
    assert.ok(item.label && item.sample);
    for (const situation of persona.PERSONA_SITUATIONS) {
      const lines = persona.personaLines(item.id, situation);
      assert.ok(lines.length >= 1, `${item.id}/${situation} has lines`);
      for (let index = 0; index < 6; index += 1) {
        const line = persona.personaLine(item.id, situation, values, `seed-${index}`);
        assert.ok(line.length > 0 && line.length <= 60, `${item.id}/${situation}: ${line}`);
        assert.doesNotMatch(line, /\{[a-z]+\}/u, `${item.id}/${situation} leaves a placeholder`);
      }
    }
    assert.match(persona.personaLine(item.id, "menu", values, "x"), /壁プッシュ/u);
    assert.match(persona.personaLine(item.id, "count_raise", values, "x"), /30回/u);
  }
  assert.equal(
    persona.personaLine("cool", "ready", {}, "same-seed"),
    persona.personaLine("cool", "ready", {}, "same-seed"),
  );
  assert.equal(persona.personaSeedIndex("abc", 3), persona.personaSeedIndex("abc", 3));
  assert.ok(persona.personaSeedIndex("abc", 3) < 3);
});

test("manager lines stay bossy without shaming, pressure to continue, or sexual wording", async () => {
  const persona = await personaModule;
  const forbidden = /我慢して|止めるな|やめるな|休むな|諦めるな|限界|倒れ|死|罰|ペナルティ|情けない|ダメな|弱い|ざこ|雑魚|ブス|バカ|キス|脱/u;
  for (const item of persona.PERSONAS) {
    for (const situation of persona.PERSONA_SITUATIONS) {
      for (const line of persona.personaLines(item.id, situation)) {
        assert.doesNotMatch(line, forbidden, `${item.id}/${situation}: ${line}`);
      }
    }
    for (const line of persona.personaLines(item.id, "result_give_up")) {
      assert.match(line, /ここまで/u, "give-up lines accept stopping");
    }
    for (const line of persona.personaLines(item.id, "clear_rest")) {
      assert.match(line, /休/u, "rest lines allow the rest");
    }
  }
});

test("nicknames and effect labels are local display data only", async () => {
  const persona = await personaModule;
  const core = await coreModule;
  assert.equal(persona.normalizeNickname("  り\u0000お​  "), "りお");
  assert.equal(persona.normalizeNickname("ＡＢＣ"), "ABC");
  assert.equal(Array.from(persona.normalizeNickname("あ".repeat(30))).length, persona.NICKNAME_MAX_LENGTH);
  assert.equal(persona.managerName(""), "管理人");
  assert.equal(persona.managerName("りお"), "りお");
  assert.deepEqual(
    Object.keys(persona.EFFECT_DISPLAY_LABELS),
    core.EFFECTS.map((effect) => effect.id),
  );
  assert.equal(persona.effectDisplayLabel({ id: "fever" }), "本気タイム");
  assert.equal(persona.effectDisplayLabel({ effect: { id: "slow" } }), "じっくりタイム");
  assert.equal(persona.effectSituation("tempo_up_2"), "effect_tempo_up");
  assert.equal(persona.effectSituation("tempo_down"), "effect_tempo_down");
  assert.equal(persona.effectSituation("all_out_time"), "effect_all_out");
  assert.doesNotMatch(serverSources, /nickname|persona|呼び名/u);
  assert.match(client, /from "\.\/roulette-training-persona\.mjs\?v=roulette-manager-v1"/);
  const normalize = sourceBlock(client, "function normalizeConfig", "function blankMenu");
  assert.match(normalize, /persona: normalizePersonaId\(value\.persona\)/);
  assert.match(normalize, /nickname: normalizeNickname\(value\.nickname\)/);
});

test("the management contract asks for persona, nickname, and a safety pledge before starting", () => {
  const setup = sourceBlock(client, "function personaOption", "function editorMenuCard");
  const update = sourceBlock(client, "function updateSetupConfig", "async function setImagePersistenceConsent");
  const begin = sourceBlock(client, "function beginSession", "function updateEditorDraftFromForm");
  const events = sourceBlock(client, "function bindEvents", "async function start");
  assert.match(setup, /<h2>管理契約<\/h2>/);
  assert.match(setup, /PERSONAS\.map\(\(item\) => personaOption\(item, persona\.id\)\)/);
  assert.match(setup, /type="radio" name="persona"/);
  assert.match(setup, /name="nickname" type="text" maxlength="24" autocomplete="off"/);
  assert.match(setup, /<input name="safetyPledge" type="checkbox" required \/>/);
  assert.match(setup, /管理人に関係なく「今日はここまで」を押します/);
  assert.match(setup, />管理を始めてもらう<\/button>/);
  assert.match(update, /persona: data\.get\("persona"\) \?\? state\.config\.persona/);
  assert.match(update, /nickname: data\.get\("nickname"\) \?\? state\.config\.nickname/);
  assert.match(begin, /form\.querySelector\('input\[name="safetyPledge"\]'\)\?\.checked !== true[\s\S]*?return;/);
  assert.match(begin, /history: \[\],\s*effectBpmFrom: 0,/);
  assert.match(events, /input\[name="persona"\][\s\S]*?\[data-roulette-persona-sample\][\s\S]*?personaInfo\(state\.config\.persona\)\.sample/);
  assert.match(events, /input\[name="nickname"\][\s\S]*?updateSetupConfig\(form\)/);
});

test("A and B: the manager is asked to spin, answers, and teases while the drum turns", () => {
  const request = sourceBlock(client, "function requestMainSpin", "function armAutoSpin");
  const events = sourceBlock(client, "function bindEvents", "async function start");
  const voice = sourceBlock(client, "function stageVoice", "const EYE_ICON");
  assert.match(client, /PULL_DELAY_MS = 480/);
  assert.match(events, /"spin-main": requestMainSpin/);
  assert.match(request, /if \(prefersReducedMotion\(\)\) \{\s*spinMainRoulette\(\);\s*return;\s*\}/);
  assert.match(request, /state\.pullPending = true[\s\S]*?classList\.add\("is-pulling"\)[\s\S]*?回してもらっています…[\s\S]*?updateCheerBubble\(managerVoice\("pull"\)\)[\s\S]*?playLeverSound\(\)[\s\S]*?PULL_DELAY_MS/);
  assert.match(voice, /phase === "main_spinning"\) return managerVoice\("spinning"\)/);
  assert.match(client, /const overshoot = type === "count" \? 10 : 15;/);
  assert.match(styles, /\.roulette-training-image-stage\.is-pulling\s*\{[\s\S]*?roulette-training-pull-flash 420ms/);
});

test("C and D: settled orders lock with a stamp, and only real rare draws are foreshadowed", () => {
  const feedback = sourceBlock(client, "function scheduleSpinFeedback", "function runReelAnimation");
  const machine = sourceBlock(client, "function renderMachine", "function renderEffectVisual");
  assert.match(machine, /stamp \? `<span class="roulette-training-order-stamp" aria-hidden="true">/);
  assert.match(styles, /\.roulette-training-machine\.is-order-locked \.roulette-training-reel-lock\s*\{\s*transform:\s*translateX\(0\)/);
  assert.match(styles, /\.roulette-training-reel-lock\.is-left\s*\{[\s\S]*?translateX\(-48px\)/);
  assert.match(client, /<b>LOCK<\/b>/);
  assert.match(feedback, /pending\?\.type === "effect" && effectPresentation\(pending\.item\)\.rarity === "rare"/);
  assert.match(feedback, /classList\.add\("is-teasing"\)[\s\S]*?updateCheerBubble\(managerVoice\("tease"\)\)[\s\S]*?Math\.round\(duration \* TEASE_AT\)/);
  assert.match(feedback, /spinFeedbackTimers\.push\(teaseTimer\)/);
  assert.match(feedback, /if \(prefersReducedMotion\(\)\) return;/);
  assert.doesNotMatch(feedback, /Math\.random|drawMain|applyEffect/);
});

test("E: each effect has its own visual, and slow joins the timed presentations", () => {
  const visual = sourceBlock(client, "function renderEffectVisual", "function temporaryEffectRemainingSeconds");
  const expire = sourceBlock(client, "function expireTemporaryEffect", "function updateTemporaryEffectDisplay");
  const settle = sourceBlock(client, "function settleMainSpin", "function openCountRoulette");
  assert.match(visual, /roulette-training-tempo-dial \$\{direction\}/);
  assert.match(settle, /session\.effectBpmFrom = before;/);
  assert.match(client, /if \(candidates\.some\(\(effect\) => effectIdOf\(effect\) === "slow"\)\) return "slow";/);
  assert.match(styles, /\.roulette-training-play\.has-presentation-fever \.roulette-training-effect-veil\s*\{[\s\S]*?roulette-training-fever-beat var\(--fever-beat, 750ms\)/);
  assert.match(styles, /\.roulette-training-play\.has-presentation-slow \.roulette-training-effect-veil\s*\{/);
  assert.match(styles, /\.roulette-training-all-out-tiles i\s*\{[\s\S]*?calc\(var\(--tile-index, 0\) \* 90ms \+ 120ms\)/);
  assert.match(expire, /classList\.remove\("has-presentation-fever", "has-presentation-slow"\)/);
  assert.match(expire, /\[data-roulette-ring-bpm\]/);
  assert.match(client, /effectIdOf\(state\.session\?\.activeTemporaryEffect\) === "fever"\) playHeartbeatSound\(0\.02\)/);
});

test("F: after an effect the manager spins on her own unless asked to wait", () => {
  const arm = sourceBlock(client, "function armAutoSpin", "function holdAutoSpin");
  const hold = sourceBlock(client, "function holdAutoSpin", "function armIdleNudge");
  const control = sourceBlock(client, "function renderAutoSpinControl", "function renderMainRoulette");
  const render = sourceBlock(client, "function render()", "function navigate");
  const visibility = sourceBlock(client, 'window.addEventListener("visibilitychange"', 'window.addEventListener("pagehide"');
  assert.match(client, /AUTO_SPIN_SECONDS = 3/);
  assert.match(arm, /session\?\.phase !== "effect_result"[\s\S]*?state\.autoSpinHeld[\s\S]*?document\.visibilityState === "hidden"/);
  assert.match(arm, /state\.autoSpinRemaining <= 0[\s\S]*?spinMainRoulette\(\)/);
  assert.match(hold, /state\.autoSpinHeld = true;[\s\S]*?state\.autoSpinHeldByUser = byUser === true;/);
  assert.match(control, /state\.autoSpinHeld \|\| document\.visibilityState === "hidden"/);
  assert.match(control, /data-roulette-action="hold-auto-spin">ちょっと待って<\/button>/);
  assert.match(render, /armAutoSpin\(\);\s*armIdleNudge\(\);/);
  assert.match(visibility, /phase === "effect_result"\) \{\s*holdAutoSpin\(\{ byUser: false \}\);/);
  assert.match(client, /"hold-auto-spin": \(\) => holdAutoSpin\(\{ byUser: true \}\)/);
});

test("G: the count reveal can tease a lower candidate but never changes the drawn count", () => {
  const raise = sourceBlock(client, "function countRaiseFrom", "function finishCountReveal");
  const reveal = sourceBlock(client, "function finishCountReveal", "function spinMainRoulette");
  const spin = sourceBlock(client, "function spinCountRoulette", "function settleCountSpin");
  const settle = sourceBlock(client, "function settleCountSpin", "function clearRuntimeTimers");
  const sandbox = { COUNT_RAISE_CHANCE: 0.35, Math: Object.create(Math) };
  sandbox.Math.random = () => 0;
  vm.runInNewContext(`${raise}\nthis.raise = countRaiseFrom;`, sandbox);
  assert.equal(sandbox.raise({ value: 30, candidates: [10, 20, 25, 30, 35, 40, 50] }, false), 25);
  assert.equal(sandbox.raise({ value: 10, candidates: [10, 20, 25, 30, 35, 40, 50] }, false), 0);
  assert.equal(sandbox.raise({ value: 100, candidates: [100, 100, 100, 100, 100, 100, 100] }, true), 0);
  sandbox.Math.random = () => 0.9;
  assert.equal(sandbox.raise({ value: 30, candidates: [10, 20, 25, 30] }, false), 0);
  assert.match(spin, /raiseFrom: countRaiseFrom\(session\.pendingCount, session\.currentAllOutCount === true\)/);
  assert.match(settle, /session\.currentCount = Number\(session\.pendingCount\.value\);/);
  assert.match(settle, /state\.countRevealPending = raiseFrom > 0 && raiseFrom < session\.currentCount && !prefersReducedMotion\(\)/);
  assert.match(settle, /countRevealTimer = window\.setTimeout\(\(\) => finishCountReveal\(session\), COUNT_RAISE_REVEAL_MS\)/);
  assert.match(reveal, /state\.countRaised = true;[\s\S]*?render\(\);[\s\S]*?playStampSound\(\)/);
  assert.match(client, /actionDisabled: revealing/);
  assert.doesNotMatch(reveal, /currentCount\s*=/);
});

test("H and I: idle nudges stay out of rest and training, and the last order gets a spotlight", () => {
  const idle = sourceBlock(client, "function armIdleNudge", "function countRaiseFrom");
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const lastOrder = sourceBlock(client, "function isLastOrder", "function showToast");
  assert.match(client, /IDLE_NUDGE_MS = 15_000/);
  assert.match(idle, /\["main_ready", "count_ready"\]\.includes\(session\?\.phase\)/);
  assert.match(idle, /document\.visibilityState === "hidden"/);
  assert.match(idle, /session\.phase === "count_ready" \? 1 : 2/);
  assert.doesNotMatch(idle, /"rest"|"active"/);
  assert.match(lastOrder, /target > 1 && Number\(session\.completedCount\) === target - 1/);
  assert.match(stage, /lastOrder \? `<span class="roulette-training-last-order" aria-hidden="true"><small>LAST ORDER<\/small><b>ラスト命令<\/b><\/span>` : ""/);
  assert.match(styles, /\.roulette-training-image-stage\.is-last-order \.roulette-training-effect-veil\s*\{/);
});

test("J: mechanical sounds stay optional and respect the app sound setting", () => {
  const sounds = sourceBlock(client, "function playRouletteNoise", "function reelPassageOffsets");
  for (const name of ["playLeverSound", "playRouletteStartSound", "playRouletteClickSound", "playStampSound", "playHeartbeatSound", "playTileFlipSounds", "playRouletteStopSound"]) {
    assert.match(sounds, new RegExp(`function ${name}\\(`));
  }
  assert.match(sounds, /const context = ensureAudioContext\(\);\s*if \(!context\) return;/);
  assert.match(client, /function ensureAudioContext\(\) \{\s*if \(!window\.HariaiAudio\?\.isEnabled\?\.\(\)\) return null;/);
  assert.doesNotMatch(client, /playRoulettePaperFeed|playRareFeverChime|playAllOutToyDrum|playPaperStampSound/);
});

test("the free pack speaks with the manager while authored packs keep their own cheers", () => {
  const helpers = sourceBlock(client, "function builtinManagerLines", "function updateCheerBubble");
  assert.match(helpers, /state\.session\?\.pack\?\.builtin === true\s*\? personaLines\(managerConfig\(\)\?\.persona, "active"\)\s*: null/);
  assert.match(helpers, /builtinManagerLines\(\) \|\| \(Array\.isArray\(menu\?\.cheerLines\)/);
});

test("stopping stays a system control in every roulette phase and records the unfinished order", () => {
  const strip = sourceBlock(client, "function renderSafetyStrip", "const PLAY_PHASE_LABELS");
  const play = sourceBlock(client, "function renderPlay()", "function formatDuration");
  const finish = sourceBlock(client, "function finishSession", "function giveUpBeforeStart");
  const clearTimers = sourceBlock(client, "function clearRuntimeTimers", "function ensureAudioContext");
  assert.match(play, /renderSafetyStrip\(session\.phase\)/);
  assert.match(strip, /data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで<\/button>/);
  assert.match(finish, /stopActiveClock\(\);\s*clearRuntimeTimers\(\);/);
  for (const timer of ["pullTimer", "autoSpinTimer", "idleTimer", "countRevealTimer"]) {
    assert.match(clearTimers, new RegExp(`clear(?:Timeout|Interval)\\(${timer}\\)`));
  }
  assert.match(clearTimers, /state\.pullPending = false;\s*state\.countRevealPending = false;/);
  const clear = sourceBlock(client, "function clearChallenge", "function stopActiveClock");
  assert.match(clear, /session\.history = \[\.\.\.\(Array\.isArray\(session\.history\) \? session\.history : \[\]\), \{ \.\.\.session\.lastChallenge \}\]\s*\.slice\(-HISTORY_MAX\)/);
  assert.match(client, /effectTag: session\.currentAllOutCount === true\s*\? "全部100回"/);
});

test("hub copy, cache tokens, and design notes describe the manager roulette", () => {
  const hub = sourceBlock(client, "function renderHub", "function imageTile");
  assert.match(hub, /<h2>今日のメニューは、あの子が決める。<\/h2>/);
  assert.match(hub, /管理人に関係なく「今日はここまで」で止めてください。/);
  assert.match(html, /roulette-training\.css\?v=[^"]*-manager-roulette-v1"/);
  assert.match(html, /roulette-training\.js\?v=[^"]*-manager-roulette-v1-tribute-v1"/);
  assert.match(design, /### 5\.5 管理ルーレット/);
  assert.match(design, /roulette-training-persona\.mjs/);
  assert.match(design, /拒否権なし/);
});
