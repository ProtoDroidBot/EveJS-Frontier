#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBuild, resolveBuildProfile } from "./config.mjs";
import { doctor } from "./preflight.mjs";
import { setup } from "./setup.mjs";
import { ensureCertificates } from "./certificates.mjs";
import { runNative } from "./commands.mjs";
import { parseServerArgs } from "./server.mjs";
import { planWorldCommand } from "../../scripts/FrontierWorld/world-arguments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELP = `Usage: npm run frontier:host -- <command> --build <exact-build> [options]

Commands:
  doctor                 Read-only prerequisites, build, data and TLS checks
  setup                  Install native dependencies and prepare exact-build data/client
  certificates           Generate missing game/dApp TLS files; verify existing pairs
  server start|status|stop  Native server and dApp lifecycle
  world up|sync|status|down|restart  Native PowerShell/Docker world lifecycle
  sync                   Alias for world sync
  client <action>        Stage, check, patch, launch, trust, status or stop a client
  stage | launch         Aliases for client stage / client launch

Options for doctor/setup:
  --client-root <path>    Installed Windows Frontier build or launcher-cache root
  --python <path>         Native CPython 3.12 x64 (also EVEJS_FRONTIER_NATIVE_PYTHON312)
  --server-only          Skip client preparation; provide generated data separately
  --dry-run              Describe setup without installing, patching or starting
  --live                 Doctor: additionally check Docker, DNS and default HTTPS trust
  --wine-runner <path>    Explicit Wine runner or extraction wrapper
  --wine-prefix <path>    Explicit extraction prefix (use a disposable prefix)
  --wine-python <path>    Windows CPython 3.12 x64 executable for native FSD loaders
  --staging-base <path>   Client staging directory outside the installation (required on Linux)
  --skip-stage           Prepare data without staging the game
  --skip-dapp            Skip the separate dApp dependency installation
  --copy-resfiles         Copy the resource cache instead of linking it
  --force-data           Explicitly replace exporter-owned generated data
  --clean-stage          Rebuild this build's verified owned client stage

Client options: npm run frontier:host -- client --help
Build selection is always explicit. Wine/browser trust is a separate step.`;

const WORLD_HELP = `Usage: npm run frontier:host -- world <up|sync|status|down|restart> --build <exact-build> [options]

Options: --source-root, --destination-root, --dapp-root, --efctl-path,
  --npc-faction-config-path, --npc-faction-sde-path (all take a value)
  --dry-run, --skip-rpc-validation, --skip-docker-ownership-check,
  --skip-npc-faction-funding, --skip-dapp-sync
Existing PowerShell option spellings are also accepted.
Use -- before supported efctl arguments (for example --debug).`;

export function parseOptions(args: string[]) {
  const options: Record<string, any> = {};
  const booleans = new Set(["server-only", "dry-run", "live", "skip-stage", "skip-dapp", "copy-resfiles", "force-data", "clean-stage"]);
  const values = new Set(["build", "client-root", "python", "wine-runner", "wine-prefix", "wine-python", "staging-base"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const name = flag.slice(2);
    const key = name.replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    if (!flag.startsWith("--") || (!booleans.has(name) && !values.has(name))) throw new Error(`Unknown option: ${flag}`);
    if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
    if (booleans.has(name)) options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      options[key] = value;
    }
  }
  options.build = parseBuild(options.build);
  // Preserve the established spelling in SetupOptions.
  options.copyResfiles = options.copyResfiles === true;
  return options;
}

export function windowsServerPlan(repoRoot: string, options: ReturnType<typeof parseServerArgs>) {
  const profile = resolveBuildProfile(repoRoot, options.build);
  const action = options.command;
  const args = ["-NoLogo", "-NoProfile", "-File", path.join(repoRoot, action === "stop" ? "StopFrontier.ps1" : "StartFrontierServer.ps1"), "-Build", options.build];
  if (action === "stop") args.push("-ServerOnly");
  else {
    if (action === "status") args.push("-Status");
    args.push("-ClientVersion", Number(profile.clientVersion).toFixed(2), "-MachoVersion", String(profile.machoVersion),
      "-Codename", profile.clientCodename, "-Birthday", String(profile.eveBirthday ?? 170472),
      "-Region", profile.projectRegion || "ccp", "-ProjectVersion", profile.projectVersion || "V20.04@ccp");
  }
  if (options.background) args.push("-Background");
  if (options.reset) args.push("-ResetRuntime");
  if (options.initializeOnly) args.push("-InitializeOnly");
  if (options.dryRun) args.push("-DryRun");
  if (options.quiet && action === "start") args.push("-Quiet");
  return { args, env: { ...process.env, EVEJS_CLIENT_BUILD_PROFILE: profile.runtimeProfileId, EVEJS_CLIENT_BUILD: options.build } };
}

export async function main(args: string[], repoRoot = REPO_ROOT) {
  const [command, ...rest] = args;
  if (!command || ["--help", "-h", "help"].includes(command)) { console.log(HELP); return 0; }
  if (["client", "stage", "launch"].includes(command)) {
    const client = await import("./client.mjs");
    return client.main(command === "client" ? rest : [command, ...rest], repoRoot);
  }
  if (command === "server") {
    if ((rest.length === 1 && ["--help", "-h"].includes(rest[0])) || (rest.length === 2 && ["start", "status", "stop"].includes(rest[0]) && ["--help", "-h"].includes(rest[1]))) {
      console.log("Usage: npm run frontier:host -- server <start|status|stop> --build <exact-build> [--background] [--reset-runtime] [--initialize-only] [--dry-run] [--quiet]");
      return 0;
    }
    const options = parseServerArgs([...rest]);
    resolveBuildProfile(repoRoot, options.build);
    if (process.platform === "win32") {
      const plan = windowsServerPlan(repoRoot, options);
      runNative("pwsh", plan.args, { cwd: repoRoot, env: plan.env });
      return 0;
    }
    const server = await import("./server.mjs");
    return (await server.main(rest, repoRoot)) ?? 0;
  }
  if (command === "world" || command === "sync") {
    if ((rest.length === 1 && ["--help", "-h", "help", "-?"].includes(rest[0])) || (command === "world" && rest.length === 2 && ["up", "sync", "status", "down", "restart"].includes(rest[0]) && ["--help", "-h", "-?"].includes(rest[1]))) { console.log(WORLD_HELP); return 0; }
    const plan = planWorldCommand(command === "sync" ? ["sync", ...rest] : rest, repoRoot);
    resolveBuildProfile(repoRoot, plan.build);
    runNative("pwsh", plan.args, { cwd: repoRoot, env: { ...process.env, EVEJS_CLIENT_BUILD: plan.build } });
    return 0;
  }
  if (!["doctor", "setup", "certificates"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (rest.length === 1 && ["--help", "-h"].includes(rest[0])) { console.log(HELP); return 0; }
  const options = parseOptions(rest);
  resolveBuildProfile(repoRoot, options.build);
  if (command === "doctor") {
    const report = await doctor(repoRoot, options as any);
    console.log(JSON.stringify(report, null, 2));
    return report.ready ? 0 : 1;
  }
  if (command === "setup") console.log(JSON.stringify(await setup(repoRoot, options as any), null, 2));
  else {
    if (options.dryRun) console.log(JSON.stringify({ build: options.build, dryRun: true, trustInstalled: false }));
    else console.log(JSON.stringify(ensureCertificates(repoRoot), null, 2));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(`[frontier-host] ${error.message}`); process.exitCode = error.exitCode || 1;
  });
}
