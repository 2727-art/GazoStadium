"use strict";

// 掲示板の「管理の型」プルダウン（2026-10-28 の不具合）。PC・スマホとも、開いた途端に閉じて選べなかった。
// 画面の click の受け口が <select data-t="board-style"> にも反応し、preventDefault と描き直しでプルダウンを作り直していた。
// 入力欄と同じく、プルダウンは change だけで扱う。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const client = fs.readFileSync(path.join(root, "tribute.js"), "utf8").replace(/\r\n/g, "\n");

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

function bound() {
  const handlers = {};
  const calls = [];
  const context = vm.createContext({
    active: true,
    state: { screen: "board", sheet: null },
    handleClick: (target) => { calls.push(target.dataset.t); return Promise.resolve(); },
    render: () => calls.push("render"),
  });
  vm.runInContext(extract(client, "bindRoot"), context);
  context.bindRoot({ addEventListener: (type, handler) => { handlers[type] = handler; } });
  return { handlers, calls };
}

function element(tagName, t) {
  const node = {
    tagName,
    dataset: { t },
    closest: (selector) => (selector === "[data-t]" || selector.startsWith(`${tagName.toLowerCase()}[data-t="${t}"]`) || selector.includes(`select[data-t="${t}"]`) ? node : selector.includes(".tribute-screen") ? {} : null),
  };
  return node;
}

test("tapping the type dropdown leaves it open; choosing a type filters through change", () => {
  const { handlers, calls } = bound();
  const select = element("SELECT", "board-style");
  let prevented = false;
  handlers.click({ target: select, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, "the native picker is not cancelled");
  assert.deepEqual(calls, [], "the board is not redrawn under the open picker");
  handlers.change({ target: select });
  assert.deepEqual(calls, ["board-style"], "the chosen type is applied on change");

  // ボタンはこれまでどおり click で動く。
  const button = element("BUTTON", "reload-board");
  handlers.click({ target: button, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(calls, ["board-style", "reload-board"]);
});

test("the dropdown is still wired to the board filter", () => {
  assert.match(client, /<select data-t="board-style"><option value="">すべて<\/option>/);
  assert.match(client, /if \(target\.tagName === "INPUT" \|\| target\.tagName === "SELECT"\) return;/);
  assert.match(client, /select\[data-t="board-style"\]'\);\n    if \(target\) handleClick\(target\);/);
  assert.match(client, /    case "board-style":\n      state\.board\.style = STYLE_LABELS\[target\.value\] \? target\.value : "";\n      render\(\);/);
});
