"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { marshalEncode } = require("../src/network/tcp/utils/marshal");
const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
const {
  createDetachedDungeonPropStore,
  WORLD_ID_BASE,
} = require("../src/space/detachedDungeonProps");
const {
  detachDungeonProp,
  reconcileDetachedProp,
  restoreDetachedPropsToScene,
} = require("../src/space/dungeonPropDetachment");
const {
  startDetachedPropMove,
  findMovingPropProfileCollision,
  stopDetachedPropMove,
  tickDetachedPropMove,
} = require("../src/space/dungeonPropMovement");
const collisions = require("../src/space/destiny/simulation/collisions");
const {
  resolveEntityCollisionPresentation,
  setDefaultCollisionBundleForTesting,
  resetDefaultCollisionBundleForTesting,
} = require("../src/space/destiny/collision/collisionBundle");
const { BALL_FLAG, BALL_MODE } = require("../src/space/destiny/constants");
const { debugDescribeEntityBall, encodeEntityBall } = require("../src/space/destiny/stream/ballEncoding");
const { getStaticBallFlags, resolveStaticBallTail } = require("../src/space/destiny/stream/staticBallTail");
const { _testing: siteContent } = require("../src/services/dungeon/dungeonUniverseSiteService");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
const { pickupPhysicsGunTarget } = require("../src/space/physicsGunPickup");
const { releaseDetachedPropTether, updateDetachedPropTether } = require("../src/space/dungeonPropMovement");

function memoryBackend() {
  let cache: any = {};
  let durable: any = {};
  let failNextFlush = false;
  const events: any[] = [];
  return {
    events,
    ensureTable: () => true,
    read: () => ({ success: true, data: structuredClone(cache) }),
    write: (_table, _path, value) => {
      events.push("write");
      cache = structuredClone(value);
      return { success: true };
    },
    flushTableSync: () => {
      events.push("flush");
      if (failNextFlush) {
        failNextFlush = false;
        return { success: false };
      }
      durable = structuredClone(cache);
      return { success: true };
    },
    failFlushOnce: () => { failNextFlush = true; },
    restart: () => { cache = structuredClone(durable); },
    durable: () => structuredClone(durable),
  };
}

function fixture() {
  const session: any = {
    accountRole: ROLE_GML,
    _space: { systemID: 30000142 },
  };
  const ship: any = {
    itemID: 900,
    typeID: 100,
    bubbleID: 5,
    position: { x: 1000, y: 0, z: 0 },
    dungeonCurrentInstanceID: 42,
  };
  const site = {
    itemID: 700,
    dungeonSiteInstanceID: 42,
    position: { x: 0, y: 0, z: 0 },
  };
  const prop: any = {
    itemID: 6_400_000_070_001,
    kind: "siteEnvironmentProp",
    dungeonMaterializedSiteContent: true,
    dungeonMaterializedEnvironment: true,
    dungeonSiteID: 700,
    dungeonSiteInstanceID: 42,
    typeID: 1234,
    groupID: 12,
    graphicID: 5678,
    itemName: "Ruined tower",
    position: { x: 0, y: 0, z: 0 },
    radius: 100,
    collisionScale: 1.5,
    dunRotation: [10, 20, 30],
    destinyCollisionTail: Buffer.from([1, 2, 3]),
  };
  const events: any[] = [];
  const scene: any = {
    systemID: 30000142,
    staticEntitiesByID: new Map([[site.itemID, site], [prop.itemID, prop]]),
    dynamicEntities: new Map(),
    get staticEntities() { return [...this.staticEntitiesByID.values()]; },
    getShipEntityForSession: () => ship,
    canSessionSeeDungeonScopedEntity: () => true,
    removeStaticEntity: (id) => {
      events.push("remove");
      const entity = scene.staticEntitiesByID.get(id);
      if (!entity) return { success: false };
      scene.staticEntitiesByID.delete(id);
      return { success: true, data: { entity } };
    },
    addStaticEntity: (entity) => {
      events.push("add");
      if (scene.staticEntitiesByID.has(entity.itemID)) return false;
      entity.bubbleID = 5;
      scene.staticEntitiesByID.set(entity.itemID, entity);
      return true;
    },
    broadcastAddBalls: (entities) => events.push(`broadcast:${entities.length}`),
    spawnDynamicEntity: (entity) => {
      events.push("spawn-dynamic");
      entity.bubbleID = 5;
      scene.dynamicEntities.set(entity.itemID, entity);
      return { success: true };
    },
    removeDynamicEntity: (id) => {
      events.push("remove-dynamic");
      scene.dynamicEntities.delete(id);
      return { success: true };
    },
    getCurrentSimTimeMs: () => 1_000,
    getNextDestinyStamp: () => 10,
    broadcastDestinyUpdatesToBubble: (_bubble, updates) => {
      for (const update of updates) events.push(update.payload);
    },
    broadcastBallRefresh: () => events.push("refresh"),
    reconcileEntityPublicGrid: () => {},
    reconcileEntityBubble: () => {},
  };
  const selectionOptions = {
    getInstance: () => ({
      lifecycleState: "active",
      solarSystemID: 30000142,
      metadata: { siteID: 700 },
    }),
  };
  return { session, ship, site, prop, scene, events, selectionOptions };
}

