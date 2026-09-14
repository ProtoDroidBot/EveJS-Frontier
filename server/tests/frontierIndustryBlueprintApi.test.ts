import assert from "node:assert/strict";
import test from "node:test";
import { createSmartIndustryApi, mountSmartIndustryEndpoints } from "../src/_secondary/express/smartIndustryEndpoints";

const { getBlueprintForFacility } = require("../src/services/frontier/industryBlueprints");
const CURRENT = getBlueprintForFacility(87119, 1007);
const TARGET = getBlueprintForFacility(87119, 1005);
const ID = "11111111-1111-4111-8111-111111111111";
const NEXT_ID = "22222222-2222-4222-8222-222222222222";
const slots = entries => Object.values<any>(entries).map(slot => ({ type_id: String(slot.type_id),
  quantity: String(slot.quantity_per_run), max_quantity: String(slot.max_storable_quantity) }));
const expected = { requestID: ID, expectedBlueprintID: "1007", expectedBlueprintHash: CURRENT.content_hash, expectedJobID: null };
const change = { ...expected, blueprintID: "1005", blueprintHash: TARGET.content_hash };
const empty = { ...expected, storageUnitID: "200" };
const chain = { status: "synced", industryStatus: "synced", storageStatus: "synced" };

function fixture(overrides: Record<string, any> = {}) {
  const session = { characterID: 1 };
  const state = { live: true, owner: 1, walletAddress: "0x1", session, loads: [] as any[], empties: [] as any[],
    notified: [] as any[], transfers: 0, facility: { itemId: "100", typeId: 87119, status: 2, production: null as any,
      snapshot: { owner_id: "1", solar_system_id: "30002479", blueprint_id: "1007", run_time: "12",
        inputs: [] as any[], outputs: [] as any[], blueprint_inputs: slots(CURRENT.inputs), blueprint_outputs: slots(CURRENT.outputs) } } };
  const api = createSmartIndustryApi({
    auth: { authenticate: () => state.live ? { success: true, data: {
      characterID: state.owner, walletAddress: state.walletAddress, session: state.session,
    } } : { success: false, errorMsg: "AUTH_EXPIRED" } },
    readFacility: () => structuredClone(state.facility),
    validateFacility: () => ({ success: true }), settleProduction: () => ({ success: true }),
    loadBlueprint: (...args) => {
      state.loads.push(args);
      const target = getBlueprintForFacility(state.facility.typeId, args[2]);
      Object.assign(state.facility.snapshot, { blueprint_id: String(target.blueprint_id), run_time: String(target.run_time),
        blueprint_inputs: slots(target.inputs), blueprint_outputs: slots(target.outputs) });
      return { success: true, data: target };
    },
    emptyActiveBlueprint: async (...args) => {
      const allowed = args[3].assertAccess();
      if (!allowed.success) return allowed;
      state.empties.push(args);
      const itemsBySide = Object.fromEntries(["inputs", "outputs"].map(side => [side,
        Object.fromEntries(state.facility.snapshot[side].map(item => [item.type_id, Number(item.quantity)]))]));
      state.facility.snapshot.inputs = []; state.facility.snapshot.outputs = [];
      return { success: true, data: { itemsBySide, chain } };
    },
    publishBlueprint: (...args) => state.notified.push(args),
    publishTransfer: (...args) => state.notified.push(args),
    flushChain: async request => ({ ...request, status: "disabled" }),
    depositItems: () => { state.transfers++; return { success: true, data: { chain } }; },
    readStorageRows: () => [{ itemID: 300, stacksize: 100 }],
    ...overrides,
  });
  return { api, state };
}

test("Industry blueprint catalog uses authored facility-specific recipes and requires live access", async () => {
  const f = fixture();
  const result = await f.api.blueprints("token", 100);
  assert.equal(result.success, true);
  const target = result.data.blueprints.find(blueprint => blueprint.blueprintID === "1005");
  assert.deepEqual({ ...target, name: "name" }, { blueprintID: "1005", blueprintHash: TARGET.content_hash, name: "name",
    runTime: String(TARGET.run_time), inputs: slots(TARGET.inputs), outputs: slots(TARGET.outputs) });
  assert.equal(typeof target.name, "string");
  assert.equal(result.data.blueprints.some(blueprint => blueprint.blueprintID === "1234"), false);
  f.state.live = false;
  assert.equal((await f.api.blueprints("token", 100)).errorMsg, "AUTH_EXPIRED");
  const denied = fixture({ validateFacility: () => ({ success: false, errorMsg: "FACILITY_OUT_OF_RANGE" }),
    listBlueprints: () => assert.fail("must not list") });
  assert.equal((await denied.api.blueprints("token", 100)).errorMsg, "FACILITY_OUT_OF_RANGE");
});

