const itemStore = require("../inventory/itemStore");
const blueprints = require("./industryBlueprints");
const spaceRuntime = require("../../space/runtime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const { readConstructionState, isAssemblyActivationPending,
  ASSEMBLY_STATUS_UNDER_CONSTRUCTION } = require("./deploymentRuntime");
const inventoryAccess = require("./industryInventoryAccess");
const { SMART_STORAGE_FLAG } = require("./smartStorageUnitRuntime");
const networkNodeFuel = require("./networkNodeFuelRuntime");
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
function validateCreationHostedFacility(session, facility, facilityID, options: Record<string, any> = {}) {
  const hosted = options && options.creationHost;
  if (!hosted || typeof hosted !== "object" || Array.isArray(hosted)) return null;
  const characterID = positiveInteger(session?.characterID || session?.charid);
  const creationID = positiveInteger(hosted.creationID);
  const moduleItemID = positiveInteger(hosted.moduleItemID);
  const expectedCharacterID = positiveInteger(hosted.characterID);
  if (!characterID || expectedCharacterID !== characterID || moduleItemID !== positiveInteger(facilityID) ||
      Number(facility?.itemID) !== moduleItemID || Number(facility?.ownerID) !== characterID) {
    return fail("ACCESS_DENIED");
  }

  // A hosted facility is authoritative only while this exact persisted item
  // remains fitted to the active Creation.  Merely supplying creationHost in
  // an RPC can never turn a cargo item (or another character's module) into a
  // facility.
  const creationRuntime = require("./creationRuntime");
  if (Number(facility.locationID) !== creationID ||
      Number(facility.flagID) !== Number(creationRuntime.CREATION_FITTING_FLAG_ID)) {
    return fail("FACILITY_NOT_FOUND");
  }
  const ship = itemStore.findItemById(creationID);
  if (!ship || Number(ship.ownerID) !== characterID || Number(ship.categoryID) !== 6) {
    return fail("INVALID_SHIP");
  }
  const state = creationRuntime.readCreationState(ship);
  if (!state || !Array.isArray(state.modules) || !state.modules.some(module =>
    Number(module?.itemID) === moduleItemID && Number(module?.typeID) === Number(facility.typeID))) {
    return fail("FACILITY_NOT_FOUND");
  }

  const activeShipID = positiveInteger(session?._space?.shipID || session?.shipid || session?.shipID);
  if (activeShipID !== creationID) return fail("INVALID_SHIP");
  const stationID = positiveInteger(session?.stationid2 || session?.stationid);
  let shipEntity = null;
  if (stationID > 0) {
    // Creation management (including its Industry tabs) remains usable for
    // the active ship in a station.  Bind it to the exact station inventory;
    // stale ship/session pairs cannot operate a remote fitted module.
    if (Number(ship.locationID) !== stationID ||
        (positiveInteger(session?.locationid) && positiveInteger(session.locationid) !== stationID)) {
      return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");
    }
  } else {
    const solarSystemID = getSessionSolarSystemID(session);
    if (!session?._space || solarSystemID <= 0 || getItemSolarSystemID(ship) !== solarSystemID) {
      return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");
    }
    shipEntity = spaceRuntime.getEntity(session, creationID);
    if (!shipEntity || Number(shipEntity.itemID || shipEntity.entityID) !== creationID ||
        (shipEntity.kind && shipEntity.kind !== "ship")) {
      return fail("INVALID_SHIP");
    }
  }
  return { success: true as const, data: {
    facility, characterID, ship, creationHosted: true, shipEntity,
  } };
}

