import assert from "node:assert/strict";
import test from "node:test";
import { bcs } from "@mysten/sui/bcs";
import {
  createSuiTurretPriorityResolver,
  evaluateDefaultSuiTurretPriority,
  parseSuiTurretPriorityList,
  serializeSuiTurretCandidates,
  TURRET_BEHAVIOUR_ENTERED,
  TURRET_BEHAVIOUR_STARTED_ATTACK,
  TURRET_BEHAVIOUR_STOPPED_ATTACK,
  type SuiTurretTargetCandidate,
} from "../src/services/frontier/suiTurretPriority";

const smartTurretRuntime = require("../src/services/frontier/smartTurretRuntime");

function candidate(overrides: Partial<SuiTurretTargetCandidate> = {}): SuiTurretTargetCandidate {
  return {
    item_id: 100n,
    type_id: 200n,
    group_id: 25n,
    character_id: 20,
    character_tribe: 200,
    hp_ratio: 100n,
    shield_ratio: 100n,
    armor_ratio: 100n,
    is_aggressor: false,
    priority_weight: 10n,
    behaviour_change: TURRET_BEHAVIOUR_ENTERED,
    ...overrides,
  };
}

test("Sui turret default policy excludes owner/allies and weights hostiles and aggressors", () => {
  const result = evaluateDefaultSuiTurretPriority([
    candidate({ item_id: 1n, character_id: 10, character_tribe: 100 }),
    candidate({ item_id: 2n, character_id: 11, character_tribe: 100 }),
    candidate({ item_id: 3n, priority_weight: 25n }),
    candidate({
      item_id: 4n,
      character_id: 12,
      character_tribe: 100,
      is_aggressor: true,
      priority_weight: 30n,
      behaviour_change: TURRET_BEHAVIOUR_STARTED_ATTACK,
    }),
    candidate({
      item_id: 5n,
      behaviour_change: TURRET_BEHAVIOUR_STOPPED_ATTACK,
    }),
  ], 10, 100);

  assert.deepEqual(result, [
    { target_item_id: 3n, priority_weight: 1_025n },
    { target_item_id: 4n, priority_weight: 10_030n },
  ]);
});

test("Sui turret BCS codec matches the deployed world contract layout", () => {
  const encodedCandidates = serializeSuiTurretCandidates([
    candidate({ item_id: 9_223_372_036_854_775_000n }),
  ]);
  assert.ok(encodedCandidates.length > 20);

  const Entry = bcs.struct("ReturnTargetPriorityList", {
    target_item_id: bcs.u64(),
    priority_weight: bcs.u64(),
  });
  const inner = bcs.vector(Entry).serialize([
    { target_item_id: 55n, priority_weight: 10_500n },
  ]).toBytes();
  const outer = bcs.vector(bcs.u8()).serialize(inner).toBytes();
  assert.deepEqual(parseSuiTurretPriorityList(outer), [
    { target_item_id: 55n, priority_weight: 10_500n },
  ]);
});

test("Sui turret resolver verifies the deployed turret and filters its priority response", async () => {
  const Entry = bcs.struct("ReturnTargetPriorityList", {
    target_item_id: bcs.u64(),
    priority_weight: bcs.u64(),
  });
  const inner = bcs.vector(Entry).serialize([
    { target_item_id: 77n, priority_weight: 12_000n },
    { target_item_id: 88n, priority_weight: 99_000n },
    { target_item_id: 77n, priority_weight: 1n },
  ]).toBytes();
  const priorityBytes = Array.from(bcs.vector(bcs.u8()).serialize(inner).toBytes());
  const calls: any[] = [];
  const client = {
    async devInspectTransactionBlock(input: any) {
      calls.push(input);
      if (calls.length === 1) {
        return {
          effects: { status: { status: "success" } },
          results: [{ returnValues: [[[0], "bool"]] }],
        };
      }
      return {
        effects: { status: { status: "success" } },
        results: [
          { returnValues: [] },
          { returnValues: [[priorityBytes, "vector<u8>"]] },
        ],
      };
    },
  };
  const resolver = createSuiTurretPriorityResolver({
    client,
    world: {
      packageId: "0x1",
      objectRegistryId: "0x2",
      tenant: "dev",
    },
    sender: "0x3",
  });

  const result = await resolver.resolve({
    turretItemID: 9_001,
    ownerCharacterID: 140_000_001,
    candidates: [candidate({ item_id: 77n })],
  });

  assert.equal(calls.length, 2, "extension lookup and priority evaluation both use dev-inspect");
  assert.deepEqual(result, [{ target_item_id: 77n, priority_weight: 12_000n }]);
});

