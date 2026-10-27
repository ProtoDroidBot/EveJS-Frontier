"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const npc = require("../src/services/frontier/temporaryLandscapeNpcs");
const profileRevision = "a".repeat(64), policyRevision = "b".repeat(64);
const site = { itemID: 1001, position: { x: 100, y: 200, z: 300 } };
const types = new Map([[83566, { typeID: 83566, name: "Watcher", categoryID: 11, groupID: 5081 }],
  [94167, { typeID: 94167, name: "Mycena", categoryID: 11, groupID: 5130 }],
  [86829, { typeID: 86829, name: "Container", categoryID: 11, groupID: 306 }]]);
const resolveType = id => types.get(Number(id));
const object = (id, role = "npcLocator", extra = {}) => ({ patternKind: "natural", dungeonID: 13660,
  occurrenceIndex: 0, roomID: 42, objectID: id, role, typeID: 91214,
  positionOffset: { x: id, y: 0, z: -id }, ...extra });

test("temporary NPC allocations obey target locator caps, retain authored guards and distinguish fallback roster", () => {
  const locators = [...Array.from({ length: 4 }, (_, i) => object(i + 1)),
    ...Array.from({ length: 4 }, (_, i) => object(i + 10, "threatLocator")),
    ...Array.from({ length: 4 }, (_, i) => object(i + 20, "eventLocator"))];
  const guard = { aggressionRange: 250000, orbitRange: 5000, entitySpawnOnce: 0,
    entityMinRespawnDelay: 3600, entityMaxRespawnDelay: 3600 };
  const authored = object(99, "scenery", { guardCommand: guard, entities: { 88: { entityID: 88,
    npcGroupingID: 33025, triggerSpawn: 0, behaviorName: "1981", groupBehaviorName: "2086" } } });
  const options = { site, ecosystem: { requireAllTags: ["trojan"] }, locators, objects: [authored], resolveType, hasResources: true };
  const plan = npc.buildTemporaryLandscapeNpcAllocation(options);
  assert.equal(plan.npcs.length, 4); // Native caps: one each, plus one authored group binding.
  const binding = plan.npcs.find(entry => entry.nativeEntityID === 88);
  assert.equal(binding.typeID, 83566); assert.equal(binding.guard.entityMinRespawnDelay, 3600);
  assert.deepEqual(binding.positionOffset, authored.positionOffset);
  assert.match(binding.policyProvenance, /temporary/);
  assert.deepEqual(plan.triggers.map(entry => entry.event).sort(), ["mined", "proximity"]);
  assert.equal(plan.npcs.filter(entry => entry.activation === "entry").length, 2);
  assert.deepEqual(plan, npc.buildTemporaryLandscapeNpcAllocation({ ...options, locators: [...locators].reverse() }));
  assert.equal(npc.buildTemporaryLandscapeNpcAllocation({ ...options, ecosystem: { spawnEnabled: false } }).npcs.length, 0);
});

test("native type allocations exclude wrecks and unknown groups; authored trigger-spawn stays gated", () => {
  const objects = [object(1, "scenery", { typeID: 83566, guardCommand: { objectTriggerSpawn: 1 } }),
    object(2, "scenery", { typeID: 86829 }),
    object(3, "scenery", { entities: { 9: { entityID: 9, npcGroupingID: 99999 } } })];
  const plan = npc.buildTemporaryLandscapeNpcAllocation({ site, ecosystem: {}, objects, resolveType });
  assert.equal(plan.npcs.length, 1);
  assert.equal(plan.npcs[0].activation, "trigger");
  assert.equal(plan.npcs[0].triggerSpawn, true);
  assert.equal(plan.replacedObjectKeys.length, 1);
  assert.equal(plan.diagnostics[0].kind, "unresolved-native-npc-group");
  const bad = object(4, "scenery", { typeID: 83566, positionOffset: { x: Infinity, y: 0, z: 0 } });
  assert.throws(() => npc.buildTemporaryLandscapeNpcAllocation({ site, ecosystem: {}, objects: [bad], resolveType }), /finite/);
});

