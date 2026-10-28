"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { calculateExplorationWorldRevision } = require("../src/services/frontier/explorationWorld");
const { FORMAT, SOURCE_HASHES, createTemporaryLandscapeProfile, validateTemporaryLandscapeWorld,
  getTemporaryLandscapeProfile, getTemporaryLandscapeTable, clearTemporaryLandscapeCache,
  getTemporaryLandscapeRuntimeSiteID } = require("../src/services/frontier/temporaryLandscapeProfile");
const { buildLandscapeScenePlan } = require("../src/space/frontierLandscapeScenePlan");

const SYSTEM = 30000001, SITE = 90000001, REVISION = "a".repeat(64);
const position = { x: 12345678.125, y: -0.25, z: 6789 };
function sign(raw) { raw.contentRevision = calculateExplorationWorldRevision(raw); return raw; }
function fixture() {
  const dungeon = { dungeonID: 101, temporaryLandscapeProfile: true, rooms: [{ roomID: 1, position: { x: 10, y: 20, z: 30 }, objects: [
    { objectID: 11, typeID: 1001, role: "scenery", position: { x: 30000, y: 0, z: 0 }, yaw: 90, pitch: 20, roll: 30, radius: 42 },
    { objectID: 12, typeID: 1004, role: "resourceLocator", position: { x: 0, y: 0, z: 1000 } },
  ] }] };
  return sign({ format: FORMAT, temporary: true, contentRevisionAlgorithm: "sha256-typed-f64-v1",
    source: { build: 3640684, files: Object.fromEntries(Object.entries(SOURCE_HASHES).map(([name, sha256]) => [name, { sha256 }])) },
    world: { label: "3502403-MOD4-STUFF1", revision: REVISION },
    systems: [{ id: SYSTEM, asteroidBelts: [], planets: [] }],
    tables: {
      itemTypes: { types: [1001, 1002, 1003, 1004].map(typeID => ({ typeID, name: `Target ${typeID}`, groupID: 226, categoryID: 2,
        radius: 42, dogma: { dogmaAttributes: [{ attributeID: 9, value: 25 }], dogmaEffects: [] }, spaceComponents: typeID === 1002 ? { beacon: {} } : null })) },
      landscapeSites: { sites: [{ itemID: SITE, solarSystemID: SYSTEM, ecosystemID: 2, typeID: 1002,
        position: { ...position }, temporaryLandscapeProfile: true }] },
      landscapeEcosystems: { ecosystems: [{ ecosystemID: 2, temporaryLandscapeProfile: true, spawnEnabled: 1,
        entryPattern: { beaconTypeID: 1002, baseCloudTypeID: 1003, postProcessTypeID: 0, blocksModules: 0 },
        naturalWorldPatterns: [{ dungeonID: 101, minOccurrences: 1, maxOccurrences: 1, weight: 1 }], brokenWorldPatterns: [],
        minNaturalWorldPatterns: 1, maxNaturalWorldPatterns: 1, minBrokenWorldPatterns: 0, maxBrokenWorldPatterns: 0 }] },
      landscapeDungeonTemplates: { dungeons: [dungeon] }, frontierDungeonTemplates: { dungeons: [structuredClone(dungeon)] },
    }, mappingReport: { temporary: true },
  });
}

test("temporary profile pins exact source, selected world, content digest and reference closure", () => {
  const raw = fixture(), profile = createTemporaryLandscapeProfile(raw);
  assert.equal(profile.sites.get(SITE).position.x, position.x);
  assert.equal(profile.raw.temporary, true);
  assert.equal(Object.isFrozen(profile.raw.tables.landscapeSites.sites[0]), true);
  assert.equal(validateTemporaryLandscapeWorld(profile, { baseRevision: REVISION, revision: "b".repeat(64), systems: new Map([[SYSTEM, {}]]) }), true);
  assert.throws(() => validateTemporaryLandscapeWorld(profile, { revision: "b".repeat(64), systems: new Map([[SYSTEM, {}]]) }), /world revision/);
  assert.throws(() => validateTemporaryLandscapeWorld(profile, { revision: REVISION, systems: new Map() }), /outside selected world/);
  for (const [change, expected] of [
    [value => { value.source.build = 3502403; }, /source must/],
    [value => { value.source.files.landscape.sha256 = "f".repeat(64); }, /fingerprint/],
    [value => { value.world.label = "different galaxy"; }, /selected legacy/],
    [value => { value.tables.landscapeSites.sites[0].ecosystemID = 999; }, /unavailable ecosystem/],
    [value => { value.tables.landscapeEcosystems.ecosystems[0].naturalWorldPatterns[0].dungeonID = 999; }, /unavailable dungeon/],
    [value => { value.tables.landscapeDungeonTemplates.dungeons[0].rooms[0].objects[0].typeID = 999; }, /target metadata/],
    [value => { value.tables.landscapeSites.sites.push(structuredClone(value.tables.landscapeSites.sites[0])); }, /duplicate/],
  ] as Array<[(raw: any) => void, RegExp]>) {
    const changed = fixture(); change(changed); sign(changed);
    assert.throws(() => createTemporaryLandscapeProfile(changed), expected);
  }
  const tampered = fixture(); tampered.tables.landscapeSites.sites[0].position.x += 1;
  assert.throws(() => createTemporaryLandscapeProfile(tampered), /content revision/);
});

