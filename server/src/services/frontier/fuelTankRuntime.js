"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Frontier ship fuel tank runtime.
 *
 * Client contract (staged build 3450341 bytecode evidence):
 *   dogmaIM.LoadFuel(shipID, fuelTypeID, quantity, fuelItems=None, locationID=None)
 * - `clientDogmaLocation.LoadFuelToModules` forwards the five arguments and
 *   discards the return value, so the RPC returns None.
 * - HUD/station "Fuel Tank" widgets call it with the last two arguments None;
 *   `fittingSlotController.FitFuel`/`tryFit.TryFitFuel` pass the dragged
 *   inventory rows grouped by (typeID, locationID) with quantity = summed
 *   stack sizes.
 * - The tank level is the ship Dogma attribute `fuelCharge` (5635) against
 *   `fuelCapacity` (5633); both widgets poll the godma ship item, so a plain
 *   attribute-change notification refreshes the numerator. Loading consumes
 *   the source stacks outright — the client ships no fuel-unload RPC.
 * - `frontier.fuel.static_data` treats a type as fuel when its group is in
 *   inventorycommon.const.fuelGroups = [4738 crude fuel, 4598 corvette fuel].
 * - The client offers fuel from ship cargo (flag 5), the specialized fuel bay
 *   (flag 133), and — while docked — the hangar of the current station.
 *
 * Server model: the loaded amount persists as
 * `shipItem.conditionState.fuelCharge`, an absolute unit count (units, not
 * m3: the widget prints "<n> / <capacity> units"). `fuelQueue` records each
 * loaded batch in first-in-first-out order. The head batch supplies the
 * ship's active fuel properties and is consumed before later batches. Legacy
 * saves with only `fuelTypeID`, and pre-FIFO `fuelComposition` saves, remain
 * supported.
 * Regular ships author the capacity directly as Dogma attribute 5633 and
 * require a fitted engine whose group determines the accepted fuel group.
 * Creation ships derive capacity from FuelCapacityAdd modifiers supplied by
 * fitted fuel-storage modules and may mix every supported fuel group.
 */
const path = require("path");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const { getTypeDogmaAttributes } = require(path.join(__dirname, "../fitting/liveFittingState"));
const { getCreationTemplate } = require(path.join(__dirname, "./creationStaticData"));
const ATTRIBUTE_FUEL_EFFICIENCY = 5607;
const ATTRIBUTE_FUEL_CAPACITY = 5633;
const ATTRIBUTE_FUEL_RATE = 5634;
const ATTRIBUTE_FUEL_CHARGE = 5635;
const ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY = 6123;
const ATTRIBUTE_FUEL_CONTAINMENT_BURDEN = 6124;
const ATTRIBUTE_FUEL_VOLATILITY = 6311;
const FUEL_PROPERTY_ATTRIBUTE_IDS = Object.freeze({
    fuelEfficiency: ATTRIBUTE_FUEL_EFFICIENCY,
    fuelThermalInefficiency: ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY,
    fuelContainmentBurden: ATTRIBUTE_FUEL_CONTAINMENT_BURDEN,
    fuelVolatility: ATTRIBUTE_FUEL_VOLATILITY,
});
const SHIP_CATEGORY_ID = 6;
const FUEL_EPSILON = 1e-9;
// inventorycommon.const.fuelGroups in the staged client.
const FUEL_GROUP_CRUDE = 4738;
const FUEL_GROUP_CORVETTE = 4598;
const FUEL_GROUP_IDS = Object.freeze([FUEL_GROUP_CRUDE, FUEL_GROUP_CORVETTE]);
// inventorycommon.const engine groups in the staged client. Power Generator
// is both a Creation module group and the hydrogen engine group accepted by
// non-modular corvettes and shuttles.
const ENGINE_GROUP_CRUDE = 4619;
const ENGINE_GROUP_CORVETTE = 4741;
const ENGINE_FUEL_GROUPS = Object.freeze({
    [ENGINE_GROUP_CRUDE]: FUEL_GROUP_CRUDE,
    [ENGINE_GROUP_CORVETTE]: FUEL_GROUP_CORVETTE,
});
// Client-side FUEL_LOCATION_FLAGS plus the docked hangar fallback.
const FLAG_CARGO = 5;
const FLAG_HANGAR = 4;
const FLAG_ENGINE = 37;
const FLAG_SPECIALIZED_FUEL_BAY = 133;
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function resolveFuelGroupID(typeID, deps = {}) {
    const resolveType = typeof deps.resolveItemByTypeID === "function"
        ? deps.resolveItemByTypeID
        : resolveItemByTypeID;
    const record = resolveType(toInt(typeID, 0));
    return toInt(record && record.groupID, 0);
}
function isSupportedFuelType(typeID, deps = {}) {
    return FUEL_GROUP_IDS.includes(resolveFuelGroupID(typeID, deps));
}
/**
 * Return the fuel groups enabled by the ship's fitted engine. Creation ships
 * deliberately bypass engine filtering: their fitted fuel-storage module is
 * the opt-in and all Frontier hydrogen/crude fuels remain valid.
 */
