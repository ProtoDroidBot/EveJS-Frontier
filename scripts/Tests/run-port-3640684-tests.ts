"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const suites = [
  "frontierContractProfile", "frontierExplorationIdentity", "frontierExplorationGateway",
  "frontierExplorationRuntime", "frontierExplorationIntegration", "explorationWorld", "explorationUniverseEncoder",
  "frontierCanonicalWorld", "frontierCanonicalLandscapeProfile", "frontierCanonicalRuntimeSelection",
  "frontierManualNavigation364", "frontierDockingPoint", "frontierEconomy3640684",
  "frontierProgressionRuntime", "frontierProgressionIntegration", "frontierClaims",
  "frontierStargate364", "frontierStargatePersistence364", "frontierStructurePublication364",
  "frontierExplorationDiscovery",
  "frontierTemporaryLandscapeProfile", "frontierDungeonContentProfile",
  "frontierTemporaryLandscapeResources", "frontierTemporaryLandscapeNpcs",
  "frontierTemporaryLandscapePolicy", "frontierTemporaryLandscapeRuntime",
  "frontierTemporaryLandscapeResourceIntegration",
  "compositeAsteroidModel", "compositeMiningScene", "frontierVoxelMiningStore",
  "frontierVoxelMiningRuntime", "frontierVoxelMiningPersistence", "frontierVoxelMiningIntegration",
];
if (process.env.FRONTIER_TEMPORARY_TEST_WORLD && process.env.FRONTIER_TEMPORARY_TEST_PROFILE && process.env.FRONTIER_TEMPORARY_TEST_DECODED) {
  suites.push("frontierTemporaryLandscapeFullWorld");
}
// Independent processes/stores prevent stateful module fixtures from leaking
// across domains. A failed suite stops the run and preserves its diagnostics.
for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "run-isolated-tests.js"),
    "--test-isolation=none", path.join("server/tests", `${suite}.test.js`)], {
    cwd: root, env: process.env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
