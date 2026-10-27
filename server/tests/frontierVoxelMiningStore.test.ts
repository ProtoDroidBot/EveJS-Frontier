"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoxelMiningStore, TABLE } = require("../src/services/mining/voxelMiningStore");

const IDENTITY = { worldRevision: "world-3640684", systemID: 30000001, asteroidID: 9001 };
const MODEL = { recipeHash: "fixed-recipe", recipe: { dim: 2, seed: 42 }, gridLength: 4, yieldTypeID: 123 };

function fixture(policy = {}) {
  const tables: any = { [TABLE]: {}, items: {} };
  const tokens = new WeakMap();
  let nextID = 2000000000;
  let failCommit = false;
  let capacity = 1000;
  let clock = 10000;
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const repo = {
    ensureTable() { return { success: true }; },
    read(table, path) { return { success: true, data: path === "/" ? clone(tables[table]) : clone(tables[table][path.slice(1)]) }; },
    prepareAtomicRowWrite(table, key, value) {
      const token = {};
      tokens.set(token, { table, key, value: clone(value), expected: JSON.stringify(tables[table][key]) });
      return token;
    },
    commitAtomicRowWrites(proposals) {
      const rows = proposals.map(token => { const row = tokens.get(token); tokens.delete(token); return row; });
      if (failCommit) return { success: false, errorMsg: "INJECTED_COMMIT_FAILURE" };
      if (rows.some(row => !row || JSON.stringify(tables[row.table][row.key]) !== row.expected)) {
        return { success: false, errorMsg: "ATOMIC_WRITE_CONFLICT" };
      }
      for (const row of rows) tables[row.table][row.key] = clone(row.value);
      return { success: true };
    },
  };
  function makeStore(runtimeIdentity = "first-runtime") {
    return createVoxelMiningStore({ repo, runtimeIdentity, now: () => clock, policy: () => policy,
      allocateIDs: count => Array.from({ length: count }, () => nextID++),
      grantAtomic(request, rows) {
        const entry = request.entries[0];
        const before = tables.items.cargo || { quantity: 0 };
        if (before.quantity + entry.quantity > request.getDestinationCapacity()) {
          return { success: false, errorMsg: "NOT_ENOUGH_CARGO_SPACE" };
        }
        const after = { quantity: before.quantity + entry.quantity, typeID: entry.itemType };
        const result = repo.commitAtomicRowWrites([...rows, repo.prepareAtomicRowWrite("items", "cargo", after)]);
        return result.success ? { success: true, data: { changes: [{ item: after }] } } : result;
      },
    });
  }
  const store = makeStore();
  const register = () => store.registerAsteroid({ ...IDENTITY, model: MODEL, originalQuantity: 100, unitVolume: 1 });
  const extract = (extra: any = {}) => store.commitExtraction({ ...IDENTITY, expectedRevision: 0,
    minedCells: [0], extractedQuantity: 20, cellRemainingUpdates: { 0: 0 },
    fragments: [{ typeID: 999, yieldTypeID: 123, quantity: 20, position: { x: 1, y: 2, z: 3 },
      sourceCellIndices: [0], scopeMetadata: { dungeonInstanceID: 67 } }], ...extra });
  const claim = (target = store, token = "claim") => target.claimFragment(2000000000, {
    ...IDENTITY, characterID: 140000001, shipID: 200, claimToken: token, expiresAtMs: clock + 1000,
  });
  const pickup = (target = store, token = "claim") => target.completePickup(2000000000, {
    characterID: 140000001, shipID: 200, flagID: 5, claimToken: token, getDestinationCapacity: () => capacity,
  });
  return { store, makeStore, register, extract, claim, pickup, tables,
    setFailure: value => { failCommit = value; }, setCapacity: value => { capacity = value; },
    setClock: value => { clock = value; } };
}

test("extraction commits cells, conserved source quantity, scope and fragments together", () => {
  const f = fixture();
  assert.equal(f.register().success, true);
  const result = f.extract({ bonusQuantity: 3, wasteQuantity: 2 });
  assert.equal(result.success, true);
  assert.equal(result.data.asteroid.remainingQuantity, 81);
  assert.equal(result.data.asteroid.materialTotals[123], 20);
  assert.deepEqual(result.data.asteroid.minedCells, [0]);
  assert.equal(result.data.fragments[0].yieldTypeID, 123);
  assert.equal(result.data.fragments[0].typeID, 999);
  assert.deepEqual(result.data.fragments[0].scopeMetadata, { dungeonInstanceID: 67 });
  assert.equal(f.tables.items.cargo, undefined, "mining must not grant inventory");
  assert.equal(f.extract().errorMsg, "ASTEROID_REVISION_CONFLICT");
  assert.equal(f.store.listFragments(IDENTITY.worldRevision, IDENTITY.systemID).length, 1);
  assert.equal(f.store.listFragments("other-world", IDENTITY.systemID).length, 0);
});

