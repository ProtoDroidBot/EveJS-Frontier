const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { createIndustryProductionWorker } = require("../src/services/frontier/industryProductionWorker");
const { publishIndustryProductionChanged, publishIndustryProductionResult } = require("../src/services/frontier/industryNotifications");

test("worker recovers persisted jobs without a client and advances on recurring ticks", () => {
  let nowMs = 1000;
  let scanned = 0;
  let callback = null;
  let cleared = null;
  const handle = { unref() {} };
  const facility = { itemID: 123, production: { state: "RUNNING", completedRuns: 0 } };
  const calls = [];
  const notices = [];
  const worker = createIndustryProductionWorker({
    // The production item store returns an object keyed by item ID.
    getAllItems: () => { scanned++; return { 123: facility, 456: { itemID: 456 } }; },
    getProduction: item => item.production,
    now: () => nowMs,
    advanceProduction: (facilityID, options) => {
      calls.push([facilityID, options.nowMs]);
      if (options.nowMs >= 2000) facility.production = { state: "STOPPED", completedRuns: 3 };
      return { success: true, data: { facility, production: facility.production, changes: [], events: [] } };
    },
    publishResult: (result, session) => notices.push([result, session]),
    setInterval: (fn, interval) => { callback = fn; assert.equal(interval, 250); return handle; },
    clearInterval: value => { cleared = value; },
  });
  assert.equal(scanned, 0, "requiring/constructing a worker must not read or advance live state");
  worker.start();
  worker.start();
  assert.equal(scanned, 1);
  assert.deepEqual(calls, [[123, 1000]]);
  nowMs = 2000;
  callback();
  callback();
  assert.deepEqual(calls, [[123, 1000], [123, 2000]], "stopped jobs leave the recurring active set");
  assert.ok(notices.every(([, session]) => session === null), "completion does not need an online owner");
  worker.stop();
  assert.equal(cleared, handle);
});

test("worker isolates failed facilities and publishes committed catch-up progress", () => {
  const published = [];
  const attempted = [];
  const facilities = [{ itemID: 1, state: "RUNNING" }, { itemID: 2, state: "RUNNING" }];
  const worker = createIndustryProductionWorker({
    getProduction: item => item,
    now: () => 3000,
    advanceProduction: id => {
      attempted.push(id);
      if (id === 1) throw new Error("temporary failure");
      return { success: false, errorMsg: "WRITE_ERROR", data: { facility: facilities[1], changes: [{ item: {} }], events: [] } };
    },
    publishResult: result => published.push(result),
  });
  facilities.forEach(worker.track);
  worker.tick();
  worker.tick();
  assert.deepEqual(attempted, [1, 2, 1, 2]);
  assert.equal(published.length, 2);
  assert.equal(published[0].data.changes.length, 1);
});

test("production notices match client descriptor fields and timestamp precision", () => {
  const calls = [];
  const options = { publishGatewayNotice: (...args) => calls.push(args) };
  assert.equal(publishIndustryProductionChanged({ characterID: 42 }, 123, {
    type: "started", production: { runStartedAtMs: 1001, runEndAtMs: 2500 },
  }, options), true);
  assert.equal(calls[0][0], "eve_public.industry.api.ProductionStartedNotice");
  // facility=1; start_time=2 and end_time=3; Timestamp seconds=1, nanos=2.
  assert.equal(calls[0][1].toString("hex"), "0a02087b1206080110c0843d1a0808021080cab5ee01");
  assert.deepEqual(calls[0][2], { character: 42 });
  assert.equal(publishIndustryProductionChanged({ charid: 42 }, 123, {
    type: "stopped", production: { stopReason: "INSUFFICIENT_INPUTS" },
  }, options), true);
  assert.equal(calls[1][0], "eve_public.industry.api.ProductionStoppedNotice");
  assert.equal(calls[1][1].toString("hex"), "0a02087b1005");
  assert.equal(publishIndustryProductionChanged({ charid: 42 }, 123, {
    type: "started", production: { runStartedAtMs: 1001, runEndAtMs: 1001 },
  }, options), false);
});

