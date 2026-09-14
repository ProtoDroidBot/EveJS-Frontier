import assert = require("node:assert/strict");
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  aggregateAssemblyInventory,
  createAssemblyLocationProof,
  createSuiAssemblyContents,
} from "../src/services/frontier/suiAssemblyContents";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";

const id = (value: number | string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const packageId = id(900);
const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(17));
const world = { packageId, adminAclId: id(901), gateConfigId: id(902), serverAddressRegistryId: id(903) };
const schema = bcs.struct("LocationProofMessage", {
  server_address: bcs.Address, player_address: bcs.Address,
  source_structure_id: bcs.Address, source_location_hash: bcs.vector(bcs.u8()),
  target_structure_id: bcs.Address, target_location_hash: bcs.vector(bcs.u8()),
  distance: bcs.u64(), data: bcs.vector(bcs.u8()), deadline_ms: bcs.u64(),
});
const proofSchema = bcs.struct("LocationProof", { message: schema, signature: bcs.vector(bcs.u8()) });

function snapshot(overrides: Partial<AssemblySnapshot> = {}): AssemblySnapshot {
  return {
    itemId: "100", typeId: 44, ownerId: 1, name: "Storage", kind: "storage_unit", status: 2,
    solarSystemId: 3001, position: { x: 0, y: 0, z: 0 }, networkNodeId: "50", destinationGateId: null,
    gateDistanceMeters: null, gateMaxDistanceMeters: null,
    fuel: { typeId: 10, quantity: 0, unitVolume: "1" }, fuelCapacity: "1000", burnRateMs: "1000",
    maxEnergy: "1000", storageCapacity: "1000", inventory: [], ...overrides,
  };
}

function move(type: string, fields: any) {
  return { data: { content: { dataType: "moveObject", type, fields } } };
}

function inventory(items: Array<{ typeId: number; quantity: number; volume: number }> = []) {
  return move(`${packageId}::inventory::Inventory`, { value: { fields: {
    max_capacity: "1000", used_capacity: String(items.reduce((total, item) => total + item.volume * item.quantity, 0)),
    items: { fields: { contents: items.map((item) => ({ fields: { key: String(item.typeId), value: { fields: {
      type_id: String(item.typeId), item_id: String(item.typeId + 10000), quantity: item.quantity, volume: String(item.volume),
    } } } })) } },
  } } });
}

function fixture(assemblies: AssemblySnapshot[] = [snapshot()], assertInventorySnapshotCurrent?: (snapshot: AssemblySnapshot) => void) {
  const objects = new Map<string, any>();
  const dynamic = new Map<string, any>();
  const chainObjects = new Map<string, any>();
  const executed: Array<{ label: string; transaction: Transaction; ownerId: number | undefined }> = [];
  const borrowed: Array<{ ownerId: number; refs: any[] }> = [];
  let onRead: () => void = () => {};
  for (const assembly of assemblies) {
    const capId = id(String(BigInt(assembly.itemId) + 1000n));
    chainObjects.set(assembly.itemId, {
      id: id(assembly.itemId), kind: assembly.kind, ownerCapId: capId, online: assembly.status === 2,
      networkNodeId: id(50), locationHash: new Array(32).fill(Number(assembly.itemId) % 255),
      fields: { inventory_keys: [capId], linked_gate_id: { fields: { vec: [] } } },
    });
    dynamic.set(capId, inventory());
  }
  const client = {
    async getObject({ id: objectId }: any) {
      return objects.get(objectId) || { error: { code: "notExists" } };
    },
    async getDynamicFieldObject({ name }: any) {
      onRead();
      return dynamic.get(String(name.value)) || { error: { code: "dynamicFieldNotFound" } };
    },
  };
  const chain: any = {
    deriveId: id,
    async readAssembly(assembly: AssemblySnapshot) { return chainObjects.get(assembly.itemId) || null; },
    async withCaps(tx: Transaction, ownerId: number, refs: any[], callback: any) {
      borrowed.push({ ownerId, refs });
      callback(refs.map((ref) => tx.object(ref.ownerCapId)));
    },
  };
  let onExecute: (label: string) => void = () => {};
  const contents = createSuiAssemblyContents({
    client, chain, world, serverSigner: signer, now: () => 123_000, assertInventorySnapshotCurrent,
    getCharacter: async (ownerId) => ({ id: id(ownerId), address: id(ownerId + 500), ownerCapId: id(ownerId + 2000) }),
    execute: async (label, transaction, ownerId, assertSnapshotCurrent) => {
      onExecute(label);
      assertSnapshotCurrent?.();
      executed.push({ label, transaction, ownerId });
    },
  });
  return { contents, chainObjects, objects, dynamic, executed, borrowed,
    setOnExecute(fn: typeof onExecute) { onExecute = fn; }, setOnRead(fn: typeof onRead) { onRead = fn; } };
}

