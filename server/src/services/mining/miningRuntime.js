"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
// Memoized resolver for lazy (circular-dependency-safe) requires that run on the
// mining tick path. require(path.join(__dirname, id)) costs ~1.8us/call even
// when cached (path rebuild + resolver lookup); caching the resolved reference
// drops it to a ~4ns Map lookup. Safe because the targets assign module.exports
// once at load (or mutate it in place), so the cached reference never goes stale.
const _lazyModuleCache = new Map();
function lazyRequire(relativeId) {
    let resolved = _lazyModuleCache.get(relativeId);
    if (resolved === undefined) {
        resolved = require(path.join(__dirname, relativeId));
        _lazyModuleCache.set(relativeId, resolved);
    }
    return resolved;
}
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { canEntitiesInteractLocally, } = require(path.join(__dirname, "../../space/destiny/identity/interactionScope"));
const { getActiveShipRecord, emitItemsChangedForSession, syncChargeSublocationTransitionForSession, syncInventoryItemForSession, } = require(path.join(__dirname, "../character/characterState"));
const { getCachedCharacterSkillMap, } = require(path.join(__dirname, "../skills/skillState"));
const { ITEM_FLAGS, findItemById, findShipItemById, getItemMutationVersion, grantItemsToCharacterLocation, listContainerItems, removeInventoryItem, updateInventoryItem, } = require(path.join(__dirname, "../inventory/itemStore"));
const { getFittedModuleItems, getLoadedChargeByFlag, getEffectTypeRecord, isChargeCompatibleWithModule, isModuleOnline, buildShipResourceState, buildChargeTupleItemID, getTypeAttributeMap, } = require(path.join(__dirname, "../fitting/liveFittingState"));
const { resolveItemByTypeID, } = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const { matchesTypeList, } = require(path.join(__dirname, "../inventory/typeListAuthority"));
const { MINING_HOLD_FLAGS, } = require("./miningConstants");
const { getPreferredMiningHoldFlagForType, getShipHoldCapacityByFlag, } = require("./miningInventory");
const { computeMiningResult, } = require("./miningMath");
const { isMiningEffectRecord, buildMiningModuleSnapshot, } = require("./miningDogma");
const commandBurstRuntime = require(path.join(__dirname, "../../space/modules/commandBurstRuntime"));
const { getLocationModifierSourcesForSystem, } = require(path.join(__dirname, "../exploration/wormholes/wormholeEnvironmentRuntime"));
const { ensureSceneMiningState, ensureSceneMiningStateAsync, getMineableState, applyMiningDelta, isMineableStaticEntity, respawnDepletedMineables, } = require("./miningRuntimeState");
const { getNpcFittedModuleItems, getNpcLoadedChargeForModule, isNativeNpcEntity, } = require(path.join(__dirname, "../../space/npc/npcEquipment"));
const { buildKeyVal, currentFileTime, } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const INV_UPDATE_LOCATION = 3;
const shipStorageSnapshotCache = new Map();
const ATTRIBUTE_ITEM_DAMAGE = 3;
const ATTRIBUTE_STRUCTURE_HP = 9;
const ATTRIBUTE_QUANTITY = 805;
const ATTRIBUTE_CHARGE_SIZE = 128;
const ATTRIBUTE_CHARGE_GROUP_1 = 604;
const TYPE_CUTTING_LASER = 95317;
const TYPE_CRUDE_EXTRACTOR = 95503;
const TYPE_NEEDLE = 95778;
const CRUDE_MATTER_GROUP_ID = 4593;
const FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID = 5133;
const CRUDE_LENS_TYPE_LIST_ID = 601;
const ASTEROID_LENS_TYPE_LIST_ID = 612;
const ASTEROID_LENS_TYPE_LIST_IDS = new Set([599, ASTEROID_LENS_TYPE_LIST_ID, 613]);
const FRONTIER_HELD_BEAM_MINING_TYPE_IDS = new Set([
    TYPE_CUTTING_LASER,
    TYPE_CRUDE_EXTRACTOR,
    TYPE_NEEDLE,
]);
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function round6(value) {
    return Number(toFiniteNumber(value, 0).toFixed(6));
}
function clampRatio(value, fallback = 0) {
    const numericValue = toFiniteNumber(value, fallback);
    return Math.max(0, Math.min(1, numericValue));
}
// Modulated Strip Miners (and Modulated Deep Core Strip Miners) load mining
// crystals: their type declares a chargeSize and a crystal chargeGroup. EVE
// parity: crystal/modulated mining modules CANNOT be short-cycled — a manual
// stop completes the current cycle. Basic mining lasers, strip miners, deep
// core lasers, ice harvesters, and gas harvesters carry no crystal and may be
// short-cycled (proportional yield on a manual mid-cycle stop).
function miningModuleUsesCrystals(moduleTypeID) {
    const typeID = toInt(moduleTypeID, 0);
    if (typeID <= 0) {
        return false;
    }
    const attributes = getTypeAttributeMap(typeID) || {};
    return (toFiniteNumber(attributes[ATTRIBUTE_CHARGE_SIZE], 0) > 0 ||
        toFiniteNumber(attributes[ATTRIBUTE_CHARGE_GROUP_1], 0) > 0);
}
function getSessionFileTime(session) {
    return session && session._space && session._space.simFileTime
        ? session._space.simFileTime
        : currentFileTime();
}
function notifyMiningChargeAttributeChange(session, shipID, moduleFlagID, chargeTypeID, attributeID, nextValue, previousValue) {
    const numericShipID = toInt(shipID, 0);
    const numericFlagID = toInt(moduleFlagID, 0);
    const numericChargeTypeID = toInt(chargeTypeID, 0);
    const numericAttributeID = toInt(attributeID, 0);
    if (!session ||
        typeof session.sendNotification !== "function" ||
        numericShipID <= 0 ||
        numericFlagID <= 0 ||
        numericChargeTypeID <= 0 ||
        numericAttributeID <= 0) {
        return false;
    }
    session.sendNotification("OnModuleAttributeChanges", "clientID", [{
            type: "list",
            items: [[
                    // TQ parity: singular inner tuple tag + trailing time.
                    "OnModuleAttributeChange",
                    toInt(session.characterID, 0),
                    buildChargeTupleItemID(numericShipID, numericFlagID, numericChargeTypeID),
                    numericAttributeID,
                    getSessionFileTime(session),
                    Number.isFinite(Number(nextValue)) ? Number(nextValue) : nextValue,
                    Number.isFinite(Number(previousValue)) ? Number(previousValue) : previousValue,
                    getSessionFileTime(session),
                ]],
        }]);
    return true;
}
function notifyMiningChargeDamageChange(session, shipID, moduleFlagID, chargeTypeID, nextDamage, previousDamage) {
    const chargeAttributes = getTypeAttributeMap(toInt(chargeTypeID, 0)) || {};
    const structureHP = Math.max(0, toFiniteNumber(chargeAttributes[ATTRIBUTE_STRUCTURE_HP], 0));
    const nextDamageValue = round6(structureHP > 0 ? structureHP * clampRatio(nextDamage, 0) : nextDamage);
    const previousDamageValue = round6(structureHP > 0 ? structureHP * clampRatio(previousDamage, 0) : previousDamage);
    return notifyMiningChargeAttributeChange(session, shipID, moduleFlagID, chargeTypeID, ATTRIBUTE_ITEM_DAMAGE, nextDamageValue, previousDamageValue);
}
function notifyMiningChargeRemoved(session, shipID, moduleFlagID, chargeTypeID, previousQuantity) {
    return notifyMiningChargeAttributeChange(session, shipID, moduleFlagID, chargeTypeID, ATTRIBUTE_QUANTITY, 0, Math.max(0, toInt(previousQuantity, 0)));
}
function distance(left, right) {
    const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
    const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
    const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
    return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}
