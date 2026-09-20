"use strict";

/**
 * Authoritative runtime for Creation active modules whose Dogma effects are
 * implemented by Frontier Python effect scripts in the retail client.
 *
 * The ordinary generic-module runtime remains responsible for lifecycle,
 * capacitor, heat, HUD timing and SpecialFx.  This module supplies the
 * Frontier-only consequences which are not described by modifierInfo:
 * active thrust/fuel accounting, FIFO fuel transfer, and Approach Computer
 * movement authority.
 */

const path = require("path");

const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const fuelTankRuntime = require(path.join(__dirname, "./fuelTankRuntime"));
const {
  applyModifierGroups,
  buildEffectiveItemAttributeMap,
  getTypeDogmaEffects,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const TYPE_HULL_REPAIRER = 95316;
const TYPE_LEAP = 95319;
const TYPE_APPROACH_COMPUTER = 95728;
const TYPE_TRANSFUSER = 95754;
const TYPE_THRUST_OVERDRIVE = 95810;

const CREATION_ACTIVE_MODULE_TYPE_IDS = Object.freeze([
  TYPE_HULL_REPAIRER,
  TYPE_LEAP,
  TYPE_APPROACH_COMPUTER,
  TYPE_TRANSFUSER,
  TYPE_THRUST_OVERDRIVE,
]);

const EFFECT_HULL_REPAIRER = "structureRepair";
const EFFECT_LEAP = "modulebonusLeap";
const EFFECT_APPROACH_COMPUTER = "effectApproachComputer";
const EFFECT_TRANSFUSER = "fuelTransfer";
const EFFECT_THRUST_OVERDRIVE = "modulebonusThrustOverdrive";

const ACTIVE_KIND_LEAP = "leap";
const ACTIVE_KIND_APPROACH = "approachComputer";
const ACTIVE_KIND_TRANSFUSER = "transfuser";
const ACTIVE_KIND_THRUST_OVERDRIVE = "thrustOverdrive";

const ATTRIBUTE_MAX_VELOCITY = 37;
const ATTRIBUTE_MAX_RANGE = 54;
const ATTRIBUTE_DURATION = 73;
const ATTRIBUTE_AGILITY = 70;
const ATTRIBUTE_THRUST = 6250;
const ATTRIBUTE_TORQUE_MULTIPLIER = 6256;
const ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE = 6301;
const ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY = 6302;
const ATTRIBUTE_LEAP_THRUST_ADD = 6309;
const ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE = 6320;
const ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE = 6321;
const ATTRIBUTE_CONTAINMENT_REDUCTION = 6341;
const EFFECT_THRUST_ADD_ONLINE = 12910;

// Decompiled frontier.creation.common.dogma_item contract.
const CREATION_FRICTION_CONSTANT = 1.0e-6;
const LEAP_FUEL_RATE_CONSTANT = 1.67e-9;
const FUEL_EPSILON = 1.0e-9;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 9) {
  const factor = 10 ** digits;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
}

function cloneFuelQueue(queue) {
  return fuelTankRuntime.normalizeFuelQueue(queue).map((entry) => ({ ...entry }));
}

function getFuelQueueQuantity(queue) {
  return cloneFuelQueue(queue).reduce(
    (total, entry) => total + Math.max(0, toFiniteNumber(entry.quantity, 0)),
    0,
  );
}

function resolveModuleAttributes(moduleItem, effectState = null) {
  const snapshot = effectState && effectState.creationModuleAttributes;
  if (snapshot && typeof snapshot === "object") {
    return { ...snapshot };
  }
  return buildEffectiveItemAttributeMap(
    moduleItem || (effectState && effectState.moduleItemSnapshot) || 0,
  ) || {};
}

function captureCreationModuleAttributes(moduleItem) {
  const attributes = resolveModuleAttributes(moduleItem);
  return {
    [ATTRIBUTE_MAX_RANGE]: Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_MAX_RANGE], 0)),
    [ATTRIBUTE_DURATION]: Math.max(1, toFiniteNumber(attributes[ATTRIBUTE_DURATION], 10000)),
    [ATTRIBUTE_TORQUE_MULTIPLIER]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_TORQUE_MULTIPLIER], 0),
    ),
    [ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE], 0),
    ),
    [ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY]: clamp(
      toFiniteNumber(attributes[ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY], 0),
      0,
      1,
    ),
    [ATTRIBUTE_LEAP_THRUST_ADD]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_LEAP_THRUST_ADD], 0),
    ),
    [ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE], 0),
    ),
    [ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE], 0),
    ),
    [ATTRIBUTE_CONTAINMENT_REDUCTION]: Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_CONTAINMENT_REDUCTION], 0),
    ),
  };
}

function markCreationActiveEffect(
  effectState,
  kind,
  moduleItem,
  options: Record<string, any> = {},
) {
  if (!effectState || typeof effectState !== "object") {
    return null;
  }
  Object.assign(effectState, buildCreationActiveEffectPatch(kind, moduleItem, options));
  return effectState;
}

/**
 * Build the state which must exist before generic activation publishes its
 * first HUD/FX notification.  In particular Transfuser is an end-of-cycle
 * consequence: repeat=0 still owes one transfer before it is finalized.
 */
function buildCreationActiveEffectPatch(
  kind,
  moduleItem,
  options: Record<string, any> = {},
) {
  const patch: Record<string, any> = {
    creationActiveModuleEffect: true,
    creationActiveKind: String(kind || ""),
    creationModuleAttributes: captureCreationModuleAttributes(moduleItem),
    creationActiveFuelPrepaid: options.fuelPrepaid === true,
    consequenceDelivery: kind === ACTIVE_KIND_TRANSFUSER
      ? "boundary"
      : "continuous",
  };
  if (toInt(options.targetID, 0) > 0) {
    patch.targetID = toInt(options.targetID, 0);
  }
  if (kind === ACTIVE_KIND_LEAP || kind === ACTIVE_KIND_THRUST_OVERDRIVE) {
    // Ensures the shared finalizer refreshes velocity when the effect ends.
    patch.affectsShipDerivedState = true;
  }
  return patch;
}

