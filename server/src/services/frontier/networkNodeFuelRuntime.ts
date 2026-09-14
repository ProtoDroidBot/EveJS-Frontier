"use strict";

/** A validation failure has no successful payload fields. */
type ValidationResult<T> =
  | (T & { errorMsg?: never; params?: never })
  | ({ errorMsg: string; params?: Record<string, number> } &
      { [Key in keyof T]?: never });

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
 * The assembly sync worker mirrors the resulting reserve onto Sui.
 */

const crypto = require("crypto");
const path = require("path");

const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../inventory/itemTypeRegistry",
));
const {
  ASSEMBLY_STATUS_OFFLINE,
  ASSEMBLY_STATUS_ONLINE,
  buildAssemblyTransitionTransactionData,
  isValidAssemblyTransitionSignature,
  readConstructionState,
} = require(path.join(__dirname, "./deploymentRuntime"));
const { readStaticRows, TABLE } = require(path.join(
  __dirname,
  "../_shared/referenceData",
));

const NETWORK_NODE_TYPE_ID = 88092;
const FUEL_INFO_KEY = "evejsFrontierNetworkNodeFuel";
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
let fuelTimer: ReturnType<typeof setInterval> | null = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
  } catch (_) {
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
      fuelMaxCapacityVolume: Math.max(
        1,
        toFiniteNumber(
          component && component.fuelMaxCapacity,
          DEFAULT_FUEL_MAX_CAPACITY_VOLUME,
        ),
      ),
      fuelBurnRateInSeconds: Math.max(
        1,
        toFiniteNumber(
          component && component.fuelBurnRateInSeconds,
          DEFAULT_FUEL_BURN_RATE_SECONDS,
        ),
      ),
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
  const raw = info[FUEL_INFO_KEY];
  const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    typeID: toInt(state.typeID, 0),
    quantity: Math.max(0, toInt(state.quantity, 0)),
    updatedAtMs: toInt(state.updatedAtMs, 0),
    burnUpdatedAtMs: Math.max(0, toInt(state.burnUpdatedAtMs, 0)),
    burnRemainderMs: Math.max(0, toInt(state.burnRemainderMs, 0)),
    burnTypeID: toInt(state.burnTypeID, toInt(state.typeID, 0)),
  };
}

function writeNetworkNodeFuelState(itemID, state) {
  return itemStore.updateInventoryItem(itemID, (currentItem) => {
    const info = parseCustomInfo(currentItem.customInfo);
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
    } else {
      delete info[FUEL_INFO_KEY];
    }
    return {
      ...currentItem,
      customInfo: JSON.stringify(info),
    };
  });
}

/** Pure accounting shared by ticks and status transitions inside a store update. */
function calculateNetworkNodeFuelBurn(item, nowMs = Date.now()) {
  const state = readNetworkNodeFuelState(item);
  const efficiency = NETWORK_NODE_FUEL_CONFIG.find(entry => entry.typeID === state.typeID)?.efficiency;
  if (!state.quantity || !efficiency) return { state, consumedQuantity: 0 };
  // Older reserves have no online-time history. Start now instead of charging
  // for time that may have been spent offline before this feature existed.
  const now = Math.max(state.burnUpdatedAtMs, toInt(nowMs, Date.now()));
  const online = readConstructionState(item)?.assemblyStatus === ASSEMBLY_STATUS_ONLINE;
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
  if (!fuelNoticePublisher || consumedQuantity <= 0) return;
  const fuel = readNetworkNodeFuelState(item);
  try {
    fuelNoticePublisher({
      characterID: toInt(item.ownerID), networkNodeID: toInt(item.itemID),
      solarSystemID: toInt(item.locationID), fuelTypeID: fuel.typeID, quantity: fuel.quantity,
      unitVolume: fuel.typeID > 0 ? resolveFuelTypeVolume(fuel.typeID) : 0,
    });
  } catch (error) {
    require("../../utils/logger").warn(`[NetworkNodeFuel] Notice failed: ${error.message}`);
  }
}

