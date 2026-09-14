import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { buildSuiIndustrySnapshot, industryU64, industryFingerprint, parseIndustryProduction, type IndustryFacilitySnapshot } from "../src/services/frontier/suiIndustrySnapshot";
import { createSuiIndustryChain, deriveSuiIndustryId, deriveSuiIndustryProductionId } from "../src/services/frontier/suiIndustryChain";
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

test("Industry snapshot reads selected authored recipe and owned escrow totals only", () => {
  const rows = source(); const original = structuredClone(rows);
  const result = buildSuiIndustrySnapshot(rows);
  assert.deepEqual(rows, original);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.facilities[0], { itemId: "5000000001", typeId: 87119, status: 2, production: null, snapshot: {
    owner_id: "140001", solar_system_id: "30002479", blueprint_id: "1007", run_time: "12",
    inputs: [{ type_id: "95345", quantity: "5" }], outputs: [{ type_id: "83463", quantity: "7" }],
    blueprint_inputs: [{ type_id: "95345", quantity: "1", max_quantity: "400" }],
    blueprint_outputs: [{ type_id: "83463", quantity: "1", max_quantity: "500" }],
  } });
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

function chainFixture(industryPackageId?: string, industryTypeOrigin?: string) {
  const world = { packageId: address(80), objectRegistryId: address(81), adminAclId: address(82), energyConfigId: address(83), fuelConfigId: address(84) };
  const current = { facility: facility(), fields: null as any, productionField: null as any, executions: [] as any[], apply: true, checks: 0, online: true };
  const assembly: any = { itemId: "5000000001", kind: "assembly", typeId: 87119, ownerId: 140001, solarSystemId: 30002479 };
  const assemblyID = address(100);
  const industryId = deriveSuiIndustryId(world, assemblyID, industryTypeOrigin || industryPackageId || world.packageId);
  const objects = { getObject: async ({ id }: any) => id === deriveSuiIndustryProductionId(industryId)
    ? current.productionField ? { data: { owner: { ObjectOwner: industryId }, content: { dataType: "moveObject",
      type: `0x2::dynamic_field::Field<u8, ${industryPackageId || world.packageId}::smart_industry::ProductionRecord>`, fields: current.productionField } } }
      : { error: { code: "notExists" } }
    : current.fields ? { data: {
    type: `${industryTypeOrigin || industryPackageId || world.packageId}::smart_industry::SmartIndustry`, content: { dataType: "moveObject", fields: current.fields },
  } } : { error: { code: "notExists" } } };
  const chain = { deriveId: () => assemblyID, readAssembly: async () => ({ online: current.online }) };
  const adapter = () => createSuiIndustryChain({ client: objects as any, world, chain, tenant: "dev", industryPackageId, industryTypeOrigin, now: () => 1700000000000,
    assertSnapshotCurrent(expected) { current.checks++; assert.deepEqual(expected, current.facility, "stale snapshot"); },
    async execute(label, tx, ownerId, assertCurrent) {
      assertCurrent?.();
      const data = tx.getData(); current.executions.push({ label, ownerId, data });
      const call = data.commands.at(-1).MoveCall;
      const integer = (argument: any) => Buffer.from((data.inputs[argument.Input] as any).Pure.bytes, "base64").readBigUInt64LE().toString();
      assert.equal(ownerId, undefined, "Only the existing server executor signs mirrors");
      const isSync = call.function === "sync_with_production";
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
        current.productionField = { name: 0, value: { fields: { revision: current.fields.revision, production: { fields: p ? {
          ...p, state: { RUNNING: 1, DISCONTINUING: 2, STOPPED: 3 }[p.state], requested_runs: p.requested_runs ?? "0", stop_reason: p.stop_reason ?? "",
        } : { job_id: "0", state: 0, requested_runs: "0", completed_runs: "0", run_started_at_ms: "0", run_end_at_ms: "0", stop_reason: "" } } } } };
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
  assert.equal(f.current.executions[0].data.commands.at(-1).MoveCall.function, "create_with_production");
  assert.ok(f.current.checks >= 3);
  const result = await f.adapter().status(f.current.facility, f.assembly);
  assert.equal(result.synchronized, true);
  assert.equal(result.industryObjectID, deriveSuiIndustryId(f.world, f.assemblyID));
  await f.adapter().sync(f.current.facility, f.assembly);
  assert.equal(f.current.executions.length, 1);
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
  assert.equal(f.current.executions.at(-1).data.commands.at(-1).MoveCall.function, "sync_with_production");
});

test("upgraded Industry modules retain the original Assembly and sidecar type origin", async () => {
  const f = chainFixture(address(90), address(89));
  await f.adapter().sync(f.current.facility, f.assembly);
  const calls = f.current.executions[0].data.commands.filter((c: any) => c.MoveCall).map((c: any) => c.MoveCall);
  assert.ok(calls.every((call: any) => call.package === address(90)));
  const vectors = f.current.executions[0].data.commands.filter((c: any) => c.MakeMoveVec).map((c: any) => c.MakeMoveVec);
  assert.ok(vectors.every((vector: any) => vector.type.startsWith(`${address(89)}::smart_industry::`)));
  const status = await f.adapter().status(f.current.facility, f.assembly);
  assert.equal(status.assemblyObjectID, f.assemblyID);
  assert.equal(status.industryObjectID, deriveSuiIndustryId(f.world, f.assemblyID, address(89)));
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
  const old = await adapter.status(f.current.facility, f.assembly);
  assert.equal(old.synchronized, false);
  assert.equal(old.productionMirrored, false);
  assert.equal(old.chainProduction, null);
  f.current.apply = false;
  await assert.rejects(adapter.sync(f.current.facility, f.assembly), /not confirmed/);
  f.current.apply = true;
  await adapter.sync(f.current.facility, f.assembly);
  f.current.productionField.value.fields.revision = "999";
  await assert.rejects(adapter.status(f.current.facility, f.assembly), /revision changed/);
  f.current.productionField.value.fields.revision = f.current.fields.revision;
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
      return { synchronized: true, productionMirrored: true, chainProduction: null, industryObjectID: address(111), assemblyObjectID: address(112) };
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
      return { synchronized: true, productionMirrored: true, chainProduction: null, industryObjectID: address(111), assemblyObjectID: address(112) };
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

test("Industry HTTP routes expose wallet auth and facility status/sync with origin protection", () => {
  const routes: string[] = []; const middlewares: any[] = [];
  mountSmartIndustryEndpoints({ use: (_path: string, callback: any) => middlewares.push(callback), post: (route: string) => routes.push(route) }, { api: {} });
  assert.deepEqual(routes, ["/evejs/industry/auth/challenge", "/evejs/industry/auth/session", "/evejs/industry/:facilityID/status", "/evejs/industry/:facilityID/sync"]);
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