function getAllowedShipFuelGroupIDs(shipItem, fuelTank, deps = {}) {
    if (fuelTank && fuelTank.creationType) {
        return [...FUEL_GROUP_IDS];
    }
    const listContainerItems = typeof deps.listContainerItems === "function"
        ? deps.listContainerItems
        : itemStore.listContainerItems;
    const resolveType = typeof deps.resolveItemByTypeID === "function"
        ? deps.resolveItemByTypeID
        : resolveItemByTypeID;
    const ownerID = toInt(shipItem && shipItem.ownerID, 0);
    const shipID = toInt(shipItem && shipItem.itemID, 0);
    if (ownerID <= 0 || shipID <= 0) {
        return [];
    }
    const fuelGroupIDs = new Set();
    for (const engineItem of listContainerItems(ownerID, shipID, FLAG_ENGINE)) {
        const engineType = resolveType(toInt(engineItem && engineItem.typeID, 0));
        const engineGroupID = toInt(engineType && engineType.groupID, toInt(engineItem && engineItem.groupID, 0));
        const fuelGroupID = toInt(ENGINE_FUEL_GROUPS[engineGroupID], 0);
        if (fuelGroupID > 0) {
            fuelGroupIDs.add(fuelGroupID);
        }
    }
    return [...fuelGroupIDs];
}
/**
 * Resolve the two authored fuel-tank paths used by Frontier ships.
 *
 * Regular hulls opt in with a positive base fuelCapacity Dogma attribute.
 * Creation hulls have a zero base value and receive their effective capacity
 * from fitted Creation fuel-storage modules.  A positive effective value on
 * any other item is not enough to turn it into a fuel-capable ship.
 */
function resolveShipFuelTank(shipItem, effectiveCapacity, deps = {}) {
    const resolveType = typeof deps.resolveItemByTypeID === "function"
        ? deps.resolveItemByTypeID
        : resolveItemByTypeID;
    const resolveDogmaAttributes = typeof deps.getTypeDogmaAttributes === "function"
        ? deps.getTypeDogmaAttributes
        : getTypeDogmaAttributes;
    const resolveCreationTemplate = typeof deps.getCreationTemplate === "function"
        ? deps.getCreationTemplate
        : getCreationTemplate;
    const typeID = toInt(shipItem && shipItem.typeID, 0);
    const typeRecord = typeID > 0 ? resolveType(typeID) : null;
    const categoryID = toInt(typeRecord && typeRecord.categoryID, toInt(shipItem && shipItem.categoryID, 0));
    const isShip = typeID > 0 && categoryID === SHIP_CATEGORY_ID;
    const typeAttributes = isShip ? resolveDogmaAttributes(typeID) : null;
    const baseCapacity = Math.max(0, toFiniteNumber(typeAttributes && (typeAttributes[ATTRIBUTE_FUEL_CAPACITY] ??
        typeAttributes[String(ATTRIBUTE_FUEL_CAPACITY)]), 0));
    const creationType = isShip && Boolean(resolveCreationTemplate(typeID));
    const capacity = Math.max(0, toFiniteNumber(effectiveCapacity, 0));
    const source = creationType
        ? "creation-module"
        : baseCapacity > 0
            ? "hull-attribute"
            : null;
    return {
        isShip,
        creationType,
        source,
        baseCapacity,
        capacity,
        supported: isShip && source !== null && capacity > 0,
    };
}
function getConditionState(shipItem) {
    return shipItem && shipItem.conditionState && typeof shipItem.conditionState === "object"
        ? shipItem.conditionState
        : null;
}
/**
 * Canonicalize a persisted/API fuel queue without losing load order.
 * Adjacent batches of the same type are equivalent and are coalesced, while
 * same-type batches separated by another fuel remain distinct FIFO entries.
 */
