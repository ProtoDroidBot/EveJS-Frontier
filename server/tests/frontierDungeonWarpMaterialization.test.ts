"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const config = require("../src/config");
const deadspaceWarpPolicy = require(
  "../src/services/dungeon/deadspaceWarpPolicy",
);
const {
  createMovementWarpCommands,
} = require("../src/space/destiny/commands/warpCommands");

function cloneVector(value) {
  return {
    x: Number(value && value.x) || 0,
    y: Number(value && value.y) || 0,
    z: Number(value && value.z) || 0,
  };
}

function createWarpFixture(options: Record<string, any> = {}) {
  const initializeSessionlessCalls: any[] = [];
  const materializeCalls: any[] = [];
  const prewarmCalls: any[] = [];
  const gotoCalls: any[] = [];
  const fuelCheckCalls: any[] = [];
  const capacitorCheckCalls: any[] = [];
  const capacitorDebitCalls: any[] = [];
  const stopCalls: any[] = [];
  let jumpCloakCancelCount = 0;
  const session = { characterID: 140_000_001 };
  const ship: Record<string, any> = {
    itemID: 9_000_000_001,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    maxVelocity: 250,
    capacitorCapacity: 100,
    capacitorChargeRatio: 1,
    radius: 50,
    warpSpeedAU: 3,
    pendingWarp: null,
    pendingDock: null,
  };
  const runtime: Record<string, any> = {
    systemID: 30_000_142,
    getShipEntityForSession: () => ship,
    getEntityByID: (entityID) => (
      options.target && Number(options.target.itemID) === Number(entityID)
        ? options.target
        : null
    ),
    isEntityWarpBlockedByCloak: () => false,
    resolveAuthorizedDestinationDungeonContext: (
      _session,
      instanceID,
      requestedContext: Record<string, any> = {},
    ) => ({
      instanceID,
      roomKey: requestedContext.roomKey || "room:entry",
      siteID: requestedContext.siteID || 7_200_000_000_001,
    }),
    getCurrentSimTimeMs: () => 50_000,
    getMovementStamp: () => 100,
    getCurrentDestinyStamp: () => 100,
    cancelStargateJumpCloakBeforePilotCommand: () => {
      jumpCloakCancelCount += 1;
    },
    clearPendingSubwarpMovementContract: () => undefined,
    broadcastMovementUpdates: () => undefined,
    scheduleWatcherMovementAnchor: () => undefined,
    beginWarpDepartureOwnership: () => undefined,
    beginPilotWarpVisibilityHandoff: () => undefined,
    stopShipEntity: (entity, stopOptions) => {
      stopCalls.push({ entity, options: stopOptions });
      entity.pendingWarp = null;
      entity.warpState = null;
      entity.mode = "STOP";
      entity.speedFraction = 0;
      return true;
    },
  };
  const commands = createMovementWarpCommands({
    activatePendingWarp: (entity, pendingWarp) => {
      const warpState = {
        phase: "active",
        targetPoint: cloneVector(pendingWarp.rawDestination),
      };
      entity.pendingWarp = null;
      entity.warpState = warpState;
      entity.mode = "WARP";
      return warpState;
    },
    armMovementTrace: () => undefined,
    buildDirectedMovementUpdates: () => [],
    buildOfficialWarpReferenceProfile: () => ({}),
    buildPendingWarpRequest: (_entity, destination, requestOptions) => {
      const rawDestination = cloneVector(destination);
      const delta = {
        x: rawDestination.x - ship.position.x,
        y: rawDestination.y - ship.position.y,
        z: rawDestination.z - ship.position.z,
      };
      const length = Math.hypot(delta.x, delta.y, delta.z) || 1;
      const stopDistance = Math.max(0, Number(requestOptions.stopDistance) || 0);
      return {
        rawDestination,
        targetPoint: {
          x: rawDestination.x - ((delta.x / length) * stopDistance),
          y: rawDestination.y - ((delta.y / length) * stopDistance),
          z: rawDestination.z - ((delta.z / length) * stopDistance),
        },
        stopDistance,
        totalDistance: options.pendingWarpDistance ?? 2_000_000,
        warpSpeedAU: requestOptions.warpSpeedAU,
        targetEntityID: requestOptions.targetEntityID || null,
        destinationStaticInstanceID:
          requestOptions.destinationStaticInstanceID ?? null,
        destinationDungeonRoomKey:
          requestOptions.destinationDungeonRoomKey || null,
        destinationDungeonSiteID:
          requestOptions.destinationDungeonSiteID ?? null,
      };
    },
    buildPreparingWarpState: () => ({ phase: "preparing" }),
    buildWarpPrepareDispatch: () => ({ sharedUpdates: [] }),
    buildWarpStartUpdates: () => [],
    checkWarpCapacitorAvailability: (entity) => {
      capacitorCheckCalls.push(entity);
      return options.capacitorCheckResult || { success: true };
    },
    checkWarpFuelAvailability: (entity) => {
      fuelCheckCalls.push(entity);
      return options.fuelCheckResult || { success: true };
    },
    clearTrackingState: () => undefined,
    cloneVector,
    consumeWarpCapacitor: (entity, nowMs) => {
      capacitorDebitCalls.push({ entity, nowMs });
      if (options.capacitorDebitResult) {
        return options.capacitorDebitResult;
      }
      entity.capacitorChargeRatio -= 0.15;
      return { success: true };
    },
    deactivateWarpUnsafeActiveModulesForWarpStart: () => ({ success: true }),
    findActiveWarpDisruptorForEntity: () => null,
    getClientParityWarpInPoint: () => null,
    getStationWarpTargetPosition: (target) => cloneVector(target.position),
    getTargetMotionPosition: (target) => cloneVector(target.position),
    getWarpStopDistanceForTarget: (shipEntity, target, minimumRange) => (
      Math.max(1_000, Number(target.radius) || 0, Number(minimumRange) || 0) +
      ((Number(shipEntity.radius) || 0) * 2)
    ),
    gotoPointEntity: (gotoRuntime, gotoEntity, destination, gotoOptions) => {
      gotoCalls.push({
        runtime: gotoRuntime,
        entity: gotoEntity,
        destination: cloneVector(destination),
        options: gotoOptions,
      });
      return true;
    },
    hasPendingPilotWarpLanding: () => false,
    isReadyForDestiny: () => false,
    initializeSessionlessWarpDestination: (
      initializeRuntime,
      initializeEntity,
      destination,
      initializeOptions,
    ) => {
      initializeSessionlessCalls.push({
        runtime: initializeRuntime,
        entity: initializeEntity,
        destination: cloneVector(destination),
        options: initializeOptions,
        pendingWarpAtCall: ship.pendingWarp,
      });
      return options.initializeSessionlessResult || { success: true };
    },
    logMovementDebug: () => undefined,
    logWarpDebug: () => undefined,
    materializeDungeonWarpDestination: (
      materializeRuntime,
      materializeSession,
      instanceID,
      materializeOptions,
    ) => {
      materializeCalls.push({
        runtime: materializeRuntime,
        session: materializeSession,
        instanceID,
        options: materializeOptions,
        pendingWarpAtCall: ship.pendingWarp,
      });
      return options.materializeResult || { success: true };
    },
    normalizeVector: (value) => cloneVector(value),
    persistShipEntity: () => undefined,
    prewarmStartupControllersForWarpDestination: (
      prewarmRuntime,
      prewarmOptions,
    ) => {
      prewarmCalls.push({
        runtime: prewarmRuntime,
        options: prewarmOptions,
      });
      return { success: true };
    },
    primePilotWarpActivationState: () => undefined,
    subtractVectors: (left, right) => ({
      x: left.x - right.x,
      y: left.y - right.y,
      z: left.z - right.z,
    }),
    summarizePendingWarp: (pendingWarp) => pendingWarp,
    tagUpdatesRequireExistingVisibility: (updates) => updates,
    toFiniteNumber: (value, fallback = 0) => (
      Number.isFinite(Number(value)) ? Number(value) : fallback
    ),
    toInt: (value, fallback = 0) => (
      Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback
    ),
    DESTINY_STAMP_INTERVAL_MS: 100,
    MIN_WARP_DISTANCE_METERS: 150_000,
    PILOT_WARP_ACTIVATION_DELAY_DESTINY_TICKS: 2,
    MICHELLE_POST_HELD_FUTURE_DESTINY_LEAD: 2,
  });
  runtime.warpToPoint = (warpSession, destination, warpOptions) => (
    commands.warpToPoint(runtime, warpSession, destination, warpOptions)
  );
  return {
    commands,
    capacitorCheckCalls,
    capacitorDebitCalls,
    fuelCheckCalls,
    gotoCalls,
    initializeSessionlessCalls,
    materializeCalls,
    prewarmCalls,
    stopCalls,
    runtime,
    session,
    ship,
    getJumpCloakCancelCount: () => jumpCloakCancelCount,
  };
}

