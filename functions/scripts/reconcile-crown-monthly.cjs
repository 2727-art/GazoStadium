"use strict";

// Dry-run by default. Applies the exact finalizer's revision reconciliation only
// to an explicitly selected, already-finalized month. Never prints player IDs.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crown = require("../crown-circuit");
const achievements = require("../achievements");
const { createMigrationRealtimeRest } = require("./player-safety-rtdb-rest");

function loadMonthlyFinalizer({ firestore, realtime }) {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  function between(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error("Monthly finalizer source unavailable");
    return source.slice(from, to);
  }
  const profileRef = uid => firestore.collection("serverRankingProfiles").doc(uid);
  const periodRef = (period, key) => firestore.collection("crownCircuitPeriods").doc(`${period}_${key}`);
  const context = vm.createContext({
    ...crown, ...achievements, firestore, realtime,
    serverRankingAwardRef: (uid, period, key) => profileRef(uid).collection("awards").doc(`${period}_${key}`),
    crownCircuitPeriodRef: periodRef,
    crownCircuitPeriodEntryRef: (uid, period, key) => periodRef(period, key).collection("entries").doc(uid),
    crownMonthlyAchievementStatsRef: uid => firestore.collection("crownMonthlyAchievementStats").doc(uid),
    achievementProfileRef: uid => firestore.collection("achievementProfiles").doc(uid),
  });
  vm.runInContext([
    between("function cleanText(", "function safeBalance("),
    between("function periodKey(", "function eventId("),
    between("function publicCrownCircuitEntry(", "async function mirrorServerRateFloorProfiles("),
    between("async function mirrorCrownCircuitEntries(", "async function mirrorServerRankingEntries("),
    between("async function commitCrownCircuitWrites(", "async function finalizeClosedCrownCircuitPeriods("),
    "this.finalize = (key, now) => finalizeCrownCircuitPeriod('monthly', key, now);",
    "this.revision = CROWN_MONTHLY_ACHIEVEMENT_REVISION;",
  ].join("\n"), context, { timeout: 2000 });
  return { finalize: context.finalize, revision: context.revision };
}

async function reconcile({ firestore, realtime, key, apply = false, now = Date.now() }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !crown.isCrownCircuitPeriod("monthly", key)) {
    throw new Error("Invalid monthly period");
  }
  const ref = firestore.collection("crownCircuitPeriods").doc(`monthly_${key}`);
  const before = await ref.get();
  if (!before.exists || before.get("status") !== "finalized" || !(before.get("endsAt") <= now)) {
    throw new Error("Only an already-finalized, closed month can be reconciled");
  }
  const runtime = loadMonthlyFinalizer({ firestore, realtime });
  const report = {
    key, apply, participantCount: before.get("participantCount"),
    previousRevision: Number(before.get("achievementRevision") || 0),
    targetRevision: runtime.revision,
    finalizedAt: before.get("finalizedAt"),
  };
  if (apply) {
    report.result = await runtime.finalize(key, now);
    const after = await ref.get();
    report.finalRevision = after.get("achievementRevision");
    report.finalizedAtPreserved = after.get("finalizedAt") === report.finalizedAt;
    if (!report.finalizedAtPreserved || report.finalRevision !== runtime.revision) {
      throw new Error("Monthly reconciliation verification failed");
    }
  }
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (["--project", "--month", "--out"].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
    else throw new Error("Unsupported argument");
  }
  if (args.project !== "gazostadium" || !args.month) throw new Error("--project gazostadium --month YYYY-MM required");
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error("Production command rejects emulator overrides");
  const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!authModule || !path.isAbsolute(authModule)) throw new Error("Firebase CLI auth module required");
  const auth = require(authModule), api = require(path.join(path.dirname(authModule), "api"));
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI login required");
  const { Firestore } = require("@google-cloud/firestore");
  const { UserRefreshClient } = require("google-auth-library");
  const firestore = new Firestore({ projectId: args.project, preferRest: true, credentials: {
    type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: account.tokens.refresh_token,
  } });
  const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
  const realtime = createMigrationRealtimeRest({
    databaseURL: "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app",
    getAccessToken: async () => ({ access_token: (await client.getAccessToken()).token }),
  });
  try {
    const report = { checkedAt: new Date().toISOString(), project: args.project,
      ...await reconcile({ firestore, realtime, key: args.month, apply: args.apply }) };
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally { await firestore.terminate(); }
}
if (require.main === module) main().catch(error => {
  console.error(`Monthly reconciliation failed (${error.code || error.name}).`);
  process.exitCode = 1;
});
module.exports = { loadMonthlyFinalizer, reconcile };
