"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  applyClientBuildProfile,
  getClientBuildCatalog,
  getClientBuildProfile,
  getClientBuildProfileForBuild,
  getClientFeatureState,
  getServerBuildFeatureDefinitions,
  getServerBuildFeatures,
  hasServerBuildFeature,
  listClientBuildProfiles,
  resolveClientBuildProfile,
} = require("../src/config/clientBuildProfiles");

const SERVER_FEATURES = ["publicGatewayContracts", "economy", "voxelMining", "progression"];

test("build profiles use exact identity and never infer a nearby build", () => {
  const profile = getClientBuildProfile("frontier-3640684");
  assert.equal(getClientBuildProfileForBuild(3640684), profile);
  assert.equal(getClientBuildProfileForBuild("3640684"), profile);
  for (const build of [3640683, 3640685, 3502403, 0, -1, 3640684.5, NaN, Infinity, null, undefined, "unknown"]) {
    assert.equal(getClientBuildProfileForBuild(build), null, `unexpected profile for ${String(build)}`);
    assert.equal(resolveClientBuildProfile({ clientCompatibilityProfile: "frontier", clientBuild: build }), null);
  }
  assert.equal(resolveClientBuildProfile({ clientCompatibilityProfile: "frontier", clientBuild: 3640684 }), profile);
  assert.equal(resolveClientBuildProfile({ clientCompatibilityProfile: "tranquility", clientBuild: 3640684 }), null);
  assert.equal(resolveClientBuildProfile({ clientBuildProfile: profile.id, clientBuild: 1 }), profile);
});

test("the catalog and exposed feature definitions cannot be mutated", () => {
  const catalog = getClientBuildCatalog();
  const profiles = listClientBuildProfiles();
  assert.equal(profiles.length, 19);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, profiles.length);
  assert.equal(new Set(profiles.map(profile => profile.clientBuild)).size, profiles.length);
  assert.equal(catalog.profiles, profiles);
  for (const value of [catalog, profiles, catalog.features, catalog.features.heat_temperature,
    catalog.featureStates, profiles[0], profiles[0].features]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => profiles.push(profiles[0]), TypeError);
  assert.throws(() => { profiles[0].clientBuild = 1; }, TypeError);
  assert.throws(() => { profiles[0].features.heat_temperature = "C"; }, TypeError);
  const definitions = getServerBuildFeatureDefinitions();
  assert.ok(Object.isFrozen(definitions));
  assert.ok(Object.isFrozen(definitions.voxelMining));
  assert.ok(Object.isFrozen(definitions.voxelMining.builds));
  assert.throws(() => definitions.voxelMining.builds.push(3502403), TypeError);
});

test("branch feature gaps remain distinct instead of accumulating by build number", () => {
  for (const feature of ["heat_temperature", "lagrange_occupancy"]) {
    assert.equal(getClientFeatureState(2884873, feature), "C");
    assert.equal(getClientFeatureState(2898485, feature), "A");
    assert.equal(getClientFeatureState(2973163, feature), "C");
  }
  assert.notEqual(getClientBuildProfileForBuild(2884873).clientBranch,
    getClientBuildProfileForBuild(2898485).clientBranch);
});

test("client feature evidence retains all four states independently of server support", () => {
  assert.equal(getClientFeatureState(2455427, "industry_manufacturing"), "C");
  assert.equal(getClientFeatureState("frontier-2702949", "frontier_jump_drive"), "D");
  assert.equal(getClientFeatureState(2455427, "creation_editor"), "A");
  assert.equal(getClientFeatureState(2455427, "manual_flight_integration"), "U");
  assert.equal(getClientFeatureState(3502403, "industry_manufacturing"), "U");
  assert.deepEqual(getServerBuildFeatures(2455427), Object.fromEntries(SERVER_FEATURES.map(feature => [feature, false])));
});

test("implemented server capabilities are enabled only for their exact audited build", () => {
  assert.deepEqual(Object.keys(getServerBuildFeatureDefinitions()), SERVER_FEATURES);
  for (const build of [...listClientBuildProfiles().map(profile => profile.clientBuild), 3502403, 3640683, 3640685, undefined]) {
    const features = getServerBuildFeatures(build);
    assert.ok(Object.isFrozen(features));
    for (const feature of SERVER_FEATURES) {
      assert.equal(features[feature], build === 3640684, `${String(build)}: ${feature}`);
      assert.equal(hasServerBuildFeature(build, feature), build === 3640684);
    }
  }
  assert.equal(hasServerBuildFeature("3640684", "voxelMining"), true);
});

