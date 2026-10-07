"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { HttpsError } = require("firebase-functions/v2/https");
const retiredModes = require("../retired-community-modes");
const { DANWAKU_ACTIONS } = require("../danwaku-note");

const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
const fleaSource = fs.readFileSync(path.join(__dirname, "../anju-pay-flea-service.js"), "utf8");
const fleaActionsSource = fleaSource.match(/const FLEA_ACTIONS = Object\.freeze\((\[[\s\S]*?\])\);/);
assert.ok(fleaActionsSource, "the actual historical flea action list must be found");
const fleaActions = Array.from(vm.runInNewContext(fleaActionsSource[1]));
const MODES = [
  { callable: "anjuPayFleaAction", mode: "anju_pay_flea", name: "AnjuPayフリマ", actions: fleaActions },
  { callable: "danwakuNoteAction", mode: "danwaku_note", name: "断惑NOTE", actions: [...DANWAKU_ACTIONS] },
];

function extract(pattern, description) {
  const match = source.match(pattern);
  assert.ok(match, `${description} must be extracted from the actual index.js`);
  return match[0];
}

function harness() {
  const operations = [];
  const unexpected = (name) => (...args) => {
    operations.push({ name, args });
    throw new Error(`retired callable attempted ${name}`);
  };
  const inaccessible = (name) => new Proxy({}, {
    get(_target, property) { return unexpected(`${name}.${String(property)}`)(); },
  });
  const sandbox = {
    exports: {}, HttpsError,
    require(id) {
      assert.equal(id, "./retired-community-modes");
      return retiredModes;
    },
    onCall: (_options, handler) => handler,
    callableOptions(name) {
      assert.ok(MODES.some((entry) => entry.callable === name));
      return {};
    },
    anjuPayFleaService: inaccessible("anjuPayFleaService"),
    danwakuNoteService: inaccessible("danwakuNoteService"),
    firestore: inaccessible("firestore"),
    realtime: inaccessible("realtime"),
    console: { error: unexpected("console.error") },
  };
  for (const name of ["ensureWallet", "walletRef", "anjuPayLedgerConfigRef", "walletData",
    "walletCreditCapacity", "debitPoints", "creditPoints", "stageAnjuPayOpening",
    "appendAnjuPayEntry", "anjuPayWalletMetadataPatch", "anjuPayEntryId", "mirrorWallet",
    "ensureAchievementState", "requireLivePlayerSafety"]) {
    sandbox[name] = unexpected(name);
  }
  const context = vm.createContext(sandbox);
  const helperImport = extract(
    /const\s+\{\s*throwRetiredCommunityMode\s*\}\s*=\s*require\("\.\/retired-community-modes"\);/,
    "retirement helper import",
  );
  const auth = extract(/function requireUid\(request\) \{[\s\S]*?^\}/m, "authentication guard");
  const handlers = MODES.map(({ callable }) => extract(
    new RegExp(`exports\\.${callable} = onCall\\([\\s\\S]*?^\\}\\);`, "m"),
    `${callable} handler`,
  ));
  vm.runInContext([helperImport, auth, ...handlers].join("\n"), context);
  return { handlers: context.exports, operations };
}

function expectRetired(error, mode, name) {
  assert.ok(error instanceof HttpsError);
  assert.equal(error.code, "failed-precondition");
  assert.equal(error.message, `${name}は提供を終了しました。`);
  assert.deepEqual(error.details, { reason: "mode-retired", mode });
  return true;
}

