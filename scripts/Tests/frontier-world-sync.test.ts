"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POWERSHELL = "pwsh";
const WORLD_SCRIPT = path.join(REPO_ROOT, "FrontierWorld.ps1");
const probe = process.platform === "win32"
  ? spawnSync(POWERSHELL, ["-NoLogo", "-NoProfile", "-Command", "exit 0"])
  : { status: 1 };
const canRunPowerShell = process.platform === "win32" &&
  !probe.error && probe.status === 0;

const PACKAGE_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const OBJECT_REGISTRY_ID =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const ADMIN_ACL_ID =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const ADMIN_PRIVATE_KEY =
  "suiprivkey1qq4z52329g4z52329g4z52329g4z52329g4z52329g4z52329g4z59sdsxd";
const NPC_PACKAGE_ID = `0x${"4".repeat(64)}`;
const NPC_TYPE_ORIGIN = `0x${"5".repeat(64)}`;
const ACCESS_PACKAGE_ID = `0x${"6".repeat(64)}`;
const ACCESS_TYPE_ORIGIN = `0x${"7".repeat(64)}`;
const NPC_REGISTRY_ID = `0x${"8".repeat(64)}`;
const ACCESS_REGISTRY_ID = `0x${"9".repeat(64)}`;
const CATAPULT_PACKAGE_ID = `0x${"a".repeat(64)}`;
const CATAPULT_REGISTRY_ID = `0x${"b".repeat(64)}`;
const INDUSTRY_PACKAGE_ID = `0x${"c".repeat(64)}`;
const INDUSTRY_REGISTRY_ID = `0x${"d".repeat(64)}`;
const TRANSPONDER_PACKAGE_ID = `0x${"e".repeat(64)}`;
const TRANSPONDER_REGISTRY_ID = `0x${"f".repeat(64)}`;
const ACTION_PACKAGE_ID = `0x${"01".repeat(32)}`;
const ACTION_REGISTRY_ID = `0x${"02".repeat(32)}`;
const INDUSTRY_ACTIONS_PACKAGE_ID = `0x${"03".repeat(32)}`;
const INDUSTRY_ACTIONS_REGISTRY_ID = `0x${"04".repeat(32)}`;
const LOGISTICS_PACKAGE_ID = `0x${"05".repeat(32)}`;
const LOGISTICS_REGISTRY_ID = `0x${"06".repeat(32)}`;
const INFRASTRUCTURE_PACKAGE_ID = `0x${"07".repeat(32)}`;
const INFRASTRUCTURE_REGISTRY_ID = `0x${"08".repeat(32)}`;
const AUTOMATION_PACKAGE_ID = `0x${"09".repeat(32)}`;
const AUTOMATION_REGISTRY_ID = `0x${"0a".repeat(32)}`;
const ENERGY_MANIFEST = {
  schemaVersion: 1,
  clientBuild: 3502403,
  assemblies: [{ typeID: 88092, name: "Network Node", energyRequired: 0 }],
};

function npcManifest(overrides = {}) {
  return {
    schemaVersion: 3,
    chainId: "a1b2c3d4",
    worldPackageId: PACKAGE_ID,
    objectRegistryId: OBJECT_REGISTRY_ID,
    adminAclId: ADMIN_ACL_ID,
    packageId: NPC_PACKAGE_ID,
    typeOrigin: NPC_TYPE_ORIGIN,
    npcRegistryId: NPC_REGISTRY_ID,
    accessPackageId: ACCESS_PACKAGE_ID,
    accessTypeOrigin: ACCESS_TYPE_ORIGIN,
    accessRegistryId: ACCESS_REGISTRY_ID,
    catapultPackageId: CATAPULT_PACKAGE_ID,
    catapultTypeOrigin: CATAPULT_PACKAGE_ID,
    catapultRegistryId: CATAPULT_REGISTRY_ID,
    industryPackageId: INDUSTRY_PACKAGE_ID,
    industryTypeOrigin: INDUSTRY_PACKAGE_ID,
    industryRegistryId: INDUSTRY_REGISTRY_ID,
    transponderPackageId: TRANSPONDER_PACKAGE_ID,
    transponderTypeOrigin: TRANSPONDER_PACKAGE_ID,
    transponderRegistryId: TRANSPONDER_REGISTRY_ID,
    actionPackageId: ACTION_PACKAGE_ID,
    actionTypeOrigin: ACTION_PACKAGE_ID,
    actionRegistryId: ACTION_REGISTRY_ID,
    industryActionsPackageId: INDUSTRY_ACTIONS_PACKAGE_ID,
    industryActionsTypeOrigin: INDUSTRY_ACTIONS_PACKAGE_ID,
    industryActionsRegistryId: INDUSTRY_ACTIONS_REGISTRY_ID,
    logisticsPackageId: LOGISTICS_PACKAGE_ID,
    logisticsTypeOrigin: LOGISTICS_PACKAGE_ID,
    logisticsRegistryId: LOGISTICS_REGISTRY_ID,
    infrastructurePackageId: INFRASTRUCTURE_PACKAGE_ID,
    infrastructureTypeOrigin: INFRASTRUCTURE_PACKAGE_ID,
    infrastructureRegistryId: INFRASTRUCTURE_REGISTRY_ID,
    automationPackageId: AUTOMATION_PACKAGE_ID,
    automationTypeOrigin: AUTOMATION_PACKAGE_ID,
    automationRegistryId: AUTOMATION_REGISTRY_ID,
    ...overrides,
  };
}

