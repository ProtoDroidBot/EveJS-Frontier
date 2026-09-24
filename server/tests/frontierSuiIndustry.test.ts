import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { buildSuiIndustrySnapshot, industryU64, industryFingerprint, parseIndustryProduction, type IndustryFacilitySnapshot } from "../src/services/frontier/suiIndustrySnapshot";
import { createSuiIndustryChain, deriveSuiIndustryId, deriveSuiIndustryProductionId, deriveSuiIndustryLaneProductionId, deriveSuiIndustryLaneStateId } from "../src/services/frontier/suiIndustryChain";
import { createSuiIndustrySyncWorkerBridge, reconcileSuiIndustryFacilities, registerSuiIndustrySyncBridge, readSuiIndustrySyncStatus } from "../src/services/frontier/suiIndustrySync";
import { createSmartIndustryApi, mountSmartIndustryEndpoints } from "../src/_secondary/express/smartIndustryEndpoints";

const address = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`);
function source(blueprintID: number | undefined = 1007): any[] {
  return [{ itemID: 5000000001, ownerID: 140001, typeID: 87119, locationID: 30002479,
    customInfo: JSON.stringify({ evejsFrontierConstruction: { assemblyStatus: 2, assemblyTypeID: 87119, ownerID: 140001, solarSystemID: 30002479 },
      ...(blueprintID === undefined ? {} : { evejsFrontierIndustry: { version: 1, blueprintID } }) }) },
  { itemID: 501, ownerID: 140001, locationID: 5000000001, flagID: 20000, typeID: 95345, stacksize: 2, singleton: 0 },
  { itemID: 502, ownerID: 140001, locationID: 5000000001, flagID: 20000, typeID: 95345, stacksize: 3, singleton: 0 },
  { itemID: 503, ownerID: 140001, locationID: 5000000001, flagID: 20001, typeID: 83463, quantity: 7 },
  { itemID: 504, ownerID: 140001, locationID: 5000000001, flagID: 5, typeID: 95345, quantity: 900 },
  { itemID: 505, ownerID: 140002, locationID: 5000000001, flagID: 20000, typeID: 95345, quantity: 900 }];
}
function facility() { return buildSuiIndustrySnapshot(source()).facilities[0]; }
const running = () => ({ job_id: "1", state: "RUNNING" as const, requested_runs: "3", completed_runs: "0",
  run_started_at_ms: "1700000000000", run_end_at_ms: "1700000012000", stop_reason: null });

test("production captures exact run progress and changes the synchronization fingerprint", () => {
  const rows = source(); const custom = JSON.parse(rows[0].customInfo);
  const idle = buildSuiIndustrySnapshot(rows).facilities[0];
  custom.evejsFrontierIndustry.production = { version: 1, jobID: 1, state: "RUNNING", requestedRuns: 3, completedRuns: 0,
    runStartedAtMs: 1700000000000, runEndAtMs: 1700000012000, stopReason: null };
  rows[0].customInfo = custom;
  const result = buildSuiIndustrySnapshot(rows);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.facilities[0].production, running());
  assert.notEqual(industryFingerprint(idle), industryFingerprint(result.facilities[0]));
  for (const change of [{ job_id: "0" }, { state: "UNKNOWN" }, { completed_runs: "3" }, { requested_runs: "0" },
    { run_end_at_ms: "1" }, { stop_reason: "DISCONTINUED" }, { state: "STOPPED", stop_reason: "COMPLETED" }]) {
    assert.throws(() => parseIndustryProduction({ ...running(), ...change }));
  }
  assert.equal(parseIndustryProduction({ ...running(), requested_runs: null })?.requested_runs, null);
});

test("Industry snapshot and chain status preserve every authored production lane", async () => {
  const rows = source();
  const custom = JSON.parse(rows[0].customInfo);
  custom.evejsFrontierIndustry.lanes = {
    "1": { production: { version: 1, jobID: 1, state: "RUNNING", requestedRuns: 3, completedRuns: 0,
      runStartedAtMs: 1700000000000, runEndAtMs: 1700000012000, stopReason: null } },
    "2": { blueprintID: 1026, production: { version: 1, jobID: 2, state: "RUNNING", requestedRuns: null, completedRuns: 4,
      runStartedAtMs: 1700000020000, runEndAtMs: 1700000032000, stopReason: null } },
  };
  custom.evejsFrontierIndustry.production = custom.evejsFrontierIndustry.lanes["1"].production;
  rows[0].customInfo = custom;
  rows.push(
    { itemID: 506, ownerID: 140001, locationID: 5000000001, flagID: 20002, typeID: 78423, stacksize: 9, singleton: 0 },
    { itemID: 507, ownerID: 140001, locationID: 5000000001, flagID: 20003, typeID: 77818, stacksize: 4, singleton: 0 },
  );
  const snapshot = buildSuiIndustrySnapshot(rows);
  assert.deepEqual(snapshot.errors, []);
  assert.equal(snapshot.facilities[0].productions.length, 4);
  assert.equal(snapshot.facilities[0].productions[1].production?.job_id, "2");
  assert.equal(snapshot.facilities[0].lanes[1].snapshot.blueprint_id, "1026");
  assert.deepEqual(snapshot.facilities[0].lanes[1].snapshot.inputs,
    [{ type_id: "78423", quantity: "9" }]);
  assert.deepEqual(snapshot.facilities[0].lanes[1].snapshot.outputs,
    [{ type_id: "77818", quantity: "4" }]);
  assert.notDeepEqual(snapshot.facilities[0].lanes[0].snapshot.blueprint_inputs,
    snapshot.facilities[0].lanes[1].snapshot.blueprint_inputs);
});

test("Industry snapshot reads selected authored recipe and owned escrow totals only", () => {
  const rows = source(); const original = structuredClone(rows);
  const result = buildSuiIndustrySnapshot(rows);
  assert.deepEqual(rows, original);
  assert.deepEqual(result.errors, []);
  const current = result.facilities[0];
  assert.deepEqual({ ...current, lanes: undefined }, { itemId: "5000000001", typeId: 87119, status: 2, production: null,
    productions: [1, 2, 3, 4].map(laneID => ({ lane_id: String(laneID), production: null })), snapshot: {
    owner_id: "140001", solar_system_id: "30002479", blueprint_id: "1007", run_time: "12",
    inputs: [{ type_id: "95345", quantity: "5" }], outputs: [{ type_id: "83463", quantity: "7" }],
    blueprint_inputs: [{ type_id: "95345", quantity: "1", max_quantity: "400" }],
    blueprint_outputs: [{ type_id: "83463", quantity: "1", max_quantity: "500" }],
  }, lanes: undefined });
  assert.equal(current.lanes.length, 4);
  assert.deepEqual(current.lanes[0], { lane_id: "1", production: null, snapshot: current.snapshot });
  assert.equal(current.lanes[1].snapshot.blueprint_id, "0");
  assert.deepEqual(current.lanes[1].snapshot.inputs, []);
  assert.deepEqual(buildSuiIndustrySnapshot([...rows].reverse()), result);
});

test("no selected blueprint is represented explicitly and construction sites are excluded", () => {
  const rows = source(); const custom = JSON.parse(rows[0].customInfo);
  delete custom.evejsFrontierIndustry; rows[0].customInfo = custom;
  assert.equal(buildSuiIndustrySnapshot(rows).facilities[0].snapshot.blueprint_id, "0");
  assert.deepEqual(buildSuiIndustrySnapshot(rows).facilities[0].snapshot.blueprint_inputs, []);
  custom.evejsFrontierConstruction.assemblyStatus = 5;
  assert.deepEqual(buildSuiIndustrySnapshot(rows), { facilities: [], errors: [] });
  delete custom.evejsFrontierConstruction;
  assert.deepEqual(buildSuiIndustrySnapshot(rows), { facilities: [], errors: [] });
});

test("invalid recipes, quantities, conflicting identities and duplicate rows fail closed", () => {
  const mutations = [
    (rows: any[]) => { rows[0].customInfo = "{bad"; },
    (rows: any[]) => { const info = JSON.parse(rows[0].customInfo); info.evejsFrontierIndustry.blueprintID = 999999; rows[0].customInfo = info; },
    (rows: any[]) => { rows[1].stacksize = Number.MAX_SAFE_INTEGER + 1; },
    (rows: any[]) => { rows[1].stacksize = -1; },
    (rows: any[]) => { rows[0].ownerID = 140009; },
    (rows: any[]) => { rows.push({ ...rows[1] }); },
    (rows: any[]) => { rows.push({ ...rows[0] }); },
    (rows: any[]) => { rows[1].stacksize = "18446744073709551615"; },
  ];
  for (const mutate of mutations) {
    const rows = source(); mutate(rows);
    const result = buildSuiIndustrySnapshot(rows);
    assert.equal(result.facilities.length, 0);
    assert.ok(result.errors.length);
  }
  assert.equal(industryU64("18446744073709551615", "ID"), "18446744073709551615");
  assert.throws(() => industryU64("18446744073709551616", "ID"));
});

function chainFixture(industryPackageId?: string, industryTypeOrigin?: string, industryRegistryId?: string) {
  const world = { packageId: address(80), objectRegistryId: address(81), adminAclId: address(82), energyConfigId: address(83), fuelConfigId: address(84) };
  const current = { facility: facility(), fields: null as any, productionField: null as any,
    laneProductionField: null as any, laneStateField: null as any,
    executions: [] as any[], apply: true, checks: 0, online: true };
  const assembly: any = { itemId: "5000000001", kind: "assembly", typeId: 87119, ownerId: 140001, solarSystemId: 30002479 };
  const assemblyID = address(100);
  const industryId = deriveSuiIndustryId(
    world,
    assemblyID,
    industryTypeOrigin || industryPackageId || world.packageId,
    industryRegistryId || world.objectRegistryId,
  );
  const objects = { getObject: async ({ id }: any) => id === deriveSuiIndustryLaneStateId(industryId)
    ? current.laneStateField ? { data: { owner: { ObjectOwner: industryId }, content: { dataType: "moveObject",
      type: `0x2::dynamic_field::Field<u8, ${industryPackageId || world.packageId}::smart_industry::LaneStateRecord>`, fields: current.laneStateField } } }
      : { error: { code: "notExists" } }
    : id === deriveSuiIndustryLaneProductionId(industryId)
    ? current.laneProductionField ? { data: { owner: { ObjectOwner: industryId }, content: { dataType: "moveObject",
      type: `0x2::dynamic_field::Field<u8, ${industryPackageId || world.packageId}::smart_industry::LaneProductionRecord>`, fields: current.laneProductionField } } }
      : { error: { code: "notExists" } }
    : id === deriveSuiIndustryProductionId(industryId)
    ? current.productionField ? { data: { owner: { ObjectOwner: industryId }, content: { dataType: "moveObject",
      type: `0x2::dynamic_field::Field<u8, ${industryPackageId || world.packageId}::smart_industry::ProductionRecord>`, fields: current.productionField } } }
      : { error: { code: "notExists" } }
    : current.fields ? { data: {
    type: `${industryTypeOrigin || industryPackageId || world.packageId}::smart_industry::SmartIndustry`, content: { dataType: "moveObject", fields: current.fields },
  } } : { error: { code: "notExists" } } };
  const chain = { deriveId: () => assemblyID, readAssembly: async () => ({ online: current.online }) };
  const adapter = () => createSuiIndustryChain({ client: objects as any, world, chain, tenant: "dev", industryPackageId, industryTypeOrigin, industryRegistryId, now: () => 1700000000000,
    assertSnapshotCurrent(expected) { current.checks++; assert.deepEqual(expected, current.facility, "stale snapshot"); },
    async execute(label, tx, ownerId, assertCurrent, gasPayerOwnerId) {
      assertCurrent?.();
      const data = tx.getData(); current.executions.push({ label, ownerId, gasPayerOwnerId, data });
      const call = data.commands.at(-1).MoveCall;
      const integer = (argument: any) => Buffer.from((data.inputs[argument.Input] as any).Pure.bytes, "base64").readBigUInt64LE().toString();
      assert.equal(ownerId, undefined, "Only the existing server executor signs mirrors");
      assert.equal(gasPayerOwnerId, Number(current.facility.snapshot.owner_id),
        "Industry gas must be charged to the facility owner when it is an NPC");
      const isSync = call.function === "sync_with_lane_states";
      if (isSync) assert.equal(integer(call.arguments[3]), current.fields.revision);
      const observed = integer(call.arguments[isSync ? 4 : 3]);
      if (current.apply) current.fields = {
        assembly_id: assemblyID, assembly_key: { fields: { id: current.facility.itemId, tenant: "dev" } },
        type_id: String(current.facility.typeId), assembly_status: current.facility.status,
        revision: String(BigInt(current.fields?.revision || "0") + 1n), observed_at_ms: observed, synced_at_ms: "1700000000000",
        snapshot: { fields: structuredClone(current.facility.snapshot) },
      };
      if (current.apply) {
        const p = current.facility.production;
        const rawProduction = (value: any) => value ? {
          ...value, state: { RUNNING: 1, DISCONTINUING: 2, STOPPED: 3 }[value.state],
          requested_runs: value.requested_runs ?? "0", stop_reason: value.stop_reason ?? "",
        } : { job_id: "0", state: 0, requested_runs: "0", completed_runs: "0", run_started_at_ms: "0", run_end_at_ms: "0", stop_reason: "" };
        current.productionField = { name: 0, value: { fields: { revision: current.fields.revision, production: { fields: p ? {
          ...p, state: { RUNNING: 1, DISCONTINUING: 2, STOPPED: 3 }[p.state], requested_runs: p.requested_runs ?? "0", stop_reason: p.stop_reason ?? "",
        } : { job_id: "0", state: 0, requested_runs: "0", completed_runs: "0", run_started_at_ms: "0", run_end_at_ms: "0", stop_reason: "" } } } } };
        current.laneProductionField = { name: 1, value: { fields: { revision: current.fields.revision,
          lanes: current.facility.productions.map((lane: any) => ({ fields: { lane_id: lane.lane_id,
            production: { fields: rawProduction(lane.lane_id === "1" ? p : lane.production) } } })) } } };
        current.laneStateField = { name: 2, value: { fields: { revision: current.fields.revision,
          lanes: current.facility.lanes.map((lane: any) => ({ fields: {
            lane_id: lane.lane_id,
            snapshot: { fields: structuredClone(lane.lane_id === "1" ? current.facility.snapshot : lane.snapshot) },
            production: { fields: rawProduction(lane.lane_id === "1" ? p : lane.production) },
          } })) } } };
      }
    },
  });
  return { world, current, assembly, assemblyID, adapter };
}

test("Smart Industry creates a sidecar, verifies it and deduplicates across adapter restarts", async () => {
  const f = chainFixture();
  await f.adapter().sync(f.current.facility, f.assembly);
  assert.equal(f.current.executions.length, 1);
  assert.equal(f.current.fields.revision, "1");
  assert.equal(f.current.executions[0].data.commands.at(-1).MoveCall.function, "create_with_lane_states");
  assert.ok(f.current.checks >= 3);
  const result = await f.adapter().status(f.current.facility, f.assembly);
  assert.equal(result.synchronized, true);
  assert.equal(result.industryObjectID, deriveSuiIndustryId(f.world, f.assemblyID));
  await f.adapter().sync(f.current.facility, f.assembly);
  assert.equal(f.current.executions.length, 1);
});

test("NPC Industry creation and subsequent lane sync retain the NPC gas-payer identity", async () => {
  const f = chainFixture();
  const npcOwnerId = 1_500_000_001;
  f.assembly.ownerId = npcOwnerId;
  f.current.facility.snapshot.owner_id = String(npcOwnerId);
  const adapter = f.adapter();
  await adapter.sync(f.current.facility, f.assembly);
  f.current.facility.snapshot.inputs = [];
  await adapter.sync(f.current.facility, f.assembly);
  assert.deepEqual(f.current.executions.map(entry => entry.gasPayerOwnerId), [npcOwnerId, npcOwnerId]);
});

test("inventory, blueprint clearing and status changes replace snapshots with revision guards", async () => {
  const f = chainFixture(); const adapter = f.adapter();
  await adapter.sync(f.current.facility, f.assembly);
  f.current.facility.snapshot.inputs = [];
  await adapter.sync(f.current.facility, f.assembly);
  assert.equal(f.current.fields.revision, "2");
  assert.equal(f.current.fields.observed_at_ms, "1700000000001");
  assert.deepEqual(f.current.fields.snapshot.fields.inputs, []);
  Object.assign(f.current.facility.snapshot, { blueprint_id: "0", run_time: "0", blueprint_inputs: [], blueprint_outputs: [] });
  f.current.facility.status = 1; f.current.online = false;
  await adapter.sync(f.current.facility, f.assembly);
  assert.equal(f.current.fields.revision, "3");
  assert.equal(f.current.fields.assembly_status, 1);
  assert.equal(f.current.executions.at(-1).data.commands.at(-1).MoveCall.function, "sync_with_lane_states");
});

test("upgraded Industry modules retain the original Assembly and sidecar type origin", async () => {
  const f = chainFixture(address(90), address(89), address(88));
  await f.adapter().sync(f.current.facility, f.assembly);
  const calls = f.current.executions[0].data.commands.filter((c: any) => c.MoveCall).map((c: any) => c.MoveCall);
  assert.ok(calls.every((call: any) => call.package === address(90)));
  const vectors = f.current.executions[0].data.commands.filter((c: any) => c.MakeMoveVec).map((c: any) => c.MakeMoveVec);
  const typedVectors = vectors.filter((vector: any) => vector.type !== null);
  assert.ok(typedVectors.length > 0);
  assert.ok(typedVectors.every((vector: any) => vector.type.startsWith(`${address(89)}::smart_industry::`)));
  assert.equal(vectors.filter((vector: any) => vector.type === null).length, 1);
  const status = await f.adapter().status(f.current.facility, f.assembly);
  assert.equal(status.assemblyObjectID, f.assemblyID);
  assert.equal(status.industryObjectID, deriveSuiIndustryId(f.world, f.assemblyID, address(89), address(88)));
  assert.equal(status.synchronized, true);
  assert.notEqual(status.industryObjectID, deriveSuiIndustryId(f.world, f.assemblyID));
});

test("foreign sidecars, changed Assembly status and stale local snapshots never authorize a write", async () => {
  const f = chainFixture(); const adapter = f.adapter();
  await adapter.sync(f.current.facility, f.assembly);
  f.current.fields.assembly_id = address(999);
  await assert.rejects(adapter.sync(f.current.facility, f.assembly), /different Assembly/);
  f.current.fields.assembly_id = f.assemblyID;
  f.current.online = false;
  await assert.rejects(adapter.sync(f.current.facility, f.assembly), /status changed/);
  f.current.online = true;
  const old = structuredClone(f.current.facility); f.current.facility.snapshot.outputs = [];
  await assert.rejects(adapter.sync(old, f.assembly), /stale snapshot/);
  assert.equal(f.current.executions.length, 1);
});

test("a successful executor return without observed chain effects is not reported synced", async () => {
  const f = chainFixture(); f.current.apply = false;
  await assert.rejects(f.adapter().sync(f.current.facility, f.assembly), /not confirmed/);
});

test("start, subsequent runs, discontinuation and completion mirror atomically with inventories", async () => {
  const f = chainFixture(); const adapter = f.adapter();
  await adapter.sync(f.current.facility, f.assembly);
  f.current.facility.production = running();
  f.current.facility.snapshot.inputs[0].quantity = "4";
  await adapter.sync(f.current.facility, f.assembly);
  let state = await adapter.status(f.current.facility, f.assembly);
  assert.equal(state.productionMirrored, true);
  assert.deepEqual(state.chainProduction, running());
  f.current.facility.production = { ...running(), completed_runs: "1", run_started_at_ms: "1700000012000", run_end_at_ms: "1700000024000" };
  f.current.facility.snapshot.inputs[0].quantity = "3";
  f.current.facility.snapshot.outputs[0].quantity = "8";
  await adapter.sync(f.current.facility, f.assembly);
  f.current.facility.production.state = "DISCONTINUING";
  await adapter.sync(f.current.facility, f.assembly);
  f.current.facility.production = { ...f.current.facility.production, state: "STOPPED", completed_runs: "2", stop_reason: "DISCONTINUED" };
  f.current.facility.snapshot.outputs[0].quantity = "9";
  await adapter.sync(f.current.facility, f.assembly);
  state = await adapter.status(f.current.facility, f.assembly);
  assert.equal(state.synchronized, true);
  assert.equal(state.chainProduction?.completed_runs, "2");
  assert.equal(state.chainProduction?.stop_reason, "DISCONTINUED");
  assert.equal(f.current.fields.revision, "5");
});

test("legacy missing production and mixed revisions cannot claim synchronized production", async () => {
  const f = chainFixture(); const adapter = f.adapter();
  f.current.facility.production = running();
  await adapter.sync(f.current.facility, f.assembly);
  f.current.productionField = null;
  f.current.laneProductionField = null;
  f.current.laneStateField = null;
  const old = await adapter.status(f.current.facility, f.assembly);
  assert.equal(old.synchronized, false);
  assert.equal(old.productionMirrored, false);
  assert.equal(old.chainProduction, null);
  f.current.apply = false;
  await assert.rejects(adapter.sync(f.current.facility, f.assembly), /not confirmed/);
  f.current.apply = true;
  await adapter.sync(f.current.facility, f.assembly);
  f.current.laneStateField.value.fields.revision = "999";
  await assert.rejects(adapter.status(f.current.facility, f.assembly), /revision changed/);
  f.current.laneStateField.value.fields.revision = f.current.fields.revision;
  f.current.fields.revision = String(BigInt(f.current.fields.revision) + 1n);
  await assert.rejects(adapter.status(f.current.facility, f.assembly), /revision changed/);
  await adapter.sync(f.current.facility, f.assembly);
  assert.equal((await adapter.status(f.current.facility, f.assembly)).synchronized, true);
});

test("Industry reconciliation continues independent facility failures but halts on uncertain transactions", async () => {
  const first = facility(); const second = { ...facility(), itemId: "5000000002" };
  const assemblies: any = [first, second].map(f => ({ itemId: f.itemId, kind: "assembly" }));
  const called: string[] = [];
  const context = { assertCurrent: async () => {}, executor: { hasPending: () => false }, industry: { sync: async (f: any) => {
    called.push(f.itemId); if (f.itemId === first.itemId) throw new Error("RPC unavailable");
  } } };
  await assert.rejects(reconcileSuiIndustryFacilities({ facilities: [first, second], errors: [] }, assemblies, context), /RPC unavailable/);
  assert.deepEqual(called, [first.itemId, second.itemId]);
  called.length = 0; context.executor.hasPending = () => true;
  await assert.rejects(reconcileSuiIndustryFacilities({ facilities: [first, second], errors: [] }, assemblies, context));
  assert.deepEqual(called, [first.itemId]);
});

test("serialized Industry read/flush rejects foreign owners and invalidates stale reads", async () => {
  const current = facility(); let runs = 0; let mutate = false;
  const bridge = createSuiIndustrySyncWorkerBridge({ runExclusive: operation => operation(), runOnce: async () => { runs++; },
    getContext: () => ({ assertCurrent: async () => {}, executor: { hasPending: () => false }, industry: { status: async () => {
      if (mutate) current.snapshot.outputs = [];
      return { synchronized: true, productionMirrored: true, laneStatesMirrored: true,
        chainProduction: null, industryObjectID: address(111), assemblyObjectID: address(112) };
    } } }),
    getSnapshot: () => ({ facilities: [structuredClone(current)], assemblies: [{ itemId: current.itemId, kind: "assembly" } as any] }),
    getLastError: () => "", hasPrepared: () => false,
  });
  await assert.rejects(bridge.flush({ facilityID: 5000000001, characterID: 140002 }), /Owned Industry/);
  assert.equal(runs, 0);
  assert.equal((await bridge.flush({ facilityID: 5000000001, characterID: 140001 })).status, "synced");
  assert.equal(runs, 2);
  mutate = true;
  assert.equal((await bridge.readStatus({ facilityID: 5000000001, characterID: 140001 })).status, "pending");
});

test("explicit Industry flush can create an initially missing chain Assembly before reading status", async () => {
  let ready = false;
  const current = facility();
  const bridge = createSuiIndustrySyncWorkerBridge({ runExclusive: operation => operation(), runOnce: async () => { ready = true; },
    getContext: () => ({ assertCurrent: async () => {}, executor: { hasPending: () => false }, industry: { status: async () => {
      if (!ready) throw new Error("Industry Assembly has not synchronized yet");
      return { synchronized: true, productionMirrored: true, laneStatesMirrored: true,
        chainProduction: null, industryObjectID: address(111), assemblyObjectID: address(112) };
    } } }),
    getSnapshot: () => ({ facilities: [current], assemblies: [{ itemId: current.itemId, kind: "assembly" } as any] }),
    getLastError: () => "", hasPrepared: () => false,
  });
  assert.equal((await bridge.flush({ facilityID: 5000000001, characterID: 140001 })).status, "synced");
});

test("Industry public bridge handles disabled state, invalid identity, and worker replacement", async () => {
  const request = { facilityID: 5000000001, characterID: 140001 };
  assert.equal((await readSuiIndustrySyncStatus(request)).status, "disabled");
  assert.equal((await readSuiIndustrySyncStatus({ ...request, characterID: -1 })).status, "error");
  const remove = registerSuiIndustrySyncBridge({ readStatus: async () => { remove(); return { ...request, status: "pending" }; }, flush: async () => ({ ...request, status: "pending" }) });
  try { assert.equal((await readSuiIndustrySyncStatus(request)).status, "error"); } finally { remove(); }
});

test("Industry API requires live ownership, rechecks auth and suppresses private worker errors", async () => {
  let owner = 140001; let live = true; let calls = 0; let revoke = false;
  const api = createSmartIndustryApi({
    auth: { authenticate: () => live ? { success: true, data: { characterID: owner, walletAddress: address(owner) } } : { success: false, errorMsg: "AUTH_EXPIRED" } },
    readFacility: () => facility(),
    readChain: async (request: any) => { calls++; if (revoke) live = false; return { ...request, status: "error", message: "PRIVATE_DEPLOYMENT_PATH" }; },
    flushChain: async () => { calls++; return {}; },
  });
  owner = 140002;
  assert.equal((await api.sync("token", "5000000001") as any).errorMsg, "ACCESS_DENIED"); assert.equal(calls, 0);
  owner = 140001;
  const result = await api.status("token", "5000000001");
  assert.equal((result as any).data.production, null);
  assert.equal(JSON.stringify(result).includes("PRIVATE_DEPLOYMENT_PATH"), false);
  revoke = true;
  assert.equal((await api.status("token", "5000000001") as any).errorMsg, "AUTH_EXPIRED");
});

test("Industry HTTP routes expose wallet auth and facility status/sync/start with origin protection", () => {
  const routes: string[] = []; const middlewares: any[] = [];
  mountSmartIndustryEndpoints({ use: (_path: string, callback: any) => middlewares.push(callback), post: (route: string) => routes.push(route) }, { api: {} });
  assert.deepEqual(routes, ["/evejs/industry/auth/challenge", "/evejs/industry/auth/session", "/evejs/industry/:facilityID/status", "/evejs/industry/:facilityID/sync", "/evejs/industry/:facilityID/start", "/evejs/industry/:facilityID/storage", "/evejs/industry/:facilityID/transfer", "/evejs/industry/:facilityID/storage-sync", "/evejs/industry/:facilityID/blueprints", "/evejs/industry/:facilityID/blueprint", "/evejs/industry/:facilityID/empty"]);
  let code: number; let next = false;
  const response = { set() {}, vary() {}, status(value: number) { code = value; return this; }, json() {} };
  middlewares[1]({ headers: { origin: "https://untrusted.invalid" } }, response, () => { next = true; });
  assert.equal(code, 403); assert.equal(next, false);
});

test("Industry API exposes local and confirmed production and refuses old mirrors", async () => {
  const current = facility(); current.production = running();
  let mirrored = true;
  const api = createSmartIndustryApi({
    auth: { authenticate: () => ({ success: true, data: { characterID: 140001, walletAddress: address(140001) } }) },
    readFacility: () => current,
    readChain: async (request: any) => ({ ...request, status: "synced", synchronized: true,
      industryObjectID: address(111), assemblyObjectID: address(112), productionMirrored: mirrored,
      laneStatesMirrored: mirrored,
      chainProduction: mirrored ? running() : null,
    }),
  });
  const synced = await api.status("token", "5000000001") as any;
  assert.deepEqual(synced.data.production, running());
  assert.deepEqual(synced.data.chain.production, running());
  assert.equal(synced.data.chain.status, "synced");
  mirrored = false;
  const legacy = await api.status("token", "5000000001") as any;
  assert.equal(legacy.data.chain.status, "pending");
  assert.equal(legacy.data.chain.productionMirrored, false);
  assert.equal(legacy.data.chain.production, null);
  assert.deepEqual(legacy.data.production, running());
});

function startApiFixture(options: Record<string, any> = {}) {
  const session = { characterID: 140001, shipid: 5000000002, solarsystemid2: 30002479 };
  const state = { facility: facility(), live: true, owner: 140001, calls: [] as any[] };
  const blueprint = require("../src/services/frontier/industryBlueprints").getBlueprintForFacility(87119, 1007);
  const body = { blueprintID: "1007", blueprintHash: blueprint.content_hash, runs: "3", expectedJobID: null };
  const api = createSmartIndustryApi({
    auth: { authenticate: () => state.live
      ? { success: true, data: { characterID: state.owner, walletAddress: address(state.owner), session } }
      : { success: false, errorMsg: "AUTH_EXPIRED" } },
    readFacility: () => structuredClone(state.facility),
    validateFacility: (...args: any[]) => { state.calls.push(["validate", ...args]); return { success: true }; },
    settleProduction: (...args: any[]) => { state.calls.push(["settle", ...args]); return { success: true }; },
    startProduction: (...args: any[]) => {
      state.calls.push(["start", ...args]);
      const jobID = Number(state.facility.production?.job_id || 0) + 1;
      state.facility.production = { ...running(), job_id: String(jobID), requested_runs: args[4] === null ? null : String(args[4]) };
      state.facility.snapshot.inputs[0].quantity = String(Number(state.facility.snapshot.inputs[0].quantity) - 1);
      return { success: true, data: { facility: { itemID: 5000000001 }, production: { version: 1,
        jobID, state: "RUNNING", requestedRuns: args[4], completedRuns: 0,
        runStartedAtMs: 1700000000000, runEndAtMs: 1700000012000, stopReason: null }, changes: [], events: [] } };
    },
    trackProduction: (...args: any[]) => state.calls.push(["track", ...args]),
    publishProduction: (...args: any[]) => state.calls.push(["publish", ...args]),
    readChain: async (request: any) => ({ ...request, status: "disabled" }),
    flushChain: async (request: any) => { state.calls.push(["flush", request]); return { ...request, status: "pending" }; },
    ...options,
  });
  return { api, state, session, body };
}

test("Industry API starts the authoritative job with a live session and refreshes server and chain state", async () => {
  const f = startApiFixture();
  const before = await f.api.status("token", "5000000001") as any;
  assert.equal(before.data.blueprintHash, f.body.blueprintHash);
  const result = await f.api.start("token", "5000000001", f.body) as any;
  assert.equal(result.success, true);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.startedJobID, "1");
  assert.deepEqual(result.data.production, running());
  assert.equal(result.data.facility.snapshot.inputs[0].quantity, "4");
  assert.equal(result.data.chain.status, "pending");
  assert.deepEqual(f.state.calls.map(call => call[0]), ["validate", "settle", "start", "track", "publish", "flush"]);
  assert.deepEqual(f.state.calls[2].slice(1), [f.session, 5000000001, 1007, f.body.blueprintHash, 3]);
  assert.equal(f.state.calls[4][2], f.session);
});

test("Industry start requires ownership, exact job intent, safe runs and a blueprint hash before mutation", async () => {
  const cases = [
    [null, "INVALID_REQUEST"],
    [{ blueprintID: true }, "INVALID_BLUEPRINT_ID"], [{ blueprintID: "1e3" }, "INVALID_BLUEPRINT_ID"],
    [{ blueprintHash: "wrong" }, "INVALID_BLUEPRINT_HASH"],
    ...[undefined, 0, -1, "", "1.5", "1e3", " 3", true, {}, "9007199254740992"].map(runs => [{ runs }, "INVALID_RUN_COUNT"]),
    ...[undefined, 0, {}, "9007199254740992"].map(expectedJobID => [{ expectedJobID }, "INVALID_JOB_ID"]),
    [{ expectedJobID: "1" }, "PRODUCTION_CHANGED"],
  ];
  for (const [change, error] of cases) {
    const f = startApiFixture();
    const result = await f.api.start("token", "5000000001", change === null ? null : { ...f.body, ...change as any }) as any;
    assert.equal(result.errorMsg, error, JSON.stringify(change));
    assert.deepEqual(f.state.calls, []);
  }
  const f = startApiFixture();
  f.state.owner++;
  assert.equal((await f.api.start("token", "5000000001", f.body) as any).errorMsg, "ACCESS_DENIED");
  f.state.live = false;
  assert.equal((await f.api.start("token", "5000000001", f.body) as any).errorMsg, "AUTH_EXPIRED");
  assert.deepEqual(f.state.calls, []);
});

test("Industry start respects runtime access and production errors without disclosing internal details", async () => {
  for (const code of ["FACILITY_OUT_OF_RANGE", "FACILITY_NOT_IN_CURRENT_SYSTEM", "ASSEMBLY_ACTIVATING", "INVALID_SHIP"]) {
    const f = startApiFixture({ validateFacility: () => ({ success: false, errorMsg: code }) });
    assert.equal((await f.api.start("token", "5000000001", f.body) as any).errorMsg, code);
    assert.deepEqual(f.state.calls, []);
  }
  for (const code of ["FACILITY_OFFLINE", "INVALID_BLUEPRINT_HASH", "BLUEPRINT_NOT_LOADED", "INSUFFICIENT_INPUTS", "OUTPUT_CAPACITY_EXCEEDED", "PRODUCTION_ALREADY_RUNNING", "PRIVATE_DATABASE_PATH"]) {
    const f = startApiFixture({ startProduction: () => ({ success: false, errorMsg: code, params: "PRIVATE_DATABASE_PATH" }) });
    const result = await f.api.start("token", "5000000001", f.body) as any;
    assert.equal(result.errorMsg, code === "PRIVATE_DATABASE_PATH" ? "INDUSTRY_REQUEST_FAILED" : code);
    assert.equal(JSON.stringify(result).includes("PRIVATE_DATABASE_PATH"), false);
    assert.deepEqual(f.state.calls.map(call => call[0]), ["validate", "settle"]);
  }
});

test("Industry start supports continuous runs and rejects replay even after the first job finishes", async () => {
  const f = startApiFixture();
  const body = { ...f.body, runs: null };
  assert.equal((await f.api.start("token", "5000000001", body) as any).data.production.requested_runs, null);
  assert.equal((await f.api.start("token", "5000000001", body) as any).errorMsg, "PRODUCTION_CHANGED");
  f.state.facility.production = { ...running(), state: "STOPPED", completed_runs: "3", stop_reason: "COMPLETED" };
  assert.equal((await f.api.start("token", "5000000001", body) as any).errorMsg, "PRODUCTION_CHANGED");
  const next = await f.api.start("token", "5000000001", { ...body, expectedJobID: "1" }) as any;
  assert.equal(next.data.startedJobID, "2");
  assert.equal(f.state.calls.filter(call => call[0] === "start").length, 2);
});

test("Industry start remains committed when chain sync, notification or post-commit authentication fails", async () => {
  for (const outcome of ["error", "timeout", "expired"]) {
    const f = startApiFixture({
      chainWaitMs: 1,
      publishProduction: () => { throw new Error("PRIVATE_NOTIFICATION_ERROR"); },
      flushChain: async () => {
        if (outcome === "expired") f.state.live = false;
        if (outcome === "timeout") return new Promise(() => {});
        throw new Error("PRIVATE_CHAIN_ERROR");
      },
    });
    const result = await f.api.start("token", "5000000001", f.body) as any;
    assert.equal(result.success, true, outcome);
    assert.equal(result.data.gameCommitted, true);
    assert.equal(result.data.startedJobID, "1");
    assert.deepEqual(result.data.production, running());
    assert.equal(result.data.facility.snapshot.inputs[0].quantity, "4");
    assert.equal(result.data.chain.status, outcome === "error" ? "error" : "pending");
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
    assert.equal(f.state.calls.filter(call => call[0] === "track").length, 1);
  }
});

test("Industry start captures committed state when rereading fails and continues syncing after tracking fails", async () => {
  let started = false;
  let flushes = 0;
  const f = startApiFixture({
    readFacility: () => {
      if (started) throw new Error("PRIVATE_READ_ERROR");
      return structuredClone(f.state.facility);
    },
    trackProduction: () => { started = true; throw new Error("PRIVATE_TRACK_ERROR"); },
  });
  const result = await f.api.start("token", "5000000001", f.body) as any;
  assert.equal(result.success, true);
  assert.deepEqual(result.data.facility, f.state.facility);
  assert.equal(result.data.startedJobID, "1");
  assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);

  const tracked = startApiFixture({
    trackProduction: () => { throw new Error("PRIVATE_TRACK_ERROR"); },
    flushChain: async (request: any) => { flushes++; return { ...request, status: "pending" }; },
  });
  assert.equal((await tracked.api.start("token", "5000000001", tracked.body) as any).success, true);
  assert.equal(flushes, 1);
});

test("concurrent Industry start requests commit one job while its chain synchronization is pending", async () => {
  const f = startApiFixture({ chainWaitMs: 1, flushChain: () => new Promise(() => {}) });
  const [first, duplicate] = await Promise.all([
    f.api.start("token", "5000000001", f.body), f.api.start("token", "5000000001", f.body),
  ]) as any[];
  assert.equal(first.success, true);
  assert.equal(duplicate.errorMsg, "PRODUCTION_CHANGED");
  assert.equal(f.state.calls.filter(call => call[0] === "start").length, 1);
});

test("Industry HTTP start forwards body and maps access, invalid input and conflicts", async () => {
  const routes = new Map<string, any>();
  let errorMsg: string | null = null;
  let received: any;
  mountSmartIndustryEndpoints({ use() {}, post: (route: string, handler: any) => routes.set(route, handler) }, {
    api: { start: async (...args: any[]) => { received = args; return errorMsg ? { success: false, errorMsg } : { success: true }; } },
  });
  const request = { headers: { authorization: "Bearer token" }, params: { facilityID: "5000000001" }, body: { runs: "3" } };
  let code: number;
  const response = { status(value: number) { code = value; return this; }, json() {} };
  for (const [error, expected] of [[null, 200], ["AUTH_EXPIRED", 401], ["FACILITY_OUT_OF_RANGE", 403],
    ["INVALID_RUN_COUNT", 400], ["PRODUCTION_CHANGED", 409], ["INSUFFICIENT_INPUTS", 409], ["INDUSTRY_REQUEST_FAILED", 500]]) {
    errorMsg = error as string | null;
    await routes.get("/evejs/industry/:facilityID/start")(request, response);
    assert.equal(code, expected);
    assert.deepEqual(received, ["Bearer token", "5000000001", request.body]);
  }
});
