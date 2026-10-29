"use strict";

// 牧場の記念写真・財布の飼育記録・牧場の名前（ranch-photo-v1、設計書16.15）。2026-10-28 のユーザーの決定「１，２，３のみ実装をお願いします」:
// 記念写真は、動物をスクショ掲載を許した財布の分だけ名前なしで写す。飼育記録は財布の「牧場をのぞく」に、自分の動物の分だけ。
// 牧場の名前はカードの札に出るので、今日のひとことと同じ確認を通す。
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
const share = read("tribute-share.mjs");
const styles = read("tribute.css");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);
const DAY = 86_400_000;
// 画面は Date.now() で時間帯を決める（日本時間23〜6時は眠っていて、鳴き声も出ない）。いつ走らせても同じ結果になるよう、
// 画面の時計を日本時間の昼に止める。
const NOON = Date.UTC(2026, 9, 28, 3);
class NoonDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [NOON]));
  }

  static now() {
    return NOON;
  }
}

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

test("ranch names: the ○○ of ○○牧場, ten characters, checked like the word of the day, the same in the browser", async () => {
  const core = await loadCore();
  assert.deepEqual({ ...rules.RANCH_NAME }, { length: 10 });
  assert.deepEqual({ ...core.RANCH_NAME }, { ...rules.RANCH_NAME });
  assert.deepEqual(rules.normalizeRanchName("ひだまり牧場"), { name: "ひだまり" }, "a trailing 牧場 is dropped");
  assert.deepEqual(rules.normalizeRanchName("  そよかぜ  "), { name: "そよかぜ" });
  assert.deepEqual(rules.normalizeRanchName(""), { name: "" }, "empty removes the name");
  assert.deepEqual(rules.normalizeRanchName("牧場"), { name: "" });
  assert.equal(rules.normalizeRanchName("あいうえおかきくけこさし").name, "あいうえおかきくけこ");
  // 10文字を超える入力は、画面では長さで止め、サーバーは切り詰める（入力欄の maxlength でも止まる）。ここでは10文字以内で比べる。
  for (const value of ["ひだまり牧場", "abc.com", "おっぱい", "", "LINE交換", "そよかぜ"]) {
    const checked = rules.normalizeRanchName(value);
    assert.equal(core.ranchNameProblem(value), checked.error || "", value);
  }
  assert.equal(rules.normalizeRanchName("おっぱい").error, "牧場の名前は掲示板にも出るため、性的な言葉は書けません。");
  assert.equal(core.ranchNameProblem("あいうえおかきくけこさ"), "牧場の名前は10文字までです。");
  assert.equal(core.ranchTitle("ひだまり"), "ひだまり牧場");
  assert.equal(core.ranchTitle(""), "牧場");
});

test("the manager names the ranch; the card, the wallet's peek and the profile carry it; the board order does not move", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const profileKey = h.firestore.keys("tributeProfiles/").find((key) => key.endsWith("/manager"));
  const activeBefore = h.firestore.read(profileKey).lastActiveAt;
  h.advance(60_000);
  const named = await h.act("manager", "set_ranch_name", { name: "ひだまり牧場" });
  assert.equal(named.profile.ranch.name, "ひだまり");
  assert.equal(named.profile.card.ranchName, "ひだまり");
  assert.equal(h.firestore.read(profileKey).ranchName, "ひだまり");
  assert.equal(h.firestore.read(profileKey).lastActiveAt, activeBefore, "naming is not activity on the board");
  const detail = await h.act("payer", "manager", { publicManagerId });
  assert.equal(detail.card.ranchName, "ひだまり", "the public card");
  const peek = await h.act("payer", "ranch_peek", { contractId });
  assert.equal(peek.ranchName, "ひだまり");
  await rejects(h.act("manager", "set_ranch_name", { name: "abc.com" }), /URLやドメイン/);
  await rejects(h.act("manager", "set_ranch_name", { name: "おっぱい" }), /性的な言葉/);
  await rejects(h.act("payer", "set_ranch_name", { name: "そよかぜ" }), /管理人カードを作ってから/);
  const cleared = await h.act("manager", "set_ranch_name", { name: "" });
  assert.equal(cleared.profile.ranch.name, "");
  assert.equal(cleared.profile.card.ranchName, "");
});

