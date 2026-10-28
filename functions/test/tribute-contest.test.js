"use strict";

// 出稼ぎ命令の勝負の型（ranch-contest-v1、設計書15.3）。2026-10-28 のユーザーの決定:
// 出稼ぎ命令は置き換えず、「完走」に「勝負」を足す。「○日以内に1on1で○勝しろ。負けたら罰金 ○Pay」。
// 罰金があるので財布がその都度「受ける／断る」を選び、断っても何も起きない。勝ち数は、受けた時からの
// 「検証済みの完走数の増分 − 負け数の増分」で、期限までに報告した数で決まる。罰金は自動で引き落とさない。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const { server } = require("./helpers/tribute-edge-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const DAY = 86_400_000;

async function setup({ allowWorkOrders = true, matches = 10, losses = 4 } = {}) {
  const h = server.createHarness({ balances: { manager: 500, payer: 2_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  h.setRecord("payer", matches, losses);
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowWorkOrders }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  return { h, contractId, act };
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

const CONTEST = { kind: "contest", target: 3, days: 1, penalty: 50 };
const workEvents = (h, contractId) => h.events(contractId).filter((event) => String(event.type).startsWith("work_"));

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

test("rules: choices, the win count and the same views on both sides", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.CONTEST_TARGETS], [...rules.CONTEST_TARGETS]);
  assert.deepEqual([...core.CONTEST_DAYS], [...rules.CONTEST_DAYS]);
  assert.deepEqual([...core.CONTEST_PENALTIES], [...rules.CONTEST_PENALTIES]);
  assert.deepEqual([...rules.CONTEST_TARGETS], [1, 3, 5]);
  assert.deepEqual([...rules.CONTEST_DAYS], [1, 3]);
  assert.deepEqual(rules.normalizeContestOrder({ target: "5", days: 3, penalty: 300 }), { target: 5, days: 3, penalty: 300 });
  assert.match(rules.normalizeContestOrder({ target: 10, days: 1, penalty: 10 }).error, /勝ち数/);
  assert.match(rules.normalizeContestOrder({ target: 1, days: 7, penalty: 10 }).error, /期限/);
  assert.match(rules.normalizeContestOrder({ target: 1, days: 1, penalty: 70 }).error, /罰金/);
  // 勝ち数は「完走の増分 − 負けの増分」（引き分けも勝ちに数える）。勝ち数で頭打ち、マイナスにはならない。
  assert.equal(rules.contestWins({ baselineMatches: 10, baselineLosses: 4, matches: 13, losses: 5, target: 3 }), 2);
  assert.equal(rules.contestWins({ baselineMatches: 10, baselineLosses: 4, matches: 20, losses: 4, target: 3 }), 3);
  assert.equal(rules.contestWins({ baselineMatches: 10, baselineLosses: 4, matches: 12, losses: 6, target: 3 }), 0);
  assert.equal(rules.contestWins({ baselineMatches: 10, baselineLosses: 4, matches: 9, losses: 4, target: 3 }), 0);

  const raw = { status: "active", workOrder: { orderSeq: 2, kind: "contest", target: 3, days: 1, penalty: 50, note: "", issuedAt: 1, acceptedAt: 5, deadline: 5 + DAY, reportedCount: 1, reportedAt: 6, doneAt: 0 } };
  assert.deepEqual(core.workOrderView(raw), {
    orderSeq: 2, target: 3, note: "", issuedAt: 1, reportedCount: 1, reportedAt: 6, done: false, doneAt: 0,
    kind: "contest", days: 1, penalty: 50, acceptedAt: 5, accepted: true, deadline: 5 + DAY,
  });
  assert.equal(core.workOrderView({ workOrder: { ...raw.workOrder, penalty: 70 } }), null, "an unknown penalty is not an order");
  assert.equal(core.workOrderView({ workOrder: { ...raw.workOrder, target: 10 } }), null, "a run target is not a contest target");
  assert.equal(core.workOrderView({ workOrder: { orderSeq: 1, target: 3 } }).kind, undefined, "run orders keep their shape");
  assert.equal(core.contestExpired(core.workOrderView(raw), 5 + DAY - 1), false);
  assert.equal(core.contestExpired(core.workOrderView(raw), 5 + DAY), true);
  assert.deepEqual(core.workResultView({ workResult: { orderSeq: 2, penalty: 50, target: 3, wins: 1, settledAt: 9 } }), { orderSeq: 2, penalty: 50, target: 3, wins: 1, settledAt: 9 });
  assert.equal(core.workResultView({ workResult: { penalty: 0 } }), null);
  assert.deepEqual(core.contestRecordView({ contestWins: 2, contestLosses: 1 }), { won: 2, lost: 1 });
  assert.equal(core.tributeKindLabel({ kind: "silent", contest: 2 }), "勝負の罰金");
  assert.equal(core.tributeKindLabel({ kind: "request", contest: 2 }), "勝負の罰金");
});

