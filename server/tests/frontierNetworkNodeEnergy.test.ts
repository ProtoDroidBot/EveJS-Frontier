"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const reference = require("../src/services/_shared/referenceData");
const originalRows = reference.readStaticRows;
const COMPONENTS = [88092, 77917, 88082, 92404, 88086, 87119].map(typeID => ({
  typeID, smartDeployable: { createOnChain: 1, constructionCost: { 34: 1 } },
  ...(typeID === 88092 ? { smartAnchor: { maxEnergyCapacity: 1000 } } : {}),
  ...(typeID === 77917 ? { smartStorageUnit: {} } : {}),
  ...(typeID === 88082 ? { smartGate: {} } : {}),
  ...(typeID === 92404 ? { smartTurret: {} } : {}),
}));
test.mock.method(reference, "readStaticRows", table => table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE ? COMPONENTS : originalRows(table));
const itemStore = require("../src/services/inventory/itemStore");
const config = require("../src/services/frontier/networkNodeEnergyConfig");
const energy = require("../src/services/frontier/networkNodeEnergyRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");
const fuel = require("../src/services/frontier/networkNodeFuelRuntime");
const sync = require("../src/services/frontier/suiAssemblySync");
const requests = require("../src/services/frontier/smartAssemblyRequestRuntime");
const NOW = 1700000000000;
const OWNER = 140000003;
const SYSTEM = 30000004;
const SESSION = { characterID: OWNER, solarsystemid2: SYSTEM };
const SIGNATURE = Buffer.alloc(66, 7).toString("base64");
let items = new Map<number, any>();

function assembly(itemID, typeID = 88092, options: Record<string, any> = {}) {
  const { ownerID = OWNER, systemID = SYSTEM, status = typeID === 88092 ? 2 : 1,
    x = 0, y = 0, z = 0, quantity = 100, binding, industry, ...rest } = options;
  const item = { itemID, typeID, itemName: `Assembly ${itemID}`, ownerID, locationID: systemID,
    spaceState: { position: { x, y, z } },
    customInfo: JSON.stringify({
      evejsFrontierConstruction: { assemblyTypeID: typeID, assemblyStatus: status, ownerID, solarSystemID: systemID },
      ...(typeID === 88092 ? { evejsFrontierNetworkNodeFuel: { typeID: 88335, quantity, burnUpdatedAtMs: NOW } } : {}),
      ...(binding ? { [energy.ENERGY_INFO_KEY]: binding } : {}),
      ...(industry ? { evejsFrontierIndustry: industry } : {}),
    }), ...rest };
  items.set(itemID, item);
  return item;
}
function state(id) { return deployment.readConstructionState(items.get(id)).assemblyStatus; }
function updateStatus(id, status) {
  const item = items.get(id);
  const info = JSON.parse(item.customInfo);
  info.evejsFrontierConstruction.assemblyStatus = status;
  items.set(id, { ...item, customInfo: JSON.stringify(info) });
}
function status(id = 1) {
  const result = energy.getNetworkNodeEnergyStatus(OWNER, id);
  assert.equal(result.success, true, result.errorMsg);
  return result.data;
}
test.beforeEach(t => {
  items = new Map();
  t.mock.method(Date, "now", () => NOW);
  t.mock.method(itemStore, "getAllItems", () => Object.fromEntries(items));
  t.mock.method(itemStore, "findItemById", id => items.get(Number(id)) || null);
  t.mock.method(itemStore, "updateInventoryItem", (id, updater) => {
    const previousData = items.get(Number(id));
    if (!previousData) return { success: false, errorMsg: "ITEM_NOT_FOUND" };
    const data = typeof updater === "function" ? updater(structuredClone(previousData)) : updater;
    items.set(Number(id), data);
    return { success: true, data, previousData };
  });
  if (sync.getTrackedSuiAssemblyNetworkNodeID) t.mock.method(sync, "getTrackedSuiAssemblyNetworkNodeID", () => null);
  config.setAssemblyEnergyConfig([{ typeID: 87119, energyRequired: 100 }, { typeID: 77917, energyRequired: 500 }, { typeID: 88082, energyRequired: 50 }, { typeID: 92404, energyRequired: 40 }], { energyConfigID: "0x1" });
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearPendingAssemblyTransitions();
});
test.afterEach(() => { config.clearAssemblyEnergyConfig(); energy.clearSuiNetworkNodeEnergy(); });