test("failed extraction retains source and produces no fragments; retry burns only an ID", () => {
  const f = fixture();
  f.register();
  f.setFailure(true);
  assert.equal(f.extract().success, false);
  assert.equal(f.store.getAsteroid(IDENTITY).remainingQuantity, 100);
  assert.deepEqual(f.store.getAsteroid(IDENTITY).minedCells, []);
  assert.deepEqual(f.store.listFragments(IDENTITY.worldRevision, IDENTITY.systemID), []);
  f.setFailure(false);
  assert.equal(f.extract().data.fragments[0].itemID, 2000000001);
});

test("recipe identity and cell validation reject incompatible or duplicate depletion", () => {
  const f = fixture();
  f.register();
  assert.equal(f.store.registerAsteroid({ ...IDENTITY, model: { ...MODEL, recipeHash: "changed" },
    originalQuantity: 100, unitVolume: 1 }).errorMsg, "ASTEROID_RECIPE_MISMATCH");
  assert.equal(f.extract({ minedCells: [4] }).errorMsg, "INVALID_MINED_CELLS");
  assert.equal(f.extract({ minedCells: [1, 1] }).errorMsg, "INVALID_MINED_CELLS");
  assert.equal(f.extract({ extractedQuantity: 21 }).errorMsg, "EXTRACTION_FRAGMENT_MISMATCH");
  assert.equal(f.extract({ cellRemainingUpdates: { 0: 1 } }).errorMsg, "INVALID_CELL_STATE");
  for (const invalidQuantity of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(f.extract({ extractedQuantity: invalidQuantity }).errorMsg, "INVALID_EXTRACTION_QUANTITY");
  }
});

test("partial cell damage is durable without pretending the whole voxel was removed", () => {
  const f = fixture();
  f.register();
  const result = f.store.commitExtraction({ ...IDENTITY, expectedRevision: 0,
    cellDamageUpdates: { 1: 0.75 }, cellRemainingUpdates: { 1: 24.5 } });
  assert.equal(result.success, true);
  const reopened = f.makeStore("restart").getAsteroid(IDENTITY);
  assert.deepEqual(reopened.minedCells, []);
  assert.equal(reopened.cellDamage[1], 0.75);
  assert.equal(reopened.cellRemaining[1], 24.5);
  assert.equal(reopened.remainingQuantity, 100);
});

test("pickup capacity/failure leave claim and cargo intact; successful retry consumes exactly once", () => {
  const f = fixture();
  f.register(); f.extract();
  assert.equal(f.claim().success, true);
  assert.equal(f.claim(f.store, "competitor").errorMsg, "FRAGMENT_ALREADY_CLAIMED");
  f.setCapacity(19);
  assert.equal(f.pickup().errorMsg, "NOT_ENOUGH_CARGO_SPACE");
  f.setCapacity(1000); f.setFailure(true);
  assert.equal(f.pickup().success, false);
  assert.equal(f.store.getFragment(2000000000).status, "claimed");
  assert.equal(f.tables.items.cargo, undefined);
  f.setFailure(false);
  assert.equal(f.pickup().success, true);
  assert.deepEqual(f.tables.items.cargo, { quantity: 20, typeID: 123 });
  assert.equal(f.pickup().success, false);
  assert.equal(f.claim().errorMsg, "FRAGMENT_NOT_AVAILABLE");
  assert.equal(f.makeStore("restart").getFragment(2000000000).status, "consumed");
  assert.equal(f.tables.items.cargo.quantity, 20);
});

