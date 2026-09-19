"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Frontier directional scanner runtime (fitted Creation scanners and classic
 * ships' built-in sensors).
 *
 * Client contract (build 3502403 bytecode):
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
 * - `added`/`removed` are dict[int, tuple|None] keyed by scan id.
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
 *   signature = baseSignature * (typeMultiplier / 1000) * targetMultiplier
 *   noise     = distance / MAXIMUM_SCAN_DISTANCE
 * Gravimetric target strength scales linearly from a neutral 1,000,000 kg
 * reference mass. EM target strength is increased by live module activity;
 * thermal target strength follows the authoritative hull temperature.
 * and resolve a contact (a 1-signature CombinedScanResult reported through
 * `resolved`) when snr >= RESOLVE_SNR_THRESHOLD. This is isolated in
 * buildSignatureResultsForTarget/isResolved so it can be replaced wholesale
 * when better evidence appears, and it is covered by deterministic tests.
 */
const path = require("path");
const { getTypeAttributeValue, } = require(path.join(__dirname, "../fitting/liveFittingState"));
const { getEntityMapKey, } = require(path.join(__dirname, "../../space/destiny/identity/entityID"));
const config = require(path.join(__dirname, "../../config"));
const { readStaticRows, TABLE } = require(path.join(__dirname, "../_shared/referenceData"));
const SCAN_ANGLE_MIN_DEGREES = 2.5;
const SCAN_ANGLE_MAX_DEGREES = 45.0;
const SCAN_ANGLE_DEFAULT_DEGREES = 15.0;
const MAXIMUM_SCAN_DISTANCE_METERS = 100000000.0;
const DEFAULT_ACTIVE_SCAN_DURATION_MS = 6000;
const RESOLVE_SNR_THRESHOLD = 1.0;
// Frontier common/signature.pyc (build 3502403) enum values. BASE is a
// generic signature; the active scanner emits the three physical types.
const SIGNATURE_TYPE_BASE = 1;
const SIGNATURE_TYPE_MASS = 2;
const SIGNATURE_TYPE_GRAVIMETRIC = SIGNATURE_TYPE_MASS;
const SIGNATURE_TYPE_ELECTROMAGNETIC = 3;
const SIGNATURE_TYPE_THERMAL = 4;
// Frontier common/scanning.pyc update-reason values. The numeric values are
// intentionally shared between the corresponding origin/fate variants.
const UPDATE_RESOLVED_TO_ITEM = 1;
const UPDATE_ADDED_FROM_ITEM = 1;
const UPDATE_RESOLVED_TO_SIGNATURES = 2;
const UPDATE_MERGED_FROM_SIGNATURES = 2;
const UPDATE_COMBINED_WITH_SIGNATURE = 3;
const UPDATE_RESOLVED_FROM_SIGNATURE = 3;
const SCAN_TIME_SHIFT_FRACTION = 0.025;
// A typical small hull and the runtime's default ship mass. Normalizing here
// keeps existing mass-less scan candidates neutral while allowing live mass
// changes and large structures to produce proportionally stronger gravity
// returns.
const GRAVIMETRIC_REFERENCE_MASS_KG = 1_000_000;
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
const RESOLVED_SCANNING_CONTACTS_KEY = "frontierResolvedScanningContactsByID";
const SIGNATURE_TYPE_MULTIPLIER_ATTRIBUTES = Object.freeze([
    [SIGNATURE_TYPE_GRAVIMETRIC, "ActiveScanGravStrengthMulti"],
    [SIGNATURE_TYPE_ELECTROMAGNETIC, "ActiveScanEMStrengthMulti"],
    [SIGNATURE_TYPE_THERMAL, "ActiveScanThermalStrengthMulti"],
]);
const UNRESOLVED_SNR_MARGIN = 1e-6;
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
    if (angleDegrees < SCAN_ANGLE_MIN_DEGREES - 1e-6 ||
        angleDegrees > SCAN_ANGLE_MAX_DEGREES + 1e-6) {
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
    const duration = toFiniteNumber(getTypeAttributeValue(toInt(moduleTypeID, 0), "activeScanDuration"), 0);
    return duration > 0 ? duration : DEFAULT_ACTIVE_SCAN_DURATION_MS;
}
function resolveSignatureMultipliers(moduleTypeID) {
    const multipliers = [];
    for (const [signatureType, attributeName] of SIGNATURE_TYPE_MULTIPLIER_ATTRIBUTES) {
        const value = toFiniteNumber(getTypeAttributeValue(toInt(moduleTypeID, 0), attributeName), 0);
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
    return toFiniteNumber(getTypeAttributeValue(toInt(entity && entity.typeID, 0), attributeName), 0);
}
/**
 * Resolve the scanner profile for a classic/non-modular hull. Positive sensor
 * types are averaged exactly once each; zero or absent types do not dilute a
 * multi-sensor hull. entity.sensorStrength remains a compatibility fallback
 * for runtime-authored NPCs which have no per-type attributes.
 */
function resolveBuiltInScannerProfile(entity) {
    const sensorStrengths = BUILT_IN_SENSOR_STRENGTH_ATTRIBUTES
        .map(([attributeID, attributeName]) => readEntityAttribute(entity, attributeID, attributeName))
        .filter((value) => value > 0);
    const explicitFallback = toFiniteNumber(entity && entity.sensorStrength, 0);
    const sensorStrength = sensorStrengths.length > 0
        ? sensorStrengths.reduce((total, value) => total + value, 0) /
            sensorStrengths.length
        : explicitFallback;
    const multiplier = Math.max(0, sensorStrength * BUILT_IN_SENSOR_TO_SCAN_MULTIPLIER);
    const durationMs = readEntityAttribute(entity, 6179, "activeScanDuration") || DEFAULT_ACTIVE_SCAN_DURATION_MS;
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
                .filter(([signatureType, multiplier]) => signatureType > 0 && multiplier > 0)
            : [];
        return {
            durationMs: Math.max(0, toFiniteNumber(scannerProfile.durationMs, DEFAULT_ACTIVE_SCAN_DURATION_MS)),
            multipliers,
        };
    }
    return {
        durationMs: resolveScanDurationMs(moduleTypeID),
        multipliers: resolveSignatureMultipliers(moduleTypeID),
    };
}
/**
 * Resolve the server-owned portion of Frontier directional scanning.
 *
 * The client hard-codes a 100,000 km scanner ceiling, so the configurable
 * detection range may narrow that window but never extends it. Resolution is
 * deliberately a second range: contacts between it and the detection range
 * remain CombinedScanResult signatures and are not promoted to ballpark
 * objects by Frontier's delayed resolution path.
 */
