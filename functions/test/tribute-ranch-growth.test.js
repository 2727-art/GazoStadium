"use strict";

// 牧場を長く育てる（ranch-growth-v1、設計書16.3・16.12）。2026-10-28 のユーザーの決定:
// 公開してすぐ Lv4 の管理人がいて、Lv10 が天井では育てる楽しみがすぐなくなる。そこで、
// レベルを Lv30 まで伸ばして絵を足し、その先は数字だけ上がり続ける。動物ごとの「なつき」（その財布が通算で仕えた日数）で飾りが増える。
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
const art = read("art/tribute-ranch/render_ranch.py");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const DAY = 86_400_000;

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

test("levels: Lv1-10 unchanged, Lv30 with art, then numbers without a ceiling", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.RANCH_LEVELS], [...rules.RANCH_LEVELS]);
  assert.equal(rules.RANCH_LEVELS.length, 30);
  assert.equal(rules.RANCH_ART_LEVELS, 30);
  assert.deepEqual([...rules.RANCH_LEVELS].slice(0, 10), [0, 20, 60, 120, 200, 320, 480, 700, 1000, 1400]);
  // Lv11 からは、次までの経験値が1段ごとに100ずつ増える（Lv11 まで 500、Lv30 まで 2,400、Lv31 まで 2,500）。
  for (let level = 11; level <= 40; level += 1) {
    assert.equal(rules.ranchThreshold(level) - rules.ranchThreshold(level - 1), 100 * (level - 6), `Lv${level}`);
    assert.equal(core.ranchThreshold(level), rules.ranchThreshold(level), `Lv${level}`);
  }
  assert.equal(rules.ranchThreshold(30), 30_400);
  assert.equal(rules.ranchThreshold(31), 32_900);
  for (const xp of [0, 1399, 1400, 1899, 1900, 10_900, 30_399, 30_400, 32_899, 32_900, 1_000_000]) {
    assert.equal(core.ranchLevelFor(xp), rules.ranchLevelFor(xp), String(xp));
    assert.ok(xp >= rules.ranchThreshold(rules.ranchLevelFor(xp)) && xp < rules.ranchThreshold(rules.ranchLevelFor(xp) + 1), String(xp));
  }
  assert.deepEqual(core.ranchProgress(40_000), { xp: 40_000, level: 33, artLevel: 30, floor: 38_200, next: 41_000, toNext: 1000, ratio: 1800 / 2800 });
  assert.deepEqual(core.RANCH_FACILITIES.map((facility) => facility.level), Array.from({ length: 29 }, (_, index) => index + 2));
  assert.deepEqual(core.RANCH_FACILITIES.slice(9).map((facility) => facility.label), [
    "郵便受け", "街灯", "風見鶏", "花の鉢", "二階建ての家", "石の小道", "屋根の小鳥", "たくさんのりんご", "旗の飾り", "サイロ",
    "桜の木", "噴水", "風船", "灯りの飾り", "気球", "虹", "ちょうちょ", "風車の花飾り", "金の柵", "お城の塔",
  ]);
});

test("fondness: a bell, a ribbon, a flower crown and a gold crown by days served", async () => {
  const core = await loadCore();
  assert.deepEqual(core.RANCH_FONDNESS.map(({ tier, days, label }) => ({ tier, days, label })), rules.RANCH_FONDNESS.map(({ tier, days, label }) => ({ tier, days, label })));
  assert.deepEqual(rules.RANCH_FONDNESS.map((step) => [step.days, step.label]), [[7, "鈴"], [30, "リボン"], [100, "花かんむり"], [365, "金の王冠"]]);
  for (const days of [0, 6, 7, 29, 30, 99, 100, 364, 365, 1000, -3, "x"]) assert.deepEqual(core.ranchFondness(days), rules.ranchFondness(days), String(days));
  assert.deepEqual(rules.ranchFondness(45), { days: 45, tier: 2, label: "リボン", next: { days: 100, label: "花かんむり", left: 55 } });
  assert.deepEqual(rules.ranchFondness(400), { days: 400, tier: 4, label: "金の王冠", next: null });
  assert.deepEqual(rules.ranchFondness(0).next, { days: 7, label: "鈴", left: 7 });
});

