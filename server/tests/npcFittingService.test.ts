"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const liveFittingState = require("../src/services/fitting/liveFittingState");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const npcFitting = require("../src/space/npc/npcFittingService");

const TABLES = [
  "npcRuntimeState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcPilotIdentities",
  "npcWrecks",
  "npcWreckItems",
];
const ENTITY_ID = 980000000701;
const SYSTEM_ID = 30000004;
const PLAYER_ID = 140000701;
const SOURCE_LOCATION_ID = 600000701;
const FACTION_ID = 500010;
const WEAPON_TYPE_ID = 990701;
const PROPULSION_TYPE_ID = 990702;
const OVERLOADED_TYPE_ID = 990703;
const CHARGE_TYPE_ID = 990704;

function emptyNativeTables() {
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.write("npcWrecks", "/", { nextWreckID: 980300000000, wrecks: {} }, { force: true });
  database.write("npcWreckItems", "/", { nextWreckItemID: 980400000000, items: {} }, { force: true });
  database.write("npcPilotIdentities", "/", {
    version: 1,
    nextCharacterID: 1500000000,
    pilots: {},
    slots: {},
    factions: {},
  }, { force: true });
  database.flushTablesSync(TABLES);
  persistence._testing.resetRuntimeForTests();
}

function fixture(t) {
  const backupTables = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  const backupItems = structuredClone(itemStore.getAllItems());
  emptyNativeTables();
  itemTypeRegistry._setEntriesForTests([
    { typeID: WEAPON_TYPE_ID, groupID: 53, categoryID: 7, groupName: "Energy Weapon", name: "Prototype Weapon", portionSize: 1 },
    { typeID: PROPULSION_TYPE_ID, groupID: 46, categoryID: 7, groupName: "Propulsion Module", name: "Prototype Afterburner", portionSize: 1 },
    { typeID: OVERLOADED_TYPE_ID, groupID: 53, categoryID: 7, groupName: "Energy Weapon", name: "Overloaded Weapon", portionSize: 1 },
    { typeID: CHARGE_TYPE_ID, groupID: 85, categoryID: 8, groupName: "Charge", name: "Prototype Ammunition", portionSize: 1 },
  ]);
  itemStore.resetInventoryStoreForTests();
  assert.equal(itemStore._writeItemsForTest({}, { force: true }), true);
  database.flushTableSync(itemStore.ITEMS_TABLE);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  t.after(() => {
    itemStore._writeItemsForTest(backupItems, { force: true });
    for (const [table, value] of Object.entries(backupTables)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
    persistence._testing.resetRuntimeForTests();
  });
}

function itemRow(itemID, typeID, categoryID, groupID, name, quantity = 1) {
  const singleton = quantity === 1 ? 1 : 0;
  return {
    itemID,
    typeID,
    ownerID: PLAYER_ID,
    locationID: SOURCE_LOCATION_ID,
    flagID: itemStore.ITEM_FLAGS.HANGAR,
    quantity: singleton ? -1 : quantity,
    stacksize: singleton ? 1 : quantity,
    singleton,
    groupID,
    categoryID,
    customInfo: "",
    itemName: name,
    mass: 0,
    volume: 1,
    capacity: 0,
    radius: 0,
  };
}

function writeItems(rows) {
  assert.equal(itemStore._writeItemsForTest(
    Object.fromEntries(rows.map((row) => [row.itemID, row])),
    { force: true },
  ), true);
  database.flushTableSync(itemStore.ITEMS_TABLE);
}

function createNpc(overrides: Record<string, any> = {}) {
  const entity = {
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    typeID: 990700,
    groupID: 25,
    categoryID: 11,
    ownerID: FACTION_ID,
    npcFactionID: FACTION_ID,
    npcCharacterID: 1500000701,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
    npcFittingProfileID: "test-restricted-hull",
    npcFittingRestrictions: {
      allowedRoles: ["weapon", "ammunition", "propulsion"],
      roleSlots: {
        weapon: [11, 12],
        propulsion: [19],
      },
      cpuOutput: 100,
      powerOutput: 100,
      moduleResources: {
        [WEAPON_TYPE_ID]: { cpu: 10, power: 20 },
        [PROPULSION_TYPE_ID]: { cpu: 5, power: 5 },
        [OVERLOADED_TYPE_ID]: { cpu: 101, power: 1 },
      },
      chargeCompatibility: {
        [WEAPON_TYPE_ID]: {
          allowedTypeIDs: [CHARGE_TYPE_ID],
          capacity: 5,
        },
      },
      equipmentLossPolicy: "return",
    },
    ...overrides,
  };
  assert.equal(nativeStore.upsertNativeEntity(entity, {
    durable: entity.transient !== true,
    transient: entity.transient === true,
  }).success, true);
  assert.equal(nativeStore.upsertNativeController({
    entityID: entity.entityID,
    systemID: entity.systemID,
    profileID: "test-restricted-hull",
    transient: entity.transient === true,
  }, {
    durable: entity.transient !== true,
    transient: entity.transient === true,
  }).success, true);
  database.flushTablesSync([nativeStore.TABLE.ENTITIES, nativeStore.TABLE.CONTROLLERS]);
  return entity;
}

function actor(factionID = FACTION_ID) {
  return { characterID: PLAYER_ID, factionID };
}

function ok(result) {
  assert.equal(result && result.success, true, result && result.errorMsg);
  return result.data;
}

test("Frontier extraction tools retain dual-use combat and mining capabilities", () => {
  assert.equal(npcFitting.classifyNpcEquipment({ typeID: 95317, itemName: "Cutting Laser" }), "weapon");
  assert.equal(npcFitting.classifyNpcEquipment({ typeID: 95503, itemName: "Crude Extractor" }), "mining");
  assert.equal(npcFitting.classifyNpcEquipment({ typeID: 95778, itemName: "Needle" }), "weapon");
  assert.deepEqual(
    npcFitting.resolveNpcEquipmentProfile({ typeID: 95317, itemName: "Cutting Laser" })
      .semanticRoles,
    ["mining", "weapon"],
  );
  assert.deepEqual(
    npcFitting.resolveNpcEquipmentProfile({ typeID: 95503, itemName: "Crude Extractor" })
      .semanticRoles,
    ["mining"],
  );
});

test("NPC equipment profiles account for legacy dogma and Creation modular equipment", () => {
  const legacyMiner = npcFitting.resolveNpcEquipmentProfile({
    typeID: 991001,
    itemName: "Legacy Ore Miner",
  }, {
    getTypeEffectRecords: () => [{ name: "miningLaser" }],
    getCreationModule: () => null,
    getHeldBeamUtilityProfile: () => null,
    resolveWeaponFamily: () => null,
  });
  assert.equal(legacyMiner.semanticRole, "mining");
  assert.deepEqual(legacyMiner.semanticRoles, ["mining"]);
  assert.equal(legacyMiner.equipmentArchitecture, "legacy");

  const legacyWeapon = npcFitting.resolveNpcEquipmentProfile({
    typeID: 991002,
    itemName: "Legacy Pulse Weapon",
  }, {
    getTypeEffectRecords: () => [{ name: "turretFitted" }],
    getCreationModule: () => null,
    getHeldBeamUtilityProfile: () => null,
    resolveWeaponFamily: () => "laserTurret",
  });
  assert.equal(legacyWeapon.semanticRole, "weapon");
  assert.deepEqual(legacyWeapon.semanticRoles, ["weapon"]);

  const modularPropulsion = npcFitting.resolveNpcEquipmentProfile({
    typeID: 991003,
    itemName: "Modular Drive Interior",
  }, {
    getTypeEffectRecords: () => [],
    getCreationModule: () => ({
      behavior: "generic",
      capability: "propulsion",
      system: "propulsion",
      placement: { hardpoints: ["booster"], must_be_in_root: 1 },
    }),
    getHeldBeamUtilityProfile: () => null,
    resolveWeaponFamily: () => null,
    isMiningEffectRecord: () => false,
  });
  assert.equal(modularPropulsion.semanticRole, "propulsion");
  assert.deepEqual(modularPropulsion.semanticRoles, ["propulsion"]);
  assert.equal(modularPropulsion.equipmentArchitecture, "creation");
  assert.deepEqual(modularPropulsion.creationModuleProfile.hardpoints, ["booster"]);
  assert.equal(modularPropulsion.creationModuleProfile.mustBeInRoot, true);

  const modularInterior = npcFitting.resolveNpcEquipmentProfile({
    typeID: 991004,
    itemName: "Modular Cargo Interior",
  }, {
    getTypeEffectRecords: () => [],
    getCreationModule: () => ({
      behavior: "generic",
      capability: "inventory",
      system: "stowage_crafting",
      placement: {},
    }),
    getHeldBeamUtilityProfile: () => null,
    resolveWeaponFamily: () => null,
    isMiningEffectRecord: () => false,
  });
  assert.equal(modularInterior.semanticRole, "passive");
  assert.deepEqual(modularInterior.semanticRoles, ["passive"]);
  assert.equal(modularInterior.creationModuleProfile.capability, "inventory");
});

test("NPC hulls resolve a player fitting hull where one is appropriate", () => {
  assert.equal(npcFitting.resolveNpcPlayerFittingHullTypeID({
    typeID: 990700,
    categoryID: 11,
    playerFittingHullTypeID: 587,
  }), 587);
  assert.equal(npcFitting.resolveNpcPlayerFittingHullTypeID({
    typeID: 588,
    categoryID: 6,
  }), 588);
  assert.equal(npcFitting.resolveNpcPlayerFittingHullTypeID({
    typeID: 990700,
    categoryID: 11,
    slimTypeID: 589,
    slimCategoryID: 6,
  }), 589);
  assert.equal(npcFitting.resolveNpcPlayerFittingHullTypeID({
    typeID: 72207,
    categoryID: 11,
    nativeNpc: true,
  }), 72207);
  assert.equal(npcFitting.resolveNpcPlayerFittingHullTypeID({
    typeID: 72207,
    categoryID: 11,
  }), 0);
});

test("durable SDE entity-category NPC ships expose their physical fitting hull", (t) => {
  fixture(t);
  createNpc({
    typeID: 72207,
    groupID: 759,
    categoryID: 11,
    playerFittingHullTypeID: null,
    npcFittingProfileID: null,
    npcFittingRestrictions: null,
  });
  const resolved = npcFitting.resolveNpcFittingEntity(ENTITY_ID);
  assert.equal(resolved.success, true);
  assert.equal(resolved.data.fittingHull.typeID, 72207);
  assert.equal(resolved.data.fittingHull.npcPhysicalHullTypeID, 72207);
});

test("player-compatible NPC hulls delegate restrictions and resources to player fitting", (t) => {
  fixture(t);
  createNpc({
    playerFittingHullTypeID: 587,
    npcFittingProfileID: null,
    npcFittingRestrictions: null,
  });
  const moduleID = 91000700;
  writeItems([itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Prototype Weapon")]);
  let validationArgs = null;
  t.mock.method(liveFittingState, "validateFitForShip", (...args) => {
    validationArgs = args;
    return { success: true, data: { family: "high", targetFlagID: 11 } };
  });
  t.mock.method(liveFittingState, "resolveFitOnlineState", () => ({
    applies: true,
    online: true,
    resourceState: { cpuOutput: 100, cpuLoad: 10, powerOutput: 100, powerLoad: 20 },
  }));

  const fitted = ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: moduleID,
    targetFlagID: 11,
    actor: actor(),
  }));
  assert.equal(fitted.moduleID, moduleID);
  assert.equal(validationArgs[1].typeID, 587);
  assert.equal(validationArgs[3], 11);
  assert.equal(validationArgs[5].skipSkillRequirements, true);
  assert.equal(nativeStore.getNativeModule(moduleID).playerFittingHullTypeID, 587);
});

