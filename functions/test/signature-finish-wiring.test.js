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
    extract(/function sanitizeFinishLineDraft\(value\) \{[\s\S]*?\n\}/, "finish sanitizer"),
    extract(/function normalizeFinishLine\(value, fallback = FINISH_LINES\[0\]\) \{[\s\S]*?\n\}/, "finish normalizer"),
    extract(/function normalizeReceivedFinishLine\(value\) \{[\s\S]*?\n\}/, "received finish normalizer"),
    extract(/function createFinishCutInPayload\(winnerIndex\) \{[\s\S]*?\n\}/, "finish payload"),
  ].join("\n");
  const sandbox = {
    state: {
      playerIndex: 0,
      round: 1,
      players: [{ name: "LOCAL" }, { name: "REMOTE" }],
      signatureCardId: "reserve-signature",
      finishLine: "自分の決めセリフ",
      showOpponentCustomFinish: true,
      remoteImages: new Map(),
    },
    localItem: {
      id: "reserve-signature",
      url: "blob:local-finisher",
      position: 7,
    },
    output: null,
  };
  sandbox.getSelectedItem = () => sandbox.localItem;
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
  const local = sandbox.finishPayload(0);
  assert.equal(local.imageUrl, "blob:local-finisher");
  assert.equal(local.signature, true);
  assert.equal(local.finishLine, "自分の決めセリフ");
  assert.equal(local.finishLineReplaced, false);

  sandbox.state.showOpponentCustomFinish = false;
  sandbox.state.remoteImages.set(1, {
    url: "blob:remote-finisher",
    signature: true,
    finishLine: "<img src=x onerror=alert(1)>",
  });
  const remote = sandbox.finishPayload(1);
  assert.equal(remote.imageUrl, "blob:remote-finisher");
  assert.equal(remote.signature, true);
  assert.equal(remote.finishLine, sandbox.presets[0]);
  assert.equal(remote.finishLineReplaced, true);
});

test("signature choice is optional, unique, cleared on removal, and retained for a rematch", () => {
  assert.match(online, /signatureCardId: ""/);
  assert.match(online, /state\.signatureCardId = state\.signatureCardId === id \? "" : id;/);
  assert.match(online, /function toggleSignatureCard\(id\) \{[\s\S]*?button\.replaceChildren\(/);
  assert.match(online, /if \(!state\.deck\.some\(\(item\) => item\.id === id\)\) return;/);
  assert.doesNotMatch(extract(/function toggleSignatureCard\(id\) \{[\s\S]*?\n\}/, "signature toggle"), /\brender\(\)/);
  assert.match(online, /if \(state\.signatureCardId === id\) state\.signatureCardId = "";/);
  assert.match(online, /signatureCardId: expectedState\.signatureCardId,/);
  assert.match(online, /state\.deck = deck;/);
  assert.match(online, /data-online-signature-card=/);
  assert.match(online, /aria-pressed="\$\{isSignature\}"/);
});

test("finish metadata stays P2P-only and accepts only a strict signature boolean", () => {
  assert.match(online, /const signature = item\.id === state\.signatureCardId;/);
  assert.match(online, /const finishLine = state\.finishLine;/);
  assert.match(online, /type: "image-start"[\s\S]*?signature,[\s\S]*?finishLine,/);
  assert.match(online, /signature: message\.signature === true,/);
  assert.match(online, /signature: transfer\.signature === true,/);
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
  assert.match(online, /if \(lethal\) \{\s*triggerFinishCutIn\(finish\);\s*if \(pendingFinishReply\) \{[\s\S]*?pendingFinishReply\.message \|\| pendingFinishReply,[\s\S]*?pendingFinishReply\.channel \|\| state\.channel,[\s\S]*?\}\s*\} else if \(topScore >= 8\)/);
  assert.match(online, /function renderOnlinePursuitLines\(result\) \{\s*if \(result\.lethal\) return "";/);
});

test("cut-in dialog is skippable, text-safe, responsive, and reduced-motion aware", () => {
  assert.match(index, /<dialog id="finishCutInDialog" class="finish-cutin-dialog"/);
  assert.match(online, /winnerName\.textContent = payload\.winnerName;/);
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
  for (const file of ["strategy.js", "training.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /signatureCardId|CUSTOM_FINISH_VALUE|finishReply|finish-cutin-dialog/i, `${file} must not receive normal 1on1 finish state`);
  }
});

test("cache tokens load finish JS and CSS together", () => {
  assert.match(index, /styles\.css\?v=[^"]*signature-finish-v1[^"]*finish-reply-v2/);
  assert.match(index, /online\.js\?v=[^"]*signature-finish-v1[^"]*finish-reply-v3/);
});