function migratedWorldFeatureManifest(legacy) {
  const migrated = { ...legacy };
  if (migrated.schemaVersion < 2) {
    migrated.actionPackageId = migrated.accessPackageId;
    migrated.actionTypeOrigin = migrated.accessTypeOrigin;
    migrated.actionRegistryId = migrated.accessRegistryId;
    migrated.industryActionsPackageId = migrated.industryPackageId;
    migrated.industryActionsTypeOrigin = migrated.industryTypeOrigin;
    migrated.industryActionsRegistryId = migrated.industryRegistryId;
  }
  if (migrated.schemaVersion < 3) {
    for (const prefix of ["logistics", "infrastructure", "automation"]) {
      migrated[`${prefix}PackageId`] = migrated.actionPackageId;
      migrated[`${prefix}TypeOrigin`] = migrated.actionTypeOrigin;
      migrated[`${prefix}RegistryId`] = migrated.actionRegistryId;
    }
  }
  const specs = {
    npc: ["packageId", "typeOrigin", "npcRegistryId"],
    assemblyAccess: ["accessPackageId", "accessTypeOrigin", "accessRegistryId"],
    catapult: ["catapultPackageId", "catapultTypeOrigin", "catapultRegistryId"],
    smartIndustry: ["industryPackageId", "industryTypeOrigin", "industryRegistryId"],
    transponder: ["transponderPackageId", "transponderTypeOrigin", "transponderRegistryId"],
    actionQueue: ["actionPackageId", "actionTypeOrigin", "actionRegistryId"],
    industryActions: ["industryActionsPackageId", "industryActionsTypeOrigin", "industryActionsRegistryId"],
    logisticsActions: ["logisticsPackageId", "logisticsTypeOrigin", "logisticsRegistryId"],
    infrastructureActions: ["infrastructurePackageId", "infrastructureTypeOrigin", "infrastructureRegistryId"],
    automation: ["automationPackageId", "automationTypeOrigin", "automationRegistryId"],
  };
  const capabilities = {};
  const incompleteCapabilities = [];
  for (const [name, fields] of Object.entries(specs)) {
    const values = fields.map((field) => migrated[field]);
    const present = values.filter((value) => typeof value === "string" && value.length > 0).length;
    if (present === 0) continue;
    if (present !== 3) {
      incompleteCapabilities.push(name);
      continue;
    }
    capabilities[name] = {
      status: "deployed",
      packageId: values[0].toLowerCase(),
      typeOrigin: values[1].toLowerCase(),
      registryId: values[2].toLowerCase(),
    };
  }
  return {
    format: "eve-frontier-world-features",
    schemaVersion: 1,
    chainId: migrated.chainId.toLowerCase(),
    world: {
      packageId: migrated.worldPackageId.toLowerCase(),
      objectRegistryId: migrated.objectRegistryId.toLowerCase(),
      adminAclId: migrated.adminAclId.toLowerCase(),
    },
    capabilities,
    migration: {
      source: "npc-deployment.json",
      sourceSchemaVersion: migrated.schemaVersion,
      incompleteCapabilities: incompleteCapabilities.sort(),
    },
  };
}

function npcSyncFixture(t) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs npc world sync "));
  t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  const source = writeFixture(fixture);
  const destination = path.join(fixture, "evejs", "world");
  const manifestSource = path.join(source, "world-contracts", "deployments", "localnet", "npc-deployment.json");
  const versionedManifestSource = path.join(source, "world-contracts", "deployments", "localnet", "world-features.v1.json");
  const manifestDestination = path.join(destination, "world-features.v1.json");
  const legacyManifestDestination = path.join(destination, "npc-deployment.json");
  const archivedLegacyManifestDestination = path.join(destination, "npc-deployment.legacy.json");
  const configPath = path.join(destination, "world.private.json");
  const common = ["sync", "-SourceRoot", source, "-DestinationRoot", destination,
    "-EfctlPath", writeFakeEfctl(fixture), "-SkipRpcValidation", "-SkipDockerOwnershipCheck"];
  return { source, manifestSource, versionedManifestSource, manifestDestination,
    legacyManifestDestination, archivedLegacyManifestDestination, configPath, destination,
    write: (value) => fs.writeFileSync(manifestSource, JSON.stringify(value)),
    writeVersioned: (value) => fs.writeFileSync(versionedManifestSource, JSON.stringify(value)),
    writeFactionConfig: (relativePath, value) => {
      const target = path.join(path.dirname(versionedManifestSource), relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(value));
    },
    run: (extra = []) => runWorld([...common, ...extra], {}),
  };
}

