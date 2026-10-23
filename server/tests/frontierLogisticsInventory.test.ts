import assert = require("node:assert/strict");
import test = require("node:test");
import { spawnSync } from "node:child_process";
import path = require("node:path");

const database = require("../src/gameStore");
const sqliteStore = require("../src/gameStore/sqliteStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypes = require("../src/services/inventory/itemTypeRegistry");

const SOURCE = 5100000100;
const DESTINATION = 5100000200;
const FIRST = 5100000300;
const SECOND = 5100000301;
const EXISTING = 5100000400;
const TYPE = 78423; // Water Ice, 0.1 m³ per unit.
const OPERATION = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "a".repeat(64);

function fixture(t) {
  const previous = itemStore.getAllItems();
  // These persistence tests must also run against the runner's empty seed
  // baseline, without requiring a local extracted Frontier static database.
  itemTypes._setEntriesForTests([
    { typeID: TYPE, name: "Water Ice", groupID: 18, categoryID: 4, volume: 0.1, portionSize: 1 },
    { typeID: 77917, name: "Smart Storage Unit", groupID: 0, categoryID: 0, volume: 100, portionSize: 1 },
  ]);
  t.after(() => {
    t.mock.restoreAll();
    itemTypes._setEntriesForTests(null);
    itemStore._writeItemsForTest(previous, { force: true });
    database.flushTablesSync([itemStore.ITEMS_TABLE]);
  });
  const endpoint = (itemID, ownerID) => itemStore.buildInventoryItem({
    itemID, ownerID, locationID: 30000004, flagID: 0, typeID: 77917,
    singleton: 1, stacksize: 1, customInfo: JSON.stringify({ existing: "preserved" }),
  });
  const stack = (itemID, ownerID, locationID, quantity, flagID = 66, singleton = 0) =>
    itemStore.buildInventoryItem({ itemID, ownerID, locationID, quantity,
      stacksize: quantity, flagID, singleton, typeID: TYPE });
  const items = {
    [SOURCE]: endpoint(SOURCE, 10),
    [DESTINATION]: endpoint(DESTINATION, 20),
    [SECOND]: stack(SECOND, 10, SOURCE, 7),
    [FIRST]: stack(FIRST, 10, SOURCE, 4),
    [EXISTING]: stack(EXISTING, 20, DESTINATION, 2),
    [FIRST + 2]: stack(FIRST + 2, 99, SOURCE, 100),
    [FIRST + 3]: stack(FIRST + 3, 10, SOURCE, 100, 5),
    [FIRST + 4]: stack(FIRST + 4, 10, SOURCE, 1, 66, 1),
  };
  assert.equal(itemStore._writeItemsForTest(items, { force: true }), true);
  assert.equal(database.flushTablesSync([itemStore.ITEMS_TABLE]).success, true);
  const request = {
    operationID: OPERATION, operationFingerprint: FINGERPRINT,
    sourceOwnerID: 10, sourceLocationID: SOURCE, sourceFlagID: 66,
    destinationOwnerID: 20, destinationLocationID: DESTINATION, destinationFlagID: 66,
    typeID: TYPE, quantity: 8, destinationCapacity: 100, maxTypeQuantity: 100,
    committedAtMs: 1234,
    receiptContext: { source: { itemID: SOURCE, ownerID: 10 }, destination: { itemID: DESTINATION, ownerID: 20 } },
  };
  return { request, items, volume: itemStore.getInventoryItemUnitVolume(items[FIRST]) };
}

function total(ownerID, locationID, flagID = 66) {
  return itemStore.listContainerItems(ownerID, locationID, flagID)
    .filter(item => item.typeID === TYPE && item.singleton === 0)
    .reduce((sum, item) => sum + item.stacksize, 0);
}

test("logistics atomically moves exact quantities across deterministic source stacks and owners", t => {
  const { request } = fixture(t);
  const write = t.mock.method(database, "write");
  const result = itemStore.transferAssemblyItemType(request);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.gameCommitted, true);
  assert.deepEqual(result.data.moves.map(move => [move.sourceItemID, move.quantity]), [[FIRST, 4], [SECOND, 4]]);
  assert.equal(total(10, SOURCE), 3);
  assert.equal(total(20, DESTINATION), 10);
  assert.equal(total(99, SOURCE), 100);
  assert.equal(total(10, SOURCE, 5), 100);
  assert.equal(itemStore.findItemById(FIRST + 4).singleton, 1);
  assert.equal(write.mock.calls.filter(call => call.arguments[0] === itemStore.ITEMS_TABLE).length, 1);
  const endpoint = itemStore.findItemById(DESTINATION);
  assert.deepEqual(JSON.parse(endpoint.customInfo), { existing: "preserved" });
  const receipt = itemStore.findAssemblyLogisticsReceipt(OPERATION, DESTINATION);
  assert.equal(receipt.operationFingerprint, FINGERPRINT);
  assert.deepEqual(receipt.result.context, request.receiptContext);
  assert.equal(receipt.result.committedAtMs, 1234);
  assert.equal(receipt.result.changes, undefined, "receipt avoids indefinitely retaining notification snapshots");
  assert.ok(result.data.movedItemIDs.every(id => !itemStore.findItemById(id).assemblyLogisticsReceipts));
  const persisted = sqliteStore.loadTableObject(itemStore.ITEMS_TABLE);
  assert.equal(persisted[String(DESTINATION)].assemblyLogisticsReceipts[OPERATION].result.quantity, 8);
  assert.equal(persisted[String(SECOND)].stacksize, 3);
});

