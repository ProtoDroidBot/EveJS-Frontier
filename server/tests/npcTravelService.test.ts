"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { advanceNpcTravel, buildNpcJumpDrivePlan } = require("../src/space/npc/npcTravelService");

function fixture() {
  const edge: any = {
    kind: "stargate", sourceSystemID: 1, destinationSystemID: 2,
    sourceID: 111, destinationID: 211,
    sourcePosition: { x: 100_000, y: 0, z: 0 },
    destinationPosition: { x: 200_000, y: 0, z: 0 },
  };
  const entity: any = {
    itemID: 71, entityID: 71, systemID: 1,
    npcCharacterID: 901, npcIncarnation: 1, transient: false,
    position: { x: 0, y: 0, z: 0 }, radius: 100,
    mode: "STOP", conditionState: {},
  };
  const job: any = { jobID: "job-1", npcCharacterID: 901,
    incarnation: 1, checkpoint: {} };
  const gate = { itemID: 111, kind: "stargate", activationState: 2,
    radius: 100, position: edge.sourcePosition };
  const scene = { getEntityByID: (id) => id === 111 ? gate : null };
  const context = { entity, job, scene, nowMs: 1000 };
  const calls = { warp: 0, transfer: 0, maintenance: 0 };
  let refreshed: any = edge;
  const adapters: any = {
    worldData: { getSolarSystemByID: () => ({ position: { x: 0, y: 0, z: 0 } }) },
    fitting: { buildShipResourceState: () => ({ attributes: {} }) },
    jumpDrive: { buildJumpDrivePlan: () => ({ success: false, errorMsg: "JUMP_DRIVE_NOT_AVAILABLE" }) },
    itemStore: { findItemById: () => null },
    routePlanner: {
      planNpcTravelRoute: () => ({ success: true, data: { edges: [edge] } }),
      validateNpcTravelEdge: () => ({ success: true, data: refreshed }),
    },
    npcRuntime: { warpToPoint: () => { calls.warp += 1; return { success: true }; } },
    transition: { transitionNpcThroughEdge: () => {
      calls.transfer += 1;
      return { success: true };
    } },
    maintenance: { tickNpcStargateMaintenanceJob: () => {
      calls.maintenance += 1;
      return { status: "running", checkpoint: {} };
    } },
  };
  return { context, adapters, edge, gate, calls, setRefreshed: (next) => { refreshed = next; } };
}

test("NPC cross-system route warps to a gate, then transfers only while active", () => {
  const f = fixture();
  const approach = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(approach.step, "travel-gate");
  assert.equal(f.calls.warp, 1);
  f.context.entity.position = { x: 100_000, y: 0, z: 0 };
  f.gate.activationState = 0;
  const closed = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(closed.step, "awaiting-gate-activation");
  assert.equal(f.calls.transfer, 0);
  f.gate.activationState = 2;
  f.setRefreshed({ ...f.edge, requiresMaintenance: true });
  const dormant = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(dormant.step, "gate-became-dormant");
  assert.equal(f.calls.transfer, 0);
  f.setRefreshed(f.edge);
  const moved = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(moved.step, "travel-system-complete");
  assert.equal(f.calls.transfer, 1);
});

test("NPC dormant-gate route runs the material and fuel maintenance job", () => {
  const f = fixture();
  f.edge.requiresMaintenance = true;
  const result = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(result.status, "running");
  assert.equal(f.calls.maintenance, 1);
  assert.equal(f.calls.transfer, 0);
});

test("NPC fitted jump uses shared cost and timer plans without granting fuel", () => {
  const entity = {
    itemID: 71, entityID: 71, systemID: 1, npcCharacterID: 901,
    typeID: 123, conditionState: {
      fuelQueue: [{ fuelTypeID: 7, quantity: 10 }],
    },
  };
  const adapters = {
    worldData: { getSolarSystemByID: (id) => ({ position: {
      x: id === 1 ? 0 : 9_460_730_472_580_800, y: 0, z: 0,
    } }) },
    nativeNpcStore: { listNativeModulesForEntity: () => [
      { moduleID: 81, moduleState: { online: true } },
    ] },
    itemStore: { findItemById: (id) => id === 81 ? { itemID: 81 } : null },
    fitting: { buildShipResourceState: () => ({ attributes: {} }) },
    jumpDrive: {
      buildJumpDrivePlan: ({ deps }) => {
        assert.equal(deps.isEffectivelyOnlineModule({ npcTravelOnline: true }), true);
        return { success: true, data: {
          fuelMode: "frontier-tank", fuelTypeID: 7, fuelQuantity: 4,
          fuelQueue: [{ fuelTypeID: 7, quantity: 10 }], nextTemperature: 105,
        } };
      },
      consumeFrontierFuelQueue: () => ({ success: true, data: {
        previousFuelQueue: [{ fuelTypeID: 7, quantity: 10 }],
        fuelQueue: [{ fuelTypeID: 7, quantity: 6 }],
        fuelCharge: 6, fuelTypeID: 7,
      } }),
    },
    jumpTimers: {
      resolveJumpFatigueMultiplier: () => 1,
      calculateJumpTimers: () => ({ activationSeconds: 120,
        fatigueSeconds: 1200, jumpFatigue: "filetime" }),
    },
  };
  const result = buildNpcJumpDrivePlan(entity, 2, adapters);
  assert.equal(result.success, true);
  assert.equal(result.data.fuelDebit.fuelCharge, 6);
  assert.equal(result.data.fuelDebit.fatigueFiletime, "filetime");
  assert.equal(result.data.fuelDebit.cooldownUntilMs > Date.now(), true);
  assert.equal(entity.conditionState.fuelQueue[0].quantity, 10);
});

test("a stranded NPC checkpoints a fuel request without creating fuel", () => {
  const f = fixture();
  f.adapters.worldData = { getSolarSystemByID: (id) => ({ position: {
    x: id === 1 ? 0 : 9_460_730_472_580_800, y: 0, z: 0,
  } }) };
  f.adapters.jumpDrive = { buildJumpDrivePlan: () => ({ success: false,
    errorMsg: "INSUFFICIENT_FUEL", fuelTypeID: 7, fuelQuantity: 4 }) };
  f.adapters.routePlanner.planNpcTravelRoute = () => ({ success: false,
    errorMsg: "NPC_TRAVEL_ROUTE_UNAVAILABLE" });
  f.adapters.fuelLogistics = { loadNpcFuelFromCargo: () => ({ success: false,
    errorMsg: "NPC_FUEL_CARGO_UNAVAILABLE" }) };
  const result = advanceNpcTravel(f.context, 2, f.adapters);
  assert.equal(result.status, "suspended");
  assert.equal(result.checkpoint.fuelRequest.fuelTypeID, 7);
  assert.equal(result.checkpoint.fuelRequest.quantity, 4);
  assert.equal(f.context.entity.conditionState.fuelCharge, undefined);
});
