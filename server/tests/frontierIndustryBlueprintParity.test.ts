"use strict";

// Run through run-isolated-tests.js: this exercises the real disposable item
// table, native Industry RPCs, and the dApp's default facility snapshot reader.
const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const space = require("../src/space/runtime");
const blueprints = require("../src/services/frontier/industryBlueprints");
const industry = require("../src/services/frontier/industryRuntime");
const IndustryService = require("../src/services/frontier/industryService");
const { createSmartIndustryApi } = require("../src/_secondary/express/smartIndustryEndpoints");

const OWNER = 140000003;
const SYSTEM = 30000004;
const FACILITY = 5000000001;
const SHIP = 5000000002;
const OLD_INPUT = 5000000010;
const NEW_INPUTS = [[5000000011, 88335, 115], [5000000012, 89260, 1]];
const CURRENT = blueprints.getBlueprintForFacility(87119, 1560);
const TARGET = blueprints.getBlueprintForFacility(87119, 1013);
const SHIP_TYPE = require("../src/services/chat/shipTypeRegistry").resolveShipByTypeID(95276)?.typeID ?? 606;

function row(itemID, typeID, locationID, flagID, quantity, extra = {}) {
  return { itemID, typeID, locationID, flagID, quantity, stacksize: quantity,
    ownerID: OWNER, singleton: 0, categoryID: 4, groupID: 0, customInfo: "", ...extra };
}

function unpack(value) {
  return value?.type === "dict"
    ? Object.fromEntries(value.entries.map(([key, entry]) => [key, unpack(entry)])) : value;
}

function recipeFromSnapshot(snapshot) {
  const slots = side => Object.fromEntries(snapshot[`blueprint_${side}`].map(slot => [slot.type_id, {
    type_id: Number(slot.type_id), quantity_per_run: Number(slot.quantity),
    max_storable_quantity: Number(slot.max_quantity),
  }]));
  return { blueprint_id: Number(snapshot.blueprint_id), run_time: Number(snapshot.run_time),
    inputs: slots("inputs"), outputs: slots("outputs") };
}

function fixture(t) {
  const previous = itemStore.getAllItems();
  t.after(() => { itemStore._writeItemsForTest(previous); });
  const rows = [
    row(FACILITY, 87119, SYSTEM, 0, 1, { singleton: 1, categoryID: 65,
      customInfo: JSON.stringify({ unrelated: "preserved",
        evejsFrontierConstruction: { assemblyStatus: 2, assemblyTypeID: 87119,
          ownerID: OWNER, solarSystemID: SYSTEM, completedAtMs: 1 },
        evejsFrontierIndustry: { version: 1, blueprintID: CURRENT.blueprint_id } }) }),
    // Use Frontier's ship if the SDE is loaded, or the seed registry's fallback.
    row(SHIP, SHIP_TYPE, SYSTEM, 0, 1, { singleton: 1, categoryID: 6 }),
    row(OLD_INPUT, 84182, SHIP, 5, 30),
    ...NEW_INPUTS.map(([id, type, quantity]) => row(id, type, SHIP, 5, quantity * 2)),
  ];
  assert.equal(itemStore._writeItemsForTest(Object.fromEntries(rows.map(item => [item.itemID, item]))), true);
  const session = { characterID: OWNER, solarsystemid2: SYSTEM, shipid: SHIP, sendNotification() {} };
  t.mock.method(space, "getEntity", (_session, id) => [FACILITY, SHIP].includes(Number(id))
    ? { itemID: Number(id), position: { x: Number(id) === FACILITY ? 100 : 0, y: 0, z: 0 } } : null);
  t.mock.method(space, "getSceneForSession", () => ({ getCommandTimeEntitySurfaceDistance: () => 100 }));
  // Avoid requiring a generated fitting database to resolve this fixture's hold.
  t.mock.method(require("../src/services/frontier/smartStorageUnitRuntime"), "getShipCargoCapacity", () => 1000);
  t.mock.method(require("../src/_secondary/express/publicGatewayLocal"), "publishGatewayNotice", () => true);

  let releaseChain;
  const chainBlocked = new Promise<void>(resolve => { releaseChain = resolve; });
  t.after(() => releaseChain());
  let reachedChain;
  const commitReached = new Promise<void>(resolve => { reachedChain = resolve; });
  const api = createSmartIndustryApi({
    auth: { authenticate: () => ({ success: true, data: { characterID: OWNER, walletAddress: "0x1", session } }) },
    readChain: request => ({ ...request, status: "pending" }),
    flushChain: async request => { reachedChain(); await chainBlocked; return { ...request, status: "pending" }; },
  });
  const service = new IndustryService();
  return { api, service, session, commitReached, releaseChain,
    native: () => unpack(service.Handle_get_facility_details([FACILITY], session)),
  };
}

