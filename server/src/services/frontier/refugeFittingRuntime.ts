"use strict";

const path = require("path");

const {
  canEntitiesInteractLocally,
} = require(path.join(
  __dirname,
  "../../space/destiny/identity/interactionScope.js",
));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const deploymentRuntime = require(path.join(__dirname, "./deploymentRuntime"));

const REFUGE_TYPE_ID = 87160;
const DEFAULT_REFUGE_FITTING_RANGE_METERS = 5_000;

let fittingComponentsByTypeID = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildFittingComponents(rows) {
  const components = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const typeID = toInt(row && (row.typeID ?? row._key), 0);
    const fitting = row && row.fitting;
    const rangeMeters = toFiniteNumber(fitting && fitting.range, 0);
    if (typeID <= 0 || rangeMeters <= 0) {
      continue;
    }
    components.set(typeID, { typeID, rangeMeters });
  }
  return components;
}

function getFittingComponent(typeID) {
  if (!fittingComponentsByTypeID) {
    fittingComponentsByTypeID = buildFittingComponents(
      readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE),
    );
  }
  return fittingComponentsByTypeID.get(toInt(typeID, 0)) || null;
}

function getCharacterID(session) {
  return toInt(session && (session.characterID || session.charid), 0);
}

function getShipID(session) {
  return toInt(
    session && (
      (session._space && session._space.shipID) ||
      session.activeShipID ||
      session.shipID ||
      session.shipid
    ),
    0,
  );
}

function getSolarSystemID(session) {
  return toInt(
    session && (
      (session._space && session._space.systemID) ||
      session.solarsystemid2 ||
      session.solarsystemid
    ),
    0,
  );
}

function getPosition(entityOrItem) {
  const position = entityOrItem && (
    entityOrItem.position ||
    (entityOrItem.spaceState && entityOrItem.spaceState.position)
  );
  if (
    !position ||
    !Number.isFinite(Number(position.x)) ||
    !Number.isFinite(Number(position.y)) ||
    !Number.isFinite(Number(position.z))
  ) {
    return null;
  }
  return {
    x: Number(position.x),
    y: Number(position.y),
    z: Number(position.z),
  };
}