function getActiveCreationEffectStates(entity) {
  if (!entity || !(entity.activeModuleEffects instanceof Map)) {
    return [];
  }
  return [...entity.activeModuleEffects.values()].filter(
    (state) => state && state.creationActiveModuleEffect === true,
  );
}

function countOnlineCreationThrusters(
  creationDogmaContext,
  options: Record<string, any> = {},
) {
  const resolveEffects = typeof options.getTypeDogmaEffects === "function"
    ? options.getTypeDogmaEffects
    : getTypeDogmaEffects;
  const moduleItems = creationDogmaContext && Array.isArray(creationDogmaContext.moduleItems)
    ? creationDogmaContext.moduleItems
    : [];
  return moduleItems.filter((moduleItem) => {
    if (!moduleItem || moduleItem.moduleState?.online !== true) {
      return false;
    }
    const effects = resolveEffects(toInt(moduleItem.typeID, 0));
    return effects && typeof effects.has === "function" && effects.has(EFFECT_THRUST_ADD_ONLINE);
  }).length;
}

function calculateFuelAttributeFactors(fuelProperties, containmentReduction) {
  const properties = fuelProperties && typeof fuelProperties === "object"
    ? fuelProperties
    : {};
  const reduction = Math.max(1, toFiniteNumber(containmentReduction, 0));
  const containmentFactor = Math.max(
    1,
    Math.max(0, toFiniteNumber(properties.fuelContainmentBurden, 0)) / reduction,
  );
  const fuelEfficiency = Math.max(
    0,
    toFiniteNumber(properties.fuelEfficiency, 0),
  );
  // CreationDogmaItem._get_fuel_attribute_factor returns 0 before entering
  // the shared clamped helper when the active fuel has no impulse.
  const fuelAttributeFactor = fuelEfficiency <= 0
    ? 0
    : clamp(fuelEfficiency / containmentFactor, 1, 100);
  const volatilityFactor =
    Math.max(0, toFiniteNumber(properties.fuelVolatility, 0)) / containmentFactor;
  return {
    containmentFactor: round(containmentFactor),
    fuelAttributeFactor: round(fuelAttributeFactor),
    volatilityFactor: round(volatilityFactor),
  };
}

/** Pure mirror of CreationDogmaItem's active thrust and fuel-rate formulas. */
function calculateCreationActiveThrust({
  activeEffects = [],
  fuelProperties = {},
  onlineThrusterCount = 0,
}: Record<string, any> = {}) {
  let leapThrustAdd = 0;
  let overdriveInjectionRate = 0;
  let overdriveFuelRate = 0;
  let containmentReduction = 0;
  let torqueMultiplier = 0;

  for (const effectState of Array.isArray(activeEffects) ? activeEffects : []) {
    if (!effectState || effectState.creationActiveModuleEffect !== true) {
      continue;
    }
    const attributes = resolveModuleAttributes(null, effectState);
    if (effectState.creationActiveKind === ACTIVE_KIND_LEAP) {
      leapThrustAdd += Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_LEAP_THRUST_ADD], 0),
      );
      torqueMultiplier += Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_TORQUE_MULTIPLIER], 0),
      );
    } else if (effectState.creationActiveKind === ACTIVE_KIND_THRUST_OVERDRIVE) {
      overdriveInjectionRate += Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE], 0),
      );
      overdriveFuelRate += Math.max(
        0,
        toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE], 0),
      );
    } else {
      continue;
    }
    containmentReduction += Math.max(
      0,
      toFiniteNumber(attributes[ATTRIBUTE_CONTAINMENT_REDUCTION], 0),
    );
  }

  const thrusterCount = Math.max(0, toInt(onlineThrusterCount, 0));
  const factors = calculateFuelAttributeFactors(
    fuelProperties,
    containmentReduction,
  );
  const leapThrust = leapThrustAdd * factors.volatilityFactor * factors.fuelAttributeFactor;
  const thrustOverdrive = overdriveInjectionRate * thrusterCount * factors.fuelAttributeFactor;
  const leapFuelRate = leapThrustAdd * LEAP_FUEL_RATE_CONSTANT * factors.volatilityFactor;
  const thrustOverdriveFuelRate = overdriveFuelRate * thrusterCount;

  return {
    ...factors,
    containmentReduction: round(containmentReduction),
    onlineThrusterCount: thrusterCount,
    torqueMultiplier: round(torqueMultiplier),
    leapThrust: round(leapThrust, 6),
    thrustOverdrive: round(thrustOverdrive, 6),
    totalActiveThrust: round(leapThrust + thrustOverdrive, 6),
    leapFuelRate: round(leapFuelRate),
    thrustOverdriveFuelRate: round(thrustOverdriveFuelRate),
    totalFuelRate: round(leapFuelRate + thrustOverdriveFuelRate),
  };
}

function resolveCreationActiveThrustState(
  entity,
  creationDogmaContext,
  options: Record<string, any> = {},
) {
  const activeEffects = getActiveCreationEffectStates(entity);
  const additionalActiveEffect = options.additionalActiveEffect;
  if (
    additionalActiveEffect &&
    additionalActiveEffect.creationActiveModuleEffect === true &&
    !activeEffects.includes(additionalActiveEffect)
  ) {
    activeEffects.push(additionalActiveEffect);
  }
  const fuelProperties = options.fuelProperties || fuelTankRuntime.getShipFuelProperties(
    options.shipItem || entity || {},
    options,
  );
  return calculateCreationActiveThrust({
    activeEffects,
    fuelProperties,
    onlineThrusterCount: countOnlineCreationThrusters(
      creationDogmaContext,
      options,
    ),
  });
}

