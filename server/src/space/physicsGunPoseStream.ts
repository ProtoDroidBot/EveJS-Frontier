"use strict";

const { buildDict } = require("../services/_shared/serviceHelpers");

// Presentation for the Physics Gun only. Destiny balls and the checkpointed
// detached-prop record remain the authority for gameplay and persistence.
const POSE_INTERVAL_MS = 100;
const PHYSICS_GUN_TYPE_ID = 99999;

function poseWire(payload) {
  // Notification encoding is asynchronous; a raw object can fail later and
  // close the client socket even when sendNotification itself did not throw.
  return buildDict(Object.entries(payload));
}

function finitePoint(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return [value.x, value.y, value.z];
}

function orientationFor(entity) {
  const raw = entity?.collisionQuaternion;
  const components = raw && [raw.x, raw.y, raw.z, raw.w];
  if (!components || !components.every(Number.isFinite)) return [0, 0, 0, 1];
  const length = Math.hypot(...components);
  return length > 1e-9 ? components.map((part) => part / length) : [0, 0, 0, 1];
}

function anchorLocalFor(state, orientation) {
  const offset = finitePoint(state?.tether?.contactOffset) || [0, 0, 0];
  const [x, y, z, w] = orientation;
  // Inverse-rotate the current world-space hit offset. Rotation is currently
  // static during a hold; this local anchor also supports later prop rotation.
  const qx = -x, qy = -y, qz = -z;
  const tx = 2 * (qy * offset[2] - qz * offset[1]);
  const ty = 2 * (qz * offset[0] - qx * offset[2]);
  const tz = 2 * (qx * offset[1] - qy * offset[0]);
  return [
    offset[0] + w * tx + (qy * tz - qz * ty),
    offset[1] + w * ty + (qz * tx - qx * tz),
    offset[2] + w * tz + (qx * ty - qy * tx),
  ];
}

function canReceive(scene, session, entity, nowMs) {
  if (!session || typeof session.sendNotification !== "function" ||
      !session._space || Number(session._space.systemID) !== Number(scene?.systemID)) return false;
  if (typeof scene?.canSessionSeeDynamicEntity === "function") {
    try { return scene.canSessionSeeDynamicEntity(session, entity, nowMs) === true; }
    catch (_error) { return false; }
  }
  const ship = scene?.getShipEntityForSession?.(session);
  return Number(ship?.bubbleID) > 0 && Number(ship.bubbleID) === Number(entity?.bubbleID);
}

function emitPhysicsGunPose(scene, entity, state, mode, nowMs) {
  if (!state?.tether || !scene || !entity || !finitePoint(entity.position)) return null;
  if (!state.poseGeneration) {
    state.poseGeneration = `${Number(entity.itemID)}:${Number(state.tether.moduleID)}:${Number(nowMs)}`;
  }
  const recipients = state.poseRecipients ||= new Set<any>();
  const current = new Set<any>();
  if (mode !== "stop") {
    for (const session of scene.sessions?.values?.() || []) {
      if (canReceive(scene, session, entity, nowMs)) current.add(session);
    }
  }
  const orientation = orientationFor(entity);
  const position = finitePoint(entity.position);
  const velocity = finitePoint(entity.velocity) || [0, 0, 0];
  const signature = JSON.stringify([position, orientation, velocity]);
  const changed = signature !== state.lastPoseSignature;
  const visibilityChanged = [...current].some((session) => !recipients.has(session)) ||
    [...recipients].some((session) => !current.has(session));
  if (mode === "update" && !visibilityChanged &&
      (!changed || nowMs - (state.lastPoseAtMs || 0) < POSE_INTERVAL_MS)) return null;
  const payload = {
    systemID: Number(scene.systemID),
    moduleTypeID: PHYSICS_GUN_TYPE_ID,
    worldEntityID: Number(entity.itemID),
    sourceEntityID: Number(state.poseSourceEntityID || entity.itemID),
    generation: state.poseGeneration,
    revision: (state.poseRevision || 0) + 1,
    simTimeMs: Number(nowMs),
    mode,
    position,
    orientation,
    velocity,
    angularVelocity: null,
    anchorLocal: anchorLocalFor(state, orientation),
  };
  state.poseRevision = payload.revision;
  state.lastPoseAtMs = nowMs;
  state.lastPoseSignature = signature;
  if (mode === "stop") {
    for (const session of recipients) {
      try { session.sendNotification("OnPhysicsGunPose", "clientID", [poseWire(payload)]); }
      catch (_error) { /* best effort */ }
    }
    recipients.clear();
    return payload;
  }
  for (const session of current) {
    if (recipients.has(session) && !changed) continue;
    const delivered = { ...payload, mode: recipients.has(session) ? mode : "start" };
    try {
      session.sendNotification("OnPhysicsGunPose", "clientID", [poseWire(delivered)]);
      recipients.add(session);
    } catch (_error) { /* Native ball delivery remains available. */ }
  }
  for (const session of [...recipients]) {
    if (current.has(session)) continue;
    try { session.sendNotification("OnPhysicsGunPose", "clientID", [poseWire({
      systemID: payload.systemID, worldEntityID: payload.worldEntityID,
      moduleTypeID: PHYSICS_GUN_TYPE_ID,
      generation: payload.generation, revision: payload.revision,
      simTimeMs: payload.simTimeMs, mode: "hide",
    })]); } catch (_error) { /* best effort */ }
    recipients.delete(session);
  }
  return payload;
}

module.exports = { POSE_INTERVAL_MS, emitPhysicsGunPose, orientationFor, anchorLocalFor };
