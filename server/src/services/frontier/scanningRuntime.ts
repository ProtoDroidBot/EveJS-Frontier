"use strict";

/**
 * Frontier directional scanner runtime (fitted Creation scanners and classic
 * ships' built-in sensors).
 *
 * Client contract (build 3467658 bytecode; the Creation path is unchanged
 * from 3455996):
 * - `creation.activate_ability(ship, module, "directional_scan",
 *   scan_angle=<degrees>, scan_direction=<vec3>)`; the adapter converts its
 *   internal radians with math.degrees() before sending. The result dict is
 *   read as `result.get("scan_response")` and the response is then accessed
 *   by ATTRIBUTE (response.added / .removed / .updated_scans / .resolved /
 *   .origin / .duration), so the payload must be an attribute-style object
 *   (util.KeyVal), not a plain dict.
 * - `resolved` maps ball_id -> filetime DELTA (the client applies
 *   datetimeutils.filetime_delta_to_timedelta). `duration` is returned as an
 *   actual datetime.timedelta because the client passes it directly into
 *   ScanPulsePhase and performs datetime arithmetic with it.
 * - `added`/`removed` are dict[int, tuple|None] keyed by ball id.
 * - `updated_scans` entries are CombinedScanResult states:
 *   (center, radius, scan_id, distance_range, estimated_number,
 *    estimated_number_uncertainty, signature_results), where each
 *   signature_result state is (signature_type, signature, noise_level).
 *
 * Client-authored constants and math reused verbatim (no invented formulas):
 * - SCAN_ANGLE_MIN 2.5°, SCAN_ANGLE_MAX 45°, SCAN_ANGLE_DEFAULT 15°.
 * - ScanTimeCalculator.MAXIMUM_SCAN_DISTANCE = 1e8 m (100,000 km).
 * - calculate_snr(signature, noise) = signature / noise, or 100 when noise
 *   is zero.
 * - Scan duration comes from the module's authored activeScanDuration
 *   attribute (6179 = 6000 ms for type 95322).
 * - Per-signature-type strength multipliers come from the module's authored
 *   ActiveScanGravStrengthMulti / ActiveScanEMStrengthMulti /
 *   ActiveScanThermalStrengthMulti attributes (6265/6266/6267).
 * - Non-modular ships use their built-in radar, ladar, magnetometric, and
 *   gravimetric sensor strengths. When a hull authors more than one positive
 *   sensor type, those strengths are averaged.
 *
 * Documented emulator approximation (NOT client-recoverable): the client
 * ships the reveal/where-it-lands math but the server-side signature model
 * (how a ball's baseSignature becomes per-type signature strength and noise)
 * is not in the client package. We therefore use a deterministic model:
 *   signature = baseSignature * (typeMultiplier / 1000)
 *   noise     = distance / MAXIMUM_SCAN_DISTANCE
 * and resolve a contact (a 1-signature CombinedScanResult reported through
 * `resolved`) when snr >= RESOLVE_SNR_THRESHOLD. This is isolated in
 * buildSignatureResultsForTarget/isResolved so it can be replaced wholesale
 * when better evidence appears, and it is covered by deterministic tests.
 */

const path = require("path");

const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  getEntityMapKey,
} = require(path.join(__dirname, "../../space/destiny/identity/entityID"));
const { readStaticRows, TABLE } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));

