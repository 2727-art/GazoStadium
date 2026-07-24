"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");

const RUN_FLAG = "RUN_FIRESTORE_EMULATOR_TESTS";
const PROJECT_ID_ENV = "ANJU_PAY_FIRESTORE_TEST_PROJECT_ID";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env[PROJECT_ID_ENV] || "";

function parseLoopbackEmulatorTarget(rawHost) {
  if (!rawHost) {
    throw new Error(
      `${RUN_FLAG}=1 requires FIRESTORE_EMULATOR_HOST (for example 127.0.0.1:8080).`,
    );
  }
  if (
    rawHost.includes("://")
    || rawHost.includes("/")
    || rawHost.includes("@")
    || rawHost.includes("?")
    || rawHost.includes("#")
  ) {
    throw new Error("FIRESTORE_EMULATOR_HOST must be a bare loopback host and port.");
  }

  let parsed;
  try {
    parsed = new URL(`http://${rawHost}`);
  } catch {
    throw new Error("FIRESTORE_EMULATOR_HOST is not a valid host and port.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(parsed.port);
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("Refusing to run against a non-loopback Firestore host.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("FIRESTORE_EMULATOR_HOST must include a valid port.");
  }
  return { host: hostname, port };
}

function requireDemoProjectId(projectId) {
  if (!/^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(projectId)) {
    throw new Error(
      `${PROJECT_ID_ENV} must be an explicit demo-* project ID; refusing any real Firebase project.`,
    );
  }
  return projectId;
}

function emulatorTarget() {
  return {
    ...parseLoopbackEmulatorTarget(EMULATOR_HOST),
    projectId: requireDemoProjectId(PROJECT_ID),
  };
}

if (!RUN_REQUESTED) {
  test("AnjuPay Firestore Emulator tests are opt-in and never fall back to production", {
    skip: `set ${RUN_FLAG}=1, FIRESTORE_EMULATOR_HOST, and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  // Validate the target before loading any Firebase client library or opening a connection.
  const target = emulatorTarget();
  const rulesPath = path.resolve(__dirname, "..", "..", "firestore.rules");
  const functionsSourcePath = path.resolve(__dirname, "..", "index.js");

  let rulesUnitTesting;
  let firestoreClient;
  let testEnvironment;

  function walletDocument(db, uid) {
    return firestoreClient.doc(db, "wallets", uid);
  }

  function ledgerCollection(db, uid) {
    return firestoreClient.collection(db, "wallets", uid, "anjuPayEntries");
  }

  async function seedSecurityRuleFixtures() {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        firestoreClient.setDoc(walletDocument(db, "wallet-owner"), {
          balance: 250,
          ledgerSequence: 1,
          historyStartedAt: 1_700_000_000_000,
          ledgerVersion: 1,
        }),
        firestoreClient.setDoc(
          firestoreClient.doc(db, "wallets", "wallet-owner", "anjuPayEntries", "entry-001"),
          {
            sequence: 1,
            delta: 50,
            balanceAfter: 250,
          },
        ),
        firestoreClient.setDoc(
          firestoreClient.doc(db, "systemConfig", "anjuPayLedger"),
          {
            enabled: true,
            schemaVersion: 1,
          },
        ),
      ]);
    });
  }

  function callableHistorySource() {
    const source = fs.readFileSync(functionsSourcePath, "utf8");
    const start = source.indexOf("async function getAnjuPayWallet");
    const end = source.indexOf("exports.economyAction", start);
    assert.notEqual(start, -1, "getAnjuPayWallet must exist");
    assert.notEqual(end, -1, "economyAction export must follow getAnjuPayWallet");
    return source.slice(start, end);
  }

  async function fetchLedgerPageLikeCallable({
    db,
    uid,
    pageSize,
    cursor = null,
    afterBoundaryRead,
  }) {
    const walletSnapshot = await firestoreClient.getDoc(walletDocument(db, uid));
    assert.equal(walletSnapshot.exists(), true, "test wallet must exist");
    const walletSequence = walletSnapshot.get("ledgerSequence");
    assert.equal(Number.isSafeInteger(walletSequence), true);

    const sequenceUpperBound = cursor === null
      ? walletSequence
      : Math.min(walletSequence, cursor - 1);

    if (afterBoundaryRead) {
      await afterBoundaryRead();
    }

    const historyQuery = firestoreClient.query(
      ledgerCollection(db, uid),
      firestoreClient.where("sequence", "<=", sequenceUpperBound),
      firestoreClient.orderBy("sequence", "desc"),
      firestoreClient.limit(pageSize + 1),
    );
    const historySnapshot = await firestoreClient.getDocs(historyQuery);
    const hasMore = historySnapshot.docs.length > pageSize;
    const documents = historySnapshot.docs.slice(0, pageSize);
    const entries = documents.map((document) => ({
      id: document.id,
      ...document.data(),
    }));
    return {
      entries,
      hasMore,
      nextCursor: hasMore && entries.length
        ? entries.at(-1).sequence
        : null,
      sequenceUpperBound,
    };
  }

  describe("AnjuPay Firestore Security Rules", { concurrency: false }, () => {
    before(async () => {
      rulesUnitTesting = require("@firebase/rules-unit-testing");
      firestoreClient = require("firebase/firestore");
      testEnvironment = await rulesUnitTesting.initializeTestEnvironment({
        projectId: target.projectId,
        firestore: {
          host: target.host,
          port: target.port,
          rules: fs.readFileSync(rulesPath, "utf8"),
        },
      });
    });

    after(async () => {
      if (testEnvironment) {
        await testEnvironment.cleanup();
      }
    });

    test("owner can get only their wallet document, while wallet writes stay server-only", async () => {
      await testEnvironment.clearFirestore();
      await seedSecurityRuleFixtures();

      const ownerDb = testEnvironment.authenticatedContext("wallet-owner").firestore();
      const otherDb = testEnvironment.authenticatedContext("other-user").firestore();
      const anonymousDb = testEnvironment.unauthenticatedContext().firestore();

      await rulesUnitTesting.assertSucceeds(
        firestoreClient.getDoc(walletDocument(ownerDb, "wallet-owner")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.getDoc(walletDocument(otherDb, "wallet-owner")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.getDoc(walletDocument(anonymousDb, "wallet-owner")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.getDocs(firestoreClient.collection(ownerDb, "wallets")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.setDoc(walletDocument(ownerDb, "wallet-owner"), { balance: 999 }),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.updateDoc(walletDocument(ownerDb, "wallet-owner"), { balance: 999 }),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.deleteDoc(walletDocument(ownerDb, "wallet-owner")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.setDoc(walletDocument(ownerDb, "new-wallet"), { balance: 1 }),
      );
    });

    test("ledger entries reject every direct client read and write", async () => {
      await testEnvironment.clearFirestore();
      await seedSecurityRuleFixtures();

      const ownerDb = testEnvironment.authenticatedContext("wallet-owner").firestore();
      const entry = firestoreClient.doc(
        ownerDb,
        "wallets",
        "wallet-owner",
        "anjuPayEntries",
        "entry-001",
      );

      await rulesUnitTesting.assertFails(firestoreClient.getDoc(entry));
      await rulesUnitTesting.assertFails(
        firestoreClient.getDocs(ledgerCollection(ownerDb, "wallet-owner")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.setDoc(entry, { sequence: 1, delta: 999 }),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.updateDoc(entry, { delta: 999 }),
      );
      await rulesUnitTesting.assertFails(firestoreClient.deleteDoc(entry));
    });

    test("rollout config rejects every direct client read and write", async () => {
      await testEnvironment.clearFirestore();
      await seedSecurityRuleFixtures();

      const ownerDb = testEnvironment.authenticatedContext("wallet-owner").firestore();
      const config = firestoreClient.doc(ownerDb, "systemConfig", "anjuPayLedger");

      await rulesUnitTesting.assertFails(firestoreClient.getDoc(config));
      await rulesUnitTesting.assertFails(
        firestoreClient.getDocs(firestoreClient.collection(ownerDb, "systemConfig")),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.setDoc(config, { enabled: false }),
      );
      await rulesUnitTesting.assertFails(
        firestoreClient.updateDoc(config, { enabled: false }),
      );
      await rulesUnitTesting.assertFails(firestoreClient.deleteDoc(config));
    });

    test("cursor pages retain the first-page snapshot boundary during a concurrent append", async () => {
      await testEnvironment.clearFirestore();

      const historySource = callableHistorySource();
      assert.match(
        historySource,
        /const sequenceUpperBound = cursor === null\s*\?\s*walletSequence\s*:\s*Math\.min\(walletSequence, cursor - 1\)/,
      );
      assert.match(
        historySource,
        /\.where\("sequence", "<=", sequenceUpperBound\)\s*\.orderBy\("sequence", "desc"\)/,
      );
      assert.match(historySource, /\.limit\(limit \+ 1\)\.get\(\)/);
      assert.match(
        historySource,
        /nextCursor: hasMore && entries\.length \? entries\.at\(-1\)\.sequence : null/,
      );

      await testEnvironment.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const uid = "paging-wallet";
        const initialHighestSequence = 45;
        const pageSize = 10;
        const seedBatch = firestoreClient.writeBatch(db);

        seedBatch.set(walletDocument(db, uid), {
          balance: 450,
          ledgerSequence: initialHighestSequence,
          historyStartedAt: 1_700_000_000_000,
          ledgerVersion: 1,
        });
        for (let sequence = 0; sequence <= initialHighestSequence; sequence += 1) {
          seedBatch.set(
            firestoreClient.doc(
              db,
              "wallets",
              uid,
              "anjuPayEntries",
              `entry-${String(sequence).padStart(3, "0")}`,
            ),
            {
              sequence,
              delta: sequence === 0 ? 0 : 10,
              balanceAfter: sequence * 10,
            },
          );
        }
        await seedBatch.commit();

        const concurrentlyAppendedSequence = initialHighestSequence + 1;
        const firstPage = await fetchLedgerPageLikeCallable({
          db,
          uid,
          pageSize,
          afterBoundaryRead: async () => {
            const appendBatch = firestoreClient.writeBatch(db);
            appendBatch.set(
              firestoreClient.doc(
                db,
                "wallets",
                uid,
                "anjuPayEntries",
                `entry-${String(concurrentlyAppendedSequence).padStart(3, "0")}`,
              ),
              {
                sequence: concurrentlyAppendedSequence,
                delta: 10,
                balanceAfter: 460,
              },
            );
            appendBatch.update(walletDocument(db, uid), {
              balance: 460,
              ledgerSequence: concurrentlyAppendedSequence,
            });
            await appendBatch.commit();
          },
        });

        assert.equal(firstPage.sequenceUpperBound, initialHighestSequence);
        assert.deepEqual(
          firstPage.entries.map((entry) => entry.sequence),
          [45, 44, 43, 42, 41, 40, 39, 38, 37, 36],
        );

        const allSequences = firstPage.entries.map((entry) => entry.sequence);
        let cursor = firstPage.nextCursor;
        while (cursor !== null) {
          const page = await fetchLedgerPageLikeCallable({
            db,
            uid,
            pageSize,
            cursor,
          });
          allSequences.push(...page.entries.map((entry) => entry.sequence));
          cursor = page.nextCursor;
        }

        const expectedSnapshotSequences = Array.from(
          { length: initialHighestSequence + 1 },
          (_, index) => initialHighestSequence - index,
        );
        assert.deepEqual(allSequences, expectedSnapshotSequences);
        assert.equal(new Set(allSequences).size, allSequences.length, "no duplicate sequence");
        assert.equal(
          allSequences.includes(concurrentlyAppendedSequence),
          false,
          "a post-boundary append must not leak into later pages",
        );
      });
    });
  });
}