test("World sync creates missing unified and split configs for every detected SDE faction",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const unifiedPath = path.join(path.dirname(f.source), "npc-factions.config.json");
    const unified = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, "npc-factions.config.json"), "utf8",
    ));
    unified.factions = [unified.factions.find((entry) => entry.factionID === 500001)];
    unified.relations = [];
    fs.writeFileSync(unifiedPath, JSON.stringify(unified));
    const sdePath = path.join(f.source, "_local", "frontier-sde", "3502403", "factions.jsonl");
    fs.mkdirSync(path.dirname(sdePath), { recursive: true });
    fs.writeFileSync(sdePath, [
      JSON.stringify({ _key: 500001, name: { en: "SDE name must not replace authoring" },
        solarSystemID: 30000052 }),
      JSON.stringify({ _key: 500005, name: { en: "Jove Empire" },
        solarSystemID: 30001642 }),
      JSON.stringify({ _key: 500007, name: { en: "Ammatar Mandate" },
        solarSystemID: 30000001 }),
      "",
    ].join("\n"));
    const manifest: any = migratedWorldFeatureManifest(npcManifest());
    delete manifest.migration;
    f.writeVersioned(manifest);
    const args = ["-NpcFactionConfigPath", unifiedPath];
    const preview = f.run([...args, "-DryRun"]);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(fs.existsSync(f.manifestDestination), false);
    assert.equal(JSON.parse(fs.readFileSync(unifiedPath, "utf8")).factions.length, 1);
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const updated = JSON.parse(fs.readFileSync(unifiedPath, "utf8"));
    assert.equal(updated.factions.length, 3);
    assert.equal(updated.factions[0].name, unified.factions[0].name);
    assert.equal(updated.factions[1].transponderSignal, "FACTION500005");
    assert.deepEqual(updated.factions[1].startingRegion,
      { regionID: null, solarSystemIDs: [30001642] });
    const synchronized = JSON.parse(fs.readFileSync(f.manifestDestination, "utf8"));
    assert.deepEqual(Object.keys(synchronized.factionConfig.factions).sort(),
      ["500001-none", "500005-none", "500007-none"]);
    const generated = JSON.parse(fs.readFileSync(path.join(
      f.destination, "factions", "500005-none.v1.json"), "utf8"));
    assert.equal(generated.fallback, "default");
    assert.equal(generated.transponderCode, "FACTION500005");
    assert.deepEqual(generated.startingRegion,
      { regionID: null, solarSystemIDs: [30001642] });
    assert.deepEqual(generated.membership.typeListProfiles,
      unified.defaults.typeMembership.typeListProfiles);
    const again = f.run(args);
    assert.equal(again.status, 0, again.stderr || again.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(unifiedPath, "utf8")), updated);
  });

test("World sync keeps authored split faction policy while adding newly detected peers",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const unifiedPath = path.join(path.dirname(f.source), "npc-factions.config.json");
    const unified = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, "npc-factions.config.json"), "utf8",
    ));
    unified.factions = [unified.factions.find((entry) => entry.factionID === 500001)];
    unified.relations = [];
    fs.writeFileSync(unifiedPath, JSON.stringify(unified));
    const sdePath = path.join(f.source, "_local", "frontier-sde", "3502403", "factions.jsonl");
    fs.mkdirSync(path.dirname(sdePath), { recursive: true });
    fs.writeFileSync(sdePath, `${JSON.stringify({ _key: 500005,
      name: { en: "Jove Empire" }, solarSystemID: 30001642 })}\n`);
    const manifest: any = migratedWorldFeatureManifest(npcManifest());
    delete manifest.migration;
    manifest.factionConfig = {
      default: { id: "default", path: "factions/default.v1.json" },
      factions: { "500001-none": {
        path: "factions/500001-none.v1.json", fallback: "default",
      } },
    };
    f.writeVersioned(manifest);
    f.writeFactionConfig("factions/default.v1.json", {
      format: "eve-frontier-faction-features", schemaVersion: 2,
      configId: "default", capabilities: ["npc", "transponder"],
    });
    f.writeFactionConfig("factions/500001-none.v1.json", {
      format: "eve-frontier-faction-features", schemaVersion: 2,
      factionKey: "500001-none", fallback: "default", capabilities: ["npc"],
      transponderCode: "CALDARI", diplomacy: { allies: [], enemies: [] },
    });
    const result = f.run(["-NpcFactionConfigPath", unifiedPath]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const authored = JSON.parse(fs.readFileSync(path.join(
      f.destination, "factions", "500001-none.v1.json"), "utf8"));
    assert.deepEqual(authored.capabilities, ["npc"]);
    assert.equal(authored.transponderCode, "CALDARI");
    const added = JSON.parse(fs.readFileSync(path.join(
      f.destination, "factions", "500005-none.v1.json"), "utf8"));
    assert.equal("capabilities" in added, false);
    assert.equal(added.transponderCode, "FACTION500005");
  });

