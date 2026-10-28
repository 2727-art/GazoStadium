const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const core = import("../../auth-session-core.mjs");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function harness({ user = null, record, memory = new Map(), ready, configure, signIn, withLock } = {}) {
  const { createAuthSessionController, AUTH_SESSION_RECORD_KEY: key } = await core;
  if (record) memory.set(key, JSON.stringify(record));
  const calls = { create: 0, configure: 0 };
  const auth = { currentUser: user, authStateReady: ready || (async () => {}) };
  const storage = {
    getItem: (name) => memory.get(name) ?? null,
    setItem: (name, value) => memory.set(name, value),
  };
  const controller = createAuthSessionController({
    auth, storage: () => storage,
    configurePersistence: async () => { calls.configure++; await configure?.(); },
    signInAnonymous: async () => {
      calls.create++;
      const result = signIn ? await signIn(auth) : { user: { uid: "new-guest", isAnonymous: true } };
      auth.currentUser = result.user;
      return result;
    },
    withLock,
  });
  return { auth, storage, controller, calls, memory, key, record: () => JSON.parse(memory.get(key) || "null") };
}

for (const user of [
  { uid: "old-anonymous", isAnonymous: true },
  { uid: "old-google", isAnonymous: false, providerData: [{ providerId: "google.com" }] },
  { uid: "old-transferred", isAnonymous: false, providerData: [] },
]) {
  test(`delayed restoration preserves legacy ${user.uid} without creating a user`, async () => {
    const wait = deferred();
    const h = await harness({ ready: () => wait.promise });
    const request = h.controller.ensureUser();
    await Promise.resolve();
    assert.equal(h.calls.create, 0);
    assert.equal(h.calls.configure, 0);
    h.auth.currentUser = user;
    wait.resolve();
    assert.equal(await request, user);
    assert.equal(h.record().uid, user.uid);
    assert.equal(h.calls.create, 0);
  });
}

test("concurrent first-use requests share exactly one identity and persist no credential", async () => {
  const wait = deferred();
  const h = await harness({ signIn: async () => { await wait.promise; return { user: { uid: "one", refreshToken: "never-store-this" } }; } });
  const requests = Array.from({ length: 20 }, () => h.controller.ensureUser());
  wait.resolve();
  const users = await Promise.all(requests);
  assert.equal(h.calls.create, 1);
  assert.ok(users.every((user) => user.uid === "one"));
  assert.doesNotMatch(h.memory.get(h.key), /refreshToken|never-store-this/);
});

test("known but missing identity is never silently replaced across retries or reloads", async () => {
  const h = await harness({ record: { version: 1, uid: "previous" } });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(h.controller.ensureUser(), { code: "hariai-auth/recovery-required" });
  }
  const reloaded = await harness({ memory: h.memory });
  await assert.rejects(reloaded.controller.ensureUser(), { code: "hariai-auth/recovery-required" });
  assert.equal(h.calls.create + reloaded.calls.create, 0);
  assert.equal(h.record().uid, "previous");
});

test("unexpected UID is blocked without signing out, overwriting the record, or creating an account", async () => {
  const user = { uid: "unexpected" };
  const h = await harness({ user, record: { version: 1, uid: "previous" } });
  await assert.rejects(h.controller.ensureUser(), { code: "hariai-auth/recovery-required" });
  assert.equal(h.auth.currentUser, user);
  assert.equal(h.record().uid, "previous");
  assert.equal(h.calls.create, 0);
});

for (const kind of ["restore", "persistence", "read", "write", "malformed"]) {
  test(`${kind} failure cannot be mistaken for a new visitor`, async () => {
    const failure = () => { throw new Error("unavailable"); };
    const h = await harness({ ready: kind === "restore" ? failure : undefined, configure: kind === "persistence" ? failure : undefined });
    if (kind === "read") h.storage.getItem = failure;
    if (kind === "write") h.storage.setItem = failure;
    if (kind === "malformed") h.memory.set(h.key, "{broken");
    await assert.rejects(h.controller.ensureUser());
    assert.equal(h.calls.create, 0);
  });
}

test("ambiguous anonymous sign-in failure reserves recovery instead of issuing repeated new accounts", async () => {
  const h = await harness({ signIn: async () => { throw new Error("network-request-failed"); } });
  await assert.rejects(h.controller.ensureUser(), /network-request-failed/);
  await assert.rejects(h.controller.ensureUser(), { code: "hariai-auth/recovery-required" });
  assert.equal(h.calls.create, 1);
  assert.equal(h.record().pending, true);
  // SDK may restore the user from the original successful-but-interrupted request.
  h.auth.currentUser = { uid: "original-request-user" };
  assert.equal((await h.controller.ensureUser()).uid, "original-request-user");
  assert.equal(h.record().pending, undefined);
});

