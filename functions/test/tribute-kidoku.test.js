"use strict";

// お貢ぎ牧場：既読無視・管理人の宣言・見えない限度額・断れない請求・高額請求（1回10,000まで）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const { viewContract: serverView } = require("../tribute-service");
const { migrateTributeLimits } = require("../scripts/migrate-tribute-limits.cjs");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("tribute.js");
const share = read("tribute-share.mjs");
const styles = read("tribute.css");
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the browser mirrors the new limits, numbers and views of the server", async () => {
  const core = await loadCore();
  assert.deepEqual([...core.PER_TRIBUTE_OPTIONS], [...rules.PER_TRIBUTE_OPTIONS]);
  assert.deepEqual([...core.PER_DAY_OPTIONS], [...rules.PER_DAY_OPTIONS]);
  assert.deepEqual([...core.TOTAL_OPTIONS], [...rules.TOTAL_OPTIONS]);
  assert.equal(rules.PER_TRIBUTE_OPTIONS.at(-1), 10_000);
  assert.equal(rules.PER_DAY_OPTIONS.at(-1), 30_000);
  assert.equal(rules.TOTAL_OPTIONS.at(-1), 100_000);
  assert.equal(core.LIMITS.payerOpenContracts, rules.LIMITS.payerOpenContracts);
  assert.equal(rules.LIMITS.payerOpenContracts, 5);
  assert.equal(rules.LIMITS.managerActiveContracts, 50);
  assert.equal(rules.LIMITS.managerDailyReceive, 100_000);
  assert.equal(core.LIMITS.requestMax, rules.LIMITS.requestMax);
  assert.equal(rules.LIMITS.requestMax, 10_000);
  assert.equal(core.LIMITS.googleCapThreshold, rules.LIMITS.googleCapThreshold);
  assert.equal(rules.LIMITS.highRequest, 3_000);

  const now = Date.parse("2026-10-10T12:00:00+09:00");
  const contract = {
    contractId: "a".repeat(40), managerUid: "m", payerUid: "p", status: "active", eventSeq: 9,
    caps: { perTribute: 100, perDay: 300, total: 1_000 }, pendingCaps: { perTribute: 300, perDay: 300, total: 1_000 },
    pendingCapsEffectiveDateKey: "2026-10-11", ignoredSince: now - 3_600_000, managerIgnoreUnpaid: true,
    readSeq: { manager: 9, payer: 9 },
  };
  for (const uid of ["m", "p"]) assert.deepEqual(core.viewContract(contract, uid, now), serverView(contract, uid, now), uid);
  const manager = core.viewContract(contract, "m", now);
  assert.deepEqual({ caps: manager.caps, pendingCaps: manager.pendingCaps, allowance: manager.allowance, escrowRoom: manager.escrowRoom }, { caps: null, pendingCaps: null, allowance: 0, escrowRoom: 0 });
  const payer = core.viewContract(contract, "p", now);
  assert.deepEqual(payer.caps, contract.caps);
  assert.equal(payer.ignoredSince, now - 3_600_000);
  assert.equal(payer.managerIgnoreUnpaid, true);

  assert.equal(core.ignoreLabel(0, now), "");
  assert.equal(core.ignoreLabel(now - 30 * 60_000, now), "既読無視 1時間");
  assert.equal(core.ignoreLabel(now - 5 * 3_600_000, now), "既読無視 5時間");
  assert.equal(core.ignoreLabel(now - 50 * 3_600_000, now), "既読無視 3日目");

  // 前提: 限度額は管理人に見えず、請求は断れない。「財布が握る」とは言わない。
  assert.ok(core.PREMISES.some((line) => /管理する側には見えません/.test(line)));
  assert.ok(core.PREMISES.some((line) => /請求は断れません。払うか、解約するかです。/.test(line)));
  assert.ok(core.PREMISES.every((line) => !/握って/.test(line)));
  assert.ok(!core.MANAGER_SITUATIONS.some((situation) => situation.id === "caps_lowered"), "managers no longer learn about lowered limits");
});