test("Smart Turret selects its fitted weapon type before the assembly default", () => {
  const component = { smartTurret: { defaultTurret: 92_402 } };
  assert.equal(smartTurretRuntime._testing.resolveFittedWeaponTypeID({
    itemID: 9_001,
    fittedWeaponTypeID: 92_511,
  }, component), 92_511);
  assert.equal(smartTurretRuntime._testing.resolveFittedWeaponTypeID({
    itemID: 9_002,
    fittedItems: [{ itemID: 10, typeID: 92_403, flagID: 27 }],
  }, component), 92_403);
  assert.equal(smartTurretRuntime._testing.resolveFittedWeaponTypeID({
    itemID: 9_003,
  }, component), 92_402);
});

test("Smart Turret marks recent weapon users as aggressors for on-chain policy", () => {
  smartTurretRuntime._testing.clearCaches();
  const nowMs = 50_000;
  const attacker = {
    itemID: 77,
    typeID: 600,
    groupID: 25,
    ownerID: 140_000_002,
    characterID: 140_000_002,
    kind: "ship",
    position: { x: 10_000, y: 0, z: 0 },
    radius: 30,
  };
  const unrelatedTarget = { itemID: 88, ownerID: 140_000_003 };
  const turret: any = {
    itemID: 9_001,
    ownerID: 140_000_001,
    position: { x: 0, y: 0, z: 0 },
    radius: 100,
  };
  const profile = {
    weaponTypeID: 92_403,
    chargeTypeID: 82_132,
    optimalRange: 120_000,
    falloffRange: 20_000,
    engagementRange: 160_000,
  };
  const interop = {
    hasDamageableHealth: () => true,
    getEntityMaxHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    getEntityCurrentHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
  };

  assert.equal(smartTurretRuntime.noteIncomingAggression(attacker, unrelatedTarget, nowMs), true);
  const recent = smartTurretRuntime._testing.buildCandidate(
    turret,
    attacker,
    profile,
    nowMs + 1,
    interop,
  );
  assert.equal(recent.candidate.is_aggressor, true);
  assert.equal(recent.candidate.behaviour_change, TURRET_BEHAVIOUR_ENTERED);

  const expired = smartTurretRuntime._testing.buildCandidate(
    turret,
    attacker,
    profile,
    nowMs + smartTurretRuntime._testing.SMART_TURRET_AGGRESSION_TTL_MS + 1,
    interop,
  );
  assert.equal(expired.candidate.is_aggressor, false);
  smartTurretRuntime._testing.clearCaches();
});

