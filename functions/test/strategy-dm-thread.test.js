const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const threadModule = import(pathToFileURL(path.join(root, "strategy-dm-thread.mjs")).href);

const POST = { slot: 1, kind: "post", by: "a", receiver: "b" };
const SCORED = { ...POST, score: 91 };
const ANSWERED = { ...SCORED, right: { kind: "question", id: "spot" }, answer: { text: "うなじ" } };

test("a post splits into posted, scored, right and answer as each one happens", async () => {
  const { slotEventKeys } = await threadModule;
  assert.deepEqual(slotEventKeys(POST), ["post:1"]);
  assert.deepEqual(slotEventKeys(SCORED), ["post:1", "score:1"]);
  assert.deepEqual(slotEventKeys({ ...SCORED, score: 0 }), ["post:1", "score:1"], "a zero is still a score");
  assert.deepEqual(slotEventKeys({ ...SCORED, right: { kind: "none" } }), ["post:1", "score:1", "right:1"]);
  assert.deepEqual(slotEventKeys(ANSWERED), ["post:1", "score:1", "right:1", "answer:1"]);
});

test("a break shows the call, then the check, then the finish (even a finish of zero cards)", async () => {
  const { slotEventKeys } = await threadModule;
  const call = { slot: 7, kind: "break", by: "a", receiver: "b", guess: 0 };
  assert.deepEqual(slotEventKeys(call), ["break:7"]);
  assert.deepEqual(slotEventKeys({ ...call, breakResult: "miss" }), ["break:7", "breakResult:7"]);
  assert.deepEqual(slotEventKeys({ ...call, breakResult: "hit", finishCount: 0 }), ["break:7", "breakResult:7", "finish:7"]);
  assert.deepEqual(slotEventKeys({ slot: 3, kind: "pass" }), ["pass:3"]);
  assert.deepEqual(slotEventKeys({ slot: 4, kind: "surrender" }), ["surrender:4"]);
  assert.deepEqual(slotEventKeys({ slot: 0, kind: "post" }), []);
  assert.deepEqual(slotEventKeys({ slot: 2, kind: "unknown" }), []);
});

test("events found at once go scout chat, start, moves by slot, battle chat and video, outcome", async () => {
  const { collectStrategyThreadKeys } = await threadModule;
  const keys = collectStrategyThreadKeys({
    slots: [{ slot: 2, kind: "post", score: 64 }, ANSWERED],
    chats: [
      { id: "s1", phase: "scout" },
      { id: "c1", phase: "battle" },
      { id: "r1", phase: "review" },
      { id: "bad id", phase: "battle" },
      { id: "s2", phase: "scout" },
    ],
    videoIds: ["v1", ""],
    outcome: true,
  });
  assert.deepEqual(keys, [
    "chat:s1", "chat:s2", "start",
    "post:1", "score:1", "right:1", "answer:1", "post:2", "score:2",
    "chat:c1", "video:v1", "outcome",
  ]);
  assert.deepEqual(collectStrategyThreadKeys(), ["start"]);
});

test("the log keeps the order things were first seen, so chat lands between a post and its score", async () => {
  const { appendStrategyThreadEntries, collectStrategyThreadKeys, orderedStrategyThreadEntries } = await threadModule;
  let log = appendStrategyThreadEntries([], collectStrategyThreadKeys({ slots: [POST] }));
  log = appendStrategyThreadEntries(log, collectStrategyThreadKeys({ slots: [POST], chats: [{ id: "c1", phase: "battle" }] }));
  log = appendStrategyThreadEntries(log, collectStrategyThreadKeys({ slots: [SCORED], chats: [{ id: "c1", phase: "battle" }] }));
  assert.deepEqual(log.map((entry) => [entry.key, entry.seq]), [["start", 1], ["post:1", 2], ["chat:c1", 3], ["score:1", 4]]);
  const unchanged = appendStrategyThreadEntries(log, ["post:1", "bogus", "score:0", "chat:", "start"]);
  assert.equal(unchanged, log, "nothing new returns the same log");
  const ordered = orderedStrategyThreadEntries(log, { chatIds: ["c1"] });
  assert.deepEqual(ordered.map((entry) => entry.key), ["start", "post:1", "chat:c1", "score:1"]);
  assert.deepEqual(ordered[1], { kind: "post", slot: 1, key: "post:1", seq: 2 });
});

