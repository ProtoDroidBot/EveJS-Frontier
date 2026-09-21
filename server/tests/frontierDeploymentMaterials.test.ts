"use strict";

/** Run through scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../src/gameStore");
const reference = require("../src/services/_shared/referenceData");
const originalReadStaticRows = reference.readStaticRows;

const OWNER_ID = 140000003;
const SYSTEM_ID = 30000004;
const DIRECT_TYPE_ID = 88092;
const ASSEMBLY_TYPE_ID = 88082;
const SITE_TYPE_ID = 91715;
const SHIP_TYPE_ID = 95276;
const MATERIAL_A = 84180;
const MATERIAL_B = 84210;
const OTHER_MATERIAL = 88561;
const CARGO_FLAG = 5;
const START_MS = 1700000000000;
const DURATION_SECONDS = 60;
const COST = { [MATERIAL_A]: 6, [MATERIAL_B]: 4 };
const COMPONENTS = [
  {
    typeID: DIRECT_TYPE_ID,
    smartDeployable: { createOnChain: 1, constructionCost: COST },
  },
  {
    typeID: ASSEMBLY_TYPE_ID,
    smartDeployable: {
      createOnChain: 1,
      constructionCost: COST,
      constructionSite: SITE_TYPE_ID,
    },
    activate: { durationSeconds: DURATION_SECONDS },
  },
];

test.mock.method(reference, "readStaticRows", (table) => (
  table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE
    ? COMPONENTS
    : originalReadStaticRows(table)
));

const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");
const energyRuntime = require("../src/services/frontier/networkNodeEnergyRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");

function grant(locationID, typeID, quantity, options: Record<string, any> = {}, flagID = locationID === SYSTEM_ID ? 0 : CARGO_FLAG) {
  const result = itemStore.grantItemsToCharacterLocation(
    OWNER_ID,
    locationID,
    flagID,
    [{ itemType: typeID, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items;
}

function quantities(locationID, flagID = null) {
  const result: Record<string, number> = {};
  for (const item of itemStore.listContainerItems(OWNER_ID, locationID, flagID)) {
    result[item.typeID] = (result[item.typeID] || 0) +
      (item.singleton === 1 ? 1 : Number(item.stacksize ?? item.quantity));
  }
  return result;
}

function fixture(t, available = { [MATERIAL_A]: 9, [MATERIAL_B]: 7 }) {
  const createdCharacter = !database.read("characters", String(OWNER_ID)).success;
  if (createdCharacter) {
    const written = database.write("characters", String(OWNER_ID), {
      characterID: OWNER_ID,
      characterName: "Deployment Materials Test",
      typeID: 1373,
      corporationID: 1000442,
      stationID: 64000001,
      solarSystemID: SYSTEM_ID,
      activeShipID: 0,
    }, { transient: true });
    assert.equal(written.success, true, written.errorMsg);
  }
  const originalItemIDs = new Set(
    itemStore.listOwnedItems(OWNER_ID).map((item) => item.itemID),
  );
  const [ship] = grant(SYSTEM_ID, SHIP_TYPE_ID, 1, {
    individualItems: true,
    singleton: 1,
    spaceState: {
      systemID: SYSTEM_ID,
      position: { x: 0, y: 0, z: 0 },
    },
  });
  for (const [typeID, quantity] of Object.entries(available)) {
    if (quantity > 0) grant(ship.itemID, Number(typeID), quantity);
  }
  const notifications: any[] = [];
  const session = {
    characterID: OWNER_ID,
    solarsystemid2: SYSTEM_ID,
    shipid: ship.itemID,
    sendNotification(...args) { notifications.push(args); },
  };
  const spawn = t.mock.method(spaceRuntime, "spawnDynamicInventoryEntity", () => ({
    success: true, data: {},
  }));
  t.mock.method(spaceRuntime, "removeDynamicEntity", () => ({
    success: true,
  }));
  t.mock.method(Date, "now", () => START_MS);
  t.mock.method(itemStore, "getActiveShipItem", () => itemStore.findItemById(ship.itemID));
  t.mock.method(spaceRuntime, "getEntity", (_session, itemID) => (
    Number(itemID) === Number(ship.itemID)
      ? { itemID: ship.itemID, position: { x: 0, y: 0, z: 0 } }
      : null
  ));
  const listSystemSpaceItems = itemStore.listSystemSpaceItems;
  t.mock.method(itemStore, "listSystemSpaceItems", (...args) => (
    listSystemSpaceItems(...args).filter((item) => !originalItemIDs.has(item.itemID))
  ));
  t.mock.method(energyRuntime, "reconcileNetworkNodeEnergy", () => {});
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearCompletionTimers();
  t.after(() => {
    deployment._testing.clearCompletionTimers();
    for (const item of itemStore.listOwnedItems(OWNER_ID)) {
      if (!originalItemIDs.has(item.itemID)) {
        itemStore.removeInventoryItem(item.itemID, { removeContents: true });
      }
    }
    if (createdCharacter) database.remove("characters", String(OWNER_ID));
  });

  return {
    ship,
    session,
    spawn,
    notifications,
    place(typeID, position = [100, 0, 0]) {
      return deployment.buildDeployable(session, typeID, position, [0, 0, 0]);
    },
  };
}

function inventoryUpdates(notifications) {
  return notifications.filter(args => args[0] === "OnItemsChanged")
    .flatMap(([, idType, payload]) => {
      assert.equal(idType, "charid");
      return payload[0].items.map(row => ({
        ...row.fields,
        previous: new Map(payload[1].entries),
      }));
    });
}

test("direct placement consumes each required type from ship cargo and publishes the inventory changes", t => {
  const f = fixture(t);
  grant(f.ship.itemID, OTHER_MATERIAL, 3);
  const result = f.place(DIRECT_TYPE_ID);

  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), {
    [MATERIAL_A]: 3, [MATERIAL_B]: 3, [OTHER_MATERIAL]: 3,
  });
  assert.equal(result.data.item.typeID, DIRECT_TYPE_ID);
  assert.equal(deployment.readConstructionState(result.data.item).assemblyStatus,
    deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(f.spawn.mock.callCount(), 1);
  const updates = inventoryUpdates(f.notifications);
  const first = updates.find(row => row.typeID === MATERIAL_A);
  const second = updates.find(row => row.typeID === MATERIAL_B);
  assert.equal(first.stacksize, 3);
  assert.equal(first.previous.get(9), 9);
  assert.equal(second.stacksize, 3);
  assert.equal(second.previous.get(9), 7, "each stack keeps its own previous quantity");
  assert.equal(f.notifications.filter(args => args[0] === "OnAssemblyAdded").length, 1);
});

test("placement checks the entire cost before changing inventory or spawning", t => {
  const f = fixture(t, { [MATERIAL_A]: 9, [MATERIAL_B]: 3 });
  const beforeItems = itemStore.listOwnedItems(OWNER_ID);
  const result = f.place(DIRECT_TYPE_ID);

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INSUFFICIENT_PLACEMENT_MATERIALS");
  assert.deepEqual(itemStore.listOwnedItems(OWNER_ID), beforeItems);
  assert.equal(f.spawn.mock.callCount(), 0);
  assert.equal(f.notifications.length, 0);
});

test("fully consumed stacks leave the store and client inventory, and cannot fund another assembly", t => {
  const f = fixture(t, COST);
  const materials = itemStore.listContainerItems(OWNER_ID, f.ship.itemID, CARGO_FLAG);
  const result = f.place(DIRECT_TYPE_ID);
  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), {});
  const updates = inventoryUpdates(f.notifications);
  for (const material of materials) {
    assert.equal(itemStore.findItemById(material.itemID), null);
    const removed = updates.find(row => row.itemID === material.itemID);
    assert.ok(removed, `client receives removal for consumed item ${material.itemID}`);
    assert.equal(removed.locationID, 6);
    assert.equal(removed.previous.get(3), f.ship.itemID);
  }
  const retry = f.place(DIRECT_TYPE_ID, [-2_000, 0, 0]);
  assert.equal(retry.success, false);
  assert.equal(retry.errorMsg, "INSUFFICIENT_PLACEMENT_MATERIALS");
  assert.equal(f.spawn.mock.callCount(), 1);
});

test("mixed stack removal and partial consumption send independent inventory changes", t => {
  const f = fixture(t, { [MATERIAL_A]: 6, [MATERIAL_B]: 7 });
  const result = f.place(DIRECT_TYPE_ID);
  assert.equal(result.success, true, result.errorMsg);
  const updates = inventoryUpdates(f.notifications);
  const removed = updates.find(row => row.typeID === MATERIAL_A);
  const partial = updates.find(row => row.typeID === MATERIAL_B);
  assert.ok(removed, "fully consumed material is removed from the client");
  assert.equal(removed.locationID, 6);
  assert.equal(removed.previous.get(3), f.ship.itemID);
  assert.equal(partial.locationID, f.ship.itemID);
  assert.equal(partial.stacksize, 3);
  assert.equal(partial.previous.get(9), 7);
  assert.equal(partial.previous.has(3), false, "partial stack does not reuse another row's old location");
  const assembly = updates.find(row => row.typeID === DIRECT_TYPE_ID);
  assert.equal(assembly.locationID, SYSTEM_ID);
  assert.equal(assembly.previous.get(3), 0, "assembly creation preserves its own previous location");
});

test("character inventory can supply the remaining cost after ship cargo", t => {
  const f = fixture(t, { [MATERIAL_A]: 2, [MATERIAL_B]: 0 });
  grant(OWNER_ID, MATERIAL_A, 7, {}, 4);
  grant(OWNER_ID, MATERIAL_B, 7, {}, 4);
  const result = f.place(DIRECT_TYPE_ID);
  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), {});
  const playerInventory = quantities(OWNER_ID, 4);
  assert.equal(playerInventory[MATERIAL_A], 3);
  assert.equal(playerInventory[MATERIAL_B], 3);
  const updates = inventoryUpdates(f.notifications);
  assert.ok(updates.some(row => row.typeID === MATERIAL_A && row.previous.get(3) === f.ship.itemID));
  assert.ok(updates.some(row => row.typeID === MATERIAL_B && row.locationID === OWNER_ID));
});

test("placement does not consume required types from other ship holds", t => {
  const f = fixture(t, { [MATERIAL_A]: 9, [MATERIAL_B]: 0 });
  grant(f.ship.itemID, MATERIAL_B, 10, {}, 11);
  const beforeItems = itemStore.listOwnedItems(OWNER_ID);
  const result = f.place(DIRECT_TYPE_ID);
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INSUFFICIENT_PLACEMENT_MATERIALS");
  assert.deepEqual(itemStore.listOwnedItems(OWNER_ID), beforeItems);
  assert.equal(f.spawn.mock.callCount(), 0);
});

test("construction-site assemblies retain their deposit-then-construct workflow and publish consumed materials", t => {
  const f = fixture(t);
  const result = f.place(ASSEMBLY_TYPE_ID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.item.typeID, SITE_TYPE_ID);
  const state = deployment.readConstructionState(result.data.item);
  assert.equal(state.assemblyStatus, deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION);
  assert.equal(state.completeAtMs, 0);
  assert.deepEqual(deployment.getDepositedItemsByType(f.session, result.data.item.itemID).data, {});
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), { [MATERIAL_A]: 9, [MATERIAL_B]: 7 });

  const siteID = result.data.item.itemID;
  f.notifications.length = 0;
  const deposited = deployment.depositItems(f.session, siteID, f.ship.itemID, COST);
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), { [MATERIAL_A]: 3, [MATERIAL_B]: 3 });
  const complete = deployment.completeConstruction(siteID, { force: true, session: f.session });
  assert.equal(complete.success, true, complete.errorMsg);
  assert.equal(complete.data.alreadyComplete, true);
  assert.equal(complete.data.item.typeID, ASSEMBLY_TYPE_ID);
  assert.equal(deployment.isAssemblyActivationPending(complete.data.item), true);
  const updates = inventoryUpdates(f.notifications);
  for (const typeID of [MATERIAL_A, MATERIAL_B]) {
    const removed = updates.find(row => row.typeID === typeID && row.locationID === 6);
    assert.ok(removed, "completed construction removes deposited materials from the client");
    assert.equal(removed.locationID, 6);
    assert.equal(removed.previous.get(3), siteID);
  }
  assert.deepEqual(quantities(siteID), {});
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), { [MATERIAL_A]: 3, [MATERIAL_B]: 3 });
});

test("failed deployment refunds character inventory to its original location and flag", t => {
  const f = fixture(t, { [MATERIAL_A]: 0, [MATERIAL_B]: 0 });
  grant(OWNER_ID, MATERIAL_A, 9, {}, 4);
  grant(OWNER_ID, MATERIAL_B, 7, {}, 4);
  const beforeItems = itemStore.listOwnedItems(OWNER_ID);
  f.spawn.mock.mockImplementation(() => ({ success: false, errorMsg: "TEST_SPAWN_FAILED" }));
  const result = f.place(DIRECT_TYPE_ID);
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "TEST_SPAWN_FAILED");
  assert.deepEqual(itemStore.listOwnedItems(OWNER_ID), beforeItems);
  assert.deepEqual(quantities(f.ship.itemID, CARGO_FLAG), {});
});

test("failed item creation restores all placement materials", t => {
    const f = fixture(t);
    const beforeItems = itemStore.listOwnedItems(OWNER_ID);
    t.mock.method(itemStore, "createSpaceItemForCharacter", () => ({
      success: false, errorMsg: "TEST_CREATE_FAILED",
    }));

    const result = f.place(DIRECT_TYPE_ID);
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "TEST_CREATE_FAILED");
    assert.deepEqual(itemStore.listOwnedItems(OWNER_ID), beforeItems);
    assert.equal(f.spawn.mock.callCount(), 0);
    assert.equal(f.notifications.filter(args => args[0] === "OnAssemblyAdded").length, 0);
  });

test("failed space spawn removes the placement and refunds its materials", t => {
    const f = fixture(t);
    const beforeItems = itemStore.listOwnedItems(OWNER_ID);
    f.spawn.mock.mockImplementation(() => ({
      success: false, errorMsg: "TEST_SPAWN_FAILED",
    }));

    const result = f.place(DIRECT_TYPE_ID);
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "TEST_SPAWN_FAILED");
    assert.deepEqual(itemStore.listOwnedItems(OWNER_ID), beforeItems);
    assert.equal(f.spawn.mock.callCount(), 1);
    assert.equal(f.notifications.filter(args => args[0] === "OnAssemblyAdded").length, 0);
  });