test("dApp blueprint commit updates native details and accepts the new inputs while chain sync is pending", async t => {
  const f = fixture(t);
  const requestedItems = Object.fromEntries(NEW_INPUTS.map(([id, _type, quantity]) => [id, quantity]));
  assert.equal(f.native().blueprint.blueprint_id, 1560);
  assert.equal(f.native().blueprint.run_time, 90);
  const before = itemStore.getAllItems();
  assert.equal(industry.depositInputItems(f.session, FACILITY, requestedItems).errorMsg, "INVALID_INPUT_TYPE",
    "selecting or queueing a target recipe does not change the still-active recipe");
  assert.deepEqual(itemStore.getAllItems(), before);

  const changing = f.api.blueprint("token", FACILITY, {
    requestID: "11111111-1111-4111-8111-111111111111",
    expectedBlueprintID: "1560", expectedBlueprintHash: CURRENT.content_hash, expectedJobID: null,
    blueprintID: "1013", blueprintHash: TARGET.content_hash,
  });
  // The real loadBlueprint has committed, but the dApp response is still waiting
  // on blockchain synchronization. Native reads and deposits must already work.
  const boundary = await Promise.race([
    f.commitReached.then(() => "committed"), changing.then(result => ({ unexpectedEarlyResult: result })),
  ]);
  assert.equal(boundary, "committed");
  const status = await f.api.status("token", FACILITY);
  assert.equal(status.success, true, status.errorMsg);
  assert.equal(status.data.chain.status, "pending");
  assert.equal(status.data.facility.snapshot.blueprint_id, "1013");
  assert.equal(status.data.facility.snapshot.run_time, "10");
  assert.equal(status.data.blueprintHash, TARGET.content_hash);
  assert.deepEqual(f.native().blueprint, recipeFromSnapshot(status.data.facility.snapshot));

  const deposited = await f.service.Handle_deposit_input_items([FACILITY, requestedItems], f.session);
  assert.deepEqual(unpack(deposited[0]), { 88335: 115, 89260: 1 });
  const afterDeposit = itemStore.getAllItems();
  assert.equal(industry.depositInputItems(f.session, FACILITY, { [OLD_INPUT]: 1 }).errorMsg, "INVALID_INPUT_TYPE",
    "inputs that only belonged to the previous blueprint are rejected immediately after commit");
  assert.deepEqual(itemStore.getAllItems(), afterDeposit);

  const after = await f.api.status("token", FACILITY);
  assert.equal(after.data.chain.status, "pending");
  assert.deepEqual(after.data.facility.snapshot.inputs, [
    { type_id: "88335", quantity: "115" }, { type_id: "89260", quantity: "1" },
  ]);
  assert.deepEqual(f.native().items.inputs, { 88335: 115, 89260: 1 });
  for (const [id, _type, quantity] of NEW_INPUTS) assert.equal(itemStore.findItemById(id).stacksize, quantity);
  assert.equal(itemStore.findItemById(OLD_INPUT).stacksize, 30);
  assert.equal(JSON.parse(itemStore.findItemById(FACILITY).customInfo).unrelated, "preserved");

  f.releaseChain();
  const receipt = await changing;
  assert.equal(receipt.success, true, receipt.errorMsg);
  assert.equal(receipt.data.gameCommitted, true);
  assert.equal(receipt.data.selectedBlueprintID, "1013");
  assert.equal(receipt.data.chain.status, "pending");
  assert.deepEqual(f.native().blueprint, recipeFromSnapshot(receipt.data.facility.snapshot));
});
