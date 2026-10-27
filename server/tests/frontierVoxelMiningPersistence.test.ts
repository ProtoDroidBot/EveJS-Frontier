"use strict";

// Run through scripts/Tests/run-isolated-tests.js. gameStore itself rejects a
// node:test process without the disposable-store attestation.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const database = require("../src/gameStore");
const { createTableRepository, OwnershipViolationError } = require("../src/gameStore/tableRepository");
const Database = require("better-sqlite3");
const { createVoxelMiningStore } = require("../src/services/mining/voxelMiningStore");
const miningRepo = createTableRepository("service:mining", { strict: true });
const inventoryRepo = createTableRepository("service:inventory", { strict: true });
miningRepo.ensureTable("voxelMiningState");
inventoryRepo.ensureTable("items");

test("SQLite owner proposals roll back together on real second-table failure", () => {
  assert.throws(() => miningRepo.prepareAtomicRowWrite("items", "atomic-test", {}), OwnershipViolationError);
  assert.equal(database.commitAtomicRowWrites([{}]).success, false, "forged proposals must fail closed");
  const connection = new Database(database._sqliteDbPath);
  try {
    connection.exec(`CREATE TRIGGER voxel_test_fail_inventory BEFORE INSERT ON items
      WHEN NEW.key = 'atomic-test' BEGIN SELECT RAISE(ABORT, 'injected atomic inventory failure'); END`);
    const result = miningRepo.commitAtomicRowWrites([
      miningRepo.prepareAtomicRowWrite("voxelMiningState", "atomic-source", { consumed: true }),
      inventoryRepo.prepareAtomicRowWrite("items", "atomic-test", { quantity: 20 }),
    ]);
    assert.equal(result.success, false);
    assert.equal(database.read("voxelMiningState", "/atomic-source").data, null);
    assert.equal(connection.prepare("SELECT json FROM voxelMiningState WHERE key = ?").get("atomic-source"), undefined);
    assert.equal(connection.prepare("SELECT json FROM items WHERE key = ?").get("atomic-test"), undefined);
    connection.exec("DROP TRIGGER voxel_test_fail_inventory");
    const retry = miningRepo.commitAtomicRowWrites([
      miningRepo.prepareAtomicRowWrite("voxelMiningState", "atomic-source", { consumed: true }),
      inventoryRepo.prepareAtomicRowWrite("items", "atomic-test", { quantity: 20 }),
    ]);
    assert.equal(retry.success, true);
    assert.deepEqual(JSON.parse(connection.prepare("SELECT json FROM items WHERE key = ?").get("atomic-test").json), { quantity: 20 });
    assert.deepEqual(database.read("items", "/atomic-test").data, { quantity: 20 });
  } finally { connection.close(); }
});

test("stale row proposals cannot overwrite subsequent authoritative changes", () => {
  const stale = miningRepo.prepareAtomicRowWrite("voxelMiningState", "stale", { revision: 1 });
  miningRepo.write("voxelMiningState", "/stale", { revision: 2 });
  assert.equal(miningRepo.commitAtomicRowWrites([stale]).errorMsg, "ATOMIC_WRITE_CONFLICT");
  assert.equal(database.read("voxelMiningState", "/stale").data.revision, 2);
});

test("pending older cache writes and later flushes cannot overwrite an atomic receipt", () => {
  inventoryRepo.write("items", "/atomic-test", { quantity: 30 });
  const rows = [
    miningRepo.prepareAtomicRowWrite("voxelMiningState", "atomic-source", { consumed: true, revision: 2 }),
    inventoryRepo.prepareAtomicRowWrite("items", "atomic-test", { quantity: 50 }),
  ];
  assert.equal(miningRepo.commitAtomicRowWrites(rows).success, true);
  assert.equal(miningRepo.commitAtomicRowWrites(rows).success, false, "committed tokens are single-use");
  assert.equal(database.flushAllSync().success, true);
  const connection = new Database(database._sqliteDbPath);
  try {
    assert.equal(JSON.parse(connection.prepare("SELECT json FROM items WHERE key = ?").get("atomic-test").json).quantity, 50);
    assert.equal(connection.prepare("SELECT COUNT(*) AS n FROM _persistence_outbox").get().n, 0);
  } finally { connection.close(); }
});

