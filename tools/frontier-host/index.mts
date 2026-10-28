#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBuild, resolveBuildProfile } from "./config.mjs";
import { doctor } from "./preflight.mjs";
import { setup } from "./setup.mjs";
import { ensureCertificates } from "./certificates.mjs";
import { runNative } from "./commands.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELP = `Usage: npm run frontier:host -- <command> --build <exact-build> [options]

Commands:
  doctor                 Read-only prerequisites, build, data and TLS checks
  setup                  Install native dependencies and prepare exact-build data/client
  certificates           Generate missing game/dApp TLS files; verify existing pairs
  server start|status|stop  Native server and dApp lifecycle
  world up|sync|status|down|restart  Native PowerShell/Docker world lifecycle

Options for doctor/setup:
  --client-root <path>    Installed Windows Frontier build or launcher-cache root
  --python <path>         Native CPython 3.12 x64 (also EVEJS_FRONTIER_NATIVE_PYTHON312)
  --server-only          Skip client preparation; provide generated data separately
  --dry-run              Describe setup without installing, patching or starting
  --live                 Doctor: additionally check Docker, DNS and default HTTPS trust
  --wine-runner <path>    Explicit Wine runner or extraction wrapper
  --wine-prefix <path>    Explicit extraction prefix (use a disposable prefix)
  --wine-python <path>    Windows CPython 3.12 x64 executable for native FSD loaders
  --staging-base <path>   Linux-owned client staging directory outside the installation
  --skip-stage           Prepare data without staging the game
  --skip-dapp            Skip the separate dApp dependency installation
  --copy-resfiles         Copy the resource cache instead of linking it
  --force-data           Explicitly replace exporter-owned generated data

Linux game launch: bash PlayFrontierLinux.sh --help
Windows game launch: .\\PlayFrontier.ps1 -Build <exact-build>
No command silently selects the newest client or installs browser/Wine trust.`;

export function parseOptions(args: string[]) {
  const options: Record<string, any> = {};
  const booleans = new Set(["server-only", "dry-run", "live", "skip-stage", "skip-dapp", "copy-resfiles", "force-data"]);
  const values = new Set(["build", "client-root", "python", "wine-runner", "wine-prefix", "wine-python", "staging-base"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const name = flag.slice(2);
    const key = name.replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    if (!flag.startsWith("--") || (!booleans.has(name) && !values.has(name))) throw new Error(`Unknown option: ${flag}`);
    if (booleans.has(name)) options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
      options[key] = value;
    }
  }
  options.build = parseBuild(options.build);
  // Preserve the established spelling in SetupOptions.
  options.copyResfiles = options.copyResfiles === true;
  return options;
}

export async function main(args: string[], repoRoot = REPO_ROOT) {
  const [command, ...rest] = args;
  if (!command || ["--help", "-h", "help"].includes(command)) { console.log(HELP); return 0; }
  if (command === "server") {
    if (process.platform === "win32") {
      const [action, ...serverArgs] = rest;
      if (!["start", "status", "stop"].includes(action)) throw new Error("server requires start, status or stop");
      const translated = ["-NoLogo", "-NoProfile", "-File", path.join(repoRoot, action === "stop" ? "StopFrontier.ps1" : "StartFrontierServer.ps1")];
      if (action === "stop") translated.push("-ServerOnly");
      if (action === "status") translated.push("-Status");
      const flags = { "--background": "-Background", "--reset-runtime": "-ResetRuntime", "--initialize-only": "-InitializeOnly", "--dry-run": "-DryRun", "--quiet": "-Quiet" };
      let build: string;
      for (let index = 0; index < serverArgs.length; index++) {
        const flag = serverArgs[index];
        if (flag === "--build") { build = parseBuild(serverArgs[++index]); translated.push("-Build", build); }
        else if (flags[flag] && (action === "start" || flag === "--dry-run")) translated.push(flags[flag]);
        else throw new Error(`Unknown server option: ${flag}`);
      }
      resolveBuildProfile(repoRoot, parseBuild(build));
      runNative("pwsh", translated, { cwd: repoRoot });
      return 0;
    }
    const server = await import("./server.mjs");
    return (await server.main(rest, repoRoot)) ?? 0;
  }
  if (command === "world") {
    const [action, ...worldArgs] = rest;
    if (!["up", "sync", "status", "down", "restart"].includes(action)) throw new Error("world requires up, sync, status, down or restart");
    const buildIndex = worldArgs.indexOf("--build");
    const build = parseBuild(buildIndex < 0 ? null : worldArgs[buildIndex + 1]);
    resolveBuildProfile(repoRoot, build);
    const translated: string[] = ["-NoLogo", "-NoProfile", "-File", path.join(repoRoot, "FrontierWorld.ps1"), action];
    const supported = { "--build": "-Build", "--source-root": "-SourceRoot", "--destination-root": "-DestinationRoot", "--dapp-root": "-DappRoot", "--efctl-path": "-EfctlPath" };
    for (let index = 0; index < worldArgs.length; index++) {
      const flag = worldArgs[index];
      if (flag === "--") { translated.push(...worldArgs.slice(index + 1)); break; }
      if (flag === "--dry-run") { translated.push("-DryRun"); continue; }
      if (!supported[flag] || !worldArgs[index + 1] || worldArgs[index + 1].startsWith("--")) throw new Error(`Unknown world option or missing value: ${flag}`);
      translated.push(supported[flag], worldArgs[++index]);
    }
    runNative("pwsh", translated, { cwd: repoRoot, env: { ...process.env, EVEJS_CLIENT_BUILD: build } });
    return 0;
  }
  if (!["doctor", "setup", "certificates"].includes(command)) throw new Error(`Unknown command: ${command}`);
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
    console.error(`[frontier-host] ${error.message}`); process.exitCode = 1;
  });
}