test("detachment flushes first, replaces the source, and survives restart", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const result = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.worldEntityID, WORLD_ID_BASE);
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), false);
  const world = value.scene.staticEntitiesByID.get(WORLD_ID_BASE);
  assert.equal(world.kind, "detachedDungeonProp");
  assert.deepEqual(world.position, value.prop.position);
  assert.deepEqual(world.dunRotation, [10, 20, 30]);
  assert.equal(world.collisionScale, 1.5);
  assert.equal(world.graphicID, 5678);
  assert.deepEqual(resolveStaticBallTail(world).tail, Buffer.from([1, 2, 3]));
  assert.equal(collisions.isEntityCollisionEnabled(world), true);
  assert.equal(collisions.isEntityCollisionMover(world), false);
  assert.equal(Object.keys(world).some((key) => key.startsWith("dungeon")), false);
  assert.deepEqual(backend.events.slice(0, 2), ["write", "flush"]);
  assert.deepEqual(value.events.slice(0, 2), ["remove", "add"]);
  backend.restart();
  const restoredStore = createDetachedDungeonPropStore({ store: backend });
  assert.deepEqual([...restoredStore.suppressedSourceIDs(30000142, 42, 700)], [value.prop.itemID]);
  const restarted = fixture();
  const replay = restoreDetachedPropsToScene(restarted.scene, { store: restoredStore });
  assert.equal(replay.success, true);
  assert.equal(restarted.scene.staticEntitiesByID.has(value.prop.itemID), false);
  assert.equal(restarted.scene.staticEntitiesByID.has(WORLD_ID_BASE), true);
  assert.deepEqual(
    resolveStaticBallTail(restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE)).tail,
    Buffer.from([1, 2, 3]),
  );
  assert.equal(restoreDetachedPropsToScene(restarted.scene, { store: restoredStore }).restored, 1);
  assert.equal(restarted.scene.staticEntitiesByID.size, 2);
});

test("Physics Gun lifts a mineable asteroid, checkpoints motion, and release persists its pose", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  value.prop.kind = "asteroid";
  value.prop.position = { x: 2_500, y: 0, z: 0 };
  value.prop.radius = 60;
  value.prop.collisionRadius = 85;
  delete value.prop.dungeonSiteID;
  delete value.prop.dungeonSiteInstanceID;
  delete value.prop.dungeonMaterializedSiteContent;
  delete value.prop.dungeonMaterializedEnvironment;
  const miningCalls: any[] = [];
  const resource = { entityID: value.prop.itemID, yieldTypeID: 1234,
    yieldKind: "ore", originalQuantity: 300, remainingQuantity: 175, unitVolume: 0.1 };
  const mining = {
    getMineableState: (_scene, id) => {
      miningCalls.push(id);
      return id === value.prop.itemID ? resource : null;
    },
    clearMineableState: (_scene, id) => miningCalls.push(`clear:${id}`),
  };
  const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: 1, y: 0, z: 0 }, { store, miningState: mining, nowMs: 1_000 });
  assert.equal(picked.success, true, picked.errorMsg);
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), false);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  assert.equal(value.scene.dynamicEntities.get(WORLD_ID_BASE).collisionRadius, 85);
  assert.deepEqual([...value.scene._detachedWorldSourceIDs], [value.prop.itemID]);
  assert.equal(store.getByWorldID(value.scene.systemID, WORLD_ID_BASE)
    .worldEntity.physicsGunMineableState.remainingQuantity, 175);
  assert.equal(store.getByWorldID(value.scene.systemID, WORLD_ID_BASE)
    .worldEntity.physicsGunMineableState.entityID, WORLD_ID_BASE);
  assert.deepEqual(miningCalls, [value.prop.itemID, `clear:${value.prop.itemID}`, WORLD_ID_BASE]);
  assert.equal(updateDetachedPropTether(value.scene, WORLD_ID_BASE, value.session,
    901, { x: 0, y: 1, z: 0 }), true);
  const moving = value.scene.dynamicEntities.get(WORLD_ID_BASE);
  assert.equal(releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 902, { store }).success, false);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  const moved = tickDetachedPropMove(value.scene, moving, 0.5, 1_500, { store });
  assert.equal(moved.success, true, moved.errorMsg);
  assert.ok(moving.position.x < 2_500);
  assert.equal(moving.targetPoint.y, 750);
  const dropped = releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 901, { store, nowMs: 1_600 });
  assert.equal(dropped.success, true, dropped.errorMsg);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), false);
  assert.deepEqual(value.scene.staticEntitiesByID.get(WORLD_ID_BASE).position, moving.position);
  backend.restart();
  const restarted = fixture();
  restarted.prop.kind = "asteroid";
  delete restarted.prop.dungeonSiteID;
  delete restarted.prop.dungeonSiteInstanceID;
  const replay = restoreDetachedPropsToScene(restarted.scene, {
    store: createDetachedDungeonPropStore({ store: backend }),
  });
  assert.equal(replay.success, true);
  assert.equal(restarted.scene.staticEntitiesByID.has(restarted.prop.itemID), false);
  assert.deepEqual(restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE).position,
    moving.position);
  assert.deepEqual([...restarted.scene._detachedWorldSourceIDs], [restarted.prop.itemID]);
});