function vectorDistance(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

function validateRefugeFittingAccess(
  session,
  itemOrID,
  dependencies: Record<string, any> = {},
) {
  const characterID = getCharacterID(session);
  const shipID = getShipID(session);
  const solarSystemID = getSolarSystemID(session);
  if (
    characterID <= 0 ||
    shipID <= 0 ||
    solarSystemID <= 0 ||
    toInt(session && (session.stationID || session.stationid || session.stationid2), 0) > 0 ||
    toInt(session && (session.structureID || session.structureid), 0) > 0
  ) {
    return { success: false as const, errorMsg: "INVALID_SESSION" };
  }

  const findItemById = dependencies.findItemById || itemStore.findItemById;
  const item = itemOrID && typeof itemOrID === "object"
    ? itemOrID
    : findItemById(itemOrID);
  if (!item || toInt(item.typeID, 0) !== REFUGE_TYPE_ID) {
    return {
      success: false as const,
      errorMsg: "REFUGE_FITTING_SERVICE_NOT_FOUND",
    };
  }

  const fittingComponent = (
    dependencies.getFittingComponent || getFittingComponent
  )(item.typeID);
  if (!fittingComponent || toFiniteNumber(fittingComponent.rangeMeters, 0) <= 0) {
    return {
      success: false as const,
      errorMsg: "REFUGE_FITTING_SERVICE_NOT_AVAILABLE",
      item,
    };
  }

  if (
    toInt(item.locationID, 0) !== solarSystemID ||
    toInt(item.flagID, -1) !== 0 ||
    !item.spaceState
  ) {
    return {
      success: false as const,
      errorMsg: "REFUGE_NOT_IN_SPACE",
      item,
    };
  }
  if (toInt(item.ownerID, 0) !== characterID) {
    return {
      success: false as const,
      errorMsg: "REFUGE_NOT_OWNER",
      item,
    };
  }

  const readConstructionState = dependencies.readConstructionState ||
    deploymentRuntime.readConstructionState;
  const isAssemblyActivationPending = dependencies.isAssemblyActivationPending ||
    deploymentRuntime.isAssemblyActivationPending;
  const state = readConstructionState(item);
  if (
    !state ||
    toInt(state.assemblyTypeID, 0) !== REFUGE_TYPE_ID ||
    toInt(state.assemblyStatus, 0) !== deploymentRuntime.ASSEMBLY_STATUS_ONLINE ||
    isAssemblyActivationPending(item)
  ) {
    return {
      success: false as const,
      errorMsg: "REFUGE_NOT_ACTIVE",
      item,
      state,
    };
  }

  const shipItem = findItemById(shipID);
  if (
    !shipItem ||
    toInt(shipItem.itemID, 0) !== shipID ||
    toInt(shipItem.ownerID, 0) !== characterID ||
    toInt(shipItem.locationID, 0) !== solarSystemID ||
    toInt(shipItem.categoryID, 0) !== 6
  ) {
    return { success: false as const, errorMsg: "INVALID_SESSION" };
  }

  const spaceRuntime = dependencies.spaceRuntime ||
    require(path.join(__dirname, "../../space/runtime"));
  const shipEntity = spaceRuntime.getEntity(session, shipID);
  const refugeEntity = spaceRuntime.getEntity(session, item.itemID);
  const interactionValidator = dependencies.canEntitiesInteractLocally ||
    canEntitiesInteractLocally;
  if (!interactionValidator(shipEntity || shipItem, refugeEntity || item)) {
    return {
      success: false as const,
      errorMsg: "TARGET_TOO_FAR",
      item,
      state,
    };
  }

  const shipPosition = getPosition(shipEntity) || getPosition(shipItem);
  const refugePosition = getPosition(refugeEntity) || getPosition(item);
  const distance = vectorDistance(shipPosition, refugePosition);
  const rangeMeters = toFiniteNumber(
    fittingComponent.rangeMeters,
    DEFAULT_REFUGE_FITTING_RANGE_METERS,
  );
  if (!Number.isFinite(distance) || distance > rangeMeters) {
    return {
      success: false as const,
      errorMsg: "TARGET_TOO_FAR",
      item,
      state,
      data: { distance, rangeMeters },
    };
  }

  return {
    success: true as const,
    item,
    state,
    data: { distance, rangeMeters },
  };
}

function findRefugeFittingAccess(session, dependencies: Record<string, any> = {}) {
  const solarSystemID = getSolarSystemID(session);
  if (solarSystemID <= 0) {
    return { success: false as const, errorMsg: "INVALID_SESSION" };
  }

  const listSystemSpaceItems = dependencies.listSystemSpaceItems ||
    itemStore.listSystemSpaceItems;
  const refuges = listSystemSpaceItems(solarSystemID)
    .filter((item) => toInt(item && item.typeID, 0) === REFUGE_TYPE_ID)
    .sort((left, right) => toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0));
  if (refuges.length === 0) {
    return {
      success: false as const,
      errorMsg: "REFUGE_FITTING_SERVICE_NOT_FOUND",
    };
  }

  const errorPriority = {
    TARGET_TOO_FAR: 50,
    REFUGE_NOT_ACTIVE: 40,
    REFUGE_NOT_IN_SPACE: 30,
    REFUGE_FITTING_SERVICE_NOT_AVAILABLE: 0,
    REFUGE_NOT_OWNER: 10,
  };
  let bestResult: Record<string, any> = {
    success: false as const,
    errorMsg: "REFUGE_FITTING_SERVICE_NOT_AVAILABLE",
  };
  for (const refuge of refuges) {
    const result = validateRefugeFittingAccess(session, refuge, dependencies);
    if (result.success) {
      return result;
    }
    if (
      (errorPriority[result.errorMsg] || 0) >
      (errorPriority[bestResult.errorMsg] || 0)
    ) {
      bestResult = result;
    }
  }
  return bestResult;
}

module.exports = {
  REFUGE_TYPE_ID,
  DEFAULT_REFUGE_FITTING_RANGE_METERS,
  findRefugeFittingAccess,
  getFittingComponent,
  validateRefugeFittingAccess,
  _testing: {
    buildFittingComponents,
    clearFittingComponentCache() {
      fittingComponentsByTypeID = null;
    },
    getPosition,
    vectorDistance,
  },
};
