"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const frontierDungeonSpawns = require("../src/config/frontierDungeonSpawns");
const frontierDungeonLoot = require("../src/config/frontierDungeonLoot");
for (const [catalogPath, exportName] of [
  ["../src/space/npc/capitals/capitalNpcCatalog", "getCapitalNpcGeneratedRows"],
  ["../src/space/npc/trigDrifter/trigDrifterNpcCatalog", "getTrigDrifterGeneratedRows"],
  ["../src/space/npc/empireSecurity/empireSecurityNpcCatalog", "getEmpireSecurityGeneratedRows"],
]) {
  require(catalogPath)[exportName] = () => [];
}
const npcData = require("../src/space/npc/npcData");
const dungeonUniverseSiteService = require(
  "../src/services/dungeon/dungeonUniverseSiteService",
);
const dungeonUniverseRuntime = require(
  "../src/services/dungeon/dungeonUniverseRuntime",
);
const {
  LIGHT_SECOND_METERS,
} = require("../src/services/dungeon/dungeonSpawnEligibility");
const dungeonRuntimeState = require("../src/services/dungeon/dungeonRuntimeState");
const deadspaceWarpPolicy = require(
  "../src/services/dungeon/deadspaceWarpPolicy",
);
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const nativeNpcWreckService = require("../src/space/npc/nativeNpcWreckService");
const mobileAnalysisBeaconRuntime = require(
  "../src/services/ship/mobileAnalysisBeaconRuntime",
);

function buildControllerTemplate(sourceDungeonID, entryObjectTypeID, controllerTypeID): any {
  return {
    templateID: `frontier-dungeon:${sourceDungeonID}`,
    sourceDungeonID,
    entryObjectGroupID: 4_873,
    entryObjectID: 100,
    entryObjectTypeID,
    siteFamily: "combat",
    siteKind: "anomaly",
    rooms: [{
      roomID: 10,
      position: { x: 1_000, y: 2_000, z: 3_000 },
      objects: [
        {
          objectID: 100,
          typeID: entryObjectTypeID,
          role: "scenery",
          position: { x: 0, y: 0, z: 0 },
        },
        {
          objectID: 200,
          typeID: controllerTypeID,
          role: "scenery",
          position: { x: 10_000, y: 0, z: 0 },
          objectTriggerSpawn: false,
          tinyint_1: 4,
        },
      ],
    }],
    triggers: [],
  };
}

test("Frontier dungeon spawn config loads with the analyzed sites and controller types", () => {
  const config = frontierDungeonSpawns.getConfig();
  const summary = frontierDungeonSpawns.getConfigSummary();

  assert.equal(config.schemaVersion, 2);
  assert.equal(config.enabled, true);
  assert.equal(Object.keys(config.sites).length, 49);
  assert.equal(Object.keys(config.spawnerTypes).length, 16);
  assert.equal(Object.keys(config.hiveSpawns).length, 7);
  assert.equal(summary.hiveSpawnTypeCount, 7);
  assert.equal(summary.schemaVersion, config.schemaVersion);
  assert.equal(summary.enabled, true);
  assert.deepEqual(config.defaults.siteSeparationLightSeconds, { min: 1, max: 10 });
  assert.deepEqual(config.defaults.warpIn, {
    boundaryRadiusMeters: 250_000,
    collisionClearanceMeters: 10_000,
  });
  assert.equal(
    summary.configuredSiteCount ?? summary.siteCount,
    Object.keys(config.sites).length,
  );
  for (const site of Object.values<any>(config.sites)) {
    assert.ok(site.spawnFrequency > 0);
    assert.ok(site.placementDistanceAu.min >= 0);
    assert.ok(site.placementDistanceAu.max >= site.placementDistanceAu.min);
    assert.ok(site.separationLightSeconds.min >= 1);
    assert.ok(site.separationLightSeconds.max <= 10);
    assert.deepEqual(site.warpIn, config.defaults.warpIn);
  }
});

