"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const maintenance = require("../src/space/npc/npcStargateMaintenanceService");

const TABLES = [
  "npcRuntimeState", "npcEntities", "npcModules", "npcCargo",
  "npcRuntimeControllers", "npcWrecks", "npcWreckItems", "stargateRuntimeState",
];
const ENTITY_ID = 980000000941;
const OWNER_ID = 500941;
const NPC_ID = 1500000941;
const FUEL_TYPE_ID = 77818;
const GATE_ID = 60000001;

function fixture(t) {
  const backups = Object.fromEntries(TABLES.map((table) => [
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
  database.write("stargateRuntimeState", "/", {}, { force: true });
  database.flushTablesSync(TABLES);
  persistence._testing.resetRuntimeForTests();
  itemStore.resetInventoryStoreForTests();
  itemStore._writeItemsForTest({}, { force: true });
  itemTypeRegistry._setEntriesForTests([{
    typeID: FUEL_TYPE_ID,
    groupID: 4598,
    categoryID: 4,
    name: "Unstable Fuel",
    volume: 0.28,
  }]);
  assert.equal(nativeStore.upsertNativeEntity({
    entityID: ENTITY_ID,
    systemID: 30000004,
    typeID: 587,
    groupID: 25,
    categoryID: 6,
    ownerID: OWNER_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
  }, { durable: true }).success, true);
  const fuel = itemStore.grantItemToOwnerLocation(
    OWNER_ID,
    ENTITY_ID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    FUEL_TYPE_ID,
    5,
    { singleton: 0 },
  ).data.items[0];
  assert.equal(nativeStore.upsertNativeCargo({
    cargoID: fuel.itemID,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    moduleID: 0,
    typeID: FUEL_TYPE_ID,
    groupID: 4598,
    categoryID: 4,
    itemName: "Unstable Fuel",
    quantity: 5,
    singleton: false,
    semanticRole: "fuel",
    transient: false,
  }, { durable: true }).success, true);
  database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  t.after(() => {
    itemStore._writeItemsForTest(backupItems, { force: true });
    for (const [table, value] of Object.entries(backups)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
    persistence._testing.resetRuntimeForTests();
  });
  return fuel;
}

test("interrupted NPC stargate refueling consumes cargo and credits the gate exactly once", (t) => {
  const fuel = fixture(t);
  const pending = new Map();
  let receipt = null;
  const restore = maintenance.configureNpcStargateMaintenanceAdapters({
    getReceipt(_gateID, operationKey) {
      return receipt && receipt.operationKey === operationKey ? receipt : null;
    },
    prepareDeposit(_gateID, entries, options) {
      if (!pending.has(options.operationKey)) {
        pending.set(options.operationKey, { operationKey: options.operationKey, entries });
      }
      return { success: true, data: pending.get(options.operationKey) };
    },
    commitDeposit(_gateID, operationKey) {
      const prepared = pending.get(operationKey);
      if (!prepared) return { success: false, errorMsg: "STARGATE_DEPOSIT_NOT_PREPARED" };
      receipt = { ...prepared, status: "committed" };
      pending.delete(operationKey);
      return { success: true, data: receipt };
    },
    cancelDeposit(_gateID, operationKey) {
      return { success: true, cancelled: pending.delete(operationKey) };
    },
  });
  t.after(restore);

  const operation = persistence.beginNpcOperation(
    "npc-stargate-maintenance-deposit",
    "npc-stargate-deposit:test-recovery",
    {
      jobID: "test-recovery",
      stargateID: GATE_ID,
      entityID: ENTITY_ID,
      actor: { actorID: NPC_ID, shipID: ENTITY_ID },
      entries: [{
        kind: "fuel",
        itemID: fuel.itemID,
        typeID: FUEL_TYPE_ID,
        quantity: 3,
        beforeQuantity: 5,
        ownerID: OWNER_ID,
        locationID: ENTITY_ID,
        flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
      }],
    },
  ).data;
  const recovered = maintenance.recoverNpcStargateMaintenanceOperation(operation);
  assert.equal(recovered.success, true, recovered.errorMsg);
  assert.equal(itemStore.findItemById(fuel.itemID).stacksize, 2);
  assert.equal(nativeStore.listNativeCargoForEntity(ENTITY_ID)[0].quantity, 2);
  assert.equal(receipt.status, "committed");
  assert.equal(
    persistence.getNpcOperationByIdempotencyKey("npc-stargate-deposit:test-recovery").status,
    "committed",
  );

  const replayed = maintenance.recoverNpcStargateMaintenanceOperation(
    persistence.getNpcOperationByIdempotencyKey("npc-stargate-deposit:test-recovery"),
  );
  assert.equal(replayed.success, true);
  assert.equal(itemStore.findItemById(fuel.itemID).stacksize, 2);
});