test("cancel, lease expiry and process restart release claims and preserve pulled positions", () => {
  const f = fixture();
  f.register(); f.extract(); f.claim();
  assert.equal(f.store.updateFragmentPosition(2000000000, { x: 9, y: 8, z: 7 }, { claimToken: "wrong" }).success, false);
  assert.equal(f.store.updateFragmentPosition(2000000000, { x: 9, y: 8, z: 7 }, { claimToken: "claim" }).success, true);
  const restarted = f.makeStore("restart");
  assert.equal(f.pickup(restarted).success, false);
  const [restored] = restarted.listFragments(IDENTITY.worldRevision, IDENTITY.systemID);
  assert.equal(restored.status, "available");
  assert.deepEqual(restored.position, { x: 9, y: 8, z: 7 });
  assert.equal(f.claim(restarted, "new-claim").success, true);
  assert.equal(restarted.cancelClaim(2000000000, "wrong").success, false);
  assert.equal(restarted.cancelClaim(2000000000, "new-claim").success, true);
  assert.equal(f.claim(restarted, "again").success, true);
  f.setClock(12000);
  assert.equal(f.pickup(restarted, "again").success, false);
  assert.equal(f.claim(restarted, "after-expiry").success, true);
});


test("fragment expiry skips active pickup, persists terminal receipts and never grants expired stock", () => {
  const f = fixture(); f.register(); f.extract(); f.claim();
  f.setClock(10500);
  assert.equal(f.store.expireFragments(IDENTITY.worldRevision, IDENTITY.systemID, 1).data.length, 0);
  f.setClock(12000);
  f.setFailure(true);
  assert.equal(f.store.expireFragments(IDENTITY.worldRevision, IDENTITY.systemID, 1000).success, false);
  assert.equal(f.store.listFragments(IDENTITY.worldRevision, IDENTITY.systemID).length, 1);
  f.setFailure(false);
  assert.equal(f.store.expireFragments(IDENTITY.worldRevision, IDENTITY.systemID, 1000).data.length, 1);
  assert.equal(f.store.getFragment(2000000000).status, "expired");
  assert.equal(f.store.listFragments(IDENTITY.worldRevision, IDENTITY.systemID).length, 0);
  assert.equal(f.claim().success, false); assert.equal(f.pickup().success, false);
  assert.equal(f.tables.items.cargo, undefined);
});

test("configured respawn increments revision and generation without reusing fragment receipts", () => {
  const f = fixture(); f.register();
  const mined = f.extract({ minedCells: [0, 1, 2, 3], extractedQuantity: 100,
    cellRemainingUpdates: { 0: 0, 1: 0, 2: 0, 3: 0 },
    fragments: [{ typeID: 999, yieldTypeID: 123, quantity: 100, position: { x: 1, y: 2, z: 3 }, sourceCellIndices: [0, 1, 2, 3] }] });
  assert.equal(mined.success, true);
  assert.equal(f.store.respawnAsteroid(IDENTITY, 1000).success, false);
  f.setClock(12000); f.setFailure(true);
  assert.equal(f.store.respawnAsteroid(IDENTITY, 1000).success, false);
  assert.equal(f.store.getAsteroid(IDENTITY).remainingQuantity, 0);
  f.setFailure(false);
  const result = f.store.respawnAsteroid(IDENTITY, 1000);
  assert.equal(result.data.remainingQuantity, 100); assert.equal(result.data.generation, 1);
  assert.equal(result.data.revision, 2); assert.deepEqual(result.data.minedCells, []);
  assert.equal(result.data.lifetimeExtractedQuantity, 100);
  assert.equal(f.store.getFragment(2000000000).quantity, 100);
  assert.equal(f.store.respawnAsteroid(IDENTITY, 1000).success, false);
});


test("fragment cap refuses extraction before spending source ore or publishing fragments", () => {
  const f = fixture({ maxFragmentsPerSystem: 1, maxFragmentsPerAsteroid: 1 });
  f.register(); f.extract();
  const before = f.store.getAsteroid(IDENTITY);
  const result = f.store.commitExtraction({ ...IDENTITY, expectedRevision: before.revision, minedCells: [1],
    cellRemainingUpdates: { 1: 0 }, extractedQuantity: 20,
    fragments: [{ typeID: 999, yieldTypeID: 123, quantity: 20, position: { x: 1, y: 2, z: 3 }, sourceCellIndices: [1] }] });
  assert.equal(result.errorMsg, "FRAGMENT_LIMIT_REACHED");
  assert.deepEqual(f.store.getAsteroid(IDENTITY), before);
  assert.equal(f.store.listFragments(IDENTITY.worldRevision, IDENTITY.systemID).length, 1);
});
