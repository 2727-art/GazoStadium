"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, client, addFunctions, root } = require("./helpers/tribute-edge-harness.cjs");

test("all 50 active contracts survive newer ended history; ended pages use stable cursors and stay private", async () => {
  const { h, contractId } = await fixture();
  const raw = h.contract(contractId);
  h.firestore.delete(`tributeContracts/${contractId}`);
  for (let i = 1; i <= 85; i++) {
    const id = i.toString(16).padStart(40, "0");
    const ended = i > 50;
    h.firestore.write(`tributeContracts/${id}`, { ...raw, contractId: id, payerUid: `payer-${i}`, participants: ["manager", `payer-${i}`],
      status: ended ? "ended" : "active", updatedAt: h.now() + (ended ? 100 : 0) });
  }
  const state = await h.act("manager", "state");
  assert.equal(state.contracts.filter(c => c.status === "active").length, 50);
  assert.equal(state.contracts.filter(c => c.status === "ended").length, 10);
  const ended = state.contracts.filter(c => c.status === "ended");
  let cursor = state.endedCursor;
  while (cursor) {
    const page = await h.act("manager", "ended_contracts", { cursor });
    ended.push(...page.contracts);
    cursor = page.nextCursor;
  }
  assert.equal(ended.length, 35);
  assert.equal(new Set(ended.map(c => c.contractId)).size, 35, "equal timestamps do not skip or repeat contracts");
  assert.equal((await h.act("payer", "ended_contracts")).contracts.length, 0);
  await assert.rejects(h.act("manager", "ended_contracts", { cursor: { updatedAt: 1, contractId: "invalid" } }), { code: "invalid-argument" });
});

test("ranking entry summary omits contracts and achievement processing without changing stored data", async () => {
  const { h } = await fixture();
  const before = structuredClone([...h.firestore.documents]);
  const result = await h.act("manager", "state", { summaryOnly: true });
  assert.equal(result.ageConfirmed, true);
  assert.ok(result.profile);
  assert.equal(result.contracts, undefined);
  assert.equal(result.achievements, undefined);
  assert.deepEqual([...h.firestore.documents], before);
});

for (const action of ["board", "rankings", "manager", "decorations", "receipts"]) {
  test(`${action}: concurrent reads share one request; completed reads refresh, writes and account changes invalidate it`, async () => {
    let slow = false;
    let gate = client.deferred();
    const h = await client.harness((_request, payload) => slow ? gate.promise : payload());
    await h.start();
    slow = true;
    const first = h.context.readOnce(action, { key: "one" });
    assert.strictEqual(first, h.context.readOnce(action, { key: "one" }));
    assert.equal(h.requests(action).length, 1);
    gate.resolve({ ok: true });
    assert.equal((await first).ok, true);
    gate = client.deferred();
    const next = h.context.readOnce(action, { key: "one" });
    assert.equal(h.requests(action).length, 2);
    h.context.state.readRequests.clear();
    gate.resolve({ stale: true });
    assert.equal(await next, null);
    h.context.auth.currentUser = { uid: "different" };
    await assert.rejects(h.context.readOnce(action), /アカウント/);
  });
}

test("unconfirmed entry does not subscribe to the wallet; leaving a photo releases its object URL", async () => {
  const h = await client.harness(() => ({ ageConfirmed: false }));
  addFunctions(h.context, ["subscribeWallet"]);
  await h.start();
  assert.equal(h.context.state.screen, "age");
  assert.equal(h.subscriptions.length, 0);
  const revoked = [];
  h.context.URL = { revokeObjectURL: value => revoked.push(value) };
  h.context.state.sheet = { type: "ranch-photo", previewUrl: "blob:photo-test" };
  h.context.requestHome();
  assert.deepEqual(revoked, ["blob:photo-test"]);
});

test("wallet subscription starts after age confirmation and ranking entry uses the summary request", async () => {
  const h = await client.harness((request, payload) => request.action === "state" ? payload() : { ok: true });
  addFunctions(h.context, ["subscribeWallet", "loadRanking", "loadList"]);
  h.context.SCREENS.add("ranking");
  await h.context.start({ initialScreen: "ranking" });
  await client.flush();
  assert.equal(h.requests("state")[0].summaryOnly, true);
  h.context.requestHome();
  await h.start();
  h.context.state.ageConfirmed = false;
  const form = { dataset: { form: "age" }, elements: { adult: { checked: true }, premise: { checked: true } }, querySelector: () => null };
  await h.context.handleSubmit(form);
  assert.equal(h.subscriptions.filter(s => s.active && s.reference === "wallets/player").length, 1);
});

test("overlapping board navigation shares the RPC and paints the latest target", async () => {
  const gate = client.deferred();
  const h = await client.harness((request, payload) => request.action === "board" ? gate.promise : payload());
  await h.start(); addFunctions(h.context, ["loadBoard"]);
  h.context.navigate("board"); h.context.navigate("board");
  assert.equal(h.requests("board").length, 1);
  gate.resolve({ managers: [{ publicManagerId: "saved" }] }); await client.flush();
  assert.equal(h.context.state.board.status, "ready");
  assert.equal(h.context.state.board.managers[0].publicManagerId, "saved");
});

test("the image renderer is only imported on demand and keeps the existing share labels", () => {
  const source = fs.readFileSync(path.join(root, "tribute.js"), "utf8");
  assert.doesNotMatch(source, /from "\.\/tribute-share\.mjs/);
  assert.match(source, /import\("\.\/tribute-share\.mjs\?v=/);
  const imageSource = fs.readFileSync(path.join(root, "tribute-share.mjs"), "utf8");
  for (const name of ["SHARE_TEXT", "RANCH_PHOTO_TEXT"]) {
    const value = new RegExp(`const ${name} = ("[^"]+")`).exec(source)[1];
    assert.ok(imageSource.includes(`const ${name} = ${value}`));
  }
});

test("history pages request only earlier ranges, preserve receipt updates, and unsubscribe together", async () => {
  const h = await client.harness();
  await h.start(); h.open(); h.snapshot();
  h.events([201, 202, 203]);
  const cursors = [];
  h.context.endBefore = seq => cursors.push(seq);
  h.context.loadOlderThreadEvents();
  assert.deepEqual(cursors, [201]);
  const older = h.subscriptions.at(-1);
  h.events([101, 102, 200], { subscription: older });
  const latest = h.subscriptions.filter(s => s.reference.endsWith('/events') && s.active && s !== older).at(-1);
  h.events([201, 202, 203, 204], { subscription: latest });
  assert.deepEqual(Array.from(h.context.state.thread.events, e => e.seq), [101, 102, 200, 201, 202, 203, 204]);
  h.context.loadOlderThreadEvents();
  assert.deepEqual(cursors, [201, 101]);
  const oldest = h.subscriptions.at(-1);
  h.events([1, 2, 100], { subscription: oldest });
  older.next({ docs: [101, 102, 200].map(seq => ({ data: () => ({ seq, receivedAt: seq === 101 ? 500 : 0 }) })) });
  assert.equal(h.context.state.thread.events.find(e => e.seq === 101).receivedAt, 500);
  h.context.requestHome();
  assert.equal(h.subscriptions.filter(s => s.active).length, 0);
  const count = h.context.state.thread.events.length;
  h.events([999], { subscription: oldest });
  assert.equal(h.context.state.thread.events.length, count, "late history callbacks do not paint after leaving");
});
