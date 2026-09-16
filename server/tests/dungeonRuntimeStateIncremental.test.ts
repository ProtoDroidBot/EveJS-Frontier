"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const runtimeState = require("../src/services/dungeon/dungeonRuntimeState");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");

function buildInstance(instanceID, overrides: Record<string, any> = {}) {
  return {
    instanceID,
    templateID: `test-template:${instanceID}`,
    solarSystemID: 30_000_001,
    siteKey: `test-site:${instanceID}`,
    lifecycleState: "seeded",
    siteFamily: "combat",
    runtimeFlags: {
      universePersistent: true,
      universeSeeded: true,
    },
    timers: {
      createdAtMs: 1_000,
      expiresAtMs: 5_000,
    },
    ...overrides,
  };
}

test.beforeEach(() => {
  runtimeState.resetRuntimeStateForTests();
});

test("targeted instance changes keep runtime indexes coherent", () => {
  const created = runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(1), buildInstance(2)],
    nextInstanceSequence: 3,
  });
  assert.equal(created.success, true);
  assert.equal(runtimeState.getNextInstanceSequence(), 3);
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_001).map((entry) => entry.instanceID),
    [1, 2],
  );
  assert.equal(runtimeState.findInstanceSummaryBySiteKey("test-site:1").instanceID, 1);
  assert.equal(runtimeState.getNextActiveExpiryAtMs(), 5_000);

  const moved = runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(1, {
      solarSystemID: 30_000_002,
      lifecycleState: "completed",
      timers: {
        createdAtMs: 1_000,
        completedAtMs: 4_000,
        expiresAtMs: 0,
      },
    })],
  });
  assert.equal(moved.success, true);
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_001).map((entry) => entry.instanceID),
    [2],
  );
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_002).map((entry) => entry.instanceID),
    [1],
  );
  assert.deepEqual(runtimeState.listUniversePersistentTerminalInstanceIDs(), [1]);

  const removed = runtimeState.applyInstanceChanges({ removeInstanceIDs: [1] });
  assert.equal(removed.success, true);
  assert.equal(runtimeState.getInstanceSnapshot(1), null);
  assert.equal(runtimeState.findInstanceSummaryBySiteKey("test-site:1"), null);
  assert.deepEqual(runtimeState.listUniversePersistentTerminalInstanceIDs(), []);
});

test("universe reconciliation does not fall back to a whole-state mutation", () => {
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(10, {
      siteOrigin: "generatedmining",
    })],
    nextInstanceSequence: 11,
  });

  const originalMutateState = runtimeState.mutateState;
  runtimeState.mutateState = () => {
    throw new Error("whole-state mutation should not run");
  };
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([], {
      systemIDs: [30_000_001],
      siteOriginFilter: ["generatedmining"],
      nowMs: 10_000,
    });
  } finally {
    runtimeState.mutateState = originalMutateState;
  }

  assert.equal(summary.removedCount, 1);
  assert.equal(runtimeState.getInstanceSnapshot(10), null);
});

test("runtime expiry ticks update only expired instances", () => {
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(20)],
    nextInstanceSequence: 21,
  });

  const originalMutateState = runtimeState.mutateState;
  runtimeState.mutateState = () => {
    throw new Error("whole-state mutation should not run");
  };
  let summary;
  try {
    summary = dungeonRuntime.tickRuntime({ nowMs: 10_000 });
  } finally {
    runtimeState.mutateState = originalMutateState;
  }

  assert.equal(summary.expiredCount, 1);
  assert.equal(runtimeState.getInstanceSnapshot(20).lifecycleState, "despawned");
});
