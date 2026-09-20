"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const miningRuntime = require("../src/services/mining/miningRuntime");
const miningNpcOperations = require("../src/services/mining/miningNpcOperations");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const behaviorRuntime = require("../src/space/npc/npcBehaviorTreeRuntime");
const npcFittingService = require("../src/space/npc/npcFittingService");
const resourceJobs = require("../src/space/npc/npcResourceJobService");

const TABLES = [
  "npcRuntimeState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcPilotIdentities",
  "npcWrecks",
  "npcWreckItems",
];
const ENTITY_ID = 980000000801;
const NPC_CHARACTER_ID = 1500000801;
const OWNER_ID = 500801;
const SYSTEM_ID = 30000004;
const DESTINATION_ID = 600000801;
const RESOURCE_TYPE_ID = 990801;

function emptyTables() {
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.write("npcWrecks", "/", { nextWreckID: 980300000000, wrecks: {} }, { force: true });
  database.write("npcWreckItems", "/", { nextWreckItemID: 980400000000, items: {} }, { force: true });
  database.write("npcPilotIdentities", "/", {
    version: 1,
    nextCharacterID: 1500000000,
    pilots: {},
    slots: {},
    factions: {},
  }, { force: true });
  database.flushTablesSync(TABLES);
  persistence._testing.resetRuntimeForTests();
}

