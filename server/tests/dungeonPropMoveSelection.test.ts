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
  const notifications: any[] = [];
  const session = {
    accountRole: ROLE_GML,
    _space: { systemID: 30000142 },
    sendNotification: (...args) => notifications.push(args),
  };
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
  return { session, ship, root, prop, scene, options, request, notifications };
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
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0][0], "OnDungeonPropMovePreview");
  assert.equal(fixture.notifications[0][1], "clientID");
  assert.deepEqual(fixture.notifications[0][2][0].position, [15_000, 0, 0]);
  assert.equal(fixture.notifications[0][2][0].graphicID, fixture.prop.graphicID);
  assert.equal(fixture.notifications[0][2][0].active, true);
  assert.equal(executeDungeonPropMoveCommand(
    fixture.session, "clear", {},
  ).success, true);
  assert.equal(fixture.notifications[1][2][0].active, false);
  assert.equal(executeDungeonPropMoveCommand(
    fixture.session,
    `preview ${fixture.prop.itemID} Infinity 0 0`,
    { spaceRuntime: { getSceneForSession: () => fixture.scene } },
  ).success, false);
});

test("denied previews clear stale holograms and do not create a new one", () => {
  const fixture = buildFixture();
  fixture.session.accountRole = 0n;
  const result = executeDungeonPropMoveCommand(
    fixture.session,
    `preview ${fixture.prop.itemID} 15000 0 0`,
    { spaceRuntime: { getSceneForSession: () => fixture.scene }, selectionOptions: fixture.options },
  );
  assert.equal(result.success, false);
  assert.deepEqual(fixture.notifications, [[
    "OnDungeonPropMovePreview", "clientID", [{ active: false }],
  ]]);
});

test("preview reports a notification failure without moving the prop", () => {
  const fixture = buildFixture();
  fixture.session.sendNotification = () => { throw new Error("disconnected"); };
  const result = executeDungeonPropMoveCommand(
    fixture.session,
    `preview ${fixture.prop.itemID} 15000 0 0`,
    { spaceRuntime: { getSceneForSession: () => fixture.scene }, selectionOptions: fixture.options },
  );
  assert.equal(result.success, false);
  assert.match(result.message, /could not be sent/i);
  assert.deepEqual(fixture.prop.position, { x: 0, y: 0, z: 0 });
});

test("detach command delegates one entity and clears its hologram", () => {
  const fixture = buildFixture();
  const calls: any[] = [];
  const result = executeDungeonPropMoveCommand(
    fixture.session,
    `detach ${fixture.prop.itemID}`,
    {
      spaceRuntime: { getSceneForSession: () => fixture.scene },
      detachment: {
        detachDungeonProp: (...args) => {
          calls.push(args);
          return { success: true, data: { worldEntityID: 8_600_000_000_000_000 } };
        },
      },
    },
  );
  assert.equal(result.success, true);
  assert.equal(calls[0][0], fixture.scene);
  assert.equal(calls[0][2], fixture.prop.itemID);
  assert.deepEqual(fixture.notifications, [[
    "OnDungeonPropMovePreview", "clientID", [{ active: false }],
  ]]);
});

test("move command validates the requested pose before detaching and starting motion", () => {
  const fixture = buildFixture();
  const calls: string[] = [];
  const worldEntityID = 8_600_000_000_000_000;
  const options = {
    spaceRuntime: { getSceneForSession: () => fixture.scene },
    selectionOptions: fixture.options,
    detachment: {
      detachDungeonProp: () => {
        calls.push("detach");
        return { success: true, data: { worldEntityID } };
      },
    },
    movement: {
      startDetachedPropMove: (_scene, _session, id, destination) => {
        calls.push("move");
        assert.equal(id, worldEntityID);
        assert.deepEqual(destination, { x: 15_000, y: 0, z: 0 });
        return { success: true, data: { worldEntityID } };
      },
    },
  };
  const denied = executeDungeonPropMoveCommand(
    fixture.session, `move ${fixture.prop.itemID} 200000 0 0`, options,
  );
  assert.equal(denied.success, false);
  assert.deepEqual(calls, []);
  const accepted = executeDungeonPropMoveCommand(
    fixture.session, `move ${fixture.prop.itemID} 15000 0 0`, options,
  );
  assert.equal(accepted.success, true);
  assert.deepEqual(calls, ["detach", "move"]);
});
