"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ID = "demo-gazostadium-cost";
const command = [
  "npx --yes firebase-tools@15.24.0 emulators:exec",
  "--only auth,database,firestore,functions",
  `--project ${PROJECT_ID}`,
  "--config firebase.json --non-interactive",
  // Firebase SDK background handles may remain after app deletion. Exit only
  // after all assertions/hooks finish; a timed-out or failed test still fails.
  '"node --test --test-force-exit --test-timeout=120000 --test-concurrency=1 functions/test/anju-pay-functions-integration-emulator.test.js functions/test/solo-session-v2-resource-cleanup-emulator.test.js"',
].join(" ");
// The CLI resolves declared params from dotenv, not the parent process env.
// Create only our demo project's non-secret fixture and preserve existing files.
const demoEnvPath = path.resolve(__dirname, "..", `.env.${PROJECT_ID}`);
let createdDemoEnv = false;
try {
  fs.writeFileSync(demoEnvPath, "ANJU_PAY_LEDGER_REQUIRED=true\n", { flag: "wx" });
  createdDemoEnv = true;
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  if (!/^ANJU_PAY_LEDGER_REQUIRED=true\s*$/m.test(fs.readFileSync(demoEnvPath, "utf8"))) {
    throw new Error("The existing demo dotenv must set ANJU_PAY_LEDGER_REQUIRED=true");
  }
}
try {
  const result = spawnSync(command, {
    cwd: path.resolve(__dirname, "..", ".."),
    env: {
      ...process.env,
      RUN_FIRESTORE_EMULATOR_TESTS: "1",
      ANJU_PAY_FIRESTORE_TEST_PROJECT_ID: PROJECT_ID,
      RUN_FIREBASE_COST_EMULATOR_TESTS: "1",
      FIREBASE_COST_TEST_PROJECT_ID: PROJECT_ID,
      ANJU_PAY_LEDGER_REQUIRED: "true",
    },
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Cost Emulator tests terminated by ${result.signal}`);
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
} finally {
  if (createdDemoEnv) fs.unlinkSync(demoEnvPath);
}
