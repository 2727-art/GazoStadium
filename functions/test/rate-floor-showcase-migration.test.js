"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { migrate, parseArguments, loadProfileNormalizer, withDeadline } = require("../scripts/sync-rate-floor-showcase");
const { createMigrationRealtimeRest } = require("../scripts/player-safety-rtdb-rest");
const { CROWN_CIRCUIT_RULESET_VERSION, CROWN_SIGNATURE_IDS } = require("../crown-circuit");
const { ACHIEVEMENT_DEFINITIONS } = require("../achievements");
const { serverRateFloorMirrorDecision } = require("../rate-floor");

const ENTRY_ID = "F".repeat(24);
const PROFILE_PATH = "serverRankingProfiles/player";
const PUBLIC_PATH = `online/serverRateFloorLeaderboard/${ENTRY_ID}`;
const AUTO = ACHIEVEMENT_DEFINITIONS.find((value) => value.autoPublic && !value.legacy).id;
const PRIVATE = ACHIEVEMENT_DEFINITIONS.find((value) => !value.autoPublic && !value.legacy).id;

function profile(overrides = {}) {
  return { enabled: true, rateFloorEnabled: true, entryId: "overall-private-link",
    rateFloorEntryId: ENTRY_ID, rateFloorRevision: 8, name: "PLAYER", rating: 350,
    serverMatches: 12, crownTheme: "rose", crownSignatureId: CROWN_SIGNATURE_IDS[0],
    achievementShowcase: "stale", ...overrides };
}

function publicRow(overrides = {}) {
  return { serverVerified: true, rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
    name: "PLAYER", rating: 350, serverMatches: 12, syncRevision: 8, ...overrides };
}

function fixture({ profiles = { player: profile() }, rows = { [PUBLIC_PATH]: publicRow() },
  achievements = { player: { unlocked: { [AUTO]: 100, [PRIVATE]: 200 } } } } = {}) {
  const records = new Map([
    ...Object.entries(profiles).map(([uid, value]) => [`serverRankingProfiles/${uid}`, structuredClone(value)]),
    ...Object.entries(achievements).map(([uid, value]) => [`achievementProfiles/${uid}`, structuredClone(value)]),
  ]);
  const live = new Map(Object.entries(structuredClone(rows)));
  const calls = { firestoreWrites: [], realtimeWrites: 0, transactionAttempts: 0, publicReads: 0 };
  const hooks = {};
  let inTransaction = false;
  const reference = (value) => ({ path: value, id: value.split("/").at(-1) });
  const snapshot = (value) => ({ ref: reference(value), id: value.split("/").at(-1),
    exists: records.has(value), data: () => structuredClone(records.get(value)) });
  function query(collection, filters = [], maximum = Infinity, cursor = "") {
    return { doc: (id) => reference(`${collection}/${id}`),
      where: (field, op, value) => query(collection, [...filters, [field, op, value]], maximum, cursor),
      orderBy: () => query(collection, filters, maximum, cursor),
      limit: (value) => query(collection, filters, value, cursor),
      startAfter: (value) => query(collection, filters, maximum, value.ref.path),
      get: async () => ({ docs: [...records.keys()].sort().filter((value) => value.split("/")[0] === collection
        && value > cursor && filters.every(([key, op, expected]) => op === "==" && records.get(value)[key] === expected))
        .slice(0, maximum).map((value) => {
          const snap = snapshot(value);
          const data = snap.data();
          return { ...snap, data: () => structuredClone(data) };
        }) }),
    };
  }
  const firestore = { collection: (name) => query(name), runTransaction: async (callback) => {
    await hooks.beforeFirestore?.();
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const staged = [];
      inTransaction = true;
      calls.transactionAttempts += 1;
      try {
        result = await callback({ get: async (ref) => snapshot(ref.path),
          set: (ref, value, options) => staged.push({ path: ref.path, value: structuredClone(value), options }),
        });
      } finally { inTransaction = false; }
      if (attempt === 0 && hooks.retryFirestore) {
        await hooks.retryFirestore();
        continue;
      }
      for (const write of staged) {
        assert.deepEqual(write.options, { merge: true });
        records.set(write.path, { ...records.get(write.path), ...write.value });
        calls.firestoreWrites.push(write);
      }
      break;
    }
    await hooks.afterFirestore?.();
    return result;
  } };
  const realtime = { ref: (value) => ({ get: async () => {
    assert.equal(inTransaction, false);
    calls.publicReads += 1;
    return { val: () => structuredClone(live.get(value) ?? null) };
  }, transaction: async (callback) => {
    assert.equal(inTransaction, false, "RTDB effects must be outside retryable Firestore callbacks");
    await hooks.beforeRealtime?.();
    const next = callback(structuredClone(live.get(value) ?? null));
    if (next !== undefined) { live.set(value, structuredClone(next)); calls.realtimeWrites += 1; }
    return { committed: next !== undefined };
  } }) };
  return { firestore, realtime, records, live, calls, hooks };
}

