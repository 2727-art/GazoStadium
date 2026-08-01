"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  get,
  ref,
  remove,
  set,
  update,
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.STRATEGY_PRESENCE_RULES_TEST_PROJECT_ID
  || "demo-strategy-presence";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

function payload(state, now = Date.now()) {
  return { mode: "strategy", state, lastSeen: now };
}

test("strategy lobby presence follows queue and active-room ownership only", {
  skip: safeEmulator
    ? false
    : "run inside a loopback Database Emulator with a demo-* project",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const uid = "strategy-owner";
  const peerUid = "strategy-peer";
  const otherUid = "strategy-other";
  const roomId = "strategy-room-current";
  const otherRoomId = "strategy-room-other";
  const database = environment.authenticatedContext(uid).database();
  const otherDatabase = environment.authenticatedContext(otherUid).database();
  const now = Date.now();

  async function adminSet(relativePath, value) {
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await set(ref(adminContext.database(), relativePath), value);
    });
  }

  async function own(sessionId) {
    await assertSucceeds(set(
      ref(database, `online/publicPresenceOwners/${sessionId}`),
      uid,
    ));
  }

  async function seedLiveRoom(overrides = {}) {
    await adminSet(`online/strategyRooms/${roomId}`, {
      hostUid: uid,
      guestUid: peerUid,
      status: "active",
      members: { [uid]: true, [peerUid]: true },
      players: { [uid]: { uid }, [peerUid]: { uid: peerUid } },
      ...overrides,
    });
    await adminSet(`online/strategyActive/${uid}`, roomId);
  }

  await own("waiting");
  await assertFails(set(
    ref(database, "online/publicPresence/waiting"),
    payload("waiting", now),
  ));
  await adminSet(`online/strategyQueue/${uid}`, {
    uid,
    joinedAt: now,
    lastSeen: now,
    state: "waiting",
  });
  await assertSucceeds(set(
    ref(database, "online/publicPresence/waiting"),
    payload("waiting", now + 1),
  ));
  await adminSet(`online/strategyQueue/${uid}/state`, "offering");
  await assertSucceeds(update(
    ref(database, "online/publicPresence/waiting"),
    { lastSeen: now + 2 },
  ));

  await seedLiveRoom();
  await adminSet(`online/strategyQueue/${uid}`, null);
  await assertSucceeds(set(
    ref(database, "online/publicPresence/waiting"),
    payload("playing", now + 3),
  ));
  await assertFails(set(
    ref(database, "online/publicPresence/waiting"),
    payload("waiting", now + 4),
  ));
  const retainedPlaying = await assertSucceeds(get(
    ref(database, "online/publicPresence/waiting"),
  ));
  assert.equal(retainedPlaying.val().state, "playing");
  assert.equal(retainedPlaying.val().lastSeen, now + 3);
  await adminSet(`online/strategyRooms/${roomId}/finished/${uid}`, true);
  await assertFails(update(
    ref(database, "online/publicPresence/waiting"),
    { lastSeen: now + 5 },
  ));
  await assertSucceeds(remove(ref(database, "online/publicPresence/waiting")));

  await seedLiveRoom();
  await own("playing");
  await assertSucceeds(set(
    ref(database, "online/publicPresence/playing"),
    payload("playing", now + 5),
  ));
  await adminSet(`online/strategyActive/${uid}`, otherRoomId);
  await assertFails(update(
    ref(database, "online/publicPresence/playing"),
    { lastSeen: now + 6 },
  ));
  await assertSucceeds(remove(ref(database, "online/publicPresence/playing")));

  const invalidCases = [
    ["offered-room", { status: "offered" }],
    ["missing-member", { members: { [peerUid]: true } }],
    ["wrong-player", { players: { [uid]: { uid: otherUid }, [peerUid]: { uid: peerUid } } }],
    ["destroyed-room", { destroyed: { by: peerUid, at: now } }],
    ["finished-player", { finished: { [uid]: true } }],
    ["withdrawn-room", { decisions: { [peerUid]: "withdraw" } }],
  ];
  for (const [sessionId, overrides] of invalidCases) {
    await seedLiveRoom(overrides);
    await own(sessionId);
    await assertFails(set(
      ref(database, `online/publicPresence/${sessionId}`),
      payload("playing", Date.now()),
    ));
  }

  await seedLiveRoom();
  await own("mode-lock");
  await assertSucceeds(set(
    ref(database, "online/publicPresence/mode-lock"),
    payload("playing", now + 7),
  ));
  await assertFails(set(ref(database, "online/publicPresence/mode-lock"), {
    state: "playing",
    lastSeen: now + 8,
  }));
  await assertFails(set(ref(otherDatabase, "online/publicPresence/mode-lock"), {
    mode: "strategy",
    state: "playing",
    lastSeen: now + 9,
  }));
  await assertFails(remove(ref(otherDatabase, "online/publicPresence/mode-lock")));
  await assertSucceeds(remove(ref(database, "online/publicPresence/mode-lock")));

  await own("solo-compatible");
  await assertSucceeds(set(ref(database, "online/publicPresence/solo-compatible"), {
    mode: "solo",
    state: "waiting",
    lastSeen: now,
  }));
  await own("legacy-compatible");
  await assertSucceeds(set(ref(database, "online/publicPresence/legacy-compatible"), {
    state: "waiting",
    lastSeen: now,
  }));

  await own("owner-permissions");
  const ownerRef = ref(database, "online/publicPresenceOwners/owner-permissions");
  const otherOwnerRef = ref(otherDatabase, "online/publicPresenceOwners/owner-permissions");
  await assertFails(set(otherOwnerRef, otherUid));
  await assertFails(remove(otherOwnerRef));
  await assertSucceeds(remove(ownerRef));
});
