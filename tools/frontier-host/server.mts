import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { resolveHostPaths, resolveBuildProfile, assertNodeVersion } from "./config.mjs";
import { readBuildManifest, verifyAttestedFile, validateContracts } from "./data.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORTS = [443, 5222, 26000, 26101, 26102, 26103, 26401];
const MARKER = ".evejs-frontier-runtime";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Options = { command: string; build: string; background: boolean; reset: boolean; initializeOnly: boolean; dryRun: boolean; quiet: boolean };
type Layout = ReturnType<typeof serverPaths>;
type Identity = { pid: number; startTicks: string; bootId: string; executable: string; cwd: string; argv: string[] };
type ProcessMarker = Identity & { kind: string; schemaVersion: number; platform: string; build: string; runtimeRoot: string; role: string; entry: string; token: string };

export function parseServerArgs(args: string[]): Options {
  const result: Options = { command: "start", build: "", background: false, reset: false, initializeOnly: false, dryRun: false, quiet: false };
  if (["start", "status", "stop"].includes(args[0])) result.command = args.shift()!;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--build") {
      if (result.build) throw new Error("Duplicate --build option.");
      result.build = args[++index] || "";
    }
    else if (arg === "--status") result.command = "status";
    else if (arg === "--background") result.background = true;
    else if (arg === "--reset-runtime") result.reset = true;
    else if (arg === "--initialize-only") result.initializeOnly = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--quiet") result.quiet = true;
    else throw new Error(`Unknown server option: ${arg}`);
  }
  if (!/^[1-9][0-9]*$/.test(result.build) || !Number.isSafeInteger(Number(result.build))) throw new Error("An exact positive --build number is required.");
  if (result.background && result.initializeOnly) throw new Error("--background and --initialize-only cannot be combined.");
  if (result.command !== "start" && (result.background || result.reset || result.initializeOnly)) throw new Error("Startup options require the start command.");
  return result;
}

export function serverPaths(repoRoot: string, build: string) {
  const shared = resolveHostPaths(repoRoot, build), root = shared.repoRoot;
  return { ...shared, runtimeBase: path.dirname(shared.runtimeRoot), serverEntry: path.join(root, "server", "index.js"),
    dappRoot: path.join(root, "smart-assembly-control"), dappEntry: path.join(root, "smart-assembly-control", "scripts", "serve.mjs"),
    worldConfigPath: path.resolve(root, process.env.EVEJS_SUI_WORLD_CONFIG_PATH || `_local/frontier-world/${build}/world.private.json`),
  };
}

function exists(location: string) {
  try { fs.lstatSync(location); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Mutable paths and their existing ancestors must remain inside this checkout. */
export function assertSafePath(repoRoot: string, location: string) {
  const root = path.resolve(repoRoot), target = path.resolve(location);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes repository: ${target}`);
  for (let cursor = target;; cursor = path.dirname(cursor)) {
    if (exists(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symbolic-link path: ${cursor}`);
    if (cursor === root) break;
  }
}

export function assertNoLinks(root: string) {
  const item = fs.lstatSync(root);
  if (item.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${root}`);
  if (item.isDirectory()) for (const name of fs.readdirSync(root)) assertNoLinks(path.join(root, name));
}

function readJSON(location: string): any {
  if (!fs.lstatSync(location).isFile()) throw new Error(`Expected a regular JSON file: ${location}`);
  return JSON.parse(fs.readFileSync(location, "utf8").replace(/^\uFEFF/, ""));
}

function writeJSON(location: string, value: any) {
  const temporary = `${location}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, location); } finally { fs.rmSync(temporary, { force: true }); }
}

export function validateRuntime(layout: Layout) {
  assertSafePath(layout.repoRoot, layout.runtimeRoot);
  assertNoLinks(layout.runtimeRoot);
  const marker = readJSON(path.join(layout.runtimeRoot, MARKER));
  if (marker.kind !== "evejs-frontier-runtime" || marker.schemaVersion !== 1 || String(marker.build) !== layout.build ||
      marker.runtimeRoot !== layout.runtimeRoot || marker.generatedRoot !== layout.generatedRoot || marker.staticRoot !== layout.staticRoot) {
    throw new Error(`Runtime marker does not own this exact build/path: ${layout.runtimeRoot}`);
  }
  if (!fs.statSync(layout.runtimeData).isDirectory()) throw new Error("Runtime data directory is missing.");
  return marker;
}

