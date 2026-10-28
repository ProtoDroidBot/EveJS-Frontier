"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const industryRuntime = require("../src/services/frontier/industryRuntime");
const production = require("../src/services/frontier/industryProduction");
const miningRuntime = require("../src/services/mining/miningRuntime");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const behaviorRuntime = require("../src/space/npc/npcBehaviorTreeRuntime");
const industryJobs = require("../src/space/npc/npcIndustryJobService");

const TABLES = [
  "npcRuntimeState", "npcEntities", "npcModules", "npcCargo",
  "npcRuntimeControllers", "npcPilotIdentities", "npcWrecks", "npcWreckItems",
];
const ENTITY_ID = 980000001301;
const NPC_ID = 1500001301;
const FACTION_OWNER_ID = 5001301;
const SYSTEM_ID = 30000004;
const FACILITY_ID = 9900001301;
const INPUT_ONE_ID = 9900001302;
const INPUT_TWO_ID = 9900001303;
const INPUT_THREE_ID = 9900001304;

function row(itemID, typeID, ownerID, locationID, flagID, stacksize, extra = {}) {
  return {
    itemID,
    typeID,
    ownerID,
    locationID,
    flagID,
    stacksize,
    quantity: stacksize,
    singleton: 0,
    categoryID: 4,
    groupID: 0,
    customInfo: "",
    ...extra,
  };
}

