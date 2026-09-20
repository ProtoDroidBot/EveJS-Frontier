"use strict";

/** Run through scripts/Tests/run-isolated-tests.js against a disposable Frontier store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const characterState = require("../src/services/character/characterState");
const spaceRuntime = require("../src/space/runtime");
const blueprints = require("../src/services/frontier/industryBlueprints");
const industry = require("../src/services/frontier/industryRuntime");
const networkNodeFuel = require("../src/services/frontier/networkNodeFuelRuntime");
const IndustryService = require("../src/services/frontier/industryService");
const { ASSEMBLY_STATUS_UNDER_CONSTRUCTION } = require("../src/services/frontier/deploymentRuntime");
const { INDUSTRY_INPUT_FLAG, INDUSTRY_OUTPUT_FLAG } = industry;

const OWNER_ID = 140000003;
const OTHER_OWNER_ID = 140000002;
const SYSTEM_ID = 30000004;
const FACILITY_TYPE_ID = 87119;
const SHIP_TYPE_ID = 95276;
const MATERIAL_A = 78423;
const MATERIAL_B = 84180;
const NETWORK_FUEL = 77818;
const CARGO_FLAG = 5;
const BLUEPRINT = {
  blueprint_id: 1,
  run_time: 60,
  inputs: {
    [MATERIAL_A]: { type_id: MATERIAL_A, quantity_per_run: 3, max_storable_quantity: 1000 },
    [MATERIAL_B]: { type_id: MATERIAL_B, quantity_per_run: 2, max_storable_quantity: 1000 },
    [NETWORK_FUEL]: { type_id: NETWORK_FUEL, quantity_per_run: 1, max_storable_quantity: 1000 },
  },
  outputs: {
    [MATERIAL_A]: { type_id: MATERIAL_A, quantity_per_run: 1, max_storable_quantity: 1000 },
  },
};

function seedCharacter(characterID) {
  const result = characterState.writeCharacterRecord(characterID, {
    characterID,
    characterName: `Industry Test ${characterID}`,
    corporationID: 1000442,
    solarSystemID: SYSTEM_ID,
    shipID: 0,
    shipTypeID: 0,
    suppressActiveShipProvisioning: true,
  });
  assert.equal(result.success, true, result.errorMsg);
}

test.beforeEach(() => {
  seedCharacter(OWNER_ID);
  seedCharacter(OTHER_OWNER_ID);
});

function grant(ownerID, locationID, flagID, typeID, quantity, options = {}) {
  const result = itemStore.grantItemsToCharacterLocation(
    ownerID, locationID, flagID, [{ itemType: typeID, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function totalAt(locationID, flagID, typeID, ownerID = OWNER_ID) {
  return itemStore.listContainerItems(ownerID, locationID, flagID)
    .filter(item => Number(item.typeID) === typeID)
    .reduce((sum, item) => sum + Number(item.stacksize ?? item.quantity), 0);
}

function snapshot(locationIDs) {
  return locationIDs.flatMap(locationID =>
    [OWNER_ID, OTHER_OWNER_ID].flatMap(ownerID =>
      itemStore.listContainerItems(ownerID, locationID, null),
    ),
  ).sort((left, right) => Number(left.itemID) - Number(right.itemID));
}

function fixture(t) {
  const ship = grant(OWNER_ID, SYSTEM_ID, 0, SHIP_TYPE_ID, 1, {
    individualItems: true, singleton: 1,
  });
  // Newly granted Creations lazily materialize their default parts when cargo
  // capacity is first read. Finish fixture construction before snapshotting.
  require("../src/services/frontier/smartStorageUnitRuntime").getShipCargoCapacity(OWNER_ID, ship);
  const facility = grant(OWNER_ID, SYSTEM_ID, 0, FACILITY_TYPE_ID, 1, {
    individualItems: true, singleton: 1,
  });
  const notifications: any[] = [];
  const session = {
    characterID: OWNER_ID,
    solarsystemid2: SYSTEM_ID,
    shipid: ship.itemID,
    sendNotification(...args) { notifications.push(args); },
  };
  const access = { distance: 100, visible: true };
  const entities = new Map([
    [ship.itemID, { itemID: ship.itemID, position: { x: 0, y: 0, z: 0 } }],
    [facility.itemID, { itemID: facility.itemID, position: { x: 100, y: 0, z: 0 } }],
  ]);
  t.mock.method(itemStore, "getActiveShipItem", () => itemStore.findItemById(ship.itemID));
  t.mock.method(spaceRuntime, "getSceneForSession", () => access.visible ? {
    getCommandTimeEntitySurfaceDistance: () => access.distance,
  } : null);
  t.mock.method(spaceRuntime, "getEntity", (_session, itemID) => entities.get(Number(itemID)) || null);
  const selectedBlueprint = t.mock.method(blueprints, "getSelectedBlueprint", () => BLUEPRINT);
  return {
    ship, facility, session, access, entities, selectedBlueprint, notifications,
    cargo: (typeID, quantity) => grant(OWNER_ID, ship.itemID, CARGO_FLAG, typeID, quantity),
    storage(ownerID = OWNER_ID, assemblyStatus = 2) {
      const unit = grant(ownerID, SYSTEM_ID, 0, 77917, 1, { individualItems: true, singleton: 1 });
      const result = itemStore.updateInventoryItem(unit.itemID, current => ({ ...current,
        customInfo: JSON.stringify({ evejsFrontierConstruction: {
          assemblyStatus, assemblyTypeID: 77917, ownerID, solarSystemID: SYSTEM_ID,
          createdAtMs: 1, completedAtMs: 1,
        } }),
      }));
      assert.equal(result.success, true);
      entities.set(unit.itemID, { itemID: unit.itemID, position: { x: 150, y: 0, z: 0 } });
      return result.data;
    },
    turret(ownerID = OWNER_ID, assemblyStatus = 2) {
      const turret = grant(ownerID, SYSTEM_ID, 0, 92279, 1, { individualItems: true, singleton: 1 });
      const result = itemStore.updateInventoryItem(turret.itemID, current => ({ ...current,
        customInfo: JSON.stringify({ evejsFrontierConstruction: {
          assemblyStatus, assemblyTypeID: 92279, ownerID, solarSystemID: SYSTEM_ID,
          createdAtMs: 1, completedAtMs: 1,
        } }),
      }));
      assert.equal(result.success, true);
      entities.set(turret.itemID, { itemID: turret.itemID, position: { x: 150, y: 0, z: 0 } });
      return result.data;
    },
    networkNode(ownerID = OWNER_ID, assemblyStatus = 1) {
      const node = grant(ownerID, SYSTEM_ID, 0, networkNodeFuel.NETWORK_NODE_TYPE_ID, 1, {
        individualItems: true, singleton: 1,
      });
      const result = itemStore.updateInventoryItem(node.itemID, current => ({ ...current,
        customInfo: JSON.stringify({ evejsFrontierConstruction: {
          assemblyStatus,
          assemblyTypeID: networkNodeFuel.NETWORK_NODE_TYPE_ID,
          ownerID,
          solarSystemID: SYSTEM_ID,
          createdAtMs: 1,
          completedAtMs: 1,
        } }),
      }));
      assert.equal(result.success, true);
      entities.set(node.itemID, { itemID: node.itemID, position: { x: 150, y: 0, z: 0 } });
      return result.data;
    },
    stored: (typeID, quantity, side = "inputs", ownerID = OWNER_ID) => grant(
      ownerID, facility.itemID,
      side === "outputs" ? INDUSTRY_OUTPUT_FLAG : INDUSTRY_INPUT_FLAG,
      typeID, quantity,
    ),
    deposit: raw => industry.depositInputItems(session, facility.itemID, raw),
    withdraw: (raw, side = "inputs", inventoryID = ship.itemID, flagID = CARGO_FLAG) =>
      industry.withdrawItems(session, facility.itemID, raw, inventoryID, flagID, side),
  };
}

test("partial and full industry deposits subtract exactly the requested cargo and preserve total units", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 40);
  const partial = f.deposit({ [stack.itemID]: 13 });
  assert.equal(partial.success, true, partial.errorMsg);
  assert.deepEqual(partial.data.items, { [MATERIAL_A]: 13 });
  assert.equal(itemStore.findItemById(stack.itemID).stacksize, 27);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 27);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 13);

  const remainder = f.deposit({ [stack.itemID]: 27 });
  assert.equal(remainder.success, true, remainder.errorMsg);
  assert.deepEqual(remainder.data.items, { [MATERIAL_A]: 27 });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 40);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_OUTPUT_FLAG, MATERIAL_A), 0);
  assert.deepEqual(industry.getFacilityItems(f.facility), {
    inputs: { [MATERIAL_A]: 40 }, outputs: {},
  });
});

test("SSU inputs and Industry inputs/outputs transfer atomically without routing through ship cargo", t => {
  const f = fixture(t);
  const storage = f.storage();
  const stack = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 40);
  const deposited = f.deposit({ [stack.itemID]: 13 });
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 27);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 13);
  assert.equal(deposited.data.storageTransfers[0].direction, "withdraw");
  assert.deepEqual(deposited.data.storageTransfers[0].items, { [MATERIAL_A]: 13 });
  const withdrawn = f.withdraw({ [MATERIAL_A]: 5 }, "inputs", storage.itemID, 66);
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 32);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 8);
  assert.equal(withdrawn.data.storageTransfers[0].direction, "deposit");
  f.stored(MATERIAL_A, 6, "outputs");
  assert.equal(f.withdraw({ [MATERIAL_A]: 6 }, "outputs", storage.itemID, 66).success, true);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 38);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_OUTPUT_FLAG, MATERIAL_A), 0);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
});

test("Smart Turret flag-0 cargo transfers directly to and from Industry", t => {
  const f = fixture(t);
  const turret = f.turret();
  const stack = grant(OWNER_ID, turret.itemID, 0, MATERIAL_A, 40);
  const deposited = f.deposit({ [stack.itemID]: 13 });
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(totalAt(turret.itemID, 0, MATERIAL_A), 27);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 13);
  assert.equal(deposited.data.storageTransfers.length, 0,
    "Turret cargo has no Sui StorageUnit inventory mirror");
  assert.deepEqual(deposited.data.chain,
    { status: "disabled", industryStatus: "disabled", storageStatus: "disabled" });

  const withdrawn = f.withdraw({ [MATERIAL_A]: 5 }, "inputs", turret.itemID, 0);
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(totalAt(turret.itemID, 0, MATERIAL_A), 32);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 8);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
});

test("Industry deposits to and withdraws from a Network Node virtual fuel bay", async t => {
  const f = fixture(t);
  const node = f.networkNode();
  f.stored(NETWORK_FUEL, 50, "outputs");

  const deposited = await f.withdraw(
    { [NETWORK_FUEL]: 30 },
    "outputs",
    node.itemID,
    networkNodeFuel.NETWORK_NODE_FUEL_BAY_FLAG,
  );
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(deposited.data.networkNodeFuelTransfer.direction, "deposit");
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_OUTPUT_FLAG, NETWORK_FUEL), 20);
  assert.equal(networkNodeFuel.readNetworkNodeFuelState(itemStore.findItemById(node.itemID)).quantity, 30);

  const withdrawn = await industry.depositStorageInputItems(
    f.session,
    f.facility.itemID,
    node.itemID,
    { [NETWORK_FUEL]: 10 },
  );
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(withdrawn.data.networkNodeFuelTransfer.direction, "withdraw");
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, NETWORK_FUEL), 10);
  assert.equal(networkNodeFuel.readNetworkNodeFuelState(itemStore.findItemById(node.itemID)).quantity, 20);

  const emptied = await industry.emptyActiveBlueprint(f.session, f.facility.itemID, node.itemID);
  assert.equal(emptied.success, true, emptied.errorMsg);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, NETWORK_FUEL), 0);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_OUTPUT_FLAG, NETWORK_FUEL), 0);
  assert.equal(networkNodeFuel.readNetworkNodeFuelState(itemStore.findItemById(node.itemID)).quantity, 50);

  const { createIndustryStorageOperations } = require("../src/_secondary/express/smartIndustryStorageApi");
  const api = createIndustryStorageOperations({
    resolve: () => ({ success: true, data: {
      characterID: OWNER_ID,
      walletAddress: "0x1",
      session: f.session,
      facilityID: f.facility.itemID,
    } }),
    failed: errorMsg => ({ success: false, errorMsg }),
  });
  const listing = await api.storage("token", f.facility.itemID);
  assert.equal(listing.success, true, listing.errorMsg);
  const listedNode = listing.data.storageUnits.find(unit => unit.storageUnitID === node.itemID);
  assert.ok(listedNode, "Network Node fuel slot is exposed as an Industry endpoint");
  assert.equal(listedNode.flagID, networkNodeFuel.NETWORK_NODE_FUEL_BAY_FLAG);
  assert.equal(listedNode.assemblyKind, "network_node_fuel");
  assert.deepEqual(listedNode.items.map(item => ({ typeID: item.typeID, quantity: item.quantity })), [
    { typeID: NETWORK_FUEL, quantity: 50 },
  ]);
});

test("SSU visitor partitions preserve ownership and do not count other partitions toward capacity", t => {
  const f = fixture(t);
  const storage = f.storage(OTHER_OWNER_ID);
  const access = require("../src/services/frontier/industryInventoryAccess")
    .resolveIndustryInventory(f.session, storage.itemID, 66);
  assert.equal(access.success, true, access.errorMsg);
  const other = grant(OTHER_OWNER_ID, storage.itemID, 66, MATERIAL_A, Math.ceil(access.data.capacity / 0.1));
  const own = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  assert.equal(f.deposit({ [other.itemID]: 1 }).success, false);
  assert.equal(f.deposit({ [own.itemID]: 4 }).success, true);
  assert.equal(f.withdraw({ [MATERIAL_A]: 3 }, "inputs", storage.itemID, 66).success, true);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 11);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A, OTHER_OWNER_ID), Math.ceil(access.data.capacity / 0.1));
});

test("SSU transfers reject offline, activating, remote and out-of-range storage without changing inventory", t => {
  const f = fixture(t);
  const storage = f.storage();
  const stack = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  f.stored(MATERIAL_A, 5);
  const reject = () => {
    const before = snapshot([storage.itemID, f.facility.itemID]);
    assert.equal(f.deposit({ [stack.itemID]: 1 }).success, false);
    assert.equal(f.withdraw({ [MATERIAL_A]: 1 }, "inputs", storage.itemID, 66).success, false);
    assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), before);
  };
  const setState = state => itemStore.updateInventoryItem(storage.itemID, current => ({ ...current,
    customInfo: JSON.stringify({ evejsFrontierConstruction: {
      assemblyStatus: 2, assemblyTypeID: 77917, solarSystemID: SYSTEM_ID, ownerID: OWNER_ID, ...state,
    } }),
  }));
  for (const state of [{ assemblyStatus: 1 }, { assemblyStatus: ASSEMBLY_STATUS_UNDER_CONSTRUCTION },
    { activationCompleteAtMs: Date.now() - 1 }, { solarSystemID: SYSTEM_ID + 1 }]) {
    assert.equal(setState(state).success, true);
    reject();
  }
  assert.equal(setState({}).success, true);
  f.entities.delete(storage.itemID);
  reject();
  f.entities.set(storage.itemID, { itemID: storage.itemID, position: { x: 150, y: 0, z: 0 } });
  f.access.distance = 5001;
  reject();
});

test("SSU capacity and uint32 per-type ceilings reject complete withdrawal batches", t => {
  const f = fixture(t);
  const storage = f.storage();
  const access = require("../src/services/frontier/industryInventoryAccess")
    .resolveIndustryInventory(f.session, storage.itemID, 66);
  grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, Math.ceil(access.data.capacity / 0.1));
  f.stored(MATERIAL_A, 5);
  f.stored(MATERIAL_B, 5);
  const before = snapshot([storage.itemID, f.facility.itemID]);
  const overflow = f.withdraw({ [MATERIAL_A]: 1, [MATERIAL_B]: 1 }, "inputs", storage.itemID, 66);
  assert.equal(overflow.errorMsg, "STORAGE_CAPACITY_EXCEEDED");
  assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), before);
  t.mock.method(itemStore, "getInventoryItemUnitVolume", () => 0);
  const rows = itemStore.listContainerItems(OWNER_ID, storage.itemID, 66);
  assert.equal(itemStore.updateInventoryItem(rows[0].itemID, item => ({ ...item,
    stacksize: 0xffffffff, quantity: 0xffffffff,
  })).success, true);
  const atLimit = snapshot([storage.itemID, f.facility.itemID]);
  const typeOverflow = f.withdraw({ [MATERIAL_A]: 1 }, "inputs", storage.itemID, 66);
  assert.equal(typeOverflow.errorMsg, "STORAGE_TYPE_QUANTITY_EXCEEDED");
  assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), atLimit);
});

test("SSU transfer rolls back all stacks when the atomic item-store mutation fails", t => {
  const f = fixture(t);
  const storage = f.storage();
  const first = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  const second = grant(OWNER_ID, storage.itemID, 66, MATERIAL_B, 7);
  const before = snapshot([storage.itemID, f.facility.itemID]);
  const move = itemStore.moveItemsToLocations;
  t.mock.method(itemStore, "moveItemsToLocations", requests => move([...requests, {
    itemID: 999999999999, quantity: 1, destinationLocationID: f.facility.itemID,
    destinationFlagID: INDUSTRY_INPUT_FLAG,
  }]));
  assert.equal(f.deposit({ [first.itemID]: 3, [second.itemID]: 2 }).success, false);
  assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), before);
});

test("SSU transfers refresh both assemblies before commit and retain committed items if chain sync fails", async t => {
  const f = fixture(t);
  const storage = f.storage(OWNER_ID, 1);
  const stack = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  const { registerSuiAssemblyStatesRunner } = require("../src/services/frontier/suiAssemblyState");
  let locked = false;
  t.after(registerSuiAssemblyStatesRunner(async (ids, operation) => {
    assert.deepEqual(new Set(ids), new Set([f.facility.itemID, storage.itemID]));
    await Promise.resolve();
    assert.equal(itemStore.updateInventoryItem(storage.itemID, current => {
      const info = JSON.parse(current.customInfo);
      info.evejsFrontierConstruction.assemblyStatus = 2;
      return { ...current, customInfo: JSON.stringify(info) };
    }).success, true);
    locked = true;
    try { return operation(); } finally { locked = false; }
  }));
  const sync = t.mock.method(require("../src/services/frontier/suiIndustryStorageSync"),
    "syncIndustryStorageTransfer", async request => {
      assert.equal(locked, false, "chain synchronization must not reacquire the held lifecycle queue");
      assert.equal(request.storageUnitID, storage.itemID);
      assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 8);
      throw new Error("RPC unavailable after commit");
    });
  const result = await f.deposit({ [stack.itemID]: 4 });
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "pending");
  assert.equal(sync.mock.callCount(), 1);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 4);
});

test("SSU commit rechecks authorization and binds deposits to the source selected before the queue wait", async t => {
  const f = fixture(t);
  const storage = f.storage();
  const stack = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  const { registerSuiAssemblyStatesRunner } = require("../src/services/frontier/suiAssemblyState");
  let beforeCommit = () => {};
  t.after(registerSuiAssemblyStatesRunner(async (_ids, operation) => {
    await Promise.resolve();
    beforeCommit();
    return operation();
  }));
  let allowed = true;
  beforeCommit = () => { allowed = false; };
  const initial = snapshot([storage.itemID, f.facility.itemID]);
  const revoked = await industry.depositInputItems(f.session, f.facility.itemID, { [stack.itemID]: 3 }, {
    storageUnitID: storage.itemID,
    assertAccess: () => allowed ? { success: true } : { success: false, errorMsg: "AUTH_EXPIRED" },
  });
  assert.equal(revoked.errorMsg, "AUTH_EXPIRED");
  assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), initial);
  beforeCommit = () => {
    assert.equal(itemStore.moveItemToLocation(stack.itemID, f.ship.itemID, CARGO_FLAG, 12).success, true);
  };
  const movedSource = await industry.depositInputItems(f.session, f.facility.itemID, { [stack.itemID]: 3 }, {
    storageUnitID: storage.itemID, assertAccess: () => ({ success: true }),
  });
  assert.equal(movedSource.errorMsg, "INVALID_SOURCE");
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 0);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 12);
  f.stored(MATERIAL_A, 3);
  beforeCommit = () => {};
  const revokedWithdraw = await industry.withdrawItems(f.session, f.facility.itemID, { [MATERIAL_A]: 2 },
    storage.itemID, 66, "inputs", { assertAccess: () => ({ success: false, errorMsg: "AUTH_EXPIRED" }) });
  assert.equal(revokedWithdraw.errorMsg, "AUTH_EXPIRED");
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 3);
});

test("Industry RPCs notify SSU and Industry clients for each committed direct transfer", t => {
  const f = fixture(t);
  const storage = f.storage();
  const stack = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 12);
  const notice = t.mock.method(require("../src/_secondary/express/publicGatewayLocal"), "publishGatewayNotice", () => true);
  const service = new IndustryService();
  service.Handle_deposit_input_items([f.facility.itemID, { [stack.itemID]: 4 }], f.session);
  service.Handle_withdraw_input_items([f.facility.itemID, { [MATERIAL_A]: 3 }, storage.itemID, 66], f.session);
  const { getStorageUnitProtoTypes } = require("../src/_secondary/express/gatewayServices/assemblyStorageUnitProto");
  for (const [name, quantity] of [["InventoryItemWithdrawnNotice", 4], ["InventoryItemDepositedNotice", 3]]) {
    const call = notice.mock.calls.find(call => call.arguments[0].endsWith(`.${name}`));
    assert.ok(call, `${name} published`);
    const payload = getStorageUnitProtoTypes()[name].decode(call.arguments[1]);
    assert.equal(Number(payload.storage_unit.sequential), storage.itemID);
    assert.equal(Number(payload.character.sequential), OWNER_ID);
    assert.equal(Number(payload.item.attributes.quantity), quantity);
    assert.equal(Number(payload.item.attributes.identifier.sequential), MATERIAL_A);
  }
  assert.equal(f.notifications.filter(([name]) => name === "OnItemsChanged").length, 4);
});

test("Industry storage API integrates real inventory listing, transfers and exactly-once receipts", async t => {
  const f = fixture(t);
  const storage = f.storage(OTHER_OWNER_ID);
  const offline = f.storage(OWNER_ID, 1);
  const remote = f.storage();
  f.entities.delete(remote.itemID);
  const own = grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 4);
  const second = grant(OWNER_ID, storage.itemID, 4, MATERIAL_A, 8);
  assert.equal(itemStore.moveItemToLocation(second.itemID, storage.itemID, 66, 8).success, true);
  const other = grant(OTHER_OWNER_ID, storage.itemID, 66, MATERIAL_A, 50);
  const move = itemStore.moveItemsToLocations;
  const mutations = t.mock.method(itemStore, "moveItemsToLocations", requests => move(requests));
  t.mock.method(require("../src/_secondary/express/publicGatewayLocal"), "publishGatewayNotice", () => true);
  const { createIndustryStorageOperations } = require("../src/_secondary/express/smartIndustryStorageApi");
  const api = createIndustryStorageOperations({
    resolve: () => ({ success: true, data: { characterID: OWNER_ID, walletAddress: "0x1",
      session: f.session, facilityID: f.facility.itemID } }),
    failed: errorMsg => ({ success: false, errorMsg }),
  });
  const listed = await api.storage("token", f.facility.itemID);
  assert.equal(listed.success, true);
  const listedIDs = listed.data.storageUnits.map(unit => unit.storageUnitID);
  assert.equal(listedIDs.includes(f.ship.itemID), true, "active ship cargo is exposed as a transfer endpoint");
  assert.equal(listedIDs.includes(storage.itemID), true, "accessible Smart Storage is exposed as a transfer endpoint");
  const listedStorage = listed.data.storageUnits.find(unit => unit.storageUnitID === storage.itemID);
  assert.ok(listedStorage);
  const listedItems = listedStorage.items;
  assert.deepEqual(listedItems.map(item => item.itemID).sort(), [own.itemID, second.itemID].sort());
  assert.equal(listedItems.some(item => item.itemID === other.itemID), false);
  assert.equal(listed.data.storageUnits.some(unit => [offline.itemID, remote.itemID].includes(unit.storageUnitID)), false);
  const request = { requestID: "11111111-1111-4111-8111-111111111111", storageUnitID: storage.itemID,
    direction: "deposit", side: "inputs", typeID: MATERIAL_A, quantity: 7 };
  const [first, duplicate] = await Promise.all([
    api.transfer("token", f.facility.itemID, request), api.transfer("token", f.facility.itemID, request),
  ]);
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(first.data.gameCommitted, true);
  assert.deepEqual(first.data.chain, { status: "disabled", industryStatus: "disabled", storageStatus: "disabled" });
  assert.deepEqual(duplicate, first);
  assert.equal(mutations.mock.callCount(), 1);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 5);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A, OTHER_OWNER_ID), 50);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 7);
  assert.equal((await api.transfer("token", f.facility.itemID, { ...request, quantity: 8 })).errorMsg,
    "TRANSFER_REQUEST_CHANGED");
  assert.equal(mutations.mock.callCount(), 1);

  const { registerSuiAssemblyStatesRunner } = require("../src/services/frontier/suiAssemblyState");
  t.after(registerSuiAssemblyStatesRunner(async (_ids, operation) => operation()));
  const sync = t.mock.method(require("../src/services/frontier/suiIndustryStorageSync"),
    "syncIndustryStorageTransfer", async () => ({ status: "pending", industryStatus: "synced", storageStatus: "pending" }));
  const withdraw = { ...request, requestID: "22222222-2222-4222-8222-222222222222", direction: "withdraw", quantity: 3 };
  const withdrawn = await api.transfer("token", f.facility.itemID, withdraw);
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(withdrawn.data.gameCommitted, true);
  assert.deepEqual(withdrawn.data.chain, { status: "pending", industryStatus: "synced", storageStatus: "pending" });
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 8);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 4);
  assert.deepEqual(await api.transfer("token", f.facility.itemID, withdraw), withdrawn);
  assert.equal(mutations.mock.callCount(), 2);
  assert.equal(sync.mock.callCount(), 1);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
});

test("native type-based SSU deposit selects owned split stacks and rejects partial multi-type batches", t => {
  const f = fixture(t);
  const storage = f.storage(OTHER_OWNER_ID);
  grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 4);
  const second = grant(OWNER_ID, storage.itemID, 4, MATERIAL_A, 8);
  assert.equal(itemStore.moveItemToLocation(second.itemID, storage.itemID, 66, 8).success, true);
  grant(OWNER_ID, storage.itemID, 66, MATERIAL_B, 5);
  grant(OTHER_OWNER_ID, storage.itemID, 66, MATERIAL_A, 20);
  const before = snapshot([storage.itemID, f.facility.itemID]);
  for (const request of [
    { [MATERIAL_A]: 7, [MATERIAL_B]: 6 }, { [MATERIAL_A]: 13 }, { [MATERIAL_A]: null },
    { [MATERIAL_A]: 0 }, { [MATERIAL_A]: 0x100000000 },
    { type: "dict", entries: [[MATERIAL_A, 1], [MATERIAL_A, 2]] },
  ]) {
    assert.equal(industry.depositStorageInputItems(f.session, f.facility.itemID, storage.itemID, request).success, false);
    assert.deepEqual(snapshot([storage.itemID, f.facility.itemID]), before);
  }
  t.mock.method(require("../src/_secondary/express/publicGatewayLocal"), "publishGatewayNotice", () => true);
  const result = new IndustryService().Handle_deposit_storage_input_items([f.facility.itemID, storage.itemID,
    { type: "dict", entries: [[MATERIAL_A, 7], [MATERIAL_B, 3]] }], f.session);
  assert.deepEqual(result, [
    { type: "dict", entries: [[MATERIAL_A, 7], [MATERIAL_B, 3]] }, { type: "dict", entries: [] },
  ]);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 5);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_B), 2);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A, OTHER_OWNER_ID), 20);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 7);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_B), 3);
});

test("one deposit aggregates requested quantities across separate stacks of the same type", t => {
  const f = fixture(t);
  const first = f.cargo(MATERIAL_A, 10);
  const second = grant(OWNER_ID, f.ship.itemID, 4, MATERIAL_A, 20);
  assert.equal(itemStore.moveItemToLocation(second.itemID, f.ship.itemID, CARGO_FLAG, 20).success, true);
  const result = f.deposit({ [first.itemID]: 3, [second.itemID]: 8 });
  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(result.data.items, { [MATERIAL_A]: 11 });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 19);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 11);
});

test("withdraw by type consumes multiple input stacks and returns exact partial and full quantities", t => {
  const f = fixture(t);
  f.stored(MATERIAL_A, 5);
  const second = grant(OWNER_ID, f.facility.itemID, 4, MATERIAL_A, 8);
  assert.equal(itemStore.moveItemToLocation(second.itemID, f.facility.itemID, INDUSTRY_INPUT_FLAG, 8).success, true);
  f.cargo(MATERIAL_A, 2);
  assert.equal(itemStore.listContainerItems(OWNER_ID, f.facility.itemID, INDUSTRY_INPUT_FLAG).length, 2);

  const partial = f.withdraw({ [MATERIAL_A]: 9 });
  assert.equal(partial.success, true, partial.errorMsg);
  assert.deepEqual(partial.data.items, { [MATERIAL_A]: 9 });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 11);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 4);

  const rest = f.withdraw({ [MATERIAL_A]: 4 });
  assert.equal(rest.success, true, rest.errorMsg);
  assert.deepEqual(rest.data.items, { [MATERIAL_A]: 4 });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 15);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 0);
});

test("input and output inventories remain separate even when they contain the same type", t => {
  const f = fixture(t);
  f.stored(MATERIAL_A, 7);
  f.stored(MATERIAL_A, 11, "outputs");
  f.stored(MATERIAL_A, 30, "inputs", OTHER_OWNER_ID);
  grant(OWNER_ID, f.facility.itemID, 66, MATERIAL_A, 100);
  assert.deepEqual(industry.getFacilityItems(f.facility), {
    inputs: { [MATERIAL_A]: 7 }, outputs: { [MATERIAL_A]: 11 },
  });
  assert.equal(f.withdraw({ [MATERIAL_A]: 8 }).success, false,
    "outputs and another owner's stacks cannot cover an input shortage");
  const output = f.withdraw({ [MATERIAL_A]: 6 }, "outputs");
  assert.equal(output.success, true, output.errorMsg);
  assert.deepEqual(output.data.items, { [MATERIAL_A]: 6 });
  assert.deepEqual(industry.getFacilityItems(f.facility), {
    inputs: { [MATERIAL_A]: 7 }, outputs: { [MATERIAL_A]: 5 },
  });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 6);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A, OTHER_OWNER_ID), 30);
  assert.equal(totalAt(f.facility.itemID, 66, MATERIAL_A), 100);
});

test("invalid quantities and overdraw leave every source and destination unchanged", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 12);
  f.stored(MATERIAL_A, 5);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(f.deposit({ [stack.itemID]: quantity }).success, false, `deposit quantity ${quantity}`);
    assert.equal(f.withdraw({ [MATERIAL_A]: quantity }).success, false, `withdraw quantity ${quantity}`);
    assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  }
  assert.equal(f.deposit({ [stack.itemID]: 13 }).success, false);
  assert.equal(f.withdraw({ [MATERIAL_A]: 6 }).success, false);
  assert.equal(f.withdraw({ [MATERIAL_A]: null }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
});

test("a failed entry rejects the entire deposit or withdrawal batch", t => {
  const f = fixture(t);
  const first = f.cargo(MATERIAL_A, 12);
  const second = f.cargo(MATERIAL_B, 4);
  f.stored(MATERIAL_A, 5);
  f.stored(MATERIAL_B, 2);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  assert.equal(f.deposit({ [first.itemID]: 3, [second.itemID]: 5 }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  assert.equal(f.withdraw({ [MATERIAL_A]: 3, [MATERIAL_B]: 3 }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
});

test("a staged inventory failure rolls back an otherwise valid multi-stack deposit", t => {
  const f = fixture(t);
  const first = f.cargo(MATERIAL_A, 12);
  const second = f.cargo(MATERIAL_B, 4);
  const originalMove = itemStore.moveItemsToLocations;
  t.mock.method(itemStore, "moveItemsToLocations", requests => originalMove([
    ...requests, {
      itemID: 999999999999, quantity: 1,
      destinationLocationID: f.facility.itemID, destinationFlagID: INDUSTRY_INPUT_FLAG,
    },
  ]));
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  const result = f.deposit({ [first.itemID]: 3, [second.itemID]: 2 });
  assert.equal(result.success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
});

test("deposit requires selected blueprint inputs and respects remaining material capacity", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 12);
  f.stored(MATERIAL_A, 995);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  assert.equal(f.deposit({ [stack.itemID]: 6 }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  f.selectedBlueprint.mock.mockImplementation(() => ({ ...BLUEPRINT, inputs: {} }));
  assert.equal(f.deposit({ [stack.itemID]: 1 }).success, false);
  f.selectedBlueprint.mock.mockImplementation(() => null);
  assert.equal(f.deposit({ [stack.itemID]: 1 }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  assert.equal(f.withdraw({ [MATERIAL_A]: 5 }).success, true,
    "existing inventory remains recoverable without a selected blueprint");
});

test("deposit rejects another owner's items, noncargo sources, and unrelated containers", t => {
  const f = fixture(t);
  const otherOwner = grant(OTHER_OWNER_ID, f.ship.itemID, CARGO_FLAG, MATERIAL_A, 6);
  const fitting = grant(OWNER_ID, f.ship.itemID, 11, MATERIAL_A, 6);
  const otherContainer = grant(OWNER_ID, f.facility.itemID, CARGO_FLAG, MATERIAL_A, 6);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  for (const item of [otherOwner, fitting, otherContainer]) {
    assert.equal(f.deposit({ [item.itemID]: 1 }).success, false);
  }
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
});

test("withdraw rejects another container and fitted module flags without consuming industry items", t => {
  const f = fixture(t);
  f.stored(MATERIAL_A, 6);
  const otherShip = grant(OWNER_ID, SYSTEM_ID, 0, SHIP_TYPE_ID, 1, {
    individualItems: true, singleton: 1,
  });
  const before = snapshot([f.ship.itemID, f.facility.itemID, otherShip.itemID]);
  assert.equal(f.withdraw({ [MATERIAL_A]: 1 }, "inputs", otherShip.itemID).success, false);
  assert.equal(f.withdraw({ [MATERIAL_A]: 1 }, "inputs", f.ship.itemID, 11).success, false);
  assert.equal(f.withdraw({ [MATERIAL_A]: 1 }, "unrecognized").success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID, otherShip.itemID]), before);
});

test("transfers require facility ownership, the same system, visibility, and range", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 12);
  f.stored(MATERIAL_A, 6);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  const rejected = () => {
    assert.equal(f.deposit({ [stack.itemID]: 1 }).success, false);
    assert.equal(f.withdraw({ [MATERIAL_A]: 1 }).success, false);
    assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  };
  f.session.characterID = OTHER_OWNER_ID;
  rejected();
  f.session.characterID = OWNER_ID;
  f.session.solarsystemid2 = SYSTEM_ID + 1;
  rejected();
  f.session.solarsystemid2 = SYSTEM_ID;
  f.access.distance = 5001;
  rejected();
  f.access.distance = Number.NaN;
  rejected();
  f.access.distance = 100;
  f.access.visible = false;
  rejected();
  f.access.visible = true;
  const entity = f.entities.get(f.facility.itemID);
  f.entities.delete(f.facility.itemID);
  rejected();
  f.entities.set(f.facility.itemID, entity);
  assert.equal(f.deposit({ [stack.itemID]: 1 }).success, true);
});

test("activation and construction reject transfers without changing stored quantities", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 12);
  f.stored(MATERIAL_A, 6);
  for (const state of [
    { assemblyStatus: ASSEMBLY_STATUS_UNDER_CONSTRUCTION },
    { assemblyStatus: 2, activationCompleteAtMs: Date.now() + 60000 },
  ]) {
    assert.equal(itemStore.updateInventoryItem(f.facility.itemID, current => ({
      ...current,
      customInfo: JSON.stringify({ evejsFrontierConstruction: {
        assemblyTypeID: FACILITY_TYPE_ID, ownerID: OWNER_ID,
        solarSystemID: SYSTEM_ID, ...state,
      } }),
    })).success, true);
    const before = snapshot([f.ship.itemID, f.facility.itemID]);
    assert.equal(f.deposit({ [stack.itemID]: 1 }).success, false);
    assert.equal(f.withdraw({ [MATERIAL_A]: 1 }).success, false);
    assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  }
});

test("deposit-all accepts a Python None quantity and duplicate decoded dictionary keys reject atomically", t => {
  const f = fixture(t);
  const stack = f.cargo(MATERIAL_A, 12);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  assert.equal(f.deposit({ type: "dict", entries: [
    [stack.itemID, 3], [stack.itemID, 4],
  ] }).success, false);
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
  const result = f.deposit({ type: "dict", entries: [[stack.itemID, null]] });
  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(result.data.items, { [MATERIAL_A]: 12 });
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 12);
});

test("industry RPCs return transferred quantities, persistent details, and per-row cargo updates", t => {
  const f = fixture(t);
  const publicGateway = require("../src/_secondary/express/publicGatewayLocal");
  const notice = t.mock.method(publicGateway, "publishGatewayNotice", () => true);
  const service = new IndustryService();
  const first = f.cargo(MATERIAL_A, 12);
  const second = f.cargo(MATERIAL_B, 7);
  const deposited = service.Handle_deposit_input_items([
    f.facility.itemID,
    { type: "dict", entries: [[first.itemID, 3], [second.itemID, 2]] },
  ], f.session);
  assert.deepEqual(deposited, [
    { type: "dict", entries: [[MATERIAL_A, 3], [MATERIAL_B, 2]] },
    { type: "dict", entries: [] },
  ]);
  const rows = f.notifications.filter(([name]) => name === "OnItemsChanged")
    .map(([, idType, payload]) => {
      assert.equal(idType, "charid");
      assert.equal(payload[0].items.length, 1,
        "each row needs its own previous quantity and container dictionary");
      return { ...payload[0].items[0].fields, previous: new Map(payload[1].entries) };
    });
  assert.equal(rows.length, 4, "two source remainders and two split destination rows");
  const firstRemainder = rows.find(row => row.itemID === first.itemID);
  const secondRemainder = rows.find(row => row.itemID === second.itemID);
  assert.equal(firstRemainder.stacksize, 9);
  assert.equal(firstRemainder.previous.get(9), 12);
  assert.equal(secondRemainder.stacksize, 5);
  assert.equal(secondRemainder.previous.get(9), 7);
  const details = Object.fromEntries(
    new IndustryService().Handle_get_facility_details([f.facility.itemID], f.session).entries,
  );
  const items = Object.fromEntries((details.items as any).entries);
  assert.deepEqual(items.inputs, { type: "dict", entries: [[MATERIAL_A, 3], [MATERIAL_B, 2]] });
  assert.equal(notice.mock.calls[0].arguments[0], "eve_public.industry.api.InputItemsChangeNotice");

  const withdrawn = service.Handle_withdraw_input_items([
    f.facility.itemID, { [MATERIAL_A]: 2 }, f.ship.itemID, CARGO_FLAG,
  ], f.session);
  assert.deepEqual(withdrawn, [
    { type: "dict", entries: [[MATERIAL_A, 2]] }, { type: "dict", entries: [] },
  ]);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 11);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 1);

  f.stored(MATERIAL_A, 4, "outputs");
  const output = service.Handle_withdraw_output_items([
    f.facility.itemID, { [MATERIAL_A]: 4 }, f.ship.itemID, CARGO_FLAG,
  ], f.session);
  assert.deepEqual(output, [
    { type: "dict", entries: [[MATERIAL_A, 4]] }, { type: "dict", entries: [] },
  ]);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 15);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_OUTPUT_FLAG, MATERIAL_A), 0);
  assert.equal(notice.mock.calls.at(-1).arguments[0], "eve_public.industry.api.OutputItemsChangeNotice");
});

test("blueprint RPC load persists the authored recipe and rejects reloads without losing inventory or metadata", t => {
  const f = fixture(t);
  f.selectedBlueprint.mock.restore();
  const publicGateway = require("../src/_secondary/express/publicGatewayLocal");
  const notice = t.mock.method(publicGateway, "publishGatewayNotice", () => true);
  const service = new IndustryService();
  const construction = {
    assemblyStatus: 2, assemblyTypeID: FACILITY_TYPE_ID,
    ownerID: OWNER_ID, solarSystemID: SYSTEM_ID,
  };
  assert.equal(itemStore.updateInventoryItem(f.facility.itemID, current => ({
    ...current, customInfo: JSON.stringify({
      evejsFrontierConstruction: construction, unrelated: "retained",
    }),
  })).success, true);
  const loaded = Object.fromEntries(
    service.Handle_load_blueprint([f.facility.itemID, 1026], f.session).entries,
  );
  assert.equal(loaded.blueprint_id, 1026);
  assert.equal(loaded.run_time, 3);
  const persisted = itemStore.findItemById(f.facility.itemID);
  assert.equal(blueprints.getSelectedBlueprint(persisted).blueprint_id, 1026);
  assert.deepEqual(JSON.parse(persisted.customInfo).evejsFrontierConstruction, construction);
  assert.equal(JSON.parse(persisted.customInfo).unrelated, "retained");
  assert.deepEqual(notice.mock.calls.map(call => call.arguments[0]), [
    "eve_public.industry.api.InputItemsChangeNotice", "eve_public.industry.api.OutputItemsChangeNotice",
  ], "a successful load refreshes the empty inventories in every owner view");
  assert.deepEqual(f.notifications.filter(([name]) => name === "OnFrontierIndustryBlueprintChanged"), [
    ["OnFrontierIndustryBlueprintChanged", "clientID", [f.facility.itemID]],
  ], "native loads also invalidate recipes cached by other owner views");

  const stack = f.cargo(77803, 45);
  service.Handle_deposit_input_items([f.facility.itemID, { [stack.itemID]: 15 }], f.session);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  const metadataBefore = itemStore.findItemById(f.facility.itemID).customInfo;
  const noticeCount = notice.mock.callCount();
  const inventoryNoticeCount = f.notifications.length;
  for (const [blueprintID, reason] of [
    [1026, "IndustryLoadError_AlreadyLoaded"],
    [1027, "IndustryLoadError_ItemsPresent"],
    [1000, "IndustryStartError_InvalidBlueprint"],
  ]) {
    assert.throws(() => service.Handle_load_blueprint([f.facility.itemID, blueprintID], f.session), error => {
      assert.equal(error.machoErrorResponse.payload.header[0].value,
        "frontier.industry.common.errors.IndustryError");
      assert.equal(error.machoErrorResponse.payload.header[1][0], reason);
      return true;
    });
    assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
    assert.equal(itemStore.findItemById(f.facility.itemID).customInfo, metadataBefore);
  }
  assert.equal(notice.mock.callCount(), noticeCount, "failed loads do not reset client item caches");
  assert.equal(f.notifications.length, inventoryNoticeCount);
});

test("industry moves exact quantities between the facility and a supported mining hold", t => {
  const f = fixture(t);
  const mining = require("../src/services/mining/miningInventory");
  const miningFlag = mining.MINING_HOLD_FLAGS.GENERAL_MINING_HOLD;
  const oreTypeID = 72275; // Fuconite-90, an unprocessed mining material.
  f.selectedBlueprint.mock.mockImplementation(() => ({ ...BLUEPRINT, inputs: {
    [oreTypeID]: { type_id: oreTypeID, quantity_per_run: 1, max_storable_quantity: 1000 },
  } }));
  t.mock.method(mining, "getShipHoldCapacityByFlag", () => 100);
  const stack = grant(OWNER_ID, f.ship.itemID, miningFlag, oreTypeID, 20);
  const deposited = f.deposit({ [stack.itemID]: 8 });
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(totalAt(f.ship.itemID, miningFlag, oreTypeID), 12);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, oreTypeID), 0);
  const withdrawn = f.withdraw({ [oreTypeID]: 5 }, "inputs", f.ship.itemID, miningFlag);
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(totalAt(f.ship.itemID, miningFlag, oreTypeID), 17);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, oreTypeID), 3);
});

test("industry roundtrip supports owned nearby containers using their flag-zero inventory", t => {
  const f = fixture(t);
  const container = grant(OWNER_ID, SYSTEM_ID, 0, 23, 1, {
    individualItems: true, singleton: 1,
  });
  f.entities.set(container.itemID, {
    itemID: container.itemID, position: { x: 150, y: 0, z: 0 },
  });
  const stack = grant(OWNER_ID, container.itemID, 0, MATERIAL_A, 20);
  const deposited = f.deposit({ [stack.itemID]: 8 });
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(totalAt(container.itemID, 0, MATERIAL_A), 12);
  const withdrawn = f.withdraw({ [MATERIAL_A]: 5 }, "inputs", container.itemID, 0);
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(totalAt(container.itemID, 0, MATERIAL_A), 17);
  assert.equal(totalAt(f.facility.itemID, INDUSTRY_INPUT_FLAG, MATERIAL_A), 3);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
});

test("withdrawal rejects cargo overflow without consuming any stored material", t => {
  const f = fixture(t);
  f.stored(MATERIAL_A, 4000);
  f.cargo(MATERIAL_A, 5);
  const before = snapshot([f.ship.itemID, f.facility.itemID]);
  const result = f.withdraw({ [MATERIAL_A]: 4000 });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "SHIP_CARGO_CAPACITY_EXCEEDED");
  assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID]), before);
});

test("other owners' items occupy destination capacity without becoming withdrawable inventory", t => {
  const f = fixture(t);
  const container = grant(OWNER_ID, SYSTEM_ID, 0, 23, 1, {
    individualItems: true, singleton: 1,
  });
  f.entities.set(container.itemID, {
    itemID: container.itemID, position: { x: 150, y: 0, z: 0 },
  });
  f.stored(MATERIAL_A, 1);
  const cargoCapacity = require("../src/services/frontier/smartStorageUnitRuntime")
    .getShipCargoCapacity(OWNER_ID, f.ship);
  for (const [inventoryID, flagID, capacity] of [
    [f.ship.itemID, CARGO_FLAG, cargoCapacity],
    [container.itemID, 0, container.capacity],
  ]) {
    assert.ok(capacity > 0);
    grant(OTHER_OWNER_ID, inventoryID, flagID, MATERIAL_A, Math.ceil(capacity / 0.1));
    const before = snapshot([f.ship.itemID, f.facility.itemID, container.itemID]);
    const result = f.withdraw({ [MATERIAL_A]: 1 }, "inputs", inventoryID, flagID);
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "SHIP_CARGO_CAPACITY_EXCEEDED");
    assert.deepEqual(snapshot([f.ship.itemID, f.facility.itemID, container.itemID]), before);
  }
});

test("empty active blueprint atomically moves both escrow inventories and publishes both client snapshots", t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 7);
  f.stored(MATERIAL_A, 3);
  f.stored(MATERIAL_A, 4, "outputs");
  f.stored(MATERIAL_B, 2, "outputs");
  // Stored rows outside the current recipe are still material that must move.
  f.stored(77803, 6, "outputs");
  grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 5);
  const notice = t.mock.method(require("../src/_secondary/express/publicGatewayLocal"),
    "publishGatewayNotice", () => true);
  const move = t.mock.method(itemStore, "moveItemsToLocations");
  const result = industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(move.mock.callCount(), 1, "all input and output rows share a single atomic move");
  assert.equal(result.data.side, "all");
  assert.deepEqual(result.data.itemsBySide, {
    inputs: { [MATERIAL_A]: 10 }, outputs: { [MATERIAL_A]: 4, [MATERIAL_B]: 2, 77803: 6 },
  });
  assert.deepEqual(result.data.items, { [MATERIAL_A]: 14, [MATERIAL_B]: 2, 77803: 6 });
  assert.equal(result.data.storageTransfers.length, 1);
  assert.deepEqual(result.data.storageTransfers[0].items, result.data.items);
  assert.deepEqual(industry.getFacilityItems(f.facility), { inputs: {}, outputs: {} });
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 19);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_B), 2);
  assert.equal(totalAt(storage.itemID, 66, 77803), 6);
  assert.equal(totalAt(f.ship.itemID, CARGO_FLAG, MATERIAL_A), 0);
  IndustryService.publishIndustryTransferResult(f.session, result);
  const { getIndustryNoticeTypes } = require("../src/services/frontier/industryNotifications")._testing;
  for (const [side, name] of [["inputs", "InputItemsChangeNotice"], ["outputs", "OutputItemsChangeNotice"]]) {
    const call = notice.mock.calls.find(call => call.arguments[0].endsWith(`.${name}`));
    assert.ok(call, `${side} snapshot published`);
    const payload = getIndustryNoticeTypes()[side].decode(call.arguments[1]);
    assert.equal(payload.items.length, 0);
  }
  assert.equal(notice.mock.calls.filter(call => call.arguments[0].endsWith(".InventoryItemDepositedNotice")).length, 4);
  const after = snapshot([f.facility.itemID, storage.itemID]);
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).errorMsg,
    "FACILITY_ALREADY_EMPTY");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), after);
});

test("empty active blueprint validates combined input/output capacity and per-type limits before any move", t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_A, 4, "outputs");
  const inventoryAccess = require("../src/services/frontier/industryInventoryAccess");
  const resolve = inventoryAccess.resolveIndustryInventory;
  const resolveTransfer = inventoryAccess.resolveTransferInventory;
  let capacity = 6;
  t.mock.method(inventoryAccess, "resolveIndustryInventory", (...args) => {
    const result = resolve(...args);
    return result.success ? { ...result, data: { ...result.data, capacity } } : result;
  });
  t.mock.method(inventoryAccess, "resolveTransferInventory", (...args) => {
    const result = resolveTransfer(...args);
    return result.success ? { ...result, data: { ...result.data, capacity } } : result;
  });
  t.mock.method(itemStore, "getInventoryItemUnitVolume", () => 1);
  const before = snapshot([f.facility.itemID, storage.itemID]);
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).errorMsg,
    "STORAGE_CAPACITY_EXCEEDED");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
  capacity = Number.MAX_SAFE_INTEGER;
  grant(OWNER_ID, storage.itemID, 66, MATERIAL_A, 0xffffffff - 6);
  const atLimit = snapshot([f.facility.itemID, storage.itemID]);
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).errorMsg,
    "STORAGE_TYPE_QUANTITY_EXCEEDED");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), atLimit);
});

test("empty active blueprint rolls back both inventories if an atomic store move fails", t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_B, 5, "outputs");
  const before = snapshot([f.facility.itemID, storage.itemID]);
  const move = itemStore.moveItemsToLocations;
  t.mock.method(itemStore, "moveItemsToLocations", requests => move([...requests, {
    itemID: 999999999999, quantity: 1, destinationLocationID: storage.itemID, destinationFlagID: 66,
  }]));
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).success, false);
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
});

test("empty and switch reject running, discontinuing and corrupt production without changing materials or blueprint", t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_B, 5, "outputs");
  for (const state of ["RUNNING", "DISCONTINUING", "CORRUPT"]) {
    const production = { version: 1, jobID: 1, state, requestedRuns: null,
      completedRuns: 0, runStartedAtMs: 1, runEndAtMs: 100000, stopReason: null };
    assert.equal(itemStore.updateInventoryItem(f.facility.itemID, current => ({ ...current,
      customInfo: JSON.stringify({ [blueprints.INDUSTRY_INFO_KEY]: { production } }),
    })).success, true);
    const before = snapshot([SYSTEM_ID, f.facility.itemID, storage.itemID]);
    const expected = state === "CORRUPT" ? "INVALID_PRODUCTION_STATE" : "PRODUCTION_ALREADY_RUNNING";
    assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).errorMsg, expected);
    assert.equal(industry.loadBlueprint(f.session, f.facility.itemID, 1027).errorMsg, expected);
    assert.deepEqual(snapshot([SYSTEM_ID, f.facility.itemID, storage.itemID]), before);
  }
});

test("empty revalidates authorization, production and destination after awaiting refreshed assembly states", async t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_B, 5, "outputs");
  const { registerSuiAssemblyStatesRunner } = require("../src/services/frontier/suiAssemblyState");
  let beforeCommit = () => {};
  t.after(registerSuiAssemblyStatesRunner(async (ids, operation) => {
    assert.deepEqual(new Set(ids), new Set([f.facility.itemID, storage.itemID]));
    await Promise.resolve();
    beforeCommit();
    return operation();
  }));
  const before = snapshot([f.facility.itemID, storage.itemID]);
  let allowed = true;
  beforeCommit = () => { allowed = false; };
  const revoked = await industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID, {
    assertAccess: () => allowed ? { success: true } : { success: false, errorMsg: "BLUEPRINT_CHANGED" },
  });
  assert.equal(revoked.errorMsg, "BLUEPRINT_CHANGED");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
  beforeCommit = () => { f.entities.delete(storage.itemID); };
  assert.equal((await industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID)).success, false);
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
  f.entities.set(storage.itemID, { itemID: storage.itemID, position: { x: 150, y: 0, z: 0 } });
  beforeCommit = () => {
    assert.equal(itemStore.updateInventoryItem(f.facility.itemID, current => ({ ...current,
      customInfo: JSON.stringify({ [blueprints.INDUSTRY_INFO_KEY]: { production: {
        version: 1, jobID: 1, state: "RUNNING", requestedRuns: null,
        completedRuns: 0, runStartedAtMs: 1, runEndAtMs: 100000, stopReason: null,
      } } }),
    })).success, true);
  };
  assert.equal((await industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID)).errorMsg,
    "PRODUCTION_ALREADY_RUNNING");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
});

test("empty preserves committed items when paired chain synchronization is unavailable", async t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_B, 5, "outputs");
  const { registerSuiAssemblyStatesRunner } = require("../src/services/frontier/suiAssemblyState");
  t.after(registerSuiAssemblyStatesRunner(async (_ids, operation) => { await Promise.resolve(); return operation(); }));
  const sync = t.mock.method(require("../src/services/frontier/suiIndustryStorageSync"),
    "syncIndustryStorageTransfer", async () => {
      assert.deepEqual(industry.getFacilityItems(f.facility), { inputs: {}, outputs: {} });
      throw new Error("chain unavailable after commit");
    });
  const result = await industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "pending");
  assert.equal(sync.mock.callCount(), 1);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_A), 4);
  assert.equal(totalAt(storage.itemID, 66, MATERIAL_B), 5);
});

test("empty never skips foreign material and switching remains blocked by every stored row", t => {
  const f = fixture(t);
  const storage = f.storage();
  f.stored(MATERIAL_A, 4);
  f.stored(MATERIAL_B, 5, "outputs", OTHER_OWNER_ID);
  const before = snapshot([f.facility.itemID, storage.itemID]);
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).errorMsg, "ACCESS_DENIED");
  assert.equal(industry.loadBlueprint(f.session, f.facility.itemID, 1027).errorMsg, "FACILITY_CONTAINS_ITEMS");
  assert.deepEqual(snapshot([f.facility.itemID, storage.itemID]), before);
  assert.equal(f.withdraw({ [MATERIAL_A]: 4 }).success, true);
  assert.deepEqual(industry.getFacilityItems(f.facility), { inputs: {}, outputs: {} });
  assert.equal(industry.loadBlueprint(f.session, f.facility.itemID, 1027).errorMsg, "FACILITY_CONTAINS_ITEMS");
});

test("an emptied blueprint can be switched while preserving destination materials and unrelated metadata", t => {
  const f = fixture(t);
  f.selectedBlueprint.mock.restore();
  const storage = f.storage();
  assert.equal(itemStore.updateInventoryItem(f.facility.itemID, current => ({ ...current,
    customInfo: JSON.stringify({ unrelated: "retained" }),
  })).success, true);
  assert.equal(industry.loadBlueprint(f.session, f.facility.itemID, 1026).success, true);
  f.stored(77803, 4);
  f.stored(MATERIAL_A, 5, "outputs");
  assert.equal(industry.loadBlueprint(f.session, f.facility.itemID, 1027).errorMsg, "FACILITY_CONTAINS_ITEMS");
  assert.equal(industry.emptyActiveBlueprint(f.session, f.facility.itemID, storage.itemID).success, true);
  assert.equal(blueprints.getSelectedBlueprint(itemStore.findItemById(f.facility.itemID)).blueprint_id, 1026);
  const storageBefore = snapshot([storage.itemID]);
  const switched = industry.loadBlueprint(f.session, f.facility.itemID, 1027);
  assert.equal(switched.success, true, switched.errorMsg);
  assert.equal(blueprints.getSelectedBlueprint(itemStore.findItemById(f.facility.itemID)).blueprint_id, 1027);
  assert.equal(JSON.parse(itemStore.findItemById(f.facility.itemID).customInfo).unrelated, "retained");
  assert.deepEqual(snapshot([storage.itemID]), storageBefore);
});
