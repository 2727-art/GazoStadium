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

test("the landing lamp entrance updates in place and never treats public counts as room authority", () => {
  const appSource = read("app.js");
  const onlineSource = read("online.js");
  const updateSource = sourceBetween(
    appSource,
    "function updateLandingFreeTableEntrance()",
    "function renderLanding()",
  );

  assert.match(appSource, /◌ いま、\$\{welcomingRooms\}卓に灯りがついています/);
  assert.match(appSource, /お迎え中の一席をのぞく/);
  assert.match(appSource, /data-free-table-intent="\$\{freeTableLamp\.lit \? "lamp" : "hall"\}"/);
  assert.match(appSource, /id="freeTableStatusButton"[\s\S]*data-free-table-intent="lamp"/);
  assert.match(updateSource, /eyebrow\.textContent = presentation\.eyebrow/);
  assert.match(updateSource, /label\.textContent = presentation\.label/);
  assert.match(
    updateSource,
    /!presentation\.lit && document\.activeElement === statusButton[\s\S]*?button\?\.focus\(\{ preventScroll: true \}\)[\s\S]*?statusButton\.hidden = !presentation\.lit/,
  );
  assert.doesNotMatch(updateSource, /innerHTML|renderLandingScreen/);
  assert.match(appSource, /function startFreeTable\([^)]*\) \{[\s\S]*?setLandingChrome\(\)/);
  assert.match(appSource, /function cancelPendingFreeTableLaunch\(\)[\s\S]*?pendingFreeTableIntent = ""/);
  assert.match(
    appSource,
    /launchGeneration !== freeTableLaunchGeneration \|\| !pendingFreeTableIntent/,
  );
  assert.match(
    onlineSource,
    /window\.dispatchEvent\(new CustomEvent\("hariai-free-table-public-stats-updated"/,
  );
});

test("normal and strategy results offer a rest only while a public lamp is fresh and lit", () => {
  const html = read("index.html");
  const onlineSource = read("online.js");
  const strategySource = read("strategy.js");
  const cssSource = read("free-table.css");
  const lampSource = sourceBetween(
    onlineSource,
    "function getFreeTableLampState()",
    "function watchLobbyStats()",
  );

  assert.match(lampSource, /expireFreeTablePublicStats\(Date\.now\(\), false\)/);
  assert.match(lampSource, /welcomingRooms > 0/);
  assert.match(lampSource, /if \(!lamp\.available\) return ""/);
  assert.match(onlineSource, /id="onlineFreeTableLampSlot"[\s\S]*data-free-table-lamp-refresh/);
  assert.match(strategySource, /id="strategyFreeTableLampSlot"[\s\S]*data-free-table-lamp-refresh/);
  assert.match(onlineSource, /勝ち負けをここに置いて、ひと休みできます。/);
  assert.match(onlineSource, /class="free-table-result-lamp-count" aria-live="polite"/);
  assert.doesNotMatch(
    sourceBetween(
      onlineSource,
      "function renderFreeTableResultLampContent(",
      "function syncFreeTableResultLampSlot(",
    ),
    /role="status"/,
  );
  assert.match(
    onlineSource,
    /if \(existingButton && countValue\) \{[\s\S]*?countValue\.textContent !== nextCountText[\s\S]*?countValue\.textContent = nextCountText/,
  );
  assert.match(onlineSource, /restoreFocus[\s\S]*?focusFallbackSelector[\s\S]*?focus\(\{ preventScroll: true \}\)/);
  assert.match(cssSource, /\.free-table-result-lamp-slot:empty\s*\{\s*display: none;/);
  assert.match(cssSource, /\.lobby-free-table-lamp-link\[hidden\]\s*\{\s*display: none;/);
  assert.match(
    onlineSource,
    /function expireFreeTablePublicStats[\s\S]*?lastFreeTablePublicStatsEventSignature = "";/,
  );

  for (const asset of [
    "app.js",
    "online.js",
    "strategy.js",
    "free-table.js",
    "free-table.css",
  ]) {
    const escapedAsset = asset.replaceAll(".", "\\.");
    assert.match(html, new RegExp(`${escapedAsset}\\?v=[^"]*free-table-lamp-flow-v1`));
  }
});

test("leaving either battle fully cleans up before opening the free table", () => {
  const onlineSource = read("online.js");
  const strategySource = read("strategy.js");
  const normalTransition = sourceBetween(
    onlineSource,
    "async function leaveToFreeTable()",
    "async function cleanupMatchmaking(",
  );
  const strategyTransition = sourceBetween(
    strategySource,
    "async function leaveToFreeTable()",
    "async function cleanupMatchmaking(",
  );

  assert.match(normalTransition, /await cleanupOnlineResources\(false, expectedState\)/);
  assert.ok(normalTransition.indexOf("await cleanupOnlineResources") < normalTransition.indexOf("openFreeTable({ intent: \"lamp\" })"));
  assert.match(normalTransition, /dispatchP2pRecoveryEvent\("MANUAL_CANCELLED", expectedState\)/);
  assert.match(normalTransition, /releaseAllImages\(\)/);
  assert.match(strategyTransition, /await cleanupOnlineResources\(false\)/);
  assert.ok(strategyTransition.indexOf("await cleanupOnlineResources") < strategyTransition.indexOf("openFreeTable({ intent: \"lamp\" })"));
  assert.match(strategyTransition, /releaseAllImages\(\)/);
  assert.match(strategySource, /let resultNavigationBusy = false/);
  assert.match(strategySource, /function beginResultNavigation\([\s\S]*?if \(resultNavigationBusy\) return false/);
  assert.match(strategyTransition, /if \(!beginResultNavigation\("strategyFreeTableLampButton"\)\) return/);
  assert.match(
    strategySource,
    /async function resetStrategySetup\([\s\S]*?if \(!beginResultNavigation\("strategyNewMatch"\)\) return/,
  );
  assert.match(
    strategySource,
    /async function leaveToLanding\([\s\S]*?if \(!beginResultNavigation\(\)\) return/,
  );
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

test("lamp guidance stays noncompetitive and keeps safe choices explicit", () => {
  const readme = read("README.md");
  const appSource = read("app.js");
  const freeTableSource = read("free-table.js");
  const freeTableCardStart = appSource.indexOf('<article class="lobby-mode-card free-table-status">');
  const freeTableCardEnd = appSource.indexOf('<article class="lobby-mode-card market">', freeTableCardStart);
  assert.ok(freeTableCardStart >= 0 && freeTableCardEnd > freeTableCardStart);
  const featureCopy = [
    sourceBetween(
      appSource,
      "function freeTableLampPresentation(",
      "function renderLanding()",
    ),
    appSource.slice(freeTableCardStart, freeTableCardEnd),
    sourceBetween(
      read("online.js"),
      "function renderFreeTableResultLampContent(",
      "function syncFreeTableResultLampSlot(",
    ),
    sourceBetween(
      freeTableSource,
      "function renderLampNotice()",
      "function renderRoomCard(",
    ),
  ].join("\n");

  assert.doesNotMatch(featureCopy, /RATE|AnjuPay|順位|連勝|残り\d|締切|急い/);
  assert.match(freeTableSource, /部屋主が今回は見送った場合、理由や履歴は残りません/);
  assert.match(freeTableSource, /data-action="safe-exit"/);
  assert.doesNotMatch(
    sourceBetween(
      freeTableSource,
      "function renderLampNotice()",
      "function renderRoomCard(",
    ),
    /aria-live|role="status"/,
  );
  assert.match(freeTableSource, /behavior: "auto"/);
  assert.doesNotMatch(freeTableSource, /behavior: "smooth"/);
  assert.match(
    freeTableSource,
    /const screenChanged = lastRenderedFreeTableScreen !== state\.screen[\s\S]*?if \(screenChanged\) \{[\s\S]*?app\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(readme, /来訪札の送信や入室は自動で始めず/);
  assert.match(readme, /迎える・見送るの判断は従来どおり部屋主の明示操作だけ/);
});
