import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { clientPlan } from "./client.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stageArgs = ["stage", "--build", "3640684", "--source-root", "/tmp/retail client 世界", "--staging-base", "/tmp/isolated stages"];

test("client help needs no build or platform runtime", () => {
  for (const args of [[], ["help"], ["launch", "--help"]]) assert.match(clientPlan(REPO, args, "darwin").help, /Usage:/);
});

test("Linux client stage dispatch preserves arguments and shares the active Node verifier", () => {
  const plan = clientPlan(REPO, [...stageArgs, "--python", "/tmp/native python", "--copy-resfiles", "--clean", "--dry-run"], "linux");
  assert.equal(plan.program, "/tmp/native python");
  assert.equal(plan.cwd, REPO);
  assert.deepEqual(plan.args, ["-B", path.join(REPO, "tools/frontier-client/frontier_linux_client.py"),
    ...stageArgs, "--copy-resfiles", "--clean", "--dry-run", "--node", process.execPath]);
  assert.equal(plan.args.includes("--python"), false);
});

test("Linux launch forwards the selected Wine prefix and Flatpak runtime unchanged", () => {
  const args = ["launch", "--build", "3640684", "--staged-root", "/tmp/stages/3640684", "--wine-runner", "/tmp/runner path/bin/wine",
    "--wine-prefix", "/tmp/prefix path", "--wine-python", "/tmp/Windows Python/python.exe", "--flatpak-app", "com.usebottles.bottles",
    "--flatpak-bin", "/tmp/flatpak binary", "--session-file", "/tmp/private session", "--background", "--node", "/tmp/native node"];
  const plan = clientPlan(REPO, args, "linux");
  assert.deepEqual(plan.args.slice(2), args);
  assert.equal(plan.args.filter(arg => arg === "--node").length, 1);
});

test("Linux trust requires the public dApp certificate and selected runtime", () => {
  const args = ["trust", "--build", "3640684", "--staged-root", "/tmp/stage", "--wine-runner", "/tmp/wine",
    "--wine-prefix", "/tmp/prefix", "--wine-python", "/tmp/python.exe"];
  assert.throws(() => clientPlan(REPO, args, "linux"), /requires --dapp-cert/);
  assert.ok(clientPlan(REPO, [...args, "--dapp-cert", "/tmp/public cert.pem"], "linux").args.includes("/tmp/public cert.pem"));
});

test("client options fail before dispatch for missing or conflicting identities and unsupported options", () => {
  for (const args of [
    ["launch"], ["stage", "--build", "3640683"], ["stage", "--build", "../3640684"],
    [...stageArgs, "--build", "3502403"], [...stageArgs, "--client-root", "/other"],
    [...stageArgs, "--clean", "--clean"], [...stageArgs, "--python"], [...stageArgs, "--background"],
    ["stage", "--build", "3640684", "--source-root", "--help"],
    ["stop", "--build", "3640684", "--staged-root", "/tmp/stage", "--wine-prefix", "/tmp/prefix"],
  ]) assert.throws(() => clientPlan(REPO, args, "linux"));
  assert.throws(() => clientPlan(REPO, ["launch", "--build", "3640684", "--staged-root", "/tmp/stage"], "linux"), /wine-runner/);
  assert.throws(() => clientPlan(REPO, stageArgs, "darwin"), /macOS/);
});

test("Windows client adapters use the same explicit build and preserve paths as argv entries", () => {
  const stage = clientPlan(REPO, [...stageArgs, "--python", "C:\\Native Python\\python.exe", "--no-patch"], "win32");
  assert.equal(stage.program, "pwsh");
  assert.deepEqual(stage.args, ["-NoLogo", "-NoProfile", "-File", path.join(REPO, "StageFrontierClient.ps1"),
    "-Build", "3640684", "-SourceRoot", "/tmp/retail client 世界", "-StagingBase", "/tmp/isolated stages", "-NoPatch"]);
  assert.equal(stage.env.EVEJS_FRONTIER_NATIVE_PYTHON312, "C:\\Native Python\\python.exe");
  const launch = clientPlan(REPO, ["launch", "--build", "3640684", "--staged-root", "C:\\stages with spaces\\3640684",
    "--session-file", "C:\\private session.args", "--background", "--dry-run"], "win32");
  assert.deepEqual(launch.args.slice(4), ["-Build", "3640684", "-StagedRoot", "C:\\stages with spaces\\3640684",
    "-SessionFile", "C:\\private session.args", "-Background", "-DryRun"]);
});

test("Windows check and process lifecycle remain restricted to the selected client", () => {
  const check = clientPlan(REPO, ["check", "--build", "3640684", "--staged-root", "C:\\stage\\3640684"], "win32");
  assert.ok(check.args.includes("-Check"));
  assert.ok(check.args.includes("-Build"));
  for (const action of ["status", "stop"]) {
    const plan = clientPlan(REPO, [action, "--build", "3640684"], "win32");
    assert.ok(plan.args.includes("-ClientOnly"));
    assert.equal(plan.args.includes("-Status"), action === "status");
  }
  assert.throws(() => clientPlan(REPO, ["check", "--build", "3640684"], "win32"), /requires --staged-root/);
  assert.throws(() => clientPlan(REPO, ["trust", "--build", "3640684"], "win32"), /Windows client trust/);
  assert.throws(() => clientPlan(REPO, [...stageArgs, "--node", "/tmp/node"], "win32"), /Unknown/);
});

