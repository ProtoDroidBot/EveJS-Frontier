const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getTypeAttributeMap,
  getTypeAttributeValue,
  getTypeEffectRecords,
} = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const {
  grantItemToOwnerLocation,
  listContainerItems,
  removeInventoryItem,
} = require(path.join(__dirname, "../../services/inventory/itemStore"));
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
const {
  matchesTypeList,
} = require(path.join(__dirname, "../../services/inventory/typeListAuthority"));
const environmentalEffectsService = require(path.join(
  __dirname,
  "../../services/frontier/environmentalEffectsService",
));
const {
  canEntitiesInteractLocally,
} = require(path.join(__dirname, "../destiny/identity/interactionScope"));
const {
  buildOnSpecialFXPayload,
} = require(path.join(__dirname, "../destiny/stream/actions"));
const nativeNpcStore = require(path.join(__dirname, "./nativeNpcStore"));
const {
  generateNpcMetamorphosisItems,
  resolveNpcMetamorphosisCapability,
} = require(path.join(__dirname, "./npcMetamorphosis"));

const NPC_INVENTORY_SCAN_EFFECT_NAME = "behaviorinventoryscan";
const NPC_METAMORPHOSIS_SCAN_EFFECT_NAME = "metamorphosistargetscan";
const NPC_LOOTABLE_TARGET_TYPE_LIST_ID = 861;
const CONSERVATOR_ITEM_INTEREST_TYPE_LIST_ID = 923;
const METAMORPHOSIS_TARGET_TYPE_LIST_ID = 985;
const FERAL_TRACE_TYPE_ID = 91496;
const CARGO_FLAG_ID = 5;
const MINIMUM_SCAN_DURATION_MS = 1;
const MINIMUM_SCAN_RETRY_MS = 1_000;

