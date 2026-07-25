const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const modes = {
  solo: { file: "online.js", stateFactory: "createOnlineState" },
  strategy: { file: "strategy.js", stateFactory: "createState" },
  team: { file: "team.js", stateFactory: "createState" },
  royale: { file: "royale.js", stateFactory: "createState" },
};

function renderSource(source) {
  const start = source.indexOf("function render() {");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, "render() was not found");
  return source.slice(start, end === -1 ? source.length : end);
}

test("same-screen rerenders preserve scroll in every online battle mode", () => {
  for (const [mode, { file }] of Object.entries(modes)) {
    const source = read(file);
    const render = renderSource(source);

    assert.match(source, /let lastRenderedScreen = "";/, `${mode} needs a screen sentinel`);
    assert.match(
      render,
      /const screenChanged = lastRenderedScreen !== state\.screen;/,
      `${mode} must distinguish transitions from same-screen refreshes`,
    );
    assert.match(
      render,
      /lastRenderedScreen = state\.screen;[\s\S]*?if \(screenChanged\) \{\s*window\.scrollTo\(0, 0\);/,
      `${mode} must scroll only after a real screen transition`,
    );
    assert.equal(
      (source.match(/window\.scrollTo\(/g) || []).length,
      1,
      `${mode} must not retain another forced page scroll`,
    );
    assert.doesNotMatch(
      source,
      /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\);/,
      `${mode} must not retain the asynchronous smooth-scroll behavior`,
    );
  }
});

test("every new online battle lifecycle resets the screen sentinel", () => {
  for (const [mode, { file, stateFactory }] of Object.entries(modes)) {
    const source = read(file);
    const activationCount = (source.match(/\bactive = true;/g) || []).length;
    const resetPattern = new RegExp(
      `active = true;\\s*state = ${stateFactory}\\(\\);\\s*lastRenderedScreen = "";`,
      "g",
    );

    assert.equal(
      (source.match(resetPattern) || []).length,
      activationCount,
      `${mode} must treat each fresh lifecycle as a screen transition`,
    );
  }
});

test("the four corrected modules use a new browser cache key", () => {
  const html = read("index.html");
  const marker = "setup-scroll-preserve-v1";

  for (const { file } of Object.values(modes)) {
    assert.match(
      html,
      new RegExp(`src="${file.replace(".", "\\.")}\\?v=[^"]*${marker}[^"]*"`),
      `${file} must be reloaded after release`,
    );
  }
  assert.equal((html.match(new RegExp(marker, "g")) || []).length, 4);
});
