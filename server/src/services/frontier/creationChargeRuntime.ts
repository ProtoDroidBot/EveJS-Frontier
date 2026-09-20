"use strict";

/**
 * Creation-native charge custody.
 *
 * Frontier Creation modules do not use the conventional ship-slot charge
 * representation. The retail client stores a loaded charge as a real
 * inventory row beneath the module item itself:
 *
 *   locationID = Creation module itemID
 *   flagID     = 184 (flagCreationModuleCharge)
 *
 * Reload/unload therefore cannot delegate to DogmaIM.LoadAmmo, whose charge
 * identity is keyed by (shipID, fittingFlagID, typeID).
 */

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  syncChargeGodmaPrimeForSession,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const {
  buildEffectiveItemAttributeMap,
  buildShipResourceState,
  evaluateModuleChargeCompatibility,
  getAttributeIDByNames,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  ABILITY_DEPLOY,
  registerCreationAbilityHandler,
  resolveCreationAbilityHandler,
} = require(path.join(__dirname, "./creationAbilityRuntime"));
const {
  CREATION_FITTING_FLAG_ID,
  getCreationDogmaContext,
  isCreationModuleOnline,
} = require(path.join(__dirname, "./creationRuntime"));
const {
  buildCreationSnapshot,
} = require(path.join(__dirname, "./creationCompatibility"));
const launchBayPayloadRuntime = require(path.join(
  __dirname,
  "./launchBayPayloadRuntime",
));

const CREATION_MODULE_CHARGE_FLAG_ID = 184;
const CHARGE_CATEGORY_ID = 8;
const DEPLOYABLE_CATEGORY_ID = 22;
const LOADABLE_CATEGORY_IDS = new Set([
  CHARGE_CATEGORY_ID,
  DEPLOYABLE_CATEGORY_ID,
]);
const FILETIME_TICKS_PER_MILLISECOND = 10000n;
const CAPACITY_EPSILON = 1.0e-6;
const ATTRIBUTE_RELOAD_TIME = getAttributeIDByNames("reloadTime") || 1795;
const LAUNCH_BAY_BEHAVIOR = "launch_bay";
const PAYLOAD_GROUP_ID = 5142;
const TYPE_LAUNCH_BAY = 95811;
const TYPE_HEAT_TRAP = 95812;
const ATTRIBUTE_HEAT_TRANSFER_AMOUNT = 6322;
const ATTRIBUTE_TEMPERATURE = 5765;
const NOMINAL_HEAT_TRAP_TEMPERATURE_K = 295;

function toPositiveSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function itemQuantity(item) {
  const quantity = Number(item && (item.stacksize ?? item.quantity));
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
}

function isLoadableCategory(item) {
  return LOADABLE_CATEGORY_IDS.has(Number(item && item.categoryID));
}

function getSessionCharacterID(session) {
  return toPositiveSafeInteger(
    session && (session.characterID || session.charID || session.charid),
  );
}

function getSessionActiveShipID(session) {
  return toPositiveSafeInteger(
    session && session._space && session._space.shipID,
  ) || toPositiveSafeInteger(
    session && (session.activeShipID || session.shipID || session.shipid),
  );
}

function getSessionFileTime(session) {
  return (
    session &&
    session._space &&
    typeof session._space.simFileTime === "bigint"
  ) ? session._space.simFileTime : currentFileTime();
}

function getReloadTimeMs(moduleItem) {
  const attributes = buildEffectiveItemAttributeMap(moduleItem || {});
  const effectiveReloadTime = Number(
    attributes && attributes[ATTRIBUTE_RELOAD_TIME],
  );
  const staticReloadTime = Number(
    getTypeAttributeValue(moduleItem && moduleItem.typeID, "reloadTime"),
  );
  const reloadTime = Number.isFinite(effectiveReloadTime)
    ? effectiveReloadTime
    : staticReloadTime;
  return Number.isFinite(reloadTime) && reloadTime > 0
    ? Math.max(0, Math.round(reloadTime))
    : 0;
}

function getContextNowMs(context) {
  const dependency = context && context.dependencies && context.dependencies.nowMs;
  const value = typeof dependency === "function" ? dependency() : dependency;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : Date.now();
}

function getLaunchBayReadyAtMs(moduleItem) {
  return Math.max(
    0,
    toFiniteNumber(
      moduleItem && moduleItem.moduleState &&
        moduleItem.moduleState.creationLaunchBayReadyAtMs,
      0,
    ),
  );
}

