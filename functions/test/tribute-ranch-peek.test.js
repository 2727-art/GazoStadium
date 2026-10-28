"use strict";

// 牧場経営の第2段（ranch-peek-v1、設計書16.11）。2026-10-28 のユーザーの指示「第2段の実装に入ってください」:
// 財布の「牧場をのぞく」（自分の動物だけ）、財布の鳴き声（20文字 × 3つ、応援欄と同じ確認）、
// 天気と季節（日付で決まる）、動物の種類を増やす（ヤギ・ニワトリ・ウサギ）。
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
const art = read("art/tribute-ranch/render_ranch.py");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const DAY = 86_400_000;
const JST_NOON = (year, month, day) => Date.UTC(year, month - 1, day, 3);

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

test("six animals, and the animal before the manager picks one is the same as before", async () => {
  const core = await loadCore();
  assert.deepEqual([...rules.RANCH_ANIMALS], ["cow", "pig", "sheep", "goat", "chicken", "rabbit"]);
  assert.deepEqual([...core.RANCH_ANIMALS], [...rules.RANCH_ANIMALS]);
  assert.deepEqual([...rules.RANCH_DEFAULT_ANIMALS], ["cow", "pig", "sheep"]);
  assert.deepEqual([...core.RANCH_DEFAULT_ANIMALS], [...rules.RANCH_DEFAULT_ANIMALS]);
  assert.deepEqual(Object.keys(core.RANCH_ANIMAL_LABELS), [...core.RANCH_ANIMALS]);
  assert.deepEqual([core.RANCH_ANIMAL_LABELS.goat, core.RANCH_ANIMAL_LABELS.chicken, core.RANCH_ANIMAL_LABELS.rabbit], ["ヤギ", "ニワトリ", "ウサギ"]);
  // 第1段の決め方（牛・豚・羊の3種で割る）と同じ結果になり、動物を増やしても今の契約の動物は変わらない。
  const before = (id) => {
    let sum = 0;
    for (const char of id) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
    return ["cow", "pig", "sheep"][sum % 3];
  };
  for (let index = 0; index < 300; index += 1) {
    const id = `${index.toString(36)}xQ7`.repeat(12).slice(0, 40);
    assert.equal(rules.defaultRanchAnimal(id), before(id), id);
    assert.equal(core.defaultRanchAnimal(id), before(id), id);
  }
});

test("moo lines: up to three lines of twenty characters, checked like cheers, the same in the browser", async () => {
  const core = await loadCore();
  assert.deepEqual({ ...rules.RANCH_MOO }, { length: 20, lines: 3 });
  assert.deepEqual({ ...core.RANCH_MOO }, { ...rules.RANCH_MOO });
  assert.deepEqual(rules.normalizeMooLines(["  もー  ", "", "もー", "ごはん"]), { lines: ["もー", "ごはん"] }, "trimmed, blanks and repeats dropped");
  assert.deepEqual(rules.normalizeMooLines([]), { lines: [] }, "empty clears");
  assert.equal(Array.from(rules.normalizeMooLines(["あ".repeat(25)]).lines[0]).length, 20);
  assert.match(rules.normalizeMooLines(["a", "b", "c", "d"]).error, /鳴き声は3つまでです/);
  assert.match(rules.normalizeMooLines("もー").error, /確かめられません/);
  assert.equal(rules.normalizeMooLines(["example.com を見て"]).error, rules.FORBIDDEN_MESSAGES.url);
  assert.equal(rules.normalizeMooLines(["おっぱい"]).error, "鳴き声には性的な言葉は書けません。");
  for (const lines of [["もー"], ["example.com を見て"], ["090-1234-5678"], ["1万円ちょうだい"], ["おっぱい"], ["a", "b", "c", "d"], ["", "もー", " "]]) {
    const checked = rules.normalizeMooLines(lines);
    assert.equal(core.mooProblem(lines), checked.error || "", lines.join("/"));
  }
  assert.equal(core.mooProblem(["あ".repeat(21)]), "鳴き声は20文字までです。", "the browser stops long lines before sending");
});