test("Physics Gun moves a prop by the beam contact point as aim and ship move", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  value.prop.position = { x: 2_500, y: 0, z: 0 };
  const contactPoint = { x: 2_405, y: 31, z: 0 };
  const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: 1, y: 0, z: 0 }, {
      store, contactPoint, miningState: { isMineableStaticEntity: () => false },
      nowMs: 1_000,
    });
  assert.equal(picked.success, true, picked.errorMsg);
  const moving = value.scene.dynamicEntities.get(WORLD_ID_BASE);
  assert.deepEqual(moving.detachedPropMove.tether.contactOffset,
    { x: -95, y: 31, z: 0 });
  const scanStart = value.events.find((entry) =>
    Array.isArray(entry) && entry[0] === "OnSpecialFX");
  assert.ok(scanStart);
  assert.equal(scanStart[1][0], value.ship.itemID);
  assert.equal(scanStart[1][1], 901);
  assert.equal(scanStart[1][2], 99999);
  assert.equal(scanStart[1][3], WORLD_ID_BASE);
  const scanGraphicInfo = Object.fromEntries(scanStart[1][13].args.entries);
  assert.equal(scanGraphicInfo.targetBallID, WORLD_ID_BASE);
  assert.equal(scanGraphicInfo.resolvedTargetBallID, WORLD_ID_BASE);
  assert.deepEqual(scanGraphicInfo.targetOffset, [1_405, 31, 0]);
  assert.doesNotThrow(() => marshalEncode(scanStart,
    { compatibilityProfile: "frontier" }));
  assert.deepEqual(moving.targetPoint, { x: 1_845, y: -31, z: 0 });
  assert.deepEqual({
    x: moving.targetPoint.x - 95,
    y: moving.targetPoint.y + 31,
    z: moving.targetPoint.z,
  }, { x: 1_750, y: 0, z: 0 });
  assert.equal(tickDetachedPropMove(value.scene, moving, 0.1, 1_100, { store }).success, true);
  assert.ok(moving.position.x < 2_500);

  value.ship.position.y = 100;
  assert.equal(updateDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 901, { x: 0, y: 1, z: 0 }), true);
  assert.equal(tickDetachedPropMove(value.scene, moving, 0.1, 1_200, { store }).success, true);
  assert.deepEqual(moving.targetPoint, { x: 1_095, y: 819, z: 0 });
  assert.deepEqual({
    x: moving.targetPoint.x - 95,
    y: moving.targetPoint.y + 31,
    z: moving.targetPoint.z,
  }, { x: 1_000, y: 850, z: 0 });
  assert.equal(releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 901, { store, nowMs: 1_300 }).success, true);
  const scanStop = value.events.filter((entry) =>
    Array.isArray(entry) && entry[0] === "OnSpecialFX").at(-1);
  assert.equal(scanStop[1][1], 901);
  assert.equal(scanStop[1][3], WORLD_ID_BASE);
  assert.equal(scanStop[1][7], 0);
  assert.deepEqual(value.scene.staticEntitiesByID.get(WORLD_ID_BASE).position,
    moving.position);
  assert.deepEqual(store.getByWorldID(value.scene.systemID, WORLD_ID_BASE)
    .worldEntity.position, moving.position);
});

