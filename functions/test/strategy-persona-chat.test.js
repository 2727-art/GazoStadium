"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const strategy = read("strategy.js");
const css = read("strategy.css");
const index = read("index.html");
const rules = JSON.parse(read("database.rules.json"));
const chatModule = import(pathToFileURL(path.join(root, "strategy-chat.mjs")).href);
const personaModule = import(pathToFileURL(path.join(root, "chat-persona.mjs")).href);
const coreModule = import(pathToFileURL(path.join(root, "strategy-hariai-core.mjs")).href);

const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return source.slice(from, to);
};

test("strategy personas reuse the six persona skins and speak per turn stage", async () => {
  const { strategyTypingText, anonymousPersonaName, STRATEGY_TYPING_STAGES } = await chatModule;
  const { CHAT_PERSONAS } = await personaModule;
  const { HARIAI_PERSONA_TYPES } = await coreModule;
  assert.deepEqual(HARIAI_PERSONA_TYPES.map(({ id }) => id), CHAT_PERSONAS.map(({ id }) => id));
  assert.deepEqual([...STRATEGY_TYPING_STAGES], ["act", "score", "right", "answer", "finish"]);
  assert.equal(strategyTypingText("koakuma", "シオン", "act"), "シオンが、くすくす笑いながら次の1枚を選んでいます♡");
  assert.equal(strategyTypingText("tsuyotsuyo", "ルミナ", "score"), "ルミナが、強気に点数を考えています");
  assert.equal(strategyTypingText("seiso", "", "answer"), "相手が、静かに返事を打っています");
  assert.equal(strategyTypingText("unknown", "シオン", "finish"), "シオンが仕留めの1枚を選んでいます");
  assert.equal(strategyTypingText("koakuma", "シオン", "breakReveal"), "");
  assert.equal(anonymousPersonaName("小悪魔"), "小悪魔さん（匿名）");
  assert.equal(anonymousPersonaName(""), "なりきりさん（匿名）");
});

test("the heart countdown follows the core's consumption order and restarts on a new instruction", async () => {
  const { hariaiHeartBadges } = await chatModule;
  const heart = { kind: "instruction", id: "heart" };
  const slots = [
    { slot: 1, kind: "post", by: "a", receiver: "b", score: 90, right: heart, answer: { ack: true } },
    { slot: 2, kind: "post", by: "b", receiver: "a", captionHeart: true, score: 70 },
    { slot: 3, kind: "post", by: "a", receiver: "b", score: 85, replyHeart: true, right: { kind: "question", id: "spot" }, answer: { text: "そこ", heart: true } },
    { slot: 4, kind: "post", by: "b", receiver: "a", captionHeart: false, score: 91, right: heart, answer: { ack: true } },
    { slot: 5, kind: "post", by: "a", receiver: "b", captionHeart: true, score: 92, right: heart, answer: { ack: true } },
    { slot: 6, kind: "post", by: "b", receiver: "a", captionHeart: true, score: 60, replyHeart: true },
    { slot: 7, kind: "break", by: "b", receiver: "a", finishCaptions: [{ text: "とどめ", heart: true }] },
  ];
  const badges = hariaiHeartBadges(slots);
  assert.deepEqual(Object.fromEntries(badges), {
    "2:caption": "♡1/3",
    "3:reply": "♡2/3",
    "3:answer": "♡3/3",
    "5:caption": "♡1/3",
    "6:caption": "♡1/3",
    "6:reply": "♡2/3",
    "7:finish:0": "♡2/3",
  });
  const finishSlots = [
    { slot: 1, kind: "post", by: "b", receiver: "a", score: 90, right: heart, answer: { ack: true } },
    { slot: 2, kind: "break", by: "a", receiver: "b", finishCaptions: [{ text: "1", heart: true }, { text: "2", heart: true }] },
  ];
  assert.deepEqual(Object.fromEntries(hariaiHeartBadges(finishSlots)), { "2:finish:0": "♡1/3", "2:finish:1": "♡2/3" });
});