test("NPC fitting preserves canonical module and charge IDs through custody", (t) => {
  fixture(t);
  createNpc();
  const moduleID = 91000701;
  const chargeID = 91000702;
  writeItems([
    itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Prototype Weapon", 2),
    itemRow(chargeID, CHARGE_TYPE_ID, 8, 85, "Prototype Ammunition", 10),
  ]);

  const fitted = ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: moduleID,
    actor: actor(),
  }));
  assert.equal(fitted.moduleID, moduleID);
  assert.equal(fitted.semanticRole, "weapon");
  assert.equal(itemStore.findItemById(moduleID).locationID, ENTITY_ID);
  assert.equal(itemStore.findItemById(moduleID).singleton, 1);
  assert.equal(nativeStore.getNativeModule(moduleID).custody.sourceItemID, moduleID);
  const remainderModule = Object.values<any>(itemStore.getAllItems()).find(
    (item) => item.typeID === WEAPON_TYPE_ID && item.itemID !== moduleID,
  );
  assert.equal(remainderModule.locationID, SOURCE_LOCATION_ID);
  assert.equal(remainderModule.stacksize, 1);
  assert.equal(npcFitting.listNpcEquipment(ENTITY_ID)[0].usable, false);

  const duplicate = ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: moduleID,
    actor: actor(),
  }));
  assert.equal(duplicate.idempotent, true);
  assert.equal(nativeStore.listNativeModulesForEntity(ENTITY_ID).length, 1);

  const loaded = ok(npcFitting.loadChargeToNpcModule({
    entityID: ENTITY_ID,
    moduleID,
    itemID: chargeID,
    quantity: 5,
    actor: actor(),
  }));
  assert.equal(loaded.cargoID, chargeID);
  assert.equal(itemStore.findItemById(chargeID).locationID, ENTITY_ID);
  assert.equal(itemStore.findItemById(chargeID).stacksize, 5);
  const remainderCharge = Object.values<any>(itemStore.getAllItems()).find(
    (item) => item.typeID === CHARGE_TYPE_ID && item.itemID !== chargeID,
  );
  assert.equal(remainderCharge.locationID, SOURCE_LOCATION_ID);
  assert.equal(remainderCharge.stacksize, 5);
  assert.equal(npcFitting.selectNpcEquipmentForRole(ENTITY_ID, "weapon").moduleID, moduleID);
  assert.equal(npcFitting.listNpcConsumables(ENTITY_ID, "ammunition")[0].cargoID, chargeID);

  ok(npcFitting.unloadChargeFromNpcModule({
    entityID: ENTITY_ID,
    cargoID: chargeID,
    actor: actor(),
  }));
  assert.equal(itemStore.findItemById(chargeID).locationID, SOURCE_LOCATION_ID);
  assert.equal(nativeStore.getNativeCargo(chargeID), null);
  ok(npcFitting.unfitItemFromNpc({
    entityID: ENTITY_ID,
    moduleID,
    actor: actor(),
  }));
  assert.equal(itemStore.findItemById(moduleID).locationID, SOURCE_LOCATION_ID);
  assert.equal(nativeStore.getNativeModule(moduleID), null);
});