test("Smart Turret waits for Sui priority and target lock before firing", async () => {
  const target = {
    itemID: 9002,
    typeID: 600,
    groupID: 25,
    ownerID: 140000002,
    kind: "ship",
    position: { x: 10_000, y: 0, z: 0 },
    radius: 30,
  };
  const turret: any = {
    itemID: 9001,
    typeID: 92401,
    ownerID: 140000001,
    kind: "deployable",
    assembly_status: 2,
    component_activate: [true, null],
    position: { x: 0, y: 0, z: 0 },
    radius: 100,
    lockedTargets: new Map(),
  };
  const entities = new Map<number, any>([
    [turret.itemID, turret],
    [target.itemID, target],
  ]);
  const scene = {
    dynamicEntities: entities,
    getEntityByID: (id: number) => entities.get(id),
    clearOutgoingTargetLocks(entity: any) {
      entity.lockedTargets.clear();
    },
    allocateTargetSequence: () => 1,
    finalizeTargetLock(entity: any, selected: any) {
      entity.lockedTargets.set(selected.itemID, { targetID: selected.itemID });
      return { success: true };
    },
    broadcastSpecialFx() {},
  };
  let shots = 0;
  const interop = {
    hasDamageableHealth: () => true,
    getEntityMaxHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    getEntityCurrentHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    resolveTurretShot: () => ({
      hit: true,
      quality: 1,
      shotDamage: { em: 0, thermal: 10, kinetic: 0, explosive: 0 },
    }),
    applyWeaponDamageToTarget: () => {
      shots += 1;
      return { damageResult: { success: true, data: {} }, destroyResult: null };
    },
    getAppliedDamageAmount: () => 10,
    noteKillmailDamage() {},
    recordKillmailFromDestruction() {},
    notifyWeaponDamageMessages() {},
    getCombatMessageHitQuality: () => 1,
  };
  const profile = {
    assemblyTypeID: 92401,
    weaponTypeID: 92403,
    chargeTypeID: 82132,
    optimalRange: 120_000,
    falloffRange: 20_000,
    engagementRange: 160_000,
    snapshot: {
      durationMs: 3_400,
      family: "hybridTurret",
      effectGUID: null,
      rawShotDamage: { em: 0, thermal: 434, kinetic: 0, explosive: 0 },
    },
    moduleItem: { itemID: 92403, typeID: 92403 },
    chargeItem: { itemID: 82132, typeID: 82132 },
  };
  const candidates = [candidate({ item_id: BigInt(target.itemID) })];
  const priorityResolver = {
    async resolve() {
      return [{ target_item_id: BigInt(target.itemID), priority_weight: 1_500n }];
    },
  };
  const options = {
    component: { smartTurret: { defaultTurret: 92403 } },
    candidates,
    interop,
    priorityResolver,
    profile,
  };

  smartTurretRuntime._testing.tickTurret(scene, turret, 10_000, options);
  assert.equal(shots, 0, "contract result is asynchronous");
  assert.equal(turret.maxTargetRange, 160_000);
  assert.equal(turret.smartTurretOptimalRange, 120_000);
  assert.equal(turret.smartTurretFalloffRange, 20_000);
  assert.equal(turret.activeSmartTurretWeaponTypeID, 92_403);
  await new Promise((resolve) => setImmediate(resolve));
  smartTurretRuntime._testing.tickTurret(scene, turret, 10_100, options);
  assert.equal(shots, 0, "target lock has not completed");
  smartTurretRuntime._testing.tickTurret(scene, turret, 11_601, options);
  assert.equal(shots, 1);
  assert.equal(turret.lockedTargets.has(target.itemID), true);

  const heavyProfile = {
    ...profile,
    weaponTypeID: 92_511,
    chargeTypeID: 82_140,
    optimalRange: 140_000,
    falloffRange: 20_000,
    engagementRange: 180_000,
  };
  smartTurretRuntime._testing.tickTurret(scene, turret, 11_602, {
    ...options,
    profile: heavyProfile,
  });
  assert.equal(turret.maxTargetRange, 180_000, "range follows the newly fitted weapon");
  assert.equal(turret.activeSmartTurretWeaponTypeID, 92_511);
  assert.equal(turret.lockedTargets.has(target.itemID), false, "weapon changes reacquire priority");
  await new Promise((resolve) => setImmediate(resolve));
});