test("dungeon warp-in resolves to the approach-side boundary clear of site objects", () => {
  const instance = {
    instanceID: 91_000_001,
    position: { x: 1_000_000, y: 2_000_000, z: 3_000_000 },
    frontierDungeonWarpIn: {
      boundaryRadiusMeters: 100_000,
      collisionClearanceMeters: 5_000,
    },
  };
  const ship = {
    itemID: 92_000_001,
    kind: "ship",
    position: { x: 2_000_000, y: 2_000_000, z: 3_000_000 },
    radius: 100,
  };
  const boundaryObject = {
    itemID: 93_000_001,
    dungeonSiteInstanceID: instance.instanceID,
    position: { x: 1_105_100, y: 2_000_000, z: 3_000_000 },
    radius: 20_000,
  };
  const point = deadspaceWarpPolicy.resolveSiteWarpInPoint(instance, ship, {
    staticEntities: [boundaryObject],
    dynamicEntities: new Map(),
  });

  assert.ok(point.x > boundaryObject.position.x);
  assert.equal(point.y, instance.position.y);
  assert.equal(point.z, instance.position.z);
  assert.ok(
    point.x - boundaryObject.position.x >=
      boundaryObject.radius + ship.radius + instance.frontierDungeonWarpIn.collisionClearanceMeters,
  );
  assert.ok(
    point.x - instance.position.x >=
      instance.frontierDungeonWarpIn.boundaryRadiusMeters +
      ship.radius +
      instance.frontierDungeonWarpIn.collisionClearanceMeters,
  );
});

test("deadspace clamp uses the safe boundary point instead of the dungeon anchor", () => {
  const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
  const originalListActiveInstancesBySystem = dungeonRuntime.listActiveInstancesBySystem;
  const instance = {
    instanceID: 91_000_002,
    solarSystemID: 30_000_142,
    position: { x: 10_000, y: 20_000, z: 30_000 },
    frontierDungeonWarpIn: {
      boundaryRadiusMeters: 120_000,
      collisionClearanceMeters: 8_000,
    },
  };
  dungeonRuntime.listActiveInstancesBySystem = () => [instance];
  try {
    const decision = deadspaceWarpPolicy.evaluateDeadspaceWarp(
      {
        itemID: 92_000_002,
        kind: "ship",
        systemID: instance.solarSystemID,
        position: { x: 1_010_000, y: 20_000, z: 30_000 },
        radius: 75,
      },
      instance.position,
      {},
      { staticEntities: [], dynamicEntities: new Map() },
    );

    assert.equal(decision.action, "clamp");
    assert.equal(decision.siteInstanceID, instance.instanceID);
    assert.deepEqual(decision.point, {
      x: instance.position.x + 128_075,
      y: instance.position.y,
      z: instance.position.z,
    });
    assert.notDeepEqual(decision.point, instance.position);
  } finally {
    dungeonRuntime.listActiveInstancesBySystem = originalListActiveInstancesBySystem;
  }
});

test("deadspace clamp selects the nearest site when logical deadspace regions overlap", () => {
  const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
  const originalListActiveInstancesBySystem = dungeonRuntime.listActiveInstancesBySystem;
  const fartherInstance = {
    instanceID: 91_000_003,
    position: { x: 250_000_000, y: 0, z: 0 },
  };
  const targetInstance = {
    instanceID: 91_000_004,
    position: { x: 0, y: 0, z: 0 },
  };
  dungeonRuntime.listActiveInstancesBySystem = () => [fartherInstance, targetInstance];
  try {
    const decision = deadspaceWarpPolicy.evaluateDeadspaceWarp(
      {
        itemID: 92_000_003,
        kind: "ship",
        systemID: 30_000_142,
        position: { x: -2_000_000_000, y: 0, z: 0 },
        radius: 50,
      },
      targetInstance.position,
      {},
      { staticEntities: [], dynamicEntities: new Map() },
    );

    assert.equal(decision.action, "clamp");
    assert.equal(decision.siteInstanceID, targetInstance.instanceID);
  } finally {
    dungeonRuntime.listActiveInstancesBySystem = originalListActiveInstancesBySystem;
  }
});

