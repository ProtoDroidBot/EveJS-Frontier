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

function writeFixture(root) {
  const source = path.join(root, "3502403");
  const contracts = path.join(source, "world-contracts");
  const deployment = path.join(contracts, "deployments", "localnet");
  const world = path.join(contracts, "contracts", "world");
  fs.mkdirSync(deployment, { recursive: true });
  fs.mkdirSync(world, { recursive: true });
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
  return spawnSync(
    POWERSHELL,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      WORLD_SCRIPT,
      ...args,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
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
