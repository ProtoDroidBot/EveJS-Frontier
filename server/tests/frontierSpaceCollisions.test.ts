"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BALL_FLAG,
} = require("../src/space/destiny/constants");
const {
  getFreeBallFlags,
} = require("../src/space/destiny/stream/ballEncoding");
const {
  getStaticBallFlags,
} = require("../src/space/destiny/stream/staticBallTail");
const {
  findSweptWeaponOccluder,
  findWeaponLineOccluder,
  resolveEntityMovementCollision,
} = require("../src/space/destiny/simulation/collisions");
const {
  resetDefaultCollisionBundleForTesting,
  setDefaultCollisionBundleForTesting,
} = require("../src/space/destiny/collision/collisionBundle");
const {
  createDestinyWarpUpdateBuilders,
} = require("../src/space/destiny/simulation/warpBuilders");
const {
  buildUndockBootstrapMovementUpdates,
} = require("../src/space/destiny/presentation/shipPrime");
const {
  buildOwnerUncloakPresentationUpdates,
  buildUncloakDeliveryPresentationUpdates,
} = require("../src/space/destiny/presentation/specialFxPayloads");
const destinyActions = require("../src/space/destiny/stream/actions");
const runtime = require("../src/space/runtime");
const npcBehaviorLoop = require("../src/space/npc/npcBehaviorLoop");

const getStationUndockSpawnState =
  runtime._testing.getStationUndockSpawnStateForTesting;
const buildStaticCelestialEntity =
  runtime._testing.buildStaticCelestialEntityForTesting;

function buildShip(overrides: Record<string, any> = {}) {
  return {
    itemID: 1001,
    kind: "ship",
    mode: "GOTO",
    radius: 10,
    mass: 1_000_000,
    inertia: 0.5,
    maxVelocity: 200,
    speedFraction: 1,
    pilotCharacterID: 90000001,
    position: { x: 100, y: 0, z: 0 },
    velocity: { x: 200, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    ...overrides,
  };
}

function payloadMassiveValue(update) {
  return update && update.payload && update.payload[0] === "SetBallMassive"
    ? update.payload[1][1]
    : null;
}

test("sub-warp ships and physical space objects are massive client balls", () => {
  const shipFlags = getFreeBallFlags(buildShip());
  assert.notEqual(shipFlags & BALL_FLAG.IS_MASSIVE, 0);
  assert.notEqual(shipFlags & BALL_FLAG.IS_INTERACTIVE, 0);

  const objectFlags = getStaticBallFlags({
    itemID: 2001,
    kind: "authoredSpaceProp",
    destinyBallFlags: BALL_FLAG.IS_GLOBAL,
  });
  assert.notEqual(objectFlags & BALL_FLAG.IS_MASSIVE, 0);

  const nonPhysicalFlags = getStaticBallFlags({
    itemID: 2002,
    kind: "landscapeSite",
    nonPhysicalDecloakExempt: true,
  });
  assert.equal(nonPhysicalFlags & BALL_FLAG.IS_MASSIVE, 0);

  const optedOutFlags = getStaticBallFlags({
    itemID: 2003,
    kind: "authoredSpaceProp",
    collisionEnabled: false,
  });
  assert.equal(optedOutFlags & BALL_FLAG.IS_MASSIVE, 0);
});

test("warp, docking, and cloak phases remain non-colliding on the client", () => {
  for (const ship of [
    buildShip({
      mode: "WARP",
      pendingWarp: null,
      warpState: {},
      collisionEnabled: true,
    }),
    buildShip({ pendingDock: { stationID: 60000001 } }),
    buildShip({ cloaked: true, cloakMode: 1 }),
  ]) {
    assert.equal(getFreeBallFlags(ship) & BALL_FLAG.IS_MASSIVE, 0);
  }

  const aligningShip = buildShip({
    mode: "WARP",
    pendingWarp: { targetPoint: { x: 1_000_000, y: 0, z: 0 } },
    warpState: { nativeWarpCommand: "GOTO" },
  });
  assert.notEqual(getFreeBallFlags(aligningShip) & BALL_FLAG.IS_MASSIVE, 0);
});

test("stations without locator data undock ships beyond the collision sphere", () => {
  const station = {
    stationID: 64000001,
    stationTypeID: 85226,
    position: { x: 100, y: 200, z: 300 },
    radius: 33_811,
    interactionRadius: 33_811,
    dockPosition: null,
    undockPosition: null,
    dockOrientation: null,
    undockDirection: null,
    dunRotation: null,
  };

  const spawnState = getStationUndockSpawnState(station, {
    selectionStrategy: "first",
  });
  const centerDistance = Math.hypot(
    spawnState.position.x - station.position.x,
    spawnState.position.y - station.position.y,
    spawnState.position.z - station.position.z,
  );

  assert.equal(spawnState.source, "stored");
  assert.deepEqual(spawnState.direction, { x: 0, y: 0, z: 1 });
  assert.equal(centerDistance, station.radius + 2500);
  assert.ok(
    centerDistance > station.radius + buildShip().radius,
    "the undocked ship must not start intersecting the station ball",
  );

  const distantSpawnState = getStationUndockSpawnState(station, {
    extraUndockDistance: 50_000,
    selectionStrategy: "first",
  });
  assert.equal(
    Math.hypot(
      distantSpawnState.position.x - station.position.x,
      distantSpawnState.position.y - station.position.y,
      distantSpawnState.position.z - station.position.z,
    ),
    50_000,
    "an explicitly safer fallback offset must not be shortened",
  );
});

test("a 400 m/s Creation impact uses station geometry and damages the ship", () => {
  const profile = {
    boundingRadius: 100,
    balls: [],
    boxes: [{
      corner: { x: -50, y: -50, z: -50 },
      edgeX: { x: 100, y: 0, z: 0 },
      edgeY: { x: 0, y: 100, z: 0 },
      edgeZ: { x: 0, y: 0, z: 100 },
    }],
    capsules: [],
  };
  setDefaultCollisionBundleForTesting({
    has: (id) => id === 27819,
    getMetadata: (id) => id === 27819 ? { boundingRadius: 100 } : null,
    getProfile: (id) => id === 27819 ? profile : null,
  });
  try {
    const damageMessages: any[] = [];
    const station = runtime._testing.buildStaticStationEntityForTesting({
      stationID: 64000001,
      stationTypeID: 85226,
      stationName: "Frontier BioLab Station",
      stationGraphicID: 27819,
      radius: 33_811,
      position: { x: 0, y: 0, z: 0 },
    });
    assert.equal(station.graphicID, 27819);
    const ship: any = buildShip({
      typeID: 95276,
      mass: 1_892_916,
      radius: 1,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: -400, y: 0, z: 0 },
      maxVelocity: 900,
      passiveDerivedState: { maxVelocity: 360 },
      shieldCapacity: 0,
      armorHP: 0,
      structureHP: 2_100,
      session: {
        sendNotification(name, idType, args) {
          if (name === "OnDamageMessage") damageMessages.push({ idType, payload: args[0] });
        },
      },
    });
    assert.equal(runtime._testing.resolveCollisionStableSpeedForTesting(ship), 360);
    const scene: any = {
      _activeTickSequence: 1,
      staticEntities: [station],
      staticEntitiesByID: new Map([[station.itemID, station]]),
      dynamicEntities: new Map([[ship.itemID, ship]]),
      sessions: new Map(),
      systemID: 30000001,
      getCurrentSimTimeMs: () => 1_000,
      getCurrentDestinyStamp: () => 10,
    };
    const collision = resolveEntityMovementCollision(ship, scene,
      { x: 150, y: 0, z: 0 });
    assert.ok(collision);
    assert.equal(collision.entityID, station.itemID);
    assert.equal(collision.primitiveType, "box");
    assert.equal(collision.startedOverlapping, false);
    assert.ok(ship.position.x > 50 && ship.position.x < 60);
    assert.equal(collision.impact.closingSpeedMetersPerSecond, 400);
    const immediate = runtime._testing.processSceneCollisionContactsForTesting(
      scene, [{ mover: ship, candidate: station, collision }], 1_000, [],
      { damageOnly: true },
    );
    assert.equal(immediate.damaged, 1);
    assert.equal(immediate.pushed, 0);
    assert.ok(ship.conditionState.damage > 0);
    assert.equal(damageMessages.length, 1);
    assert.equal(damageMessages[0].idType, "clientID");
    const message = Object.fromEntries(damageMessages[0].payload.entries);
    assert.equal(message.attackType, "otherPlayerWeapons");
    assert.equal(message.source, station.itemID);
    assert.equal(message.target, ship.itemID);
    assert.ok(message.damage > 0);
    assert.ok(Math.abs(message.damage - ship.conditionState.damage * ship.structureHP) < 0.01);
    const deferred = runtime._testing.processSceneCollisionContactsForTesting(
      scene, [{ mover: ship, candidate: station, collision }], 1_000,
    );
    assert.equal(deferred.damaged, 0);
    assert.equal(damageMessages.length, 1);
  } finally {
    resetDefaultCollisionBundleForTesting();
  }
});

