import type { Vector3 } from "./../../types";

"use strict";

const NON_PHYSICAL_COLLISION_KINDS = new Set([
  "asteroidbelt",
  "landscapesite",
  "missile",
  "probe",
  "scannerprobe",
  "warpdisruptionprobe",
]);

const COLLISION_EPSILON_METERS = 0.01;
const COLLISION_MOTION_EPSILON_SQUARED = 1e-12;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(value, fallback: Vector3 = { x: 0, y: 0, z: 0 }): Vector3 {
  return {
    x: toFiniteNumber(value && value.x, fallback.x),
    y: toFiniteNumber(value && value.y, fallback.y),
    z: toFiniteNumber(value && value.z, fallback.z),
  };
}

function addVectors(left, right): Vector3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right): Vector3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scale): Vector3 {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function magnitudeSquared(vector) {
  return dotProduct(vector, vector);
}

function normalizeVector(vector, fallback: Vector3 = { x: 1, y: 0, z: 0 }): Vector3 {
  const lengthSquared = magnitudeSquared(vector);
  if (lengthSquared <= COLLISION_MOTION_EPSILON_SQUARED) {
    return cloneVector(fallback);
  }
  return scaleVector(vector, 1 / Math.sqrt(lengthSquared));
}

function hasFinitePosition(entity) {
  return Boolean(
    entity &&
    entity.position &&
    Number.isFinite(Number(entity.position.x)) &&
    Number.isFinite(Number(entity.position.y)) &&
    Number.isFinite(Number(entity.position.z)),
  );
}

function getEntityCollisionRadius(entity) {
  return Math.max(
    0,
    toFiniteNumber(
      entity && (entity.collisionRadius ?? entity.radius),
      0,
    ),
  );
}

function isEntityCloakedForCollision(entity) {
  return Boolean(
    entity &&
    (
      entity.cloaked === true ||
      toFiniteNumber(entity.isCloaked, 0) > 0 ||
      toFiniteNumber(entity.cloakMode, 0) > 0 ||
      entity.stargateJumpCloak === true
    ),
  );
}

function hasCollisionOptOut(entity) {
  return Boolean(
    entity &&
    (
      entity.collisionEnabled === false ||
      entity.destinyCollisionEnabled === false ||
      entity.destinyForceMassive === false ||
      entity.nonPhysicalCollision === true ||
      entity.nonPhysicalDecloakExempt === true
    ),
  );
}

function isEntityCollisionEnabled(entity) {
  if (
    !entity ||
    !hasFinitePosition(entity) ||
    getEntityCollisionRadius(entity) <= 0 ||
    hasCollisionOptOut(entity)
  ) {
    return false;
  }
  const kind = String(entity.kind || "").trim().toLowerCase();
  const mode = String(entity.mode || entity.destinyBallMode || "").trim().toUpperCase();
  const activeWarp = mode === "WARP" && !entity.pendingWarp;
  return (
    !NON_PHYSICAL_COLLISION_KINDS.has(kind) &&
    mode !== "MISSILE" &&
    !activeWarp &&
    !entity.pendingDock &&
    !entity.sessionlessWarpIngress &&
    !isEntityCloakedForCollision(entity)
  );
}

function isEntityCollisionMover(entity) {
  return Boolean(
    isEntityCollisionEnabled(entity) &&
    entity.collisionStatic !== true,
  );
}

function getEntityIdentityText(entity) {
  const value = entity && entity.itemID;
  if (typeof value === "bigint") {
    return value.toString();
  }
  return String(value ?? "");
}

function canEntitiesCollide(movingEntity, candidate) {
  if (
    !isEntityCollisionEnabled(candidate) ||
    candidate === movingEntity ||
    getEntityIdentityText(candidate) === getEntityIdentityText(movingEntity)
  ) {
    return false;
  }

  const movingSystemID = Number(
    movingEntity && (movingEntity.systemID ?? movingEntity.solarSystemID),
  );
  const candidateSystemID = Number(
    candidate && (candidate.systemID ?? candidate.solarSystemID),
  );
  if (
    Number.isFinite(movingSystemID) &&
    movingSystemID > 0 &&
    Number.isFinite(candidateSystemID) &&
    candidateSystemID > 0 &&
    movingSystemID !== candidateSystemID
  ) {
    return false;
  }

  const movingBubbleID = Number(movingEntity && movingEntity.bubbleID);
  const candidateBubbleID = Number(candidate && candidate.bubbleID);
  return !(
    Number.isFinite(movingBubbleID) &&
    movingBubbleID > 0 &&
    Number.isFinite(candidateBubbleID) &&
    candidateBubbleID > 0 &&
    movingBubbleID !== candidateBubbleID
  );
}

function getSceneCollisionCandidates(scene) {
  if (!scene || typeof scene !== "object") {
    return [];
  }
  if (typeof scene.getAllVisibleEntities === "function") {
    const entities = scene.getAllVisibleEntities();
    if (Array.isArray(entities)) {
      return entities;
    }
  }
  const staticEntities = Array.isArray(scene.staticEntities)
    ? scene.staticEntities
    : [];
  const dynamicEntities = scene.dynamicEntities instanceof Map
    ? [...scene.dynamicEntities.values()]
    : typeof scene.getDynamicEntities === "function"
      ? scene.getDynamicEntities()
      : [];
  return [
    ...staticEntities,
    ...(Array.isArray(dynamicEntities) ? dynamicEntities : []),
  ];
}

function getCandidateStartPosition(candidate, activeTickSequence) {
  const candidateAdvancedThisTick = Boolean(
    Number.isFinite(Number(activeTickSequence)) &&
    Number(activeTickSequence) > 0 &&
    Number(candidate && candidate._lastMovementAdvancedTickSequence) ===
      Number(activeTickSequence),
  );
  const debugStart =
    candidateAdvancedThisTick &&
    candidate &&
    candidate.lastMotionDebug &&
    candidate.lastMotionDebug.previousPosition;
  return hasFinitePosition({ position: debugStart })
    ? cloneVector(debugStart)
    : cloneVector(candidate && candidate.position);
}

function buildIgnoredEntityIdentitySet(values: any[] = []) {
  return new Set(
    values
      .filter((value) => value !== undefined && value !== null)
      .map((value) => getEntityIdentityText({ itemID: value })),
  );
}

function findLineSegmentSphereIntersection(start, end, center, radius) {
  const segment = subtractVectors(end, start);
  const segmentLengthSquared = magnitudeSquared(segment);
  const resolvedRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (
    segmentLengthSquared <= COLLISION_MOTION_EPSILON_SQUARED ||
    resolvedRadius <= 0
  ) {
    return null;
  }

  const relativeStart = subtractVectors(start, center);
  const radiusSquared = resolvedRadius * resolvedRadius;
  if (magnitudeSquared(relativeStart) <= radiusSquared) {
    return {
      fraction: 0,
      position: cloneVector(start),
      startedInside: true,
    };
  }

  const a = segmentLengthSquared;
  const b = 2 * dotProduct(relativeStart, segment);
  const c = magnitudeSquared(relativeStart) - radiusSquared;
  const discriminant = (b * b) - (4 * a * c);
  if (discriminant < 0) {
    return null;
  }
  const fraction = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  if (fraction < 0 || fraction > 1) {
    return null;
  }
  return {
    fraction,
    position: addVectors(start, scaleVector(segment, fraction)),
    startedInside: false,
  };
}

function findWeaponLineOccluder(
  scene,
  sourceEntity,
  targetEntity,
  options: Record<string, any> = {},
) {
  if (
    !scene ||
    !hasFinitePosition(sourceEntity) ||
    !hasFinitePosition(targetEntity)
  ) {
    return null;
  }

  const sourcePosition = cloneVector(sourceEntity.position);
  const targetPosition = cloneVector(targetEntity.position);
  const sourceToTarget = subtractVectors(targetPosition, sourcePosition);
  const centerDistanceSquared = magnitudeSquared(sourceToTarget);
  if (centerDistanceSquared <= COLLISION_MOTION_EPSILON_SQUARED) {
    return null;
  }

  const centerDistance = Math.sqrt(centerDistanceSquared);
  const direction = scaleVector(sourceToTarget, 1 / centerDistance);
  const sourceRadius = getEntityCollisionRadius(sourceEntity);
  const targetRadius = getEntityCollisionRadius(targetEntity);
  const startOffset = Math.min(
    centerDistance,
    sourceRadius + COLLISION_EPSILON_METERS,
  );
  const endOffset = Math.max(
    startOffset,
    centerDistance - targetRadius - COLLISION_EPSILON_METERS,
  );
  if (endOffset - startOffset <= COLLISION_EPSILON_METERS) {
    return null;
  }

  const rayStart = addVectors(sourcePosition, scaleVector(direction, startOffset));
  const rayEnd = addVectors(sourcePosition, scaleVector(direction, endOffset));
  const ignoredIdentities = buildIgnoredEntityIdentitySet([
    sourceEntity.itemID,
    targetEntity.itemID,
    ...(Array.isArray(options.ignoreEntityIDs) ? options.ignoreEntityIDs : []),
  ]);
  let earliest = null;
  for (const candidate of getSceneCollisionCandidates(scene)) {
    if (
      !candidate ||
      ignoredIdentities.has(getEntityIdentityText(candidate)) ||
      !canEntitiesCollide(sourceEntity, candidate)
    ) {
      continue;
    }
    const intersection = findLineSegmentSphereIntersection(
      rayStart,
      rayEnd,
      cloneVector(candidate.position),
      getEntityCollisionRadius(candidate),
    );
    if (
      intersection &&
      (
        !earliest ||
        intersection.fraction < earliest.fraction - 1e-12 ||
        (
          Math.abs(intersection.fraction - earliest.fraction) <= 1e-12 &&
          getEntityIdentityText(candidate).localeCompare(
            getEntityIdentityText(earliest.entity),
            undefined,
            { numeric: true },
          ) < 0
        )
      )
    ) {
      earliest = {
        entity: candidate,
        entityID: candidate.itemID,
        kind: String(candidate.kind || "object"),
        fraction: intersection.fraction,
        distance: (endOffset - startOffset) * intersection.fraction,
        position: cloneVector(intersection.position),
        startedInside: intersection.startedInside,
      };
    }
  }
  return earliest;
}

function findSweptWeaponOccluder(
  movingEntity,
  scene,
  previousPosition,
  options: Record<string, any> = {},
) {
  if (
    !movingEntity ||
    !scene ||
    !hasFinitePosition({ position: previousPosition }) ||
    !hasFinitePosition(movingEntity)
  ) {
    return null;
  }

  const movingStart = cloneVector(previousPosition);
  const movingEnd = cloneVector(movingEntity.position);
  if (
    magnitudeSquared(subtractVectors(movingEnd, movingStart)) <=
      COLLISION_MOTION_EPSILON_SQUARED
  ) {
    return null;
  }

  const ignoredIdentities = buildIgnoredEntityIdentitySet([
    movingEntity.itemID,
    ...(Array.isArray(options.ignoreEntityIDs) ? options.ignoreEntityIDs : []),
  ]);
  const activeTickSequence = options.activeTickSequence ?? scene._activeTickSequence;
  let earliest = null;
  for (const candidate of getSceneCollisionCandidates(scene)) {
    if (
      !candidate ||
      ignoredIdentities.has(getEntityIdentityText(candidate)) ||
      !canEntitiesCollide(movingEntity, candidate)
    ) {
      continue;
    }
    const candidateEnd = cloneVector(candidate.position);
    const candidateStart = getCandidateStartPosition(candidate, activeTickSequence);
    const collision = findSweptSphereCollision(
      movingEntity,
      candidate,
      movingStart,
      movingEnd,
      candidateStart,
      candidateEnd,
    );
    if (
      collision &&
      (
        !earliest ||
        collision.fraction < earliest.fraction - 1e-12 ||
        (
          Math.abs(collision.fraction - earliest.fraction) <= 1e-12 &&
          getEntityIdentityText(candidate).localeCompare(
            getEntityIdentityText(earliest.entity),
            undefined,
            { numeric: true },
          ) < 0
        )
      )
    ) {
      earliest = {
        ...collision,
        entity: candidate,
        entityID: candidate.itemID,
        kind: String(candidate.kind || "object"),
        position: addVectors(
          movingStart,
          scaleVector(
            subtractVectors(movingEnd, movingStart),
            collision.fraction,
          ),
        ),
        candidateStart,
        candidateEnd,
      };
    }
  }
  return earliest;
}

function buildFallbackContactNormal(relativeMotion, movingEntity, candidate) {
  if (magnitudeSquared(relativeMotion) > COLLISION_MOTION_EPSILON_SQUARED) {
    return normalizeVector(scaleVector(relativeMotion, -1));
  }
  return getEntityIdentityText(movingEntity).localeCompare(
    getEntityIdentityText(candidate),
    undefined,
    { numeric: true },
  ) <= 0
    ? { x: -1, y: 0, z: 0 }
    : { x: 1, y: 0, z: 0 };
}

function findSweptSphereCollision(
  movingEntity,
  candidate,
  movingStart,
  movingEnd,
  candidateStart,
  candidateEnd,
) {
  const combinedRadius =
    getEntityCollisionRadius(movingEntity) + getEntityCollisionRadius(candidate);
  if (combinedRadius <= 0) {
    return null;
  }

  const relativeStart = subtractVectors(movingStart, candidateStart);
  const relativeEnd = subtractVectors(movingEnd, candidateEnd);
  const relativeMotion = subtractVectors(relativeEnd, relativeStart);
  const radiusSquared = combinedRadius * combinedRadius;
  const startSeparationSquared = magnitudeSquared(relativeStart);

  if (startSeparationSquared <= radiusSquared) {
    // A contained mover cannot be allowed to traverse the candidate until it
    // happens to cross the far side of the sphere. Depenetrate it to the
    // nearest boundary immediately. The end vector supplies a useful outward
    // direction for the otherwise ambiguous center-to-center case.
    return {
      candidate,
      combinedRadius,
      fraction: 0,
      normal: normalizeVector(
        relativeStart,
        normalizeVector(
          relativeEnd,
          buildFallbackContactNormal(relativeMotion, movingEntity, candidate),
        ),
      ),
      startedOverlapping: true,
      penetrationDepth:
        combinedRadius - Math.sqrt(Math.max(0, startSeparationSquared)),
    };
  }

  const a = magnitudeSquared(relativeMotion);
  if (a <= COLLISION_MOTION_EPSILON_SQUARED) {
    return null;
  }
  const b = 2 * dotProduct(relativeStart, relativeMotion);
  const c = startSeparationSquared - radiusSquared;
  const discriminant = (b * b) - (4 * a * c);
  if (discriminant < 0) {
    return null;
  }
  const fraction = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  if (fraction < 0 || fraction > 1) {
    return null;
  }

  const relativeImpact = addVectors(
    relativeStart,
    scaleVector(relativeMotion, fraction),
  );
  return {
    candidate,
    combinedRadius,
    fraction,
    normal: normalizeVector(
      relativeImpact,
      buildFallbackContactNormal(relativeMotion, movingEntity, candidate),
    ),
    startedOverlapping: false,
  };
}

function resolveEntityMovementCollision(
  entity,
  scene,
  previousPosition,
  options: Record<string, any> = {},
) {
  if (!isEntityCollisionMover(entity) || !hasFinitePosition({ position: previousPosition })) {
    return null;
  }

  const movingStart = cloneVector(previousPosition);
  const movingEnd = cloneVector(entity.position);

  const activeTickSequence = options.activeTickSequence ?? scene._activeTickSequence;
  const candidates = getSceneCollisionCandidates(scene)
    .filter((candidate) => canEntitiesCollide(entity, candidate));
  let earliest = null;
  for (const candidate of candidates) {
    const candidateEnd = cloneVector(candidate.position);
    const candidateStart = getCandidateStartPosition(candidate, activeTickSequence);
    const collision = findSweptSphereCollision(
      entity,
      candidate,
      movingStart,
      movingEnd,
      candidateStart,
      candidateEnd,
    );
    if (
      collision &&
      (
        !earliest ||
        collision.fraction < earliest.fraction - 1e-12 ||
        (
          Math.abs(collision.fraction - earliest.fraction) <= 1e-12 &&
          getEntityIdentityText(collision.candidate).localeCompare(
            getEntityIdentityText(earliest.candidate),
            undefined,
            { numeric: true },
          ) < 0
        )
      )
    ) {
      earliest = {
        ...collision,
        candidateStart,
        candidateEnd,
      };
    }
  }
  if (!earliest) {
    return null;
  }

  const candidateImpactPosition = addVectors(
    earliest.candidateStart,
    scaleVector(
      subtractVectors(earliest.candidateEnd, earliest.candidateStart),
      earliest.fraction,
    ),
  );
  entity.position = addVectors(
    candidateImpactPosition,
    scaleVector(
      earliest.normal,
      earliest.combinedRadius + COLLISION_EPSILON_METERS,
    ),
  );

  const candidateVelocity = cloneVector(earliest.candidate.velocity);
  const entityVelocity = cloneVector(entity.velocity);
  const relativeVelocity = subtractVectors(entityVelocity, candidateVelocity);
  const inwardSpeed = dotProduct(relativeVelocity, earliest.normal);
  entity.velocity = inwardSpeed < 0
    ? addVectors(
        candidateVelocity,
        subtractVectors(
          relativeVelocity,
          scaleVector(earliest.normal, inwardSpeed),
        ),
      )
    : entityVelocity;

  const collision = {
    entityID: earliest.candidate.itemID,
    kind: String(earliest.candidate.kind || "object"),
    fraction: earliest.fraction,
    normal: cloneVector(earliest.normal),
    combinedRadius: earliest.combinedRadius,
    startedOverlapping: earliest.startedOverlapping,
    penetrationDepth: Math.max(0, toFiniteNumber(earliest.penetrationDepth, 0)),
  };
  entity.lastCollision = collision;
  if (entity.lastMotionDebug && typeof entity.lastMotionDebug === "object") {
    const previousVelocity = cloneVector(entity.lastMotionDebug.previousVelocity);
    entity.lastMotionDebug = {
      ...entity.lastMotionDebug,
      collision,
      positionDelta: subtractVectors(entity.position, movingStart),
      velocityDelta: subtractVectors(entity.velocity, previousVelocity),
    };
  }
  return collision;
}

module.exports = {
  COLLISION_EPSILON_METERS,
  canEntitiesCollide,
  findLineSegmentSphereIntersection,
  findSweptWeaponOccluder,
  findSweptSphereCollision,
  findWeaponLineOccluder,
  getEntityCollisionRadius,
  getSceneCollisionCandidates,
  isEntityCollisionEnabled,
  isEntityCollisionMover,
  resolveEntityMovementCollision,
};