function normalizeFuelQueue(rawQueue) {
    let rawEntries = [];
    if (rawQueue instanceof Map) {
        rawEntries = [...rawQueue.entries()];
    }
    else if (Array.isArray(rawQueue)) {
        rawEntries = rawQueue;
    }
    else if (rawQueue && typeof rawQueue === "object") {
        rawEntries = Object.entries(rawQueue);
    }
    const fuelQueue = [];
    for (const entry of rawEntries) {
        const tuple = Array.isArray(entry);
        const fuelTypeID = toInt(tuple ? entry[0] : entry && (entry.fuelTypeID ?? entry.typeID), 0);
        const quantity = Math.max(0, toFiniteNumber(tuple ? entry[1] : entry && entry.quantity, 0));
        if (fuelTypeID <= 0 || quantity <= FUEL_EPSILON) {
            continue;
        }
        const tail = fuelQueue[fuelQueue.length - 1];
        if (tail && tail.fuelTypeID === fuelTypeID) {
            tail.quantity += quantity;
        }
        else {
            fuelQueue.push({ fuelTypeID, quantity });
        }
    }
    return fuelQueue;
}
// Compatibility alias for callers and saves using the transitional
// composition representation. Its array order is interpreted as FIFO order.
const normalizeFuelComposition = normalizeFuelQueue;
function getFuelQueueQuantity(fuelQueue) {
    return normalizeFuelQueue(fuelQueue).reduce((total, entry) => total + entry.quantity, 0);
}
function getShipFuelCharge(shipItem) {
    const conditionState = getConditionState(shipItem);
    const fuelQueue = getShipFuelQueue(shipItem);
    if (fuelQueue.length > 0) {
        return getFuelQueueQuantity(fuelQueue);
    }
    return Math.max(0, toFiniteNumber(conditionState && conditionState.fuelCharge, 0));
}
function getShipFuelQueue(shipItem) {
    const conditionState = getConditionState(shipItem);
    const persistedQueue = conditionState && Array.isArray(conditionState.fuelQueue)
        ? conditionState.fuelQueue
        : conditionState && conditionState.fuelComposition;
    const fuelQueue = normalizeFuelQueue(persistedQueue);
    if (fuelQueue.length > 0) {
        return fuelQueue;
    }
    const fuelCharge = Math.max(0, toFiniteNumber(conditionState && conditionState.fuelCharge, 0));
    const fuelTypeID = toInt(conditionState && conditionState.fuelTypeID, 0);
    return fuelCharge > FUEL_EPSILON && fuelTypeID > 0
        ? [{ fuelTypeID, quantity: fuelCharge }]
        : [];
}
const getShipFuelComposition = getShipFuelQueue;
function getShipFuelTypeID(shipItem) {
    const fuelQueue = getShipFuelQueue(shipItem);
    if (fuelQueue.length > 0) {
        return fuelQueue[0].fuelTypeID;
    }
    const conditionState = getConditionState(shipItem);
    const fuelTypeID = toInt(conditionState && conditionState.fuelTypeID, 0);
    return fuelTypeID > 0 ? fuelTypeID : 0;
}
function getFuelProperties(fuelTypeID, deps = {}) {
    const resolveDogmaAttributes = typeof deps.getTypeDogmaAttributes === "function"
        ? deps.getTypeDogmaAttributes
        : getTypeDogmaAttributes;
    const attributes = resolveDogmaAttributes(toInt(fuelTypeID, 0));
    const properties = {};
    for (const [propertyName, attributeID] of Object.entries(FUEL_PROPERTY_ATTRIBUTE_IDS)) {
        properties[propertyName] = Math.max(0, toFiniteNumber(attributes && (attributes[attributeID] ?? attributes[String(attributeID)]), 0));
    }
    return properties;
}
function getFuelEfficiency(fuelTypeID, deps = {}) {
    return getFuelProperties(fuelTypeID, deps).fuelEfficiency;
}
/** Return the properties of the FIFO head (the fuel currently being burned). */
function calculateFuelQueueProperties(fuelQueue, deps = {}) {
    const normalizedQueue = normalizeFuelQueue(fuelQueue);
    const totalQuantity = getFuelQueueQuantity(normalizedQueue);
    const activeBatch = normalizedQueue[0] || null;
    const activeProperties = activeBatch
        ? getFuelProperties(activeBatch.fuelTypeID, deps)
        : Object.fromEntries(Object.keys(FUEL_PROPERTY_ATTRIBUTE_IDS).map((propertyName) => [propertyName, 0]));
    return {
        totalQuantity,
        fuelTypeCount: new Set(normalizedQueue.map((entry) => entry.fuelTypeID)).size,
        activeFuelTypeID: activeBatch ? activeBatch.fuelTypeID : 0,
        ...activeProperties,
    };
}
function getShipFuelProperties(shipItem, deps = {}) {
    return calculateFuelQueueProperties(getShipFuelQueue(shipItem), deps);
}
function trimFuelQueueToQuantity(fuelQueue, nextTotalQuantity) {
    let remaining = Math.max(0, toFiniteNumber(nextTotalQuantity, 0));
    const trimmedQueue = [];
    for (const entry of normalizeFuelQueue(fuelQueue)) {
        if (remaining <= FUEL_EPSILON) {
            break;
        }
        const quantity = Math.min(entry.quantity, remaining);
        trimmedQueue.push({ fuelTypeID: entry.fuelTypeID, quantity });
        remaining -= quantity;
    }
    return normalizeFuelQueue(trimmedQueue);
}
function appendFuelQueueBatch(fuelQueue, fuelTypeID, quantity) {
    return normalizeFuelQueue([
        ...normalizeFuelQueue(fuelQueue),
        { fuelTypeID, quantity },
    ]);
}
/**
 * Advance Frontier's fuel-driven capacitor recharge for one tick.
 *
 * One MW of unused power grid supplies one GJ/s of capacitor recharge. Each
 * unit of loaded fuel supplies `fuelEfficiency` GJ. The returned state is
 * deliberately pure so both Creation and regular fuel-tank ships use exactly
 * the same accounting. `capacitorRechargeRate` is retained in the input for
 * diagnostics/legacy callers, but Frontier's rate is the free grid headroom.
 */
