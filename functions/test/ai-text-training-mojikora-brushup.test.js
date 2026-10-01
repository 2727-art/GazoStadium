"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const client = read("ai-text-training.js");
const styles = read("ai-text-training.css");
const html = read("index.html");
const design = read("AI_TEXT_TRAINING_DESIGN.md");
const coreModule = import(pathToFileURL(path.join(root, "ai-text-training-core.mjs")).href);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `source marker is available: ${startMarker}`);
  assert.ok(end > start, `source marker follows ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function doodleApi() {
  const context = vm.createContext({
    AI_TEXT_TRAINING_ROUND_COUNT: 5,
    CHEER_PRESENTATION_PREFERENCE_KEY: "cheer-mode",
    CHEER_PRESENTATIONS: new Set(["doodle", "classic"]),
    DEFAULT_CHEER_PRESENTATION: "doodle",
    DOODLE_MAX_GRAPHEMES: 84,
    DOODLE_ANCHORS: Object.freeze([
      "upper-left",
      "upper-right",
      "middle-left",
      "middle-right",
      "lower-left",
      "lower-right",
    ]),
    DOODLE_LAYOUTS: Object.freeze([
      "center-vertical",
      "diagonal-banner",
      "twin-arch",
      "edge-frame",
      "cross-diagonal",
    ]),
    state: {
      roundIndex: 0,
      sessionStartedAt: 1_754_108_400_000,
      sessionCheerPresentation: "doodle",
    },
    readLocalValue(_key, fallback) {
      return fallback;
    },
    normalizeAiTextTrainingBpm(value) {
      const bpm = Number(value);
      return Number.isInteger(bpm) && (bpm === 0 || (bpm >= 40 && bpm <= 200))
        ? bpm
        : null;
    },
  });
  vm.runInContext(`
    ${sourceBlock(client, "function normalizeCheerPresentation", "function storedSession")}
    globalThis.__api = {
      DOODLE_BREAK_MARK,
      DOODLE_NO_BREAK_BEFORE,
      DOODLE_NO_BREAK_AFTER,
      doodleGraphemes,
      doodleMessageParts,
      normalizeDoodlePlacement,
      normalizeRoundArtwork,
    };
  `, context);
  return context.__api;
}

function assertNaturalParts(api, message) {
  const parts = Array.from(api.doodleMessageParts(message));
  assert.ok(parts.length >= 1 && parts.length <= 3, `${message}: ${parts.length} parts`);
  assert.equal(parts.join(""), message, `${message}: parts rebuild the line`);
  parts.forEach((part, index) => {
    const graphemes = api.doodleGraphemes(part);
    if (parts.length > 1) assert.ok(graphemes.length >= 2, `${message}: part "${part}" is too short`);
    if (index > 0) {
      const first = Array.from(part)[0];
      assert.ok(!api.DOODLE_NO_BREAK_BEFORE.has(first), `${message}: "${part}" starts with ${first}`);
      assert.doesNotMatch(first, /\s/u, `${message}: "${part}" starts with a space`);
      const previous = Array.from(parts[index - 1]);
      const last = previous[previous.length - 1];
      assert.ok(!api.DOODLE_NO_BREAK_AFTER.has(last), `${message}: "${parts[index - 1]}" ends with ${last}`);
      assert.ok(
        !(/[A-Za-z0-9]/u.test(last) && /[A-Za-z0-9]/u.test(first)),
        `${message}: a latin word is split at "${parts[index - 1]}|${part}"`,
      );
    }
  });
  return parts;
}

test("doodle blocks split at punctuation, spaces and word boundaries instead of mid-word", () => {
  const api = doodleApi();
  assert.deepEqual(Array.from(api.doodleMessageParts("リズムがきれいだよ")), ["リズムが", "きれいだよ"]);
  assert.deepEqual(Array.from(api.doodleMessageParts("いいスタート、その調子♡")), ["いいスタート、", "その調子♡"]);
  assert.deepEqual(
    Array.from(api.doodleMessageParts("準備できた？ 今日の分だけ一緒にやろう")),
    ["準備できた？ ", "今日の分だけ一緒にやろう"],
  );
  assert.deepEqual(Array.from(api.doodleMessageParts("短い台詞")), ["短い台詞"]);
  assertNaturalParts(api, "今日もnice paceだよ、その調子で最後までいこう");
  assertNaturalParts(api, "「いい感じ」って言える自分、ちゃんと見てるよ。呼吸を止めずにね！");
  assertNaturalParts(api, "ラストスパートっ、ゆっくりでも大丈夫〜");
});

test("every builtin line becomes natural doodle blocks", async () => {
  const core = await coreModule;
  const api = doodleApi();
  let checked = 0;
  Object.values(core.AI_TEXT_TRAINING_BUILTIN_SCRIPTS).forEach((script) => {
    Object.values(script.lines).flat().forEach((line) => {
      [0, 80, 140].forEach((bpm) => {
        const message = core.renderAiTextTrainingLine(line, { bpm, round: 3, remaining: 12 });
        assertNaturalParts(api, message);
        checked += 1;
      });
    });
  });
  assert.ok(checked > 100);
});

test("an author slash marks the block break and is never shown", async () => {
  const core = await coreModule;
  const api = doodleApi();
  const mark = core.AI_TEXT_TRAINING_LINE_BREAK_MARK;
  assert.equal(mark, "​");
  assert.equal(api.DOODLE_BREAK_MARK, mark);
  assert.equal(core.renderAiTextTrainingLine("準備OK？/今日も／一緒に"), `準備OK？${mark}今日も${mark}一緒に`);
  assert.equal(core.renderAiTextTrainingLine("前半 / 後半"), `前半${mark}後半`);
  assert.equal(core.renderAiTextTrainingLine("/前半//後半/"), `前半${mark}後半`);
  assert.equal(core.renderAiTextTrainingLine("{bpm}/BPM", { bpm: 100 }), `100${mark}BPM`);
  assert.equal(core.renderAiTextTrainingLine("区切りなしの台詞"), "区切りなしの台詞");

  const two = core.renderAiTextTrainingLine("いくよ/がんばろ");
  assert.deepEqual(Array.from(api.doodleMessageParts(two)), [`いくよ${mark}`, "がんばろ"]);
  const three = core.renderAiTextTrainingLine("準備OK？/今日も/一緒にいこうね");
  assert.deepEqual(
    Array.from(api.doodleMessageParts(three)),
    [`準備OK？${mark}`, `今日も${mark}`, "一緒にいこうね"],
  );
  const four = core.renderAiTextTrainingLine("あ/い/う/えおかきくけこ");
  const fourParts = Array.from(api.doodleMessageParts(four));
  assert.equal(fourParts.length, 3);
  assert.equal(fourParts.join(""), four);
});

test("text placement is normalized per artwork and survives a JSON round trip", () => {
  const api = doodleApi();
  assert.equal(api.normalizeDoodlePlacement("top"), "top");
  assert.equal(api.normalizeDoodlePlacement("bottom"), "bottom");
  assert.equal(api.normalizeDoodlePlacement("center"), "auto");
  assert.equal(api.normalizeDoodlePlacement(undefined), "auto");
  const artwork = api.normalizeRoundArtwork({
    version: 2,
    message: "リズムがきれいだよ",
    parts: ["リズムが", "きれいだよ"],
    layout: "twin-arch",
    placement: "top",
    presentation: "doodle",
    bpm: 100,
  }, 1);
  assert.equal(artwork.placement, "top");
  assert.equal(api.normalizeRoundArtwork(JSON.parse(JSON.stringify(artwork)), 1).placement, "top");
  const unsafe = api.normalizeRoundArtwork({ ...artwork, placement: "middle" }, 1);
  assert.equal(unsafe.placement, "auto");
  const older = api.normalizeRoundArtwork({ ...artwork, placement: undefined }, 1);
  assert.equal(older.placement, "auto");
});

async function myScriptsHarness({ writable = true } = {}) {
  const core = await coreModule;
  const storage = new Map();
  const context = vm.createContext({
    AI_TEXT_TRAINING_ROUND_COUNT: 5,
    AI_TEXT_TRAINING_MODES: core.AI_TEXT_TRAINING_MODES,
    AI_TEXT_TRAINING_SCRIPT_SLOTS: core.AI_TEXT_TRAINING_SCRIPT_SLOTS,
    AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS: core.AI_TEXT_TRAINING_ZONE_SCRIPT_SLOTS,
    normalizeAiTextTrainingProductType: core.normalizeAiTextTrainingProductType,
    normalizeAiTextTrainingScriptSnapshot: core.normalizeAiTextTrainingScriptSnapshot,
    normalizeDoodlePlacement: (value) => (["auto", "top", "bottom"].includes(value) ? value : "auto"),
    MY_SCRIPTS_STORAGE_KEY: "hariai-ai-text-training-my-scripts-v1",
    EDITOR_DRAFT_STORAGE_KEY: "hariai-ai-text-training-editor-draft-v1",
    MY_SCRIPTS_MAX_COUNT: 20,
    PROFILE_NAME_KEY: "profile-name",
    state: { myScripts: [], editorDraft: null, editorLocalScriptId: "" },
    ownPresetFor: () => null,
    readLocalValue: (key, fallback = "") => (storage.has(key) ? storage.get(key) : fallback),
    writeLocalValue: (key, value) => {
      if (!writable) return false;
      storage.set(key, value);
      return true;
    },
    removeLocalValue: (key) => storage.delete(key),
    window: { setTimeout, clearTimeout },
  });
  vm.runInContext(`
    ${sourceBlock(client, "function normalizeSessionPlacements", "function presetSnapshot")}
    globalThis.__api = {
      normalizeSessionPlacements,
      normalizeMyScript,
      readMyScripts,
      writeMyScripts,
      newMyScriptId,
      myScriptSnapshot,
      myScriptById,
      editorSlotStatus,
      editorProgress,
      validateMyScriptDraft,
      readEditorDraft,
      saveEditorDraftNow,
      clearEditorDraft,
      editorDraftFromMyScript,
    };
  `, context);
  return { api: context.__api, context, storage, core };
}

function myScriptRecord(core, overrides = {}) {
  return {
    id: "abc12345def",
    title: "ママの応援",
    description: "",
    modeId: "mama",
    productType: "standard",
    lines: JSON.parse(JSON.stringify(core.AI_TEXT_TRAINING_BUILTIN_SCRIPTS.mama.lines)),
    zoneLines: {},
    updatedAt: 1,
    ...overrides,
  };
}

test("my scripts stay on this device and become free local snapshots", async () => {
  const { api, context, storage, core } = await myScriptsHarness();
  assert.deepEqual(
    Array.from(api.normalizeSessionPlacements(["top", "sideways", "bottom"])),
    ["top", "auto", "bottom", "auto", "auto"],
  );

  const record = myScriptRecord(core);
  record.lines.start = ["準備OK？/今日も/一緒にいこうね", "今日の分だけ、一緒にやろう"];
  api.writeMyScripts([record]);
  const stored = JSON.parse(storage.get("hariai-ai-text-training-my-scripts-v1"));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, "abc12345def");
  assert.equal(context.state.myScripts.length, 1);
  assert.equal(api.readMyScripts()[0].title, "ママの応援");
  assert.equal(api.myScriptById("abc12345def").modeId, "mama");

  const snapshot = api.myScriptSnapshot(record);
  assert.equal(snapshot.id, "my_abc12345def");
  assert.equal(snapshot.price, 0);
  assert.equal(snapshot.authorName, "あなた");
  assert.equal(snapshot.modeId, "mama");
  assert.deepEqual(Array.from(snapshot.lines.start), ["準備OK？/今日も/一緒にいこうね", "今日の分だけ、一緒にやろう"]);

  assert.equal(api.normalizeMyScript({ ...record, id: "../bad" }), null);
  assert.equal(api.normalizeMyScript({ ...record, modeId: "unknown" }), null);
  assert.equal(api.normalizeMyScript({ ...record, lines: { ...record.lines, rest: ["一行だけ"] } }), null);
  assert.equal(
    api.normalizeMyScript({ ...record, productType: "defeat_zone", zoneLines: {} }),
    null,
  );

  const many = Array.from({ length: 25 }, (_, index) => myScriptRecord(core, {
    id: `script${String(index).padStart(4, "0")}`,
  }));
  assert.equal(api.writeMyScripts(many).length, 20);
  assert.match(api.newMyScriptId(), /^[a-z0-9]{8,40}$/u);

  storage.set("hariai-ai-text-training-my-scripts-v1", "{broken");
  assert.deepEqual(Array.from(api.readMyScripts()), []);
});

test("saving my script reports a device storage failure instead of pretending", async () => {
  const { api, core } = await myScriptsHarness({ writable: false });
  assert.throws(() => api.writeMyScripts([myScriptRecord(core)]), /この端末へ保存できませんでした/);
});

test("editor slot status, progress and validation match the publish rules", async () => {
  const { api, core } = await myScriptsHarness();
  assert.deepEqual({ ...api.editorSlotStatus(["いくよー"]) }, { ok: false, text: "あと1行（2〜4行）" });
  assert.equal(api.editorSlotStatus(["いくよ", "がんばろう"]).ok, false);
  assert.match(api.editorSlotStatus(["いくよー", "あ".repeat(43)]).text, /2行目が43文字です（42文字まで）/);
  assert.deepEqual(
    { ...api.editorSlotStatus(["いくよー", "がんばろうね"]) },
    { ok: true, text: "2行 · 最長6文字" },
  );

  const draft = {
    title: "テスト台本",
    modeId: "mama",
    productType: "standard",
    lines: JSON.parse(JSON.stringify(core.AI_TEXT_TRAINING_BUILTIN_SCRIPTS.mama.lines)),
    zoneLines: {},
  };
  assert.deepEqual({ ...api.editorProgress(draft) }, { ok: 14, total: 14 });
  api.validateMyScriptDraft(draft);
  draft.lines.rest = ["一行だけの休憩"];
  assert.deepEqual({ ...api.editorProgress(draft) }, { ok: 13, total: 14 });
  assert.throws(() => api.validateMyScriptDraft(draft), /「.+」：あと1行（2〜4行）/);
  assert.throws(() => api.validateMyScriptDraft({ ...draft, title: "" }), /台本名/);
  const zoneDraft = { ...draft, lines: JSON.parse(JSON.stringify(core.AI_TEXT_TRAINING_BUILTIN_SCRIPTS.mama.lines)), productType: "defeat_zone" };
  assert.deepEqual({ ...api.editorProgress(zoneDraft) }, { ok: 14, total: 19 });
});

test("the editor draft autosaves to this device and restores safely", async () => {
  const { api, context, storage, core } = await myScriptsHarness();
  api.writeMyScripts([myScriptRecord(core)]);
  context.state.editorDraft = {
    presetId: "",
    baseRevision: 0,
    sellerName: "PLAYER",
    modeId: "imouto",
    productType: "standard",
    title: "書きかけ",
    description: "",
    price: 10,
    lines: { start: ["前半/後半です", "もう一行"] },
    zoneLines: {},
  };
  context.state.editorLocalScriptId = "abc12345def";
  api.saveEditorDraftNow();
  const restored = api.readEditorDraft();
  assert.equal(restored.localScriptId, "abc12345def");
  assert.equal(restored.draft.modeId, "imouto");
  assert.equal(restored.draft.title, "書きかけ");
  assert.deepEqual(Array.from(restored.draft.lines.start), ["前半/後半です", "もう一行"]);
  assert.deepEqual(Array.from(restored.draft.lines.rest), []);

  context.state.editorLocalScriptId = "deleted0000";
  api.saveEditorDraftNow();
  assert.equal(api.readEditorDraft().localScriptId, "");

  storage.set("hariai-ai-text-training-editor-draft-v1", JSON.stringify({ draft: { modeId: "unknown" } }));
  assert.equal(api.readEditorDraft(), null);
  api.clearEditorDraft();
  assert.equal(storage.has("hariai-ai-text-training-editor-draft-v1"), false);
  assert.equal(api.readEditorDraft(), null);

  const fromScript = api.editorDraftFromMyScript(myScriptRecord(core));
  assert.equal(fromScript.title, "ママの応援");
  assert.equal(fromScript.sellerName, "PLAYER");
  assert.ok(fromScript.description.length >= 10);
});

test("placement is chosen per roster image and follows the draw into the session and artworks", () => {
  const card = sourceBlock(client, "function imageSetupCard", "function renderSetup");
  assert.match(card, /data-ai-text-training-placement="\$\{index\}"/);
  assert.match(card, /DOODLE_PLACEMENTS\.map/);
  assert.match(card, /\$\{bpmLocked \? "disabled" : ""\} \/><span>/);
  const persist = sourceBlock(client, "function persistSession", "function clearPersistedSession");
  assert.match(persist, /placements: normalizeSessionPlacements\(state\.placements\)/);
  const recovery = sourceBlock(client, "function recoverPaidSession", "function recoverPendingDefeatPresentation");
  assert.match(recovery, /state\.placements = normalizeSessionPlacements\(saved\.placements\)/);
  const newPlan = sourceBlock(client, "function newSessionPlan", "function continuePreparedSession");
  assert.match(newPlan, /state\.placements = drawIndices\.map\(\(index\) => normalizeDoodlePlacement\(entries\[index\]\.placement\)\)/);
  assert.match(sourceBlock(client, "function rosterEntries", "function invalidatePendingDraw"), /placement:/);
  const deck = sourceBlock(client, "async function writeStoredDeck", "async function readStoredDeck");
  assert.match(deck, /placement: entry\.placement/);
  const storedRecord = sourceBlock(client, "function normalizeStoredRosterRecord", "async function restoreStoredDeck");
  assert.match(storedRecord, /placement: \["top", "bottom"\]\.includes\(item\?\.placement\) \? item\.placement : "auto"/);
  assert.match(client, /targetState\.rosterPlacements = nextPlacements/);
  const cheer = sourceBlock(client, "function renderDoodleCheer", "function renderClassicCheer");
  assert.match(cheer, /data-att-doodle-placement="\$\{escapeHtml\(placement\)\}"/);
  assert.match(cheer, /state\.placements\?\.\[state\.roundIndex\]/);
  const capture = sourceBlock(client, "function captureRoundArtwork", "function supportMessage");
  assert.match(capture, /placement: normalizeDoodlePlacement\(state\.placements\?\.\[index\]\)/);
  const overlay = sourceBlock(client, "function renderResultArtworkOverlay", "function renderResultLineup");
  assert.match(overlay, /data-att-doodle-placement=/);
  const events = sourceBlock(client, "function bindEvents", 'document.addEventListener("visibilitychange"');
  assert.match(events, /state\.rosterPlacements\[index\] = normalizeDoodlePlacement\(input\.value\)/);
  assert.match(events, /persistRosterIfConsented\(\)/);
  assert.match(client, /state\.rosterImages\[index\] = null;\s*state\.rosterPlacements\[index\] = "auto";/);
  assert.match(client, /state\.rosterImages\[index\] = item;\s*state\.rosterPlacements\[index\] = "auto";/);
});

test("my scripts, editor helpers and artwork saving never reach the server", () => {
  const events = sourceBlock(client, "function bindEvents", 'document.addEventListener("visibilitychange"');
  const saveMyScript = sourceBlock(events, '"save-my-script": () => {', '"fill-empty-slots": () => {');
  assert.match(saveMyScript, /validateMyScriptDraft\(draft\)/);
  assert.match(saveMyScript, /writeMyScripts\(scripts\)/);
  assert.match(saveMyScript, /MY_SCRIPTS_MAX_COUNT/);
  assert.doesNotMatch(saveMyScript, /callable|fetch\(|httpsCallable|Firestore|setDoc|anjuPay/i);
  const useMyScript = sourceBlock(events, "[data-ai-text-training-use-my-script]", "[data-ai-text-training-edit-my-script]");
  assert.match(useMyScript, /state\.selectedPresetSource = "local"/);
  assert.match(useMyScript, /presetSupportsPlayStyle\(snapshot\)/);
  assert.match(useMyScript, /if \(state\.activeUse\)/);
  const deleteMyScript = sourceBlock(events, "[data-ai-text-training-delete-my-script]", "[data-ai-text-training-save-artwork]");
  assert.match(deleteMyScript, /window\.confirm/);
  assert.match(deleteMyScript, /state\.selectedPresetSource = "builtin"/);

  const editorAction = sourceBlock(events, "    editor: () => {", '"discard-editor-draft": () => {');
  assert.match(editorAction, /const stored = readEditorDraft\(\)/);
  assert.match(editorAction, /state\.editorDraftRestored = true/);
  assert.match(events, /updateEditorDraftFromForm\(control\.form\);\s*scheduleEditorDraftSave\(\);\s*refreshEditorLiveDom\(\);/);
  assert.match(events, /data-ai-text-training-slot-fill/);
  assert.match(events, /data-ai-text-training-slot-copy/);
  const reset = sourceBlock(client, "function resetForAnotherSession", "function bindEvents");
  assert.match(reset, /const repeatLocalPreset = state\.selectedPresetSource === "local"/);
  assert.match(
    reset,
    /else if \(repeatLocalPreset && !state\.activeUse\) \{\s*state\.selectedPreset = previousPreset;\s*state\.selectedPresetSource = "local";/,
  );

  const exporter = sourceBlock(client, "async function saveRoundArtworkToDevice", "function renderResultArtworkOverlay");
  assert.match(exporter, /canvas\.toBlob\(/);
  assert.match(exporter, /"image\/jpeg"/);
  assert.match(exporter, /saveBlobToDevice\(blob, `mojikora-round\$\{index \+ 1\}-/);
  assert.match(exporter, /host\.remove\(\)/);
  assert.match(exporter, /state\.artworkExportBusy = false/);
  const exportHelpers = sourceBlock(client, "function saveBlobToDevice", "async function saveRoundArtworkToDevice");
  assert.match(exportHelpers, /link\.download = filename/);
  assert.match(exportHelpers, /URL\.revokeObjectURL/);
  const exportAll = sourceBlock(client, "function loadArtworkImage", "function renderResultArtworkOverlay");
  assert.doesNotMatch(exportAll, /fetch\(|navigator\.share|XMLHttpRequest|callable|sendBeacon|firebase/i);
  const lineup = sourceBlock(client, "function renderResultLineup", "function renderAiTextTrainingLightResult");
  assert.match(lineup, /data-ai-text-training-save-artwork="\$\{index\}"/);
  assert.match(lineup, /この端末にだけ保存します（投稿・共有はしません）/);
});

