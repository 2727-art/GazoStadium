"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const app = read("app.js");
const velvet = read("velvet.css");
const index = read("index.html");
const heroModuleSource = read("landing-hero.mjs");
const heroModule = import(pathToFileURL(path.join(root, "landing-hero.mjs")).href);
const roleplayModule = import(pathToFileURL(path.join(root, "finish-roleplay.mjs")).href);
const personaModule = import(pathToFileURL(path.join(root, "chat-persona.mjs")).href);

function fn(name) {
  const start = new RegExp(`^  function ${name}\\(`, "m").exec(app);
  assert.ok(start, name);
  const body = app.slice(start.index);
  const end = /\n  \}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 4);
}

function renderLanding(stats) {
  const context = vm.createContext({
    window: { HariaiOnline: { getLobbyStats: () => stats } },
    escapeHtml: String,
    renderLandingTopMessagePanel: () => "",
  });
  vm.runInContext(["freeTableLampPresentation", "renderLanding"].map(fn).join("\n"), context);
  return context.renderLanding();
}

const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return source.slice(from, to);
};

test("the hero opens like an X DM thread that only this site can decorate", async () => {
  const { personaTypingText } = await personaModule;
  const html = renderLanding({ solo: { waiting: 2, playing: 4 } });
  const hero = between(html, '<div class="vl-hero">', '<section class="vl-board"');
  assert.match(hero, /<p class="vl-eyebrow">#貼り合い ・ 1on1<\/p>/);
  assert.match(hero, /<p class="vl-lead">DMじゃ物足りない貼り合いに。<em>女の子になり切れる吹き出し<\/em>で、刺さり具合を点で返す。<\/p>/);
  assert.match(hero, /<div class="vl-hero-stage" data-landing-hero>/);
  assert.match(hero, /<span class="vl-dm-who"><b>シオン<\/b><small><span class="chat-persona-mark is-koakuma" aria-hidden="true"><\/span>小悪魔で貼り合い中<\/small><\/span>/);
  assert.match(hero, /<span class="vl-dm-lock">P2P<\/span>/);
  assert.match(hero, /<span class="ha-bubble vl-persona-bubble chat-persona-koakuma chat-fx-hearts">ねぇ、これ好きでしょ？♡<span class="chat-reaction-sticker is-kiss"><\/span><\/span>/);
  assert.match(hero, /class="ha-bubble ha-score-bubble vl-persona-bubble chat-persona-tsuyotsuyo" data-hero-reply><span class="vl-crit">CRITICAL<\/span><b class="ha-score-number">90<small>点<\/small><\/b>っ…90点。ずるい…♡<\/span>/);
  // 入力中の一文は、チャットで実際に出る口調ごとの文言と同じ
  assert.ok(hero.includes(`${personaTypingText("koakuma", "シオン")}<span class="chat-typing-dots">`));
  assert.doesNotMatch(hero, /https?:\/\/|www\./, "the hero carries no URL");
});

test("the persona switch lists the six voice sets and swaps in their real high-score lines", async () => {
  const { ROLEPLAY_VOICE_SETS } = await roleplayModule;
  const { CHAT_PERSONAS } = await personaModule;
  const { heroReplyLine, heroPersonaLabel, HERO_DEFAULT_PERSONA } = await heroModule;
  const html = renderLanding({});
  const chips = [...html.matchAll(/<button type="button" class="vl-persona-chip" data-hero-persona="([a-z]+)" aria-pressed="(true|false)"><span class="chat-persona-mark is-\1" aria-hidden="true"><\/span>([^<]+)<\/button>/g)];
  assert.deepEqual(chips.map((match) => match[1]), ROLEPLAY_VOICE_SETS.map(({ id }) => id));
  assert.deepEqual(chips.map((match) => match[3]), ROLEPLAY_VOICE_SETS.map(({ label }) => label));
  assert.deepEqual(chips.filter((match) => match[2] === "true").map((match) => match[1]), [HERO_DEFAULT_PERSONA]);
  assert.deepEqual(CHAT_PERSONAS.map(({ id }) => id), ROLEPLAY_VOICE_SETS.map(({ id }) => id));
  for (const voiceSet of ROLEPLAY_VOICE_SETS) {
    assert.equal(heroReplyLine(voiceSet.id), voiceSet.reactions.high[0].replaceAll("{score}", "90"));
    assert.equal(heroPersonaLabel(voiceSet.id), voiceSet.label);
    assert.doesNotMatch(heroReplyLine(voiceSet.id), /9点|\{score\}/);
  }
  // 最初に描く返事（つよつよ）と、口調スイッチが入れる文言が一致する
  assert.ok(html.includes(`<b class="ha-score-number">90<small>点</small></b>${heroReplyLine(HERO_DEFAULT_PERSONA)}</span>`));
  assert.ok(html.includes(`<span data-hero-me>あなた（${heroPersonaLabel(HERO_DEFAULT_PERSONA)}）</span>`));
  assert.equal(heroReplyLine("unknown"), "");
  // 口調スイッチは見本だけを変え、対戦の設定や保存値には触れない
  assert.doesNotMatch(heroModuleSource, /localStorage|sessionStorage|fetch\(|HariaiOnline\?\.(?!getLobbyStats)/);
});

test("the main entrance phrases live counts without showing zero and hides unknown counts", async () => {
  const { heroLiveState } = await heroModule;
  const cases = [
    [{ waiting: 2, playing: 4 }, "both"],
    [{ waiting: 1, playing: 0 }, "waiting"],
    [{ waiting: 0, playing: 3 }, "playing"],
    [{ waiting: 0, playing: 0 }, "empty"],
    [{ waiting: null, playing: null }, "unknown"],
    [undefined, "unknown"],
  ];
  for (const [solo, expected] of cases) {
    assert.equal(heroLiveState(solo), expected, JSON.stringify(solo));
    const html = renderLanding(solo ? { solo } : {});
    assert.ok(html.includes(`<em class="vl-live" data-hero-live="${expected}">`), `app.js renders ${expected}`);
  }
  const html = renderLanding({ solo: { waiting: 2, playing: 4 } });
  assert.match(html, /<span class="vl-live-on">いま<span class="vl-live-waiting"><b id="heroSoloWaitingCount">2<\/b>人が相手待ち<\/span><span class="vl-live-sep">・<\/span><span class="vl-live-playing"><b id="heroSoloPlayingCount">4<\/b>人が対戦中<\/span><\/span><span class="vl-live-first">一番乗りで待ってみる<\/span>/);
  assert.match(velvet, /\.vl-live\[data-hero-live="unknown"\] \{\n  display: none;\n\}/);
  assert.match(velvet, /\.vl-live\[data-hero-live="empty"\] \.vl-live-on,\n\.vl-live\[data-hero-live="waiting"\] \.vl-live-playing,\n\.vl-live\[data-hero-live="playing"\] \.vl-live-waiting \{\n  display: none;\n\}/);
  assert.match(heroModuleSource, /window\.addEventListener\("hariai-lobby-stats-updated", \(\) => applyHeroLive\(\)\);/);
});

test("trust chips and the memorable scene teaser state only what the game guarantees", () => {
  const html = renderLanding({});
  const actions = between(html, '<div class="hero-actions">', '<section class="vl-board"');
  assert.deepEqual([...actions.matchAll(/<li><i class="is-[a-z]+" aria-hidden="true"><\/i>([^<]+)<\/li>/g)].map((match) => match[1]), [
    "画像はサーバーに残らない",
    "登録なしですぐ",
    "なりきり口調6種",
  ]);
  assert.doesNotMatch(actions, /安全|絶対|無料/);
  assert.match(actions, /<section class="vl-meibamen" aria-labelledby="meibamenTitle">/);
  assert.match(actions, /<h2 id="meibamenTitle">終わったら「名場面カード」に<\/h2><p>チャットの吹き出しをそのまま1枚の画像に。相手の名前と発言は、相手が許可した時だけ載ります。<\/p>/);
  assert.match(actions, /<em>#貼り合いスタジアム<\/em>/);
});

test("phones put the entrance before the sample, while PC keeps the sample in the right column", () => {
  const hero = between(velvet, "/* スマホは見出し→入口→見本の順。", ".vl-copy {");
  assert.match(hero, /grid-template-areas: "copy" "actions" "stage";/);
  const desktopBlocks = velvet.split("@media (min-width: 900px) {");
  assert.ok(desktopBlocks.length >= 3, "the hero adds its own desktop block after the shared one");
  assert.doesNotMatch(desktopBlocks[1].split("\n}\n")[0], /"copy stage"/, "the first desktop block stays the shared column layout");
  assert.match(velvet, /\.hero\.vl-landing > \.vl-hero \{\n    grid-template-areas: "copy stage" "actions stage";/);
  assert.match(velvet, /\.hero\.vl-landing > \.vl-meibamen \{\n    width: min\(880px, 100%\);/);
  assert.match(velvet, /\.vl-landing \.hero-actions \{\n  grid-area: actions;/);
  // 入口は見本より後ろに書いたまま（読み上げ順は 見出し→見本→入口）。並びの入れ替えは見た目だけ。
  assert.ok(app.indexOf('<div class="vl-hero-stage" data-landing-hero>') < app.indexOf('<div class="hero-actions">'));
});

test("the sample animation plays once when seen and stays still for reduced motion", () => {
  assert.match(heroModuleSource, /let introPlayed = false;/);
  assert.match(heroModuleSource, /if \(introPlayed \|\| prefersReducedMotion\(\)\) return;/);
  assert.match(heroModuleSource, /new IntersectionObserver\(/);
  assert.match(heroModuleSource, /window\.addEventListener\("hariai-landing-rendered", \(\) => bindLandingHero\(\)\);/);
  for (const selector of [".vl-hero-thread.is-intro .ha-msg.is-mine", ".vl-hero-thread.is-intro .vl-crit", ".vl-hero-thread.is-intro .chat-reaction-sticker", ".vl-hero-thread.is-intro .vl-hero-typing"]) {
    assert.ok(velvet.includes(`${selector} {`), selector);
  }
  const reduced = velvet.slice(velvet.lastIndexOf("@media (prefers-reduced-motion: reduce) {"));
  for (const selector of [".vl-hero-thread .chat-fx-hearts::before", ".vl-hero-thread .vl-persona-bubble.is-bump", ".vl-hero-typing .chat-typing-dots i"]) {
    assert.ok(reduced.includes(selector), selector);
  }
});

test("the hero module ships after app.js and shares the roleplay module instance with online.js", () => {
  const appLine = index.split("\n").findIndex((line) => line.includes('src="app.js?v='));
  const heroLine = index.split("\n").findIndex((line) => line.includes('src="landing-hero.mjs?v=hero-persona-v1"'));
  assert.ok(appLine >= 0 && heroLine === appLine + 1, "the module follows app.js");
  assert.match(index.split("\n")[heroLine], /<script type="module" src="landing-hero\.mjs\?v=hero-persona-v1"><\/script>/);
  assert.match(index, /app\.js\?v=[^"]*hero-score-90-v1-hero-image-v1-hero-persona-v1"/);
  assert.match(index, /velvet\.css\?v=[^"]*hero-persona-v1"/);
  const onlineImport = read("online.js").match(/from "\.\/finish-roleplay\.mjs\?v=([^"]+)"/)[1];
  assert.ok(heroModuleSource.includes(`from "./finish-roleplay.mjs?v=${onlineImport}"`));
});