const DEFAULT_DEPS = Object.freeze({
  applyNpcFeralization: environmentalEffectsService.applyNpcFeralization,
  buildOnSpecialFXPayload,
  canEntitiesInteractLocally,
  getTypeAttributeMap,
  getTypeAttributeValue,
  getTypeEffectRecords,
  generateNpcMetamorphosisItems,
  grantItemToOwnerLocation,
  listContainerItems,
  matchesTypeList,
  nativeNpcStore,
  removeInventoryItem,
  resolveItemByTypeID,
  resolveNpcMetamorphosisCapability,
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeEffectName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getDogmaAttributeByID(attributeMap, attributeID, fallback = null) {
  const numericAttributeID = toPositiveInt(attributeID, 0);
  if (!numericAttributeID || !attributeMap) {
    return fallback;
  }
  const value = Number(attributeMap[numericAttributeID]);
  return Number.isFinite(value) ? value : fallback;
}

function getProfileTypeListID(behaviorProfile, key, fallback) {
  return toPositiveInt(behaviorProfile && behaviorProfile[key], fallback);
}

function resolveNpcScanCapability(
  entity,
  behaviorProfile: Record<string, any> = {},
  dependencyOverrides: Record<string, any> = {},
) {
  const deps = { ...DEFAULT_DEPS, ...dependencyOverrides };
  const typeID = toPositiveInt(entity && entity.typeID, 0);
  if (!typeID) {
    return null;
  }

  const effectRecord = (deps.getTypeEffectRecords(typeID) || []).find((effect) => {
    const effectName = normalizeEffectName(
      effect && (effect.effectName || effect.name),
    );
    return (
      effectName === NPC_INVENTORY_SCAN_EFFECT_NAME ||
      effectName === NPC_METAMORPHOSIS_SCAN_EFFECT_NAME
    );
  });
  if (!effectRecord) {
    return null;
  }

  const effectName = normalizeEffectName(effectRecord.effectName || effectRecord.name);
  const kind = effectName === NPC_INVENTORY_SCAN_EFFECT_NAME
    ? "inventory"
    : "metamorphosis";
  const metamorphosisCapability = kind === "metamorphosis"
    ? deps.resolveNpcMetamorphosisCapability(entity, deps)
    : null;
  if (kind === "metamorphosis" && !metamorphosisCapability) {
    return null;
  }
  const attributes = deps.getTypeAttributeMap(typeID) || {};
  const effectDurationMs = getDogmaAttributeByID(
    attributes,
    effectRecord.durationAttributeID,
  );
  const durationMs = Math.max(
    MINIMUM_SCAN_DURATION_MS,
    effectDurationMs !== null && effectDurationMs !== undefined
      ? toFiniteNumber(effectDurationMs, 0)
      : toFiniteNumber(deps.getTypeAttributeValue(typeID, "scanSpeed"), 0),
  );
  const effectRangeMeters = getDogmaAttributeByID(
    attributes,
    effectRecord.rangeAttributeID,
  );
  const rangeMeters = Math.max(
    0,
    effectRangeMeters !== null && effectRangeMeters !== undefined
      ? toFiniteNumber(effectRangeMeters, 0)
      : toFiniteNumber(behaviorProfile && behaviorProfile.scanRangeMeters, 0),
  );
  if (rangeMeters <= 0) {
    return null;
  }

  const timeBetweenScansSeconds = Math.max(
    0,
    toFiniteNumber(deps.getTypeAttributeValue(typeID, "timeBetweenScans"), 0),
  );
  const intervalMs = Math.max(
    durationMs,
    timeBetweenScansSeconds > 0
      ? timeBetweenScansSeconds * 1_000
      : durationMs,
  );

  return {
    kind,
    effectID: toPositiveInt(effectRecord.effectID, 0),
    effectGuid: String(effectRecord.guid || (
      kind === "inventory" ? "effects.FrontierScanningTest" : "effects.HarvestingBeam"
    )),
    durationMs,
    intervalMs,
    rangeMeters,
    targetTypeListID: kind === "inventory"
      ? getProfileTypeListID(
          behaviorProfile,
          "inventoryScanTargetTypeListID",
          NPC_LOOTABLE_TARGET_TYPE_LIST_ID,
        )
      : getProfileTypeListID(
          behaviorProfile,
          "metamorphosisScanTargetTypeListID",
          METAMORPHOSIS_TARGET_TYPE_LIST_ID,
        ),
    itemTypeListID: kind === "inventory"
      ? getProfileTypeListID(
          behaviorProfile,
          "inventoryScanItemTypeListID",
          CONSERVATOR_ITEM_INTEREST_TYPE_LIST_ID,
        )
      : 0,
    metamorphosisItemTypeID: metamorphosisCapability
      ? metamorphosisCapability.itemTypeID
      : 0,
    generatedDataTypeID: kind === "inventory"
      ? toPositiveInt(deps.getTypeAttributeValue(typeID, "dataGeneratedFromScan"), 0)
      : 0,
    dataStorageLimit: kind === "inventory"
      ? toPositiveInt(deps.getTypeAttributeValue(typeID, "dataStorageLimitBehavior"), 0)
      : 0,
    traceTypeID: kind === "inventory"
      ? toPositiveInt(
          deps.getTypeAttributeValue(typeID, "thiefNoteType"),
          FERAL_TRACE_TYPE_ID,
        )
      : 0,
    traceQuantityPerType: kind === "inventory"
      ? toPositiveInt(deps.getTypeAttributeValue(typeID, "thiefNoteQuantity"), 1)
      : 0,
  };
}

function vectorDistance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}

function surfaceDistance(left, right) {
  return Math.max(
    0,
    vectorDistance(left && left.position, right && right.position) -
      Math.max(0, toFiniteNumber(left && (left.spaceRadius ?? left.radius), 0)) -
      Math.max(0, toFiniteNumber(right && (right.spaceRadius ?? right.radius), 0)),
  );
}

function listScanTargetItems(target, deps) {
  const targetID = toPositiveInt(target && target.itemID, 0);
  if (!targetID) {
    return [];
  }
  if (target && target.nativeNpcWreck === true) {
    return deps.nativeNpcStore.buildNativeWreckContents(targetID) || [];
  }
  return deps.listContainerItems(null, targetID, null) || [];
}

function isCandidateInScanScope(source, candidate, capability, deps) {
  return Boolean(
    candidate &&
    toPositiveInt(candidate.itemID, 0) > 0 &&
    toPositiveInt(candidate.itemID, 0) !== toPositiveInt(source && source.itemID, 0) &&
    candidate.removed !== true &&
    deps.canEntitiesInteractLocally(source, candidate) &&
    deps.matchesTypeList(candidate, capability.targetTypeListID) &&
    surfaceDistance(source, candidate) <= capability.rangeMeters
  );
}

function targetHasInterestingInventory(target, capability, deps) {
  if (capability.kind !== "inventory") {
    return true;
  }
  return listScanTargetItems(target, deps).some((item) => (
    deps.matchesTypeList(item, capability.itemTypeListID)
  ));
}

function findNpcScanTarget(scene, source, capability, deps) {
  if (!scene || typeof scene.getDynamicEntitiesInBubble !== "function") {
    return null;
  }
  return (scene.getDynamicEntitiesInBubble(source.bubbleID) || [])
    .filter((candidate) => (
      isCandidateInScanScope(source, candidate, capability, deps) &&
      targetHasInterestingInventory(candidate, capability, deps)
    ))
    .sort((left, right) => (
      surfaceDistance(source, left) - surfaceDistance(source, right) ||
      toPositiveInt(left && left.itemID, 0) - toPositiveInt(right && right.itemID, 0)
    ))[0] || null;
}

function broadcastScanFx(scene, source, targetID, capability, nowMs, active, deps) {
  if (
    !scene ||
    typeof scene.broadcastDestinyUpdatesToBubble !== "function" ||
    typeof scene.getNextDestinyStamp !== "function"
  ) {
    return;
  }
  const payload = deps.buildOnSpecialFXPayload(
    source.itemID,
    capability.effectGuid,
    {
      moduleID: source.itemID,
      moduleTypeID: source.typeID,
      targetID,
      isOffensive: false,
      start: active === true,
      active: active === true,
      duration: active === true ? capability.durationMs : 0,
      repeat: 0,
      startTime: nowMs,
      timeFromStart: 0,
    },
  );
  scene.broadcastDestinyUpdatesToBubble(source.bubbleID, [{
    stamp: scene.getNextDestinyStamp(nowMs),
    payload,
  }]);
}

function cargoQuantity(item) {
  return item && (item.singleton === true || Number(item.singleton) === 1)
    ? 1
    : Math.max(1, toPositiveInt(item && (item.quantity ?? item.stacksize), 1));
}

function addNpcCargoRecord(source, item, deps) {
  const store = deps.nativeNpcStore;
  const cargoIDResult = store.allocateCargoID({ transient: source.transient === true });
  if (!cargoIDResult || cargoIDResult.success !== true || !cargoIDResult.data) {
    return cargoIDResult || { success: false, errorMsg: "NPC_NATIVE_CARGO_ID_REQUIRED" };
  }
  const cargoID = cargoIDResult.data;
  const singleton = item && (item.singleton === true || Number(item.singleton) === 1);
  const record = {
    cargoID,
    entityID: source.itemID,
    ownerID: source.ownerID,
    moduleID: 0,
    typeID: toPositiveInt(item && item.typeID, 0),
    groupID: toPositiveInt(item && item.groupID, 0),
    categoryID: toPositiveInt(item && item.categoryID, 0),
    itemName: String(item && (item.itemName || item.name) || "Item"),
    quantity: cargoQuantity(item),
    singleton,
    flagID: CARGO_FLAG_ID,
    moduleState: singleton && item && item.moduleState ? item.moduleState : null,
    transient: source.transient === true,
  };
  const writeResult = store.upsertNativeCargo(record, {
    transient: source.transient === true,
  });
  if (!writeResult || writeResult.success !== true) {
    return writeResult || { success: false, errorMsg: "NPC_NATIVE_CARGO_WRITE_FAILED" };
  }
  return { success: true, data: record };
}

function removeScanTargetItem(target, item, deps) {
  if (target && target.nativeNpcWreck === true) {
    return deps.nativeNpcStore.removeNativeWreckItem(item.itemID);
  }
  return deps.removeInventoryItem(item.itemID, { removeContents: false });
}

function transferScanTargetItemToNpc(source, target, item, deps) {
  const addResult = addNpcCargoRecord(source, item, deps);
  if (!addResult || addResult.success !== true) {
    return false;
  }
  const removeResult = removeScanTargetItem(target, item, deps);
  if (!removeResult || removeResult.success !== true) {
    deps.nativeNpcStore.removeNativeCargo(addResult.data.cargoID);
    return false;
  }
  return true;
}

function depositTraceItems(
  target,
  stolenTypeCount,
  capability,
  deps,
  options: Record<string, any> = {},
) {
  const traceQuantity = stolenTypeCount * capability.traceQuantityPerType;
  if (traceQuantity <= 0 || capability.traceTypeID <= 0) {
    return false;
  }
  const traceType = deps.resolveItemByTypeID(capability.traceTypeID) || {
    typeID: capability.traceTypeID,
    name: "Feral Trace",
    groupID: 0,
    categoryID: 0,
    volume: 0.01,
  };
  const targetID = toPositiveInt(target && target.itemID, 0);
  if (target && target.nativeNpcWreck === true) {
    const wreckRecord = deps.nativeNpcStore.getNativeWreck(targetID) || {};
    const idResult = deps.nativeNpcStore.allocateWreckItemID({
      transient: wreckRecord.transient === true,
    });
    if (!idResult || idResult.success !== true || !idResult.data) {
      return false;
    }
    const result = deps.nativeNpcStore.upsertNativeWreckItem({
      wreckItemID: idResult.data,
      wreckID: targetID,
      ownerID: toPositiveInt(wreckRecord.ownerID, toPositiveInt(target.ownerID, 0)),
      locationID: targetID,
      flagID: CARGO_FLAG_ID,
      typeID: capability.traceTypeID,
      groupID: toPositiveInt(traceType.groupID, 0),
      categoryID: toPositiveInt(traceType.categoryID, 0),
      itemName: String(traceType.name || "Feral Trace"),
      quantity: traceQuantity,
      singleton: false,
      customInfo: "",
      moduleState: null,
      sourceKind: "npcInventoryScanTrace",
      moduleID: 0,
      volume: toFiniteNumber(traceType.volume, 0.01),
      transient: wreckRecord.transient === true,
    }, { transient: wreckRecord.transient === true });
    return Boolean(result && result.success === true);
  }

  const result = deps.grantItemToOwnerLocation(
    toPositiveInt(
      options.ownerID,
      toPositiveInt(target && target.ownerID, 0),
    ),
    targetID,
    toPositiveInt(options.flagID, CARGO_FLAG_ID),
    traceType,
    traceQuantity,
  );
  return Boolean(result && result.success === true);
}

function generateScanData(source, capability, deps) {
  if (capability.generatedDataTypeID <= 0 || capability.dataStorageLimit <= 0) {
    return false;
  }
  const store = deps.nativeNpcStore;
  const existingRecords = store.listNativeCargoForEntity(source.itemID) || [];
  const dataRecords = existingRecords.filter((record) => (
    toPositiveInt(record && record.typeID, 0) === capability.generatedDataTypeID
  ));
  const currentQuantity = dataRecords.reduce(
    (sum, record) => sum + cargoQuantity(record),
    0,
  );
  if (currentQuantity >= capability.dataStorageLimit) {
    return false;
  }
  const existingStack = dataRecords.find((record) => record.singleton !== true) || null;
  if (existingStack) {
    const result = store.upsertNativeCargo({
      ...existingStack,
      quantity: cargoQuantity(existingStack) + 1,
    }, { transient: existingStack.transient === true });
    return Boolean(result && result.success === true);
  }
  const dataType = deps.resolveItemByTypeID(capability.generatedDataTypeID) || {
    typeID: capability.generatedDataTypeID,
    name: "Scan Data",
    groupID: 0,
    categoryID: 0,
  };
  return addNpcCargoRecord(source, {
    typeID: dataType.typeID,
    groupID: dataType.groupID,
    categoryID: dataType.categoryID,
    itemName: dataType.name,
    quantity: 1,
    singleton: false,
  }, deps).success === true;
}

function refreshNpcCargo(source, deps) {
  if (deps.nativeNpcStore && typeof deps.nativeNpcStore.buildNativeCargoItems === "function") {
    source.nativeCargoItems = deps.nativeNpcStore.buildNativeCargoItems(source.itemID);
  }
}

function refreshScannedTarget(scene, target, deps) {
  const remainingItems = listScanTargetItems(target, deps);
  target.isEmpty = remainingItems.length === 0;
  if (scene && typeof scene.sendSlimItemChangesToAllSessions === "function") {
    scene.sendSlimItemChangesToAllSessions([target]);
  }
}

function completeInventoryScan(scene, source, target, capability, deps) {
  const interestingItems = listScanTargetItems(target, deps).filter((item) => (
    deps.matchesTypeList(item, capability.itemTypeListID)
  ));
  const stolenTypeIDs = new Set<number>();
  let stolenItemCount = 0;
  let traceOwnerID = 0;
  let traceFlagID = CARGO_FLAG_ID;
  for (const item of interestingItems) {
    if (transferScanTargetItemToNpc(source, target, item, deps)) {
      stolenTypeIDs.add(toPositiveInt(item && item.typeID, 0));
      stolenItemCount += 1;
      if (traceOwnerID <= 0) {
        traceOwnerID = toPositiveInt(item && item.ownerID, 0);
        traceFlagID = toPositiveInt(item && item.flagID, CARGO_FLAG_ID);
      }
    }
  }
  stolenTypeIDs.delete(0);

  if (stolenTypeIDs.size > 0) {
    if (!depositTraceItems(target, stolenTypeIDs.size, capability, deps, {
      ownerID: traceOwnerID,
      flagID: traceFlagID,
    })) {
      log.warn(
        `[NpcScanning] Failed to leave trace in ${target.itemID} after ${source.itemID} took cargo`,
      );
    }
    generateScanData(source, capability, deps);
    refreshNpcCargo(source, deps);
    refreshScannedTarget(scene, target, deps);
  }
  return {
    stolenItemCount,
    stolenTypeCount: stolenTypeIDs.size,
    stolenTypeIDs: [...stolenTypeIDs].sort((left, right) => left - right),
  };
}

function completeMetamorphosisScan(source, target, nowMs, deps) {
  const feralization = typeof deps.applyNpcFeralization === "function"
    ? deps.applyNpcFeralization(target, source, "scan", nowMs)
    : null;
  const metamorphosisItems = typeof deps.generateNpcMetamorphosisItems === "function"
    ? deps.generateNpcMetamorphosisItems(source, "scan", { dependencies: deps })
    : null;
  return {
    feralization,
    metamorphosisItems,
  };
}

function cancelNpcScanning(scene, source, controller, nowMs = Date.now(), options: Record<string, any> = {}) {
  const state = controller && controller._npcScanState;
  if (!state) {
    return false;
  }
  const deps = { ...DEFAULT_DEPS, ...(options.dependencies || {}) };
  broadcastScanFx(scene, source, state.targetID, state.capability, nowMs, false, deps);
  controller._npcScanState = null;
  controller._npcScanNextAtMs = Math.max(
    toFiniteNumber(controller._npcScanNextAtMs, 0),
    nowMs + MINIMUM_SCAN_RETRY_MS,
  );
  return true;
}

function syncNpcScanning(
  scene,
  source,
  controller,
  behaviorProfile: Record<string, any> = {},
  nowMs = Date.now(),
  options: Record<string, any> = {},
) {
  const deps = { ...DEFAULT_DEPS, ...(options.dependencies || {}) };
  const capability = resolveNpcScanCapability(source, behaviorProfile, deps);
  if (!capability) {
    if (controller && controller._npcScanState) {
      cancelNpcScanning(scene, source, controller, nowMs, { dependencies: deps });
    }
    return { supported: false, active: false };
  }

  const currentState = controller._npcScanState || null;
  if (currentState) {
    const target = scene && typeof scene.getEntityByID === "function"
      ? scene.getEntityByID(currentState.targetID)
      : null;
    const stillValid = Boolean(
      target &&
      currentState.capability.kind === capability.kind &&
      isCandidateInScanScope(source, target, capability, deps)
    );
    if (!stillValid) {
      cancelNpcScanning(scene, source, controller, nowMs, { dependencies: deps });
      return { supported: true, active: false, cancelled: true };
    }
    if (nowMs < currentState.completeAtMs) {
      return {
        supported: true,
        active: true,
        targetID: currentState.targetID,
        completeAtMs: currentState.completeAtMs,
      };
    }

    broadcastScanFx(scene, source, target.itemID, capability, nowMs, false, deps);
    const result = capability.kind === "inventory"
      ? completeInventoryScan(scene, source, target, capability, deps)
      : completeMetamorphosisScan(source, target, nowMs, deps);
    controller._npcScanState = null;
    controller._npcScanNextAtMs = nowMs + capability.intervalMs;
    return {
      supported: true,
      active: false,
      completed: true,
      targetID: target.itemID,
      result,
    };
  }

  if (toFiniteNumber(controller._npcScanNextAtMs, 0) > nowMs) {
    return { supported: true, active: false };
  }
  const target = findNpcScanTarget(scene, source, capability, deps);
  if (!target) {
    controller._npcScanNextAtMs = nowMs + MINIMUM_SCAN_RETRY_MS;
    return { supported: true, active: false };
  }

  broadcastScanFx(scene, source, target.itemID, capability, nowMs, true, deps);
  controller._npcScanState = {
    targetID: target.itemID,
    startedAtMs: nowMs,
    completeAtMs: nowMs + capability.durationMs,
    capability,
  };
  return {
    supported: true,
    active: true,
    started: true,
    targetID: target.itemID,
    completeAtMs: nowMs + capability.durationMs,
  };
}

module.exports = {
  NPC_INVENTORY_SCAN_EFFECT_NAME,
  NPC_METAMORPHOSIS_SCAN_EFFECT_NAME,
  NPC_LOOTABLE_TARGET_TYPE_LIST_ID,
  CONSERVATOR_ITEM_INTEREST_TYPE_LIST_ID,
  METAMORPHOSIS_TARGET_TYPE_LIST_ID,
  FERAL_TRACE_TYPE_ID,
  cancelNpcScanning,
  resolveNpcScanCapability,
  syncNpcScanning,
  _testing: {
    completeInventoryScan,
    depositTraceItems,
    findNpcScanTarget,
    generateScanData,
    listScanTargetItems,
    surfaceDistance,
  },
};
