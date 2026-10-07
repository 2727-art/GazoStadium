"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ID = "demo-anju-pay-flea-e2e";
const repositoryRoot = path.resolve(__dirname, "..", "..");
const command = [
  "npx --yes firebase-tools@15.24.0 emulators:exec",
  "--only auth,database,firestore,functions",
  `--project ${PROJECT_ID}`,
  "--config firebase.json --non-interactive",
  // Keep the established npm entry point; both retired callables are exercised.
  // Exit only after tests/hooks finish, even if an SDK leaves background handles.
  '"node --test --test-force-exit --test-timeout=120000 --test-concurrency=1 functions/test/anju-pay-flea-e2e-emulator.test.js"',
].join(" ");
const demoEnvPath = path.resolve(__dirname, "..", `.env.${PROJECT_ID}`);
const demoEnvContents = "ANJU_PAY_LEDGER_REQUIRED=true\n";
let createdDemoEnv = false;
try {
  // CLI params are resolved through project dotenv. Never touch production's
  // file, overwrite an existing fixture, or remove a file owned by another run.
  fs.writeFileSync(demoEnvPath, demoEnvContents, { flag: "wx" });
  createdDemoEnv = true;
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const assignments = [...fs.readFileSync(demoEnvPath, "utf8")
    .matchAll(/^ANJU_PAY_LEDGER_REQUIRED=(.*)$/gm)].map((match) => match[1].trim());
  if (!assignments.length || assignments.some((value) => value !== "true")) {
    throw new Error("The existing demo dotenv must set ANJU_PAY_LEDGER_REQUIRED=true");
  }
}
try {
  const result = spawnSync(command, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      RUN_ANJU_PAY_FLEA_E2E_TESTS: "1",
      ANJU_PAY_FLEA_E2E_PROJECT_ID: PROJECT_ID,
      ANJU_PAY_LEDGER_REQUIRED: "true",
    },
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Retired community mode E2E was terminated by ${result.signal}.`);
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
} finally {
  if (createdDemoEnv) {
    try {
      // Preserve a fixture if another process has replaced its content meanwhile.
      if (fs.readFileSync(demoEnvPath, "utf8") === demoEnvContents) fs.unlinkSync(demoEnvPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
