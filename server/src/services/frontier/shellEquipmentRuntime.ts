const path = require("path");

const {
  findItemById,
  listCharacterItems,
  listContainerItems,
  moveItemToLocation,
  removeInventoryItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  bumpDogmaInvalidationVersion,
} = require(path.join(__dirname, "../character/dogmaInvalidationVersion"));

// inventorycommon.const in the Frontier client.
const SHELL_CATEGORY_ID = 2153;
const DEFAULT_SHELL_TYPE_ID = 91969;
const SHELL_EQUIPMENT_FLAG_ID = 89;
const SHELL_NEURAL_IMPLANT_GROUP_ID = 5075;
const SHELL_CROWN_GROUP_ID = 5076;
const SHELL_RAIMENT_GROUP_ID = 5107;

const SHELL_EQUIPMENT_KIND = Object.freeze({
  IMPLANT: "implant",
  RAIMENT: "raiment",
});

const equipmentGroupOverridesForTests = new Map();

function toPositiveInt(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getItemGroupID(item) {
  const directGroupID = toPositiveInt(item && item.groupID);
  if (directGroupID > 0) {
    return directGroupID;
  }
  const typeID = toPositiveInt(item && item.typeID);
  if (
    process.env.EVEJS_TEST_STORE_ISOLATED === "1" &&
    equipmentGroupOverridesForTests.has(typeID)
  ) {
    return equipmentGroupOverridesForTests.get(typeID);
  }
  const metadata = typeID > 0 ? resolveItemByTypeID(typeID) : null;
  return toPositiveInt(metadata && metadata.groupID);
}

function isShellItem(item) {
  return Boolean(
    item &&
    (
      Number(item.categoryID) === SHELL_CATEGORY_ID ||
      Number(item.typeID) === DEFAULT_SHELL_TYPE_ID
    )
  );
}

function getShellEquipmentKind(item) {
  switch (getItemGroupID(item)) {
    case SHELL_NEURAL_IMPLANT_GROUP_ID:
      return SHELL_EQUIPMENT_KIND.IMPLANT;
    case SHELL_RAIMENT_GROUP_ID:
      return SHELL_EQUIPMENT_KIND.RAIMENT;
    default:
      return null;
  }
}

function isShellCrown(item) {
  return getItemGroupID(item) === SHELL_CROWN_GROUP_ID;
}

function listOwnedShells(characterID) {
  const numericCharacterID = toPositiveInt(characterID);
  if (numericCharacterID <= 0) {
    return [];
  }
  return listCharacterItems(numericCharacterID)
    .filter(isShellItem)
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
}

function getActiveShell(characterID) {
  return listOwnedShells(characterID)[0] || null;
}

function listShellEquipment(characterID, shellID) {
  const numericCharacterID = toPositiveInt(characterID);
  const numericShellID = toPositiveInt(shellID);
  if (numericCharacterID <= 0 || numericShellID <= 0) {
    return [];
  }
  return listContainerItems(
    numericCharacterID,
    numericShellID,
    SHELL_EQUIPMENT_FLAG_ID,
  )
    .filter((item) => Boolean(getShellEquipmentKind(item)))
    .sort((left, right) => Number(left.itemID) - Number(right.itemID));
}

function listActiveShellEquipment(characterID) {
  const shell = getActiveShell(characterID);
  return shell ? listShellEquipment(characterID, shell.itemID) : [];
}

function getEquippedItemByKind(characterID, shellID, kind) {
  return listShellEquipment(characterID, shellID)
    .find((item) => getShellEquipmentKind(item) === kind) || null;
}

function getActiveShellEquipmentByKind(characterID, kind) {
  const shell = getActiveShell(characterID);
  return shell
    ? getEquippedItemByKind(characterID, shell.itemID, kind)
    : null;
}

function equipActiveShellItem(characterID, itemID, expectedKind) {
  const numericCharacterID = toPositiveInt(characterID);
  const numericItemID = toPositiveInt(itemID);
  const shell = getActiveShell(numericCharacterID);
  if (!shell) {
    return { success: false as const, errorMsg: "SHELL_NOT_FOUND" };
  }

  const item = findItemById(numericItemID);
  if (!item) {
    return { success: false as const, errorMsg: "ITEM_NOT_FOUND" };
  }
  if (Number(item.ownerID) !== numericCharacterID) {
    return { success: false as const, errorMsg: "ITEM_NOT_OWNED" };
  }
  if (isShellCrown(item)) {
    return { success: false as const, errorMsg: "CROWN_UNSUPPORTED" };
  }

  const kind = getShellEquipmentKind(item);
  if (!kind || (expectedKind && kind !== expectedKind)) {
    return { success: false as const, errorMsg: "INVALID_EQUIPMENT_TYPE" };
  }
  if (
    Number(item.locationID) === Number(shell.itemID) &&
    Number(item.flagID) === SHELL_EQUIPMENT_FLAG_ID
  ) {
    return { success: false as const, errorMsg: "ALREADY_EQUIPPED" };
  }
  if (Number(item.flagID) === SHELL_EQUIPMENT_FLAG_ID) {
    return { success: false as const, errorMsg: "EQUIPPED_ON_ANOTHER_SHELL" };
  }
  if (getEquippedItemByKind(numericCharacterID, shell.itemID, kind)) {
    return { success: false as const, errorMsg: "SLOT_OCCUPIED" };
  }

  const moveResult = moveItemToLocation(
    numericItemID,
    shell.itemID,
    SHELL_EQUIPMENT_FLAG_ID,
    1,
    { affectsFitting: true },
  );
  if (!moveResult || moveResult.success !== true) {
    return {
      success: false as const,
      errorMsg: moveResult && moveResult.errorMsg || "MOVE_FAILED",
    };
  }

  const equippedItem = findItemById(moveResult.data && moveResult.data.movedItemID);
  return {
    success: true as const,
    data: {
      shell,
      item: equippedItem,
      kind,
      changes: Array.isArray(moveResult.data && moveResult.data.changes)
        ? moveResult.data.changes
        : [],
    },
  };
}

function destroyActiveShellEquipmentByKind(characterID, kind, options: Record<string, any> = {}) {
  const numericCharacterID = toPositiveInt(characterID);
  const shell = getActiveShell(numericCharacterID);
  if (!shell) {
    return { success: false as const, errorMsg: "SHELL_NOT_FOUND" };
  }
  const item = getEquippedItemByKind(numericCharacterID, shell.itemID, kind);
  if (!item) {
    return { success: false as const, errorMsg: "EQUIPMENT_NOT_FOUND" };
  }
  const removal = removeInventoryItem(item.itemID, { removeContents: true });
  if (!removal || removal.success !== true) {
    return {
      success: false as const,
      errorMsg: removal && removal.errorMsg || "REMOVE_FAILED",
    };
  }
  if (options.bumpDogma !== false) {
    bumpDogmaInvalidationVersion();
  }
  return {
    success: true as const,
    data: {
      shell,
      item,
      kind,
      destroyedItems: removal.data && Array.isArray(removal.data.removedItems)
        ? removal.data.removedItems
        : [],
      changes: removal.data && Array.isArray(removal.data.changes)
        ? removal.data.changes
        : [],
    },
  };
}

function destroyShellEquipment(characterID, shellID, options: Record<string, any> = {}) {
  const numericCharacterID = toPositiveInt(characterID);
  const numericShellID = toPositiveInt(shellID);
  const shell = listOwnedShells(numericCharacterID)
    .find((entry) => Number(entry.itemID) === numericShellID) || null;
  if (!shell) {
    return { success: false as const, errorMsg: "SHELL_NOT_FOUND" };
  }

  const equipment = listShellEquipment(numericCharacterID, numericShellID);
  const changes: any[] = [];
  const destroyedItems: any[] = [];
  for (const item of equipment) {
    const removal = removeInventoryItem(item.itemID, { removeContents: true });
    if (!removal || removal.success !== true) {
      return {
        success: false as const,
        errorMsg: removal && removal.errorMsg || "REMOVE_FAILED",
        data: { shell, destroyedItems, changes },
      };
    }
    destroyedItems.push(...(
      removal.data && Array.isArray(removal.data.removedItems)
        ? removal.data.removedItems
        : []
    ));
    changes.push(...(
      removal.data && Array.isArray(removal.data.changes)
        ? removal.data.changes
        : []
    ));
  }

  if (destroyedItems.length > 0 && options.bumpDogma !== false) {
    bumpDogmaInvalidationVersion();
  }
  return {
    success: true as const,
    data: {
      shell,
      reason: String(options.reason || "shell-destroyed"),
      destroyedItems,
      changes,
    },
  };
}

function destroyActiveShellEquipment(characterID, options: Record<string, any> = {}) {
  const shell = getActiveShell(characterID);
  if (!shell) {
    return {
      success: true as const,
      data: { shell: null, reason: String(options.reason || "shell-destroyed"), destroyedItems: [], changes: [] },
    };
  }
  return destroyShellEquipment(characterID, shell.itemID, options);
}

// Ascension itself is still owned by the experience progression service. Its
// eventual successful commit has one explicit destructive lifecycle hook,
// separate from rejected/failed ascension attempts.
function destroyActiveShellEquipmentForAscension(characterID) {
  return destroyActiveShellEquipment(characterID, { reason: "ascension" });
}

function buildActiveShellDogmaRecord(characterID) {
  const numericCharacterID = toPositiveInt(characterID);
  return {
    characterID: numericCharacterID,
    // A shell has two independent equipment slots. Force them to be unslotted
    // here so a dogma implant-slot attribute cannot accidentally make a neural
    // implant replace its raiment (or vice versa) during modifier collection.
    implants: listActiveShellEquipment(numericCharacterID).map((item) => ({
      itemID: Number(item.itemID),
      typeID: Number(item.typeID),
      slot: 0,
      shellEquipmentKind: getShellEquipmentKind(item),
    })),
  };
}

module.exports = {
  DEFAULT_SHELL_TYPE_ID,
  SHELL_CATEGORY_ID,
  SHELL_CROWN_GROUP_ID,
  SHELL_EQUIPMENT_FLAG_ID,
  SHELL_EQUIPMENT_KIND,
  SHELL_NEURAL_IMPLANT_GROUP_ID,
  SHELL_RAIMENT_GROUP_ID,
  buildActiveShellDogmaRecord,
  destroyActiveShellEquipment,
  destroyActiveShellEquipmentForAscension,
  destroyActiveShellEquipmentByKind,
  destroyShellEquipment,
  equipActiveShellItem,
  getActiveShell,
  getActiveShellEquipmentByKind,
  getItemGroupID,
  getShellEquipmentKind,
  isShellCrown,
  isShellItem,
  listActiveShellEquipment,
  listOwnedShells,
  listShellEquipment,
  _testing: {
    clearEquipmentGroupOverrides() {
      equipmentGroupOverridesForTests.clear();
    },
    setEquipmentGroupOverride(typeID, groupID) {
      if (process.env.EVEJS_TEST_STORE_ISOLATED !== "1") {
        throw new Error("Shell equipment type overrides are isolated-test only");
      }
      equipmentGroupOverridesForTests.set(
        toPositiveInt(typeID),
        toPositiveInt(groupID),
      );
    },
  },
};
