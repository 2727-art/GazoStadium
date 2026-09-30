const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const roleplayModule = import(
  pathToFileURL(path.join(root, "finish-roleplay.mjs")).href,
);

test("beginner voice sets provide a complete, bounded roleplay trio", async () => {
  const {
    MAX_FINISH_REPLY_LENGTH,
    ROLEPLAY_VOICE_SETS,
    countFinishReplyCharacters,
    inferRoleplayVoiceSetId,
  } = await roleplayModule;

  assert.deepEqual(
    ROLEPLAY_VOICE_SETS.map(({ id }) => id),
    ["tsuyotsuyo", "yowayowa", "koakuma", "oneesan", "amaenbo", "seiso"],
  );
  for (const voiceSet of ROLEPLAY_VOICE_SETS) {
    assert.ok(voiceSet.pursuitLine.length <= 40, `${voiceSet.id} pursuit line is too long`);
    assert.ok(voiceSet.finishLine.length <= 30, `${voiceSet.id} finish line is too long`);
    assert.ok(
      countFinishReplyCharacters(voiceSet.replyLine) <= MAX_FINISH_REPLY_LENGTH,
      `${voiceSet.id} reply line is too long`,
    );
    assert.doesNotMatch(
      `${voiceSet.pursuitLine}${voiceSet.finishLine}${voiceSet.replyLine}`,
      /[\r\n]/,
    );
    assert.equal(inferRoleplayVoiceSetId(voiceSet), voiceSet.id);
  }
});

test("custom finish replies allow forty characters and one intentional line break", async () => {
  const {
    MAX_FINISH_REPLY_INPUT_UNITS,
    MAX_FINISH_REPLY_LENGTH,
    countFinishReplyCharacters,
    normalizeFinishReplyLine,
    normalizeReceivedFinishReplyLine,
    sanitizeFinishReplyDraft,
  } = await roleplayModule;
  const draft = `${"あ".repeat(20)}\r\n${"い".repeat(15)}\n${"う".repeat(20)}`;
  const sanitized = sanitizeFinishReplyDraft(draft);

  assert.equal(countFinishReplyCharacters(sanitized), MAX_FINISH_REPLY_LENGTH);
  assert.equal((sanitized.match(/\n/g) || []).length, 1);
  assert.equal(normalizeFinishReplyLine("  一言目  \n  二言目  "), "一言目\n二言目");
  assert.equal(normalizeFinishReplyLine(" \n ", ""), "");
  assert.equal(normalizeReceivedFinishReplyLine(""), "");
  assert.equal(MAX_FINISH_REPLY_INPUT_UNITS, MAX_FINISH_REPLY_LENGTH * 2);
});

test("custom finish replies never split a supplementary Unicode character", async () => {
  const {
    MAX_FINISH_REPLY_LENGTH,
    countFinishReplyCharacters,
    sanitizeFinishReplyDraft,
  } = await roleplayModule;
  const fullEmojiAtBoundary = `${"あ".repeat(MAX_FINISH_REPLY_LENGTH - 1)}😀`;
  const truncatedAfterBoundary = `${"あ".repeat(MAX_FINISH_REPLY_LENGTH)}😀`;

  assert.equal(sanitizeFinishReplyDraft(fullEmojiAtBoundary), fullEmojiAtBoundary);
  assert.equal(
    countFinishReplyCharacters(sanitizeFinishReplyDraft(fullEmojiAtBoundary)),
    MAX_FINISH_REPLY_LENGTH,
  );
  assert.equal(
    sanitizeFinishReplyDraft(truncatedAfterBoundary),
    "あ".repeat(MAX_FINISH_REPLY_LENGTH),
  );
});

test("custom reply visibility falls back to the sender's safe voice set", async () => {
  const {
    getRoleplayVoiceSet,
    resolveVisibleFinishReplyLine,
  } = await roleplayModule;
  const custom = "この物語は\nまだ終わらない";

  assert.deepEqual(
    resolveVisibleFinishReplyLine(custom, { showCustom: true, voiceSetId: "koakuma" }),
    { line: custom, custom: true, replaced: false },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine(custom, { showCustom: false, voiceSetId: "koakuma" }),
    { line: getRoleplayVoiceSet("koakuma").replyLine, custom: true, replaced: true },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine("", { showCustom: false, voiceSetId: "koakuma" }),
    { line: "", custom: false, replaced: false },
  );
});