/**
 * Mutate a freshly-built passive resource state with active Creation thrust.
 * The prior delta is removed first, making this safe if a caller reapplies it
 * to the same object during a refresh.
 */
function applyCreationActiveThrustToResourceState(
  resourceState,
  entity,
  creationDogmaContext,
  options: Record<string, any> = {},
) {
  if (!resourceState || !entity || !creationDogmaContext) {
    return null;
  }
  const previousState = resourceState.creationActiveThrustState || null;
  const previousVelocityDelta = Math.max(
    0,
    toFiniteNumber(previousState && previousState.velocityDelta, 0),
  );
  const baseMaxVelocity = Math.max(
    0,
    toFiniteNumber(resourceState.maxVelocity, 0) - previousVelocityDelta,
  );
  const activeState = resolveCreationActiveThrustState(
    entity,
    creationDogmaContext,
    options,
  );
  const agility = Math.max(
    0,
    toFiniteNumber(
      resourceState.agility ??
        (resourceState.attributes && resourceState.attributes[ATTRIBUTE_AGILITY]),
      0,
    ),
  );
  const velocityDelta = Math.max(
    0,
    activeState.totalActiveThrust * CREATION_FRICTION_CONSTANT * agility,
  );
  const maxVelocity = round(baseMaxVelocity + velocityDelta, 6);

  resourceState.maxVelocity = maxVelocity;
  if (resourceState.attributes && typeof resourceState.attributes === "object") {
    resourceState.attributes[ATTRIBUTE_MAX_VELOCITY] = maxVelocity;
    const previousActiveThrust = Math.max(
      0,
      toFiniteNumber(previousState && previousState.totalActiveThrust, 0),
    );
    resourceState.attributes[ATTRIBUTE_THRUST] = round(
      Math.max(
        0,
        toFiniteNumber(resourceState.attributes[ATTRIBUTE_THRUST], 0) -
          previousActiveThrust,
      ) +
        activeState.totalActiveThrust,
      6,
    );
  }
  resourceState.creationActiveThrustState = {
    ...activeState,
    velocityDelta: round(velocityDelta, 6),
  };
  return resourceState.creationActiveThrustState;
}

function buildShipWithFuelQueue(shipItem, fuelQueue) {
  const normalizedQueue = cloneFuelQueue(fuelQueue);
  return {
    ...shipItem,
    conditionState: {
      ...(shipItem && shipItem.conditionState ? shipItem.conditionState : {}),
      fuelCharge: round(getFuelQueueQuantity(normalizedQueue)),
      fuelQueue: normalizedQueue,
      fuelTypeID: normalizedQueue[0]
        ? toInt(normalizedQueue[0].fuelTypeID, 0)
        : 0,
    },
  };
}

function applyPersistedFuelStateToEntity(entity, shipItem) {
  if (!entity || !shipItem) {
    return;
  }
  const queue = fuelTankRuntime.getShipFuelQueue(shipItem);
  entity.conditionState = {
    ...(entity.conditionState || {}),
    fuelCharge: fuelTankRuntime.getShipFuelCharge(shipItem),
    fuelQueue: queue.map((entry) => ({ ...entry })),
    fuelTypeID: queue[0] ? toInt(queue[0].fuelTypeID, 0) : 0,
  };
}

function queuesEqual(left, right) {
  return JSON.stringify(cloneFuelQueue(left)) === JSON.stringify(cloneFuelQueue(right));
}

/**
 * Synchronous compare-and-write pair with compensation. Node's scene tick is
 * single-threaded, so no other game action can interleave the two writes; if
 * the target write fails, the source row is restored before failure escapes.
 * Tests/alternate stores may inject a native atomic pair writer.
 */
function commitFuelQueuePair({
  sourceItem,
  targetItem,
  nextSourceQueue,
  nextTargetQueue,
  dependencies = {},
}: Record<string, any>) {
  if (typeof dependencies.commitFuelQueuePair === "function") {
    return dependencies.commitFuelQueuePair({
      sourceItem,
      targetItem,
      nextSourceQueue: cloneFuelQueue(nextSourceQueue),
      nextTargetQueue: cloneFuelQueue(nextTargetQueue),
    });
  }
  const updateShipItem = typeof dependencies.updateShipItem === "function"
    ? dependencies.updateShipItem
    : itemStore.updateShipItem;
  const sourceID = toInt(sourceItem && sourceItem.itemID, 0);
  const targetID = toInt(targetItem && targetItem.itemID, 0);
  if (sourceID <= 0 || targetID <= 0 || sourceID === targetID) {
    return { success: false, errorMsg: "INVALID_FUEL_TRANSFER_TARGET" };
  }

  const sourceWrite = updateShipItem(sourceID, (currentItem) => {
    if (!queuesEqual(fuelTankRuntime.getShipFuelQueue(currentItem), fuelTankRuntime.getShipFuelQueue(sourceItem))) {
      return null;
    }
    return buildShipWithFuelQueue(currentItem, nextSourceQueue);
  });
  if (!sourceWrite || sourceWrite.success !== true) {
    return {
      success: false,
      errorMsg: sourceWrite && sourceWrite.errorMsg
        ? sourceWrite.errorMsg
        : "FUEL_SOURCE_WRITE_FAILED",
    };
  }

  const targetWrite = updateShipItem(targetID, (currentItem) => {
    if (!queuesEqual(fuelTankRuntime.getShipFuelQueue(currentItem), fuelTankRuntime.getShipFuelQueue(targetItem))) {
      return null;
    }
    return buildShipWithFuelQueue(currentItem, nextTargetQueue);
  });
  if (!targetWrite || targetWrite.success !== true) {
    const rollback = updateShipItem(sourceID, () => sourceItem);
    return {
      success: false,
      errorMsg: rollback && rollback.success === true
        ? "FUEL_TARGET_WRITE_FAILED"
        : "FUEL_TRANSFER_ROLLBACK_FAILED",
    };
  }

  return {
    success: true,
    data: {
      sourceItem: sourceWrite.data,
      targetItem: targetWrite.data,
    },
  };
}

