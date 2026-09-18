"use strict";

// Deadspace (mission-pocket) warp restriction — TQ parity.
//
// Real EVE deadspace does not let a pilot warp between pockets: acceleration gates are the only
// way in and between rooms, and warping to a fleet member/bookmark/celestial *inside* the same
// complex "does not engage the warp drive". Warping OUT (to a real celestial/station/gate) is
// always allowed. This module enforces both halves so gates actually matter:
//
//   (A) In-pocket restriction: while the ship is inside a dungeon site, block any player warp
//       whose destination lies within that site's spatial region — EXCEPT the gate transit
//       itself (flagged via options.dungeonGateTransit) and warps out (destination far from the
//       site). This blocks room-to-room warps and gate-skipping.
//   (B) Warp-in clamp: a warp from OUTSIDE toward a point that lands inside a dungeon site (e.g. a
//       mission bookmark deep in a pocket) is clamped to that site's warp-in point, so you can
//       never land past the gate you haven't taken.
//
// Spatial model (parity shortcut, per the "shortcuts OK" latitude): a dungeon's logical deadspace
// region remains a broad sphere used to reject gate-skipping. Its physical warp-in boundary is a
// much smaller, configurable grid perimeter. Inbound ships land on the approach-facing side of
// that perimeter, and the point is pushed outward when it intersects a materialized or authored
// site object. This keeps the broad deadspace rule without dropping a ship on the entry beacon.

const path = require("path");

// Radius around a dungeon instance anchor that counts as "inside the site".
const DEADSPACE_SITE_RADIUS_METERS = 1_000_000_000; // ~3.34 light-seconds
const DUNGEON_SITE_WARP_IN_BOUNDARY_METERS = 250_000;
const DUNGEON_WARP_IN_COLLISION_CLEARANCE_METERS = 10_000;
const DEFAULT_AUTHORED_OBJECT_RADIUS_METERS = 2_500;
const MAX_WARP_IN_COLLISION_PASSES = 128;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function pointFromVector(vector) {
  if (!vector) {
    return null;
  }
  if (Array.isArray(vector)) {
    return { x: toFiniteNumber(vector[0], 0), y: toFiniteNumber(vector[1], 0), z: toFiniteNumber(vector[2], 0) };
  }
  if (typeof vector === "object") {
    return { x: toFiniteNumber(vector.x, 0), y: toFiniteNumber(vector.y, 0), z: toFiniteNumber(vector.z, 0) };
  }
  return null;
}

function distanceMeters(a, b) {
  if (!a || !b) {
    return Infinity;
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function addVectors(a, b) {
  return {
    x: toFiniteNumber(a && a.x, 0) + toFiniteNumber(b && b.x, 0),
    y: toFiniteNumber(a && a.y, 0) + toFiniteNumber(b && b.y, 0),
    z: toFiniteNumber(a && a.z, 0) + toFiniteNumber(b && b.z, 0),
  };
}

function subtractVectors(a, b) {
  return {
    x: toFiniteNumber(a && a.x, 0) - toFiniteNumber(b && b.x, 0),
    y: toFiniteNumber(a && a.y, 0) - toFiniteNumber(b && b.y, 0),
    z: toFiniteNumber(a && a.z, 0) - toFiniteNumber(b && b.z, 0),
  };
}

function scaleVector(vector, scale) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scale,
    y: toFiniteNumber(vector && vector.y, 0) * scale,
    z: toFiniteNumber(vector && vector.z, 0) * scale,
  };
}

