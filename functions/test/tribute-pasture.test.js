"use strict";

// 牧場経営 第1段（ranch-pasture-v1、設計書16）。2026-10-28 のユーザーの決定:
// 牧場レベルは関係の積み重ねで上げ、額では上げない。放牧は財布の同意（契約ごと）で、見られるのは管理人と本人だけ。
// 吹き出しは語り手の事実（と、第2段で財布が書く鳴き声）。絵は Blender で、やわらかい箱庭の絵柄。置き場所は管理人の「契約」画面の上。
// 公開より前から続けている管理人は、迎えた財布の数 × 5 から始める。動物は牛・豚・羊から管理人が選ぶ。
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
const APPLICATION = { caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3, tone: "harsh", acceptNoDecline: true };

function extract(source, name) {
  const start = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(start, name);
  const body = source.slice(start.index);
  const end = /\n\}\n/.exec(body);
  assert.ok(end, name);
  return body.slice(0, end.index + 2);
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

test("levels, points and animals are the same on the server and in the browser", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.RANCH_LEVELS], [...rules.RANCH_LEVELS]);
  assert.deepEqual({ ...core.RANCH_XP }, { ...rules.RANCH_XP });
  assert.equal(core.RANCH_XP_PAIR_DAY, rules.RANCH_XP_PAIR_DAY);
  assert.deepEqual([...core.RANCH_ANIMALS], [...rules.RANCH_ANIMALS]);
  // 2026-10-28 に Lv30 まで伸ばした（その先は数字だけ）。Lv1〜10 の必要量は変えていない。
  assert.deepEqual([...rules.RANCH_LEVELS].slice(0, 10), [0, 20, 60, 120, 200, 320, 480, 700, 1000, 1400]);
  assert.deepEqual({ ...rules.RANCH_XP }, { accept: 5, servedDay: 3, receive: 1, confirm: 2, plea: 1, extend: 2 });
  for (const xp of [0, 19, 20, 59, 60, 1399, 1400, 99_999, -5, "abc"]) assert.equal(core.ranchLevelFor(xp), rules.ranchLevelFor(xp), String(xp));
  assert.equal(rules.ranchLevelFor(1400), 10);
  for (const id of ["a".repeat(40), "b".repeat(40), "0123456789abcdef".repeat(2), ""]) assert.equal(core.defaultRanchAnimal(id), rules.defaultRanchAnimal(id), id);
  assert.deepEqual(core.ranchProgress(65), { xp: 65, level: 3, artLevel: 3, floor: 60, next: 120, toNext: 55, ratio: 5 / 60 });
  assert.deepEqual(core.RANCH_FACILITIES.map((facility) => facility.level).slice(0, 9), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // 日本時間の時間帯（朝6時・昼10時・夕方17時・夜19時から）
  const jst = (hour) => Date.UTC(2026, 9, 28, hour - 9);
  assert.deepEqual([5, 6, 9, 10, 16, 17, 18, 19, 23].map((hour) => core.ranchTimeOfDay(jst(hour))), ["night", "morning", "morning", "day", "day", "evening", "evening", "night", "night"]);
  assert.equal(rules.normalizeApplication(APPLICATION).application.allowGrazing, false, "old screens never opt in");
  assert.equal(rules.normalizeApplication({ ...APPLICATION, allowGrazing: true }).application.allowGrazing, true);
});

test("the server grows the ranch from the relationship, at most 10 a day per wallet, never from amounts", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  const xp = () => h.firestore.read("tributeProfiles/manager").ranchXp;
  assert.equal(xp(), 5, "welcoming a new wallet");
  assert.deepEqual((await h.act("manager", "state")).profile.ranch, { xp: 5, level: 1 });

  // 献上はその日初めてなら仕えた日として3。額は関係ない（大きくても小さくても同じ）。
  await act("payer", "tribute", { kind: "silent", amount: 100, clientRequestId: server.nextRequestId() });
  assert.equal(xp(), 8);
  await act("payer", "tribute", { kind: "silent", amount: 100, clientRequestId: server.nextRequestId() });
  assert.equal(xp(), 8, "the same day is counted once");
  const tributes = h.events(contractId).filter((event) => event.type === "tribute");
  await act("manager", "receive", { tributeSeq: tributes[0].seq, seal: "juryo" });
  assert.equal(xp(), 9, "receiving with a seal");
  await act("payer", "offer_words", { text: "今日も負けました。" });
  assert.equal(xp(), 9, "a word offering on a day already served adds no served day");
  await act("manager", "receive", { tributeSeq: tributes[1].seq, seal: "juryo" });
  assert.equal(xp(), 10);
  const offering = h.events(contractId).find((event) => event.type === "word_offering");
  await act("manager", "receive", { tributeSeq: offering.seq, seal: "juryo" });
  assert.equal(xp(), 10, "10 a day per wallet");
  const pair = Object.values(h.firestore.keys("tributePairs/").reduce((all, key) => ({ ...all, [key]: h.firestore.read(key) }), {}))[0];
  assert.equal(pair.ranchXpDay, 10);

  // 次の日は、言葉の献上だけでも仕えた日になる。
  h.advance(DAY);
  await act("payer", "offer_words", { text: "今日は言葉だけです。" });
  assert.equal(xp(), 13);
  const card = (await h.act("payer", "board")).managers.find((entry) => entry.publicManagerId === publicManagerId);
  assert.equal(card.ranchLevel, 1);
  assert.equal(h.balance("manager") >= 0, true);
});

