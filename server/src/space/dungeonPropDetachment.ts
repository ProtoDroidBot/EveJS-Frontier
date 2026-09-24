"use strict";

const { validateDungeonPropMovePreview } = require("../services/dungeon/dungeonPropMoveSelection");
const { getDetachedDungeonPropStore } = require("./detachedDungeonProps");

function reconcileDetachedProp(scene, record, options: Record<string, any> = {}) {
  if (!scene || Number(scene.systemID) !== Number(record && record.systemID) ||
      !(scene.staticEntitiesByID instanceof Map)) {
    return { success: false, errorMsg: "DETACHED_PROP_WRONG_SCENE" };
  }
  const candidate = scene.staticEntitiesByID.get(record.sourceEntityID);
  const source = candidate &&
    (record.sourceScope === "world"
      ? candidate.kind === record.sourceKind
      : Number(candidate.dungeonSiteInstanceID) === record.sourceInstanceID &&
        Number(candidate.dungeonSiteID) === record.sourceSiteID &&
        candidate.kind === record.sourceKind)
    ? candidate
    : null;
  const existing = scene.staticEntitiesByID.get(record.worldEntityID);
  if (
    (existing && (
      existing.kind !== "detachedDungeonProp" ||
      Number(existing.typeID) !== Number(record.worldEntity.typeID)
    )) ||
    (scene.dynamicEntities instanceof Map && scene.dynamicEntities.has(record.worldEntityID))
  ) {
    return { success: false, errorMsg: "DETACHED_PROP_WORLD_ID_CONFLICT" };
  }
  if (source) {
    let removed;
    try {
      removed = scene.removeStaticEntity(record.sourceEntityID, {
        broadcast: options.broadcast === true,
        nowMs: options.nowMs,
      });
    } catch (_error) {
      removed = scene.staticEntitiesByID.has(record.sourceEntityID)
        ? { success: false }
        : { success: true };
    }
    if (!removed || removed.success !== true) {
      return { success: false, errorMsg: "DETACHED_PROP_SOURCE_REMOVE_FAILED" };
    }
  }
  if (!existing) {
    const worldEntity = { ...record.worldEntity };
    let added = false;
    try {
      added = scene.addStaticEntity(worldEntity) === true;
    } catch (_error) {
      added = scene.staticEntitiesByID.get(record.worldEntityID)?.kind === "detachedDungeonProp";
    }
    if (!added) {
      return { success: false, errorMsg: "DETACHED_PROP_WORLD_ADD_FAILED" };
    }
    if (options.broadcast === true && typeof scene.broadcastAddBalls === "function") {
      try {
        scene.broadcastAddBalls([worldEntity]);
      } catch (_error) {
        if (typeof scene.requestFinalSceneVisibilityReconciliation === "function") {
          try {
            scene.requestFinalSceneVisibilityReconciliation();
          } catch (_reconcileError) {
            // The durable world entity remains authoritative for retry.
          }
        }
        return { success: false, errorMsg: "DETACHED_PROP_BROADCAST_FAILED" };
      }
    }
  }
  return {
    success: true,
    data: {
      worldEntityID: record.worldEntityID,
      sourceRemoved: Boolean(source),
      worldAdded: !existing,
    },
  };
}

function restoreDetachedPropsToScene(scene, options: Record<string, any> = {}) {
  const store = options.store || getDetachedDungeonPropStore();
  const records = store.listSystem(scene && scene.systemID);
  scene._detachedWorldSourceIDs = new Set(records
    .filter((record) => record.sourceScope === "world")
    .map((record) => record.sourceEntityID));
  const failures: any[] = [];
  for (const record of records) {
    const result = reconcileDetachedProp(scene, record, {
      broadcast: options.broadcast === true,
      nowMs: options.nowMs,
    });
    if (!result.success) failures.push({ worldEntityID: record.worldEntityID, errorMsg: result.errorMsg });
  }
  return { success: failures.length === 0, restored: records.length - failures.length, failures };
}

function detachDungeonProp(scene, session, entityID, options: Record<string, any> = {}) {
  const numericEntityID = Number(entityID);
  const source = scene && scene.staticEntitiesByID instanceof Map
    ? scene.staticEntitiesByID.get(numericEntityID)
    : null;
  const selection = (options.selection || validateDungeonPropMovePreview)(
    scene,
    session,
    {
      entityID: numericEntityID,
      destinationPosition: source && source.position,
    },
    options.selectionOptions || {},
  );
  if (!selection || selection.success !== true) {
    return { success: false, errorMsg: selection && selection.errorMsg || "DETACHED_PROP_SELECTION_DENIED" };
  }
  const identity = {
    systemID: selection.data.systemID,
    instanceID: selection.data.instanceID,
    siteID: selection.data.siteID,
    entityID: selection.data.entityID,
  };
  const store = options.store || getDetachedDungeonPropStore();
  let committed;
  try {
    committed = store.detach(source, identity, scene);
  } catch (_error) {
    return { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  }
  if (!committed || committed.success !== true) {
    return { success: false, errorMsg: committed && committed.errorMsg || "DETACHED_PROP_STORE_FAILED" };
  }
  const reconciled = reconcileDetachedProp(scene, committed.data, {
    broadcast: options.broadcast !== false,
    nowMs: options.nowMs,
  });
  if (!reconciled.success) {
    return {
      success: false,
      errorMsg: "DETACHED_PROP_RECONCILE_PENDING",
      data: { worldEntityID: committed.data.worldEntityID, reason: reconciled.errorMsg },
    };
  }
  return {
    success: true,
    data: {
      worldEntityID: committed.data.worldEntityID,
      sourceEntityID: identity.entityID,
      sourceInstanceID: identity.instanceID,
      position: { ...committed.data.worldEntity.position },
      alreadyDetached: committed.alreadyDetached === true,
    },
  };
}

module.exports = {
  reconcileDetachedProp,
  restoreDetachedPropsToScene,
  detachDungeonProp,
};
