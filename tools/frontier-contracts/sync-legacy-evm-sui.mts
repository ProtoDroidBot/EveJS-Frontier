import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
const WORLD_FORMAT = "evejs-frontier-world-sync-v1";
const DEFAULT_MANIFEST = "legacy-evm-sui.private.json";

function builtModule(relativePath: string): any {
  try { return require(relativePath); }
  catch (error) {
    if (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(error?.code)) {
      throw new Error("EVM bridge factories or dependencies are missing. Install dependencies, then run npm run build:server and npm run build:tools before syncing.");
    }
    throw error;
  }
}

function readJSON(filePath: string, kind: string, missing = false): { value: any; bytes: Buffer } | null {
  let bytes: Buffer;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${kind} must be a regular file: ${filePath}`);
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if (missing && error?.code === "ENOENT") return null;
    throw error;
  }
  let value: any;
  try { value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
  catch { throw new Error(`${kind} contains malformed JSON: ${filePath}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${kind} must be a JSON object: ${filePath}`);
  return { value, bytes };
}

/** Offline world validation only. This never starts a client, chain or worker. */
function validateWorld(world: any, build: number, worldPath: string, prepareOnly: boolean) {
  if (world.format !== WORLD_FORMAT || world.schemaVersion !== 1 || world.build !== build || world.network !== "localnet" ||
      typeof world.state !== "string" || !["ready", "syncing", "starting", "stopping", "down", "error"].includes(world.state)) {
    throw new Error(`World configuration is malformed or targets another build: ${worldPath}`);
  }
  if (world.state !== "ready") {
    if (!prepareOnly) throw new Error(`Synchronize a ready Sui world before binding the EVM bridge: ${worldPath}`);
    return false;
  }
  // Use the server's parser so the offline deployment/artifact requirements do
  // not diverge from startup. It returns private data; none is logged or copied.
  const synced = builtModule("../../server/src/services/frontier/suiCharacterProvisioning.js").readSyncedSuiWorldConfig({
    ...process.env, EVEJS_CLIENT_BUILD: String(build), EVEJS_SUI_WORLD_CONFIG_PATH: worldPath,
  });
  if (!synced || synced.build !== build) throw new Error(`Sui world configuration could not be verified: ${worldPath}`);
  return true;
}

export interface LegacyEvmManifestSyncOptions {
  build: unknown;
  worldConfigPath: string;
  out?: string;
  apiUrl?: string;
  prepareOnly?: boolean;
  accounts?: Record<string, any>;
  items?: unknown[];
}

/**
 * Idempotently prepare/sync the private EVM adapter beside its exact-build Sui
 * world. World reference publication belongs to the calling setup transaction.
 */
export function syncLegacyEvmSuiManifest(input: LegacyEvmManifestSyncOptions) {
  const build = Number(input.build);
  if (!Number.isSafeInteger(build) || build <= 0) throw new Error("A positive exact client build is required");
  if (typeof input.worldConfigPath !== "string" || !input.worldConfigPath.trim()) throw new Error("--world-config is required");
  const worldPath = path.resolve(input.worldConfigPath);
  const { getLegacyEvmBuildAdapter } = builtModule("../../server/src/services/frontier/legacyEvmBuildAdapters.js");
  let adapter: any;
  try { adapter = getLegacyEvmBuildAdapter(build); }
  catch { return { clientBuild: build, enabled: false, manifestPath: null, created: false, changed: false,
    prepareOnly: input.prepareOnly === true, worldReady: false }; }
  const savedWorld = readJSON(worldPath, "World configuration", true);
  if (!savedWorld && !input.prepareOnly) throw new Error(`World configuration does not exist: ${worldPath}`);
  const worldReady = savedWorld ? validateWorld(savedWorld.value, build, worldPath, input.prepareOnly === true) : false;
  const reference = savedWorld?.value.legacyEvmBridgePath;
  if (reference !== undefined && (typeof reference !== "string" || !reference.trim())) throw new Error("World configuration has an invalid EVM bridge reference");
  const referencedPath = reference ? path.resolve(path.dirname(worldPath), reference) : null;
  const destination = input.out ? path.resolve(input.out) : referencedPath || path.join(path.dirname(worldPath), DEFAULT_MANIFEST);
  // An explicit destination is the operator's configured override. Following
  // the saved world reference is the default; this tool never changes it.
  const assertWorldSnapshot = () => {
    const current = readJSON(worldPath, "World configuration", true);
    if (Boolean(current) !== Boolean(savedWorld) || current && !current.bytes.equals(savedWorld!.bytes)) {
      throw new Error("World configuration changed during EVM manifest sync; retry with its current build and reference");
    }
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const lockPath = `${destination}.sync-lock`;
  let lock: number;
  try { lock = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Another EVM manifest sync is active, or its lock needs review: ${lockPath}`);
    throw error;
  }
  let temporary: string | undefined;
  try {
    const previous = readJSON(destination, "Existing EVM manifest", true);
    const manifest = builtModule("./convert-evm-build.mjs").prepareLegacyEvmBuildSynchronization({ build, existing: previous?.value,
      accounts: input.accounts, items: input.items,
      apiUrl: input.apiUrl });
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const changed = !previous || JSON.stringify(manifest) !== JSON.stringify(previous.value);
    if (changed) {
      temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
      const handle = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
      const current = readJSON(destination, "Existing EVM manifest", true);
      if (Boolean(current) !== Boolean(previous) || current && !current.bytes.equals(previous!.bytes)) {
        throw new Error("EVM manifest changed concurrently; refusing to replace credentials");
      }
      assertWorldSnapshot();
      if (previous) fs.renameSync(temporary, destination);
      else {
        // Atomic publication without overwriting a concurrently created file.
        fs.linkSync(temporary, destination);
        fs.unlinkSync(temporary);
      }
      temporary = undefined;
    }
    if (process.platform !== "win32") fs.chmodSync(destination, 0o600);
    assertWorldSnapshot();
    return { clientBuild: build, enabled: true, manifestPath: destination,
      created: !previous, changed, prepareOnly: input.prepareOnly === true, worldReady,
      workflow: adapter.workflow };
  } finally {
    if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    build: { type: "string" }, "world-config": { type: "string" }, "api-url": { type: "string" }, out: { type: "string" },
    "prepare-only": { type: "boolean" }, prepare: { type: "boolean" },
    accounts: { type: "string" }, item: { type: "string", multiple: true }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    process.stdout.write("Usage: node tools/frontier-contracts/sync-legacy-evm-sui.mjs --world-config world.private.json --build N [--prepare-only] [--api-url http://127.0.0.1:26102] [--out bridge.private.json]\n");
    return;
  }
  const result = syncLegacyEvmSuiManifest({ build: values.build, worldConfigPath: values["world-config"], out: values.out,
    apiUrl: values["api-url"], prepareOnly: values["prepare-only"] || values.prepare,
    accounts: values.accounts ? readJSON(path.resolve(values.accounts), "Account bindings")!.value : undefined,
    items: values.item });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(String(error?.message || error) + "\n"); process.exitCode = 1; }
}
