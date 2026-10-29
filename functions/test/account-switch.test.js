const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.resolve(__dirname, "../../account-switch.js"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");

function harness() {
  const current = { uid: "played", providerData: [{ providerId: "google.com" }], getIdToken: async () => "current-token" };
  const older = { uid: "previous", getIdToken: async () => "previous-token" };
  const saved = { currentUser: older, authStateReady: async () => {} };
  const storage = new Map();
  const c = vm.createContext({
    auth: { currentUser: current, app: { options: { projectId: "demo" } } },
    browserLocalPersistence: {}, browserPopupRedirectResolver: {}, inMemoryPersistence: {},
    getApps: () => [], initializeApp: () => ({}), initializeAuth: () => saved,
    runHariaiAccountTransition: operation => operation(),
    updateCurrentUser: async (auth, user) => { auth.currentUser = user; },
    setPersistence: async () => {},
    localStorage: { setItem: (k, v) => storage.set(k, v), getItem: k => storage.get(k), removeItem: k => storage.delete(k) },
  });
  vm.runInContext(source, c);
  return { c, current, older, saved };
}

test("switching preserves the previous authenticated session and does not unlink Google", async () => {
  const { c, current, saved } = harness();
  const target = { uid: "legacy" };
  const result = await c.runSafeAccountSwitch("played", () => c.useSelectedAccount(target));
  assert.equal(result.user.uid, "legacy");
  assert.equal(saved.currentUser, current);
  assert.equal(current.providerData[0].providerId, "google.com");
  assert.equal((await c.getPreviousAccount()).uid, "played");
});

for (const fault of ["storage", "persistence", "backup", "expired-session", "uid-changed"]) {
  test(`${fault} stops switching before authentication changes`, async () => {
    const { c, current, saved } = harness();
    let attempts = 0;
    if (fault === "storage") c.localStorage.setItem = () => { throw Error("blocked"); };
    if (fault === "persistence") c.setPersistence = async () => { throw Error("persistence blocked"); };
    if (fault === "backup") c.updateCurrentUser = async (auth) => { if (auth === saved) throw Error("disk failure"); };
    if (fault === "expired-session") current.getIdToken = async () => { throw Error("revoked"); };
    if (fault === "uid-changed") current.getIdToken = async () => { c.auth.currentUser = { uid: "other-tab" }; return "token"; };
    await assert.rejects(c.runSafeAccountSwitch("played", async () => { attempts++; }));
    assert.equal(attempts, 0);
    assert.equal(c.auth.currentUser.uid, fault === "uid-changed" ? "other-tab" : "played");
  });
}

test("failed sign-in preserves both current and previously saved sessions", async () => {
  const { c, current, older, saved } = harness();
  await assert.rejects(c.runSafeAccountSwitch("played", async () => { throw Error("network"); }), /network/);
  assert.equal(c.auth.currentUser, current);
  assert.equal(saved.currentUser, older);
});

test("a sign-in error after identity changes retains the original return session", async () => {
  const { c, current, saved } = harness();
  await assert.rejects(c.runSafeAccountSwitch("played", async () => {
    c.auth.currentUser = { uid: "legacy" }; throw Error("ambiguous network result");
  }));
  assert.equal(saved.currentUser, current);
});

test("Google selection uses an isolated Auth session and never changes the current game", async () => {
  const { c, current } = harness();
  c.signInWithPopup = async (targetAuth, _provider, resolver) => {
    assert.equal(resolver, c.browserPopupRedirectResolver);
    assert.notEqual(targetAuth, c.auth);
    targetAuth.currentUser = { uid: "selected" };
    return { user: targetAuth.currentUser };
  };
  assert.equal((await c.selectGoogleAccount({})).user.uid, "selected");
  assert.equal(c.auth.currentUser, current);
});
