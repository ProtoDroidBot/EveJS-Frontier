import assert = require("node:assert/strict");
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID } from "@mysten/sui/utils";
import {
  aggregateAssemblyInventory,
  createAssemblyLocationProof,
  createSuiAssemblyContents,
} from "../src/services/frontier/suiAssemblyContents";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";

const id = (value: number | string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const packageId = id(900);
const catapultPackageId = id(905);
const catapultRegistryId = id(906);
const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(17));
const world = {
  packageId,
  adminAclId: id(901),
  gateConfigId: id(902),
  serverAddressRegistryId: id(903),
  objectRegistryId: id(904),
  catapultPackageId,
  catapultTypeOrigin: catapultPackageId,
  catapultRegistryId,
};
const catapultKey = bcs.struct("CatapultKey", { gate_id: bcs.Address });
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
    destinationSolarSystemId: null, isCatapult: false,
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

function fixture(assemblies: AssemblySnapshot[] = [snapshot()], assertInventorySnapshotCurrent?: (snapshot: AssemblySnapshot) => void,
  assertGateSnapshotCurrent?: (snapshot: AssemblySnapshot) => void) {
  const objects = new Map<string, any>();
  const dynamic = new Map<string, any>();
  const chainObjects = new Map<string, any>();
  const executed: Array<{ label: string; transaction: Transaction; ownerId: number | undefined;
    gasPayerOwnerId: number | undefined }> = [];
  const borrowed: Array<{ ownerId: number; refs: any[] }> = [];
  let onRead: () => void = () => {};
  for (const assembly of assemblies) {
    const capId = id(String(BigInt(assembly.itemId) + 1000n));
    chainObjects.set(assembly.itemId, {
      id: id(assembly.itemId), kind: assembly.kind, ownerCapId: capId, online: assembly.status === 2,
      networkNodeId: id(50), locationHash: new Array(32).fill(Number(assembly.itemId) % 255),
      fields: { type_id: String(assembly.typeId), inventory_keys: [capId], linked_gate_id: { fields: { vec: [] } } },
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
    client, chain, world, serverSigner: signer, now: () => 123_000, assertInventorySnapshotCurrent, assertGateSnapshotCurrent,
    getCharacter: async (ownerId) => ({ id: id(ownerId), address: id(ownerId + 500), ownerCapId: id(ownerId + 2000) }),
    execute: async (label, transaction, ownerId, assertSnapshotCurrent, gasPayerOwnerId) => {
      onExecute(label);
      assertSnapshotCurrent?.();
      executed.push({ label, transaction, ownerId, gasPayerOwnerId });
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

test("gate linking signs the exact source-to-destination pair and repeats without mutation", async () => {
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
  assert.equal(proof.message.source_structure_id, id(100));
  assert.equal(proof.message.target_structure_id, id(101));
  assert.deepEqual(proof.message.source_location_hash, new Array(32).fill(100));
  assert.deepEqual(proof.message.target_location_hash, new Array(32).fill(101));
  f.dynamic.set(String(a.typeId), move("u64", { value: "200" }));
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

test("Smart Catapult sync creates, confirms, and clears a one-way solar-system route", async () => {
  const catapult = snapshot({
    kind: "gate", itemId: "100", typeId: 95627, status: 1, isCatapult: true,
    destinationSolarSystemId: 3002, gateDistanceMeters: "80", gateMaxDistanceMeters: "100",
  });
  const f = fixture([catapult]);
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, {
    max_distance_by_type: { fields: { id: { id: id(999) }, size: "1" } },
  }));
  f.dynamic.set(String(catapult.typeId), move("u64", { value: "100" }));
  await f.contents.syncGateLinks([catapult]);
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].label, "catapult-route:100:3002");
  assert.equal(f.executed[0].gasPayerOwnerId, catapult.ownerId);
  assert.equal(calls(f.executed[0].transaction)[0].function, "create");
  assert.equal(calls(f.executed[0].transaction)[0].package, catapultPackageId);

  const sidecarId = deriveObjectID(
    world.catapultRegistryId,
    `${catapultPackageId}::catapult::CatapultKey`,
    catapultKey.serialize({ gate_id: id(100) }).toBytes(),
  );
  f.objects.set(sidecarId, move(`${catapultPackageId}::catapult::Catapult`, {
    gate_id: id(100), gate_key: { fields: { item_id: "100", tenant: "dev" } },
    type_id: "95627", source_solar_system_id: "3001",
    destination_solar_system_id: { fields: { vec: ["3002"] } },
    distance: "80", revision: "1", updated_at_ms: "123000",
  }));
  await f.contents.syncGateLinks([catapult]);
  assert.equal(f.executed.length, 1);
  const status = await f.contents.getGateStatus(catapult);
  assert.equal(status.destinationSolarSystemId, "3002");
  assert.equal(status.synchronized, true);

  const cleared = snapshot({ ...catapult, destinationSolarSystemId: null, gateDistanceMeters: null });
  await f.contents.syncGateLinks([cleared]);
  assert.equal(f.executed.length, 2);
  assert.equal(f.executed[1].label, "catapult-route:100:0");
  assert.equal(f.executed[1].gasPayerOwnerId, catapult.ownerId);
  assert.equal(calls(f.executed[1].transaction)[0].function, "sync_destination");
});

test("a new selected partner replaces the stale reciprocal chain pair before linking", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "102", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  const b = snapshot({ kind: "gate", itemId: "101" });
  const c = snapshot({ ...a, itemId: "102", destinationGateId: "100" });
  const f = fixture([a, b, c]);
  f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(101)];
  f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [id(100)];
  f.objects.set(id(101), move(`${packageId}::gate::Gate`, f.chainObjects.get("101").fields));
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  f.dynamic.set(String(a.typeId), move("u64", { value: "100" }));
  f.setOnExecute(label => {
    if (label.startsWith("gate-unlink:")) {
      f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [];
      f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [];
    } else if (label.startsWith("gate-link:")) {
      f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(102)];
      f.chainObjects.get("102").fields.linked_gate_id.fields.vec = [id(100)];
    }
  });
  await f.contents.syncGateLinks([a, b, c]);
  assert.deepEqual(f.executed.map(entry => entry.label), ["gate-unlink:100", "gate-link:100:102"]);
  assert.equal(f.executed[0].gasPayerOwnerId, a.ownerId);
  assert.equal((await f.contents.getGateStatus(a, c)).synchronized, true);
  assert.equal((await f.contents.getGateStatus(c, a)).synchronized, true);
  assert.deepEqual(f.chainObjects.get("101").fields.linked_gate_id.fields.vec, []);
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

test("gate linking configures differing chain ranges from the client and accepts its exact boundary", async () => {
  for (const maximum of ["80", "200"]) {
    const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "100", gateMaxDistanceMeters: "100" });
    const b = snapshot({ ...a, itemId: "101", destinationGateId: "100" });
    const f = fixture([a, b]);
    f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
    f.dynamic.set(String(a.typeId), move("u64", { value: maximum }));
    await f.contents.syncGateLinks([a, b]);
    assert.deepEqual(f.executed.map(entry => entry.label), ["gate-range:44", "gate-link:100:101"]);
    const range = calls(f.executed[0].transaction)[0];
    const input = f.executed[0].transaction.getData().inputs[range.arguments[3].Input] as any;
    assert.equal(bcs.u64().parse(Buffer.from(input.Pure.bytes, "base64")), "100");
  }
});