function getReadyFileTime(session, moduleItem, nowMs = Date.now(), readyAtMs = null) {
  const authoredReadyAtMs = Number(readyAtMs);
  const hasAuthoredReadyAt = readyAtMs !== null && readyAtMs !== undefined;
  const remainingMs = hasAuthoredReadyAt && Number.isFinite(authoredReadyAtMs)
    ? Math.max(0, authoredReadyAtMs - toFiniteNumber(nowMs, Date.now()))
    : getReloadTimeMs(moduleItem);
  return getSessionFileTime(session) + (
    BigInt(Math.max(0, Math.round(remainingMs))) * FILETIME_TICKS_PER_MILLISECOND
  );
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isLaunchBayModule(moduleItem) {
  return toPositiveSafeInteger(moduleItem && moduleItem.typeID) === TYPE_LAUNCH_BAY;
}

function validateLaunchBayReady(moduleItem, nowMs) {
  if (!isLaunchBayModule(moduleItem)) {
    return { success: true as const, data: { readyAtMs: 0 } };
  }
  const readyAtMs = getLaunchBayReadyAtMs(moduleItem);
  if (readyAtMs > nowMs) {
    return {
      success: false as const,
      errorMsg: "CREATION_MODULE_RELOADING",
      params: { readyAtMs, remainingMs: readyAtMs - nowMs },
    };
  }
  return { success: true as const, data: { readyAtMs } };
}

function withLaunchBayReadyAt(moduleItem, readyAtMs, onlineState = null) {
  return {
    ...moduleItem,
    moduleState: {
      ...(moduleItem.moduleState || {}),
      ...(typeof onlineState === "boolean" ? { online: onlineState } : {}),
      creationLaunchBayReadyAtMs: Math.max(0, Math.round(readyAtMs)),
    },
  };
}

function normalizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toFiniteNumber(source.x, fallback.x),
    y: toFiniteNumber(source.y, fallback.y),
    z: toFiniteNumber(source.z, fallback.z),
  };
}

function normalizeDirection(value) {
  const direction = normalizeVector(value, { x: 1, y: 0, z: 0 });
  const length = Math.hypot(direction.x, direction.y, direction.z);
  return length > 1.0e-9
    ? { x: direction.x / length, y: direction.y / length, z: direction.z / length }
    : { x: 1, y: 0, z: 0 };
}

function buildLaunchPosition(shipEntity, payloadItem) {
  const position = normalizeVector(shipEntity && shipEntity.position);
  const direction = normalizeDirection(shipEntity && shipEntity.direction);
  const shipRadius = Math.max(0, toFiniteNumber(shipEntity && shipEntity.radius, 0));
  const payloadRadius = Math.max(
    1,
    toFiniteNumber(payloadItem && (payloadItem.spaceRadius || payloadItem.radius), 1),
  );
  const offset = shipRadius + payloadRadius + 25;
  return {
    x: position.x + direction.x * offset,
    y: position.y + direction.y * offset,
    z: position.z + direction.z * offset,
  };
}

function findMovedItemChange(changes, movedItemID) {
  return (Array.isArray(changes) ? changes : []).find(
    (change) => toPositiveSafeInteger(change && change.item && change.item.itemID) === movedItemID,
  ) || null;
}

function rollbackLaunchedPayload(
  itemID,
  moduleItemID,
  previousPayloadState = null,
  previousModuleState = null,
) {
  const current = itemStore.findItemById(itemID);
  if (!current) {
    return false;
  }
  const normalized = itemStore.updateInventoryItem(itemID, (item) => ({
    ...item,
    singleton: 0,
    launcherID: null,
    expiresAtMs: previousPayloadState && previousPayloadState.expiresAtMs || null,
    conditionState: previousPayloadState && previousPayloadState.conditionState || item.conditionState,
    customInfo: previousPayloadState && previousPayloadState.customInfo || "",
    spaceState: null,
  }));
  if (!normalized.success) {
    return false;
  }
  const moved = itemStore.moveItemToLocation(
    itemID,
    moduleItemID,
    CREATION_MODULE_CHARGE_FLAG_ID,
    1,
    { affectsFitting: true },
  );
  if (previousModuleState) {
    itemStore.updateInventoryItem(moduleItemID, (item) => ({
      ...item,
      moduleState: previousModuleState.moduleState,
    }));
  }
  return moved.success === true;
}

