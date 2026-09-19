"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const environmentalEffects = require(
  "../src/services/frontier/environmentalEffectsService",
);
const serverConfig = require("../src/config");
const StatusEffectMgrService = require(
  "../src/services/frontier/statusEffectMgrService",
);
const ShellManagerService = require(
  "../src/services/frontier/shellManagerService",
);
const LocationSelectionMgrService = require(
  "../src/services/frontier/locationSelectionMgrService",
);
const {
  marshalDecode,
  marshalEncode,
} = require("../src/network/tcp/utils/marshal");
const shipDestruction = require("../src/space/shipDestruction");
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

test.afterEach(() => {
  environmentalEffects.resetCharacterState();
  LocationSelectionMgrService.resetDeathReports();
  shipDestruction._testing.clearPendingCloneSelectionTimers();
});

test("environmental thresholds, delay, and damage rates are validated config", () => {
  const definitions = new Map<string, any>(
    serverConfig.getConfigDefinitions().map((definition) => [
      definition.key,
      definition,
    ]),
  );
  assert.equal(
    definitions.get("frontierEnvironmentalHeatCriticalThresholdKelvin")
      .defaultValue,
    1_500,
  );
  assert.equal(
    definitions.get("frontierEnvironmentalDamageDelaySeconds").defaultValue,
    30,
  );
  assert.equal(
    definitions.get("frontierCloneDeathTransitionDelaySeconds").defaultValue,
    5,
  );
  assert.equal(
    definitions.get(
      "frontierEnvironmentalHitpointDamagePerEffectPerSecond",
    ).defaultValue,
    1,
  );
  const validBaseValues = Object.fromEntries(
    [...definitions.entries()].map(([key, definition]) => [
      key,
      definition.defaultValue === "" ? "test" : definition.defaultValue,
    ]),
  );
  assert.throws(
    () => serverConfig.buildValidatedConfigValues({
      frontierEnvironmentalDamageDelaySeconds: -1,
    }, { baseValues: validBaseValues }),
    /frontierEnvironmentalDamageDelaySeconds must be at least 0/,
  );
  assert.throws(
    () => serverConfig.buildValidatedConfigValues({
      frontierEnvironmentalHeatCriticalThresholdKelvin: 499,
      frontierEnvironmentalHeatWarningThresholdKelvin: 500,
    }, { baseValues: validBaseValues }),
    /CriticalThresholdKelvin must be greater than.*WarningThresholdKelvin/,
  );
});

