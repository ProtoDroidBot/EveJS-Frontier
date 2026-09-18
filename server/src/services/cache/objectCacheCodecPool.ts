"use strict";

const path = require("path");
const { ServiceTaskPool } = require(path.join(__dirname, "../../utils/serviceTaskPool"));

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

const pool = new ServiceTaskPool({
  poolSize: positiveInteger(process.env.EVEJS_OBJECT_CACHE_THREADS, 2),
  taskTimeoutMs: positiveInteger(process.env.EVEJS_OBJECT_CACHE_TIMEOUT_MS, 15_000),
  maxPendingTasks: positiveInteger(process.env.EVEJS_OBJECT_CACHE_MAX_PENDING, 128),
});
const TASK_PATH = path.join(__dirname, "objectCacheCodecTask.js");
const MAX_PENDING = positiveInteger(process.env.EVEJS_OBJECT_CACHE_MAX_PENDING, 128);
let pending = 0;

function encodeCachedMethodResult(result, options: Record<string, any> = {}) {
  if (pending >= MAX_PENDING) {
    const error: Error & Record<string, any> = new Error(`Object-cache codec queue is full (${MAX_PENDING})`);
    error.code = "OBJECT_CACHE_CODEC_QUEUE_FULL";
    return Promise.reject(error);
  }
  pending += 1;
  return pool.run({
    modulePath: TASK_PATH,
    exportName: "encodeCachedMethodResult",
    args: [result, options],
  }).then((encoded) => {
    if (encoded?.pickle instanceof Uint8Array && !Buffer.isBuffer(encoded.pickle)) {
      encoded.pickle = Buffer.from(encoded.pickle);
    }
    return encoded;
  }).finally(() => { pending -= 1; });
}

module.exports = {
  encodeCachedMethodResult,
  getPendingTaskCount: () => pending,
  close: () => pool.close(),
};