function calculateHeatTrapTransfer(shipEntity, payloadItem) {
  if (toPositiveSafeInteger(payloadItem && payloadItem.typeID) !== TYPE_HEAT_TRAP) {
    return {
      transferredHeat: 0,
      shipPreviousTemperature: null,
      shipNextTemperature: null,
    };
  }
  const attributes = buildEffectiveItemAttributeMap(payloadItem) || {};
  const maximumTransfer = Math.max(
    0,
    toFiniteNumber(attributes[ATTRIBUTE_HEAT_TRANSFER_AMOUNT], 0),
  );
  const shipPreviousTemperature = Math.max(
    0,
    toFiniteNumber(
      shipEntity && shipEntity.temperatureState && shipEntity.temperatureState.temperature,
      toFiniteNumber(
        shipEntity && shipEntity.conditionState && shipEntity.conditionState.temperature,
        NOMINAL_HEAT_TRAP_TEMPERATURE_K,
      ),
    ),
  );
  const transferredHeat = Math.max(
    0,
    Math.min(maximumTransfer, shipPreviousTemperature - NOMINAL_HEAT_TRAP_TEMPERATURE_K),
  );
  if (transferredHeat <= 0) {
    return {
      transferredHeat: 0,
      shipPreviousTemperature,
      shipNextTemperature: shipPreviousTemperature,
    };
  }
  return {
    transferredHeat,
    shipPreviousTemperature,
    shipNextTemperature: shipPreviousTemperature - transferredHeat,
  };
}

function applyHeatTrapTransfer(resolved, shipEntity, heat, nowMs) {
  if (!heat || heat.transferredHeat <= 0) {
    return { success: true as const, rollback() {} };
  }
  const previousConditionState = shipEntity.conditionState;
  const previousTemperatureState = shipEntity.temperatureState;
  const persistedShip = itemStore.findItemById(resolved.creationID);
  const previousPersistedConditionState = persistedShip && persistedShip.conditionState;
  const nextTemperature = heat.shipNextTemperature;
  const persisted = itemStore.updateShipItem(resolved.creationID, (shipItem) => ({
    ...shipItem,
    conditionState: {
      ...(shipItem.conditionState || {}),
      temperature: nextTemperature,
    },
  }));
  if (!persisted.success) {
    return persisted;
  }
  shipEntity.conditionState = {
    ...(shipEntity.conditionState || {}),
    temperature: nextTemperature,
  };
  if (shipEntity.temperatureState && typeof shipEntity.temperatureState === "object") {
    shipEntity.temperatureState = {
      ...shipEntity.temperatureState,
      temperature: nextTemperature,
      lastUpdatedAtMs: nowMs,
    };
  }
  return {
    success: true as const,
    rollback() {
      shipEntity.conditionState = previousConditionState;
      shipEntity.temperatureState = previousTemperatureState;
      itemStore.updateShipItem(resolved.creationID, (shipItem) => ({
        ...shipItem,
        conditionState: previousPersistedConditionState,
      }));
    },
  };
}

function getCreationModuleChargeState(characterID, moduleItemID) {
  const numericCharacterID = toPositiveSafeInteger(characterID);
  const numericModuleItemID = toPositiveSafeInteger(moduleItemID);
  if (numericCharacterID <= 0 || numericModuleItemID <= 0) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_CONTEXT_INVALID" };
  }
  const rows = itemStore.listContainerItems(
    null,
    numericModuleItemID,
    CREATION_MODULE_CHARGE_FLAG_ID,
  );
  if (rows.length === 0) {
    return { success: true as const, data: { item: null, quantity: 0 } };
  }
  if (rows.length !== 1) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_STATE_INVALID" };
  }
  const item = rows[0];
  const quantity = itemQuantity(item);
  if (
    toPositiveSafeInteger(item.ownerID) !== numericCharacterID ||
    toPositiveSafeInteger(item.locationID) !== numericModuleItemID ||
    Number(item.flagID) !== CREATION_MODULE_CHARGE_FLAG_ID ||
    !isLoadableCategory(item) ||
    Number(item.singleton) !== 0 ||
    quantity <= 0
  ) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_STATE_INVALID" };
  }
  return { success: true as const, data: { item, quantity } };
}