function resolveSceneEntity(scene, entityID) {
  if (!scene || toInt(entityID, 0) <= 0) {
    return null;
  }
  if (typeof scene.getEntityByID === "function") {
    return scene.getEntityByID(toInt(entityID, 0));
  }
  return scene.dynamicEntities instanceof Map
    ? scene.dynamicEntities.get(toInt(entityID, 0)) || null
    : null;
}

function isTargetLocked(entity, targetID) {
  const numericTargetID = toInt(targetID, 0);
  if (!entity || numericTargetID <= 0) {
    return false;
  }
  if (entity.lockedTargets instanceof Map || entity.lockedTargets instanceof Set) {
    return entity.lockedTargets.has(numericTargetID);
  }
  return Array.isArray(entity.lockedTargets) && entity.lockedTargets.some(
    (entry) => toInt(entry && (entry.targetID ?? entry.itemID ?? entry), 0) === numericTargetID,
  );
}

function getSurfaceDistance(left, right, options: Record<string, any> = {}) {
  if (typeof options.getSurfaceDistance === "function") {
    return Math.max(0, toFiniteNumber(options.getSurfaceDistance(left, right), Infinity));
  }
  const leftPosition = left && left.position ? left.position : {};
  const rightPosition = right && right.position ? right.position : {};
  const dx = toFiniteNumber(leftPosition.x, 0) - toFiniteNumber(rightPosition.x, 0);
  const dy = toFiniteNumber(leftPosition.y, 0) - toFiniteNumber(rightPosition.y, 0);
  const dz = toFiniteNumber(leftPosition.z, 0) - toFiniteNumber(rightPosition.z, 0);
  const centerDistance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  return Math.max(
    0,
    centerDistance - Math.max(0, toFiniteNumber(left && left.radius, 0)) -
      Math.max(0, toFiniteNumber(right && right.radius, 0)),
  );
}

function validateCreationTarget({
  scene,
  entity,
  targetID,
  maxRange,
  requireLock = true,
  requireShip = true,
  options = {},
}: Record<string, any>) {
  const numericTargetID = toInt(targetID, 0);
  const sourceID = toInt(entity && entity.itemID, 0);
  if (numericTargetID <= 0) {
    return { success: false, errorMsg: "TARGET_REQUIRED" };
  }
  if (numericTargetID === sourceID) {
    return { success: false, errorMsg: "INVALID_TARGET" };
  }
  const targetEntity = resolveSceneEntity(scene, numericTargetID);
  if (!targetEntity || (requireShip && targetEntity.kind !== "ship")) {
    return { success: false, errorMsg: "TARGET_NOT_FOUND" };
  }
  if (requireLock && !isTargetLocked(entity, numericTargetID)) {
    return { success: false, errorMsg: "TARGET_NOT_LOCKED" };
  }
  const surfaceDistance = getSurfaceDistance(entity, targetEntity, options);
  const range = Math.max(0, toFiniteNumber(maxRange, 0));
  if (range > 0 && surfaceDistance > range + 1.0e-6) {
    return {
      success: false,
      errorMsg: "TARGET_OUT_OF_RANGE",
      data: { surfaceDistance, maxRange: range },
    };
  }
  return { success: true, data: { targetEntity, surfaceDistance, maxRange: range } };
}

function resolveShipFuelCapacity(
  shipItem,
  entity,
  dependencies: Record<string, any> = {},
) {
  const liveCapacity = Math.max(
    0,
    toFiniteNumber(
      entity && entity.passiveDerivedState && (
        entity.passiveDerivedState.fuelCapacity ??
        (entity.passiveDerivedState.attributes &&
          entity.passiveDerivedState.attributes[fuelTankRuntime.ATTRIBUTE_FUEL_CAPACITY])
      ),
      0,
    ),
  );
  if (liveCapacity > 0) {
    return liveCapacity;
  }
  const attributes = buildEffectiveItemAttributeMap(shipItem) || {};
  const getCreationDogmaContext = typeof dependencies.getCreationDogmaContext === "function"
    ? dependencies.getCreationDogmaContext
    : require(path.join(__dirname, "./creationRuntime")).getCreationDogmaContext;
  const contextResult = getCreationDogmaContext(
    shipItem,
    toInt(shipItem && shipItem.ownerID, 0),
  );
  if (contextResult && contextResult.success === true && contextResult.data) {
    applyModifierGroups(
      attributes,
      Array.isArray(contextResult.data.shipAttributeModifierEntries)
        ? contextResult.data.shipAttributeModifierEntries
        : [],
    );
  }
  return Math.max(
    0,
    toFiniteNumber(attributes[fuelTankRuntime.ATTRIBUTE_FUEL_CAPACITY], 0),
  );
}

function consumeQueueHead(queue, requestedQuantity) {
  const nextQueue = cloneFuelQueue(queue);
  const consumedBatches = [];
  let remaining = Math.max(0, toFiniteNumber(requestedQuantity, 0));
  while (remaining > FUEL_EPSILON && nextQueue.length > 0) {
    const head = nextQueue[0];
    const quantity = Math.min(remaining, Math.max(0, toFiniteNumber(head.quantity, 0)));
    if (quantity > FUEL_EPSILON) {
      consumedBatches.push({ fuelTypeID: toInt(head.fuelTypeID, 0), quantity });
      head.quantity -= quantity;
      remaining -= quantity;
    }
    if (head.quantity <= FUEL_EPSILON) {
      nextQueue.shift();
    }
  }
  return {
    consumedBatches,
    consumedQuantity: round(
      consumedBatches.reduce((total, entry) => total + entry.quantity, 0),
    ),
    nextQueue: cloneFuelQueue(nextQueue),
    satisfied: remaining <= FUEL_EPSILON,
  };
}

