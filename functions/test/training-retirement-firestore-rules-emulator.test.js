"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
} = require("firebase/firestore");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const projectId = process.env.TRAINING_RETIREMENT_FIRESTORE_TEST_PROJECT_ID
  || "demo-training-retirement";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

const RETAINED_HISTORY_DOCUMENTS = Object.freeze([
  "trainingProfiles/client-a",
  "trainingClaims/client-a/rooms/room-retired",
  "trainingV6Claims/client-a/rooms/room-retired",
]);

test("retired Training 60 Firestore history is retained but client-inaccessible", {
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
    for (const documentPath of RETAINED_HISTORY_DOCUMENTS) {
      await setDoc(doc(adminContext.firestore(), documentPath), {
        retained: true,
      });
    }
  });

  const authenticated = environment.authenticatedContext("client-a").firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  for (const documentPath of RETAINED_HISTORY_DOCUMENTS) {
    await assertFails(getDoc(doc(authenticated, documentPath)));
    await assertFails(setDoc(doc(authenticated, documentPath), { rewritten: true }));
    await assertFails(getDoc(doc(anonymous, documentPath)));
    await assertFails(setDoc(doc(anonymous, documentPath), { rewritten: true }));
  }
});
