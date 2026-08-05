"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} = require("firebase/firestore");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const projectId = process.env.DANWAKU_FIRESTORE_TEST_PROJECT_ID
  || "demo-danwaku-rules";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

const SERVER_ONLY_DOCUMENTS = Object.freeze([
  ["danwakuProfiles", "client-owner"],
  ["danwakuProfiles", "client-owner", "notes", "note-a"],
  ["danwakuProfiles", "client-owner", "notes", "note-a", "events", "event-a"],
  ["danwakuProfiles", "client-owner", "operations", "operation-a"],
  ["danwakuPublicEntries", "public-entry-a"],
  ["danwakuMatchBadges", "client-owner"],
  ["danwakuDeletionJobs", "deletion-job-a"],
  ["strategyMatchAchievementFreezes", "room-client-owner"],
]);

const SERVER_ONLY_COLLECTIONS = Object.freeze([
  ["danwakuProfiles"],
  ["danwakuProfiles", "client-owner", "notes"],
  ["danwakuProfiles", "client-owner", "notes", "note-a", "events"],
  ["danwakuProfiles", "client-owner", "operations"],
  ["danwakuPublicEntries"],
  ["danwakuMatchBadges"],
  ["danwakuDeletionJobs"],
  ["strategyMatchAchievementFreezes"],
]);

const CLIENT_CREATE_DOCUMENTS = Object.freeze([
  ["danwakuProfiles", "new-profile"],
  ["danwakuProfiles", "client-owner", "notes", "new-note"],
  ["danwakuProfiles", "client-owner", "notes", "note-a", "events", "new-event"],
  ["danwakuProfiles", "client-owner", "operations", "new-operation"],
  ["danwakuPublicEntries", "new-public-entry"],
  ["danwakuMatchBadges", "new-badge-owner"],
  ["danwakuDeletionJobs", "new-deletion-job"],
  ["strategyMatchAchievementFreezes", "new-room-owner"],
]);

test("Danwaku Firestore documents reject every authenticated and anonymous client read and write", {
  skip: safeEmulator
    ? false
    : "run inside a loopback Firestore Emulator with a demo-* project",
}, async (context) => {
  const environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  await environment.withSecurityRulesDisabled(async (adminContext) => {
    const db = adminContext.firestore();
    await Promise.all(SERVER_ONLY_DOCUMENTS.map((segments) => (
      setDoc(doc(db, ...segments), { marker: "server-only" })
    )));
  });

  const clientDatabases = [
    environment.authenticatedContext("client-owner").firestore(),
    environment.unauthenticatedContext().firestore(),
  ];
  for (const db of clientDatabases) {
    for (const segments of SERVER_ONLY_DOCUMENTS) {
      const reference = doc(db, ...segments);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { marker: "client-overwrite" }));
      await assertFails(updateDoc(reference, { marker: "client-update" }));
      await assertFails(deleteDoc(reference));
    }
    for (const segments of SERVER_ONLY_COLLECTIONS) {
      await assertFails(getDocs(collection(db, ...segments)));
    }
    for (const segments of CLIENT_CREATE_DOCUMENTS) {
      await assertFails(setDoc(doc(db, ...segments), { marker: "client-create" }));
    }
  }
});
