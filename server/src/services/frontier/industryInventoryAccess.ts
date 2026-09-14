const itemStore = require("../inventory/itemStore");
const spaceRuntime = require("../../space/runtime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const { getShipCargoCapacity } = require("./smartStorageUnitRuntime");
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
  if (flagID === ITEM_FLAGS.CARGO_HOLD) return getShipCargoCapacity(characterID, ship);
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

function resolveIndustryInventory(session, inventoryID, requestedFlagID) {
  const characterID = integer(session?.characterID || session?.charid);
  const systemID = integer(session?._space?.systemID || session?.solarsystemid2 || session?.solarsystemid);
  const shipID = integer(session?._space?.shipID || session?.shipid || session?.shipID);
  const itemID = integer(inventoryID);
  const flagID = integer(requestedFlagID);
  if (characterID <= 0 || systemID < 30000000 || systemID >= 40000000 || shipID <= 0 ||
      itemID <= 0 || flagID < 0 || session?.stationid || session?.stationid2) return fail("INVALID_INVENTORY");
  const ship = itemStore.findItemById(shipID);
  const item = itemID === shipID ? ship : itemStore.findItemById(itemID);
  if (!ship || Number(ship.ownerID) !== characterID || Number(ship.locationID) !== systemID ||
      Number(ship.categoryID) !== 6 || !item || Number(item.ownerID) !== characterID) return fail("ACCESS_DENIED");
  if (Number(item.locationID) !== systemID) return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");

  let capacity;
  if (itemID === shipID) {
    capacity = getShipStorageCapacity(characterID, item, flagID);
  } else {
    // Nearby containers expose their normal flag-0 contents. This explicit
    // classifier excludes SSUs, industry escrow and arbitrary assembly bays.
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

module.exports = { resolveIndustryInventory, isIndustryInventoryItemAllowed };
