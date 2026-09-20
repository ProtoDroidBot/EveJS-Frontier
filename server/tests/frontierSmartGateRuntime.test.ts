"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const reference = require("../src/services/_shared/referenceData");
const originalReadStaticRows = reference.readStaticRows;
const OWNER = 140000003;
const TYPE = 84955;
const LIGHT_YEAR = 9_460_730_472_580_800;
const components = [TYPE, 84956, 95627].map(typeID => ({
  typeID,
  smartDeployable: { createOnChain: 1, constructionCost: { 88783: 1 }, constructionSite: 91712 },
  smartGate: { range: typeID === TYPE ? 2 : 5 },
}));
const systems = [0, 1, 2, 2.01].map((distance, index) => ({
  solarSystemID: 30000004 + index,
  position: { x: distance * LIGHT_YEAR, y: 0, z: 0 },
}));
test.mock.method(reference, "readStaticRows", table => {
  if (table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE) return components;
  if (table === reference.TABLE.SOLAR_SYSTEMS) return systems;
  return originalReadStaticRows(table);
});

const store = require("../src/services/inventory/itemStore");
const space = require("../src/space/runtime");
const transitions = require("../src/space/transitions");
const character = require("../src/services/character/characterState");
const energy = require("../src/services/frontier/networkNodeEnergyRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");

function fixture(t) {
  const items = new Map<number, any>();
  const changed: number[] = [];
  const jumps: Array<{ characterID: number; solarSystemID: number; options: any }> = [];
  let failItemID = 0;
  t.mock.method(store, "findItemById", itemID => items.get(Number(itemID)) || null);
  t.mock.method(store, "listOwnedItems", ownerID => [...items.values()].filter(item => item.ownerID === ownerID));
  t.mock.method(store, "getActiveShipItem", characterID => ({
    itemID: Number(characterID) + 1_000_000,
    ownerID: Number(characterID),
    locationID: 30000004,
    flagID: 0,
    radius: 50,
  }));
  t.mock.method(store, "updateInventoryItem", (itemID, updater) => {
    if (Number(itemID) === failItemID) return { success: false, errorMsg: "WRITE_ERROR" };
    const previousData = structuredClone(items.get(Number(itemID)));
    const data = typeof updater === "function" ? updater(structuredClone(previousData)) : structuredClone(updater);
    items.set(Number(itemID), data);
    return { success: true, previousData, data };
  });
  t.mock.method(energy, "reconcileNetworkNodeEnergy", () => {});
  t.mock.method(character, "emitItemsChangedForSession", (_session, item) => { changed.push(item.itemID); });
  t.mock.method(transitions, "jumpSessionToSolarSystem", (session, solarSystemID, options) => {
    jumps.push({ characterID: session.characterID, solarSystemID, options });
    return { success: true, data: { solarSystemID } };
  });
  // No live scenes or database writes are involved in this validation fixture.
  const previousScenes = space.scenes;
  space.scenes = new Map();
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearPendingAssemblyTransitions();
  t.after(() => {
    space.scenes = previousScenes;
    deployment._testing.clearBuildDefinitionCache();
    deployment._testing.clearCompletionTimers();
    deployment._testing.clearPendingAssemblyTransitions();
  });
  return {
    items, changed, jumps,
    session: { characterID: OWNER, solarsystemid2: 30000004, sendNotification() {} },
    failWritesTo(itemID) { failItemID = itemID; },
    gate(itemID, solarSystemID = 30000004, overrides: Record<string, any> = {}) {
      const { ownerID = OWNER, typeID = TYPE, ...state } = overrides;
      const item = {
        itemID, ownerID, typeID, itemName: `Gate ${itemID}`, locationID: solarSystemID,
        spaceState: { systemID: solarSystemID, position: { x: 0, y: 0, z: 0 } },
        customInfo: JSON.stringify({ untouched: "preserved", evejsFrontierConstruction: {
          assemblyTypeID: typeID, ownerID, solarSystemID, assemblyStatus: 1,
          destinationGateID: 0, targetSolarSystemID: 0, ...state,
        } }),
      };
      items.set(itemID, item);
      return item;
    },
    state(itemID) { return deployment.readConstructionState(items.get(itemID)); },
  };
}

