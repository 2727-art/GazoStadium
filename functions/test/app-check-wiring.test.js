const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const firebaseEntrySource = read;

test("all Firebase entry modules use the shared App Check bootstrap", () => {
  for (const relativePath of ["account.js", "online.js", "strategy.js", "ai-text-training.js", "danwaku-note.js", "market.js", "flea-market.js", "free-table.js", "post-match-tip.js"]) {
    const source = firebaseEntrySource(relativePath);
    assert.match(source, /firebase-services\.js\?v=app-check-v3/);
    assert.doesNotMatch(source, /\binitializeApp\s*\(/);
    assert.doesNotMatch(source, /\bgetApp(?:s)?\s*\(/);
    assert.doesNotMatch(source, /\bget(?:Auth|Database|Firestore|Functions)\s*\(/);
  }

  const clientSource = read("firebase-client.js");
  const servicesSource = read("firebase-services.js");
  assert.match(clientSource, /initializeHariaiAppCheck\(firebaseApp\)/);
  assert.match(clientSource, /firebase-app-check\.js\?v=app-check-v3/);
  assert.match(clientSource, /firebase-config\.js\?v=app-check-v3/);
  assert.match(servicesSource, /firebase-client\.js\?v=app-check-v3/);
});

test("Realtime Database browser traffic stays on the Firebase SDK", () => {
  const onlineSource = read("online.js");
  assert.doesNotMatch(onlineSource, /\bfetch\s*\(/);
  assert.doesNotMatch(onlineSource, /\.json(?:`|"|')/);
  assert.match(onlineSource, /readPublicDatabasePath/);
  assert.match(onlineSource, /orderByChild/);
  assert.match(onlineSource, /get\(targetQuery\)/);
});

test("cache busters load one App Check module generation", () => {
  const html = read("index.html");
  for (const moduleName of ["account", "strategy", "online", "ai-text-training", "danwaku-note", "market", "flea-market", "free-table"]) {
    assert.match(html, new RegExp(`${moduleName}\\.js\\?v=[^"]*app-check-v3`));
  }
  for (const assetName of ["styles.css", "app.js", "account.js", "strategy.js", "online.js", "market.js", "flea-market.js", "free-table.js"]) {
    assert.match(html, new RegExp(`${assetName.replace(".", "\\.")}\\?v=[^"]*ai-text-training-v1`));
  }
  const serviceImporters = [
    "account.js",
    "online.js",
    "strategy.js",
    "ai-text-training.js",
    "danwaku-note.js",
    "market.js",
    "flea-market.js",
    "free-table.js",
    "post-match-tip.js",
  ];
  const serviceGenerations = serviceImporters.map((relativePath) => {
    const match = read(relativePath).match(/firebase-services\.js\?v=([^"]+)/);
    assert.ok(match, `${relativePath} must import firebase-services.js with a cache generation`);
    return match[1];
  });
  assert.equal(new Set(serviceGenerations).size, 1);
  assert.match(serviceGenerations[0], /ai-text-training-v1/);

  const browserSources = [
    "firebase-client.js",
    "firebase-services.js",
    "firebase-app-check.js",
    ...serviceImporters,
  ].map(read).join("\n");
  assert.doesNotMatch(browserSources, /app-check-v[12]/);
  for (const relativePath of ["online.js", "strategy.js"]) {
    assert.match(read(relativePath), /post-match-tip\.js\?v=[^"]*app-check-v3/);
  }
});

test("Callable App Check policies follow a valid rollout stage", () => {
  const source = read("functions/index.js");
  const rollout = require("../app-check-rollout");
  const callableNames = [
    "accountTransfer",
    "freeTableAction",
    "freeTableInviteAction",
    "freeTableInvitePreview",
    "freeTablePublicStats",
    "soloFamiliarAction",
    "soloSessionAction",
    "matchAchievementShowcase",
    "danwakuNoteAction",
    "getP2pIceServers",
    "reportP2pConnectivity",
    "reportMarketP2pConnectivity",
    "reportFreeTableP2pConnectivity",
    "redeemAchievementCode",
    "economyAction",
    "anjuPayFleaAction",
    "aiTextTrainingAction",
    "rouletteTrainingAction",
    "aiTextTrainingPublicStats",
    "valueMarketQueue",
    "valueMarketAction",
    "valueMarketShop",
    "valueMarketRankings",
  ];

  assert.ok(rollout.APP_CHECK_ROLLOUT_STAGES.includes(rollout.APP_CHECK_ROLLOUT_STAGE));
  assert.deepEqual(Object.keys(rollout.APP_CHECK_ENFORCEMENT).sort(), callableNames.toSorted());
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.accountTransfer, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.freeTableAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.freeTableInviteAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.freeTableInvitePreview, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.freeTablePublicStats, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.soloFamiliarAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.soloSessionAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.matchAchievementShowcase, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.danwakuNoteAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.getP2pIceServers, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.reportP2pConnectivity, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.reportMarketP2pConnectivity, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.reportFreeTableP2pConnectivity, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.anjuPayFleaAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.redeemAchievementCode, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.aiTextTrainingAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.rouletteTrainingAction, true);
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.aiTextTrainingPublicStats, true);
  assert.equal(
    rollout.APP_CHECK_ENFORCEMENT.valueMarketQueue,
    rollout.APP_CHECK_ENFORCEMENT.valueMarketAction,
  );
  assert.equal(
    rollout.APP_CHECK_ENFORCEMENT.valueMarketQueue,
    rollout.APP_CHECK_ENFORCEMENT.valueMarketShop,
  );
  if (rollout.APP_CHECK_ENFORCEMENT.valueMarketQueue) {
    assert.equal(rollout.MARKET_APP_CHECK_MIGRATION, true);
  }

  for (const functionName of callableNames) {
    assert.match(
      source,
      new RegExp(`onCall\\(\\s*callableOptions\\("${functionName}"(?:,|\\))`),
    );
  }
  assert.equal((source.match(/Boolean\(request\.app\)/g) || []).length, 4);
  assert.match(source, /updatePatronRecommendation\(uid, request\.data, false, Boolean\(request\.app\)\)/);
  assert.match(source, /updatePatronRecommendation\(uid, request\.data, true, Boolean\(request\.app\)\)/);
  assert.match(source, /appCheckVerified:/);
  assert.match(source, /functionName === "accountTransfer"\) options\.consumeAppCheckToken = true/);
  const accountSource = read("account.js");
  assert.match(accountSource, /httpsCallable\(functions, "accountTransfer", \{\s*limitedUseAppCheckTokens: true/);
});

test("local integration mode redirects Authentication as well as data services", () => {
  const firebaseConfig = JSON.parse(read("firebase.json"));
  assert.equal(firebaseConfig.emulators.auth.port, 9099);
  assert.equal(firebaseConfig.emulators.database.port, 9000);
  assert.equal(firebaseConfig.emulators.firestore.port, 8080);
  assert.equal(firebaseConfig.emulators.functions.port, 5001);
  const servicesSource = read("firebase-services.js");
  assert.match(servicesSource, /connectAuthEmulator/);
  assert.match(servicesSource, /connectDatabaseEmulator/);
  assert.match(servicesSource, /connectFirestoreEmulator/);
  assert.match(servicesSource, /connectFunctionsEmulator/);
  const clientSource = read("firebase-client.js");
  const functionsSource = read("functions/index.js");
  assert.match(clientSource, /useFirebaseEmulators/);
  assert.match(clientSource, /projectId: "demo-gazostadium"/);
  assert.match(clientSource, /databaseURL: "https:\/\/demo-gazostadium-default-rtdb\.firebaseio\.com"/);
  assert.match(clientSource, /initializeApp\(clientConfig\)/);
  assert.match(functionsSource, /FIREBASE_DATABASE_EMULATOR_HOST/);
  assert.match(functionsSource, /\^demo-/);
  assert.match(
    functionsSource,
    /`https:\/\/\$\{projectId\}-default-rtdb\.firebaseio\.com`/,
  );
  assert.match(functionsSource, /: PRODUCTION_DATABASE_URL/);
  const appCheckSource = read("firebase-app-check.js");
  assert.match(appCheckSource, /CustomProvider/);
  assert.match(appCheckSource, /projectId\.startsWith\("demo-"\)/);
  assert.match(
    appCheckSource,
    /isLocalhost && searchParams\.has\("firebaseEmulators"\)/,
  );
  assert.match(appCheckSource, /isTokenAutoRefreshEnabled: false/);
  for (const relativePath of ["online.js", "strategy.js", "ai-text-training.js", "danwaku-note.js", "market.js", "flea-market.js", "free-table.js", "post-match-tip.js"]) {
    assert.match(firebaseEntrySource(relativePath), /firebase-services\.js\?v=app-check-v3/);
  }
  assert.match(read("README.md"), /--project demo-gazostadium/);
});

test("offline market preview does not initialize App Check or background Firebase reads", () => {
  const appCheckSource = read("firebase-app-check.js");
  const servicesSource = read("firebase-services.js");
  const onlineSource = read("online.js");
  assert.match(appCheckSource, /searchParams\.has\("marketPreview"\)/);
  assert.match(appCheckSource, /searchParams\.has\("aiTextTrainingPreview"\)/);
  assert.match(servicesSource, /searchParams\.has\("aiTextTrainingPreview"\)/);
  assert.match(onlineSource, /if \(!useOfflineMarketPreview\) watchLobbyStats\(\);/);
  assert.match(onlineSource, /if \(useOfflineMarketPreview\) return null;/);
  for (const relativePath of ["online.js", "strategy.js"]) {
    assert.match(firebaseEntrySource(relativePath), /useOfflineMarketPreview/);
  }
  assert.match(read("market.js"), /const useMarketPreview = useOfflineMarketPreview;/);
});
