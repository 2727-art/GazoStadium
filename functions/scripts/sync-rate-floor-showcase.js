"use strict";

// Run after deploying the showcase-aware backend. Read-only unless --apply is
// explicit. Logs contain counts only, never player identifiers or credentials.
// node scripts/sync-rate-floor-showcase.js --project gazostadium [--apply]
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { effectiveShowcase, normalizeAchievementProfile } = require("../achievements");
const { SERVER_RANKING_VERSION } = require("../server-ranking");
const { CROWN_THEMES, CROWN_SIGNATURE_IDS, CROWN_CIRCUIT_RULESET_VERSION } = require("../crown-circuit");
const { SERVER_RATE_FLOOR_MINIMUM_MATCHES, isServerRateFloorEntryId,
  normalizeServerRateFloorRevision, nextServerRateFloorRevision,
  serverRateFloorPublicEntry, serverRateFloorMirrorDecision } = require("../rate-floor");
const { createMigrationRealtimeRest } = require("./player-safety-rtdb-rest");

const MIGRATION_ID = "rate-floor-showcase-v1";
const UID = /^[A-Za-z0-9_-]{1,128}$/;

// Use the exact deployed normalizer without loading index.js, which registers
// every Cloud Function and initializes Firebase services as a side effect.
function loadProfileNormalizer() {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  function between(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error("Ranking profile normalizer source is unavailable.");
    return source.slice(from, to);
  }
  const context = { CROWN_THEMES, CROWN_SIGNATURE_IDS, SERVER_RANKING_VERSION,
    normalizeServerRateFloorRevision, isServerRateFloorEntryId };
  vm.runInNewContext([
    between("function cleanText(", "function safeBalance("),
    between("function normalizeServerRankingProfile(", "function activeServerRankingPeriodInfos("),
    "this.normalize = normalizeServerRankingProfile;",
  ].join("\n"), context, { timeout: 1000 });
  return context.normalize;
}

function visibleEntry(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.serverVerified === true && value.rateFloorHidden !== true
    && value.rulesetVersion === CROWN_CIRCUIT_RULESET_VERSION
    && Number.isInteger(value.rating) && value.rating >= 100 && value.rating <= 3000
    && Number.isInteger(value.serverMatches) && value.serverMatches >= SERVER_RATE_FLOOR_MINIMUM_MATCHES;
}

function samePublicEntry(current, expected) {
  return Object.keys(current).length === Object.keys(expected).length
    && Object.keys(expected).every((key) => current[key] === expected[key]);
}

async function withDeadline(promise, stage = "read", timeoutMs = 30_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("RATE FLOOR migration read timed out.");
        error.code = "deadline-exceeded";
        error.stage = stage;
        reject(error);
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function* documents(query, documentIdField, pageSize, onProgress) {
  let cursor;
  while (true) {
    let page = query.orderBy(documentIdField).limit(pageSize);
    if (cursor) page = page.startAfter(cursor);
    onProgress({ stage: "firestore-page-read" });
    const snapshot = await withDeadline(page.get(), "firestore-page-read");
    onProgress({ stage: "firestore-page-ready", count: snapshot.docs.length });
    for (const document of snapshot.docs) yield document;
    if (snapshot.docs.length < pageSize) return;
    cursor = snapshot.docs.at(-1);
  }
}

async function migrate({ firestore, realtime, apply = false, documentIdField = "__name__",
  pageSize = 100, onProgress = () => {}, normalizeProfile = loadProfileNormalizer() }) {
  const report = { migrationId: MIGRATION_ID, apply, scanned: 0, eligible: 0,
    planned: 0, revised: 0, updated: 0, unchanged: 0, skipped: 0, raced: 0 };
  onProgress({ stage: "scan-begin", apply });
  const query = firestore.collection("serverRankingProfiles").where("rateFloorEnabled", "==", true);
  for await (const document of documents(query, documentIdField, pageSize, onProgress)) {
    report.scanned += 1;
    const initial = normalizeProfile(document.data());
    if (!UID.test(document.id) || !serverRateFloorPublicEntry(initial)) {
      report.skipped += 1;
      continue;
    }
    const publicRef = realtime.ref(`online/serverRateFloorLeaderboard/${initial.rateFloorEntryId}`);
    onProgress({ stage: "public-row-read", scanned: report.scanned });
    const publicValue = (await withDeadline(publicRef.get(), "public-row-read")).val();
    if (!visibleEntry(publicValue)) { report.skipped += 1; continue; }
    report.eligible += 1;

    // Transaction callbacks only read/write Firestore. They may retry without
    // performing a stale RTDB side effect. The new revision also rejects delayed
    // deliveries from the backend that predates showcase publication.
    onProgress({ stage: "profile-transaction", scanned: report.scanned });
    const transactionDeadline = Date.now() + 60_000;
    const result = await withDeadline(firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document.ref);
      if (!snapshot.exists) return { status: "raced" };
      const profile = normalizeProfile(snapshot.data());
      if (profile.rateFloorEntryId !== initial.rateFloorEntryId
          || !serverRateFloorPublicEntry(profile)
          || normalizeServerRateFloorRevision(publicValue.syncRevision) > profile.rateFloorRevision) {
        return { status: "raced" };
      }
      const achievementSnapshot = await transaction.get(firestore.collection("achievementProfiles").doc(document.id));
      const achievementShowcase = effectiveShowcase(normalizeAchievementProfile(achievementSnapshot.data())).join(",");
      const next = { ...profile, achievementShowcase };
      if (!achievementShowcase) delete next.achievementShowcase;
      const publicEntry = serverRateFloorPublicEntry(next, { rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION });
      if ((profile.achievementShowcase || "") === achievementShowcase
          && samePublicEntry(publicValue, { ...publicEntry, syncRevision: profile.rateFloorRevision })) {
        return { status: "unchanged" };
      }
      next.rateFloorRevision = nextServerRateFloorRevision(profile.rateFloorRevision);
      if (next.rateFloorRevision <= profile.rateFloorRevision) return { status: "raced" };
      if (apply) {
        // A read completing after the outer deadline must not start a write.
        if (Date.now() >= transactionDeadline) {
          const error = new Error("RATE FLOOR source transaction expired.");
          error.code = "deadline-exceeded";
          error.stage = "profile-transaction";
          throw error;
        }
        // The empty string removes a stale selection on normalization without
        // requiring FieldValue sentinels in this small injectable migration.
        transaction.set(document.ref, { achievementShowcase,
          rateFloorRevision: next.rateFloorRevision }, { merge: true });
      }
      return { status: "planned", profile: next, publicEntry };
    }, { maxAttempts: 3 }), "profile-transaction", 60_000);
    if (result.status !== "planned") { report[result.status] += 1; continue; }
    report.planned += 1;
    if (apply) {
      report.revised += 1;
      onProgress({ stage: "public-row-cas", scanned: report.scanned });
      const mirrored = await withDeadline(publicRef.transaction((current) => {
        // Migration never enrolls a player or revives a removed/hidden row.
        if (!visibleEntry(current)) return undefined;
        const decision = serverRateFloorMirrorDecision(current, {
          publicEntry: result.publicEntry, revision: result.profile.rateFloorRevision,
          rulesetVersion: CROWN_CIRCUIT_RULESET_VERSION,
        });
        return decision.committed ? decision.value : undefined;
      }), "public-row-cas", 60_000);
      if (mirrored.committed) report.updated += 1;
      else report.raced += 1;
    }
    if (report.scanned % pageSize === 0) onProgress({ ...report });
  }
  return report;
}