test("the wallet writes moo lines for its own contract; the manager sees them; no event is left", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  const eventsBefore = h.events(contractId).length;
  const saved = await act("payer", "set_moo", { lines: ["もー", " ", "ごはんちょうだい"] });
  assert.deepEqual(saved.contract.mooLines, ["もー", "ごはんちょうだい"]);
  assert.deepEqual(h.contract(contractId).mooLines, ["もー", "ごはんちょうだい"]);
  assert.equal(h.events(contractId).length, eventsBefore, "writing moo lines leaves no event in the thread");
  const again = await act("payer", "set_moo", { lines: ["もー", "ごはんちょうだい"] });
  assert.equal(again.unchanged, true);
  await rejects(act("manager", "set_moo", { lines: ["もー"] }), /この操作はできません/);
  await rejects(act("payer", "set_moo", { lines: ["example.com を見て"] }), /URLやドメイン/);
  await rejects(act("payer", "set_moo", { lines: ["おっぱい"] }), /鳴き声には性的な言葉は書けません/);
  await rejects(act("payer", "set_moo", { lines: ["1", "2", "3", "4"] }), /3つまで/);
  assert.deepEqual(h.contract(contractId).mooLines, ["もー", "ごはんちょうだい"], "rejected lines change nothing");
  // 管理人の画面（契約の見え方）にも同じ鳴き声が出る。
  const core = await loadCore();
  assert.deepEqual(core.viewContract(h.contract(contractId), "manager", h.now()).mooLines, ["もー", "ごはんちょうだい"]);
  assert.deepEqual(core.viewContract({ ...h.contract(contractId), mooLines: ["x".repeat(30), "", 7, "y"] }, "manager", h.now()).mooLines, ["x".repeat(20), "7", "y"]);
  const cleared = await act("payer", "set_moo", { lines: [] });
  assert.deepEqual(cleared.contract.mooLines, []);
  // 新しい動物も選べる。
  for (const animal of ["goat", "chicken", "rabbit"]) {
    const picked = await act("manager", "set_ranch_animal", { animal });
    assert.equal(picked.contract.ranchAnimal, animal);
  }
});

test("the wallet's peek returns only the manager's ranch level and writes nothing", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const profileKey = h.firestore.keys("tributeProfiles/").find((key) => key.endsWith("/manager"));
  h.firestore.write(profileKey, { ...h.firestore.read(profileKey), ranchXp: 4_900 });
  const snapshot = () => JSON.stringify(h.firestore.keys("").map((key) => [key, h.firestore.read(key)]));
  const before = snapshot();
  h.advance(2_100);
  const peek = await h.act("payer", "ranch_peek", { contractId });
  assert.deepEqual(peek, { ok: true, contractId, ranchLevel: 15, ranchName: "" }, "the level and the ranch name only (both on the public card): no other wallets, head count or points");
  assert.equal(snapshot(), before, "reading the ranch writes nothing");
  await rejects(h.act("manager", "ranch_peek", { contractId }), /牧場をのぞけるのは、その契約の財布だけです/);
  h.advance(2_100);
  await h.act("payer", "terminate", { contractId });
  await rejects(h.act("payer", "ranch_peek", { contractId }), /終わった契約では、牧場をのぞけません/);
});