const SCAN_ANGLE_MIN_DEGREES = 2.5;
const SCAN_ANGLE_MAX_DEGREES = 45.0;
const SCAN_ANGLE_DEFAULT_DEGREES = 15.0;
const MAXIMUM_SCAN_DISTANCE_METERS = 100000000.0;
const DEFAULT_ACTIVE_SCAN_DURATION_MS = 6000;
const RESOLVE_SNR_THRESHOLD = 1.0;
const SIGNATURE_TYPE_GRAVIMETRIC = 1;
const SIGNATURE_TYPE_ELECTROMAGNETIC = 2;
const SIGNATURE_TYPE_THERMAL = 3;
const BUILT_IN_SENSOR_STRENGTH_ATTRIBUTES = Object.freeze([
  [208, "scanRadarStrength"],
  [209, "scanLadarStrength"],
  [210, "scanMagnetometricStrength"],
  [211, "scanGravimetricStrength"],
]);
// Hull sensor strength and active-scanner strength multipliers are authored in
// different scales. A 20-point built-in sensor maps to the fitted scanner's
// baseline 500 multiplier while retaining relative differences between hulls.
const BUILT_IN_SENSOR_TO_SCAN_MULTIPLIER = 25;
const MODULE_ACTIVITY_EM_BONUS = 0.5;
const WEAPON_ACTIVITY_EM_BONUS = 1.0;
const ACTIVE_MODULE_EM_BONUS = 0.25;
const MODULE_ACTIVITY_EM_DECAY_MS = 10000;
const WEAPON_ACTIVITY_EM_DECAY_MS = 15000;
const BEYOND_LINE_OF_SIGHT_SIGNATURE_TYPES = new Set([
  SIGNATURE_TYPE_GRAVIMETRIC,
  SIGNATURE_TYPE_ELECTROMAGNETIC,
]);
const RESOLVED_SCANNING_CONTACTS_KEY =
  "frontierResolvedScanningContactsByID";
