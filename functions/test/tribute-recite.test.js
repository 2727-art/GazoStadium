"use strict";

// 財布の打つ手と管理人の言葉・第3段（ranch-recite-v1）。2026-10-27 のユーザーの決定:
// 言葉の献上（Pay 0）と復唱、管理人の自分の言葉（定型文・ご褒美・受取印の言葉）、延長（財布だけが申し込む）。
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

test("the client mirrors the server: limits, recitation, seal words and the manager's own words", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.RECITE_TARGETS], [...rules.RECITE_TARGETS]);
  for (const key of ["wordOffering", "wordOfferingsPerDay", "ownLines", "ownLineLength", "ownRewards", "ownRewardLength", "sealWordLength"]) {
    assert.equal(core.LIMITS[key], rules.LIMITS[key], key);
  }
  assert.equal(core.SEAL_WORD_PREFIX, rules.SEAL_WORD_PREFIX);
  for (const value of ["  私は　財布です。 ", "Ｘ  y", "a​b", "あ".repeat(80)]) assert.equal(core.reciteKey(value), rules.reciteKey(value), value);
  for (const value of ["よく貢いだ", "LINE交換", "エロ", "", "あいうえおかきくけ"]) {
    assert.equal(core.sealWordProblem(value), rules.normalizeSealWord(value).error || "", value);
  }
  assert.equal(rules.sealText("word:よく貢いだ"), "よく貢いだ");
  assert.equal(core.sealLabel("word:よく貢いだ"), "よく貢いだ");
  assert.deepEqual(rules.normalizeSeals(["word:よく貢いだ", "word:LINE交換", "word:エロ", "zako"]), ["word:よく貢いだ", "zako"]);
  assert.deepEqual(core.sealsFor(["yoku", "word:苦労した"], ["苦労"]), ["yoku"], "an NG seal word is not offered");
  assert.equal(rules.sealFor("word:苦労した", { seals: ["word:苦労した"], ngWords: ["苦労"] }), rules.FALLBACK_SEAL || "juryo");
  const own = { lines: [{ text: " 跪いて差し出しな。 ", tone: "harsh" }, { text: "", tone: "sweet" }], rewards: [{ text: "上出来", tone: "bogus" }] };
  assert.deepEqual(core.normalizeOwnWords(own), rules.normalizeOwnWords(own));
  assert.deepEqual(rules.normalizeOwnWords(own).ownWords, { lines: [{ text: "跪いて差し出しな。", tone: "harsh" }], rewards: [{ text: "上出来", tone: "normal" }] });
  for (const [entry, options] of [
    [{ text: "イっていいよ", tone: "harsh" }, { tone: "harsh" }],
    [{ text: "イっていいよ", tone: "harsh" }, { tone: "harsh", allowSexual: true }],
    [{ text: "上出来", tone: "harsh" }, { tone: "normal" }],
    [{ text: "上出来", tone: "sweet" }, { tone: "normal", ngWords: ["出来"] }],
    [{ text: "上出来", tone: "sweet" }, { tone: "normal" }],
  ]) assert.equal(core.ownWordUsable(entry, options), rules.ownWordUsable(entry, options), JSON.stringify([entry, options]));
  const view = core.viewContract({ status: "active", reciteOrder: { orderSeq: 1, text: "私は財布です。", target: 3, count: 9, doneAt: 0 }, extension: { days: 14 } }, "x");
  assert.deepEqual([view.reciteOrder.count, view.reciteOrder.done, view.extension.days], [3, false, 14]);
  const todos = (contract) => core.contractTodos([{ status: "active", contractId: "c", ...contract }]).map((todo) => todo.kind);
  assert.deepEqual(todos({ role: "manager", reciteOrder: { done: true } }), ["recite_done"]);
  assert.deepEqual(todos({ role: "manager", extension: { days: 7 } }), ["extend"]);
  assert.deepEqual(todos({ role: "payer", reciteOrder: { done: false } }), ["recite"]);
  assert.ok(!core.templatesFor("manager", "harsh").some((group) => group.id === "recite"), "recite lines live in the sheet");
  assert.ok(core.sheetLinesFor("manager", "harsh", "recite", { collarNo: 3 }).includes("3号は、言われた分だけ差し出します。"));
});