function validateNpcFacility(facility, facilityID, options: Record<string, any> = {}) {
  if (!options?.npcActor) return null;
  try {
    const actorContext = require("../../space/npc/npcAssemblyActorContext");
    const nativeNpcStore = require("../../space/npc/nativeNpcStore");
    const actor = actorContext.normalizeNpcAssemblyActorContext(options.npcActor);
    const durableEntity = nativeNpcStore.getNativeEntity(actor.shipID);
    const currentActor = actorContext.createNpcAssemblyActorContext(durableEntity);
    if (currentActor.actorID !== actor.actorID || currentActor.shipID !== actor.shipID ||
        currentActor.solarSystemID !== actor.solarSystemID ||
        currentActor.factionKey !== actor.factionKey) return fail("ACCESS_DENIED");

    const requestedLaneID = positiveInteger(options.laneID);
    const npcSession = {
      characterID: actor.actorID,
      charid: actor.actorID,
      corporationID: positiveInteger(durableEntity?.corporationID),
      tribeID: positiveInteger(durableEntity?.tribeID || durableEntity?.tribeId),
      solarsystemid2: actor.solarSystemID,
      _space: { systemID: actor.solarSystemID, shipID: actor.shipID },
    };
    const ownerAccess = Number(facility.ownerID) === actor.actorID;
    const delegatedLaneAccess = requestedLaneID > 0 &&
      require("./industryProduction").canUseLane(facility, npcSession, requestedLaneID);
    if (!ownerAccess) {
      if (!delegatedLaneAccess) return fail(requestedLaneID > 0
        ? "JOB_LANE_ACCESS_DENIED" : "ACCESS_DENIED");
      const assemblyAccess = require("./assemblyAccessRuntime").resolveAccess(
        { ...actor, incarnation: positiveInteger(durableEntity?.npcIncarnation) },
        facilityID,
        ["operate"],
      );
      if (!assemblyAccess?.success) return fail(assemblyAccess?.errorMsg || "ACCESS_DENIED");
    }
    if (getItemSolarSystemID(facility) !== actor.solarSystemID) {
      return fail("FACILITY_NOT_IN_CURRENT_SYSTEM");
    }
    const state = readConstructionState(facility);
    if (state?.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
      return fail("ASSEMBLY_UNDER_CONSTRUCTION");
    }
    if (isAssemblyActivationPending(facility)) return fail("ASSEMBLY_ACTIVATING");

    const ship = itemStore.findItemById(actor.shipID);
    if (!ship || Number(ship.categoryID) !== 6 ||
        getItemSolarSystemID(ship) !== actor.solarSystemID) return fail("INVALID_SHIP");
    const scene = options.scene || spaceRuntime.getSceneForSession(npcSession);
    const shipEntity = scene?.getEntityByID?.(actor.shipID) ||
      spaceRuntime.getEntity(npcSession, actor.shipID);
    const facilityEntity = scene?.getEntityByID?.(Number(facility.itemID)) ||
      spaceRuntime.getEntity(npcSession, facility.itemID);
    if (!shipEntity || !facilityEntity || !canEntitiesInteractLocally(shipEntity, facilityEntity)) {
      return fail("FACILITY_OUT_OF_RANGE");
    }
    const distance = scene?.getCommandTimeEntitySurfaceDistance
      ? scene.getCommandTimeEntitySurfaceDistance(shipEntity, facilityEntity)
      : Infinity;
    if (!Number.isFinite(distance) || distance > MAX_INTERACTION_DISTANCE) {
      return fail("FACILITY_OUT_OF_RANGE");
    }
    return { success: true as const, data: {
      facility,
      characterID: actor.actorID,
      ship,
      shipEntity,
      npcActor: actor,
      inventoryOwnerID: positiveInteger(durableEntity?.ownerID) || actor.actorID,
      delegatedLaneAccess: !ownerAccess,
    } };
  } catch (error) {
    return fail(error?.code || error?.message || "ACCESS_DENIED");
  }
}

