"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyCrudeMatterResource,
  createFrontierRiftAuthority,
} = require("../src/space/frontierRiftAuthority");
const {
  RIFT_RESPAWN_DELAY_MS,
  RIFT_SITE_ID_BASE,
  createFrontierRiftSiteStore,
} = require("../src/space/frontierRiftSites");
const {
  buildRiftEnvironmentPlan,
  buildRiftSiteEntity,
  handleResourceDepleted,
  materializeRiftSite,
} = require("../src/space/frontierRiftSceneService");
const {
  DEFAULT_RIFT_SPAWN_DISTANCE_METERS,
  executeFrontierRiftCommand,
} = require("../src/services/chat/frontierRiftCommands");
const {
  buildCrudeRiftInfo,
} = require("../src/services/frontier/systemInfoService");
const {
  buildSlimItemDict,
} = require("../src/space/destiny");
const {
  normalizeCrDataDictionaryForProfile,
} = require("../src/space/destiny/stream/statePayloadCompatibility");

const TYPES = new Map([
  [92395, {
    typeID: 92395,
    name: "Rift F935",
    groupID: 4872,
    categoryID: 2,
    graphicID: 1211,
    radius: 1,
  }],
  [92394, {
    typeID: 92394,
    name: "Fine Young Crude Matter",
    groupID: 4593,
    categoryID: 2,
    graphicID: 1211,
    radius: 1000,
  }],
  [78434, {
    typeID: 78434,
    name: "Rough Young Crude Matter",
    groupID: 4593,
    categoryID: 2,
    graphicID: 1211,
    radius: 1000,
  }],
  [88430, {
    typeID: 88430,
    name: "Mini Rift Spill",
    groupID: 4873,
    categoryID: 2,
    graphicID: 1211,
    radius: 10,
  }],
]);

function buildDungeon() {
  return {
    _key: 14001,
    dungeonID: 14001,
    dungeonName: "Rift F935",
    dungeonNameID: 1036294,
    archetypeID: 51,
    entryObjectID: 1466744,
    entryTypeID: 92395,
    rooms: [{
      roomID: 12001,
      position: { x: 0, y: 0, z: 0 },
      objects: [
        {
          objectID: 1466744,
          roomID: 12001,
          typeID: 92395,
          position: { x: 17398, y: -908, z: 0 },
        },
        {
          objectID: 1468972,
          roomID: 12001,
          typeID: 92394,
          localName: "Fine Young Rupture",
          position: { x: 1254, y: 889, z: -711 },
        },
        {
          objectID: 1508330,
          roomID: 12001,
          typeID: 78434,
          position: { x: 1254, y: 889, z: -711 },
        },
        {
          objectID: 1466745,
          roomID: 12001,
          typeID: 88430,
          position: { x: 1726, y: -1207, z: 0 },
          yaw: 0,
          pitch: 0,
          roll: 18.5,
        },
      ],
    }],
    triggers: [{
      triggerID: 83747,
      triggerTypeID: 8,
      triggerEvents: [{
        eventID: 155348,
        eventTypeID: 3,
        objectID: 1508330,
      }],
    }],
  };
}

function buildAuthority() {
  return createFrontierRiftAuthority({
    dungeons: [buildDungeon()],
    itemTypes: {
      resolveItemByTypeID: (typeID) => TYPES.get(Number(typeID)) || null,
    },
    referenceData: {
      TABLE: { FRONTIER_DUNGEON_TEMPLATES: "frontierDungeonTemplates" },
      readStaticRows: () => [buildDungeon()],
    },
  });
}

function buildMemoryDatabase() {
  let data: Record<string, any> = {};
  return {
    ensureTable() {},
    read() {
      return { success: true, data };
    },
    write(_table, _path, nextData) {
      data = structuredClone(nextData);
      return { success: true };
    },
    flushTableSync() {
      return { success: true };
    },
  };
}

function buildStore(authority = buildAuthority()) {
  return createFrontierRiftSiteStore({
    authority,
    database: buildMemoryDatabase(),
    now: () => "2026-08-03T18:00:00.000Z",
  });
}