function fixture(t) {
  const backupTables = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  const backupItems = structuredClone(itemStore.getAllItems());
  emptyTables();
  itemTypeRegistry._setEntriesForTests([{
    typeID: RESOURCE_TYPE_ID,
    groupID: 450,
    categoryID: 25,
    groupName: "Resource",
    name: "Phase Two Ore",
    portionSize: 1,
    volume: 2,
  }]);
  itemStore.resetInventoryStoreForTests();
  assert.equal(itemStore._writeItemsForTest({}, { force: true }), true);
  database.flushTableSync(itemStore.ITEMS_TABLE);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  t.after(() => {
    behaviorRuntime.eventInbox.clear(NPC_CHARACTER_ID);
    itemStore._writeItemsForTest(backupItems, { force: true });
    for (const [table, value] of Object.entries(backupTables)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
    persistence._testing.resetRuntimeForTests();
  });
}

function createNpc() {
  const entityRecord = {
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    typeID: 587,
    groupID: 25,
    categoryID: 6,
    ownerID: OWNER_ID,
    npcCharacterID: NPC_CHARACTER_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
  };
  assert.equal(nativeStore.upsertNativeEntity(entityRecord, { durable: true }).success, true);
  assert.equal(nativeStore.upsertNativeController({
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    npcCharacterID: NPC_CHARACTER_ID,
    npcIncarnation: 1,
    transient: false,
  }, { durable: true }).success, true);
  database.flushTablesSync([nativeStore.TABLE.ENTITIES, nativeStore.TABLE.CONTROLLERS]);
  return entityRecord;
}

function runtimeEntity() {
  return {
    itemID: ENTITY_ID,
    systemID: SYSTEM_ID,
    ownerID: OWNER_ID,
    npcCharacterID: NPC_CHARACTER_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
    nativeCargoItems: nativeStore.buildNativeCargoItems(ENTITY_ID),
  };
}

test("durable resource reservations are exclusive, renewable, and expire", (t) => {
  fixture(t);
  const first = persistence.createNpcJob({
    npcCharacterID: NPC_CHARACTER_ID,
    incarnation: 1,
    jobType: "resource.work",
    allowConcurrent: true,
  }).data;
  const second = persistence.createNpcJob({
    npcCharacterID: NPC_CHARACTER_ID + 1,
    incarnation: 1,
    jobType: "resource.work",
    allowConcurrent: true,
  }).data;
  assert.equal(persistence.acquireNpcJobReservation(first.jobID, {
    resourceKey: "resource-target:30000004:42",
    nowMs: 1_000,
    ttlMs: 2_000,
  }).success, true);
  assert.equal(persistence.acquireNpcJobReservation(second.jobID, {
    resourceKey: "resource-target:30000004:42",
    nowMs: 2_000,
  }).errorMsg, "NPC_RESOURCE_RESERVED");
  assert.equal(persistence.acquireNpcJobReservation(second.jobID, {
    resourceKey: "resource-target:30000004:42",
    nowMs: 3_001,
  }).success, true);
  assert.equal(persistence.listNpcJobReservations(first.jobID, { nowMs: 3_001 }).length, 0);
});

test("generic resource executor checkpoints target work and releases its claim", (t) => {
  fixture(t);
  createNpc();
  resourceJobs.registerNpcResourceJobHandlers();
  let depleted = false;
  const unregister = resourceJobs.registerNpcResourceDefinition("test-ore-801", {
    resolveTool() {
      return { moduleItem: { itemID: 980100000801 }, rangeMeters: 5_000 };
    },
    listTargets() {
      return [{ entity: { itemID: 42, position: { x: 100, y: 0, z: 0 }, radius: 10 } }];
    },
    getTarget(_context, targetID) {
      return { itemID: targetID, position: { x: 100, y: 0, z: 0 }, radius: 10 };
    },
    getTargetState() {
      return { remainingQuantity: depleted ? 0 : 10 };
    },
    isTargetDepleted() {
      return depleted;
    },
    getDistance() {
      return 90;
    },
    approach() {
      return true;
    },
    lockTarget() {
      return { success: true };
    },
    activate() {
      return { success: true };
    },
    getCargoState() {
      return { quantity: 0, usedVolumeM3: 0, capacityM3: 100 };
    },
  });
  t.after(unregister);
  const job = resourceJobs.createNpcResourceJob({
    entityID: ENTITY_ID,
    resourceKind: "test-ore-801",
    idempotencyKey: "phase2:test-work",
  }).data;
  assert.equal(miningNpcOperations._testing.hasActiveDurableResourceJob({
    npcCharacterID: NPC_CHARACTER_ID,
    npcIncarnation: 1,
  }), true);
  const entity = runtimeEntity();
  const controller = { entityID: ENTITY_ID, npcCharacterID: NPC_CHARACTER_ID, npcIncarnation: 1 };
  const scene = { systemID: SYSTEM_ID };
  const first = behaviorRuntime.tickDurableNpcJob(scene, entity, controller, 1_000);
  assert.equal(first.status, behaviorRuntime.STATUS.RUNNING);
  assert.equal(persistence.getNpcJob(job.jobID).step, "harvesting");
  assert.equal(persistence.listNpcJobReservations(job.jobID).length, 1);
  depleted = true;
  const second = behaviorRuntime.tickDurableNpcJob(scene, entity, controller, 2_000);
  assert.equal(second.status, behaviorRuntime.STATUS.SUCCESS);
  assert.equal(persistence.getNpcJob(job.jobID).status, "completed");
  assert.equal(persistence.listNpcJobReservations(job.jobID).length, 0);
});

test("resource executor suspends durably and authors a missing-tool request", (t) => {
  fixture(t);
  createNpc();
  resourceJobs.registerNpcResourceJobHandlers();
  const unregister = resourceJobs.registerNpcResourceDefinition("test-tool-801", {
    resolveTool() { return null; },
    listTargets() { return []; },
  });
  t.after(unregister);
  const job = resourceJobs.createNpcResourceJob({
    entityID: ENTITY_ID,
    resourceKind: "test-tool-801",
  }).data;
  const result = behaviorRuntime.tickDurableNpcJob(
    { systemID: SYSTEM_ID },
    runtimeEntity(),
    { entityID: ENTITY_ID },
    1_000,
  );
  assert.equal(result.status, behaviorRuntime.STATUS.SUSPENDED);
  const stored = persistence.getNpcJob(job.jobID);
  assert.equal(stored.step, "awaiting-tool");
  assert.equal(stored.checkpoint.toolRequest.semanticRole, "mining");
});

test("built-in mining adapter selects fitted tools by effect and mining family", (t) => {
  fixture(t);
  createNpc();
  assert.equal(nativeStore.upsertNativeModule({
    moduleID: 980100000801,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    typeID: 990802,
    groupID: 54,
    categoryID: 7,
    itemName: "Authored Resource Extractor",
    flagID: 11,
    singleton: true,
    semanticRole: "mining",
    moduleState: { online: true, damage: 0 },
  }, { durable: true }).success, true);
  assert.equal(nativeStore.upsertNativeCargo({
    cargoID: 980200000801,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    typeID: 990803,
    groupID: 482,
    categoryID: 8,
    itemName: "Phase Two Asteroid Lens",
    quantity: 1,
    singleton: false,
    moduleID: 980100000801,
    semanticRole: "ammunition",
    moduleState: { damage: 0 },
  }, { durable: true }).success, true);
  t.mock.method(miningRuntime, "findMiningEffectRecordForModule", () => ({
    effectID: 17,
    name: "miningLaser",
  }));
  t.mock.method(miningRuntime, "buildEntityMiningSnapshot", () => ({
    family: "ore",
    moduleTypeID: 990802,
    chargeTypeID: 990803,
    maxRangeMeters: 12_000,
  }));
  const definition = resourceJobs.getNpcResourceDefinition("mining");
  const entity = {
    ...runtimeEntity(),
    fittedItems: nativeStore.buildNativeFittedItems(ENTITY_ID),
  };
  const tool = definition.resolveTool({
    entity,
    nowMs: 1_000,
    job: { payload: {} },
  }, "mining");
  assert.equal(tool.moduleItem.itemID, 980100000801);
  assert.equal(tool.effectRecord.name, "miningLaser");
  assert.equal(tool.rangeMeters, 12_000);
  assert.equal(definition.resolveTool({
    entity,
    nowMs: 1_000,
    job: { payload: {} },
  }, "gas"), null);
});

test("built-in mining adapter accepts a legacy ore miner with no charge bay", (t) => {
  fixture(t);
  createNpc();
  assert.equal(nativeStore.upsertNativeModule({
    moduleID: 980100000811,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    typeID: 990811,
    groupID: 54,
    categoryID: 7,
    itemName: "Basic Legacy Miner",
    flagID: 11,
    singleton: true,
    semanticRole: "mining",
    moduleState: { online: true, damage: 0 },
  }, { durable: true }).success, true);
  t.mock.method(miningRuntime, "findMiningEffectRecordForModule", () => ({
    effectID: 17,
    name: "miningLaser",
  }));
  t.mock.method(miningRuntime, "buildEntityMiningSnapshot", () => ({
    family: "ore",
    moduleTypeID: 990811,
    chargeTypeID: 0,
    maxRangeMeters: 10_000,
  }));

  const definition = resourceJobs.getNpcResourceDefinition("mining");
  const tool = definition.resolveTool({
    entity: {
      ...runtimeEntity(),
      fittedItems: nativeStore.buildNativeFittedItems(ENTITY_ID),
    },
    nowMs: 1_000,
    job: { payload: {} },
  }, "mining");
  assert.ok(tool);
  assert.equal(tool.moduleItem.itemID, 980100000811);
  assert.equal(tool.chargeItem, null);
});

test("NPC mining compatibility enforces crude, asteroid-lens, and group-5133 boundaries", () => {
  const compatible = miningRuntime._testing.isMiningSnapshotCompatibleWithState;
  const options = {
    isChargeCompatibleWithModule: () => true,
    miningModuleUsesCrystals: (typeID) => Number(typeID) === 990812,
    matchesTypeList(typeContext, listID) {
      const members = {
        601: new Set([92394]),
        612: new Set([91374, 95349]),
      };
      return members[listID] && members[listID].has(Number(typeContext && typeContext.typeID));
    },
  };
  const asteroid = { yieldTypeID: 91374, yieldKind: "ore" };
  const crude = { yieldTypeID: 92394, yieldKind: "ore" };
  const salvageableWreckage = { yieldTypeID: 95349, yieldKind: "salvage" };
  const asteroidEntity = { itemID: 201, kind: "asteroid", groupID: 450 };
  const crudeEntity = { itemID: 202, kind: "riftEnvironmentProp", groupID: 4593, frontierRiftResource: true };
  const salvageableEntity = { itemID: 203, kind: "landscapeProp", groupID: 5133 };
  const ordinaryWreck = { itemID: 204, kind: "wreck", groupID: 186 };
  const cuttingLaser = {
    family: "ore",
    moduleTypeID: 95317,
    chargeTypeID: 83463,
    crystalTargetTypeListID: 612,
  };
  const crudeExtractor = {
    family: "ore",
    moduleTypeID: 95503,
    chargeTypeID: 77518,
    crystalTargetTypeListID: 601,
  };
  const basicLegacyMiner = {
    family: "ore",
    moduleTypeID: 990811,
    chargeTypeID: 0,
    crystalTargetTypeListID: 0,
  };
  const lenslessModulatedMiner = {
    family: "ore",
    moduleTypeID: 990812,
    chargeTypeID: 0,
    crystalTargetTypeListID: 0,
  };

  assert.equal(compatible(basicLegacyMiner, asteroid, asteroidEntity, options), true);
  assert.equal(compatible(basicLegacyMiner, salvageableWreckage, salvageableEntity, options), true);
  assert.equal(compatible(basicLegacyMiner, crude, crudeEntity, options), false);
  assert.equal(compatible(lenslessModulatedMiner, asteroid, asteroidEntity, options), false);
  assert.equal(compatible({ ...cuttingLaser, chargeTypeID: 0 }, asteroid, asteroidEntity, options), false);
  assert.equal(compatible(cuttingLaser, asteroid, asteroidEntity, options), true);
  assert.equal(compatible(cuttingLaser, crude, crudeEntity, options), false);
  assert.equal(compatible(crudeExtractor, crude, crudeEntity, options), true);
  assert.equal(compatible(crudeExtractor, asteroid, asteroidEntity, options), false);
  assert.equal(compatible(cuttingLaser, salvageableWreckage, salvageableEntity, options), true);
  assert.equal(compatible(cuttingLaser, salvageableWreckage, ordinaryWreck, options), false);
  assert.ok(resourceJobs.getNpcResourceDefinition("crude"));
  assert.equal(resourceJobs.getNpcResourceDefinition("salvage"), null);
  assert.equal(resourceJobs.getNpcResourceDefinition("recovery"), null);
});

test("Crude Extractor jobs use a charged lock-free held-beam cycle", (t) => {
  fixture(t);
  createNpc();
  const moduleID = 980100000802;
  const chargeID = 980200000802;
  assert.equal(nativeStore.upsertNativeModule({
    moduleID,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    typeID: 95503,
    groupID: 54,
    categoryID: 7,
    itemName: "Crude Extractor",
    flagID: 11,
    singleton: true,
    semanticRole: "mining",
    moduleState: { online: true, damage: 0 },
  }, { durable: true }).success, true);
  assert.equal(nativeStore.upsertNativeCargo({
    cargoID: chargeID,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    typeID: 77518,
    groupID: 482,
    categoryID: 8,
    itemName: "Crude Lens",
    quantity: 1,
    singleton: false,
    moduleID,
    semanticRole: "ammunition",
    moduleState: { damage: 0 },
  }, { durable: true }).success, true);
  t.mock.method(miningRuntime, "buildEntityMiningSnapshot", () => ({
    family: "ore",
    moduleTypeID: 95503,
    chargeTypeID: 77518,
    crystalTargetTypeListID: 601,
    maxRangeMeters: 8_000,
    durationMs: 1_000,
  }));
  let cycles = 0;
  t.mock.method(miningRuntime, "executeSkillShotMiningCycle", () => {
    cycles += 1;
    return { matched: true, success: true, data: { transferredQuantity: 2 } };
  });

  const entity = {
    ...runtimeEntity(),
    fittedItems: nativeStore.buildNativeFittedItems(ENTITY_ID),
    nativeCargoItems: nativeStore.buildNativeCargoItems(ENTITY_ID),
  };
  const definition = resourceJobs.getNpcResourceDefinition("crude");
  const tool = definition.resolveTool({
    entity,
    nowMs: 1_000,
    job: { payload: {} },
  }, "crude");
  assert.ok(tool);
  assert.equal(tool.activationMode, "held_beam");
  assert.equal(tool.effectRecord, null);
  assert.equal(tool.chargeItem.typeID, 77518);
  assert.equal(definition.lockTarget({}, { itemID: 202 }, tool).lockFree, true);

  const checkpoint: Record<string, any> = {};
  const target = { itemID: 202 };
  const context: Record<string, any> = { scene: {}, entity, nowMs: 1_000 };
  assert.equal(definition.activate(context, target, tool, "crude", checkpoint).spooling, true);
  assert.equal(cycles, 0);
  context.nowMs = 1_999;
  assert.equal(definition.activate(context, target, tool, "crude", checkpoint).success, true);
  assert.equal(cycles, 0);
  context.nowMs = 2_000;
  assert.equal(definition.activate(context, target, tool, "crude", checkpoint).success, true);
  assert.equal(cycles, 1);

  nativeStore.removeNativeCargo(chargeID);
  entity.nativeCargoItems = [];
  assert.equal(definition.resolveTool({
    entity,
    nowMs: 2_500,
    job: { payload: {} },
  }, "crude"), null);
});

test("durable mined cargo uses canonical item IDs and exact-stack delivery", (t) => {
  fixture(t);
  createNpc();
  const entity = runtimeEntity();
  const append = miningNpcOperations.appendNpcMiningCargo(entity, RESOURCE_TYPE_ID, 7);
  assert.equal(append.success, true, append.errorMsg);
  const cargo = nativeStore.listNativeCargoForEntity(ENTITY_ID);
  assert.equal(cargo.length, 1);
  assert.equal(cargo[0].semanticRole, "resource");
  const canonical = itemStore.findItemById(cargo[0].cargoID);
  assert.ok(canonical);
  assert.equal(canonical.locationID, ENTITY_ID);
  assert.equal(canonical.stacksize, 7);
  const delivery = resourceJobs.deliverNpcResourceCargo({
    entityID: ENTITY_ID,
    destinationLocationID: DESTINATION_ID,
    destinationFlagID: itemStore.ITEM_FLAGS.HANGAR,
    idempotencyKey: "phase2:delivery:801",
  });
  assert.equal(delivery.success, true, delivery.errorMsg);
  assert.equal(delivery.data.deliveredQuantity, 7);
  assert.equal(itemStore.findItemById(cargo[0].cargoID).locationID, DESTINATION_ID);
  assert.equal(nativeStore.listNativeCargoForEntity(ENTITY_ID).length, 0);
  const repeat = resourceJobs.deliverNpcResourceCargo({
    entityID: ENTITY_ID,
    destinationLocationID: DESTINATION_ID,
    destinationFlagID: itemStore.ITEM_FLAGS.HANGAR,
    idempotencyKey: "phase2:delivery:801",
  });
  assert.equal(repeat.success, true);
  assert.equal(repeat.data.deliveredQuantity, 0);
});

test("resource delivery recovery finishes a crash after inventory movement", (t) => {
  fixture(t);
  createNpc();
  const entity = runtimeEntity();
  assert.equal(miningNpcOperations.appendNpcMiningCargo(entity, RESOURCE_TYPE_ID, 3).success, true);
  const cargo = nativeStore.listNativeCargoForEntity(ENTITY_ID)[0];
  const operation = persistence.beginNpcOperation(
    "npc-resource-delivery",
    "phase2:recovery:801",
    {
      entityID: ENTITY_ID,
      destinationLocationID: DESTINATION_ID,
      destinationFlagID: itemStore.ITEM_FLAGS.HANGAR,
      cargoItemIDs: [cargo.cargoID],
      cargoSnapshots: [{ itemID: cargo.cargoID, quantity: 3 }],
    },
  ).data;
  assert.equal(itemStore.moveItemsToLocations([{
    itemID: cargo.cargoID,
    destinationLocationID: DESTINATION_ID,
    destinationFlagID: itemStore.ITEM_FLAGS.HANGAR,
  }]).success, true);
  database.flushTableSync(itemStore.ITEMS_TABLE);
  const recovered = resourceJobs.recoverNpcResourceOperation(operation);
  assert.equal(recovered.success, true, recovered.errorMsg);
  assert.equal(recovered.recovered, true);
  assert.equal(nativeStore.getNativeCargo(cargo.cargoID), null);
  assert.equal(persistence.getNpcOperationByIdempotencyKey("phase2:recovery:801").status, "committed");
});

test("NPC removal settles canonical resource cargo without orphaning items", (t) => {
  fixture(t);
  createNpc();
  const entity = runtimeEntity();
  assert.equal(miningNpcOperations.appendNpcMiningCargo(entity, RESOURCE_TYPE_ID, 2).success, true);
  const cargoID = nativeStore.listNativeCargoForEntity(ENTITY_ID)[0].cargoID;
  assert.ok(itemStore.findItemById(cargoID));
  const settled = npcFittingService.settleNpcEquipmentBeforeRemoval(ENTITY_ID, {
    destroyed: true,
  });
  assert.equal(settled.success, true, settled.errorMsg);
  assert.equal(itemStore.findItemById(cargoID), null);
});
