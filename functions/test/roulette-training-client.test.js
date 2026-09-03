"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const client = read("roulette-training.js");
const core = read("roulette-training-core.mjs");
const styles = read("roulette-training.css");
const app = read("app.js");
const html = read("index.html");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `source marker is available: ${startMarker}`);
  assert.ok(end > start, `source marker follows ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("landing and module wiring expose a separate solo roulette mode", () => {
  assert.match(html, /roulette-training\.css\?v=[^"]*-room-scrapbook-v1[^"]*"/);
  assert.match(html, /roulette-training\.js\?v=[^"]*-room-scrapbook-v1[^"]*"/);
  assert.match(app, /id="rouletteTrainingButton"/);
  assert.match(app, /function startRouletteTraining\(\)/);
  assert.match(app, /hariai-roulette-training-ready/);
  assert.match(app, /HariaiRouletteTraining\.requestHome\(\)/);
  assert.match(client, /window\.HariaiRouletteTraining = Object\.freeze/);
  assert.match(client, /openMarket:/);
  assert.match(client, /callAction: callRouletteTrainingAction/);
  assert.doesNotMatch(client, /HariaiTraining|trainingSessionAction/);
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.match(start, /render\(\);[\s\S]*?window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
});

test("the visual mode is image-first with a vertical drum and reduced-motion behavior", () => {
  assert.match(styles, /\.hero-roulette-training-button\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(styles, /\.roulette-training-image-stage\s*\{/);
  assert.match(styles, /\.roulette-training-reel-track\s*\{[\s\S]*?grid-auto-rows/);
  assert.match(styles, /@keyframes roulette-training-drum-spin/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.roulette-training-image-tile button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  assert.match(client, /function prefersReducedMotion\(\)/);
  assert.match(client, /session\.pendingMain = draw\.type === "menu"[\s\S]*?imageIndex: nextImageIndex\(session\)[\s\S]*?cheerLine: cheerForMenu[\s\S]*?persistSession\(\);[\s\S]*?setTimeout\(settleMainSpin/);
});

test("play uses one dedicated five-line machine with deterministic landing animations", () => {
  const reels = sourceBlock(client, "function reelItemKey", "function sessionImage");
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const mainItems = sourceBlock(client, "function mainReelItems", "function challengeLabel");
  const menuResult = sourceBlock(client, "function renderMenuResult", "function countReelItems");
  const animation = sourceBlock(client, "function spinDuration", "function serializeSession");
  const mainSpin = sourceBlock(client, "function spinMainRoulette", "function nextImageIndex");
  const countSpin = sourceBlock(client, "function spinCountRoulette", "function settleCountSpin");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const passageHelpers = sourceBlock(client, "function reelPassageOffsets", "function runReelAnimation");

  assert.match(client, /REEL_VISUAL_ROW_COUNT = Object\.freeze\(\{ main: 36, count: 30 \}\)/);
  assert.match(client, /REEL_SPIN_DURATION_MS = Object\.freeze\(\{ main: 2_000, count: 1_600 \}\)/);
  assert.match(reels, /landingIndex = total - 3/);
  assert.match(reels, /\[-2, -1, 0, 1, 2\]/);
  assert.match(reels, /data-reel-landing-index/);
  assert.match(reels, /aria-hidden="true"/);
  assert.match(mainItems, /reelId: `effect:\$\{effect\.id\}`/);
  assert.match(mainItems, /reelId: `menu:\$\{item\.id\}`/);
  assert.match(animation, /reverseY = type === "count" \? 6 : 8/);
  assert.match(animation, /overshoot = type === "count" \? 7 : 9/);
  assert.match(animation, /rowHeight = firstRow\?\.offsetHeight \|\| 52/);
  assert.doesNotMatch(animation, /getBoundingClientRect\(\)\.height/);
  assert.match(animation, /function reelPassageOffsets\(passages\)/);
  assert.match(animation, /passageOffsets\.map\(\(offset, index\) => \(\{/);
  assert.match(animation, /marker\.animate\(markerPassageKeyframes\(passageOffsets\)/);
  assert.match(animation, /passageOffsets\.slice\(-6\)/);
  assert.match(animation, /translate3d\(0, \$\{landingY\}px, 0\)/);
  assert.match(animation, /animation\.finished\.then\(\(\) =>/);
  assert.match(animation, /prefersReducedMotion\(\)[\s\S]*?opacity: 0\.48[\s\S]*?opacity: 1/);
  assert.doesNotMatch(animation, /Math\.random/);
  assert.match(mainSpin, /persistSession\(\);[\s\S]*?render\(\);[\s\S]*?setTimeout\(settleMainSpin, spinFallbackDuration\("main"\)\)[\s\S]*?runReelAnimation\("main", settleMainSpin\)/);
  assert.match(countSpin, /pendingCount = drawCount[\s\S]*?persistSession\(\);[\s\S]*?render\(\);[\s\S]*?setTimeout\(settleCountSpin, spinFallbackDuration\("count"\)\)[\s\S]*?runReelAnimation\("count", settleCountSpin\)/);
  assert.doesNotMatch(menuResult, /回数単位/);
  assert.match(stage, /renderProgressGems\(session\)/);
  assert.match(result, /finishReason = recordedFinishReason === "give_up" \? "give_up" : "completed"/);
  assert.match(result, /renderGoalLights\(litCount, targetCount, \{ sequential: goalCleared \}\)/);
  assert.match(result, /goalCleared \? particleField\(10, "goal"\) : ""/);

  assert.match(styles, /\.roulette-training-reel-window\s*\{[\s\S]*?height:\s*calc\(var\(--reel-row-height\) \* 5\)/);
  assert.match(styles, /\.roulette-training-reel-fade\s*\{[\s\S]*?-webkit-mask-image:[\s\S]*?mask-image:/);
  const marker = sourceBlock(styles, ".roulette-training-reel-marker {", ".roulette-training-reel-lock {");
  assert.doesNotMatch(marker, /clip-path:\s*polygon\(100% 0,\s*0 50%,\s*100% 100%\)/);
  assert.match(styles, /\.roulette-training-reel-marker::(?:before|after)\s*\{/);
  assert.match(styles, /\.roulette-training-progress-lights\s*\{/);
  assert.match(styles, /\.roulette-training-selection-drawer\.is-open\s*\{[\s\S]*?roulette-training-drawer-open/);
  assert.match(styles, /\.roulette-training-odometer-strip\s*\{[\s\S]*?translate3d/);
  assert.match(styles, /100dvh/);

  const sandbox = {};
  vm.runInNewContext(`${passageHelpers}\nthis.offsets = reelPassageOffsets(31); this.markerFrames = markerPassageKeyframes(this.offsets);`, sandbox);
  const offsets = Array.from(sandbox.offsets);
  const passageGaps = offsets.map((offset, index) => offset - (offsets[index - 1] ?? 0.045));
  const markerHitOffsets = Array.from(sandbox.markerFrames)
    .filter((frame) => frame.transform.includes("-2.5px"))
    .map((frame) => frame.offset);
  assert.equal(offsets.length, 31);
  assert.equal(offsets.at(-1), 0.94);
  assert.ok(offsets.every((offset, index) => index === 0 || offset > offsets[index - 1]));
  assert.ok(passageGaps.at(-1) > passageGaps[5]);
  assert.deepEqual(markerHitOffsets, offsets);
});

test("machine feedback stays accessible, bounded, and optional", () => {
  const frame = sourceBlock(client, "function renderFrame", "function announce");
  const animation = sourceBlock(client, "function spinDuration", "function serializeSession");
  const particles = sourceBlock(client, "function particleField", "function renderProgressGems");
  const bubble = sourceBlock(styles, ".roulette-training-speech-bubble {", ".roulette-training-stage-progress {");

  assert.match(frame, /id="rouletteTrainingAnnouncer" role="status" aria-live="polite"/);
  assert.match(animation, /ensureAudioContext\(\)/);
  assert.match(animation, /if \(!context\) return/);
  assert.match(particles, /if \(prefersReducedMotion\(\)\) return ""/);
  assert.match(particles, /Math\.min\(12/);
  assert.match(bubble, /max-width:\s*min\(75%, 410px\)/);
  assert.match(bubble, /-webkit-line-clamp:\s*2/);
  assert.match(bubble, /roulette-training-cheer-pop/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("play view removes redundant labels and uses a tail-free paper cheer note", () => {
  const frame = sourceBlock(client, "function renderFrame", "function announce");
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const play = sourceBlock(client, "function renderPlay", "function formatDuration");
  const bubble = sourceBlock(styles, ".roulette-training-speech-bubble {", ".roulette-training-stage-progress {");

  assert.match(frame, /showHeader = true/);
  assert.match(frame, /showHeader \? `<header class="roulette-training-header">/);
  assert.match(frame, /<h1 class="sr-only">/);
  assert.match(play, /showHeader: false/);
  assert.doesNotMatch(play, /SOLO · SELF REPORT/);
  assert.doesNotMatch(stage, /<span>応援<\/span>/);
  assert.match(stage, /roulette-training-note-tape" aria-hidden="true"/);
  assert.match(bubble, /background:[^;]*(?:var\(--paper\)|var\(--blush\))/);
  assert.doesNotMatch(bubble, /background:\s*rgba\(255, 255, 255, 0\.72\)/);
  assert.doesNotMatch(bubble, /filter:\s*blur/);
  assert.match(bubble, /(?:-webkit-)?backdrop-filter:\s*none/);
  assert.doesNotMatch(bubble, /\.roulette-training-speech-bubble::after/);
});

