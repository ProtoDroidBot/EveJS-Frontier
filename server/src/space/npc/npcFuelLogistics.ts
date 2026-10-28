"use strict";

const path = require("path");

const OPERATION_TYPE = "npc-fuel-cargo-load";

function positiveInt(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function quantity(item) {
  return Number(item?.singleton) === 1 ? 1 : positiveInt(item?.stacksize ?? item?.quantity);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultAdapters() {
  return {
    persistence: require("./npcRuntimePersistence"),
    store: require("./nativeNpcStore"),
    runtime: require(path.join(__dirname, "../runtime")),
    itemStore: require(path.join(__dirname, "../../services/inventory/itemStore")),
    fitting: require(path.join(__dirname, "../../services/fitting/liveFittingState")),
    fuelTank: require(path.join(__dirname, "../../services/frontier/fuelTankRuntime")),
    itemTypes: require(path.join(__dirname, "../../services/inventory/itemTypeRegistry")),
  };
}

function createNpcFuelLogistics(overrides: Record<string, any> = {}) {
  const deps = { ...defaultAdapters(), ...overrides };

  function planCargoLoad(entityID, preferredFuelTypeID = 0) {
    const entity = deps.store.getNativeEntity(positiveInt(entityID));
    if (!entity || entity.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const shipItem = {
      itemID: entity.entityID,
      ownerID: entity.ownerID,
      typeID: positiveInt(entity.playerFittingHullTypeID) || positiveInt(entity.typeID),
      categoryID: 6,
      conditionState: clone(entity.conditionState || {}),
    };
    const modules = deps.store.listNativeModulesForEntity(entityID)
      .filter((record) => record.moduleState?.online === true)
      .map((record) => deps.itemStore.findItemById(record.moduleID))
      .filter(Boolean);
    let resources;
    try {
      resources = deps.fitting.buildShipResourceState(
        positiveInt(entity.npcCharacterID), shipItem,
        { fittedItems: modules, includeActiveImplantModifiers: false },
      );
    } catch (_) {
      return { success: false, errorMsg: "NPC_FUEL_FITTING_UNAVAILABLE" };
    }
    const capacity = Number(resources?.attributes?.[deps.fuelTank.ATTRIBUTE_FUEL_CAPACITY] || 0);
    const tank = deps.fuelTank.resolveShipFuelTank(shipItem, capacity);
    if (!tank.supported) return { success: false, errorMsg: "NPC_FUEL_TANK_UNAVAILABLE" };
    const allowedGroups = new Set(deps.fuelTank.getAllowedShipFuelGroupIDs(shipItem, tank, {
      listContainerItems: (_ownerID, _shipID, flagID) =>
        modules.filter((module) => Number(module.flagID) === Number(flagID)),
    }));
    const beforeQueue = deps.fuelTank.getShipFuelQueue(shipItem);
    const used = beforeQueue.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0);
    let free = Math.max(0, Math.floor(capacity - used));
    if (free < 1) return { success: false, errorMsg: "NPC_FUEL_TANK_FULL" };
    const candidates = deps.store.listNativeCargoForEntity(entityID)
      .filter((record) => !positiveInt(record.moduleID))
      .map((record) => deps.itemStore.findItemById(record.cargoID))
      .filter((item) => item && positiveInt(item.locationID) === entityID &&
        deps.fuelTank.isSupportedFuelType(item.typeID) &&
        allowedGroups.has(positiveInt(
          item.groupID || deps.itemTypes.resolveItemByTypeID(item.typeID)?.groupID,
        )))
      .sort((left, right) =>
        Number(right.typeID === preferredFuelTypeID) - Number(left.typeID === preferredFuelTypeID) ||
        Number(right.typeID === beforeQueue[0]?.fuelTypeID) -
          Number(left.typeID === beforeQueue[0]?.fuelTypeID) ||
        left.itemID - right.itemID);
    const entries: any[] = [];
    let afterQueue = beforeQueue;
    for (const item of candidates) {
      if (free < 1) break;
      const loaded = Math.min(free, quantity(item));
      if (!loaded) continue;
      entries.push({ itemID: item.itemID, typeID: item.typeID,
        ownerID: item.ownerID, locationID: item.locationID, flagID: item.flagID,
        beforeQuantity: quantity(item), quantity: loaded });
      afterQueue = deps.fuelTank.appendFuelQueueBatch(afterQueue, item.typeID, loaded);
      free -= loaded;
    }
    if (!entries.length) return { success: false, errorMsg: "NPC_FUEL_CARGO_UNAVAILABLE" };
    return { success: true, data: { entityID, beforeQueue, afterQueue, entries,
      fuelCharge: afterQueue.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0),
      fuelTypeID: afterQueue[0]?.fuelTypeID || 0 } };
  }

  function finishOperation(operation) {
    if (!operation || operation.operationType !== OPERATION_TYPE) {
      return { success: false, errorMsg: "NPC_FUEL_OPERATION_INVALID" };
    }
    if (operation.status === "committed") {
      return { success: true, data: operation.result, idempotent: true };
    }
    if (["failed", "compensated"].includes(operation.status)) {
      return { success: false, errorMsg: operation.lastError || "NPC_FUEL_OPERATION_TERMINAL" };
    }
    const payload = operation.payload || {};
    const entity = deps.store.getNativeEntity(positiveInt(payload.entityID));
    if (!entity || entity.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const entries = payload.entries || [];
    const before = entries.every((entry) =>
      quantity(deps.itemStore.findItemById(entry.itemID)) === entry.beforeQuantity);
    const after = entries.every((entry) =>
      quantity(deps.itemStore.findItemById(entry.itemID)) ===
        entry.beforeQuantity - entry.quantity);
    if (!before && !after) return { success: false, errorMsg: "NPC_FUEL_CARGO_CHANGED" };
    const currentQueue = deps.fuelTank.getShipFuelQueue({ conditionState: entity.conditionState || {} });
    const alreadySaved = entity.conditionState?.npcFuelLoadOperationID === operation.operationID;
    if (!alreadySaved && JSON.stringify(currentQueue) !== JSON.stringify(payload.beforeQueue)) {
      return { success: false, errorMsg: "NPC_FUEL_TANK_CHANGED" };
    }
    if (before) {
      const consumed = deps.itemStore.consumeInventoryItems(entries.map((entry) => ({
        itemID: entry.itemID, quantity: entry.quantity,
        expected: { ownerID: entry.ownerID, locationID: entry.locationID,
          flagID: entry.flagID, typeID: entry.typeID },
      })), { flush: true });
      if (!consumed?.success) return consumed || { success: false, errorMsg: "NPC_FUEL_LOAD_FAILED" };
    }
    deps.persistence.checkpointNpcOperation(operation.operationID, "CARGO_CONSUMED");
    for (const entry of entries) {
      const item = deps.itemStore.findItemById(entry.itemID);
      if (!item) deps.store.removeNativeCargo(entry.itemID);
      else {
        const cargo = deps.store.listNativeCargoForEntity(payload.entityID)
          .find((record) => record.cargoID === entry.itemID);
        if (cargo) deps.store.upsertNativeCargo({ ...cargo, quantity: quantity(item) }, { durable: true });
      }
    }
    if (!alreadySaved) {
      const conditionState = { ...(entity.conditionState || {}),
        fuelQueue: clone(payload.afterQueue), fuelCharge: payload.fuelCharge,
        fuelTypeID: payload.fuelTypeID,
        npcFuelLoadOperationID: operation.operationID };
      const saved = deps.store.upsertNativeEntity({ ...entity, conditionState }, { durable: true });
      if (!saved?.success) return saved;
      const live = deps.runtime.scenes.get(entity.systemID)?.getEntityByID(entity.entityID);
      if (live) live.conditionState = clone(conditionState);
    }
    deps.persistence.checkpointNpcOperation(operation.operationID, "TANK_UPDATED", {}, {
      flushTables: [deps.store.TABLE.ENTITIES, deps.store.TABLE.CARGO],
    });
    const result = { entityID: payload.entityID,
      loadedQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0) };
    deps.persistence.commitNpcOperation(operation.operationID, { result });
    return { success: true, data: result };
  }

  function loadNpcFuelFromCargo(entityID, preferredFuelTypeID = 0) {
    const planned = planCargoLoad(entityID, preferredFuelTypeID);
    if (!planned.success) return planned;
    const key = `npc-fuel-load:${entityID}:${Date.now()}:${planned.data.entries[0].itemID}`;
    const started = deps.persistence.beginNpcOperation(OPERATION_TYPE, key, planned.data);
    if (!started?.data) return started || { success: false, errorMsg: "NPC_FUEL_OPERATION_FAILED" };
    return finishOperation(started.data);
  }

  return { planCargoLoad, loadNpcFuelFromCargo,
    recoverNpcFuelLoadOperation: finishOperation };
}

let defaultRuntime = null;
function getDefaultRuntime() {
  return defaultRuntime ||= createNpcFuelLogistics();
}

module.exports = {
  OPERATION_TYPE,
  createNpcFuelLogistics,
  loadNpcFuelFromCargo: (...args) => getDefaultRuntime().loadNpcFuelFromCargo(...args),
  recoverNpcFuelLoadOperation: (...args) => getDefaultRuntime().recoverNpcFuelLoadOperation(...args),
};