function getSurfaceDistance(left, right) {
    return Math.max(0, distance(left && left.position, right && right.position) -
        Math.max(0, toFiniteNumber(left && left.radius, 0)) -
        Math.max(0, toFiniteNumber(right && right.radius, 0)));
}
function getMiningCommandSurfaceDistance(scene, sourceEntity, targetEntity, nowMs = null) {
    if (scene &&
        typeof scene.getCommandTimeEntitySurfaceDistance === "function") {
        return scene.getCommandTimeEntitySurfaceDistance(sourceEntity, targetEntity, nowMs);
    }
    if (scene && typeof scene.getEntitySurfaceDistance === "function") {
        return scene.getEntitySurfaceDistance(sourceEntity, targetEntity);
    }
    return getSurfaceDistance(sourceEntity, targetEntity);
}
function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
}
function resolveEntityCharacterID(entity) {
    if (!entity || entity.kind !== "ship") {
        return 0;
    }
    return toInt(entity.session && entity.session.characterID
        ? entity.session.characterID
        : entity.characterID ?? entity.pilotCharacterID, 0);
}
function buildEphemeralShipItem(entity, characterID = 0) {
    return {
        itemID: toInt(entity && entity.itemID, 0),
        typeID: toInt(entity && entity.typeID, 0),
        ownerID: toInt(characterID, 0),
        locationID: toInt(entity && entity.systemID, 0),
        flagID: ITEM_FLAGS.HANGAR,
        singleton: 1,
        quantity: 1,
        stacksize: 1,
        itemName: String(entity && entity.itemName || ""),
    };
}
function resolveEntityShipItem(entity) {
    const characterID = resolveEntityCharacterID(entity);
    if (characterID > 0) {
        return (getActiveShipRecord(characterID) ||
            findShipItemById(toInt(entity && entity.itemID, 0)) ||
            buildEphemeralShipItem(entity, characterID));
    }
    return buildEphemeralShipItem(entity, characterID);
}
function resolveEntitySkillMap(entity) {
    const characterID = resolveEntityCharacterID(entity);
    return characterID > 0 ? getCachedCharacterSkillMap(characterID) : new Map();
}
function resolveEntityFittedItems(entity) {
    if (!entity || entity.kind !== "ship") {
        return [];
    }
    if (isNativeNpcEntity(entity)) {
        return getNpcFittedModuleItems(entity);
    }
    const characterID = resolveEntityCharacterID(entity);
    if (characterID > 0) {
        return getFittedModuleItems(characterID, toInt(entity.itemID, 0));
    }
    return Array.isArray(entity.fittedItems) ? entity.fittedItems.map((item) => ({ ...item })) : [];
}
function resolveEntityModuleItem(entity, moduleID = 0, moduleFlagID = 0) {
    const normalizedModuleID = toInt(moduleID, 0);
    const normalizedModuleFlagID = toInt(moduleFlagID, 0);
    return resolveEntityFittedItems(entity).find((moduleItem) => ((normalizedModuleID > 0 &&
        toInt(moduleItem && moduleItem.itemID, 0) === normalizedModuleID) ||
        (normalizedModuleFlagID > 0 &&
            toInt(moduleItem && moduleItem.flagID, 0) === normalizedModuleFlagID))) || null;
}
function resolveEntityLoadedCharge(entity, moduleItem = null) {
    if (!entity || entity.kind !== "ship" || !moduleItem) {
        return null;
    }
    if (isNativeNpcEntity(entity)) {
        return getNpcLoadedChargeForModule(entity, moduleItem);
    }
    const characterID = resolveEntityCharacterID(entity);
    if (characterID <= 0) {
        return moduleItem.loadedChargeItem || null;
    }
    return getLoadedChargeByFlag(characterID, toInt(entity.itemID, 0), toInt(moduleItem.flagID, 0));
}
function resolveEntityActiveModuleContexts(entity, excludeModuleID = 0) {
    if (!entity || !(entity.activeModuleEffects instanceof Map)) {
        return [];
    }
    const normalizedExcludeModuleID = toInt(excludeModuleID, 0);
    const contexts = [];
    for (const effectState of entity.activeModuleEffects.values()) {
        if (!effectState ||
            (normalizedExcludeModuleID > 0 &&
                toInt(effectState.moduleID, 0) === normalizedExcludeModuleID)) {
            continue;
        }
        const effectRecord = getEffectTypeRecord(toInt(effectState.effectID, 0));
        const moduleItem = resolveEntityModuleItem(entity, effectState.moduleID, effectState.moduleFlagID);
        if (!effectRecord || !moduleItem) {
            continue;
        }
        contexts.push({
            effectState,
            effectRecord,
            moduleItem,
            chargeItem: resolveEntityLoadedCharge(entity, moduleItem),
        });
    }
    return contexts;
}
function buildEntityMiningSnapshot(entity, moduleItem, effectRecord, options = {}) {
    const shipItem = resolveEntityShipItem(entity);
    const resolvedModuleItem = resolveEntityModuleItem(entity, moduleItem && moduleItem.itemID, moduleItem && moduleItem.flagID) || moduleItem;
    if (!shipItem || !resolvedModuleItem) {
        return null;
    }
    const additionalModifierEntries = commandBurstRuntime.collectModifierEntriesForItem(entity, resolvedModuleItem, options.nowMs);
    const chargeItem = Object.prototype.hasOwnProperty.call(options, "chargeItem")
        ? options.chargeItem
        : resolveEntityLoadedCharge(entity, resolvedModuleItem);
    return buildMiningModuleSnapshot({
        characterID: resolveEntityCharacterID(entity),
        shipItem,
        moduleItem: resolvedModuleItem,
        effectRecord,
        chargeItem,
        fittedItems: resolveEntityFittedItems(entity),
        skillMap: resolveEntitySkillMap(entity),
        activeModuleContexts: resolveEntityActiveModuleContexts(entity, resolvedModuleItem.itemID),
        additionalModifierEntries,
        additionalLocationModifierSources: getLocationModifierSourcesForSystem(entity && entity.systemID),
    });
}
function isMiningEffectState(effectState) {
    return Boolean(effectState && effectState.miningEffect === true);
}
function getTargetsForEntity(scene, entity) {
    return scene && typeof scene.getTargetsForEntity === "function"
        ? scene.getTargetsForEntity(entity)
        : [];
}
function computeUsedVolume(items = []) {
    return items.reduce((sum, item) => {
        if (!item) {
            return sum;
        }
        const units = toInt(item.singleton, 0) === 1
            ? 1
            : Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
        const volume = Math.max(0, toFiniteNumber(item.volume, 0));
        return sum + (volume * units);
    }, 0);
}
function getPlayerShipStorageSnapshot(entity) {
    const characterID = resolveEntityCharacterID(entity);
    const shipID = toInt(entity && entity.itemID, 0);
    if (characterID <= 0 || shipID <= 0) {
        return null;
    }
    const mutationVersion = getItemMutationVersion();
    const cacheKey = `${characterID}:${shipID}:${mutationVersion}`;
    if (shipStorageSnapshotCache.has(cacheKey)) {
        return shipStorageSnapshotCache.get(cacheKey);
    }
    const shipItem = resolveEntityShipItem(entity);
    const resourceState = buildShipResourceState(characterID, shipItem, {
        fittedItems: resolveEntityFittedItems(entity),
        skillMap: resolveEntitySkillMap(entity),
    });
    const usedByFlag = new Map();
    for (const item of listContainerItems(characterID, shipID, null)) {
        const flagID = toInt(item && item.flagID, 0);
        usedByFlag.set(flagID, round6((usedByFlag.get(flagID) || 0) + computeUsedVolume([item])));
    }
    const snapshot = {
        characterID,
        shipID,
        resourceState,
        usedByFlag,
    };
    shipStorageSnapshotCache.set(cacheKey, snapshot);
    return snapshot;
}
function getAvailableVolumeForFlag(storageSnapshot, flagID) {
    if (!storageSnapshot || !storageSnapshot.resourceState) {
        return 0;
    }
    const normalizedFlagID = toInt(flagID, 0);
    const capacity = normalizedFlagID === ITEM_FLAGS.CARGO_HOLD
        ? toFiniteNumber(storageSnapshot.resourceState.cargoCapacity, 0)
        : getShipHoldCapacityByFlag(storageSnapshot.resourceState, normalizedFlagID);
    const used = toFiniteNumber(storageSnapshot.usedByFlag.get(normalizedFlagID), 0);
    return Math.max(0, round6(capacity - used));
}
function resolveDestinationFlagForPlayer(entity, yieldTypeID, yieldKind) {
    const storageSnapshot = getPlayerShipStorageSnapshot(entity);
    const preferredFlag = storageSnapshot
        ? getPreferredMiningHoldFlagForType(storageSnapshot.resourceState, yieldTypeID)
        : null;
    const orderedFlags = [
        preferredFlag,
        yieldKind === "ore" ? MINING_HOLD_FLAGS.SPECIALIZED_ASTEROID_HOLD : null,
        yieldKind === "gas" ? MINING_HOLD_FLAGS.SPECIALIZED_GAS_HOLD : null,
        yieldKind === "ice" ? MINING_HOLD_FLAGS.SPECIALIZED_ICE_HOLD : null,
        MINING_HOLD_FLAGS.GENERAL_MINING_HOLD,
        ITEM_FLAGS.CARGO_HOLD,
    ].filter((value, index, array) => value && array.indexOf(value) === index);
    for (const flagID of orderedFlags) {
        const availableVolume = getAvailableVolumeForFlag(storageSnapshot, flagID);
        if (availableVolume > 0) {
            return {
                flagID,
                availableVolume,
            };
        }
    }
    return {
        flagID: preferredFlag || ITEM_FLAGS.CARGO_HOLD,
        availableVolume: 0,
    };
}
function resolveLedgerObserverContext(scene, targetEntity) {
    const candidateIDs = [
        targetEntity && targetEntity.observerItemID,
        targetEntity && targetEntity.observerID,
        targetEntity && targetEntity.structureID,
        targetEntity && targetEntity.ownerStructureID,
        targetEntity && targetEntity.sourceStructureID,
        targetEntity && targetEntity.moonMiningStructureID,
        scene && scene.observerItemID,
        scene && scene.observerID,
        scene && scene.structureID,
    ];
    let observerItemID = 0;
    for (const candidate of candidateIDs) {
        const normalized = toInt(candidate, 0);
        if (normalized > 0) {
            observerItemID = normalized;
            break;
        }
    }
    const observerNameCandidates = [
        targetEntity && targetEntity.observerItemName,
        targetEntity && targetEntity.observerName,
        targetEntity && targetEntity.structureName,
        targetEntity && targetEntity.ownerStructureName,
        targetEntity && targetEntity.sourceStructureName,
        scene && scene.observerItemName,
        scene && scene.observerName,
        scene && scene.structureName,
    ];
    let observerItemName = "";
    for (const candidate of observerNameCandidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            observerItemName = candidate.trim();
            break;
        }
    }
    return {
        observerItemID,
        observerItemName,
    };
}
function syncInventoryChangesToSession(session, changes = []) {
    for (const change of Array.isArray(changes) ? changes : []) {
        if (!change || !change.item) {
            continue;
        }
        syncInventoryItemForSession(session, change.item, change.previousData || change.previousState || {}, {
            emitCfgLocation: true,
        });
    }
}
function buildMinedOreChangeDict(change) {
    if (!change || change.created !== true) {
        return null;
    }
    return {
        type: "dict",
        entries: [[INV_UPDATE_LOCATION, 0]],
    };
}
function buildMinedOreNotificationItem(change) {
    if (!change || !change.item) {
        return null;
    }
    const item = { ...change.item };
    item.clientCustomInfo = change.created === true
        ? buildKeyVal([["isMined", true]])
        : null;
    return item;
}
function syncMinedOreChangesToSession(session, shipID, changes = []) {
    if (!session || typeof session.sendNotification !== "function") {
        return;
    }
    const locationContext = ["Ship", toInt(shipID, 0), "ShipCargo"];
    for (const change of Array.isArray(changes) ? changes : []) {
        const item = buildMinedOreNotificationItem(change);
        if (!item) {
            continue;
        }
        const previousState = change.previousData || change.previousState || {};
        emitItemsChangedForSession(session, item, previousState, {
            idType: "charid",
            locationContext,
            changeDict: buildMinedOreChangeDict(change),
        });
    }
}
function stripCrystalSuffix(name) {
    return String(name || "")
        .replace(/\s+Mining Crystal(?:\s+I{1,3}|\s+Type\s+[ABC])?$/i, "")
        .trim();
}
function isChargeHeuristicallyValidForYield(chargeItem, mineableState) {
    if (!chargeItem || !mineableState) {
        return true;
    }
    if (mineableState.yieldKind === "salvage") {
        return true;
    }
    if (mineableState.yieldKind !== "ore") {
        return false;
    }
    const yieldType = resolveItemByTypeID(mineableState.yieldTypeID) || null;
    if (!yieldType) {
        return false;
    }
    const crystalName = String(chargeItem.itemName || chargeItem.name || "").trim();
    const crystalStem = normalizeText(stripCrystalSuffix(crystalName));
    const yieldName = normalizeText(yieldType.name);
    const yieldGroupName = normalizeText(yieldType.groupName);
    if (crystalStem === yieldName ||
        crystalStem === yieldGroupName ||
        yieldName.includes(crystalStem) ||
        yieldGroupName.includes(crystalStem)) {
        return true;
    }
    return /asteroid mining crystal|mercoxit mining crystal/i.test(crystalName);
}
function isFamilyCompatibleWithYield(snapshot, mineableState) {
    if (!snapshot || !mineableState) {
        return false;
    }
    if (snapshot.family === "gas") {
        return mineableState.yieldKind === "gas";
    }
    if (snapshot.family === "ice") {
        return mineableState.yieldKind === "ice";
    }
    return mineableState.yieldKind === "ore" || mineableState.yieldKind === "salvage";
}
function isChargeValidForYield(chargeItem, mineableState, snapshot = null, options = {}) {
    if (!chargeItem || !mineableState) {
        return true;
    }
    const targetTypeListID = toInt(snapshot && snapshot.crystalTargetTypeListID, 0);
    if (targetTypeListID > 0) {
        // Frontier lenses author their supported resources through attribute 3148:
        // The list authorizes the mined asteroid/wreckage type, which may differ
        // from its output material (notably group-5133 salvageable wreckage).
        const sourceTypeID = toInt(mineableState.visualTypeID, 0) ||
            toInt(options.targetEntity && options.targetEntity.typeID, 0) ||
            toInt(mineableState.yieldTypeID, 0);
        const matchTypeList = options.matchesTypeList || matchesTypeList;
        return matchTypeList({ typeID: sourceTypeID }, targetTypeListID);
    }
    return isChargeHeuristicallyValidForYield(chargeItem, mineableState);
}
function isFrontierHeldBeamMiningModuleType(moduleTypeID) {
    return FRONTIER_HELD_BEAM_MINING_TYPE_IDS.has(toInt(moduleTypeID, 0));
}
function isCrudeExtractorModuleType(moduleTypeID) {
    return toInt(moduleTypeID, 0) === TYPE_CRUDE_EXTRACTOR;
}
function isCrudeRiftMineableState(mineableState, targetEntity = null, options = {}) {
    if (!mineableState) {
        return false;
    }
    if (targetEntity &&
        (targetEntity.frontierRiftResource === true ||
            toInt(targetEntity.groupID, 0) === CRUDE_MATTER_GROUP_ID)) {
        return true;
    }
    const matchTypeList = options.matchesTypeList || matchesTypeList;
    return matchTypeList({ typeID: toInt(mineableState.yieldTypeID, 0) }, CRUDE_LENS_TYPE_LIST_ID);
}
/**
 * Shared player/NPC mining compatibility. Mining must fail closed when a
 * lens/crystal-capable ore tool has no charge, when a charge does not
 * authorize the target, or when a Crude Rift is approached with anything
 * other than a Crude Extractor. Basic legacy miners which have no authored
 * charge bay remain valid without a lens; requiring one would make that
 * entire non-skillshot equipment family unusable.
 * Group-5133 salvageable wreckage remains an authored asteroid/mining-loop
 * target; ordinary wreck salvaging and recovery are separate, currently-
 * unregistered resource mechanics.
 */