function notifyFuelMutation(callbacks, payload) {
  if (callbacks && typeof callbacks.notifyFuelMutation === "function") {
    callbacks.notifyFuelMutation(payload);
  }
}

function refreshDerivedAfterFuelPropertyChange(callbacks, payload) {
  if (
    JSON.stringify(payload && payload.previousFuelProperties) ===
      JSON.stringify(payload && payload.nextFuelProperties)
  ) {
    return false;
  }
  if (callbacks && typeof callbacks.refreshDerivedState === "function") {
    callbacks.refreshDerivedState(payload);
    return true;
  }
  return false;
}

function preflightCreationPropulsionCycleFuel({
  entity,
  effectState,
  moduleItem,
  creationDogmaContext = null,
  dependencies = {},
}: Record<string, any>) {
  const kind = effectState && effectState.creationActiveKind;
  if (kind !== ACTIVE_KIND_LEAP && kind !== ACTIVE_KIND_THRUST_OVERDRIVE) {
    return { success: false, errorMsg: "NOT_CREATION_PROPULSION_EFFECT" };
  }
  const findShipItemById = typeof dependencies.findShipItemById === "function"
    ? dependencies.findShipItemById
    : itemStore.findShipItemById;
  const shipItem = findShipItemById(toInt(entity && entity.itemID, 0));
  if (!shipItem) {
    return { success: false, errorMsg: "SHIP_NOT_FOUND", stopReason: "fuel" };
  }
  const activeState = resolveCreationActiveThrustState(entity, creationDogmaContext, {
    ...dependencies,
    shipItem,
    additionalActiveEffect: effectState,
  });
  if (
    kind === ACTIVE_KIND_THRUST_OVERDRIVE &&
    activeState.onlineThrusterCount <= 0
  ) {
    return { success: false, errorMsg: "NO_ONLINE_THRUSTERS", stopReason: "module" };
  }
  const attributes = resolveModuleAttributes(moduleItem, effectState);
  const durationSeconds = Math.max(
    0.001,
    toFiniteNumber(effectState && effectState.durationMs, attributes[ATTRIBUTE_DURATION]) / 1000,
  );
  const fuelRate = kind === ACTIVE_KIND_LEAP
    ? Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_LEAP_THRUST_ADD], 0)) *
      LEAP_FUEL_RATE_CONSTANT * activeState.volatilityFactor
    : Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE], 0)) *
      activeState.onlineThrusterCount;
  const requestedFuel = Math.max(0, fuelRate * durationSeconds);
  const availableFuel = fuelTankRuntime.getShipFuelCharge(shipItem);
  if (availableFuel + FUEL_EPSILON < requestedFuel) {
    return {
      success: false,
      errorMsg: "NO_FUEL",
      stopReason: "fuel",
      data: { requestedFuel, availableFuel, activeState },
    };
  }
  return {
    success: true,
    data: { requestedFuel, availableFuel, fuelRate, durationSeconds, activeState },
  };
}

function consumeCreationPropulsionCycleFuel({
  entity,
  effectState,
  moduleItem,
  creationDogmaContext = null,
  session = null,
  nowMs = Date.now(),
  callbacks = {},
  dependencies = {},
}: Record<string, any>) {
  const kind = effectState && effectState.creationActiveKind;
  if (kind !== ACTIVE_KIND_LEAP && kind !== ACTIVE_KIND_THRUST_OVERDRIVE) {
    return { success: false, errorMsg: "NOT_CREATION_PROPULSION_EFFECT" };
  }
  const preflight = preflightCreationPropulsionCycleFuel({
    entity,
    effectState,
    moduleItem,
    creationDogmaContext,
    dependencies,
  });
  if (!preflight.success) {
    return preflight;
  }
  const findShipItemById = typeof dependencies.findShipItemById === "function"
    ? dependencies.findShipItemById
    : itemStore.findShipItemById;
  const shipID = toInt(entity && entity.itemID, 0);
  const shipItem = findShipItemById(shipID);
  if (!shipItem) {
    return { success: false, errorMsg: "SHIP_NOT_FOUND" };
  }
  const queue = fuelTankRuntime.getShipFuelQueue(shipItem);
  const previousFuelCharge = fuelTankRuntime.getShipFuelCharge(shipItem);
  const previousFuelProperties = fuelTankRuntime.getShipFuelProperties(shipItem, dependencies);
  const activeState = resolveCreationActiveThrustState(
    entity,
    creationDogmaContext,
    { ...dependencies, shipItem },
  );
  const attributes = resolveModuleAttributes(moduleItem, effectState);
  const durationSeconds = Math.max(
    0.001,
    toFiniteNumber(effectState && effectState.durationMs, attributes[ATTRIBUTE_DURATION]) / 1000,
  );
  const fuelRate = kind === ACTIVE_KIND_LEAP
    ? Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_LEAP_THRUST_ADD], 0)) *
      LEAP_FUEL_RATE_CONSTANT * activeState.volatilityFactor
    : Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE], 0)) *
      activeState.onlineThrusterCount;
  const requestedFuel = Math.max(0, fuelRate * durationSeconds);
  if (requestedFuel <= FUEL_EPSILON) {
    return {
      success: true,
      data: {
        consumedFuel: 0,
        fuelRate,
        durationSeconds,
        previousFuelCharge,
        nextFuelCharge: previousFuelCharge,
      },
    };
  }
  if (previousFuelCharge + FUEL_EPSILON < requestedFuel) {
    return {
      success: false,
      errorMsg: "NO_FUEL",
      stopReason: "fuel",
      data: { requestedFuel, availableFuel: previousFuelCharge },
    };
  }
  const consumed = consumeQueueHead(queue, requestedFuel);
  if (!consumed.satisfied) {
    return { success: false, errorMsg: "NO_FUEL", stopReason: "fuel" };
  }
  const updateShipItem = typeof dependencies.updateShipItem === "function"
    ? dependencies.updateShipItem
    : itemStore.updateShipItem;
  const writeResult = updateShipItem(shipID, (currentItem) => {
    if (!queuesEqual(fuelTankRuntime.getShipFuelQueue(currentItem), queue)) {
      return null;
    }
    return buildShipWithFuelQueue(currentItem, consumed.nextQueue);
  });
  if (!writeResult || writeResult.success !== true) {
    return {
      success: false,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "FUEL_WRITE_FAILED",
      stopReason: "fuel",
    };
  }
  applyPersistedFuelStateToEntity(entity, writeResult.data);
  const nextFuelProperties = fuelTankRuntime.getShipFuelProperties(writeResult.data, dependencies);
  notifyFuelMutation(callbacks, {
    entity,
    session,
    nowMs,
    previousFuelCharge,
    nextFuelCharge: fuelTankRuntime.getShipFuelCharge(writeResult.data),
    previousFuelProperties,
    nextFuelProperties,
  });
  const derivedStateRefreshed = refreshDerivedAfterFuelPropertyChange(callbacks, {
    entity,
    session,
    nowMs,
    previousFuelProperties,
    nextFuelProperties,
  });
  return {
    success: true,
    data: {
      consumedFuel: consumed.consumedQuantity,
      fuelRate: round(fuelRate),
      durationSeconds,
      previousFuelCharge,
      nextFuelCharge: fuelTankRuntime.getShipFuelCharge(writeResult.data),
      previousFuelProperties,
      nextFuelProperties,
      fuelPropertiesChanged:
        JSON.stringify(previousFuelProperties) !== JSON.stringify(nextFuelProperties),
      derivedStateRefreshed,
    },
  };
}

