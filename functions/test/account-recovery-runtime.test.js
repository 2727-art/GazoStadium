const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.resolve(__dirname, "../../account.js"), "utf8");
function fn(name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\r?\n/.exec(body);
  return body.slice(0, end.index + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const calls = [];
  const context = vm.createContext({
    active: true, state: null, useAccountPreview: false,
    auth: { currentUser: { uid: "old", isAnonymous: true } },
    ANJU_PAY_MAX_BALANCE: 999999999,
    normalizePatronage: () => ({}), normalizePatronFund: () => ({}),
    normalizePatronImpact: () => ({}), normalizeOshijoPatronEligibility: () => ({}),
    resetPatronEconomyState() {}, restoreTransferCode() {}, clearTransferCode() {},
    applyPatronEconomyResponse() {}, loadAnjuPayHistory: async () => true,
    render() { calls.push({ render: true }); }, isGoogleLinked: () => false,
    ensureUser: async () => context.auth.currentUser,
    economyActionCallable: async (request) => { calls.push(request); return { data: { balance: 125 } }; },
    timestampMillis: (value) => Number(value) || 0, normalizeHistoryEntry: (value) => value,
    friendlyError: (error) => error.message,
  });
  vm.runInContext(["createState", "resetHistoryState", "requireWalletBalance", "walletBalanceIsKnown", "loadAccountData", "reloadAccountData", "applyHistoryResponse", "upgradePatron", "isAccountAccessError", "renderAccountAccessHelp", "friendlyError", "accountErrorMessage", "refreshAfterAccountSignIn"].map(fn).join("\n"), context);
  context.state = context.createState();
  return { context, calls };
}

test("failed wallet read is unknown, not zero; retry fetches the real balance", async () => {
  const { context: c } = harness();
  c.economyActionCallable = async () => { throw new Error("unavailable"); };
  await assert.rejects(c.loadAccountData(), /unavailable/);
  assert.equal(c.state.balance, null);
  assert.equal(c.walletBalanceIsKnown(), false);
  assert.match(c.state.balanceError, /取得できません/);
  c.economyActionCallable = async () => ({ data: { balance: 375 } });
  await c.reloadAccountData();
  assert.equal(c.state.balance, 375);
  assert.equal(c.state.balanceError, "");
  assert.equal(c.walletBalanceIsKnown(), true);
});

for (const balance of [undefined, null, "", "0", NaN, -1, 9999999999]) {
  test(`invalid wallet balance ${String(balance)} cannot become a confirmed zero`, async () => {
    const { context: c } = harness();
    c.economyActionCallable = async () => ({ data: { balance } });
    await assert.rejects(c.loadAccountData(), /残高を確認できません/);
    assert.equal(c.state.balance, null);
    assert.equal(c.walletBalanceIsKnown(), false);
  });
}

test("a server-confirmed zero is a known balance", async () => {
  const { context: c } = harness();
  c.economyActionCallable = async () => ({ data: { balance: 0 } });
  await c.loadAccountData();
  assert.equal(c.state.balance, 0);
  assert.equal(c.walletBalanceIsKnown(), true);
});

test("late responses from an older account cannot replace the current account's balance", async () => {
  const { context: c } = harness();
  const old = deferred();
  const started = deferred();
  c.economyActionCallable = () => { started.resolve(); return old.promise; };
  const request = c.loadAccountData();
  await started.promise;
  c.auth.currentUser = { uid: "google-restored" };
  c.economyActionCallable = async () => ({ data: { balance: 700 } });
  await c.loadAccountData();
  old.resolve({ data: { balance: 1 } });
  await request;
  assert.equal(c.state.user.uid, "google-restored");
  assert.equal(c.state.balance, 700);
});

test("a late failure cannot clear a newer successful refresh on the same UID", async () => {
  const { context: c } = harness();
  const old = deferred();
  const started = deferred();
  c.economyActionCallable = () => { started.resolve(); return old.promise; };
  const request = c.loadAccountData();
  await started.promise;
  c.economyActionCallable = async () => ({ data: { balance: 400 } });
  await c.loadAccountData();
  old.reject(new Error("late network failure"));
  await request;
  assert.equal(c.state.balance, 400);
  assert.equal(c.state.balanceError, "");
});

test("unknown balance prevents spending but does not remove Google or transfer actions", async () => {
  const { context: c, calls } = harness();
  c.state.loading = false;
  c.isGoogleLinked = () => true;
  await c.upgradePatron(1);
  assert.equal(calls.filter((call) => call.action).length, 0);
  assert.match(c.state.error, /支払いはできません/);
  assert.doesNotMatch(fn("protectWithGoogle"), /walletBalanceIsKnown/);
  assert.doesNotMatch(fn("restoreWithGoogle"), /walletBalanceIsKnown/);
  assert.doesNotMatch(fn("redeemTransfer"), /walletBalanceIsKnown/);
});

test("history can supply a confirmed balance but null/missing history balance cannot fabricate zero", () => {
  const { context: c } = harness();
  for (const response of [{}, { balance: null }, { availableBalance: null }, { balance: "" }]) {
    c.applyHistoryResponse(response);
    assert.equal(c.state.balance, null);
  }
  c.applyHistoryResponse({ balance: 0 });
  assert.equal(c.state.balance, 0);
  c.applyHistoryResponse({ availableBalance: 83 });
  assert.equal(c.state.balance, 83);
});

test("wallet visibly distinguishes an unavailable balance and exposes a working retry", async () => {
  const { context: c } = harness();
  const root = { innerHTML: "", focus() {} };
  const { formatAnjuPayNumber, ANJU_PAY_UNIT } = await import("../../anju-pay-format.mjs");
  Object.assign(c, {
    appRoot: root, formatAnjuPayNumber, ANJU_PAY_UNIT,
    accountKind: () => "guest", escapeHtml: (value) => String(value),
    renderAnjuPayPolicy: () => "", renderAnjuPayQuickActions: () => "", renderAnjuPayHistory: () => "",
    renderAccountStatus: () => "", renderPatronage: () => "", renderTransfer: () => "",
    bindEvents() {}, updateCountdown() {},
  });
  vm.runInContext(fn("render"), c);
  c.state.loading = false;
  c.render();
  assert.match(root.innerHTML, /<strong>-- <small>Pay/);
  assert.match(root.innerHTML, /残高は未確認です/);
  assert.match(root.innerHTML, /id="accountReload"/);
  c.state.balance = 0;
  c.render();
  assert.match(root.innerHTML, /<strong>0 <small>Pay/);
  assert.doesNotMatch(root.innerHTML, /残高は未確認です/);
});

function signInHarness(kind) {
  const h = harness(), c = h.context;
  const guest = { uid: "old", isAnonymous: true, providerData: [], getIdToken: async () => "token" };
  const target = { uid: kind === "protect" || kind === "restore-new" ? "old" : "restored", isAnonymous: false, providerData: kind === "transfer" ? [] : [{ providerId: "google.com" }], getIdToken: async () => "token" };
  const counts = { link: 0, credential: 0, custom: 0, transfer: 0 };
  c.auth.currentUser = guest;
  c.state.user = guest;
  c.state.loading = false;
  Object.assign(c, {
    window: { confirm: () => true },
    GoogleAuthProvider: { credentialFromError: () => null }, googleProvider: {},
    isGoogleLinked: () => !!c.state.user?.providerData?.some(p => p.providerId === "google.com"),
    accountKind: () => c.state.user?.isAnonymous ? "guest" : "protected",
    requireCurrentAccount: () => c.auth.currentUser,
    requireOperationUid: () => {}, formatAnjuPay: String,
    persistTransferCode() {},
    runHariaiAccountTransition: (operation) => operation(),
    linkWithPopup: async () => { counts.link++; c.auth.currentUser = target; return { user: target }; },
    signInWithCredential: async () => { counts.credential++; c.auth.currentUser = target; return { user: target }; },
    signInWithCustomToken: async () => { counts.custom++; c.auth.currentUser = target; return { user: target }; },
    accountTransferCallable: async () => { counts.transfer++; return { data: { token: "handoff-token" } }; },
  });
  vm.runInContext(["protectWithGoogle", "restoreWithGoogle", "useExistingGoogleData", "redeemTransfer", "createTransfer"].map(fn).join("\n"), c);
  c.state.pendingGoogleCredential = {};
  const invoke = () => kind === "protect" ? c.protectWithGoogle() : kind === "restore-new" ? c.restoreWithGoogle() : kind === "existing-google" ? c.useExistingGoogleData() : c.redeemTransfer("valid-code");
  return { ...h, target, counts, invoke };
}

for (const kind of ["protect", "restore-new", "existing-google", "transfer"]) {
  for (const failure of ["functions/unauthenticated", "functions/unavailable", "auth/network-request-failed"]) {
    test(`${kind}: successful authentication survives later ${failure} without repeating sign-in`, async () => {
      const { context: c, target, counts, invoke } = signInHarness(kind);
      const error = Object.assign(new Error("raw SDK message"), { code: failure });
      if (failure.startsWith("auth/")) target.getIdToken = async () => { throw error; };
      else c.economyActionCallable = async () => { throw error; };
      await invoke();
      assert.equal(c.auth.currentUser.uid, target.uid);
      assert.equal(c.state.user.uid, target.uid);
      assert.equal(c.state.authNoticeUid, target.uid);
      assert.match(c.state.authNotice, /完了しました/);
      assert.equal(c.state.balance, null);
      assert.equal(c.state.accessIssue, failure === "functions/unauthenticated");
      assert.doesNotMatch(c.state.error, /raw SDK|連携できません|引き継ぎ.*できません/);
      const previous = { ...counts }, notice = c.state.authNotice;
      target.getIdToken = async () => "token";
      c.economyActionCallable = async () => ({ data: { balance: 875 } });
      await c.reloadAccountData();
      assert.deepEqual(counts, previous);
      assert.equal(c.state.authNotice, notice);
      assert.equal(c.state.balance, 875);
      assert.equal(c.state.error, "");
      assert.equal(c.state.accessIssue, false);
    });
  }
}

test("Google cancellation does not announce success or alter the guest", async () => {
  const { context: c, invoke } = signInHarness("protect");
  c.linkWithPopup = async () => { throw Object.assign(new Error("cancel"), { code: "auth/popup-closed-by-user" }); };
  await invoke();
  assert.equal(c.auth.currentUser.uid, "old");
  assert.equal(c.state.authNotice, "");
  assert.match(c.state.error, /キャンセル/);
  assert.equal(c.state.accessIssue, false);
});

for (const action of ["create", "redeem"]) {
  test(`rejected transfer ${action} gives reload guidance without switching identity`, async () => {
    const { context: c, counts } = signInHarness("transfer");
    c.accountTransferCallable = async () => { throw Object.assign(new Error("Unauthenticated"), { code: "functions/unauthenticated" }); };
    await (action === "create" ? c.createTransfer() : c.redeemTransfer("valid-code"));
    assert.equal(c.auth.currentUser.uid, "old");
    assert.equal(counts.custom, 0);
    assert.equal(c.state.authNotice, "");
    assert.equal(c.state.accessIssue, true);
    assert.match(c.state.error, /ログイン状態またはブラウザの安全性/);
    assert.match(c.renderAccountAccessHelp(), /サイトデータやCookieは削除しない/);
    assert.match(c.renderAccountAccessHelp(), /id="accountPageReload"/);
  });
}

test("App Check guidance is specific only when the error identifies App Check", () => {
  const { context: c } = harness();
  assert.match(c.friendlyError({ code: "appCheck/throttled" }), /ブラウザの安全性確認が通らず/);
  assert.match(c.friendlyError({ code: "functions/unauthenticated" }), /ログイン状態または/);
  assert.equal(c.isAccountAccessError({ code: "functions/permission-denied" }), false);
});

test("a late post-sign-in error cannot modify a different current account", async () => {
  const { context: c, target } = signInHarness("protect");
  const wait = deferred();
  target.getIdToken = () => wait.promise;
  c.auth.currentUser = c.state.user = target;
  const result = c.refreshAfterAccountSignIn(target, "Google連携が完了しました。");
  c.auth.currentUser = c.state.user = { uid: "another" };
  c.state.balance = 123;
  wait.reject(new Error("late"));
  await result;
  assert.equal(c.state.balance, 123);
  assert.equal(c.state.error, "");
});

test("wallet sends the UID whose balance it is requesting", async () => {
  const { context: c, calls } = harness();
  await c.loadAccountData();
  assert.equal(calls.find(call => call.action === "initialize").expectedUid, c.auth.currentUser.uid);
});

test("server diagnostic numbers can be shared without displaying arbitrary details", () => {
  const { context: c } = harness();
  const diagnosticId = "01234567-89ab-4cde-8fab-0123456789ab";
  assert.match(c.friendlyError({ code: "functions/unavailable", details: { diagnosticId } }), /お問い合わせ番号: 01234567/);
  assert.doesNotMatch(c.friendlyError({ code: "functions/unavailable", details: { diagnosticId: "private-token" } }), /private-token|お問い合わせ番号/);
});