test("the manager offers, the payer chooses: declining changes nothing, and nothing is counted before accepting", async () => {
  const { h, contractId, act } = await setup();
  const balances = { manager: h.balance("manager"), payer: h.balance("payer") };
  await rejects(act("manager", "work_order", { ...CONTEST, target: 10 }), /勝ち数を選び直して/);
  await rejects(act("manager", "work_order", { ...CONTEST, days: 7 }), /期限を選び直して/);
  await rejects(act("manager", "work_order", { ...CONTEST, penalty: 70 }), /罰金を選び直して/);
  await rejects(act("manager", "work_order", { ...CONTEST, note: "現金で払え" }), /外部の決済|現金/);
  const offered = await act("manager", "work_order", { ...CONTEST, note: "勝ってきなさい。負けたら罰金ね。" });
  assert.deepEqual(offered.contract.workOrder, {
    orderSeq: 1, target: 3, note: "勝ってきなさい。負けたら罰金ね。", issuedAt: h.now(), reportedCount: 0, reportedAt: 0, done: false, doneAt: 0,
    kind: "contest", days: 1, penalty: 50, acceptedAt: 0, accepted: false, deadline: 0,
  });
  assert.equal(h.firestore.read(`tributeContracts/${contractId}/private/work`), undefined, "the baseline is taken when the payer accepts");
  await rejects(act("manager", "work_order", { target: 3 }), /1件ずつ/);
  assert.deepEqual(await act("payer", "work_progress"), { ok: true, contractId, workOrder: offered.contract.workOrder, count: 0 });
  await rejects(act("payer", "work_report"), /まだ勝負を受けていません/);
  await rejects(act("manager", "work_accept", { orderSeq: 1 }), /この操作はできません/);
  await rejects(act("payer", "work_decline", { orderSeq: 9 }), /勝負が変わりました/);
  const declined = await act("payer", "work_decline", { orderSeq: 1 });
  assert.equal(declined.contract.workOrder, null);
  assert.deepEqual(workEvents(h, contractId).map(({ type, kind, target, days, penalty }) => ({ type, kind, target, days, penalty })), [
    { type: "work_order", kind: "contest", target: 3, days: 1, penalty: 50 },
    { type: "work_declined", kind: undefined, target: undefined, days: undefined, penalty: undefined },
  ]);
  assert.equal(h.contract(contractId).contestLosses, undefined, "declining is not a loss");
  assert.deepEqual({ manager: h.balance("manager"), payer: h.balance("payer") }, balances);
  // 完走の命令はこれまでどおり（勝負の項目は付かない）。
  const run = await act("manager", "work_order", { target: 3 });
  assert.equal(run.contract.workOrder.kind, undefined);
  await rejects(act("payer", "work_accept", { orderSeq: 2 }), /受けられる勝負はありません/);
});

test("a win: the server counts completions minus losses since accepting, and the manager confirms it", async () => {
  const { h, contractId, act } = await setup({ matches: 10, losses: 4 });
  await act("manager", "work_order", CONTEST);
  const accepted = await act("payer", "work_accept", { orderSeq: 1 });
  const acceptedAt = h.now();
  assert.deepEqual([accepted.contract.workOrder.accepted, accepted.contract.workOrder.acceptedAt, accepted.contract.workOrder.deadline], [true, acceptedAt, acceptedAt + DAY]);
  assert.deepEqual(h.firestore.read(`tributeContracts/${contractId}/private/work`), {
    contractId, payerUid: "payer", orderSeq: 1, baselineMatches: 10, baselineLosses: 4, updatedAt: acceptedAt,
  });
  assert.equal(JSON.stringify(h.contract(contractId)).includes("baselineLosses"), false, "the manager never sees the payer's totals");
  await rejects(act("payer", "work_accept", { orderSeq: 1 }), /受けられる勝負はありません/);

  h.setRecord("payer", 13, 5);
  assert.equal((await act("payer", "work_progress")).count, 2, "3 completions, 1 loss");
  const partial = await act("payer", "work_report");
  assert.deepEqual([partial.count, partial.done], [2, false]);
  assert.equal(partial.contract.workOrder.reportedCount, 2);
  h.setRecord("payer", 16, 5);
  const won = await act("payer", "work_report");
  assert.deepEqual([won.count, won.done], [3, true]);
  assert.deepEqual(won.contract.contestRecord, { won: 1, lost: 0 });
  assert.equal(won.contract.workOrdersDone, 0, "a contest win is counted on its own");
  await rejects(act("manager", "work_judge"), /判定できる勝負はありません/);
  const confirmed = await act("manager", "work_confirm", { seal: "yoku", reward: "erai" });
  assert.equal(confirmed.contract.workOrder, null);
  const confirm = h.events(contractId).find((event) => event.type === "work_confirm");
  assert.deepEqual([confirm.kind, confirm.target, confirm.count, confirm.seal], ["contest", 3, 3, "yoku"]);
  assert.equal(h.contract(contractId).workResult, null, "no penalty after a win");
});

