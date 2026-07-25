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
} = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.CREATOR_CARD_DATABASE_TEST_PROJECT_ID || "demo-creator-card";
const runsAgainstSafeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("creator-card RTDB rules allow public reads but only Admin may mutate cards and indexes", {
  skip: runsAgainstSafeEmulator
    ? false
    : "set FIREBASE_DATABASE_EMULATOR_HOST and a demo-* CREATOR_CARD_DATABASE_TEST_PROJECT_ID",
}, async (context) => {
  assert.equal(projectId.startsWith("demo-"), true);
  const environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8"),
    },
  });
  context.after(() => environment.cleanup());

  const ownerUid = "creator-owner";
  const otherUid = "other-owner";
  const entryId = "-creatorCardEntry123";
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    const database = adminContext.database();
    await set(ref(database, `online/topMessages/${entryId}`), {
      schemaVersion: 2,
      name: "ANJU",
      titleId: "",
      text: "Xでイラストを投稿しています",
      creatorType: "illustration",
      cardTheme: "basic-rose",
      growthLevel: 2,
      achievementShowcase: "",
      updatedAt: 1_800_000_000_000,
    });
    await set(ref(database, `online/topMessageOwners/${entryId}`), ownerUid);
    await set(ref(database, `online/topMessageEntriesByUser/${ownerUid}`), entryId);
  });

  const publicDatabase = environment.unauthenticatedContext().database();
  const publicSnapshot = await assertSucceeds(
    get(ref(publicDatabase, `online/topMessages/${entryId}`)),
  );
  assert.equal(publicSnapshot.child("name").val(), "ANJU");

  const ownerDatabase = environment.authenticatedContext(ownerUid).database();
  await assertSucceeds(get(ref(ownerDatabase, `online/topMessageOwners/${entryId}`)));
  await assertSucceeds(get(ref(ownerDatabase, `online/topMessageEntriesByUser/${ownerUid}`)));
  await assertFails(set(ref(ownerDatabase, `online/topMessages/${entryId}/growthLevel`), 5));
  await assertFails(remove(ref(ownerDatabase, `online/topMessages/${entryId}`)));
  await assertFails(set(ref(ownerDatabase, `online/topMessageOwners/${entryId}`), ownerUid));
  await assertFails(set(
    ref(ownerDatabase, `online/topMessageEntriesByUser/${ownerUid}`),
    "-anotherCreatorCard12",
  ));

  const otherDatabase = environment.authenticatedContext(otherUid).database();
  await assertFails(get(ref(otherDatabase, `online/topMessageOwners/${entryId}`)));
  await assertFails(get(ref(otherDatabase, `online/topMessageEntriesByUser/${ownerUid}`)));
});
