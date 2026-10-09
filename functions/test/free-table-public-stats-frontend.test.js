"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("landing retires the free-table card and room counts while preserving battle counts", () => {
  const source = read("app.js");
  assert.doesNotMatch(source, /freeTableButton|boardFreeTable|freeTableLampPresentation|lobbyStats\.freeTable/);
  for (const id of ["boardSoloWaitingCount", "boardSoloPlayingCount", "boardStrategyWaitingCount", "boardStrategyPlayingCount"]) {
    assert.ok(source.includes(id), id);
  }
  assert.match(source, /人数はページ表示時点の参考値/);
  assert.doesNotMatch(source, /自由卓は人数ではなく|自由卓の同席中/);
});

test("neither the initial snapshot nor either match result requests free-table public stats", () => {
  for (const file of ["online.js", "strategy.js"]) {
    assert.doesNotMatch(read(file), /freeTablePublicStats|FreeTablePublicStats|FREE_TABLE_PUBLIC_STATS|hariai-free-table-public-stats-updated|data-free-table-lamp-refresh/);
  }
  assert.match(read("online.js"), /get\(ref\(database, "online\/publicPresence"\)\)/);
});

test("retired invite navigation defers lobby reads until the user returns home", () => {
  const online = read("online.js");
  const loader = online.slice(online.indexOf("function loadInitialLobbyStats()"), online.indexOf("function watchLobbyStats()"));
  assert.ok(loader.indexOf('has("freeTableInvite")') < loader.indexOf('get(ref(database'));
  assert.match(read("app.js"), /if \(!openInitialFreeTableInvite\(\)\) renderLandingScreen\(\);/);
  assert.match(read("app.js"), /function renderLandingScreen\(\) \{\s*clearRetiredFreeTableInvite\(\);/);
});

test("HTML has no free-table loads or promotion and all changed active scripts have retirement cache tokens", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /(?:src|href)="free-table\.(?:js|css)|貼り合い自由卓/);
  for (const file of ["app.js", "online.js", "strategy.js", "ai-text-training.js", "roulette-training.js", "tribute.js"]) {
    const line = html.split("\n").find((entry) => entry.includes(file + "?v="));
    assert.match(line, /retire-free-table-v1/, file);
  }
  assert.match(read("ai-text-training.js"), /from "\.\/free-table-ambience\.mjs\?v=/);
  assert.ok(fs.existsSync(path.join(root, "free-table-media.mjs")));
});