/** Persist the deduction and exhaustion status together; never charge twice. */
function settleNetworkNodeFuel(itemID, nowMs = Date.now()) {
  const item = itemStore.findItemById(itemID);
  if (!item || toInt(item.typeID) !== NETWORK_NODE_TYPE_ID) {
    return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
  }
  const calculated = calculateNetworkNodeFuelBurn(item, nowMs);
  const online = readConstructionState(item)?.assemblyStatus === ASSEMBLY_STATUS_ONLINE;
  if (!calculated.state.quantity && !calculated.consumedQuantity && !online) {
    return { success: true as const, data: item, consumedQuantity: 0 };
  }
  const previous = readNetworkNodeFuelState(item);
  // A running anchor already includes partial time; only persist a tick once
  // a whole unit is due (or initialize a legacy reserve).
  if (previous.quantity > 0 && previous.burnUpdatedAtMs > 0 && calculated.consumedQuantity === 0) {
    return { success: true as const, data: item, consumedQuantity: 0 };
  }
  const result = itemStore.updateInventoryItem(itemID, currentItem => {
    const info = parseCustomInfo(currentItem.customInfo);
    if (calculated.state.quantity > 0 || calculated.state.burnRemainderMs > 0) info[FUEL_INFO_KEY] = calculated.state;
    else {
      delete info[FUEL_INFO_KEY];
    }
    if (calculated.state.quantity === 0 && online) {
      info.evejsFrontierConstruction.assemblyStatus = ASSEMBLY_STATUS_OFFLINE;
    }
    return { ...currentItem, customInfo: JSON.stringify(info) };
  });
  if (result.success) {
    if (calculated.state.quantity === 0) {
      require("./deploymentRuntime").notifyAssemblyFuelDepleted(result.data, result.previousData);
    } else publishFuelBurn(result.data, calculated.consumedQuantity);
  }
  return { ...result, consumedQuantity: result.success ? calculated.consumedQuantity : 0 };
}

function settleAllNetworkNodeFuel(nowMs = Date.now()) {
  for (const item of Object.values<any>(itemStore.getAllItems())) {
    if (toInt(item.typeID) !== NETWORK_NODE_TYPE_ID) continue;
    const result = settleNetworkNodeFuel(item.itemID, nowMs);
    if (!result.success) throw new Error(`Network Node ${item.itemID} fuel: ${result.errorMsg}`);
  }
}

function startNetworkNodeFuelBurn() {
  const config = require("../../config");
  if (config.clientCompatibilityProfile !== "frontier" || process.env.NODE_TEST_CONTEXT ||
      process.env.EVEJS_TEST_STORE_ISOLATED || process.env.EVEJS_TEST_STORE_BASELINE_ROOT) return null;
  if (fuelTimer) return fuelTimer;
  const tick = () => {
    try { settleAllNetworkNodeFuel(); }
    catch (error) { require("../../utils/logger").warn(`[NetworkNodeFuel] ${error.message}`); }
  };
  tick();
  fuelTimer = setInterval(tick, 1000);
  fuelTimer.unref();
  return fuelTimer;
}

interface FuelDepositContext {
  item: any;
  fuelTypeID: number;
  totalQuantity: number;
  sourceStacks: { itemID: number; quantity: number; typeID: number }[];
  sourceLocationID: number;
  sourceFlag: number;
  fuelState: ReturnType<typeof readNetworkNodeFuelState>;
}

interface FuelWithdrawContext {
  item: any;
  fuelTypeID: number;
  quantity: number;
  destinationID: number;
  destinationFlag: number;
  fuelState: ReturnType<typeof readNetworkNodeFuelState>;
}

