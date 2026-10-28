"use strict";

// One-time administrative migration. Run only after economyAction rejects new
// creator-card purchases. Default is read-only. Do not print identities or balances.
// node functions/scripts/refund-retired-creator-cards.cjs --project gazostadium [--apply]
const path = require("node:path");
const { stageCreatorCardRefund, planCreatorCardRefund } = require("../creator-card-refund");
const { activateAnjuPayWallet, nextAnjuPayEntry, ANJU_PAY_OPENING_ENTRY_ID } = require("../anju-pay-ledger");
const { assertWalletIntegrity, assertLegacyBalance } = require("../account-diagnostics");
const PRODUCT_ID = "feature_top_message";
const MAX_BALANCE = 999_999_999;

function activeLedger(snapshot) {
  const value = snapshot.get("activatedAt");
  const activatedAt = typeof value?.toMillis === "function" ? value.toMillis() : Number(value || 0);
  if (!snapshot.exists || !Number.isFinite(activatedAt) || activatedAt <= 0) throw new Error("An active AnjuPay ledger is required.");
}

const metadataPatch = (wallet) => ({ ledgerVersion: wallet.ledgerVersion, historyStartedAt: wallet.historyStartedAt, ledgerSequence: wallet.ledgerSequence });
function stageOpening(transaction, ref, wallet, config, now) {
  activeLedger(config);
  const activation = activateAnjuPayWallet(wallet, now);
  if (!activation.activated) return false;
  Object.assign(wallet, activation.walletPatch);
  transaction.create(ref.collection("anjuPayEntries").doc(ANJU_PAY_OPENING_ENTRY_ID), activation.openingEntry);
  return true;
}
function appendEntry(transaction, ref, wallet, config, value) {
  activeLedger(config);
  const next = nextAnjuPayEntry(wallet, value);
  Object.assign(wallet, next.walletPatch);
  transaction.create(ref.collection("anjuPayEntries").doc(next.entryId), next.entry);
  return next.entry;
}

async function refundRetiredCreatorCards({ firestore, realtime, apply = false, now = Date.now() }) {
  const legacy = (await realtime.ref("online/economy").get()).val() || {};
  const buyers = new Set(Object.entries(legacy).filter(([, record]) => record?.inventory?.[PRODUCT_ID] === true).map(([uid]) => uid));
  // Parent documents may be missing; listDocuments includes their subcollections.
  const parents = await firestore.collection("economyPurchases").listDocuments();
  for (let offset = 0; offset < parents.length; offset += 100) {
    const records = await firestore.getAll(...parents.slice(offset, offset + 100).map((ref) => ref.collection("items").doc(PRODUCT_ID)));
    for (const record of records) if (record.exists) buyers.add(record.ref.parent.parent.id);
  }
  const summary = { apply, buyers: buyers.size, eligible: 0, granted: 0, alreadyComplete: 0, creditPay: 0, pendingPay: 0 };
  for (const uid of buyers) {
    const ref = firestore.collection("wallets").doc(uid);
    const purchaseRef = firestore.collection("economyPurchases").doc(uid).collection("items").doc(PRODUCT_ID);
    const operation = async (reader) => {
      const [snapshot, purchase, config] = await Promise.all([
        reader.get(ref), reader.get(purchaseRef), reader.get(firestore.collection("systemConfig").doc("anjuPayLedger")),
      ]);
      if (!purchase.exists && legacy[uid]?.inventory?.[PRODUCT_ID] !== true) return { eligible: false };
      activeLedger(config);
      let wallet;
      if (snapshot.exists) {
        assertWalletIntegrity(snapshot.data(), MAX_BALANCE); wallet = snapshot.data();
      } else {
        assertLegacyBalance(legacy[uid] || {}, MAX_BALANCE);
        wallet = { balance: legacy[uid]?.points ?? 0, reservedIncoming: 0, initializedAt: now, migratedFromRealtimeDatabase: true, updatedAt: now };
      }
      const plan = planCreatorCardRefund(wallet, { grant: true, now });
      if (!apply || !plan) return { eligible: true, plan, alreadyComplete: !plan && wallet.creatorCardRetirementRefund?.credited === 500,
        pending: plan?.pending ?? (500 - wallet.creatorCardRetirementRefund.credited) };
      if (!snapshot.exists) reader.create(ref, wallet);
      stageCreatorCardRefund({ transaction: reader, walletRef: ref, wallet, configSnapshot: config,
        now, grant: true, stageOpening, appendEntry, metadataPatch });
      return { eligible: true, plan, pending: plan.pending, granted: !snapshot.get("creatorCardRetirementRefund") };
    };
    const result = apply ? await firestore.runTransaction(operation) : await operation({ get: (ref) => ref.get() });
    if (!result.eligible) continue;
    summary.eligible++;
    summary.granted += Number(Boolean(result.granted));
    summary.alreadyComplete += Number(Boolean(result.alreadyComplete));
    summary.creditPay += result.plan?.credit || 0;
    summary.pendingPay += result.pending;
    if (apply) {
      const latest = await ref.get();
      await realtime.ref(`online/economy/${uid}`).update({ points: latest.get("balance"), updatedAt: now });
    }
  }
  return summary;
}

async function openAdmin() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error("Production CLI does not accept emulator overrides.");
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  let credential = applicationDefault();
  let firestore;
  if (process.env.FIREBASE_TOOLS_AUTH_MODULE) {
    const modulePath = process.env.FIREBASE_TOOLS_AUTH_MODULE;
    if (!path.isAbsolute(modulePath)) throw new Error("Firebase CLI auth module must be absolute.");
    const auth = require(modulePath); const api = require(path.join(path.dirname(modulePath), "api.js"));
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI login unavailable.");
    const { UserRefreshClient } = require("google-auth-library");
    const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
    const { Firestore } = require("@google-cloud/firestore");
    firestore = new Firestore({ projectId: "gazostadium", credentials: {
      type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
    } });
    credential = { async getAccessToken() { const { token } = await client.getAccessToken(); if (!token) throw new Error("Access token unavailable."); return { access_token: token, expires_in: 3600 }; } };
  }
  const app = initializeApp({ projectId: "gazostadium", databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app", credential }, "creator-card-retirement-refunds");
  return { firestore: firestore || require("firebase-admin/firestore").getFirestore(app), realtime: require("firebase-admin/database").getDatabase(app),
    close: async () => { if (firestore) await firestore.terminate(); await deleteApp(app); } };
}

async function main(argv) {
  const args = [...argv]; let apply = false; let project = "";
  while (args.length) { const arg = args.shift(); if (arg === "--apply") apply = true; else if (arg === "--project") project = args.shift(); else throw new Error("Unknown argument."); }
  if (project !== "gazostadium") throw new Error("--project gazostadium is required.");
  const admin = await openAdmin();
  try { console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...await refundRetiredCreatorCards({ ...admin, apply }) }, null, 2)); }
  finally { await admin.close(); }
}
module.exports = { refundRetiredCreatorCards, stageOpening, appendEntry, metadataPatch };
if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
