"use strict";
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const PROJECT = "demo-free-table-callable-e2e";
const enabled = process.env.RUN_FREE_TABLE_CALLABLE_E2E_TESTS === "1";
const loopback = (value) => {
  assert.match(String(value || ""), /^(localhost|127\.0\.0\.1):\d+$/);
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
};
if (!enabled) {
  test("free-table retired callable E2E requires explicit local emulators", { skip: "RUN_FREE_TABLE_CALLABLE_E2E_TESTS=1" }, () => {});
} else {
  assert.equal(process.env.FREE_TABLE_CALLABLE_E2E_PROJECT_ID, PROJECT);
  const authHost = loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  loopback(process.env.FIRESTORE_EMULATOR_HOST);
  loopback(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
  const functionsHost = loopback(process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001");
  const admin = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore } = require("firebase-admin/firestore");
  const client = require("firebase/app");
  const { getAuth, connectAuthEmulator, signInAnonymously } = require("firebase/auth");
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
  const { initializeAppCheck, CustomProvider } = require("firebase/app-check");
  let adminApp, app, realtime, firestore, functions;
  const appId = "1:1234567890:web:retiredfreetable";
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  before(async () => {
    adminApp = admin.initializeApp({ projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` }, "free-table-retired-admin");
    realtime = getDatabase(adminApp);
    firestore = getFirestore(adminApp);
    await realtime.ref("freeTables").set({ sessions: { historical: { status: "ended", private: "preserved" } } });
    await firestore.doc("freeTableProfiles/preserved").set({ publicMemberId: "unchanged" });
    app = client.initializeApp({ projectId: PROJECT, apiKey: "demo-emulator-key", appId }, "free-table-retired-client");
    initializeAppCheck(app, { isTokenAutoRefreshEnabled: false, provider: new CustomProvider({ getToken: async () => {
      const now = Math.floor(Date.now() / 1000);
      return { token: [encode({ alg: "none", typ: "JWT" }), encode({ aud: [`projects/${PROJECT}`], exp: now + 3600, iat: now, iss: `https://firebaseappcheck.googleapis.com/${PROJECT}`, sub: appId }), "emulator"].join("."), expireTimeMillis: Date.now() + 3600000 };
    } }) });
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, { disableWarnings: true });
    await signInAnonymously(auth);
    functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(functions, functionsHost.host, functionsHost.port);
  });
  after(async () => {
    if (app) await client.deleteApp(app);
    if (adminApp) { await firestore.terminate(); await admin.deleteApp(adminApp); }
  });
  test("callable wrappers retire every action without changing history or creating runtime", async () => {
    for (const name of ["freeTableAction", "freeTableInviteAction", "freeTableInvitePreview", "reportFreeTableP2pConnectivity"]) {
      for (const action of name === "freeTableAction" ? ["open", "list", "get_my_state", "request", "respond", "arrive", "end"] : ["issue"]) {
        await assert.rejects(httpsCallable(functions, name)({ action, retired: false }), (error) => error.code === "functions/failed-precondition" && error.details?.reason === "mode-retired" && error.details?.mode === "free_table");
      }
    }
    const stats = (await httpsCallable(functions, "freeTablePublicStats")({})).data;
    assert.equal(stats.retiredVersion, "free-table-retired-v1");
    assert.equal(stats.retired, true);
    assert.equal(stats.welcomingRooms, 0);
    assert.equal(stats.seatedRooms, 0);
    assert.deepEqual((await realtime.ref("freeTables").get()).val(), { sessions: { historical: { status: "ended", private: "preserved" } } });
    const profiles = await firestore.collection("freeTableProfiles").get();
    assert.equal(profiles.size, 1);
    assert.deepEqual(profiles.docs[0].data(), { publicMemberId: "unchanged" });
    assert.equal((await realtime.ref("online/p2pDiagnostics").get()).exists(), false);
  });
}
