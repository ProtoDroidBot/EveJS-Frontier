import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildSuiAssemblySnapshot, type SuiAssemblySnapshotInput } from "./suiAssemblySnapshot";
import { createSuiAssemblyChain, suiAssemblyFields, suiAssemblyOption } from "./suiAssemblyChain";
import { createSuiAssemblyContents } from "./suiAssemblyContents";
import { buildSuiIndustrySnapshot, industryFingerprint } from "./suiIndustrySnapshot";
import { createSuiIndustryChain } from "./suiIndustryChain";
import { readSuiIndustryDeployment, assertSuiIndustryDeploymentCurrent } from "./suiIndustryDeployment";
import { createSuiIndustrySyncWorkerBridge, registerSuiIndustrySyncBridge, reconcileSuiIndustryFacilities } from "./suiIndustrySync";
import { createAssemblyTransactionExecutor } from "./suiAssemblyTransactions";
import { registerSuiStorageSyncBridge, type SuiStorageSyncRequest } from "./suiStorageSync";
import { registerSuiGateSyncBridge, type SuiGateSyncBridge } from "./suiGateSync";
import { createSponsoredAssemblyAdmin, registerSuiAssemblyAdminBridge } from "./suiAssemblyAdmin";
import { clearAssemblyEnergyConfig, setAssemblyEnergyConfig } from "./networkNodeEnergyConfig";
import { registerSuiAssemblyStateRunner, readSuiAssemblyStatusIntent } from "./suiAssemblyState";
import {
  readSyncedSuiWorldConfig, prepareSuiCharacterIdentity, createSuiCharacterTransaction,
} from "./suiCharacterProvisioning";

let trackedNetworkNodeBinding: ((itemId: string) => string | null) | null = null;
type EnergyMutationRunner = <T>(operation: () => T | Promise<T>) => Promise<T>;
let energyMutationRunner: EnergyMutationRunner | null = null;
/** Existing Move links cannot be detached without deleting their Network Node. */
export function getTrackedSuiAssemblyNetworkNodeID(itemId: string | number): string | null {
  return trackedNetworkNodeBinding?.(String(itemId)) ?? null;
}

export async function runSuiAssemblyEnergyMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  if (!energyMutationRunner) throw Object.assign(new Error("Assembly synchronization is unavailable"), { code: "DEPLOYMENT_UNAVAILABLE" });
  return energyMutationRunner(operation);
}

/** Connection writes share the queue with captured snapshots and anchor journals. */
export function createSuiAssemblyEnergyMutationRunner(options: {
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  getContext: () => any;
  hasPrepared: () => boolean;
}): EnergyMutationRunner {
  return operation => options.runExclusive(async () => {
    const context = options.getContext();
    if (!context || context.synced?.network !== "localnet") {
      throw Object.assign(new Error("Assembly deployment is unavailable"), { code: "DEPLOYMENT_UNAVAILABLE" });
    }
    if (options.hasPrepared() || context.executor?.hasPending()) {
      throw Object.assign(new Error("An assembly transaction is awaiting completion"), { code: "SPONSOR_BUSY" });
    }
    try { await context.assertCurrent(); }
    catch (error) { throw Object.assign(new Error("Assembly deployment changed", { cause: error }), { code: "DEPLOYMENT_UNAVAILABLE" }); }
    return operation();
  });
}

function gateFingerprint(assembly: any) {
  return JSON.stringify(assembly && {
    itemId: assembly.itemId, typeId: assembly.typeId, ownerId: assembly.ownerId,
    status: assembly.status, solarSystemId: assembly.solarSystemId, position: assembly.position,
    networkNodeId: assembly.networkNodeId, destinationGateId: assembly.destinationGateId,
    gateDistanceMeters: assembly.gateDistanceMeters, gateMaxDistanceMeters: assembly.gateMaxDistanceMeters,
  });
}

/** Gate reads and flushes share the existing journal and serialized worker. */
export function createSuiGateSyncWorkerBridge(options: {
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  runOnce: () => Promise<unknown>;
  getContext: () => any;
  getSnapshot: () => ReturnType<typeof buildSuiAssemblySnapshot>;
  getLastError: () => string;
  hasPrepared: () => boolean;
}): SuiGateSyncBridge {
  const readStatus: SuiGateSyncBridge["readStatus"] = request => options.runExclusive(async () => {
    const context = options.getContext();
    if (!context) throw new Error(options.getLastError() || "Sui assembly synchronization is starting");
    if (options.hasPrepared()) throw new Error("An assembly owner is signing a sponsored transaction; retry shortly");
    await context.assertCurrent();
    const snapshot = options.getSnapshot();
    const assembly = snapshot.assemblies.find(a => a.itemId === String(request.gateID) && a.kind === "gate");
    if (!assembly || assembly.ownerId !== request.characterID) throw new Error("Owned Smart Gate is not available for chain synchronization");
    const destination = snapshot.assemblies.find(a => a.itemId === assembly.destinationGateId && a.kind === "gate");
    const chain = await context.contents.getGateStatus(assembly, destination);
    await context.assertCurrent();
    const latest = options.getSnapshot();
    const current = [assembly, ...(destination ? [destination] : [])].every(expected =>
      gateFingerprint(latest.assemblies.find(a => a.itemId === expected.itemId)) === gateFingerprint(expected));
    const synchronized = current && chain.synchronized && !context.executor.hasPending();
    return { ...request, ...chain, synchronized, status: synchronized ? "synced" : "pending",
      ...(synchronized ? {} : { message: options.getLastError() || "Gate link is awaiting blockchain confirmation" }) };
  });
  return {
    readStatus,
    async flush(request) {
      // Join an in-flight scan, then capture the caller's latest local pair.
      await options.runOnce();
      await options.runOnce();
      return readStatus(request);
    },
  };
}

function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "w", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}

