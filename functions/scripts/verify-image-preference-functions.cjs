"use strict";

// Read-only deployed revision/log checks and unauthenticated callable probes.
// Credentials remain in memory/headers. Function config and log bodies are not saved.
const fs = require("node:fs/promises");
const path = require("node:path");
const { UserRefreshClient } = require("google-auth-library");
const PROJECT = "gazostadium";
const REGION = "us-central1";
const TARGETS = Object.freeze([
  "economyAction", "redeemAchievementCode", "valueMarketAction", "anjuPayFleaAction",
  "danwakuNoteAction", "aiTextTrainingAction", "rouletteTrainingAction", "valueMarketRankings",
  "playerSafetyAction", "cleanupPlayerSafety", "soloSessionAction", "soloFamiliarAction",
  "matchAchievementShowcase", "cleanupStrategyMatchAchievementFreezes",
]);
const SCHEDULED = new Set(["cleanupPlayerSafety", "cleanupStrategyMatchAchievementFreezes"]);

async function createAdminReader() {
  const modulePath = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!modulePath || !path.isAbsolute(modulePath)) throw new Error("Firebase CLI auth module required.");
  const auth = require(modulePath);
  const api = require(path.join(path.dirname(modulePath), "api.js"));
  const account = auth.getProjectDefaultAccount(path.resolve(__dirname, "../..")) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI login unavailable.");
  const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Access token unavailable.");
  return async function admin(url, data) {
    const response = await fetch(url, {
      method: data ? "POST" : "GET", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error(`Admin verification HTTP ${response.status}`);
    return response.json();
  };
}

function metadataUrl(name) {
  if (!TARGETS.includes(name)) throw new Error("Unexpected function target.");
  return `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`;
}

async function main() {
  const deployedAfter = process.argv[2];
  if (process.argv.length !== 3 || !deployedAfter || !Number.isFinite(Date.parse(deployedAfter))) {
    throw new Error("Deployment start timestamp required as the only argument.");
  }
  const admin = await createAdminReader();
  const functions = await Promise.all(TARGETS.map(async (name) => {
    try {
      const data = await admin(metadataUrl(name));
      let boundary = null;
      if (!SCHEDULED.has(name)) {
        const response = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
          signal: AbortSignal.timeout(25000),
        });
        const body = await response.json();
        boundary = { httpStatus: response.status, errorStatus: body.error?.status || null,
          ok: response.status === 401 && body.error?.status === "UNAUTHENTICATED" };
      }
      return { name, scheduled: SCHEDULED.has(name), state: data.state, runtime: data.buildConfig?.runtime,
        updatedAt: data.updateTime, revision: data.serviceConfig?.revision, boundary,
        ok: data.state === "ACTIVE" && data.buildConfig?.runtime === "nodejs22"
          && Date.parse(data.updateTime) >= Date.parse(deployedAfter) && (boundary === null || boundary.ok) };
    } catch (error) {
      return { name, scheduled: SCHEDULED.has(name), ok: false, error: error.name };
    }
  }));
  const serviceFilter = TARGETS.map((name) => `resource.labels.service_name="${name.toLowerCase()}"`).join(" OR ");
  const filter = `resource.type="cloud_run_revision" AND timestamp>="${new Date(deployedAfter).toISOString()}" AND (${serviceFilter})`;
  const [errors, startups] = await Promise.all([
    admin("https://logging.googleapis.com/v2/entries:list", { resourceNames: [`projects/${PROJECT}`],
      filter: `${filter} AND severity>=ERROR`, pageSize: 100, orderBy: "timestamp desc" }),
    admin("https://logging.googleapis.com/v2/entries:list", { resourceNames: [`projects/${PROJECT}`],
      filter: `${filter} AND textPayload:"Default STARTUP TCP probe succeeded"`, pageSize: 100, orderBy: "timestamp desc" }),
  ]);
  const report = { checkedAt: new Date().toISOString(), deployedAfter, project: PROJECT, readOnly: true,
    expectedFunctionCount: TARGETS.length, functions,
    logs: { errorCountInWindow: (errors.entries || []).length, errorsTruncated: Boolean(errors.nextPageToken),
      startupServices: [...new Set((startups.entries || [])
        .map((entry) => entry.resource?.labels?.service_name).filter(Boolean))].sort(),
      startupsTruncated: Boolean(startups.nextPageToken) },
    ok: functions.every((value) => value.ok) && !(errors.entries || []).length && !errors.nextPageToken };
  await fs.writeFile(path.join(__dirname, "../docs/IMAGE_PREFERENCE_ACHIEVEMENTS_FUNCTIONS_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { PROJECT, REGION, TARGETS, SCHEDULED, createAdminReader, metadataUrl };
if (require.main === module) main().catch((error) => {
  // Auth and API errors can include request credentials; never print their bodies/messages.
  process.stderr.write(`Function verification failed (${error.name}).\n`);
  process.exitCode = 1;
});
