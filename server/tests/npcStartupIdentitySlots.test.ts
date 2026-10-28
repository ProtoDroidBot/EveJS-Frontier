"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const registry = require("../src/space/npc/npcRegistry");
const nativeNpcService = require("../src/space/npc/nativeNpcService");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const spaceRuntime = require("../src/space/runtime");
const npcData = require("../src/space/npc/npcData");

function loadNpcService(t) {
  // Loading nativeNpcService first can make the runtime's startup dependency
  // capture its unfinished CommonJS exports. Load this test subject only after
  // the shared runtime/native dependencies have completed initialization.
  const modulePath = require.resolve("../src/space/npc/npcService");
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  const npcService = require(modulePath);
  t.after(() => { if (cached) require.cache[modulePath] = cached; else delete require.cache[modulePath]; });
  return npcService;
}

function fixture(t) {
  const entities = new Map<any, any>();
  const storedEntities = new Map<any, any>();
  const storedControllers = new Map<any, any>();
  const registeredIDs = new Set<any>();
  const scene = {
    systemID: 30_000_142,
    dynamicEntities: entities,
    sessions: new Map([[1, {}]]),
    getEntityByID(entityID) { return entities.get(entityID); },
  };
  t.mock.method(spaceRuntime, "ensureScene", () => scene);
  t.mock.method(nativeNpcStore, "listNativeControllersForSystem", () => [...storedControllers.values()]);
  t.mock.method(nativeNpcStore, "getNativeEntity", (entityID) => storedEntities.get(entityID));
  const register = (entity, controller) => {
    entities.set(entity.itemID, entity);
    registry.registerController(controller);
    registeredIDs.add(entity.itemID);
  };
  const remove = (entityID) => {
    entities.delete(entityID);
    registry.unregisterController(entityID);
    storedEntities.delete(entityID);
    storedControllers.delete(entityID);
  };
  t.after(() => {
    for (const entityID of registeredIDs) registry.unregisterController(entityID);
  });
  return { scene, entities, storedEntities, storedControllers, register, remove };
}

test("startup authorities reuse missing group ordinals while retaining partial and virtualized groups", (t) => {
  const npcService = loadNpcService(t);
  const f = fixture(t);
  const anchor = { itemID: 50_001_248, kind: "stargate", position: { x: 0, y: 0, z: 0 } };
  f.entities.set(anchor.itemID, anchor);
  const rule = {
    startupRuleID: "customs:gate",
    spawnGroupID: "customs",
    groupsPerAnchor: 2,
    anchorSelector: { entityID: anchor.itemID },
  };
  const calls: any[] = [];
  let nextEntityID = 980_000_080_000;
  t.mock.method(nativeNpcService, "spawnNativeNpcGroupInSystem", (_systemID, options) => {
    calls.push(options);
    const spawned = [0, 1].map((index) => {
      const entity = { itemID: ++nextEntityID, npcIdentitySlot: `${options.npcIdentitySlot}:member:${index}` };
      f.register(entity, {
        entityID: entity.itemID,
        systemID: f.scene.systemID,
        startupRuleID: rule.startupRuleID,
        anchorID: anchor.itemID,
      });
      return { entity };
    });
    return { success: true, data: { spawned } };
  });
  const first = npcService._testing.spawnStartupRuleInScene(f.scene, rule);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].npcIdentitySlot, "startup:30000142:rule:customs%3Agate:anchor:50001248:group:0");
  assert.equal(calls[1].npcIdentitySlot, "startup:30000142:rule:customs%3Agate:anchor:50001248:group:1");
  assert.equal(npcService._testing.getStartupRuleMissingCount(f.scene, rule).data.missingCount, 0);

  f.remove(first.data.spawned[0].entity.itemID);
  assert.equal(npcService._testing.getStartupRuleMissingCount(f.scene, rule).data.missingCount, 0);
  npcService._testing.spawnStartupRuleInScene(f.scene, rule);
  assert.equal(calls.length, 2);

  // Dormant/persisted members must reserve the same group even without balls.
  for (const entry of first.data.spawned.slice(2)) {
    const controller = registry.getControllerByEntityID(entry.entity.itemID);
    f.storedControllers.set(entry.entity.itemID, controller);
    f.storedEntities.set(entry.entity.itemID, entry.entity);
    registry.unregisterController(entry.entity.itemID);
    f.entities.delete(entry.entity.itemID);
  }
  f.remove(first.data.spawned[1].entity.itemID);
  assert.equal(npcService._testing.getStartupRuleMissingCount(f.scene, rule).data.missingCount, 1);
  npcService._testing.spawnStartupRuleInScene(f.scene, rule);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].npcIdentitySlot, calls[0].npcIdentitySlot);
});

