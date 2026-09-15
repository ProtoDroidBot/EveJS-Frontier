"use strict";

/**
 * Authoritative Frontier environmental-status simulation.
 *
 * The build-3502403 client exposes three status-effect keys and the matching
 * ship dogma attributes, but it leaves progression to the server. This module
 * owns that progression and the shell vitality that a triggered effect burns.
 */

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  CRUDE_MATTER_GROUP_ID,
  CRUDE_RIFT_GROUP_ID,
} = require(path.join(__dirname, "../../space/frontierRiftAuthority"));

const STATUS_EFFECT_KEYS = Object.freeze({
  HEAT: "heat",
  FERALIZATION: "feralization",
  TEMPORAL_DRIFT: "temporal_drift",
});
const STATUS_EFFECT_KEY_SET = new Set<string>(Object.values(STATUS_EFFECT_KEYS));

// build-3502403 dogma/const/attributes.pyc
const ATTRIBUTE_FERALIZATION = 6219;
const ATTRIBUTE_FERALIZATION_CAPACITY = 6220;
const ATTRIBUTE_FERALIZATION_CONDUCTANCE = 6221;
const ATTRIBUTE_EXTERNAL_FERALIZATION = 6222;
const ATTRIBUTE_CONTINUOUS_FERALIZATION = 6223;
const ATTRIBUTE_NOMINAL_MAX_FERALIZATION = 6224;
const ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT = 6228;
const ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN = 6229;
const ATTRIBUTE_TEMPORAL_DRIFT = 6343;
const ATTRIBUTE_TEMPORAL_DRIFT_CAPACITY = 6345;
const ATTRIBUTE_TEMPORAL_DRIFT_CONDUCTANCE = 6346;
const ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT = 6347;
const ATTRIBUTE_CONTINUOUS_TEMPORAL_DRIFT = 6348;
const ATTRIBUTE_NOMINAL_MAX_TEMPORAL_DRIFT = 6349;

// build-3502403 frontier.heat_system.common.heat_constants
const OVERHEATED_TEMPERATURE_K = 500;
const CRITICAL_TEMPERATURE_K = 1500;

const DEFAULT_SHELL_VITALITY = 100;
const DEFAULT_VITALITY_DRAIN_PER_EFFECT_PER_SECOND = 1;
const DEFAULT_ENVIRONMENTAL_CAPACITY = 30;
const DEFAULT_ENVIRONMENTAL_CONDUCTANCE = 1;
const DEFAULT_NOMINAL_MAX = 100;
const RIFT_TEMPORALIZATION_RADIUS_METERS = 100_000;
const RIFT_TEMPORAL_DRIFT_MULTIPLIER = 2;
const MAX_ADVANCE_SECONDS = 5;
const CLIENT_NOTIFICATION_INTERVAL_MS = 1_000;
const CLIENT_GRACE_NOTIFICATION_EPSILON = 0.001;
const CLIENT_ATTRIBUTE_NOTIFICATION_EPSILON = 0.001;

const characterStates = new Map();

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, toFiniteNumber(value, minimum)));
}

function round6(value) {
  return Number(toFiniteNumber(value, 0).toFixed(6));
}

function normalizeStatusEffectKey(value) {
  const rawValue = value && typeof value === "object" && value.value !== undefined
    ? value.value
    : value;
  const normalized = String(rawValue || "").trim().toLowerCase();
  return STATUS_EFFECT_KEY_SET.has(normalized) ? normalized : null;
}

function getEntityAttributeMap(entity) {
  const attributes = entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes;
  return attributes && typeof attributes === "object" ? attributes : null;
}