test("Frontier dungeon loot config keeps cargo-container and wreck tables separate", () => {
  const config = frontierDungeonLoot.getConfig();
  const summary = frontierDungeonLoot.getConfigSummary();
  const cargoMappings = config.typeMappings.cargoContainers;
  const wreckMappings = config.typeMappings.wrecks;

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.enabled, true);
  assert.equal(summary.lootTableCount, Object.keys(config.lootTables).length);
  assert.equal(summary.cargoContainerTypeCount, Object.keys(cargoMappings).length);
  assert.equal(summary.wreckTypeCount, Object.keys(wreckMappings).length);
  assert.ok(summary.lootTableCount >= 48);
  assert.ok(summary.cargoContainerTypeCount >= 56);
  assert.ok(summary.wreckTypeCount >= 16);
  assert.equal(cargoMappings[88_827], "frontier_container_secured_storage_silo");
  assert.equal(cargoMappings[91_230], "frontier_container_unremarkable_storage_silo");
  assert.equal(cargoMappings[87_373], "frontier_salvage_freighter_wreck");
  assert.equal(wreckMappings[34_884], "frontier_wreck_freighter_ore");
  assert.equal(
    Object.values(cargoMappings).some((lootTableID) => (
      Object.values(wreckMappings).includes(lootTableID)
    )),
    false,
  );
});

test("authored storage and wreck-like objects materialize as exact loot containers", () => {
  const template = {
    sourceDungeonID: 10_444,
    entryObjectGroupID: 4_873,
    entryObjectID: 100,
    rooms: [{
      roomID: 10,
      position: { x: 1_000, y: 2_000, z: 3_000 },
      objects: [
        {
          objectID: 100,
          typeID: 83_875,
          role: "scenery",
          position: { x: 100, y: 200, z: 300 },
        },
        {
          objectID: 200,
          typeID: 88_827,
          role: "scenery",
          localName: "Secured Storage Silo",
          position: { x: 4_100, y: 5_200, z: 6_300 },
        },
        {
          objectID: 201,
          typeID: 87_373,
          role: "scenery",
          localName: "Freighter Wreck",
          position: { x: -1_900, y: 2_200, z: 300 },
        },
      ],
    }],
    triggers: [],
  };
  const hints = dungeonUniverseSiteService._testing
    .buildFrontierDungeonDerivedPopulationHints(template);

  assert.equal(hints.containers.length, 2);
  assert.equal(hints.environmentProps.length, 0);
  assert.equal(hints.exactContentCaps.containers, 2);
  assert.deepEqual(
    hints.containers.map((entry) => entry.dunObjectID),
    [200, 201],
  );
  assert.deepEqual(hints.containers[0].positionOffset, { x: 4_000, y: 5_000, z: 6_000 });
  assert.deepEqual(hints.containers[1].positionOffset, { x: -2_000, y: 2_000, z: 0 });

  const entities = dungeonUniverseSiteService._testing.buildContainerEntities(
    { instanceID: 7_100_000_000_200, metadata: { siteID: 7_200_000_000_200 } },
    { itemID: 7_200_000_000_200, position: { x: 100_000, y: 200_000, z: 300_000 } },
    hints,
  );
  assert.deepEqual(entities.map((entry) => entry.typeID), [88_827, 87_373]);
  assert.deepEqual(entities[0].position, { x: 104_000, y: 205_000, z: 306_000 });
  assert.deepEqual(entities[1].position, { x: 98_000, y: 202_000, z: 300_000 });
});

test("type-ID loot mappings register their tables with NPC loot data", () => {
  const sensorContainer = frontierDungeonLoot.resolveCargoContainerLootTable(99_009);
  const rogueLargeWreck = frontierDungeonLoot.resolveWreckLootTable({ typeID: 26_593 });

  assert.ok(sensorContainer);
  assert.equal(sensorContainer.lootTableID, "frontier_container_sensor_component_a");
  assert.deepEqual(
    sensorContainer.lootTable.entries.map((entry) => entry.typeID),
    [99_005],
  );
  assert.ok(rogueLargeWreck);
  assert.equal(rogueLargeWreck.lootTableID, "frontier_wreck_rogue_large");
  assert.deepEqual(
    rogueLargeWreck.lootTable.entries.map((entry) => entry.typeID),
    [25_600, 25_615, 25_624, 28_363],
  );
  assert.deepEqual(
    npcData.getNpcLootTable(sensorContainer.lootTableID),
    sensorContainer.lootTable,
  );
  assert.deepEqual(
    dungeonUniverseSiteService._testing.resolveConfiguredContainerLootTable({
      typeID: 99_009,
    }),
    sensorContainer.lootTable,
  );
});