function calculateFueledCapacitorRecharge({ currentCapacitorAmount, capacitorCapacity, capacitorRechargeRate, powerOutput, powerLoad, fuelCharge, fuelTypeID, fuelQueue, fuelComposition, deltaSeconds, }, deps = {}) {
    const capacity = Math.max(0, toFiniteNumber(capacitorCapacity, 0));
    const currentAmount = Math.min(capacity, Math.max(0, toFiniteNumber(currentCapacitorAmount, 0)));
    let normalizedFuelQueue = normalizeFuelQueue(Array.isArray(fuelQueue) ? fuelQueue : fuelComposition);
    if (normalizedFuelQueue.length === 0) {
        const legacyFuelCharge = Math.max(0, toFiniteNumber(fuelCharge, 0));
        const legacyFuelTypeID = toInt(fuelTypeID, 0);
        if (legacyFuelCharge > FUEL_EPSILON && legacyFuelTypeID > 0) {
            normalizedFuelQueue = [{
                    fuelTypeID: legacyFuelTypeID,
                    quantity: legacyFuelCharge,
                }];
        }
    }
    const loadedFuel = getFuelQueueQuantity(normalizedFuelQueue);
    const fuelProperties = calculateFuelQueueProperties(normalizedFuelQueue, deps);
    const fuelEfficiency = fuelProperties.fuelEfficiency;
    const powerHeadroom = Math.max(0, toFiniteNumber(powerOutput, 0) - toFiniteNumber(powerLoad, 0));
    const authoredRechargeRate = Math.max(0, toFiniteNumber(capacitorRechargeRate, 0));
    const effectiveRechargeRate = powerHeadroom;
    const missingEnergy = Math.max(0, capacity - currentAmount);
    const requestedEnergy = Math.min(missingEnergy, effectiveRechargeRate * Math.max(0, toFiniteNumber(deltaSeconds, 0)));
    const nextFuelQueue = normalizedFuelQueue.map((entry) => ({ ...entry }));
    let remainingEnergy = requestedEnergy;
    let consumedFuel = 0;
    while (remainingEnergy > FUEL_EPSILON && nextFuelQueue.length > 0) {
        const activeBatch = nextFuelQueue[0];
        const activeEfficiency = getFuelEfficiency(activeBatch.fuelTypeID, deps);
        // A zero-efficiency head must block later batches to preserve strict FIFO.
        if (activeEfficiency <= 0) {
            break;
        }
        const availableEnergy = activeBatch.quantity * activeEfficiency;
        const batchEnergy = Math.min(remainingEnergy, availableEnergy);
        const batchFuel = batchEnergy / activeEfficiency;
        consumedFuel += batchFuel;
        remainingEnergy -= batchEnergy;
        activeBatch.quantity -= batchFuel;
        if (activeBatch.quantity <= FUEL_EPSILON) {
            nextFuelQueue.shift();
        }
    }
    const rechargedEnergy = requestedEnergy - remainingEnergy;
    const rawNextFuelCharge = Math.max(0, getFuelQueueQuantity(nextFuelQueue));
    const nextFuelCharge = rawNextFuelCharge <= FUEL_EPSILON
        ? 0
        : rawNextFuelCharge;
    const normalizedNextFuelQueue = trimFuelQueueToQuantity(nextFuelQueue, nextFuelCharge);
    const nextFuelProperties = calculateFuelQueueProperties(normalizedNextFuelQueue, deps);
    const rawNextCapacitorAmount = Math.min(capacity, currentAmount + rechargedEnergy);
    const nextCapacitorAmount = capacity - rawNextCapacitorAmount <= FUEL_EPSILON
        ? capacity
        : rawNextCapacitorAmount;
    return {
        currentCapacitorAmount: currentAmount,
        nextCapacitorAmount,
        missingEnergy,
        powerHeadroom,
        authoredRechargeRate,
        effectiveRechargeRate,
        fuelEfficiency,
        fuelProperties,
        nextFuelProperties,
        consumedFuel,
        rechargedEnergy,
        previousFuelCharge: loadedFuel,
        nextFuelCharge,
        previousFuelTypeID: fuelProperties.activeFuelTypeID,
        nextFuelTypeID: nextFuelProperties.activeFuelTypeID,
        previousFuelQueue: normalizedFuelQueue,
        nextFuelQueue: normalizedNextFuelQueue,
        // Compatibility aliases for callers of the transitional representation.
        previousFuelComposition: normalizedFuelQueue,
        nextFuelComposition: normalizedNextFuelQueue,
    };
}
function normalizeRequestedFuelItemIDs(fuelItems) {
    if (!Array.isArray(fuelItems)) {
        return [];
    }
    const itemIDs = [];
    for (const entry of fuelItems) {
        let itemID = 0;
        if (typeof entry === "number" || typeof entry === "bigint") {
            itemID = toInt(entry, 0);
        }
        else if (entry && typeof entry === "object") {
            itemID = toInt(entry.itemID ?? entry.itemId, 0);
        }
        if (itemID > 0 && !itemIDs.includes(itemID)) {
            itemIDs.push(itemID);
        }
    }
    return itemIDs;
}
function getStackQuantity(item) {
    if (!item) {
        return 0;
    }
    if (toInt(item.singleton, 0) === 1) {
        return 1;
    }
    return Math.max(0, toInt(item.stacksize ?? item.quantity, 0));
}
/**
 * Collect candidate source stacks for a load request, mirroring the
 * containers the client's fuel pickers read. Explicit `fuelItemIDs` (fitting
 * drag) win; otherwise fall back to ship cargo, then the specialized fuel
 * bay, then — while docked — the hangar. `sourceLocationID` narrows the
 * fallback scan to that container.
 */