function getAttributeValue(entity, attributeID, fallback = null) {
  const attributes = getEntityAttributeMap(entity);
  if (attributes) {
    const value = Number(
      attributes[String(attributeID)] ?? attributes[attributeID],
    );
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

function getEntityOrTypeAttributeValue(
  entity,
  attributeID,
  attributeName,
  fallback = 0,
) {
  const entityValue = getAttributeValue(entity, attributeID, null);
  if (entityValue !== null) {
    return entityValue;
  }
  const typeValue = getTypeAttributeValue(
    toPositiveInt(entity && entity.typeID, 0),
    attributeName,
  );
  return toFiniteNumber(typeValue, fallback);
}

function setAttributeValue(entity, attributeID, value) {
  const attributes = getEntityAttributeMap(entity);
  if (attributes) {
    attributes[String(attributeID)] = round6(value);
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

function getSurfaceDistance(left, right) {
  if (!hasFinitePosition(left) || !hasFinitePosition(right)) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = Number(left.position.x) - Number(right.position.x);
  const dy = Number(left.position.y) - Number(right.position.y);
  const dz = Number(left.position.z) - Number(right.position.z);
  const centerDistance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  return Math.max(
    0,
    centerDistance -
      Math.max(0, toFiniteNumber(left.radius, 0)) -
      Math.max(0, toFiniteNumber(right.radius, 0)),
  );
}

function isCrudeMatterRiftEntity(entity) {
  if (!entity) {
    return false;
  }
  return Boolean(
    entity.customFrontierRiftSite === true ||
    entity.frontierRiftResource === true ||
    String(entity.kind || "").trim().toLowerCase() === "riftdungeon" ||
    Number(entity.groupID) === CRUDE_RIFT_GROUP_ID ||
    Number(entity.groupID) === CRUDE_MATTER_GROUP_ID
  );
}

function listSceneRiftEntities(scene) {
  const staticEntities = Array.isArray(scene && scene.staticEntities)
    ? scene.staticEntities
    : [];
  return staticEntities.filter(isCrudeMatterRiftEntity);
}

function resolveRiftTemporalization(
  scene,
  entity,
  options: Record<string, any> = {},
) {
  const radius = Math.max(
    1,
    toFiniteNumber(
      options.riftTemporalizationRadiusMeters,
      RIFT_TEMPORALIZATION_RADIUS_METERS,
    ),
  );
  let nearestRift = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const rift of listSceneRiftEntities(scene)) {
    const distance = getSurfaceDistance(entity, rift);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestRift = rift;
    }
  }
  const intensity = nearestRift
    ? clamp(1 - (nearestDistance / radius), 0, 1)
    : 0;
  return {
    intensity: round6(intensity),
    nearestDistance,
    nearestRift,
    radius,
  };
}

function resolveCharacterID(entityOrSession) {
  const source = entityOrSession || {};
  return toPositiveInt(
    source.characterID ??
      source.charid ??
      source.pilotCharacterID ??
      (source.session && (
        source.session.characterID ?? source.session.charid
      )),
    0,
  );
}

function buildEffectState() {
  return {
    active: false,
    armed: false,
    grace: 0,
    lastNotifiedActive: false,
    lastNotifiedArmed: false,
    lastNotifiedGrace: 0,
  };
}

function createCharacterState(characterID, entity = null, nowMs = Date.now()) {
  const feralization = Math.max(
    0,
    toFiniteNumber(getAttributeValue(entity, ATTRIBUTE_FERALIZATION, 0), 0),
  );
  const temporalDrift = Math.max(
    0,
    toFiniteNumber(getAttributeValue(entity, ATTRIBUTE_TEMPORAL_DRIFT, 0), 0),
  );
  return {
    characterID,
    effects: {
      [STATUS_EFFECT_KEYS.HEAT]: buildEffectState(),
      [STATUS_EFFECT_KEYS.FERALIZATION]: buildEffectState(),
      [STATUS_EFFECT_KEYS.TEMPORAL_DRIFT]: buildEffectState(),
    },
    feralization,
    lastNotifiedAtMs: toFiniteNumber(nowMs, Date.now()),
    lastNotifiedAttributes: {
      [ATTRIBUTE_FERALIZATION]: feralization,
      [ATTRIBUTE_EXTERNAL_FERALIZATION]: toFiniteNumber(
        getAttributeValue(entity, ATTRIBUTE_EXTERNAL_FERALIZATION, 0),
        0,
      ),
      [ATTRIBUTE_TEMPORAL_DRIFT]: temporalDrift,
      [ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT]: toFiniteNumber(
        getAttributeValue(entity, ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT, 0),
        0,
      ),
    },
    lastNotifiedVitalityDamage: 0,
    lastUpdatedAtMs: toFiniteNumber(nowMs, Date.now()),
    temporalDrift,
    vitality: DEFAULT_SHELL_VITALITY,
    vitalityCapacity: DEFAULT_SHELL_VITALITY,
  };
}

function ensureCharacterState(characterID, entity = null, nowMs = Date.now()) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID <= 0) {
    return null;
  }
  if (!characterStates.has(numericCharacterID)) {
    characterStates.set(
      numericCharacterID,
      createCharacterState(numericCharacterID, entity, nowMs),
    );
  }
  return characterStates.get(numericCharacterID);
}

