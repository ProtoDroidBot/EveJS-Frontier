"use strict";

const { isPassiveDungeonScenery } = require("../services/dungeon/dungeonPropMoveSelection");
const miningState = require("../services/mining/miningRuntimeState");
const { getDetachedDungeonPropStore } = require("./detachedDungeonProps");
const { reconcileDetachedProp } = require("./dungeonPropDetachment");
const { startDetachedPropTether } = require("./dungeonPropMovement");

function movableSource(entity) {
  if (!entity || entity.dungeonMovable === false || !entity.position ||
      !Number.isSafeInteger(Number(entity.itemID)) || !Number.isSafeInteger(Number(entity.typeID))) {
    return false;
  }
  if (entity.kind === "detachedDungeonProp") return true;
  if (isPassiveDungeonScenery(entity)) return true;
  if (entity.kind === "asteroid") return true;
  if (entity.kind === "authoredSpaceProp" &&
      entity.collisionEnabled !== false && entity.nonPhysicalCollision !== true) return true;
  return entity.kind === "siteEnvironmentProp" &&
    entity.dungeonMaterializedSiteContent === true &&
    entity.dungeonMaterializedEnvironment === true &&
    entity.dungeonMaterializedGate !== true &&
    entity.dungeonMaterializedObjective !== true &&
    entity.dungeonMaterializedHazard !== true &&
    entity.dungeonMaterializedContainer !== true &&
    entity.dungeonMaterializedKillableStructure !== true &&
    entity.dungeonSiteContentMissionObjectiveTarget !== true &&
    entity.frontierHiveSpawnTypeID == null &&
    entity.frontierHiveLinkState == null &&
    !Object.keys(entity).some((key) => key.startsWith("component_") ||
      key.startsWith("dungeonEncounter")) &&
    (entity.frontierDungeonResource === true && Number(entity.miningYieldTypeID) > 0 ||
      miningState.isMineableStaticEntity(entity));
}

function pickupPhysicsGunTarget(scene, session, target, moduleID, direction,
  options: Record<string, any> = {}) {
  const mining = options.miningState || miningState;
  const ship = scene?.getShipEntityForSession?.(session);
  const source = scene?.staticEntitiesByID?.get(Number(target?.itemID));
  if (!ship || !source || source !== target || !movableSource(source) ||
      Number(session?._space?.systemID) !== Number(scene.systemID) ||
      ship.mode === "WARP" || ship.pendingDock) {
    return { success: false, errorMsg: "PHYSICS_GUN_TARGET_NOT_MOVABLE" };
  }
  if (ship.bubbleID > 0 && source.bubbleID > 0 && ship.bubbleID !== source.bubbleID) {
    return { success: false, errorMsg: "PROP_NOT_VISIBLE" };
  }
  const instanceID = Number(source.dungeonSiteInstanceID) || 0;
  const siteID = Number(source.dungeonSiteID) || 0;
  if (instanceID > 0 || siteID > 0) {
    if (instanceID <= 0 || siteID <= 0 ||
        Number(ship.dungeonCurrentInstanceID) !== instanceID ||
        scene.canSessionSeeDungeonScopedEntity?.(session, source) !== true) {
      return { success: false, errorMsg: "PROP_NOT_VISIBLE" };
    }
  }
  const store = options.store || getDetachedDungeonPropStore();
  let worldEntityID = source.itemID;
  if (source.kind !== "detachedDungeonProp") {
    let mineable = null;
    try {
      if (source.kind === "asteroid" || mining.isMineableStaticEntity(source)) {
        mineable = mining.getMineableState(scene, source.itemID);
      }
    } catch (_error) {
      return { success: false, errorMsg: "PHYSICS_GUN_MINING_STATE_UNAVAILABLE" };
    }
    const identity = {
      systemID: scene.systemID,
      instanceID,
      siteID,
      entityID: source.itemID,
    };
    let committed;
    try {
      committed = store.detach({
        ...source,
        ...(mineable ? { physicsGunMineableState: { ...mineable } } : {}),
      }, identity, scene);
    } catch (_error) {
      return { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
    }
    if (!committed?.success) return committed || { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
    const reconciled = reconcileDetachedProp(scene, committed.data, {
      broadcast: true,
      nowMs: options.nowMs,
    });
    if (!reconciled.success) return reconciled;
    worldEntityID = committed.data.worldEntityID;
    if (committed.data.sourceScope === "world") {
      scene._detachedWorldSourceIDs ||= new Set();
      scene._detachedWorldSourceIDs.add(source.itemID);
    }
    if (mineable) {
      // The independent entity keeps the current resource quantity and its own
      // persisted mining state. The original ID can no longer respawn here.
      try {
        mining.clearMineableState(scene, source.itemID);
        mining.getMineableState(scene, worldEntityID);
      } catch (_error) {
        // The detached record embeds the transferred state. Scene mining
        // initialization can recover it even if this cache update fails.
      }
    }
  }
  return startDetachedPropTether(scene, session, worldEntityID, moduleID, direction, options);
}

module.exports = { movableSource, pickupPhysicsGunTarget };
