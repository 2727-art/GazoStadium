const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const personaModule = import(pathToFileURL(path.join(root, "chat-persona.mjs")).href);
const roleplayModule = import(pathToFileURL(path.join(root, "finish-roleplay.mjs")).href);
const online = read("online.js");
const index = read("index.html");
const css = read("chat-persona.css");
const personaSource = read("chat-persona.mjs");
const rules = JSON.parse(read("database.rules.json"));
const chatRules = rules.rules.online.rooms.$roomId.chat.$messageId;

// 文字数×20pxで測る。Canvasなしで折り返しと大きさを確かめる。
const measure = (text) => Array.from(String(text)).length * 20;

const MESSAGES = [
  { id: "m1", authorUid: "remote", name: "シオン", text: "よろしくお願いします！", round: 1, voiceSetId: "oneesan" },
  { id: "m2", authorUid: "local", name: "ルミナ", text: "今夜は本気で来ました", round: 1, voiceSetId: "koakuma", effect: "emphasis" },
  { id: "m3", authorUid: "remote", name: "シオン", text: "ずるい…", round: 2, voiceSetId: "oneesan", effect: "tremble", stampId: "" },
  { id: "m4", authorUid: "remote", name: "シオン", text: "いいね！", round: 2, stampId: "stamp_like" },
];
const PLAYERS = [{ uid: "local", name: "ルミナ" }, { uid: "remote", name: "シオン" }];

test("personas reuse the roleplay voice set ids and reject unknown values", async () => {
  const { CHAT_PERSONAS, normalizeChatPersonaId, normalizeChatEffect, normalizeChatReactionId, personaTypingText } = await personaModule;
  const { ROLEPLAY_VOICE_SETS } = await roleplayModule;
  assert.deepEqual(CHAT_PERSONAS.map(({ id }) => id), ROLEPLAY_VOICE_SETS.map(({ id }) => id));
  assert.deepEqual(CHAT_PERSONAS.map(({ label }) => label), ROLEPLAY_VOICE_SETS.map(({ label }) => label));
  assert.equal(normalizeChatPersonaId("koakuma"), "koakuma");
  assert.equal(normalizeChatPersonaId("__proto__"), "");
  assert.equal(normalizeChatEffect("hearts"), "hearts");
  assert.equal(normalizeChatEffect("rainbow"), "");
  assert.equal(normalizeChatReactionId("kiss"), "kiss");
  assert.equal(normalizeChatReactionId("<img>"), "");
  assert.equal(personaTypingText("koakuma", "シオン"), "シオンが、くすくす笑いながら打っています♡");
  assert.equal(personaTypingText("", ""), "相手が入力しています");
});

test("persona bubbles never override purchased frames or backgrounds", async () => {
  const { chatPersonaBubbleClass, chatEffectClass, renderChatEffectText } = await personaModule;
  assert.equal(chatPersonaBubbleClass("koakuma", ""), "chat-cosmetic-bubble chat-persona-bubble chat-persona-koakuma");
  assert.equal(chatPersonaBubbleClass("koakuma", "chat-cosmetic-bubble chat-frame-heart-ribbon"), "");
  assert.equal(chatPersonaBubbleClass("unknown", ""), "");
  assert.equal(chatEffectClass("whisper"), "chat-fx chat-fx-whisper");
  assert.equal(chatEffectClass("bogus"), "");
  assert.equal(renderChatEffectText("<b>", "emphasis"), "&lt;b&gt;");
  const trembling = renderChatEffectText("あ<い", "tremble");
  assert.match(trembling, /<span class="chat-fx-char" style="--i:0">あ<\/span>/);
  assert.match(trembling, /&lt;/);
  assert.doesNotMatch(trembling, /<い/);
});

