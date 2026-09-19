"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveMassAccelerationMultiplier,
  resolveMassAdjustedAngularSpeed,
  resolveMassAdjustedMaxVelocity,
  resolveMassMobilityMultiplier,
} = require("../src/space/destiny/simulation/massDynamics");
const {
  createDestinyMovementSimulator,
} = require("../src/space/destiny/simulation/movement");

function createVectorDependencies() {
  const cloneVector = (value = null, fallback: Record<string, any> = {}) => ({
    x: Number((value && value.x) ?? fallback.x) || 0,
    y: Number((value && value.y) ?? fallback.y) || 0,
    z: Number((value && value.z) ?? fallback.z) || 0,
  });
  const addVectors = (left, right) => ({
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  });
  const subtractVectors = (left, right) => ({
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  });
  const scaleVector = (value, scalar) => ({
    x: value.x * scalar,
    y: value.y * scalar,
    z: value.z * scalar,
  });
  const magnitude = (value) => Math.hypot(value.x, value.y, value.z);
  const normalizeVector = (value, fallback: Record<string, any> = { x: 1, y: 0, z: 0 }) => {
    const length = magnitude(value);
    return length > 0
      ? scaleVector(value, 1 / length)
      : cloneVector(fallback);
  };
  const dotProduct = (left, right) =>
    left.x * right.x + left.y * right.y + left.z * right.z;
  const crossProduct = (left, right) => ({
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  });
  const distance = (left, right) => magnitude(subtractVectors(left, right));
  const getTurnMetrics = (current, target) => {
    const normalizedCurrent = normalizeVector(current);
    const normalizedTarget = normalizeVector(target);
    const radians = Math.acos(Math.max(
      -1,
      Math.min(1, dotProduct(normalizedCurrent, normalizedTarget)),
    ));
    return { radians, turnFraction: radians / Math.PI };
  };
  return {
    addVectors,
    buildPerpendicular(value) {
      return normalizeVector(crossProduct(value, { x: 0, y: 1, z: 0 }));
    },
    clamp: (value, minimum, maximum) =>
      Math.max(minimum, Math.min(maximum, Number(value) || 0)),
    cloneVector,
    crossProduct,
    deriveAgilitySeconds: (_align, _acceleration, mass, inertia) =>
      (Number(mass) * Number(inertia)) / 1_000_000,
    distance,
    dotProduct,
    getCurrentAlignmentDirection: (entity, fallback) =>
      magnitude(entity.velocity) > 0
        ? normalizeVector(entity.velocity, fallback)
        : normalizeVector(entity.direction, fallback),
    getTurnMetrics,
    magnitude,
    normalizeVector,
    roundNumber: (value) => Number(value),
    scaleVector,
    subtractVectors,
    summarizeVector: cloneVector,
    toFiniteNumber: (value, fallback = 0) =>
      Number.isFinite(Number(value)) ? Number(value) : fallback,
    DEFAULT_RIGHT: { x: 1, y: 0, z: 0 },
    MAX_SUBWARP_SPEED_FRACTION: 1,
    TURN_ALIGNMENT_RADIANS: 0.001,
  };
}

test("mass scales dogma speed, acceleration, and angular authority", () => {
  const baseMass = 10_000_000;
  const doubledMass = 20_000_000;

  assert.equal(resolveMassMobilityMultiplier(baseMass, baseMass), 1);
  assert.ok(Math.abs(
    resolveMassMobilityMultiplier(doubledMass, baseMass) - Math.SQRT1_2,
  ) < 1e-12);
  assert.equal(resolveMassAccelerationMultiplier(doubledMass, baseMass), 0.5);
  assert.ok(Math.abs(
    resolveMassAdjustedMaxVelocity(250, doubledMass, baseMass) -
      (250 * Math.SQRT1_2),
  ) < 1e-10);
  assert.ok(Math.abs(
    resolveMassAdjustedAngularSpeed(0.5, doubledMass, baseMass, 4) -
      (0.25 * Math.SQRT1_2),
  ) < 1e-10);
});

test("heavier ships receive less manual strafing acceleration", () => {
  const simulator = createDestinyMovementSimulator(createVectorDependencies());
  const buildEntity = (mass): Record<string, any> => ({
    mode: "GOTO",
    manualFlightActive: true,
    manualStrafingThrust: { x: 10, y: 0, z: 0 },
    baseMass: 10_000_000,
    mass,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  });
  const baseline = buildEntity(10_000_000);
  const heavy = buildEntity(20_000_000);

  simulator.applyManualStrafingThrust(baseline, 1);
  simulator.applyManualStrafingThrust(heavy, 1);

  assert.equal(Math.hypot(
    baseline.velocity.x,
    baseline.velocity.y,
    baseline.velocity.z,
  ), 10);
  assert.equal(Math.hypot(
    heavy.velocity.x,
    heavy.velocity.y,
    heavy.velocity.z,
  ), 5);
});

test("dogma mass and inertia slow commanded turns without near-rest snapping", () => {
  const dependencies = createVectorDependencies();
  const simulator = createDestinyMovementSimulator(dependencies);
  const buildEntity = (mass): Record<string, any> => ({
    baseMass: 10_000_000,
    mass,
    inertia: 0.5,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 20 },
    direction: { x: 0, y: 0, z: 1 },
    maxVelocity: resolveMassAdjustedMaxVelocity(
      200,
      mass,
      10_000_000,
    ),
  });
  const baseline = buildEntity(10_000_000);
  const heavy = buildEntity(20_000_000);
  const targetDirection = { x: 1, y: 0, z: 0 };

  simulator.applyDesiredVelocity(
    baseline,
    targetDirection,
    baseline.maxVelocity,
    0.1,
  );
  simulator.applyDesiredVelocity(
    heavy,
    targetDirection,
    heavy.maxVelocity,
    0.1,
  );

  assert.ok(baseline.direction.x > heavy.direction.x);
  assert.ok(heavy.direction.x > 0);
  assert.ok(heavy.direction.x < 1);
  assert.ok(baseline.lastTurnMetrics.agilitySeconds <
    heavy.lastTurnMetrics.agilitySeconds);
});