test("mapped wreck types override profile loot while unmapped wrecks retain it", () => {
  const resolveLootTableID =
    nativeNpcWreckService._testing.resolveNativeWreckLootTableID;

  assert.equal(
    resolveLootTableID(26_591, "generic_random_any"),
    "frontier_wreck_rogue_small",
  );
  assert.equal(
    resolveLootTableID(26_468, "generic_random_any"),
    "generic_random_any",
  );
});

test("site frequency weights selection and placement stays inside configured anchor distance", () => {
  const lowFrequency = {
    template: { templateID: "low", frontierDungeonSpawnFrequency: 1 },
  };
  const highFrequency = {
    template: { templateID: "high", frontierDungeonSpawnFrequency: 3 },
  };
  const pickWeighted = dungeonUniverseRuntime._testing.pickWeightedTemplateCandidate;

  assert.equal(pickWeighted([lowFrequency, highFrequency], 0.249).template.templateID, "low");
  assert.equal(pickWeighted([lowFrequency, highFrequency], 0.25).template.templateID, "high");
  assert.equal(pickWeighted([lowFrequency, highFrequency], 0.999).template.templateID, "high");

  const placement = dungeonUniverseRuntime._testing.buildUniverseSitePlacement(
    30_000_142,
    "combat",
    0,
    0,
    { placementDistanceAu: { min: 1.25, max: 1.5 } },
  );
  assert.ok(placement.anchorDistanceAu >= 1.25);
  assert.ok(placement.anchorDistanceAu <= 1.5);
  assert.deepEqual(placement.placementDistanceAu, { min: 1.25, max: 1.5 });
});

test("dungeon site placement retries overlaps using the configured 1-10 light-second exclusion", () => {
  const makeDefinition = (siteID, slotIndex) => ({
    siteKey: `dungeon:test:${siteID}`,
    solarSystemID: 30_000_142,
    position: { x: 1_000, y: 2_000, z: 3_000 },
    metadata: {
      definitionHash: "{}",
      siteID,
      slotIndex,
      rotationIndex: 0,
      spawnFamilyKey: "combat",
      placementDistanceAu: { min: 3.65, max: 4.35 },
      separationLightSeconds: { min: 1, max: 10 },
    },
    spawnState: {
      siteID,
      slotIndex,
      rotationIndex: 0,
      spawnFamilyKey: "combat",
      placementDistanceAu: { min: 3.65, max: 4.35 },
      separationLightSeconds: { min: 1, max: 10 },
    },
  });
  const definitions = dungeonUniverseRuntime._testing.enforceUniverseDungeonSiteSeparation([
    makeDefinition(1, 0),
    makeDefinition(2, 1),
    makeDefinition(3, 2),
  ]);

  assert.equal(definitions.length, 3);
  assert.equal(definitions[0].metadata.separationPlacementAttempt, 0);
  assert.ok(definitions.slice(1).every(
    (definition) => definition.metadata.separationPlacementAttempt > 0,
  ));
  for (const definition of definitions) {
    assert.ok(definition.metadata.selectedSeparationLightSeconds >= 1);
    assert.ok(definition.metadata.selectedSeparationLightSeconds <= 10);
    assert.equal(definition.metadata.separationSatisfied, true);
  }
  for (let leftIndex = 0; leftIndex < definitions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < definitions.length; rightIndex += 1) {
      const left = definitions[leftIndex];
      const right = definitions[rightIndex];
      const dx = left.position.x - right.position.x;
      const dy = left.position.y - right.position.y;
      const dz = left.position.z - right.position.z;
      const distanceMeters = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      const requiredLightSeconds = Math.max(
        left.metadata.selectedSeparationLightSeconds,
        right.metadata.selectedSeparationLightSeconds,
      );
      assert.ok(distanceMeters >= requiredLightSeconds * LIGHT_SECOND_METERS);
    }
  }
});