test("transient NPCs use the same fitting flow and return custody when removed", (t) => {
  fixture(t);
  createNpc({ transient: true });
  const moduleID = 91000705;
  const chargeID = 91000706;
  writeItems([
    itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Transient Weapon"),
    itemRow(chargeID, CHARGE_TYPE_ID, 8, 85, "Transient Charge", 5),
  ]);
  assert.equal(npcFitting.resolveNpcFittingEntity(ENTITY_ID).success, true);
  ok(npcFitting.fitItemToNpc({ entityID: ENTITY_ID, itemID: moduleID, actor: actor() }));
  ok(npcFitting.loadChargeToNpcModule({
    entityID: ENTITY_ID, moduleID, itemID: chargeID, quantity: 5, actor: actor(),
  }));
  assert.equal(itemStore.findItemById(moduleID).locationID, ENTITY_ID);
  assert.equal(itemStore.findItemById(chargeID).locationID, ENTITY_ID);
  ok(nativeStore.removeNativeEntityCascade(ENTITY_ID));
  assert.equal(itemStore.findItemById(moduleID).locationID, SOURCE_LOCATION_ID);
  assert.equal(itemStore.findItemById(chargeID).locationID, SOURCE_LOCATION_ID);
  assert.equal(nativeStore.getNativeModule(moduleID), null);
  assert.equal(nativeStore.getNativeCargo(chargeID), null);
});

