import type { Vector3 } from "./../../types";

"use strict";

const {
  resolveEntityCollisionPresentation,
  rotateVectorWxyz,
} = require("../collision/collisionBundle");

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

function getEntityCollisionBroadphaseRadius(entity) {
  const presentation = resolveEntityCollisionPresentation(
    entity,
    undefined,
    { metadataOnly: true },
  );
  const profileRadius = presentation.profile && Math.max(
    0,
    toFiniteNumber(presentation.profile.boundingRadius, 0) *
      Math.abs(toFiniteNumber(presentation.collisionScale, 1)),
  );
  return profileRadius > 0 ? profileRadius : getEntityCollisionRadius(entity);
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
    getEntityCollisionBroadphaseRadius(entity) <= 0 ||
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

function closestPointOnSegment(point, start, end) {
  const segment = subtractVectors(end, start);
  const lengthSquared = magnitudeSquared(segment);
  if (lengthSquared <= COLLISION_MOTION_EPSILON_SQUARED) {
    return cloneVector(start);
  }
  const fraction = Math.max(
    0,
    Math.min(1, dotProduct(subtractVectors(point, start), segment) / lengthSquared),
  );
  return addVectors(start, scaleVector(segment, fraction));
}

function findSweptPointAgainstSphere(start, end, center, radius) {
  const resolvedRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (resolvedRadius <= 0) {
    return null;
  }
  const startOffset = subtractVectors(start, center);
  const startDistanceSquared = magnitudeSquared(startOffset);
  if (startDistanceSquared <= resolvedRadius * resolvedRadius) {
    const motion = subtractVectors(end, start);
    return {
      fraction: 0,
      normal: normalizeVector(
        startOffset,
        normalizeVector(scaleVector(motion, -1)),
      ),
      penetrationDepth:
        resolvedRadius - Math.sqrt(Math.max(0, startDistanceSquared)),
      startedOverlapping: true,
    };
  }
  const intersection = findLineSegmentSphereIntersection(
    start,
    end,
    center,
    resolvedRadius,
  );
  if (!intersection) {
    return null;
  }
  return {
    fraction: intersection.fraction,
    normal: normalizeVector(subtractVectors(intersection.position, center)),
    penetrationDepth: 0,
    startedOverlapping: false,
  };
}

function findSweptPointAgainstCapsule(start, end, capsuleStart, capsuleEnd, radius) {
  const resolvedRadius = Math.max(0, toFiniteNumber(radius, 0));
  if (resolvedRadius <= 0) {
    return null;
  }
  const capsuleAxis = subtractVectors(capsuleEnd, capsuleStart);
  const axisLengthSquared = magnitudeSquared(capsuleAxis);
  if (axisLengthSquared <= COLLISION_MOTION_EPSILON_SQUARED) {
    return findSweptPointAgainstSphere(start, end, capsuleStart, resolvedRadius);
  }

  const startClosest = closestPointOnSegment(start, capsuleStart, capsuleEnd);
  const startOffset = subtractVectors(start, startClosest);
  const startDistanceSquared = magnitudeSquared(startOffset);
  if (startDistanceSquared <= resolvedRadius * resolvedRadius) {
    const motion = subtractVectors(end, start);
    return {
      fraction: 0,
      normal: normalizeVector(
        startOffset,
        normalizeVector(scaleVector(motion, -1)),
      ),
      penetrationDepth:
        resolvedRadius - Math.sqrt(Math.max(0, startDistanceSquared)),
      startedOverlapping: true,
    };
  }

  const direction = subtractVectors(end, start);
  const directionLengthSquared = magnitudeSquared(direction);
  if (directionLengthSquared <= COLLISION_MOTION_EPSILON_SQUARED) {
    return null;
  }

  // Analytic ray/capsule intersection. The cylinder body and both spherical
  // end caps are tested separately; the earliest segment fraction wins.
  const originFromA = subtractVectors(start, capsuleStart);
  const baba = axisLengthSquared;
  const bard = dotProduct(capsuleAxis, direction);
  const baoa = dotProduct(capsuleAxis, originFromA);
  const rdoa = dotProduct(direction, originFromA);
  const oaoa = magnitudeSquared(originFromA);
  const a = (baba * directionLengthSquared) - (bard * bard);
  const b = (baba * rdoa) - (baoa * bard);
  const c = (baba * oaoa) - (baoa * baoa) -
    (resolvedRadius * resolvedRadius * baba);

  const candidates = [];
  const discriminant = (b * b) - (a * c);
  if (Math.abs(a) > COLLISION_MOTION_EPSILON_SQUARED && discriminant >= 0) {
    const fraction = (-b - Math.sqrt(Math.max(0, discriminant))) / a;
    const axisProjection = baoa + (fraction * bard);
    if (fraction >= 0 && fraction <= 1 && axisProjection > 0 && axisProjection < baba) {
      candidates.push(fraction);
    }
  }
  for (const capCenter of [capsuleStart, capsuleEnd]) {
    const capHit = findLineSegmentSphereIntersection(
      start,
      end,
      capCenter,
      resolvedRadius,
    );
    if (capHit) {
      candidates.push(capHit.fraction);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const fraction = Math.min(...candidates);
  const impact = addVectors(start, scaleVector(direction, fraction));
  const closest = closestPointOnSegment(impact, capsuleStart, capsuleEnd);
  return {
    fraction,
    normal: normalizeVector(
      subtractVectors(impact, closest),
      normalizeVector(scaleVector(direction, -1)),
    ),
    penetrationDepth: 0,
    startedOverlapping: false,
  };
}

function buildBoxFrame(box) {
  const edges = [box.edgeX, box.edgeY, box.edgeZ].map((edge) => cloneVector(edge));
  const lengths = edges.map((edge) => Math.sqrt(magnitudeSquared(edge)));
  if (lengths.some((length) => length <= COLLISION_EPSILON_METERS)) {
    return null;
  }
  return {
    corner: cloneVector(box.corner),
    axes: edges.map((edge, index) => scaleVector(edge, 1 / lengths[index])),
    lengths,
  };
}

function boxCoordinates(point, frame) {
  const relative = subtractVectors(point, frame.corner);
  return frame.axes.map((axis) => dotProduct(relative, axis));
}

function pointFromBoxCoordinates(coordinates, frame) {
  let point = cloneVector(frame.corner);
  for (let index = 0; index < 3; index += 1) {
    point = addVectors(point, scaleVector(frame.axes[index], coordinates[index]));
  }
  return point;
}

function chooseEarlierIntersection(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current || candidate.fraction < current.fraction - 1e-12) {
    return candidate;
  }
  return current;
}

function findSweptSphereAgainstBox(start, end, radius, box) {
  const resolvedRadius = Math.max(0, toFiniteNumber(radius, 0));
  const frame = buildBoxFrame(box);
  if (!frame) {
    return null;
  }
  const startCoordinates = boxCoordinates(start, frame);
  const clampedStart = startCoordinates.map((coordinate, index) =>
    Math.max(0, Math.min(frame.lengths[index], coordinate)));
  const closestStart = pointFromBoxCoordinates(clampedStart, frame);
  const startOffset = subtractVectors(start, closestStart);
  const startDistance = Math.sqrt(Math.max(0, magnitudeSquared(startOffset)));
  const startInside = startCoordinates.every(
    (coordinate, index) => coordinate >= 0 && coordinate <= frame.lengths[index],
  );
  if (startInside || startDistance <= resolvedRadius) {
    if (startInside) {
      let nearestAxis = 0;
      let nearestSide = -1;
      let nearestDistance = startCoordinates[0];
      for (let axis = 0; axis < 3; axis += 1) {
        const distances = [
          { distance: startCoordinates[axis], side: -1 },
          { distance: frame.lengths[axis] - startCoordinates[axis], side: 1 },
        ];
        for (const value of distances) {
          if (value.distance < nearestDistance) {
            nearestAxis = axis;
            nearestSide = value.side;
            nearestDistance = value.distance;
          }
        }
      }
      return {
        fraction: 0,
        normal: scaleVector(frame.axes[nearestAxis], nearestSide),
        penetrationDepth: resolvedRadius + nearestDistance,
        startedOverlapping: true,
      };
    }
    return {
      fraction: 0,
      normal: normalizeVector(startOffset),
      penetrationDepth: resolvedRadius - startDistance,
      startedOverlapping: true,
    };
  }

  const direction = subtractVectors(end, start);
  if (magnitudeSquared(direction) <= COLLISION_MOTION_EPSILON_SQUARED) {
    return null;
  }
  const endCoordinates = boxCoordinates(end, frame);
  const coordinateMotion = endCoordinates.map(
    (coordinate, index) => coordinate - startCoordinates[index],
  );
  let earliest = null;

  // Six planar face regions of the rounded box.
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(coordinateMotion[axis]) <= Number.EPSILON) {
      continue;
    }
    for (const side of [-1, 1]) {
      const plane = side < 0 ? -resolvedRadius : frame.lengths[axis] + resolvedRadius;
      const fraction = (plane - startCoordinates[axis]) / coordinateMotion[axis];
      if (fraction < 0 || fraction > 1) {
        continue;
      }
      const coordinates = startCoordinates.map(
        (coordinate, index) => coordinate + (coordinateMotion[index] * fraction),
      );
      const withinFace = coordinates.every(
        (coordinate, index) => index === axis ||
          (coordinate >= 0 && coordinate <= frame.lengths[index]),
      );
      const movingTowardFace = side < 0
        ? coordinateMotion[axis] > 0
        : coordinateMotion[axis] < 0;
      if (withinFace && movingTowardFace) {
        earliest = chooseEarlierIntersection(earliest, {
          fraction,
          normal: scaleVector(frame.axes[axis], side),
          penetrationDepth: 0,
          startedOverlapping: false,
        });
      }
    }
  }

  // Twelve edge capsules include the rounded edge cylinders and corner caps.
  for (let edgeAxis = 0; edgeAxis < 3; edgeAxis += 1) {
    const otherAxes = [0, 1, 2].filter((axis) => axis !== edgeAxis);
    for (const firstSide of [0, 1]) {
      for (const secondSide of [0, 1]) {
        const coordinates = [0, 0, 0];
        coordinates[otherAxes[0]] = firstSide * frame.lengths[otherAxes[0]];
        coordinates[otherAxes[1]] = secondSide * frame.lengths[otherAxes[1]];
        const edgeStart = pointFromBoxCoordinates(coordinates, frame);
        coordinates[edgeAxis] = frame.lengths[edgeAxis];
        const edgeEnd = pointFromBoxCoordinates(coordinates, frame);
        earliest = chooseEarlierIntersection(
          earliest,
          findSweptPointAgainstCapsule(
            start,
            end,
            edgeStart,
            edgeEnd,
            resolvedRadius,
          ),
        );
      }
    }
  }
  return earliest;
}