test("Field Sentry uses its authored direct-fire weapon profile", () => {
  smartTurretRuntime._testing.clearCaches();
  const profile = smartTurretRuntime._testing.getWeaponProfile({
    itemID: 9_601,
    typeID: 96_099,
    ownerID: 140_000_001,
  }, {
    behavior: {
      behaviorName: "2465",
      groupBehaviorID: 2466,
    },
  });

  assert.ok(profile, "build 3502403 must expose the Field Sentry dogma profile");
  assert.equal(profile.assemblyTypeID, 96_099);
  assert.equal(profile.weaponTypeID, 96_099);
  assert.equal(profile.chargeTypeID, 0, "the sentry carries damage on its hull, not ammunition");
  assert.equal(profile.snapshot.family, "projectileTurret");
  assert.deepEqual(profile.snapshot.rawShotDamage, {
    em: 0,
    thermal: 0,
    kinetic: 162,
    explosive: 0,
  });
  assert.equal(profile.snapshot.durationMs, 1_600);
  assert.equal(profile.optimalRange, 50_000);
  assert.equal(profile.falloffRange, 66_000);
  assert.equal(profile.engagementRange, 25_000, "authored lock range caps weapon falloff");
  smartTurretRuntime._testing.clearCaches();
});

test("Field Sentry targets only owner-safe attackers of itself or its source ship", () => {
  smartTurretRuntime._testing.clearCaches();
  const nowMs = 100_000;
  const sentry: any = {
    itemID: 9_601,
    typeID: 96_099,
    ownerID: 140_000_001,
    kind: "deployable",
    fieldSentryBehaviorName: "2465",
    fieldSentryGroupBehaviorID: 2466,
    launchBayPayloadState: { sourceShipID: 9_600 },
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
  };
  const sourceShip = {
    itemID: 9_600,
    typeID: 95_020,
    ownerID: sentry.ownerID,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 30,
  };
  const attacker = {
    itemID: 9_602,
    typeID: 600,
    groupID: 25,
    ownerID: 140_000_002,
    characterID: 140_000_002,
    kind: "ship",
    position: { x: 10_000, y: 0, z: 0 },
    radius: 30,
  };
  const neutral = {
    itemID: 9_603,
    typeID: 600,
    groupID: 25,
    ownerID: 140_000_003,
    characterID: 140_000_003,
    kind: "ship",
    position: { x: 8_000, y: 0, z: 0 },
    radius: 30,
  };
  const ownerShip = {
    itemID: 9_604,
    typeID: 600,
    groupID: 25,
    ownerID: sentry.ownerID,
    characterID: sentry.ownerID,
    kind: "ship",
    position: { x: 5_000, y: 0, z: 0 },
    radius: 30,
  };
  const unrelatedDefender = { itemID: 9_605, ownerID: 140_000_004 };
  const entities = new Map<number, any>([
    [sentry.itemID, sentry],
    [sourceShip.itemID, sourceShip],
    [attacker.itemID, attacker],
    [neutral.itemID, neutral],
    [ownerShip.itemID, ownerShip],
  ]);
  const scene = { dynamicEntities: entities };
  const interop = {
    hasDamageableHealth: () => true,
    getEntityMaxHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    getEntityCurrentHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
  };
  const profile = {
    weaponTypeID: 96_099,
    engagementRange: 25_000,
  };
  const targetIDs = () => smartTurretRuntime._testing.collectFieldSentryCandidates(
    scene,
    sentry,
    profile,
    nowMs + 1,
    interop,
  ).map((entry: SuiTurretTargetCandidate) => Number(entry.item_id));

  assert.deepEqual(targetIDs(), [], "mere proximity never authorizes defensive fire");
  smartTurretRuntime.noteIncomingAggression(attacker, unrelatedDefender, nowMs);
  assert.deepEqual(targetIDs(), [], "global combat activity is not enough");
  smartTurretRuntime.noteIncomingAggression(ownerShip, sourceShip, nowMs);
  assert.deepEqual(targetIDs(), [], "the deployer's own ships remain excluded");
  smartTurretRuntime.noteIncomingAggression(attacker, sourceShip, nowMs);
  assert.deepEqual(targetIDs(), [attacker.itemID]);

  smartTurretRuntime._testing.clearCaches();
  smartTurretRuntime.noteIncomingAggression(attacker, sentry, nowMs);
  assert.deepEqual(targetIDs(), [attacker.itemID], "an attack on the sentry itself also authorizes fire");
  smartTurretRuntime._testing.clearCaches();
});

