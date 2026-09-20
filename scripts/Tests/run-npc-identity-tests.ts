"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DEFAULT_BUILD, parseArgs, resolveBuildInputs } = require("./run-frontier-server-tests");

const { build = DEFAULT_BUILD, help } = parseArgs();
if (help) {
  console.log("Usage: node scripts/Tests/run-npc-identity-tests.js [--build <number>]");
} else {
  const { runtimeRoot, staticRoot } = resolveBuildInputs(build);
  const tests = [
    "npcPilotIdentityStore", "npcIdentityAllocation", "nativeNpcIdentityPersistence",
    "frontierNpcPilotIdentity", "nativeNpcPersistence", "npcStartupIdentitySlots", "beltRatIdentitySlots",
    "frontierSuiCharacterProvisioning", "frontierSuiNpcCharacterProvisioning", "frontierSuiNpcFactionFunding", "frontierSuiNpcIdentitySync",
    "frontierSuiNpcWorldConfig", "frontierSuiNpcProfile",
  ].map(name => `server/tests/${name}.test.js`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "run-isolated-tests.js"), "--test-concurrency=1", ...tests], {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "inherit",
    env: {
      ...process.env,
      EVEJS_CLIENT_BUILD: build,
      EVEJS_CLIENT_COMPATIBILITY_PROFILE: "frontier",
      EVEJS_STATIC_JSONL_ROOT: staticRoot,
      EVEJS_TEST_FRONTIER_FIXTURES: "1",
      EVEJS_TEST_STORE_BASELINE_ROOT: runtimeRoot,
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