function preflightTransfuserCycle({
  scene,
  entity,
  moduleItem,
  effectState,
  dependencies = {},
}: Record<string, any>) {
  const attributes = resolveModuleAttributes(moduleItem, effectState);
  const validation = validateCreationTarget({
    scene,
    entity,
    targetID: effectState && effectState.targetID,
    maxRange: attributes[ATTRIBUTE_MAX_RANGE],
    requireLock: true,
    requireShip: true,
    options: dependencies,
  });
  if (!validation.success) {
    return { ...validation, stopReason: "target" };
  }
  const sourceID = toInt(entity && entity.itemID, 0);
  const targetEntity = validation.data.targetEntity;
  const targetID = toInt(targetEntity && targetEntity.itemID, 0);
  const findShipItemById = typeof dependencies.findShipItemById === "function"
    ? dependencies.findShipItemById
    : itemStore.findShipItemById;
  const sourceItem = findShipItemById(sourceID);
  const targetItem = findShipItemById(targetID);
  if (!sourceItem || !targetItem) {
    return { success: false, errorMsg: "SHIP_NOT_FOUND", stopReason: "target" };
  }

  const sourceQueue = fuelTankRuntime.getShipFuelQueue(sourceItem);
  const targetQueue = fuelTankRuntime.getShipFuelQueue(targetItem);
  const sourceFuelCharge = fuelTankRuntime.getShipFuelCharge(sourceItem);
  const targetFuelCharge = fuelTankRuntime.getShipFuelCharge(targetItem);
  const targetCapacity = resolveShipFuelCapacity(targetItem, targetEntity, dependencies);
  const targetFreeCapacity = Math.max(0, targetCapacity - targetFuelCharge);
  const perCycle = Math.max(
    0,
    toFiniteNumber(attributes[ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE], 0),
  );
  const efficiency = clamp(
    toFiniteNumber(attributes[ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY], 0),
    0,
    1,
  );
  if (sourceFuelCharge <= FUEL_EPSILON) {
    return { success: false, errorMsg: "NO_FUEL", stopReason: "fuel" };
  }
  if (targetCapacity <= 0) {
    return { success: false, errorMsg: "TARGET_HAS_NO_FUEL_TANK", stopReason: "target" };
  }
  if (targetFreeCapacity <= FUEL_EPSILON) {
    return { success: false, errorMsg: "TARGET_FUEL_TANK_FULL", stopReason: "target" };
  }
  if (perCycle <= FUEL_EPSILON || efficiency <= FUEL_EPSILON) {
    return { success: false, errorMsg: "INVALID_TRANSFER_RATE", stopReason: "module" };
  }

  const sourceDebit = Math.min(
    perCycle,
    sourceFuelCharge,
    targetFreeCapacity / efficiency,
  );
  return {
    success: true,
    data: {
      attributes,
      sourceID,
      targetID,
      targetEntity,
      sourceItem,
      targetItem,
      sourceQueue,
      targetQueue,
      sourceFuelCharge,
      targetFuelCharge,
      targetCapacity,
      targetFreeCapacity,
      perCycle,
      efficiency,
      sourceDebit,
    },
  };
}

