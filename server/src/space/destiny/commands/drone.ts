"use strict";

function createDroneOperationalMotionCommand({
  droneEntity,
  mass,
  inertia,
}: Record<string, any> = {}) {
  const applied = Boolean(droneEntity);
  return {
    applied,
    applyMassAndInertia() {
      if (!applied) {
        return false;
      }
      droneEntity.mass = mass;
      droneEntity.inertia = inertia;
      return true;
    },
    applyVelocityAndAgility({
      maxVelocity,
      resolveAlignTime,
      maxAccelerationTime,
      resolveAgilitySeconds,
    }: Record<string, any> = {}) {
      if (!applied) {
        return false;
      }
      droneEntity.maxVelocity = maxVelocity;
      droneEntity.alignTime = resolveAlignTime();
      droneEntity.maxAccelerationTime = maxAccelerationTime;
      droneEntity.agilitySeconds = resolveAgilitySeconds();
      return true;
    },
  };
}

module.exports = {
  createDroneOperationalMotionCommand,
};