test("explicit profile selection sets audited identity and preserves operator settings", () => {
  const manual = {
    clientBuildProfile: "frontier-2884873", clientCompatibilityProfile: "tranquility",
    clientBuild: 3396210, clientVersion: 24.01, machoVersion: 496,
    projectCodename: "EvEJS", projectVersion: "V24.01@custom", projectRegion: "custom",
    eveBirthday: 170472, staticDataPath: "/custom/static", runtimeDataPath: "/custom/runtime",
    miningEnabled: false, voxelMiningEnabled: false, localChatAuthorityEnabled: false,
  };
  const original = { ...manual };
  const resolved = applyClientBuildProfile(manual);
  const profile = getClientBuildProfile(manual.clientBuildProfile);
  assert.deepEqual(manual, original);
  assert.notEqual(resolved, manual);
  assert.equal(resolved.clientBuildProfile, profile.id);
  assert.equal(resolved.clientCompatibilityProfile, "frontier");
  assert.equal(resolved.clientBuild, profile.clientBuild);
  assert.equal(resolved.clientVersion, profile.clientVersion);
  assert.equal(resolved.machoVersion, profile.machoVersion);
  assert.equal(resolved.projectCodename, profile.clientCodename);
  assert.equal(resolved.projectVersion, "V20.04@custom");
  for (const key of ["eveBirthday", "projectRegion", "staticDataPath", "runtimeDataPath", "miningEnabled", "voxelMiningEnabled", "localChatAuthorityEnabled"]) {
    assert.equal(resolved[key], manual[key], `${key} must remain operator-controlled`);
  }
});

test("auto selection preserves manual boot values even for a catalogued Frontier build", () => {
  const manual = { clientBuildProfile: "auto", clientCompatibilityProfile: "frontier", clientBuild: 3640684,
    clientVersion: 99, machoVersion: 123, projectCodename: "manual", projectVersion: "manual-version" };
  assert.deepEqual(applyClientBuildProfile(manual), manual);
  assert.notEqual(applyClientBuildProfile(manual), manual);
  assert.equal(resolveClientBuildProfile(manual).id, "frontier-3640684");
});

test("invalid profile selections and feature names fail clearly", () => {
  assert.throws(() => getClientBuildProfile("frontier-3640685"), /Unknown client build profile/);
  assert.throws(() => applyClientBuildProfile({ clientBuildProfile: "missing" }), /Unknown client build profile/);
  for (const clientBuildProfile of ["", " ", 3640684]) {
    assert.throws(() => resolveClientBuildProfile({ clientBuildProfile }), /clientBuildProfile/);
  }
  assert.throws(() => getClientFeatureState(3640684, "missing"), /Unknown client feature/);
  assert.throws(() => hasServerBuildFeature(3640684, "missing"), /Unknown server build feature/);
  assert.throws(() => getClientFeatureState(3640684, "toString"), /Unknown client feature/);
  assert.throws(() => hasServerBuildFeature(3640684, "toString"), /Unknown server build feature/);
});

