"use strict";

/**
 * Authoritative cross-system jump-drive planning.
 *
 * This is intentionally independent from Destiny's in-system warp path.  The
 * Frontier fuel and heat equations mirror build 3502403's
 * frontier.jump_drive and frontier.heat_system packages.
 */
const path = require("path");

const {
  buildEffectiveItemAttributeMap,
  getTypeDogmaAttributes,
  isEffectivelyOnlineModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getFuelProperties,
  getShipFuelQueue,
  normalizeFuelQueue,
} = require(path.join(__dirname, "./fuelTankRuntime"));
const {
  resolveProjectedEntityTemperature,
  STATION_TEMPERATURE_K,
} = require(path.join(__dirname, "./temperatureRuntime"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));

const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_CONSUMPTION_TYPE = 713;
const ATTRIBUTE_CONSUMPTION_QUANTITY = 714;
const ATTRIBUTE_CAN_JUMP = 861;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE = 866;
const ATTRIBUTE_JUMP_DRIVE_RANGE = 867;
const ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT = 868;
const ATTRIBUTE_HEAT_CAPACITY = 5762;
const ATTRIBUTE_TEMPERATURE = 5765;

const GROUP_CRUDE_ENGINE = 4619;
const GROUP_POWER_GENERATOR = 4741;
const GROUP_JUMP_DRIVE = 4783;

const MASS_DISTANCE_CONVERSION_FACTOR = 100000;
const FUEL_CONTAINMENT_REDUCTION = 10;
const INSTANT_FUEL_CONSUMPTION_CONVERSION_RATE = 2500;
const CRITICAL_TEMPERATURE_K = 1500;
const EPSILON = 1e-9;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getAttribute(attributes, attributeID, fallback = 0) {
  return toFiniteNumber(
    attributes && (attributes[attributeID] ?? attributes[String(attributeID)]),
    fallback,
  );
}

function resolveItemGroupID(item, deps: Record<string, any> = {}) {
  const authored = toInt(item && item.groupID, 0);
  if (authored > 0) {
    return authored;
  }
  const resolveType = typeof deps.resolveItemByTypeID === "function"
    ? deps.resolveItemByTypeID
    : resolveItemByTypeID;
  const type = resolveType(toInt(item && item.typeID, 0));
  return toInt(type && type.groupID, 0);
}

function calculateFuelAttributeFactor(
  fuelQuality,
  fuelContainmentBurden,
  containmentReduction = FUEL_CONTAINMENT_REDUCTION,
) {
  const containment = Math.max(
    1,
    Math.max(0, toFiniteNumber(fuelContainmentBurden, 1)) /
      Math.max(EPSILON, toFiniteNumber(containmentReduction, FUEL_CONTAINMENT_REDUCTION)),
  );
  const rawFactor = Math.max(0, toFiniteNumber(fuelQuality, 1)) / containment;
  return Math.max(1, Math.min(rawFactor, 100));
}

function calculateFrontierFuelCost({
  shipMass,
  distanceLy,
  fuelQuality,
  fuelContainmentBurden,
  containmentReduction = FUEL_CONTAINMENT_REDUCTION,
}: Record<string, any>) {
  const factor = calculateFuelAttributeFactor(
    fuelQuality,
    fuelContainmentBurden,
    containmentReduction,
  );
  return (
    Math.max(0, toFiniteNumber(shipMass, 0)) *
    Math.max(0, toFiniteNumber(distanceLy, 0)) /
    factor /
    MASS_DISTANCE_CONVERSION_FACTOR
  );
}

function calculateMaximumFrontierDistance({
  fuelLevel,
  shipMass,
  fuelQuality,
  fuelContainmentBurden,
  containmentReduction = FUEL_CONTAINMENT_REDUCTION,
}: Record<string, any>) {
  const mass = Math.max(0, toFiniteNumber(shipMass, 0));
  if (mass <= 0) {
    return 0;
  }
  return (
    Math.max(0, toFiniteNumber(fuelLevel, 0)) *
    calculateFuelAttributeFactor(
      fuelQuality,
      fuelContainmentBurden,
      containmentReduction,
    ) *
    MASS_DISTANCE_CONVERSION_FACTOR /
    mass
  );
}