test("warp fuel preflight fails before player or sessionless departure side effects", () => {
  for (const sessionless of [false, true]) {
    const fixture = createWarpFixture({
      fuelCheckResult: { success: false, errorMsg: "NO_FUEL" },
    });
    const result = sessionless
      ? fixture.commands.warpDynamicEntityToPoint(
          fixture.runtime,
          fixture.ship,
          { x: 2_000_000, y: 0, z: 0 },
          { ignoreWarpDisruptionField: true },
        )
      : fixture.commands.warpToPoint(
          fixture.runtime,
          fixture.session,
          { x: 2_000_000, y: 0, z: 0 },
          {
            ignoreCrimewatchCheck: true,
            ignoreDeadspaceWarpRestriction: true,
            ignoreWarpDisruptionField: true,
          },
        );
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "NO_FUEL");
    assert.equal(fixture.fuelCheckCalls.length, 1);
    assert.equal(fixture.ship.pendingWarp, null);
    assert.equal(fixture.initializeSessionlessCalls.length, 0);
    assert.equal(fixture.materializeCalls.length, 0);
    assert.equal(fixture.prewarmCalls.length, 0);
  }
});

test("warp capacitor preflight denies departure without consuming charge", () => {
  for (const sessionless of [false, true]) {
    const fixture = createWarpFixture({
      capacitorCheckResult: {
        success: false,
        errorMsg: "NOT_ENOUGH_CAPACITOR",
      },
    });
    const result = sessionless
      ? fixture.commands.warpDynamicEntityToPoint(
          fixture.runtime,
          fixture.ship,
          { x: 2_000_000, y: 0, z: 0 },
          { ignoreWarpDisruptionField: true },
        )
      : fixture.commands.warpToPoint(
          fixture.runtime,
          fixture.session,
          { x: 2_000_000, y: 0, z: 0 },
          {
            ignoreCrimewatchCheck: true,
            ignoreDeadspaceWarpRestriction: true,
            ignoreWarpDisruptionField: true,
          },
        );
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "NOT_ENOUGH_CAPACITOR");
    assert.equal(fixture.capacitorCheckCalls.length, 1);
    assert.equal(fixture.capacitorDebitCalls.length, 0);
    assert.equal(fixture.ship.capacitorChargeRatio, 1);
    assert.equal(fixture.initializeSessionlessCalls.length, 0);
    assert.equal(fixture.materializeCalls.length, 0);
    assert.equal(fixture.prewarmCalls.length, 0);
  }
});

