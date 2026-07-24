const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const onlineSource = read("online.js");
const styles = read("styles.css");
const indexHtml = read("index.html");
const readme = read("README.md");
const otherModeSources = ["strategy.js", "team.js", "royale.js"].map(read);
const engawaProtocolSource = onlineSource.match(
  /function sendEngawaMessage\(message, channel = state\.channel\) \{[\s\S]*?\nfunction hasSelectionStarted\(\) \{/,
)?.[0] || "";
const channelMessageSource = onlineSource.match(
  /async function handleChannelMessage\(data\) \{[\s\S]*?\nfunction queueOutgoingDataTransfer\(/,
)?.[0] || "";
const sendEngawaImageSource = onlineSource.match(
  /async function sendEngawaImage\(\) \{[\s\S]*?\nfunction updateEngawaTransferText\(/,
)?.[0] || "";

test("engawa is a normal 1on1-only post-match screen", () => {
  assert.match(onlineSource, /gameover: renderGameOver,[\s\S]*?engawa: renderEngawa,/);
  assert.match(onlineSource, /function renderGameOver\(\)[\s\S]*?\$\{renderEngawaInvitation\(\)\}/);
  assert.match(onlineSource, /function renderEngawa\(\)/);
  assert.match(onlineSource, /if \(state\.screen === "engawa"\) bindEngawaEvents\(\);/);
  assert.doesNotMatch(onlineSource.match(/function renderEngawa\(\) \{[\s\S]*?\n\}/)?.[0] || "", /renderOnlineChat/);
  for (const source of otherModeSources) assert.doesNotMatch(source, /\bengawa\b/i);
});

test("engawa uses blind mutual consent over the existing P2P channel", () => {
  assert.match(onlineSource, /engawaLocalDecision === "accept"[\s\S]*?engawaRemoteDecision === "accept"/);
  assert.match(onlineSource, /sendEngawaMessage\(\{ type: "engawa-decision", decision \}\)/);
  assert.match(onlineSource, /if \(state\.screen !== "gameover" \|\| state\.engawaLocalDecision \|\| state\.engawaClosed\) return;/);
  assert.match(onlineSource, /参加するかどうかは相手に伏せたまま選び/);
  assert.match(onlineSource, /両方が望んだ時だけ開きます/);
  assert.match(onlineSource, /function maybeEnterEngawa\(\)[\s\S]*?isPostMatchTipBusy\("solo", state\.roomId, state\.uid\)[\s\S]*?scheduleEngawaAfterPostMatchTip\(\)/);
  assert.doesNotMatch(onlineSource, /online\/rooms\/\$\{state\.roomId\}\/engawa/);
  assert.doesNotMatch(read("database.rules.json"), /"engawa/);
});

test("the one-image exchange is byte-verified, bounded, serialized, and never server-stored", () => {
  for (const type of ["engawa-image-start", "engawa-image-end", "engawa-image-cancel"]) {
    assert.ok(onlineSource.includes(`type: "${type}"`), `missing P2P type ${type}`);
  }
  assert.match(onlineSource, /engawa-image-transfer\.mjs\?v=engawa-image-transfer-v1/);
  assert.match(engawaProtocolSource, /state\.incomingEngawaTransfer \|\| state\.engawaRemoteImage/);
  assert.match(engawaProtocolSource, /createIncomingEngawaImageTransfer\(message, \{ maxBytes: MAX_IMAGE_TRANSFER_BYTES \}\)/);
  assert.match(engawaProtocolSource, /completeIncomingEngawaImageTransfer\(transfer\)/);
  assert.match(channelMessageSource, /appendIncomingEngawaImageChunk\(state\.incomingEngawaTransfer, chunk\)/);
  assert.match(engawaProtocolSource, /engawaImageEndStatus\(transfer\) === "orphan"/);
  assert.match(sendEngawaImageSource, /verifiedOnlineImageMime\(buffer\)/);
  assert.doesNotMatch(engawaProtocolSource, /message\.mime !== "image\/webp"/);
  assert.doesNotMatch(engawaProtocolSource, /function isWebpArrayBuffer\(buffer\)/);
  assert.match(sendEngawaImageSource, /const expectedState = state;[\s\S]*?const channel = expectedState\.channel;/);
  assert.match(sendEngawaImageSource, /await queueOutgoingDataTransfer\(expectedState, async \(\) =>/);
  assert.match(sendEngawaImageSource, /await waitForEngawaDataBuffer\(channel\)/);
  assert.match(sendEngawaImageSource, /channel\.send\(buffer\.slice/);
  assert.match(sendEngawaImageSource, /sendEngawaMessage\(\{ type: "engawa-image-cancel" \}, channel\)/);
  assert.match(engawaProtocolSource, /ENGAWA_BUFFER_WAIT_MS/);
  assert.match(sendEngawaImageSource, /function waitForEngawaDataBuffer\(channel\)/);
  assert.match(sendEngawaImageSource, /transferGeneration === expectedState\.engawaTransferGeneration/);
  assert.doesNotMatch(engawaProtocolSource, /\b(?:set|update|push|runTransaction)\(ref\(database/);
});

test("incoming image namespaces are exclusive and cancellation stays namespace-local", () => {
  assert.match(channelMessageSource, /assertIncomingTransferNamespaceExclusive\(state, "profile"\)/);
  assert.match(channelMessageSource, /assertIncomingTransferNamespaceExclusive\(state, "battle"\)/);
  assert.match(engawaProtocolSource, /assertIncomingTransferNamespaceExclusive\(state, "engawa"\)/);

  const engawaCancelSource = channelMessageSource.match(
    /message\.type === "engawa-image-cancel"\) \{[\s\S]*?\} else if \(message\.type === "engawa-response"/,
  )?.[0] || "";
  assert.match(engawaCancelSource, /state\.incomingEngawaTransfer = null/);
  assert.doesNotMatch(engawaCancelSource, /state\.incomingTransfer|state\.incomingAvatarTransfer/);

  const battleCancelSource = channelMessageSource.match(
    /message\.type === "image-cancel"\) \{[\s\S]*?\} else if \(message\.type === "image-end"/,
  )?.[0] || "";
  assert.match(battleCancelSource, /state\.incomingTransfer = null/);
  assert.doesNotMatch(battleCancelSource, /state\.incomingEngawaTransfer|state\.incomingAvatarTransfer/);

  const profileEmptySource = channelMessageSource.match(
    /message\.type === "profile-avatar-empty"\) \{[\s\S]*?\} else if \(message\.type === "image-start"/,
  )?.[0] || "";
  assert.match(profileEmptySource, /releaseRemoteAvatar\(\)/);
  assert.doesNotMatch(profileEmptySource, /state\.incomingEngawaTransfer|state\.incomingTransfer/);
});

test("moods and responses are fixed local enums with one response per player", () => {
  for (const id of ["just_look", "smile", "recent_favorite", "calm"]) {
    assert.match(onlineSource, new RegExp(`id: "${id}"`));
  }
  for (const id of ["thanks", "like", "again"]) {
    assert.match(onlineSource, new RegExp(`id: "${id}"`));
  }
  assert.match(onlineSource, /sendEngawaMessage\(\{ type: "engawa-response", responseId: response\.id \}\)/);
  assert.match(onlineSource, /state\.engawaLocalResponse \|\| !state\.engawaRemoteImage/);
  assert.match(onlineSource, /if \(state\.engawaRemoteResponse\) \{/);
  assert.match(onlineSource, /function syncEngawaResponseControls\(\)[\s\S]*?data-engawa-local-response-slot[\s\S]*?data-engawa-remote-response-slot/);
  assert.doesNotMatch(engawaProtocolSource, /sendChat\(/);
});

test("engawa has no reward hooks and releases transient media on every exit path", () => {
  assert.doesNotMatch(engawaProtocolSource, /economyActionCallable|commitOnlineStats|claimDaily|recordOverallResult|HariaiAchievements/);
  assert.match(onlineSource, /function releaseEngawaRemoteImage\(\)[\s\S]*?URL\.revokeObjectURL/);
  assert.match(onlineSource, /function releaseEngawaMedia\(\)[\s\S]*?engawaTransferGeneration \+= 1;[\s\S]*?releaseEngawaRemoteImage\(\)/);
  assert.match(onlineSource, /function releaseMatchMedia\(\)[\s\S]*?releaseEngawaMedia\(\)/);
  assert.match(onlineSource, /function cleanupOnlineResources\(keepActive\)[\s\S]*?notifyEngawaDeparture\(\);\s*releaseEngawaMedia\(\);/);
  assert.match(onlineSource, /state\.screen === "engawa"[\s\S]*?closeEngawaLocally\("相手の接続が切れたため/);
  assert.match(onlineSource, /channel\.onclose[\s\S]*?state\.screen === "engawa"[\s\S]*?closeEngawaLocally/);
  assert.match(onlineSource, /\["setup", "missions", "shop", "achievements", "matching", "gameover", "engawa", "noContest", "error"\]/);
});

test("engawa UI and cache keys ship together with the documented boundaries", () => {
  for (const selector of [".engawa-invite", ".engawa-screen", ".engawa-pick-grid", ".engawa-gallery", ".engawa-response-panel"]) {
    assert.ok(styles.includes(selector), `missing style ${selector}`);
  }
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.engawa-shell/);
  assert.match(indexHtml, /styles\.css\?v=[^"]*engawa-v1/);
  assert.match(indexHtml, /online\.js\?v=[^"]*engawa-v1/);
  assert.match(indexHtml, /styles\.css\?v=[^"]*solo-familiar-v1/);
  assert.match(indexHtml, /online\.js\?v=[^"]*solo-familiar-v1/);
  assert.match(readme, /「縁側で一息」/);
  assert.match(readme, /採点・HP・戦績・AnjuPay・ミッション・実績に影響しない/);
  assert.match(readme, /同意・画像・気分・反応はFirebaseへ保存しません/);
});