test("an out-of-range client link preserves the previous pair before any mutation", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "102", gateDistanceMeters: "101", gateMaxDistanceMeters: "100" });
  const b = snapshot({ kind: "gate", itemId: "101" });
  const c = snapshot({ ...a, itemId: "102", destinationGateId: "100" });
  const f = fixture([a, b, c]);
  f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(101)];
  f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [id(100)];
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  f.dynamic.set(String(a.typeId), move("u64", { value: "79" }));
  await assert.rejects(f.contents.syncGateLinks([a, b, c]), /local link range/);
  assert.equal(f.executed.length, 0);
  assert.deepEqual(f.chainObjects.get("100").fields.linked_gate_id.fields.vec, [id(101)]);
});

test("a missing chain gate type range is initialized from its authored value only", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  const b = snapshot({ ...a, itemId: "101", destinationGateId: "100" });
  const f = fixture([a, b]);
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  await f.contents.syncGateLinks([a, b]);
  assert.deepEqual(f.executed.map(entry => entry.label), ["gate-range:44", "gate-link:100:101"]);
  const range = calls(f.executed[0].transaction)[0];
  const input = f.executed[0].transaction.getData().inputs[range.arguments[3].Input] as any;
  assert.equal(bcs.u64().parse(Buffer.from(input.Pure.bytes, "base64")), "100");
});

