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
function fixture(assembly = snapshot(), options: {
  online?: boolean; quantity?: number; applyFuelTransactions?: boolean;
  fuelAuthority?: boolean;
  assertFuelSnapshotCurrent?: (assembly: AssemblySnapshot) => void;
} = {}) {
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
  const efficiencies = new Map<string, number>();
  objects.set(world.fuelConfigId, { content: { dataType: "moveObject", fields: {
    fuel_efficiency: { fields: { id: { id: address(85) } } },
  } } });
  const client: any = {
    getObject: async ({ id }: any) => objects.has(id)
      ? { data: objects.get(id) } : { error: { code: "notExists" } },
    getDynamicFieldObject: async ({ name }: any) => efficiencies.has(name.value)
      ? { data: { content: { dataType: "moveObject", fields: { value: String(efficiencies.get(name.value)) } } } }
      : { error: { code: "dynamicFieldNotFound" } },
  };
  const chain = createSuiAssemblyChain({ client, world, tenant: "dev", deriveId: address,
    fuelAuthority: options.fuelAuthority,
    assertFuelSnapshotCurrent: options.assertFuelSnapshotCurrent,
    execute: async (label, tx, ownerId, _assertSnapshotCurrent, gasPayerOwnerId) => {
      const data = tx.getData();
      executions.push({ label, tx: data, ownerId, gasPayerOwnerId });
      const integer = (argument: any) => Buffer.from((data.inputs[argument.Input] as any).Pure.bytes, "base64").readBigUInt64LE();
      for (const command of data.commands) {
        const call = command.MoveCall;
        if (call?.function === "set_fuel_efficiency") {
          efficiencies.set(String(integer(call.arguments[2])), Number(integer(call.arguments[3])));
        }
        if (!options.applyFuelTransactions || !call) continue;
        if (call.function === "withdraw_fuel") fields.fuel.fields.quantity = String(BigInt(fields.fuel.fields.quantity) - integer(call.arguments[4]));
        if (call.function === "deposit_fuel") fields.fuel.fields.quantity = String(BigInt(fields.fuel.fields.quantity) + integer(call.arguments[5]));
        if (call.function === "offline") {
          if (!options.fuelAuthority) assert.equal(fields.fuel.fields.quantity, "0", "Native offline burn must see an empty tank");
          fields.status.fields.status.variant = "OFFLINE";
        }
      }
    } });
  return { assembly, chain, fields, objects, executions, capId, id, efficiencies };
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
  assert.equal(tx.gasPayerOwnerId, undefined, "owner-signed calls select their own faction gas payer");
  assert.deepEqual(tx.tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "online", "deposit_fuel", "return_owner_cap",
  ]);
});

test("taking a node offline consumes its required hot potato before returning cap", async () => {
  const f = fixture(snapshot(), { online: true });
  await f.chain.syncStatus(f.assembly);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "withdraw_fuel", "offline", "destroy_offline_assemblies", "deposit_fuel", "return_owner_cap",
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

test("Unstable legacy efficiency fallback permits synchronization without changing the server rate", async () => {
  const f = fixture();
  await f.chain.configureFuelEfficiency(77818, 8);
  assert.equal(f.efficiencies.get("77818"), 10);
  await f.chain.configureFuelEfficiency(77818, 8);
  assert.equal(f.executions.length, 1, "Already-configured compatibility value is idempotent");
});

test("unsupported efficiencies are still rejected before submitting a transaction", async () => {
  const f = fixture();
  await assert.rejects(f.chain.configureFuelEfficiency(88335, 8), /cannot be represented/);
  await assert.rejects(f.chain.configureFuelEfficiency(77818, 9), /cannot be represented/);
  assert.equal(f.executions.length, 0);
});

for (const [typeId, hourlyUnits] of [[77818, 15], [88319, 8], [88335, 12]]) {
  test(`mirrors ${hourlyUnits} consumed units per hour for fuel ${typeId} exactly once`, async () => {
    const a = snapshot({ status: 2, fuel: { typeId, quantity: 100 - hourlyUnits, unitVolume: "280000" } });
    const f = fixture(a, { online: true, quantity: 100, applyFuelTransactions: true });
    await f.chain.syncFuel(a);
    assert.equal(f.fields.fuel.fields.quantity, String(100 - hourlyUnits));
    assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
      "borrow_owner_cap", "withdraw_fuel", "return_owner_cap",
    ]);
    await f.chain.syncFuel(a);
    assert.equal(f.executions.length, 1, "Repeated snapshot must not consume fuel twice");
  });
}

