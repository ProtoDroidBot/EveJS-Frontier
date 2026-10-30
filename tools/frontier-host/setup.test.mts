import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setup, setupPlan } from "./setup.mjs";
import { clientPlan } from "./client.mjs";
import { resolveHostPaths } from "./config.mjs";
import { PHASE4_SOURCE_HASHES } from "../frontier-static/lib/static-schema.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier setup workflow "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "server/src/config"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "server/src/config/clientBuildCatalog.json"), path.join(root, "server/src/config/clientBuildCatalog.json"));
  return root;
}

function historicalClientFixture(root: string, build: number) {
  const source = path.join(root, "retail client", "nebula");
  fs.mkdirSync(path.join(root, "retail client/ResFiles"), { recursive: true });
  for (const file of ["code.ccp", "manifest.dat", "resfileindex.txt", "bin64/staticdata/mapObjects.db",
    "bin64/cacert.pem", "bin64/packages/certifi/cacert.pem", "bin64/blue.pyd", "bin64/exefile.exe"]) {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file === "resfileindex.txt" ? "" : "fixture");
  }
  fs.writeFileSync(path.join(source, "start.ini"), `[main]\nappname=FRONTIER\nbuild=${build}\nsync=${build}\n`);
  return source;
}

test("Windows and Linux setup share dependency ordering and the standalone stage adapter", t => {
  const root = fixture(t);
  const source = path.join(root, "retail client résumé");
  const staging = path.join(root, "isolated stages");
  for (const platform of ["linux", "win32"] as const) {
    const plan = setupPlan(root, { build: "3502403", clientRoot: source, stagingBase: staging,
      python: "/selected/python", wineRunner: "/selected/wine", winePrefix: "/extraction/prefix", winePython: "/wine/python.exe",
      copyResfiles: true, cleanStage: true }, platform);
    assert.deepEqual(plan.slice(0, 3).map(step => step.args), [["ci", "--include=dev", "--ignore-scripts"], ["ci"], ["run", "build"]]);
    assert.equal(plan[1].cwd, path.join(root, "server"));
    assert.deepEqual(plan.slice(3, 5).map(step => step.action), ["sqlite", "certificates"]);
    assert.equal(plan[5].program, "pnpm");
    const python = path.join(root, platform === "win32" ? "_local/frontier-python312/Scripts/python.exe" : "_local/frontier-python312-linux/bin/python");
    const stage = clientPlan(root, ["stage", "--build", "3502403", "--python", python,
      "--source-root", source, "--staging-base", staging, "--copy-resfiles", "--clean"], platform);
    const { label, ...invocation } = plan.at(-1);
    assert.deepEqual(invocation, stage);
    assert.ok(plan.findIndex(step => step.action === "validate-data") < plan.length - 1);
    const extract = plan.find(step => step.args?.some(arg => arg.endsWith("extract-frontier-static.mjs")));
    assert.equal(extract.env.EVEJS_FRONTIER_PYTHON312, platform === "win32" ? python : path.resolve("/wine/python.exe"));
    assert.equal(extract.env.EVEJS_FRONTIER_WINE, platform === "win32" ? process.env.EVEJS_FRONTIER_WINE : path.resolve("/selected/wine"));
    assert.equal(plan.some(step => step.args?.some(arg => arg.endsWith("SetupFrontierWindows.ps1"))), false);
  }
});

test("setup reuses complete selected data and repairs older collision baselines on both platforms", t => {
  const root = fixture(t), paths = resolveHostPaths(root, "3502403");
  function write(file: string, value: unknown) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
  write(path.join(paths.staticRoot, "frontier-extraction-manifest.json"), { source: { client: { build: 3502403 } } });
  write(path.join(paths.contractsRoot, "frontier-contract-manifest.json"), { source: { build: 3502403 } });
  write(path.join(paths.generatedRoot, "manifest.json"), { build: 3502403 });
  write(path.join(paths.generatedRoot, "frontier-database-validation.json"), {});
  fs.mkdirSync(paths.generatedData, { recursive: true });
  const options = { build: "3502403", clientRoot: "/retail/client", skipStage: true, skipDapp: true,
    wineRunner: "/wine", winePrefix: "/prefix", winePython: "/wine/python.exe" };
  for (const platform of ["linux", "win32"] as const) {
    const plan = setupPlan(root, options, platform);
    for (const tool of ["extract-frontier-static.mjs", "build-frontier-database.mjs"]) {
      assert.ok(plan.find(step => step.args?.some(arg => arg.endsWith(tool)))?.args.includes("--force"));
    }
  }
  write(path.join(paths.staticRoot, "assets/collision/bundle.collision"), "snapshot");
  write(path.join(paths.generatedAssets, "collision/bundle.collision"), "baseline");
  const reused = setupPlan(root, options, "linux");
  assert.equal(reused.some(step => step.args?.some(arg => /(?:extract-frontier-static|build-frontier-database|export-frontier-contracts)\.mjs$/.test(arg))), false);
  assert.ok(reused.some(step => step.action === "validate-data"));
  write(path.join(paths.contractsRoot, "frontier-contract-manifest.json"), { source: { build: 3640684 } });
  assert.throws(() => setupPlan(root, options, "win32"), /differs from contracts manifest/);
});

