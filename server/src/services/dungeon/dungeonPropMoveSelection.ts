"use strict";

const path = require("path");
const {
  ROLE_GML,
  ROLE_LEGIONEER,
  ROLE_WORLDMOD,
  normalizeRoleValue,
} = require(path.join(__dirname, "../account/accountRoleProfiles"));

const MAX_SELECTION_RANGE_METERS = 50_000;
const MAX_MOVE_DISTANCE_METERS = 100_000;
const MOVE_PREVIEW_ROLES = BigInt(ROLE_GML) | BigInt(ROLE_LEGIONEER) | BigInt(ROLE_WORLDMOD);

function positiveSafeInteger(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function finiteVector(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, z } = value;
  return [x, y, z].every((component) => typeof component === "number" && Number.isFinite(component))
    ? { x, y, z }
    : null;
}

function finiteRotation(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((angle) => typeof angle === "number" && Number.isFinite(angle) && Math.abs(angle) <= 360)
    ? [...value]
    : null;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function isPassiveDungeonScenery(entity) {
  if (
    !entity ||
    entity.kind !== "siteEnvironmentProp" ||
    entity.dungeonMaterializedSiteContent !== true ||
    entity.dungeonMaterializedEnvironment !== true ||
    !positiveSafeInteger(entity.typeID) ||
    entity.dungeonMovable === false
  ) {
    return false;
  }
  if (
    entity.frontierDungeonResource === true ||
    entity.frontierHiveSpawnTypeID != null ||
    entity.frontierHiveLinkState != null ||
    entity.miningYieldTypeID != null ||
    entity.resourceQuantity != null ||
    entity.dungeonMaterializedKillableStructure === true ||
    entity.dungeonMaterializedGate === true ||
    entity.dungeonMaterializedObjective === true ||
    entity.dungeonMaterializedContainer === true ||
    entity.dungeonMaterializedHazard === true
  ) {
    return false;
  }
  return !Object.keys(entity).some((key) => (
    key.startsWith("component_") ||
    key.startsWith("dungeonEncounter") ||
    key.startsWith("dungeonSiteContent")
  ));
}

function failure(errorMsg) {
  return { success: false as const, errorMsg };
}

// This resolver is deliberately read-only. The detach transaction must call it
// again immediately before committing; a preview is never a movement token.
function validateDungeonPropMovePreview(
  scene,
  session,
  request: Record<string, any> = {},
  options: Record<string, any> = {},
) {
  if ((BigInt(normalizeRoleValue(session && session.accountRole, 0n)) & MOVE_PREVIEW_ROLES) === 0n) {
    return failure("GM_ROLE_REQUIRED");
  }
  const systemID = positiveSafeInteger(scene && scene.systemID);
  if (!systemID || positiveSafeInteger(session && session._space && session._space.systemID) !== systemID) {
    return failure("NOT_IN_SPACE");
  }
  const ship = typeof scene.getShipEntityForSession === "function"
    ? scene.getShipEntityForSession(session)
    : null;
  const shipPosition = finiteVector(ship && ship.position);
  if (!ship || !shipPosition || ship.mode === "WARP" || ship.pendingDock) {
    return failure("SHIP_NOT_READY");
  }
  const entityID = positiveSafeInteger(request.entityID);
  if (!entityID) return failure("INVALID_ENTITY_ID");
  const entity = scene.staticEntitiesByID instanceof Map
    ? scene.staticEntitiesByID.get(entityID)
    : null;
  if (!entity) return failure("PROP_NOT_FOUND");
  if (!isPassiveDungeonScenery(entity)) return failure("PROP_NOT_MOVABLE");
  const sourcePosition = finiteVector(entity.position);
  const siteID = positiveSafeInteger(entity.dungeonSiteID);
  const instanceID = positiveSafeInteger(entity.dungeonSiteInstanceID);
  if (!sourcePosition || !siteID || !instanceID) return failure("PROP_SCOPE_INVALID");
  if (positiveSafeInteger(ship.dungeonCurrentInstanceID) !== instanceID) {
    return failure("WRONG_DUNGEON_INSTANCE");
  }
  const siteRoot = scene.staticEntitiesByID.get(siteID);
  if (!siteRoot || positiveSafeInteger(siteRoot.dungeonSiteInstanceID) !== instanceID) {
    return failure("SITE_NOT_ACTIVE");
  }
  const getInstance = typeof options.getInstance === "function"
    ? options.getInstance
    : require(path.join(__dirname, "./dungeonRuntime")).getInstance;
  const instance = getInstance(instanceID);
  if (
    !instance ||
    !["seeded", "active"].includes(String(instance.lifecycleState || "").toLowerCase()) ||
    positiveSafeInteger(instance.solarSystemID) !== systemID ||
    (positiveSafeInteger(instance.metadata && instance.metadata.siteID) || siteID) !== siteID
  ) {
    return failure("SITE_NOT_ACTIVE");
  }
  if (
    typeof scene.canSessionSeeDungeonScopedEntity !== "function" ||
    !scene.canSessionSeeDungeonScopedEntity(session, entity)
  ) {
    return failure("PROP_NOT_VISIBLE");
  }
  const surfaceDistanceMeters = Math.max(
    0,
    distance(shipPosition, sourcePosition) - Math.max(0, Number(entity.radius) || 0),
  );
  if (surfaceDistanceMeters > MAX_SELECTION_RANGE_METERS) {
    return failure("PROP_OUT_OF_RANGE");
  }
  const destinationPosition = finiteVector(request.destinationPosition);
  if (!destinationPosition) return failure("INVALID_DESTINATION");
  const displacementMeters = distance(sourcePosition, destinationPosition);
  if (!Number.isFinite(displacementMeters) || displacementMeters > MAX_MOVE_DISTANCE_METERS) {
    return failure("DESTINATION_OUT_OF_RANGE");
  }
  const rotation = request.rotation === undefined
    ? finiteRotation(entity.dunRotation) || [0, 0, 0]
    : finiteRotation(request.rotation);
  if (!rotation) return failure("INVALID_ROTATION");

  return {
    success: true as const,
    data: {
      entityID,
      siteID,
      instanceID,
      systemID,
      typeID: positiveSafeInteger(entity.typeID),
      sourcePosition,
      destinationPosition,
      rotation,
      surfaceDistanceMeters,
      displacementMeters,
    },
  };
}

module.exports = {
  MAX_SELECTION_RANGE_METERS,
  MAX_MOVE_DISTANCE_METERS,
  isPassiveDungeonScenery,
  validateDungeonPropMovePreview,
};