test("reference overlay replaces target content, merges exact type metadata and excludes ring-center ore", t => {
  const config = require("../src/config"), world = require("../src/services/frontier/explorationWorld");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "temporary-landscape-")), filename = path.join(directory, "profile.json");
  const raw = fixture(); raw.tables.landscapeSites.sites.push({ ...raw.tables.landscapeSites.sites[0], itemID: SITE + 1, ecosystemID: 3 });
  raw.tables.landscapeEcosystems.ecosystems.push({ ...structuredClone(raw.tables.landscapeEcosystems.ecosystems[0]), ecosystemID: 3, spawnEnabled: 0 });
  fs.writeFileSync(filename, JSON.stringify(sign(raw)));
  const originalBuild = config.clientBuild, originalPath = process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH;
  config.clientBuild = 3640684; process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH = filename; clearTemporaryLandscapeCache();
  t.mock.method(world, "getConfiguredExplorationWorld", () => ({ revision: "b".repeat(64), baseRevision: REVISION, systems: new Map([[SYSTEM, {}]]) }));
  t.after(() => { config.clientBuild = originalBuild;
    if (originalPath === undefined) delete process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH; else process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH = originalPath;
    clearTemporaryLandscapeCache(); fs.rmSync(directory, { recursive: true, force: true }); });
  const sites = getTemporaryLandscapeTable("landscapeSites", () => ({ sites: [{ itemID: 999 }] }));
  assert.deepEqual(sites.sites.map(row => row.itemID), [SITE]);
  assert.equal(sites.sites[0].temporaryLandscapeRevision, raw.contentRevision);
  assert.deepEqual(getTemporaryLandscapeTable("asteroidBelts", () => ({ belts: [{ itemID: 999 }] })).belts, []);
  const { buildFrontierResourceFieldDefinition } = require("../src/space/asteroids/frontierResourceFields");
  assert.equal(buildFrontierResourceFieldDefinition(sites.sites[0]), null,
    "an authored target site must not inherit a legacy procedural ore allocation");
  const types = getTemporaryLandscapeTable("itemTypes", () => ({ types: [{ typeID: 1001, name: "old" }, { typeID: 55, name: "unrelated" }] })).types;
  assert.equal(types.find(type => type.typeID === 1001).name, "Target 1001");
  assert.equal(types.find(type => type.typeID === 55).name, "unrelated");
  const dogma = getTemporaryLandscapeTable("typeDogma", () => ({ typesByTypeID: { 55: { attributes: { 9: 8 } } } }));
  assert.equal(dogma.typesByTypeID[1001].attributes[9], 25); assert.equal(dogma.typesByTypeID[55].attributes[9], 8);
  const components = getTemporaryLandscapeTable("spaceComponentsByType", () => ({ types: [{ typeID: 1001, staleComponent: {} }] }));
  assert.equal(components.types.find(row => row.typeID === 1001).staleComponent, undefined);
  assert.deepEqual(components.types.find(row => row.typeID === 1002).beacon, {});
  const voxelWorld = require("../src/services/mining/voxelMiningWorld").getVoxelMiningWorldRevision(config);
  assert.ok(voxelWorld.includes(`/temporary-landscape/${raw.contentRevision}/policy/`));
  config.clientBuild = 3502403;
  assert.equal(getTemporaryLandscapeProfile(), null);
  assert.equal(getTemporaryLandscapeTable("landscapeSites", () => ({})), null);
});