test("background production sends inventory updates to owners and full changed-side snapshots", () => {
  const ownerSession = { characterID: 42 };
  const otherSession = { characterID: 99 };
  const calls = [];
  const inventory = [];
  const item = { itemID: 8, locationID: 123, flagID: 20001, typeID: 34, stacksize: 4 };
  publishIndustryProductionResult({ success: true, data: {
    facility: { itemID: 123, ownerID: 42 },
    changes: [{ item, previousData: { ...item, stacksize: 2 } }],
    events: [{ type: "stopped", production: { stopReason: "COMPLETED" } }],
  } }, ownerSession, {
    sessionRegistry: { getSessions: () => [ownerSession, otherSession] },
    itemStore: {},
    runtime: { INDUSTRY_INPUT_FLAG: 20000, INDUSTRY_OUTPUT_FLAG: 20001,
      getFacilityItems: () => ({ inputs: {}, outputs: { 34: 4 } }) },
    emitItemsChangedForSession: (...args) => inventory.push(args),
    publishGatewayNotice: (...args) => calls.push(args),
  });
  assert.equal(inventory.length, 1, "the explicit owner session is deduplicated");
  assert.equal(inventory[0][0], ownerSession);
  assert.deepEqual(calls.map(call => call[0]), [
    "eve_public.industry.api.OutputItemsChangeNotice", "eve_public.industry.api.ProductionStoppedNotice",
  ]);
  assert.ok(calls.every(call => call[2].character === 42));
});

function serviceFixture() {
  const facility = { itemID: 123, ownerID: 42, typeID: 87119, production: null };
  const order = [];
  const session = { characterID: 42 };
  const runtime = {
    canReadFacility: () => true, getItemSolarSystemID: () => 30000001,
    getProduction: item => item.production, getFacilityItems: () => ({ inputs: {}, outputs: {} }),
    startProduction: (...args) => {
      order.push(["start", ...args]);
      return { success: false, errorMsg: "INVALID_BLUEPRINT_HASH" };
    },
    discontinueProduction: (...args) => {
      order.push(["discontinue", ...args]);
      return { success: true, data: { facility, production: { state: "DISCONTINUING", runStartedAtMs: 1001, runEndAtMs: 2500 } } };
    },
  };
  const dependencies = {
    "../baseService": class { constructor(_name) {} },
    "../../utils/logger": { debug() {}, warn() {} },
    "../_shared/serviceHelpers": require("../src/services/_shared/serviceHelpers"),
    "../inventory/itemStore": { findItemById: () => facility },
    "./industryRuntime": runtime,
    "./industryBlueprints": { isIndustryFacilityType: () => true, getSelectedBlueprint: () => null },
    "./industryNotifications": { publishIndustryItemsChanged() {}, publishIndustryProductionResult() {} },
    "./industryProductionWorker": {
      settleIndustryProduction: () => { order.push(["settle"]); return { success: true, data: {} }; },
      trackIndustryProduction() {},
    },
    "../../common/machoErrors": require("../src/common/machoErrors"),
  };
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: name => {
    assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/services/frontier/industryService"), "utf8"), context);
  const Service = context.module.exports as any;
  return { service: new Service(), helpers: Service._testing, facility, runtime, session, order };
}

test("production RPC forwards runs and converts hash failures to the client error class", () => {
  const f = serviceFixture();
  assert.throws(() => f.service.Handle_start_production([123, 1, "bad-hash", 3], f.session), error => {
    const header = error.machoErrorResponse.payload.header;
    assert.equal(header[0].value, "frontier.industry.common.errors.IndustryError");
    assert.equal(header[1][0], "IndustryStartError_InvalidBlueprint");
    return true;
  });
  assert.equal(f.order[0][0], "settle");
  assert.deepEqual(f.order[1].slice(1), [f.session, 123, 1, "bad-hash", 3]);
});

test("discontinue RPC marks the paid run before catch-up and encodes exact Blue times", () => {
  const f = serviceFixture();
  const result = f.service.Handle_discontinue_production([123], f.session);
  assert.deepEqual(f.order.map(entry => entry[0]), ["discontinue"]);
  const fields = Object.fromEntries(result.entries);
  assert.equal(fields.state, "DISCONTINUING");
  assert.equal(fields.start_time.type, "long");
  assert.equal(fields.start_time.value, 116444736010010000n);
  assert.equal(fields.end_time.value, 116444736025000000n);
  const stopped = Object.fromEntries(f.helpers.productionDict({ state: "STOPPED" }).entries);
  assert.equal(stopped.start_time, null);
  assert.equal(stopped.end_time, null);
});
