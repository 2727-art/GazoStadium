"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ID = "demo-training-v5-admin-cache";
const repositoryRoot = path.resolve(__dirname, "..", "..");
const command = [
  "npx --yes firebase-tools@15.24.0 emulators:exec",
  "--only database",
  `--project ${PROJECT_ID}`,
  "--config firebase.json",
  "\"node --test --test-concurrency=1 functions/test/training-session-v5-admin-emulator.test.js\"",
].join(" ");
const result = spawnSync(command, {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    RUN_TRAINING_V5_ADMIN_EMULATOR_TESTS: "1",
    TRAINING_V5_ADMIN_EMULATOR_PROJECT_ID: PROJECT_ID,
  },
  shell: true,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`Training V5 Admin emulator test was terminated by ${result.signal}.`);
}
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
