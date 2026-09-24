"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { marshalEncode } = require("../src/network/tcp/utils/marshal");
const abilityRuntime = require("../src/services/frontier/creationAbilityRuntime");
const handlers = require("../src/services/frontier/creationActiveModuleAbilityHandlers");
const runtime = require("../src/services/frontier/creationActiveModuleRuntime");
const { buildCreationAbilityResponse } = require("../src/services/frontier/creationService");
const spaceRuntime = require("../src/space/runtime");
const itemStore = require("../src/services/inventory/itemStore");
const gameStore = require("../src/gameStore");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildMemoryShipStore(items, options: Record<string, any> = {}) {
  const records: Map<number, any> = new Map(
    items.map((item) => [item.itemID, clone(item)]),
  );
  const writes = [];
  return {
    records,
    writes,
    findShipItemById(itemID) {
      const item = records.get(Number(itemID));
      return item ? clone(item) : null;
    },
    updateShipItem(itemID, updater) {
      const numericID = Number(itemID);
      const current = records.get(numericID);
      if (!current) return { success: false, errorMsg: "SHIP_NOT_FOUND" };
      if (options.failItemID === numericID && !options.failed) {
        options.failed = true;
        return { success: false, errorMsg: "WRITE_ERROR" };
      }
      const next = typeof updater === "function" ? updater(clone(current)) : updater;
      if (!next) return { success: false, errorMsg: "INVALID_SHIP_STATE" };
      records.set(numericID, clone(next));
      writes.push(numericID);
      return { success: true, data: clone(next), previousData: clone(current) };
    },
  };
}

function effect(kind, attributes): Record<string, any> {
  return {
    creationActiveModuleEffect: true,
    creationActiveKind: kind,
    creationModuleAttributes: { ...attributes },
  };
}

test("active Creation abilities are advertised only for their five authored types", () => {
  abilityRuntime.resetCreationAbilityHandlersForTests();
  handlers.registerCreationActiveModuleAbilityHandlers();
  for (const typeID of runtime.CREATION_ACTIVE_MODULE_TYPE_IDS) {
    assert.deepEqual(
      abilityRuntime.getRegisteredTypeAbilities(typeID).sort(),
      [
        abilityRuntime.ABILITY_ACTIVATE_EFFECT,
        abilityRuntime.ABILITY_DEACTIVATE_EFFECT,
      ].sort(),
    );
  }
  assert.deepEqual(abilityRuntime.getRegisteredTypeAbilities(95318), []);
  abilityRuntime.resetCreationAbilityHandlersForTests();
});

test("Leap and Thrust Overdrive reproduce the client thrust and fuel formulas", () => {
  const activeEffects = [
    effect(runtime.ACTIVE_KIND_LEAP, {
      [runtime.ATTRIBUTE_LEAP_THRUST_ADD]: 450000000,
      [runtime.ATTRIBUTE_CONTAINMENT_REDUCTION]: 10,
    }),
    effect(runtime.ACTIVE_KIND_THRUST_OVERDRIVE, {
      [runtime.ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE]: 15000000,
      [runtime.ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE]: 0.02,
      [runtime.ATTRIBUTE_CONTAINMENT_REDUCTION]: 10,
    }),
  ];
  const state = runtime.calculateCreationActiveThrust({
    activeEffects,
    fuelProperties: {
      fuelEfficiency: 8,
      fuelContainmentBurden: 5,
      fuelVolatility: 0.5,
    },
    onlineThrusterCount: 2,
  });
  assert.equal(state.fuelAttributeFactor, 8);
  assert.equal(state.volatilityFactor, 0.5);
  assert.equal(state.leapThrust, 1800000000);
  assert.equal(state.thrustOverdrive, 240000000);
  assert.equal(state.totalActiveThrust, 2040000000);
  assert.equal(state.leapFuelRate, 0.37575);
  assert.equal(state.thrustOverdriveFuelRate, 0.04);
  assert.equal(state.totalFuelRate, 0.41575);

  assert.equal(
    runtime.calculateFuelAttributeFactors({ fuelEfficiency: 0 }, 10)
      .fuelAttributeFactor,
    0,
  );
});

test("active thrust mutates velocity authoritatively and is idempotent", () => {
  const entity = {
    conditionState: { fuelCharge: 5, fuelTypeID: 77818 },
    activeModuleEffects: new Map([
      [1, effect(runtime.ACTIVE_KIND_LEAP, {
        [runtime.ATTRIBUTE_LEAP_THRUST_ADD]: 450000000,
        [runtime.ATTRIBUTE_CONTAINMENT_REDUCTION]: 10,
      })],
    ]),
  };
  const resourceState = {
    maxVelocity: 300,
    agility: 0.2,
    attributes: { 37: 300, 6250: 150000000 },
  };
  const context = { moduleItems: [] };
  const options = {
    fuelProperties: {
      fuelEfficiency: 8,
      fuelContainmentBurden: 5,
      fuelVolatility: 0.5,
    },
  };
  const first = runtime.applyCreationActiveThrustToResourceState(
    resourceState,
    entity,
    context,
    options,
  );
  assert.equal(first.velocityDelta, 360);
  assert.equal(resourceState.maxVelocity, 660);
  assert.equal(resourceState.attributes[6250], 1950000000);
  runtime.applyCreationActiveThrustToResourceState(resourceState, entity, context, options);
  assert.equal(resourceState.maxVelocity, 660);
  assert.equal(resourceState.attributes[6250], 1950000000);
});

