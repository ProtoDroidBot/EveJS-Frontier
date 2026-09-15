"use strict";

/**
 * Authoritative Frontier ship-temperature simulation.
 *
 * The formulas and constants below mirror the build-3502403 client heat
 * system.  A hull's external temperature is determined by its distance from
 * the system star, except while the star is occluded (deep-space background)
 * or the hull is in warp.  The hull itself approaches that external target
 * exponentially according to its effective heat capacity and conductance.
 */

const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_HEAT_CAPACITY = 5762;
const ATTRIBUTE_HEAT_CONDUCTANCE = 5763;
const ATTRIBUTE_EXTERNAL_TEMPERATURE = 5764;
const ATTRIBUTE_TEMPERATURE = 5765;
const ATTRIBUTE_CONTINUOUS_HEAT = 5766;

const FROSTLINE_TEMPERATURE_K = 150;
const SHADOW_TEMPERATURE_K = 2.7;
const WARP_TEMPERATURE_K = 0;
const STATION_TEMPERATURE_K = 295;
const DEFAULT_STAR_TEMPERATURE_K = 5778;
const THERMAL_SIGNATURE_REFERENCE_TEMPERATURE_K = STATION_TEMPERATURE_K;
const MINIMUM_THERMAL_SIGNATURE_MULTIPLIER = 0.01;
const TEMPERATURE_NOTIFICATION_INTERVAL_MS = 1000;
const TEMPERATURE_NOTIFICATION_EPSILON_K = 0.01;

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getEntityAttributeMap(entity) {
  const attributes = entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes;
  return attributes && typeof attributes === "object" ? attributes : null;
}

function getAttributeValue(attributes, attributeID, fallback = null) {
  if (!attributes || typeof attributes !== "object") {
    return fallback;
  }
  const value = Number(
    attributes[String(attributeID)] ?? attributes[attributeID],
  );
  return Number.isFinite(value) ? value : fallback;
}

function setAttributeValue(attributes, attributeID, value) {
  if (attributes && typeof attributes === "object") {
    attributes[String(attributeID)] = value;
  }
}

function hasFinitePosition(entity) {
  return Boolean(
    entity &&
    entity.position &&
    Number.isFinite(Number(entity.position.x)) &&
    Number.isFinite(Number(entity.position.y)) &&
    Number.isFinite(Number(entity.position.z)),
  );
}

