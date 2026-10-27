"use strict";

// 財布の打つ手と管理人の言葉・第1段（ranch-wallet-words-v1）。2026-10-27 のユーザーの決定:
// 言われたい言葉、言葉の強さは財布が決める上限で管理人がその中から選ぶ、定型文の追加（言い当てる・お礼・お願いの形を外す）、
// 期間14日・30日と「同じ条件で申し込む」、財布募集の画像の印を「受付中」に。
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
const share = read("tribute-share.mjs");
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

test("the client mirrors the server: periods, the tone ceiling, rewards and wished-for words", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.DURATION_DAYS_OPTIONS], [...rules.DURATION_DAYS_OPTIONS]);
  assert.deepEqual([...rules.DURATION_DAYS_OPTIONS], [1, 3, 7, 14, 30]);
  assert.equal(core.viewContract({ durationDays: 30 }, "x").durationDays, 30);
  assert.equal(core.viewContract({ durationDays: 99 }, "x").durationDays, 30);
  for (const tone of ["sweet", "normal", "harsh", "bogus"]) {
    assert.deepEqual(core.tonesUpTo(tone), rules.tonesUpTo(tone), tone);
    assert.deepEqual(core.rewardsFor(tone).map((reward) => reward.id), rules.rewardsFor(tone).map((reward) => reward.id), tone);
  }
  assert.deepEqual(rules.tonesUpTo("harsh"), ["sweet", "normal", "harsh"]);
  assert.deepEqual(rules.tonesUpTo("sweet"), ["sweet"]);
  assert.deepEqual(core.REWARDS.map((reward) => [reward.id, reward.label]), rules.REWARDS.map((reward) => [reward.id, reward.label]));
  assert.ok(!rules.rewardsFor("sweet").some((reward) => reward.tones.includes("harsh") && !reward.tones.includes("sweet")), "a sweet ceiling never offers harsh-only rewards");
  assert.equal(core.REWARD_WORD, rules.REWARD_WORD);
  assert.deepEqual([core.LIMITS.wantWordCount, core.LIMITS.wantWordLength], [rules.LIMITS.wantWordCount, rules.LIMITS.wantWordLength]);
  const corpus = ["ざこ、3号", "イかせて", "ペイペイで払え", "500円", "ブス財布", "a、b、c、d、e、f", "あ".repeat(20), " 雑魚 ,雑魚, いい子 "];
  for (const value of corpus) {
    assert.deepEqual(core.normalizeWantWords(value, { ngWords: ["ブス"] }), rules.normalizeWantWords(value, { ngWords: ["ブス"] }), value);
  }
  assert.deepEqual(rules.normalizeWantWords("a、b、c、d、e、f").words, ["a", "b", "c", "d", "e"]);
  assert.equal(rules.normalizeWantWords("あ".repeat(20)).words[0].length, 12);
  assert.deepEqual(rules.normalizeWantWords("イかせて").words, ["イかせて"], "sexual words are the payer's own choice");
  assert.match(rules.normalizeWantWords("ブス財布", { ngWords: ["ブス"] }).error, /言われたくない言葉/);
});

test("a wished-for word is a reward only while registered, and the word itself is what gets recorded", async () => {
  const core = await loadCore();
  const options = { tone: "harsh", ngWords: ["デブ"], wantWords: ["ざこ", "3号"] };
  assert.deepEqual(rules.normalizeReward("word", { ...options, text: "ざこ" }), { reward: "word", rewardText: "ざこ" });
  assert.match(rules.normalizeReward("word", { ...options, text: "養分" }).error, /いまのご褒美の候補にありません/);
  assert.match(rules.normalizeReward("word", { ...options, text: "" }).error, /いまのご褒美の候補にありません/);
  assert.deepEqual(rules.normalizeReward("arigato", options), { reward: "arigato" }, "a sweet reward under a harsh ceiling");
  assert.match(rules.normalizeReward("zako", { tone: "sweet" }).error, /選べません/);
  assert.equal(rules.storedRewardText({ reward: "word", rewardText: "ざこ" }), "ざこ");
  assert.equal(rules.storedRewardText({ reward: "zako", rewardText: "ざこ" }), "", "a list reward is read by its id");
  assert.equal(core.rewardText({ reward: "word", rewardText: "ざこ" }), "ざこ");
  assert.equal(core.rewardText({ reward: "suki" }), "好き♡");
  assert.equal(core.rewardText({}), "");
});

