"use strict";

// お貢ぎ牧場：財布の限度額を、契約の記録から財布だけが読める private/limits へ移す（一度だけ使う管理用）。
// 既定は数えるだけ（読み取りのみ）。--apply を付けた時だけ書き込む。UID・本文・認証情報は出さない。
//
//   node functions/scripts/migrate-tribute-limits.cjs --project gazostadium            # 数えるだけ
//   node functions/scripts/migrate-tribute-limits.cjs --project gazostadium --apply    # 移す
//
// 認証は firebase-tools のログインを使う（FIREBASE_TOOLS_AUTH_MODULE に firebase-tools の lib/auth.js の絶対パス）。
// 公開後は、契約に触れた時にもサーバーが同じ移し替えをするので、このスクリプトは残りを一度に済ませるためのもの。
const path = require("node:path");

const PROJECT = "gazostadium";
const LIMIT_EVENT_TYPES = Object.freeze(["applied", "caps_lowered", "caps_raise_scheduled", "caps_raised"]);

function hasLegacyLimits(contract) {
  return Boolean(contract?.caps || contract?.pendingCaps || contract?.pendingCapsEffectiveDateKey);
}

// 移し替えの本体。firestore は Admin SDK か @google-cloud/firestore の Firestore、deleteField は FieldValue.delete。
async function migrateTributeLimits({ firestore, deleteField, apply = false, now = Date.now() }) {
  const contracts = await firestore.collection("tributeContracts").get();
  const summary = { apply, contracts: contracts.size, legacyContracts: 0, moved: 0, limitsAlreadyPresent: 0, eventsWithLimits: 0, eventsScrubbed: 0 };
  for (const document of contracts.docs) {
    const contract = document.data() || {};
    const legacy = hasLegacyLimits(contract);
    const events = await document.ref.collection("events").where("type", "in", [...LIMIT_EVENT_TYPES]).get();
    const limitEvents = events.docs.filter((event) => event.get("caps") !== undefined || event.get("effectiveDateKey") !== undefined);
    if (legacy) summary.legacyContracts += 1;
    summary.eventsWithLimits += limitEvents.length;
    if (!apply) continue;
    if (legacy) {
      const limitsRef = document.ref.collection("private").doc("limits");
      const outcome = await firestore.runTransaction(async (transaction) => {
        const [fresh, limits] = await Promise.all([transaction.get(document.ref), transaction.get(limitsRef)]);
        const data = fresh.data() || {};
        if (!hasLegacyLimits(data)) return "already-moved";
        // 先に契約に触れた時のサーバーが移していれば、そちらが新しいので上書きしない。
        if (!limits.exists) {
          transaction.set(limitsRef, {
            caps: data.caps ?? null,
            pendingCaps: data.pendingCaps ?? null,
            pendingCapsEffectiveDateKey: String(data.pendingCapsEffectiveDateKey || ""),
            contractId: document.id,
            payerUid: String(data.payerUid || ""),
            updatedAt: now,
            migratedAt: now,
          });
        }
        transaction.set(document.ref, { caps: null, pendingCaps: null, pendingCapsEffectiveDateKey: "" }, { merge: true });
        return limits.exists ? "limits-present" : "moved";
      });
      if (outcome === "moved") summary.moved += 1;
      if (outcome === "limits-present") {
        summary.moved += 1;
        summary.limitsAlreadyPresent += 1;
      }
    }
    // 管理人も読む出来事から、限度額と予約の日付を消す。
    for (const event of limitEvents) {
      await event.ref.update({ caps: deleteField(), effectiveDateKey: deleteField() });
      summary.eventsScrubbed += 1;
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
    const { Firestore, FieldValue } = require("@google-cloud/firestore");
    const firestore = new Firestore({ projectId: project, credentials: {
      type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
    } });
    return { firestore, deleteField: () => FieldValue.delete(), close: () => firestore.terminate() };
  }
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore, FieldValue } = require("firebase-admin/firestore");
  const app = initializeApp({ projectId: project, credential: applicationDefault() }, "tribute-limits-migration");
  return { firestore: getFirestore(app), deleteField: () => FieldValue.delete(), close: () => deleteApp(app) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { firestore, deleteField, close } = await openFirestore(options.project);
  try {
    const summary = await migrateTributeLimits({ firestore, deleteField, apply: options.apply });
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), project: options.project, ...summary }, null, 2));
  } finally {
    await close();
  }
}

module.exports = { LIMIT_EVENT_TYPES, hasLegacyLimits, migrateTributeLimits, parseArguments };

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