function validateFacility(session, facilityID, options: Record<string, any> = {}) {
  const characterID = positiveInteger(session?.characterID || session?.charid);
  const facility = itemStore.findItemById(positiveInteger(facilityID));
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return fail("FACILITY_NOT_FOUND");
  const npcAccess = validateNpcFacility(facility, facilityID, options);
  if (npcAccess) return npcAccess;
  const hosted = validateCreationHostedFacility(session, facility, facilityID, options);
  if (hosted) return hosted;
  if (!characterID) return fail("ACCESS_DENIED");
  const ownerAccess = Number(facility.ownerID) === characterID;
  const requestedLaneID = positiveInteger(options?.laneID);
  const delegatedLaneAccess = requestedLaneID > 0 &&
    require("./industryProduction").canUseLane(facility, session, requestedLaneID);
  if (!ownerAccess && !delegatedLaneAccess) {
    return fail(requestedLaneID > 0 ? "JOB_LANE_ACCESS_DENIED" : "ACCESS_DENIED");
  }
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
function depositInputItems(session, facilityID, rawItems, options: Record<string, any> = {}) {
  const access = validateFacility(session, facilityID, options);
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
      sourceInventories.set(sourceKey,
        inventoryAccess.resolveIndustryInventory(session, item.locationID, item.flagID, options));
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
function withdrawItems(session, facilityID, rawItems, inventoryID, flagID, side = "inputs",
  options: Record<string, any> = {}) {
  const access = validateFacility(session, facilityID, options);
  if (!access.success) return access;
  const { facility } = access.data;
  if (side !== "inputs" && side !== "outputs") return fail("INVALID_INVENTORY");
  const destination = inventoryAccess.resolveIndustryInventory(session, inventoryID, flagID, options);
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
  if (destination.data.virtualInventory === "network_node_fuel") {
    const deposited = networkNodeFuel.depositNetworkNodeFuelFromInventory({
      characterID: access.data.characterID,
      networkNodeID: destination.data.networkNodeID,
      sourceLocationID: facility.itemID,
      sourceFlagID: side === "inputs" ? INDUSTRY_INPUT_FLAG : INDUSTRY_OUTPUT_FLAG,
      items: moves.map(move => ({ itemID: move.itemID, quantity: move.quantity })),
      publishNotice: true,
    });
    if (!deposited.success) return deposited;
    return { success: true as const, data: {
      facility,
      characterID: access.data.characterID,
      side,
      items: Object.fromEntries(requested),
      changes: deposited.data.changes,
      storageTransfers: [],
      networkNodeFuelTransfer: {
        networkNodeID: destination.data.networkNodeID,
        direction: "deposit",
        fuelTypeID: deposited.data.fuelTypeID,
        quantity: deposited.data.depositedQuantity,
      },
    } };
  }
  return commit(access.data, moves, Object.fromEntries(requested), side);
}

function prepareJettisonWithdrawal(
  session,
  facilityID,
  rawItems,
  side = "inputs",
  options: Record<string, any> = {},
) {
  const access = validateFacility(session, facilityID, options);
  if (!access.success) return access;
  const { facility } = access.data;
  if (side !== "inputs" && side !== "outputs") return fail("INVALID_INVENTORY");
  const requested = parseQuantities(rawItems);
  if (!requested) return fail("INVALID_QUANTITY");
  const sourceFlagID = side === "inputs" ? INDUSTRY_INPUT_FLAG : INDUSTRY_OUTPUT_FLAG;
  const rows = storedRows(facility, sourceFlagID)
    .sort((left, right) => left.itemID - right.itemID);
  const moves: any[] = [];
  for (const [typeID, quantity] of requested) {
    let remaining = quantity;
    for (const item of rows) {
      if (Number(item.typeID) !== typeID || remaining <= 0) continue;
      const take = Math.min(remaining, itemQuantity(item));
      if (!take) continue;
      moves.push({ itemID: item.itemID, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) return fail("INSUFFICIENT_STORED_ITEMS");
  }
  return {
    success: true as const,
    data: {
      ...access.data,
      side,
      sourceFlagID,
      items: Object.fromEntries(requested),
      moves,
    },
  };
}

function validateWithdrawalCapacity(destination, requested, volume) {
  if (destination.virtualInventory === "network_node_fuel") {
    const requestedTypes = Array.from(requested, entry => Number(entry[0]));
    if (requestedTypes.length !== 1 ||
        !networkNodeFuel.isAcceptedNetworkNodeFuelType(requestedTypes[0])) {
      return fail("INVALID_DESTINATION_TYPE");
    }
    const fuelState = destination.fuelState || { typeID: 0, quantity: 0 };
    if (fuelState.quantity > 0 && Number(fuelState.typeID) !== requestedTypes[0]) {
      return fail("MIXED_FUEL_TYPES");
    }
    if (!Number.isFinite(volume) || destination.usedVolume + volume > destination.capacity + 1e-6) {
      return fail("FUEL_CAPACITY_EXCEEDED");
    }
    return { success: true as const };
  }
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
    return fail(destination.smartAssemblyID || destination.inventoryKind === "field_storage"
      ? "STORAGE_CAPACITY_EXCEEDED" : "SHIP_CARGO_CAPACITY_EXCEEDED");
  }
  return { success: true as const };
}

function validateStoppedProduction(facility) {
  const productionRuntime = require("./industryProduction");
  if (productionRuntime.invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  if (productionRuntime.hasActiveProduction(facility)) return fail("PRODUCTION_ALREADY_RUNNING");
  return { success: true as const };
}

function emptyActiveBlueprintItems(session, facilityID, storageUnitID, options: Record<string, any> = {}) {
  const access = validateFacility(session, facilityID, options);
  if (!access.success) return access;
  const { facility, characterID } = access.data;
  const stopped = validateStoppedProduction(facility);
  if (!stopped.success) return stopped;
  const destination = inventoryAccess.resolveTransferInventory(session, storageUnitID, options);
  if (!destination.success) return destination;
  const destinationFlag = destination.data.flagID;
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
        destinationLocationID: destination.data.item.itemID, destinationFlagID: destinationFlag });
    }
  }
  if (!moves.length) return fail("FACILITY_ALREADY_EMPTY");
  // Inputs and outputs share one capacity check and one atomic item-table
  // mutation. A failure can never leave only one side emptied.
  const fits = validateWithdrawalCapacity(destination.data, totals, volume);
  if (!fits.success) return fits;
  if (destination.data.virtualInventory === "network_node_fuel") {
    const deposited = networkNodeFuel.depositNetworkNodeFuelFromInventory({
      characterID,
      networkNodeID: destination.data.networkNodeID,
      sourceLocationID: facility.itemID,
      sourceFlagID: -1,
      sourceFlagIDs: [INDUSTRY_INPUT_FLAG, INDUSTRY_OUTPUT_FLAG],
      items: moves.map(move => ({ itemID: move.itemID, quantity: move.quantity })),
      publishNotice: true,
    });
    if (!deposited.success) return deposited;
    return { success: true as const, data: {
      facility,
      characterID,
      side: "all",
      items: Object.fromEntries(totals),
      itemsBySide,
      changes: deposited.data.changes,
      storageTransfers: [],
      networkNodeFuelTransfer: {
        networkNodeID: destination.data.networkNodeID,
        direction: "deposit",
        fuelTypeID: deposited.data.fuelTypeID,
        quantity: deposited.data.depositedQuantity,
      },
    } };
  }
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

async function syncIndustryAssemblyTransfer(result) {
  if (!result?.success) return result;
  try {
    const sync = require("./suiIndustryStorageSync");
    result.data.chain = await sync.syncIndustryAssemblyTransfer({
      facilityID: result.data.facility.itemID,
      characterID: result.data.characterID,
    });
  } catch {
    result.data.chain = { status: "pending", industryStatus: "pending", storageStatus: "disabled" };
  }
  result.data.gameCommitted = true;
  return result;
}

function withStorageStates(session, facilityID, inventories, operation, options: Record<string, any> = {}) {
  const assemblyInventoryIDs = [...new Set(inventories.flatMap(inventory => {
    const item = itemStore.findItemById(positiveInteger(inventory.inventoryID));
    return inventoryAccess.getSmartAssemblyInventoryFlag(item) === Number(inventory.flagID)
      ? [positiveInteger(inventory.inventoryID)] : [];
  }).filter(Boolean))];
  if (!assemblyInventoryIDs.length) {
    const result = operation();
    if (!options.storageUnitID) return result;
    return result instanceof Promise
      ? result.then(syncIndustryAssemblyTransfer)
      : syncIndustryAssemblyTransfer(result);
  }
  const access = validateFacility(session, facilityID, options);
  if (!access.success) return access;
  for (const inventory of inventories) {
    const resolved = inventoryAccess.resolveIndustryInventory(session, inventory.inventoryID,
      inventory.flagID, { ...options, refreshingStatus: true });
    if (!resolved.success) return resolved;
  }
  const unavailable = error => fail(error?.code === "ASSEMBLY_STATE_PENDING"
    ? "ASSEMBLY_STATE_PENDING" : "ASSEMBLY_STATE_UNAVAILABLE");
  try {
    const assemblyIDs = options.creationHost
      ? assemblyInventoryIDs
      : [positiveInteger(facilityID), ...assemblyInventoryIDs];
    const result = runWithSuiAssemblyStates(assemblyIDs, operation);
    // The disabled-chain profile remains synchronous. Live chain operations
    // refresh every involved assembly and commit once on the shared queue.
    if (result instanceof Promise) return result.then(value => value?.data?.storageTransfers?.length
      ? syncStorageTransfers(value) : syncIndustryAssemblyTransfer(value), unavailable);
    if (result.success) {
      result.data.chain = { status: "disabled", industryStatus: "disabled", storageStatus: "disabled" };
      result.data.gameCommitted = true;
    }
    return result;
  } catch (error) { return unavailable(error); }
}

function depositInputItemsWithStorageState(session, facilityID, rawItems, options: Record<string, any> = {}) {
  const requested = parseQuantities(rawItems, true);
  if (!requested) return depositInputItems(session, facilityID, rawItems, options);
  const inventories = Array.from(requested.keys()).map(itemID => {
    const item = itemStore.findItemById(itemID);
    return { itemID, inventoryID: Number(item?.locationID), flagID: Number(item?.flagID) };
  });
  if (options.storageUnitID) {
    const expectedID = positiveInteger(options.storageUnitID);
    const expected = inventoryAccess.resolveTransferInventory(session, expectedID, options);
    if (!expected.success || inventories.some(inventory =>
      inventory.inventoryID !== expectedID || inventory.flagID !== expected.data.flagID)) {
      return fail("INVALID_SOURCE");
    }
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
    return depositInputItems(session, facilityID, rawItems, options);
  }, options);
}