test("the recitation and extension panels, own words in templates and rewards", async () => {
  const core = await loadCore();
  const context = vm.createContext({
    ...core,
    state: { thread: {}, profile: { ownWords: { lines: [{ text: "跪いて差し出しな。", tone: "harsh" }, { text: "イっていいよ", tone: "harsh" }], rewards: [{ text: "上出来", tone: "normal" }, { text: "イっていいよ", tone: "harsh" }] } } },
    sealChoices: new Map(),
    escapeHtml: String,
    sealSvg: () => "<svg></svg>",
    normalizeDecorations: () => ({}),
  });
  vm.runInContext([
    "formatDateTime", "managerNickname", "contractCounterpart", "ownWordsFor", "rewardChips", "templateTone", "renderTemplates",
    "renderReciteConfirmControls", "renderRecite", "renderExtension",
  ].map(fn).join("\n") + "\nObject.assign(this, { rewardChips, renderTemplates, renderRecite, renderExtension });", context);
  const base = { status: "active", contractId: "c", tone: "harsh", ngWords: [], wantWords: [], allowSexualPurposes: false, collarNo: 3, expiresAt: Date.now() + 86_400_000, manager: { personaName: "ミオ様", disclosure: "nekama" }, payer: { walletName: "ポチ財布" }, nickname: "" };
  const order = { orderSeq: 1, text: "私は財布です。", target: 3, count: 1, done: false };
  assert.match(context.renderRecite({ ...base, role: "payer", reciteOrder: order }), /data-sheet="recite">復唱する/);
  assert.match(context.renderRecite({ ...base, role: "payer", reciteOrder: { ...order, done: true } }), /ミオ様の確認を待っています/);
  assert.match(context.renderRecite({ ...base, role: "manager", reciteOrder: order }), /いま 1 \/ 3回[\s\S]*data-t="recite-withdraw"/);
  const confirm = context.renderRecite({ ...base, role: "manager", reciteOrder: { ...order, done: true } });
  assert.match(confirm, /data-t="recite-confirm">印を押して確かめる/);
  assert.match(confirm, /class="is-own" type="button" data-t="recite-confirm" data-reward="word" data-text="上出来"/);
  assert.doesNotMatch(confirm, /data-text="イっていいよ"/, "sexual own rewards need the payer's permission");
  assert.equal(context.renderRecite({ ...base, role: "payer", reciteOrder: null }), "");
  assert.match(context.renderExtension({ ...base, role: "manager", extension: { days: 7 } }), /7日<\/b> の延長を申し込んでいます[\s\S]*data-t="extend-accept"[\s\S]*data-t="extend-decline"/);
  assert.match(context.renderExtension({ ...base, role: "payer", extension: { days: 7 } }), /data-t="extend-withdraw"/);
  // 自分の定型文は管理人にだけ、上限までの強さで出る。
  assert.match(context.renderTemplates({ ...base, role: "manager" }), /自分の定型文[\s\S]*跪いて差し出しな。/);
  assert.doesNotMatch(context.renderTemplates({ ...base, role: "manager", tone: "normal" }), /跪いて差し出しな。/, "a harsh own line stays out of a normal contract");
  assert.doesNotMatch(context.renderTemplates({ ...base, role: "payer" }), /自分の定型文/);
  assert.match(context.renderTemplates({ ...base, role: "manager", allowSexualPurposes: true }), /イっていいよ/);
});

