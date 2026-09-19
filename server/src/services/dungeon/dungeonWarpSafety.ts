"use strict";

const {
  normalizePersistentEntityID,
} = require("../../space/destiny/identity/entityID");

// Dungeon roots are navigation beacons rather than physical destination
// balls. A normal Warp To 0 therefore needs an explicit stand-off; their
// small presentation radius is not a safe landing distance for authored
// scenery and encounter controllers around the entry point.
const DUNGEON_SITE_WARP_IN_MINIMUM_DISTANCE_METERS = 10_000;

const DUNGEON_SITE_ROOT_KINDS = new Set([
  "missionSite",
  "universeAnomalySite",
  "universeSignatureSite",
]);

function toNonNegativeFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function isDungeonSiteRootEntity(entity) {
  if (!entity || typeof entity !== "object") {
    return false;
  }
  return (
    DUNGEON_SITE_ROOT_KINDS.has(String(entity.kind || "")) &&
    normalizePersistentEntityID(entity.dungeonSiteInstanceID) !== null &&
    normalizePersistentEntityID(entity.dungeonSiteID) !== null
  );
}

function resolveDungeonSiteWarpInMinimumRange(targetEntity, requestedRange = 0) {
  const requested = toNonNegativeFiniteNumber(requestedRange, 0);
  if (!isDungeonSiteRootEntity(targetEntity)) {
    return requested;
  }
  const configured = toNonNegativeFiniteNumber(
    targetEntity.dungeonWarpInDistanceMeters,
    DUNGEON_SITE_WARP_IN_MINIMUM_DISTANCE_METERS,
  );
  return Math.max(
    requested,
    configured,
    DUNGEON_SITE_WARP_IN_MINIMUM_DISTANCE_METERS,
  );
}

function resolveDungeonWarpStopDistance(
  stopDistance,
  destinationDungeonSiteID,
  options: Record<string, any> = {},
) {
  const requested = toNonNegativeFiniteNumber(stopDistance, 0);
  if (
    options.dungeonGateTransit === true ||
    normalizePersistentEntityID(destinationDungeonSiteID) === null
  ) {
    return requested;
  }
  return Math.max(
    requested,
    DUNGEON_SITE_WARP_IN_MINIMUM_DISTANCE_METERS,
  );
}

module.exports = {
  DUNGEON_SITE_WARP_IN_MINIMUM_DISTANCE_METERS,
  isDungeonSiteRootEntity,
  resolveDungeonSiteWarpInMinimumRange,
  resolveDungeonWarpStopDistance,
};
