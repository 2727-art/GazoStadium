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
const projectId = process.env.ROULETTE_TRAINING_FIRESTORE_TEST_PROJECT_ID
  || "demo-roulette-training-rules";
const safeEmulator = /^demo-[a-z0-9-]+$/u.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/u.test(emulatorHost);

const SERVER_ONLY_DOCUMENTS = Object.freeze([
  ["rouletteTrainingPacks", "pack-a"],
  ["rouletteTrainingPacks", "pack-a", "revisions", "00000001"],
  ["rouletteTrainingUses", "use-a"],
  ["rouletteTrainingActiveUses", "client-owner"],
  ["rouletteTrainingPublishActions", "action-a"],
  ["rouletteTrainingPackRevisionBuyers", "buyer-a"],
  ["rouletteTrainingReports", "report-a"],
  ["rouletteTrainingSellerStats", "seller-a"],
  ["rouletteTrainingMonthlyPeriods", "2026-09"],
  ["rouletteTrainingMonthlyPeriods", "2026-09", "entries", "seller-a"],
  ["rouletteTrainingRankingPairs", "pair-a"],
  ["rouletteTrainingSellerBuyerPairs", "pair-a"],
  ["rouletteTrainingMonthlyBuyerPairs", "pair-a"],
  ["rouletteTrainingPackStats", "ranking-a"],
  ["rouletteTrainingPackMonthlyPeriods", "2026-09"],
  ["rouletteTrainingPackMonthlyPeriods", "2026-09", "entries", "ranking-a"],
  ["rouletteTrainingPackRankingPairs", "pair-a"],
  ["rouletteTrainingPackBuyerPairs", "pair-a"],
  ["rouletteTrainingPackMonthlyBuyerPairs", "pair-a"],
  ["rouletteTrainingSellerProfiles", "seller-a"],
]);

const SERVER_ONLY_COLLECTIONS = Object.freeze([
  ["rouletteTrainingPacks"],
  ["rouletteTrainingPacks", "pack-a", "revisions"],
  ["rouletteTrainingUses"],
  ["rouletteTrainingActiveUses"],
  ["rouletteTrainingPublishActions"],
  ["rouletteTrainingPackRevisionBuyers"],
  ["rouletteTrainingReports"],
  ["rouletteTrainingSellerStats"],
  ["rouletteTrainingMonthlyPeriods"],
  ["rouletteTrainingMonthlyPeriods", "2026-09", "entries"],
  ["rouletteTrainingRankingPairs"],
  ["rouletteTrainingSellerBuyerPairs"],
  ["rouletteTrainingMonthlyBuyerPairs"],
  ["rouletteTrainingPackStats"],
  ["rouletteTrainingPackMonthlyPeriods"],
  ["rouletteTrainingPackMonthlyPeriods", "2026-09", "entries"],
  ["rouletteTrainingPackRankingPairs"],
  ["rouletteTrainingPackBuyerPairs"],
  ["rouletteTrainingPackMonthlyBuyerPairs"],
  ["rouletteTrainingSellerProfiles"],
]);

test("roulette training Firestore data rejects authenticated and anonymous client access", {
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

  for (const db of [
    environment.authenticatedContext("client-owner").firestore(),
    environment.unauthenticatedContext().firestore(),
  ]) {
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
    await assertFails(setDoc(doc(db, "rouletteTrainingPacks", "client-pack"), {
      marker: "client-create",
    }));
  }
});
