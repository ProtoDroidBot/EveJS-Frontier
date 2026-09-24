"use strict";

const {
  ROLE_GML,
  ROLE_LEGIONEER,
  ROLE_WORLDMOD,
  normalizeRoleValue,
} = require("../services/account/accountRoleProfiles");
const {
  MAX_MOVE_DISTANCE_METERS,
  MAX_SELECTION_RANGE_METERS,
} = require("../services/dungeon/dungeonPropMoveSelection");
const { getDetachedDungeonPropStore } = require("./detachedDungeonProps");
const {
  canEntitiesCollide,
  findSweptEntityCollision,
  getEntityCollisionBroadphaseRadius,
  getSceneCollisionCandidates,
  resolveEntityMovementCollision,
} = require("./destiny/simulation/collisions");
const { resolveEntityCollisionPresentation } = require("./destiny/collision/collisionBundle");
const {
  buildGotoPointPayload,
  buildOnSpecialFXPayload,
  buildSetMaxSpeedPayload,
  buildSetSpeedFractionPayload,
} = require("./destiny/stream/actions");

const MOVE_ROLES = BigInt(ROLE_GML) | BigInt(ROLE_LEGIONEER) | BigInt(ROLE_WORLDMOD);
const MAX_SPEED_METERS_PER_SECOND = 1_500;
const ACCELERATION_METERS_PER_SECOND_SQUARED = 750;
const MAX_STEP_SECONDS = 1;
const ARRIVAL_EPSILON_METERS = 0.25;
const SCAN_FX_GUID = "effects.FrontierScanningTest";

function finiteVector(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, z } = value;
  return [x, y, z].every((part) => typeof part === "number" && Number.isFinite(part))
    ? { x, y, z }
    : null;
}

