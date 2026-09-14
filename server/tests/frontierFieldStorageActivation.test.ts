"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const items = new Map<number, any>();
test.mock.method(itemStore, "findItemById", id => items.get(Number(id)) || null);
const InvBrokerService = require("../src/services/inventory/invBrokerService");

function fieldStorage(itemID, activationCompleteAtMs) {
  const item = { itemID, typeID: 87566, ownerID: 140000003, locationID: 30000004,
    customInfo: JSON.stringify({ evejsFrontierConstruction: {
      assemblyStatus: 1, assemblyTypeID: 87566, activationCompleteAtMs,
      solarSystemID: 30000004,
    } }) };
  items.set(itemID, item);
  return item;
}

test.beforeEach(() => items.clear());

test("generic transfers reject pending source and destination storage until the timer clears", t => {
  const service = new InvBrokerService();
  t.mock.method(service, "_getSpaceContainerScopeAccessError", () => null);
  // The timer remains authoritative until its callback clears the persisted deadline.
  fieldStorage(9101, Date.now() - 1);
  for (const [source, destination] of [[9101, 9102], [9102, 9101]]) {
    assert.deepEqual(service._validateSpaceContainerScopeTransferAccess({}, source, destination), {
      success: false, errorMsg: "ASSEMBLY_ACTIVATING", containerID: 9101,
    });
  }
  fieldStorage(9101, 0);
  assert.deepEqual(service._validateSpaceContainerScopeTransferAccess({}, 9101, 9102), { success: true });
  assert.deepEqual(service._validateSpaceContainerScopeTransferAccess({}, 9102, 9101), { success: true });
  t.mock.method(service, "_getSpaceContainerScopeAccessError", () => "CONTAINER_NOT_VISIBLE");
  assert.equal(service._validateSpaceContainerScopeTransferAccess({}, 9101, 9102).errorMsg,
    "CONTAINER_NOT_VISIBLE", "Existing visibility restrictions still apply after activation");
});

for (const operation of ["Add", "MultiAdd"]) {
  for (const direction of ["deposit", "withdraw"]) {
    test(`${operation} rejects ${direction} through Field Storage's generic cargo path`, t => {
      const service = new InvBrokerService();
      const storageID = 9201;
      const shipID = 9202;
      const sourceID = direction === "deposit" ? shipID : storageID;
      const destinationID = direction === "deposit" ? storageID : shipID;
      fieldStorage(storageID, Date.now() + 60000);
      const cargo = { itemID: 9203, typeID: 34, categoryID: 4, flagID: 5,
        ownerID: 140000003, locationID: sourceID, quantity: 10 };
      const context = { kind: "container", inventoryID: destinationID, flagID: 5 };
      const mocks = {
        _traceInventory: () => {},
        _getBoundContext: () => context,
        _findTransferSourceItem: () => ({ item: cargo }),
        _isTransferSourceLocationMatch: () => true,
        _getPendingStructureUnanchorContainerAncestor: () => null,
        _canTakeFromCorporationHangarSource: () => true,
        _validateMoonMaterialBaySourceAccess: () => {},
        _resolveDestinationForMove: () => ({ locationID: destinationID, flagID: 5 }),
        _validateMoonMaterialBayDestination: () => ({ success: true }),
        _validateShipServiceTransferAccess: () => ({ success: true }),
        _validateMobileDepotCargoTransferAccess: () => ({ success: true }),
        _getSpaceContainerScopeAccessError: () => null,
        _getShipInventoryRecord: () => null,
        _getStructureFitHostRecord: () => null,
        _preflightSpaceLootMultiAddCapacity: () => ({ handled: false, success: true }),
      };
      for (const [method, implementation] of Object.entries(mocks)) {
        t.mock.method(service, method, implementation);
      }
      const args = [operation === "Add" ? cargo.itemID : [cargo.itemID], sourceID];
      assert.throws(() => service[`Handle_${operation}`](args, { characterID: 140000003 }, null), error => {
        const payload = error.machoErrorResponse?.payload;
        assert.equal(payload?.header?.[1]?.[0], "CustomNotify");
        assert.match(JSON.stringify(payload), /anchoring or onlining timer/);
        return true;
      });
      assert.equal(cargo.locationID, sourceID);
      assert.equal(cargo.quantity, 10);
    });
  }
}