function calculateInstantJumpHeat({
  fuelAmount,
  fuelThermalInefficiency,
  heatCapacity,
  shipMass,
}: Record<string, any>) {
  const denominator =
    Math.max(0, toFiniteNumber(heatCapacity, 0)) *
    Math.max(0, toFiniteNumber(shipMass, 0)) *
    0.001;
  if (denominator <= 0) {
    return 0;
  }
  return (
    Math.max(0, toFiniteNumber(fuelAmount, 0)) *
    Math.max(0, toFiniteNumber(fuelThermalInefficiency, 1)) *
    INSTANT_FUEL_CONSUMPTION_CONVERSION_RATE /
    denominator
  );
}

function resolveCurrentTemperature(shipItem, shipEntity, attributes, nowMs) {
  const projected = shipEntity
    ? resolveProjectedEntityTemperature(shipEntity, nowMs)
    : null;
  if (projected !== null && Number.isFinite(Number(projected))) {
    return Math.max(0, Number(projected));
  }
  const conditionTemperature = Number(
    shipItem && shipItem.conditionState && shipItem.conditionState.temperature,
  );
  if (Number.isFinite(conditionTemperature)) {
    return Math.max(0, conditionTemperature);
  }
  return Math.max(
    0,
    getAttribute(attributes, ATTRIBUTE_TEMPERATURE, STATION_TEMPERATURE_K),
  );
}

function resolveDriveAndPropulsion(
  shipItem,
  resourceState,
  deps: Record<string, any> = {},
) {
  const resolveDogmaAttributes = typeof deps.getTypeDogmaAttributes === "function"
    ? deps.getTypeDogmaAttributes
    : getTypeDogmaAttributes;
  const buildItemAttributes = typeof deps.buildEffectiveItemAttributeMap === "function"
    ? deps.buildEffectiveItemAttributeMap
    : buildEffectiveItemAttributeMap;
  const isOnline = typeof deps.isEffectivelyOnlineModule === "function"
    ? deps.isEffectivelyOnlineModule
    : isEffectivelyOnlineModule;
  const hullAttributes = resolveDogmaAttributes(toInt(shipItem && shipItem.typeID, 0));
  const effectiveAttributes =
    resourceState && resourceState.attributes && typeof resourceState.attributes === "object"
      ? resourceState.attributes
      : {};
  const fittedItems = Array.isArray(resourceState && resourceState.fittedItems)
    ? resourceState.fittedItems
    : [];
  const onlineItems = fittedItems.filter((item) => isOnline(item));
  const hullCanJump = getAttribute(hullAttributes, ATTRIBUTE_CAN_JUMP, 0) > 0;
  const hasOnlinePropulsion = onlineItems.some((item) => {
    const groupID = resolveItemGroupID(item, deps);
    return groupID === GROUP_CRUDE_ENGINE || groupID === GROUP_POWER_GENERATOR;
  });

  const fittedDrive = onlineItems.find((item) => {
    if (resolveItemGroupID(item, deps) !== GROUP_JUMP_DRIVE) {
      return false;
    }
    const attributes = buildItemAttributes(item) || {};
    return (
      getAttribute(attributes, ATTRIBUTE_CAN_JUMP, 0) > 0 &&
      getAttribute(attributes, ATTRIBUTE_JUMP_DRIVE_RANGE, 0) > 0
    );
  }) || null;

  const fittedDriveAttributes = fittedDrive
    ? buildItemAttributes(fittedDrive) || {}
    : {};
  const hullHasDrive =
    hullCanJump &&
    getAttribute(effectiveAttributes, ATTRIBUTE_JUMP_DRIVE_RANGE, 0) > 0 &&
    getAttribute(effectiveAttributes, ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE, 0) > 0 &&
    getAttribute(effectiveAttributes, ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT, 0) > 0;

  if (!hullHasDrive && !fittedDrive) {
    return { success: false as const, errorMsg: "JUMP_DRIVE_REQUIRED" };
  }
  // canJump on a legacy hull represents its integrated propulsion. Modular
  // Frontier hulls instead need a live engine or Creation Power Generator.
  if (!hullCanJump && !hasOnlinePropulsion) {
    return { success: false as const, errorMsg: "PROPULSION_REQUIRED" };
  }

  if (hullHasDrive) {
    return {
      success: true as const,
      driveSource: "hull",
      driveItem: null,
      driveAttributes: effectiveAttributes,
      hullAttributes,
      hullCanJump,
      hasOnlinePropulsion,
    };
  }
  return {
    success: true as const,
    driveSource: "fitted",
    driveItem: fittedDrive,
    driveAttributes: fittedDriveAttributes,
    hullAttributes,
    hullCanJump,
    hasOnlinePropulsion,
  };
}

