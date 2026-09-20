import { createHash } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeSuiAddress } from "@mysten/sui/utils";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";

export type SuiAssemblyKind = AssemblySnapshot["kind"];
export type SuiAssemblyWorld = {
  packageId: string;
  objectRegistryId: string;
  adminAclId: string;
  energyConfigId: string;
  fuelConfigId: string;
  locationRegistryId?: string;
  serverAddressRegistryId?: string;
  gateConfigId?: string;
};
export type SuiAssemblyCapRef = {
  id: string;
  kind: SuiAssemblyKind | "character";
  ownerCapId: string;
};
export type SuiAssemblyChainObject = SuiAssemblyCapRef & {
  kind: SuiAssemblyKind;
  /** Exact immutable Sui object reference observed for this state. */
  version: string;
  digest: string;
  fields: Record<string, any>;
  online: boolean;
  networkNodeId: string | null;
  locationHash: number[];
};
export type SuiAssemblyChainOptions = {
  client: SuiJsonRpcClient;
  world: SuiAssemblyWorld;
  tenant: string;
  execute: (label: string, tx: Transaction, ownerId?: number, assertSnapshotCurrent?: () => void) => Promise<unknown>;
  deriveId?: (itemId: string) => string;
  /** Existing nodes use chain fuel; inventory changes require explicit transfer intents. */
  fuelAuthority?: boolean;
  /** Reject a stale local fuel snapshot before it can replenish a newer burn. */
  assertFuelSnapshotCurrent?: (assembly: AssemblySnapshot) => void;
};
export type SuiAssemblyFuelState = {
  typeID: number;
  quantity: number;
  unitVolume: string;
  observedAtMs: number;
};
export type SuiAssemblyEnergyState = {
  maxEnergy: number;
  currentEnergyProduction: number;
  energyUsed: number;
  observedAtMs: number;
};

const STRUCT_NAMES = {
  network_node: "NetworkNode", gate: "Gate", storage_unit: "StorageUnit",
  turret: "Turret", assembly: "Assembly", character: "Character",
} as const;
const TenantItemId = bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() });
const U64_MAX = (1n << 64n) - 1n;

