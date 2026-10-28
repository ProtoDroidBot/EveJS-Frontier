"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const npcBehaviorConfig = require("../src/config/npcBehaviorConfig");
const npcBehaviorLoop = require("../src/space/npc/npcBehaviorLoop");
const npcRegistry = require("../src/space/npc/npcRegistry");
const miningNpcOperations = require("../src/services/mining/miningNpcOperations");
const authoredProfiles = require("../../tools/DatabaseCreator/staticTables/npcProfiles/data.json").profiles;
const authoredBehaviorProfiles = require("../../tools/DatabaseCreator/staticTables/npcBehaviorProfiles/data.json").behaviorProfiles;
const authoredLoadouts = require("../../tools/DatabaseCreator/staticTables/npcLoadouts/data.json").loadouts;

function buildDefinition(options: Record<string, any> = {}) {
  return {
    profile: {
      profileID: options.profileID || "test_guard",
      entityType: options.entityType || "npc",
    },
    loadout: {
      loadoutID: options.loadoutID || "test_loadout",
    },
    behaviorProfile: {
      behaviorProfileID: options.behaviorProfileID || "test_behavior",
      name: "Test Behavior",
      autoAggro: options.autoAggro !== false,
      aggressionRangeMeters: options.aggressionRangeMeters || 42_000,
      ...(options.behaviorFields || {}),
    },
    lootTable: null,
  };
}

test("NPC behavior config loads guard, passive, mining, and hauling roles", () => {
  const config = npcBehaviorConfig.getConfig();
  const summary = npcBehaviorConfig.getConfigSummary();

  assert.equal(config.schemaVersion, 2);
  assert.equal(config.enabled, true);
  assert.equal(summary.defaultRole, "guard");
  assert.deepEqual(Object.keys(config.roles).sort(), [
    "guard",
    "hauler",
    "miner",
    "passive",
  ]);
  assert.equal(summary.ruleCount, 5);
});

test("every NPC role inherits the global passive movement and warp profile", () => {
  const definitions = [
    buildDefinition({ profileID: "generic_hostile" }),
    buildDefinition({
      profileID: "parity_rogue_drone_courier",
      behaviorProfileID: "retail_rogue_drone_courier",
      autoAggro: false,
    }),
    buildDefinition({
      profileID: "ore_mining_venture",
      loadoutID: "ore_mining_venture_dual_miner",
      behaviorProfileID: "npc_passive_idle",
      autoAggro: false,
    }),
    buildDefinition({
      profileID: "ore_mining_badger_hauler",
      loadoutID: "ore_mining_badger_hauler",
      behaviorProfileID: "npc_passive_idle",
      autoAggro: false,
    }),
  ];
  const policies = definitions.map((definition) => (
    npcBehaviorConfig.resolveNpcBehaviorPolicy(definition)
  ));

  assert.deepEqual(policies.map((policy) => policy.role), [
    "guard",
    "passive",
    "miner",
    "hauler",
  ]);
  for (const policy of policies) {
    assert.equal(policy.matchedRuleIDs.includes("all-profiled-npc-roamers"), true);
    assert.equal(policy.behaviorProfile.passiveRoaming, true);
    assert.equal(policy.behaviorProfile.passiveWarping, true);
    assert.equal(policy.behaviorProfile.passiveWarpMinDistanceMeters, 175_000);
    assert.equal(policy.behaviorProfile.passiveWarpMaxDistanceMeters, 650_000);
  }
});

test("passive roaming destinations stay inside configured movement and warp bands", () => {
  const profile = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    profileID: "parity_rogue_drone_hauler",
    behaviorProfileID: "retail_rogue_drone_hauler",
    autoAggro: false,
  })).behaviorProfile;
  const roamingPolicy = npcBehaviorLoop.__testing.resolvePassiveRoamPolicy(profile);
  const entity = {
    itemID: 91_100_001,
    position: { x: 0, y: 0, z: 0 },
  };
  const controller = {
    homePosition: { x: 0, y: 0, z: 0 },
  };
  const localPoint = npcBehaviorLoop.__testing.buildPassiveRoamDestination(
    entity,
    controller,
    roamingPolicy,
    "move",
    1,
  );
  const warpPoint = npcBehaviorLoop.__testing.buildPassiveRoamDestination(
    entity,
    controller,
    roamingPolicy,
    "warp",
    2,
  );
  const vectorDistance = (point) => Math.sqrt(
    (point.x ** 2) + (point.y ** 2) + (point.z ** 2),
  );

  assert.equal(roamingPolicy.enabled, true);
  assert.equal(roamingPolicy.warpingEnabled, true);
  assert.ok(vectorDistance(localPoint) >= roamingPolicy.moveMinDistanceMeters);
  assert.ok(vectorDistance(localPoint) <= roamingPolicy.moveMaxDistanceMeters + 1);
  assert.ok(vectorDistance(warpPoint) >= roamingPolicy.warpMinDistanceMeters);
  assert.ok(vectorDistance(warpPoint) <= roamingPolicy.warpMaxDistanceMeters + 1);
  assert.ok(vectorDistance(warpPoint) <= roamingPolicy.roamRadiusMeters + 1);
});

