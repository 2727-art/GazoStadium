"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSoloHostedOfferRuntime, turn } = require("./helpers/solo-hosted-offer-runtime");
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const safeEmulator = /^(?:127\.0\.0\.1|localhost):\d+$/.test(emulatorHost);

test("hosted solo offers recover with real SDK permission errors and deployed-equivalent rules", {
  skip: safeEmulator ? false : "requires a loopback Realtime Database Emulator",
  timeout: 30000,
}, async t => {
  const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
  const { ref, get, set, update, onValue } = require("firebase/database");
  const env = await initializeTestEnvironment({ projectId: "demo-solo-offer-recovery",
    database: { rules: fs.readFileSync(path.resolve(__dirname, "../../database.rules.json"), "utf8") } });
  t.after(() => env.cleanup());
  const roomId = "-AbCdEfGhIjKlMnOpQrS";
  const database = env.authenticatedContext("host").database();
  const patch = values => env.withSecurityRulesDisabled(ctx => update(ref(ctx.database()), values));
  const waitUntil = async predicate => {
    const deadline = Date.now() + 4000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error("Timed out waiting for local offer recovery");
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  };
  async function seed() {
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database()), { online: {
      config: { playerSafetyEnabled: true },
      rooms: { [roomId]: { hostUid: "host", guestUid: "guest", status: "offered",
        protocolVersion: 2, safetyPairId: "pair", safetyGrantId: "grant", safetyVersion: 0 } },
      contactGates: { pair: { initialized: true, blocked: false, version: 0,
        participants: { host: true, guest: true }, grants: { grant: {
          roomId, mode: "solo", firstUid: "host", secondUid: "guest", active: false,
          expiresAt: Date.now() + 120000,
        } } } },
    } }));
    assert.equal((await get(ref(database, `online/rooms/${roomId}/status`))).val(), "offered");
  }

  for (const trigger of ["deleted-room", "revoked-grant", "blocked-pair"]) {
    await t.test(`${trigger} stops polling and resumes only after server confirmation`, async () => {
      await seed();
      let observed = false;
      const f = createSoloHostedOfferRuntime({ database, ref, get,
        onValue: (target, onData, onError) => onValue(target, snapshot => { observed = true; onData(snapshot); }, onError) });
      f.offer(roomId);
      try {
        await waitUntil(() => observed);
        const location = trigger === "deleted-room" ? `online/rooms/${roomId}`
          : trigger === "revoked-grant" ? "online/contactGates/pair/grants/grant" : "online/contactGates/pair/blocked";
        await patch({ [location]: trigger === "blocked-pair" ? true : null });
        await waitUntil(() => f.state.pendingOffer === null);
        assert.equal(f.calls.length, 1);
        assert.equal(f.searches.length, 1);
        assert.equal(f.timers.size, 0);
        assert.equal(f.intervals.size, 0);
        assert.deepEqual(f.toasts, []);
        await assertFails(get(ref(database, `online/rooms/${roomId}/status`)));
        await assertFails(get(ref(env.authenticatedContext("stranger").database(), `online/rooms/${roomId}`)));
      } finally { await f.context.cleanupMatchmaking(false, f.state); }
    });
  }

  for (const response of ["transient-error", "transition-busy"]) {
    await t.test(`the reported ${response} then deleted-room sequence recovers on the next retry`, async () => {
      await seed();
      const f = createSoloHostedOfferRuntime({ database, ref, get, onValue });
      f.offer(roomId);
      f.hooks.server = async () => {
        if (f.calls.length === 1) {
          if (response === "transient-error") throw Error("temporary transport failure");
          return { status: "offered", reason: "transition-busy" };
        }
        return { status: "", reason: "not-owner" };
      };
      try {
        f.fireTimer();
        await turn();
        assert.equal(f.timers.size, 1);
        assert.equal(f.intervals.size, 0);
        await patch({ [`online/rooms/${roomId}`]: null });
        await assertFails(get(ref(database, `online/rooms/${roomId}/status`)));
        f.fireTimer();
        await turn();
        assert.equal(f.state.pendingOffer, null);
        assert.equal(f.calls.length, 2);
        assert.equal(f.searches.length, 1);
        assert.equal(f.timers.size, 0);
      } finally { await f.context.cleanupMatchmaking(false, f.state); }
    });
  }
});