test("gate status requires a reciprocal chain pair while retaining independent client and chain ranges", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  const b = snapshot({ ...a, itemId: "101", destinationGateId: "100" });
  const f = fixture([a, b]);
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  f.dynamic.set(String(a.typeId), move("u64", { value: "200" }));
  f.chainObjects.get("100").fields.linked_gate_id.fields.vec = [id(101)];
  const incomplete = await f.contents.getGateStatus(a, b);
  assert.equal(incomplete.synchronized, false);
  assert.equal(incomplete.reciprocal, false);
  f.chainObjects.get("101").fields.linked_gate_id.fields.vec = [id(100)];
  const confirmed = await f.contents.getGateStatus(a, b);
  assert.equal(confirmed.synchronized, true);
  assert.equal(confirmed.maxDistanceMeters, "200");
  assert.equal(confirmed.distanceMeters, "80");
  assert.equal(confirmed.linkedGateObjectID, id(101));
  f.chainObjects.get("101").fields.type_id = "45";
  assert.equal((await f.contents.getGateStatus(a, b)).synchronized, false);
  assert.equal(f.executed.length, 0);
});

test("gate linking rejects different types, owners and local out-of-range pairs before RPC mutation", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  for (const [overrides, message] of [
    [{ typeId: 45 }, /incompatible owner or type/],
    [{ ownerId: 2 }, /incompatible owner or type/],
    [{ gateMaxDistanceMeters: "79" }, /local link range/],
    [{ gateDistanceMeters: "79" }, /inconsistent reciprocal distances/],
  ] as const) {
    const b = snapshot({ ...a, itemId: "101", destinationGateId: "100", ...overrides });
    const f = fixture([a, b]);
    await assert.rejects(f.contents.syncGateLinks([a, b]), message);
    assert.equal(f.executed.length, 0);
  }
});

test("gate status does not report an unanchored gate as synchronized", async () => {
  const a = snapshot({ kind: "gate", itemId: "100" });
  const f = fixture([a]);
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  f.chainObjects.delete(a.itemId);
  assert.deepEqual(await f.contents.getGateStatus(a), {
    gateObjectID: id(100), linkedGateObjectID: null, online: false, reciprocal: true, synchronized: false,
  });
});

test("gate snapshot guards reject stale reads and changes immediately before submission", async () => {
  const a = snapshot({ kind: "gate", itemId: "100", destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" });
  const b = snapshot({ ...a, itemId: "101", destinationGateId: "100" });
  let current = true;
  const f = fixture([a, b], undefined, () => { if (!current) throw new Error("Gate snapshot changed"); });
  f.objects.set(world.gateConfigId, move(`${packageId}::gate::GateConfig`, { max_distance_by_type: { fields: { id: { id: id(999) } } } }));
  f.dynamic.set(String(a.typeId), move("u64", { value: "100" }));
  f.setOnRead(() => { current = false; });
  await assert.rejects(f.contents.syncGateLinks([a, b]), /Gate snapshot changed/);
  current = true;
  await assert.rejects(f.contents.getGateStatus(a, b), /Gate snapshot changed/);
  current = true;
  f.setOnRead(() => {});
  f.setOnExecute(() => { current = false; });
  await assert.rejects(f.contents.syncGateLinks([a, b]), /Gate snapshot changed/);
  assert.equal(f.executed.length, 0);
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
