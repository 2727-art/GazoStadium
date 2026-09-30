"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const corePromise = import(pathToFileURL(path.join(root, "strategy-hariai-core.mjs")).href);

const HOST = "host-uid";
const GUEST = "guest-uid";
const SALT = "a".repeat(32);

function post(by, { target = 0, caption = "これ、好きでしょ？♡", score, reply, surrender, right, answer, received = true } = {}) {
  const receiver = by === HOST ? GUEST : HOST;
  const entry = { post: { by, target, caption, lockedAt: 1 } };
  if (received) entry.received = { [receiver]: true };
  if (score !== undefined) {
    entry.score = { by: receiver, value: score, lockedAt: 2 };
    if (reply !== undefined) entry.score.reply = reply;
    if (surrender) entry.score.surrender = true;
  }
  if (right) entry.right = { by, lockedAt: 3, ...right };
  if (answer) entry.answer = { by: receiver, lockedAt: 4, ...answer };
  return entry;
}

function movesOf(...entries) {
  return Object.fromEntries(entries.map((entry, index) => [String(index + 1), entry]));
}

async function replay(moves, overrides = {}) {
  const { replayHariai } = await corePromise;
  return replayHariai({ hostUid: HOST, guestUid: GUEST, firstUid: HOST, moves, ...overrides });
}

test("score bands map to question, instruction and combo rights", async () => {
  const { hariaiBand, hariaiRightOptions } = await corePromise;
  assert.equal(hariaiBand(0), "none");
  assert.equal(hariaiBand(79), "none");
  assert.equal(hariaiBand(80), "question");
  assert.equal(hariaiBand(84), "question");
  assert.equal(hariaiBand(85), "instruction");
  assert.equal(hariaiBand(89), "instruction");
  assert.equal(hariaiBand(90), "combo");
  assert.equal(hariaiBand(100), "combo");
  assert.equal(hariaiBand(8.5), "invalid");
  assert.deepEqual(hariaiRightOptions(82), { question: true, instruction: false, combo: false });
  assert.deepEqual(hariaiRightOptions(87), { question: false, instruction: true, combo: false });
  assert.deepEqual(hariaiRightOptions(95), { question: true, instruction: true, combo: true });
  assert.deepEqual(hariaiRightOptions(50), { question: false, instruction: false, combo: false });
});

test("post damage starts above 70 and combo bonus caps at +15", async () => {
  const { hariaiPostDamage } = await corePromise;
  assert.equal(hariaiPostDamage(70), 0);
  assert.equal(hariaiPostDamage(75), 5);
  assert.equal(hariaiPostDamage(80), 10);
  assert.equal(hariaiPostDamage(100), 30);
  assert.equal(hariaiPostDamage(90, 2), 25);
  assert.equal(hariaiPostDamage(90, 3), 30);
  assert.equal(hariaiPostDamage(90, 9), 35);
  assert.equal(hariaiPostDamage(60, 4), 0, "no bonus without a hit");
});

test("the lower rating attacks first, ties use the room hash parity", async () => {
  const { hariaiFirstAttacker } = await corePromise;
  assert.equal(hariaiFirstAttacker({ hostUid: HOST, guestUid: GUEST, hostRating: 1100, guestRating: 1000, roomHashFirstByte: 0 }), GUEST);
  assert.equal(hariaiFirstAttacker({ hostUid: HOST, guestUid: GUEST, hostRating: 990, guestRating: 1000, roomHashFirstByte: 1 }), HOST);
  assert.equal(hariaiFirstAttacker({ hostUid: HOST, guestUid: GUEST, hostRating: 1000, guestRating: 1000, roomHashFirstByte: 2 }), HOST);
  assert.equal(hariaiFirstAttacker({ hostUid: HOST, guestUid: GUEST, hostRating: 1000, guestRating: 1000, roomHashFirstByte: 7 }), GUEST);
});

