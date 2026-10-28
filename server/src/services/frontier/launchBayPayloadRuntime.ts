"use strict";

/**
 * Runtime authority for Creation Launch Bay payloads (client build 3502403).
 *
 * The client SDE authors these as ordinary group-5142 deployables, so their
 * inventory row remains the durable identity.  This module projects the
 * authored decay/behavior/thermal components onto that row and its ballpark
 * entity without creating a second, transient identity.
 */

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const {
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const {
  buildEffectiveItemAttributeMap,
  buildShipResourceState,
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const {
  getCreationDogmaContext,
} = require(path.join(__dirname, "./creationRuntime"));
const {
  canEntitiesInteractLocally,
} = require(path.join(
  __dirname,
  "../../space/destiny/identity/interactionScope.js",
));

const PAYLOAD_GROUP_ID = 5142;
const DEPLOYABLE_CATEGORY_ID = 22;
const TYPE_FIELD_CAIRN = 93141;
const TYPE_HEAT_TRAP = 95812;
const TYPE_FIELD_SENTRY = 96099;
const LAUNCH_STATE_KEY = "evejsFrontierLaunchBay";
const HEAT_TRAP_STATE_KEY = "evejsFrontierHeatTrap";
const ATTRIBUTE_HEAT_CAPACITY = 5762;
const ATTRIBUTE_HEAT_CONDUCTANCE = 5763;
const ATTRIBUTE_TEMPERATURE = 5765;
const ATTRIBUTE_VOLATILITY_THRESHOLD = 6323;
const ATTRIBUTE_DISCHARGE_SCALE_FACTOR = 6324;
const ATTRIBUTE_ON_DEATH_AOE_RADIUS = 2275;
const NOMINAL_TEMPERATURE_K = 295;
const DEFAULT_SCOOP_RANGE_METERS = 2_500;
const FILETIME_TICKS_PER_SECOND = 10_000_000n;

let componentsByTypeID: Map<number, any> | null = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  const source = value && typeof value === "object" ? value : fallback;
  return {
    x: toFiniteNumber(source.x, fallback.x),
    y: toFiniteNumber(source.y, fallback.y),
    z: toFiniteNumber(source.z, fallback.z),
  };
}

function vectorDistance(left, right) {
  const a = cloneVector(left);
  const b = cloneVector(right);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function parseCustomInfo(customInfo) {
  try {
    const parsed = JSON.parse(String(customInfo || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_) {
    return {};
  }
}

function getComponentsByTypeID() {
  if (componentsByTypeID) return componentsByTypeID;
  componentsByTypeID = new Map();
  for (const row of readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE) || []) {
    const typeID = toInt(row && (row.typeID ?? row._key), 0);
    if (typeID > 0) componentsByTypeID.set(typeID, row);
  }
  return componentsByTypeID;
}

function getPayloadComponent(typeIDOrItem) {
  const typeID = toInt(
    typeIDOrItem && typeof typeIDOrItem === "object"
      ? typeIDOrItem.typeID
      : typeIDOrItem,
    0,
  );
  return typeID > 0 ? getComponentsByTypeID().get(typeID) || null : null;
}

function getPayloadDecayDurationMs(typeIDOrItem) {
  const durationSeconds = toFiniteNumber(
    getPayloadComponent(typeIDOrItem)?.decay?.durationSeconds,
    0,
  );
  return durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0;
}

function isLaunchBayPayloadType(typeID) {
  return [TYPE_FIELD_CAIRN, TYPE_HEAT_TRAP, TYPE_FIELD_SENTRY]
    .includes(toInt(typeID, 0));
}

function getLaunchState(item) {
  if (!item || !isLaunchBayPayloadType(item.typeID)) return null;
  const state = parseCustomInfo(item.customInfo)[LAUNCH_STATE_KEY];
  return state && typeof state === "object" ? state : null;
}

function isLaunchBayPayloadItem(item) {
  return Boolean(
    item &&
    toInt(item.categoryID, 0) === DEPLOYABLE_CATEGORY_ID &&
    toInt(item.groupID, 0) === PAYLOAD_GROUP_ID &&
    getLaunchState(item),
  );
}

function resolveHeatTrapDogma(item) {
  const attributes = buildEffectiveItemAttributeMap(item || {}) || {};
  const heatCapacity = Math.max(
    0,
    toFiniteNumber(attributes[ATTRIBUTE_HEAT_CAPACITY], 0),
  );
  const heatConductance = Math.max(
    0,
    toFiniteNumber(attributes[ATTRIBUTE_HEAT_CONDUCTANCE], 0),
  );
  return {
    heatCapacity,
    heatConductance,
    timeScaleSeconds: heatConductance > 0 ? heatCapacity / heatConductance : 0,
    baseTemperature: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_TEMPERATURE], NOMINAL_TEMPERATURE_K),
    ),
    volatilityThreshold: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_VOLATILITY_THRESHOLD], 0),
    ),
    dischargeScaleFactor: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_DISCHARGE_SCALE_FACTOR], 0),
    ),
    onDeathAoeRadius: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_ON_DEATH_AOE_RADIUS], 0),
    ),
  };
}

