"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectFrontierDungeonSpawnAuthorityIDs,
  GENERAL_ANCHOR_CLASS_WEIGHTS,
  LIGHT_SECOND_METERS,
  MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
  RESOURCE_ANCHOR_CLASS_WEIGHTS,
  collectLandscapeDungeonSpawnExclusionIDs,
  getUniverseDungeonAnchorDistanceRange,
  isTemplateEligibleForUniverseSpawning,
  isTemplateExcludedFromUniverseSpawning,
  isTemplateFromFrontierDungeonDataset,
  orderUniverseDungeonAnchorCandidates,
} = require("../src/services/dungeon/dungeonSpawnEligibility");

test("large dungeon anchors stay within 0.01 to 0.5 light-seconds", () => {
  assert.equal(MINIMUM_LARGE_ANCHOR_OFFSET_METERS, LIGHT_SECOND_METERS * 0.01);
  assert.equal(MAXIMUM_LARGE_ANCHOR_OFFSET_METERS, LIGHT_SECOND_METERS * 0.5);
});

test("universe spawning accepts only templates present in the Frontier dungeon dataset", () => {
  const source = {
    frontierDungeonTemplates: [
      { dungeonID: 101 },
      { _key: 102 },
    ],
    landscapeDungeonTemplates: [
      { dungeonID: 102 },
    ],
  };
  const authority = new Set(collectFrontierDungeonSpawnAuthorityIDs(source));
  const exclusions = new Set(collectLandscapeDungeonSpawnExclusionIDs(source));

  assert.deepEqual([...authority], [101, 102]);
  assert.equal(isTemplateFromFrontierDungeonDataset({ sourceDungeonID: 101 }, authority), true);
  assert.equal(isTemplateFromFrontierDungeonDataset({ sourceDungeonID: 999 }, authority), false);
  assert.equal(
    isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 101 }, authority, exclusions),
    true,
  );
  assert.equal(
    isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 102 }, authority, exclusions),
    false,
    "landscape ingredients remain excluded even when they are in the Frontier dungeon table",
  );
  assert.equal(
    isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 999 }, authority, exclusions),
    false,
    "legacy non-Frontier dungeon templates must fail closed",
  );
  assert.equal(
    isTemplateEligibleForUniverseSpawning({}, authority, exclusions),
    false,
    "synthetic templates without a Frontier dungeon ID must fail closed",
  );
});

test("landscape and ecosystem dungeon references are excluded from universe spawning", () => {
  const source = {
    landscapeDungeonTemplates: [
      { dungeonID: 101 },
      { _key: 102 },
    ],
    landscapeEcosystems: [{
      entryDungeonID: 103,
      naturalWorldPatterns: [{ dungeonID: 104 }, { dungeonID: 101 }],
      brokenWorldPatterns: [{ dungeonID: 105 }],
    }],
    landscapeSites: [
      { dungeonID: 106 },
      { dungeonID: 0 },
    ],
  };

  const exclusions = collectLandscapeDungeonSpawnExclusionIDs(source);
  assert.deepEqual(exclusions, [101, 102, 103, 104, 105, 106]);
  assert.equal(
    isTemplateExcludedFromUniverseSpawning({ sourceDungeonID: 104 }, new Set(exclusions)),
    true,
  );
  assert.equal(
    isTemplateExcludedFromUniverseSpawning({ sourceDungeonID: 999 }, new Set(exclusions)),
    false,
  );
});

test("dungeon anchors prefer celestials while retaining stations and stargates", () => {
  const anchors = orderUniverseDungeonAnchorCandidates({
    celestials: [
      { itemID: 40, groupID: 4870, anchorKind: "lagrange" },
      { itemID: 30, groupID: 6, anchorKind: "star" },
      { itemID: 20, groupID: 8, anchorKind: "moon" },
      { itemID: 10, groupID: 7, anchorKind: "planet" },
    ],
    belts: [{ itemID: 50, anchorKind: "asteroid-belt" }],
    stations: [{ itemID: 60, anchorKind: "station" }],
    stargates: [{ itemID: 70, anchorKind: "stargate" }],
  }, "combat");

  assert.deepEqual(anchors.map((entry) => entry.itemID), [10, 20, 30, 40, 60, 70, 50]);
  assert.deepEqual(
    anchors.filter((entry) => [10, 20, 30, 40, 60, 70].includes(entry.itemID))
      .map((entry) => [entry.minimumDistanceMeters, entry.maximumDistanceMeters]),
    Array.from({ length: 6 }, () => [
      MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
      MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
    ]),
  );
  assert.equal(anchors.find((entry) => entry.itemID === 50).minimumDistanceMeters, undefined);
  assert.equal(
    anchors.filter((entry) => [10, 20, 30].includes(entry.itemID))
      .reduce((total, entry) => total + entry.selectionWeight, 0),
    GENERAL_ANCHOR_CLASS_WEIGHTS.primaryCelestials,
  );
  assert.equal(
    anchors.find((entry) => entry.itemID === 40).selectionWeight,
    GENERAL_ANCHOR_CLASS_WEIGHTS.secondaryCelestials,
  );
  assert.equal(
    anchors.find((entry) => entry.itemID === 60).selectionWeight,
    GENERAL_ANCHOR_CLASS_WEIGHTS.stations,
  );
  assert.equal(
    anchors.find((entry) => entry.itemID === 70).selectionWeight,
    GENERAL_ANCHOR_CLASS_WEIGHTS.stargates,
  );
});

test("resource dungeons prioritize authored and landscape resource fields", () => {
  const anchors = orderUniverseDungeonAnchorCandidates({
    celestials: [{ itemID: 10, groupID: 7, anchorKind: "planet" }],
    belts: [{
      itemID: 50,
      anchorKind: "landscape-resource-field",
      resourceZone: "fringe",
    }],
    stations: [{ itemID: 60, anchorKind: "station" }],
    stargates: [{ itemID: 70, anchorKind: "stargate" }],
  }, "ore");

  assert.deepEqual(anchors.map((entry) => entry.itemID), [50, 10, 60, 70]);
  assert.equal(
    anchors.find((entry) => entry.itemID === 50).selectionWeight,
    RESOURCE_ANCHOR_CLASS_WEIGHTS.belts,
  );
  assert.equal(anchors.find((entry) => entry.itemID === 50).resourceZone, "fringe");
  assert.deepEqual(getUniverseDungeonAnchorDistanceRange({ anchorKind: "station" }), {
    minimumDistanceMeters: MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
    maximumDistanceMeters: MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  });
});
