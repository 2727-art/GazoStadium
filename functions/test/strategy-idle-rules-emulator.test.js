"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const requested = process.env.RUN_STRATEGY_IDLE_RULES_EMULATOR_TESTS === "1";
const PROJECT_ID = "demo-strategy-idle-rules";
const HOST = "idle-rules-host";
const GUEST = "idle-rules-guest";
const OTHER = "idle-rules-outsider";
const PAIR = "idle-rules-pair";
const roomId = (letter) => letter.repeat(20);

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

test("strategy idle deadline rules and authenticated start-versus-expiry races", {
  skip: requested ? false : "set RUN_STRATEGY_IDLE_RULES_EMULATOR_TESTS=1 inside a loopback Database Emulator",
  timeout: 120_000,
}, async (t) => {
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
  assert.match(emulatorHost, /^(?:127\.0\.0\.1|localhost):\d+$/, "refuse every non-loopback database");
  assert.match(PROJECT_ID, /^demo-/, "destructive fixtures must remain in an isolated demo namespace");
  const [host, port] = emulatorHost.split(":");
  const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
  const { initializeApp, deleteApp } = require("firebase-admin/app");
  const { getDatabase } = require("firebase-admin/database");
  const { ref, get, set, update, remove, onDisconnect } = require("firebase/database");
  const { createPlayerSafetyStrategy } = require("../player-safety-strategy");
  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      host, port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8"),
    },
  });
  const app = initializeApp({
    projectId: PROJECT_ID,
    databaseURL: `http://${emulatorHost}?ns=${PROJECT_ID}`,
  }, `${PROJECT_ID}-${Date.now()}`);
  const realtime = getDatabase(app);
  t.after(async () => { await environment.cleanup(); await deleteApp(app); });
  const databases = Object.fromEntries([HOST, GUEST, OTHER].map((uid) => [uid, environment.authenticatedContext(uid).database()]));
  const anonymous = environment.unauthenticatedContext().database();
  const target = (uid, id, child = "") => ref(databases[uid], `online/strategyRooms/${id}${child ? `/${child}` : ""}`);
  const value = async (key) => (await realtime.ref(key).get()).val();
  const roomValue = (id) => value(`online/strategyRooms/${id}`);
  let serverNow = Date.now();
  const playerSafety = {
    checkContact: async () => true,
    revokeContact: async (args) => realtime.ref(`online/contactGates/${args.safetyPairId}/grants/${args.safetyGrantId}`).remove(),
  };
  const service = createPlayerSafetyStrategy({ realtime, HttpsError, playerSafety, now: () => serverNow });

  async function seed(id, extra = {}, { safetyEnabled = true } = {}) {
    const at = Date.now();
    const room = {
      hostUid: HOST, guestUid: GUEST, protocolVersion: 3, status: "active", createdAt: at - 1_000,
      members: { [HOST]: true, [GUEST]: true },
      players: { [HOST]: { uid: HOST }, [GUEST]: { uid: GUEST } },
      queueJoinedAt: { [HOST]: at - 2_000, [GUEST]: at - 2_000 },
      safetyPairId: PAIR, safetyGrantId: id, safetyVersion: 0,
      prestartDeadlineAt: at + 60_000,
      ...extra,
    };
    if (room.prestartDeadlineAt === undefined) delete room.prestartDeadlineAt;
    serverNow = at;
    await realtime.ref("online").set({
      config: { playerSafetyEnabled: safetyEnabled },
      strategyRooms: { [id]: room },
      strategyActive: { [HOST]: id, [GUEST]: id },
      contactGates: { [PAIR]: {
        initialized: true, blocked: false, version: 0, participants: { [HOST]: true, [GUEST]: true },
        grants: { [id]: { roomId: id, mode: "strategy", firstUid: HOST, secondUid: GUEST, active: true, createdAt: at, expiresAt: at + 300_000 } },
      } },
      ...(Number.isFinite(room.prestartDeadlineAt) ? {
        strategyPrestartExpirations: { [id]: {
          expiresAt: room.prestartDeadlineAt, hostUid: HOST, guestUid: GUEST, safetyGrantId: id,
        } },
      } : {}),
    });
    return room;
  }

  await t.test("a ready write committed first protects the real room transaction even beyond its deadline", async () => {
    const id = roomId("A");
    const room = await seed(id, { battleReady: { [HOST]: true } });
    await assertSucceeds(set(target(GUEST, id, `battleReady/${GUEST}`), true));
    serverNow = room.prestartDeadlineAt + 1;
    await service.expirePrestart(HOST, { protocolVersion: 3, roomId: id });
    const stored = await roomValue(id);
    assert.equal(stored.status, "active");
    assert.equal(stored.destroyed, undefined);
    assert.equal(stored.battleReady[HOST], true);
    assert.equal(stored.battleReady[GUEST], true);
    assert.equal(await value(`online/strategyActive/${HOST}`), id);
  });

  await t.test("an expiry committed first rejects an old client's late ready write", async () => {
    const id = roomId("B");
    const room = await seed(id, { battleReady: { [HOST]: true } });
    serverNow = room.prestartDeadlineAt + 1;
    await service.expirePrestart(HOST, { protocolVersion: 3, roomId: id });
    await assertFails(set(target(GUEST, id, `battleReady/${GUEST}`), true));
    const stored = await roomValue(id);
    assert.equal(stored.status, "expired");
    assert.equal(stored.destroyed.reason, "prestart-timeout");
    assert.notEqual(stored.battleReady?.[GUEST], true);
  });

  await t.test("simultaneous authenticated ready writes and server expiry never yield started-and-expired", async () => {
    for (const letter of ["C", "D", "E", "F"]) {
      const id = roomId(letter);
      const room = await seed(id, { battleReady: { [HOST]: true } });
      serverNow = room.prestartDeadlineAt + 1;
      const [started, expired] = await Promise.allSettled([
        set(target(GUEST, id, `battleReady/${GUEST}`), true),
        service.expirePrestart(HOST, { protocolVersion: 3, roomId: id }),
      ]);
      assert.equal(expired.status, "fulfilled");
      const stored = await roomValue(id);
      if (started.status === "fulfilled") {
        assert.equal(stored.status, "active");
        assert.equal(stored.destroyed, undefined);
        assert.equal(stored.battleReady[GUEST], true);
      } else {
        assert.match(String(started.reason?.code || started.reason), /permission/i);
        assert.equal(stored.status, "expired");
        assert.notEqual(stored.battleReady?.[GUEST], true);
      }
      assert.equal(Boolean(stored.destroyed && stored.battleReady?.[HOST] && stored.battleReady?.[GUEST]), false);
    }
  });

  await t.test("the rules reject deadline-passed and terminal starts even before grant revocation", async () => {
    for (const safetyEnabled of [false, true]) {
      for (const [letter, extra] of [
        ["G", { prestartDeadlineAt: Date.now() - 10_000 }],
        ["H", { status: "expired" }],
        ["I", { destroyed: { by: HOST, at: Date.now(), reason: "prestart-timeout" } }],
      ]) {
        const id = roomId(letter);
        await seed(id, extra, { safetyEnabled });
        await assertFails(set(target(HOST, id, `battleReady/${HOST}`), true));
        assert.equal((await roomValue(id)).battleReady, undefined);
      }
    }
  });

  await t.test("deadline-less existing rooms retain start compatibility and outsider rejection", async () => {
    const id = roomId("J");
    await seed(id, { prestartDeadlineAt: undefined });
    await assertFails(set(target(OTHER, id, `battleReady/${OTHER}`), true));
    await assertSucceeds(set(target(HOST, id, `battleReady/${HOST}`), true));
    await assertSucceeds(set(target(GUEST, id, `battleReady/${GUEST}`), true));
    serverNow += 3600_000;
    await service.expirePrestart(HOST, { protocolVersion: 3, roomId: id });
    const stored = await roomValue(id);
    assert.equal(stored.status, "active");
    assert.equal(stored.prestartDeadlineAt, undefined);
    assert.equal(stored.destroyed, undefined);
  });

  await t.test("clients cannot remove, replace, extend, or inject server deadline metadata", async () => {
    const id = roomId("K");
    const room = await seed(id);
    const deadline = target(HOST, id, "prestartDeadlineAt");
    for (const replacement of [null, room.prestartDeadlineAt + 300_000, "never", { expiresAt: room.prestartDeadlineAt }]) {
      await assertFails(set(deadline, replacement));
    }
    await assertFails(remove(deadline));
    await assertFails(set(target(HOST, id), { ...room, prestartDeadlineAt: room.prestartDeadlineAt + 300_000 }));
    await assertFails(remove(target(HOST, id)));
    await assertFails(update(target(HOST, id), { prestartDeadlineAt: null, [`battleReady/${HOST}`]: true }));
    await assertFails(update(ref(databases[HOST], "online"), {
      [`strategyRooms/${id}/prestartDeadlineAt`]: null,
      [`strategyRooms/${id}/battleReady/${HOST}`]: true,
    }));
    const stored = await roomValue(id);
    assert.equal(stored.prestartDeadlineAt, room.prestartDeadlineAt);
    assert.equal(stored.battleReady, undefined, "a denied multi-path update is atomic");
    const legacy = roomId("L");
    await seed(legacy, { prestartDeadlineAt: undefined });
    await assertFails(set(target(HOST, legacy, "prestartDeadlineAt"), Date.now() + 300_000));
  });

  await t.test("private expiration index is inaccessible at parent, room, and child paths", async () => {
    const id = roomId("M");
    await seed(id);
    for (const database of [...Object.values(databases), anonymous]) {
      for (const key of ["online/strategyPrestartExpirations", `online/strategyPrestartExpirations/${id}`, `online/strategyPrestartExpirations/${id}/expiresAt`]) {
        await assertFails(get(ref(database, key)));
        await assertFails(set(ref(database, key), null));
      }
      await assertFails(set(ref(database, `online/strategyPrestartExpirations/${roomId("N")}`), {
        expiresAt: Date.now() + 300_000, hostUid: HOST, guestUid: GUEST, safetyGrantId: id,
      }));
    }
    assert.ok(await value(`online/strategyPrestartExpirations/${id}`));
  });

  await t.test("own-UID client deletion cannot remove the server search guard", async () => {
    const id = roomId("O");
    await seed(id);
    const guard = `idle:${Date.now() + 60_000}:012345abcdef`;
    const key = `online/strategyActive/${HOST}`;
    await realtime.ref(key).set(guard);
    for (const database of [databases[HOST], databases[GUEST], anonymous]) {
      await assertFails(remove(ref(database, key)));
      await assertFails(set(ref(database, key), null));
      await assertFails(update(ref(database, "online/strategyActive"), { [HOST]: null }));
    }
    await assertFails(onDisconnect(ref(databases[HOST], key)).remove());
    assert.equal(await value(key), guard);
    await realtime.ref(key).set(id);
    await assertSucceeds(remove(ref(databases[HOST], key)), "ordinary owned active deletion remains compatible");
  });
});
