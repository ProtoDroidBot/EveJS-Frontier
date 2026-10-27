"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const runner = path.join(__dirname, "run-isolated-tests.js");
const suites = [
  "compositeAsteroidModel", "compositeMiningScene", "frontierVoxelMiningStore",
  "frontierVoxelMiningRuntime", "frontierVoxelMiningPersistence", "frontierVoxelMiningIntegration",
];

// Each suite has its own attested database and module cache. In particular,
// inventory registry fixtures must not leak between persistence/integration
// suites. Disabling node:test's additional process isolation also exposes all
// individual assertions instead of an aggregate file-only result.
for (const suite of suites) {
  const result = spawnSync(process.execPath, [runner, "--test-isolation=none",
    path.join("server/tests", `${suite}.test.js`)], {
    cwd: root, env: process.env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