test("death timer presents the report but location loading cannot confirm cleanup", async () => {
  assert.equal(
    shipDestruction._testing.resolveCloneDeathTransitionDelayMs(),
    5_000,
  );
  let completed = 0;
  const sessionChanges: any[] = [];
  const session = {
    characterID: 300,
    shipid: 9_300,
    sendSessionChange(changes) {
      sessionChanges.push(changes);
    },
  };
  LocationSelectionMgrService.recordPendingCloneDeath(300, {
    deathSystemID: 30_000_001,
    fallbackStationID: 60_003_760,
    readyAtMs: Date.now() + 10,
  });
  const transition = shipDestruction._testing.queueCloneSelectionTransition(
    session,
    () => {
      completed += 1;
    },
    { transitionDelayMs: 10 },
  );
  assert.equal(transition.pending, true);
  assert.equal(transition.delayMs, 10);
  assert.equal(transition.presentationPending, true);
  assert.equal(transition.deferredUntilConfirmation, true);
  assert.equal(completed, 0);
  const service = new LocationSelectionMgrService();
  assert.throws(
    () => service.Handle_get_locations([], session),
    /CLONE_SELECTION_NOT_READY/,
  );
  assert.equal(completed, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(completed, 0);
  assert.deepEqual(sessionChanges, [{ shipid: [9_300, null] }]);

  // A failed DeathMessageIntegration falls through to the clone-selection view
  // and calls get_locations without any player confirmation. Merely loading the
  // map must therefore leave the pending transition and preserved ship intact.
  service.Handle_get_locations([], session);
  assert.equal(completed, 0);

  // The actual location-selection/spawn RPC uses this confirmation path after
  // validating the chosen destination.
  assert.equal(
    shipDestruction._testing.confirmCloneSelectionTransition(session).success,
    true,
  );
  assert.equal(completed, 1);
});

test("destroyed hull reports retain the original ship id after the session is cleared", () => {
  let completed = 0;
  const sessionChanges: any[] = [];
  const session = {
    characterID: 301,
    shipid: null,
    sendSessionChange(changes) {
      sessionChanges.push(changes);
    },
  };

  const transition = shipDestruction._testing.queueCloneSelectionTransition(
    session,
    () => {
      completed += 1;
    },
    {
      attachedShipID: 9_301,
      transitionDelayMs: 0,
    },
  );

  assert.equal(transition.pending, true);
  assert.deepEqual(sessionChanges, [{ shipid: [9_301, null] }]);
  assert.equal(completed, 0);
  assert.equal(
    shipDestruction._testing.confirmCloneSelectionTransition(session).success,
    true,
  );
  assert.equal(completed, 1);
});

test("Crude Matter Rift proximity builds temporal drift and triggers shell drain", () => {
  const ship = buildPlayerShip(101);
  const scene = buildScene(ship, [buildRift()]);

  const initial = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    {
      damageDelaySeconds: 0,
      vitalityDrainPerEffectPerSecond: 10,
    },
  );
  assert.equal(initial.externalTemporalDrift, 200);
  assert.equal(initial.temporalDrift, 0);

  const exposed = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    2_000,
    {
      damageDelaySeconds: 0,
      vitalityDrainPerEffectPerSecond: 10,
    },
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

test("a ship berthed in a compatible SmartHangar is protected from environmental effects", () => {
  const ship = buildPlayerShip(203, {
    frontierBerthingHostAssemblyID: 91_003,
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
    conditionState: {
      armorDamage: 0,
      damage: 0,
      shieldCharge: 1,
      temperature: environmentalEffects.CRITICAL_TEMPERATURE_K,
    },
  });
  const scene = buildScene(ship, [buildRift()]);
  const options = {
    damageDelaySeconds: 0,
    hitpointDamagePerEffectPerSecond: 25,
    vitalityDamagePerEffectPerSecond: 25,
  };

  const initial = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    options,
  );
  const protectedTick = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    5_000,
    options,
  );

  assert.equal(initial.protected, true);
  assert.equal(protectedTick.protected, true);
  assert.equal(protectedTick.damagingEffectSeconds, 0);
  assert.equal(protectedTick.hitpointDamageApplied, 0);
  assert.equal(protectedTick.vitalityDamageApplied, 0);
  assert.equal(protectedTick.vitality, 100);
  assert.equal(ship.conditionState.shieldCharge, 1);

  const npc = {
    kind: "ship",
    nativeNpc: true,
    passiveDerivedState: {
      attributes: {
        [environmentalEffects.ATTRIBUTE_FERALIZATION_AMOUNT_PER_SCAN]: 100,
      },
    },
  };
  const scanned = environmentalEffects.applyNpcFeralization(
    ship,
    npc,
    "scan",
    5_000,
  );
  assert.equal(scanned.protected, true);
  assert.equal(scanned.applied, false);

  delete ship.frontierBerthingHostAssemblyID;
  const exposed = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    6_000,
    options,
  );
  assert.equal(exposed.protected, undefined);
  assert.ok(exposed.hitpointDamageApplied > 0);
  assert.ok(exposed.vitalityDamageApplied > 0);
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
  const options = {
    damageDelaySeconds: 0,
    vitalityDrainPerEffectPerSecond: 25,
  };

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
  assert.deepEqual(depleted.cloneDeath, {
    characterID,
    reason: "vitality",
    shipID: ship.itemID,
    statusEffectKey: "heat",
  });
  const alreadyDepleted = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    6_000,
    options,
  );
  assert.equal(alreadyDepleted.cloneDeath, null);

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

