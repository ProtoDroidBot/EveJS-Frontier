"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const launchBayPayloadRuntime = require(
  "../src/services/frontier/launchBayPayloadRuntime",
);
const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");

const TYPE_HEAT_TRAP = 95812;

function buildHotHeatTrap(startTimeMs = 1_000) {
  const item: Record<string, any> = {
    itemID: 9_581_200,
    typeID: TYPE_HEAT_TRAP,
    categoryID: 22,
    groupID: 5142,
    conditionState: { temperature: 445 },
    customInfo: JSON.stringify({
      // Keep this focused unit independent of an installed static-data tree
      // while using the exact build-3502403 authored attribute values.
      evejsDynamicItem: {
        attributes: {
          2275: 5_000,
          5762: 56,
          5763: 1,
          5765: 295,
          6323: 350,
          6324: 9,
        },
      },
    }),
  };
  const launchState = {
    deployedAtMs: startTimeMs,
    launcherCharacterID: 140_000_001,
    sourceModuleID: 9_581_100,
    sourceShipID: 9_570_001,
    systemID: 30_000_004,
    transferredHeat: 150,
  };
  const heatState = launchBayPayloadRuntime.buildHeatTrapState(item, {
    ambientTemperature: 295,
    startTemperature: 445,
    startTimeMs,
  });
  item.customInfo = launchBayPayloadRuntime.buildCustomInfoWithLaunchState(
    item.customInfo,
    launchState,
    heatState,
  );
  return item;
}

test("Heat Trap uses authored cooling and thermal-discharge formula", () => {
  const item = buildHotHeatTrap();
  const start = launchBayPayloadRuntime.resolveHeatTrapDischarge(item, 1_000);
  assert.equal(start.temperature, 445);
  assert.equal(start.volatilityThreshold, 350);
  assert.equal(start.scaleFactor, 9);
  assert.equal(start.radiusMeters, 5_000);
  assert.equal(start.damage, 855);
  assert.deepEqual(start.damageVector, {
    em: 0,
    thermal: 855,
    kinetic: 0,
    explosive: 0,
  });

  const afterOneTimeConstant = launchBayPayloadRuntime
    .resolveHeatTrapDischarge(item, 57_000);
  assert.ok(
    Math.abs(afterOneTimeConstant.temperature - (295 + 150 / Math.E)) < 1.0e-9,
  );
  assert.ok(afterOneTimeConstant.damage > 0);
  const cooled = launchBayPayloadRuntime.resolveHeatTrapDischarge(item, 121_000);
  assert.equal(cooled.damage, 0);
  assert.equal(launchBayPayloadRuntime.isHeatTrapVolatile(item, 1_000), true);
  assert.equal(launchBayPayloadRuntime.isHeatTrapVolatile(item, 121_000), false);
});