test("a modular ship preserves its passive collision speed when type speed is zero", () => {
  const ship = runtime._testing.buildRuntimeShipEntityForTesting({
    itemID: 1009,
    typeID: 95276,
    groupID: 5128,
    categoryID: 6,
    radius: 1,
    passiveResourceState: {
      maxVelocity: 360,
      mass: 1_892_916,
      structureHP: 2_100,
      attributes: {},
    },
    spaceState: { position: { x: 0, y: 0, z: 0 } },
  }, 30000001);
  assert.equal(ship.collisionStableMaxVelocity, 360);
  ship.maxVelocity = 900;
  assert.equal(runtime._testing.resolveCollisionStableSpeedForTesting(ship), 360);
});

test("movement applies an eligible station impact before the scene contact flush", () => {
  const notifications: any[] = [];
  const ship: any = buildShip({
    itemID: 1010,
    mode: "STOP",
    position: { x: 40, y: 0, z: 0 },
    velocity: { x: -400, y: 0, z: 0 },
    maxVelocity: 400,
    collisionStableMaxVelocity: 200,
    structureHP: 2_100,
    session: {
      sendNotification(name, _idType, args) {
        if (name === "OnDamageMessage") notifications.push(args[0]);
      },
    },
  });
  const station: any = {
    itemID: 2010,
    typeID: 85226,
    kind: "station",
    collisionStatic: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 20,
  };
  const scene: any = {
    _activeTickSequence: 1,
    _activeTickDeltaSeconds: 0.2,
    _activeTickNowMs: 1_000,
    _collisionContactEvents: [],
    dynamicEntities: new Map([[ship.itemID, ship]]),
    staticEntities: [station],
    staticEntitiesByID: new Map([[station.itemID, station]]),
    sessions: new Map(),
    systemID: 30000001,
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 10,
    getEntityByID(id) {
      return this.dynamicEntities.get(id) || this.staticEntitiesByID.get(id) || null;
    },
  };
  const advanced = runtime._testing.advanceEntityForActiveSceneTickForTesting(scene, ship);
  assert.equal(advanced.advanced, true);
  assert.equal(scene._collisionContactEvents.length, 1);
  assert.ok(ship.conditionState.damage > 0);
  assert.equal(notifications.length, 1);
});

test("co-located Lagrange markers do not eject ships from station undock range", () => {
  const station = {
    stationID: 64000001,
    stationTypeID: 85226,
    position: { x: 100, y: 200, z: 300 },
    radius: 33_811,
    interactionRadius: 33_811,
  };
  const spawnState = getStationUndockSpawnState(station, {
    selectionStrategy: "first",
  });
  const lagrangePoint = buildStaticCelestialEntity({
    itemID: 412000001,
    typeID: 88163,
    kind: "lagrangePoint",
    radius: 105_000,
    position: station.position,
  });
  const ship = buildShip({
    position: spawnState.position,
    velocity: { x: 0, y: 0, z: 0 },
  });
  const scene = {
    staticEntities: [lagrangePoint],
    dynamicEntities: new Map([[ship.itemID, ship]]),
  };

  assert.equal(lagrangePoint.nonPhysicalCollision, true);
  assert.equal(lagrangePoint.nonPhysicalDecloakExempt, true);
  assert.notEqual(getStaticBallFlags(lagrangePoint) & BALL_FLAG.IS_GLOBAL, 0);
  assert.equal(getStaticBallFlags(lagrangePoint) & BALL_FLAG.IS_MASSIVE, 0);
  assert.equal(
    resolveEntityMovementCollision(ship, scene, spawnState.position),
    null,
  );
  assert.deepEqual(ship.position, spawnState.position);
});

test("server swept-sphere collision prevents tunneling through an object", () => {
  const ship = buildShip();
  const obstacle = {
    itemID: 2001,
    kind: "structure",
    radius: 20,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const scene = {
    _activeTickSequence: 7,
    staticEntities: [obstacle],
    dynamicEntities: new Map([[ship.itemID, ship]]),
  };

  const collision = resolveEntityMovementCollision(
    ship,
    scene,
    { x: -100, y: 0, z: 0 },
    { activeTickSequence: 7 },
  );

  assert.equal(collision.entityID, obstacle.itemID);
  assert.ok(Math.abs(collision.fraction - 0.35) < 1e-12);
  assert.ok(Math.abs(ship.position.x - -30.01) < 1e-9);
  assert.deepEqual(collision.impact.movingVelocity, { x: 200, y: 0, z: 0 });
  assert.deepEqual(collision.impact.candidateVelocity, { x: 0, y: 0, z: 0 });
  assert.equal(collision.impact.closingSpeedMetersPerSecond, 200);
  assert.equal(collision.impact.movingMassKg, 1_000_000);
  assert.equal(collision.impact.candidateMassKg, null);
  assert.equal(collision.impact.candidateImmovable, true);
  assert.deepEqual(ship.velocity, { x: 0, y: 0, z: 0 });
});

test("collision snapshot uses both pre-resolution velocities and masses", () => {
  const ship = buildShip();
  const other = buildShip({
    itemID: 2001,
    mass: 4_000_000,
    radius: 20,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: -50, y: 0, z: 0 },
    _lastMovementAdvancedTickSequence: 7,
    lastMotionDebug: { previousPosition: { x: 50, y: 0, z: 0 } },
  });
  const scene = {
    _activeTickSequence: 7,
    staticEntities: [],
    dynamicEntities: new Map([[ship.itemID, ship], [other.itemID, other]]),
  };

  const collision = resolveEntityMovementCollision(
    ship, scene, { x: -100, y: 0, z: 0 },
  );

  assert.ok(collision);
  assert.deepEqual(collision.impact.relativeVelocity, { x: 250, y: 0, z: 0 });
  assert.equal(collision.impact.closingSpeedMetersPerSecond, 250);
  assert.equal(collision.impact.movingMassKg, 1_000_000);
  assert.equal(collision.impact.candidateMassKg, 4_000_000);
  assert.equal(collision.impact.candidateImmovable, false);
  assert.deepEqual(ship.velocity, { x: -50, y: 0, z: 0 });
  assert.deepEqual((ship as any).lastCollision.impact, collision.impact);
});

