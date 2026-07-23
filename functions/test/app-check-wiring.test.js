const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("all Firebase entry modules use the shared App Check bootstrap", () => {
  for (const relativePath of ["account.js", "online.js", "strategy.js", "team.js", "royale.js", "market.js", "post-match-tip.js"]) {
    const source = read(relativePath);
    assert.match(source, /firebase-services\.js\?v=app-check-v2/);
    assert.doesNotMatch(source, /\binitializeApp\s*\(/);
    assert.doesNotMatch(source, /\bgetApp(?:s)?\s*\(/);
    assert.doesNotMatch(source, /\bget(?:Auth|Database|Firestore|Functions)\s*\(/);
  }

  const clientSource = read("firebase-client.js");
  const servicesSource = read("firebase-services.js");
  assert.match(clientSource, /initializeHariaiAppCheck\(firebaseApp\)/);
  assert.match(clientSource, /firebase-app-check\.js\?v=app-check-v2/);
  assert.match(clientSource, /firebase-config\.js\?v=app-check-v2/);
  assert.match(servicesSource, /firebase-client\.js\?v=app-check-v2/);
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
  for (const moduleName of ["account", "strategy", "online", "market", "team", "royale"]) {
    assert.match(html, new RegExp(`${moduleName}\\.js\\?v=[^"]*app-check-v2`));
  }

  const browserSources = [
    "firebase-client.js",
    "firebase-services.js",
    "firebase-app-check.js",
    "account.js",
    "online.js",
    "strategy.js",
    "team.js",
    "royale.js",
    "market.js",
    "post-match-tip.js",
  ].map(read).join("\n");
  assert.doesNotMatch(browserSources, /app-check-v1/);
});

test("Callable App Check policies follow a valid rollout stage", () => {
  const source = read("functions/index.js");
  const rollout = require("../app-check-rollout");
  const callableNames = [
    "accountTransfer",
    "economyAction",
    "valueMarketQueue",
    "valueMarketAction",
    "valueMarketShop",
    "valueMarketRankings",
  ];

  assert.ok(rollout.APP_CHECK_ROLLOUT_STAGES.includes(rollout.APP_CHECK_ROLLOUT_STAGE));
  assert.deepEqual(Object.keys(rollout.APP_CHECK_ENFORCEMENT).sort(), callableNames.toSorted());
  assert.equal(rollout.APP_CHECK_ENFORCEMENT.accountTransfer, true);
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
    assert.match(source, new RegExp(`onCall\\(callableOptions\\("${functionName}"\\)`));
  }
  assert.equal((source.match(/Boolean\(request\.app\)/g) || []).length, 2);
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
  for (const relativePath of ["online.js", "strategy.js", "team.js", "royale.js", "market.js", "post-match-tip.js"]) {
    assert.match(read(relativePath), /firebase-services\.js\?v=app-check-v2/);
  }
  assert.match(read("README.md"), /--project demo-gazostadium/);
});

test("offline market preview does not initialize App Check or background Firebase reads", () => {
  const appCheckSource = read("firebase-app-check.js");
  const onlineSource = read("online.js");
  assert.match(appCheckSource, /searchParams\.has\("marketPreview"\)/);
  assert.match(onlineSource, /if \(!useOfflineMarketPreview\) watchLobbyStats\(\);/);
  assert.match(onlineSource, /if \(useOfflineMarketPreview\) return null;/);
  for (const relativePath of ["online.js", "strategy.js", "team.js", "royale.js"]) {
    assert.match(read(relativePath), /useOfflineMarketPreview/);
  }
  assert.match(read("market.js"), /const useMarketPreview = useOfflineMarketPreview;/);
});
