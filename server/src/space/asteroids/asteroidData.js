"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const { TABLE, readStaticRows, } = require(path.join(__dirname, "../../services/_shared/referenceData"));
const { FRONTIER_RESOURCE_FIELD_POLICY_VERSION, FRONTIER_RESOURCE_FIELD_STYLES, FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED, buildFrontierResourceFieldDefinition, } = require(path.join(__dirname, "./frontierResourceFields"));
let cache = null;
function buildCacheFromRows(authoredBelts = [], authoredFieldStyles = [], landscapeSites = []) {
    const frontierLandscapeBelts = FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED
        ? landscapeSites
            .map((site) => buildFrontierResourceFieldDefinition(site))
            .filter(Boolean)
        : [];
    const beltsByID = new Map();
    const beltsBySystem = new Map();
    const fieldStylesByID = new Map();
    for (const belt of [...authoredBelts, ...frontierLandscapeBelts]) {
        const beltID = Number(belt && belt.itemID);
        if (!Number.isFinite(beltID) || beltID <= 0 || beltsByID.has(beltID)) {
            continue;
        }
        beltsByID.set(beltID, belt);
        if (!beltsBySystem.has(Number(belt.solarSystemID))) {
            beltsBySystem.set(Number(belt.solarSystemID), []);
        }
        beltsBySystem.get(Number(belt.solarSystemID)).push(belt);
    }
    for (const style of [...authoredFieldStyles, ...FRONTIER_RESOURCE_FIELD_STYLES]) {
        const styleID = String(style && style.fieldStyleID || "").trim();
        if (!styleID) {
            continue;
        }
        if (!fieldStylesByID.has(styleID)) {
            fieldStylesByID.set(styleID, style);
        }
    }
    for (const beltsForSystem of beltsBySystem.values()) {
        beltsForSystem.sort((left, right) => Number(left.itemID) - Number(right.itemID));
    }
    const belts = [...beltsByID.values()].sort((left, right) => Number(left.itemID) - Number(right.itemID));
    const fieldStyles = [...fieldStylesByID.values()];
    return {
        belts,
        authoredBeltCount: authoredBelts.length,
        frontierLandscapeBeltCount: frontierLandscapeBelts.length,
        fieldStyles,
        beltsByID,
        beltsBySystem,
        fieldStylesByID,
    };
}
function buildCache() {
    return buildCacheFromRows(readStaticRows(TABLE.ASTEROID_BELTS), readStaticRows(TABLE.ASTEROID_FIELD_STYLES), readStaticRows(TABLE.LANDSCAPE_SITES));
}
function ensureLoaded() {
    if (!cache) {
        cache = buildCache();
        log.info(`[Asteroids] Loaded ${cache.authoredBeltCount} authored asteroid belts, ` +
            `${cache.frontierLandscapeBeltCount} Frontier landscape resource fields, and ` +
            `${cache.fieldStyles.length} field styles`);
    }
    return cache;
}
function getBeltsForSystem(systemID) {
    return [...(ensureLoaded().beltsBySystem.get(Number(systemID)) || [])];
}
function getBeltByID(itemID) {
    return ensureLoaded().beltsByID.get(Number(itemID)) || null;
}
function getFieldStyleByID(fieldStyleID) {
    return ensureLoaded().fieldStylesByID.get(String(fieldStyleID || "").trim()) || null;
}
module.exports = {
    FRONTIER_RESOURCE_FIELD_POLICY_VERSION,
    FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED,
    ensureLoaded,
    getBeltsForSystem,
    getBeltByID,
    getFieldStyleByID,
    _testing: {
        buildCacheFromRows,
    },
};
//# sourceMappingURL=asteroidData.js.map