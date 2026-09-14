"use strict";

/** Run through scripts/Tests/run-isolated-tests.js against a disposable Frontier store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");
const blueprints = require("../src/services/frontier/industryBlueprints");
const industry = require("../src/services/frontier/industryRuntime");
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
const CARGO_FLAG = 5;
const BLUEPRINT = {
  blueprint_id: 1,
  run_time: 60,
  inputs: {
    [MATERIAL_A]: { type_id: MATERIAL_A, quantity_per_run: 3, max_storable_quantity: 1000 },
    [MATERIAL_B]: { type_id: MATERIAL_B, quantity_per_run: 2, max_storable_quantity: 1000 },
  },
  outputs: {
    [MATERIAL_A]: { type_id: MATERIAL_A, quantity_per_run: 1, max_storable_quantity: 1000 },
  },
};

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
  assert.equal(notice.mock.callCount(), 0, "the successful load RPC initializes the empty client cache");

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
