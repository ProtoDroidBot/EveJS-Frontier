"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const asteroidService = require("../src/space/asteroids/asteroidService");
const miningRuntimeState = require("../src/services/mining/miningRuntimeState");
const destiny = require("../src/space/destiny");
const { getEntitySurfaceDistance } = require("../src/space/destiny/projection/range");

const shellTypeIDs = Array.from({ length: 15 }, (_, index) => 64_063 + index);
const shellRecords = shellTypeIDs.map((typeID, index) => ({
  typeID,
  name: `Asteroid shell ${index + 1}`,
  groupID: 1_975,
  categoryID: 2,
  graphicID: 26_271,
  radius: index === 0 ? 350 : index === 14 ? 135 : 750,
}));
const oreRecord = {
  typeID: 78_429,
  name: "Deep-Core Carbon Ore",
  groupID: 4_611,
  categoryID: 25,
  graphicID: null,
  radius: 1,
  volume: 1,
};

test("generated asteroid keeps its shell on the ball and ore identity in the slim item", (t) => {
  itemTypeRegistry._setEntriesForTests([...shellRecords, oreRecord]);
  t.after(() => itemTypeRegistry._setEntriesForTests(null));

  const belt = {
    itemID: 40_000_001,
    position: { x: 0, y: 0, z: 0 },
    itemName: "Outer-Belt Asteroid Field",
    frontierLandscapeSite: true,
    fieldStyleID: "frontier_outer_resource_field",
  };
  const entity = asteroidService._testing.buildSystemOreAsteroidEntity(
    { systemID: 30_000_142 },
    belt,
    0,
    1,
    {},
    () => 0.5,
    [oreRecord],
    [{ x: 0, y: 0, z: 0 }],
  );
  const shellRecord = shellRecords.find((record) => record.typeID === entity.typeID);
  assert.ok(shellRecord);
  assert.equal(entity.radius, asteroidService._testing.resolveGeneratedOreAsteroidRadius(shellRecord));
  assert.ok(entity.radius >= 35 && entity.radius <= 200);
  assert.equal(entity.miningBaseRadius, entity.radius);
  assert.equal(entity.graphicID, shellRecord.graphicID);
  assert.equal(entity.slimTypeID, oreRecord.typeID);
  assert.equal(entity.miningYieldTypeID, oreRecord.typeID);

  const slimFields = Object.fromEntries(destiny.buildSlimItemDict(entity).entries);
  assert.equal(slimFields.typeID, oreRecord.typeID);
  assert.equal(slimFields.graphicID, undefined);
  assert.ok(getEntitySurfaceDistance({
    position: { ...entity.position, x: entity.position.x + 300 },
    radius: 60,
  }, entity) > 0);
});

test("existing mined quantity survives the smaller generated asteroid radius", (t) => {
  itemTypeRegistry._setEntriesForTests([...shellRecords, oreRecord]);
  t.after(() => itemTypeRegistry._setEntriesForTests(null));

  const entity = {
    kind: "asteroid",
    generatedAsteroid: true,
    itemID: 5_000_000_100_001,
    typeID: 64_063,
    visualTypeID: 64_063,
    slimTypeID: oreRecord.typeID,
    miningPresentationTypeID: oreRecord.typeID,
    miningYieldTypeID: oreRecord.typeID,
    skipMiningTemplateResolution: true,
    beltID: 40_000_001,
    fieldStyleID: "frontier_outer_resource_field",
    radius: 87.5,
    miningBaseRadius: 87.5,
    suppressSlimGraphicID: true,
  };
  const previousState = {
    entityID: entity.itemID,
    visualTypeID: entity.typeID,
    yieldTypeID: oreRecord.typeID,
    beltID: entity.beltID,
    fieldStyleID: entity.fieldStyleID,
    originalQuantity: 15_000,
    remainingQuantity: 7_500,
    originalRadius: 500,
  };
  const state = miningRuntimeState._testing.buildMineableState(
    { systemID: 30_000_142 }, entity, previousState,
  );
  assert.ok(state);
  assert.equal(state.remainingQuantity, 7_500);
  assert.equal(state.originalRadius, 87.5);
  miningRuntimeState._testing.applyYieldPresentationToEntity(entity, state);
  assert.ok(entity.radius <= 87.5);
  assert.equal(Object.fromEntries(destiny.buildSlimItemDict(entity).entries).graphicID, undefined);
});
