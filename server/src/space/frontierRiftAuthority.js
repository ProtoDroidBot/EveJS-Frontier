"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const CRUDE_RIFT_GROUP_ID = 4872;
const CRUDE_MATTER_GROUP_ID = 4593;
const SPAWN_GUARD_EVENT_TYPE_ID = 3;
const PREFERRED_RIFT_DUNGEON_IDS = new Set([14001, 14008]);
const CRUDE_MATTER_QUANTITY_BY_POTENTIAL = Object.freeze({
    low: 1_000,
    mid: 10_000,
    high: 100_000,
});
const RIFT_FORMATION_YIELD = Object.freeze({
    rupture: Object.freeze({ potential: "low", resourceQuantity: 1_000 }),
    fissure: Object.freeze({ potential: "mid", resourceQuantity: 10_000 }),
    fault: Object.freeze({ potential: "high", resourceQuantity: 100_000 }),
});
function toPositiveInt(value, fallback = 0) {
    const numeric = Math.trunc(Number(value) || 0);
    return numeric > 0 ? numeric : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function normalizePosition(value) {
    if (Array.isArray(value) && value.length >= 3) {
        return {
            x: toFiniteNumber(value[0], 0),
            y: toFiniteNumber(value[1], 0),
            z: toFiniteNumber(value[2], 0),
        };
    }
    const source = value && typeof value === "object" ? value : {};
    return {
        x: toFiniteNumber(source.x, 0),
        y: toFiniteNumber(source.y, 0),
        z: toFiniteNumber(source.z, 0),
    };
}
function addPositions(left, right) {
    return {
        x: left.x + right.x,
        y: left.y + right.y,
        z: left.z + right.z,
    };
}
function subtractPositions(left, right) {
    return {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    };
}
function normalizeCollection(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => entry && typeof entry === "object");
    }
    if (value && typeof value === "object") {
        return Object.values(value).filter((entry) => entry && typeof entry === "object");
    }
    return [];
}
function collectDungeonObjects(dungeon) {
    return normalizeCollection(dungeon && dungeon.rooms).flatMap((room) => {
        const roomPosition = normalizePosition(room.position || {
            x: room.x,
            y: room.y,
            z: room.z,
        });
        return normalizeCollection(room.objects).map((object) => ({
            ...object,
            objectID: toPositiveInt(object.objectID, 0),
            roomID: toPositiveInt(object.roomID, toPositiveInt(room.roomID, 0)),
            typeID: toPositiveInt(object.typeID, 0),
            absoluteOffset: addPositions(roomPosition, normalizePosition(object.position)),
        }));
    });
}
function collectSpawnGuardObjectIDs(dungeon) {
    const objectIDs = new Set();
    for (const trigger of normalizeCollection(dungeon && dungeon.triggers)) {
        for (const event of normalizeCollection(trigger.triggerEvents)) {
            if (toPositiveInt(event.eventTypeID, 0) !== SPAWN_GUARD_EVENT_TYPE_ID) {
                continue;
            }
            const objectID = toPositiveInt(event.objectID, 0);
            if (objectID > 0) {
                objectIDs.add(objectID);
            }
        }
    }
    return objectIDs;
}
function classifyCrudeMatterResource(resource) {
    const typeName = String(resource && resource.itemName || "").trim();
    const localName = String(resource && resource.localName || "").trim();
    const classificationText = `${typeName} ${localName}`.toLowerCase();
    const age = /\byoung\b/.test(classificationText)
        ? "young"
        : /\bold\b/.test(classificationText)
            ? "old"
            : null;
    const quality = /\bfine\b/.test(classificationText)
        ? "fine"
        : /\brough\b/.test(classificationText)
            ? "rough"
            : null;
    const namedPotential = /\bhigh\b/.test(classificationText)
        ? "high"
        : /\b(mid|medium)\b/.test(classificationText)
            ? "mid"
            : /\blow\b/.test(classificationText)
                ? "low"
                : null;
    const formation = /\bfaults?\b/.test(classificationText)
        ? "fault"
        : /\bfissures?\b/.test(classificationText)
            ? "fissure"
            : /\bruptures?\b/.test(classificationText)
                ? "rupture"
                : null;
    const formationYield = formation ? RIFT_FORMATION_YIELD[formation] : null;
    const potential = formationYield ? formationYield.potential : namedPotential;
    const resourceQuantity = formationYield
        ? formationYield.resourceQuantity
        : potential
            ? CRUDE_MATTER_QUANTITY_BY_POTENTIAL[potential]
            : null;
    const tags = [...new Set(localName
            .toLowerCase()
            .replace(/\b(crude|matter|young|old|fine|rough|low|mid|medium|high|ruptures?|fissures?|faults?)\b/g, " ")
            .split(/[^a-z0-9]+/)
            .map((tag) => tag.trim())
            .filter(Boolean))];
    return {
        typeID: toPositiveInt(resource && resource.typeID, 0),
        typeName: typeName || null,
        localName: localName || null,
        age,
        quality,
        formation,
        potential,
        resourceQuantity,
        tags,
    };
}
function createFrontierRiftAuthority(options = {}) {
    const referenceData = options.referenceData || require(path.join(__dirname, "../services/_shared/referenceData"));
    const itemTypes = options.itemTypes || require(path.join(__dirname, "../services/inventory/itemTypeRegistry"));
    let cache = null;
    function buildCache() {
        const dungeons = options.dungeons || referenceData.readStaticRows(referenceData.TABLE.FRONTIER_DUNGEON_TEMPLATES);
        const templates = [];
        for (const dungeon of Array.isArray(dungeons) ? dungeons : []) {
            const dungeonID = toPositiveInt(dungeon.dungeonID ?? dungeon._key, 0);
            const entryTypeID = toPositiveInt(dungeon.entryTypeID, 0);
            const entryType = itemTypes.resolveItemByTypeID(entryTypeID);
            if (dungeonID <= 0 ||
                !entryType ||
                toPositiveInt(entryType.groupID, 0) !== CRUDE_RIFT_GROUP_ID) {
                continue;
            }
            const objects = collectDungeonObjects(dungeon);
            const entryObjectID = toPositiveInt(dungeon.entryObjectID, 0);
            const entryObject = objects.find((object) => object.objectID === entryObjectID) || null;
            if (!entryObject) {
                continue;
            }
            const spawnGuardObjectIDs = collectSpawnGuardObjectIDs(dungeon);
            const authoredSceneObjects = objects
                .filter((object) => (object.objectID !== entryObjectID &&
                object.typeID > 0))
                .map((object) => {
                const type = itemTypes.resolveItemByTypeID(object.typeID) || {};
                return {
                    ...object,
                    groupID: toPositiveInt(type.groupID, 0),
                    itemName: String(type.name || `Type ${object.typeID}`),
                    positionOffset: subtractPositions(object.absoluteOffset, entryObject.absoluteOffset),
                    rotation: [
                        toFiniteNumber(object.yaw, 0),
                        toFiniteNumber(object.pitch, 0),
                        toFiniteNumber(object.roll, 0),
                    ],
                };
            });
            const sceneObjects = authoredSceneObjects.filter((object) => !spawnGuardObjectIDs.has(object.objectID));
            const resources = sceneObjects.filter((object) => object.groupID === CRUDE_MATTER_GROUP_ID);
            const resourceVariants = authoredSceneObjects.filter((object) => object.groupID === CRUDE_MATTER_GROUP_ID);
            const resourceProfiles = resourceVariants.map(classifyCrudeMatterResource);
            templates.push({
                ...dungeon,
                dungeonID,
                entryObjectID,
                entryTypeID,
                entryType,
                itemName: String(dungeon.dungeonName || entryType.name || `Rift ${dungeonID}`),
                preferred: PREFERRED_RIFT_DUNGEON_IDS.has(dungeonID),
                resources,
                resourceVariants,
                resourceProfiles,
                riftTags: [...new Set(resourceProfiles.flatMap((profile) => profile.tags))],
                sceneObjects,
                spawnGuardObjectIDs: [...spawnGuardObjectIDs].sort((left, right) => left - right),
            });
        }
        templates.sort((left, right) => (Number(right.preferred) - Number(left.preferred) ||
            left.dungeonID - right.dungeonID));
        return {
            templates,
            byDungeonID: new Map(templates.map((template) => [template.dungeonID, template])),
            byTypeID: new Map(templates.map((template) => [template.entryTypeID, template])),
        };
    }
    function ensureLoaded() {
        if (!cache) {
            cache = buildCache();
        }
        return cache;
    }
    function listTemplates() {
        return [...ensureLoaded().templates];
    }
    function getTemplateByDungeonID(dungeonID) {
        return ensureLoaded().byDungeonID.get(toPositiveInt(dungeonID, 0)) || null;
    }
    function getTemplateByTypeID(typeID) {
        return ensureLoaded().byTypeID.get(toPositiveInt(typeID, 0)) || null;
    }
    function resolveTemplate(query = "") {
        const normalized = String(query || "").trim().toLowerCase();
        if (!normalized) {
            return listTemplates().find((template) => template.preferred) || listTemplates()[0] || null;
        }
        const numeric = toPositiveInt(normalized, 0);
        if (numeric > 0) {
            return getTemplateByDungeonID(numeric) || getTemplateByTypeID(numeric);
        }
        return listTemplates().find((template) => (template.itemName.toLowerCase() === normalized ||
            template.itemName.toLowerCase().includes(normalized))) || null;
    }
    return {
        clearCache() {
            cache = null;
        },
        getTemplateByDungeonID,
        getTemplateByTypeID,
        listTemplates,
        resolveTemplate,
    };
}
let defaultAuthority = null;
function getDefaultAuthority() {
    if (!defaultAuthority) {
        defaultAuthority = createFrontierRiftAuthority();
    }
    return defaultAuthority;
}
module.exports = {
    CRUDE_MATTER_QUANTITY_BY_POTENTIAL,
    CRUDE_MATTER_GROUP_ID,
    CRUDE_RIFT_GROUP_ID,
    PREFERRED_RIFT_DUNGEON_IDS,
    SPAWN_GUARD_EVENT_TYPE_ID,
    RIFT_FORMATION_YIELD,
    collectDungeonObjects,
    collectSpawnGuardObjectIDs,
    classifyCrudeMatterResource,
    createFrontierRiftAuthority,
    getTemplateByDungeonID: (...args) => getDefaultAuthority().getTemplateByDungeonID(...args),
    getTemplateByTypeID: (...args) => getDefaultAuthority().getTemplateByTypeID(...args),
    listTemplates: (...args) => getDefaultAuthority().listTemplates(...args),
    resolveTemplate: (...args) => getDefaultAuthority().resolveTemplate(...args),
};
//# sourceMappingURL=frontierRiftAuthority.js.map