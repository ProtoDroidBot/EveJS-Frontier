"use strict";

const path = require("path");
const { ServiceTaskPool } = require(path.join(
  __dirname,
  "../../utils/serviceTaskPool",
));

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

const pool = new ServiceTaskPool({
  poolSize: positiveInteger(process.env.EVEJS_PLANET_SIMULATION_THREADS, 1),
  taskTimeoutMs: positiveInteger(
    process.env.EVEJS_PLANET_SIMULATION_TIMEOUT_MS,
    30_000,
  ),
  maxPendingTasks: positiveInteger(
    process.env.EVEJS_PLANET_SIMULATION_MAX_PENDING,
    128,
  ),
});
const TASK_PATH = path.join(__dirname, "planetSimulationTask.js");
const MAX_PENDING = positiveInteger(
  process.env.EVEJS_PLANET_SIMULATION_MAX_PENDING,
  128,
);
let pending = 0;

function buildColonySimulationPlan(rawColony, targetFileTime, context, baseFingerprint) {
  if (pending >= MAX_PENDING) {
    const error: Error & Record<string, any> = new Error(
      `Planet simulation queue is full (${MAX_PENDING})`,
    );
    error.code = "PLANET_SIMULATION_QUEUE_FULL";
    return Promise.reject(error);
  }
  pending += 1;
  return pool.run({
    modulePath: TASK_PATH,
    exportName: "buildColonySimulationPlan",
    args: [rawColony, targetFileTime, context, baseFingerprint],
  }).finally(() => {
    pending -= 1;
  });
}

module.exports = {
  buildColonySimulationPlan,
  getPendingTaskCount: () => pending,
  MAX_PENDING,
  close: () => pool.close(),
};
