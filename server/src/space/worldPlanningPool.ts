/** Dedicated, bounded pool for immutable world/scene planning snapshots. */

"use strict";

const path = require("path");
const { ServiceTaskPool } = require(path.join(__dirname, "../utils/serviceTaskPool"));

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

const MAX_PENDING = positiveInteger(process.env.EVEJS_WORLD_PLANNING_MAX_PENDING, 128);
const pool = new ServiceTaskPool({
  poolSize: positiveInteger(process.env.EVEJS_WORLD_PLANNING_THREADS, 2),
  taskTimeoutMs: positiveInteger(process.env.EVEJS_WORLD_PLANNING_TIMEOUT_MS, 30_000),
  maxPendingTasks: MAX_PENDING,
});
const SCENE_BOOTSTRAP_TASK = path.join(__dirname, "sceneBootstrapPlanningTask.js");
const DUNGEON_UNIVERSE_TASK = path.join(
  __dirname,
  "../services/dungeon/dungeonUniversePlanningTask.js",
);
let pending = 0;

function run(modulePath, exportName, args, options: Record<string, any> = {}) {
  if (pending >= MAX_PENDING) {
    const error: Error & Record<string, any> = new Error(
      `World planning queue is full (${MAX_PENDING})`,
    );
    error.code = "WORLD_PLANNING_QUEUE_FULL";
    return Promise.reject(error);
  }
  pending += 1;
  return pool.run({ modulePath, exportName, args }, options).finally(() => { pending -= 1; });
}

module.exports = {
  buildSceneBootstrapPlan: (input, options = {}) =>
    run(SCENE_BOOTSTRAP_TASK, "buildSceneBootstrapPlan", [input], options),
  buildRandomAllocatedSystemPlanForFamily: (family, options, taskOptions = {}) =>
    run(
      DUNGEON_UNIVERSE_TASK,
      "buildRandomAllocatedSystemPlanForFamily",
      [family, options],
      taskOptions,
    ),
  buildUniverseSeededReconcilePlan: (definitions, snapshot, options, taskOptions = {}) =>
    run(
      DUNGEON_UNIVERSE_TASK,
      "buildUniverseSeededReconcilePlan",
      [definitions, snapshot, options],
      taskOptions,
    ),
  getPendingTaskCount: () => pending,
  getStats: () => ({ ...pool.getStats(), pending }),
  close: () => pool.close(),
};