test("target scene plan uses entry types, authored rotation and locators without inventing an entry dungeon", () => {
  const raw = fixture(), ecosystem = raw.tables.landscapeEcosystems.ecosystems[0];
  const dungeon = raw.tables.landscapeDungeonTemplates.dungeons[0];
  const plan = buildLandscapeScenePlan({ itemID: SITE }, ecosystem, id => id === 101 ? dungeon : null);
  assert.equal(plan.selectedPatterns.length, 1);
  assert.equal(plan.selectedPatterns[0].patternKind, "natural");
  const cloud = plan.environmentProps.find(row => row.typeID === 1003);
  assert.deepEqual(cloud.positionOffset, { x: 0, y: 0, z: 0 });
  assert.equal(plan.environmentProps.some(row => row.typeID === 1002), false, "existing beacon must not be spawned again");
  const prop = plan.environmentProps.find(row => row.typeID === 1001);
  assert.equal(prop.authoredRadius, 42);
  assert.deepEqual(prop.dunRotation, [plan.selectedPatterns[0].yawDegrees + 90, 20, 30]);
  assert.equal(plan.locators[0].role, "resourceLocator");
  assert.equal(plan.resourceProps.length, 0, "a locator is not an authored ore allocation");
});

test("temporary scene content receives stable isolated runtime identity without changing the wire beacon", () => {
  const first = getTemporaryLandscapeRuntimeSiteID(REVISION, SITE);
  assert.equal(getTemporaryLandscapeRuntimeSiteID(REVISION, SITE), first);
  assert.notEqual(getTemporaryLandscapeRuntimeSiteID("b".repeat(64), SITE), first);
  assert.notEqual(getTemporaryLandscapeRuntimeSiteID(REVISION, SITE + 1), first);
  assert.ok(Number.isSafeInteger(6400000000000 + first * 100 + 96));
  const { materializeLandscapeSite } = require("../src/space/frontierLandscapeSceneService");
  const raw = fixture(), ecosystem = raw.tables.landscapeEcosystems.ecosystems[0], calls = [];
  const site: any = { ...raw.tables.landscapeSites.sites[0], kind: "landscapeSite", temporaryLandscapeRevision: REVISION };
  const scene: any = { systemID: SYSTEM, staticEntities: [site], addStaticEntity(entity) { this.staticEntities.push(entity); return true; } };
  const result = materializeLandscapeSite(scene, site, {
    classifyResourceObject: () => null,
    worldData: { getLandscapeEcosystemByID: () => ecosystem, getLandscapeDungeonTemplateByID: () => raw.tables.landscapeDungeonTemplates.dungeons[0] },
    dungeonService: { buildEnvironmentEntities(instance, anchor, template, hints) { calls.push({ instance, anchor, hints }); return hints.environmentProps.map((prop, i) => ({ itemID: 6400000000000 + anchor.itemID * 100 + i + 1, typeID: prop.typeID, position: { ...position } })); } },
    npcService: { spawnNpcBatchInSystem() { throw new Error("Old ecosystem-ID NPC overrides must not execute"); } },
  });
  assert.equal(result.success, true);
  assert.equal(site.itemID, SITE);
  assert.equal(calls[0].anchor.itemID, first);
  assert.equal(calls[0].instance.instanceID, first);
  assert.equal(result.data.npcsSpawned, 0);
  assert.ok(scene.staticEntities.slice(1).every(entity => entity.landscapeSiteID === SITE));
  const disabled = materializeLandscapeSite({ systemID: SYSTEM }, { ...site, itemID: SITE + 1 }, {
    worldData: { getLandscapeEcosystemByID: () => ({ ...ecosystem, spawnEnabled: 0 }) },
  });
  assert.equal(disabled.errorMsg, "LANDSCAPE_ECOSYSTEM_DISABLED");
});

test("a target dungeon hive remains authored scenery without inheriting the old NPC allocation", t => {
  const registry = require("../src/services/inventory/itemTypeRegistry");
  registry._setEntriesForTests([{ typeID: 77950, name: "Authored hive", groupID: 226, categoryID: 2, radius: 500 }]);
  t.after(() => registry._setEntriesForTests(null));
  const dungeonService = require("../src/services/dungeon/dungeonUniverseSiteService");
  const hints = { environmentProps: [{ exact: true, key: "target-hive", typeID: 77950, dunObjectID: 1179356,
    positionOffset: { x: -22679.494140625, y: -2364.470703125, z: 0 } }] };
  const site = { itemID: SITE, position: { x: 0, y: 0, z: 0 } };
  const oldEntity = dungeonService.buildEnvironmentEntities({ instanceID: SITE }, site, {}, hints)[0];
  assert.equal(oldEntity.frontierHiveSpawnTypeID, 77950);
  const target = dungeonService.buildEnvironmentEntities({ instanceID: SITE }, site,
    { temporaryLandscapeProfile: true }, hints)[0];
  assert.equal(target.typeID, 77950);
  assert.equal(target.frontierHiveSpawnTypeID, undefined);
  assert.equal(target.component_linkWithShip, undefined);
  assert.deepEqual(target.position, hints.environmentProps[0].positionOffset);
});
