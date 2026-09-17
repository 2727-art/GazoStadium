"use strict";

// Read-only production metadata preflight. No callable probes or remote writes.
// --write-ledger-env may create the ignored local functions/.env.gazostadium file,
// exclusively with the single audited boolean. It never overwrites an existing file.
const fs = require("node:fs/promises");
const path = require("node:path");
const { PROJECT, TARGETS, createAdminReader, metadataUrl } = require("./verify-image-preference-functions.cjs");
const LEDGER_KEY = "ANJU_PAY_LEDGER_REQUIRED";

function strictBoolean(value) {
  return value === "true" ? true : value === "false" ? false : null;
}

async function createLedgerEnv(value) {
  const destination = path.resolve(__dirname, "../.env.gazostadium");
  try {
    const handle = await fs.open(destination, "wx");
    try { await handle.writeFile(`${LEDGER_KEY}=${value}\n`, "utf8"); }
    finally { await handle.close(); }
    return { requested: true, created: true, matches: true };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await fs.readFile(destination, "utf8");
    const entries = existing.split(/\r?\n/)
      .filter((line) => new RegExp(`^\\s*${LEDGER_KEY}\\s*=`).test(line));
    const match = entries.length === 1
      ? entries[0].match(new RegExp(`^\\s*${LEDGER_KEY}\\s*=\\s*(true|false)\\s*$`))
      : null;
    return { requested: true, created: false, existing: true,
      matches: Boolean(match) && strictBoolean(match[1]) === value };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((argument) => argument !== "--write-ledger-env")) {
    throw new Error("Only --write-ledger-env is supported.");
  }
  const admin = await createAdminReader();
  const functions = await Promise.all(TARGETS.map(async (name) => {
    try {
      const data = await admin(metadataUrl(name));
      const ledgerRequired = strictBoolean(data.serviceConfig?.environmentVariables?.[LEDGER_KEY]);
      return { name, state: data.state, runtime: data.buildConfig?.runtime, updatedAt: data.updateTime,
        revision: data.serviceConfig?.revision, ledgerRequired,
        ok: data.state === "ACTIVE" && data.buildConfig?.runtime === "nodejs22" && ledgerRequired !== null };
    } catch (error) { return { name, ok: false, error: error.name }; }
  }));
  const allValid = functions.every((value) => value.ok);
  const sameBoolean = allValid && new Set(functions.map((value) => value.ledgerRequired)).size === 1;
  const ledgerRequired = sameBoolean ? functions[0].ledgerRequired : null;
  let localEnv = { requested: args.includes("--write-ledger-env"), created: false };
  if (localEnv.requested && sameBoolean) localEnv = await createLedgerEnv(ledgerRequired);
  const report = { checkedAt: new Date().toISOString(), project: PROJECT, remoteReadOnly: true,
    expectedFunctionCount: TARGETS.length, functions,
    ledger: { key: LEDGER_KEY, allPresentAndBoolean: allValid, sameBoolean, value: ledgerRequired },
    localEnv, ok: sameBoolean && (!localEnv.requested || localEnv.matches === true) };
  await fs.writeFile(path.join(__dirname, "../docs/IMAGE_PREFERENCE_ACHIEVEMENTS_PREFLIGHT_QA.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { strictBoolean };
if (require.main === module) main().catch((error) => {
  // Credential-bearing authentication/API errors must not reach logs.
  process.stderr.write(`Function preflight failed (${error.name}).\n`);
  process.exitCode = 1;
});