function useChainEnergy(t, observation = { maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 750, observedAtMs: NOW }) {
  t.after(require("../src/services/frontier/suiAssemblyState").registerSuiAssemblyStateRunner(async (_id, operation) => operation()));
  t.mock.method(fuel, "settleNetworkNodeFuel", () => {});
  energy.projectSuiNetworkNodeEnergy(1, observation);
}

test("confirmed node reservations override local assembly sums and later type-cost changes", t => {
  assembly(1); assembly(2, 77917, { status: 2 }); assembly(3, 88082);
  useChainEnergy(t);
  assert.equal(status().energyUsed, 750, "includes chain reservations absent from the local assembly sum");
  assert.equal(status().energyAvailable, 250);
  config.setAssemblyEnergyConfig([{ typeID: 77917, energyRequired: 900 }, { typeID: 88082, energyRequired: 50 }]);
  assert.equal(status().energyUsed, 750, "changing type costs does not rewrite existing chain reservations");
  assert.equal(status().energyAvailable, 250);
  assert.equal(state(2), 2, "a read must not offline confirmed consumers based on the new cost");
  updateStatus(2, 1);
  assert.equal(status().energyUsed, 750, "a local offline value does not release chain energy");
  energy.projectSuiNetworkNodeEnergy(1, { maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 200, observedAtMs: NOW + 1 });
  assert.equal(status().energyUsed, 200);
  assert.equal(status().energyAvailable, 800);
});

test("online checks use confirmed available production and do not double charge an online consumer", t => {
  assembly(1); assembly(2, 77917); assembly(3, 88082, { status: 2 });
  useChainEnergy(t);
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_ENERGY_EXCEEDED");
  assert.equal(energy.validateAssemblyOnline(items.get(3)).success, true);
  energy.projectSuiNetworkNodeEnergy(1, { maxEnergy: 1000, currentEnergyProduction: 600, energyUsed: 150, observedAtMs: NOW });
  assert.equal(status().maxEnergy, 1000);
  assert.equal(status().energyAvailable, 450, "available energy uses production, not maximum capacity");
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_ENERGY_EXCEEDED");
  energy.projectSuiNetworkNodeEnergy(1, { maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 500, observedAtMs: NOW });
  assert.equal(energy.validateAssemblyOnline(items.get(2)).success, true, "exact capacity is allowed");
});

test("resource status classifies fuel and power independently and signals over-limit errors", t => {
  assembly(1, 88092, { quantity: 100 });
  assembly(2, 77917);
  useChainEnergy(t, {
    maxEnergy: 1000,
    currentEnergyProduction: 1000,
    energyUsed: 750,
    observedAtMs: NOW,
  });
  const published: any[] = [];
  t.mock.method(requests, "publishAssemblyStatusSignal", (_nodeID, type, value) => {
    published.push({ type, value });
    return { success: true, changed: true, data: value };
  });

  const current = status();
  assert.equal(current.fuelLevel, "low");
  assert.equal(current.lowFuel, true);
  assert.equal(current.powerUsageLevel, "medium");
  assert.equal(current.overPowerLimit, false);
  assert.deepEqual(current.resourceSignals.activeFlags, ["FUEL_LOW", "POWER_USAGE_MEDIUM"]);

  const denied = energy.validateAssemblyOnline(items.get(2));
  assert.equal(denied.errorMsg, "NETWORK_NODE_ENERGY_EXCEEDED");
  const overload = published.at(-1);
  assert.equal(overload.type, "network_node.resources");
  assert.equal(overload.value.fuel.level, "low", "the fuel dimension remains intact");
  assert.equal(overload.value.power.usageLevel, "over_limit");
  assert.equal(overload.value.power.overLimit, true);
  assert.equal(overload.value.error.code, "NETWORK_NODE_ENERGY_EXCEEDED");
  assert.ok(overload.value.activeFlags.includes("POWER_LIMIT_EXCEEDED"));
});

