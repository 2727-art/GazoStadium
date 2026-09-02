"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const read = (relativePath) => readFileSync(join(repositoryRoot, relativePath), "utf8");
const onlineRules = JSON.parse(read("database.rules.json")).rules.online;
const strategyRoom = onlineRules.strategyRooms.$roomId;

function includesAll(value, fragments, label) {
  assert.equal(typeof value, "string", `${label} must be a rule expression`);
  for (const fragment of fragments) {
    assert.ok(value.includes(fragment), `${label} is missing: ${fragment}`);
  }
}

function assertOwnerOnlyWriteOnce(rule, label) {
  includesAll(rule, [
    "auth != null",
    "auth.uid === $uid",
    "!data.exists()",
    "members/' + auth.uid",
    ".val() === true",
  ], label);
}

test("strategy matchmaking keeps legacy records valid while fencing protocol version 2", () => {
  const queue = onlineRules.strategyQueue.$uid;
  const offer = onlineRules.strategyOffers.$targetUid.$roomId;

  includesAll(queue[".validate"], [
    "protocolVersion",
    "newData.child('protocolVersion').val() === 2",
    "newData.child('state').val() === 'waiting-v2'",
    "newData.child('state').val() === 'offering-v2'",
    "!newData.child('protocolVersion').exists()",
  ], "strategy queue validation");
  assert.equal(queue.protocolVersion[".validate"], "!newData.exists() || newData.val() === 2");

  includesAll(offer[".validate"], [
    "protocolVersion",
    "newData.child('protocolVersion').val() === 2",
  ], "strategy offer validation");
  assert.equal(offer.protocolVersion[".validate"], "!newData.exists() || newData.val() === 2");

  assert.ok(strategyRoom.protocolVersion, "strategy room protocolVersion rule is required");
  includesAll(strategyRoom.protocolVersion[".write"], [
    "auth != null",
    "!data.exists()",
    "hostUid",
    "auth.uid",
  ], "strategy room protocol version write");
  assert.equal(strategyRoom.protocolVersion[".validate"], "newData.val() === 2");
});

