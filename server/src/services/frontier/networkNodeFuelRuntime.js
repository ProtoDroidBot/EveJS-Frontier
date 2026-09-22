"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Network Node (assembly type 88092) fuel state and signed fuel transactions.
 *
 * Client contract (build 3450341 bytecode + exported protobuf evidence):
 * - The anchor UI reads GetFuelConfig (accepted fuel typeIDs + efficiency,
 *   displayed as 3600 / (fuelBurnRateInSeconds * efficiency / 100) units/h)
 *   and GetFuel (single ItemAttributes: current fuel typeID + quantity).
 * - Deposits send the source container Location plus the specific source
 *   stack itemIDs; withdrawals send a fuel typeID + destination Location.
 * - Both mutations are prepare/execute pairs: prepare returns a transaction
 *   uuid + serialized transaction payload which the Sui wallet signs; execute
 *   sends the uuid + signature. The signing convention matches the assembly
 *   online/offline transitions in deploymentRuntime.
 * - The input panel caps deposits at fuelMaxCapacity / GetVolume(typeID):
 *   the static `smartAnchor.fuelMaxCapacity` (1,000) is a VOLUME budget and
 *   per-type unit capacity derives from the fuel's volume (0.28 m3 -> 3,571
 *   units). The UI also refuses mixing fuel types, so the node stores a
 *   single fuel type at a time.
 *
 * EMULATOR POLICY (not client-derived): the accepted fuel list and efficiency
 * values are not observable locally (the retail values come from the world
 * API). We serve the three published group-4598 fuels with efficiency taken
 * from each type's authored `fuelEfficiency` dogma attribute (5607), which
 * matches the UI's percent-style formula. Adjust here if a client trace ever
 * proves different values.
 *
 * Online fuel burns one unit per (3,000s * efficiency / 100): Unstable
 * 15/hour, D2 8/hour, D1 12/hour. Persisted accounting preserves partial
 * online intervals through refueling, offline cycles and server restarts.
 * This local accounting is only used until a node has a confirmed Sui fuel
 * observation. Chain-backed nodes use confirmed quantities and explicit
 * transfer intents, so local ticks cannot replenish or double-burn chain fuel.
 */
