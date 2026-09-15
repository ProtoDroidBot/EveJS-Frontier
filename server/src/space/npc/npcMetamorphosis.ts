const path = require("path");

const {
  getTypeAttributeValue,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));

// build-3502403 dogma/const/attributes.pyc
const ATTRIBUTE_METAMORPHOSIS_ITEM = 6206;
const ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT = 6299;
const CARGO_FLAG_ID = 5;

const DEFAULT_DEPS = Object.freeze({
  getTypeAttributeValue,
  nativeNpcStore,
  resolveItemByTypeID,
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function getEntityAttributeValue(entity, attributeID) {
  const attributes = entity &&
    entity.passiveDerivedState &&
    entity.passiveDerivedState.attributes;
  if (!attributes || typeof attributes !== "object") {
    return null;
  }
  const value = Number(attributes[String(attributeID)] ?? attributes[attributeID]);
  return Number.isFinite(value) ? value : null;
}

function getEntityOrTypeAttributeValue(
  entity,
  attributeID,
  attributeName,
  deps,
  fallback = 0,
) {
  const entityValue = getEntityAttributeValue(entity, attributeID);
  if (entityValue !== null) {
    return entityValue;
  }
  return Number(
    deps.getTypeAttributeValue(
      toPositiveInt(entity && entity.typeID, 0),
      attributeName,
    ),
  ) || fallback;
}

function resolveNpcMetamorphosisCapability(
  source,
  dependencyOverrides: Record<string, any> = {},
) {
  const deps = { ...DEFAULT_DEPS, ...dependencyOverrides };
  if (
    !source ||
    source.nativeNpc !== true ||
    toPositiveInt(source.itemID, 0) <= 0 ||
    toPositiveInt(source.typeID, 0) <= 0
  ) {
    return null;
  }

  const itemTypeID = toPositiveInt(
    getEntityOrTypeAttributeValue(
      source,
      ATTRIBUTE_METAMORPHOSIS_ITEM,
      "metamorphosisItem",
      deps,
      0,
    ),
    0,
  );
  if (itemTypeID <= 0) {
    return null;
  }

  return {
    itemTypeID,
    itemAmountOnHit: toPositiveInt(
      getEntityOrTypeAttributeValue(
        source,
        ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT,
        "metamorphosisItemAmountOnHit",
        deps,
        1,
      ),
      1,
    ),
  };
}

function cargoQuantity(record) {
  return record && (record.singleton === true || Number(record.singleton) === 1)
    ? 1
    : Math.max(1, toPositiveInt(record && record.quantity, 1));
}

function generateNpcMetamorphosisItems(
  source,
  applicationKind,
  options: Record<string, any> = {},
) {
  const kind = String(applicationKind || "").trim().toLowerCase();
  if (kind !== "scan" && kind !== "hit") {
    return { supported: false, generated: false, quantity: 0 };
  }
  if (
    kind === "hit" &&
    options.appliedDamage !== undefined &&
    (
      !Number.isFinite(Number(options.appliedDamage)) ||
      Number(options.appliedDamage) <= 0
    )
  ) {
    return { supported: true, generated: false, quantity: 0 };
  }

  const deps = { ...DEFAULT_DEPS, ...(options.dependencies || {}) };
  const capability = resolveNpcMetamorphosisCapability(source, deps);
  if (!capability) {
    return { supported: false, generated: false, quantity: 0 };
  }

  const itemType = deps.resolveItemByTypeID(capability.itemTypeID);
  if (!itemType) {
    return {
      supported: true,
      generated: false,
      quantity: 0,
      itemTypeID: capability.itemTypeID,
      errorMsg: "NPC_METAMORPHOSIS_ITEM_TYPE_NOT_FOUND",
    };
  }

  const quantity = kind === "hit" ? capability.itemAmountOnHit : 1;
  const store = deps.nativeNpcStore;
  const existingRecords = store.listNativeCargoForEntity(source.itemID) || [];
  const existingStack = existingRecords.find((record) => (
    toPositiveInt(record && record.typeID, 0) === capability.itemTypeID &&
    record.singleton !== true &&
    Number(record.singleton) !== 1
  )) || null;

  let writeResult;
  let totalQuantity;
  if (existingStack) {
    totalQuantity = cargoQuantity(existingStack) + quantity;
    writeResult = store.upsertNativeCargo({
      ...existingStack,
      quantity: totalQuantity,
    }, { transient: existingStack.transient === true });
  } else {
    const cargoIDResult = store.allocateCargoID({ transient: source.transient === true });
    if (!cargoIDResult || cargoIDResult.success !== true || !cargoIDResult.data) {
      return {
        supported: true,
        generated: false,
        quantity: 0,
        itemTypeID: capability.itemTypeID,
        errorMsg: cargoIDResult && cargoIDResult.errorMsg || "NPC_NATIVE_CARGO_ID_REQUIRED",
      };
    }
    totalQuantity = quantity;
    writeResult = store.upsertNativeCargo({
      cargoID: cargoIDResult.data,
      entityID: source.itemID,
      ownerID: toPositiveInt(source.ownerID, 0),
      moduleID: 0,
      typeID: capability.itemTypeID,
      groupID: toPositiveInt(itemType.groupID, 0),
      categoryID: toPositiveInt(itemType.categoryID, 0),
      itemName: String(itemType.name || "Metamorphosis Item"),
      quantity,
      singleton: false,
      flagID: CARGO_FLAG_ID,
      moduleState: null,
      transient: source.transient === true,
    }, { transient: source.transient === true });
  }

  if (!writeResult || writeResult.success !== true) {
    return {
      supported: true,
      generated: false,
      quantity: 0,
      itemTypeID: capability.itemTypeID,
      errorMsg: writeResult && writeResult.errorMsg || "NPC_NATIVE_CARGO_WRITE_FAILED",
    };
  }

  if (typeof store.buildNativeCargoItems === "function") {
    source.nativeCargoItems = store.buildNativeCargoItems(source.itemID);
  }
  return {
    supported: true,
    generated: true,
    applicationKind: kind,
    itemTypeID: capability.itemTypeID,
    quantity,
    totalQuantity,
  };
}

module.exports = {
  ATTRIBUTE_METAMORPHOSIS_ITEM,
  ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT,
  CARGO_FLAG_ID,
  generateNpcMetamorphosisItems,
  resolveNpcMetamorphosisCapability,
};