function buildJumpDrivePlan({
  shipItem,
  resourceState,
  shipEntity = null,
  distanceLy,
  availableLegacyFuelQuantity = Number.POSITIVE_INFINITY,
  nowMs = Date.now(),
  deps = {},
}: Record<string, any>) {
  const distance = Math.max(0, toFiniteNumber(distanceLy, 0));
  if (!shipItem || toInt(shipItem.itemID, 0) <= 0) {
    return { success: false as const, errorMsg: "SHIP_NOT_FOUND" };
  }
  if (distance <= 0) {
    return { success: false as const, errorMsg: "INVALID_DISTANCE" };
  }

  const capability = resolveDriveAndPropulsion(shipItem, resourceState, deps);
  if (!capability.success) {
    return capability;
  }
  const attributes =
    resourceState && resourceState.attributes && typeof resourceState.attributes === "object"
      ? resourceState.attributes
      : {};
  const driveAttributes = capability.driveAttributes;
  const jumpRangeLy = Math.max(
    0,
    getAttribute(driveAttributes, ATTRIBUTE_JUMP_DRIVE_RANGE, 0),
  );
  if (distance > jumpRangeLy + EPSILON) {
    return {
      success: false as const,
      errorMsg: "OUT_OF_RANGE",
      distanceLy: distance,
      jumpRangeLy,
    };
  }

  const shipMass = Math.max(
    EPSILON,
    getAttribute(
      attributes,
      ATTRIBUTE_MASS,
      toFiniteNumber(resourceState && resourceState.mass, 0),
    ),
  );
  const heatCapacity = Math.max(0, getAttribute(attributes, ATTRIBUTE_HEAT_CAPACITY, 0));
  const currentTemperature = resolveCurrentTemperature(
    shipItem,
    shipEntity,
    attributes,
    nowMs,
  );
  const frontierFuelTypeID = toInt(
    getAttribute(driveAttributes, ATTRIBUTE_CONSUMPTION_TYPE, 0),
    0,
  );
  const fuelMode = capability.driveSource === "fitted" && frontierFuelTypeID > 0
    ? "frontier-tank"
    : "inventory";

  let fuelTypeID = 0;
  let fuelQuantity = 0;
  let fuelProperties: Record<string, any> = {};
  let fuelQueue: any[] = [];
  if (fuelMode === "frontier-tank") {
    fuelTypeID = frontierFuelTypeID;
    const resolveFuelQueue = typeof deps.getShipFuelQueue === "function"
      ? deps.getShipFuelQueue
      : getShipFuelQueue;
    const resolveFuelProperties = typeof deps.getFuelProperties === "function"
      ? deps.getFuelProperties
      : getFuelProperties;
    fuelQueue = resolveFuelQueue(shipItem);
    const activeBatch = fuelQueue[0] || null;
    if (!activeBatch || toInt(activeBatch.fuelTypeID, 0) !== fuelTypeID) {
      return {
        success: false as const,
        errorMsg: "REQUIRED_FUEL_NOT_ACTIVE",
        fuelTypeID,
      };
    }
    fuelProperties = resolveFuelProperties(fuelTypeID);
    const fuelQuality = Math.max(1, toFiniteNumber(fuelProperties.fuelEfficiency, 1));
    const fuelContainmentBurden = Math.max(
      1,
      toFiniteNumber(fuelProperties.fuelContainmentBurden, 1),
    );
    fuelQuantity = calculateFrontierFuelCost({
      shipMass,
      distanceLy: distance,
      fuelQuality,
      fuelContainmentBurden,
    });
    if (toFiniteNumber(activeBatch.quantity, 0) + EPSILON < fuelQuantity) {
      return {
        success: false as const,
        errorMsg: "INSUFFICIENT_FUEL",
        fuelTypeID,
        fuelQuantity,
      };
    }
  } else {
    fuelTypeID = toInt(
      getAttribute(driveAttributes, ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE, 0),
      0,
    );
    const amountPerLy = Math.max(
      0,
      getAttribute(driveAttributes, ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT, 0),
    );
    if (fuelTypeID <= 0 || amountPerLy <= 0) {
      return { success: false as const, errorMsg: "JUMP_FUEL_CONFIGURATION_MISSING" };
    }
    const baseMass = Math.max(
      EPSILON,
      getAttribute(capability.hullAttributes, ATTRIBUTE_MASS, shipMass),
    );
    const massFactor = Math.max(EPSILON, shipMass / baseMass);
    fuelQuantity = Math.ceil(distance * amountPerLy * massFactor);
    const availableFuel = Number(availableLegacyFuelQuantity);
    if (Number.isFinite(availableFuel) && availableFuel + EPSILON < fuelQuantity) {
      return {
        success: false as const,
        errorMsg: "INSUFFICIENT_FUEL",
        fuelTypeID,
        fuelQuantity,
      };
    }
    const resolveFuelProperties = typeof deps.getFuelProperties === "function"
      ? deps.getFuelProperties
      : getFuelProperties;
    fuelProperties = resolveFuelProperties(fuelTypeID);
  }

  const fuelThermalInefficiency = Math.max(
    1,
    toFiniteNumber(fuelProperties.fuelThermalInefficiency, 1),
  );
  const heatIncrease = calculateInstantJumpHeat({
    fuelAmount: fuelQuantity,
    fuelThermalInefficiency,
    heatCapacity,
    shipMass,
  });
  const nextTemperature = currentTemperature + heatIncrease;
  if (heatCapacity > 0 && nextTemperature >= CRITICAL_TEMPERATURE_K) {
    return {
      success: false as const,
      errorMsg: "CRITICAL_HEAT",
      currentTemperature,
      heatIncrease,
      nextTemperature,
    };
  }

  return {
    success: true as const,
    data: {
      ...capability,
      distanceLy: distance,
      jumpRangeLy,
      shipMass,
      heatCapacity,
      currentTemperature,
      heatIncrease,
      nextTemperature,
      fuelMode,
      fuelTypeID,
      fuelQuantity: Number(fuelQuantity.toFixed(9)),
      fuelQueue,
      fuelProperties,
    },
  };
}

