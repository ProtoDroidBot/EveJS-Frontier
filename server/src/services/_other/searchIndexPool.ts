"use strict";

const path = require("path");
const { ServiceTaskPool } = require(path.join(__dirname, "../../utils/serviceTaskPool"));

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

const pool = new ServiceTaskPool({
  poolSize: 1,
  taskTimeoutMs: positiveInteger(process.env.EVEJS_SEARCH_INDEX_TIMEOUT_MS, 15_000),
  maxPendingTasks: positiveInteger(process.env.EVEJS_SEARCH_INDEX_MAX_PENDING, 128),
});
const TASK_PATH = path.join(__dirname, "searchIndexTask.js");
const MAX_PENDING = positiveInteger(process.env.EVEJS_SEARCH_INDEX_MAX_PENDING, 128);
let pending = 0;

function run(exportName, args) {
  if (pending >= MAX_PENDING) {
    const error: Error & Record<string, any> = new Error(`Search index queue is full (${MAX_PENDING})`);
    error.code = "SEARCH_INDEX_QUEUE_FULL";
    return Promise.reject(error);
  }
  pending += 1;
  return pool.run({ modulePath: TASK_PATH, exportName, args }).finally(() => { pending -= 1; });
}

module.exports = {
  searchStaticGroup: (groupID, search, exactMode, maxResults) =>
    run("searchStaticGroup", [groupID, search, exactMode, maxResults]),
  searchEntries: (entries, search, exactMode, maxResults) =>
    run("searchEntries", [entries, search, exactMode, maxResults]),
  clear: () => run("clearIndexes", []),
  getWorkerStats: () => run("getStats", []),
  getPendingTaskCount: () => pending,
  close: () => pool.close(),
};
