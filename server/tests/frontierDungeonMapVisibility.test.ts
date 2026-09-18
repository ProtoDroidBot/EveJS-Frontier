"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const spaceRuntime = require("../src/space/runtime");
const dungeonAuthority = require("../src/services/dungeon/dungeonAuthority");
const dungeonUniverseRuntime = require(
  "../src/services/dungeon/dungeonUniverseRuntime",
);
const dungeonUniverseSiteService = require(
  "../src/services/dungeon/dungeonUniverseSiteService",
);

test("player entry materializes cached dungeons while reconciliation remains scheduled", () => {
  const originalHandleSceneCreated = dungeonUniverseSiteService.handleSceneCreated;
  const scene = { systemID: 30_000_142 };
  const calls: any[] = [];

  dungeonUniverseSiteService.handleSceneCreated = (receivedScene, options) => {
    calls.push({ scene: receivedScene, options });
    return {
      success: true,
      data: { spawned: [{ itemID: 1 }] },
    };
  };

  try {
    const result = spaceRuntime.materializePreparedUniverseSitesForPlayerEntry(
      scene,
      {
        success: true,
        prepared: false,
        scheduled: true,
        sceneExisted: true,
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].scene, scene);
    assert.equal(calls[0].options.force, true);
    assert.deepEqual(result, {
      success: true,
      data: { spawned: [{ itemID: 1 }] },
    });
  } finally {
    dungeonUniverseSiteService.handleSceneCreated = originalHandleSceneCreated;
  }
});

test("player entry does not materialize dungeons after preparation failure", () => {
  const originalHandleSceneCreated = dungeonUniverseSiteService.handleSceneCreated;
  let callCount = 0;
  dungeonUniverseSiteService.handleSceneCreated = () => {
    callCount += 1;
    return null;
  };

  try {
    const result = spaceRuntime.materializePreparedUniverseSitesForPlayerEntry(
      { systemID: 30_000_142 },
      { success: false, prepared: false },
    );
    assert.equal(result, null);
    assert.equal(callCount, 0);
  } finally {
    dungeonUniverseSiteService.handleSceneCreated = originalHandleSceneCreated;
  }
});

test("materialized dungeon roots remain visible as system-view warp anchors", () => {
  const universeRoot = dungeonUniverseSiteService.buildSiteEntity({
    instanceID: 7_100_000_000_001,
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    runtimeFlags: { universeSeeded: true },
    siteKind: "signature",
    siteFamily: "combat",
    position: { x: 101, y: 202, z: 303 },
    metadata: { siteID: 7_200_000_000_001, label: "Ancient Site" },
  });
  const missionRoot = dungeonUniverseSiteService.buildSiteEntity({
    instanceID: 7_100_000_000_002,
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    runtimeFlags: { missionRuntime: true },
    siteKind: "signature",
    siteFamily: "mission",
    position: { x: 404, y: 505, z: 606 },
    metadata: { siteID: 7_200_000_000_002, label: "Mission Site" },
  });

  assert.equal(universeRoot.kind, "universeSignatureSite");
  assert.equal(universeRoot.staticVisibilityScope, "system");
  assert.equal(universeRoot.dungeonMaterializedSiteContent, undefined);
  assert.equal(missionRoot.kind, "missionSite");
  assert.equal(missionRoot.staticVisibilityScope, "system");
  assert.equal(missionRoot.dungeonMaterializedSiteContent, true);
});

test("incompatible dungeon entry objects use a CRDungeon marker type", () => {
  const root = dungeonUniverseSiteService.buildSiteEntity({
    instanceID: 7_100_000_000_003,
    entryObjectTypeID: 29_635,
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    runtimeFlags: { universeSeeded: true },
    siteKind: "signature",
    siteFamily: "combat",
    position: { x: 707, y: 808, z: 909 },
    metadata: { siteID: 7_200_000_000_003, label: "Ruined Gate Site" },
  });

  assert.equal(root.typeID, 19_728);
  assert.equal(root.groupID, 502);
  assert.equal(root.entryObjectTypeID, 29_635);
  assert.equal(root.staticVisibilityScope, "system");
});

