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
    inferRoleplayVoiceSetId,
  } = await roleplayModule;

  assert.deepEqual(
    ROLEPLAY_VOICE_SETS.map(({ id }) => id),
    ["standard", "rival", "knight", "villain", "cool", "comic", "oshi"],
  );
  for (const voiceSet of ROLEPLAY_VOICE_SETS) {
    assert.ok(voiceSet.pursuitLine.length <= 40, `${voiceSet.id} pursuit line is too long`);
    assert.ok(voiceSet.finishLine.length <= 30, `${voiceSet.id} finish line is too long`);
    assert.ok(voiceSet.replyLine.length <= MAX_FINISH_REPLY_LENGTH, `${voiceSet.id} reply line is too long`);
    assert.doesNotMatch(
      `${voiceSet.pursuitLine}${voiceSet.finishLine}${voiceSet.replyLine}`,
      /[\r\n]/,
    );
    assert.equal(inferRoleplayVoiceSetId(voiceSet), voiceSet.id);
  }
});

test("custom finish replies allow forty characters and one intentional line break", async () => {
  const {
    MAX_FINISH_REPLY_LENGTH,
    normalizeFinishReplyLine,
    normalizeReceivedFinishReplyLine,
    sanitizeFinishReplyDraft,
  } = await roleplayModule;
  const draft = `${"あ".repeat(20)}\r\n${"い".repeat(15)}\n${"う".repeat(20)}`;
  const sanitized = sanitizeFinishReplyDraft(draft);

  assert.equal(sanitized.length, MAX_FINISH_REPLY_LENGTH);
  assert.equal((sanitized.match(/\n/g) || []).length, 1);
  assert.equal(normalizeFinishReplyLine("  一言目  \n  二言目  "), "一言目\n二言目");
  assert.equal(normalizeReceivedFinishReplyLine(""), "");
});

test("custom reply visibility falls back to the sender's safe voice set", async () => {
  const {
    getRoleplayVoiceSet,
    resolveVisibleFinishReplyLine,
  } = await roleplayModule;
  const custom = "この物語は\nまだ終わらない";

  assert.deepEqual(
    resolveVisibleFinishReplyLine(custom, { showCustom: true, voiceSetId: "knight" }),
    { line: custom, custom: true },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine(custom, { showCustom: false, voiceSetId: "knight" }),
    { line: getRoleplayVoiceSet("knight").replyLine, custom: true },
  );
  assert.deepEqual(
    resolveVisibleFinishReplyLine("", { showCustom: false, voiceSetId: "knight" }),
    { line: "", custom: false },
  );
});
