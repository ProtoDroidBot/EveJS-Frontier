import assert from "node:assert/strict";
import test from "node:test";

const itemStore = require("../src/services/inventory/itemStore");
const items = new Map();
const removals = [];
test.mock.method(itemStore, "findItemById", id => items.get(Number(id)) || null);
test.mock.method(itemStore, "removeInventoryItem", id => {
  removals.push(Number(id));
  const item = items.get(Number(id));
  if (!item) return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  items.delete(Number(id));
  return { success: true, data: { changes: [{ removed: true, previousData: item, item }] } };
});

const InvBrokerService = require("../src/services/inventory/invBrokerService");
const npcService = require("../src/space/npc/npcService");
const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");

function session(accountRole = ROLE_GML) {
  return {
    accountRole,
    characterID: 140000005,
    shipID: 9988400000109,
    _space: { systemID: 30000004, shipID: 9988400000109 },
  };
}

function assertUserError(action, message) {
  assert.throws(action, (error: any) => {
    const payload = error.machoErrorResponse?.payload;
    assert.equal(payload?.header?.[1]?.[0], "CustomNotify");
    assert.match(JSON.stringify(payload), message);
    return true;
  });
}

test.beforeEach(() => {
  items.clear();
  removals.length = 0;
});

test("GM DestroyItem removes an NPC through its controller lifecycle", t => {
  const calls = [];
  t.mock.method(npcService, "getControllerByEntityID", id => ({ entityID: id, systemID: 30000004 }));
  t.mock.method(npcService, "destroyNpcControllerByEntityID", (id, options) => {
    calls.push({ id, options });
    return { success: true };
  });

  const service = new InvBrokerService();
  assert.equal(service.callMethod("DestroyItem", [980000000007], session()), null);
  assert.deepEqual(calls, [{
    id: 980000000007,
    options: { destroyed: true, broadcast: true },
  }]);
  assert.deepEqual(removals, []);
});

test("DestroyItem refuses non-GM callers and NPCs in another system", t => {
  const calls = [];
  t.mock.method(npcService, "getControllerByEntityID", id => ({ entityID: id, systemID: 30000005 }));
  t.mock.method(npcService, "destroyNpcControllerByEntityID", id => {
    calls.push(id);
    return { success: true };
  });
  const service = new InvBrokerService();
  assertUserError(
    () => service.callMethod("DestroyItem", [980000000007], session(0n)),
    /GM account/,
  );
  assertUserError(
    () => service.callMethod("DestroyItem", [980000000007], session()),
    /current system/,
  );
  assert.deepEqual(calls, []);
});

test("GM DestroyItem removes owned inventory through TrashItems and rejects foreign items", t => {
  t.mock.method(npcService, "getControllerByEntityID", () => null);
  const service = new InvBrokerService();
  t.mock.method(service, "_getPendingStructureUnanchorContainerAncestor", () => null);
  t.mock.method(service, "_emitInventoryMoveChanges", () => {});
  t.mock.method(service, "_refreshBallparkShipPresentation", () => {});
  t.mock.method(service, "_refreshBallparkInventoryPresentation", () => {});
  items.set(1001, { itemID: 1001, ownerID: 140000005, locationID: 60000001, flagID: 4 });
  items.set(1002, { itemID: 1002, ownerID: 140000006, locationID: 60000001, flagID: 4 });

  assert.equal(service.callMethod("DestroyItem", [1001], session()), null);
  assert.deepEqual(removals, [1001]);
  assert.equal(items.has(1001), false);
  assertUserError(
    () => service.callMethod("DestroyItem", [1002], session()),
    /cannot remove/,
  );
  assert.equal(items.has(1002), true);
});
