const itemStore = require("../inventory/itemStore");
const blueprints = require("./industryBlueprints");
const spaceRuntime = require("../../space/runtime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const { readConstructionState, isAssemblyActivationPending,
  ASSEMBLY_STATUS_UNDER_CONSTRUCTION } = require("./deploymentRuntime");
const inventoryAccess = require("./industryInventoryAccess");
const { SMART_STORAGE_FLAG } = require("./smartStorageUnitRuntime");
const { runWithSuiAssemblyStates } = require("./suiAssemblyState");

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
  const storageMoves = moves.flatMap((move, index) => {
    const source = itemStore.findItemById(move.itemID);
    const entry = { index, typeID: Number(source?.typeID), quantity: move.quantity,
      unitVolume: Math.max(0, itemStore.getInventoryItemUnitVolume(source)) };
    return Number(source?.flagID) === SMART_STORAGE_FLAG
      ? [{ ...entry, storageUnitID: Number(source.locationID), direction: "withdraw" }]
      : move.destinationFlagID === SMART_STORAGE_FLAG
        ? [{ ...entry, storageUnitID: move.destinationLocationID, direction: "deposit" }] : [];
  });
  // One synchronous, atomic item-table mutation keeps both sides conserved,
  // including split stacks and failures partway through a multi-item request.
  const result = itemStore.moveItemsToLocations(moves);
  if (!result.success) return result;
  const storageTransfers = new Map();
  for (const move of storageMoves) {
    const key = `${move.storageUnitID}:${move.direction}`;
    if (!storageTransfers.has(key)) storageTransfers.set(key, {
      storageUnitID: move.storageUnitID, direction: move.direction, items: {}, noticeItems: [],
    });
    const transfer = storageTransfers.get(key);
    transfer.items[move.typeID] = (transfer.items[move.typeID] || 0) + move.quantity;
    transfer.noticeItems.push({ itemID: result.data.moves[move.index].movedItemID,
      typeID: move.typeID, quantity: move.quantity, unitVolume: move.unitVolume });
  }
  return { success: true as const, data: {
    facility: context.facility, characterID: context.characterID, side, items,
    changes: result.data.changes, storageTransfers: Array.from(storageTransfers.values()),
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
  const { item: destinationItem, flagID: destinationFlag } = destination.data;
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
  const fits = validateWithdrawalCapacity(destination.data, requested, volume);
  if (!fits.success) return fits;
  return commit(access.data, moves, Object.fromEntries(requested), side);
}

function validateWithdrawalCapacity(destination, requested, volume) {
  // Ownership controls which rows may move; SSU capacity is per character,
  // while other destination inventories count every owner's rows.
  const destinationRows = itemStore.listContainerItems(destination.inventoryOwnerID ?? null,
    destination.item.itemID, destination.flagID);
  if (destination.maxTypeQuantity) {
    const totals = aggregate(destinationRows);
    for (const [typeID, quantity] of requested) {
      const total = (totals[typeID] || 0) + quantity;
      if (!Number.isSafeInteger(total) || total > destination.maxTypeQuantity) {
        return fail("STORAGE_TYPE_QUANTITY_EXCEEDED");
      }
    }
  }
  const usedVolume = destinationRows
    .reduce((sum, item) => sum + Math.max(0, itemStore.getInventoryItemUnitVolume(item)) * itemQuantity(item), 0);
  if (!Number.isFinite(volume) || !Number.isFinite(usedVolume) || !Number.isFinite(destination.capacity) ||
      destination.capacity <= 0 || usedVolume + volume > destination.capacity + 1e-6) {
    return fail(destination.storageUnitID ? "STORAGE_CAPACITY_EXCEEDED" : "SHIP_CARGO_CAPACITY_EXCEEDED");
  }
  return { success: true as const };
}

function validateStoppedProduction(facility) {
  const productionRuntime = require("./industryProduction");
  if (productionRuntime.invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const production = productionRuntime.getProduction(facility);
  if (production && production.state !== "STOPPED") return fail("PRODUCTION_ALREADY_RUNNING");
  return { success: true as const };
}

function emptyActiveBlueprintItems(session, facilityID, storageUnitID) {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility, characterID } = access.data;
  const stopped = validateStoppedProduction(facility);
  if (!stopped.success) return stopped;
  const destination = inventoryAccess.resolveIndustryInventory(session, storageUnitID, SMART_STORAGE_FLAG);
  if (!destination.success) return destination;
  if (!destination.data.storageUnitID) return fail("INVALID_DESTINATION");
  const moves = [];
  const itemsBySide = { inputs: {}, outputs: {} };
  const totals = new Map<number, number>();
  let volume = 0;
  for (const [side, flag] of [["inputs", INDUSTRY_INPUT_FLAG], ["outputs", INDUSTRY_OUTPUT_FLAG]] as const) {
    // Read actual escrow rows, including types no longer in the current recipe.
    // Unexpected owners or malformed stacks must block an all-items operation.
    const rows = itemStore.listContainerItems(null, facility.itemID, flag)
      .sort((left, right) => left.itemID - right.itemID);
    for (const item of rows) {
      if (Number(item.ownerID) !== characterID) return fail("ACCESS_DENIED");
      const quantity = itemQuantity(item);
      const typeID = positiveInteger(item.typeID);
      if (!quantity || !typeID) return fail("INVALID_QUANTITY");
      if (!inventoryAccess.isIndustryInventoryItemAllowed(destination.data, item)) return fail("INVALID_DESTINATION_TYPE");
      const total = (totals.get(typeID) || 0) + quantity;
      if (!Number.isSafeInteger(total)) return fail("STORAGE_TYPE_QUANTITY_EXCEEDED");
      totals.set(typeID, total);
      itemsBySide[side][typeID] = (itemsBySide[side][typeID] || 0) + quantity;
      volume += Math.max(0, itemStore.getInventoryItemUnitVolume(item)) * quantity;
      moves.push({ itemID: item.itemID, quantity,
        destinationLocationID: destination.data.item.itemID, destinationFlagID: SMART_STORAGE_FLAG });
    }
  }
  if (!moves.length) return fail("FACILITY_ALREADY_EMPTY");
  // Inputs and outputs share one capacity check and one atomic item-table
  // mutation. A failure can never leave only one side emptied.
  const fits = validateWithdrawalCapacity(destination.data, totals, volume);
  if (!fits.success) return fits;
  const result = commit(access.data, moves, Object.fromEntries(totals), "all");
  return result.success ? { ...result, data: { ...result.data, itemsBySide } } : result;
}

async function syncStorageTransfers(result) {
  if (!result?.success || !result.data.storageTransfers?.length) return result;
  const pending = { status: "pending", industryStatus: "pending", storageStatus: "pending" };
  let timer;
  // The inventory has committed. A delayed chain confirmation must never make
  // the client retry that mutation; the synchronization worker keeps retrying.
  const syncing = Promise.all(result.data.storageTransfers.map(async transfer => {
    try {
      const { syncIndustryStorageTransfer } = require("./suiIndustryStorageSync");
      return { storageUnitID: transfer.storageUnitID, ...await syncIndustryStorageTransfer({
        facilityID: result.data.facility.itemID, characterID: result.data.characterID,
        storageUnitID: transfer.storageUnitID,
      }) };
    } catch { return { storageUnitID: transfer.storageUnitID, ...pending }; }
  }));
  try {
    result.data.chainTransfers = await Promise.race([syncing, new Promise(resolve => {
      timer = setTimeout(() => resolve(result.data.storageTransfers.map(transfer => ({
        storageUnitID: transfer.storageUnitID, ...pending,
      }))), 5000);
    })]);
    result.data.chain = result.data.chainTransfers[0];
    result.data.gameCommitted = true;
    return result;
  } finally { clearTimeout(timer); }
}

function withStorageStates(session, facilityID, inventories, operation) {
  const storageIDs = [...new Set(inventories.filter(inventory => inventory.flagID === SMART_STORAGE_FLAG)
    .map(inventory => inventory.inventoryID))];
  if (!storageIDs.length) return operation();
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  for (const inventory of inventories) {
    const resolved = inventoryAccess.resolveIndustryInventory(session, inventory.inventoryID,
      inventory.flagID, { refreshingStatus: true });
    if (!resolved.success) return resolved;
  }
  const unavailable = error => fail(error?.code === "ASSEMBLY_STATE_PENDING"
    ? "ASSEMBLY_STATE_PENDING" : "ASSEMBLY_STATE_UNAVAILABLE");
  try {
    const result = runWithSuiAssemblyStates([positiveInteger(facilityID), ...storageIDs], operation);
    // The disabled-chain profile remains synchronous. Live chain operations
    // refresh every involved assembly and commit once on the shared queue.
    if (result instanceof Promise) return result.then(syncStorageTransfers, unavailable);
    if (result.success && result.data.storageTransfers?.length) {
      result.data.chain = { status: "disabled", industryStatus: "disabled", storageStatus: "disabled" };
      result.data.gameCommitted = true;
    }
    return result;
  } catch (error) { return unavailable(error); }
}

function depositInputItemsWithStorageState(session, facilityID, rawItems, options: Record<string, any> = {}) {
  const requested = parseQuantities(rawItems, true);
  if (!requested) return depositInputItems(session, facilityID, rawItems);
  const inventories = Array.from(requested.keys()).map(itemID => {
    const item = itemStore.findItemById(itemID);
    return { itemID, inventoryID: Number(item?.locationID), flagID: Number(item?.flagID) };
  });
  if (options.storageUnitID && inventories.some(inventory =>
    inventory.inventoryID !== positiveInteger(options.storageUnitID) || inventory.flagID !== SMART_STORAGE_FLAG)) {
    return fail("INVALID_SOURCE");
  }
  return withStorageStates(session, facilityID, inventories, () => {
    if (typeof options.assertAccess === "function") {
      const allowed = options.assertAccess();
      if (!allowed?.success) return allowed || fail("ACCESS_DENIED");
    }
    // Waiting for chain state must not silently redirect a source to a new SSU
    // that was not part of the authoritative refresh.
    if (inventories.some(inventory => {
      const item = itemStore.findItemById(inventory.itemID);
      return !item || Number(item.locationID) !== inventory.inventoryID || Number(item.flagID) !== inventory.flagID;
    })) return fail("INVALID_SOURCE");
    return depositInputItems(session, facilityID, rawItems);
  });
}

// The native SSU inventory exposes aggregate type rows without real item IDs.
// Resolve those quantities to this character's persisted partition before the
// usual authoritative refresh and atomic transfer revalidation.
function depositStorageInputItems(session, facilityID, storageUnitID, rawItems) {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  if (!positiveInteger(storageUnitID)) return fail("INVALID_SOURCE");
  const requested = parseQuantities(rawItems);
  if (!requested || Array.from(requested.values()).some(quantity => quantity > 0xffffffff)) {
    return fail("INVALID_QUANTITY");
  }
  const rows = itemStore.listContainerItems(access.data.characterID, positiveInteger(storageUnitID), SMART_STORAGE_FLAG)
    .filter(item => !item.singleton).sort((left, right) => left.itemID - right.itemID);
  const selected = new Map();
  for (const [typeID, quantity] of requested) {
    let remaining = quantity;
    for (const item of rows) {
      if (Number(item.typeID) !== typeID || !remaining) continue;
      const take = Math.min(remaining, itemQuantity(item));
      if (take) selected.set(item.itemID, take);
      remaining -= take;
    }
    if (remaining) return fail("INSUFFICIENT_SOURCE_ITEMS");
  }
  return depositInputItemsWithStorageState(session, facilityID, selected, { storageUnitID });
}

function withdrawItemsWithStorageState(session, facilityID, rawItems, inventoryID, flagID, side = "inputs",
  options: Record<string, any> = {}) {
  return withStorageStates(session, facilityID, [{ inventoryID: positiveInteger(inventoryID), flagID: Number(flagID) }],
    () => {
      if (typeof options.assertAccess === "function") {
        const allowed = options.assertAccess();
        if (!allowed?.success) return allowed || fail("ACCESS_DENIED");
      }
      return withdrawItems(session, facilityID, rawItems, inventoryID, flagID, side);
    });
}
function emptyActiveBlueprint(session, facilityID, storageUnitID, options: Record<string, any> = {}) {
  if (!positiveInteger(storageUnitID)) return fail("INVALID_DESTINATION");
  return withStorageStates(session, facilityID,
    [{ inventoryID: positiveInteger(storageUnitID), flagID: SMART_STORAGE_FLAG }], () => {
      if (typeof options.assertAccess === "function") {
        const allowed = options.assertAccess();
        if (!allowed?.success) return allowed || fail("ACCESS_DENIED");
      }
      return emptyActiveBlueprintItems(session, facilityID, storageUnitID);
    });
}
function loadBlueprint(session, facilityID, blueprintID) {
  const access = validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility } = access.data;
  const stopped = validateStoppedProduction(facility);
  if (!stopped.success) return stopped;
  const blueprint = blueprints.getBlueprintForFacility(facility.typeID, positiveInteger(blueprintID));
  if (!blueprint) return fail("BLUEPRINT_NOT_FOUND");
  const current = blueprints.getSelectedBlueprint(facility);
  if (current?.blueprint_id === blueprint.blueprint_id) return fail("BLUEPRINT_ALREADY_LOADED");
  if ([INDUSTRY_INPUT_FLAG, INDUSTRY_OUTPUT_FLAG].some(flag =>
    itemStore.listContainerItems(null, facility.itemID, flag).length)) return fail("FACILITY_CONTAINS_ITEMS");
  const result = itemStore.updateInventoryItem(facility.itemID, item => ({
    ...item, customInfo: blueprints.withSelectedBlueprint(item, blueprint.blueprint_id),
  }));
  return result.success ? { success: true as const, data: blueprint } : result;
}
module.exports = {
  INDUSTRY_INPUT_FLAG, INDUSTRY_OUTPUT_FLAG, canReadFacility, getItemSolarSystemID,
  getFacilityItems, depositInputItems: depositInputItemsWithStorageState,
  depositStorageInputItems,
  withdrawItems: withdrawItemsWithStorageState, emptyActiveBlueprint, loadBlueprint,
  validateFacility,
  getProduction: (...args) => require("./industryProduction").getProduction(...args),
  startProduction: (...args) => require("./industryProduction").startProduction(...args),
  discontinueProduction: (...args) => require("./industryProduction").discontinueProduction(...args),
  advanceProduction: (...args) => require("./industryProduction").advanceProduction(...args),
};