function validateInputs(layout: Layout) {
  for (const directory of [layout.generatedData, layout.staticRoot]) {
    assertSafePath(layout.repoRoot, directory);
    if (!fs.statSync(directory).isDirectory()) throw new Error(`Generated build input is missing: ${directory}`);
    assertNoLinks(directory);
  }
  assertNoLinks(path.join(layout.generatedRoot, "manifest.json"));
  const manifest = readJSON(path.join(layout.generatedRoot, "manifest.json"));
  // Older generators omit build identity; if supplied, it must match.
  const declared = manifest.clientBuild ?? manifest.build;
  if (declared !== undefined && String(declared) !== layout.build) throw new Error("Generated manifest targets another client build.");
  if (exists(layout.generatedAssets)) assertNoLinks(layout.generatedAssets);
}

/** Verify build identities and immutable attestations without replaying the full gameplay/SDE audit. */
export function validateStartupArtifacts(layout: Layout) {
  validateInputs(layout);
  const snapshot = readBuildManifest(path.join(layout.staticRoot, "frontier-extraction-manifest.json"), layout.build, "static");
  const database = readBuildManifest(path.join(layout.generatedRoot, "manifest.json"), layout.build, "database");
  if (snapshot.format !== "evejs-frontier-static-v1" || database.profile !== "frontier") throw new Error("Startup artifacts do not declare the Frontier snapshot/database formats.");
  for (const table of ["solarSystems", "stargates", "celestials", "stations", "itemTypes"]) {
    const file = path.join(layout.generatedData, table, "data.json");
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Generated baseline table is missing or empty: ${file}`);
  }
  const collision = database.assets?.collisionBundle;
  verifyAttestedFile(layout.generatedRoot, collision?.path, collision);
  if (String(collision.sha256).toLowerCase() !== String(snapshot.assets?.collisionBundle?.sha256).toLowerCase()) throw new Error("Generated collision asset differs from the selected snapshot.");
  validateContracts(layout.contractsRoot, layout.build);
  return { build: layout.build, collisionSha256: collision.sha256 };
}

/** Publish a complete copy atomically; never recognize an arbitrary existing directory. */
export function initializeRuntime(layout: Layout) {
  validateInputs(layout);
  assertSafePath(layout.repoRoot, layout.runtimeRoot);
  if (exists(layout.runtimeRoot)) validateRuntime(layout);
  else {
    fs.mkdirSync(layout.runtimeBase, { recursive: true });
    const temporary = path.join(layout.runtimeBase, `.${layout.build}.initializing-${randomUUID()}`);
    try {
      fs.mkdirSync(temporary, { mode: 0o700 });
      fs.mkdirSync(path.join(temporary, "gameStore"), { recursive: true });
      fs.cpSync(layout.generatedData, path.join(temporary, "gameStore", "data"), { recursive: true, errorOnExist: true, force: false });
      copySupport(layout, temporary);
      for (const file of ["evejs.config.json", "evejs.config.local.json"]) {
        const source = path.join(layout.repoRoot, file);
        if (exists(source)) {
          assertSafePath(layout.repoRoot, source);
          if (!fs.lstatSync(source).isFile()) throw new Error(`Root configuration is not a regular file: ${source}`);
          fs.writeFileSync(path.join(temporary, file), fs.readFileSync(source), { flag: "wx", mode: 0o600 });
        }
      }
      writeJSON(path.join(temporary, MARKER), { kind: "evejs-frontier-runtime", schemaVersion: 1, platform: "linux", build: layout.build,
        runtimeRoot: layout.runtimeRoot, generatedRoot: layout.generatedRoot, staticRoot: layout.staticRoot, createdAtUtc: new Date().toISOString() });
      fs.renameSync(temporary, layout.runtimeRoot);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  copySupport(layout, layout.runtimeRoot);
}

function copySupport(layout: Layout, target: string) {
  fs.copyFileSync(path.join(layout.generatedRoot, "manifest.json"), path.join(target, "gameStore", "manifest.json"));
  fs.copyFileSync(path.join(layout.generatedRoot, "manifest.json"), path.join(target, "generated-manifest.json"));
  if (exists(layout.generatedAssets)) fs.cpSync(layout.generatedAssets, path.join(target, "gameStore", "assets"), { recursive: true });
}

/** Linux /proc identity includes boot ID and start ticks so PID reuse cannot authorize a stop. */
export function processIdentity(pid: number): Identity | null {
  try {
    const directory = `/proc/${pid}`;
    const stat = fs.readFileSync(path.join(directory, "stat"), "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z") return null;
    const identity = { pid, startTicks: fields[19], bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
      executable: fs.realpathSync(path.join(directory, "exe")), cwd: fs.realpathSync(path.join(directory, "cwd")),
      argv: fs.readFileSync(path.join(directory, "cmdline")).toString().split("\0").filter(Boolean) };
    // Linux can clear cmdline between the initial stat read and zombie state.
    // Such a process cannot authorize a signal or own a fresh startup marker.
    return identity.argv.length ? identity : null;
  } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; }
}

function markerPath(layout: Layout, role: string) { return path.join(layout.runtimeRoot, `.evejs-frontier-${role}.pid.json`); }
function roleEntry(layout: Layout, role: string) { return role === "server" ? layout.serverEntry : layout.dappEntry; }

export function processState(layout: Layout, role: "server" | "dapp") {
  const file = markerPath(layout, role);
  assertSafePath(layout.repoRoot, file);
  if (!exists(file)) return { state: "stopped", marker: null };
  const marker = readJSON(file) as ProcessMarker;
  if (marker.kind !== `evejs-frontier-${role}-process` || marker.schemaVersion !== 1 || marker.platform !== "linux" ||
      marker.build !== layout.build || marker.runtimeRoot !== layout.runtimeRoot || marker.role !== role ||
      marker.entry !== roleEntry(layout, role) || !Number.isInteger(marker.pid) || marker.pid <= 1 || typeof marker.token !== "string" ||
      typeof marker.startTicks !== "string" || typeof marker.bootId !== "string" || typeof marker.executable !== "string" || !Array.isArray(marker.argv)) {
    throw new Error(`Refusing malformed or foreign process marker: ${file}`);
  }
  const actual = processIdentity(marker.pid);
  if (!actual || actual.bootId !== marker.bootId || actual.startTicks !== marker.startTicks) return { state: "stale", marker };
  const commandEntry = role === "dapp" ? path.join(layout.repoRoot, "tools", "frontier-host", "owned-dapp.mjs") : marker.entry;
  if (marker.cwd !== layout.repoRoot || actual.executable !== marker.executable || actual.cwd !== marker.cwd || JSON.stringify(actual.argv) !== JSON.stringify(marker.argv) ||
      actual.argv[1] !== commandEntry || actual.argv[2] !== `--evejs-frontier-owner=${marker.token}` ||
      (role === "dapp" && actual.argv[3] !== marker.entry)) {
    throw new Error(`Live PID ${marker.pid} does not match its owned ${role} command; refusing to act.`);
  }
  return { state: "running", marker };
}

export function serverEnvironment(layout: Layout, profile: any, quiet = false): NodeJS.ProcessEnv {
  if (String(profile.clientBuild) !== layout.build) throw new Error("Server environment profile does not match the exact build.");
  return { ...process.env, EVEJS_CONFIG_DIR: layout.runtimeRoot, EVEJS_LOG_DIR: path.join(layout.runtimeRoot, "logs"),
    EVEJS_GAMESTORE_DATA_DIR: layout.runtimeData, EVEJS_PERSISTENCE_WORKER: "1", EVEJS_COLLISION_BUNDLE_REQUIRED: "1",
    EVEJS_STATIC_JSONL_ROOT: layout.staticRoot, EVEJS_CLIENT_COMPATIBILITY_PROFILE: "frontier", EVEJS_CLIENT_BUILD_PROFILE: profile.runtimeProfileId || "auto",
    EVEJS_CLIENT_VERSION: Number(profile.clientVersion).toFixed(2), EVEJS_CLIENT_BUILD: layout.build, EVEJS_EVE_BIRTHDAY: String(profile.eveBirthday ?? 170472),
    EVEJS_MACHO_VERSION: String(profile.machoVersion), EVEJS_PROJECT_CODENAME: profile.clientCodename,
    EVEJS_PROJECT_REGION: profile.projectRegion || "ccp", EVEJS_PROJECT_VERSION: profile.projectVersion || "V20.04@ccp",
    EVEJS_SUI_WORLD_CONFIG_PATH: layout.worldConfigPath, EVEJS_GAME_SERVER_BIND_HOST: "127.0.0.1", EVEJS_GAME_SERVER_HOST: "127.0.0.1", EVEJS_SERVER_PORT: "26000",
    EVEJS_IMAGE_SERVER_URL: "http://127.0.0.1:26101/", EVEJS_IMAGE_SERVER_BIND_HOST: "127.0.0.1", EVEJS_MICROSERVICES_REDIRECT_URL: "http://127.0.0.1:26102/",
    EVEJS_MICROSERVICES_PUBLIC_BASE_URL: "http://127.0.0.1:26102/", EVEJS_MICROSERVICES_BIND_HOST: "127.0.0.1", EVEJS_PROXY_LOOPBACK_CDN_LISTEN_PORT: "0",
    EVEJS_REDSHIFT_MONITOR_HOST: "127.0.0.1", EVEJS_REDSHIFT_MONITOR_PORT: "26401", EVEJS_XMPP_SERVER_BIND_HOST: "127.0.0.1", EVEJS_XMPP_SERVER_PORT: "5222",
    EVEJS_XMPP_CONNECT_HOST: "127.0.0.1", EVEJS_XMPP_DOMAIN: "frontier.localhost", EVEJS_XMPP_CONFERENCE_DOMAIN: "conference.frontier.localhost",
    EVEJS_DEV_AUTO_CREATE_ACCOUNTS: "true", EVEJS_DEV_SKIP_PASSWORD_VALIDATION: "true", EVEJS_WORMHOLES_ENABLED: "false", EVEJS_MARKET_DAEMON_ENABLED: "false",
    EVEJS_SKIP_NPC_STARTUP: "1", EVEJS_LOG_LEVEL: quiet ? "1" : "2" };
}

function requireBuildProfile(layout: Layout) {
  return resolveBuildProfile(layout.repoRoot, layout.build);
}

function run(command: string, args: string[], cwd: string, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(" ")} (${result.error?.message || result.status})`);
}