test("Field Sentry fires through the shared weapon damage and FX path", () => {
  smartTurretRuntime._testing.clearCaches();
  const nowMs = 200_000;
  const sourceShip: any = {
    itemID: 9_610,
    typeID: 95_020,
    ownerID: 140_000_001,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    radius: 30,
  };
  const sentry: any = {
    itemID: 9_611,
    typeID: 96_099,
    ownerID: sourceShip.ownerID,
    kind: "deployable",
    fieldSentryBehaviorName: "2465",
    fieldSentryGroupBehaviorID: 2466,
    launchBayPayloadState: { sourceShipID: sourceShip.itemID },
    expiresAtMs: nowMs + 86_400_000,
    position: { x: 0, y: 0, z: 0 },
    radius: 1,
    lockedTargets: new Map(),
  };
  const attacker: any = {
    itemID: 9_612,
    typeID: 600,
    groupID: 25,
    ownerID: 140_000_002,
    characterID: 140_000_002,
    kind: "ship",
    position: { x: 10_000, y: 0, z: 0 },
    radius: 30,
  };
  const entities = new Map<number, any>([
    [sourceShip.itemID, sourceShip],
    [sentry.itemID, sentry],
    [attacker.itemID, attacker],
  ]);
  let shotSnapshots: any[] = [];
  let damageCalls = 0;
  let fxCalls = 0;
  const scene = {
    dynamicEntities: entities,
    getEntityByID: (id: number) => entities.get(id),
    clearOutgoingTargetLocks(entity: any) {
      entity.lockedTargets.clear();
    },
    allocateTargetSequence: () => 1,
    finalizeTargetLock(entity: any, selected: any) {
      entity.lockedTargets.set(selected.itemID, { targetID: selected.itemID });
      return { success: true };
    },
    broadcastSpecialFx() {
      fxCalls += 1;
    },
  };
  const interop = {
    hasDamageableHealth: () => true,
    getEntityMaxHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    getEntityCurrentHealthLayers: () => ({ shield: 100, armor: 100, structure: 100 }),
    resolveTurretShot(input: any) {
      shotSnapshots.push(input.weaponSnapshot);
      return {
        hit: true,
        quality: 1,
        shotDamage: input.weaponSnapshot.rawShotDamage,
      };
    },
    applyWeaponDamageToTarget() {
      damageCalls += 1;
      return { damageResult: { success: true, data: {} }, destroyResult: null };
    },
    getAppliedDamageAmount: () => 162,
    noteKillmailDamage() {},
    recordKillmailFromDestruction() {},
    notifyWeaponDamageMessages() {},
    getCombatMessageHitQuality: () => 1,
  };
  const component = {
    behavior: {
      behaviorName: "2465",
      groupBehaviorID: 2466,
    },
  };
  const profile = smartTurretRuntime._testing.getWeaponProfile(sentry, component);
  assert.ok(profile);

  smartTurretRuntime.noteIncomingAggression(attacker, sourceShip, nowMs);
  smartTurretRuntime._testing.tickFieldSentry(scene, sentry, nowMs, {
    component,
    interop,
    profile,
  });
  assert.equal(damageCalls, 0, "the sentry first acquires an authored target lock");
  smartTurretRuntime._testing.tickFieldSentry(scene, sentry, nowMs + 3_000, {
    component,
    interop,
    profile,
  });

  assert.equal(shotSnapshots.length, 1);
  assert.equal(shotSnapshots[0], profile.snapshot, "shared hit resolution receives dogma snapshot");
  assert.equal(damageCalls, 1, "shared obstruction/damage authority applies the hit");
  assert.equal(fxCalls, 1, "shared weapon presentation broadcasts the authored projectile effect");
  assert.equal(sentry.lockedTargets.has(attacker.itemID), true);
  smartTurretRuntime._testing.clearCaches();
});