function runtimeFixture() {
  const rows: any[] = [], calls: any[] = [], operations: any[] = [];
  const scene = { systemID: 30000001 }, spec = { key: "npc:a", typeID: 83566,
    positionOffset: { x: 1, y: 2, z: 3 }, guard: { aggressionRange: 120000, orbitRange: 8000 } };
  const options: any = { identity: { profileRevision, policyRevision, systemID: scene.systemID, siteID: site.itemID },
    identitySlot: "profile:policy:system:site:allocation:generation:0", generation: 0, resolveType,
    nativeNpcStore: { listNativeEntitiesForSystem: () => rows }, persistence: { listNpcOperations: () => operations },
    nativeNpcService: {
      spawnNativeNpcEntityInContext(context, definition, opts) {
        calls.push({ context, definition, opts });
        const record = { entityID: 5000, typeID: spec.typeID, npcIdentitySlot: opts.npcIdentitySlot, ...opts.entityScopeMetadata };
        rows.push(record);
        return { success: true, data: { entity: { itemID: record.entityID }, entityRecord: record } };
      },
      materializeStoredNativeController(_scene, id) { return { success: true, data: { entity: { itemID: id } } }; },
    } };
  return { rows, calls, operations, scene, spec, options };
}

test("native adapter recovers spawn-before-receipt by slot, keeps guards active, and supplies no synthetic rewards", () => {
  const f = runtimeFixture();
  const first = npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options);
  assert.equal(first.success, true); assert.equal(first.data.entityID, 5000);
  const second = npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options);
  assert.equal(second.data.reused, true); assert.equal(second.data.entityID, 5000); assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.definition.profile.hardwareFamily, "sdeEntityNpc");
  assert.equal(call.definition.behaviorProfile.aggressionRangeMeters, 120000);
  assert.equal(call.definition.behaviorProfile.orbitDistanceMeters, 8000);
  assert.equal(call.definition.behaviorProfile.autoActivateWeapons, true);
  assert.equal(call.opts.skipInitialBehaviorTick, undefined);
  assert.equal(call.opts.deferInitialBehaviorTick, true);
  assert.equal(call.opts.createNpcPilot, false);
  assert.equal(call.definition.profile.suppressBounty, true);
  assert.equal(call.definition.lootTable, null); assert.deepEqual(call.definition.loadout.modules, []);
  assert.deepEqual(call.opts.spawnStateOverride.position, { x: 101, y: 202, z: 303 });
  assert.equal(f.rows[0].landscapePolicyGeneration, "0");
});

test("native adapter detects identity conflicts, missing receipts and terminal slots instead of duplicating NPCs", () => {
  const f = runtimeFixture();
  f.options.entityID = 123;
  assert.equal(npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options).errorMsg, "LANDSCAPE_NPC_RECEIPT_MISSING");
  delete f.options.entityID;
  f.operations.push({ operationType: "destroy", status: "committed", payload: { npcIdentitySlot: f.options.identitySlot } });
  assert.equal(npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options).data.destroyed, true);
  assert.equal(f.calls.length, 0);
  f.operations.length = 0;
  npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options);
  f.rows[0].temporaryLandscapeRevision = "c".repeat(64);
  assert.equal(npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec, f.options).errorMsg, "LANDSCAPE_NPC_IDENTITY_CONFLICT");
  assert.throws(() => npc.spawnTemporaryLandscapeNpc(f.scene, site, f.spec,
    { ...f.options, identity: { ...f.options.identity, siteID: 44 } }), /identity/);
});

test("temporary native scope validates complete revisions and bulk rehydration leaves inactive NPCs dormant", t => {
  const store = require("../src/space/npc/nativeNpcStore");
  const runtime = require("../src/space/temporaryLandscapeRuntime");
  const service = require("../src/space/npc/nativeNpcService");
  const persistence = require("../src/space/npc/npcRuntimePersistence");
  const metadata = { temporaryLandscapeRevision: profileRevision, temporaryLandscapePolicyRevision: policyRevision,
    landscapeSiteID: site.itemID, landscapePolicyKey: "npc:a", landscapePolicyGeneration: "0" };
  assert.equal(store.validateStoredEntityScopeMetadata(metadata).success, true);
  assert.equal(store.validateStoredEntityScopeMetadata({ ...metadata, landscapePolicyGeneration: "-1" }).success, false);
  assert.equal(store.validateStoredEntityScopeMetadata({ temporaryLandscapeRevision: profileRevision }).success, false);
  t.mock.method(runtime, "isNpcRecordActive", () => false);
  t.mock.method(persistence, "initializeNpcRuntimePersistence", () => ({}));
  t.mock.method(store, "listNativeControllersForSystem", () => [{ entityID: 5000 }]);
  t.mock.method(store, "getNativeEntity", () => ({ entityID: 5000, ...metadata }));
  assert.deepEqual(service.rehydrateStoredNativeControllers({ systemID: 30000001 }), { success: true, data: [] });
  const database = require("../src/gameStore");
  t.after(() => { database._closeSqliteForTests(); database._shutdownPersistenceWorkerForTests(); });
});

