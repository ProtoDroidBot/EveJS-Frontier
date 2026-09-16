"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const asteroidData = require("../src/space/asteroids/asteroidData");

test("asteroid data promotes eligible landscape ecosystems into resource fields", () => {
  const cache = asteroidData._testing.buildCacheFromRows(
    [{
      itemID: 100,
      solarSystemID: 30_000_001,
      fieldStyleID: "authored",
      position: { x: 0, y: 0, z: 0 },
    }],
    [{ fieldStyleID: "authored" }],
    [
      {
        itemID: 200,
        solarSystemID: 30_000_001,
        featureKind: "asteroidBelt",
        featureTags: ["belt", "inner"],
        ecosystemID: 4,
        position: { x: 1, y: 2, z: 3 },
      },
      {
        itemID: 201,
        solarSystemID: 30_000_001,
        featureKind: "asteroidBelt",
        featureTags: ["belt", "transitional"],
        ecosystemID: 20,
        position: { x: 4, y: 5, z: 6 },
      },
      {
        itemID: 202,
        solarSystemID: 30_000_002,
        featureKind: "trojan",
        featureTags: ["trojan"],
        ecosystemID: 13,
        position: { x: 7, y: 8, z: 9 },
      },
      {
        itemID: 203,
        solarSystemID: 30_000_002,
        featureKind: "landmark",
        featureTags: ["outer"],
        ecosystemID: 99,
        position: { x: 10, y: 11, z: 12 },
      },
    ],
  );

  assert.equal(cache.authoredBeltCount, 1);
  assert.equal(cache.frontierLandscapeBeltCount, 3);
  assert.deepEqual(
    cache.beltsBySystem.get(30_000_001).map((entry) => entry.itemID),
    [100, 200, 201],
  );
  assert.equal(cache.beltsByID.get(200).resourceZone, "inner");
  assert.equal(cache.beltsByID.get(201).resourceZone, "fringe");
  assert.equal(cache.beltsByID.get(202).resourceZone, "trojan");
  assert.ok(cache.fieldStylesByID.has("frontier_inner_resource_field"));
  assert.ok(cache.fieldStylesByID.has("frontier_outer_resource_field"));
  assert.ok(cache.fieldStylesByID.has("frontier_fringe_resource_field"));
  assert.ok(cache.fieldStylesByID.has("frontier_trojan_resource_field"));
});