test("environmental hull depletion requests clone death through the ship explosion path", () => {
  const characterID = 302;
  let receivedDamageMetadata = null;
  const ship = buildPlayerShip(characterID, {
    conditionState: { temperature: environmentalEffects.CRITICAL_TEMPERATURE_K },
  });
  const scene = buildScene(ship);
  const options = {
    damageDelaySeconds: 0,
    hitpointDamagePerEffectPerSecond: 10,
    vitalityDamagePerEffectPerSecond: 0,
    applyHitpointDamage(_entity, _rawDamage, metadata) {
      receivedDamageMetadata = metadata;
      return {
        success: true,
        data: {
          destroyed: true,
          perLayer: [{ appliedEffective: 10 }],
        },
      };
    },
  };

  environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    options,
  );
  const destroyed = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    2_000,
    options,
  );

  assert.deepEqual(destroyed.cloneDeath, {
    characterID,
    reason: "hull",
    shipID: ship.itemID,
    statusEffectKey: "heat",
  });
  assert.deepEqual(receivedDamageMetadata, { statusEffectKey: "heat" });
});

test("locationSelectionMgr returns a marshal-safe environmental death report", () => {
  const characterID = 303;
  const deathTimeMs = Date.UTC(2026, 8, 18, 12, 34, 56);
  LocationSelectionMgrService.recordEnvironmentalDeathReport(characterID, {
    deathTimeMs,
    shellTypeID: 91969,
    shipID: 88_001,
    shipTypeID: 587,
    solarSystemID: 30_000_142,
    statusEffectKey: "temporal_drift",
  });

  const payload = new LocationSelectionMgrService()
    .Handle_get_last_death_report([], { characterID });
  assert.equal(payload.type, "objectex1");
  assert.equal(
    payload.header[0].value,
    "frontier.clone_selection.common.location.DeathReport",
  );
  assert.equal(payload.header[1][0], 88_001);
  assert.equal(payload.header[1][1], 30_000_142);
  assert.equal(payload.header[1][2], 587);
  assert.equal(payload.header[1][3], 91969);
  assert.equal(payload.header[1][4].type, "list");
  assert.equal(payload.header[1][5].type, "list");
  assert.equal(payload.header[1][6].type, "objectex1");
  assert.equal(payload.header[1][6].header[0].value, "datetime.datetime");
  assert.deepEqual(payload.header[1][6].header[1], [
    2026,
    9,
    18,
    12,
    34,
    56,
    0,
  ]);
  assert.equal(payload.header[1][7], null);
  assert.equal(payload.header[1][8], null);
  assert.equal(payload.header[1][9], null);
  assert.equal(payload.header[1][10], "temporal_drift");

  const encoded = marshalEncode(payload, { compatibilityProfile: "frontier" });
  const decoded = marshalDecode(encoded, { compatibilityProfile: "frontier" });
  assert.equal(decoded.header[1][6].type, "objectex1");
  assert.equal(decoded.header[1][6].header[0].value, "datetime.datetime");
});

