"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const environmentalEffects = require(
  "../src/services/frontier/environmentalEffectsService",
);
const StatusEffectMgrService = require(
  "../src/services/frontier/statusEffectMgrService",
);
const ShellManagerService = require(
  "../src/services/frontier/shellManagerService",
);
const {
  ATTRIBUTE_METAMORPHOSIS_ITEM,
  ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT,
} = require("../src/space/npc/npcMetamorphosis");

function buildPlayerShip(
  characterID,
  overrides: Record<string, any> = {},
): any {
  return {
    itemID: 10_000 + characterID,
    kind: "ship",
    characterID,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
    conditionState: { temperature: 295 },
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_CAPACITY]: 1,
        [environmentalEffects.ATTRIBUTE_FERALIZATION_CONDUCTANCE]: 1,
        [environmentalEffects.ATTRIBUTE_NOMINAL_MAX_FERALIZATION]: 100,
        [environmentalEffects.ATTRIBUTE_TEMPORAL_DRIFT_CAPACITY]: 1,
        [environmentalEffects.ATTRIBUTE_TEMPORAL_DRIFT_CONDUCTANCE]: 1,
        [environmentalEffects.ATTRIBUTE_NOMINAL_MAX_TEMPORAL_DRIFT]: 100,
      },
    },
    ...overrides,
  };
}

function buildScene(ship, staticEntities: any[] = []): any {
  return {
    dynamicEntities: new Map([[ship.itemID, ship]]),
    staticEntities,
    getDynamicEntities() {
      return [...this.dynamicEntities.values()];
    },
  };
}

function buildRift(position = { x: 0, y: 0, z: 0 }): any {
  return {
    itemID: 40_001,
    kind: "riftDungeon",
    customFrontierRiftSite: true,
    groupID: 4872,
    radius: 10,
    position,
  };
}

test.afterEach(() => environmentalEffects.resetCharacterState());

test("Crude Matter Rift proximity builds temporal drift and triggers shell drain", () => {
  const ship = buildPlayerShip(101);
  const scene = buildScene(ship, [buildRift()]);

  const initial = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    { vitalityDrainPerEffectPerSecond: 10 },
  );
  assert.equal(initial.externalTemporalDrift, 200);
  assert.equal(initial.temporalDrift, 0);

  const exposed = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    2_000,
    { vitalityDrainPerEffectPerSecond: 10 },
  );
  assert.ok(exposed.temporalDrift > 100);
  assert.equal(
    environmentalEffects.snapshotCharacterState(101).effects.temporal_drift.active,
    true,
  );
  assert.equal(exposed.vitality, 90);
  assert.equal(
    ship.passiveDerivedState.attributes[
      environmentalEffects.ATTRIBUTE_EXTERNAL_TEMPORAL_DRIFT
    ],
    200,
  );

  const distantShip = buildPlayerShip(102, {
    position: { x: 200_000, y: 0, z: 0 },
  });
  const distant = environmentalEffects.advanceEntityEnvironmentalEffects(
    buildScene(distantShip, [buildRift()]),
    distantShip,
    1_000,
  );
  assert.equal(distant.externalTemporalDrift, 0);
});

test("configured NPC scans and damaging hits apply feralization", () => {
  const target = buildPlayerShip(201);
  const source = {
    itemID: 50_001,
    kind: "ship",
    nativeNpc: true,
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN]: 40,
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT]: 70,
      },
    },
  };

  const scanned = environmentalEffects.applyNpcFeralization(
    target,
    source,
    "scan",
    1_000,
  );
  assert.equal(scanned.applied, true);
  assert.equal(scanned.feralization, 40);

  const missed = environmentalEffects.applyNpcFeralization(
    target,
    source,
    "hit",
    1_100,
    { appliedDamage: 0 },
  );
  assert.equal(missed.applied, false);
  assert.equal(missed.amount, 0);

  const hit = environmentalEffects.applyNpcFeralization(
    target,
    source,
    "hit",
    1_200,
    { appliedDamage: 5 },
  );
  assert.equal(hit.applied, true);
  assert.equal(hit.feralization, 110);
  assert.equal(
    environmentalEffects.snapshotCharacterState(201).effects.feralization.active,
    true,
  );

  const unconfiguredNpc = {
    ...source,
    itemID: 50_002,
    passiveDerivedState: { attributes: {} },
  };
  assert.equal(
    environmentalEffects.applyNpcFeralization(
      buildPlayerShip(202),
      unconfiguredNpc,
      "scan",
      1_000,
    ).applied,
    false,
  );
});

