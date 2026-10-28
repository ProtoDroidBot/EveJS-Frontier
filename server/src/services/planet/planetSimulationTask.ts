"use strict";

const path = require("path");
const planetRuntimeStore = require(path.join(__dirname, "./planetRuntimeStore"));

function buildColonySimulationPlan(rawColony, targetFileTime, context, baseFingerprint) {
  return planetRuntimeStore.buildColonySimulationPlan(
    rawColony,
    targetFileTime,
    context,
    baseFingerprint,
  );
}

module.exports = { buildColonySimulationPlan };