test("play uses the exact nighttime scrapbook room tokens and Japanese primary labels", () => {
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const machine = sourceBlock(client, "function renderMachine", "function resultDrawer");
  const main = sourceBlock(client, "function renderMainRoulette", "function renderMenuResult");
  const count = sourceBlock(client, "function renderCountRoulette", "function renderCountdown");
  const play = sourceBlock(client, "function renderPlay", "function formatDuration");
  const roomDecor = sourceBlock(client, "function roomDecorMarkup", "function showToast");
  const image = sourceBlock(
    styles,
    '.roulette-training-screen[data-roulette-training-screen="play"] .roulette-training-image-stage > img {',
    '.roulette-training-screen[data-roulette-training-screen="play"] .roulette-training-image-missing {'
  );

  for (const [name, value] of Object.entries({
    "--room-night": "#17141f",
    "--room-wall": "#2a2233",
    "--room-wall-light": "#3a2d40",
    "--paper": "#fff7ef",
    "--paper-shadow": "#e8d8d2",
    "--ink": "#4c3e4d",
    "--blush": "#ff7f9e",
    "--rose-deep": "#b84f72",
    "--lavender": "#c9b8e8",
    "--butter": "#ffd977",
    "--mint": "#77ddd0",
    "--wood": "#8a5f55",
  })) {
    assert.match(styles, new RegExp(`${name}:\\s*${value}`));
  }

  assert.match(styles, /\.roulette-training-screen\[data-roulette-training-screen="play"\]\s*\{/);
  assert.match(play, /phaseClass = String\(session\.phase \|\| "main_ready"\)\.replaceAll\("_", "-"\)/);
  assert.match(play, /roulette-training-play is-phase-\$\{escapeHtml\(phaseClass\)\}/);
  assert.match(play, /data-training-phase="\$\{escapeHtml\(session\.phase\)\}"/);
  assert.match(play, /roomDecorMarkup\(\)/);
  assert.match(roomDecor, /roulette-training-room-decor" aria-hidden="true"/);
  for (const decoration of ["wallpaper", "lamp-light", "floor", "baseboard", "rug"]) {
    assert.match(roomDecor, new RegExp(`roulette-training-room-${decoration}`));
  }
  assert.match(play, /role="group" aria-label="トレーニング状況"/);
  assert.match(play, /<small>基本テンポ<\/small>/);
  assert.match(play, /<small>上限<\/small>/);
  assert.match(play, /<small>あと\$\{remainingTarget\}回<\/small>/);
  assert.doesNotMatch(play, />BASE BPM<|>MAX<|>GOAL</);

  assert.equal(stage.match(/roulette-training-photo-tape/g)?.length, 2);
  assert.equal(stage.match(/roulette-training-photo-tape[^>]*aria-hidden="true"/g)?.length, 2);
  assert.match(image, /object-fit:\s*contain/);
  assert.match(image, /filter:\s*none/);
  assert.match(image, /opacity:\s*1/);
  assert.match(image, /mix-blend-mode:\s*normal/);
  assert.doesNotMatch(image, /filter:\s*(?:blur|brightness|contrast|grayscale|saturate|sepia)\(/);

  assert.match(machine, /<b>\$\{mainMachine \? "きょうのルーレット" : "回数ルーレット"\}<\/b>/);
  assert.match(machine, /<small aria-hidden="true">\$\{mainMachine \? "TODAY'S ROULETTE" : "COUNT ROULETTE"\}<\/small>/);
  assert.match(machine, /roulette-training-machine-pins" aria-hidden="true"/);
  assert.match(main, /status: effectResult \? \(rare \? "レア効果" : "おまけチャンス"\) : spinning \? "抽選中…" : "準備OK"/);
  assert.match(count, /status: allOut \? \(settled \? "100回で挑戦" : spinning \? "100を抽選中…" : "100固定"\) : settled \? "この回数で挑戦" : spinning \? "抽選中…" : "回数を決めよう"/);
  assert.doesNotMatch(main, /SPECIAL EFFECT|SPINNING|SPIN READY/);
  assert.doesNotMatch(count, /COUNT LOCKED|SPINNING|COUNT READY/);
});

test("active home training keeps exact voluntary actions and accessible give up semantics", () => {
  const active = sourceBlock(client, "function renderActiveChallenge", "function renderPausedChallenge");
  const frame = sourceBlock(client, "function renderFrame", "function announce");
  const exactGiveUp = /data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで<\/button>/g;

  assert.match(active, /roulette-training-challenge is-active/);
  assert.match(active, /<b>いま挑戦中<\/b><small aria-hidden="true">HOME TRAINING<\/small>/);
  assert.match(active, /<p class="roulette-training-challenge-safety">できたら「できた！」。つらいときは無理せず休もう。<\/p>/);
  assert.match(active, /<small class="roulette-training-self-report">結果は自己申告です。<\/small>/);
  assert.equal(active.match(/data-roulette-action="clear"/g)?.length, 1);
  assert.match(active, /data-roulette-action="clear">できた！<\/button>/);
  assert.equal(active.match(/data-roulette-action="give-up"/g)?.length, 1);
  assert.match(active, exactGiveUp);
  assert.equal(client.match(exactGiveUp)?.length, 4);
  assert.match(frame, /id="rouletteTrainingAnnouncer" role="status" aria-live="polite"/);
});

test("scrapbook success effects are bounded and reduced motion removes ornamental movement", () => {
  const particles = sourceBlock(client, "function particleField", "function renderProgressGems");
  const progress = sourceBlock(client, "function renderProgressGems", "function renderGoalLights");
  const goal = sourceBlock(client, "function renderGoalLights", "function sessionImage");
  const machine = sourceBlock(client, "function renderMachine", "function resultDrawer");
  const clearEffect = sourceBlock(client, "function launchClearProgressEffect", "function clearChallenge");
  const clearChallenge = sourceBlock(client, "function clearChallenge", "function stopActiveClock");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const reducedStart = styles.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart >= 0, "reduced-motion media query is available");
  const reduced = styles.slice(reducedStart);

  assert.match(particles, /if \(prefersReducedMotion\(\)\) return ""/);
  assert.match(particles, /Math\.min\(12/);
  assert.match(progress, /roulette-training-progress-lights/);
  assert.match(progress, /target === 10 \? "is-two-row" : ""/);
  assert.match(progress, /\$\{completed\} \/ \$\{target\}/);
  assert.match(goal, /roulette-training-goal-lights/);
  assert.match(goal, /style="--light-index:\$\{index\}"/);
  assert.match(result, /renderGoalLights\(litCount, targetCount, \{ sequential: goalCleared \}\)/);
  assert.match(result, /goalCleared \? particleField\(10, "goal"\) : ""/);
  assert.match(styles, /\.roulette-training-particles\.is-goal i:nth-child\(n \+ 11\)\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /\.roulette-training-result\.is-result-give-up \.roulette-training-particles\s*\{[\s\S]*?display:\s*none/);
  assert.doesNotMatch(machine, /roulette-training-special-ripple/);

  assert.match(clearEffect, /if \(!origin \|\| prefersReducedMotion\(\) \|\| !appRoot\) return/);
  assert.match(clearEffect, /querySelectorAll\("\.roulette-training-progress-lights i\.is-lit"\)/);
  assert.match(clearEffect, /const target = litLights\[litLights\.length - 1\]/);
  const clearSpreads = clearEffect.match(/const spreads = \[([^\]]+)\]/)?.[1]
    .split(",")
    .map((value) => Number(value.trim()));
  assert.ok(Array.isArray(clearSpreads) && clearSpreads.length > 0 && clearSpreads.length <= 6);
  assert.ok(clearSpreads.every(Number.isFinite));
  assert.match(clearEffect, /particles\.className = "roulette-training-clear-particles"/);
  assert.match(clearEffect, /target\.classList\.add\("is-just-lit"\)/);
  assert.match(clearEffect, /window\.setTimeout\(\(\) => particles\.remove\(\), 1_000\)/);
  assert.match(clearChallenge, /if \(session\.completedCount >= session\.config\.targetCount\) \{\s*finishSession\("completed"\);\s*return;\s*\}[\s\S]*launchClearProgressEffect\(clearOrigin\)/);

  assert.match(styles, /animation:\s*roulette-training-room-glow\s*(?:500ms|0\.5s)/);
  assert.match(styles, /animation:\s*roulette-training-special-frame\s*(?:500ms|0\.5s)/);
  assert.match(styles, /@keyframes roulette-training-light-pop/);
  assert.match(styles, /@keyframes roulette-training-goal-light-on/);
  assert.match(styles, /\.roulette-training-goal-lights i\s*\{[\s\S]*?animation:\s*roulette-training-goal-light-on[^;]*calc\(var\(--light-index\) \* \d+ms\)/);

  assert.match(reduced, /\.roulette-training-particles[\s\S]*?display:\s*none/);
  assert.match(reduced, /\.roulette-training-room-lamp-light,[\s\S]*?animation:\s*none\s*!important/);
  assert.match(reduced, /\.roulette-training-clear-particles[\s\S]*?display:\s*none\s*!important/);
  assert.match(reduced, /\.roulette-training-progress-lights[\s\S]*?animation:\s*none/);
  assert.match(reduced, /\.roulette-training-goal-lights[\s\S]*?animation:\s*none/);
});

test("effect presentation is keyed only by the seven real core effect ids", () => {
  const coreEffects = sourceBlock(core, "export const EFFECTS", "const UNIT_IDS");
  const presentationConstants = sourceBlock(client, "const EFFECT_PRESENTATIONS", "const PUBLIC_REPORT_REASONS");
  const presentationHelpers = sourceBlock(client, "function effectIdOf", "function roomDecorMarkup");
  const expectedIds = [
    "tempo_up",
    "tempo_down",
    "fever",
    "slow",
    "tempo_up_2",
    "tempo_down_2",
    "all_out_time",
  ];
  const coreIds = [...coreEffects.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(coreIds, expectedIds);

  const sandbox = {};
  vm.runInNewContext(`
    ${presentationConstants}
    let state = { session: null };
    ${presentationHelpers}
    this.table = JSON.parse(JSON.stringify(EFFECT_PRESENTATIONS));
    this.idOf = effectIdOf;
    this.presentationOf = effectPresentation;
    this.sessionPresentationOf = sessionPresentation;
  `, sandbox);
  const table = sandbox.table;
  assert.deepEqual(Object.keys(table), expectedIds);
  assert.deepEqual(
    Object.entries(table).filter(([, value]) => value.rarity === "rare").map(([id]) => id),
    ["fever", "all_out_time"],
  );
  assert.equal(sandbox.idOf({ id: "fever" }), "fever");
  assert.equal(sandbox.idOf({ effectId: "all_out_time" }), "all_out_time");
  assert.equal(sandbox.idOf({ effect: { id: "slow" } }), "slow");
  assert.equal(sandbox.presentationOf({ id: "unknown" }).rarity, "standard");
  assert.doesNotMatch(presentationHelpers, /\.label|フィーバータイム|おーるあうとたいむ/);
  assert.doesNotMatch(coreEffects, /\bpresentation\b|\brarity\b/);
});

test("roulette draw and effect application contracts stay independent from presentation metadata", () => {
  const chooseMain = sourceBlock(core, "export function chooseMainType", "export function drawMain");
  const drawMainCore = sourceBlock(core, "export function drawMain", "export function drawCount");
  const drawCountCore = sourceBlock(core, "export function drawCount", "export function applyEffect");
  const applyEffectCore = sourceBlock(core, "export function applyEffect", "function normalizeImages");
  const mainSpin = sourceBlock(client, "function spinMainRoulette", "function skipRarePresentation");
  const countSpin = sourceBlock(client, "function spinCountRoulette", "function settleCountSpin");
  const settleMain = sourceBlock(client, "function settleMainSpin", "function openCountRoulette");

  assert.match(core, /MENU_PROBABILITY = 0\.65/);
  assert.match(core, /EFFECT_PROBABILITY = 0\.35/);
  assert.match(chooseMain, /forceMenu = false,[\s\S]*?menuProbability = MENU_PROBABILITY,[\s\S]*?random = Math\.random/);
  assert.match(chooseMain, /randomUnit\(random\) < probability \? "menu" : "effect"/);
  assert.match(drawMainCore, /menus,[\s\S]*?menuBag = \[\],[\s\S]*?effectBag = \[\],[\s\S]*?forceMenu = false,[\s\S]*?menuProbability = MENU_PROBABILITY,[\s\S]*?random = Math\.random,[\s\S]*?lastMenuId = "",[\s\S]*?lastEffectId = ""/);
  assert.match(drawCountCore, /unitId = "reps",[\s\S]*?intensity = "standard",[\s\S]*?random = Math\.random,[\s\S]*?\{ allOut = false \}/);
  assert.match(applyEffectCore, /baseBpm = BASE_BPM,[\s\S]*?effectId,[\s\S]*?maximumBpm = MAX_BPM/);

  assert.match(mainSpin, /drawMain\(\{\s*menus: packItems\(session\.pack\),\s*menuBag: session\.menuBag,\s*effectBag: session\.effectBag,\s*forceMenu: session\.forceMenu,\s*lastMenuId: session\.lastMenuId,\s*lastEffectId: session\.lastEffectId,\s*\}\)/);
  assert.match(countSpin, /drawCount\(\s*session\.currentMenu\.countUnit,\s*session\.config\.intensity,\s*Math\.random,\s*\{ allOut: session\.currentAllOutCount === true \},\s*\)/);
  assert.match(settleMain, /applyEffect\(\{\s*baseBpm: before,\s*effectId: draw\.item\.id,\s*maximumBpm: session\.config\.maximumBpm,\s*\}\)/);
  assert.doesNotMatch(drawMainCore, /presentation|rarity|RARE/);
  assert.doesNotMatch(drawCountCore, /presentation|rarity|RARE/);
  assert.doesNotMatch(applyEffectCore, /presentation|rarity|RARE/);
});

test("rare presentation remains deterministic, skippable, and recoverable", () => {
  const presentationConstants = sourceBlock(client, "const EFFECT_PRESENTATIONS", "const PUBLIC_REPORT_REASONS");
  const presentationHelpers = sourceBlock(client, "function effectIdOf", "function roomDecorMarkup");
  const reels = sourceBlock(client, "function reelItemKey", "function sessionImage");
  const machine = sourceBlock(client, "function renderMachine", "function renderRareEffectCard");
  const rareCard = sourceBlock(client, "function renderRareEffectCard", "function temporaryEffectRemainingSeconds");
  const main = sourceBlock(client, "function renderMainRoulette", "function renderMenuResult");
  const armSkip = sourceBlock(client, "function armRarePresentationSkip", "function renderResult()");
  const skip = sourceBlock(client, "function skipRarePresentation", "function nextImageIndex");
  const settleMain = sourceBlock(client, "function settleMainSpin", "function openCountRoulette");
  const audio = sourceBlock(client, "function playRareFeverChime", "function reelPassageOffsets");
  const stopAudio = sourceBlock(client, "function playRouletteStopSound", "function reelPassageOffsets");
  const serialized = sourceBlock(client, "function serializeSession", "function persistSession");
  const recovery = sourceBlock(client, "function recoverLocalSession", "function effectAppliedMessage");
  const start = sourceBlock(client, "async function start", "function isActive");

  const sandbox = {};
  vm.runInNewContext(`
    ${presentationConstants}
    let state = { session: null };
    ${presentationHelpers}
    this.presentationOf = sessionPresentation;
  `, sandbox);
  assert.equal(sandbox.presentationOf({ pendingMain: { type: "effect", item: { id: "fever" } } }), "");
  assert.equal(sandbox.presentationOf({ currentEffect: { id: "fever" } }), "fever");
  assert.equal(sandbox.presentationOf({ pendingTemporaryEffect: { effect: { id: "fever" } } }), "fever");
  assert.equal(sandbox.presentationOf({ activeTemporaryEffect: { effectId: "fever" } }), "fever");
  assert.equal(sandbox.presentationOf({ currentEffect: { id: "all_out_time" } }), "all-out");
  assert.equal(sandbox.presentationOf({ pendingAllOutCount: true }), "all-out");
  assert.equal(sandbox.presentationOf({ currentAllOutCount: true }), "all-out");
  assert.equal(sandbox.presentationOf({ currentEffect: { id: "fever" }, currentAllOutCount: true }), "all-out");
  assert.doesNotMatch(presentationHelpers, /pendingMain/);

  assert.match(reels, /data-effect-rarity="rare"/);
  assert.match(reels, /class="roulette-training-row-rare">★ RARE<\/small>/);
  assert.match(main, /spinning && session\.pendingMain\?\.type === "effect"[\s\S]*?session\.pendingMain\.item/);
  assert.match(main, /rare && spinning \? "is-rare-spinning" : ""/);
  assert.match(styles, /\.roulette-training-screen\[data-roulette-training-screen="play"\] \.roulette-training-machine\.is-rare-spinning::after\s*\{[\s\S]*?animation:\s*roulette-training-rare-premonition/);
  const premonitionDelay = Number(styles.match(/animation:\s*roulette-training-rare-premonition\s+\d+ms\s+\S+\s+(\d+)ms\s+1\s+both/)?.[1]);
  assert.ok(Number.isFinite(premonitionDelay) && premonitionDelay >= 600, "rare premonition is CSS-delayed");

  assert.match(rareCard, /★ RARE EFFECT[\s\S]*?FEVER TIME/);
  assert.match(rareCard, /★ レア効果[\s\S]*?100 × 7[\s\S]*?次の回数は100固定です/);
  assert.match(machine, /data-roulette-action="skip-rare-presentation" aria-hidden="true" disabled>レア演出をスキップ/);
  assert.match(presentationConstants, /RARE_PRESENTATION_SKIP_DELAY_MS = 600/);
  assert.match(armSkip, /rarePresentationStartedAt \+ RARE_PRESENTATION_SKIP_DELAY_MS - Date\.now\(\)/);
  assert.match(armSkip, /window\.setTimeout\([\s\S]*?button\.disabled = false[\s\S]*?button\.removeAttribute\("aria-hidden"\)[\s\S]*?レア演出をスキップして結果を表示[\s\S]*?, remaining\)/);
  assert.match(styles, /\.roulette-training-rare-skip\s*\{[\s\S]*?animation:\s*roulette-training-rare-skip-in\s*180ms\s*ease-out\s*600ms\s*both/);
  assert.match(skip, /Date\.now\(\) - rarePresentationStartedAt < RARE_PRESENTATION_SKIP_DELAY_MS/);
  assert.match(skip, /clearSpinPresentation\(\{ playStop: true \}\)[\s\S]*?window\.clearTimeout\(spinTimer\)[\s\S]*?settleMainSpin\(\)/);
  assert.equal(skip.match(/settleMainSpin\(\)/g)?.length, 1);
  assert.doesNotMatch(skip, /drawMain|drawCount|applyEffect|Math\.random/);
  assert.equal(settleMain.match(/\bapplyEffect\(/g)?.length, 1);

  assert.match(audio, /meta\.presentation === "fever"[\s\S]*?playRareFeverChime\(\)[\s\S]*?return/);
  assert.match(audio, /meta\.presentation === "all-out"[\s\S]*?playAllOutToyDrum\(\)[\s\S]*?return/);
  assert.doesNotMatch(stopAudio, /\.label|フィーバータイム|おーるあうとたいむ/);

  for (const field of [
    "lastEffectId",
    "pendingMain",
    "currentEffect",
    "effectMessage",
    "pendingAllOutCount",
    "currentAllOutCount",
    "pendingTemporaryEffect",
    "activeTemporaryEffect",
  ]) assert.match(serialized, new RegExp(`${field}:`));
  assert.match(recovery, /activeTemporaryEffect: recoveredTemporaryRemainingMs > 0 \? saved\.activeTemporaryEffect : null/);
  assert.match(recovery, /pendingAllOutCount: saved\.pendingAllOutCount === true/);
  assert.match(recovery, /currentAllOutCount: saved\.currentAllOutCount === true/);

  assert.match(start, /\["play", "fever", "all-out"\]\.includes\(preview\)/);
  for (const preview of ["fever", "all-out", "result", "result-completed", "result-empty"]) {
    assert.match(client, new RegExp(`PREVIEW_SCREENS = new Set\\(\\[[\\s\\S]*?"${preview}"`));
  }
  assert.match(start, /effectId = preview === "fever" \? "fever" : "all_out_time"/);
  assert.match(start, /EFFECTS\.find\(\(item\) => item\.id === effectId\)/);
  assert.doesNotMatch(start, /EFFECTS\.find\([^\n]*label/);
});

test("result state, target compatibility, and notebook copy remain exact", () => {
  const targetResolver = sourceBlock(client, "function resultTargetCount", "function resultImage");
  const durationFormatter = sourceBlock(client, "function formatDuration", "function resultTargetCount");
  const finish = sourceBlock(client, "function finishSession", "function giveUpBeforeStart");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const sandbox = {};
  vm.runInNewContext(`
    const TARGET_OPTIONS = Object.freeze([3, 5, 10]);
    const DEFAULT_CONFIG = Object.freeze({ targetCount: 5 });
    let state = { session: null };
    ${targetResolver}
    ${durationFormatter}
    this.resolveTarget = resultTargetCount;
    this.setSessionTarget = (value) => { state.session = value == null ? null : { config: { targetCount: value } }; };
    this.format = formatDuration;
  `, sandbox);

  sandbox.setSessionTarget(3);
  assert.equal(sandbox.resolveTarget({ targetCount: 10 }), 10, "the persisted result wins");
  assert.equal(sandbox.resolveTarget({ targetCount: "5" }), 5, "valid legacy string values normalize");
  assert.equal(sandbox.resolveTarget({ targetCount: 4 }), 3, "an invalid result falls back to session config");
  sandbox.setSessionTarget(10);
  assert.equal(sandbox.resolveTarget({}), 10, "a legacy result uses its recovered session config");
  sandbox.setSessionTarget(7);
  assert.equal(sandbox.resolveTarget({ targetCount: 0 }), 5, "unsupported values fall back to five");
  sandbox.setSessionTarget(null);
  assert.equal(sandbox.resolveTarget({}), 5, "a result without the legacy field stays backward compatible");
  assert.match(client, /TARGET_OPTIONS = Object\.freeze\(\[3, 5, 10\]\)/);
  assert.match(targetResolver, /\[result\?\.targetCount, state\.session\?\.config\?\.targetCount, DEFAULT_CONFIG\.targetCount\]/);
  assert.match(targetResolver, /TARGET_OPTIONS\.includes\(value\)/);

  const resultSummaryIndex = finish.indexOf("...resultSummary({");
  const targetCountIndex = finish.indexOf("targetCount:");
  assert.ok(resultSummaryIndex >= 0 && targetCountIndex > resultSummaryIndex, "targetCount is appended after resultSummary");
  assert.match(finish, /targetCount: TARGET_OPTIONS\.includes\(Number\(session\.config\?\.targetCount\)\)[\s\S]*?DEFAULT_CONFIG\.targetCount/);
  assert.match(result, /recordedFinishReason = result\.finishReason \|\| state\.session\?\.finishReason/);
  assert.match(result, /finishReason = recordedFinishReason === "give_up" \? "give_up" : "completed"/);
  assert.match(result, /resultState = goalCleared \? "completed" : "give-up"/);
  assert.match(result, /roulette-training-result is-result-\$\{resultState\}\$\{goalCleared \? " is-goal-clear" : ""\}/);
  assert.match(result, /<h2>\$\{goalCleared \? "きょうのゴール、達成！" : "きょうはここまで。"\}<\/h2>/);
  assert.match(result, /const summary = goalCleared\s*\? "自分のペースで、きょうの目標まで進めました。"\s*:\s*emptyResult\s*\? "今回は準備したところまで記録しました。<br>また動けそうな日に始めよう。"\s*:\s*"進んだぶんを記録しました。"/);

  for (const copy of [
    "きょうのゴール、達成！",
    "きょうはここまで。",
    "自分のペースで、きょうの目標まで進めました。",
    "今回は準備したところまで記録しました。<br>また動けそうな日に始めよう。",
    "進んだぶんを記録しました。",
  ]) assert.ok(result.includes(copy), copy);
  assert.equal(result.match(/class="roulette-training-result-stat /g)?.length, 2);
  assert.match(result, /<dt>できたメニュー<\/dt>/);
  assert.match(result, /<dt>動いていた時間<\/dt>/);
  assert.equal(sandbox.format(0), "00:00");
  assert.equal(sandbox.format(272_000), "04:32");
  assert.equal(sandbox.format(3_661_000), "61:01");
  assert.match(durationFormatter, /padStart\(2, "0"\)/);

  assert.equal(result.match(/roulette-training-tempo-point is-start/g)?.length, 1);
  assert.equal(result.match(/roulette-training-tempo-point is-end/g)?.length, 1);
  assert.equal(result.match(/roulette-training-tempo-line/g)?.length, 1);
  assert.equal(result.match(/roulette-training-tempo-max-badge/g)?.length, 1);
  assert.match(result, /<small>START<\/small>[\s\S]*?<small>END<\/small>[\s\S]*?<small>★ MAX<\/small>/);
  assert.doesNotMatch(result, /tempo-(?:history|chart|sparkline)|<canvas|BPM履歴/);

  assert.match(result, /<h3>さいごのチャレンジ<\/h3>/);
  assert.match(result, /\$\{last \? `<strong>\$\{escapeHtml\(last\.menuText\)\}<\/strong><p>\$\{Number\(last\.count\)\}\$\{escapeHtml\(unitInfo\(last\.countUnit\)\.label\)\} ／ BPM \$\{Number\(last\.bpm\)\}<\/p>`/);
  assert.match(result, /まだチャレンジは始まっていません<\/strong><p>準備したところまで、きちんと記録しました。/);
  assert.match(result, /結果は自己申告による端末内の記録です。作者、ランキング、RATE、Payには反映されません。/);
  assert.match(result, /終了すると、このセッションの進行データと端末保存画像を削除します。/);
  assert.match(result, /data-roulette-action="end-training" \$\{state\.ending \? "disabled" : ""\}>\$\{state\.ending \? "端末データを削除中…" : "記録を閉じてお部屋に戻る"\}/);
  assert.equal(result.match(/data-roulette-action="end-training"/g)?.length, 1);
});

test("result imagery, mascot, bounded celebration, and motion preferences stay accessible", () => {
  const polaroid = sourceBlock(client, "function renderResultPolaroid", "function animateResultNumbers");
  const countUp = sourceBlock(client, "function animateResultNumbers", "function armRarePresentationSkip");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const renderLoop = sourceBlock(client, "function render()", "function navigate");
  const clearTimers = sourceBlock(client, "function clearRuntimeTimers", "function ensureAudioContext");
  const mascotState = sourceBlock(client, "function mascotStateForSession", "function renderMascot");
  const mascotMarkup = sourceBlock(client, "function renderMascot", "function reelRows");
  const particles = sourceBlock(client, "function particleField", "function renderProgressGems");
  const reducedStart = styles.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart >= 0, "reduced-motion media query is available");
  const reduced = styles.slice(reducedStart);

  assert.match(polaroid, /<img src="\$\{escapeHtml\(image\.url\)\}" alt="最後に使用したトレーニング画像">/);
  assert.match(polaroid, /<figcaption>LAST SNAP<\/figcaption>/);
  assert.match(polaroid, /roulette-training-result-polaroid is-sticker/);
  assert.match(polaroid, /renderMascot\("idle", "sticker"\)/);
  assert.match(polaroid, /<figcaption>ROOM BUDDY<\/figcaption>/);

  for (const mascotClass of [
    "idle",
    "spinning",
    "normal-hit",
    "effect-hit",
    "fever-hit",
    "all-out-hit",
    "training",
    "result-completed",
    "result-give-up",
  ]) assert.match(mascotMarkup, new RegExp(`"${mascotClass}"`));
  assert.match(mascotMarkup, /\["play", "result", "sticker"\]\.includes\(placement\)/);
  assert.match(mascotMarkup, /roulette-training-mascot is-\$\{safePlacement\} is-\$\{safeState\}" aria-hidden="true"/);
  assert.match(mascotMarkup, /<svg viewBox="0 0 120 154" focusable="false">/);
  assert.match(mascotState, /\["main_spinning", "count_spinning"\][\s\S]*?"spinning"/);
  assert.match(mascotState, /presentation === "fever"[\s\S]*?"fever-hit"/);
  assert.match(mascotState, /presentation === "all-out"[\s\S]*?"all-out-hit"/);
  assert.match(mascotState, /\["countdown", "active", "paused"\][\s\S]*?"training"/);
  assert.match(result, /renderMascot\(goalCleared \? "result-completed" : "result-give-up", "result"\)/);
  const mascotCss = sourceBlock(styles, ".roulette-training-mascot {", ".roulette-training-mascot.is-play {");
  assert.match(mascotCss, /pointer-events:\s*none/);
  assert.match(styles, /\.roulette-training-play\.has-presentation-fever \.roulette-training-mascot\.is-play \.mascot-penlight,[\s\S]*?\.roulette-training-play\.has-presentation-all-out \.roulette-training-mascot\.is-play :is\(\.mascot-headband, \.mascot-flag\)[\s\S]*?opacity:\s*1/);
  assert.match(styles, /\.roulette-training-play\.has-presentation-fever \.roulette-training-progress-lights i\s*\{[\s\S]*?var\(--fever-beat, 1000ms\)[\s\S]*?calc\(var\(--light-index\) \* 45ms\)/);

  const goalParticleMatch = result.match(/goalCleared \? particleField\((\d+), "goal"\) : ""/);
  assert.ok(goalParticleMatch, "completed results alone request goal particles");
  assert.ok(Number(goalParticleMatch[1]) <= 10);
  assert.match(styles, /\.roulette-training-particles\.is-goal i:nth-child\(n \+ 11\)\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /\.roulette-training-result\.is-result-give-up \.roulette-training-particles\s*\{[\s\S]*?display:\s*none/);

  const duration = Number(countUp.match(/const duration = (\d+)/)?.[1]);
  assert.ok(Number.isFinite(duration) && duration <= 650);
  assert.match(countUp, /if \(state\.screen !== "result" \|\| prefersReducedMotion\(\)\) return/);
  assert.match(countUp, /counter\.dataset\.rouletteResultFormat === "duration"[\s\S]*?formatDuration\(current \* 1_000\)/);
  assert.doesNotMatch(countUp, /\.disabled|setAttribute\("disabled"|end-training|roulette-training-end-button/);
  assert.match(renderLoop, /cancelAnimationFrame\(resultCountAnimationFrame\)/);
  assert.match(clearTimers, /cancelAnimationFrame\(resultCountAnimationFrame\)/);
  assert.match(particles, /if \(prefersReducedMotion\(\)\) return ""/);

  assert.match(reduced, /\.roulette-training-screen \*,\s*\.roulette-training-screen \*::before,\s*\.roulette-training-screen \*::after\s*\{[\s\S]*?animation-duration:\s*0\.01ms\s*!important[\s\S]*?animation-iteration-count:\s*1\s*!important/);
  assert.match(reduced, /\.roulette-training-mascot,[\s\S]*?\.roulette-training-machine\.is-rare-spinning::after,[\s\S]*?\.roulette-training-rare-effect-card,[\s\S]*?\[data-roulette-result-countup\]\s*\{[\s\S]*?animation:\s*none\s*!important[\s\S]*?transition:\s*none\s*!important/);
  assert.match(reduced, /\.roulette-training-machine\.is-rare-spinning::after\s*\{[\s\S]*?display:\s*none/);
  assert.match(reduced, /\.roulette-training-particles,\s*\.roulette-training-clear-particles\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(styles, /\.is-roulette-document-hidden \.roulette-training-mascot \*[\s\S]*?\.is-roulette-document-hidden \.roulette-training-rare-effect-card,[\s\S]*?\.is-roulette-document-hidden \.roulette-training-progress-lights i,[\s\S]*?\.is-roulette-document-hidden \.roulette-training-particles i,[\s\S]*?animation-play-state:\s*paused\s*!important/);
});

test("count roulette uses seven fixed values and all-out replaces all seven slots with 100", () => {
  const setup = sourceBlock(client, "function renderSetup", "function editorMenuCard");
  const countItems = sourceBlock(client, "function countReelItems", "function renderCountRoulette");
  const count = sourceBlock(client, "function renderCountRoulette", "function renderCountdown");
  const countSpin = sourceBlock(client, "function spinCountRoulette", "function settleCountSpin");
  const settleMain = sourceBlock(client, "function settleMainSpin", "function openCountRoulette");
  const recovery = sourceBlock(client, "function serializeSession", "function effectAppliedMessage");
  const nextMain = sourceBlock(client, "function prepareNextMain", "function finishRest");

  assert.match(core, /COUNT_CANDIDATES = Object\.freeze\(\[10, 20, 25, 30, 35, 40, 50\]\)/);
  assert.match(core, /id: "all_out_time"[\s\S]*?label: "おーるあうとたいむ♡"[\s\S]*?kind: "count_override"/);
  assert.match(core, /COUNT_CANDIDATES\.map\(\(\) => ALL_OUT_COUNT_VALUE\)/);
  const candidates = core.match(/COUNT_CANDIDATES = Object\.freeze\(\[([^\]]+)\]\)/)?.[1]
    .split(",")
    .map((value) => Number(value.trim()));
  assert.deepEqual(candidates, [10, 20, 25, 30, 35, 40, 50]);
  assert.equal(candidates?.length, 7);
  assert.doesNotMatch(setup, /name="intensity"/);
  assert.match(countItems, /session\.pendingCount\?\.candidates/);
  assert.match(countItems, /allOut: session\.currentAllOutCount === true/);
  assert.match(countItems, /id: `\$\{index\}:\$\{value\}`/);
  assert.match(count, /allOut \? "is-all-out-count" : ""/);
  assert.match(count, /status: allOut \? \(settled \? "100回で挑戦" : spinning \? "100を抽選中…" : "100固定"\)/);
  assert.match(count, /banner: allOut \? `<div class="roulette-training-all-out-count-card"><strong>100 × 7<\/strong><span>次の回数は100固定です<\/span><\/div>` : ""/);
  assert.match(count, /note: allOut \? "無理のない範囲で。続けられないときは、いつでも今日はここまでで大丈夫です。" : ""/);
  assert.match(countSpin, /Math\.random,[\s\S]*?allOut: session\.currentAllOutCount === true/);
  assert.match(settleMain, /pendingAllOutCount = applied\.allOutCount === true/);
  assert.match(settleMain, /currentAllOutCount = session\.pendingAllOutCount === true;[\s\S]*?pendingAllOutCount = false/);
  assert.match(recovery, /pendingAllOutCount: session\.pendingAllOutCount === true/);
  assert.match(recovery, /currentAllOutCount: saved\.currentAllOutCount === true/);
  assert.match(nextMain, /pendingAllOutCount = false;[\s\S]*?currentAllOutCount = false/);
  assert.match(client, /次の回数ルーレットは7枠すべて100になります/);
  assert.match(client, /PREVIEW_SCREENS = new Set\(\[[^\]]*"all-out"/);
});

test("setup keeps one to ten images local and persistence is explicit opt-in", () => {
  assert.match(client, /IMAGE_MAX_COUNT/);
  assert.match(client, /type="file" accept="image\/\*" multiple/);
  assert.match(client, /name="keepImages" type="checkbox"/);
  assert.match(client, /keepImages:\s*false/);
  const writeImages = sourceBlock(client, "async function writeSessionImageBlobs", "async function readSessionImageBlobs");
  const readImages = sourceBlock(client, "async function readSessionImageBlobs", "async function clearSessionImageBlobs");
  assert.match(writeImages, /if \(!state\.config\.keepImages\) return true;/);
  assert.match(writeImages, /const owner = storageOwner\(\)[\s\S]*?\.\.\.owner,[\s\S]*?blobs:/);
  assert.match(readImages, /if \(!state\.config\.keepImages\) return \[\];/);
  assert.match(client, /clearSessionImageBlobs\(\{ force: true \}\)/);
  const clearImages = sourceBlock(client, "async function clearSessionImageBlobs", "function releaseImages");
  assert.match(clearImages, /if \(!\("indexedDB" in window\)\) return true;/);
  assert.match(clearImages, /transaction\.oncomplete = \(\) => resolve\(true\)/);
  assert.match(clearImages, /transaction\.onerror = \(\) => resolve\(false\)/);
  assert.match(client, /端末保存画像を削除できなかったため、保存設定をONのままにしました/);
  const removeImage = sourceBlock(client, "async function removeImage", "function updateSetupConfig");
  assert.match(removeImage, /saved = await writeSessionImageBlobs\(nextImages\)/);
  assert.match(removeImage, /if \(!saved\)[\s\S]*?画像を外しませんでした[\s\S]*?return;/);
  const recovery = sourceBlock(client, "function recoverLocalSession", "function effectAppliedMessage");
  assert.match(recovery, /const recoveredConfig = normalizeConfig\(saved\.config\)/);
  assert.match(recovery, /state\.session = \{ \.\.\.saved, pack, config: recoveredConfig, phase: "result"/);
  assert.match(client, /baseBpm" type="range" min="\$\{MIN_BPM\}" max="\$\{state\.config\.maximumBpm\}"/);
  const setupBindings = sourceBlock(client, "function bindEvents", "async function start");
  assert.match(setupBindings, /input\.name === "baseBpm"[\s\S]*?input\.value = maximum\.value/);
  assert.match(setupBindings, /updateSetupConfig\(setupForm, \{ preserveImageConsent: true \}\)[\s\S]*?handleImageSelection/);
  assert.match(setupBindings, /data-roulette-remove-image[\s\S]*?updateSetupConfig\(setupForm, \{ preserveImageConsent: true \}\)/);
  assert.match(setupBindings, /#rouletteTrainingSetupForm select[\s\S]*?updateSetupConfig\(form\)/);
  const endTraining = sourceBlock(client, "async function endTraining", "function chooseFreePack");
  assert.match(endTraining, /await clearSessionImageBlobs\(\{ force: true \}\)/);
  assert.match(endTraining, /if \(!imagesCleared\)[\s\S]*?端末保存画像を削除できませんでした/);
  const home = sourceBlock(client, "async function requestHome", 'window.addEventListener("visibilitychange"');
  assert.match(home, /await clearSessionImageBlobs\(\{ force: true \}\)/);
  assert.doesNotMatch(client, /firebase-storage|uploadBytes|getStorage/);
});

test("local recovery and persisted images are bound to the current account owner", () => {
  const serialized = sourceBlock(client, "function serializeSession", "function persistSession");
  assert.match(serialized, /ownerUid: session\.ownerUid/);
  assert.match(serialized, /localOwnerId: session\.localOwnerId/);
  const validation = sourceBlock(client, "async function validateStoredRecoveryOwner", "async function openImageDatabase");
  assert.match(validation, /savedOwnerUid[\s\S]*?await ensureUser\(\)[\s\S]*?user\.uid === savedOwnerUid/);
  assert.match(validation, /paidUseId \|\| auth\.currentUser[\s\S]*?purgeStoredRecovery/);
  assert.match(validation, /saved\.localOwnerId[\s\S]*?localOwnerId\(\)/);
  const resumeLocal = sourceBlock(client, '"resume-local": async () => {', '"spin-main": spinMainRoulette');
  assert.ok(resumeLocal.indexOf("validateStoredRecoveryOwner(saved)") < resumeLocal.indexOf('callRouletteTrainingAction("resume_use"'));
  assert.ok(resumeLocal.indexOf('callRouletteTrainingAction("resume_use"') < resumeLocal.indexOf("restoreSessionImages(verifiedSaved)"));
  assert.ok(resumeLocal.indexOf("restoreSessionImages(verifiedSaved)") < resumeLocal.indexOf("recoverLocalSession(verifiedSaved)"));
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.match(start, /auth\.authStateReady\(\)/);
  assert.match(start, /validateStoredRecoveryOwner\(saved\)/);
  assert.doesNotMatch(start, /await restoreSessionImages\(\)/);
});

test("paid local recovery purges only definitive terminal errors and retains retryable data", () => {
  const classifierSource = sourceBlock(
    client,
    "function paidRecoveryIsDefinitivelyUnavailable",
    "function hasUnboundLocalOwnerData",
  );
  const classify = new Function(`${classifierSource}\nreturn paidRecoveryIsDefinitivelyUnavailable;`)();
  assert.equal(classify({ code: "functions/not-found" }), true);
  assert.equal(classify({ code: "functions/failed-precondition" }), true);
  for (const code of [
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/internal",
    "functions/unknown",
    "functions/unauthenticated",
    "functions/permission-denied",
  ]) assert.equal(classify({ code }), false, `${code} keeps the local recovery`);
  assert.equal(classify(new TypeError("Failed to fetch")), false);
  assert.equal(classify(new Error("利用記録の所有者を確認できませんでした。")), false);

  const resumeLocal = sourceBlock(client, '"resume-local": async () => {', '"spin-main": spinMainRoulette');
  const recoveryCatch = sourceBlock(
    resumeLocal,
    "} catch (error) {",
    "      state.recoveryError = \"\";",
  );
  assert.match(recoveryCatch, /if \(paidRecoveryIsDefinitivelyUnavailable\(error\)\)/);
  const definitiveBranch = sourceBlock(
    recoveryCatch,
    "if (paidRecoveryIsDefinitivelyUnavailable(error)) {",
    "} else {",
  );
  assert.match(definitiveBranch, /await purgeStoredRecovery\(/);
  const retryableBranch = sourceBlock(recoveryCatch, "} else {", "          }\n          render();");
  assert.match(retryableBranch, /state\.recoveryAvailable = true/);
  assert.match(retryableBranch, /端末内の進行状態と画像は保持しています/);
  assert.doesNotMatch(retryableBranch, /purgeStoredRecovery|removeStored|clearSessionImageBlobs|releaseImages/);
  const hub = sourceBlock(client, "function renderHub", "function imageTile");
  assert.match(hub, /state\.recoveryError[\s\S]*?role="status"/);
});

test("creator UI accepts free-form menu, details, and one to four cheer lines", () => {
  assert.match(client, /name="menuText-\$\{index\}"[^>]*maxlength="80"/);
  assert.match(client, /name="detailText-\$\{index\}"[^>]*maxlength="120"/);
  assert.match(client, /name="cheerLines-\$\{index\}"/);
  assert.match(client, /1行につき1台詞、最大4行/);
  assert.match(client, /1〜4行・各行60文字以内/);
  assert.match(client, /文章中の数字は回数やBPMに反映されません/);
  assert.match(client, /draft\.items\.length >= MENU_MAX_COUNT/);
  assert.match(client, /成功手数料は20%（最低1 Pay）/);
  assert.match(client, /購入1件の作者受取/);
  const editor = sourceBlock(client, "function renderEditor()", "function menuDisclosure");
  assert.match(editor, /人格否定・脅迫/);
  assert.doesNotMatch(editor, /脅迫・差別/);
  const restoreDraft = sourceBlock(client, "function restoreDraft", "function persistEditorDraft");
  assert.match(restoreDraft, /auth\.currentUser\?\.uid/);
  assert.match(restoreDraft, /saved\.ownerUid/);
  assert.match(restoreDraft, /!currentUid && savedLocalOwner === localOwnerId\(\)/);
  assert.match(restoreDraft, /removeStored\(DRAFT_STORAGE_KEY\)/);
  const persistDraft = sourceBlock(client, "function persistEditorDraft", "function createState");
  assert.match(persistDraft, /ownerUid,[\s\S]*?localOwnerId:/);
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.ok(start.indexOf("await auth.authStateReady()") < start.indexOf("state.editorDraft = restoreDraft()"));
  const publication = sourceBlock(client, "async function publishEditorPack", "function applyServerMarketState");
  assert.match(publication, /detailText: item\.detailText \|\| ""/);
  assert.match(publication, /pendingActionId\(PUBLISH_ATTEMPT_STORAGE_KEY/);
  assert.match(publication, /if \(pack\.packId\) publication\.packId = pack\.packId/);
  assert.match(publication, /baseRevision:/);
  assert.match(publication, /removeStored\(PUBLISH_ATTEMPT_STORAGE_KEY\)/);
  const cheerNormalizerSource = sourceBlock(
    client,
    "function normalizeEditorCheerLines",
    "function restoreDraft",
  );
  const normalizeCheer = new Function(`${cheerNormalizerSource}\nreturn normalizeEditorCheerLines;`)();
  const emojiCheer = "😀".repeat(31);
  assert.deepEqual(normalizeCheer(emojiCheer, { validate: true }), [emojiCheer]);
  assert.throws(
    () => normalizeCheer("😀".repeat(61), { validate: true }),
    /各行60文字以内/,
  );
  assert.throws(
    () => normalizeCheer("㍍".repeat(16), { validate: true }),
    /各行60文字以内/,
    "NFKC expansion is counted before enforcing the limit",
  );
  const review = sourceBlock(client, "function editorDraftPack", "function addEditorMenu");
  assert.match(review, /updateEditorDraftFromForm\(form, \{ validateCheerLines: true \}\)/);
});

test("market purchase is one-session, reviewed, consented, and idempotent", () => {
  assert.match(client, /現在残高/);
  assert.match(client, /開始後残高/);
  assert.match(client, /この内容を任意で1セッション利用します/);
  assert.match(client, /ルーレット・回数・クリア・ギブアップによる追加料金はありません/);
  assert.match(client, /id="rouletteTrainingPurchaseConsent" type="checkbox"/);
  assert.match(client, /id="rouletteTrainingActivatePack"[\s\S]*?paidConsentRequired \? "disabled"/);
  const startPaid = sourceBlock(client, "async function activateSelectedPack", "async function resumePaidUse");
  assert.match(startPaid, /pendingActionId\(USE_ATTEMPT_STORAGE_KEY/);
  assert.match(startPaid, /actionId,/);
  assert.match(startPaid, /removeStored\(USE_ATTEMPT_STORAGE_KEY\)/);
  assert.match(startPaid, /response\.terminalAction === true[\s\S]*?removeStored\(USE_ATTEMPT_STORAGE_KEY\)[\s\S]*?loadMarket\(\{ force: true \}\)/);
  assert.match(startPaid, /if \(!use \|\| !\(use\.id \|\| use\.useId\)\) throw/);
  assert.match(startPaid, /response\.balance \?\? use\?\.buyerBalanceAfter/);
  assert.match(client, /作者本人の試遊は無料です/);
  assert.match(client, /hasOwnProperty\.call\(payload, "activeUse"\)/);
  assert.match(client, /payload\.activeUse && typeof payload\.activeUse === "object" \? payload\.activeUse : null/);
});

test("market exposes deduplicated purchased revisions as report-only history", () => {
  assert.match(client, /purchasedRevisions:\s*\[\]/);
  const applyState = sourceBlock(client, "function applyServerMarketState", "async function loadMarket");
  assert.match(applyState, /payload\.purchasedRevisions/);
  assert.match(applyState, /seenPurchasedRevisions/);
  assert.match(client, /購入済みの改訂（通報用）/);
  assert.match(client, /data-roulette-purchased-index/);
  const detail = sourceBlock(client, "function renderPackDetail", "function reelRows");
  assert.match(detail, /if \(pack\.reportOnly\)/);
  assert.match(detail, /PURCHASED REVISION · REPORT ONLY/);
  const reportOnlyBranch = detail.slice(detail.indexOf("if (pack.reportOnly)"), detail.indexOf("const selfPreview"));
  assert.doesNotMatch(reportOnlyBranch, /data-roulette-action="activate-pack"/);
  assert.match(reportOnlyBranch, /reportDisclosure\(pack\)/);
  const activation = sourceBlock(client, "async function activateSelectedPack", "async function resumePaidUse");
  assert.match(activation, /if \(pack\.reportOnly\)[\s\S]*?return;/);
  const reportAccess = sourceBlock(client, "function hasPurchasedRevision", "function renderMarket");
  assert.match(reportAccess, /state\.purchasedRevisions\.some/);
  assert.match(reportAccess, /packIdentity\(purchased\) === packId && packRevision\(purchased\) === revision/);
  assert.match(reportAccess, /pack\.builtin \|\| pack\.isOwn \|\| !hasPurchasedRevision\(pack\)/);
  const submitReport = sourceBlock(client, "async function submitReport", "async function retryPendingFinishFromUi");
  assert.match(submitReport, /if \(!hasPurchasedRevision\(pack\)\)[\s\S]*?return;/);
});

test("paid finish is owner-bound, single-flight per use, and fences stale resumes", () => {
  const finish = sourceBlock(client, "function finishPaidUseBestEffort", "async function validateFinishRetryOwner");
  assert.match(finish, /pendingFinishRequests\.get\(normalizedUseId\)/);
  assert.match(finish, /if \(existingRequest\) return existingRequest\.promise/);
  assert.match(finish, /volatileFinishRetryRecord = \{[\s\S]*?useId: normalizedUseId,[\s\S]*?ownerUid: normalizedOwnerUid/);
  assert.match(finish, /pendingFinishRequests\.set\(normalizedUseId, \{ promise: request, ownerUid: normalizedOwnerUid \}\)/);
  assert.match(finish, /callRouletteTrainingAction\("finish_use", \{ useId: normalizedUseId \}\)/);
  assert.match(finish, /if \(!removeFinishRetryRecord\(normalizedUseId\)\) return false/);
  assert.match(finish, /catch \{[\s\S]*?return false/);
  const ownerCheck = sourceBlock(client, "async function validateFinishRetryOwner", "async function flushFinishRetry");
  assert.match(ownerCheck, /record\.ownerUid === currentUid/);
  assert.match(ownerCheck, /removeFinishRetryRecord\(record\.useId\)/);
  assert.match(ownerCheck, /callRouletteTrainingAction\("state"\)[\s\S]*?activeUseId === record\.useId[\s\S]*?ownerUid: currentUid/);
  const applyState = sourceBlock(client, "function applyServerMarketState", "async function loadMarket");
  assert.match(applyState, /finishUseIsFenced\(serverActiveUseId\) \? null : serverActiveUse/);
  const end = sourceBlock(client, "async function endTraining", "function chooseFreePack");
  assert.match(end, /finishPromise = paidUseId[\s\S]*?finishPaidUseBestEffort\(paidUseId, state\.session\?\.ownerUid\)/);
  assert.match(end, /finishPromise\.then/);
});

test("a terminal finish waits before server reads but still permits the official free pack", () => {
  const hub = sourceBlock(client, "function renderHub", "function imageTile");
  assert.match(hub, /終了処理を再試行/);
  assert.match(hub, /data-roulette-action="choose-free">公式無料パックで遊ぶ/);
  const chooseFree = sourceBlock(client, "function chooseFreePack", "function bindEvents");
  assert.doesNotMatch(chooseFree, /terminalFinishUseId/);
  const begin = sourceBlock(client, "function beginSession", "function updateEditorDraftFromForm");
  assert.match(begin, /terminalFinishUseId\(\) && !\(state\.selectedPack\?\.builtin && state\.selectedPackSource === "builtin"\)/);
  const market = sourceBlock(client, "async function loadMarket", "async function loadCreatorState");
  assert.ok(market.indexOf("await flushFinishRetry()") < market.indexOf('callRouletteTrainingAction("state")'));
  assert.ok(market.indexOf("if (!finishConfirmed || terminalFinishUseId())") < market.indexOf("Promise.all"));
  const creator = sourceBlock(client, "async function loadCreatorState", "function selectMarketPack");
  assert.ok(creator.indexOf("await flushFinishRetry()") < creator.indexOf('callRouletteTrainingAction("state")'));
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.doesNotMatch(start, /pendingFinishRetryPromise\s*=\s*retry/);
  assert.match(start, /if \(state\.screen !== "result"\) state\.screen = "hub"/);
});

test("free recovery is exclusive until its JSON and image record are safely discarded", () => {
  const hub = sourceBlock(client, "function renderHub", "function imageTile");
  assert.match(hub, /hasRecovery && !savedPaidUseId/);
  assert.match(hub, /前回データを破棄して新しく始める/);
  assert.match(hub, /showHubActions = [^;]*!hasRecovery/);
  const discard = sourceBlock(client, "async function discardStoredRecovery", "async function discardFreeRecoveryFromUi");
  assert.ok(discard.indexOf("await clearSessionImageBlobs({ force: true })") < discard.indexOf("removeStored(SESSION_STORAGE_KEY)"));
  assert.match(discard, /!removeStored\(SESSION_STORAGE_KEY\) \|\| readJson\(SESSION_STORAGE_KEY, null\)/);
  assert.match(discard, /if \(!imagesCleared\)[\s\S]*?前回データは保持しました/);
  const resume = sourceBlock(client, "async function resumePaidUse", "async function submitReport");
  assert.ok(resume.indexOf("discardConflictingRecoveryForActiveUse(useId)") < resume.indexOf('callRouletteTrainingAction("resume_use"'));
  assert.match(client, /if \(!\("indexedDB" in window\)\) return true/);
});

test("live auth changes immediately hide prior-owner data and fail closed before calls", () => {
  assert.match(client, /onAuthStateChanged/);
  const call = sourceBlock(client, "async function callRouletteTrainingAction", "function actionIdFor");
  assert.match(call, /const actionGeneration = operationGeneration\(\)/);
  assert.match(call, /expectedUid && expectedUid !== user\.uid[\s\S]*?handleActiveAuthUidChange/);
  assert.ok(call.indexOf("expectedUid !== user.uid") < call.indexOf("rouletteTrainingAction({ action, ...payload })"));
  const reset = sourceBlock(client, "function handleActiveAuthUidChange", "async function validateStoredRecoveryOwner");
  const unbound = sourceBlock(client, "function hasUnboundLocalOwnerData", "async function ensureUser");
  assert.match(unbound, /state\.images\.length > 0/);
  assert.match(unbound, /state\.loadingImages/);
  assert.match(reset, /clearRuntimeTimers\(\)/);
  assert.match(reset, /releaseImages\(\)/);
  assert.match(reset, /removeStored\(SESSION_STORAGE_KEY\)/);
  assert.match(reset, /removeStored\(DRAFT_STORAGE_KEY\)/);
  assert.match(reset, /clearSessionImageBlobs\(\{ force: true \}\)/);
  assert.match(reset, /state = createState\(\)[\s\S]*?state\.uid = normalizedNextUid[\s\S]*?state\.screen = "hub"/);
  assert.match(reset, /callRouletteTrainingAction\("state"\)/);
  assert.ok(reset.indexOf("renderGeneration += 1") < reset.indexOf("releaseImages()"));
  const imageSelection = sourceBlock(client, "async function handleImageSelection", "async function removeImage");
  assert.ok(imageSelection.indexOf("processImageFile") < imageSelection.indexOf("if (!generationIsCurrent(generation))"));
  assert.ok(imageSelection.indexOf("if (!generationIsCurrent(generation))") < imageSelection.indexOf("next.push(item)"));
  const observer = sourceBlock(client, "onAuthStateChanged(auth", "window.HariaiRouletteTraining = Object.freeze");
  assert.match(observer, /contextUid === nextUid/);
  assert.match(observer, /hasUnboundLocalOwnerData\(\)[\s\S]*?handleActiveAuthUidChange\(nextUid, "local-owner"\)/);
  assert.match(observer, /handleActiveAuthUidChange\(nextUid, contextUid\)/);
});

test("async market mutations reject stale lifecycle responses and refresh failed reviews", () => {
  const render = sourceBlock(client, "function render()", "function navigate");
  assert.doesNotMatch(render, /renderGeneration \+= 1/);
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.match(start, /renderGeneration \+= 1/);
  assert.ok(start.indexOf("await flushFinishRetry()") < start.indexOf('if (state.screen === "market") loadMarket()'));
  for (const [startMarker, endMarker] of [
    ["async function publishEditorPack", "function applyServerMarketState"],
    ["async function loadMarket", "async function loadCreatorState"],
    ["async function loadCreatorState", "function selectMarketPack"],
    ["async function activateSelectedPack", "async function resumePaidUse"],
    ["async function resumePaidUse", "async function submitReport"],
    ["async function submitReport", "async function endTraining"],
  ]) {
    const block = sourceBlock(client, startMarker, endMarker);
    assert.match(block, /const generation = operationGeneration\(\)/, startMarker);
    assert.match(block, /generationIsCurrent\(generation\)/, startMarker);
  }
  const publish = sourceBlock(client, "async function publishEditorPack", "function applyServerMarketState");
  const purchase = sourceBlock(client, "async function activateSelectedPack", "async function resumePaidUse");
  assert.match(publish, /requiresFreshReview\(error\)[\s\S]*?loadMarket\(\{ force: true \}\)/);
  assert.match(purchase, /requiresFreshReview\(error\)[\s\S]*?loadMarket\(\{ force: true \}\)/);
  assert.match(client, /確認画面から変わ\|価格またはパックが更新[\s\S]*?残高が不足/);
  const market = sourceBlock(client, "async function loadMarket", "async function loadCreatorState");
  const creator = sourceBlock(client, "async function loadCreatorState", "function selectMarketPack");
  assert.match(market, /finishConfirmed = await flushFinishRetry\(\)[\s\S]*?!finishConfirmed \|\| terminalFinishUseId\(\)[\s\S]*?return;[\s\S]*?Promise\.all/);
  assert.match(creator, /finishConfirmed = await flushFinishRetry\(\)[\s\S]*?!finishConfirmed \|\| terminalFinishUseId\(\)[\s\S]*?return;[\s\S]*?callRouletteTrainingAction\("state"\)/);
});

test("own packs can be revised and unpublished without changing historical revisions", () => {
  assert.match(client, /自分の販売パック/);
  assert.match(client, /data-roulette-edit-pack/);
  assert.match(client, /data-roulette-unpublish-pack/);
  assert.match(client, /function editOwnPack\(packId\)/);
  assert.match(client, /baseRevision: packRevision\(pack\)/);
  assert.match(client, /callRouletteTrainingAction\("unpublish", \{ packId \}\)/);
});

test("play exposes only clear or give up as self-report outcomes", () => {
  const active = sourceBlock(client, "function renderActiveChallenge", "function renderPausedChallenge");
  assert.equal(active.match(/data-roulette-action="clear"/g)?.length, 1);
  assert.equal(active.match(/data-roulette-action="give-up"/g)?.length, 1);
  assert.doesNotMatch(active, /調整|スキップ|失敗/);
  assert.match(client, /"give-up": \(\) => finishSession\("give_up"\)/);
  assert.match(client, /finishReason:\s*session\.finishReason/);
});

test("give up always enters the result screen and only the end button closes it", () => {
  const finish = sourceBlock(client, "function finishSession", "function finishPaidUseBestEffort");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  assert.match(finish, /state\.screen = "result"/);
  assert.match(finish, /persistSession\(\)/);
  assert.match(result, /きょうはここまで。/);
  assert.equal(result.match(/data-roulette-action="end-training"/g)?.length, 1);
  assert.match(result, /記録を閉じてお部屋に戻る/);
  assert.match(result, /TODAY'S TRAINING NOTE/);
  assert.doesNotMatch(result, /もう一度遊ぶ|モード選択へ戻る/);
  assert.match(client, /結果画面の「トレーニング終了」で終了してください/);
});

test("an active paid use can be given up before image setup", () => {
  const setup = sourceBlock(client, "function renderSetup", "function editorMenuCard");
  const earlyGiveUp = sourceBlock(client, "function giveUpBeforeStart", "function finishPaidUseBestEffort");
  assert.match(setup, /state\.activeUse[\s\S]*?data-roulette-action="give-up-before-start"[\s\S]*?>ギブアップ</);
  assert.match(setup, /0クリアの結果画面へ進みます/);
  assert.match(earlyGiveUp, /completedCount:\s*0/);
  assert.match(earlyGiveUp, /completedActiveMs:\s*0/);
  assert.match(earlyGiveUp, /paidUseId,/);
  assert.match(earlyGiveUp, /finishSession\("give_up"\)/);
  const home = sourceBlock(client, "function requestHome", "window.addEventListener(\"visibilitychange\"");
  assert.match(home, /state\.screen === "setup" && state\.activeUse && !state\.session/);
  assert.match(home, /giveUpBeforeStart\(\)/);
  assert.match(setup, /state\.activeUse \? `<p class="roulette-training-active-pack-note"[\s\S]*?` : `<button[^`]*data-roulette-action="hub"/);
  const draftTest = sourceBlock(client, "function testEditorDraft", "async function publishEditorPack");
  assert.match(draftTest, /if \(state\.activeUse\)[\s\S]*?return;/);
});

test("startup resolves active paid use before hub actions and never joins it to another pack", () => {
  const hub = sourceBlock(client, "function renderHub", "function imageTile");
  assert.match(hub, /state\.bootstrapLoading[\s\S]*?開始済みの利用と端末内の復旧データを確認しています/);
  assert.match(hub, /showHubActions = !state\.bootstrapLoading && !state\.activeUse && !terminalUseId && !hasRecovery/);
  assert.match(hub, /activeUseId === savedPaidUseId/);
  assert.ok(hub.indexOf("else if (hasMatchingPaidRecovery)") < hub.indexOf("else if (state.activeUse &&"));
  assert.match(hub, /進行中の有料トレーニングへ戻る[\s\S]*?画像・抽選結果・クリア数・一時停止状態/);
  const start = sourceBlock(client, "async function start", "function isActive");
  assert.ok(start.indexOf("await flushFinishRetry()") < start.indexOf('callRouletteTrainingAction("state")'));
  assert.match(start, /if \(!preview\) \{\s*try \{\s*const serverState = await callRouletteTrainingAction\("state"\)[\s\S]*?finally \{[\s\S]*?state\.bootstrapLoading = false/);
  const creator = sourceBlock(client, "async function loadCreatorState", "function selectMarketPack");
  assert.match(creator, /state\.creatorLoading = true/);
  assert.match(creator, /state\.activeUse && \["editor", "editor_review"\]\.includes\(state\.screen\)[\s\S]*?navigate\("setup"\)/);
  const editor = sourceBlock(client, "function renderEditor()", "function menuDisclosure");
  assert.match(editor, /data-roulette-action="test-draft" \$\{finishBlocked \|\| state\.creatorLoading \? "disabled"/);
  const begin = sourceBlock(client, "function beginSession", "function updateEditorDraftFromForm");
  assert.match(begin, /state\.activeUse[\s\S]*?state\.selectedPackSource === "active_use"/);
  assert.match(begin, /packIdentity\(state\.selectedPack\) === packIdentity\(activePack\)/);
  assert.match(begin, /packRevision\(state\.selectedPack\) === packRevision\(activePack\)/);
  assert.match(begin, /if \(!selectionMatchesActive\)[\s\S]*?return;/);
});

test("expired seconds remain timed out across visibility pause and recovery", () => {
  const recovery = sourceBlock(client, "function recoverLocalSession", "function effectAppliedMessage");
  const resume = sourceBlock(client, "function beginChallenge", "function scheduleTemporaryEffectExpiry");
  const pause = sourceBlock(client, "function pauseChallengeForVisibility", "function clearChallenge");
  assert.match(recovery, /\["active", "paused"\]\.includes\(saved\.phase\)[\s\S]*?countUnit === "seconds"[\s\S]*?recoveredChallengeRemainingMs <= 0/);
  assert.match(recovery, /interruptedSegmentEndedAt = wasActive[\s\S]*?Math\.min\(now, Number\(saved\.challengeEndsAt\)\)/);
  assert.match(recovery, /completedActiveMs: Math\.max\(0, Number\(saved\.completedActiveMs\) \|\| 0\) \+ interruptedActiveMs/);
  assert.match(resume, /countUnit === "seconds" && session\.challengeRemainingMs <= 0[\s\S]*?challengeTimedOut = true/);
  assert.match(resume, /activeSegmentStartedAt = session\.challengeTimedOut \? 0 : now/);
  assert.match(pause, /countUnit === "seconds" && session\.challengeRemainingMs <= 0[\s\S]*?challengeTimedOut = true/);
  assert.match(client, /phase === "countdown"[\s\S]*?phase = "count_result";[\s\S]*?persistSession\(\);[\s\S]*?render\(\);/);
});

test("bfcache settles deterministic spins and restarts only the rest display timer", () => {
  const lifecycle = sourceBlock(client, 'window.addEventListener("pagehide"', "window.HariaiRouletteTraining = Object.freeze");
  assert.match(lifecycle, /event\.persisted && state\.session\?\.phase === "main_spinning"[\s\S]*?settleMainSpin\(\)/);
  assert.match(lifecycle, /event\.persisted && state\.session\?\.phase === "count_spinning"[\s\S]*?settleCountSpin\(\)/);
  assert.match(lifecycle, /event\.persisted && state\.session\?\.phase === "countdown"[\s\S]*?phase = "count_result"/);
  assert.match(lifecycle, /state\.session\?\.phase === "rest"[\s\S]*?setInterval\(updateRest, 250\)/);
});

test("server finish and reports never transmit private workout results", () => {
  const finish = sourceBlock(client, "function finishPaidUseBestEffort", "async function validateFinishRetryOwner");
  const report = sourceBlock(client, "async function submitReport", "async function endTraining");
  assert.match(finish, /callRouletteTrainingAction\("finish_use", \{ useId: normalizedUseId \}\)/);
  assert.doesNotMatch(finish, /callRouletteTrainingAction\("finish_use", \{[^}]*ownerUid/);
  assert.doesNotMatch(finish, /outcome|clear|give_up|bpm|count|image/iu);
  assert.match(report, /expectedRevision: packRevision\(pack\)/);
  assert.doesNotMatch(report, /\brevision:\s*packRevision/);
  for (const reason of [
    "dangerous_exercise",
    "stop_obstruction",
    "harassment",
    "sexual",
    "privacy",
    "rights",
    "external_trade",
    "other",
  ]) assert.match(client, new RegExp(`id: "${reason}"`));
});

test("all Firebase clients share one cache generation", () => {
  const files = [
    "account.js",
    "ai-text-training.js",
    "danwaku-note.js",
    "flea-market.js",
    "free-table.js",
    "market.js",
    "online.js",
    "post-match-tip.js",
    "roulette-training.js",
    "strategy.js",
  ];
  const urls = files.map((file) => {
    const match = read(file).match(/firebase-services\.js\?v=([^"']+)/);
    assert.ok(match, `${file} imports firebase-services with a version`);
    return match[1];
  });
  assert.equal(new Set(urls).size, 1);
  assert.match(urls[0], /roulette-training-v1$/);
  assert.match(read("firebase-services.js"), /searchParams\.has\("rouletteTrainingPreview"\)/);
  assert.match(read("firebase-app-check.js"), /searchParams\.has\("rouletteTrainingPreview"\)/);
});
