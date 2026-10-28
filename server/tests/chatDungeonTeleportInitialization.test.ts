"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const chatCommands = require("../src/services/chat/chatCommands");
const chatHub = require("../src/services/chat/chatHub");
const SlashService = require("../src/services/admin/slashService");
const spaceRuntime = require("../src/space/runtime");

const {
  buildTransportPointAnchor,
  executeSessionTransportTarget,
  findTransportDestinationDungeonIdentity,
  initializeTransportDestinationDungeon,
} = chatCommands._testing;

test("transport anchors preserve a player's active dungeon identity", () => {
  const anchor = buildTransportPointAnchor({
    itemID: 9_000_000_001,
    systemID: 30_000_142,
    position: { x: 10, y: 20, z: 30 },
    direction: { x: 0, y: 1, z: 0 },
    dungeonCurrentInstanceID: 7_100_000_000_001,
    dungeonCurrentRoomKey: "room:2",
    dungeonCurrentSiteID: 7_200_000_000_001,
  });

  assert.equal(anchor.destinationStaticInstanceID, 7_100_000_000_001);
  assert.equal(anchor.destinationDungeonRoomKey, "room:2");
  assert.equal(anchor.destinationDungeonSiteID, 7_200_000_000_001);
});

test("coordinate transport resolves a nearby dungeon anchor for initialization", () => {
  const scene = {
    staticEntities: [{
      itemID: 7_200_000_000_002,
      position: { x: 0, y: 0, z: 0 },
      dungeonSiteInstanceID: 7_100_000_000_002,
      dungeonSiteID: 7_200_000_000_002,
    }],
  };
  const identity = findTransportDestinationDungeonIdentity(scene, {
    kind: "point",
    point: { x: 30_000_000, y: 0, z: 0 },
  });

  assert.deepEqual(identity, {
    instanceID: 7_100_000_000_002,
    roomKey: "room:entry",
    siteID: 7_200_000_000_002,
  });
});

