"use strict";

// Run through run-isolated-tests.js. These fixtures need no generated SDE or
// pre-existing characters and exercise the real item-table transaction path.
const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const database = require("../src/gameStore");
const space = require("../src/space/runtime");
const blueprints = require("../src/services/frontier/industryBlueprints");
const inventory = require("../src/services/frontier/industryRuntime");
const production = require("../src/services/frontier/industryProduction");

const OWNER = 140000003;
const SYSTEM = 30000004;
const FACILITY = 5000000001;
const SHIP = 5000000002;
const START = 1700000000000;
const RECIPE = blueprints.getBlueprintForFacility(87119, 1026);

function row(itemID, typeID, locationID, flagID, quantity, extra = {}) {
  return { itemID, typeID, locationID, flagID, quantity, stacksize: quantity,
    ownerID: OWNER, singleton: 0, categoryID: 4, groupID: 0, customInfo: "", ...extra };
}

function fixture(t, runs = 3, outputQuantity = 0) {
  const previous = itemStore.getAllItems();
  t.after(() => { itemStore._writeItemsForTest(previous); });
  const facility = row(FACILITY, 87119, SYSTEM, 0, 1, { singleton: 1, categoryID: 65,
    customInfo: JSON.stringify({ unrelated: "preserved",
      evejsFrontierConstruction: { assemblyStatus: 2, assemblyTypeID: 87119,
        ownerID: OWNER, solarSystemID: SYSTEM, completedAtMs: 1 },
      evejsFrontierIndustry: { version: 1, blueprintID: 1026 } }) });
  const ship = row(SHIP, 95276, SYSTEM, 0, 1, { singleton: 1, categoryID: 6 });
  const rows = [facility, ship];
  if (runs > 0) rows.push(row(5000000011, 77803, FACILITY, 20000, 45 * runs),
    row(5000000012, 83894, FACILITY, 20000, runs));
  if (outputQuantity) rows.push(row(5000000013, 83895, FACILITY, 20001, outputQuantity));
  assert.equal(itemStore._writeItemsForTest(Object.fromEntries(rows.map(item => [item.itemID, item]))), true);
  const access = { distance: 100 };
  const session = { characterID: OWNER, solarsystemid2: SYSTEM, shipid: SHIP, sendNotification() {} };
  t.mock.method(space, "getEntity", (_session, id) => [FACILITY, SHIP].includes(id)
    ? { itemID: id, position: { x: id === FACILITY ? 100 : 0, y: 0, z: 0 } } : null);
  t.mock.method(space, "getSceneForSession", () => ({ getCommandTimeEntitySurfaceDistance: () => access.distance }));
  return {
    session, access,
    start: (count: any = 3, nowMs = START) => production.startProduction(session, FACILITY, 1026, RECIPE.content_hash, count, { nowMs }),
    tick: (nowMs: number) => production.advanceProduction(FACILITY, { nowMs }),
    stop: (nowMs = START + 1000) => production.discontinueProduction(session, FACILITY, { nowMs }),
    state: () => production.getProduction(itemStore.findItemById(FACILITY)),
    items: () => inventory.getFacilityItems(itemStore.findItemById(FACILITY)),
    snapshot: () => itemStore.getAllItems(),
  };
}

function ok(result) { assert.equal(result.success, true, result.errorMsg); return result.data; }

test("starting consumes exactly one run; outputs appear only at each deadline and finite runs finish", t => {
  const f = fixture(t);
  ok(f.start());
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 }, outputs: {} });
  assert.equal(f.state().completedRuns, 0);
  assert.equal(f.state().runEndAtMs, START + 3000);
  ok(f.tick(START + 2999));
  assert.deepEqual(f.items().outputs, {});
  ok(f.tick(START + 3000));
  assert.deepEqual(f.items(), { inputs: { 77803: 45, 83894: 1 }, outputs: { 83895: 1 } });
  assert.equal(f.state().completedRuns, 1);
  assert.equal(f.state().state, "RUNNING");
  ok(f.tick(START + 6000));
  assert.deepEqual(f.items(), { inputs: {}, outputs: { 83895: 2 } });
  ok(f.tick(START + 9000));
  assert.deepEqual(f.items(), { inputs: {}, outputs: { 83895: 3 } });
  assert.equal(f.state().completedRuns, 3);
  assert.equal(f.state().state, "STOPPED");
  assert.equal(JSON.parse(itemStore.findItemById(FACILITY).customInfo).unrelated, "preserved");
  const completed = f.snapshot();
  ok(f.tick(START + 12000));
  assert.deepEqual(f.snapshot(), completed, "repeated completion never duplicates products");
});

test("a delayed tick and a freshly loaded runtime recover multiple runs from persisted deadlines", t => {
  const f = fixture(t);
  ok(f.start());
  const modulePath = require.resolve("../src/services/frontier/industryProduction");
  delete require.cache[modulePath];
  const recovered = require(modulePath);
  ok(recovered.advanceProduction(FACILITY, { nowMs: START + 12000 }));
  assert.equal(f.state().completedRuns, 3);
  assert.equal(f.state().state, "STOPPED");
  assert.deepEqual(f.items(), { inputs: {}, outputs: { 83895: 3 } });
  ok(recovered.advanceProduction(FACILITY, { nowMs: START + 12000 }));
  assert.deepEqual(f.items().outputs, { 83895: 3 });
});

