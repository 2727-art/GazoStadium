"use strict";

// お貢ぎ牧場：請求の二重払い（2026-10-26 に直した不具合）で、同じ請求に重ねて払われた分を、運営から財布へ返す（一度だけ使う管理用）。
// ユーザー決定: 運営から財布へ返す。管理人の残高はそのまま。
// 既定は数えるだけ（読み取りのみ）。--apply を付けた時だけ、財布の持ち主の返金待ち（operatorRefundPending）に積む。
// 財布は、お貢ぎ牧場の契約の画面の「返金待ち」から「財布へ受け取る」で受け取り、利用履歴に「運営からの返金」と残る。
// 契約ごとに一度だけ積む（tributeProfiles/{uid}.operatorRefundGrants の印）。UID・本文・認証情報は出さない。
//
//   node functions/scripts/grant-tribute-double-payment-refunds.cjs --project gazostadium            # 数えるだけ
//   node functions/scripts/grant-tribute-double-payment-refunds.cjs --project gazostadium --apply    # 積む
//
// 認証は firebase-tools のログインを使う（FIREBASE_TOOLS_AUTH_MODULE に firebase-tools の lib/auth.js の絶対パス）。
const path = require("node:path");
const { closedRequests, parseArguments } = require("./repair-tribute-pending-requests.cjs");

const REASON = "double_payment";

function grantIdFor(contractId) {
  return `double-payment-${contractId}`;
}

// 契約ごとの返金額（同じ請求に重ねて払われた分の合計）と、払った財布。
async function findDoublePayments(firestore) {
  const contracts = await firestore.collection("tributeContracts").get();
  const grants = [];
  for (const document of contracts.docs) {
    const contract = document.data() || {};
    const tributes = await document.ref.collection("events").where("type", "==", "tribute").get();
    const { duplicates } = closedRequests(tributes.docs.map((event) => event.data()));
    const amount = duplicates.reduce((sum, entry) => sum + entry.extraPay, 0);
    const payerUid = String(contract.payerUid || "");
    if (amount > 0 && payerUid) {
      grants.push({ contractId: document.id, payerUid, amount, payments: duplicates.reduce((sum, entry) => sum + entry.payments - 1, 0) });
    }
  }
  return { contracts: contracts.size, grants };
}

async function grantDoublePaymentRefunds({ firestore, apply = false, now = Date.now() }) {
  const { contracts, grants } = await findDoublePayments(firestore);
  const summary = {
    apply,
    contracts,
    grants: grants.length,
    wallets: new Set(grants.map((grant) => grant.payerUid)).size,
    extraPayments: grants.reduce((sum, grant) => sum + grant.payments, 0),
    totalPay: grants.reduce((sum, grant) => sum + grant.amount, 0),
    granted: 0,
    grantedPay: 0,
    alreadyGranted: 0,
    missingProfile: 0,
    byContract: grants.map(({ contractId, amount, payments }) => ({ contractId, amount, extraPayments: payments })),
  };
  if (!apply) return summary;
  for (const grant of grants) {
    const ref = firestore.collection("tributeProfiles").doc(grant.payerUid);
    const outcome = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return "missing";
      const data = snapshot.data() || {};
      const grantId = grantIdFor(grant.contractId);
      if (data.operatorRefundGrants && typeof data.operatorRefundGrants === "object" && data.operatorRefundGrants[grantId]) return "already";
      const pending = Math.max(0, Math.floor(Number(data.operatorRefundPending) || 0));
      // merge: true は地図を深く混ぜるので、ほかの返金の印はそのまま残り、この印だけが足される。
      transaction.set(ref, {
        operatorRefundPending: pending + grant.amount,
        operatorRefundGrants: { [grantId]: { amount: grant.amount, reason: REASON, contractId: grant.contractId, grantedAt: now } },
      }, { merge: true });
      return "granted";
    });
    if (outcome === "granted") {
      summary.granted += 1;
      summary.grantedPay += grant.amount;
    } else if (outcome === "already") {
      summary.alreadyGranted += 1;
    } else {
      summary.missingProfile += 1;
    }
  }
  return summary;
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
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, "tribute-double-payment-refund");
  return { firestore: getFirestore(app), close: () => deleteApp(app) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { firestore, close } = await openFirestore(options.project);
  try {
    const summary = await grantDoublePaymentRefunds({ firestore, apply: options.apply });
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), project: options.project, ...summary }, null, 2));
  } finally {
    await close();
  }
}

module.exports = { findDoublePayments, grantDoublePaymentRefunds, grantIdFor };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