test("weather and season come from the Japan date only", async () => {
  const core = await loadCore();
  const seasons = { 1: "winter", 2: "winter", 3: "spring", 5: "spring", 6: "summer", 8: "summer", 9: "autumn", 11: "autumn", 12: "winter" };
  for (const [month, season] of Object.entries(seasons)) assert.equal(core.ranchWeather(JST_NOON(2026, Number(month), 15)).season, season, month);
  // 同じ日（日本時間）なら、時刻が変わっても同じ天気。日本時間の0時で変わる。
  const morning = Date.UTC(2026, 9, 27, 15, 30);
  assert.deepEqual(core.ranchWeather(morning), core.ranchWeather(Date.UTC(2026, 9, 28, 14, 59)));
  const counts = {};
  for (let day = 0; day < 730; day += 1) {
    const { season, weather, label } = core.ranchWeather(JST_NOON(2026, 1, 1) + day * DAY);
    counts[weather] = (counts[weather] || 0) + 1;
    assert.equal(label, `${core.RANCH_SEASON_LABELS[season]}・${core.RANCH_WEATHER_LABELS[weather]}`);
    if (weather === "snow") assert.equal(season, "winter", "snow only in winter");
    if (season === "winter") assert.notEqual(weather, "rain", "winter has snow instead of rain");
  }
  assert.ok(counts.sunny > 300 && counts.cloudy > 150 && counts.rain > 80 && counts.snow > 20, JSON.stringify(counts));
  // 続く日が同じ順に並ばない（日付をそのまま割った周期にしない）。
  const run = Array.from({ length: 30 }, (_, index) => core.ranchWeather(JST_NOON(2026, 4, 1) + index * DAY).weather).join(",");
  assert.ok(new Set(run.split(",")).size >= 3 && !/(sunny,){8}/.test(run), run);
});

test("moods for the wallet's own view hide the manager-only facts, and idle lines follow the weather", async () => {
  const core = await loadCore();
  const noon = JST_NOON(2026, 10, 28);
  const today = core.jstDateKey(noon);
  const raw = { contractId: "p".repeat(40), managerUid: "manager", payerUid: "payer", status: "active", acceptedAt: noon - 10 * DAY, expiresAt: noon + 9 * DAY, allowGrazing: true };
  const unpaid = core.viewContract({ ...raw, todayKey: today, pendingRequests: { abc: { requestId: "abcdef0123456789", amount: 50, at: noon - 60_000 } } }, "payer", noon);
  if (unpaid.pendingRequests.length) {
    assert.equal(core.ranchAnimalMood(unpaid, noon).mood, "restless");
    assert.notEqual(core.ranchAnimalMood(unpaid, noon, { payer: true }).mood, "restless", "the wallet does not see itself as restless");
  }
  const quiet = core.viewContract({ ...raw, todayKey: core.jstDateKey(noon - 5 * DAY) }, "payer", noon);
  assert.equal(core.ranchAnimalMood(quiet, noon).mood, "gaze");
  assert.equal(core.ranchAnimalMood(quiet, noon, { payer: true }).mood, "idle", "nor as gazing out of the fence");
  const lines = {};
  for (let day = 0; day < 400; day += 1) {
    const at = noon + day * DAY;
    const mood = core.ranchAnimalMood(core.viewContract({ ...raw, acceptedAt: at - DAY, todayKey: core.jstDateKey(at - DAY) }, "payer", at), at, { payer: true });
    lines[core.ranchWeather(at).weather] = mood.line;
  }
  assert.deepEqual(lines, {
    sunny: "{name}は日なたでのんびりしている。",
    cloudy: "{name}は草の上でのんびりしている。",
    rain: "{name}は屋根の下で、雨の音を聞いている。",
    snow: "{name}は雪を見上げている。",
  });
});

