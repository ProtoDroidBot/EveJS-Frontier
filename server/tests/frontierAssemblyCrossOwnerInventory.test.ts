"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAssemblyCrossOwnerInventoryRuntime,
} = require("../src/services/frontier/assemblyCrossOwnerInventoryRuntime");

const OPERATION = "11111111-1111-4111-8111-111111111111";

function fixture(chainResult = true) {
  const items = new Map<any, any>([
    [100, { itemID: 100, typeID: 900, ownerID: 10, locationID: 30000142, flagID: 0 }],
    [200, { itemID: 200, typeID: 900, ownerID: 20, locationID: 30000142, flagID: 0 }],
    [300, { itemID: 300, typeID: 77818, ownerID: 10, locationID: 100, flagID: 66,
      singleton: 0, stacksize: 12, quantity: 12, volume: 1 }],
  ]);
  const receipts = new Map();
  const accessCalls: any[] = [];
  let verifies = 0;
  const itemStore = {
    findItemById(id) { const value = items.get(Number(id)); return value ? { ...value } : null; },
    findAssemblyCustodyReceipt(id) { return receipts.get(id) || null; },
    listContainerItems(ownerID, locationID, flagID) {
      return [...items.values()].filter(item => item.ownerID === ownerID &&
        item.locationID === locationID && item.flagID === flagID).map(item => ({ ...item }));
    },
    getInventoryItemUnitVolume(item) { return Number(item.volume) || 1; },
    transferItemToOwnerLocation(itemID, ownerID, locationID, flagID, quantity, options) {
      const source = items.get(itemID);
      source.stacksize -= quantity;
      source.quantity -= quantity;
      const moved = { ...source, itemID: 301, ownerID, locationID, flagID,
        stacksize: quantity, quantity, assemblyCustodyReceipts: [] };
      items.set(301, moved);
      const result = { sourceItemID: itemID, movedItemID: 301, sourceOwnerID: 10,
        destinationOwnerID: ownerID, destinationLocationID: locationID,
        destinationFlagID: flagID, quantity };
      receipts.set(options.operationKey, {
        operationKey: options.operationKey,
        operationFingerprint: options.operationFingerprint,
        result,
      });
      return { success: true, data: result };
    },
  };
  const deployment = {
    getAssemblyRecord(id) {
      const ownerID = Number(id) === 100 ? 10 : Number(id) === 200 ? 20 : 0;
      return ownerID ? { itemID: Number(id), ownerID, assemblyStatus: 2,
        assemblyTypeID: 900, solarSystemID: 30000142, createOnChain: true } : null;
    },
  };
  const access = {
    resolveAccess(actor, assemblyID, capabilities) {
      accessCalls.push({ actor, assemblyID, capabilities });
      return { success: true, data: { grants: [{ authority: "sui_confirmed" }] } };
    },
  };
  const runtime = createAssemblyCrossOwnerInventoryRuntime({
    dependencies: { itemStore, deployment, access,
      storage: { getStorageComponent: typeID => typeID === 900 ? { storageCapacity: 1000 } : null } },
    now: () => 1234,
    async verifyChainProof() { verifies += 1; return chainResult; },
  });
  return { runtime, items, receipts, accessCalls, verifies: () => verifies };
}

function request(overrides = {}) {
  return {
    action: "transfer",
    operationID: OPERATION,
    activeShipID: 50,
    solarSystemID: 30000142,
    sourceAssemblyID: 100,
    destinationAssemblyID: 200,
    sourceItemID: 300,
    quantity: 5,
    chainProof: { digest: "4".repeat(44) },
    ...overrides,
  };
}

test("cross-owner inventory requires both grants and a matching chain proof before mutation", async () => {
  const denied = fixture(false);
  const rejected = await denied.runtime.execute({ actorID: 30, kind: "player" }, request());
  assert.equal(rejected.errorMsg, "ASSEMBLY_CUSTODY_CHAIN_PROOF_INVALID");
  assert.equal(denied.items.get(300).stacksize, 12);
  assert.deepEqual(denied.accessCalls.map(call => call.capabilities[0]),
    ["inventory.withdraw", "inventory.deposit"]);

  const allowed = fixture(true);
  const result = await allowed.runtime.execute({ actorID: 30, kind: "player" }, request());
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.destinationOwnerID, 20);
  assert.equal(allowed.items.get(300).stacksize, 7);
  assert.equal(allowed.items.get(301).ownerID, 20);
  assert.equal(allowed.items.get(301).locationID, 200);
  assert.equal(allowed.verifies(), 1);
});

test("durable operation receipts make retries idempotent and reject conflicting reuse", async () => {
  const f = fixture(true);
  const first = await f.runtime.execute({ actorID: 30, kind: "player" }, request());
  assert.equal(first.success, true);
  const replay = await f.runtime.execute({ actorID: 30, kind: "player" }, request());
  assert.equal(replay.success, true);
  assert.equal(replay.replayed, true);
  assert.equal(f.verifies(), 1, "replay is answered from the durable item receipt");
  assert.equal(f.items.get(300).stacksize, 7);
  const conflict = await f.runtime.execute({ actorID: 30, kind: "player" }, request({ quantity: 4 }));
  assert.equal(conflict.errorMsg, "CUSTODY_IDEMPOTENCY_CONFLICT");
});

test("the item-table owner transfer and custody receipt commit atomically", t => {
  const itemStore = require("../src/services/inventory/itemStore");
  const previousItems = itemStore.getAllItems();
  t.after(() => { itemStore._writeItemsForTest(previousItems, { force: true }); });
  const sourceItemID = 5100000300;
  assert.equal(itemStore._writeItemsForTest({
    [sourceItemID]: {
      itemID: sourceItemID,
      typeID: 77818,
      ownerID: 10,
      locationID: 100,
      flagID: 66,
      singleton: 0,
      stacksize: 12,
      quantity: 12,
      categoryID: 4,
      groupID: 0,
      customInfo: "",
    },
  }, { force: true }), true);

  const fingerprint = "a".repeat(64);
  const first = itemStore.transferItemToOwnerLocation(
    sourceItemID, 20, 200, 66, 5,
    { operationKey: OPERATION, operationFingerprint: fingerprint, chainDigest: "4".repeat(44) },
  );
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(first.data.destinationOwnerID, 20);
  assert.equal(itemStore.findItemById(sourceItemID).stacksize, 7);
  const moved = itemStore.findItemById(first.data.movedItemID);
  assert.equal(moved.ownerID, 20);
  assert.equal(moved.locationID, 200);
  const receipt = itemStore.findAssemblyCustodyReceipt(OPERATION);
  assert.equal(receipt.operationFingerprint, fingerprint);
  assert.equal(receipt.result.movedItemID, moved.itemID);

  const replay = itemStore.transferItemToOwnerLocation(
    sourceItemID, 20, 200, 66, 5,
    { operationKey: OPERATION, operationFingerprint: fingerprint },
  );
  assert.equal(replay.success, true);
  assert.equal(replay.replayed, true);
  assert.equal(itemStore.findItemById(sourceItemID).stacksize, 7);

  const conflict = itemStore.transferItemToOwnerLocation(
    sourceItemID, 20, 200, 66, 4,
    { operationKey: OPERATION, operationFingerprint: "b".repeat(64) },
  );
  assert.equal(conflict.errorMsg, "CUSTODY_IDEMPOTENCY_CONFLICT");
});
