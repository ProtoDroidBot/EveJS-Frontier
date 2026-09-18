"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const frontierDungeonSpawns = require("../src/config/frontierDungeonSpawns");
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
const dungeonRuntimeState = require("../src/services/dungeon/dungeonRuntimeState");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
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

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.enabled, true);
  assert.equal(Object.keys(config.sites).length, 39);
  assert.equal(Object.keys(config.spawnerTypes).length, 16);
  assert.equal(Object.keys(config.hiveSpawns).length, 7);
  assert.equal(summary.hiveSpawnTypeCount, 7);
  assert.equal(summary.schemaVersion, config.schemaVersion);
  assert.equal(summary.enabled, true);
  assert.equal(
    summary.configuredSiteCount ?? summary.siteCount,
    Object.keys(config.sites).length,
  );
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

test("the same authored frigate controller expands to the site's tagged drone faction", () => {
  const osa = frontierDungeonSpawns.decorateTemplate(
    buildControllerTemplate(10_444, 83_875, 83_552),
  );
  const okryda = frontierDungeonSpawns.decorateTemplate(
    buildControllerTemplate(11_122, 83_889, 83_552),
  );

  assert.equal(osa.frontierDungeonSpawnConfigured, true);
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