test("reactions only target a real bubble and name its author", async () => {
  const { hariaiItemAuthor, isStrategyReactionKey } = await chatModule;
  const slots = [
    { slot: 1, kind: "post", by: "a", receiver: "b", score: 88, right: { kind: "question", id: "spot" }, answer: { text: "ここ" } },
    { slot: 2, kind: "post", by: "b", receiver: "a" },
    { slot: 3, kind: "break", by: "a", receiver: "b" },
    { slot: 4, kind: "post", by: "b", receiver: "a", score: 60, right: { kind: "none" } },
  ];
  assert.equal(hariaiItemAuthor(slots, "t:1:caption"), "a");
  assert.equal(hariaiItemAuthor(slots, "t:1:reply"), "b");
  assert.equal(hariaiItemAuthor(slots, "t:1:right"), "a");
  assert.equal(hariaiItemAuthor(slots, "t:1:answer"), "b");
  assert.equal(hariaiItemAuthor(slots, "t:2:reply"), "", "an unscored post has no reply bubble yet");
  assert.equal(hariaiItemAuthor(slots, "t:3:break"), "a");
  assert.equal(hariaiItemAuthor(slots, "t:3:caption"), "");
  assert.equal(hariaiItemAuthor(slots, "t:4:right"), "", "a skipped right has no bubble");
  assert.equal(hariaiItemAuthor(slots, "t:9:caption"), "");
  assert.equal(hariaiItemAuthor(slots, "c:abc"), "");
  for (const key of ["t:1:caption", "t:30:answer", "c:-Nabc_123"]) assert.equal(isStrategyReactionKey(key), true, key);
  for (const key of ["t:1:image", "x:1", "c:", "c:<script>", `c:${"a".repeat(80)}`]) assert.equal(isStrategyReactionKey(key), false, key);
});

