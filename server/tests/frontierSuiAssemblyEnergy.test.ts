import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { assemblyLocationHash, createSuiAssemblyChain } from "../src/services/frontier/suiAssemblyChain";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";
import { createAssemblySyncWorker, createSuiAssemblyEnergyMutationRunner, runSuiAssemblyEnergyMutation } from "../src/services/frontier/suiAssemblySync";

function fixture(options: { invalidValue?: string; missing?: boolean; repeatedCursor?: boolean; size?: string } = {}) {
  let executions = 0;
  const pages: any[] = [];
  const client: any = {
    async getObject() {
      return { data: { content: { dataType: "moveObject", fields: {
        assembly_energy: { fields: { id: { id: "0x99" }, size: options.size ?? "2" } },
      } } } };
    },
    async getDynamicFields(request: any) {
      pages.push(request);
      return { data: [{ name: { type: "u64", value: request.cursor ? "77917" : "90184" } }],
        hasNextPage: !request.cursor || !!options.repeatedCursor, nextCursor: "cursor-1" };
    },
    async getDynamicFieldObject({ name }: any) {
      if (options.missing) return { error: { code: "dynamicFieldNotFound" } };
      return { data: { content: { dataType: "moveObject", fields: {
        name: name.value, value: options.invalidValue ?? (name.value === "77917" ? "500" : "1"),
      } } } };
    },
  };
  const chain = createSuiAssemblyChain({ client, tenant: "dev",
    world: { packageId: "0x1", objectRegistryId: "0x2", adminAclId: "0x3", energyConfigId: "0x4", fuelConfigId: "0x5" },
    async execute() { executions++; },
  });
  return { chain, pages, executions: () => executions };
}

test("reads every deployed energy table page without submitting balance changes", async () => {
  const f = fixture();
  assert.deepEqual(await f.chain.readEnergyRequirements(), [
    { typeID: 77917, energyRequired: 500 }, { typeID: 90184, energyRequired: 1 },
  ]);
  assert.deepEqual(f.pages.map(page => page.cursor), [null, "cursor-1"]);
  assert.equal(f.executions(), 0);
});

test("incomplete, unsafe or changing energy tables fail before returning a replacement", async () => {
  await assert.rejects(fixture({ missing: true }).chain.readEnergyRequirements(), /Cannot read energy requirement/);
  await assert.rejects(fixture({ invalidValue: "9007199254740992" }).chain.readEnergyRequirements(), /Cannot read energy requirement/);
  await assert.rejects(fixture({ size: "3" }).chain.readEnergyRequirements(), /changed during reading/);
  await assert.rejects(fixture({ repeatedCursor: true }).chain.readEnergyRequirements(), /pagination did not advance/);
});

function nodeEnergyFixture() {
  const assembly: AssemblySnapshot = {
    itemId: "5001", typeId: 88092, ownerId: 140001, name: "Home node", kind: "network_node", status: 2,
    solarSystemId: 30002479, position: { x: 0, y: 0, z: 0 }, networkNodeId: null,
    destinationGateId: null, gateDistanceMeters: null, gateMaxDistanceMeters: null,
    fuel: { typeId: 78499, quantity: 10, unitVolume: "280000" }, fuelCapacity: "5000000000",
    burnRateMs: "1000", maxEnergy: "1000", storageCapacity: "0", inventory: [],
  };
  const address = (id: string) => normalizeSuiAddress(`0x${BigInt(id).toString(16)}`);
  const energy: Record<string, any> = {
    max_energy_production: "1000", current_energy_production: "1000", total_reserved_energy: "275",
  };
  const fields: any = {
    key: { fields: { id: assembly.itemId, tenant: "dev" } }, type_id: String(assembly.typeId),
    owner_cap_id: "0x70", status: { fields: { status: { variant: "ONLINE" } } },
    location: { fields: { location_hash: assemblyLocationHash(assembly) } },
    fuel: { fields: { max_capacity: assembly.fuelCapacity, burn_rate_in_ms: assembly.burnRateMs } },
    energy_source: { fields: energy },
  };
  let reads = 0;
  let executions = 0;
  let missing = false;
  const chain = createSuiAssemblyChain({
    client: { async getObject({ id }: any) {
      reads++;
      if (id === "0x70") return { data: { owner: { AddressOwner: address(String(assembly.ownerId)) } } };
      if (missing) return { error: { code: "notExists" } };
      return { data: { objectId: address(assembly.itemId), type: `${normalizeSuiAddress("0x1")}::network_node::NetworkNode`,
        content: { dataType: "moveObject", fields } } };
    } } as any,
    tenant: "dev", deriveId: address,
    world: { packageId: "0x1", objectRegistryId: "0x2", adminAclId: "0x3", energyConfigId: "0x4", fuelConfigId: "0x5" },
    async execute() { executions++; },
  });
  return { assembly, chain, energy, fields, reads: () => reads, executions: () => executions, remove: () => { missing = true; } };
}