test("new stock lines: the manager can voice the payer's wish, the payer can thank, sweet lines do not beg", async () => {
  const core = await loadCore();
  assert.ok(core.MANAGER_SITUATIONS.some((situation) => situation.id === "voice" && situation.label === "言い当てる"));
  for (const tone of ["sweet", "normal", "harsh"]) {
    const voice = core.TEMPLATES.manager[tone].voice;
    assert.ok(voice.length >= 3, tone);
    for (const line of voice) {
      assert.equal(core.contractTextProblem(line, { role: "manager" }), "", line);
      assert.doesNotMatch(line, /限度額|解約|やめ|死|殺/, line);
    }
    assert.ok(core.TEMPLATES.payer[tone].reply.some((line) => /ありがとう/.test(line) && /貢がせ|受け取って/.test(line)), `${tone} thanks`);
  }
  assert.doesNotMatch(core.TEMPLATES.manager.sweet.nudge.join(), /来てくれる？/, "no begging");
  assert.ok(core.TEMPLATES.manager.sweet.nudge.includes("待ってたよ。今日も来るよね？"));
  assert.deepEqual(core.REWARDS.filter((reward) => ["mata", "suki"].includes(reward.id)).map((reward) => [reward.label, [...reward.tones]]), [["また来てね♡", ["sweet"]], ["好き♡", ["sweet"]]]);
  // 出稼ぎ命令の一言も、上限までの候補を強い順に。
  assert.equal(core.workOrderNotesFor("harsh")[0], "財布が空なら稼いでこい。");
  assert.ok(core.workOrderNotesFor("harsh").includes("がんばってきたら褒めてあげる。"));
  assert.ok(!core.workOrderNotesFor("sweet").includes("財布が空なら稼いでこい。"));
});

test("the manager picks the template tone within the ceiling and sees the wished-for words as chips", async () => {
  const core = await loadCore();
  const context = vm.createContext({ ...core, state: { thread: {} }, escapeHtml: String });
  vm.runInContext(`${fn("templateTone")}\n${fn("ownWordsFor")}\n${fn("renderTemplates")}\n${fn("renderWantChips")}\n${fn("rewardChips")}\nthis.renderTemplates = renderTemplates; this.renderWantChips = renderWantChips; this.rewardChips = rewardChips;`, context);
  const view = (role, tone, extra = {}) => ({ role, tone, ngWords: [], wantWords: ["ざこ", "3号"], allowSexualPurposes: false, collarNo: 3, manager: { disclosure: "nekama" }, ...extra });
  const harsh = context.renderTemplates(view("manager", "harsh"));
  assert.equal((harsh.match(/data-t="template-tone"/g) || []).length, 3);
  assert.match(harsh, /定型文（辛口まで）/);
  assert.match(harsh, /data-tone="harsh" aria-pressed="true"/, "starts at the ceiling");
  context.state.thread.templateTone = "sweet";
  assert.match(context.renderTemplates(view("manager", "harsh")), /待ってたよ。今日も来るよね？/);
  context.state.thread.templateTone = "harsh";
  assert.doesNotMatch(context.renderTemplates(view("manager", "sweet")), /data-t="template-tone"/, "nothing to pick under a sweet ceiling");
  assert.doesNotMatch(context.renderTemplates(view("manager", "sweet")), /財布のくせに待たせるな/);
  assert.doesNotMatch(context.renderTemplates(view("payer", "harsh")), /data-t="template-tone"/, "the payer keeps the contract tone");
  assert.match(context.renderWantChips(view("manager", "harsh")), /data-t="want-insert" data-text="ざこ"/);
  assert.equal(context.renderWantChips(view("payer", "harsh")), "");
  assert.equal(context.renderWantChips(view("manager", "harsh", { wantWords: [] })), "");
  const chips = context.rewardChips(view("manager", "sweet", { wantWords: ["ざこ", "好き♡"] }), "receive", ' data-seq="7"');
  assert.match(chips, /data-reward="word" data-text="ざこ">ざこ/);
  assert.doesNotMatch(chips, /data-reward="word" data-text="好き♡"/, "a word already in the list is not offered twice");
  assert.doesNotMatch(chips, /data-reward="zako"/);
});

