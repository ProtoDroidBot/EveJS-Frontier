import path from "node:path";
import { parseBuild } from "../../tools/frontier-host/config.mjs";

const ACTIONS = new Set(["up", "sync", "status", "down", "restart"]);
const VALUE_OPTIONS = {
  build: "Build",
  "source-root": "SourceRoot",
  "destination-root": "DestinationRoot",
  "dapp-root": "DappRoot",
  "efctl-path": "EfctlPath",
  "npc-faction-config-path": "NpcFactionConfigPath",
  "npc-faction-sde-path": "NpcFactionSdePath",
};
const SWITCH_OPTIONS = {
  "dry-run": "DryRun",
  "skip-rpc-validation": "SkipRpcValidation",
  "skip-docker-ownership-check": "SkipDockerOwnershipCheck",
  "skip-npc-faction-funding": "SkipNpcFactionFunding",
  "skip-dapp-sync": "SkipDappSync",
};

function optionName(flag: string) {
  if (flag.startsWith("--")) {
    const name = flag.slice(2);
    return Object.hasOwn(VALUE_OPTIONS, name) || Object.hasOwn(SWITCH_OPTIONS, name) ? name : null;
  }
  if (!flag.startsWith("-")) return null;
  // Keep established PowerShell spellings available through every wrapper.
  const name = flag.slice(1).toLowerCase();
  return Object.entries({ ...VALUE_OPTIONS, ...SWITCH_OPTIONS })
    .find(([, powershell]) => powershell.toLowerCase() === name)?.[0] ?? null;
}

function validateEfctlArguments(action: string, args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (action !== "sync" && flag === "--debug") continue;
    if (["up", "restart"].includes(action) &&
      /^(?:--with-(?:frontend|graphql))(?:=(?:true|false))?$/.test(flag)) continue;
    if (action === "status" && (flag === "--rpc-url" || flag.startsWith("--rpc-url="))) {
      const value = flag === "--rpc-url" ? args[++index] : flag.slice("--rpc-url=".length);
      let url: URL;
      try { url = new URL(value); } catch { throw new Error("--rpc-url requires an absolute HTTP or HTTPS URL."); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("--rpc-url requires an absolute HTTP or HTTPS URL.");
      continue;
    }
    throw new Error(`Unsupported efctl argument for world ${action}: ${flag}`);
  }
}

/** Translate all world entry points into the same guarded PowerShell workflow. */
export function planWorldCommand(argv: string[], repoRoot: string) {
  const [action, ...options] = argv;
  if (!ACTIONS.has(action)) throw new Error("world requires up, sync, status, down or restart");
  const selected = new Set<string>();
  const translated: string[] = [];
  const efctl: string[] = [];
  let build: string;
  for (let index = 0; index < options.length; index++) {
    const flag = options[index];
    if (flag === "--") { efctl.push(...options.slice(index + 1)); break; }
    if (/^-debug$/i.test(flag)) { efctl.push("--debug"); continue; }
    const name = optionName(flag);
    if (!name) {
      // efctl flags may follow the tool options with or without a separator.
      efctl.push(flag);
      if (flag === "--rpc-url" && options[index + 1] && !options[index + 1].startsWith("-")) efctl.push(options[++index]);
      continue;
    }
    if (selected.has(name)) throw new Error(`Duplicate world option: ${flag}`);
    selected.add(name);
    if (Object.hasOwn(SWITCH_OPTIONS, name)) {
      translated.push(`-${SWITCH_OPTIONS[name]}`);
      continue;
    }
    const value = options[++index];
    if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
    if (name === "build") build = parseBuild(value);
    translated.push(`-${VALUE_OPTIONS[name]}`, value);
  }
  build = parseBuild(build);
  validateEfctlArguments(action, efctl);
  return {
    action,
    build,
    args: ["-NoLogo", "-NoProfile", "-File", path.join(repoRoot, "FrontierWorld.ps1"), action, ...translated, ...efctl],
  };
}