test("Frontier Rift authority preserves the authored room and initial trigger state", () => {
  const authority = buildAuthority();
  const template = authority.getTemplateByDungeonID(14001);

  assert.equal(template.entryTypeID, 92395);
  assert.equal(template.preferred, true);
  assert.deepEqual(template.spawnGuardObjectIDs, [1508330]);
  assert.deepEqual(template.resources.map((resource) => resource.typeID), [92394]);
  assert.deepEqual(template.resourceVariants.map((resource) => resource.typeID), [92394, 78434]);
  assert.deepEqual(template.resourceProfiles, [
    {
      typeID: 92394,
      typeName: "Fine Young Crude Matter",
      localName: "Fine Young Rupture",
      age: "young",
      quality: "fine",
      formation: "rupture",
      potential: "low",
      resourceQuantity: 1_000,
      tags: [],
    },
    {
      typeID: 78434,
      typeName: "Rough Young Crude Matter",
      localName: null,
      age: "young",
      quality: "rough",
      formation: null,
      potential: null,
      resourceQuantity: null,
      tags: [],
    },
  ]);
  assert.deepEqual(
    template.sceneObjects.map((object) => object.objectID),
    [1468972, 1466745],
  );
  assert.deepEqual(template.resources[0].positionOffset, {
    x: -16144,
    y: 1797,
    z: -711,
  });
});

test("Crude Matter formations determine yield tier and mineable quantity", () => {
  assert.deepEqual(classifyCrudeMatterResource({
    typeID: 95834,
    itemName: "Crude Matter - Old/Rough/Mid",
    localName: "Old Rough Fault",
  }), {
    typeID: 95834,
    typeName: "Crude Matter - Old/Rough/Mid",
    localName: "Old Rough Fault",
    age: "old",
    quality: "rough",
    formation: "fault",
    potential: "high",
    resourceQuantity: 100_000,
    tags: [],
  });

  assert.deepEqual(
    ["Rupture", "Fissure", "Fault"].map((formation) => {
      const profile = classifyCrudeMatterResource({ localName: formation });
      return [profile.formation, profile.potential, profile.resourceQuantity];
    }),
    [
      ["rupture", "low", 1_000],
      ["fissure", "mid", 10_000],
      ["fault", "high", 100_000],
    ],
  );

  const explicitHigh = classifyCrudeMatterResource({
    itemName: "Crude Matter - Young/Fine/High",
  });
  assert.equal(explicitHigh.formation, null);
  assert.equal(explicitHigh.potential, "high");
  assert.equal(explicitHigh.resourceQuantity, 100_000);
});

test("Frontier Rift sites persist exact client IDs and authored resources", () => {
  const store = buildStore();
  const result = store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 100, y: 200, z: 300 },
    createdByCharacterID: 140000005,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.itemID, RIFT_SITE_ID_BASE);
  assert.equal(result.data.typeID, 92395);
  assert.equal(result.data.groupID, 4872);
  assert.equal(result.data.kind, "riftDungeon");
  assert.deepEqual(result.data.resourceTypeIDs, [92394]);
  assert.deepEqual(store.listSites(30021998), [result.data]);
  assert.deepEqual(result.data.riftTags, []);
});

test("depleted Rift sites own a persisted 24-hour respawn lifecycle", () => {
  const store = buildStore();
  const site = store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 100, y: 200, z: 300 },
  }).data;
  const depletedAtMs = 10_000;

  const depleted = store.markDepleted(site.itemID, { nowMs: depletedAtMs });
  assert.equal(depleted.success, true);
  assert.equal(depleted.data.lifecycleState, "depleted");
  assert.equal(depleted.data.respawnAtMs, depletedAtMs + RIFT_RESPAWN_DELAY_MS);
  assert.deepEqual(store.listSites(30021998, { activeOnly: true }), []);
  assert.deepEqual(
    store.reactivateDueSites(30021998, depleted.data.respawnAtMs - 1).data.sites,
    [],
  );

  const reactivated = store.reactivateDueSites(30021998, depleted.data.respawnAtMs);
  assert.equal(reactivated.success, true);
  assert.equal(reactivated.data.sites.length, 1);
  assert.equal(reactivated.data.sites[0].lifecycleState, "active");
  assert.equal(reactivated.data.sites[0].depletedAtMs, 0);
  assert.equal(reactivated.data.sites[0].respawnAtMs, 0);
});

