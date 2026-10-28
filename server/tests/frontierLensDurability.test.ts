"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const itemStore = require("../src/services/inventory/itemStore");
const { getTypeDogmaAttributes } = require("../src/services/fitting/liveFittingState");
const { currentFileTime, unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const DogmaService = require("../src/services/dogma/dogmaService");
const spaceRuntime = require("../src/space/runtime");

const OWNER_ID = 140000004;
const SYSTEM_ID = 30000004;
const LENS_TYPE_IDS = [
  77518, 83463, 83895, 83896, 83897, 83898, 87598,
  88321, 88341, 88342, 91994, 91997, 95639, 95779,
];

test("every authored lens takes only its own volatility damage on a successful roll", () => {
  const moduleItem = { itemID: 9100000001, flagID: 183, moduleState: { damage: 0 } };
  const attackerEntity = { itemID: 9100000000, kind: "ship" };
  for (const typeID of LENS_TYPE_IDS) {
    const attributes = getTypeDogmaAttributes(typeID);
    const chance = Number(attributes[783]);
    const damage = Number(attributes[784]);
    assert.equal(Number(attributes[786]), 1, `lens ${typeID} must take damage`);
    assert.ok(chance > 0 && damage > 0, `lens ${typeID} needs volatility attributes`);

    const grant = itemStore.grantItemToCharacterLocation(
      OWNER_ID, moduleItem.itemID, 184, typeID, 1,
      { individualItems: true, singleton: 0 },
    );
    assert.equal(grant.success, true, grant.errorMsg);
    const chargeItem = grant.data.items[0];
    const applied = spaceRuntime.skillShotInterop.applyCrystalVolatilityDamage(
      {}, attackerEntity, moduleItem, chargeItem, 1_000, () => 0,
    );
    assert.equal(applied.success, true, applied.errorMsg);
    assert.equal(applied.data.damaged, true);
    assert.ok(Math.abs(
      itemStore.findItemById(chargeItem.itemID).moduleState.damage - damage,
    ) < 1e-9, `lens ${typeID} took the wrong damage`);
    assert.equal(moduleItem.moduleState.damage, 0);

    if (chance < 1) {
      const missed = spaceRuntime.skillShotInterop.applyCrystalVolatilityDamage(
        {}, attackerEntity, moduleItem,
        itemStore.findItemById(chargeItem.itemID), 2_000, () => 0.999999,
      );
      assert.equal(missed.success, true);
      assert.equal(missed.data.damaged, false);
      assert.ok(Math.abs(
        itemStore.findItemById(chargeItem.itemID).moduleState.damage - damage,
      ) < 1e-9);
    }
  }
});

test("login Dogma shipInfo includes a loaded Creation lens beneath its module", () => {
  const shipGrant = itemStore.grantItemToCharacterLocation(
    OWNER_ID, SYSTEM_ID, 0, 95735, 1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(shipGrant.success, true, shipGrant.errorMsg);
  const ship = shipGrant.data.items[0];
  const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
  assert.equal(ensured.success, true, ensured.errorMsg);
  const moduleEntry = ensured.data.state.modules.find(
    (entry) => Number(entry.typeID) === 95317,
  );
  assert.ok(moduleEntry);
  const lensGrant = itemStore.grantItemToCharacterLocation(
    OWNER_ID, moduleEntry.itemID, 184, 95779, 1,
    { individualItems: true, singleton: 0 },
  );
  assert.equal(lensGrant.success, true, lensGrant.errorMsg);
  const lens = lensGrant.data.items[0];
  const wornLens = itemStore.updateInventoryItem(lens.itemID, (item) => ({
    ...item,
    moduleState: { ...(item.moduleState || {}), damage: 0.06 },
  }));
  assert.equal(wornLens.success, true, wornLens.errorMsg);
  const session = {
    characterID: OWNER_ID,
    _space: { shipID: ship.itemID, systemID: SYSTEM_ID },
    compatibilityProfile: "frontier",
  };
  const dogma = new DogmaService();
  const moduleItems = ensured.data.state.modules.map(
    (entry) => itemStore.findItemById(entry.itemID),
  );
  const entries = dogma._buildShipInventoryInfoEntries(
    OWNER_ID, ship.itemID, OWNER_ID, SYSTEM_ID, session,
    { creationModuleItems: moduleItems, includeLoadedCharges: false },
  );
  const lensEntry = entries.find(([itemID]) => itemID === lens.itemID);
  assert.ok(lensEntry, "the loaded lens must be in login shipInfo");
  const info = unwrapMarshalValue(lensEntry[1]);
  assert.equal(info.invItem.fields.locationID, moduleEntry.itemID);
  assert.equal(info.invItem.fields.flagID, 184);
  assert.ok(Number(info.attributes[805][0]) > 0);
  assert.equal(info.attributes[3][0], 0.06);
});

test("Creation lens burnout removes the real charge and updates its HP and fitting view", () => {
  const shipGrant = itemStore.grantItemToCharacterLocation(
    OWNER_ID, SYSTEM_ID, 0, 95735, 1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(shipGrant.success, true, shipGrant.errorMsg);
  const shipID = shipGrant.data.items[0].itemID;
  const shipUpdate = itemStore.updateInventoryItem(shipID, (item) => ({
    ...item,
    locationID: SYSTEM_ID,
    flagID: 0,
    spaceState: {
      systemID: SYSTEM_ID,
      position: { x: 0, y: 0, z: 0 },
    },
  }));
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
  const ensured = creationRuntime.ensureCreationState(shipUpdate.data, OWNER_ID);
  assert.equal(ensured.success, true, ensured.errorMsg);
  const moduleEntry = ensured.data.state.modules.find(
    (entry) => Number(entry.typeID) === 95317,
  );
  assert.ok(moduleEntry, "Refuge Creation needs a Cutting Laser");
  const moduleItem = itemStore.findItemById(moduleEntry.itemID);
  assert.ok(moduleItem);

  const chargeGrant = itemStore.grantItemToCharacterLocation(
    OWNER_ID, moduleItem.itemID, 184, 83463, 1,
    { individualItems: true, singleton: 0 },
  );
  assert.equal(chargeGrant.success, true, chargeGrant.errorMsg);
  const chargeID = chargeGrant.data.items[0].itemID;
  const damaged = itemStore.updateInventoryItem(chargeID, (item) => ({
    ...item,
    moduleState: { ...(item.moduleState || {}), damage: 0.97 },
  }));
  assert.equal(damaged.success, true, damaged.errorMsg);

  const notifications: any[] = [];
  const session = {
    characterID: OWNER_ID,
    charid: OWNER_ID,
    shipID,
    _space: { shipID, systemID: SYSTEM_ID, simFileTime: currentFileTime() },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const first = spaceRuntime.skillShotInterop.applyCrystalVolatilityDamage(
    {}, { itemID: shipID, kind: "ship", ownerID: OWNER_ID, session },
    moduleItem, damaged.data, 1_000, () => 0,
  );
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(first.data.burnedOut, false);
  assert.ok(Math.abs(itemStore.findItemById(chargeID).moduleState.damage - 0.99) < 1e-9);
  const firstChange = notifications.find((entry) =>
    entry.name === "OnModuleAttributeChanges").payload[0].items[0];
  assert.equal(firstChange[2], chargeID);
  assert.ok(Math.abs(firstChange[5] - 0.99) < 1e-9);
  assert.ok(Math.abs(firstChange[6] - 0.97) < 1e-9);
  notifications.length = 0;

  const result = spaceRuntime.skillShotInterop.applyCrystalVolatilityDamage(
    {}, { itemID: shipID, kind: "ship", ownerID: OWNER_ID, session },
    moduleItem, itemStore.findItemById(chargeID), 2_000, () => 0,
  );
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.burnedOut, true);
  assert.equal(itemStore.findItemById(chargeID), null);
  assert.equal(Number(itemStore.findItemById(moduleItem.itemID).moduleState?.damage || 0), 0);

  const hpChange = notifications.find((entry) =>
    entry.name === "OnModuleAttributeChanges");
  assert.ok(hpChange);
  const change = hpChange.payload[0].items[0];
  assert.equal(change[2], chargeID);
  assert.equal(change[3], 3);
  assert.equal(change[5], 1);
  assert.equal(change[6], 0.99);
  const removal = notifications.find((entry) => entry.name === "OnItemChange");
  assert.equal(removal.payload[0].fields.itemID, chargeID);
  const changed = notifications.find((entry) => entry.name === "OnCreationChanged");
  assert.ok(changed);
  const snapshot = unwrapMarshalValue(changed.payload[1]);
  assert.equal(snapshot.modules[String(moduleItem.itemID)].loaded_count, 0);
});
