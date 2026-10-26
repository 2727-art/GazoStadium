const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const online = read("online.js");
const styles = read("styles.css");
const index = read("index.html");
const rules = read("database.rules.json");
const soloSessionV2 = read("functions/solo-session-v2.js");

function extract(pattern, label) {
  const match = online.match(pattern);
  assert.ok(match, `${label} could not be extracted`);
  return match[0];
}

function createFinishSandbox() {
  const source = [
    extract(/const MAX_FINISH_LINE_LENGTH = 30;/, "finish line limit"),
    'const FINISH_LINES = ["これで決着だ！"];',
    'const FINISH_TEMPLATE_LINES = [...FINISH_LINES, "旧口調の決着"];',
    extract(/function sanitizeFinishLineDraft\(value\) \{[\s\S]*?\n\}/, "finish sanitizer"),
    extract(/function normalizeFinishLine\(value, fallback = FINISH_LINES\[0\]\) \{[\s\S]*?\n\}/, "finish normalizer"),
    extract(/function normalizeReceivedFinishLine\(value\) \{[\s\S]*?\n\}/, "received finish normalizer"),
    extract(/function createFinishCutInPayload\(winnerIndex, finishScore = 0\) \{[\s\S]*?\n\}/, "finish payload"),
  ].join("\n");
  const sandbox = {
    state: {
      playerIndex: 0,
      round: 1,
      players: [{ name: "LOCAL" }, { name: "REMOTE" }],
      finishLine: "自分の決めセリフ",
      showOpponentCustomFinish: true,
      remoteImages: new Map(),
    },
    localItem: {
      id: "reserve-card",
      url: "blob:local-finisher",
      position: 7,
    },
    output: null,
  };
  sandbox.getSelectedItem = () => sandbox.localItem;
  sandbox.getRoleplayVoiceSet = (id) => (id === "koakuma" ? { finishLine: "はい、落ちた♡ わたしの勝ち" } : null);
  sandbox.sentCaptionForRound = () => "ここ、見て？♡";
  sandbox.localRoleplayVoiceSetId = () => "oneesan";
  sandbox.normalizeRoleplayVoiceSetId = (id) => (["koakuma", "oneesan"].includes(id) ? id : "");
  sandbox.resolveVisibleCardCaption = (caption, { showCustom }) => (
    showCustom || !caption ? { caption: caption || "", replaced: false } : { caption: "ねぇ、これ好きでしょ？♡", replaced: true }
  );
  vm.runInNewContext(`${source}\nthis.finishPayload = createFinishCutInPayload; this.normalizeReceived = normalizeReceivedFinishLine; this.presets = FINISH_LINES;`, sandbox);
  return sandbox;
}

test("finish lines are single-line, bounded, and can be intentionally silent", () => {
  const sandbox = createFinishSandbox();
  const unsafe = `${"あ".repeat(35)}\n<script>`;
  const normalized = sandbox.normalizeReceived(unsafe);
  assert.equal(normalized.length, 30);
  assert.doesNotMatch(normalized, /[\r\n]/);
  assert.equal(sandbox.normalizeReceived(""), "");
  assert.equal(sandbox.normalizeReceived(null), sandbox.presets[0]);
});

test("finish payload reuses the lethal card and safely replaces hidden opponent custom text", () => {
  const sandbox = createFinishSandbox();
  const local = sandbox.finishPayload(0, 10);
  assert.equal(local.imageUrl, "blob:local-finisher");
  assert.equal("signature" in local, false, "signature cards are retired");
  assert.equal(local.finishLine, "自分の決めセリフ");
  assert.equal(local.finishLineReplaced, false);
  assert.equal(local.winnerCaption, "ここ、見て？♡", "the winner sees the words that landed, not their own image");
  assert.equal(local.winnerVoiceSetId, "oneesan");
  assert.equal(local.finishScore, 10);

  sandbox.state.showOpponentCustomFinish = false;
  sandbox.state.remoteImages.set(1, {
    url: "blob:remote-finisher",
    finishLine: "<img src=x onerror=alert(1)>",
    caption: "LINEで続きしよ",
    voiceSetId: "koakuma",
  });
  const remote = sandbox.finishPayload(1, 9);
  assert.equal(remote.imageUrl, "blob:remote-finisher");
  assert.equal(remote.finishLine, "はい、落ちた♡ わたしの勝ち");
  assert.equal(remote.finishLineReplaced, true);
  assert.equal(remote.winnerCaption, "ねぇ、これ好きでしょ？♡", "hidden free-text captions fall back to the sender's persona");
  assert.equal(remote.finishScore, 9);

  sandbox.state.remoteImages.set(1, { url: "blob:remote-finisher", finishLine: "<img src=x onerror=alert(1)>" });
  assert.equal(sandbox.finishPayload(1).finishLine, sandbox.presets[0]);

  sandbox.state.remoteImages.set(1, { url: "blob:remote-finisher", finishLine: "LINEで続きしよ", voiceSetId: "koakuma" });
  assert.equal(sandbox.finishPayload(1).finishLine, "はい、落ちた♡ わたしの勝ち", "hidden custom text falls back to the sender's persona");
  sandbox.state.remoteImages.set(1, { url: "blob:remote-finisher", finishLine: "旧口調の決着" });
  assert.equal(sandbox.finishPayload(1).finishLineReplaced, false, "retired template lines from older clients are not treated as free text");
});

test("signature cards are retired: setup offers no choice and the cut-in has no signature variant", () => {
  assert.doesNotMatch(online, /signatureCardId|toggleSignatureCard|data-online-signature-card|signature-card-guide/);
  assert.doesNotMatch(online, /SIGNATURE FINISH|payload\.signature/);
  assert.match(online, /state\.deck = deck;/);
  assert.match(online, /window\.HariaiAudio\?\.playFinish\?\.\(false\);/);
});