test("applying: the ceiling, wished-for words and copied settings, but consent is never copied", () => {
  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /<legend>言われてもいい強さ（ここまで）<\/legend>/);
  assert.match(apply, /TONE_CEILING_LABELS/);
  assert.match(apply, /name="wantWords" maxlength="80"/);
  assert.match(apply, /<input type="checkbox" name="allowSexualPurposes" \/>/, "sexual names are chosen again on every application");
  assert.match(apply, /<input type="checkbox" name="allowScreenshots" \/>/, "screenshot consent is chosen again on every application");
  assert.match(apply, /name="acceptNoDecline" required \/>/);
  const submit = sourceBlock(client, 'case "apply": {', 'case "message": {');
  assert.match(submit, /const want = normalizeWantWords\(/);
  assert.match(submit, /wantWords: want\.words,/);
  assert.match(submit, /state\.applyPrefill = null;/);
  const reapply = sourceBlock(client, 'case "reapply": {', 'case "open-thread":');
  assert.doesNotMatch(reapply, /allowSexualPurposes|allowScreenshots|acceptNoDecline/);
  assert.match(reapply, /openManager\(view\.managerPublicId\)/);
  const ended = sourceBlock(client, "function renderThreadActionButtons", "function templateTone");
  assert.match(ended, /view\.role === "payer" && view\.accepted && view\.managerPublicId/);
  assert.match(ended, /data-t="reapply">同じ条件で申し込む/);
  assert.match(sourceBlock(client, "function renderManagerDetail", "function renderCheers"), /state\.applyPrefill\?\.publicManagerId === card\.publicManagerId/);
});

test("the thread: the manager sees the words, the payer edits them, rewards record the word", () => {
  const head = sourceBlock(client, "function renderThreadHead", "function renderThreadNext");
  assert.match(head, /view\.wantWords\.length && view\.role === "manager" \? `<p class="tribute-want">言われたい言葉：/);
  assert.match(head, /TONE_CEILING_LABELS\[view\.tone\]/);
  const sheet = sourceBlock(client, 'case "want-words": {\n      if (view.role !== "payer") return "";', 'case "work-settings": {');
  assert.match(sheet, /data-form="want-words"/);
  assert.match(sourceBlock(client, 'case "want-words": {\n      if (!view) return;', 'case "caps": {'), /mutate\("set_want_words", contractPayload\(\{ wantWords: want\.words \}\)/);
  assert.match(sourceBlock(client, 'case "want-insert": {', 'case "receipt-close":'), /box\.setSelectionRange\(caret, caret\)/);
  assert.match(sourceBlock(client, 'case "work-confirm": {', 'case "set-purposes": {'), /rewardText: rewardWord/);
  assert.match(client, /if \(wantChips\) wantChips\.innerHTML = renderWantChips\(view\);/);
  for (const selector of [".tribute-tone-tabs button[aria-pressed=\"true\"]", ".tribute-want span", ".tribute-want-chips button", ".tribute-again {"]) assert.ok(styles.includes(selector), selector);
});

test("the recruit image accepts wallets instead of recruiting them, and the release is keyed", () => {
  assert.match(share, /label: "受付中",/);
  assert.match(share, /ctx\.fillText\("財布受付", /);
  assert.doesNotMatch(share, /label: "募集中"|"WALLET WANTED"/);
  assert.match(share, /#お貢ぎ牧場 #財布募集/, "the hashtag the scene searches stays");
  for (const name of ["tribute.js", "tribute.css"]) assert.match(html, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-wallet-words-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-wallet-words-v1(?:-[a-z0-9-]+)?"/);
  assert.match(client, /from "\.\/tribute-share\.mjs\?v=[^"]*-ranch-wallet-words-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /## 14\. 財布の打つ手と管理人の言葉/);
  assert.match(design, /第1段は本番に公開|第1段（実装済み）|第1段を実装/);
});