test("offline atomically preserves the server remainder without a second elapsed-time charge", async () => {
  const a = snapshot({ fuel: { typeId: 88335, quantity: 88, unitVolume: "280000" } });
  const f = fixture(a, { online: true, quantity: 100, applyFuelTransactions: true });
  await f.chain.syncStatus(a);
  assert.equal(f.fields.fuel.fields.quantity, "88");
  assert.equal(f.fields.status.fields.status.variant, "OFFLINE");
  await f.chain.syncFuel(a);
  await f.chain.syncStatus(a);
  assert.equal(f.executions.length, 1);
});

test("exhaustion empties and offlines the chain without restoring any fuel", async () => {
  const a = snapshot({ fuel: { typeId: 0, quantity: 0, unitVolume: "0" } });
  const f = fixture(a, { online: true, quantity: 3, applyFuelTransactions: true });
  f.fields.fuel.fields.type_id.vec = ["88335"];
  await f.chain.syncStatus(a);
  assert.equal(f.fields.fuel.fields.quantity, "0");
  assert.equal(f.fields.status.fields.status.variant, "OFFLINE");
  assert.equal(f.executions[0].tx.commands.some((c: any) => c.MoveCall?.function === "deposit_fuel"), false);
  await f.chain.syncFuel(a);
  assert.equal(f.executions.length, 1);
});

test("a fuel change during transaction construction prevents a stale replenishment", async () => {
  let checks = 0;
  const f = fixture(snapshot(), { quantity: 88, assertFuelSnapshotCurrent() {
    if (++checks > 1) throw new Error("fuel changed during synchronization");
  } });
  await assert.rejects(f.chain.syncFuel(f.assembly), /fuel changed/);
  assert.equal(f.executions.length, 0);
});

test("authoritative fuel reads the confirmed reserve without clock or efficiency dependencies", async () => {
  const f = fixture(snapshot(), { quantity: 37, fuelAuthority: true });
  f.objects.delete(world.fuelConfigId);
  f.fields.fuel.fields.is_burning = true;
  f.fields.fuel.fields.burn_start_time = "1";
  const observed = await f.chain.readFuelState(f.assembly);
  assert.equal(observed.quantity, 37, "reading an old burn clock must not charge consumption again");
  assert.equal(observed.typeID, f.assembly.fuel.typeId);
  assert.equal(observed.unitVolume, "280000");
  assert.ok(Number.isSafeInteger(observed.observedAtMs));
  assert.equal(f.executions.length, 0);
});

test("authoritative fuel refuses malformed and unsafe on-chain reserves", async () => {
  for (const quantity of ["1.5", "-1", "9007199254740992", "18446744073709551616"]) {
    const f = fixture(snapshot(), { fuelAuthority: true });
    f.fields.fuel.fields.quantity = quantity;
    await assert.rejects(f.chain.readFuelState(f.assembly), /valid u64|local integer range/);
  }
  const f = fixture(snapshot(), { fuelAuthority: true });
  f.fields.fuel.fields.type_id.vec = [];
  await assert.rejects(f.chain.readFuelState(f.assembly), /invalid chain fuel/);
  f.fields.fuel.fields.quantity = "0";
  f.fields.fuel.fields.unit_volume.vec = [];
  const empty = await f.chain.readFuelState(f.assembly);
  assert.equal(empty.quantity, 0);
  assert.equal(empty.typeID, 0);
});

test("chain fuel differences do not create transfers without an explicit intent", async () => {
  const f = fixture(snapshot(), { quantity: 37, fuelAuthority: true });
  await f.chain.syncFuel(f.assembly);
  assert.equal(f.fields.fuel.fields.quantity, "37");
  assert.equal(f.executions.length, 0);
});

function fuelTransfer(quantityDelta: number, typeID = 78499) {
  return { ...snapshot(), fuelIntent: { id: "transfer-test", typeID, quantityDelta } };
}