test("pending local online requests cannot claim energy has already been reserved", t => {
  assembly(1); const item = assembly(2, 77917, { status: 2 });
  item.customInfo = JSON.stringify({ ...JSON.parse(item.customInfo), evejsSuiAssemblyStatusIntent: { id: "pending", targetStatus: 2 } });
  useChainEnergy(t);
  assert.equal(energy.validateAssemblyOnline(item).errorMsg, "NETWORK_NODE_ENERGY_EXCEEDED");
  assert.equal(status().energyUsed, 750);
});

test("competing native commits hold pending demand without changing displayed chain reservations", t => {
  assembly(1); assembly(2, 77917); assembly(3, 77917);
  config.setAssemblyEnergyConfig([{ typeID: 77917, energyRequired: 200 }]);
  useChainEnergy(t);
  const first = deployment.beginAssemblyStateTransition(SESSION, 2, 2);
  const second = deployment.beginAssemblyStateTransition(SESSION, 3, 2);
  assert.equal(first.success, true);
  assert.equal(second.success, true, "pending signatures alone do not hold capacity");
  assert.equal(deployment.commitAssemblyStateTransition(SESSION, 2, first.data.transactionUUID, SIGNATURE, 2).success, true);
  assert.equal(status().energyUsed, 750, "the queued online intent has not reserved chain energy yet");
  assert.equal(status().energyAvailable, 250);
  assert.equal(deployment.commitAssemblyStateTransition(SESSION, 3, second.data.transactionUUID, SIGNATURE, 2).errorMsg,
    "NETWORK_NODE_ENERGY_EXCEEDED");
  assert.equal(state(3), 1);
});

test("connection writes succeed while chain totals await refresh", t => {
  assembly(1); assembly(2, 88082);
  useChainEnergy(t);
  energy.clearSuiNetworkNodeEnergy();
  assert.equal(energy.disconnectAssembly(SESSION, 2, 1).success, true);
  assert.equal(JSON.parse(items.get(2).customInfo)[energy.ENERGY_INFO_KEY].networkNodeID, 0);
  assert.equal(energy.connectAssembly(SESSION, 2, 1).success, true);
  assert.equal(JSON.parse(items.get(2).customInfo)[energy.ENERGY_INFO_KEY].networkNodeID, 1);
});

test("confirmed production stops power even when local node status and fuel still say online", t => {
  assembly(1); assembly(2, 88082); assembly(3, 88086);
  useChainEnergy(t, { maxEnergy: 1000, currentEnergyProduction: 0, energyUsed: 0, observedAtMs: NOW });
  assert.equal(status().online, false);
  assert.equal(status().energyUsed, 0);
  assert.equal(status().energyAvailable, 0);
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_OFFLINE");
  assert.equal(energy.validateAssemblyOnline(items.get(3)).errorMsg, "NETWORK_NODE_OFFLINE", "zero-cost assemblies still need production");
});

test("missing, cleared, or changed-identity observations cannot fall back to local totals", t => {
  assembly(1); assembly(2, 88082);
  useChainEnergy(t);
  energy.clearSuiNetworkNodeEnergy();
  assert.equal(energy.getNetworkNodeEnergyStatus(OWNER, 1).errorMsg, "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE");
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE");
  energy.projectSuiNetworkNodeEnergy(1, { maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 0, observedAtMs: NOW });
  items.get(1).spaceState.position.x = 10;
  assert.equal(energy.getNetworkNodeEnergyStatus(OWNER, 1).errorMsg, "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE");
});