test("profile-wide roaming starts a local movement command before its first warp interval", () => {
  const behaviorProfile = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    profileID: "generic_hostile",
  })).behaviorProfile;
  const entity = {
    itemID: 91_100_002,
    systemID: 30_000_142,
    kind: "ship",
    mode: "STOP",
    speedFraction: 0,
    position: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
  };
  const controller: Record<string, any> = {
    homePosition: { x: 0, y: 0, z: 0 },
    homeDirection: { x: 1, y: 0, z: 0 },
  };
  const gotoCalls: any[] = [];
  const scene = {
    gotoDirection(_session, direction, options) {
      gotoCalls.push({ direction, options });
      return true;
    },
    stop() {
      throw new Error("new passive roamers should move before waiting");
    },
  };
  const nowMs = 1_000_000;

  const result = npcBehaviorLoop.__testing.syncPassiveNpcRoaming(
    scene,
    entity,
    controller,
    behaviorProfile,
    nowMs,
  );

  assert.equal(result.handled, true);
  assert.equal(gotoCalls.length, 1);
  assert.ok(controller.passiveRoamState.waypoint);
  assert.equal(controller.passiveRoamState.lastWarpAtMs, nowMs);
  assert.equal(controller.passiveRoamState.lastWarpAttemptAtMs, nowMs);
  assert.equal(
    gotoCalls[0].options.suppressFreshAcquireReplay,
    true,
  );
});

test("profile-wide roaming also activates ambient native NPC controllers", () => {
  assert.equal(
    npcBehaviorLoop.__testing.shouldSkipNpcBehaviorController({
      runtimeKind: "nativeAmbient",
      behaviorProfile: {
        passiveRoaming: true,
      },
    }),
    false,
  );
  assert.equal(
    npcBehaviorLoop.__testing.shouldSkipNpcBehaviorController({
      runtimeKind: "nativeAmbient",
      behaviorProfile: {
        passiveRoaming: false,
      },
    }),
    true,
  );
});

test("authored combat behavior wins over guard defaults", () => {
  const policy = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    aggressionRangeMeters: 42_000,
  }));

  assert.equal(policy.role, "guard");
  assert.equal(policy.activity, "guard");
  assert.equal(policy.behaviorProfile.aggressionRangeMeters, 42_000);
  assert.equal(policy.behaviorProfile.autoAggro, true);
  assert.equal(policy.behaviorProfile.autoActivateWeapons, true);
  assert.equal(policy.behaviorProfile.chaseTargets, true);
  assert.equal(policy.behaviorProfile.guardAnchor, true);
  assert.equal(policy.behaviorProfile.mineAsteroids, false);
  assert.equal(policy.behaviorProfile.retainTargetLockWhenOccluded, false);
  assert.equal(policy.behaviorProfile.fireThroughOccluders, false);
});

test("authored behavior profiles can override independent NPC capabilities", () => {
  const policy = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    behaviorFields: {
      chaseTargets: false,
      mineAsteroids: true,
      guardAnchor: false,
      retainTargetLockWhenOccluded: true,
      fireThroughOccluders: true,
    },
  }));

  assert.equal(policy.behaviorProfile.chaseTargets, false);
  assert.equal(policy.behaviorProfile.mineAsteroids, true);
  assert.equal(policy.behaviorProfile.guardAnchor, false);
  assert.equal(policy.behaviorProfile.retainTargetLockWhenOccluded, true);
  assert.equal(policy.behaviorProfile.fireThroughOccluders, true);
});