function dotVectors(a, b) {
  return (
    toFiniteNumber(a && a.x, 0) * toFiniteNumber(b && b.x, 0) +
    toFiniteNumber(a && a.y, 0) * toFiniteNumber(b && b.y, 0) +
    toFiniteNumber(a && a.z, 0) * toFiniteNumber(b && b.z, 0)
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const point = pointFromVector(vector);
  const length = point ? distanceMeters(point, { x: 0, y: 0, z: 0 }) : 0;
  if (length > 0.000001) {
    return scaleVector(point, 1 / length);
  }
  const fallbackPoint = pointFromVector(fallback) || { x: 1, y: 0, z: 0 };
  const fallbackLength = distanceMeters(fallbackPoint, { x: 0, y: 0, z: 0 });
  return fallbackLength > 0.000001
    ? scaleVector(fallbackPoint, 1 / fallbackLength)
    : { x: 1, y: 0, z: 0 };
}

function requireDungeonRuntime() {
  try {
    return require(path.join(__dirname, "../../services/dungeon/dungeonRuntime"));
  } catch (_error) {
    return null;
  }
}

function requireDungeonAuthority() {
  try {
    return require(path.join(__dirname, "../../services/dungeon/dungeonAuthority"));
  } catch (_error) {
    return null;
  }
}

// The in-space anchor of a dungeon instance (the site position the rooms are placed around).
function resolveInstanceAnchor(instance) {
  if (!instance) {
    return null;
  }
  const anchor = pointFromVector(instance.position);
  if (anchor) {
    return anchor;
  }
  const metadataPosition =
    instance.metadata && instance.metadata.position ? pointFromVector(instance.metadata.position) : null;
  return metadataPosition;
}

// Is a destination point inside a dungeon instance's site region?
function isPointInsideInstance(point, instance) {
  const anchor = resolveInstanceAnchor(instance);
  if (!point || !anchor) {
    return false;
  }
  return distanceMeters(point, anchor) <= DEADSPACE_SITE_RADIUS_METERS;
}

function resolveSiteWarpInProfile(instance) {
  let template = null;
  const dungeonAuthority = requireDungeonAuthority();
  if (dungeonAuthority && typeof dungeonAuthority.getTemplateByID === "function") {
    try {
      template = dungeonAuthority.getTemplateByID(instance && instance.templateID) || null;
    } catch (_error) {
      template = null;
    }
  }
  const candidates = [
    instance && instance.frontierDungeonWarpIn,
    instance && instance.metadata && instance.metadata.frontierDungeonWarpIn,
    instance && instance.spawnState && instance.spawnState.frontierDungeonWarpIn,
    instance && instance.spawnState && instance.spawnState.populationHints &&
      instance.spawnState.populationHints.frontierDungeonWarpIn,
    template && template.frontierDungeonWarpIn,
    template && template.populationHints && template.populationHints.frontierDungeonWarpIn,
  ].filter((entry) => entry && typeof entry === "object");
  const configured = candidates[0] || {};
  return {
    boundaryRadiusMeters: Math.max(
      1,
      toFiniteNumber(
        configured.boundaryRadiusMeters,
        DUNGEON_SITE_WARP_IN_BOUNDARY_METERS,
      ),
    ),
    collisionClearanceMeters: Math.max(
      0,
      toFiniteNumber(
        configured.collisionClearanceMeters,
        DUNGEON_WARP_IN_COLLISION_CLEARANCE_METERS,
      ),
    ),
    template,
  };
}

function listSceneEntities(scene) {
  if (!scene || typeof scene !== "object") {
    return [];
  }
  const entities: any[] = [];
  const seenObjects = new Set<any>();
  const seenIDs = new Set<any>();
  const addEntity = (entity) => {
    if (!entity || typeof entity !== "object" || seenObjects.has(entity)) {
      return;
    }
    const entityID = toInt(entity.itemID, 0);
    if (entityID > 0 && seenIDs.has(entityID)) {
      return;
    }
    seenObjects.add(entity);
    if (entityID > 0) {
      seenIDs.add(entityID);
    }
    entities.push(entity);
  };
  for (const entity of Array.isArray(scene.staticEntities) ? scene.staticEntities : []) {
    addEntity(entity);
  }
  if (scene.staticEntitiesByID instanceof Map) {
    for (const entity of scene.staticEntitiesByID.values()) {
      addEntity(entity);
    }
  }
  if (scene.dynamicEntities instanceof Map) {
    for (const entity of scene.dynamicEntities.values()) {
      addEntity(entity);
    }
  } else if (Array.isArray(scene.dynamicEntities)) {
    for (const entity of scene.dynamicEntities) {
      addEntity(entity);
    }
  }
  return entities;
}

function listMaterializedSiteObstacles(instance, scene, excludedEntityID = 0) {
  const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
  if (instanceID <= 0) {
    return [];
  }
  return listSceneEntities(scene).flatMap((entity) => {
    const entityInstanceID = Math.max(
      0,
      toInt(
        entity && (
          entity.dungeonSiteInstanceID ||
          entity.airNpeInstanceID ||
          entity.dungeonCurrentInstanceID
        ),
        0,
      ),
    );
    if (
      entityInstanceID !== instanceID ||
      (excludedEntityID > 0 && toInt(entity && entity.itemID, 0) === excludedEntityID)
    ) {
      return [];
    }
    const position = pointFromVector(entity && entity.position);
    if (!position) {
      return [];
    }
    return [{
      position,
      radius: Math.max(0, toFiniteNumber(entity && entity.radius, 0)),
    }];
  });
}

function listAuthoredSiteObstacles(instance, template) {
  if (!template || typeof template !== "object") {
    return [];
  }
  const anchor = resolveInstanceAnchor(instance);
  if (!anchor) {
    return [];
  }
  const rooms = Array.isArray(template.rooms) ? template.rooms : [];
  const entryObjectID = Math.max(
    0,
    toInt(
      template.entryObjectID ||
      template.dungeonEntryObjectID ||
      template.entryDungeonObjectID,
      0,
    ),
  );
  let entryRoom = null;
  let entryPosition = null;
  for (const room of rooms) {
    const roomPosition = pointFromVector(room && room.position) || { x: 0, y: 0, z: 0 };
    for (const object of Array.isArray(room && room.objects) ? room.objects : []) {
      if (entryObjectID > 0 && toInt(object && object.objectID, 0) === entryObjectID) {
        entryRoom = room;
        entryPosition = addVectors(
          roomPosition,
          pointFromVector(object && object.position) || { x: 0, y: 0, z: 0 },
        );
        break;
      }
    }
    if (entryRoom) {
      break;
    }
  }
  entryRoom = entryRoom || rooms[0] || null;
  if (!entryRoom) {
    return [];
  }
  const roomPosition = pointFromVector(entryRoom && entryRoom.position) || { x: 0, y: 0, z: 0 };
  entryPosition = entryPosition || roomPosition;
  return (Array.isArray(entryRoom && entryRoom.objects) ? entryRoom.objects : []).flatMap((object) => {
    const absolutePosition = addVectors(
      roomPosition,
      pointFromVector(object && object.position) || { x: 0, y: 0, z: 0 },
    );
    return [{
      position: addVectors(anchor, subtractVectors(absolutePosition, entryPosition)),
      radius: Math.max(
        0,
        toFiniteNumber(object && object.radius, DEFAULT_AUTHORED_OBJECT_RADIUS_METERS),
      ),
    }];
  });
}

function resolveCollisionSafeRadialDistance(anchor, direction, initialDistance, obstacles, clearance, shipRadius) {
  let radialDistance = initialDistance;
  for (let pass = 0; pass < MAX_WARP_IN_COLLISION_PASSES; pass += 1) {
    let nextDistance = radialDistance;
    for (const obstacle of obstacles) {
      const obstaclePosition = pointFromVector(obstacle && obstacle.position);
      if (!obstaclePosition) {
        continue;
      }
      const offset = subtractVectors(obstaclePosition, anchor);
      const alongRay = dotVectors(offset, direction);
      const offsetLengthSquared = dotVectors(offset, offset);
      const perpendicularSquared = Math.max(
        0,
        offsetLengthSquared - (alongRay * alongRay),
      );
      const exclusionRadius = Math.max(
        0,
        toFiniteNumber(obstacle && obstacle.radius, 0),
      ) + shipRadius + clearance;
      const exclusionRadiusSquared = exclusionRadius * exclusionRadius;
      if (perpendicularSquared > exclusionRadiusSquared) {
        continue;
      }
      const halfChord = Math.sqrt(Math.max(0, exclusionRadiusSquared - perpendicularSquared));
      const nearIntersection = alongRay - halfChord;
      const farIntersection = alongRay + halfChord;
      if (
        radialDistance >= nearIntersection - 1 &&
        radialDistance <= farIntersection + 1
      ) {
        nextDistance = Math.max(nextDistance, farIntersection + 1);
      }
    }
    if (nextDistance <= radialDistance + 0.000001) {
      break;
    }
    radialDistance = nextDistance;
  }
  return radialDistance;
}

// Evaluate a warp against the deadspace policy.
// Returns one of:
//   { action: "allow" }                              — no restriction applies
//   { action: "block", errorMsg }                    — reject the warp
//   { action: "clamp", point, siteInstanceID }       — redirect the warp to a site warp-in point
//
// options.dungeonGateTransit === true bypasses the in-pocket block (the gate warp itself).
function evaluateDeadspaceWarp(entity, destinationPoint, options: Record<string, any> = {}, scene = null) {
  const point = pointFromVector(destinationPoint);
  if (!entity || !point) {
    return { action: "allow" };
  }
  if (options.dungeonGateTransit === true || options.ignoreDeadspaceWarpRestriction === true) {
    return { action: "allow" };
  }
  // Deadspace warp rules apply to capsuleer ships only. NPC warps (mining fleets, belt rats,
  // response squads) route through the same warpToPoint and must never be clamped/blocked.
  if (entity.nativeNpc === true || entity.npc === true || entity.kind !== "ship") {
    return { action: "allow" };
  }

  const dungeonRuntime = requireDungeonRuntime();
  const currentInstanceID = Math.max(0, toInt(entity.dungeonCurrentInstanceID, 0));

  // (A) Ship is inside a pocket — block warps that stay inside the same site.
  if (currentInstanceID > 0 && dungeonRuntime && typeof dungeonRuntime.getInstance === "function") {
    const instance = dungeonRuntime.getInstance(currentInstanceID);
    if (instance && isPointInsideInstance(point, instance)) {
      return {
        action: "block",
        errorMsg: "DunCannotWarpWithinComplex",
        siteInstanceID: currentInstanceID,
      };
    }
    // destination outside the current site → a warp OUT → allowed (fall through to clamp check for
    // a *different* site, though that is rare from inside a pocket).
  }

  // (B) Warp-in clamp: destination lands inside a dungeon site the ship is NOT currently in.
  if (dungeonRuntime && typeof dungeonRuntime.listActiveInstancesBySystem === "function") {
    const systemID = Math.max(0, toInt(entity.systemID, 0));
    if (systemID > 0) {
      let containing = null;
      let containingDistance = Infinity;
      try {
        const instances = dungeonRuntime.listActiveInstancesBySystem(systemID, { full: true }) || [];
        for (const instance of instances) {
          if (Math.max(0, toInt(instance && instance.instanceID, 0)) === currentInstanceID) {
            continue;
          }
          if (isPointInsideInstance(point, instance)) {
            const anchor = resolveInstanceAnchor(instance);
            const candidateDistance = distanceMeters(point, anchor);
            if (candidateDistance < containingDistance) {
              containing = instance;
              containingDistance = candidateDistance;
            }
          }
        }
      } catch (_error) {
        containing = null;
      }
      if (containing) {
        const warpInPoint = resolveSiteWarpInPoint(containing, entity, scene);
        if (warpInPoint && distanceMeters(warpInPoint, point) > 1) {
          return {
            action: "clamp",
            point: warpInPoint,
            siteInstanceID: Math.max(0, toInt(containing.instanceID, 0)),
          };
        }
      }
    }
  }

  return { action: "allow" };
}

// Resolve the deterministic approach-side landing point. The site boundary prevents an inbound
// warp from landing in the active grid, while the obstacle pass prevents an unusually large or
// explicitly placed object from enveloping that boundary point.
function resolveSiteWarpInPoint(instance, shipEntity = null, scene = null) {
  const anchor = resolveInstanceAnchor(instance);
  if (!anchor) {
    return null;
  }
  const profile = resolveSiteWarpInProfile(instance);
  const shipPosition = pointFromVector(shipEntity && shipEntity.position);
  const direction = normalizeVector(
    shipPosition ? subtractVectors(shipPosition, anchor) : null,
    { x: 1, y: 0, z: 0 },
  );
  const shipRadius = Math.max(0, toFiniteNumber(shipEntity && shipEntity.radius, 0));
  const obstacles = [
    ...listMaterializedSiteObstacles(
      instance,
      scene,
      Math.max(0, toInt(shipEntity && shipEntity.itemID, 0)),
    ),
    ...listAuthoredSiteObstacles(instance, profile.template),
  ];
  const radialDistance = resolveCollisionSafeRadialDistance(
    anchor,
    direction,
    profile.boundaryRadiusMeters + profile.collisionClearanceMeters + shipRadius,
    obstacles,
    profile.collisionClearanceMeters,
    shipRadius,
  );
  return addVectors(anchor, scaleVector(direction, radialDistance));
}

module.exports = {
  DEADSPACE_SITE_RADIUS_METERS,
  DUNGEON_SITE_WARP_IN_BOUNDARY_METERS,
  DUNGEON_WARP_IN_COLLISION_CLEARANCE_METERS,
  evaluateDeadspaceWarp,
  isPointInsideInstance,
  resolveInstanceAnchor,
  resolveSiteWarpInProfile,
  resolveSiteWarpInPoint,
};
