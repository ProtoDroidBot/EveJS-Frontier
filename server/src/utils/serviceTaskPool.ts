/**
 * Small worker-thread pool for CPU-heavy service planning.
 *
 * Live services are deliberately not cloned into workers: their in-memory
 * stores, sessions, and sockets are authoritative in this process. Instead,
 * services offload pure planning/calculation here and apply the result on the
 * main thread in bounded commits.
 */

"use strict";

const path = require("path");
const { Worker } = require("worker_threads");

const DEFAULT_TASK_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PENDING_TASKS = 256;
const DEFAULT_POOL_SIZE = 2;
const WORKER_PATH = path.join(__dirname, "serviceTaskPool.worker.js");

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function deserializeWorkerError(payload) {
  const error: Error & Record<string, any> = new Error(
    String(payload && payload.message || "service worker task failed"),
  );
  error.name = String(payload && payload.name || "Error");
  if (payload && payload.stack) {
    error.stack = String(payload.stack);
  }
  if (payload && payload.code !== null && payload.code !== undefined) {
    error.code = payload.code;
  }
  return error;
}

class ServiceTaskPool {
  declare _closed: boolean;
  declare _createWorker: any;
  declare _idleWorkers: any[];
  declare _nextTaskID: number;
  declare _maxPendingTasks: number;
  declare _pending: Map<number, any>;
  declare _poolSize: number;
  declare _queue: any[];
  declare _taskTimeoutMs: number;
  declare _workerPath: string;
  declare _workers: Set<any>;

  constructor(options: Record<string, any> = {}) {
    this._poolSize = normalizePositiveInteger(options.poolSize, DEFAULT_POOL_SIZE);
    this._taskTimeoutMs = normalizePositiveInteger(
      options.taskTimeoutMs,
      DEFAULT_TASK_TIMEOUT_MS,
    );
    this._maxPendingTasks = normalizePositiveInteger(
      options.maxPendingTasks,
      DEFAULT_MAX_PENDING_TASKS,
    );
    this._workerPath = options.workerPath || WORKER_PATH;
    this._createWorker = typeof options.createWorker === "function"
      ? options.createWorker
      : (workerPath) => new Worker(workerPath);
    this._workers = new Set();
    this._idleWorkers = [];
    this._queue = [];
    this._pending = new Map();
    this._nextTaskID = 1;
    this._closed = false;
  }

  run(task, options: Record<string, any> = {}) {
    if (this._closed) {
      return Promise.reject(new Error("service task pool is closed"));
    }
    if (!task || typeof task !== "object") {
      return Promise.reject(new TypeError("service worker task is required"));
    }
    const rawModulePath = String(task.modulePath || "").trim();
    const exportName = String(task.exportName || "").trim();
    if (!rawModulePath || !exportName) {
      return Promise.reject(
        new TypeError("service worker task requires modulePath and exportName"),
      );
    }
    const modulePath = path.resolve(rawModulePath);
    if (this._queue.length + this._pending.size >= this._maxPendingTasks) {
      const error: Error & Record<string, any> = new Error(
        `service task queue is full (${this._maxPendingTasks})`,
      );
      error.code = "SERVICE_TASK_QUEUE_FULL";
      return Promise.reject(error);
    }
    const taskID = this._nextTaskID++;
    return new Promise((resolve, reject) => {
      this._queue.push({
        taskID,
        modulePath,
        exportName,
        args: Array.isArray(task.args) ? task.args : [],
        timeoutMs: normalizePositiveInteger(options.timeoutMs, this._taskTimeoutMs),
        resolve,
        reject,
      });
      this._drain();
    });
  }

  getStats() {
    return {
      workers: this._workers.size,
      active: this._pending.size,
      queued: this._queue.length,
      maxPendingTasks: this._maxPendingTasks,
      taskTimeoutMs: this._taskTimeoutMs,
    };
  }

  async close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    const closeError = new Error("service task pool closed before task completion");
    for (const queued of this._queue.splice(0)) {
      queued.reject(closeError);
    }
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(closeError);
    }
    this._pending.clear();
    const workers = [...this._workers];
    this._workers.clear();
    this._idleWorkers = [];
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }

  _spawnWorker() {
    const worker = this._createWorker(this._workerPath);
    worker._serviceTaskID = null;
    worker.on("message", (message) => this._handleMessage(worker, message));
    worker.on("error", (error) => this._handleWorkerFailure(worker, error));
    worker.on("exit", (code) => {
      if (this._workers.has(worker)) {
        this._handleWorkerFailure(
          worker,
          new Error(`service task worker exited unexpectedly with code ${code}`),
        );
      }
    });
    this._workers.add(worker);
    return worker;
  }

  _drain() {
    if (this._closed) {
      return;
    }
    while (this._queue.length > 0) {
      let worker = this._idleWorkers.pop() || null;
      if (!worker && this._workers.size < this._poolSize) {
        worker = this._spawnWorker();
      }
      if (!worker) {
        return;
      }
      const task = this._queue.shift();
      worker._serviceTaskID = task.taskID;
      if (typeof worker.ref === "function") {
        worker.ref();
      }
      const timeout = setTimeout(() => {
        this._handleWorkerFailure(
          worker,
          new Error(
            `service worker task ${task.exportName} timed out after ${task.timeoutMs}ms`,
          ),
        );
      }, task.timeoutMs);
      if (typeof timeout.unref === "function") {
        timeout.unref();
      }
      this._pending.set(task.taskID, { ...task, timeout, worker });
      try {
        worker.postMessage({
          type: "run",
          taskID: task.taskID,
          modulePath: task.modulePath,
          exportName: task.exportName,
          args: task.args,
        });
      } catch (error) {
        this._handleWorkerFailure(worker, error);
      }
    }
  }

  _handleMessage(worker, message) {
    const taskID = message && message.taskID;
    const pending = this._pending.get(taskID);
    if (!pending || pending.worker !== worker) {
      return;
    }
    clearTimeout(pending.timeout);
    this._pending.delete(taskID);
    worker._serviceTaskID = null;
    if (typeof worker.unref === "function") {
      worker.unref();
    }
    this._idleWorkers.push(worker);
    if (message.type === "result") {
      pending.resolve(message.result);
    } else {
      pending.reject(deserializeWorkerError(message.error));
    }
    this._drain();
  }

  _handleWorkerFailure(worker, error) {
    if (!worker || !this._workers.has(worker)) {
      return;
    }
    this._workers.delete(worker);
    this._idleWorkers = this._idleWorkers.filter((entry) => entry !== worker);
    const taskID = worker._serviceTaskID;
    worker._serviceTaskID = null;
    if (taskID !== null && taskID !== undefined) {
      const pending = this._pending.get(taskID);
      if (pending) {
        clearTimeout(pending.timeout);
        this._pending.delete(taskID);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    Promise.resolve(worker.terminate()).catch(() => {});
    this._drain();
  }
}

// Deliberately no process-wide default pool. Every workload must choose its
// own concurrency, deadline and admission budget so one domain cannot starve
// codecs, persistence, or world planning.
module.exports = {
  ServiceTaskPool,
  DEFAULT_POOL_SIZE,
  DEFAULT_MAX_PENDING_TASKS,
};
