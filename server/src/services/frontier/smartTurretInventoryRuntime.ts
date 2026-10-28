"use strict";

/**
 * Owner cargo exposed by deployed Smart Turrets.
 *
 * Turrets do not have the per-character flag-66 inventories used by Smart
 * Storage Units on Sui. Their ordinary flag-0 container is instead bounded by
 * the turret type's authored SDE capacity and remains owner-only.
 */

const path = require("path");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { TABLE, readStaticRows } = require(path.join(__dirname, "../_shared/referenceData"));
const {
  ASSEMBLY_STATUS_OFFLINE,
  ASSEMBLY_STATUS_ONLINE,
  ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
  isAssemblyActivationPending,
  readConstructionState,
} = require(path.join(__dirname, "./deploymentRuntime"));

const SMART_TURRET_INVENTORY_FLAG = 0;
let turretTypeIDs: Set<number> | null = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : fallback;
}

function getTurretTypeIDs(): Set<number> {
  if (turretTypeIDs) return turretTypeIDs;
  turretTypeIDs = new Set();
  for (const row of readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE)) {
    const typeID = toInt(row && (row._key ?? row.typeID), 0);
    if (typeID > 0 && row?.smartTurret && typeof row.smartTurret === "object") {
      turretTypeIDs.add(typeID);
    }
  }
  return turretTypeIDs;
}

function getTurretComponent(typeID) {
  return getTurretTypeIDs().has(toInt(typeID, 0)) ? { smartTurret: true } : null;
}

function validateTurretInventory(characterID, turretID, options: Record<string, any> = {}) {
  const numericCharacterID = toInt(characterID, 0);
  const numericTurretID = toInt(turretID, 0);
  if (numericCharacterID <= 0) return { errorMsg: "ACCESS_DENIED" };
  if (numericTurretID <= 0) return { errorMsg: "INVALID_ASSEMBLY_ID" };

  const item = itemStore.findItemById(numericTurretID);
  const state = readConstructionState(item);
  const typeID = toInt(item?.typeID, 0);
  if (!item || !state || toInt(state.assemblyTypeID, 0) !== typeID || !getTurretComponent(typeID)) {
    return { errorMsg: "ASSEMBLY_NOT_FOUND" };
  }
  if (toInt(item.ownerID, 0) !== numericCharacterID) return { errorMsg: "ACCESS_DENIED" };
  if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
    return { errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
  }
  if (isAssemblyActivationPending(item)) return { errorMsg: "ASSEMBLY_ACTIVATING" };
  if (options.refreshingStatus !== true &&
      state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE &&
      state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
    return { errorMsg: "ASSEMBLY_UNAVAILABLE" };
  }
  if (options.requireOnline === true && state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
    return { errorMsg: "ASSEMBLY_OFFLINE" };
  }

  const access = options.access;
  if (!access || access.authorized !== true) return { errorMsg: "ACCESS_DENIED" };
  const solarSystemID = toInt(access.solarSystemID, 0);
  if (solarSystemID <= 0) return { errorMsg: "ACCESS_DENIED" };
  if (toInt(state.solarSystemID, 0) !== solarSystemID) {
    return { errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
  }
  if (access.inRange !== true) return { errorMsg: "ASSEMBLY_OUT_OF_RANGE" };

  const metadata = itemStore.getItemMetadata(typeID) || {};
  const capacity = Number(item.capacity ?? metadata.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) return { errorMsg: "INVALID_INVENTORY" };
  return { item, state, capacity, flagID: SMART_TURRET_INVENTORY_FLAG };
}

module.exports = {
  SMART_TURRET_INVENTORY_FLAG,
  getTurretComponent,
  validateTurretInventory,
  _testing: {
    clearTurretComponentCache() {
      turretTypeIDs = null;
    },
  },
};
