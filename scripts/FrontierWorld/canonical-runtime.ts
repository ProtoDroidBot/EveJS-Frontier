#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const net = require("node:net");
const ROOT = path.resolve(__dirname, "../..");
const FORMAT = "evejs-canonical-runtime-v1";
const MARKER = ".evejs-canonical-runtime.json";

function digest(filename) {
  const hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(filename, "r");
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, length)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
function realPath(filename) {
  let current = path.resolve(filename); const tail = [];
  while (!fs.existsSync(current)) { tail.unshift(path.basename(current)); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  return path.resolve(fs.realpathSync(current), ...tail);
}
function inside(candidate, parent) {
  const relative = path.relative(realPath(parent), realPath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function overlaps(a, b) { return inside(a, b) || inside(b, a); }
function noSymlinks(filename) {
  for (let current = path.resolve(filename);; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Runtime path contains a symlink: ${current}`);
    if (current === path.dirname(current)) break;
  }
}
function json(filename) { return JSON.parse(fs.readFileSync(filename, "utf8")); }
function writeJson(filename, value) { fs.writeFileSync(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
function files(directory, prefix = "") {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in runtime input: ${full}`);
    if (entry.isDirectory()) result.push(...files(full, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Refusing a non-regular runtime input: ${full}`);
  }
  return result;
}

function selectCandidate(worldPath, contentPath) {
  worldPath = fs.realpathSync(path.resolve(worldPath)); contentPath = fs.realpathSync(path.resolve(contentPath));
  const worldModule = require(path.join(ROOT, "server/src/services/frontier/explorationWorld"));
  const profiles = require(path.join(ROOT, "server/src/services/frontier/temporaryLandscapeProfile"));
  const raw = json(worldPath), profile = profiles.createTemporaryLandscapeProfile(json(contentPath));
  const world = worldModule.createTemporaryExplorationWorld(raw, profile);
  if (!world.canonicalSource || world.sourceProfile !== "3572727-canonical-fsd-v1" || profile.raw.temporary !== false) throw new Error("Explicit canonical3572727/compatible3640684 world and content required");
  return { targetBuild: 3640684, sourceBuild: 3572727, sourceProfile: world.sourceProfile,
    baseRevision: world.baseRevision, contentRevision: profile.revision, worldRevision: world.revision,
    worldPath, contentPath, worldSHA256: digest(worldPath), contentSHA256: digest(contentPath),
    counts: { systems: world.systems.size, stations: world.stations.size, sites: profile.sites.size, ecosystems: profile.ecosystems.size, dungeons: profile.dungeons.size } };
}

/** Copy an attested generated baseline only; never clone or reset a live store. */
function prepareRuntime(selection, generatedRoot, runtimeRoot) {
  generatedRoot = fs.realpathSync(path.resolve(generatedRoot)); runtimeRoot = path.resolve(runtimeRoot);
  noSymlinks(runtimeRoot);
  const protectedRoots = [path.join(ROOT, "server/src/gameStore"), path.join(ROOT, "_local/gameStore"), path.join(ROOT, "_local/frontier-runtime"), generatedRoot,
    process.env.EVEJS_GAMESTORE_DATA_DIR && path.dirname(process.env.EVEJS_GAMESTORE_DATA_DIR)].filter(Boolean);
  if (protectedRoots.some(p => overlaps(runtimeRoot, p)) || [selection.worldPath, selection.contentPath].some(p => inside(p, runtimeRoot))) throw new Error("Candidate runtime overlaps a protected source/current runtime");
  for (const key of ["baseRevision", "contentRevision", "worldRevision", "worldSHA256", "contentSHA256"]) if (!/^[0-9a-f]{64}$/.test(selection[key] || "")) throw new Error(`Invalid candidate ${key}`);
  if (selection.targetBuild !== 3640684 || selection.sourceBuild !== 3572727 || selection.sourceProfile !== "3572727-canonical-fsd-v1") throw new Error("Invalid candidate source/target identity");
  const generated = json(path.join(generatedRoot, "manifest.json"));
  if (generated.profile !== "frontier" || generated.build !== 3640684 || generated.canonicalWorld?.sourceProfile !== selection.sourceProfile ||
      generated.canonicalWorld?.baseRevision !== selection.baseRevision || generated.canonicalWorld?.worldSHA256 !== selection.worldSHA256 || generated.compatibleCatalog?.build !== 3640684) throw new Error("Generated catalog/world provenance mismatch");
  const inputData = path.join(generatedRoot, "data"), dataFiles = files(inputData).sort();
  const attested = generated.dataFiles || {};
  if (!dataFiles.length || dataFiles.length !== Object.keys(attested).length) throw new Error("Generated table attestation is incomplete");
  for (const relative of dataFiles) {
    const meta = attested[relative.split(path.sep).join("/")], full = path.join(inputData, relative);
    if (!relative.endsWith(".json") || !meta || meta.bytes !== fs.statSync(full).size || meta.sha256 !== digest(full)) throw new Error(`Generated table attestation mismatch: ${relative}`);
  }
  if (fs.existsSync(path.join(generatedRoot, "gamestore.sqlite"))) throw new Error("Refusing mutable SQLite as a generated baseline");
  const binding = { format: FORMAT, ...selection, generatedRoot, generatedManifestSHA256: digest(path.join(generatedRoot, "manifest.json")), runtimeRoot,
    gameStoreRoot: path.join(runtimeRoot, "gameStore"), dataDir: path.join(runtimeRoot, "gameStore/data"), configDir: path.join(runtimeRoot, "config") };
  const marker = path.join(runtimeRoot, MARKER);
  if (fs.existsSync(runtimeRoot)) {
    files(runtimeRoot); // Refuse redirected data/config/cert files on reuse.
    if (!fs.existsSync(marker)) throw new Error("Refusing an existing runtime without the canonical ownership marker");
    const previous = json(marker);
    if (JSON.stringify(previous) !== JSON.stringify(binding)) throw new Error("Runtime belongs to a different world/content/input revision");
    noSymlinks(binding.dataDir); noSymlinks(binding.configDir);
    fs.chmodSync(runtimeRoot, 0o700);
    return binding;
  }
  fs.mkdirSync(binding.dataDir, { recursive: true });
  fs.chmodSync(runtimeRoot, 0o700);
  fs.mkdirSync(binding.configDir);
  for (const relative of dataFiles) {
    const destination = path.join(binding.dataDir, relative); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(inputData, relative), destination, fs.constants.COPYFILE_EXCL);
  }
  for (const name of ["evejs.config.json", "evejs.config.local.json"]) if (fs.existsSync(path.join(ROOT, name))) {
    fs.copyFileSync(path.join(ROOT, name), path.join(binding.configDir, name), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(binding.configDir, name), 0o600);
  }
  writeJson(path.join(binding.gameStoreRoot, "manifest.json"), generated);
  writeJson(marker, binding);
  return binding;
}

function environment(binding, port = 27600): NodeJS.ProcessEnv {
  if (!Number.isInteger(port) || port < 1024 || port > 65529) throw new Error("Port base must be an integer1024..65529");
  return { ...process.env, EVEJS_GAMESTORE_DATA_DIR: binding.dataDir, EVEJS_CONFIG_DIR: binding.configDir,
    EVEJS_EXPLORATION_WORLD_PATH: binding.worldPath, EVEJS_LANDSCAPE_CONTENT_PATH: binding.contentPath, EVEJS_TEMPORARY_LANDSCAPE_PATH: "",
    EVEJS_CANONICAL_RUNTIME_MARKER: path.join(binding.runtimeRoot, MARKER),
    EVEJS_RUNTIME_CERT_DIR: path.join(binding.runtimeRoot, "certs"), EVEJS_LOG_DIR: path.join(binding.runtimeRoot, "logs"), EVEJS_CHAT_DATA_ROOT: path.join(binding.runtimeRoot, "chat"),
    EVEJS_CLIENT_COMPATIBILITY_PROFILE: "frontier", EVEJS_CLIENT_BUILD: "3640684", EVEJS_CLIENT_VERSION: "20.04", EVEJS_EVE_BIRTHDAY: "170472", EVEJS_MACHO_VERSION: "489",
    EVEJS_PROJECT_CODENAME: "cycle-7", EVEJS_PROJECT_REGION: "ccp", EVEJS_PROJECT_VERSION: "V20.04@ccp",
    EVEJS_GAME_SERVER_BIND_HOST: "127.0.0.1", EVEJS_GAME_SERVER_HOST: "127.0.0.1", EVEJS_SERVER_PORT: String(port),
    EVEJS_IMAGE_SERVER_BIND_HOST: "127.0.0.1", EVEJS_IMAGE_SERVER_URL: `http://127.0.0.1:${port + 1}/`,
    EVEJS_MICROSERVICES_BIND_HOST: "127.0.0.1", EVEJS_MICROSERVICES_REDIRECT_URL: `http://127.0.0.1:${port + 2}/`, EVEJS_MICROSERVICES_PUBLIC_BASE_URL: `http://127.0.0.1:${port + 2}/`,
    EVEJS_REDSHIFT_MONITOR_HOST: "127.0.0.1", EVEJS_REDSHIFT_MONITOR_PORT: String(port + 4),
    EVEJS_XMPP_SERVER_BIND_HOST: "127.0.0.1", EVEJS_XMPP_CONNECT_HOST: "127.0.0.1", EVEJS_XMPP_SERVER_PORT: String(port + 5),
    EVEJS_XMPP_DOMAIN: "canonical.frontier.localhost", EVEJS_XMPP_CONFERENCE_DOMAIN: "conference.canonical.frontier.localhost",
    EVEJS_PROXY_LOOPBACK_CDN_LISTEN_PORT: "0", EVEJS_PROXY_UNHANDLED_HOST_POLICY: "block", EVEJS_PROXY_GATEWAY_MODE: "local",
    EVEJS_SUI_ASSEMBLY_SYNC_ENABLED: "false", EVEJS_SUI_CHARACTER_PROVISIONING_ENABLED: "false", EVEJS_SUI_NPC_CHARACTER_PROVISIONING_ENABLED: "false", EVEJS_NPC_PILOT_IDENTITIES_ENABLED: "false",
    EVEJS_WORMHOLES_ENABLED: "false", EVEJS_MARKET_DAEMON_ENABLED: "false", EVEJS_SKIP_NPC_STARTUP: "1", EVEJS_MINING_NPC_STARTUP_ENABLED: "false", EVEJS_NPC_AUTHORED_STARTUP: "false", EVEJS_NPC_DEFAULT_CONCORD_STARTUP: "false",
    EVEJS_NEW_EDEN_SYSTEM_LOADING: "4", EVEJS_ASTEROID_BELT_STARTUP_RESET: "false", EVEJS_LOG_LEVEL: "0" };
}

async function unusedPorts(base) {
  const held = [];
  try { for (let port = base; port <= base + 5; port++) {
    const server = net.createServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); held.push(server);
  } } finally { await Promise.all(held.map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
}

async function main(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    console.log("Usage: node scripts/FrontierWorld/canonical-runtime.js --mode prepare|validate|restart-check|smoke|serve [--world FILE] [--content FILE] [--generated DIR] [--runtime-root DIR] [--port-base 27600]"); return;
  }
  const args = {} as Record<string, string>;
  const allowed = new Set(["world", "content", "generated", "runtime-root", "mode", "port-base"]);
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].slice(2);
    if (!argv[i].startsWith("--") || !argv[i + 1] || !allowed.has(name) || Object.hasOwn(args, name)) throw new Error(`Invalid or repeated option ${argv[i]}`);
    args[name] = argv[i + 1];
  }
  const candidate = path.join(ROOT, "_local/frontier-worlds/3572727-for-3640684/candidate"), mode = args.mode || "validate";
  if (!["prepare", "validate", "restart-check", "serve", "smoke"].includes(mode)) throw new Error("Mode must be prepare, validate, restart-check, serve or smoke");
  const selection = selectCandidate(args.world || path.join(candidate, "world.json"), args.content || path.join(candidate, "content.json"));
  const runtimeRoot = args["runtime-root"] || path.join(candidate, "../runtimes", `${selection.baseRevision}-${selection.contentRevision}`);
  const binding = prepareRuntime(selection, args.generated || path.join(candidate, "generated"), runtimeRoot);
  console.log(JSON.stringify({ mode, runtimeRoot: binding.runtimeRoot, worldRevision: binding.worldRevision, clientBuild: 3640684 }));
  if (mode === "prepare") return;
  const port = Number(args["port-base"] || 27600), env = environment(binding, port);
  env.EVEJS_CANONICAL_RESTART_CHECK = mode === "restart-check" ? "1" : "";
  const lease = path.join(binding.runtimeRoot, ".process-lease.json"); writeJson(lease, { pid: process.pid });
  let child = null, stopped = null;
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000); timer.unref();
    try { if (stopped) await stopped.catch(() => {}); }
    finally { clearTimeout(timer); }
  }
  try {
    if (mode === "serve" || mode === "smoke") await unusedPorts(port);
    const worker = ["validate", "restart-check"].includes(mode) ? path.join(__dirname, "validate-canonical-runtime.js") : path.join(ROOT, "server/index.js");
    const logPath = path.join(binding.runtimeRoot, mode === "validate" ? "validation.log" : mode === "restart-check" ? "restart-check.log" : "server-smoke.log");
    const output = fs.openSync(logPath, "a", 0o600);
    child = spawn(process.execPath, ["--max-old-space-size=8192", "--enable-source-maps", worker], { cwd: ROOT, env, stdio: ["ignore", output, output] }); fs.closeSync(output);
    stopped = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
    const forward = signal => child?.kill(signal);
    process.once("SIGINT", forward); process.once("SIGTERM", forward);
    try {
      if (mode === "smoke") {
        const { smokeRuntime } = require("./validate-canonical-runtime");
        const report = await smokeRuntime({ binding, port, child });
        await stopChild();
        const result = await stopped;
        if (result.signal === "SIGKILL") throw new Error("Candidate required forced shutdown");
        report.shutdown = result;
        fs.writeFileSync(path.join(binding.runtimeRoot, "server-smoke-verification.json"), JSON.stringify(report, null, 2) + "\n");
      } else {
        const result = await stopped; if (result.code !== 0) throw new Error(`Candidate process exited ${result.code || result.signal}; see ${logPath}`);
      }
    } finally { process.removeListener("SIGINT", forward); process.removeListener("SIGTERM", forward); }
    console.log(`Candidate ${mode} completed; results under ${binding.runtimeRoot}`);
  } finally { await stopChild(); fs.unlinkSync(lease); }
}

module.exports = { FORMAT, MARKER, digest, selectCandidate, prepareRuntime, environment, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