test("the background worker resumes a real persisted job and completes it without another client RPC", t => {
  const f = fixture(t);
  ok(f.start());
  const { createIndustryProductionWorker } = require("../src/services/frontier/industryProductionWorker");
  let nowMs = START;
  let callback;
  const worker = createIndustryProductionWorker({ now: () => nowMs,
    setInterval: tick => { callback = tick; return { unref() {} }; },
    clearInterval() {}, publishResult() {} });
  t.after(() => worker.stop());
  worker.start();
  for (const offset of [3000, 6000, 9000]) {
    nowMs = START + offset;
    callback();
  }
  assert.equal(f.state().state, "STOPPED");
  assert.equal(f.state().completedRuns, 3);
  assert.deepEqual(f.items(), { inputs: {}, outputs: { 83895: 3 } });
});

test("discontinue finishes the paid run and leaves later-run materials untouched", t => {
  const f = fixture(t);
  ok(f.start());
  ok(f.stop());
  assert.equal(f.state().state, "DISCONTINUING");
  assert.deepEqual(f.items().outputs, {});
  ok(f.tick(START + 30000));
  assert.equal(f.state().state, "STOPPED");
  assert.equal(f.state().completedRuns, 1);
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 }, outputs: { 83895: 1 } });
});

test("continuous production stops on missing inputs; finite run count never overproduces", t => {
  const f = fixture(t, 2);
  ok(f.start(null));
  ok(f.tick(START + 15000));
  assert.equal(f.state().requestedRuns, null);
  assert.equal(f.state().completedRuns, 2);
  assert.equal(f.state().state, "STOPPED");
  assert.deepEqual(f.items(), { inputs: {}, outputs: { 83895: 2 } });
});

test("output capacity stops the next run before consuming its inputs", t => {
  const f = fixture(t, 3, RECIPE.outputs[83895].max_storable_quantity - 1);
  ok(f.start());
  ok(f.tick(START + 10000));
  assert.equal(f.state().completedRuns, 1);
  assert.equal(f.state().state, "STOPPED");
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 },
    outputs: { 83895: RECIPE.outputs[83895].max_storable_quantity } });
});

test("rejected starts and duplicate starts preserve inventory and the existing job", t => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const runs of [0, -1, 1.5, NaN, Infinity, true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(f.start(runs).success, false, String(runs));
    assert.deepEqual(f.snapshot(), before);
  }
  assert.equal(production.startProduction(f.session, FACILITY, 1026, "incorrect", 1, { nowMs: START }).success, false);
  f.session.characterID++;
  assert.equal(f.start().success, false);
  f.session.characterID--;
  f.access.distance = 6000;
  assert.equal(f.start().success, false);
  f.access.distance = 100;
  assert.deepEqual(f.snapshot(), before);
  ok(f.start());
  const running = f.snapshot();
  assert.equal(f.start().success, false);
  assert.deepEqual(f.snapshot(), running);
  assert.equal(inventory.loadBlueprint(f.session, FACILITY, 1027).success, false);
});

test("input shortage rejects without consuming any input", t => {
  const f = fixture(t, 0);
  const empty = f.snapshot();
  assert.equal(f.start().success, false);
  assert.deepEqual(f.snapshot(), empty);
});

test("initially full output rejects without consuming any input", t => {
  const f = fixture(t, 3, RECIPE.outputs[83895].max_storable_quantity);
  const full = f.snapshot();
  assert.equal(f.start().success, false);
  assert.deepEqual(f.snapshot(), full);
});

test("one run consumes split input stacks exactly and stops despite surplus materials", t => {
  const f = fixture(t, 3);
  const items = f.snapshot();
  items[5000000011].quantity = items[5000000011].stacksize = 20;
  items[5000000021] = row(5000000021, 77803, FACILITY, 20000, 115);
  assert.equal(itemStore._writeItemsForTest(items), true);
  ok(f.start(1));
  assert.equal(itemStore.findItemById(5000000011), null);
  assert.equal(itemStore.findItemById(5000000021).stacksize, 90);
  ok(f.tick(START + 3000));
  assert.equal(f.state().completedRuns, 1);
  assert.equal(f.state().state, "STOPPED");
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 }, outputs: { 83895: 1 } });
  ok(f.start(1, START + 4000));
  assert.equal(f.state().jobID, 2);
  ok(f.tick(START + 7000));
  assert.deepEqual(f.items(), { inputs: { 77803: 45, 83894: 1 }, outputs: { 83895: 2 } });
});

test("a changed authored recipe completes the original paid products and stops", t => {
  const f = fixture(t);
  ok(f.start());
  const changed = structuredClone(RECIPE);
  changed.outputs[83895].quantity_per_run = 2;
  changed.content_hash = blueprints.getBlueprintContentHash(changed);
  t.mock.method(blueprints, "getSelectedBlueprint", () => changed);
  ok(f.tick(START + 3000));
  assert.equal(f.state().state, "STOPPED");
  assert.equal(f.state().stopReason, "BLUEPRINT_CHANGED");
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 }, outputs: { 83895: 1 } });
});