test("a loss after the deadline: the manager judges or the payer's late report settles it; the penalty is given or claimed", async () => {
  const { h, contractId, act } = await setup({ matches: 10, losses: 4 });
  await act("manager", "work_order", { ...CONTEST, target: 5, penalty: 300 });
  await act("payer", "work_accept", { orderSeq: 1 });
  h.setRecord("payer", 13, 5);
  await act("payer", "work_report");
  await rejects(act("manager", "work_judge"), /判定できる勝負はありません/, "not before the deadline");
  // 期限の後の対戦は数えない（期限までに報告した数で決まる）。
  h.advance(DAY);
  h.setRecord("payer", 30, 5);
  const judged = await act("manager", "work_judge");
  assert.equal(judged.contract.workOrder, null);
  assert.deepEqual(judged.contract.workResult, { orderSeq: 1, penalty: 300, target: 5, wins: 2, settledAt: h.now() });
  assert.deepEqual(judged.contract.contestRecord, { won: 0, lost: 1 });
  const lost = h.events(contractId).find((event) => event.type === "work_contest_lost");
  assert.deepEqual([lost.actor, lost.wins, lost.penalty], ["system", 2, 300]);
  await rejects(act("manager", "work_order", CONTEST), /罰金が、まだ払われていません/);

  // 罰金は財布が差し出す（1回の限度額 100 Pay まで）。記録には勝負の印が残る。
  const balance = h.balance("payer");
  await rejects(act("payer", "tribute", { kind: "contest", amount: 300, clientRequestId: server.nextRequestId() }), /罰金の額が変わりました/);
  const paid = await act("payer", "tribute", { kind: "contest", amount: 100, clientRequestId: server.nextRequestId() });
  assert.equal(h.balance("payer"), balance - 100);
  assert.equal(paid.contract.workResult, null);
  const tribute = h.events(contractId).find((event) => event.type === "tribute" && event.contest === 1);
  assert.deepEqual([tribute.kind, tribute.purpose, tribute.amount], ["silent", "penalty", 100]);
  const receipt = (await h.act("payer", "receipts")).receipts.find((row) => row.receiptId === paid.receipt.receiptId);
  assert.equal(receipt.contest, 1);

  // 2件目: 財布が期限の後に報告すると、その場で負けが決まる。払われない罰金は、管理人が請求にできる。
  h.advance(2_100);
  await act("manager", "work_order", CONTEST);
  await act("payer", "work_accept", { orderSeq: 2 });
  h.advance(DAY + 1);
  const late = await act("payer", "work_report");
  assert.deepEqual([late.lost, late.contract.workResult.penalty, late.contract.workResult.wins], [true, 50, 0]);
  await rejects(act("payer", "work_claim"), /この操作はできません/);
  const claimed = await act("manager", "work_claim");
  const contract = h.contract(contractId);
  assert.equal(contract.workResult, null);
  assert.deepEqual(contract.pendingRequests[claimed.requestId], { amount: 50, note: "勝負の罰金", purpose: "penalty", contest: 2, createdAt: h.now() });
  await rejects(act("manager", "work_claim"), /請求できる罰金はありません/);
  await act("payer", "tribute", { kind: "request", requestId: claimed.requestId, amount: 50, clientRequestId: server.nextRequestId() });
  const requestPaid = h.events(contractId).filter((event) => event.type === "tribute").at(-1);
  assert.deepEqual([requestPaid.kind, requestPaid.contest, requestPaid.purpose], ["request", 2, "penalty"]);
  assert.deepEqual(h.contract(contractId).contestLosses, 2);
});

