import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildSuiAssemblySnapshot, type SuiAssemblySnapshotInput } from "./suiAssemblySnapshot";
import { createSuiAssemblyChain, suiAssemblyFields, suiAssemblyOption } from "./suiAssemblyChain";
import { createSuiAssemblyContents } from "./suiAssemblyContents";
import { createAssemblyTransactionExecutor } from "./suiAssemblyTransactions";
import { registerSuiStorageSyncBridge, type SuiStorageSyncRequest } from "./suiStorageSync";
import {
  readSyncedSuiWorldConfig, prepareSuiCharacterIdentity, createSuiCharacterTransaction,
} from "./suiCharacterProvisioning";

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

/** Mirrors a consistent local snapshot; context owns the deployment-bound journal. */
export async function reconcileSuiAssemblies(snapshot: any, context: any, localItemIds: Set<string>) {
  await context.assertCurrent();
  await context.executor.recover();
  const failures = snapshot.errors.map((error: any) => error.message);
  const ready: any[] = [];
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
      if (node.status === 1) await context.chain.syncStatus(node);
      await context.chain.syncFuel(node);
    })) {
      fuelReady.add(node.itemId);
      if (node.status === 2 && nodes.includes(node)) await attempt(node.itemId, () => context.chain.syncStatus(node));
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
    await context.chain.syncStatus({ ...node, status: 2 });
    await context.chain.syncStatus({ ...assembly, status: 2 });
    await context.contents.syncInventory(assembly);
  }
  for (const assembly of ready.filter(a => a.kind !== "network_node")) {
    await attempt(assembly.itemId, async () => {
      try { await syncStorage(assembly); }
      finally { if (!context.executor.hasPending()) await context.chain.syncStatus(assembly); }
    });
  }
  // Only remove verified identities this runtime tracked, never unrelated chain objects.
  for (const assembly of removed.sort((a, b) => Number(a.kind === "network_node") - Number(b.kind === "network_node"))) {
    await attempt(`remove ${assembly.itemId}`, async () => {
      if (assembly.kind === "network_node" && Object.values<any>(context.state.assemblies).some(a => a.networkNodeId === assembly.itemId)) {
        throw new Error("Dependent assemblies must finish removal before retiring their Network Node");
      }
      try { if (assembly.kind === "storage_unit") await syncStorage({ ...assembly, inventory: [] }); }
      finally { if (!context.executor.hasPending()) await context.chain.syncStatus({ ...assembly, status: 1 }); }
      if (assembly.kind === "network_node") {
        await context.chain.syncFuel({ ...assembly, fuel: { typeId: 0, quantity: 0, unitVolume: "0" } });
      }
      await context.chain.removeAssembly(assembly);
      delete context.state.assemblies[assembly.itemId];
      context.save();
    });
  }
  for (const node of nodes) {
    if (fuelReady.has(node.itemId)) {
      await attempt(node.itemId, () => context.chain.syncStatus(node));
      await attempt(node.itemId, () => context.chain.syncFuel(node));
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
    });
    let snapshotItemIds = new Set<string>();
    let snapshotNodeStatuses = new Map<string, number>();
    const chain = createSuiAssemblyChain({ client, world, execute: executor.execute, tenant: "dev",
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
        if (fuel.quantity !== assembly.fuel.quantity ||
            (fuel.quantity > 0 && fuel.typeID !== assembly.fuel.typeId)) {
          throw new Error(`Network node ${assembly.itemId} fuel changed during synchronization; retry the current snapshot`);
        }
      },
    });
    async function getCharacter(ownerId: number) {
      const local = localCharacter(ownerId);
      if (!local) throw new Error(`Local Character ${ownerId} is missing`);
      const identity = prepareSuiCharacterIdentity(local, { world: { ...world, tenant: "dev", tribeId: 100 } });
      let response = await client.getObject({ id: identity.characterObjectId, options: { showContent: true, showOwner: true } });
      if (response.error?.code === "notExists") {
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
      assertInventorySnapshotCurrent(assembly) {
        const latest = buildSuiAssemblySnapshot(currentSnapshotInput()).assemblies.find(a => a.itemId === assembly.itemId);
        // Retiring an already removed unit intentionally empties its partition.
        if (!latest && !itemStore.findItemById(Number(assembly.itemId)) && assembly.inventory.length === 0) return;
        if (inventoryFingerprint(latest) !== inventoryFingerprint(assembly)) {
          throw new Error(`Storage ${assembly.itemId} inventory changed during synchronization; retry the current snapshot`);
        }
      },
    });
    await assertCurrent();
    return {
      synced, chain, contents, executor, state, assertCurrent, getCharacter,
      fuelEfficiencies: new Map(require("./networkNodeFuelRuntime").getNetworkNodeFuelConfig().map((entry: any) => [entry.typeID, entry.efficiency])),
      setCharacters(rows: any[]) { characters = new Map(rows.map(character => [character.gameCharacterId, character])); },
      setSnapshotItemIds(ids: Set<string>, assemblies: any[]) {
        snapshotItemIds = ids;
        snapshotNodeStatuses = new Map(assemblies.filter(a => a.kind === "network_node").map(a => [a.itemId, a.status]));
      },
      save() { atomicJson(statePath, state); },
    };
  }
  const worker = createAssemblySyncWorker({
    report: (message) => log.warn(`[SuiAssemblySync] ${message}`),
    async reconcile() {
      const synced = readSyncedSuiWorldConfig(env);
      if (!synced) throw new Error("Run FrontierWorld.ps1 sync to enable automatic Smart Assembly synchronization");
      if (!context || context.synced.chainId !== synced.chainId || context.synced.packageId !== synced.packageId) {
        context = await makeContext(synced, { characters: [] });
      }
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
      const summary = JSON.stringify(snapshot.assemblies);
      if (summary !== lastSummary) {
        if (snapshot.assemblies.length) log.info(`[SuiAssemblySync] ${snapshot.assemblies.length} assemblies synchronized on ${synced.chainId}`);
        lastSummary = summary;
      }
    },
  });
  async function readStorageStatus(request: SuiStorageSyncRequest): Promise<any> {
    return worker.runExclusive(async () => {
      if (!context) throw new Error(worker.getLastError() || "Sui assembly synchronization is starting");
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
  process.once("exit", () => {
    try { if (fs.readFileSync(lockPath, "utf8") === String(process.pid)) fs.unlinkSync(lockPath); } catch { /* process is exiting */ }
  });
  worker.start();
  log.info("[SuiAssemblySync] Automatic Localnet synchronization enabled (5 second scan)");
  return { ...worker, stop() { unregisterStorageSync(); return worker.stop(); } };
}
