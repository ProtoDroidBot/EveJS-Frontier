"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const { ITEM_FLAGS, SHIP_CATEGORY_ID, findItemById, grantItemsToCharacterLocation, listContainerItems, moveItemToLocation, moveItemsToLocationsAndUpdateItem, removeInventoryItem, updateInventoryItem, updateShipItem, } = require(path.join(__dirname, "../inventory/itemStore"));
const { buildInventoryDogmaPrimeEntry, syncModuleOnlineEffectForSession, syncInventoryItemForSession, } = require(path.join(__dirname, "../character/characterState"));
const { getCreationModule, getCreationTemplate, } = require(path.join(__dirname, "./creationStaticData"));
const { validateCreationLayout, } = require(path.join(__dirname, "./creationLayoutValidation"));
const { applyModifierGroups, appendDirectModifierEntries, buildEffectiveItemAttributeMap, buildShipResourceState, getAttributeIDByNames, getPassiveModifierEffectRecords, getModuleChargeGroupIDs, getTypeDogmaEffects, } = require(path.join(__dirname, "../fitting/liveFittingState"));
const { buildGodmaShipEffectEvent, buildModuleAttributeChangeEvent, sendOnMultiEvent, } = require(path.join(__dirname, "../_shared/godmaMultiEvent"));
const { currentFileTime, } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const { ABILITY_RELOAD, ABILITY_UNLOAD, getModuleBehaviorName, getRegisteredBehaviorAbilities, getRegisteredTypeAbilities, resolveCreationAbilityHandler, } = require(path.join(__dirname, "./creationAbilityRuntime"));
const { ATTRIBUTE_FUEL_CAPACITY, getShipFuelCharge, getShipFuelQueue, normalizeFuelQueue, partitionFuelQueueByReserveCapacity, resolveCreationReserveFuelCapacity, resolveShipFuelTank, trimFuelQueueToQuantity, } = require(path.join(__dirname, "./fuelTankRuntime"));
const CREATION_STATE_KEY = "evejsFrontierCreation";
const CREATION_STATE_VERSION = 1;
const CREATION_FITTING_FLAG_ID = 183;
const HIDDEN_CREATION_MODULE_FLAG_ID = CREATION_FITTING_FLAG_ID;
const CREATION_ONLINE_EFFECT_ID = 16;
const CREATION_FRICTION_CONSTANT = 1.0e-6;
const ATTRIBUTE_MAX_VELOCITY = getAttributeIDByNames("maxVelocity") || 37;
const ATTRIBUTE_AGILITY = getAttributeIDByNames("agility") || 70;
// Attribute 567 also has the display name "Thrust" but is the legacy
// speedBoostFactor. Frontier CreationDogmaItem explicitly uses attribute 6250.
const ATTRIBUTE_THRUST = 6250;
const ATTRIBUTE_PASSIVE_SCAN_GRAV_RESOLUTION = 6168;
const ATTRIBUTE_PASSIVE_SCAN_EM_RESOLUTION = 6171;
const DEFAULT_PASSIVE_SCAN_RESOLUTION = 10;
const DOGMA_OP_PRE_ASSIGNMENT = -1;
const DOGMA_OP_MOD_ADD = 2;
const TYPE_FUEL_BLISTER = 96013;
const TYPE_BLACKSTART_CELL = 96055;
const ATTRIBUTE_RESERVE_FUEL_CHARGE = 6342;
const ATTRIBUTE_CAPACITOR_CAPACITY = getAttributeIDByNames("capacitorCapacity") || 482;
const EFFECT_CAPACITOR_CAPACITY_ADD_ONLINE = 3811;
const EFFECT_CAPACITOR_CAPACITY_ADD_PASSIVE = 12921;
const creationStateChangeListeners = new Set();
function subscribeCreationStateChanges(listener) {
    if (typeof listener !== "function") {
        return () => false;
    }
    creationStateChangeListeners.add(listener);
    return () => creationStateChangeListeners.delete(listener);
}
function notifyCreationStateChanged(event = {}) {
    for (const listener of [...creationStateChangeListeners]) {
        try {
            listener(event);
        }
        catch (error) {
            // The state mutation is already durable. Observers are reconciliation
            // helpers and must never turn it into a retryable client mutation.
            log.warn(`[creation] state listener failed reason=${String(event.reason || "unknown")}: ` +
                `${error?.message || error}`);
        }
    }
}
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toPositiveIntOr(value, fallback) {
    const numeric = toInt(value, 0);
    return numeric > 0 ? numeric : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function parseCustomInfo(customInfo) {
    const text = String(customInfo || "").trim();
    if (!text) {
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch (_) {
        return { legacyCustomInfo: text };
    }
}
function normalizeRotation(value, dimensions) {
    const source = value && typeof value === "object" ? value : {};
    const normalized = {
        x: toFiniteNumber(source.x, 0),
        y: toFiniteNumber(source.y, 0),
        z: toFiniteNumber(source.z, 0),
    };
    if (dimensions === 4) {
        normalized.w = toFiniteNumber(source.w, 1);
    }
    return normalized;
}
function getCreationModuleAbilities(typeID, options = {}) {
    const numericTypeID = toInt(typeID, 0);
    if (numericTypeID <= 0) {
        return [];
    }
    const resolveEffects = typeof options.getTypeDogmaEffects === "function"
        ? options.getTypeDogmaEffects
        : getTypeDogmaEffects;
    const abilities = [];
    if (resolveEffects(numericTypeID).has(CREATION_ONLINE_EFFECT_ID)) {
        abilities.push("online", "offline");
    }
    // Behavior abilities are advertised only when a server handler is
    // registered for them (see creationAbilityRuntime): the client hard-gates
    // activate_ability on this list, so advertising an unimplemented ability
    // would surface broken buttons instead of a clean rejection.
    const resolveBehaviorAbilities = typeof options.getRegisteredBehaviorAbilities === "function"
        ? options.getRegisteredBehaviorAbilities
        : getRegisteredBehaviorAbilities;
    const resolveBehaviorName = typeof options.getModuleBehaviorName === "function"
        ? options.getModuleBehaviorName
        : getModuleBehaviorName;
    for (const ability of resolveBehaviorAbilities(resolveBehaviorName(numericTypeID))) {
        if (!abilities.includes(ability)) {
            abilities.push(ability);
        }
    }
    const resolveTypeAbilities = typeof options.getRegisteredTypeAbilities === "function"
        ? options.getRegisteredTypeAbilities
        : getRegisteredTypeAbilities;
    for (const ability of resolveTypeAbilities(numericTypeID)) {
        if (!abilities.includes(ability)) {
            abilities.push(ability);
        }
    }
    const resolveChargeGroups = typeof options.getModuleChargeGroupIDs === "function"
        ? options.getModuleChargeGroupIDs
        : getModuleChargeGroupIDs;
    const resolveAbilityHandler = typeof options.resolveCreationAbilityHandler === "function"
        ? options.resolveCreationAbilityHandler
        : resolveCreationAbilityHandler;
    const chargeGroups = resolveChargeGroups(numericTypeID);
    if (chargeGroups && Number(chargeGroups.size) > 0) {
        const behaviorName = resolveBehaviorName(numericTypeID);
        for (const ability of [ABILITY_RELOAD, ABILITY_UNLOAD]) {
            if (!abilities.includes(ability) &&
                resolveAbilityHandler(behaviorName, ability, numericTypeID)) {
                abilities.push(ability);
            }
        }
    }
    return abilities;
}
function buildCreationShipAttributeModifierEntries(moduleItems, options = {}) {
    const resolveAttributes = typeof options.buildEffectiveItemAttributeMap === "function"
        ? options.buildEffectiveItemAttributeMap
        : buildEffectiveItemAttributeMap;
    const resolvePassiveEffects = typeof options.getPassiveModifierEffectRecords === "function"
        ? options.getPassiveModifierEffectRecords
        : getPassiveModifierEffectRecords;
    const appendModifiers = typeof options.appendDirectModifierEntries === "function"
        ? options.appendDirectModifierEntries
        : appendDirectModifierEntries;
    const resolveEffects = typeof options.getTypeDogmaEffects === "function"
        ? options.getTypeDogmaEffects
        : getTypeDogmaEffects;
    const modifierEntries = [];
    const seenItemIDs = new Set();
    for (const item of Array.isArray(moduleItems) ? moduleItems : []) {
        const itemID = toInt(item && item.itemID, 0);
        const typeID = toInt(item && item.typeID, 0);
        if (itemID <= 0 || typeID <= 0 || seenItemIDs.has(itemID)) {
            continue;
        }
        seenItemIDs.add(itemID);
        // Modules with Dogma's online effect are power-controlled Creation
        // modules. None of their ship modifiers (including effects authored as
        // "passive", such as capacitor capacity) may remain applied while the
        // module or the whole Creation is powered off. Modules without effect 16
        // are genuinely passive parts (Fuel Bays are the important example) and
        // continue contributing without an online/offline action.
        if (resolveEffects(typeID).has(CREATION_ONLINE_EFFECT_ID) &&
            !isCreationModuleOnline(item, { getTypeDogmaEffects: resolveEffects })) {
            continue;
        }
        appendModifiers(modifierEntries, resolveAttributes(item), resolvePassiveEffects(typeID), "frontierCreationModule");
    }
    return modifierEntries;
}
function buildCreationIntrinsicShipAttributeModifierEntries(shipItem, moduleItems, options = {}) {
    const resolveAttributes = typeof options.buildEffectiveItemAttributeMap === "function"
        ? options.buildEffectiveItemAttributeMap
        : buildEffectiveItemAttributeMap;
    const applyModifiers = typeof options.applyModifierGroups === "function"
        ? options.applyModifierGroups
        : applyModifierGroups;
    const moduleModifierEntries = Array.isArray(options.moduleModifierEntries)
        ? options.moduleModifierEntries
        : buildCreationShipAttributeModifierEntries(moduleItems, options);
    const attributes = resolveAttributes(shipItem);
    const intrinsicEntries = [];
    // Frontier defines both passive-scan resolution attributes with a Dogma
    // default of 10. Creation hull rows use 0/absence to mean "no sensor", so
    // their first online sensor multiplier otherwise multiplies zero (Gravity)
    // or the generic modifier fallback of one (Ion). Seed the authored default
    // only when an online Creation module actually modifies that channel.
    for (const attributeID of [
        ATTRIBUTE_PASSIVE_SCAN_GRAV_RESOLUTION,
        ATTRIBUTE_PASSIVE_SCAN_EM_RESOLUTION,
    ]) {
        if (toFiniteNumber(attributes && attributes[attributeID], 0) <= 0 &&
            moduleModifierEntries.some((entry) => toInt(entry && entry.modifiedAttributeID, 0) === attributeID)) {
            intrinsicEntries.push({
                modifiedAttributeID: attributeID,
                operation: DOGMA_OP_PRE_ASSIGNMENT,
                value: DEFAULT_PASSIVE_SCAN_RESOLUTION,
                stackingPenalized: false,
            });
        }
    }
    const baseMaxVelocity = toFiniteNumber(attributes && attributes[ATTRIBUTE_MAX_VELOCITY], 0);
    applyModifiers(attributes, moduleModifierEntries);
    const thrust = Math.max(0, toFiniteNumber(attributes && attributes[ATTRIBUTE_THRUST], 0));
    const agility = Math.max(0, toFiniteNumber(attributes && attributes[ATTRIBUTE_AGILITY], 0));
    const maxVelocity = (baseMaxVelocity + thrust) * CREATION_FRICTION_CONSTANT * agility;
    const additiveVelocity = maxVelocity - baseMaxVelocity;
    if (!Number.isFinite(additiveVelocity) || Math.abs(additiveVelocity) < 1.0e-9) {
        return intrinsicEntries;
    }
    // CreationDogmaItem derives subwarp velocity from thrust rather than using
    // the hull's attribute 37 directly: (base + thrust) * 1e-6 * agility.
    // Collapse that client-authored dependency into one additive Dogma entry so
    // normal skill/environment modifiers still run afterward in global order.
    return [...intrinsicEntries, {
            modifiedAttributeID: ATTRIBUTE_MAX_VELOCITY,
            operation: DOGMA_OP_MOD_ADD,
            value: Math.round(additiveVelocity * 1.0e6) / 1.0e6,
            stackingPenalized: false,
        }];
}
function isCreationModuleOnline(item, options = {}) {
    const typeID = toInt(item && item.typeID, 0);
    const resolveEffects = typeof options.getTypeDogmaEffects === "function"
        ? options.getTypeDogmaEffects
        : getTypeDogmaEffects;
    if (typeID <= 0 ||
        !resolveEffects(typeID).has(CREATION_ONLINE_EFFECT_ID)) {
        return false;
    }
    const moduleState = item && item.moduleState;
    if (moduleState &&
        typeof moduleState === "object" &&
        Object.prototype.hasOwnProperty.call(moduleState, "online")) {
        return moduleState.online === true;
    }
    return true;
}
function normalizeCreationState(value, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const templateTypeID = toInt(value.templateTypeID, 0);
    if (templateTypeID <= 0) {
        return null;
    }
    const modules = (Array.isArray(value.modules) ? value.modules : [])
        .map((module) => {
        const typeID = toInt(module && module.typeID, 0);
        return {
            itemID: toInt(module && module.itemID, 0),
            typeID,
            abilities: getCreationModuleAbilities(typeID, options),
        };
    })
        .filter((module) => module.itemID > 0 && module.typeID > 0);
    const interiorPlacements = (Array.isArray(value.interiorPlacements) ? value.interiorPlacements : [])
        .map((placement) => ({
        itemID: toInt(placement && placement.itemID, 0),
        partID: toInt(placement && placement.partID, 0),
        x: toFiniteNumber(placement && placement.x, 0),
        y: toFiniteNumber(placement && placement.y, 0),
        z: toFiniteNumber(placement && placement.z, 0),
        rotation: normalizeRotation(placement && placement.rotation, 3),
    }))
        .filter((placement) => placement.itemID > 0 && placement.partID > 0);
    const hardpoints = (Array.isArray(value.hardpoints) ? value.hardpoints : [])
        .map((hardpoint) => ({
        interiorItemID: toInt(hardpoint && hardpoint.interiorItemID, 0),
        hardpointIndex: Math.max(0, toInt(hardpoint && hardpoint.hardpointIndex, 0)),
        creationID: toInt(hardpoint && hardpoint.creationID, 0),
        partID: toInt(hardpoint && hardpoint.partID, 0),
        x: toFiniteNumber(hardpoint && hardpoint.x, 0),
        y: toFiniteNumber(hardpoint && hardpoint.y, 0),
        z: toFiniteNumber(hardpoint && hardpoint.z, 0),
        rotation: normalizeRotation(hardpoint && hardpoint.rotation, 4),
        attachedItemID: hardpoint && hardpoint.attachedItemID != null
            ? toInt(hardpoint.attachedItemID, 0) || null
            : null,
    }))
        .filter((hardpoint) => hardpoint.interiorItemID > 0 && hardpoint.partID > 0);
    return {
        version: CREATION_STATE_VERSION,
        templateTypeID,
        poweredOff: value.poweredOff === true,
        modules,
        interiorPlacements,
        hardpoints,
    };
}
function readCreationState(item) {
    return normalizeCreationState(parseCustomInfo(item && item.customInfo)[CREATION_STATE_KEY]);
}
function filterCreationModuleInventoryItems(item, inventoryItems = []) {
    const items = Array.isArray(inventoryItems) ? inventoryItems : [];
    const state = readCreationState(item);
    if (!state || !Array.isArray(state.modules)) {
        return items;
    }
    const activeModuleItemIDs = new Set(state.modules
        .map((module) => toInt(module && module.itemID, 0))
        .filter((itemID) => itemID > 0));
    if (activeModuleItemIDs.size === 0) {
        return items;
    }
    return items.filter((inventoryItem) => (toInt(inventoryItem && inventoryItem.flagID, 0) !== CREATION_FITTING_FLAG_ID ||
        activeModuleItemIDs.has(toInt(inventoryItem && inventoryItem.itemID, 0))));
}
function customInfoWithCreationState(item, state) {
    const info = parseCustomInfo(item && item.customInfo);
    info[CREATION_STATE_KEY] = normalizeCreationState(state);
    return JSON.stringify(info);
}
function vector(values, dimensions, fallbackLast = 0) {
    const source = Array.isArray(values) ? values : [];
    return Array.from({ length: dimensions }, (_, index) => toFiniteNumber(source[index], index === dimensions - 1 ? fallbackLast : 0));
}
function buildCreationSeedPlan(template) {
    const plan = [];
    const interiors = Array.isArray(template && template.interior_modules)
        ? template.interior_modules
        : [];
    interiors.forEach((interior, interiorIndex) => {
        plan.push({
            kind: "interior",
            interiorIndex,
            typeID: toInt(interior && interior.type_id, 0),
        });
        (Array.isArray(interior && interior.hardpoints) ? interior.hardpoints : [])
            .forEach((hardpoint, hardpointIndex) => {
            const exteriorTypeID = toInt(hardpoint && hardpoint.exterior_type_id, 0);
            if (exteriorTypeID > 0) {
                plan.push({
                    kind: "exterior",
                    interiorIndex,
                    hardpointIndex,
                    typeID: exteriorTypeID,
                });
            }
        });
    });
    return plan.filter((entry) => entry.typeID > 0);
}
function buildSeededCreationState(template, creationID, plan, createdItems) {
    const interiors = Array.isArray(template && template.interior_modules)
        ? template.interior_modules
        : [];
    const itemForPlan = new Map();
    plan.forEach((entry, index) => itemForPlan.set(entry, createdItems[index] || null));
    const interiorItems = new Map();
    const exteriorItems = new Map();
    plan.forEach((entry) => {
        const item = itemForPlan.get(entry);
        if (!item) {
            return;
        }
        if (entry.kind === "interior") {
            interiorItems.set(entry.interiorIndex, item);
        }
        else {
            exteriorItems.set(`${entry.interiorIndex}:${entry.hardpointIndex}`, item);
        }
    });
    const modules = createdItems.map((item) => ({
        itemID: toInt(item && item.itemID, 0),
        typeID: toInt(item && item.typeID, 0),
        abilities: getCreationModuleAbilities(item && item.typeID),
    })).filter((module) => module.itemID > 0 && module.typeID > 0);
    const interiorPlacements = [];
    const hardpoints = [];
    interiors.forEach((interior, interiorIndex) => {
        const interiorItem = interiorItems.get(interiorIndex);
        if (!interiorItem) {
            return;
        }
        const position = vector(interior.position, 3);
        const rotation = vector(interior.rotation, 3);
        interiorPlacements.push({
            itemID: interiorItem.itemID,
            partID: toInt(interior.part_id, 0),
            x: position[0],
            y: position[1],
            z: position[2],
            rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
        });
        (Array.isArray(interior.hardpoints) ? interior.hardpoints : [])
            .forEach((hardpoint, hardpointIndex) => {
            const hardpointPosition = vector(hardpoint.position, 3);
            const hardpointRotation = vector(hardpoint.rotation, 4, 1);
            const attached = exteriorItems.get(`${interiorIndex}:${hardpointIndex}`);
            hardpoints.push({
                interiorItemID: interiorItem.itemID,
                hardpointIndex,
                creationID,
                partID: toInt(hardpoint.part_id, 0),
                x: hardpointPosition[0],
                y: hardpointPosition[1],
                z: hardpointPosition[2],
                rotation: {
                    x: hardpointRotation[0],
                    y: hardpointRotation[1],
                    z: hardpointRotation[2],
                    w: hardpointRotation[3],
                },
                attachedItemID: attached ? attached.itemID : null,
            });
        });
    });
    return normalizeCreationState({
        version: CREATION_STATE_VERSION,
        templateTypeID: toInt(template && (template.typeID ?? template._key), 0),
        poweredOff: false,
        modules,
        interiorPlacements,
        hardpoints,
    });
}
function reconcileCreationModuleFittingFlags(item, characterID, state) {
    const shipID = toInt(item && item.itemID, 0);
    const ownerID = toInt(characterID, 0);
    const reversals = [];
    const changes = [];
    for (const module of state.modules) {
        const source = findItemById(module.itemID);
        if (!source ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.locationID, 0) !== shipID ||
            toInt(source.typeID, 0) !== module.typeID) {
            continue;
        }
        if (toInt(source.flagID, 0) === CREATION_FITTING_FLAG_ID &&
            toInt(source.singleton, 0) === 1 &&
            toInt(source.stacksize, 1) === 1) {
            continue;
        }
        const result = moveCreationModuleToFitting(source, shipID);
        if (!result.success) {
            rollbackInventoryActions(reversals);
            return result;
        }
        reversals.push(buildInventoryMoveReversal(source, result));
        changes.push(...(result.data.changes || []));
    }
    return { success: true, data: { changes } };
}
function ensureCreationState(item, characterID) {
    const canonicalItem = findItemById(toInt(item && item.itemID, 0)) || item;
    const ownerID = toInt(characterID, 0);
    if (!canonicalItem ||
        ownerID <= 0 ||
        toInt(canonicalItem.ownerID, 0) !== ownerID) {
        return { success: false, errorMsg: "CREATION_ITEM_NOT_OWNED" };
    }
    const template = getCreationTemplate(canonicalItem && canonicalItem.typeID);
    if (!template) {
        return { success: false, errorMsg: "CREATION_TEMPLATE_NOT_FOUND" };
    }
    const existing = readCreationState(canonicalItem);
    if (existing &&
        existing.templateTypeID === toInt(canonicalItem.typeID, 0)) {
        const reconciliation = reconcileCreationModuleFittingFlags(canonicalItem, characterID, existing);
        if (!reconciliation.success) {
            return reconciliation;
        }
        return {
            success: true,
            data: {
                item: canonicalItem,
                state: existing,
                template,
                seeded: false,
                moduleFittingChanges: reconciliation.data.changes,
            },
        };
    }
    const plan = buildCreationSeedPlan(template);
    const grantResult = grantItemsToCharacterLocation(characterID, canonicalItem.itemID, HIDDEN_CREATION_MODULE_FLAG_ID, plan.map((entry) => ({
        itemType: entry.typeID,
        quantity: 1,
        options: { individualItems: true, singleton: 1 },
    })));
    if (!grantResult.success) {
        return grantResult;
    }
    const createdItems = grantResult.data.items || [];
    if (createdItems.length !== plan.length) {
        for (const createdItem of createdItems) {
            removeInventoryItem(createdItem.itemID, { removeContents: true });
        }
        return { success: false, errorMsg: "CREATION_MODULE_SEED_INCOMPLETE" };
    }
    const state = buildSeededCreationState(template, canonicalItem.itemID, plan, createdItems);
    const updateResult = updateShipItem(canonicalItem.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: customInfoWithCreationState(currentItem, state),
    }));
    if (!updateResult.success) {
        for (const createdItem of createdItems) {
            removeInventoryItem(createdItem.itemID, { removeContents: true });
        }
        return updateResult;
    }
    return {
        success: true,
        data: {
            item: updateResult.data,
            state,
            template,
            seeded: true,
            createdItems,
        },
    };
}
function buildDiagnostic(code, change = null, params = {}) {
    return {
        code,
        severity: "blocker",
        moduleItemID: toInt(change && (change.itemID ?? change.interiorItemID ?? change.attachedItemID), 0) || null,
        changeOp: change && change.op ? String(change.op) : null,
        retryAt: null,
        params,
    };
}
function findHardpoint(state, interiorItemID, hardpointIndex) {
    return state.hardpoints.find((hardpoint) => hardpoint.interiorItemID === interiorItemID &&
        hardpoint.hardpointIndex === hardpointIndex);
}
function validateOwnedSourceItem(itemID, typeID, characterID, change) {
    const item = findItemById(itemID);
    if (!item ||
        toInt(item.ownerID, 0) !== characterID ||
        toInt(item.typeID, 0) !== typeID) {
        return { diagnostic: buildDiagnostic("item_unavailable", change), item: null };
    }
    const sourceLocationID = toInt(change && change.sourceLocationID, 0);
    const sourceFlagID = toInt(change && change.sourceFlagID, -1);
    if ((sourceLocationID > 0 && toInt(item.locationID, 0) !== sourceLocationID) ||
        (sourceFlagID >= 0 && toInt(item.flagID, 0) !== sourceFlagID)) {
        return { diagnostic: buildDiagnostic("item_unavailable", change), item: null };
    }
    return { diagnostic: null, item };
}
function validatePart(template, partID) {
    return Boolean(template && template.parts && template.parts[String(partID)]);
}
function validateCreationModuleRemoval(item, change) {
    const industryBlueprints = require(path.join(__dirname, "./industryBlueprints"));
    if (!industryBlueprints.isIndustryFacilityType(toInt(item && item.typeID, 0))) {
        return null;
    }
    const industryProduction = require(path.join(__dirname, "./industryProduction"));
    if (industryProduction.invalidStoredProduction(item)) {
        return buildDiagnostic("invalid_post_commit_state", change, {
            reason: "INDUSTRY_PRODUCTION_STATE_INVALID",
        });
    }
    const production = industryProduction.getProductions(item)
        .find(({ production }) => production && production.state !== "STOPPED");
    if (production) {
        return buildDiagnostic("invalid_post_commit_state", change, {
            reason: "INDUSTRY_JOB_ACTIVE",
            laneID: production.laneID,
            jobID: production.production.jobID,
            state: production.production.state,
        });
    }
    const industryRuntime = require(path.join(__dirname, "./industryRuntime"));
    const inputItems = [];
    const outputItems = [];
    for (let laneID = 1; laneID <= industryRuntime.MAX_INDUSTRY_JOB_LANES; laneID += 1) {
        inputItems.push(...listContainerItems(null, toInt(item && item.itemID, 0), industryRuntime.industryInputFlagForLane(laneID)));
        outputItems.push(...listContainerItems(null, toInt(item && item.itemID, 0), industryRuntime.industryOutputFlagForLane(laneID)));
    }
    if (inputItems.length > 0 || outputItems.length > 0) {
        return buildDiagnostic("invalid_post_commit_state", change, {
            reason: "INDUSTRY_ESCROW_NOT_EMPTY",
            inputItems: inputItems.length,
            outputItems: outputItems.length,
        });
    }
    return null;
}
function resolveCreationFuelCapacity(shipItem, state, characterID) {
    const ownerID = toInt(characterID, 0);
    const poweredOff = state && state.poweredOff === true;
    const moduleItems = (state && Array.isArray(state.modules) ? state.modules : [])
        .map((module) => {
        const source = findItemById(toInt(module && module.itemID, 0));
        if (!source ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.typeID, 0) !== toInt(module && module.typeID, 0)) {
            return null;
        }
        return {
            ...source,
            moduleState: {
                ...(source.moduleState || {}),
                online: toInt(source.typeID, 0) === TYPE_BLACKSTART_CELL
                    ? isCreationModuleOnline(source)
                    : !poweredOff && isCreationModuleOnline(source),
            },
        };
    })
        .filter(Boolean);
    const attributes = buildEffectiveItemAttributeMap(shipItem) || {};
    applyModifierGroups(attributes, buildCreationShipAttributeModifierEntries(moduleItems));
    return Math.max(0, Math.floor(toFiniteNumber(attributes[ATTRIBUTE_FUEL_CAPACITY], 0)));
}
function resolveCreationCapacitorCapacity(state, characterID, options = {}) {
    const ownerID = toInt(characterID, 0);
    const poweredOff = state && state.poweredOff === true;
    const onlineOverrides = options.onlineOverrides instanceof Map
        ? options.onlineOverrides
        : new Map();
    let capacitorCapacity = 0;
    let blackstartCapacity = 0;
    for (const module of state && Array.isArray(state.modules) ? state.modules : []) {
        const source = findItemById(toInt(module && module.itemID, 0));
        if (!source ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.typeID, 0) !== toInt(module && module.typeID, 0)) {
            continue;
        }
        const moduleItemID = toInt(source.itemID, 0);
        const typeID = toInt(source.typeID, 0);
        const authoredOnline = onlineOverrides.has(moduleItemID)
            ? onlineOverrides.get(moduleItemID) === true
            : isCreationModuleOnline(source);
        const effectivelyOnline = typeID === TYPE_BLACKSTART_CELL
            ? authoredOnline
            : authoredOnline && !poweredOff;
        if (!effectivelyOnline) {
            continue;
        }
        const effects = getTypeDogmaEffects(typeID);
        if (!effects.has(EFFECT_CAPACITOR_CAPACITY_ADD_ONLINE) &&
            !effects.has(EFFECT_CAPACITOR_CAPACITY_ADD_PASSIVE)) {
            continue;
        }
        const attributes = buildEffectiveItemAttributeMap(source) || {};
        const contribution = Math.max(0, toFiniteNumber(attributes[ATTRIBUTE_CAPACITOR_CAPACITY], 0));
        capacitorCapacity += contribution;
        if (typeID === TYPE_BLACKSTART_CELL) {
            blackstartCapacity += contribution;
        }
    }
    return {
        blackstartCapacity,
        capacitorCapacity,
    };
}
function transitionBlackstartCapacitorCapacity(shipItem, previousCapacityState, nextCapacityState) {
    const previousBlackstartCapacity = Math.max(0, toFiniteNumber(previousCapacityState && previousCapacityState.blackstartCapacity, 0));
    const nextBlackstartCapacity = Math.max(0, toFiniteNumber(nextCapacityState && nextCapacityState.blackstartCapacity, 0));
    if (previousBlackstartCapacity === nextBlackstartCapacity) {
        return { item: shipItem, lostEnergy: 0 };
    }
    const previousCapacity = Math.max(0, toFiniteNumber(previousCapacityState && previousCapacityState.capacitorCapacity, 0));
    const nextCapacity = Math.max(0, toFiniteNumber(nextCapacityState && nextCapacityState.capacitorCapacity, 0));
    const previousRatio = Math.max(0, Math.min(1, toFiniteNumber(shipItem?.conditionState?.charge, 1)));
    const previousEnergy = previousCapacity * previousRatio;
    // Capacity changes never mint capacitor energy. When a Blackstart Cell is
    // removed or offlined, any charge occupying the removed reserve is lost;
    // otherwise the absolute energy already stored by the remaining banks is
    // preserved instead of being rescaled with the old percentage.
    const nextEnergy = Math.min(previousEnergy, nextCapacity);
    const nextRatio = nextCapacity > 0 ? nextEnergy / nextCapacity : 0;
    return {
        item: {
            ...shipItem,
            conditionState: {
                ...(shipItem && shipItem.conditionState || {}),
                charge: Math.max(0, Math.min(1, nextRatio)),
            },
        },
        lostEnergy: Math.max(0, previousEnergy - nextEnergy),
    };
}
function trimCreationFuelToCapacity(shipItem, fuelCapacity) {
    const previousFuelCharge = getShipFuelCharge(shipItem);
    const nextFuelCharge = Math.min(previousFuelCharge, Math.max(0, toFiniteNumber(fuelCapacity, 0)));
    if (nextFuelCharge >= previousFuelCharge) {
        return { item: shipItem, voidedFuel: 0 };
    }
    const fuelQueue = trimFuelQueueToQuantity(getShipFuelQueue(shipItem), nextFuelCharge);
    const conditionState = {
        ...(shipItem.conditionState || {}),
        fuelCharge: nextFuelCharge,
        fuelQueue,
    };
    delete conditionState.fuelComposition;
    if (fuelQueue.length > 0) {
        conditionState.fuelTypeID = fuelQueue[0].fuelTypeID;
    }
    else {
        delete conditionState.fuelTypeID;
    }
    return {
        item: { ...shipItem, conditionState },
        voidedFuel: previousFuelCharge - nextFuelCharge,
    };
}
function buildPlacement(change) {
    return {
        itemID: toInt(change.itemID, 0),
        partID: toInt(change.partID, 0),
        x: toFiniteNumber(change.x, 0),
        y: toFiniteNumber(change.y, 0),
        z: toFiniteNumber(change.z, 0),
        rotation: {
            x: toFiniteNumber(change.rotationX, 0),
            y: toFiniteNumber(change.rotationY, 0),
            z: toFiniteNumber(change.rotationZ, 0),
        },
    };
}
function buildHardpoint(change, creationID, attachedItemID = null) {
    return {
        interiorItemID: toInt(change.interiorItemID, 0),
        hardpointIndex: Math.max(0, toInt(change.hardpointIndex, 0)),
        creationID,
        partID: toInt(change.partID, 0),
        x: toFiniteNumber(change.x, 0),
        y: toFiniteNumber(change.y, 0),
        z: toFiniteNumber(change.z, 0),
        rotation: {
            x: toFiniteNumber(change.rotationX, 0),
            y: toFiniteNumber(change.rotationY, 0),
            z: toFiniteNumber(change.rotationZ, 0),
            w: toFiniteNumber(change.rotationW, 1),
        },
        attachedItemID,
    };
}
function stageCreationChanges(state, template, creationID, characterID, changes) {
    const next = cloneValue(state);
    const inventoryActions = [];
    for (const rawChange of changes) {
        const change = rawChange && typeof rawChange === "object" ? rawChange : {};
        const op = String(change.op || "").trim().toLowerCase();
        const itemID = toInt(change.itemID, 0);
        const interiorItemID = toInt(change.interiorItemID, 0);
        const attachedItemID = toInt(change.attachedItemID, 0);
        if (op === "add") {
            const typeID = toInt(change.typeID, 0);
            const definition = getCreationModule(typeID);
            const source = validateOwnedSourceItem(itemID, typeID, characterID, change);
            if (!definition ||
                !definition.placement ||
                !definition.placement.occupancy ||
                !validatePart(template, toInt(change.partID, 0)) ||
                source.diagnostic) {
                return {
                    diagnostic: source.diagnostic || buildDiagnostic("invalid_placement", change),
                };
            }
            next.modules = next.modules.filter((module) => module.itemID !== itemID);
            next.modules.push({
                itemID,
                typeID,
                abilities: getCreationModuleAbilities(typeID),
            });
            next.interiorPlacements = next.interiorPlacements
                .filter((placement) => placement.itemID !== itemID);
            next.interiorPlacements.push(buildPlacement(change));
            inventoryActions.push({
                item: source.item,
                locationID: creationID,
                flagID: CREATION_FITTING_FLAG_ID,
                fitToCreation: true,
            });
            continue;
        }
        if (op === "move") {
            const placement = next.interiorPlacements
                .find((entry) => entry.itemID === itemID);
            if (!placement || !validatePart(template, toInt(change.partID, 0))) {
                return { diagnostic: buildDiagnostic("invalid_placement", change) };
            }
            Object.assign(placement, buildPlacement(change));
            continue;
        }
        if (op === "remove") {
            if (!next.modules.some((module) => module.itemID === itemID)) {
                return { diagnostic: buildDiagnostic("item_unavailable", change) };
            }
            const item = findItemById(itemID);
            if (!item || toInt(item.ownerID, 0) !== characterID) {
                return { diagnostic: buildDiagnostic("item_unavailable", change) };
            }
            const removalDiagnostic = validateCreationModuleRemoval(item, change);
            if (removalDiagnostic) {
                return { diagnostic: removalDiagnostic };
            }
            next.modules = next.modules.filter((module) => module.itemID !== itemID);
            next.interiorPlacements = next.interiorPlacements
                .filter((placement) => placement.itemID !== itemID);
            next.hardpoints = next.hardpoints
                .filter((hardpoint) => hardpoint.interiorItemID !== itemID);
            inventoryActions.push({
                item,
                locationID: toPositiveIntOr(change.destLocationID, creationID),
                flagID: toPositiveIntOr(change.destFlagID, ITEM_FLAGS.CARGO_HOLD),
            });
            continue;
        }
        if (op === "place") {
            const interiorModule = next.modules
                .find((module) => module.itemID === interiorItemID);
            const definition = interiorModule && getCreationModule(interiorModule.typeID);
            const hardpointTypes = definition && definition.placement &&
                Array.isArray(definition.placement.hardpoints)
                ? definition.placement.hardpoints
                : [];
            const hardpointIndex = Math.max(0, toInt(change.hardpointIndex, 0));
            if (!interiorModule ||
                !hardpointTypes[hardpointIndex] ||
                !validatePart(template, toInt(change.partID, 0))) {
                return { diagnostic: buildDiagnostic("invalid_placement", change) };
            }
            const existing = findHardpoint(next, interiorItemID, hardpointIndex);
            const replacement = buildHardpoint(change, creationID, existing ? existing.attachedItemID : null);
            if (existing) {
                Object.assign(existing, replacement);
            }
            else {
                next.hardpoints.push(replacement);
            }
            continue;
        }
        if (op === "attach") {
            const typeID = toInt(change.typeID, 0);
            const target = findHardpoint(next, interiorItemID, toInt(change.hardpointIndex, 0));
            const exteriorDefinition = getCreationModule(typeID);
            const interiorModule = next.modules
                .find((module) => module.itemID === interiorItemID);
            const interiorDefinition = interiorModule && getCreationModule(interiorModule.typeID);
            const hardpointType = interiorDefinition && interiorDefinition.placement &&
                Array.isArray(interiorDefinition.placement.hardpoints)
                ? interiorDefinition.placement.hardpoints[toInt(change.hardpointIndex, 0)]
                : null;
            const compatible = exteriorDefinition && exteriorDefinition.placement &&
                Array.isArray(exteriorDefinition.placement.compatible_hardpoints)
                ? exteriorDefinition.placement.compatible_hardpoints
                : [];
            const source = validateOwnedSourceItem(attachedItemID, typeID, characterID, change);
            if (!target || !hardpointType || !compatible.includes(hardpointType) || source.diagnostic) {
                return {
                    diagnostic: source.diagnostic || buildDiagnostic("invalid_placement", change),
                };
            }
            target.attachedItemID = attachedItemID;
            next.modules = next.modules.filter((module) => module.itemID !== attachedItemID);
            next.modules.push({
                itemID: attachedItemID,
                typeID,
                abilities: getCreationModuleAbilities(typeID),
            });
            inventoryActions.push({
                item: source.item,
                locationID: creationID,
                flagID: CREATION_FITTING_FLAG_ID,
                fitToCreation: true,
            });
            continue;
        }
        if (op === "detach") {
            const target = next.hardpoints
                .find((hardpoint) => hardpoint.attachedItemID === attachedItemID);
            const item = findItemById(attachedItemID);
            if (!target || !item || toInt(item.ownerID, 0) !== characterID) {
                return { diagnostic: buildDiagnostic("item_unavailable", change) };
            }
            target.attachedItemID = null;
            next.modules = next.modules.filter((module) => module.itemID !== attachedItemID);
            inventoryActions.push({
                item,
                locationID: toPositiveIntOr(change.destLocationID, creationID),
                flagID: toPositiveIntOr(change.destFlagID, ITEM_FLAGS.CARGO_HOLD),
            });
            continue;
        }
        if (op === "move_attach") {
            const source = next.hardpoints
                .find((hardpoint) => hardpoint.attachedItemID === attachedItemID);
            const target = findHardpoint(next, interiorItemID, toInt(change.hardpointIndex, 0));
            if (!source || !target) {
                return { diagnostic: buildDiagnostic("invalid_placement", change) };
            }
            source.attachedItemID = null;
            target.attachedItemID = attachedItemID;
            continue;
        }
        return { diagnostic: buildDiagnostic("invalid_post_commit_state", change) };
    }
    return {
        state: normalizeCreationState(next),
        inventoryActions,
        diagnostic: null,
    };
}
function moveCreationModuleToFitting(sourceItem, creationID) {
    const sourceFlagID = toInt(sourceItem && sourceItem.flagID, 0);
    const repairingLegacyFittedStack = sourceFlagID === CREATION_FITTING_FLAG_ID;
    return moveItemToLocation(sourceItem && sourceItem.itemID, creationID, CREATION_FITTING_FLAG_ID, 1, {
        affectsFitting: true,
        preserveMovedItemID: true,
        treatDestinationAsFitting: true,
        ...(repairingLegacyFittedStack
            ? {
                remainderLocationID: creationID,
                remainderFlagID: ITEM_FLAGS.CARGO_HOLD,
            }
            : {}),
    });
}
function buildInventoryMoveReversal(sourceItem, moveResult) {
    const sourceItemID = toInt(sourceItem && sourceItem.itemID, 0);
    const explicitCreatedItemIDs = moveResult && moveResult.data && Array.isArray(moveResult.data.createdItemIDs)
        ? moveResult.data.createdItemIDs
        : [];
    const inferredCreatedItemIDs = (moveResult && moveResult.data && Array.isArray(moveResult.data.changes)
        ? moveResult.data.changes
        : [])
        .map((change) => toInt(change && change.item && change.item.itemID, 0))
        .filter((itemID) => itemID > 0 && itemID !== sourceItemID);
    return {
        sourceItem: cloneValue(sourceItem),
        createdItemIDs: [...new Set([
                ...explicitCreatedItemIDs.map((itemID) => toInt(itemID, 0)),
                ...inferredCreatedItemIDs,
            ].filter((itemID) => itemID > 0 && itemID !== sourceItemID))],
    };
}
function rollbackInventoryActions(reversals) {
    for (const reversal of [...reversals].reverse()) {
        for (const itemID of reversal.createdItemIDs || []) {
            removeInventoryItem(itemID, { removeContents: true });
        }
        if (reversal.sourceItem && reversal.sourceItem.itemID) {
            updateInventoryItem(reversal.sourceItem.itemID, () => cloneValue(reversal.sourceItem));
        }
    }
}
function syncInventoryChangesForSession(session, changes) {
    for (const change of Array.isArray(changes) ? changes : []) {
        if (!change || !change.item) {
            continue;
        }
        const previousState = change.previousData || change.previousState || {};
        const installedCreationModule = toInt(change.item.flagID, 0) === CREATION_FITTING_FLAG_ID &&
            (toInt(previousState.locationID, 0) !== toInt(change.item.locationID, 0) ||
                toInt(previousState.flagID, -1) !== CREATION_FITTING_FLAG_ID);
        if (installedCreationModule &&
            session &&
            typeof session.sendNotification === "function") {
            const now = session._space && typeof session._space.simFileTime === "bigint"
                ? session._space.simFileTime
                : currentFileTime();
            session.sendNotification("OnGodmaPrimeItem", "clientID", [
                toInt(change.item.locationID, 0),
                buildInventoryDogmaPrimeEntry(change.item, {
                    description: "creation module",
                    includeTypeAttributes: true,
                    now,
                    compatibilityProfile: session.compatibilityProfile,
                }),
            ]);
        }
        syncInventoryItemForSession(session, change.item, previousState, { emitCfgLocation: true });
        if (installedCreationModule && isCreationModuleOnline(change.item)) {
            syncModuleOnlineEffectForSession(session, change.item, { active: true });
        }
    }
}
function remapCreationStateItemIDs(state, itemIDMap) {
    const resolveItemID = (value) => {
        const itemID = toInt(value, 0);
        return itemIDMap instanceof Map && itemIDMap.has(itemID)
            ? toInt(itemIDMap.get(itemID), itemID)
            : itemID;
    };
    return normalizeCreationState({
        ...cloneValue(state),
        modules: (state.modules || []).map((module) => ({
            ...module,
            itemID: resolveItemID(module.itemID),
        })),
        interiorPlacements: (state.interiorPlacements || []).map((placement) => ({
            ...placement,
            itemID: resolveItemID(placement.itemID),
        })),
        hardpoints: (state.hardpoints || []).map((hardpoint) => ({
            ...hardpoint,
            interiorItemID: resolveItemID(hardpoint.interiorItemID),
            attachedItemID: hardpoint.attachedItemID == null
                ? null
                : resolveItemID(hardpoint.attachedItemID),
        })),
    });
}
function commitCreationStateTransition(item, characterID, ensured, nextState, inventoryActions, session, event = {}) {
    const capacityItemIDMap = new Map();
    for (const action of Array.isArray(inventoryActions) ? inventoryActions : []) {
        capacityItemIDMap.set(toInt(action.stateItemID, toInt(action.item && action.item.itemID, 0)), toInt(action.item && action.item.itemID, 0));
    }
    const nextCapacityState = remapCreationStateItemIDs(nextState, capacityItemIDMap) || nextState;
    const previousFuelCapacity = resolveCreationFuelCapacity(ensured.data.item, ensured.data.state, characterID);
    const nextFuelCapacity = resolveCreationFuelCapacity(ensured.data.item, nextCapacityState, characterID);
    const previousCapacitorCapacity = resolveCreationCapacitorCapacity(ensured.data.state, characterID);
    const nextCapacitorCapacity = resolveCreationCapacitorCapacity(nextCapacityState, characterID);
    const fuelCapacityDecreased = nextFuelCapacity < previousFuelCapacity;
    let voidedFuel = 0;
    let voidedBlackstartEnergy = 0;
    const moveRequests = [];
    const moveStateItemIDs = [];
    const resolvedStateItemIDs = new Map();
    for (const action of Array.isArray(inventoryActions) ? inventoryActions : []) {
        const currentSource = findItemById(action.item.itemID) || action.item;
        const stateItemID = toInt(action.stateItemID, toInt(currentSource.itemID, 0));
        if (toInt(currentSource.locationID, 0) === action.locationID &&
            toInt(currentSource.flagID, 0) === action.flagID &&
            (action.fitToCreation !== true ||
                (toInt(currentSource.singleton, 0) === 1 &&
                    toInt(currentSource.stacksize, 1) === 1))) {
            resolvedStateItemIDs.set(stateItemID, toInt(currentSource.itemID, 0));
            continue;
        }
        if (!currentSource || toInt(currentSource.itemID, 0) <= 0) {
            return {
                success: false,
                diagnostics: [buildDiagnostic("item_unavailable", null, {
                        reason: "ITEM_NOT_FOUND",
                    })],
            };
        }
        if (action.fitToCreation === true) {
            const repairingLegacyFittedStack = toInt(currentSource.flagID, 0) === CREATION_FITTING_FLAG_ID;
            moveRequests.push({
                itemID: currentSource.itemID,
                destinationLocationID: action.locationID,
                destinationFlagID: CREATION_FITTING_FLAG_ID,
                quantity: 1,
                options: {
                    affectsFitting: true,
                    preserveMovedItemID: action.preserveMovedItemID !== false,
                    treatDestinationAsFitting: true,
                    updateMovedItem(movedItem) {
                        if (!getTypeDogmaEffects(toInt(movedItem && movedItem.typeID, 0))
                            .has(CREATION_ONLINE_EFFECT_ID)) {
                            return movedItem;
                        }
                        return {
                            ...movedItem,
                            moduleState: {
                                ...(movedItem.moduleState || {}),
                                online: true,
                            },
                        };
                    },
                    ...(repairingLegacyFittedStack
                        ? {
                            remainderLocationID: action.locationID,
                            remainderFlagID: ITEM_FLAGS.CARGO_HOLD,
                        }
                        : {}),
                },
            });
            moveStateItemIDs.push(stateItemID);
        }
        else {
            const voidSealedFuel = toInt(currentSource.typeID, 0) === TYPE_FUEL_BLISTER
                ? {
                    updateMovedItem(movedItem) {
                        return {
                            ...movedItem,
                            moduleState: {
                                ...(movedItem.moduleState || {}),
                                reserveFuelCharge: 0,
                                reserveFuelQueue: [],
                            },
                        };
                    },
                }
                : {};
            moveRequests.push({
                itemID: currentSource.itemID,
                destinationLocationID: action.locationID,
                destinationFlagID: action.flagID,
                options: { affectsFitting: true, ...voidSealedFuel },
            });
            moveStateItemIDs.push(stateItemID);
        }
    }
    let committedState = nextState;
    const commitResult = moveItemsToLocationsAndUpdateItem(moveRequests, item.itemID, (currentItem, transaction) => {
        const moves = transaction && Array.isArray(transaction.moves)
            ? transaction.moves
            : [];
        moves.forEach((move, index) => {
            const stateItemID = moveStateItemIDs[index];
            const movedItemID = toInt(move && move.movedItemID, 0);
            if (stateItemID > 0 && movedItemID > 0) {
                resolvedStateItemIDs.set(stateItemID, movedItemID);
            }
        });
        committedState = remapCreationStateItemIDs(nextState, resolvedStateItemIDs) || nextState;
        const fuelResult = fuelCapacityDecreased
            ? trimCreationFuelToCapacity(currentItem, nextFuelCapacity)
            : { item: currentItem, voidedFuel: 0 };
        voidedFuel = fuelResult.voidedFuel;
        const capacitorResult = transitionBlackstartCapacitorCapacity(fuelResult.item, previousCapacitorCapacity, nextCapacitorCapacity);
        voidedBlackstartEnergy = capacitorResult.lostEnergy;
        return {
            ...capacitorResult.item,
            customInfo: customInfoWithCreationState(capacitorResult.item, committedState),
        };
    }, {
        expectedCategoryID: SHIP_CATEGORY_ID,
        flush: true,
    });
    if (!commitResult.success) {
        return {
            success: false,
            diagnostics: [buildDiagnostic("invalid_post_commit_state", null, {
                    reason: commitResult.errorMsg || "CREATION_STATE_WRITE_FAILED",
                })],
        };
    }
    syncInventoryChangesForSession(session, commitResult.data.changes);
    notifyCreationStateChanged({
        reason: String(event.reason || "draft_commit"),
        session,
        characterID,
        creationID: toInt(item && item.itemID, 0),
        item: commitResult.data.item,
        previousState: ensured.data.state,
        state: committedState,
        ...event,
    });
    return {
        success: true,
        diagnostics: [],
        data: {
            item: commitResult.data.item,
            state: committedState,
            template: ensured.data.template,
            previousFuelCapacity,
            nextFuelCapacity,
            previousCapacitorCapacity,
            nextCapacitorCapacity,
            voidedFuel,
            voidedBlackstartEnergy,
        },
    };
}
function commitResolvedCreationState(item, characterID, rawState, session = null, options = {}) {
    const ensured = ensureCreationState(item, characterID);
    if (!ensured.success) {
        return {
            success: false,
            diagnostics: [buildDiagnostic("invalid_post_commit_state", null, {
                    reason: ensured.errorMsg || "CREATION_STATE_UNAVAILABLE",
                })],
        };
    }
    const rawModuleSources = new Map((rawState && Array.isArray(rawState.modules) ? rawState.modules : [])
        .map((module) => [
        toInt(module && module.itemID, 0),
        toInt(module && module.sourceItemID, toInt(module && module.itemID, 0)),
    ]));
    const optionModuleSources = options.moduleSources &&
        typeof options.moduleSources === "object"
        ? options.moduleSources
        : {};
    const nextState = normalizeCreationState(rawState);
    if (!nextState || nextState.templateTypeID !== toInt(item && item.typeID, 0)) {
        return {
            success: false,
            diagnostics: [buildDiagnostic("invalid_post_commit_state", null, {
                    reason: "CREATION_TEMPLATE_MISMATCH",
                })],
        };
    }
    const layoutDiagnostics = validateCreationLayout(nextState, ensured.data.template);
    if (layoutDiagnostics.length > 0) {
        return { success: false, diagnostics: layoutDiagnostics };
    }
    const ownerID = toInt(characterID, 0);
    const creationID = toInt(item && item.itemID, 0);
    const nextModuleIDs = new Set();
    const retainedCurrentModuleIDs = new Set();
    const sourceUseCounts = new Map();
    const inventoryActions = [];
    for (const module of nextState.modules) {
        const moduleItemID = toInt(module && module.itemID, 0);
        const sourceItemID = toInt(optionModuleSources[String(moduleItemID)] ??
            optionModuleSources[moduleItemID] ??
            rawModuleSources.get(moduleItemID), moduleItemID);
        const source = findItemById(sourceItemID);
        const nextSourceUseCount = (sourceUseCounts.get(sourceItemID) || 0) + 1;
        const availableQuantity = source && toInt(source.singleton, 0) === 1
            ? 1
            : Math.max(1, toInt(source && (source.stacksize ?? source.quantity), 1));
        if (!source ||
            nextModuleIDs.has(moduleItemID) ||
            nextSourceUseCount > availableQuantity ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.locationID, 0) !== creationID ||
            toInt(source.typeID, 0) !== toInt(module && module.typeID, 0) ||
            ![ITEM_FLAGS.CARGO_HOLD, CREATION_FITTING_FLAG_ID].includes(toInt(source.flagID, -1))) {
            return {
                success: false,
                diagnostics: [buildDiagnostic("item_unavailable", { itemID: moduleItemID }, {
                        reason: "PRESET_MODULE_UNAVAILABLE",
                    })],
            };
        }
        nextModuleIDs.add(moduleItemID);
        sourceUseCounts.set(sourceItemID, nextSourceUseCount);
        if (toInt(source.flagID, -1) === CREATION_FITTING_FLAG_ID) {
            retainedCurrentModuleIDs.add(sourceItemID);
        }
        inventoryActions.push({
            item: source,
            stateItemID: moduleItemID,
            locationID: creationID,
            flagID: CREATION_FITTING_FLAG_ID,
            fitToCreation: true,
            preserveMovedItemID: sourceItemID === moduleItemID,
        });
    }
    for (const currentModule of ensured.data.state.modules) {
        const moduleItemID = toInt(currentModule && currentModule.itemID, 0);
        if (nextModuleIDs.has(moduleItemID) || retainedCurrentModuleIDs.has(moduleItemID)) {
            continue;
        }
        const source = findItemById(moduleItemID);
        if (!source || toInt(source.ownerID, 0) !== ownerID) {
            return {
                success: false,
                diagnostics: [buildDiagnostic("item_unavailable", { itemID: moduleItemID })],
            };
        }
        const removalDiagnostic = validateCreationModuleRemoval(source, {
            op: "remove",
            itemID: moduleItemID,
        });
        if (removalDiagnostic) {
            return { success: false, diagnostics: [removalDiagnostic] };
        }
        inventoryActions.push({
            item: source,
            locationID: creationID,
            flagID: ITEM_FLAGS.CARGO_HOLD,
        });
    }
    return commitCreationStateTransition(item, characterID, ensured, nextState, inventoryActions, session, {
        reason: String(options.reason || "resolved_state_commit"),
        presetID: options.presetID || null,
    });
}
function commitCreationDraft(item, characterID, rawChanges, session) {
    const ensured = ensureCreationState(item, characterID);
    if (!ensured.success) {
        return {
            success: false,
            diagnostics: [buildDiagnostic("invalid_post_commit_state", null, {
                    reason: ensured.errorMsg || "CREATION_STATE_UNAVAILABLE",
                })],
        };
    }
    const changes = Array.isArray(rawChanges) ? rawChanges : [];
    const staged = stageCreationChanges(ensured.data.state, ensured.data.template, item.itemID, characterID, changes);
    if (staged.diagnostic) {
        return { success: false, diagnostics: [staged.diagnostic] };
    }
    const layoutDiagnostics = validateCreationLayout(staged.state, ensured.data.template);
    if (layoutDiagnostics.length > 0) {
        return { success: false, diagnostics: layoutDiagnostics };
    }
    return commitCreationStateTransition(item, characterID, ensured, staged.state, staged.inventoryActions, session, { reason: "draft_commit", changes });
}
function setCreationPowerState(item, characterID, poweredOff, session = null) {
    const ensured = ensureCreationState(item, characterID);
    if (!ensured.success) {
        return ensured;
    }
    const state = { ...ensured.data.state, poweredOff: poweredOff === true };
    const updateResult = updateShipItem(item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: customInfoWithCreationState(currentItem, state),
    }));
    if (!updateResult.success) {
        return updateResult;
    }
    if (ensured.data.state.poweredOff !== state.poweredOff) {
        notifyCreationStateChanged({
            reason: "power_state",
            session,
            characterID,
            creationID: toInt(item && item.itemID, 0),
            item: updateResult.data,
            previousState: ensured.data.state,
            state,
        });
    }
    return { success: true, data: { item: updateResult.data, state } };
}
function splitFuelQueueTail(fuelQueue, quantity) {
    const remainingQueue = normalizeFuelQueue(fuelQueue).map((entry) => ({ ...entry }));
    const extractedReversed = [];
    let remaining = Math.max(0, toFiniteNumber(quantity, 0));
    while (remaining > 1.0e-9 && remainingQueue.length > 0) {
        const tail = remainingQueue[remainingQueue.length - 1];
        const take = Math.min(remaining, tail.quantity);
        extractedReversed.push({
            fuelTypeID: tail.fuelTypeID,
            quantity: take,
            reserve: true,
        });
        tail.quantity -= take;
        remaining -= take;
        if (tail.quantity <= 1.0e-9) {
            remainingQueue.pop();
        }
    }
    return {
        remainingQueue: normalizeFuelQueue(remainingQueue),
        extractedQueue: normalizeFuelQueue(extractedReversed.reverse()),
    };
}
function getFuelQueueQuantityLocal(fuelQueue) {
    return normalizeFuelQueue(fuelQueue).reduce((total, entry) => total + Math.max(0, toFiniteNumber(entry.quantity, 0)), 0);
}
function stageFuelBlisterTransition(shipItem, creationState, characterID, moduleItem, nextOnline) {
    if (toInt(moduleItem && moduleItem.typeID, 0) !== TYPE_FUEL_BLISTER) {
        return { success: true, shipItem, moduleStatePatch: {} };
    }
    const moduleAttributes = buildEffectiveItemAttributeMap(moduleItem) || {};
    const moduleCapacity = Math.max(0, toFiniteNumber(moduleAttributes[ATTRIBUTE_FUEL_CAPACITY], 0));
    // Fuel Blister capacity is authored as FuelCapacityAdd (5679), not the
    // ship's resulting fuelCapacity attribute (5633).
    const blisterCapacity = Math.max(moduleCapacity, toFiniteNumber(moduleAttributes[5679], 0));
    if (blisterCapacity <= 0) {
        return { success: true, shipItem, moduleStatePatch: {} };
    }
    const currentQueue = getShipFuelQueue(shipItem);
    if (nextOnline) {
        const storedQueue = normalizeFuelQueue(moduleItem.moduleState && moduleItem.moduleState.reserveFuelQueue).map((entry) => ({ ...entry, reserve: true }));
        if (storedQueue.length === 0) {
            return {
                success: true,
                shipItem,
                moduleStatePatch: { reserveFuelCharge: 0, reserveFuelQueue: [] },
            };
        }
        const nextQueue = normalizeFuelQueue([
            ...currentQueue,
            ...storedQueue,
        ]);
        return {
            success: true,
            shipItem: {
                ...shipItem,
                conditionState: {
                    ...(shipItem.conditionState || {}),
                    fuelCharge: getFuelQueueQuantityLocal(nextQueue),
                    fuelQueue: nextQueue,
                    fuelTypeID: nextQueue[0] ? nextQueue[0].fuelTypeID : 0,
                },
            },
            moduleStatePatch: { reserveFuelCharge: 0, reserveFuelQueue: [] },
        };
    }
    const currentCapacity = resolveCreationFuelCapacity(shipItem, creationState, characterID);
    const fuelTank = resolveShipFuelTank(shipItem, currentCapacity);
    const totalReserveCapacity = resolveCreationReserveFuelCapacity(shipItem, fuelTank);
    const partitioned = partitionFuelQueueByReserveCapacity(currentQueue, currentCapacity, totalReserveCapacity);
    const reserveQuantity = partitioned
        .filter((entry) => entry.reserve === true)
        .reduce((total, entry) => total + entry.quantity, 0);
    const split = splitFuelQueueTail(partitioned, Math.min(blisterCapacity, reserveQuantity));
    const nextQueue = split.remainingQueue;
    return {
        success: true,
        shipItem: {
            ...shipItem,
            conditionState: {
                ...(shipItem.conditionState || {}),
                fuelCharge: getFuelQueueQuantityLocal(nextQueue),
                fuelQueue: nextQueue,
                fuelTypeID: nextQueue[0] ? nextQueue[0].fuelTypeID : 0,
            },
        },
        moduleStatePatch: {
            reserveFuelCharge: getFuelQueueQuantityLocal(split.extractedQueue),
            reserveFuelQueue: split.extractedQueue,
        },
    };
}
function getCreationDogmaContext(item, characterID) {
    const ensured = ensureCreationState(item, characterID);
    if (!ensured.success) {
        return ensured;
    }
    const shipID = toInt(ensured.data.item && ensured.data.item.itemID, 0);
    const ownerID = toInt(characterID, 0);
    const poweredOff = ensured.data.state.poweredOff === true;
    const moduleItems = ensured.data.state.modules
        .map((module) => {
        const source = findItemById(module.itemID);
        if (!source ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.locationID, 0) !== shipID ||
            toInt(source.typeID, 0) !== module.typeID) {
            return null;
        }
        return {
            ...source,
            moduleState: {
                ...(source.moduleState || {}),
                online: toInt(source.typeID, 0) === TYPE_BLACKSTART_CELL
                    ? isCreationModuleOnline(source)
                    : !poweredOff && isCreationModuleOnline(source),
            },
        };
    })
        .filter(Boolean);
    const moduleModifierEntries = buildCreationShipAttributeModifierEntries(moduleItems);
    return {
        success: true,
        data: {
            ...ensured.data,
            moduleItems,
            shipAttributeModifierEntries: [
                ...moduleModifierEntries,
                ...buildCreationIntrinsicShipAttributeModifierEntries(ensured.data.item, moduleItems, { moduleModifierEntries }),
            ],
        },
    };
}
function getCreationStateCapacities(item, characterID, rawState) {
    const sourceItemIDs = new Map((rawState && Array.isArray(rawState.modules) ? rawState.modules : [])
        .map((module) => [
        toInt(module && module.itemID, 0),
        toInt(module && module.sourceItemID, toInt(module && module.itemID, 0)),
    ]));
    const state = normalizeCreationState(rawState);
    if (!state) {
        return null;
    }
    const shipItem = findItemById(toInt(item && item.itemID, 0)) || item;
    const shipID = toInt(shipItem && shipItem.itemID, 0);
    const ownerID = toInt(characterID, 0);
    const poweredOff = state.poweredOff === true;
    const moduleItems = state.modules.map((module) => {
        const source = findItemById(sourceItemIDs.get(toInt(module.itemID, 0)) || module.itemID);
        if (!source ||
            toInt(source.ownerID, 0) !== ownerID ||
            toInt(source.locationID, 0) !== shipID ||
            toInt(source.typeID, 0) !== module.typeID) {
            return null;
        }
        return {
            ...source,
            moduleState: {
                ...(source.moduleState || {}),
                online: toInt(source.typeID, 0) === TYPE_BLACKSTART_CELL
                    ? isCreationModuleOnline(source)
                    : !poweredOff && isCreationModuleOnline(source),
            },
        };
    }).filter(Boolean);
    const moduleModifierEntries = buildCreationShipAttributeModifierEntries(moduleItems);
    const resourceState = buildShipResourceState(ownerID, shipItem, {
        additionalAttributeModifierEntries: [
            ...moduleModifierEntries,
            ...buildCreationIntrinsicShipAttributeModifierEntries(shipItem, moduleItems, { moduleModifierEntries }),
        ],
    });
    return {
        cargoCapacity: Math.max(0, toFiniteNumber(resourceState && resourceState.cargoCapacity, 0)),
        capacitorCapacity: resolveCreationCapacitorCapacity(state, ownerID),
        fuelCapacity: resolveCreationFuelCapacity(shipItem, state, ownerID),
    };
}
function setCreationModuleOnlineState(item, characterID, moduleItemID, online, session = null) {
    const ensured = ensureCreationState(item, characterID);
    if (!ensured.success) {
        return ensured;
    }
    syncInventoryChangesForSession(session, ensured.data && ensured.data.moduleFittingChanges);
    const numericModuleItemID = toInt(moduleItemID, 0);
    const module = ensured.data.state.modules
        .find((entry) => entry.itemID === numericModuleItemID);
    const moduleItem = module ? findItemById(numericModuleItemID) : null;
    if (!module ||
        !moduleItem ||
        toInt(moduleItem.ownerID, 0) !== toInt(characterID, 0) ||
        toInt(moduleItem.locationID, 0) !== toInt(item && item.itemID, 0) ||
        getCreationModuleAbilities(module.typeID).length === 0) {
        return { success: false, errorMsg: "CREATION_MODULE_ABILITY_NOT_FOUND" };
    }
    const previousOnline = isCreationModuleOnline(moduleItem);
    const nextOnline = online === true;
    const previousCapacitorCapacity = resolveCreationCapacitorCapacity(ensured.data.state, characterID, { onlineOverrides: new Map([[numericModuleItemID, previousOnline]]) });
    const nextCapacitorCapacity = resolveCreationCapacitorCapacity(ensured.data.state, characterID, { onlineOverrides: new Map([[numericModuleItemID, nextOnline]]) });
    const fuelTransition = previousOnline !== nextOnline
        ? stageFuelBlisterTransition(ensured.data.item, ensured.data.state, characterID, moduleItem, nextOnline)
        : { success: true, shipItem: ensured.data.item, moduleStatePatch: {} };
    const capacitorTransition = transitionBlackstartCapacitorCapacity(fuelTransition.shipItem, previousCapacitorCapacity, nextCapacitorCapacity);
    const transitionedShipItem = capacitorTransition.item;
    const shipFuelChanged = fuelTransition.shipItem !== ensured.data.item;
    const shipCapacitorChanged = transitionedShipItem !== fuelTransition.shipItem;
    const shipStateChanged = shipFuelChanged || shipCapacitorChanged;
    let shipFuelUpdate = null;
    if (shipStateChanged) {
        shipFuelUpdate = updateShipItem(item.itemID, transitionedShipItem);
        if (!shipFuelUpdate.success) {
            return shipFuelUpdate;
        }
    }
    const updateResult = updateInventoryItem(numericModuleItemID, (currentItem) => ({
        ...currentItem,
        moduleState: {
            ...(currentItem.moduleState || {}),
            ...(fuelTransition.moduleStatePatch || {}),
            online: nextOnline,
        },
    }));
    if (!updateResult.success) {
        if (shipStateChanged) {
            updateShipItem(item.itemID, ensured.data.item);
        }
        return updateResult;
    }
    const serverTime = (session &&
        session._space &&
        typeof session._space.simFileTime === "bigint") ? session._space.simFileTime : currentFileTime();
    if (previousOnline !== nextOnline) {
        const subEvents = [];
        const isOnlineAttributeID = getAttributeIDByNames("isOnline") || 1153;
        subEvents.push(buildModuleAttributeChangeEvent(characterID, numericModuleItemID, isOnlineAttributeID, nextOnline ? 1 : 0, previousOnline ? 1 : 0, serverTime));
        subEvents.push(buildGodmaShipEffectEvent(numericModuleItemID, characterID, item.itemID, CREATION_ONLINE_EFFECT_ID, serverTime, {
            isStart: nextOnline ? 1 : 0,
            shouldStart: nextOnline ? 1 : 0,
        }));
        if (toInt(moduleItem.typeID, 0) === TYPE_FUEL_BLISTER) {
            subEvents.push(buildModuleAttributeChangeEvent(characterID, numericModuleItemID, ATTRIBUTE_RESERVE_FUEL_CHARGE, toFiniteNumber(fuelTransition.moduleStatePatch &&
                fuelTransition.moduleStatePatch.reserveFuelCharge, toFiniteNumber(moduleItem.moduleState && moduleItem.moduleState.reserveFuelCharge, 0)), toFiniteNumber(moduleItem.moduleState && moduleItem.moduleState.reserveFuelCharge, 0), serverTime));
        }
        sendOnMultiEvent(session, subEvents, serverTime);
        notifyCreationStateChanged({
            reason: "module_online_state",
            session,
            characterID,
            creationID: toInt(item && item.itemID, 0),
            item: transitionedShipItem,
            moduleItemID: numericModuleItemID,
            moduleTypeID: toInt(moduleItem && moduleItem.typeID, 0),
            previousOnline,
            nextOnline,
        });
    }
    return {
        success: true,
        data: {
            item: updateResult.data,
            previousOnline,
            nextOnline,
            voidedBlackstartEnergy: capacitorTransition.lostEnergy,
            serverTime,
        },
    };
}
module.exports = {
    _notifyCreationStateChangedForTests: notifyCreationStateChanged,
    CREATION_FITTING_FLAG_ID,
    CREATION_ONLINE_EFFECT_ID,
    CREATION_STATE_KEY,
    CREATION_STATE_VERSION,
    HIDDEN_CREATION_MODULE_FLAG_ID,
    buildCreationSeedPlan,
    buildSeededCreationState,
    buildCreationIntrinsicShipAttributeModifierEntries,
    buildCreationShipAttributeModifierEntries,
    commitCreationDraft,
    commitResolvedCreationState,
    ensureCreationState,
    filterCreationModuleInventoryItems,
    getCreationDogmaContext,
    getCreationStateCapacities,
    getCreationModuleAbilities,
    isCreationModuleOnline,
    normalizeCreationState,
    readCreationState,
    subscribeCreationStateChanges,
    setCreationModuleOnlineState,
    setCreationPowerState,
    stageCreationChanges,
    validateCreationModuleRemoval,
};
//# sourceMappingURL=creationRuntime.js.map