function resolveCreationChargeContext(context) {
  const characterID = toPositiveSafeInteger(context && context.characterID);
  const creationID = toPositiveSafeInteger(
    context && context.creationItem && context.creationItem.itemID,
  );
  const moduleItemID = toPositiveSafeInteger(context && context.moduleItemID);
  const moduleTypeID = toPositiveSafeInteger(
    context && context.moduleEntry && context.moduleEntry.typeID,
  );
  const session = context && context.session;
  if (
    characterID <= 0 ||
    characterID !== getSessionCharacterID(session) ||
    creationID <= 0 ||
    creationID !== getSessionActiveShipID(session) ||
    moduleItemID <= 0 ||
    moduleTypeID <= 0
  ) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_CONTEXT_INVALID" };
  }

  const creationItem = itemStore.findShipItemById(creationID);
  const moduleItem = itemStore.findItemById(moduleItemID);
  if (
    !creationItem ||
    toPositiveSafeInteger(creationItem.ownerID) !== characterID ||
    !moduleItem ||
    toPositiveSafeInteger(moduleItem.ownerID) !== characterID ||
    toPositiveSafeInteger(moduleItem.locationID) !== creationID ||
    Number(moduleItem.flagID) !== CREATION_FITTING_FLAG_ID ||
    Number(moduleItem.singleton) !== 1 ||
    toPositiveSafeInteger(moduleItem.typeID) !== moduleTypeID
  ) {
    return { success: false as const, errorMsg: "CREATION_MODULE_NOT_AVAILABLE" };
  }

  const loaded = getCreationModuleChargeState(characterID, moduleItemID);
  if (loaded.success === false) {
    return loaded;
  }
  return {
    success: true as const,
    data: {
      characterID,
      creationID,
      creationItem,
      creationState: context.creationState,
      creationTemplate: context.creationTemplate,
      loadedItem: loaded.data.item,
      loadedQuantity: loaded.data.quantity,
      moduleItem,
      moduleItemID,
      moduleTypeID,
      session,
    },
  };
}

function getCreationCargoCapacity(characterID, creationItem) {
  const dogmaContext = getCreationDogmaContext(creationItem, characterID);
  if (!dogmaContext || dogmaContext.success !== true) {
    return 0;
  }
  const resourceState = buildShipResourceState(
    characterID,
    dogmaContext.data.item,
    {
      additionalAttributeModifierEntries:
        dogmaContext.data.shipAttributeModifierEntries || [],
    },
  );
  const capacity = Number(resourceState && resourceState.cargoCapacity);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
}

function getCargoUsedVolume(characterID, creationID) {
  return itemStore.listContainerItems(
    characterID,
    creationID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).reduce((total, item) => (
    total + (
      Math.max(0, itemStore.getInventoryItemUnitVolume(item)) *
      itemQuantity(item)
    )
  ), 0);
}

function validateCargoCapacityAfterExchange(
  resolved,
  outgoingCargoVolume,
  incomingCargoVolume,
) {
  const capacity = getCreationCargoCapacity(
    resolved.characterID,
    resolved.creationItem,
  );
  const used = getCargoUsedVolume(
    resolved.characterID,
    resolved.creationID,
  );
  const nextUsed = Math.max(0, used - outgoingCargoVolume + incomingCargoVolume);
  if (
    nextUsed > used + CAPACITY_EPSILON &&
    nextUsed > capacity + CAPACITY_EPSILON
  ) {
    return {
      success: false as const,
      errorMsg: "CREATION_CARGO_CAPACITY_EXCEEDED",
      params: { capacity, used, required: nextUsed },
    };
  }
  return { success: true as const, data: { capacity, nextUsed, used } };
}

function notifyInventoryChanges(session, changes, loadedItem = null) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    try {
      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        { emitCfgLocation: false },
      );
    } catch (error) {
      log.warn(
        `[CreationCharge] Inventory notification failed item=${
          toPositiveSafeInteger(change.item.itemID)
        }: ${error && error.message ? error.message : error}`,
      );
    }
  }
  if (loadedItem) {
    try {
      syncChargeGodmaPrimeForSession(session, loadedItem.locationID, loadedItem, {
        description: "charge",
        includeInvItem: true,
      });
    } catch (error) {
      log.warn(
        `[CreationCharge] Dogma notification failed module=${
          toPositiveSafeInteger(loadedItem.locationID)
        }: ${error && error.message ? error.message : error}`,
      );
    }
  }
}