test("reads confirmed Network Node reservations and production without writing chain state", async () => {
  const f = nodeEnergyFixture();
  const startedAt = Date.now();
  const energy = await f.chain.readEnergyState(f.assembly);
  assert.deepEqual({ ...energy, observedAtMs: 0 }, {
    maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 275, observedAtMs: 0,
  });
  assert.ok(energy.observedAtMs >= startedAt && energy.observedAtMs <= Date.now());
  const state = await f.chain.readAssembly(f.assembly);
  const reads = f.reads();
  f.energy.current_energy_production = "0";
  const offline = await f.chain.readEnergyState(f.assembly, state!);
  assert.equal(offline.currentEnergyProduction, 0);
  assert.equal(offline.energyUsed, 275, "Preserve confirmed reservations even when production is zero");
  assert.equal(f.reads(), reads, "Reuse the same confirmed object for fuel, status and energy");
  assert.equal(f.executions(), 0);
});

test("Network Node energy rejects missing, unsafe and impossible values", async () => {
  const f = nodeEnergyFixture();
  const state = (await f.chain.readAssembly(f.assembly))!;
  for (const field of ["max_energy_production", "current_energy_production", "total_reserved_energy"]) {
    const original = f.energy[field];
    for (const invalid of [undefined, null, "", "-1", "1.5", "9007199254740992", "18446744073709551616", Infinity, true]) {
      f.energy[field] = invalid;
      await assert.rejects(f.chain.readEnergyState(f.assembly, state), /valid u64|outside the local integer range/);
    }
    f.energy[field] = original;
  }
  f.energy.max_energy_production = "0";
  await assert.rejects(f.chain.readEnergyState(f.assembly, state), /invalid chain energy/);
  f.energy.max_energy_production = "1000";
  f.energy.current_energy_production = "1001";
  await assert.rejects(f.chain.readEnergyState(f.assembly, state), /invalid chain energy/);
  f.energy.current_energy_production = "1000";
  f.energy.total_reserved_energy = "1001";
  await assert.rejects(f.chain.readEnergyState(f.assembly, state), /invalid chain energy/);
  assert.equal(f.executions(), 0);
});

test("Network Node energy requires an anchored node and preserves capacity identity checks", async () => {
  const f = nodeEnergyFixture();
  await assert.rejects(f.chain.readEnergyState({ ...f.assembly, kind: "assembly" }), /not a Network Node/);
  f.energy.max_energy_production = "2000";
  await assert.rejects(f.chain.readEnergyState(f.assembly), /max energy differs from local state/);
  f.remove();
  await assert.rejects(f.chain.readEnergyState(f.assembly), /must be anchored before reading energy/);
  assert.equal(f.executions(), 0);
});

test("energy connection mutations wait until captured snapshots finish anchoring", async () => {
  const events: string[] = [];
  let finishAnchor: () => void;
  const gate = new Promise<void>(resolve => { finishAnchor = resolve; });
  const worker = createAssemblySyncWorker({ report() {}, async reconcile() {
    events.push("capture");
    await gate;
    events.push("anchor");
  } });
  const scan = worker.runOnce();
  const runner = createSuiAssemblyEnergyMutationRunner({ runExclusive: worker.runExclusive,
    getContext: () => ({ synced: { network: "localnet" }, async assertCurrent() { events.push("validate"); } }),
    hasPrepared: () => false,
  });
  const mutation = runner(() => { events.push("connection"); return 42; });
  assert.deepEqual(events, ["capture"]);
  finishAnchor();
  await scan;
  assert.equal(await mutation, 42);
  assert.deepEqual(events, ["capture", "anchor", "validate", "connection"]);
  await worker.stop();
});

test("energy mutations reject missing or changed deployments and outstanding signatures", async () => {
  let context: any = null;
  let prepared = false;
  let called = false;
  const operation = () => { called = true; };
  const runner = createSuiAssemblyEnergyMutationRunner({ runExclusive: operation => operation(),
    getContext: () => context, hasPrepared: () => prepared,
  });
  const errorCode = (code: string) => (error: any) => error.code === code;
  await assert.rejects(runSuiAssemblyEnergyMutation(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  await assert.rejects(runner(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  context = { synced: { network: "localnet" }, async assertCurrent() { throw new Error("changed"); } };
  await assert.rejects(runner(operation), errorCode("DEPLOYMENT_UNAVAILABLE"));
  context.assertCurrent = async () => {};
  prepared = true;
  await assert.rejects(runner(operation), errorCode("SPONSOR_BUSY"));
  prepared = false;
  context.executor = { hasPending: () => true };
  await assert.rejects(runner(operation), errorCode("SPONSOR_BUSY"));
  assert.equal(called, false);
});