test("turning work orders off withdraws an open contest without a penalty; the manager can withdraw; the end clears a penalty", async () => {
  const { h, contractId, act } = await setup();
  await act("manager", "work_order", CONTEST);
  await act("payer", "work_accept", { orderSeq: 1 });
  const off = await act("payer", "set_work_orders", { allowWorkOrders: false });
  assert.deepEqual([off.contract.workOrder, off.contract.workResult], [null, null]);
  assert.equal(h.events(contractId).at(-1).reason, "setting");
  await act("payer", "set_work_orders", { allowWorkOrders: true });
  await act("manager", "work_order", CONTEST);
  await act("payer", "work_accept", { orderSeq: 2 });
  const withdrawn = await act("manager", "work_withdraw");
  assert.deepEqual([withdrawn.contract.workOrder, withdrawn.contract.workResult], [null, null]);
  await act("manager", "work_order", CONTEST);
  await act("payer", "work_accept", { orderSeq: 3 });
  h.advance(DAY);
  await act("manager", "work_judge");
  assert.equal(h.contract(contractId).workResult.penalty, 50);
  await act("payer", "terminate");
  assert.equal(h.contract(contractId).workResult, null, "an ended contract keeps no penalty to pay");
});

test("the browser shares todos and stock lines; the client wires the offer, the answer, progress, judging and the penalty", async () => {
  const core = await loadCore();
  const base = { contractId: "c".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: 1, expiresAt: Date.now() + 9 * DAY, eventSeq: 1, readSeq: { manager: 1, payer: 1 }, caps: { perTribute: 100, perDay: 300, total: 1_000 }, tone: "harsh", allowWorkOrders: true };
  const offer = { ...base, workOrder: { orderSeq: 1, kind: "contest", target: 3, days: 1, penalty: 50, issuedAt: 1, acceptedAt: 0, deadline: 0, doneAt: 0 } };
  assert.deepEqual(core.contractTodos([core.viewContract(offer, "payer")]).map((todo) => todo.kind), ["work"]);
  const over = { ...base, workOrder: { ...offer.workOrder, acceptedAt: 1, deadline: 2 } };
  assert.deepEqual(core.contractTodos([core.viewContract(over, "manager")]).map((todo) => todo.kind), ["contest_judge"]);
  const owed = { ...base, workResult: { orderSeq: 1, penalty: 50, target: 3, wins: 1, settledAt: 3 } };
  assert.deepEqual(core.contractTodos([core.viewContract(owed, "payer")]).map((todo) => todo.kind), ["contest_penalty"]);
  assert.deepEqual(core.contractTodos([core.viewContract(owed, "manager")]), []);

  const banned = /死|殺|自殺|消えろ|首吊|殴|刺す|晒|特定|ばら|上限を上げ|上げろ|逃げ|逃が|解約したら|やめたら|許さない|裏切|♥|今だけ|あなただけ|お願い|ください|今日中|急げ|期限|賭け/u;
  for (const line of Object.values(core.CONTEST_NOTES).flat()) {
    assert.doesNotMatch(line, banned, line);
    assert.doesNotMatch(line, /♡(?!$)/u, `${line}: ♡ only at the end`);
    assert.equal(rules.forbiddenReason(line.replaceAll("{no}", "3")), "", line);
    assert.ok(line.length <= rules.LIMITS.requestNote, line);
  }
  assert.deepEqual(core.workOrderNotesFor("sweet", { kind: "contest" }), ["勝てたら、たくさん褒めてあげる♡", "負けても、約束は守ろうね。"]);
  assert.ok(core.workOrderNotesFor("harsh", { kind: "contest", collarNo: 3 }).includes("3号、勝負だ。負けたら払え。"));
  assert.deepEqual(core.workOrderNotesFor("sweet"), core.workOrderNotesFor("sweet", { kind: "run" }), "run lines stay as they were");

  for (const action of ["work_accept", "work_decline", "work_judge", "work_claim"]) {
    assert.match(service, new RegExp(`\\n    ${action}: \\{`), action);
    assert.match(client, new RegExp(`mutate\\("${action}"`), `${action} from the thread`);
    assert.match(client, new RegExp(`case "${action}": \\{`), `${action} preview`);
  }
  for (const type of ["work_accept", "work_declined", "work_contest_lost"]) assert.match(client, new RegExp(`case "${type}":`), type);
  assert.match(client, /kind: sheet\.othello \? "othello" : sheet\.contest \? "contest" : sheet\.granted \? "granted" : sheet\.requestId \? "request" : "silent",/);
  assert.match(client, /openSheet\("give", \{ contest: true, amount: contestPayable\(view, result\), purpose: "penalty", step: "hold" \}\);/);
  assert.match(client, /<input type="radio" name="kind" value="contest"/);
  assert.match(read("functions/index.js"), /verifiedLosses: \(progress\) => normalizeEconomyProgress\(progress\)\.achievementStats\.losses,/);
  for (const selector of [".tribute-work-order.is-contest", ".tribute-contest-terms", ".tribute-contest-result"]) assert.ok(styles.includes(selector), selector);
});