const crypto = require("crypto");
const path = require("path");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const { ASSEMBLY_STATUS_OFFLINE, ASSEMBLY_STATUS_ONLINE, buildAssemblyTransitionTransactionData, isAssemblyActivationPending, isValidAssemblyTransitionSignature, readConstructionState, } = require(path.join(__dirname, "./deploymentRuntime"));
const { readStaticRows, TABLE } = require(path.join(__dirname, "../_shared/referenceData"));
const NETWORK_NODE_TYPE_ID = 88092;
// Structure fuel bays use the canonical EVE inventory flag. The Network Node
// does not persist ordinary rows under this flag: it is a virtual inventory
// backed by the node's local/Sui fuel state.
const NETWORK_NODE_FUEL_BAY_FLAG = 172;
const FUEL_INFO_KEY = "evejsFrontierNetworkNodeFuel";
const SUI_FUEL_INFO_KEY = "evejsSuiNetworkNodeFuel";
const FUEL_TRANSACTION_TTL_MS = 2 * 60 * 1000;
const DEFAULT_FUEL_MAX_CAPACITY_VOLUME = 1000;
const DEFAULT_FUEL_BURN_RATE_SECONDS = 3000;
const CAPACITY_VOLUME_EPSILON = 1e-6;
// Published group-4598 fuels with authored fuelEfficiency (attribute 5607).
const NETWORK_NODE_FUEL_CONFIG = Object.freeze([
    Object.freeze({ typeID: 77818, efficiency: 8 }), // Unstable Fuel
    Object.freeze({ typeID: 88319, efficiency: 15 }), // D2 Fuel
    Object.freeze({ typeID: 88335, efficiency: 10 }), // D1 Fuel
]);
const pendingFuelTransactions = new Map();
let fuelNoticePublisher = null;
let fuelTimer = null;
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function wholeFuelQuantity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > Number.MAX_SAFE_INTEGER) {
        throw new Error("Network Node fuel quantity is outside the local range");
    }
    return Math.floor(numeric);
}
function readSuiNetworkNodeFuel(item) {
    return parseCustomInfo(item?.customInfo)[SUI_FUEL_INFO_KEY] ?? null;
}
function readSuiNetworkNodeFuelIntent(item) {
    return readSuiNetworkNodeFuel(item)?.pending ?? null;
}
function projectedSuiFuel(observation) {
    // A conflicting pending transfer must not freeze observation of newer chain
    // fuel. Retain the intent for retry, expose confirmed fuel and block transfers.
    const pending = suiFuelTransferConflicts(observation) ? null : observation.pending;
    const quantity = wholeFuelQuantity(observation.quantity + (pending?.quantityDelta ?? 0));
    return { typeID: quantity > 0 ? pending?.typeID ?? observation.typeID : 0, quantity,
        updatedAtMs: observation.observedAtMs, burnUpdatedAtMs: observation.observedAtMs,
        burnRemainderMs: 0, burnTypeID: pending?.typeID ?? observation.typeID };
}
function suiFuelTransferConflicts(observation) {
    const pending = observation?.pending;
    return Boolean(pending && ((observation.quantity > 0 && observation.typeID !== pending.typeID) ||
        observation.quantity + pending.quantityDelta < 0 ||
        (pending.quantityDelta > 0 && (observation.quantity + pending.quantityDelta) * resolveFuelTypeVolume(pending.typeID) >
            getNetworkNodeFuelAttributes().fuelMaxCapacityVolume + CAPACITY_VOLUME_EPSILON)));
}
/** Import chain quantities without discarding transfers not yet acknowledged. */
function projectSuiNetworkNodeFuel(itemID, observation, deploymentKey) {
    const quantity = wholeFuelQuantity(observation.quantity);
    const typeID = toInt(observation.typeID);
    if (quantity > 0 && !isAcceptedNetworkNodeFuelType(typeID))
        throw new Error(`Unsupported chain fuel ${typeID}`);
    const result = itemStore.updateInventoryItem(itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        const previous = info[SUI_FUEL_INFO_KEY];
        if (previous?.pending && previous.deploymentKey !== deploymentKey) {
            throw new Error("Pending Network Node fuel belongs to a different chain deployment");
        }
        const next = { ...observation, typeID, quantity, deploymentKey, pending: previous?.pending };
        info[SUI_FUEL_INFO_KEY] = next;
        info[FUEL_INFO_KEY] = projectedSuiFuel(next);
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (!result.success)
        throw new Error(`Cannot save Network Node ${itemID} chain fuel: ${result.errorMsg}`);
    const before = readNetworkNodeFuelState(result.previousData);
    const after = readNetworkNodeFuelState(result.data);
    if (before.quantity !== after.quantity || before.typeID !== after.typeID)
        publishFuelChanged(result.data);
    return result.data;
}
/** Only a node absent from the chain can seed its initial reserve. */
function initializeSuiNetworkNodeFuel(itemID, deploymentKey) {
    const item = itemStore.findItemById(itemID);
    if (readSuiNetworkNodeFuel(item))
        return readSuiNetworkNodeFuelIntent(item);
    const fuel = readNetworkNodeFuelState(item);
    const result = itemStore.updateInventoryItem(itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        info[SUI_FUEL_INFO_KEY] = { deploymentKey, quantity: 0, typeID: 0, observedAtMs: Date.now(),
            pending: fuel.quantity > 0 ? { id: crypto.randomUUID(), typeID: fuel.typeID, quantityDelta: fuel.quantity } : undefined };
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (!result.success)
        throw new Error(`Cannot initialize Network Node ${itemID} chain fuel`);
    return readSuiNetworkNodeFuelIntent(result.data);
}
/** Called before the transaction journal unlocks, and safe to repeat on recovery. */
function acknowledgeSuiNetworkNodeFuel(itemID, intentID) {
    const item = itemStore.findItemById(itemID);
    if (!item || readSuiNetworkNodeFuelIntent(item)?.id !== intentID)
        return;
    const result = itemStore.updateInventoryItem(itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        const observation = info[SUI_FUEL_INFO_KEY];
        if (observation?.pending?.id !== intentID)
            return currentItem;
        const fuel = projectedSuiFuel(observation);
        info[SUI_FUEL_INFO_KEY] = { ...observation, quantity: fuel.quantity, typeID: fuel.typeID, pending: undefined };
        info[FUEL_INFO_KEY] = fuel;
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (!result.success)
        throw new Error(`Cannot acknowledge Network Node ${itemID} fuel transfer`);
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
function getSmartAnchorComponent() {
    const rows = readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE);
    for (const row of Array.isArray(rows) ? rows : []) {
        if (toInt(row && (row._key ?? row.typeID), 0) === NETWORK_NODE_TYPE_ID) {
            return row.smartAnchor || null;
        }
    }
    return null;
}
let cachedAnchorAttributes = null;
function getNetworkNodeFuelAttributes() {
    if (!cachedAnchorAttributes) {
        const component = getSmartAnchorComponent();
        cachedAnchorAttributes = {
            fuelMaxCapacityVolume: Math.max(1, toFiniteNumber(component && component.fuelMaxCapacity, DEFAULT_FUEL_MAX_CAPACITY_VOLUME)),
            fuelBurnRateInSeconds: Math.max(1, toFiniteNumber(component && component.fuelBurnRateInSeconds, DEFAULT_FUEL_BURN_RATE_SECONDS)),
        };
    }
    return cachedAnchorAttributes;
}
function getNetworkNodeFuelConfig() {
    return NETWORK_NODE_FUEL_CONFIG.map((entry) => ({ ...entry }));
}
function isAcceptedNetworkNodeFuelType(typeID) {
    const numericTypeID = toInt(typeID, 0);
    return NETWORK_NODE_FUEL_CONFIG.some((entry) => entry.typeID === numericTypeID);
}
function resolveFuelTypeVolume(typeID) {
    const record = resolveItemByTypeID(toInt(typeID, 0));
    return toFiniteNumber(record && record.volume, 0);
}
function readNetworkNodeFuelState(item) {
    const info = parseCustomInfo(item && item.customInfo);
    if (info[SUI_FUEL_INFO_KEY])
        return projectedSuiFuel(info[SUI_FUEL_INFO_KEY]);
    const raw = info[FUEL_INFO_KEY];
    const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        typeID: toInt(state.typeID, 0),
        quantity: Math.max(0, Math.floor(toFiniteNumber(state.quantity, 0))),
        updatedAtMs: toInt(state.updatedAtMs, 0),
        burnUpdatedAtMs: Math.max(0, toInt(state.burnUpdatedAtMs, 0)),
        burnRemainderMs: Math.max(0, toInt(state.burnRemainderMs, 0)),
        burnTypeID: toInt(state.burnTypeID, toInt(state.typeID, 0)),
    };
}
function writeNetworkNodeFuelState(itemID, state) {
    return itemStore.updateInventoryItem(itemID, (currentItem) => {
        const info = parseCustomInfo(currentItem.customInfo);
        const observation = info[SUI_FUEL_INFO_KEY];
        if (observation) {
            const quantity = wholeFuelQuantity(state.quantity);
            const quantityDelta = quantity - observation.quantity;
            observation.pending = quantityDelta ? { id: crypto.randomUUID(), typeID: toInt(state.typeID), quantityDelta } : undefined;
            info[FUEL_INFO_KEY] = projectedSuiFuel(observation);
            return { ...currentItem, customInfo: JSON.stringify(info) };
        }
        if (toInt(state && state.quantity, 0) > 0 || toInt(state?.burnRemainderMs) > 0) {
            const quantity = Math.max(0, toInt(state.quantity));
            const typeID = quantity > 0 ? toInt(state.typeID) : 0;
            const oldType = toInt(state.burnTypeID, toInt(state.typeID));
            const oldEfficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === oldType)?.efficiency;
            const newEfficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === typeID)?.efficiency;
            // Keep the fraction already used if an empty tank is refilled with a
            // different fuel, so switching fuels cannot erase accrued consumption.
            const remainder = Math.max(0, toInt(state.burnRemainderMs));
            info[FUEL_INFO_KEY] = {
                typeID,
                quantity,
                updatedAtMs: toInt(state.updatedAtMs, Date.now()),
                burnUpdatedAtMs: toInt(state.burnUpdatedAtMs, Date.now()),
                burnRemainderMs: oldEfficiency && newEfficiency ? Math.ceil(remainder * newEfficiency / oldEfficiency) : remainder,
                burnTypeID: typeID || oldType,
            };
        }
        else {
            delete info[FUEL_INFO_KEY];
        }
        return {
            ...currentItem,
            customInfo: JSON.stringify(info),
        };
    });
}
function applyFuelDeltaToNodeItem(currentItem, fuelTypeID, quantityDelta, nowMs = Date.now()) {
    if (!currentItem || toInt(currentItem.typeID, 0) !== NETWORK_NODE_TYPE_ID) {
        throw Object.assign(new Error("ASSEMBLY_NOT_FOUND"), { code: "ASSEMBLY_NOT_FOUND" });
    }
    const numericTypeID = toInt(fuelTypeID, 0);
    if (!isAcceptedNetworkNodeFuelType(numericTypeID)) {
        throw Object.assign(new Error("UNSUPPORTED_FUEL_TYPE"), { code: "UNSUPPORTED_FUEL_TYPE" });
    }
    const info = parseCustomInfo(currentItem.customInfo);
    const observation = info[SUI_FUEL_INFO_KEY];
    if (suiFuelTransferConflicts(observation)) {
        throw Object.assign(new Error("ASSEMBLY_STATE_PENDING"), { code: "ASSEMBLY_STATE_PENDING" });
    }
    // Recalculate against the item snapshot being committed. Validation may
    // have happened earlier (or in a prepare/execute round trip), so using the
    // serialized reserve directly here would discard fuel burned and partial
    // intervals accrued before the atomic inventory mutation.
    const current = calculateNetworkNodeFuelBurn(currentItem, nowMs).state;
    if (current.quantity > 0 && current.typeID !== numericTypeID) {
        throw Object.assign(new Error("MIXED_FUEL_TYPES"), { code: "MIXED_FUEL_TYPES" });
    }
    const nextQuantity = current.quantity + toInt(quantityDelta, 0);
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) {
        throw Object.assign(new Error("INSUFFICIENT_STORED_FUEL"), {
            code: "INSUFFICIENT_STORED_FUEL",
        });
    }
    const unitVolume = resolveFuelTypeVolume(numericTypeID);
    if (!(unitVolume > 0) || nextQuantity * unitVolume >
        getNetworkNodeFuelAttributes().fuelMaxCapacityVolume + CAPACITY_VOLUME_EPSILON) {
        throw Object.assign(new Error("FUEL_CAPACITY_EXCEEDED"), { code: "FUEL_CAPACITY_EXCEEDED" });
    }
    if (observation) {
        const quantityDeltaFromChain = nextQuantity - wholeFuelQuantity(observation.quantity);
        observation.pending = quantityDeltaFromChain ? {
            id: crypto.randomUUID(),
            typeID: numericTypeID,
            quantityDelta: quantityDeltaFromChain,
        } : undefined;
        info[SUI_FUEL_INFO_KEY] = observation;
        info[FUEL_INFO_KEY] = projectedSuiFuel(observation);
    }
    else if (nextQuantity > 0 || current.burnRemainderMs > 0) {
        const oldTypeID = toInt(current.burnTypeID, current.typeID);
        const oldEfficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === oldTypeID)?.efficiency;
        const newEfficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === numericTypeID)?.efficiency;
        const burnRemainderMs = Math.max(0, toInt(current.burnRemainderMs, 0));
        info[FUEL_INFO_KEY] = {
            ...current,
            typeID: nextQuantity > 0 ? numericTypeID : 0,
            quantity: nextQuantity,
            updatedAtMs: nowMs,
            burnUpdatedAtMs: current.quantity > 0 ? current.burnUpdatedAtMs : nowMs,
            // Preserve the fraction of one unit already consumed when an empty bay
            // changes fuel type. Efficiencies scale the length of a unit interval.
            burnRemainderMs: oldEfficiency && newEfficiency
                ? Math.ceil(burnRemainderMs * newEfficiency / oldEfficiency)
                : burnRemainderMs,
            burnTypeID: numericTypeID,
        };
    }
    else {
        delete info[FUEL_INFO_KEY];
    }
    return { ...currentItem, customInfo: JSON.stringify(info) };
}
/** Pure accounting shared by ticks and status transitions inside a store update. */
function calculateNetworkNodeFuelBurn(item, nowMs = Date.now()) {
    const state = readNetworkNodeFuelState(item);
    if (readSuiNetworkNodeFuel(item))
        return { state, consumedQuantity: 0 };
    const efficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === state.typeID)?.efficiency;
    if (!state.quantity || !efficiency)
        return { state, consumedQuantity: 0 };
    // Older reserves have no online-time history. Start now instead of charging
    // for time that may have been spent offline before this feature existed.
    const now = Math.max(state.burnUpdatedAtMs, toInt(nowMs, Date.now()));
    const online = readConstructionState(item)?.assemblyStatus === ASSEMBLY_STATUS_ONLINE &&
        !isAssemblyActivationPending(item);
    const elapsed = online && state.burnUpdatedAtMs > 0 ? now - state.burnUpdatedAtMs : 0;
    const interval = Math.round(getNetworkNodeFuelAttributes().fuelBurnRateInSeconds * efficiency * 10);
    const total = state.burnRemainderMs + elapsed;
    const consumedQuantity = Math.min(state.quantity, Math.floor(total / interval));
    return {
        consumedQuantity,
        state: {
            ...state,
            quantity: state.quantity - consumedQuantity,
            updatedAtMs: consumedQuantity > 0 ? now : state.updatedAtMs,
            burnUpdatedAtMs: now,
            burnRemainderMs: consumedQuantity === state.quantity ? 0 : total % interval,
        },
    };
}
function publishFuelBurn(item, consumedQuantity) {
    if (consumedQuantity <= 0)
        return;
    publishFuelChanged(item);
}
function publishFuelOperationalStatus(item) {
    try {
        require("./networkNodeEnergyRuntime").publishNetworkNodeOperationalStatus(toInt(item.itemID), { reason: "fuel_changed" });
    }
    catch (error) {
        require("../../utils/logger").warn(`[NetworkNodeFuel] Status signal failed: ${error.message}`);
    }
}
function publishFuelChanged(item) {
    const fuel = readNetworkNodeFuelState(item);
    publishFuelOperationalStatus(item);
    if (!fuelNoticePublisher)
        return;
    try {
        fuelNoticePublisher({
            characterID: toInt(item.ownerID), networkNodeID: toInt(item.itemID),
            solarSystemID: toInt(item.locationID), fuelTypeID: fuel.typeID, quantity: fuel.quantity,
            unitVolume: fuel.typeID > 0 ? resolveFuelTypeVolume(fuel.typeID) : 0,
        });
    }
    catch (error) {
        require("../../utils/logger").warn(`[NetworkNodeFuel] Notice failed: ${error.message}`);
    }
}
/** Persist the deduction and exhaustion status together; never charge twice. */
function settleNetworkNodeFuel(itemID, nowMs = Date.now()) {
    const item = itemStore.findItemById(itemID);
    if (!item || toInt(item.typeID) !== NETWORK_NODE_TYPE_ID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (readSuiNetworkNodeFuel(item))
        return { success: true, data: item, consumedQuantity: 0 };
    const calculated = calculateNetworkNodeFuelBurn(item, nowMs);
    const online = readConstructionState(item)?.assemblyStatus === ASSEMBLY_STATUS_ONLINE;
    if (!calculated.state.quantity && !calculated.consumedQuantity && !online) {
        return { success: true, data: item, consumedQuantity: 0 };
    }
    const previous = readNetworkNodeFuelState(item);
    // A running anchor already includes partial time; only persist a tick once
    // a whole unit is due (or initialize a legacy reserve).
    if (previous.quantity > 0 && previous.burnUpdatedAtMs > 0 && calculated.consumedQuantity === 0) {
        return { success: true, data: item, consumedQuantity: 0 };
    }
    const result = itemStore.updateInventoryItem(itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        if (calculated.state.quantity > 0 || calculated.state.burnRemainderMs > 0)
            info[FUEL_INFO_KEY] = calculated.state;
        else {
            delete info[FUEL_INFO_KEY];
        }
        if (calculated.state.quantity === 0 && online) {
            info.evejsFrontierConstruction.assemblyStatus = ASSEMBLY_STATUS_OFFLINE;
            require("./suiAssemblyState").recordSuiAssemblyStatusIntent(info, ASSEMBLY_STATUS_OFFLINE);
        }
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (result.success) {
        if (calculated.consumedQuantity > 0) {
            publishFuelChanged(result.data);
        }
        if (calculated.state.quantity === 0) {
            require("./deploymentRuntime").notifyAssemblyFuelDepleted(result.data, result.previousData);
        }
    }
    return { ...result, consumedQuantity: result.success ? calculated.consumedQuantity : 0 };
}
function settleAllNetworkNodeFuel(nowMs = Date.now()) {
    for (const item of Object.values(itemStore.getAllItems())) {
        if (toInt(item.typeID) !== NETWORK_NODE_TYPE_ID)
            continue;
        const result = settleNetworkNodeFuel(item.itemID, nowMs);
        if (!result.success)
            throw new Error(`Network Node ${item.itemID} fuel: ${result.errorMsg}`);
    }
    require("./networkNodeEnergyRuntime").reconcileNetworkNodeEnergy();
}
function startNetworkNodeFuelBurn() {
    const config = require("../../config");
    if (config.clientCompatibilityProfile !== "frontier" || process.env.NODE_TEST_CONTEXT ||
        process.env.EVEJS_TEST_STORE_ISOLATED || process.env.EVEJS_TEST_STORE_BASELINE_ROOT)
        return null;
    if (fuelTimer)
        return fuelTimer;
    const tick = () => {
        try {
            settleAllNetworkNodeFuel();
        }
        catch (error) {
            require("../../utils/logger").warn(`[NetworkNodeFuel] ${error.message}`);
        }
    };
    tick();
    fuelTimer = setInterval(tick, 1000);
    fuelTimer.unref();
    return fuelTimer;
}
function validateFuelNetworkNode(characterID, networkNodeID, options = {}) {
    const ownerID = toInt(characterID, 0);
    const nodeID = toInt(networkNodeID, 0);
    if (ownerID <= 0) {
        return { errorMsg: "ACCESS_DENIED" };
    }
    if (nodeID <= 0) {
        return { errorMsg: "INVALID_ASSEMBLY_ID" };
    }
    let item = itemStore.findItemById(nodeID);
    if (!item || toInt(item.typeID, 0) !== NETWORK_NODE_TYPE_ID) {
        return { errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (toInt(item.ownerID, 0) !== ownerID) {
        return { errorMsg: "ASSEMBLY_NOT_OWNED" };
    }
    if (isAssemblyActivationPending(item)) {
        return { errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    if (options.settle !== false) {
        const settled = settleNetworkNodeFuel(nodeID);
        if (!settled.success)
            return { errorMsg: settled.errorMsg };
        item = settled.data;
    }
    const constructionState = readConstructionState(item);
    if (constructionState.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE &&
        constructionState.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    return { item };
}
function validateNetworkNodeFuelInventory(characterID, networkNodeID, options = {}) {
    // Endpoint discovery is read-only. Actual deposits and withdrawals settle
    // the reserve immediately before their atomic commit; merely listing a
    // historical empty node must not cascade unrelated assemblies offline.
    const result = validateFuelNetworkNode(characterID, networkNodeID, { settle: false });
    if (result.errorMsg)
        return result;
    const access = options.access;
    if (access) {
        if (access.authorized !== true)
            return { errorMsg: "ACCESS_DENIED" };
        if (toInt(access.solarSystemID, 0) <= 0 ||
            toInt(result.item.locationID, 0) !== toInt(access.solarSystemID, 0)) {
            return { errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
        }
        if (access.inRange !== true)
            return { errorMsg: "ASSEMBLY_OUT_OF_RANGE" };
    }
    const fuelState = calculateNetworkNodeFuelBurn(result.item).state;
    const unitVolume = fuelState.typeID > 0 ? resolveFuelTypeVolume(fuelState.typeID) : 0;
    return {
        item: result.item,
        state: readConstructionState(result.item),
        kind: "network_node_fuel",
        flagID: NETWORK_NODE_FUEL_BAY_FLAG,
        inventoryOwnerID: toInt(characterID, 0),
        capacity: getNetworkNodeFuelAttributes().fuelMaxCapacityVolume,
        usedVolume: fuelState.quantity * unitVolume,
        fuelState,
    };
}
function normalizeDepositItems(rawItems) {
    const normalized = [];
    for (const entry of Array.isArray(rawItems) ? rawItems : []) {
        const itemID = toInt(entry && (entry.itemID ?? entry.item_id), 0);
        const quantity = toInt(entry && entry.quantity, 0);
        if (itemID <= 0 || quantity <= 0) {
            return null;
        }
        const existing = normalized.find((candidate) => candidate.itemID === itemID);
        if (existing) {
            existing.quantity += quantity;
        }
        else {
            normalized.push({ itemID, quantity });
        }
    }
    return normalized.length > 0 ? normalized : null;
}
/**
 * Validate a deposit request without mutating. Returns the validated context
 * used both at prepare time and again at execute time.
 */
function validateFuelDeposit({ characterID, networkNodeID, sourceItemID, sourceFlagID, sourceFlagIDs, items, }) {
    const nodeResult = validateFuelNetworkNode(characterID, networkNodeID);
    if (nodeResult.errorMsg) {
        return nodeResult;
    }
    if (suiFuelTransferConflicts(readSuiNetworkNodeFuel(nodeResult.item)))
        return { errorMsg: "ASSEMBLY_STATE_PENDING" };
    const normalizedItems = normalizeDepositItems(items);
    if (!normalizedItems) {
        return { errorMsg: "INVALID_QUANTITY" };
    }
    const sourceLocationID = toInt(sourceItemID, 0);
    const sourceFlag = toInt(sourceFlagID, -1);
    const allowedSourceFlags = Array.isArray(sourceFlagIDs)
        ? new Set(sourceFlagIDs.map(flag => toInt(flag, -1)).filter(flag => flag >= 0))
        : null;
    if (sourceLocationID <= 0) {
        return { errorMsg: "INVALID_SOURCE" };
    }
    const ownerID = toInt(characterID, 0);
    let fuelTypeID = 0;
    let totalQuantity = 0;
    const sourceStacks = [];
    for (const request of normalizedItems) {
        const stack = itemStore.findItemById(request.itemID);
        if (!stack ||
            toInt(stack.ownerID, 0) !== ownerID ||
            toInt(stack.locationID, 0) !== sourceLocationID ||
            (allowedSourceFlags
                ? !allowedSourceFlags.has(toInt(stack.flagID, -1))
                : sourceFlag >= 0 && toInt(stack.flagID, -1) !== sourceFlag)) {
            return { errorMsg: "SOURCE_ITEM_NOT_FOUND" };
        }
        const stackTypeID = toInt(stack.typeID, 0);
        if (fuelTypeID === 0) {
            fuelTypeID = stackTypeID;
        }
        else if (fuelTypeID !== stackTypeID) {
            return { errorMsg: "MIXED_FUEL_TYPES" };
        }
        const availableQuantity = toInt(stack.singleton, 0) === 1
            ? 1
            : Math.max(0, toInt(stack.stacksize ?? stack.quantity, 0));
        if (request.quantity > availableQuantity) {
            return { errorMsg: "INSUFFICIENT_SOURCE_FUEL" };
        }
        totalQuantity += request.quantity;
        sourceStacks.push({
            ...request,
            typeID: stackTypeID,
            sourceLocationID: toInt(stack.locationID, 0),
            sourceFlagID: toInt(stack.flagID, -1),
        });
    }
    if (!isAcceptedNetworkNodeFuelType(fuelTypeID)) {
        return { errorMsg: "UNSUPPORTED_FUEL_TYPE" };
    }
    const fuelState = calculateNetworkNodeFuelBurn(nodeResult.item).state;
    const chainFuel = readSuiNetworkNodeFuel(nodeResult.item);
    if ((fuelState.quantity > 0 && fuelState.typeID !== fuelTypeID) ||
        (chainFuel?.quantity > 0 && chainFuel.typeID !== fuelTypeID)) {
        return { errorMsg: "MIXED_FUEL_TYPES" };
    }
    const unitVolume = resolveFuelTypeVolume(fuelTypeID);
    if (!(unitVolume > 0)) {
        return { errorMsg: "UNSUPPORTED_FUEL_TYPE" };
    }
    const capacityVolume = getNetworkNodeFuelAttributes().fuelMaxCapacityVolume;
    const nextVolume = (fuelState.quantity + totalQuantity) * unitVolume;
    if (nextVolume > capacityVolume + CAPACITY_VOLUME_EPSILON) {
        const remainingUnits = Math.max(0, Math.floor((capacityVolume / unitVolume) - fuelState.quantity + CAPACITY_VOLUME_EPSILON));
        return {
            errorMsg: "FUEL_CAPACITY_EXCEEDED",
            params: { remainingUnits },
        };
    }
    return {
        item: nodeResult.item,
        fuelTypeID,
        totalQuantity,
        sourceStacks,
        sourceLocationID,
        sourceFlag,
        fuelState,
    };
}
function validateFuelWithdraw({ characterID, networkNodeID, fuelTypeID, quantity, destinationItemID, destinationFlagID, }) {
    const nodeResult = validateFuelNetworkNode(characterID, networkNodeID);
    if (nodeResult.errorMsg) {
        return nodeResult;
    }
    if (suiFuelTransferConflicts(readSuiNetworkNodeFuel(nodeResult.item)))
        return { errorMsg: "ASSEMBLY_STATE_PENDING" };
    const numericTypeID = toInt(fuelTypeID, 0);
    const numericQuantity = toInt(quantity, 0);
    if (numericQuantity <= 0) {
        return { errorMsg: "INVALID_QUANTITY" };
    }
    const fuelState = calculateNetworkNodeFuelBurn(nodeResult.item).state;
    if (fuelState.quantity <= 0 || fuelState.typeID !== numericTypeID) {
        return { errorMsg: "UNSUPPORTED_FUEL_TYPE" };
    }
    if (numericQuantity > fuelState.quantity) {
        return { errorMsg: "INSUFFICIENT_STORED_FUEL" };
    }
    const destinationID = toInt(destinationItemID, 0);
    const destination = destinationID > 0 ? itemStore.findItemById(destinationID) : null;
    if (!destination || toInt(destination.ownerID, 0) !== toInt(characterID, 0)) {
        return { errorMsg: "INVALID_DESTINATION" };
    }
    return {
        item: nodeResult.item,
        fuelTypeID: numericTypeID,
        quantity: numericQuantity,
        destinationID,
        destinationFlag: Math.max(0, toInt(destinationFlagID, 0)),
        fuelState,
    };
}
function prunePendingFuelTransactions(nowMs = Date.now()) {
    for (const [uuid, transaction] of pendingFuelTransactions) {
        if (!transaction || transaction.expiresAtMs <= nowMs) {
            pendingFuelTransactions.delete(uuid);
        }
    }
}
function getPendingNetworkNodeFuelTransactionNodeID({ action, characterID, transactionUUID }) {
    prunePendingFuelTransactions();
    const transaction = pendingFuelTransactions.get(String(transactionUUID || "").trim().toLowerCase());
    return transaction?.action === action && transaction.characterID === toInt(characterID)
        ? transaction.networkNodeID : 0;
}
function createPendingFuelTransaction(action, characterID, networkNodeID, request) {
    prunePendingFuelTransactions();
    const transactionUUID = crypto.randomUUID().toLowerCase();
    const transactionData = buildAssemblyTransitionTransactionData({
        action,
        characterID,
        itemID: networkNodeID,
        transactionUUID,
    });
    const nowMs = Date.now();
    pendingFuelTransactions.set(transactionUUID, {
        action,
        characterID: toInt(characterID, 0),
        networkNodeID: toInt(networkNodeID, 0),
        createdAtMs: nowMs,
        expiresAtMs: nowMs + FUEL_TRANSACTION_TTL_MS,
        request,
        transactionData,
    });
    return { transactionUUID, transactionData };
}
function prepareNetworkNodeFuelDeposit(options) {
    const validation = validateFuelDeposit(options);
    if (validation.errorMsg) {
        return { success: false, errorMsg: validation.errorMsg, params: validation.params };
    }
    const prepared = createPendingFuelTransaction("networknode-fuel-deposit", options.characterID, options.networkNodeID, {
        characterID: toInt(options.characterID, 0),
        networkNodeID: toInt(options.networkNodeID, 0),
        sourceItemID: toInt(options.sourceItemID, 0),
        sourceFlagID: toInt(options.sourceFlagID, -1),
        items: validation.sourceStacks.map((stack) => ({
            itemID: stack.itemID,
            quantity: stack.quantity,
        })),
    });
    return { success: true, data: prepared };
}
function prepareNetworkNodeFuelWithdraw(options) {
    const validation = validateFuelWithdraw(options);
    if (validation.errorMsg) {
        return { success: false, errorMsg: validation.errorMsg, params: validation.params };
    }
    const prepared = createPendingFuelTransaction("networknode-fuel-withdraw", options.characterID, options.networkNodeID, {
        characterID: toInt(options.characterID, 0),
        networkNodeID: toInt(options.networkNodeID, 0),
        fuelTypeID: validation.fuelTypeID,
        quantity: validation.quantity,
        destinationItemID: validation.destinationID,
        destinationFlagID: validation.destinationFlag,
    });
    return { success: true, data: prepared };
}
/** Consume ordinary inventory stacks into the Network Node's virtual bay. */
function depositNetworkNodeFuelFromInventory(options) {
    const settled = settleNetworkNodeFuel(toInt(options.networkNodeID, 0));
    if (!settled.success)
        return settled;
    const validation = validateFuelDeposit({
        characterID: options.characterID,
        networkNodeID: options.networkNodeID,
        sourceItemID: options.sourceItemID ?? options.sourceLocationID,
        sourceFlagID: options.sourceFlagID,
        sourceFlagIDs: options.sourceFlagIDs,
        items: options.items ?? options.stacks,
    });
    if (validation.errorMsg) {
        return { success: false, errorMsg: validation.errorMsg, params: validation.params };
    }
    const committed = itemStore.consumeInventoryItemsAndUpdateItem(validation.sourceStacks.map((stack) => ({
        itemID: stack.itemID,
        quantity: stack.quantity,
        expected: {
            ownerID: toInt(options.characterID, 0),
            locationID: stack.sourceLocationID,
            flagID: stack.sourceFlagID,
            typeID: validation.fuelTypeID,
        },
    })), toInt(options.networkNodeID, 0), (currentNode) => applyFuelDeltaToNodeItem(currentNode, validation.fuelTypeID, validation.totalQuantity), options.flush === true ? { flush: true } : {});
    if (!committed?.success)
        return committed || { success: false, errorMsg: "FUEL_CONSUME_FAILED" };
    const fuelState = readNetworkNodeFuelState(committed.data.item);
    if (options.publishNotice === true)
        publishFuelChanged(committed.data.item);
    else
        publishFuelOperationalStatus(committed.data.item);
    return {
        success: true,
        data: {
            networkNodeID: toInt(options.networkNodeID, 0),
            fuelTypeID: fuelState.typeID,
            quantity: fuelState.quantity,
            depositedQuantity: validation.totalQuantity,
            solarSystemID: toInt(committed.data.item.locationID, 0),
            changes: committed.data.changes,
        },
    };
}
/** Materialize virtual node fuel into normal inventory in one item-table commit. */
function withdrawNetworkNodeFuelToInventory(options) {
    const settled = settleNetworkNodeFuel(toInt(options.networkNodeID, 0));
    if (!settled.success)
        return settled;
    const validation = validateFuelWithdraw({
        characterID: options.characterID,
        networkNodeID: options.networkNodeID,
        fuelTypeID: options.fuelTypeID ?? options.typeID,
        quantity: options.quantity,
        destinationItemID: options.destinationItemID ?? options.destinationLocationID,
        destinationFlagID: options.destinationFlagID,
    });
    if (validation.errorMsg) {
        return { success: false, errorMsg: validation.errorMsg, params: validation.params };
    }
    const committed = itemStore.grantStackableItemsToCharacterLocationAndUpdateItem(toInt(options.characterID, 0), validation.destinationID, validation.destinationFlag, [{ itemType: validation.fuelTypeID, quantity: validation.quantity }], toInt(options.networkNodeID, 0), (currentNode) => applyFuelDeltaToNodeItem(currentNode, validation.fuelTypeID, -validation.quantity), options.flush === true ? { flush: true } : {});
    if (!committed?.success)
        return committed || { success: false, errorMsg: "FUEL_WITHDRAW_GRANT_FAILED" };
    const fuelState = readNetworkNodeFuelState(committed.data.item);
    if (options.publishNotice === true)
        publishFuelChanged(committed.data.item);
    else
        publishFuelOperationalStatus(committed.data.item);
    if (fuelState.quantity === 0) {
        require("./deploymentRuntime").offlineAssemblyForFuelDepletion(toInt(options.networkNodeID, 0));
    }
    return {
        success: true,
        data: {
            networkNodeID: toInt(options.networkNodeID, 0),
            fuelTypeID: validation.fuelTypeID,
            quantity: fuelState.quantity,
            withdrawnQuantity: validation.quantity,
            solarSystemID: toInt(committed.data.item.locationID, 0),
            changes: committed.data.changes,
            grantedItems: committed.data.grantedItems,
        },
    };
}
function commitFuelDeposit(transaction) {
    return depositNetworkNodeFuelFromInventory(transaction.request);
}
function commitFuelWithdraw(transaction) {
    return withdrawNetworkNodeFuelToInventory(transaction.request);
}
/**
 * Execute a prepared fuel transaction exactly once. The pending entry is
 * consumed only when the commit succeeds, so a client retry after a
 * validation failure re-runs against unchanged state, while a duplicate
 * request after success cannot double-commit.
 */
function executeNetworkNodeFuelTransaction({ action, characterID, transactionUUID, signature, }) {
    prunePendingFuelTransactions();
    const normalizedUUID = String(transactionUUID || "").trim().toLowerCase();
    const transaction = normalizedUUID
        ? pendingFuelTransactions.get(normalizedUUID)
        : null;
    if (!transaction || transaction.expiresAtMs <= Date.now()) {
        return { success: false, errorMsg: "TRANSACTION_NOT_FOUND" };
    }
    if (transaction.action !== action ||
        transaction.characterID !== toInt(characterID, 0)) {
        return { success: false, errorMsg: "TRANSACTION_MISMATCH" };
    }
    if (!isValidAssemblyTransitionSignature(signature)) {
        return { success: false, errorMsg: "INVALID_SIGNATURE" };
    }
    const commit = transaction.action === "networknode-fuel-deposit"
        ? commitFuelDeposit(transaction)
        : commitFuelWithdraw(transaction);
    if (commit.success === true) {
        pendingFuelTransactions.delete(normalizedUUID);
    }
    return commit;
}
function getNetworkNodeFuelStatus(characterID, networkNodeID) {
    const nodeResult = validateFuelNetworkNode(characterID, networkNodeID);
    if (nodeResult.errorMsg) {
        return { success: false, errorMsg: nodeResult.errorMsg };
    }
    const fuelState = readNetworkNodeFuelState(nodeResult.item);
    return {
        success: true,
        data: {
            typeID: fuelState.typeID,
            quantity: fuelState.quantity,
            unitVolume: fuelState.typeID > 0 ? resolveFuelTypeVolume(fuelState.typeID) : 0,
            solarSystemID: toInt(nodeResult.item.locationID, 0),
        },
    };
}
/**
 * Session-free, scoped NPC fueling. The exact stack consumption, local fuel
 * reserve/chain intent, and idempotency receipt are one item-table commit.
 */
function depositNpcNetworkNodeFuel(actor, networkNodeID, rawItems, options = {}) {
    const operationKey = String(options.operationKey || "").trim();
    if (!operationKey || operationKey.length > 256) {
        return { success: false, errorMsg: "NPC_FUEL_OPERATION_REQUIRED" };
    }
    const deploymentRuntime = require("./deploymentRuntime");
    const lifecycle = options.jobID
        ? deploymentRuntime.getNpcAssemblyLifecycle(actor, networkNodeID, options.jobID)
        : deploymentRuntime.getNpcAssemblyControlLifecycle(actor, networkNodeID);
    if (!lifecycle.success)
        return lifecycle;
    const node = lifecycle.data.item;
    if (toInt(node.typeID, 0) !== NETWORK_NODE_TYPE_ID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_NETWORK_NODE" };
    }
    const existingInfo = parseCustomInfo(node.customInfo);
    const receipts = Array.isArray(existingInfo.evejsNpcNetworkNodeFuelReceipts)
        ? existingInfo.evejsNpcNetworkNodeFuelReceipts
        : [];
    const previousReceipt = receipts.find((entry) => entry.operationKey === operationKey);
    if (previousReceipt) {
        return { success: true, data: { ...previousReceipt, idempotent: true } };
    }
    const requests = Array.isArray(rawItems) ? rawItems : [];
    if (requests.length === 0) {
        return { success: false, errorMsg: "NETWORK_NODE_FUEL_REQUIRED" };
    }
    let fuelTypeID = 0;
    let totalQuantity = 0;
    const consumptions = [];
    for (const request of requests) {
        const item = itemStore.findItemById(toInt(request && request.itemID, 0));
        const quantity = toInt(request && request.quantity, 0);
        if (!item || quantity <= 0 || quantity > (toInt(item.singleton, 0) === 1
            ? 1
            : toInt(item.stacksize ?? item.quantity, 0))) {
            return { success: false, errorMsg: "INSUFFICIENT_SOURCE_FUEL" };
        }
        if (request.ownerID != null && toInt(request.ownerID, 0) !== toInt(item.ownerID, 0) ||
            request.locationID != null && toInt(request.locationID, 0) !== toInt(item.locationID, 0) ||
            request.flagID != null && toInt(request.flagID, -1) !== toInt(item.flagID, -1)) {
            return { success: false, errorMsg: "SOURCE_ITEM_NOT_FOUND" };
        }
        const typeID = toInt(item.typeID, 0);
        if (!fuelTypeID)
            fuelTypeID = typeID;
        if (typeID !== fuelTypeID)
            return { success: false, errorMsg: "MIXED_FUEL_TYPES" };
        totalQuantity += quantity;
        consumptions.push({
            itemID: item.itemID,
            quantity,
            expected: {
                ownerID: item.ownerID,
                locationID: item.locationID,
                flagID: item.flagID,
                typeID,
            },
        });
    }
    if (!isAcceptedNetworkNodeFuelType(fuelTypeID)) {
        return { success: false, errorMsg: "UNSUPPORTED_FUEL_TYPE" };
    }
    const currentFuel = calculateNetworkNodeFuelBurn(node).state;
    const chainFuel = readSuiNetworkNodeFuel(node);
    if (chainFuel?.pending)
        return { success: false, errorMsg: "ASSEMBLY_STATE_PENDING" };
    if ((currentFuel.quantity > 0 && currentFuel.typeID !== fuelTypeID) ||
        (chainFuel?.quantity > 0 && chainFuel.typeID !== fuelTypeID)) {
        return { success: false, errorMsg: "MIXED_FUEL_TYPES" };
    }
    const unitVolume = resolveFuelTypeVolume(fuelTypeID);
    if (!(unitVolume > 0))
        return { success: false, errorMsg: "UNSUPPORTED_FUEL_TYPE" };
    const nextQuantity = currentFuel.quantity + totalQuantity;
    if (nextQuantity * unitVolume >
        getNetworkNodeFuelAttributes().fuelMaxCapacityVolume + CAPACITY_VOLUME_EPSILON) {
        return { success: false, errorMsg: "FUEL_CAPACITY_EXCEEDED" };
    }
    const depositedAtMs = Date.now();
    const commit = itemStore.consumeInventoryItemsAndUpdateItem(consumptions, node.itemID, (currentNode) => {
        const info = parseCustomInfo(currentNode.customInfo);
        const observation = info[SUI_FUEL_INFO_KEY];
        if (observation) {
            if (observation.pending)
                throw new Error("ASSEMBLY_STATE_PENDING");
            observation.pending = {
                id: crypto.randomUUID(),
                typeID: fuelTypeID,
                quantityDelta: totalQuantity,
            };
            info[SUI_FUEL_INFO_KEY] = observation;
            info[FUEL_INFO_KEY] = projectedSuiFuel(observation);
        }
        else {
            info[FUEL_INFO_KEY] = {
                ...currentFuel,
                typeID: fuelTypeID,
                quantity: nextQuantity,
                updatedAtMs: depositedAtMs,
                burnUpdatedAtMs: currentFuel.quantity > 0
                    ? currentFuel.burnUpdatedAtMs
                    : depositedAtMs,
                burnTypeID: fuelTypeID,
            };
        }
        const prior = Array.isArray(info.evejsNpcNetworkNodeFuelReceipts)
            ? info.evejsNpcNetworkNodeFuelReceipts
            : [];
        info.evejsNpcNetworkNodeFuelReceipts = [...prior, {
                operationKey,
                actorID: Number(actor.actorID),
                factionKey: String(actor.factionKey),
                fuelTypeID,
                depositedQuantity: totalQuantity,
                depositedAtMs,
            }].slice(-32);
        return { ...currentNode, customInfo: JSON.stringify(info) };
    }, { flush: true });
    if (!commit.success)
        return commit;
    publishFuelChanged(commit.data.item);
    return {
        success: true,
        data: {
            networkNodeID: node.itemID,
            fuelTypeID,
            depositedQuantity: totalQuantity,
            quantity: nextQuantity,
            operationKey,
            changes: commit.data.changes,
        },
    };
}
module.exports = {
    FUEL_INFO_KEY,
    SUI_FUEL_INFO_KEY,
    readSuiNetworkNodeFuel,
    readSuiNetworkNodeFuelIntent,
    projectSuiNetworkNodeFuel,
    initializeSuiNetworkNodeFuel,
    acknowledgeSuiNetworkNodeFuel,
    getPendingNetworkNodeFuelTransactionNodeID,
    NETWORK_NODE_TYPE_ID,
    NETWORK_NODE_FUEL_BAY_FLAG,
    NETWORK_NODE_FUEL_CONFIG,
    calculateNetworkNodeFuelBurn,
    settleNetworkNodeFuel,
    settleAllNetworkNodeFuel,
    startNetworkNodeFuelBurn,
    registerFuelNoticePublisher(publisher) { fuelNoticePublisher = publisher; },
    publishFuelBurn,
    executeNetworkNodeFuelTransaction,
    getNetworkNodeFuelAttributes,
    getNetworkNodeFuelConfig,
    getNetworkNodeFuelStatus,
    isAcceptedNetworkNodeFuelType,
    prepareNetworkNodeFuelDeposit,
    prepareNetworkNodeFuelWithdraw,
    validateNetworkNodeFuelInventory,
    depositNetworkNodeFuelFromInventory,
    withdrawNetworkNodeFuelToInventory,
    depositNpcNetworkNodeFuel,
    readNetworkNodeFuelState,
    writeNetworkNodeFuelState,
    _testing: {
        clearPendingFuelTransactions() {
            pendingFuelTransactions.clear();
        },
        getPendingFuelTransactions() {
            return pendingFuelTransactions;
        },
        validateFuelDeposit,
        validateFuelWithdraw,
    },
};
//# sourceMappingURL=networkNodeFuelRuntime.js.map