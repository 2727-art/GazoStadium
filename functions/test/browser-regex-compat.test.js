"use strict";

// ブラウザで読むファイルに、iOS 16.3 までの Safari が読めない正規表現を入れない。
// 後読み（(?<= と (?<!）が1つでもあると、そのファイルは構文エラーで読み込めず、
// それを読む機能ごと動かなくなる（2026-10-27、iPhone で お貢ぎ牧場 が「読み込んでいます」のまま止まった）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const BROWSER_FILE = /\.(?:m?js)$/u;

function browserFiles() {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && BROWSER_FILE.test(entry.name))
    .map((entry) => entry.name);
}

test("browser files never use regex lookbehind, which Safari before iOS 16.4 cannot parse", () => {
  const files = browserFiles();
  assert.ok(files.includes("tribute-core.mjs") && files.includes("app.js"), "the scan sees the browser files");
  const found = files.flatMap((file) => fs.readFileSync(path.join(root, file), "utf8")
    .split(/\r?\n/u)
    .map((line, index) => ({ file, line: index + 1, text: line }))
    .filter((entry) => /\(\?<[=!]/u.test(entry.text)));
  assert.deepEqual(found.map((entry) => `${entry.file}:${entry.line}`), []);
});

test("the meeting check without lookbehind gives the same result as the server", async () => {
  const core = await import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
  for (const text of ["会おう", "また会いたい", "今度会える？", "出会おう", "出会えてよかった", "やっと出会えた。会おうね", "\n会って", "オフ会しよう", "会計", "会員"]) {
    assert.equal(core.forbiddenReason(text), rules.forbiddenReason(text), text);
  }
  assert.equal(core.forbiddenReason("出会えてよかった"), "");
  assert.equal(core.forbiddenReason("やっと出会えた。会おうね"), "meeting");
});