function distanceBetween(left, right) {
  if (!hasFinitePosition(left) || !hasFinitePosition(right)) {
    return 0;
  }
  const dx = Number(left.position.x) - Number(right.position.x);
  const dy = Number(left.position.y) - Number(right.position.y);
  const dz = Number(left.position.z) - Number(right.position.z);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

/** Client-authored in_space_temperature_kelvin/temperature_by_distance. */
function temperatureByDistance(
  distanceFromSunMeters,
  frostlineRadiusMeters,
  maximumTemperatureK = DEFAULT_STAR_TEMPERATURE_K,
) {
  const distance = Math.max(1, toFiniteNumber(distanceFromSunMeters, 1));
  const frostline = Math.max(1, toFiniteNumber(frostlineRadiusMeters, 1));
  const maximum = Math.max(
    FROSTLINE_TEMPERATURE_K,
    toFiniteNumber(maximumTemperatureK, DEFAULT_STAR_TEMPERATURE_K),
  );
  return Math.min(
    maximum,
    FROSTLINE_TEMPERATURE_K * Math.sqrt(frostline / distance),
  );
}

function resolveSystemFrostlineRadius(system, star = null) {
  const authored = toFiniteNumber(
    system && (system.frostLine ?? system.frostline),
    0,
  );
  if (authored > 0) {
    return authored;
  }

  const habitableZone = system && system.habitableZone;
  if (Array.isArray(habitableZone)) {
    const outerRadius = toFiniteNumber(habitableZone[1], 0);
    if (outerRadius > 0) {
      // The exact frost line is authored by solarSystemContent. Older stores
      // did not retain it; the outer habitable radius is the closest retained
      // physical scale and keeps the distance curve meaningful.
      return outerRadius;
    }
  }

  const systemRadius = toFiniteNumber(system && system.radius, 0);
  if (systemRadius > 0) {
    return systemRadius;
  }
  return Math.max(1, toFiniteNumber(star && star.radius, 1));
}

function resolveStarTemperature(system, star = null) {
  const statistics = star && star.statistics;
  return Math.max(
    FROSTLINE_TEMPERATURE_K,
    toFiniteNumber(
      system && (system.starTemperature ?? system.starTemperatureK),
      toFiniteNumber(
        statistics && statistics.temperature,
        toFiniteNumber(
          star && (star.temperature ?? star.temperatureK),
          DEFAULT_STAR_TEMPERATURE_K,
        ),
      ),
    ),
  );
}

function resolveSceneStar(scene) {
  const staticEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  const star = staticEntities.find((entity) => {
    const kind = String(entity && entity.kind || "").trim().toLowerCase();
    return kind === "sun" || kind === "star" || Number(entity && entity.groupID) === 6;
  });
  if (star && hasFinitePosition(star)) {
    return star;
  }
  return {
    kind: "sun",
    itemID: 0,
    radius: 0,
    position: { x: 0, y: 0, z: 0 },
  };
}

function resolveSolarOccluder(scene, star, entity, options: Record<string, any> = {}) {
  if (!scene || !star || !entity || !hasFinitePosition(entity)) {
    return null;
  }
  const findLineOccluder = options.findLineOccluder;
  if (typeof findLineOccluder !== "function") {
    return null;
  }
  return findLineOccluder(scene, star, entity, {
    ignoreEntityIDs: Array.isArray(options.ignoreEntityIDs)
      ? options.ignoreEntityIDs
      : [],
  });
}

function resolveExternalTemperature(scene, entity, options: Record<string, any> = {}) {
  const star = options.star || resolveSceneStar(scene);
  if (String(entity && entity.mode || "").trim().toUpperCase() === "WARP") {
    return {
      externalTemperature: WARP_TEMPERATURE_K,
      distanceFromStar: distanceBetween(star, entity),
      frostlineRadius: resolveSystemFrostlineRadius(scene && scene.system, star),
      occluder: null,
      shadowed: false,
      star,
    };
  }

  const occluder = resolveSolarOccluder(scene, star, entity, options);
  const distanceFromStar = distanceBetween(star, entity);
  const frostlineRadius = resolveSystemFrostlineRadius(
    scene && scene.system,
    star,
  );
  return {
    externalTemperature: occluder
      ? SHADOW_TEMPERATURE_K
      : temperatureByDistance(
          distanceFromStar,
          frostlineRadius,
          resolveStarTemperature(scene && scene.system, star),
        ),
    distanceFromStar,
    frostlineRadius,
    occluder,
    shadowed: Boolean(occluder),
    star,
  };
}

function resolveEffectiveThermalProperties({
  heatCapacity,
  heatConductance,
  massKg,
}: Record<string, any>) {
  const capacity = Math.max(0, toFiniteNumber(heatCapacity, 0));
  const conductance = Math.max(0, toFiniteNumber(heatConductance, 0));
  const massTonnes = Math.max(0, toFiniteNumber(massKg, 0) * 0.001);
  const effectiveHeatCapacity = capacity * massTonnes;
  const effectiveHeatConductance = conductance * Math.pow(massTonnes, 2 / 3);
  return {
    effectiveHeatCapacity,
    effectiveHeatConductance,
    timeScaleSeconds:
      effectiveHeatCapacity > 0 && effectiveHeatConductance > 0
        ? effectiveHeatCapacity / effectiveHeatConductance
        : 0,
  };
}

function calculateTargetTemperature(
  externalTemperature,
  continuousHeat,
  effectiveHeatConductance,
) {
  const ambient = Math.max(0, toFiniteNumber(externalTemperature, 0));
  const conductance = Math.max(0, toFiniteNumber(effectiveHeatConductance, 0));
  return conductance > 0
    ? ambient + (toFiniteNumber(continuousHeat, 0) / conductance)
    : ambient;
}

/** Client-authored exponential cooling/heating recipe. */
function approachTemperature(
  startingTemperature,
  targetTemperature,
  elapsedSeconds,
  timeScaleSeconds,
) {
  const starting = Math.max(0, toFiniteNumber(startingTemperature, 0));
  const target = Math.max(0, toFiniteNumber(targetTemperature, 0));
  const elapsed = Math.max(0, toFiniteNumber(elapsedSeconds, 0));
  const timeScale = Math.max(0, toFiniteNumber(timeScaleSeconds, 0));
  if (elapsed <= 0) {
    return starting;
  }
  if (timeScale <= 0) {
    return target;
  }
  return target + ((starting - target) * Math.exp(-elapsed / timeScale));
}

function isTemperatureCapableEntity(entity) {
  if (!entity || String(entity.kind || "").toLowerCase() !== "ship") {
    return false;
  }
  const attributes = getEntityAttributeMap(entity);
  return (
    getAttributeValue(attributes, ATTRIBUTE_HEAT_CAPACITY, 0) > 0 &&
    getAttributeValue(attributes, ATTRIBUTE_HEAT_CONDUCTANCE, 0) > 0
  );
}

function roundTemperature(value) {
  return Number(Math.max(0, toFiniteNumber(value, 0)).toFixed(6));
}

function advanceShipTemperature(
  scene,
  entity,
  nowMs = Date.now(),
  options: Record<string, any> = {},
) {
  if (!isTemperatureCapableEntity(entity)) {
    return {
      supported: false,
      notification: null,
    };
  }

  const attributes = getEntityAttributeMap(entity);
  const conditionState = entity.conditionState &&
    typeof entity.conditionState === "object"
      ? entity.conditionState
      : {};
  const previousState = entity.temperatureState &&
    typeof entity.temperatureState === "object"
      ? entity.temperatureState
      : null;
  const currentTimeMs = toFiniteNumber(nowMs, Date.now());
  const startingTemperature = Math.max(
    0,
    toFiniteNumber(
      previousState && previousState.temperature,
      toFiniteNumber(
        conditionState.temperature,
        getAttributeValue(
          attributes,
          ATTRIBUTE_TEMPERATURE,
          STATION_TEMPERATURE_K,
        ),
      ),
    ),
  );
  const previousExternalTemperature = Math.max(
    0,
    toFiniteNumber(
      previousState && previousState.externalTemperature,
      toFiniteNumber(
        conditionState.externalTemperature,
        getAttributeValue(
          attributes,
          ATTRIBUTE_EXTERNAL_TEMPERATURE,
          STATION_TEMPERATURE_K,
        ),
      ),
    ),
  );
  const lastUpdatedAtMs = previousState
    ? Math.min(
        currentTimeMs,
        toFiniteNumber(previousState.lastUpdatedAtMs, currentTimeMs),
      )
    : currentTimeMs;
  const heatCapacity = getAttributeValue(
    attributes,
    ATTRIBUTE_HEAT_CAPACITY,
    0,
  );
  const heatConductance = getAttributeValue(
    attributes,
    ATTRIBUTE_HEAT_CONDUCTANCE,
    0,
  );
  const continuousHeat = getAttributeValue(
    attributes,
    ATTRIBUTE_CONTINUOUS_HEAT,
    0,
  );
  const massKg = Math.max(
    0,
    toFiniteNumber(
      entity.mass,
      getAttributeValue(attributes, ATTRIBUTE_MASS, 0),
    ),
  );
  const thermalProperties = resolveEffectiveThermalProperties({
    heatCapacity,
    heatConductance,
    massKg,
  });
  const previousTargetTemperature = calculateTargetTemperature(
    previousExternalTemperature,
    continuousHeat,
    thermalProperties.effectiveHeatConductance,
  );
  const temperature = roundTemperature(approachTemperature(
    startingTemperature,
    previousTargetTemperature,
    (currentTimeMs - lastUpdatedAtMs) / 1000,
    thermalProperties.timeScaleSeconds,
  ));
  const environment = resolveExternalTemperature(scene, entity, options);
  const externalTemperature = roundTemperature(
    environment.externalTemperature,
  );
  const targetTemperature = roundTemperature(calculateTargetTemperature(
    externalTemperature,
    continuousHeat,
    thermalProperties.effectiveHeatConductance,
  ));

  setAttributeValue(attributes, ATTRIBUTE_EXTERNAL_TEMPERATURE, externalTemperature);
  setAttributeValue(attributes, ATTRIBUTE_TEMPERATURE, temperature);
  if (getAttributeValue(attributes, ATTRIBUTE_CONTINUOUS_HEAT, null) === null) {
    setAttributeValue(attributes, ATTRIBUTE_CONTINUOUS_HEAT, 0);
  }
  entity.conditionState = {
    ...conditionState,
    temperature,
    externalTemperature,
  };

  const lastNotifiedAtMs = previousState
    ? toFiniteNumber(previousState.lastNotifiedAtMs, currentTimeMs)
    : currentTimeMs;
  const lastNotifiedTemperature = previousState
    ? toFiniteNumber(previousState.lastNotifiedTemperature, startingTemperature)
    : temperature;
  const lastNotifiedExternalTemperature = previousState
    ? toFiniteNumber(
        previousState.lastNotifiedExternalTemperature,
        previousExternalTemperature,
      )
    : externalTemperature;
  const shadowChanged = Boolean(
    previousState && previousState.shadowed !== environment.shadowed,
  );
  const changedSinceNotification =
    Math.abs(temperature - lastNotifiedTemperature) >=
      TEMPERATURE_NOTIFICATION_EPSILON_K ||
    Math.abs(externalTemperature - lastNotifiedExternalTemperature) >=
      TEMPERATURE_NOTIFICATION_EPSILON_K;
  const notificationDue = options.notify !== false && (
    options.forceNotify === true ||
    shadowChanged ||
    (
      changedSinceNotification &&
      currentTimeMs - lastNotifiedAtMs >= TEMPERATURE_NOTIFICATION_INTERVAL_MS
    )
  );
  const notification = notificationDue
    ? {
        previousExternalTemperature: lastNotifiedExternalTemperature,
        previousTemperature: lastNotifiedTemperature,
        externalTemperature,
        temperature,
        shadowChanged,
      }
    : null;

  entity.temperatureState = {
    distanceFromStar: environment.distanceFromStar,
    externalTemperature,
    frostlineRadius: environment.frostlineRadius,
    lastNotifiedAtMs: notificationDue ? currentTimeMs : lastNotifiedAtMs,
    lastNotifiedExternalTemperature: notificationDue
      ? externalTemperature
      : lastNotifiedExternalTemperature,
    lastNotifiedTemperature: notificationDue
      ? temperature
      : lastNotifiedTemperature,
    lastUpdatedAtMs: currentTimeMs,
    occluderID: environment.occluder
      ? environment.occluder.entityID ??
        (environment.occluder.entity && environment.occluder.entity.itemID) ??
        null
      : null,
    shadowed: environment.shadowed,
    targetTemperature,
    temperature,
    timeScaleSeconds: thermalProperties.timeScaleSeconds,
  };

  return {
    supported: true,
    ...entity.temperatureState,
    notification,
  };
}

function tickScene(scene, nowMs = Date.now(), options: Record<string, any> = {}) {
  const entities = scene && typeof scene.getDynamicEntities === "function"
    ? scene.getDynamicEntities()
    : scene && scene.dynamicEntities instanceof Map
      ? [...scene.dynamicEntities.values()]
      : [];
  const results: any[] = [];
  for (const entity of entities) {
    const result = advanceShipTemperature(scene, entity, nowMs, options);
    if (!result.supported) {
      continue;
    }
    const entry = { entity, result };
    results.push(entry);
    if (typeof options.onAdvanced === "function") {
      options.onAdvanced(entity, result);
    }
  }
  return results;
}

function resolveProjectedEntityTemperature(entity, nowMs = Date.now()) {
  const state = entity && entity.temperatureState;
  if (state && typeof state === "object") {
    const elapsedSeconds = Math.max(
      0,
      (toFiniteNumber(nowMs, Date.now()) -
        toFiniteNumber(state.lastUpdatedAtMs, nowMs)) / 1000,
    );
    return approachTemperature(
      state.temperature,
      state.targetTemperature,
      elapsedSeconds,
      state.timeScaleSeconds,
    );
  }
  const attributes = getEntityAttributeMap(entity);
  const attributeTemperature = getAttributeValue(
    attributes,
    ATTRIBUTE_TEMPERATURE,
    null,
  );
  if (attributeTemperature !== null) {
    return Math.max(0, attributeTemperature);
  }
  const conditionTemperature = Number(
    entity && entity.conditionState && entity.conditionState.temperature,
  );
  return Number.isFinite(conditionTemperature)
    ? Math.max(0, conditionTemperature)
    : null;
}

/**
 * Thermal scan strength is proportional to absolute hull temperature. A hull
 * without Frontier heat attributes remains neutral for legacy compatibility.
 */
function resolveEntityThermalSignatureMultiplier(entity, nowMs = Date.now()) {
  const temperature = resolveProjectedEntityTemperature(entity, nowMs);
  if (temperature === null) {
    return 1;
  }
  return Math.max(
    MINIMUM_THERMAL_SIGNATURE_MULTIPLIER,
    temperature / THERMAL_SIGNATURE_REFERENCE_TEMPERATURE_K,
  );
}

module.exports = {
  ATTRIBUTE_CONTINUOUS_HEAT,
  ATTRIBUTE_EXTERNAL_TEMPERATURE,
  ATTRIBUTE_HEAT_CAPACITY,
  ATTRIBUTE_HEAT_CONDUCTANCE,
  ATTRIBUTE_MASS,
  ATTRIBUTE_TEMPERATURE,
  DEFAULT_STAR_TEMPERATURE_K,
  FROSTLINE_TEMPERATURE_K,
  MINIMUM_THERMAL_SIGNATURE_MULTIPLIER,
  SHADOW_TEMPERATURE_K,
  STATION_TEMPERATURE_K,
  TEMPERATURE_NOTIFICATION_EPSILON_K,
  TEMPERATURE_NOTIFICATION_INTERVAL_MS,
  THERMAL_SIGNATURE_REFERENCE_TEMPERATURE_K,
  WARP_TEMPERATURE_K,
  advanceShipTemperature,
  approachTemperature,
  calculateTargetTemperature,
  distanceBetween,
  isTemperatureCapableEntity,
  resolveEffectiveThermalProperties,
  resolveEntityThermalSignatureMultiplier,
  resolveExternalTemperature,
  resolveProjectedEntityTemperature,
  resolveSceneStar,
  resolveSolarOccluder,
  resolveStarTemperature,
  resolveSystemFrostlineRadius,
  temperatureByDistance,
  tickScene,
};
