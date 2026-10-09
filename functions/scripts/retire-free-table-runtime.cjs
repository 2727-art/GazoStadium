"use strict";

// Admin-only operational tool. Defaults to a counts-only, read-only inventory.
// 1. Independently verify the selected deployed source, all five retired callable
//    stubs and the retention-only schedule, recording deploy start and QA finish.
// 2. --initialize-gate --confirm-retired --project gazostadium
//    --deployed-after <deploy-start-ISO> --deployment-verified-at <QA-finish-ISO>
// 3. Wait at least 360 seconds, then --apply --confirm-retired --project gazostadium.
// Metadata confirms the verified deployment has not changed; it does NOT prove
// retirement source semantics. Initialization explicitly attests the separate QA.
// No callable invocation, App Check bypass, account creation or credential output.
const crypto = require("node:crypto");
const path = require("node:path");
const { createFreeTableService } = require("../free-table");
const {
  FREE_TABLE_RETIREMENT_VERSION, FREE_TABLE_RETIREMENT_PROJECT,
  FREE_TABLE_RETIREMENT_GATE_PATH, createFreeTableRetirementDrain,
} = require("../free-table-retirement");

const DATABASE_URL = "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app";
const DEPLOYED_FUNCTIONS = Object.freeze([
  "freeTableAction", "freeTableInviteAction", "freeTableInvitePreview", "freeTablePublicStats",
  "reportFreeTableP2pConnectivity", "cleanupExpiredFreeTables",
]);
const SCHEDULER_JOB = "firebase-schedule-cleanupExpiredFreeTables-us-central1";
const PROGRESS_MARKER = "free-table-retirement";

function stop(code) {
  const error = new Error(`Free table retirement: ${code}.`);
  error.code = code;
  return error;
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) throw stop("invalid-deployment-timestamp");
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw stop("invalid-deployment-timestamp");
  return result;
}

function parseArguments(argv) {
  const options = { project: null, apply: false, initializeGate: false, confirmRetired: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (seen.has(arg)) throw stop("duplicate-option");
    seen.add(arg);
    if (arg === "--project") options.project = argv[++index];
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--initialize-gate") options.initializeGate = true;
    else if (arg === "--confirm-retired") options.confirmRetired = true;
    else if (arg === "--deployed-after") options.deployedAfter = timestamp(argv[++index]);
    else if (arg === "--deployment-verified-at") options.deploymentVerifiedAt = timestamp(argv[++index]);
    else throw stop("unsupported-option");
  }
  if (options.project !== FREE_TABLE_RETIREMENT_PROJECT) throw stop("explicit-gazostadium-project-required");
  if (options.apply && options.initializeGate) throw stop("separate-gate-initialization-from-apply");
  if ((options.apply || options.initializeGate) && !options.confirmRetired) throw stop("explicit-retirement-confirmation-required");
  if (options.initializeGate) {
    if (!options.deployedAfter || !options.deploymentVerifiedAt
        || options.deploymentVerifiedAt < options.deployedAfter) throw stop("deployment-verification-timestamps-required");
  } else if (options.deployedAfter || options.deploymentVerifiedAt) throw stop("timestamps-are-for-gate-initialization-only");
  return options;
}

