const path = require("path");

const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));

const FRONTIER_SALVAGE_MATERIAL_GROUP_ID = 4890;
const FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID = 5133;
const FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY = 5;
const FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY = 20;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function isFrontierSalvageMiningType(groupID) {
  const normalizedGroupID = toPositiveInt(groupID, 0);
  return (
    normalizedGroupID === FRONTIER_SALVAGE_MATERIAL_GROUP_ID ||
    normalizedGroupID === FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID
  );
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function resolveFrontierSalvageResourceQuantity(itemOrTypeID, typeID) {
  const suppliedRecord = itemOrTypeID && typeof itemOrTypeID === "object"
    ? itemOrTypeID
    : null;
  const authoredObjectID = toPositiveInt(
    suppliedRecord && (suppliedRecord.dunObjectID ?? suppliedRecord.objectID),
    0,
  );
  const quantityRange =
    (FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY - FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY) + 1;
  return FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY + (
    hash32(`${typeID}:${authoredObjectID}`) % quantityRange
  );
}

function resolveFrontierSalvageResourceProfile(
  itemOrTypeID,
  options: Record<string, any> = {},
) {
  const resolveType = options.resolveItemByTypeID || resolveItemByTypeID;
  const resolveAttribute = options.getTypeAttributeValue || getTypeAttributeValue;
  const suppliedRecord = itemOrTypeID && typeof itemOrTypeID === "object"
    ? itemOrTypeID
    : null;
  const typeID = toPositiveInt(
    suppliedRecord && suppliedRecord.typeID != null
      ? suppliedRecord.typeID
      : itemOrTypeID,
    0,
  );
  if (typeID <= 0) {
    return null;
  }

  const typeRecord = (
    suppliedRecord && toPositiveInt(suppliedRecord.groupID, 0) > 0
      ? suppliedRecord
      : resolveType(typeID)
  ) || null;
  const groupID = toPositiveInt(typeRecord && typeRecord.groupID, 0);
  if (!typeRecord || groupID !== FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID) {
    return null;
  }

  const authoredOutputTypeID = toPositiveInt(
    resolveAttribute(typeID, "asteroidOutputTypeID"),
    0,
  );
  const yieldTypeID = authoredOutputTypeID || typeID;

  return {
    typeID,
    typeRecord,
    groupID,
    yieldTypeID,
    yieldTypeRecord: resolveType(yieldTypeID) || null,
    yieldKind: "salvage",
    resourceQuantity: resolveFrontierSalvageResourceQuantity(itemOrTypeID, typeID),
  };
}

module.exports = {
  FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
  FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY,
  FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY,
  FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
  isFrontierSalvageMiningType,
  resolveFrontierSalvageResourceProfile,
};