test("exact EverMore replacements retain each gate layout slot", (t) => {
  const f = fixture(t);
  // npcService captures this definition builder during module initialization.
  t.mock.method(npcData, "buildNpcDefinition", (profileID) => ({ profile: { profileID } }));
  const npcService = loadNpcService(t);
  const anchor = { itemID: 50_001_248, kind: "stargate", position: { x: 0, y: 0, z: 0 } };
  const rule = { startupRuleID: "evermore", spawnGroupID: "customs" };
  const calls: any[] = [];
  let nextEntityID = 980_000_090_000;
  t.mock.method(nativeNpcService, "spawnNativeNpcEntityInContext", (_context, _definition, options) => {
    calls.push(options);
    const entity = { itemID: ++nextEntityID, position: options.spawnStateOverride.position };
    f.register(entity, {
      entityID: entity.itemID,
      systemID: f.scene.systemID,
      startupRuleID: rule.startupRuleID,
      anchorID: anchor.itemID,
      startupSlotIndex: options.startupSlotIndex,
    });
    return { success: true, data: { entity } };
  });
  const spawn = () => npcService._testing.spawnExactEverMoreGatePresenceForAnchor(
    f.scene, rule, anchor, { broadcast: false },
  );
  const first = spawn();
  const count = calls.length;
  assert.ok(count > 1);
  assert.equal(calls[0].npcIdentitySlot, "startup:30000142:rule:evermore:anchor:50001248:slot:0");
  assert.equal(new Set(calls.map((call) => call.npcIdentitySlot)).size, count);
  f.remove(first.data.spawned[1].entity.itemID);
  spawn();
  assert.equal(calls.length, count + 1);
  assert.equal(calls[count].npcIdentitySlot, calls[1].npcIdentitySlot);
});

test("Drifter reinforcement requests reuse failed slots and separate successive waves and parents", (t) => {
  const behavior = require("../src/space/npc/npcBehaviorLoop").__testing;
  const scene = { systemID: 30_000_142, getEntityByID() { return null; } };
  const entity = {
    itemID: 980_000_100_001,
    systemID: scene.systemID,
    kind: "ship",
    nativeNpc: true,
    factionID: 500024,
    npcIdentitySlot: "startup:30000142:rule:drifter:anchor:1:group:0:member:0",
  };
  const controller: any = { entityID: entity.itemID, lastAggressedAtMs: 10_000 };
  const profile = {
    maxReinforcementCalls: 4,
    reinforcementCooldownMs: 1_000,
    reinforcementDefinitions: [{ profile: {}, behaviorProfile: {} }],
  };
  const target = { itemID: 900_000_000_001 };
  const calls: any[] = [];
  let fail = true;
  t.mock.method(nativeNpcService, "spawnNativeDefinitionsInContext", (_context, _selection, options) => {
    calls.push(options);
    return fail ? { success: false } : { success: true, data: { spawned: [{}] } };
  });
  const spawn = (nowMs, spawnEntity = entity, spawnController = controller) => behavior.maybeRequestDrifterReinforcements(
    scene, spawnEntity, spawnController, profile, target, nowMs,
  );
  assert.equal(spawn(10_001).requested, false);
  fail = false;
  assert.equal(spawn(10_001).requested, true);
  assert.equal(spawn(12_001).requested, true);
  assert.equal(calls[0].npcIdentitySlot, `${entity.npcIdentitySlot}:reinforcement:0`);
  assert.equal(calls[1].npcIdentitySlot, calls[0].npcIdentitySlot);
  assert.equal(calls[2].npcIdentitySlot, `${entity.npcIdentitySlot}:reinforcement:1`);
  spawn(12_001, { ...entity, itemID: entity.itemID + 1 }, { entityID: entity.itemID + 1, lastAggressedAtMs: 12_000 });
  assert.equal(calls[3].npcIdentitySlot, calls[0].npcIdentitySlot);
  spawn(12_001, { ...entity, npcIdentitySlot: `${entity.npcIdentitySlot}:other` }, { lastAggressedAtMs: 12_000 });
  assert.notEqual(calls[4].npcIdentitySlot, calls[0].npcIdentitySlot);
  spawn(12_001, { ...entity, npcIdentitySlot: "" }, { lastAggressedAtMs: 12_000 });
  assert.equal(calls[5].npcIdentitySlot, undefined);
});