test("named hives resolve only their drone family and deduplicate shared SDE types", () => {
  const expectedDroneTypeByHiveTypeID = new Map([
    [77_950, "osa"],
    [82_333, "okryda"],
    [82_334, "termit"],
    [82_335, "tsikada"],
    [83_833, "sarana"],
  ]);

  for (const [hiveTypeID, droneType] of expectedDroneTypeByHiveTypeID) {
    const configuration = frontierDungeonSpawns.resolveHiveSpawnConfiguration(hiveTypeID);
    assert.ok(configuration);
    assert.deepEqual(configuration.droneTypes, [droneType]);
    assert.ok(configuration.spawnEntries.length > 0);
    assert.equal(
      configuration.spawnEntries.every((entry) => entry.droneType === droneType),
      true,
    );
    assert.equal(
      new Set(configuration.spawnEntries.map((entry) => entry.typeID)).size,
      configuration.spawnEntries.length,
    );
  }

  const osaHive = frontierDungeonSpawns.resolveHiveSpawnConfiguration(77_950);
  assert.deepEqual(
    osaHive.spawnEntries.map((entry) => entry.typeID),
    [72_207, 72_374, 72_375, 78_380, 78_377, 78_374],
  );
});

test("test hive spans every named hive family while CRAB selects only Osa Surveyors", () => {
  const testHive = frontierDungeonSpawns.resolveHiveSpawnConfiguration(83_963);
  const crab = frontierDungeonSpawns.resolveHiveSpawnConfiguration(60_244);

  assert.deepEqual(testHive.droneTypes, [
    "osa",
    "okryda",
    "termit",
    "tsikada",
    "sarana",
  ]);
  assert.deepEqual(
    [...new Set(testHive.spawnEntries.map((entry) => entry.droneType))],
    testHive.droneTypes,
  );
  assert.equal(
    new Set(testHive.spawnEntries.map((entry) => entry.typeID)).size,
    testHive.spawnEntries.length,
  );
  assert.deepEqual(crab.spawnEntries, [{
    profileID: "frontier_osa_surveyor",
    typeID: 72_207,
    name: "Osa Surveyor",
    role: "surveyor",
    droneType: "osa",
    factionKey: "osa",
    factionTag: "frontier-faction:osa",
  }]);
});