test("restart recovery returns custody orphaned by a transient NPC", (t) => {
  fixture(t);
  createNpc({ transient: true });
  const moduleID = 91000707;
  const chargeID = 91000708;
  writeItems([
    itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Orphaned Weapon"),
    itemRow(chargeID, CHARGE_TYPE_ID, 8, 85, "Orphaned Charge", 5),
  ]);
  ok(npcFitting.fitItemToNpc({ entityID: ENTITY_ID, itemID: moduleID, actor: actor() }));
  ok(npcFitting.loadChargeToNpcModule({
    entityID: ENTITY_ID, moduleID, itemID: chargeID, quantity: 5, actor: actor(),
  }));
  // The runtime-only NPC is absent after restart; the inventory and custody
  // mirrors were committed before the process stopped.
  ok(nativeStore.removeNativeController(ENTITY_ID));
  ok(nativeStore.removeNativeEntity(ENTITY_ID));
  persistence._testing.resetRuntimeForTests();
  const recovered = persistence.initializeNpcRuntimePersistence();
  assert.equal(recovered.success, true);
  assert.equal(itemStore.findItemById(moduleID).locationID, SOURCE_LOCATION_ID);
  assert.equal(itemStore.findItemById(chargeID).locationID, SOURCE_LOCATION_ID);
  assert.equal(nativeStore.getNativeModule(moduleID), null);
  assert.equal(nativeStore.getNativeCargo(chargeID), null);
});

