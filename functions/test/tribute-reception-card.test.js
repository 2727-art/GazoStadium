"use strict";

// 受付カード（ranch-reception-card-v1）。2026-10-28 のユーザーの決定: 「財布募集の画像」を「受付カード」に改名する。
// 画像の中身（右上の「財布受付」・「受付中」の印・ACCEPTING WALLETS）はそのまま。界隈が探すハッシュタグ #財布募集 は残す。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const share = read("tribute-share.mjs");
const online = read("online.js");
const core = read("tribute-core.mjs");
const index = read("index.html");

test("the screens call it 受付カード, and the old name is gone from what people read", () => {
  assert.match(client, /data-t="recruit-open">受付カードを作る<\/button>/);
  assert.match(client, /受付カードは、飾った管理人カードを1枚の画像にして X に貼れます。/);
  assert.equal((client.match(/wrap\("受付カード", /g) || []).length, 2, "the sheet title while loading and when ready");
  assert.match(client, /sheet\.type === "recruit" \? "作った受付カード" : sheet\.type === "ranch-photo" \? "作った牧場の記念写真" : "作った貢ぎ報告の画像"/);
  assert.match(client, /<h3>カードの枠 <small>掲示板・詳細・招待・受付カード<\/small><\/h3>/);
  assert.match(client, /掲示板のカード・申し込み・受付カードに札が出ます。/);
  assert.match(client, /sheet\.fileName = `omitsugi-accepting-\$\{stamp\}\.png`;/);
  assert.match(online, /掲示板・招待・受付カードと、財布が保存する貢ぎ報告の画像に出ます。/);
  for (const [name, source] of [["tribute.js", client], ["online.js", online]]) {
    assert.doesNotMatch(source, /財布募集の画像/, name);
  }
});

test("the image and the post keep their words, including the hashtag the scene searches", () => {
  assert.match(share, /\/\/ ───────────── 受付カード ─────────────/);
  assert.match(share, /ctx\.fillText\("財布受付", /);
  assert.match(share, /label: "受付中",/);
  assert.match(share, /paintHeader\(ctx, "ACCEPTING WALLETS", ""\);/);
  assert.match(share, /ctx\.fillText\("#お貢ぎ牧場 #財布募集", /);
  assert.match(core, /#お貢ぎ牧場 #財布募集`;/);
});

test("cache keys", () => {
  assert.match(index, /"module": "tribute\.js\?v=[^"]*-ranch-reception-card-v1(?:-[a-z0-9-]+)?"/);
  assert.match(index, /"module": "online\.js\?v=[^"]*-ranch-reception-card-v1(?:-[a-z0-9-]+)?"/);
  assert.match(client, /from "\.\/tribute-share\.mjs\?v=[^"]*-ranch-reception-card-v1(?:-[a-z0-9-]+)?"/);
});
