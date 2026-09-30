"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const repositoryRoot = join(__dirname, "..", "..");
const source = readFileSync(join(repositoryRoot, "database.rules.json"), "utf8");
const rules = JSON.parse(source).rules.online;
const strategyRoom = rules.strategyRooms.$roomId;

function includesAll(value, fragments) {
  for (const fragment of fragments) {
    assert.match(value, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

test("strategy deck lock requires exactly five main and five reserve cards", () => {
  const deckReady = strategyRoom.deckReady.$uid;

  includesAll(deckReady[".validate"], [
    "newData.hasChildren(['ready', 'mainCount', 'reserveCount', 'lockedAt'])",
    "newData.child('ready').val() === true",
    "newData.child('mainCount').val() === 5",
    "newData.child('reserveCount').val() === 5",
    "newData.child('lockedAt').isNumber()",
  ]);
  assert.equal(deckReady.ready[".validate"], "newData.val() === true");
  assert.equal(deckReady.mainCount[".validate"], "newData.val() === 5");
  assert.equal(deckReady.reserveCount[".validate"], "newData.val() === 5");
  assert.equal(deckReady.lockedAt[".validate"], "newData.isNumber()");
});

test("strategy deck lock remains owner-only, write-once, and closed to extra fields", () => {
  const deckReady = strategyRoom.deckReady.$uid;

  includesAll(deckReady[".write"], [
    "auth != null",
    "auth.uid === $uid",
    "!data.exists()",
    "members/' + auth.uid",
    ".val() === true",
  ]);
  assert.equal(deckReady.$other[".validate"], false);
});

test("ten-card deck keeps the three-image finish cap in version 3 rules", () => {
  const finish = strategyRoom.moves.$slot.finish;

  assert.match(finish.count[".validate"], /newData\.val\(\) === 3\)/);
  assert.doesNotMatch(finish.count[".validate"], /=== 4/);
  assert.equal(strategyRoom.weaknessChains, undefined, "version 2 chain declarations are retired");
});
