"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("app.js");
const html = read("index.html");
const readme = read("README.md");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `source marker is available: ${startMarker}`);
  assert.ok(end > start, `source marker follows ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function loadResultShareHelpers() {
  const source = sourceBlock(
    app,
    "  function normalizeResultShareLine",
    "  function renderResultShareButton",
  );
  const sandbox = { URL };
  vm.runInNewContext(
    `${source}\nthis.buildResultShareText = buildResultShareText; this.createXResultPostUrl = createXResultPostUrl;`,
    sandbox,
  );
  return sandbox;
}

test("battle result posts preserve the result details without adding a URL", () => {
  const { buildResultShareText } = loadResultShareHelpers();
  const text = buildResultShareText({
    mode: "通常型1on1",
    result: "WIN",
    details: ["残りHP 42", "全5ラウンド / 合計獲得点 38"],
  });

  assert.equal(text, [
    "貼り合いスタジアム｜通常型1on1",
    "",
    "RESULT：WIN",
    "残りHP 42",
    "全5ラウンド / 合計獲得点 38",
    "",
    "#貼り合いスタジアム",
  ].join("\n"));
  assert.doesNotMatch(text, /(?:https?:\/\/|www\.)/i);
});

test("the X intent carries only the URL-free result text and language", () => {
  const { createXResultPostUrl } = loadResultShareHelpers();
  const intent = new URL(createXResultPostUrl({
    mode: "戦略型1on1",
    result: "DRAW",
    details: ["弱点看破：見送り", "残りHP 18"],
  }));

  assert.equal(intent.origin, "https://x.com");
  assert.equal(intent.pathname, "/intent/tweet");
  assert.deepEqual([...intent.searchParams.keys()].sort(), ["lang", "text"]);
  assert.equal(intent.searchParams.get("lang"), "ja");
  assert.doesNotMatch(intent.searchParams.get("text"), /(?:https?:\/\/|www\.)/i);
});

test("both battle modes keep using the shared result post helper", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");

  assert.match(online, /renderResultShareButton\?\.\(\{[\s\S]*?mode: "通常型1on1"/);
  assert.match(strategy, /renderResultShareButton\?\.\(\{[\s\S]*?mode: "戦略型1on1"/);
  assert.match(html, /app\.js\?v=[^"]*-result-share-no-url-v1/);
  assert.match(readme, /URLを含めないX投稿作成画面/);
  assert.match(readme, /投稿本文にURLを含めず/);
});

test("URL removal stays isolated from creator-card and free-table sharing", () => {
  const creatorCardShare = sourceBlock(
    app,
    "  function creatorCardShareText",
    "  function createXCreatorCardPostUrl",
  );
  const freeTable = read("free-table.js");
  const freeTableInviteShare = sourceBlock(
    freeTable,
    "function freeTableInviteUrl",
    "function formatInviteExpiry",
  );

  assert.match(creatorCardShare, /OFFICIAL_GAME_URL/);
  assert.match(freeTableInviteShare, /shared\(\)\?\.officialGameUrl/);
  assert.match(freeTableInviteShare, /searchParams\.set\("url", inviteUrl\)/);
});
