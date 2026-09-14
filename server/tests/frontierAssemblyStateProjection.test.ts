"use strict";

/** Integration tests: run with scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const deployment = require("../src/services/frontier/deploymentRuntime");
const fuelRuntime = require("../src/services/frontier/networkNodeFuelRuntime");
const { registerSuiAssemblyStateRunner, readSuiAssemblyStatusIntent } = require("../src/services/frontier/suiAssemblyState");

const OWNER_ID = 140000003;
const SOLAR_SYSTEM_ID = 30000004;
const STORAGE_TYPE_ID = 77917;
const NODE_TYPE_ID = 88092;
const FUEL_TYPE_ID = 88335;
const START_MS = 1700000000000;

function createAssembly(assemblyStatus = 1, options: Record<string, any> = {}) {
  const typeID = options.typeID ?? STORAGE_TYPE_ID;
  const granted = itemStore.grantItemsToCharacterLocation(OWNER_ID, SOLAR_SYSTEM_ID, 0, [{
    itemType: typeID, quantity: 1, options: { individualItems: true, singleton: 1 },
  }]);
  assert.equal(granted.success, true, granted.errorMsg);
  const item = granted.data.items[0];
  const updated = itemStore.updateInventoryItem(item.itemID, current => ({
    ...current,
    customInfo: JSON.stringify({
      evejsFrontierConstruction: {
        assemblyStatus, assemblyTypeID: typeID, completedAtMs: 1, createdAtMs: 1,
        ownerID: OWNER_ID, solarSystemID: SOLAR_SYSTEM_ID,
        customLifecycleMetadata: { retained: true },
      },
      unrelated: { label: "keep this", values: [1, 2, 3] },
      ...options.customInfo,
    }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  return updated.data;
}

function identity(item) {
  return { itemId: String(item.itemID), ownerId: OWNER_ID, typeId: item.typeID };
}

function persisted(item) {
  return itemStore.findItemById(item.itemID);
}

function customInfo(item) {
  return JSON.parse(persisted(item).customInfo);
}

function createNode(status, quantity = 100, burnRemainderMs = 0) {
  return createAssembly(status, { typeID: NODE_TYPE_ID, customInfo: {
    [fuelRuntime.FUEL_INFO_KEY]: {
      typeID: FUEL_TYPE_ID, quantity, updatedAtMs: START_MS,
      burnUpdatedAtMs: START_MS, burnRemainderMs,
    },
  } });
}

function fuelIntervalMs() {
  const efficiency = fuelRuntime.getNetworkNodeFuelConfig().find(entry => entry.typeID === FUEL_TYPE_ID).efficiency;
  return Math.round(fuelRuntime.getNetworkNodeFuelAttributes().fuelBurnRateInSeconds * efficiency * 10);
}

test.beforeEach(t => {
  deployment._testing.clearPendingAssemblyTransitions();
  // Enabling recording makes an accidental lifecycle request during projection observable.
  t.after(registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation()));
});

for (const [initialStatus, targetStatus] of [[1, 2], [2, 1]]) {
  test(`verified chain status ${targetStatus} replaces cached status ${initialStatus} without creating a request`, () => {
    const item = createAssembly(initialStatus);
    const before = customInfo(item);
    assert.equal(deployment.reconcileSuiAssemblyState(identity(item), targetStatus), true);
    const after = customInfo(item);
    assert.deepEqual(after, {
      ...before, evejsFrontierConstruction: { ...before.evejsFrontierConstruction, assemblyStatus: targetStatus },
    });
    assert.equal(readSuiAssemblyStatusIntent(persisted(item)), null);
    assert.equal(deployment.readConstructionState(persisted(item)).assemblyStatus, targetStatus);
  });
}

test("a differing pending local request survives a fresh chain observation and a mismatched confirmation", () => {
  const intent = { id: "pending-offline", targetStatus: 1 };
  const item = createAssembly(1, { customInfo: { evejsSuiAssemblyStatusIntent: intent } });
  const before = persisted(item).customInfo;
  assert.equal(deployment.reconcileSuiAssemblyState(identity(item), 2), false);
  assert.equal(deployment.reconcileSuiAssemblyState(identity(item), 2, intent.id), false);
  assert.equal(persisted(item).customInfo, before);
  assert.deepEqual(readSuiAssemblyStatusIntent(persisted(item)), intent);
});

test("routine local energy reconciliation cannot override confirmed chain status or topology", () => {
  const item = createAssembly(1, { customInfo: { evejsFrontierEnergy: { networkNodeID: 987654321, autoConnect: false } } });
  assert.equal(deployment.reconcileSuiAssemblyState(identity(item), 2), true);
  const confirmed = persisted(item).customInfo;
  require("../src/services/frontier/networkNodeEnergyRuntime").reconcileNetworkNodeEnergy();
  assert.equal(persisted(item).customInfo, confirmed);
  assert.equal(deployment.readConstructionState(persisted(item)).assemblyStatus, 2);
  assert.equal(readSuiAssemblyStatusIntent(persisted(item)), null);
});

test("an older confirmation cannot clear a newer request for the same target status", () => {
  const intent = { id: "new-online-request", targetStatus: 2 };
  const item = createAssembly(1, { customInfo: { evejsSuiAssemblyStatusIntent: intent } });
  const before = persisted(item).customInfo;
  assert.equal(deployment.reconcileSuiAssemblyState(identity(item), 2, "older-online-request"), false);
  assert.equal(persisted(item).customInfo, before);
  assert.deepEqual(readSuiAssemblyStatusIntent(persisted(item)), intent);
});

for (const initialStatus of [1, 2]) {
  test(`matching chain confirmation clears its intent when cached status is ${initialStatus}`, () => {
    const intent = { id: "confirmed-online", targetStatus: 2 };
    const item = createAssembly(initialStatus, { customInfo: { evejsSuiAssemblyStatusIntent: intent } });
    const before = customInfo(item);
    assert.equal(deployment.reconcileSuiAssemblyState(identity(item), 2, intent.id), true);
    const expected = {
      ...before, evejsFrontierConstruction: { ...before.evejsFrontierConstruction, assemblyStatus: 2 },
    };
    delete expected.evejsSuiAssemblyStatusIntent;
    assert.deepEqual(customInfo(item), expected);
    assert.equal(readSuiAssemblyStatusIntent(persisted(item)), null);
  });
}

test("chain projection rejects a changed owner or type without altering the persisted item", () => {
  const item = createAssembly(1);
  const before = persisted(item).customInfo;
  for (const changed of [
    { ...identity(item), ownerId: OWNER_ID + 1 },
    { ...identity(item), typeId: NODE_TYPE_ID },
  ]) {
    assert.throws(() => deployment.reconcileSuiAssemblyState(changed, 2), /changed identity/);
    assert.equal(persisted(item).customInfo, before);
  }
});

test("chain projection rejects incomplete assemblies and unsupported chain statuses", () => {
  const incomplete = createAssembly(5);
  const completed = createAssembly(1);
  const beforeIncomplete = persisted(incomplete).customInfo;
  const beforeCompleted = persisted(completed).customInfo;
  assert.throws(() => deployment.reconcileSuiAssemblyState(identity(incomplete), 2), /changed identity/);
  assert.throws(() => deployment.reconcileSuiAssemblyState(identity(completed), 0), /changed identity/);
  assert.equal(persisted(incomplete).customInfo, beforeIncomplete);
  assert.equal(persisted(completed).customInfo, beforeCompleted);
});

test("projecting a node online restarts its fuel timer without charging cached offline time", t => {
  const interval = fuelIntervalMs();
  const remainder = Math.floor(interval / 2);
  const now = START_MS + 10 * interval;
  t.mock.method(Date, "now", () => now);
  const node = createNode(1, 100, remainder);
  assert.equal(deployment.reconcileSuiAssemblyState(identity(node), 2), true);
  const fuel = fuelRuntime.readNetworkNodeFuelState(persisted(node));
  assert.equal(fuel.quantity, 100);
  assert.equal(fuel.burnRemainderMs, remainder);
  assert.equal(fuel.burnUpdatedAtMs, now);
  assert.equal(readSuiAssemblyStatusIntent(persisted(node)), null);
  assert.equal(fuelRuntime.calculateNetworkNodeFuelBurn(persisted(node), now + interval - remainder).consumedQuantity, 1);
});

test("projecting a node offline settles its elapsed online fuel and retains fractional usage", t => {
  const interval = fuelIntervalMs();
  const remainder = Math.floor(interval / 2);
  const now = START_MS + 2 * interval + remainder;
  t.mock.method(Date, "now", () => now);
  const node = createNode(2);
  assert.equal(deployment.reconcileSuiAssemblyState(identity(node), 1), true);
  const fuel = fuelRuntime.readNetworkNodeFuelState(persisted(node));
  assert.equal(fuel.quantity, 98);
  assert.equal(fuel.burnRemainderMs, remainder);
  assert.equal(fuel.burnUpdatedAtMs, now);
  assert.equal(readSuiAssemblyStatusIntent(persisted(node)), null);
  assert.equal(fuelRuntime.calculateNetworkNodeFuelBurn(persisted(node), now + 10 * interval).consumedQuantity, 0);
});

test("an online chain projection remains online when the cached local fuel reserve is empty", t => {
  t.mock.method(Date, "now", () => START_MS);
  const node = createNode(1, 0);
  assert.equal(deployment.reconcileSuiAssemblyState(identity(node), 2), true);
  assert.equal(deployment.readConstructionState(persisted(node)).assemblyStatus, 2);
  assert.equal(readSuiAssemblyStatusIntent(persisted(node)), null);
  assert.equal(customInfo(node)[fuelRuntime.FUEL_INFO_KEY], undefined);
});