test("an empty room waits for the first attacker to act", async () => {
  const result = await replay({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.pending, { slot: 1, stage: "act", actor: HOST, canPost: true, canBreak: false, canPass: false, combo: 0 });
  assert.equal(result.players[HOST].reason, 100);
  assert.equal(result.players[HOST].hand, 10);
});

test("a post waits for receipt, then score, and a low score passes the turn", async () => {
  let result = await replay(movesOf(post(HOST, { received: false })));
  assert.equal(result.pending.stage, "receive");
  assert.equal(result.pending.actor, GUEST);

  result = await replay(movesOf(post(HOST)));
  assert.equal(result.pending.stage, "score");
  assert.equal(result.pending.actor, GUEST);

  result = await replay(movesOf(post(HOST, { score: 75, reply: "まだ平気♡" })));
  assert.equal(result.slots[0].damage, 5);
  assert.equal(result.players[GUEST].reason, 95);
  assert.equal(result.players[HOST].damageDealt, 5);
  assert.equal(result.pending.stage, "act");
  assert.equal(result.pending.actor, GUEST);
  assert.equal(result.players[HOST].hand, 9);
});

test("80-84 grants a question and then passes the turn", async () => {
  let result = await replay(movesOf(post(HOST, { score: 82 })));
  assert.equal(result.pending.stage, "right");
  assert.deepEqual(result.pending.options, { question: true, instruction: false, combo: false });

  result = await replay(movesOf(post(HOST, { score: 82, right: { kind: "question", id: "spot" } })));
  assert.equal(result.pending.stage, "answer");
  assert.equal(result.pending.actor, GUEST);

  result = await replay(movesOf(post(HOST, { score: 82, right: { kind: "question", id: "spot" }, answer: { text: "言い方がずるい" } })));
  assert.equal(result.pending.stage, "act");
  assert.equal(result.pending.actor, GUEST);
  assert.equal(result.slots[0].answer.text, "言い方がずるい");
});

test("a question outside the band or an instruction at 80 is an integrity error", async () => {
  let result = await replay(movesOf(post(HOST, { score: 82, right: { kind: "instruction", id: "heart" } })));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { score: 86, right: { kind: "question", id: "spot" } })));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { score: 70, right: { kind: "none" } })));
  assert.equal(result.ok, false);
});

test("90+ keeps the turn and stacks combo damage", async () => {
  const result = await replay(movesOf(
    post(HOST, { score: 92, right: { kind: "none" } }),
    post(HOST, { score: 95, right: { kind: "none" } }),
    post(HOST, { score: 90, right: { kind: "none" } }),
    post(HOST, { score: 60 }),
  ));
  assert.equal(result.ok, true);
  assert.deepEqual(result.slots.map((slot) => slot.combo), [1, 2, 3, 4]);
  assert.deepEqual(result.slots.map((slot) => slot.damage), [22, 30, 30, 0]);
  assert.equal(result.players[GUEST].reason, 18);
  assert.equal(result.players[HOST].maxCombo, 4);
  assert.equal(result.pending.actor, GUEST);
  assert.equal(result.pending.combo, 0);
});

test("the pending act exposes the running combo for the same attacker", async () => {
  const result = await replay(movesOf(post(HOST, { score: 91, right: { kind: "none" } })));
  assert.equal(result.pending.actor, HOST);
  assert.equal(result.pending.combo, 1);
});

test("a post by the wrong player is rejected", async () => {
  const result = await replay(movesOf(post(GUEST)));
  assert.equal(result.ok, false);
  assert.match(result.error, /手番ではない/);
});

test("slot gaps and multiple actions in one slot are rejected", async () => {
  let result = await replay({ 1: post(HOST, { score: 50 }), 3: post(HOST) });
  assert.equal(result.ok, false);
  result = await replay({ 1: { post: { by: HOST, target: 0, caption: "x" }, pass: { by: HOST } } });
  assert.equal(result.ok, false);
});

test("array-shaped moves from Realtime Database replay the same", async () => {
  const moves = [null, post(HOST, { score: 50 }), post(GUEST, { score: 40 })];
  const result = await replay(moves);
  assert.equal(result.ok, true);
  assert.equal(result.slots.length, 2);
  assert.equal(result.pending.actor, HOST);
});

