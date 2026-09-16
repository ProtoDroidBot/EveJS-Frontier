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