function executeTransfuserCycle(args: Record<string, any>) {
  const {
    scene,
    session = null,
    entity,
    nowMs = Date.now(),
    callbacks = {},
    dependencies = {},
  } = args;
  const preflight = preflightTransfuserCycle(args);
  if (!preflight.success) {
    return preflight;
  }
  const preflightData: Record<string, any> = preflight.data || {};
  const {
    targetEntity,
    sourceItem,
    targetItem,
    sourceQueue,
    targetQueue,
    sourceFuelCharge,
    targetFuelCharge,
    targetCapacity,
    efficiency,
    sourceDebit,
  } = preflightData;
  const consumed = consumeQueueHead(sourceQueue, sourceDebit);
  if (consumed.consumedQuantity <= FUEL_EPSILON) {
    return { success: false, errorMsg: "NO_FUEL", stopReason: "fuel" };
  }
  let nextTargetQueue = cloneFuelQueue(targetQueue);
  for (const batch of consumed.consumedBatches) {
    nextTargetQueue = fuelTankRuntime.appendFuelQueueBatch(
      nextTargetQueue,
      batch.fuelTypeID,
      round(batch.quantity * efficiency),
    );
  }
  const targetFuelTank = fuelTankRuntime.resolveShipFuelTank(
    targetItem,
    targetCapacity,
    dependencies,
  );
  const reserveCapacity = fuelTankRuntime.resolveCreationReserveFuelCapacity(
    targetItem,
    targetFuelTank,
    dependencies,
  );
  nextTargetQueue = fuelTankRuntime.partitionFuelQueueByReserveCapacity(
    nextTargetQueue,
    targetCapacity,
    reserveCapacity,
  );
  nextTargetQueue = fuelTankRuntime.trimFuelQueueToQuantity(
    nextTargetQueue,
    Math.min(targetCapacity, getFuelQueueQuantity(nextTargetQueue)),
  );

  const sourcePreviousProperties = fuelTankRuntime.getShipFuelProperties(sourceItem, dependencies);
  const targetPreviousProperties = fuelTankRuntime.getShipFuelProperties(targetItem, dependencies);
  const commit = commitFuelQueuePair({
    sourceItem,
    targetItem,
    nextSourceQueue: consumed.nextQueue,
    nextTargetQueue,
    dependencies,
  });
  if (!commit.success) {
    return { ...commit, stopReason: "persistence" };
  }
  const nextSourceItem = commit.data.sourceItem;
  const nextTargetItem = commit.data.targetItem;
  applyPersistedFuelStateToEntity(entity, nextSourceItem);
  applyPersistedFuelStateToEntity(targetEntity, nextTargetItem);
  const creditedFuel = Math.max(
    0,
    fuelTankRuntime.getShipFuelCharge(nextTargetItem) - targetFuelCharge,
  );
  const sourceNextProperties = fuelTankRuntime.getShipFuelProperties(nextSourceItem, dependencies);
  const targetNextProperties = fuelTankRuntime.getShipFuelProperties(nextTargetItem, dependencies);

  notifyFuelMutation(callbacks, {
    entity,
    session,
    nowMs,
    previousFuelCharge: sourceFuelCharge,
    nextFuelCharge: fuelTankRuntime.getShipFuelCharge(nextSourceItem),
    previousFuelProperties: sourcePreviousProperties,
    nextFuelProperties: sourceNextProperties,
  });
  const sourceDerivedStateRefreshed = refreshDerivedAfterFuelPropertyChange(callbacks, {
    entity,
    session,
    nowMs,
    previousFuelProperties: sourcePreviousProperties,
    nextFuelProperties: sourceNextProperties,
  });
  notifyFuelMutation(callbacks, {
    entity: targetEntity,
    session: typeof callbacks.getOwningSessionForEntity === "function"
      ? callbacks.getOwningSessionForEntity(scene, targetEntity)
      : targetEntity.session || null,
    nowMs,
    previousFuelCharge: targetFuelCharge,
    nextFuelCharge: fuelTankRuntime.getShipFuelCharge(nextTargetItem),
    previousFuelProperties: targetPreviousProperties,
    nextFuelProperties: targetNextProperties,
  });
  const targetDerivedStateRefreshed = refreshDerivedAfterFuelPropertyChange(callbacks, {
    entity: targetEntity,
    session: typeof callbacks.getOwningSessionForEntity === "function"
      ? callbacks.getOwningSessionForEntity(scene, targetEntity)
      : targetEntity.session || null,
    nowMs,
    previousFuelProperties: targetPreviousProperties,
    nextFuelProperties: targetNextProperties,
  });

  return {
    success: true,
    data: {
      targetEntity,
      sourceDebitedFuel: consumed.consumedQuantity,
      targetCreditedFuel: round(creditedFuel),
      lostFuel: round(consumed.consumedQuantity - creditedFuel),
      efficiency,
      sourceFuelCharge: fuelTankRuntime.getShipFuelCharge(nextSourceItem),
      targetFuelCharge: fuelTankRuntime.getShipFuelCharge(nextTargetItem),
      sourceFuelPropertiesChanged:
        JSON.stringify(sourcePreviousProperties) !== JSON.stringify(sourceNextProperties),
      targetFuelPropertiesChanged:
        JSON.stringify(targetPreviousProperties) !== JSON.stringify(targetNextProperties),
      sourceDerivedStateRefreshed,
      targetDerivedStateRefreshed,
    },
  };
}

function issueApproachFollow({
  scene,
  session,
  entity,
  targetID,
  effectState = null,
  callbacks = {},
}: Record<string, any>) {
  let result;
  if (typeof callbacks.follow === "function") {
    result = callbacks.follow({ scene, session, entity, targetID, range: 0 });
  } else if (scene && session && typeof scene.followBall === "function") {
    result = scene.followBall(session, targetID, 0, { source: "approachComputer" });
  } else if (scene && typeof scene.followShipEntity === "function") {
    result = scene.followShipEntity(entity, targetID, 0, { source: "approachComputer" });
  } else {
    result = false;
  }
  if (result !== false && effectState && typeof effectState === "object") {
    const resultTraceID = result && typeof result === "object"
      ? toInt(result.movementTraceID ?? result.data?.movementTraceID, 0)
      : 0;
    effectState.creationApproachMovementTraceID = resultTraceID ||
      toInt(entity && entity.movementTrace && entity.movementTrace.id, 0);
  }
  return result;
}

