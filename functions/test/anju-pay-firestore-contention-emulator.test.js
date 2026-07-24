"use strict";

const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");

const {
  ANJU_PAY_OPENING_ENTRY_ID,
  activateAnjuPayWallet,
  anjuPayEntryId,
  isAnjuPayWalletActive,
  nextAnjuPayEntry,
} = require("../anju-pay-ledger");

const RUN_FLAG = "RUN_FIRESTORE_EMULATOR_TESTS";
const PROJECT_ID_ENV = "ANJU_PAY_FIRESTORE_TEST_PROJECT_ID";
const MUTATION_COUNT_ENV = "ANJU_PAY_EMULATOR_MUTATION_COUNT";
const MUTATION_REPEATS_ENV = "ANJU_PAY_EMULATOR_MUTATION_REPEATS";
const RUN_REQUESTED = process.env[RUN_FLAG] === "1";

function parseLoopbackEmulatorHost(rawHost) {
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
  return { hostname, port };
}

function requireDemoProjectId(projectId) {
  if (!/^demo-[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(projectId || "")) {
    throw new Error(
      `${PROJECT_ID_ENV} must be an explicit demo-* project ID; refusing any real Firebase project.`,
    );
  }
  return projectId;
}

function requireSafeEmulatorTarget() {
  return {
    ...parseLoopbackEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST || ""),
    projectId: requireDemoProjectId(process.env[PROJECT_ID_ENV] || ""),
  };
}