const SIGNATURE_TYPE_MULTIPLIER_ATTRIBUTES = Object.freeze([
  [SIGNATURE_TYPE_GRAVIMETRIC, "ActiveScanGravStrengthMulti"],
  [SIGNATURE_TYPE_ELECTROMAGNETIC, "ActiveScanEMStrengthMulti"],
  [SIGNATURE_TYPE_THERMAL, "ActiveScanThermalStrengthMulti"],
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeVector(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: toFiniteNumber(value[0], 0),
      y: toFiniteNumber(value[1], 0),
      z: toFiniteNumber(value[2], 0),
    };
  }
  if (value && typeof value === "object") {
    return {
      x: toFiniteNumber(value.x, 0),
      y: toFiniteNumber(value.y, 0),
      z: toFiniteNumber(value.z, 0),
    };
  }
  return null;
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function unitVector(vector) {
  const length = magnitude(vector);
  if (!(length > 0)) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

/**
 * Validate scan_angle (degrees, clamped to the client's authored bounds) and
 * scan_direction (any non-zero vector; normalized here).
 */
function normalizeScanRequest(kwargs) {
  const rawAngle = kwargs && kwargs.scan_angle;
  const angleDegrees = rawAngle === undefined || rawAngle === null
    ? SCAN_ANGLE_DEFAULT_DEGREES
    : toFiniteNumber(rawAngle, NaN);
  if (!Number.isFinite(angleDegrees)) {
    return { errorMsg: "SCAN_ANGLE_INVALID" };
  }
  if (
    angleDegrees < SCAN_ANGLE_MIN_DEGREES - 1e-6 ||
    angleDegrees > SCAN_ANGLE_MAX_DEGREES + 1e-6
  ) {
    return { errorMsg: "SCAN_ANGLE_OUT_OF_RANGE" };
  }
  const direction = normalizeVector(kwargs && kwargs.scan_direction);
  const unitDirection = direction ? unitVector(direction) : null;
  if (!unitDirection) {
    return { errorMsg: "SCAN_DIRECTION_INVALID" };
  }
  return { angleDegrees, direction: unitDirection };
}

function resolveScanDurationMs(moduleTypeID) {
  const duration = toFiniteNumber(
    getTypeAttributeValue(toInt(moduleTypeID, 0), "activeScanDuration"),
    0,
  );
  return duration > 0 ? duration : DEFAULT_ACTIVE_SCAN_DURATION_MS;
}

function resolveSignatureMultipliers(moduleTypeID) {
  const multipliers: any[] = [];
  for (const [signatureType, attributeName] of SIGNATURE_TYPE_MULTIPLIER_ATTRIBUTES) {
    const value = toFiniteNumber(
      getTypeAttributeValue(toInt(moduleTypeID, 0), attributeName),
      0,
    );
    if (value > 0) {
      multipliers.push([signatureType, value]);
    }
  }
  return multipliers;
}

function readEntityAttribute(entity, attributeID, attributeName) {
  const attributes = entity && entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes &&
    typeof entity.passiveDerivedState.attributes === "object"
      ? entity.passiveDerivedState.attributes
      : null;
  const derived = attributes
    ? toFiniteNumber(attributes[String(attributeID)], 0)
    : 0;
  if (derived > 0) {
    return derived;
  }
  return toFiniteNumber(
    getTypeAttributeValue(toInt(entity && entity.typeID, 0), attributeName),
    0,
  );
}

/**
 * Resolve the scanner profile for a classic/non-modular hull. Positive sensor
 * types are averaged exactly once each; zero or absent types do not dilute a
 * multi-sensor hull. entity.sensorStrength remains a compatibility fallback
 * for runtime-authored NPCs which have no per-type attributes.
 */
function resolveBuiltInScannerProfile(entity) {
  const sensorStrengths = BUILT_IN_SENSOR_STRENGTH_ATTRIBUTES
    .map(([attributeID, attributeName]) =>
      readEntityAttribute(entity, attributeID, attributeName))
    .filter((value) => value > 0);
  const explicitFallback = toFiniteNumber(entity && entity.sensorStrength, 0);
  const sensorStrength = sensorStrengths.length > 0
    ? sensorStrengths.reduce((total, value) => total + value, 0) /
      sensorStrengths.length
    : explicitFallback;
  const multiplier = Math.max(
    0,
    sensorStrength * BUILT_IN_SENSOR_TO_SCAN_MULTIPLIER,
  );
  const durationMs = readEntityAttribute(
    entity,
    6179,
    "activeScanDuration",
  ) || DEFAULT_ACTIVE_SCAN_DURATION_MS;
  return {
    source: "built-in",
    sensorStrength,
    sensorStrengths,
    durationMs,
    multipliers: multiplier > 0
      ? [
          [SIGNATURE_TYPE_GRAVIMETRIC, multiplier],
          [SIGNATURE_TYPE_ELECTROMAGNETIC, multiplier],
          [SIGNATURE_TYPE_THERMAL, multiplier],
        ]
      : [],
  };
}

function resolveDirectionalScannerProfile(moduleTypeID, scannerProfile = null) {
  if (scannerProfile && typeof scannerProfile === "object") {
    const multipliers = Array.isArray(scannerProfile.multipliers)
      ? scannerProfile.multipliers
          .map((entry) => ([
            toInt(entry && entry[0], 0),
            toFiniteNumber(entry && entry[1], 0),
          ]))
          .filter(([signatureType, multiplier]) =>
            signatureType > 0 && multiplier > 0)
      : [];
    return {
      durationMs: Math.max(
        0,
        toFiniteNumber(
          scannerProfile.durationMs,
          DEFAULT_ACTIVE_SCAN_DURATION_MS,
        ),
      ),
      multipliers,
    };
  }
  return {
    durationMs: resolveScanDurationMs(moduleTypeID),
    multipliers: resolveSignatureMultipliers(moduleTypeID),
  };
}

function recordEntityScannerEmissionActivity(
  entity,
  options: Record<string, any> = {},
) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const current = entity.scannerEmissionState &&
    typeof entity.scannerEmissionState === "object"
      ? entity.scannerEmissionState
      : {};
  const next = {
    lastModuleActivityAtMs: Math.max(
      toFiniteNumber(current.lastModuleActivityAtMs, 0),
      nowMs,
    ),
    lastWeaponActivityAtMs: toFiniteNumber(
      current.lastWeaponActivityAtMs,
      0,
    ),
  };
  if (options.isWeapon === true) {
    next.lastWeaponActivityAtMs = Math.max(
      next.lastWeaponActivityAtMs,
      nowMs,
    );
  }
  entity.scannerEmissionState = next;
  return next;
}

function resolveDecayingActivityBonus(nowMs, activityAtMs, durationMs, bonus) {
  const ageMs = Math.max(0, nowMs - toFiniteNumber(activityAtMs, 0));
  if (!(activityAtMs > 0) || ageMs >= durationMs) {
    return 0;
  }
  return bonus * (1 - (ageMs / durationMs));
}

/**
 * Return the target-side EM signature multiplier. Active effects contribute
 * continuously; after the last action, the residual module/weapon emission
 * decays linearly back to the authored base signature.
 */
function resolveEntityEmSignatureMultiplier(entity, nowMs = Date.now()) {
  const currentTimeMs = toFiniteNumber(nowMs, Date.now());
  const activeModuleCount = entity && entity.activeModuleEffects instanceof Map
    ? entity.activeModuleEffects.size
    : 0;
  const state = entity && entity.scannerEmissionState &&
    typeof entity.scannerEmissionState === "object"
      ? entity.scannerEmissionState
      : {};
  const modulePulse = resolveDecayingActivityBonus(
    currentTimeMs,
    toFiniteNumber(state.lastModuleActivityAtMs, 0),
    MODULE_ACTIVITY_EM_DECAY_MS,
    MODULE_ACTIVITY_EM_BONUS,
  );
  const weaponPulse = resolveDecayingActivityBonus(
    currentTimeMs,
    toFiniteNumber(state.lastWeaponActivityAtMs, 0),
    WEAPON_ACTIVITY_EM_DECAY_MS,
    WEAPON_ACTIVITY_EM_BONUS,
  );
  return 1 +
    (Math.max(0, activeModuleCount) * ACTIVE_MODULE_EM_BONUS) +
    Math.max(modulePulse, weaponPulse);
}

// baseSignature is authored per type in spaceComponentsByType
// ({"baseSignature": {"baseSignature": <float>}}), covering ~7,275 types.
let baseSignaturesByTypeID = null;

function getBaseSignatureIndex() {
  if (!baseSignaturesByTypeID) {
    baseSignaturesByTypeID = new Map();
    for (const row of readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE)) {
      const typeID = toInt(row && (row._key ?? row.typeID), 0);
      const component = row && row.baseSignature;
      const value = toFiniteNumber(component && component.baseSignature, 0);
      if (typeID > 0 && value > 0) {
        baseSignaturesByTypeID.set(typeID, value);
      }
    }
  }
  return baseSignaturesByTypeID;
}