test("death reports identify player attackers and NPC attacking ship types", () => {
  const playerVictimCharacterID = 305;
  const playerAttackerCharacterID = 140_000_099;
  const playerDeath = shipDestruction._testing.recordCloneDeathStateSafe(
    { characterID: playerVictimCharacterID },
    { itemID: 88_101, typeID: 95_276 },
    30_000_142,
    null,
    Date.UTC(2026, 8, 18, 12, 35, 0),
    {
      attackerEntity: {
        itemID: 88_201,
        kind: "ship",
        typeID: 95_276,
        characterID: playerAttackerCharacterID,
      },
      transitionDelayMs: 0,
    },
  );
  assert.equal(playerDeath.deathReport.finalBlow, playerAttackerCharacterID);
  assert.equal(playerDeath.deathReport.finalShipTypeID, 95_276);

  const playerPayload = new LocationSelectionMgrService()
    .Handle_get_last_death_report([], { characterID: playerVictimCharacterID });
  assert.equal(playerPayload.header[1][7], playerAttackerCharacterID);
  assert.equal(playerPayload.header[1][8], 95_276);
  assert.equal(playerPayload.header[1][10], null);

  const npcVictimCharacterID = 306;
  const npcDeath = shipDestruction._testing.recordCloneDeathStateSafe(
    { characterID: npcVictimCharacterID },
    { itemID: 88_102, typeID: 95_276 },
    30_000_142,
    null,
    Date.UTC(2026, 8, 18, 12, 36, 0),
    {
      attackerEntity: {
        itemID: 88_202,
        kind: "ship",
        nativeNpc: true,
        typeID: 11_565,
      },
      transitionDelayMs: 0,
    },
  );
  assert.equal(npcDeath.deathReport.finalBlow, null);
  assert.equal(npcDeath.deathReport.finalShipTypeID, 11_565);

  const npcPayload = new LocationSelectionMgrService()
    .Handle_get_last_death_report([], { characterID: npcVictimCharacterID });
  assert.equal(npcPayload.header[1][7], null);
  assert.equal(npcPayload.header[1][8], 11_565);
  assert.equal(npcPayload.header[1][10], null);
});

test("clone selection exposes active refuge and deployed-hangar systems", () => {
  const characterID = 304;
  const deathSystemID = 30_000_142;
  const refugeSystemID = 30_000_143;
  const hangarSystemID = 30_000_144;
  LocationSelectionMgrService.recordCloneDeathReport(characterID, {
    deathTimeMs: Date.UTC(2026, 8, 18, 12, 34, 56),
    shellTypeID: 91969,
    shipID: 88_002,
    shipTypeID: 587,
    solarSystemID: deathSystemID,
  });
  const pending = LocationSelectionMgrService.recordPendingCloneDeath(
    characterID,
    {
      deathSystemID,
      fallbackStationID: 60_003_760,
      readyAtMs: Date.now(),
      reason: "hull",
    },
  );
  const items = {
    91_001: {
      itemID: 91_001,
      typeID: 87_160,
      ownerID: characterID,
      locationID: refugeSystemID,
      flagID: 0,
      spaceState: { systemID: refugeSystemID },
      state: { assemblyStatus: 2, solarSystemID: refugeSystemID },
    },
    91_002: {
      itemID: 91_002,
      typeID: 77_917,
      ownerID: characterID,
      locationID: hangarSystemID,
      flagID: 0,
      spaceState: { systemID: hangarSystemID },
      state: { assemblyStatus: 2, solarSystemID: hangarSystemID },
    },
    91_003: {
      itemID: 91_003,
      typeID: 77_917,
      ownerID: characterID,
      locationID: 30_000_145,
      flagID: 0,
      spaceState: { systemID: 30_000_145 },
      state: { assemblyStatus: 1, solarSystemID: 30_000_145 },
    },
  };
  const payload = LocationSelectionMgrService.buildAvailableLocationsPayload(
    characterID,
    {
      pending,
      getAllItems: () => items,
      readConstructionState: (item) => item.state,
      isAssemblyActivationPending: () => false,
      getSmartHangarDefinition: () => ({
        allowFreeForAll: false,
        allowUserAdd: true,
      }),
      smartHangarAcceptsShip: () => true,
    },
  );

  const selectableLocations = LocationSelectionMgrService
    .resolveSelectableCloneLocations(characterID, {
      pending,
      getAllItems: () => items,
      readConstructionState: (item) => item.state,
      isAssemblyActivationPending: () => false,
      getSmartHangarDefinition: (typeID) => typeID === 87_160
        ? null
        : {
            allowFreeForAll: false,
            allowUserAdd: true,
          },
      smartHangarAcceptsShip: () => true,
    });
  assert.deepEqual(
    selectableLocations.map((location) => ({
      locationID: location.locationID,
      shipTypeID: location.shipTypeID,
    })),
    [
      {
        locationID: 91_001,
        shipTypeID: LocationSelectionMgrService.REFUGE_SHIP_TYPE_ID,
      },
      {
        locationID: 91_002,
        shipTypeID: LocationSelectionMgrService.CREATION_SHIP_TYPE_ID,
      },
    ],
  );

  assert.equal(payload.type, "list");
  assert.equal(payload.items.length, 3);
  const locationKeys = payload.items.map((location) => location.header[1][0]);
  assert.equal(
    locationKeys[0].header[0].value,
    "frontier.clone_selection.common.location.DeathLocationKey",
  );
  assert.deepEqual(locationKeys.slice(1).map((key) => key.header[1]), [
    [refugeSystemID, 91_001],
    [hangarSystemID, 91_002],
  ]);
  assert.deepEqual(
    LocationSelectionMgrService.parseLocationKey(locationKeys[1]),
    { solarSystemID: refugeSystemID, locationID: 91_001 },
  );
  assert.deepEqual(
    LocationSelectionMgrService.parseLocationKeys({
      type: "list",
      items: locationKeys.slice(1),
    }),
    [
      { solarSystemID: refugeSystemID, locationID: 91_001 },
      { solarSystemID: hangarSystemID, locationID: 91_002 },
    ],
  );
  assert.deepEqual(
    LocationSelectionMgrService.parseLocationKey({
      type: "objectex2",
      header: [
        [{
          type: "token",
          value: "frontier.clone_selection.common.location.RefugeLocationKey",
        }],
        {
          type: "dict",
          entries: [
            ["solarsystem_id", refugeSystemID],
            ["assembly_id", 91_001],
          ],
        },
      ],
      list: [],
      dict: [],
    }),
    { solarSystemID: refugeSystemID, locationID: 91_001 },
  );
});