function buildHeatTrapState(item, options: Record<string, any> = {}) {
  const dogma = resolveHeatTrapDogma(item);
  const startTemperature = Math.max(
    0,
    toFiniteNumber(
      options.startTemperature,
      toFiniteNumber(item?.conditionState?.temperature, dogma.baseTemperature),
    ),
  );
  return {
    ambientTemperature: Math.max(
      0,
      toFiniteNumber(options.ambientTemperature, dogma.baseTemperature),
    ),
    startTemperature,
    startTimeMs: Math.max(0, toFiniteNumber(options.startTimeMs, Date.now())),
    timeScaleSeconds: dogma.timeScaleSeconds,
    volatilityThreshold: dogma.volatilityThreshold,
  };
}

function normalizeHeatTrapState(item, rawState = null) {
  if (!item || toInt(item.typeID, 0) !== TYPE_HEAT_TRAP) return null;
  const launchState = getLaunchState(item) || {};
  const state = rawState && typeof rawState === "object"
    ? rawState
    : parseCustomInfo(item.customInfo)[HEAT_TRAP_STATE_KEY];
  return buildHeatTrapState(item, {
    ambientTemperature: state?.ambientTemperature,
    startTemperature: state?.startTemperature,
    startTimeMs: state?.startTimeMs ?? launchState.deployedAtMs,
  });
}

function getHeatTrapState(item) {
  return normalizeHeatTrapState(item);
}

function temperatureAtHeatTrapState(state, nowMs = Date.now()) {
  if (!state) return NOMINAL_TEMPERATURE_K;
  const ambient = Math.max(0, toFiniteNumber(state.ambientTemperature, 0));
  const starting = Math.max(0, toFiniteNumber(state.startTemperature, ambient));
  const timeScaleSeconds = Math.max(0, toFiniteNumber(state.timeScaleSeconds, 0));
  if (timeScaleSeconds <= 0) return starting;
  const elapsedSeconds = Math.max(
    0,
    (toFiniteNumber(nowMs, Date.now()) - toFiniteNumber(state.startTimeMs, 0)) / 1000,
  );
  return ambient + (starting - ambient) * Math.exp(-elapsedSeconds / timeScaleSeconds);
}

function getHeatTrapTemperature(item, nowMs = Date.now()) {
  return temperatureAtHeatTrapState(getHeatTrapState(item), nowMs);
}

function isHeatTrapVolatile(item, nowMs = Date.now()) {
  const state = getHeatTrapState(item);
  return Boolean(
    state &&
    state.volatilityThreshold > 0 &&
    temperatureAtHeatTrapState(state, nowMs) > state.volatilityThreshold,
  );
}

function resolveHeatTrapDischarge(item, nowMs = Date.now()) {
  if (!item || toInt(item.typeID, 0) !== TYPE_HEAT_TRAP) return null;
  const dogma = resolveHeatTrapDogma(item);
  const temperature = getHeatTrapTemperature(item, nowMs);
  const excessKelvin = Math.max(0, temperature - dogma.volatilityThreshold);
  return {
    damage: excessKelvin * dogma.dischargeScaleFactor,
    damageVector: {
      em: 0,
      thermal: excessKelvin * dogma.dischargeScaleFactor,
      kinetic: 0,
      explosive: 0,
    },
    excessKelvin,
    radiusMeters: dogma.onDeathAoeRadius,
    scaleFactor: dogma.dischargeScaleFactor,
    temperature,
    volatilityThreshold: dogma.volatilityThreshold,
  };
}

function buildCustomInfoWithLaunchState(customInfo, launchState, heatTrapState = null) {
  const parsed = parseCustomInfo(customInfo);
  parsed[LAUNCH_STATE_KEY] = launchState;
  if (heatTrapState) parsed[HEAT_TRAP_STATE_KEY] = heatTrapState;
  else delete parsed[HEAT_TRAP_STATE_KEY];
  return JSON.stringify(parsed);
}

function buildCustomInfoWithoutLaunchState(customInfo) {
  const parsed = parseCustomInfo(customInfo);
  delete parsed[LAUNCH_STATE_KEY];
  delete parsed[HEAT_TRAP_STATE_KEY];
  return Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : "";
}