function writeFixture(root) {
  const source = path.join(root, "3502403");
  const contracts = path.join(source, "world-contracts");
  const deployment = path.join(contracts, "deployments", "localnet");
  const world = path.join(contracts, "contracts", "world");
  const config = path.join(contracts, "config");
  fs.mkdirSync(deployment, { recursive: true });
  fs.mkdirSync(world, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(source, "efctl.yaml"), "with-graphql: true\n");
  fs.writeFileSync(
    path.join(contracts, ".env"),
    [
      `ADMIN_PRIVATE_KEY=${ADMIN_PRIVATE_KEY}`,
      "PLAYER_A_PRIVATE_KEY=must-not-be-synchronized",
      "PLAYER_B_PRIVATE_KEY=must-not-be-synchronized-either",
      "GOVERNOR_PRIVATE_KEY=must-not-be-synchronized-either",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(deployment, "extracted-object-ids.json"),
    `${JSON.stringify({
      network: "localnet",
      world: {
        packageId: PACKAGE_ID,
        objectRegistry: OBJECT_REGISTRY_ID,
        adminAcl: ADMIN_ACL_ID,
      },
    }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(world, "Pub.localnet.toml"),
    [
      'build-env = "testnet"',
      'chain-id = "a1b2c3d4"',
      "",
      "[[published]]",
      `published-at = "${PACKAGE_ID}"`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(config, "assembly-energy.json"),
    `${JSON.stringify(ENERGY_MANIFEST, null, 2)}\n`,
  );
  return source;
}

function writeFakeEfctl(root) {
  const executable = path.join(root, "fake-efctl.cmd");
  fs.writeFileSync(
    executable,
    [
      "@echo off",
      'if "%~1"=="version" (',
      "  echo efctl v99.0.0 test-fixture",
      "  exit /b 0",
      ")",
      'echo %*>>"%FAKE_EFCTL_LOG%"',
      "exit /b 0",
      "",
    ].join("\r\n"),
  );
  return executable;
}

function runWorld(args, environment) {
  const switches = [];
  if (environment?.EVEJS_TEST_RUN_NPC_FACTION_FUNDING !== "1")
    switches.push("-SkipNpcFactionFunding");
  if (environment?.EVEJS_TEST_RUN_DAPP_SYNC !== "1")
    switches.push("-SkipDappSync");
  const worldArgs = [args[0], ...switches, ...args.slice(1)];
  const childEnvironment = { ...environment };
  delete childEnvironment.EVEJS_TEST_RUN_NPC_FACTION_FUNDING;
  delete childEnvironment.EVEJS_TEST_RUN_DAPP_SYNC;
  return spawnSync(
    POWERSHELL,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      WORLD_SCRIPT,
      ...worldArgs,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...childEnvironment },
    },
  );
}

test(
  "Frontier world sync publishes only validated runtime identity and the admin signer",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world sync "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const efctl = writeFakeEfctl(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const log = path.join(fixture, "efctl.log");

    const result = runWorld([
      "sync",
      "-SourceRoot",
      source,
      "-DestinationRoot",
      destination,
      "-EfctlPath",
      efctl,
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
    ], { FAKE_EFCTL_LOG: log });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const configPath = path.join(destination, "world.private.json");
    const text = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(text);
    assert.equal(config.format, "evejs-frontier-world-sync-v1");
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.state, "ready");
    assert.equal(config.build, 3502403);
    assert.equal(config.chainId, "a1b2c3d4");
    assert.deepEqual(config.world, {
      packageId: PACKAGE_ID,
      objectRegistryId: OBJECT_REGISTRY_ID,
      adminAclId: ADMIN_ACL_ID,
    });
    assert.deepEqual(config.assemblyEnergy, {
      schemaVersion: 1,
      clientBuild: 3502403,
      entries: [{ typeID: 88092, energyRequired: 0 }],
    });
    assert.match(config.artifacts.assemblyEnergySha256, /^[0-9a-f]{64}$/);
    assert.equal(config.adminPrivateKey, ADMIN_PRIVATE_KEY);
    assert.equal(text.includes("PLAYER_A_PRIVATE_KEY"), false);
    assert.equal(text.includes("PLAYER_B_PRIVATE_KEY"), false);
    assert.equal(text.includes("GOVERNOR_PRIVATE_KEY"), false);
    assert.equal(fs.existsSync(log), false, "sync must not run an efctl lifecycle command");
  },
);

test(
  "Frontier world sync refreshes the Smart Assembly dApp from the same deployment",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs dapp world sync "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const deployment = path.join(source, "world-contracts", "deployments", "localnet");
    fs.writeFileSync(
      path.join(deployment, "extracted-object-ids.json"),
      `${JSON.stringify({
        network: "localnet",
        world: {
          packageId: PACKAGE_ID,
          objectRegistry: OBJECT_REGISTRY_ID,
          adminAcl: ADMIN_ACL_ID,
          energyConfig: `0x${"1".repeat(64)}`,
          fuelConfig: `0x${"2".repeat(64)}`,
        },
        features: {
          npc: { packageId: NPC_PACKAGE_ID, registryId: NPC_REGISTRY_ID },
          assemblyAccess: { packageId: ACCESS_PACKAGE_ID, registryId: ACCESS_REGISTRY_ID },
          catapult: { packageId: CATAPULT_PACKAGE_ID, registryId: CATAPULT_REGISTRY_ID },
          smartIndustry: { packageId: INDUSTRY_PACKAGE_ID, registryId: INDUSTRY_REGISTRY_ID },
          transponder: { packageId: TRANSPONDER_PACKAGE_ID, registryId: TRANSPONDER_REGISTRY_ID },
          actionQueue: { packageId: ACTION_PACKAGE_ID, registryId: ACTION_REGISTRY_ID },
          industryActions: {
            packageId: INDUSTRY_ACTIONS_PACKAGE_ID,
            registryId: INDUSTRY_ACTIONS_REGISTRY_ID,
          },
          logisticsActions: {
            packageId: LOGISTICS_PACKAGE_ID,
            registryId: LOGISTICS_REGISTRY_ID,
          },
          infrastructureActions: {
            packageId: INFRASTRUCTURE_PACKAGE_ID,
            registryId: INFRASTRUCTURE_REGISTRY_ID,
          },
          automation: {
            packageId: AUTOMATION_PACKAGE_ID,
            registryId: AUTOMATION_REGISTRY_ID,
          },
        },
      }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(deployment, "world-features.v1.json"),
      `${JSON.stringify(migratedWorldFeatureManifest(npcManifest()), null, 2)}\n`,
    );

    const dappRoot = path.join(fixture, "smart-assembly-control");
    fs.mkdirSync(path.join(dappRoot, "scripts"), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, "smart-assembly-control", "scripts", "configure-local.mjs"),
      path.join(dappRoot, "scripts", "configure-local.mjs"),
    );
    const result = runWorld([
      "sync",
      "-SourceRoot",
      source,
      "-DestinationRoot",
      path.join(fixture, "evejs", "world"),
      "-DappRoot",
      dappRoot,
      "-EfctlPath",
      writeFakeEfctl(fixture),
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
    ], { EVEJS_TEST_RUN_DAPP_SYNC: "1" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Synced Smart Assembly dApp configuration/);

    const sourceRecord = JSON.parse(
      fs.readFileSync(path.join(dappRoot, ".deployment-source.json"), "utf8"),
    );
    assert.equal(
      path.resolve(sourceRecord.worldDir),
      path.resolve(source, "world-contracts"),
    );
    assert.equal(sourceRecord.network, "localnet");
    const publicEnvironment = fs.readFileSync(path.join(dappRoot, ".env.local"), "utf8");
    assert.match(publicEnvironment, new RegExp(NPC_PACKAGE_ID));
    assert.doesNotMatch(publicEnvironment, /PRIVATE_KEY|suiprivkey/);
  },
);

test(
  "Frontier world lifecycle uses the guarded source and invalidates IDs on down",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world lifecycle "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const efctl = writeFakeEfctl(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const configPath = path.join(destination, "world.private.json");
    const log = path.join(fixture, "efctl.log");
    const common = [
      "-SourceRoot",
      source,
      "-DestinationRoot",
      destination,
      "-EfctlPath",
      efctl,
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
    ];

    const up = runWorld(["up", ...common, "--with-graphql"], {
      FAKE_EFCTL_LOG: log,
    });
    assert.equal(up.status, 0, up.stderr || up.stdout);
    assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).state, "ready");
    const upLog = fs.readFileSync(log, "utf8");
    assert.match(upLog, /--config-file/);
    assert.match(upLog, /env up/);
    assert.match(upLog, /--workspace/);
    assert.match(upLog, /--with-graphql/);
    assert.match(upLog, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const down = runWorld(["down", ...common], { FAKE_EFCTL_LOG: log });
    assert.equal(down.status, 0, down.stderr || down.stdout);
    const inactive = fs.readFileSync(configPath, "utf8");
    assert.equal(JSON.parse(inactive).state, "down");
    assert.equal(inactive.includes(ADMIN_PRIVATE_KEY), false);
    assert.match(fs.readFileSync(log, "utf8"), /env down/);

    const beforeDryRun = inactive;
    const dryRun = runWorld(["up", ...common, "-DryRun"], {
      FAKE_EFCTL_LOG: log,
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /Would run:/);
    assert.equal(fs.readFileSync(configPath, "utf8"), beforeDryRun);
  },
);

test(
  "Frontier world restart forwards up-only options only to efctl env up",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world restart "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const efctl = writeFakeEfctl(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const log = path.join(fixture, "efctl.log");

    const result = runWorld([
      "restart",
      "-SourceRoot",
      source,
      "-DestinationRoot",
      destination,
      "-EfctlPath",
      efctl,
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
      "--debug",
      "--with-frontend=false",
      "--with-graphql",
    ], { FAKE_EFCTL_LOG: log });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const commands = fs.readFileSync(log, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    assert.equal(commands.length, 2);
    assert.match(commands[0], /env down/);
    assert.doesNotMatch(commands[0], /--with-/);
    assert.match(commands[0], /--debug/);
    assert.match(commands[1], /env up/);
    assert.match(commands[1], /--debug/);
    assert.match(commands[1], /--with-frontend=false/);
    assert.match(commands[1], /--with-graphql/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(destination, "world.private.json"), "utf8"),
      ).state,
      "ready",
    );
  },
);

