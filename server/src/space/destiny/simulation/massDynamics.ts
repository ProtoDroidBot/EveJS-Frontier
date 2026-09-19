"use strict";

const MIN_MASS_MOBILITY_MULTIPLIER = 0.25;
const MAX_MASS_MOBILITY_MULTIPLIER = 4;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolveMassRatio(currentMass, baseMass) {
  const resolvedCurrentMass = Math.max(0, toFiniteNumber(currentMass, 0));
  const resolvedBaseMass = Math.max(0, toFiniteNumber(baseMass, 0));
  if (resolvedCurrentMass <= 0 || resolvedBaseMass <= 0) {
    return 1;
  }
  return resolvedCurrentMass / resolvedBaseMass;
}

function resolveMassMobilityMultiplier(currentMass, baseMass) {
  const massRatio = resolveMassRatio(currentMass, baseMass);
  return clamp(
    1 / Math.sqrt(massRatio),
    MIN_MASS_MOBILITY_MULTIPLIER,
    MAX_MASS_MOBILITY_MULTIPLIER,
  );
}

function resolveMassAccelerationMultiplier(currentMass, baseMass) {
  const massRatio = resolveMassRatio(currentMass, baseMass);
  return clamp(
    1 / massRatio,
    MIN_MASS_MOBILITY_MULTIPLIER ** 2,
    MAX_MASS_MOBILITY_MULTIPLIER ** 2,
  );
}

function resolveMassAdjustedMaxVelocity(
  dogmaMaxVelocity,
  currentMass,
  baseMass,
) {
  return Math.max(0, toFiniteNumber(dogmaMaxVelocity, 0)) *
    resolveMassMobilityMultiplier(currentMass, baseMass);
}

function resolveMassAdjustedAngularSpeed(
  dogmaMaxAngularSpeed,
  currentMass,
  baseMass,
  angularAgility = 1,
) {
  const agilityMultiplier = clamp(
    1 / Math.sqrt(Math.max(0.000001, toFiniteNumber(angularAgility, 1))),
    MIN_MASS_MOBILITY_MULTIPLIER,
    MAX_MASS_MOBILITY_MULTIPLIER,
  );
  return Math.max(0, toFiniteNumber(dogmaMaxAngularSpeed, 0)) *
    resolveMassMobilityMultiplier(currentMass, baseMass) *
    agilityMultiplier;
}

module.exports = {
  MAX_MASS_MOBILITY_MULTIPLIER,
  MIN_MASS_MOBILITY_MULTIPLIER,
  resolveMassAccelerationMultiplier,
  resolveMassAdjustedAngularSpeed,
  resolveMassAdjustedMaxVelocity,
  resolveMassMobilityMultiplier,
  resolveMassRatio,
};