function consumeFrontierFuelQueue(fuelQueue, fuelTypeID, quantity) {
  const normalized = normalizeFuelQueue(fuelQueue);
  const required = Math.max(0, toFiniteNumber(quantity, 0));
  const activeBatch = normalized[0] || null;
  if (
    !activeBatch ||
    toInt(activeBatch.fuelTypeID, 0) !== toInt(fuelTypeID, 0) ||
    toFiniteNumber(activeBatch.quantity, 0) + EPSILON < required
  ) {
    return { success: false as const, errorMsg: "INSUFFICIENT_FUEL" };
  }
  const remaining = Math.max(0, activeBatch.quantity - required);
  const nextQueue = [
    ...(remaining > EPSILON
      ? [{
          ...activeBatch,
          quantity: Number(remaining.toFixed(9)),
        }]
      : []),
    ...normalized.slice(1),
  ];
  const normalizedNextQueue = normalizeFuelQueue(nextQueue);
  return {
    success: true as const,
    data: {
      previousFuelQueue: normalized,
      fuelQueue: normalizedNextQueue,
      fuelCharge: Number(
        normalizedNextQueue
          .reduce((sum, entry) => sum + toFiniteNumber(entry.quantity, 0), 0)
          .toFixed(9),
      ),
      fuelTypeID: toInt(normalizedNextQueue[0] && normalizedNextQueue[0].fuelTypeID, 0),
      consumedQuantity: Number(required.toFixed(9)),
    },
  };
}

module.exports = {
  ATTRIBUTE_CAN_JUMP,
  ATTRIBUTE_CONSUMPTION_QUANTITY,
  ATTRIBUTE_CONSUMPTION_TYPE,
  ATTRIBUTE_HEAT_CAPACITY,
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT,
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE,
  ATTRIBUTE_JUMP_DRIVE_RANGE,
  ATTRIBUTE_MASS,
  ATTRIBUTE_TEMPERATURE,
  CRITICAL_TEMPERATURE_K,
  FUEL_CONTAINMENT_REDUCTION,
  GROUP_CRUDE_ENGINE,
  GROUP_JUMP_DRIVE,
  GROUP_POWER_GENERATOR,
  INSTANT_FUEL_CONSUMPTION_CONVERSION_RATE,
  MASS_DISTANCE_CONVERSION_FACTOR,
  buildJumpDrivePlan,
  calculateFrontierFuelCost,
  calculateFuelAttributeFactor,
  calculateInstantJumpHeat,
  calculateMaximumFrontierDistance,
  consumeFrontierFuelQueue,
  resolveDriveAndPropulsion,
};