test(
  "Frontier world lifecycle rejects no-op and workspace-override arguments",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world args "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const efctl = writeFakeEfctl(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const log = path.join(fixture, "efctl.log");
    const common = [
      "-SourceRoot",
      source,
      "-DestinationRoot",
      destination,
      "-EfctlPath",
      efctl,
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
    ];
    const rejected = [
      ["up", "--help"],
      ["down", "-h"],
      ["up", "-w=elsewhere"],
      ["up", "-welsewhere"],
      ["up", "--workspace=elsewhere"],
      ["up", "--config-file=elsewhere"],
    ];

    for (const [action, argument] of rejected) {
      const result = runWorld([action, ...common, argument], {
        FAKE_EFCTL_LOG: log,
      });
      assert.notEqual(
        result.status,
        0,
        `${action} ${argument} unexpectedly succeeded`,
      );
      assert.match(result.stderr, /Unsupported efctl env/);
    }
    assert.equal(fs.existsSync(log), false, "rejected arguments must not invoke efctl");
    assert.equal(
      fs.existsSync(path.join(destination, "world.private.json")),
      false,
      "rejected arguments must not change synchronized state",
    );
  },
);

test(
  "A failed standalone sync invalidates a previously ready world config",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world stale "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const efctl = writeFakeEfctl(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const configPath = path.join(destination, "world.private.json");
    const common = [
      "sync",
      "-SourceRoot",
      source,
      "-DestinationRoot",
      destination,
      "-EfctlPath",
      efctl,
      "-SkipRpcValidation",
      "-SkipDockerOwnershipCheck",
    ];

    const initial = runWorld(common, {});
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).state, "ready");

    fs.writeFileSync(
      path.join(source, "world-contracts", ".env"),
      "ADMIN_PRIVATE_KEY=not-a-sui-key\n",
      "utf8",
    );
    const failed = runWorld(common, {});
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /ADMIN_PRIVATE_KEY/);
    const inactiveText = fs.readFileSync(configPath, "utf8");
    const inactive = JSON.parse(inactiveText);
    assert.equal(inactive.state, "error");
    assert.equal("world" in inactive, false);
    assert.equal("adminPrivateKey" in inactive, false);
    assert.equal(inactiveText.includes(ADMIN_PRIVATE_KEY), false);
  },
);