// The native SSU inventory exposes aggregate type rows without real item IDs.
// Resolve those quantities to this character's persisted partition before the
// usual authoritative refresh and atomic transfer revalidation.
function depositStorageInputItems(session, facilityID, storageUnitID, rawItems,
  options: Record<string, any> = {}) {
  const access = validateFacility(session, facilityID, options);
  if (!access.success) return access;
  if (!positiveInteger(storageUnitID)) return fail("INVALID_SOURCE");
  const requested = parseQuantities(rawItems);
  if (!requested || Array.from(requested.values()).some(quantity => quantity > 0xffffffff)) {
    return fail("INVALID_QUANTITY");
  }
  const source = inventoryAccess.resolveTransferInventory(session, storageUnitID, options);
  if (!source.success) return fail("INVALID_SOURCE");
  if (source.data.virtualInventory === "network_node_fuel") {
    return withStorageStates(session, facilityID, [{
      inventoryID: positiveInteger(storageUnitID),
      flagID: source.data.flagID,
    }], () => {
      const currentAccess = validateFacility(session, facilityID, options);
      if (!currentAccess.success) return currentAccess;
      const currentSource = inventoryAccess.resolveTransferInventory(session, storageUnitID, options);
      if (!currentSource.success || currentSource.data.virtualInventory !== "network_node_fuel") {
        return fail("INVALID_SOURCE");
      }
      const entries = Array.from(requested);
      if (entries.length !== 1) return fail("INVALID_INPUT_TYPE");
      const [typeID, quantity] = entries[0];
      const blueprint = blueprints.getSelectedBlueprint(currentAccess.data.facility);
      const slot = blueprint?.inputs?.[typeID];
      if (!blueprint) return fail("BLUEPRINT_NOT_LOADED");
      if (!slot || !networkNodeFuel.isAcceptedNetworkNodeFuelType(typeID)) return fail("INVALID_INPUT_TYPE");
      const totals = getFacilityItems(currentAccess.data.facility).inputs;
      if ((totals[typeID] || 0) + quantity > slot.max_storable_quantity) {
        return fail("INPUT_CAPACITY_EXCEEDED");
      }
      const fuelState = currentSource.data.fuelState;
      if (fuelState.typeID !== typeID || fuelState.quantity < quantity) {
        return fail("INSUFFICIENT_SOURCE_ITEMS");
      }
      const withdrawn = networkNodeFuel.withdrawNetworkNodeFuelToInventory({
        characterID: currentAccess.data.characterID,
        networkNodeID: positiveInteger(storageUnitID),
        fuelTypeID: typeID,
        quantity,
        destinationLocationID: currentAccess.data.facility.itemID,
        destinationFlagID: INDUSTRY_INPUT_FLAG,
        publishNotice: true,
      });
      if (!withdrawn.success) return withdrawn;
      return { success: true as const, data: {
        facility: currentAccess.data.facility,
        characterID: currentAccess.data.characterID,
        side: "inputs",
        items: { [typeID]: quantity },
        changes: withdrawn.data.changes,
        storageTransfers: [],
        networkNodeFuelTransfer: {
          networkNodeID: positiveInteger(storageUnitID),
          direction: "withdraw",
          fuelTypeID: typeID,
          quantity,
        },
      } };
    }, options);
  }
  const rows = itemStore.listContainerItems(access.data.characterID, positiveInteger(storageUnitID), source.data.flagID)
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
  return depositInputItemsWithStorageState(session, facilityID, selected, { ...options, storageUnitID });
}

