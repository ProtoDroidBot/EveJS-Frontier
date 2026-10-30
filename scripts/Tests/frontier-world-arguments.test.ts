import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = path.resolve(__dirname, "../..");
const planner = import("../FrontierWorld/world-arguments.mjs");

test("world wrappers translate PowerShell and GNU options into the same invocation", async () => {
  const { planWorldCommand } = await planner;
  const modern = planWorldCommand(["sync", "--build", "3640684", "--source-root", "C:\\Frontier World\\",
    "--destination-root", "/tmp/résumé 世界", "--dapp-root", "/tmp/dapp", "--efctl-path", "/tmp/efctl",
    "--npc-faction-config-path", "/tmp/factions.json", "--npc-faction-sde-path", "/tmp/factions.jsonl",
    "--dry-run", "--skip-rpc-validation", "--skip-docker-ownership-check", "--skip-npc-faction-funding", "--skip-dapp-sync"], REPO_ROOT);
  const legacy = planWorldCommand(["sync", "-bUiLd", "3640684", "-SourceRoot", "C:\\Frontier World\\",
    "-DestinationRoot", "/tmp/résumé 世界", "-DappRoot", "/tmp/dapp", "-EfctlPath", "/tmp/efctl",
    "-NpcFactionConfigPath", "/tmp/factions.json", "-NpcFactionSdePath", "/tmp/factions.jsonl",
    "-DryRun", "-SkipRpcValidation", "-SkipDockerOwnershipCheck", "-SkipNpcFactionFunding", "-SkipDappSync"], REPO_ROOT);
  assert.deepEqual(modern, legacy);
  assert.equal(modern.build, "3640684");
  assert.deepEqual(modern.args.slice(0, 7), ["-NoLogo", "-NoProfile", "-File", path.join(REPO_ROOT, "FrontierWorld.ps1"), "sync", "-Build", "3640684"]);
  assert.ok(modern.args.includes("C:\\Frontier World\\"));
  assert.ok(modern.args.includes("/tmp/résumé 世界"));
});

test("world command identity cannot be changed by aliases or passthrough arguments", async () => {
  const { planWorldCommand } = await planner;
  for (const args of [
    ["up"],
    ["up", "--build", "3502403", "-Build", "3640684"],
    ["up", "--build", "3502403", "--", "-Build", "3640684"],
    ["up", "--build", "3502403", "--", "--build", "3640684"],
    ["sync", "--build", "../3502403"],
    ["up", "--build", "3502403", "--", "--workspace", "/tmp/other"],
    ["up", "--build", "3502403", "--help"],
  ]) assert.throws(() => planWorldCommand(args, REPO_ROOT));
  assert.throws(() => planWorldCommand(["sync", "--build", "3502403", "--source-root"], REPO_ROOT), /Missing value/);
});

test("world efctl forwarding retains action guards with and without a separator", async () => {
  const { planWorldCommand } = await planner;
  for (const action of ["up", "restart"]) {
    const flags = ["--with-frontend", "--with-graphql=false", "--debug"];
    const direct = planWorldCommand([action, "--build", "3502403", ...flags], REPO_ROOT);
    const separated = planWorldCommand([action, "--build", "3502403", "--", ...flags], REPO_ROOT);
    assert.deepEqual(direct, separated);
    assert.deepEqual(direct.args.slice(-3), flags);
    assert.deepEqual(planWorldCommand([action, "-Build", "3502403", ...flags.slice(0, 2), "-Debug"], REPO_ROOT), direct);
  }
  for (const url of ["http://127.0.0.1:9000", "https://localhost:9000/"]) {
    const plan = planWorldCommand(["status", "--build", "3502403", "--rpc-url", url, "--debug"], REPO_ROOT);
    assert.deepEqual(plan.args.slice(-3), ["--rpc-url", url, "--debug"]);
  }
  for (const args of [
    ["sync", "--debug"], ["down", "--with-frontend"], ["status", "--with-graphql"],
    ["status", "--rpc-url"], ["status", "--rpc-url=ftp://localhost/"], ["status", "--rpc-url", "relative"],
    ["up", "--with-graphql=maybe"],
  ]) assert.throws(() => planWorldCommand([args[0], "--build", "3502403", ...args.slice(1)], REPO_ROOT));
});

