"use strict";

const destiny = require("../index.js");

function createMovementManualFlightCommands(deps: Record<string, any> = {}) {
  const {
    addVectors,
    armMovementTrace,
    clamp,
    clearTrackingState,
    cloneVector,
    normalizeVector,
    persistShipEntity,
    roundNumber,
    scaleVector,
    summarizeVector,
    toFiniteNumber,
    DEFAULT_RIGHT,
  } = deps;

  function getPitchFractionFromDirection(direction) {
    const normalized = normalizeVector(direction, DEFAULT_RIGHT);
    return clamp(Math.asin(clamp(normalized.y, -1, 1)) / (Math.PI / 2), -1, 1);
  }

  function captureAxes(entity) {
    return {
      manualPitch: entity.manualPitch !== null && Number.isFinite(Number(entity.manualPitch))
        ? clamp(Number(entity.manualPitch), -1, 1) : getPitchFractionFromDirection(entity.direction),
      manualPitchRate: entity.manualPitchRate == null ? null : clamp(toFiniteNumber(entity.manualPitchRate, 0), -1, 1),
      manualYawRate: clamp(toFiniteNumber(entity.manualYawRate, 0), -1, 1),
      manualRollRate: clamp(toFiniteNumber(entity.manualRollRate, 0), -1, 1),
      manualBrakeFraction: clamp(toFiniteNumber(entity.manualBrakeFraction, 0), 0, 1),
      manualHeading: entity.manualHeading ? cloneVector(entity.manualHeading) : null,
      manualStrafingThrust: cloneVector(entity.manualStrafingThrust || { x: 0, y: 0, z: 0 }),
    };
  }

  function applyManualAxis(runtime, session, axis, requestedValue) {
    const entity = runtime.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) return false;
    let value;
    if (axis === "heading") {
      const source = Array.isArray(requestedValue) ? requestedValue :
        [requestedValue?.x, requestedValue?.y, requestedValue?.z];
      if (source.length !== 3 || !source.every(v => typeof v === "number" && Number.isFinite(v))) return false;
      const length = Math.hypot(...source);
      if (!Number.isFinite(length)) return false;
      // A zero vector explicitly releases heading authority in build 3640684.
      value = length > 0 ? { x: source[0] / length, y: source[1] / length, z: source[2] / length } : null;
    } else {
      if (typeof requestedValue !== "number" || !Number.isFinite(requestedValue)) return false;
      value = clamp(requestedValue, axis === "brakeFraction" ? 0 : -1, 1);
    }
    const axes = captureAxes(entity);
    const property = `manual${axis[0].toUpperCase()}${axis.slice(1)}`;
    axes[property] = value;
    if (axis === "pitch") axes.manualPitchRate = null;
    if (axis === "rollRate" && axes.manualPitchRate === null) axes.manualPitchRate = 0;
    if (axis === "pitch" || axis === "pitchRate" || axis === "yawRate") axes.manualHeading = null;
    clearTrackingState(entity);
    Object.assign(entity, axes, { manualFlightActive: true, mode: "GOTO" });
    entity.targetPoint = addVectors(cloneVector(entity.position), scaleVector(
      normalizeVector(entity.manualHeading || entity.direction, DEFAULT_RIGHT), 1.0e16));
    persistShipEntity(entity);
    const now = runtime.getCurrentSimTimeMs();
    const actionName = `Set${axis[0].toUpperCase()}${axis.slice(1)}`;
    const wireValue = axis === "heading" ? (value || { x: 0, y: 0, z: 0 }) : value;
    armMovementTrace(entity, `manual${axis}`, { value: wireValue }, now);
    const stamp = runtime.getHistorySafeSessionDestinyStamp(session, now, 1);
    runtime.broadcastPilotCommandMovementUpdates(session, [{ stamp,
      payload: destiny[`build${actionName}Payload`](entity.itemID, wireValue),
    }], now);
    runtime.scheduleWatcherMovementAnchor(entity, now, `set${axis}`);
    return true;
  }

  function applyStrafingThrust(runtime, session, requestedThrust) {
    const entity = runtime.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const source = Array.isArray(requestedThrust)
      ? requestedThrust
      : requestedThrust && typeof requestedThrust === "object"
        ? [requestedThrust.x, requestedThrust.y, requestedThrust.z]
        : [];
    const agilitySeconds = Math.max(
      0.05,
      toFiniteNumber(entity.agilitySeconds, 0.05),
    );
    const maximumStrafeAcceleration = Math.max(
      0,
      toFiniteNumber(entity.maxVelocity, 0) / agilitySeconds,
    ) * 0.2;
    const thrust = {
      x: clamp(
        toFiniteNumber(source[0], 0),
        -maximumStrafeAcceleration,
        maximumStrafeAcceleration,
      ),
      y: clamp(
        toFiniteNumber(source[1], 0),
        -maximumStrafeAcceleration,
        maximumStrafeAcceleration,
      ),
      z: 0,
    };
    const axes = captureAxes(entity);
    clearTrackingState(entity);
    Object.assign(entity, axes);
    entity.manualFlightActive = true;
    entity.manualStrafingThrust = thrust;
    entity.mode = "GOTO";
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(normalizeVector(entity.direction, DEFAULT_RIGHT), 1.0e16),
    );
    persistShipEntity(entity);

    const now = runtime.getCurrentSimTimeMs();
    armMovementTrace(entity, "manualStrafingThrust", {
      thrust: summarizeVector(thrust),
      maximumStrafeAcceleration: roundNumber(maximumStrafeAcceleration, 4),
      direction: summarizeVector(entity.direction),
    }, now);

    const stamp = runtime.getHistorySafeSessionDestinyStamp(session, now, 1);
    runtime.broadcastPilotCommandMovementUpdates(
      session,
      [{
        stamp,
        payload: destiny.buildSetStrafingThrustPayload(entity.itemID, thrust),
      }],
      now,
    );
    runtime.scheduleWatcherMovementAnchor(
      entity,
      now,
      "setStrafingThrust",
    );
    return true;
  }

  return {
    setPitch(runtime, session, pitch) {
      return applyManualAxis(runtime, session, "pitch", pitch);
    },

    setPitchRate(runtime, session, value) { return applyManualAxis(runtime, session, "pitchRate", value); },
    setRollRate(runtime, session, value) { return applyManualAxis(runtime, session, "rollRate", value); },
    setBrakeFraction(runtime, session, value) { return applyManualAxis(runtime, session, "brakeFraction", value); },
    setHeading(runtime, session, value) { return applyManualAxis(runtime, session, "heading", value); },

    setStrafingThrust(runtime, session, thrust) {
      return applyStrafingThrust(runtime, session, thrust);
    },

    setYawRate(runtime, session, yawRate) {
      return applyManualAxis(runtime, session, "yawRate", yawRate);
    },
  };
}

module.exports = {
  createMovementManualFlightCommands,
};
