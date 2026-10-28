"use strict";

// 牧場: 管理人が動物を「なでる」と、小さな直し（ranch-pat-v1、設計書16.14）。2026-10-28 のユーザーの決定（おすすめのとおり）:
// 言葉を書かずに、ひと押しで「見ている」を伝える。財布の「牧場をのぞく」に、最後になでてもらった日が出る。
// あわせて、13頭目からの立ち位置・吹き出しの持ち回り・動きを減らす設定での見え方を直した。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { server } = require("./helpers/tribute-edge-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const client = read("tribute.js");
const service = read("functions/tribute-service.js");
const styles = read("tribute.css");
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

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), pattern);
    return true;
  });
}

test("the manager pats a grazing wallet's animal once a day; no points, no event, no Pay", async () => {
  const h = server.createHarness({ balances: { manager: 500, payer: 5_000 } });
  const publicManagerId = await server.openManager(h, "manager", { entryFee: 0 });
  const contractId = await server.startContract(h, "manager", "payer", publicManagerId, { allowGrazing: true }, 0);
  const act = (uid, action, data = {}) => { h.advance(2_100); return h.act(uid, action, { contractId, ...data }); };
  const profileKey = h.firestore.keys("tributeProfiles/").find((key) => key.endsWith("/manager"));
  const xpBefore = h.firestore.read(profileKey).ranchXp;
  const balances = { manager: h.balance("manager"), payer: h.balance("payer") };
  const eventsBefore = h.events(contractId).length;
  const patted = await act("manager", "ranch_pat");
  assert.ok(patted.contract.pattedAt > 0);
  assert.equal(h.contract(contractId).pattedAt, patted.contract.pattedAt);
  assert.equal(h.events(contractId).length, eventsBefore, "patting leaves no event in the thread");
  assert.equal(h.firestore.read(profileKey).ranchXp, xpBefore, "patting does not grow the ranch");
  assert.deepEqual({ manager: h.balance("manager"), payer: h.balance("payer") }, balances);
  const again = await act("manager", "ranch_pat");
  assert.equal(again.unchanged, true, "once a day");
  assert.equal(h.contract(contractId).pattedAt, patted.contract.pattedAt);
  h.advance(DAY);
  const tomorrow = await act("manager", "ranch_pat");
  assert.ok(tomorrow.contract.pattedAt > patted.contract.pattedAt, "again the next day");
  await rejects(act("payer", "ranch_pat"), /この操作はできません/);
  await act("payer", "set_grazing", { allowGrazing: false });
  h.advance(DAY);
  await rejects(act("manager", "ranch_pat"), /放牧されていません/);
  // 財布の画面（契約の見え方）にも、なでた時刻が出る。
  const core = await loadCore();
  assert.equal(core.viewContract(h.contract(contractId), "payer", h.now()).pattedAt, tomorrow.contract.pattedAt);
});

async function ranchRenderer() {
  const core = await loadCore();
  const context = vm.createContext({
    ...core,
    escapeHtml: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    previewScreen: "",
    window: { localStorage: { getItem: () => null, setItem: () => {} } },
    state: { uid: "u", contracts: [], ranch: { selected: "", diary: null, heart: null }, busy: "" },
  });
  vm.runInContext([
    /const RANCH_ASSET_KEY = [^\n]*\n/.exec(client)[0],
    /const RANCH_WANDER = [^\n]*\n/.exec(client)[0],
    ...["managerNickname", "ranchImage", "ranchName", "ranchHerd", "ranchPercent", "ranchDiaryLines", "renderRanchAnimal", "renderRanchWeather", "ranchBubbleStyle", "renderRanch", "renderRanchPeek"].map((name) => extract(client, name)),
  ].join("\n"), context);
  return { core, context };
}

function herdOf(core, now, count, extra = () => ({})) {
  return Array.from({ length: count }, (_, index) => core.viewContract({
    contractId: `${String(index).padStart(2, "0")}`.repeat(20), managerUid: "manager", payerUid: `payer-${index}`, status: "active",
    acceptedAt: now - DAY, expiresAt: now + 9 * DAY, payerWalletName: `財布${index + 1}`, allowGrazing: true, ranchAnimal: "cow",
    todayKey: core.jstDateKey(now), ...extra(index),
  }, "manager", now));
}

