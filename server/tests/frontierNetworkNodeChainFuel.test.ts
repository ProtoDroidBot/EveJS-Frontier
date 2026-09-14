"use strict";

/** Run with scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");

const itemStore = require("../src/services/inventory/itemStore");
const deployment = require("../src/services/frontier/deploymentRuntime");
const fuelRuntime = require("../src/services/frontier/networkNodeFuelRuntime");

const OWNER_ID = 140000003;
const SOLAR_SYSTEM_ID = 30000004;
const NODE_TYPE_ID = 88092;
const FUEL_D1 = 88335;
const FUEL_D2 = 88319;
const CARGO_FLAG = 5;
const START_MS = 1700000000000;
const DAY_MS = 86400000;
const DEPLOYMENT_KEY = "network-node-chain-fuel-test";
const VALID_SIGNATURE = Buffer.alloc(66, 7).toString("base64");

function grantOne(locationID, flagID, itemType, quantity, options?: any) {
  const result = itemStore.grantItemsToCharacterLocation(
    OWNER_ID, locationID, flagID, [{ itemType, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function createNode(quantity = 150) {
  const node = grantOne(SOLAR_SYSTEM_ID, 0, NODE_TYPE_ID, 1, {
    individualItems: true, singleton: 1,
  });
  const updated = itemStore.updateInventoryItem(node.itemID, (item) => ({
    ...item,
    customInfo: JSON.stringify({
      unrelated: "preserved",
      evejsFrontierConstruction: {
        assemblyStatus: deployment.ASSEMBLY_STATUS_ONLINE,
        assemblyTypeID: NODE_TYPE_ID,
        completedAtMs: 1, createdAtMs: 1,
        ownerID: OWNER_ID, solarSystemID: SOLAR_SYSTEM_ID,
      },
      [fuelRuntime.FUEL_INFO_KEY]: {
        typeID: FUEL_D1, quantity, updatedAtMs: START_MS,
        burnUpdatedAtMs: START_MS, burnRemainderMs: 150000,
      },
    }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  return updated.data;
}

function current(node) { return itemStore.findItemById(node.itemID); }
function readFuel(node) { return fuelRuntime.readNetworkNodeFuelState(current(node)); }
function readIntent(node) { return fuelRuntime.readSuiNetworkNodeFuelIntent(current(node)); }
function readObservation(node) { return JSON.parse(current(node).customInfo)[fuelRuntime.SUI_FUEL_INFO_KEY]; }

function project(node, quantity, typeID = FUEL_D1, observedAtMs = START_MS) {
  return fuelRuntime.projectSuiNetworkNodeFuel(node.itemID, {
    quantity, typeID, observedAtMs, unitVolume: 0.28,
  }, DEPLOYMENT_KEY);
}

function noticeSink(t) {
  const notices: any[] = [];
  fuelRuntime.registerFuelNoticePublisher((notice) => { notices.push(notice); });
  t.after(() => fuelRuntime.registerFuelNoticePublisher(null));
  return notices;
}

test.beforeEach(() => {
  fuelRuntime._testing.clearPendingFuelTransactions();
  deployment._testing.clearPendingAssemblyTransitions();
});

test("confirmed blockchain fuel replaces local reserves and rounds fractional units down", () => {
  const node = createNode();
  for (const [chainQuantity, expected] of [[99.9, 99], [1.999, 1], [0.9, 0], [0, 0], [42.01, 42]]) {
    project(node, chainQuantity);
    const fuel = readFuel(node);
    assert.equal(fuel.quantity, expected);
    assert.equal(fuel.typeID, expected > 0 ? FUEL_D1 : 0);
    const status = fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, node.itemID);
    assert.equal(status.success, true, status.errorMsg);
    assert.equal(status.data.quantity, expected, "Actual usable fuel must use the rounded chain amount");
    assert.equal(readIntent(node), null, "An imported reserve must not become a local refueling request");
    assert.equal(readObservation(node).deploymentKey, DEPLOYMENT_KEY);
    assert.equal(JSON.parse(current(node).customInfo).unrelated, "preserved");
  }
});

test("withdrawal validation cannot spend the fractional part of a chain reserve", () => {
  const node = createNode();
  project(node, 99.9);
  const container = grantOne(SOLAR_SYSTEM_ID, 0, 95276, 1, {
    individualItems: true, singleton: 1,
  });
  const prepare = (quantity) => fuelRuntime.prepareNetworkNodeFuelWithdraw({
    characterID: OWNER_ID, networkNodeID: node.itemID,
    fuelTypeID: FUEL_D1, quantity,
    destinationItemID: container.itemID, destinationFlagID: CARGO_FLAG,
  });
  assert.equal(prepare(100).errorMsg, "INSUFFICIENT_STORED_FUEL");
  assert.equal(prepare(99).success, true);
  assert.equal(readFuel(node).quantity, 99);
  assert.equal(readIntent(node), null, "Preparation must not create a committed transfer intent");
});

test("chain quantity and type changes publish fuel notices only when visible fuel changes", (t) => {
  const node = createNode();
  const notices = noticeSink(t);
  project(node, 99.9);
  project(node, 99.1, FUEL_D1, START_MS + 1000);
  assert.equal(notices.length, 1, "Fractional changes within the same whole unit need no duplicate notice");
  project(node, 98.9);
  project(node, 130.75);
  project(node, 130.25, FUEL_D2);
  project(node, 0.9, FUEL_D2);
  project(node, 0, FUEL_D1);
  assert.deepEqual(notices.map(({ fuelTypeID, quantity }) => ({ fuelTypeID, quantity })), [
    { fuelTypeID: FUEL_D1, quantity: 99 },
    { fuelTypeID: FUEL_D1, quantity: 98 },
    { fuelTypeID: FUEL_D1, quantity: 130 },
    { fuelTypeID: FUEL_D2, quantity: 130 },
    { fuelTypeID: 0, quantity: 0 },
  ]);
  for (const notice of notices) {
    assert.equal(notice.networkNodeID, node.itemID);
    assert.equal(notice.characterID, OWNER_ID);
    assert.equal(notice.solarSystemID, SOLAR_SYSTEM_ID);
  }
});

test("confirmed chain fuel disables local burn through settlement and status reads", (t) => {
  const node = createNode();
  const notices = noticeSink(t);
  project(node, 99.9);
  notices.length = 0;
  const imported = current(node).customInfo;
  t.mock.method(Date, "now", () => START_MS + 7 * DAY_MS);
  const calculation = fuelRuntime.calculateNetworkNodeFuelBurn(current(node));
  assert.equal(calculation.consumedQuantity, 0);
  assert.equal(calculation.state.quantity, 99);
  for (const nowMs of [START_MS + DAY_MS, START_MS + 7 * DAY_MS]) {
    const settled = fuelRuntime.settleNetworkNodeFuel(node.itemID, nowMs);
    assert.equal(settled.success, true, settled.errorMsg);
    assert.equal(settled.consumedQuantity, 0);
    assert.equal(readFuel(node).quantity, 99);
  }
  assert.equal(fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, node.itemID).data.quantity, 99);
  assert.equal(current(node).customInfo, imported, "Local ticks must not alter the observed chain state");
  assert.equal(notices.length, 0);
  assert.equal(readIntent(node), null);
});

for (const quantity of [0.9, 0]) {
  test(`a chain-online node with ${quantity} raw fuel remains online after local settlement`, () => {
    const node = createNode();
    project(node, quantity);
    assert.equal(readFuel(node).quantity, 0);
    const settled = fuelRuntime.settleNetworkNodeFuel(node.itemID, START_MS + 7 * DAY_MS);
    assert.equal(settled.success, true, settled.errorMsg);
    assert.equal(settled.consumedQuantity, 0);
    assert.equal(deployment.readConstructionState(current(node)).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
    assert.equal(JSON.parse(current(node).customInfo).evejsSuiAssemblyStatusIntent, undefined);
    assert.equal(fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, node.itemID).data.quantity, 0);
    assert.equal(deployment.readConstructionState(current(node)).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  });
}

for (const action of ["deposit", "withdraw"]) {
  test(`a pending ${action} survives fresh chain observations and is acknowledged exactly once`, (t) => {
    const node = createNode();
    const notices = noticeSink(t);
    project(node, 100.9);
    const container = grantOne(SOLAR_SYSTEM_ID, 0, 95276, 1, {
      individualItems: true, singleton: 1,
    });
    const deposit = action === "deposit";
    const stack = deposit ? grantOne(container.itemID, CARGO_FLAG, FUEL_D1, 100) : null;
    const prepared = deposit ? fuelRuntime.prepareNetworkNodeFuelDeposit({
      characterID: OWNER_ID, networkNodeID: node.itemID,
      sourceItemID: container.itemID, sourceFlagID: CARGO_FLAG,
      items: [{ itemID: stack.itemID, quantity: 20 }],
    }) : fuelRuntime.prepareNetworkNodeFuelWithdraw({
      characterID: OWNER_ID, networkNodeID: node.itemID,
      fuelTypeID: FUEL_D1, quantity: 20,
      destinationItemID: container.itemID, destinationFlagID: CARGO_FLAG,
    });
    assert.equal(prepared.success, true, prepared.errorMsg);
    const executed = fuelRuntime.executeNetworkNodeFuelTransaction({
      action: `networknode-fuel-${action}`, characterID: OWNER_ID,
      transactionUUID: prepared.data.transactionUUID, signature: VALID_SIGNATURE,
    });
    assert.equal(executed.success, true, executed.errorMsg);
    const intent = readIntent(node);
    assert.ok(intent?.id);
    assert.equal(intent.typeID, FUEL_D1);
    assert.equal(intent.quantityDelta, deposit ? 20 : -20);
    assert.equal(readFuel(node).quantity, deposit ? 120 : 80);
    notices.length = 0;

    project(node, 90.8, FUEL_D1, START_MS + 1000);
    assert.deepEqual(readIntent(node), intent, "Refreshing cannot discard or reissue an unacknowledged transfer");
    assert.equal(readFuel(node).quantity, deposit ? 110 : 70);
    assert.equal(notices.length, 1);
    project(node, 90.1, FUEL_D1, START_MS + 2000);
    assert.equal(notices.length, 1, "An unchanged visible balance must not produce a second notice");
    fuelRuntime.acknowledgeSuiNetworkNodeFuel(node.itemID, "an-obsolete-intent");
    assert.deepEqual(readIntent(node), intent);
    fuelRuntime.acknowledgeSuiNetworkNodeFuel(node.itemID, intent.id);
    assert.equal(readIntent(node), null);
    assert.equal(readFuel(node).quantity, deposit ? 110 : 70);
    assert.equal(readObservation(node).quantity, deposit ? 110 : 70);
    const acknowledged = current(node).customInfo;
    fuelRuntime.acknowledgeSuiNetworkNodeFuel(node.itemID, intent.id);
    assert.equal(current(node).customInfo, acknowledged, "Repeating acknowledgement must not add or subtract fuel again");
    assert.equal(notices.length, 1, "Acknowledgement does not change the already projected visible amount");

    project(node, deposit ? 109.9 : 69.9, FUEL_D1, START_MS + 3000);
    assert.equal(readFuel(node).quantity, deposit ? 109 : 69, "The next authoritative amount fully replaces the acknowledged balance");
    assert.equal(readIntent(node), null);
    const inventoryQuantity = itemStore.listContainerItems(OWNER_ID, container.itemID, CARGO_FLAG)
      .filter(item => Number(item.typeID) === FUEL_D1)
      .reduce((sum, item) => sum + Number(item.stacksize ?? item.quantity), 0);
    assert.equal(inventoryQuantity, deposit ? 80 : 20, "Refresh and acknowledgement must not transfer inventory again");
  });
}

test("a newly created chain node seeds its initial local reserve with one stable bootstrap intent", () => {
  const node = createNode(99.9);
  const intent = fuelRuntime.initializeSuiNetworkNodeFuel(node.itemID, DEPLOYMENT_KEY);
  assert.ok(intent?.id);
  assert.equal(intent.typeID, FUEL_D1);
  assert.equal(intent.quantityDelta, 99);
  assert.equal(readFuel(node).quantity, 99);
  assert.equal(readObservation(node).quantity, 0);
  assert.deepEqual(fuelRuntime.initializeSuiNetworkNodeFuel(node.itemID, DEPLOYMENT_KEY), intent);
  project(node, 0, 0);
  assert.deepEqual(readIntent(node), intent);
  assert.equal(readFuel(node).quantity, 99);
  fuelRuntime.acknowledgeSuiNetworkNodeFuel(node.itemID, intent.id);
  assert.equal(readIntent(node), null);
  assert.equal(readObservation(node).quantity, 99);
  assert.equal(fuelRuntime.initializeSuiNetworkNodeFuel(node.itemID, DEPLOYMENT_KEY), null);
});

test("empty new nodes and existing chain nodes do not create bootstrap refueling intents", () => {
  const empty = createNode(0);
  assert.equal(fuelRuntime.initializeSuiNetworkNodeFuel(empty.itemID, DEPLOYMENT_KEY), null);
  assert.equal(readFuel(empty).quantity, 0);
  const existing = createNode(150);
  project(existing, 42.9);
  assert.equal(fuelRuntime.initializeSuiNetworkNodeFuel(existing.itemID, DEPLOYMENT_KEY), null);
  assert.equal(readFuel(existing).quantity, 42);
});

for (const conflict of [
  { name: "withdrawal underflow after an external decrease", action: "withdraw", quantity: 10, typeID: FUEL_D1 },
  { name: "deposit overflow after an external refill", action: "deposit", quantity: "capacity", typeID: FUEL_D1 },
  { name: "an external fuel type change", action: "deposit", quantity: 60, typeID: FUEL_D2 },
]) {
  test(`pending fuel conflict from ${conflict.name} preserves fresh reads and recovers`, (t) => {
    const node = createNode();
    const otherNode = createNode();
    project(node, 100);
    project(otherNode, 40);
    const container = grantOne(SOLAR_SYSTEM_ID, 0, 95276, 1, {
      individualItems: true, singleton: 1,
    });
    const stack = grantOne(container.itemID, CARGO_FLAG, FUEL_D1, 100);
    const prepareDeposit = (quantity = 1) => fuelRuntime.prepareNetworkNodeFuelDeposit({
      characterID: OWNER_ID, networkNodeID: node.itemID,
      sourceItemID: container.itemID, sourceFlagID: CARGO_FLAG,
      items: [{ itemID: stack.itemID, quantity }],
    });
    const prepareWithdraw = (quantity = 1, typeID = FUEL_D1, targetNode = node) => fuelRuntime.prepareNetworkNodeFuelWithdraw({
      characterID: OWNER_ID, networkNodeID: targetNode.itemID,
      fuelTypeID: typeID, quantity,
      destinationItemID: container.itemID, destinationFlagID: CARGO_FLAG,
    });
    const prepared = conflict.action === "deposit" ? prepareDeposit(20) : prepareWithdraw(20);
    assert.equal(prepared.success, true, prepared.errorMsg);
    const executed = fuelRuntime.executeNetworkNodeFuelTransaction({
      action: `networknode-fuel-${conflict.action}`, characterID: OWNER_ID,
      transactionUUID: prepared.data.transactionUUID, signature: VALID_SIGNATURE,
    });
    assert.equal(executed.success, true, executed.errorMsg);
    const intent = readIntent(node);
    assert.ok(intent?.id);
    const unitVolume = fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, node.itemID).data.unitVolume;
    const chainQuantity = conflict.quantity === "capacity"
      ? Math.floor(fuelRuntime.getNetworkNodeFuelAttributes().fuelMaxCapacityVolume / unitVolume)
      : conflict.quantity;
    const notices = noticeSink(t);

    assert.doesNotThrow(() => project(node, chainQuantity, conflict.typeID, START_MS + 1000));
    assert.deepEqual(readIntent(node), intent, "A conflict must retain the original transfer identity and amount");
    const freshStatus = fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, node.itemID);
    assert.equal(freshStatus.success, true, freshStatus.errorMsg);
    assert.equal(freshStatus.data.quantity, chainQuantity, "Conflicted storage must still expose confirmed fuel");
    assert.equal(freshStatus.data.typeID, conflict.typeID);
    assert.equal(fuelRuntime.settleNetworkNodeFuel(node.itemID, START_MS + DAY_MS).success, true);
    assert.equal(prepareDeposit().errorMsg, "ASSEMBLY_STATE_PENDING");
    assert.equal(prepareWithdraw(1, conflict.typeID).errorMsg, "ASSEMBLY_STATE_PENDING");
    assert.deepEqual(readIntent(node), intent, "Rejected transfers must not replace the pending intent");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].quantity, chainQuantity);
    assert.equal(notices[0].fuelTypeID, conflict.typeID);
    project(node, chainQuantity, conflict.typeID, START_MS + 2000);
    assert.equal(notices.length, 1, "Repeated conflicting observations must not repeat unchanged notices");

    project(otherNode, 39);
    assert.equal(fuelRuntime.getNetworkNodeFuelStatus(OWNER_ID, otherNode.itemID).data.quantity, 39);
    assert.equal(prepareWithdraw(1, FUEL_D1, otherNode).success, true,
      "One conflicted node must not block fuel access on another node");
    assert.deepEqual(readIntent(node), intent);

    project(node, 80, FUEL_D1, START_MS + 3000);
    const resumedQuantity = conflict.action === "deposit" ? 100 : 60;
    assert.equal(readFuel(node).quantity, resumedQuantity);
    assert.equal(readFuel(node).typeID, FUEL_D1);
    assert.deepEqual(readIntent(node), intent, "A compatible observation resumes the same pending transfer");
    assert.equal(prepareDeposit().success, true);
    assert.equal(prepareWithdraw().success, true);
    const nodeNotices = notices.filter(notice => notice.networkNodeID === node.itemID);
    assert.deepEqual(nodeNotices.map(({ quantity, fuelTypeID }) => ({ quantity, fuelTypeID })), [
      { quantity: chainQuantity, fuelTypeID: conflict.typeID },
      { quantity: resumedQuantity, fuelTypeID: FUEL_D1 },
    ]);
    fuelRuntime.acknowledgeSuiNetworkNodeFuel(node.itemID, intent.id);
    assert.equal(readIntent(node), null);
    assert.equal(readFuel(node).quantity, resumedQuantity);
  });
}