function isMiningSnapshotCompatibleWithState(snapshot, mineableState, targetEntity = null, options = {}) {
    if (!isFamilyCompatibleWithYield(snapshot, mineableState)) {
        return false;
    }
    const yieldKind = String(mineableState && mineableState.yieldKind || "").toLowerCase();
    if (yieldKind === "salvage" &&
        toInt(targetEntity && targetEntity.groupID, 0) !== FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID) {
        return false;
    }
    if (snapshot.family !== "ore") {
        return true;
    }
    const moduleTypeID = toInt(snapshot.moduleTypeID, 0);
    const chargeTypeID = toInt(snapshot.chargeTypeID, 0);
    if (moduleTypeID <= 0) {
        return false;
    }
    const crudeRift = isCrudeRiftMineableState(mineableState, targetEntity, options);
    const targetTypeListID = toInt(snapshot.crystalTargetTypeListID, 0);
    if (crudeRift) {
        if (!isCrudeExtractorModuleType(moduleTypeID) ||
            targetTypeListID !== CRUDE_LENS_TYPE_LIST_ID) {
            return false;
        }
    }
    else {
        if (isCrudeExtractorModuleType(moduleTypeID)) {
            return false;
        }
        if (isFrontierHeldBeamMiningModuleType(moduleTypeID) &&
            !ASTEROID_LENS_TYPE_LIST_IDS.has(targetTypeListID)) {
            return false;
        }
    }
    const resolveUsesCrystals = options.miningModuleUsesCrystals || miningModuleUsesCrystals;
    const requiresCharge = isFrontierHeldBeamMiningModuleType(moduleTypeID) ||
        resolveUsesCrystals(moduleTypeID) === true;
    if (chargeTypeID <= 0) {
        return !requiresCharge;
    }
    const validateModuleCharge = options.isChargeCompatibleWithModule || isChargeCompatibleWithModule;
    if (validateModuleCharge(moduleTypeID, chargeTypeID) !== true) {
        return false;
    }
    const resolvedCharge = options.chargeItem ||
        resolveItemByTypeID(chargeTypeID) ||
        { typeID: chargeTypeID, itemName: String(snapshot.chargeName || "") };
    return isChargeValidForYield(resolvedCharge, mineableState, snapshot, {
        ...options,
        targetEntity,
    });
}
function resolveMiningActivation(scene, entity, moduleItem, effectRecord, options = {}) {
    if (!isMiningEffectRecord(effectRecord, moduleItem)) {
        return { matched: false };
    }
    ensureSceneMiningState(scene);
    const targetID = toInt(options && options.targetID, 0);
    const targetEntity = scene.getEntityByID(targetID);
    const mineableState = getMineableState(scene, targetID);
    if (targetID <= 0) {
        return { matched: true, success: false, errorMsg: "TARGET_REQUIRED" };
    }
    if (!targetEntity ||
        !mineableState ||
        mineableState.remainingQuantity <= 0 ||
        !canEntitiesInteractLocally(entity, targetEntity)) {
        return { matched: true, success: false, errorMsg: "TARGET_NOT_FOUND" };
    }
    if (!getTargetsForEntity(scene, entity).includes(targetID)) {
        return { matched: true, success: false, errorMsg: "TARGET_NOT_LOCKED" };
    }
    const snapshot = buildEntityMiningSnapshot(entity, moduleItem, effectRecord, {
        nowMs: scene && typeof scene.getCurrentSimTimeMs === "function"
            ? scene.getCurrentSimTimeMs()
            : Date.now(),
    });
    if (!snapshot) {
        return { matched: true, success: false, errorMsg: "UNSUPPORTED_MODULE" };
    }
    const chargeItem = resolveEntityLoadedCharge(entity, moduleItem);
    if (!isMiningSnapshotCompatibleWithState(snapshot, mineableState, targetEntity, { chargeItem })) {
        return { matched: true, success: false, errorMsg: "TARGET_INVALID_FOR_MODULE" };
    }
    if (chargeItem &&
        !(isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID) &&
            isChargeValidForYield(chargeItem, mineableState, snapshot, { targetEntity }))) {
        return { matched: true, success: false, errorMsg: "CHARGE_NOT_COMPATIBLE" };
    }
    const commandTimeMs = scene && typeof scene.getCurrentSimTimeMs === "function"
        ? scene.getCurrentSimTimeMs()
        : Date.now();
    if (getMiningCommandSurfaceDistance(scene, entity, targetEntity, commandTimeMs) >
        snapshot.maxRangeMeters + 1) {
        return { matched: true, success: false, errorMsg: "TARGET_OUT_OF_RANGE" };
    }
    return {
        matched: true,
        success: true,
        data: {
            targetEntity,
            mineableState,
            runtimeAttrs: {
                capNeed: snapshot.capNeed,
                durationMs: snapshot.durationMs,
                durationAttributeID: snapshot.durationAttributeID,
                reactivationDelayMs: snapshot.reactivationDelayMs,
                maxGroupActive: snapshot.maxGroupActive,
                weaponFamily: null,
                miningSnapshot: snapshot,
            },
        },
    };
}
function appendNpcCargo(entity, typeID, quantity) {
    const miningNpcOperations = require("./miningNpcOperations");
    return miningNpcOperations.appendNpcMiningCargo(entity, typeID, quantity);
}
function applyCrystalVolatility(entity, moduleItem, snapshot, efficiency = 1) {
    if (!entity || !moduleItem || !snapshot || snapshot.chargeTypeID <= 0) {
        return;
    }
    if (snapshot.crystalVolatilityChance <= 0 ||
        snapshot.crystalVolatilityDamage <= 0 ||
        isNativeNpcEntity(entity)) {
        return;
    }
    const effectiveVolatilityChance = snapshot.crystalVolatilityChance *
        Math.min(1, Math.max(0, toFiniteNumber(efficiency, 1)));
    if (Math.random() > effectiveVolatilityChance) {
        return;
    }
    const chargeItem = resolveEntityLoadedCharge(entity, moduleItem);
    if (!chargeItem) {
        return;
    }
    const session = entity.session || null;
    const previousDamage = clampRatio(chargeItem && chargeItem.moduleState && chargeItem.moduleState.damage, 0);
    const nextDamage = clampRatio(previousDamage + snapshot.crystalVolatilityDamage, previousDamage);
    if (nextDamage <= previousDamage + 1e-9) {
        return;
    }
    const updateResult = updateInventoryItem(chargeItem.itemID, (item) => ({
        ...item,
        moduleState: {
            ...(item && item.moduleState ? item.moduleState : {}),
            damage: nextDamage,
        },
    }));
    if (!updateResult || !updateResult.success) {
        return;
    }
    const updatedChargeItem = findItemById(chargeItem.itemID) || updateResult.data || {
        ...chargeItem,
        moduleState: {
            ...(chargeItem && chargeItem.moduleState ? chargeItem.moduleState : {}),
            damage: nextDamage,
        },
    };
    if (moduleItem.loadedChargeItem) {
        moduleItem.loadedChargeItem = {
            ...moduleItem.loadedChargeItem,
            moduleState: {
                ...(moduleItem.loadedChargeItem.moduleState || {}),
                damage: nextDamage,
            },
        };
    }
    if (session) {
        notifyMiningChargeDamageChange(session, entity.itemID, moduleItem.flagID, updatedChargeItem.typeID || chargeItem.typeID, nextDamage, previousDamage);
    }
    if (nextDamage < 1 - 1e-9) {
        return;
    }
    const currentQuantity = Math.max(0, toInt(chargeItem.stacksize ?? chargeItem.quantity, 0));
    const removeResult = removeInventoryItem(chargeItem.itemID, {
        removeContents: true,
    });
    if (removeResult && removeResult.success) {
        if (moduleItem.loadedChargeItem) {
            moduleItem.loadedChargeItem = null;
        }
        if (session) {
            syncInventoryChangesToSession(session, removeResult.data.changes);
            syncChargeSublocationTransitionForSession(session, {
                shipID: entity.itemID,
                flagID: moduleItem.flagID,
                ownerID: updatedChargeItem.ownerID || chargeItem.ownerID,
                previousState: {
                    typeID: updatedChargeItem.typeID || chargeItem.typeID,
                    quantity: currentQuantity > 0 ? currentQuantity : 1,
                },
                nextState: {
                    typeID: updatedChargeItem.typeID || chargeItem.typeID,
                    quantity: 0,
                },
            });
            notifyMiningChargeRemoved(session, entity.itemID, moduleItem.flagID, updatedChargeItem.typeID || chargeItem.typeID, currentQuantity > 0 ? currentQuantity : 1);
        }
    }
}
function executeMiningCycle(scene, entity, effectState, cycleBoundaryMs, options = {}) {
    if (!scene || !entity || !effectState) {
        return { success: false, stopReason: "module" };
    }
    const efficiency = Math.min(1, Math.max(0, toFiniteNumber(options.efficiency, 1)));
    if (efficiency <= 0) {
        return { success: false, stopReason: "cycle" };
    }
    const targetID = toInt(effectState.targetID, 0);
    const targetEntity = scene.getEntityByID(targetID);
    const mineableState = getMineableState(scene, targetID);
    if (!targetEntity ||
        !mineableState ||
        mineableState.remainingQuantity <= 0 ||
        !canEntitiesInteractLocally(entity, targetEntity)) {
        return { success: false, stopReason: "target" };
    }
    if (options.requireTargetLock !== false &&
        !getTargetsForEntity(scene, entity).includes(targetID)) {
        return { success: false, stopReason: "target" };
    }
    const moduleItem = resolveEntityModuleItem(entity, effectState.moduleID, effectState.moduleFlagID);
    if (!moduleItem || !isModuleOnline(moduleItem)) {
        return { success: false, stopReason: "module" };
    }
    const effectRecord = getEffectTypeRecord(toInt(effectState.effectID, 0));
    const snapshot = options.snapshot || buildEntityMiningSnapshot(entity, moduleItem, effectRecord, {
        nowMs: cycleBoundaryMs,
        ...(Object.prototype.hasOwnProperty.call(options, "chargeItem")
            ? { chargeItem: options.chargeItem }
            : {}),
    });
    const chargeItem = Object.prototype.hasOwnProperty.call(options, "chargeItem")
        ? options.chargeItem
        : resolveEntityLoadedCharge(entity, moduleItem);
    if (!snapshot ||
        !isMiningSnapshotCompatibleWithState(snapshot, mineableState, targetEntity, { chargeItem })) {
        return { success: false, stopReason: "module" };
    }
    if (getMiningCommandSurfaceDistance(scene, entity, targetEntity, cycleBoundaryMs) >
        snapshot.maxRangeMeters + 1) {
        return { success: false, stopReason: "range" };
    }
    const validateChargeYield = options.isChargeValidForYield || isChargeValidForYield;
    if (chargeItem &&
        !(isChargeCompatibleWithModule(moduleItem.typeID, chargeItem.typeID) &&
            validateChargeYield(chargeItem, mineableState, snapshot, { targetEntity }))) {
        return { success: false, stopReason: "charge" };
    }
    effectState.chargeTypeID = snapshot.chargeTypeID;
    let destinationFlagID = ITEM_FLAGS.CARGO_HOLD;
    let availableVolume = Number.POSITIVE_INFINITY;
    if (!isNativeNpcEntity(entity)) {
        const destination = resolveDestinationFlagForPlayer(entity, mineableState.yieldTypeID, mineableState.yieldKind);
        destinationFlagID = destination.flagID;
        availableVolume = destination.availableVolume;
        if (availableVolume <= 0) {
            return { success: false, stopReason: "cargo" };
        }
    }
    const amountMultiplier = Math.max(0, toFiniteNumber(options.amountMultiplier, 1));
    const miningVolume = Math.max(0, snapshot.miningAmountM3 * amountMultiplier);
    const effectiveMiningVolume = miningVolume * efficiency;
    const quantityVolumeAvailable = mineableState.remainingQuantity * mineableState.unitVolume;
    const maximumTransferredQuantity = Number.isFinite(availableVolume)
        ? Math.max(0, Math.floor(availableVolume / mineableState.unitVolume))
        : Number.POSITIVE_INFINITY;
    if (maximumTransferredQuantity <= 0) {
        return { success: false, stopReason: "cargo" };
    }
    const availableTransferVolume = Number.isFinite(maximumTransferredQuantity)
        ? maximumTransferredQuantity * mineableState.unitVolume
        : availableVolume;
    const clampFactor = Math.min(1, quantityVolumeAvailable / effectiveMiningVolume, availableTransferVolume / effectiveMiningVolume);
    if (clampFactor <= 0) {
        return {
            success: false,
            stopReason: quantityVolumeAvailable <= 0 ? "target" : "cargo",
        };
    }
    const miningResult = computeMiningResult({
        clampFactor,
        volume: miningVolume,
        unitVolume: mineableState.unitVolume,
        asteroidQuantity: mineableState.remainingQuantity,
        wasteVolumeMultiplier: snapshot.wasteVolumeMultiplier,
        wasteProbability: snapshot.wasteProbability,
        critQuantityMultiplier: snapshot.critQuantityMultiplier,
        critProbability: snapshot.critChance,
        efficiency,
    });
    if (Number.isFinite(maximumTransferredQuantity)) {
        miningResult.normalQuantity = Math.min(miningResult.normalQuantity, maximumTransferredQuantity);
    }
    const maximumBonusQuantity = Number.isFinite(maximumTransferredQuantity)
        ? Math.max(0, maximumTransferredQuantity - miningResult.normalQuantity)
        : miningResult.criticalHitQuantity;
    miningResult.criticalHitQuantity = Math.max(0, Math.min(miningResult.criticalHitQuantity, maximumBonusQuantity));
    miningResult.criticalHitVolume = miningResult.criticalHitQuantity * mineableState.unitVolume;
    const transferredQuantity = miningResult.getTotalTransferredQuantity();
    if (transferredQuantity <= 0 && miningResult.wastedQuantity <= 0) {
        return { success: false, stopReason: "cargo" };
    }
    if (isNativeNpcEntity(entity)) {
        const cargoResult = appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);
        if (!cargoResult || cargoResult.success !== true) {
            return { success: false, stopReason: "cargo" };
        }
    }
    else {
        const grantResult = grantItemsToCharacterLocation(resolveEntityCharacterID(entity), toInt(entity.itemID, 0), destinationFlagID, [{
                itemType: mineableState.yieldTypeID,
                quantity: transferredQuantity,
            }]);
        if (!grantResult.success || !grantResult.data) {
            return { success: false, stopReason: "cargo" };
        }
        if (entity.session) {
            syncMinedOreChangesToSession(entity.session, toInt(entity.itemID, 0), grantResult.data.changes);
        }
    }
    const deltaResult = applyMiningDelta(scene, targetEntity, miningResult.normalQuantity, miningResult.wastedQuantity, {
        broadcast: true,
        nowMs: cycleBoundaryMs,
        sourceEntity: entity,
        moduleItem,
        quantityAdded: transferredQuantity,
        amountWasted: miningResult.wastedQuantity,
        amountCritBonus: miningResult.criticalHitQuantity,
        hasRewards: miningResult.rewardedQuantity > 0,
    });
    if (!deltaResult.success) {
        return { success: false, stopReason: "target" };
    }
    if (!isNativeNpcEntity(entity)) {
        const miningLedgerState = require("./miningLedgerState");
        const observerContext = resolveLedgerObserverContext(scene, targetEntity);
        miningLedgerState.recordMiningLedgerEvent({
            characterID: resolveEntityCharacterID(entity),
            corporationID: toInt(entity &&
                entity.session &&
                (entity.session.corporationID || entity.session.corpid), 0),
            solarSystemID: toInt(scene && (scene.systemID || scene.solarSystemID), toInt(entity && entity.systemID, 0)),
            typeID: mineableState.yieldTypeID,
            quantity: transferredQuantity,
            quantityWasted: miningResult.wastedQuantity,
            quantityCritical: miningResult.criticalHitQuantity,
            shipTypeID: toInt(entity && entity.typeID, 0),
            moduleTypeID: toInt(moduleItem && moduleItem.typeID, 0),
            observerItemID: observerContext.observerItemID,
            observerItemName: observerContext.observerItemName,
            yieldKind: mineableState.yieldKind,
            eventDateMs: cycleBoundaryMs,
        });
        // Advance the "Mine N units of Ore" AIR daily goal by the units mined this
        // cycle. Ore only (gas/ice are separate contribution types). Defensive so
        // daily-goal bookkeeping can never disrupt the mining tick.
        if (mineableState.yieldKind === "ore" && transferredQuantity > 0) {
            try {
                lazyRequire("../dailyGoals/dailyGoalsState").recordActivity(resolveEntityCharacterID(entity), "mine_ore", transferredQuantity);
            }
            catch (dailyGoalError) {
                log.debug(`[MiningRuntime] daily-goal mine_ore hook failed: ${dailyGoalError.message}`);
            }
        }
    }
    if (options.applyCrystalVolatility !== false) {
        applyCrystalVolatility(entity, moduleItem, snapshot, efficiency);
    }
    return {
        success: true,
        data: {
            targetID,
            yieldTypeID: mineableState.yieldTypeID,
            transferredQuantity,
            normalQuantity: miningResult.normalQuantity,
            criticalHitQuantity: miningResult.criticalHitQuantity,
            wastedQuantity: miningResult.wastedQuantity,
            efficiency,
            amountMultiplier,
            partialCycle: options.partialCycle === true,
            depleted: Boolean(deltaResult.data && deltaResult.data.depleted),
        },
    };
}
/**
 * Resolve one manually-aimed held-beam collision as a mining/extraction
 * cycle. Unlike ordinary mining activation this path intentionally does not
 * require a target lock: the authoritative swept collision is the target.
 */
