"use strict";

/** Local, owner-only cargo bay used by the non-chain Field Storage deployable. */

const path = require("path");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { TABLE, readStaticRows } = require(path.join(__dirname, "../_shared/referenceData"));
const {
  ASSEMBLY_STATUS_ONLINE,
  ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
  isAssemblyActivationPending,
  readConstructionState,
} = require(path.join(__dirname, "./deploymentRuntime"));

const FIELD_STORAGE_INVENTORY_FLAG = 0;
let fieldStorageByTypeID: Map<number, any> | null = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : fallback;
}

function getFieldStorageComponents(): Map<number, any> {
  if (fieldStorageByTypeID) return fieldStorageByTypeID;
  fieldStorageByTypeID = new Map();
  for (const row of readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE)) {
    const typeID = toInt(row && (row._key ?? row.typeID), 0);
    const cargoBay = row?.cargoBay;
    const smartDeployable = row?.smartDeployable;
    // Field Storage is the off-chain smart deployable with a cargo bay. A
    // cargoBay component alone also appears on unrelated NPCs/deployables and
    // must not make those items valid player transfer endpoints.
    if (typeID > 0 && cargoBay && typeof cargoBay === "object" &&
        smartDeployable && typeof smartDeployable === "object" &&
        toInt(smartDeployable.createOnChain, -1) === 0) {
      fieldStorageByTypeID.set(typeID, {
        accessRange: Math.max(0, Number(cargoBay.accessRange) || 0),
        allowUserAdd: toInt(cargoBay.allowUserAdd, 0) === 1,
        allowUserTake: toInt(cargoBay.allowUserTake, 0) === 1,
      });
    }
  }
  return fieldStorageByTypeID;
}

function getFieldStorageComponent(typeID) {
  return getFieldStorageComponents().get(toInt(typeID, 0)) || null;
}

function validateFieldStorageInventory(characterID, storageID, options: Record<string, any> = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const numericStorageID = toInt(storageID, 0);
  if (numericCharacterID <= 0) return { errorMsg: "ACCESS_DENIED" };
  if (numericStorageID <= 0) return { errorMsg: "INVALID_INVENTORY" };
  const item = itemStore.findItemById(numericStorageID);
  const state = readConstructionState(item);
  const typeID = toInt(item?.typeID, 0);
  const component = getFieldStorageComponent(typeID);
  if (!item || !state || toInt(state.assemblyTypeID, 0) !== typeID || !component) {
    return { errorMsg: "INVALID_INVENTORY" };
  }
  if (toInt(item.ownerID, 0) !== numericCharacterID) return { errorMsg: "ACCESS_DENIED" };
  if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
    return { errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
  }
  if (isAssemblyActivationPending(item)) return { errorMsg: "ASSEMBLY_ACTIVATING" };
  if (state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) return { errorMsg: "ASSEMBLY_OFFLINE" };
  const access = options.access;
  if (!access || access.authorized !== true || toInt(access.solarSystemID, 0) <= 0) {
    return { errorMsg: "ACCESS_DENIED" };
  }
  if (toInt(state.solarSystemID, 0) !== toInt(access.solarSystemID, 0)) {
    return { errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
  }
  if (access.inRange !== true) return { errorMsg: "ASSEMBLY_OUT_OF_RANGE" };
  const metadata = itemStore.getItemMetadata(typeID) || {};
  const capacity = Number(item.capacity ?? metadata.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return { errorMsg: "INVALID_INVENTORY" };
  return { item, state, component, capacity, flagID: FIELD_STORAGE_INVENTORY_FLAG };
}

module.exports = {
  FIELD_STORAGE_INVENTORY_FLAG,
  getFieldStorageComponent,
  validateFieldStorageInventory,
  _testing: {
    clearFieldStorageComponentCache() {
      fieldStorageByTypeID = null;
    },
  },
};
