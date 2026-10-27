"use strict";

const { createHash } = require("node:crypto");

// Bump when allocation inputs or lifecycle semantics change. This is separate
// from the unchanged decoded-content fingerprint, so old receipts stay intact.
const TEMPORARY_LANDSCAPE_POLICY_VERSION = 1;
const TEMPORARY_LANDSCAPE_POLICY_REVISION = createHash("sha256")
  .update("evejs:3640684:temporary-landscape:allocation-policy:1")
  .digest("hex");

module.exports = { TEMPORARY_LANDSCAPE_POLICY_VERSION, TEMPORARY_LANDSCAPE_POLICY_REVISION };