test("share cards mask the opponent until they consent and keep only selected lines", async () => {
  const { buildShareCardModel } = await personaModule;
  const masked = buildShareCardModel({
    messages: MESSAGES,
    selectedIds: ["m1", "m2", "m4"],
    localUid: "local",
    players: PLAYERS,
    reactions: new Map([["m2", "crown"]]),
    result: { result: "WIN", details: ["残りHP 24"] },
  });
  assert.equal(masked.items.length, 3);
  assert.equal(masked.hasMaskedLines, true);
  const [remoteLine, localLine, remoteStamp] = masked.items;
  assert.deepEqual(
    { name: remoteLine.name, text: remoteLine.text, masked: remoteLine.masked, side: remoteLine.side },
    { name: "相手", text: "", masked: true, side: "right" },
  );
  assert.equal(remoteStamp.stampId, "", "an unconsented stamp must not reveal what was sent");
  assert.equal(localLine.text, "今夜は本気で来ました");
  assert.equal(localLine.reactionId, "crown");
  assert.equal(localLine.side, "left");
  assert.equal(masked.resultLine, "WIN  ·  残りHP 24");

  const granted = buildShareCardModel({
    messages: MESSAGES,
    selectedIds: ["m1", "m2"],
    localUid: "local",
    players: PLAYERS,
    consentGranted: true,
    hideOwnName: true,
    includeResult: false,
    result: { result: "WIN" },
  });
  assert.equal(granted.items[0].name, "シオン");
  assert.equal(granted.items[0].text, "よろしくお願いします！");
  assert.equal(granted.items[1].name, "わたし");
  assert.equal(granted.resultLine, "");
  assert.equal(granted.hasMaskedLines, false);

  const many = Array.from({ length: 14 }, (_, index) => ({ id: `x${index}`, authorUid: "local", name: "ルミナ", text: `line ${index}`, round: 1 }));
  assert.equal(buildShareCardModel({ messages: many, selectedIds: many.map(({ id }) => id), localUid: "local", players: PLAYERS }).items.length, 10);
});

test("masked bubbles have a fixed size so the hidden text length does not leak", async () => {
  const { buildShareCardModel, layoutShareCard } = await personaModule;
  const sizeFor = (text) => {
    const model = buildShareCardModel({
      messages: [{ id: "a", authorUid: "remote", name: "シオン", text, round: 1 }],
      selectedIds: ["a"],
      localUid: "local",
      players: PLAYERS,
    });
    const [item] = layoutShareCard(model, measure).items;
    return [item.bubbleWidth, item.bubbleHeight];
  };
  assert.deepEqual(sizeFor("短い"), sizeFor("とても長い発言がここに入ります。".repeat(4)));
});

test("text wraps inside the card width and emphasis makes bubbles taller", async () => {
  const { buildShareCardModel, layoutShareCard, wrapChatText, SHARE_CARD_WIDTH } = await personaModule;
  const lines = wrapChatText("あいうえおかきくけこさしすせそ", 100, measure);
  assert.deepEqual(lines, ["あいうえお", "かきくけこ", "さしすせそ"]);
  assert.deepEqual(wrapChatText("hello world", 120, measure), ["hello", "world"]);
  const layoutFor = (effect) => layoutShareCard(buildShareCardModel({
    messages: [{ id: "a", authorUid: "local", name: "ルミナ", text: "今夜は本気で来ました", round: 1, effect }],
    selectedIds: ["a"],
    localUid: "local",
    players: PLAYERS,
  }), measure).items[0];
  const plain = layoutFor("");
  const emphasis = layoutFor("emphasis");
  assert.ok(emphasis.bubbleHeight > plain.bubbleHeight);
  for (const item of [plain, emphasis]) {
    assert.ok(item.x >= 0 && item.x + item.bubbleWidth <= SHARE_CARD_WIDTH);
  }
});

test("share output carries the brand and hashtags but never a URL", async () => {
  const { SHARE_CARD_HASHTAGS } = await personaModule;
  assert.equal(SHARE_CARD_HASHTAGS, "#貼り合い #貼り合いスタジアム");
  assert.doesNotMatch(personaSource, /https?:\/\/|www\.|workers\.dev|web\.app/);
  assert.match(personaSource, /const shareText = `貼り合いスタジアム｜\$\{options\.modeLabel \|\| "通常型1on1"\}の名場面\\n\$\{SHARE_CARD_HASHTAGS\}`;/);
  assert.match(personaSource, /navigator\.share\(\{ files: \[file\], text: shareText \}\)/);
});

