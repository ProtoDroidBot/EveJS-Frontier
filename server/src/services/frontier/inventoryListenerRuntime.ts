"use strict";

/**
 * Read-only inventory conditions used by Smart Storage task-queue listeners.
 *
 * The resolver intentionally reuses Industry's narrow inventory access rules:
 * a character may inspect their current ship, a nearby owned cargo container or
 * Field Storage, their partition in a nearby Smart Storage Unit, or the input /
 * output escrow of their own nearby Industry assembly. It never falls back to a
 * generic container read because that would expose arbitrary private contents.
 */

const itemStore = require("../inventory/itemStore");
const inventoryAccess = require("./industryInventoryAccess");
const industryRuntime = require("./industryRuntime");
const { SMART_STORAGE_FLAG } = require("./smartStorageUnitRuntime");

const CARGO_FLAG = 5;
const TARGET_KINDS = new Set(["smart-assembly", "cargo"]);
const SMART_INVENTORIES = new Set(["storage", "inputs", "outputs"]);

function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function requestInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : 0;
}

function itemQuantity(item) {
  return Number(item?.singleton) === 1
    ? 1
    : positiveInteger(item?.stacksize ?? item?.quantity);
}

function defaultDependencies() {
  return {
    findItemById: itemStore.findItemById,
    listContainerItems: itemStore.listContainerItems,
    getItemMetadata: itemStore.getItemMetadata,
    getInventoryItemUnitVolume: itemStore.getInventoryItemUnitVolume,
    resolveInventory: inventoryAccess.resolveIndustryInventory,
    validateFacility: industryRuntime.validateFacility,
    now: Date.now,
  };
}

function fail(errorMsg) {
  return { success: false as const, errorMsg };
}

function normalizeRequest(request) {
  const targetKind = String(request?.targetKind || "");
  const inventory = String(request?.inventory || "");
  const targetID = requestInteger(request?.targetID);
  const rawRequested = Array.isArray(request?.requested) ? request.requested : [];
  if (!TARGET_KINDS.has(targetKind) || !targetID || !rawRequested.length || rawRequested.length > 100) {
    return null;
  }
  if ((targetKind === "smart-assembly" && !SMART_INVENTORIES.has(inventory)) ||
      (targetKind === "cargo" && inventory !== "cargo")) {
    return null;
  }
  const seen = new Set();
  const requested: Array<{ typeID: number; quantity: number }> = [];
  for (const value of rawRequested) {
    const typeID = requestInteger(value?.typeID, 0xffff_ffff);
    const quantity = requestInteger(value?.quantity, 0xffff_ffff);
    if (!typeID || !quantity || seen.has(typeID)) return null;
    seen.add(typeID);
    requested.push({ typeID, quantity });
  }
  return { targetKind, inventory, targetID, requested };
}

export function createInventoryListenerReader(overrides: Record<string, any> = {}) {
  const dependencies = { ...defaultDependencies(), ...overrides };
  return function readInventoryListener(session, rawRequest) {
    const request = normalizeRequest(rawRequest);
    if (!request) return fail("INVALID_LISTENER_REQUEST");
    const characterID = positiveInteger(session?.characterID || session?.charid);
    const shipID = positiveInteger(session?._space?.shipID || session?.shipid || session?.shipID);
    if (!characterID || !shipID) return fail("ACCESS_DENIED");

    let target;
    let flagID;
    let ownerID = characterID;
    let capacity = 0;
    if (request.targetKind === "cargo") {
      flagID = request.targetID === shipID ? CARGO_FLAG : 0;
      const resolved = dependencies.resolveInventory(session, request.targetID, flagID, {
        refreshingStatus: true,
      });
      if (!resolved?.success) return fail(resolved?.errorMsg || "INVALID_INVENTORY");
      target = resolved.data.item;
      ownerID = positiveInteger(resolved.data.inventoryOwnerID) || characterID;
      capacity = Number(resolved.data.capacity) || 0;
    } else if (request.inventory === "storage") {
      flagID = SMART_STORAGE_FLAG;
      const resolved = dependencies.resolveInventory(session, request.targetID, flagID, {
        refreshingStatus: true,
      });
      if (!resolved?.success) return fail(resolved?.errorMsg || "INVALID_INVENTORY");
      target = resolved.data.item;
      ownerID = positiveInteger(resolved.data.inventoryOwnerID) || characterID;
      capacity = Number(resolved.data.capacity) || 0;
    } else {
      const resolved = dependencies.validateFacility(session, request.targetID);
      if (!resolved?.success) return fail(resolved?.errorMsg || "INVALID_INVENTORY");
      target = resolved.data.facility;
      ownerID = characterID;
      flagID = request.inventory === "inputs"
        ? industryRuntime.INDUSTRY_INPUT_FLAG
        : industryRuntime.INDUSTRY_OUTPUT_FLAG;
    }
    if (!target || positiveInteger(target.itemID) !== request.targetID) {
      return fail("INVALID_INVENTORY");
    }

    const totals = new Map<number, { typeID: number; typeName: string; quantity: number; unitVolume: number }>();
    for (const item of dependencies.listContainerItems(ownerID, request.targetID, flagID)) {
      const typeID = positiveInteger(item?.typeID);
      const quantity = itemQuantity(item);
      if (!typeID || !quantity) continue;
      const existing = totals.get(typeID);
      const next = (existing?.quantity || 0) + quantity;
      if (!Number.isSafeInteger(next)) return fail("INVALID_INVENTORY");
      const metadata = dependencies.getItemMetadata(typeID) || {};
      totals.set(typeID, {
        typeID,
        typeName: existing?.typeName || metadata.name || `Type ${typeID}`,
        quantity: next,
        unitVolume: existing?.unitVolume ?? Math.max(0, Number(dependencies.getInventoryItemUnitVolume(item)) || 0),
      });
    }
    const items = [...totals.values()].sort((left, right) => left.typeID - right.typeID);
    const matched = request.requested.map(expected => ({
      ...expected,
      available: totals.get(expected.typeID)?.quantity || 0,
    }));
    const usedVolume = items.reduce((sum, item) => sum + item.quantity * item.unitVolume, 0);
    const metadata = dependencies.getItemMetadata(target.typeID) || {};
    return {
      success: true as const,
      data: {
        targetID: request.targetID,
        targetKind: request.targetKind,
        inventory: request.inventory,
        targetName: String(target.name || metadata.name || `Item ${request.targetID}`),
        capacity: Math.max(0, capacity),
        usedVolume,
        requested: request.requested,
        matched,
        items,
        satisfied: matched.every(item => item.available >= item.quantity),
        observedAtMs: dependencies.now(),
      },
    };
  };
}

export const readInventoryListener = createInventoryListenerReader();
