"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const database = require("../src/gameStore");
const { createTableRepository } = require("../src/gameStore/tableRepository");
const { createCelestialStargateRuntime } = require("../src/services/frontier/celestialStargateRuntime");
const Database = require("better-sqlite3");
const inventory = require("../src/services/inventory/itemStore");
const inventoryRepo = createTableRepository("service:inventory", { strict: true });
const gateRepo = createTableRepository("service:frontier", { strict: true });
const characterID = 140999998, cargoID = 2991000001, shipID = 2991000000, gateID = 60000001;
function prepare() {
  database.ensureTable("characters"); inventoryRepo.ensureTable("items"); gateRepo.ensureTable("stargateRuntimeState");
  database.write("characters", `/${characterID}`, { characterID, shipID, accountId: 1 });
  inventoryRepo.write("items", `/${cargoID}`, { itemID: cargoID, typeID: 78516, ownerID: characterID,
    locationID: shipID, flagID: 5, quantity: 100, stacksize: 100, singleton: 0, categoryID: 4, groupID: 4738 });
  database.flushTablesSync(["characters", "items"]);
  return createCelestialStargateRuntime({ repository: gateRepo, configPath: null, autoConfigure: false,
    findStargate: id => id === gateID ? { itemID: gateID, typeID: 79787, solarSystemID: 30000004,
      destinationID: 60000002, destinationSolarSystemID: 30000005 } : null,
    refreshActivation: () => {}, notifyDepot: () => {} });
}
test("real grouped SQLite gate state and inventory consumption commit or roll back together", () => {
  const runtime = prepare(); const seeded = runtime.ensureTargetGate(gateID);
  assert.equal(seeded.success, true, seeded.errorMsg);
  const before = seeded.data.fuelEnergy;
  const connection = new Database(database._sqliteDbPath);
  const request = { characterID, sourceLocationIDs: [shipID], sourceFlagIDs: [5],
    consumptions: [{ itemID: cargoID, typeID: 78516, quantity: 2 }] };
  try {
    connection.exec(`CREATE TRIGGER target_gate_atomic_failure BEFORE UPDATE ON stargateRuntimeState
      WHEN NEW.key = 'gates\u001f${gateID}' BEGIN SELECT RAISE(ABORT, 'injected target gate failure'); END`);
    const failed = runtime.depositResourcesWithInventory(gateID, [{ typeID: 78516, quantity: 2 }], request,
      { operationKey: "sqlite-deposit", targetFuel: true });
    assert.equal(failed.success, false);
    assert.equal(runtime.getStargateState(gateID).data.fuelEnergy, before);
    assert.equal(inventory.findItemById(cargoID).quantity, 100);
    assert.equal(JSON.parse(connection.prepare("SELECT json FROM items WHERE key = ?").get(String(cargoID)).json).quantity, 100);
    const deniedJump = runtime.reserveJumpEnergy(gateID, "sqlite-failed-jump");
    assert.equal(deniedJump.success, false); assert.equal(runtime.getStargateState(gateID).data.fuelEnergy, before);
    connection.exec("DROP TRIGGER target_gate_atomic_failure");
    const committed = runtime.depositResourcesWithInventory(gateID, [{ typeID: 78516, quantity: 2 }], request,
      { operationKey: "sqlite-deposit", targetFuel: true });
    assert.equal(committed.success, true, committed.errorMsg);
    assert.equal(inventory.findItemById(cargoID).quantity, 98);
    assert.equal(runtime.getStargateState(gateID).data.fuelEnergy, before + 888);
    assert.equal(runtime.depositResourcesWithInventory(gateID, [{ typeID: 78516, quantity: 2 }], request,
      { operationKey: "sqlite-deposit", targetFuel: true }).committed, false);
    assert.equal(inventory.findItemById(cargoID).quantity, 98);
    assert.equal(database.flushAllSync().success, true);
    const persisted = JSON.parse(connection.prepare("SELECT json FROM stargateRuntimeState WHERE key = ?").get(`gates\u001f${gateID}`).json);
    assert.equal(persisted.fuelEnergy, before + 888);
    assert.equal(connection.prepare("SELECT json FROM stargateRuntimeState WHERE key = 'gates'").get().json, "{}");
  } finally { connection.close(); }
});
test("grouped atomic proposals preserve owner checks, CAS, nested deletion and flush baselines", () => {
  const original = database.read("stargateRuntimeState", "/gates").data || {};
  assert.throws(() => inventoryRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", {}));
  assert.throws(() => gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates\u001fforged", {}));
  assert.throws(() => gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", { "bad\u001fkey": {} }));
  assert.throws(() => gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", []));
  const staged = gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", { ...original, a: { revision: 1 } });
  gateRepo.write("stargateRuntimeState", "/gates/b", { revision: 2 });
  assert.equal(gateRepo.commitAtomicRowWrites([staged]).errorMsg, "ATOMIC_WRITE_CONFLICT");
  const changed = { ...database.read("stargateRuntimeState", "/gates").data, a: { revision: 3 } };
  assert.equal(gateRepo.commitAtomicRowWrites([gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", changed)]).success, true);
  delete changed.b;
  assert.equal(gateRepo.commitAtomicRowWrites([gateRepo.prepareAtomicRowWrite("stargateRuntimeState", "gates", changed)]).success, true);
  assert.equal(database.flushAllSync().success, true);
  const connection = new Database(database._sqliteDbPath);
  try {
    assert.equal(connection.prepare("SELECT json FROM stargateRuntimeState WHERE key = ?").get("gates\u001fb"), undefined);
    assert.deepEqual(JSON.parse(connection.prepare("SELECT json FROM stargateRuntimeState WHERE key = ?").get("gates\u001fa").json), { revision: 3 });
    assert.equal(connection.prepare("SELECT COUNT(*) AS n FROM _persistence_outbox").get().n, 0);
  } finally { connection.close(); }
});