function resolveBaseSignature(typeID) {
  return getBaseSignatureIndex().get(toInt(typeID, 0)) || 0;
}

function resetScanningStaticDataForTests() {
  baseSignaturesByTypeID = null;
}

// Client-authored: calculate_snr(signature, noise).
function calculateSnr(signature, noise) {
  return noise > 0 ? signature / noise : 100;
}

/**
 * Emulator signature model — see the module header. Returns the
 * per-signature-type [signatureType, signature, noiseLevel] triples the
 * client's SignatureResult.__set_state__ consumes.
 */
function buildSignatureResultsForTarget({
  baseSignature,
  distanceMeters,
  multipliers,
  emSignatureMultiplier = 1,
}: Record<string, any>) {
  const noise = Math.max(
    0,
    distanceMeters / MAXIMUM_SCAN_DISTANCE_METERS,
  );
  return multipliers.map(([signatureType, multiplier]) => ([
    signatureType,
    baseSignature * (multiplier / 1000) * (
      toInt(signatureType, 0) === SIGNATURE_TYPE_ELECTROMAGNETIC
        ? Math.max(1, toFiniteNumber(emSignatureMultiplier, 1))
        : 1
    ),
    noise,
  ]));
}

function isResolved(signatureResults) {
  return signatureResults.some(([, signature, noise]) =>
    calculateSnr(signature, noise) >= RESOLVE_SNR_THRESHOLD);
}

function getPresentedSignatureResults(signatureResults, hasLineOfSight = true) {
  const entries = Array.isArray(signatureResults) ? signatureResults : [];
  if (hasLineOfSight !== false) {
    return entries;
  }
  return entries.filter(([signatureType]) =>
    BEYOND_LINE_OF_SIGHT_SIGNATURE_TYPES.has(toInt(signatureType, 0)));
}

function getResolvedScanningContactMap(session, create = false) {
  const generation = session && session._space;
  if (!generation || typeof generation !== "object") {
    return null;
  }
  if (generation[RESOLVED_SCANNING_CONTACTS_KEY] instanceof Map) {
    return generation[RESOLVED_SCANNING_CONTACTS_KEY];
  }
  if (!create) {
    return null;
  }
  const contacts = new Map();
  generation[RESOLVED_SCANNING_CONTACTS_KEY] = contacts;
  return contacts;
}