function cloneEffectState(effect) {
  return {
    active: effect && effect.active === true,
    armed: effect && effect.armed === true,
    grace: round6(effect && effect.grace),
  };
}

function snapshotCharacterState(characterID, options: Record<string, any> = {}) {
  const state = options.create === false
    ? characterStates.get(toPositiveInt(characterID, 0)) || null
    : ensureCharacterState(characterID, options.entity || null, options.nowMs);
  if (!state) {
    return null;
  }
  return {
    characterID: state.characterID,
    effects: Object.fromEntries(
      Object.entries(state.effects).map(([key, effect]) => [
        key,
        cloneEffectState(effect),
      ]),
    ),
    feralization: round6(state.feralization),
    temporalDrift: round6(state.temporalDrift),
    vitality: round6(state.vitality),
    vitalityCapacity: round6(state.vitalityCapacity),
    vitalityDamage: round6(state.vitalityCapacity - state.vitality),
  };
}

function approachEnvironmentalValue(
  startingValue,
  externalValue,
  continuousValue,
  capacity,
  conductance,
  elapsedSeconds,
) {
  const starting = Math.max(0, toFiniteNumber(startingValue, 0));
  const external = Math.max(0, toFiniteNumber(externalValue, 0));
  const continuous = toFiniteNumber(continuousValue, 0);
  const resolvedCapacity = Math.max(0, toFiniteNumber(capacity, 0));
  const resolvedConductance = Math.max(0, toFiniteNumber(conductance, 0));
  const elapsed = Math.max(0, toFiniteNumber(elapsedSeconds, 0));
  const target = resolvedConductance > 0
    ? Math.max(0, external + (continuous / resolvedConductance))
    : external;
  if (elapsed <= 0) {
    return starting;
  }
  const timeScale = resolvedConductance > 0
    ? resolvedCapacity / resolvedConductance
    : 0;
  if (timeScale <= 0) {
    return target;
  }
  return target + ((starting - target) * Math.exp(-elapsed / timeScale));
}

function resolveTemperature(entity, nowMs = Date.now()) {
  const temperatureState = entity && entity.temperatureState;
  if (temperatureState && typeof temperatureState === "object") {
    const elapsedSeconds = Math.max(
      0,
      (toFiniteNumber(nowMs, Date.now()) -
        toFiniteNumber(temperatureState.lastUpdatedAtMs, nowMs)) / 1000,
    );
    const starting = Math.max(
      0,
      toFiniteNumber(temperatureState.temperature, 0),
    );
    const target = Math.max(
      0,
      toFiniteNumber(temperatureState.targetTemperature, starting),
    );
    const timeScale = Math.max(
      0,
      toFiniteNumber(temperatureState.timeScaleSeconds, 0),
    );
    if (elapsedSeconds <= 0 || timeScale <= 0) {
      return timeScale <= 0 ? target : starting;
    }
    return target + ((starting - target) * Math.exp(-elapsedSeconds / timeScale));
  }
  return Math.max(
    0,
    toFiniteNumber(
      entity && entity.conditionState && entity.conditionState.temperature,
      0,
    ),
  );
}

function resolveHeatGrace(entity, nowMs = Date.now()) {
  const temperature = resolveTemperature(entity, nowMs);
  return {
    grace: clamp(
      (temperature - OVERHEATED_TEMPERATURE_K) /
        (CRITICAL_TEMPERATURE_K - OVERHEATED_TEMPERATURE_K),
      0,
      1,
    ),
    temperature,
  };
}

function updateEffectState(effect, grace, armed) {
  effect.grace = round6(clamp(grace, 0, 1));
  effect.armed = armed === true;
  // Triggered shell effects are injuries. Leaving the source stops further
  // buildup, but a remedy (future shell progression) must clear the injury.
  if (effect.grace >= 1) {
    effect.active = true;
  }
  return effect;
}