function calls(transaction: Transaction): any[] {
  return transaction.getData().commands.filter((command) => command.$kind === "MoveCall").map((command) => command.MoveCall);
}

test("location proofs use the raw Move personal-message intent and distinct gate hashes", async () => {
  const bytes = await createAssemblyLocationProof({
    signer, playerAddress: id(1), sourceId: id(2), sourceHash: new Array(32).fill(3),
    targetId: id(4), targetHash: new Array(32).fill(5), distance: "9000", deadlineMs: 500_000,
  });
  const decoded = proofSchema.parse(bytes);
  assert.equal(decoded.message.source_structure_id, id(2));
  assert.equal(decoded.message.target_structure_id, id(4));
  assert.equal(decoded.message.distance, "9000");
  assert.equal(decoded.signature.length, 97);
  const message = schema.serialize(decoded.message).toBytes();
  assert.equal(await signer.getPublicKey().verifyWithIntent(message, Buffer.from(decoded.signature).toString("base64"), "PersonalMessage"), true);
  assert.equal(await signer.getPublicKey().verifyPersonalMessage(message, Buffer.from(decoded.signature).toString("base64")), false);
  await assert.rejects(createAssemblyLocationProof({ signer, playerAddress: id(1), sourceId: id(2), sourceHash: [], targetId: id(4), targetHash: [], distance: "0", deadlineMs: 100 }), /32-byte/);
});

test("inventory aggregates stack quantities by owner/type and validates overflow and volume", () => {
  const item = { ownerId: 1, itemId: "100", typeId: 10, quantity: 2, unitVolume: "3" };
  const result = aggregateAssemblyInventory([item, { ...item, itemId: "99", quantity: 5 }, { ...item, ownerId: 2 }]);
  assert.deepEqual(result.get(1)?.get("10"), { itemId: "99", typeId: "10", quantity: 7, unitVolume: "3" });
  assert.equal(result.get(2)?.get("10")?.quantity, 2);
  assert.throws(() => aggregateAssemblyInventory([item, { ...item, unitVolume: "4" }]), /Conflicting unit volumes/);
  assert.throws(() => aggregateAssemblyInventory([{ ...item, quantity: 0xffffffff }, item]), /exceeds u32/);
});

test("storage applies removals before additions and read-before-write makes replay a no-op", async () => {
  const local = snapshot({ inventory: [
    { ownerId: 1, itemId: "8", typeId: 10, quantity: 3, unitVolume: "2" },
    { ownerId: 1, itemId: "9", typeId: 30, quantity: 4, unitVolume: "1" },
  ] });
  const f = fixture([local]);
  f.dynamic.set(id(1100), inventory([{ typeId: 10, quantity: 5, volume: 2 }, { typeId: 20, quantity: 3, volume: 1 }]));
  assert.equal(await f.contents.hasInventoryChanges(local), true);
  await f.contents.syncInventory(local);
  assert.equal(f.executed.length, 1);
  assert.deepEqual(calls(f.executed[0].transaction).map((call) => call.function), ["chain_item_to_game_inventory", "chain_item_to_game_inventory", "game_item_to_chain_inventory"]);
  assert.equal(f.executed[0].ownerId, 1);
  f.dynamic.set(id(1100), inventory([{ typeId: 10, quantity: 3, volume: 2 }, { typeId: 30, quantity: 4, volume: 1 }]));
  assert.equal(await f.contents.hasInventoryChanges(local), false);
  await f.contents.syncInventory(local);
  assert.equal(f.executed.length, 1);
});

test("storage reconciles removed guest inventory through its character capability", async () => {
  const local = snapshot();
  const f = fixture([local]);
  f.chainObjects.get("100").fields.inventory_keys.push(id(2002));
  f.dynamic.set(id(2002), inventory([{ typeId: 10, quantity: 5, volume: 2 }]));
  f.objects.set(id(2002), move(`${packageId}::access::OwnerCap<${packageId}::character::Character>`, { authorized_object_id: id(2) }));
  // The deployed TenantItemId uses item_id, while older checkout fixtures used id.
  f.objects.set(id(2), move(`${packageId}::character::Character`, { key: { fields: { item_id: "2", tenant: "dev" } } }));
  await f.contents.syncInventory(local);
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].ownerId, 2);
  assert.equal(f.borrowed[0].refs[0].kind, "character");
  assert.equal(calls(f.executed[0].transaction)[0].typeArguments[0], `${packageId}::character::Character`);
});