test("the share card labels strategy lines with the move number", async () => {
  const { buildShareCardModel, defaultRoundLabel } = await personaModule;
  const message = { id: "t:3:reply", authorUid: "me", name: "ルミナ", text: "91点　っ…ずるい…♡", round: 3, voiceSetId: "tsuyotsuyo" };
  const base = { messages: [message], selectedIds: ["t:3:reply"], localUid: "me", players: [{ uid: "me" }, { uid: "you" }] };
  assert.equal(buildShareCardModel(base).items[0].roundLabel, "R3");
  assert.equal(buildShareCardModel({ ...base, formatRound: (round) => (round ? `#${round}` : "") }).items[0].roundLabel, "#3");
  assert.equal(defaultRoundLabel(0), "");
  assert.match(strategy, /formatRound: \(round\) => \(Number\(round\) > 0 \? `#\$\{Number\(round\)\}` : ""\),/);
  assert.match(strategy, /modeLabel: "戦略型1on1",/);
  const lines = between(strategy, "function strategyShareMessages()", "function openStrategyShareCard()");
  assert.match(lines, /push\(`t:\$\{slot\.slot\}:caption`/);
  assert.match(lines, /chatFrameId: identified \? message\.chatFrameId \|\| "" : "",/, "anonymous scout lines never carry cosmetics");
});

test("strategy.js wires persona bubbles, the DM header, typing and the anonymous veil", () => {
  assert.match(strategy, /from "\.\/chat-persona\.mjs\?v=chat-persona-v2";/);
  assert.match(strategy, /from "\.\/strategy-chat\.mjs\?v=strategy-persona-chat-v1";/);
  assert.match(between(strategy, "function renderBattle()", "function renderHariaiThread()"), /<div class="hariai-main">\$\{renderHariaiDmHead\(\)\}/);
  assert.match(strategy, /あなたを「\$\{escapeHtml\(personaCallName\(opponent, me\)\)\}」と呼ぶ/);
  const consoleSource = between(strategy, "function renderHariaiConsole()", "function hariaiTypingConsole(");
  for (const stage of ["act", "score", "right", "answer", "finish"]) {
    assert.match(consoleSource, new RegExp(`hariaiTypingConsole\\("${stage}"`), stage);
  }
  assert.match(strategy, /const captionBubble = `<p class="ha-bubble hariai-caption \$\{hariaiPersonaClass\(attacker\)\}">/);
  assert.match(strategy, /<span class="sp-seal\$\{sealClass\}" aria-hidden="true">看破<\/span>/);
  assert.match(strategy, /\$\{HARIAI_BAND_LABELS\[slot\.band\] \|\| ""\}\$\{unlocked \? "が解禁" : ""\}/);
  assert.match(strategy, /<p class="ha-bubble hariai-right is-\$\{slot\.right\.kind\} sp-order">/);
  // 匿名の間は口調名で呼び、ヴェール越しの吹き出しにする。購入した装飾は出さない。
  assert.match(strategy, /if \(anonymous\) return localPlayer \? "あなた" : anonymousPersonaName\(personaLabel\(player\)\);/);
  assert.match(strategy, /const skin = anonymous \? "sp-veil" : \(cosmeticClasses \|\| chatPersonaBubbleClass\(personaId, cosmeticClasses\)\);/);
  assert.match(strategy, /const showIdentityCosmetics = !anonymous && message\.phase !== "scout";/);
  assert.match(strategy, /<span class="sp-veil-lift" aria-hidden="true"><span>ヴェールが外れる…<\/span><\/span>/);
});

test("typing, reactions and share consent stay on P2P and are checked on arrival", () => {
  const dispatch = between(strategy, "async function handleChannelMessage(data) {", "if (state.incomingAvatarTransfer) {");
  for (const type of ["strategy-chat-typing", "strategy-reaction", "strategy-share-consent-request", "strategy-share-consent"]) {
    assert.match(dispatch, new RegExp(`message\\.type === "${type}"`), type);
    assert.doesNotMatch(strategy, new RegExp(`ref\\(database, [^)]*${type}`), `${type} must not touch Firebase`);
  }
  assert.match(strategy, /if \(useOfflineStrategyPreview \|\| !channel \|\| channel\.readyState !== "open" \|\| state\.playerSafetyStopped\) return false;/);
  assert.match(strategy, /if \(strategyReactionAuthor\(message\.key\) !== state\.uid\) return;/);
  assert.match(strategy, /if \(!author \|\| author === state\.uid \|\| state\.playerSafetyStopped\) return;/);
  assert.match(strategy, /\/\^\[0-9a-f\]\{16\}\$\/\.test\(message\.requestId\)/);
  assert.match(strategy, /if \(state\.shareConsent !== "pending" \|\| message\?\.requestId !== state\.shareConsentRequestId\) return;/);
  const send = between(strategy, "async function sendStrategyChat(", "function refreshStrategyChat(");
  assert.match(send, /const effect = stamp \? "" : normalizeChatEffect\(state\.chatEffect\);/);
  assert.match(send, /if \(effect\) message\.effect = effect;/);
  assert.doesNotMatch(send, /voiceSetId/, "the persona comes from the room's player data, not the message");
  assert.match(strategy, /resetStrategyPersonaChatState\(state\);\n\}/);
});

test("phones open the chat from a bottom bar outside the animated screen; the review keeps it inline", () => {
  assert.match(strategy, /app\.querySelector\("\.screen"\)\?\.insertAdjacentHTML\("afterend", renderStrategyChatDock\(\)\);/);
  const dock = between(strategy, "function renderStrategyChatDock()", "function setStrategyChatOpen(");
  assert.match(dock, /if \(state\.screen === "review"\) return panel;/);
  assert.match(dock, /data-strategy-chat-toggle aria-expanded="\$\{strategyChatOpen\}" aria-controls="strategyChatSheet"/);
  const mobile = css.slice(css.indexOf("/* スマホ・タブレット：チャットは画面下の帯から開く"));
  assert.match(mobile, /@media \(max-width: 900px\) \{\n  \.sc-dock \{\n    position: fixed;/);
  assert.match(mobile, /body:has\(\.sc-dock\) #app \{\n    padding-bottom: calc\(80px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(css, /\.sc-dock-peek,\n\.sc-dock-close \{\n  display: none;\n\}/);
});

test("persona bubbles outrank the generic DM colors and motion stops for reduced motion", () => {
  assert.match(css, /:where\(\.sp-persona\) \{/);
  assert.match(css, /\.hariai-thread \.ha-msg \.ha-bubble\.sp-persona,\n\.hariai-console \.ha-msg \.ha-bubble\.sp-persona \{/);
  assert.match(css, /\.strategy-identity-screen:not\(\.is-refresh\) \.sp-veil-lift \{\n  animation: sp-veil-lift/);
  assert.match(css, /\.strategy-identity-screen:not\(\.is-refresh\) \+ \.sc-dock \.strategy-chat-panel \.chat-message p\.chat-persona-bubble \{\n  animation: sp-unveil/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce) {"));
  for (const selector of [".hariai-band.sp-band-ribbon.is-fresh", ".sp-seal.is-fresh", ".strategy-identity-screen:not(.is-refresh) .sp-veil-lift"]) {
    assert.ok(reduced.includes(selector), selector);
  }
  // 既存の並び（スマホ：メモ→スレッド→秘密、PC：スレッドの右にメモ）は変えない。
  assert.match(css, /grid-template-areas: "memo" "main" "side";/);
  assert.match(css, /grid-template-areas: "main memo" "main side";/);
});

test("the strategy chat rules accept only known effects and still reject unknown fields", () => {
  const message = rules.rules.online.strategyChats.$roomId.$messageId;
  assert.equal(message.effect[".validate"], "!newData.exists() || (newData.isString() && newData.val().matches(/^(whisper|emphasis|tremble|hearts)$/) && !newData.parent().child('stampId').exists())");
  assert.equal(message.$other[".validate"], false);
  assert.match(index, /strategy\.js\?v=[^"]*-strategy-persona-chat-v1"/);
  assert.match(index, /strategy\.css\?v=[^"]*-strategy-persona-chat-v1"/);
  assert.match(index, /online\.js\?v=[^"]*-chat-persona-v2"/);
  // プレビューでは対戦の開始や承諾の操作を実行しない。
  const blocked = strategy.match(/const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "([^"]+)";/)[1];
  for (const control of ["#strategyAccept", "#strategyWithdraw", "#strategyBattleStart"]) assert.ok(blocked.includes(control), control);
});

test("the strategy card lines come from the real thread and chat, without anonymous cosmetics", async () => {
  const vm = require("node:vm");
  const { normalizeChatPersonaId } = await personaModule;
  const { ensureHariaiHeart } = await coreModule;
  const players = [
    { uid: "me", name: "ルミナ", persona: { type: "tsuyotsuyo" } },
    { uid: "you", name: "シオン", persona: { type: "koakuma" } },
  ];
  const context = vm.createContext({
    state: {
      replay: {
        slots: [
          { slot: 1, kind: "post", by: "you", receiver: "me", caption: "ねぇ、これ好きでしょ？", captionHeart: true, score: 91, reply: "っ…ずるい", replyHeart: false, right: { kind: "question", id: "spot" }, answer: { text: "目" } },
          { slot: 2, kind: "break", by: "me", receiver: "you", guess: 0 },
        ],
      },
      chatMessages: [
        { id: "scout1", authorUid: "you", text: "メガネって、どう？", phase: "scout", round: 1, chatFrameId: "chat_frame_heart_ribbon" },
        { id: "battle1", authorUid: "me", text: "効いてるんだ？", phase: "battle", round: 2, effect: "emphasis", chatFrameId: "chat_frame_heart_ribbon" },
      ],
    },
    playerByUid: (uid) => players.find((player) => player.uid === uid),
    normalizeChatPersonaId,
    ensureHariaiHeart,
    hariaiRightPrompt: () => "今の、どこが刺さったの？",
    candidateText: () => "ツインテ",
    hariaiAckLine: () => "はい♡",
    personaLine: (player, key, values = {}) => (key === "breakCall" ? `${values.candidate}でしょ？♡` : "参りました"),
  });
  const source = [
    between(strategy, "function hariaiAnswerText(", "function renderHariaiRightBlock("),
    between(strategy, "function strategyShareMessages()", "function openStrategyShareCard()"),
  ].join("\n");
  vm.runInContext(`${source}\nthis.lines = strategyShareMessages();`, context);
  const lines = JSON.parse(JSON.stringify(context.lines));
  assert.deepEqual(lines.map(({ id, authorUid, text, round, voiceSetId }) => ({ id, authorUid, text, round, voiceSetId })), [
    { id: "t:1:caption", authorUid: "you", text: ensureHariaiHeart("ねぇ、これ好きでしょ？"), round: 1, voiceSetId: "koakuma" },
    { id: "t:1:reply", authorUid: "me", text: "91点　っ…ずるい", round: 1, voiceSetId: "tsuyotsuyo" },
    { id: "t:1:right", authorUid: "you", text: "質問｜今の、どこが刺さったの？", round: 1, voiceSetId: "koakuma" },
    { id: "t:1:answer", authorUid: "me", text: "目", round: 1, voiceSetId: "tsuyotsuyo" },
    { id: "t:2:break", authorUid: "me", text: "看破｜ツインテでしょ？♡", round: 2, voiceSetId: "tsuyotsuyo" },
    { id: "c:scout1", authorUid: "you", text: "メガネって、どう？", round: 0, voiceSetId: "koakuma" },
    { id: "c:battle1", authorUid: "me", text: "効いてるんだ？", round: 2, voiceSetId: "tsuyotsuyo" },
  ]);
  assert.equal(lines.find((line) => line.id === "c:scout1").chatFrameId, "", "anonymous scout lines drop purchased frames");
  assert.equal(lines.find((line) => line.id === "c:battle1").chatFrameId, "chat_frame_heart_ribbon");
  assert.equal(lines.find((line) => line.id === "c:battle1").effect, "emphasis");
});