test("Heat Trap publishes authored cooling recipe and volatility transitions", () => {
  const item = buildHotHeatTrap();
  const notifications: any[] = [];
  const session = {
    characterID: 140_000_001,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const scene = {
    canSessionSeeDynamicEntity: () => true,
    getCurrentFileTime: () => 1_000_000_000n,
    sessions: new Map([[1, session]]),
  };
  const entity: Record<string, any> = {
    itemID: item.itemID,
    typeID: item.typeID,
  };

  assert.equal(
    launchBayPayloadRuntime._testing.tickHeatTrap(scene, entity, item, 1_000),
    true,
  );
  assert.equal(entity.heatTrapVolatile, true);
  assert.deepEqual(
    notifications.map((entry) => entry.name),
    ["OnHeatTrapCoolingRecipe", "OnHeatTrapVolatilityChanged"],
  );
  const recipe = notifications[0].payload[1];
  assert.equal(recipe.ambient_temperature, 295);
  assert.equal(recipe.start_temperature, 445);
  assert.equal(recipe.time_scale, 56);
  assert.equal(notifications[0].payload[2], 350);

  assert.equal(
    launchBayPayloadRuntime._testing.tickHeatTrap(scene, entity, item, 121_000),
    true,
  );
  assert.equal(entity.heatTrapVolatile, false);
  assert.equal(notifications.at(-1).name, "OnHeatTrapVolatilityChanged");
  assert.equal(notifications.at(-1).payload[1], false);
});

test("destroying a volatile Heat Trap damages owner and hostile ships through shared area authority", () => {
  const ownerID = 140_000_005;
  const systemID = 30_000_004;
  const grant = itemStore.grantItemToCharacterLocation(
    ownerID,
    systemID,
    0,
    TYPE_HEAT_TRAP,
    1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(grant.success, true, grant.errorMsg);
  const granted = grant.data.items[0];
  const authored = buildHotHeatTrap(1_000);
  const persisted = itemStore.updateInventoryItem(granted.itemID, (item) => ({
    ...item,
    conditionState: { ...(item.conditionState || {}), temperature: 445 },
    customInfo: authored.customInfo,
    spaceState: {
      systemID,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
    },
  }));
  assert.equal(persisted.success, true, persisted.errorMsg);

  const trap: Record<string, any> = {
    itemID: granted.itemID,
    typeID: TYPE_HEAT_TRAP,
    ownerID,
    kind: "deployable",
    position: { x: 0, y: 0, z: 0 },
    radius: 3,
  };
  const ownerShip: Record<string, any> = {
    itemID: 9_570_001,
    typeID: 95_020,
    ownerID,
    kind: "ship",
    position: { x: 1_000, y: 0, z: 0 },
    radius: 30,
    structureHP: 10_000,
    conditionState: { damage: 0, armorDamage: 0, shieldCharge: 1 },
  };
  const hostileShip: Record<string, any> = {
    ...ownerShip,
    itemID: 9_570_002,
    ownerID: 140_000_006,
    position: { x: 4_000, y: 0, z: 0 },
    conditionState: { damage: 0, armorDamage: 0, shieldCharge: 1 },
  };
  const distantShip: Record<string, any> = {
    ...ownerShip,
    itemID: 9_570_003,
    ownerID: 140_000_007,
    position: { x: 6_000, y: 0, z: 0 },
    conditionState: { damage: 0, armorDamage: 0, shieldCharge: 1 },
  };
  const entities = new Map([
    [trap.itemID, trap],
    [ownerShip.itemID, ownerShip],
    [hostileShip.itemID, hostileShip],
    [distantShip.itemID, distantShip],
  ]);
  const scene = {
    systemID,
    dynamicEntities: entities,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 1,
    getEntityByID: (itemID) => entities.get(Number(itemID)),
  };

  const result = spaceRuntime._testing
    .dischargeHeatTrapBeforeDestructionForTesting(scene, trap, 1_000);
  assert.deepEqual(result, { triggered: true, targetCount: 2, damage: 855 });
  assert.equal(ownerShip.conditionState.damage, 0.0855, "the owner is not immune");
  assert.equal(hostileShip.conditionState.damage, 0.0855);
  assert.equal(distantShip.conditionState.damage, 0, "ships outside 5 km are untouched");

  const repeated = spaceRuntime._testing
    .dischargeHeatTrapBeforeDestructionForTesting(scene, trap, 1_000);
  assert.deepEqual(repeated, { triggered: false, targetCount: 0, damage: 0 });
  assert.equal(ownerShip.conditionState.damage, 0.0855, "discharge is one-shot");
});

test("a failed ballpark removal rolls a payload scoop back before presentation", () => {
  const ownerID = 140_000_001;
  const systemID = 30_000_004;
  const shipID = 9_570_101;
  const grant = itemStore.grantItemToCharacterLocation(
    ownerID,
    systemID,
    0,
    TYPE_HEAT_TRAP,
    1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(grant.success, true, grant.errorMsg);
  const granted = grant.data.items[0];
  const authored = buildHotHeatTrap(1_000);
  const persisted = itemStore.updateInventoryItem(granted.itemID, (item) => ({
    ...item,
    categoryID: launchBayPayloadRuntime.DEPLOYABLE_CATEGORY_ID,
    groupID: launchBayPayloadRuntime.PAYLOAD_GROUP_ID,
    conditionState: { ...(item.conditionState || {}), temperature: 445 },
    customInfo: authored.customInfo,
    spaceState: {
      systemID,
      position: { x: 100, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      mode: "STOP",
    },
  }));
  assert.equal(persisted.success, true, persisted.errorMsg);
  const before = itemStore.findItemById(granted.itemID);
  const shipEntity = {
    itemID: shipID,
    ownerID,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
  };
  const payloadEntity = {
    itemID: granted.itemID,
    ownerID,
    kind: "deployable",
    position: { x: 100, y: 0, z: 0 },
  };
  let notificationCount = 0;
  const result = launchBayPayloadRuntime.scoopLaunchBayPayloadToCargo(
    {
      characterID: ownerID,
      _space: { shipID, systemID },
    },
    granted.itemID,
    {
      // The trap has cooled below the authored volatility threshold.
      nowMs: 121_000,
      getShipCargoCapacity: () => 1_000,
      getCargoUsedVolume: () => 0,
      syncInventoryItemForSession: () => { notificationCount += 1; },
      spaceRuntime: {
        getEntity(_session, itemID) {
          if (Number(itemID) === shipID) return shipEntity;
          if (Number(itemID) === granted.itemID) return payloadEntity;
          return null;
        },
        removeDynamicEntity() {
          return { success: false, errorMsg: "DYNAMIC_ENTITY_REMOVE_FAILED" };
        },
      },
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "DYNAMIC_ENTITY_REMOVE_FAILED");
  assert.equal(notificationCount, 0);
  const after = itemStore.findItemById(granted.itemID);
  assert.equal(after.locationID, before.locationID);
  assert.equal(after.flagID, before.flagID);
  assert.deepEqual(after.spaceState, before.spaceState);
  assert.equal(after.customInfo, before.customInfo);
  assert.ok(launchBayPayloadRuntime.getLaunchState(after));
});