test("showcase migration is dry-run by default and validates the explicit project URL", () => {
  assert.equal(parseArguments(["--project", "gazostadium"]).apply, false);
  assert.equal(parseArguments(["--project", "gazostadium", "--apply"]).apply, true);
  assert.throws(() => parseArguments([]), /explicit --project/);
  for (const url of ["https://other-default-rtdb.firebaseio.com", "https://gazostadium-default-rtdb.evil.example",
    "https://gazostadium-default-rtdb.firebaseio.com/child", "https://secret@gazostadium-default-rtdb.firebaseio.com"])
    assert.throws(() => parseArguments(["--project", "gazostadium", "--database-url", url]), /selected project/);
  assert.throws(() => parseArguments(["--project", "gazostadium", "--force"]), /Unknown/);
});

test("migration executes the runtime normalizer for signature, identity, and theme validation", () => {
  const normalize = loadProfileNormalizer();
  const normalized = normalize(profile({ crownSignatureId: "not-earned-signature", crownTheme: "invalid",
    rateFloorEntryId: "overall-public-id", name: "   A\nB   ", rating: 1 }));
  assert.equal(normalized.crownSignatureId, undefined);
  assert.equal(normalized.crownTheme, "rose");
  assert.equal(normalized.rateFloorEntryId, "");
  assert.equal(normalized.name, "A B");
  assert.equal(normalized.rating, 100);
});

test("dry-run counts existing eligible rows without any source or public writes", async () => {
  const state = fixture();
  const original = structuredClone([...state.records]);
  const progress = [];
  const report = await migrate({ ...state, onProgress: (value) => progress.push(value) });
  assert.equal(report.planned, 1);
  assert.equal(report.updated, 0);
  assert.equal(state.calls.firestoreWrites.length, 0);
  assert.equal(state.calls.realtimeWrites, 0);
  assert.deepEqual([...state.records], original);
  assert.deepEqual(state.live.get(PUBLIC_PATH), publicRow());
  assert.doesNotMatch(JSON.stringify(report), /PLAYER|overall-private-link|stale/);
  assert.ok(progress.some((value) => value.stage === "firestore-page-read"));
  assert.ok(progress.some((value) => value.stage === "profile-transaction"));
  assert.doesNotMatch(JSON.stringify(progress), /player|PLAYER|overall-private-link|stale/);
});

test("bounded waits identify the stalled stage without exposing its input", async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), "cleanup-firestore", 10), (error) => {
    assert.equal(error.code, "deadline-exceeded");
    assert.equal(error.stage, "cleanup-firestore");
    return true;
  });
  assert.equal(await withDeadline(Promise.resolve("complete"), "firestore-page-read", 1000), "complete");
});