test("corrupt active progress cannot produce an extra run or change its blueprint", t => {
  const f = fixture(t);
  ok(f.start(1));
  ok(itemStore.updateInventoryItem(FACILITY, item => {
    const info = JSON.parse(item.customInfo);
    info.evejsFrontierIndustry.production.completedRuns = 1;
    return { ...item, customInfo: JSON.stringify(info) };
  }));
  const corrupt = f.snapshot();
  assert.equal(f.tick(START + 3000).success, false);
  assert.equal(inventory.loadBlueprint(f.session, FACILITY, 1027).success, false);
  assert.deepEqual(f.snapshot(), corrupt);
});

test("chain snapshots reflect consumption, production progress, discontinuation, and finished items", t => {
  const f = fixture(t);
  const { buildSuiIndustrySnapshot } = require("../src/services/frontier/suiIndustrySnapshot");
  const snapshot = () => {
    const result = buildSuiIndustrySnapshot(f.snapshot());
    assert.deepEqual(result.errors, []);
    return result.facilities[0];
  };
  assert.equal(snapshot().production, null);
  ok(f.start());
  assert.deepEqual(snapshot().production, { job_id: "1", state: "RUNNING", requested_runs: "3",
    completed_runs: "0", run_started_at_ms: String(START), run_end_at_ms: String(START + 3000), stop_reason: null });
  assert.deepEqual(snapshot().snapshot.inputs, [{ type_id: "77803", quantity: "90" }, { type_id: "83894", quantity: "2" }]);
  ok(f.tick(START + 3000));
  assert.equal(snapshot().production.completed_runs, "1");
  assert.deepEqual(snapshot().snapshot.outputs, [{ type_id: "83895", quantity: "1" }]);
  ok(f.stop(START + 4000));
  assert.equal(snapshot().production.state, "DISCONTINUING");
  ok(f.tick(START + 6000));
  assert.equal(snapshot().production.state, "STOPPED");
  assert.equal(snapshot().production.completed_runs, "2");
  assert.equal(snapshot().production.stop_reason, "DISCONTINUED");
  assert.deepEqual(snapshot().snapshot.outputs, [{ type_id: "83895", quantity: "2" }]);
});

test("offline facilities reject starts and stop after an already paid run", t => {
  const f = fixture(t);
  const status = value => ok(itemStore.updateInventoryItem(FACILITY, item => {
    const info = JSON.parse(item.customInfo); info.evejsFrontierConstruction.assemblyStatus = value;
    return { ...item, customInfo: JSON.stringify(info) };
  }));
  status(1);
  const offline = f.snapshot();
  assert.equal(f.start().success, false);
  assert.deepEqual(f.snapshot(), offline);
  status(2);
  ok(f.start());
  status(1);
  ok(f.tick(START + 12000));
  assert.equal(f.state().state, "STOPPED");
  assert.equal(f.state().completedRuns, 1);
  assert.deepEqual(f.items(), { inputs: { 77803: 90, 83894: 2 }, outputs: { 83895: 1 } });
});

test("an offline facility with an unfinished paid run cannot be removed even when escrow is empty", t => {
  const f = fixture(t, 1);
  ok(f.start(1));
  assert.deepEqual(f.items(), { inputs: {}, outputs: {} });
  ok(itemStore.updateInventoryItem(FACILITY, item => {
    const info = JSON.parse(item.customInfo); info.evejsFrontierConstruction.assemblyStatus = 1;
    return { ...item, customInfo: JSON.stringify(info) };
  }));
  const { MAX_ACCOUNT_ROLE } = require("../src/services/account/accountRoleProfiles");
  const { adminRemoveAssembly } = require("../src/services/frontier/deploymentRuntime");
  const before = f.snapshot();
  const result = adminRemoveAssembly({ ...f.session, accountRole: MAX_ACCOUNT_ROLE }, FACILITY);
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "ASSEMBLY_OCCUPIED");
  assert.deepEqual(f.snapshot(), before);
});

test("a failed item-table write rolls back consumption and completion and can retry once", t => {
  const f = fixture(t);
  const original = database.write;
  const fail = () => t.mock.method(database, "write", (table, ...args) => table === "items"
    ? { success: false, errorMsg: "TEST_WRITE_FAILURE" } : original(table, ...args));
  const before = f.snapshot();
  let mock = fail();
  assert.equal(f.start().success, false);
  assert.deepEqual(f.snapshot(), before);
  mock.mock.restore();
  ok(f.start());
  const running = f.snapshot();
  mock = fail();
  assert.equal(f.tick(START + 3000).success, false);
  assert.deepEqual(f.snapshot(), running);
  mock.mock.restore();
  ok(f.tick(START + 3000));
  assert.deepEqual(f.items(), { inputs: { 77803: 45, 83894: 1 }, outputs: { 83895: 1 } });
});