test("Smart Catapult selects an in-range solar system without a destination gate", t => {
  const f = fixture(t);
  f.gate(1, 30000004, { typeID: 95627 });
  assert.deepEqual(
    deployment.getAvailableCatapultSystems(f.session, 1).data.systems,
    [30000005, 30000006, 30000007],
  );
  const selected = deployment.setCatapultDestination(f.session, 1, 30000006);
  assert.equal(selected.success, true);
  assert.equal(selected.data.destinationSolarSystemID, 30000006);
  assert.equal(f.state(1).destinationGateID, 0);
  assert.equal(f.state(1).targetSolarSystemID, 30000006);
  assert.deepEqual(f.changed, [1]);

  assert.equal(deployment.setCatapultDestination(f.session, 1, 30000004).errorMsg,
    "SMART_CATAPULT_SAME_SYSTEM");
  assert.equal(deployment.setCatapultDestination(f.session, 1, 39999999).errorMsg,
    "SMART_CATAPULT_DESTINATION_UNAVAILABLE");
  f.gate(2, 30000004, { typeID: TYPE });
  assert.equal(deployment.setCatapultDestination(f.session, 2, 30000005).errorMsg,
    "ASSEMBLY_NOT_SMART_CATAPULT");

  f.gate(1, 30000004, { typeID: 95627, targetSolarSystemID: 30000006, assemblyStatus: 2 });
  assert.equal(deployment.clearCatapultDestination(f.session, 1).errorMsg,
    "SMART_CATAPULT_MUST_BE_OFFLINE");
  f.gate(1, 30000004, { typeID: 95627, targetSolarSystemID: 30000006 });
  assert.equal(deployment.clearCatapultDestination(f.session, 1).success, true);
  assert.equal(f.state(1).targetSolarSystemID, 0);
});

test("Smart Catapult jumps directly to its configured system with no far-side assembly", t => {
  const f = fixture(t);
  f.gate(1, 30000004, {
    typeID: 95627,
    assemblyStatus: 2,
    destinationGateID: 0,
    targetSolarSystemID: 30000006,
  });
  const traveler = { ...f.session, characterID: OWNER + 99 };
  const result = deployment.jumpWithCatapult(traveler, 1);
  assert.equal(result.success, true);
  assert.equal(result.data.destinationSolarSystemID, 30000006);
  assert.deepEqual(f.jumps, [{
    characterID: OWNER + 99,
    solarSystemID: 30000006,
    options: { stargateJumpCloak: true },
  }]);
  assert.equal(f.items.size, 1, "no destination gate is required");

  f.gate(1, 30000004, { typeID: 95627, assemblyStatus: 2, targetSolarSystemID: 0 });
  assert.equal(deployment.jumpWithCatapult(traveler, 1).errorMsg,
    "SMART_CATAPULT_DESTINATION_REQUIRED");
  f.gate(1, 30000004, { typeID: 95627, targetSolarSystemID: 30000006 });
  assert.equal(deployment.jumpWithCatapult(traveler, 1).errorMsg, "SMART_CATAPULT_OFFLINE");
});