function isScanningContactResolved(session, rawEntityID, nowMs = Date.now()) {
  const entityID = getEntityMapKey(rawEntityID);
  const contacts = getResolvedScanningContactMap(session, false);
  if (entityID === null || !(contacts instanceof Map)) {
    return false;
  }
  const contact = contacts.get(entityID);
  return Boolean(
    contact &&
      toFiniteNumber(contact.resolveAtMs, Number.POSITIVE_INFINITY) <=
        toFiniteNumber(nowMs, Date.now()),
  );
}

/**
 * Replace the contacts resolved by the latest directional scan.
 *
 * A repeated scan preserves an existing contact's original resolve deadline,
 * so continuously scanning the same signal cannot postpone (or re-hide) a
 * contact forever. State lives on the exact session `_space` generation;
 * docking or jumping therefore drops it with that client's presentation.
 */
function replaceResolvedScanningContacts(
  session,
  rawEntityIDs,
  options: Record<string, any> = {},
) {
  const generation = session && session._space;
  if (!generation || typeof generation !== "object") {
    return {
      activeIDs: new Set<any>(),
      delayMsByEntityID: new Map<any, any>(),
      removedIDs: [],
    };
  }

  const nowMs = toFiniteNumber(options.nowMs, Date.now());
  const delayMs = Math.max(0, toFiniteNumber(options.delayMs, 0));
  const previous = getResolvedScanningContactMap(session, false);
  const next = new Map<any, any>();
  const delayMsByEntityID = new Map<any, any>();

  for (const rawEntityID of Array.isArray(rawEntityIDs) ? rawEntityIDs : []) {
    const entityID = getEntityMapKey(rawEntityID);
    if (entityID === null || next.has(entityID)) {
      continue;
    }
    const previousContact = previous instanceof Map
      ? previous.get(entityID)
      : null;
    const resolveAtMs = previousContact &&
      Number.isFinite(Number(previousContact.resolveAtMs))
      ? Number(previousContact.resolveAtMs)
      : nowMs + delayMs;
    next.set(entityID, {
      entityID,
      detectedAtMs: previousContact &&
        Number.isFinite(Number(previousContact.detectedAtMs))
        ? Number(previousContact.detectedAtMs)
        : nowMs,
      resolveAtMs,
      lastScannedAtMs: nowMs,
    });
    delayMsByEntityID.set(entityID, Math.max(0, resolveAtMs - nowMs));
  }

  const removedIDs = previous instanceof Map
    ? [...previous.keys()].filter((entityID) => !next.has(entityID))
    : [];
  if (next.size > 0) {
    generation[RESOLVED_SCANNING_CONTACTS_KEY] = next;
  } else {
    delete generation[RESOLVED_SCANNING_CONTACTS_KEY];
  }

  return {
    activeIDs: new Set(next.keys()),
    delayMsByEntityID,
    removedIDs,
  };
}

/**
 * Deterministic, stable scan id for a contact: the ball id. The client keys
 * its signature repository and delta bookkeeping on scan_id, so reusing the
 * ball id keeps ids stable across repeated scans of the same target.
 */
function buildScanId(ballID) {
  return toInt(ballID, 0);
}

/**
 * Run a directional scan over candidate entities.
 *
 * `candidates` are {itemID, typeID, position:{x,y,z}} in the scanning ship's
 * solar system (the caller supplies live ballpark entities). Returns the
 * data the service layer marshals into the client's response shape.
 */
