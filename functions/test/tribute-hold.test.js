"use strict";

// 財布の打つ手・第2段（ranch-hold-v1）。2026-10-27 のユーザーの決定:
// お預け（財布から勝手に差し出せなくし、願い出て許されると1回だけ差し出せる。既定は受ける）、抵抗する（未払いの請求に渋る一言を3回まで）。
// 差し出された献上を後から突き返すことはしない。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
const html = read("index.html");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function fn(name) {
  const start = client.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const body = client.slice(start);
  const end = /\n\}\n/.exec(body);
  return body.slice(0, end.index + 2);
}

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the client mirrors the server: hold and plea views, the resist limit, todos and labels", async () => {
  const core = await loadCore();
  assert.equal(core.LIMITS.resistsPerRequest, rules.LIMITS.resistsPerRequest);
  assert.equal(rules.LIMITS.resistsPerRequest, 3);
  assert.equal(rules.normalizeApplication({ caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true }).application.allowHolds, false, "old screens never opt in");
  const raw = {
    status: "active",
    allowHolds: true,
    allowSexualPurposes: false,
    hold: { since: 5, note: "待て" },
    plea: { pleaSeq: 2, amount: 300, purpose: "edging", note: "貢がせて", createdAt: 7, grantedAt: 0 },
    pendingRequests: { abcdef0123456789: { amount: 10, resists: 9, createdAt: 1 } },
  };
  const view = core.viewContract(raw, "x");
  assert.deepEqual(view.hold, { since: 5, note: "待て" });
  assert.deepEqual({ ...view.plea }, { pleaSeq: 2, amount: 300, purpose: "", note: "貢がせて", createdAt: 7, granted: false, grantedAt: 0 }, "a sexual purpose stays hidden without permission");
  assert.equal(view.pendingRequests[0].resists, 3, "clamped to the limit");
  assert.equal(core.viewContract({ ...raw, status: "ended" }, "x").hold, null);
  const todos = (contract) => core.contractTodos([{ status: "active", contractId: "c", ...contract }]).map((todo) => todo.kind);
  assert.deepEqual(todos({ role: "manager", plea: { granted: false } }), ["plea"]);
  assert.deepEqual(todos({ role: "payer", plea: { granted: true } }), ["granted"]);
  assert.deepEqual(todos({ role: "payer", plea: { granted: false } }), []);
  assert.equal(core.tributeKindLabel({ kind: "silent", granted: true }), "願い出て許された献上");
  assert.equal(core.tributeKindLabel({ kind: "request" }), "請求に応えて");
  assert.equal(core.resistedLabel({ resisted: 2 }), "2回抵抗して献上");
  assert.equal(core.resistedLabel({}), "");
});

test("hold, plea and resist lines live in their sheets, never in the chat templates", async () => {
  const core = await loadCore();
  for (const tone of ["sweet", "normal", "harsh"]) {
    assert.ok(!core.templatesFor("manager", tone, { collarNo: 3 }).some((group) => group.id === "hold"), tone);
    assert.ok(core.templatesFor("manager", tone, { collarNo: 3 }).some((group) => group.id === "press" && group.label === "追い込む"), tone);
    assert.ok(!core.templatesFor("payer", tone).some((group) => ["plea", "resist"].includes(group.id)), tone);
    assert.ok(core.sheetLinesFor("payer", tone, "plea").length >= 2, tone);
    assert.ok(core.sheetLinesFor("payer", tone, "resist").length >= 2, tone);
  }
  assert.equal(core.sheetLinesFor("manager", "harsh", "hold")[0], "お預けだ。許すまで財布に触るな。", "strongest first under the ceiling");
  assert.ok(core.sheetLinesFor("manager", "harsh", "hold").includes("今日はお預け。いい子で待っててね♡"));
  assert.ok(!core.sheetLinesFor("manager", "sweet", "hold").includes("お預けだ。許すまで財布に触るな。"));
  assert.ok(core.sheetLinesFor("payer", "harsh", "resist", { collarNo: 3 }).includes("3号、まだ抵抗します。"));
  assert.ok(!core.sheetLinesFor("manager", "harsh", "hold", { ngWords: ["財布"] }).some((line) => line.includes("財布")), "NG words stay out");
  for (const role of ["manager", "payer"]) {
    for (const tone of ["sweet", "normal", "harsh"]) {
      for (const id of ["hold", "press", "plea", "resist"]) {
        for (const line of core.TEMPLATES[role][tone][id] || []) assert.doesNotMatch(line, /限度額|解約|今日中|急げ/, `${role}/${tone}/${id}: ${line}`);
      }
    }
  }
});

