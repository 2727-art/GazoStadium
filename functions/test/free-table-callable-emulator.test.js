"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");
const {
  FREE_TABLE_PUBLIC_STATS_CACHE_TTL_MS,
} = require("../free-table");

const RUN_FLAG = "RUN_FREE_TABLE_CALLABLE_E2E_TESTS";
const PROJECT_ID_ENV = "FREE_TABLE_CALLABLE_E2E_PROJECT_ID";
const DEDICATED_PROJECT_ID = "demo-free-table-callable-e2e";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const PROJECT_ID = String(process.env[PROJECT_ID_ENV] || "");

function requireLoopbackTarget(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(value)) {
    throw new Error(`${label} must be an explicit loopback host and port.`);
  }
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
}

if (!RUN_REQUESTED) {
  test("free table Callable E2E is opt-in and never uses production", {
    skip: `set ${RUN_FLAG}=1 and ${PROJECT_ID_ENV}=${DEDICATED_PROJECT_ID} inside Firebase emulators`,
  }, () => {});
} else {
  if (PROJECT_ID !== DEDICATED_PROJECT_ID) {
    throw new Error(`${PROJECT_ID_ENV} must be ${DEDICATED_PROJECT_ID}.`);
  }
  const target = {
    auth: requireLoopbackTarget(
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
      "FIREBASE_AUTH_EMULATOR_HOST",
    ),
    functions: requireLoopbackTarget(
      process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001",
      "FUNCTIONS_EMULATOR_HOST",
    ),
  };
  requireLoopbackTarget(
    process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    "FIREBASE_DATABASE_EMULATOR_HOST",
  );
  requireLoopbackTarget(
    process.env.FIRESTORE_EMULATOR_HOST,
    "FIRESTORE_EMULATOR_HOST",
  );

  const {
    deleteApp: deleteAdminApp,
    initializeApp: initializeAdminApp,
  } = require("firebase-admin/app");
  const { getAuth: getAdminAuth } = require("firebase-admin/auth");
  const { getDatabase } = require("firebase-admin/database");
  const { getFirestore } = require("firebase-admin/firestore");
  const {
    deleteApp: deleteClientApp,
    initializeApp: initializeClientApp,
  } = require("firebase/app");
  const {
    CustomProvider,
    initializeAppCheck,
  } = require("firebase/app-check");
  const {
    connectAuthEmulator,
    getAuth,
    signInAnonymously,
  } = require("firebase/auth");
  const {
    connectFunctionsEmulator,
    getFunctions,
    httpsCallable,
  } = require("firebase/functions");

  const suiteId = crypto.randomUUID().replaceAll("-", "");
  const clientApps = [];
  const createdUids = new Set();
  const privateUids = new Set();
  let adminApp;
  let adminAuth;
  let firestore;
  let realtime;

  const space = Object.freeze({
    name: "夜更かし食堂",
    description: "勝ち負けを置いて、温かい一品を貼る部屋です。",
    topic: "深夜の飯テロ",
    introduction: "いま食べたいものを、言葉や一枚でゆっくり貼ります。",
    journeyCue: "おなかと心が少し満ちたら",
    roleplayLevel: "light",
    duration: "15m",
    media: {
      text: true,
      image: true,
      audio: true,
      video: false,
    },
    avoid: "個人情報",
    welcome: "おかえり。温かい席へどうぞ。",
    themeId: "midnight-diner",
  });
  const card = (name) => ({
    name,
    activityTag: "のんびりお迎え",
    message: "湯気の立つ話を用意しています。",
    roleplayLevel: "light",
    media: {
      text: true,
      image: true,
      audio: false,
      video: false,
    },
  });

  function unsignedEmulatorAppCheckToken(appId) {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const encode = (value) => Buffer
      .from(JSON.stringify(value), "utf8")
      .toString("base64url");
    return [
      encode({ alg: "none", typ: "JWT" }),
      encode({
        aud: [`projects/${DEDICATED_PROJECT_ID}`],
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        iss: `https://firebaseappcheck.googleapis.com/${DEDICATED_PROJECT_ID}`,
        sub: appId,
      }),
      "emulator",
    ].join(".");
  }

  function assertNoPrivateUid(value, seen = new Set()) {
    if (typeof value === "string") {
      for (const uid of privateUids) {
        assert.equal(value.includes(uid), false, "Callable response exposed a UID.");
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(
        ["uid", "hostUid", "visitorUid"].includes(key),
        false,
        `Callable response exposed private field: ${key}`,
      );
      assertNoPrivateUid(nested, seen);
    }
  }

  async function createCaller(label, {
    appCheck = true,
    authenticate = true,
  } = {}) {
    const appId = `1:1234567890:web:${crypto
      .createHash("sha256")
      .update(`${suiteId}:${label}`)
      .digest("hex")
      .slice(0, 32)}`;
    const app = initializeClientApp({
      apiKey: "demo-free-table-callable-emulator-key",
      appId,
      authDomain: `${DEDICATED_PROJECT_ID}.firebaseapp.com`,
      projectId: DEDICATED_PROJECT_ID,
      databaseURL: `https://${DEDICATED_PROJECT_ID}-default-rtdb.firebaseio.com`,
    }, `free-table-callable-client-${suiteId}-${label}`);
    clientApps.push(app);
    if (appCheck) {
      initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: async () => ({
            token: unsignedEmulatorAppCheckToken(appId),
            expireTimeMillis: Date.now() + 3_600_000,
          }),
        }),
        isTokenAutoRefreshEnabled: false,
      });
    }
    const auth = getAuth(app);
    connectAuthEmulator(
      auth,
      `http://${target.auth.host}:${target.auth.port}`,
      { disableWarnings: true },
    );
    let uid = "";
    if (authenticate) {
      uid = (await signInAnonymously(auth)).user.uid;
      createdUids.add(uid);
      privateUids.add(uid);
    }
    const functions = getFunctions(app, "us-central1");
    connectFunctionsEmulator(
      functions,
      target.functions.host,
      target.functions.port,
    );
    return {
      uid,
      action: httpsCallable(functions, "freeTableAction"),
      stats: httpsCallable(functions, "freeTablePublicStats"),
    };
  }

  async function invoke(caller, action, fields = {}) {
    const result = (await caller.action({ action, ...fields })).data;
    assertNoPrivateUid(result);
    return result;
  }

  async function invokeStats(caller, payload = {}) {
    const result = (await caller.stats(payload)).data;
    assertNoPrivateUid(result);
    assert.deepEqual(
      Object.keys(result).sort(),
      ["seatedRooms", "updatedAt", "welcomingRooms"],
    );
    return result;
  }

  async function waitForStatsCacheExpiry(stats) {
    const remaining = Number(stats.updatedAt || 0)
      + FREE_TABLE_PUBLIC_STATS_CACHE_TTL_MS
      + 100
      - Date.now();
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  before(async () => {
    adminApp = initializeAdminApp({
      projectId: DEDICATED_PROJECT_ID,
      databaseURL: `https://${DEDICATED_PROJECT_ID}-default-rtdb.firebaseio.com`,
    }, `free-table-callable-admin-${suiteId}`);
    adminAuth = getAdminAuth(adminApp);
    firestore = getFirestore(adminApp);
    realtime = getDatabase(adminApp);
    await realtime.ref("freeTables").remove();
  });

  after(async () => {
    await Promise.all(clientApps.map((app) => deleteClientApp(app)));
    if (firestore) {
      for (const collectionName of [
        "freeTableProfiles",
        "freeTablePublicMembers",
        "freeTableSpaces",
        "freeTablePublicSpaces",
        "freeTablePairActivity",
        "freeTableVisitLedger",
      ]) {
        await firestore.recursiveDelete(firestore.collection(collectionName));
      }
    }
    if (realtime) await realtime.ref("freeTables").remove();
    if (adminAuth && createdUids.size) {
      await adminAuth.deleteUsers([...createdUids]);
    }
    if (adminApp) await deleteAdminApp(adminApp);
  });

  test("Callables enforce App Check while public stats stay auth optional and canonical", async () => {
    const withoutAppCheck = await createCaller("without-app-check", {
      appCheck: false,
    });
    await assert.rejects(
      () => invoke(withoutAppCheck, "get_my_state"),
      (error) => error.code === "functions/unauthenticated",
    );
    await assert.rejects(
      () => invokeStats(withoutAppCheck),
      (error) => error.code === "functions/unauthenticated",
    );
    const withoutAuth = await createCaller("without-auth", {
      authenticate: false,
    });
    await assert.rejects(
      () => invoke(withoutAuth, "get_my_state"),
      (error) => error.code === "functions/unauthenticated",
    );
    await assert.rejects(
      () => invokeStats(withoutAuth, { extra: true }),
      (error) => error.code === "functions/invalid-argument",
    );

    const host = await createCaller("host");
    const visitor = await createCaller("visitor");
    await invoke(host, "save_space", {
      space,
      hostCard: card("夜更かし店主"),
    });
    const opened = await invoke(host, "open", { active: true });
    const openStats = await invokeStats(withoutAuth);
    assert.equal(openStats.welcomingRooms, 1);
    assert.equal(openStats.seatedRooms, 0);
    const listed = await invoke(visitor, "list");
    const room = listed.rooms.find((entry) => (
      entry.publicRoomId === opened.room.publicRoomId
    ));
    assert.ok(room);
    const requested = await invoke(visitor, "request", {
      publicRoomId: room.publicRoomId,
      visitorCard: card("夜道の旅人"),
    });
    const accepted = await invoke(host, "respond", {
      requestId: requested.request.requestId,
      accept: true,
    });
    const sessionId = accepted.session.sessionId;
    assert.ok(sessionId);
    await waitForStatsCacheExpiry(openStats);
    const connectingStats = await invokeStats(withoutAuth);
    assert.equal(connectingStats.welcomingRooms, 0);
    assert.equal(connectingStats.seatedRooms, 0);
    const [hostClaimBeforeArrival, visitorClaimBeforeArrival, canonicalSession] =
      await Promise.all([
        realtime.ref(`freeTables/active/${host.uid}`).get(),
        realtime.ref(`freeTables/active/${visitor.uid}`).get(),
        realtime.ref(`freeTables/sessions/${sessionId}`).get(),
      ]);
    assert.equal(hostClaimBeforeArrival.val()?.sessionId, sessionId);
    assert.equal(visitorClaimBeforeArrival.val()?.sessionId, sessionId);
    assert.equal(canonicalSession.val()?.sessionId, sessionId);
    assert.equal((await invoke(host, "arrive", { sessionId })).established, false);
    assert.equal((await invoke(visitor, "arrive", { sessionId })).established, true);
    const presenceNow = Date.now();
    await realtime.ref(`freeTables/presence/${sessionId}`).set({
      [host.uid]: {
        online: true,
        lastSeen: presenceNow,
        expiresAt: presenceNow + 60_000,
      },
      [visitor.uid]: {
        online: true,
        lastSeen: presenceNow,
        expiresAt: presenceNow + 60_000,
      },
    });
    await waitForStatsCacheExpiry(connectingStats);
    const seatedStats = await invokeStats(withoutAuth);
    assert.equal(seatedStats.welcomingRooms, 0);
    assert.equal(seatedStats.seatedRooms, 1);
    const ended = await invoke(visitor, "end", {
      sessionId,
      reason: "departure",
      message: "元気をもらいました",
    });
    assert.equal(ended.session.ending.line, "元気をもらいました。いってきます");
    await waitForStatsCacheExpiry(seatedStats);
    const endedStats = await invokeStats(withoutAuth);
    assert.equal(endedStats.welcomingRooms, 0);
    assert.equal(endedStats.seatedRooms, 0);
    const [hostClaim, visitorClaim, hostActive] = await Promise.all([
      realtime.ref(`freeTables/active/${host.uid}`).get(),
      realtime.ref(`freeTables/active/${visitor.uid}`).get(),
      realtime.ref(`freeTables/hostActive/${host.uid}`).get(),
    ]);
    assert.equal(hostClaim.exists(), false);
    assert.equal(visitorClaim.exists(), false);
    assert.equal(hostActive.exists(), false);
  });
}
