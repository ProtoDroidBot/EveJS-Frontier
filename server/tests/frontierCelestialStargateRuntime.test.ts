"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STARGATE_MAINTENANCE_STATUS,
  createCelestialStargateRuntime,
} = require("../src/services/frontier/celestialStargateRuntime");

const GATE_ID = 60000001;

function fixture() {
  let currentTime = 1_000;
  let stored = {};
  const refreshes: number[] = [];
  const repository = {
    ensureTable() { return true; },
    read() { return { success: true, data: structuredClone(stored) }; },
    write(_table, _path, value) {
      stored = structuredClone(value);
      return { success: true };
    },
    flushTableSync() { return { success: true }; },
  };
  const runtime = createCelestialStargateRuntime({
    repository,
    configPath: null,
    autoConfigure: false,
    now: () => currentTime,
    findStargate(stargateID) {
      return stargateID === GATE_ID ? {
        itemID: GATE_ID,
        typeID: 79787,
        solarSystemID: 30000004,
        destinationID: 60000002,
        destinationSolarSystemID: 30000005,
      } : null;
    },
    refreshActivation(stargateID) {
      refreshes.push(stargateID);
      return [];
    },
  });
  return {
    runtime,
    refreshes,
    advance(milliseconds) { currentTime += milliseconds; },
    stored(): any { return structuredClone(stored); },
  };
}

test("celestial stargates persist separate material/fuel requirements and ordered signals", async () => {
  const f = fixture();
  const observed: any[] = [];
  f.runtime.subscribe((signal) => observed.push(signal));
  const configured = f.runtime.configureDormantStargate({
    stargateID: GATE_ID,
    reactivationDurationMs: 500,
    requirements: {
      materials: [{ typeID: 34, quantity: 5 }],
      fuel: [{ typeID: 77818, quantity: 10 }],
    },
  });
  assert.equal(configured.success, true, configured.errorMsg);
  assert.equal(configured.data.status, STARGATE_MAINTENANCE_STATUS.DORMANT);
  assert.equal(f.runtime.resolveActivationOverride(GATE_ID), 0);

  const first = f.runtime.prepareStargateResourceDeposit(GATE_ID, [
    { kind: "material", typeID: 34, quantity: 5 },
    { kind: "fuel", typeID: 77818, quantity: 2 },
  ], { operationKey: "npc:gate:first" });
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(f.runtime.commitStargateResourceDeposit(GATE_ID, "npc:gate:first").success, true);
  let state = f.runtime.getStargateState(GATE_ID).data;
  assert.equal(state.status, STARGATE_MAINTENANCE_STATUS.DORMANT);
  assert.equal(state.materialLevel, "ready");
  assert.equal(state.fuelLevel, "low");
  assert.equal(state.requirements.fuel[0].remainingQuantity, 8);

  const duplicate = f.runtime.commitStargateResourceDeposit(GATE_ID, "npc:gate:first");
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.committed, false);
  assert.equal(f.runtime.getStargateState(GATE_ID).data.requirements.fuel[0].depositedQuantity, 2);

  assert.equal(f.runtime.prepareStargateResourceDeposit(GATE_ID, [
    { kind: "fuel", typeID: 77818, quantity: 8 },
  ], { operationKey: "npc:gate:second" }).success, true);
  assert.equal(f.runtime.commitStargateResourceDeposit(GATE_ID, "npc:gate:second").success, true);
  state = f.runtime.getStargateState(GATE_ID).data;
  assert.equal(state.status, STARGATE_MAINTENANCE_STATUS.READY);
  assert.equal(state.resourcesReady, true);

  const started = f.runtime.requestStargateReactivation(GATE_ID, {
    actor: { npcCharacterID: 1500000001 },
  });
  assert.equal(started.success, true, started.errorMsg);
  assert.equal(started.data.status, STARGATE_MAINTENANCE_STATUS.REACTIVATING);
  assert.equal(f.runtime.resolveActivationOverride(GATE_ID), 0);
  f.advance(500);
  const settled = f.runtime.settleStargateReactivation(GATE_ID);
  assert.equal(settled.success, true);
  assert.equal(settled.data.status, STARGATE_MAINTENANCE_STATUS.ACTIVE);
  assert.equal(f.runtime.resolveActivationOverride(GATE_ID), null);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.refreshes.includes(GATE_ID), true);
  const signals = f.runtime.listSignals(GATE_ID).data.signals;
  assert.deepEqual(signals.map((signal) => signal.signalType), [
    "stargate.dormant",
    "stargate.resources_deposited",
    "stargate.fuel_low",
    "stargate.resources_deposited",
    "stargate.reactivation_ready",
    "stargate.reactivation_started",
    "stargate.reactivated",
  ]);
  assert.deepEqual(observed.map((signal) => signal.sequence),
    signals.map((signal) => signal.sequence));
  assert.equal(f.stored().gates[String(GATE_ID)].status, STARGATE_MAINTENANCE_STATUS.ACTIVE);
});

test("pending deposits reserve exact capacity and can be cancelled safely", () => {
  const f = fixture();
  assert.equal(f.runtime.configureDormantStargate({
    stargateID: GATE_ID,
    requirements: { fuel: { 77818: 10 } },
  }).success, true);
  assert.equal(f.runtime.prepareStargateResourceDeposit(GATE_ID, [
    { kind: "fuel", typeID: 77818, quantity: 8 },
  ], { operationKey: "reservation:a" }).success, true);
  const over = f.runtime.prepareStargateResourceDeposit(GATE_ID, [
    { kind: "fuel", typeID: 77818, quantity: 3 },
  ], { operationKey: "reservation:b" });
  assert.equal(over.success, false);
  assert.equal(over.errorMsg, "STARGATE_RESOURCE_CAPACITY_EXCEEDED");
  assert.equal(f.runtime.cancelStargateResourceDeposit(GATE_ID, "reservation:a").cancelled, true);
  assert.equal(f.runtime.prepareStargateResourceDeposit(GATE_ID, [
    { kind: "fuel", typeID: 77818, quantity: 3 },
  ], { operationKey: "reservation:b" }).success, true);
});
