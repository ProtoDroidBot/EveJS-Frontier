"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const spaceRuntime = require("../src/space/runtime");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const nativeNpcService = require("../src/space/npc/nativeNpcService");
const npcRuntimePersistence = require("../src/space/npc/npcRuntimePersistence");
const npcRegistry = require("../src/space/npc/npcRegistry");
const config = require("../src/config");
const database = require("../src/gameStore");

test("durable NPC checkpoints retain movement and shield/armor/hull condition", (t) => {
  const storedRecord: Record<string, any> = {
    entityID: 980000000123,
    systemID: 30000004,
    nativeNpc: true,
    transient: false,
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 1, y: 2, z: 3 },
    mode: "STOP",
    speedFraction: 0,
    conditionState: {
      shieldCharge: 1,
      armorDamage: 0,
      damage: 0,
    },
  };
  let writtenRecord = null;
  let writtenOptions = null;
  t.mock.method(nativeNpcStore, "getNativeEntity", () => storedRecord);
  t.mock.method(nativeNpcStore, "upsertNativeEntity", (record, options) => {
    writtenRecord = record;
    writtenOptions = options;
    return { success: true };
  });

  const runtimeEntity: Record<string, any> = {
    kind: "ship",
    itemID: storedRecord.entityID,
    nativeNpc: true,
    position: { x: 45_000, y: -12_000, z: 900 },
    velocity: { x: 30, y: 4, z: -2 },
    direction: { x: 0, y: 1, z: 0 },
    targetPoint: { x: 46_000, y: -12_000, z: 900 },
    mode: "GOTO",
    speedFraction: 0.65,
    targetEntityID: 980000000456,
    followRange: 12_500,
    orbitDistance: 8_000,
    maxVelocity: 275,
    conditionState: {
      shieldCharge: 0.28,
      armorDamage: 0.36,
      damage: 0.19,
      charge: 0.51,
      incapacitated: false,
    },
  };

  const result = nativeNpcService.persistNativeRuntimeEntity(runtimeEntity, {
    nowMs: 123_456,
  });

  assert.equal(result.success, true);
  assert.deepEqual(writtenRecord.position, runtimeEntity.position);
  assert.deepEqual(writtenRecord.velocity, runtimeEntity.velocity);
  assert.deepEqual(writtenRecord.direction, runtimeEntity.direction);
  assert.deepEqual(writtenRecord.targetPoint, runtimeEntity.targetPoint);
  assert.equal(writtenRecord.mode, "GOTO");
  assert.equal(writtenRecord.speedFraction, 0.65);
  assert.equal(writtenRecord.targetEntityID, runtimeEntity.targetEntityID);
  assert.equal(writtenRecord.followRange, runtimeEntity.followRange);
  assert.equal(writtenRecord.orbitDistance, runtimeEntity.orbitDistance);
  assert.equal(writtenRecord.maxVelocity, runtimeEntity.maxVelocity);
  assert.deepEqual(writtenRecord.conditionState, runtimeEntity.conditionState);
  assert.deepEqual(writtenOptions, { transient: false });
  assert.equal(runtimeEntity.lastPersistAt, 123_456);
});

test("disabled startup rule leaves its durable NPC stored but dormant", (t) => {
  const entityID = 980000000124;
  const controller = { entityID, systemID: 30000004, startupRuleID: "test:startup", transient: false };
  const entity = { entityID, systemID: 30000004, transient: false };
  t.mock.method(nativeNpcStore, "listNativeControllersForSystem", () => [controller]);
  t.mock.method(nativeNpcStore, "getNativeEntity", () => entity);
  t.mock.method(npcRuntimePersistence, "initializeNpcRuntimePersistence", () => ({}));
  const scene = { systemID: 30000004 };
  assert.deepEqual(nativeNpcService.cleanupStaleNativeStartupControllers(scene), []);
  assert.deepEqual(nativeNpcService.rehydrateStoredNativeControllers(scene, {
    activeStartupRuleIDs: [],
  }), { success: true, data: [] });
});