test("offline unchanged inventory succeeds, offline deltas and unknown open items fail explicitly", async () => {
  const local = snapshot({ status: 1 });
  const f = fixture([local]);
  await f.contents.syncInventory(local);
  f.dynamic.set(id(1100), inventory([{ typeId: 10, quantity: 1, volume: 1 }]));
  await assert.rejects(f.contents.syncInventory(local), /must be online/);
  assert.equal(f.executed.length, 0);
  f.dynamic.set(id(1100), inventory());
  f.chainObjects.get("100").fields.inventory_keys.push(id(8888));
  f.dynamic.set(id(8888), inventory([{ typeId: 10, quantity: 1, volume: 1 }]));
  await assert.rejects(f.contents.syncInventory(local), /open inventory/);
});

test("gate linking signs destination-to-source proof and repeats without mutation", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  const b = snapshot({ ...a, itemId: "101", destinationGateId: "100" });
  const f = fixture([a, b]);
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) }, size: "1" } } }));
  f.dynamic.set(String(a.typeId), move("u64", { value: "100" }));
  f.setOnExecute((label) => {
    if (!label.startsWith("gate-link:")) return;
    f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(101)];
    f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [id(100)];
  });
  await f.contents.syncGateLinks([a, b]);
  assert.equal(f.executed.length, 1);
  const tx = f.executed[0].transaction.getData();
  const call = calls(f.executed[0].transaction)[0];
  assert.equal(call.function, "link_gates");
  const proofArgument = call.arguments[7];
  const encoded = Buffer.from((tx.inputs[proofArgument.Input] as any).Pure.bytes, "base64");
  const proof = proofSchema.parse(Uint8Array.from(bcs.vector(bcs.u8()).parse(encoded)));
  assert.equal(proof.message.source_structure_id, id(101));
  assert.equal(proof.message.target_structure_id, id(100));
  assert.deepEqual(proof.message.source_location_hash, new Array(32).fill(101));
  assert.deepEqual(proof.message.target_location_hash, new Array(32).fill(100));
  await f.contents.syncGateLinks([a, b]);
  assert.equal(f.executed.length, 1);
});

test("half-written game gate links are rejected before any on-chain operation", async () => {
  const a = snapshot({ kind: "gate", destinationGateId: "101", gateDistanceMeters: "10", gateMaxDistanceMeters: "100" });
  const f = fixture([a]);
  await assert.rejects(f.contents.syncGateLinks([a]), /nonreciprocal/);
  assert.equal(f.executed.length, 0);
});

test("unlink clears an old reciprocal pair once even when both gates are unlinked locally", async () => {
  const a = snapshot({ kind: "gate", itemId: "100" });
  const b = snapshot({ kind: "gate", itemId: "101" });
  const f = fixture([a, b]);
  f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(101)];
  f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [id(100)];
  f.objects.set(id(101), move(`${packageId}::gate::Gate`, f.chainObjects.get("101").fields));
  f.setOnExecute(() => {
    f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [];
    f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [];
  });
  await f.contents.syncGateLinks([a, b]);
  assert.equal(f.executed.length, 1);
  assert.equal(calls(f.executed[0].transaction)[0].function, "unlink_gates_by_admin");
  assert.equal(f.executed[0].ownerId, undefined);
});

test("unit volume changes replace the stored type and capacity failures submit nothing", async () => {
  const local = snapshot({ inventory: [{ ownerId: 1, itemId: "8", typeId: 10, quantity: 3, unitVolume: "5" }] });
  const f = fixture([local]);
  f.dynamic.set(id(1100), inventory([{ typeId: 10, quantity: 3, volume: 2 }]));
  await f.contents.syncInventory(local);
  const transaction = f.executed[0].transaction;
  const operations = calls(transaction);
  assert.deepEqual(operations.map((call) => call.function), ["chain_item_to_game_inventory", "game_item_to_chain_inventory"]);
  const inputs = transaction.getData().inputs;
  const burnQuantity = operations[0].arguments[5];
  const mintQuantity = operations[1].arguments[7];
  assert.equal(bcs.u32().parse(Buffer.from((inputs[burnQuantity.Input] as any).Pure.bytes, "base64")), 3);
  assert.equal(bcs.u32().parse(Buffer.from((inputs[mintQuantity.Input] as any).Pure.bytes, "base64")), 3);
  const excessive = snapshot({ inventory: [{ ownerId: 1, itemId: "8", typeId: 10, quantity: 201, unitVolume: "5" }] });
  const overflow = fixture([excessive]);
  await assert.rejects(overflow.contents.syncInventory(excessive), /exceeds on-chain capacity/);
  assert.equal(overflow.executed.length, 0);
});