/** Serialized, retrying loop; deliberately has no dependency on the live store. */
export function createAssemblySyncWorker(options: {
  reconcile: () => Promise<unknown>;
  report: (message: string) => void;
  intervalMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let closing = false;
  let generation = 0;
  let running: Promise<void> | null = null;
  let exclusiveTail: Promise<void> | null = null;
  let lastError = "";
  function runExclusive<T>(action: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new Error("Assembly synchronization worker is stopped"));
    // Inventory status reads can resolve Character capabilities. Keep them on
    // the same queue as reconciliation and its single durable transaction log.
    // Invoke immediately when idle, but convert synchronous throws to rejected
    // promises just like errors from actions already waiting in the queue.
    const invoke = async () => action();
    const next = exclusiveTail ? exclusiveTail.then(invoke, invoke) : invoke();
    const settled = next.then(() => {}, () => {});
    exclusiveTail = settled;
    void settled.then(() => { if (exclusiveTail === settled) exclusiveTail = null; });
    return next;
  }
  async function runOnce() {
    if (running) return running;
    running = runExclusive(async () => {
      try {
        await options.reconcile();
        if (lastError) options.report("Smart Assembly synchronization recovered");
        lastError = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) options.report(message);
        lastError = message;
      }
    });
    try { await running; } finally { running = null; }
  }
  async function tick(token: number) {
    await runOnce();
    if (!stopped && token === generation) {
      timer = setTimeout(() => void tick(token), options.intervalMs ?? 5000);
      timer.unref?.();
    }
  }
  return {
    start() { if (stopped) { closing = false; stopped = false; void tick(++generation); } },
    stop() { closing = true; stopped = true; generation++; if (timer) clearTimeout(timer); return exclusiveTail ?? Promise.resolve(); },
    runOnce,
    runExclusive,
    getLastError() { return lastError; },
  };
}

export function assemblySyncEnabled(env: NodeJS.ProcessEnv, profile: string) {
  return profile === "frontier" && !["false", "0", "off", "no"].includes(String(env.EVEJS_SUI_ASSEMBLY_SYNC_ENABLED).trim().toLowerCase()) &&
    !env.NODE_TEST_CONTEXT && !env.EVEJS_TEST_STORE_ISOLATED &&
    !env.EVEJS_TEST_STORE_BASELINE_ROOT && !env.EVEJS_TEST_FRONTIER_FIXTURES;
}

/** Resolve exhaustion against the same persisted binding/nearest-node rules as anchoring. */
export function findFuelDepletedAssemblyIds(input: SuiAssemblySnapshotInput): string[] {
  const online = new Set<string>();
  let hasEmptyOfflineNode = false;
  const items = Object.fromEntries(Object.entries(input.items).map(([key, item]) => {
    if (!item || typeof item !== "object") return [key, item];
    let info;
    try { info = typeof item.customInfo === "string" ? JSON.parse(item.customInfo) : item.customInfo; }
    catch { return [key, item]; }
    const construction = info?.evejsFrontierConstruction;
    if (!construction) return [key, item];
    if (Number(item.typeID) === 88092) {
      if (Number(construction.assemblyStatus) === 1 && Number(info.evejsFrontierNetworkNodeFuel?.quantity ?? 0) === 0) {
        hasEmptyOfflineNode = true;
      }
      return [key, item];
    }
    if (Number(construction.assemblyStatus) !== 2) return [key, item];
    online.add(String(item.itemID ?? key));
    // Only the provisional binding lookup uses an offline copy. Persist changes
    // later through deploymentRuntime so the client receives normal notices.
    return [key, { ...item, customInfo: { ...info, evejsFrontierConstruction: { ...construction, assemblyStatus: 1 } } }];
  }));
  if (!hasEmptyOfflineNode || !online.size) return [];
  const provisional = buildSuiAssemblySnapshot({ ...input, items });
  const exhausted = new Set(provisional.assemblies.filter(a =>
    a.kind === "network_node" && a.status === 1 && a.fuel.quantity === 0).map(a => a.itemId));
  return provisional.assemblies.filter(a => online.has(a.itemId) &&
    a.networkNodeId !== null && exhausted.has(a.networkNodeId)).map(a => a.itemId);
}

/** Identity validation must remain possible when cached node/child statuses disagree. */
export function buildSuiAssemblyIdentitySnapshot(input: SuiAssemblySnapshotInput) {
  const items = Object.fromEntries(Object.entries(input.items).map(([key, item]) => {
    let info = item?.customInfo;
    try { if (typeof info === "string") info = JSON.parse(info); } catch { return [key, item]; }
    const state = info?.evejsFrontierConstruction;
    if (!state || ![1, 2].includes(Number(state.assemblyStatus))) return [key, item];
    return [key, { ...item, customInfo: { ...info, evejsFrontierConstruction: { ...state, assemblyStatus: 1 } } }];
  }));
  return buildSuiAssemblySnapshot({ ...input, items });
}

/** Import confirmed counters with status, using the same verified node object. */
export async function refreshSuiAssemblyChainStates(context: any, currentSnapshotInput: () => SuiAssemblySnapshotInput, assemblyID?: number) {
  await context.assertCurrent();
  const identities = buildSuiAssemblyIdentitySnapshot(currentSnapshotInput());
  let assemblies = identities.assemblies;
  const requested = assemblyID === undefined ? null : assemblies.find(a => a.itemId === String(assemblyID));
  if (assemblyID !== undefined) {
    if (!requested) throw new Error("Assembly is not available for chain state verification");
    // This runner also serves fuel reads/transfers. Unrelated child requests
    // must not block the node; the full worker scan refreshes those children.
    assemblies = assemblies.filter(a => a.itemId === requested.itemId || a.itemId === requested.networkNodeId);
  }
  for (const assembly of assemblies) {
    if (assembly.kind === "network_node") context.clearEnergy(assembly);
    const intent = context.getStatusIntent(assembly);
    const state = await context.chain.readAssembly(assembly);
    if (!state) {
      if (assemblyID !== undefined) {
        throw new Error("Assembly is not anchored on the current chain");
      }
      continue;
    }
    const fuel = assembly.kind === "network_node" ? await context.chain.readFuelState(assembly, state) : null;
    const energy = assembly.kind === "network_node" ? await context.chain.readEnergyState(assembly, state) : null;
    await context.assertCurrent();
    const latest = buildSuiAssemblyIdentitySnapshot(currentSnapshotInput()).assemblies.find(a => a.itemId === assembly.itemId);
    if (JSON.stringify(latest) !== JSON.stringify(assembly)) throw new Error("Assembly changed during chain state verification");
    if (fuel) context.projectFuel(assembly, fuel);
    if (energy) context.projectEnergy(assembly, energy);
    const status = state.online ? 2 : 1;
    if (intent && intent.targetStatus !== status) {
      if (assemblyID !== undefined) throw Object.assign(new Error("Assembly state transition is pending"), { code: "ASSEMBLY_STATE_PENDING" });
      continue;
    }
    if (!context.projectStatus(assembly, status, intent?.id ?? null)) {
      throw Object.assign(new Error("Assembly state transition changed during verification"), { code: "ASSEMBLY_STATE_PENDING" });
    }
  }
}

