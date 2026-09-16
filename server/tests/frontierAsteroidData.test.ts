"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const asteroidData = require("../src/space/asteroids/asteroidData");
const asteroidService = require("../src/space/asteroids/asteroidService");

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

test("Frontier dungeon resource fields resolve authored dungeon objects as asteroid anchors", () => {
  const anchors = asteroidService._testing.resolveFrontierDungeonObjectAnchors(
    {
      itemID: 200,
      ecosystemID: 4,
      dungeonID: 100,
      frontierLandscapeSite: true,
    },
    {
      getLandscapeEcosystemByID: () => ({ ecosystemID: 4 }),
      getLandscapeDungeonTemplateByID: () => null,
      buildLandscapeScenePlan: () => ({
        locators: [
          {
            dungeonID: 100,
            occurrenceIndex: 0,
            patternKind: "entry",
            positionOffset: { x: 75_000, y: 15_000, z: -40_000 },
            role: "resourceLocator",
          },
          {
            dungeonID: 101,
            occurrenceIndex: 0,
            patternKind: "natural",
            positionOffset: { x: -125_000, y: -22_000, z: 65_000 },
            role: "resourceLocator",
          },
        ],
        environmentProps: [
          {
            key: "landscape:entry:100:0:10:1001",
            positionOffset: { x: 80_000, y: 12_000, z: -45_000 },
          },
          {
            key: "landscape:entry:100:0:10:1002",
            positionOffset: { x: 82_000, y: 13_000, z: -47_000 },
          },
          {
            key: "landscape:natural:101:0:11:1011",
            positionOffset: { x: -130_000, y: -18_000, z: 70_000 },
          },
        ],
      }),
    },
  );

  assert.deepEqual(anchors, [
    { x: 75_000, y: 15_000, z: -40_000 },
    { x: -125_000, y: -22_000, z: 65_000 },
  ]);
});

test("Frontier dungeon asteroids scatter farther in three dimensions around dungeon objects", () => {
  const randomValues = [0.125, 0.75, 0.875];
  let randomIndex = 0;
  const anchor = { x: 100_000, y: 20_000, z: -50_000 };
  const offset = asteroidService._testing.buildDungeonAnchoredAsteroidOffset(
    {
      dungeonObjectScatterMinMeters: 18_000,
      dungeonObjectScatterMaxMeters: 48_000,
    },
    0,
    () => randomValues[randomIndex++],
    [anchor],
  );
  const delta = {
    x: offset.x - anchor.x,
    y: offset.y - anchor.y,
    z: offset.z - anchor.z,
  };
  const distance = Math.hypot(delta.x, delta.y, delta.z);

  assert.ok(distance >= 18_000 && distance <= 48_000);
  assert.ok(Math.abs(delta.x) > 5_000);
  assert.ok(Math.abs(delta.y) > 5_000);
  assert.ok(Math.abs(delta.z) > 5_000);
});