test("the record keeps the day each accessory came and the days the wallet was patted, across contracts", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 50_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const first = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true, durationDays: 14 }, 0);
  let bellAt = 0;
  for (let day = 1; day <= 7; day += 1) {
    h.advance(DAY);
    const result = await h.act("payer", "tribute", { contractId: first, kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
    if (day === 7) bellAt = h.now();
    assert.equal(result.contract.servedTotal, day);
  }
  const pairKey = h.firestore.keys("tributePairs/")[0];
  assert.deepEqual(h.contract(first).fondnessAt, { 1: bellAt }, "the bell came on the 7th day");
  assert.deepEqual(h.firestore.read(pairKey).fondnessAt, { 1: bellAt });
  h.advance(2_100);
  await h.act("manager", "ranch_pat", { contractId: first });
  h.advance(DAY);
  await h.act("manager", "ranch_pat", { contractId: first });
  assert.equal(h.contract(first).patDays, 2);
  assert.equal(h.firestore.read(pairKey).patDays, 2);
  h.advance(2_100);
  await h.act("payer", "terminate", { contractId: first });
  h.advance(60_000);
  const second = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true, durationDays: 14 }, 0);
  assert.deepEqual(h.contract(second).fondnessAt, { 1: bellAt }, "copied when the manager accepts again");
  assert.equal(h.contract(second).patDays, 2);
  const core = await loadCore();
  const view = core.viewContract(h.contract(second), "payer", h.now());
  assert.deepEqual(view.fondnessAt, { 1: bellAt });
  assert.equal(view.patDays, 2);
  // 推定から始まる古い組は、飛び越えた段階の日は残さない（分からないため）。
  const pair = h.firestore.read(pairKey);
  delete pair.servedTotal;
  delete pair.fondnessAt;
  h.firestore.write(pairKey, { ...pair, count: 40, firstAt: h.now() - 39.5 * DAY });
  h.advance(DAY);
  await h.act("payer", "tribute", { contractId: second, kind: "silent", amount: 10, clientRequestId: server.nextRequestId() });
  assert.equal(h.contract(second).servedTotal, 41);
  assert.equal(h.contract(second).fondnessAt?.[2], undefined, "the ribbon day before the record began is unknown");
});