test("payers see 既読 on their messages and 既読無視 only while a request is unpaid; there is no decline", () => {
  const event = sourceBlock(client, "function renderEvent", "function renderThreadHead");
  assert.match(event, /mine && view\.role === "payer" && view\.peerReadSeq >= Number\(event\.seq\) \? '<span class="tribute-read">既読<\/span>'/);
  assert.doesNotMatch(client, /data-t="decline-request"|case "decline-request"/, "the decline button and its handler are gone");
  assert.match(event, /case "caps_lowered":\s*case "caps_raise_scheduled":\s*case "caps_raised":\s*case "caps_raise_cancelled":\s*return "";/);
  assert.doesNotMatch(sourceBlock(event, 'case "applied":', 'case "accepted"'), /capsText/, "the application event never shows limits");

  const state = sourceBlock(client, "function renderIgnoreState", "// 管理人の宣言と「高額請求」の札");
  assert.match(state, /const label = owed && view\.ignoredSince \? ignoreLabel\(view\.ignoredSince\) : "";/);
  assert.match(state, /data-t="toggle-declaration"/);
  assert.match(client, /await mutate\("set_declaration", \{ ignoreUnpaid: target\.checked \}/);

  const request = sourceBlock(client, "function renderPayableRequest", "function renderThreadActions");
  assert.match(request, /払うか、解約するか。請求を断ることはできません。/);
  assert.match(request, /<b>限度額が足りません。<\/b>/);
  assert.match(request, /限度額を上げると、日本時間の翌日0時から効きます。/);
  for (const mode of ["missions", "ai", "roulette"]) assert.match(request, new RegExp(`data-t="earn" data-mode="${mode}"`));
  assert.match(request, /data-t="give-request"[^]*?\$\{payable \? "" : "disabled"\}/);

  // 管理人の請求は10,000まで、財布の残り枠には関係しない。徴収も限度額を見せない。
  const sheets = sourceBlock(client, 'case "request": {\n      // 請求は財布の限度額に関係なく', 'case "escrow":');
  assert.match(sheets, /const maximum = LIMITS\.requestMax;/);
  assert.doesNotMatch(sheets, /view\.allowance|view\.caps/);
  assert.match(sheets, /財布の限度額は見えません。/);
  const actions = sourceBlock(client, "function renderThreadActions", "function renderThread()");
  assert.match(actions, /data-sheet="request" \$\{view\.pendingRequests\.length < LIMITS\.pendingRequests \? "" : "disabled"\}/);
  assert.match(actions, /data-sheet="take" \$\{view\.escrowBalance \? "" : "disabled"\}/);
});

test("limits live in a payer-only document that the payer's thread subscribes to, and the wording never says the wallet holds the power", () => {
  assert.match(client, /onSnapshot\(doc\(firestore, "tributeContracts", contractId, "private", "limits"\)/);
  assert.match(client, /if \(state\.thread\.raw\?\.payerUid === uid && !limitsUnsubscribe\)/, "only the payer reads the limits");
  assert.match(sourceBlock(client, "function stopThread", "function openThread"), /limitsUnsubscribe\?\.\(\);/);
  assert.match(client, /あなたの限度額（\$\{escapeHtml\(view\.manager\.personaName\)\}には見えません）/);
  for (const source of [client, share]) {
    assert.doesNotMatch(source, /上限と解約は|財布が握る|あなたが握ります/);
  }
  // 申し込みでは「請求は断れない」を確かめる（サーバーも同じ確認を求める）。
  assert.match(client, /<input type="checkbox" name="acceptNoDecline" required \/>/);
  assert.match(client, /acceptNoDecline: data\.get\("acceptNoDecline"\) === "on",/);
  assert.match(client, /<input type="checkbox" name="ignoreUnpaid"/);
  assert.match(sourceBlock(client, "function declarationTags", "// 経った時間"), /未払いは既読無視[^]*高額請求/);
  // 財布募集の画像: 宣言と「高額請求」で札が増えても、型と称号を落とさず2段目に並べ、紹介を1行減らしてカードに収める。
  const recruit = sourceBlock(share, "export async function renderRecruitImage", "// 今日のひとこと");
  assert.match(recruit, /if \(tagRows === 2 \|\| nameX \+ width > right\) return;/);
  assert.match(share, /wrapLines\(ctx, intro, innerWidth, tagRows === 2 \? 2 : 3\)/);
  assert.match(client, /1回の限度額を\$\{escapeHtml\(formatPay\(LIMITS\.googleCapThreshold\)\)\}以上にできるのは/);
  for (const name of [".tribute-oath", ".tribute-high", ".tribute-ignored", ".tribute-limits", ".tribute-read", ".tribute-declaration-toggle", ".tribute-limit-warn", ".tribute-earn"]) {
    assert.ok(styles.includes(`${name} `) || styles.includes(`${name},`), name);
  }
  assert.match(design, /既読無視/);
  assert.match(design, /限度額/);
  assert.match(design, /請求は断れない/);
});

// ───────── 移し替えのスクリプト（読み取りのみが既定） ─────────

function fakeFirestore(seed) {
  const docs = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
  const writes = [];
  const snapshotOf = (refPath) => {
    const value = docs.get(refPath);
    return { id: refPath.split("/").at(-1), ref: docRef(refPath), exists: value !== undefined, data: () => structuredClone(value), get: (field) => value?.[field] };
  };
  function docRef(refPath) {
    return {
      path: refPath,
      collection: (name) => collectionRef(`${refPath}/${name}`),
      async get() { return snapshotOf(refPath); },
      async set(value, options = {}) { writes.push(refPath); docs.set(refPath, { ...(options.merge ? docs.get(refPath) || {} : {}), ...structuredClone(value) }); },
      async update(value) {
        writes.push(refPath);
        const next = { ...docs.get(refPath) };
        for (const [key, entry] of Object.entries(value)) {
          if (entry === "__delete__") delete next[key];
          else next[key] = entry;
        }
        docs.set(refPath, next);
      },
    };
  }
  function collectionRef(collectionPath, filter = null) {
    return {
      doc: (id) => docRef(`${collectionPath}/${id}`),
      where: (field, operator, values) => {
        assert.equal(operator, "in");
        return collectionRef(collectionPath, { field, values });
      },
      async get() {
        const prefix = `${collectionPath}/`;
        const matches = [...docs.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
          .filter((key) => !filter || filter.values.includes(docs.get(key)?.[filter.field]))
          .map(snapshotOf);
        return { size: matches.length, docs: matches };
      },
    };
  }
  return {
    docs,
    writes,
    collection: collectionRef,
    async runTransaction(work) {
      const pending = [];
      const transaction = {
        get: (reference) => reference.get(),
        set: (reference, value, options) => pending.push(() => reference.set(value, options)),
      };
      const result = await work(transaction);
      for (const write of pending) await write();
      return result;
    },
  };
}

test("the migration counts by default, and with --apply moves old limits and scrubs them from shared events", async () => {
  const id = "c".repeat(40);
  const seed = {
    [`tributeContracts/${id}`]: { contractId: id, payerUid: "p", managerUid: "m", caps: { perTribute: 100, perDay: 300, total: 1_000 }, pendingCaps: null, pendingCapsEffectiveDateKey: "" },
    [`tributeContracts/${id}/events/0001`]: { seq: 1, type: "applied", caps: { perTribute: 100, perDay: 300, total: 1_000 }, durationDays: 3 },
    [`tributeContracts/${id}/events/0002`]: { seq: 2, type: "caps_raise_scheduled", caps: { perTribute: 300, perDay: 300, total: 1_000 }, effectiveDateKey: "2026-10-11" },
    [`tributeContracts/${id}/events/0003`]: { seq: 3, type: "message", text: "1回100までしか払えない" },
    [`tributeContracts/${"d".repeat(40)}`]: { contractId: "d".repeat(40), payerUid: "q", managerUid: "m", caps: null },
  };
  const dry = fakeFirestore(seed);
  const counted = await migrateTributeLimits({ firestore: dry, deleteField: () => "__delete__", now: 5 });
  assert.deepEqual(counted, { apply: false, contracts: 2, legacyContracts: 1, moved: 0, limitsAlreadyPresent: 0, eventsWithLimits: 2, eventsScrubbed: 0 });
  assert.deepEqual(dry.writes, [], "counting never writes");

  const live = fakeFirestore(seed);
  const applied = await migrateTributeLimits({ firestore: live, deleteField: () => "__delete__", apply: true, now: 5 });
  assert.equal(applied.moved, 1);
  assert.equal(applied.eventsScrubbed, 2);
  assert.equal(live.docs.get(`tributeContracts/${id}`).caps, null);
  assert.deepEqual(live.docs.get(`tributeContracts/${id}/private/limits`), {
    caps: { perTribute: 100, perDay: 300, total: 1_000 }, pendingCaps: null, pendingCapsEffectiveDateKey: "", contractId: id, payerUid: "p", updatedAt: 5, migratedAt: 5,
  });
  assert.equal(live.docs.get(`tributeContracts/${id}/events/0001`).caps, undefined);
  assert.equal(live.docs.get(`tributeContracts/${id}/events/0001`).durationDays, 3);
  assert.equal(live.docs.get(`tributeContracts/${id}/events/0002`).effectiveDateKey, undefined);
  assert.equal(live.docs.get(`tributeContracts/${id}/events/0003`).text, "1回100までしか払えない", "messages are never touched");

  // 二度目は何も移さない。先にサーバーが移した限度額は上書きしない。
  const again = await migrateTributeLimits({ firestore: live, deleteField: () => "__delete__", apply: true, now: 9 });
  assert.equal(again.moved, 0);
  assert.equal(again.eventsScrubbed, 0);
  const raced = fakeFirestore({ ...seed, [`tributeContracts/${id}/private/limits`]: { caps: { perTribute: 50, perDay: 100, total: 300 } } });
  const kept = await migrateTributeLimits({ firestore: raced, deleteField: () => "__delete__", apply: true, now: 5 });
  assert.equal(kept.limitsAlreadyPresent, 1);
  assert.deepEqual(raced.docs.get(`tributeContracts/${id}/private/limits`).caps, { perTribute: 50, perDay: 100, total: 300 });
});