test("propulsion fuel is prepaid for exactly one authored cycle", () => {
  const shipItem = {
    itemID: 1501,
    ownerID: 1,
    typeID: 95276,
    conditionState: {
      fuelCharge: 10,
      fuelTypeID: 77818,
      fuelQueue: [{ fuelTypeID: 77818, quantity: 10 }],
    },
  };
  const store = buildMemoryShipStore([shipItem]);
  const overdriveEffect = effect(runtime.ACTIVE_KIND_THRUST_OVERDRIVE, {
    [runtime.ATTRIBUTE_THRUST_OVERDRIVE_INJECTION_RATE]: 15000000,
    [runtime.ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE]: 0.02,
    [runtime.ATTRIBUTE_CONTAINMENT_REDUCTION]: 10,
  });
  overdriveEffect.durationMs = 2500;
  const entity = {
    kind: "ship",
    itemID: 1501,
    activeModuleEffects: new Map([[1510, overdriveEffect]]),
    conditionState: clone(shipItem.conditionState),
  };
  const notifications = [];
  const result = runtime.consumeCreationPropulsionCycleFuel({
    entity,
    effectState: overdriveEffect,
    creationDogmaContext: {
      moduleItems: [
        { itemID: 1511, typeID: 99001, moduleState: { online: true } },
        { itemID: 1512, typeID: 99001, moduleState: { online: true } },
      ],
    },
    callbacks: { notifyFuelMutation: (payload) => notifications.push(payload) },
    dependencies: {
      ...store,
      getTypeDogmaEffects: () => new Set([12910]),
      getTypeDogmaAttributes: () => ({
        5607: 8,
        6124: 5,
        6311: 0.5,
      }),
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.fuelRate, 0.04);
  assert.equal(result.data.durationSeconds, 2.5);
  assert.equal(result.data.consumedFuel, 0.1);
  assert.equal(store.records.get(1501).conditionState.fuelCharge, 9.9);
  assert.equal(entity.conditionState.fuelCharge, 9.9);
  assert.equal(notifications.length, 1);
});

test("Transfuser enforces lock/range and atomically debits FIFO fuel with loss", () => {
  const sourceItem = {
    itemID: 1001,
    ownerID: 1,
    typeID: 95276,
    conditionState: {
      fuelCharge: 20,
      fuelTypeID: 101,
      fuelQueue: [
        { fuelTypeID: 101, quantity: 6 },
        { fuelTypeID: 102, quantity: 14 },
      ],
    },
  };
  const targetItem = {
    itemID: 1002,
    ownerID: 2,
    typeID: 606,
    conditionState: {
      fuelCharge: 5,
      fuelTypeID: 103,
      fuelQueue: [{ fuelTypeID: 103, quantity: 5 }],
    },
  };
  const store = buildMemoryShipStore([sourceItem, targetItem]);
  const sourceEntity = {
    kind: "ship",
    itemID: 1001,
    radius: 10,
    position: { x: 0, y: 0, z: 0 },
    lockedTargets: new Map([[1002, {}]]),
    conditionState: clone(sourceItem.conditionState),
  };
  const targetEntity = {
    kind: "ship",
    itemID: 1002,
    radius: 10,
    position: { x: 1000, y: 0, z: 0 },
    passiveDerivedState: { attributes: { 5633: 50 } },
    conditionState: clone(targetItem.conditionState),
  };
  const scene = { getEntityByID: (id) => Number(id) === 1002 ? targetEntity : null };
  const notifications = [];
  const transfuserEffect = effect(runtime.ACTIVE_KIND_TRANSFUSER, {
    [runtime.ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE]: 10,
    [runtime.ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY]: 0.8,
    54: 2500,
  });
  transfuserEffect.targetID = 1002;
  const cycle = runtime.executeTransfuserCycle({
    scene,
    entity: sourceEntity,
    effectState: transfuserEffect,
    callbacks: { notifyFuelMutation: (payload) => notifications.push(payload) },
    dependencies: {
      ...store,
      getCreationDogmaContext: () => ({ success: false }),
    },
  });
  assert.equal(cycle.success, true);
  assert.equal(cycle.data.sourceDebitedFuel, 10);
  assert.equal(cycle.data.targetCreditedFuel, 8);
  assert.equal(cycle.data.lostFuel, 2);
  assert.equal(store.records.get(1001).conditionState.fuelCharge, 10);
  assert.equal(store.records.get(1002).conditionState.fuelCharge, 13);
  assert.deepEqual(
    store.records.get(1002).conditionState.fuelQueue,
    [
      { fuelTypeID: 103, quantity: 5 },
      { fuelTypeID: 101, quantity: 4.8 },
      { fuelTypeID: 102, quantity: 3.2 },
    ],
  );
  assert.equal(notifications.length, 2);

  sourceEntity.lockedTargets.clear();
  const rejected = runtime.executeTransfuserCycle({
    scene,
    entity: sourceEntity,
    effectState: transfuserEffect,
    dependencies: store,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorMsg, "TARGET_NOT_LOCKED");
});

test("fuel pair writer restores the source when the target write fails", () => {
  const source = { itemID: 2001, conditionState: { fuelCharge: 10, fuelTypeID: 1, fuelQueue: [{ fuelTypeID: 1, quantity: 10 }] } };
  const target = { itemID: 2002, conditionState: { fuelCharge: 1, fuelTypeID: 2, fuelQueue: [{ fuelTypeID: 2, quantity: 1 }] } };
  const store = buildMemoryShipStore([source, target], { failItemID: 2002, failed: false });
  const result = runtime.commitFuelQueuePair({
    sourceItem: source,
    targetItem: target,
    nextSourceQueue: [{ fuelTypeID: 1, quantity: 5 }],
    nextTargetQueue: [{ fuelTypeID: 2, quantity: 6 }],
    dependencies: store,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "FUEL_TARGET_WRITE_FAILED");
  assert.deepEqual(store.records.get(2001), source);
  assert.deepEqual(store.records.get(2002), target);
});

function buildHandlerFixture({
  poweredOff = false,
  activeShipID = 3001,
  moduleTypeID = runtime.TYPE_LEAP,
} = {}) {
  const moduleItem = {
    itemID: 3101,
    typeID: moduleTypeID,
    locationID: 3001,
    moduleState: { online: true },
  };
  const entity = {
    kind: "ship",
    itemID: 3001,
    activeModuleEffects: new Map(),
  };
  const calls = [];
  const scene = { getEntityByID: () => null };
  const spaceRuntime = {
    getEntity: (_session, id) => Number(id) === 3001 ? entity : null,
    getSceneForSession: () => scene,
    activateGenericModule(_session, item, effectName, options: Record<string, any> = {}) {
      if (typeof options.beforeCommit === "function") {
        const beforeCommit = options.beforeCommit();
        if (beforeCommit === false || (beforeCommit && beforeCommit.success === false)) {
          return beforeCommit === false
            ? { success: false, errorMsg: "MODULE_PRECOMMIT_FAILED" }
            : beforeCommit;
        }
      }
      const effectState = {
        moduleID: item.itemID,
        durationMs: 1000,
        startedAtMs: 10,
        ...(options.creationEffectStatePatch || {}),
      };
      entity.activeModuleEffects.set(item.itemID, effectState);
      calls.push(["activate", effectName]);
      return { success: true, data: { entity, effectState } };
    },
    deactivateGenericModule(_session, moduleID, options) {
      entity.activeModuleEffects.delete(moduleID);
      calls.push(["deactivate", options.reason]);
      return { success: true, data: {} };
    },
    refreshShipDerivedState() {
      calls.push(["refresh"]);
      return { success: true };
    },
  };
  const creationActiveModuleRuntime = {
    ...runtime,
    resolveCreationActiveThrustState: () => ({ onlineThrusterCount: 1 }),
    preflightCreationPropulsionCycleFuel: () => ({
      success: true,
      data: { activeState: { onlineThrusterCount: 1 } },
    }),
    consumeCreationPropulsionCycleFuel: () => ({
      success: false,
      errorMsg: "NO_FUEL",
      stopReason: "fuel",
    }),
  };
  return {
    calls,
    entity,
    context: {
      creationItem: { itemID: 3001 },
      creationState: { poweredOff },
      characterID: 77,
      moduleItemID: moduleItem.itemID,
      kwargs: {},
      session: { _space: { shipID: activeShipID } },
      dependencies: {
        creationActiveModuleRuntime,
        findItemById: () => clone(moduleItem),
        getCreationDogmaContext: () => ({
          success: true,
          data: { moduleItems: [clone(moduleItem)] },
        }),
        spaceRuntime,
      },
    },
  };
}

test("Hull Repairer delegates to the shared structureRepair cycle", () => {
  const fixture = buildHandlerFixture({
    moduleTypeID: runtime.TYPE_HULL_REPAIRER,
  });
  const result = handlers.activateHullRepairer(fixture.context);
  assert.equal(result.success, true);
  assert.equal(result.data.durationMs, 1000);
  assert.deepEqual(fixture.calls, [["activate", runtime.EFFECT_HULL_REPAIRER]]);
  const effectState = fixture.entity.activeModuleEffects.get(3101);
  assert.equal(effectState.creationActiveModuleEffect, undefined);
  assert.equal(effectState.moduleID, 3101);
});

test("handlers reject ship-wide power-off and remote owned Creation activation", () => {
  const poweredOff = buildHandlerFixture({ poweredOff: true });
  const powerResult = handlers.activatePropulsion(
    poweredOff.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(powerResult.success, false);
  assert.equal(powerResult.errorMsg, "CREATION_POWERED_OFF");
  assert.deepEqual(poweredOff.calls, []);

  const remote = buildHandlerFixture({ activeShipID: 3999 });
  const remoteResult = handlers.activatePropulsion(
    remote.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(remoteResult.success, false);
  assert.equal(remoteResult.errorMsg, "CREATION_NOT_ACTIVE_SHIP");
  assert.deepEqual(remote.calls, []);

  const staleSession: any = buildHandlerFixture();
  staleSession.context.session._space.shipID = undefined;
  staleSession.context.session.shipid = 3001;
  const staleResult = handlers.activatePropulsion(
    staleSession.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(staleResult.success, false);
  assert.equal(staleResult.errorMsg, "CREATION_NOT_ACTIVE_SHIP");
  assert.deepEqual(staleSession.calls, []);
});

test("failed propulsion fuel prepayment removes the effect before derived thrust refresh", () => {
  const fixture = buildHandlerFixture();
  const result = handlers.activatePropulsion(
    fixture.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "NO_FUEL");
  assert.deepEqual(fixture.calls, [
    ["activate", runtime.EFFECT_LEAP],
    ["deactivate", "fuel"],
  ]);
  assert.equal(fixture.entity.activeModuleEffects.size, 0);
});

test("held Leap activation reuses its active effect without another fuel payment", () => {
  const fixture = buildHandlerFixture();
  let fuelPayments = 0;
  fixture.context.dependencies.creationActiveModuleRuntime.consumeCreationPropulsionCycleFuel = () => {
    fuelPayments += 1;
    return { success: true, data: { consumedFuel: 1 } };
  };
  const first = handlers.activatePropulsion(
    fixture.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  const repeated = handlers.activatePropulsion(
    fixture.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(first.success, true);
  assert.deepEqual(repeated, {
    success: true,
    data: { durationMs: first.data.durationMs, alreadyActive: true },
  });
  assert.equal(fuelPayments, 1);
  assert.deepEqual(fixture.calls, [
    ["activate", runtime.EFFECT_LEAP],
    ["refresh"],
  ]);
});

test("manual Creation module stop waits for its cycle; forced offline stop is immediate", () => {
  const fixture = buildHandlerFixture();
  let requestedOptions = null;
  fixture.context.dependencies.spaceRuntime.deactivateGenericModule = (
    _session, _moduleID, options,
  ) => {
    requestedOptions = options;
    return { success: true, data: { pending: true } };
  };
  assert.equal(handlers.deactivateModule(fixture.context).success, true);
  assert.deepEqual(requestedOptions, { reason: "manual", deferUntilCycle: true });

  const scene = Object.create(spaceRuntime._testing.SolarSystemScene.prototype);
  const moduleID = 991234;
  const effectState = {
    moduleID,
    effectName: "miningLaser",
    durationMs: 5000,
    startedAtMs: 1000,
    nextCycleAtMs: 6000,
    miningEffect: true,
  };
  const entity = { activeModuleEffects: new Map([[moduleID, effectState]]) };
  scene.getShipEntityForSession = () => entity;
  scene.getCurrentSimTimeMs = () => 2000;
  let finalized = null;
  scene.finalizeGenericModuleDeactivation = (_session, _moduleID, options) => {
    finalized = options;
    entity.activeModuleEffects.delete(moduleID);
    return { success: true, data: {} };
  };

  const pending = scene.deactivateGenericModule({}, moduleID, { reason: "manual" });
  assert.equal(pending.success, true);
  assert.equal(pending.data.pending, true);
  assert.equal(pending.data.deactivateAtMs, 6000);
  assert.equal(entity.activeModuleEffects.has(moduleID), true);
  assert.equal(finalized, null);

  const interrupted = scene.deactivateGenericModule({}, moduleID, {
    reason: "offline",
    deferUntilCycle: false,
  });
  assert.equal(interrupted.success, true);
  assert.equal(entity.activeModuleEffects.has(moduleID), false);
  assert.equal(finalized.reason, "offline");
  assert.equal(finalized.nowMs, 2000);
});

test("releasing Leap ends thrust immediately and locks reactivation to cycle end", () => {
  const fixture = buildHandlerFixture();
  let requestedOptions = null;
  fixture.context.dependencies.spaceRuntime.deactivateGenericModule = (
    _session, _moduleID, options,
  ) => {
    requestedOptions = options;
    return { success: true, data: { stoppedAtMs: 2000 } };
  };
  const release = handlers.CREATION_ACTIVE_MODULE_ABILITY_HANDLERS[
    runtime.TYPE_LEAP
  ].deactivate.execute(fixture.context);
  assert.equal(release.success, true);
  assert.deepEqual(requestedOptions, {
    reason: "manual",
    deferUntilCycle: false,
    cooldownUntilCycle: true,
  });

  const scene = Object.create(spaceRuntime._testing.SolarSystemScene.prototype);
  const moduleID = 991235;
  const effectState = {
    moduleID,
    effectName: runtime.EFFECT_LEAP,
    durationMs: 5000,
    startedAtMs: 1000,
    nextCycleAtMs: 6000,
    creationActiveKind: runtime.ACTIVE_KIND_LEAP,
    reactivationDelayMs: 0,
  };
  const entity = { activeModuleEffects: new Map([[moduleID, effectState]]) };
  scene.getShipEntityForSession = () => entity;
  scene.getCurrentSimTimeMs = () => 2000;
  let finalized = null;
  scene.finalizeGenericModuleDeactivation = (_session, _moduleID, options) => {
    finalized = options;
    entity.activeModuleEffects.delete(moduleID);
    return { success: true, data: { stoppedAtMs: options.nowMs } };
  };
  const stopped = scene.deactivateGenericModule({}, moduleID, requestedOptions);
  assert.equal(stopped.success, true);
  assert.equal(finalized.nowMs, 2000);
  assert.equal(effectState.reactivationDelayMs, 4000);
  assert.equal(entity.activeModuleEffects.has(moduleID), false);
});

test("Leap stop response excludes live runtime objects for pending and completed cycles", () => {
  for (const [runtimeData, expectedData] of [
    [
      { pending: true, deactivateAtMs: 6000 },
      { pending: true, deactivateAtMs: 6000 },
    ],
    [
      { stoppedAtMs: 6000 },
      { stoppedAtMs: 6000 },
    ],
  ]) {
    const fixture = buildHandlerFixture({ moduleTypeID: runtime.TYPE_LEAP });
    fixture.context.dependencies.spaceRuntime.deactivateGenericModule = () => ({
      success: true,
      data: {
        ...runtimeData,
        entity: { session: { cleanup: () => {} } },
        effectState: { callback: () => {} },
      },
    });
    const result = handlers.deactivateModule(fixture.context);
    assert.deepEqual(result, { success: true, data: expectedData });

    const response = buildCreationAbilityResponse({
      serverTime: 123456789n,
      ...result.data,
    }, null);
    assert.doesNotThrow(() => structuredClone(response));
    assert.doesNotThrow(() => marshalEncode(response, {
      compatibilityProfile: "frontier",
    }));
  }
});

test("propulsion preflight fails before generic activation can charge or publish HUD state", () => {
  const fixture = buildHandlerFixture();
  fixture.context.dependencies.creationActiveModuleRuntime = {
    ...fixture.context.dependencies.creationActiveModuleRuntime,
    preflightCreationPropulsionCycleFuel: () => ({
      success: false,
      errorMsg: "NO_FUEL",
      stopReason: "fuel",
    }),
  };
  const result = handlers.activatePropulsion(
    fixture.context,
    runtime.ACTIVE_KIND_LEAP,
    runtime.EFFECT_LEAP,
  );
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "NO_FUEL");
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.entity.activeModuleEffects.size, 0);
});

test("Approach Computer reasserts follow only while target remains locked and in range", () => {
  const entity = {
    kind: "ship",
    itemID: 4001,
    radius: 10,
    position: { x: 0, y: 0, z: 0 },
    lockedTargets: new Map([[4002, {}]]),
  };
  const target = {
    kind: "ship",
    itemID: 4002,
    radius: 10,
    position: { x: 1000, y: 0, z: 0 },
  };
  let follows = 0;
  const args = {
    scene: { getEntityByID: () => target },
    session: {},
    entity,
    effectState: effect(runtime.ACTIVE_KIND_APPROACH, { 54: 75000 }),
    callbacks: { follow: () => { follows += 1; return true; } },
  };
  args.effectState.targetID = 4002;
  assert.equal(runtime.executeApproachComputerCycle(args).success, true);
  assert.equal(follows, 1);
  entity.lockedTargets.clear();
  const lost = runtime.executeApproachComputerCycle(args);
  assert.equal(lost.success, false);
  assert.equal(lost.errorMsg, "TARGET_NOT_LOCKED");
  assert.equal(lost.stopReason, "target");
  assert.equal(follows, 1);
});

test("Creation state is present at activation and repeat=0 Transfuser owes its boundary delivery", () => {
  const patch = runtime.buildCreationActiveEffectPatch(
    runtime.ACTIVE_KIND_TRANSFUSER,
    { itemID: 5101, typeID: runtime.TYPE_TRANSFUSER },
    { targetID: 5002 },
  );
  assert.equal(patch.creationActiveModuleEffect, true);
  assert.equal(patch.targetID, 5002);
  assert.equal(patch.consequenceDelivery, "boundary");
  assert.equal(
    spaceRuntime._testing.resolveModuleConsequenceDelivery(patch),
    spaceRuntime._testing.MODULE_CONSEQUENCE_DELIVERY.BOUNDARY,
  );

  const source = {
    itemID: 5001,
    conditionState: {
      fuelCharge: 5,
      fuelTypeID: 101,
      fuelQueue: [{ fuelTypeID: 101, quantity: 5 }],
    },
  };
  const target = {
    itemID: 5002,
    conditionState: {
      fuelCharge: 0,
      fuelTypeID: 0,
      fuelQueue: [],
    },
  };
  const store = buildMemoryShipStore([source, target]);
  const sourceEntity = {
    kind: "ship",
    itemID: 5001,
    radius: 1,
    position: { x: 0, y: 0, z: 0 },
    lockedTargets: new Map([[5002, {}]]),
    conditionState: clone(source.conditionState),
  };
  const targetEntity = {
    kind: "ship",
    itemID: 5002,
    radius: 1,
    position: { x: 100, y: 0, z: 0 },
    passiveDerivedState: { attributes: { 5633: 20 } },
    conditionState: clone(target.conditionState),
  };
  const effectState = {
    ...patch,
    remainingCycles: 1,
    creationModuleAttributes: {
      ...patch.creationModuleAttributes,
      54: 1000,
      [runtime.ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE]: 2,
      [runtime.ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY]: 1,
    },
  };
  const delivery = runtime.executeCreationActiveModuleCycle({
    scene: { getEntityByID: () => targetEntity },
    entity: sourceEntity,
    effectState,
    dependencies: {
      ...store,
      getCreationDogmaContext: () => ({ success: false }),
    },
  });
  assert.equal(delivery.matched, true);
  assert.equal(delivery.success, true);
  assert.equal(delivery.data.sourceDebitedFuel, 2);
  assert.equal(delivery.data.targetCreditedFuel, 2);
});

test("Approach cleanup stops only the exact movement command owned by the effect", () => {
  const effectState = {
    ...effect(runtime.ACTIVE_KIND_APPROACH, { 54: 1000 }),
    targetID: 6002,
    creationApproachMovementTraceID: 41,
  };
  const entity: Record<string, any> = {
    itemID: 6001,
    targetEntityID: 6002,
    movementTrace: { id: 41 },
  };
  let stops = 0;
  const callbacks = { stop: () => { stops += 1; return true; } };
  const owned = runtime.cleanupCreationActiveModuleEffect({
    entity,
    effectState,
    callbacks,
  });
  assert.equal(owned.success, true);
  assert.equal(owned.data.stopped, true);
  assert.equal(stops, 1);

  entity.movementTrace = { id: 42 };
  const replaced = runtime.cleanupCreationActiveModuleEffect({
    entity,
    effectState,
    callbacks,
  });
  assert.equal(replaced.data.stopped, false);
  assert.equal(stops, 1);
});

test("cycle preflight rejects a lost target without applying a consequence", () => {
  const entity = {
    kind: "ship",
    itemID: 7001,
    lockedTargets: new Map(),
    position: { x: 0, y: 0, z: 0 },
  };
  const effectState = {
    ...effect(runtime.ACTIVE_KIND_TRANSFUSER, { 54: 1000 }),
    targetID: 7002,
  };
  const result = runtime.preflightCreationActiveModuleCycle({
    scene: {
      getEntityByID: () => ({
        kind: "ship",
        itemID: 7002,
        position: { x: 1, y: 0, z: 0 },
      }),
    },
    entity,
    effectState,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "TARGET_NOT_LOCKED");
  assert.equal(result.stopReason, "target");
});

test("disallowAutoRepeat and unavailable-module cycle guards are fail closed", () => {
  assert.equal(
    spaceRuntime._testing.resolveModuleActivationRepeat(
      { disallowAutoRepeat: true },
      1000,
    ),
    0,
  );
  assert.equal(
    spaceRuntime._testing.resolveModuleActivationRepeat({}, 1000),
    1000,
  );
  assert.equal(
    spaceRuntime._testing.shouldStopEffectForUnavailableModule(null),
    true,
  );
  assert.equal(
    spaceRuntime._testing.shouldStopEffectForUnavailableModule({
      moduleState: { online: false },
    }),
    true,
  );
  assert.equal(
    spaceRuntime._testing.shouldStopEffectForUnavailableModule({
      moduleState: { online: true },
    }),
    false,
  );
});

test("fuel-head property changes request an authoritative derived-state refresh", () => {
  const shipItem = {
    itemID: 8001,
    conditionState: {
      fuelCharge: 1,
      fuelTypeID: 101,
      fuelQueue: [
        { fuelTypeID: 101, quantity: 0.05 },
        { fuelTypeID: 102, quantity: 0.95 },
      ],
    },
  };
  const store = buildMemoryShipStore([shipItem]);
  const effectState = {
    ...effect(runtime.ACTIVE_KIND_THRUST_OVERDRIVE, {
      [runtime.ATTRIBUTE_THRUST_OVERDRIVE_FUEL_RATE]: 0.1,
    }),
    durationMs: 1000,
  };
  const entity = {
    kind: "ship",
    itemID: 8001,
    activeModuleEffects: new Map([[8010, effectState]]),
    conditionState: clone(shipItem.conditionState),
  };
  let refreshes = 0;
  const result = runtime.consumeCreationPropulsionCycleFuel({
    entity,
    effectState,
    creationDogmaContext: {
      moduleItems: [{ itemID: 8011, moduleState: { online: true } }],
    },
    callbacks: {
      refreshDerivedState: () => { refreshes += 1; },
    },
    dependencies: {
      ...store,
      getTypeDogmaEffects: () => new Set([12910]),
      getTypeDogmaAttributes: (typeID) => ({
        5607: typeID === 101 ? 1 : 2,
        6124: 1,
        6311: 1,
      }),
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.fuelPropertiesChanged, true);
  assert.equal(refreshes, 1);
});

test("shared SolarSystemScene lifecycle delivers repeat=0 Transfuser then cleans owned Approach movement", (t) => {
  const systemID = 30000004;
  const ownerID = 140000003;
  const targetOwnerID = 140000004;
  const createdItemIDs: number[] = [];
  const createdCharacterIDs: number[] = [];
  for (const characterID of [ownerID, targetOwnerID]) {
    if (!gameStore.read("characters", String(characterID)).success) {
      const written = gameStore.write("characters", String(characterID), {
        characterID,
        characterName: `Creation Active Test ${characterID}`,
        typeID: 1373,
        corporationID: 1000442,
        stationID: 64000001,
        solarSystemID: systemID,
        activeShipID: 0,
      }, { transient: true });
      assert.equal(written.success, true, written.errorMsg);
      createdCharacterIDs.push(characterID);
    }
  }
  const grantShip = (ownerIDValue) => {
    const grant = itemStore.grantItemsToCharacterLocation(
      ownerIDValue,
      systemID,
      0,
      [{
        itemType: 95276,
        quantity: 1,
        options: {
          individualItems: true,
          singleton: 1,
          spaceState: {
            systemID,
            position: { x: ownerIDValue === ownerID ? 0 : 100, y: 0, z: 0 },
          },
        },
      }],
    );
    assert.equal(grant.success, true, grant.errorMsg);
    const item = grant.data.items[0];
    createdItemIDs.push(item.itemID);
    return item;
  };
  t.after(() => {
    for (const itemID of createdItemIDs) {
      itemStore.removeInventoryItem(itemID, { removeContents: true });
    }
    for (const characterID of createdCharacterIDs) {
      gameStore.remove("characters", String(characterID));
    }
  });

  const sourceGranted = grantShip(ownerID);
  const targetGranted = grantShip(targetOwnerID);
  const sourceWrite = itemStore.updateInventoryItem(sourceGranted.itemID, (item) => ({
    ...item,
    categoryID: 6,
    conditionState: {
      ...(item.conditionState || {}),
      fuelCharge: 5,
      fuelTypeID: 101,
      fuelQueue: [{ fuelTypeID: 101, quantity: 5 }],
    },
  }));
  const targetWrite = itemStore.updateInventoryItem(targetGranted.itemID, (item) => ({
    ...item,
    categoryID: 6,
    conditionState: {
      ...(item.conditionState || {}),
      fuelCharge: 0,
      fuelTypeID: 0,
      fuelQueue: [],
    },
  }));
  assert.equal(sourceWrite.success, true);
  assert.equal(targetWrite.success, true);

  const scene = new spaceRuntime._testing.SolarSystemScene(systemID);
  const buildEntity = (ownerIDValue, shipItem) => spaceRuntime._testing
    .buildShipEntityForTesting({
      characterID: ownerIDValue,
      charid: ownerIDValue,
      shipid: shipItem.itemID,
      _space: { shipID: shipItem.itemID, systemID },
    }, shipItem, systemID);
  const sourceEntity = buildEntity(ownerID, sourceWrite.data);
  const targetEntity = buildEntity(targetOwnerID, targetWrite.data);
  const boundaryFuelStore = buildMemoryShipStore([
    { ...sourceWrite.data, categoryID: 6 },
    { ...targetWrite.data, categoryID: 6 },
  ]);
  t.mock.method(
    itemStore,
    "findShipItemById",
    (itemID) => boundaryFuelStore.findShipItemById(itemID),
  );
  t.mock.method(
    itemStore,
    "updateShipItem",
    (itemID, updater) => boundaryFuelStore.updateShipItem(itemID, updater),
  );
  // Exercise the true sessionless shared loop while using the entity's fitted
  // fallback as its authoritative module owner list.
  sourceEntity.session = null;
  sourceEntity.characterID = 0;
  sourceEntity.pilotCharacterID = 0;
  targetEntity.session = null;
  targetEntity.characterID = 0;
  targetEntity.pilotCharacterID = 0;
  sourceEntity.position = { x: 0, y: 0, z: 0 };
  targetEntity.position = { x: 100, y: 0, z: 0 };
  targetEntity.passiveDerivedState = {
    ...(targetEntity.passiveDerivedState || {}),
    fuelCapacity: 20,
    attributes: {
      ...((targetEntity.passiveDerivedState || {}).attributes || {}),
      5633: 20,
    },
  };
  sourceEntity.maxTargetRange = 1000000;
  sourceEntity.maxLockedTargets = 8;
  sourceEntity.scanResolution = 1000;
  sourceEntity.lockedTargets = new Map([[
    targetEntity.itemID,
    { targetID: targetEntity.itemID, sequence: 1 },
  ]]);
  targetEntity.targetedBy = new Set([sourceEntity.itemID]);
  scene.dynamicEntities.set(sourceEntity.itemID, sourceEntity);
  scene.dynamicEntities.set(targetEntity.itemID, targetEntity);

  const transfuserModule = {
    itemID: sourceEntity.itemID + 100000,
    locationID: sourceEntity.itemID,
    flagID: 11,
    typeID: runtime.TYPE_TRANSFUSER,
    moduleState: { online: true },
  };
  sourceEntity.fittedItems = [transfuserModule];
  const transfuserState = {
    moduleID: transfuserModule.itemID,
    moduleFlagID: transfuserModule.flagID,
    typeID: transfuserModule.typeID,
    isGeneric: true,
    durationMs: 1000,
    startedAtMs: scene.simTimeMs - 1000,
    nextCycleAtMs: scene.simTimeMs,
    capNeed: 50,
    fuelTypeID: 0,
    fuelPerActivation: 0,
    remainingCycles: 1,
    targetID: targetEntity.itemID,
    ...runtime.buildCreationActiveEffectPatch(
      runtime.ACTIVE_KIND_TRANSFUSER,
      transfuserModule,
      { targetID: targetEntity.itemID },
    ),
  };
  transfuserState.creationModuleAttributes = {
    ...transfuserState.creationModuleAttributes,
    54: 1000,
    [runtime.ATTRIBUTE_FUEL_TRANSFER_PER_CYCLE]: 2,
    [runtime.ATTRIBUTE_FUEL_TRANSFER_EFFICIENCY]: 1,
  };
  sourceEntity.activeModuleEffects = new Map([
    [transfuserModule.itemID, transfuserState],
  ]);
  const boundaryPreflight = runtime.preflightCreationActiveModuleCycle({
    scene,
    entity: sourceEntity,
    moduleItem: transfuserModule,
    effectState: transfuserState,
  });
  assert.equal(boundaryPreflight.success, true, boundaryPreflight.errorMsg);
  const firstWallclock = scene.lastWallclockTickAt + 100;
  scene.tick(firstWallclock);
  assert.equal(sourceEntity.activeModuleEffects.has(transfuserModule.itemID), false);
  assert.equal(
    sourceEntity.conditionState.fuelCharge,
    3,
    JSON.stringify({
      stopReason: transfuserState.stopReason,
      stillInScene: scene.dynamicEntities.has(sourceEntity.itemID),
      moduleItems: sourceEntity.fittedItems,
    }),
  );
  assert.equal(targetEntity.conditionState.fuelCharge, 2);

  const approachModule = {
    ...transfuserModule,
    itemID: transfuserModule.itemID + 1,
    typeID: runtime.TYPE_APPROACH_COMPUTER,
  };
  sourceEntity.fittedItems = [approachModule];
  sourceEntity.mode = "FOLLOW";
  sourceEntity.targetEntityID = targetEntity.itemID;
  sourceEntity.followRange = 0;
  sourceEntity.movementTrace = { id: 77, untilMs: scene.simTimeMs + 10000 };
  const approachState = {
    moduleID: approachModule.itemID,
    moduleFlagID: approachModule.flagID,
    typeID: approachModule.typeID,
    isGeneric: true,
    durationMs: 1000,
    startedAtMs: scene.simTimeMs - 1000,
    nextCycleAtMs: scene.simTimeMs,
    capNeed: 1.5,
    fuelTypeID: 0,
    fuelPerActivation: 0,
    remainingCycles: 1,
    targetID: targetEntity.itemID,
    ...runtime.buildCreationActiveEffectPatch(
      runtime.ACTIVE_KIND_APPROACH,
      approachModule,
      { targetID: targetEntity.itemID },
    ),
    creationApproachMovementTraceID: 77,
  };
  sourceEntity.activeModuleEffects.set(approachModule.itemID, approachState);
  scene.tick(firstWallclock + 100);
  assert.equal(sourceEntity.activeModuleEffects.has(approachModule.itemID), false);
  assert.notEqual(sourceEntity.mode, "FOLLOW");
  assert.notEqual(sourceEntity.targetEntityID, targetEntity.itemID);
});