test("the server counts each wallet's served days across contracts, and older pairs start from an estimate", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  assert.equal(h.contract(contractId).servedTotal, 0, "a new pair starts at zero");
  await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  assert.equal(h.contract(contractId).servedTotal, 1, "one day however many tributes");
  h.advance(DAY);
  const offered = await act("payer", "offer_words", { text: "今日は言葉だけです。" });
  assert.equal(offered.contract.servedTotal, 2, "a word offering serves a day too");
  const pairKey = h.firestore.keys("tributePairs/")[0];
  assert.equal(h.firestore.read(pairKey).servedTotal, 2);

  // 公開より前から続く組（通算の記録がない）: 献上の回数と、初めての献上からの日数の小さい方から始める。
  const pair = h.firestore.read(pairKey);
  delete pair.servedTotal;
  h.firestore.write(pairKey, { ...pair, count: 50, firstAt: h.now() - 39.5 * DAY });
  h.advance(DAY);
  const next = await act("payer", "tribute", { kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  assert.equal(next.contract.servedTotal, 42, "40 days since the first tribute (fewer than 50 tributes), plus today");

  // 通算の記録がない契約は、この契約の献上の回数と日数から近い数を出す。
  const core = await loadCore();
  const raw = { contractId: "c".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: 1_000, tributeCount: 9 };
  assert.equal(core.viewContract(raw, "manager", 1_000 + 4.5 * DAY).servedTotal, 5);
  assert.equal(core.viewContract({ ...raw, servedTotal: 30 }, "manager", 1_000 + 4.5 * DAY).servedTotal, 30);
  assert.equal(core.servedTotalView(raw, 1_000 + 20 * DAY), 9, "never more than the tributes");
});

test("a new contract with the same wallet keeps the animal's fondness", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const first = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  h.advance(2_100);
  await h.act("payer", "tribute", { contractId: first, kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  h.advance(DAY);
  await h.act("payer", "tribute", { contractId: first, kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  h.advance(2_100);
  await h.act("payer", "terminate", { contractId: first });
  h.advance(60_000);
  const second = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  assert.equal(h.contract(second).servedTotal, 2, "copied from the pair when the manager accepts again");
});

async function ranchRenderer() {
  const core = await loadCore();
  const storage = new Map();
  const context = vm.createContext({
    ...core,
    escapeHtml: String,
    previewScreen: "",
    window: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
    state: { uid: "manager", contracts: [], ranch: { selected: "", diary: null }, busy: "" },
  });
  vm.runInContext([
    /const RANCH_ASSET_KEY = [^\n]*\n/.exec(client)[0],
    /const RANCH_WANDER = [^\n]*\n/.exec(client)[0],
    ...["managerNickname", "ranchImage", "ranchName", "ranchHerd", "ranchPercent", "ranchDiaryLines", "renderRanchAnimal", "renderRanchWeather", "renderRanch"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return { core, context, storage };
}

test("the panel shows fondness on the animals, the art stops at Lv30 and the number keeps going", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  const contract = (id, extra = {}) => core.viewContract({
    contractId: id.repeat(40), managerUid: "manager", payerUid: `payer-${id}`, status: "active", acceptedAt: now - DAY, expiresAt: now + 9 * DAY,
    payerWalletName: `財布${id}`, allowGrazing: true, ranchAnimal: "sheep", todayKey: core.jstDateKey(now), ...extra,
  }, "manager", now);
  const herd = [contract("1", { servedTotal: 45 }), contract("2", { servedTotal: 3 })];
  context.state.contracts = herd;
  context.state.ranch.selected = "1".repeat(40);
  const html = context.renderRanch(herd, { card: {}, ranch: { xp: 40_000 } });
  assert.match(html, /牧場 Lv\.33/);
  assert.match(html, /次の Lv まで あと 1000/);
  assert.match(html, /ranch-lv30-(day|evening|night)\.webp\?v=ranch-growth-v1/, "the art stops at Lv30");
  assert.match(html, /Lv30 から先は、施設は増えずにレベルの数字だけ上がり続けます。/);
  assert.match(html, /sheep-(stand|walk1|walk2|eat|sleep)-t2-/, "45 days: a ribbon");
  assert.match(html, /sheep-(stand|walk1|walk2|eat|sleep)-(day|evening|night)\.webp/, "3 days: no accessory yet");
  assert.match(html, /なつき：リボン（仕えた日 45日）・あと55日で花かんむり/);
  const low = context.renderRanch(herd, { card: {}, ranch: { xp: 1_000 } });
  assert.match(low, /次は Lv\.10 で「金の牛の像」/);
});

test("the day log mentions a new accessory", async () => {
  const core = await loadCore();
  const before = core.ranchSnapshot([{ contractId: "a", name: "ポチ", servedTotal: 29 }]);
  const after = core.ranchSnapshot([{ contractId: "a", name: "ポチ", servedTotal: 30 }]);
  assert.deepEqual(core.ranchDiary(before, after), ["ポチは仕えた日が30日になり、リボンをつけた。"]);
  assert.deepEqual(core.ranchDiary(after, core.ranchSnapshot([{ contractId: "a", name: "ポチ", servedTotal: 31 }])), []);
});

test("art, cache keys and the design record", () => {
  assert.match(client, /const RANCH_ASSET_KEY = "ranch-growth-v1";/);
  assert.match(art, /FONDNESS_TIERS = \(0, 1, 2, 3, 4\)/);
  assert.match(art, /REPLACED_BY = \{3: 14, 1: 28, 8: 29\}/);
  assert.equal((/FACILITIES = \[([\s\S]*?)\]\n/.exec(art)[1].match(/[a-z_]+|None/g) || []).length, 30);
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-growth-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-growth-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /### 16\.12 なつき/);
  assert.match(design, /Lv30 まで/);
});