async function workRenderer() {
  const core = await loadCore();
  const context = vm.createContext({
    ...core, escapeHtml: String, formatDateTime: (value) => `T${value}`, state: { profile: { card: { seals: ["yoku"] } }, thread: {} },
    // 受取印とご褒美の欄は出稼ぎ（完走）と同じもの。ここでは出るかどうかだけを見る。
    renderWorkConfirmControls: () => '<button data-t="work-confirm"></button>',
  });
  vm.runInContext(["contestPayable", "renderContestResult", "renderContestOrder", "renderWorkOrder"].map((name) => extract(client, name)).join("\n"), context);
  return (raw, uid, { work = null, now = Date.now() } = {}) => {
    context.state.thread = { work };
    context.Date = { now: () => now };
    return context.renderWorkOrder(core.viewContract(raw, uid, now));
  };
}

test("the work panel: an offer to answer, progress toward wins, judging after the deadline, and the penalty", async () => {
  const render = await workRenderer();
  const now = 1_800_000_000_000;
  const base = {
    contractId: "d".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: 1, expiresAt: now + 9 * DAY,
    eventSeq: 1, readSeq: { manager: 1, payer: 1 }, caps: { perTribute: 100, perDay: 300, total: 1_000 }, tone: "harsh",
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowWorkOrders: true,
  };
  const offered = { ...base, workOrder: { orderSeq: 4, kind: "contest", target: 3, days: 1, penalty: 300, note: "勝ってきなさい。負けたら罰金ね。", issuedAt: now - 60_000, acceptedAt: 0, deadline: 0, doneAt: 0 } };
  const payerOffer = render(offered, "payer", { now });
  assert.match(payerOffer, /data-t="work-accept" data-seq="4"/);
  assert.match(payerOffer, /data-t="work-decline" data-seq="4"/);
  assert.match(payerOffer, /1日以内に1on1で 3勝/);
  assert.match(payerOffer, /罰金 300 Pay/);
  assert.match(payerOffer, /1回の限度額（100 Pay）まで/, "only the payer sees the cap");
  assert.match(payerOffer, /断っても何も起きません/);
  const managerOffer = render(offered, "manager", { now });
  assert.match(managerOffer, /返事を待っています/);
  assert.doesNotMatch(managerOffer, /限度額|work-accept/);

  const running = { ...base, workOrder: { ...offered.workOrder, acceptedAt: now - 3_600_000, deadline: now - 3_600_000 + DAY, reportedCount: 1, reportedAt: now - 60_000 } };
  const payerRunning = render(running, "payer", { now, work: { orderSeq: 4, count: 2 } });
  assert.match(payerRunning, /いま <b>2 \/ 3勝<\/b>/);
  assert.match(payerRunning, /data-t="work-report"/);
  assert.match(payerRunning, /期限までに報告した勝ち数で決まります/);
  assert.doesNotMatch(payerRunning, /work-accept/);
  const managerRunning = render(running, "manager", { now });
  assert.match(managerRunning, /報告 <b>1 \/ 3勝<\/b>/);
  assert.doesNotMatch(managerRunning, /data-t="work-judge"/);
  assert.match(render(running, "manager", { now: now + DAY }), /data-t="work-judge"/);
  assert.match(render(running, "payer", { now: now + DAY }), /data-t="work-report">結果を確かめる/);

  const won = { ...base, workOrder: { ...running.workOrder, reportedCount: 3, doneAt: now } };
  assert.match(render(won, "manager", { now }), /data-t="work-confirm"/);
  assert.match(render(won, "payer", { now }), /確認を待っています/);

  const owed = { ...base, workResult: { orderSeq: 4, penalty: 300, target: 3, wins: 1, settledAt: now } };
  const payerOwed = render(owed, "payer", { now });
  assert.match(payerOwed, /data-t="give-contest">罰金 100 Pay を差し出す/);
  assert.match(payerOwed, /1回の限度額まで/);
  const managerOwed = render(owed, "manager", { now });
  assert.match(managerOwed, /data-t="work-claim"/);
  assert.match(managerOwed, /1 \/ 3勝/);
  assert.equal(render({ ...base }, "manager", { now }), "");
});

test("cache keys and the design record", () => {
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*ranch-contest-v1"/);
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) {
    assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-contest-v1(?:-[a-z0-9-]+)?"`), name);
  }
  assert.match(design, /第3段（出稼ぎ命令の勝負の型）を実装した/);
  assert.match(design, /work_contest_lost/);
});