test("tangent contact records zero inward closing speed", () => {
  const ship = buildShip({
    position: { x: 100, y: -30, z: 0 },
  });
  const obstacle = {
    itemID: 2001,
    kind: "structure",
    radius: 20,
    mass: 0,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const scene = {
    staticEntities: [obstacle],
    dynamicEntities: new Map([[ship.itemID, ship]]),
  };

  const collision = resolveEntityMovementCollision(
    ship, scene, { x: -100, y: -30, z: 0 },
  );

  assert.ok(collision);
  assert.equal(collision.startedOverlapping, false);
  assert.equal(collision.impact.closingSpeedMetersPerSecond, 0);
  assert.equal(collision.impact.candidateMassKg, null);
  assert.deepEqual(ship.velocity, { x: 200, y: 0, z: 0 });
});

test("scene collision applies kinetic layers and pushes the lighter ship", () => {
  const { processSceneCollisionContactsForTesting } = runtime._testing;
  const heavyMessages: any[] = [];
  const lightMessages: any[] = [];
  const heavy: any = buildShip({
    itemID: 1001,
    typeID: 1,
    mass: 4_000_000,
    maxVelocity: 600,
    collisionStableMaxVelocity: 200,
    position: { x: 100, y: 0, z: 0 },
    velocity: { x: 300, y: 0, z: 0 },
    shieldCapacity: 1_000,
    armorHP: 1_000,
    structureHP: 1_000,
    session: {
      sendNotification(name, _idType, args) {
        if (name === "OnDamageMessage") heavyMessages.push(Object.fromEntries(args[0].entries));
      },
    },
  });
  const light: any = buildShip({
    itemID: 1002,
    typeID: 2,
    mass: 1_000_000,
    maxVelocity: 200,
    collisionStableMaxVelocity: 100,
    radius: 20,
    mode: "STOP",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    shieldCapacity: 50,
    armorHP: 100,
    structureHP: 200,
    session: {
      sendNotification(name, _idType, args) {
        if (name === "OnDamageMessage") lightMessages.push(Object.fromEntries(args[0].entries));
      },
    },
  });
  const scene: any = {
    _activeTickSequence: 1,
    dynamicEntities: new Map([[heavy.itemID, heavy], [light.itemID, light]]),
    staticEntities: [],
    staticEntitiesByID: new Map(),
    sessions: new Map(),
    systemID: 30000001,
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 10,
    getMovementStamp: () => 10,
    getEntityByID(id) { return this.dynamicEntities.get(id) || null; },
  };
  const collision = resolveEntityMovementCollision(
    heavy, scene, { x: -100, y: 0, z: 0 },
  );
  assert.ok(collision);
  const updates: any[] = [];
  const immediate = processSceneCollisionContactsForTesting(
    scene, [{ mover: heavy, candidate: light, collision }], 1_000, [],
    { damageOnly: true },
  );
  assert.equal(immediate.damaged, 2);
  assert.equal(immediate.pushed, 0);
  assert.equal(light.velocity.x, 0, "push waits for all contacts in the tick");
  const result = processSceneCollisionContactsForTesting(
    scene, [{ mover: heavy, candidate: light, collision }], 1_000, updates,
  );
  assert.equal(result.damaged, 0);
  assert.equal(result.pushed, 1);
  assert.equal(light.conditionState.shieldCharge, 0);
  assert.equal(light.conditionState.armorDamage, 1);
  assert.ok(light.conditionState.damage > 0);
  assert.equal(heavyMessages.length, 2);
  assert.equal(lightMessages.length, 2);
  assert.ok(heavyMessages.some(message =>
    message.attackType === "otherPlayerWeapons" &&
    message.source === light.itemID &&
    message.target === heavy.itemID && message.damage > 0));
  assert.ok(lightMessages.some(message =>
    message.attackType === "otherPlayerWeapons" &&
    message.source === heavy.itemID &&
    message.target === light.itemID && message.damage > 0));
  assert.equal(light.velocity.x, 250);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload[0], "SetBallVelocity");
  assert.equal(updates[0].payload[1][0], light.itemID);
  runtime._testing.advanceMovementForTesting(light, scene, 0.1, 1_100);
  assert.ok(light.position.x > 0, "the pushed ship moves on the next simulation step");
  processSceneCollisionContactsForTesting(
    scene, [{ mover: heavy, candidate: light, collision }], 1_001,
  );
  assert.equal(heavyMessages.length, 2, "sustained contact has no repeated popup");
  assert.equal(lightMessages.length, 2, "sustained contact has no repeated popup");
});

test("contained ships depenetrate to a station boundary instead of phasing out", () => {
  const station = {
    itemID: 2001,
    kind: "station",
    radius: 20,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const scene = {
    staticEntities: [station],
    dynamicEntities: new Map(),
  };
  const ship = buildShip({
    position: { x: 15, y: 0, z: 0 },
    velocity: { x: 200, y: 0, z: 0 },
  });

  const collision = resolveEntityMovementCollision(
    ship,
    scene,
    { x: 10, y: 0, z: 0 },
  );

  assert.equal(collision.entityID, station.itemID);
  assert.equal(collision.startedOverlapping, true);
  assert.equal(collision.penetrationDepth, 20);
  assert.ok(Math.abs(ship.position.x - 30.01) < 1e-9);
  assert.deepEqual(ship.velocity, { x: 200, y: 0, z: 0 });
});

test("station containment correction removes inward velocity even without displacement", () => {
  const station = {
    itemID: 2001,
    kind: "station",
    radius: 20,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const scene = {
    staticEntities: [station],
    dynamicEntities: new Map(),
  };
  const ship = buildShip({
    position: { x: 10, y: 0, z: 0 },
    velocity: { x: -200, y: 0, z: 0 },
  });

  const collision = resolveEntityMovementCollision(
    ship,
    scene,
    { x: 10, y: 0, z: 0 },
  );

  assert.equal(collision.startedOverlapping, true);
  assert.ok(Math.abs(ship.position.x - 30.01) < 1e-9);
  assert.deepEqual(ship.velocity, { x: 0, y: 0, z: 0 });
});

test("server collision ignores non-physical anchors and active warp", () => {
  const logicalAnchor = {
    itemID: 2001,
    kind: "landscapeSite",
    nonPhysicalDecloakExempt: true,
    radius: 20,
    position: { x: 0, y: 0, z: 0 },
  };
  const scene = {
    staticEntities: [logicalAnchor],
    dynamicEntities: new Map(),
  };
  const ship = buildShip();
  assert.equal(
    resolveEntityMovementCollision(ship, scene, { x: -100, y: 0, z: 0 }),
    null,
  );

  const warpingShip = buildShip({ mode: "WARP", warpState: {} });
  scene.staticEntities = [{
    ...logicalAnchor,
    kind: "structure",
    nonPhysicalDecloakExempt: false,
  }];
  assert.equal(
    resolveEntityMovementCollision(
      warpingShip,
      scene,
      { x: -100, y: 0, z: 0 },
    ),
    null,
  );

  for (const obstacleOverride of [
    { collisionEnabled: false },
    { destinyForceMassive: false },
    { pendingDock: { stationID: 60000001 } },
  ]) {
    scene.staticEntities = [{
      ...logicalAnchor,
      kind: "structure",
      nonPhysicalDecloakExempt: false,
      ...obstacleOverride,
    }];
    assert.equal(
      resolveEntityMovementCollision(ship, scene, { x: -100, y: 0, z: 0 }),
      null,
    );
  }
});

test("direct weapons are occluded by the nearest physical entity", () => {
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const target: any = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
  });
  const fartherBlocker = buildShip({
    itemID: 1004,
    position: { x: 70, y: 0, z: 0 },
    radius: 5,
  });
  const nearestBlocker = {
    itemID: 1003,
    kind: "structure",
    position: { x: 40, y: 0, z: 0 },
    radius: 5,
  };
  const scene = {
    staticEntities: [fartherBlocker, nearestBlocker],
    dynamicEntities: new Map([
      [source.itemID, source],
      [target.itemID, target],
    ]),
  };

  const occlusion = findWeaponLineOccluder(scene, source, target);

  assert.equal(occlusion.entityID, nearestBlocker.itemID);
  assert.equal(occlusion.kind, "structure");
  assert.ok(Math.abs(occlusion.position.x - 35) < 1e-9);
});

