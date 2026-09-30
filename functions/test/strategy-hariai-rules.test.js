"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const rules = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")).rules.online;
const room = rules.strategyRooms.$roomId;
const slot = room.moves.$slot;
const functionsSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

function includesAll(value, fragments, label = "") {
  for (const fragment of fragments) assert.ok(String(value).includes(fragment), `${label} missing ${fragment}`);
}

test("version 3 rooms replace rounds and weakness phases with slot moves", () => {
  assert.equal(room.protocolVersion[".validate"], "newData.val() === 3");
  for (const retired of ["rounds", "weaknessChoiceCommits", "weaknessChoices", "weaknessGuesses", "weaknessChains", "weaknessChainImagesReceived", "weaknessSurrenders", "weaknessContinue"]) {
    assert.equal(room[retired], undefined, `${retired} is retired`);
  }
  assert.equal(slot[".validate"], "$slot.matches(/^([1-9]|[12][0-9]|30)$/)");
  assert.equal(slot.$other[".validate"], false);
});

test("player records carry a persona, per-candidate commits and penalty consent", () => {
  const player = room.players.$uid;
  includesAll(player[".validate"], ["'persona'", "'weaknessCommits'", "'penalties'"], "player");
  assert.equal(player.pursuitLine, undefined);
  assert.equal(player.weaknessCommit, undefined);
  includesAll(player.persona.type[".validate"], ["'tsuyotsuyo'", "'yowayowa'", "'koakuma'", "'oneesan'", "'amaenbo'", "'seiso'"]);
  includesAll(player.persona.firstPerson[".validate"], ["'watashi'", "'atashi'", "'uchi'", "'watakushi'"]);
  includesAll(player.persona.callStyle[".validate"], ["'chan'", "'san'", "'oneesan'", "'anata'"]);
  assert.equal(player.weaknessCommits[".validate"], "newData.hasChildren(['0', '1', '2'])");
  for (const index of ["0", "1", "2"]) assert.match(player.weaknessCommits[index][".validate"], /\{64\}/);
  assert.equal(player.penalties.call[".validate"], "newData.isBoolean()");
  assert.equal(player.$other[".validate"], false);
});

test("each slot holds exactly one action written by its owner during an open battle", () => {
  for (const kind of ["post", "break", "pass", "surrender"]) {
    const write = slot[kind][".write"];
    includesAll(write, [
      "!data.exists()",
      "members/' + auth.uid",
      "protocolVersion').val() === 3",
      "battleReady/",
      "newData.child('by').val() === auth.uid",
      "destroyed').exists()",
      "finished/",
      "contactGates",
    ], kind);
    for (const other of ["post", "break", "pass", "surrender"].filter((item) => item !== kind)) {
      assert.ok(write.includes(`!data.parent().child('${other}').exists()`), `${kind} excludes ${other}`);
    }
    assert.equal(slot[kind].by[".validate"], "newData.isString() && newData.val() === auth.uid");
    assert.equal(slot[kind].$other[".validate"], false);
  }
  assert.match(slot.post.caption[".validate"], /length <= 80/);
  assert.match(slot.post.target[".validate"], /=== 2\)/);
});

test("scores are 0-100 integers from the receiver after the image arrived", () => {
  includesAll(slot.score[".write"], [
    "data.parent().child('post/by').val() !== auth.uid",
    "data.parent().child('received/' + auth.uid).val() === true",
  ]);
  assert.equal(slot.score.value[".validate"], "newData.isNumber() && newData.val() >= 0 && newData.val() <= 100 && newData.val() % 1 === 0");
  assert.match(slot.score.reply[".validate"], /length <= 40/);
  assert.equal(slot.score.surrender[".validate"], "newData.val() === true");
  includesAll(slot.received.$uid[".write"], ["auth.uid === $uid", "post/by').val() !== auth.uid"]);
});