test("apply derives private publication choices from current achievements and preserves the ranking source", async () => {
  const state = fixture();
  const before = structuredClone(state.records.get(PROFILE_PATH));
  const report = await migrate({ ...state, apply: true });
  assert.equal(report.updated, 1);
  assert.deepEqual(state.live.get(PUBLIC_PATH), publicRow({ syncRevision: 9,
    crownTheme: "rose", crownSignatureId: CROWN_SIGNATURE_IDS[0], achievementShowcase: AUTO }));
  assert.deepEqual(state.records.get(PROFILE_PATH), { ...before, rateFloorRevision: 9, achievementShowcase: AUTO });
  assert.deepEqual(Object.keys(state.calls.firestoreWrites[0].value).sort(), ["achievementShowcase", "rateFloorRevision"]);
  assert.equal(state.live.get(PUBLIC_PATH).entryId, undefined);
  const again = await migrate({ ...state, apply: true });
  assert.equal(again.unchanged, 1);
  assert.equal(state.calls.realtimeWrites, 1, "repeat is idempotent");
  const delayed = serverRateFloorMirrorDecision(state.live.get(PUBLIC_PATH), { publicEntry: publicRow(), revision: 8 });
  assert.equal(delayed.committed, false, "pre-migration backend delivery cannot remove decoration");
});

test("explicit private achievement selection is shown, and stale selection is cleared", async () => {
  const state = fixture({ achievements: { player: { unlocked: { [PRIVATE]: 100 }, customShowcase: [PRIVATE] } } });
  await migrate({ ...state, apply: true });
  assert.equal(state.live.get(PUBLIC_PATH).achievementShowcase, PRIVATE);
  state.records.set("achievementProfiles/player", { unlocked: { [PRIVATE]: 100 }, customShowcase: [] });
  await migrate({ ...state, apply: true });
  assert.equal(state.live.get(PUBLIC_PATH).achievementShowcase, undefined);
  assert.equal(state.records.get(PROFILE_PATH).achievementShowcase, "");
});

test("migration excludes absent, hidden, invalid-ID, unconsenting, and unqualified entries", async () => {
  for (const overrides of [{ enabled: false }, { rateFloorEnabled: false }, { serverMatches: 9 },
    { rateFloorEntryId: "different-overall-id" }, { entryId: "" }]) {
    const state = fixture({ profiles: { player: profile(overrides) } });
    await migrate({ ...state, apply: true });
    assert.equal(state.calls.firestoreWrites.length + state.calls.realtimeWrites, 0);
  }
  for (const row of [null, publicRow({ rateFloorHidden: true }), publicRow({ serverVerified: false }),
    publicRow({ serverMatches: 9 }), publicRow({ rating: 3001 })]) {
    const state = fixture({ rows: { [PUBLIC_PATH]: row } });
    await migrate({ ...state, apply: true });
    assert.equal(state.calls.firestoreWrites.length + state.calls.realtimeWrites, 0);
    assert.deepEqual(state.live.get(PUBLIC_PATH), row);
  }
});

test("fresh Firestore reads reject opt-out, changed row ID, and source disappearance", async () => {
  for (const replacement of [null, profile({ rateFloorEnabled: false }), profile({ rateFloorEntryId: "X".repeat(24) })]) {
    const state = fixture();
    state.hooks.beforeFirestore = () => replacement
      ? state.records.set(PROFILE_PATH, replacement) : state.records.delete(PROFILE_PATH);
    const report = await migrate({ ...state, apply: true });
    assert.equal(report.raced, 1);
    assert.equal(state.calls.firestoreWrites.length + state.calls.realtimeWrites, 0);
  }
});

