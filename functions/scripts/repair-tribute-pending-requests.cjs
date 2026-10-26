"use strict";

// お貢ぎ牧場：払った・取り消した請求が「未払いの請求」に残っている契約を直す（一度だけ使う管理用）。
// 原因: 契約の書き込みが merge: true だったため、pendingRequests から消した鍵が本物の Firestore では残った
// （2026-10-26 に mergeFields へ直した）。残った請求は、もう一度払えてしまう。
// 既定は数えるだけ（読み取りのみ）。--apply を付けた時だけ、残った鍵を消す。UID・本文・認証情報は出さない。
//
//   node functions/scripts/repair-tribute-pending-requests.cjs --project gazostadium            # 数えるだけ
//   node functions/scripts/repair-tribute-pending-requests.cjs --project gazostadium --apply    # 直す
//
// 認証は firebase-tools のログインを使う（FIREBASE_TOOLS_AUTH_MODULE に firebase-tools の lib/auth.js の絶対パス）。
// 二重に払われた請求も数える（返金するかは別に決める）。直すのは、進行中・申込中の契約の残った鍵だけ。
const path = require("node:path");

const PROJECT = "gazostadium";
const OPEN_STATUSES = Object.freeze(["active", "pending"]);
// 請求を閉じる出来事: 払った（献上の kind が request）、取り消し（管理人・名目の許可を外した時）、古い画面の「断る」。
const CLOSING_TYPES = Object.freeze(["request_cancelled", "request_declined"]);

function requestIdsOf(contract) {
  const requests = contract?.pendingRequests;
  return requests && typeof requests === "object" && !Array.isArray(requests) ? Object.keys(requests) : [];
}

// 1つの契約の出来事から、閉じた請求と、二重に払われた請求を数える。
function closedRequests(events) {
  const paid = new Map();
  const closed = new Set();
  for (const event of events) {
    const requestId = String(event?.requestId || "");
    if (!requestId) continue;
    if (event.type === "tribute" && event.kind === "request") {
      const entry = paid.get(requestId) || { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Math.max(0, Number(event.amount) || 0);
      paid.set(requestId, entry);
      closed.add(requestId);
    } else if (CLOSING_TYPES.includes(event.type)) {
      closed.add(requestId);
    }
  }
  const duplicates = [...paid.entries()]
    .filter(([, entry]) => entry.count > 1)
    .map(([requestId, entry]) => ({ requestId, payments: entry.count, extraPay: Math.round(entry.amount - entry.amount / entry.count) }));
  return { closed, duplicates };
}

async function repairPendingRequests({ firestore, apply = false }) {
  const contracts = await firestore.collection("tributeContracts").get();
  const summary = {
    apply,
    contracts: contracts.size,
    openWithPending: 0,
    staleRequests: 0,
    contractsWithStale: 0,
    repairedContracts: 0,
    removedRequests: 0,
    duplicatePayments: 0,
    duplicateExtraPay: 0,
    duplicateContracts: [],
  };
  for (const document of contracts.docs) {
    const contract = document.data() || {};
    // 二重払いは、終わった契約も含めて数える（献上の出来事だけを読む）。
    const tributes = await document.ref.collection("events").where("type", "==", "tribute").get();
    const pendingIds = OPEN_STATUSES.includes(contract.status) ? requestIdsOf(contract) : [];
    const closing = pendingIds.length
      ? await document.ref.collection("events").where("type", "in", [...CLOSING_TYPES]).get()
      : { docs: [] };
    const { closed, duplicates } = closedRequests([...tributes.docs, ...closing.docs].map((event) => event.data()));
    if (duplicates.length) {
      summary.duplicatePayments += duplicates.reduce((sum, entry) => sum + entry.payments - 1, 0);
      summary.duplicateExtraPay += duplicates.reduce((sum, entry) => sum + entry.extraPay, 0);
      summary.duplicateContracts.push({ contractId: document.id, status: String(contract.status || ""), duplicates: duplicates.map(({ payments, extraPay }) => ({ payments, extraPay })) });
    }
    if (!pendingIds.length) continue;
    summary.openWithPending += 1;
    const stale = pendingIds.filter((requestId) => closed.has(requestId));
    if (!stale.length) continue;
    summary.staleRequests += stale.length;
    summary.contractsWithStale += 1;
    if (!apply) continue;
    const removed = await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(document.ref);
      const data = fresh.data() || {};
      const requests = { ...(data.pendingRequests || {}) };
      let count = 0;
      for (const requestId of stale) {
        if (requestId in requests) {
          delete requests[requestId];
          count += 1;
        }
      }
      // update は欄を丸ごと置き換える。並び順を変えないよう updatedAt には触れない。
      if (count) transaction.update(document.ref, { pendingRequests: requests });
      return count;
    });
    if (removed) {
      summary.repairedContracts += 1;
      summary.removedRequests += removed;
    }
  }
  return summary;
}

function parseArguments(argv) {
  const options = { project: "", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--project") options.project = String(argv[++index] || "");
    else if (argument === "--apply") options.apply = true;
    else throw new Error(`Unsupported option: ${argument}`);
  }
  if (options.project !== PROJECT) throw new Error("--project gazostadium is required.");
  return options;
}

async function openFirestore(project) {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("This production command does not accept emulator overrides.");
  const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (authModule) {
    if (!path.isAbsolute(authModule)) throw new Error("FIREBASE_TOOLS_AUTH_MODULE must be an absolute path.");
    const auth = require(authModule);
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw new Error("Log in with firebase-tools first.");
    const api = require(path.join(path.dirname(authModule), "api.js"));
    const { Firestore } = require("@google-cloud/firestore");
    const firestore = new Firestore({ projectId: project, credentials: {
      type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
    } });
    return { firestore, close: () => firestore.terminate() };
  }
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, "tribute-pending-repair");
  return { firestore: getFirestore(app), close: () => deleteApp(app) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { firestore, close } = await openFirestore(options.project);
  try {
    const summary = await repairPendingRequests({ firestore, apply: options.apply });
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), project: options.project, ...summary }, null, 2));
  } finally {
    await close();
  }
}

module.exports = { closedRequests, parseArguments, repairPendingRequests, requestIdsOf };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
