/** Pure normalization of EveJS state; never opens a store or submits a transaction. */
import { getAssemblyEnergyRequirements, NETWORK_NODE_RADIUS_METERS } from "./networkNodeEnergyConfig";
export const SUI_ASSEMBLY_VOLUME_SCALE = "1000000";
// Move compares volume * quantity with capacity without prescribing units. Both
// are encoded in micro-m³ here to preserve the client's fractional m³ volumes.
export const SUI_ASSEMBLY_DEFAULT_MAX_ENERGY = "1000";
const METERS_PER_LIGHT_YEAR = 9_460_730_472_580_800n;
const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffffffff;
type Row = Record<string, any>;
type Rows = Row[] | Record<string, any>;

export interface CharacterSnapshot {
  accountId: number;
  gameCharacterId: number;
  characterName: string;
}
export interface AssemblySnapshot {
  itemId: string;
  typeId: number;
  ownerId: number;
  name: string;
  kind: "network_node" | "gate" | "storage_unit" | "turret" | "assembly";
  status: 1 | 2;
  solarSystemId: number;
  position: { x: number; y: number; z: number };
  networkNodeId: string | null;
  energyRequired?: number;
  destinationGateId: string | null;
  gateDistanceMeters: string | null;
  gateMaxDistanceMeters: string | null;
  fuel: { typeId: number; quantity: number; unitVolume: string };
  fuelCapacity: string;
  burnRateMs: string;
  maxEnergy: string;
  storageCapacity: string;
  inventory: Array<{
    ownerId: number;
    itemId: string;
    typeId: number;
    quantity: number;
    unitVolume: string;
  }>;
}
export interface SuiAssemblySnapshotError {
  itemId: string | null;
  code: string;
  message: string;
}
export interface SuiAssemblySnapshotInput {
  items: Rows;
  characters: Rows;
  components: Rows;
  itemTypes: Rows;
  solarSystems?: Rows;
  /** Previously verified on-chain bindings; a missing bound node never triggers rebinding. */
  networkNodeBindings?: Record<string, string>;
}
export interface SuiAssemblySnapshot {
  assemblies: AssemblySnapshot[];
  characters: CharacterSnapshot[];
  errors: SuiAssemblySnapshotError[];
}

function record(value: any): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function entries(input: Rows | undefined, wrapper?: string): Array<[string | null, Row]> {
  const value = wrapper && record(input) && Array.isArray(input[wrapper])
    ? input[wrapper] : input;
  if (Array.isArray(value)) return value.filter(record).map((row) => [null, row]);
  return record(value) ? Object.entries(value).filter(([, row]) => record(row)) : [];
}
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function decimal(value: any, label: string, multiplier = 1n, positive = true): string {
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
    fail("INVALID_NUMBER", `${label} must be finite and nonnegative`);
  }
  if (!["number", "string", "bigint"].includes(typeof value)) {
    fail("INVALID_NUMBER", `${label} is missing or invalid`);
  }
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!match) fail("INVALID_NUMBER", `${label} must be a nonnegative decimal`);
  const exponent = Number(match[3] || 0) - (match[2] || "").length;
  if (Math.abs(exponent) > 100) fail("INVALID_NUMBER", `${label} is out of range`);
  let numerator = BigInt(match[1] + (match[2] || "")) * multiplier;
  const denominator = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (numerator % denominator !== 0n) {
    fail("INVALID_PRECISION", `${label} cannot be represented exactly in chain units`);
  }
  const result = numerator / denominator;
  if (result > U64_MAX || (positive && result === 0n)) {
    fail("INVALID_NUMBER", `${label} is outside the supported u64 range`);
  }
  return result.toString();
}
function id(value: any, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    fail("INVALID_ID", `${label} is an unsafe numeric identifier; supply a decimal string`);
  }
  if (!/^[0-9]+$/.test(String(value))) fail("INVALID_ID", `${label} is missing or invalid`);
  return decimal(value, label);
}
function integer(value: any, label: string, max = Number.MAX_SAFE_INTEGER, zero = false): number {
  const parsed = Number(id(zero && (value === 0 || value === "0") ? 1 : value, label));
  const result = zero && (value === 0 || value === "0") ? 0 : parsed;
  if (!Number.isSafeInteger(result) || result > max) fail("INVALID_NUMBER", `${label} is out of range`);
  return result;
}
function vector(value: any, label: string): AssemblySnapshot["position"] {
  const raw = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
  if (!record(raw) || ![raw.x, raw.y, raw.z].every((n) => typeof n === "number" && Number.isFinite(n))) {
    fail("INVALID_POSITION", `${label} requires finite x, y, z coordinates`);
  }
  return { x: raw.x, y: raw.y, z: raw.z };
}
function index(input: Rows | undefined, fields: string[], wrapper?: string): Map<string, Row> {
  const result = new Map<string, Row>();
  const duplicates = new Set<string>();
  for (const [key, row] of entries(input, wrapper)) {
    const value = fields.map((field) => row[field]).find((v) => v !== undefined) ?? key;
    try {
      const normalized = id(value, fields[0]);
      if (result.has(normalized)) duplicates.add(normalized);
      result.set(normalized, row);
    } catch (_) { /* Unused metadata rows do not invalidate an empty snapshot. */ }
  }
  for (const key of duplicates) result.delete(key);
  return result;
}
function compareIds(a: string, b: string): number { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0; }

