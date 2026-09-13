import { bcs } from "@mysten/sui/bcs";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { SuiAssemblyChain } from "./suiAssemblyChain";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";

export type SuiContentsCharacter = {
  id: string;
  address: string;
  ownerCapId: string;
};

type ContentsOptions = {
  client: {
    getObject(options: any): Promise<any>;
    getDynamicFieldObject(options: any): Promise<any>;
  };
  world: { packageId: string; adminAclId: string; gateConfigId: string; serverAddressRegistryId: string };
  chain: SuiAssemblyChain;
  execute(label: string, transaction: Transaction, ownerId?: number): Promise<unknown>;
  getCharacter(ownerId: number): Promise<SuiContentsCharacter>;
  serverSigner: Ed25519Keypair;
  now?: () => number;
};

type InventoryItem = { itemId: string; typeId: string; quantity: number; unitVolume: string };
type InventoryPartition = {
  key: string;
  ownerId: number;
  character: SuiContentsCharacter;
  capKind: "storage_unit" | "character";
  capObjectId: string;
  maxCapacity: bigint;
  current: Map<string, InventoryItem>;
  desired: Map<string, InventoryItem>;
};
type InventoryChange = { item: InventoryItem; quantity: number; mint: boolean };

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffffffff;
const LocationProofMessage = bcs.struct("LocationProofMessage", {
  server_address: bcs.Address,
  player_address: bcs.Address,
  source_structure_id: bcs.Address,
  source_location_hash: bcs.vector(bcs.u8()),
  target_structure_id: bcs.Address,
  target_location_hash: bcs.vector(bcs.u8()),
  distance: bcs.u64(),
  data: bcs.vector(bcs.u8()),
  deadline_ms: bcs.u64(),
});

function fields(value: any): any {
  return value && typeof value === "object" && value.fields ? value.fields : value;
}

function objectId(value: any, label: string): string {
  const raw = fields(value);
  const id = typeof raw === "string" ? raw : raw?.id;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(id)) {
    throw new Error(`Invalid ${label} in Sui assembly state`);
  }
  return normalizeSuiAddress(id);
}

function uint(value: unknown, bits: 32 | 64, label: string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer or decimal string`);
  }
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be an unsigned integer`);
  const n = BigInt(String(value));
  if (n > (bits === 32 ? BigInt(U32_MAX) : U64_MAX)) throw new Error(`${label} exceeds u${bits}`);
  return n;
}

function optionalId(value: any): string | null {
  if (value === null || value === undefined) return null;
  const raw = fields(value);
  const values = Array.isArray(raw) ? raw : raw?.vec;
  if (Array.isArray(values)) {
    if (values.length === 0) return null;
    if (values.length === 1) return objectId(values[0], "linked gate ID");
  }
  if (typeof raw === "string") return objectId(raw, "linked gate ID");
  throw new Error("Invalid linked gate option in Sui assembly state");
}

function moveObject(result: any, label: string, allowMissing = false): any | null {
  if (result?.error) {
    if (allowMissing && ["notExists", "dynamicFieldNotFound", "deleted"].includes(result.error.code)) return null;
    throw new Error(`Cannot read ${label}: ${result.error.code || "Sui RPC error"}`);
  }
  if (result?.data?.content?.dataType !== "moveObject") throw new Error(`Missing Move object content for ${label}`);
  return result.data.content;
}

/** Match the world's raw PersonalMessage intent, which intentionally omits an extra BCS byte-vector envelope. */
export async function createAssemblyLocationProof(options: {
  signer: Ed25519Keypair;
  playerAddress: string;
  sourceId: string;
  sourceHash: number[];
  targetId: string;
  targetHash: number[];
  distance: string;
  deadlineMs: number;
}): Promise<Uint8Array> {
  for (const hash of [options.sourceHash, options.targetHash]) {
    if (hash.length !== 32 || hash.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error("Assembly location proof requires two 32-byte hashes");
    }
  }
  const message = LocationProofMessage.serialize({
    server_address: options.signer.toSuiAddress(),
    player_address: options.playerAddress,
    source_structure_id: options.sourceId,
    source_location_hash: options.sourceHash,
    target_structure_id: options.targetId,
    target_location_hash: options.targetHash,
    distance: uint(options.distance, 64, "proof distance"),
    data: [],
    deadline_ms: uint(options.deadlineMs, 64, "proof deadline"),
  }).toBytes();
  const signed = await options.signer.signWithIntent(message, "PersonalMessage");
  const signature = bcs.vector(bcs.u8()).serialize(Buffer.from(signed.signature, "base64")).toBytes();
  const proof = new Uint8Array(message.length + signature.length);
  proof.set(message);
  proof.set(signature, message.length);
  return proof;
}

