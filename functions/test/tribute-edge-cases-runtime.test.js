"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { server, client, addFunctions, fixture, core, deco } = require("./helpers/tribute-edge-harness.cjs");

async function vaultClient(h) {
  const c = await client.harness();
  await c.start();
  Object.assign(c.context, await core, { paintWallet() {}, VAULT_DECORATION_ITEMS: [], navigate() {}, setFormError() {} });
  c.context.auth.currentUser = { uid: "manager" };
  c.context.state.uid = "manager";
  c.context.window.crypto = crypto.webcrypto;
  const storage = new Map();
  c.context.window.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  addFunctions(c.context, ["createRequestId", "readAmount", "storedVaultMove"]);
  c.context.state.profile = h.firestore.read("tributeProfiles/manager");
  c.context.state.walletBalance = h.balance("manager");
  c.context.state.vault.data = { vault: { amount: c.context.state.profile.vaultAmount || 0 } };
  return c;
}

for (const direction of ["deposit", "withdraw"]) test(`RANCH-01: lost ${direction} response reuses one operation after navigation and reload`, async () => {
  const h = server.createHarness({ balances: { manager: 2000 } });
  await server.openManager(h, "manager", { entryFee: 0 });
  h.firestore.write("tributeProfiles/manager", { ...h.firestore.read("tributeProfiles/manager"), vaultQualifiedAt: h.now(), vaultAmount: 200 });
  const c = await vaultClient(h);
  const ids = [];
  c.context.tributeActionCallable = async request => {
    ids.push(request.clientRequestId);
    const data = await h.act("manager", request.action, request);
    if (ids.length === 1) throw Object.assign(new Error("response lost"), { code: "functions/unavailable" });
    return { data };
  };
  const form = { dataset: { form: "vault", direction }, elements: { amount: { value: "100" } } };
  await c.context.handleSubmit(form);
  const movedBalance = h.balance("manager");
  assert.equal(movedBalance, direction === "deposit" ? 1900 : 2100);
  assert.equal(c.context.state.vault.pendingMove.amount, 100);
  // Restoring the pending operation does not depend on the original form or its values.
  c.context.state.vault.pendingMove = c.context.storedVaultMove();
  c.context.state.walletBalance = 0;
  form.elements.amount.value = "999";
  form.dataset.direction = direction === "deposit" ? "withdraw" : "deposit";
  await c.context.handleSubmit(form);
  assert.equal(ids[0], ids[1]);
  assert.equal(h.balance("manager"), movedBalance);
  assert.equal(c.context.state.walletBalance, movedBalance, "replay returns the latest wallet balance");
  assert.equal(c.context.state.vault.pendingMove, null);
  assert.equal(c.context.storedVaultMove(), null);
});

test("RANCH-01: known rejection permits editing, while a pending mutation cannot create a second request", async () => {
  const { h } = await fixture();
  const c = await vaultClient(h);
  const gate = client.deferred();
  let calls = 0;
  c.context.tributeActionCallable = async () => { calls++; return gate.promise; };
  const form = { dataset: { form: "vault", direction: "deposit" }, elements: { amount: { value: "100" } } };
  const first = c.context.handleSubmit(form);
  await c.context.handleSubmit(form);
  assert.equal(calls, 1);
  gate.reject(Object.assign(new Error("not qualified"), { code: "functions/failed-precondition" }));
  await first;
  assert.equal(c.context.state.vault.pendingMove, null);
  assert.equal(c.context.storedVaultMove(), null);
});

test("RANCH-01: durable vault receipts survive more than 20 operations and bind the original amount", async () => {
  const { h } = await fixture();
  h.firestore.write("tributeProfiles/manager", { ...h.firestore.read("tributeProfiles/manager"), vaultQualifiedAt: h.now() });
  const first = server.nextRequestId();
  const move = (amount, clientRequestId) => h.act("manager", "vault_deposit", { amount, clientRequestId });
  await move(100, first);
  for (let i = 0; i < 21; i++) await move(1, server.nextRequestId());
  const before = h.balance("manager");
  assert.equal((await move(100, first)).replayed, true);
  assert.equal(h.balance("manager"), before);
  await assert.rejects(move(101, first), /変更できません/);
});

