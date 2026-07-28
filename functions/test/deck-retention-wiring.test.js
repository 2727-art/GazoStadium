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
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `card-${index + 1}`,
      blob: { type: "image/webp", index },
      url: `blob:card-${index + 1}`,
      position: 20 + index,
      used: true,
      role: index === 7 ? "reserve-signature" : "opening",
    }));
    const media = items.map(({ blob, url }) => ({ blob, url }));
    const sandbox = { items, result: null };
    vm.runInNewContext(`${functionSource}\nresult = prepareDeckForRematch(items);`, sandbox);
    assert.equal(sandbox.result, items, `${mode} should reuse the existing deck array`);
    items.forEach((item, index) => {
      assert.equal(item.blob, media[index].blob, `${mode} should keep Blob ${index + 1}`);
      assert.equal(item.url, media[index].url, `${mode} should keep Object URL ${index + 1}`);
      if (mode === "solo") {
        assert.equal(item.position, index, `${mode} should renumber card ${index + 1}`);
      } else {
        assert.equal(item.position, 20 + index, `${mode} should preserve card ${index + 1} metadata`);
      }
      assert.equal(item.used, false, `${mode} should make card ${index + 1} selectable again`);
    });
    assert.equal(items[7].role, "reserve-signature", `${mode} should preserve reserve metadata`);
  }
});

test("rematch resets release received media without releasing the local deck", () => {
  assert.match(sources.solo, /async function resetOnlineState[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.deck = deck;/);
  assert.match(sources.strategy, /async function resetStrategySetup[\s\S]*?releaseMatchMedia\(\);[\s\S]*?state\.main = main;[\s\S]*?state\.reserve = reserve;/);
});

test("leaving a mode and closing the page still release every local deck", () => {
  for (const [mode, source] of Object.entries(sources)) {
    assert.match(source, /async function leaveToLanding[\s\S]*?releaseAllImages\(\);/, `${mode} must release decks on exit`);
    assert.match(source, /window\.addEventListener\("beforeunload"[\s\S]*?releaseAllImages\(\);/, `${mode} must release decks on unload`);
  }
  assert.match(sources.solo, /function releaseAllImages\(\) \{[\s\S]*?state\.deck\.forEach/);
  assert.match(sources.strategy, /function releaseAllImages\(\) \{[\s\S]*?\[\.\.\.state\.main, \.\.\.state\.reserve\]\.forEach/);
});