function fuelU64(value: unknown, label: string): bigint {
  if ((typeof value !== "string" || !/^\d+$/.test(value)) &&
      (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) &&
      typeof value !== "bigint") throw new Error(`${label} is not a valid u64`);
  const integer = BigInt(value as string | number | bigint);
  if (integer < 0n || integer > U64_MAX) throw new Error(`${label} is not a valid u64`);
  return integer;
}
function localFuelInteger(value: unknown, label: string): number {
  const integer = fuelU64(value, label);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is outside the local integer range`);
  return Number(integer);
}

/** Move JSON-RPC nests struct values in `fields`; options contain a single vec. */
export function suiAssemblyFields(value: any): any {
  return value && typeof value === "object" && "fields" in value && !value.variant
    ? value.fields : value;
}
export function suiAssemblyOption(value: any): any | null {
  const fields = suiAssemblyFields(value);
  if (fields == null) return null;
  if (Array.isArray(fields.vec)) return fields.vec.length ? suiAssemblyFields(fields.vec[0]) : null;
  if (Array.isArray(fields)) return fields.length ? suiAssemblyFields(fields[0]) : null;
  return fields;
}
function sameId(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" &&
    normalizeSuiAddress(a) === normalizeSuiAddress(b);
}
function objectId(value: any): string | null {
  const field = suiAssemblyFields(value);
  return typeof field === "string" ? field : field?.id ?? field?.bytes ?? null;
}
function kindForType(type: string, world: SuiAssemblyWorld): SuiAssemblyKind | null {
  for (const [kind, name] of Object.entries(STRUCT_NAMES)) {
    if (kind !== "character" && type === `${normalizeSuiAddress(world.packageId)}::${kind}::${name}`) {
      return kind as SuiAssemblyKind;
    }
  }
  return null;
}
function statusOnline(value: any): boolean {
  const status = suiAssemblyFields(suiAssemblyFields(value)?.status ?? value);
  const variant = typeof status === "string" ? status : status?.variant;
  if (variant === "ONLINE") return true;
  if (variant === "OFFLINE") return false;
  throw new Error(`Unsupported chain assembly status: ${JSON.stringify(status)}`);
}
function readHash(value: any): number[] {
  const hash = suiAssemblyFields(value)?.location_hash;
  if (Array.isArray(hash)) return hash.map(Number);
  // Some JSON-RPC providers encode vector<u8> as base64.
  if (typeof hash === "string") return [...Buffer.from(hash, "base64")];
  throw new Error("Chain assembly location hash is missing");
}
function assertIntegerEqual(actual: any, expected: any, label: string): void {
  if (actual == null || BigInt(actual) !== BigInt(expected)) {
    throw new Error(`${label} differs from local state (chain=${actual}, local=${expected}); existing objects cannot be recreated`);
  }
}
export function assemblyLocationHash(assembly: Pick<AssemblySnapshot, "solarSystemId" | "position">): number[] {
  const position = assembly.position;
  return [...createHash("sha256").update(JSON.stringify([
    assembly.solarSystemId, String(position.x), String(position.y), String(position.z),
  ])).digest()];
}

/** Borrow Character-owned caps with explicit Receiving references and return every receipt. */
export async function withOwnerCaps(
  tx: Transaction,
  client: Pick<SuiJsonRpcClient, "getObject">,
  world: SuiAssemblyWorld,
  characterId: string,
  refs: SuiAssemblyCapRef[],
  callback: (caps: TransactionArgument[]) => void,
): Promise<void> {
  const borrowed: Array<{ cap: TransactionArgument; receipt: TransactionArgument; type: string }> = [];
  for (const ref of refs) {
    const response = await client.getObject({ id: ref.ownerCapId, options: { showOwner: true, showContent: true } });
    if (response.error || !response.data) throw new Error(`Cannot read OwnerCap ${ref.ownerCapId}`);
    const owner = response.data.owner as any;
    if (!sameId(owner?.AddressOwner ?? owner?.ObjectOwner, characterId)) {
      throw new Error(`OwnerCap for ${ref.id} belongs to a different character`);
    }
    const content = response.data.content;
    const fields = content?.dataType === "moveObject" ? content.fields as any : null;
    if (!sameId(objectId(fields?.authorized_object_id), ref.id)) {
      throw new Error(`OwnerCap ${ref.ownerCapId} is not authorized for ${ref.id}`);
    }
    const type = `${world.packageId}::${ref.kind}::${STRUCT_NAMES[ref.kind]}`;
    const [cap, receipt] = tx.moveCall({
      target: `${world.packageId}::character::borrow_owner_cap`, typeArguments: [type],
      arguments: [tx.object(characterId), tx.receivingRef({
        objectId: response.data.objectId, version: response.data.version, digest: response.data.digest,
      })],
    });
    borrowed.push({ cap, receipt, type });
  }
  callback(borrowed.map(({ cap }) => cap));
  for (const { cap, receipt, type } of borrowed) {
    tx.moveCall({ target: `${world.packageId}::character::return_owner_cap`, typeArguments: [type],
      arguments: [tx.object(characterId), cap, receipt] });
  }
}

export function createSuiAssemblyChain(options: SuiAssemblyChainOptions) {
  const { client, world, tenant, execute } = options;
  const deriveId = options.deriveId ?? ((itemId: string) => deriveObjectID(
    world.objectRegistryId, `${world.packageId}::in_game_id::TenantItemId`,
    TenantItemId.serialize({ id: BigInt(itemId), tenant }).toBytes(),
  ));
  const withCaps = (tx: Transaction, ownerId: number, refs: SuiAssemblyCapRef[],
    callback: (caps: TransactionArgument[]) => void) =>
    withOwnerCaps(tx, client, world, deriveId(String(ownerId)), refs, callback);

  async function readObject(id: string): Promise<SuiAssemblyChainObject | null> {
    const response = await client.getObject({ id, options: { showContent: true, showType: true } });
    if (response.error) {
      if (response.error.code === "notExists") return null;
      if (response.error.code === "deleted") {
        throw Object.assign(new Error(`Assembly ${id} was previously unanchored; its derived item ID cannot be reused`),
          { code: "CHAIN_ASSEMBLY_TOMBSTONE" });
      }
      throw new Error(`Cannot read assembly ${id}: ${JSON.stringify(response.error)}`);
    }
    if (!response.data) throw new Error(`No object result for assembly ${id}`);
    const kind = kindForType(response.data.type ?? "", world);
    if (!kind || response.data.content?.dataType !== "moveObject") {
      throw new Error(`Object ${id} has incompatible type ${response.data.type}`);
    }
    const fields = response.data.content.fields as Record<string, any>;
    const ownerCapId = objectId(fields.owner_cap_id);
    if (!ownerCapId) throw new Error(`Assembly ${id} is missing its OwnerCap`);
    const version = String(response.data.version ?? "");
    const digest = String(response.data.digest ?? "");
    return {
      id: response.data.objectId, kind, fields, ownerCapId,
      version, digest,
      online: statusOnline(fields.status),
      networkNodeId: objectId(suiAssemblyOption(fields.energy_source_id)),
      locationHash: readHash(fields.location),
    };
  }

  async function readAssembly(assembly: AssemblySnapshot): Promise<SuiAssemblyChainObject | null> {
    const state = await readObject(deriveId(assembly.itemId));
    if (!state) return null;
    if (state.kind !== assembly.kind) throw new Error(`Assembly ${assembly.itemId} chain kind ${state.kind} differs from ${assembly.kind}`);
    const key = suiAssemblyFields(state.fields.key);
    assertIntegerEqual(key?.id ?? key?.item_id, assembly.itemId, `Assembly ${assembly.itemId} item ID`);
    if (key?.tenant !== tenant) throw new Error(`Assembly ${assembly.itemId} tenant differs from ${tenant}`);
    assertIntegerEqual(state.fields.type_id, assembly.typeId, `Assembly ${assembly.itemId} type`);
    if (JSON.stringify(state.locationHash) !== JSON.stringify(assemblyLocationHash(assembly))) {
      throw new Error(`Assembly ${assembly.itemId} location differs from its immutable chain location`);
    }
    if (assembly.kind !== "network_node") {
      const desired = assembly.networkNodeId ? deriveId(assembly.networkNodeId) : null;
      if (!desired || !sameId(state.networkNodeId, desired)) {
        throw new Error(`Assembly ${assembly.itemId} network node binding differs from local state`);
      }
    } else {
      const fuel = suiAssemblyFields(state.fields.fuel);
      const energy = suiAssemblyFields(state.fields.energy_source);
      assertIntegerEqual(fuel?.max_capacity, assembly.fuelCapacity, `Network node ${assembly.itemId} fuel capacity`);
      assertIntegerEqual(fuel?.burn_rate_in_ms, assembly.burnRateMs, `Network node ${assembly.itemId} burn rate`);
      assertIntegerEqual(energy?.max_energy_production, assembly.maxEnergy, `Network node ${assembly.itemId} max energy`);
    }
    const capResponse = await client.getObject({ id: state.ownerCapId, options: { showOwner: true } });
    if (capResponse.error || !capResponse.data) throw new Error(`Cannot read owner of assembly ${assembly.itemId}`);
    const capOwner = capResponse.data.owner as any;
    if (!sameId(capOwner?.AddressOwner ?? capOwner?.ObjectOwner, deriveId(String(assembly.ownerId)))) {
      throw new Error(`Assembly ${assembly.itemId} chain owner differs from local owner ${assembly.ownerId}`);
    }
    if (assembly.kind === "storage_unit") {
      const inventory = await readInventory(state.id, state.ownerCapId);
      assertIntegerEqual(inventory.max_capacity, assembly.storageCapacity, `Storage ${assembly.itemId} capacity`);
    }
    return state;
  }

  async function readInventory(storageId: string, key: string): Promise<Record<string, any>> {
    const response = await client.getDynamicFieldObject({ parentId: storageId,
      name: { type: "0x2::object::ID", value: key } });
    if (response.error || response.data?.content?.dataType !== "moveObject") {
      throw new Error(`Cannot read storage inventory ${storageId}/${key}`);
    }
    return suiAssemblyFields((response.data.content.fields as any).value);
  }

  async function syncMetadata(assembly: AssemblySnapshot, existing?: SuiAssemblyChainObject): Promise<void> {
    const state = existing ?? await readAssembly(assembly);
    if (!state) throw new Error(`Assembly ${assembly.itemId} must be anchored before metadata sync`);
    const metadata = suiAssemblyOption(state.fields.metadata);
    if (metadata?.name !== assembly.name) {
      const tx = new Transaction();
      await withCaps(tx, assembly.ownerId, [state], ([cap]) => {
        tx.moveCall({ target: `${world.packageId}::${assembly.kind}::update_metadata_name`,
          arguments: [tx.object(state.id), cap, tx.pure.string(assembly.name)] });
      });
      await execute(`assembly:${assembly.itemId}:name`, tx, assembly.ownerId);
    }
    if (world.locationRegistryId) {
      const registry = await client.getObject({ id: world.locationRegistryId, options: { showContent: true } });
      if (registry.error || registry.data?.content?.dataType !== "moveObject") {
        throw new Error("Cannot read the location registry");
      }
      const registryFields = registry.data.content.fields as any;
      const locations = suiAssemblyFields(registryFields.locations);
      const tableId = objectId(locations?.id);
      if (!tableId) throw new Error("Location registry table ID is missing");
      const old = await client.getDynamicFieldObject({ parentId: tableId,
        name: { type: "0x2::object::ID", value: state.id } });
      if (old.error && old.error.code !== "dynamicFieldNotFound" && old.error.code !== "notExists") {
        throw new Error(`Cannot read location for ${assembly.itemId}: ${JSON.stringify(old.error)}`);
      }
      const oldFields = old.data?.content?.dataType === "moveObject" ? old.data.content.fields as any : null;
      const coordinates = suiAssemblyFields(oldFields?.value);
      const p = assembly.position;
      if (!coordinates || String(coordinates.solarsystem) !== String(assembly.solarSystemId) ||
          String(coordinates.x) !== String(p.x) || String(coordinates.y) !== String(p.y) || String(coordinates.z) !== String(p.z)) {
        const tx = new Transaction();
        tx.moveCall({ target: `${world.packageId}::${assembly.kind}::reveal_location`, arguments: [
          tx.object(state.id), tx.object(world.locationRegistryId), tx.object(world.adminAclId),
          tx.pure.u64(assembly.solarSystemId), tx.pure.string(String(p.x)),
          tx.pure.string(String(p.y)), tx.pure.string(String(p.z)),
        ] });
        await execute(`assembly:${assembly.itemId}:location`, tx);
      }
    }
  }

  async function ensureAssembly(assembly: AssemblySnapshot): Promise<SuiAssemblyChainObject> {
    let state = await readAssembly(assembly);
    if (!state) {
      const tx = new Transaction();
      const args: TransactionArgument[] = [tx.object(world.objectRegistryId)];
      if (assembly.kind !== "network_node") {
        if (!assembly.networkNodeId) throw new Error(`Assembly ${assembly.itemId} has no network node binding`);
        const node = await readObject(deriveId(assembly.networkNodeId));
        if (!node || node.kind !== "network_node") throw new Error(`Network node ${assembly.networkNodeId} must be anchored first`);
        args.push(tx.object(node.id));
      }
      args.push(tx.object(deriveId(String(assembly.ownerId))), tx.object(world.adminAclId),
        tx.pure.u64(assembly.itemId), tx.pure.u64(assembly.typeId));
      if (assembly.kind === "storage_unit") args.push(tx.pure.u64(assembly.storageCapacity));
      args.push(tx.pure.vector("u8", assemblyLocationHash(assembly)));
      if (assembly.kind === "network_node") {
        args.push(tx.pure.u64(assembly.fuelCapacity), tx.pure.u64(assembly.burnRateMs), tx.pure.u64(assembly.maxEnergy));
      }
      const [anchored] = tx.moveCall({ target: `${world.packageId}::${assembly.kind}::anchor`, arguments: args });
      tx.moveCall({ target: `${world.packageId}::${assembly.kind}::share_${assembly.kind}`, arguments: [anchored, tx.object(world.adminAclId)] });
      await execute(`assembly:${assembly.itemId}:anchor`, tx);
      state = await readAssembly(assembly);
      if (!state) throw new Error(`Assembly ${assembly.itemId} anchor was not visible after confirmation`);
    }
    await syncMetadata(assembly, state);
    return state;
  }

  /** Read confirmed fuel without consuming it again through a separate local clock. */
  async function readFuelState(assembly: AssemblySnapshot, existing?: SuiAssemblyChainObject): Promise<SuiAssemblyFuelState> {
    if (assembly.kind !== "network_node") throw new Error(`Assembly ${assembly.itemId} is not a Network Node`);
    const state = existing ?? await readAssembly(assembly);
    if (!state) throw new Error(`Network node ${assembly.itemId} must be anchored before reading fuel`);
    const fuel = suiAssemblyFields(state.fields.fuel);
    const quantity = localFuelInteger(fuel?.quantity, "Chain fuel quantity");
    const typeID = localFuelInteger(suiAssemblyOption(fuel?.type_id) ?? 0, "Chain fuel type");
    const unitVolume = fuelU64(suiAssemblyOption(fuel?.unit_volume) ?? 0, "Chain fuel unit volume");
    if (quantity > 0 && (typeID === 0 || unitVolume === 0n)) {
      throw new Error(`Network node ${assembly.itemId} has invalid chain fuel`);
    }
    return { typeID, quantity, unitVolume: String(unitVolume), observedAtMs: Date.now() };
  }

  /** Reservations are held by the node; current type costs cannot reconstruct them. */
  async function readEnergyState(assembly: AssemblySnapshot, existing?: SuiAssemblyChainObject): Promise<SuiAssemblyEnergyState> {
    if (assembly.kind !== "network_node") throw new Error(`Assembly ${assembly.itemId} is not a Network Node`);
    const state = existing ?? await readAssembly(assembly);
    if (!state) throw new Error(`Network node ${assembly.itemId} must be anchored before reading energy`);
    if (state.kind !== "network_node") throw new Error(`Assembly ${assembly.itemId} chain object is not a Network Node`);
    const energy = suiAssemblyFields(state.fields.energy_source);
    const maxEnergy = localFuelInteger(energy?.max_energy_production, "Chain maximum energy production");
    const currentEnergyProduction = localFuelInteger(energy?.current_energy_production, "Chain current energy production");
    const energyUsed = localFuelInteger(energy?.total_reserved_energy, "Chain reserved energy");
    if (maxEnergy === 0 || currentEnergyProduction > maxEnergy || energyUsed > maxEnergy) {
      throw new Error(`Network node ${assembly.itemId} has invalid chain energy`);
    }
    return { maxEnergy, currentEnergyProduction, energyUsed, observedAtMs: Date.now() };
  }

  /** Settle elapsed chain burn cycles before importing the node's confirmed state. */
  async function updateFuel(assembly: AssemblySnapshot, assertSnapshotCurrent?: () => void): Promise<boolean> {
    if (assembly.kind !== "network_node") return false;
    assertSnapshotCurrent?.();
    const state = await readAssembly(assembly);
    if (!state || !state.online) return false;
    const fuel = suiAssemblyFields(state.fields.fuel);
    if (typeof fuel?.is_burning !== "boolean") throw new Error("Chain fuel burning state is invalid");
    if (!fuel.is_burning) return false;
    const burnStart = fuelU64(fuel.burn_start_time, "Chain fuel burn start");
    if (burnStart === 0n) return false;
    const previousElapsed = fuelU64(fuel.previous_cycle_elapsed_time, "Chain previous fuel elapsed time");
    const burnRate = fuelU64(fuel.burn_rate_in_ms, "Chain fuel burn rate");
    const typeID = fuelU64(suiAssemblyOption(fuel.type_id) ?? 0, "Chain fuel type");
    if (typeID === 0n || burnRate === 0n) throw new Error("Chain burning fuel has an invalid type or burn rate");

    const clockResponse = await client.getObject({ id: "0x6", options: { showContent: true } });
    if (clockResponse.error || clockResponse.data?.content?.dataType !== "moveObject") throw new Error("Cannot read Sui Clock for fuel settlement");
    const clockFields = clockResponse.data.content.fields as any;
    const now = fuelU64(clockFields.timestamp_ms, "Sui Clock timestamp");
    if (fuelU64(fuel.last_updated, "Chain fuel last updated time") === now) return false;
    const configResponse = await client.getObject({ id: world.fuelConfigId, options: { showContent: true } });
    if (configResponse.error || configResponse.data?.content?.dataType !== "moveObject") throw new Error("Cannot read FuelConfig for fuel settlement");
    const table = suiAssemblyFields((configResponse.data.content.fields as any).fuel_efficiency);
    const tableID = objectId(table?.id);
    if (!tableID) throw new Error("FuelConfig efficiency table ID is missing");
    const entry = await client.getDynamicFieldObject({ parentId: tableID, name: { type: "u64", value: String(typeID) } });
    if (entry.error || entry.data?.content?.dataType !== "moveObject") throw new Error(`Cannot read efficiency for fuel ${typeID}`);
    const efficiencyFields = entry.data.content.fields as any;
    if (efficiencyFields.name !== undefined && fuelU64(efficiencyFields.name, "Fuel efficiency type") !== typeID) {
      throw new Error("Fuel efficiency entry belongs to another type");
    }
    const efficiency = fuelU64(efficiencyFields.value, `Fuel ${typeID} efficiency`);
    if (efficiency === 0n || efficiency > 100n || burnRate * efficiency > U64_MAX) throw new Error("Chain fuel efficiency or burn rate is invalid");
    const cycleMs = burnRate * efficiency / 100n;
    const elapsed = (now > burnStart ? now - burnStart : 0n) + previousElapsed;
    if (cycleMs === 0n || elapsed > U64_MAX) throw new Error("Chain fuel cycle duration or elapsed time is invalid");
    if (elapsed < cycleMs) return false;

    const ids = state.fields.connected_assembly_ids;
    if (!Array.isArray(ids)) throw new Error("Network node connected assembly IDs are missing");
    const connected: SuiAssemblyChainObject[] = [];
    const seen = new Set<string>();
    for (const rawID of ids) {
      const id = objectId(rawID);
      if (!id || seen.has(normalizeSuiAddress(id))) throw new Error("Network node contains invalid or duplicate connected assembly IDs");
      seen.add(normalizeSuiAddress(id));
      const target = await readObject(id);
      if (!target || target.kind === "network_node" || !sameId(target.networkNodeId, state.id)) {
        throw new Error(`Connected assembly ${id} cannot be brought offline by this Network Node`);
      }
      connected.push(target);
    }
    const tx = new Transaction();
    let [hotPotato] = tx.moveCall({ target: `${world.packageId}::network_node::update_fuel`, arguments: [
      tx.object(state.id), tx.object(world.fuelConfigId), tx.object(world.adminAclId), tx.object("0x6"),
    ] });
    // The final unit can expire while building. These calls safely pass through
    // an empty hot potato while fuel remains, and atomically offline all children
    // if execution exhausts it. The Move contract decides which case applies.
    for (const child of connected) {
      [hotPotato] = tx.moveCall({ target: `${world.packageId}::${child.kind}::offline_connected_${child.kind}`, arguments: [
        tx.object(child.id), hotPotato, tx.object(state.id), tx.object(world.energyConfigId),
      ] });
    }
    tx.moveCall({ target: `${world.packageId}::network_node::destroy_offline_assemblies`, arguments: [hotPotato] });
    assertSnapshotCurrent?.();
    await execute(`assembly:${assembly.itemId}:fuel-burn`, tx, undefined, assertSnapshotCurrent);
    return true;
  }

  async function syncFuelIntent(assembly: AssemblySnapshot): Promise<void> {
    const intent = assembly.fuelIntent;
    if (!intent) return;
    if (typeof intent.id !== "string" || !intent.id || !Number.isSafeInteger(intent.quantityDelta) ||
        intent.quantityDelta === 0 || !Number.isSafeInteger(intent.typeID) || intent.typeID <= 0) {
      throw new Error(`Network node ${assembly.itemId} has an invalid fuel transfer intent`);
    }
    options.assertFuelSnapshotCurrent?.(assembly);
    const state = await readAssembly(assembly);
    if (!state) throw new Error(`Network node ${assembly.itemId} must be anchored before fuel sync`);
    const fuel = suiAssemblyFields(state.fields.fuel);
    const current = fuelU64(fuel?.quantity, "Chain fuel quantity");
    const currentType = fuelU64(suiAssemblyOption(fuel?.type_id) ?? 0, "Chain fuel type");
    const delta = BigInt(intent.quantityDelta);
    if (current > 0n && currentType !== BigInt(intent.typeID)) {
      throw new Error(`Network node ${assembly.itemId} chain fuel type differs from the transfer intent`);
    }
    if (current + delta < 0n) throw new Error(`Network node ${assembly.itemId} has insufficient chain fuel for withdrawal`);
    let volume = 0n;
    if (delta > 0n) {
      volume = fuelU64(assembly.fuel.unitVolume, "Fuel transfer unit volume");
      if (volume === 0n) throw new Error(`Network node ${assembly.itemId} has invalid fuel transfer volume`);
      if (current > 0n && fuelU64(suiAssemblyOption(fuel?.unit_volume) ?? 0, "Chain fuel unit volume") !== volume) {
        throw new Error(`Network node ${assembly.itemId} chain fuel unit volume differs from the transfer intent`);
      }
      const capacity = fuelU64(fuel?.max_capacity, "Chain fuel capacity");
      if (current + delta > U64_MAX || (current + delta) * volume > capacity) {
        throw new Error(`Network node ${assembly.itemId} fuel transfer exceeds chain capacity`);
      }
    }
    const tx = new Transaction();
    await withCaps(tx, assembly.ownerId, [state], ([cap]) => {
      if (delta > 0n) tx.moveCall({ target: `${world.packageId}::network_node::deposit_fuel`, arguments: [
        tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(intent.typeID),
        tx.pure.u64(volume), tx.pure.u64(delta), tx.object("0x6"),
      ] });
      else tx.moveCall({ target: `${world.packageId}::network_node::withdraw_fuel`, arguments: [
        tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(intent.typeID), tx.pure.u64(-delta),
      ] });
    });
    options.assertFuelSnapshotCurrent?.(assembly);
    await execute(`assembly:${assembly.itemId}:fuel:${intent.id}`, tx, assembly.ownerId,
      () => options.assertFuelSnapshotCurrent?.(assembly));
  }

  async function syncFuel(assembly: AssemblySnapshot): Promise<void> {
    if (assembly.kind !== "network_node") return;
    if (options.fuelAuthority) return syncFuelIntent(assembly);
    options.assertFuelSnapshotCurrent?.(assembly);
    const state = await readAssembly(assembly);
    if (!state) throw new Error(`Network node ${assembly.itemId} must be anchored before fuel sync`);
    const fuel = suiAssemblyFields(state.fields.fuel);
    const current = BigInt(fuel.quantity);
    const desired = BigInt(assembly.fuel.quantity);
    const currentType = suiAssemblyOption(fuel.type_id);
    const volume = suiAssemblyOption(fuel.unit_volume);
    const sameType = String(currentType) === String(assembly.fuel.typeId);
    if (current > 0n && sameType && BigInt(volume) !== BigInt(assembly.fuel.unitVolume)) {
      throw new Error(`Network node ${assembly.itemId} fuel unit volume differs from local state`);
    }
    if (desired > 0n && (assembly.fuel.typeId <= 0 || BigInt(assembly.fuel.unitVolume) <= 0n)) {
      throw new Error(`Network node ${assembly.itemId} has invalid local fuel`);
    }
    if (current === desired && (desired === 0n || sameType)) return;
    const tx = new Transaction();
    await withCaps(tx, assembly.ownerId, [state], ([cap]) => {
      const withdraw = sameType ? (current > desired ? current - desired : 0n) : current;
      const deposit = sameType ? (desired > current ? desired - current : 0n) : desired;
      if (withdraw > 0n) tx.moveCall({ target: `${world.packageId}::network_node::withdraw_fuel`, arguments: [
        tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(currentType), tx.pure.u64(withdraw),
      ] });
      if (deposit > 0n) tx.moveCall({ target: `${world.packageId}::network_node::deposit_fuel`, arguments: [
        tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(assembly.fuel.typeId),
        tx.pure.u64(assembly.fuel.unitVolume), tx.pure.u64(deposit), tx.object("0x6"),
      ] });
    });
    options.assertFuelSnapshotCurrent?.(assembly);
    await execute(`assembly:${assembly.itemId}:fuel`, tx, assembly.ownerId,
      () => options.assertFuelSnapshotCurrent?.(assembly));
  }

  async function configureFuelEfficiency(typeId: number, efficiency: number): Promise<void> {
    // The deployed legacy contract rejects efficiencies below 10. This fallback
    // supplies absent defaults; authoritative existing chain rates stay intact.
    const contractEfficiency = typeId === 77818 && efficiency === 8 ? 10 : efficiency;
    if (!Number.isSafeInteger(typeId) || typeId <= 0 || !Number.isInteger(contractEfficiency) || contractEfficiency < 10 || contractEfficiency > 100) {
      throw new Error(`Fuel ${typeId} efficiency ${efficiency} cannot be represented by the deployed contract (10–100 percent)`);
    }
    const response = await client.getObject({ id: world.fuelConfigId, options: { showContent: true } });
    if (response.error || response.data?.content?.dataType !== "moveObject") throw new Error("Cannot read FuelConfig");
    const config = response.data.content.fields as any;
    const table = suiAssemblyFields(config.fuel_efficiency);
    const tableId = objectId(table?.id);
    if (!tableId) throw new Error("FuelConfig efficiency table ID is missing");
    const entry = await client.getDynamicFieldObject({ parentId: tableId, name: { type: "u64", value: String(typeId) } });
    if (entry.error && entry.error.code !== "dynamicFieldNotFound" && entry.error.code !== "notExists") {
      throw new Error(`Cannot read efficiency for fuel ${typeId}`);
    }
    const fields = entry.data?.content?.dataType === "moveObject" ? entry.data.content.fields as any : null;
    if (options.fuelAuthority && fields) {
      const current = fuelU64(fields.value, `Fuel ${typeId} efficiency`);
      if (current === 0n || current > 100n) throw new Error(`Fuel ${typeId} chain efficiency is outside the valid range`);
      return;
    }
    if (fields && String(fields.value) === String(contractEfficiency)) return;
    const tx = new Transaction();
    tx.moveCall({ target: `${world.packageId}::fuel::set_fuel_efficiency`, arguments: [
      tx.object(world.fuelConfigId), tx.object(world.adminAclId), tx.pure.u64(typeId), tx.pure.u64(contractEfficiency),
    ] });
    await execute(`fuel:${typeId}:efficiency`, tx);
  }

  /** Read the authoritative energy table without modifying deployed game balance. */
  async function readEnergyRequirements(): Promise<Array<{ typeID: number; energyRequired: number }>> {
    const response = await client.getObject({ id: world.energyConfigId, options: { showContent: true } });
    if (response.error || response.data?.content?.dataType !== "moveObject") throw new Error("Cannot read EnergyConfig");
    const config = response.data.content.fields as any;
    const table = suiAssemblyFields(config.assembly_energy);
    const tableId = objectId(table?.id);
    if (!tableId) throw new Error("EnergyConfig assembly energy table ID is missing");
    const requirements = new Map<number, number>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await client.getDynamicFields({ parentId: tableId, cursor, limit: 50 });
      const values = await Promise.all(page.data.map(async entry => {
        if (entry.name.type !== "u64") throw new Error("EnergyConfig contains a non-u64 assembly type");
        const typeID = Number(entry.name.value);
        if (!Number.isSafeInteger(typeID) || typeID <= 0) throw new Error("EnergyConfig contains an invalid assembly type");
        const result = await client.getDynamicFieldObject({ parentId: tableId, name: entry.name });
        const fields = result.data?.content?.dataType === "moveObject" ? result.data.content.fields as any : null;
        const energyRequired = fields && Number(fields.value);
        if (result.error || !fields || String(fields.name) !== String(entry.name.value) ||
            !Number.isSafeInteger(energyRequired) || energyRequired < 0) {
          throw new Error(`Cannot read energy requirement for assembly type ${typeID}`);
        }
        return { typeID, energyRequired };
      }));
      for (const entry of values) {
        if (requirements.has(entry.typeID)) throw new Error("EnergyConfig contains duplicate assembly types");
        requirements.set(entry.typeID, entry.energyRequired);
      }
      cursor = page.hasNextPage ? page.nextCursor : null;
      if (page.hasNextPage && (!cursor || cursors.has(cursor))) throw new Error("EnergyConfig pagination did not advance");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (table.size !== undefined && BigInt(table.size) !== BigInt(requirements.size)) {
      throw new Error("EnergyConfig changed during reading; retry the current table");
    }
    if (response.data.version) {
      const latest = await client.getObject({ id: world.energyConfigId });
      if (latest.error || latest.data?.version !== response.data.version) {
        throw new Error("EnergyConfig changed during reading; retry the current table");
      }
    }
    return [...requirements].map(([typeID, energyRequired]) => ({ typeID, energyRequired }))
      .sort((a, b) => a.typeID - b.typeID);
  }

  /** Construct only the allowlisted status calls; wallet sponsorship reuses this builder. */
  async function buildStatusTransaction(assembly: AssemblySnapshot) {
    if (assembly.kind === "network_node") options.assertFuelSnapshotCurrent?.(assembly);
    const state = await readAssembly(assembly);
    if (!state) throw new Error(`Assembly ${assembly.itemId} must be anchored before status sync`);
    const desiredOnline = assembly.status === 2;
    if (state.online === desiredOnline) return null;
    const tx = new Transaction();
    let connected: SuiAssemblyChainObject[] = [];
    if (assembly.kind === "network_node" && !desiredOnline) {
      for (const rawId of state.fields.connected_assembly_ids ?? []) {
        const id = objectId(rawId);
        if (!id) throw new Error("Network node contains an invalid connected assembly ID");
        const target = await readObject(id);
        if (!target || target.kind === "network_node") throw new Error(`Connected assembly ${id} cannot be brought offline`);
        connected.push(target);
      }
    }
    if (!options.fuelAuthority && assembly.kind === "network_node" && desiredOnline &&
      (BigInt(assembly.fuel.quantity) <= 0n || assembly.fuel.typeId <= 0)) {
      throw new Error(`Network node ${assembly.itemId} is locally online without available fuel; cannot mirror online state`);
    }
    if (assembly.kind === "network_node" && desiredOnline) {
      const fuel = suiAssemblyFields(state.fields.fuel);
      if (options.fuelAuthority && (fuelU64(fuel?.quantity, "Chain fuel quantity") === 0n ||
          fuelU64(suiAssemblyOption(fuel?.type_id) ?? 0, "Chain fuel type") === 0n)) {
        throw new Error(`Network node ${assembly.itemId} has no available chain fuel`);
      }
      if (!options.fuelAuthority && (BigInt(fuel.quantity) !== BigInt(assembly.fuel.quantity) ||
          String(suiAssemblyOption(fuel.type_id)) !== String(assembly.fuel.typeId) ||
          String(suiAssemblyOption(fuel.unit_volume)) !== String(assembly.fuel.unitVolume))) {
        throw new Error(`Network node ${assembly.itemId} fuel must be synchronized before bringing it online`);
      }
    }
    await withCaps(tx, assembly.ownerId, [state], ([cap]) => {
      if (assembly.kind === "network_node") {
        if (desiredOnline) {
          tx.moveCall({ target: `${world.packageId}::network_node::online`, arguments: [tx.object(state.id), cap, tx.object("0x6")] });
          // Legacy local-authority mode replaces the native startup charge.
          if (!options.fuelAuthority) tx.moveCall({ target: `${world.packageId}::network_node::deposit_fuel`, arguments: [
            tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(assembly.fuel.typeId),
            tx.pure.u64(assembly.fuel.unitVolume), tx.pure.u64(1), tx.object("0x6"),
          ] });
        } else {
          // Native offline settles elapsed fuel. Only legacy local-authority mode
          // empties and restores the tank to avoid charging its local burn twice.
          const fuel = suiAssemblyFields(state.fields.fuel);
          const currentQuantity = BigInt(fuel.quantity);
          if (!options.fuelAuthority && currentQuantity > 0n) tx.moveCall({ target: `${world.packageId}::network_node::withdraw_fuel`, arguments: [
            tx.object(state.id), tx.object(world.adminAclId), cap,
            tx.pure.u64(suiAssemblyOption(fuel.type_id)), tx.pure.u64(currentQuantity),
          ] });
          let [hotPotato] = tx.moveCall({ target: `${world.packageId}::network_node::offline`, arguments: [
            tx.object(state.id), tx.object(world.fuelConfigId), cap, tx.object("0x6"),
          ] });
          for (const item of connected) {
            [hotPotato] = tx.moveCall({ target: `${world.packageId}::${item.kind}::offline_connected_${item.kind}`,
              arguments: [tx.object(item.id), hotPotato, tx.object(state.id), tx.object(world.energyConfigId)] });
          }
          tx.moveCall({ target: `${world.packageId}::network_node::destroy_offline_assemblies`, arguments: [hotPotato] });
          if (!options.fuelAuthority && assembly.fuel.quantity > 0) tx.moveCall({ target: `${world.packageId}::network_node::deposit_fuel`, arguments: [
            tx.object(state.id), tx.object(world.adminAclId), cap, tx.pure.u64(assembly.fuel.typeId),
            tx.pure.u64(assembly.fuel.unitVolume), tx.pure.u64(assembly.fuel.quantity), tx.object("0x6"),
          ] });
        }
      } else {
        tx.moveCall({ target: `${world.packageId}::${assembly.kind}::${desiredOnline ? "online" : "offline"}`, arguments: [
          tx.object(state.id), tx.object(state.networkNodeId!), tx.object(world.energyConfigId), cap,
        ] });
      }
    });
    if (assembly.kind === "network_node") options.assertFuelSnapshotCurrent?.(assembly);
    return { transaction: tx, connectedAssemblyIds: connected.map(item => item.id) };
  }

  async function syncStatus(assembly: AssemblySnapshot, assertStatusCurrent?: () => void): Promise<void> {
    assertStatusCurrent?.();
    const built = await buildStatusTransaction(assembly);
    if (!built) return;
    assertStatusCurrent?.();
    await execute(`assembly:${assembly.itemId}:${assembly.status === 2 ? "online" : "offline"}`, built.transaction, assembly.ownerId,
      () => { assertStatusCurrent?.(); if (assembly.kind === "network_node") options.assertFuelSnapshotCurrent?.(assembly); });
  }

  /** Only call for a previously confirmed mirror which has disappeared locally. */
  async function removeAssembly(assembly: AssemblySnapshot): Promise<void> {
    const id = deriveId(assembly.itemId);
    // An already-deleted UID is a successful removal, never a reason to reanchor.
    const probe = await client.getObject({ id });
    if (probe.error?.code === "deleted" || probe.error?.code === "notExists") return;
    const state = await readAssembly(assembly);
    if (!state) return;
    if (state.online) throw new Error(`Assembly ${assembly.itemId} must be offline before removal`);
    if (suiAssemblyOption(state.fields.linked_gate_id)) {
      throw new Error(`Gate ${assembly.itemId} must be unlinked before removal`);
    }
    if (state.kind === "storage_unit") {
      for (const keyValue of state.fields.inventory_keys ?? []) {
        const key = objectId(keyValue);
        if (!key) throw new Error(`Storage ${assembly.itemId} contains an invalid inventory key`);
        const inventory = await readInventory(state.id, key);
        const items = suiAssemblyFields(inventory.items)?.contents;
        if (!Array.isArray(items) || items.length !== 0 || BigInt(inventory.used_capacity) !== 0n) {
          throw new Error(`Storage ${assembly.itemId} contains chain inventory; refusing destructive removal`);
        }
      }
    }
    if (state.kind === "network_node") {
      if (BigInt(suiAssemblyFields(state.fields.fuel).quantity) !== 0n) {
        throw new Error(`Network node ${assembly.itemId} still contains fuel`);
      }
      if ((state.fields.connected_assembly_ids ?? []).length) {
        throw new Error(`Network node ${assembly.itemId} still has connected assemblies`);
      }
    }
    const tx = new Transaction();
    if (state.kind === "network_node") {
      const [orphans] = tx.moveCall({ target: `${world.packageId}::network_node::unanchor`, arguments: [
        tx.object(state.id), tx.object(world.adminAclId),
      ] });
      tx.moveCall({ target: `${world.packageId}::network_node::destroy_network_node`, arguments: [
        tx.object(state.id), orphans, tx.object(world.adminAclId),
      ] });
    } else {
      tx.moveCall({ target: `${world.packageId}::${state.kind}::unanchor`, arguments: [
        tx.object(state.id), tx.object(state.networkNodeId!), tx.object(world.energyConfigId), tx.object(world.adminAclId),
      ] });
    }
    await execute(`assembly:${assembly.itemId}:unanchor`, tx);
  }

  return { deriveId, readAssembly, readObject, ensureAssembly, syncMetadata, configureFuelEfficiency, readEnergyRequirements,
    readFuelState, readEnergyState, updateFuel, syncFuel, syncStatus, buildStatusTransaction, removeAssembly, withCaps };
}
export type SuiAssemblyChain = ReturnType<typeof createSuiAssemblyChain>;