export function aggregateAssemblyInventory(items: AssemblySnapshot["inventory"]): Map<number, Map<string, InventoryItem>> {
  const owners = new Map<number, Map<string, InventoryItem>>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.ownerId) || item.ownerId <= 0) throw new Error("Inventory owner must be a game character ID");
    const typeId = uint(item.typeId, 64, "inventory type ID").toString();
    const itemId = uint(item.itemId, 64, "inventory item ID").toString();
    if (typeId === "0" || itemId === "0") throw new Error("Inventory type and item IDs must be positive");
    const quantity = Number(uint(item.quantity, 32, "inventory quantity"));
    const unitVolume = uint(item.unitVolume, 64, "inventory unit volume").toString();
    if (quantity === 0) continue;
    let inventory = owners.get(item.ownerId);
    if (!inventory) owners.set(item.ownerId, inventory = new Map());
    const previous = inventory.get(typeId);
    if (previous) {
      if (previous.unitVolume !== unitVolume) throw new Error(`Conflicting unit volumes for inventory type ${typeId}`);
      const total = previous.quantity + quantity;
      if (total > U32_MAX) throw new Error(`Inventory type ${typeId} total exceeds u32`);
      previous.quantity = total;
      if (BigInt(itemId) < BigInt(previous.itemId)) previous.itemId = itemId;
    } else {
      inventory.set(typeId, { itemId, typeId, quantity, unitVolume });
    }
  }
  return owners;
}

function inventoryItems(inventory: any): Map<string, InventoryItem> {
  const entries = fields(inventory.items)?.contents;
  if (!Array.isArray(entries)) throw new Error("Malformed Sui storage inventory item map");
  const items = new Map<string, InventoryItem>();
  let used = 0n;
  for (const entry of entries) {
    const pair = fields(entry);
    const value = fields(pair.value);
    const typeId = uint(pair.key, 64, "chain inventory type ID").toString();
    if (String(value.type_id) !== typeId || items.has(typeId)) throw new Error("Inconsistent Sui inventory type map");
    const item = {
      typeId,
      itemId: uint(value.item_id, 64, "chain inventory item ID").toString(),
      quantity: Number(uint(value.quantity, 32, "chain inventory quantity")),
      unitVolume: uint(value.volume, 64, "chain inventory unit volume").toString(),
    };
    used += BigInt(item.quantity) * BigInt(item.unitVolume);
    items.set(typeId, item);
  }
  if (used !== uint(inventory.used_capacity, 64, "chain used capacity")) throw new Error("Inconsistent Sui inventory used capacity");
  return items;
}

function partitionChanges(partition: InventoryPartition): InventoryChange[] {
  const removals: InventoryChange[] = [];
  const additions: InventoryChange[] = [];
  let desiredVolume = 0n;
  for (const desired of partition.desired.values()) desiredVolume += BigInt(desired.quantity) * BigInt(desired.unitVolume);
  if (desiredVolume > partition.maxCapacity) throw new Error(`Inventory for character ${partition.ownerId} exceeds on-chain capacity`);
  for (const typeId of new Set([...partition.current.keys(), ...partition.desired.keys()])) {
    const current = partition.current.get(typeId);
    const desired = partition.desired.get(typeId);
    // Move preserves the first volume per type. Burn the old entry completely before replacing that volume.
    const replace = current && desired && current.unitVolume !== desired.unitVolume;
    const remove = current ? current.quantity - (replace ? 0 : desired?.quantity || 0) : 0;
    const add = desired ? desired.quantity - (replace ? 0 : current?.quantity || 0) : 0;
    if (remove > 0) removals.push({ item: current!, quantity: remove, mint: false });
    if (add > 0) additions.push({ item: desired!, quantity: add, mint: true });
  }
  return [...removals, ...additions];
}