test("mining the final Crude Matter prop depletes the Rift site, not the prop lifecycle", () => {
  const authority = buildAuthority();
  const store = buildStore(authority);
  const site = store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 100, y: 200, z: 300 },
  }).data;
  const root: Record<string, any> = buildRiftSiteEntity(site);
  const resource: Record<string, any> = {
    itemID: 7_000_000_000_000,
    customFrontierRiftContent: true,
    frontierRiftResource: true,
    frontierRiftSiteID: site.itemID,
  };
  const scenery: Record<string, any> = {
    itemID: 7_000_000_000_001,
    customFrontierRiftContent: true,
    frontierRiftResource: false,
    frontierRiftSiteID: site.itemID,
  };
  root.frontierRiftResourceEntityIDs = [resource.itemID];
  const scene: Record<string, any> = {
    systemID: site.solarSystemID,
    staticEntities: [root, resource, scenery],
    staticEntitiesByID: new Map([
      [root.itemID, root],
      [resource.itemID, resource],
      [scenery.itemID, scenery],
    ]),
    _frontierMaterializedRiftSiteIDs: new Set([site.itemID]),
    removeStaticEntity(entityID) {
      const numericEntityID = Number(entityID);
      const entity = this.staticEntitiesByID.get(numericEntityID) || null;
      if (!entity) return { success: false, errorMsg: "STATIC_ENTITY_NOT_FOUND" };
      this.staticEntitiesByID.delete(numericEntityID);
      this.staticEntities = this.staticEntities.filter((entry) => entry.itemID !== numericEntityID);
      return { success: true, data: { entity } };
    },
  };
  const clearedEntityIDs: any[] = [];
  const depletedAtMs = 25_000;
  const result = handleResourceDepleted(scene, resource, {
    authority,
    broadcast: false,
    dungeonService: {},
    miningRuntimeState: {
      clearMineableState(_scene, entityID) {
        clearedEntityIDs.push(entityID);
      },
    },
    nowMs: depletedAtMs,
    siteStore: store,
  });

  assert.equal(result.success, true);
  assert.equal(result.data.completed, true);
  assert.equal(result.data.respawnAtMs, depletedAtMs + RIFT_RESPAWN_DELAY_MS);
  assert.deepEqual(clearedEntityIDs, [resource.itemID]);
  assert.equal(scene.staticEntities.length, 0);
  assert.equal(store.getSite(site.itemID).lifecycleState, "depleted");
});

test("Rift scene materialization emits a CRDungeon root and exact active room props", () => {
  const authority = buildAuthority();
  const store = buildStore(authority);
  const site = store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 100, y: 200, z: 300 },
  }).data;
  const scene: Record<string, any> = {
    staticEntities: [],
    staticEntitiesByID: new Map(),
    broadcasts: [],
    addStaticEntity(entity) {
      if (this.staticEntitiesByID.has(entity.itemID)) return false;
      this.staticEntities.push(entity);
      this.staticEntitiesByID.set(entity.itemID, entity);
      return true;
    },
    broadcastAddBalls(entities) {
      assert.ok(entities.every((entity) => (
        entity.dungeonMaterializedSiteContent !== true &&
        entity.dungeonSiteInstanceID === undefined
      )));
      this.broadcasts.push(entities.map((entity) => entity.itemID));
    },
  };
  const dungeonService: Record<string, any> = {
    buildEnvironmentEntities(_instance, root, _template, hints) {
      return hints.environmentProps.map((prop, index) => {
        const type = TYPES.get(prop.typeID);
        return {
          kind: "siteEnvironmentProp",
          dungeonEnvironmentSource: "client-template",
          dungeonMaterializedEnvironment: true,
          dungeonMaterializedSiteContent: true,
          dungeonSiteID: site.itemID,
          dungeonSiteInstanceID: site.itemID,
          itemID: 7_000_000_000_000 + index,
          dunObjectID: prop.dunObjectID,
          typeID: prop.typeID,
          groupID: type.groupID,
          categoryID: type.categoryID,
          position: {
            x: root.position.x + prop.positionOffset.x,
            y: root.position.y + prop.positionOffset.y,
            z: root.position.z + prop.positionOffset.z,
          },
        };
      });
    },
  };

  const result = materializeRiftSite(scene, site, {
    authority,
    broadcast: true,
    dungeonService,
    siteStore: store,
  });
  const root = scene.staticEntitiesByID.get(site.itemID);
  const content = scene.staticEntities.filter((entity) => entity.customFrontierRiftContent);

  assert.equal(result.success, true);
  assert.equal(root.kind, "riftDungeon");
  assert.equal(root.groupID, 4872);
  assert.equal(root.dungeonID, 14001);
  assert.equal(content.length, 2);
  assert.equal(content.filter((entity) => entity.frontierRiftResource).length, 1);
  const resource = content.find((entity) => entity.frontierRiftResource);
  assert.equal(resource.frontierRiftFormation, "rupture");
  assert.equal(resource.frontierRiftYieldTier, "low");
  assert.equal(resource.resourceQuantity, 1_000);
  assert.deepEqual(scene.broadcasts, [
    [site.itemID],
    [7_000_000_000_000, 7_000_000_000_001],
  ]);
  assert.ok(content.every((entity) => (
    entity.dungeonMaterializedSiteContent === undefined &&
    entity.dungeonSiteInstanceID === undefined
  )));
  assert.deepEqual(buildRiftEnvironmentPlan(authority.getTemplateByDungeonID(14001))
    .map((entry) => entry.typeID), [92394, 88430]);

  const crData = normalizeCrDataDictionaryForProfile(
    buildSlimItemDict(buildRiftSiteEntity(site)),
    root,
    "frontier",
  );
  const entries = Object.fromEntries(crData.entries);
  assert.equal(entries.dungeonID, 14001);
  assert.equal(entries.dungeonNameID, 1036294);
  assert.equal(entries.archetypeID, 51);
  assert.equal(entries.signatureRadius, 1);
});

