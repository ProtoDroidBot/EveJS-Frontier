/** Worker-thread calculations for DungeonUniverse. */

"use strict";

const path = require("path");

let initialized = false;

function getDungeonUniverseRuntime() {
  if (!initialized) {
    const database = require(path.join(__dirname, "../../gameStore"));
    database.preloadAll();
    initialized = true;
  }
  return require(path.join(__dirname, "./dungeonUniverseRuntime"));
}

function buildRandomAllocatedSystemPlanForFamily(family, options: Record<string, any> = {}) {
  const runtime = getDungeonUniverseRuntime();
  return runtime._testing.buildRandomAllocatedSystemPlanForFamily(family, options);
}

module.exports = {
  buildRandomAllocatedSystemPlanForFamily,
};