test("configured hive spawns invoke one NPC batch per resolved drone type", () => {
  const calls: any[] = [];
  const result = mobileAnalysisBeaconRuntime._testing.spawnConfiguredHiveNpcs(
    {
      itemID: 6_400_000_000_001,
      typeID: 60_244,
      kind: "siteEnvironmentProp",
      position: { x: 1, y: 2, z: 3 },
      dungeonSiteID: 7_200_000_000_001,
      dungeonSiteInstanceID: 7_100_000_000_001,
    },
    {
      solarSystemID: 30_000_142,
      linkedShipID: 9_000_000_001,
    },
    {
      npcService: {
        spawnNpcBatchInSystem(systemID, options) {
          calls.push({ systemID, options });
          return { success: true, data: { spawned: [{ entityID: calls.length }] } };
        },
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].systemID, 30_000_142);
  assert.equal(calls[0].options.profileQuery, "frontier_osa_surveyor");
  assert.equal(calls[0].options.preferredTargetID, 9_000_000_001);
  assert.equal(calls[0].options.runtimeKind, "frontierHive");
  assert.equal(calls[0].options.transient, true);
});

test("configured hive scenery advertises the link-with-ship component", () => {
  const entity = mobileAnalysisBeaconRuntime._testing.applyConfiguredHiveLinkPresentation(
    {
      itemID: 6_400_000_000_001,
      typeID: 77_950,
      systemID: 30_000_142,
    },
    {
      active: true,
      linkState: 1,
      linkCompleteAtMs: 0,
      linkedShipID: 0,
      hiveSpawnedAtMs: 0,
      hiveSpawnProfileIDs: [],
    },
  );

  assert.deepEqual(entity.component_activate, [true, null]);
  assert.deepEqual(entity.component_linkWithShip, [null, 1, null, null]);
  assert.equal(entity.frontierHiveLinkState.hiveSpawnedAtMs, 0);
});

test("factions are resolved only from exact dungeon IDs, never a reused entry beacon", () => {
  const okryda = frontierDungeonSpawns.resolveSiteConfiguration({
    sourceDungeonID: 11_122,
    entryObjectTypeID: 83_889,
  });
  const reusedBeaconPrefab = frontierDungeonSpawns.resolveSiteConfiguration({
    sourceDungeonID: 13_870,
    entryObjectTypeID: 83_889,
  });
  const unknownWithReusedBeacon = frontierDungeonSpawns.resolveSiteConfiguration({
    sourceDungeonID: 99_999,
    entryObjectTypeID: 83_889,
  });

  assert.equal(okryda.faction, "okryda");
  assert.equal(okryda.factionKey, "okryda");
  assert.equal(reusedBeaconPrefab.faction, undefined);
  assert.equal(reusedBeaconPrefab.factionKey, null);
  assert.equal(unknownWithReusedBeacon, null);

  const decoratedOkryda = frontierDungeonSpawns.decorateTemplate({
    ...buildControllerTemplate(11_122, 83_889, 83_552),
    rooms: [],
  });
  const decoratedPrefab = frontierDungeonSpawns.decorateTemplate({
    ...buildControllerTemplate(13_870, 83_889, 91_214),
    rooms: [],
  });
  assert.equal(decoratedOkryda.frontierFactionKey, "okryda");
  assert.equal(decoratedOkryda.frontierFactionTag, "frontier-faction:okryda");
  assert.equal(decoratedPrefab.frontierFactionKey, null);
  assert.equal(decoratedPrefab.frontierFactionTag, null);
});

test("specialized site encounters decorate Mooneater, Generative, Shipyard, and Stacked Storage dungeons", () => {
  const decorate = (sourceDungeonID, entryObjectTypeID) => (
    frontierDungeonSpawns.decorateTemplate({
      ...buildControllerTemplate(sourceDungeonID, entryObjectTypeID, 91_214),
      rooms: [],
    })
  );
  const encounterFor = (template) => template.populationHints.encounters.find(
    (encounter) => encounter.frontierEncounterSpawnTableID,
  );

  const mooneater = encounterFor(decorate(13_870, 83_889));
  assert.equal(mooneater.frontierEncounterSpawnTableID, "mooneater_site");
  assert.ok(mooneater.spawnEntries.some(
    (entry) => entry.frontierEncounterFamilyKey === "mooneater_entities",
  ));
  assert.ok(mooneater.spawnEntries.some(
    (entry) => entry.frontierEncounterFamilyKey === "feral_support",
  ));

  const generative = encounterFor(decorate(12_707, 89_061));
  assert.equal(generative.frontierEncounterSpawnTableID, "generative_site");
  assert.ok(generative.spawnEntries.some(
    (entry) => entry.frontierEncounterFamilyKey === "generative_entities",
  ));

  const shipyard = encounterFor(decorate(12_560, 88_013));
  assert.equal(shipyard.frontierEncounterSpawnTableID, "derelict_autonomous_shipyard");
  assert.equal(shipyard.frontierEncounterParentSpawnTableID, "generative_site");
  assert.ok(shipyard.spawnEntries.some(
    (entry) => entry.typeID === 88_566 && entry.frontierEncounterBoss === true,
  ));

  const stackedStorage = encounterFor(decorate(13_583, 86_823));
  assert.equal(stackedStorage.frontierEncounterSpawnTableID, "xeroti_stacked_storage");
  assert.ok(stackedStorage.spawnEntries.every(
    (entry) => entry.frontierEncounterFamilyKey === "xeroti_tidofiza",
  ));
});

test("the same authored frigate controller expands to the site's tagged drone faction", () => {
  const osa = frontierDungeonSpawns.decorateTemplate(
    buildControllerTemplate(10_444, 83_875, 83_552),
  );
  const okryda = frontierDungeonSpawns.decorateTemplate(
    buildControllerTemplate(11_122, 83_889, 83_552),
  );

  assert.equal(osa.frontierDungeonSpawnConfigured, true);
  assert.equal(osa.frontierDungeonSpawnFrequency, 1);
  assert.deepEqual(osa.frontierDungeonPlacementDistanceAu, { min: 3.65, max: 4.35 });
  assert.deepEqual(osa.frontierDungeonWarpIn, {
    boundaryRadiusMeters: 250_000,
    collisionClearanceMeters: 10_000,
  });
  assert.deepEqual(osa.populationHints.frontierDungeonWarpIn, osa.frontierDungeonWarpIn);
  assert.equal(osa.frontierFactionKey, "osa");
  assert.ok(osa.frontierDungeonTags.includes("frontier-faction:osa"));
  assert.equal(okryda.frontierFactionKey, "okryda");
  assert.ok(okryda.frontierDungeonTags.includes("frontier-faction:okryda"));

  assert.equal(osa.populationHints.encounters.length, 1);
  assert.equal(okryda.populationHints.encounters.length, 1);
  assert.deepEqual(
    osa.populationHints.encounters[0].spawnEntries.map((entry) => entry.profileID),
    ["frontier_osa_frigate", "frontier_osa_frigate", "frontier_osa_frigate"],
  );
  assert.deepEqual(
    osa.populationHints.encounters[0].spawnEntries.map((entry) => entry.typeID),
    [72_207, 72_207, 72_207],
  );
  assert.deepEqual(
    okryda.populationHints.encounters[0].spawnEntries.map((entry) => entry.profileID),
    ["frontier_okryda_frigate", "frontier_okryda_frigate", "frontier_okryda_frigate"],
  );
  assert.deepEqual(
    okryda.populationHints.encounters[0].spawnEntries.map((entry) => entry.typeID),
    [73_019, 73_019, 73_019],
  );
});

test("authored trigger edges sequence configured controllers without treating raw values as counts", () => {
  const template = buildControllerTemplate(10_645, 83_872, 83_552);
  template.rooms[0].objects[1].guardCommand = { objectTriggerSpawn: 0 };
  template.rooms[0].objects.push({
    objectID: 201,
    typeID: 83_552,
    role: "scenery",
    position: { x: 20_000, y: 0, z: 0 },
    guardCommand: { objectTriggerSpawn: 1 },
  });
  template.triggers = [
    {
      triggerID: 300,
      objectID: 200,
      triggerEvents: [{ eventTypeID: 3, objectID: 201 }],
    },
    {
      triggerID: 301,
      objectID: 201,
      tinyint_1: 99,
      triggerEvents: [],
    },
  ];

  const decorated = frontierDungeonSpawns.decorateTemplate(template);
  const parent = decorated.populationHints.encounters.find(
    (entry) => entry.frontierDungeonObjectID === 200,
  );
  const child = decorated.populationHints.encounters.find(
    (entry) => entry.frontierDungeonObjectID === 201,
  );

  assert.ok(parent);
  assert.ok(child);
  assert.equal(parent.trigger, "on_load");
  assert.equal(parent.waveIndex, 1);
  assert.equal(child.trigger, "wave_cleared");
  assert.equal(child.prerequisiteKey, parent.key);
  assert.equal(child.waveIndex, 2);
  assert.equal(child.amount, 3);
  assert.equal(child.spawnEntries.length, 3);
  assert.ok(child.notes.some((note) => note.includes("Raw trigger tinyint_1=99")));
});

test("locator-only dungeon objects do not become NPC encounters", () => {
  const template = buildControllerTemplate(12_673, 86_825, 91_214);
  const hints = frontierDungeonSpawns.buildConfiguredPopulationHints(template);
  const decorated = frontierDungeonSpawns.decorateTemplate(template);

  assert.deepEqual(hints.encounters, []);
  assert.deepEqual(decorated.populationHints.encounters, []);
  assert.equal(decorated.frontierFactionKey, null);
  assert.ok(decorated.frontierDungeonTags.includes("site:locator-pattern"));
});

test("site entity descriptors compile into exact positioned entity spawns", () => {
  const template = buildControllerTemplate(10_444, 83_875, 83_552);
  const siteConfiguration = frontierDungeonSpawns.resolveSiteConfiguration(template);
  siteConfiguration.entities = [{
    typeID: 83_192,
    name: "Configured Hive Structure",
    count: 2,
    positionOffset: { x: 4_000, y: 5_000, z: 6_000 },
  }];

  const hints = frontierDungeonSpawns.buildConfiguredPopulationHints(
    template,
    siteConfiguration,
  );

  assert.equal(hints.environmentProps.length, 2);
  assert.equal(hints.exactContentCaps.environmentProps, 2);
  assert.equal(hints.environmentProps.every((entry) => entry.exact === true), true);
  assert.equal(
    hints.environmentProps.every((entry) => entry.frontierDungeonConfiguredEntity === true),
    true,
  );
  assert.deepEqual(
    hints.environmentProps.map((entry) => entry.typeID),
    [83_192, 83_192],
  );
  assert.notDeepEqual(
    hints.environmentProps[0].positionOffset,
    hints.environmentProps[1].positionOffset,
  );
});

test("the config supplies loadable NPC profiles and behavior profiles", () => {
  const profiles = frontierDungeonSpawns.getGeneratedNpcRows("npcProfiles");
  const behaviorProfiles = frontierDungeonSpawns.getGeneratedNpcRows("npcBehaviorProfiles");
  const osaFrigate = profiles.find((entry) => entry.profileID === "frontier_osa_frigate");
  const frigateBehavior = behaviorProfiles.find(
    (entry) => entry.behaviorProfileID === "frontier_dungeon_frigate",
  );

  assert.ok(osaFrigate);
  assert.equal(osaFrigate.shipTypeID, 72_207);
  assert.equal(osaFrigate.behaviorProfileID, "frontier_dungeon_frigate");
  assert.ok(frigateBehavior);
  assert.equal(frigateBehavior.movementMode, "orbit");

  const definition = npcData.buildNpcDefinition("frontier_osa_frigate");
  assert.ok(definition);
  assert.equal(definition.profile.profileID, "frontier_osa_frigate");
  assert.equal(definition.profile.shipTypeID, 72_207);
  assert.equal(definition.behaviorProfile.behaviorProfileID, "frontier_dungeon_frigate");
  assert.equal(definition.loadout.loadoutID, "retail_empty_npc_entity_loadout");

  const conservator = npcData.buildNpcDefinition(
    "frontier_landscape_conservator_92096",
  );
  const allotrope = npcData.buildNpcDefinition(
    "frontier_landscape_allotrope_94167",
  );
  assert.equal(conservator.profile.shipTypeID, 92_096);
  assert.equal(conservator.profile.frontierLandscapeExpectedGroupID, 5_033);
  assert.equal(allotrope.profile.shipTypeID, 94_167);
  assert.equal(allotrope.profile.frontierLandscapeExpectedGroupID, 5_130);
});

test("materialized site entities expose dungeon faction tags to signal tracking", () => {
  const entity = dungeonUniverseSiteService.buildSiteEntity({
    instanceID: 7_100_000_000_101,
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    runtimeFlags: { universeSeeded: true },
    siteKind: "anomaly",
    siteFamily: "combat",
    position: { x: 101, y: 202, z: 303 },
    metadata: {
      siteID: 7_200_000_000_101,
      label: "Osa Infesting Hive",
      dungeonTags: ["site:infesting-hive", "frontier-faction:osa"],
      dungeonFactionKey: "osa",
      dungeonFactionTag: "frontier-faction:osa",
    },
  });

  assert.deepEqual(entity.dungeonTags, [
    "site:infesting-hive",
    "frontier-faction:osa",
  ]);
  assert.equal(entity.dungeonFactionKey, "osa");
  assert.equal(entity.dungeonFactionTag, "frontier-faction:osa");
  assert.deepEqual(entity.signalTrackerSiteTags, entity.dungeonTags);
  assert.equal(entity.signalTrackerSiteFactionKey, "osa");
  assert.equal(entity.signalTrackerSiteFactionTag, "frontier-faction:osa");
});

test("faction tags survive dungeon persistence and NPC private-scope validation", () => {
  const dungeonTags = ["site:infesting-hive", "frontier-faction:osa"];
  const instance = dungeonRuntimeState.normalizeInstanceRecord({
    instanceID: 7_100_000_000_102,
    templateID: "frontier-dungeon:10444",
    solarSystemID: 30_000_142,
    lifecycleState: "active",
    dungeonTags,
    dungeonFactionKey: "Osa",
    dungeonFactionTag: "FRONTIER-FACTION:OSA",
  });

  assert.deepEqual(instance.dungeonTags, dungeonTags);
  assert.equal(instance.dungeonFactionKey, "osa");
  assert.equal(instance.dungeonFactionTag, "frontier-faction:osa");

  const scope = nativeNpcStore.validateStoredEntityScopeMetadata({
    dungeonSiteID: 7_200_000_000_102,
    dungeonSiteInstanceID: instance.instanceID,
    dungeonMaterializedSiteContent: true,
    dungeonTags: instance.dungeonTags,
    dungeonFactionKey: instance.dungeonFactionKey,
    dungeonFactionTag: instance.dungeonFactionTag,
  });

  assert.equal(scope.success, true);
  assert.deepEqual(scope.data.metadata.dungeonTags, dungeonTags);
  assert.equal(scope.data.metadata.dungeonFactionKey, "osa");
  assert.equal(scope.data.metadata.dungeonFactionTag, "frontier-faction:osa");
});