test("rights follow the 80 / 85 / 90 bands and only the attacker may use them", () => {
  const right = slot.right;
  includesAll(right[".write"], ["data.parent().child('post/by').val() === auth.uid", "data.parent().child('score').exists()"]);
  includesAll(right[".validate"], [
    "newData.child('kind').val() === 'none' && newData.parent().child('score/value').val() >= 80",
    "newData.parent().child('score/value').val() >= 80 && newData.parent().child('score/value').val() < 85",
    "newData.parent().child('score/value').val() >= 90",
    "newData.child('kind').val() === 'instruction' && newData.parent().child('score/value').val() >= 85",
    "'spot'", "'which'", "'next'", "'honest'",
    "'call'", "'heart'", "'reason'", "'deny'", "'confess'",
    "'oneesama'", "'sama'", "'senpai'", "'goshujin'",
  ]);
  assert.match(right.flavor[".validate"], /length <= 40/);
  includesAll(slot.answer[".write"], ["right/kind').val() !== 'none'", "post/by').val() !== auth.uid"]);
  includesAll(slot.answer[".validate"], ["right/id').val() !== 'deny' || newData.hasChildren(['candidate', 'salt'])"]);
  assert.match(slot.answer.text[".validate"], /length <= 60/);
});

test("break reveals and finishes are gated by the defender reveal", () => {
  includesAll(slot.breakReveal[".write"], ["break/by').val() !== auth.uid"]);
  includesAll(slot.breakReveal[".validate"], ["newData.child('index').val() === newData.parent().child('break/guess').val()"]);
  assert.equal(slot.breakReveal.bit[".validate"], "newData.isNumber() && (newData.val() === 0 || newData.val() === 1)");
  includesAll(slot.finish[".write"], ["break/by').val() === auth.uid", "breakReveal/bit').val() === 1"]);
  includesAll(slot.finish[".validate"], ["captions/0", "captions/1", "captions/2"]);
  includesAll(slot.finish.captions.$k[".validate"], ["$k === '2'", "count').val() >= 3"]);
  includesAll(slot.finishReceived.$k[".write"], ["break/by').val() !== auth.uid", "child('finish').exists()"]);
});

