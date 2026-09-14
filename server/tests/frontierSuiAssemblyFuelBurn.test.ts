import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assemblyLocationHash, createSuiAssemblyChain, type SuiAssemblyWorld } from "../src/services/frontier/suiAssemblyChain";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";

const address = (id: string | number | bigint) => normalizeSuiAddress(`0x${BigInt(id).toString(16)}`);
const world: SuiAssemblyWorld = {
  packageId: address(80), objectRegistryId: address(81), adminAclId: address(82),
  energyConfigId: address(83), fuelConfigId: address(84),
};

function fixture() {
  const assembly: AssemblySnapshot = {
    itemId: "998840000136", typeId: 88092, ownerId: 140001, name: "Network Node",
    kind: "network_node", status: 2, solarSystemId: 30002479, position: { x: 0, y: 0, z: 0 },
    networkNodeId: null, destinationGateId: null, gateDistanceMeters: null, gateMaxDistanceMeters: null,
    fuel: { typeId: 88319, quantity: 499, unitVolume: "280000" }, fuelCapacity: "1000000000",
    burnRateMs: "3000000", maxEnergy: "1000", storageCapacity: "0", inventory: [],
  };
  const fuel: any = {
    max_capacity: assembly.fuelCapacity, burn_rate_in_ms: assembly.burnRateMs,
    quantity: "499", type_id: { vec: ["88319"] }, unit_volume: { vec: ["280000"] },
    is_burning: true, burn_start_time: "1000000", previous_cycle_elapsed_time: "0", last_updated: "1000000",
  };
  const fields: any = {
    key: { fields: { item_id: assembly.itemId, tenant: "dev" } }, type_id: String(assembly.typeId), owner_cap_id: address(70),
    status: { fields: { status: { variant: "ONLINE" } } }, location: { fields: { location_hash: assemblyLocationHash(assembly) } },
    fuel: { fields: fuel }, energy_source: { fields: { max_energy_production: "1000", current_energy_production: "1000", total_reserved_energy: "400" } },
    connected_assembly_ids: [],
  };
  const clock = { timestamp_ms: "1450000" };
  const efficiency = { name: "88319", value: "15" };
  const config = { fuel_efficiency: { fields: { id: { id: address(85) } } } };
  const objects = new Map<string, any>([
    [address(assembly.itemId), { objectId: address(assembly.itemId), type: `${world.packageId}::network_node::NetworkNode`, content: { dataType: "moveObject", fields } }],
    [address(70), { objectId: address(70), owner: { AddressOwner: address(assembly.ownerId) } }],
    [world.fuelConfigId, { content: { dataType: "moveObject", fields: config } }],
    ["0x6", { content: { dataType: "moveObject", fields: clock } }],
  ]);
  const executions: any[] = [];
  const requests: any[] = [];
  const childFields: any[] = [];
  const chain = createSuiAssemblyChain({ world, tenant: "dev", deriveId: address, fuelAuthority: true,
    client: {
      async getObject(request: any) {
        requests.push(request);
        return objects.has(request.id) ? { data: objects.get(request.id) } : { error: { code: "notExists" } };
      },
      async getDynamicFieldObject(request: any) {
        requests.push(request);
        return efficiency.value === undefined ? { error: { code: "dynamicFieldNotFound" } }
          : { data: { content: { dataType: "moveObject", fields: efficiency } } };
      },
    } as any,
    async execute(label, tx, ownerId, guard) {
      guard?.();
      executions.push({ label, data: tx.getData(), ownerId });
      // Model the deployed Move rules, including its reserved active fuel unit.
      const now = BigInt(clock.timestamp_ms);
      const cycle = BigInt(fuel.burn_rate_in_ms) * BigInt(efficiency.value) / 100n;
      const elapsed = (now > BigInt(fuel.burn_start_time) ? now - BigInt(fuel.burn_start_time) : 0n) + BigInt(fuel.previous_cycle_elapsed_time);
      const units = elapsed / cycle;
      if (BigInt(fuel.quantity) >= units) {
        fuel.quantity = String(BigInt(fuel.quantity) - units);
        fuel.previous_cycle_elapsed_time = "0";
        fuel.burn_start_time = String(now - elapsed % cycle);
        fuel.last_updated = String(now);
      } else {
        fuel.is_burning = false;
        fuel.burn_start_time = "0";
        fuel.previous_cycle_elapsed_time = "0";
        fields.status.fields.status.variant = "OFFLINE";
        fields.energy_source.fields.current_energy_production = "0";
        fields.energy_source.fields.total_reserved_energy = "0";
        for (const child of childFields) child.status.fields.status.variant = "OFFLINE";
      }
    },
  });
  function addChild(kind: "assembly" | "storage_unit" | "gate" | "turret", id = 100 + childFields.length) {
    const names = { assembly: "Assembly", storage_unit: "StorageUnit", gate: "Gate", turret: "Turret" };
    const child: any = { owner_cap_id: address(id + 100), energy_source_id: { vec: [address(assembly.itemId)] },
      status: { fields: { status: { variant: "ONLINE" } } }, location: { fields: { location_hash: [1, 2, 3] } } };
    fields.connected_assembly_ids.push(address(id));
    childFields.push(child);
    objects.set(address(id), { objectId: address(id), type: `${world.packageId}::${kind}::${names[kind]}`, content: { dataType: "moveObject", fields: child } });
    return child;
  }
  return { assembly, chain, fuel, fields, objects, clock, efficiency, config, executions, requests, addChild, childFields };
}

