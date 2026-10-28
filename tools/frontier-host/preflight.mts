import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import dns from "node:dns/promises";
import https from "node:https";
import { assertNodeVersion, resolveBuildProfile, resolveHostPaths } from "./config.mjs";
import { certificatePaths, validatePair } from "./certificates.mjs";
import { nativeCommand } from "./commands.mjs";
import { validatePreparedData } from "./data.mjs";

export function probe(command: string, args: string[]) {
  const invocation = nativeCommand(command, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 600)}`);
  return result.stdout.trim();
}

export function resolvePython312(explicit?: string) {
  const candidates = explicit ? [explicit] : [process.env.EVEJS_FRONTIER_NATIVE_PYTHON312, "python3.12", "python3", "python"].filter(Boolean);
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const answer = JSON.parse(probe(candidate, ["-c", "import json,platform,struct,sys;print(json.dumps({'version':list(sys.version_info[:2]),'implementation':platform.python_implementation(),'bits':struct.calcsize('P')*8,'executable':sys.executable}))"]));
      if (answer.implementation !== "CPython" || answer.version.join(".") !== "3.12" || answer.bits !== 64) throw new Error("requires CPython 3.12 x64 exactly");
      return String(answer.executable);
    } catch (error) { errors.push(`${candidate}: ${error.message}`); }
  }
  throw new Error(`No native CPython 3.12 x64 interpreter found. Set EVEJS_FRONTIER_NATIVE_PYTHON312. ${errors.join("; ")}`);
}

export function probeSqlite(repoRoot: string) {
  const require = createRequire(path.join(repoRoot, "server/package.json"));
  const Database = require("better-sqlite3");
  const database = new Database(":memory:");
  try { return database.prepare("select sqlite_version() as version, 42 as answer").get(); }
  finally { database.close(); }
}

export type DoctorOptions = { build: string; python?: string; clientRoot?: string; serverOnly?: boolean; live?: boolean };

export async function doctor(repoRoot: string, options: DoctorOptions) {
  const checks: { name: string; ok: boolean; required: boolean; detail: any }[] = [];
  async function check(name: string, action: () => any, required = true) {
    try { checks.push({ name, ok: true, required, detail: await action() }); }
    catch (error) { checks.push({ name, ok: false, required, detail: error.message }); }
  }
  const paths = resolveHostPaths(repoRoot, options.build);
  await check("node", () => { assertNodeVersion(); return { version: process.versions.node, executable: process.execPath, platform: process.platform, arch: process.arch }; });
  await check("build-profile", () => {
    const profile = resolveBuildProfile(repoRoot, options.build);
    return { id: profile.id, build: profile.clientBuild, codename: profile.clientCodename, gameplayValidated: false };
  });
  await check("npm", () => probe("npm", ["--version"]));
  await check("root-dependencies", () => {
    const require = createRequire(path.join(repoRoot, "package.json"));
    for (const dependency of ["typescript", "node-forge", "yaml"]) require.resolve(dependency);
    return "TypeScript, node-forge, yaml resolved";
  });
  await check("sqlite-native-binding", () => probeSqlite(repoRoot));
  await check("powershell", () => probe("pwsh", ["-NoLogo", "-NoProfile", "-Command", "if ($PSVersionTable.PSVersion -lt [version]'7.2') { throw 'PowerShell 7.2 or newer is required' }; $PSVersionTable.PSVersion.ToString()"]));
  await check("docker", () => probe(process.platform === "win32" ? "docker.exe" : "docker", ["--version"]));
  await check("efctl", () => probe(process.platform === "win32" ? "efctl.exe" : "efctl", ["version"]));
  await check("pnpm", () => {
    const expected = JSON.parse(fs.readFileSync(path.join(repoRoot, "smart-assembly-control/package.json"), "utf8")).packageManager?.split("@")[1];
    const actual = probe("pnpm", ["--version"]);
    if (actual !== expected) throw new Error(`Expected pnpm ${expected}; found ${actual}`);
    return actual;
  });
  if (!options.serverOnly) await check("native-python312", () => resolvePython312(options.python));
  if (options.clientRoot) await check("installed-client", async () => {
    const { discoverFrontierClients, selectBuild } = await import("../frontier-static/lib/frontier-client-discovery.mjs");
    const selected = selectBuild(discoverFrontierClients({ clientRoot: options.clientRoot }), Number(options.build));
    return { build: selected.build, root: selected.buildRoot, platform: selected.platform };
  });
  await check("prepared-data", () => validatePreparedData(repoRoot, paths.build));
  const certs = certificatePaths(repoRoot);
  await check("game-tls", () => {
    validatePair(certs.ca, certs.caKey, []);
    validatePair(certs.xmpp, certs.xmppKey, ["localhost"], certs.ca);
    return validatePair(certs.gateway, certs.gatewayKey, ["localhost", "127.0.0.1"], certs.ca);
  });
  await check("dapp-tls", () => validatePair(certs.dapp, certs.dappKey, ["dev.dapps.evefrontier.com", "127.0.0.1"]));
  if (options.live) {
    await check("docker-engine", () => {
      const type = probe(process.platform === "win32" ? "docker.exe" : "docker", ["info", "--format", "{{.OSType}}"]);
      if (type !== "linux") throw new Error("Docker must be running Linux containers");
      return type;
    });
    await check("dapp-resolution", async () => {
      const addresses = await dns.lookup("dev.dapps.evefrontier.com", { all: true });
      if (!addresses.length || addresses.some(({ address }) => !["127.0.0.1", "::1"].includes(address))) throw new Error("dev.dapps.evefrontier.com must resolve exclusively to loopback");
      return addresses;
    });
    await check("dapp-https-trust", () => new Promise((resolve, reject) => {
      // Default TLS validation is intentional: an explicitly supplied CA would
      // verify the file while concealing a missing host trust-store setup.
      const request = https.get("https://dev.dapps.evefrontier.com/", { timeout: 5000 }, response => {
        response.resume();
        response.statusCode === 200 ? resolve("HTTPS 200; default Node trust accepted") : reject(new Error(`HTTP ${response.statusCode}`));
      });
      request.on("error", reject); request.on("timeout", () => request.destroy(new Error("HTTPS readiness timed out")));
    }));
  }
  return { format: "evejs-frontier-host-doctor-v1", build: options.build, platform: process.platform,
    ready: checks.every(check => !check.required || check.ok), checks,
    acceptance: "Automated host checks do not establish browser/Wine trust or gameplay acceptance." };
}