test("receipt survives stock consumption, endpoint updates and a fresh process before replay", t => {
  const { request } = fixture(t);
  const first = itemStore.transferAssemblyItemType(request);
  assert.equal(first.success, true, first.errorMsg);
  for (const id of first.data.movedItemIDs) {
    assert.equal(itemStore.removeInventoryItem(id, { removeContents: false }).success, true);
  }
  assert.equal(itemStore.removeInventoryItem(SOURCE, { removeContents: false }).success, true);
  assert.equal(itemStore.updateInventoryItem(DESTINATION, current => ({ ...current, ownerID: 77 })).success, true);
  assert.equal(database.flushTablesSync([itemStore.ITEMS_TABLE]).success, true);
  const snapshot = itemStore.getAllItems();
  const retry = { ...request, destinationCapacity: 0, maxTypeQuantity: 1 };
  const replay = itemStore.transferAssemblyItemType(retry);
  assert.equal(replay.success, true, replay.errorMsg);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.data.changes, []);
  assert.deepEqual(itemStore.getAllItems(), snapshot);
  const probe = spawnSync(process.execPath, ["-e", [
    "const store = require('./server/src/services/inventory/itemStore');",
    `const result = store.transferAssemblyItemType(${JSON.stringify(retry)});`,
    "process.stdout.write('LOGISTICS_REPLAY=' + JSON.stringify(result) + '\\n');",
  ].join("\n")], { cwd: path.resolve(__dirname, "../.."), env: process.env, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const line = probe.stdout.split(/\r?\n/).find(value => value.startsWith("LOGISTICS_REPLAY="));
  assert.ok(line, probe.stdout);
  const restarted = JSON.parse(line.slice("LOGISTICS_REPLAY=".length));
  assert.equal(restarted.success, true, restarted.errorMsg);
  assert.equal(restarted.replayed, true);
  assert.deepEqual(restarted.data.context, request.receiptContext);
  assert.deepEqual(restarted.data.changes, []);
});

test("operation IDs reject changed fingerprints and changed transfer fields globally", t => {
  const { request } = fixture(t);
  assert.equal(itemStore.transferAssemblyItemType(request).success, true);
  const before = itemStore.getAllItems();
  for (const update of [
    { operationFingerprint: "b".repeat(64) }, { quantity: 7 },
    { destinationLocationID: SOURCE + 99 }, { sourceOwnerID: 99 },
  ]) {
    assert.equal(itemStore.transferAssemblyItemType({ ...request, ...update }).errorMsg,
      "LOGISTICS_IDEMPOTENCY_CONFLICT");
  }
  assert.deepEqual(itemStore.getAllItems(), before);
});

test("insufficient stock, malformed later stacks and capacity failures leave every row untouched", t => {
  const { request, volume } = fixture(t);
  const before = itemStore.getAllItems();
  for (const [update, error] of [
    [{ quantity: 12 }, "INSUFFICIENT_ITEMS"],
    [{ destinationCapacity: 9 * volume }, "STORAGE_CAPACITY_EXCEEDED"],
    [{ maxTypeQuantity: 9 }, "STORAGE_TYPE_QUANTITY_EXCEEDED"],
    [{ sourceOwnerID: 99 }, "LOGISTICS_ENDPOINT_MISMATCH"],
    [{ quantity: 0xffffffff + 1, maxTypeQuantity: 0xffffffff }, "STORAGE_TYPE_QUANTITY_EXCEEDED"],
  ] as const) {
    assert.equal(itemStore.transferAssemblyItemType({ ...request, ...update }).errorMsg, error);
    assert.deepEqual(itemStore.getAllItems(), before);
    assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null);
  }
  const malformed = { ...before, [SECOND]: { ...before[SECOND], quantity: 0, stacksize: 0 } };
  itemStore._writeItemsForTest(malformed, { force: true });
  assert.equal(itemStore.transferAssemblyItemType({ ...request, quantity: 4 }).errorMsg, "INVALID_LOGISTICS_SOURCE");
  assert.deepEqual(itemStore.getAllItems(), malformed);
});

test("invalid receipt context or unknown-volume source cannot produce a committed receipt", t => {
  const { request } = fixture(t);
  const before = itemStore.getAllItems();
  for (const receiptContext of [{ secret: "x".repeat(16384) }, { invalid: Infinity }, { invalid: undefined }]) {
    assert.equal(itemStore.transferAssemblyItemType({ ...request, receiptContext }).errorMsg,
      "INVALID_LOGISTICS_RECEIPT_CONTEXT");
  }
  const unknownType = 2147483646;
  const malformed = { ...before,
    [FIRST]: { ...before[FIRST], typeID: unknownType, volume: 0 },
    [SECOND]: { ...before[SECOND], typeID: unknownType, volume: 0 },
  };
  itemStore._writeItemsForTest(malformed, { force: true });
  assert.equal(itemStore.transferAssemblyItemType({ ...request, typeID: unknownType }).errorMsg,
    "INVALID_LOGISTICS_SOURCE");
  assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null);
  assert.deepEqual(itemStore.getAllItems(), malformed);
});

