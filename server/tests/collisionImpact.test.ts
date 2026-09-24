"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyDamageToEntity } = require("../src/space/combat/damage");
const { buildCollisionImpactSnapshot } = require("../src/space/destiny/simulation/collisions");
const {
  calculateCollisionDamage,
  processCollisionContacts,
} = require("../src/space/destiny/simulation/collisionImpact");

function contact(mover, candidate, normal = { x: -1, y: 0, z: 0 }, immovable = false) {
  return {
    mover,
    candidate,
    collision: {
      entityID: candidate.itemID,
      normal,
      startedOverlapping: false,
      impact: buildCollisionImpactSnapshot(mover, candidate, normal, immovable),
    },
  };
}

function entity(itemID, mass, velocity) {
  return { itemID, mass, velocity };
}

test("collision damage uses unmodified safe speed and spills through every health layer", () => {
  const mover = entity(1, 1_000_000, { x: 300, y: 0, z: 0 });
  const wall = entity(2, 0, { x: 0, y: 0, z: 0 });
  const hit = contact(mover, wall, undefined, true);
  const damage = calculateCollisionDamage(hit.collision, 200, 0);
  assert.equal(damage.total, 100);
  assert.equal(damage.moving, 100);
  assert.equal(damage.candidate, 0);
  assert.equal(calculateCollisionDamage(hit.collision, 300, 0), null);

  const health = {
    shieldCapacity: 50,
    armorHP: 30,
    structureHP: 100,
    conditionState: { shieldCharge: 1, armorDamage: 0, damage: 0 },
  };
  const applied = applyDamageToEntity(health, { kinetic: damage.moving });
  assert.equal(applied.success, true);
  assert.deepEqual(applied.data.afterLayers, { shield: 0, armor: 0, structure: 80 });
});

test("the lighter body receives most of a two-body impact", () => {
  const heavy = entity(1, 10_000_000, { x: 100, y: 0, z: 0 });
  const light = entity(2, 1_000_000, { x: 0, y: 0, z: 0 });
  const damage = calculateCollisionDamage(contact(heavy, light).collision, 0, 0);
  assert.ok(damage.candidate > damage.moving * 9);
  assert.ok(Math.abs(damage.total - damage.moving - damage.candidate) < 1e-9);
});

test("placeholder and sentinel masses cannot cause damage or push", () => {
  const mover = entity(1, 1e35, { x: 500, y: 0, z: 0 });
  const candidate = entity(2, 1_000_000, { x: 0, y: 0, z: 0 });
  const hit = contact(mover, candidate);
  assert.equal(hit.collision.impact.movingMassKg, null);
  assert.equal(calculateCollisionDamage(hit.collision, 0, 0), null);

  const pushes: any[] = [];
  const result = processCollisionContacts({}, [hit], {
    tickSequence: 1,
    nowMs: 1_000,
    applyPush: (target, delta) => { pushes.push({ target, delta }); },
  });
  assert.equal(result.pushed, 0);
  assert.equal(pushes.length, 0);
});

test("a heavy mover pushes a lighter body even below the damage threshold", () => {
  const heavy = entity(1, 4_000_000, { x: 100, y: 0, z: 0 });
  const light = entity(2, 1_000_000, { x: 0, y: 0, z: 0 });
  const damages: any[] = [];
  const pushes: any[] = [];
  const scene: any = {};
  const result = processCollisionContacts(scene, [contact(heavy, light)], {
    tickSequence: 1,
    nowMs: 1_000,
    safeSpeedFor: (target) => target === heavy ? 100 : 0,
    applyDamage: (...args) => { damages.push(args); },
    applyPush: (target, delta) => { pushes.push({ target, delta }); },
  });
  assert.equal(result.damaged, 0);
  assert.equal(result.pushed, 1);
  assert.equal(damages.length, 0);
  assert.equal(pushes[0].target, light);
  assert.equal(pushes[0].delta.x, 250);
});

test("smaller pushers move a larger body only when their aligned mass combines", () => {
  const large = entity(9, 3_000_000, { x: 0, y: 0, z: 0 });
  const first = entity(1, 2_000_000, { x: 100, y: 0, z: 0 });
  const second = entity(2, 2_000_000, { x: 100, y: 0, z: 0 });
  const pushes: any[] = [];
  const options = {
    tickSequence: 1,
    nowMs: 1_000,
    applyPush: (target, delta) => { pushes.push({ target, delta }); },
  };
  processCollisionContacts({}, [contact(first, large)], options);
  assert.equal(pushes.length, 0);
  processCollisionContacts({}, [contact(first, large), contact(second, large)], options);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].target, large);
  assert.ok(pushes[0].delta.x > 0);
});

test("opposing smaller pushers cancel and sustained contact does not repeat damage", () => {
  const large = entity(9, 3_000_000, { x: 0, y: 0, z: 0 });
  const left = entity(1, 2_000_000, { x: 300, y: 0, z: 0 });
  const right = entity(2, 2_000_000, { x: -300, y: 0, z: 0 });
  const events = [
    contact(left, large),
    contact(right, large, { x: 1, y: 0, z: 0 }),
  ];
  const scene: any = {};
  const damages: any[] = [];
  const pushes: any[] = [];
  const callbacks = {
    safeSpeedFor: () => 0,
    applyDamage: (...args) => { damages.push(args); },
    applyPush: (target, delta) => { pushes.push({ target, delta }); },
  };
  processCollisionContacts(scene, events, { ...callbacks, tickSequence: 1, nowMs: 1_000 });
  const firstDamageCount = damages.length;
  assert.ok(firstDamageCount > 0);
  assert.equal(pushes.length, 0);
  processCollisionContacts(scene, events, { ...callbacks, tickSequence: 2, nowMs: 1_100 });
  assert.equal(damages.length, firstDamageCount);
  assert.equal(pushes.length, 0);
});
