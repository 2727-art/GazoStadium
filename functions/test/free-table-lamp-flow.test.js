const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sourceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test("landing no longer offers a free-table lamp or starts a delayed legacy module", () => {
  const source = read("app.js");
  assert.doesNotMatch(source, /freeTableButton|freeTableLampPresentation|updateLandingFreeTableEntrance|pendingFreeTableIntent|hariai-free-table-ready/);
  assert.match(source, /openFreeTable: showRetiredFreeTable/);
  assert.match(source, /貼り合い自由卓は終了しました/);
});

test("normal and strategy results retain play and chat controls without free-table lamps", () => {
  const online = read("online.js");
  const strategy = read("strategy.js");
  for (const source of [online, strategy]) {
    assert.doesNotMatch(source, /FreeTableLamp|free-table-result-lamp|leaveToFreeTable|refreshFreeTablePublicStats/);
    assert.match(source, /async function leaveToLanding\(/);
  }
  assert.match(online, /renderEngawaInvitation\(\)/);
  assert.match(online, /renderOnlineChat\(\)/);
  assert.match(strategy, /renderStrategyChatDock\(\)/);
  assert.match(online, /id="onlineNewMatch"/);
  assert.match(strategy, /id="strategyNewMatch"/);
});

test("remaining strategy result navigation preserves double-click and cleanup protection", () => {
  const source = read("strategy.js");
  assert.match(source, /let resultNavigationBusy = false/);
  assert.match(source, /function beginResultNavigation\([\s\S]*?if \(resultNavigationBusy\) return false/);
  assert.match(source, /async function resetStrategySetup\([\s\S]*?if \(!beginResultNavigation\("strategyNewMatch"\)\) return/);
  assert.match(source, /async function leaveToLanding\([\s\S]*?if \(!beginResultNavigation\(\)\) return/);
});

test("authenticated LIST order selects one room without auto-requesting or sorting by popularity", () => {
  const freeTableSource = read("free-table.js");
  const resolveSource = sourceBetween(
    freeTableSource,
    "function resolveFreeTableEntryIntent()",
    "async function start(",
  );
  const startSource = sourceBetween(
    freeTableSource,
    "async function start(",
    "function isActive()",
  );

  assert.ok(resolveSource.indexOf("state.pendingRequest") < resolveSource.indexOf("state.roomOpen"));
  assert.ok(resolveSource.indexOf("state.roomOpen") < resolveSource.indexOf("state.rooms[0]"));
  assert.match(resolveSource, /const room = state\.rooms\[0\] \|\| null/);
  assert.doesNotMatch(resolveSource, /\.sort\(|REQUEST|submitRoomRequest/);
  assert.match(startSource, /await initializeAuthenticatedFreeTable\(generation\)/);
  assert.ok(startSource.indexOf("await initializeAuthenticatedFreeTable") < startSource.lastIndexOf("resolveFreeTableEntryIntent()"));
  assert.match(freeTableSource, /const data = await callFreeTableAction\(FREE_TABLE_ACTIONS\.LIST\)/);
});

test("a reusable visitor card remains local and requires an explicit send", () => {
  const freeTableSource = read("free-table.js");
  const requestSource = sourceBetween(
    freeTableSource,
    "async function submitRoomRequest(",
    "async function handleRequest(",
  );
  const savedCardSource = sourceBetween(
    freeTableSource,
    "function renderVisitorCardForRoom(",
    "function renderRoomDetail()",
  );

  assert.match(freeTableSource, /const FREE_TABLE_VISITOR_CARD_STORAGE_KEY = "hariaiFreeTableVisitorCardV1"/);
  assert.match(freeTableSource, /stored\.ownerUid !== normalizedUid/);
  assert.match(freeTableSource, /JSON\.stringify\(\{ version: 1, ownerUid: normalizedUid, card: reusable \}\)/);
  assert.match(freeTableSource, /const storedVisitorCard = loadStoredVisitorCard\(user\.uid\)/);
  assert.match(savedCardSource, /この端末に保存した来訪札/);
  assert.match(savedCardSource, /data-action="send-saved-visitor-card"/);
  assert.match(savedCardSource, /送信は自動ではありません/);
  assert.doesNotMatch(savedCardSource, /callFreeTableAction|FREE_TABLE_ACTIONS\.REQUEST/);
  assert.ok(requestSource.indexOf("const publicRoomId = state.selectedRoomId") < requestSource.indexOf("await waitForPendingLeaveSettlement()"));
  assert.match(requestSource, /state\.screen !== sourceScreen/);
  assert.match(requestSource, /state\.selectedRoomId !== publicRoomId/);
  assert.match(requestSource, /state\.rooms = state\.rooms\.filter\(\(room\) => room\.id !== publicRoomId\)/);
  assert.ok(requestSource.indexOf("callFreeTableAction(FREE_TABLE_ACTIONS.REQUEST") < requestSource.indexOf("persistVisitorCard(visitorCard)"));
  assert.match(
    freeTableSource,
    /image: reusable\.media\.image === true && allowedMedia\.image === true/,
  );
});

test("hosts see only newly arrived cards as notifications and retain manual approval", () => {
  const freeTableSource = read("free-table.js");
  const applySource = sourceBetween(
    freeTableSource,
    "function applyMyState(",
    "async function refreshMyState(",
  );
  const actionSource = sourceBetween(
    freeTableSource,
    "async function handleDocumentAction(",
    "document.addEventListener(\"click\"",
  );

  assert.match(applySource, /const newRequests = state\.requestTrackingReady/);
  assert.match(applySource, /!state\.knownRequestIds\.has\(request\.id\)/);
  assert.match(applySource, /nextRequests\.forEach\(\(request\) => state\.knownRequestIds\.add\(request\.id\)\)/);
  assert.match(applySource, /if \(state\.requestTrackingReady && state\.roomOpen && newRequests\.length\)/);
  assert.match(applySource, /state\.requestTrackingReady = true/);
  assert.match(freeTableSource, /const requestSequence = \+\+state\.myStateRequestSequence/);
  assert.match(freeTableSource, /requestSequence < state\.latestAppliedMyStateRequest/);
  assert.match(freeTableSource, /data-action="show-requests"/);
  assert.match(actionSource, /action === "show-requests"/);
  assert.match(actionSource, /action === "respond-request"/);
  assert.match(actionSource, /button\.dataset\.accept === "true"/);
});

test("the archived room implementation remains behind retirement and does not erase saved state", () => {
  const source = read("free-table.js");
  const start = sourceBetween(source, "async function start(", "function isActive()");
  assert.ok(start.indexOf("if (FREE_TABLE_RETIRED)") < start.indexOf("initializeAuthenticatedFreeTable"));
  assert.match(source, /const FREE_TABLE_RETIRED = true/);
  const notice = sourceBetween(source, "function showFreeTableRetired()", "function attachPeerConnection(");
  assert.match(notice, /貼り合い自由卓は終了しました/);
  assert.match(notice, /ホームへ戻る/);
  assert.doesNotMatch(notice, /removeItem|deleteDatabase|clearActiveContact|openBlock|signInAnonymously|callFreeTableAction/);
  assert.match(read("ai-text-training.js"), /createFreeTableAmbienceController/);
});
