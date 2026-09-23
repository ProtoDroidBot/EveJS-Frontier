"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
itemTypeRegistry._setEntriesForTests([
  { typeID: 1230, name: "Veldspar", groupID: 462, categoryID: 25, groupName: "Veldspar", volume: 0.1 },
  { typeID: 92394, name: "Fine Young Crude Matter", groupID: 4593, categoryID: 25, groupName: "Rift", volume: 1 },
]);

const {
  DEPLETED_MINEABLE_RESPAWN_DELAY_MS,
  ensureSceneMiningState,
  getMineableState,
  respawnDepletedMineables,
  updateMineableState,
  _testing,
} = require("../src/services/mining/miningRuntimeState");

function buildScene(entity) {
  return {
    systemID: 30_000_142,
    staticEntities: [entity],
    staticEntitiesByID: new Map([[entity.itemID, entity]]),
    broadcasts: [],
    addStaticEntity(nextEntity) {
      if (this.staticEntitiesByID.has(nextEntity.itemID)) return false;
      this.staticEntities.push(nextEntity);
      this.staticEntitiesByID.set(nextEntity.itemID, nextEntity);
      return true;
    },
    broadcastAddBalls(entities) {
      this.broadcasts.push(entities.map((entry) => entry.itemID));
    },
    clearAllTargetingForEntity() {},
    getEntityByID(entityID) {
      return this.staticEntitiesByID.get(Number(entityID)) || null;
    },
    removeStaticEntity(entityID) {
      const numericEntityID = Number(entityID);
      const existing = this.staticEntitiesByID.get(numericEntityID) || null;
      if (!existing) return { success: false, errorMsg: "STATIC_ENTITY_NOT_FOUND" };
      this.staticEntitiesByID.delete(numericEntityID);
      this.staticEntities = this.staticEntities.filter((entry) => entry.itemID !== numericEntityID);
      return { success: true, data: { entity: existing } };
    },
  };
}

test("depleted asteroids respawn after 24 hours in a live scene", () => {
  const asteroid = {
    kind: "asteroid",
    itemID: 5_000_000_100_001,
    typeID: 1230,
    groupID: 450,
    categoryID: 25,
    itemName: "Veldspar",
    radius: 1_000,
    beltID: 40_000_001,
    fieldStyleID: "test_belt",
    position: { x: 0, y: 0, z: 0 },
  };
  const scene = buildScene(asteroid);
  ensureSceneMiningState(scene);
  const initialState = getMineableState(scene, asteroid.itemID);
  assert.ok(initialState);

  const depletedAtMs = 1_000;
  const update = updateMineableState(scene, asteroid, {
    ...initialState,
    remainingQuantity: 0,
    updatedAtMs: depletedAtMs,
  }, {
    broadcast: false,
    respawnClockNowMs: depletedAtMs,
  });
  assert.equal(update.success, true);
  assert.equal(scene.getEntityByID(asteroid.itemID), null);
  assert.deepEqual(
    respawnDepletedMineables(
      scene,
      depletedAtMs + DEPLETED_MINEABLE_RESPAWN_DELAY_MS - 1,
    ),
    [],
  );

  const respawned = respawnDepletedMineables(
    scene,
    depletedAtMs + DEPLETED_MINEABLE_RESPAWN_DELAY_MS,
  );
  assert.equal(respawned.length, 1);
  assert.equal(respawned[0].itemID, asteroid.itemID);
  assert.equal(
    getMineableState(scene, asteroid.itemID).remainingQuantity,
    initialState.originalQuantity,
  );
  assert.deepEqual(scene.broadcasts, [[asteroid.itemID]]);
});

test("a Crude Matter prop is mineable but does not own the Rift respawn clock", () => {
  const resourceProp = {
    kind: "riftEnvironmentProp",
    itemID: 7_000_000_000_001,
    typeID: 92394,
    groupID: 4593,
    categoryID: 2,
    itemName: "Fine Young Crude Matter",
    radius: 280,
    resourceQuantity: 1_000,
    frontierRiftResource: true,
    frontierRiftSiteID: 9_200_000_000,
  };
  const scene = buildScene(resourceProp);
  ensureSceneMiningState(scene);
  const state = getMineableState(scene, resourceProp.itemID);
  assert.equal(state.originalQuantity, 1_000);
  assert.equal(state.remainingQuantity, 1_000);
  assert.equal(_testing.shouldRespawnDepletedMineable(resourceProp), false);
  assert.equal(_testing.getDepletedMineableRespawnAtMs(resourceProp, {
    remainingQuantity: 0,
    depletedAtMs: 1_000,
  }), 0);
});
