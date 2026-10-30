import fs from "node:fs";
import path from "node:path";
import { assertNodeVersion, assertNoSymlink, resolveBuildProfile, resolveHostPaths } from "./config.mjs";
import { ensureCertificates, protectPrivateKey } from "./certificates.mjs";
import { resolvePython312, probeSqlite } from "./preflight.mjs";
import { runNative } from "./commands.mjs";
import { readBuildManifest, validatePreparedData } from "./data.mjs";
import { discoverFrontierClients, selectBuild } from "../frontier-static/lib/frontier-client-discovery.mjs";
import { buildRequest } from "../frontier-static/extract-frontier-static.mjs";
import { resolveStaticSchema, snapshotStaticSchema } from "../frontier-static/lib/static-schema.mjs";
import { clientPlan } from "./client.mjs";

export type SetupOptions = { build: string; clientRoot?: string; python?: string; wineRunner?: string; winePrefix?: string;
  winePython?: string; stagingBase?: string; serverOnly?: boolean; skipStage?: boolean; skipDapp?: boolean; forceData?: boolean;
  copyResfiles?: boolean; cleanStage?: boolean; dryRun?: boolean };
type SetupStep = { label: string; program?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv; action?: "certificates" | "sqlite" | "validate-data" | "evm-bridge" | "python" };

function staticExtractionState(staticRoot: string, build: string, forceData = false) {
  const manifestPath = path.join(staticRoot, "frontier-extraction-manifest.json");
  const exists = fs.existsSync(manifestPath);
  const schema = resolveStaticSchema(build);
  if (exists && !forceData && !schema.collisionBundle) snapshotStaticSchema(readBuildManifest(manifestPath, build, "static"));
  const upgrade = exists && schema.collisionBundle && !fs.existsSync(path.join(staticRoot, "assets/collision/bundle.collision"));
  return { manifestPath, required: !exists || forceData || upgrade, force: forceData || upgrade };
}

export function setupPlan(repoRoot: string, options: SetupOptions, platform = process.platform): SetupStep[] {
  const paths = resolveHostPaths(repoRoot, options.build);
  const profile = resolveBuildProfile(repoRoot, options.build);
  if (!["linux", "win32"].includes(platform)) throw new Error("The portable setup command currently targets Windows and Linux x64.");
  const steps: SetupStep[] = [
    { label: "Install locked root packages without the premature postinstall build", program: "npm", args: ["ci", "--include=dev", "--ignore-scripts"], cwd: repoRoot },
    { label: "Install native server packages and SQLite binding", program: "npm", args: ["ci"], cwd: path.join(repoRoot, "server") },
    { label: "Build server, tools, browser and tests", program: "npm", args: ["run", "build"], cwd: repoRoot },
    { label: "Open and query native SQLite", action: "sqlite" },
    { label: "Generate or verify game and dApp certificate pairs", action: "certificates" },
  ];
  if (!options.skipDapp) steps.push({ label: "Install the pinned Smart Assembly dApp packages", program: "pnpm", args: ["--dir", path.join(repoRoot, "smart-assembly-control"), "install", "--frozen-lockfile"], cwd: repoRoot });
  if (options.serverOnly) return steps;
  if (!options.clientRoot) throw new Error("Client preparation requires --client-root, or use --server-only with already prepared data.");
  const windows = platform === "win32";
  const python = options.python || process.env.EVEJS_FRONTIER_NATIVE_PYTHON312 || (windows ? "python" : "python3.12");
  const environment = path.join(repoRoot, windows ? "_local/frontier-python312" : "_local/frontier-python312-linux");
  assertNoSymlink(environment);
  const venvPython = path.join(environment, windows ? "Scripts/python.exe" : "bin/python");
  if (!fs.existsSync(venvPython)) steps.push({ label: "Create native CPython 3.12 analysis environment", program: python, args: ["-m", "venv", environment], cwd: repoRoot });
  steps.push({ label: "Verify the native CPython 3.12 analysis environment", action: "python", program: venvPython });
  steps.push({ label: "Install pinned client analysis dependencies", program: venvPython, args: ["-m", "pip", "install", "-r", path.join(repoRoot, "tools/frontier-client/requirements-windows-frontier.txt")], cwd: repoRoot });
  const commonArgs = ["--client-root", path.resolve(options.clientRoot), "--build", paths.build];
  const force = options.forceData ? ["--force"] : [];
  const node = (label: string, file: string, args: string[], env?: NodeJS.ProcessEnv) => steps.push({ label, program: process.execPath, args: [path.join(repoRoot, file), ...args], cwd: repoRoot, env });
  const extraction = staticExtractionState(paths.staticRoot, paths.build, options.forceData);
  for (const [file, kind] of [
    [extraction.manifestPath, "static"],
    [path.join(paths.contractsRoot, "frontier-contract-manifest.json"), "contracts"],
    [path.join(paths.generatedRoot, "manifest.json"), "database"],
  ] as [string, "static" | "contracts" | "database"][]) {
    if (fs.existsSync(file) && !options.forceData) readBuildManifest(file, paths.build, kind);
  }
  if (extraction.required) {
    if (!windows && (!options.wineRunner || !options.winePython || !options.winePrefix)) throw new Error("Static extraction requires --wine-runner, --wine-prefix and --wine-python; Wine is used only for Windows loaders.");
    const extractionEnv = windows ? { ...process.env, EVEJS_FRONTIER_PYTHON312: venvPython } : {
      ...process.env, EVEJS_FRONTIER_WINE: path.resolve(options.wineRunner), EVEJS_FRONTIER_PYTHON312: path.resolve(options.winePython), WINEPREFIX: path.resolve(options.winePrefix),
    };
    node("Extract exact Windows static data", "tools/frontier-static/extract-frontier-static.mjs", [...commonArgs, ...(extraction.force ? ["--force"] : [])], extractionEnv);
  }
  node("Validate the selected static snapshot", "tools/frontier-static/validate-frontier-static.mjs", ["--snapshot", paths.staticRoot]);
  if (!fs.existsSync(path.join(paths.contractsRoot, "frontier-contract-manifest.json")) || options.forceData) {
    node("Export exact public contracts using native Python", "tools/frontier-contracts/export-frontier-contracts.mjs", [...commonArgs, ...force], { ...process.env, EVEJS_FRONTIER_PYTHON312: venvPython });
  }
  const upgradeDatabase = fs.existsSync(paths.generatedData) && resolveStaticSchema(paths.build).collisionBundle && !fs.existsSync(path.join(paths.generatedAssets, "collision/bundle.collision"));
  if (!fs.existsSync(path.join(paths.generatedRoot, "frontier-database-validation.json")) || options.forceData || upgradeDatabase) {
    node("Generate the build's immutable server baseline", "tools/frontier-static/build-frontier-database.mjs", ["--snapshot", paths.staticRoot, "--out", paths.generatedData, ...(options.forceData || upgradeDatabase ? ["--force"] : [])]);
  }
  steps.push({ label: "Verify exact static data, contracts and generated database", action: "validate-data" });
  if (profile.blockchain?.protocol === "evm") {
    steps.push({ label: "Prepare the exact build's private EVM-to-Sui backend", action: "evm-bridge" });
  }
  if (!options.skipStage) {
    if (!windows && !options.stagingBase) throw new Error("Linux client staging requires an explicit --staging-base outside the source installation.");
    const stage = clientPlan(repoRoot, ["stage", "--build", paths.build, "--python", venvPython,
      "--source-root", path.resolve(options.clientRoot), ...(options.stagingBase ? ["--staging-base", path.resolve(options.stagingBase)] : []),
      ...(options.copyResfiles ? ["--copy-resfiles"] : []), ...(options.cleanStage ? ["--clean"] : []),
    ], platform);
    if (stage.help) throw new Error("Unexpected help while planning client staging.");
    steps.push({ label: "Copy and patch an isolated Windows client stage", ...stage });
  }
  return steps;
}