test("dropping a prop restores its authored collision ball and geometry after restart", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  delete value.prop.destinyCollisionTail;
  value.prop.destinyBallMode = "STOP";
  value.prop.destinyForceFree = true;
  value.prop.destinyBallFlags = BALL_FLAG.IS_FREE | BALL_FLAG.IS_INTERACTIVE;
  value.prop.collisionID = 4242;
  value.prop.convexCollisionID = 73;
  value.prop.surfaceType = 5;
  value.prop.miniBalls = [{ center: { x: 2, y: 3, z: 4 }, radius: 15 }];
  value.prop.miniCapsules = [{
    hemisphereA: { x: 0, y: 0, z: 0 },
    hemisphereB: { x: 1, y: 0, z: 0 }, radius: 3,
  }];
  value.prop.miniBoxes = [{
    corner: { x: 0, y: 0, z: 0 },
    localX: { x: 1, y: 0, z: 0 },
    localY: { x: 0, y: 1, z: 0 },
    localZ: { x: 0, y: 0, z: 1 },
  }];
  const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: -1, y: 0, z: 0 }, {
      store, miningState: { isMineableStaticEntity: () => false }, nowMs: 1_000,
    });
  assert.equal(picked.success, true, picked.errorMsg);
  const moving = value.scene.dynamicEntities.get(WORLD_ID_BASE);
  assert.equal(debugDescribeEntityBall(moving, { compatibilityProfile: "frontier" })
    .summary.flags.isFree, true);
  assert.equal(releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 901, { store, nowMs: 1_100 }).success, true);

  const dropped = value.scene.staticEntitiesByID.get(WORLD_ID_BASE);
  assert.equal(dropped.collisionStatic, true);
  assert.equal(dropped.destinyForceFree, false);
  assert.equal(dropped.destinyBallFlags & BALL_FLAG.IS_FREE, 0);
  assert.equal(dropped.destinyBallMode, "STOP");
  assert.equal(resolveEntityCollisionPresentation(dropped, null).collisionID, 4242);
  assert.equal(dropped.collisionScale, 1.5);
  assert.deepEqual(dropped.miniBalls, value.prop.miniBalls);
  assert.deepEqual(dropped.miniCapsules, value.prop.miniCapsules);
  assert.deepEqual(dropped.miniBoxes, value.prop.miniBoxes);
  assert.equal(getStaticBallFlags(dropped) & (BALL_FLAG.IS_MASSIVE |
    BALL_FLAG.HAS_MINIBALLS | BALL_FLAG.HAS_MINICAPSULES | BALL_FLAG.HAS_MINIBOXES),
  BALL_FLAG.IS_MASSIVE | BALL_FLAG.HAS_MINIBALLS |
    BALL_FLAG.HAS_MINICAPSULES | BALL_FLAG.HAS_MINIBOXES);
  assert.equal(resolveStaticBallTail(dropped).source, "generated-mini-geometry");
  assert.equal(collisions.canEntitiesCollide(value.ship, dropped), true);
  const encoded = encodeEntityBall(dropped, { compatibilityProfile: "frontier" });
  assert.equal(encoded.readUInt8(8), BALL_MODE.STOP);
  assert.equal(encoded.readUInt8(37) & BALL_FLAG.IS_FREE, 0);
  assert.equal(encoded.readUInt8(37) & BALL_FLAG.IS_MASSIVE, BALL_FLAG.IS_MASSIVE);
  assert.equal(encoded.readInt32LE(38), 5);
  assert.equal(encoded.readInt32LE(74), 4242);
  assert.equal(encoded.readFloatLE(78), 1.5);
  assert.equal(encoded.readInt32LE(82), 73);
  assert.equal(encoded.readUInt8(86), 0xff);
  assert.equal(encoded.readUInt16LE(87), 1); // one mini ball
  assert.equal(encoded.readFloatLE(113), 15);
  assert.equal(encoded.readUInt16LE(117), 1); // one mini capsule
  assert.equal(encoded.readUInt16LE(171), 1); // one mini box
  assert.equal(encoded.length, 269);
  const withLegacyTail = {
    ...dropped,
    destinyCollisionTail: "010203",
    destinyBallFlags: BALL_FLAG.HAS_MINIBALLS,
  };
  const legacyTailFrontier = encodeEntityBall(withLegacyTail,
    { compatibilityProfile: "frontier" });
  assert.equal(legacyTailFrontier.readUInt8(37) & (BALL_FLAG.HAS_MINIBALLS |
    BALL_FLAG.HAS_MINICAPSULES | BALL_FLAG.HAS_MINIBOXES),
  BALL_FLAG.HAS_MINIBALLS | BALL_FLAG.HAS_MINICAPSULES | BALL_FLAG.HAS_MINIBOXES);
  assert.equal(legacyTailFrontier.length, encoded.length);

  backend.restart();
  const restarted = fixture();
  assert.equal(restoreDetachedPropsToScene(restarted.scene, {
    store: createDetachedDungeonPropStore({ store: backend }),
  }).success, true);
  const restored = restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE);
  assert.equal(restored.destinyForceFree, false);
  assert.equal(resolveEntityCollisionPresentation(restored, null).collisionID, 4242);
  assert.deepEqual(restored.miniBalls, value.prop.miniBalls);
  assert.equal(collisions.canEntitiesCollide(restarted.ship, restored), true);
});

test("a convex dungeon asteroid keeps its collision mesh and rotation after pickup and drop", () => {
  const asteroidGraphicID = 27420; // Mooneater Exploded Asteroid in Pulverized Asteroid Cluster
  const profile = { collisionID: asteroidGraphicID, boundingRadius: 18_526.9,
    hasConvexMeshes: true, balls: [], boxes: [], capsules: [] };
  setDefaultCollisionBundleForTesting({
    has: (id) => id === asteroidGraphicID,
    getMetadata: (id) => id === asteroidGraphicID ? profile : null,
    getProfile: (id) => id === asteroidGraphicID ? profile : null,
  });
  try {
    const backend = memoryBackend();
    const store = createDetachedDungeonPropStore({ store: backend });
    const value = fixture();
    value.prop.typeID = 83408;
    value.prop.graphicID = asteroidGraphicID;
    value.prop.slimGraphicID = null;
    value.prop.suppressSlimGraphicID = true;
    value.prop.dunRotation = [100.57, -18.24, -114.71];
    value.prop.radius = 1;
    delete value.prop.collisionScale;
    value.prop.destinyForceFree = true;
    value.prop.destinyBallMode = "STOP";
    delete value.prop.destinyCollisionTail;

    const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
      901, { x: -1, y: 0, z: 0 }, {
        store, miningState: { isMineableStaticEntity: () => false }, nowMs: 1_000,
      });
    assert.equal(picked.success, true, picked.errorMsg);
    const moving = value.scene.dynamicEntities.get(WORLD_ID_BASE);
    assert.equal(resolveEntityCollisionPresentation(moving).collisionID, asteroidGraphicID);
    assert.equal(tickDetachedPropMove(value.scene, moving, 0.5, 1_050, { store }).success, true);
    assert.ok(moving.position.x < 0);
    assert.equal(releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
      value.session, 901, { store, nowMs: 1_100 }).success, true);

    const dropped = value.scene.staticEntitiesByID.get(WORLD_ID_BASE);
    assert.equal(dropped.graphicID, asteroidGraphicID);
    assert.equal(dropped.slimGraphicID, asteroidGraphicID);
    assert.equal(dropped.suppressSlimGraphicID, false);
    assert.equal(dropped.collisionID, asteroidGraphicID);
    assert.equal(dropped.convexCollisionID, asteroidGraphicID);
    assert.equal(resolveEntityCollisionPresentation(dropped).profile.hasConvexMeshes, true);
    assert.notDeepEqual(dropped.collisionQuaternion, { w: 1, x: 0, y: 0, z: 0 });
    assert.equal(collisions.getEntityCollisionBroadphaseRadius(dropped), 18_526.9);
    const encoded = encodeEntityBall(dropped, { compatibilityProfile: "frontier" });
    assert.equal(encoded.readInt32LE(74), asteroidGraphicID);
    assert.equal(encoded.readInt32LE(82), asteroidGraphicID);
    assert.equal(encoded.readUInt8(37) & BALL_FLAG.IS_MASSIVE, BALL_FLAG.IS_MASSIVE);

    // Old persisted records lack these fields. Rehydration must resolve the
    // same authored collider before the prop is shown after a server restart.
    const oldState = backend.durable();
    const [oldRecord] = Object.values<any>(oldState.recordsBySource);
    delete oldRecord.worldEntity.collisionID;
    delete oldRecord.worldEntity.convexCollisionID;
    delete oldRecord.worldEntity.collisionQuaternion;
    oldRecord.worldEntity.slimGraphicID = null;
    oldRecord.worldEntity.suppressSlimGraphicID = true;
    assert.equal(backend.write("detachedDungeonProps", "/", oldState).success, true);
    assert.equal(backend.flushTableSync().success, true);
    backend.restart();
    const restarted = fixture();
    assert.equal(restoreDetachedPropsToScene(restarted.scene, {
      store: createDetachedDungeonPropStore({ store: backend }),
    }).success, true);
    const restored = restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE);
    assert.equal(restored.convexCollisionID, asteroidGraphicID);
    assert.equal(restored.slimGraphicID, asteroidGraphicID);
    assert.deepEqual(restored.collisionQuaternion, dropped.collisionQuaternion);
  } finally {
    resetDefaultCollisionBundleForTesting();
  }
});