function fixture(t) {
  const backupTables = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  const backupItems = structuredClone(itemStore.getAllItems());
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.write("npcWrecks", "/", { nextWreckID: 980300000000, wrecks: {} }, { force: true });
  database.write("npcWreckItems", "/", { nextWreckItemID: 980400000000, items: {} }, { force: true });
  database.write("npcPilotIdentities", "/", {
    version: 1,
    nextCharacterID: NPC_ID + 1,
    pilots: {
      [NPC_ID]: {
        characterID: NPC_ID,
        characterName: "Phase Three Industrialist",
        factionKey: "500001-serpentis",
        factionID: 500001,
        factionStringOnlyID: "serpentis",
        systemID: SYSTEM_ID,
        identitySlot: "phase3:industry",
        slotKey: "phase3-industry",
        profileID: "phase3-industry",
        activeEntityID: ENTITY_ID,
        incarnation: 1,
        deaths: 0,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    },
    slots: { "phase3-industry": NPC_ID },
    factions: {
      "500001-serpentis": {
        factionKey: "500001-serpentis",
        factionID: 500001,
        factionStringOnlyID: "serpentis",
      },
    },
  }, { force: true });
  database.flushTablesSync(TABLES);
  persistence._testing.resetRuntimeForTests();
  itemStore.resetInventoryStoreForTests();
  itemTypeRegistry._setEntriesForTests([
    { typeID: 95276, categoryID: 6, groupID: 25, name: "Industry NPC Hull", capacity: 10_000 },
    { typeID: 87119, categoryID: 65, groupID: 0, name: "Smart Industry Facility", volume: 1 },
    { typeID: 77803, categoryID: 4, groupID: 0, name: "Industry Input One", volume: 1 },
    { typeID: 83894, categoryID: 4, groupID: 0, name: "Industry Input Two", volume: 1 },
    { typeID: 83892, categoryID: 4, groupID: 0, name: "Alternate Industry Input", volume: 1 },
    { typeID: 83895, categoryID: 4, groupID: 0, name: "Industry Output", volume: 1 },
    { typeID: 83897, categoryID: 4, groupID: 0, name: "Alternate Industry Output", volume: 1 },
  ]);

  const construction = {
    assemblyStatus: 2,
    assemblyTypeID: 87119,
    ownerID: NPC_ID,
    solarSystemID: SYSTEM_ID,
    completedAtMs: 1,
  };
  const rows = [
    row(ENTITY_ID, 95276, FACTION_OWNER_ID, SYSTEM_ID, 0, 1, {
      singleton: 1,
      categoryID: 6,
      groupID: 25,
    }),
    row(FACILITY_ID, 87119, NPC_ID, SYSTEM_ID, 0, 1, {
      singleton: 1,
      categoryID: 65,
      customInfo: JSON.stringify({ evejsFrontierConstruction: construction }),
    }),
    row(INPUT_ONE_ID, 77803, FACTION_OWNER_ID, ENTITY_ID, itemStore.ITEM_FLAGS.CARGO_HOLD, 90),
    row(INPUT_TWO_ID, 83894, FACTION_OWNER_ID, ENTITY_ID, itemStore.ITEM_FLAGS.CARGO_HOLD, 2),
    row(INPUT_THREE_ID, 83892, FACTION_OWNER_ID, ENTITY_ID, itemStore.ITEM_FLAGS.CARGO_HOLD, 1),
  ];
  assert.equal(itemStore._writeItemsForTest(
    Object.fromEntries(rows.map((item) => [item.itemID, item])),
    { force: true },
  ), true);
  assert.equal(nativeStore.upsertNativeEntity({
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    typeID: 95276,
    groupID: 25,
    categoryID: 6,
    ownerID: FACTION_OWNER_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
  }, { durable: true }).success, true);
  assert.equal(nativeStore.upsertNativeController({
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    transient: false,
  }, { durable: true }).success, true);
  for (const item of rows.filter((entry) =>
    [INPUT_ONE_ID, INPUT_TWO_ID, INPUT_THREE_ID].includes(entry.itemID))) {
    assert.equal(nativeStore.upsertNativeCargo({
      cargoID: item.itemID,
      entityID: ENTITY_ID,
      ownerID: item.ownerID,
      moduleID: 0,
      typeID: item.typeID,
      groupID: item.groupID,
      categoryID: item.categoryID,
      itemName: `Input ${item.typeID}`,
      quantity: item.stacksize,
      singleton: false,
      semanticRole: "resource",
      transient: false,
    }, { durable: true }).success, true);
  }
  database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  t.after(() => {
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

function runtimeEntity() {
  return {
    itemID: ENTITY_ID,
    systemID: SYSTEM_ID,
    ownerID: FACTION_OWNER_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  };
}

function scene() {
  const entity = runtimeEntity();
  const facility = {
    itemID: FACILITY_ID,
    systemID: SYSTEM_ID,
    kind: "assembly",
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
  };
  return {
    systemID: SYSTEM_ID,
    getEntityByID(itemID) {
      if (itemID === ENTITY_ID) return entity;
      if (itemID === FACILITY_ID) return facility;
      return null;
    },
    getCommandTimeEntitySurfaceDistance() { return 80; },
    followShipEntity() { return true; },
  };
}

test("durable NPC industry jobs run several lanes and return faction-owned outputs", (t) => {
  fixture(t);
  assert.deepEqual({
    categoryID: itemStore.findItemById(ENTITY_ID)?.categoryID,
    locationID: itemStore.findItemById(ENTITY_ID)?.locationID,
  }, { categoryID: 6, locationID: SYSTEM_ID });
  industryJobs.registerNpcIndustryJobHandler();
  const created = industryJobs.createNpcIndustryJob({
    entityID: ENTITY_ID,
    facilityID: FACILITY_ID,
    lanes: [
      { laneID: 1, blueprintID: 1026, runs: 1 },
      { laneID: 2, blueprintID: 1027, runs: 1 },
    ],
    idempotencyKey: "phase3:industry:two-lanes",
  });
  assert.equal(created.success, true, created.errorMsg);
  const world = scene();
  const controller = { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 };
  for (const nowMs of [1_000, 1_100, 1_200, 1_300, 1_400, 5_000, 5_100]) {
    behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, nowMs);
  }
  const job = persistence.getNpcJob(created.data.jobID);
  assert.equal(job.status, "completed", JSON.stringify({
    step: job.step,
    lastError: job.lastError,
    checkpoint: job.checkpoint,
  }));
  assert.equal(job.checkpoint.laneStates["1"].completedRuns, 1);
  assert.equal(job.checkpoint.laneStates["2"].completedRuns, 1);
  assert.equal(job.checkpoint.outputsCollected, true);
  assert.deepEqual(industryRuntime.getFacilityItems(itemStore.findItemById(FACILITY_ID)), {
    inputs: {},
    outputs: {},
  });
  const outputs = itemStore.listContainerItems(
    FACTION_OWNER_ID,
    ENTITY_ID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => item.typeID === 83895);
  assert.equal(outputs.reduce((sum, item) => sum + item.stacksize, 0), 1);
  const alternateOutputs = itemStore.listContainerItems(
    FACTION_OWNER_ID, ENTITY_ID, itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => item.typeID === 83897);
  assert.equal(alternateOutputs.reduce((sum, item) => sum + item.stacksize, 0), 1);
  assert.equal(nativeStore.listNativeCargoForEntity(ENTITY_ID)
    .filter((item) => [83895, 83897].includes(item.typeID))
    .reduce((sum, item) => sum + item.quantity, 0), 2);
  assert.equal(production.getProduction(itemStore.findItemById(FACILITY_ID), 1).stopReason,
    "COMPLETED");
  assert.equal(production.getProduction(itemStore.findItemById(FACILITY_ID), 2).stopReason,
    "COMPLETED");
});

test("durable NPC pseudo sessions use the NPC character identity without exposing a player pilot", () => {
  assert.equal(miningRuntime.buildNpcPseudoSession({
    itemID: ENTITY_ID,
    systemID: SYSTEM_ID,
    pilotCharacterID: 0,
    npcCharacterID: NPC_ID,
  }).characterID, NPC_ID);
});

test("an NPC industry lane recovers a crash after its paid run commits", (t) => {
  fixture(t);
  industryJobs.registerNpcIndustryJobHandler();
  const created = industryJobs.createNpcIndustryJob({
    entityID: ENTITY_ID,
    facilityID: FACILITY_ID,
    lanes: [
      { laneID: 1, blueprintID: 1026, runs: 1 },
      { laneID: 2, blueprintID: 1026, runs: 1 },
    ],
    idempotencyKey: "phase3:industry:start-crash",
  });
  assert.equal(created.success, true, created.errorMsg);
  const world = scene();
  const controller = { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 };
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 1_000);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 1_100);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 1_150);

  // Commit lane 1, but deliberately discard the returned behavior checkpoint
  // to model a process death between the facility and job-state writes.
  const beforeStart = persistence.getNpcJob(created.data.jobID);
  const started = industryJobs.tickNpcIndustryJob({
    scene: world,
    entity: runtimeEntity(),
    controller,
    nowMs: 1_200,
    job: beforeStart,
  });
  assert.equal(started.status, behaviorRuntime.STATUS.RUNNING);
  assert.equal(production.getProduction(itemStore.findItemById(FACILITY_ID), 1)
    .executorKey, `npc-industry:${created.data.jobID}:1`);
  assert.equal(persistence.getNpcJob(created.data.jobID).checkpoint.laneStates["1"].executorKey,
    null);

  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 1_300);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 5_000);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 5_100);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 5_200);
  assert.equal(persistence.getNpcJob(created.data.jobID).status, "completed");
});