test("the editor shows the script on an image with every layout and placement", () => {
  const editor = sourceBlock(client, "function renderEditor()", "function renderEditorReview");
  assert.match(editor, /save-my-script/);
  assert.match(editor, /discard-editor-draft/);
  assert.match(editor, /fill-empty-slots/);
  assert.match(editor, /data-ai-text-training-editor-progress/);
  assert.match(editor, /<code>\/<\/code>/);
  assert.match(editor, /renderEditorCollage\(draft\)/);
  const collage = sourceBlock(client, "function renderEditorCollage", "function renderEditor()");
  assert.match(collage, /DOODLE_LAYOUTS\.map/);
  assert.match(collage, /DOODLE_PLACEMENTS\.map/);
  assert.match(collage, /renderDoodleCompositionContents\(message/);
  assert.match(collage, /rosterEntries\(\)\[0\]\?\.image\?\.url/);
  const live = sourceBlock(client, "function refreshEditorLiveDom", "function validateEditorDraft");
  assert.match(live, /updateDoodleSurfaceDom\(collage, message, \{ layout: editorPreviewLayout\(\) \}\)/);
  assert.doesNotMatch(live, /innerHTML/);
});

test("styles hide the overlapping stamp and keep placement bands, controls and export host safe", () => {
  assert.match(
    styles,
    /\.ai-text-training-doodle-cheer,\s*\.ai-text-training-result-doodle,\s*\.ai-text-training-editor-doodle,\s*\.ai-text-training-artwork-export-doodle\s*\)\.is-collage \.att-doodle-meta \{\s*display: none;/,
  );
  assert.match(styles, /\.is-collage:not\(\[hidden\]\):is\(\[data-att-doodle-placement="top"\], \[data-att-doodle-placement="bottom"\]\) \{\s*display: flex !important;/);
  assert.match(styles, /\.is-collage\[data-att-doodle-placement="top"\] \{\s*justify-content: flex-start;/);
  assert.match(styles, /\.is-collage\[data-att-doodle-placement="bottom"\] \{\s*justify-content: flex-end;/);
  assert.match(styles, /writing-mode: horizontal-tb !important;/);
  assert.match(styles, /\.ai-text-training-placement-control input:focus-visible \+ span \{\s*outline: 3px solid var\(--att-cyan\);/);
  assert.match(styles, /\.ai-text-training-mini-button:focus-visible \{\s*outline: 3px solid var\(--att-cyan\);/);
  assert.match(styles, /\.ai-text-training-artwork-export-host \{\s*position: fixed;\s*top: 0;\s*left: -10000px;/);
  assert.match(styles, /figure \.ai-text-training-result-doodle\.is-collage \{\s*bottom: auto;\s*height: auto;\s*aspect-ratio: 9 \/ 14;/);
});

test("cache tokens and the design notes cover the brushup", () => {
  assert.match(html, /ai-text-training\.css\?v=[^"]*mojikora-brushup-v1"/);
  assert.match(html, /ai-text-training\.js\?v=[^"]*mojikora-brushup-v1-tribute-v1"/);
  assert.match(client, /ai-text-training-core\.mjs\?v=[^"]*mojikora-brushup-v1"/);
  assert.match(design, /### 6\.1\.1 マイ台本（端末内・無料）/);
  assert.match(design, /hariai-ai-text-training-my-scripts-v1/);
  assert.match(design, /文字の位置は、ロスター画像ごとに`おまかせ`/);
  assert.match(design, /`画像で保存`[\s\S]*?投稿、共有シート、Firebase送信、サーバー保存、報酬、ランキングは行わない/);
  assert.match(design, /行の中の`\/`（または`／`）は、画像の上で文字ブロックを分ける位置の指定/);
});
