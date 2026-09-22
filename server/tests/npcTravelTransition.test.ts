"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createNpcTravelTransitionRuntime } = require("../src/space/npc/npcTravelTransition");

function fixture() {
  let entity: any = {
    entityID: 77, itemID: 77, systemID: 1, npcCharacterID: 90000001,
    npcIncarnation: 2, transient: false, conditionState: {},
    position: { x: 0, y: 0, z: 0 },
  };
  let controller: any = { entityID: 77, systemID: 1, profileID: "test" };
  let pilot: any = { characterID: 90000001, activeEntityID: 77, incarnation: 2, systemID: 1 };
  const source = { entity: { itemID: 77 }, getEntityByID: (id) => id === 77 ? source.entity : null };
  const destination = { entity: null, getEntityByID: (id) => id === 77 ? destination.entity : null };
  const scenes = new Map([[1, source], [2, destination]]);
  const operations = new Map();
  const persistence = {
    beginNpcOperation: (operationType, key, payload) => {
      if (!operations.has(key)) operations.set(key, {
        operationID: key, operationType, idempotencyKey: key,
        status: "prepared", step: "prepared", payload,
      });
      return { data: operations.get(key) };
    },
    checkpointNpcOperation: (id, step) => {
      const operation = operations.get(id);
      operation.status = "applying";
      operation.step = step;
      return { data: operation };
    },
    commitNpcOperation: (id, options) => {
      const operation = operations.get(id);
      operation.status = "committed";
      operation.result = options.result;
      return { data: operation };
    },
    failNpcOperation: (id) => { operations.get(id).status = "compensated"; },
    releaseSpawnLeaseByEntity: () => ({ success: true }),
  };
  const store = {
    TABLE: { ENTITIES: "npcEntities", CONTROLLERS: "npcRuntimeControllers", CARGO: "npcCargo" },
    getNativeEntity: () => entity,
    getNativeController: () => controller,
    upsertNativeEntity: (next) => { entity = next; return { success: true }; },
    upsertNativeController: (next) => { controller = next; return { success: true }; },
    listNativeCargoForEntity: () => [],
  };
  const runtime = createNpcTravelTransitionRuntime({
    persistence, store,
    nativeService: {
      dematerializeNativeController: () => { source.entity = null; return { success: true }; },
      materializeStoredNativeController: (scene) => {
        scene.entity = { itemID: 77 };
        return { success: true };
      },
    },
    runtime: { scenes, ensureScene: (id) => scenes.get(id) || null },
    worldData: {
      getSolarSystemByID: (id) => [1, 2].includes(id) ? { solarSystemID: id } : null,
      getStargatesForSystem: () => [],
      getStaticSceneForSystem: () => [],
    },
    pilots: {
      get: () => pilot,
      update: (_id, update) => { pilot = update(pilot); return pilot; },
    },
    itemStore: { findItemById: () => null },
    routePlanner: { validateNpcTravelEdge: (edge) => ({ success: true, data: edge }) },
  });
  return { runtime, operations, get entity() { return entity; },
    setEntity(next) { entity = next; },
    get controller() { return controller; }, get pilot() { return pilot; }, source, destination };
}

test("NPC travel keeps the same entity and pilot identity across systems", () => {
  const f = fixture();
  const edge = { kind: "stargate", sourceSystemID: 1, destinationSystemID: 2,
    sourceID: 101, destinationID: 201, destinationPosition: { x: 100, y: 0, z: 0 } };
  const moved = f.runtime.transitionNpcThroughEdge(77, edge, { idempotencyKey: "test-hop" });
  assert.equal(moved.success, true);
  assert.equal(f.source.entity, null);
  assert.equal(f.destination.entity.itemID, 77);
  assert.equal(f.entity.systemID, 2);
  assert.equal(f.controller.systemID, 2);
  assert.equal(f.pilot.systemID, 2);
  assert.equal(f.pilot.activeEntityID, 77);
  assert.equal(f.operations.get("test-hop").status, "committed");
  assert.equal(f.runtime.recoverNpcTravelOperation(f.operations.get("test-hop")).idempotent, true);
});

test("NPC travel recovery repairs a destination entity with an old controller and pilot location", () => {
  const f = fixture();
  f.source.entity = null;
  f.setEntity({ ...f.entity, systemID: 2 });
  const operation = {
    operationID: "repair", operationType: "npc-travel-transition",
    status: "applying", step: "INVENTORY_MOVED",
    payload: {
      entityID: 77, npcCharacterID: 90000001, incarnation: 2,
      sourceSystemID: 1, destinationSystemID: 2, sourceID: 501,
      destinationID: 0, routeKind: "catapult", cargoIDs: [],
    },
  };
  f.operations.set("repair", operation);
  const recovered = f.runtime.recoverNpcTravelOperation(operation);
  assert.equal(recovered.success, true);
  assert.equal(f.entity.systemID, 2);
  assert.equal(f.controller.systemID, 2);
  assert.equal(f.pilot.systemID, 2);
  assert.equal(f.destination.entity.itemID, 77);
  assert.equal(operation.status, "committed");
});

test("NPC jump transfer debits its durable Frontier tank exactly once", () => {
  const f = fixture();
  f.setEntity({ ...f.entity, conditionState: {
    fuelQueue: [{ fuelTypeID: 7, quantity: 10 }], fuelCharge: 10,
    fuelTypeID: 7, temperature: 100,
  } });
  const edge = { kind: "jump-drive", sourceSystemID: 1,
    destinationSystemID: 2, sourceID: 0, destinationID: 0 };
  const moved = f.runtime.transitionNpcThroughEdge(77, edge, {
    idempotencyKey: "jump-fuel",
    jumpFuelDebit: {
      mode: "frontier-tank",
      previousFuelQueue: [{ fuelTypeID: 7, quantity: 10 }],
      fuelQueue: [{ fuelTypeID: 7, quantity: 6 }],
      fuelCharge: 6, fuelTypeID: 7, nextTemperature: 105,
      cooldownUntilMs: 50_000,
    },
  });
  assert.equal(moved.success, true);
  assert.equal(f.entity.conditionState.fuelCharge, 6);
  assert.equal(f.entity.conditionState.temperature, 105);
  assert.equal(f.entity.conditionState.npcTravelFuelDebitOperationID, "jump-fuel");
  assert.equal(f.runtime.recoverNpcTravelOperation(f.operations.get("jump-fuel")).idempotent, true);
  assert.equal(f.entity.conditionState.fuelCharge, 6);
});