test("failed item-table writes do not expose staged stacks or receipt", t => {
  const { request } = fixture(t);
  const before = itemStore.getAllItems();
  const originalWrite = database.write;
  t.mock.method(database, "write", (table, ...args) => table === itemStore.ITEMS_TABLE
    ? { success: false, errorMsg: "INJECTED_WRITE_FAILURE" } : originalWrite(table, ...args));
  assert.equal(itemStore.transferAssemblyItemType(request).errorMsg, "WRITE_ERROR");
  assert.deepEqual(itemStore.getAllItems(), before);
  assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null);
});

for (const throws of [false, true]) {
  test(`failed durable flush (${throws ? "exception" : "failure result"}) restores stock and allows an exact retry`, t => {
    const { request } = fixture(t);
    const before = itemStore.getAllItems();
    const originalFlush = database.flushTablesSync;
    let calls = 0;
    t.mock.method(database, "flushTablesSync", tables => {
      if (++calls === 1) {
        if (throws) throw new Error("INJECTED_FLUSH_FAILURE");
        return { success: false };
      }
      return originalFlush(tables);
    });
    assert.equal(itemStore.transferAssemblyItemType(request).errorMsg, "PERSISTENCE_FLUSH_ERROR");
    assert.equal(calls, 2, "rollback is flushed before returning failure");
    assert.deepEqual(itemStore.getAllItems(), before);
    assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null);
    const persisted = sqliteStore.loadTableObject(itemStore.ITEMS_TABLE);
    assert.deepEqual(persisted, before);
    const retry = itemStore.transferAssemblyItemType(request);
    assert.equal(retry.success, true, retry.errorMsg);
    assert.equal(retry.replayed, false);
    assert.equal(total(10, SOURCE), 3);
    assert.equal(total(20, DESTINATION), 10);
  });
}

for (const failure of ["write", "flush"] as const) {
  test(`failed rollback ${failure} hides the receipt and blocks mutations until durable recovery`, t => {
    const { request } = fixture(t);
    const before = itemStore.getAllItems();
    const originalWrite = database.write;
    const originalFlush = database.flushTablesSync;
    let recovering = false;
    let itemWrites = 0;
    let flushes = 0;
    t.mock.method(database, "write", (table, ...args) => {
      if (table === itemStore.ITEMS_TABLE && ++itemWrites > 1 &&
          failure === "write" && !recovering) return { success: false };
      return originalWrite(table, ...args);
    });
    t.mock.method(database, "flushTablesSync", tables => {
      if (!recovering) {
        // Simulate an ambiguous commit: it reached disk but its acknowledgement
        // failed. Later rollback flushes remain unavailable until recovery.
        if (++flushes === 1 && failure === "flush") originalFlush(tables);
        return { success: false };
      }
      return originalFlush(tables);
    });
    assert.equal(itemStore.transferAssemblyItemType(request).errorMsg, "PERSISTENCE_FLUSH_ERROR");
    assert.deepEqual(itemStore.getAllItems(), before);
    assert.equal(total(10, SOURCE), 11);
    assert.equal(total(20, DESTINATION), 2);
    assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null,
      "an unacknowledged receipt must not be mistaken for a durable commit");
    assert.equal(itemStore.transferAssemblyItemType(request).errorMsg, "PERSISTENCE_FLUSH_ERROR");
    assert.equal(itemStore.writeItemCustomInfo(DESTINATION, "changed").success, false);
    assert.equal(itemStore._writeItemsForTest({}), false,
      "ordinary writes cannot replace the pending rollback snapshot");
    assert.deepEqual(itemStore.getAllItems(), before);
    if (failure === "flush") {
      assert.ok(sqliteStore.loadTableObject(itemStore.ITEMS_TABLE)[DESTINATION]
        .assemblyLogisticsReceipts[OPERATION], "the test covers an ambiguous disk commit");
    }

    recovering = true;
    assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION), null);
    assert.deepEqual(sqliteStore.loadTableObject(itemStore.ITEMS_TABLE), before,
      "rollback must reach disk before the latch clears");
    const retry = itemStore.transferAssemblyItemType(request);
    assert.equal(retry.success, true, retry.errorMsg);
    assert.equal(retry.replayed, false);
    assert.equal(total(10, SOURCE), 3);
    assert.equal(total(20, DESTINATION), 10);
    assert.equal(itemStore.findAssemblyLogisticsReceipt(OPERATION).result.quantity, 8);
    assert.equal(itemStore.transferAssemblyItemType(request).replayed, true);
    assert.equal(total(20, DESTINATION), 10);
  });
}