test("dungeon spawn labels prefer the dungeon name over generated labels", () => {
  const label = dungeonUniverseSiteService._testing.resolveEntityLabel(
    {
      instanceID: 7_100_000_000_004,
      siteFamily: "combat",
      metadata: { label: "Combat Site 43" },
      spawnState: { label: "Combat Site 43" },
    },
    {
      sourceDungeonID: 43,
      resolvedName: "Pith Merchant Depot",
    },
    {
      typeID: 19_728,
      name: "Cosmic Signature",
    },
  );

  assert.equal(label, "Pith Merchant Depot");
});

test("unnamed dungeon spawn labels use the associated entry type name", () => {
  const label = dungeonUniverseSiteService._testing.resolveEntityLabel(
    {
      instanceID: 7_100_000_000_005,
      siteFamily: "combat",
      metadata: { label: "Combat Site 13874" },
      spawnState: { label: "Combat Site 13874" },
    },
    {
      sourceDungeonID: 13_874,
      resolvedName: "",
    },
    {
      typeID: 10_645,
      name: "Acceleration Gate",
    },
  );

  assert.equal(label, "Acceleration Gate");
});

test("runtime authority indexes every missing Frontier site-group dungeon", () => {
  const payload = dungeonAuthority.mergeFrontierDungeonSpawnTemplates(
    {
      counts: { templateCount: 1 },
      coverage: { totalTemplatesByFamily: { ore: 1 } },
      indexes: {},
      templatesByID: {
        "client-dungeon:201": {
          templateID: "client-dungeon:201",
          source: "client",
          sourceDungeonID: 201,
          siteFamily: "ore",
          siteKind: "anomaly",
          archetypeID: 27,
          entryObjectTypeID: 1001,
        },
      },
    },
    [
      {
        dungeonID: 201,
        dungeonName: "Existing Mining Site",
        entryObjectID: 8_001,
        entryTypeID: 1001,
        rooms: [{
          roomID: 9_001,
          objects: [{ objectID: 8_001, typeID: 1001, role: "scenery" }],
        }],
        triggers: [{ triggerID: 7_001, triggerEvents: [] }],
      },
      { dungeonID: 202, entryTypeID: 1002 },
      { dungeonID: 203, entryTypeID: 1003 },
      { dungeonID: 204, entryTypeID: 1004 },
    ],
    [
      { typeID: 1001, groupID: 4871 },
      { typeID: 1002, groupID: 4872 },
      { typeID: 1003, groupID: 4873 },
      { typeID: 1004, groupID: 4874 },
    ],
  );

  assert.equal(payload.counts.templateCount, 4);
  assert.equal(payload.counts.frontierDungeonSynthesizedTemplateCount, 3);
  assert.deepEqual(
    Object.keys(payload.templatesByID).sort(),
    [
      "client-dungeon:201",
      "frontier-dungeon:202",
      "frontier-dungeon:203",
      "frontier-dungeon:204",
    ],
  );
  assert.equal(
    payload.indexes.templateIDsBySourceDungeonID["204"],
    "frontier-dungeon:204",
  );
  assert.equal(payload.counts.frontierDungeonHydratedTemplateCount, 1);
  assert.equal(payload.templatesByID["client-dungeon:201"].frontierDungeonHydrated, true);
  assert.equal(payload.templatesByID["client-dungeon:201"].entryObjectGroupID, 4871);
  assert.equal(payload.templatesByID["client-dungeon:201"].siteFamily, "combat");
  assert.equal(payload.templatesByID["client-dungeon:201"].siteKind, "anomaly");
  assert.equal(payload.templatesByID["client-dungeon:201"].difficulty, 1);
  assert.equal(payload.templatesByID["client-dungeon:201"].entryObjectID, 8_001);
  assert.equal(payload.templatesByID["client-dungeon:201"].rooms.length, 1);
  assert.equal(payload.templatesByID["client-dungeon:201"].triggers.length, 1);
  assert.deepEqual(
    payload.indexes.templateIDsByFamily.combat,
    [
      "client-dungeon:201",
      "frontier-dungeon:202",
      "frontier-dungeon:203",
      "frontier-dungeon:204",
    ],
  );
  assert.equal(payload.indexes.templateIDsByFamily.ore, undefined);
});

