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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() { for (let n = 0; n < 30; n += 1) await Promise.resolve(); }

function rawContract(seq = 5, readSeq = 0) {
  return {
    contractId, managerUid: "manager", payerUid: "player", status: "active",
    acceptedAt: 1, expiresAt: Date.now() + 86400000,
    eventSeq: seq, readSeq: { payer: readSeq, manager: 0 },
    caps: { perTribute: 100, perDay: 300, total: 1000 },
  };
}

async function harness(dispatch) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const subscriptions = [];
  const module = await core;
  const statePayload = () => ({ ok: true, ageConfirmed: true, contracts: [module.viewContract(rawContract(), "player")], achievements: { stats: {}, unlocked: [], newlyUnlocked: [] } });
  const window = {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++timerId; }, clearInterval() {}, scrollTo() {},
    HariaiApp: { returnHome() { calls.push({ ui: "home" }); } },
  };
  const context = vm.createContext({
    window, document: { visibilityState: "visible" }, location: { protocol: "https:" },
    auth: { currentUser: { uid: "player" }, authStateReady: async () => {} },
    browserLocalPersistence: {}, setPersistence: async () => {}, signInAnonymously: async () => { throw new Error("unexpected auth"); },
    active: false, lifecycleGeneration: 0, state: {}, stateRequest: null,
    threadGeneration: 0, markReadProgress: new Map(), contractUnsubscribe: null, eventsUnsubscribe: null,
    walletUnsubscribe: null, markReadTimer: null, tickTimer: null, hold: null,
    previewScreen: "", EVENTS_LIMIT: 100, TRIBUTE_AGE_VERSION: 1,
    // 見学用の見本と招待リンク（ranch-invite-v1）。見本の契約IDはサーバーへ送られず、招待がなければ通常の入場になる。
    DEMO_CONTRACT_ID: "demo", pendingInvite: "", openManager(id) { calls.push({ ui: "manager", id }); },
    SCREENS: new Set(["loading", "age", "hub", "thread", "board"]), firestore: {},
    layer: { innerHTML: "", querySelector() { return null; } },
    tributeActionCallable: async (request) => {
      calls.push(request);
      const data = dispatch ? await dispatch(request, statePayload) : statePayload();
      return { data };
    },
    doc: (_db, ...parts) => parts.join("/"), collection: (_db, ...parts) => parts.join("/"),
    query: (reference) => reference, orderBy() {}, limitToLast() {},
    onSnapshot(reference, next, error) {
      const subscription = { reference, next, error, active: true };
      subscriptions.push(subscription);
      return () => { subscription.active = false; };
    },
    viewContract: module.viewContract,
    render() { calls.push({ ui: "render" }); }, updateThreadParts() { calls.push({ ui: "thread-render" }); },
    scrollThreadToEnd() {}, setChrome() {}, subscribeWallet() {}, cancelHold() {},
    showToast(message) { calls.push({ toast: message }); }, friendlyError: (error) => error.message,
    modeIsActiveElsewhere: () => false,
    notifyAchievementUnlocks(ids) { calls.push({ unlocked: ids }); },
    setFormError() {},
  });
  vm.runInContext([
    "createState", "isCurrent", "ensureUser", "call", "applyState", "requestState", "refreshState", "navigate",
    "stopThread", "openThread", "isCurrentThread", "visibleReadSequence", "applyReadAcknowledgement", "scheduleMarkRead",
    "mutate", "handleSubmit", "start", "isActive", "requestHome",
  ].map(fn).join("\n"), context);
  return {
    context, calls, subscriptions,
    requests(action) { return calls.filter((entry) => entry.action === action); },
    async start() { await context.start(); },
    open() { context.openThread(contractId); },
    snapshot(raw = rawContract(), { subscription } = {}) {
      const target = subscription || subscriptions.filter((entry) => entry.reference === `tributeContracts/${contractId}` && entry.active).at(-1);
      target.next({ exists: () => true, data: () => structuredClone(raw) });
    },
    events(sequences = [1, 2, 3, 4, 5], { subscription } = {}) {
      const target = subscription || subscriptions.filter((entry) => entry.reference.endsWith("/events") && entry.active).at(-1);
      target.next({ docs: sequences.map((seq) => ({ data: () => ({ seq, type: "message", text: `event-${seq}` }) })) });
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await flush();
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
      await flush();
    },
  };
}

test("ranch entry fetches state once; later hub navigation still fetches fresh state", async () => {
  const h = await harness();
  await h.start();
  assert.equal(h.requests("state").length, 1);
  assert.equal(h.context.state.screen, "hub");
  h.context.navigate("hub");
  await flush();
  assert.equal(h.requests("state").length, 2);
});

