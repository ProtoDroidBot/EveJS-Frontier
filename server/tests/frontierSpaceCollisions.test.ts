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

const getStationUndockSpawnState =
  runtime._testing.getStationUndockSpawnStateForTesting;

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
  assert.deepEqual(ship.velocity, { x: 0, y: 0, z: 0 });
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
  const target = buildShip({
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

test("the shared weapon damage path rejects damage through an occluder", () => {
  const {
    applyWeaponDamageToTargetForTesting,
  } = require("../src/space/runtime")._testing;
  const source = buildShip({
    itemID: 1001,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
  });
  const target = buildShip({
    itemID: 1002,
    position: { x: 100, y: 0, z: 0 },
    radius: 10,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
  });
  const blocker = buildShip({
    itemID: 1003,
    position: { x: 50, y: 0, z: 0 },
    radius: 10,
  });
  const scene = {
    getAllVisibleEntities: () => [source, target, blocker],
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 50 },
    1_000,
  );

  assert.equal(result.damageResult, null);
  assert.equal(result.destroyResult, null);
  assert.equal(result.occlusion.entityID, blocker.itemID);
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
});

test("unresolved weapon fire is presented without materializing its source", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const observer = buildShip({ itemID: 1001 });
  const unresolvedSource = buildShip({ itemID: 1002 });
  const session: Record<string, any> = {
    socket: { destroyed: false },
    _space: {
      shipID: observer.itemID,
      initialStateSent: true,
      visibleDynamicEntityIDs: new Set([observer.itemID]),
    },
  };
  const delivered: any[] = [];
  const scene = Object.create(SolarSystemScene.prototype);
  scene.sessions = new Map([[1, session]]);
  scene.dynamicEntities = new Map([
    [observer.itemID, observer],
    [unresolvedSource.itemID, unresolvedSource],
  ]);
  scene.staticEntities = [];
  scene.staticEntitiesByID = new Map();
  scene.getCurrentSimTimeMs = () => 1000;
  scene.getCurrentDestinyStamp = () => 10;
  scene.getNextDestinyStamp = () => 11;
  scene.canSessionSeeDynamicEntity = () => false;
  scene.sendDestinyUpdates = (_session, updates) => {
    delivered.push(...updates);
    return updates[0] && updates[0].stamp;
  };

  const quietModule = scene.broadcastSpecialFx(
    unresolvedSource.itemID,
    "effects.Afterburner",
    { moduleID: 2001, start: true, active: true, isOffensive: false },
    unresolvedSource,
  );
  assert.equal(quietModule.deliveredCount, 0);
  assert.equal(delivered.length, 0);

  const weaponFire = scene.broadcastSpecialFx(
    unresolvedSource.itemID,
    "effects.TriglavianBeam",
    {
      moduleID: 2002,
      targetID: observer.itemID,
      start: true,
      active: true,
      isOffensive: true,
    },
    unresolvedSource,
  );
  assert.equal(weaponFire.deliveredCount, 1);
  assert.ok(delivered.some((update) => update.payload[0] === "OnSpecialFX"));
  assert.equal(
    delivered.some((update) => update.payload[0] === "AddBalls2"),
    false,
  );
  assert.deepEqual(
    [...session._space.visibleDynamicEntityIDs],
    [observer.itemID],
    "weapon FX must not resolve or materialize the hidden ship",
  );
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