test("activation blocks node power, online requests, and connection changes", () => {
  const markPending = id => {
    const item = items.get(id);
    const info = JSON.parse(item.customInfo);
    info.evejsFrontierConstruction.activationCompleteAtMs = NOW - 1;
    items.set(id, { ...item, customInfo: JSON.stringify(info) });
  };
  assembly(1); assembly(2, 77917);
  markPending(1);
  assert.equal(energy.getNetworkNodeEnergyStatus(OWNER, 1).errorMsg, "ASSEMBLY_ACTIVATING");
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_OFFLINE");
  assert.equal(energy.connectAssembly(SESSION, 2, 1).errorMsg, "ASSEMBLY_ACTIVATING");
  assert.equal(energy.getAssemblyEnergyState(2).energyUsed, 0);
  assembly(1);
  markPending(2);
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "ASSEMBLY_ACTIVATING");
  assert.equal(energy.connectAssembly(SESSION, 2, 1).errorMsg, "ASSEMBLY_ACTIVATING");
  assert.equal(energy.disconnectAssembly(SESSION, 2, 1).errorMsg, "ASSEMBLY_ACTIVATING");
  assembly(2, 77917);
  assert.equal(energy.validateAssemblyOnline(items.get(2)).success, true);
});

test("connects completed owned assemblies within the inclusive 3D 80 km radius", () => {
  assembly(1);
  assembly(2, 88082, { x: 80000 });
  assembly(3, 88082, { z: 80000.01 });
  assembly(4, 88082, { ownerID: OWNER + 1 });
  assembly(5, 88082, { systemID: SYSTEM + 1 });
  assembly(6, 88082, { status: 5 });
  assembly(7, 88082, { spaceState: {} });
  assembly(8, 88082, { x: 60000, y: 60000 });
  assert.deepEqual(status().connectedAssemblies.map(row => row.itemID), [2]);
  assert.equal(energy.connectAssembly(SESSION, 3, 1).errorMsg, "NETWORK_NODE_OUT_OF_RANGE");
  assert.equal(energy.connectAssembly(SESSION, 4, 1).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(energy.connectAssembly(SESSION, 6, 1).errorMsg, "ASSEMBLY_NOT_FOUND");
});

test("radar detects all nearby Smart Assemblies with private relative coordinates, type, links, and active Industry", () => {
  assembly(1, 88092, { x: 1000, y: 2000, z: 3000 });
  assembly(2, 77917, { x: 4000, y: 6000, z: 3000 });
  assembly(3, 87119, {
    ownerID: OWNER + 1, x: 1000, y: 2000, z: 83000,
    industry: {
      version: 1, blueprintID: 1026,
      production: { version: 1, jobID: 77, state: "RUNNING", requestedRuns: 4,
        completedRuns: 1, runStartedAtMs: NOW, runEndAtMs: NOW + 3000, stopReason: null },
    },
  });
  assembly(4, 92404, { ownerID: OWNER + 1, x: 81000.1, y: 2000, z: 3000 });
  assembly(5, 88082, { systemID: SYSTEM + 1 });
  const radar = status().radarAssemblies;
  assert.deepEqual(radar.map(row => row.itemID), [2, 3]);
  assert.deepEqual(radar[0].relativePosition, { x: 3000, y: 4000, z: 0 });
  assert.equal("position" in radar[0], false);
  assert.equal("ownerID" in radar[0], false);
  assert.equal(radar[0].distanceMeters, 5000);
  assert.equal(radar[0].structureType, "storage_unit");
  assert.equal(radar[0].linkedToNode, true);
  assert.equal(radar[0].industry, null);
  assert.equal(radar[1].distanceMeters, 80000);
  assert.equal(radar[1].structureType, "industry");
  assert.equal(radar[1].linkedToNode, false);
  assert.equal(radar[1].industry.state, "RUNNING");
  assert.equal(radar[1].industry.jobID, 77);
  assert.deepEqual(radar[1].industry.products.map(product => [product.typeID, product.quantityPerRun]), [[83895, 1]]);
});

test("uses deployed per-type costs, accounts once while online, and releases offline", () => {
  assembly(1); assembly(2, 77917, { status: 2 }); assembly(3, 88082, { status: 2 });
  assembly(4, 92404); assembly(5, 88086, { status: 2 });
  assert.equal(status().energyUsed, 550);
  assert.equal(status().energyUsed, 550);
  assert.equal(status().energyAvailable, 450);
  assert.equal(status().connectedAssemblies.find(row => row.itemID === 5).energyRequired, 0);
  updateStatus(2, 1);
  assert.equal(status().energyUsed, 50);
  assert.equal(fuel.readNetworkNodeFuelState(items.get(1)).quantity, 100);
});

test("online prepare and commit enforce capacity including competing prepared transactions", () => {
  assembly(1); assembly(2, 77917, { status: 2 }); assembly(3, 77917); assembly(4, 77917);
  const a = deployment.beginAssemblyStateTransition(SESSION, 3, 2);
  const b = deployment.beginAssemblyStateTransition(SESSION, 4, 2);
  assert.equal(a.success, true, a.errorMsg); assert.equal(b.success, true, b.errorMsg);
  const committed = deployment.commitAssemblyStateTransition(SESSION, 3, a.data.transactionUUID, SIGNATURE, 2);
  assert.equal(committed.success, true, committed.errorMsg);
  assert.equal(status().energyUsed, 1000);
  const rejected = deployment.commitAssemblyStateTransition(SESSION, 4, b.data.transactionUUID, SIGNATURE, 2);
  assert.equal(rejected.errorMsg, "NETWORK_NODE_ENERGY_EXCEEDED");
  assert.equal(state(4), 1);
  assert.equal(energy.validateAssemblyOnline(items.get(3)).success, true, "idempotent online excludes its own draw");
});

test("online commit rechecks radius and node fuel after preparation", () => {
  assembly(1); assembly(2, 88082);
  const pending = deployment.beginAssemblyStateTransition(SESSION, 2, 2);
  assert.equal(pending.success, true, pending.errorMsg);
  items.get(2).spaceState.position.x = 80001;
  assert.equal(deployment.commitAssemblyStateTransition(SESSION, 2, pending.data.transactionUUID, SIGNATURE, 2).errorMsg,
    "NETWORK_NODE_CONNECTION_REQUIRED");
  items.get(2).spaceState.position.x = 0;
  const next = deployment.beginAssemblyStateTransition(SESSION, 2, 2);
  assembly(1, 88092, { quantity: 0 });
  assert.equal(deployment.commitAssemblyStateTransition(SESSION, 2, next.data.transactionUUID, SIGNATURE, 2).errorMsg, "NETWORK_NODE_OFFLINE");
});

test("node fuel exhaustion cascades offline to consumers including zero-cost assemblies", () => {
  assembly(1, 88092, { quantity: 1 }); assembly(2, 88082, { status: 2 }); assembly(3, 88086, { status: 2 });
  fuel.settleAllNetworkNodeFuel(NOW + 300000);
  assert.equal(state(1), 1); assert.equal(state(2), 1); assert.equal(state(3), 1);
  assert.equal(status().energyUsed, 0); assert.equal(status().energyAvailable, 0);
});

test("manual node offline cascades without a chain worker and does not auto-online dependents", () => {
  assembly(1); assembly(2, 88082, { status: 2 });
  deployment.offlineAssemblyForFuelDepletion(1);
  assert.equal(state(2), 1);
  updateStatus(1, 2); energy.reconcileNetworkNodeEnergy();
  assert.equal(state(2), 1);
});

test("topology uses nearest node once, persists through reload, and never charges both grids", () => {
  assembly(1, 88092, { x: 1000 }); assembly(2, 88092, { x: -1000 }); assembly(3, 88082, { status: 2 });
  assert.equal(status(1).energyUsed, 50); assert.equal(status(2).energyUsed, 0);
  items.get(2).spaceState.position.x = 0;
  const file = require.resolve("../src/services/frontier/networkNodeEnergyRuntime");
  const cached = require.cache[file];
  try {
    delete require.cache[file];
    const reloaded = require(file);
    assert.equal(reloaded.getAssemblyEnergyState(3).networkNodeID, 1);
  } finally { require.cache[file] = cached; }
});

test("disconnect persists, explicit reconnect restores membership, online changes are rejected", () => {
  assembly(1); assembly(2, 88082);
  assert.equal(energy.disconnectAssembly(SESSION, 2, 1).success, true);
  energy.reconcileNetworkNodeEnergy();
  assert.equal(status().connectedAssemblies.length, 0);
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_CONNECTION_REQUIRED");
  assert.equal(energy.connectAssembly(SESSION, 2, 1).success, true);
  updateStatus(2, 2);
  assert.equal(energy.disconnectAssembly(SESSION, 2, 1).errorMsg, "ASSEMBLY_MUST_BE_OFFLINE");
  assert.equal(status().energyUsed, 50);
});

test("verified blockchain connections cannot detach or migrate to a different grid", t => {
  assembly(1); assembly(2, 88092, { x: 1000 }); assembly(3, 88082);
  t.mock.method(sync, "getTrackedSuiAssemblyNetworkNodeID", id => Number(id) === 3 ? "2" : null);
  assert.equal(status(1).connectedAssemblies.length, 0);
  const connected = status(2).connectedAssemblies[0];
  assert.equal(connected.canDisconnect, false);
  assert.match(connected.disconnectReason, /blockchain/);
  assert.equal(energy.disconnectAssembly(SESSION, 3, 2).errorMsg, "NETWORK_NODE_BINDING_LOCKED");
  assert.equal(energy.connectAssembly(SESSION, 3, 1).errorMsg, "NETWORK_NODE_BINDING_LOCKED");
  assert.equal(energy.getAssemblyEnergyState(3).networkNodeID, 2);
});

test("connection writes require the owner in the node's solar system", () => {
  assembly(1); assembly(2, 88082);
  assert.equal(energy.disconnectAssembly({ ...SESSION, characterID: OWNER + 1 }, 2, 1).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(energy.disconnectAssembly({ ...SESSION, solarsystemid2: SYSTEM + 1 }, 2, 1).errorMsg, "ASSEMBLY_NOT_IN_CURRENT_SYSTEM");
  assert.equal(energy.getNetworkNodeEnergyStatus(0, 1).errorMsg, "ACCESS_DENIED");
  assert.equal(status().connectedAssemblies.length, 1);
});

test("a removed node or out-of-radius connection cannot leave an assembly powered", () => {
  assembly(1); assembly(2, 88082, { status: 2 }); status();
  items.delete(1); energy.reconcileNetworkNodeEnergy(); assert.equal(state(2), 1);
  assembly(1); updateStatus(2, 2); status();
  items.get(2).spaceState.position.x = 80001;
  energy.reconcileNetworkNodeEnergy(); assert.equal(state(2), 1);
});

test("a refreshed blockchain table updates accounting and sheds overload deterministically", () => {
  assembly(1); assembly(2, 77917, { status: 2 }); assembly(3, 77917, { status: 2 });
  assert.equal(status().energyUsed, 1000);
  config.setAssemblyEnergyConfig([{ typeID: 77917, energyRequired: 600 }]);
  assert.equal(status().energyUsed, 600); assert.equal(state(2), 2); assert.equal(state(3), 1);
});

test("unavailable configuration blocks online without silently substituting free energy", () => {
  assembly(1); assembly(2, 88082); config.clearAssemblyEnergyConfig();
  assert.equal(energy.validateAssemblyOnline(items.get(2)).errorMsg, "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE");
  assert.equal(energy.getNetworkNodeEnergyStatus(OWNER, 1).errorMsg, "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE");
  assert.throws(() => config.setAssemblyEnergyConfig([{ typeID: 1, energyRequired: -1 }]), /Invalid/);
  assert.equal(config.isAssemblyEnergyConfigLoaded(), false);
});