test("sheets, handlers, the card editor and the server actions", () => {
  const actions = sourceBlock(client, "function renderThreadActionButtons", "function renderGiveButton");
  assert.match(actions, /data-sheet="offer-words"/);
  assert.match(actions, /data-sheet="extend"/);
  assert.match(actions, /data-sheet="recite-order"/);
  for (const [sheet, role] of [["offer-words", "payer"], ["recite-order", "manager"], ["extend", "payer"]]) {
    assert.match(client, new RegExp(`case "${sheet}": \\{\\n      if \\(view\\.role !== "${role}"`), sheet);
  }
  assert.match(client, /mutate\("offer_words", contractPayload\(\{ text \}\)/);
  assert.match(client, /mutate\("recite_order", contractPayload\(\{ text, target \}\)/);
  assert.match(client, /if \(reciteKey\(form\.elements\.text\.value\) !== order\.text\) return setFormError\(form, "一字一句同じに打ってください。"\);/);
  assert.match(client, /mutate\("extend_request", contractPayload\(\{ days \}\)/);
  assert.match(client, /性的な名目の許可が外れたので、性的な言葉の復唱を取り下げました。/);
  assert.match(sourceBlock(service, "    set_purposes: {", "    receive: {"), /boardSexualWord\(order\.text\)[\s\S]*type: "recite_withdrawn", actor: "system"/);
  assert.match(client, /mutate\("set_own_words", \{ ownWords: normalized\.ownWords \}/);
  assert.match(client, /const seals = \[\.\.\.new Set\(\[\.\.\.data\.getAll\("seals"\)\.map\(String\), \.\.\.sealWords\.map\(sealWordId\)\]\)\];/);
  assert.match(client, /if \(recitePanel\) recitePanel\.innerHTML = renderRecite\(view\);/);
  assert.match(client, /if \(extensionPanel\) extensionPanel\.innerHTML = renderExtension\(view\);/);
  assert.match(sourceBlock(client, "function renderCardEditor", "function renderSealSettings"), /<\/form>\$\{renderOwnWordsEditor\(profile\)\}/);
  for (const action of ["set_own_words", "offer_words", "recite_order", "recite", "recite_withdraw", "recite_confirm", "extend_request", "extend_withdraw", "extend_accept", "extend_decline"]) {
    assert.ok(service.includes(`"${action}",`), action);
  }
  assert.match(service, /case "set_own_words": return setOwnWordsAction\(uid, data\);/);
  // 管理人は延長を申し込めない。言葉の献上は Pay を動かさない。
  assert.match(sourceBlock(service, "    extend_request: {", "    extend_withdraw: {"), /roles: \["payer"\]/);
  assert.doesNotMatch(sourceBlock(service, "    offer_words: {", "    recite_order: {"), /stageTribute|debitPoints|creditPoints/);
  for (const selector of [".tribute-letter {", ".tribute-recite-panel {", ".tribute-extension-panel {", ".tribute-own-row {", ".tribute-reward-chips button.is-own {"]) assert.ok(styles.includes(selector), selector);
});

test("cache keys and the design note record the release", () => {
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-recite-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-recite-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /第3段を実装/);
  assert.match(design, /言葉の献上/);
});

test("the report image carries granted tributes, resists and word offerings, never the offered text", async () => {
  const core = await loadCore();
  const events = [
    { seq: 1, type: "request", requestId: "r1", purpose: "", amount: 50, createdAt: 1 },
    { seq: 2, type: "tribute", kind: "request", requestId: "r1", amount: 50, resisted: 2, createdAt: 2 },
    { seq: 3, type: "word_offering", text: "LINEはabcで", receivedAt: 5, seal: "word:よく貢いだ", createdAt: 3 },
    { seq: 4, type: "received", tributeSeq: 3, words: true, reward: "word", rewardText: "上出来", createdAt: 5 },
    { seq: 5, type: "tribute", kind: "silent", granted: true, amount: 30, createdAt: 6 },
  ];
  const context = vm.createContext({
    ...core,
    state: { thread: { view: { allowSexualPurposes: false, purposeCounts: {}, rewardCount: 1, tributeCount: 2, wordOfferings: 1 }, events } },
    shareWalletLabel: () => "財布",
    shareManager: () => ({}),
  });
  const constant = client.match(/const SHARE_EVENT_TYPES = [^\n]+\n/)[0];
  vm.runInContext(constant + ["resistedMark", "shareExcerptData"].map(fn).join("\n") + "\nObject.assign(this, { shareExcerptData, resistedMark });", context);
  // vm の中の配列は別の realm なので、JSON で取り出して比べる。
  const data = JSON.parse(JSON.stringify(context.shareExcerptData({ seq: 5, info: { consent: true } })));
  assert.deepEqual(data.items.map((item) => item.type), ["request", "tribute", "words", "reward", "tribute"]);
  assert.equal(data.items[1].resistedMark, "抵抗×2");
  assert.deepEqual([data.items[2].sealLabel, data.items[3].label], ["よく貢いだ", "上出来"]);
  assert.deepEqual([data.items[4].granted, data.items[4].kindLabel], [true, "願い出て許された献上"]);
  assert.equal(JSON.stringify(data).includes("LINE"), false, "the offered text never reaches the image");
  assert.equal(data.headline.wordCount, 1);
  assert.equal(context.resistedMark({ resisted: 9 }), "抵抗×3");
  // 単発レシートの種類にも、許しと抵抗が入る。言葉の献上は切り抜きだけで開く。
  assert.match(sourceBlock(client, "function shareReceiptData", "function shareExcerptData"), /kindLabel: \[tributeKindLabel\(source\), resistedMark\(source\)\]\.filter\(Boolean\)\.join\("・"\)/);
  assert.match(sourceBlock(client, 'case "share-open": {', 'case "open-demo":'), /mode: event\.type === "tribute" \? "receipt" : "excerpt"/);
  assert.match(fn("renderEvent"), /is-word-offering[^\n]*\$\{controls\}\$\{save\}\$\{time\}/);
  const share = read("tribute-share.mjs");
  assert.match(share, /else if \(item\.type === "words"\) \{/);
  assert.match(share, /item\.granted && item\.purposeLabel \? "願い出て許された" : ""/);
});