function checkDependencies(layout: Layout) {
  assertNodeVersion();
  if (!exists(layout.serverEntry)) throw new Error("Compiled server missing. Run npm run build:production.");
  const require = createRequire(path.join(layout.repoRoot, "server", "package.json"));
  try {
    const Database = require("better-sqlite3");
    const database = new Database(":memory:");
    try { database.prepare("SELECT 1").get(); } finally { database.close(); }
  } catch (error) { throw new Error(`Native SQLite probe failed. Run npm --prefix server ci using this Linux Node (${error.message}).`); }
  for (const file of [path.join(layout.dappRoot, "package.json"), layout.dappEntry, path.join(layout.dappRoot, ".env.local"), path.join(layout.dappRoot, ".deployment-source.json")]) {
    if (!exists(file)) throw new Error(`dApp dependency/config missing: ${file}. Install and configure the dApp for the synchronized world.`);
  }
  if (!exists(path.join(layout.dappRoot, "node_modules"))) throw new Error("Run npm run frontier:dapp:install.");
}

export async function validateWorld(layout: Layout, checkLive = true) {
  if (!exists(layout.worldConfigPath)) throw new Error(`Synchronized world missing: ${layout.worldConfigPath}. Synchronize the exact build before starting.`);
  const require = createRequire(path.join(layout.repoRoot, "server", "package.json"));
  const { readSyncedSuiWorldConfig } = require(path.join(layout.repoRoot, "server", "src", "services", "frontier", "suiCharacterProvisioning.js"));
  const world = readSyncedSuiWorldConfig({ ...process.env, EVEJS_CLIENT_BUILD: layout.build, EVEJS_SUI_WORLD_CONFIG_PATH: layout.worldConfigPath });
  if (!world || String(world.build) !== layout.build) throw new Error("Synchronized world does not match this client build.");
  if (checkLive) {
    const result = spawnSync("docker", ["exec", "sui-playground", "timeout", "5", "sui", "client", "--client.env", "localnet", "chain-identifier", "--format", "hex"],
      { cwd: layout.repoRoot, encoding: "utf8", timeout: 15_000, env: process.env });
    const liveId = result.stdout?.trim().toLowerCase();
    if (result.error || result.status !== 0 || !/^[0-9a-f]{8}$/.test(liveId || "")) throw new Error("The local Sui chain could not be checked. Start and synchronize localnet before starting EveJS.");
    if (liveId !== world.chainId) throw new Error("Synchronized world is stale relative to the live Sui chain; synchronize again.");
  }
  const deployment = readJSON(path.join(layout.dappRoot, ".deployment-source.json"));
  if (deployment.network !== "localnet" || typeof deployment.worldDir !== "string" ||
      path.resolve(deployment.worldDir) !== path.join(path.resolve(world.sourceWorkspace || layout.repoRoot), "world-contracts")) throw new Error("dApp deployment configuration does not match the synchronized localnet world.");
  // Load the dApp's own validator, including expiry and key/certificate matching.
  const { loadTlsOptions } = await import(path.join(layout.dappRoot, "scripts", "tls.mjs"));
  await loadTlsOptions(layout.dappRoot);
  return world;
}