test("weapon occlusion rotates dungeon collision compounds with dunRotation", () => {
  const source = buildShip({
    itemID: 1051,
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  const target: any = buildShip({
    itemID: 1052,
    position: { x: 100, y: 0, z: 0 },
    radius: 1,
  });
  const rotatedWall = {
    itemID: 1053,
    kind: "siteEnvironmentProp",
    position: { x: 50, y: 20, z: 0 },
    radius: 60,
    dunRotation: [0, 0, 90],
    collisionProfile: {
      boundingRadius: 60,
      balls: [],
      capsules: [],
      boxes: [{
        corner: { x: -50, y: -2, z: -2 },
        edgeX: { x: 100, y: 0, z: 0 },
        edgeY: { x: 0, y: 4, z: 0 },
        edgeZ: { x: 0, y: 0, z: 4 },
      }],
    },
  };
  const scene = {
    staticEntities: [rotatedWall],
    dynamicEntities: new Map([
      [source.itemID, source],
      [target.itemID, target],
    ]),
  };

  const occlusion = findWeaponLineOccluder(scene, source, target);

  assert.equal(occlusion.entityID, rotatedWall.itemID);
  assert.equal(occlusion.primitiveType, "box");
});

test("authoritative weapon lines include the bounded visual hull of dungeon structures", () => {
  const source = buildShip({
    itemID: 1061,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  const target = buildShip({
    itemID: 1062,
    position: { x: 10_000, y: 0, z: 0 },
    radius: 1,
  });
  const dungeonWall = {
    itemID: 1063,
    kind: "siteEnvironmentProp",
    dungeonMaterializedEnvironment: true,
    position: { x: 5_000, y: 5_300, z: 0 },
    radius: 500,
    collisionProfile: {
      boundingRadius: 5_000,
      balls: [],
      boxes: [],
      capsules: [],
      hasConvexMeshes: true,
    },
  };
  const scene = {
    staticEntities: [dungeonWall],
    dynamicEntities: new Map([
      [source.itemID, source],
      [target.itemID, target],
    ]),
  };

  const occlusion = findWeaponLineOccluder(scene, source, target);

  assert.equal(occlusion.entityID, dungeonWall.itemID);
  assert.equal(occlusion.primitiveType, "sphereFallback");
  assert.equal(occlusion.occlusionPaddingMeters, 500);
  const playerWeaponOcclusion = findWeaponLineOccluder(
    scene,
    { ...source, nativeNpc: false },
    target,
    { includeDungeonVisualHull: true },
  );
  assert.equal(playerWeaponOcclusion.entityID, dungeonWall.itemID);
  assert.equal(playerWeaponOcclusion.occlusionPaddingMeters, 500);
  assert.equal(
    findWeaponLineOccluder(scene, { ...source, nativeNpc: false }, target),
    null,
    "visibility rays must retain exact authored collision geometry",
  );
});

test("authoritative weapon lines use authored bounds after sparse dungeon primitives miss", () => {
  const source = buildShip({
    itemID: 1064,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  const target = buildShip({
    itemID: 1065,
    position: { x: 10_000, y: 0, z: 0 },
    radius: 1,
  });
  const sparseDungeonStructure = {
    itemID: 1066,
    kind: "siteEnvironmentProp",
    dungeonMaterializedEnvironment: true,
    position: { x: 5_000, y: 4_000, z: 0 },
    radius: 500,
    collisionProfile: {
      boundingRadius: 5_000,
      balls: [],
      boxes: [{
        corner: { x: -100, y: 900, z: -100 },
        edgeX: { x: 200, y: 0, z: 0 },
        edgeY: { x: 0, y: 200, z: 0 },
        edgeZ: { x: 0, y: 0, z: 200 },
      }],
      capsules: [],
    },
  };
  const scene = {
    staticEntities: [sparseDungeonStructure],
    dynamicEntities: new Map([
      [source.itemID, source],
      [target.itemID, target],
    ]),
  };

  const occlusion = findWeaponLineOccluder(scene, source, target);

  assert.equal(occlusion.entityID, sparseDungeonStructure.itemID);
  assert.equal(occlusion.primitiveType, "profileBoundsFallback");
  assert.equal(
    findWeaponLineOccluder(
      scene,
      { ...source, nativeNpc: false },
      target,
      { includeDungeonVisualHull: true },
    ).entityID,
    sparseDungeonStructure.itemID,
    "player and NPC damage rays share the conservative authored envelope",
  );

  const sourceInsideEnvelope = {
    ...source,
    position: { ...sparseDungeonStructure.position },
  };
  assert.equal(
    findWeaponLineOccluder(scene, sourceInsideEnvelope, target),
    null,
    "weapons fired from inside the envelope must keep using precise primitives",
  );
});

test("direct weapon occlusion ignores off-axis and explicitly non-physical objects", () => {
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const target = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
  });
  const scene = {
    staticEntities: [
      {
        itemID: 2001,
        kind: "structure",
        position: { x: 40, y: 20, z: 0 },
        radius: 5,
      },
      {
        itemID: 2002,
        kind: "structure",
        position: { x: 60, y: 0, z: 0 },
        radius: 10,
        collisionEnabled: false,
      },
    ],
    dynamicEntities: new Map([
      [source.itemID, source],
      [target.itemID, target],
    ]),
  };

  assert.equal(findWeaponLineOccluder(scene, source, target), null);
});

test("NPC target selection and locking obey physical line-of-fire obstruction", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const npc: any = buildShip({
    itemID: 1101,
    npcEntityType: "npc",
    nativeNpc: true,
    pilotCharacterID: 0,
    characterID: 0,
    ownerID: 1000125,
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 0, y: 0, z: 0 },
    maxTargetRange: 1_000,
    maxLockedTargets: 2,
    scanResolution: 1_000,
  });
  const eventOrder: string[] = [];
  const targetSession: Record<string, any> = {
    characterID: 90000002,
    sendNotification() {
      eventOrder.push("target-notification");
    },
    _space: {
      shipID: 1102,
      initialStateSent: true,
    },
  };
  const target = buildShip({
    itemID: 1102,
    pilotCharacterID: targetSession.characterID,
    session: targetSession,
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 100, y: 0, z: 0 },
    signatureRadius: 40,
  });
  const blocker = {
    itemID: 1103,
    kind: "authoredSpaceProp",
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 50, y: 0, z: 0 },
    radius: 15,
  };
  const scene = Object.create(SolarSystemScene.prototype);
  scene.dynamicEntities = new Map([
    [npc.itemID, npc],
    [target.itemID, target],
  ]);
  scene.staticEntities = [blocker];
  scene.staticEntitiesByID = new Map([[blocker.itemID, blocker]]);
  scene.sessions = new Map([[1, targetSession]]);
  scene.nextTargetSequence = 1;
  scene._tickTargetingStatsCache = new Map();
  scene.getCurrentSimTimeMs = () => 1_000;
  scene.canSessionDetectDynamicEntity = () => true;
  scene.revealCombatSourceToTargetSession = (source, victim, options) => {
    eventOrder.push("combat-reveal");
    assert.equal(source, npc);
    assert.equal(victim, target);
    assert.equal(options.reason, "npc-target-lock");
    return { revealed: true, materialized: true, delivered: true };
  };

  assert.equal(
    npcBehaviorLoop.__testing.isValidCombatTarget(npc, target, { scene }),
    false,
  );
  const pseudoSession = {
    _space: { shipID: npc.itemID, systemID: 30000001 },
  };
  const blockedLock = scene.validateTargetLockRequest(
    pseudoSession,
    npc,
    target,
  );
  assert.equal(blockedLock.success, false);
  assert.equal(blockedLock.errorMsg, "TARGET_OBSTRUCTED");
  assert.equal(blockedLock.data.occluderID, blocker.itemID);

  blocker.position.y = 100;
  assert.equal(
    npcBehaviorLoop.__testing.isValidCombatTarget(npc, target, { scene }),
    true,
  );
  const lock = scene.finalizeTargetLock(npc, target, { nowMs: 1_000 });
  assert.equal(lock.success, true);
  assert.deepEqual(
    eventOrder,
    ["combat-reveal", "target-notification"],
    "the attacker ball must resolve before the victim receives target events",
  );

  npc.activeModuleEffects = new Map([[9001, {
    moduleID: 9001,
    targetID: target.itemID,
    isGeneric: false,
  }]]);
  blocker.position.y = 0;
  scene.validateNpcTargetLocksBeforeCombat(1_001);
  assert.deepEqual(scene.getTargetsForEntity(npc), []);
  assert.equal(
    npc.activeModuleEffects.size,
    0,
    "occluded NPC effects must stop before their next combat cycle",
  );

  blocker.position.y = 100;
  assert.equal(scene.finalizeTargetLock(npc, target, { nowMs: 1_002 }).success, true);
  npc.npcBehaviorProfile = {
    retainTargetLockWhenOccluded: true,
    fireThroughOccluders: false,
  };
  npc.activeModuleEffects = new Map([[9001, {
    moduleID: 9001,
    targetID: target.itemID,
    isGeneric: false,
  }]]);
  blocker.position.y = 0;
  scene.canSessionDetectDynamicEntity = () => false;
  assert.equal(
    npcBehaviorLoop.__testing.isValidCombatTarget(npc, target, {
      scene,
      allowOccluded: true,
    }),
    true,
  );
  scene.validateNpcTargetLocksBeforeCombat(1_003);
  assert.deepEqual(
    scene.getTargetsForEntity(npc),
    [target.itemID],
    "the profile can preserve an already completed occluded target lock",
  );
  assert.equal(
    npc.activeModuleEffects.size,
    1,
    "retaining the lock keeps the active effect alive without granting fire-through",
  );

  scene.canSessionDetectDynamicEntity = () => true;
  const blockedReacquisition = scene.validateTargetLockRequest(
    pseudoSession,
    npc,
    target,
  );
  assert.equal(
    blockedReacquisition.errorMsg,
    "TARGET_OBSTRUCTED",
    "lock retention does not permit acquiring a new lock through an occluder",
  );
});

