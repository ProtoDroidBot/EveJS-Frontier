"use strict";

const { performance } = require("perf_hooks");
const v8 = require("v8");

const MEBIBYTE_BYTES = 1024 * 1024;

const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  minIntervalMs: 50,
  maxIntervalMs: 250,
  initialIntervalMs: 100,
  stepMs: 10,
  sampleIntervalMs: 2000,
  cpuLowPercent: 35,
  cpuHighPercent: 75,
  memoryLowPercent: 60,
  memoryHighPercent: 80,
  memoryLimitMb: 0,
});

function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTo(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(toFiniteNumber(value, 0) * scale) / scale;
}

function normalizeOptions(options: Record<string, any> = {}) {
  const minIntervalMs = Math.max(
    1,
    toFiniteNumber(options.minIntervalMs, DEFAULT_OPTIONS.minIntervalMs),
  );
  const maxIntervalMs = Math.max(
    minIntervalMs,
    toFiniteNumber(options.maxIntervalMs, DEFAULT_OPTIONS.maxIntervalMs),
  );
  const cpuLowPercent = clamp(
    toFiniteNumber(options.cpuLowPercent, DEFAULT_OPTIONS.cpuLowPercent),
    0,
    100,
  );
  const cpuHighPercent = clamp(
    Math.max(
      cpuLowPercent,
      toFiniteNumber(options.cpuHighPercent, DEFAULT_OPTIONS.cpuHighPercent),
    ),
    0,
    100,
  );
  const memoryLowPercent = clamp(
    toFiniteNumber(options.memoryLowPercent, DEFAULT_OPTIONS.memoryLowPercent),
    0,
    100,
  );
  const memoryHighPercent = clamp(
    Math.max(
      memoryLowPercent,
      toFiniteNumber(
        options.memoryHighPercent,
        DEFAULT_OPTIONS.memoryHighPercent,
      ),
    ),
    0,
    100,
  );

  return {
    enabled: options.enabled !== false,
    minIntervalMs,
    maxIntervalMs,
    initialIntervalMs: clamp(
      toFiniteNumber(
        options.initialIntervalMs,
        DEFAULT_OPTIONS.initialIntervalMs,
      ),
      minIntervalMs,
      maxIntervalMs,
    ),
    stepMs: Math.max(
      0.001,
      toFiniteNumber(options.stepMs, DEFAULT_OPTIONS.stepMs),
    ),
    sampleIntervalMs: Math.max(
      1,
      toFiniteNumber(
        options.sampleIntervalMs,
        DEFAULT_OPTIONS.sampleIntervalMs,
      ),
    ),
    cpuLowPercent,
    cpuHighPercent,
    memoryLowPercent,
    memoryHighPercent,
    memoryLimitMb: Math.max(
      0,
      toFiniteNumber(options.memoryLimitMb, DEFAULT_OPTIONS.memoryLimitMb),
    ),
  };
}

function resolveAutomaticMemoryLimitBytes(dependencies: Record<string, any> = {}) {
  const candidates: number[] = [];
  const getHeapStatistics = typeof dependencies.getHeapStatistics === "function"
    ? dependencies.getHeapStatistics
    : v8.getHeapStatistics;
  const constrainedMemory = typeof dependencies.constrainedMemory === "function"
    ? dependencies.constrainedMemory
    : typeof process.constrainedMemory === "function"
      ? () => process.constrainedMemory()
      : null;

  try {
    const heapLimit = Number(getHeapStatistics()?.heap_size_limit);
    if (Number.isFinite(heapLimit) && heapLimit > 0) {
      candidates.push(heapLimit);
    }
  } catch (_error) {
    // Resource sampling must never stop the simulation loop.
  }

  if (constrainedMemory) {
    try {
      const constrainedLimit = Number(constrainedMemory());
      if (Number.isFinite(constrainedLimit) && constrainedLimit > 0) {
        candidates.push(constrainedLimit);
      }
    } catch (_error) {
      // Older runtimes can expose the API without a usable platform value.
    }
  }

  return candidates.length > 0
    ? Math.min(...candidates)
    : 1024 * MEBIBYTE_BYTES;
}

function resolveMemoryLimitBytes(
  options: Record<string, any>,
  dependencies: Record<string, any> = {},
) {
  const configuredMb = Math.max(0, Number(options.memoryLimitMb) || 0);
  return configuredMb > 0
    ? configuredMb * MEBIBYTE_BYTES
    : resolveAutomaticMemoryLimitBytes(dependencies);
}

function calculateCpuPercent(previousUsage, currentUsage, elapsedMs) {
  const elapsedMicroseconds = Math.max(1, Number(elapsedMs) * 1000);
  const previousUser = Math.max(0, Number(previousUsage?.user) || 0);
  const previousSystem = Math.max(0, Number(previousUsage?.system) || 0);
  const currentUser = Math.max(0, Number(currentUsage?.user) || 0);
  const currentSystem = Math.max(0, Number(currentUsage?.system) || 0);
  const usedMicroseconds = Math.max(
    0,
    (currentUser - previousUser) + (currentSystem - previousSystem),
  );
  return (usedMicroseconds / elapsedMicroseconds) * 100;
}