test("deliberate recovery creates a pristine guest while retaining the former UID as a hint", async () => {
  const h = await harness({ record: { version: 1, uid: "old" } });
  await assert.rejects(h.controller.ensureUser());
  assert.equal((await h.controller.ensureUser({ explicitNewGuest: true })).uid, "new-guest");
  assert.equal(h.record().previousUid, "old");
  assert.equal(h.calls.create, 1);
});

test("Google popup starts synchronously, linking preserves UID, and cancellation preserves the record", async () => {
  const user = { uid: "guest", isAnonymous: true };
  const h = await harness({ user });
  await h.controller.ensureUser();
  let popupOpened = false;
  const link = h.controller.runAccountTransition(() => {
    popupOpened = true;
    user.isAnonymous = false;
    user.providerData = [{ providerId: "google.com" }];
    return Promise.resolve({ user });
  });
  assert.equal(popupOpened, true, "do not lose browser click activation before opening Google");
  await link;
  const before = h.memory.get(h.key);
  await assert.rejects(h.controller.runAccountTransition(async () => { throw new Error("popup-closed-by-user"); }));
  assert.equal(h.memory.get(h.key), before);
  assert.equal(h.record().uid, "guest");
  assert.equal(h.calls.create, 0);
});

for (const provider of ["existing-Google", "transfer-code"]) {
  test(`${provider} explicitly switches UID and remains usable after reload`, async () => {
    const h = await harness({ user: { uid: "guest" } });
    await h.controller.ensureUser();
    const wait = deferred();
    const switching = h.controller.runAccountTransition(async () => {
      await wait.promise;
      h.auth.currentUser = { uid: provider };
      return { user: h.auth.currentUser };
    });
    const otherMode = h.controller.ensureUser();
    assert.equal(h.record().uid, "guest");
    wait.resolve();
    await switching;
    assert.equal((await otherMode).uid, provider);
    const reloaded = await harness({ user: h.auth.currentUser, memory: h.memory });
    assert.equal((await reloaded.controller.ensureUser()).uid, provider);
    assert.equal(h.calls.create + reloaded.calls.create, 0);
  });
}

test("failed Google collision leaves guest usable until user explicitly selects the existing Google data", async () => {
  const h = await harness({ user: { uid: "guest" } });
  await h.controller.ensureUser();
  await assert.rejects(h.controller.runAccountTransition(async () => { throw new Error("credential-already-in-use"); }));
  assert.equal((await h.controller.ensureUser()).uid, "guest");
  await h.controller.runAccountTransition(async () => {
    h.auth.currentUser = { uid: "saved-google" };
    return { user: h.auth.currentUser };
  });
  assert.equal(h.controller.assertCurrentUser().uid, "saved-google");
});

test("origin lock serializes first-use tabs and a second tab cannot create a competing account", async () => {
  let tail = Promise.resolve();
  const withLock = (operation) => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  const memory = new Map();
  const first = await harness({ memory, withLock });
  const second = await harness({ memory, withLock });
  const results = await Promise.allSettled([first.controller.ensureUser(), second.controller.ensureUser()]);
  assert.equal(first.calls.create + second.calls.create, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  second.auth.currentUser = first.auth.currentUser; // SDK storage-event delivery
  assert.equal((await second.controller.ensureUser()).uid, first.auth.currentUser.uid);
});

test("live identity loss is blocked even if the local history was also removed", async () => {
  const h = await harness({ user: { uid: "old" } });
  await h.controller.ensureUser();
  h.auth.currentUser = null;
  h.memory.clear();
  await assert.rejects(h.controller.ensureUser(), { code: "hariai-auth/recovery-required" });
  assert.equal(h.calls.create, 0);
});

test("all modes use the same guard and only that guard can automatically create a guest", () => {
  const root = path.resolve(__dirname, "../..");
  const modes = ["account", "online", "strategy", "tribute", "stadium", "roulette-training", "ai-text-training", "player-safety", "market", "flea-market", "danwaku-note", "free-table"];
  for (const mode of modes) {
    const source = fs.readFileSync(path.join(root, `${mode}.js`), "utf8");
    assert.match(source, /from "\.\/auth-session\.js\?v=auth-session-v1[^"]*"/);
    assert.doesNotMatch(source, /\bsignInAnonymously\b|\bsetPersistence\b/);
  }
});