function notifyCreationChanged(resolved) {
  if (
    !resolved ||
    !resolved.session ||
    typeof resolved.session.sendNotification !== "function"
  ) {
    return;
  }
  try {
    const snapshot = buildCreationSnapshot(
      resolved.creationItem,
      resolved.characterID,
      resolved.creationState,
      resolved.creationTemplate,
      {
        getLoadedCharge(moduleItemID) {
          const loaded = getCreationModuleChargeState(
            resolved.characterID,
            moduleItemID,
          );
          if (loaded.success === false || !loaded.data.item) {
            return null;
          }
          return {
            count: loaded.data.quantity,
            typeID: loaded.data.item.typeID,
          };
        },
      },
    );
    resolved.session.sendNotification(
      "OnCreationChanged",
      "clientID",
      [resolved.creationID, snapshot],
    );
  } catch (error) {
    log.warn(
      `[CreationCharge] Creation snapshot notification failed ship=${
        toPositiveSafeInteger(resolved.creationID)
      }: ${error && error.message ? error.message : error}`,
    );
  }
}

function normalizeAmmoItemIDs(value) {
  const source = Array.isArray(value)
    ? value
    : value instanceof Set
      ? [...value]
      : [];
  const itemIDs: any[] = [];
  const seen = new Set<any>();
  for (const valueItemID of source) {
    const itemID = toPositiveSafeInteger(valueItemID);
    if (itemID <= 0 || seen.has(itemID)) {
      return null;
    }
    seen.add(itemID);
    itemIDs.push(itemID);
  }
  return itemIDs.length > 0 ? itemIDs : null;
}

function resolveReloadSources(resolved, requestedTypeID, ammoItemIDs, neededQuantity) {
  const sourceItems: any[] = [];
  let availableQuantity = 0;
  for (const itemID of ammoItemIDs) {
    const item = itemStore.findItemById(itemID);
    const quantity = itemQuantity(item);
    if (
      !item ||
      toPositiveSafeInteger(item.ownerID) !== resolved.characterID ||
      toPositiveSafeInteger(item.locationID) !== resolved.creationID ||
      Number(item.flagID) !== itemStore.ITEM_FLAGS.CARGO_HOLD ||
      !isLoadableCategory(item) ||
      Number(item.singleton) !== 0 ||
      toPositiveSafeInteger(item.typeID) !== requestedTypeID ||
      quantity <= 0
    ) {
      return { success: false as const, errorMsg: "CREATION_CHARGE_SOURCE_INVALID" };
    }
    sourceItems.push({ item, quantity });
    availableQuantity += quantity;
  }
  if (availableQuantity < neededQuantity) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_SOURCE_INSUFFICIENT" };
  }

  let remaining = neededQuantity;
  const moveRequests: any[] = [];
  for (const source of sourceItems) {
    if (remaining <= 0) {
      break;
    }
    const quantity = Math.min(remaining, source.quantity);
    moveRequests.push({ itemID: source.item.itemID, quantity });
    remaining -= quantity;
  }
  return { success: true as const, data: { moveRequests } };
}