test("the shared weapon damage path redirects damage and reports the obstruction", () => {
  const {
    applyWeaponDamageToTargetForTesting,
  } = require("../src/space/runtime")._testing;
  const attackerNotifications: any[] = [];
  const defenderNotifications: any[] = [];
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
    session: {
      sendNotification(...args) {
        attackerNotifications.push(args);
      },
    },
  });
  const target: any = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
    session: {
      sendNotification(...args) {
        defenderNotifications.push(args);
      },
    },
  });
  const blocker: any = buildShip({
    itemID: 1003,
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
    itemName: "Bulkhead",
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const scene = {
    getAllVisibleEntities: () => [source, target, blocker],
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 10,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 50 },
    1_000,
  );

  assert.equal(result.damageResult.success, true);
  assert.equal(result.destroyResult, null);
  assert.equal(result.occlusion.entityID, blocker.itemID);
  assert.equal(result.impactTargetEntity, blocker);
  assert.equal(result.intendedTargetEntity, target);
  assert.equal(result.redirected, true);
  assert.ok(blocker.conditionState.shieldCharge < 1);
  assert.equal(target.conditionState, undefined);
  assert.equal(attackerNotifications.length, 1);
  assert.equal(attackerNotifications[0][0], "OnRemoteMessage");
  assert.equal(attackerNotifications[0][2][0], "CustomNotify");
  assert.match(
    attackerNotifications[0][2][1].entries.find(([key]) => key === "notify")[1],
    /Weapon fire obstructed by Bulkhead/,
  );
  assert.equal(defenderNotifications.length, 1);
  assert.match(
    defenderNotifications[0][2][1].entries.find(([key]) => key === "notify")[1],
    /Incoming weapon fire was obstructed by Bulkhead/,
  );
});