async function portFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", error => reject(new Error(`Required loopback port ${port} is unavailable (${error.message}). For 443, configure a local privileged-port policy; do not run the server as root.`)));
    server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
  });
}

async function reachable(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => finish(false)); socket.once("error", () => finish(false)); socket.once("connect", () => finish(true));
  });
}

export function processListenerPorts(pid: number) {
  const sockets = new Set<string>();
  for (const file of fs.readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = fs.readlinkSync(`/proc/${pid}/fd/${file}`).match(/^socket:\[(\d+)\]$/);
      if (match) sockets.add(match[1]);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const ports = new Set<number>();
  for (const table of ["tcp", "tcp6"]) {
    for (const row of fs.readFileSync(`/proc/${pid}/net/${table}`, "utf8").trim().split("\n").slice(1)) {
      const fields = row.trim().split(/\s+/);
      if (fields[3] === "0A" && sockets.has(fields[9])) ports.add(parseInt(fields[1].split(":").at(-1)!, 16));
    }
  }
  return ports;
}

export async function waitReady(layout: Layout, role: "server" | "dapp", ports: number[], timeoutMs = 30_000, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const state = processState(layout, role);
    if (state.state !== "running") throw new Error(`${role} exited before becoming ready; inspect ${layout.runtimeRoot}/${role}.stderr.log.`);
    const listeners = processListenerPorts(state.marker!.pid);
    if (ports.every(port => listeners.has(port)) && (await Promise.all(ports.map(reachable))).every(Boolean)) return;
    await sleep(100);
  }
  throw new Error(`${role} readiness timed out; inspect logs in ${layout.runtimeRoot}.`);
}

