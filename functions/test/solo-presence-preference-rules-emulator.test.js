"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { ref, set, get, remove } = require("firebase/database");
const root = path.resolve(__dirname, "../..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = "demo-solo-presence-preference";
const safe = /^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("public preference is optional, owner-written, bounded to solo waiting and readable with the existing snapshot", {
  skip: safe ? false : "requires loopback Database Emulator",
}, async context => {
  const env = await initializeTestEnvironment({ projectId, database: { rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8") } });
  context.after(() => env.cleanup());
  const owner = env.authenticatedContext("owner").database();
  const other = env.authenticatedContext("other").database();
  const guest = env.unauthenticatedContext().database();
  await assertSucceeds(set(ref(owner, "online/publicPresenceOwners/session"), "owner"));
  const target = "online/publicPresence/session";
  const baseline = { mode: "solo", state: "waiting", lastSeen: Date.now() };
  for (const pref of ["i", "l", "b"]) await assertSucceeds(set(ref(owner, target), { ...baseline, pref }));
  for (const pref of ["both", "unknown", "", 1, true, { i: true }]) await assertFails(set(ref(owner, target), { ...baseline, pref }));
  await assertFails(set(ref(other, target), { ...baseline, pref: "i" }));
  await assertFails(set(ref(guest, target), { ...baseline, pref: "i" }));
  await assertFails(set(ref(owner, target), { ...baseline, state: "playing", pref: "i" }));
  await assertFails(set(ref(owner, target), { state: "waiting", lastSeen: Date.now(), pref: "i" }));
  await env.withSecurityRulesDisabled(async admin => set(ref(admin.database(), "online/strategyQueue/owner"), { uid: "owner", state: "waiting" }));
  await assertFails(set(ref(owner, target), { ...baseline, mode: "strategy", pref: "i" }));
  await assertSucceeds(set(ref(owner, target), baseline));
  await assertSucceeds(set(ref(owner, target), { ...baseline, pref: "i" }));
  const snapshot = await assertSucceeds(get(ref(guest, "online/publicPresence")));
  assert.equal(snapshot.child("session/pref").val(), "i");
  await assertSucceeds(set(ref(owner, target), { ...baseline, state: "playing" }));
  await assertSucceeds(set(ref(owner, target), { state: "waiting", lastSeen: Date.now() }));
  await assertSucceeds(remove(ref(owner, target)));
});