test("managers from before the release start from their collars, and the card shows the level", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 500 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const profile = h.firestore.read("tributeProfiles/manager");
  delete profile.ranchXp;
  h.firestore.write("tributeProfiles/manager", { ...profile, collarCount: 4 });
  assert.deepEqual((await h.act("manager", "state")).profile.ranch, { xp: 20, level: 2 }, "4 wallets welcomed before × 5");
  await server.startContract(h, "manager", "payer", publicManagerId, {}, 0);
  assert.equal(h.firestore.read("tributeProfiles/manager").ranchXp, 25);
  const card = (await h.act("payer", "board")).managers.find((entry) => entry.publicManagerId === publicManagerId);
  assert.equal(card.ranchLevel, 2);
  assert.equal((await h.act("payer", "manager", { publicManagerId })).card.ranchLevel, 2);
});

test("grazing is the payer's choice; the manager picks the animal; neither moves Pay", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 500 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  const balances = { manager: h.balance("manager"), payer: h.balance("payer") };
  const applied = h.events(contractId).find((event) => event.type === "applied");
  assert.equal(applied.allowGrazing, true);
  const view = (await act("payer", "set_grazing", { allowGrazing: true })).contract;
  assert.equal(view.allowGrazing, true);
  assert.equal(view.ranchAnimal, rules.defaultRanchAnimal(contractId), "until the manager picks one");
  await rejects(act("manager", "set_grazing", { allowGrazing: false }), /この操作はできません/);
  const off = await act("payer", "set_grazing", { allowGrazing: false });
  assert.equal(off.contract.allowGrazing, false);
  assert.deepEqual(h.events(contractId).at(-1), { ...h.events(contractId).at(-1), type: "grazing_changed", actor: "payer", allowGrazing: false });
  await rejects(act("payer", "set_ranch_animal", { animal: "pig" }), /この操作はできません/);
  await rejects(act("manager", "set_ranch_animal", { animal: "horse" }), /動物を選び直して/);
  const eventsBefore = h.events(contractId).length;
  const picked = await act("manager", "set_ranch_animal", { animal: "pig" });
  assert.equal(picked.contract.ranchAnimal, "pig");
  assert.equal(h.events(contractId).length, eventsBefore, "picking an animal leaves no event in the thread");
  assert.deepEqual({ manager: h.balance("manager"), payer: h.balance("payer") }, balances);
});