test("autonomous chase and anchor guarding obey behavior profile switches", () => {
  assert.equal(
    npcBehaviorLoop.__testing.resolveMovementDirective(null, {
      movementMode: "follow",
      chaseTargets: false,
    }).movementMode,
    "hold",
  );
  assert.equal(
    npcBehaviorLoop.__testing.resolveNpcChaseVelocityPolicy({
      chaseTargets: false,
      useSdeChaseVelocity: true,
      cruiseSpeedMetersPerSecond: 100,
      chaseMaxVelocityMetersPerSecond: 500,
      chaseMaxDistanceMeters: 10_000,
    }).enabled,
    false,
  );
  assert.equal(
    npcBehaviorLoop.__testing.resolveMovementDirective({
      type: "follow",
      movementMode: null,
      followRangeMeters: 1_000,
      orbitDistanceMeters: 0,
    }, {
      movementMode: "orbit",
      chaseTargets: false,
    }).movementMode,
    "follow",
    "manual movement orders still override autonomous chase policy",
  );
  assert.equal(
    npcBehaviorLoop.__testing.isBeyondLeash(
      { position: { x: 10_000, y: 0, z: 0 } },
      { homePosition: { x: 0, y: 0, z: 0 } },
      { guardAnchor: false, leashRangeMeters: 5_000 },
    ),
    false,
  );
  assert.equal(
    npcBehaviorLoop.__testing.isBeyondLeash(
      { position: { x: 10_000, y: 0, z: 0 } },
      { homePosition: { x: 0, y: 0, z: 0 } },
      { guardAnchor: true, leashRangeMeters: 5_000 },
    ),
    true,
  );
});

test("configured ORE miners and haulers resolve specialized activities", () => {
  const minerPolicy = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    profileID: "ore_mining_venture",
    loadoutID: "ore_mining_venture_dual_miner",
    behaviorProfileID: "npc_passive_idle",
    autoAggro: false,
  }));
  const haulerPolicy = npcBehaviorConfig.resolveNpcBehaviorPolicy(buildDefinition({
    profileID: "ore_mining_badger_hauler",
    loadoutID: "ore_mining_badger_hauler",
    behaviorProfileID: "npc_passive_idle",
    autoAggro: false,
  }));

  assert.equal(minerPolicy.role, "miner");
  assert.equal(minerPolicy.activity, "mining");
  assert.equal(minerPolicy.activityOptions.autoEnroll, true);
  assert.equal(minerPolicy.behaviorProfile.autoAggro, false);
  assert.equal(minerPolicy.behaviorProfile.autoActivateWeapons, false);
  assert.deepEqual(minerPolicy.behaviorProfile.autoAggroTargetClasses, []);
  assert.equal(minerPolicy.behaviorProfile.mineAsteroids, true);
  assert.equal(minerPolicy.behaviorProfile.chaseTargets, false);
  assert.equal(minerPolicy.behaviorProfile.guardAnchor, false);
  assert.equal(haulerPolicy.role, "hauler");
  assert.equal(haulerPolicy.activity, "hauling");
  assert.equal(haulerPolicy.activityOptions.autoEnroll, true);
});

test("generic profiles can opt into asteroid mining without a miner role", () => {
  npcRegistry.clearControllers();
  miningNpcOperations._testing.clearState();
  npcRegistry.registerController({
    entityID: 91_000_002,
    systemID: 30_000_142,
    profileID: "custom_industrial_npc",
    behaviorActivity: "guard",
    behaviorPolicy: {
      activity: "guard",
      activityOptions: {},
    },
    behaviorProfile: {
      mineAsteroids: true,
    },
    homePosition: { x: 1, y: 2, z: 3 },
    homeDirection: { x: 1, y: 0, z: 0 },
  });
  const scene = {
    systemID: 30_000_142,
    getEntityByID(entityID) {
      return entityID === 91_000_002
        ? {
            itemID: entityID,
            position: { x: 1, y: 2, z: 3 },
            direction: { x: 1, y: 0, z: 0 },
          }
        : null;
    },
  };

  const enrolled = miningNpcOperations._testing.autoEnrollConfiguredMiningNpcs(scene);
  assert.equal(enrolled.length, 1);
  assert.deepEqual(
    miningNpcOperations.getMiningFleetsForSystem(scene.systemID)[0].minerEntityIDs,
    [91_000_002],
  );

  miningNpcOperations._testing.clearState();
  npcRegistry.clearControllers();
});