function hydrateLaunchBayPayloadEntityFromInventoryItem(entity, item, nowMs = Date.now()) {
  if (!entity || !isLaunchBayPayloadItem(item)) return false;
  entity.launchBayPayload = true;
  entity.launchBayPayloadState = getLaunchState(item);
  if (toInt(item.typeID, 0) === TYPE_FIELD_SENTRY) {
    entity.fieldSentryBehaviorName = String(
      getPayloadComponent(item)?.behavior?.behaviorName || "",
    );
    entity.fieldSentryGroupBehaviorID = toInt(
      getPayloadComponent(item)?.behavior?.groupBehaviorID,
      0,
    );
    entity.maxTargetRange = Math.max(
      0,
      toFiniteNumber(getTypeAttributeValue(item.typeID, "maxTargetRange"), 0),
    );
    entity.maxLockedTargets = Math.max(
      1,
      toInt(getTypeAttributeValue(item.typeID, "maxLockedTargets"), 1),
    );
    entity.scanResolution = Math.max(
      1,
      toFiniteNumber(getTypeAttributeValue(item.typeID, "scanResolution"), 1),
    );
  }
  if (toInt(item.typeID, 0) === TYPE_HEAT_TRAP) {
    const state = getHeatTrapState(item);
    const temperature = temperatureAtHeatTrapState(state, nowMs);
    entity.heatTrapState = state;
    entity.heatTrapVolatile = Boolean(
      state && state.volatilityThreshold > 0 && temperature > state.volatilityThreshold,
    );
    entity.conditionState = {
      ...(entity.conditionState || {}),
      temperature,
    };
  }
  return true;
}

function getSessionNotificationKey(session) {
  return String(
    session?.clientID ?? session?.characterID ?? session?.charid ?? "",
  );
}

function sendHeatTrapNotification(session, name, payload) {
  if (!session || typeof session.sendNotification !== "function") return false;
  session.sendNotification(name, "clientID", payload);
  return true;
}

function buildClientCoolingRecipe(scene, state, nowMs) {
  let nowSeconds = toFiniteNumber(nowMs, Date.now()) / 1000;
  try {
    const fileTime = scene && typeof scene.getCurrentFileTime === "function"
      ? scene.getCurrentFileTime()
      : null;
    if (typeof fileTime === "bigint") {
      nowSeconds = Number(fileTime / FILETIME_TICKS_PER_SECOND);
    }
  } catch (_) {
    // Wallclock seconds retain the cooling curve even on a lightweight test scene.
  }
  const elapsedSeconds = Math.max(0, (nowMs - state.startTimeMs) / 1000);
  return {
    ambient_temperature: state.ambientTemperature,
    start_temperature: state.startTemperature,
    start_time: nowSeconds - elapsedSeconds,
    time_scale: state.timeScaleSeconds,
  };
}

function tickHeatTrap(scene, entity, item, nowMs) {
  const state = getHeatTrapState(item);
  if (!state) return false;
  const temperature = temperatureAtHeatTrapState(state, nowMs);
  const volatile = state.volatilityThreshold > 0 && temperature > state.volatilityThreshold;
  const hadVolatilityState = typeof entity.heatTrapVolatile === "boolean";
  const previousVolatile = entity.heatTrapVolatile === true;
  entity.heatTrapState = state;
  entity.heatTrapVolatile = volatile;
  entity.conditionState = {
    ...(entity.conditionState || {}),
    temperature,
  };

  if (!(entity.heatTrapNotifiedSessions instanceof Set)) {
    entity.heatTrapNotifiedSessions = new Set();
  }
  const recipe = buildClientCoolingRecipe(scene, state, nowMs);
  for (const session of scene?.sessions?.values?.() || []) {
    if (
      typeof scene.canSessionSeeDynamicEntity === "function" &&
      !scene.canSessionSeeDynamicEntity(session, entity, nowMs)
    ) {
      continue;
    }
    const key = getSessionNotificationKey(session);
    if (!key || entity.heatTrapNotifiedSessions.has(key)) continue;
    sendHeatTrapNotification(session, "OnHeatTrapCoolingRecipe", [
      entity.itemID,
      recipe,
      state.volatilityThreshold,
    ]);
    sendHeatTrapNotification(session, "OnHeatTrapVolatilityChanged", [
      entity.itemID,
      volatile,
    ]);
    entity.heatTrapNotifiedSessions.add(key);
  }
  if (hadVolatilityState && previousVolatile !== volatile) {
    for (const session of scene?.sessions?.values?.() || []) {
      const key = getSessionNotificationKey(session);
      if (!entity.heatTrapNotifiedSessions.has(key)) continue;
      sendHeatTrapNotification(session, "OnHeatTrapVolatilityChanged", [
        entity.itemID,
        volatile,
      ]);
    }
  }
  return true;
}

