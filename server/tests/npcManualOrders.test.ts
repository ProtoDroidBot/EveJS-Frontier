"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const behavior = require("../src/space/npc/npcBehaviorLoop").__testing;

test("manual NPC movement orders can follow a friendly ship without firing", () => {
  const source = { itemID: 980000001001, position: { x: 0, y: 0, z: 0 } };
  const friendly = {
    itemID: 900001001,
    kind: "ship",
    position: { x: 1_000, y: 0, z: 0 },
  };
  const scene = { getEntityByID: (id) => id === friendly.itemID ? friendly : null };
  const controller = {};
  const profile = { autoActivateWeapons: true, movementMode: "orbit" };
  for (const type of ["approach", "keepAtRange", "orbit"]) {
    const order = behavior.normalizeManualOrder({
      type,
      targetID: friendly.itemID,
      followRangeMeters: 2_500,
      orbitDistanceMeters: 2_500,
      allowWeapons: false,
      keepLock: false,
    });
    assert.equal(behavior.resolveDesiredTarget(
      scene, controller, source, profile, order,
    ), friendly);
    assert.equal(behavior.shouldAllowWeapons(order, profile), false);
    assert.equal(behavior.shouldMaintainLock(order), false);
    assert.equal(
      behavior.resolveMovementDirective(order, profile).movementMode,
      type === "orbit" ? "orbit" : "follow",
    );
    if (type === "approach") {
      assert.equal(behavior.resolveMovementDirective(order, profile).followRangeMeters, 0);
    }
  }
});

test("manual lock order holds position and requests a lock without weapons", () => {
  const order = behavior.normalizeManualOrder({
    type: "lock", targetID: 900001001, allowWeapons: false, keepLock: true,
  });
  assert.equal(behavior.resolveMovementDirective(order, {}).movementMode, "hold");
  assert.equal(behavior.shouldMaintainLock(order), true);
  assert.equal(behavior.shouldAllowWeapons(order, { autoActivateWeapons: true }), false);
});

test("manual NPC orders reject cross-bubble and warping targets", () => {
  const source = { itemID: 980000001001, bubbleID: "alpha", position: {} };
  const target: any = { itemID: 900001001, kind: "ship", bubbleID: "beta", position: {} };
  assert.equal(behavior.isValidManualMovementTarget(source, target), false);
  target.bubbleID = "alpha";
  target.mode = "WARP";
  assert.equal(behavior.isValidManualMovementTarget(source, target), false);
  target.mode = "STOP";
  assert.equal(behavior.isValidManualMovementTarget(source, target), true);
});