for (const { callable, mode, name, actions } of MODES) {
  test(`${callable}: helper has a stable ended-mode error contract`, () => {
    assert.throws(() => retiredModes.throwRetiredCommunityMode(HttpsError, mode),
      (error) => expectRetired(error, mode, name));
  });

  test(`${callable}: actual handler preserves authentication before retirement`, async () => {
    const h = harness();
    for (const auth of [undefined, null, {}, { uid: "" }]) {
      await assert.rejects(h.handlers[callable]({ auth, data: { action: "state" } }),
        (error) => error instanceof HttpsError && error.code === "unauthenticated");
    }
    assert.deepEqual(h.operations, []);
  });

  for (const action of [...actions, "unknown_action", ""]) {
    test(`${callable}: old action '${action}' cannot reach services, wallets, or databases`, async () => {
      const h = harness();
      await assert.rejects(h.handlers[callable]({
        auth: { uid: "existing-user", token: { firebase: { sign_in_provider: "google.com" } } },
        data: { action, mode, retired: false, allowRetired: true, preview: true,
          listingId: "existing-listing", noteId: "existing-private-note",
          operationId: "replayed-operation", price: 50, confirmed: true },
      }), (error) => expectRetired(error, mode, name));
      assert.deepEqual(h.operations, []);
    });
  }

  test(`${callable}: closure does not inspect the payload or allow admin/anonymous bypasses`, async () => {
    const h = harness();
    for (const token of [{ admin: true }, { firebase: { sign_in_provider: "anonymous" } }, {}]) {
      const request = { auth: { uid: "existing-user", token } };
      Object.defineProperty(request, "data", { get() { throw new Error("payload must not be inspected"); } });
      await assert.rejects(h.handlers[callable](request), (error) => expectRetired(error, mode, name));
    }
    assert.deepEqual(h.operations, []);
  });

  test(`${callable}: concurrent replay and reload requests have no side effects`, async () => {
    const h = harness();
    await Promise.all(Array.from({ length: 30 }, (_, index) => assert.rejects(h.handlers[callable]({
      auth: { uid: `existing-user-${index % 3}` },
      data: { action: actions[index % actions.length], operationId: "same-request" },
    }), (error) => expectRetired(error, mode, name))));
    assert.deepEqual(h.operations, []);
  });
}

test("unknown server mode identifiers also fail closed", () => {
  for (const mode of ["future-mode", "toString", "__proto__", undefined, null, {}]) {
    assert.throws(() => retiredModes.throwRetiredCommunityMode(HttpsError, mode), (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.message, "このモードは提供を終了しました。");
      assert.deepEqual(error.details, {
        reason: "mode-retired", mode: typeof mode === "string" ? mode : "unknown",
      });
      return true;
    });
  }
});

test("the retired modes no longer export scheduled functions, without retiring other schedules", () => {
  for (const name of ["cleanupDanwakuDeletionJobs", "expireAnjuPayFleaListings"]) {
    assert.doesNotMatch(source, new RegExp(`exports\\.${name}\\s*=`));
  }
  for (const name of ["expireTributeContracts", "cleanupAiTextTrainingActivePresence",
    "cleanupPlayerSafety", "cleanupExpiredFreeTables", "cleanupSoloSessionV2Leases",
    "cleanupSoloSessionV2QueueIndex"]) {
    assert.match(source, new RegExp(`exports\\.${name} = onSchedule\\(`));
  }
});

test("internal historical cleanup and safety operations remain available, with no wallet effects", async () => {
  const { createAnjuPayFleaService } = require("../anju-pay-flea-service");
  const { createDanwakuNoteService } = require("../danwaku-note-service");
  const timestamp = 2_000_000_000_000;
  const reads = [];
  const unexpected = () => { throw new Error("empty historical cleanup must not mutate or read wallets"); };
  const firestore = {
    collection(name) {
      const query = {
        where() { return query; },
        orderBy() { return query; },
        limit() { return query; },
        async get() { reads.push(name); return { docs: [], size: 0, empty: true }; },
      };
      return query;
    },
    runTransaction: unexpected,
  };
  const dependencies = new Proxy({
    firestore, realtime: { ref: unexpected }, HttpsError,
    now: () => timestamp, playerSafety: null, randomBytes: undefined,
  }, { get: (target, name) => name in target ? target[name] : unexpected });
  const flea = createAnjuPayFleaService(dependencies);
  const danwaku = createDanwakuNoteService(dependencies);
  assert.equal(typeof flea.closeBlockedPair, "function");
  assert.equal(typeof danwaku.resolvePublicEntryOwner, "function");
  assert.deepEqual(await flea.expireListings(timestamp), { serverNow: timestamp, expired: 0 });
  assert.deepEqual(await danwaku.cleanupDeletionJobs({ timestamp }), {
    scanned: 0, deleted: 0, deferred: 0, invalid: 0, limit: 50, completedAt: timestamp,
  });
  assert.deepEqual(reads, ["anjuPayFleaListings", "danwakuDeletionJobs"]);
});