test("warp activation rechecks fuel after alignment and cancels safely", () => {
  const fixture = createWarpFixture({
    fuelCheckResult: { success: false, errorMsg: "NO_FUEL" },
  });
  fixture.ship.mode = "WARP";
  fixture.ship.warpState = { phase: "preparing" };
  fixture.ship.pendingWarp = {
    nativeWarpCommand: "WARP",
    rawDestination: { x: 2_000_000, y: 0, z: 0 },
  };

  const result = fixture.commands.forceStartPendingWarp(
    fixture.runtime,
    fixture.ship,
    { nowMs: 50_000 },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "NO_FUEL");
  assert.equal(fixture.fuelCheckCalls.length, 1);
  assert.equal(fixture.stopCalls.length, 1);
  assert.equal(fixture.stopCalls[0].options.reason, "warpFuelUnavailableAtActivation");
  assert.equal(fixture.ship.pendingWarp, null);
  assert.equal(fixture.ship.warpState, null);
  assert.equal(fixture.ship.mode, "STOP");
});

test("successful warp activation debits capacitor exactly once", () => {
  const fixture = createWarpFixture();
  fixture.ship.mode = "WARP";
  fixture.ship.warpState = { phase: "preparing" };
  fixture.ship.pendingWarp = {
    nativeWarpCommand: "WARP",
    rawDestination: { x: 2_000_000, y: 0, z: 0 },
  };

  const result = fixture.commands.forceStartPendingWarp(
    fixture.runtime,
    fixture.ship,
    { nowMs: 50_000 },
  );

  assert.equal(result.success, true);
  assert.equal(fixture.capacitorCheckCalls.length, 1);
  assert.equal(fixture.capacitorDebitCalls.length, 1);
  assert.equal(fixture.ship.capacitorChargeRatio, 0.85);
});