test("existing detached records with free presentation replay as collidable statics", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  assert.equal(store.detach(value.prop, {
    systemID: value.scene.systemID, instanceID: 42, siteID: 700,
    entityID: value.prop.itemID,
  }, value.scene).success, true);
  const oldState = backend.durable();
  const [record] = Object.values<any>(oldState.recordsBySource);
  record.worldEntity.destinyBallMode = "STOP";
  record.worldEntity.destinyForceFree = true;
  record.worldEntity.destinyBallFlags = BALL_FLAG.IS_FREE;
  assert.equal(backend.write("detachedDungeonProps", "/", oldState).success, true);
  assert.equal(backend.flushTableSync().success, true);
  backend.restart();

  const restarted = fixture();
  assert.equal(restoreDetachedPropsToScene(restarted.scene, {
    store: createDetachedDungeonPropStore({ store: backend }),
  }).success, true);
  const world = restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE);
  assert.equal(world.destinyForceFree, false);
  assert.equal(world.destinyBallFlags & BALL_FLAG.IS_FREE, 0);
  assert.equal(debugDescribeEntityBall(world, { compatibilityProfile: "frontier" })
    .summary.flags.isMassive, true);
  assert.equal(collisions.canEntitiesCollide(restarted.ship, world), true);
});

test("Physics Gun refuses a station without detaching it", () => {
  const value = fixture();
  value.prop.kind = "station";
  const backend = memoryBackend();
  const result = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: 1, y: 0, z: 0 }, {
      store: createDetachedDungeonPropStore({ store: backend }),
    });
  assert.equal(result.success, false);
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), true);
  assert.deepEqual(backend.events, []);
});

test("Physics Gun can grab passive dungeon scenery without a GM role but refuses objectives", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  value.session.accountRole = 0;
  const options = {
    store,
    miningState: { isMineableStaticEntity: () => false },
  };
  const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: -1, y: 0, z: 0 }, options);
  assert.equal(picked.success, true, picked.errorMsg);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  const blocked = fixture();
  blocked.session.accountRole = 0;
  blocked.prop.dungeonMaterializedObjective = true;
  const denied = pickupPhysicsGunTarget(blocked.scene, blocked.session, blocked.prop,
    901, { x: -1, y: 0, z: 0 }, {
      store: createDetachedDungeonPropStore({ store: memoryBackend() }),
      miningState: { isMineableStaticEntity: () => false },
    });
  assert.equal(denied.success, false);
});