test(
  "Frontier world sync rejects malformed or wrong-build assembly energy manifests",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world energy sync "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const manifestPath = path.join(source, "world-contracts", "config", "assembly-energy.json");
    const common = ["sync", "-SourceRoot", source, "-DestinationRoot", destination,
      "-EfctlPath", writeFakeEfctl(fixture), "-SkipRpcValidation", "-SkipDockerOwnershipCheck"];

    for (const invalid of [
      { ...ENERGY_MANIFEST, clientBuild: 1 },
      { ...ENERGY_MANIFEST, assemblies: [
        { typeID: 88092, name: "Network Node", energyRequired: 0 },
        { typeID: 88092, name: "Duplicate", energyRequired: 1 },
      ] },
    ]) {
      fs.writeFileSync(manifestPath, JSON.stringify(invalid));
      const result = runWorld(common, {});
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Assembly energy configuration/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(destination, "world.private.json"), "utf8")).state, "error");
    }
  },
);

test(
  "Frontier world dry-run includes equal NPC faction wallet funding",
  { skip: !canRunPowerShell },
  (t) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs world funding dryrun "));
    t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
    const source = writeFixture(fixture);
    const destination = path.join(fixture, "evejs", "world");
    const result = runWorld([
      "sync", "-DryRun", "-SourceRoot", source, "-DestinationRoot", destination,
      "-EfctlPath", writeFakeEfctl(fixture), "-SkipRpcValidation", "-SkipDockerOwnershipCheck",
    ], { EVEJS_TEST_RUN_NPC_FACTION_FUNDING: "1" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Would top up configured NPC faction wallets/);
    assert.equal(fs.existsSync(path.join(destination, "world.private.json")), false);
  },
);

