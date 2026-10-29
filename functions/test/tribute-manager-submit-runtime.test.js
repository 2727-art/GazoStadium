"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "tribute.js"), "utf8");
const core = import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const contractId = "a".repeat(40);

function fn(name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\r?\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

async function harness({ dispatch = async () => ({ ok: true }), escrowBalance = 200 } = {}) {
  const module = await core;
  const view = module.viewContract({
    contractId, managerUid: "manager", payerUid: "payer", status: "active",
    acceptedAt: 1, escrowBalance, ngWords: ["禁止語"],
    caps: { perTribute: 100, perDay: 300, total: 1_000 },
  }, "manager");
  assert.equal(view.caps, null);
  assert.equal(view.allowance, 0);
  const calls = [];
  const toasts = [];
  const listeners = new Map();
  const error = { textContent: "", isConnected: true };
  const state = { uid: "manager", busy: "", readRequests: new Map(), thread: { view, contractId }, sheet: { clientRequestId: "request_manager_01" } };
  let closed = false;
  const context = vm.createContext({
    ...module, state, active: true, lifecycleGeneration: 1, stateRequest: null, previewScreen: "",
    auth: { currentUser: { uid: "manager" } }, isCurrent: () => true,
    layer: { querySelector: () => error },
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.elements[name]?.value; } },
    call: async (action, payload) => { calls.push({ action, ...payload }); return dispatch(action, payload); },
    closeSheet: () => { closed = true; }, notifyAchievementUnlocks() {},
    showToast: (message) => toasts.push(message),
  });
  vm.runInContext([
    "needsPageReload", "friendlyError", "readAmount", "setFormError", "contractPayload", "mutate", "handleSubmit", "bindRoot",
  ].map(fn).join("\n"), context);
  context.bindRoot({ addEventListener: (name, listener) => listeners.set(name, listener) });
  return {
    context, calls, toasts, error,
    get closed() { return closed; },
    form(kind, amount, { note = "今日の管理費。", purpose = "management" } = {}) {
      const form = {
        dataset: { form: kind },
        elements: { amount: { value: String(amount) }, note: { value: note }, purpose: { value: purpose } },
        querySelector: () => error, closest: () => form,
      };
      return form;
    },
    async submit(kind, amount, options) { await context.handleSubmit(this.form(kind, amount, options)); },
    async submitEvent(form) {
      let prevented = false;
      await listeners.get("submit")({ target: form, preventDefault() { prevented = true; } });
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
      assert.equal(prevented, true);
    },
  };
}

test("manager submits requests without receiving the payer's private limits", async () => {
  for (const amount of [1, 100, 10_000]) {
    const h = await harness();
    await h.submit("request", amount);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), {
      action: "request", contractId, amount, note: "今日の管理費。", purpose: "management",
    });
    assert.equal(h.closed, true);
    assert.equal(h.error.textContent, "");
    assert.ok(h.toasts.includes("請求を送りました。"));
  }
});

test("request submission rejects invalid amounts and forbidden notes before calling the server", async () => {
  for (const amount of [0, -1, 1.5, 10_001, "invalid"]) {
    const h = await harness();
    await h.submit("request", amount);
    assert.equal(h.calls.length, 0);
    assert.ok(h.error.textContent);
    assert.equal(h.closed, false);
  }
  const h = await harness();
  await h.submit("request", 100, { note: "禁止語" });
  assert.equal(h.calls.length, 0);
  assert.ok(h.error.textContent);
});

test("manager can submit escrow takes up to the visible balance with limits checked by the server", async () => {
  for (const amount of [1, 100, 200]) {
    const h = await harness();
    await h.submit("take", amount);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), {
      action: "escrow_take", contractId, amount, clientRequestId: "request_manager_01",
    });
    assert.equal(h.closed, true);
  }
  for (const amount of [0, 1.5, 201]) {
    const h = await harness();
    await h.submit("take", amount);
    assert.equal(h.calls.length, 0);
    assert.ok(h.error.textContent);
  }
});

test("server refusal stays visible and leaves the manager form open", async () => {
  for (const [kind, message] of [
    ["request", "未払いの請求は3件までです。"],
    ["take", "財布の限度額を超えるため、徴収できません。"],
  ]) {
    const h = await harness({ dispatch: async () => { throw new Error(message); } });
    await h.submit(kind, 100);
    assert.equal(h.calls.length, 1);
    assert.equal(h.error.textContent, message);
    assert.equal(h.closed, false);
    assert.equal(h.context.state.busy, "");
  }
});

test("the bound submit event sends a manager request and surfaces unexpected errors", async () => {
  const h = await harness();
  await h.submitEvent(h.form("request", 100));
  assert.equal(h.calls.length, 1);
  assert.equal(h.closed, true);

  const broken = await harness();
  broken.context.handleSubmit = async () => { throw new Error("送信処理を完了できませんでした。"); };
  await broken.submitEvent(broken.form("request", 100));
  assert.equal(broken.error.textContent, "送信処理を完了できませんでした。");
  assert.equal(broken.calls.length, 0);
});
