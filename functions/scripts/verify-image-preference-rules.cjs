"use strict";

// Read-only production Rules verification. No application data is read with Admin auth.
// Rules are compared in memory; only hashes and check results are persisted.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createAdminReader } = require("./verify-image-preference-functions.cjs");
const ROOT = path.resolve(__dirname, "../..");
const DATABASE_ORIGIN = "https://gazostadium-default-rtdb.asia-southeast1.firebasedatabase.app";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function privateSnapshotRulesValid(value) {
  const online = value?.rules?.online;
  const snapshots = online?.matchImagePreferenceSnapshots;
  const index = snapshots?.$mode?.[".indexOn"];
  return value?.rules?.[".read"] === false && value?.rules?.[".write"] === false
    && (online?.[".read"] === undefined || online[".read"] === false)
    && (online?.[".write"] === undefined || online[".write"] === false)
    && snapshots?.[".read"] === false && snapshots?.[".write"] === false
    && Array.isArray(index) && index.length === 1 && index[0] === "expiresAt";
}

async function main() {
  const expected = JSON.parse(await fs.readFile(path.join(ROOT, "database.rules.json"), "utf8"));
  const admin = await createAdminReader();
  const live = await admin(`${DATABASE_ORIGIN}/.settings/rules.json`);
  const expectedSha256 = sha256(expected);
  const liveSha256 = sha256(live);
  const rules = { expectedSha256, liveSha256, ok: expectedSha256 === liveSha256 };
  const privatePath = { ok: privateSnapshotRulesValid(expected) && privateSnapshotRulesValid(live) };
  const response = await fetch(`${DATABASE_ORIGIN}/online/matchImagePreferenceSnapshots.json`, {
    method: "GET", signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store",
  });
  // Do not read, print, or persist any response body, even if Rules are unexpectedly open.
  await response.body?.cancel();
  const unauthenticatedRead = { ok: response.status === 401 };
  const report = { checkedAt: new Date().toISOString(), rules, privatePath, unauthenticatedRead,
    ok: rules.ok && privatePath.ok && unauthenticatedRead.ok };
  await fs.writeFile(path.join(__dirname, "../docs/IMAGE_PREFERENCE_ACHIEVEMENTS_RULES_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { canonicalJson, privateSnapshotRulesValid };
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Rules verification failed (${error.name}).\n`);
  process.exitCode = 1;
});
