"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createNpcTravelRoutePlanner } = require("../src/space/npc/npcTravelRoute");

function fixture() {
  const systems = new Map([
    [1, { solarSystemID: 1, position: { x: 0, y: 0, z: 0 } }],
    [2, { solarSystemID: 2, position: { x: 1e15, y: 0, z: 0 } }],
    [3, { solarSystemID: 3, position: { x: 2e15, y: 0, z: 0 } }],
  ]);
  const gates = [
    { itemID: 101, solarSystemID: 1, destinationID: 201, position: { x: 100, y: 0, z: 0 } },
    { itemID: 201, solarSystemID: 2, destinationID: 101, position: { x: 200, y: 0, z: 0 } },
    { itemID: 202, solarSystemID: 2, destinationID: 301, position: { x: 300, y: 0, z: 0 } },
    { itemID: 301, solarSystemID: 3, destinationID: 202, position: { x: 400, y: 0, z: 0 } },
  ];
  const state = new Map<number, any>([[202, { status: "dormant", revision: 5 }]]);
  const assemblies: any[] = [];
  let boundNodeID = 0;
  let nodeOnline = true;
  const definitions = [
    { assemblyTypeID: 900, smartGate: { rangeLightYears: 10 } },
    { assemblyTypeID: 901, smartGate: { rangeLightYears: 10 } },
  ];
  const planner = createNpcTravelRoutePlanner({
    worldData: {
      getSolarSystemByID: (id) => systems.get(id) || null,
      getStargatesForSystem: (id) => gates.filter((gate) => gate.solarSystemID === id),
      getStargateByID: (id) => gates.find((gate) => gate.itemID === id) || null,
    },
    stargates: {
      STARGATE_MAINTENANCE_STATUS: { ACTIVE: "active" },
      getStargateState: (id) => state.has(id)
        ? state.get(id).errorMsg
          ? { success: false, errorMsg: state.get(id).errorMsg }
          : { success: true, data: state.get(id) }
        : { success: false, errorMsg: "STARGATE_NOT_MANAGED" },
    },
    assemblies: {
      listAssemblies: () => assemblies,
      listAssemblyDefinitions: () => definitions,
      _testing: { isSlingshotGateType: (id) => id === 901 },
    },
    nodeEnergy: {
      getAssemblyEnergyState: () => ({ networkNodeID: boundNodeID }),
      getNetworkNodeEnergyStatus: () => ({ success: true, data: {
        online: nodeOnline, fuelLevel: nodeOnline ? "normal" : "empty",
        overPowerLimit: false, powerUsageLevel: nodeOnline ? "low" : "offline",
      } }),
    },
    itemStore: { findItemById: (id) => id === boundNodeID
      ? { itemID: id, ownerID: 42 } : null },
  });
  return { planner, state, assemblies,
    bindNode: (id) => { boundNodeID = id; },
    setNodeOnline: (online) => { nodeOnline = online; } };
}

test("NPC route planning treats dormant gates as repairable and revalidates edges", () => {
  const f = fixture();
  const planned = f.planner.planRoute(1, 3);
  assert.equal(planned.success, true);
  assert.deepEqual(planned.data.edges.map((edge) => edge.sourceID), [101, 202]);
  assert.equal(planned.data.edges[1].requiresMaintenance, true);
  assert.equal(f.planner.validateEdge(planned.data.edges[0]).success, true);
  f.state.set(101, { status: "dormant", revision: 2 });
  const changed = f.planner.validateEdge(planned.data.edges[0]);
  assert.equal(changed.success, true);
  assert.equal(changed.data.requiresMaintenance, true);
  f.state.set(101, { errorMsg: "STARGATE_STATE_UNAVAILABLE" });
  assert.equal(f.planner.validateEdge(planned.data.edges[0]).success, false);
});

test("NPC Smart Gates require reciprocal online links; catapults remain one-way", () => {
  const f = fixture();
  f.assemblies.push(
    { itemID: 501, assemblyTypeID: 900, assemblyStatus: 2,
      activationCompleteAtMs: 0, solarSystemID: 1, targetSolarSystemID: 3,
      destinationGateID: 503, ownerID: 42, position: { x: 1, y: 0, z: 0 } },
    { itemID: 503, assemblyTypeID: 900, assemblyStatus: 2,
      activationCompleteAtMs: 0, solarSystemID: 3, targetSolarSystemID: 1,
      destinationGateID: 501, ownerID: 42, position: { x: 3, y: 0, z: 0 } },
  );
  assert.equal(f.planner.planRoute(1, 3).data.edges[0].kind, "smart-gate");
  f.assemblies[1].destinationGateID = 0;
  assert.equal(f.planner.validateEdge({
    kind: "smart-gate", sourceSystemID: 1, destinationSystemID: 3,
    sourceID: 501, destinationID: 503,
  }).success, false);
  f.assemblies.push({ itemID: 502, assemblyTypeID: 901, assemblyStatus: 2,
    activationCompleteAtMs: 0, solarSystemID: 1, targetSolarSystemID: 3,
    destinationGateID: 0, ownerID: 42, position: { x: 2, y: 0, z: 0 } });
  assert.equal(f.planner.planRoute(1, 3).data.edges[0].kind, "catapult");
  assert.equal(f.planner.edgesForSystem(3).some((edge) => edge.kind === "catapult"), false);
  f.bindNode(700);
  f.setNodeOnline(false);
  assert.equal(f.planner.validateEdge({ kind: "catapult", sourceSystemID: 1,
    destinationSystemID: 3, sourceID: 502, destinationID: 0 }).success, false);
  f.setNodeOnline(true);
  assert.equal(f.planner.validateEdge({ kind: "catapult", sourceSystemID: 1,
    destinationSystemID: 3, sourceID: 502, destinationID: 0 }).success, true);
});
