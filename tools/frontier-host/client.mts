import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBuild, resolveBuildProfile } from "./config.mjs";
import { runNative } from "./commands.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CLIENT_HELP = `Usage: npm run frontier:host -- client <command> --build <exact-build> [options]

Commands: stage, patch, check, launch, trust, status, stop

Common options:
  --python <path>         Native CPython 3.12 x64 (or EVEJS_FRONTIER_NATIVE_PYTHON312)
  --staged-root <path>    Exact build's isolated stage (all commands except stage)
  --dry-run              Preview using the platform adapter
  --help                 Show this help without selecting a build

Stage options:
  --source-root <path>    Installed build directory (--client-root is an alias)
  --staging-base <path>   Parent of the build-numbered stage
  --copy-resfiles         Copy the resource cache instead of sharing it
  --clean                Recreate only a verified, owned stage
  --no-patch             Copy without applying client patches

Launch options:
  --settings-profile <name>  Client settings profile
  --session-file <path>      Private captured launcher arguments
  --background              Detach the client

Linux launch/trust also require --wine-runner, --wine-prefix and --wine-python.
Linux trust requires --dapp-cert <public-cert>; --flatpak-app/--flatpak-bin select
a Flatpak runner. --node, --ca, --xmpp-leaf and --gateway-leaf override Linux
verification inputs. Windows launch additionally accepts --use-captured-session
and --server-host 127.0.0.1. Windows trust uses the existing certificate setup.
macOS clients continue to use StageFrontierClient.sh and PlayFrontier.sh.`;

type Invocation = { program: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv; help?: never };
type Help = { help: string; program?: never; args?: never; cwd?: never; env?: never };
export type ClientPlan = Invocation | Help;

const ACTIONS = new Set(["stage", "patch", "check", "launch", "trust", "status", "stop"]);
const SWITCHES = new Set(["dry-run", "copy-resfiles", "clean", "no-patch", "background", "use-captured-session"]);
const COMMON = ["build", "python", "dry-run"];
const STAGE = ["source-root", "staging-base", "copy-resfiles", "clean", "no-patch"];
const LAUNCH = ["settings-profile", "session-file", "background"];
const LINUX_INPUTS = ["node", "ca", "xmpp-leaf", "gateway-leaf"];
const WINE = ["wine-runner", "wine-prefix", "wine-python", "flatpak-app", "flatpak-bin"];

/** Build argv once; platform adapters retain their patch, trust and ownership guards. */
export function clientPlan(repoRoot: string, args: string[], platform = process.platform): ClientPlan {
  const [action, ...rest] = args;
  if (!action || ["--help", "-h", "help"].includes(action) || (ACTIONS.has(action) && rest.length === 1 && ["--help", "-h"].includes(rest[0]))) {
    return { help: CLIENT_HELP };
  }
  if (!ACTIONS.has(action)) throw new Error(`Unknown client command: ${action}`);
  if (!["linux", "win32"].includes(platform)) throw new Error("Canonical client commands currently support Windows and Linux. On macOS use StageFrontierClient.sh or PlayFrontier.sh.");
  const allowed = new Set([...COMMON, ...(action === "stage" ? STAGE : ["staged-root"]),
    ...(action === "launch" ? LAUNCH : []),
    ...(platform === "linux" ? LINUX_INPUTS : []),
    ...(platform === "linux" && ["launch", "trust"].includes(action) ? WINE : []),
    ...(platform === "linux" && action === "trust" ? ["dapp-cert"] : []),
    ...(platform === "win32" && action === "launch" ? ["use-captured-session", "server-host"] : []),
  ]);
  const options = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    const name = flag === "--client-root" && action === "stage" ? "source-root" : flag.slice(2);
    if (!flag.startsWith("--") || !allowed.has(name)) throw new Error(`Unknown ${platform} client ${action} option: ${flag}`);
    if (options.has(name)) throw new Error(`Duplicate option: ${flag}`);
    if (SWITCHES.has(name)) options.set(name, true);
    else {
      const value = rest[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      options.set(name, value);
    }
  }
  const build = parseBuild(options.get("build"));
  resolveBuildProfile(repoRoot, build);
  const cwd = path.resolve(repoRoot);
  const explicitPython = options.get("python") as string | undefined;
  if (platform === "linux") {
    const required = action === "stage" ? ["source-root", "staging-base"] : ["staged-root"];
    if (["launch", "trust"].includes(action)) required.push("wine-runner", "wine-prefix", "wine-python");
    if (action === "trust") required.push("dapp-cert");
    for (const name of required) if (!options.has(name)) throw new Error(`client ${action} requires --${name} on Linux.`);
    const venv = path.join(cwd, "_local/frontier-python312-linux/bin/python");
    const program = explicitPython || process.env.EVEJS_FRONTIER_NATIVE_PYTHON312 || (fs.existsSync(venv) ? venv : "python3.12");
    const forwarded = ["-B", path.join(cwd, "tools/frontier-client/frontier_linux_client.py"), action];
    for (const [name, value] of options) {
      if (name === "python") continue;
      forwarded.push(`--${name}`);
      if (value !== true) forwarded.push(value);
    }
    // The same Node executable runs setup and verifies client TLS by default.
    if (!options.has("node")) forwarded.push("--node", process.execPath);
    return { program, args: forwarded, cwd };
  }
  if (action === "trust") throw new Error("Windows client trust is prepared by certificate setup and checked by client check/launch. Import the public certificates using the Windows setup guide.");
  const scripts = { stage: "StageFrontierClient.ps1", patch: "PatchFrontierClientTrust.ps1", check: "PatchFrontierClientTrust.ps1",
    launch: "PlayFrontier.ps1", status: "StopFrontier.ps1", stop: "StopFrontier.ps1" };
  const translated = ["-NoLogo", "-NoProfile", "-File", path.join(cwd, scripts[action]), "-Build", build];
  if (action === "check") translated.push("-Check");
  if (["status", "stop"].includes(action)) translated.push("-ClientOnly");
  if (action === "status") translated.push("-Status");
  if (["patch", "check"].includes(action) && !options.has("staged-root")) throw new Error(`client ${action} requires --staged-root on Windows.`);
  const flags = { "source-root": "-SourceRoot", "staging-base": "-StagingBase", "staged-root": "-StagedRoot", "dry-run": "-DryRun",
    "copy-resfiles": "-CopyResFiles", clean: "-Clean", "no-patch": "-NoPatch", "settings-profile": "-SettingsProfile",
    "session-file": "-SessionFile", background: "-Background", "use-captured-session": "-UseCapturedSession", "server-host": "-ServerHost" };
  for (const [name, value] of options) {
    if (["build", "python"].includes(name)) continue;
    translated.push(flags[name]);
    if (value !== true) translated.push(value);
  }
  return { program: "pwsh", args: translated, cwd,
    ...(explicitPython ? { env: { ...process.env, EVEJS_FRONTIER_NATIVE_PYTHON312: explicitPython } } : {}) };
}

export function main(args: string[], repoRoot = REPO_ROOT) {
  const plan = clientPlan(repoRoot, args);
  if (plan.help) console.log(plan.help);
  else runNative(plan.program, plan.args, { cwd: plan.cwd, env: plan.env });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`[frontier-client] ${error.message}`); process.exitCode = error.exitCode || 1; }
}