export async function startOwned(layout: Layout, role: "server" | "dapp", env: NodeJS.ProcessEnv) {
  const token = randomUUID(), entry = roleEntry(layout, role);
  const stdout = fs.openSync(path.join(layout.runtimeRoot, `${role}.stdout.log`), "a", 0o600);
  const stderr = fs.openSync(path.join(layout.runtimeRoot, `${role}.stderr.log`), "a", 0o600);
  let child: ChildProcess;
  try {
    const args = [entry, `--evejs-frontier-owner=${token}`];
    // The dApp parses its arguments strictly; an ownership environment token
    // is used in argv through the generic Node wrapper below instead.
    const actualArgs = role === "dapp" ? [path.join(layout.repoRoot, "tools", "frontier-host", "owned-dapp.mjs"), `--evejs-frontier-owner=${token}`, entry] : args;
    child = spawn(process.execPath, actualArgs, { cwd: layout.repoRoot, env, detached: true, stdio: ["ignore", stdout, stderr] });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  try {
    const identity = processIdentity(child.pid!);
    if (!identity) throw new Error(`${role} exited during startup.`);
    // Store the actual command entry for strict process identity verification.
    const marker: ProcessMarker = { ...identity, kind: `evejs-frontier-${role}-process`, schemaVersion: 1, platform: "linux", build: layout.build,
      runtimeRoot: layout.runtimeRoot, role, entry, token };
    writeJSON(markerPath(layout, role), marker);
    child.unref();
    return child;
  } catch (error) { try { child.kill("SIGTERM"); } catch {} throw error; }
}

export async function stopOwned(layout: Layout, role: "server" | "dapp", waitMs = 15_000) {
  const state = processState(layout, role);
  if (state.state === "stopped") return;
  const removeMatchingMarker = () => {
    const file = markerPath(layout, role);
    if (exists(file) && JSON.stringify(readJSON(file)) === JSON.stringify(state.marker)) fs.unlinkSync(file);
  };
  if (state.state === "stale") { removeMatchingMarker(); return; }
  process.kill(state.marker!.pid, "SIGTERM");
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const current = processState(layout, role);
    if (current.marker?.token !== state.marker!.token) return;
    if (current.state !== "running") { removeMatchingMarker(); return; }
    await sleep(100);
  }
  throw new Error(`${role} did not stop within ${waitMs / 1000}s; ownership marker retained. No unrelated process was killed.`);
}