test("final reveals open all three salts and gate the result claim", () => {
  const reveal = room.weaknessReveals.$uid;
  includesAll(reveal[".write"], ["auth.uid === $uid", "!data.exists()", "protocolVersion').val() === 3", "battleReady/"]);
  assert.equal(reveal.salts[".validate"], "newData.hasChildren(['0', '1', '2'])");
  assert.match(reveal.salts.$k[".validate"], /\{32\}/);
  const claim = room.resultClaims.$uid[".write"];
  includesAll(claim, ["protocolVersion').val() !== 3 ||", "/weaknessReveals/"]);
  assert.ok((claim.match(/\/weaknessReveals\//gu) || []).length >= 2, "both final reveals are required");
});

test("room destruction and final result stay mutually exclusive", () => {
  includesAll(room.destroyed[".write"], [
    "!newData.parent().child('resultClaims').exists()",
    "!newData.parent().child('finished').exists()",
  ]);
  assert.match(room.finished.$uid[".write"], /newData\.parent\(\)\.parent\(\)\.child\('resultClaims'\)\.child\(\$uid\)\.exists\(\)/u);
});

test("penalties are chosen by the winner within mutual consent and done by the loser", () => {
  includesAll(room.penalty[".write"], ["resultClaims/' + auth.uid + '/outcome').val() === 'win'", "finished/"]);
  includesAll(room.penalty[".validate"], [
    "newData.child('kind').val() === 'declare'",
    "penalties/call').val() === true",
    "penalties/tribute').val() === true",
    "newData.child('honorific').exists()",
  ]);
  includesAll(room.penaltyDone.$uid[".write"], ["auth.uid === $uid", "resultClaims/' + auth.uid + '/outcome').val() === 'loss'", "penalty').exists()"]);
  includesAll(room.penaltyDone.$uid[".validate"], ["newData.child('kind').val() ===", "penalty/kind"]);
});

test("queues, offers and presence accept only protocol 3 strategy states", () => {
  const queue = rules.strategyQueue.$uid;
  includesAll(queue[".validate"], ["'waiting-v3'", "'offering-v3'", "newData.child('protocolVersion').val() === 3"]);
  assert.equal(queue.protocolVersion[".validate"], "!newData.exists() || newData.val() === 3");
  assert.doesNotMatch(JSON.stringify(rules), /waiting-v2|offering-v2/);
  assert.equal(rules.strategyOffers.$targetUid.$roomId.protocolVersion[".validate"], "!newData.exists() || newData.val() === 3");
});

test("battle chat accepts slot numbers up to 30", () => {
  const message = rules.strategyChats.$roomId.$messageId;
  assert.match(message.round[".validate"], /newData\.val\(\) <= 30/);
  assert.match(message[".validate"], /newData\.child\('round'\)\.val\(\) <= 30/);
});

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} incomplete`);
}

test("daily activity counts version 3 scores given by the player", () => {
  const sandbox = { objectValue: (value) => (value && typeof value === "object" ? value : {}), HttpsError: Error };
  vm.runInNewContext(`${extractFunction(functionsSource, "dailyActivityForRoom")}; this.run = dailyActivityForRoom;`, sandbox);
  const roomData = {
    protocolVersion: 3,
    moves: [null,
      { post: { by: "a" }, score: { by: "b", value: 82 } },
      { post: { by: "b" }, score: { by: "a", value: 40 } },
      { post: { by: "a" }, score: { by: "b", value: 12.5 } },
      { post: { by: "a" }, score: { by: "b", value: 79 } },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.run("strategy", roomData, "b"))), { scores: 2, criticals: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.run("strategy", roomData, "a"))), { scores: 1, criticals: 0 });
});

test("client review refresh keeps the penalty banner current without re-rendering the review", () => {
  const strategy = fs.readFileSync(path.join(root, "strategy.js"), "utf8");
  const review = extractFunction(strategy, "reactToReviewData");
  assert.match(review, /^function reactToReviewData\(\) \{\s*refreshHariaiReviewPenaltyBanner\(\);/u);
  const refresh = extractFunction(strategy, "refreshHariaiReviewPenaltyBanner");
  assert.match(refresh, /if \(state\.screen !== "review"\) return;/u);
  assert.match(refresh, /current\.outerHTML = html;/u);
  const upload = extractFunction(strategy, "sendPendingStrategyReviewAsset");
  assert.match(upload, /if \(asset\.kind === "image"\) completeHariaiTribute\(\)\.catch\(handleRecoverableError\);/u);
});

test("client battle writes stay inside the version 3 slot paths", () => {
  const strategy = fs.readFileSync(path.join(root, "strategy.js"), "utf8");
  for (const [name, fragment] of [
    ["submitHariaiPost", "moves/${slot}/post"],
    ["submitHariaiBreak", "moves/${pending.slot}/break"],
    ["submitHariaiPass", "moves/${pending.slot}/pass"],
    ["submitHariaiSurrender", "moves/${pending.slot}/surrender"],
    ["submitHariaiScore", "moves/${pending.slot}/score"],
    ["submitHariaiRight", "moves/${pending.slot}/right"],
    ["submitHariaiAnswer", "moves/${pending.slot}/answer"],
    ["submitHariaiFinish", "moves/${pending.slot}/finish"],
    ["publishBreakReveal", "moves/${slotNumber}/breakReveal"],
    ["publishFinalWeaknessReveal", "weaknessReveals/${state.uid}"],
  ]) {
    assert.ok(extractFunction(strategy, name).includes(fragment), `${name} writes ${fragment}`);
  }
  assert.doesNotMatch(strategy, /\/rounds\/|weaknessChoiceCommits|weaknessGuesses|weaknessChains|pursuitLine/u);
});