test("raw Frontier rooms compile into initial site content for all supported dungeon groups", () => {
  for (const entryObjectGroupID of [4871, 4872, 4873, 4874]) {
    const sourceDungeonID = 20_000 + entryObjectGroupID;
    const hints = dungeonUniverseSiteService._testing.resolvePopulationHints(
      {
        instanceID: 7_100_000_100_000 + entryObjectGroupID,
        spawnState: {
          populationHints: {
            objectiveMarkers: [{ label: "Retained authored objective" }],
          },
        },
      },
      {
        sourceDungeonID,
        entryObjectGroupID,
        entryObjectID: 101,
        rooms: [{
          roomID: 501,
          position: { x: 1_000, y: 2_000, z: 3_000 },
          objects: [
            {
              objectID: 101,
              typeID: 1_001,
              role: "scenery",
              position: { x: 100, y: 200, z: 300 },
            },
            {
              objectID: 102,
              typeID: 1_002,
              role: "scenery",
              position: { x: 150, y: 180, z: 330 },
              yaw: 10,
              pitch: 20,
              roll: 30,
            },
            {
              objectID: 103,
              typeID: 1_003,
              role: "scenery",
              position: { x: 200, y: 200, z: 300 },
            },
            {
              objectID: 104,
              typeID: 1_004,
              role: "eventLocator",
              position: { x: 300, y: 200, z: 300 },
            },
          ],
        }],
        triggers: [{
          triggerEvents: [{ eventTypeID: 3, objectID: 103 }],
        }],
      },
    );

    assert.equal(hints.frontierDungeonScene, true);
    assert.equal(hints.roomCount, 1);
    assert.deepEqual(hints.objectiveMarkers, [{ label: "Retained authored objective" }]);
    assert.equal(hints.environmentProps.length, 1);
    assert.deepEqual(hints.environmentProps[0], {
      authoredRadius: null,
      dunObjectID: 102,
      dunObjectNameID: undefined,
      dunRotation: [10, 20, 30],
      dungeonObjectGroupTag: null,
      dungeonObjectLocalName: null,
      exact: true,
      frontierDungeonResource: false,
      frontierRiftFormation: null,
      frontierRiftYieldTier: null,
      key: `frontier-dungeon:${sourceDungeonID}:501:102`,
      miningYieldTypeID: null,
      positionOffset: { x: 50, y: -20, z: 30 },
      resourceQuantity: null,
      suppressSlimGraphicID: true,
      suppressSlimName: true,
      typeID: 1_002,
    });
    assert.equal(hints.exactContentCaps.environmentProps, 1);
  }
});

test("an explicit exact Frontier content plan takes precedence over raw room derivation", () => {
  const explicitProp = {
    exact: true,
    key: "precompiled:prop",
    positionOffset: { x: 1, y: 2, z: 3 },
    typeID: 9_001,
  };
  const hints = dungeonUniverseSiteService._testing.resolvePopulationHints(
    {
      instanceID: 7_100_000_200_001,
      spawnState: {
        populationHints: {
          environmentProps: [explicitProp],
          exactContentCaps: { environmentProps: 1 },
        },
      },
    },
    {
      sourceDungeonID: 30_001,
      entryObjectGroupID: 4873,
      entryObjectID: 201,
      rooms: [{
        roomID: 601,
        objects: [
          { objectID: 201, typeID: 2_001, role: "scenery" },
          { objectID: 202, typeID: 2_002, role: "scenery" },
        ],
      }],
    },
  );

  assert.deepEqual(hints.environmentProps, [explicitProp]);
  assert.equal(hints.frontierDungeonScene, true);
});

test("the visible Frontier baseline does not alter unrelated ore allocation", () => {
  const regularSiteCount = dungeonUniverseRuntime._testing.resolveUniverseDungeonSlotsPerSystem(
    "combat_anomaly",
    30_000_142,
    { allocationMode: "baseline", slotsPerSystem: 1 },
  );
  const miningSiteCount = dungeonUniverseRuntime._testing.resolveUniverseDungeonSlotsPerSystem(
    "ore",
    30_000_142,
    { allocationMode: "random", slotsPerSystem: 1 },
  );

  assert.ok(regularSiteCount >= 3 && regularSiteCount <= 5);
  assert.equal(miningSiteCount, 1);
});
