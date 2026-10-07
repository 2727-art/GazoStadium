"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../ai-text-training.js"), "utf8");
const block = (first, next) => source.slice(source.indexOf(first), source.indexOf(next, source.indexOf(first)));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

function harness({ actionHandler, outcome = "completed", sessionId = OLD } = {}) {
  let queue = [{ actionId: "old-action", ownerUid: "owner", ownerState: "bound", modeId: "standard",
    roundSeconds: 20, sessionId, outcome, completedRounds: 5, activeSeconds: 100 }];
  const calls = [];
  const notifications = [];
  const persisted = [];
  const state = { achievementActionId: "old-action", achievementSessionId: sessionId,
    screen: "play", phase: "playing", preview: false };
  const auth = { currentUser: { uid: "owner" } };
  const context = vm.createContext({ state, active: true, auth, achievementRetryFlushPromise: null,
    normalizeAchievementOwnerUid: (value) => String(value || ""),
    achievementRetryOwnerMatches: (a, b) => a.ownerState === b.ownerState && a.ownerUid === b.ownerUid,
    bindPendingAchievementRetryRecords: () => structuredClone(queue),
    readAchievementRetryQueue: () => structuredClone(queue),
    writeAchievementRetryQueue: (records) => { queue = structuredClone(records); return queue; },
    upsertAchievementRetryRecord: (record) => {
      queue = queue.map((item) => item.actionId === record.actionId ? structuredClone(record) : item);
      return record;
    },
    persistSession: () => persisted.push(context.state.achievementSessionId),
    notifyAchievementUnlocks: (ids) => { if (ids?.length) notifications.push({ uid: auth.currentUser.uid, ids: [...ids] }); },
    render() {},
    aiTextTrainingAction: async (payload) => {
      calls.push({ ...payload, ownerUid: auth.currentUser.uid });
      if (actionHandler) return actionHandler(payload);
      return { data: { session: { id: payload.sessionId || OLD }, newlyUnlocked: payload.action === "finish_achievement_session" ? ["training_1"] : [] } };
    },
  });
  vm.runInContext(`${block("function closeAiTextTrainingLightsPresence", "async function releaseWakeLock")}\n${block("function flushAchievementRetryQueue", "function createState")}\nthis.flushQueue = flushAchievementRetryQueue; this.sync = syncAiTextTrainingLightsPresence;`, context);
  return { context, state, auth, calls, notifications, persisted,
    queue: () => queue, flush: context.flushQueue, sync: context.sync,
    replaceState: () => { context.state = { achievementActionId: "new-action", achievementSessionId: NEW, screen: "play", preview: false }; return context.state; },
  };
}

test("begin and completed finish remain, followed by one close and no heartbeat", async () => {
  const h = harness({ sessionId: "" });
  assert.equal(await h.flush(), true);
  assert.deepEqual(h.calls.map((call) => call.action), ["begin_achievement_session", "finish_achievement_session", "close_achievement_presence"]);
  assert.equal(h.queue().length, 0);
  assert.equal(h.notifications.length, 1);
});

test("a running begin without outcome sends neither periodic presence nor a terminal close", async () => {
  const h = harness({ sessionId: "", outcome: "" });
  await h.flush();
  for (let i = 0; i < 20; i++) await h.sync();
  assert.deepEqual(h.calls.map((call) => call.action), ["begin_achievement_session"]);
  assert.equal(h.queue().length, 1);
});

test("late begin after exit and new screen closes only the old record's session", async () => {
  let resolveBegin;
  const h = harness({ sessionId: "", outcome: "exited", actionHandler: (payload) => {
    if (payload.action === "begin_achievement_session") return new Promise((resolve) => { resolveBegin = resolve; });
    return { data: { session: { id: payload.sessionId } } };
  } });
  const work = h.flush();
  await flush();
  const fresh = h.replaceState();
  resolveBegin({ data: { session: { id: OLD } } });
  assert.equal(await work, true);
  assert.deepEqual(h.calls.map((call) => call.action), ["begin_achievement_session", "finish_achievement_session", "close_achievement_presence"]);
  assert.equal(h.calls.at(-1).sessionId, OLD);
  assert.equal(fresh.achievementSessionId, NEW);
  assert.equal(fresh.trainingLightsClosedSessionId, undefined);
  assert.equal(h.persisted.length, 0);
});

test("close failure retains retry data without losing already committed achievement unlocks", async () => {
  let failures = 1;
  let finishes = 0;
  const h = harness({ actionHandler: (payload) => {
    if (payload.action === "close_achievement_presence" && failures-- > 0) throw new Error("offline");
    if (payload.action === "finish_achievement_session") {
      finishes++;
      return { data: { session: { id: OLD }, newlyUnlocked: finishes === 1 ? ["training_1"] : [] } };
    }
    return { data: {} };
  } });
  assert.equal(await h.flush(), false);
  assert.equal(h.queue().length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(await h.flush(), true);
  assert.equal(h.queue().length, 0);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.calls.filter((call) => call.action === "close_achievement_presence").length, 2);
});

test("finish reuses an already pending terminal close for the same session", async () => {
  let resolveClose;
  const h = harness({ actionHandler: (payload) => payload.action === "close_achievement_presence"
    ? new Promise((resolve) => { resolveClose = resolve; }) : { data: { session: { id: OLD } } } });
  const closing = h.sync({ close: true });
  const finishing = h.flush();
  await flush();
  assert.equal(h.calls.filter((call) => call.action === "close_achievement_presence").length, 1);
  resolveClose({ data: {} });
  await closing;
  assert.equal(await finishing, true);
  assert.equal(h.queue().length, 0);
});

test("account change during finish prevents close, notification and dequeue for the new owner", async () => {
  let resolveFinish;
  const h = harness({ actionHandler: (payload) => payload.action === "finish_achievement_session"
    ? new Promise((resolve) => { resolveFinish = resolve; }) : { data: {} } });
  const work = h.flush();
  await flush();
  h.auth.currentUser.uid = "different-owner";
  resolveFinish({ data: { session: { id: OLD }, newlyUnlocked: ["training_1"] } });
  assert.equal(await work, false);
  assert.equal(h.queue().length, 1);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.calls.some((call) => call.action === "close_achievement_presence"), false);
});

test("account change during close retains the old owner's retry record and never notifies the new owner", async () => {
  let resolveClose;
  const h = harness({ actionHandler: (payload) => payload.action === "close_achievement_presence"
    ? new Promise((resolve) => { resolveClose = resolve; })
    : { data: { session: { id: OLD }, newlyUnlocked: ["training_1"] } } });
  const work = h.flush();
  await flush();
  h.auth.currentUser.uid = "different-owner";
  resolveClose({ data: {} });
  assert.equal(await work, false);
  assert.equal(h.queue().length, 1);
  assert.deepEqual(h.notifications.map((item) => item.uid), ["owner"]);
  assert.equal(h.persisted.length, 0);
});
