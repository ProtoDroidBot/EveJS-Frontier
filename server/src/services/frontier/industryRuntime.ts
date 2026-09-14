const itemStore = require("../inventory/itemStore");
const blueprints = require("./industryBlueprints");
const spaceRuntime = require("../../space/runtime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const { readConstructionState, isAssemblyActivationPending,
  ASSEMBLY_STATUS_UNDER_CONSTRUCTION } = require("./deploymentRuntime");
const inventoryAccess = require("./industryInventoryAccess");

// Server escrow partitions, deliberately separate from cargo, fittings and SSU
// partitions. The Industry client displays type totals, never these row flags.
const INDUSTRY_INPUT_FLAG = 20000;
const INDUSTRY_OUTPUT_FLAG = 20001;
const MAX_INTERACTION_DISTANCE = 5000;

function fail(errorMsg) { return { success: false as const, errorMsg }; }
function positiveInteger(value) {
  if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
function itemQuantity(item) {
  return item?.singleton ? 1 : positiveInteger(item?.stacksize ?? item?.quantity);
}
function getItemSolarSystemID(item) {
  const explicit = positiveInteger(item?.spaceState?.solarSystemID || item?.spaceState?.solarsystemid);
  const locationID = positiveInteger(item?.locationID);
  return explicit || (locationID >= 30000000 && locationID < 40000000 ? locationID : 0);
}
function getSessionSolarSystemID(session) {
  return positiveInteger(session?.solarsystemid2 || session?._space?.systemID ||
    session?.solarsystemid || session?.locationid);
}
function canReadFacility(item, session) {
  const characterID = positiveInteger(session?.characterID || session?.charid);
  return Boolean(item && characterID && (Number(item.ownerID) === characterID ||
    (getSessionSolarSystemID(session) > 0 && getItemSolarSystemID(item) === getSessionSolarSystemID(session))));
}
function validateFacility(session, facilityID) {
  const characterID = positiveInteger(session?.characterID || session?.charid);
  const facility = itemStore.findItemById(positiveInteger(facilityID));
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return fail("FACILITY_NOT_FOUND");
  if (!characterID || Number(facility.ownerID) !== characterID) return fail("ACCESS_DENIED");
  const solarSystemID = getSessionSolarSystemID(session);
  if (solarSystemID <= 0 || getItemSolarSystemID(facility) !== solarSystemID ||
      session?.stationid || session?.stationid2) return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");
  const state = readConstructionState(facility);
  if (state?.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) return fail("ASSEMBLY_UNDER_CONSTRUCTION");
  if (isAssemblyActivationPending(facility)) return fail("ASSEMBLY_ACTIVATING");
  const shipID = positiveInteger(session?._space?.shipID || session?.shipid || session?.shipID);
  const ship = itemStore.findItemById(shipID);
  if (!ship || Number(ship.ownerID) !== characterID || getItemSolarSystemID(ship) !== solarSystemID) {
    return fail("INVALID_SHIP");
  }
  const shipEntity = spaceRuntime.getEntity(session, shipID);
  const facilityEntity = spaceRuntime.getEntity(session, facility.itemID);
  if (!shipEntity || !facilityEntity || !canEntitiesInteractLocally(shipEntity, facilityEntity)) {
    return fail("FACILITY_OUT_OF_RANGE");
  }
  const scene = spaceRuntime.getSceneForSession(session);
  const distance = shipEntity && facilityEntity && scene?.getCommandTimeEntitySurfaceDistance
    ? scene.getCommandTimeEntitySurfaceDistance(shipEntity, facilityEntity) : Infinity;
  if (!Number.isFinite(distance) || distance > MAX_INTERACTION_DISTANCE) return fail("FACILITY_OUT_OF_RANGE");
  return { success: true as const, data: { facility, characterID, ship } };
}
function storedRows(facility, flag) {
  return itemStore.listContainerItems(facility.ownerID, facility.itemID, flag);
}
function aggregate(rows) {
  const totals: Record<string, number> = {};
  for (const item of rows) {
    const quantity = itemQuantity(item);
    if (quantity) totals[item.typeID] = (totals[item.typeID] || 0) + quantity;
  }
  return totals;
}
function getFacilityItems(facility) {
  return {
    inputs: aggregate(storedRows(facility, INDUSTRY_INPUT_FLAG)),
    outputs: aggregate(storedRows(facility, INDUSTRY_OUTPUT_FLAG)),
  };
}
// Do not round, discard invalid entries, or let duplicate decoded dict keys
// turn a request into an unintended quantity. None is the deposit-all contract.
function parseQuantities(raw, allowAll = false) {
  const entries = raw instanceof Map ? Array.from(raw) : raw?.type === "dict" ? raw.entries :
    raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : null;
  if (!Array.isArray(entries) || !entries.length) return null;
  const result = new Map<number, number | null>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const id = positiveInteger(entry[0]);
    const quantity = allowAll && entry[1] === null ? null : positiveInteger(entry[1]);
    if (!id || quantity === 0 || result.has(id)) return null;
    result.set(id, quantity);
  }
  return result;
}
function commit(context, moves, items, side) {
  // One synchronous, atomic item-table mutation keeps both sides conserved,
  // including split stacks and failures partway through a multi-item request.
  const result = itemStore.moveItemsToLocations(moves);
  if (!result.success) return result;
  return { success: true as const, data: {
    facility: context.facility, side, items, changes: result.data.changes,
  } };
}
function depositInputItems(session, facilityID, rawItems) {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility, characterID } = access.data;
  const requested = parseQuantities(rawItems, true);
  if (!requested) return fail("INVALID_QUANTITY");
  const blueprint = blueprints.getSelectedBlueprint(facility);
  if (!blueprint) return fail("BLUEPRINT_NOT_LOADED");
  const totals = getFacilityItems(facility).inputs;
  const moved: Record<string, number> = {};
  const moves = [];
  const sourceInventories = new Map();
  for (const [itemID, requestedQuantity] of requested) {
    const item = itemStore.findItemById(itemID);
    if (!item || Number(item.ownerID) !== characterID) return fail("INVALID_SOURCE");
    const sourceKey = `${item.locationID}:${item.flagID}`;
    if (!sourceInventories.has(sourceKey)) {
      sourceInventories.set(sourceKey, inventoryAccess.resolveIndustryInventory(session, item.locationID, item.flagID));
    }
    if (!sourceInventories.get(sourceKey).success) return fail("INVALID_SOURCE");
    if (item.singleton) return fail("SINGLETON_NOT_ACCEPTED");
    const quantity = requestedQuantity === null ? itemQuantity(item) : requestedQuantity;
    if (!quantity || quantity > itemQuantity(item)) return fail("INSUFFICIENT_SOURCE_ITEMS");
    const slot = blueprint.inputs[item.typeID];
    if (!slot) return fail("INVALID_INPUT_TYPE");
    const total = (totals[item.typeID] || 0) + quantity;
    if (!Number.isSafeInteger(total) || total > slot.max_storable_quantity) return fail("INPUT_CAPACITY_EXCEEDED");
    totals[item.typeID] = total;
    moved[item.typeID] = (moved[item.typeID] || 0) + quantity;
    moves.push({ itemID, quantity, destinationLocationID: facility.itemID, destinationFlagID: INDUSTRY_INPUT_FLAG });
  }
  return commit(access.data, moves, moved, "inputs");
}
function withdrawItems(session, facilityID, rawItems, inventoryID, flagID, side = "inputs") {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility } = access.data;
  if (side !== "inputs" && side !== "outputs") return fail("INVALID_INVENTORY");
  const destination = inventoryAccess.resolveIndustryInventory(session, inventoryID, flagID);
  if (!destination.success) return fail("INVALID_DESTINATION");
  const { item: destinationItem, capacity, flagID: destinationFlag } = destination.data;
  const requested = parseQuantities(rawItems);
  if (!requested) return fail("INVALID_QUANTITY");
  const rows = storedRows(facility, side === "inputs" ? INDUSTRY_INPUT_FLAG : INDUSTRY_OUTPUT_FLAG)
    .sort((left, right) => left.itemID - right.itemID);
  const moves = [];
  let volume = 0;
  for (const [typeID, quantity] of requested) {
    let remaining = quantity;
    for (const item of rows) {
      if (Number(item.typeID) !== typeID || remaining <= 0) continue;
      if (!inventoryAccess.isIndustryInventoryItemAllowed(destination.data, item)) return fail("INVALID_DESTINATION_TYPE");
      const take = Math.min(remaining, itemQuantity(item));
      if (!take) continue;
      volume += Math.max(0, itemStore.getInventoryItemUnitVolume(item)) * take;
      moves.push({ itemID: item.itemID, quantity: take,
        destinationLocationID: destinationItem.itemID, destinationFlagID: destinationFlag });
      remaining -= take;
    }
    if (remaining > 0) return fail("INSUFFICIENT_STORED_ITEMS");
  }
  // Ownership controls which rows may move, but every row occupies capacity.
  const usedVolume = itemStore.listContainerItems(null, destinationItem.itemID, destinationFlag)
    .reduce((sum, item) => sum + Math.max(0, itemStore.getInventoryItemUnitVolume(item)) * itemQuantity(item), 0);
  if (!Number.isFinite(volume) || !Number.isFinite(usedVolume) || !Number.isFinite(capacity) ||
      capacity <= 0 || usedVolume + volume > capacity + 1e-6) {
    return fail("SHIP_CARGO_CAPACITY_EXCEEDED");
  }
  return commit(access.data, moves, Object.fromEntries(requested), side);
}
function loadBlueprint(session, facilityID, blueprintID) {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility } = access.data;
  const productionRuntime = require("./industryProduction");
  if (productionRuntime.invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const production = productionRuntime.getProduction(facility);
  if (production && production.state !== "STOPPED") return fail("PRODUCTION_ALREADY_RUNNING");
  const blueprint = blueprints.getBlueprintForFacility(facility.typeID, positiveInteger(blueprintID));
  if (!blueprint) return fail("BLUEPRINT_NOT_FOUND");
  const current = blueprints.getSelectedBlueprint(facility);
  if (current?.blueprint_id === blueprint.blueprint_id) return fail("BLUEPRINT_ALREADY_LOADED");
  const items = getFacilityItems(facility);
  if (Object.keys(items.inputs).length || Object.keys(items.outputs).length) return fail("FACILITY_CONTAINS_ITEMS");
  const result = itemStore.updateInventoryItem(facility.itemID, item => ({
    ...item, customInfo: blueprints.withSelectedBlueprint(item, blueprint.blueprint_id),
  }));
  return result.success ? { success: true as const, data: blueprint } : result;
}
module.exports = {
  INDUSTRY_INPUT_FLAG, INDUSTRY_OUTPUT_FLAG, canReadFacility, getItemSolarSystemID,
  getFacilityItems, depositInputItems, withdrawItems, loadBlueprint,
  validateFacility,
  getProduction: (...args) => require("./industryProduction").getProduction(...args),
  startProduction: (...args) => require("./industryProduction").startProduction(...args),
  discontinueProduction: (...args) => require("./industryProduction").discontinueProduction(...args),
  advanceProduction: (...args) => require("./industryProduction").advanceProduction(...args),
};
