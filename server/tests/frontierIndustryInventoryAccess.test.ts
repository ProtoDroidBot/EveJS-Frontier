const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

function fixture() {
  const owner = 140000001, system = 30000001;
  const ship = { itemID: 101, typeID: 95276, ownerID: owner, locationID: system, categoryID: 6 };
  const container = { itemID: 102, typeID: 23, ownerID: owner, locationID: system, categoryID: 2, groupID: 12 };
  const depot = { ...container, itemID: 103, groupID: 1246 };
  const items = new Map([[ship.itemID, ship], [container.itemID, container], [depot.itemID, depot]]);
  const state = { distance: 2000, visible: true, depotActive: true, miningCapacity: 2500 };
  const modules = {
    "../inventory/itemStore": {
      ITEM_FLAGS: { CARGO_HOLD: 5, SHIP_HANGAR: 90, FLEET_HANGAR: 155 },
      findItemById: id => items.get(id),
      getItemMetadata: () => ({ capacity: 1000 }),
    },
    "../../space/runtime": {
      getEntity: (_session, id) => items.get(id),
      getSceneForSession: () => ({ getCommandTimeEntitySurfaceDistance: () => state.distance }),
    },
    "../../space/destiny/identity/interactionScope": { canEntitiesInteractLocally: () => state.visible },
    "./smartStorageUnitRuntime": { getShipCargoCapacity: () => 1234 },
    "../../_secondary/fitting/fittingRuntime": {
      getShipFittingSnapshot: () => ({ resourceState: { miningCapacity: state.miningCapacity } }),
    },
    "../fitting/liveFittingState": { getShipBaseAttributeValue: () => 0 },
    "../mining/miningInventory": {
      MINING_SHIP_BAY_FLAGS: [134, 135, 181, 182],
      getShipHoldCapacityByFlag: resources => resources.miningCapacity,
      isItemTypeAllowedInHoldFlag: item => item.categoryID === 25,
    },
    "../inventory/fuelBayInventory": { isFuelBayFlag: flag => flag === 133, getFuelBayCapacity: () => 50, isFuelBayCompatibleItem: item => item.groupID === 423 },
    "../inventory/specialShipHoldRegistry": { isGenericSpecialShipHoldFlag: () => false },
    "../ship/cargoContainerRuntime": {
      isCargoContainerType: item => item.categoryID === 2 && item.groupID === 12,
      isUnanchoredStructureHullItem: () => false,
      MAX_CARGO_CONTAINER_TRANSFER_DISTANCE_METERS: 2500,
    },
    "../ship/mobileDepotRuntime": { GROUP_MOBILE_DEPOT: 1246, validateMobileDepotCargoAccess: () => ({ success: state.depotActive }) },
  };
  const sandbox = { module: { exports: {} }, exports: {}, require: name => {
    assert.ok(modules[name], `Unexpected dependency ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/services/frontier/industryInventoryAccess"), "utf8"), sandbox);
  return { api: sandbox.module.exports as any, items, ship, container, depot, state,
    session: { characterID: owner, _space: { shipID: ship.itemID, systemID: system } } };
}

test("industry supports derived ship cargo and mining holds with item restrictions", () => {
  const f = fixture();
  assert.equal(f.api.resolveIndustryInventory(f.session, 101, 5).data.capacity, 1234);
  const mining = f.api.resolveIndustryInventory(f.session, 101, 134);
  assert.equal(mining.data.capacity, 2500);
  assert.equal(f.api.isIndustryInventoryItemAllowed(mining.data, { categoryID: 25 }), true);
  assert.equal(f.api.isIndustryInventoryItemAllowed(mining.data, { categoryID: 6 }), false);
  f.state.miningCapacity = 0;
  assert.equal(f.api.resolveIndustryInventory(f.session, 101, 134).success, false);
  for (const flag of [0, 11, 66, 87, 156, 20000, 20001, -1, 5.5, null]) {
    assert.equal(f.api.resolveIndustryInventory(f.session, 101, flag).success, false, `flag ${flag}`);
  }
});

test("industry permits nearby owned container contents and validates deployed mobile depots", () => {
  const f = fixture();
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 0).data.capacity, 1000);
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 5).success, false);
  assert.equal(f.api.resolveIndustryInventory(f.session, 103, 0).success, true);
  f.state.depotActive = false;
  assert.equal(f.api.resolveIndustryInventory(f.session, 103, 0).success, false);
  f.state.distance = 2501;
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 0).success, false);
  f.state.distance = 100;
  f.state.visible = false;
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 0).success, false);
});

test("industry denies other owners, remote containers, nonactive ships and smart assemblies", () => {
  const f = fixture();
  f.container.ownerID++;
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 0).success, false);
  f.container.ownerID--;
  f.container.locationID++;
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 0).success, false);
  f.container.locationID--;
  f.items.set(104, { ...f.ship, itemID: 104 });
  assert.equal(f.api.resolveIndustryInventory(f.session, 104, 5).success, false);
  f.items.set(105, { ...f.container, itemID: 105, categoryID: 65 });
  assert.equal(f.api.resolveIndustryInventory(f.session, 105, 0).success, false);
  assert.equal(f.api.resolveIndustryInventory({ ...f.session, stationid: 60000001 }, 101, 5).success, false);
});