test("held prop follows ship motion out of an initial overlap without retargeting every tick", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  value.ship.radius = 100;
  value.prop.position = { x: 1_100, y: 0, z: 0 };
  value.scene.dynamicEntities.set(value.ship.itemID, value.ship);
  value.scene.staticEntitiesByID.set(701, {
    itemID: 701, kind: "structure", typeID: 1234,
    position: { x: 1_030, y: 0, z: 0 }, radius: 80, collisionStatic: true,
  });
  const picked = pickupPhysicsGunTarget(value.scene, value.session, value.prop,
    901, { x: 1, y: 0, z: 0 }, {
      store, miningState: { isMineableStaticEntity: () => false }, nowMs: 1_000,
    });
  assert.equal(picked.success, true, picked.errorMsg);
  const moving = value.scene.dynamicEntities.get(WORLD_ID_BASE);
  assert.equal(collisions.canEntitiesCollide(value.ship, moving), false);
  assert.equal(collisions.canEntitiesCollide(moving, value.ship), false);
  const first = tickDetachedPropMove(value.scene, moving, 0.1, 1_050, { store });
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  assert.ok(moving.position.x > 1_100);
  for (let index = 1; index <= 10; index += 1) {
    value.ship.position.x += 10;
    const step = tickDetachedPropMove(value.scene, moving, 0.05,
      1_050 + index * 50, { store });
    assert.equal(step.success, true, step.errorMsg);
    assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  }
  assert.ok(moving.position.x > 1_100);
  assert.ok(moving.targetPoint.x > 1_300);
  assert.ok(value.events.filter((entry) => Array.isArray(entry) &&
    entry[0] === "GotoPoint").length < 8);
  assert.ok(value.events.filter((entry) => entry === "refresh").length >= 2);
  value.scene.staticEntitiesByID.delete(701);
  const beforeReverse = moving.position.x;
  assert.equal(updateDetachedPropTether(value.scene, WORLD_ID_BASE, value.session,
    901, { x: -1, y: 0, z: 0 }), true);
  const reversed = tickDetachedPropMove(value.scene, moving, 0.05, 1_650, { store });
  assert.equal(reversed.success, true, reversed.errorMsg);
  assert.ok(beforeReverse - moving.position.x <= 1.876);
  assert.equal(value.scene.dynamicEntities.has(WORLD_ID_BASE), true);
  assert.equal(releaseDetachedPropTether(value.scene, WORLD_ID_BASE,
    value.session, 901, { store, nowMs: 1_700 }).success, true);
  assert.equal(collisions.canEntitiesCollide(value.ship,
    value.scene.staticEntitiesByID.get(WORLD_ID_BASE)), true);
});

test("a failed durable flush leaves the source in the scene and rolls back cached state", () => {
  const backend = memoryBackend();
  backend.failFlushOnce();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const result = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "DETACHED_PROP_FLUSH_FAILED");
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), true);
  assert.equal(value.events.length, 0);
  assert.equal(store.listSystem(30000142).length, 0);
  assert.deepEqual(backend.durable().recordsBySource, {});
});

test("a crash after the durable write converges before and after source removal", () => {
  for (const sourceWasRemoved of [false, true]) {
    const backend = memoryBackend();
    const store = createDetachedDungeonPropStore({ store: backend });
    const beforeCrash = fixture();
    const committed = store.detach(beforeCrash.prop, {
      systemID: 30000142, instanceID: 42, siteID: 700,
      entityID: beforeCrash.prop.itemID,
    }, beforeCrash.scene);
    assert.equal(committed.success, true);
    if (sourceWasRemoved) {
      beforeCrash.scene.removeStaticEntity(beforeCrash.prop.itemID);
    }
    backend.restart();
    const restarted = fixture();
    if (sourceWasRemoved) {
      restarted.scene.removeStaticEntity(restarted.prop.itemID);
    }
    const restoredStore = createDetachedDungeonPropStore({ store: backend });
    for (let replay = 0; replay < 2; replay += 1) {
      assert.equal(restoreDetachedPropsToScene(restarted.scene, {
        store: restoredStore,
      }).success, true);
      assert.equal(restarted.scene.staticEntitiesByID.has(restarted.prop.itemID), false);
      assert.equal(restarted.scene.staticEntitiesByID.get(WORLD_ID_BASE)?.kind,
        "detachedDungeonProp");
      assert.equal(restarted.scene.staticEntitiesByID.size, 2);
    }
    assert.equal(restoredStore.listSystem(30000142).length, 1);
  }
});

test("the original instance cannot rematerialize a detached prop; a later instance can", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  assert.equal(detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  }).success, true);
  const template = { populationHints: {
    environmentProps: [{ typeID: 34, label: "Original template slot" }],
  } };
  const materialize = (instanceID) => siteContent.materializeSiteContents(
    value.scene,
    { instanceID, solarSystemID: 30000142, metadata: { siteID: 700 } },
    value.site,
    template,
    { detachedDungeonPropStore: store, spawnEncounters: false, broadcast: false },
  );
  const originalEnsureRuntimeState = dungeonRuntime.ensureTemplateRuntimeState;
  dungeonRuntime.ensureTemplateRuntimeState = () => null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const summary = materialize(42);
      assert.equal(summary.environmentPropsSpawned, 0);
      assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), false);
      assert.equal(value.scene.staticEntitiesByID.has(WORLD_ID_BASE), true);
    }
    const later = materialize(43);
    assert.equal(later.environmentPropsSpawned, 1);
    assert.equal(value.scene.staticEntitiesByID.get(value.prop.itemID)?.dungeonSiteInstanceID, 43);
    assert.equal(value.scene.staticEntitiesByID.has(WORLD_ID_BASE), true);
  } finally {
    dungeonRuntime.ensureTemplateRuntimeState = originalEnsureRuntimeState;
  }
});