test("collision damage bypasses weapon occlusion even for a native NPC source", () => {
  const source = buildShip({
    itemID: 2001,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
  });
  const blocker: any = buildShip({
    itemID: 2002,
    position: { x: 50, y: 0, z: 0 },
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const target: any = buildShip({
    itemID: 2003,
    position: { x: 100, y: 0, z: 0 },
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const scene = {
    getAllVisibleEntities: () => [source, blocker, target],
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 10,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
  };
  const result = runtime._testing.applyWeaponDamageToTargetForTesting(
    scene, source, target, { kinetic: 25 }, 1_000,
    { collisionImpact: true },
  );
  assert.equal(result.damageResult.success, true);
  assert.ok(target.conditionState.shieldCharge < 1);
  assert.equal(blocker.conditionState, undefined);
});

test("NPC behavior profiles cannot permit firing through physical occluders", () => {
  const {
    applyWeaponDamageToTargetForTesting,
    buildMissileDynamicEntityForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 1011,
    nativeNpc: true,
    npcBehaviorProfile: {
      fireThroughOccluders: true,
      retainTargetLockWhenOccluded: false,
    },
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const target: any = buildShip({
    itemID: 1012,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const blocker: any = buildShip({
    itemID: 1013,
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const scene = {
    getAllVisibleEntities: () => [source, target, blocker],
    getCurrentSimTimeMs: () => 1_000,
    getCurrentDestinyStamp: () => 10,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 50 },
    1_000,
  );

  assert.equal(result.occlusion.entityID, blocker.itemID);
  assert.equal(result.damageResult.success, true);
  assert.equal(result.impactTargetEntity, blocker);
  assert.equal(target.conditionState, undefined);
  assert.ok(blocker.conditionState.shieldCharge < 1);

  const missile = buildMissileDynamicEntityForTesting(
    source,
    target,
    {
      chargeTypeID: 5_001,
      maxVelocity: 1_000,
      flightTimeMs: 10_000,
    },
    1_000,
  );
  assert.equal(missile.npcFireThroughOccluders, false);
});

test("native NPC damage cannot bypass the shared occlusion gate", () => {
  const {
    applyWeaponDamageToTargetForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 1071,
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const target: any = buildShip({
    itemID: 1072,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const blocker = {
    itemID: 1073,
    kind: "siteEnvironmentProp",
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
  };
  const scene = {
    getAllVisibleEntities: () => [source, target, blocker],
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 50 },
    1_000,
    { skipWeaponOcclusion: true },
  );

  assert.equal(result.damageResult, null);
  assert.equal(result.destroyResult, null);
  assert.equal(result.occlusion.entityID, blocker.itemID);
  assert.equal(result.impactTargetEntity, blocker);
  assert.equal(target.conditionState, undefined);
});

test("the shared weapon damage path reveals a source that can hit the player", () => {
  const {
    applyWeaponDamageToTargetForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({ itemID: 1001 });
  const target = buildShip({
    itemID: 1002,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const revealCalls: any[] = [];
  const scene = {
    getCurrentSimTimeMs: () => 1000,
    getCurrentDestinyStamp: () => 10,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
    revealCombatSourceToTargetSession(attacker, victim, options) {
      revealCalls.push({ attacker, victim, options });
      return { revealed: true, delivered: true };
    },
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 10 },
    1000,
    { skipWeaponOcclusion: true },
  );

  assert.equal(result.damageResult.success, true);
  assert.equal(revealCalls.length, 1);
  assert.equal(revealCalls[0].attacker, source);
  assert.equal(revealCalls[0].victim, target);
  assert.equal(revealCalls[0].options.reason, "weapon-damage");
});

test("server-resolved skillshots can damage an unresolved contact", () => {
  const {
    applyWeaponDamageToTargetForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({ itemID: 1001 });
  const hiddenTarget: Record<string, any> = buildShip({
    itemID: 1002,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const observerSession = {
    _space: {
      shipID: source.itemID,
      visibleDynamicEntityIDs: new Set([source.itemID]),
    },
  };
  const scene = {
    getAllVisibleEntities: () => [source, hiddenTarget],
    getCurrentSimTimeMs: () => 1000,
    getCurrentDestinyStamp: () => 10,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
  };

  assert.equal(
    observerSession._space.visibleDynamicEntityIDs.has(hiddenTarget.itemID),
    false,
  );
  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    hiddenTarget,
    { em: 10 },
    1000,
    { skipWeaponOcclusion: true },
  );

  assert.equal(result.damageResult.success, true);
  assert.ok(hiddenTarget.conditionState.shieldCharge < 1);
});

test("missile sweeps collide with intervening targets without tunneling", () => {
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const intendedTarget = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
  });
  const blocker = buildShip({
    itemID: 1003,
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
  });
  const missile = {
    itemID: 2001,
    kind: "missile",
    mode: "MISSILE",
    sourceShipID: source.itemID,
    targetEntityID: intendedTarget.itemID,
    radius: 1,
    position: { x: 100, y: 0, z: 0 },
    velocity: { x: 100, y: 0, z: 0 },
  };
  const scene = {
    _activeTickSequence: 9,
    staticEntities: [],
    dynamicEntities: new Map<number, any>([
      [source.itemID, source],
      [intendedTarget.itemID, intendedTarget],
      [blocker.itemID, blocker],
      [missile.itemID, missile],
    ]),
  };

  const occlusion = findSweptWeaponOccluder(
    missile,
    scene,
    { x: 0, y: 0, z: 0 },
    {
      activeTickSequence: 9,
      ignoreEntityIDs: [source.itemID, intendedTarget.itemID],
    },
  );

  assert.equal(occlusion.entityID, blocker.itemID);
  assert.ok(Math.abs(occlusion.fraction - 0.39) < 1e-12);
  assert.ok(Math.abs(occlusion.position.x - 39) < 1e-9);
});

test("missile sweeps include the bounded rendered hull of dungeon structures", () => {
  const dungeonWall = {
    itemID: 1010,
    kind: "siteEnvironmentProp",
    dungeonMaterializedEnvironment: true,
    position: { x: 5_000, y: 5_300, z: 0 },
    radius: 500,
    collisionProfile: {
      boundingRadius: 5_000,
      balls: [],
      boxes: [],
      capsules: [],
      hasConvexMeshes: true,
    },
  };
  const missile = {
    itemID: 2010,
    kind: "missile",
    radius: 1,
    position: { x: 10_000, y: 0, z: 0 },
  };
  const scene = {
    staticEntities: [dungeonWall],
    dynamicEntities: new Map([[missile.itemID, missile]]),
  };

  assert.equal(
    findSweptWeaponOccluder(missile, scene, { x: 0, y: 0, z: 0 }),
    null,
    "an exact visibility-style sweep must not gain weapon-only padding",
  );
  const occlusion = findSweptWeaponOccluder(
    missile,
    scene,
    { x: 0, y: 0, z: 0 },
    { includeDungeonVisualHull: true },
  );
  assert.equal(occlusion.entityID, dungeonWall.itemID);
  assert.equal(occlusion.occlusionPaddingMeters, 500);
});

test("an occluded missile resolves against the blocker instead of its intended target", () => {
  const {
    resolveMissileLifecycleForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
  });
  const target: any = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const blocker = {
    itemID: 1003,
    kind: "authoredSpaceProp",
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
  };
  const missile = {
    itemID: 2001,
    kind: "missile",
    sourceShipID: source.itemID,
    sourceModuleID: 0,
    sourceModuleTypeID: 5001,
    targetEntityID: target.itemID,
    position: { x: 39, y: 0, z: 0 },
    radius: 1,
    maxVelocity: 100,
    expiresAtMs: 10_000,
    impactAtMs: 8_000,
    pendingGeometryImpact: true,
    pendingWeaponOcclusion: true,
    pendingGeometryImpactReason: "weapon-occlusion",
    pendingGeometryImpactAtMs: 1_000,
    pendingGeometryImpactEntityID: blocker.itemID,
    pendingGeometryImpactPosition: { x: 39, y: 0, z: 0 },
    missileSnapshot: {
      rawShotDamage: { em: 100 },
      explosionRadius: 1,
      explosionVelocity: 1_000,
      damageReductionFactor: 1,
    },
  };
  const entities = new Map<number, any>([
    [source.itemID, source],
    [target.itemID, target],
    [blocker.itemID, blocker],
    [missile.itemID, missile],
  ]);
  const removedIDs: number[] = [];
  const scene = {
    systemID: 30000001,
    getEntityByID: (entityID) => entities.get(Number(entityID)) || null,
    getCurrentDestinyStamp: () => 10,
    unregisterDynamicEntity: (entity) => {
      removedIDs.push(Number(entity.itemID));
      return { success: true };
    },
  };

  const result = resolveMissileLifecycleForTesting(scene, missile, 1_000);

  assert.equal(result.impact, true);
  assert.equal(result.removed, true);
  assert.equal(result.damageResult, null);
  assert.deepEqual(removedIDs, [missile.itemID]);
  assert.equal(target.conditionState, undefined);
});

test("ship lifecycle restores client collisions after undock, warp, and cloak", () => {
  const ship = buildShip({ position: { x: 0, y: 0, z: 0 } });
  const undockUpdates = buildUndockBootstrapMovementUpdates(ship, 10);
  assert.ok(undockUpdates.some((update) => payloadMassiveValue(update) === 1));

  const builders = createDestinyWarpUpdateBuilders({
    destiny: destinyActions,
    normalizeVector: (vector) => vector,
    scaleVector: (vector, scale) => ({
      x: vector.x * scale,
      y: vector.y * scale,
      z: vector.z * scale,
    }),
  });
  const warpCompletion = builders.buildWarpCompletionUpdates(ship, 12);
  assert.ok(warpCompletion.some((update) => payloadMassiveValue(update) === 1));

  const ownerUncloak = buildOwnerUncloakPresentationUpdates({
    stamp: 13,
    entityID: ship.itemID,
    includeRenderFx: false,
    includeMaxSpeed: false,
  });
  const observerUncloak = buildUncloakDeliveryPresentationUpdates({
    stamp: 13,
    entityID: ship.itemID,
    includeRenderFx: false,
  });
  assert.ok(ownerUncloak.some((update) => payloadMassiveValue(update) === 1));
  assert.ok(observerUncloak.some((update) => payloadMassiveValue(update) === 1));
});

test("session line of sight hides occluded targets until scanning resolves them", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 1001,
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 0, y: 0, z: 0 },
  });
  const target = buildShip({
    itemID: 1002,
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 100, y: 0, z: 0 },
  });
  const blocker = buildShip({
    itemID: 1003,
    bubbleID: 7,
    systemID: 30000001,
    position: { x: 50, y: 0, z: 0 },
  });
  const session: Record<string, any> = {
    _space: { shipID: source.itemID },
  };
  const scene = Object.create(SolarSystemScene.prototype);
  scene.dynamicEntities = new Map([
    [source.itemID, source],
    [target.itemID, target],
    [blocker.itemID, blocker],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();

  assert.equal(scene.hasLineOfSightForSession(session, target), false);
  blocker.position.y = 100;
  assert.equal(scene.hasLineOfSightForSession(session, target), true);

  scene.isNativeBallReplacementPendingForSession = () => false;
  scene.canSessionSeeAirNpeScopedEntity = () => true;
  scene.canSessionSeeDungeonScopedEntity = () => true;
  scene.isSessionInPilotWarpQuietWindow = () => false;
  scene.getVisibilityPublicGridKeyForEntity = () => "grid";
  scene.resolveVisibilityClusterKeyForSession = () => "grid";
  scene.getVisibilityPublicGridClusterKeyForEntity = () => "grid";
  scene.canSessionSeeEntityInPublicGrid = () => true;
  scene.hasLineOfSightForSession = () => false;

  session._space.initialStateSent = true;
  session._space.visibleDynamicEntityIDs = new Set();
  assert.deepEqual(
    scene.validateTargetLockRequest(session, source, target),
    { success: false, errorMsg: "TARGET_NOT_FOUND" },
    "an unresolved contact cannot be promoted to a Dogma target by guessing its ID",
  );
  assert.equal(scene.canSessionSeeDynamicEntity(session, target, 1999), false);
  session._space.frontierResolvedScanningContactsByID = new Map([
    [target.itemID, { resolveAtMs: 2000 }],
  ]);
  assert.equal(scene.canSessionSeeDynamicEntity(session, target, 1999), false);
  assert.equal(scene.canSessionSeeDynamicEntity(session, target, 2000), true);

  session._space.frontierResolvedScanningContactsByID = new Map();
  session._space.combatRevealedDynamicEntityIDs = new Set([target.itemID]);
  assert.equal(
    scene.canSessionSeeDynamicEntity(session, target, 2000),
    true,
    "an active combat reveal is independent of directional-scan resolution",
  );
});

test("an unresolved attacker resolves for its victim while bystanders get anonymous FX endpoints", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const victim = buildShip({ itemID: 1001 });
  const unresolvedSource: Record<string, any> = buildShip({
    itemID: 1002,
    nativeNpc: true,
    itemName: "Hostile Refuge Ship",
    slimName: "",
    suppressSlimName: true,
    nameID: 123456,
  });
  const bystander = buildShip({ itemID: 1003 });
  const victimSession: Record<string, any> = {
    clientID: 1,
    socket: { destroyed: false },
    _space: {
      shipID: victim.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([victim.itemID]),
      frontierResolvedScanningContactsByID: new Map([
        [1777, { entityID: 1777, resolveAtMs: 500, detectedAtMs: 500 }],
      ]),
    },
  };
  const bystanderSession: Record<string, any> = {
    clientID: 2,
    socket: { destroyed: false },
    _space: {
      shipID: bystander.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([bystander.itemID]),
    },
  };
  const delivered = new Map([
    [victimSession, [] as any[]],
    [bystanderSession, [] as any[]],
  ]);
  const acquiredEntities: any[] = [];
  const scene = Object.create(SolarSystemScene.prototype);
  scene.sessions = new Map([
    [1, victimSession],
    [2, bystanderSession],
  ]);
  scene.dynamicEntities = new Map([
    [victim.itemID, victim],
    [unresolvedSource.itemID, unresolvedSource],
    [bystander.itemID, bystander],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();
  scene.getCurrentSimTimeMs = () => 1000;
  scene.getCurrentDestinyStamp = () => 10;
  scene.getNextDestinyStamp = () => 11;
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendDestinyUpdates = (targetSession, updates) => {
    delivered.get(targetSession).push(...updates);
    return updates[0] && updates[0].stamp;
  };
  scene.sendAddBallsToSession = (
    targetSession,
    entities,
    options: Record<string, any> = {},
  ) => {
    acquiredEntities.push(...entities);
    const update = {
      stamp: 20,
      payload: ["AddBalls2", entities.map((entity) => entity.itemID)],
    };
    delivered.get(targetSession).push(update);
    if (options.visibilityAcquisition === true) {
      for (const entity of entities) {
        targetSession._space.visibleDynamicEntityIDs.add(entity.itemID);
      }
    }
    return { delivered: true, stamp: update.stamp };
  };

  const quietModule = scene.broadcastSpecialFx(
    unresolvedSource.itemID,
    "effects.Afterburner",
    { moduleID: 2001, start: true, active: true, isOffensive: false },
    unresolvedSource,
  );
  assert.equal(quietModule.deliveredCount, 0);
  assert.equal(delivered.get(victimSession).length, 0);
  assert.equal(delivered.get(bystanderSession).length, 0);

  const weaponFire = scene.broadcastSpecialFx(
    unresolvedSource.itemID,
    "effects.TriglavianBeam",
    {
      moduleID: 2002,
      targetID: victim.itemID,
      start: true,
      active: true,
      isOffensive: true,
    },
    unresolvedSource,
  );
  assert.equal(weaponFire.deliveredCount, 2);
  assert.deepEqual(
    delivered.get(victimSession).map((update) => update.payload[0]),
    ["AddBalls2", "OnSpecialFX"],
    "the attacker ball must arrive before its weapon effect",
  );
  assert.deepEqual(
    delivered.get(victimSession).map((update) => update.stamp),
    [20, 21],
    "the first weapon effect must execute after its source ball acquire",
  );
  assert.equal(acquiredEntities[0].suppressSlimName, false);
  assert.equal(acquiredEntities[0].slimName, "Hostile Refuge Ship");
  assert.equal(acquiredEntities[0].nameID, null);
  assert.equal(
    unresolvedSource.suppressSlimName,
    true,
    "combat presentation must not globally reveal the authored NPC identity",
  );
  assert.deepEqual(
    delivered.get(bystanderSession).map((update) => update.payload[0]),
    ["AddBalls2", "OnSpecialFX"],
    "the observer must receive anonymous endpoint balls before the weapon effect",
  );
  assert.deepEqual(
    delivered.get(bystanderSession).map((update) => update.stamp),
    [20, 21],
    "observer endpoint balls must exist before their first weapon effect",
  );
  const bystanderProxyIDs = delivered.get(bystanderSession)[0].payload[1];
  const bystanderFxArgs = delivered.get(bystanderSession)[1].payload[1];
  assert.equal(bystanderProxyIDs.length, 2);
  assert.equal(bystanderFxArgs[0], bystanderProxyIDs[0]);
  assert.equal(bystanderFxArgs[3], bystanderProxyIDs[1]);
  assert.equal(bystanderProxyIDs.includes(unresolvedSource.itemID), false);
  assert.equal(bystanderProxyIDs.includes(victim.itemID), false);
  assert.equal(acquiredEntities[1].omitSlimItem, true);
  assert.equal(acquiredEntities[2].omitSlimItem, true);
  assert.equal(
    victimSession._space.visibleDynamicEntityIDs.has(unresolvedSource.itemID),
    true,
  );
  assert.equal(
    victimSession._space.combatRevealedDynamicEntityIDs.has(
      unresolvedSource.itemID,
    ),
    true,
  );
  assert.equal(
    victimSession._space.frontierResolvedScanningContactsByID
      .get(unresolvedSource.itemID).resolveAtMs,
    1000,
    "hostile fire must immediately resolve the attacker in scanning state",
  );
  assert.equal(
    victimSession._space.frontierResolvedScanningContactsByID.has(1777),
    true,
    "combat resolution must not replace contacts from the latest scan",
  );
  assert.equal(
    bystanderSession._space.visibleDynamicEntityIDs.has(unresolvedSource.itemID),
    false,
    "unrelated observers must keep the out-of-range source unresolved",
  );
  assert.equal(
    bystanderSession._space.visibleDynamicEntityIDs.has(victim.itemID),
    false,
    "rendering the attack must not reveal its defender to an observer",
  );
  assert.equal(
    bystanderSession._space.frontierResolvedScanningContactsByID,
    undefined,
    "effect-only proxy balls must not mutate scanning resolution",
  );
});

test("weapon fire from an unresolved player source waits for its victim-side ball acquire", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const victim = buildShip({ itemID: 2001 });
  const attackerSession = { clientID: 12 };
  const unresolvedPlayer = buildShip({
    itemID: 2002,
    characterID: 90000002,
    pilotCharacterID: 90000002,
    itemName: "Hidden Player Ship",
    slimName: "Hidden Player Ship",
    session: attackerSession,
  });
  const victimSession: Record<string, any> = {
    clientID: 11,
    socket: { destroyed: false },
    _space: {
      shipID: victim.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([victim.itemID]),
    },
  };
  const delivered: any[] = [];
  const scene = Object.create(SolarSystemScene.prototype);
  scene.sessions = new Map([[victimSession.clientID, victimSession]]);
  scene.dynamicEntities = new Map([
    [victim.itemID, victim],
    [unresolvedPlayer.itemID, unresolvedPlayer],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();
  scene.getCurrentSimTimeMs = () => 2000;
  scene.getCurrentDestinyStamp = () => 20;
  scene.getNextDestinyStamp = () => 21;
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendAddBallsToSession = (targetSession, entities) => {
    for (const entity of entities) {
      targetSession._space.visibleDynamicEntityIDs.add(entity.itemID);
    }
    return { delivered: true, stamp: 30 };
  };
  scene.sendDestinyUpdates = (_targetSession, updates, _waitForBubble, options) => {
    delivered.push(...updates.map((update) => ({ update, options })));
    return updates[0] && updates[0].stamp;
  };

  const result = scene.sendSpecialFxToSession(
    victimSession,
    unresolvedPlayer.itemID,
    "effects.TriglavianBeam",
    {
      moduleID: 3002,
      targetID: victim.itemID,
      start: true,
      active: true,
      isOffensive: true,
    },
    unresolvedPlayer,
  );

  assert.equal(result.delivered, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].update.payload[0], "OnSpecialFX");
  assert.equal(delivered[0].update.stamp, 31);
  assert.equal(delivered[0].options.translateStamps, false);
  assert.equal(delivered[0].options.destinyAuthorityAllowPostHeldFuture, true);
  assert.equal(
    victimSession._space.visibleDynamicEntityIDs.has(unresolvedPlayer.itemID),
    true,
  );
  assert.equal(
    victimSession._space.frontierResolvedScanningContactsByID.has(
      unresolvedPlayer.itemID,
    ),
    true,
  );
});

test("combat reveal refreshes a preloaded unresolved NPC before delivering its effect", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const victim = buildShip({ itemID: 2051 });
  const source: Record<string, any> = buildShip({
    itemID: 2052,
    nativeNpc: true,
    categoryID: 11,
    slimCategoryID: 11,
    itemName: "Preloaded Hostile",
    slimName: "",
    suppressSlimName: true,
    nameID: 987654,
  });
  const session: Record<string, any> = {
    clientID: 15,
    socket: { destroyed: false },
    _space: {
      shipID: victim.itemID,
      initialStateSent: true,
      // The physical ball was acquired while unresolved. Server membership
      // alone must not be mistaken for resolved client CR/HUD presentation.
      visibleDynamicEntityIDs: new Set([victim.itemID, source.itemID]),
    },
  };
  const addCalls: any[] = [];
  const delivered: any[] = [];
  const scene = Object.create(SolarSystemScene.prototype);
  scene.sessions = new Map([[session.clientID, session]]);
  scene.dynamicEntities = new Map([
    [victim.itemID, victim],
    [source.itemID, source],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();
  scene.getCurrentSimTimeMs = () => 2100;
  scene.getCurrentDestinyStamp = () => 21;
  scene.getNextDestinyStamp = () => 22;
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendAddBallsToSession = (_targetSession, entities, options) => {
    addCalls.push({ entities, options });
    return { delivered: true, stamp: 40 };
  };
  scene.sendDestinyUpdates = (_targetSession, updates, _wait, options) => {
    delivered.push(...updates.map((update) => ({ update, options })));
    return updates[0] && updates[0].stamp;
  };

  const result = scene.sendSpecialFxToSession(
    session,
    source.itemID,
    "effects.Laser",
    {
      moduleID: 3003,
      targetID: victim.itemID,
      start: true,
      active: true,
      isOffensive: true,
    },
    source,
  );

  assert.equal(result.delivered, true);
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].options.visibilityAcquisition, false);
  assert.equal(addCalls[0].options.freshAcquire, true);
  assert.equal(addCalls[0].entities[0].slimName, "Preloaded Hostile");
  assert.equal(addCalls[0].entities[0].nameID, null);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].update.payload[0], "OnSpecialFX");
  assert.equal(delivered[0].update.stamp, 41);
  assert.equal(delivered[0].options.translateStamps, false);
  assert.equal(delivered[0].options.destinyAuthorityAllowPostHeldFuture, true);
  assert.equal(
    session._space.combatRevealPresentationEntityIDs.has(source.itemID),
    true,
  );
});

test("bystander weapon FX retain a visible source and proxy only the hidden defender", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 2101,
    position: { x: 0, y: 0, z: 0 },
  });
  const hiddenDefender = buildShip({
    itemID: 2102,
    position: { x: 10_000, y: 0, z: 0 },
  });
  const bystander = buildShip({
    itemID: 2103,
    position: { x: 5_000, y: 1_000, z: 0 },
  });
  const session: Record<string, any> = {
    clientID: 21,
    socket: { destroyed: false },
    _space: {
      shipID: bystander.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([bystander.itemID, source.itemID]),
    },
  };
  const delivered: any[] = [];
  const scene = Object.create(SolarSystemScene.prototype);
  scene.sessions = new Map([[session.clientID, session]]);
  scene.dynamicEntities = new Map([
    [source.itemID, source],
    [hiddenDefender.itemID, hiddenDefender],
    [bystander.itemID, bystander],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();
  scene.getCurrentSimTimeMs = () => 2500;
  scene.getCurrentDestinyStamp = () => 25;
  scene.getNextDestinyStamp = () => 26;
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendDestinyUpdates = (_targetSession, updates) => {
    delivered.push(...updates);
    return updates[0] && updates[0].stamp;
  };
  scene.sendAddBallsToSession = (_targetSession, entities) => {
    const update = {
      stamp: 30,
      payload: ["AddBalls2", entities.map((entity) => entity.itemID)],
    };
    delivered.push(update);
    return { delivered: true, stamp: update.stamp };
  };

  const start = scene.broadcastSpecialFx(
    source.itemID,
    "effects.TriglavianBeam",
    {
      moduleID: 2201,
      targetID: hiddenDefender.itemID,
      start: true,
      active: true,
      isOffensive: true,
    },
    source,
  );
  assert.equal(start.deliveredCount, 1);
  assert.deepEqual(
    delivered.map((update) => update.payload[0]),
    ["AddBalls2", "OnSpecialFX"],
  );
  const proxyID = delivered[0].payload[1][0];
  assert.equal(delivered[1].payload[1][0], source.itemID);
  assert.equal(delivered[1].payload[1][3], proxyID);
  assert.notEqual(proxyID, hiddenDefender.itemID);
  assert.equal(
    session._space.visibleDynamicEntityIDs.has(hiddenDefender.itemID),
    false,
  );

  // Resolving the defender while the effect is active can replay the same FX
  // on real ball IDs. The stop path must end both forms before proxy teardown.
  session._space.visibleDynamicEntityIDs.add(hiddenDefender.itemID);
  const stop = scene.broadcastSpecialFx(
    source.itemID,
    "effects.TriglavianBeam",
    {
      moduleID: 2201,
      targetID: hiddenDefender.itemID,
      start: false,
      active: false,
      isOffensive: true,
    },
    source,
  );
  assert.equal(stop.deliveredCount, 1);
  assert.deepEqual(
    delivered.slice(2).map((update) => update.payload[0]),
    ["OnSpecialFX", "OnSpecialFX", "RemoveBalls"],
    "the stop effect must run before its anonymous endpoint is discarded",
  );
  assert.equal(delivered[2].payload[1][0], source.itemID);
  assert.equal(delivered[2].payload[1][3], proxyID);
  assert.equal(delivered[3].payload[1][0], source.itemID);
  assert.equal(delivered[3].payload[1][3], hiddenDefender.itemID);
  assert.equal(session._space.combatEffectProxyState.entriesByRealEntityID.size, 0);
});

test("weapon FX use the fitting-slot key expected by client hardpoints", () => {
  const {
    resolveSpecialFxOptionsForEntityForTesting,
  } = require("../src/space/runtime")._testing;
  const ship = buildShip({ categoryID: 6, slimCategoryID: 6 });

  const weaponFx = resolveSpecialFxOptionsForEntityForTesting(
    ship.itemID,
    {
      moduleID: 9988400000361,
      moduleFlagID: 27,
      moduleTypeID: 81974,
      weaponFamily: "projectileTurret",
      isOffensive: true,
    },
    ship,
  );
  assert.equal(weaponFx.moduleID, 27);
  assert.equal(weaponFx.moduleFlagID, 27);

  const utilityFx = resolveSpecialFxOptionsForEntityForTesting(
    ship.itemID,
    {
      moduleID: 9988400000362,
      moduleFlagID: 19,
      weaponFamily: "",
      isOffensive: false,
    },
    ship,
  );
  assert.equal(utilityFx.moduleID, 9988400000362);

  const npcShip = buildShip({ itemID: 1002, nativeNpc: true });
  const npcWeaponFx = resolveSpecialFxOptionsForEntityForTesting(
    npcShip.itemID,
    {
      moduleID: 980100000001,
      moduleFlagID: 27,
      weaponFamily: "projectileTurret",
      isOffensive: true,
    },
    npcShip,
  );
  assert.equal(npcWeaponFx.moduleID, npcShip.itemID);
});

test("ship CR data exposes fitted modules as client type-and-flag pairs", () => {
  const {
    normalizeSlimShipModulesForTesting,
  } = require("../src/space/runtime")._testing;

  assert.deepEqual(
    normalizeSlimShipModulesForTesting([
      [9988400000361, 81974, 27],
      [12058, 28],
      { itemID: 9988400000363, typeID: 522, flagID: 29 },
    ]),
    [
      [81974, 27],
      [12058, 28],
      [522, 29],
    ],
  );
});