test("overlapping state requests share one RPC and apply achievement notifications only once", async () => {
  const gate = deferred();
  let slow = false;
  const h = await harness((_request, payload) => slow ? gate.promise : payload());
  await h.start();
  slow = true;
  const first = h.context.refreshState();
  const second = h.context.refreshState();
  assert.equal(h.requests("state").length, 2);
  gate.resolve({ ageConfirmed: true, contracts: [], achievements: { newlyUnlocked: ["tribute-test"] } });
  await Promise.all([first, second]);
  assert.equal(h.calls.filter((entry) => entry.unlocked?.includes("tribute-test")).length, 1);
});

test("failed state requests clear their in-flight slot and allow a fresh retry", async () => {
  let fail = false;
  const h = await harness((_request, payload) => {
    if (fail) throw new Error("offline");
    return payload();
  });
  await h.start();
  fail = true;
  await h.context.refreshState();
  fail = false;
  await h.context.refreshState();
  assert.equal(h.requests("state").length, 3);
  assert.equal(h.context.stateRequest, null);
});

test("leaving and re-entering starts a fresh request and ignores the older lifecycle response", async () => {
  const old = deferred();
  let requests = 0;
  const h = await harness((_request, payload) => ++requests === 1 ? old.promise : payload());
  const opening = h.context.start();
  await flush();
  h.context.requestHome();
  await h.start();
  old.resolve({ ageConfirmed: false, contracts: [], profile: { walletName: "OLD" } });
  await opening;
  assert.equal(h.requests("state").length, 2);
  assert.equal(h.context.state.screen, "hub");
  assert.equal(h.context.state.profile, null);
});

test("an auth change does not apply the previous user's state or share its pending request", async () => {
  const old = deferred();
  let slow = false;
  const h = await harness((_request, payload) => slow ? old.promise : payload());
  await h.start();
  slow = true;
  const refreshing = h.context.refreshState();
  h.context.auth.currentUser = { uid: "new-user" };
  old.resolve({ ageConfirmed: true, profile: { walletName: "OLD" } });
  await refreshing;
  assert.equal(h.context.state.profile, null);
  await assert.rejects(h.context.requestState(), /アカウント/);
});

test("age confirmation fetches one post-mutation state and does not refetch on hub entry", async () => {
  const h = await harness((request, payload) => request.action === "age_confirm" ? { ok: true } : payload());
  await h.start();
  h.context.state.screen = "age";
  await h.context.handleSubmit({ dataset: { form: "age" }, elements: { adult: { checked: true }, premise: { checked: true } } });
  assert.equal(h.requests("state").length, 2);
  assert.equal(h.requests("age_confirm").length, 1);
  assert.equal(h.context.state.screen, "hub");
});

test("a successful mutation invalidates pre-mutation state so hub entry gets a fresh result", async () => {
  const old = deferred();
  let states = 0;
  const h = await harness((request, payload) => {
    if (request.action !== "state") return { ok: true };
    states += 1;
    if (states === 2) return old.promise;
    return { ...payload(), profile: { walletName: states === 1 ? "INITIAL" : "NEW" } };
  });
  await h.start();
  const refreshing = h.context.refreshState();
  await h.context.mutate("save_profile", {}, { after: () => h.context.navigate("hub") });
  await flush();
  assert.equal(h.requests("state").length, 3);
  old.resolve({ ageConfirmed: true, profile: { walletName: "OLD" } });
  await refreshing;
  assert.equal(h.context.state.profile.walletName, "NEW");
});

test("an old lifecycle mutation result does not alter a new screen or invoke its after action", async () => {
  const old = deferred();
  const h = await harness((request, payload) => request.action === "save_profile" ? old.promise : payload());
  await h.start();
  let afterCalls = 0;
  const mutation = h.context.mutate("save_profile", {}, { success: "OLD SUCCESS", after: () => { afterCalls += 1; } });
  h.context.requestHome();
  await h.start();
  h.context.state.busy = "new-action";
  old.resolve({ ok: true });
  assert.equal(await mutation, null);
  assert.equal(h.context.state.busy, "new-action");
  assert.equal(afterCalls, 0);
  assert.equal(h.calls.some((entry) => entry.toast === "OLD SUCCESS"), false);
});

test("contract snapshot alone cannot acknowledge events that have not loaded", async () => {
  const h = await harness();
  await h.start(); h.open(); h.snapshot();
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 0);
  h.events([1, 2, 3]);
  await h.advance(800);
  assert.equal(h.requests("mark_read")[0].seq, 3);
});

test("event snapshot arriving before contract data waits for the contract and visible page", async () => {
  const h = await harness();
  await h.start(); h.open();
  h.context.state.thread.view = null;
  h.events();
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 0);
  h.context.document.visibilityState = "hidden";
  h.snapshot();
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 0);
  h.context.document.visibilityState = "visible";
  h.context.scheduleMarkRead();
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 1);
});