test("client alias accepts --client-root without changing the stage adapter", () => {
  const alias = stageArgs.map(arg => arg === "--source-root" ? "--client-root" : arg);
  assert.deepEqual(clientPlan(REPO, alias, "linux"), clientPlan(REPO, stageArgs, "linux"));
  assert.ok(clientPlan(REPO, stageArgs.map(arg => arg === "/tmp/retail client 世界" ? "help" : arg), "linux").args.includes("help"));
});

test("Linux and generic shell launchers share host dispatch and preserve argument boundaries", { skip: process.platform !== "linux" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier wrappers with spaces "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binaries = path.join(root, "bin");
  fs.mkdirSync(binaries);
  fs.writeFileSync(path.join(binaries, "node"), '#!/bin/sh\nexec "$FRONTIER_TEST_NODE" "$@"\n', { mode: 0o700 });
  const entry = path.join(root, "tools/frontier-host/index.mjs");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "import fs from 'node:fs'; fs.writeFileSync(process.env.FRONTIER_TEST_OUTPUT, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.FRONTIER_TEST_EXIT || 0));");
  const output = path.join(root, "arguments.json");
  const wrappers: [string, string[], string[]][] = [
    ["PlayFrontierLinux.sh", [], ["launch"]], ["PlayFrontier.sh", [], ["launch"]],
    ["StageFrontierClientLinux.sh", [], ["stage"]], ["StageFrontierClient.sh", [], ["stage"]],
    ["PatchFrontierClientTrustLinux.sh", [], ["client", "patch"]],
    ["PatchFrontierClientTrustLinux.sh", ["--check"], ["client", "check"]],
    ["TrustFrontierClientLinux.sh", [], ["client", "trust"]],
    ["StopFrontierClientLinux.sh", [], ["client", "stop"]],
    ["StartFrontierServerLinux.sh", [], ["server", "start"]],
    ["StopFrontierLinux.sh", [], ["server", "stop"]],
  ];
  for (const name of new Set(["FrontierHost.sh", ...wrappers.map(([name]) => name)])) fs.copyFileSync(path.join(REPO, name), path.join(root, name));
  const values = ["--build", "3640684", "--staged-root", "/tmp/stage with spaces 世界/3640684", 'literal"quote', "trailing\\"];
  const env = { ...process.env, PATH: `${binaries}${path.delimiter}${process.env.PATH || ""}`, FRONTIER_TEST_NODE: process.execPath, FRONTIER_TEST_OUTPUT: output };
  for (const [name, prefix, command] of wrappers) {
    const result = spawnSync("bash", [path.join(root, name), ...prefix, ...values], { env, encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), [...command, ...values], name);
  }
  const failed = spawnSync("bash", [path.join(root, "PlayFrontier.sh"), ...values], { env: { ...env, FRONTIER_TEST_EXIT: "19" }, encoding: "utf8" });
  assert.equal(failed.status, 19);
});

test("client dispatch preserves child failures and creates no stage during a preview", { skip: process.platform !== "linux" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier client dispatch "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const python = path.join(root, "native python");
  const helper = path.join(root, "capture.cjs");
  const output = path.join(root, "argv.json");
  const stage = path.join(root, "stage");
  fs.writeFileSync(python, '#!/bin/sh\nexec "$FRONTIER_TEST_NODE" "$FRONTIER_TEST_HELPER" "$@"\n', { mode: 0o700 });
  fs.writeFileSync(helper, "require('node:fs').writeFileSync(process.env.FRONTIER_TEST_OUTPUT, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.FRONTIER_TEST_EXIT || 0));");
  const args = [path.join(REPO, "tools/frontier-host/client.mjs"), "stage", "--build", "3640684", "--source-root", path.join(root, "source path"),
    "--staging-base", stage, "--python", python, "--dry-run"];
  const env = { ...process.env, FRONTIER_TEST_NODE: process.execPath, FRONTIER_TEST_HELPER: helper, FRONTIER_TEST_OUTPUT: output };
  const preview = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  assert.ifError(preview.error);
  assert.equal(preview.status, 0, preview.stderr);
  const forwarded = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.ok(forwarded.includes("--dry-run"));
  assert.ok(forwarded.includes(path.join(root, "source path")));
  assert.equal(fs.existsSync(stage), false);
  const failed = spawnSync(process.execPath, args, { env: { ...env, FRONTIER_TEST_EXIT: "17" }, encoding: "utf8" });
  assert.equal(failed.status, 17);
  assert.match(failed.stderr, /exited 17/);
});