function collectClientNotifications(
  state,
  entity,
  nowMs,
  options: Record<string, any> = {},
) {
  if (options.notify === false) {
    return {
      attributeChanges: [],
      effectNotifications: [],
      vitalityNotification: null,
    };
  }

  const currentTimeMs = toFiniteNumber(nowMs, Date.now());
  const intervalDue =
    currentTimeMs - toFiniteNumber(state.lastNotifiedAtMs, currentTimeMs) >=
      CLIENT_NOTIFICATION_INTERVAL_MS;
  const force = options.forceNotify === true;
  const effectNotifications: any[] = [];
  for (const [key, effect] of Object.entries<any>(state.effects)) {
    if (
      force ||
      effect.active !== effect.lastNotifiedActive
    ) {
      effectNotifications.push({
        eventName: "OnStatusEffectActiveChanged",
        args: [key, effect.active],
      });
      effect.lastNotifiedActive = effect.active;
    }
    if (
      force ||
      effect.armed !== effect.lastNotifiedArmed
    ) {
      effectNotifications.push({
        eventName: "OnStatusEffectArmed",
        args: [key, effect.armed],
      });
      effect.lastNotifiedArmed = effect.armed;
    }
    if (
      force ||
      (
        intervalDue &&
        Math.abs(effect.grace - effect.lastNotifiedGrace) >=
          CLIENT_GRACE_NOTIFICATION_EPSILON
      )
    ) {
      effectNotifications.push({
        eventName: "OnStatusEffectGraceChanged",
        args: [key, effect.grace],
      });
      effect.lastNotifiedGrace = effect.grace;
    }
  }

  const vitalityDamage = Math.round(
    clamp(state.vitalityCapacity - state.vitality, 0, state.vitalityCapacity),
  );
  const vitalityNotification =
    force ||
    vitalityDamage !== state.lastNotifiedVitalityDamage
      ? {
          eventName: "OnMedicalTraitShellPointsChanged",
          args: [
            vitalityDamage,
            Math.round(state.vitalityCapacity),
            buildList([]),
          ],
        }
      : null;
  if (vitalityNotification) {
    state.lastNotifiedVitalityDamage = vitalityDamage;
  }

  const currentAttributes = {
    [ATTRIBUTE_FERALIZATION]: state.feralization,
    [ATTRIBUTE_EXTERNAL_FERALIZATION]: toFiniteNumber(
      getAttributeValue(entity, ATTRIBUTE_EXTERNAL_FERALIZATION, 0),
      0,
    ),
    [ATTRIBUTE_TEMPORAL_DRIFT]: state.temporalDrift,
    [ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT]: toFiniteNumber(
      getAttributeValue(entity, ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT, 0),
      0,
    ),
  };
  const attributeChanges: any[] = [];
  if (force || intervalDue) {
    for (const [rawAttributeID, rawValue] of Object.entries(currentAttributes)) {
      const attributeID = Number(rawAttributeID);
      const value = round6(rawValue);
      const previousValue = round6(
        state.lastNotifiedAttributes[attributeID] ?? value,
      );
      if (
        force ||
        Math.abs(value - previousValue) >= CLIENT_ATTRIBUTE_NOTIFICATION_EPSILON
      ) {
        attributeChanges.push({ attributeID, previousValue, value });
        state.lastNotifiedAttributes[attributeID] = value;
      }
    }
  }

  if (
    force ||
    intervalDue ||
    effectNotifications.length > 0 ||
    vitalityNotification
  ) {
    state.lastNotifiedAtMs = currentTimeMs;
  }
  return {
    attributeChanges,
    effectNotifications,
    vitalityNotification,
  };
}