function executeApproachComputerCycle({
  scene,
  session,
  entity,
  moduleItem,
  effectState,
  callbacks = {},
  dependencies = {},
}: Record<string, any>) {
  const attributes = resolveModuleAttributes(moduleItem, effectState);
  const validation = validateCreationTarget({
    scene,
    entity,
    targetID: effectState && effectState.targetID,
    maxRange: attributes[ATTRIBUTE_MAX_RANGE],
    requireLock: true,
    requireShip: true,
    options: dependencies,
  });
  if (!validation.success) {
    return { ...validation, stopReason: "target" };
  }
  const followed = issueApproachFollow({
    scene,
    session,
    entity,
    targetID: toInt(effectState.targetID, 0),
    effectState,
    callbacks,
  });
  if (followed && typeof followed === "object" && followed.success === false) {
    return { ...followed, stopReason: "movement" };
  }
  if (followed === false) {
    return { success: false, errorMsg: "APPROACH_COMMAND_FAILED", stopReason: "movement" };
  }
  return { success: true, data: { targetEntity: validation.data.targetEntity } };
}

function preflightCreationActiveModuleCycle(args: Record<string, any> = {}) {
  const effectState = args.effectState;
  if (!effectState || effectState.creationActiveModuleEffect !== true) {
    return { matched: false, success: true };
  }
  const kind = effectState.creationActiveKind;
  if (kind === ACTIVE_KIND_LEAP || kind === ACTIVE_KIND_THRUST_OVERDRIVE) {
    return { matched: true, ...preflightCreationPropulsionCycleFuel(args) };
  }
  if (kind === ACTIVE_KIND_TRANSFUSER) {
    return { matched: true, ...preflightTransfuserCycle(args) };
  }
  if (kind === ACTIVE_KIND_APPROACH) {
    const attributes = resolveModuleAttributes(args.moduleItem, effectState);
    const validation = validateCreationTarget({
      scene: args.scene,
      entity: args.entity,
      targetID: effectState.targetID,
      maxRange: attributes[ATTRIBUTE_MAX_RANGE],
      requireLock: true,
      requireShip: true,
      options: args.dependencies || {},
    });
    return validation.success
      ? { matched: true, success: true, data: validation.data }
      : { matched: true, ...validation, stopReason: "target" };
  }
  return { matched: false, success: true };
}

function cleanupCreationActiveModuleEffect({
  scene,
  entity,
  effectState,
  callbacks = {},
}: Record<string, any> = {}) {
  if (
    !effectState ||
    effectState.creationActiveModuleEffect !== true ||
    effectState.creationActiveKind !== ACTIVE_KIND_APPROACH
  ) {
    return { matched: false, success: true };
  }
  const controlledTargetID = toInt(effectState.targetID, 0);
  const controlledTraceID = toInt(effectState.creationApproachMovementTraceID, 0);
  if (
    !entity ||
    controlledTargetID <= 0 ||
    controlledTraceID <= 0 ||
    toInt(entity.targetEntityID, 0) !== controlledTargetID ||
    toInt(entity.movementTrace && entity.movementTrace.id, 0) !== controlledTraceID
  ) {
    return { matched: true, success: true, data: { stopped: false } };
  }
  const stopped = typeof callbacks.stop === "function"
    ? callbacks.stop({ scene, entity, effectState, reason: "approachComputerDeactivated" })
    : scene && typeof scene.stopShipEntity === "function"
      ? scene.stopShipEntity(entity, { reason: "approachComputerDeactivated" })
      : false;
  return { matched: true, success: stopped !== false, data: { stopped: stopped !== false } };
}

function executeCreationActiveModuleCycle(args: Record<string, any> = {}) {
  const effectState = args.effectState;
  if (!effectState || effectState.creationActiveModuleEffect !== true) {
    return { matched: false, success: true };
  }
  const kind = effectState.creationActiveKind;
  let result;
  if (kind === ACTIVE_KIND_LEAP || kind === ACTIVE_KIND_THRUST_OVERDRIVE) {
    result = consumeCreationPropulsionCycleFuel(args);
  } else if (kind === ACTIVE_KIND_TRANSFUSER) {
    result = executeTransfuserCycle(args);
  } else if (kind === ACTIVE_KIND_APPROACH) {
    result = executeApproachComputerCycle(args);
  } else {
    return { matched: false, success: true };
  }
  return { matched: true, ...result };
}

module.exports = {
  ACTIVE_KIND_APPROACH,
  ACTIVE_KIND_LEAP,
  ACTIVE_KIND_THRUST_OVERDRIVE,
  ACTIVE_KIND_TRANSFUSER,
  ATTRIBUTE_CONTAINMENT_REDUCTION,
  ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY,
  ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE,
  ATTRIBUTE_LEAP_THRUST_ADD,
  ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE,
  ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE,
  CREATION_ACTIVE_MODULE_TYPE_IDS,
  EFFECT_APPROACH_COMPUTER,
  EFFECT_HULL_REPAIRER,
  EFFECT_LEAP,
  EFFECT_THRUST_OVERDRIVE,
  EFFECT_TRANSFUSER,
  LEAP_FUEL_RATE_CONSTANT,
  TYPE_APPROACH_COMPUTER,
  TYPE_HULL_REPAIRER,
  TYPE_LEAP,
  TYPE_THRUST_OVERDRIVE,
  TYPE_TRANSFUSER,
  applyCreationActiveThrustToResourceState,
  applyPersistedFuelStateToEntity,
  calculateCreationActiveThrust,
  calculateFuelAttributeFactors,
  captureCreationModuleAttributes,
  buildCreationActiveEffectPatch,
  cleanupCreationActiveModuleEffect,
  commitFuelQueuePair,
  consumeCreationPropulsionCycleFuel,
  executeApproachComputerCycle,
  executeCreationActiveModuleCycle,
  executeTransfuserCycle,
  getActiveCreationEffectStates,
  getSurfaceDistance,
  isTargetLocked,
  issueApproachFollow,
  markCreationActiveEffect,
  preflightCreationActiveModuleCycle,
  preflightCreationPropulsionCycleFuel,
  preflightTransfuserCycle,
  resolveCreationActiveThrustState,
  resolveSceneEntity,
  validateCreationTarget,
};
