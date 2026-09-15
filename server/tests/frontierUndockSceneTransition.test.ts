"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const transitions = require("../src/space/transitions");

const shapeUndockTransition =
  transitions._testing.applyUndockSessionChangeShapeForTesting;

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