test("server-only setup preview needs no client and creates no local state", async t => {
  const root = fixture(t);
  const report = await setup(root, { build: "3502403", serverOnly: true, skipDapp: true, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.steps.length, 5);
  assert.equal(fs.existsSync(path.join(root, "_local")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});

test("historical setup checks extraction support before runtimes or dependency mutations", async t => {
  const root = fixture(t);
  const source = historicalClientFixture(root, 2702949);
  const before = fs.readdirSync(root, { recursive: true });
  for (const dryRun of [true, false]) {
    await assert.rejects(setup(root, { build: "2702949", clientRoot: source, python: "/unusable/python",
      skipStage: true, skipDapp: true, dryRun }), /build 2702949 is recognized.*bin64\/bundle\.collision.*creation_templates/);
    assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
    assert.equal(fs.existsSync(path.join(root, "_local")), false);
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  }
});

test("cached Phase 4 setup reuses attested data without Wine or collision upgrades but force validates fresh inputs", async t => {
  const root = fixture(t);
  const source = historicalClientFixture(root, 2703993);
  const paths = resolveHostPaths(root, "2703993");
  const schemaProfile = "frontier-phase4-2703993-v1";
  function write(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  }
  write(path.join(paths.staticRoot, "frontier-extraction-manifest.json"), {
    format: "evejs-frontier-static-v1", schemaProfile, assets: {}, source: {
      client: { build: 2703993 },
      ...Object.fromEntries(Object.entries(PHASE4_SOURCE_HASHES).map(([key, sha256]) => [key, { sha256 }])),
    },
  });
  write(path.join(paths.contractsRoot, "frontier-contract-manifest.json"), { source: { build: 2703993 } });
  write(path.join(paths.generatedRoot, "manifest.json"), { build: 2703993, schemaProfile, assets: {} });
  write(path.join(paths.generatedRoot, "frontier-database-validation.json"), {});
  fs.mkdirSync(paths.generatedData, { recursive: true });
  const before = fs.readdirSync(root, { recursive: true });
  const options = { build: "2703993", clientRoot: source, python: "/unusable/python",
    skipStage: true, skipDapp: true, dryRun: true };

  const report = await setup(root, { ...options });
  assert.equal(report.dryRun, true);
  assert.equal(report.steps.some(step => step.args?.some(arg =>
    /(?:extract-frontier-static|build-frontier-database|export-frontier-contracts)\.mjs$/.test(arg))), false);
  assert.ok(report.steps.some(step => step.args?.some(arg => arg.endsWith("validate-frontier-static.mjs"))));
  assert.ok(report.steps.some(step => step.action === "validate-data"));
  assert.equal(fs.existsSync(path.join(paths.staticRoot, "assets/collision/bundle.collision")), false);
  assert.equal(fs.existsSync(path.join(paths.generatedAssets, "collision/bundle.collision")), false);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);

  // The discovered client is deliberately insufficient for extraction. A
  // forced refresh must examine it instead of trusting the cached provenance,
  // and fail before trying this unusable Python or any package/TLS mutation.
  for (const dryRun of [true, false]) {
    await assert.rejects(setup(root, { ...options, forceData: true, dryRun }),
      /build 2703993 is recognized.*inputs absent from this layout/);
    assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  }
});

test("EVM setup includes private backend preparation without starting a world", t => {
  const root = fixture(t);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "server/src/config/clientBuildCatalog.json"), "utf8"));
  const build = String(catalog.profiles.find(profile => profile.blockchain?.protocol === "evm").clientBuild);
  for (const platform of ["linux", "win32"] as const) {
    const plan = setupPlan(root, { build, clientRoot: "/retail/client", skipStage: true,
      wineRunner: "/wine", winePrefix: "/prefix", winePython: "/wine/python.exe" }, platform);
    assert.equal(plan.at(-1).action, "evm-bridge");
    assert.equal(plan.some(step => ["docker", "efctl"].includes(step.program)), false);
  }
});