function parseArguments(argv) {
  const options = { apply: false, project: "", databaseURL: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") options.apply = true;
    else if (["--project", "--database-url"].includes(option)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing migration argument value.");
      options[option === "--project" ? "project" : "databaseURL"] = value;
    } else throw new Error("Unknown migration argument.");
  }
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(options.project)) throw new Error("An explicit --project is required.");
  if (!options.databaseURL) {
    if (options.project === "gazostadium") {
      options.databaseURL = "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app";
    } else throw new Error("Provide --database-url for this project.");
  }
  const url = new URL(options.databaseURL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !["", "/"].includes(url.pathname)
      || !new RegExp(`^${options.project}-default-rtdb\\.(?:[a-z0-9-]+\\.)?(?:firebasedatabase\\.app|firebaseio\\.com)$`).test(url.hostname)) {
    throw new Error("Database URL must belong to the explicitly selected project.");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const progress = (value) => process.stderr.write(`${JSON.stringify(value)}\n`);
  progress({ stage: "setup", apply: options.apply });
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore, FieldPath } = require("firebase-admin/firestore");
  let credential;
  let cliFirestore;
  if (process.env.FIREBASE_TOOLS_AUTH_MODULE) {
    const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
    if (!path.isAbsolute(authModule)) throw new Error("Firebase CLI auth module must use an absolute path.");
    const auth = require(authModule);
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI has no authenticated default account.");
    const api = require(path.join(path.dirname(authModule), "api.js"));
    const { Firestore } = require("@google-cloud/firestore");
    // This local environment can reach Firestore REST while gRPC may stall.
    // Query/transaction semantics are identical through the supported fallback.
    cliFirestore = new Firestore({ projectId: options.project, preferRest: true, credentials: {
      type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(),
      refresh_token: account.tokens.refresh_token,
    } });
    const { UserRefreshClient } = require("google-auth-library");
    const authClient = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
    progress({ stage: "cli-access-token" });
    await withDeadline(authClient.getAccessToken(), "cli-access-token");
    credential = { async getAccessToken() {
      const token = await authClient.getAccessToken();
      if (!token.token) throw new Error("Firebase CLI login could not provide an access token.");
      return { access_token: token.token, expires_in: 3600 };
    } };
  } else credential = applicationDefault();
  const app = initializeApp({ projectId: options.project, databaseURL: options.databaseURL, credential }, MIGRATION_ID);
  const firestore = cliFirestore || getFirestore(app);
  if (!cliFirestore) firestore.settings({ preferRest: true });
  try {
    const report = await migrate({ ...options, firestore,
      realtime: createMigrationRealtimeRest({ databaseURL: options.databaseURL,
        getAccessToken: () => credential.getAccessToken() }), documentIdField: FieldPath.documentId(),
      onProgress: progress });
    await new Promise((resolve) => process.stdout.write(`${JSON.stringify({ project: options.project, ...report }, null, 2)}\n`, resolve));
    return report;
  } finally {
    // terminate waits for pending RPCs; bound it so a failed read remains
    // diagnosable instead of concealing the original error indefinitely.
    progress({ stage: "cleanup" });
    await withDeadline(firestore.terminate(), "cleanup-firestore", 5000)
      .catch(() => progress({ stage: "cleanup-firestore-timeout" }));
    await withDeadline(deleteApp(app), "cleanup-app", 5000)
      .catch(() => progress({ stage: "cleanup-app-timeout" }));
  }
}

if (require.main === module) main().then(() => process.exit(0), (error) => {
  process.stderr.write(`RATE FLOOR showcase sync failed (${String(error.code || error.name || "error")}, stage=${String(error.stage || "setup")}).\n`,
    () => process.exit(1));
});

module.exports = { migrate, parseArguments, loadProfileNormalizer, visibleEntry, withDeadline, main, MIGRATION_ID };
