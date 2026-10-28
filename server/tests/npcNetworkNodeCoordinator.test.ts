"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const coordinator = require("../src/space/npc/npcNetworkNodeCoordinator");

test("load shedding protects essential services and selects low priority services first", () => {
  const metadata = new Map([
    [101, { registeredForFaction: true, factionKey: "500001-serpentis", servicePriorityFlags: ["maintenance"] }],
    [102, { registeredForFaction: true, factionKey: "500001-serpentis", servicePriorityFlags: ["production"] }],
    [103, { registeredForFaction: true, factionKey: "500001-serpentis", essentialService: true }],
    [104, { registeredForFaction: true, factionKey: "500002-angel", servicePriorityFlags: [] }],
    [105, { registeredForFaction: true, factionKey: "500001-serpentis", servicePriorityFlags: [] }],
  ]);
  const plan = coordinator.buildLoadSheddingPlan({
    power: { actualEnergyUsed: 120, energyProduction: 100 },
    connectedAssemblies: [
      { itemID: 101, assemblyStatus: 2, energyUsed: 20 },
      { itemID: 102, assemblyStatus: 2, energyUsed: 10 },
      { itemID: 103, assemblyStatus: 2, energyUsed: 50 },
      { itemID: 104, assemblyStatus: 2, energyUsed: 50 },
      { itemID: 105, assemblyStatus: 2, energyUsed: 15 },
    ],
  }, {
    factionKey: "500001-serpentis",
    resolveMetadata: (assemblyID) => metadata.get(assemblyID),
  });

  assert.equal(plan.requiredRelief, 20);
  assert.deepEqual(plan.selected.map((entry) => entry.assemblyID), [105, 102]);
  assert.equal(plan.energyRelief, 25);
  assert.equal(plan.sufficient, true);
  assert.equal(plan.candidates.some((entry) => entry.assemblyID === 103), false);
  assert.equal(plan.candidates.some((entry) => entry.assemblyID === 104), false);
});

test("high utilization creates an approval-gated maintenance kind", () => {
  assert.equal(coordinator._testing.unresolvedMaintenanceKind({
    activeFlags: ["POWER_USAGE_HIGH"],
  }), "load-shedding");
  assert.equal(coordinator._testing.unresolvedMaintenanceKind({
    activeFlags: ["FUEL_LOW", "POWER_USAGE_HIGH"],
  }), "fuel");
  assert.equal(coordinator._testing.unresolvedMaintenanceKind({
    activeFlags: ["POWER_USAGE_MEDIUM"],
  }), null);
});

test("high utilization sheds only enough power to leave the high band", () => {
  const metadata = new Map([
    [201, { registeredForFaction: true, factionKey: "500001-serpentis" }],
    [202, { registeredForFaction: true, factionKey: "500001-serpentis" }],
  ]);
  const plan = coordinator.buildLoadSheddingPlan({
    activeFlags: ["POWER_USAGE_HIGH"],
    power: { actualEnergyUsed: 90, energyProduction: 100 },
    connectedAssemblies: [
      { itemID: 201, assemblyStatus: 2, energyUsed: 6 },
      { itemID: 202, assemblyStatus: 2, energyUsed: 20 },
    ],
  }, {
    factionKey: "500001-serpentis",
    resolveMetadata: (assemblyID) => metadata.get(assemblyID),
  });
  assert.equal(plan.requiredRelief, 10);
  assert.deepEqual(plan.selected.map((entry) => entry.assemblyID), [202]);
});

test("rejected activation includes the requested energy in required relief", () => {
  const plan = coordinator.buildLoadSheddingPlan({
    activeFlags: ["POWER_LIMIT_EXCEEDED"],
    power: { actualEnergyUsed: 90, energyProduction: 100, overLimit: true },
    error: { requestedEnergy: 25 },
    connectedAssemblies: [{ itemID: 301, assemblyStatus: 2, energyUsed: 20 }],
  }, {
    factionKey: "500001-serpentis",
    resolveMetadata: () => ({
      registeredForFaction: true,
      factionKey: "500001-serpentis",
    }),
  });
  assert.equal(plan.requiredRelief, 15);
  assert.deepEqual(plan.selected.map((entry) => entry.assemblyID), [301]);
});