test("owner status reports only completed same-type owned candidates and exact configured distance", t => {
  const f = fixture(t);
  f.gate(1);
  f.gate(2, 30000005);
  f.gate(3, 30000006);
  f.gate(4, 30000007);
  f.gate(5, 30000005, { typeID: 84956 });
  f.gate(6, 30000005, { ownerID: OWNER + 1 });
  f.gate(7, 30000005, { assemblyStatus: 5 });
  f.gate(8, 30000005, { activationCompleteAtMs: 1 });
  f.gate(9, 39999999);
  f.gate(10);
  const result = deployment.getSmartGateLinkStatus(OWNER, 1);
  assert.equal(result.success, true);
  assert.equal(result.data.rangeLightYears, 2);
  assert.equal(result.data.destination, null);
  assert.deepEqual(result.data.candidates.map(gate => gate.itemID), [2, 3, 4, 8, 9, 10]);
  const candidates = new Map<number, any>(result.data.candidates.map(gate => [gate.itemID, gate]));
  assert.equal(candidates.get(2).distanceMeters, String(LIGHT_YEAR));
  assert.equal(candidates.get(3).distanceLightYears, 2);
  assert.equal(candidates.get(3).eligible, true, "exact range boundary is allowed");
  assert.equal(candidates.get(4).reason, "SMART_GATE_OUT_OF_RANGE");
  assert.equal(candidates.get(8).reason, "ASSEMBLY_ACTIVATING", "expired timers still block until persisted completion");
  assert.equal(candidates.get(9).distanceLightYears, null);
  assert.equal(candidates.get(9).distanceMeters, null);
  assert.equal(candidates.get(9).reason, "SMART_GATE_SYSTEM_DATA_UNAVAILABLE");
  assert.equal(candidates.get(10).reason, "SMART_GATE_SAME_SYSTEM");
  assert.equal(deployment.getSmartGateLinkStatus(OWNER + 1, 1).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(f.changed.length, 0, "status is read-only and needs no active session");
});

test("owner link and unlink persist reciprocal state, notify both gates, and invalidate prepared transitions", t => {
  const f = fixture(t);
  f.gate(1);
  f.gate(2, 30000006);
  const pending = deployment.beginGateLinkTransition(f.session, 1, 2);
  assert.equal(pending.success, true);
  const linked = deployment.linkSmartGates(f.session, 1, 2);
  assert.equal(linked.success, true);
  assert.equal(f.state(1).destinationGateID, 2);
  assert.equal(f.state(1).targetSolarSystemID, 30000006);
  assert.equal(f.state(2).destinationGateID, 1);
  assert.equal(f.state(2).targetSolarSystemID, 30000004);
  assert.equal(JSON.parse(f.items.get(1).customInfo).untouched, "preserved");
  assert.deepEqual(f.changed, [1, 2]);
  assert.equal(deployment.getSmartGateLinkStatus(OWNER, 1).data.destination.itemID, 2);
  assert.equal(deployment.commitGateLinkTransition(f.session, 1, pending.data.transactionUUID, "unused").errorMsg,
    "ASSEMBLY_TRANSACTION_NOT_FOUND");
  const unlinked = deployment.unlinkSmartGate(f.session, 1);
  assert.equal(unlinked.success, true);
  assert.equal(unlinked.data.destination.itemID, 2);
  for (const itemID of [1, 2]) {
    assert.equal(f.state(itemID).destinationGateID, 0);
    assert.equal(f.state(itemID).targetSolarSystemID, 0);
  }
  assert.deepEqual(f.changed, [1, 2, 1, 2]);
});

test("gate mutations reject wrong owner or source system without requiring admin privileges", t => {
  const f = fixture(t);
  f.gate(1);
  f.gate(2, 30000005);
  assert.equal(deployment.linkSmartGates({ ...f.session, characterID: OWNER + 1 }, 1, 2).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
  assert.equal(deployment.linkSmartGates({ ...f.session, solarsystemid2: 30000005 }, 1, 2).errorMsg,
    "ASSEMBLY_NOT_IN_CURRENT_SYSTEM");
  assert.equal(deployment.linkSmartGates(null, 1, 2).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(deployment.linkSmartGates(f.session, 1.5, 2).errorMsg, "ASSEMBLY_NOT_FOUND");
  assert.equal(f.changed.length, 0);
});

test("gate link validation rejects incompatible, unavailable, already linked and out of range partners", t => {
  const f = fixture(t);
  f.gate(1);
  const cases = [
    [30000004, {}, "SMART_GATE_SAME_SYSTEM"],
    [30000005, { typeID: 84956 }, "SMART_GATE_TYPE_MISMATCH"],
    [30000005, { ownerID: OWNER + 1 }, "ASSEMBLY_ACCESS_DENIED"],
    [30000005, { assemblyStatus: 5 }, "ASSEMBLY_UNDER_CONSTRUCTION"],
    [30000005, { activationCompleteAtMs: 1 }, "ASSEMBLY_ACTIVATING"],
    [30000005, { assemblyStatus: 2 }, "SMART_GATE_MUST_BE_OFFLINE"],
    [30000005, { destinationGateID: 3 }, "SMART_GATE_ALREADY_LINKED"],
    [30000007, {}, "SMART_GATE_OUT_OF_RANGE"],
    [39999999, {}, "SMART_GATE_SYSTEM_DATA_UNAVAILABLE"],
  ] as const;
  for (const [systemID, overrides, reason] of cases) {
    f.gate(2, systemID, overrides);
    assert.equal(deployment.linkSmartGates(f.session, 1, 2).errorMsg, reason);
    assert.equal(f.state(1).destinationGateID, 0);
  }
  assert.equal(deployment.linkSmartGates(f.session, 1, 1).errorMsg, "SMART_GATE_SELF_LINK");
  f.gate(1, 30000004, { typeID: 95627 });
  f.gate(2, 30000005, { typeID: 95627 });
  assert.equal(deployment.linkSmartGates(f.session, 1, 2).errorMsg, "SMART_GATE_LINK_NOT_SUPPORTED");
  assert.equal(f.changed.length, 0);
});

test("unlink cannot strand an activating or online partner and status remains available during activation", t => {
  const f = fixture(t);
  f.gate(1, 30000004, { destinationGateID: 2, targetSolarSystemID: 30000005 });
  f.gate(2, 30000005, { destinationGateID: 1, targetSolarSystemID: 30000004, activationCompleteAtMs: 1 });
  assert.equal(deployment.unlinkSmartGate(f.session, 1).errorMsg, "ASSEMBLY_ACTIVATING");
  assert.equal(deployment.getSmartGateLinkStatus(OWNER, 2).success, true);
  f.gate(2, 30000005, { destinationGateID: 1, targetSolarSystemID: 30000004, assemblyStatus: 2 });
  assert.equal(deployment.unlinkSmartGate(f.session, 1).errorMsg, "SMART_GATE_MUST_BE_OFFLINE");
  assert.equal(f.state(1).destinationGateID, 2);
  assert.equal(f.changed.length, 0);
});

test("legacy prepared unlink uses the shared reciprocal update and invalidates its partner's pending request", t => {
  const f = fixture(t);
  f.gate(1, 30000004, { destinationGateID: 2, targetSolarSystemID: 30000005 });
  f.gate(2, 30000005, { destinationGateID: 1, targetSolarSystemID: 30000004 });
  const destinationSession = { ...f.session, solarsystemid2: 30000005 };
  const sourceRequest = deployment.beginGateUnlinkTransition(f.session, 1);
  const destinationRequest = deployment.beginGateUnlinkTransition(destinationSession, 2);
  assert.equal(sourceRequest.success, true);
  assert.equal(destinationRequest.success, true);
  // This legacy protocol performs format validation only. API helpers never
  // manufacture signatures or go through its prepare/commit protocol.
  const signature = Buffer.alloc(65, 1).toString("base64");
  const committed = deployment.commitGateUnlinkTransition(f.session, 1, sourceRequest.data.transactionUUID, signature);
  assert.equal(committed.success, true);
  assert.equal(f.state(1).destinationGateID, 0);
  assert.equal(f.state(2).destinationGateID, 0);
  assert.equal(deployment.commitGateUnlinkTransition(destinationSession, 2,
    destinationRequest.data.transactionUUID, signature).errorMsg, "ASSEMBLY_TRANSACTION_NOT_FOUND");
});

test("pair updates roll back the first gate and do not notify when the partner cannot be saved", t => {
  const f = fixture(t);
  f.gate(1);
  f.gate(2, 30000005);
  f.failWritesTo(2);
  assert.equal(deployment.linkSmartGates(f.session, 1, 2).errorMsg, "WRITE_ERROR");
  assert.equal(f.state(1).destinationGateID, 0);
  assert.equal(f.state(2).destinationGateID, 0);
  f.gate(1, 30000004, { destinationGateID: 2, targetSolarSystemID: 30000005 });
  f.gate(2, 30000005, { destinationGateID: 1, targetSolarSystemID: 30000004 });
  assert.equal(deployment.unlinkSmartGate(f.session, 1).errorMsg, "WRITE_ERROR");
  assert.equal(f.state(1).destinationGateID, 2);
  assert.equal(f.state(2).destinationGateID, 1);
  assert.equal(f.changed.length, 0);
});

test("unlink cleans a missing partner without disturbing another pair", t => {
  const f = fixture(t);
  f.gate(1, 30000004, { destinationGateID: 99, targetSolarSystemID: 30000005 });
  assert.equal(deployment.unlinkSmartGate(f.session, 1).success, true);
  assert.equal(f.state(1).destinationGateID, 0);
  f.gate(1, 30000004, { destinationGateID: 2, targetSolarSystemID: 30000005 });
  f.gate(2, 30000005, { destinationGateID: 3, targetSolarSystemID: 30000006 });
  assert.equal(deployment.unlinkSmartGate(f.session, 1).success, true);
  assert.equal(f.state(2).destinationGateID, 3);
});
