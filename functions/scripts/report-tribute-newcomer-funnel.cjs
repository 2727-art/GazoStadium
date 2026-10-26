"use strict";

// お貢ぎ牧場：新規がどこで立ち去っているかを数える（読み取りのみ・管理用）。
// 年齢確認を済ませた人が、管理人カード・申し込み・受理・初めての献上のどこまで進んだかを、直近の期間と全期間で数える。
// 出すのは人数と割合だけ。UID・名前・本文・認証情報は出さない。書き込みは一切しない。
//
//   node functions/scripts/report-tribute-newcomer-funnel.cjs --project gazostadium            # 直近30日
//   node functions/scripts/report-tribute-newcomer-funnel.cjs --project gazostadium --days 14  # 直近14日
//
// 認証は firebase-tools のログインを使う（FIREBASE_TOOLS_AUTH_MODULE に firebase-tools の lib/auth.js の絶対パス）。
// 数えられないもの: トップだけ見て帰った人、牧場の年齢確認の前に帰った人（記録を残さない作りのため）。
const path = require("node:path");

const PROJECT = "gazostadium";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const toInteger = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const share = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function bucketOf(value, buckets) {
  return buckets.find(([, minimum, maximum]) => value >= minimum && value <= maximum)?.[0] || "other";
}

function countBy(values, keyOf) {
  const counts = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

const FEE_BUCKETS = Object.freeze([["0", 0, 0], ["1-30", 1, 30], ["31-100", 31, 100], ["101+", 101, Number.MAX_SAFE_INTEGER]]);
const BALANCE_BUCKETS = Object.freeze([["0", 0, 0], ["1-29", 1, 29], ["30-99", 30, 99], ["100-999", 100, 999], ["1,000+", 1_000, Number.MAX_SAFE_INTEGER]]);

// 1人ぶんの進み具合（財布として）。
function payerProgress(uid, ageConfirmedAt, contractsByPayer) {
  const contracts = (contractsByPayer.get(uid) || []).slice().sort((left, right) => left.createdAt - right.createdAt);
  const accepted = contracts.filter((contract) => contract.acceptedAt > 0);
  const tributes = contracts.reduce((sum, contract) => sum + contract.tributeCount, 0);
  const firstApplyAt = contracts[0]?.createdAt || 0;
  return {
    applied: contracts.length > 0,
    accepted: accepted.length > 0,
    tributed: tributes > 0,
    tributedTwice: tributes >= 2,
    contracts: contracts.length,
    managers: new Set(contracts.map((contract) => contract.managerUid)).size,
    firstApplyDelay: firstApplyAt && ageConfirmedAt ? Math.max(0, firstApplyAt - ageConfirmedAt) : null,
    neverAccepted: contracts.length > 0 && accepted.length === 0 ? contracts : [],
  };
}

function cohortSummary(cohort, contractsByPayer, balances) {
  const rows = cohort.map((profile) => ({ profile, progress: payerProgress(profile.uid, profile.ageConfirmedAt, contractsByPayer) }));
  const total = rows.length;
  const managers = rows.filter((row) => row.profile.hasCard).length;
  const applied = rows.filter((row) => row.progress.applied);
  const accepted = rows.filter((row) => row.progress.accepted);
  const tributed = rows.filter((row) => row.progress.tributed);
  const idle = rows.filter((row) => !row.profile.hasCard && !row.progress.applied);
  const stalled = rows.filter((row) => row.progress.applied && !row.progress.accepted);
  const acceptedNoTribute = rows.filter((row) => row.progress.accepted && !row.progress.tributed);
  const delays = applied.map((row) => row.progress.firstApplyDelay).filter((value) => value !== null);
  const balanceOf = (row) => (balances.has(row.profile.uid) ? toInteger(balances.get(row.profile.uid)) : null);
  const balanceBuckets = (list) => countBy(list, (row) => {
    const balance = balanceOf(row);
    return balance === null ? "no wallet" : bucketOf(balance, BALANCE_BUCKETS);
  });
  return {
    ageConfirmed: total,
    funnel: {
      madeManagerCard: { count: managers, percent: share(managers, total) },
      appliedAsWallet: { count: applied.length, percent: share(applied.length, total) },
      acceptedAsWallet: { count: accepted.length, percent: share(accepted.length, total) },
      tributedAtLeastOnce: { count: tributed.length, percent: share(tributed.length, total) },
      tributedTwiceOrMore: { count: rows.filter((row) => row.progress.tributedTwice).length, percent: share(rows.filter((row) => row.progress.tributedTwice).length, total) },
    },
    // 年齢確認だけで、カードも申し込みもない人（いちばん大きな立ち去りの候補）。今の財布の残高つき。
    idleAfterAgeCheck: { count: idle.length, percent: share(idle.length, total), walletNow: balanceBuckets(idle) },
    // 申し込んだが、一度も受理されていない人。申し込みがどう終わったか。
    appliedNeverAccepted: {
      count: stalled.length,
      applicationOutcomes: countBy(stalled.flatMap((row) => row.progress.neverAccepted), (contract) => (contract.status === "pending" ? "still_pending" : contract.endReason || "ended")),
      entryFeeOfManagers: countBy(stalled.flatMap((row) => row.progress.neverAccepted), (contract) => `fee ${bucketOf(contract.entryFee, FEE_BUCKETS)}`),
      walletNow: balanceBuckets(stalled),
    },
    // 受理されたが、一度も貢いでいない人と、その今の残高。
    acceptedNeverTributed: { count: acceptedNoTribute.length, walletNow: balanceBuckets(acceptedNoTribute) },
    firstApplyAfterAgeCheck: {
      within1Hour: delays.filter((value) => value <= HOUR).length,
      within1Day: delays.filter((value) => value > HOUR && value <= DAY).length,
      later: delays.filter((value) => value > DAY).length,
    },
  };
}

function summarize({ profiles, contracts, balances, now, days }) {
  const contractsByPayer = new Map();
  for (const contract of contracts) {
    if (!contract.payerUid) continue;
    if (!contractsByPayer.has(contract.payerUid)) contractsByPayer.set(contract.payerUid, []);
    contractsByPayer.get(contract.payerUid).push(contract);
  }
  const confirmed = profiles.filter((profile) => profile.ageConfirmedAt > 0);
  const since = now - days * DAY;
  const recent = confirmed.filter((profile) => profile.ageConfirmedAt >= since);
  // 申し込みの入場料ごとの受理率（全期間）。入場料が財布に足りないと受理できない。
  const applications = contracts.filter((contract) => contract.payerUid);
  const byFee = {};
  for (const [label, minimum, maximum] of FEE_BUCKETS) {
    const list = applications.filter((contract) => contract.entryFee >= minimum && contract.entryFee <= maximum);
    const acceptedCount = list.filter((contract) => contract.acceptedAt > 0).length;
    byFee[`fee ${label}`] = { applications: list.length, accepted: acceptedCount, acceptedPercent: share(acceptedCount, list.length) };
  }
  const weekly = {};
  for (const profile of recent) {
    const week = Math.floor((now - profile.ageConfirmedAt) / (7 * DAY));
    const key = `${week * 7}-${week * 7 + 6} days ago`;
    weekly[key] = weekly[key] || { ageConfirmed: 0, applied: 0, tributed: 0 };
    const progress = payerProgress(profile.uid, profile.ageConfirmedAt, contractsByPayer);
    weekly[key].ageConfirmed += 1;
    if (progress.applied) weekly[key].applied += 1;
    if (progress.tributed) weekly[key].tributed += 1;
  }
  const accepting = profiles.filter((profile) => profile.hasCard && profile.accepting);
  return {
    days,
    recent: cohortSummary(recent, contractsByPayer, balances),
    allTime: cohortSummary(confirmed, contractsByPayer, balances),
    recentByWeek: weekly,
    applicationsByEntryFee: byFee,
    acceptingManagersByEntryFee: countBy(accepting, (profile) => `fee ${bucketOf(profile.entryFee, FEE_BUCKETS)}`),
  };
}

function parseArguments(argv) {
  const options = { project: "", days: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project") options.project = String(argv[++index] || "");
    else if (argument === "--days") options.days = Number(argv[++index]);
    else throw new Error(`Unsupported option: ${argument}`);
  }
  if (options.project !== PROJECT) throw new Error("--project gazostadium is required.");
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) throw new Error("--days must be 1-365.");
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
  return new Firestore({ projectId: project, credentials: {
    type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
  } });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const firestore = await openFirestore(options.project);
  try {
    // 必要な項目だけを読む（select）。
    const [profileSnapshot, contractSnapshot] = await Promise.all([
      firestore.collection("tributeProfiles").select("ageConfirmedAt", "card.personaName", "card.entryFee", "accepting").get(),
      firestore.collection("tributeContracts").select("payerUid", "managerUid", "status", "createdAt", "acceptedAt", "tributeCount", "endReason", "entryFee").get(),
    ]);
    const profiles = profileSnapshot.docs.map((document) => ({
      uid: document.id,
      ageConfirmedAt: toInteger(document.get("ageConfirmedAt")),
      hasCard: Boolean(document.get("card.personaName")),
      accepting: document.get("accepting") === true,
      entryFee: toInteger(document.get("card.entryFee")),
    }));
    const contracts = contractSnapshot.docs.map((document) => ({
      payerUid: String(document.get("payerUid") || ""),
      managerUid: String(document.get("managerUid") || ""),
      status: String(document.get("status") || ""),
      createdAt: toInteger(document.get("createdAt")),
      acceptedAt: toInteger(document.get("acceptedAt")),
      tributeCount: toInteger(document.get("tributeCount")),
      endReason: String(document.get("endReason") || ""),
      entryFee: toInteger(document.get("entryFee")),
    }));
    // 残高は、年齢確認を済ませた人の財布だけを読む。
    const refs = profiles.filter((profile) => profile.ageConfirmedAt > 0).map((profile) => firestore.collection("wallets").doc(profile.uid));
    const balances = new Map();
    for (let index = 0; index < refs.length; index += 100) {
      const snapshots = await firestore.getAll(...refs.slice(index, index + 100), { fieldMask: ["balance"] });
      for (const snapshot of snapshots) if (snapshot.exists) balances.set(snapshot.id, snapshot.get("balance"));
    }
    const summary = summarize({ profiles, contracts, balances, now: Date.now(), days: options.days });
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      project: options.project,
      readOnly: true,
      documentsRead: { tributeProfiles: profileSnapshot.size, tributeContracts: contractSnapshot.size, wallets: refs.length },
      ...summary,
    }, null, 2));
  } finally {
    await firestore.terminate();
  }
}

module.exports = { summarize, parseArguments };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