export function assertNoRuntimeProcesses(layout: Layout) {
  for (const role of ["server", "dapp"] as const) if (exists(markerPath(layout, role))) throw new Error(`Refusing reset while any ${role} PID marker exists; use stop to reconcile it first.`);
  for (const name of fs.readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(name)) continue;
    const pid = Number(name);
    let argv: string[];
    try {
      if (fs.statSync(`/proc/${pid}`).uid !== process.getuid!()) continue;
      argv = fs.readFileSync(`/proc/${pid}/cmdline`).toString().split("\0").filter(Boolean);
    }
    catch (error) {
      // An unreadable process belonging to another user cannot own these
      // current-user private files. Same-user inspection failures fail closed.
      try { if (fs.statSync(`/proc/${pid}`).uid !== process.getuid!()) continue; }
      catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
      throw error;
    }
    const entries = [layout.serverEntry, layout.dappEntry, path.join(layout.repoRoot, "tools", "frontier-host", "owned-dapp.mjs")];
    if (argv.some(arg => entries.includes(arg))) throw new Error(`Refusing reset while exact checkout server/dApp process ${pid} is running without a reconciled marker.`);
    // Other desktop processes may deliberately deny /proc/exe/environ access.
    // Only a native Node command can own this Node server runtime; do not turn
    // an unrelated browser's process protections into a permanent reset block.
    if (![path.basename(process.execPath), "node", "nodejs"].includes(path.basename(argv[0] || ""))) continue;
    // Direct launches may use another cwd. The environment identifies the
    // mutable store they own even if their command uses a relative entry path.
    try {
      const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
      if (argv.slice(1).some(arg => !arg.startsWith("-") && entries.includes(path.resolve(cwd, arg)))) throw new Error(`Refusing reset while exact checkout server/dApp process ${pid} is running without a reconciled marker.`);
      const env = fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");
      if (env.includes(`EVEJS_GAMESTORE_DATA_DIR=${layout.runtimeData}`)) throw new Error(`Refusing reset while process ${pid} owns this runtime data.`);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      if (error.code === "EACCES" || error.code === "EPERM") {
        try { if (fs.statSync(`/proc/${pid}`).uid !== process.getuid!()) continue; }
        catch (statError) { if (statError.code === "ENOENT") continue; throw statError; }
      }
      throw error;
    }
  }
}

