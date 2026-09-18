"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const MapService = require("../src/services/map/mapService");

const {
  buildDungeonBeaconMapRows,
} = MapService._testing;

const SOLAR_SYSTEM_ID = 30_000_142;
const INSTANCE_ID = 7_100_000_000_001;
const BEACON_ITEM_ID = 7_200_000_000_001;
const ANCHOR_ITEM_ID = 40_000_001;

function buildInstance(overrides: Record<string, any> = {}) {
  return {
    instanceID: INSTANCE_ID,
    solarSystemID: SOLAR_SYSTEM_ID,
    lifecycleState: "active",
    instanceScope: "shared",
    ownership: {
      visibilityScope: "shared",
    },
    metadata: {
      anchorItemID: ANCHOR_ITEM_ID,
    },
    ...overrides,
  };
}

function buildOptions(instances, buildCalls) {
  return {
    dungeonRuntime: {
      listActiveInstancesBySystem: (solarSystemID, options) => {
        assert.equal(solarSystemID, SOLAR_SYSTEM_ID);
        assert.equal(options.full, true);
        return instances;
      },
    },
    dungeonUniverseSiteService: {
      buildSiteEntity: (instance) => {
        buildCalls.push(instance.instanceID);
        return {
          itemID: BEACON_ITEM_ID,
          typeID: 19_728,
          groupID: 502,
          itemName: "Ancient Dungeon Beacon",
          position: { x: 101, y: 202, z: 303 },
        };
      },
    },
  };
}

test("solar-system map rows include one connector row for a public dungeon beacon", () => {
  const buildCalls: any[] = [];
  const rows = buildDungeonBeaconMapRows(
    SOLAR_SYSTEM_ID,
    { characterID: 140_000_005 },
    buildOptions([buildInstance()], buildCalls),
  );

  assert.deepEqual(buildCalls, [INSTANCE_ID]);
  assert.deepEqual(rows, [[
    502,
    19_728,
    BEACON_ITEM_ID,
    "Ancient Dungeon Beacon",
    SOLAR_SYSTEM_ID,
    ANCHOR_ITEM_ID,
    true,
    101,
    202,
    303,
    null,
    null,
  ]]);
});

test("solar-system map rows expose only authorized private dungeon beacons", () => {
  const ownerCharacterID = 140_000_005;
  const instance = buildInstance({
    instanceScope: "private",
    ownership: {
      visibilityScope: "private",
      characterID: ownerCharacterID,
    },
  });
  const outsiderBuildCalls: any[] = [];
  const ownerBuildCalls: any[] = [];

  assert.deepEqual(
    buildDungeonBeaconMapRows(
      SOLAR_SYSTEM_ID,
      { characterID: ownerCharacterID + 1 },
      buildOptions([instance], outsiderBuildCalls),
    ),
    [],
  );
  assert.deepEqual(outsiderBuildCalls, []);

  assert.equal(
    buildDungeonBeaconMapRows(
      SOLAR_SYSTEM_ID,
      { characterID: ownerCharacterID },
      buildOptions([instance], ownerBuildCalls),
    ).length,
    1,
  );
  assert.deepEqual(ownerBuildCalls, [INSTANCE_ID]);
});

test("solar-system map rows retain every Frontier dungeon entry-beacon group", () => {
  const entryBeacons = [
    { groupID: 4871, typeID: 91_201, label: "Mining Site" },
    { groupID: 4872, typeID: 91_202, label: "Rift Site" },
    { groupID: 4873, typeID: 91_203, label: "Wreck Site" },
    { groupID: 4874, typeID: 91_204, label: "Landmark Site" },
  ];
  const instances = entryBeacons.map((entry, index) => buildInstance({
    instanceID: INSTANCE_ID + index,
    metadata: {
      anchorItemID: ANCHOR_ITEM_ID,
      entry,
    },
  }));
  const rows = buildDungeonBeaconMapRows(
    SOLAR_SYSTEM_ID,
    { characterID: 140_000_005 },
    {
      dungeonRuntime: {
        listActiveInstancesBySystem: () => instances,
      },
      dungeonVisibilityPolicy: {
        resolveDungeonInstanceVisibilityForSession: () => true,
      },
      dungeonUniverseSiteService: {
        buildSiteEntity: (instance) => {
          const entry = instance.metadata.entry;
          return {
            itemID: BEACON_ITEM_ID + (instance.instanceID - INSTANCE_ID),
            typeID: entry.typeID,
            groupID: entry.groupID,
            itemName: entry.label,
            position: { x: entry.groupID, y: 0, z: 0 },
          };
        },
      },
    },
  );

  assert.deepEqual(rows.map((row) => row.slice(0, 4)), [
    [4871, 91_201, BEACON_ITEM_ID, "Mining Site"],
    [4872, 91_202, BEACON_ITEM_ID + 1, "Rift Site"],
    [4873, 91_203, BEACON_ITEM_ID + 2, "Wreck Site"],
    [4874, 91_204, BEACON_ITEM_ID + 3, "Landmark Site"],
  ]);
});