export function createSuiAssemblyContents(options: ContentsOptions) {
  const { client, world, chain, execute, getCharacter, serverSigner } = options;
  const now = options.now || Date.now;
  const target = (module: string, name: string) => `${world.packageId}::${module}::${name}`;

  async function readInventory(snapshot: AssemblySnapshot) {
    if (snapshot.kind !== "storage_unit") throw new Error(`Assembly ${snapshot.itemId} is not a storage unit`);
    const assembly = await chain.readAssembly(snapshot);
    if (!assembly) throw new Error(`Storage unit ${snapshot.itemId} has not been anchored on Sui`);
    const desired = aggregateAssemblyInventory(snapshot.inventory);
    const partitions = new Map<string, InventoryPartition>();
    const owner = await getCharacter(snapshot.ownerId);
    const ownerKey = objectId(assembly.ownerCapId, "storage owner cap");
    const keys = assembly.fields.inventory_keys;
    if (!Array.isArray(keys)) throw new Error(`Storage unit ${snapshot.itemId} has no inventory keys`);
    const seenKeys = new Set<string>();
    let ownerCapacity: bigint | null = null;

    for (const rawKey of keys) {
      const key = objectId(rawKey, "inventory key");
      if (seenKeys.has(key)) throw new Error(`Duplicate storage inventory key ${key}`);
      seenKeys.add(key);
      const result = await client.getDynamicFieldObject({ parentId: assembly.id, name: { type: "0x2::object::ID", value: key } });
      const content = moveObject(result, `storage inventory ${key}`);
      const inventory = fields(content.fields.value);
      const current = inventoryItems(inventory);
      const maxCapacity = uint(inventory.max_capacity, 64, "inventory capacity");
      let character = owner;
      let ownerId = snapshot.ownerId;
      let capKind: InventoryPartition["capKind"] = "storage_unit";
      let capObjectId = assembly.id;
      if (key === ownerKey) {
        ownerCapacity = maxCapacity;
      } else {
        // Empty open inventory has no OwnerCap. It carries no game-owned items to mirror.
        const cap = moveObject(await client.getObject({ id: key, options: { showContent: true } }), `inventory capability ${key}`, true);
        if (!cap) {
          if (current.size > 0) throw new Error(`Storage ${snapshot.itemId} contains open inventory without a local ownership mapping`);
          continue;
        }
        const expectedType = `${world.packageId}::access::OwnerCap<${world.packageId}::character::Character>`;
        if (cap.type !== expectedType) throw new Error(`Unsupported inventory capability type for ${key}`);
        const characterId = objectId(cap.fields.authorized_object_id, "inventory character");
        const characterContent = moveObject(await client.getObject({ id: characterId, options: { showContent: true } }), `inventory character ${characterId}`);
        const characterKey = fields(characterContent.fields.key);
        ownerId = Number(uint(characterKey.item_id ?? characterKey.id, 64, "inventory character ID"));
        if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("Inventory character ID is outside EveJS range");
        character = await getCharacter(ownerId);
        if (objectId(character.id, "character ID") !== characterId || objectId(character.ownerCapId, "character owner cap") !== key) {
          throw new Error(`Inventory capability does not match game character ${ownerId}`);
        }
        if (ownerId === snapshot.ownerId) {
          if (current.size > 0) throw new Error(`Storage owner ${ownerId} has a separate ephemeral partition not represented by local state`);
          continue;
        }
        capKind = "character";
        capObjectId = characterId;
      }
      partitions.set(key, { key, ownerId, character, capKind, capObjectId, maxCapacity, current, desired: desired.get(ownerId) || new Map() });
    }
    if (ownerCapacity === null) throw new Error(`Storage unit ${snapshot.itemId} is missing its owner inventory`);
    for (const [ownerId, items] of desired) {
      if ([...partitions.values()].some((partition) => partition.ownerId === ownerId)) continue;
      const character = await getCharacter(ownerId);
      const key = objectId(character.ownerCapId, "character owner cap");
      if (seenKeys.has(key)) throw new Error(`Unmapped inventory partition for character ${ownerId}`);
      partitions.set(key, { key, ownerId, character, capKind: "character", capObjectId: character.id, maxCapacity: ownerCapacity, current: new Map(), desired: items });
    }
    return { assembly, partitions: [...partitions.values()] };
  }

  async function hasInventoryChanges(snapshot: AssemblySnapshot): Promise<boolean> {
    const state = await readInventory(snapshot);
    return state.partitions.some((partition) => partitionChanges(partition).length > 0);
  }

  async function syncInventory(snapshot: AssemblySnapshot): Promise<void> {
    const state = await readInventory(snapshot);
    // Validate all partitions before the first mutation, including capacity and supported ownership.
    const plans = state.partitions.map((partition) => ({ partition, changes: partitionChanges(partition) }));
    if (!plans.some((plan) => plan.changes.length)) return;
    if (!state.assembly.online) throw new Error(`Storage ${snapshot.itemId} must be online to mirror inventory changes`);
    for (const { partition, changes } of plans) {
      // Bound PTB size. Completed chunks are observed on the next read if a later transaction fails.
      for (let offset = 0; offset < changes.length; offset += 32) {
        const chunk = changes.slice(offset, offset + 32);
        const tx = new Transaction();
        const proof = chunk.some((change) => !change.mint) ? await createAssemblyLocationProof({
          signer: serverSigner, playerAddress: partition.character.address,
          sourceId: partition.character.id, sourceHash: state.assembly.locationHash,
          targetId: state.assembly.id, targetHash: state.assembly.locationHash,
          distance: "0", deadlineMs: now() + 300_000,
        }) : null;
        await chain.withCaps(tx, partition.ownerId, [{ id: partition.capObjectId, kind: partition.capKind, ownerCapId: partition.key }], ([cap]) => {
          for (const change of chunk) {
            const generic = partition.capKind === "character" ? target("character", "Character") : target("storage_unit", "StorageUnit");
            const args = change.mint ? [
              tx.object(state.assembly.id), tx.object(world.adminAclId), tx.object(partition.character.id), cap,
              tx.pure.u64(change.item.itemId), tx.pure.u64(change.item.typeId), tx.pure.u64(change.item.unitVolume), tx.pure.u32(change.quantity),
            ] : [
              tx.object(state.assembly.id), tx.object(world.serverAddressRegistryId), tx.object(partition.character.id), cap,
              tx.pure.u64(change.item.typeId), tx.pure.u32(change.quantity), tx.pure.vector("u8", Array.from(proof!)), tx.object("0x6"),
            ];
            tx.moveCall({ target: target("storage_unit", change.mint ? "game_item_to_chain_inventory" : "chain_item_to_game_inventory"), typeArguments: [generic], arguments: args });
          }
        });
        await execute(`inventory:${snapshot.itemId}:${partition.ownerId}:${offset}`, tx, partition.ownerId);
      }
    }
  }

  async function ensureGateRange(snapshot: AssemblySnapshot): Promise<void> {
    const maximum = uint(snapshot.gateMaxDistanceMeters, 64, "gate maximum distance");
    if (maximum === 0n) throw new Error(`Gate ${snapshot.itemId} has no positive maximum range`);
    const config = moveObject(await client.getObject({ id: world.gateConfigId, options: { showContent: true } }), "gate configuration");
    const tableId = objectId(fields(config.fields.max_distance_by_type).id, "gate distance table");
    const current = moveObject(await client.getDynamicFieldObject({ parentId: tableId, name: { type: "u64", value: String(snapshot.typeId) } }), "gate type distance", true);
    if (current && uint(current.fields.value, 64, "gate type distance") === maximum) return;
    const tx = new Transaction();
    tx.moveCall({ target: target("gate", "set_max_distance"), arguments: [tx.object(world.gateConfigId), tx.object(world.adminAclId), tx.pure.u64(snapshot.typeId), tx.pure.u64(maximum)] });
    await execute(`gate-range:${snapshot.typeId}`, tx);
  }

  async function syncGateLinks(snapshots: AssemblySnapshot[]): Promise<void> {
    const gates = snapshots.filter((snapshot) => snapshot.kind === "gate");
    const byItemId = new Map(gates.map((snapshot) => [snapshot.itemId, snapshot]));
    // Links are reciprocal game state. Reject transient half-written pairs before changing the chain.
    for (const gate of gates) {
      if (!gate.destinationGateId) continue;
      const destination = byItemId.get(gate.destinationGateId);
      if (!destination || destination.destinationGateId !== gate.itemId || destination.itemId === gate.itemId) throw new Error(`Gate ${gate.itemId} has a nonreciprocal local link`);
      if (destination.ownerId !== gate.ownerId || destination.typeId !== gate.typeId) throw new Error(`Gate ${gate.itemId} links incompatible owner or type`);
      if (uint(gate.gateDistanceMeters, 64, "gate distance") > uint(gate.gateMaxDistanceMeters, 64, "gate maximum distance")) throw new Error(`Gate ${gate.itemId} exceeds its local link range`);
    }
    // Remove stale links first so rewiring A-B into A-C never attempts to link an occupied gate.
    for (const snapshot of gates) {
      const gate = await chain.readAssembly(snapshot);
      if (!gate) throw new Error(`Gate ${snapshot.itemId} has not been anchored on Sui`);
      const actual = optionalId(gate.fields.linked_gate_id);
      const desired = snapshot.destinationGateId ? chain.deriveId(snapshot.destinationGateId) : null;
      if (!actual || actual === desired) continue;
      const other = moveObject(await client.getObject({ id: actual, options: { showContent: true } }), "linked destination gate");
      if (other.type !== target("gate", "Gate") || optionalId(other.fields.linked_gate_id) !== gate.id) throw new Error(`Gate ${snapshot.itemId} has an inconsistent on-chain link`);
      const tx = new Transaction();
      tx.moveCall({ target: target("gate", "unlink_gates_by_admin"), arguments: [tx.object(gate.id), tx.object(actual), tx.object(world.adminAclId)] });
      await execute(`gate-unlink:${snapshot.itemId}`, tx);
    }
    const processed = new Set<string>();
    for (const snapshot of gates) {
      if (!snapshot.destinationGateId || processed.has(snapshot.itemId)) continue;
      const destinationSnapshot = byItemId.get(snapshot.destinationGateId)!;
      const gate = await chain.readAssembly(snapshot);
      const destination = await chain.readAssembly(destinationSnapshot);
      if (!gate || !destination) throw new Error(`Missing Sui gate for local link ${snapshot.itemId}`);
      const gateLink = optionalId(gate.fields.linked_gate_id);
      const destinationLink = optionalId(destination.fields.linked_gate_id);
      if (gateLink === destination.id && destinationLink === gate.id) {
        processed.add(snapshot.itemId); processed.add(destinationSnapshot.itemId); continue;
      }
      if (gateLink || destinationLink) throw new Error(`Gate ${snapshot.itemId} remains linked to an unexpected destination`);
      await ensureGateRange(snapshot);
      const character = await getCharacter(snapshot.ownerId);
      // Gate::link_gates verifies the SOURCE gate's Location as the proof TARGET.
      const proof = await createAssemblyLocationProof({
        signer: serverSigner, playerAddress: character.address,
        sourceId: destination.id, sourceHash: destination.locationHash,
        targetId: gate.id, targetHash: gate.locationHash,
        distance: String(snapshot.gateDistanceMeters), deadlineMs: now() + 300_000,
      });
      const tx = new Transaction();
      await chain.withCaps(tx, snapshot.ownerId, [gate, destination], ([sourceCap, destinationCap]) => {
        tx.moveCall({ target: target("gate", "link_gates"), arguments: [
          tx.object(gate.id), tx.object(destination.id), tx.object(world.gateConfigId), tx.object(world.serverAddressRegistryId), tx.object(world.adminAclId),
          sourceCap, destinationCap, tx.pure.vector("u8", Array.from(proof)), tx.object("0x6"),
        ] });
      });
      await execute(`gate-link:${snapshot.itemId}:${destinationSnapshot.itemId}`, tx, snapshot.ownerId);
      processed.add(snapshot.itemId); processed.add(destinationSnapshot.itemId);
    }
  }

  return { hasInventoryChanges, syncInventory, syncGateLinks };
}