test("durable NPC rehydration keeps its ID, fittings, properties, and manual order", (t) => {
  const previousProfile = config.clientCompatibilityProfile;
  config.clientCompatibilityProfile = "classic";
  const entityID = 980000000125;
  const fitted = [{ itemID: 980100000125, typeID: 12345, flagID: 27 }];
  const entityRecord = {
    entityID, systemID: 30000004, transient: false, nativeNpc: true,
    typeID: 72207, groupID: 759, categoryID: 11, itemName: "Restored NPC",
    npcEntityType: "npc", radius: 100, position: { x: 100, y: 200, z: 300 },
    velocity: { x: 4, y: 5, z: 6 }, direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 700, y: 800, z: 900 }, mode: "FOLLOW", speedFraction: 0.5,
    targetEntityID: 76543, followRange: 5000, orbitDistance: 0, maxVelocity: 250,
    conditionState: { shieldCharge: 0.4, armorDamage: 0.2, damage: 0.1 },
  };
  const manualOrder = { type: "approach", targetEntityID: 76543 };
  const controllerRecord = {
    entityID, systemID: 30000004, transient: false, profileID: "snapshot_only",
    runtimeKind: "nativeCombat", manualOrder, returningHome: true,
    lastHomeCommandAtMs: 1234, lastHomeDirection: { x: 0, y: 1, z: 0 },
    definitionSnapshot: {
      profile: { profileID: "snapshot_only", name: "Restored NPC" },
      loadout: { loadoutID: "snapshot_loadout", modules: [], charges: [] },
      behaviorProfile: { behaviorProfileID: "snapshot_behavior" },
      behaviorPolicy: { role: "combat", activity: "combat" },
    },
  };
  t.mock.method(nativeNpcStore, "getNativeEntity", () => entityRecord);
  t.mock.method(nativeNpcStore, "getNativeController", () => controllerRecord);
  t.mock.method(nativeNpcStore, "validateStoredEntityScopeMetadata", () => ({ success: true, data: { metadata: {} } }));
  t.mock.method(nativeNpcStore, "buildNativeFittedItems", () => fitted);
  t.mock.method(nativeNpcStore, "buildNativeCargoItems", () => []);
  t.mock.method(nativeNpcStore, "buildNativeSlimModuleTuples", () => []);
  t.mock.method(npcRuntimePersistence, "initializeNpcRuntimePersistence", () => ({}));
  t.mock.method(npcRuntimePersistence, "isNpcEntityQuarantined", () => false);
  t.mock.method(npcRuntimePersistence, "acquireSpawnLease", () => ({ success: true, data: { token: "test" } }));
  t.mock.method(require("../src/space/npc/npcWarpOrigins"), "resolveCollisionSafeScenePosition", (_scene, target) => ({ relocated: false, position: target.position }));
  t.mock.method(require("../src/services/frontier/iffAbilityHandlers"), "scheduleIffVerdicts", () => false);
  t.mock.method(spaceRuntime, "spawnDynamicShip", (_systemID, spec) => ({
    success: true, data: { entity: { ...spec, kind: "ship", position: spec.spaceState.position } },
  }));
  t.after(() => {
    npcRegistry.unregisterController(entityID);
    config.clientCompatibilityProfile = previousProfile;
  });
  const scene = { systemID: 30000004, getEntityByID: () => null };
  const result = nativeNpcService.materializeStoredNativeController(scene, entityID, { broadcast: false });
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.entity.itemID, entityID);
  assert.deepEqual(result.data.entity.fittedItems, fitted);
  assert.deepEqual(result.data.entity.conditionState, entityRecord.conditionState);
  assert.deepEqual(result.data.entity.spaceState.position, entityRecord.position);
  assert.equal(result.data.entity.targetEntityID, entityRecord.targetEntityID);
  assert.deepEqual(result.data.controller.manualOrder, manualOrder);
  assert.equal(result.data.controller.returningHome, true);
});

test("async scene bootstrap restores a durable NPC when authored startup is skipped", async (t) => {
  const systemID = 39_999_995;
  const entityID = 980000000995;
  const tables = ["npcRuntimeState", "npcEntities", "npcRuntimeControllers"];
  const originals = tables.map((table) => [table, structuredClone(database.read(table, "/").data || {})]);
  const previousSkip = process.env.EVEJS_SKIP_NPC_STARTUP;
  const previousAsteroidsEnabled = config.asteroidFieldsEnabled;
  const previousMiningEnabled = config.miningEnabled;
  process.env.EVEJS_SKIP_NPC_STARTUP = "1";
  config.asteroidFieldsEnabled = false;
  config.miningEnabled = false;
  t.after(() => {
    spaceRuntime.scenes.delete(systemID);
    npcRegistry.unregisterController(entityID);
    for (const [table, value] of originals) database.write(table, "/", value, { force: true });
    database.flushTablesSync(tables);
    config.asteroidFieldsEnabled = previousAsteroidsEnabled;
    config.miningEnabled = previousMiningEnabled;
    if (previousSkip === undefined) delete process.env.EVEJS_SKIP_NPC_STARTUP;
    else process.env.EVEJS_SKIP_NPC_STARTUP = previousSkip;
  });

  assert.equal(nativeNpcStore.upsertNativeEntity({
    entityID, systemID, nativeNpc: true, transient: false,
    npcPilotRequested: false, typeID: 72207, groupID: 759, categoryID: 11,
    itemName: "Restarted NPC", npcEntityType: "npc", radius: 100,
    position: { x: 100, y: 200, z: 300 },
    velocity: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 },
    targetPoint: { x: 100, y: 200, z: 300 }, mode: "STOP",
    conditionState: { shieldCharge: 0.4, armorDamage: 0.2, damage: 0.1 },
  }, { durable: true }).success, true);
  assert.equal(nativeNpcStore.upsertNativeController({
    entityID, systemID, transient: false, profileID: "restart_snapshot",
    runtimeKind: "nativeCombat", manualOrder: { type: "hold" },
    definitionSnapshot: {
      profile: { profileID: "restart_snapshot", name: "Restarted NPC" },
      loadout: { loadoutID: "restart_empty", modules: [], charges: [] },
      behaviorProfile: { behaviorProfileID: "restart_behavior", autoAggro: false },
      behaviorPolicy: { role: "combat", activity: "combat" },
    },
  }, { durable: true }).success, true);

  const scene = await spaceRuntime.ensureSceneReady(systemID, {
    reconcileUniverseSites: false,
    materializeUniverseSites: false,
    refreshStargates: false,
  });
  assert.equal(scene._bootstrapReady, true);
  assert.equal(scene._npcStartupInitialized, true);
  assert.equal(scene.getEntityByID(entityID)?.itemID, entityID);
  assert.equal(npcRegistry.getControllerByEntityID(entityID)?.manualOrder?.type, "hold");
});