test("production native lifecycle journals a temporary NPC, registers active AI and restores its saved condition", t => {
  const store = require("../src/space/npc/nativeNpcStore");
  const service = require("../src/space/npc/nativeNpcService");
  const persistence = require("../src/space/npc/npcRuntimePersistence");
  const registry = require("../src/space/npc/npcRegistry");
  const itemTypes = require("../src/services/inventory/itemTypeRegistry");
  const space = require("../src/space/runtime");
  const policyRuntime = require("../src/space/temporaryLandscapeRuntime");
  const config = require("../src/config"), priorCompatibility = config.clientCompatibilityProfile;
  config.clientCompatibilityProfile = "classic";
  itemTypes._setEntriesForTests([...types.values()].map(type => ({ ...type, radius: 100, mass: 1000 })));
  const entities = new Map();
  const scene = { systemID: 39999994, getEntityByID: id => entities.get(id), getCurrentSimTimeMs: () => 10000 };
  t.mock.method(policyRuntime, "isNpcRecordActive", record => record.temporaryLandscapeRevision === profileRevision);
  t.mock.method(require("../src/space/npc/npcWarpOrigins"), "resolveCollisionSafeScenePosition",
    (_scene, target) => ({ relocated: false, position: target.position }));
  t.mock.method(require("../src/services/frontier/iffAbilityHandlers"), "scheduleIffVerdicts", () => false);
  t.mock.method(space, "spawnDynamicShip", (_id, spec) => {
    const entity = { ...spec, kind: "ship", position: spec.spaceState.position };
    entities.set(entity.itemID, entity);
    return { success: true, data: { entity } };
  });
  const spec = { key: "production-npc", typeID: 83566, positionOffset: { x: 10, y: 20, z: 30 },
    guard: { aggressionRange: 250000, orbitRange: 5000 } };
  const options = { identity: { profileRevision, policyRevision, siteID: site.itemID, systemID: scene.systemID },
    identitySlot: "production-landscape-npc-slot", resolveType };
  const created = npc.spawnTemporaryLandscapeNpc(scene, site, spec, options);
  assert.equal(created.success, true, created.errorMsg);
  const id = created.data.entityID;
  t.after(() => {
    registry.unregisterController(id); itemTypes._setEntriesForTests(null); config.clientCompatibilityProfile = priorCompatibility;
    const database = require("../src/gameStore"); database._closeSqliteForTests(); database._shutdownPersistenceWorkerForTests();
  });
  const stored = store.getNativeEntity(id), controller = registry.getControllerByEntityID(id);
  assert.equal(stored.typeID, 83566); assert.equal(stored.npcPilotRequested, false);
  assert.equal(stored.bounty, 0); assert.equal(stored.lootTableID, null);
  assert.equal(stored.temporaryLandscapeRevision, profileRevision); assert.equal(stored.landscapePolicyKey, spec.key);
  assert.ok(controller); assert.notEqual(controller.nextThinkAtMs, Number.MAX_SAFE_INTEGER);
  assert.equal(controller.behaviorProfile.autoActivateWeapons, true);
  assert.ok(persistence.listNpcOperations({ operationType: "spawn", status: "committed" })
    .some(operation => operation.payload.npcIdentitySlot === options.identitySlot));
  const runtimeEntity = entities.get(id);
  runtimeEntity.conditionState = { damage: 0.15, armorDamage: 0.2, shieldCharge: 0.25, charge: 1 };
  assert.equal(service.persistNativeRuntimeEntity(runtimeEntity).success, true);
  entities.clear(); registry.unregisterController(id);
  const restored = npc.spawnTemporaryLandscapeNpc(scene, site, spec, { ...options, entityID: id });
  assert.equal(restored.success, true, restored.errorMsg); assert.equal(restored.data.entityID, id);
  assert.equal(restored.data.entity.conditionState.shieldCharge, 0.25);
  assert.equal(restored.data.entity.landscapePolicyKey, spec.key);
  assert.equal(store.listNativeEntitiesForSystem(scene.systemID).length, 1);
});