export async function resetRuntime(layout: Layout, ports = [...PORTS, ...(layout.build === "2455427" ? [32811] : [])]) {
  validateRuntime(layout);
  assertNoRuntimeProcesses(layout);
  for (const port of ports) await portFree(port);
  // Repeat immediately before deletion after the asynchronous listener probes.
  validateRuntime(layout);
  assertNoRuntimeProcesses(layout);
  fs.rmSync(layout.runtimeRoot, { recursive: true });
}

function controlLock(layout: Layout) {
  assertSafePath(layout.repoRoot, layout.runtimeBase);
  fs.mkdirSync(layout.runtimeBase, { recursive: true });
  const directory = path.join(layout.runtimeBase, `.${layout.build}.linux-control-lock`);
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    assertSafePath(layout.repoRoot, directory); assertNoLinks(directory);
    const owner = readJSON(path.join(directory, "owner.json"));
    if (!Number.isInteger(owner?.pid) || owner.pid <= 1 || typeof owner.bootId !== "string" || typeof owner.startTicks !== "string") throw new Error(`Malformed lifecycle lock retained: ${directory}`);
    const actual = processIdentity(owner.pid);
    if (actual && actual.bootId === owner.bootId && actual.startTicks === owner.startTicks) throw new Error(`Another lifecycle operation owns ${directory}.`);
    throw new Error(`Interrupted lifecycle lock retained at ${directory}; inspect owner.json and remove only that stale lock directory before retrying.`);
  }
  const token = randomUUID();
  writeJSON(path.join(directory, "owner.json"), { ...processIdentity(process.pid), token });
  return () => {
    assertSafePath(layout.repoRoot, directory); assertNoLinks(directory);
    if (readJSON(path.join(directory, "owner.json")).token !== token) throw new Error(`Lifecycle lock owner changed; retained ${directory}.`);
    fs.rmSync(directory, { recursive: true });
  };
}

