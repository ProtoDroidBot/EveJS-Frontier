"use strict";

const fs = require("fs");
const path = require("path");

const queues = new Map();

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function enqueueAppendFile(filePath, data, options: Record<string, any> = {}) {
  const resolvedPath = path.resolve(filePath);
  const maxPending = positiveInteger(options.maxPending, 2048);
  let state = queues.get(resolvedPath);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0 };
    queues.set(resolvedPath, state);
  }
  if (state.pending >= maxPending) {
    const error: Error & Record<string, any> = new Error(
      `Async file queue is full (${maxPending})`,
    );
    error.code = "ASYNC_FILE_QUEUE_FULL";
    return Promise.reject(error);
  }

  state.pending += 1;
  const write = state.tail.then(async () => {
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.appendFile(resolvedPath, data, options.encoding || "utf8");
  });
  state.tail = write.catch(() => {}).finally(() => {
    state.pending = Math.max(0, state.pending - 1);
    if (state.pending === 0 && queues.get(resolvedPath) === state) {
      queues.delete(resolvedPath);
    }
  });
  return write;
}

async function flushAsyncFileQueue(filePath = null) {
  if (filePath) {
    const state = queues.get(path.resolve(filePath));
    if (state) await state.tail;
    return;
  }
  await Promise.all([...queues.values()].map((state) => state.tail));
}

module.exports = {
  enqueueAppendFile,
  flushAsyncFileQueue,
};
