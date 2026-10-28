"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Deliberately exercises production exports and their lazy bindings, with an
// attested disposable database. No server or native client is started.
test("production mining prepares 3640684 composites, drops durable ore with full cargo, and exposes recipe/scoop handlers while preserving the old build", t => {
  const writeFile = fs.writeFileSync;
  const root = path.resolve(__dirname, "../..");
  const configFiles = new Set([path.join(root, "evejs.config.json"), path.join(root, "evejs.config.local.json")]);
  // Config fills missing keys on import. A test must not rewrite user settings.
  t.mock.method(fs, "writeFileSync", (file, ...args) => {
    if (typeof file === "string" && configFiles.has(path.resolve(file))) return;
    return writeFile(file, ...args);
  });
  let activeScene;
  const runtimePath = require.resolve("../src/space/runtime");
  const previousRuntime = require.cache[runtimePath];
  // SpaceRuntime's constructor arms simulation timers. Replace only its scene
  // lookup transport, leaving the production mining runtime entirely intact.
  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true,
    exports: { getSceneForSession: () => activeScene, getCreationActiveModuleCallbacksForSession: () => ({}) } } as any;
  t.after(() => {
    if (previousRuntime) require.cache[runtimePath] = previousRuntime;
    else delete require.cache[runtimePath];
  });

  const config = require("../src/config");
  const originalConfig = { clientBuild: config.clientBuild, voxelMiningEnabled: config.voxelMiningEnabled,
    voxelMiningWorldRevision: config.voxelMiningWorldRevision };
  Object.assign(config, { clientBuild: 3640684, voxelMiningEnabled: true, voxelMiningWorldRevision: "production-wiring-test" });
  t.after(() => Object.assign(config, originalConfig));
  const registry = require("../src/services/inventory/itemTypeRegistry");
  registry._setEntriesForTests([
    { typeID: 77800, name: "Feldspar", groupID: 5144, groupName: "Ore", categoryID: 25, volume: 1 },
    { typeID: 91374, name: "Legacy feldspar carrier", groupID: 450, groupName: "Asteroid", categoryID: 25, volume: 1 },
    { typeID: 987002, name: "Mining fixture ship", groupID: 25, categoryID: 6, volume: 100, capacity: 100 },
    { typeID: 987003, name: "Basic mining fixture module", groupID: 54, categoryID: 7, volume: 1 },
  ]);
  t.after(() => registry._setEntriesForTests(null));
  const database = require("../src/gameStore");
  for (const table of ["characters", "items"]) database.ensureTable(table);
  const characterID = 140888801, shipID = 2988888010, moduleID = 2988888011, cargoID = 2988888012;
  const systemID = 30000001, asteroidID = 5000000888801;
  database.write("characters", `/${characterID}`, { characterID, accountId: 1, shipID,
    solarSystemID: systemID, stationID: 0, name: "Voxel fixture pilot" });
  database.write("items", `/${shipID}`, { itemID: shipID, typeID: 987002, ownerID: characterID,
    locationID: systemID, flagID: 0, singleton: 1, quantity: -1, stacksize: 1, categoryID: 6,
    spaceState: { systemID, position: { x: -800, y: 0, z: 0 } } });
  database.write("items", `/${moduleID}`, { itemID: moduleID, typeID: 987003, ownerID: characterID,
    locationID: shipID, flagID: 27, singleton: 1, quantity: -1, stacksize: 1,
    categoryID: 7, moduleState: { online: true } });
  database.write("items", `/${cargoID}`, { itemID: cargoID, typeID: 77800, ownerID: characterID,
    locationID: shipID, flagID: 5, singleton: 0, quantity: 100, stacksize: 100, categoryID: 25, volume: 1 });
  assert.equal(database.flushTablesSync(["characters", "items"]).success, true);
  const fitting = require("../src/services/fitting/liveFittingState");
  // The test owns no full dogma fixture; keep hold capacity deterministic while
  // the production inventory index still computes real occupied cargo volume.
  t.mock.method(fitting, "buildShipResourceState", () => ({ cargoCapacity: 100 }));
  const previousAttributes = fitting.getTypeAttributeMap;
  t.mock.method(fitting, "getTypeAttributeMap", typeID => Number(typeID) === 987003 ? {} : previousAttributes(typeID));
  const mining = require("../src/services/mining/miningRuntime");
  const stateAPI = require("../src/services/mining/miningRuntimeState");
  const voxel = require("../src/services/mining/voxelMiningRuntime");
  const store = require("../src/services/mining/voxelMiningStore");
  const inventory = require("../src/services/inventory/itemStore");
  const notices = [];
  let simulationClock = Date.now();
  const session: any = { characterID, _space: { shipID, systemID },
    sendNotification(...args) { notices.push(args); } };
  const ship: any = { itemID: shipID, typeID: 987002, kind: "ship", characterID, session, systemID,
    position: { x: -800, y: 0, z: 0 }, radius: 20, mode: "STOP", scope: "public" };
  const originalAsteroid: any = { itemID: asteroidID, typeID: 91374, kind: "asteroid", categoryID: 25,
    groupID: 450, miningYieldTypeID: 77800, miningYieldKind: "ore", skipMiningTemplateResolution: true,
    resourceQuantity: 10000, position: { x: 0, y: 0, z: 0 }, radius: 350, scope: "public" };
  function sceneFor(asteroid) {
    const scene: any = { systemID, staticEntities: [asteroid], staticEntitiesByID: new Map([[asteroid.itemID, asteroid]]),
      dynamicEntities: new Map([[shipID, ship]]), sessions: new Map([[characterID, session]]),
      getEntityByID(id) { return this.dynamicEntities.get(Number(id)) || this.staticEntitiesByID.get(Number(id)) || null; },
      getShipEntityForSession: () => ship,
      getCurrentSimTimeMs: () => simulationClock,
      getTargetsForEntity: () => [asteroid.itemID],
      canSessionSeeStaticEntityForSession: () => true, canSessionSeeDynamicEntity: () => true,
      spawnDynamicEntity(entity) { this.dynamicEntities.set(entity.itemID, entity); return { success: true, data: { entity } }; },
      unregisterDynamicEntity(entity) { this.dynamicEntities.delete(entity.itemID); },
      removeStaticEntity(id) { this.staticEntitiesByID.delete(id); this.staticEntities = this.staticEntities.filter(e => e.itemID !== id); },
      clearAllTargetingForEntity() {}, reconcileEntityPublicGrid() {}, reconcileEntityBubble() {},
      getMovementStamp: () => 1, broadcastMovementUpdates() {}, broadcastSlimItemChange() {},
    };
    return scene;
  }
  const currentAsteroid = structuredClone(originalAsteroid);
  activeScene = sceneFor(currentAsteroid);
  stateAPI.ensureSceneMiningState(activeScene);
  assert.equal(currentAsteroid.typeID, 95899, "the existing scene preparation hook must choose the new client composite");
  assert.equal(currentAsteroid.compositeAsteroid, true);
  assert.equal(store.getAsteroid({ worldRevision: config.voxelMiningWorldRevision, systemID, asteroidID }), null,
    "scene bootstrap must keep untouched asteroids lazy");
  const snapshot = { family: "ore", moduleTypeID: 987003, chargeTypeID: 0, miningAmountM3: 20,
    maxRangeMeters: 5000, wasteVolumeMultiplier: 0, wasteProbability: 0, critQuantityMultiplier: 0, critChance: 0 };
  const effect = { targetID: asteroidID, moduleID, moduleFlagID: 27, effectID: 0 };
  const cycleOptions = { snapshot, chargeItem: null, applyCrystalVolatility: false };
  const initialItems = inventory.getAllItems();
  const result = mining.executeMiningCycle(activeScene, ship, effect, Date.now(), cycleOptions);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.inventoryCreditedQuantity, 0);
  assert.equal(result.data.regolithFragments.length, 1);
  assert.ok(result.data.transferredQuantity > 0);
  assert.deepEqual(inventory.getAllItems(), initialItems, "full cargo must remain unchanged during voxel mining");
  const fragmentID = result.data.regolithFragments[0];
  const fragment = store.getFragment(fragmentID);
  assert.equal(fragment.quantity, result.data.transferredQuantity);
  assert.equal(fragment.status, "available");
  assert.equal(activeScene.getEntityByID(fragmentID).kind, "regolith");
  assert.equal(activeScene.getEntityByID(fragmentID).oreUnits, fragment.quantity);
  assert.equal(stateAPI.isMineableStaticEntity(activeScene.getEntityByID(fragmentID)), false,
    "loose ore must not be classified as a fresh asteroid merely because its type is ore");
  assert.equal(stateAPI.getMineableState(activeScene, fragmentID), null);
  const beforeRemine = store.getAsteroid({ worldRevision: config.voxelMiningWorldRevision, systemID, asteroidID });
  const remine = mining.executeMiningCycle(activeScene, ship, { ...effect, targetID: fragmentID }, Date.now(),
    { ...cycleOptions, requireTargetLock: false });
  assert.equal(remine.success, false);
  assert.equal(remine.stopReason, "target");
  assert.deepEqual(inventory.getAllItems(), initialItems, "attempting to mine regolith cannot grant inventory");
  assert.deepEqual(store.getAsteroid({ worldRevision: config.voxelMiningWorldRevision, systemID, asteroidID }), beforeRemine);
  assert.equal(store.listFragments(config.voxelMiningWorldRevision, systemID).length, 1,
    "attempting to mine regolith cannot multiply fragments");
  assert.deepEqual(store.getFragment(fragmentID), fragment, "rejected mining cannot deplete the loose fragment");
  assert.equal(store.getAsteroid({ worldRevision: config.voxelMiningWorldRevision, systemID, asteroidID }).remainingQuantity,
    10000 - result.data.normalQuantity);

  const CompositeService = require("../src/services/mining/compositeAsteroidMgrService");
  const recipeService = new CompositeService();
  assert.equal(recipeService.Handle_GetCompositeRecipe([asteroidID], session).type, "dict");
  assert.ok(Buffer.isBuffer(recipeService.Handle_GetCompositeMinedSet([asteroidID], session)));
  assert.equal(recipeService.Handle_GetCompositeRecipe([-1], session), null);
  const ShipService = require("../src/services/ship/shipService");
  const shipService = new ShipService();
  assert.throws(() => shipService.Handle_BeginScoop([fragmentID], session), "full cargo must prevent pickup");
  assert.equal(store.getFragment(fragmentID).status, "available");
  assert.equal(inventory.updateInventoryItem(cargoID, current => ({ ...current, quantity: 1, stacksize: 1 })).success, true);
  const durations = shipService.Handle_BeginScoop([fragmentID], session);
  assert.equal(durations.length, 2);
  assert.ok(durations.every(Number.isFinite));
  assert.equal(store.getFragment(fragmentID).status, "claimed");
  assert.equal(shipService.Handle_CancelScoop([fragmentID], session), null);
  assert.equal(store.getFragment(fragmentID).status, "available");
  assert.equal(inventory.findItemById(cargoID).quantity, 1, "cancel must not credit picked-up ore");
  const retryDurations = shipService.Handle_BeginScoop([fragmentID], session);
  simulationClock += Math.ceil(retryDurations[0] / 10000);
  voxel.tickScene(activeScene, simulationClock);
  simulationClock += voxel.SCOOP_CHANNEL_MS + 1;
  voxel.tickScene(activeScene, simulationClock);
  assert.equal(store.getFragment(fragmentID).status, "consumed");
  assert.equal(inventory.findItemById(cargoID).quantity, 1 + fragment.quantity);
  assert.equal(activeScene.getEntityByID(fragmentID), null, "completed pickup must remove the visible regolith");
  voxel.tickScene(activeScene, simulationClock + 1000);
  assert.equal(inventory.findItemById(cargoID).quantity, 1 + fragment.quantity,
    "later simulation ticks must not grant the consumed fragment again");

  config.clientBuild = 3502403;
  const legacyAsteroid = structuredClone(originalAsteroid);
  activeScene = sceneFor(legacyAsteroid);
  stateAPI.ensureSceneMiningState(activeScene);
  assert.notEqual(legacyAsteroid.typeID, 95899);
  assert.equal(voxel.isComposite(activeScene, legacyAsteroid, stateAPI.getMineableState(activeScene, asteroidID)), false);
  assert.equal(inventory.updateInventoryItem(cargoID, current => ({ ...current, quantity: 100, stacksize: 100 })).success, true);
  const fullLegacy = mining.executeMiningCycle(activeScene, ship, effect, Date.now(), cycleOptions);
  assert.equal(fullLegacy.success, false);
  assert.equal(fullLegacy.stopReason, "cargo");
  assert.equal(inventory.updateInventoryItem(cargoID, current => ({ ...current, quantity: 1, stacksize: 1 })).success, true);
  const legacy = mining.executeMiningCycle(activeScene, ship, effect, Date.now(), cycleOptions);
  assert.equal(legacy.success, true, JSON.stringify(legacy));
  assert.equal(legacy.data.inventoryCreditedQuantity, 20);
  assert.deepEqual(legacy.data.regolithFragments, []);
  assert.equal(inventory.findItemById(cargoID).quantity, 21);
  assert.equal(store.listFragments(config.voxelMiningWorldRevision, systemID).length, 0,
    "the old build must not produce another fragment");
  assert.equal(database.flushAllSync().success, true);
  database._closeSqliteForTests();
  database._shutdownPersistenceWorkerForTests();
});