function reloadCreationModule(context) {
  const common = resolveCreationChargeContext(context);
  if (common.success === false) {
    return common;
  }
  const resolved = common.data;
  const nowMs = getContextNowMs(context);
  const ready = validateLaunchBayReady(resolved.moduleItem, nowMs);
  if (ready.success === false) {
    return ready;
  }
  const kwargs = context && context.kwargs && typeof context.kwargs === "object"
    ? context.kwargs
    : {};
  const requestedTypeID = toPositiveSafeInteger(kwargs.type_id);
  const ammoLocationID = toPositiveSafeInteger(kwargs.ammo_location_id);
  const ammoItemIDs = normalizeAmmoItemIDs(kwargs.ammo_item_ids);
  if (
    requestedTypeID <= 0 ||
    ammoLocationID !== resolved.creationID ||
    !ammoItemIDs
  ) {
    return { success: false as const, errorMsg: "CREATION_RELOAD_REQUEST_INVALID" };
  }

  const compatibility = evaluateModuleChargeCompatibility(
    resolved.moduleTypeID,
    requestedTypeID,
  );
  const maximumQuantity = toPositiveSafeInteger(
    compatibility && compatibility.maximumQuantity,
  );
  if (!compatibility.accepted || maximumQuantity <= 0) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_INCOMPATIBLE" };
  }

  const loadedTypeID = toPositiveSafeInteger(
    resolved.loadedItem && resolved.loadedItem.typeID,
  );
  if (
    resolved.loadedItem &&
    loadedTypeID === requestedTypeID &&
    resolved.loadedQuantity > maximumQuantity
  ) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_STATE_INVALID" };
  }
  if (
    resolved.loadedItem &&
    loadedTypeID === requestedTypeID &&
    resolved.loadedQuantity === maximumQuantity
  ) {
    return {
      success: true as const,
      data: {
        qty: resolved.loadedQuantity,
        serverTime: getReadyFileTime(
          resolved.session,
          resolved.moduleItem,
          nowMs,
          getLaunchBayReadyAtMs(resolved.moduleItem),
        ),
        type_id: loadedTypeID,
      },
    };
  }

  const retainedQuantity = loadedTypeID === requestedTypeID
    ? resolved.loadedQuantity
    : 0;
  const neededQuantity = maximumQuantity - retainedQuantity;
  if (neededQuantity <= 0) {
    return { success: false as const, errorMsg: "CREATION_CHARGE_STATE_INVALID" };
  }
  const sources = resolveReloadSources(
    resolved,
    requestedTypeID,
    ammoItemIDs,
    neededQuantity,
  );
  if (sources.success === false) {
    return sources;
  }

  const requestedCharge = itemStore.findItemById(
    sources.data.moveRequests[0].itemID,
  );
  const outgoingCargoVolume = Math.max(
    0,
    itemStore.getInventoryItemUnitVolume(requestedCharge),
  ) * neededQuantity;
  const incomingCargoVolume = resolved.loadedItem && loadedTypeID !== requestedTypeID
    ? Math.max(
        0,
        itemStore.getInventoryItemUnitVolume(resolved.loadedItem),
      ) * resolved.loadedQuantity
    : 0;
  const capacity = validateCargoCapacityAfterExchange(
    resolved,
    outgoingCargoVolume,
    incomingCargoVolume,
  );
  if (capacity.success === false) {
    return capacity;
  }

  const launchBayReadyAtMs = isLaunchBayModule(resolved.moduleItem)
    ? nowMs + getReloadTimeMs(resolved.moduleItem)
    : 0;
  const mutation = itemStore.moveItemStacksToLocation(
    sources.data.moveRequests,
    resolved.moduleItemID,
    CREATION_MODULE_CHARGE_FLAG_ID,
    {
      destinationItemID:
        loadedTypeID === requestedTypeID && resolved.loadedItem
          ? resolved.loadedItem.itemID
          : 0,
      moveOptions: { affectsFitting: true },
      preMoves:
        resolved.loadedItem && loadedTypeID !== requestedTypeID
          ? [{
              destinationFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
              destinationLocationID: resolved.creationID,
              itemID: resolved.loadedItem.itemID,
              quantity: resolved.loadedQuantity,
            }]
          : [],
      ...(isLaunchBayModule(resolved.moduleItem)
        ? {
          flush: true,
          updateItemID: resolved.moduleItemID,
          updateItem: (currentItem) => withLaunchBayReadyAt(
            currentItem,
            launchBayReadyAtMs,
            isCreationModuleOnline(resolved.moduleItem),
          ),
        }
        : {}),
    },
  );
  if (!mutation.success) {
    return mutation;
  }

  const loadedItem = mutation.data.destinationItem;
  notifyInventoryChanges(
    resolved.session,
    mutation.data.changes,
    loadedItem,
  );
  notifyCreationChanged(resolved);
  return {
    success: true as const,
    data: {
      qty: maximumQuantity,
      serverTime: getReadyFileTime(
        resolved.session,
        mutation.data.updatedItem || resolved.moduleItem,
        nowMs,
        isLaunchBayModule(resolved.moduleItem) ? launchBayReadyAtMs : null,
      ),
      type_id: requestedTypeID,
    },
  };
}

