"use strict";

const WORLD_REVISION = "3502403-MOD4-STUFF1/3640684-voxel-v1";

function getVoxelMiningWorldRevision(config = require("../../config")) {
  const base = config.voxelMiningWorldRevision || WORLD_REVISION;
  if (Number(config.clientBuild) !== 3640684) return base;
  const profile = require("../frontier/temporaryLandscapeProfile").getTemporaryLandscapeProfile();
  if (process.env.EVEJS_EXPLORATION_WORLD_PATH) {
    const world = require("../frontier/explorationWorld").getConfiguredExplorationWorld();
    if (world.canonicalSource === true) {
      const { TEMPORARY_LANDSCAPE_POLICY_REVISION } = require("../frontier/temporaryLandscapePolicyVersion");
      // The runtime client stays3640684 while immutable geographic identity
      // changes. Never inherit the legacy config default into a new world.
      return `frontier-3640684/canonical-world/${world.baseRevision}/content/${profile?.revision || "none"}/policy/${TEMPORARY_LANDSCAPE_POLICY_REVISION}`;
    }
  }
  // Keep depletion/fragment receipts separate when temporary authored content
  // replaces a catalog, without deleting the prior world's durable state.
  if (!profile) return base;
  const { TEMPORARY_LANDSCAPE_POLICY_REVISION } = require("../frontier/temporaryLandscapePolicyVersion");
  return `${base}/temporary-landscape/${profile.revision}/policy/${TEMPORARY_LANDSCAPE_POLICY_REVISION}`;
}

module.exports = { WORLD_REVISION, getVoxelMiningWorldRevision };