test("NPC hull restrictions enforce faction, role slots, CPU, and propulsion authority", (t) => {
  fixture(t);
  createNpc();
  const weaponID = 91000711;
  const overloadedID = 91000712;
  const propulsionID = 91000713;
  writeItems([
    itemRow(weaponID, WEAPON_TYPE_ID, 7, 53, "Prototype Weapon"),
    itemRow(overloadedID, OVERLOADED_TYPE_ID, 7, 53, "Overloaded Weapon"),
    itemRow(propulsionID, PROPULSION_TYPE_ID, 7, 46, "Prototype Afterburner"),
  ]);

  const wrongFaction = npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: weaponID,
    actor: actor(500011),
  });
  assert.equal(wrongFaction.success, false);
  assert.equal(wrongFaction.errorMsg, "NPC_FACTION_AUTHORIZATION_REQUIRED");
  assert.equal(itemStore.findItemById(weaponID).locationID, SOURCE_LOCATION_ID);

  const overload = npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: overloadedID,
    actor: actor(),
  });
  assert.equal(overload.success, false);
  assert.equal(overload.errorMsg, "NOT_ENOUGH_CPU");
  assert.equal(itemStore.findItemById(overloadedID).locationID, SOURCE_LOCATION_ID);

  const wrongSlot = npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: weaponID,
    targetFlagID: 19,
    actor: actor(),
  });
  assert.equal(wrongSlot.success, false);
  assert.equal(wrongSlot.errorMsg, "NPC_HULL_ROLE_SLOT_RESTRICTED");

  const propulsion = ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: propulsionID,
    actor: actor(),
  }));
  assert.equal(propulsion.semanticRole, "propulsion");
  assert.equal(propulsion.propulsionDisabled, true);
  const module = nativeStore.getNativeModule(propulsionID);
  assert.equal(module.flagID, 19);
  assert.equal(module.moduleState.online, false);
  assert.equal(module.useDisabledReason, "NPC_SYNTHETIC_NAVIGATION_AUTHORITY");
  assert.equal(npcFitting.selectNpcEquipmentForRole(ENTITY_ID, "propulsion"), null);
});

