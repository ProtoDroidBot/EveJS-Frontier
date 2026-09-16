"use strict";

const { isMainThread, threadId } = require("worker_threads");

function spinFor(milliseconds) {
  const durationMs = Math.max(0, Number(milliseconds) || 0);
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    // Intentionally CPU-bound: this fixture verifies the main loop stays free.
  }
  return {
    isMainThread,
    threadId,
    elapsedMs: Date.now() - startedAt,
  };
}

module.exports = {
  spinFor,
};
