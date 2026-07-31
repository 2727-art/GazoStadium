"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(
  path.join(root, relativePath),
  "utf8",
);

const entry = read("training.js");
const app = read("training-v6-app.js");
const machine = read("training-v6-machine.mjs");
const session = read("training-v6-session.mjs");
const p2p = read("training-v6-p2p.mjs");
const workout = read("training-v6-workout.mjs");
const view = read("training-v6-view.mjs");
const css = read("training.css");
const html = read("index.html");

test("the production entry is a tiny V6-only module boundary", () => {
  assert.equal(entry.trim(), 'import "./training-v6-app.js?v=training-v6-companion-1";');
  assert.ok(entry.split(/\r?\n/).filter(Boolean).length <= 2);
  assert.match(html, /training\.js\?v=training-v6-companion-1/);
  assert.match(html, /training\.css\?v=training-v6-companion-1/);
  assert.match(html, /app\.js\?v=[^"]*training-v6-companion-1/);
  assert.doesNotMatch(entry, /session-v5|kitaeai_hp|HP30|OVERKILL/);
});

test("V6 loads one versioned callable and never enters a V5 room path", () => {
  assert.match(app, /httpsCallable\(functions, "trainingV6Action"\)/);
  assert.match(app, /CLIENT_VERSION = "training-v6-mvp-1"/);
  assert.match(app, /TRAINING_V6_PROTOCOL_VERSION/);
  assert.match(app, /TRAINING_V6_VARIANT/);
  assert.doesNotMatch(app, /trainingSessionAction|trainingAction/);
  assert.doesNotMatch(app, /trainingRooms|trainingAttemptsV5|trainingQueueV4/);
  assert.doesNotMatch(app, /kitaeai_hp|HP30|OVERKILL|GIVE UP/);
});

test("only server snapshots advance the canonical phase and revision", () => {
  assert.match(machine, /event\.type === "SERVER_SNAPSHOT"/);
  assert.match(machine, /snapshot\.revision < current\.revision/);
  assert.match(machine, /snapshot-revision-conflict/);
  assert.match(machine, /event\.type === "P2P_EVENT"/);
  assert.match(machine, /p2p-event-ephemeral/);
  assert.match(machine, /frozenState\(state\.snapshot, "recovering", reason\)/);
  assert.doesNotMatch(app, /set\(\s*ref\(\s*database,\s*`online\/trainingV6\/state\/rooms/);
  assert.doesNotMatch(app, /update\(\s*ref\(\s*database,\s*`online\/trainingV6\/state\/rooms/);
});

test("the browser subscribes to one canonical room and recovers listener pauses", () => {
  assert.match(app, /onValue\(\s*ref\(database, `online\/trainingV6\/state\/rooms\/\$\{roomId\}`\)/);
  assert.match(app, /sendSessionRequest\(target, "inspect"/);
  assert.match(app, /recoverRoomSubscription\(target, "room-read-paused"\)/);
  assert.match(app, /permission-denied/);
  assert.match(app, /参加状態を安全に再確認しています/);
  assert.doesNotMatch(app, /開始できませんでした[^]*permission_denied/i);
});

test("transport ownership is session-local and independent from room revision", () => {
  assert.match(app, /connectionId: createToken\(\)/);
  assert.match(app, /"claim_transport", \{[\s\S]*expectedRevision: 0/);
  assert.match(app, /ownConnection !== target\.connectionId/);
  assert.match(session, /expectedRevision/);
  assert.match(session, /actionId = nextActionId\(\)/);
  assert.match(session, /normalizeTrainingV6ServerSnapshot/);
});

test("images, encouragement, and reactions remain ephemeral P2P data", () => {
  assert.match(p2p, /sendImage/);
  assert.match(p2p, /sendCompanionMessage/);
  assert.match(p2p, /v6-image-ack/);
  assert.match(app, /onCompanionMessage/);
  assert.match(app, /while \(target\.messages\.length > 20\)/);
  assert.doesNotMatch(p2p, /firebase|firestore|storage|trainingV6Action/i);
  assert.doesNotMatch(
    app,
    /online\/trainingV6\/state\/(?:rooms|privateScores)[^`]*message|chatFrames/,
  );
});

test("V6 fixes workouts at 60 seconds and preserves the companion roles", () => {
  assert.match(workout, /TRAINING_V6_WORKOUT_SECONDS = 60/);
  assert.match(view, /COMPANION/);
  assert.match(view, /文字でリアクション/);
  assert.match(view, /文字で応援/);
  assert.match(view, /RATE<\/dt><dd>対象外/);
  assert.match(view, /体調変化のため中止（NO CONTEST）/);
  assert.doesNotMatch(workout, /75_000|90_000/);
});

test("lobby presence is privacy-safe and separate from V6 participation rights", () => {
  assert.match(app, /online\/publicPresenceOwners\/\$\{presenceId\}/);
  assert.match(app, /mode: "training"/);
  assert.match(app, /state: target\.publicPresenceState/);
  assert.match(app, /cleanupPublicPresence\(target\)/);
  assert.doesNotMatch(app, /publicPresence[\s\S]{0,200}members|members[\s\S]{0,200}publicPresence/);
});

test("the public lifecycle remains compatible with the shared landing shell", () => {
  assert.match(
    app,
    /window\.HariaiTraining = \{\s*start,\s*isActive,\s*requestHome,\s*destroyRoom,\s*\}/,
  );
  assert.match(app, /HariaiAiTextTraining\?\.isActive\?\.\(\)/);
  assert.match(app, /hariai-training-ready/);
});

test("reload recovery restores private score and uses server-relative signal time", () => {
  assert.match(
    app,
    /const \[stored, inspection\][\s\S]*?captureSessionResponse\(target, inspection\)/,
  );
  assert.match(
    app,
    /createTrainingV6P2PController\(\{[\s\S]*?now: \(\) => firebaseNow\(target\)/,
  );
  assert.match(app, /ref\(database, "\.info\/serverTimeOffset"\)/);
});

test("rerenders preserve in-progress companion input, focus, and scroll", () => {
  assert.match(app, /function captureRenderContinuity\(\)/);
  assert.match(app, /function restoreRenderContinuity\(continuity\)/);
  assert.match(app, /#trainingV6Messages, \[data-training-v6-preserve-scroll\]/);
  assert.match(app, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /focusTarget\.setSelectionRange/);
  assert.match(app, /saved\.atBottom \? element\.scrollHeight : saved\.scrollTop/);
});

test("initialization retry reacquires ownership and reruns authentication", () => {
  assert.match(
    app,
    /async function retryInitialization\(\)[\s\S]*?acquireTabLock\(target\)[\s\S]*?authenticateAndInspect\(target\)/,
  );
  assert.match(
    app,
    /#trainingV6Retry[\s\S]*?retryInitialization\(\)\.catch/,
  );
});

test("the receiver can consent to a 40 BPM ceiling", () => {
  assert.match(app, /\[40, 60, 80, 100, 120, 140, 160\]/);
  assert.match(view, /\[40, 60, 80, 100, 120, 140, 160\]\.map/);
});

test("canonical mutations are fenced by the current connection owner", () => {
  assert.match(app, /payload: actionPayload/);
  assert.match(app, /connectionId: target\.connectionId/);
  assert.match(app, /reason === "owner-replaced"/);
  assert.match(app, /handleOwnerReplacement\(target\)/);
  assert.match(app, /この画面からは進行を変更しません/);
});

test("unknown command outcomes converge by inspect without dropping a safety stop", () => {
  assert.match(app, /requestOutcomeIsUnknown\(error\)/);
  assert.match(app, /await refreshCanonicalRoom\(target\)/);
  assert.match(app, /roomActionIsReflected\(target, action, actionPayload\)/);
  assert.match(app, /const safetyStop = action === "no_contest"/);
  assert.match(app, /safetyStop \? target\.safetyStopBusy : target\.roomActionBusy/);
});

test("the first P2P cheer is acknowledged before instruction becomes canonical", () => {
  assert.match(app, /const delivered = await sendCompanionMessage\(initialCheer\)/);
  assert.match(app, /if \(!delivered\)[\s\S]*?return;/);
  assert.match(app, /initialCheerWorkoutIds\.add\(workout\.workoutId\)/);
  assert.match(view, /最初の応援（P2P・保存なし）/);
});

test("mobile setup keeps all five cards visible and hides inactive custom input", () => {
  assert.match(
    css,
    /@media \(max-width: 760px\)[\s\S]*?\.training-v6-deck-grid\s*\{\s*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /\.training-v6-custom-exercise\[hidden\]\s*\{\s*display: none;/,
  );
});
