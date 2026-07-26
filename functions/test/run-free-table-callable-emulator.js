"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PROJECT_ID = "demo-free-table-callable-e2e";
const repositoryRoot = path.resolve(__dirname, "..", "..");
const command = [
  "npx --yes firebase-tools@15.24.0 emulators:exec",
  "--only auth,database,firestore,functions",
  `--project ${PROJECT_ID}`,
  "--config firebase.json",
  "\"npm --prefix functions run test:free-table-callable-emulator:run\"",
].join(" ");
const result = spawnSync(command, {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    RUN_FREE_TABLE_CALLABLE_E2E_TESTS: "1",
    FREE_TABLE_CALLABLE_E2E_PROJECT_ID: PROJECT_ID,
  },
  shell: true,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`Free table Callable E2E was terminated by ${result.signal}.`);
}
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
