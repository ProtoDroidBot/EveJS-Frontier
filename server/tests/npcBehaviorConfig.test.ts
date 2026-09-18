"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const npcBehaviorConfig = require("../src/config/npcBehaviorConfig");
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
    },
    lootTable: null,
  };
}

test("NPC behavior config loads guard, passive, mining, and hauling roles", () => {
  const config = npcBehaviorConfig.getConfig();
  const summary = npcBehaviorConfig.getConfigSummary();

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.enabled, true);
  assert.equal(summary.defaultRole, "guard");
  assert.deepEqual(Object.keys(config.roles).sort(), [
    "guard",
    "hauler",
    "miner",
    "passive",
  ]);
  assert.equal(summary.ruleCount, 4);
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
  assert.equal(haulerPolicy.role, "hauler");
  assert.equal(haulerPolicy.activity, "hauling");
  assert.equal(haulerPolicy.activityOptions.autoEnroll, true);
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