test("CSS masks draw the same icon shapes as the share card canvas", async () => {
  const { CHAT_ICON_PATHS, CHAT_PERSONAS, CHAT_REACTIONS } = await personaModule;
  for (const [name, d] of Object.entries(CHAT_ICON_PATHS)) {
    const match = css.match(new RegExp(`--cp-icon-${name}: url\\("data:image/svg\\+xml;utf8,<svg[^"]*?d='([^']+)'`));
    assert.ok(match, `--cp-icon-${name} is missing`);
    assert.equal(match[1], d, `--cp-icon-${name} drifted from CHAT_ICON_PATHS`);
  }
  for (const persona of CHAT_PERSONAS) {
    assert.match(css, new RegExp(`\\.chat-persona-${persona.id} \\{`));
    assert.match(css, new RegExp(`\\.chat-persona-mark\\.is-${persona.id} \\{ --cp-mark: var\\(--cp-icon-${persona.mark}\\)`));
  }
  for (const reaction of CHAT_REACTIONS) {
    assert.match(css, new RegExp(`\\.is-${reaction.id} \\{ --cp-react-color: ${reaction.color}; --cp-react-icon: var\\(--cp-icon-${reaction.icon}\\)`));
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("database rules accept only known persona and effect ids on 1on1 chat", async () => {
  const { CHAT_PERSONAS, CHAT_EFFECTS } = await personaModule;
  const personaPattern = chatRules.voiceSetId[".validate"].match(/\^\(([^)]+)\)\$/)[1].split("|");
  const effectPattern = chatRules.effect[".validate"].match(/\^\(([^)]+)\)\$/)[1].split("|");
  assert.deepEqual(personaPattern, CHAT_PERSONAS.map(({ id }) => id));
  assert.deepEqual(effectPattern, CHAT_EFFECTS.map(({ id }) => id).filter(Boolean));
  assert.match(chatRules.voiceSetId[".validate"], /^!newData\.exists\(\) \|\|/);
  assert.match(chatRules.effect[".validate"], /!newData\.parent\(\)\.child\('stampId'\)\.exists\(\)/);
  assert.match(chatRules[".validate"], /newData\.child\('text'\)\.val\(\)\.length <= 80/);
});

test("1on1 chat sends persona metadata and keeps reactions, typing and consent on P2P", () => {
  assert.match(online, /from "\.\/chat-persona\.mjs\?v=chat-persona-v2";/);
  assert.match(index, /<link rel="stylesheet" href="chat-persona\.css\?v=chat-persona-v1" \/>/);
  assert.match(index, /online\.js\?v=[^"]*-chat-persona-v1-chat-persona-v2-retire-free-table-v1-ranch-deco-v1"/);

  const sendChat = online.slice(online.indexOf("async function sendChat("), online.indexOf("function refreshChat("));
  assert.match(sendChat, /if \(voiceSetId\) message\.voiceSetId = voiceSetId;/);
  assert.match(sendChat, /if \(effect\) message\.effect = effect;/);
  assert.match(sendChat, /const effect = stamp \? "" : normalizeChatEffect\(state\.chatEffect\);/);

  for (const type of ["chat-typing", "chat-reaction", "share-consent-request", "share-consent"]) {
    assert.match(online, new RegExp(`message\\.type === "${type}"`), `${type} is not dispatched`);
    assert.doesNotMatch(online, new RegExp(`ref\\(database, [^)]*${type}`), `${type} must not touch Firebase`);
  }
  assert.match(online, /if \(!target \|\| target\.authorUid !== targetState\.uid\) return;/);
  assert.match(online, /if \(!channel \|\| channel\.readyState !== "open" \|\| targetState\.playerSafetyStopped\) return false;/);
  assert.match(online, /\/\^\[0-9a-f\]\{16\}\$\/\.test\(message\.requestId\)/);
  assert.match(online, /if \(targetState\.shareConsent !== "pending" \|\| message\?\.requestId !== targetState\.shareConsentRequestId\) return;/);
});

test("the result screen offers the card unless contact was stopped", () => {
  const gameOver = online.slice(online.indexOf("function renderGameOver()"), online.indexOf("function getEngawaMood()"));
  assert.match(gameOver, /state\.playerSafetyStopped \? "" : '<button class="button button-ghost" type="button" id="onlineShareCard">名場面カードを作る<\/button>'/);
  assert.match(online, /if \(!canOpenShareCard\(\)\) \{\r?\n    showToast\("カードにできる発言がまだありません。/);
  assert.match(gameOver, /\$\{renderShareConsentAsk\(\)\}<div class="result-chat">/);
  assert.match(online, /function canOpenShareCard\(\) \{\r?\n  return !state\.playerSafetyStopped && /);
  assert.match(online, /document\.querySelector\("#onlineShareCard"\)\?\.addEventListener\("click", openOnlineShareCard\);/);
  assert.match(online, /resetChatPersonaState\(state\);\r?\n\}/);
});
