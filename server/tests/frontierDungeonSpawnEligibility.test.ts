"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFrontierDungeonSpawnTemplates,
  collectFrontierDungeonSpawnAuthorityIDs,
  FRONTIER_DUNGEON_SPAWN_GROUP_IDS,
  GENERAL_ANCHOR_CLASS_WEIGHTS,
  LIGHT_SECOND_METERS,
  MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MAXIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM,
  MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM,
  RESOURCE_ANCHOR_CLASS_WEIGHTS,
  getUniverseDungeonAnchorDistanceRange,
  isTemplateEligibleForUniverseSpawning,
  isTemplateFromFrontierDungeonDataset,
  orderUniverseDungeonAnchorCandidates,
  resolveUniverseDungeonSiteCount,
} = require("../src/services/dungeon/dungeonSpawnEligibility");

test("large dungeon anchors stay within 1 to 50 light-seconds", () => {
  assert.equal(MINIMUM_LARGE_ANCHOR_OFFSET_METERS, LIGHT_SECOND_METERS);
  assert.equal(MAXIMUM_LARGE_ANCHOR_OFFSET_METERS, LIGHT_SECOND_METERS * 50);
});

test("regular universe dungeon density is a stable 3 to 5 sites per system", () => {
  const systemIDs = Array.from({ length: 100 }, (_, index) => 30_000_000 + index);
  const firstPass: number[] = systemIDs.map((systemID) => (
    Number(resolveUniverseDungeonSiteCount(systemID))
  ));
  const secondPass: number[] = systemIDs.map((systemID) => (
    Number(resolveUniverseDungeonSiteCount(systemID))
  ));

  assert.equal(MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM, 3);
  assert.equal(MAXIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM, 5);
  assert.deepEqual(secondPass, firstPass);
  assert.equal(firstPass.every((count) => count >= 3 && count <= 5), true);
  assert.deepEqual([...new Set(firstPass)].sort(), [3, 4, 5]);
});

test("universe spawning accepts only Frontier dungeons in the four site groups", () => {
  const source = {
    frontierDungeonTemplates: [
      { dungeonID: 101, entryTypeID: 1001 },
      { _key: 102, entryTypeID: 1002 },
      { dungeonID: 103, entryTypeID: 1003 },
      { dungeonID: 104, entryTypeID: 1004 },
      { dungeonID: 105, entryTypeID: 1005 },
      { dungeonID: 106, entryTypeID: 9999 },
    ],
    itemTypes: [
      { typeID: 1001, groupID: 4871 },
      { typeID: 1002, groupID: 4872 },
      { typeID: 1003, groupID: 4873 },
      { typeID: 1004, groupID: 4874 },
      { typeID: 1005, groupID: 502 },
    ],
  };
  const authority = new Set(collectFrontierDungeonSpawnAuthorityIDs(source));

  assert.deepEqual(FRONTIER_DUNGEON_SPAWN_GROUP_IDS, [4871, 4872, 4873, 4874]);
  assert.deepEqual([...authority], [101, 102, 103, 104]);
  assert.equal(isTemplateFromFrontierDungeonDataset({ sourceDungeonID: 101 }, authority), true);
  assert.equal(isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 104 }, authority), true);
  assert.equal(
    isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 105 }, authority),
    false,
    "legacy cosmic-signature groups must fail closed",
  );
  assert.equal(
    isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 106 }, authority),
    false,
    "dungeons with an unknown entry type must fail closed",
  );
  assert.equal(
    isTemplateEligibleForUniverseSpawning({}, authority),
    false,
    "synthetic templates without a Frontier dungeon ID must fail closed",
  );
});

test("landscape and ecosystem references do not exclude an allowed site-group dungeon", () => {
  const source = {
    frontierDungeonTemplates: [{ dungeonID: 201, entryTypeID: 2001 }],
    itemTypes: [{ typeID: 2001, groupID: 4873 }],
    landscapeDungeonTemplates: [{ dungeonID: 201 }],
    landscapeEcosystems: [{
      entryDungeonID: 201,
      naturalWorldPatterns: [{ dungeonID: 201 }],
    }],
    landscapeSites: [{ dungeonID: 201 }],
  };
  const authority = new Set(collectFrontierDungeonSpawnAuthorityIDs(source));

  assert.deepEqual([...authority], [201]);
  assert.equal(isTemplateEligibleForUniverseSpawning({ sourceDungeonID: 201 }, authority), true);
});

test("missing client authority rows are promoted from all four Frontier site groups", () => {
  const rooms = [{ roomID: 9001, objects: [{ objectID: 7001, typeID: 8001 }] }];
  const source = {
    frontierDungeonTemplates: [
      { dungeonID: 201, dungeonName: "Mining Site", entryTypeID: 1001, rooms },
      { dungeonID: 202, dungeonName: "Rift Site", entryTypeID: 1002, difficulty: 5 },
      { dungeonID: 203, dungeonName: "Wreck Site", entryTypeID: 1003 },
      { dungeonID: 204, dungeonName: "Landmark Site", entryTypeID: 1004 },
      { dungeonID: 205, dungeonName: "Legacy Signature", entryTypeID: 1005 },
    ],
  };
  const itemTypes = [
    { typeID: 1001, groupID: 4871 },
    { typeID: 1002, groupID: 4872 },
    { typeID: 1003, groupID: 4873 },
    { typeID: 1004, groupID: 4874 },
    { typeID: 1005, groupID: 502 },
  ];

  const templates = buildFrontierDungeonSpawnTemplates(source, itemTypes);

  assert.deepEqual(templates.map((template) => template.sourceDungeonID), [201, 202, 203, 204]);
  assert.deepEqual(templates.map((template) => template.entryObjectGroupID), [4871, 4872, 4873, 4874]);
  assert.deepEqual(templates.map((template) => template.entryObjectTypeID), [1001, 1002, 1003, 1004]);
  assert.deepEqual(templates.map((template) => template.siteFamily), ["combat", "combat", "combat", "combat"]);
  assert.equal(templates.every((template) => template.siteKind === "anomaly"), true);
  assert.deepEqual(templates[0].rooms, rooms);
  assert.equal(templates[0].difficulty, 1, "mining entry sites use the same selectable baseline as 4873");
  assert.equal(templates[1].difficulty, 5, "authored difficulty must be retained");
  assert.equal(templates[2].difficulty, 1, "unset non-mining difficulty must remain spawn-selectable");
});

test("an exact client authority template wins over a synthesized Frontier template", () => {
  const templates = buildFrontierDungeonSpawnTemplates(
    {
      frontierDungeonTemplates: [
        { dungeonID: 201, dungeonName: "Mining Site", entryTypeID: 1001 },
        { dungeonID: 202, dungeonName: "Second Mining Site", entryTypeID: 1002 },
      ],
    },
    [
      { typeID: 1001, groupID: 4871 },
      { typeID: 1002, groupID: 4871 },
    ],
    {
      "client-dungeon:201": {
        templateID: "client-dungeon:201",
        sourceDungeonID: 201,
      },
    },
  );

  assert.deepEqual(templates.map((template) => template.templateID), ["frontier-dungeon:202"]);
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
  assert.deepEqual(getUniverseDungeonAnchorDistanceRange({ anchorKind: "celestial", groupID: 999 }), {
    minimumDistanceMeters: MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
    maximumDistanceMeters: MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  });
});