async function ranchRenderer() {
  const core = await loadCore();
  const context = vm.createContext({
    ...core,
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    previewScreen: "",
    window: { localStorage: { getItem: () => null, setItem: () => {} } },
    state: { uid: "u", contracts: [], ranch: { selected: "", diary: null }, busy: "" },
  });
  vm.runInContext([
    /const RANCH_ASSET_KEY = [^\n]*\n/.exec(client)[0],
    /const RANCH_WANDER = [^\n]*\n/.exec(client)[0],
    ...["managerNickname", "ranchImage", "ranchName", "ranchHerd", "ranchPercent", "ranchDiaryLines", "renderRanchAnimal", "renderRanchWeather", "ranchBubbleStyle", "ranchPlacements", "renderRanch", "renderRanchRecord", "renderRanchPeek"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return { core, context };
}

test("the manager's ranch alternates narrator facts with the wallet's own moo lines, and shows the weather", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  const contract = (id, extra = {}) => core.viewContract({
    contractId: id.repeat(40), managerUid: "manager", payerUid: `payer-${id}`, status: "active", acceptedAt: now - DAY, expiresAt: now + 9 * DAY,
    payerWalletName: `財布${id}`, allowGrazing: true, ranchAnimal: "goat", todayKey: core.jstDateKey(now), ...extra,
  }, "manager", now);
  const herd = [contract("1", { mooLines: ["もー", "<b>"] }), contract("2", { ranchAnimal: "chicken" })];
  context.state.contracts = herd;
  context.state.ranch.selected = "1".repeat(40);
  const html = context.renderRanch(herd, { card: {}, ranch: { xp: 0 } });
  const weather = core.ranchWeather(now);
  assert.ok(html.includes(`is-${weather.season} is-${weather.weather}`), "season and weather classes");
  assert.ok(html.includes(`<small class="tribute-ranch-weather">${weather.label}</small>`));
  assert.match(html, /<span class="tribute-ranch-weather-fx" aria-hidden="true"><\/span>/);
  assert.match(html, /class="tribute-ranch-bubble has-moo" aria-hidden="true"><span class="is-fact">[^<]+<\/span><span class="is-moo">「(もー|&lt;b&gt;)」<\/span>/, "the wallet's line in 「」, escaped");
  assert.match(html, /鳴き声：「もー」「&lt;b&gt;」/, "the selected animal's card lists the moo lines");
  assert.match(html, /chicken-(stand|walk1|walk2|eat|sleep)-(day|evening|night)\.webp/);
  assert.match(html, /aria-pressed="true" *>ヤギ<\/button>/);
  for (const label of ["牛", "豚", "羊", "ヤギ", "ニワトリ", "ウサギ"]) assert.ok(html.includes(`>${label}</button>`), label);
  assert.match(html, /吹き出しの「」は、その財布が自分で書いた鳴き声です。/);
  // 財布が書いていない時は、語り手の一言だけ（財布の言葉を作らない）。
  const second = /data-contract="2{40}"[\s\S]*?<\/button>/.exec(html)[0];
  assert.doesNotMatch(second, /is-moo|「/);
});

test("the wallet's peek shows the manager's ranch with only its own animal, under its wallet name", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  const view = core.viewContract({
    contractId: "1".repeat(40), managerUid: "manager", payerUid: "u", status: "active", acceptedAt: now - DAY, expiresAt: now + 9 * DAY,
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowGrazing: true, ranchAnimal: "rabbit", servedTotal: 45,
    todayKey: core.jstDateKey(now), mooLines: ["もー"], nickname: "呼び名",
  }, "u", now);
  assert.equal(view.role, "payer");
  const html = context.renderRanchPeek(view, { status: "ready", level: 33 });
  assert.match(html, /牧場 Lv\.33/);
  assert.match(html, /ranch-lv30-(day|evening|night)\.webp/, "art stops at Lv30");
  assert.equal((html.match(/class="tribute-ranch-animal /g) || []).length, 1, "one animal only");
  assert.match(html, /rabbit-(stand|walk1|walk2|eat|sleep)-t2-(day|evening|night)\.webp/);
  assert.match(html, /<span class="tribute-ranch-name">ポチ財布<\/span>/);
  assert.doesNotMatch(html, /呼び名|data-t="ranch-animal"|data-t="ranch-kind"|スレッドへ/, "no nickname, no manager controls");
  assert.match(html, /なつき：リボン（仕えた日 45日）・あと55日で花かんむり/);
  assert.match(html, /<form class="tribute-sheet-form" data-form="moo">/);
  assert.equal((html.match(/<input name="moo\d" maxlength="20" /g) || []).length, 3);
  assert.match(html, /value="もー"/);
  assert.match(html, /data-t="set-grazing" data-allow="0"/);
  assert.match(html, /ほかの財布の動物は見えません/);
  const off = context.renderRanchPeek({ ...view, allowGrazing: false }, { status: "ready", level: 2 });
  assert.doesNotMatch(off, /class="tribute-ranch-animal /);
  assert.match(off, /いまは放牧されていません。/);
  assert.match(off, /data-t="set-grazing" data-allow="1"/);
  const pending = context.renderRanchPeek({ ...view, status: "pending" }, { status: "ready", level: 2 });
  assert.doesNotMatch(pending, /class="tribute-ranch-animal /);
  assert.match(pending, /申し込みが受けられると、この牧場に放牧されます。/);
  assert.match(context.renderRanchPeek(view, { status: "loading" }), /牧場を読み込んでいます/);
  // 財布の画面は、契約一覧（ほかの財布）を読まない。
  assert.doesNotMatch(extract(client, "renderRanchPeek"), /ranchHerd|state\.contracts/);
});

test("client wiring, preview, styles, art, cache keys and the design record", () => {
  assert.match(client, /data-sheet="ranch-peek">牧場をのぞく<\/button>/);
  assert.match(client, /if \(target\.dataset\.sheet === "ranch-peek"\) openRanchPeek\(\);/);
  assert.match(client, /await call\("ranch_peek", \{ contractId \}\)/);
  assert.match(client, /mutate\("set_moo", contractPayload\(\{ lines: lines\.filter\(Boolean\) \}\)/);
  assert.match(client, /case "moo": \{/);
  assert.doesNotMatch(client, /grazing-settings/, "the grazing switch moved into the peek");
  for (const action of ["set_moo", "ranch_peek"]) {
    assert.match(service, new RegExp(`\\n  "${action}",`), `${action} is a known action`);
    assert.match(client, new RegExp(`case "${action}":`), `${action} preview`);
  }
  assert.match(service, /\n    set_moo: \{\n      roles: \["payer"\],\n      statuses: \["pending", "active"\],/);
  assert.match(service, /case "ranch_peek": return ranchPeekAction\(uid, data\);/);
  assert.match(client, /"ranch-peek": \(\) => \{/);

  for (const selector of [".tribute-ranch-weather-fx {", ".tribute-ranch.is-rain .tribute-ranch-weather-fx::before", ".tribute-ranch.is-snow .tribute-ranch-weather-fx::before", ".tribute-ranch.is-autumn .tribute-ranch-ground", "@keyframes ranch-say-moo", ".tribute-ranch-peek-body {"]) assert.ok(styles.includes(selector), selector);
  assert.match(styles, /\.tribute-ranch-weather-fx::before,\n  \.tribute-ranch-weather-fx::after \{ animation: none !important; \}\n/, "no falling rain or snow with reduced motion");

  assert.match(art, /def goat\(pose, group, tier=0\):/);
  assert.match(art, /def chicken\(pose, group, tier=0\):/);
  assert.match(art, /def rabbit\(pose, group, tier=0\):/);
  assert.match(art, /ANIMALS = \{"cow": cow, "pig": pig, "sheep": sheep, "goat": goat, "chicken": chicken, "rabbit": rabbit\}/);
  for (const animal of ["goat", "chicken", "rabbit"]) {
    for (const time of ["day", "evening", "night"]) {
      for (const pose of ["stand", "walk1", "walk2", "eat", "sleep"]) {
        for (const tier of [0, 1, 2, 3, 4]) assert.ok(fs.existsSync(path.join(root, `assets/tribute-ranch/${animal}-${pose}${tier ? `-t${tier}` : ""}-${time}.webp`)), `${animal} ${pose} ${tier} ${time}`);
      }
    }
  }

  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-peek-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-peek-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /第2段（財布の「牧場をのぞく」・財布の鳴き声・天気と季節・動物を増やす）を実装した（キャッシュキー `ranch-peek-v1`、16\.13）/);
  assert.match(design, /`set_moo`/);
  assert.match(design, /`ranch_peek`/);
});