test("storage inventory status reports exact on-chain quantities and limits partitions to the caller", async () => {
  const local = snapshot({ inventory: [
    { ownerId: 1, itemId: "8", typeId: 10, quantity: 3, unitVolume: "2" },
    { ownerId: 2, itemId: "9", typeId: 20, quantity: 4, unitVolume: "1" },
  ] });
  const f = fixture([local]);
  f.dynamic.set(id(1100), inventory([{ typeId: 10, quantity: 2, volume: 2 }]));
  f.chainObjects.get("100").fields.inventory_keys.push(id(2002));
  f.dynamic.set(id(2002), inventory([{ typeId: 20, quantity: 4, volume: 1 }]));
  f.objects.set(id(2002), move(`${packageId}::access::OwnerCap<${packageId}::character::Character>`, { authorized_object_id: id(2) }));
  f.objects.set(id(2), move(`${packageId}::character::Character`, { key: { fields: { item_id: "2", tenant: "dev" } } }));
  const owner = await f.contents.getInventoryStatus(local, 1);
  assert.equal(owner.assemblyId, id(100));
  assert.equal(owner.synchronized, false);
  assert.equal(owner.partitions.length, 1);
  assert.deepEqual(owner.partitions[0], {
    characterId: 1, characterObjectId: id(1), inventoryKey: id(1100), isOwner: true,
    maxCapacity: "1000", usedCapacity: "4", synchronized: false,
    items: [{ itemId: "10010", typeId: "10", quantity: 2, unitVolume: "2" }],
  });
  const visitor = await f.contents.getInventoryStatus(local, 2);
  assert.equal(visitor.synchronized, true);
  assert.equal(visitor.partitions.length, 1);
  assert.equal(visitor.partitions[0].inventoryKey, id(2002));
  assert.equal(visitor.partitions[0].isOwner, false);
  const firstVisit = await f.contents.getInventoryStatus(local, 3);
  assert.equal(firstVisit.partitions[0].inventoryKey, id(2003));
  assert.equal(firstVisit.partitions[0].maxCapacity, "1000");
  assert.deepEqual(firstVisit.partitions[0].items, []);
  assert.equal(firstVisit.synchronized, true);
  assert.equal(f.executed.length, 0);
});

test("inventory changed during RPC reads cannot be reported as synchronized or submitted", async () => {
  const local = snapshot({ inventory: [{ ownerId: 1, itemId: "8", typeId: 10, quantity: 3, unitVolume: "2" }] });
  let current = true;
  const f = fixture([local], () => { if (!current) throw new Error("Inventory snapshot changed"); });
  f.setOnRead(() => { current = false; });
  await assert.rejects(f.contents.syncInventory(local), /Inventory snapshot changed/);
  current = true;
  await assert.rejects(f.contents.getInventoryStatus(local, 1), /Inventory snapshot changed/);
  assert.equal(f.executed.length, 0);
});

test("inventory changes during transaction building are rejected by the executor's final snapshot guard", async () => {
  const local = snapshot({ inventory: [{ ownerId: 2, itemId: "8", typeId: 10, quantity: 3, unitVolume: "2" }] });
  let current = true;
  let checks = 0;
  const f = fixture([local], checked => {
    assert.equal(checked, local);
    checks++;
    if (!current) throw new Error("Inventory snapshot changed before journaling");
  });
  f.setOnExecute(() => { current = false; });
  await assert.rejects(f.contents.syncInventory(local), /before journaling/);
  assert.equal(checks, 3);
  assert.equal(f.borrowed[0].ownerId, 2);
  assert.equal(f.borrowed[0].refs[0].kind, "character");
  assert.equal(f.executed.length, 0);
});

test("inventory status rejects unreadable or inconsistent chain contents instead of assuming an empty inventory", async () => {
  const local = snapshot();
  const f = fixture([local]);
  f.dynamic.set(id(1100), { error: { code: "unavailable" } });
  await assert.rejects(f.contents.getInventoryStatus(local, 1), /Cannot read storage inventory/);
  const malformed = inventory([{ typeId: 10, quantity: 3, volume: 2 }]);
  malformed.data.content.fields.value.fields.used_capacity = "0";
  f.dynamic.set(id(1100), malformed);
  await assert.rejects(f.contents.getInventoryStatus(local, 1), /Inconsistent Sui inventory used capacity/);
});