test("finish metadata stays P2P-only and older clients always read signature false", () => {
  assert.match(online, /const finishLine = state\.finishLine;/);
  assert.match(online, /type: "image-start"[\s\S]*?signature: false,[\s\S]*?finishLine,/);
  assert.doesNotMatch(online, /signature: (message|transfer)\.signature === true,/, "incoming signature flags are no longer read");
  assert.match(online, /finishLine: normalizeReceivedFinishLine\(transfer\.finishLine\),/);

  const queueWrite = extract(/await set\(queueEntryRef, \{[\s\S]*?\n  \}\);/, "normal queue write");
  const roomResourceStart = soloSessionV2.indexOf("function buildSoloSessionV2Resources");
  const roomResourceEnd = soloSessionV2.indexOf(
    "function roomMatchesSessionV2",
    roomResourceStart,
  );
  assert.ok(roomResourceStart >= 0 && roomResourceEnd > roomResourceStart);
  const roomResources = soloSessionV2.slice(roomResourceStart, roomResourceEnd);
  assert.doesNotMatch(queueWrite, /finishLine|signatureCardId/);
  assert.match(roomResources, /const room = \{/);
  assert.match(roomResources, /sessions,/);
  assert.doesNotMatch(roomResources, /finishLine|signatureCardId/);
  assert.doesNotMatch(rules, /"finishLine"/);
});

test("incoming lethal image metadata and bytes are validated on the transfer path", () => {
  assert.match(online, /createIncomingOnlineImageTransfer\(message/);
  assert.match(online, /maxBytes: MAX_IMAGE_TRANSFER_BYTES/);
  assert.match(online, /completeIncomingOnlineImageTransfer\(transfer\)/);
  assert.match(online, /appendIncomingOnlineImageChunk\(state\.incomingTransfer, chunk\)/);
});

test("cut-in fires once only for a positive HP to zero transition", () => {
  assert.match(online, /if \(state\.processedRounds\.has\(state\.round\)\) return;/);
  assert.match(online, /const previousHp = loserIndex === null \? null : state\.players\[loserIndex\]\.hp;/);
  assert.match(online, /const lethal = loserIndex !== null && previousHp > 0 && state\.players\[loserIndex\]\.hp === 0;/);
  assert.match(online, /if \(lethal\) \{\s*triggerFinishCutIn\(finish\);\s*if \(pendingFinishReply\) \{[\s\S]*?pendingFinishReply\.message \|\| pendingFinishReply,[\s\S]*?pendingFinishReply\.channel \|\| state\.channel,[\s\S]*?\}\s*\}/);
  // 点数の吹き出しと理性の減りは、決着しないラウンドの結果演出でスレッドに届ける。
  const resultFx = online.slice(online.indexOf('if (state.screen === "result") {'), online.indexOf('if (state.screen === "gameover") {'));
  assert.match(resultFx, /if \(!result \|\| result\.lethal\) return;/);
  assert.match(resultFx, /topScore >= 8 \? audio\(\)\?\.playResult\?\.\(topScore\)/);
  assert.match(online, /function renderOnlinePursuitLines\(result\) \{\s*if \(result\.lethal\) return "";/);
});

test("cut-in dialog is skippable, text-safe, responsive, and reduced-motion aware", () => {
  assert.match(index, /<dialog id="finishCutInDialog" class="finish-cutin-dialog"/);
  const cutIn = extract(/function triggerFinishCutIn\(payload\) \{[\s\S]*?\n\}/, "finish cut-in");
  assert.match(cutIn, /winnerName\.textContent = localIsWinner \? `\$\{payload\.loserName\}を、落とした。` : `\$\{payload\.winnerName\}に、落とされた。`;/);
  // 勝った側には自分の画像を出さず、負けた側にだけ相手のとどめの1枚を見せる。
  assert.match(cutIn, /const showImage = Boolean\(payload\.imageUrl\) && !localIsWinner;/);
  assert.match(cutIn, /blowText\.textContent = payload\.winnerCaption/);
  assert.match(cutIn, /caption\.textContent = payload\.winnerCaption;/);
  assert.doesNotMatch(cutIn, /innerHTML/);
  assert.match(online, /quote\.textContent = payload\.finishLine;/);
  assert.match(online, /if \(payload\.finishLineReplaced\)[\s\S]*?自由記述は表示設定により、定型文へ置き換えています/);
  assert.match(online, /skip\.addEventListener\("click", \(\) => dismissFinishCutIn\(payload\)/);
  assert.match(online, /finishCutInDialog\?\.addEventListener\("cancel"/);
  assert.match(
    online,
    /async function cleanupOnlineResources\(\s*keepActive,\s*targetState = state,[\s\S]*?\) \{[\s\S]*?if \(state === targetState\) clearFinishCutIn\(\{ restoreFocus: false \}\);/,
  );
  assert.match(styles, /\.finish-cutin-image \{[\s\S]*?object-fit: contain;/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.finish-cutin-stage/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.finish-cutin \{\s*height: 100%;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.finish-cutin/);
});

test("signature finish is exclusive to normal 1on1", () => {
  for (const file of ["strategy.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /signatureCardId|CUSTOM_FINISH_VALUE|finishReply|finish-cutin-dialog/i, `${file} must not receive normal 1on1 finish state`);
  }
});

test("cache tokens load finish JS and CSS together", () => {
  assert.match(index, /styles\.css\?v=[^"]*signature-finish-v1[^"]*finish-reply-v2/);
  assert.match(index, /online\.js\?v=[^"]*signature-finish-v1[^"]*finish-reply-v3/);
});
