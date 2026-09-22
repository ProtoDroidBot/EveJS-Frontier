"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createNpcFuelLogistics } = require("../src/space/npc/npcFuelLogistics");

test("NPC refueling consumes physical cargo once and recovers after a tank-write failure", () => {
  let entity: any = {
    entityID: 71, itemID: 71, npcCharacterID: 91, typeID: 123,
    ownerID: 91, systemID: 1, transient: false, conditionState: {},
  };
  let cargo: any = { itemID: 81, typeID: 7, groupID: 42,
    ownerID: 91, locationID: 71, flagID: 5, stacksize: 5 };
  let cargoRecord: any = { cargoID: 81, entityID: 71, typeID: 7, quantity: 5 };
  let failFirstWrite = true;
  const operations = new Map();
  const live: any = { itemID: 71, conditionState: {} };
  const logistics = createNpcFuelLogistics({
    store: {
      TABLE: { ENTITIES: "entities", CARGO: "cargo" },
      getNativeEntity: () => entity,
      upsertNativeEntity: (next) => {
        if (failFirstWrite) { failFirstWrite = false; return { success: false }; }
        entity = next;
        return { success: true };
      },
      listNativeModulesForEntity: () => [],
      listNativeCargoForEntity: () => cargoRecord ? [cargoRecord] : [],
      removeNativeCargo: () => { cargoRecord = null; },
      upsertNativeCargo: (next) => { cargoRecord = next; },
    },
    persistence: {
      beginNpcOperation: (type, key, payload) => {
        const operation = { operationID: key, operationType: type,
          status: "prepared", payload };
        operations.set(key, operation);
        return { data: operation };
      },
      checkpointNpcOperation: (key, step) => {
        const operation = operations.get(key);
        operation.status = "applying";
        operation.step = step;
      },
      commitNpcOperation: (key, options) => {
        const operation = operations.get(key);
        operation.status = "committed";
        operation.result = options.result;
      },
    },
    runtime: { scenes: new Map([[1, { getEntityByID: () => live }]]) },
    itemStore: {
      findItemById: (id) => id === 81 ? cargo : null,
      consumeInventoryItems: (entries) => {
        assert.equal(entries[0].quantity, 5);
        cargo = null;
        return { success: true };
      },
    },
    fitting: { buildShipResourceState: () => ({ attributes: { 900: 10 } }) },
    itemTypes: { resolveItemByTypeID: () => ({ groupID: 42 }) },
    fuelTank: {
      ATTRIBUTE_FUEL_CAPACITY: 900,
      resolveShipFuelTank: () => ({ supported: true }),
      getAllowedShipFuelGroupIDs: () => [42],
      isSupportedFuelType: () => true,
      getShipFuelQueue: (ship) => ship.conditionState.fuelQueue || [],
      appendFuelQueueBatch: (queue, fuelTypeID, amount) =>
        [...queue, { fuelTypeID, quantity: amount }],
    },
  });
  const first = logistics.loadNpcFuelFromCargo(71);
  assert.equal(first.success, false);
  assert.equal(cargo, null);
  assert.deepEqual(entity.conditionState, {});
  const operation = [...operations.values()][0];
  const recovered = logistics.recoverNpcFuelLoadOperation(operation);
  assert.equal(recovered.success, true);
  assert.equal(entity.conditionState.fuelCharge, 5);
  assert.equal(entity.conditionState.fuelQueue[0].fuelTypeID, 7);
  assert.equal(live.conditionState.fuelCharge, 5);
  assert.equal(cargoRecord, null);
  assert.equal(operation.status, "committed");
  assert.equal(logistics.recoverNpcFuelLoadOperation(operation).idempotent, true);
});
