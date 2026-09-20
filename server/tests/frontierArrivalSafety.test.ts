"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDestinyWarpStateHelpers,
} = require("../src/space/destiny/simulation/warpState");
const {
  createDestinyWarpTargetPlanner,
} = require("../src/space/destiny/simulation/warpTargets");
const transitions = require("../src/space/transitions");
const worldData = require("../src/space/worldData");
const {
  resolveStargatePhysicalRadius,
} = require("../src/space/stargateRadius");

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function subtractVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0),
  };
}

function scaleVector(vector, scalar) {
  return {
    x: toFiniteNumber(vector && vector.x, 0) * scalar,
    y: toFiniteNumber(vector && vector.y, 0) * scalar,
    z: toFiniteNumber(vector && vector.z, 0) * scalar,
  };
}

function magnitude(vector) {
  return Math.sqrt(
    (toFiniteNumber(vector && vector.x, 0) ** 2) +
    (toFiniteNumber(vector && vector.y, 0) ** 2) +
    (toFiniteNumber(vector && vector.z, 0) ** 2),
  );
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  return length > 0 ? scaleVector(vector, 1 / length) : { ...fallback };
}

test("object warp stop distance clears both collision bounds", () => {
  const helpers = createDestinyWarpStateHelpers({ toFiniteNumber });
  const stopDistance = helpers.getWarpStopDistanceForTarget(
    { kind: "ship", radius: 100, collisionRadius: 350 },
    { kind: "structure", radius: 1000, collisionRadius: 5000 },
    0,
  );

  assert.ok(stopDistance >= 5000 + 350 + 500);
  assert.equal(Number.isFinite(stopDistance), true);
});

test("object warp stop distance remains finite when a hull has no authored radius", () => {
  const helpers = createDestinyWarpStateHelpers({ toFiniteNumber });
  const stopDistance = helpers.getWarpStopDistanceForTarget(
    { kind: "ship" },
    { kind: "asteroid", radius: 800 },
    0,
  );

  assert.equal(Number.isFinite(stopDistance), true);
  assert.ok(stopDistance >= 1300);
});

test("stargate warp envelope clears the gate and arriving hull", () => {
  const planner = createDestinyWarpTargetPlanner({
    addVectors,
    cloneVector: (vector) => ({
      x: toFiniteNumber(vector && vector.x, 0),
      y: toFiniteNumber(vector && vector.y, 0),
      z: toFiniteNumber(vector && vector.z, 0),
    }),
    normalizeVector,
    resolveStargatePhysicalRadius: () => 1000,
    scaleVector,
    subtractVectors,
    toFiniteNumber,
    MAX_STARGATE_JUMP_DISTANCE_METERS: 2500,
    WARP_EXIT_VARIANCE_RADIUS_METERS: 2500,
  });
  const gatePosition = { x: 0, y: 0, z: 0 };
  const exitPoint = planner.getStargateWarpExitEnvelopePoint(
    {
      position: { x: 5000, y: 0, z: 0 },
      radius: 100,
      collisionRadius: 300,
    },
    { position: gatePosition },
    0,
  );

  assert.equal(magnitude(subtractVectors(exitPoint, gatePosition)), 1800);
});

test("cross-system anchor offset includes anchor, hull, and clearance radii", () => {
  const anchor = {
    position: { x: 100, y: 0, z: 0 },
    radius: 1000,
    collisionRadius: 4000,
  };
  const spawnState = transitions._testing.buildOffsetSpawnState(anchor, {
    shipRadius: 250,
    clearance: 500,
  });

  assert.equal(
    magnitude(subtractVectors(spawnState.position, anchor.position)),
    4750,
  );
});

test("explicit system anchor radius is authoritative for safe arrival", () => {
  const anchor = {
    position: { x: 100, y: 0, z: 0 },
    radius: 1000,
  };
  const spawnState = transitions._testing.buildOffsetSpawnState(anchor, {
    anchorRadius: 10_000,
    shipRadius: 500,
    clearance: 500,
  });

  assert.equal(
    magnitude(subtractVectors(spawnState.position, anchor.position)),
    11_000,
  );
});

test("default cross-system arrival clears the complete stargate and hull", () => {
  const system = worldData.getSolarSystems().find(
    (candidate) => worldData.getStargatesForSystem(candidate.solarSystemID).length > 0,
  );
  assert.ok(system, "expected at least one solar system with a stargate");
  const stargate = worldData.getStargatesForSystem(system.solarSystemID)[0];
  const shipRadius = 750;
  const spawnState = transitions.buildSolarSystemSpawnState(
    system.solarSystemID,
    { collisionRadius: shipRadius },
  );

  assert.equal(spawnState.anchorID, stargate.itemID);
  const actualOffset = magnitude(
    subtractVectors(spawnState.position, stargate.position),
  );
  const requiredOffset =
    resolveStargatePhysicalRadius(stargate) + shipRadius + 500;
  assert.ok(
    actualOffset >= requiredOffset - 1,
    `arrival offset ${actualOffset}m must clear required ${requiredOffset}m`,
  );
});