async function ranchRenderer(extra = {}) {
  const core = await loadCore();
  const context = vm.createContext({
    ...core,
    Date: NoonDate,
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    previewScreen: "",
    avatarUrl: () => "",
    isPremiumAvatar: () => false,
    sigilColor: () => "#ff4fa3",
    window: { localStorage: { getItem: () => null, setItem: () => {} } },
    state: { uid: "u", contracts: [], ranch: { selected: "", diary: null, heart: null, naming: false }, busy: "" },
    ...extra,
  });
  vm.runInContext([
    /const RANCH_ASSET_KEY = [^\n]*\n/.exec(client)[0],
    /const RANCH_WANDER = [^\n]*\n/.exec(client)[0],
    ...["managerNickname", "ranchTag", "ranchImage", "ranchName", "ranchHerd", "ranchPercent", "ranchDiaryLines", "renderRanchAnimal", "renderRanchWeather", "ranchBubbleStyle", "ranchPlacements", "renderRanch", "ranchPhotoData", "renderRanchRecord", "renderRanchPeek"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return { core, context };
}

test("the wallet's peek shows its own record, and the ranch name", async () => {
  const { core, context } = await ranchRenderer();
  const now = NOON;
  const day = (at) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(at));
  const raw = {
    contractId: "1".repeat(40), managerUid: "manager", payerUid: "u", status: "active", acceptedAt: now - 50 * DAY, expiresAt: now + 9 * DAY,
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowGrazing: true, ranchAnimal: "rabbit", todayKey: core.jstDateKey(now),
    servedTotal: 45, fondnessAt: { 2: now - 15 * DAY }, patDays: 12, pattedAt: now - 2 * DAY,
  };
  const html = context.renderRanchPeek(core.viewContract(raw, "u", now), { status: "ready", level: 18, ranchName: "ひだまり" });
  assert.match(html, /<strong>ひだまり牧場 Lv\.18<\/strong>/);
  assert.match(html, /<h3>飼育記録<\/h3>/);
  for (const [label, value] of [
    ["この契約で迎えられた日", day(now - 50 * DAY)],
    ["仕えた日（通算）", "45日"],
    ["鈴", "仕えた日7日で付いた"],
    ["リボン", `${day(now - 15 * DAY)}に付いた`],
    ["次の飾り", "花かんむり（あと55日）"],
    ["なでてもらった日", "12日"],
  ]) assert.ok(html.includes(`<dt>${label}</dt><dd>${value}</dd>`), `${label}: ${value}`);
  assert.doesNotMatch(html, /<dt>花かんむり<\/dt>/, "not yet");
  const pending = context.renderRanchPeek(core.viewContract({ ...raw, status: "pending", acceptedAt: 0, servedTotal: 0, fondnessAt: {}, patDays: 0 }, "u", now), { status: "ready", level: 2 });
  assert.ok(pending.includes("<dt>この契約で迎えられた日</dt><dd>まだ（申し込み中）</dd>"));
  assert.match(pending, /<strong>牧場 Lv\.2<\/strong>/, "no name: just 牧場");
  assert.doesNotMatch(extract(client, "renderRanchRecord"), /state\.contracts|ranchHerd/, "only its own contract");
});

test("the card tag and the manager's panel carry the ranch name; the panel has the photo and naming buttons", async () => {
  const { core, context } = await ranchRenderer();
  assert.equal(context.ranchTag({ ranchLevel: 12, ranchName: "<b>" }), '<span class="tribute-tag is-ranch" title="牧場レベル：財布との関係の積み重ねで上がります"><i aria-hidden="true">牧</i><b>&lt;b&gt;牧場</b> Lv.12</span>');
  assert.match(context.ranchTag({ ranchLevel: 3 }), /<i aria-hidden="true">牧<\/i>Lv\.3<\/span>/, "no name: as before");
  const html = context.renderRanch([], { card: {}, ranch: { xp: 0, name: "ひだまり" } });
  assert.match(html, /<strong>ひだまり牧場 Lv\.1<\/strong>/);
  assert.match(html, /data-t="ranch-photo">記念写真<\/button>/);
  assert.match(html, /data-t="ranch-naming" aria-expanded="false">名前を変える<\/button>/);
  context.state.ranch.naming = true;
  const naming = context.renderRanch([], { card: {}, ranch: { xp: 0, name: "" } });
  assert.match(naming, /data-form="ranch-name"/);
  assert.match(naming, /<input name="ranchName" maxlength="12" value="" autocomplete="off" \/>/);
  assert.match(naming, />名前を付ける<\/button>/);
  assert.ok(core.RANCH_NAME.length + 2 === 12, "room for a typed 牧場");
});

test("the photo shows only animals whose wallets allow screenshots, without names, placed among themselves", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.UTC(2026, 9, 28, 3);
  const contract = (id, extra = {}) => core.viewContract({
    contractId: id.repeat(40), managerUid: "manager", payerUid: `payer-${id}`, status: "active", acceptedAt: now - DAY, expiresAt: now + 9 * DAY,
    payerWalletName: `財布${id}`, allowGrazing: true, ranchAnimal: "goat", todayKey: core.jstDateKey(now), servedTotal: 45, ...extra,
  }, "manager", now);
  context.state.contracts = [
    contract("1", { allowScreenshots: true, todayTributed: 100 }),
    contract("2", { allowScreenshots: false, hold: { since: now - 1000, note: "" } }),
    contract("3", { allowScreenshots: true, nickname: "呼び名" }),
    contract("4", { allowScreenshots: true, allowGrazing: false }),
  ];
  const data = context.ranchPhotoData({ card: { personaName: "ミオ様", disclosure: "nekama" }, ranch: { xp: 4_900, name: "ひだまり" } }, now);
  assert.equal(data.title, "ひだまり牧場");
  assert.equal(data.level, 15);
  assert.equal(data.weatherLabel, core.ranchWeather(now).label);
  assert.equal(data.scene.animals.length, 2, "screenshots allowed and grazing");
  assert.equal(data.scene.stake, null, "the tied wallet did not allow screenshots, so no stake either");
  assert.equal(JSON.stringify(data.scene.animals.map((animal) => [animal.x, animal.y])), JSON.stringify(core.RANCH_LAYOUT.spots.slice(0, 2)), "placed among themselves, no gaps");
  assert.match(data.scene.animals[0].url, /goat-eat-t2-day\.webp/);
  assert.match(data.scene.animals[0].hay, /prop-hay-day\.webp/);
  assert.match(data.scene.ground, /ranch-lv15-day\.webp/);
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /財布\d|呼び名|payer-|1{40}/, "no wallet names, nicknames or ids in the picture data");
  // 13頭目からは少し小さく写す（画面と同じ）。
  context.state.contracts = Array.from({ length: 14 }, (_, index) => contract(String.fromCharCode(97 + index), { allowScreenshots: true }));
  assert.ok(context.ranchPhotoData({ card: { personaName: "ミオ様" }, ranch: { xp: 0 } }, now).scene.animals.every((animal) => animal.width === 0.14));
});