test("moods come only from the contract's facts, and the day log compares with the last visit", async () => {
  const core = await loadCore();
  const noon = Date.UTC(2026, 9, 28, 3);
  const today = core.jstDateKey(noon);
  const base = { workOrder: null, hold: null, plea: null, awaitingReceipt: 0, pendingRequests: [], todayTributed: 0, lastServedDayKey: today, acceptedAt: noon - DAY };
  const mood = (extra, now = noon) => core.ranchAnimalMood({ ...base, ...extra }, now).mood;
  assert.equal(mood({ workOrder: { done: false } }), "away");
  assert.equal(mood({ workOrder: { kind: "contest", accepted: false, done: false } }), "idle", "an offered contest keeps the animal home");
  assert.equal(mood({}, Date.UTC(2026, 9, 28, 15)), "sleep", "midnight in Japan");
  assert.equal(mood({ hold: { since: 1 } }), "tied");
  assert.equal(mood({ plea: { granted: false } }), "plea");
  assert.equal(mood({ awaitingReceipt: 1 }), "letter");
  assert.equal(mood({ pendingRequests: [{}] }), "restless");
  assert.equal(mood({ todayTributed: 100 }), "eat");
  assert.equal(mood({ lastServedDayKey: core.jstDateKey(noon - 3 * DAY) }), "gaze");
  assert.equal(mood({}), "idle");
  for (const line of ["{name}は出稼ぎに出ている。", "{name}は眠っている。", "{name}は柵の外を見ている。"]) {
    assert.ok([{ workOrder: { done: false } }, {}, { lastServedDayKey: "2000-01-01" }].some((extra) => core.ranchAnimalMood({ ...base, ...extra }, line.includes("眠") ? Date.UTC(2026, 9, 28, 15) : noon).line === line), line);
  }
  const before = core.ranchSnapshot([{ contractId: "a", name: "ポチ", tributeCount: 1, totalTributed: 10 }, { contractId: "b", name: "去った財布" }]);
  const after = core.ranchSnapshot([{ contractId: "a", name: "ポチ", tributeCount: 3, totalTributed: 210, wordOfferings: 1, workOrdersDone: 1, contestWon: 1 }, { contractId: "c", name: "新入り" }]);
  assert.deepEqual(core.ranchDiary(before, after), [
    "ポチが干し草（200 Pay）を置いていった（2回）。",
    "ポチから手紙（言葉の献上）が届いた。",
    "ポチが出稼ぎから戻った。",
    "ポチが勝負に勝って戻った。",
    "新入りが牧場に来た。",
  ], "five lines at most");
  assert.deepEqual(core.ranchDiary(null, after), [], "nothing on the first visit");
  // 語り手の一言は三人称の事実だけ。財布の言葉として作らない（かぎかっこを使わない）。
  for (const id of ["away", "sleep", "tied", "plea", "letter", "restless", "eat", "gaze", "idle"]) assert.ok(id);
  assert.doesNotMatch(read("tribute-core.mjs").slice(read("tribute-core.mjs").indexOf("export function ranchAnimalMood"), read("tribute-core.mjs").indexOf("export function ranchSnapshot")), /「|出荷|ください|お願い/);
});