test("RANCH-02: old unpaid requests stay actionable and older tributes can be received after expanding history", async () => {
  const { h, contractId } = await fixture();
  for (let i = 0; i < 3; i++) {
    h.advance(2100);
    await h.act("manager", "request", { contractId, amount: 10 });
  }
  await h.act("payer", "tribute", { contractId, kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  for (let i = 0; i < 100; i++) {
    h.advance(2100);
    await h.act("payer", "message", { contractId, text: `確認 ${i}` });
  }
  const module = await core;
  const all = h.events(contractId);
  const raw = { contractId, ...h.contract(contractId), ...h.firestore.read(`tributeContracts/${contractId}/private/limits`) };
  const context = vm.createContext({ ...module, ...await deco, previewScreen: "", sealChoices: new Map(),
    state: { profile: h.firestore.read("tributeProfiles/manager"), thread: {}, contracts: [], walletBalance: 2000 },
    frame: html => html, escapeHtml: String, renderBlockButton: () => "", renderTemplates: () => "", renderThreadHead: () => "", sealSvg: () => "" });
  addFunctions(context, ["formatDateTime", "requestStatusMap", "purposeTag", "renderReceiveControls", "rewardChips", "renderWantChips", "renderResistRow", "renderHold", "renderGiveButton", "renderRecite", "renderReciteConfirmControls", "renderExtension", "ownWordsFor", "refundPendingText", "renderEvent", "elapsedLabel", "requestLimitProblem", "renderPayableRequest", "renderThreadActions", "renderThreadActionButtons", "canShowShot", "renderShotButton", "renderPendingRequests", "renderWorkOrder", "renderWorkConfirmControls", "renderThreadHistory", "renderThreadEvents", "renderRequestMark", "contractCounterpart", "managerNickname", "renderThread"]);
  const render = (uid, events) => { context.state.thread = { view: module.viewContract(raw, uid, h.now()), events }; return context.renderThread(); };
  assert.equal((render("payer", all.slice(-100)).match(/data-t="give-request"/g) || []).length, 3);
  assert.equal((render("manager", all.slice(-100)).match(/data-t="cancel-request"/g) || []).length, 3);
  assert.match(context.renderThread(), /data-t="history-more"/);
  assert.match(render("manager", all), /data-t="receive"/);
  const tribute = all.find(event => event.type === "tribute");
  await h.act("manager", "receive", { contractId, tributeSeq: tribute.seq, seal: "juryo" });
  assert.equal(h.contract(contractId).awaitingReceipt, 0);
});

test("RANCH-02: expanded live history rejects old callbacks and provides retry after a listener error", async () => {
  const c = await client.harness();
  await c.start();
  addFunctions(c.context, ["handleClick"]);
  const limits = [];
  c.context.limitToLast = value => { limits.push(value); };
  c.open(); c.snapshot(); c.events([101, 102]);
  const old = c.subscriptions.find(subscription => subscription.reference.endsWith("/events"));
  await c.context.handleClick({ dataset: { t: "history-more" } });
  assert.deepEqual(limits, [100, 200]);
  c.events([999], { subscription: old });
  assert.equal(c.context.state.thread.events[0].seq, 101);
  const latest = c.subscriptions.filter(subscription => subscription.reference.endsWith("/events")).at(-1);
  latest.error(new Error("offline"));
  assert.equal(c.context.state.thread.historyError, true);
  await c.context.handleClick({ dataset: { t: "history-more" } });
  assert.deepEqual(limits, [100, 200, 200], "retry does not expand again");
  c.events([1, 2, 101, 102]);
  assert.equal(c.context.state.thread.events[0].seq, 1);
  assert.equal(c.context.state.thread.historyLoading, false);
});

for (const action of ["terminate", "release", "block", "expiry", "state"]) test(`RANCH-03: ${action} ends a full-wallet contract and preserves all escrow as an own refund`, async () => {
  const { h, contractId, MAX_POINTS } = await fixture({ production: true });
  await h.act("payer", "escrow_deposit", { contractId, amount: 100, clientRequestId: server.nextRequestId() });
  h.firestore.write("wallets/payer", { balance: MAX_POINTS, reservedIncoming: 0 });
  if (action === "block") await h.service.endContractsBetween("manager", "payer");
  else if (action === "expiry" || action === "state") {
    h.advance(4 * 86400000);
    if (action === "expiry") assert.equal((await h.service.expireContracts()).ended, 1);
    else assert.equal((await h.act("payer", "state")).profile.refundPending, 100, "the first response includes its own lazy refund");
  } else await h.act(action === "release" ? "manager" : "payer", action, { contractId });
  assert.equal(h.contract(contractId).status, "ended");
  assert.equal(h.contract(contractId).escrowBalance, 0);
  assert.equal(h.firestore.read("tributeProfiles/payer").refundPending, 100);
  assert.equal((await h.act("payer", "claim_refund")).amount, 0);
  assert.equal((await h.act("manager", "claim_refund", { uid: "payer" })).amount, 0);
  h.firestore.write("wallets/payer", { balance: MAX_POINTS - 100, reservedIncoming: 0 });
  const claimed = await h.act("payer", "claim_refund");
  assert.equal(claimed.amount, 100);
  assert.equal(claimed.profile.refundPending, 0);
  assert.equal(h.balance("payer"), MAX_POINTS);
  assert.equal((await h.act("payer", "claim_refund")).amount, 0);
  assert.equal(h.ledger("payer").filter(entry => entry.kind === "tribute_escrow_return").reduce((sum, entry) => sum + entry.delta, 0), 100);
});

test("RANCH-03: partial refunds respect incoming reservations and are conserved across repeated claims", async () => {
  const { h, contractId, MAX_POINTS } = await fixture({ production: true });
  await h.act("payer", "escrow_deposit", { contractId, amount: 100, clientRequestId: server.nextRequestId() });
  h.firestore.write("wallets/payer", { balance: MAX_POINTS - 60, reservedIncoming: 20 });
  await h.act("payer", "terminate", { contractId });
  assert.equal(h.balance("payer"), MAX_POINTS - 20);
  assert.equal(h.firestore.read("tributeProfiles/payer").refundPending, 60);
  h.firestore.write("wallets/payer", { balance: MAX_POINTS - 50, reservedIncoming: 20 });
  assert.equal((await h.act("payer", "claim_refund")).amount, 30);
  assert.equal((await h.act("payer", "claim_refund")).amount, 0);
  h.firestore.write("wallets/payer", { balance: MAX_POINTS - 30, reservedIncoming: 0 });
  assert.equal((await h.act("payer", "claim_refund")).amount, 30);
  assert.equal(h.firestore.read("tributeProfiles/payer").refundPending, 0);
  assert.equal(h.ledger("payer").filter(entry => entry.kind === "tribute_escrow_return").reduce((sum, entry) => sum + entry.delta, 0), 100);
});

for (const action of ["caps", "approval"]) test(`RANCH-03: ${action} can return escrow to a full wallet without blocking the action`, async () => {
  const { h, contractId, MAX_POINTS } = await fixture({ production: true });
  await h.act("payer", "escrow_deposit", { contractId, amount: 500, clientRequestId: server.nextRequestId() });
  h.firestore.write("wallets/payer", { balance: MAX_POINTS, reservedIncoming: 0 });
  if (action === "caps") await h.act("payer", "set_caps", { contractId, caps: { perTribute: 100, perDay: 300, total: 300 } });
  else {
    await h.act("payer", "escrow_withdraw_request", { contractId, amount: 200 });
    await h.act("manager", "escrow_decision", { contractId, approve: true });
  }
  assert.equal(h.contract(contractId).escrowBalance, 300);
  assert.equal(h.firestore.read("tributeProfiles/payer").refundPending, 200);
});

for (const outcome of ["success", "error"]) test(`RANCH-04: a late manager ${outcome} cannot replace the latest selection`, async () => {
  const c = await client.harness(); await c.start();
  addFunctions(c.context, ["openManager"]);
  const a = client.deferred(), b = client.deferred();
  c.context.tributeActionCallable = async request => ({ data: await (request.publicManagerId === "A" ? a.promise : b.promise) });
  const first = c.context.openManager("A"), second = c.context.openManager("B");
  b.resolve({ card: { personaName: "B" } }); await second;
  if (outcome === "error") a.reject(new Error("old failure")); else a.resolve({ card: { personaName: "A" } });
  await first;
  assert.equal(c.context.state.manager.publicManagerId, "B");
  assert.equal(c.context.state.manager.status, "ready");
  assert.equal(c.calls.some(entry => entry.toast === "old failure"), false);
});

test("RANCH-04: late board response cannot undo the newer filter", async () => {
  const c = await client.harness(); await c.start(); addFunctions(c.context, ["loadBoard"]);
  const old = client.deferred();
  c.context.tributeActionCallable = async request => ({ data: request.nekamaOnly ? { managers: ["filtered"] } : await old.promise });
  const first = c.context.loadBoard();
  c.context.state.board.nekamaOnly = true;
  await c.context.loadBoard();
  old.resolve({ managers: ["all"] }); await first;
  assert.equal(c.context.state.board.managers[0], "filtered");
});

test("RANCH-05: a list response does not recreate the card editor or erase its draft", async () => {
  const c = await client.harness(); await c.start();
  const gate = client.deferred(); c.context.tributeActionCallable = async () => ({ data: await gate.promise });
  let inputValue = "保存済み", replacements = 0;
  for (const name of ["renderError", "renderAge", "renderHub", "renderBoard", "renderManagerDetail", "renderApply", "renderCardEditor", "renderThread", "renderReceipts", "renderLedger", "renderRanking", "renderVault"]) c.context[name] = () => "";
  Object.assign(c.context, await core, await deco, { frame: html => html, escapeHtml: String, sigilColor: () => "#fff", cardXHandle: () => "",
    renderCardPreview: () => "", renderAvatarChoices: () => "", renderSealSettings: () => "", renderDecorationSettings: () => "", renderCardAchievementPicker: () => "", optionList: () => "", decorationsTried: () => [], vaultDecorationsLocked: () => [] });
  c.context.state.profile = { card: { intro: "保存済み" } };
  c.context.appRoot = { set innerHTML(value) { replacements++; inputValue = /name="intro"[^>]*value="([^"]*)"/.exec(value)?.[1] || ""; } };
  c.context.renderLayer = () => {};
  addFunctions(c.context, ["loadList", "render", "renderCardEditor", "renderOwnWordsEditor"]);
  const loading = c.context.loadList("receipts", "receipts", payload => ({ items: payload.receipts }));
  c.context.state.screen = "card"; c.context.render(); inputValue = "編集中の紹介文";
  const before = replacements; gate.resolve({ receipts: [] }); await loading;
  assert.equal(replacements, before);
  assert.equal(inputValue, "編集中の紹介文");
});

test("RANCH-06: tied receipt timestamps page without omissions or duplicates", async () => {
  const { h, contractId } = await fixture();
  for (let i = 0; i < 51; i++) await h.act("payer", "tribute", { contractId, kind: "silent", amount: 1, clientRequestId: server.nextRequestId() });
  const page1 = await h.act("payer", "receipts");
  const page2 = await h.act("payer", "receipts", { cursor: page1.nextCursor });
  assert.equal(page1.receipts.length, 50); assert.equal(page1.more, true);
  assert.equal(page2.receipts.length, 1); assert.equal(page2.more, false);
  assert.equal(new Set([...page1.receipts, ...page2.receipts].map(receipt => receipt.receiptId)).size, 51);
  await assert.rejects(h.act("payer", "receipts", { cursor: { createdAt: h.now(), receiptId: "../other" } }), /確認できません/);
});

test("RANCH-06: duplicate more-clicks coalesce and a response cannot append to a refreshed list", async () => {
  const c = await client.harness(); await c.start(); addFunctions(c.context, ["loadMoreReceipts"]);
  const gate = client.deferred(); let calls = 0;
  c.context.tributeActionCallable = async () => { calls++; return { data: await gate.promise }; };
  c.context.state.receipts = { items: [{ receiptId: "old", createdAt: 1 }], more: true };
  const first = c.context.loadMoreReceipts(); await c.context.loadMoreReceipts();
  assert.equal(calls, 1);
  c.context.state.receipts = { items: [{ receiptId: "new", createdAt: 2 }], more: false };
  gate.resolve({ receipts: [{ receiptId: "stale", createdAt: 1 }], more: false }); await first;
  assert.equal(c.context.state.receipts.items.length, 1);
  assert.equal(c.context.state.receipts.items[0].receiptId, "new");
});