test("systemInfo reports active Rift counts by client Rift type", () => {
  const store = buildStore();
  store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 1, y: 2, z: 3 },
  });
  store.createSite({
    template: 14001,
    solarSystemID: 30021998,
    position: { x: 4, y: 5, z: 6 },
  });

  assert.deepEqual(buildCrudeRiftInfo(30021998, { siteStore: store }), {
    type: "dict",
    entries: [
      ["points", 2],
      ["counts", { type: "dict", entries: [[92395, 2]] }],
    ],
  });
});

test("Rift command spawns the preferred template through the live runtime", () => {
  const authority = buildAuthority();
  const siteStore = buildStore(authority);
  const ship: Record<string, any> = {
    position: { x: 1000, y: 2000, z: 3000 },
    direction: { x: 1, y: 0, z: 0 },
  };
  let liveSite = null;
  const spaceRuntime: Record<string, any> = {
    getSceneForSession: () => ({
      systemID: 30021998,
      getShipEntityForSession: () => ship,
    }),
    addCustomRiftSite(site) {
      liveSite = site;
      return { success: true, data: { propsSpawned: 2 } };
    },
  };

  const result = executeFrontierRiftCommand(
    { characterID: 140000005 },
    "spawn ahead=5000",
    { authority, siteStore, spaceRuntime },
  );

  assert.equal(result.success, true);
  assert.equal(liveSite.dungeonID, 14001);
  assert.deepEqual(liveSite.position, { x: 6000, y: 2000, z: 3000 });
  assert.match(result.message, /Rift F935/);
  assert.match(result.message, /2 authored room objects/);
});

test("Rift command defaults to a system-map-visible placement", () => {
  const authority = buildAuthority();
  const siteStore = buildStore(authority);
  const ship: Record<string, any> = {
    position: { x: 1000, y: 2000, z: 3000 },
    direction: { x: 1, y: 0, z: 0 },
  };
  let liveSite = null;
  const spaceRuntime: Record<string, any> = {
    getSceneForSession: () => ({
      systemID: 30021998,
      getShipEntityForSession: () => ship,
    }),
    addCustomRiftSite(site) {
      liveSite = site;
      return { success: true, data: { propsSpawned: 2 } };
    },
  };

  const result = executeFrontierRiftCommand(
    { characterID: 140000005 },
    "spawn",
    { authority, siteStore, spaceRuntime },
  );

  assert.equal(result.success, true);
  assert.deepEqual(liveSite.position, {
    x: 1000 + DEFAULT_RIFT_SPAWN_DISTANCE_METERS,
    y: 2000,
    z: 3000,
  });
});