function tickScene(scene, nowMs = Date.now()) {
  if (!scene || !(scene.dynamicEntities instanceof Map)) return { heatTrapCount: 0 };
  let heatTrapCount = 0;
  for (const entity of scene.dynamicEntities.values()) {
    if (toInt(entity?.typeID, 0) !== TYPE_HEAT_TRAP) continue;
    const item = itemStore.findItemById(entity.itemID);
    if (!isLaunchBayPayloadItem(item)) continue;
    if (tickHeatTrap(scene, entity, item, nowMs)) heatTrapCount += 1;
  }
  return { heatTrapCount };
}

function getSessionContext(session) {
  return {
    characterID: toInt(session?.characterID ?? session?.charid, 0),
    shipID: toInt(
      session?._space?.shipID ?? session?.activeShipID ?? session?.shipID ?? session?.shipid,
      0,
    ),
    systemID: toInt(
      session?._space?.systemID ?? session?.solarsystemid2 ?? session?.solarsystemid,
      0,
    ),
  };
}

function getShipCargoCapacity(characterID, shipItem) {
  const creationContext = getCreationDogmaContext(shipItem, characterID);
  const resourceState = creationContext?.success === true
    ? buildShipResourceState(characterID, creationContext.data.item, {
        additionalAttributeModifierEntries:
          creationContext.data.shipAttributeModifierEntries || [],
      })
    : buildShipResourceState(characterID, shipItem);
  return Math.max(0, toFiniteNumber(resourceState?.cargoCapacity, 0));
}

function getCargoUsedVolume(characterID, shipID) {
  return itemStore.listContainerItems(
    characterID,
    shipID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).reduce((sum, item) => (
    sum + Math.max(0, itemStore.getInventoryItemUnitVolume(item)) *
      Math.max(1, toInt(item.stacksize ?? item.quantity, 1))
  ), 0);
}

