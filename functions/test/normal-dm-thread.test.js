const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const threadModule = import(pathToFileURL(path.join(root, "normal-dm-thread.mjs")).href);

// scorePlayerOne はプレイヤー1の画像が受けた点数。playerIndex 0 から見ると「受けた点」になる。
const HISTORY = [
  { round: 1, scorePlayerOne: 8, scorePlayerTwo: 6, winnerIndex: 0, loserIndex: 1, localCardId: "c1" },
  { round: 2, scorePlayerOne: 5, scorePlayerTwo: 9, winnerIndex: 1, loserIndex: 0, localCardId: "c2" },
  { round: 3, scorePlayerOne: 6, scorePlayerTwo: 9, winnerIndex: 1, loserIndex: 0, localCardId: "c3" },
  { round: 4, scorePlayerOne: 7, scorePlayerTwo: 7, winnerIndex: null, loserIndex: null, localCardId: "c4" },
];

test("a round is posted after the local lock and revealed only once both sides received", async () => {
  const { collectThreadEventKeys } = await threadModule;
  assert.deepEqual(collectThreadEventKeys({ round: 1, screen: "select" }), []);
  assert.deepEqual(collectThreadEventKeys({ round: 1, screen: "waitingPick" }), ["local:1"]);
  assert.deepEqual(
    collectThreadEventKeys({ round: 1, screen: "waitingImage", remoteRounds: [1] }),
    ["local:1"],
    "the opponent's image stays hidden until the reveal",
  );
  assert.deepEqual(collectThreadEventKeys({ round: 1, screen: "score", remoteRounds: [1] }), ["local:1", "remote:1"]);
  assert.deepEqual(
    collectThreadEventKeys({ round: 2, screen: "select", resolvedRounds: [1], remoteRounds: [1], chatIds: ["a", "", "b"] }),
    ["local:1", "remote:1", "scores:1", "chat:a", "chat:b"],
  );
});

test("entries keep the order they were first logged and chats drop out once trimmed", async () => {
  const { appendThreadEntries, orderedThreadEntries } = await threadModule;
  let log = appendThreadEntries([], ["chat:a", "local:1"]);
  log = appendThreadEntries(log, ["local:1", "remote:1", "chat:a", "chat:b", "bogus", "scores:0"]);
  assert.deepEqual(log.map((entry) => [entry.key, entry.seq]), [
    ["chat:a", 1], ["local:1", 2], ["remote:1", 3], ["chat:b", 4],
  ]);
  const unchanged = appendThreadEntries(log, ["local:1"]);
  assert.equal(unchanged, log, "nothing new keeps the same array");
  const ordered = orderedThreadEntries(log, { chatIds: ["b"] });
  assert.deepEqual(ordered.map((entry) => entry.key), ["local:1", "remote:1", "chat:b"]);
  assert.deepEqual(ordered[1], { kind: "remote", round: 1, key: "remote:1", seq: 3 });
  assert.equal(ordered[2].chatId, "b");
});

test("score words follow the existing bands and name a ten as 堕ちかけ", async () => {
  const { scoreWord } = await threadModule;
  assert.deepEqual([1, 6, 7, 8, 9, 10].map(scoreWord), ["まだ平気", "まだ平気", "効いた", "効いた", "刺さった", "堕ちかけ"]);
});

test("round scores and outcomes are read from the local player's side", async () => {
  const { localRoundScores, localRoundOutcome } = await threadModule;
  assert.deepEqual(localRoundScores(HISTORY[1], 0), { given: 9, received: 5 });
  assert.deepEqual(localRoundScores(HISTORY[1], 1), { given: 5, received: 9 });
  assert.equal(localRoundOutcome(HISTORY[0], 0), "local");
  assert.equal(localRoundOutcome(HISTORY[0], 1), "remote");
  assert.equal(localRoundOutcome(HISTORY[3], 0), "draw");
});

test("the most effective opponent image is the highest score given, later rounds winning ties", async () => {
  const { mostEffectiveRemoteResult } = await threadModule;
  assert.equal(mostEffectiveRemoteResult(HISTORY, 0).round, 3);
  assert.equal(mostEffectiveRemoteResult(HISTORY, 1).round, 1);
  assert.equal(mostEffectiveRemoteResult([], 0), null);
});

test("landed captions are the local lines sorted by the score they received", async () => {
  const { landedLocalCaptions } = await threadModule;
  const captions = { c1: "ここ、見て？♡", c2: "これで落ちなさい♡", c3: "", c4: "お姉さんのとっておき、見て？♡" };
  const landed = landedLocalCaptions(HISTORY, 0, (result) => captions[result.localCardId]);
  assert.deepEqual(landed, [
    { round: 1, score: 8, caption: "ここ、見て？♡" },
    { round: 4, score: 7, caption: "お姉さんのとっておき、見て？♡" },
    { round: 2, score: 5, caption: "これで落ちなさい♡" },
  ]);
  assert.equal(landedLocalCaptions(HISTORY, 0, (result) => captions[result.localCardId], 1).length, 1);
});

test("the opponent persona comes from their latest chat, then their latest image, then typing", async () => {
  const { latestOpponentPersona } = await threadModule;
  const knownIds = ["koakuma", "oneesan", "seiso"];
  const remoteItems = [[1, { voiceSetId: "seiso" }], [2, { voiceSetId: "koakuma" }]];
  assert.equal(latestOpponentPersona({ knownIds, remoteItems }), "koakuma");
  assert.equal(latestOpponentPersona({
    knownIds,
    remoteItems,
    opponentUid: "remote",
    chatMessages: [
      { authorUid: "remote", voiceSetId: "oneesan" },
      { authorUid: "local", voiceSetId: "seiso" },
      { authorUid: "remote", voiceSetId: "unknown" },
    ],
  }), "oneesan");
  assert.equal(latestOpponentPersona({ knownIds, typingVoiceSetId: "seiso" }), "seiso");
  assert.equal(latestOpponentPersona({ knownIds, typingVoiceSetId: "unknown" }), "");
});
