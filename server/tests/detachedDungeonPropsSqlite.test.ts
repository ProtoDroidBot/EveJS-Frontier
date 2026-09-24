"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("detached prop and suppression key reach SQLite before scene mutation", {
  skip: process.env.EVEJS_TEST_STORE_ISOLATED !== "1",
}, () => {
  const Database = require("better-sqlite3");
  const { createDetachedDungeonPropStore } = require("../src/space/detachedDungeonProps");
  const store = createDetachedDungeonPropStore();
  const source = {
    itemID: 6_400_000_070_001,
    typeID: 1234,
    graphicID: 5678,
    position: { x: 1, y: 2, z: 3 },
    radius: 10,
    dunRotation: [0, 45, 0],
  };
  const identity = {
    systemID: 30000142,
    instanceID: 42,
    siteID: 700,
    entityID: source.itemID,
  };
  const result = store.detach(source, identity);
  assert.equal(result.success, true);
  const database = new Database(path.join(process.env.EVEJS_TEST_STORE_ROOT, "gamestore.sqlite"), {
    readonly: true,
  });
  try {
    const rows = database.prepare('SELECT key, json FROM "detachedDungeonProps"').all();
    assert.ok(rows.some((row) => String(row.json).includes(String(result.data.worldEntityID))));
  } finally {
    database.close();
  }
  assert.deepEqual([...store.suppressedSourceIDs(30000142, 42, 700)], [source.itemID]);
  const runtime = require("../src/space/runtime");
  const scene = runtime.ensureScene(30000142, {
    deferBootstrap: true,
    refreshStargates: false,
  });
  const world = scene.staticEntitiesByID.get(result.data.worldEntityID);
  assert.equal(world.kind, "detachedDungeonProp");
  const bubbleID = world.bubbleID;
  const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
  const { startDetachedPropMove, tickDetachedPropMove } =
    require("../src/space/dungeonPropMovement");
  const { encodeEntityBall } = require("../src/space/destiny/stream/ballEncoding");
  const session = {
    accountRole: ROLE_GML,
    _space: { systemID: 30000142, initialStateSent: true },
    socket: { destroyed: false },
  };
  const observer = {
    _space: { systemID: 30000142, initialStateSent: true },
    socket: { destroyed: false },
  };
  const outside = {
    _space: { systemID: 30000142, initialStateSent: true },
    socket: { destroyed: false },
  };
  scene.getShipEntityForSession = (viewer) => {
    const currentBubbleID = scene.dynamicEntities.get(result.data.worldEntityID)?.bubbleID ||
      scene.staticEntitiesByID.get(result.data.worldEntityID)?.bubbleID || bubbleID;
    return {
      itemID: viewer === observer ? 901 : viewer === outside ? 902 : 900,
      typeID: 100,
      position: { x: 0, y: 0, z: 0 },
      bubbleID: viewer === outside ? currentBubbleID + 1 : currentBubbleID,
    };
  };
  assert.equal(scene.canSessionSeeStaticEntityForSession(observer, world), true);
  assert.equal(scene.canSessionSeeStaticEntityForSession(outside, world), false);
  const fxDeliveries: any[] = [];
  const originalAddBalls = scene.broadcastAddBalls;
  const originalSendDestinyUpdates = scene.sendDestinyUpdates;
  scene.broadcastAddBalls = () => [];
  scene.sendDestinyUpdates = (viewer, updates) => {
    for (const update of updates) {
      if (update.payload?.[0] === "OnSpecialFX") fxDeliveries.push({ viewer, update });
    }
  };
  scene.sessions.set("gm", session);
  scene.sessions.set("observer", observer);
  scene.sessions.set("outside", outside);
  assert.deepEqual(scene.getSessionsInBubble(bubbleID), [session, observer]);
  const started = startDetachedPropMove(
    scene, session, result.data.worldEntityID, { x: 1_001, y: 2, z: 3 },
    { store, nowMs: scene.getCurrentSimTimeMs() },
  );
  scene.sessions.clear();
  scene.broadcastAddBalls = originalAddBalls;
  scene.sendDestinyUpdates = originalSendDestinyUpdates;
  assert.equal(started.success, true);
  assert.equal(fxDeliveries.some((delivery) => delivery.viewer === observer), true);
  assert.equal(fxDeliveries.some((delivery) => delivery.viewer === outside), false);
  assert.equal(fxDeliveries.every((delivery) =>
    delivery.update.payload[1][3] === result.data.worldEntityID), true);
  const moving = scene.dynamicEntities.get(result.data.worldEntityID);
  assert.equal(moving.destinyForceFree, true);
  assert.ok(Buffer.isBuffer(encodeEntityBall(moving)));
  assert.equal(scene.staticEntitiesByID.has(result.data.worldEntityID), false);
  for (let tick = 0; tick < 5 && scene.dynamicEntities.has(result.data.worldEntityID); tick += 1) {
    const stepped = tickDetachedPropMove(
      scene, scene.dynamicEntities.get(result.data.worldEntityID), 1,
      scene.getCurrentSimTimeMs() + (tick + 1) * 1_000,
      { store },
    );
    assert.equal(stepped.success, true);
  }
  assert.equal(scene.dynamicEntities.has(result.data.worldEntityID), false);
  assert.deepEqual(scene.staticEntitiesByID.get(result.data.worldEntityID).position,
    { x: 1_001, y: 2, z: 3 });
  assert.deepEqual(store.getByWorldID(30000142, result.data.worldEntityID).worldEntity.position,
    { x: 1_001, y: 2, z: 3 });
  assert.equal(startDetachedPropMove(
    scene, session, result.data.worldEntityID, { x: 2_001, y: 2, z: 3 },
    { store, nowMs: scene.getCurrentSimTimeMs() },
  ).success, true);
  scene.tick(scene.lastWallclockTickAt + 1_000);
  assert.ok(store.getByWorldID(30000142, result.data.worldEntityID).worldEntity.position.x > 1_001);
});