test("the manager's card has a pat button, then 'patted today'; animals away cannot be patted", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  const herd = herdOf(core, now, 3, (index) => (index === 1 ? { pattedAt: now - 60_000 } : index === 2 ? { workOrder: { orderSeq: 1, target: 3, note: "", issuedAt: now - 1000, reportedCount: 0, doneAt: 0 } } : {}));
  context.state.contracts = herd;
  context.state.ranch.selected = herd[0].contractId;
  assert.match(context.renderRanch(herd, { card: {}, ranch: { xp: 0 } }), /data-t="ranch-pat" data-contract="(00){20}" >なでる<\/button>/);
  context.state.ranch.selected = herd[1].contractId;
  assert.match(context.renderRanch(herd, { card: {}, ranch: { xp: 0 } }), /data-t="ranch-pat" data-contract="(01){20}" disabled>今日はなでました<\/button>/);
  context.state.ranch.selected = herd[2].contractId;
  const away = context.renderRanch(herd, { card: {}, ranch: { xp: 0 } });
  assert.match(away, /は出稼ぎに出ている。/);
  assert.doesNotMatch(away, /data-t="ranch-pat"/);
  // 押した直後だけ、その動物の上にハートが浮かぶ。
  context.state.ranch.selected = "";
  context.state.ranch.heart = { contractId: herd[0].contractId, at: now };
  const popped = context.renderRanch(herd, { card: {}, ranch: { xp: 0 } });
  assert.equal((popped.match(/class="tribute-ranch-heart"/g) || []).length, 1);
  context.state.ranch.heart = { contractId: herd[0].contractId, at: now - 10_000 };
  assert.doesNotMatch(context.renderRanch(herd, { card: {}, ranch: { xp: 0 } }), /tribute-ranch-heart/);
});

test("the wallet's peek shows when it was last patted", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  const raw = {
    contractId: "1".repeat(40), managerUid: "manager", payerUid: "u", status: "active", acceptedAt: now - 9 * DAY, expiresAt: now + 9 * DAY,
    managerCard: { personaName: "ミオ様" }, payerWalletName: "ポチ財布", allowGrazing: true, ranchAnimal: "rabbit", todayKey: core.jstDateKey(now),
  };
  const today = context.renderRanchPeek(core.viewContract({ ...raw, pattedAt: now - 60_000 }, "u", now), { status: "ready", level: 3 });
  assert.match(today, /今日、ミオ様になでてもらった。/);
  assert.match(today, /class="tribute-ranch-heart is-today"/);
  const earlier = now - 3 * DAY;
  const label = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(earlier));
  const before = context.renderRanchPeek(core.viewContract({ ...raw, pattedAt: earlier }, "u", now), { status: "ready", level: 3 });
  assert.ok(before.includes(`ミオ様に最後になでてもらった日：${label}`), label);
  assert.doesNotMatch(before, /tribute-ranch-heart/);
  const never = context.renderRanchPeek(core.viewContract(raw, "u", now), { status: "ready", level: 3 });
  assert.doesNotMatch(never, /なでてもらった/);
  assert.match(never, /管理人が牧場であなたの動物をなでると、ここに出ます。/);
});

test("more than twelve animals stand next to the twelve spots, smaller, and never on the same point", async () => {
  const { core, context } = await ranchRenderer();
  assert.deepEqual(core.RANCH_LAYOUT.spots.map((_, index) => core.ranchSpot(index)), core.RANCH_LAYOUT.spots.map((spot) => [...spot]));
  const points = Array.from({ length: 60 }, (_, index) => core.ranchSpot(index).map((value) => value.toFixed(4)).join(","));
  assert.equal(new Set(points).size, 60, "60 animals, 60 places");
  for (let index = 0; index < 60; index += 1) {
    const [x, y] = core.ranchSpot(index);
    assert.ok(x > 0.2 && x < 0.8 && y > 0.4 && y < 0.82, `${index}: ${x},${y} stays on the island`);
  }
  const now = Date.now();
  const twelve = herdOf(core, now, 12);
  context.state.contracts = twelve;
  assert.doesNotMatch(context.renderRanch(twelve, { card: {}, ranch: { xp: 0 } }), /is-crowded/);
  const twenty = herdOf(core, now, 20);
  context.state.contracts = twenty;
  const html = context.renderRanch(twenty, { card: {}, ranch: { xp: 0 } });
  assert.match(html, /class="tribute-ranch-scene is-crowded"/);
  assert.equal(new Set([...html.matchAll(/--x1:([\d.]+)%;--y1:([\d.]+)%/g)].map((match) => `${match[1]},${match[2]}`)).size, 20);
  assert.match(styles, /\.tribute-ranch-scene\.is-crowded \.tribute-ranch-animal \{ width: 14%; \}/);
});