test("every authored spawnable NPC profile resolves a configured role", () => {
  const behaviorProfiles = new Map(
    authoredBehaviorProfiles.map((behaviorProfile) => [
      behaviorProfile.behaviorProfileID,
      behaviorProfile,
    ]),
  );
  const loadouts = new Map(
    authoredLoadouts.map((loadout) => [loadout.loadoutID, loadout]),
  );
  const coveredProfileIDs: string[] = [];

  for (const profile of authoredProfiles) {
    const behaviorProfile = behaviorProfiles.get(profile.behaviorProfileID);
    const loadout = loadouts.get(profile.loadoutID);
    if (!behaviorProfile || !loadout) {
      continue;
    }
    const policy = npcBehaviorConfig.resolveNpcBehaviorPolicy({
      profile,
      loadout,
      behaviorProfile,
    });
    assert.ok(policy.role, `profile ${profile.profileID} has no behavior role`);
    assert.ok(policy.activity, `profile ${profile.profileID} has no behavior activity`);
    assert.equal(
      policy.matchedRuleIDs.includes("all-profiled-npc-roamers"),
      true,
      `profile ${profile.profileID} did not inherit profile-wide roaming`,
    );
    assert.equal(
      policy.behaviorProfile.passiveRoaming,
      true,
      `profile ${profile.profileID} cannot move passively`,
    );
    assert.equal(
      policy.behaviorProfile.passiveWarping,
      true,
      `profile ${profile.profileID} cannot warp passively`,
    );
    coveredProfileIDs.push(profile.profileID);
  }

  assert.ok(coveredProfileIDs.length > 5_000);
  assert.equal(coveredProfileIDs.includes("ore_mining_venture"), true);
  assert.equal(coveredProfileIDs.includes("generic_hostile"), true);
});

test("generic spawn-path miners auto-enroll once in the mining controller", () => {
  npcRegistry.clearControllers();
  miningNpcOperations._testing.clearState();
  npcRegistry.registerController({
    entityID: 91_000_001,
    systemID: 30_000_142,
    profileID: "ore_mining_venture",
    selectionID: "ore_mining_venture",
    selectionName: "ORE Mining Venture",
    behaviorActivity: "mining",
    behaviorPolicy: {
      activity: "mining",
      activityOptions: {
        autoEnroll: true,
      },
    },
    behaviorProfile: {
      autoAggro: false,
      autoActivateWeapons: false,
    },
    homePosition: { x: 1, y: 2, z: 3 },
    homeDirection: { x: 1, y: 0, z: 0 },
  });
  const scene = {
    systemID: 30_000_142,
    getEntityByID(entityID) {
      return entityID === 91_000_001
        ? {
            itemID: entityID,
            position: { x: 1, y: 2, z: 3 },
            direction: { x: 1, y: 0, z: 0 },
          }
        : null;
    },
  };

  const firstPass = miningNpcOperations._testing.autoEnrollConfiguredMiningNpcs(scene);
  const secondPass = miningNpcOperations._testing.autoEnrollConfiguredMiningNpcs(scene);
  const fleets = miningNpcOperations.getMiningFleetsForSystem(scene.systemID);

  assert.equal(firstPass.length, 1);
  assert.equal(secondPass.length, 0);
  assert.equal(fleets.length, 1);
  assert.deepEqual(fleets[0].minerEntityIDs, [91_000_001]);
  assert.equal(fleets[0].source, "npc-behavior-config");

  miningNpcOperations._testing.clearState();
  npcRegistry.clearControllers();
});

test("authored and generated definitions carry an idempotent behavior policy", () => {
  const miner = npcBehaviorConfig.applyNpcBehaviorConfig(buildDefinition({
    profileID: "ore_mining_venture",
    loadoutID: "ore_mining_venture_dual_miner",
    behaviorProfileID: "npc_passive_idle",
    autoAggro: false,
  }));
  const guard = npcBehaviorConfig.applyNpcBehaviorConfig(buildDefinition({
    profileID: "generated_future_guard",
  }));

  assert.equal(miner.behaviorPolicy.role, "miner");
  assert.equal(miner.behaviorPolicy.activity, "mining");
  assert.equal(guard.behaviorPolicy.role, "guard");
  assert.equal(guard.behaviorPolicy.activity, "guard");
  assert.equal(npcBehaviorConfig.applyNpcBehaviorConfig(guard), guard);
});