function advanceEntityEnvironmentalEffects(
  scene,
  entity,
  nowMs = Date.now(),
  options: Record<string, any> = {},
) {
  if (!entity || String(entity.kind || "").trim().toLowerCase() !== "ship") {
    return { supported: false, reason: "NOT_A_SHIP" };
  }
  const characterID = resolveCharacterID(entity);
  if (characterID <= 0) {
    return { supported: false, reason: "NO_CHARACTER" };
  }

  const currentTimeMs = toFiniteNumber(nowMs, Date.now());
  const state = ensureCharacterState(characterID, entity, currentTimeMs);
  const elapsedSeconds = Math.min(
    MAX_ADVANCE_SECONDS,
    Math.max(
      0,
      (currentTimeMs - toFiniteNumber(state.lastUpdatedAtMs, currentTimeMs)) /
        1000,
    ),
  );

  const feralizationCapacity = Math.max(
    0,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_FERALIZATION_CAPACITY,
      "feralizationCapacity",
      DEFAULT_ENVIRONMENTAL_CAPACITY,
    ),
  );
  const feralizationConductance = Math.max(
    0,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_FERALIZATION_CONDUCTANCE,
      "feralizationConductance",
      DEFAULT_ENVIRONMENTAL_CONDUCTANCE,
    ),
  );
  const externalFeralization = Math.max(
    0,
    getAttributeValue(entity, ATTRIBUTE_EXTERNAL_FERALIZATION, 0),
  );
  const continuousFeralization = getAttributeValue(
    entity,
    ATTRIBUTE_CONTINUOUS_FERALIZATION,
    0,
  );
  const nominalMaxFeralization = Math.max(
    1,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_NOMINAL_MAX_FERALIZATION,
      "nominalMaxFeralization",
      DEFAULT_NOMINAL_MAX,
    ),
  );
  state.feralization = round6(approachEnvironmentalValue(
    state.feralization,
    externalFeralization,
    continuousFeralization,
    feralizationCapacity,
    feralizationConductance,
    elapsedSeconds,
  ));

  const temporalization = resolveRiftTemporalization(scene, entity, options);
  const nominalMaxTemporalDrift = Math.max(
    1,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_NOMINAL_MAX_TEMPORAL_DRIFT,
      "nominalMaxTemporalDrift",
      DEFAULT_NOMINAL_MAX,
    ),
  );
  const externalTemporalDrift = round6(
    temporalization.intensity *
      nominalMaxTemporalDrift *
      Math.max(
        1,
        toFiniteNumber(
          options.riftTemporalDriftMultiplier,
          RIFT_TEMPORAL_DRIFT_MULTIPLIER,
        ),
      ),
  );
  const temporalDriftCapacity = Math.max(
    0,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_TEMPORAL_DRIFT_CAPACITY,
      "temporalDriftCapacity",
      DEFAULT_ENVIRONMENTAL_CAPACITY,
    ),
  );
  const temporalDriftConductance = Math.max(
    0,
    getEntityOrTypeAttributeValue(
      entity,
      ATTRIBUTE_TEMPORAL_DRIFT_CONDUCTANCE,
      "temporalDriftConductance",
      DEFAULT_ENVIRONMENTAL_CONDUCTANCE,
    ),
  );
  const continuousTemporalDrift = getAttributeValue(
    entity,
    ATTRIBUTE_CONTINUOUS_TEMPORAL_DRIFT,
    0,
  );
  state.temporalDrift = round6(approachEnvironmentalValue(
    state.temporalDrift,
    externalTemporalDrift,
    continuousTemporalDrift,
    temporalDriftCapacity,
    temporalDriftConductance,
    elapsedSeconds,
  ));

  setAttributeValue(entity, ATTRIBUTE_FERALIZATION, state.feralization);
  setAttributeValue(entity, ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT, externalTemporalDrift);
  setAttributeValue(entity, ATTRIBUTE_TEMPORAL_DRIFT, state.temporalDrift);

  const heat = resolveHeatGrace(entity, currentTimeMs);
  updateEffectState(
    state.effects[STATUS_EFFECT_KEYS.HEAT],
    heat.grace,
    heat.temperature >= OVERHEATED_TEMPERATURE_K,
  );
  updateEffectState(
    state.effects[STATUS_EFFECT_KEYS.FERALIZATION],
    state.feralization / nominalMaxFeralization,
    state.feralization > 0 || externalFeralization > 0 || continuousFeralization > 0,
  );
  updateEffectState(
    state.effects[STATUS_EFFECT_KEYS.TEMPORAL_DRIFT],
    state.temporalDrift / nominalMaxTemporalDrift,
    temporalization.intensity > 0 || state.temporalDrift > 0,
  );

  const activeEffectCount = Object.values<any>(state.effects)
    .filter((effect) => effect.active === true)
    .length;
  const vitalityDrainRate = Math.max(
    0,
    toFiniteNumber(
      options.vitalityDrainPerEffectPerSecond,
      DEFAULT_VITALITY_DRAIN_PER_EFFECT_PER_SECOND,
    ),
  );
  if (activeEffectCount > 0 && elapsedSeconds > 0 && state.vitality > 0) {
    state.vitality = round6(Math.max(
      0,
      state.vitality -
        (activeEffectCount * vitalityDrainRate * elapsedSeconds),
    ));
  }
  state.lastUpdatedAtMs = currentTimeMs;

  const notifications = collectClientNotifications(
    state,
    entity,
    currentTimeMs,
    options,
  );
  return {
    supported: true,
    activeEffectCount,
    characterID,
    externalTemporalDrift,
    feralization: state.feralization,
    heatGrace: round6(heat.grace),
    temperature: round6(heat.temperature),
    temporalDrift: state.temporalDrift,
    temporalization,
    vitality: state.vitality,
    vitalityCapacity: state.vitalityCapacity,
    vitalityDamage: round6(state.vitalityCapacity - state.vitality),
    ...notifications,
  };
}

