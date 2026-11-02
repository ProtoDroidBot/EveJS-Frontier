"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const INSTANCE_ATTRIBUTE_ID_BY_FIELD = Object.freeze({
    online: 2,
    damage: 3,
    charge: 18,
    shieldCharge: 264,
    armorDamage: 266,
    skillPoints: 276,
});
const LEGACY_ATTRIBUTE_IDS_BY_CATALOG = new WeakMap();
function usesLegacyFrontierDogmaProfile(compatibilityProfile, clientBuild) {
    return String(compatibilityProfile || "").trim().toLowerCase() === "frontier" &&
        clientBuild === 2703993;
}
function getCharacterInventoryCategoryIDForProfile(compatibilityProfile, clientBuild) {
    // Native 2703993 FSD group 1 (Character) belongs to category 1 (Owner).
    // Preserve the existing category selection for every other wire profile.
    return usesLegacyFrontierDogmaProfile(compatibilityProfile, clientBuild) ? 1 : 3;
}
function usesTimestampedInfoAttributes(compatibilityProfile, clientBuild) {
    return String(compatibilityProfile || "").trim().toLowerCase() === "frontier" &&
        !usesLegacyFrontierDogmaProfile(compatibilityProfile, clientBuild);
}
function legacySupportedInfoAttributeIDs() {
    // Resolve lazily: the shared prime builders also import this module while
    // the character/inventory services are initializing. The generated table
    // preserves the native dogmaAttributes schema and its source provenance.
    const { TABLE, readStaticTable } = require("../_shared/referenceData");
    const schema = readStaticTable(TABLE.TYPE_DOGMA);
    const catalog = schema && schema.attributeTypesByID;
    const unavailable = () => {
        throw Object.assign(new Error("Build 2703993 Dogma info requires the native Frontier attribute schema " +
            "(source build 2703993, authority eve-frontier-client-static-2703993)."), { code: "LEGACY_DOGMA_ATTRIBUTE_SCHEMA_UNAVAILABLE" });
    };
    if (schema?.source?.buildNumber !== 2703993 ||
        schema.source.authority !== "eve-frontier-client-static-2703993" ||
        schema.source.profile !== "frontier" ||
        !catalog || typeof catalog !== "object" || Array.isArray(catalog))
        unavailable();
    const cached = LEGACY_ATTRIBUTE_IDS_BY_CATALOG.get(catalog);
    if (cached)
        return cached;
    const entries = Object.entries(catalog);
    if (entries.length === 0)
        unavailable();
    const supported = new Set();
    for (const [key, record] of entries) {
        const attributeID = Number(key);
        if (!Number.isSafeInteger(attributeID) || attributeID <= 0 ||
            !record || Number(record.attributeID) !== attributeID)
            unavailable();
        supported.add(attributeID);
    }
    LEGACY_ATTRIBUTE_IDS_BY_CATALOG.set(catalog, supported);
    return supported;
}
function notificationSequence(value) {
    return Array.isArray(value)
        ? value
        : value && (value.type === "list" || value.type === "tuple") && Array.isArray(value.items)
            ? value.items
            : null;
}
function withNotificationSequence(value, items) {
    return Array.isArray(value) ? items : { ...value, items };
}
function notificationName(value) {
    return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
function normalizeDogmaNotificationForProfile(notifyType, payloadTuple, compatibilityProfile, clientBuild) {
    if (!usesLegacyFrontierDogmaProfile(compatibilityProfile, clientBuild))
        return payloadTuple;
    const kind = notificationName(notifyType);
    if (!["OnModuleAttributeChange", "OnModuleAttributeChanges", "OnMultiEvent"].includes(kind))
        return payloadTuple;
    const args = notificationSequence(payloadTuple);
    if (!args)
        return payloadTuple;
    let supported;
    const supports = (attributeID) => {
        supported ||= legacySupportedInfoAttributeIDs();
        const value = attributeID && typeof attributeID === "object" && "value" in attributeID
            ? attributeID.value
            : attributeID;
        return supported.has(Number(value));
    };
    if (kind === "OnModuleAttributeChange") {
        // Direct notifications omit the event name; nested sub-events include it.
        const index = notificationName(args[0]) === "OnModuleAttributeChange" ? 3 : 2;
        return supports(args[index]) ? payloadTuple : null;
    }
    const batch = notificationSequence(args[0]);
    if (!batch)
        return payloadTuple;
    const filtered = batch.filter((entry) => {
        const pairOrChange = notificationSequence(entry);
        const change = kind === "OnMultiEvent"
            ? notificationSequence(pairOrChange && pairOrChange[0])
            : pairOrChange;
        // Preserve other OnMultiEvent sub-events and their original clocks/types.
        return !change || notificationName(change[0]) !== "OnModuleAttributeChange" || supports(change[3]);
    });
    if (filtered.length === batch.length)
        return payloadTuple;
    if (filtered.length === 0)
        return null;
    const nextArgs = args.slice();
    nextArgs[0] = withNotificationSequence(args[0], filtered);
    return withNotificationSequence(payloadTuple, nextArgs);
}
function normalizePackedInstanceRowForProfile(packedInstanceRow, compatibilityProfile, clientBuild) {
    if (!usesTimestampedInfoAttributes(compatibilityProfile, clientBuild) ||
        !packedInstanceRow ||
        packedInstanceRow.type !== "packedrow" ||
        !packedInstanceRow.fields ||
        typeof packedInstanceRow.fields !== "object") {
        return packedInstanceRow;
    }
    const entries = [];
    for (const [field, attributeID] of Object.entries(INSTANCE_ATTRIBUTE_ID_BY_FIELD)) {
        if (Object.prototype.hasOwnProperty.call(packedInstanceRow.fields, field)) {
            entries.push([attributeID, packedInstanceRow.fields[field]]);
        }
    }
    return {
        type: "dict",
        entries,
    };
}
function normalizeInstanceCacheForProfile(instanceCache, compatibilityProfile, clientBuild) {
    if (!usesTimestampedInfoAttributes(compatibilityProfile, clientBuild) ||
        !instanceCache ||
        instanceCache.type !== "dict" ||
        !Array.isArray(instanceCache.entries)) {
        return instanceCache;
    }
    return {
        ...instanceCache,
        entries: instanceCache.entries.map(([itemID, instanceAttributes]) => [
            itemID,
            normalizePackedInstanceRowForProfile(instanceAttributes, compatibilityProfile, clientBuild),
        ]),
    };
}
function normalizeActivationStateForProfile(activationState, compatibilityProfile, clientBuild) {
    if (usesTimestampedInfoAttributes(compatibilityProfile, clientBuild) &&
        Array.isArray(activationState)) {
        const normalizedState = activationState.slice(0, 3);
        normalizedState[0] = normalizeInstanceCacheForProfile(normalizedState[0], compatibilityProfile, clientBuild);
        return normalizedState;
    }
    return activationState;
}
function normalizeInfoAttributesForProfile(attributes, timestamp, compatibilityProfile, clientBuild) {
    if (usesLegacyFrontierDogmaProfile(compatibilityProfile, clientBuild) &&
        attributes?.type === "dict" && Array.isArray(attributes.entries)) {
        // The native consumer directly indexes its attribute definitions. Newer
        // server-derived attributes must not reach this older client's parser.
        const supported = legacySupportedInfoAttributeIDs();
        const entries = attributes.entries.filter(([attributeID]) => supported.has(Number(attributeID)));
        return entries.length === attributes.entries.length ? attributes : { ...attributes, entries };
    }
    if (!usesTimestampedInfoAttributes(compatibilityProfile, clientBuild) ||
        !attributes ||
        attributes.type !== "dict" ||
        !Array.isArray(attributes.entries)) {
        return attributes;
    }
    return {
        ...attributes,
        entries: attributes.entries.map(([attributeID, value]) => [
            attributeID,
            [value, timestamp],
        ]),
    };
}
module.exports = {
    getCharacterInventoryCategoryIDForProfile,
    normalizeActivationStateForProfile,
    normalizeDogmaNotificationForProfile,
    normalizeInfoAttributesForProfile,
    normalizeInstanceCacheForProfile,
    normalizePackedInstanceRowForProfile,
    usesLegacyFrontierDogmaProfile,
    usesTimestampedInfoAttributes,
};
//# sourceMappingURL=dogmaInfoCompatibility.js.map