test("explicit deposits preserve outside chain changes and transfer only the requested delta", async () => {
  const assembly = fuelTransfer(10);
  const f = fixture(assembly, { quantity: 37, fuelAuthority: true, applyFuelTransactions: true });
  await f.chain.syncFuel(assembly);
  assert.equal(f.fields.fuel.fields.quantity, "47");
  assert.equal(f.executions[0].label, `assembly:${assembly.itemId}:fuel:transfer-test`);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "deposit_fuel", "return_owner_cap",
  ]);
});

test("explicit withdrawals preserve outside chain changes even when the local reserve is empty", async () => {
  const assembly = { ...fuelTransfer(-10), fuel: { typeId: 0, quantity: 0, unitVolume: "0" } };
  const f = fixture(assembly, { quantity: 37, fuelAuthority: true, applyFuelTransactions: true });
  f.fields.fuel.fields.type_id.vec = ["78499"];
  f.fields.fuel.fields.unit_volume.vec = ["280000"];
  await f.chain.syncFuel(assembly);
  assert.equal(f.fields.fuel.fields.quantity, "27");
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "withdraw_fuel", "return_owner_cap",
  ]);
});

test("fuel intents reject insufficient reserves, mismatched types, and chain capacity overflow", async () => {
  const withdrawing = fuelTransfer(-40);
  const f = fixture(withdrawing, { quantity: 37, fuelAuthority: true });
  await assert.rejects(f.chain.syncFuel(withdrawing), /insufficient chain fuel/);
  await assert.rejects(f.chain.syncFuel(fuelTransfer(10, 88335)), /chain fuel type differs/);
  f.fields.fuel.fields.quantity = "17857";
  await assert.rejects(f.chain.syncFuel(fuelTransfer(1)), /exceeds chain capacity/);
  assert.equal(f.executions.length, 0);
});

test("chain-authoritative startup consumes native fuel without replenishing the startup unit", async () => {
  const f = fixture(snapshot({ status: 2 }), { quantity: 37, fuelAuthority: true });
  await f.chain.syncStatus(f.assembly);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "online", "return_owner_cap",
  ]);
  const empty = fixture(snapshot({ status: 2 }), { quantity: 0, fuelAuthority: true });
  await assert.rejects(empty.chain.syncStatus(empty.assembly), /no available chain fuel/);
  assert.equal(empty.executions.length, 0);
});

test("chain-authoritative offline lets the contract settle its own reserve", async () => {
  const f = fixture(snapshot(), { online: true, quantity: 37, fuelAuthority: true });
  await f.chain.syncStatus(f.assembly);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "offline", "destroy_offline_assemblies", "return_owner_cap",
  ]);
});

test("authoritative fuel preserves a configured chain efficiency and only fills missing defaults", async () => {
  const f = fixture(snapshot(), { fuelAuthority: true });
  f.efficiencies.set("77818", 25);
  await f.chain.configureFuelEfficiency(77818, 8);
  assert.equal(f.efficiencies.get("77818"), 25);
  assert.equal(f.executions.length, 0);
  await f.chain.configureFuelEfficiency(88335, 10);
  assert.equal(f.efficiencies.get("88335"), 10);
  assert.equal(f.executions.length, 1);
  f.efficiencies.set("88335", 0);
  await assert.rejects(f.chain.configureFuelEfficiency(88335, 10), /chain efficiency is outside the valid range/);
  assert.equal(f.executions.length, 1, "an invalid chain observation must not silently replace the rate");
});

test("retirement drains only the freshly observed reserve using an explicit intent", async () => {
  const f = fixture(snapshot(), { quantity: 37, fuelAuthority: true, applyFuelTransactions: true });
  const fuel = await f.chain.readFuelState(f.assembly);
  await f.chain.syncFuel({ ...f.assembly, fuelIntent: { id: "retire", typeID: fuel.typeID, quantityDelta: -fuel.quantity } });
  assert.equal(f.fields.fuel.fields.quantity, "0");
  assert.equal(f.executions[0].label, `assembly:${f.assembly.itemId}:fuel:retire`);
  assert.deepEqual(f.executions[0].tx.commands.map((c: any) => c.MoveCall?.function), [
    "borrow_owner_cap", "withdraw_fuel", "return_owner_cap",
  ]);
});