function validateFuelNetworkNode(characterID, networkNodeID): ValidationResult<{ item: any; }> {
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
  const settled = settleNetworkNodeFuel(nodeID);
  if (!settled.success) return { errorMsg: settled.errorMsg };
  item = settled.data;
  const constructionState = readConstructionState(item);
  if (
    constructionState.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE &&
    constructionState.assemblyStatus !== ASSEMBLY_STATUS_ONLINE
  ) {
    return { errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
  }
  return { item };
}

function normalizeDepositItems(rawItems) {
  const normalized: any[] = [];
  for (const entry of Array.isArray(rawItems) ? rawItems : []) {
    const itemID = toInt(entry && (entry.itemID ?? entry.item_id), 0);
    const quantity = toInt(entry && entry.quantity, 0);
    if (itemID <= 0 || quantity <= 0) {
      return null;
    }
    const existing = normalized.find((candidate) => candidate.itemID === itemID);
    if (existing) {
      existing.quantity += quantity;
    } else {
      normalized.push({ itemID, quantity });
    }
  }
  return normalized.length > 0 ? normalized : null;
}

/**
 * Validate a deposit request without mutating. Returns the validated context
 * used both at prepare time and again at execute time.
 */
function validateFuelDeposit({
  characterID,
  networkNodeID,
  sourceItemID,
  sourceFlagID,
  items,
}: Record<string, any>): ValidationResult<FuelDepositContext> {
  const nodeResult = validateFuelNetworkNode(characterID, networkNodeID);
  if (nodeResult.errorMsg) {
    return nodeResult as { errorMsg: string };
  }
  const normalizedItems = normalizeDepositItems(items);
  if (!normalizedItems) {
    return { errorMsg: "INVALID_QUANTITY" };
  }
  const sourceLocationID = toInt(sourceItemID, 0);
  const sourceFlag = toInt(sourceFlagID, -1);
  if (sourceLocationID <= 0) {
    return { errorMsg: "INVALID_SOURCE" };
  }

  const ownerID = toInt(characterID, 0);
  let fuelTypeID = 0;
  let totalQuantity = 0;
  const sourceStacks: any[] = [];
  for (const request of normalizedItems) {
    const stack = itemStore.findItemById(request.itemID);
    if (
      !stack ||
      toInt(stack.ownerID, 0) !== ownerID ||
      toInt(stack.locationID, 0) !== sourceLocationID ||
      (sourceFlag >= 0 && toInt(stack.flagID, -1) !== sourceFlag)
    ) {
      return { errorMsg: "SOURCE_ITEM_NOT_FOUND" };
    }
    const stackTypeID = toInt(stack.typeID, 0);
    if (fuelTypeID === 0) {
      fuelTypeID = stackTypeID;
    } else if (fuelTypeID !== stackTypeID) {
      return { errorMsg: "MIXED_FUEL_TYPES" };
    }
    const availableQuantity =
      toInt(stack.singleton, 0) === 1
        ? 1
        : Math.max(0, toInt(stack.stacksize ?? stack.quantity, 0));
    if (request.quantity > availableQuantity) {
      return { errorMsg: "INSUFFICIENT_SOURCE_FUEL" };
    }
    totalQuantity += request.quantity;
    sourceStacks.push({ ...request, typeID: stackTypeID });
  }

  if (!isAcceptedNetworkNodeFuelType(fuelTypeID)) {
    return { errorMsg: "UNSUPPORTED_FUEL_TYPE" };
  }

  const fuelState = calculateNetworkNodeFuelBurn(nodeResult.item).state;
  if (fuelState.quantity > 0 && fuelState.typeID !== fuelTypeID) {
    return { errorMsg: "MIXED_FUEL_TYPES" };
  }

  const unitVolume = resolveFuelTypeVolume(fuelTypeID);
  if (!(unitVolume > 0)) {
    return { errorMsg: "UNSUPPORTED_FUEL_TYPE" };
  }
  const capacityVolume = getNetworkNodeFuelAttributes().fuelMaxCapacityVolume;
  const nextVolume = (fuelState.quantity + totalQuantity) * unitVolume;
  if (nextVolume > capacityVolume + CAPACITY_VOLUME_EPSILON) {
    const remainingUnits = Math.max(
      0,
      Math.floor(
        (capacityVolume / unitVolume) - fuelState.quantity + CAPACITY_VOLUME_EPSILON,
      ),
    );
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

function validateFuelWithdraw({
  characterID,
  networkNodeID,
  fuelTypeID,
  quantity,
  destinationItemID,
  destinationFlagID,
}: Record<string, any>): ValidationResult<FuelWithdrawContext> {
  const nodeResult = validateFuelNetworkNode(characterID, networkNodeID);
  if (nodeResult.errorMsg) {
    return nodeResult as { errorMsg: string };
  }
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
    return { success: false as const, errorMsg: validation.errorMsg, params: validation.params };
  }
  const prepared = createPendingFuelTransaction(
    "networknode-fuel-deposit",
    options.characterID,
    options.networkNodeID,
    {
      characterID: toInt(options.characterID, 0),
      networkNodeID: toInt(options.networkNodeID, 0),
      sourceItemID: toInt(options.sourceItemID, 0),
      sourceFlagID: toInt(options.sourceFlagID, -1),
      items: validation.sourceStacks.map((stack) => ({
        itemID: stack.itemID,
        quantity: stack.quantity,
      })),
    },
  );
  return { success: true as const, data: prepared };
}

function prepareNetworkNodeFuelWithdraw(options) {
  const validation = validateFuelWithdraw(options);
  if (validation.errorMsg) {
    return { success: false as const, errorMsg: validation.errorMsg, params: validation.params };
  }
  const prepared = createPendingFuelTransaction(
    "networknode-fuel-withdraw",
    options.characterID,
    options.networkNodeID,
    {
      characterID: toInt(options.characterID, 0),
      networkNodeID: toInt(options.networkNodeID, 0),
      fuelTypeID: validation.fuelTypeID,
      quantity: validation.quantity,
      destinationItemID: validation.destinationID,
      destinationFlagID: validation.destinationFlag,
    },
  );
  return { success: true as const, data: prepared };
}

function commitFuelDeposit(transaction) {
  const validation = validateFuelDeposit(transaction.request);
  if (validation.errorMsg) {
    return { success: false as const, errorMsg: validation.errorMsg, params: validation.params };
  }

  const changes: any[] = [];
  const consumed: any[] = [];
  for (const stack of validation.sourceStacks) {
    const result = itemStore.consumeInventoryItemQuantity(stack.itemID, stack.quantity);
    if (!result || result.success !== true) {
      for (const restore of consumed.reverse()) {
        itemStore.grantItemsToCharacterLocation(
          transaction.request.characterID,
          transaction.request.sourceItemID,
          Math.max(0, transaction.request.sourceFlagID),
          [{ itemType: validation.fuelTypeID, quantity: restore.quantity }],
        );
      }
      return {
        success: false as const,
        errorMsg: result && result.errorMsg ? result.errorMsg : "FUEL_CONSUME_FAILED",
      };
    }
    consumed.push(stack);
    changes.push(...((result.data && result.data.changes) || []));
  }

  const nextQuantity = validation.fuelState.quantity + validation.totalQuantity;
  const writeResult = writeNetworkNodeFuelState(transaction.request.networkNodeID, {
    ...validation.fuelState,
    typeID: validation.fuelTypeID,
    quantity: nextQuantity,
    updatedAtMs: Date.now(),
    burnUpdatedAtMs: validation.fuelState.quantity > 0 ? validation.fuelState.burnUpdatedAtMs : Date.now(),
  });
  if (!writeResult || writeResult.success !== true) {
    for (const restore of consumed.reverse()) {
      itemStore.grantItemsToCharacterLocation(
        transaction.request.characterID,
        transaction.request.sourceItemID,
        Math.max(0, transaction.request.sourceFlagID),
        [{ itemType: validation.fuelTypeID, quantity: restore.quantity }],
      );
    }
    return {
      success: false as const,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "FUEL_STATE_WRITE_FAILED",
    };
  }

  return {
    success: true as const,
    data: {
      networkNodeID: transaction.request.networkNodeID,
      fuelTypeID: validation.fuelTypeID,
      quantity: nextQuantity,
      depositedQuantity: validation.totalQuantity,
      solarSystemID: toInt(validation.item.locationID, 0),
      changes,
    },
  };
}

function commitFuelWithdraw(transaction) {
  const validation = validateFuelWithdraw(transaction.request);
  if (validation.errorMsg) {
    return { success: false as const, errorMsg: validation.errorMsg, params: validation.params };
  }

  const nextQuantity = validation.fuelState.quantity - validation.quantity;
  const writeResult = writeNetworkNodeFuelState(transaction.request.networkNodeID, {
    ...validation.fuelState,
    typeID: validation.fuelTypeID,
    quantity: nextQuantity,
    updatedAtMs: Date.now(),
  });
  if (!writeResult || writeResult.success !== true) {
    return {
      success: false as const,
      errorMsg: writeResult && writeResult.errorMsg
        ? writeResult.errorMsg
        : "FUEL_STATE_WRITE_FAILED",
    };
  }

  const grantResult = itemStore.grantItemsToCharacterLocation(
    transaction.request.characterID,
    validation.destinationID,
    validation.destinationFlag,
    [{ itemType: validation.fuelTypeID, quantity: validation.quantity }],
  );
  if (!grantResult || grantResult.success !== true) {
    writeNetworkNodeFuelState(transaction.request.networkNodeID, {
      ...validation.fuelState,
    });
    return {
      success: false as const,
      errorMsg: grantResult && grantResult.errorMsg
        ? grantResult.errorMsg
        : "FUEL_WITHDRAW_GRANT_FAILED",
    };
  }

  const changes = (grantResult.data && grantResult.data.changes) || [];
  if (nextQuantity === 0) {
    require("./deploymentRuntime").offlineAssemblyForFuelDepletion(transaction.request.networkNodeID);
  }
  return {
    success: true as const,
    data: {
      networkNodeID: transaction.request.networkNodeID,
      fuelTypeID: validation.fuelTypeID,
      quantity: nextQuantity,
      withdrawnQuantity: validation.quantity,
      solarSystemID: toInt(validation.item.locationID, 0),
      changes,
    },
  };
}

/**
 * Execute a prepared fuel transaction exactly once. The pending entry is
 * consumed only when the commit succeeds, so a client retry after a
 * validation failure re-runs against unchanged state, while a duplicate
 * request after success cannot double-commit.
 */
function executeNetworkNodeFuelTransaction({
  action,
  characterID,
  transactionUUID,
  signature,
}: Record<string, any>) {
  prunePendingFuelTransactions();
  const normalizedUUID = String(transactionUUID || "").trim().toLowerCase();
  const transaction = normalizedUUID
    ? pendingFuelTransactions.get(normalizedUUID)
    : null;
  if (!transaction || transaction.expiresAtMs <= Date.now()) {
    return { success: false as const, errorMsg: "TRANSACTION_NOT_FOUND" };
  }
  if (
    transaction.action !== action ||
    transaction.characterID !== toInt(characterID, 0)
  ) {
    return { success: false as const, errorMsg: "TRANSACTION_MISMATCH" };
  }
  if (!isValidAssemblyTransitionSignature(signature)) {
    return { success: false as const, errorMsg: "INVALID_SIGNATURE" };
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
    return { success: false as const, errorMsg: nodeResult.errorMsg };
  }
  const fuelState = readNetworkNodeFuelState(nodeResult.item);
  return {
    success: true as const,
    data: {
      typeID: fuelState.typeID,
      quantity: fuelState.quantity,
      unitVolume: fuelState.typeID > 0 ? resolveFuelTypeVolume(fuelState.typeID) : 0,
      solarSystemID: toInt(nodeResult.item.locationID, 0),
    },
  };
}

module.exports = {
  FUEL_INFO_KEY,
  NETWORK_NODE_TYPE_ID,
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