test("site teardown removes scoped scenery while detached static and moving props survive", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  assert.equal(detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  }).success, true);
  const worldID = WORLD_ID_BASE;
  const world = value.scene.staticEntitiesByID.get(worldID);
  world.dungeonMaterializedSiteContent = true;
  world.dungeonSiteID = 700;
  world.dungeonSiteInstanceID = 42;
  value.scene.addStaticEntity({
    itemID: 6_400_000_070_002,
    kind: "siteEnvironmentProp",
    dungeonMaterializedSiteContent: true,
    dungeonSiteID: 700,
    dungeonSiteInstanceID: 42,
    typeID: 34,
    position: { x: 400, y: 0, z: 0 },
    radius: 10,
  });
  const removed = siteContent.removeSceneSiteContent(value.scene, 700, {
    instanceID: 42, broadcast: false,
  });
  assert.equal(removed, 1);
  assert.equal(value.scene.staticEntitiesByID.has(6_400_000_070_002), false);
  assert.equal(value.scene.staticEntitiesByID.has(worldID), true);
  assert.equal(store.getByWorldID(30000142, worldID)?.worldEntity.kind,
    "detachedDungeonProp");
  delete world.dungeonMaterializedSiteContent;
  delete world.dungeonSiteID;
  delete world.dungeonSiteInstanceID;

  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  const moving = value.scene.dynamicEntities.get(worldID);
  moving.dungeonMaterializedSiteContent = true;
  moving.dungeonSiteID = 700;
  moving.dungeonSiteInstanceID = 42;
  assert.equal(siteContent.removeSceneSiteContent(value.scene, 700, {
    instanceID: 42, broadcast: false,
  }), 0);
  assert.equal(value.scene.dynamicEntities.has(worldID), true);
  const step = tickDetachedPropMove(
    value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000, { store },
  );
  assert.equal(step.success, true);
  assert.ok(store.getByWorldID(30000142, worldID).worldEntity.position.x > 0);
});

test("detachment rechecks GM authority before any durable write", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  value.session.accountRole = 0n;
  const result = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  assert.equal(result.errorMsg, "GM_ROLE_REQUIRED");
  assert.deepEqual(backend.events, []);
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), true);
});

test("replay rejects a conflicting world ID without removing the source", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const committed = store.detach(value.prop, {
    systemID: 30000142, instanceID: 42, siteID: 700, entityID: value.prop.itemID,
  }, value.scene);
  assert.equal(committed.success, true);
  value.scene.staticEntitiesByID.set(WORLD_ID_BASE, { itemID: WORLD_ID_BASE, kind: "ship" });
  const replay = reconcileDetachedProp(value.scene, committed.data);
  assert.equal(replay.errorMsg, "DETACHED_PROP_WORLD_ID_CONFLICT");
  assert.equal(value.scene.staticEntitiesByID.has(value.prop.itemID), true);
});

test("a later dungeon instance may reuse the original template prop ID", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const first = fixture();
  const committed = store.detach(first.prop, {
    systemID: 30000142, instanceID: 42, siteID: 700, entityID: first.prop.itemID,
  }, first.scene);
  assert.equal(committed.success, true);
  const later = fixture();
  later.prop.dungeonSiteInstanceID = 43;
  later.site.dungeonSiteInstanceID = 43;
  const replay = reconcileDetachedProp(later.scene, committed.data);
  assert.equal(replay.success, true);
  assert.equal(later.scene.staticEntitiesByID.get(later.prop.itemID), later.prop);
  assert.equal(later.scene.staticEntitiesByID.has(WORLD_ID_BASE), true);
  assert.equal(store.suppressedSourceIDs(30000142, 43, 700).size, 0);
});

test("movement sweeps into an obstacle, checkpoints the contact pose, and stops scan FX", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const detached = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  assert.equal(detached.success, true);
  const worldID = detached.data.worldEntityID;
  value.scene.addStaticEntity({
    itemID: 777, kind: "obstacle", typeID: 2, position: { x: 500, y: 0, z: 0 },
    radius: 100, collisionStatic: true,
  });
  const started = startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  );
  assert.equal(started.success, true);
  assert.equal(value.scene.dynamicEntities.has(worldID), true);
  assert.equal(value.scene.staticEntitiesByID.has(worldID), false);
  const fx = value.events.filter((entry) => Array.isArray(entry) && entry[0] === "OnSpecialFX");
  assert.equal(fx.length, 1);
  assert.equal(fx[0][1][1], value.ship.itemID);
  assert.equal(fx[0][1][2], value.ship.typeID);
  assert.equal(fx[0][1][3], worldID);
  assert.equal(fx[0][1][5], "effects.FrontierScanningTest");
  assert.equal(fx[0][1][7], 1);
  const tick = tickDetachedPropMove(value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000, { store });
  assert.equal(tick.success, true);
  assert.equal(tick.data.reason, "collision");
  const world = value.scene.staticEntitiesByID.get(worldID);
  assert.ok(world.position.x > 0 && world.position.x < 500);
  assert.deepEqual(store.getByWorldID(30000142, worldID).worldEntity.position, world.position);
  assert.equal(value.scene.dynamicEntities.has(worldID), false);
  const allFx = value.events.filter((entry) => Array.isArray(entry) && entry[0] === "OnSpecialFX");
  assert.equal(allFx.length, 2);
  assert.equal(allFx[1][1][7], 0);
  backend.restart();
  const restarted = fixture();
  const restoredStore = createDetachedDungeonPropStore({ store: backend });
  assert.equal(restoreDetachedPropsToScene(restarted.scene, { store: restoredStore }).success, true);
  assert.deepEqual(restarted.scene.staticEntitiesByID.get(worldID).position, world.position);
});

