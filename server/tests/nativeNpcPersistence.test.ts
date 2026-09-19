"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const nativeNpcService = require("../src/space/npc/nativeNpcService");

test("native NPC checkpoints retain position and shield/armor/hull condition", (t) => {
  const storedRecord: Record<string, any> = {
    entityID: 980000000123,
    systemID: 30000004,
    nativeNpc: true,
    transient: true,
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 1, y: 2, z: 3 },
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
    },
  };
  let writtenRecord = null;
  let writtenOptions = null;
  t.mock.method(nativeNpcStore, "getNativeEntity", () => storedRecord);
  t.mock.method(nativeNpcStore, "upsertNativeEntity", (record, options) => {
    writtenRecord = record;
    writtenOptions = options;
    return { success: true };
  });

  const runtimeEntity: Record<string, any> = {
    kind: "ship",
    itemID: storedRecord.entityID,
    nativeNpc: true,
    position: { x: 45_000, y: -12_000, z: 900 },
    velocity: { x: 30, y: 4, z: -2 },
    direction: { x: 0, y: 1, z: 0 },
    targetPoint: { x: 46_000, y: -12_000, z: 900 },
    mode: "GOTO",
    speedFraction: 0.65,
    conditionState: {
      shieldCharge: 0.28,
      armorDamage: 0.36,
      damage: 0.19,
      charge: 0.51,
      incapacitated: false,
    },
  };

  const result = nativeNpcService.persistNativeRuntimeEntity(runtimeEntity, {
    nowMs: 123_456,
  });

  assert.equal(result.success, true);
  assert.deepEqual(writtenRecord.position, runtimeEntity.position);
  assert.deepEqual(writtenRecord.velocity, runtimeEntity.velocity);
  assert.deepEqual(writtenRecord.direction, runtimeEntity.direction);
  assert.deepEqual(writtenRecord.targetPoint, runtimeEntity.targetPoint);
  assert.equal(writtenRecord.mode, "GOTO");
  assert.equal(writtenRecord.speedFraction, 0.65);
  assert.deepEqual(writtenRecord.conditionState, runtimeEntity.conditionState);
  assert.deepEqual(writtenOptions, { transient: true });
  assert.equal(runtimeEntity.lastPersistAt, 123_456);
});

