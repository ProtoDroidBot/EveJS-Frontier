"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
const {
  validateDungeonPropMovePreview,
} = require("../src/services/dungeon/dungeonPropMoveSelection");
const {
  executeDungeonPropMoveCommand,
} = require("../src/services/chat/dungeonPropMoveCommand");

function buildFixture(): any {
  const session = { accountRole: ROLE_GML, _space: { systemID: 30000142 } };
  const ship = {
    itemID: 900,
    kind: "ship",
    position: { x: 1_000, y: 0, z: 0 },
    dungeonCurrentInstanceID: 42,
  };
  const root = { itemID: 700, dungeonSiteInstanceID: 42 };
  const prop = {
    itemID: 6_400_000_070_001,
    kind: "siteEnvironmentProp",
    dungeonMaterializedSiteContent: true,
    dungeonMaterializedEnvironment: true,
    dungeonSiteID: 700,
    dungeonSiteInstanceID: 42,
    typeID: 1234,
    graphicID: 5678,
    position: { x: 0, y: 0, z: 0 },
    radius: 100,
    dunRotation: [10, 20, 30],
  };
  const scene = {
    systemID: 30000142,
    staticEntitiesByID: new Map([[root.itemID, root], [prop.itemID, prop]]),
    getShipEntityForSession: () => ship,
    canSessionSeeDungeonScopedEntity: () => true,
  };
  const options = {
    getInstance: () => ({
      instanceID: 42,
      lifecycleState: "active",
      solarSystemID: 30000142,
      metadata: { siteID: 700 },
    }),
  };
  const request = {
    entityID: prop.itemID,
    destinationPosition: { x: 15_000, y: 0, z: 0 },
  };
  return { session, ship, root, prop, scene, options, request };
}

test("a GM can preview one passive prop without changing the scene", () => {
  const fixture = buildFixture();
  const previousProp = structuredClone(fixture.prop);
  const result = validateDungeonPropMovePreview(
    fixture.scene,
    fixture.session,
    fixture.request,
    fixture.options,
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.data.destinationPosition, { x: 15_000, y: 0, z: 0 });
  assert.deepEqual(result.data.rotation, [10, 20, 30]);
  assert.equal(fixture.scene.staticEntitiesByID.get(fixture.prop.itemID), fixture.prop);
  assert.deepEqual(fixture.prop, previousProp);
});

test("preview denies gameplay props and wrong dungeon scope", () => {
  const fixture = buildFixture();
  fixture.prop.frontierDungeonResource = true;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "PROP_NOT_MOVABLE");
  fixture.prop.frontierDungeonResource = false;
  fixture.prop.component_linkWithShip = [null, 1, null, null];
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "PROP_NOT_MOVABLE");
  delete fixture.prop.component_linkWithShip;
  fixture.prop.dungeonSiteContentTrigger = "on_room_active";
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "PROP_NOT_MOVABLE");
  delete fixture.prop.dungeonSiteContentTrigger;
  fixture.ship.dungeonCurrentInstanceID = 43;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "WRONG_DUNGEON_INSTANCE");
});

test("preview denies unprivileged, stale, hidden, distant, and invalid requests", () => {
  const fixture = buildFixture();
  fixture.session.accountRole = 0n;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "GM_ROLE_REQUIRED");
  fixture.session.accountRole = ROLE_GML;
  fixture.options.getInstance = () => ({
    lifecycleState: "completed", solarSystemID: fixture.scene.systemID,
    metadata: { siteID: 700 },
  });
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "SITE_NOT_ACTIVE");
  fixture.options = buildFixture().options;
  fixture.scene.canSessionSeeDungeonScopedEntity = () => false;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "PROP_NOT_VISIBLE");
  fixture.scene.canSessionSeeDungeonScopedEntity = () => true;
  fixture.ship.position.x = 100_000;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "PROP_OUT_OF_RANGE");
  fixture.ship.position.x = 1_000;
  fixture.request.destinationPosition.x = Number.NaN;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "INVALID_DESTINATION");
  fixture.request.destinationPosition.x = 100_001;
  assert.equal(validateDungeonPropMovePreview(
    fixture.scene, fixture.session, fixture.request, fixture.options,
  ).errorMsg, "DESTINATION_OUT_OF_RANGE");
});

test("the preview command parses an entity and pose but never moves it", () => {
  const fixture = buildFixture();
  const result = executeDungeonPropMoveCommand(
    fixture.session,
    `preview ${fixture.prop.itemID} 15000 0 0 1 2 3`,
    {
      spaceRuntime: { getSceneForSession: () => fixture.scene },
      selectionOptions: fixture.options,
    },
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.data.rotation, [1, 2, 3]);
  assert.match(result.message, /no prop was moved/i);
  assert.deepEqual(fixture.prop.position, { x: 0, y: 0, z: 0 });
  assert.equal(executeDungeonPropMoveCommand(
    fixture.session,
    `preview ${fixture.prop.itemID} Infinity 0 0`,
    { spaceRuntime: { getSceneForSession: () => fixture.scene } },
  ).success, false);
});