test("chat trimmed out of the window and released video drop out of the drawn thread", async () => {
  const { appendStrategyThreadEntries, orderedStrategyThreadEntries } = await threadModule;
  const log = appendStrategyThreadEntries([], ["chat:a", "start", "video:v1", "chat:b", "outcome"]);
  assert.deepEqual(
    orderedStrategyThreadEntries(log, { chatIds: ["b"], videoIds: [] }).map((entry) => entry.key),
    ["start", "chat:b", "outcome"],
  );
});

test("keys round-trip and reject anything that is not a thread event", async () => {
  const { parseStrategyThreadKey, strategyThreadKey } = await threadModule;
  assert.equal(strategyThreadKey("start", 9), "start");
  assert.equal(strategyThreadKey("breakResult", 4), "breakResult:4");
  assert.deepEqual(parseStrategyThreadKey("video:abc_DEF-12"), { kind: "video", id: "abc_DEF-12" });
  assert.deepEqual(parseStrategyThreadKey("finish:12"), { kind: "finish", slot: 12 });
  ["", "start:1", "post:0", "post:1.5", "post:x", "chat:a b", "reveal", "t:1:caption"].forEach((key) => {
    assert.equal(parseStrategyThreadKey(key), null, key);
  });
});

const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, end);
  return source.slice(from, to);
};

test("the battle runs as one DM: header, thread, band, sheet and composer, with no separate chat panel", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /from "\.\/strategy-dm-thread\.mjs\?v=strategy-dm-voice-v1";/);
  const battle = between(strategy, "function renderBattle()", "function strategyThreadChats()");
  for (const part of ["renderStrategyDmHead()", "renderStrategyThreadItems()", "renderStrategyBand()", "renderStrategySheet()", "renderStrategyComposer()"]) {
    assert.ok(battle.includes(part), part);
  }
  assert.doesNotMatch(battle, /renderStrategyChat\(\)|renderBattleHud\(\)|renderStrategyVideoPanel\(\)/);
  assert.match(strategy, /if \(isStrategyChatVisible\(\) && state\.screen !== "battle"\) app\.querySelector\("\.screen"\)\?\.insertAdjacentHTML\("afterend", renderStrategyChatDock\(\)\);/);
  // 描き直しでは画像・映像の要素を使い回し、スレッドを読み返している位置を保つ。
  const render = between(strategy, "function render() {", "function renderProfile()");
  assert.match(render, /const threadNodes = screenChanged \? new Map\(\) : collectStrategyThreadNodes\(\);/);
  assert.match(render, /reuseStrategyThreadNodes\(threadNodes\);/);
  assert.match(render, /if \(state\.screen === "battle"\) \{\n    settleStrategyThreadLayout\(\{ follow: screenChanged \}\);/);
  // 操作シートは、スマホではスレッドの下、PC（901px以上）では右の列の一番上。幅をまたいだら描き直す。
  assert.match(battle, /\$\{sheetInThread \? "" : renderStrategyBand\(\)\}\$\{sheetInSide \? "" : sheet\}\$\{renderStrategyComposer\(\)\}/);
  assert.match(battle, /aria-label="あなたの番の操作・読みメモ・あなたの秘密">\n      \$\{sheetInSide \? sheet : ""\}/);
  assert.match(strategy, /return Boolean\(window\.matchMedia\?\.\("\(min-width: 901px\)"\)\.matches\);/);
  assert.match(strategy, /if \(crossed\) render\(\);\n  else settleStrategyThreadLayout\(\);/);
  // チャット・映像が届いた時は、スレッドの中身だけを差し替える。
  assert.match(between(strategy, "function refreshStrategyChat(", "function setStrategyChatEffect("), /if \(refreshStrategyThread\(\)\) return;/);
  assert.match(between(strategy, "function refreshStrategyVideoPanel()", "function ensureStrategyVideoDialog()"), /refreshStrategyThread\(\);\n    refreshStrategyCameraButton\(\);/);
});

