"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const rules = require("../tribute-rules");
const { viewContract: serverView } = require("../tribute-service");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const app = read("app.js");
const client = read("tribute.js");
const styles = read("tribute.css");
const market = read("market.js");
const indexSource = read("functions/index.js");
const firestoreRules = read("firestore.rules");
const indexes = JSON.parse(read("firestore.indexes.json"));
const design = read("TRIBUTE_DESIGN.md");
const loadCore = () => import(pathToFileURL(path.join(root, "tribute-core.mjs")).href);

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("the landing replaces the market tile with お貢ぎ界隈 and keeps old market records read-only", () => {
  assert.match(html, /tribute\.css\?v=tribute-v1"/);
  assert.match(html, /tribute\.js\?v=global-player-block-v1-copy-v2-tribute-v1"/);
  assert.match(app, /id="tributeButton"[^>]*><small>会わない前提で、AnjuPayを差し出す<\/small><span>お貢ぎ界隈<\/span>/);
  assert.doesNotMatch(app, /id="valueMarketButton"/);
  assert.match(app, /id="tributeRankingButton"/);
  assert.match(app, /function startTribute\(options = \{\}\)[\s\S]*?hariai-tribute-ready/);
  assert.match(app, /HariaiTribute\?\.isActive\?\.\(\)\) \{\s*window\.HariaiTribute\.requestHome\(\);/);
  assert.match(app, /openTribute: startTribute/);
  assert.match(market, /const VALUE_MARKET_CLOSED = true;/);
  assert.match(sourceBlock(market, "async function joinQueue", "if (!state.authReady"), /if \(VALUE_MARKET_CLOSED\) \{\s*showToast\(VALUE_MARKET_CLOSED_MESSAGE\);\s*return;/);
  assert.match(market, /推し値市場は2026年10月で終了しました/);
});

test("every mode refuses to open over お貢ぎ界隈 and お貢ぎ界隈 refuses to open over them", () => {
  for (const file of ["account.js", "ai-text-training.js", "danwaku-note.js", "flea-market.js", "free-table.js", "market.js", "online.js", "roulette-training.js", "strategy.js"]) {
    assert.match(read(file), /window\.HariaiTribute\?\.isActive\?\.\(\)/, file);
  }
  const guard = sourceBlock(client, "function modeIsActiveElsewhere", "function subscribeWallet");
  for (const name of ["HariaiOnline", "HariaiStrategy", "HariaiAiTextTraining", "HariaiRouletteTraining", "HariaiDanwakuNote", "HariaiFreeTable", "HariaiMarket", "HariaiFleaMarket", "HariaiAccount"]) {
    assert.match(guard, new RegExp(`window\\.${name}\\?\\.isActive`), name);
  }
  assert.match(client, /window\.HariaiTribute = Object\.freeze\(\{\s*start,\s*isActive,\s*requestHome,\s*\}\);/);
});

test("the client keeps caps and exit with the payer and never filters by gender", () => {
  assert.match(client, /data-form="age"[\s\S]*?18歳以上です/);
  assert.match(client, /ネカマ開示のみ/);
  assert.match(client, /性別で絞る機能はありません/);
  assert.doesNotMatch(client, /女性のみ|female|gender/i);
  const head = sourceBlock(client, "function renderThreadHead", "function renderThreadActions");
  assert.match(head, /view\.role === "payer"[\s\S]*?data-sheet="end">解約<\/button>/, "解約 is always in the thread header for an active payer");
  const sheet = sourceBlock(client, "function renderSheet", "function renderReceiptOverlay");
  assert.match(sheet, /いつでも、すぐに終われます。罰も記録上の不利もありません。/);
  assert.match(sheet, /解約すれば、いつでも全額すぐ戻ります。/);
  assert.match(sheet, /下げる変更はすぐ効きます。上げる変更は日本時間の翌日0時から効き/);
  const actions = sourceBlock(client, "function renderThreadActions", "function renderTemplates");
  const managerStart = actions.indexOf('data-sheet="request"');
  assert.notEqual(managerStart, -1);
  assert.match(actions.slice(0, managerStart), /data-sheet="caps"/, "the payer has the caps control");
  assert.doesNotMatch(actions.slice(managerStart), /data-sheet="caps"|data-t="terminate"/, "the manager has no caps or terminate control");
  assert.match(client, /data-tribute-hold/);
  assert.match(client, /const HOLD_MS = 1_200;/);
  assert.match(client, /renderBlockButton\(\{ mode: "tribute", contractId: view\.contractId \}/);
  assert.match(client, /PREVIEW_HOSTS = new Set\(\["localhost", "127\.0\.0\.1", "\[::1\]"\]\)/);
  assert.match(styles, /\.tribute-hold\.is-holding \.tribute-hold-fill/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("client filters and contract views mirror the server", async () => {
  const core = await loadCore();
  const corpus = [
    "LINE IDおしえて", "ライン交換しよ", "ﾗｲﾝ交換", "ディスコード", "@mio_sama", "https://x.example", "mio@example.com",
    "090-1234-5678", "PayPayで", "ＰａｙＰａｙ", "アマギフ", "現金", "500円", "５００円", "会おうよ", "オフ会", "住所", "晒すぞ",
    "オンラインで", "出会ってくれて", "deadline", "雑魚財布、もっと出せ", "まだ？", "今日の分、100 Pay",
  ];
  for (const text of corpus) assert.equal(core.forbiddenReason(text), rules.forbiddenReason(text), text);
  assert.deepEqual(core.FORBIDDEN_MESSAGES, rules.FORBIDDEN_MESSAGES);
  assert.deepEqual([...core.PER_TRIBUTE_OPTIONS], [...rules.PER_TRIBUTE_OPTIONS]);
  assert.deepEqual([...core.PER_DAY_OPTIONS], [...rules.PER_DAY_OPTIONS]);
  assert.deepEqual([...core.TOTAL_OPTIONS], [...rules.TOTAL_OPTIONS]);
  assert.deepEqual([...core.ENTRY_FEE_OPTIONS], [...rules.ENTRY_FEE_OPTIONS]);
  assert.equal(core.TRIBUTE_AGE_VERSION, rules.TRIBUTE_AGE_VERSION);
  for (const amount of [1, 10, 99, 100, 101, 1_000]) assert.equal(core.tributeFee(amount), rules.tributeFee(amount));

  const now = Date.parse("2026-10-05T23:30:00+09:00");
  const contract = {
    contractId: "a".repeat(40),
    managerUid: "m",
    payerUid: "p",
    status: "active",
    managerCard: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", sigil: 2 },
    payerWalletName: "ポチ財布",
    entryFee: 10,
    caps: { perTribute: 100, perDay: 300, total: 1_000 },
    pendingCaps: { perTribute: 300, perDay: 300, total: 1_000 },
    pendingCapsEffectiveDateKey: "2026-10-06",
    durationDays: 3,
    tone: "harsh",
    ngWords: ["ブス"],
    allowReportRequests: true,
    rankOptIn: true,
    createdAt: now - 1_000,
    acceptedAt: now - 900,
    expiresAt: now + 86_400_000,
    totalTributed: 210,
    tributeCount: 3,
    todayKey: "2026-10-05",
    todayTributed: 110,
    escrowBalance: 200,
    escrowWithdrawRequest: { amount: 50, requestedAt: now - 10 },
    pendingRequests: { abcdef0123456789: { amount: 100, note: "今日の分", createdAt: now - 5 } },
    reportRequestedAt: now - 1,
    eventSeq: 9,
    readSeq: { manager: 4, payer: 9 },
    updatedAt: now,
  };
  for (const uid of ["m", "p"]) {
    for (const at of [now, Date.parse("2026-10-06T00:00:01+09:00")]) {
      const expected = serverView(contract, uid, at);
      const actual = core.viewContract(contract, uid, at);
      for (const key of Object.keys(expected)) {
        assert.deepEqual(actual[key], expected[key], `${uid} ${at} ${key}`);
      }
    }
  }
});

test("templates are harsh but never cross the stated lines, and lowering or leaving is never blamed", async () => {
  const core = await loadCore();
  const banned = /死|殺|自殺|消えろ|首吊|殴|刺す|晒|特定|ばら|上限を上げ|上げろ|逃げ|逃が|解約したら|やめたら|許さない|裏切/u;
  const blame = /責|せい|残念|がっかり|最低|情けない|惨め|根性/u;
  let harshCount = 0;
  for (const role of ["manager", "payer"]) {
    for (const tone of ["sweet", "normal", "harsh"]) {
      for (const [situation, lines] of Object.entries(core.TEMPLATES[role][tone])) {
        for (const line of lines) {
          assert.equal(rules.forbiddenReason(line), "", `${role}/${tone}/${situation}: ${line}`);
          assert.doesNotMatch(line, banned, `${role}/${tone}/${situation}: ${line}`);
          if (["caps_lowered", "ended", "safety"].includes(situation)) {
            assert.doesNotMatch(line, blame, `${role}/${tone}/${situation} must not blame: ${line}`);
          }
          if (role === "manager" && tone === "harsh") harshCount += 1;
        }
      }
    }
  }
  assert.ok(harshCount >= 25, "harsh manager templates are plentiful");
  assert.ok(core.TEMPLATES.manager.harsh.nudge.some((line) => /財布/.test(line)));
  const nekamaHidden = core.templatesFor("manager", "harsh", { disclosure: "as_is" });
  assert.equal(nekamaHidden.some((group) => group.id === "nekama"), false, "nekama lines only appear for a nekama card");
  const filtered = core.templatesFor("manager", "harsh", { disclosure: "nekama", ngWords: ["財布"] });
  assert.equal(filtered.flatMap((group) => group.lines).some((line) => line.includes("財布")), false, "NG words remove templates");
  for (const tone of ["sweet", "normal", "harsh"]) {
    assert.ok(core.TEMPLATES.payer[tone].safety.includes("今日はここまで。"));
  }
});

test("server wiring: App Check callable, 15-minute expiry, block cleanup, closed market and patron program", () => {
  assert.match(indexSource, /exports\.tributeAction = onCall\(callableOptions\("tributeAction"\)/);
  assert.match(indexSource, /const TRIBUTE_GOOGLE_ACTIONS = new Set\(\["fund", "offer"\]\);/);
  assert.match(indexSource, /exports\.expireTributeContracts = onSchedule\(\{\s*schedule: "every 15 minutes"/);
  assert.match(indexSource, /tributeService\.endContractsBetween\(context\.firstUid, context\.secondUid\)/);
  assert.match(indexSource, /resolveTributeTarget: \(uid, data\) => tributeService\.resolveSafetyTarget\(uid, data\)/);
  assert.match(indexSource, /if \(action === "join"\) \{\s*throw new HttpsError\("failed-precondition", VALUE_MARKET_CLOSED_MESSAGE\);/);
  assert.match(indexSource, /\["patron_upgrade", "oshijo_patron_upgrade", "patron_policy_vote"\]\.includes\(action\)/);
  assert.match(read("functions/player-safety-context.js"), /if \(mode === "tribute"\)/);
});

test("rules let only contract participants read threads and keep every other tribute collection server-only", () => {
  const block = sourceBlock(firestoreRules, "match /tributeContracts/{contractId}", "match /tributeProfiles/{uid}");
  assert.match(block, /allow read: if request\.auth != null\s*&& request\.auth\.uid in resource\.data\.participants;/);
  assert.match(block, /match \/events\/\{eventId\}[\s\S]*?request\.auth\.uid in get\(\/databases\/\$\(database\)\/documents\/tributeContracts\/\$\(contractId\)\)\.data\.participants;/);
  assert.equal((block.match(/allow write: if false;/g) || []).length, 2);
  for (const collection of ["tributeProfiles", "tributeReceipts", "tributePairs", "tributeManagerMonths", "tributeFund", "tributeHonors", "tributeReports"]) {
    assert.match(firestoreRules, new RegExp(`match /${collection}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`), collection);
  }
  const groups = indexes.indexes.filter((entry) => entry.collectionGroup.startsWith("tribute")).map((entry) => `${entry.collectionGroup}:${entry.fields.map((field) => field.fieldPath).join(",")}`);
  for (const expected of [
    "tributeContracts:participants,updatedAt",
    "tributeContracts:status,expiresAt",
    "tributeProfiles:accepting,lastActiveAt",
    "tributeProfiles:recommendedMonthKey,recommendedCount",
    "tributePairs:managerUid,rankOptIn,monthKey,monthTotal",
    "tributePairs:managerUid,rankOptIn,total",
    "tributePairs:payerUid,lastAt",
    "tributePairs:managerUid,lastAt",
    "tributeManagerMonths:monthKey,payers,rankScore",
  ]) {
    assert.ok(groups.includes(expected), expected);
  }
});

test("the design note keeps the definition and is not published", () => {
  assert.match(design, /お貢ぎは、会わない前提で、金や残高の支配を権力交換の中心に置く遊びである。/);
  assert.match(design, /この機能は、上限と離脱を払う側（預ける側）が保持しているか/);
  assert.match(read("firebase.json"), /"TRIBUTE_DESIGN\.md"/);
  assert.match(read(".assetsignore"), /^TRIBUTE_DESIGN\.md$/m);
});
