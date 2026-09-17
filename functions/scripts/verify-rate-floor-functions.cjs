"use strict";

// Read-only deployed revision/log checks and unauthenticated callable probes.
// Credentials remain in memory/headers. Function config and log bodies are not saved.
const fs = require("node:fs/promises");
const path = require("node:path");
const { UserRefreshClient } = require("google-auth-library");
const TARGETS = ["economyAction", "redeemAchievementCode", "playerSafetyAction", "cleanupPlayerSafety",
  "valueMarketAction", "danwakuNoteAction", "aiTextTrainingAction", "rouletteTrainingAction", "valueMarketRankings"];

async function main() {
  const deployedAfter = process.argv[2];
  if (!deployedAfter || !Number.isFinite(Date.parse(deployedAfter))) throw new Error("Deployment start timestamp required.");
  const modulePath = process.env.FIREBASE_TOOLS_AUTH_MODULE;
  if (!modulePath || !path.isAbsolute(modulePath)) throw new Error("Firebase CLI auth module required.");
  const auth = require(modulePath);
  const api = require(path.join(path.dirname(modulePath), "api.js"));
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLI login unavailable.");
  const client = new UserRefreshClient(api.clientId(), api.clientSecret(), account.tokens.refresh_token);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Access token unavailable.");
  async function admin(url, data) {
    const response = await fetch(url, { method: data ? "POST" : "GET", signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    if (!response.ok) throw new Error(`Admin verification HTTP ${response.status}`);
    return response.json();
  }
  const functions = await Promise.all(TARGETS.map(async (name) => {
    const data = await admin(`https://cloudfunctions.googleapis.com/v2/projects/gazostadium/locations/us-central1/functions/${name}`);
    let boundary = null;
    if (name !== "cleanupPlayerSafety") {
      const response = await fetch(`https://us-central1-gazostadium.cloudfunctions.net/${name}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: {} }),
        signal: AbortSignal.timeout(25000),
      });
      const body = await response.json();
      boundary = { httpStatus: response.status, errorStatus: body.error?.status,
        ok: response.status === 401 && body.error?.status === "UNAUTHENTICATED" };
    }
    return { name, state: data.state, runtime: data.buildConfig?.runtime, updatedAt: data.updateTime,
      revision: data.serviceConfig?.revision, boundary,
      ok: data.state === "ACTIVE" && data.buildConfig?.runtime === "nodejs22"
        && Date.parse(data.updateTime) >= Date.parse(deployedAfter) && (boundary === null || boundary.ok) };
  }));
  const serviceFilter = TARGETS.map((name) => `resource.labels.service_name="${name.toLowerCase()}"`).join(" OR ");
  const filter = `resource.type="cloud_run_revision" AND timestamp>="${new Date(deployedAfter).toISOString()}" AND (${serviceFilter})`;
  const [errors, startups] = await Promise.all([
    admin("https://logging.googleapis.com/v2/entries:list", { resourceNames: ["projects/gazostadium"],
      filter: `${filter} AND severity>=ERROR`, pageSize: 100, orderBy: "timestamp desc" }),
    admin("https://logging.googleapis.com/v2/entries:list", { resourceNames: ["projects/gazostadium"],
      filter: `${filter} AND textPayload:"Default STARTUP TCP probe succeeded"`, pageSize: 100, orderBy: "timestamp desc" }),
  ]);
  const report = { checkedAt: new Date().toISOString(), deployedAfter, project: "gazostadium", functions,
    logs: { errorCountInWindow: (errors.entries || []).length, errorsTruncated: Boolean(errors.nextPageToken),
      startupServices: [...new Set((startups.entries || []).map((entry) => entry.resource?.labels?.service_name))].sort() },
    ok: functions.every((value) => value.ok) && !(errors.entries || []).length };
  await fs.writeFile(path.join(__dirname, "../docs/RATE_FLOOR_SHOWCASE_FUNCTIONS_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Function verification failed (${error.name}: ${error.message}).\n`); process.exitCode = 1;
});
