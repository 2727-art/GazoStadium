const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sources = {
  solo: read("online.js"),
  strategy: read("strategy.js"),
  team: read("team.js"),
  royale: read("royale.js"),
};

test("every online mode prepares the local deck for reuse", () => {
  for (const [mode, source] of Object.entries(sources)) {
    assert.match(source, /function prepareDeckForRematch\(items\)/, `${mode} needs a rematch deck reset`);
    assert.match(source, /item\.used = false;/, `${mode} needs to clear used cards`);
  }
});

test("deck preparation keeps the same media objects and clears only match usage", () => {
  for (const [mode, source] of Object.entries(sources)) {
    const functionSource = source.match(/function prepareDeckForRematch\(items\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(functionSource, `${mode} rematch helper could not be loaded`);
    const blob = { type: "image/webp" };
    const items = [{ id: "card-1", blob, url: "blob:card-1", position: 7, used: true, role: "opening" }];
    const sandbox = { items, result: null };
    vm.runInNewContext(`${functionSource}\nresult = prepareDeckForRematch(items);`, sandbox);
    assert.equal(sandbox.result, items, `${mode} should reuse the existing deck array`);
    assert.equal(items[0].blob, blob, `${mode} should keep the local image Blob`);
    assert.equal(items[0].url, "blob:card-1", `${mode} should keep the local Object URL`);
    assert.equal(items[0].used, false, `${mode} should make used cards selectable again`);
    assert.equal(items[0].role, "opening", `${mode} should preserve mode-specific card metadata`);
  }
});

test("rematch resets release received media without releasing the local deck", () => {
  assert.match(sources.solo, /async function resetOnlineState[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.deck = deck;/);
  assert.match(sources.strategy, /async function resetStrategySetup[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.main = main;[\s\S]*?state\.reserve = reserve;/);
  assert.match(sources.team, /async function resetSetup[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.deck = deck;/);
  assert.match(sources.royale, /async function resetSetup[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.deck = deck;/);
});

test("leaving a mode and closing the page still release every local deck", () => {
  for (const [mode, source] of Object.entries(sources)) {
    assert.match(source, /async function leaveToLanding[\s\S]*?releaseAllImages\(\);/, `${mode} must release decks on exit`);
    assert.match(source, /window\.addEventListener\("beforeunload"[\s\S]*?releaseAllImages\(\);/, `${mode} must release decks on unload`);
  }
  assert.match(sources.solo, /function releaseAllImages\(\) \{[\s\S]*?state\.deck\.forEach/);
  assert.match(sources.strategy, /function releaseAllImages\(\) \{[\s\S]*?\[\.\.\.state\.main, \.\.\.state\.reserve\]\.forEach/);
  assert.match(sources.team, /function releaseAllImages\(\) \{[\s\S]*?state\.deck\.forEach/);
  assert.match(sources.royale, /function releaseAllImages\(\) \{[\s\S]*?state\.deck\.forEach/);
});