test("Changing an empty active blueprint returns the selected recipe and one durable receipt", async () => {
  const f = fixture();
  const [first, repeat] = await Promise.all([f.api.blueprint("token", 100, change), f.api.blueprint("token", 100, change)]);
  assert.deepEqual(first, repeat);
  assert.equal(first.data.gameCommitted, true);
  assert.equal(first.data.requestID, ID);
  assert.equal(first.data.selectedBlueprintID, "1005");
  assert.equal(first.data.facility.snapshot.blueprint_id, "1005");
  assert.equal(first.data.blueprintHash, TARGET.content_hash);
  assert.equal(first.data.chain.status, "disabled");
  assert.equal(f.state.loads.length, 1);
  assert.equal(f.state.notified.length, 1);
  assert.equal((await f.api.blueprint("token", 100, change)).data.gameCommitted, true);
  assert.equal(f.state.loads.length, 1);
});

test("A facility without a blueprint accepts the explicit zero/null precondition", async () => {
  const f = fixture();
  Object.assign(f.state.facility.snapshot, { blueprint_id: "0", run_time: "0", blueprint_inputs: [], blueprint_outputs: [] });
  const result = await f.api.blueprint("token", 100, { ...change, expectedBlueprintID: "0", expectedBlueprintHash: null });
  assert.equal(result.data.gameCommitted, true);
  assert.equal(f.state.loads.length, 1);
});

test("Blueprint changes reject stored inputs or outputs, unavailable recipes and stale hashes", async () => {
  for (const side of ["inputs", "outputs"]) {
    const f = fixture(); f.state.facility.snapshot[side].push({ type_id: "34", quantity: "1" });
    assert.equal((await f.api.blueprint("token", 100, change)).errorMsg, "FACILITY_CONTAINS_ITEMS");
    assert.equal(f.state.loads.length, 0);
  }
  for (const [update, errorMsg] of [
    [{ blueprintID: "1234" }, "BLUEPRINT_NOT_FOUND"], [{ blueprintHash: "0".repeat(64) }, "INVALID_BLUEPRINT_HASH"],
  ] as const) {
    const f = fixture();
    assert.equal((await f.api.blueprint("token", 100, { ...change, ...update })).errorMsg, errorMsg);
    assert.equal(f.state.loads.length, 0);
  }
});

test("Empty active blueprint moves every input and output to the chosen SSU exactly once", async () => {
  const f = fixture();
  f.state.facility.snapshot.inputs = [{ type_id: "34", quantity: "9" }, { type_id: "35", quantity: "4" }];
  f.state.facility.snapshot.outputs = [{ type_id: "34", quantity: "2" }];
  const [first, repeat] = await Promise.all([f.api.empty("token", 100, empty), f.api.empty("token", 100, empty)]);
  assert.deepEqual(first, { success: true, data: { requestID: ID, gameCommitted: true, storageUnitID: 200,
    inputs: { 34: 9, 35: 4 }, outputs: { 34: 2 }, chain } });
  assert.deepEqual(first, repeat);
  assert.equal(f.state.empties.length, 1);
  assert.equal(f.state.notified.length, 1);
  assert.equal(f.state.empties[0][2], 200);
  const changed = await f.api.blueprint("token", 100, { ...change, requestID: NEXT_ID });
  assert.equal(changed.data.selectedBlueprintID, "1005");
});

test("Malformed blueprint requests are rejected before any inventory or blueprint mutation", async () => {
  for (const update of [{ requestID: "bad" }, { expectedBlueprintID: "01" }, { expectedBlueprintID: "-1" },
    { expectedBlueprintID: "0" }, { expectedBlueprintHash: null }, { expectedBlueprintHash: "bad" },
    { expectedJobID: "0" }, { expectedJobID: undefined }, { blueprintID: "9007199254740992" }, { blueprintHash: "bad" }]) {
    const f = fixture();
    assert.equal((await f.api.blueprint("token", 100, { ...change, ...update })).success, false);
    assert.equal(f.state.loads.length, 0);
  }
  const f = fixture();
  for (const storageUnitID of ["0", "200/path", "1.5", "9007199254740992"]) {
    assert.equal((await f.api.empty("token", 100, { ...empty, storageUnitID })).errorMsg, "INVALID_ASSEMBLY_ID");
  }
  assert.equal(f.state.empties.length, 0);
});

test("Expected blueprint, hash and production job guard both operations before mutation", async () => {
  for (const action of ["empty", "blueprint"] as const) {
    for (const [update, errorMsg] of [
      [{ expectedBlueprintID: "1005" }, "BLUEPRINT_CHANGED"],
      [{ expectedBlueprintHash: "0".repeat(64) }, "BLUEPRINT_CHANGED"],
      [{ expectedJobID: "1" }, "PRODUCTION_CHANGED"],
    ] as const) {
      const f = fixture();
      assert.equal((await f.api[action]("token", 100, { ...(action === "empty" ? empty : change), ...update })).errorMsg, errorMsg);
      assert.equal(f.state.loads.length + f.state.empties.length, 0);
    }
    const f = fixture(); f.state.facility.production = { job_id: "1", state: "RUNNING" };
    assert.equal((await f.api[action]("token", 100, { ...(action === "empty" ? empty : change), expectedJobID: "1" })).errorMsg,
      "PRODUCTION_ALREADY_RUNNING");
    assert.equal(f.state.loads.length + f.state.empties.length, 0);
  }
});

