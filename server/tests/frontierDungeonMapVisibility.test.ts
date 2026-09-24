"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const config = require("../src/config");
const spaceRuntime = require("../src/space/runtime");
const asteroidService = require("../src/space/asteroids");
const dungeonAuthority = require("../src/services/dungeon/dungeonAuthority");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
const dungeonUniverseRuntime = require(
  "../src/services/dungeon/dungeonUniverseRuntime",
);
const dungeonUniverseSiteService = require(
  "../src/services/dungeon/dungeonUniverseSiteService",
);
const miningResourceSiteService = require(
  "../src/services/mining/miningResourceSiteService",
);
const miningRuntimeState = require(
  "../src/services/mining/miningRuntimeState",
);
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const {
  resolveMiningResourceIdentity,
} = require("../src/services/mining/miningVisuals");

test("Frontier resource outputs resolve to their default mineable carrier identity", () => {
  const charIdentity = resolveMiningResourceIdentity({
    typeID: 77_800,
    groupID: 5_012,
    categoryID: 25,
    name: "Feldspar Crystals",
  });
  const slagIdentity = resolveMiningResourceIdentity({
    typeID: 77_810,
    groupID: 5_013,
    categoryID: 25,
    name: "Platinum-Palladium Matrix",
  });

  assert.equal(charIdentity.carrierTypeRecord.typeID, 91_374);
  assert.equal(charIdentity.carrierTypeRecord.name, "Char");
  assert.equal(charIdentity.yieldTypeRecord.typeID, 77_800);
  assert.equal(slagIdentity.carrierTypeRecord.typeID, 91_375);
  assert.equal(slagIdentity.carrierTypeRecord.name, "Slag");
  assert.equal(slagIdentity.yieldTypeRecord.typeID, 77_810);

  const carrierIdentity = resolveMiningResourceIdentity({
    typeID: 91_374,
    groupID: 5_004,
    categoryID: 25,
    name: "Char",
  });
  assert.equal(carrierIdentity.carrierTypeRecord.name, "Char");
  assert.equal(carrierIdentity.yieldTypeRecord.typeID, 77_800);
});

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

test("an NPC warp target initializes its exact dungeon without a player session", () => {
  const originalGetInstance = dungeonRuntime.getInstance;
  const originalIsManaged =
    dungeonUniverseSiteService.isManagedMaterializedSiteInstance;
  const originalEnsure = dungeonUniverseSiteService.ensureSiteContentsMaterialized;
  const instanceID = 7_100_000_000_101;
  const siteID = 7_200_000_000_101;
  const siteEntity = {
    itemID: siteID,
    kind: "universeAnomalySite",
    signalTrackerUniverseSeededSite: true,
    dungeonSiteInstanceID: instanceID,
    dungeonSiteID: siteID,
    position: { x: 2_000_000, y: 0, z: 0 },
  };
  const scene = {
    systemID: 30_000_142,
    _asteroidFieldsInitialized: true,
    _miningResourceSitesInitialized: true,
    _miningRuntimeState: {},
    getCurrentSimTimeMs: () => 75_000,
    getEntityByID: (entityID) => entityID === siteID ? siteEntity : null,
  };
  const materializeCalls: any[] = [];

  dungeonRuntime.getInstance = (receivedInstanceID) => (
    receivedInstanceID === instanceID ? { instanceID } : null
  );
  dungeonUniverseSiteService.isManagedMaterializedSiteInstance = () => true;
  dungeonUniverseSiteService.ensureSiteContentsMaterialized = (
    receivedScene,
    instance,
    options,
  ) => {
    materializeCalls.push({ receivedScene, instance, options });
    return { success: true, data: { spawned: [] } };
  };

  try {
    const result = spaceRuntime._testing
      .initializeSessionlessWarpDestinationForTesting(
        scene,
        { itemID: 9_000_000_101, kind: "ship" },
        siteEntity.position,
        { targetEntityID: siteID, nowMs: 75_000 },
      );

    assert.equal(result.success, true);
    assert.equal(result.data.dungeonInstanceID, instanceID);
    assert.equal(materializeCalls.length, 1);
    assert.equal(materializeCalls[0].receivedScene, scene);
    assert.equal(materializeCalls[0].instance.instanceID, instanceID);
    assert.equal(materializeCalls[0].options.session, null);
    assert.equal(materializeCalls[0].options.broadcast, true);
    assert.equal(materializeCalls[0].options.spawnEncounters, true);
  } finally {
    dungeonRuntime.getInstance = originalGetInstance;
    dungeonUniverseSiteService.isManagedMaterializedSiteInstance =
      originalIsManaged;
    dungeonUniverseSiteService.ensureSiteContentsMaterialized = originalEnsure;
  }
});

