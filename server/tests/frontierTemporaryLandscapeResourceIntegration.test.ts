"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("production temporary allocation becomes a voxel asteroid and restores carved stock from SQLite", t => {
  const config = require("../src/config");
  const previous = { clientBuild: config.clientBuild, miningEnabled: config.miningEnabled,
    voxelMiningEnabled: config.voxelMiningEnabled, temporaryLandscapePath: config.temporaryLandscapePath };
  Object.assign(config, { clientBuild: 3640684, miningEnabled: true, voxelMiningEnabled: true, temporaryLandscapePath: "" });
  const oldPath = process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH;
  delete process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH;
  t.after(() => { Object.assign(config, previous); if (oldPath === undefined) delete process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH; else process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH = oldPath; });
  const registry = require("../src/services/inventory/itemTypeRegistry");
  registry._setEntriesForTests([
    { typeID: 78447, name: "Ember", groupID: 5145, groupName: "Ore", categoryID: 25, volume: 1 },
    { typeID: 91379, name: "Ember carrier", groupID: 450, groupName: "Asteroid", categoryID: 25, radius: 350, volume: 1 },
  ]);
  t.after(() => registry._setEntriesForTests(null));
  const profile = require("../src/services/frontier/temporaryLandscapeProfile");
  t.mock.method(profile, "getTemporaryLandscapeProfile", () => ({ revision: "a".repeat(64) }));
  const policyRevision = require("../src/services/frontier/temporaryLandscapePolicyVersion").TEMPORARY_LANDSCAPE_POLICY_REVISION;
  const database = require("../src/gameStore");
  const runtimeAPI = require("../src/space/temporaryLandscapeRuntime");
  const service = require("../src/space/frontierLandscapeSceneService");
  const mining = require("../src/services/mining/miningRuntimeState");
  const voxel = require("../src/services/mining/voxelMiningRuntime");
  const voxelStore = require("../src/services/mining/voxelMiningStore");
  const worldRevision = require("../src/services/mining/voxelMiningWorld").getVoxelMiningWorldRevision(config);
  const dungeonService = require("../src/services/dungeon/dungeonUniverseSiteService");
  const site = { itemID: 99887766, ecosystemID: 13, kind: "landscapeSite", position: { x: 0, y: 0, z: 0 }, temporaryLandscapeRevision: "a".repeat(64) };
  const resource = { key: "actual-resource-adapter", typeID: 91379, miningYieldTypeID: 78447,
    resourceQuantity: 10000, radius: 350, positionOffset: { x: 0, y: 0, z: 0 }, activation: "entry" };
  const plan = { temporaryPolicy: { revision: policyRevision, resources: [resource], npcs: [], triggers: [] } };
  function sceneFor() {
    return { systemID: 30000001, staticEntities: [], staticEntitiesByID: new Map(), dynamicEntities: new Map(), sessions: new Map(),
      getEntityByID(id) { return this.staticEntitiesByID.get(id) || this.dynamicEntities.get(id); },
      getCurrentSimTimeMs: () => Date.now(),
      addStaticEntity(entity) { if (this.getEntityByID(entity.itemID)) return false; this.staticEntities.push(entity); this.staticEntitiesByID.set(entity.itemID, entity); return true; },
      removeStaticEntity(id) { this.staticEntities = this.staticEntities.filter(entity => entity.itemID !== id); return { success: this.staticEntitiesByID.delete(id) }; },
      spawnDynamicEntity(entity) { this.dynamicEntities.set(entity.itemID, entity); return { success: true, data: { entity } }; },
      broadcastAddBalls() {}, clearAllTargetingForEntity() {}, reconcileEntityPublicGrid() {}, reconcileEntityBubble() {},
    };
  }
  const scene = sceneFor(), runtime = runtimeAPI.createTemporaryLandscapeRuntime();
  const dependencies = { dungeonService, miningRuntimeState: mining };
  const options = { temporaryPolicyRuntime: runtime, temporaryNpcAdapter: {} };
  const first = service._testing.attachTemporaryLandscapePolicy(scene, site, plan, dependencies, options);
  assert.equal(first.success, true, JSON.stringify(first));
  const identity = { profileRevision: site.temporaryLandscapeRevision, policyRevision, systemID: scene.systemID, siteID: site.itemID };
  const receipt = runtime.read(identity).entries[resource.key];
  const entity = scene.getEntityByID(receipt.entityID);
  assert.equal(entity.kind, "landscapeResource");
  assert.equal(entity.typeID, 95899);
  assert.equal(entity.compositeAsteroid, true);
  assert.equal(entity.miningYieldTypeID, 78447);
  assert.equal(mining.getMineableState(scene, entity.itemID).remainingQuantity, 10000);
  assert.equal(require("../src/gameStore/sqliteStore").loadTableObject(runtimeAPI.TABLE)[runtimeAPI.identityKey(identity)].entries[resource.key].entityID, entity.itemID);
  const source = { itemID: 2988888999, position: { x: -1000, y: 0, z: 0 }, radius: 20 };
  const cut = voxel.mine(scene, source, entity, mining.getMineableState(scene, entity.itemID), { normalQuantity: 100 }, { maxRangeMeters: 5000 });
  assert.equal(cut.success, true, JSON.stringify(cut));
  assert.ok(cut.data.extractedQuantity > 0);
  const remaining = cut.data.asteroid.remainingQuantity;
  assert.ok(remaining < 10000);
  assert.equal(runtime.detach(scene, site.itemID).success, true);
  const restoredScene = sceneFor(), restoredRuntime = runtimeAPI.createTemporaryLandscapeRuntime();
  const restored = service._testing.attachTemporaryLandscapePolicy(restoredScene, site, plan, dependencies,
    { ...options, temporaryPolicyRuntime: restoredRuntime });
  assert.equal(restored.success, true, JSON.stringify(restored));
  assert.equal(restoredRuntime.read(identity).entries[resource.key].entityID, entity.itemID);
  assert.equal(mining.getMineableState(restoredScene, entity.itemID).remainingQuantity, remaining);
  assert.equal(voxelStore.getAsteroid({ worldRevision, systemID: scene.systemID, asteroidID: entity.itemID }).remainingQuantity, remaining);
  assert.equal(voxelStore.listFragments(worldRevision, scene.systemID).length, 1);
  t.after(() => { database._closeSqliteForTests(); database._shutdownPersistenceWorkerForTests(); });
});