test("Legacy NPC deployment migrates to the versioned world-feature manifest",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const legacy = npcManifest({ extraSecret: "must-not-copy", chainId: "A1B2C3D4" });
    f.write(legacy);
    fs.mkdirSync(f.destination, { recursive: true });
    fs.writeFileSync(f.legacyManifestDestination, "historical synchronized manifest\n");
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(f.manifestDestination, "utf8")),
      migratedWorldFeatureManifest(legacy),
    );
    const base = JSON.parse(fs.readFileSync(f.configPath, "utf8"));
    assert.equal(base.state, "ready");
    assert.equal(base.world.packageId, PACKAGE_ID);
    assert.equal(base.world.objectRegistryId, OBJECT_REGISTRY_ID);
    assert.equal(base.world.adminAclId, ADMIN_ACL_ID);
    assert.notEqual(base.world.packageId, NPC_PACKAGE_ID);
    assert.doesNotMatch(fs.readFileSync(f.manifestDestination, "utf8"), /must-not-copy|adminPrivateKey/);
    assert.equal(fs.existsSync(f.legacyManifestDestination), false);
    assert.equal(
      fs.readFileSync(f.archivedLegacyManifestDestination, "utf8"),
      "historical synchronized manifest\n",
    );
    assert.doesNotMatch(result.stdout + result.stderr, /must-not-copy/);
  });

test("World-feature migration preserves legacy schema 1 compatibility",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const legacy = npcManifest({ schemaVersion: 1 });
    for (const field of ["actionPackageId", "actionTypeOrigin", "actionRegistryId",
        "industryActionsPackageId", "industryActionsTypeOrigin", "industryActionsRegistryId",
        "logisticsPackageId", "logisticsTypeOrigin", "logisticsRegistryId",
        "infrastructurePackageId", "infrastructureTypeOrigin", "infrastructureRegistryId",
        "automationPackageId", "automationTypeOrigin", "automationRegistryId"]) {
      delete legacy[field];
    }
    f.write(legacy);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(f.manifestDestination, "utf8")),
      migratedWorldFeatureManifest(legacy),
    );
  });

test("World-feature migration preserves legacy schema 2 action-package compatibility",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const schema2 = npcManifest({ schemaVersion: 2 });
    for (const field of ["logisticsPackageId", "logisticsTypeOrigin", "logisticsRegistryId",
      "infrastructurePackageId", "infrastructureTypeOrigin", "infrastructureRegistryId",
      "automationPackageId", "automationTypeOrigin", "automationRegistryId"]) {
      delete schema2[field];
    }
    f.write(schema2);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(f.manifestDestination, "utf8")),
      migratedWorldFeatureManifest(schema2),
    );
  });

test("Versioned world features preserve partial capabilities and faction allowlists",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const manifest: any = migratedWorldFeatureManifest(npcManifest());
    delete manifest.migration;
    manifest.capabilities.catapult = { status: "unavailable" };
    manifest.factionConfig = {
      default: { id: "default", path: "factions/default.v1.json" },
      factions: {
        "500001-caldari": {
          path: "factions/500001-caldari.v1.json", fallback: "default",
        },
        "500010-guristas": {
          path: "factions/500010-guristas.v1.json", fallback: "default",
        },
      },
    };
    f.writeFactionConfig("factions/default.v1.json", {
      format: "eve-frontier-faction-features", schemaVersion: 2,
      configId: "default", capabilities: ["transponder", "npc"],
    });
    f.writeFactionConfig("factions/500001-caldari.v1.json", {
      format: "eve-frontier-faction-features", schemaVersion: 2,
      factionKey: "500001-caldari", fallback: "default",
      transponderCode: "CALDARI",
      membership: {
        includedTypeIDs: [101], excludedTypeIDs: [],
        typeListProfiles: [{
          profileID: "npc-profiles-by-faction", source: "npcProfiles", match: "factionIdentity",
        }],
      },
      diplomacy: {
        allies: [], enemies: [{ factionKey: "500010-guristas", transponderCode: "GURISTAS" }],
      },
      leadership: [], commanders: [],
    });
    f.writeFactionConfig("factions/500010-guristas.v1.json", {
      format: "eve-frontier-faction-features", schemaVersion: 2,
      factionKey: "500010-guristas", fallback: "default", capabilities: ["npc"],
      transponderCode: "GURISTAS",
      diplomacy: {
        allies: [], enemies: [{ factionKey: "500001-caldari", transponderCode: "CALDARI" }],
      },
      leadership: [], commanders: [],
    });
    f.write({ schemaVersion: 999, secret: "ignored legacy sibling" });
    f.writeVersioned(manifest);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const synchronized = JSON.parse(fs.readFileSync(f.manifestDestination, "utf8"));
    assert.deepEqual(synchronized.capabilities.catapult, { status: "unavailable" });
    assert.deepEqual(
      synchronized.factionConfig.factions["500001-caldari"],
      { path: "factions/500001-caldari.v1.json", fallback: "default" },
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(
      path.join(f.destination, "factions", "default.v1.json"), "utf8",
    )).capabilities, ["npc", "transponder"]);
    const caldari = JSON.parse(fs.readFileSync(
      path.join(f.destination, "factions", "500001-caldari.v1.json"), "utf8",
    ));
    assert.equal("capabilities" in caldari, false);
    assert.deepEqual(caldari.membership.includedTypeIDs, [101]);
    assert.equal(caldari.diplomacy.enemies[0].transponderCode, "GURISTAS");
    assert.deepEqual(caldari.leadership, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(
      path.join(f.destination, "factions", "500010-guristas.v1.json"), "utf8",
    )).capabilities, ["npc"]);
    assert.equal("migration" in synchronized, false);
  });