function collectFuelSourceStacks({ characterID, shipID, fuelTypeID, fuelItemIDs = [], sourceLocationID = null, dockedLocationID = null, deps = {}, }) {
    const findItemById = typeof deps.findItemById === "function"
        ? deps.findItemById
        : itemStore.findItemById;
    const listContainerItems = typeof deps.listContainerItems === "function"
        ? deps.listContainerItems
        : itemStore.listContainerItems;
    const ownerID = toInt(characterID, 0);
    const numericShipID = toInt(shipID, 0);
    const numericTypeID = toInt(fuelTypeID, 0);
    const numericSourceLocationID = toInt(sourceLocationID, 0);
    const matchesRequest = (item) => item &&
        toInt(item.ownerID, 0) === ownerID &&
        toInt(item.typeID, 0) === numericTypeID &&
        getStackQuantity(item) > 0 &&
        (numericSourceLocationID <= 0 ||
            toInt(item.locationID, 0) === numericSourceLocationID);
    if (fuelItemIDs.length > 0) {
        return fuelItemIDs
            .map((itemID) => findItemById(itemID))
            .filter(matchesRequest);
    }
    const stacks = [];
    const seenItemIDs = new Set();
    const appendStacks = (locationID, flagID) => {
        if (toInt(locationID, 0) <= 0) {
            return;
        }
        for (const item of listContainerItems(ownerID, locationID, flagID)) {
            const itemID = toInt(item && item.itemID, 0);
            if (itemID <= 0 || seenItemIDs.has(itemID) || !matchesRequest(item)) {
                continue;
            }
            seenItemIDs.add(itemID);
            stacks.push(item);
        }
    };
    appendStacks(numericShipID, FLAG_CARGO);
    appendStacks(numericShipID, FLAG_SPECIALIZED_FUEL_BAY);
    appendStacks(dockedLocationID, FLAG_HANGAR);
    // Oldest stacks first so repeated loads drain deterministically.
    return stacks.sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
}
/**
 * Validate and execute one LoadFuel request. Consumes source stacks and
 * raises `conditionState.fuelCharge` on the ship item. Returns
 * `{ success, data: { loadedQuantity, previousFuelCharge, nextFuelCharge,
 * changes } }` or `{ success: false, errorMsg, params }`.
 */
