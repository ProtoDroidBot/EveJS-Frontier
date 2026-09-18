/** Worker-thread calculations for DungeonUniverse. */

"use strict";

const path = require("path");

let runtime = null;

function getDungeonUniverseRuntime() {
  if (!runtime) {
    // Worker planning reads only the tables its calculation touches. A full
    // preload here duplicated the server's entire 157-table cache and caused a
    // second startup-like preload in the same process session.
    runtime = require(path.join(__dirname, "./dungeonUniverseRuntime"));
  }
  return runtime;
}

function buildRandomAllocatedSystemPlanForFamily(family, options: Record<string, any> = {}) {
  const runtime = getDungeonUniverseRuntime();
  return runtime._testing.buildRandomAllocatedSystemPlanForFamily(family, options);
}

function buildUniverseSeededReconcilePlan(definitions, snapshot, options) {
  const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
  return dungeonRuntime.buildUniverseSeededReconcilePlan(
    definitions,
    snapshot,
    options,
  );
}

module.exports = {
  buildRandomAllocatedSystemPlanForFamily,
  buildUniverseSeededReconcilePlan,
};