test("Expected state and live session are rechecked after production settling and asynchronous storage checks", async () => {
  const f = fixture({ settleProduction: () => { f.state.facility.production = { job_id: "1", state: "STOPPED" }; return { success: true }; } });
  assert.equal((await f.api.blueprint("token", 100, change)).errorMsg, "PRODUCTION_CHANGED");
  assert.equal(f.state.loads.length, 0);
  for (const update of [state => { state.facility.snapshot.blueprint_id = "1005"; },
    state => { state.session = { characterID: 1 }; }, state => { state.live = false; }]) {
    const delayed = fixture({ emptyActiveBlueprint: async (_session, _id, _storage, options) => {
      update(delayed.state);
      return options.assertAccess();
    } });
    assert.equal((await delayed.api.empty("token", 100, empty)).success, false);
    assert.equal(delayed.state.empties.length, 0);
  }
});

test("Changed and cross-action request IDs cannot replay a blueprint, empty or ordinary transfer", async () => {
  const f = fixture();
  assert.equal((await f.api.empty("token", 100, empty)).data.gameCommitted, true);
  assert.equal((await f.api.empty("token", 100, { ...empty, storageUnitID: "201" })).errorMsg, "INDUSTRY_REQUEST_CHANGED");
  assert.equal((await f.api.blueprint("token", 100, change)).errorMsg, "INDUSTRY_REQUEST_CHANGED");
  const transfer = { requestID: ID, storageUnitID: "200", direction: "deposit", side: "inputs", typeID: "34", quantity: "1" };
  assert.equal((await f.api.transfer("token", 100, transfer)).errorMsg, "TRANSFER_REQUEST_CHANGED");
  assert.equal(f.state.transfers, 0);
  const g = fixture();
  assert.equal((await g.api.transfer("token", 100, transfer)).data.gameCommitted, true);
  assert.equal((await g.api.empty("token", 100, empty)).errorMsg, "INDUSTRY_REQUEST_CHANGED");
  assert.equal(g.state.empties.length, 0);
});

test("Committed blueprint and empty receipts survive notification, auth and synchronization failures", async () => {
  const f = fixture({ publishBlueprint: () => { throw new Error("private notice error"); },
    flushChain: () => { f.state.live = false; throw new Error("private sync error"); } });
  const result = await f.api.blueprint("token", 100, change);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.facility.snapshot.blueprint_id, "1005");
  assert.equal(result.data.chain.status, "pending");
  assert.equal(JSON.stringify(result).includes("private"), false);
  const g = fixture({ publishTransfer: () => { throw new Error("private notice error"); } });
  assert.equal((await g.api.empty("token", 100, empty)).data.gameCommitted, true);
  assert.equal((await g.api.empty("token", 100, empty)).data.gameCommitted, true);
  assert.equal(g.state.empties.length, 1);
});

test("A later blueprint change during chain confirmation cannot replace an earlier operation's receipt", async () => {
  const f = fixture({ flushChain: request => {
    f.state.facility.snapshot.blueprint_id = "1007";
    return { ...request, status: "disabled" };
  } });
  const result = await f.api.blueprint("token", 100, change);
  assert.equal(result.data.selectedBlueprintID, "1005");
  assert.equal(result.data.facility.snapshot.blueprint_id, "1005");
  assert.equal(result.data.blueprintHash, TARGET.content_hash);
  assert.equal(result.data.chain.status, "pending");
});

test("Industry blueprint HTTP routes expose the agreed payloads and conflict status", async () => {
  const routes = new Map<string, any>(); const calls: any[] = [];
  mountSmartIndustryEndpoints({ use() {}, post: (path, handler) => routes.set(path, handler) }, { api: {
    blueprints: (...args) => { calls.push(args); return { success: true, data: { blueprints: [] } }; },
    blueprint: (...args) => { calls.push(args); return { success: false, errorMsg: "FACILITY_CONTAINS_ITEMS" }; },
    empty: (...args) => { calls.push(args); return { success: true, data: {} }; },
  } });
  const statuses: number[] = [];
  const response = { status(code) { statuses.push(code); return this; }, json() {} };
  for (const action of ["blueprints", "blueprint", "empty"]) {
    await routes.get(`/evejs/industry/:facilityID/${action}`)({ headers: { authorization: "token" }, params: { facilityID: "100" }, body: change }, response);
  }
  assert.deepEqual(statuses, [200, 409, 200]);
  assert.deepEqual(calls, [["token", "100"], ["token", "100", change], ["token", "100", change]]);
});