test("output collection recovers after custody commits but its behavior checkpoint is lost", (t) => {
  fixture(t);
  industryJobs.registerNpcIndustryJobHandler();
  const created = industryJobs.createNpcIndustryJob({
    entityID: ENTITY_ID,
    facilityID: FACILITY_ID,
    lanes: [
      { laneID: 1, blueprintID: 1026, runs: 1 },
      { laneID: 2, blueprintID: 1026, runs: 1 },
    ],
    idempotencyKey: "phase3:industry:output-crash",
  });
  assert.equal(created.success, true, created.errorMsg);
  const world = scene();
  const controller = { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 };
  for (const nowMs of [1_000, 1_100, 1_200, 1_300, 1_400]) {
    behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, nowMs);
  }

  // Finish both lanes and commit output custody, then deliberately discard
  // the behavior result as though the process died before its checkpoint.
  const beforeCollection = persistence.getNpcJob(created.data.jobID);
  const collected = industryJobs.tickNpcIndustryJob({
    scene: world,
    entity: runtimeEntity(),
    controller,
    nowMs: 5_000,
    job: beforeCollection,
  });
  assert.equal(collected.status, behaviorRuntime.STATUS.RUNNING);
  assert.equal(industryJobs._testing.collectedOutputs(created.data.jobID)["83895"], 2);
  assert.equal(persistence.getNpcJob(created.data.jobID).checkpoint.outputsCollected, false);

  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 5_100);
  behaviorRuntime.tickDurableNpcJob(world, runtimeEntity(), controller, 5_200);
  assert.equal(persistence.getNpcJob(created.data.jobID).status, "completed");
  const outputs = itemStore.listContainerItems(
    FACTION_OWNER_ID,
    ENTITY_ID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).filter((item) => item.typeID === 83895);
  assert.equal(outputs.reduce((sum, item) => sum + item.stacksize, 0), 2);
});
