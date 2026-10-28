"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const transitions = require("../src/space/transitions");

const shapeUndockTransition =
  transitions._testing.applyUndockSessionChangeShapeForTesting;
const preserveShipConditionState =
  transitions._testing.preserveShipConditionStateForTransitionForTesting;

test("undock session changes clear both station identities before entering space", () => {
  const plan = {
    sessionChanges: {
      locationid: [64000001, 30000004],
      solarsystemid: [null, 30000004],
      stationid2: [64000001, null],
      stationid: [64000001, null],
    },
  };

  assert.equal(shapeUndockTransition(plan), plan);
  assert.deepEqual(Object.keys(plan.sessionChanges), [
    "stationid",
    "stationid2",
    "locationid",
    "solarsystemid",
  ]);
  assert.deepEqual(plan.sessionChanges.stationid2, [64000001, null]);
});

test("dock and undock transitions preserve damage, capacitor, shields, and fuel", () => {
  const ship = {
    itemID: 140000010,
    conditionState: {
      damage: 0.41,
      armorDamage: 0.32,
      shieldCharge: 0.23,
      charge: 0.14,
      incapacitated: false,
      fuelCharge: 75,
      fuelTypeID: 77818,
      fuelQueue: [{ fuelTypeID: 77818, quantity: 75 }],
      temperature: 612,
    },
  };

  const preserved = preserveShipConditionState(ship);

  assert.notEqual(preserved, ship);
  assert.deepEqual(preserved.conditionState, ship.conditionState);
  assert.equal(preserved.conditionState.damage, 0.41);
  assert.equal(preserved.conditionState.armorDamage, 0.32);
  assert.equal(preserved.conditionState.shieldCharge, 0.23);
  assert.equal(preserved.conditionState.charge, 0.14);
});
