"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
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
const { resolveStaticBallTail } = require("../src/space/destiny/stream/staticBallTail");
const { _testing: siteContent } = require("../src/services/dungeon/dungeonUniverseSiteService");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");

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
  const ship = {
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
  const prop = {
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
  const profileHit = findMovingPropProfileCollision(
    value.scene, value.scene.dynamicEntities.get(worldID),
    { x: 0, y: 0, z: 0 }, { x: 750, y: 0, z: 0 },
  );
  assert.ok(profileHit, "authored moving profile should find the obstacle");
  const result = tickDetachedPropMove(
    value.scene, value.scene.dynamicEntities.get(worldID), 1, 2_000, { store },
  );
  assert.equal(result.data.reason, "collision");
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
