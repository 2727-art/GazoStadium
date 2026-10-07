"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const { ref, set } = require("firebase/database");

const root = path.resolve(__dirname, "..", "..");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const projectId = process.env.STRATEGY_HARIAI_RULES_TEST_PROJECT_ID || "demo-strategy-hariai";
const safeEmulator = /^demo-[a-z0-9-]+$/.test(projectId)
  && /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

const hostUid = "hariai-host";
const guestUid = "hariai-guest";
const otherUid = "hariai-outsider";
const SALT = "a".repeat(32);

test("strategy hariai v3 rules enforce slot ownership, bands, reveals and penalties", {
  skip: safeEmulator ? false : "run inside a loopback Database Emulator with a demo-* project",
}, async (context) => {
  const environment = await initializeTestEnvironment({
    projectId,
    database: { rules: fs.readFileSync(path.join(root, "database.rules.json"), "utf8") },
  });
  context.after(() => environment.cleanup());

  const db = {
    [hostUid]: environment.authenticatedContext(hostUid).database(),
    [guestUid]: environment.authenticatedContext(guestUid).database(),
    [otherUid]: environment.authenticatedContext(otherUid).database(),
  };
  const now = () => Date.now();
  const at = (uid, roomId, sub) => ref(db[uid], `online/strategyRooms/${roomId}/${sub}`);

  async function seedRoom(roomId, extra = {}) {
    const room = {
      status: "active",
      protocolVersion: 3,
      hostUid,
      guestUid,
      members: { [hostUid]: true, [guestUid]: true },
      players: {
        [hostUid]: { penalties: { call: true, tribute: false } },
        [guestUid]: { penalties: { call: true, tribute: true } },
      },
      battleReady: { [hostUid]: true, [guestUid]: true },
      ...extra,
    };
    await environment.withSecurityRulesDisabled(async (admin) => {
      await set(ref(admin.database(), `online/strategyRooms/${roomId}`), room);
    });
  }

  const post = (by, overrides = {}) => ({ by, target: 1, caption: "ここ、好きでしょ？♡", lockedAt: now(), ...overrides });

  await context.test("a slot accepts one action from its owner only", async () => {
    const roomId = "hariai-slot-owner";
    await seedRoom(roomId);
    await assertFails(set(at(guestUid, roomId, "moves/1/post"), post(hostUid)));
    await assertFails(set(at(otherUid, roomId, "moves/1/post"), post(otherUid)));
    await assertFails(set(at(hostUid, roomId, "moves/1/post"), post(hostUid, { caption: "" })));
    await assertFails(set(at(hostUid, roomId, "moves/1/post"), post(hostUid, { target: 3 })));
    await assertFails(set(at(hostUid, roomId, "moves/31/post"), post(hostUid)));
    await assertSucceeds(set(at(hostUid, roomId, "moves/1/post"), post(hostUid)));
    await assertFails(set(at(hostUid, roomId, "moves/1/post"), post(hostUid, { caption: "上書き" })));
    await assertFails(set(at(hostUid, roomId, "moves/1/surrender"), { by: hostUid, lockedAt: now() }));
    await assertFails(set(at(hostUid, roomId, "moves/1/break"), { by: hostUid, guess: 0, lockedAt: now() }));
  });

  await context.test("battle and scout chat accept known line effects only, never on stamps", async () => {
    const roomId = "hariai-chat-effect";
    await seedRoom(roomId);
    const chat = (uid, id) => ref(db[uid], `online/strategyChats/${roomId}/${id}`);
    const message = (extra = {}) => ({ authorUid: hostUid, text: "その目線、ずるくない？", phase: "battle", round: 2, createdAt: now(), ...extra });
    await assertSucceeds(set(chat(hostUid, "effect-hearts"), message({ effect: "hearts" })));
    await assertSucceeds(set(chat(hostUid, "scout-whisper"), message({ phase: "scout", round: 1, effect: "whisper" })));
    await assertSucceeds(set(chat(hostUid, "plain"), message()));
    await assertFails(set(chat(hostUid, "unknown-effect"), message({ effect: "rainbow" })));
    await assertFails(set(chat(hostUid, "number-effect"), message({ effect: 1 })));
    await assertFails(set(chat(hostUid, "stamp-effect"), message({ text: "いいね！", stampId: "stamp_like", effect: "emphasis" })));
    // 口調は部屋のプレイヤー情報から決まるので、チャットに口調の項目は持たせない。
    await assertFails(set(chat(hostUid, "persona-field"), message({ voiceSetId: "koakuma" })));
  });

  await context.test("the battle must be ready and open", async () => {
    const roomId = "hariai-not-ready";
    await seedRoom(roomId, { battleReady: { [hostUid]: true } });
    await assertFails(set(at(hostUid, roomId, "moves/1/post"), post(hostUid)));
    const finishedRoom = "hariai-finished";
    await seedRoom(finishedRoom, { finished: { [hostUid]: true } });
    await assertFails(set(at(hostUid, finishedRoom, "moves/1/post"), post(hostUid)));
  });

  await context.test("scores are integers from the receiver after receipt", async () => {
    const roomId = "hariai-score";
    await seedRoom(roomId, { moves: { 1: { post: post(hostUid) } } });
    const score = (value, extra = {}) => ({ by: guestUid, value, lockedAt: now(), ...extra });
    await assertFails(set(at(guestUid, roomId, "moves/1/score"), score(80)));
    await assertFails(set(at(hostUid, roomId, `moves/1/received/${hostUid}`), true));
    await assertSucceeds(set(at(guestUid, roomId, `moves/1/received/${guestUid}`), true));
    await assertFails(set(at(hostUid, roomId, "moves/1/score"), { ...score(80), by: hostUid }));
    await assertFails(set(at(guestUid, roomId, "moves/1/score"), score(85.5)));
    await assertFails(set(at(guestUid, roomId, "moves/1/score"), score(101)));
    await assertFails(set(at(guestUid, roomId, "moves/1/score"), score(90, { reply: "x".repeat(41) })));
    await assertSucceeds(set(at(guestUid, roomId, "moves/1/score"), score(86, { reply: "…ずるい♡" })));
    await assertFails(set(at(guestUid, roomId, "moves/1/score"), score(10)));
  });

  async function scoredRoom(roomId, value) {
    await seedRoom(roomId, {
      moves: { 1: { post: post(hostUid), received: { [guestUid]: true }, score: { by: guestUid, value, lockedAt: now() } } },
    });
  }
  const right = (extra) => ({ by: hostUid, lockedAt: now(), ...extra });

  await context.test("rights must match the score band", async () => {
    await scoredRoom("hariai-band-82", 82);
    await assertFails(set(at(hostUid, "hariai-band-82", "moves/1/right"), right({ kind: "instruction", id: "heart" })));
    await assertFails(set(at(guestUid, "hariai-band-82", "moves/1/right"), { ...right({ kind: "question", id: "spot" }), by: guestUid }));
    await assertSucceeds(set(at(hostUid, "hariai-band-82", "moves/1/right"), right({ kind: "question", id: "spot", flavor: "教えて♡" })));

    await scoredRoom("hariai-band-87", 87);
    await assertFails(set(at(hostUid, "hariai-band-87", "moves/1/right"), right({ kind: "question", id: "spot" })));
    await assertFails(set(at(hostUid, "hariai-band-87", "moves/1/right"), right({ kind: "instruction", id: "call", param: "king" })));
    await assertSucceeds(set(at(hostUid, "hariai-band-87", "moves/1/right"), right({ kind: "instruction", id: "call", param: "oneesama" })));

    await scoredRoom("hariai-band-95", 95);
    await assertFails(set(at(hostUid, "hariai-band-95", "moves/1/right"), right({ kind: "question", id: "which", a: 1, b: 1 })));
    await assertSucceeds(set(at(hostUid, "hariai-band-95", "moves/1/right"), right({ kind: "question", id: "which", a: 0, b: 2 })));

    await scoredRoom("hariai-band-60", 60);
    await assertFails(set(at(hostUid, "hariai-band-60", "moves/1/right"), right({ kind: "none" })));
  });

  await context.test("answers come from the receiver and deny needs a salt", async () => {
    const roomId = "hariai-deny";
    await seedRoom(roomId, {
      moves: { 1: {
        post: post(hostUid),
        received: { [guestUid]: true },
        score: { by: guestUid, value: 88, lockedAt: now() },
        right: right({ kind: "instruction", id: "deny" }),
      } },
    });
    await assertFails(set(at(hostUid, roomId, "moves/1/answer"), { by: hostUid, candidate: 2, salt: SALT, lockedAt: now() }));
    await assertFails(set(at(guestUid, roomId, "moves/1/answer"), { by: guestUid, candidate: 2, lockedAt: now() }));
    await assertFails(set(at(guestUid, roomId, "moves/1/answer"), { by: guestUid, candidate: 2, salt: "xyz", lockedAt: now() }));
    await assertSucceeds(set(at(guestUid, roomId, "moves/1/answer"), { by: guestUid, candidate: 2, salt: SALT, lockedAt: now() }));
  });

  await context.test("break reveals match the guess and finishes need a hit", async () => {
    const roomId = "hariai-break";
    await seedRoom(roomId, { moves: { 5: { break: { by: hostUid, guess: 1, lockedAt: now() } } } });
    const reveal = (index, bit) => ({ by: guestUid, index, bit, salt: SALT, revealedAt: now() });
    await assertFails(set(at(hostUid, roomId, "moves/5/breakReveal"), { ...reveal(1, 1), by: hostUid }));
    await assertFails(set(at(guestUid, roomId, "moves/5/breakReveal"), reveal(2, 1)));
    await assertFails(set(at(hostUid, roomId, "moves/5/finish"), { by: hostUid, count: 1, captions: { 0: "ほら♡" }, lockedAt: now() }));
    await assertSucceeds(set(at(guestUid, roomId, "moves/5/breakReveal"), reveal(1, 1)));
    await assertFails(set(at(guestUid, roomId, "moves/5/finish"), { by: guestUid, count: 0, lockedAt: now() }));
    await assertFails(set(at(hostUid, roomId, "moves/5/finish"), { by: hostUid, count: 2, captions: { 0: "ほら♡" }, lockedAt: now() }));
    await assertFails(set(at(hostUid, roomId, "moves/5/finish"), { by: hostUid, count: 4, captions: { 0: "a", 1: "b", 2: "c", 3: "d" }, lockedAt: now() }));
    await assertSucceeds(set(at(hostUid, roomId, "moves/5/finish"), { by: hostUid, count: 2, captions: { 0: "ほら♡", 1: "ばれてるよ♡" }, lockedAt: now() }));
    await assertFails(set(at(hostUid, roomId, "moves/5/finishReceived/0"), true));
    await assertSucceeds(set(at(guestUid, roomId, "moves/5/finishReceived/1"), true));
    await assertFails(set(at(guestUid, roomId, "moves/5/finishReceived/2"), true));
  });

  await context.test("final reveals open all salts and gate the result claim", async () => {
    const roomId = "hariai-final";
    await seedRoom(roomId);
    const finalReveal = (salts) => ({ weaknessIndex: 1, salts, revealedAt: now() });
    await assertFails(set(at(hostUid, roomId, `weaknessReveals/${hostUid}`), finalReveal({ 0: SALT, 1: SALT })));
    await assertFails(set(at(guestUid, roomId, `weaknessReveals/${hostUid}`), finalReveal({ 0: SALT, 1: SALT, 2: SALT })));
    await assertFails(set(at(hostUid, roomId, `resultClaims/${hostUid}`), { outcome: "win", createdAt: now() }));
    await assertSucceeds(set(at(hostUid, roomId, `weaknessReveals/${hostUid}`), finalReveal({ 0: SALT, 1: SALT, 2: SALT })));
    await assertSucceeds(set(at(guestUid, roomId, `weaknessReveals/${guestUid}`), finalReveal({ 0: SALT, 1: SALT, 2: SALT })));
  });

  await context.test("penalties need mutual consent, the winner chooses and the loser completes", async () => {
    const roomId = "hariai-penalty";
    await seedRoom(roomId, {
      finished: { [hostUid]: true, [guestUid]: true },
      resultClaims: { [hostUid]: { outcome: "win", createdAt: now() }, [guestUid]: { outcome: "loss", createdAt: now() } },
    });
    await assertFails(set(at(guestUid, roomId, "penalty"), { by: guestUid, kind: "declare", at: now() }));
    await assertFails(set(at(hostUid, roomId, "penalty"), { by: hostUid, kind: "tribute", at: now() }));
    await assertFails(set(at(hostUid, roomId, "penalty"), { by: hostUid, kind: "call", at: now() }));
    await assertFails(set(at(guestUid, roomId, `penaltyDone/${guestUid}`), { kind: "call", at: now() }));
    await assertSucceeds(set(at(hostUid, roomId, "penalty"), { by: hostUid, kind: "call", honorific: "senpai", at: now() }));
    await assertFails(set(at(hostUid, roomId, `penaltyDone/${hostUid}`), { kind: "call", at: now() }));
    await assertFails(set(at(guestUid, roomId, `penaltyDone/${guestUid}`), { kind: "declare", at: now() }));
    await assertSucceeds(set(at(guestUid, roomId, `penaltyDone/${guestUid}`), { kind: "call", at: now() }));
  });

  await context.test("queues accept only protocol 3 states", async () => {
    const queueRef = ref(db[hostUid], `online/strategyQueue/${hostUid}`);
    const row = { uid: hostUid, joinedAt: now(), lastSeen: now() };
    await assertFails(set(queueRef, { ...row, state: "waiting-v2", protocolVersion: 2 }));
    await assertFails(set(queueRef, { ...row, state: "waiting-v3", protocolVersion: 2 }));
    await assertSucceeds(set(queueRef, { ...row, state: "waiting-v3", protocolVersion: 3 }));
  });

  assert.ok(true);
});
