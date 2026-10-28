"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAdaptiveTickRateController,
  _testing,
} = require("../src/utils/adaptiveTickRate");

function createFixture(overrides: Record<string, any> = {}) {
  let nowMs = 0;
  let cpuUsage = { user: 0, system: 0 };
  let memoryUsage = { rss: 100_000, heapUsed: 50_000 };
  const controller = createAdaptiveTickRateController(
    {
      enabled: true,
      minIntervalMs: 50,
      maxIntervalMs: 200,
      initialIntervalMs: 100,
      stepMs: 25,
      sampleIntervalMs: 1000,
      cpuLowPercent: 30,
      cpuHighPercent: 70,
      memoryLowPercent: 50,
      memoryHighPercent: 80,
      memoryLimitMb: 1,
      ...overrides,
    },
    {
      now: () => nowMs,
      cpuUsage: () => ({ ...cpuUsage }),
      memoryUsage: () => ({ ...memoryUsage }),
    },
  );

  return {
    controller,
    advance({
      elapsedMs = 1000,
      cpuPercent = 0,
      memoryPercent = 10,
    }: Record<string, any> = {}) {
      nowMs += elapsedMs;
      cpuUsage = {
        user: cpuUsage.user + ((cpuPercent / 100) * elapsedMs * 1000),
        system: cpuUsage.system,
      };
      memoryUsage = {
        rss: Math.round((memoryPercent / 100) * 1024 * 1024),
        heapUsed: memoryUsage.heapUsed,
      };
      return controller.observe();
    },
  };
}

test("adaptive tick rate warms up before using process CPU deltas", () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.controller.observe(), {
    changed: false,
    reason: "warming-up",
    intervalMs: 100,
    tickRateHz: 10,
  });
  assert.equal(fixture.advance({ elapsedMs: 500 }), null);
  assert.equal(fixture.controller.getCurrentIntervalMs(), 100);
});

test("high CPU pressure ramps the tick rate down", () => {
  const fixture = createFixture();
  fixture.controller.observe();

  const result = fixture.advance({ cpuPercent: 90, memoryPercent: 20 });

  assert.equal(result.changed, true);
  assert.equal(result.reason, "cpu-pressure");
  assert.equal(result.previousIntervalMs, 100);
  assert.equal(result.intervalMs, 125);
  assert.equal(result.tickRateHz, 8);
});

test("high memory pressure ramps the tick rate down even with low CPU", () => {
  const fixture = createFixture();
  fixture.controller.observe();

  const result = fixture.advance({ cpuPercent: 10, memoryPercent: 90 });

  assert.equal(result.changed, true);
  assert.equal(result.reason, "memory-pressure");
  assert.equal(result.intervalMs, 125);
});

test("CPU and memory headroom ramp the tick rate up", () => {
  const fixture = createFixture({ initialIntervalMs: 150 });
  fixture.controller.observe();

  const result = fixture.advance({ cpuPercent: 20, memoryPercent: 40 });

  assert.equal(result.changed, true);
  assert.equal(result.reason, "resource-headroom");
  assert.equal(result.intervalMs, 125);
  assert.equal(result.tickRateHz, 8);
});

test("hysteresis holds the current rate when either resource is between thresholds", () => {
  const fixture = createFixture();
  fixture.controller.observe();

  const result = fixture.advance({ cpuPercent: 50, memoryPercent: 40 });

  assert.equal(result.changed, false);
  assert.equal(result.reason, "threshold-hysteresis");
  assert.equal(result.intervalMs, 100);
});

test("tick interval adjustments stay within configured bounds", () => {
  const fixture = createFixture();
  const pressure = { cpuPercent: 100, memoryPercent: 100 };
  const headroom = { cpuPercent: 0, memoryPercent: 0 };

  for (let index = 0; index < 10; index += 1) {
    fixture.controller.adjustForMetrics(pressure);
  }
  assert.equal(fixture.controller.getCurrentIntervalMs(), 200);

  for (let index = 0; index < 10; index += 1) {
    fixture.controller.adjustForMetrics(headroom);
  }
  assert.equal(fixture.controller.getCurrentIntervalMs(), 50);
});

test("automatic memory budget uses the strictest detected process limit", () => {
  const limit = _testing.resolveAutomaticMemoryLimitBytes({
    getHeapStatistics: () => ({ heap_size_limit: 8_000_000 }),
    constrainedMemory: () => 4_000_000,
  });

  assert.equal(limit, 4_000_000);
});
