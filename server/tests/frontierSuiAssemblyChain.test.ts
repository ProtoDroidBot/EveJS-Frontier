import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  assemblyLocationHash, createSuiAssemblyChain, type SuiAssemblyWorld,
} from "../src/services/frontier/suiAssemblyChain";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";

const address = (n: string | number) => normalizeSuiAddress(`0x${BigInt(n).toString(16)}`);
const world: SuiAssemblyWorld = {
  packageId: address(80), objectRegistryId: address(81), adminAclId: address(82),
  energyConfigId: address(83), fuelConfigId: address(84),
};
function snapshot(overrides: Partial<AssemblySnapshot> = {}): AssemblySnapshot {
  return {
    itemId: "5000000001", typeId: 88092, ownerId: 140001, name: "Home node",
    kind: "network_node", status: 1, solarSystemId: 30002479,
    position: { x: 0, y: -125, z: 20.5 }, networkNodeId: null, destinationGateId: null,
    gateDistanceMeters: null, gateMaxDistanceMeters: null,
    fuel: { typeId: 78499, quantity: 100, unitVolume: "280000" },
    fuelCapacity: "5000000000", burnRateMs: "1000", maxEnergy: "1000", storageCapacity: "0", inventory: [],
    ...overrides,
  };
}
function fixture(assembly = snapshot(), options: { online?: boolean; quantity?: number } = {}) {
  const id = address(assembly.itemId);
  const capId = address(70);
  const characterId = address(assembly.ownerId);
  const fields: any = {
    key: { fields: { item_id: assembly.itemId, tenant: "dev" } }, type_id: String(assembly.typeId),
    owner_cap_id: capId, status: { fields: { status: { variant: options.online ? "ONLINE" : "OFFLINE" } } },
    location: { fields: { location_hash: assemblyLocationHash(assembly) } },
    energy_source_id: { vec: assembly.networkNodeId ? [address(assembly.networkNodeId)] : [] },
    metadata: { vec: [{ fields: { name: assembly.name } }] },
    fuel: { fields: { max_capacity: assembly.fuelCapacity, burn_rate_in_ms: assembly.burnRateMs,
      quantity: String(options.quantity ?? assembly.fuel.quantity), type_id: { vec: [String(assembly.fuel.typeId)] },
      unit_volume: { vec: [assembly.fuel.unitVolume] } } },
    energy_source: { fields: { max_energy_production: assembly.maxEnergy } },
    connected_assembly_ids: [],
  };
  const objects = new Map<string, any>([
    [id, { objectId: id, type: `${world.packageId}::network_node::NetworkNode`, version: "1", digest: "digest",
      content: { dataType: "moveObject", fields } }],
    [capId, { objectId: capId, version: "1", digest: "digest", owner: { AddressOwner: characterId },
      content: { dataType: "moveObject", fields: { authorized_object_id: id } } }],
  ]);
  const executions: any[] = [];
  const client: any = { getObject: async ({ id }: any) => objects.has(id)
    ? { data: objects.get(id) } : { error: { code: "notExists" } } };
  const chain = createSuiAssemblyChain({ client, world, tenant: "dev", deriveId: address,
    execute: async (label, tx, ownerId) => { executions.push({ label, tx: tx.getData(), ownerId }); } });
  return { assembly, chain, fields, objects, executions, capId, id };
}

test("assembly IDs preserve full u64 values beyond character ID range", () => {
  const chain = createSuiAssemblyChain({ client: {} as any, world, tenant: "dev", execute: async () => {} });
  assert.notEqual(chain.deriveId("4294967296"), chain.deriveId("0"));
  assert.notEqual(chain.deriveId("9007199254740992"), chain.deriveId("9007199254740993"));
});

test("matching assembly, name, fuel and status require no transactions", async () => {
  const f = fixture();
  await f.chain.ensureAssembly(f.assembly);
  await f.chain.syncFuel(f.assembly);
  await f.chain.syncStatus(f.assembly);
  assert.equal(f.executions.length, 0);
});

test("assembly keys also support the checkout's renamed id field", async () => {
  const f = fixture();
  f.fields.key.fields.id = f.fields.key.fields.item_id;
  delete f.fields.key.fields.item_id;
  await f.chain.readAssembly(f.assembly);
  assert.equal(f.executions.length, 0);
});

test("existing location or owner mismatches stop before any mutation", async () => {
  const f = fixture();
  await assert.rejects(f.chain.ensureAssembly({ ...f.assembly, position: { x: 99, y: 0, z: 0 } }), /location differs/);
  f.objects.get(f.capId).owner.AddressOwner = address(999);
  await assert.rejects(f.chain.syncFuel(f.assembly), /chain owner differs/);
  assert.equal(f.executions.length, 0);
});

test("online node without local fuel is rejected without fabricating fuel", async () => {
  const f = fixture(snapshot({ status: 2, fuel: { typeId: 0, quantity: 0, unitVolume: "0" } }));
  await assert.rejects(f.chain.syncStatus(f.assembly), /without available fuel/);
  assert.equal(f.executions.length, 0);
});

test("bringing node online restores the initial consumed fuel within its cap transaction", async () => {
  const f = fixture(snapshot({ status: 2 }));
  await f.chain.syncStatus(f.assembly);
  assert.equal(f.executions.length, 1);
  const tx = f.executions[0];
  assert.equal(tx.ownerId, f.assembly.ownerId);
  assert.deepEqual(tx.tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "online", "deposit_fuel", "return_owner_cap",
  ]);
});

test("taking a node offline consumes its required hot potato before returning cap", async () => {
  const f = fixture(snapshot(), { online: true });
  await f.chain.syncStatus(f.assembly);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "offline", "destroy_offline_assemblies", "return_owner_cap",
  ]);
});

test("removal refuses an offline node with fuel and accepts an already absent mirror", async () => {
  const f = fixture();
  await assert.rejects(f.chain.removeAssembly(f.assembly), /still contains fuel/);
  f.objects.delete(f.id);
  await f.chain.removeAssembly(f.assembly);
  assert.equal(f.executions.length, 0);
});

test("fuel reconciliation deposits only the difference and returns the capability", async () => {
  const f = fixture(snapshot(), { quantity: 98 });
  await f.chain.syncFuel(f.assembly);
  assert.equal(f.executions.length, 1);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "deposit_fuel", "return_owner_cap",
  ]);
  const deposit = f.executions[0].tx.commands[1].MoveCall;
  const quantityInput = f.executions[0].tx.inputs[deposit.arguments[5].Input];
  assert.equal(Buffer.from(quantityInput.Pure.bytes, "base64").readBigUInt64LE(), 2n);
});

test("failed fuel synchronization cannot be followed by an online transition", async () => {
  const f = fixture(snapshot({ status: 2 }), { quantity: 98 });
  await assert.rejects(f.chain.syncStatus(f.assembly), /fuel must be synchronized/);
  assert.equal(f.executions.length, 0);
});

test("unrepresentable local fuel efficiency is rejected before submitting a transaction", async () => {
  const f = fixture();
  await assert.rejects(f.chain.configureFuelEfficiency(77818, 8), /cannot be represented/);
  assert.equal(f.executions.length, 0);
});