test("speech bubbles take turns: one animal at a time, whatever the herd size", async () => {
  const { core, context } = await ranchRenderer();
  const now = Date.now();
  for (const count of [1, 3, 4, 7, 12, 20]) {
    const herd = herdOf(core, now, count);
    context.state.contracts = herd;
    const html = context.renderRanch(herd, { card: {}, ranch: { xp: 0 } });
    const slots = Math.max(3, count);
    assert.match(html, new RegExp(`style="--cycle:${slots * 6}s;--bubble:ranch-bubble-${slots}"`), String(count));
    const frames = new RegExp(`@keyframes ranch-bubble-${slots} \\{ 0% \\{ opacity: 0; \\} ([\\d.]+)%, ([\\d.]+)% \\{ opacity: 1; \\} ([\\d.]+)%, 100% \\{ opacity: 0; \\} \\}`).exec(html);
    assert.ok(frames, String(count));
    const shownUntil = (Number(frames[3]) / 100) * slots * 6;
    assert.ok(shownUntil <= 5.01 && shownUntil >= 4.9, `${count}: gone after ${shownUntil}s, before the next animal's turn at 6s`);
    const delays = [...html.matchAll(/--bubble-delay:(\d+)s/g)].map((match) => Number(match[1]));
    assert.deepEqual(delays, Array.from({ length: count }, (_, index) => index * 6));
  }
  assert.match(styles, /animation: var\(--bubble, ranch-bubble\) var\(--cycle, 18s\) linear var\(--bubble-delay, 0s\) infinite;/);
});

test("with reduced motion the peek still shows its one bubble and the pat mark", () => {
  const reduced = styles.slice(styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.tribute-ranch-peek \.tribute-ranch-bubble \{ opacity: 1; \}/);
  assert.match(reduced, /\.tribute-ranch-heart \{ animation: none; opacity: 1; \}/);
  // 管理人の画面では、押した動物の吹き出しが止まって出る（前から）。
  assert.match(styles, /\.tribute-ranch-animal\.is-selected \.tribute-ranch-bubble \{ animation: none; opacity: 1; \}/);
});

test("client wiring, preview, cache keys and the design record", () => {
  assert.match(service, /\n  "ranch_pat",/);
  assert.match(service, /\n    ranch_pat: \{\n      roles: \["manager"\],\n      statuses: \["active"\],/);
  assert.doesNotMatch(service.slice(service.indexOf("    ranch_pat: {"), service.indexOf("    set_moo: {")), /grantRanchXp|pushEvent|markManagerActive/, "no points, no event, no board refresh");
  assert.match(client, /await mutate\("ranch_pat", \{ contractId \}/);
  assert.match(client, /case "ranch-pat": \{/);
  assert.match(client, /case "ranch_pat": \{/);
  assert.match(client, /"ranch-crowd": \(\) => navigate\("hub"\),/);
  const index = read("index.html");
  for (const name of ["tribute.css", "tribute.js"]) assert.match(index, new RegExp(`${name.replace(".", "\\.")}\\?v=[^"]*-ranch-pat-v1(?:-[a-z0-9-]+)?"`), name);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=[^"]*-ranch-pat-v1(?:-[a-z0-9-]+)?"/);
  assert.match(design, /### 16\.14 なでる/);
  assert.match(design, /`ranch_pat`/);
  assert.match(design, /`pattedAt`/);
});