// Config persistence happens at import time. Every integration check runs in a
// child with its own config directory and no inherited EVEJS overrides.
function checkConfig(t, fileConfig, envOverrides, assertions) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-build-profiles-"));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(configDir, "evejs.config.local.json"), JSON.stringify(fileConfig));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("EVEJS_")));
  Object.assign(env, { EVEJS_CONFIG_DIR: configDir }, envOverrides);
  const configPath = path.resolve(__dirname, "../src/config/index.js");
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require("node:assert/strict");
    const config = require(${JSON.stringify(configPath)});
    const snapshot = config.getConfigStateSnapshot();
    ${assertions}
  `], { env, encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `isolated config assertions failed:\n${result.stderr}\n${result.stdout}`);
}

test("startup and config snapshots apply the same explicit profile after environment identity overrides", t => {
  checkConfig(t, { clientBuildProfile: "frontier-2455427", projectRegion: "custom", eveBirthday: 123456 }, {
    EVEJS_CLIENT_BUILD_PROFILE: "frontier-3640684", EVEJS_CLIENT_BUILD: "1",
    EVEJS_CLIENT_VERSION: "99", EVEJS_MACHO_VERSION: "123", EVEJS_PROJECT_CODENAME: "manual",
    EVEJS_PROJECT_VERSION: "manual-version", EVEJS_CLIENT_COMPATIBILITY_PROFILE: "tranquility",
  }, `
    for (const runtime of [config, snapshot.resolvedConfig]) {
      assert.equal(runtime.clientBuildProfile, "frontier-3640684");
      assert.equal(runtime.clientCompatibilityProfile, "frontier");
      assert.equal(runtime.clientBuild, 3640684);
      assert.equal(runtime.clientVersion, 20.04);
      assert.equal(runtime.machoVersion, 489);
      assert.equal(runtime.projectCodename, "cycle-7");
      assert.equal(runtime.projectVersion, "V20.04@custom");
      assert.equal(runtime.projectRegion, "custom");
      assert.equal(runtime.eveBirthday, 123456);
    }
    assert.equal(snapshot.buildProfile.id, "frontier-3640684");
    assert.equal(snapshot.sources.clientBuildProfile, "env");
    assert.equal(snapshot.sources.clientBuild, "profile");
    assert.equal(snapshot.fileConfig.clientBuild, 3396210);
  `);
});

test("environment auto selection disables a file profile without inheriting its resolved identity", t => {
  checkConfig(t, { clientBuildProfile: "frontier-2455427", clientBuild: 3502403, clientVersion: 77,
    machoVersion: 555, projectCodename: "manual", projectVersion: "manual-version",
    clientCompatibilityProfile: "frontier" }, { EVEJS_CLIENT_BUILD_PROFILE: "auto" }, `
    for (const runtime of [config, snapshot.resolvedConfig]) {
      assert.equal(runtime.clientBuildProfile, "auto");
      assert.equal(runtime.clientBuild, 3502403);
      assert.equal(runtime.clientVersion, 77);
      assert.equal(runtime.machoVersion, 555);
      assert.equal(runtime.projectCodename, "manual");
      assert.equal(runtime.projectVersion, "manual-version");
    }
    assert.equal(snapshot.buildProfile, null);
    assert.equal(snapshot.fileConfig.clientBuild, 3502403);
    assert.equal(snapshot.sources.clientBuild, "local");
  `);
});

test("config validation registers known profiles and rejects unknown selection", t => {
  checkConfig(t, {}, {}, `
    const definition = config.getConfigDefinitions().find(entry => entry.key === "clientBuildProfile");
    assert.equal(definition.defaultValue, "auto");
    assert.equal(definition.envVar, "EVEJS_CLIENT_BUILD_PROFILE");
    assert.ok(definition.allowedValues.includes("frontier-3640684"));
    const validBaseValues = Object.fromEntries(config.getConfigDefinitions().map(entry => [
      entry.key, entry.defaultValue === "" ? "test" : entry.defaultValue,
    ]));
    const selected = config.buildValidatedConfigValues({ clientBuildProfile: "frontier-3640684" }, { baseValues: validBaseValues });
    assert.equal(selected.clientBuildProfile, "frontier-3640684");
    assert.equal(selected.clientBuild, validBaseValues.clientBuild);
    assert.equal(selected.clientCompatibilityProfile, validBaseValues.clientCompatibilityProfile);
    assert.throws(() => config.buildValidatedConfigValues({ clientBuildProfile: "frontier-missing" }, { baseValues: validBaseValues }), /clientBuildProfile/);
  `);
});

test("saving a selected profile retains manual boot fields so auto can restore them", t => {
  checkConfig(t, { clientBuildProfile: "auto", clientBuild: 3502403, clientVersion: 77,
    machoVersion: 555, projectCodename: "manual", projectVersion: "manual-version",
    clientCompatibilityProfile: "tranquility", projectRegion: "custom", eveBirthday: 123456,
    miningEnabled: false, voxelMiningEnabled: false }, {}, `
    const manualBoot = Object.fromEntries([
      "clientBuild", "clientVersion", "machoVersion", "projectCodename", "projectVersion",
      "clientCompatibilityProfile", "projectRegion", "eveBirthday", "miningEnabled", "voxelMiningEnabled",
    ].map(key => [key, snapshot.fileConfig[key]]));
    const validBaseValues = Object.fromEntries(config.getConfigDefinitions().map(entry => [
      entry.key, snapshot.fileConfig[entry.key] === "" ? "test" : snapshot.fileConfig[entry.key],
    ]));
    const selected = config.saveLocalConfig({ ...validBaseValues, clientBuildProfile: "frontier-3640684" });
    assert.equal(selected.resolvedConfig.clientBuild, 3640684);
    assert.equal(selected.resolvedConfig.clientCompatibilityProfile, "frontier");
    assert.equal(selected.buildProfile.id, "frontier-3640684");
    assert.equal(selected.localRawConfig.clientBuildProfile, "frontier-3640684");
    for (const [key, value] of Object.entries(manualBoot)) {
      assert.equal(selected.fileConfig[key], value, key + " editable value changed");
      assert.equal(selected.localRawConfig[key], value, key + " persisted value changed");
    }
    const restored = config.saveLocalConfig({ clientBuildProfile: "auto" });
    assert.equal(restored.resolvedConfig.clientBuildProfile, "auto");
    assert.equal(restored.buildProfile, null);
    for (const [key, value] of Object.entries(manualBoot)) {
      assert.equal(restored.resolvedConfig[key], value, key + " manual value was not restored");
      assert.equal(restored.localRawConfig[key], value, key + " persisted value changed");
    }
  `);
});