test("the payer's give button and hold panel follow the hold, the plea and the grant", async () => {
  const core = await loadCore();
  const context = vm.createContext({ ...core, state: { walletBalance: 1_000, thread: {} }, escapeHtml: String });
  vm.runInContext([
    "formatDateTime", "purposeTag", "managerNickname", "contractCounterpart", "requestLimitProblem",
    "renderGiveButton", "renderHold", "renderResistRow",
  ].map(fn).join("\n") + "\nthis.renderGiveButton = renderGiveButton; this.renderHold = renderHold; this.renderResistRow = renderResistRow;", context);
  const base = { status: "active", contractId: "c", allowSexualPurposes: false, caps: { perTribute: 100, perDay: 300, total: 1_000 }, todayTributed: 0, totalTributed: 0, allowance: 100, manager: { personaName: "ミオ様" }, payer: { walletName: "ポチ財布" } };
  const payer = (extra) => ({ ...base, role: "payer", ...extra });
  const hold = { since: Date.now(), note: "待て" };
  assert.match(context.renderGiveButton(payer({ hold: null })), /data-sheet="give"/);
  assert.match(context.renderGiveButton(payer({ hold, plea: null })), /data-sheet="plea">願い出る/);
  assert.match(context.renderGiveButton(payer({ hold, plea: { amount: 30, granted: false } })), /disabled>願い出中/);
  assert.match(context.renderGiveButton(payer({ hold, plea: { amount: 30, granted: true } })), /data-t="give-granted">許された献上を差し出す/);
  assert.equal(context.renderHold(payer({ hold: null })), "");
  assert.match(context.renderHold(payer({ hold, plea: null })), /ミオ様に許されるまで、自分からは差し出せません/);
  assert.match(context.renderHold(payer({ hold, plea: { amount: 30, granted: false, note: "貢がせて" } })), /願い出中[\s\S]*data-t="plea-withdraw"/);
  assert.match(context.renderHold(payer({ hold, plea: { amount: 30, granted: true } })), /data-t="give-granted" >差し出す/);
  assert.match(context.renderHold(payer({ hold, plea: { amount: 300, granted: true } })), /限度額が足りません[\s\S]*data-t="give-granted" disabled/, "only the payer sees the limit");
  const manager = { ...base, role: "manager", caps: null, nickname: "" };
  const ask = context.renderHold({ ...manager, hold, plea: { amount: 30, granted: false } });
  assert.match(ask, /data-t="plea-answer-open" data-decision="grant">許す/);
  assert.match(ask, /data-t="plea-answer-open" data-decision="deny">退ける/);
  assert.match(ask, /data-t="unhold">お預けを解く/);
  assert.doesNotMatch(ask, /限度額/, "managers never see limits");
  assert.match(context.renderResistRow({ requestId: "r", resists: 1 }), /抵抗 1回[\s\S]*あと2回/);
  assert.doesNotMatch(context.renderResistRow({ requestId: "r", resists: 3 }), /resist-open/);
});

test("applying, the thread actions, sheets and handlers for holds, pleas and resists", () => {
  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /name="allowHolds" \$\{checked\("allowHolds", true\)\}/, "holds are accepted by default");
  assert.match(sourceBlock(client, 'case "apply": {', 'case "message": {'), /allowHolds: data\.get\("allowHolds"\) === "on",/);
  assert.match(sourceBlock(client, 'case "reapply": {', 'case "open-thread":'), /allowHolds: view\.allowHolds,/);
  const actions = sourceBlock(client, "function renderThreadActionButtons", "function renderGiveButton");
  assert.match(actions, /data-sheet="holds-settings">お預けの設定/);
  assert.match(actions, /data-sheet="hold">お預けにする/);
  assert.match(actions, /data-t="unhold">お預けを解く/);
  assert.match(client, /kind: sheet\.granted \? "granted" : sheet\.requestId \? "request" : "silent",/);
  assert.match(client, /\$\{sheet\.granted \? "" : '<button class="button button-ghost button-small" type="button" data-t="give-back">金額を変える<\/button>'\}/, "a granted amount cannot be changed");
  for (const [sheet, action] of [["hold", '"hold"'], ["plea", '"plea"'], ["resist", '"resist"']]) {
    assert.match(client, new RegExp(`case "${sheet}": \\{\\n      if \\(view\\.role !== "${sheet === "hold" ? "manager" : "payer"}"`), sheet);
    assert.match(client, new RegExp(`mutate\\(${action}, contractPayload`), action);
  }
  assert.match(client, /mutate\(grant \? "plea_grant" : "plea_deny", contractPayload\(\{ note \}\)/);
  assert.match(client, /mutate\("set_holds", contractPayload\(\{ allowHolds: allow \}\)/);
  assert.match(client, /openSheet\("give", \{ granted: true, amount: plea\.amount, purpose: plea\.purpose \|\| "", step: "hold" \}\)/);
  assert.match(client, /if \(holdPanel\) holdPanel\.innerHTML = renderHold\(view\);/);
  for (const action of ["set_holds", "hold", "unhold", "plea", "plea_withdraw", "plea_grant", "plea_deny", "resist"]) assert.ok(service.includes(`"${action}",`), action);
  for (const selector of [".tribute-hold-panel {", ".tribute-plea-mine.is-granted {", ".tribute-resist-mark {", ".tribute-tally .is-hold {"]) assert.ok(styles.includes(selector), selector);
});

test("the server never takes a tribute back and keeps limits from managers", () => {
  assert.doesNotMatch(service, /take_back|reject_tribute|refund_tribute/);
  const plea = sourceBlock(service, "    plea: {", "    plea_withdraw: {");
  assert.match(plea, /if \(!caps \|\| amount > caps\.perTribute\) fail/);
  assert.match(plea, /setContract\(ctx, \{ lastPayerMessageSeq: ctx\.seq \}\);/, "a plea is a payer message");
  assert.match(sourceBlock(service, "function answerPlea", "function contractReward"), /setContract\(ctx, \{ lastManagerReplySeq: ctx\.seq, ignoredSince: 0 \}\);/, "an answer is a manager reply");
  assert.match(sourceBlock(service, "    tribute: {", "    set_caps: {"), /if \(holdView\(ctx\.contract\)\) fail\("failed-precondition", "お預け中です。/);
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-hold-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-hold-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /第2段を実装/);
  assert.match(design, /お預けを受ける/);
});
