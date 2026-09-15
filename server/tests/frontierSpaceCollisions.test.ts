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