async function ranchRenderer(storage = new Map()) {
  const core = await loadCore();
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
    ...["managerNickname", "ranchImage", "ranchName", "ranchHerd", "ranchPercent", "ranchDiaryLines", "renderRanchAnimal", "renderRanchWeather", "ranchBubbleStyle", "renderRanch"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return context;
}

test("the ranch panel: only grazing wallets, away wallets listed, the level and the next facility", async () => {
  const core = await loadCore();
  const storage = new Map();
  const context = await ranchRenderer(storage);
  const now = Date.now();
  const contract = (id, extra = {}) => core.viewContract({
    contractId: id.repeat(40), managerUid: "manager", payerUid: `payer-${id}`, status: "active", acceptedAt: now - DAY, expiresAt: now + 9 * DAY,
    payerWalletName: `財布${id}`, allowGrazing: true, todayKey: core.jstDateKey(now), ...extra,
  }, "manager", now);
  const herd = [
    contract("1", { ranchAnimal: "cow" }),
    contract("2", { allowGrazing: false }),
    contract("3", { workOrder: { orderSeq: 1, target: 3, issuedAt: 1, reportedCount: 0, doneAt: 0 } }),
    contract("4", { ranchAnimal: "sheep" }),
  ];
  context.state.contracts = herd;
  assert.equal(context.renderRanch(herd, { card: null }), "", "only managers with a card have a ranch");
  const html = context.renderRanch(herd, { card: {}, ranch: { xp: 65 } });
  assert.match(html, /牧場 Lv\.3/);
  assert.match(html, /次の Lv まで あと 55/);
  assert.match(html, /次は Lv\.4 で「小屋」/);
  assert.match(html, /ranch-lv3-(day|evening|night)\.webp\?v=ranch-growth-v1/);
  assert.equal((html.match(/data-t="ranch-animal" data-contract="/g) || []).length, 3, "two on the ranch, one away (listed as a link)");
  assert.doesNotMatch(html, /財布2/, "a wallet who did not agree to graze is not on the ranch");
  assert.match(html, /出稼ぎに出ている：<button[^>]*>財布3<\/button>/);
  assert.match(html, /cow-(stand|walk1|walk2|eat|sleep)-/);
  assert.match(html, /日報/);
  assert.match(html, /前に見た時から、変わったことはありません。/, "first visit");
  assert.ok(storage.get("tribute-ranch-seen:manager"), "the snapshot stays on this device only");
  // 次に開いた時（新しい画面の状態）は、前に見た時と比べた日報が出る。
  const next = await ranchRenderer(storage);
  const grown = [contract("1", { ranchAnimal: "cow", tributeCount: 2, totalTributed: 120 }), herd[2], herd[3], contract("5")];
  next.state.contracts = grown;
  const later = next.renderRanch(grown, { card: {}, ranch: { xp: 65 } });
  assert.match(later, /財布1が干し草（120 Pay）を置いていった（2回）。/);
  assert.match(later, /財布5が牧場に来た。/);
  // 押した動物には、動物を選ぶボタンとスレッドへの近道が出る。
  next.state.ranch.selected = "1".repeat(40);
  const picked = next.renderRanch(grown, { card: {}, ranch: { xp: 1500 } });
  assert.match(picked, /牧場 Lv\.10/);
  assert.match(picked, /data-t="ranch-kind" data-contract="1{40}" data-animal="cow" aria-pressed="true"/);
  assert.match(picked, /data-t="open-thread" data-contract="1{40}">スレッドへ/);
});

test("client and server wiring, assets, privacy of the art scripts, cache keys and the design record", () => {
  assert.match(client, /return frame\(`<div class="tribute-hub">\n    \$\{renderRanch\(open, profile\)\}/, "the ranch is at the top of the contracts screen");
  assert.equal((client.match(/\$\{vaultTag\(card\.vault\)\}\$\{ranchTag\(card\)\}/g) || []).length, 3, "board card, manager detail and my card");
  assert.match(client, /<input type="checkbox" name="allowGrazing" \$\{checked\("allowGrazing", true\)\} \/>/);
  assert.match(client, /allowGrazing: data\.get\("allowGrazing"\) === "on",/);
  // 第2段から、放牧の設定は財布の「牧場をのぞく」の中にある（tribute-ranch-peek.test.js）。
  assert.match(client, /data-sheet="ranch-peek">牧場をのぞく<\/button>/);
  assert.match(client, /case "ranch-peek": \{/);
  assert.match(client, /mutate\("set_grazing"/);
  assert.match(client, /mutate\("set_ranch_animal"/);
  assert.match(client, /case "grazing_changed":/);
  for (const action of ["set_grazing", "set_ranch_animal"]) {
    assert.match(service, new RegExp(`\\n    ${action}: \\{`), action);
    assert.match(client, new RegExp(`case "${action}": \\{`), `${action} preview`);
  }
  for (const grant of ["accept", "servedDay", "receive", "confirm", "plea", "extend"]) assert.match(service, new RegExp(`grantRanchXp\\(ctx, RANCH_XP\\.${grant}\\)`), grant);
  assert.doesNotMatch(service.slice(service.indexOf("function grantRanchXp"), service.indexOf("function newServedDay")), /amount|Pay/, "the level never reads amounts");

  const dir = path.join(root, "assets/tribute-ranch");
  const names = [];
  for (const time of ["day", "evening", "night"]) {
    for (let level = 1; level <= 30; level += 1) names.push(`ranch-lv${level}-${time}.webp`);
    for (const animal of ["cow", "pig", "sheep", "goat", "chicken", "rabbit"]) {
      for (const pose of ["stand", "walk1", "walk2", "eat", "sleep"]) {
        for (const tier of [0, 1, 2, 3, 4]) names.push(`${animal}-${pose}${tier ? `-t${tier}` : ""}-${time}.webp`);
      }
    }
    for (const prop of ["letter", "hay", "stake"]) names.push(`prop-${prop}-${time}.webp`);
  }
  let total = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    assert.ok(fs.existsSync(file), name);
    const size = fs.statSync(file).size;
    assert.ok(size > 300 && size < 40_000, `${name}: ${size}`);
    total += size;
  }
  assert.ok(total < 5_000_000, `all ranch art: ${total}`);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".webp")).sort(), [...names].sort());
  assert.ok(fs.existsSync(path.join(root, "art/tribute-ranch/render_ranch.py")));
  assert.ok(JSON.parse(read("firebase.json")).hosting.ignore.includes("art/**"));
  assert.match(read(".assetsignore"), /^art\/$/m);

  for (const selector of [".tribute-ranch {", ".tribute-ranch-scene {", ".tribute-ranch-animal", ".tribute-ranch-bubble {", ".tribute-ranch.is-night .tribute-ranch-scene", ".tribute-tag.is-ranch", "@keyframes ranch-wander"]) assert.ok(styles.includes(selector), selector);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\n  \.tribute-ranch-animal,/);
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-pasture-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-pasture-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /第1段（牧場経営）を実装した/);
});