function applyNpcFeralization(
  targetEntity,
  sourceEntity,
  applicationKind,
  nowMs = Date.now(),
  options: Record<string, any> = {},
) {
  const normalizedKind = String(applicationKind || "").trim().toLowerCase();
  const attributeID = normalizedKind === "scan"
    ? ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN
    : normalizedKind === "hit"
      ? ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT
      : 0;
  const attributeName = normalizedKind === "scan"
    ? "feralizationAmountPerScan"
    : normalizedKind === "hit"
      ? "feralizationAmountPerHit"
      : "";
  if (
    attributeID <= 0 ||
    !sourceEntity ||
    sourceEntity.nativeNpc !== true ||
    !targetEntity ||
    String(targetEntity.kind || "").trim().toLowerCase() !== "ship"
  ) {
    return { supported: false, applied: false, amount: 0 };
  }
  if (
    normalizedKind === "hit" &&
    options.appliedDamage !== undefined &&
    toFiniteNumber(options.appliedDamage, 0) <= 0
  ) {
    return { supported: true, applied: false, amount: 0 };
  }

  const characterID = resolveCharacterID(targetEntity);
  if (characterID <= 0) {
    return { supported: false, applied: false, amount: 0 };
  }
  const amount = Math.max(
    0,
    getEntityOrTypeAttributeValue(
      sourceEntity,
      attributeID,
      attributeName,
      0,
    ),
  );
  if (amount <= 0) {
    return { supported: true, applied: false, amount: 0 };
  }

  const currentTimeMs = toFiniteNumber(nowMs, Date.now());
  const state = ensureCharacterState(characterID, targetEntity, currentTimeMs);
  state.feralization = round6(Math.max(0, state.feralization + amount));
  setAttributeValue(targetEntity, ATTRIBUTE_FERALIZATION, state.feralization);
  const nominalMax = Math.max(
    1,
    getEntityOrTypeAttributeValue(
      targetEntity,
      ATTRIBUTE_NOMINAL_MAX_FERALIZATION,
      "nominalMaxFeralization",
      DEFAULT_NOMINAL_MAX,
    ),
  );
  updateEffectState(
    state.effects[STATUS_EFFECT_KEYS.FERALIZATION],
    state.feralization / nominalMax,
    true,
  );
  const notifications = collectClientNotifications(
    state,
    targetEntity,
    currentTimeMs,
    {
      ...options,
      forceNotify: true,
    },
  );
  return {
    supported: true,
    applied: true,
    amount: round6(amount),
    applicationKind: normalizedKind,
    characterID,
    feralization: state.feralization,
    vitality: state.vitality,
    ...notifications,
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
    const result = advanceEntityEnvironmentalEffects(
      scene,
      entity,
      nowMs,
      options,
    );
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

function deliverClientNotifications(session, result) {
  if (
    !session ||
    typeof session.sendNotification !== "function" ||
    !result ||
    result.supported !== true
  ) {
    return false;
  }
  for (const notification of result.effectNotifications || []) {
    session.sendNotification(
      notification.eventName,
      "charid",
      notification.args,
    );
  }
  if (result.vitalityNotification) {
    session.sendNotification(
      result.vitalityNotification.eventName,
      "charid",
      result.vitalityNotification.args,
    );
  }
  return Boolean(
    (result.effectNotifications && result.effectNotifications.length > 0) ||
    result.vitalityNotification
  );
}

function resetCharacterState(characterID = null) {
  const numericCharacterID = toPositiveInt(characterID, 0);
  if (numericCharacterID > 0) {
    return characterStates.delete(numericCharacterID);
  }
  characterStates.clear();
  return true;
}

function buildServiceState(characterID) {
  const snapshot = snapshotCharacterState(characterID, { create: false });
  if (!snapshot) {
    return buildDict([]);
  }
  return buildDict([
    ["vitality", snapshot.vitality],
    ["vitality_capacity", snapshot.vitalityCapacity],
    ["vitality_damage", snapshot.vitalityDamage],
    ["feralization", snapshot.feralization],
    ["temporal_drift", snapshot.temporalDrift],
    ["effects", buildDict(
      Object.entries<any>(snapshot.effects).map(([key, effect]) => [
        key,
        buildDict([
          ["grace", effect.grace],
          ["is_active", effect.active],
          ["is_armed", effect.armed],
        ]),
      ]),
    )],
  ]);
}

class EnvironmentalEffectsService extends BaseService {
  constructor() {
    super("environmentalEffects");
  }

  Handle_get_state(_args, session) {
    return buildServiceState(resolveCharacterID(session));
  }
}

module.exports = EnvironmentalEffectsService;
module.exports.ATTRIBUTE_CONTINUOUS_FERALIZATION = ATTRIBUTE_CONTINUOUS_FERALIZATION;
module.exports.ATTRIBUTE_CONTINUOUS_TEMPORAL_DRIFT = ATTRIBUTE_CONTINUOUS_TEMPORAL_DRIFT;
module.exports.ATTRIBUTE_EXTERNAL_FERALIZATION = ATTRIBUTE_EXTERNAL_FERALIZATION;
module.exports.ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT = ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT;
module.exports.ATTRIBUTE_FERALIZATION = ATTRIBUTE_FERALIZATION;
module.exports.ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT = ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT;
module.exports.ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN = ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN;
module.exports.ATTRIBUTE_FERALIZATION_CAPACITY = ATTRIBUTE_FERALIZATION_CAPACITY;
module.exports.ATTRIBUTE_FERALIZATION_CONDUCTANCE = ATTRIBUTE_FERALIZATION_CONDUCTANCE;
module.exports.ATTRIBUTE_NOMINAL_MAX_FERALIZATION = ATTRIBUTE_NOMINAL_MAX_FERALIZATION;
module.exports.ATTRIBUTE_NOMINAL_MAX_TEMPORAL_DRIFT = ATTRIBUTE_NOMINAL_MAX_TEMPORAL_DRIFT;
module.exports.ATTRIBUTE_TEMPORAL_DRIFT = ATTRIBUTE_TEMPORAL_DRIFT;
module.exports.ATTRIBUTE_TEMPORAL_DRIFT_CAPACITY = ATTRIBUTE_TEMPORAL_DRIFT_CAPACITY;
module.exports.ATTRIBUTE_TEMPORAL_DRIFT_CONDUCTANCE = ATTRIBUTE_TEMPORAL_DRIFT_CONDUCTANCE;
module.exports.CLIENT_NOTIFICATION_INTERVAL_MS = CLIENT_NOTIFICATION_INTERVAL_MS;
module.exports.CRITICAL_TEMPERATURE_K = CRITICAL_TEMPERATURE_K;
module.exports.DEFAULT_SHELL_VITALITY = DEFAULT_SHELL_VITALITY;
module.exports.DEFAULT_VITALITY_DRAIN_PER_EFFECT_PER_SECOND =
  DEFAULT_VITALITY_DRAIN_PER_EFFECT_PER_SECOND;
module.exports.OVERHEATED_TEMPERATURE_K = OVERHEATED_TEMPERATURE_K;
module.exports.RIFT_TEMPORALIZATION_RADIUS_METERS = RIFT_TEMPORALIZATION_RADIUS_METERS;
module.exports.STATUS_EFFECT_KEYS = STATUS_EFFECT_KEYS;
module.exports.advanceEntityEnvironmentalEffects = advanceEntityEnvironmentalEffects;
module.exports.approachEnvironmentalValue = approachEnvironmentalValue;
module.exports.applyNpcFeralization = applyNpcFeralization;
module.exports.buildServiceState = buildServiceState;
module.exports.deliverClientNotifications = deliverClientNotifications;
module.exports.normalizeStatusEffectKey = normalizeStatusEffectKey;
module.exports.resetCharacterState = resetCharacterState;
module.exports.resolveCharacterID = resolveCharacterID;
module.exports.resolveHeatGrace = resolveHeatGrace;
module.exports.resolveRiftTemporalization = resolveRiftTemporalization;
module.exports.snapshotCharacterState = snapshotCharacterState;
module.exports.tickScene = tickScene;
