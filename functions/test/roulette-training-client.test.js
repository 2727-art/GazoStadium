"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
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
  assert.match(html, /roulette-training\.css\?v=[^"]*-pack-ranking-v1-cheer-rotation-v1-mobile-image-focus-v1-manager-roulette-v1"/);
  assert.match(html, /roulette-training\.js\?v=[^"]*-pack-ranking-v1-cheer-rotation-v1-mobile-image-focus-v1-manager-roulette-v1-tribute-v1"/);
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
  assert.match(animation, /overshoot = type === "count" \? 10 : 15/);
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
  assert.match(stage, /roulette-training-speech-bubble/);
  assert.match(result, /finishReason = recordedFinishReason === "give_up" \? "give_up" : "completed"/);
  assert.match(result, /renderResultLog\(result, finishReason\)/);

  assert.match(styles, /\.roulette-training-reel-window\s*\{[\s\S]*?height:\s*calc\(var\(--reel-row-height\) \* 5\)/);
  assert.match(styles, /\.roulette-training-reel-fade\s*\{[\s\S]*?-webkit-mask-image:[\s\S]*?mask-image:/);
  const marker = sourceBlock(styles, ".roulette-training-reel-marker {", ".roulette-training-reel-lock {");
  assert.doesNotMatch(marker, /clip-path:\s*polygon\(100% 0,\s*0 50%,\s*100% 100%\)/);
  assert.match(styles, /\.roulette-training-reel-marker::(?:before|after)\s*\{/);
  assert.match(styles, /\.roulette-training-selection-drawer\.is-open\s*\{[\s\S]*?roulette-training-drawer-open/);
  assert.match(styles, /\.roulette-training-odometer-strip\s*\{[\s\S]*?translate3d/);

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
  const bubble = sourceBlock(styles, ".roulette-training-speech-bubble p {", ".roulette-training-speech-bubble p.is-leaving {");
  const sounds = sourceBlock(client, "function playRouletteNoise", "function reelPassageOffsets");

  assert.match(frame, /id="rouletteTrainingAnnouncer" role="status" aria-live="polite"/);
  assert.match(animation, /ensureAudioContext\(\)/);
  assert.match(sounds, /const context = ensureAudioContext\(\);\s*if \(!context\) return;/);
  assert.match(sounds, /catch \{[\s\S]*?never block a draw/);
  assert.match(bubble, /-webkit-line-clamp:\s*3/);
  assert.match(styles, /\.roulette-training-speech-bubble\.is-pop-in\s*\{[\s\S]*?roulette-training-bubble-in 260ms/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("play view keeps the manager's voice in one bubble on her image", () => {
  const frame = sourceBlock(client, "function renderFrame", "function announce");
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const voice = sourceBlock(client, "function stageVoice", "const EYE_ICON");
  const play = sourceBlock(client, "function renderPlay", "function formatDuration");
  const bubble = sourceBlock(styles, ".roulette-training-speech-bubble {", ".roulette-training-speech-bubble.is-pop-in {");
  const bubbleText = sourceBlock(styles, ".roulette-training-speech-bubble p {", ".roulette-training-speech-bubble p.is-leaving {");

  assert.match(frame, /showHeader = true/);
  assert.match(frame, /showHeader \? `<header class="roulette-training-header">/);
  assert.match(frame, /<h1 class="sr-only">/);
  assert.match(play, /showHeader: false/);
  assert.equal(stage.match(/roulette-training-speech-bubble/g)?.length, 1);
  assert.match(stage, /managerNameTag\(session\)\}<p data-roulette-cheer-text>\$\{escapeHtml\(stageVoice\(session\)\)\}<\/p>/);
  assert.doesNotMatch(stage, /note-tape|photo-tape|mascot/);
  assert.match(voice, /if \(phase === "active" \|\| phase === "paused"\)[\s\S]*?return currentCheer\(\) \|\| managerVoice\("active"\)/);
  assert.match(voice, /managerVoice\("menu", \{ menu: menu\?\.menuText \|\| "" \}\)/);
  assert.match(bubble, /position:\s*absolute/);
  assert.match(bubble, /border:\s*1px solid var\(--rt-accent\)/);
  assert.doesNotMatch(bubble, /filter:\s*blur|backdrop-filter:\s*blur/);
  assert.match(bubbleText, /-webkit-line-clamp:\s*3/);
});

test("play uses the manager control-room tokens and Japanese primary labels", () => {
  const machine = sourceBlock(client, "function renderMachine", "function renderEffectVisual");
  const main = sourceBlock(client, "function renderMainRoulette", "function renderMenuResult");
  const menu = sourceBlock(client, "function renderMenuResult", "function countReelItems");
  const count = sourceBlock(client, "function renderCountRoulette", "function renderCountdown");
  const play = sourceBlock(client, "function renderPlay", "function formatDuration");
  const status = sourceBlock(client, "const PLAY_PHASE_LABELS", "function renderPlay()");
  const image = sourceBlock(styles, ".roulette-training-image-stage > img {", ".roulette-training-image-missing {");

  for (const [name, value] of Object.entries({
    "--rt-ground": "#0c090e",
    "--rt-panel": "#17111b",
    "--rt-accent": "#ff3d8b",
    "--rt-accent-ink": "#1a0610",
    "--rt-safety": "#1f1a22",
  })) {
    assert.match(styles, new RegExp(`${name}:\\s*${value}`));
  }
  assert.doesNotMatch(styles, /roulette-training-room-|roulette-training-mascot|mascot-|roulette-training-photo-tape|roulette-training-result-notebook/);
  assert.doesNotMatch(client, /roomDecorMarkup|renderMascot|mascotStateForSession|renderResultPolaroid|particleField|renderProgressGems|renderGoalLights/);

  assert.match(play, /phaseClass = String\(session\.phase \|\| "main_ready"\)\.replaceAll\("_", "-"\)/);
  assert.match(play, /roulette-training-play is-phase-\$\{escapeHtml\(phaseClass\)\}/);
  assert.match(play, /data-training-phase="\$\{escapeHtml\(session\.phase\)\}"/);
  assert.match(play, /renderPlayStatus\(session\)[\s\S]*?renderStage\(\)[\s\S]*?\$\{machine\}[\s\S]*?renderSafetyStrip\(session\.phase\)/);
  assert.match(status, /role="group" aria-label="トレーニング状況"/);
  assert.match(status, /<small>ノルマ<\/small>/);
  assert.match(status, /<small>基本 · 上限\$\{session\.config\.maximumBpm\}<\/small>/);
  for (const label of ["命令待ち", "抽選中", "気まぐれ", "宣告", "回数の宣告", "開始合図", "監視中", "一時停止", "休憩中", "ラスト命令"]) {
    assert.ok(status.includes(label), label);
  }

  assert.match(image, /object-fit:\s*contain/);
  assert.doesNotMatch(image, /filter:\s*(?:blur|brightness|contrast|grayscale|saturate|sepia)\(/);

  assert.match(machine, /<b>\$\{mainMachine \? "今日の命令" : "回数の宣告"\}<\/b>\$\{mainMachine \? `<em>拒否権なし<\/em>` : ""\}/);
  assert.match(machine, /roulette-training-order-stamp" aria-hidden="true"/);
  assert.match(main, /status: effectResult \? \(rare \? "レア効果" : "気まぐれ発動"\) : spinning \? "抽選中…" : "命令待ち"/);
  assert.match(main, /data-roulette-action="spin-main"[\s\S]*?"回してください"/);
  assert.match(menu, /stateClass: "is-menu-locked is-order-locked"/);
  assert.match(menu, /actionLabel: "回数を決めてもらう"/);
  assert.match(menu, /stamp: "決定"/);
  assert.match(count, /status: allOut \? \(settled \? "100回で挑戦" : spinning \? "100を抽選中…" : "100固定"\) : settled \? \(revealing \? "宣告中…" : "この回数で"\) : spinning \? "抽選中…" : "回数待ち"/);
  assert.match(count, /actionLabel: revealing \? "宣告中…" : "…はい。3秒後に始めます"/);
  assert.match(count, /stamp: settled && !revealing \? "宣告" : ""/);
  assert.doesNotMatch(main, /SPECIAL EFFECT|SPINNING|SPIN READY/);
});

test("active home training keeps exact voluntary actions and accessible give up semantics", () => {
  const detail = sourceBlock(client, "function renderActiveDetail", "function renderActiveChallenge");
  const active = sourceBlock(client, "function renderActiveChallenge", "function renderPausedChallenge");
  const strip = sourceBlock(client, "function renderSafetyStrip", "const PLAY_PHASE_LABELS");
  const frame = sourceBlock(client, "function renderFrame", "function announce");
  const exactGiveUp = /data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで<\/button>/g;

  assert.match(active, /roulette-training-challenge is-active/);
  assert.match(active, /roulette-training-active-summary/);
  assert.match(active, /roulette-training-active-copy/);
  assert.match(active, /roulette-training-active-metrics/);
  assert.match(active, /<b>命令を実行中<\/b><small aria-hidden="true">WATCHING<\/small>/);
  assert.match(detail, /<details class="roulette-training-detail-disclosure">/);
  assert.match(detail, /<summary><strong><span class="is-closed-label">やり方・補足を見る<\/span><span class="is-open-label">やり方・補足を閉じる<\/span><\/strong><span class="roulette-training-detail-preview" aria-hidden="true">\$\{safeDetail\}<\/span><\/summary>/);
  assert.doesNotMatch(detail, /roulette-training-self-report|roulette-training-judgement|data-roulette-action/);
  assert.ok(active.indexOf("renderActiveDetail(session.currentMenu.detailText)") < active.indexOf("roulette-training-judgement"));
  assert.match(active, /<small class="roulette-training-self-report">報告は自己申告です。<\/small>/);
  assert.equal(active.match(/data-roulette-action="clear"/g)?.length, 1);
  assert.match(active, /data-roulette-action="clear">できました（報告する）<\/button>/);
  assert.equal(active.match(/data-roulette-action="give-up"/g)?.length, 1);
  assert.match(active, /data-roulette-action="give-up" aria-label="ギブアップ・トレーニング終了">今日はここまで<small aria-hidden="true">いつでも止められます<\/small><\/button>/);
  assert.match(strip, /sectionHasGiveUp = \["countdown", "active", "paused", "rest"\]\.includes\(phase\)/);
  assert.match(strip, /痛み・めまい・息苦しさは我慢しない。いつでも止められます。/);
  assert.match(strip, exactGiveUp);
  assert.equal(client.match(exactGiveUp)?.length, 4);
  assert.match(frame, /id="rouletteTrainingAnnouncer" role="status" aria-live="polite"/);
});

test("portrait phones keep the image dominant without trapping training controls", () => {
  const phoneStart = styles.lastIndexOf("@media (max-width: 620px)");
  const narrowStart = styles.indexOf("@media (max-width: 350px)", phoneStart);
  assert.ok(phoneStart >= 0 && narrowStart > phoneStart, "phone and narrow rules follow the manager layout");
  const phone = styles.slice(phoneStart, narrowStart);
  const stage = sourceBlock(styles, ".roulette-training-image-stage {", ".roulette-training-play.is-phase-active .roulette-training-image-stage,");
  const judgement = sourceBlock(styles, ".roulette-training-judgement .button {", ".roulette-training-judgement .button small {");

  assert.match(stage, /height:\s*clamp\(280px, 46svh, 560px\)/);
  assert.match(phone, /\.is-phase-menu-result[\s\S]*?\.is-phase-effect-result \.roulette-training-image-stage\s*\{\s*height:\s*clamp\(240px, 36svh, 420px\)/);
  assert.match(phone, /\.is-phase-active \.roulette-training-image-stage,[\s\S]*?height:\s*clamp\(260px, 44svh, 460px\)/);
  assert.doesNotMatch(phone, /position:\s*(?:fixed|sticky)|100dvh|object-fit:\s*cover|filter:\s*blur/);
  assert.match(styles, /\.roulette-training-detail-preview\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
  const actionHeight = Number(judgement.match(/min-height:\s*(\d+)px/)?.[1]);
  assert.ok(actionHeight >= 64, "self-report actions keep a 64px touch target");
  assert.match(phone, /\.roulette-training-safety-strip \.button\s*\{\s*width:\s*100%/);
  assert.match(styles, /@media \(max-width: 350px\)\s*\{[\s\S]*?\.roulette-training-active-metrics,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(min-width: 860px\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.1fr\) minmax\(340px, 0\.9fr\)/);
});

test("manager stamps are bounded and reduced motion removes ornamental movement", () => {
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const clearChallenge = sourceBlock(client, "function clearChallenge", "function stopActiveClock");
  const renderLoop = sourceBlock(client, "function render()", "function navigate");
  const reducedStart = styles.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(reducedStart >= 0, "reduced-motion media query is available");
  const reduced = styles.slice(reducedStart, styles.indexOf("@keyframes", reducedStart));

  assert.match(stage, /state\.justCleared \? `<span class="roulette-training-pass-stamp" aria-hidden="true">合格<\/span>` : ""/);
  assert.match(renderLoop, /appRoot\.innerHTML = renderer\(\);\s*state\.justCleared = false;/);
  assert.match(clearChallenge, /if \(session\.completedCount >= session\.config\.targetCount\) \{\s*finishSession\("completed"\);\s*return;\s*\}/);
  assert.match(clearChallenge, /state\.justCleared = true;[\s\S]*?playStampSound\(\)/);
  assert.match(styles, /\.roulette-training-pass-stamp\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?animation:\s*roulette-training-pass-stamp 1\.6s/);
  assert.match(styles, /@keyframes roulette-training-pass-stamp\s*\{[\s\S]*?100%\s*\{\s*opacity:\s*0/);
  for (const selector of [
    ".roulette-training-image-stage",
    ".roulette-training-effect-veil",
    ".roulette-training-pass-stamp",
    ".roulette-training-order-stamp",
    ".roulette-training-goal-stamp",
    ".roulette-training-all-out-tiles i",
    ".roulette-training-reel-lock",
  ]) assert.ok(reduced.includes(selector), selector);
  assert.match(reduced, /animation:\s*none\s*!important;\s*transition:\s*none\s*!important/);
  assert.match(styles, /\.is-roulette-document-hidden \.roulette-training-effect-veil,[\s\S]*?animation-play-state:\s*paused\s*!important/);
});

test("effect presentation is keyed only by the seven real core effect ids", () => {
  const coreEffects = sourceBlock(core, "export const EFFECTS", "const UNIT_IDS");
  const presentationConstants = sourceBlock(client, "const EFFECT_PRESENTATIONS", "const PUBLIC_REPORT_REASONS");
  const presentationHelpers = sourceBlock(client, "function effectIdOf", "function managerConfig");
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
  const presentationHelpers = sourceBlock(client, "function effectIdOf", "function managerConfig");
  const reels = sourceBlock(client, "function reelItemKey", "function sessionImage");
  const machine = sourceBlock(client, "function renderMachine", "function renderEffectVisual");
  const effectVisual = sourceBlock(client, "function renderEffectVisual", "function temporaryEffectRemainingSeconds");
  const main = sourceBlock(client, "function renderMainRoulette", "function renderMenuResult");
  const armSkip = sourceBlock(client, "function armRarePresentationSkip", "function renderResult()");
  const skip = sourceBlock(client, "function skipRarePresentation", "function nextImageIndex");
  const settleMain = sourceBlock(client, "function settleMainSpin", "function openCountRoulette");
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
  assert.equal(sandbox.presentationOf({ activeTemporaryEffect: { effectId: "slow" } }), "slow");
  assert.equal(sandbox.presentationOf({ currentEffect: { id: "all_out_time" } }), "all-out");
  assert.equal(sandbox.presentationOf({ pendingAllOutCount: true }), "all-out");
  assert.equal(sandbox.presentationOf({ currentAllOutCount: true }), "all-out");
  assert.equal(sandbox.presentationOf({ currentEffect: { id: "fever" }, currentAllOutCount: true }), "all-out");
  assert.doesNotMatch(presentationHelpers, /pendingMain/);

  assert.match(reels, /data-effect-rarity="rare"/);
  assert.match(reels, /class="roulette-training-row-rare">★ RARE<\/small>/);
  assert.match(main, /spinning && session\.pendingMain\?\.type === "effect"[\s\S]*?session\.pendingMain\.item/);
  assert.match(main, /rare && spinning \? "is-rare-spinning" : ""/);
  assert.match(styles, /\.roulette-training-machine\.is-rare-spinning \.roulette-training-reel-shell\s*\{[\s\S]*?animation:\s*roulette-training-tease-pulse/);

  assert.match(effectVisual, /meta\.presentation === "tempo"[\s\S]*?roulette-training-tempo-dial/);
  assert.match(effectVisual, /meta\.presentation === "fever" \|\| meta\.presentation === "slow"/);
  assert.match(effectVisual, /全部100回♡[\s\S]*?Array\.from\(\{ length: 7 \}[\s\S]*?いつでも「今日はここまで」で止められます/);
  assert.match(machine, /data-roulette-action="skip-rare-presentation" aria-hidden="true" disabled>レア演出をスキップ/);
  assert.match(presentationConstants, /RARE_PRESENTATION_SKIP_DELAY_MS = 600/);
  assert.match(armSkip, /rarePresentationStartedAt \+ RARE_PRESENTATION_SKIP_DELAY_MS - Date\.now\(\)/);
  assert.match(armSkip, /window\.setTimeout\([\s\S]*?button\.disabled = false[\s\S]*?button\.removeAttribute\("aria-hidden"\)[\s\S]*?レア演出をスキップして結果を表示[\s\S]*?, remaining\)/);
  assert.match(skip, /Date\.now\(\) - rarePresentationStartedAt < RARE_PRESENTATION_SKIP_DELAY_MS/);
  assert.match(skip, /clearSpinPresentation\(\{ playStop: true \}\)[\s\S]*?window\.clearTimeout\(spinTimer\)[\s\S]*?settleMainSpin\(\)/);
  assert.equal(skip.match(/settleMainSpin\(\)/g)?.length, 1);
  assert.doesNotMatch(skip, /drawMain|drawCount|applyEffect|Math\.random/);
  assert.equal(settleMain.match(/\bapplyEffect\(/g)?.length, 1);

  assert.match(stopAudio, /meta\.presentation === "fever"[\s\S]*?playHeartbeatSound\(0\.18\)[\s\S]*?return/);
  assert.match(stopAudio, /meta\.presentation === "all-out"[\s\S]*?playTileFlipSounds\(\)[\s\S]*?return/);
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
    "history",
    "effectBpmFrom",
  ]) assert.match(serialized, new RegExp(`${field}:`));
  assert.match(recovery, /activeTemporaryEffect: recoveredTemporaryRemainingMs > 0 \? saved\.activeTemporaryEffect : null/);
  assert.match(recovery, /pendingAllOutCount: saved\.pendingAllOutCount === true/);
  assert.match(recovery, /currentAllOutCount: saved\.currentAllOutCount === true/);
  assert.match(recovery, /state\.autoSpinHeld = true;/);

  assert.match(start, /\["play", "fever", "all-out", \.\.\.PLAY_PREVIEW_STEPS\]\.includes\(preview\)/);
  for (const preview of ["fever", "all-out", "result", "result-completed", "result-empty", "verdict", "count", "active", "rest", "last-order", "tempo", "slow"]) {
    assert.match(client, new RegExp(`PREVIEW_SCREENS = new Set\\(\\[[\\s\\S]*?"${preview}"`));
  }
  assert.match(start, /effectId = preview === "fever" \? "fever" : "all_out_time"/);
  assert.match(start, /EFFECTS\.find\(\(item\) => item\.id === effectId\)/);
  assert.doesNotMatch(start, /EFFECTS\.find\([^\n]*label/);
});

test("result state, target compatibility, and control log copy remain exact", () => {
  const targetResolver = sourceBlock(client, "function resultTargetCount", "function resultImage");
  const durationFormatter = sourceBlock(client, "function formatDuration", "function resultTargetCount");
  const finish = sourceBlock(client, "function finishSession", "function giveUpBeforeStart");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const log = sourceBlock(client, "function renderResultLog", "function animateResultNumbers");
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

  const resultSummaryIndex = finish.indexOf("...resultSummary({");
  const targetCountIndex = finish.indexOf("targetCount:");
  assert.ok(resultSummaryIndex >= 0 && targetCountIndex > resultSummaryIndex, "targetCount is appended after resultSummary");
  assert.match(finish, /const phaseAtFinish = String\(session\.phase \|\| ""\)/);
  assert.match(finish, /history: Array\.isArray\(session\.history\) \? session\.history\.slice\(-HISTORY_MAX\) : \[\]/);
  assert.match(finish, /unfinished: session\.finishReason === "give_up"\s*&& \["active", "paused"\]\.includes\(phaseAtFinish\)/);
  assert.match(result, /recordedFinishReason = result\.finishReason \|\| state\.session\?\.finishReason/);
  assert.match(result, /finishReason = recordedFinishReason === "give_up" \? "give_up" : "completed"/);
  assert.match(result, /resultState = goalCleared \? "completed" : "give-up"/);
  assert.match(result, /roulette-training-result is-result-\$\{resultState\}\$\{goalCleared \? " is-goal-clear" : ""\}/);
  assert.match(result, /<span class="roulette-training-result-subtitle">TODAY'S CONTROL LOG<\/span><h2>本日の管理記録<\/h2>/);
  assert.match(result, /goalCleared \? "result_completed" : "result_give_up"/);
  assert.match(result, /roulette-training-goal-stamp" role="img" aria-label="ノルマ達成">ノルマ<br>達成/);
  for (const copy of [
    "すべて合格です。",
    "進んだぶんを、きちんと記録しました。",
    "今回は準備したところまで記録しました。また動けそうな日に始めよう。",
  ]) assert.ok(result.includes(copy), copy);
  assert.equal(result.match(/class="roulette-training-result-stat /g)?.length, 4);
  assert.match(result, /<dt>できた命令<\/dt>/);
  assert.match(result, /<dt>動いた時間<\/dt>/);
  assert.match(result, /role="progressbar" aria-label="目標\$\{targetCount\}回中\$\{litCount\}回達成"/);
  assert.equal(sandbox.format(0), "00:00");
  assert.equal(sandbox.format(272_000), "04:32");
  assert.equal(sandbox.format(3_661_000), "61:01");

  assert.match(log, /stamp: "合格", stampClass: "is-pass"/);
  assert.match(log, /stamp: "ここまで", stampClass: "is-stop", stampLabel: "今日はここまで"/);
  assert.match(log, /if \(result\?\.unfinished\) rows\.push\(resultLogRow\(result\.unfinished, rows\.length, stop\)\)/);
  assert.match(log, /まだ命令は始まっていません。準備したところまで記録しました。/);
  assert.match(result, /結果は自己申告による端末内の記録です。作者、ランキング、RATE、Payには反映されません。/);
  assert.match(result, /閉じると、このセッションの進行データと端末保存画像を削除します。/);
  assert.match(result, /data-roulette-action="end-training" \$\{state\.ending \? "disabled" : ""\}>\$\{state\.ending \? "端末データを削除中…" : "記録を閉じる"\}/);
  assert.equal(result.match(/data-roulette-action="end-training"/g)?.length, 1);
});

test("result imagery, manager comment, and motion preferences stay accessible", () => {
  const portrait = sourceBlock(client, "function renderResultPortrait", "function resultDateLabel");
  const countUp = sourceBlock(client, "function animateResultNumbers", "function armRarePresentationSkip");
  const result = sourceBlock(client, "function renderResult()", "function render()");
  const renderLoop = sourceBlock(client, "function render()", "function navigate");
  const clearTimers = sourceBlock(client, "function clearRuntimeTimers", "function ensureAudioContext");

  assert.match(portrait, /<img src="\$\{escapeHtml\(image\.url\)\}" alt="最後に使用したトレーニング画像">/);
  assert.match(portrait, /roulette-training-result-portrait is-empty" aria-hidden="true"/);
  assert.match(result, /<p class="roulette-training-result-handwriting">\$\{escapeHtml\(comment\)\}<\/p>/);
  assert.match(result, /roulette-training-result-signature">— \$\{escapeHtml\(managerDisplayName\(\)\)\}/);
  assert.match(styles, /\.roulette-training-result-handwriting\s*\{[\s\S]*?font-family:\s*var\(--rt-hand\)/);
  assert.match(styles, /--rt-hand:\s*"Yomogi"/);
  assert.match(styles, /\.roulette-training-result-portrait img\s*\{[\s\S]*?object-fit:\s*contain/);

  const duration = Number(countUp.match(/const duration = (\d+)/)?.[1]);
  assert.ok(Number.isFinite(duration) && duration <= 650);
  assert.match(countUp, /if \(state\.screen !== "result" \|\| prefersReducedMotion\(\)\) return/);
  assert.match(countUp, /counter\.dataset\.rouletteResultFormat === "duration"[\s\S]*?formatDuration\(current \* 1_000\)/);
  assert.doesNotMatch(countUp, /\.disabled|setAttribute\("disabled"|end-training|roulette-training-end-button/);
  assert.match(renderLoop, /cancelAnimationFrame\(resultCountAnimationFrame\)/);
  assert.match(clearTimers, /cancelAnimationFrame\(resultCountAnimationFrame\)/);
  assert.match(styles, /\[data-roulette-result-countup\]\s*\{[\s\S]*?animation:\s*none\s*!important/);
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
  const resumeLocal = sourceBlock(client, '"resume-local": async () => {', '"spin-main": requestMainSpin');
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

  const resumeLocal = sourceBlock(client, '"resume-local": async () => {', '"spin-main": requestMainSpin');
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
  assert.ok(market.indexOf("if (!finishConfirmed || terminalFinishUseId())") < market.indexOf('callRouletteTrainingAction("state")'));
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
  assert.ok(start.indexOf("await flushFinishRetry()") < start.indexOf('if (!preview && state.screen === "market") loadMarket()'));
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
  assert.match(market, /finishConfirmed = await flushFinishRetry\(\)[\s\S]*?!finishConfirmed \|\| terminalFinishUseId\(\)[\s\S]*?return;[\s\S]*?callRouletteTrainingAction\("state"\)/);
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

test("market reuses packs from state and only falls back to browse for an older response", () => {
  const applyState = sourceBlock(client, "function applyServerMarketState", "function invalidateMarketInsights");
  const market = sourceBlock(client, "async function loadMarket", "async function loadPackRankings");
  assert.match(applyState, /hasOwnProperty\.call\(payload, "packs"\) && Array\.isArray\(payload\.packs\)/);
  assert.match(applyState, /state\.marketPacks = payload\.packs[\s\S]*?state\.marketLoaded = true/);
  assert.match(market, /const serverState = await callRouletteTrainingAction\("state"\)/);
  assert.match(market, /if \(!Array\.isArray\(serverState\.packs\)\) \{[\s\S]*?callRouletteTrainingAction\("browse"\)/);
  assert.doesNotMatch(market, /Promise\.all\([\s\S]*?callRouletteTrainingAction\("state"\)[\s\S]*?callRouletteTrainingAction\("browse"\)/);
  assert.equal((market.match(/callRouletteTrainingAction\("state"\)/g) || []).length, 1);
  assert.equal((market.match(/callRouletteTrainingAction\("browse"\)/g) || []).length, 1);
});

test("popular pack ranking is lazy, period cached, Top 20, and uses competition ranks", () => {
  const marketRender = sourceBlock(client, "function renderMarket()", "function renderPackDetail");
  const rankingRender = sourceBlock(client, "function renderRankingPanel", "function creatorPeriodCard");
  const rankingLoad = sourceBlock(client, "async function loadPackRankings", "async function loadCreatorStats");
  const marketLoad = sourceBlock(client, "async function loadMarket", "async function loadPackRankings");
  assert.match(marketRender, /パックを選ぶ[\s\S]*?人気ランキング/);
  assert.match(marketRender, /aria-pressed="\$\{state\.marketView === "packs"\}"/);
  assert.match(rankingRender, /data-roulette-ranking-period="monthly"[\s\S]*?data-roulette-ranking-period="lifetime"/);
  assert.match(rankingRender, /現在の内容を利用した「異なる購入者数」を優先/);
  assert.match(rankingRender, /両方同じパックは同順位/);
  assert.match(rankingRender, /順位によるPay報酬やトレーニング上の特典はありません/);
  assert.match(rankingLoad, /state\.rankingLoaded\[period\] && !force/);
  assert.match(rankingLoad, /state\.rankingPeriod !== period/);
  assert.match(rankingLoad, /if \(state\.rankingLoading\[period\]\) \{[\s\S]*?renderRankingView\(\);[\s\S]*?return;/);
  assert.match(rankingLoad, /callRouletteTrainingAction\("pack_rankings", \{ period \}\)/);
  assert.doesNotMatch(marketLoad, /pack_rankings/);

  const helper = sourceBlock(client, "function nonnegativeInteger", "function salesStatsFromServer");
  const sandbox = {};
  vm.runInNewContext(`const RANKING_PERIODS = ["monthly", "lifetime"];\n${helper}\nthis.result = rankingPayloadFromServer({ minimumUniqueBuyers: 3, rows: [\n    { id: "a", uniqueBuyers: 8, rankingUseCount: 12 },\n    { id: "b", uniqueBuyers: 7, rankingUseCount: 10 },\n    { id: "c", uniqueBuyers: 7, rankingUseCount: 10 },\n    { id: "d", uniqueBuyers: 6, rankingUseCount: 20 },\n    { id: "below", uniqueBuyers: 2, rankingUseCount: 50 }\n  ] }, "monthly");`, sandbox);
  assert.deepEqual(Array.from(sandbox.result.rows, (row) => row.rank), [1, 2, 2, 4]);
  assert.equal(sandbox.result.rows.length, 4);
});

test("ranking rows disclose current pack facts without exposing seller settlement totals", () => {
  const row = sourceBlock(client, "function rankingRow", "function renderRankingPanel");
  const payload = sourceBlock(client, "function rankingPayloadFromServer", "function salesStatsFromServer");
  const selection = sourceBlock(client, "async function selectRankedPack", "async function loadCreatorState");
  assert.match(row, /row\.title/);
  assert.match(row, /row\.sellerName/);
  assert.match(row, /row\.publicSellerId/);
  assert.match(row, /row\.price/);
  assert.match(row, /row\.revision/);
  assert.match(row, /row\.uniqueBuyers/);
  assert.match(row, /row\.rankingUseCount/);
  assert.match(row, /data-roulette-ranked-pack/);
  assert.doesNotMatch(row, /actualGross|rankingGross|netSales|feesPaid|sellerUid/);
  assert.match(row, /role="listitem"/);
  assert.match(row, /aria-label="\$\{row\.rank\}位"/);
  assert.match(payload, /row\?\.pack && typeof row\.pack === "object"/);
  assert.match(payload, /const candidate = packFromServer\(row\.pack\)/);
  assert.match(payload, /packIdentity\(candidate\) === packId && candidate\.status === "active"/);
  assert.match(selection, /state\.rankings\[state\.rankingPeriod\]\?\.rows[\s\S]*?\.find\(\(row\) => row\.packId === normalizedPackId\)\?\.pack/);
  assert.match(selection, /selectMarketPack\(normalizedPackId\);[\s\S]*?return;/);
});

test("creator dashboard keeps sales records separate from private workouts and shows eligibility gaps", () => {
  const dashboard = sourceBlock(client, "function renderCreatorDashboard", "function marketCard");
  const load = sourceBlock(client, "async function loadCreatorStats", "async function saveCreatorXProfile");
  const pack = sourceBlock(client, "function creatorPackCard", "function rouletteAchievementDefinitions");
  assert.match(dashboard, /作者ダッシュボード/);
  assert.match(dashboard, /販売の記録、ランキング掲載までの進み具合、販売実績コレクション/);
  assert.match(dashboard, /プレイヤーの運動結果や画像は作者へ送信されません/);
  assert.match(load, /callRouletteTrainingAction\("creator_stats"\)/);
  assert.doesNotMatch(load, /image|bpm|clear|give_up|result/iu);
  assert.match(pack, /remainingUniqueBuyers/);
  assert.match(pack, /掲載まで、あと\$\{Math\.max\(0, pack\.remainingUniqueBuyers\)\}人/);
  assert.match(pack, /role="progressbar"/);
  assert.match(client, /roulette_training_pack_sales/);
  assert.match(client, /window\.HariaiAchievements\?\.catalog/);
  assert.match(load, /notifyCreatorAchievementUnlocks\(state\.creatorStats\.achievements\?\.pendingUnlocks\)/);
  const notify = sourceBlock(client, "function notifyCreatorAchievementUnlocks", "async function loadCreatorStats");
  assert.match(notify, /hariai-achievements-unlocked/);
  assert.match(notify, /action: "ack_achievements"/);
  assert.match(notify, /achievementIds: ids/);
});

test("optional X profile is scoped, validated, non-embedded, and confirmed before leaving", () => {
  const link = sourceBlock(client, "function xProfileLink", "function rankingRow");
  const open = sourceBlock(client, "function openConfirmedXProfile", "function rankingRow");
  const profile = sourceBlock(client, "function renderCreatorProfileForm", "function renderCreatorDashboard");
  const save = sourceBlock(client, "async function saveCreatorXProfile", "async function selectRankedPack");
  const binding = sourceBlock(client, "function bindEvents", "async function start");
  const normalization = sourceBlock(client, "function normalizedXHandle", "function publicXProfile");
  const validity = sourceBlock(client, "function updateXProfileFormValidity", "function bindEvents");
  assert.match(client, /X_EXTERNAL_CONFIRM_MESSAGE = "このXリンクはパック作者が自己申告したものです/);
  assert.match(link, /<button type="button" data-roulette-x-profile=/);
  assert.doesNotMatch(link, /href=|target=/);
  assert.match(link, /作者の自己申告・本人未確認/);
  assert.match(open, /window\.confirm\(X_EXTERNAL_CONFIRM_MESSAGE\)/);
  assert.match(open, /window\.open\([\s\S]*?`https:\/\/x\.com\/\$\{encodeURIComponent\(handle\)\}`[\s\S]*?"_blank"[\s\S]*?"noopener,noreferrer"/);
  assert.match(open, /externalWindow\.opener = null/);
  assert.match(profile, /ルーレットトレーニング専用の任意設定です。他の市場やモードからは引き継ぎません/);
  assert.match(profile, /現在と今後の掲載対象パック/);
  assert.match(profile, /本人確認、X API取得、投稿の埋め込み、閲覧追跡は行いません/);
  assert.match(profile, /OFFにして保存すると、販売実績と順位を残したままXリンクだけが非公開/);
  assert.match(save, /callRouletteTrainingAction\("save_profile", \{ xPublic, xHandle \}\)/);
  assert.match(save, /normalizedXHandle/);
  assert.match(save, /invalidateMarketInsights\(\)/);
  assert.match(profile, /<form id="rouletteTrainingXProfileForm" novalidate>/);
  assert.doesNotMatch(profile, /pattern=/);
  assert.match(normalization, /\.normalize\("NFKC"\)/);
  assert.match(validity, /const valid = !consent\.checked \|\| Boolean\(normalizedXHandle\(input\.value\)\)/);
  assert.match(validity, /input\.setCustomValidity/);
  assert.match(binding, /querySelectorAll\("button\[data-roulette-x-profile\]"\)/);
  assert.match(binding, /openConfirmedXProfile\(button\.dataset\.rouletteXProfile\)/);
  assert.doesNotMatch(binding, /addEventListener\("auxclick"/);
  assert.doesNotMatch(client, /platform\.twitter|widgets\.js|api\.x\.com/);

  const normalizeSandbox = {};
  vm.runInNewContext(`${normalization}\nthis.normalizeX = normalizedXHandle;`, normalizeSandbox);
  assert.equal(normalizeSandbox.normalizeX("  ＠Ｃｒｅａｔｏｒ＿１  "), "Creator_1");
  assert.equal(normalizeSandbox.normalizeX("https://x.com/Creator_1"), "");

  const input = {
    value: "invalid handle",
    required: false,
    setCustomValidity(value) { this.validationMessage = value; },
    setAttribute(name, value) { this[name] = value; },
  };
  const consent = { checked: false };
  const submit = { disabled: true };
  const form = {
    querySelector(selector) {
      if (selector.includes("xHandle")) return input;
      if (selector.includes("xPublic")) return consent;
      return submit;
    },
  };
  const validitySandbox = { state: { profileBusy: false }, form, input, consent, submit };
  vm.runInNewContext(`${normalization}\n${validity}\nupdateXProfileFormValidity(form);`, validitySandbox);
  assert.equal(input.required, false);
  assert.equal(input.validationMessage, "");
  assert.equal(submit.disabled, false, "OFF remains savable even if the dormant handle is invalid");
  consent.checked = true;
  vm.runInNewContext(`${normalization}\n${validity}\nupdateXProfileFormValidity(form);`, validitySandbox);
  assert.equal(input.required, true);
  assert.notEqual(input.validationMessage, "");
  assert.equal(submit.disabled, true);
});

test("ranking preview seeds both periods and opens details without a browse dependency", () => {
  const preview = sourceBlock(client, "function seedMarketInsightsPreview", "function friendlyError");
  const selection = sourceBlock(client, "async function selectRankedPack", "async function loadCreatorState");
  assert.match(preview, /state\.rankings\.monthly = rankingPayloadFromServer/);
  assert.match(preview, /state\.rankings\.lifetime = rankingPayloadFromServer/);
  assert.match(preview, /state\.rankingLoaded = \{ monthly: true, lifetime: true \}/);
  assert.match(preview, /state\.marketPacks = rows\.map\(\(row\) => packFromServer\(row\.pack\)\)/);
  assert.match(preview, /pack:\s*\{[\s\S]*?items: FREE_PACK\.items\.map/);
  assert.match(selection, /const rankedPack = state\.rankings\[state\.rankingPeriod\]/);
  assert.match(selection, /if \(rankedPack && packIdentity\(rankedPack\) === normalizedPackId\)/);
});

test("ranking switches and X profile save restore focus before their final live announcement", () => {
  const rankingLoad = sourceBlock(client, "async function loadPackRankings", "function notifyCreatorAchievementUnlocks");
  const save = sourceBlock(client, "async function saveCreatorXProfile", "async function selectRankedPack");
  assert.match(rankingLoad, /render\(\);[\s\S]*?restoreFocusAfterRender\(focusSelector\);[\s\S]*?if \(notify && announcement\) announce\(announcement\)/);
  assert.match(save, /render\(\);[\s\S]*?restoreFocusAfterRender\('#rouletteTrainingXProfileForm button\[type="submit"\]'\);[\s\S]*?announce\(successAnnouncement\)/);
});

test("ranking and creator UI stays keyboard-readable and collapses without horizontal card overflow", () => {
  assert.match(client, /role="group" aria-label="市場の表示"/);
  assert.match(client, /role="group" aria-label="ランキング期間"/);
  assert.match(client, /aria-busy="\$\{loading\}"/);
  assert.match(client, /role="list"/);
  assert.match(client, /aria-valuemin="0" aria-valuemax="3"/);
  assert.match(styles, /\.roulette-training-market-switcher button,[\s\S]*?min-height:\s*46px/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*?\.roulette-training-ranking-row\s*\{[\s\S]*?grid-template-columns:\s*58px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.roulette-training-creator-pack\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.roulette-training-achievement-family > ol\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.roulette-training-achievement-family li > span\s*\{[\s\S]*?white-space:\s*normal/);
  assert.match(styles, /\.roulette-training-market-switcher button,[\s\S]*?white-space:\s*nowrap/);
  assert.match(styles, /\.roulette-training-screen \.roulette-training-x-input input\[type="text"\]\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(styles, /\.roulette-training-x-input:focus-within\s*\{[\s\S]*?border-color:\s*var\(--rt-rose-deep\)/);
  assert.match(styles, /\.roulette-training-ranking-copy h3\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("multiple cheer lines rotate every eight active seconds without changing gameplay state", () => {
  const stage = sourceBlock(client, "function renderStage", "function mainReelItems");
  const helpers = sourceBlock(client, "function menuCheerLines", "function updateCheerBubble");
  const rotation = sourceBlock(client, "function updateCheerBubble", "function settleMainSpin");
  const clearTimers = sourceBlock(client, "function clearRuntimeTimers", "function ensureAudioContext");
  const begin = sourceBlock(client, "function beginChallenge", "function scheduleTemporaryEffectExpiry");
  const workout = sourceBlock(client, "function updateWorkout", "function pauseChallengeForVisibility");
  const reduced = styles.slice(styles.indexOf("@media (prefers-reduced-motion: reduce)"));

  assert.match(client, /CHEER_ROTATION_INTERVAL_MS = 8_000/);
  assert.match(client, /CHEER_EXIT_DURATION_MS = 160/);
  assert.match(client, /CHEER_ENTRY_DURATION_MS = 240/);
  assert.match(stage, /<p data-roulette-cheer-text>/);
  assert.doesNotMatch(stage, /aria-live=/);
  assert.match(rotation, /prefersReducedMotion\(\)[\s\S]*?text\.textContent = cheer/);
  assert.match(rotation, /text\.classList\.add\("is-leaving"\)[\s\S]*?CHEER_EXIT_DURATION_MS/);
  assert.match(rotation, /text\.classList\.add\("is-entering"\)[\s\S]*?CHEER_ENTRY_DURATION_MS/);
  assert.match(rotation, /document\.visibilityState === "hidden"/);
  assert.match(rotation, /session\?\.phase !== "active"/);
  assert.match(rotation, /session\.challengeTimedOut/);
  assert.match(rotation, /menuCheerLines\(session\.currentMenu\)\.length < 2/);
  assert.match(rotation, /state\.screen !== "play"/);
  assert.match(rotation, /\(\) => rotateCheer\(session, menuId\),\s*CHEER_ROTATION_INTERVAL_MS/);
  assert.match(rotation, /session !== expectedSession/);
  assert.match(rotation, /String\(session\.currentMenu\?\.id \|\| ""\) !== expectedMenuId/);
  assert.match(rotation, /session\.currentCheer = nextCheer;[\s\S]*?persistSession\(\);[\s\S]*?updateCheerBubble\(nextCheer\)/);
  assert.doesNotMatch(rotation, /\brender\(\)|\bannounce\(/);
  assert.doesNotMatch(rotation, /Math\.random|cheerForMenu\(/);
  assert.match(begin, /scheduleMetronome\(\);[\s\S]*?scheduleCheerRotation\(\);[\s\S]*?scheduleTemporaryEffectExpiry\(\)/);
  assert.match(clearTimers, /clearTimeout\(cheerRotationTimer\)/);
  assert.match(clearTimers, /clearTimeout\(cheerTransitionTimer\)/);
  assert.match(workout, /clearTimeout\(cheerRotationTimer\)[\s\S]*?clearTimeout\(cheerTransitionTimer\)/);

  assert.match(styles, /\.roulette-training-speech-bubble p\.is-leaving\s*\{[\s\S]*?roulette-training-cheer-out 160ms/);
  assert.match(styles, /\.roulette-training-speech-bubble p\.is-entering\s*\{[\s\S]*?roulette-training-cheer-in 240ms/);
  assert.match(reduced, /\.roulette-training-speech-bubble p:is\(\.is-leaving, \.is-entering\)/);

  const sandbox = {};
  vm.runInNewContext(`function builtinManagerLines() { return null; }
    ${helpers}
    Math.random = () => 0;
    this.rotation = {
      lines: menuCheerLines({ cheerLines: ["はじめ", "つぎ", "さいご", "つぎ", ""] }),
      firstWithoutRepeat: cheerForMenu({ cheerLines: ["はじめ", "つぎ", "さいご"] }, "はじめ"),
      next: nextCheerForMenu({ cheerLines: ["はじめ", "つぎ", "さいご"] }, "つぎ"),
      wrapped: nextCheerForMenu({ cheerLines: ["はじめ", "つぎ", "さいご"] }, "さいご"),
      single: nextCheerForMenu({ cheerLines: ["固定"] }, "固定"),
    };
    Math.random = () => 0.6;
    this.rotation.weightedDuplicate = cheerForMenu({ cheerLines: ["A", "A", "B"] });`, sandbox);
  assert.deepEqual(Array.from(sandbox.rotation.lines), ["はじめ", "つぎ", "さいご"]);
  assert.equal(sandbox.rotation.firstWithoutRepeat, "つぎ");
  assert.equal(sandbox.rotation.next, "さいご");
  assert.equal(sandbox.rotation.wrapped, "はじめ");
  assert.equal(sandbox.rotation.single, "固定");
  assert.equal(sandbox.rotation.weightedDuplicate, "A");

  const runtimeSandbox = {};
  vm.runInNewContext(`
    function builtinManagerLines() { return null; }
    const CHEER_ROTATION_INTERVAL_MS = 8_000;
    const CHEER_EXIT_DURATION_MS = 160;
    const CHEER_ENTRY_DURATION_MS = 240;
    let cheerRotationTimer = null;
    let cheerTransitionTimer = null;
    let active = true;
    let randomCalls = 0;
    Math.random = () => { randomCalls += 1; return 0; };
    const callbacks = [];
    const window = {
      clearTimeout() {},
      setTimeout(callback, delay) {
        callbacks.push({ callback, delay });
        return callbacks.length;
      },
    };
    const document = { visibilityState: "visible" };
    const classes = new Set();
    const text = {
      isConnected: true,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
      },
      value: "最初",
      set textContent(value) { this.value = value; },
      get textContent() { return this.value; },
    };
    const bubble = {
      querySelector(selector) { return selector === "[data-roulette-cheer-text]" ? text : null; },
    };
    const appRoot = {
      querySelector(selector) { return selector === ".roulette-training-speech-bubble" ? bubble : null; },
    };
    let persisted = 0;
    function persistSession() { persisted += 1; }
    let reducedMotion = true;
    function prefersReducedMotion() { return reducedMotion; }
    const state = {
      screen: "play",
      session: {
        phase: "active",
        challengeTimedOut: false,
        currentMenu: { id: "menu-1", cheerLines: ["最初", "次", "最後"] },
        currentCheer: "最初",
      },
    };
    ${helpers}
    ${rotation}
    scheduleCheerRotation();
    const firstDelay = callbacks[0].delay;
    callbacks.shift().callback();
    const afterFirst = {
      cheer: state.session.currentCheer,
      visible: text.textContent,
      persisted,
      pending: callbacks.length,
      randomCalls,
    };
    state.session.phase = "paused";
    callbacks.shift().callback();
    const afterPausedCallback = { cheer: state.session.currentCheer, pending: callbacks.length };
    state.session.phase = "active";
    scheduleCheerRotation();
    state.session.currentMenu = { id: "menu-2", cheerLines: ["別1", "別2"] };
    state.session.currentCheer = "別1";
    callbacks.shift().callback();
    const afterStaleCallback = { cheer: state.session.currentCheer, pending: callbacks.length };
    state.session.currentMenu = { id: "menu-3", cheerLines: ["固定"] };
    callbacks.length = 0;
    scheduleCheerRotation();
    const singleLinePending = callbacks.length;
    state.session.currentMenu = { id: "menu-4", cheerLines: ["甲", "乙"] };
    state.session.currentCheer = "甲";
    state.session.phase = "active";
    text.textContent = "甲";
    callbacks.length = 0;
    reducedMotion = false;
    scheduleCheerRotation();
    callbacks.shift().callback();
    const afterExitQueued = {
      visible: text.textContent,
      classes: Array.from(classes),
      delays: callbacks.map((entry) => entry.delay),
    };
    const exitIndex = callbacks.findIndex((entry) => entry.delay === CHEER_EXIT_DURATION_MS);
    callbacks.splice(exitIndex, 1)[0].callback();
    const afterSwap = {
      visible: text.textContent,
      classes: Array.from(classes),
      delays: callbacks.map((entry) => entry.delay),
    };
    const entryIndex = callbacks.findIndex((entry) => entry.delay === CHEER_ENTRY_DURATION_MS);
    callbacks.splice(entryIndex, 1)[0].callback();
    const afterEntry = { visible: text.textContent, classes: Array.from(classes) };
    this.runtime = {
      firstDelay,
      afterFirst,
      afterPausedCallback,
      afterStaleCallback,
      singleLinePending,
      afterExitQueued,
      afterSwap,
      afterEntry,
    };
  `, runtimeSandbox);
  assert.equal(runtimeSandbox.runtime.firstDelay, 8_000);
  assert.deepEqual({ ...runtimeSandbox.runtime.afterFirst }, {
    cheer: "次",
    visible: "次",
    persisted: 1,
    pending: 1,
    randomCalls: 0,
  });
  assert.deepEqual({ ...runtimeSandbox.runtime.afterPausedCallback }, { cheer: "次", pending: 0 });
  assert.deepEqual({ ...runtimeSandbox.runtime.afterStaleCallback }, { cheer: "別1", pending: 0 });
  assert.equal(runtimeSandbox.runtime.singleLinePending, 0);
  assert.deepEqual({
    visible: runtimeSandbox.runtime.afterExitQueued.visible,
    classes: Array.from(runtimeSandbox.runtime.afterExitQueued.classes),
    delays: Array.from(runtimeSandbox.runtime.afterExitQueued.delays),
  }, { visible: "甲", classes: ["is-leaving"], delays: [160, 8_000] });
  assert.deepEqual({
    visible: runtimeSandbox.runtime.afterSwap.visible,
    classes: Array.from(runtimeSandbox.runtime.afterSwap.classes),
    delays: Array.from(runtimeSandbox.runtime.afterSwap.delays),
  }, { visible: "乙", classes: ["is-entering"], delays: [8_000, 240] });
  assert.deepEqual({
    visible: runtimeSandbox.runtime.afterEntry.visible,
    classes: Array.from(runtimeSandbox.runtime.afterEntry.classes),
  }, { visible: "乙", classes: [] });
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
  assert.match(result, /goalCleared \? "result_completed" : "result_give_up"/);
  assert.equal(result.match(/data-roulette-action="end-training"/g)?.length, 1);
  assert.match(result, /記録を閉じる/);
  assert.match(result, /TODAY'S CONTROL LOG/);
  assert.doesNotMatch(result, /もう一度遊ぶ|モード選択へ戻る/);
  assert.match(client, /結果画面の「記録を閉じる」で終了してください/);
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