function resolveEntityCollisionQuaternion(entity) {
  const source = entity && (entity.collisionQuaternion || entity.collisionRotation);
  if (Array.isArray(source) && source.length >= 4) {
    return {
      w: toFiniteNumber(source[0], 1),
      x: toFiniteNumber(source[1], 0),
      y: toFiniteNumber(source[2], 0),
      z: toFiniteNumber(source[3], 0),
    };
  }
  if (source && typeof source === "object") {
    return {
      w: toFiniteNumber(source.w, 1),
      x: toFiniteNumber(source.x, 0),
      y: toFiniteNumber(source.y, 0),
      z: toFiniteNumber(source.z, 0),
    };
  }
  return { w: 1, x: 0, y: 0, z: 0 };
}

function transformProfilePoint(point, origin, scale, quaternion) {
  return addVectors(
    origin,
    rotateVectorWxyz(scaleVector(point, scale), quaternion),
  );
}

function transformProfileDirection(direction, scale, quaternion) {
  return rotateVectorWxyz(scaleVector(direction, scale), quaternion);
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
    const intersection = findSweptEntityCollision(
      sourceEntity,
      candidate,
      rayStart,
      rayEnd,
      cloneVector(candidate.position),
      cloneVector(candidate.position),
      { movingRadius: 0 },
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
        position: addVectors(
          rayStart,
          scaleVector(
            subtractVectors(rayEnd, rayStart),
            intersection.fraction,
          ),
        ),
        startedInside: intersection.startedOverlapping,
        primitiveType: intersection.primitiveType || "sphereFallback",
        collisionID: intersection.collisionID || null,
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
    const collision = findSweptEntityCollision(
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
  options: Record<string, any> = {},
) {
  const combinedRadius =
    (
      options.movingRadius !== undefined
        ? Math.max(0, toFiniteNumber(options.movingRadius, 0))
        : getEntityCollisionRadius(movingEntity)
    ) + (
      options.candidateRadius !== undefined
        ? Math.max(0, toFiniteNumber(options.candidateRadius, 0))
        : getEntityCollisionRadius(candidate)
    );
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

function profileHasPrimitiveGeometry(profile) {
  return Boolean(
    profile &&
    (
      (Array.isArray(profile.balls) && profile.balls.length > 0) ||
      (Array.isArray(profile.boxes) && profile.boxes.length > 0) ||
      (Array.isArray(profile.capsules) && profile.capsules.length > 0)
    ),
  );
}

function findSweptEntityCollision(
  movingEntity,
  candidate,
  movingStart,
  movingEnd,
  candidateStart,
  candidateEnd,
  options: Record<string, any> = {},
) {
  const presentation = resolveEntityCollisionPresentation(candidate);
  const profile = presentation.profile;
  if (!profileHasPrimitiveGeometry(profile)) {
    const profileFallbackRadius = profile
      ? Math.max(
          0,
          toFiniteNumber(profile.boundingRadius, 0) *
            Math.abs(toFiniteNumber(presentation.collisionScale, 1)),
        )
      : null;
    return findSweptSphereCollision(
      movingEntity,
      candidate,
      movingStart,
      movingEnd,
      candidateStart,
      candidateEnd,
      profileFallbackRadius > 0
        ? { ...options, candidateRadius: profileFallbackRadius }
        : options,
    );
  }

  const movingRadius = options.movingRadius !== undefined
    ? Math.max(0, toFiniteNumber(options.movingRadius, 0))
    : getEntityCollisionRadius(movingEntity);
  const collisionScale = toFiniteNumber(presentation.collisionScale, 1);
  const absoluteScale = Math.abs(collisionScale);
  const quaternion = resolveEntityCollisionQuaternion(candidate);
  const candidateMotion = subtractVectors(candidateEnd, candidateStart);
  const relativeEnd = subtractVectors(movingEnd, candidateMotion);

  // Reject the vast majority of candidates using the bundle's authored bound
  // before materializing or testing individual compound primitives.
  const broadphaseRadius = Math.max(
    movingRadius,
    movingRadius + (Math.max(0, toFiniteNumber(profile.boundingRadius, 0)) * absoluteScale),
  );
  const relativeStartFromOrigin = subtractVectors(movingStart, candidateStart);
  const startsInsideBroadphase =
    magnitudeSquared(relativeStartFromOrigin) <= broadphaseRadius * broadphaseRadius;
  if (
    !startsInsideBroadphase &&
    !findLineSegmentSphereIntersection(
      movingStart,
      relativeEnd,
      candidateStart,
      broadphaseRadius,
    )
  ) {
    return null;
  }

  let earliest = null;
  let primitiveIndex = 0;
  for (const ball of profile.balls || []) {
    const center = transformProfilePoint(
      ball.center,
      candidateStart,
      collisionScale,
      quaternion,
    );
    const shapeRadius = Math.max(0, toFiniteNumber(ball.radius, 0) * absoluteScale);
    const collision = findSweptPointAgainstSphere(
      movingStart,
      relativeEnd,
      center,
      movingRadius + shapeRadius,
    );
    earliest = chooseEarlierIntersection(earliest, collision && {
      ...collision,
      combinedRadius: movingRadius + shapeRadius,
      primitiveIndex,
      primitiveType: "ball",
    });
    primitiveIndex += 1;
  }
  for (const box of profile.boxes || []) {
    const worldBox = {
      corner: transformProfilePoint(
        box.corner,
        candidateStart,
        collisionScale,
        quaternion,
      ),
      edgeX: transformProfileDirection(box.edgeX, collisionScale, quaternion),
      edgeY: transformProfileDirection(box.edgeY, collisionScale, quaternion),
      edgeZ: transformProfileDirection(box.edgeZ, collisionScale, quaternion),
    };
    const collision = findSweptSphereAgainstBox(
      movingStart,
      relativeEnd,
      movingRadius,
      worldBox,
    );
    earliest = chooseEarlierIntersection(earliest, collision && {
      ...collision,
      combinedRadius: movingRadius,
      primitiveIndex,
      primitiveType: "box",
    });
    primitiveIndex += 1;
  }
  for (const capsule of profile.capsules || []) {
    const capsuleStart = transformProfilePoint(
      capsule.start,
      candidateStart,
      collisionScale,
      quaternion,
    );
    const capsuleEnd = transformProfilePoint(
      capsule.end,
      candidateStart,
      collisionScale,
      quaternion,
    );
    const shapeRadius = Math.max(
      0,
      toFiniteNumber(capsule.radius, 0) * absoluteScale,
    );
    const collision = findSweptPointAgainstCapsule(
      movingStart,
      relativeEnd,
      capsuleStart,
      capsuleEnd,
      movingRadius + shapeRadius,
    );
    earliest = chooseEarlierIntersection(earliest, collision && {
      ...collision,
      combinedRadius: movingRadius + shapeRadius,
      primitiveIndex,
      primitiveType: "capsule",
    });
    primitiveIndex += 1;
  }
  if (!earliest) {
    return null;
  }

  const movingImpact = addVectors(
    movingStart,
    scaleVector(subtractVectors(movingEnd, movingStart), earliest.fraction),
  );
  const correctionDistance = earliest.startedOverlapping
    ? Math.max(0, toFiniteNumber(earliest.penetrationDepth, 0)) + COLLISION_EPSILON_METERS
    : COLLISION_EPSILON_METERS;
  return {
    ...earliest,
    candidate,
    collisionID: presentation.collisionID,
    resolvedPosition: addVectors(
      movingImpact,
      scaleVector(earliest.normal, correctionDistance),
    ),
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
    const collision = findSweptEntityCollision(
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

  if (earliest.resolvedPosition) {
    entity.position = cloneVector(earliest.resolvedPosition);
  } else {
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
  }

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
    primitiveType: earliest.primitiveType || "sphereFallback",
    collisionID: earliest.collisionID || null,
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
  findSweptEntityCollision,
  findSweptPointAgainstCapsule,
  findSweptSphereAgainstBox,
  findSweptWeaponOccluder,
  findSweptSphereCollision,
  findWeaponLineOccluder,
  getEntityCollisionBroadphaseRadius,
  getEntityCollisionRadius,
  getSceneCollisionCandidates,
  isEntityCollisionEnabled,
  isEntityCollisionMover,
  resolveEntityMovementCollision,
};
