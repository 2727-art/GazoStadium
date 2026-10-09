"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const appSource = read("app.js");

function fn(name) {
  const start = new RegExp(`^  function ${name}\\(`, "m").exec(appSource);
  assert.ok(start, name);
  const body = appSource.slice(start.index);
  const end = /\n  \}\r?\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 4);
}

function achievementApi() {
  const context = vm.createContext({ window: { addEventListener() {} } });
  vm.runInContext(read("achievements.js"), context);
  return context.window.HariaiAchievements;
}

test("landing render and event binding expose neither retired mode while retaining live entrances and shared cards", () => {
  const bindings = new Map();
  const queried = [];
  const calls = [];
  const app = { innerHTML: "", focus() {} };
  const context = vm.createContext({
    app, currentScreen: "", pendingValueMarketDestination: "", expandedRankingEntryId: "",
    rankingComments: [], rankingCommentsStatus: "",
    document: {
      querySelector(selector) {
        queried.push(selector);
        if (selector !== ".screen.hero" && selector.startsWith("#") && !app.innerHTML.includes(`id="${selector.slice(1)}"`)) return null;
        return { addEventListener(event, callback) { bindings.set(`${selector}:${event}`, callback); } };
      },
    },
    window: {
      HariaiOnline: { getLobbyStats: () => ({}), refreshTopMessages() { calls.push("shared-cards"); } },
      dispatchEvent() {}, scrollTo() {},
    },
    Event: class { constructor(type) { this.type = type; } },
    escapeHtml: String,
    renderLandingTopMessagePanel: () => '<section id="topMessagePanel">共有の推しカード</section>',
    clearRetiredFreeTableInvite() {}, setLandingChrome() {}, bindLandingTopMessageEvents() {},
    startStrategyLab() {}, startOnlineBattle() {}, startAiTextTraining() {}, startRouletteTraining() {},
    startFreeTable() {}, startTribute() {}, startValueMarketRankings() {}, renderRankingScreen() {},
    openOnlineFeature() {}, startAccount() {}, openAudioStudio() {},
  });
  vm.runInContext(["renderLanding", "renderLandingScreen"].map(fn).join("\n"), context);
  context.renderLandingScreen();
  assert.doesNotMatch(app.innerHTML, /fleaMarket|danwakuNote|AnjuPayフリマ|断惑NOTE/);
  assert.equal(queried.some((selector) => /fleaMarket|danwakuNote/.test(selector)), false);
  for (const id of ["onlineButton", "strategyLabButton", "aiTextTrainingButton", "rouletteTrainingButton", "tributeButton", "accountButton", "achievementButton"]) {
    assert.ok(app.innerHTML.includes(`id="${id}"`), id);
    assert.ok(bindings.has(`#${id}:click`), `${id} handler retained`);
  }
  assert.ok(app.innerHTML.includes('id="topMessagePanel"'));
  const communityStart = app.innerHTML.indexOf('id="topMessagePanel"');
  const toolsStart = app.innerHTML.indexOf('class="vl-more"');
  assert.ok(communityStart < toolsStart, "shared cards precede the remaining tools without a retired-card gap");
  assert.doesNotMatch(app.innerHTML, /vl-live-board|いまの参加状況|lobbyStatsRefresh|freeTableStatusButton/);
  assert.deepEqual(calls, ["shared-cards"]);
});

test("retired modes have no global loads or delayed launch path; old modules remain on disk only", () => {
  const html = read("index.html");
  for (const mode of ["flea-market", "danwaku-note"]) {
    assert.doesNotMatch(html, new RegExp(`(?:src|href)="${mode}\\.(?:js|css)(?:\\?|\")`));
    assert.ok(fs.existsSync(path.join(root, `${mode}.js`)));
    assert.ok(fs.existsSync(path.join(root, `${mode}.css`)));
  }
  assert.doesNotMatch(appSource, /function start(?:FleaMarket|DanwakuNote)|pendingFleaMarketDestination|fleaMarketReadyListenerPending|hariai-(?:flea-market|danwaku-note)-ready/);
  assert.doesNotMatch(appSource, /Hariai(?:FleaMarket|DanwakuNote)(?:\?\.)?\.start|Hariai(?:FleaMarket|DanwakuNote)\.start/);
  for (const file of ["app.js", "achievements.js", "velvet.css"]) {
    const reference = html.split("\n").find((line) => line.includes(`${file}?v=`));
    assert.match(reference, /retire-flea-danwaku-v1/);
  }
  assert.match(html, /src="account\.js\?v=/, "wallet remains globally available");
});

test("all 40 retired achievement IDs stay known and locked retired categories are not offered as new goals", () => {
  const api = achievementApi();
  const retired = api.catalog.filter((definition) => ["flea", "danwaku"].includes(definition.scope));
  assert.equal(retired.length, 40);
  assert.ok(retired.every((definition) => definition.legacy && definition.autoPublic === false));
  for (const id of ["flea_listings_1", "flea_listings_1000", "flea_sales_1000", "flea_purchases_10000", "danwaku_streak_1", "danwaku_streak_365"]) {
    assert.ok(api.byId.has(id), id);
  }
  const collection = api.renderCollection({});
  assert.doesNotMatch(collection, /id="achievementCategory-(?:danwaku_note|flea_listing|flea_connections)"/);
  const activeCount = api.catalog.filter((definition) => !definition.legacy).length;
  assert.equal(api.normalizeProfile({}).totalCount, activeCount);
  assert.ok(api.catalog.filter((definition) => ["ai_training", "roulette_training", "tribute"].includes(definition.scope)).every((definition) => !definition.legacy));
});

test("previously unlocked retired records and deliberate showcase selections remain visible", () => {
  const api = achievementApi();
  const ids = ["flea_listings_1", "flea_sales_1000", "danwaku_streak_365"];
  const profile = { unlocked: Object.fromEntries(ids.map((id) => [id, 123])), showcase: ids, customShowcase: ids };
  const normalized = api.normalizeProfile(profile);
  assert.equal(normalized.showcase.length, 3);
  assert.equal(normalized.customShowcase.length, 3);
  const collection = api.renderCollection(profile);
  for (const id of ids) assert.ok(collection.includes(`data-achievement-showcase="${id}"`), id);
  assert.match(collection, /終了モードの記録/);
  assert.match(collection, /FINAL ACHIEVEMENT/);
  assert.equal(normalized.totalCount, api.catalog.filter((definition) => !definition.legacy).length + 3);
});