/** Mirror game contents while changing chain status only for explicit lifecycle requests. */
export async function reconcileSuiAssemblies(snapshot: any, context: any, localItemIds: Set<string>) {
  await context.assertCurrent();
  await context.executor.recover();
  const failures = snapshot.errors.map((error: any) => error.message);
  const ready: any[] = [];
  const statusRequests = new Map<string, string | null>();
  const temporary = context.state.temporaryStatuses ??= {};
  const syncFuel = (assembly: any) => context.syncFuel
    ? context.syncFuel(assembly) : context.chain.syncFuel(assembly);
  async function syncDesiredStatus(assembly: any) {
    if (context.statusAuthority && !statusRequests.has(assembly.itemId) && temporary[assembly.itemId] === undefined) return;
    if (context.statusAuthority && !statusRequests.has(assembly.itemId) && temporary[assembly.itemId] !== undefined) {
      assembly = { ...assembly, status: temporary[assembly.itemId] };
    }
    const intentID = statusRequests.get(assembly.itemId) ?? null;
    const assertCurrent = () => {
      if (context.statusAuthority && (context.getStatusIntent(assembly)?.id ?? null) !== intentID) {
        throw new Error(`Assembly ${assembly.itemId} status request changed during synchronization`);
      }
    };
    assertCurrent();
    await context.chain.syncStatus(assembly, assertCurrent);
    if (context.statusAuthority) {
      const confirmed = await context.chain.readAssembly(assembly);
      if (!confirmed || confirmed.online !== (assembly.status === 2)) throw new Error(`Assembly ${assembly.itemId} status was not confirmed`);
      await context.assertCurrent();
      if (localItemIds.has(assembly.itemId) && !context.projectStatus(assembly, assembly.status, intentID)) {
        throw new Error(`Assembly ${assembly.itemId} status request changed before confirmation was saved`);
      }
      statusRequests.delete(assembly.itemId);
      delete temporary[assembly.itemId];
      context.save();
    }
  }
  const attempt = async (label: string, action: () => Promise<unknown>) => {
    try { await action(); return true; }
    catch (error: any) {
      if (context.executor.hasPending()) throw error;
      failures.push(`${label}: ${error.message}`); return false;
    }
  };
  for (const assembly of snapshot.assemblies) {
    if (await attempt(assembly.itemId, async () => {
      if (assembly.kind !== "network_node" && !ready.some(a => a.itemId === assembly.networkNodeId && a.kind === "network_node")) {
        throw new Error("Parent Network Node has not synchronized successfully");
      }
      await context.getCharacter(assembly.ownerId);
      // Persist the intended binding before an anchor can commit. This closes the
      // restart gap between an on-chain commit and saving its local identity.
      if (JSON.stringify(context.state.assemblies[assembly.itemId]) !== JSON.stringify(assembly)) {
        context.state.assemblies[assembly.itemId] = assembly;
        context.save();
      }
      if (context.statusAuthority) {
        let intent = context.getStatusIntent(assembly);
        const existing = await context.chain.readAssembly(assembly);
        if (!existing && !intent) intent = context.requestInitialStatus?.(assembly) ?? null;
        if (!existing && assembly.kind === "network_node") context.initializeFuel?.(assembly);
        if (intent || !existing) statusRequests.set(assembly.itemId, intent?.id ?? null);
      }
      await context.chain.ensureAssembly(assembly);
    })) ready.push(assembly);
  }
  const removed: any[] = [];
  const retirementNodes: any[] = [];
  for (const assembly of Object.values<any>(context.state.assemblies).filter(a => !localItemIds.has(a.itemId))) {
    await attempt(`inspect removed ${assembly.itemId}`, async () => {
      let current;
      try { current = await context.chain.readAssembly(assembly); }
      catch (error: any) { if (error.code !== "CHAIN_ASSEMBLY_TOMBSTONE") throw error; }
      if (!current) {
        delete context.state.assemblies[assembly.itemId];
        context.save();
        return;
      }
      removed.push(assembly);
      if (context.statusAuthority) statusRequests.set(assembly.itemId, null);
      if (assembly.kind === "network_node") {
        const fuel = suiAssemblyFields(current.fields.fuel);
        const quantity = Number(fuel.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Retired node fuel quantity is outside the local range");
        retirementNodes.push({ ...assembly, fuel: {
          quantity, typeId: Number(suiAssemblyOption(fuel.type_id) ?? 0),
          unitVolume: String(suiAssemblyOption(fuel.unit_volume) ?? 0),
        } });
      }
    });
  }
  const nodes = ready.filter(a => a.kind === "network_node");
  const fuelReady = new Set<string>();
  for (const node of [...nodes, ...retirementNodes]) {
    if (await attempt(node.itemId, async () => {
      if (node.fuel.quantity > 0) {
        const efficiency = context.fuelEfficiencies.get(node.fuel.typeId);
        if (efficiency === undefined) throw new Error(`No local fuel efficiency for type ${node.fuel.typeId}`);
        await context.chain.configureFuelEfficiency(node.fuel.typeId, efficiency);
      }
      // Stop the node and its connected assemblies atomically before mirroring
      // an exhausted tank. The chain adapter neutralizes the legacy burn clock.
      if (node.status === 1 && !context.fuelAuthority) await syncDesiredStatus(node);
      await syncFuel(node);
      if (node.status === 1 && context.fuelAuthority) await syncDesiredStatus(node);
    })) {
      fuelReady.add(node.itemId);
      if (node.status === 2 && nodes.includes(node)) await attempt(node.itemId, () => syncDesiredStatus(node));
    }
  }
  await attempt("gate links", () => context.contents.syncGateLinks([
    ...ready, ...removed.map(a => ({ ...a, destinationGateId: null })),
  ]));
  async function syncStorage(assembly: any) {
    if (assembly.kind !== "storage_unit" || !await context.contents.hasInventoryChanges(assembly)) return;
    const node = [...nodes, ...retirementNodes].find(n => n.itemId === assembly.networkNodeId);
    if (!node) throw new Error("Storage Network Node is not synchronized");
    if (!fuelReady.has(node.itemId)) throw new Error("Storage Network Node fuel is not synchronized");
    const needOnline = new Set<string>([node.itemId, assembly.itemId]);
    if (context.statusAuthority) {
      // Save restoration before a temporary online transaction can commit.
      // Restart recovery restores these states before importing chain observations.
      // Read again immediately before this operation: an external owner action
      // may have changed status since the beginning of the mirror pass.
      for (const target of [node, assembly]) {
        const current = await context.chain.readAssembly(target);
        if (!current) throw new Error(`Assembly ${target.itemId} disappeared before inventory synchronization`);
        if (current.online) needOnline.delete(target.itemId);
        if (!current.online) temporary[target.itemId] ??= statusRequests.has(target.itemId) ? target.status : 1;
      }
      await context.assertCurrent();
      context.save();
    }
    if (needOnline.has(node.itemId)) await context.chain.syncStatus({ ...node, status: 2 });
    if (needOnline.has(assembly.itemId)) await context.chain.syncStatus({ ...assembly, status: 2 });
    await context.contents.syncInventory(assembly);
  }
  for (const assembly of ready.filter(a => a.kind !== "network_node")) {
    await attempt(assembly.itemId, async () => {
      try { await syncStorage(assembly); }
      finally { if (!context.executor.hasPending()) await syncDesiredStatus(assembly); }
    });
  }
  // Only remove verified identities this runtime tracked, never unrelated chain objects.
  for (const assembly of removed.sort((a, b) => Number(a.kind === "network_node") - Number(b.kind === "network_node"))) {
    await attempt(`remove ${assembly.itemId}`, async () => {
      if (assembly.kind === "network_node" && Object.values<any>(context.state.assemblies).some(a => a.networkNodeId === assembly.itemId)) {
        throw new Error("Dependent assemblies must finish removal before retiring their Network Node");
      }
      try { if (assembly.kind === "storage_unit") await syncStorage({ ...assembly, status: 1, inventory: [] }); }
      finally { if (!context.executor.hasPending()) await context.chain.syncStatus({ ...assembly, status: 1 }); }
      if (assembly.kind === "network_node") {
        await syncFuel({ ...assembly, fuel: { typeId: 0, quantity: 0, unitVolume: "0" } });
      }
      await context.chain.removeAssembly(assembly);
      delete context.state.assemblies[assembly.itemId];
      delete temporary[assembly.itemId];
      context.save();
    });
  }
  for (const node of nodes) {
    if (fuelReady.has(node.itemId)) {
      await attempt(node.itemId, () => syncDesiredStatus(node));
      await attempt(node.itemId, () => syncFuel(node));
    }
  }
  context.state.updatedAt = new Date().toISOString();
  context.state.errors = failures;
  context.save();
  if (failures.length) throw new Error(failures.join("; "));
}

/** Called once by the native Frontier server after its persistent store is loaded. */
export function startSuiAssemblySync() {
  const config = require("../../config");
  if (!assemblySyncEnabled(process.env, config.clientCompatibilityProfile)) return null;
  const database = require("../../gameStore");
  const itemStore = require("../inventory/itemStore");
  const networkNodeFuelRuntime = require("./networkNodeFuelRuntime");
  const deploymentRuntime = require("./deploymentRuntime");
  const energyRuntime = require("./networkNodeEnergyRuntime");
  const characterState = require("../character/characterState");
  const { TABLE, readStaticRows } = require("../_shared/referenceData");
  const log = require("../../utils/logger");
  const env = {
    ...process.env,
    EVEJS_SUI_WORLD_CONFIG_PATH: process.env.EVEJS_SUI_WORLD_CONFIG_PATH ||
      path.resolve(__dirname, "../../../../_local/frontier-world", String(config.clientBuild), "world.private.json"),
  };
  const root = path.join(path.dirname(database._sqliteDbPath), "sui-assembly-sync");
  // O_EXCL prevents two servers from submitting different deltas to this runtime.
  const lockPath = path.join(root, "worker.lock");
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid assembly sync worker lock");
    let active = true;
    try { process.kill(pid, 0); } catch (error: any) { if (error.code === "ESRCH") active = false; }
    if (active) throw new Error(`Assembly synchronization is already owned by process ${pid}`);
    fs.unlinkSync(lockPath);
  }
  fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  let context: any = null;
  let lastSummary = "";
  trackedNetworkNodeBinding = itemId => {
    const current = readSyncedSuiWorldConfig(env);
    if (!context || !current || current.chainId !== context.synced.chainId || current.packageId !== context.synced.packageId) return null;
    return context.state.assemblies[itemId]?.networkNodeId ?? null;
  };
  const industryEnv = () => ({ ...process.env, EVEJS_SUI_WORLD_CONFIG_PATH: env.EVEJS_SUI_WORLD_CONFIG_PATH });

  function currentSnapshotInput(): SuiAssemblySnapshotInput {
    return {
      items: itemStore.getAllItems(),
      characters: characterState.listCharacterIDs().map((id: number) => ({ ...characterState.getCharacterRecord(id), characterID: id })),
      components: readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE),
      itemTypes: readStaticRows(TABLE.ITEM_TYPES), solarSystems: readStaticRows(TABLE.SOLAR_SYSTEMS),
      networkNodeBindings: Object.fromEntries(Object.values<any>(context?.state.assemblies || {}).filter(a => a.networkNodeId).map(a => [a.itemId, a.networkNodeId])),
    };
  }

  function inventoryFingerprint(assembly: any) {
    return JSON.stringify(assembly && {
      itemId: assembly.itemId, typeId: assembly.typeId, ownerId: assembly.ownerId,
      status: assembly.status, networkNodeId: assembly.networkNodeId,
      inventory: assembly.inventory,
    });
  }

  async function makeContext(synced: any, snapshot: any) {
    const industryDeployment = readSuiIndustryDeployment(synced, industryEnv());
    if (!synced.sourceWorkspace) throw new Error("Assembly synchronization requires FrontierWorld.ps1 sync deployment artifacts");
    const contracts = path.join(synced.sourceWorkspace, "world-contracts");
    const deployment = JSON.parse(fs.readFileSync(path.join(contracts, "deployments/localnet/extracted-object-ids.json"), "utf8"));
    const publication = JSON.parse(fs.readFileSync(path.join(contracts, "deployments/localnet/world_package.json"), "utf8"));
    const changes = publication.objectChanges || publication.object_changes || [];
    const locationRegistryId = deployment.world.locationRegistry || changes.find((change: any) =>
      change.type === "created" && change.objectType === `${synced.packageId}::location::LocationRegistry`)?.objectId;
    if (!locationRegistryId) throw new Error("Deployed LocationRegistry was not found");
    const world = {
      packageId: synced.packageId, objectRegistryId: synced.objectRegistryId, adminAclId: synced.adminAclId,
      energyConfigId: deployment.world.energyConfig, fuelConfigId: deployment.world.fuelConfig,
      gateConfigId: deployment.world.gateConfig, serverAddressRegistryId: deployment.world.serverAddressRegistry,
      locationRegistryId,
    };
    const client = new SuiJsonRpcClient({ url: "http://127.0.0.1:9000", network: "localnet" });
    const locationRegistry = await client.getObject({ id: locationRegistryId, options: { showType: true } });
    if (locationRegistry.data?.type !== `${synced.packageId}::location::LocationRegistry`) {
      throw new Error("The deployed LocationRegistry does not exist on the current chain");
    }
    const adminSigner = Ed25519Keypair.fromSecretKey(synced.adminPrivateKey);
    let characters = new Map<number, any>(snapshot.characters.map((character: any) => [character.gameCharacterId, character]));
    const statePath = path.join(root, `${synced.chainId}-${synced.packageId}.state.json`);
    const state: any = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { assemblies: {} };
    async function assertCurrent() {
      const current = readSyncedSuiWorldConfig(env);
      if (!current || current.chainId !== synced.chainId || current.packageId !== synced.packageId ||
          current.objectRegistryId !== synced.objectRegistryId || current.adminAclId !== synced.adminAclId ||
          (await client.getChainIdentifier()).toLowerCase() !== synced.chainId) {
        throw new Error("Sui deployment changed; run FrontierWorld.ps1 sync before retrying assemblies");
      }
      assertSuiIndustryDeploymentCurrent(industryDeployment, current, industryEnv());
    }
    function localCharacter(ownerId: number) {
      const current = characterState.getCharacterRecord(ownerId);
      if (!current) return null;
      return characters.get(ownerId) || {
        accountId: current.accountId ?? current.accountID,
        gameCharacterId: ownerId, characterName: current.characterName ?? current.name,
      };
    }
    function getSigner(ownerId: number) {
      const character = localCharacter(ownerId);
      if (!character) throw new Error(`Local Character ${ownerId} is missing`);
      if (!Number.isSafeInteger(Number(character.accountId)) || Number(character.accountId) <= 0) throw new Error(`Local Character ${ownerId} account is invalid`);
      const seed = createHash("sha512").update(`dev:${character.accountId}`, "utf8").digest("hex");
      return Ed25519Keypair.deriveKeypairFromSeed(seed);
    }
    const executor = createAssemblyTransactionExecutor({
      client, chainId: synced.chainId, packageId: synced.packageId, adminSigner, getSigner, assertCurrent,
      journalPath: path.join(root, `${synced.chainId}-${synced.packageId}.transactions.json`),
      onCommitted: (digest, label) => log.info(`[SuiAssemblySync] ${label}: ${digest}`),
      reconcileSponsored: async metadata => { deploymentRuntime.reconcileSponsoredAssemblyState(metadata); },
      reconcileCommitted: async label => {
        // A confirmed lifecycle transaction may have reserved or released energy.
        // Until it is reread, the previous observation cannot authorize new use.
        energyRuntime.clearSuiNetworkNodeEnergy();
        const match = /^assembly:(\d+):fuel:([^:]+)$/.exec(label);
        if (match) networkNodeFuelRuntime.acknowledgeSuiNetworkNodeFuel(Number(match[1]), match[2]);
      },
    });
    let snapshotItemIds = new Set<string>();
    let snapshotNodeStatuses = new Map<string, number>();
    const deploymentKey = `${synced.chainId}:${synced.packageId}:${synced.objectRegistryId}`;
    const chain = createSuiAssemblyChain({ client, world, execute: executor.execute, tenant: "dev", fuelAuthority: true,
      assertFuelSnapshotCurrent(assembly) {
        // Retiring nodes intentionally have no local item. Live snapshot nodes
        // must retain their quantity throughout asynchronous transaction builds.
        if (!snapshotItemIds.has(assembly.itemId)) return;
        const item = itemStore.findItemById(Number(assembly.itemId));
        if (!item) throw new Error(`Network node ${assembly.itemId} was removed during synchronization; retry the current snapshot`);
        if (Number(item.ownerID) !== assembly.ownerId ||
            deploymentRuntime.readConstructionState(item)?.assemblyStatus !== snapshotNodeStatuses.get(assembly.itemId)) {
          throw new Error(`Network node ${assembly.itemId} state changed during synchronization; retry the current snapshot`);
        }
        const fuel = networkNodeFuelRuntime.readNetworkNodeFuelState(item);
        if ((networkNodeFuelRuntime.readSuiNetworkNodeFuelIntent(item)?.id ?? null) !== (assembly.fuelIntent?.id ?? null)) {
          throw new Error(`Network node ${assembly.itemId} fuel transfer changed during synchronization`);
        }
        if (fuel.quantity !== assembly.fuel.quantity ||
            (fuel.quantity > 0 && fuel.typeID !== assembly.fuel.typeId)) {
          throw new Error(`Network node ${assembly.itemId} fuel changed during synchronization; retry the current snapshot`);
        }
      },
    });
    async function getCharacter(ownerId: number, allowCreate = true) {
      const local = localCharacter(ownerId);
      if (!local) throw new Error(`Local Character ${ownerId} is missing`);
      const identity = prepareSuiCharacterIdentity(local, { world: { ...world, tenant: "dev", tribeId: 100 } });
      let response = await client.getObject({ id: identity.characterObjectId, options: { showContent: true, showOwner: true } });
      if (allowCreate && response.error?.code === "notExists") {
        await executor.execute(`create Character ${ownerId}`, createSuiCharacterTransaction(identity));
        response = await client.getObject({ id: identity.characterObjectId, options: { showContent: true, showOwner: true } });
      }
      const content: any = response.data?.content;
      const fields = content?.fields;
      if (content?.type !== `${world.packageId}::character::Character` ||
          fields?.character_address !== identity.walletAddress ||
          String(fields?.key?.fields?.id ?? fields?.key?.fields?.item_id) !== String(ownerId) || fields?.key?.fields?.tenant !== "dev") {
        throw new Error(`On-chain Character ${ownerId} does not match its local account`);
      }
      return { id: identity.characterObjectId, address: identity.walletAddress, ownerCapId: fields.owner_cap_id };
    }
    const contents = createSuiAssemblyContents({ client, world, chain, execute: executor.execute, serverSigner: adminSigner, getCharacter,
      assertGateSnapshotCurrent(assembly) {
        const latest = buildSuiAssemblySnapshot(currentSnapshotInput()).assemblies.find(a => a.itemId === assembly.itemId);
        // Retirement deliberately unlinks an item removed from the local store.
        if (!latest && !itemStore.findItemById(Number(assembly.itemId)) && !assembly.destinationGateId) return;
        if (gateFingerprint(latest) !== gateFingerprint(assembly)) {
          throw new Error(`Gate ${assembly.itemId} changed during synchronization; retry the current snapshot`);
        }
      },
      assertInventorySnapshotCurrent(assembly) {
        const latest = buildSuiAssemblySnapshot(currentSnapshotInput()).assemblies.find(a => a.itemId === assembly.itemId);
        // Retiring an already removed unit intentionally empties its partition.
        if (!latest && !itemStore.findItemById(Number(assembly.itemId)) && assembly.inventory.length === 0) return;
        if (inventoryFingerprint(latest) !== inventoryFingerprint(assembly)) {
          throw new Error(`Storage ${assembly.itemId} inventory changed during synchronization; retry the current snapshot`);
        }
      },
    });
    const industry = createSuiIndustryChain({ client, world, chain, tenant: "dev", execute: executor.execute,
      industryPackageId: industryDeployment.industryPackageId,
      industryTypeOrigin: industryDeployment.industryTypeOrigin,
      assertSnapshotCurrent(facility) {
        const latest = buildSuiIndustrySnapshot(itemStore.getAllItems()).facilities.find(f => f.itemId === facility.itemId);
        if (industryFingerprint(latest) !== industryFingerprint(facility)) {
          throw new Error(`Industry ${facility.itemId} changed during synchronization; retry the current snapshot`);
        }
      },
    });
    await assertCurrent();
    return {
      synced, world, chain, contents, industry, industryDeployment, executor, state, assertCurrent, getCharacter,
      statusAuthority: true,
      fuelAuthority: true,
      initializeFuel(assembly: any) {
        assembly.fuelIntent = networkNodeFuelRuntime.initializeSuiNetworkNodeFuel(Number(assembly.itemId), deploymentKey) ?? undefined;
      },
      projectFuel(assembly: any, fuel: any) {
        return networkNodeFuelRuntime.projectSuiNetworkNodeFuel(Number(assembly.itemId), fuel, deploymentKey);
      },
      projectEnergy(assembly: any, energy: any) {
        energyRuntime.projectSuiNetworkNodeEnergy(Number(assembly.itemId), energy);
      },
      clearEnergy(assembly: any) {
        energyRuntime.clearSuiNetworkNodeEnergy(Number(assembly.itemId));
      },
      async syncFuel(assembly: any) {
        const item = itemStore.findItemById(Number(assembly.itemId));
        if (!item) {
          // Retirement is an explicit removal, so drain the current chain reserve.
          if (assembly.fuel.quantity !== 0) return;
          const fuel = await chain.readFuelState(assembly);
          if (fuel.quantity > 0) await chain.syncFuel({ ...assembly, fuelIntent: {
            id: "retire", typeID: fuel.typeID, quantityDelta: -fuel.quantity,
          } });
          return;
        }
        assembly.fuelIntent = networkNodeFuelRuntime.readSuiNetworkNodeFuelIntent(item) ?? undefined;
        await chain.syncFuel(assembly);
        delete assembly.fuelIntent;
        const fuel = await chain.readFuelState(assembly);
        await assertCurrent();
        const current = itemStore.findItemById(Number(assembly.itemId));
        if (!current || Number(current.ownerID) !== assembly.ownerId || Number(current.typeID) !== assembly.typeId ||
            Number(current.locationID) !== assembly.solarSystemId || networkNodeFuelRuntime.readSuiNetworkNodeFuelIntent(current)) {
          throw new Error(`Network node ${assembly.itemId} changed before its confirmed fuel could be saved`);
        }
        const updated = networkNodeFuelRuntime.projectSuiNetworkNodeFuel(Number(assembly.itemId), fuel, deploymentKey);
        const local = networkNodeFuelRuntime.readNetworkNodeFuelState(updated);
        assembly.fuel = { typeId: local.typeID, quantity: local.quantity, unitVolume: local.quantity > 0 ? fuel.unitVolume : "0" };
      },
      requestInitialStatus(assembly: any) { return deploymentRuntime.recordInitialSuiAssemblyState(assembly); },
      getStatusIntent(assembly: any) { return readSuiAssemblyStatusIntent(itemStore.findItemById(Number(assembly.itemId))); },
      projectStatus(assembly: any, status: number, intentID: string | null = null) {
        const applied = deploymentRuntime.reconcileSuiAssemblyState(assembly, status, intentID);
        if (applied && assembly.kind === "network_node") snapshotNodeStatuses.set(assembly.itemId, status);
        return applied;
      },
      async simulateSponsored(bytes: string) {
        const result = await client.dryRunTransactionBlock({ transactionBlock: Buffer.from(bytes, "base64") });
        if (result.effects?.status?.status !== "success") {
          throw Object.assign(new Error("Assembly state changed or the sponsored transaction cannot execute"), { code: "ASSEMBLY_STATE_CHANGED" });
        }
      },
      fuelEfficiencies: new Map(require("./networkNodeFuelRuntime").getNetworkNodeFuelConfig().map((entry: any) => [entry.typeID, entry.efficiency])),
      setCharacters(rows: any[]) { characters = new Map(rows.map(character => [character.gameCharacterId, character])); },
      setSnapshotItemIds(ids: Set<string>, assemblies: any[]) {
        snapshotItemIds = ids;
        snapshotNodeStatuses = new Map(assemblies.filter(a => a.kind === "network_node").map(a => [a.itemId, a.status]));
      },
      save() { atomicJson(statePath, state); },
    };
  }

  async function restoreTemporaryStatuses() {
    const entries = Object.entries<number>(context.state.temporaryStatuses || {});
    if (!entries.length) return;
    const input = currentSnapshotInput();
    const identities = buildSuiAssemblyIdentitySnapshot(input);
    context.setSnapshotItemIds(new Set(Object.values<any>(input.items).map(item => String(item.itemID))),
      buildSuiAssemblySnapshot(input).assemblies);
    // Children first; restoring an offline node cascades to its children atomically.
    const restores = entries.map(([itemId, status]) => {
      const assembly = identities.assemblies.find(a => a.itemId === itemId) || context.state.assemblies[itemId];
      if (!assembly) throw new Error(`Cannot recover temporary assembly status ${itemId}`);
      const intent = context.getStatusIntent(assembly);
      return { assembly: { ...assembly, status: intent?.targetStatus ?? status }, intent };
    }).sort((a, b) => Number(a.assembly.kind === "network_node") - Number(b.assembly.kind === "network_node"));
    for (const restoration of restores) {
      const { intent } = restoration;
      let assembly = restoration.assembly;
      if (assembly.kind === "network_node" && !itemStore.findItemById(Number(assembly.itemId))) {
        const state = await context.chain.readAssembly(assembly);
        if (!state) {
          delete context.state.temporaryStatuses[assembly.itemId];
          context.save();
          continue;
        }
        const fuel = suiAssemblyFields(state.fields.fuel);
        const quantity = Number(fuel.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Retired node fuel quantity is outside the local range");
        assembly = { ...assembly, fuel: { quantity, typeId: Number(suiAssemblyOption(fuel.type_id) ?? 0),
          unitVolume: String(suiAssemblyOption(fuel.unit_volume) ?? 0) } };
      }
      const assertCurrent = () => {
        if ((context.getStatusIntent(assembly)?.id ?? null) !== (intent?.id ?? null)) throw new Error("Assembly status request changed during recovery");
      };
      await context.chain.syncStatus(assembly, assertCurrent);
      const confirmed = await context.chain.readAssembly(assembly);
      if (!confirmed || confirmed.online !== (assembly.status === 2)) throw new Error("Temporary assembly status recovery was not confirmed");
      await context.assertCurrent();
      if (itemStore.findItemById(Number(assembly.itemId)) && !context.projectStatus(assembly, assembly.status, intent?.id ?? null)) {
        throw new Error("Assembly status request changed before recovery was saved");
      }
      delete context.state.temporaryStatuses[assembly.itemId];
      context.save();
    }
  }

  async function refreshChainStates(assemblyID?: number) {
    await refreshSuiAssemblyChainStates(context, currentSnapshotInput, assemblyID);
  }
  const worker = createAssemblySyncWorker({
    report: (message) => log.warn(`[SuiAssemblySync] ${message}`),
    async reconcile() {
      const synced = readSyncedSuiWorldConfig(env);
      if (!synced) {
        clearAssemblyEnergyConfig();
        energyRuntime.clearSuiNetworkNodeEnergy();
        throw new Error("Run FrontierWorld.ps1 sync to enable automatic Smart Assembly synchronization");
      }
      const industryDeployment = readSuiIndustryDeployment(synced, industryEnv());
      if (!context || context.synced.chainId !== synced.chainId || context.synced.packageId !== synced.packageId ||
          context.synced.objectRegistryId !== synced.objectRegistryId || context.synced.adminAclId !== synced.adminAclId ||
          context.industryDeployment.fingerprint !== industryDeployment.fingerprint) {
        clearAssemblyEnergyConfig();
        energyRuntime.clearSuiNetworkNodeEnergy();
        context = await makeContext(synced, { characters: [] });
      }
      // Recover and apply any confirmed owner operation BEFORE capturing the
      // mirror snapshot, otherwise stale local status would undo the wallet action.
      await context.executor.recover();
      if (sponsoredAdmin.hasPrepared()) return;
      await restoreTemporaryStatuses();
      await refreshChainStates();
      // Replace the shared cache only after a complete successful read. A
      // transient RPC failure preserves the last valid table for this world.
      await context.assertCurrent();
      const energyRequirements = await context.chain.readEnergyRequirements();
      await context.assertCurrent();
      setAssemblyEnergyConfig(energyRequirements, {
        energyConfigID: context.world.energyConfigId, chainId: synced.chainId,
      });
      networkNodeFuelRuntime.settleAllNetworkNodeFuel(Date.now());
      const snapshotInput = currentSnapshotInput();
      let rawItems = snapshotInput.items;
      const depletedDependents = findFuelDepletedAssemblyIds(snapshotInput);
      for (const itemId of depletedDependents) {
        const result = deploymentRuntime.offlineAssemblyForFuelDepletion(Number(itemId));
        if (!result?.success) throw new Error(`Could not offline assembly ${itemId} after fuel depletion: ${result?.errorMsg || "unknown failure"}`);
      }
      if (depletedDependents.length) snapshotInput.items = rawItems = itemStore.getAllItems();
      const snapshot = buildSuiAssemblySnapshot(snapshotInput);
      context.setCharacters(snapshot.characters);
      const localItemIds = new Set<string>(Object.values<any>(rawItems).map(item => String(item.itemID)));
      context.setSnapshotItemIds(localItemIds, snapshot.assemblies);
      await reconcileSuiAssemblies(snapshot, context, localItemIds);
      // Online/offline, fuel exhaustion and temporary storage operations can all
      // change reservations during this pass. Publish the resulting chain totals.
      await refreshChainStates();
      // Lifecycle reconciliation may have changed a facility's online status.
      // Capture its latest inventory and recipe together, then use this worker's
      // durable executor for the separately derived SmartIndustry object.
      const industryInput = currentSnapshotInput();
      await reconcileSuiIndustryFacilities(buildSuiIndustrySnapshot(industryInput.items),
        buildSuiAssemblySnapshot(industryInput).assemblies, context);
      const summary = JSON.stringify(snapshot.assemblies);
      if (summary !== lastSummary) {
        if (snapshot.assemblies.length) log.info(`[SuiAssemblySync] ${snapshot.assemblies.length} assemblies synchronized on ${synced.chainId}`);
        lastSummary = summary;
      }
    },
  });
  const sponsoredAdmin = createSponsoredAssemblyAdmin({
    runExclusive: worker.runExclusive,
    getContext: () => context,
    getSnapshot: () => buildSuiAssemblySnapshot(currentSnapshotInput()),
    validateAccess(request, assembly) {
      const identity = request.assertAuthenticated();
      if (assembly.ownerId !== request.characterID || identity.characterID !== request.characterID || identity.walletAddress !== request.walletAddress) {
        throw Object.assign(new Error("Assembly owner differs from the active wallet"), { code: "ACCESS_DENIED" });
      }
      const session = identity.session;
      const system = Number(session.solarsystemid2 || session._space?.systemID || session.solarsystemid || session.locationid);
      if (system !== assembly.solarSystemId) throw Object.assign(new Error("Assembly is in another system"), { code: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" });
      if (request.action === "online") {
        const item = itemStore.findItemById(request.assemblyID);
        if (!item) throw Object.assign(new Error("Assembly was removed"), { code: "ASSEMBLY_NOT_FOUND" });
        const energy = require("./networkNodeEnergyRuntime").validateAssemblyOnline(item);
        if (!energy.success) throw Object.assign(new Error("Assembly cannot receive energy"), { code: energy.errorMsg });
      }
    },
  });
  const unregisterAdmin = registerSuiAssemblyAdminBridge(sponsoredAdmin);
  const unregisterState = registerSuiAssemblyStateRunner((assemblyID, operation) => worker.runExclusive(async () => {
    try {
      if (!context) throw new Error(worker.getLastError() || "Assembly synchronization is starting");
      if (sponsoredAdmin.hasPrepared()) throw Object.assign(new Error("Assembly owner transaction is pending"), { code: "ASSEMBLY_STATE_PENDING" });
      await context.assertCurrent();
      await context.executor.recover();
      if (context.executor.hasPending()) throw Object.assign(new Error("Assembly transaction is pending"), { code: "ASSEMBLY_STATE_PENDING" });
      await restoreTemporaryStatuses();
      await refreshChainStates(assemblyID);
    } catch (error: any) {
      if (error.code === "ASSEMBLY_STATE_PENDING") throw error;
      throw Object.assign(new Error("Assembly chain state is unavailable", { cause: error }), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
    }
    // Inventory validation and mutation run without yielding after the fresh read.
    return operation();
  }));
  energyMutationRunner = createSuiAssemblyEnergyMutationRunner({
    runExclusive: worker.runExclusive, getContext: () => context,
    hasPrepared: () => sponsoredAdmin.hasPrepared(),
  });
  async function readStorageStatus(request: SuiStorageSyncRequest): Promise<any> {
    return worker.runExclusive(async () => {
      if (!context) throw new Error(worker.getLastError() || "Sui assembly synchronization is starting");
      if (sponsoredAdmin.hasPrepared()) throw new Error("An assembly owner is signing a sponsored transaction; retry shortly");
      await context.assertCurrent();
      const snapshot = buildSuiAssemblySnapshot(currentSnapshotInput());
      const assembly = snapshot.assemblies.find(a => a.itemId === String(request.storageUnitID) && a.kind === "storage_unit");
      if (!assembly) throw new Error("Smart Storage Unit is not available for chain synchronization");
      const chain = await context.contents.getInventoryStatus(assembly, request.characterID);
      const latest = buildSuiAssemblySnapshot(currentSnapshotInput()).assemblies.find(a => a.itemId === assembly.itemId);
      const current = inventoryFingerprint(latest) === inventoryFingerprint(assembly);
      const synchronized = current && chain.synchronized && !context.executor.hasPending();
      return { ...request, status: synchronized ? "synced" : "pending", chain,
        ...(synchronized ? {} : { error: worker.getLastError() || undefined }) };
    });
  }
  const unregisterStorageSync = registerSuiStorageSyncBridge({
    readStatus: readStorageStatus,
    async flush(request) {
      // If the first call joins an older scan, the second observes the newly
      // committed game inventory. Both share the worker's serialized executor.
      await worker.runOnce();
      await worker.runOnce();
      return readStorageStatus(request);
    },
  });
  const unregisterGateSync = registerSuiGateSyncBridge(createSuiGateSyncWorkerBridge({
    runExclusive: worker.runExclusive, runOnce: worker.runOnce,
    getContext: () => context, getSnapshot: () => buildSuiAssemblySnapshot(currentSnapshotInput()),
    getLastError: worker.getLastError, hasPrepared: () => sponsoredAdmin.hasPrepared(),
  }));
  const unregisterIndustrySync = registerSuiIndustrySyncBridge(createSuiIndustrySyncWorkerBridge({
    runExclusive: worker.runExclusive, runOnce: worker.runOnce, getContext: () => context,
    getSnapshot: () => {
      const input = currentSnapshotInput();
      return { ...buildSuiIndustrySnapshot(input.items), assemblies: buildSuiAssemblySnapshot(input).assemblies };
    },
    getLastError: worker.getLastError, hasPrepared: () => sponsoredAdmin.hasPrepared(),
  }));
  process.once("exit", () => {
    try { if (fs.readFileSync(lockPath, "utf8") === String(process.pid)) fs.unlinkSync(lockPath); } catch { /* process is exiting */ }
  });
  worker.start();
  log.info("[SuiAssemblySync] Automatic Localnet synchronization enabled (5 second scan)");
  return { ...worker, stop() {
    unregisterStorageSync(); unregisterGateSync(); unregisterIndustrySync(); unregisterAdmin(); unregisterState(); trackedNetworkNodeBinding = null;
    energyMutationRunner = null;
    const stopped = worker.stop();
    clearAssemblyEnergyConfig();
    energyRuntime.clearSuiNetworkNodeEnergy();
    return stopped.finally(() => { clearAssemblyEnergyConfig(); energyRuntime.clearSuiNetworkNodeEnergy(); });
  } };
}
