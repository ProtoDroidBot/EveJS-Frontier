import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseBuild, resolveBuildProfile, resolveHostPaths, assertNodeVersion, assertNoSymlink } from "./config.mjs";
import { parseOptions, windowsServerPlan } from "./index.mjs";
import { parseServerArgs, serverEnvironment, serverPaths } from "./server.mjs";
import { setupPlan } from "./setup.mjs";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("exact build selection rejects missing, traversal, fractional and unsafe values", () => {
  for (const value of [undefined, "", "../3502403", "1.2", "0", "9007199254740992"]) assert.throws(() => parseBuild(value));
  assert.equal(parseBuild(3640684), "3640684");
  const paths = resolveHostPaths("/tmp/host with spaces", 3640684);
  assert.equal(paths.runtimeData, path.resolve("/tmp/host with spaces/_local/frontier-runtime/3640684/gameStore/data"));
});

test("profiles keep exact cycle identity and reject conflicting inherited overrides", () => {
  assert.equal(resolveBuildProfile(REPO, "3640684", {}).clientCodename, "cycle-7");
  assert.equal(resolveBuildProfile(REPO, "3502403", {}).runtimeProfileId, "auto");
  assert.throws(() => resolveBuildProfile(REPO, "3640683", {}), /No exact/);
  assert.throws(() => resolveBuildProfile(REPO, "3640684", { EVEJS_CLIENT_BUILD: "3502403" }), /conflicts/);
  assert.throws(() => resolveBuildProfile(REPO, "3640684", { EVEJS_CLIENT_BUILD_PROFILE: "frontier-3551616" }), /conflicts/);
});

test("native server preflight pins the qualified Node line and architecture", () => {
  assertNodeVersion("24.11.0", "x64");
  assertNodeVersion("24.19.0", "x64");
  for (const version of ["22.0.0", "24.10.9", "25.1.0"]) assert.throws(() => assertNodeVersion(version, "x64"));
  assert.throws(() => assertNodeVersion("24.19.0", "arm64"));
});

test("host CLI rejects absent values and keeps space-containing paths as one value", () => {
  assert.deepEqual(parseOptions(["--build", "3640684", "--client-root", "/tmp/client with spaces", "--dry-run"]), {
    build: "3640684", clientRoot: "/tmp/client with spaces", dryRun: true, copyResfiles: false,
  });
  for (const args of [["--build"], ["--build", "--dry-run"], ["--wat", "x"], ["--build", "1", "--build", "2"]]) assert.throws(() => parseOptions(args));
});

test("server-only Linux setup installs server native modules before compiling", () => {
  const plan = setupPlan(REPO, { build: "3502403", serverOnly: true, skipDapp: true }, "linux");
  assert.deepEqual(plan.slice(0, 3).map(step => step.args), [["ci", "--include=dev", "--ignore-scripts"], ["ci"], ["run", "build"]]);
  assert.equal(plan[1].cwd, path.join(REPO, "server"));
  assert.equal(plan.some(step => step.args?.includes("stage")), false);
});

test("Windows and Linux server dispatch share catalogued identity for every selected build", () => {
  for (const build of ["3366068", "3388875", "3502403", "3551616", "3572727", "3640684"]) {
    const plan = windowsServerPlan(REPO, parseServerArgs(["start", "--build", build]));
    const profile = resolveBuildProfile(REPO, build);
    const linux = serverEnvironment(serverPaths(REPO, build), profile);
    for (const [flag, name] of [["-ClientVersion", "EVEJS_CLIENT_VERSION"], ["-MachoVersion", "EVEJS_MACHO_VERSION"],
      ["-Codename", "EVEJS_PROJECT_CODENAME"], ["-Birthday", "EVEJS_EVE_BIRTHDAY"],
      ["-Region", "EVEJS_PROJECT_REGION"], ["-ProjectVersion", "EVEJS_PROJECT_VERSION"]]) {
      assert.equal(plan.args[plan.args.indexOf(flag) + 1], linux[name], `${build}: ${flag}`);
    }
    assert.equal(plan.env.EVEJS_CLIENT_BUILD_PROFILE, linux.EVEJS_CLIENT_BUILD_PROFILE);
  }
  const stop = windowsServerPlan(REPO, parseServerArgs(["stop", "--build", "3502403", "--dry-run"]));
  assert.ok(stop.args.includes("-ServerOnly"));
  assert.ok(stop.args.includes("-DryRun"));
  assert.equal(stop.args.includes("-Codename"), false);
});

test("private paths reject symlink ancestors without creating destination files", { skip: process.platform === "win32" }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier host ownership "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "real"));
  fs.symlinkSync(path.join(root, "real"), path.join(root, "link"));
  assert.throws(() => assertNoSymlink(path.join(root, "link/new/key.pem")), /symbolic-link/);
  assert.equal(fs.existsSync(path.join(root, "real/new")), false);
});