test("settles the elapsed D2 unit from 499 to 498 once through the admin journal", async () => {
  const f = fixture();
  assert.equal(await f.chain.updateFuel(f.assembly), true);
  assert.equal((await f.chain.readFuelState(f.assembly)).quantity, 498);
  assert.equal(await f.chain.updateFuel(f.assembly), false);
  assert.equal(f.executions.length, 1);
  const execution = f.executions[0];
  assert.equal(execution.label, `assembly:${f.assembly.itemId}:fuel-burn`);
  assert.equal(execution.ownerId, undefined, "Settlement is admin sponsored and does not need an owner signature");
  assert.deepEqual(execution.data.commands.map((c: any) => c.MoveCall.function), ["update_fuel", "destroy_offline_assemblies"]);
  const call = execution.data.commands[0].MoveCall;
  assert.equal(call.arguments.length, 4, "TxContext is implicit");
  assert.deepEqual(call.arguments.map((arg: any) => execution.data.inputs[arg.Input].UnresolvedObject.objectId), [
    address(f.assembly.itemId), world.fuelConfigId, world.adminAclId, address(6),
  ]);
});

test("uses the deployed efficiency and chain Clock instead of local defaults", async () => {
  const f = fixture();
  f.efficiency.value = "20";
  assert.equal(await f.chain.updateFuel(f.assembly), false, "450 seconds is short of this deployed 600-second cycle");
  f.clock.timestamp_ms = "1600000";
  assert.equal(await f.chain.updateFuel(f.assembly), true);
  assert.equal(f.fuel.quantity, "498");
  assert.ok(f.requests.some(request => request.parentId === address(85) && request.name.value === "88319"));
});

test("accounts for the interrupted cycle and preserves exact u64 clock arithmetic", async () => {
  const f = fixture();
  f.fuel.burn_start_time = "9007199254740993";
  f.fuel.last_updated = f.fuel.burn_start_time;
  f.fuel.previous_cycle_elapsed_time = "449999";
  f.clock.timestamp_ms = "9007199254740994";
  assert.equal(await f.chain.updateFuel(f.assembly), true);
  assert.equal(f.fuel.quantity, "498");
  assert.equal(f.fuel.burn_start_time, "9007199254740994");
});

