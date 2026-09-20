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
const ENERGY_MANIFEST = {
  schemaVersion: 1,
  clientBuild: 3502403,
  assemblies: [{ typeID: 88092, name: "Network Node", energyRequired: 0 }],
};

function npcManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    chainId: "a1b2c3d4",
    worldPackageId: PACKAGE_ID,
    objectRegistryId: OBJECT_REGISTRY_ID,
    adminAclId: ADMIN_ACL_ID,
    packageId: NPC_PACKAGE_ID,
    typeOrigin: NPC_TYPE_ORIGIN,
    accessPackageId: ACCESS_PACKAGE_ID,
    accessTypeOrigin: ACCESS_TYPE_ORIGIN,
    ...overrides,
  };
}

function npcSyncFixture(t) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs npc world sync "));
  t.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  const source = writeFixture(fixture);
  const destination = path.join(fixture, "evejs", "world");
  const manifestSource = path.join(source, "world-contracts", "deployments", "localnet", "npc-deployment.json");
  const manifestDestination = path.join(destination, "npc-deployment.json");
  const configPath = path.join(destination, "world.private.json");
  const common = ["sync", "-SourceRoot", source, "-DestinationRoot", destination,
    "-EfctlPath", writeFakeEfctl(fixture), "-SkipRpcValidation", "-SkipDockerOwnershipCheck"];
  return { manifestSource, manifestDestination, configPath, destination,
    write: (value) => fs.writeFileSync(manifestSource, JSON.stringify(value)),
    run: (extra = []) => runWorld([...common, ...extra], {}),
  };
}

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
  const worldArgs = environment?.EVEJS_TEST_RUN_NPC_FACTION_FUNDING === "1"
    ? args
    : [args[0], "-SkipNpcFactionFunding", ...args.slice(1)];
  const childEnvironment = { ...environment };
  delete childEnvironment.EVEJS_TEST_RUN_NPC_FACTION_FUNDING;
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

test("NPC deployment sync keeps original world identities and copies only public metadata",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest({ extraSecret: "must-not-copy", chainId: "A1B2C3D4" }));
    const result = f.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.manifestDestination, "utf8")), npcManifest());
    const base = JSON.parse(fs.readFileSync(f.configPath, "utf8"));
    assert.equal(base.state, "ready");
    assert.equal(base.world.packageId, PACKAGE_ID);
    assert.equal(base.world.objectRegistryId, OBJECT_REGISTRY_ID);
    assert.equal(base.world.adminAclId, ADMIN_ACL_ID);
    assert.notEqual(base.world.packageId, NPC_PACKAGE_ID);
    assert.doesNotMatch(fs.readFileSync(f.manifestDestination, "utf8"), /must-not-copy|adminPrivateKey/);
    assert.doesNotMatch(result.stdout + result.stderr, /must-not-copy/);
  });

test("NPC deployment sync rejects mismatched chain and base-world bindings",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    for (const field of ["chainId", "worldPackageId", "objectRegistryId", "adminAclId"]) {
      f.write(npcManifest({ [field]: field === "chainId" ? "deadbeef" : NPC_PACKAGE_ID }));
      const result = f.run();
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, new RegExp(`NPC deployment ${field} does not match`));
      assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
      assert.equal(fs.existsSync(f.manifestDestination), false);
    }
  });

test("NPC deployment sync rejects malformed schemas and noncanonical or zero addresses",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    for (const invalid of [null, [], npcManifest({ schemaVersion: "1" }), npcManifest({ schemaVersion: 2 }),
      npcManifest({ packageId: "0x4" }), npcManifest({ typeOrigin: `0x${"0".repeat(64)}` }),
      npcManifest({ accessPackageId: "0x6" }), npcManifest({ accessTypeOrigin: `0x${"0".repeat(64)}` }),
      npcManifest({ adminAclId: undefined }), npcManifest({ typeOrigin: 123 })]) {
      f.write(invalid);
      const result = f.run();
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.match(result.stderr, /NPC deployment/);
      assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
      assert.equal(fs.existsSync(f.manifestDestination), false);
    }
    fs.writeFileSync(f.manifestSource, "{private-not-echoed");
    const malformed = f.run();
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /NPC deployment metadata is malformed JSON/);
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /private-not-echoed/);
  });

test("NPC deployment sync rejects incomplete assembly-access metadata",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    const { accessTypeOrigin: _origin, ...withoutOrigin } = npcManifest();
    f.write(withoutOrigin);
    const missingOrigin = f.run();
    assert.notEqual(missingOrigin.status, 0);
    assert.match(missingOrigin.stderr, /configured together/);
    const { accessPackageId: _package, ...withoutPackage } = npcManifest();
    f.write(withoutPackage);
    const missingPackage = f.run();
    assert.notEqual(missingPackage.status, 0);
    assert.match(missingPackage.stderr, /configured together/);
  });

test("Absent NPC source fails closed without deleting a previously synchronized destination",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    const initial = f.run();
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    const previous = fs.readFileSync(f.manifestDestination, "utf8");
    fs.unlinkSync(f.manifestSource);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NPC deployment source is absent/);
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previous);
  });

test("NPC deployment dry-run validates upgrades without changing either destination",
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
    assert.match(dryRun.stdout, /Would sync public NPC deployment/);
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previousNpc);
    assert.equal(fs.readFileSync(f.configPath, "utf8"), previousWorld);
    f.write(npcManifest({ chainId: "deadbeef" }));
    const invalid = f.run(["-DryRun"]);
    assert.notEqual(invalid.status, 0);
    assert.equal(fs.readFileSync(f.manifestDestination, "utf8"), previousNpc);
    assert.equal(fs.readFileSync(f.configPath, "utf8"), previousWorld);
  });

test("Invalid NPC metadata preserves previous metadata but invalidates the synchronized world",
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

test("NPC deployment sync refuses to replace a destination directory",
  { skip: !canRunPowerShell }, (t) => {
    const f = npcSyncFixture(t);
    f.write(npcManifest());
    fs.mkdirSync(f.manifestDestination, { recursive: true });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-file or reparse-point NPC deployment destination/);
    assert.equal(fs.statSync(f.manifestDestination).isDirectory(), true);
    assert.equal(JSON.parse(fs.readFileSync(f.configPath, "utf8")).state, "error");
  });