function executeSkillShotMiningCycle(scene, entity, targetEntity, moduleItem, chargeItem, cycleBoundaryMs, options = {}) {
    if (!scene || !entity || !targetEntity || !moduleItem) {
        return { matched: false };
    }
    if (isFrontierHeldBeamMiningModuleType(moduleItem.typeID) &&
        (!chargeItem || toInt(chargeItem.typeID, 0) <= 0)) {
        return {
            matched: true,
            success: false,
            stopReason: "charge",
        };
    }
    const ensureMiningState = options.ensureSceneMiningState || ensureSceneMiningState;
    const resolveMineableState = options.getMineableState || getMineableState;
    const buildSnapshot = options.buildEntityMiningSnapshot || buildEntityMiningSnapshot;
    const validateModuleCharge = options.isChargeCompatibleWithModule || isChargeCompatibleWithModule;
    const validateChargeYield = options.isChargeValidForYield || isChargeValidForYield;
    const executeCycle = options.executeMiningCycle || executeMiningCycle;
    ensureMiningState(scene);
    const targetID = toInt(targetEntity.itemID, 0);
    const mineableState = resolveMineableState(scene, targetID);
    if (!mineableState) {
        return { matched: false };
    }
    if (mineableState.remainingQuantity <= 0) {
        return {
            matched: true,
            success: false,
            stopReason: "target",
        };
    }
    const snapshot = buildSnapshot(entity, moduleItem, null, {
        nowMs: cycleBoundaryMs,
        chargeItem,
    });
    if (!snapshot || !isFamilyCompatibleWithYield(snapshot, mineableState)) {
        return {
            matched: true,
            success: false,
            stopReason: "module",
        };
    }
    if (chargeItem &&
        !(validateModuleCharge(moduleItem.typeID, chargeItem.typeID) &&
            validateChargeYield(chargeItem, mineableState, snapshot, { targetEntity }))) {
        return {
            matched: true,
            success: false,
            stopReason: "charge",
        };
    }
    if (!isMiningSnapshotCompatibleWithState(snapshot, mineableState, targetEntity, {
        chargeItem,
        isChargeCompatibleWithModule: validateModuleCharge,
        matchesTypeList: options.matchesTypeList,
    })) {
        return {
            matched: true,
            success: false,
            stopReason: "module",
        };
    }
    const { authoredEfficiency, rampMultiplier, amountMultiplier, } = resolveSkillShotMiningAmountMultiplier(snapshot, options.rampMultiplier);
    if (amountMultiplier <= 0) {
        return {
            matched: true,
            success: false,
            stopReason: "cycle",
        };
    }
    const cycleResult = executeCycle(scene, entity, {
        targetID,
        moduleID: toInt(moduleItem.itemID, 0),
        moduleFlagID: toInt(moduleItem.flagID, 0),
        effectID: 0,
    }, cycleBoundaryMs, {
        requireTargetLock: false,
        snapshot,
        chargeItem,
        amountMultiplier,
        isChargeValidForYield: validateChargeYield,
        // Player SkillShotRuntime applies lens volatility while consuming its
        // authoritative resources. Session-free NPC held beams opt in here.
        applyCrystalVolatility: options.applyCrystalVolatility === true,
    });
    return {
        matched: true,
        success: cycleResult.success === true,
        stopReason: cycleResult.stopReason || null,
        data: {
            ...(cycleResult.data || {}),
            authoredEfficiency,
            rampMultiplier,
            amountMultiplier,
        },
    };
}
function resolveSkillShotMiningAmountMultiplier(snapshot, rawRampMultiplier = 1) {
    const authoredEfficiency = Math.max(0, toFiniteNumber(snapshot && snapshot.miningEfficiencyPercent, 100) / 100);
    const rampMultiplier = Math.max(0, toFiniteNumber(rawRampMultiplier, 1));
    return {
        authoredEfficiency,
        rampMultiplier,
        amountMultiplier: authoredEfficiency * rampMultiplier,
    };
}
function resolveSceneForSession(session) {
    if (!session || !session._space) {
        return null;
    }
    const spaceRuntime = lazyRequire("../../space/runtime");
    return spaceRuntime.ensureScene(toInt(session._space.systemID, 0));
}
function buildScanResultsForSession(session) {
    const scene = resolveSceneForSession(session);
    if (!scene) {
        return [];
    }
    ensureSceneMiningState(scene);
    const shipEntity = scene.getShipEntityForSession(session);
    if (!shipEntity) {
        return [];
    }
    const maxDistanceMeters = Math.max(1, toFiniteNumber(config.miningSurveyScanDistanceMeters, 250_000));
    const scanResults = [];
    for (const entity of scene.getVisibleEntitiesForSession(session)) {
        if (!isMineableStaticEntity(entity) ||
            !canEntitiesInteractLocally(shipEntity, entity)) {
            continue;
        }
        const state = getMineableState(scene, entity.itemID);
        if (!state || state.remainingQuantity <= 0) {
            continue;
        }
        if (getSurfaceDistance(shipEntity, entity) > maxDistanceMeters) {
            continue;
        }
        scanResults.push({
            entityID: toInt(entity.itemID, 0),
            yieldTypeID: toInt(state.yieldTypeID, 0),
            remainingQuantity: toInt(state.remainingQuantity, 0),
            distance: getSurfaceDistance(shipEntity, entity),
        });
    }
    scanResults.sort((left, right) => left.distance - right.distance ||
        left.entityID - right.entityID);
    return scanResults.map((entry) => [
        entry.entityID,
        entry.yieldTypeID,
        entry.remainingQuantity,
    ]);
}
function findMiningEffectRecordForModule(moduleItem) {
    const { getTypeEffectRecords: getEffects } = lazyRequire("../fitting/liveFittingState");
    return getEffects(toInt(moduleItem && moduleItem.typeID, 0))
        .find((effectRecord) => isMiningEffectRecord(effectRecord, moduleItem)) || null;
}
function findFirstMiningModule(entity) {
    return resolveEntityFittedItems(entity)
        .find((moduleItem) => isModuleOnline(moduleItem) && findMiningEffectRecordForModule(moduleItem))
        || null;
}
function resolveMineableCandidates(scene, interactionSource = null) {
    ensureSceneMiningState(scene);
    return scene.staticEntities
        .filter((entity) => (isMineableStaticEntity(entity) &&
        (!interactionSource || canEntitiesInteractLocally(interactionSource, entity))))
        .map((entity) => ({
        entity,
        state: getMineableState(scene, entity.itemID),
    }))
        .filter((entry) => entry.state && entry.state.remainingQuantity > 0);
}
function chooseMineableTargetForFleet(scene, fleetRecord) {
    const interactionSource = (Array.isArray(fleetRecord && fleetRecord.minerEntityIDs)
        ? fleetRecord.minerEntityIDs
        : [])
        .map((entityID) => scene.getEntityByID(toInt(entityID, 0)))
        .find(Boolean) || null;
    const candidates = resolveMineableCandidates(scene, interactionSource);
    if (candidates.length <= 0) {
        return null;
    }
    const preferredTarget = scene.getEntityByID(toInt(fleetRecord && fleetRecord.targetShipID, 0));
    const referencePosition = (preferredTarget && preferredTarget.position) ||
        (fleetRecord &&
            fleetRecord.originAnchor &&
            fleetRecord.originAnchor.position) ||
        { x: 0, y: 0, z: 0 };
    candidates.sort((left, right) => distance(left.entity.position, referencePosition) -
        distance(right.entity.position, referencePosition) ||
        toInt(left.entity.itemID, 0) - toInt(right.entity.itemID, 0));
    return candidates[0].entity || null;
}
function buildNpcPseudoSession(entity) {
    return {
        // Durable NPCs deliberately keep pilotCharacterID at zero on their slim
        // entity so clients cannot mistake them for player-piloted ships.  Their
        // server-side inventory and module actions still need the stable Phase 0
        // character identity, however.  Prefer a real player pilot when present,
        // then fall back to the durable NPC identity.
        characterID: toInt(entity && (entity.pilotCharacterID || entity.characterID || entity.npcCharacterID), 0),
        corporationID: toInt(entity && entity.corporationID, 0),
        allianceID: toInt(entity && entity.allianceID, 0),
        _space: {
            systemID: toInt(entity && entity.systemID, 0),
            shipID: toInt(entity && entity.itemID, 0),
        },
    };
}
function handleSceneCreated(scene) {
    const miningResourceSiteService = require("./miningResourceSiteService");
    if (miningResourceSiteService &&
        typeof miningResourceSiteService.handleSceneCreated === "function") {
        miningResourceSiteService.handleSceneCreated(scene);
    }
    ensureSceneMiningState(scene);
    const miningNpcOperations = require("./miningNpcOperations");
    if (typeof miningNpcOperations.handleSceneCreated === "function") {
        miningNpcOperations.handleSceneCreated(scene);
    }
}
async function handleSceneCreatedAsync(scene, options = {}) {
    const miningResourceSiteService = require("./miningResourceSiteService");
    if (options.resourceSitesPlanned !== true &&
        miningResourceSiteService &&
        typeof miningResourceSiteService.handleSceneCreated === "function") {
        miningResourceSiteService.handleSceneCreated(scene);
    }
    await ensureSceneMiningStateAsync(scene, {
        batchSize: options.batchSize,
    });
    const miningNpcOperations = require("./miningNpcOperations");
    if (typeof miningNpcOperations.handleSceneCreated === "function") {
        miningNpcOperations.handleSceneCreated(scene);
    }
}
function tickScene(scene, now) {
    ensureSceneMiningState(scene);
    respawnDepletedMineables(scene, Date.now());
    try {
        const frontierRiftSceneService = lazyRequire("../../space/frontierRiftSceneService");
        if (frontierRiftSceneService && typeof frontierRiftSceneService.tickScene === "function") {
            frontierRiftSceneService.tickScene(scene, Date.now());
        }
    }
    catch (_) {
        // Frontier Rift lifecycle is optional in isolated mining runtime tests.
    }
    if (config.miningNpcFleetAutoMineEnabled !== true) {
        return;
    }
    const miningNpcOperations = require("./miningNpcOperations");
    if (typeof miningNpcOperations.tickScene === "function") {
        miningNpcOperations.tickScene(scene, now, {
            chooseMineableTargetForFleet,
            findMiningEffectRecordForModule,
            buildEntityMiningSnapshot,
            isMiningSnapshotCompatibleWithState,
            getSurfaceDistance,
            getTargetsForEntity,
            buildNpcPseudoSession,
        });
    }
}
module.exports = {
    handleSceneCreated,
    handleSceneCreatedAsync,
    tickScene,
    isMiningEffectRecord,
    isMiningEffectState,
    isMiningSnapshotCompatibleWithState,
    isFrontierHeldBeamMiningModuleType,
    isCrudeExtractorModuleType,
    isCrudeRiftMineableState,
    FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
    resolveMiningActivation,
    executeMiningCycle,
    executeSkillShotMiningCycle,
    miningModuleUsesCrystals,
    buildScanResultsForSession,
    findMiningEffectRecordForModule,
    buildEntityMiningSnapshot,
    resolveMineableCandidates,
    getSurfaceDistance,
    getTargetsForEntity,
    buildNpcPseudoSession,
    _testing: {
        isChargeValidForYield,
        isMiningSnapshotCompatibleWithState,
        resolveSkillShotMiningAmountMultiplier,
        TYPE_CUTTING_LASER,
        TYPE_CRUDE_EXTRACTOR,
        TYPE_NEEDLE,
        FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
        CRUDE_LENS_TYPE_LIST_ID,
        ASTEROID_LENS_TYPE_LIST_ID,
    },
};
//# sourceMappingURL=miningRuntime.js.map