function classifyPressure(metrics, options) {
  const cpuHigh = metrics.cpuPercent >= options.cpuHighPercent;
  const memoryHigh = metrics.memoryPercent >= options.memoryHighPercent;
  if (cpuHigh || memoryHigh) {
    return {
      direction: "slower",
      reason: cpuHigh && memoryHigh
        ? "cpu-and-memory-pressure"
        : cpuHigh
          ? "cpu-pressure"
          : "memory-pressure",
    };
  }

  if (
    metrics.cpuPercent <= options.cpuLowPercent &&
    metrics.memoryPercent <= options.memoryLowPercent
  ) {
    return {
      direction: "faster",
      reason: "resource-headroom",
    };
  }

  return {
    direction: "hold",
    reason: "threshold-hysteresis",
  };
}

class AdaptiveTickRateController {
  declare currentIntervalMs: number;
  declare dependencies: Record<string, any>;
  declare lastCpuUsage: any;
  declare lastResult: any;
  declare lastSampleAtMs: number | null;
  declare memoryLimitBytes: number;
  declare options: Record<string, any>;

  constructor(
    options: Record<string, any> = {},
    dependencies: Record<string, any> = {},
  ) {
    this.options = normalizeOptions(options);
    this.dependencies = {
      now: typeof dependencies.now === "function"
        ? dependencies.now
        : () => performance.now(),
      cpuUsage: typeof dependencies.cpuUsage === "function"
        ? dependencies.cpuUsage
        : () => process.cpuUsage(),
      memoryUsage: typeof dependencies.memoryUsage === "function"
        ? dependencies.memoryUsage
        : () => process.memoryUsage(),
    };
    this.memoryLimitBytes = resolveMemoryLimitBytes(
      this.options,
      dependencies,
    );
    this.currentIntervalMs = this.options.initialIntervalMs;
    this.lastSampleAtMs = null;
    this.lastCpuUsage = null;
    this.lastResult = null;
  }

  getCurrentIntervalMs() {
    return this.currentIntervalMs;
  }

  getCurrentTickRateHz() {
    return 1000 / this.currentIntervalMs;
  }

  getState() {
    return {
      enabled: this.options.enabled,
      intervalMs: roundTo(this.currentIntervalMs),
      tickRateHz: roundTo(this.getCurrentTickRateHz()),
      memoryLimitBytes: this.memoryLimitBytes,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
    };
  }

  observe() {
    const nowMs = toFiniteNumber(this.dependencies.now(), performance.now());
    if (!this.options.enabled) {
      return this.recordResult({
        changed: false,
        reason: "disabled",
        intervalMs: this.currentIntervalMs,
        tickRateHz: this.getCurrentTickRateHz(),
      });
    }

    if (this.lastSampleAtMs === null || this.lastCpuUsage === null) {
      this.lastSampleAtMs = nowMs;
      this.lastCpuUsage = this.dependencies.cpuUsage();
      return this.recordResult({
        changed: false,
        reason: "warming-up",
        intervalMs: this.currentIntervalMs,
        tickRateHz: this.getCurrentTickRateHz(),
      });
    }

    const elapsedMs = nowMs - this.lastSampleAtMs;
    if (elapsedMs < this.options.sampleIntervalMs) {
      return null;
    }

    const currentCpuUsage = this.dependencies.cpuUsage();
    const memoryUsage = this.dependencies.memoryUsage() || {};
    const metrics = {
      sampledAtMonotonicMs: roundTo(nowMs),
      elapsedMs: roundTo(elapsedMs),
      cpuPercent: roundTo(
        calculateCpuPercent(this.lastCpuUsage, currentCpuUsage, elapsedMs),
      ),
      memoryPercent: roundTo(
        (Math.max(0, Number(memoryUsage.rss) || 0) / this.memoryLimitBytes) * 100,
      ),
      rssBytes: Math.max(0, Number(memoryUsage.rss) || 0),
      heapUsedBytes: Math.max(0, Number(memoryUsage.heapUsed) || 0),
      memoryLimitBytes: this.memoryLimitBytes,
    };
    this.lastSampleAtMs = nowMs;
    this.lastCpuUsage = currentCpuUsage;

    return this.adjustForMetrics(metrics);
  }

  adjustForMetrics(metrics: Record<string, any>) {
    const classification = classifyPressure(metrics, this.options);
    const previousIntervalMs = this.currentIntervalMs;
    let nextIntervalMs = previousIntervalMs;
    if (classification.direction === "slower") {
      nextIntervalMs = Math.min(
        this.options.maxIntervalMs,
        previousIntervalMs + this.options.stepMs,
      );
    } else if (classification.direction === "faster") {
      nextIntervalMs = Math.max(
        this.options.minIntervalMs,
        previousIntervalMs - this.options.stepMs,
      );
    }
    this.currentIntervalMs = nextIntervalMs;

    return this.recordResult({
      changed: nextIntervalMs !== previousIntervalMs,
      reason: classification.reason,
      direction: classification.direction,
      previousIntervalMs: roundTo(previousIntervalMs),
      intervalMs: roundTo(nextIntervalMs),
      previousTickRateHz: roundTo(1000 / previousIntervalMs),
      tickRateHz: roundTo(1000 / nextIntervalMs),
      metrics: { ...metrics },
    });
  }

  recordResult(result) {
    this.lastResult = result;
    return result;
  }
}

function createAdaptiveTickRateController(
  options: Record<string, any> = {},
  dependencies: Record<string, any> = {},
) {
  return new AdaptiveTickRateController(options, dependencies);
}

module.exports = {
  DEFAULT_OPTIONS,
  AdaptiveTickRateController,
  createAdaptiveTickRateController,
  _testing: {
    MEBIBYTE_BYTES,
    calculateCpuPercent,
    classifyPressure,
    normalizeOptions,
    resolveAutomaticMemoryLimitBytes,
    resolveMemoryLimitBytes,
  },
};