test("an NPC warp to a celestial initializes lazy asteroid and mining state", () => {
  const originalMiningEnabled = config.miningEnabled;
  const originalAsteroidHandle = asteroidService.handleSceneCreated;
  const originalMiningSiteHandle = miningResourceSiteService.handleSceneCreated;
  const originalEnsureMiningState = miningRuntimeState.ensureSceneMiningState;
  const celestialID = 40_000_001;
  const celestial = {
    itemID: celestialID,
    kind: "planet",
    position: { x: 4_000_000, y: 0, z: 0 },
  };
  const scene: Record<string, any> = {
    systemID: 30_000_142,
    staticEntities: [celestial],
    getCurrentSimTimeMs: () => 80_000,
    getEntityByID: (entityID) => entityID === celestialID ? celestial : null,
  };
  const calls: string[] = [];

  config.miningEnabled = true;
  asteroidService.handleSceneCreated = (receivedScene) => {
    calls.push("asteroids");
    receivedScene._asteroidFieldsInitialized = true;
    return { success: true, data: { spawned: [] } };
  };
  miningResourceSiteService.handleSceneCreated = (receivedScene) => {
    calls.push("mining-sites");
    receivedScene._miningResourceSitesInitialized = true;
    return { success: true, data: { spawned: [] } };
  };
  miningRuntimeState.ensureSceneMiningState = (receivedScene) => {
    calls.push("mining-state");
    receivedScene._miningRuntimeState = { byEntityID: new Map() };
    return receivedScene._miningRuntimeState;
  };

  try {
    const result = spaceRuntime._testing
      .initializeSessionlessWarpDestinationForTesting(
        scene,
        { itemID: 9_000_000_102, kind: "ship" },
        celestial.position,
        { targetEntityID: celestialID, nowMs: 80_000 },
      );

    assert.equal(result.success, true);
    assert.deepEqual(calls, ["asteroids", "mining-sites", "mining-state"]);
    assert.equal(result.data.asteroidFieldsInitialized, true);
    assert.equal(result.data.miningSitesInitialized, true);
    assert.equal(result.data.miningStateInitialized, true);
  } finally {
    config.miningEnabled = originalMiningEnabled;
    asteroidService.handleSceneCreated = originalAsteroidHandle;
    miningResourceSiteService.handleSceneCreated = originalMiningSiteHandle;
    miningRuntimeState.ensureSceneMiningState = originalEnsureMiningState;
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

test("scene startup materializes the same oldest duplicate anchor used by the map", () => {
  const originalListActiveInstancesBySystem = dungeonRuntime.listActiveInstancesBySystem;
  const siteKey = "sceneanomalysite:30000142:5380000142001";
  const siteID = 5_380_000_142_001;
  const older = {
    instanceID: 81,
    siteKey,
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    runtimeFlags: { universeSeeded: true },
    siteKind: "anomaly",
    siteFamily: "combat",
    position: { x: 101, y: 202, z: 303 },
    metadata: { siteID, label: "Stable Dungeon" },
  };
  const newer = {
    ...older,
    instanceID: 82,
    position: { x: 901, y: 902, z: 903 },
  };
  const spawned: any[] = [];
  const scene = {
    systemID: 30_000_142,
    addStaticEntity(entity) {
      spawned.push(entity);
      return true;
    },
  };

  dungeonRuntime.listActiveInstancesBySystem = () => [newer, older];
  try {
    const result = dungeonUniverseSiteService.handleSceneCreated(scene, { force: true });

    assert.equal(result.success, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].itemID, siteID);
    assert.equal(spawned[0].dungeonSiteInstanceID, older.instanceID);
    assert.deepEqual(spawned[0].position, older.position);
  } finally {
    dungeonRuntime.listActiveInstancesBySystem = originalListActiveInstancesBySystem;
  }
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

test("runtime authority retains extracted Frontier templates but indexes only unified-config sites", () => {
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
  assert.equal(payload.counts.frontierDungeonConfiguredTemplateCount, 0);
  assert.equal(payload.templatesByID["client-dungeon:201"].frontierDungeonHydrated, true);
  assert.equal(payload.templatesByID["client-dungeon:201"].entryObjectGroupID, 4871);
  assert.equal(payload.templatesByID["client-dungeon:201"].siteFamily, "combat");
  assert.equal(payload.templatesByID["client-dungeon:201"].siteKind, "anomaly");
  assert.equal(payload.templatesByID["client-dungeon:201"].difficulty, 1);
  assert.equal(payload.templatesByID["client-dungeon:201"].entryObjectID, 8_001);
  assert.equal(payload.templatesByID["client-dungeon:201"].rooms.length, 1);
  assert.equal(payload.templatesByID["client-dungeon:201"].triggers.length, 1);
  assert.equal(payload.indexes.templateIDsByFamily.combat, undefined);
  assert.equal(payload.indexes.templateIDsByFamily.ore, undefined);
});

test("invalid Frontier prefab wrappers never enter world-spawn family indexes", () => {
  const templateID = "client-dungeon:13582";
  const payload = dungeonAuthority.mergeFrontierDungeonSpawnTemplates(
    {
      counts: { templateCount: 1 },
      coverage: {},
      indexes: {},
      templatesByID: {
        [templateID]: {
          templateID,
          source: "client",
          sourceDungeonID: 13_582,
          siteFamily: "combat",
          siteKind: "anomaly",
          entryObjectTypeID: 88_328,
        },
      },
    },
    [{
      dungeonID: 13_582,
      dungeonName: "Feral Moon Tumor P2",
      entryObjectID: 1_265_243,
      entryTypeID: 88_328,
      rooms: [{
        roomID: 29_704,
        objects: [{ objectID: 1_233_317, typeID: 83_407, role: "scenery" }],
      }],
    }],
    [{ typeID: 88_328, groupID: 4871 }],
  );

  assert.ok(payload.templatesByID[templateID], "exact references remain resolvable");
  assert.equal(payload.templatesByID[templateID].frontierDungeonHydrated, undefined);
  assert.equal(payload.templatesByID[templateID].frontierDungeonSpawnConfigured, undefined);
  assert.equal(
    Object.values<any>(payload.indexes.templateIDsByFamily || {})
      .flat()
      .includes(templateID),
    false,
    "invalid standalone templates must not be selectable or queued for world spawning",
  );
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
      positionOffset: { x: 0, y: 0, z: 0 },
      resourceQuantity: null,
      suppressSlimGraphicID: true,
      suppressSlimName: true,
      typeID: 1_002,
    });
    assert.equal(hints.exactContentCaps.environmentProps, 1);
  }
});

test("initial Frontier scenery triggers materialize props without exposing deferred or NPC targets", () => {
  const template = {
    sourceDungeonID: 12_709,
    entryObjectGroupID: 4_873,
    entryObjectID: 101,
    rooms: [{
      roomID: 501,
      objects: [
        { objectID: 101, typeID: 1_001, role: "scenery" },
        { objectID: 102, typeID: 87_998, role: "scenery" },
        {
          objectID: 103,
          typeID: 84_666,
          role: "scenery",
          guardCommand: { objectTriggerSpawn: 0 },
        },
        {
          objectID: 104,
          typeID: 89_076,
          role: "scenery",
          guardCommand: { objectTriggerSpawn: 1 },
        },
        {
          objectID: 105,
          typeID: 89_076,
          role: "scenery",
          guardCommand: { objectTriggerSpawn: 1 },
        },
        {
          objectID: 106,
          typeID: 83_552,
          role: "scenery",
          guardCommand: { objectTriggerSpawn: 1 },
        },
        { objectID: 107, typeID: 54_266, role: "eventLocator" },
      ],
    }],
    triggers: [
      {
        triggerID: 7_001,
        triggerTypeID: 8,
        objectID: 107,
        groupTag: "Entry Roll",
        usageChance: 100,
        triggerEvents: [
          { eventID: 8_001, eventTypeID: 15, objectID: 103, usageChance: 100 },
          { eventID: 8_002, eventTypeID: 3, objectID: 104, usageChance: 100 },
          { eventID: 8_003, eventTypeID: 3, objectID: 106, usageChance: 100 },
        ],
      },
      {
        triggerID: 7_002,
        triggerTypeID: 31,
        objectID: 107,
        groupTag: "Completion",
        usageChance: 100,
        triggerEvents: [
          { eventID: 8_004, eventTypeID: 3, objectID: 105, usageChance: 100 },
        ],
      },
    ],
  };
  const instance = {
    instanceID: 7_100_000_127_009,
    metadata: { siteID: 7_200_000_127_009 },
  };

  const first = dungeonUniverseSiteService._testing.resolvePopulationHints(
    instance,
    template,
  );
  const second = dungeonUniverseSiteService._testing.resolvePopulationHints(
    instance,
    template,
  );
  const environmentObjectIDs = first.environmentProps.map((entry) => entry.dunObjectID);
  const containerObjectIDs = first.containers.map((entry) => entry.dunObjectID);
  const materializedObjectIDs = [...environmentObjectIDs, ...containerObjectIDs];

  assert.deepEqual(environmentObjectIDs, [102]);
  assert.deepEqual(containerObjectIDs, [104]);
  assert.equal(materializedObjectIDs.includes(103), false, "despawn event removes the default cloud");
  assert.equal(materializedObjectIDs.includes(105), false, "completion prop remains deferred");
  assert.equal(materializedObjectIDs.includes(106), false, "NPC controller remains encounter-only");
  assert.deepEqual(second.environmentProps, first.environmentProps);
});

test("Frontier mining dungeon asteroids have stable variable sizes and size-weighted material", () => {
  const resources = [201, 202, 203].map((objectID) => ({
    objectID,
    roomID: 501,
    categoryID: 25,
    groupID: 5_005,
    typeRecord: {
      radius: 1,
      volume: 1,
    },
    object: {
      objectID,
      radius: 100_000,
    },
  }));
  const first = dungeonUniverseSiteService._testing
    .buildFrontierDungeonMiningResourceSizing(resources, 91_871);
  const second = dungeonUniverseSiteService._testing
    .buildFrontierDungeonMiningResourceSizing(resources, 91_871);
  const sortedByRadius = [...first.entries()]
    .map(([objectID, sizing]) => ({ objectID, ...sizing }))
    .sort((left, right) => left.radius - right.radius);
  const config = require("../src/config");
  assert.deepEqual(second, first);
  assert.deepEqual(
    sortedByRadius.map((entry) => entry.radius),
    [30_000, 40_000, 50_000],
  );
  assert.deepEqual(
    sortedByRadius.map((entry) => entry.resourceQuantity),
    [30_000, 40_000, 50_000].map((radius) => Math.round(
      config.miningBeltMaximumAsteroidVolumeM3 * (radius / 50_000) ** 2,
    )),
  );
});

test("Metal-Rich Cluster Slag uses bounded radius and matching yield through site materialization", (t) => {
  itemTypeRegistry._setEntriesForTests([
    { typeID: 83_739, name: "Metal-Rich Cluster", groupID: 4_871, categoryID: 2, radius: 1 },
    { typeID: 91_375, name: "Slag", groupID: 5_005, categoryID: 25, radius: 1, volume: 1 },
  ]);
  t.after(() => itemTypeRegistry._setEntriesForTests(null));

  const template = {
    sourceDungeonID: 10_403,
    entryTypeID: 83_739,
    entryObjectID: 1_236_542,
    rooms: [{
      roomID: 29_411,
      objects: [
        { objectID: 1_236_542, typeID: 83_739, role: "scenery" },
        { objectID: 1_178_662, typeID: 91_375, role: "scenery", radius: 125_000 },
        { objectID: 1_261_141, typeID: 91_375, role: "scenery", radius: 125_000 },
      ],
    }],
  };
  const instance = { instanceID: 7_100_000_010_403 };
  const siteEntity = { itemID: 7_200_000_010_403, position: { x: 0, y: 0, z: 0 } };
  const hints = dungeonUniverseSiteService._testing.resolvePopulationHints(instance, template);
  const entities = dungeonUniverseSiteService._testing
    .buildEnvironmentEntities(instance, siteEntity, template, hints)
    .sort((left, right) => left.radius - right.radius);

  assert.deepEqual(entities.map((entity) => entity.radius), [30_000, 50_000]);
  assert.deepEqual(entities.map((entity) => entity.resourceQuantity), [1_080_000, 3_000_000]);
  assert.ok(entities.every((entity) => entity.frontierDungeonResource === true));
});

test("Frontier mining dungeon sizing bounds small rocks and accounts for ore unit volume", () => {
  const resource = {
    objectID: 301,
    roomID: 501,
    categoryID: 25,
    groupID: 5_005,
    typeRecord: { radius: 500, volume: 2 },
    object: { objectID: 301, radius: 500 },
  };
  const sizing = dungeonUniverseSiteService._testing
    .buildFrontierDungeonMiningResourceSizing([resource], 91_871).get(301);

  assert.ok(sizing.radius >= 10_000 && sizing.radius <= 50_000);
  assert.equal(
    sizing.resourceQuantity,
    Math.round(require("../src/config").miningBeltMaximumAsteroidVolumeM3 *
      (sizing.radius / 50_000) ** 2 / 2),
  );
});

test("Frontier mining dungeon resources preserve their derived size during mining registration", () => {
  const siteEntity = {
    itemID: 7_200_000_000_321,
    groupID: 4_871,
    position: { x: 1_000, y: 2_000, z: 3_000 },
  };
  const environmentEntities = dungeonUniverseSiteService._testing
    .buildEnvironmentEntities(
      { instanceID: 7_100_000_000_321 },
      siteEntity,
      {},
      {
        frontierDungeonScene: true,
        exactContentCaps: { environmentProps: 1 },
        environmentProps: [{
          exact: true,
          key: "frontier-dungeon:mining-resource:1",
          // Type 34 is present in the minimal item-registry fallback used by
          // isolated tests; the explicit resource marker drives this policy.
          typeID: 34,
          miningYieldTypeID: 34,
          frontierDungeonResource: true,
          authoredRadius: 75_000,
          resourceQuantity: 150_000,
          positionOffset: { x: 10, y: 20, z: 30 },
          suppressSlimGraphicID: true,
          suppressSlimName: true,
        }],
      },
    );

  assert.equal(environmentEntities.length, 1);
  assert.equal(environmentEntities[0].radius, 50_000);
  assert.notEqual(environmentEntities[0].typeID, 34);
  assert.equal(environmentEntities[0].graphicID, 26_271);
  assert.equal(environmentEntities[0].slimTypeID, 34);
  assert.equal(environmentEntities[0].slimGroupID, 18);
  assert.equal(environmentEntities[0].slimCategoryID, 4);
  assert.equal(environmentEntities[0].itemName, "Tritanium [Type ID 34]");
  assert.equal(environmentEntities[0].slimName, "Tritanium [Type ID 34]");
  assert.equal(environmentEntities[0].suppressSlimName, false);
  assert.ok(environmentEntities[0].collisionScale > 1);
  assert.equal(environmentEntities[0].resourceQuantity, 66_667);
  assert.equal(environmentEntities[0].skipMiningTemplateResolution, true);
  assert.equal(environmentEntities[0].preserveMiningVisualPresentation, true);
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
