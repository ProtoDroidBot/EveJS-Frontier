const itemStore = require("../inventory/itemStore");
const spaceRuntime = require("../../space/runtime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const storage = require("./smartStorageUnitRuntime");
const turret = require("./smartTurretInventoryRuntime");
const fieldStorage = require("./fieldStorageInventoryRuntime");
const { getShipFittingSnapshot } = require("../../_secondary/fitting/fittingRuntime");
const { getShipBaseAttributeValue } = require("../fitting/liveFittingState");
const mining = require("../mining/miningInventory");
const fuel = require("../inventory/fuelBayInventory");
const specialHolds = require("../inventory/specialShipHoldRegistry");
const containers = require("../ship/cargoContainerRuntime");
const mobileDepots = require("../ship/mobileDepotRuntime");

const { ITEM_FLAGS } = itemStore;

function fail(errorMsg) { return { success: false as const, errorMsg }; }
function integer(value) {
  if (!["number", "string", "bigint"].includes(typeof value)) return -1;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : -1;
}

function getShipStorageCapacity(characterID, ship, flagID) {
  if (flagID === ITEM_FLAGS.CARGO_HOLD) return storage.getShipCargoCapacity(characterID, ship);
  if (flagID === ITEM_FLAGS.SHIP_HANGAR || flagID === ITEM_FLAGS.FLEET_HANGAR) {
    return Number(getShipBaseAttributeValue(ship.typeID,
      flagID === ITEM_FLAGS.SHIP_HANGAR ? "shipMaintenanceBayCapacity" : "fleetHangarCapacity"));
  }
  if (!mining.MINING_SHIP_BAY_FLAGS.includes(flagID) && !fuel.isFuelBayFlag(flagID) &&
      !specialHolds.isGenericSpecialShipHoldFlag(flagID)) return 0;
  const resources = getShipFittingSnapshot(characterID, ship.itemID, {
    shipItem: ship, reason: "industry.inventory",
  })?.resourceState;
  if (mining.MINING_SHIP_BAY_FLAGS.includes(flagID)) return mining.getShipHoldCapacityByFlag(resources, flagID);
  if (fuel.isFuelBayFlag(flagID)) return fuel.getFuelBayCapacity(resources);
  return specialHolds.getSpecialShipHoldCapacity(resources, ship.typeID, flagID, getShipBaseAttributeValue);
}

function resolveIndustryInventory(session, inventoryID, requestedFlagID, options: Record<string, any> = {}) {
  const characterID = integer(session?.characterID || session?.charid);
  const systemID = integer(session?._space?.systemID || session?.solarsystemid2 || session?.solarsystemid);
  const shipID = integer(session?._space?.shipID || session?.shipid || session?.shipID);
  const itemID = integer(inventoryID);
  const flagID = integer(requestedFlagID);
  const stationID = integer(session?.stationid2 || session?.stationid);
  const hostedCreationID = integer(options?.creationHost?.creationID);
  const dockedCreationInventory = stationID > 0 && hostedCreationID === shipID && itemID === shipID;
  if (characterID <= 0 || shipID <= 0 || itemID <= 0 || flagID < 0 ||
      (!dockedCreationInventory &&
        (systemID < 30000000 || systemID >= 40000000 || stationID > 0))) return fail("INVALID_INVENTORY");
  const ship = itemStore.findItemById(shipID);
  const item = itemID === shipID ? ship : itemStore.findItemById(itemID);
  const expectedLocationID = dockedCreationInventory ? stationID : systemID;
  if (!ship || Number(ship.ownerID) !== characterID || Number(ship.locationID) !== expectedLocationID ||
      Number(ship.categoryID) !== 6 || !item) return fail("ACCESS_DENIED");
  if (Number(item.locationID) !== expectedLocationID) return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");

  if (itemID !== shipID && flagID === storage.SMART_STORAGE_FLAG) {
    const shipEntity = spaceRuntime.getEntity(session, shipID);
    const targetEntity = spaceRuntime.getEntity(session, itemID);
    const scene = spaceRuntime.getSceneForSession(session);
    const visible = shipEntity && targetEntity && canEntitiesInteractLocally(shipEntity, targetEntity);
    const distance = visible ? scene?.getCommandTimeEntitySurfaceDistance?.(shipEntity, targetEntity) : Infinity;
    const validation = storage.validateStorageUnit(characterID, itemID, {
      access: { authorized: true, activeShipID: shipID, solarSystemID: systemID,
        inRange: Number.isFinite(distance) && distance <= 5000 },
      refreshingStatus: options.refreshingStatus === true,
      requireOnline: options.refreshingStatus !== true,
    });
    if (validation.errorMsg) return fail(validation.errorMsg);
    if (!Number.isFinite(validation.capacity) || validation.capacity <= 0) return fail("INVALID_INVENTORY");
    // SSUs isolate each character's contents and capacity, including visitors.
    return { success: true as const, data: { item, capacity: validation.capacity, flagID,
      smartAssemblyID: itemID, smartAssemblyKind: "storage_unit", storageUnitID: itemID,
      inventoryOwnerID: characterID, maxTypeQuantity: 0xffffffff } };
  }
  if (itemID !== shipID && flagID === turret.SMART_TURRET_INVENTORY_FLAG &&
      turret.getTurretComponent(item.typeID)) {
    const shipEntity = spaceRuntime.getEntity(session, shipID);
    const targetEntity = spaceRuntime.getEntity(session, itemID);
    const scene = spaceRuntime.getSceneForSession(session);
    const visible = shipEntity && targetEntity && canEntitiesInteractLocally(shipEntity, targetEntity);
    const distance = visible ? scene?.getCommandTimeEntitySurfaceDistance?.(shipEntity, targetEntity) : Infinity;
    const validation = turret.validateTurretInventory(characterID, itemID, {
      access: { authorized: true, activeShipID: shipID, solarSystemID: systemID,
        inRange: Number.isFinite(distance) && distance <= 5000 },
      refreshingStatus: options.refreshingStatus === true,
      requireOnline: options.refreshingStatus !== true,
    });
    if (validation.errorMsg) return fail(validation.errorMsg);
    return { success: true as const, data: { item, capacity: validation.capacity, flagID,
      smartAssemblyID: itemID, smartAssemblyKind: "turret", turretID: itemID,
      inventoryOwnerID: characterID, maxTypeQuantity: 0xffffffff } };
  }
  if (itemID !== shipID && flagID === fieldStorage.FIELD_STORAGE_INVENTORY_FLAG &&
      fieldStorage.getFieldStorageComponent(item.typeID)) {
    const shipEntity = spaceRuntime.getEntity(session, shipID);
    const targetEntity = spaceRuntime.getEntity(session, itemID);
    const scene = spaceRuntime.getSceneForSession(session);
    const visible = shipEntity && targetEntity && canEntitiesInteractLocally(shipEntity, targetEntity);
    const distance = visible ? scene?.getCommandTimeEntitySurfaceDistance?.(shipEntity, targetEntity) : Infinity;
    const component = fieldStorage.getFieldStorageComponent(item.typeID);
    const validation = fieldStorage.validateFieldStorageInventory(characterID, itemID, {
      access: { authorized: true, activeShipID: shipID, solarSystemID: systemID,
        inRange: Number.isFinite(distance) && distance <= component.accessRange },
    });
    if (validation.errorMsg) return fail(validation.errorMsg);
    return { success: true as const, data: { item, capacity: validation.capacity, flagID,
      inventoryKind: "field_storage", inventoryOwnerID: characterID, maxTypeQuantity: 0xffffffff } };
  }
  if (Number(item.ownerID) !== characterID) return fail("ACCESS_DENIED");

  let capacity;
  if (itemID === shipID) {
    capacity = getShipStorageCapacity(characterID, item, flagID);
  } else {
    // Nearby containers expose their normal flag-0 contents. This explicit
    // classifier excludes industry escrow and arbitrary assembly bays.
    const metadata = itemStore.getItemMetadata(item.typeID) || {};
    const typedItem = { ...metadata, ...item };
    const isDepot = Number(typedItem.groupID) === mobileDepots.GROUP_MOBILE_DEPOT;
    if (flagID !== 0 || (!isDepot && !containers.isCargoContainerType(typedItem)) ||
        containers.isUnanchoredStructureHullItem(typedItem)) return fail("INVALID_INVENTORY");
    const shipEntity = spaceRuntime.getEntity(session, shipID);
    const targetEntity = spaceRuntime.getEntity(session, itemID);
    const scene = spaceRuntime.getSceneForSession(session);
    if (!shipEntity || !targetEntity || !canEntitiesInteractLocally(shipEntity, targetEntity)) return fail("ACCESS_DENIED");
    const distance = scene?.getCommandTimeEntitySurfaceDistance?.(shipEntity, targetEntity);
    if (!Number.isFinite(distance) || distance > containers.MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS) return fail("FACILITY_OUT_OF_RANGE");
    if (isDepot) {
      const access = mobileDepots.validateMobileDepotCargoAccess(session, item);
      if (!access.success) return fail("ACCESS_DENIED");
    }
    capacity = Number(item.capacity ?? metadata.capacity);
  }
  if (!Number.isFinite(capacity) || capacity <= 0) return fail("INVALID_INVENTORY");
  return { success: true as const, data: { item, capacity, flagID } };
}

function isIndustryInventoryItemAllowed(inventory, item) {
  const flagID = inventory?.flagID;
  if (inventory?.smartAssemblyID) return !item?.singleton;
  if (flagID === 0 || flagID === ITEM_FLAGS.CARGO_HOLD || flagID === ITEM_FLAGS.FLEET_HANGAR) return true;
  if (flagID === ITEM_FLAGS.SHIP_HANGAR) return Number(item?.categoryID) === 6;
  if (mining.MINING_SHIP_BAY_FLAGS.includes(flagID)) {
    const metadata = itemStore.getItemMetadata(item?.typeID) || {};
    return mining.isItemTypeAllowedInHoldFlag({ ...metadata, ...item }, flagID);
  }
  if (fuel.isFuelBayFlag(flagID)) return fuel.isFuelBayCompatibleItem(item);
  return specialHolds.isGenericSpecialShipHoldFlag(flagID) &&
    specialHolds.isSpecialShipHoldItemAllowed(item, flagID) === true;
}

function getSmartAssemblyInventoryFlag(item) {
  if (!item) return -1;
  if (storage.getStorageComponent(item.typeID)) return storage.SMART_STORAGE_FLAG;
  if (turret.getTurretComponent(item.typeID)) return turret.SMART_TURRET_INVENTORY_FLAG;
  return -1;
}

function resolveSmartAssemblyInventory(session, inventoryID, options: Record<string, any> = {}) {
  const item = itemStore.findItemById(integer(inventoryID));
  const flagID = getSmartAssemblyInventoryFlag(item);
  return flagID < 0 ? fail("INVALID_INVENTORY")
    : resolveIndustryInventory(session, inventoryID, flagID, options);
}

function resolveTransferInventory(session, inventoryID, options: Record<string, any> = {}) {
  const itemID = integer(inventoryID);
  const activeShipID = integer(session?._space?.shipID || session?.shipid || session?.shipID);
  const item = itemStore.findItemById(itemID);
  if (!item) return fail("INVALID_INVENTORY");
  if (itemID === activeShipID) return resolveIndustryInventory(session, itemID, ITEM_FLAGS.CARGO_HOLD, options);
  const smartFlag = getSmartAssemblyInventoryFlag(item);
  if (smartFlag >= 0) return resolveIndustryInventory(session, itemID, smartFlag, options);
  if (fieldStorage.getFieldStorageComponent(item.typeID)) {
    return resolveIndustryInventory(session, itemID, fieldStorage.FIELD_STORAGE_INVENTORY_FLAG, options);
  }
  return resolveIndustryInventory(session, itemID, 0, options);
}

module.exports = {
  getSmartAssemblyInventoryFlag,
  isIndustryInventoryItemAllowed,
  resolveIndustryInventory,
  resolveSmartAssemblyInventory,
  resolveTransferInventory,
};