test("offline, paused, unanchored and incomplete burn cycles make no submission", async () => {
  for (const state of ["offline", "paused", "unanchored", "incomplete", "zero-start", "same-clock", "future-clock"]) {
    const f = fixture();
    if (state === "offline") f.fields.status.fields.status.variant = "OFFLINE";
    if (state === "paused") f.fuel.is_burning = false;
    if (state === "unanchored") f.objects.delete(address(f.assembly.itemId));
    if (state === "incomplete") f.clock.timestamp_ms = "1449999";
    if (state === "zero-start") f.fuel.burn_start_time = "0";
    if (state === "same-clock") f.fuel.last_updated = f.clock.timestamp_ms;
    if (state === "future-clock") f.clock.timestamp_ms = "999999";
    assert.equal(await f.chain.updateFuel(f.assembly), false, state);
    assert.equal(f.executions.length, 0, state);
  }
});

test("passes all four connected kinds through the hot potato without offlining a fueled grid", async () => {
  const f = fixture();
  for (const kind of ["assembly", "storage_unit", "gate", "turret"] as const) f.addChild(kind);
  assert.equal(await f.chain.updateFuel(f.assembly), true);
  assert.deepEqual(f.executions[0].data.commands.map((c: any) => c.MoveCall.function), [
    "update_fuel", "offline_connected_assembly", "offline_connected_storage_unit", "offline_connected_gate", "offline_connected_turret", "destroy_offline_assemblies",
  ]);
  assert.ok(f.childFields.every(child => child.status.fields.status.variant === "ONLINE"));
});

test("expiration of the final active unit offlines its node and consumers atomically", async () => {
  const f = fixture();
  f.fuel.quantity = "0";
  f.addChild("storage_unit");
  f.addChild("gate");
  assert.equal(await f.chain.updateFuel(f.assembly), true);
  assert.equal(f.fuel.quantity, "0");
  assert.equal(f.fuel.is_burning, false);
  assert.equal(f.fields.status.fields.status.variant, "OFFLINE");
  assert.ok(f.childFields.every(child => child.status.fields.status.variant === "OFFLINE"));
  assert.equal(f.fields.energy_source.fields.total_reserved_energy, "0");
  assert.equal(await f.chain.updateFuel(f.assembly), false);
});

test("missing clock, missing efficiency and invalid on-chain timing block settlement", async () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => f.objects.delete("0x6"), f => f.objects.delete(world.fuelConfigId), f => { f.efficiency.value = undefined; },
    f => { f.config.fuel_efficiency.fields.id = undefined; }, f => { f.efficiency.value = "0"; },
    f => { f.efficiency.value = "101"; }, f => { f.efficiency.name = "88335"; },
    f => { f.fuel.is_burning = "true"; }, f => { f.clock.timestamp_ms = "18446744073709551616"; },
    f => { f.fuel.previous_cycle_elapsed_time = "-1"; }, f => { f.fuel.last_updated = undefined; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(f.chain.updateFuel(f.assembly));
    assert.equal(f.executions.length, 0);
    assert.equal(f.fuel.quantity, "499");
  }
});

test("mismatched node identity and invalid child bindings fail before submission", async () => {
  const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.fields.key.fields.item_id = "1"; },
    f => { f.objects.get(address(70)).owner.AddressOwner = address(999); },
    f => { f.addChild("gate").energy_source_id.vec = [address(999)]; },
    f => { f.fields.connected_assembly_ids.push(address(999)); },
    f => { f.addChild("gate"); f.fields.connected_assembly_ids.push(f.fields.connected_assembly_ids[0]); },
    f => { f.fields.connected_assembly_ids = null; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(f.chain.updateFuel(f.assembly));
    assert.equal(f.executions.length, 0);
  }
});

test("rechecks the fresh caller snapshot immediately before the executor journals", async () => {
  const f = fixture();
  let checks = 0;
  await assert.rejects(f.chain.updateFuel(f.assembly, () => {
    if (++checks === 3) throw new Error("Assembly changed during build");
  }), /changed during build/);
  assert.equal(checks, 3);
  assert.equal(f.executions.length, 0);
  assert.equal(f.fuel.quantity, "499");
});