async function verifyDeployment({ getAccessToken, deployedAfter, deploymentVerifiedAt, fetchImpl = fetch, now = Date.now() }) {
  if (!Number.isSafeInteger(deployedAfter) || !Number.isSafeInteger(deploymentVerifiedAt)
      || deployedAfter <= 0 || deployedAfter > deploymentVerifiedAt || deploymentVerifiedAt > now) {
    throw stop("invalid-deployment-verification-window");
  }
  const credential = await getAccessToken();
  if (!credential?.access_token) throw stop("missing-admin-access-token");
  async function read(url) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${credential.access_token}` },
      signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw stop("deployment-metadata-read-failed");
    return response.json();
  }
  const definitions = await Promise.all(DEPLOYED_FUNCTIONS.map(async (name) => {
    const resource = `projects/${FREE_TABLE_RETIREMENT_PROJECT}/locations/us-central1/functions/${name}`;
    const definition = await read(`https://cloudfunctions.googleapis.com/v2/${resource}`);
    const updatedAt = Date.parse(definition.updateTime || "");
    if (definition.name !== resource || definition.state !== "ACTIVE"
        || definition.buildConfig?.runtime !== "nodejs22" || definition.buildConfig?.entryPoint !== name
        || !Number.isSafeInteger(updatedAt) || updatedAt < deployedAfter || updatedAt > deploymentVerifiedAt
        || typeof definition.serviceConfig?.revision !== "string" || !definition.serviceConfig.revision) {
      throw stop("unverified-function-deployment");
    }
    return { name, updateTime: definition.updateTime, revision: definition.serviceConfig.revision };
  }));
  const schedulerResource = `projects/${FREE_TABLE_RETIREMENT_PROJECT}/locations/us-central1/jobs/${SCHEDULER_JOB}`;
  const scheduler = await read(`https://cloudscheduler.googleapis.com/v1/${schedulerResource}`);
  if (scheduler.name !== schedulerResource || scheduler.state !== "ENABLED"
      || !["every day 04:30", "30 4 * * *"].includes(scheduler.schedule)
      || scheduler.timeZone !== "Asia/Tokyo") throw stop("retention-schedule-unverified");
  const deploymentFingerprint = crypto.createHash("sha256").update(JSON.stringify({
    version: FREE_TABLE_RETIREMENT_VERSION, definitions,
    scheduler: { name: scheduler.name, schedule: scheduler.schedule, timeZone: scheduler.timeZone },
  })).digest("hex");
  return { deploymentFingerprint, functions: definitions.length };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    throw stop("production-command-does-not-accept-emulator-overrides");
  }
  const { initializeApp, applicationDefault, deleteApp } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  const { HttpsError } = require("firebase-functions/v2/https");
  let credential;
  let cliFirestore;
  if (process.env.FIREBASE_TOOLS_AUTH_MODULE) {
    const authModule = process.env.FIREBASE_TOOLS_AUTH_MODULE;
    if (!path.isAbsolute(authModule)) throw stop("absolute-firebase-cli-auth-module-required");
    const auth = require(authModule);
    const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
    if (!account?.tokens?.refresh_token) throw stop("firebase-cli-login-required");
    const api = require(path.join(path.dirname(authModule), "api.js"));
    const { UserRefreshClient } = require("google-auth-library");
    const authClient = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
    credential = { async getAccessToken() {
      const token = await authClient.getAccessToken();
      if (!token.token) throw stop("firebase-cli-access-token-unavailable");
      return { access_token: token.token, expires_in: 3600 };
    } };
    // Only apply needs Firestore, and only established per-session finalization
    // reads/writes it. Dry-run and gate initialization never open Firestore.
    if (options.apply) {
      const { Firestore } = require("@google-cloud/firestore");
      cliFirestore = new Firestore({ projectId: options.project, credentials: {
        type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(),
        refresh_token: account.tokens.refresh_token,
      } });
    }
  } else credential = applicationDefault();
  const app = initializeApp({ projectId: options.project, databaseURL: DATABASE_URL, credential }, PROGRESS_MARKER);
  try {
    const getAccessToken = () => credential.getAccessToken();
    const realtime = require("./player-safety-rtdb-rest").createMigrationRealtimeRest({
      databaseURL: DATABASE_URL, getAccessToken,
    });
    let report;
    if (options.initializeGate) {
      const verified = await verifyDeployment({ getAccessToken, ...options });
      const proposed = { retired: true, version: FREE_TABLE_RETIREMENT_VERSION,
        deployedAfter: options.deployedAfter, deploymentVerifiedAt: options.deploymentVerifiedAt,
        deploymentFingerprint: verified.deploymentFingerprint, quiescedAt: Date.now() };
      const result = await realtime.ref(FREE_TABLE_RETIREMENT_GATE_PATH).transaction((current) => (
        current?.retired === true && current.version === proposed.version
          && current.deploymentFingerprint === proposed.deploymentFingerprint
          && current.deployedAfter === proposed.deployedAfter
          && current.deploymentVerifiedAt === proposed.deploymentVerifiedAt
          && Number.isSafeInteger(current.quiescedAt) && current.quiescedAt > 0
          ? current : proposed
      ));
      report = { project: options.project, initializedGate: result.committed,
        ...result.snapshot.val(), verifiedFunctions: verified.functions };
    } else {
      let lastVerified = null;
      let lastVerifiedAt = 0;
      async function verifyRetired() {
        const marker = (await realtime.ref(FREE_TABLE_RETIREMENT_GATE_PATH).get()).val();
        if (!marker?.deploymentFingerprint) throw stop("retirement-gate-not-initialized");
        if (!lastVerified || Date.now() - lastVerifiedAt >= 30_000) {
          lastVerified = await verifyDeployment({ getAccessToken, deployedAfter: marker.deployedAfter,
            deploymentVerifiedAt: marker.deploymentVerifiedAt });
          lastVerifiedAt = Date.now();
        }
        if (lastVerified.deploymentFingerprint !== marker.deploymentFingerprint) throw stop("deployment-changed-since-verification");
        return marker;
      }
      const service = options.apply ? createFreeTableService({
        firestore: cliFirestore || getFirestore(app), realtime, HttpsError, Timestamp, playerSafety: null,
      }) : null;
      report = await createFreeTableRetirementDrain({ realtime, service, verifyRetired }).run(options);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (options.apply && report.complete !== true) process.exitCode = 2;
    return report;
  } finally {
    if (cliFirestore) await cliFirestore.terminate();
    await deleteApp(app);
  }
}

if (require.main === module) main().catch((error) => {
  // Do not echo payloads, private records, request URLs, token responses or stacks.
  const code = typeof error.code === "string" && /^[a-z0-9-]{1,80}$/.test(error.code) ? error.code : "operation-failed";
  process.stderr.write(`Free table retirement stopped (${code}). Existing completed steps can be retried.\n`);
  process.exitCode = 1;
});

module.exports = { DATABASE_URL, DEPLOYED_FUNCTIONS, SCHEDULER_JOB, parseArguments, verifyDeployment, main };