test("empty captions and out-of-range scores are rejected", async () => {
  let result = await replay(movesOf(post(HOST, { caption: "" })));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { score: 101 })));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { target: 3 })));
  assert.equal(result.ok, false);
});

test("reaching zero reason by your own score is a KO", async () => {
  const combo = (score) => post(HOST, { score, right: { kind: "none" } });
  const result = await replay(movesOf(combo(100), combo(100), combo(100)));
  assert.equal(result.players[GUEST].reason, 0);
  assert.deepEqual(result.outcome, { reason: "ko", winnerUid: HOST, loserUid: GUEST, draw: false });
  assert.equal(result.pending, null);
});

test("surrendering with a score ends the match immediately", async () => {
  const result = await replay(movesOf(post(HOST, { score: 88, surrender: true })));
  assert.deepEqual(result.outcome, { reason: "surrender", winnerUid: HOST, loserUid: GUEST, draw: false });
});

test("surrendering on your own turn ends the match", async () => {
  const result = await replay(movesOf(post(HOST, { score: 10 }), { surrender: { by: GUEST, lockedAt: 1 } }));
  assert.deepEqual(result.outcome, { reason: "surrender", winnerUid: HOST, loserUid: GUEST, draw: false });
});

test("break needs two posts first", async () => {
  let result = await replay(movesOf({ break: { by: HOST, guess: 0, lockedAt: 1 } }));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { score: 10 }), post(GUEST, { score: 10 }), post(HOST, { score: 10 }), post(GUEST, { score: 10 })));
  assert.equal(result.pending.canBreak, true);
});

function openingForBreak() {
  return [
    post(HOST, { target: 1, score: 60 }),
    post(GUEST, { score: 10 }),
    post(HOST, { target: 1, score: 70 }),
    post(GUEST, { score: 10 }),
  ];
}

test("a missed break costs the guesser 20 and reveals that candidate as a bluff", async () => {
  let result = await replay(movesOf(...openingForBreak(), { break: { by: HOST, guess: 2, lockedAt: 1 } }));
  assert.equal(result.pending.stage, "breakReveal");
  assert.equal(result.pending.actor, GUEST);

  result = await replay(movesOf(...openingForBreak(), {
    break: { by: HOST, guess: 2, lockedAt: 1 },
    breakReveal: { by: GUEST, index: 2, bit: 0, salt: SALT, revealedAt: 2 },
  }));
  assert.equal(result.slots[4].breakResult, "miss");
  assert.equal(result.players[HOST].reason, 80);
  assert.deepEqual(result.players[GUEST].revealedBluffs, [2]);
  assert.equal(result.pending.actor, GUEST);
  assert.equal(result.players[HOST].breakUsed, true);
});

test("a hit break deals 25 and the finish size grows with bluff faces", async () => {
  const breakSlot = {
    break: { by: HOST, guess: 1, lockedAt: 1 },
    breakReveal: { by: GUEST, index: 1, bit: 1, salt: SALT, revealedAt: 2 },
  };
  let result = await replay(movesOf(...openingForBreak(), breakSlot));
  assert.equal(result.slots[4].breakResult, "hit");
  assert.deepEqual(result.slots[4].bluffSlots, [1, 3]);
  assert.equal(result.slots[4].finishMax, 3);
  assert.equal(result.pending.stage, "finish");
  assert.equal(result.players[GUEST].reason, 100 - 0 - 0 - 25);
  assert.equal(result.players[GUEST].weaknessRevealed, 1);

  result = await replay(movesOf(...openingForBreak(), { ...breakSlot, finish: { by: HOST, count: 2, captions: { 0: "ほら♡", 1: "ばれてるよ♡" }, lockedAt: 3 } }));
  assert.equal(result.pending.stage, "finishReceive");
  assert.equal(result.pending.actor, GUEST);

  result = await replay(movesOf(...openingForBreak(), {
    ...breakSlot,
    finish: { by: HOST, count: 2, captions: { 0: "ほら♡", 1: "ばれてるよ♡" }, lockedAt: 3 },
    finishReceived: { 0: true, 1: true },
  }));
  assert.equal(result.slots[4].finishDamage, 20);
  assert.equal(result.players[GUEST].reason, 55);
  assert.equal(result.players[HOST].hand, 6);
  assert.equal(result.pending.actor, GUEST);
});