test("the shared NPC weapon path applies hit feralization", () => {
  const { applyWeaponDamageToTargetForTesting } = require(
    "../src/space/runtime",
  )._testing;
  const target = buildPlayerShip(251, {
    itemID: 60_001,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
    position: { x: 100, y: 0, z: 0 },
  });
  const source = {
    itemID: 60_002,
    typeID: 95504,
    kind: "ship",
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    radius: 10,
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_HIT]: 25,
        [ATTRIBUTE_METAMORPHOSIS_ITEM]: 95284,
        [ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT]: 3,
      },
    },
  };
  const generatedCargo: any[] = [];
  const metamorphosisDependencies = {
    getTypeAttributeValue() {
      return null;
    },
    resolveItemByTypeID(typeID) {
      return typeID === 95284
        ? { typeID, name: "Thrumming Strand", groupID: 5131, categoryID: 4 }
        : null;
    },
    nativeNpcStore: {
      allocateCargoID() {
        return { success: true, data: 70_001 };
      },
      listNativeCargoForEntity() {
        return generatedCargo;
      },
      upsertNativeCargo(record) {
        generatedCargo.push({ ...record });
        return { success: true, data: record };
      },
      buildNativeCargoItems() {
        return generatedCargo.map((record) => ({ ...record }));
      },
    },
  };
  const scene = {
    getAllVisibleEntities: () => [source, target],
    getCurrentDestinyStamp: () => 10,
    getCurrentSimTimeMs: () => 1_000,
    sessions: new Map(),
    staticEntitiesByID: new Map(),
  };

  const result = applyWeaponDamageToTargetForTesting(
    scene,
    source,
    target,
    { em: 10 },
    1_000,
    {
      skipWeaponOcclusion: true,
      npcMetamorphosisDependencies: metamorphosisDependencies,
    },
  );

  assert.equal(result.damageResult.success, true);
  assert.equal(
    environmentalEffects.snapshotCharacterState(251).feralization,
    25,
  );
  assert.equal(generatedCargo.length, 1);
  assert.equal(generatedCargo[0].typeID, 95284);
  assert.equal(generatedCargo[0].quantity, 3);
});

test("acquiring a target lock does not apply feralization", () => {
  const {
    SolarSystemScene,
  } = require("../src/space/runtime")._testing;
  const target = buildPlayerShip(252, { itemID: 61_001 });
  const source: any = {
    itemID: 61_002,
    kind: "ship",
    nativeNpc: true,
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN]: 40,
        [ATTRIBUTE_METAMORPHOSIS_ITEM]: 95284,
      },
    },
  };
  const scene = Object.create(SolarSystemScene.prototype);
  scene.validateTargetLockRequest = () => ({
    success: true,
    data: {
      targetingStats: { effectiveMaxLockedTargets: 1 },
    },
  });
  scene.allocateTargetSequence = () => 1;
  scene.getCurrentSimTimeMs = () => 1_000;

  const result = scene.finalizeTargetLock(source, target, { nowMs: 1_000 });

  assert.equal(result.success, true);
  assert.equal(source.lockedTargets.has(target.itemID), true);
  assert.equal(
    environmentalEffects.snapshotCharacterState(252, { create: false }),
    null,
  );
});

test("critical conflagration drains vitality to zero and backs shell/status RPCs", () => {
  const characterID = 301;
  const ship = buildPlayerShip(characterID, {
    conditionState: { temperature: environmentalEffects.CRITICAL_TEMPERATURE_K },
  });
  const scene = buildScene(ship);
  const options = { vitalityDrainPerEffectPerSecond: 25 };

  environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    options,
  );
  const halfway = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    3_000,
    options,
  );
  const depleted = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    5_000,
    options,
  );
  assert.equal(halfway.vitality, 50);
  assert.equal(depleted.vitality, 0);

  const session = { characterID };
  const statusService = new StatusEffectMgrService();
  assert.deepEqual(statusService.Handle_get_grace_state(
    [],
    session,
    { type: "dict", entries: [["effect_key", "heat"]] },
  ), [1, true]);
  assert.equal(statusService.Handle_get_grace_counter(
    ["heat"],
    session,
  ), 1);
  assert.deepEqual(
    new ShellManagerService().Handle_get_medical_trait_shell_points([], session),
    [100, 100],
  );
});

test("environmental changes use the client status and shell notifications", () => {
  const target = buildPlayerShip(401);
  const source = {
    kind: "ship",
    nativeNpc: true,
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN]: 100,
      },
    },
  };
  const result = environmentalEffects.applyNpcFeralization(
    target,
    source,
    "scan",
    1_000,
  );
  const notifications: any[] = [];
  const session = {
    sendNotification(eventName, route, args) {
      notifications.push({ eventName, route, args });
    },
  };

  assert.equal(
    environmentalEffects.deliverClientNotifications(session, result),
    true,
  );
  assert.ok(notifications.some((entry) => (
    entry.eventName === "OnStatusEffectActiveChanged" &&
    entry.args[0] === "feralization" &&
    entry.args[1] === true
  )));
  assert.ok(notifications.some((entry) => (
    entry.eventName === "OnStatusEffectGraceChanged" &&
    entry.args[0] === "feralization" &&
    entry.args[1] === 1
  )));
  assert.ok(notifications.some((entry) => (
    entry.eventName === "OnMedicalTraitShellPointsChanged" &&
    entry.route === "charid" &&
    entry.args[2].type === "list"
  )));
});