function scoopLaunchBayPayloadToCargo(session, itemID, options: Record<string, any> = {}) {
  const context = getSessionContext(session);
  const item = itemStore.findItemById(itemID);
  const launchState = getLaunchState(item);
  if (!context.characterID || !context.shipID || !context.systemID) {
    return { success: false as const, errorMsg: "INVALID_SESSION" };
  }
  if (!item || !isLaunchBayPayloadItem(item) || !launchState) {
    return { success: false as const, errorMsg: "ITEM_NOT_LAUNCH_BAY_PAYLOAD" };
  }
  if (
    toInt(item.ownerID, 0) !== context.characterID &&
    toInt(launchState.launcherCharacterID, 0) !== context.characterID
  ) {
    return { success: false as const, errorMsg: "LAUNCH_BAY_PAYLOAD_NOT_OWNER" };
  }
  if (
    toInt(item.locationID, 0) !== context.systemID ||
    toInt(item.flagID, -1) !== 0 ||
    !item.spaceState
  ) {
    return { success: false as const, errorMsg: "LAUNCH_BAY_PAYLOAD_NOT_IN_SPACE" };
  }
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  if (toInt(item.typeID, 0) === TYPE_HEAT_TRAP && isHeatTrapVolatile(item, nowMs)) {
    return { success: false as const, errorMsg: "HEAT_TRAP_VOLATILE" };
  }

  const runtime = options.spaceRuntime || require(path.join(
    __dirname,
    "../../space/runtime",
  ));
  const shipEntity = runtime.getEntity(session, context.shipID) || itemStore.findItemById(context.shipID);
  const payloadEntity = runtime.getEntity(session, item.itemID);
  if (!payloadEntity) {
    return { success: false as const, errorMsg: "DYNAMIC_ENTITY_NOT_FOUND" };
  }
  if (!canEntitiesInteractLocally(shipEntity, payloadEntity)) {
    return { success: false as const, errorMsg: "TARGET_TOO_FAR" };
  }
  const shipPosition = shipEntity?.position || shipEntity?.spaceState?.position;
  const payloadPosition = payloadEntity?.position || payloadEntity?.spaceState?.position;
  const scoopRange = Math.max(
    0,
    toFiniteNumber(options.rangeMeters, DEFAULT_SCOOP_RANGE_METERS),
  );
  if (
    shipPosition && payloadPosition &&
    vectorDistance(shipPosition, payloadPosition) > scoopRange
  ) {
    return { success: false as const, errorMsg: "TARGET_TOO_FAR" };
  }

  const shipItem = itemStore.findItemById(context.shipID);
  const resolveCargoCapacity = typeof options.getShipCargoCapacity === "function"
    ? options.getShipCargoCapacity
    : getShipCargoCapacity;
  const resolveCargoUsedVolume = typeof options.getCargoUsedVolume === "function"
    ? options.getCargoUsedVolume
    : getCargoUsedVolume;
  const capacity = resolveCargoCapacity(context.characterID, shipItem);
  const used = resolveCargoUsedVolume(context.characterID, context.shipID);
  const required = Math.max(0, itemStore.getInventoryItemUnitVolume(item));
  if (used + required > capacity + 1.0e-7) {
    return { success: false as const, errorMsg: "NOT_ENOUGH_CARGO_SPACE" };
  }

  const currentTemperature = toInt(item.typeID, 0) === TYPE_HEAT_TRAP
    ? getHeatTrapTemperature(item, nowMs)
    : null;
  const updateResult = itemStore.updateInventoryItem(item.itemID, (currentItem) => ({
    ...currentItem,
    locationID: context.shipID,
    flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    singleton: 1,
    launcherID: null,
    expiresAtMs: null,
    spaceState: null,
    conditionState: currentTemperature === null
      ? currentItem.conditionState
      : {
          ...(currentItem.conditionState || {}),
          temperature: currentTemperature,
        },
    customInfo: buildCustomInfoWithoutLaunchState(currentItem.customInfo),
  }));
  if (!updateResult.success || !updateResult.data) return updateResult;

  let removeResult = null;
  try {
    removeResult = runtime.removeDynamicEntity(context.systemID, item.itemID, {
      persistSpaceState: false,
    });
  } catch (error) {
    removeResult = {
      success: false,
      errorMsg: "DYNAMIC_ENTITY_REMOVE_FAILED",
      cause: error,
    };
  }
  if (!removeResult || removeResult.success !== true) {
    const previousItem = updateResult.previousData || item;
    const rollbackResult = itemStore.updateInventoryItem(
      item.itemID,
      () => previousItem,
    );
    if (!rollbackResult.success) {
      log.error(
        `[LaunchBayPayload] Scoop rollback failed item=${item.itemID}: ${rollbackResult.errorMsg || "UNKNOWN"}`,
      );
      return {
        success: false as const,
        errorMsg: "LAUNCH_BAY_PAYLOAD_SCOOP_ROLLBACK_FAILED",
        data: {
          removeError: removeResult?.errorMsg || "DYNAMIC_ENTITY_NOT_FOUND",
        },
      };
    }
    return {
      success: false as const,
      errorMsg: removeResult?.errorMsg || "DYNAMIC_ENTITY_NOT_FOUND",
    };
  }
  const syncItem = typeof options.syncInventoryItemForSession === "function"
    ? options.syncInventoryItemForSession
    : syncInventoryItemForSession;
  try {
    // Publish only after both durable inventory custody and ballpark removal
    // have committed. A failed removal is rolled back above and must never
    // show a transient cargo copy to the client.
    syncItem(
      session,
      updateResult.data,
      updateResult.previousData || item,
      { emitCfgLocation: false },
    );
  } catch (error) {
    log.warn(
      `[LaunchBayPayload] Scoop notification failed item=${item.itemID}: ${error?.message || error}`,
    );
  }
  return { success: true as const, response: true, data: { itemID: item.itemID } };
}

function clearCaches() {
  componentsByTypeID = null;
}

module.exports = {
  DEPLOYABLE_CATEGORY_ID,
  HEAT_TRAP_STATE_KEY,
  LAUNCH_STATE_KEY,
  PAYLOAD_GROUP_ID,
  TYPE_FIELD_CAIRN,
  TYPE_FIELD_SENTRY,
  TYPE_HEAT_TRAP,
  buildCustomInfoWithLaunchState,
  buildHeatTrapState,
  getHeatTrapState,
  getHeatTrapTemperature,
  getLaunchState,
  getPayloadComponent,
  getPayloadDecayDurationMs,
  hydrateLaunchBayPayloadEntityFromInventoryItem,
  isHeatTrapVolatile,
  isLaunchBayPayloadItem,
  isLaunchBayPayloadType,
  resolveHeatTrapDischarge,
  scoopLaunchBayPayloadToCargo,
  temperatureAtHeatTrapState,
  tickScene,
  _testing: {
    buildClientCoolingRecipe,
    clearCaches,
    tickHeatTrap,
  },
};