test("transport dungeon initialization materializes encounters before room tracking changes", () => {
  const calls: any[] = [];
  const session = { characterID: 140_000_001 };
  const destination = {
    kind: "point",
    point: { x: 1_000, y: 2_000, z: 3_000 },
    destinationStaticInstanceID: 7_100_000_000_003,
    destinationDungeonRoomKey: "room:entry",
    destinationDungeonSiteID: 7_200_000_000_003,
  };
  const result = initializeTransportDestinationDungeon(
    { staticEntities: [] },
    destination,
    session,
    {
      dependencies: {
        dungeonService: {
          ensureSiteContentsMaterialized(scene, instance, options) {
            calls.push({ kind: "universe", scene, instance, options });
            return { success: true, data: { instanceID: instance.instanceID } };
          },
        },
        landscapeSceneService: {
          materializeNearbyLandscapeSites(scene, anchor, options) {
            calls.push({ kind: "landscape", scene, anchor, options });
            return null;
          },
        },
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.data.initialized, true);
  assert.equal(calls[0].kind, "universe");
  assert.equal(calls[0].instance.instanceID, 7_100_000_000_003);
  assert.equal(calls[0].instance.siteID, 7_200_000_000_003);
  assert.equal(calls[0].options.markCurrentDungeonRoom, false);
  assert.equal(calls[0].options.resyncSession, false);
  assert.equal(calls[0].options.roomKey, "room:entry");
  assert.equal(calls[0].options.session, session);
  assert.deepEqual(calls[0].options.roomPosition, destination.point);
});

test("session transport initializes a dungeon before teleporting the ship", async () => {
  const originalGetSceneForSession = spaceRuntime.getSceneForSession;
  const originalTeleportSessionShipToPoint = spaceRuntime.teleportSessionShipToPoint;
  const order: string[] = [];
  const scene = {
    staticEntities: [],
    commitAcceptedPilotWarpDungeonContext(_entity, options) {
      order.push("context");
      assert.equal(options.destinationStaticInstanceID, 7_100_000_000_004);
      assert.equal(options.destinationDungeonRoomKey, "room:2");
    },
    requestFinalSceneVisibilityReconciliation() {
      order.push("reconcile");
    },
  };
  const session = {
    characterID: 140_000_002,
    solarsystemid2: 30_000_142,
    _space: { shipID: 9_000_000_002 },
  };
  const destination = {
    kind: "point",
    systemID: 30_000_142,
    point: { x: 4_000, y: 5_000, z: 6_000 },
    direction: { x: 1, y: 0, z: 0 },
    destinationStaticInstanceID: 7_100_000_000_004,
    destinationDungeonRoomKey: "room:2",
    destinationDungeonSiteID: 7_200_000_000_004,
    label: "test dungeon",
  };

  spaceRuntime.getSceneForSession = () => scene;
  spaceRuntime.teleportSessionShipToPoint = (_session, point) => {
    order.push("teleport");
    assert.deepEqual(point, destination.point);
    return { success: true };
  };

  try {
    const result = await executeSessionTransportTarget(
      session,
      { kind: "session", session, label: "me" },
      destination,
      null,
      {
        emitChatFeedback: false,
        transportDungeonInitializationDependencies: {
          dungeonService: {
            ensureSiteContentsMaterialized() {
              order.push("initialize");
              return { success: true };
            },
          },
          landscapeSceneService: {
            materializeNearbyLandscapeSites() {
              return null;
            },
          },
        },
      },
    );

    assert.equal(result.handled, true);
    assert.deepEqual(order, ["initialize", "teleport", "context", "reconcile"]);
  } finally {
    spaceRuntime.getSceneForSession = originalGetSceneForSession;
    spaceRuntime.teleportSessionShipToPoint = originalTeleportSessionShipToPoint;
  }
});

test("repeated slash transports follow a moving NPC and return one success message", async (t) => {
  const shipID = 9_000_000_002;
  const npcID = 980_000_000_000;
  const ship = { itemID: shipID, kind: "ship", systemID: 30_000_142,
    position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, radius: 13.5 };
  const npc = { itemID: npcID, kind: "ship", systemID: 30_000_142,
    position: { x: 100_000, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, radius: 13.5 };
  const entities = new Map([[shipID, ship], [npcID, npc]]);
  const scene = { systemID: 30_000_142, staticEntities: [], dynamicEntities: entities,
    getEntityByID: (id) => entities.get(id) || null };
  const session = { characterID: 140_000_002, solarsystemid2: scene.systemID,
    _space: { shipID, systemID: scene.systemID } };
  const messages: string[] = [];
  t.mock.method(spaceRuntime, "getSceneForSession", () => scene);
  t.mock.method(spaceRuntime, "getEntity", (_session, id) => entities.get(id) || null);
  t.mock.method(spaceRuntime, "teleportSessionShipToPoint", (_session, point) => {
    ship.position = { ...point };
    return { success: true, data: { entity: ship } };
  });
  t.mock.method(require("../src/space/frontierLandscapeSceneService"),
    "materializeNearbyLandscapeSites", () => null);
  t.mock.method(chatHub, "sendSystemMessage", (_session, message) => messages.push(message));
  const slash = new SlashService();

  const first = await slash.callMethod("SlashCmd", [`/tr me ${npcID}`], session, null);
  assert.match(first, /Transported me to ship 980000000000/u);
  assert.deepEqual(ship.position, { x: 97_500, y: 0, z: 0 });
  npc.position = { x: 200_000, y: 0, z: 0 };
  const second = await slash.callMethod("SlashCmd", [`/tr me ${npcID}`], session, null);
  assert.match(second, /Transported me to ship 980000000000/u);
  assert.deepEqual(ship.position, { x: 197_500, y: 0, z: 0 });
  assert.deepEqual(messages, [first, second]);

  const explicitOffset = await slash.callMethod("SlashCmd",
    [`/tr me ${npcID} offset=0,0,100`], session, null);
  assert.match(explicitOffset, /Transported me to ship 980000000000/u);
  assert.deepEqual(ship.position, { x: 200_000, y: 0, z: 100 });
  assert.equal(messages.length, 3);
});