export async function setup(repoRoot: string, options: SetupOptions) {
  assertNodeVersion();
  if (options.clientRoot && !options.serverOnly) {
    const client = selectBuild(discoverFrontierClients({ clientRoot: options.clientRoot }), Number(options.build));
    if (client.platform !== "windows") throw new Error("Select a Windows Frontier client for Windows/Wine setup.");
    options.clientRoot = client.buildRoot;
    if (staticExtractionState(resolveHostPaths(repoRoot, options.build).staticRoot, options.build, options.forceData).required) {
      // Discovery accepts historical layouts; extraction has stricter schema
      // requirements. Check those before Python, package installs or TLS writes.
      buildRequest(client, client.clientRoot);
    }
  }
  const steps = setupPlan(repoRoot, options);
  if (options.dryRun) return { build: options.build, dryRun: true, steps: steps.map(({ env, ...step }) => ({ ...step, ...(env ? { environmentOverrides: Object.keys(env).filter(key => ["EVEJS_FRONTIER_WINE", "EVEJS_FRONTIER_PYTHON312", "EVEJS_FRONTIER_NATIVE_PYTHON312", "WINEPREFIX"].includes(key)) } : {}) })) };
  if (!options.serverOnly) options.python = resolvePython312(options.python);
  // Resolve the interpreter before installing anything; reconstruct the plan
  // with its verified executable so PATH changes cannot select Python 3.13.
  for (const step of setupPlan(repoRoot, options)) {
    console.log(`[frontier-host] ${step.label}`);
    if (step.action === "sqlite") probeSqlite(repoRoot);
    else if (step.action === "python") resolvePython312(step.program);
    else if (step.action === "certificates") ensureCertificates(repoRoot);
    else if (step.action === "validate-data") await validatePreparedData(repoRoot, options.build);
    else if (step.action === "evm-bridge") {
      const worldConfigPath = path.resolve(repoRoot, process.env.EVEJS_SUI_WORLD_CONFIG_PATH || resolveHostPaths(repoRoot, options.build).worldConfigPath);
      const out = process.env.EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH ? path.resolve(repoRoot, process.env.EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH) : undefined;
      if (!out && fs.existsSync(worldConfigPath)) {
        const world = JSON.parse(fs.readFileSync(worldConfigPath, "utf8").replace(/^\uFEFF/, ""));
        if (world.legacyEvmBridgePath !== undefined && (!world.legacyEvmBridgePath || !fs.existsSync(path.resolve(path.dirname(worldConfigPath), world.legacyEvmBridgePath)))) {
          throw new Error("Referenced EVM backend secrets are missing; restore them before setup.");
        }
      }
      const { syncLegacyEvmSuiManifest } = await import("../frontier-contracts/sync-legacy-evm-sui.mjs");
      const result = syncLegacyEvmSuiManifest({ build: options.build, worldConfigPath, out, prepareOnly: true });
      if (!result.enabled || String(result.clientBuild) !== options.build || !result.manifestPath) throw new Error("EVM backend preparation selected another build.");
      protectPrivateKey(result.manifestPath);
    }
    else runNative(step.program, step.args, { cwd: step.cwd, env: step.env });
  }
  return { build: options.build, dependenciesPrepared: true, dataPrepared: !options.serverOnly, worldStarted: false,
    trustInstalled: process.platform === "win32" && !options.serverOnly && !options.skipStage };
}