test("chat, video and reactions keep their existing wire format and limits", () => {
  const strategy = read("strategy.js");
  const composer = between(strategy, "function renderStrategyComposer()", "function renderHariaiThread()");
  assert.match(composer, /data-strategy-chat>/);
  assert.match(composer, /\$\{renderStrategyCameraButton\(\)\}/);
  assert.match(composer, /id="strategyChatInput" maxlength="80" value="\$\{escapeHtml\(state\.chatDraft\)\}"/);
  assert.match(between(strategy, "function renderStrategyCameraButton()", "function refreshStrategyCameraButton()"), /data-strategy-video-open \$\{video\.canRecord \? "" : "disabled"\}/);
  // 映像は自動再生しない。
  const video = between(strategy, "function renderStrategyThreadVideo(clip)", "function collectStrategyThreadNodes()");
  assert.match(video, /<video controls controlslist="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata"/);
  assert.doesNotMatch(video, /autoplay/);
  // リアクションの宛先キーは、吹き出しを分けても変えない。
  for (const key of ["caption", "reply", "right", "answer", "break"]) {
    assert.ok(strategy.includes(`hariaiReactable(\`t:\${slot.slot}:${key}\``), key);
  }
  assert.match(strategy, /if \(state\.chatMessages\.length > STRATEGY_THREAD_CHAT_LIMIT\) state\.chatMessages\.shift\(\);/);
  assert.match(strategy, /limitToLast\(60\)/, "the first read stays at the last 60 messages");
  const blocked = strategy.match(/const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "([^"]+)";/)[1];
  for (const control of ["[data-strategy-chat-reaction]", "[data-strategy-chat-stamp]", "[data-strategy-video-open]"]) {
    assert.ok(blocked.includes(control), `${control} is blocked in the preview`);
  }
});

