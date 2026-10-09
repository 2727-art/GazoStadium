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

test("the landing replaces the market tile with お貢ぎ牧場 and keeps old market records read-only", () => {
  assert.match(html, /tribute\.css\?v=tribute-v1-tribute-ranch-v1-ranch-avatar-v1-ranch-gohoubi-v1-ranch-collar-v1-ranch-word-v1"/);
  assert.match(html, /tribute\.js\?v=global-player-block-v1-copy-v2-tribute-v1-tribute-ranch-v1-tribute-cost-guard-v1-retire-free-table-v1-ranch-avatar-v1-ranch-gohoubi-v1-ranch-collar-v1-ranch-word-v1"/);
  assert.match(client, /from "\.\/tribute-core\.mjs\?v=tribute-ranch-v1-ranch-avatar-v1-ranch-gohoubi-v1-ranch-collar-v1-ranch-word-v1"/);
  assert.match(client, /from "\.\/tribute-share\.mjs\?v=ranch-collar-v1"/);
  assert.doesNotMatch(`${html}${app}${client}${read("account.js")}${market}`, /お貢ぎ界隈|界隈基金|界隈の主/);
  assert.match(app, /id="tributeButton"[^>]*><small>会わない前提で、AnjuPayを差し出す<\/small><span>お貢ぎ牧場<\/span>/);
  assert.doesNotMatch(app, /id="valueMarketButton"/);
  assert.match(app, /id="tributeRankingButton"/);
  assert.match(app, /function startTribute\(options = \{\}\)[\s\S]*?hariai-tribute-ready/);
  assert.match(app, /HariaiTribute\?\.isActive\?\.\(\)\) \{\s*window\.HariaiTribute\.requestHome\(\);/);
  assert.match(app, /openTribute: startTribute/);
  assert.match(market, /const VALUE_MARKET_CLOSED = true;/);
  assert.match(sourceBlock(market, "async function joinQueue", "if (!state.authReady"), /if \(VALUE_MARKET_CLOSED\) \{\s*showToast\(VALUE_MARKET_CLOSED_MESSAGE\);\s*return;/);
  assert.match(market, /推し値市場は2026年10月で終了しました/);
});

test("every mode refuses to open over お貢ぎ牧場 and お貢ぎ牧場 refuses to open over them", () => {
  for (const file of ["account.js", "ai-text-training.js", "danwaku-note.js", "flea-market.js", "free-table.js", "market.js", "online.js", "roulette-training.js", "strategy.js"]) {
    assert.match(read(file), /window\.HariaiTribute\?\.isActive\?\.\(\)/, file);
  }
  const guard = sourceBlock(client, "function modeIsActiveElsewhere", "function subscribeWallet");
  for (const name of ["HariaiOnline", "HariaiStrategy", "HariaiAiTextTraining", "HariaiRouletteTraining", "HariaiDanwakuNote", "HariaiMarket", "HariaiFleaMarket", "HariaiAccount"]) {
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
    managerCard: { personaName: "ミオ様", disclosure: "nekama", style: "harsh", sigil: 2, avatar: 7 },
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
    allowSexualPurposes: true,
    collarNo: 3,
    purposeCounts: { edging: 3, management: 1, bogus: 4, release: 0 },
    rewardCount: 2,
    awaitingReceipt: 1,
    createdAt: now - 1_000,
    acceptedAt: now - 900,
    expiresAt: now + 86_400_000,
    totalTributed: 210,
    tributeCount: 3,
    todayKey: "2026-10-05",
    todayTributed: 110,
    escrowBalance: 200,
    escrowWithdrawRequest: { amount: 50, requestedAt: now - 10 },
    pendingRequests: { abcdef0123456789: { amount: 100, note: "今日の分", purpose: "release", createdAt: now - 5 } },
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
  assert.equal(core.viewContract(contract, "p", now).manager.avatar, 7);
  assert.deepEqual(core.viewContract(contract, "p", now).purposeCounts, { management: 1, edging: 3 });
  assert.equal(core.viewContract(contract, "p", now).pendingRequests[0].purpose, "release");
  const withdrawn = { ...contract, allowSexualPurposes: false };
  for (const uid of ["m", "p"]) {
    const expected = serverView(withdrawn, uid, now);
    const actual = core.viewContract(withdrawn, uid, now);
    for (const key of Object.keys(expected)) assert.deepEqual(actual[key], expected[key], `withdrawn ${uid} ${key}`);
  }
  assert.deepEqual(core.viewContract(withdrawn, "p", now).purposeCounts, { management: 1 }, "sexual counts hide once consent is withdrawn");
  assert.equal(core.viewContract(withdrawn, "p", now).pendingRequests[0].purpose, "");
  assert.equal(core.viewContract({ ...contract, status: "ended" }, "m", now).awaitingReceipt, 0);
  assert.equal(core.viewContract(contract, "p", now).collarNo, 3);
  assert.equal(core.viewContract(contract, "p", now).peerReadSeq, 4, "the payer sees how far the manager has read");
  assert.equal(core.viewContract(contract, "m", now).peerReadSeq, 9);
  for (const avatar of [undefined, 13, -2, "x"]) {
    const odd = { ...contract, managerCard: { ...contract.managerCard, avatar } };
    assert.equal(core.viewContract(odd, "p", now).manager.avatar, serverView(odd, "p", now).manager.avatar, String(avatar));
    assert.equal(core.viewContract(odd, "p", now).manager.avatar, 0, String(avatar));
  }
});

test("manager icons are twelve prepared WebP files chosen in the card editor, never uploads", async () => {
  const core = await loadCore();
  assert.deepEqual(core.AVATARS.map((avatar) => avatar.id), rules.AVATAR_IDS.filter((id) => id > 0));
  assert.equal(core.AVATAR_MAX, rules.AVATAR_MAX);
  assert.equal(new Set(core.AVATARS.map((avatar) => avatar.label)).size, core.AVATARS.length, "labels are distinct for screen readers");
  for (const { id } of core.AVATARS) {
    const name = `avatar-${String(id).padStart(2, "0")}.webp`;
    assert.ok(core.avatarUrl(id).endsWith(`/assets/tribute-avatars/${name}`), `avatar ${id}`);
    const file = fs.readFileSync(path.join(root, "assets", "tribute-avatars", name));
    assert.equal(file.subarray(0, 4).toString("latin1"), "RIFF", `avatar ${id}`);
    assert.equal(file.subarray(8, 12).toString("latin1"), "WEBP", `avatar ${id}`);
    assert.ok(file.length < 20_000, `avatar ${id} stays small`);
  }
  for (const value of [0, 13, -1, "1; background:url(x)", null]) {
    assert.equal(core.avatarId(value), 0, String(value));
    assert.equal(core.avatarUrl(value), "", String(value));
  }
  const ignored = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(!ignored.some((pattern) => pattern.startsWith("assets")), "the icons are public assets");
  assert.doesNotMatch(read(".assetsignore"), /^assets/m);

  const sigilSource = sourceBlock(client, "function sigil(card", "function disclosureTag");
  assert.match(sigilSource, /avatarId\(card\?\.avatar\)/);
  assert.match(sigilSource, /class="tribute-sigil has-avatar \$\{size\}"[^>]*aria-hidden="true"><img src="\$\{escapeHtml\(avatarUrl\(avatar\)\)\}" alt=""/);
  const editor = sourceBlock(client, "function renderCardEditor", "// ───────────── スレッド ─────────────");
  assert.match(editor, /<legend>印のアイコン<\/legend>/);
  assert.match(editor, /name="avatar" value="\$\{avatar\.id\}"/);
  assert.match(editor, /name="avatar" value="0"/, "the letter sigil stays available");
  assert.match(editor, /画像のアップロードはできません/);
  assert.doesNotMatch(editor, /type="file"/);
  assert.match(editor, /preview\.style\.setProperty\("--sigil"/);
  assert.doesNotMatch(editor, /form\.style\./, "form.style is the 管理の型 radio list, not CSS");
  assert.match(sourceBlock(client, 'case "card": {', 'case "apply": {'), /avatar: avatarId\(data\.get\("avatar"\)\),/);
  assert.match(client, /印は12種のアイコンか、ペルソナ名の1文字から選べます。/);
  assert.match(styles, /\.tribute-sigil\.has-avatar img \{/);
  assert.match(styles, /\.tribute-avatar-grid \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  assert.match(design, /管理人の印は、用意した12種のアイコン/);
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

test("the contract screen shows both ranch achievement lines and forwards unlocks to the shared collection", () => {
  const panel = sourceBlock(client, "function renderAchievementPanel", "function renderManagerCard");
  assert.match(client, /family: "tribute_manager", side: "管理する側", statKey: "managerPairDays"/);
  assert.match(client, /family: "tribute_wallet", side: "財布の側", statKey: "walletPairDays"/);
  assert.match(panel, /牧場の実績 <small>同じ相手とは日本時間の1日1回だけ数えます<\/small>/);
  assert.match(panel, /実績は自動では公開されず、展示するかは実績コレクションで選べます。/);
  assert.match(panel, /data-t="open-achievements"/);
  const notify = sourceBlock(client, "function notifyAchievementUnlocks", "async function refreshState");
  assert.match(notify, /byId\?\.get\?\.\(id\)\?\.scope === "tribute"/);
  assert.match(notify, /new CustomEvent\("hariai-achievements-unlocked"/);
  assert.match(notify, /action: "ack_achievements", achievementIds: ids/);
  assert.match(notify, /if \(previewScreen\) return;/);
  for (const marker of [
    /window\.HariaiAudio\?\.playReveal\?\.\(\);\s*notifyAchievementUnlocks\(result\.newlyUnlocked\);/,
    /closeSheet\(\);\s*notifyAchievementUnlocks\(result\.newlyUnlocked\);/,
    /notifyAchievementUnlocks\(result\.newlyUnlocked\);\s*if \(previewScreen\) updateThreadParts\(\);/,
    /notifyAchievementUnlocks\(payload\.achievements\.newlyUnlocked\);/,
  ]) assert.match(client, marker);
  assert.match(client, /case "open-achievements":\s*requestHome\(\);\s*window\.setTimeout\(\(\) => window\.HariaiOnline\?\.openAchievements\?\.\(\), 0\);/);
  assert.match(styles, /\.achievement-badge\.achievement-scope-tribute \{/);
  assert.match(read("achievements.js"), /\{ id: "tribute_ranch", label: "お貢ぎ牧場"/);
  assert.match(read("achievements.js"), /画像の好み・敗北・AnjuPayフリマ・お貢ぎ牧場の実績は自動公開されず/);
  assert.match(html, /achievements\.js\?v=[^"]*-tribute-ranch-v1(?:-[^"]+)?"/);
  assert.match(firestoreRules, /match \/tributeAchievementStats\/\{uid\} \{\s*allow read, write: if false;/);
});

test("the X profile link is optional, mirrors the server rule, and always asks before leaving the site", async () => {
  const core = await loadCore();
  for (const input of ["", "@mio_sama", "https://x.com/mio_sama", "x.com/mio_sama/", "https://twitter.com/mio_sama?s=21", "https://x.com/mio_sama/status/1", "https://x.com/home", "https://x.com.evil.example/a", "javascript:alert(1)", "ｍｉｏ＿ｓａｍａ"]) {
    assert.deepEqual(core.normalizeXProfile(input), rules.normalizeXProfile(input), input);
  }
  assert.match(core.X_EXTERNAL_CONFIRM_MESSAGE, /自己申告/);
  assert.match(core.X_EXTERNAL_CONFIRM_MESSAGE, /お貢ぎ牧場の上限・解約・通報の保護の外です/);
  assert.match(client, /<input name="xProfile" maxlength="80"[^>]*placeholder="https:\/\/x\.com\/ユーザー名 または @ユーザー名"/);
  assert.match(client, /スレッドでのSNSのID交換は、これまでどおりできません。/);
  assert.match(client, /const x = normalizeXProfile\(data\.get\("xProfile"\)\);\s*if \(x\.error\) return setFormError\(form, x\.error\);/);
  const open = sourceBlock(client, 'case "open-x": {', 'case "open-achievements":');
  assert.match(open, /!window\.confirm\(X_EXTERNAL_CONFIRM_MESSAGE\)/);
  assert.match(open, /window\.open\(`https:\/\/x\.com\/\$\{encodeURIComponent\(handle\)\}`, "_blank", "noopener,noreferrer"\)/);
  assert.match(open, /external\.opener = null/);
  assert.doesNotMatch(client, /<a [^>]*href="https:\/\/x\.com/, "no direct external anchor bypasses the confirmation");
  assert.match(client, /管理人の自己申告・本人未確認/);
  assert.match(styles, /\.tribute-x-link button \{/);
});

test("Firebase Hosting never uploads the local .claude folder or worktrees inside it", () => {
  const ignore = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(ignore.includes(".claude"), ".claude itself");
  assert.ok(ignore.includes(".claude/**"), "everything under .claude, including git worktrees");
});

test("named fees, receiving and rewards mirror the server and stay in the hands the design gives them", async () => {
  const core = await loadCore();
  assert.deepEqual(core.PURPOSES.map((purpose) => ({ ...purpose })), rules.PURPOSES.map((purpose) => ({ ...purpose })));
  assert.deepEqual(core.REWARDS.map((reward) => ({ ...reward, tones: [...reward.tones] })), rules.REWARDS.map((reward) => ({ ...reward, tones: [...reward.tones] })));
  assert.deepEqual([...core.RECEIVABLE_KINDS], [...rules.RECEIVABLE_KINDS]);
  for (const tone of ["sweet", "normal", "harsh", "x"]) {
    for (const ngWords of [[], ["ざこ"], ["ご褒美"]]) {
      assert.deepEqual(core.rewardsFor(tone, ngWords).map((reward) => reward.id), rules.rewardsFor(tone, ngWords).map((reward) => reward.id), `${tone} ${ngWords}`);
    }
  }
  for (const purpose of ["", "management", "edging", "release", "leak_penalty", "bogus"]) {
    for (const allowSexual of [true, false]) {
      assert.equal(core.visiblePurpose(purpose, { allowSexual }), rules.visiblePurpose(purpose, { allowSexual }), `${purpose} ${allowSexual}`);
    }
  }
  assert.equal(core.SEXUAL_PURPOSE_SUMMARY, "寸止め料・射精料・お漏らし罰金");

  const apply = sourceBlock(client, "function renderApply", "function renderCardEditor");
  assert.match(apply, /<input type="checkbox" name="allowSexualPurposes" \/>/, "consent starts unticked");
  assert.match(sourceBlock(client, 'case "apply": {', 'case "message": {'), /allowSexualPurposes: data\.get\("allowSexualPurposes"\) === "on",/);
  const sheet = sourceBlock(client, "function renderSheet", "function renderReceiptOverlay");
  assert.match(sheet, /case "purposes": \{\s*if \(view\.role !== "payer"\) return "";/, "only the payer decides on sexual names");
  assert.match(sheet, /purposeChoices\(\{ allowSexual: view\.allowSexualPurposes, role: "manager" \}\)/);
  const actions = sourceBlock(client, "function renderThreadActions", "function renderTemplates");
  const managerStart = actions.indexOf('data-sheet="request"');
  assert.match(actions.slice(0, managerStart), /data-sheet="purposes"/);
  assert.doesNotMatch(actions.slice(managerStart), /data-sheet="purposes"|set-purposes/);
  const choices = sourceBlock(client, "function purposeChoices", "function renderReceiveControls");
  assert.match(choices, /purposesFor\(\{ allowSexual \}\)/);
  const events = sourceBlock(client, "function renderEvent", "function renderThreadHead");
  assert.match(events, /receivable && view\.role === "manager" && view\.status === "active"\s*\? renderReceiveControls\(event, view\)/, "only the manager receives, only while active");
  assert.match(sourceBlock(client, "function renderReceiveControls", "function renderTally"), /rewardsFor\(view\.tone, view\.ngWords\)/);
  assert.match(events, /case "received": \{[\s\S]*?rewardLabel\(event\.reward\)/);
  const overlay = sourceBlock(client, "function renderReceiptOverlay", "function renderReceipts");
  assert.match(overlay, /献上完了/);
  assert.match(overlay, /非譲渡・換金不可 ・ AnjuPay only/);
  assert.doesNotMatch(`${overlay}${styles}`, /PayPay|paypay/i, "the completion screen is the ranch's own, not a real payment app's");
  assert.doesNotMatch(`${client}${styles}`, /tribute-wallet-anim/);
  assert.match(styles, /\.tribute-done-check circle/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.tribute-done-check path \{ animation: none; stroke-dashoffset: 0; \}/);
  assert.match(design, /性的な名目は、預ける側が契約で許した時だけ/);
  assert.match(design, /受け取りは「相手が確かに見た」という記録/);
});

test("seals, collar numbers, templates and note suggestions mirror the server and keep the stated lines", async () => {
  const core = await loadCore();
  assert.deepEqual(core.SEALS.map((seal) => ({ ...seal })), rules.SEALS.map((seal) => ({ ...seal })));
  assert.deepEqual([...core.DEFAULT_SEALS], [...rules.DEFAULT_SEALS]);
  for (const [seals, ngWords] of [[["zako", "yoku"], []], [["zako"], ["雑魚"]], [[], []], [["bogus"], []]]) {
    const offered = core.sealsFor(seals, ngWords);
    assert.ok(offered.includes(rules.sealFor(offered[0], { seals, ngWords })), `${seals} ${ngWords}`);
    for (const id of offered) assert.equal(rules.sealFor(id, { seals, ngWords }), id, `${id} is pressed as offered`);
  }
  const banned = /死|殺|自殺|消えろ|首吊|殴|刺す|晒|特定|ばら|上限を上げ|上げろ|逃げ|逃が|解約したら|やめたら|許さない|裏切/u;
  for (const [purpose, lines] of Object.entries(core.REQUEST_NOTES)) {
    assert.ok(purpose === "" || rules.PURPOSE_IDS.includes(purpose), purpose);
    for (const line of lines) {
      assert.equal(rules.forbiddenReason(line), "", line);
      assert.doesNotMatch(line, banned, line);
    }
  }
  const plain = core.templatesFor("manager", "harsh", { disclosure: "nekama" });
  assert.equal(plain.some((group) => group.id === "control"), false, "sexual lines need the payer's consent");
  assert.equal(plain.flatMap((group) => group.lines).some((line) => line.includes("{no}") || /\d+号/.test(line)), false, "numbered lines need a collar number");
  const numbered = core.templatesFor("manager", "harsh", { disclosure: "nekama", allowSexual: true, collarNo: 7 });
  assert.ok(numbered.some((group) => group.id === "control"));
  assert.ok(numbered.flatMap((group) => group.lines).includes("7号、待たせるな。"));
  assert.ok(core.TEMPLATES.manager.harsh.nudge.some((line) => /ATM/.test(line)));
  assert.ok(core.TEMPLATES.manager.harsh.after.some((line) => /養分/.test(line)));
  assert.ok(core.TEMPLATES.manager.harsh.nudge.some((line) => /お財布くん/.test(line)));
  assert.equal(core.templatesFor("payer", "harsh", {}).some((group) => group.id === "control"), false);

  const thread = sourceBlock(client, "function renderEvent", "function renderThreadHead");
  assert.match(thread, /const seen = !receivedAt && receivable && view\.role === "payer" && view\.peerReadSeq >= Number\(event\.seq\);/);
  assert.match(thread, /const save = view\.role === "payer"/, "only the payer can make report images");
  assert.match(thread, /あなたは\$\{escapeHtml\(managerName\)\}の財布 \$\{collarNo\}号です。/);
  assert.match(sourceBlock(client, "function renderReceiveControls", "function renderTally"), /sealsFor\(state\.profile\?\.card\?\.seals, view\.ngWords\)/);
  assert.match(sourceBlock(client, 'case "receive": {', 'case "share-open": {'), /contractPayload\(\{ tributeSeq: seq, reward, seal \}\)/);
  const card = sourceBlock(client, "function renderCardEditor", "function renderSealSettings");
  assert.match(card, /name="reportConsent" \$\{\(profile\.card \? card\.reportConsent === true : true\) \? "checked" : ""\}/, "existing cards are not opted in silently");
  assert.match(sourceBlock(client, 'case "card": {', 'case "apply": {'), /seals: data\.getAll\("seals"\)\.map\(String\)\.slice\(0, MAX_SEALS\),\s*reportConsent: data\.get\("reportConsent"\) === "on",/);
  assert.match(styles, /\.tribute-collar \{/);
  assert.match(styles, /\.tribute-share-preview \{/);
  assert.match(design, /首輪番号/);
  assert.match(design, /受取印/);
});

test("report images are made on the payer's device only, carry the non-cash notice, and never a URL", async () => {
  const share = read("tribute-share.mjs");
  assert.doesNotMatch(share, /https?:\/\/|x\.com|gazostadium|workers\.dev|web\.app/, "no URL is drawn into the images");
  assert.match(share, /ctx\.fillText\("AnjuPay", 64, y \+ 52\);/);
  assert.match(share, /・換金不可・アプリ内ポイント/);
  assert.match(share, /非譲渡・換金不可・アプリ内ポイント ／ AnjuPay only/);
  assert.match(share, /export const SHARE_TEXT = "#貢ぎ報告 #お貢ぎ牧場";/);
  assert.doesNotMatch(share, /fetch\(|XMLHttpRequest|firebase/i, "images are never uploaded");
  assert.doesNotMatch(share, /PayPay|paypay/i);
  assert.doesNotMatch(share, /\.decode\(\)/, "decode() can stall while the page is hidden");
  const sheet = sourceBlock(client, "function openShare", "function renderReceiptOverlay");
  assert.match(sheet, /call\("share_info"/);
  assert.match(sheet, /if \(!info\?\.consent \|\| !manager\.personaName\)/, "the manager's name and icon need their consent");
  assert.match(sheet, /options: \{ purpose: true, amount: true, marks: true, wallet: false \}/, "the wallet name is off by default");
  assert.match(sheet, /note: info\.consent \? String\(request\.note \|\| ""\) : ""/, "the manager's words need their consent");
  assert.doesNotMatch(sheet, /event\.type === "message"/, "chat messages never go into images");
  assert.match(sheet, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(sheet, /if \(error\?\.name === "AbortError"\) return;/);

  const core = await loadCore();
  globalThis.document = globalThis.document || {};
  const module = await import(pathToFileURL(path.join(root, "tribute-share.mjs")).href);
  const svg = module.sealSvg({ label: "<b>", name: "a&b", at: Date.parse("2026-10-09T23:41:00+09:00"), size: 52, rough: false });
  assert.match(svg, /&lt;b&gt;/);
  assert.match(svg, /a&amp;b/);
  assert.match(svg, /26\.10\.09/);
  assert.doesNotMatch(svg, /feTurbulence/);
  assert.match(module.sealSvg({ label: core.sealLabel("yoku"), name: "ミオ様", at: 0 }), /feTurbulence/);
  const ignored = JSON.parse(read("firebase.json")).hosting.ignore;
  assert.ok(!ignored.includes("tribute-share.mjs"));
  assert.doesNotMatch(read(".assetsignore"), /^tribute-share\.mjs$/m);
});

test("today's word mirrors the server check, sits only in the manager's own hub, and shows as a bubble on the board", async () => {
  const core = await loadCore();
  assert.deepEqual({ ...core.TODAY_WORD }, { length: rules.LIMITS.todayWord, ttlMs: rules.LIMITS.todayWordTtlMs, perDay: rules.LIMITS.todayWordsPerDay });
  assert.equal(core.BOARD_SEXUAL_MESSAGE, rules.BOARD_SEXUAL_MESSAGE);
  const corpus = ["今夜は機嫌がいい", "イケメン好き", "寸止め料デー", "ｾｯｸｽ", "エロい", "LINE交換", "@mio_sama", "500円", "", "あ".repeat(30), "会おうよ", "オナ禁中", "お漏らし"];
  for (const text of corpus) {
    const server = rules.normalizeTodayWord(text);
    assert.equal(core.todayWordProblem(text), server.error || "", JSON.stringify(text));
  }
  assert.match(core.todayWordProblem("あ".repeat(31)), /30文字まで/);
  assert.equal(core.wordAgeLabel(Date.now() - 3 * 3_600_000), "3時間前");
  assert.equal(core.wordRemainingLabel(Date.now() - 3 * 3_600_000), "あと21時間で消えます");

  const hub = sourceBlock(client, "function renderHub", "function renderWordForm");
  assert.match(hub, /data-screen="card">カードを編集<\/button>\s*<\/div>\s*\$\{renderWordForm\(profile\)\}/, "the form appears only once a manager card exists");
  const form = sourceBlock(client, "function renderWordForm", "const ACHIEVEMENT_SIDES");
  assert.match(form, /maxlength="\$\{TODAY_WORD\.length\}"/);
  assert.match(form, /性的な言葉は書けません/);
  assert.match(sourceBlock(client, "function renderManagerCard", "function renderBoard"), /\$\{wordBubble\(card\.word\)\}/);
  assert.match(sourceBlock(client, 'case "word": {', 'case "apply": {'), /const problem = todayWordProblem\(text\);[\s\S]*?mutate\("set_word", \{ text \}/);
  assert.match(client, /mutate\("set_word", \{ clear: true \}/);
  assert.match(styles, /\.tribute-card-word \{/);
  assert.match(design, /今日のひとこと/);
});