test("girl persona voice sets match the strategy persona types and stay within limits", async () => {
  const {
    CARD_CAPTION_TEMPLATES,
    MAX_CARD_CAPTION_LENGTH,
    RETIRED_FINISH_LINES,
    RETIRED_FINISH_REPLY_LINES,
    RETIRED_PURSUIT_LINES,
    ROLEPLAY_VOICE_SETS,
  } = await roleplayModule;
  const core = await import(pathToFileURL(path.join(root, "strategy-hariai-core.mjs")).href);
  assert.deepEqual(
    ROLEPLAY_VOICE_SETS.map(({ id, label }) => [id, label]),
    core.HARIAI_PERSONA_TYPES.map(({ id, label }) => [id, label]),
  );
  for (const voiceSet of ROLEPLAY_VOICE_SETS) {
    assert.ok(Array.from(voiceSet.cardLine).length <= MAX_CARD_CAPTION_LENGTH, `${voiceSet.id} card line`);
    assert.ok(CARD_CAPTION_TEMPLATES.includes(voiceSet.cardLine));
    for (const band of ["low", "mid", "high"]) {
      assert.equal(voiceSet.reactions[band].length, 2, `${voiceSet.id}.${band}`);
      for (const line of voiceSet.reactions[band]) assert.match(line, /\{score\}/, `${voiceSet.id}.${band} mentions the score`);
    }
    assert.equal(RETIRED_PURSUIT_LINES.includes(voiceSet.pursuitLine), false);
    assert.equal(RETIRED_FINISH_LINES.includes(voiceSet.finishLine), false);
    assert.equal(RETIRED_FINISH_REPLY_LINES.includes(voiceSet.replyLine), false);
  }
});

test("card captions are single-line, bounded, and hidden free text falls back to the persona", async () => {
  const { MAX_CARD_CAPTION_LENGTH, normalizeCardCaption, resolveVisibleCardCaption, getRoleplayVoiceSet } = await roleplayModule;
  assert.equal(normalizeCardCaption("  こんにちは\n\nまたね  "), "こんにちは またね");
  assert.equal(Array.from(normalizeCardCaption("あ".repeat(40))).length, MAX_CARD_CAPTION_LENGTH);
  assert.equal(normalizeCardCaption(null), "");
  assert.deepEqual(resolveVisibleCardCaption("", { showCustom: false }), { caption: "", custom: false, replaced: false });
  assert.deepEqual(resolveVisibleCardCaption("ここ見て", { showCustom: true, voiceSetId: "seiso" }), { caption: "ここ見て", custom: true, replaced: false });
  assert.deepEqual(
    resolveVisibleCardCaption("ここ見て", { showCustom: false, voiceSetId: "seiso" }),
    { caption: getRoleplayVoiceSet("seiso").cardLine, custom: true, replaced: true },
  );
  const template = getRoleplayVoiceSet("amaenbo").cardLine;
  assert.deepEqual(resolveVisibleCardCaption(template, { showCustom: false }), { caption: template, custom: false, replaced: false });
});

test("score reactions follow the 1-10 bands and are re-checked against the revealed score", async () => {
  const { resolveScoreReaction, scoreReactionBand, scoreReactionOptions } = await roleplayModule;
  assert.deepEqual([1, 6, 7, 8, 9, 10].map(scoreReactionBand), ["low", "low", "mid", "mid", "high", "high"]);
  assert.equal(scoreReactionBand(0), "");
  assert.equal(scoreReactionBand(11), "");
  const options = scoreReactionOptions("tsuyotsuyo", 8);
  assert.deepEqual(options.map(({ band, index }) => [band, index]), [["mid", 0], ["mid", 1]]);
  assert.match(options[0].text, /8点/);
  assert.equal(resolveScoreReaction({ voiceSetId: "tsuyotsuyo", band: "mid", index: 0, score: 8 }), options[0].text);
  assert.equal(resolveScoreReaction({ voiceSetId: "tsuyotsuyo", band: "high", index: 0, score: 8 }), "", "a band that does not match the score is ignored");
  assert.equal(resolveScoreReaction({ voiceSetId: "unknown", band: "mid", index: 0, score: 8 }), "");
  assert.equal(resolveScoreReaction({ voiceSetId: "tsuyotsuyo", band: "mid", index: 2, score: 8 }), "");
});