export async function main(args: string[], repoRoot = REPO_ROOT): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node tools/frontier-host/server.mjs start|status|stop --build NUMBER [--background] [--reset-runtime] [--initialize-only] [--dry-run] [--quiet]");
    return 0;
  }
  if (process.platform !== "linux") throw new Error("This lifecycle tool supports native Linux only. Use StartFrontierServer.ps1 on Windows.");
  const options = parseServerArgs([...args]), layout = serverPaths(repoRoot, options.build);
  assertSafePath(layout.repoRoot, layout.runtimeRoot);
  if (options.command === "status") {
    if (!exists(layout.runtimeRoot)) { console.log(JSON.stringify({ build: layout.build, runtime: "missing", server: "stopped", dapp: "stopped" })); return 0; }
    validateRuntime(layout);
    console.log(JSON.stringify({ build: layout.build, runtime: "ready", server: processState(layout, "server").state, dapp: processState(layout, "dapp").state }));
    return 0;
  }
  if (options.command === "stop") {
    if (!exists(layout.runtimeRoot)) { console.log("No runtime or owned processes exist for this build."); return 0; }
    validateRuntime(layout);
    // Validate BOTH before stopping either, so a forged second marker cannot partially stop a session.
    for (const role of ["server", "dapp"] as const) processState(layout, role);
    if (options.dryRun) { console.log("Dry run: would stop the owned server and dApp only."); return 0; }
    const release = controlLock(layout);
    try { await stopOwned(layout, "server"); await stopOwned(layout, "dapp"); } finally { release(); }
    console.log("Owned Frontier server and dApp stopped."); return 0;
  }
  const profile = requireBuildProfile(layout);
  validateStartupArtifacts(layout);
  if (exists(layout.runtimeRoot)) {
    validateRuntime(layout);
    for (const role of ["server", "dapp"] as const) if (processState(layout, role).state === "running") throw new Error(`Owned ${role} is already running; stop it before starting or resetting.`);
  }
  if (!options.initializeOnly) {
    checkDependencies(layout);
    await validateWorld(layout);
    for (const port of [...PORTS, ...(layout.build === "2455427" ? [32811] : [])]) await portFree(port);
  }
  if (options.dryRun) { console.log(JSON.stringify({ dryRun: true, build: layout.build, runtimeRoot: layout.runtimeRoot, reset: options.reset, initializeOnly: options.initializeOnly, background: options.background })); return 0; }
  const release = controlLock(layout);
  let childrenStarted = false;
  const startupAbort = new AbortController();
  const interruptStartup = () => startupAbort.abort(new Error("Startup interrupted; stopping owned processes."));
  process.on("SIGINT", interruptStartup); process.on("SIGTERM", interruptStartup);
  try {
    // Repeat ownership checks under the lifecycle lock before any runtime mutation.
    if (exists(layout.runtimeRoot)) {
      validateRuntime(layout);
      for (const role of ["server", "dapp"] as const) if (processState(layout, role).state === "running") throw new Error(`Owned ${role} is running.`);
      if (options.reset) await resetRuntime(layout);
    }
    initializeRuntime(layout);
    if (options.initializeOnly) { console.log(`Initialized exact build runtime: ${layout.runtimeRoot}`); return 0; }
    startupAbort.signal.throwIfAborted();
    run("npm", ["run", "build:production"], layout.repoRoot);
    startupAbort.signal.throwIfAborted();
    const environment = serverEnvironment(layout, profile, options.quiet);
    if (profile.blockchain?.protocol === "evm") {
      const sync = await import(path.join(layout.repoRoot, "tools", "frontier-contracts", "sync-legacy-evm-sui.mjs"));
      const result = sync.syncLegacyEvmSuiManifest({ build: layout.build, worldConfigPath: layout.worldConfigPath,
        ...(process.env.EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH ? { out: path.resolve(layout.repoRoot, process.env.EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH) } : {}) });
      if (!result.enabled || !result.worldReady) throw new Error("Exact-build EVM-to-Sui backend is not ready.");
      environment.EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH = result.manifestPath;
    }
    run("pnpm", ["--dir", layout.dappRoot, "build"], layout.repoRoot);
    startupAbort.signal.throwIfAborted();
    await startOwned(layout, "dapp", environment); childrenStarted = true;
    await waitReady(layout, "dapp", [443], 30_000, startupAbort.signal);
    await startOwned(layout, "server", environment);
    await waitReady(layout, "server", [...PORTS.filter(port => port !== 443), ...(layout.build === "2455427" ? [32811] : [])], 30_000, startupAbort.signal);
    await waitReady(layout, "dapp", [443], 1000, startupAbort.signal);
    console.log(`Frontier ${layout.build} ready. Game 127.0.0.1:26000; dApp https://dev.dapps.evefrontier.com; logs ${layout.runtimeRoot}`);
  } catch (error) {
    if (childrenStarted) for (const role of ["server", "dapp"] as const) { try { await stopOwned(layout, role); } catch (stopError) { console.error(`Rollback: ${stopError.message}`); } }
    throw error;
  } finally { process.removeListener("SIGINT", interruptStartup); process.removeListener("SIGTERM", interruptStartup); release(); }
  if (options.background || options.initializeOnly) return 0;
  let stopping = false;
  const requestStop = () => { stopping = true; };
  process.on("SIGINT", requestStop); process.on("SIGTERM", requestStop);
  try {
    while (!stopping) {
      if (["server", "dapp"].some(role => processState(layout, role as "server" | "dapp").state !== "running")) { stopping = true; process.exitCode = 1; break; }
      await sleep(250);
    }
    for (const role of ["server", "dapp"] as const) await stopOwned(layout, role);
  } finally { process.removeListener("SIGINT", requestStop); process.removeListener("SIGTERM", requestStop); }
  return Number(process.exitCode || 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => { console.error(`[evejs-frontier-linux] ${error.message}`); process.exitCode = 1; });
}