test("clone selection falls back to the configured station when no assembly is eligible", () => {
  const characterID = 305;
  const deathSystemID = 30_000_142;
  const stationSystemID = 30_002_187;
  const stationID = 60_003_760;
  const pending = LocationSelectionMgrService.recordPendingCloneDeath(
    characterID,
    {
      deathSystemID,
      fallbackStationID: stationID,
      readyAtMs: Date.now(),
      reason: "vitality",
    },
  );
  const locations = LocationSelectionMgrService.resolveSelectableCloneLocations(
    characterID,
    {
      pending,
      getAllItems: () => ({}),
      getStationByID: () => ({ stationID, solarSystemID: stationSystemID }),
    },
  );

  assert.deepEqual(locations, [{
    kind: "station",
    locationID: stationID,
    solarSystemID: stationSystemID,
    shipTypeID: LocationSelectionMgrService.CREATION_SHIP_TYPE_ID,
    shellTypeID: 91969,
  }]);
});

test("station clone fallback awakens in space instead of opening hangar", () => {
  const worldData = require("../src/space/worldData");
  const itemStore = require("../src/services/inventory/itemStore");
  const transitions = require("../src/space/transitions");
  const originals = {
    createShipItemForCharacter: itemStore.createShipItemForCharacter,
    getStationByID: worldData.getStationByID,
    jumpSessionToSolarSystem: transitions.jumpSessionToSolarSystem,
    rebuildDockedSessionAtStation: transitions.rebuildDockedSessionAtStation,
    removeInventoryItem: itemStore.removeInventoryItem,
    setActiveShipForCharacter: itemStore.setActiveShipForCharacter,
  };
  const station = {
    stationID: 60_003_760,
    solarSystemID: 30_002_187,
    position: { x: 3_000, y: 4_000, z: 0 },
    radius: 20_000,
  };
  const createdShip = {
    itemID: 99_001,
    typeID: LocationSelectionMgrService.CREATION_SHIP_TYPE_ID,
  };
  let capturedJump = null;

  try {
    worldData.getStationByID = () => station;
    itemStore.createShipItemForCharacter = () => ({
      success: true,
      data: createdShip,
    });
    itemStore.setActiveShipForCharacter = () => ({ success: true });
    itemStore.removeInventoryItem = () => {
      throw new Error("unexpected station fallback rollback");
    };
    transitions.rebuildDockedSessionAtStation = () => {
      throw new Error("clone selection must not transition directly to hangar");
    };
    transitions.jumpSessionToSolarSystem = (session, solarSystemID, options) => {
      capturedJump = { session, solarSystemID, options };
      return { success: true, data: { solarSystemID } };
    };

    const session = { characterID: 306 };
    const result = LocationSelectionMgrService.spawnAtStation(session, {
      kind: "station",
      locationID: station.stationID,
      solarSystemID: station.solarSystemID,
      shipTypeID: LocationSelectionMgrService.CREATION_SHIP_TYPE_ID,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.createdShip, createdShip);
    assert.equal(capturedJump.session, session);
    assert.equal(capturedJump.solarSystemID, station.solarSystemID);
    assert.equal(capturedJump.options.countsTowardJumpGoal, false);
    assert.equal(
      capturedJump.options.spawnStateOverride.anchorType,
      "station-clone-fallback",
    );
    assert.deepEqual(
      capturedJump.options.spawnStateOverride.position,
      { x: 18_000, y: 24_000, z: 0 },
    );
  } finally {
    itemStore.createShipItemForCharacter = originals.createShipItemForCharacter;
    worldData.getStationByID = originals.getStationByID;
    transitions.jumpSessionToSolarSystem = originals.jumpSessionToSolarSystem;
    transitions.rebuildDockedSessionAtStation = originals.rebuildDockedSessionAtStation;
    itemStore.removeInventoryItem = originals.removeInventoryItem;
    itemStore.setActiveShipForCharacter = originals.setActiveShipForCharacter;
  }
});

test("station clone fallback persists an in-space ship and session", () => {
  const characterState = require("../src/services/character/characterState");
  const itemStore = require("../src/services/inventory/itemStore");
  const spaceRuntime = require("../src/space/runtime");
  const worldData = require("../src/space/worldData");
  const characterID = 199_999_306;
  const stationID = 64_000_001;
  const station = worldData.getStationByID(stationID);
  assert.ok(station, "Frontier station fixture is required");

  const originalAttachSession = spaceRuntime.attachSession;
  const sessionChanges: any[] = [];
  const notifications: any[] = [];
  const session: Record<string, any> = {
    characterID,
    charid: characterID,
    characterName: "Clone Transition Test",
    locationid: station.solarSystemID,
    solarsystemid: station.solarSystemID,
    solarsystemid2: station.solarSystemID,
    stationid: null,
    stationID: null,
    stationid2: null,
    structureid: null,
    structureID: null,
    shipid: null,
    shipID: null,
    activeShipID: 0,
    sendNotification(...args) {
      notifications.push(args);
    },
    sendSessionChange(changes) {
      sessionChanges.push(changes);
    },
  };

  characterState.writeCharacterRecord(characterID, {
    characterID,
    characterName: session.characterName,
    corporationID: 1_000_442,
    stationID: null,
    structureID: null,
    solarSystemID: station.solarSystemID,
    constellationID: 20_000_004,
    regionID: 10_000_004,
    homeStationID: stationID,
    cloneStationID: stationID,
    shipID: 0,
    shipTypeID: 0,
    shipName: "",
    suppressActiveShipProvisioning: true,
  });

  try {
    spaceRuntime.attachSession = (attachedSession, ship, options) => {
      attachedSession._space = {
        systemID: Number(options.systemID),
        shipID: Number(ship.itemID),
      };
      return attachedSession._space;
    };

    const result = LocationSelectionMgrService.spawnAtStation(session, {
      kind: "station",
      locationID: stationID,
      solarSystemID: station.solarSystemID,
      shipTypeID: LocationSelectionMgrService.CREATION_SHIP_TYPE_ID,
    });

    assert.equal(result.success, true);
    assert.equal(session.stationid, null);
    assert.equal(session.stationid2, null);
    assert.equal(session.locationid, station.solarSystemID);
    assert.equal(session.solarsystemid, station.solarSystemID);
    assert.equal(session.solarsystemid2, station.solarSystemID);
    assert.equal(session.shipid, result.data.createdShip.itemID);
    assert.equal(session._space.shipID, result.data.createdShip.itemID);

    const ship = itemStore.findShipItemById(result.data.createdShip.itemID);
    assert.equal(ship.locationID, station.solarSystemID);
    assert.equal(ship.flagID, 0);
    assert.equal(ship.spaceState.systemID, station.solarSystemID);

    const character = characterState.getCharacterRecord(characterID);
    assert.equal(character.stationID, null);
    assert.equal(character.structureID, null);
    assert.equal(character.solarSystemID, station.solarSystemID);
    assert.equal(character.shipID, ship.itemID);

    const emittedStationDestination = sessionChanges.some((changes) => (
      changes.stationid && Number(changes.stationid[1]) > 0
    ));
    assert.equal(emittedStationDestination, false);
    assert.ok(notifications.length > 0);
  } finally {
    spaceRuntime.attachSession = originalAttachSession;
    const activeShip = itemStore.getActiveShipItem(characterID);
    if (activeShip) {
      itemStore.removeInventoryItem(activeShip.itemID, { removeContents: true });
    }
    characterState.removeCharacterRecord(characterID);
  }
});

test("configured thresholds and grace period delay vitality and ship HP damage", () => {
  const ship = buildPlayerShip(351, {
    shieldCapacity: 100,
    armorHP: 100,
    structureHP: 100,
    conditionState: {
      armorDamage: 0,
      damage: 0,
      shieldCharge: 1,
      temperature: 2_000,
    },
  });
  const scene = buildScene(ship);
  const options = {
    damageDelaySeconds: 2,
    heatCriticalThresholdKelvin: 2_000,
    heatWarningThresholdKelvin: 1_000,
    hitpointDamagePerEffectPerSecond: 10,
    vitalityDamagePerEffectPerSecond: 10,
  };

  environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    options,
  );
  const oneSecond = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    2_000,
    options,
  );
  const atDelay = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    3_000,
    options,
  );
  const damaging = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    4_000,
    options,
  );

  assert.equal(oneSecond.vitalityDamageApplied, 0);
  assert.equal(atDelay.vitalityDamageApplied, 0);
  assert.equal(damaging.damagingEffectSeconds, 1);
  assert.equal(damaging.vitalityDamageApplied, 10);
  assert.equal(damaging.vitality, 90);
  assert.equal(damaging.hitpointDamageRequested, 10);
  assert.equal(damaging.hitpointDamageApplied, 10);
  assert.equal(ship.conditionState.shieldCharge, 0.9);
  assert.equal(
    environmentalEffects.snapshotCharacterState(351).effects.heat
      .damageExposureSeconds,
    3,
  );
});

test("configured environmental threshold overrides control effect activation", () => {
  const ship = buildPlayerShip(352, {
    conditionState: { temperature: 1_500 },
  });
  const scene = buildScene(ship);
  const options = {
    damageDelaySeconds: 0,
    heatCriticalThresholdKelvin: 2_000,
    heatWarningThresholdKelvin: 1_000,
    vitalityDamagePerEffectPerSecond: 10,
  };

  environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    1_000,
    options,
  );
  const belowCritical = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    2_000,
    options,
  );
  assert.equal(belowCritical.heatGrace, 0.5);
  assert.equal(belowCritical.activeEffectCount, 0);
  assert.equal(belowCritical.vitality, 100);

  ship.conditionState.temperature = 2_000;
  const critical = environmentalEffects.advanceEntityEnvironmentalEffects(
    scene,
    ship,
    3_000,
    options,
  );
  assert.equal(critical.activeEffectCount, 1);
  assert.equal(critical.vitality, 90);
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
