"use strict";

// 出稼ぎ命令（ranch-work-orders-v1）: 管理人が「1on1を○回完走してこい」と命じ、財布が完走して報告し、管理人が確かめる。
// Payは動かさず、命令の後の正式完走だけを数える。命令した時の完走数は、財布だけが読める private/work に置く。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const { server } = require("./helpers/tribute-edge-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

const APPLICATION = { caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true };

async function setup({ allowWorkOrders = true, matches = 7 } = {}) {
  const h = server.createHarness({ balances: { manager: 500, payer: 500 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  h.setMatches("payer", matches);
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowWorkOrders }, 0);
  h.advance(2_100);
  const act = (uid, action, data = {}) => h.act(uid, action, { contractId, ...data });
  return { h, contractId, act };
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

const workEvents = (h, contractId) => h.events(contractId).filter((event) => String(event.type).startsWith("work_"));

test("payers opt in on applying; old screens and old contracts never receive orders", async () => {
  assert.equal(rules.normalizeApplication(APPLICATION).application.allowWorkOrders, false, "an application without the field does not opt in");
  assert.equal(rules.normalizeApplication({ ...APPLICATION, allowWorkOrders: true }).application.allowWorkOrders, true);
  assert.equal(rules.normalizeApplication({ ...APPLICATION, allowWorkOrders: "yes" }).application.allowWorkOrders, false);
  const core = await loadCore();
  assert.deepEqual(core.WORK_ORDER_TARGETS, rules.WORK_ORDER_TARGETS);
  assert.deepEqual([...rules.WORK_ORDER_TARGETS], [1, 3, 5, 10], "the same steps as the daily play reward");

  const { h, contractId, act } = await setup({ allowWorkOrders: false });
  assert.equal(h.contract(contractId).allowWorkOrders, false);
  await rejects(act("manager", "work_order", { target: 3 }), /出稼ぎ命令を出せません/);
  // この設定より前の契約（項目がない）も、受けないとして扱う。
  const legacy = h.contract(contractId);
  delete legacy.allowWorkOrders;
  h.firestore.write(`tributeContracts/${contractId}`, legacy);
  await rejects(act("manager", "work_order", { target: 3 }), /出稼ぎ命令を出せません/);
  const applied = h.events(contractId).find((event) => event.type === "applied");
  assert.equal(applied.allowWorkOrders, false);
});

test("an order counts only the verified completions after it, and the server writes the report", async () => {
  const { h, contractId, act } = await setup({ matches: 7 });
  const ledgerBefore = { manager: h.ledger("manager").length, payer: h.ledger("payer").length };
  const balancesBefore = { manager: h.balance("manager"), payer: h.balance("payer") };
  const activeBefore = h.firestore.read("tributeProfiles/manager").lastActiveAt;

  const ordered = await act("manager", "work_order", { target: 3, note: "財布が空なら稼いでこい。" });
  assert.deepEqual(ordered.contract.workOrder, {
    orderSeq: 1, target: 3, note: "財布が空なら稼いでこい。", issuedAt: h.now(), reportedCount: 0, reportedAt: 0, done: false, doneAt: 0,
  });
  assert.ok(h.firestore.read("tributeProfiles/manager").lastActiveAt > activeBefore, "ordering counts as manager activity");
  // 命令した時の完走数は、財布だけが読める private/work に置き、管理人も読む契約の記録には書かない。
  assert.deepEqual(h.firestore.read(`tributeContracts/${contractId}/private/work`), {
    contractId, payerUid: "payer", orderSeq: 1, baselineMatches: 7, updatedAt: h.now(),
  });
  assert.equal(JSON.stringify(h.contract(contractId)).includes("baselineMatches"), false);
  assert.deepEqual(workEvents(h, contractId).map(({ type, target, note }) => ({ type, target, note })), [
    { type: "work_order", target: 3, note: "財布が空なら稼いでこい。" },
  ]);

  // 命令より前の完走は数えない。
  assert.deepEqual(await act("payer", "work_progress"), { ok: true, contractId, workOrder: ordered.contract.workOrder, count: 0 });
  h.setMatches("payer", 8);
  assert.equal((await act("payer", "work_progress")).count, 1);
  await rejects(act("manager", "work_progress"), /この操作はできません/);

  const partial = await act("payer", "work_report", { count: 99 });
  assert.equal(partial.count, 1, "the client's number is ignored");
  assert.equal(partial.done, false);
  assert.equal(partial.contract.workOrder.reportedCount, 1);
  assert.equal(partial.contract.workOrdersDone, 0);

  h.advance(2_100);
  h.setMatches("payer", 15);
  const finished = await act("payer", "work_report");
  assert.equal(finished.count, 3, "capped at the ordered number");
  assert.equal(finished.done, true);
  assert.equal(finished.contract.workOrder.done, true);
  assert.equal(finished.contract.workOrdersDone, 1);
  assert.deepEqual(workEvents(h, contractId).slice(1).map(({ type, count, done }) => ({ type, count, done })), [
    { type: "work_report", count: 1, done: false },
    { type: "work_report", count: 3, done: true },
  ]);
  // 果たした命令には、もう報告できない（進み具合も返さない）。
  await rejects(act("payer", "work_report"), /報告できる出稼ぎ命令はありません/);
  assert.equal((await act("payer", "work_progress")).workOrder, null);

  // 命令・報告ではPayが動かない。
  assert.deepEqual({ manager: h.balance("manager"), payer: h.balance("payer") }, balancesBefore);
  assert.deepEqual({ manager: h.ledger("manager").length, payer: h.ledger("payer").length }, ledgerBefore);
});

test("the manager confirms a finished order once, with a seal and an optional reward", async () => {
  const { h, contractId, act } = await setup({ matches: 0 });
  await act("payer", "message", { text: "行ってきます。" });
  await act("manager", "mark_read", { seq: h.contract(contractId).eventSeq });
  assert.ok(h.contract(contractId).ignoredSince > 0, "read without a reply");
  await act("manager", "work_order", { target: 1 });
  await rejects(act("manager", "work_confirm", { seal: "yoku" }), /確認できる出稼ぎ報告はありません/);
  h.setMatches("payer", 1);
  h.advance(2_100);
  await act("payer", "work_report");
  assert.ok(h.contract(contractId).ignoredSince > 0, "a report is not a payer message");
  assert.equal(h.contract(contractId).lastPayerMessageSeq < h.contract(contractId).eventSeq, true);

  await rejects(act("payer", "work_confirm", { seal: "yoku" }), /この操作はできません/);
  await rejects(act("manager", "work_confirm", { seal: "yoku", reward: "bogus" }), /ご褒美/, "a reward outside the list is refused");
  const confirmed = await act("manager", "work_confirm", { seal: "yoku", reward: "zako" });
  assert.equal(confirmed.contract.workOrder, null);
  assert.equal(confirmed.contract.workOrdersDone, 1);
  const event = workEvents(h, contractId).at(-1);
  assert.deepEqual(
    { type: event.type, orderSeq: event.orderSeq, target: event.target, count: event.count, seal: event.seal, reward: event.reward, sealShape: event.sealShape, sealInk: event.sealInk },
    { type: "work_confirm", orderSeq: 1, target: 1, count: 1, seal: "yoku", reward: "zako", sealShape: "date", sealInk: "shu" },
  );
  assert.equal(h.contract(contractId).ignoredSince, 0, "a reward is a reply");
  await rejects(act("manager", "work_confirm", { seal: "yoku" }), /確認できる出稼ぎ報告はありません/);
});

test("one open order at a time; a finished but unconfirmed order closes when the next one is issued", async () => {
  const { h, contractId, act } = await setup({ matches: 2 });
  await rejects(act("manager", "work_order", { target: 4 }), /回数を選び直してください/);
  await rejects(act("payer", "work_order", { target: 3 }), /この操作はできません/);
  await rejects(act("manager", "work_order", { target: 3, note: "1000円持ってこい" }), /現実のお金の金額は送れません/);
  await rejects(act("manager", "work_order", { target: 3, note: "ブスは稼いでこい" }), /言われたくない言葉/);
  await act("manager", "work_order", { target: 1 });
  h.advance(2_100);
  await rejects(act("manager", "work_order", { target: 3 }), /1件ずつ/);
  h.setMatches("payer", 3);
  await act("payer", "work_report");
  const next = await act("manager", "work_order", { target: 5, note: "稼いでから顔を出せ。" });
  assert.equal(next.contract.workOrder.orderSeq, 2);
  assert.equal(next.contract.workOrder.target, 5);
  assert.equal(h.firestore.read(`tributeContracts/${contractId}/private/work`).baselineMatches, 3);
  assert.equal(next.contract.workOrdersDone, 1, "the finished order still counts");
});

test("the manager can withdraw; the payer can turn orders off, which cancels an open order", async () => {
  const { h, contractId, act } = await setup();
  await rejects(act("manager", "work_withdraw"), /取り下げられる出稼ぎ命令はありません/);
  await act("manager", "work_order", { target: 3 });
  const withdrawn = await act("manager", "work_withdraw");
  assert.equal(withdrawn.contract.workOrder, null);
  await rejects(act("payer", "work_report"), /報告できる出稼ぎ命令はありません/);
  assert.deepEqual(workEvents(h, contractId).at(-1).reason, "withdrawn");

  h.advance(2_100);
  await act("manager", "work_order", { target: 3 });
  await rejects(act("manager", "set_work_orders", { allowWorkOrders: false }), /この操作はできません/);
  const off = await act("payer", "set_work_orders", { allowWorkOrders: false });
  assert.equal(off.contract.allowWorkOrders, false);
  assert.equal(off.contract.workOrder, null);
  assert.deepEqual(h.events(contractId).slice(-2).map(({ type, actor, reason, allowWorkOrders }) => ({ type, actor, reason, allowWorkOrders })), [
    { type: "work_orders_changed", actor: "payer", reason: undefined, allowWorkOrders: false },
    { type: "work_withdrawn", actor: "system", reason: "setting", allowWorkOrders: undefined },
  ]);
  assert.equal((await act("payer", "set_work_orders", { allowWorkOrders: false })).unchanged, true);
  h.advance(2_100);
  await rejects(act("manager", "work_order", { target: 3 }), /出稼ぎ命令を出せません/);
  await act("payer", "set_work_orders", { allowWorkOrders: true });
  assert.equal((await act("manager", "work_order", { target: 3 })).contract.workOrder.orderSeq, 3);
});

test("ending the contract clears the order", async () => {
  const { h, contractId, act } = await setup();
  await act("manager", "work_order", { target: 3 });
  const ended = await act("payer", "terminate");
  assert.equal(ended.contract.status, "ended");
  assert.equal(h.contract(contractId).workOrder, null);
  assert.equal((await act("payer", "work_progress")).workOrder, null);
  await rejects(act("payer", "work_report"), /終了しています/);
});

test("the manager cannot read the starting count; the function passes the verified match count", () => {
  const firestoreRules = read("firestore.rules");
  const privateRule = firestoreRules.slice(firestoreRules.indexOf("match /private/{docId}"), firestoreRules.indexOf("match /tributeProfiles/{uid}"));
  assert.match(privateRule, /request\.auth\.uid == get\(\/databases\/\$\(database\)\/documents\/tributeContracts\/\$\(contractId\)\)\.data\.payerUid;/);
  assert.match(privateRule, /allow write: if false;/);
  const index = read("functions/index.js");
  const wiring = index.slice(index.indexOf("const tributeService = createTributeService({"), index.indexOf("const TRIBUTE_GOOGLE_ACTIONS"));
  assert.match(wiring, /economyProgressRef,\n  totalVerifiedMatches: \(progress\) => normalizeEconomyProgress\(progress\)\.achievementStats\.totalMatches,/);
});

// ───────────── 画面 ─────────────

const { client, addFunctions, core, deco } = require("./helpers/tribute-edge-harness.cjs");
const vm = require("node:vm");

const clientSource = read("tribute.js");
const contractId = "a".repeat(40);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

function rawWithOrder(order, extra = {}) {
  return {
    contractId, managerUid: "manager", payerUid: "player", status: "active", acceptedAt: 1, expiresAt: Date.now() + 86_400_000,
    eventSeq: 3, readSeq: { payer: 3, manager: 3 }, caps: { perTribute: 100, perDay: 300, total: 1_000 }, tone: "harsh",
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowWorkOrders: true, workOrder: order, ...extra,
  };
}

async function threadRenderer() {
  const module = await core;
  const context = vm.createContext({ ...module, ...await deco, previewScreen: "", sealChoices: new Map(),
    state: { profile: { card: { seals: ["yoku", "zako"] } }, thread: {}, contracts: [], walletBalance: 500 },
    frame: (html) => html, escapeHtml: String, renderBlockButton: () => "", renderTemplates: () => "", renderThreadHead: () => "", sealSvg: () => "" });
  addFunctions(context, ["formatDateTime", "requestStatusMap", "purposeTag", "renderReceiveControls", "rewardChips", "renderWantChips", "renderResistRow", "renderHold", "renderGiveButton", "refundPendingText", "renderEvent", "elapsedLabel", "requestLimitProblem", "renderPayableRequest", "renderThreadActions", "renderThreadActionButtons", "retryReasonText", "canShowShot", "renderShotButton", "renderPendingRequests", "renderWorkOrder", "renderWorkConfirmControls", "renderThreadHistory", "renderThreadEvents", "renderRequestMark", "contractCounterpart", "managerNickname", "renderThread"]);
  return (raw, uid, { work = null, events = [], demo = false } = {}) => {
    context.state.thread = { view: module.viewContract(raw, uid), events, work, demo };
    return context.renderThread();
  };
}

const OPEN = { orderSeq: 2, target: 3, note: "財布が空なら稼いでこい。", issuedAt: 1, reportedCount: 1, reportedAt: 1_800_000_000_000, doneAt: 0 };
const DONE = { ...OPEN, reportedCount: 3, doneAt: 1_800_000_000_000 };

test("the payer sees live progress and a way to the 1on1; the manager sees only what was reported", async () => {
  const render = await threadRenderer();
  const payer = render(rawWithOrder(OPEN), "player", { work: { orderSeq: 2, count: 2 } });
  assert.match(payer, /出稼ぎ命令<\/span><strong>1on1を 3回 完走<\/strong>/);
  assert.match(payer, /「財布が空なら稼いでこい。」/);
  assert.match(payer, /いま <b>2 \/ 3回<\/b>/);
  assert.match(payer, /data-t="earn" data-mode="battle">1on1へ<\/button>/);
  assert.match(payer, /data-t="work-report">途中まで報告する</);
  assert.match(payer, /期限はなく、果たさなくても何も起きません/);
  assert.match(render(rawWithOrder(OPEN), "player", { work: { orderSeq: 2, count: 3 } }), /data-t="work-report">果たしたと報告する</);
  assert.match(render(rawWithOrder(OPEN), "player", { work: { orderSeq: 1, count: 3 } }), /数えています…/, "a count for an older order is not shown");

  const manager = render(rawWithOrder(OPEN), "manager", { work: { orderSeq: 2, count: 2 } });
  assert.match(manager, /報告 <b>1 \/ 3回<\/b>/);
  assert.doesNotMatch(manager, /いま <b>/, "live progress is never shown to the manager");
  assert.match(manager, /data-t="work-withdraw"/);
  assert.match(manager, /disabled>出稼ぎ中<\/button>/, "one order at a time");
  assert.match(render(rawWithOrder(null), "manager"), /data-sheet="work" >出稼ぎに行かせる<\/button>/);
  assert.doesNotMatch(render(rawWithOrder(null, { allowWorkOrders: false }), "manager"), /出稼ぎに行かせる/);

  const done = render(rawWithOrder(DONE), "manager");
  assert.match(done, /出稼ぎの報告<\/span><strong>果たしました（3 \/ 3回）/);
  assert.match(done, /name="seal-work" value="yoku" checked/);
  assert.match(done, /data-t="work-confirm" data-reward="zako">ざこ♡/);
  // 契約の強さは上限。辛口までの契約では、甘めのご褒美も選べる（2026-10-27）。
  assert.match(done, /data-reward="iiko"/, "a harsh contract also offers the softer rewards");
  assert.doesNotMatch(render(rawWithOrder(DONE, { tone: "sweet" }), "manager"), /data-reward="zako"/, "a sweet contract never offers harsh rewards");
  assert.match(render(rawWithOrder(DONE), "player"), /ミオ様の確認を待っています/);
  assert.doesNotMatch(render(rawWithOrder(OPEN, { status: "ended" }), "player"), /tribute-work-order/);

  const demo = render(rawWithOrder(OPEN), "player", { demo: true, work: { orderSeq: 2, count: 0 } });
  assert.doesNotMatch(demo, /data-mode="battle"/, "the sample contract does not send people away");
  assert.match(demo, /見本では完走を数えず、何も送りません。/);
});

test("timeline lines for orders, reports, confirmation and withdrawal", async () => {
  const render = await threadRenderer();
  const events = [
    { seq: 1, type: "work_order", actor: "manager", orderSeq: 1, target: 3, note: "稼いでから顔を出せ。", createdAt: 1 },
    { seq: 2, type: "work_report", actor: "payer", orderSeq: 1, target: 3, count: 3, done: true, createdAt: 2 },
    { seq: 3, type: "work_confirm", actor: "manager", orderSeq: 1, target: 3, count: 3, seal: "yoku", reward: "zako", createdAt: 3 },
    { seq: 4, type: "work_withdrawn", actor: "system", orderSeq: 2, reason: "setting", createdAt: 4 },
    { seq: 5, type: "work_orders_changed", actor: "payer", allowWorkOrders: true, createdAt: 5 },
  ];
  const html = render(rawWithOrder(null, { workOrdersDone: 1 }), "player", { events });
  assert.match(html, /is-work-order is-theirs"><div class="tribute-work-card"><span class="tribute-eyebrow">出稼ぎ命令<\/span><strong>1on1を 3回 完走<\/strong><p>「稼いでから顔を出せ。」<\/p>/);
  assert.match(html, /出稼ぎ報告：命令の後の1on1 <b>3 \/ 3回<\/b>（サーバーが記入） ・ 果たしました/);
  assert.match(html, /ミオ様が出稼ぎ（3 \/ 3回）を確かめました。/);
  assert.match(html, /ミオ様から出稼ぎへのご褒美：<\/span>ざこ♡/);
  assert.match(html, /出稼ぎ命令を受けるのをやめたので、命令は消えました。/);
  assert.match(html, /出稼ぎ命令を受けるようにしました。/);
});

test("progress is counted once per order on opening, not on every snapshot", async () => {
  const h = await client.harness(async (request, statePayload) => (
    request.action === "work_progress" ? { ok: true, contractId, workOrder: { orderSeq: 2, target: 3 }, count: 2 } : statePayload()
  ));
  await h.start();
  h.open();
  h.snapshot(rawWithOrder(OPEN));
  await h.advance(10);
  h.snapshot(rawWithOrder({ ...OPEN, reportedCount: 2 }));
  h.snapshot(rawWithOrder({ ...OPEN, reportedCount: 2 }));
  await h.advance(10);
  assert.equal(h.requests("work_progress").length, 1);
  assert.deepEqual({ ...h.context.state.thread.work }, { orderSeq: 2, count: 2 });
  h.snapshot(rawWithOrder({ ...OPEN, orderSeq: 3 }));
  await h.advance(10);
  assert.equal(h.requests("work_progress").length, 2, "a new order is counted again");
  h.snapshot(rawWithOrder(DONE));
  h.snapshot(rawWithOrder(null));
  await h.advance(10);
  assert.equal(h.requests("work_progress").length, 2, "finished or no orders are not counted");

  const manager = await client.harness();
  await manager.start();
  manager.context.auth.currentUser = { uid: "manager" };
  manager.context.state.uid = "manager";
  manager.open();
  manager.snapshot(rawWithOrder(OPEN));
  await manager.advance(10);
  assert.equal(manager.requests("work_progress").length, 0, "the manager never asks for live progress");
});

test("payers opt in on applying and can change it from the thread; sheets, notes, sample and preview", async () => {
  const apply = sourceBlock(clientSource, "function renderApply", "function renderCardEditor");
  assert.match(apply, /<input type="checkbox" name="allowWorkOrders" \$\{checked\("allowWorkOrders", true\)\} \/><span>出稼ぎ命令を受ける/);
  assert.match(clientSource, /allowScreenshots: data\.get\("allowScreenshots"\) === "on",\s*allowWorkOrders: data\.get\("allowWorkOrders"\) === "on",/);
  assert.equal((clientSource.match(/data-sheet="work-settings">出稼ぎの設定<\/button>/g) || []).length, 2, "pending and active payer threads");
  const settings = sourceBlock(clientSource, 'case "work-settings": {', 'case "end":');
  assert.match(settings, /if \(view\.role !== "payer"\) return "";/);
  assert.match(settings, /data-t="set-work-orders"/);
  const sheet = sourceBlock(clientSource, 'case "work": {', 'case "work-settings": {');
  assert.match(sheet, /if \(view\.role !== "manager"\) return "";/);
  assert.match(sheet, /WORK_ORDER_TARGETS\.map/);
  assert.match(sheet, /workOrderNotesFor\(view\.tone, \{ collarNo: view\.collarNo, ngWords: view\.ngWords \}\)/);
  assert.match(sourceBlock(clientSource, 'case "work-order": {', 'case "take": {'), /mutate\("work_order", contractPayload\(\{ target, note \}\)/);
  assert.match(sourceBlock(clientSource, 'case "work-report": {', 'case "work-withdraw":'), /mutate\("work_report", contractPayload\(\), \{/, "the client never sends a count");

  const coreModule = await core;
  // 契約の強さ（上限）までの候補を、強い順に並べる。
  assert.deepEqual(coreModule.workOrderNotesFor("harsh").slice(0, 3), ["財布が空なら稼いでこい。", "養分は働いて貢ぐもの。", "稼いでから顔を出せ。"]);
  assert.ok(coreModule.workOrderNotesFor("harsh").includes("1on1で少し稼いできてね♡"), "the softer lines stay under a harsh ceiling");
  assert.deepEqual(coreModule.workOrderNotesFor("sweet"), ["1on1で少し稼いできてね♡", "がんばってきたら褒めてあげる。"]);
  assert.ok(coreModule.workOrderNotesFor("harsh", { collarNo: 3 }).includes("3号、出稼ぎの時間だ。"));
  assert.doesNotMatch(coreModule.workOrderNotesFor("harsh", { ngWords: ["養分"] }).join(), /養分/);
  for (const lines of Object.values(coreModule.WORK_ORDER_NOTES)) {
    assert.doesNotMatch(lines.join(), /今日中|急げ|すぐ|限度額|解約|やめ/, "no deadlines, no pressure on limits or leaving");
  }
  const todos = coreModule.contractTodos([
    coreModule.viewContract(rawWithOrder(OPEN), "player"),
    coreModule.viewContract({ ...rawWithOrder(DONE), contractId: "b".repeat(40) }, "manager"),
  ]);
  assert.deepEqual(todos.filter((todo) => todo.kind.startsWith("work")).map(({ kind, label, total }) => ({ kind, label, total })), [
    { kind: "work_done", label: "出稼ぎの報告", total: 1 },
    { kind: "work", label: "出稼ぎ命令", total: 1 },
  ]);

  const demo = sourceBlock(clientSource, "function demoThread", "// 招待リンク（?ranch=公開ID）");
  assert.match(demo, /type: "work_order"/);
  for (const action of ["work_progress", "work_order", "work_report", "work_withdraw", "work_confirm", "set_work_orders"]) {
    assert.match(sourceBlock(clientSource, "function previewCall", "function previewBoardUntil"), new RegExp(`case "${action}": \\{`), action);
  }
  const html = read("index.html");
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-work-orders-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(clientSource, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-work-orders-v1(?:-[a-z0-9-]+)?"/);
  assert.match(read("tribute.css"), /\.tribute-thread-screen\.is-shot #tributeWorkOrder,/, "hidden in the screenshot view");
  const design = read("TRIBUTE_DESIGN.md");
  assert.match(design, /### 出稼ぎ命令（財布の金欠対策）/);
  assert.match(design, /\| 出稼ぎ命令 \| 受ける \/ 受けない（既定は受ける。7節） \| 預ける側 \|/);
});