function unloadCreationModule(context) {
  const common = resolveCreationChargeContext(context);
  if (common.success === false) {
    return common;
  }
  const resolved = common.data;
  if (!resolved.loadedItem) {
    return {
      success: true as const,
      data: { serverTime: getSessionFileTime(resolved.session) },
    };
  }

  const incomingCargoVolume = Math.max(
    0,
    itemStore.getInventoryItemUnitVolume(resolved.loadedItem),
  ) * resolved.loadedQuantity;
  const capacity = validateCargoCapacityAfterExchange(
    resolved,
    0,
    incomingCargoVolume,
  );
  if (capacity.success === false) {
    return capacity;
  }

  const mutation = itemStore.moveItemsToLocations([{
    destinationFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    destinationLocationID: resolved.creationID,
    itemID: resolved.loadedItem.itemID,
    options: { affectsFitting: true },
    quantity: resolved.loadedQuantity,
  }]);
  if (!mutation.success) {
    return mutation;
  }
  notifyInventoryChanges(resolved.session, mutation.data.changes);
  notifyCreationChanged(resolved);
  return {
    success: true as const,
    data: { serverTime: getSessionFileTime(resolved.session) },
  };
}

function deployCreationLaunchBayPayload(context) {
  const common = resolveCreationChargeContext(context);
  if (common.success === false) {
    return common;
  }
  const resolved = common.data;
  const nowMs = getContextNowMs(context);
  const ready = validateLaunchBayReady(resolved.moduleItem, nowMs);
  if (ready.success === false) {
    return ready;
  }
  if (
    resolved.creationState && resolved.creationState.poweredOff === true ||
    !isCreationModuleOnline(resolved.moduleItem)
  ) {
    return { success: false as const, errorMsg: "CREATION_MODULE_OFFLINE" };
  }
  if (!resolved.loadedItem || resolved.loadedQuantity <= 0) {
    return { success: false as const, errorMsg: "CREATION_NO_AMMO" };
  }
  if (
    toPositiveSafeInteger(resolved.loadedItem.categoryID) !== DEPLOYABLE_CATEGORY_ID ||
    toPositiveSafeInteger(resolved.loadedItem.groupID) !== PAYLOAD_GROUP_ID
  ) {
    return { success: false as const, errorMsg: "CREATION_PAYLOAD_NOT_DEPLOYABLE" };
  }

  const sessionSpace = resolved.session && resolved.session._space;
  const systemID = toPositiveSafeInteger(sessionSpace && sessionSpace.systemID);
  if (systemID <= 0) {
    return { success: false as const, errorMsg: "CREATION_NOT_IN_SPACE" };
  }
  const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
  const shipEntity = typeof spaceRuntime.getEntity === "function"
    ? spaceRuntime.getEntity(resolved.session, resolved.creationID)
    : null;
  if (!shipEntity || String(shipEntity.mode || "").toUpperCase() === "WARP") {
    return {
      success: false as const,
      errorMsg: shipEntity ? "CREATION_SHIP_WARPING" : "CREATION_SHIP_NOT_IN_SPACE",
    };
  }

  const position = buildLaunchPosition(shipEntity, resolved.loadedItem);
  const direction = normalizeDirection(shipEntity.direction);
  const scope = require(path.join(
    __dirname,
    "../../space/destiny/identity/interactionScope.js",
  )).buildChildEntityScopeMetadata(shipEntity);
  const heat = calculateHeatTrapTransfer(shipEntity, resolved.loadedItem);
  const launchState = {
    deployedAtMs: nowMs,
    launcherCharacterID: resolved.characterID,
    sourceModuleID: resolved.moduleItemID,
    sourceShipID: resolved.creationID,
    systemID,
    transferredHeat: heat.transferredHeat,
  };
  const decayDurationMs = launchBayPayloadRuntime.getPayloadDecayDurationMs(
    resolved.loadedItem,
  );
  const expiresAtMs = decayDurationMs > 0 ? nowMs + decayDurationMs : null;
  const ambientTemperature = Math.max(
    0,
    toFiniteNumber(
      shipEntity && shipEntity.temperatureState &&
        shipEntity.temperatureState.externalTemperature,
      toFiniteNumber(
        shipEntity && shipEntity.conditionState &&
          shipEntity.conditionState.externalTemperature,
        NOMINAL_HEAT_TRAP_TEMPERATURE_K,
      ),
    ),
  );
  const heatTrapState = toPositiveSafeInteger(resolved.loadedItem.typeID) === TYPE_HEAT_TRAP
    ? launchBayPayloadRuntime.buildHeatTrapState(resolved.loadedItem, {
        ambientTemperature,
        startTemperature: NOMINAL_HEAT_TRAP_TEMPERATURE_K + heat.transferredHeat,
        startTimeMs: nowMs,
      })
    : null;
  const nextReadyAtMs = nowMs + getReloadTimeMs(resolved.moduleItem);
  const moveResult = itemStore.moveItemsToLocationsAndUpdateItem(
    [{
      destinationFlagID: 0,
      destinationLocationID: systemID,
      itemID: resolved.loadedItem.itemID,
      quantity: 1,
      options: {
        affectsFitting: true,
        updateMovedItem: (item) => ({
          ...item,
          ...scope,
          singleton: 1,
          launcherID: resolved.creationID,
          expiresAtMs,
          conditionState: heatTrapState
            ? {
                ...(item.conditionState || {}),
                temperature: heatTrapState.startTemperature,
              }
            : item.conditionState,
          customInfo: launchBayPayloadRuntime.buildCustomInfoWithLaunchState(
            item.customInfo,
            launchState,
            heatTrapState,
          ),
          spaceState: {
            ...scope,
            systemID,
            position,
            velocity: normalizeVector(shipEntity.velocity),
            direction,
            targetPoint: position,
            mode: "STOP",
            speedFraction: 0,
          },
        }),
      },
    }],
    resolved.moduleItemID,
    (moduleItem) => withLaunchBayReadyAt(
      moduleItem,
      nextReadyAtMs,
      isCreationModuleOnline(resolved.moduleItem),
    ),
    { flush: true },
  );
  if (!moveResult.success) {
    return moveResult;
  }
  const firstMove = moveResult.data && moveResult.data.moves && moveResult.data.moves[0];
  const launchedItemID = toPositiveSafeInteger(firstMove && firstMove.movedItemID);
  const launchedChange = findMovedItemChange(
    moveResult.data && moveResult.data.changes,
    launchedItemID,
  );
  const launchedItem = itemStore.findItemById(launchedItemID);
  if (!launchedItemID || !launchedItem) {
    return { success: false as const, errorMsg: "CREATION_PAYLOAD_MOVE_INVALID" };
  }

  const heatCommit = applyHeatTrapTransfer(resolved, shipEntity, heat, nowMs);
  if (!heatCommit.success) {
    rollbackLaunchedPayload(
      launchedItemID,
      resolved.moduleItemID,
      launchedChange && launchedChange.previousData,
      moveResult.previousData,
    );
    return heatCommit;
  }

  const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(
    systemID,
    launchedItemID,
    { entityScopeMetadata: scope },
  );
  if (!spawnResult || spawnResult.success !== true) {
    heatCommit.rollback();
    rollbackLaunchedPayload(
      launchedItemID,
      resolved.moduleItemID,
      launchedChange && launchedChange.previousData,
      moveResult.previousData,
    );
    return {
      success: false as const,
      errorMsg: spawnResult && spawnResult.errorMsg
        ? spawnResult.errorMsg
        : "CREATION_PAYLOAD_SPAWN_FAILED",
    };
  }

  notifyInventoryChanges(
    resolved.session,
    (moveResult.data && moveResult.data.changes) || [],
  );
  notifyCreationChanged(resolved);
  return {
    success: true as const,
    data: {
      item_id: launchedItemID,
      serverTime: getReadyFileTime(
        resolved.session,
        resolved.moduleItem,
        nowMs,
        nextReadyAtMs,
      ),
      transferred_heat: heat.transferredHeat,
      type_id: toPositiveSafeInteger(launchedItem.typeID),
    },
  };
}

function registerCreationLaunchBayAbilityHandler() {
  if (!resolveCreationAbilityHandler(LAUNCH_BAY_BEHAVIOR, ABILITY_DEPLOY)) {
    registerCreationAbilityHandler(LAUNCH_BAY_BEHAVIOR, ABILITY_DEPLOY, {
      execute: deployCreationLaunchBayPayload,
    });
  }
}

module.exports = {
  CHARGE_CATEGORY_ID,
  CREATION_MODULE_CHARGE_FLAG_ID,
  DEPLOYABLE_CATEGORY_ID,
  LAUNCH_BAY_BEHAVIOR,
  PAYLOAD_GROUP_ID,
  TYPE_HEAT_TRAP,
  deployCreationLaunchBayPayload,
  getCreationModuleChargeState,
  registerCreationLaunchBayAbilityHandler,
  reloadCreationModule,
  unloadCreationModule,
  _testing: {
    getCreationCargoCapacity,
    getReadyFileTime,
    resolveCreationChargeContext,
    validateCargoCapacityAfterExchange,
  },
};