test("a finish larger than allowed is rejected", async () => {
  const opening = [
    post(HOST, { target: 1, score: 85, right: { kind: "none" } }),
    post(GUEST, { score: 10 }),
    post(HOST, { target: 0, score: 10 }),
    post(GUEST, { score: 10 }),
  ];
  const result = await replay(movesOf(...opening, {
    break: { by: HOST, guess: 1, lockedAt: 1 },
    breakReveal: { by: GUEST, index: 1, bit: 1, salt: SALT, revealedAt: 2 },
    finish: { by: HOST, count: 2, captions: { 0: "a", 1: "b" }, lockedAt: 3 },
  }));
  assert.equal(result.ok, false, "no bluff faces allows only one finish image");
});

test("instructions change persona state for the receiver", async () => {
  const result = await replay(movesOf(
    post(HOST, { score: 86, right: { kind: "instruction", id: "call", param: "oneesama" }, answer: { ack: true } }),
    post(GUEST, { caption: "どう？", score: 86, right: { kind: "instruction", id: "heart" }, answer: { ack: true } }),
    post(HOST, { caption: "これで", score: 40, reply: "へいき" }),
    post(GUEST, { caption: "つぎ", score: 86, right: { kind: "instruction", id: "reason" }, answer: { ack: true } }),
  ));
  assert.equal(result.ok, true);
  assert.equal(result.players[GUEST].honorific, "oneesama");
  assert.equal(result.slots[2].captionHeart, true, "host caption consumes a heart");
  assert.equal(result.slots[2].replyHeart, false, "guest has no heart instruction");
  assert.equal(result.players[HOST].heartsRemaining, 2, "only the slot 3 caption used a heart");
  assert.equal(result.players[HOST].reasonRequired, true);
  const scored = await replay(movesOf(
    post(HOST, { score: 86, right: { kind: "instruction", id: "reason" }, answer: { ack: true } }),
    post(GUEST, { score: 30 }),
    post(HOST, { caption: "理由つきでね" }),
  ));
  assert.equal(scored.pending.stage, "score");
  assert.equal(scored.pending.reasonRequired, true, "the instructed receiver must explain the next score");
});

test("deny reveals one bluff and is available only once", async () => {
  const { hariaiPartialReveals } = await corePromise;
  let result = await replay(movesOf(
    post(HOST, { score: 87, right: { kind: "instruction", id: "deny" }, answer: { candidate: 2, salt: SALT } }),
  ));
  assert.deepEqual(result.players[GUEST].revealedBluffs, [2]);
  assert.deepEqual(hariaiPartialReveals(result), [{ uid: GUEST, index: 2, bit: 0, salt: SALT, slot: 1 }]);

  result = await replay(movesOf(
    post(HOST, { score: 87, right: { kind: "instruction", id: "deny" }, answer: { candidate: 2, salt: SALT } }),
    post(GUEST, { score: 10 }),
    post(HOST, { score: 87, right: { kind: "instruction", id: "deny" } }),
  ));
  assert.equal(result.ok, false);
});

test("which-question answers must be one of the two named candidates", async () => {
  let result = await replay(movesOf(post(HOST, { score: 81, right: { kind: "question", id: "which", a: 0, b: 2 }, answer: { choice: 1 } })));
  assert.equal(result.ok, false);
  result = await replay(movesOf(post(HOST, { score: 81, right: { kind: "question", id: "which", a: 0, b: 2 }, answer: { choice: 2 } })));
  assert.equal(result.ok, true);
});