function withdrawItemsWithStorageState(session, facilityID, rawItems, inventoryID, flagID, side = "inputs",
  options: Record<string, any> = {}) {
  return withStorageStates(session, facilityID, [{ inventoryID: positiveInteger(inventoryID), flagID: Number(flagID) }],
    () => {
      if (typeof options.assertAccess === "function") {
        const allowed = options.assertAccess();
        if (!allowed?.success) return allowed || fail("ACCESS_DENIED");
      }
      return withdrawItems(session, facilityID, rawItems, inventoryID, flagID, side, options);
    }, options);
}
function emptyActiveBlueprint(session, facilityID, storageUnitID, options: Record<string, any> = {}) {
  if (!positiveInteger(storageUnitID)) return fail("INVALID_DESTINATION");
  const destination = inventoryAccess.resolveTransferInventory(session, storageUnitID, options);
  if (!destination.success) return fail("INVALID_DESTINATION");
  const flagID = destination.data.flagID;
  return withStorageStates(session, facilityID,
    [{ inventoryID: positiveInteger(storageUnitID), flagID }], () => {
      if (typeof options.assertAccess === "function") {
        const allowed = options.assertAccess();
        if (!allowed?.success) return allowed || fail("ACCESS_DENIED");
      }
      return emptyActiveBlueprintItems(session, facilityID, storageUnitID, options);
    }, options);
}
function loadBlueprint(session, facilityID, blueprintID, options: Record<string, any> = {}) {
  const access = validateFacility(session, facilityID, options);
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
  prepareJettisonWithdrawal,
  withdrawItems: withdrawItemsWithStorageState, emptyActiveBlueprint, loadBlueprint,
  validateFacility,
  getProduction: (...args) => require("./industryProduction").getProduction(...args),
  configuredLaneCount: (...args) => require("./industryProduction").configuredLaneCount(...args),
  configuredLaneCountForType: (...args) => require("./industryProduction").configuredLaneCountForType(...args),
  getFacilityLaneCount: (...args) => require("./industryProduction").getFacilityLaneCount(...args),
  getProductions: (...args) => require("./industryProduction").getProductions(...args),
  getJobLanes: (...args) => require("./industryProduction").getJobLanes(...args),
  setLaneAccessPolicy: (...args) => require("./industryProduction").setLaneAccessPolicy(...args),
  hasActiveProduction: (...args) => require("./industryProduction").hasActiveProduction(...args),
  startProduction: (...args) => require("./industryProduction").startProduction(...args),
  discontinueProduction: (...args) => require("./industryProduction").discontinueProduction(...args),
  advanceProduction: (...args) => require("./industryProduction").advanceProduction(...args),
};