test("Firestore retry recomputes latest achievements and score without RTDB side effects", async () => {
  const state = fixture();
  state.hooks.retryFirestore = () => {
    state.records.set(PROFILE_PATH, profile({ rateFloorRevision: 9, rating: 320, serverMatches: 13 }));
    state.records.set("achievementProfiles/player", { unlocked: { [PRIVATE]: 100 }, customShowcase: [PRIVATE] });
  };
  await migrate({ ...state, apply: true });
  assert.equal(state.calls.transactionAttempts, 2);
  assert.equal(state.calls.firestoreWrites.length, 1);
  assert.equal(state.calls.realtimeWrites, 1);
  assert.equal(state.live.get(PUBLIC_PATH).achievementShowcase, PRIVATE);
  assert.equal(state.live.get(PUBLIC_PATH).rating, 320);
  assert.equal(state.live.get(PUBLIC_PATH).serverMatches, 13);
  assert.equal(state.live.get(PUBLIC_PATH).syncRevision, 10);
});

test("CAS never revives a deletion or tombstone and never replaces a newer revision", async () => {
  for (const replacement of [null, publicRow({ rateFloorHidden: true, syncRevision: 10 }),
    publicRow({ syncRevision: 10, crownTheme: "newer-theme", achievementShowcase: "newer-selection" })]) {
    const state = fixture();
    state.hooks.beforeRealtime = () => state.live.set(PUBLIC_PATH, replacement);
    const report = await migrate({ ...state, apply: true });
    assert.equal(report.raced, 1);
    assert.equal(report.updated, 0);
    assert.deepEqual(state.live.get(PUBLIC_PATH), replacement);
  }
});

test("migration can safely resume after the source revision commits but RTDB fails", async () => {
  const state = fixture();
  state.hooks.beforeRealtime = () => { throw new Error("transport unavailable"); };
  await assert.rejects(migrate({ ...state, apply: true }), /transport unavailable/);
  assert.equal(state.records.get(PROFILE_PATH).rateFloorRevision, 9);
  assert.equal(state.live.get(PUBLIC_PATH).syncRevision, 8);
  delete state.hooks.beforeRealtime;
  const report = await migrate({ ...state, apply: true });
  assert.equal(report.updated, 1);
  assert.equal(state.live.get(PUBLIC_PATH).syncRevision, 10);
  assert.equal(state.live.get(PUBLIC_PATH).achievementShowcase, AUTO);
});

test("pagination counts each profile once and newer public revision remains untouched", async () => {
  const profiles = {}; const rows = {};
  for (let index = 0; index < 5; index += 1) {
    const id = `${index}`.repeat(24);
    profiles[`p${index}`] = profile({ rateFloorEntryId: id });
    rows[`online/serverRateFloorLeaderboard/${id}`] = publicRow({ syncRevision: index === 4 ? 99 : 8 });
  }
  const state = fixture({ profiles, rows });
  const report = await migrate({ ...state, apply: true, pageSize: 2 });
  assert.equal(report.scanned, 5);
  assert.equal(report.updated, 4);
  assert.equal(report.raced, 1);
  assert.deepEqual(state.live.get(`online/serverRateFloorLeaderboard/${"4".repeat(24)}`), publicRow({ syncRevision: 99 }));
});

test("REST ETag conflict retries inspect a newer tombstone and abort without public writes", async () => {
  const state = fixture();
  let row = publicRow(); let version = 1; let puts = 0;
  state.realtime = createMigrationRealtimeRest({ databaseURL: "https://demo-example-default-rtdb.firebaseio.com/",
    getAccessToken: async () => ({ access_token: "test-secret" }),
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).search, "");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      if (options.method === "GET") return { ok: true, status: 200,
        json: async () => structuredClone(row), headers: new Headers({ etag: `"${version}"` }) };
      puts += 1;
      assert.equal(options.headers["If-Match"], '"1"');
      row = publicRow({ rateFloorHidden: true, rating: 3001, serverMatches: 0, syncRevision: 10 });
      version += 1;
      return { status: 412, ok: false };
    },
  });
  const report = await migrate({ ...state, apply: true });
  assert.equal(report.raced, 1);
  assert.equal(puts, 1);
  assert.equal(row.rateFloorHidden, true);
  assert.equal(row.achievementShowcase, undefined);
});
