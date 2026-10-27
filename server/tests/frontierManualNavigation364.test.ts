"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createMovementManualFlightCommands } = require("../src/space/destiny/commands/manualFlightCommands");
const { clearTrackingState } = require("../src/space/destiny/simulation/motionState");
const { createDestinyMovementSimulator } = require("../src/space/destiny/simulation/movement");
const { isDestinyPayload } = require("../src/space/destiny/protocol/payloads");
const vector = value => ({ x: value?.x || 0, y: value?.y || 0, z: value?.z || 0 });
const scale = (v, n) => ({ x: v.x * n, y: v.y * n, z: v.z * n });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const normalize = (v, fallback = { x: 0, y: 0, z: 1 }) => Math.hypot(v.x, v.y, v.z) ? scale(v, 1 / Math.hypot(v.x, v.y, v.z)) : vector(fallback);
const deps: any = { addVectors: add, scaleVector: scale, cloneVector: vector, normalizeVector: normalize,
  clamp: (v, min, max) => Math.min(max, Math.max(min, v)), clearTrackingState,
  persistShipEntity: () => true, armMovementTrace: () => {}, roundNumber: v => v,
  summarizeVector: vector, toFiniteNumber: (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback,
  subtractVectors: (a, b) => add(a, scale(b, -1)),
  magnitude: v => Math.hypot(v.x, v.y, v.z), distance: (a, b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z),
  getCurrentAlignmentDirection: e => e.direction,
  deriveAgilitySeconds: e => e.agilitySeconds, getTurnMetrics: () => ({ radians: 0, turnFraction: 1 }),
  TURN_ALIGNMENT_RADIANS: 0.001, MAX_SUBWARP_SPEED_FRACTION: 1,
  DEFAULT_RIGHT: { x: 1, y: 0, z: 0 } };
function fixture() {
  const entity: any = { itemID: 9001, kind: "ship", mode: "STOP", position: vector({}), direction: { x: 0, y: 0, z: 1 }, speedFraction: 1,
    maxVelocity: 100, agilitySeconds: 5, maxAngularSpeed: 0.5 };
  const sent = [];
  const runtime = { getShipEntityForSession: () => entity, getCurrentSimTimeMs: () => 1000,
    getHistorySafeSessionDestinyStamp: () => 1, broadcastPilotCommandMovementUpdates: (_s, updates) => sent.push(...updates), scheduleWatcherMovementAnchor: () => {} };
  return { entity, runtime, sent, commands: createMovementManualFlightCommands(deps), simulator: createDestinyMovementSimulator(deps) };
}
test("all 3640684 axes preserve each other and serialize native actions", () => {
  const f = fixture(); f.commands.setPitchRate(f.runtime, {}, 0.75); f.commands.setYawRate(f.runtime, {}, -0.5);
  f.commands.setRollRate(f.runtime, {}, 3); f.commands.setBrakeFraction(f.runtime, {}, 0.4);
  f.commands.setStrafingThrust(f.runtime, {}, [1, 2]);
  assert.equal(f.entity.manualPitchRate, 0.75); assert.equal(f.entity.manualYawRate, -0.5);
  assert.equal(f.entity.manualRollRate, 1); assert.equal(f.entity.manualBrakeFraction, 0.4);
  for (const update of f.sent) assert.equal(isDestinyPayload(update.payload), true);
  assert.deepEqual(f.sent.map(x => x.payload[0]), ["SetPitchRate", "SetYawRate", "SetRollRate", "SetBrakeFraction", "SetStrafingThrust"]);
});
test("heading normalizes, zero releases, malformed values never change authority", () => {
  const f = fixture(); assert.equal(f.commands.setHeading(f.runtime, {}, [0, 3, 4]), true);
  assert.deepEqual(f.entity.manualHeading, { x: 0, y: 0.6, z: 0.8 });
  assert.equal(f.sent[0].payload[1][1].length, 3);
  assert.equal(f.commands.setHeading(f.runtime, {}, [NaN, 0, 0]), false);
  assert.equal(f.commands.setPitchRate(f.runtime, {}, Infinity), false);
  assert.equal(f.sent.length, 1);
  f.commands.setHeading(f.runtime, {}, [0, 0, 0]); assert.equal(f.entity.manualHeading, null);
  assert.deepEqual(f.sent[1].payload[1][1].map(v => v.value), [0, 0, 0]);
});
test("pitch rate integrates over time and roll persists after input release", () => {
  const f = fixture(); f.commands.setPitchRate(f.runtime, {}, 0.5);
  f.simulator.advanceManualFlightTarget(f.entity, 2);
  assert.equal(f.entity.manualPitchVelocity, 0.25);
  assert.ok(Math.abs(normalize(f.entity.targetPoint).y - Math.sin(0.5)) < 1e-9);
  f.commands.setPitchRate(f.runtime, {}, 0); f.commands.setRollRate(f.runtime, {}, 1);
  f.simulator.advanceManualFlightTarget(f.entity, 2);
  assert.ok(Math.abs(f.entity.manualRoll - 1) < 1e-9);
  f.commands.setRollRate(f.runtime, {}, 0); f.simulator.advanceManualFlightTarget(f.entity, 1);
  assert.ok(Math.abs(f.entity.manualRoll - 1) < 1e-9);
  clearTrackingState(f.entity); assert.equal(f.entity.manualPitchRate, null); assert.equal(f.entity.manualRollRate, 0);
  assert.equal(f.entity.manualBrakeFraction, 0); assert.ok(Math.abs(f.entity.manualRoll - 1) < 1e-9);
});
test("absolute pitch exits pitch-rate authority and heading defers to directional flight", () => {
  const f = fixture(); f.commands.setPitchRate(f.runtime, {}, 1); f.commands.setPitch(f.runtime, {}, -0.25);
  assert.equal(f.entity.manualPitchRate, null); assert.equal(f.entity.manualPitch, -0.25);
  f.commands.setHeading(f.runtime, {}, [1, 0, 0]); f.simulator.advanceManualFlightTarget(f.entity, 1);
  assert.deepEqual(normalize(f.entity.targetPoint), { x: 1, y: 0, z: 0 });
  f.commands.setYawRate(f.runtime, {}, 1); assert.equal(f.entity.manualHeading, null);
});

test("brake demand reduces authoritative thrust and releasing it retains commanded speed", () => {
  const f = fixture(); f.entity.velocity = { x: 0, y: 0, z: 100 };
  f.entity.targetPoint = { x: 0, y: 0, z: 1e16 };
  f.commands.setBrakeFraction(f.runtime, {}, 1);
  f.simulator.advanceGotoMovement(f.entity, 1);
  assert.ok(f.entity.velocity.z < 100 && f.entity.velocity.z > 0);
  const brakingSpeed = f.entity.velocity.z;
  assert.equal(f.entity.speedFraction, 1);
  f.commands.setBrakeFraction(f.runtime, {}, 0);
  f.simulator.advanceGotoMovement(f.entity, 1);
  assert.ok(f.entity.velocity.z > brakingSpeed);
});

test("pitch-rate authority crosses poles instead of clipping at an absolute pitch limit", () => {
  const f = fixture(); f.commands.setPitchRate(f.runtime, {}, 1);
  f.simulator.advanceManualFlightTarget(f.entity, Math.PI / 0.5);
  assert.ok(f.entity.direction.z < -0.999999);
  f.simulator.advanceManualFlightTarget(f.entity, Math.PI / 0.5);
  assert.ok(f.entity.direction.z > 0.999999);
  assert.ok(Math.abs(f.entity.direction.y) < 1e-9);
});