test("legacy shell world entry uses the host workflow and preserves explicit builds and arguments", { skip: process.platform === "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier world wrapper "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(REPO_ROOT, "FrontierWorld.sh"), path.join(root, "FrontierWorld.sh"));
  fs.writeFileSync(path.join(root, "FrontierHost.sh"), '#!/usr/bin/env bash\nprintf "%s\\0" "$@"\n');
  const cases = [
    { input: [], output: ["world", "sync", "--build", "3502403"] },
    { input: ["up", "--with-graphql"], output: ["world", "up", "--build", "3502403", "--with-graphql"] },
    { input: ["sync", "-Build", "3640684", "-SourceRoot", "/tmp/World With Spaces"], output: ["world", "sync", "-Build", "3640684", "-SourceRoot", "/tmp/World With Spaces"] },
    { input: ["UP", "-bUiLd", "3640684"], output: ["world", "up", "-bUiLd", "3640684"] },
    { input: ["-Build", "3640684"], output: ["world", "sync", "-Build", "3640684"] },
    { input: ["--help"], output: ["world", "--help"] },
  ];
  for (const { input, output } of cases) {
    const result = spawnSync("bash", [path.join(root, "FrontierWorld.sh"), ...input], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.split("\0").slice(0, -1), output);
  }
});

test("host world and sync alias invoke the shared adapter with exact identity and literal arguments", { skip: process.platform !== "linux" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier host world adapter "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const powershell = path.join(root, "pwsh");
  fs.writeFileSync(powershell, `#!/usr/bin/env bash
exec "$EVEJS_TEST_WORLD_NODE" -e 'console.log(JSON.stringify({args:process.argv.slice(1),build:process.env.EVEJS_CLIENT_BUILD}))' -- "$@"
`, { mode: 0o755 });
  function run(args: string[]) {
    const env = { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`,
      EVEJS_TEST_WORLD_NODE: process.execPath, EVEJS_CLIENT_BUILD: "3502403", EVEJS_CLIENT_BUILD_PROFILE: "auto" };
    return spawnSync(process.execPath, [path.join(REPO_ROOT, "tools/frontier-host/index.mjs"), ...args], {
      encoding: "utf8", env, timeout: 15000,
    });
  }
  const source = '/tmp/World With Spaces/résumé 世界/literal"quote\\';
  for (const args of [
    ["world", "sync", "--build", "3502403", "--source-root", source, "--dry-run", "--skip-dapp-sync"],
    ["world", "sync", "-Build", "3502403", "-SourceRoot", source, "-DryRun", "-SkipDappSync"],
    ["sync", "--build", "3502403", "--source-root", source, "--dry-run", "--skip-dapp-sync"],
  ]) {
    const result = run(args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), { build: "3502403", args: ["-NoLogo", "-NoProfile", "-File",
      path.join(REPO_ROOT, "FrontierWorld.ps1"), "sync", "-Build", "3502403", "-SourceRoot", source, "-DryRun", "-SkipDappSync"] });
  }
  const helpPath = run(["world", "sync", "--build", "3502403", "--source-root", "help", "--dry-run"]);
  assert.equal(helpPath.status, 0, helpPath.stderr || helpPath.stdout);
  assert.equal(JSON.parse(helpPath.stdout).args.at(-2), "help");
  for (const tail of [["-Build", "3640684"], ["--build", "3640684"], ["--workspace", "/tmp/other"], ["--help"]]) {
    const result = run(["world", "up", "--build", "3502403", "--", ...tail]);
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported efctl argument/);
    assert.equal(result.stdout, "");
  }
});