test("pending acknowledgement coalesces snapshots and preserves newer unseen events", async () => {
  const ack = deferred();
  const h = await harness((request, payload) => request.action === "mark_read" ? ack.promise : payload());
  await h.start(); h.open(); h.snapshot(); h.events();
  await h.advance(800);
  assert.equal(h.context.state.contracts[0].unread, 5, "no optimistic unread clearing");
  h.snapshot(rawContract(7));
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 1);
  ack.resolve({ ok: true, contractId, readSeq: 5, eventSeq: 7 });
  await flush();
  assert.equal(h.context.state.thread.view.unread, 2);
  assert.equal(h.context.state.contracts[0].eventSeq, 7);
  assert.equal(h.context.state.contracts[0].unread, 2);
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 1, "unseen newer events remain unread");
});

test("new events loaded during an in-flight read get one follow-up, not concurrent calls", async () => {
  const ack = deferred();
  let reads = 0;
  const h = await harness((request, payload) => request.action === "mark_read"
    ? (++reads === 1 ? ack.promise : { ok: true, contractId, readSeq: request.seq, eventSeq: request.seq }) : payload());
  await h.start(); h.open(); h.snapshot(); h.events(); await h.advance(800);
  h.snapshot(rawContract(7)); h.events([1, 2, 3, 4, 5, 6, 7]); await h.advance(800);
  assert.equal(h.requests("mark_read").length, 1);
  ack.resolve({ ok: true, contractId, readSeq: 5, eventSeq: 5 });
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 2);
  assert.equal(h.requests("mark_read")[1].seq, 7);
  assert.equal(h.context.state.thread.view.unread, 0);
});

test("failure and legacy acknowledgement preserve unread and retry only on a new signal", async () => {
  let mode = "failure";
  const h = await harness((request, payload) => {
    if (request.action !== "mark_read") return payload();
    if (mode === "failure") throw new Error("offline");
    return { ok: true };
  });
  await h.start(); h.open(); h.snapshot(); h.events(); await h.advance(800);
  assert.equal(h.context.state.contracts[0].unread, 5);
  await h.advance(10000);
  assert.equal(h.requests("mark_read").length, 1);
  mode = "legacy";
  h.context.scheduleMarkRead(); await h.advance(800);
  assert.equal(h.requests("mark_read").length, 2);
  assert.equal(h.context.state.contracts[0].unread, 5);
  h.snapshot(rawContract(5, 5));
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 2);
});

test("old callbacks and timer cannot affect a reopened same-contract thread", async () => {
  const h = await harness();
  await h.start(); h.open(); h.snapshot(); h.events();
  const previous = h.subscriptions[0];
  const previousEvents = h.subscriptions[1];
  h.open();
  h.snapshot(rawContract(99), { subscription: previous });
  h.events([99], { subscription: previousEvents });
  previous.error(new Error("stale listener"));
  await h.advance(800);
  assert.equal(h.requests("mark_read").length, 0);
  assert.equal(h.context.state.thread.status, "loading");
  assert.equal(h.context.state.thread.events.length, 0);
  assert.equal(h.calls.filter((entry) => entry.toast === "stale listener").length, 0);
});

test("reopened same-contract thread shares pending read without accepting old-thread UI updates", async () => {
  const ack = deferred();
  const h = await harness((request, payload) => request.action === "mark_read" ? ack.promise : payload());
  await h.start(); h.open(); h.snapshot(); h.events(); await h.advance(800);
  h.open(); h.snapshot(rawContract(7)); h.events([1, 2, 3, 4, 5]); await h.advance(800);
  assert.equal(h.requests("mark_read").length, 1);
  ack.resolve({ ok: true, contractId, readSeq: 5, eventSeq: 5 }); await flush();
  assert.equal(h.context.state.thread.view.unread, 7, "old request does not patch new thread directly");
  h.snapshot(rawContract(7));
  assert.equal(h.context.state.thread.view.unread, 2, "known acknowledged prefix is merged without hiding newer events");
});

test("an old lifecycle read response cannot clear unread in a fresh entry", async () => {
  const ack = deferred();
  const h = await harness((request, payload) => request.action === "mark_read" ? ack.promise : payload());
  await h.start(); h.open(); h.snapshot(); h.events(); await h.advance(800);
  h.context.requestHome(); await h.start();
  ack.resolve({ ok: true, contractId, readSeq: 5, eventSeq: 5 }); await flush();
  assert.equal(h.context.state.contracts[0].unread, 5);
  assert.equal(h.context.markReadProgress.size, 0);
});