test("World-feature sync rejects mismatched chain and base-world bindings",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    for (const field of ["chainId", "worldPackageId", "objectRegistryId", "adminAclId"]) {
      f.write(npcManifest({ [field]: field === "chainId" ? "deadbeef" : NPC_PACKAGE_ID }));
      const result = f.run();
      assert.notEqual(result.status, 0, field);
      const migratedField = field === "worldPackageId" ? "packageId" : field;
      assert.match(result.stderr, new RegExp(`World feature deployment ${migratedField} does not match`));
      assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
      assert.equal(fs.existsSync(f.manifestDestination), false);
    }
  });

test("World-feature sync rejects malformed schemas and noncanonical or zero addresses",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    for (const invalid of [null, [], npcManifest({ schemaVersion: "3" }), npcManifest({ schemaVersion: 4 }),
      npcManifest({ packageId: "0x4" }), npcManifest({ typeOrigin: `0x${"0".repeat(64)}` }),
      npcManifest({ accessPackageId: "0x6" }), npcManifest({ accessTypeOrigin: `0x${"0".repeat(64)}` }),
      npcManifest({ adminAclId: undefined }), npcManifest({ typeOrigin: 123 })]) {
      f.write(invalid);
      const result = f.run();
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.match(result.stderr, /World feature|Legacy feature|Sui address/);
      assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
      assert.equal(fs.existsSync(f.manifestDestination), false);
    }
    fs.writeFileSync(f.manifestSource, "{private-not-echoed");
    const malformed = f.run();
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /World feature deployment metadata is malformed JSON/);
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /private-not-echoed/);
  });

test("Legacy migration isolates incomplete capabilities without blocking valid capabilities",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const manifest = npcManifest();
    delete manifest.catapultRegistryId;
    f.write(manifest);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const migrated = JSON.parse(fs.readFileSync(f.manifestDestination, "utf8"));
    assert.equal("catapult" in migrated.capabilities, false);
    assert.equal(migrated.capabilities.npc.registryId, NPC_REGISTRY_ID);
    assert.deepEqual(migrated.migration.incompleteCapabilities, ["catapult"]);
  });

test("Absent world-feature source fails closed without deleting a synchronized destination",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    const initial = f.run();
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    const previous = fs.readFileSync(f.manifestDestination, "utf8");
    fs.unlinkSync(f.manifestSource);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /World feature source is absent/);
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previous);
  });

test("World-feature dry-run validates upgrades without changing either destination",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    const initial = f.run();
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    const previousNpc = fs.readFileSync(f.manifestDestination, "utf8");
    const previousWorld = fs.readFileSync(f.configPath, "utf8");
    f.write(npcManifest({ packageId: `0x${"6".repeat(64)}` }));
    const dryRun = f.run(["-DryRun"]);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /Would sync public feature deployment/);
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previousNpc);
    assert.equal(fs.readFileSync(f.configPath, "utf8"), previousWorld);
    f.write(npcManifest({ chainId: "deadbeef" }));
    const invalid = f.run(["-DryRun"]);
    assert.notEqual(invalid.status, 0);
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previousNpc);
    assert.equal(fs.readFileSync(f.configPath, "utf8"), previousWorld);
  });

test("Invalid world-feature metadata preserves previous metadata but invalidates the synchronized world",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    const initial = f.run();
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    const previous = fs.readFileSync(f.manifestDestination, "utf8");
    f.write(npcManifest({ worldPackageId: NPC_PACKAGE_ID }));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previous);
  });

test("World-feature sync refuses to replace a destination directory",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    fs.mkdirSync(f.manifestDestination, { recursive: true });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-file or reparse-point world-feature destination/);
    assert.equal(fs.statSync(f.manifestDestination).isDirectory(), true);
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
  });
