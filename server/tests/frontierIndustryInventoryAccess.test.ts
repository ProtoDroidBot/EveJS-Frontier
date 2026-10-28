const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function assemblyInventoryFixture(fileName, typeID, component, capacity) {
  const ownerID = 140000001;
  const item = { itemID: 501, typeID, ownerID, state: {
    assemblyStatus: 2, assemblyTypeID: typeID, solarSystemID: 30000001,
  } };
  const resolved = require.resolve(`../src/services/frontier/${fileName}`);
  const sandbox = {
    __dirname: path.dirname(resolved),
    module: { exports: {} },
    exports: {},
    require(name) {
      if (name === "path") return path;
      if (name.endsWith("services\\inventory\\itemStore") || name.endsWith("services/inventory/itemStore")) {
        return { findItemById: id => Number(id) === item.itemID ? item : null,
          getItemMetadata: id => Number(id) === typeID ? { capacity } : null };
      }
      if (name.endsWith("services\\_shared\\referenceData") || name.endsWith("services/_shared/referenceData")) {
        return { TABLE: { SPACE_COMPONENTS_BY_TYPE: "spaceComponentsByType" },
          readStaticRows: () => [{ _key: typeID, ...component }] };
      }
      if (name.endsWith("frontier\\deploymentRuntime") || name.endsWith("frontier/deploymentRuntime")) {
        return { ASSEMBLY_STATUS_OFFLINE: 1, ASSEMBLY_STATUS_ONLINE: 2,
          ASSEMBLY_STATUS_UNDER_CONSTRUCTION: 0, isAssemblyActivationPending: () => false,
          readConstructionState: candidate => candidate?.state || null };
      }
      assert.fail(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(resolved, "utf8"), sandbox);
  return { api: sandbox.module.exports as any, item, ownerID,
    access: { authorized: true, activeShipID: 100, solarSystemID: 30000001, inRange: true } };
}

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
    "./smartStorageUnitRuntime": {
      SMART_STORAGE_FLAG: 66, getShipCargoCapacity: () => 1234,
      getStorageComponent: typeID => typeID === 77917 ? {} : null,
      validateStorageUnit: (_owner, id, options) => id !== 106 ? { errorMsg: "ASSEMBLY_NOT_FOUND" }
        : !options.access.inRange ? { errorMsg: "ASSEMBLY_OUT_OF_RANGE" } : { capacity: 10000 },
    },
    "./smartTurretInventoryRuntime": {
      SMART_TURRET_INVENTORY_FLAG: 0,
      getTurretComponent: typeID => typeID === 92279 ? { smartTurret: true } : null,
      validateTurretInventory: (_owner, id, options) => id !== 107 ? { errorMsg: "ASSEMBLY_NOT_FOUND" }
        : !options.access.inRange ? { errorMsg: "ASSEMBLY_OUT_OF_RANGE" }
          : { capacity: 600 },
    },
    "./fieldStorageInventoryRuntime": {
      FIELD_STORAGE_INVENTORY_FLAG: 0,
      getFieldStorageComponent: typeID => typeID === 87566 ? { accessRange: 5000 } : null,
      validateFieldStorageInventory: (_owner, id, options) => id !== 108 ? { errorMsg: "INVALID_INVENTORY" }
        : !options.access.inRange ? { errorMsg: "ASSEMBLY_OUT_OF_RANGE" }
          : { capacity: 30000 },
    },
    "./networkNodeFuelRuntime": {
      NETWORK_NODE_TYPE_ID: 88092,
      NETWORK_NODE_FUEL_BAY_FLAG: 172,
      isAcceptedNetworkNodeFuelType: typeID => [77818, 88319, 88335].includes(Number(typeID)),
      validateNetworkNodeFuelInventory: () => ({ errorMsg: "ASSEMBLY_NOT_FOUND" }),
    },
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

test("industry resolves only validated nearby SSU flag66 partitions and rejects singleton deposits", () => {
  const f = fixture();
  f.items.set(106, { ...f.container, itemID: 106, categoryID: 65, ownerID: 140000002 });
  const result = f.api.resolveIndustryInventory(f.session, 106, 66);
  assert.equal(result.success, true);
  assert.equal(result.data.capacity, 10000);
  assert.equal(result.data.inventoryOwnerID, f.session.characterID);
  assert.equal(result.data.maxTypeQuantity, 0xffffffff);
  assert.equal(f.api.isIndustryInventoryItemAllowed(result.data, { singleton: 0 }), true);
  assert.equal(f.api.isIndustryInventoryItemAllowed(result.data, { singleton: 1 }), false);
  assert.equal(f.api.resolveIndustryInventory(f.session, 102, 66).success, false);
  assert.equal(f.api.resolveIndustryInventory(f.session, 106, 0).success, false);
  f.state.distance = 5000;
  assert.equal(f.api.resolveIndustryInventory(f.session, 106, 66).success, true);
  f.state.distance = 5001;
  assert.equal(f.api.resolveIndustryInventory(f.session, 106, 66).success, false);
  f.state.distance = 100;
  f.state.visible = false;
  assert.equal(f.api.resolveIndustryInventory(f.session, 106, 66).success, false);
});

test("industry exposes an owned nearby Smart Turret flag-0 cargo endpoint", () => {
  const f = fixture();
  f.items.set(107, { ...f.container, itemID: 107, typeID: 92279, categoryID: 65 });
  const result = f.api.resolveSmartAssemblyInventory(f.session, 107);
  assert.equal(result.success, true);
  assert.equal(result.data.flagID, 0);
  assert.equal(result.data.capacity, 600);
  assert.equal(result.data.smartAssemblyKind, "turret");
  assert.equal(result.data.inventoryOwnerID, f.session.characterID);
  assert.equal(f.api.isIndustryInventoryItemAllowed(result.data, { singleton: 0 }), true);
  assert.equal(f.api.isIndustryInventoryItemAllowed(result.data, { singleton: 1 }), false);
  assert.equal(f.api.resolveIndustryInventory(f.session, 107, 66).success, false);
  f.state.distance = 5001;
  assert.equal(f.api.resolveIndustryInventory(f.session, 107, 0).success, false);
  f.state.distance = 100;
  f.state.visible = false;
  assert.equal(f.api.resolveIndustryInventory(f.session, 107, 0).success, false);
});

test("industry transfer endpoint resolver includes the active ship and Field Storage", () => {
  const f = fixture();
  f.items.set(108, { ...f.container, itemID: 108, typeID: 87566, categoryID: 22 });
  const ship = f.api.resolveTransferInventory(f.session, f.ship.itemID);
  assert.equal(ship.success, true);
  assert.equal(ship.data.flagID, 5);
  const field = f.api.resolveTransferInventory(f.session, 108);
  assert.equal(field.success, true);
  assert.equal(field.data.flagID, 0);
  assert.equal(field.data.capacity, 30000);
  assert.equal(field.data.inventoryKind, "field_storage");
});

test("turret and Field Storage validators enforce authored capacity, ownership, state, and range", () => {
  const turret = assemblyInventoryFixture("smartTurretInventoryRuntime", 92279, { smartTurret: {} }, 600);
  const validTurret = turret.api.validateTurretInventory(turret.ownerID, turret.item.itemID,
    { access: turret.access, requireOnline: true });
  assert.equal(validTurret.capacity, 600);
  assert.equal(validTurret.flagID, 0);
  assert.equal(turret.api.validateTurretInventory(turret.ownerID + 1, turret.item.itemID,
    { access: turret.access }).errorMsg, "ACCESS_DENIED");
  assert.equal(turret.api.validateTurretInventory(turret.ownerID, turret.item.itemID,
    { access: { ...turret.access, inRange: false } }).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  turret.item.state.assemblyStatus = 1;
  assert.equal(turret.api.validateTurretInventory(turret.ownerID, turret.item.itemID,
    { access: turret.access, requireOnline: true }).errorMsg, "ASSEMBLY_OFFLINE");

  const field = assemblyInventoryFixture("fieldStorageInventoryRuntime", 87566,
    { cargoBay: { accessRange: 5000, allowUserAdd: 1, allowUserTake: 1 },
      smartDeployable: { createOnChain: 0 } }, 30000);
  const validField = field.api.validateFieldStorageInventory(field.ownerID, field.item.itemID,
    { access: field.access });
  assert.equal(validField.capacity, 30000);
  assert.equal(validField.component.accessRange, 5000);
  assert.equal(validField.flagID, 0);
  assert.equal(field.api.validateFieldStorageInventory(field.ownerID, field.item.itemID,
    { access: { ...field.access, inRange: false } }).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
});