function positiveIntegerFromEnv(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

test("contention suite safety guard rejects production-like targets", () => {
  assert.throws(
    () => parseLoopbackEmulatorHost("firestore.googleapis.com:443"),
    /non-loopback/,
  );
  assert.throws(
    () => requireDemoProjectId("gazostadium-production"),
    /demo-\*/,
  );
  assert.deepEqual(parseLoopbackEmulatorHost("127.0.0.1:8080"), {
    hostname: "127.0.0.1",
    port: 8080,
  });
  assert.equal(requireDemoProjectId("demo-gazostadium"), "demo-gazostadium");
});

if (!RUN_REQUESTED) {
  test("AnjuPay Firestore contention tests are opt-in", {
    skip: `set ${RUN_FLAG}=1, FIRESTORE_EMULATOR_HOST, and ${PROJECT_ID_ENV}=demo-*`,
  }, () => {});
} else {
  // Validate before loading Firebase Admin or creating any client.
  const target = requireSafeEmulatorTarget();
  const mutationCount = positiveIntegerFromEnv(MUTATION_COUNT_ENV, 8, 64);
  const mutationRepeats = positiveIntegerFromEnv(MUTATION_REPEATS_ENV, 1, 10);
  const { deleteApp, initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");

  let app;
  let firestore;
  let walletSerial = 0;

  function nextWalletRef(label) {
    walletSerial += 1;
    return firestore.collection("wallets").doc(
      `contention-${label}-${process.pid}-${Date.now()}-${walletSerial}`,
    );
  }

  async function removeWallet(walletRef) {
    await firestore.recursiveDelete(walletRef);
  }

  async function ensureEmulatorWallet(walletRef, openingBalance) {
    return firestore.runTransaction(async (transaction) => {
      const walletSnapshot = await transaction.get(walletRef);
      const wallet = walletSnapshot.exists
        ? walletSnapshot.data()
        : { balance: openingBalance };
      const activation = activateAnjuPayWallet(wallet, Date.now());
      if (!activation.activated) {
        return { activated: false };
      }

      const balance = Number(wallet.balance) || 0;
      transaction.create(
        walletRef.collection("anjuPayEntries").doc(ANJU_PAY_OPENING_ENTRY_ID),
        activation.openingEntry,
      );
      transaction.set(walletRef, {
        balance,
        ...activation.walletPatch,
      }, { merge: true });
      return { activated: true };
    });
  }

  async function applyIdempotentMutation(
    walletRef,
    { operationId, delta, openingBalance },
  ) {
    await ensureEmulatorWallet(walletRef, openingBalance);
    const operationEntryId = anjuPayEntryId(`emulator-mutation:${operationId}`);
    const operationRef = walletRef.collection("anjuPayOperations").doc(operationEntryId);

    return firestore.runTransaction(async (transaction) => {
      // Keep every read before every write, matching the production constraint.
      const walletSnapshot = await transaction.get(walletRef);
      const operationSnapshot = await transaction.get(operationRef);
      assert.equal(walletSnapshot.exists, true, "wallet must be initialized");
      if (operationSnapshot.exists) {
        return { applied: false, entryId: operationEntryId };
      }

      const wallet = walletSnapshot.data();
      assert.equal(isAnjuPayWalletActive(wallet), true, "wallet must have an active ledger");
      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + delta;
      const nextEntry = nextAnjuPayEntry(wallet, {
        entryId: operationEntryId,
        groupId: operationEntryId,
        kind: "emulator_credit",
        category: "test",
        labelKey: "anju_pay_emulator_credit",
        status: "posted",
        delta,
        nominalAmount: Math.abs(delta),
        balanceBefore,
        balanceAfter,
        components: [{
          kind: "emulator_credit",
          labelKey: "anju_pay_emulator_credit",
          delta,
          nominalAmount: Math.abs(delta),
          status: "posted",
        }],
        occurredAt: Date.now(),
      });

      transaction.create(
        walletRef.collection("anjuPayEntries").doc(nextEntry.entryId),
        nextEntry.entry,
      );
      transaction.create(operationRef, {
        entryId: nextEntry.entryId,
        sequence: nextEntry.entry.sequence,
        occurredAt: nextEntry.entry.occurredAt,
      });
      transaction.update(walletRef, {
        balance: balanceAfter,
        ...nextEntry.walletPatch,
      });
      return { applied: true, entryId: nextEntry.entryId };
    });
  }

  async function readWalletState(walletRef) {
    const [walletSnapshot, ledgerSnapshot, operationsSnapshot] = await Promise.all([
      walletRef.get(),
      walletRef.collection("anjuPayEntries").orderBy("sequence", "asc").get(),
      walletRef.collection("anjuPayOperations").get(),
    ]);
    return {
      wallet: walletSnapshot.data(),
      entries: ledgerSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
      operations: operationsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })),
    };
  }

  function assertContinuousLedger(
    state,
    { openingBalance, expectedMutationCount, mutationDelta },
  ) {
    const { wallet, entries, operations } = state;
    assert.equal(isAnjuPayWalletActive(wallet), true);
    assert.equal(entries.length, expectedMutationCount + 1);
    assert.equal(operations.length, expectedMutationCount);
    assert.equal(wallet.ledgerSequence, entries.length - 1);
    assert.deepEqual(
      entries.map((entry) => entry.sequence),
      Array.from({ length: entries.length }, (_, index) => index),
    );
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);

    const openingEntry = entries[0];
    assert.equal(openingEntry.id, ANJU_PAY_OPENING_ENTRY_ID);
    assert.equal(openingEntry.kind, "opening");
    assert.equal(openingEntry.delta, 0);
    assert.equal(openingEntry.balanceBefore, openingBalance);
    assert.equal(openingEntry.balanceAfter, openingBalance);

    let expectedBalance = openingBalance;
    for (const entry of entries.slice(1)) {
      assert.equal(entry.balanceBefore, expectedBalance);
      assert.equal(entry.delta, mutationDelta);
      assert.equal(entry.balanceAfter - entry.balanceBefore, entry.delta);
      assert.equal(
        entry.components.reduce((sum, component) => sum + component.delta, 0),
        entry.delta,
      );
      expectedBalance = entry.balanceAfter;
    }
    assert.equal(expectedBalance, openingBalance + expectedMutationCount * mutationDelta);
    assert.equal(wallet.balance, expectedBalance);
  }

  describe("AnjuPay Firestore same-wallet contention", { concurrency: false }, () => {
    before(() => {
      app = initializeApp(
        { projectId: target.projectId },
        `anju-pay-contention-${process.pid}-${Date.now()}`,
      );
      firestore = getFirestore(app);
      firestore.settings({
        host: `${target.hostname}:${target.port}`,
        ssl: false,
      });
    });

    after(async () => {
      if (app) await deleteApp(app);
    });

    test("24 concurrent initializers create exactly one opening entry", async () => {
      const openingBalance = 321;
      const walletRef = nextWalletRef("initialization");
      await walletRef.set({ balance: openingBalance });
      try {
        const results = await Promise.all(
          Array.from({ length: 24 }, () => ensureEmulatorWallet(walletRef, openingBalance)),
        );
        assert.equal(results.filter((result) => result.activated).length, 1);
        const state = await readWalletState(walletRef);
        assertContinuousLedger(state, {
          openingBalance,
          expectedMutationCount: 0,
          mutationDelta: 1,
        });
      } finally {
        await removeWallet(walletRef);
      }
    });

    test(`${mutationCount} unique concurrent mutations retain a continuous sequence`, async () => {
      const diagnostics = [];
      let totalRejected = 0;

      for (let trial = 1; trial <= mutationRepeats; trial += 1) {
        const openingBalance = 1_000;
        const walletRef = nextWalletRef(`unique-${mutationCount}-${trial}`);
        await walletRef.set({ balance: openingBalance });
        const startedAt = Date.now();
        try {
          const results = await Promise.allSettled(
            Array.from({ length: mutationCount }, (_, index) => (
              applyIdempotentMutation(walletRef, {
                operationId: `trial-${trial}-operation-${index}`,
                delta: 1,
                openingBalance,
              })
            )),
          );
          const fulfilled = results.filter((result) => result.status === "fulfilled");
          const rejected = results.filter((result) => result.status === "rejected");
          const appliedCount = fulfilled.filter((result) => result.value.applied).length;
          const state = await readWalletState(walletRef);

          // Even when the emulator reaches its contention ceiling, every committed
          // prefix must remain atomic, gap-free, and balance-consistent.
          assertContinuousLedger(state, {
            openingBalance,
            expectedMutationCount: state.entries.length - 1,
            mutationDelta: 1,
          });
          assert.equal(
            state.entries.length - 1,
            appliedCount,
            "every committed mutation must have an acknowledged applied result",
          );

          totalRejected += rejected.length;
          diagnostics.push({
            trial,
            requested: mutationCount,
            fulfilled: fulfilled.length,
            rejected: rejected.length,
            committed: state.entries.length - 1,
            elapsedMs: Date.now() - startedAt,
            errors: [...new Set(rejected.map((result) => (
              String(result.reason?.message || result.reason).replace(/\s+/g, " ").slice(0, 180)
            )))],
          });
        } finally {
          await removeWallet(walletRef);
        }
      }

      console.log(`ANJU_PAY_CONTENTION ${JSON.stringify(diagnostics)}`);
      assert.equal(
        totalRejected,
        0,
        `contention ceiling reached: ${JSON.stringify(diagnostics)}`,
      );
    });

    test("same idempotency key applies once across concurrency and retry", async () => {
      const openingBalance = 200;
      const walletRef = nextWalletRef("idempotency");
      await walletRef.set({ balance: openingBalance });
      try {
        const results = await Promise.all(
          Array.from({ length: 20 }, () => applyIdempotentMutation(walletRef, {
            operationId: "same-operation",
            delta: 7,
            openingBalance,
          })),
        );
        assert.equal(results.filter((result) => result.applied).length, 1);

        const retry = await applyIdempotentMutation(walletRef, {
          operationId: "same-operation",
          delta: 7,
          openingBalance,
        });
        assert.equal(retry.applied, false);

        const state = await readWalletState(walletRef);
        assertContinuousLedger(state, {
          openingBalance,
          expectedMutationCount: 1,
          mutationDelta: 7,
        });
      } finally {
        await removeWallet(walletRef);
      }
    });
  });
}
