"use strict";

// お貢ぎ牧場の金庫を設計するための、AnjuPay 残高と管理人の実績の分布（読み取りのみ・一度だけ使う管理用）。
// 出すのは人数と金額だけ。UID・名前・本文・認証情報は出さない。書き込みは一切しない。
//
//   node functions/scripts/report-tribute-vault-distribution.cjs --project gazostadium
//
// 認証は firebase-tools のログインを使う（FIREBASE_TOOLS_AUTH_MODULE に firebase-tools の lib/auth.js の絶対パス）。
// 読む文書: wallets（残高だけ）、tributeProfiles（管理人カードの有無・受付中だけ）、tributePairs（組ごとの累計だけ）。
const path = require("node:path");

const PROJECT = "gazostadium";
const BALANCE_BUCKETS = Object.freeze([
  ["0", 0, 0],
  ["1-999", 1, 999],
  ["1,000-4,999", 1_000, 4_999],
  ["5,000-9,999", 5_000, 9_999],
  ["10,000-29,999", 10_000, 29_999],
  ["30,000-99,999", 30_000, 99_999],
  ["100,000+", 100_000, Number.MAX_SAFE_INTEGER],
]);
const PAYER_BUCKETS = Object.freeze([["0", 0, 0], ["1", 1, 1], ["2", 2, 2], ["3-4", 3, 4], ["5-9", 5, 9], ["10+", 10, Number.MAX_SAFE_INTEGER]]);
// 金庫を作れる「管理人の実績」の候補。どの案で何人が残るかを見る。
const QUALIFICATION_RULES = Object.freeze([
  { id: "any_tribute", label: "1人以上の財布から献上を受けた", test: (row) => row.payers >= 1 },
  { id: "payers3", label: "累計3人以上の財布から献上を受けた", test: (row) => row.payers >= 3 },
  { id: "payers3_received1000", label: "累計3人以上・受け取り累計1,000 Pay以上", test: (row) => row.payers >= 3 && row.received >= 1_000 },
  { id: "payers5_received3000", label: "累計5人以上・受け取り累計3,000 Pay以上", test: (row) => row.payers >= 5 && row.received >= 3_000 },
  { id: "payers10", label: "累計10人以上の財布から献上を受けた", test: (row) => row.payers >= 10 },
]);

const toInteger = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

function bucketCounts(values, buckets) {
  return Object.fromEntries(buckets.map(([label, minimum, maximum]) => [label, values.filter((value) => value >= minimum && value <= maximum).length]));
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    positive: sorted.filter((value) => value > 0).length,
    sum: sorted.reduce((total, value) => total + value, 0),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) || 0,
    top10: sorted.slice(-10).reverse(),
    buckets: bucketCounts(sorted, BALANCE_BUCKETS),
  };
}

// 集計の本体（純粋な関数）。入力は { uid → 残高 }、管理人カードの一覧、組の一覧。出力に UID は入れない。
function summarize({ balances, profiles, pairs }) {
  const byManager = new Map();
  for (const pair of pairs) {
    const total = toInteger(pair.total);
    if (!pair.managerUid || !total) continue;
    const entry = byManager.get(pair.managerUid) || { payers: 0, received: 0, tributes: 0 };
    entry.payers += 1;
    entry.received += total;
    entry.tributes += toInteger(pair.count);
    byManager.set(pair.managerUid, entry);
  }
  const managers = profiles.filter((profile) => profile.hasCard).map((profile) => ({
    accepting: profile.accepting === true,
    balance: toInteger(balances.get(profile.uid)),
    ...(byManager.get(profile.uid) || { payers: 0, received: 0, tributes: 0 }),
  }));
  const managerUids = new Set(profiles.filter((profile) => profile.hasCard).map((profile) => profile.uid));
  const others = [...balances.entries()].filter(([uid]) => !managerUids.has(uid)).map(([, balance]) => toInteger(balance));
  return {
    allWallets: distribution([...balances.values()].map(toInteger)),
    nonManagerWallets: distribution(others),
    managers: {
      cards: managers.length,
      accepting: managers.filter((row) => row.accepting).length,
      balance: distribution(managers.map((row) => row.balance)),
      lifetimePayers: bucketCounts(managers.map((row) => row.payers), PAYER_BUCKETS),
      lifetimeReceived: distribution(managers.map((row) => row.received)),
    },
    qualification: QUALIFICATION_RULES.map((rule) => {
      const qualified = managers.filter(rule.test);
      return { id: rule.id, label: rule.label, managers: qualified.length, balance: distribution(qualified.map((row) => row.balance)) };
    }),
  };
}

function parseArguments(argv) {
  const options = { project: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--project") options.project = String(argv[++index] || "");
    else throw new Error(`Unsupported option: ${argv[index]}`);
  }
  if (options.project !== PROJECT) throw new Error("--project gazostadium is required.");
  return options;
}

async function openFirestore(project) {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("This production command does not accept emulator overrides.");
  const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!authModule || !path.isAbsolute(authModule)) throw new Error("Set FIREBASE_TOOLS_AUTH_MODULE to the absolute path of firebase-tools lib/auth.js.");
  const auth = require(authModule);
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Log in with firebase-tools first.");
  const api = require(path.join(path.dirname(authModule), "api.js"));
  const { Firestore } = require("@google-cloud/firestore");
  const firestore = new Firestore({ projectId: project, credentials: {
    type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
  } });
  return firestore;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const firestore = await openFirestore(options.project);
  try {
    // 必要な項目だけを読む（select）。読み込みの回数は文書の数だけ。
    const [walletSnapshot, profileSnapshot, pairSnapshot] = await Promise.all([
      firestore.collection("wallets").select("balance").get(),
      firestore.collection("tributeProfiles").select("card.personaName", "accepting").get(),
      firestore.collection("tributePairs").select("managerUid", "total", "count").get(),
    ]);
    const balances = new Map(walletSnapshot.docs.map((document) => [document.id, document.get("balance")]));
    const profiles = profileSnapshot.docs.map((document) => ({
      uid: document.id,
      hasCard: Boolean(document.get("card.personaName")),
      accepting: document.get("accepting") === true,
    }));
    const pairs = pairSnapshot.docs.map((document) => ({
      managerUid: String(document.get("managerUid") || ""),
      total: document.get("total"),
      count: document.get("count"),
    }));
    const summary = summarize({ balances, profiles, pairs });
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      project: options.project,
      readOnly: true,
      documentsRead: { wallets: walletSnapshot.size, tributeProfiles: profileSnapshot.size, tributePairs: pairSnapshot.size },
      ...summary,
    }, null, 2));
  } finally {
    await firestore.terminate();
  }
}

module.exports = { BALANCE_BUCKETS, QUALIFICATION_RULES, summarize, parseArguments };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