test("the share module draws the photo with the required footer and no URL; the sheet and handlers are wired", () => {
  const body = share.slice(share.indexOf("export async function renderRanchPhotoImage("), share.indexOf("export function canvasToPngBlob("));
  assert.match(body, /paintHeader\(ctx, "RANCH PHOTO", date\);/);
  assert.match(body, /paintFooter\(ctx\);/, "AnjuPay・換金不可 and the ranch name always");
  assert.doesNotMatch(body, /walletName|nickname|https?:/, "no wallet names and no URL");
  assert.match(share, /export const RANCH_PHOTO_TEXT = "#お貢ぎ牧場 #わたしの牧場";/);
  assert.match(client, /await navigator\.share\(\{ files: \[file\], text: RANCH_PHOTO_TEXT \}\);/);
  assert.match(client, /if \(sheet\.type === "ranch-photo"\) return renderRanchPhotoSheet\(sheet, wrap\);/);
  assert.match(client, /\["share", "recruit", "ranch-photo"\]\.includes\(state\.sheet\?\.type\)/, "the preview URL is released when the sheet closes");
  for (const handler of ["ranch-photo", "ranch-photo-send", "ranch-naming"]) assert.match(client, new RegExp(`case "${handler}":`), handler);
  assert.match(client, /case "ranch-name": \{/);
  assert.match(client, /await mutate\("set_ranch_name", \{ name \}/);
  assert.match(client, /"ranch-photo": \(\) => \{/);
  assert.match(service, /\n  "set_ranch_name",/);
  assert.match(service, /case "set_ranch_name": return setRanchNameAction\(uid, data\);/);
  assert.doesNotMatch(service.slice(service.indexOf("  async function setRanchNameAction("), service.indexOf("  async function setOwnWordsAction(")), /lastActiveAt/, "naming is not activity");
  for (const selector of [".tribute-ranch-tools {", ".tribute-ranch-name-form {", ".tribute-ranch-record dl {", ".tribute-tag.is-ranch b {"]) assert.ok(styles.includes(selector), selector);
});

test("cache keys and the design record", () => {
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-photo-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-photo-v1(?:-[a-z0-9-]+)?"/);
  assert.match(client, /import\("\.\/tribute-share\.mjs\?v=[^"]*-ranch-photo-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /### 16\.15 記念写真・飼育記録・牧場の名前/);
  assert.match(design, /`set_ranch_name`/);
  assert.match(design, /`fondnessAt`/);
});
