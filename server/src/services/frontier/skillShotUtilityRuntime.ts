"use strict";

/**
 * Frontier held-beam consequence routing.
 *
 * Build 3502403 presents Cutting Laser, Crude Extractor, and Needle through
 * the same lock-free SkillShot RPC.  Their first swept collision remains the
 * authority boundary, but a compatible mineable collision must enter the
 * mining ledger/inventory path rather than the combat damage path.
 */

const path = require("path");

const TYPE_CUTTING_LASER = 95317;
const TYPE_PHYSICS_GUN = 99999;
const TYPE_CRUDE_EXTRACTOR = 95503;
const TYPE_NEEDLE = 95778;

const HELD_BEAM_UTILITY_PROFILES = new Map<number, Record<string, any>>([
  [TYPE_CUTTING_LASER, {
    kind: "multipurpose",
    allowsCombatDamage: true,
  }],
  [TYPE_PHYSICS_GUN, {
    kind: "multipurpose",
    allowsCombatDamage: true,
  }],
  [TYPE_CRUDE_EXTRACTOR, {
    kind: "crude_extraction",
    allowsCombatDamage: false,
  }],
  [TYPE_NEEDLE, {
    kind: "multipurpose",
    allowsCombatDamage: true,
  }],
]);

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getHeldBeamUtilityProfile(moduleTypeID) {
  const profile = HELD_BEAM_UTILITY_PROFILES.get(
    toPositiveInt(moduleTypeID, 0),
  );
  return profile ? { ...profile } : null;
}

function applySkillShotUtilityHit({
  scene,
  sourceEntity,
  targetEntity,
  moduleItem,
  chargeItem,
  nowMs = Date.now(),
  rampMultiplier = 1,
  miningRuntime = null,
}: Record<string, any> = {}) {
  const profile = getHeldBeamUtilityProfile(moduleItem && moduleItem.typeID);
  if (!profile || !targetEntity) {
    return {
      matched: false,
      blockCombatDamage: false,
    };
  }

  const authoritativeMiningRuntime = miningRuntime || require(path.join(
    __dirname,
    "../mining/miningRuntime",
  ));
  const miningResult =
    authoritativeMiningRuntime &&
    typeof authoritativeMiningRuntime.executeSkillShotMiningCycle === "function"
      ? authoritativeMiningRuntime.executeSkillShotMiningCycle(
          scene,
          sourceEntity,
          targetEntity,
          moduleItem,
          chargeItem,
          nowMs,
          {
            rampMultiplier: Math.max(0, toFiniteNumber(rampMultiplier, 1)),
          },
        )
      : { matched: false };

  if (miningResult && miningResult.matched === true) {
    return {
      ...miningResult,
      utilityKind: profile.kind,
      // A resource collision is terminal even when extraction cannot award a
      // cycle (full cargo, depleted resource, or incompatible lens). It must
      // never fall through into hull damage.
      blockCombatDamage: true,
    };
  }

  return {
    matched: false,
    success: false,
    utilityKind: profile.kind,
    // Crude Extractor has no authored combat role or charge damage. Physical
    // obstructions still terminate its trace and receive FX, but no damage.
    blockCombatDamage: profile.allowsCombatDamage !== true,
  };
}

module.exports = {
  TYPE_CUTTING_LASER,
  TYPE_PHYSICS_GUN,
  TYPE_CRUDE_EXTRACTOR,
  TYPE_NEEDLE,
  HELD_BEAM_UTILITY_PROFILES,
  getHeldBeamUtilityProfile,
  applySkillShotUtilityHit,
};