test("interrupted NPC fits recover their mirror record exactly once", (t) => {
  fixture(t);
  const entity = createNpc();
  const moduleID = 91000721;
  const moduleItem = itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Recovery Weapon");
  writeItems([moduleItem]);
  const custody = npcFitting._testing.buildCustody(
    moduleItem,
    entity,
    actor(),
    "player",
    "fitted",
  );
  const moduleRecord = {
    moduleID,
    entityID: ENTITY_ID,
    ownerID: PLAYER_ID,
    typeID: WEAPON_TYPE_ID,
    groupID: 53,
    categoryID: 7,
    itemName: "Recovery Weapon",
    flagID: 11,
    singleton: true,
    transient: false,
    semanticRole: "weapon",
    custody,
    moduleState: { online: true },
  };
  const operation = ok(persistence.beginNpcOperation("npc-fit", "npc-fit:test:recover", {
    entityID: ENTITY_ID,
    moduleID,
    sourceItemState: custody,
    moduleRecord,
  }));
  ok(itemStore.moveItemToLocation(moduleID, ENTITY_ID, 11, null, {
    affectsFitting: true,
    preserveMovedItemID: true,
  }));
  database.flushTableSync(itemStore.ITEMS_TABLE);
  persistence.checkpointNpcOperation(operation.operationID, "inventory-moved", { moduleRecord }, {
    flushTables: [itemStore.ITEMS_TABLE],
  });
  assert.equal(nativeStore.getNativeModule(moduleID), null);

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence();
  assert.equal(nativeStore.getNativeModule(moduleID).moduleID, moduleID);
  assert.equal(
    persistence._testing.readRoot().operations[operation.operationID].status,
    "committed",
  );
  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence();
  assert.equal(nativeStore.listNativeModulesForEntity(ENTITY_ID).length, 1);
});

test("NPC removal returns custody by default and honors explicit destruction policy", (t) => {
  fixture(t);
  createNpc();
  const returnedModuleID = 91000731;
  writeItems([itemRow(returnedModuleID, WEAPON_TYPE_ID, 7, 53, "Returned Weapon")]);
  ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: returnedModuleID,
    actor: actor(),
  }));
  ok(nativeStore.removeNativeEntityCascade(ENTITY_ID, { destroyed: true }));
  assert.equal(itemStore.findItemById(returnedModuleID).locationID, SOURCE_LOCATION_ID);

  const destroyedEntityID = ENTITY_ID + 1;
  createNpc({
    entityID: destroyedEntityID,
    npcFittingRestrictions: {
      ...createNpcRestrictions(),
      equipmentLossPolicy: "destroy",
    },
  });
  const destroyedModuleID = 91000732;
  writeItems([
    itemStore.findItemById(returnedModuleID),
    itemRow(destroyedModuleID, WEAPON_TYPE_ID, 7, 53, "Destroyed Weapon"),
  ]);
  ok(npcFitting.fitItemToNpc({
    entityID: destroyedEntityID,
    itemID: destroyedModuleID,
    actor: actor(),
  }));
  ok(nativeStore.removeNativeEntityCascade(destroyedEntityID, { destroyed: true }));
  assert.equal(itemStore.findItemById(destroyedModuleID), null);
});

test("destruction recovery settles externally owned NPC equipment before removal", (t) => {
  fixture(t);
  createNpc();
  const moduleID = 91000741;
  writeItems([itemRow(moduleID, WEAPON_TYPE_ID, 7, 53, "Recovered Destruction Weapon")]);
  ok(npcFitting.fitItemToNpc({
    entityID: ENTITY_ID,
    itemID: moduleID,
    actor: actor(),
  }));
  const operation = ok(persistence.beginNpcOperation(
    "destroy",
    `destroy:${ENTITY_ID}:1`,
    {
      entityID: ENTITY_ID,
      npcCharacterID: 1500000701,
      incarnation: 1,
      destroyed: true,
      equipmentLossPolicy: "return",
    },
  ));

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence();
  assert.equal(nativeStore.getNativeEntity(ENTITY_ID), null);
  assert.equal(itemStore.findItemById(moduleID).locationID, SOURCE_LOCATION_ID);
  assert.equal(
    persistence._testing.readRoot().operations[operation.operationID].status,
    "committed",
  );
});

function createNpcRestrictions() {
  return {
    allowedRoles: ["weapon", "ammunition", "propulsion"],
    roleSlots: { weapon: [11, 12], propulsion: [19] },
    cpuOutput: 100,
    powerOutput: 100,
    moduleResources: {
      [WEAPON_TYPE_ID]: { cpu: 10, power: 20 },
      [PROPULSION_TYPE_ID]: { cpu: 5, power: 5 },
      [OVERLOADED_TYPE_ID]: { cpu: 101, power: 1 },
    },
    chargeCompatibility: {
      [WEAPON_TYPE_ID]: { allowedTypeIDs: [CHARGE_TYPE_ID], capacity: 5 },
    },
    equipmentLossPolicy: "return",
  };
}