test("real inventory pickup checks occupied cargo, survives commit rollback and restart without duplicate ore", t => {
  const registry = require("../src/services/inventory/itemTypeRegistry");
  const originalResolve = registry.resolveItemByTypeID;
  t.mock.method(registry, "resolveItemByTypeID", typeID => Number(typeID) === 987001
    ? { typeID: 987001, name: "Fixture ore", categoryID: 25, groupID: 450, volume: 2, portionSize: 1 }
    : Number(typeID) === 987002
      ? { typeID: 987002, name: "Fixture ship", categoryID: 6, groupID: 25, volume: 100, capacity: 40, portionSize: 1 }
      : originalResolve(typeID));
  const itemStore = require("../src/services/inventory/itemStore");
  const characterID = 140999999;
  const shipID = 2990000010;
  const cargoID = 2990000011;
  const fragmentID = 2990000012;
  database.ensureTable("characters");
  database.write("characters", `/${characterID}`, { characterID, shipID, accountId: 1 });
  inventoryRepo.write("items", `/${shipID}`, { itemID: shipID, typeID: 987002, ownerID: characterID,
    locationID: 30000001, flagID: 0, quantity: -1, stacksize: 1, singleton: 1, categoryID: 6 });
  inventoryRepo.write("items", `/${cargoID}`, { itemID: cargoID, typeID: 987001, ownerID: characterID,
    locationID: shipID, flagID: 5, quantity: 5, stacksize: 5, singleton: 0, categoryID: 25 });
  assert.equal(database.flushTablesSync(["characters", "items"]).success, true);
  const store = createVoxelMiningStore({ repo: miningRepo, now: () => 10000, runtimeIdentity: "persistence-test",
    allocateIDs: () => [fragmentID], grantAtomic: itemStore.grantStackableItemsWithAtomicRows });
  const identity = { worldRevision: "durable-world", systemID: 30000001, asteroidID: 7000 };
  assert.equal(store.registerAsteroid({ ...identity, originalQuantity: 100, unitVolume: 2,
    model: { recipeHash: "durable-recipe", recipe: { dim: 2 }, gridLength: 4 } }).success, true);
  assert.equal(store.commitExtraction({ ...identity, expectedRevision: 0, minedCells: [0], extractedQuantity: 20,
    fragments: [{ typeID: 987003, yieldTypeID: 987001, quantity: 20, position: { x: 1, y: 2, z: 3 } }] }).success, true);
  assert.equal(store.claimFragment(fragmentID, { ...identity, characterID, shipID,
    claimToken: "durable-claim", expiresAtMs: 11000 }).success, true);
  const request = { characterID, shipID, flagID: 5, claimToken: "durable-claim", getDestinationCapacity: () => 40 };
  assert.equal(store.completePickup(fragmentID, request).errorMsg, "NOT_ENOUGH_CARGO_SPACE");
  assert.equal(itemStore.findItemById(cargoID).quantity, 5);
  for (const invalidCapacity of [NaN, Infinity, -1]) {
    request.getDestinationCapacity = () => invalidCapacity;
    assert.equal(store.completePickup(fragmentID, request).errorMsg, "INVALID_CAPACITY");
    assert.equal(store.getFragment(fragmentID).status, "claimed");
    assert.equal(itemStore.findItemById(cargoID).quantity, 5);
  }
  request.getDestinationCapacity = () => 50;
  const connection = new Database(database._sqliteDbPath);
  try {
    connection.exec(`CREATE TRIGGER voxel_test_fail_grant BEFORE UPDATE ON items
      WHEN NEW.key = '${cargoID}' BEGIN SELECT RAISE(ABORT, 'injected grant failure'); END`);
    assert.equal(store.completePickup(fragmentID, request).success, false);
    assert.equal(store.getFragment(fragmentID).status, "claimed");
    assert.equal(itemStore.findItemById(cargoID).quantity, 5);
    assert.equal(JSON.parse(connection.prepare("SELECT json FROM items WHERE key = ?").get(String(cargoID)).json).quantity, 5);
    connection.exec("DROP TRIGGER voxel_test_fail_grant");
    const result = store.completePickup(fragmentID, request);
    assert.equal(result.success, true, result.errorMsg);
    assert.equal(result.data.changes[0].item.quantity, 25);
    assert.equal(itemStore.findItemById(cargoID).quantity, 25);
    assert.equal(store.completePickup(fragmentID, request).success, false);
    assert.equal(store.getFragment(fragmentID).status, "consumed");
    const restartResultPath = require("node:path").join(process.env.EVEJS_TEST_STORE_ROOT, "voxel-restart-result.json");
    const child = spawnSync(process.execPath, ["-e", `
      const db = require('./server/src/gameStore');
      const store = require('./server/src/services/mining/voxelMiningStore');
      const fragment = store.getFragment(${fragmentID});
      const cargo = db.read('items', '/${cargoID}').data;
      require('node:fs').writeFileSync(${JSON.stringify(restartResultPath)}, JSON.stringify({status:fragment.status, quantity:cargo.quantity}));
      db._closeSqliteForTests();
    `], { cwd: require("node:path").resolve(__dirname, "../.."), env: process.env, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(require("node:fs").readFileSync(restartResultPath, "utf8")), { status: "consumed", quantity: 25 });
  } finally { connection.close(); }
});

test.after(() => {
  assert.equal(database.flushAllSync().success, true);
  database._closeSqliteForTests();
  database._shutdownPersistenceWorkerForTests();
});