test("exhausted hands end by reason, then damage dealt, then draw", async () => {
  const entries = [];
  for (let index = 0; index < 10; index += 1) {
    entries.push(post(HOST, { score: 10 }));
    entries.push(post(GUEST, { score: 10 }));
  }
  let result = await replay(movesOf(...entries));
  assert.equal(result.pending.stage, "act");
  assert.equal(result.pending.canPass, true);
  const passes = [{ pass: { by: HOST, lockedAt: 1 } }, { pass: { by: GUEST, lockedAt: 1 } }];
  result = await replay(movesOf(...entries, ...passes));
  assert.deepEqual(result.outcome, { reason: "exhausted", winnerUid: null, loserUid: null, draw: true });

  entries[0] = post(HOST, { score: 75 });
  result = await replay(movesOf(...entries, ...passes));
  assert.deepEqual(result.outcome, { reason: "exhausted", winnerUid: HOST, loserUid: GUEST, draw: false });
});

test("bluff faces and reading memo summarize the match", async () => {
  const { hariaiBluffFaces, hariaiReadingMemo } = await corePromise;
  const result = await replay(movesOf(
    post(HOST, { target: 1, score: 60 }),
    post(GUEST, { target: 0, score: 81, right: { kind: "question", id: "which", a: 0, b: 1 }, answer: { choice: 0 } }),
    post(HOST, { target: 1, score: 95, right: { kind: "none" } }),
  ));
  assert.deepEqual(hariaiBluffFaces(result, { [GUEST]: 1, [HOST]: 2 }), { [HOST]: [], [GUEST]: [1] });
  const memo = hariaiReadingMemo(result, HOST);
  assert.deepEqual(memo[1].scores, [{ slot: 1, score: 60 }, { slot: 3, score: 95 }]);
  assert.equal(memo[1].average, 78);
  const guestMemo = hariaiReadingMemo(result, GUEST);
  assert.deepEqual(guestMemo[0].answers, [{ slot: 2, kind: "which" }]);
});

test("penalty options are the always-on declaration plus mutual consent", async () => {
  const { hariaiPenaltyOptions } = await corePromise;
  assert.deepEqual(hariaiPenaltyOptions({ call: true, tribute: false }, { call: true, tribute: true }), ["declare", "call"]);
  assert.deepEqual(hariaiPenaltyOptions({}, {}), ["declare"]);
});

test("persona lines fill first person, call name and score", async () => {
  const { hariaiReplySuggestions, hariaiPersonaLine, hariaiCallName, ensureHariaiHeart, hariaiCandidateCommitMaterial } = await corePromise;
  const low = hariaiReplySuggestions("tsuyotsuyo", 72, { first: "わたし" });
  assert.match(low[1], /72点/);
  assert.match(low[1], /わたし/);
  assert.match(hariaiPersonaLine("oneesan", "declare", { call: hariaiCallName("chan", "ミオ") }), /^ミオちゃんの勝ちよ/);
  assert.equal(ensureHariaiHeart("まだ"), "まだ♡");
  assert.equal(ensureHariaiHeart("まだ♡"), "まだ♡");
  assert.equal(hariaiCandidateCommitMaterial("room", "uid", 1, 1, SALT), `room:uid:1:1:${SALT}`);
});

test("persona catalog keeps every template key for every type", async () => {
  const { HARIAI_PERSONA_TYPES } = await corePromise;
  assert.equal(HARIAI_PERSONA_TYPES.length, 6);
  for (const type of HARIAI_PERSONA_TYPES) {
    for (const tone of ["low", "mid", "high"]) assert.equal(type.lines[tone].length, 2, `${type.id}.${tone}`);
    for (const key of ["surrender", "declare", "confess", "breakCall"]) assert.ok(type.lines[key], `${type.id}.${key}`);
  }
});

test("every pending stage reports both remaining hands", async () => {
  const stages = [
    movesOf(post(HOST, { received: false })),
    movesOf(post(HOST)),
    movesOf(post(HOST, { score: 92 })),
    movesOf(post(HOST, { score: 92, right: { kind: "question", id: "spot" } })),
  ];
  for (const moves of stages) {
    const result = await replay(moves);
    assert.equal(result.players[HOST].hand, 9, result.pending.stage);
    assert.equal(result.players[GUEST].hand, 10, result.pending.stage);
  }
});