function resolveScanningConfig(overrides = {}) {
    const source = overrides && typeof overrides === "object" ? overrides : {};
    const detectionRangeMeters = Math.min(MAXIMUM_SCAN_DISTANCE_METERS, Math.max(1, toFiniteNumber(source.detectionRangeMeters, toFiniteNumber(config.frontierScanningDetectionRangeMeters, MAXIMUM_SCAN_DISTANCE_METERS))));
    const resolutionRangeMeters = Math.min(detectionRangeMeters, Math.max(1, toFiniteNumber(source.resolutionRangeMeters, toFiniteNumber(config.frontierScanningResolutionRangeMeters, detectionRangeMeters))));
    const resolutionSnrThreshold = Math.max(Number.EPSILON, toFiniteNumber(source.resolutionSnrThreshold, toFiniteNumber(config.frontierScanningResolutionSnrThreshold, RESOLVE_SNR_THRESHOLD)));
    return {
        detectionRangeMeters,
        resolutionRangeMeters,
        resolutionSnrThreshold,
        renderResolvedObjects: source.renderResolvedObjects == null
            ? config.frontierScanningRenderResolvedObjects !== false
            : source.renderResolvedObjects !== false,
        renderOutOfRangeSignatures: source.renderOutOfRangeSignatures == null
            ? config.frontierScanningRenderOutOfRangeSignatures !== false
            : source.renderOutOfRangeSignatures !== false,
    };
}
function recordEntityScannerEmissionActivity(entity, options = {}) {
    if (!entity || typeof entity !== "object") {
        return null;
    }
    const nowMs = toFiniteNumber(options.nowMs, Date.now());
    const current = entity.scannerEmissionState &&
        typeof entity.scannerEmissionState === "object"
        ? entity.scannerEmissionState
        : {};
    const next = {
        lastModuleActivityAtMs: Math.max(toFiniteNumber(current.lastModuleActivityAtMs, 0), nowMs),
        lastWeaponActivityAtMs: toFiniteNumber(current.lastWeaponActivityAtMs, 0),
    };
    if (options.isWeapon === true) {
        next.lastWeaponActivityAtMs = Math.max(next.lastWeaponActivityAtMs, nowMs);
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
    const modulePulse = resolveDecayingActivityBonus(currentTimeMs, toFiniteNumber(state.lastModuleActivityAtMs, 0), MODULE_ACTIVITY_EM_DECAY_MS, MODULE_ACTIVITY_EM_BONUS);
    const weaponPulse = resolveDecayingActivityBonus(currentTimeMs, toFiniteNumber(state.lastWeaponActivityAtMs, 0), WEAPON_ACTIVITY_EM_DECAY_MS, WEAPON_ACTIVITY_EM_BONUS);
    return 1 +
        (Math.max(0, activeModuleCount) * ACTIVE_MODULE_EM_BONUS) +
        Math.max(modulePulse, weaponPulse);
}
/**
 * Convert live target mass into its gravimetric signature multiplier.
 * Missing/invalid mass remains neutral for compatibility with synthetic scan
 * candidates, while every positive mass participates in the gravity result.
 */
function resolveGravimetricSignatureMultiplier(massKg) {
    const mass = toFiniteNumber(massKg, 0);
    return mass > 0 ? mass / GRAVIMETRIC_REFERENCE_MASS_KG : 1;
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
function buildSignatureResultsForTarget({ baseSignature, distanceMeters, multipliers, massKg = null, emSignatureMultiplier = 1, thermalSignatureMultiplier = 1, }) {
    const noise = Math.max(0, distanceMeters / MAXIMUM_SCAN_DISTANCE_METERS);
    const gravimetricSignatureMultiplier = resolveGravimetricSignatureMultiplier(massKg);
    return multipliers.map(([signatureType, multiplier]) => ([
        signatureType,
        baseSignature * (multiplier / 1000) * (toInt(signatureType, 0) === SIGNATURE_TYPE_GRAVIMETRIC
            ? gravimetricSignatureMultiplier
            : toInt(signatureType, 0) === SIGNATURE_TYPE_ELECTROMAGNETIC
                ? Math.max(1, toFiniteNumber(emSignatureMultiplier, 1))
                : toInt(signatureType, 0) === SIGNATURE_TYPE_THERMAL
                    ? Math.max(0, toFiniteNumber(thermalSignatureMultiplier, 1))
                    : 1),
        noise,
    ]));
}
function isResolved(signatureResults, threshold = RESOLVE_SNR_THRESHOLD) {
    const resolvedThreshold = Math.max(Number.EPSILON, toFiniteNumber(threshold, RESOLVE_SNR_THRESHOLD));
    return signatureResults.some(([, signature, noise]) => calculateSnr(signature, noise) >= resolvedThreshold);
}
/**
 * Frontier common/scanning.ScanTimeCalculator.distance_to_time, expressed in
 * milliseconds for the server. The same delay is used for the resolved map
 * sent to the reveal scheduler and for ballpark visibility materialization.
 */
function calculateScanRevealDelayMs(distanceMeters, totalScanTimeMs) {
    const durationMs = Math.max(0, toFiniteNumber(totalScanTimeMs, 0));
    if (!(durationMs > 0)) {
        return 0;
    }
    const distance = Math.max(0, toFiniteNumber(distanceMeters, 0));
    if (distance >= MAXIMUM_SCAN_DISTANCE_METERS) {
        return durationMs;
    }
    const totalScanTime = durationMs / 1000;
    const t0 = totalScanTime * SCAN_TIME_SHIFT_FRACTION;
    const v0 = (3 * MAXIMUM_SCAN_DISTANCE_METERS) / (Math.pow(totalScanTime + t0, 3) - Math.pow(t0, 3));
    const d0 = -(v0 / 3) * Math.pow(t0, 3);
    const revealTime = Math.cbrt((3 * (distance - d0)) / v0) - t0;
    return Math.min(durationMs, Math.max(0, revealTime * 1000));
}
/**
 * Preserve the real signature mix while ensuring the client presents a
 * signature rather than a resolved ball. This is required for contacts that
 * are detectable but outside the configured object-resolution range: merely
 * omitting them from `resolved` is not enough when their CombinedScanResult
 * already reports a 100%+ signal.
 */
function capSignatureResultsBelowResolutionThreshold(signatureResults, threshold = RESOLVE_SNR_THRESHOLD) {
    const resolvedThreshold = Math.max(Number.EPSILON, toFiniteNumber(threshold, RESOLVE_SNR_THRESHOLD));
    const maximumUnresolvedSnr = Math.max(0, resolvedThreshold - Math.max(UNRESOLVED_SNR_MARGIN, resolvedThreshold * UNRESOLVED_SNR_MARGIN));
    return (Array.isArray(signatureResults) ? signatureResults : []).map(([signatureType, signature, noise]) => {
        const numericNoise = Math.max(0, toFiniteNumber(noise, 0));
        const numericSignature = Math.max(0, toFiniteNumber(signature, 0));
        if (numericNoise > 0 &&
            calculateSnr(numericSignature, numericNoise) >= resolvedThreshold) {
            return [
                signatureType,
                numericNoise * maximumUnresolvedSnr,
                numericNoise,
            ];
        }
        return [signatureType, numericSignature, numericNoise];
    });
}
function getPresentedSignatureResults(signatureResults, hasLineOfSight = true) {
    const entries = Array.isArray(signatureResults) ? signatureResults : [];
    if (hasLineOfSight !== false) {
        return entries;
    }
    return entries.filter(([signatureType]) => BEYOND_LINE_OF_SIGHT_SIGNATURE_TYPES.has(toInt(signatureType, 0)));
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
    return Boolean(contact &&
        toFiniteNumber(contact.resolveAtMs, Number.POSITIVE_INFINITY) <=
            toFiniteNumber(nowMs, Date.now()));
}
function isCombatResolvedScanningContact(session, rawEntityID, nowMs = Date.now()) {
    const entityID = getEntityMapKey(rawEntityID);
    const contacts = getResolvedScanningContactMap(session, false);
    if (entityID === null || !(contacts instanceof Map)) {
        return false;
    }
    const contact = contacts.get(entityID);
    return Boolean(contact &&
        Number.isFinite(Number(contact.combatResolvedAtMs)) &&
        toFiniteNumber(contact.resolveAtMs, Number.POSITIVE_INFINITY) <=
            toFiniteNumber(nowMs, Date.now()));
}
/**
 * Immediately resolve one contact without replacing the contacts maintained by
 * the latest directional scan. Combat uses this when a hidden ship identifies
 * itself by attacking the observer.
 */
function forceResolveScanningContact(session, rawEntityID, options = {}) {
    const entityID = getEntityMapKey(rawEntityID);
    const contacts = getResolvedScanningContactMap(session, true);
    if (entityID === null || !(contacts instanceof Map)) {
        return null;
    }
    const nowMs = toFiniteNumber(options.nowMs, Date.now());
    const previous = contacts.get(entityID) || null;
    const contact = {
        entityID,
        detectedAtMs: previous && Number.isFinite(Number(previous.detectedAtMs))
            ? Number(previous.detectedAtMs)
            : nowMs,
        resolveAtMs: Math.min(nowMs, previous && Number.isFinite(Number(previous.resolveAtMs))
            ? Number(previous.resolveAtMs)
            : nowMs),
        lastScannedAtMs: previous && Number.isFinite(Number(previous.lastScannedAtMs))
            ? Number(previous.lastScannedAtMs)
            : nowMs,
        combatResolvedAtMs: nowMs,
    };
    contacts.set(entityID, contact);
    return contact;
}
function forgetResolvedScanningContact(session, rawEntityID) {
    const entityID = getEntityMapKey(rawEntityID);
    const contacts = getResolvedScanningContactMap(session, false);
    if (entityID === null || !(contacts instanceof Map)) {
        return false;
    }
    return contacts.delete(entityID);
}
/**
 * Replace the contacts resolved by the latest directional scan.
 *
 * A repeated scan preserves an existing contact's original resolve deadline,
 * so continuously scanning the same signal cannot postpone (or re-hide) a
 * contact forever. State lives on the exact session `_space` generation;
 * docking or jumping therefore drops it with that client's presentation.
 */
function replaceResolvedScanningContacts(session, rawEntityIDs, options = {}) {
    const generation = session && session._space;
    if (!generation || typeof generation !== "object") {
        return {
            activeIDs: new Set(),
            delayMsByEntityID: new Map(),
            removedIDs: [],
        };
    }
    const nowMs = toFiniteNumber(options.nowMs, Date.now());
    const delayMs = Math.max(0, toFiniteNumber(options.delayMs, 0));
    const configuredDelayMsByEntityID = options.delayMsByEntityID instanceof Map
        ? options.delayMsByEntityID
        : null;
    const previous = getResolvedScanningContactMap(session, false);
    const next = new Map();
    const delayMsByEntityID = new Map();
    for (const rawEntityID of Array.isArray(rawEntityIDs) ? rawEntityIDs : []) {
        const entityID = getEntityMapKey(rawEntityID);
        if (entityID === null || next.has(entityID)) {
            continue;
        }
        const previousContact = previous instanceof Map
            ? previous.get(entityID)
            : null;
        const configuredDelayMs = configuredDelayMsByEntityID &&
            configuredDelayMsByEntityID.has(entityID)
            ? Math.max(0, toFiniteNumber(configuredDelayMsByEntityID.get(entityID), delayMs))
            : delayMs;
        const resolveAtMs = previousContact &&
            Number.isFinite(Number(previousContact.resolveAtMs))
            ? Number(previousContact.resolveAtMs)
            : nowMs + configuredDelayMs;
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
    // A hostile source stays resolved after identifying itself. A later scan in
    // another direction must not turn that already-materialized attacker back
    // into an anonymous signature or evict its server-side resolution state.
    if (previous instanceof Map) {
        for (const [entityID, previousContact] of previous.entries()) {
            if (next.has(entityID) ||
                !previousContact ||
                !Number.isFinite(Number(previousContact.combatResolvedAtMs))) {
                continue;
            }
            next.set(entityID, previousContact);
            delayMsByEntityID.set(entityID, 0);
        }
    }
    const removedIDs = previous instanceof Map
        ? [...previous.keys()].filter((entityID) => !next.has(entityID))
        : [];
    if (next.size > 0) {
        generation[RESOLVED_SCANNING_CONTACTS_KEY] = next;
    }
    else {
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
function performDirectionalScan({ originPosition, angleDegrees, direction, moduleTypeID, scannerProfile = null, resolutionConfig = null, candidates, previousScanIds = [], }) {
    const origin = normalizeVector(originPosition) || { x: 0, y: 0, z: 0 };
    const halfAngleRadians = (angleDegrees * Math.PI) / 180;
    const cosineThreshold = Math.cos(halfAngleRadians);
    const resolvedScannerProfile = resolveDirectionalScannerProfile(moduleTypeID, scannerProfile);
    const multipliers = resolvedScannerProfile.multipliers;
    const durationMs = resolvedScannerProfile.durationMs;
    const resolvedScanningConfig = resolveScanningConfig(resolutionConfig);
    const combinedResults = [];
    const resolvedIds = [];
    const resolvedDelayMsById = new Map();
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
        if (distanceMeters <= 0 ||
            distanceMeters > resolvedScanningConfig.detectionRangeMeters) {
            continue;
        }
        const outsideResolutionRange = distanceMeters > resolvedScanningConfig.resolutionRangeMeters;
        const forceCombatResolved = candidate && candidate.forceCombatResolved === true;
        if (outsideResolutionRange &&
            !forceCombatResolved &&
            resolvedScanningConfig.renderOutOfRangeSignatures !== true) {
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
            massKg: candidate && candidate.mass,
            emSignatureMultiplier: candidate && candidate.emSignatureMultiplier,
            thermalSignatureMultiplier: candidate && candidate.thermalSignatureMultiplier,
        });
        const rawPresentedSignatureResults = getPresentedSignatureResults(signatureResults, candidate && candidate.hasLineOfSight);
        const forceUnresolved = !forceCombatResolved &&
            (outsideResolutionRange ||
                resolvedScanningConfig.renderResolvedObjects !== true);
        const presentedSignatureResults = forceUnresolved
            ? capSignatureResultsBelowResolutionThreshold(rawPresentedSignatureResults, resolvedScanningConfig.resolutionSnrThreshold)
            : rawPresentedSignatureResults;
        const scanId = buildScanId(candidate.itemID);
        const combinedResult = {
            center: [position.x, position.y, position.z],
            radius: distanceMeters * Math.sin(halfAngleRadians),
            scan_id: scanId,
            distance_range: [distanceMeters, distanceMeters],
            estimated_number: 1,
            estimated_number_uncertainty: 0,
            signature_results: presentedSignatureResults,
            resolution_state: forceCombatResolved
                ? "combat-resolved"
                : outsideResolutionRange
                    ? "unresolved-out-of-range"
                    : resolvedScanningConfig.renderResolvedObjects !== true
                        ? "unresolved-signature-only"
                        : "in-resolution-range",
        };
        const resolvesToBall = forceCombatResolved ||
            (!forceUnresolved &&
                isResolved(presentedSignatureResults, resolvedScanningConfig.resolutionSnrThreshold));
        if (resolvesToBall) {
            const ballID = toInt(candidate.itemID, 0);
            resolvedIds.push(ballID);
            resolvedDelayMsById.set(ballID, forceCombatResolved
                ? 0
                : calculateScanRevealDelayMs(distanceMeters, durationMs));
        }
        else {
            // Resolved objects are delivered through `resolved` and materialize as
            // ballpark targets. Only unresolved contacts belong in the signature
            // repository's `updated_scans` stream.
            combinedResults.push(combinedResult);
        }
    }
    const currentIds = combinedResults.map((result) => result.scan_id);
    const previous = new Set((Array.isArray(previousScanIds) ? previousScanIds : []).map((value) => toInt(value, 0)));
    const added = currentIds.filter((scanId) => !previous.has(scanId));
    const removed = [...previous].filter((scanId) => !currentIds.includes(scanId));
    const resolvedIdSet = new Set(resolvedIds);
    const removedReasonsByScanId = new Map();
    for (const scanId of removed) {
        if (resolvedIdSet.has(scanId)) {
            removedReasonsByScanId.set(scanId, [UPDATE_RESOLVED_TO_ITEM, scanId]);
        }
    }
    return {
        origin: [origin.x, origin.y, origin.z],
        durationMs,
        added,
        removed,
        updatedScans: combinedResults,
        resolvedIds,
        resolvedDelayMsById,
        scanIds: currentIds,
        removedReasonsByScanId,
        resolutionConfig: resolvedScanningConfig,
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
    GRAVIMETRIC_REFERENCE_MASS_KG,
    SIGNATURE_TYPE_BASE,
    SIGNATURE_TYPE_MASS,
    SIGNATURE_TYPE_ELECTROMAGNETIC,
    SIGNATURE_TYPE_GRAVIMETRIC,
    SIGNATURE_TYPE_THERMAL,
    UPDATE_ADDED_FROM_ITEM,
    UPDATE_COMBINED_WITH_SIGNATURE,
    UPDATE_MERGED_FROM_SIGNATURES,
    UPDATE_RESOLVED_FROM_SIGNATURE,
    UPDATE_RESOLVED_TO_ITEM,
    UPDATE_RESOLVED_TO_SIGNATURES,
    ACTIVE_MODULE_EM_BONUS,
    BUILT_IN_SENSOR_STRENGTH_ATTRIBUTES,
    BUILT_IN_SENSOR_TO_SCAN_MULTIPLIER,
    MODULE_ACTIVITY_EM_BONUS,
    MODULE_ACTIVITY_EM_DECAY_MS,
    WEAPON_ACTIVITY_EM_BONUS,
    WEAPON_ACTIVITY_EM_DECAY_MS,
    buildScanId,
    buildSignatureResultsForTarget,
    calculateScanRevealDelayMs,
    calculateSnr,
    capSignatureResultsBelowResolutionThreshold,
    getPresentedSignatureResults,
    getResolvedScanningContactMap,
    forceResolveScanningContact,
    forgetResolvedScanningContact,
    isResolved,
    isCombatResolvedScanningContact,
    isScanningContactResolved,
    normalizeScanRequest,
    performDirectionalScan,
    recordEntityScannerEmissionActivity,
    replaceResolvedScanningContacts,
    resolveBuiltInScannerProfile,
    resolveBaseSignature,
    resolveGravimetricSignatureMultiplier,
    resolveScanDurationMs,
    resolveScanningConfig,
    resolveSignatureMultipliers,
    resolveEntityEmSignatureMultiplier,
    resetScanningStaticDataForTests,
};
//# sourceMappingURL=scanningRuntime.js.map