function loadFuelIntoShipTank({ characterID, shipID, fuelTypeID, quantity, fuelItems = null, sourceLocationID = null, fuelCapacity = 0, dockedLocationID = null, deps = {}, }) {
    const findItemById = typeof deps.findItemById === "function"
        ? deps.findItemById
        : itemStore.findItemById;
    const consumeInventoryItemQuantity = typeof deps.consumeInventoryItemQuantity === "function"
        ? deps.consumeInventoryItemQuantity
        : itemStore.consumeInventoryItemQuantity;
    const grantItemsToCharacterLocation = typeof deps.grantItemsToCharacterLocation === "function"
        ? deps.grantItemsToCharacterLocation
        : itemStore.grantItemsToCharacterLocation;
    const updateShipItem = typeof deps.updateShipItem === "function"
        ? deps.updateShipItem
        : itemStore.updateShipItem;
    const ownerID = toInt(characterID, 0);
    const numericShipID = toInt(shipID, 0);
    const numericTypeID = toInt(fuelTypeID, 0);
    const requestedQuantity = toInt(quantity, 0);
    if (ownerID <= 0 || numericShipID <= 0) {
        return { success: false, errorMsg: "FUEL_SHIP_NOT_FOUND" };
    }
    const shipItem = findItemById(numericShipID);
    if (!shipItem || toInt(shipItem.ownerID, 0) !== ownerID) {
        return { success: false, errorMsg: "FUEL_SHIP_NOT_OWNED" };
    }
    const fuelTank = resolveShipFuelTank(shipItem, fuelCapacity, deps);
    if (!fuelTank.isShip) {
        return { success: false, errorMsg: "FUEL_SHIP_INVALID" };
    }
    if (requestedQuantity <= 0) {
        return { success: false, errorMsg: "FUEL_QUANTITY_INVALID" };
    }
    if (!isSupportedFuelType(numericTypeID, deps)) {
        return { success: false, errorMsg: "FUEL_TYPE_UNSUPPORTED" };
    }
    const tankCapacity = fuelTank.capacity;
    if (!fuelTank.supported) {
        return { success: false, errorMsg: "FUEL_TANK_MISSING" };
    }
    const fuelGroupID = resolveFuelGroupID(numericTypeID, deps);
    const allowedFuelGroupIDs = getAllowedShipFuelGroupIDs(shipItem, fuelTank, deps);
    if (!fuelTank.creationType && allowedFuelGroupIDs.length === 0) {
        return { success: false, errorMsg: "FUEL_ENGINE_MISSING" };
    }
    if (!allowedFuelGroupIDs.includes(fuelGroupID)) {
        return {
            success: false,
            errorMsg: "FUEL_TYPE_INCOMPATIBLE",
            params: { allowedFuelGroupIDs, fuelGroupID },
        };
    }
    const previousFuelCharge = Math.min(getShipFuelCharge(shipItem), tankCapacity);
    let previousFuelQueue = trimFuelQueueToQuantity(getShipFuelQueue(shipItem), previousFuelCharge);
    // An old save can contain charge without a type. Adopt that charge as the
    // first newly loaded type, matching the prior migration behavior.
    if (previousFuelCharge > FUEL_EPSILON &&
        previousFuelQueue.length === 0) {
        previousFuelQueue = [{
                fuelTypeID: numericTypeID,
                quantity: previousFuelCharge,
            }];
    }
    const remainingCapacity = Math.floor(tankCapacity - previousFuelCharge);
    if (requestedQuantity > remainingCapacity) {
        return {
            success: false,
            errorMsg: "FUEL_TANK_OVERFLOW",
            params: { remainingCapacity, tankCapacity },
        };
    }
    const sourceStacks = collectFuelSourceStacks({
        characterID: ownerID,
        shipID: numericShipID,
        fuelTypeID: numericTypeID,
        fuelItemIDs: normalizeRequestedFuelItemIDs(fuelItems),
        sourceLocationID,
        dockedLocationID,
        deps,
    });
    const availableQuantity = sourceStacks.reduce((total, item) => total + getStackQuantity(item), 0);
    if (availableQuantity < requestedQuantity) {
        return {
            success: false,
            errorMsg: "FUEL_SOURCE_INSUFFICIENT",
            params: { availableQuantity },
        };
    }
    let remaining = requestedQuantity;
    const changes = [];
    const consumed = [];
    for (const stack of sourceStacks) {
        if (remaining <= 0) {
            break;
        }
        const take = Math.min(remaining, getStackQuantity(stack));
        const result = consumeInventoryItemQuantity(stack.itemID, take);
        if (!result || result.success !== true) {
            // Restore already-drained stacks before failing so a mid-drain write
            // error cannot destroy fuel.
            for (const restore of consumed.reverse()) {
                grantItemsToCharacterLocation(ownerID, restore.locationID, restore.flagID, [
                    { itemType: numericTypeID, quantity: restore.quantity },
                ]);
            }
            return {
                success: false,
                errorMsg: result && result.errorMsg
                    ? result.errorMsg
                    : "FUEL_CONSUME_FAILED",
            };
        }
        consumed.push({
            quantity: take,
            locationID: toInt(stack.locationID, 0),
            flagID: toInt(stack.flagID, 0),
        });
        changes.push(...((result.data && result.data.changes) || []));
        remaining -= take;
    }
    const nextFuelCharge = Math.min(previousFuelCharge + requestedQuantity, tankCapacity);
    const nextFuelQueue = appendFuelQueueBatch(previousFuelQueue, numericTypeID, requestedQuantity);
    const nextFuelTypeID = nextFuelQueue[0]?.fuelTypeID || 0;
    const previousFuelProperties = calculateFuelQueueProperties(previousFuelQueue, deps);
    const fuelProperties = calculateFuelQueueProperties(nextFuelQueue, deps);
    const updateResult = updateShipItem(numericShipID, (currentItem) => {
        const conditionState = {
            ...(currentItem.conditionState || {}),
            fuelCharge: nextFuelCharge,
            fuelQueue: nextFuelQueue,
        };
        delete conditionState.fuelComposition;
        if (nextFuelTypeID > 0) {
            conditionState.fuelTypeID = nextFuelTypeID;
        }
        else {
            delete conditionState.fuelTypeID;
        }
        return {
            ...currentItem,
            conditionState,
        };
    });
    if (!updateResult || updateResult.success !== true) {
        for (const restore of consumed.reverse()) {
            grantItemsToCharacterLocation(ownerID, restore.locationID, restore.flagID, [
                { itemType: numericTypeID, quantity: restore.quantity },
            ]);
        }
        return {
            success: false,
            errorMsg: updateResult && updateResult.errorMsg
                ? updateResult.errorMsg
                : "FUEL_TANK_WRITE_FAILED",
        };
    }
    return {
        success: true,
        data: {
            loadedQuantity: requestedQuantity,
            previousFuelCharge,
            nextFuelCharge,
            fuelTypeID: nextFuelTypeID,
            previousFuelQueue,
            fuelQueue: nextFuelQueue,
            previousFuelProperties,
            fuelProperties,
            shipItem: updateResult.data,
            changes,
        },
    };
}
module.exports = {
    ATTRIBUTE_FUEL_CAPACITY,
    ATTRIBUTE_FUEL_CHARGE,
    ATTRIBUTE_FUEL_CONTAINMENT_BURDEN,
    ATTRIBUTE_FUEL_EFFICIENCY,
    ATTRIBUTE_FUEL_RATE,
    ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY,
    ATTRIBUTE_FUEL_VOLATILITY,
    FUEL_PROPERTY_ATTRIBUTE_IDS,
    FUEL_GROUP_IDS,
    appendFuelQueueBatch,
    calculateFuelQueueProperties,
    calculateFueledCapacitorRecharge,
    collectFuelSourceStacks,
    getFuelEfficiency,
    getFuelProperties,
    getAllowedShipFuelGroupIDs,
    getShipFuelCharge,
    getShipFuelComposition,
    getShipFuelQueue,
    getShipFuelProperties,
    getShipFuelTypeID,
    isSupportedFuelType,
    loadFuelIntoShipTank,
    normalizeFuelComposition,
    normalizeFuelQueue,
    normalizeRequestedFuelItemIDs,
    resolveShipFuelTank,
    trimFuelQueueToQuantity,
};
//# sourceMappingURL=fuelTankRuntime.js.map