export function buildSuiAssemblySnapshot(input: SuiAssemblySnapshotInput): SuiAssemblySnapshot {
  const errors: SuiAssemblySnapshotError[] = [];
  const addError = (itemId: string | null, error: any) => errors.push({
    itemId, code: error.code || "INVALID_ASSEMBLY", message: error.message || String(error),
  });
  const components = index(input.components, ["typeID", "_key"], "types");
  const energyRequirements = new Map(getAssemblyEnergyRequirements([...components].map(([typeID, row]) =>
    ({ ...row, typeID: Number(typeID) }))).map(entry => [entry.typeID, entry.energyRequired]));
  const itemTypes = index(input.itemTypes, ["typeID", "_key"], "types");
  const characterRows = index(input.characters, ["gameCharacterId", "characterID", "characterId", "_key"]);
  const systems = index(input.solarSystems, ["solarSystemID", "_key"], "solarSystems");
  const characters = new Map<number, CharacterSnapshot>();
  const character = (ownerId: number) => {
    const row = characterRows.get(String(ownerId));
    if (!row) fail("MISSING_OWNER", `Character ${ownerId} is absent or ambiguous`);
    const name = row.characterName ?? row.name;
    if (typeof name !== "string" || !name.trim()) fail("INVALID_OWNER", `Character ${ownerId} has no name`);
    const value = {
      accountId: integer(row.accountId ?? row.accountID, `Character ${ownerId} account ID`),
      gameCharacterId: integer(ownerId, "Game character ID", U32_MAX),
      characterName: name.trim(),
    };
    characters.set(ownerId, value);
  };
  const volume = (value: any, label: string, positive = true) => decimal(value, label, BigInt(SUI_ASSEMBLY_VOLUME_SCALE), positive);
  const items = entries(input.items);
  const candidates = new Map<string, AssemblySnapshot>();
  const localBindings = new Map<string, { nodeId: string | null; autoConnect: boolean }>();
  const duplicateIds = new Set<string>();
  for (const [key, item] of items) {
    let itemId: string | null = null;
    try {
      let info = item.customInfo;
      if (typeof info === "string") {
        try { info = info.trim() ? JSON.parse(info) : {}; }
        catch (_) {
          if (info.includes("evejsFrontierConstruction")) fail("INVALID_CUSTOM_INFO", "Assembly customInfo is invalid JSON");
          continue;
        }
      }
      if (!record(info) || !record(info.evejsFrontierConstruction)) continue;
      const state = info.evejsFrontierConstruction;
      itemId = id(item.itemID ?? key, "Assembly item ID");
      if (Number(state.assemblyStatus) === 5) continue;
      const typeId = integer(state.assemblyTypeID, "Assembly type ID", U32_MAX);
      const component = components.get(String(typeId));
      if (!component) fail("MISSING_COMPONENT", `Assembly type ${typeId} metadata is absent or ambiguous`);
      if (Number(component.smartDeployable?.createOnChain) !== 1) continue;
      if (![1, 2].includes(Number(state.assemblyStatus))) fail("INVALID_STATUS", "Completed assembly status must be offline (1) or online (2)");
      if (integer(item.typeID, "Item type ID", U32_MAX) !== typeId) fail("TYPE_MISMATCH", "Completed item type differs from construction state");
      const ownerId = integer(item.ownerID, "Assembly owner ID", U32_MAX);
      character(ownerId);
      if (state.ownerID !== undefined && integer(state.ownerID, "Construction owner ID", U32_MAX) !== ownerId) fail("OWNER_MISMATCH", "Item and construction owners differ");
      const solarSystemId = integer(state.solarSystemID ?? item.locationID, "Assembly solar system ID", U32_MAX);
      if (item.locationID !== undefined && integer(item.locationID, "Item solar system ID", U32_MAX) !== solarSystemId) fail("SYSTEM_MISMATCH", "Item and construction solar systems differ");
      const kind: AssemblySnapshot["kind"] = component.smartAnchor ? "network_node" : component.smartGate ? "gate" : component.smartStorageUnit ? "storage_unit" : component.smartTurret ? "turret" : "assembly";
      const energy = info.evejsFrontierEnergy;
      if (energy !== undefined) {
        if (!record(energy)) fail("INVALID_NETWORK_NODE_BINDING", "Local energy grid binding is invalid");
        localBindings.set(itemId, {
          nodeId: energy.networkNodeID == null || Number(energy.networkNodeID) === 0 ? null : id(energy.networkNodeID, "Local Network Node ID"),
          autoConnect: energy.autoConnect !== false,
        });
      }
      const name = item.itemName || itemTypes.get(String(typeId))?.name;
      if (typeof name !== "string" || !name.trim()) fail("INVALID_NAME", "Assembly has no name");
      const assembly: AssemblySnapshot = {
        itemId, typeId, ownerId, name: name.trim(), kind,
        status: Number(state.assemblyStatus) as 1 | 2, solarSystemId,
        position: vector(item.spaceState?.position, "Assembly position"),
        networkNodeId: null, destinationGateId: null,
        gateDistanceMeters: null, gateMaxDistanceMeters: null,
        fuel: { typeId: 0, quantity: 0, unitVolume: "0" },
        fuelCapacity: "0", burnRateMs: "0", maxEnergy: "0", storageCapacity: "0", inventory: [],
      };
      if (kind !== "network_node") assembly.energyRequired = energyRequirements.get(typeId) ?? 0;
      if (kind === "network_node") {
        assembly.fuelCapacity = volume(component.smartAnchor.fuelMaxCapacity, "Fuel capacity");
        assembly.burnRateMs = decimal(component.smartAnchor.fuelBurnRateInSeconds, "Fuel burn interval", 1000n);
        // Only missing authored energy uses this explicit local emulator policy.
        assembly.maxEnergy = decimal(component.smartAnchor.maxEnergyCapacity ?? SUI_ASSEMBLY_DEFAULT_MAX_ENERGY, "Maximum energy");
        const fuel = info.evejsFrontierNetworkNodeFuel;
        if (fuel !== undefined) {
          if (!record(fuel)) fail("INVALID_FUEL", "Network Node fuel state is invalid");
          const quantity = integer(fuel.quantity, "Fuel quantity", Number.MAX_SAFE_INTEGER, true);
          if (quantity > 0) {
            const fuelType = integer(fuel.typeID, "Fuel type ID", U32_MAX);
            const metadata = itemTypes.get(String(fuelType));
            if (!metadata) fail("MISSING_FUEL_TYPE", `Fuel type ${fuelType} metadata is absent or ambiguous`);
            assembly.fuel = { typeId: fuelType, quantity, unitVolume: volume(metadata.volume, "Fuel unit volume") };
            if (BigInt(assembly.fuel.unitVolume) * BigInt(quantity) > BigInt(assembly.fuelCapacity)) fail("FUEL_CAPACITY_EXCEEDED", "Fuel exceeds the authored volume capacity");
          }
        }
        if (assembly.status === 2 && assembly.fuel.quantity === 0) fail("MISSING_FUEL", "An online Network Node requires fuel before chain synchronization");
      }
      if (kind === "gate") {
        assembly.gateMaxDistanceMeters = decimal(component.smartGate.range, "Gate range", METERS_PER_LIGHT_YEAR);
        if (state.destinationGateID !== undefined && Number(state.destinationGateID) !== 0) assembly.destinationGateId = id(state.destinationGateID, "Destination gate ID");
        if (assembly.status === 2 && !assembly.destinationGateId) fail("MISSING_GATE_DESTINATION", "An online gate requires a destination");
      }
      if (kind === "storage_unit") {
        assembly.storageCapacity = volume(component.smartStorageUnit.storageCapacity, "Storage capacity");
        const usedByOwner = new Map<number, bigint>();
        const quantityByOwnerType = new Map<string, number>();
        const inventoryIds = new Set<string>();
        for (const [inventoryKey, inventoryItem] of items) {
          if (String(inventoryItem.locationID) !== itemId || Number(inventoryItem.flagID) !== 66) continue;
          const inventoryOwner = integer(inventoryItem.ownerID, "Inventory owner ID", U32_MAX);
          character(inventoryOwner);
          const inventoryId = id(inventoryItem.itemID ?? inventoryKey, "Inventory item ID");
          if (inventoryIds.has(inventoryId)) fail("DUPLICATE_ITEM", "Inventory item ID appears more than once");
          inventoryIds.add(inventoryId);
          const inventoryType = integer(inventoryItem.typeID, "Inventory type ID", U32_MAX);
          const quantity = Number(inventoryItem.singleton) === 1 ? 1 : integer(inventoryItem.stacksize ?? inventoryItem.quantity, "Inventory quantity", U32_MAX);
          const quantityKey = `${inventoryOwner}:${inventoryType}`;
          const combinedQuantity = (quantityByOwnerType.get(quantityKey) || 0) + quantity;
          if (combinedQuantity > U32_MAX) fail("INVENTORY_QUANTITY_EXCEEDED", `Character ${inventoryOwner} total quantity for type ${inventoryType} exceeds u32`);
          quantityByOwnerType.set(quantityKey, combinedQuantity);
          const metadata = itemTypes.get(String(inventoryType));
          if (!metadata) fail("MISSING_ITEM_TYPE", `Inventory type ${inventoryType} metadata is absent or ambiguous`);
          const unitVolume = volume(metadata.volume, "Inventory unit volume", false);
          const used = (usedByOwner.get(inventoryOwner) || 0n) + BigInt(unitVolume) * BigInt(quantity);
          const capacity = inventoryOwner === ownerId ? assembly.storageCapacity : volume(component.smartStorageUnit.personalCapacity, "Personal storage capacity");
          if (used > BigInt(capacity)) fail("STORAGE_CAPACITY_EXCEEDED", `Character ${inventoryOwner} inventory exceeds its local capacity`);
          usedByOwner.set(inventoryOwner, used);
          assembly.inventory.push({ ownerId: inventoryOwner, itemId: inventoryId, typeId: inventoryType, quantity, unitVolume });
        }
        assembly.inventory.sort((a, b) => a.ownerId - b.ownerId || compareIds(a.itemId, b.itemId));
      }
      if (candidates.has(itemId)) duplicateIds.add(itemId);
      candidates.set(itemId, assembly);
    } catch (error) { addError(itemId, error); }
  }
  for (const itemId of duplicateIds) {
    candidates.delete(itemId);
    addError(itemId, { code: "DUPLICATE_ITEM", message: "Assembly item ID appears more than once" });
  }
  for (const assembly of [...candidates.values()]) {
    try {
      if (assembly.kind !== "network_node") {
        let selected: AssemblySnapshot;
        const localBinding = localBindings.get(assembly.itemId);
        const verifiedBinding = input.networkNodeBindings && Object.prototype.hasOwnProperty.call(input.networkNodeBindings, assembly.itemId)
          ? id(input.networkNodeBindings[assembly.itemId], "Bound Network Node ID") : null;
        if (verifiedBinding && localBinding && ((localBinding.nodeId && localBinding.nodeId !== verifiedBinding) ||
            (!localBinding.nodeId && !localBinding.autoConnect))) {
          fail("NETWORK_NODE_BINDING_LOCKED", "The deployed contract does not support detaching this assembly from its existing Network Node");
        }
        if (!verifiedBinding && localBinding && !localBinding.nodeId && !localBinding.autoConnect) {
          if (assembly.status === 2) fail("DISCONNECTED_NETWORK_NODE", "An online assembly requires an energy grid connection");
          // Offline disconnected creations remain local until attached to a node.
          candidates.delete(assembly.itemId);
          continue;
        }
        const boundId = verifiedBinding ?? localBinding?.nodeId;
        if (boundId) {
          const bound = candidates.get(boundId);
          if (!bound) fail("MISSING_NETWORK_NODE", `Previously bound Network Node ${boundId} is missing or cannot be normalized`);
          if (bound.kind !== "network_node" || bound.ownerId !== assembly.ownerId || bound.solarSystemId !== assembly.solarSystemId) fail("INVALID_NETWORK_NODE_BINDING", `Previously bound Network Node ${boundId} no longer matches the assembly owner and system`);
          selected = bound;
        } else {
          const nearest = [...candidates.values()].filter((node) => node.kind === "network_node" && node.ownerId === assembly.ownerId && node.solarSystemId === assembly.solarSystemId)
            .map((node) => ({ node, distance: Math.hypot(node.position.x - assembly.position.x, node.position.y - assembly.position.y, node.position.z - assembly.position.z) }))
            .filter(candidate => Number.isFinite(candidate.distance) && candidate.distance <= NETWORK_NODE_RADIUS_METERS)
            .sort((a, b) => a.distance - b.distance || compareIds(a.node.itemId, b.node.itemId));
          if (!nearest.length) fail("MISSING_NETWORK_NODE", "No completed owned Network Node exists within 80 km");
          selected = nearest[0].node;
        }
        const distance = Math.hypot(selected.position.x - assembly.position.x, selected.position.y - assembly.position.y, selected.position.z - assembly.position.z);
        if (!Number.isFinite(distance) || distance > NETWORK_NODE_RADIUS_METERS) fail("NETWORK_NODE_OUT_OF_RANGE", "Bound Network Node is outside its 80 km energy radius");
        if (assembly.status === 2 && selected.status !== 2) fail("OFFLINE_NETWORK_NODE", "An online assembly requires its owned Network Node online");
        assembly.networkNodeId = selected.itemId;
      }
      if (assembly.kind === "gate" && assembly.destinationGateId) {
        const target = candidates.get(assembly.destinationGateId);
        if (!target || target.kind !== "gate" || target.typeId !== assembly.typeId || target.ownerId !== assembly.ownerId || target.destinationGateId !== assembly.itemId || target.solarSystemId === assembly.solarSystemId) fail("INVALID_GATE_LINK", "Gate destination must be a reciprocal same-type owned gate in a different system");
        const sourcePosition = vector(systems.get(String(assembly.solarSystemId))?.position, "Source system position");
        const targetPosition = vector(systems.get(String(target.solarSystemId))?.position, "Destination system position");
        const distance = Math.ceil(Math.hypot(sourcePosition.x - targetPosition.x, sourcePosition.y - targetPosition.y, sourcePosition.z - targetPosition.z));
        if (!Number.isFinite(distance) || distance < 0) fail("INVALID_GATE_DISTANCE", "Gate distance is invalid");
        assembly.gateDistanceMeters = decimal(BigInt(distance), "Gate distance", 1n, false);
        if (BigInt(assembly.gateDistanceMeters) > BigInt(assembly.gateMaxDistanceMeters!)) fail("GATE_OUT_OF_RANGE", "Gate destination exceeds its authored range");
      }
    } catch (error) { candidates.delete(assembly.itemId); addError(assembly.itemId, error); }
  }
  // If a paired gate failed later in traversal, never retain a dangling link.
  for (const assembly of [...candidates.values()]) {
    if (assembly.destinationGateId && !candidates.has(assembly.destinationGateId)) {
      candidates.delete(assembly.itemId);
      addError(assembly.itemId, { code: "INVALID_GATE_LINK", message: "Destination gate could not be normalized" });
    }
  }
  const assemblies = [...candidates.values()].sort((a, b) => Number(b.kind === "network_node") - Number(a.kind === "network_node") || compareIds(a.itemId, b.itemId));
  const usedOwners = new Set(assemblies.flatMap((assembly) => [assembly.ownerId, ...assembly.inventory.map((item) => item.ownerId)]));
  return { assemblies, characters: [...characters.values()].filter((owner) => usedOwners.has(owner.gameCharacterId)).sort((a, b) => a.gameCharacterId - b.gameCharacterId), errors };
}