function performDirectionalScan({
  originPosition,
  angleDegrees,
  direction,
  moduleTypeID,
  scannerProfile = null,
  candidates,
  previousScanIds = [],
}: Record<string, any>) {
  const origin = normalizeVector(originPosition) || { x: 0, y: 0, z: 0 };
  const halfAngleRadians = (angleDegrees * Math.PI) / 180;
  const cosineThreshold = Math.cos(halfAngleRadians);
  const resolvedScannerProfile = resolveDirectionalScannerProfile(
    moduleTypeID,
    scannerProfile,
  );
  const multipliers = resolvedScannerProfile.multipliers;
  const durationMs = resolvedScannerProfile.durationMs;

  const combinedResults: any[] = [];
  const resolvedIds: any[] = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const position = normalizeVector(candidate && candidate.position);
    if (!position) {
      continue;
    }
    const offset = {
      x: position.x - origin.x,
      y: position.y - origin.y,
      z: position.z - origin.z,
    };
    const distanceMeters = magnitude(offset);
    if (distanceMeters <= 0 || distanceMeters > MAXIMUM_SCAN_DISTANCE_METERS) {
      continue;
    }
    const offsetDirection = unitVector(offset);
    if (!offsetDirection) {
      continue;
    }
    // Cone test: the scan angle is the half-angle from the boresight.
    if (dotProduct(offsetDirection, direction) < cosineThreshold) {
      continue;
    }
    const baseSignature = resolveBaseSignature(candidate.typeID);
    if (!(baseSignature > 0)) {
      continue;
    }
    const signatureResults = buildSignatureResultsForTarget({
      baseSignature,
      distanceMeters,
      multipliers,
      emSignatureMultiplier: candidate && candidate.emSignatureMultiplier,
    });
    const presentedSignatureResults = getPresentedSignatureResults(
      signatureResults,
      candidate && candidate.hasLineOfSight,
    );
    const scanId = buildScanId(candidate.itemID);
    combinedResults.push({
      center: [position.x, position.y, position.z],
      radius: distanceMeters * Math.sin(halfAngleRadians),
      scan_id: scanId,
      distance_range: [distanceMeters, distanceMeters],
      estimated_number: 1,
      estimated_number_uncertainty: 0,
      signature_results: presentedSignatureResults,
    });
    if (isResolved(presentedSignatureResults)) {
      resolvedIds.push(toInt(candidate.itemID, 0));
    }
  }

  const currentIds = combinedResults.map((result) => result.scan_id);
  const previous = new Set(
    (Array.isArray(previousScanIds) ? previousScanIds : []).map((value) =>
      toInt(value, 0)),
  );
  const added = currentIds.filter((scanId) => !previous.has(scanId));
  const removed = [...previous].filter((scanId) => !currentIds.includes(scanId));

  return {
    origin: [origin.x, origin.y, origin.z],
    durationMs,
    added,
    removed,
    updatedScans: combinedResults,
    resolvedIds,
    scanIds: currentIds,
  };
}

module.exports = {
  DEFAULT_ACTIVE_SCAN_DURATION_MS,
  MAXIMUM_SCAN_DISTANCE_METERS,
  RESOLVE_SNR_THRESHOLD,
  SCAN_ANGLE_DEFAULT_DEGREES,
  SCAN_ANGLE_MAX_DEGREES,
  SCAN_ANGLE_MIN_DEGREES,
  RESOLVED_SCANNING_CONTACTS_KEY,
  SIGNATURE_TYPE_ELECTROMAGNETIC,
  SIGNATURE_TYPE_GRAVIMETRIC,
  SIGNATURE_TYPE_THERMAL,
  ACTIVE_MODULE_EM_BONUS,
  BUILT_IN_SENSOR_STRENGTH_ATTRIBUTES,
  BUILT_IN_SENSOR_TO_SCAN_MULTIPLIER,
  MODULE_ACTIVITY_EM_BONUS,
  MODULE_ACTIVITY_EM_DECAY_MS,
  WEAPON_ACTIVITY_EM_BONUS,
  WEAPON_ACTIVITY_EM_DECAY_MS,
  buildScanId,
  buildSignatureResultsForTarget,
  calculateSnr,
  getPresentedSignatureResults,
  getResolvedScanningContactMap,
  isResolved,
  isScanningContactResolved,
  normalizeScanRequest,
  performDirectionalScan,
  recordEntityScannerEmissionActivity,
  replaceResolvedScanningContacts,
  resolveBuiltInScannerProfile,
  resolveBaseSignature,
  resolveScanDurationMs,
  resolveSignatureMultipliers,
  resolveEntityEmSignatureMultiplier,
  resetScanningStaticDataForTests,
};