test("a moving prop's authored collision shape stops before its radius fallback", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const detached = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  const worldID = detached.data.worldEntityID;
  value.scene.addStaticEntity({
    itemID: 778, kind: "obstacle", typeID: 2,
    position: { x: 500, y: 0, z: 0 }, radius: 20, collisionStatic: true,
  });
  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  value.scene.dynamicEntities.get(worldID).collisionProfile = {
    boundingRadius: 330,
    balls: [{ center: { x: 300, y: 0, z: 0 }, radius: 25 }],
    boxes: [], capsules: [],
  };
  value.scene.dynamicEntities.get(worldID).collisionScale = 1;
  value.scene.dynamicEntities.get(worldID).dunRotation = [0, 0, 0];
  value.scene.dynamicEntities.get(worldID).collisionQuaternion = { w: 1, x: 0, y: 0, z: 0 };
  const profileHit = findMovingPropProfileCollision(
    value.scene, value.scene.dynamicEntities.get(worldID),
    { x: 0, y: 0, z: 0 }, { x: 750, y: 0, z: 0 },
  );
  assert.ok(profileHit, "authored moving profile should find the obstacle");
  assert.equal(profileHit.candidate.itemID, 778);
  assert.ok(profileHit.normal.x < 0, "normal points toward the moving prop");
  const moving = value.scene.dynamicEntities.get(worldID);
  const result = tickDetachedPropMove(
    value.scene, moving, 1, 2_000, { store },
  );
  assert.equal(result.data.reason, "collision");
  assert.equal(moving.lastCollision.impact.closingSpeedMetersPerSecond, 750);
  assert.equal(moving.lastCollision.impact.movingMassKg, null);
  assert.equal(moving.lastCollision.impact.candidateImmovable, true);
  const position = value.scene.staticEntitiesByID.get(worldID).position;
  assert.ok(position.x > 100 && position.x < 200, JSON.stringify(position));
});

test("a failed movement checkpoint restores the last durable pose", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const detached = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  const worldID = detached.data.worldEntityID;
  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  backend.failFlushOnce();
  const result = tickDetachedPropMove(
    value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000, { store },
  );
  assert.equal(result.success, true);
  assert.equal(result.data.reason, "checkpoint-failed");
  assert.deepEqual(value.scene.staticEntitiesByID.get(worldID).position, value.prop.position);
  assert.equal(value.scene.dynamicEntities.has(worldID), false);
});

test("restart during movement restores one settled world prop at its last checkpoint", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  assert.equal(detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  }).success, true);
  const worldID = WORLD_ID_BASE;
  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  assert.equal(tickDetachedPropMove(
    value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000, { store },
  ).success, true);
  assert.equal(value.scene.dynamicEntities.has(worldID), true);
  const checkpoint = store.getByWorldID(30000142, worldID).worldEntity.position;
  assert.ok(checkpoint.x > 0 && checkpoint.x < 5_000);

  backend.restart();
  const restarted = fixture();
  const restoredStore = createDetachedDungeonPropStore({ store: backend });
  assert.equal(restoreDetachedPropsToScene(restarted.scene, {
    store: restoredStore,
  }).success, true);
  assert.equal(restarted.scene.dynamicEntities.has(worldID), false);
  assert.deepEqual(restarted.scene.staticEntitiesByID.get(worldID).position, checkpoint);
  assert.equal(restarted.scene.staticEntitiesByID.has(restarted.prop.itemID), false);
  assert.equal(restarted.scene.staticEntitiesByID.size, 2);
});

test("a prop reaches its destination without a session-bound mover", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const detached = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  const worldID = detached.data.worldEntityID;
  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  // The issuing GM leaves after the command; movement remains scene-owned.
  value.session._space = null;
  for (let tick = 0; tick < 20 && value.scene.dynamicEntities.has(worldID); tick += 1) {
    const result = tickDetachedPropMove(
      value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000 + tick * 1_000,
      { store },
    );
    assert.equal(result.success, true);
  }
  assert.equal(value.scene.dynamicEntities.has(worldID), false);
  assert.deepEqual(value.scene.staticEntitiesByID.get(worldID).position,
    { x: 5_000, y: 0, z: 0 });
  assert.deepEqual(store.getByWorldID(30000142, worldID).worldEntity.position,
    { x: 5_000, y: 0, z: 0 });
});

test("only a nearby GM can stop a moving prop", () => {
  const backend = memoryBackend();
  const store = createDetachedDungeonPropStore({ store: backend });
  const value = fixture();
  const detached = detachDungeonProp(value.scene, value.session, value.prop.itemID, {
    store, selectionOptions: value.selectionOptions,
  });
  const worldID = detached.data.worldEntityID;
  assert.equal(startDetachedPropMove(
    value.scene, value.session, worldID, { x: 5_000, y: 0, z: 0 },
    { store, nowMs: 1_000 },
  ).success, true);
  const outsider = { accountRole: 0n, _space: { systemID: 30000142 } };
  assert.equal(stopDetachedPropMove(value.scene, outsider, worldID, { store }).errorMsg,
    "GM_ROLE_REQUIRED");
  assert.equal(value.scene.dynamicEntities.has(worldID), true);
  assert.equal(stopDetachedPropMove(value.scene, value.session, worldID, { store }).success, true);
  assert.equal(value.scene.dynamicEntities.has(worldID), false);
});
