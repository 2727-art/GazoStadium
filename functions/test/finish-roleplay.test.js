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
    ["standard", "rival", "knight", "villain", "cool", "comic", "oshi"],
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
    resolveVisibleFinishReplyLine(custom, { showCustom: true, voiceSetId: "knight" }),
    { line: custom, custom: true, replaced: false },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine(custom, { showCustom: false, voiceSetId: "knight" }),
    { line: getRoleplayVoiceSet("knight").replyLine, custom: true, replaced: true },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine("", { showCustom: false, voiceSetId: "knight" }),
    { line: "", custom: false, replaced: false },
  );
});