test("round 3 choice commitments are member-owned, write-once, and opaque", () => {
  const commits = strategyRoom.weaknessChoiceCommits.$uid;

  assertOwnerOnlyWriteOnce(commits[".write"], "choice commitment write");
  includesAll(commits[".write"], [
    "protocolVersion",
    ".val() === 2",
    "/rounds/3/continue/",
    "/weaknessGuesses/",
    ").exists()",
  ], "choice commitment write");
  assert.ok(
    (commits[".write"].match(/\/rounds\/3\/continue\//gu) || []).length >= 2,
    "both players must continue before a round 3 commitment",
  );
  assert.ok(
    (commits[".write"].match(/!root\.child\([^\n]*?\/weaknessGuesses\//gu) || []).length >= 2,
    "legacy guesses and round 3 commitments must be mutually exclusive",
  );
  includesAll(commits[".validate"], [
    "newData.hasChildren(['digest', 'round', 'lockedAt'])",
    "newData.child('digest').isString()",
    "newData.child('digest').val().matches(/^[a-f0-9]{64}$/)",
    "newData.child('round').val() === 3",
    "newData.child('lockedAt').isNumber()",
  ], "choice commitment validation");
  assert.equal(
    commits.digest[".validate"],
    "newData.isString() && newData.val().matches(/^[a-f0-9]{64}$/)",
  );
  assert.equal(commits.round[".validate"], "newData.val() === 3");
  assert.equal(commits.lockedAt[".validate"], "newData.isNumber()");
  assert.equal(commits.$other[".validate"], false);
});

test("round 3 choices reveal only after both commitments and keep pass unambiguous", () => {
  const choices = strategyRoom.weaknessChoices.$uid;

  assertOwnerOnlyWriteOnce(choices[".write"], "choice reveal write");
  includesAll(choices[".write"], [
    "protocolVersion",
    ".val() === 2",
    "weaknessChoiceCommits/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "weaknessChoiceCommits/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
  ], "choice reveal write");
  includesAll(choices[".validate"], [
    "newData.hasChildren(['choice', 'guessIndex', 'round', 'salt', 'revealedAt'])",
    "newData.child('choice').val() === 'guess'",
    "newData.child('choice').val() === 'pass'",
    "newData.child('guessIndex').val() === -1",
    "newData.child('guessIndex').val() === 0",
    "newData.child('guessIndex').val() === 1",
    "newData.child('guessIndex').val() === 2",
    "newData.child('round').val() === 3",
    "newData.child('salt').isString()",
    "newData.child('revealedAt').isNumber()",
  ], "choice reveal validation");
  assert.equal(
    choices.choice[".validate"],
    "newData.val() === 'guess' || newData.val() === 'pass'",
  );
  assert.equal(choices.round[".validate"], "newData.val() === 3");
  assert.equal(choices.$other[".validate"], false);
});

test("legacy weakness guesses remain available but cannot expose a version 2 round 3 choice", () => {
  const guesses = strategyRoom.weaknessGuesses.$uid;

  assert.ok(guesses, "legacy weaknessGuesses path must remain for rounds 1 and 2");
  includesAll(guesses[".write"], [
    "protocolVersion",
    "newData.child('round').val()",
    "!== 3",
    "/rounds/2/basePicks/",
    "/rounds/3/basePicks/",
    "/continue/",
    "/weaknessChoiceCommits/",
    "/weaknessChoices/",
  ], "legacy weakness guess write");
  includesAll(guesses[".validate"], [
    "newData.hasChildren(['guessIndex', 'round', 'lockedAt'])",
    "newData.child('round').val() === 1",
    "newData.child('round').val() === 2",
    "newData.child('round').val() === 3",
  ], "legacy weakness guess validation");
});

test("version 2 actual weakness reveal waits for secret choices or the final chain checkpoint", () => {
  const reveals = strategyRoom.weaknessReveals.$uid;
  const write = reveals[".write"];

  assertOwnerOnlyWriteOnce(write, "actual weakness reveal write");
  includesAll(write, [
    "protocolVersion",
    ".val() === 2",
    "weaknessChoices/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "weaknessChoices/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
    "/choice').val() === 'guess'",
    "weaknessChains/' + root.child('online/strategyRooms/' + $roomId + '/hostUid').val()).exists()",
    "weaknessChains/' + root.child('online/strategyRooms/' + $roomId + '/guestUid').val()).exists()",
  ], "actual weakness reveal write");
});

test("version 2 chains allow damage only for a correct guess and make pass deal zero", () => {
  const chain = strategyRoom.weaknessChains.$uid;
  const validation = chain[".validate"];

  includesAll(chain[".write"], [
    "protocolVersion",
    "weaknessChoices",
  ], "weakness chain write");
  includesAll(validation, [
    "newData.child('count').val() === 0",
    "weaknessGuesses/' + auth.uid).exists()",
    "weaknessChoices/' + auth.uid + '/choice').val() === 'guess'",
    "weaknessChoices/' + auth.uid + '/guessIndex').val()",
    "weaknessReveals/",
    "/weaknessIndex').val()",
  ], "weakness chain validation");
});

test("room destruction and final result are mutually exclusive terminal states", () => {
  includesAll(strategyRoom.destroyed[".write"], [
    "!newData.parent().child('resultClaims').exists()",
    "!newData.parent().child('finished').exists()",
  ], "strategy room destruction write");

  const resultClaim = strategyRoom.resultClaims.$uid[".write"];
  includesAll(resultClaim, [
    "newData.parent().parent().child('finished').child($uid).val() === true",
    "protocolVersion",
    "/weaknessReveals/",
    ").exists()",
  ], "strategy result claim write");
  assert.ok(
    (resultClaim.match(/\/weaknessReveals\//gu) || []).length >= 2,
    "version 2 result claims require both final weakness reveals",
  );
  assert.match(
    strategyRoom.finished.$uid[".write"],
    /newData\.parent\(\)\.parent\(\)\.child\('resultClaims'\)\.child\(\$uid\)\.exists\(\)/u,
  );

  for (const pathName of [
    "weaknessChoiceCommits",
    "weaknessChoices",
    "weaknessGuesses",
    "weaknessReveals",
    "weaknessChains",
    "weaknessChainImagesReceived",
    "weaknessSurrenders",
    "weaknessContinue",
    "resultClaims",
    "finished",
  ]) {
    assert.equal(
      strategyRoom[pathName][".validate"],
      "!newData.parent().child('destroyed').exists()",
      `${pathName} must reject both prior and same-update room destruction`,
    );
  }
});

test("strategy asset uses the round 3 secret-choice cache marker", () => {
  assert.match(
    read("index.html"),
    /strategy\.js\?v=[^"]*strategy-round3-secret-choice-v1/,
  );
});