test("the new module, styles and design note ship with fresh cache keys and the note stays private", () => {
  const html = read("index.html");
  assert.match(html, /data-src="strategy\.css\?v=[^"]*-strategy-dm-thread-v1[^"]*"/);
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-dm-thread-v1[^"]*"/);
  // 画像が手の記録より先に着いた時の受信の書き込みを直した版（2026-11-03）。
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-media-ack-v1[^"]*"/);
  // 第2段（ボイス・映像の本数・既読、2026-11-04）。
  assert.match(html, /data-src="strategy\.css\?v=[^"]*-strategy-dm-voice-v1[^"]*"/);
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-dm-voice-v1[^"]*"/);
  // スマホの対戦を全画面のDMにした版（2026-11-04）。
  assert.match(html, /data-src="strategy\.css\?v=[^"]*-strategy-dm-fullscreen-v1[^"]*"/);
  assert.match(html, /"module": "strategy\.js\?v=[^"]*-strategy-dm-fullscreen-v1[^"]*"/);
  const firebase = JSON.parse(read("firebase.json"));
  assert.ok(firebase.hosting.ignore.includes("STRATEGY_DM_THREAD_DESIGN.md"));
  assert.match(read(".assetsignore"), /^STRATEGY_DM_THREAD_DESIGN\.md$/m);
  const css = read("strategy.css");
  assert.match(css, /\.sd-dm\.has-sheet \.vb-dm-gauges \{\n    display: none;\n  \}/);
  // 右の列は中身の高さのまま積む（操作シートがメモに重ならない）。点数の吹き出しはメーターが読める幅。
  assert.match(css, /grid-auto-rows: max-content;/);
  assert.match(css, /\.hariai-thread \.ha-bubble\.hariai-score \{\n  display: grid;\n  min-width: 236px;/);
});

test("on phones the battle is a full-screen DM, and block, leave, safety and sound move into the ••• menu", () => {
  const strategy = read("strategy.js");
  const css = read("strategy.css");
  // サイトの見出しと「〇〇との交流」の欄は、スマホの対戦中だけ出さない（PCは今まで通り）。
  const phone = between(css, "/* ---------- スマホの対戦は全画面のDM ---------- */", "/* 高さはスレッドの8割弱まで");
  assert.match(phone, /@media \(max-width: 900px\) \{\n  body:has\(\.sd-battle\) \.site-header,\n  body:has\(\.sd-battle\) #app > \.player-safety-contact \{\n    display: none;\n  \}/);
  assert.match(phone, /body:has\(\.sd-battle\) main#app \{\n    width: 100%;\n    padding-top: 0;\n    padding-bottom: 0;\n  \}/);
  assert.match(phone, /\.sd-battle \.sd-dm \{\n    max-width: none;\n    height: calc\(100dvh - var\(--vb-dm-top, 0px\)\);/);
  // ヘッダーは2行（口調・呼び方・手札・看破はメモへ）、帯は1行（転送の進み具合だけ残す）、シートは半分弱。
  assert.match(phone, /\.sd-dm \.sd-head \.vb-dm-name small > span:not\(\.vb-dm-presence\) \{\n    display: none;/);
  assert.match(phone, /\.sd-dm \.sd-head \.sd-gauge-suffix,\n  \.sd-dm \.sd-head \.sd-gauge-note \{\n    display: none;/);
  assert.match(phone, /\.sd-dm \.sd-band-line small\.is-keep \{\n    display: block;/);
  assert.match(phone, /\.sd-dm > \.sd-sheet \{\n    max-height: 45%;/);
  assert.match(phone, /@media \(min-width: 901px\) \{\n  \.sd-dm \.sd-menu-safety,\n  \.sd-dm \.sd-menu-phone,\n  \.sd-side \.sd-people \{\n    display: none;/);
  // 相手の1枚は、読み込み前も幅0にならない箱で、スレッドの見えている高さに収める。
  assert.match(css, /\.sd-thread \.ha-msg\.is-theirs \.hariai-media \{\n  width: min\(74vw, 340px\);\n  max-width: 100%;\n\}/);
  assert.match(css, /\.sd-thread \.ha-msg\.is-theirs \.hariai-media img \{\n  max-height: min\(78cqh, 520px\);\n\}/);
  // ••• には「〇〇との交流」の欄（ブロックして退出・退出する）と、安心設定・効果音を置く。
  const menu = between(strategy, "function renderStrategyPhoneMenuItems()", "function toggleStrategySound(");
  assert.match(menu, /<div class="sd-menu-safety">\$\{renderContactControls\("strategy"\)\}<\/div>/);
  assert.match(menu, /data-player-safety-open>安心設定<\/button>/);
  assert.match(menu, /role="switch" aria-checked="\$\{soundOn\}" aria-labelledby="strategySoundLabel" data-sd-sound>/);
  assert.match(between(strategy, "function renderStrategyDmHead()", "function strategySheetKey("), /<div class="vb-menu-panel">\n          \$\{renderStrategyPhoneMenuItems\(\)\}/);
  assert.match(between(strategy, "function toggleStrategySound(", "function renderStrategyPeopleCard()"), /audio\.setEnabled\(!audio\.isEnabled\(\)\);/);
  assert.match(strategy, /on\("\[data-sd-sound\]", "click", \(event\) => toggleStrategySound\(event\.currentTarget\)\);/);
  // 口調・一人称・呼び方とふたりの手札・看破は、メモの一番上の「ふたりのこと」。
  assert.match(between(strategy, "function renderBattle()", "function strategyThreadChats()"), /\$\{renderStrategyPeopleCard\(\)\}\$\{renderHariaiReadingMemo\(\)\}/);
  const people = between(strategy, "function renderStrategyPeopleCard()", "function strategySheetKey(");
  assert.match(people, /あなたを「\$\{escapeHtml\(personaCallName\(opponent, me\)\)\}」と呼ぶ・\$\{strategyHandStatus\(opponent\)\}/);
  assert.match(strategy, /const transfer = \(title\) => band\(`<span>\$\{escapeHtml\(title\)\}<\/span>`, \{ note: `<span id="hariaiTransferProgress">[^\n]*keep: true \}\);/);
});

test("voices take their place in the thread like videos and drop out once released", async () => {
  const { appendStrategyThreadEntries, collectStrategyThreadKeys, orderedStrategyThreadEntries, parseStrategyThreadKey } = await threadModule;
  assert.deepEqual(
    collectStrategyThreadKeys({ chats: [{ id: "c1", phase: "battle" }], videoIds: ["v1"], voiceIds: ["vo_1", "bad id"] }),
    ["start", "chat:c1", "video:v1", "voice:vo_1"],
  );
  assert.deepEqual(parseStrategyThreadKey("voice:vo_0123456789abcdef"), { kind: "voice", id: "vo_0123456789abcdef" });
  const log = appendStrategyThreadEntries([], ["start", "voice:vo_1", "chat:c1", "voice:vo_2"]);
  assert.deepEqual(
    orderedStrategyThreadEntries(log, { chatIds: ["c1"], voiceIds: ["vo_2"] }).map((entry) => entry.key),
    ["start", "chat:c1", "voice:vo_2"],
  );
});

test("features are capped by this client's limits and anything broken counts as an old client", async () => {
  const { LEGACY_STRATEGY_FEATURES, STRATEGY_BATTLE_VIDEO_LIMIT, STRATEGY_BATTLE_VOICE_LIMIT, normalizeStrategyFeatures, strategyFeaturesMessage } = await threadModule;
  assert.deepEqual(strategyFeaturesMessage(), { type: "strategy-features", voice: 5, battleVideos: 3, receipts: true });
  assert.equal(STRATEGY_BATTLE_VIDEO_LIMIT, 3);
  assert.equal(STRATEGY_BATTLE_VOICE_LIMIT, 5);
  assert.deepEqual(normalizeStrategyFeatures(strategyFeaturesMessage()), { voice: 5, battleVideos: 3, receipts: true });
  assert.deepEqual(normalizeStrategyFeatures({ voice: 99, battleVideos: 99, receipts: true }), { voice: 5, battleVideos: 3, receipts: true });
  assert.deepEqual(normalizeStrategyFeatures({ voice: -1, battleVideos: 0, receipts: "yes" }), { voice: 0, battleVideos: 1, receipts: false });
  assert.deepEqual(normalizeStrategyFeatures(null), { ...LEGACY_STRATEGY_FEATURES });
  assert.deepEqual(normalizeStrategyFeatures({ voice: 1.5, battleVideos: "3" }), { voice: 0, battleVideos: 1, receipts: false });
});

test("receipts keep only well-formed keys of the right kind, without duplicates and at most 20", async () => {
  const { normalizeStrategyReceipt, strategyReceiptMessage } = await threadModule;
  assert.deepEqual(
    normalizeStrategyReceipt({ kind: "seen", keys: ["c:abc", "post:3", "post:0", "post:31", "voice:vo_0123456789", "c:abc", 7] }),
    { kind: "seen", keys: ["c:abc", "post:3"] },
  );
  assert.deepEqual(
    normalizeStrategyReceipt({ kind: "played", keys: ["video:sv_0123456789", "voice:vo_0123456789", "voice:short", "c:abc"] }),
    { kind: "played", keys: ["video:sv_0123456789", "voice:vo_0123456789"] },
  );
  assert.equal(normalizeStrategyReceipt({ kind: "read", keys: ["c:abc"] }), null);
  assert.equal(normalizeStrategyReceipt({ kind: "seen", keys: ["post:x"] }), null);
  assert.equal(normalizeStrategyReceipt({ kind: "seen", keys: "c:abc" }), null);
  const many = Array.from({ length: 30 }, (_, index) => `c:m${index}`);
  assert.equal(normalizeStrategyReceipt({ kind: "seen", keys: many }).keys.length, 20);
  assert.deepEqual(strategyReceiptMessage("seen", ["c:a", "c:a", "c:b"]), { type: "strategy-receipt", kind: "seen", keys: ["c:a", "c:b"] });
});

test("voice, more videos and receipts are wired over P2P only and only for the peer's own items", () => {
  const strategy = read("strategy.js");
  assert.match(strategy, /from "\.\/strategy-voice-transfer\.mjs\?v=strategy-dm-voice-v1";/);
  // 主チャネルが開いたら対応機能を知らせる。届くまでは古い画面として扱う。
  const configure = between(strategy, "function configureDataChannel(channel)", "function configureVideoDataChannel(channel)");
  assert.match(configure, /resetStrategyPeerSignals\(\);/);
  assert.match(configure, /sendStrategyPeer\(strategyFeaturesMessage\(\)\);/);
  const dispatch = between(strategy, "async function handleChannelMessage(data) {", "if (state.incomingAvatarTransfer) {");
  assert.match(dispatch, /message\.type === "strategy-features"\) \{\n      handleRemoteStrategyFeatures\(message\);/);
  assert.match(dispatch, /message\.type === "strategy-receipt"\) \{\n      handleRemoteStrategyReceipt\(message\);/);
  for (const type of ["strategy-features", "strategy-receipt", "strategy-voice-start"]) {
    assert.doesNotMatch(strategy, new RegExp(`ref\\(database, [^)]*${type}`), `${type} must not touch Firebase`);
  }
  // 既読・再生済みは、自分が書いた・送ったものの鍵だけ受け付ける。
  const mine = between(strategy, "function strategyReceiptKeyIsMine(key)", "function handleRemoteStrategyReceipt(message)");
  assert.match(mine, /message\.authorUid === state\.uid/);
  assert.match(mine, /slot\.by === state\.uid/);
  assert.match(mine, /clip\.ownerUid === state\.uid/);
  assert.match(between(strategy, "function sendStrategyReceipt(kind, keys)", "function reportStrategySeenChats()"), /if \(!strategyReceiptsOn \|\| !state\.peerFeatures\?\.receipts\) return;/);
  // 映像の本数：送りは相手の対応機能まで、受けは自分の上限まで。
  assert.match(strategy, /return phase === "battle" \? Math\.min\(STRATEGY_BATTLE_VIDEO_LIMIT, state\.peerFeatures\?\.battleVideos \|\| 1\) : 1;/);
  assert.match(strategy, />= \(phase === "battle" \? STRATEGY_BATTLE_VIDEO_LIMIT : 1\)/);
  // ボイスは品評会メディアのチャネルで受け、対戦中だけ・自分の上限まで。自動再生しない。
  const review = between(strategy, "async function handleStrategyReviewAssetChannelMessage(data)", "function strategyVideoReceivedFull(phase)");
  assert.match(review, /message\.type === "strategy-voice-start"/);
  assert.match(review, /currentStrategyVideoPhase\(\) !== "battle"/);
  assert.match(review, /state\.voiceReceivedCount >= STRATEGY_BATTLE_VOICE_LIMIT/);
  assert.match(review, /expectedOwnerUid: state\.opponentUid/);
  const voiceBubble = between(strategy, "function renderStrategyThreadVoice(clip)", "function strategyVoiceSource(id)");
  assert.doesNotMatch(voiceBubble, /<audio|autoplay/);
  // 入力欄のマイク、録音中の帯と注意書き、見本では押せない。
  const composer = between(strategy, "function renderStrategyComposer()", "function refreshStrategyComposer()");
  assert.match(composer, /\$\{renderStrategyMicButton\(\)\}\$\{renderStrategyCameraButton\(\)\}/);
  assert.match(strategy, /声は相手の端末へ一時的に届き、保存されません。/);
  const blocked = strategy.match(/const STRATEGY_PREVIEW_BLOCKED_CONTROLS = "([^"]+)";/)[1];
  assert.ok(blocked.includes("[data-sd-mic]") && blocked.includes("[data-sd-voice-send]"));
  // 対戦を閉じたらボイスも破棄し、合図の状態も戻す。画面を離れたらマイクを止める。
  const release = between(strategy, "function releaseMatchMedia()", "function releaseAllImages()");
  assert.match(release, /releaseStrategyVoiceData\(\);/);
  assert.match(release, /resetStrategyPeerSignals\(state\);/);
  assert.match(between(strategy, "function render() {", "function renderProfile()"), /if \(screenChanged && lastRenderedScreen === "battle"\) \{\n    stopStrategyVoiceRecording\(\{ discard: true \}\);/);
  // メニューの既読のスイッチ（端末に保存）。
  assert.match(strategy, /role="switch" aria-checked="\$\{strategyReceiptsOn\}" aria-labelledby="strategyReceiptsLabel" data-sd-receipts/);
  assert.match(strategy, /const STRATEGY_RECEIPTS_KEY = "hariai-stadium-strategy-receipts-v1";/);
});

test("the signature changes with the content and stays the same for the same html", async () => {
  const { strategyThreadSignature } = await threadModule;
  const html = '<img src="blob:1" alt="">';
  assert.equal(strategyThreadSignature(html), strategyThreadSignature(html));
  assert.notEqual(strategyThreadSignature(html), strategyThreadSignature(`${html} `));
  assert.notEqual(strategyThreadSignature("ab"), strategyThreadSignature("ba"));
  assert.match(strategyThreadSignature(""), /^0\.[0-9a-z]+$/);
});