test("a sessionless NPC warp initializes and prewarms its destination before departure", () => {
  const fixture = createWarpFixture();
  const targetEntityID = 7_200_000_000_099;
  const result = fixture.commands.warpDynamicEntityToPoint(
    fixture.runtime,
    fixture.ship,
    { x: 2_000_000, y: 50_000, z: -25_000 },
    {
      targetEntityID,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(fixture.initializeSessionlessCalls.length, 1);
  assert.equal(
    fixture.initializeSessionlessCalls[0].pendingWarpAtCall,
    null,
  );
  assert.equal(
    fixture.initializeSessionlessCalls[0].options.targetEntityID,
    targetEntityID,
  );
  assert.deepEqual(fixture.initializeSessionlessCalls[0].destination, {
    x: 2_000_000,
    y: 50_000,
    z: -25_000,
  });
  assert.equal(fixture.prewarmCalls.length, 1);
  assert.equal(
    fixture.prewarmCalls[0].options.dematerializeAmbientStartup,
    false,
  );
  assert.equal(
    fixture.prewarmCalls[0].options.dematerializeDormantCombat,
    false,
  );
  assert.ok(fixture.ship.pendingWarp);
});

test("a sessionless NPC does not depart when destination initialization fails", () => {
  const fixture = createWarpFixture({
    initializeSessionlessResult: {
      success: false,
      errorMsg: "NPC_WARP_DESTINATION_INITIALIZATION_FAILED",
    },
  });
  const result = fixture.commands.warpDynamicEntityToPoint(
    fixture.runtime,
    fixture.ship,
    { x: 2_000_000, y: 0, z: 0 },
    { ignoreWarpDisruptionField: true },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "NPC_WARP_DESTINATION_INITIALIZATION_FAILED");
  assert.equal(fixture.initializeSessionlessCalls.length, 1);
  assert.equal(fixture.prewarmCalls.length, 0);
  assert.equal(fixture.ship.pendingWarp, null);
});

test("a nearby dungeon site beacon uses native approach instead of failing warp", () => {
  const fixture = createWarpFixture({ pendingWarpDistance: 50_000 });
  const instanceID = 7_100_000_000_000;
  const siteID = 7_200_000_000_001;
  const result = fixture.commands.warpToPoint(
    fixture.runtime,
    fixture.session,
    { x: 50_000, y: 0, z: 0 },
    {
      destinationStaticInstanceID: instanceID,
      destinationDungeonRoomKey: "room:entry",
      destinationDungeonSiteID: siteID,
      targetEntityID: siteID,
      ignoreCrimewatchCheck: true,
      ignoreDeadspaceWarpRestriction: true,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.nativeGotoFallback, true);
  assert.equal(fixture.gotoCalls.length, 1);
  assert.deepEqual(fixture.gotoCalls[0].destination, {
    x: 40_000,
    y: 0,
    z: 0,
  });
  assert.equal(fixture.materializeCalls.length, 0);
});

test("authorized dungeon warp materializes its NPC encounter before warp state begins", () => {
  const fixture = createWarpFixture();
  const instanceID = 7_100_000_000_001;
  const result = fixture.commands.warpToPoint(
    fixture.runtime,
    fixture.session,
    { x: 2_000_000, y: 0, z: 0 },
    {
      destinationStaticInstanceID: instanceID,
      destinationDungeonRoomKey: "room:entry",
      destinationDungeonSiteID: 7_200_000_000_001,
      ignoreCrimewatchCheck: true,
      ignoreDeadspaceWarpRestriction: true,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(fixture.materializeCalls.length, 1);
  assert.equal(fixture.materializeCalls[0].instanceID, instanceID);
  assert.equal(fixture.materializeCalls[0].pendingWarpAtCall, null);
  assert.equal(fixture.materializeCalls[0].options.nowMs, 50_000);
  assert.equal(fixture.ship.pendingWarp.destinationStaticInstanceID, instanceID);
  assert.equal(fixture.ship.pendingWarp.destinationDungeonRoomKey, "room:entry");
  assert.equal(fixture.ship.pendingWarp.stopDistance, 10_000);
});

test("warp at zero to a dungeon root keeps a ten-kilometre entry stand-off", () => {
  const instanceID = 7_100_000_000_010;
  const siteID = 7_200_000_000_010;
  const target = {
    itemID: siteID,
    kind: "universeAnomalySite",
    position: { x: 2_000_000, y: 0, z: 0 },
    radius: 2_000,
    dungeonSiteInstanceID: instanceID,
    dungeonSiteID: siteID,
    dungeonWarpInDistanceMeters: 10_000,
  };
  const fixture = createWarpFixture({ target });
  const result = fixture.commands.warpToEntity(
    fixture.runtime,
    fixture.session,
    siteID,
    {
      minimumRange: 0,
      destinationStaticInstanceID: instanceID,
      destinationDungeonRoomKey: "room:entry",
      destinationDungeonSiteID: siteID,
      ignoreCrimewatchCheck: true,
      ignoreDeadspaceWarpRestriction: true,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(fixture.ship.pendingWarp.stopDistance, 10_100);
  assert.deepEqual(fixture.ship.pendingWarp.targetPoint, {
    x: 1_989_900,
    y: 0,
    z: 0,
  });
});

test("acceleration-gate transit keeps its authored room destination", () => {
  const fixture = createWarpFixture();
  const result = fixture.commands.warpToPoint(
    fixture.runtime,
    fixture.session,
    { x: 2_000_000, y: 0, z: 0 },
    {
      destinationStaticInstanceID: 7_100_000_000_011,
      destinationDungeonRoomKey: "room:mission_2",
      destinationDungeonSiteID: 7_200_000_000_011,
      dungeonGateTransit: true,
      stopDistance: 0,
      ignoreCrimewatchCheck: true,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(fixture.ship.pendingWarp.stopDistance, 0);
  assert.deepEqual(
    fixture.ship.pendingWarp.targetPoint,
    fixture.ship.pendingWarp.rawDestination,
  );
});

test("a deadspace-clamped coordinate warp retains the dungeon identity and materializes it", () => {
  const fixture = createWarpFixture();
  const instanceID = 7_100_000_000_002;
  const originalRestriction = config.deadspaceWarpRestrictionEnabled;
  const originalEvaluate = deadspaceWarpPolicy.evaluateDeadspaceWarp;
  config.deadspaceWarpRestrictionEnabled = true;
  deadspaceWarpPolicy.evaluateDeadspaceWarp = () => ({
    action: "clamp",
    point: { x: 2_500_000, y: 25_000, z: -10_000 },
    siteInstanceID: instanceID,
  });
  try {
    const result = fixture.commands.warpToPoint(
      fixture.runtime,
      fixture.session,
      { x: 2_550_000, y: 25_000, z: -10_000 },
      {
        ignoreCrimewatchCheck: true,
        ignoreWarpDisruptionField: true,
      },
    );

    assert.equal(result.success, true);
    assert.equal(fixture.materializeCalls.length, 1);
    assert.equal(fixture.materializeCalls[0].instanceID, instanceID);
    assert.equal(fixture.ship.pendingWarp.destinationStaticInstanceID, instanceID);
    assert.deepEqual(fixture.ship.pendingWarp.rawDestination, {
      x: 2_500_000,
      y: 25_000,
      z: -10_000,
    });
    assert.equal(fixture.ship.pendingWarp.stopDistance, 10_000);
    assert.ok(
      Math.abs(
        Math.hypot(
          fixture.ship.pendingWarp.rawDestination.x - fixture.ship.pendingWarp.targetPoint.x,
          fixture.ship.pendingWarp.rawDestination.y - fixture.ship.pendingWarp.targetPoint.y,
          fixture.ship.pendingWarp.rawDestination.z - fixture.ship.pendingWarp.targetPoint.z,
        ) - 10_000,
      ) < 0.001,
    );
  } finally {
    config.deadspaceWarpRestrictionEnabled = originalRestriction;
    deadspaceWarpPolicy.evaluateDeadspaceWarp = originalEvaluate;
  }
});

test("dungeon warp fails before departure when encounter materialization fails", () => {
  const fixture = createWarpFixture({
    materializeResult: {
      success: false,
      errorMsg: "DUNGEON_DESTINATION_MATERIALIZATION_FAILED",
    },
  });
  const result = fixture.commands.warpToPoint(
    fixture.runtime,
    fixture.session,
    { x: 2_000_000, y: 0, z: 0 },
    {
      destinationStaticInstanceID: 7_100_000_000_003,
      ignoreCrimewatchCheck: true,
      ignoreDeadspaceWarpRestriction: true,
      ignoreWarpDisruptionField: true,
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "DUNGEON_DESTINATION_MATERIALIZATION_FAILED");
  assert.equal(fixture.ship.pendingWarp, null);
  assert.equal(fixture.getJumpCloakCancelCount(), 0);
});
