import fs from "node:fs";
import path from "node:path";
import { assertNodeVersion, assertNoSymlink, resolveBuildProfile, resolveHostPaths } from "./config.mjs";
import { ensureCertificates } from "./certificates.mjs";
import { resolvePython312, probeSqlite } from "./preflight.mjs";
import { runNative } from "./commands.mjs";
import { readBuildManifest, validatePreparedData } from "./data.mjs";
import { discoverFrontierClients, selectBuild } from "../frontier-static/lib/frontier-client-discovery.mjs";

export type SetupOptions = { build: string; clientRoot?: string; python?: string; wineRunner?: string; winePrefix?: string;
  winePython?: string; stagingBase?: string; serverOnly?: boolean; skipStage?: boolean; skipDapp?: boolean; forceData?: boolean;
  copyResfiles?: boolean; dryRun?: boolean };
type SetupStep = { label: string; program?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv; action?: "certificates" | "sqlite" | "validate-data" };

export function setupPlan(repoRoot: string, options: SetupOptions, platform = process.platform): SetupStep[] {
  const paths = resolveHostPaths(repoRoot, options.build);
  resolveBuildProfile(repoRoot, options.build);
  if (platform === "win32" && !options.serverOnly) {
    const args = ["-NoLogo", "-NoProfile", "-File", path.join(repoRoot, "SetupFrontierWindows.ps1"), "-Build", paths.build, "-NonInteractive"];
    if (options.clientRoot) args.push("-SourceRoot", path.resolve(options.clientRoot));
    if (options.skipStage) args.push("-SkipStage");
    if (options.copyResfiles) args.push("-CopyResFiles");
    if (options.forceData) args.push("-ForceData");
    return [
      { label: "Prepare the exact Windows client/server build", program: "pwsh", args, cwd: repoRoot },
      { label: "Generate or verify game and dApp TLS pairs", action: "certificates" },
      ...(!options.skipDapp ? [{ label: "Install pinned dApp dependencies", program: "pnpm", args: ["--dir", path.join(repoRoot, "smart-assembly-control"), "install", "--frozen-lockfile"], cwd: repoRoot }] : []),
      { label: "Verify exact static data, contracts and generated database", action: "validate-data" },
    ];
  }
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
  if (!options.clientRoot) throw new Error("Linux client preparation requires --client-root, or use --server-only with already prepared data.");
  const python = options.python || process.env.EVEJS_FRONTIER_NATIVE_PYTHON312 || "python3.12";
  const environment = path.join(repoRoot, "_local/frontier-python312-linux");
  assertNoSymlink(environment);
  const venvPython = path.join(environment, "bin/python");
  steps.push(
    { label: "Create native CPython 3.12 analysis environment", program: python, args: ["-m", "venv", environment], cwd: repoRoot },
    { label: "Install pinned client analysis dependencies", program: venvPython, args: ["-m", "pip", "install", "-r", path.join(repoRoot, "tools/frontier-client/requirements-windows-frontier.txt")], cwd: repoRoot },
  );
  const commonArgs = ["--client-root", path.resolve(options.clientRoot), "--build", paths.build];
  const force = options.forceData ? ["--force"] : [];
  const node = (label: string, file: string, args: string[], env?: NodeJS.ProcessEnv) => steps.push({ label, program: process.execPath, args: [path.join(repoRoot, file), ...args], cwd: repoRoot, env });
  const extractionManifest = path.join(paths.staticRoot, "frontier-extraction-manifest.json");
  for (const [file, kind] of [
    [extractionManifest, "static"],
    [path.join(paths.contractsRoot, "frontier-contract-manifest.json"), "contracts"],
    [path.join(paths.generatedRoot, "manifest.json"), "database"],
  ] as [string, "static" | "contracts" | "database"][]) {
    if (fs.existsSync(file) && !options.forceData) readBuildManifest(file, paths.build, kind);
  }
  if (!fs.existsSync(extractionManifest) || options.forceData) {
    if (!options.wineRunner || !options.winePython || !options.winePrefix) throw new Error("Static extraction requires --wine-runner, --wine-prefix and --wine-python; Wine is used only for Windows loaders.");
    node("Extract exact Windows static data through Wine", "tools/frontier-static/extract-frontier-static.mjs", [...commonArgs, ...force], {
      ...process.env, EVEJS_FRONTIER_WINE: path.resolve(options.wineRunner), EVEJS_FRONTIER_PYTHON312: path.resolve(options.winePython), WINEPREFIX: path.resolve(options.winePrefix),
    });
  }
  node("Validate the selected static snapshot", "tools/frontier-static/validate-frontier-static.mjs", ["--snapshot", paths.staticRoot]);
  if (!fs.existsSync(path.join(paths.contractsRoot, "frontier-contract-manifest.json")) || options.forceData) {
    node("Export exact public contracts using native Python", "tools/frontier-contracts/export-frontier-contracts.mjs", [...commonArgs, ...force], { ...process.env, EVEJS_FRONTIER_PYTHON312: venvPython });
  }
  if (!fs.existsSync(path.join(paths.generatedRoot, "frontier-database-validation.json")) || options.forceData) {
    node("Generate the build's immutable server baseline", "tools/frontier-static/build-frontier-database.mjs", ["--snapshot", paths.staticRoot, "--out", paths.generatedData, ...force]);
  }
  steps.push({ label: "Verify exact static data, contracts and generated database", action: "validate-data" });
  if (!options.skipStage) {
    if (!options.stagingBase) throw new Error("Linux client staging requires an explicit --staging-base outside the source installation.");
    steps.push({ label: "Copy and patch an isolated Windows client stage", program: venvPython, cwd: repoRoot, args: [
      path.join(repoRoot, "tools/frontier-client/frontier_linux_client.py"), "stage", "--build", paths.build,
      "--source-root", path.resolve(options.clientRoot), "--staging-base", path.resolve(options.stagingBase),
      "--node", process.execPath, ...(options.copyResfiles ? ["--copy-resfiles"] : []),
    ] });
  }
  return steps;
}

export async function setup(repoRoot: string, options: SetupOptions) {
  assertNodeVersion();
  if (options.clientRoot && !options.serverOnly) {
    const client = selectBuild(discoverFrontierClients({ clientRoot: options.clientRoot }), Number(options.build));
    if (client.platform !== "windows") throw new Error("Select a Windows Frontier client for Windows/Wine setup.");
    options.clientRoot = client.buildRoot;
  }
  const steps = setupPlan(repoRoot, options);
  if (options.dryRun) return { build: options.build, dryRun: true, steps: steps.map(({ env, ...step }) => ({ ...step, ...(env ? { environmentOverrides: Object.keys(env).filter(key => ["EVEJS_FRONTIER_WINE", "EVEJS_FRONTIER_PYTHON312", "WINEPREFIX"].includes(key)) } : {}) })) };
  if (!options.serverOnly && process.platform === "linux") options.python = resolvePython312(options.python);
  // Resolve the interpreter before installing anything; reconstruct the plan
  // with its verified executable so PATH changes cannot select Python 3.13.
  for (const step of setupPlan(repoRoot, options)) {
    console.log(`[frontier-host] ${step.label}`);
    if (step.action === "sqlite") probeSqlite(repoRoot);
    else if (step.action === "certificates") ensureCertificates(repoRoot);
    else if (step.action === "validate-data") await validatePreparedData(repoRoot, options.build);
    else runNative(step.program, step.args, { cwd: step.cwd, env: step.env });
  }
  return { build: options.build, dependenciesPrepared: true, dataPrepared: !options.serverOnly, worldStarted: false, trustInstalled: false };
}
