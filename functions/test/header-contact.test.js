"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const index = read("index.html");
const velvet = read("velvet.css");

test("the header links to the operator's X account for support and requests", () => {
  const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(index)?.[0];
  assert.ok(header);
  const link = /<a class="header-contact"[^>]*>[\s\S]*?<\/a>/.exec(header)?.[0];
  assert.ok(link);
  assert.match(link, /href="https:\/\/x\.com\/lasmemodaisuki"/);
  assert.match(link, /target="_blank" rel="noopener noreferrer"/);
  assert.match(link, /aria-label="ご要望・お問い合わせ[^"]*@lasmemodaisuki[^"]*新しいタブ[^"]*"/);
  assert.match(link, /<span class="header-contact-full">ご要望・お問い合わせ<\/span><span class="header-contact-short">問い合わせ<\/span>/);
  assert.match(index, /velvet\.css\?v=[^"]*-header-contact-v1"/);
});

test("narrow screens stack a short label under the X icon and keep the whole brand name", () => {
  assert.match(velvet, /\.header-contact \{\n  display: inline-flex;\n  flex: none;/);
  assert.match(velvet, /\.header-contact-short \{\n  display: none;\n\}/);
  const compact = /@media \(max-width: 1000px\) \{[\s\S]*?\n\}/.exec(velvet)?.[0];
  assert.ok(compact);
  assert.match(compact, /\.header-contact \{[^}]*flex-direction: column;/);
  assert.match(compact, /\.header-contact-full \{\n    display: none;\n  \}/);
  assert.match(compact, /\.header-contact-short \{\n    display: block;\n  \}/);

  assert.match(index, /<strong>貼り合い<wbr \/>スタジアム<\/strong>/);
  assert.match(velvet, /\.brand-mark \{\n  width: 34px;\n  height: 30px;\n  flex: none;/);
  assert.match(velvet, /\.brand strong \{[^}]*word-break: keep-all;/);
  assert.match(velvet, /@media \(max-width: 560px\) \{\n  \.header-badges \.status-dot \{\n    display: none;/);
  assert.match(velvet, /@media \(max-width: 359px\) \{\n  \.brand-mark \{\n    display: none;/);
});