function finiteRotation(value) {
  return Array.isArray(value) && value.length === 3 &&
    value.every((angle) => typeof angle === "number" &&
      Number.isFinite(angle) && Math.abs(angle) <= 360)
    ? [...value]
    : null;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function findMovingPropProfileCollision(scene, prop, start, end) {
  const profile = resolveEntityCollisionPresentation(prop).profile;
  if (!profile || !["balls", "boxes", "capsules"]
    .some((kind) => Array.isArray(profile[kind]) && profile[kind].length > 0)) {
    return null;
  }
  let first = null;
  for (const obstacle of getSceneCollisionCandidates(scene)) {
    if (!canEntitiesCollide(prop, obstacle)) continue;
    const obstacleEnd = finiteVector(obstacle.position);
    if (!obstacleEnd) continue;
    const obstacleStart = Number(obstacle._lastMovementAdvancedTickSequence) ===
      Number(scene._activeTickSequence)
      ? finiteVector(obstacle.lastMotionDebug?.previousPosition) || obstacleEnd
      : obstacleEnd;
    // Invert the relative sweep: the existing primitive resolver can now test
    // the obstacle's bounding sphere against the prop's authored compound.
    const inverse = findSweptEntityCollision(
      { ...obstacle, collisionRadius: getEntityCollisionBroadphaseRadius(obstacle) },
      prop,
      obstacleStart,
      obstacleEnd,
      start,
      end,
    );
    if (inverse && (!first || inverse.fraction < first.fraction)) {
      first = {
        ...inverse,
        entityID: obstacle.itemID,
        kind: String(obstacle.kind || "object"),
      };
    }
  }
  return first;
}

function selectDetachedProp(scene, session, worldEntityID, destinationPosition, rotation, store) {
  if ((BigInt(normalizeRoleValue(session && session.accountRole, 0n)) & MOVE_ROLES) === 0n) {
    return { success: false, errorMsg: "GM_ROLE_REQUIRED" };
  }
  if (!scene || !Number.isSafeInteger(Number(worldEntityID)) ||
      Number(session?._space?.systemID) !== Number(scene.systemID)) {
    return { success: false, errorMsg: "NOT_IN_SPACE" };
  }
  const ship = scene.getShipEntityForSession?.(session);
  const shipPosition = finiteVector(ship?.position);
  if (!shipPosition || ship?.mode === "WARP" || ship?.pendingDock) {
    return { success: false, errorMsg: "SHIP_NOT_READY" };
  }
  const entity = scene.staticEntitiesByID?.get(Number(worldEntityID));
  if (!entity || entity.kind !== "detachedDungeonProp" ||
      scene.dynamicEntities?.has(Number(worldEntityID))) {
    return { success: false, errorMsg: "DETACHED_PROP_NOT_READY" };
  }
  const sourcePosition = finiteVector(entity.position);
  const destination = finiteVector(destinationPosition);
  if (!sourcePosition || !destination) {
    return { success: false, errorMsg: "INVALID_DESTINATION" };
  }
  const actualRotation = rotation === undefined
    ? finiteRotation(entity.dunRotation) || [0, 0, 0]
    : finiteRotation(rotation);
  if (!actualRotation) return { success: false, errorMsg: "INVALID_ROTATION" };
  const surfaceDistance = Math.max(0,
    distance(shipPosition, sourcePosition) - Math.max(0, Number(entity.radius) || 0));
  if (surfaceDistance > MAX_SELECTION_RANGE_METERS) {
    return { success: false, errorMsg: "PROP_OUT_OF_RANGE" };
  }
  const displacement = distance(sourcePosition, destination);
  if (displacement > MAX_MOVE_DISTANCE_METERS) {
    return { success: false, errorMsg: "DESTINATION_OUT_OF_RANGE" };
  }
  if (Number.isFinite(Number(ship.bubbleID)) && Number(ship.bubbleID) > 0 &&
      Number.isFinite(Number(entity.bubbleID)) && Number(entity.bubbleID) > 0 &&
      Number(ship.bubbleID) !== Number(entity.bubbleID)) {
    return { success: false, errorMsg: "PROP_NOT_VISIBLE" };
  }
  let record;
  try {
    record = store.getByWorldID(scene.systemID, worldEntityID);
  } catch (_error) {
    return { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  }
  if (!record || distance(record.worldEntity.position, sourcePosition) > 0.01) {
    return { success: false, errorMsg: "DETACHED_PROP_RECORD_STALE" };
  }
  return {
    success: true,
    data: { ship, entity, record, sourcePosition, destination, rotation: actualRotation },
  };
}

function broadcastMoveFx(scene, entity, sourceID, sourceTypeID, active, nowMs) {
  if (typeof scene.broadcastDestinyUpdatesToBubble !== "function" ||
      typeof scene.getNextDestinyStamp !== "function" || !entity.bubbleID) return;
  scene.broadcastDestinyUpdatesToBubble(entity.bubbleID, [{
    stamp: scene.getNextDestinyStamp(nowMs),
    payload: buildOnSpecialFXPayload(sourceID, SCAN_FX_GUID, {
      moduleID: sourceID,
      moduleTypeID: sourceTypeID,
      targetID: entity.itemID,
      isOffensive: false,
      start: active,
      active,
      duration: active ? -1 : 0,
      repeat: 0,
      startTime: nowMs,
      timeFromStart: 0,
    }),
  }]);
}

function movingEntityFromStatic(entity, destination, rotation, fxShip) {
  const moving = {
    ...entity,
    position: { ...entity.position },
    velocity: { x: 0, y: 0, z: 0 },
    dunRotation: [...rotation],
    collisionStatic: false,
    destinyForceFree: true,
    destinyBallMode: "GOTO",
    mode: "GOTO",
    targetPoint: { ...destination },
    maxVelocity: MAX_SPEED_METERS_PER_SECOND,
    speedFraction: 1,
    inertia: 1,
    detachedPropMove: {
      destination: { ...destination },
      speed: 0,
      fxSourceID: fxShip.itemID,
      fxSourceTypeID: fxShip.typeID,
    },
  };
  delete moving.staticVisibilityScope;
  return moving;
}

function startDetachedPropMove(scene, session, worldEntityID, destinationPosition, options: Record<string, any> = {}) {
  const store = options.store || getDetachedDungeonPropStore();
  const selected = selectDetachedProp(
    scene, session, worldEntityID, destinationPosition, options.rotation, store,
  );
  if (!selected.success) return selected;
  const { ship, entity, sourcePosition, destination, rotation } = selected.data;
  if (distance(sourcePosition, destination) <= ARRIVAL_EPSILON_METERS) {
    return { success: false, errorMsg: "DESTINATION_UNCHANGED" };
  }
  // Rotation is committed before any scene mutation, including the static-to-free
  // ball replacement. Subsequent pose checkpoints are also synchronous.
  let committed;
  try {
    committed = store.checkpointPose(scene.systemID, entity.itemID, sourcePosition, rotation);
  } catch (_error) {
    return { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  }
  if (!committed?.success) return committed || { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs :
    scene.getCurrentSimTimeMs?.() || Date.now();
  const moving = movingEntityFromStatic(entity, destination, rotation, ship);
  let removed;
  try {
    removed = scene.removeStaticEntity(entity.itemID, { broadcast: true, nowMs });
  } catch (_error) {
    removed = scene.staticEntitiesByID.has(entity.itemID)
      ? { success: false }
      : { success: true };
  }
  if (!removed?.success) return { success: false, errorMsg: "DETACHED_PROP_STATIC_REMOVE_FAILED" };
  let spawned;
  try {
    spawned = scene.spawnDynamicEntity(moving, { broadcast: true });
  } catch (_error) {
    spawned = scene.dynamicEntities?.has(entity.itemID)
      ? { success: true }
      : { success: false };
  }
  if (!spawned?.success) {
    const world = { ...committed.data.worldEntity };
    if (scene.addStaticEntity(world)) scene.broadcastAddBalls?.([world]);
    return { success: false, errorMsg: "DETACHED_PROP_DYNAMIC_SPAWN_FAILED" };
  }
  try {
    const stamp = scene.getNextDestinyStamp(nowMs);
    scene.broadcastDestinyUpdatesToBubble?.(moving.bubbleID, [
      { stamp, payload: buildSetMaxSpeedPayload(moving.itemID, moving.maxVelocity) },
      { stamp, payload: buildSetSpeedFractionPayload(moving.itemID, 1) },
      { stamp, payload: buildGotoPointPayload(moving.itemID, destination) },
    ]);
    broadcastMoveFx(scene, moving, ship.itemID, ship.typeID, true, nowMs);
  } catch (_error) {
    settleDetachedPropMove(scene, moving, { store, nowMs, reason: "presentation-failed" });
    return { success: false, errorMsg: "DETACHED_PROP_PRESENTATION_FAILED" };
  }
  return { success: true, data: { worldEntityID: moving.itemID, destination } };
}

function settleDetachedPropMove(scene, entity, options: Record<string, any> = {}) {
  const state = entity?.detachedPropMove;
  if (!state) return { success: false, errorMsg: "DETACHED_PROP_NOT_MOVING" };
  const store = options.store || getDetachedDungeonPropStore();
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs :
    scene.getCurrentSimTimeMs?.() || Date.now();
  let record;
  try {
    record = store.getByWorldID(scene.systemID, entity.itemID);
  } catch (_error) {
    return { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  }
  if (!record) return { success: false, errorMsg: "DETACHED_PROP_NOT_FOUND" };
  // The database pose is authoritative if a checkpoint failed. It is also
  // what scene replay restores after an interrupted process.
  try {
    broadcastMoveFx(scene, entity, state.fxSourceID, state.fxSourceTypeID, false, nowMs);
  } catch (_error) {
    // An FX delivery failure must not strand a moving world prop.
  }
  let removed;
  try {
    removed = scene.removeDynamicEntity(entity.itemID, { broadcast: true, nowMs });
  } catch (_error) {
    removed = scene.dynamicEntities?.has(entity.itemID)
      ? { success: false }
      : { success: true };
  }
  if (!removed?.success) return { success: false, errorMsg: "DETACHED_PROP_DYNAMIC_REMOVE_FAILED" };
  const world = { ...record.worldEntity };
  let added = false;
  try {
    added = scene.addStaticEntity(world) === true;
  } catch (_error) {
    added = scene.staticEntitiesByID?.has(entity.itemID) === true;
  }
  if (!added) {
    return { success: false, errorMsg: "DETACHED_PROP_STATIC_RESTORE_FAILED" };
  }
  try {
    scene.broadcastAddBalls?.([world]);
  } catch (_error) {
    scene.requestFinalSceneVisibilityReconciliation?.();
  }
  return {
    success: true,
    data: { worldEntityID: entity.itemID, position: world.position, reason: options.reason || "arrived" },
  };
}

function stopDetachedPropMove(scene, session, worldEntityID, options: Record<string, any> = {}) {
  if ((BigInt(normalizeRoleValue(session && session.accountRole, 0n)) & MOVE_ROLES) === 0n) {
    return { success: false, errorMsg: "GM_ROLE_REQUIRED" };
  }
  if (!scene || Number(session?._space?.systemID) !== Number(scene.systemID)) {
    return { success: false, errorMsg: "NOT_IN_SPACE" };
  }
  const ship = scene.getShipEntityForSession?.(session);
  const shipPosition = finiteVector(ship?.position);
  const entity = scene.dynamicEntities?.get(Number(worldEntityID));
  if (!shipPosition || !entity || entity.kind !== "detachedDungeonProp" ||
      !entity.detachedPropMove) {
    return { success: false, errorMsg: "DETACHED_PROP_NOT_MOVING" };
  }
  if (Math.max(0, distance(shipPosition, entity.position) -
      Math.max(0, Number(entity.radius) || 0)) > MAX_SELECTION_RANGE_METERS) {
    return { success: false, errorMsg: "PROP_OUT_OF_RANGE" };
  }
  return settleDetachedPropMove(scene, entity, { ...options, reason: "manual-stop" });
}

function tickDetachedPropMove(scene, entity, deltaSeconds, nowMs, options: Record<string, any> = {}) {
  const state = entity?.detachedPropMove;
  if (!state) return { success: false, errorMsg: "DETACHED_PROP_NOT_MOVING" };
  const destination = finiteVector(state.destination);
  const current = finiteVector(entity.position);
  if (!destination || !current) {
    return settleDetachedPropMove(scene, entity, { ...options, nowMs, reason: "invalid-motion" });
  }
  const remaining = distance(current, destination);
  if (remaining <= ARRIVAL_EPSILON_METERS) {
    return settleDetachedPropMove(scene, entity, { ...options, nowMs });
  }
  const stepSeconds = Math.min(MAX_STEP_SECONDS, Math.max(0, Number(deltaSeconds) || 0));
  if (stepSeconds <= 0) return { success: true, data: { moving: true } };
  const maxApproachSpeed = Math.sqrt(2 * ACCELERATION_METERS_PER_SECOND_SQUARED * remaining);
  const speed = Math.min(
    MAX_SPEED_METERS_PER_SECOND,
    maxApproachSpeed,
    Math.max(0, Number(state.speed) || 0) + ACCELERATION_METERS_PER_SECOND_SQUARED * stepSeconds,
  );
  const travel = Math.min(remaining, speed * stepSeconds);
  const unit = {
    x: (destination.x - current.x) / remaining,
    y: (destination.y - current.y) / remaining,
    z: (destination.z - current.z) / remaining,
  };
  const proposed = {
    ...entity,
    position: {
      x: current.x + unit.x * travel,
      y: current.y + unit.y * travel,
      z: current.z + unit.z * travel,
    },
    velocity: { x: unit.x * speed, y: unit.y * speed, z: unit.z * speed },
  };
  const intendedPosition = { ...proposed.position };
  let collision = resolveEntityMovementCollision(proposed, scene, current, {
    activeTickSequence: scene._activeTickSequence,
  });
  const profileCollision = findMovingPropProfileCollision(
    scene, entity, current, intendedPosition,
  );
  if (profileCollision &&
      (!collision || profileCollision.fraction < collision.fraction)) {
    const stopFraction = Math.max(0,
      profileCollision.fraction - (0.01 / Math.max(travel, 0.01)));
    proposed.position = {
      x: current.x + (intendedPosition.x - current.x) * stopFraction,
      y: current.y + (intendedPosition.y - current.y) * stopFraction,
      z: current.z + (intendedPosition.z - current.z) * stopFraction,
    };
    collision = profileCollision;
  }
  const store = options.store || getDetachedDungeonPropStore();
  let checkpoint;
  try {
    checkpoint = store.checkpointPose(scene.systemID, entity.itemID, proposed.position);
  } catch (_error) {
    checkpoint = { success: false, errorMsg: "DETACHED_PROP_STORE_FAILED" };
  }
  if (!checkpoint?.success) {
    return settleDetachedPropMove(scene, entity, {
      ...options, nowMs, reason: "checkpoint-failed",
    });
  }
  entity.position = { ...proposed.position };
  entity.velocity = collision
    ? { x: 0, y: 0, z: 0 }
    : { ...proposed.velocity };
  entity.direction = unit;
  entity.lastCollision = collision || null;
  entity._lastMovementAdvancedTickSequence = scene._activeTickSequence;
  entity.lastMotionDebug = { previousPosition: current };
  state.speed = speed;
  scene.reconcileEntityPublicGrid?.(entity);
  scene.reconcileEntityBubble?.(entity);
  if (collision || distance(entity.position, destination) <= ARRIVAL_EPSILON_METERS) {
    return settleDetachedPropMove(scene, entity, {
      ...options, nowMs, reason: collision ? "collision" : "arrived",
    });
  }
  // AddBalls refreshes the authoritative position for observers without
  // publishing one teleport per physics step. The GotoPoint command animates
  // motion between these corrections.
  if (nowMs - (state.lastRefreshAtMs || 0) >= 2_000) {
    scene.broadcastBallRefresh?.([entity]);
    state.lastRefreshAtMs = nowMs;
  }
  return { success: true, data: { moving: true, position: entity.position } };
}

module.exports = {
  MAX_SPEED_METERS_PER_SECOND,
  SCAN_FX_GUID,
  findMovingPropProfileCollision,
  selectDetachedProp,
  startDetachedPropMove,
  stopDetachedPropMove,
  settleDetachedPropMove,
  tickDetachedPropMove,
};
